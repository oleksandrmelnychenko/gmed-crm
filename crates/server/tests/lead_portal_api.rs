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
const CONSENT_VERSION: &str = "2026-10-13";
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
        Some(json!({ "purpose": purpose, "version": if purpose == "lead_inquiry_processing" { "2026-10-03" } else { CONSENT_VERSION }, "language": "de" })),
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
        "pep_self": false,
        "pep_related": false,
        "sanctions_links": false,
        // The lead's own reason of the request (13.1); staff enter the
        // identity document data (trigger flow 2026-10-07).
        "request_reason": "Zweitmeinung zur Knie-OP"
    })
}

/// Body of "send to the manager" with the confirmation that the information
/// is complete and true.
fn declared() -> Option<Value> {
    Some(json!({ "declared_correct": true }))
}

/// Who receives the invoice (step 3) and how the patient pays (section 8),
/// as a self-paying adult answers them.
fn complete_billing() -> Value {
    json!({
        "invoice_recipient": "self",
        "payment_method": "bank_transfer",
        "account_country": "DE",
        "account_holder": "Anna Muster",
        "bank_name": "Musterbank",
        "via_third_party": false
    })
}

/// Fills in everything "send to the manager" needs, as the cabinet does: the
/// personal data, who pays (the patient, in the own interest; without the
/// triggers of the enhanced check no source of funds is asked), where the
/// invoice goes and how the patient pays, the statements
/// for the identification, that nobody acts for the (adult) patient, the
/// request consent and a copy of the identity document. Returns the request
/// as the last save answered it.
async fn fill_in_complete_request(app: &axum::Router, lead_id: Uuid, bearer: &str) -> Value {
    give_consent(app, lead_id, bearer, "health_data_processing").await;
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
                ,"phone": "+49 30 1234567"
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
async fn cabinet_submission_protects_health_identity_and_base_changes() {
    let Some(app) = test_app().await else {
        return;
    };
    let router = &app.suite.app;
    let (lead, _, patient) = lead_with_login(&app, "Anna", "cabinet-audit@example.test").await;
    let base = format!("/api/v1/me/lead-requests/{lead}");
    let (status, body) = json_request(
        router,
        "POST",
        &format!("{base}/identification"),
        &patient,
        Some(json!({"request_reason": "Synthetic concern"})),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
    assert_eq!(body["code"], "health_consent_required");
    let full = fill_in_complete_request(router, lead, &patient).await;
    let document = full["identity_documents"][0]["id"].as_str().unwrap();
    let (status, changed) = json_request(
        router,
        "POST",
        &format!("{base}/personal-data"),
        &patient,
        Some(json!({"first_name": "Анна", "phone": ""})),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{changed}");
    assert!(
        changed["progress"]["missing_for_submit"]
            .as_array()
            .unwrap()
            .contains(&json!("name_latin"))
    );
    assert!(
        changed["progress"]["missing_for_submit"]
            .as_array()
            .unwrap()
            .contains(&json!("phone"))
    );
    let (status, body) = json_request(
        router,
        "POST",
        &format!("{base}/submit"),
        &patient,
        declared(),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
    let (status, body) = json_request(
        router,
        "POST",
        &format!("{base}/personal-data"),
        &patient,
        Some(json!({"first_name": "Anna", "phone": "+49 30 1234567"})),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let (status, body) = json_request(
        router,
        "PUT",
        &format!("/api/v1/leads/{lead}/identity-document-data"),
        &app.staff("sales"),
        Some(json!({"id_document_number": "TEST12345"})),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let (status, body) = json_request(
        router,
        "POST",
        &format!("{base}/identification"),
        &patient,
        Some(json!({"salutation": "ms"})),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["identity_documents"][0]["can_delete"], false);
    let number: Option<String> = sqlx::query_scalar(
        "SELECT id_document_number FROM lead_gwg_declarations WHERE lead_id = $1",
    )
    .bind(lead)
    .fetch_one(&app.suite.pool)
    .await
    .unwrap();
    assert_eq!(number.as_deref(), Some("TEST12345"));
    let (status, body) = json_request(
        router,
        "DELETE",
        &format!("{base}/documents/{document}"),
        &patient,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{body}");
    assert_eq!(body["code"], "upload_in_use");
    let (status, body) = json_request(
        router,
        "POST",
        &format!("/api/v1/leads/{lead}/portal-intake/documents/{document}/review"),
        &app.staff("sales"),
        None,
    )
    .await;
    // RBAC matrix (owner 2026-10-24): accepting a file needs leads.edit and
    // patients.medical.view, and the right to open it; Sales may open an
    // identity scan but has no patients.medical.view.
    assert_eq!(
        status,
        StatusCode::FORBIDDEN,
        "Sales cannot accept a file it cannot open: {body}"
    );
    let (status, body) = json_request(
        router,
        "POST",
        &format!("/api/v1/leads/{lead}/portal-intake/documents/{document}/review"),
        &app.staff("patient_manager"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let (status, body) = json_request(
        router,
        "POST",
        &format!("{base}/submit"),
        &patient,
        declared(),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let (status, body) = json_request(
        router,
        "POST",
        &format!("{base}/personal-data"),
        &patient,
        Some(json!({"city": "Hamburg"})),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    sqlx::query("INSERT INTO lead_risk_assessments (lead_id, status, follow_up_answered_at) VALUES ($1, 'clear', clock_timestamp()) ON CONFLICT (lead_id) DO UPDATE SET follow_up_answered_at = clock_timestamp()")
        .bind(lead).execute(&app.suite.pool).await.unwrap();
    let (_, body) = json_request(router, "GET", &base, &patient, None).await;
    assert_eq!(
        body["changed_since_submit"], true,
        "A follow-up must not consume a base form edit: {body}"
    );
    // A staff-held passport remains valid evidence without a current cabinet upload.
    sqlx::query("UPDATE documents SET compliance_kind = 'identity' WHERE id = $1")
        .bind(Uuid::parse_str(document).unwrap())
        .execute(&app.suite.pool)
        .await
        .unwrap();
    sqlx::query(
        "UPDATE lead_portal_uploads SET withdrawn_at = clock_timestamp() WHERE document_id = $1",
    )
    .bind(Uuid::parse_str(document).unwrap())
    .execute(&app.suite.pool)
    .await
    .unwrap();
    let (status, body) = json_request(router, "GET", &base, &patient, None).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert!(
        !body["progress"]["missing_for_submit"]
            .as_array()
            .unwrap()
            .contains(&json!("id_document_upload")),
        "{body}"
    );
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
    // `citizenships` is the one source: the legacy key is not written.
    assert_eq!(registration_country, None);
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

/// The name the login carries (what the account page and Users & Roles show).
async fn login_name(pool: &PgPool, user_id: Uuid) -> String {
    sqlx::query_scalar("SELECT name FROM users WHERE id = $1")
        .bind(user_id)
        .fetch_one(pool)
        .await
        .unwrap()
}

/// How often open pages were told that the login's profile changed.
async fn login_events(pool: &PgPool, user_id: Uuid) -> i64 {
    sqlx::query_scalar(
        "SELECT count(*) FROM realtime_events WHERE event_type = 'user.updated' AND entity_id = $1",
    )
    .bind(user_id)
    .fetch_one(pool)
    .await
    .unwrap()
}

#[tokio::test]
async fn a_renamed_lead_is_renamed_in_its_login() {
    let Some(app) = test_app().await else { return };
    let router = &app.suite.app;
    let pool = &app.suite.pool;
    let email = "rena.rename@example.com";
    let (lead_id, user_id, patient) = lead_with_login(&app, "Rena", email).await;
    let (_, other_user_id, _) = lead_with_login(&app, "Olga", "olga.rename@example.com").await;
    let pm = app.staff("patient_manager");
    let update = format!("/api/v1/leads/{lead_id}/update");
    // The login is issued with the lead's name.
    assert_eq!(login_name(pool, user_id).await, "Rena Portal");

    // Staff rename the lead: the account page of the cabinet and Users & Roles
    // show the new name; another lead's login is not touched.
    let (status, body) = json_request(
        router,
        "POST",
        &update,
        &pm,
        Some(json!({ "first_name": " Renata ", "last_name": "Portal-Meyer" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(login_name(pool, user_id).await, "Renata Portal-Meyer");
    assert_eq!(login_name(pool, other_user_id).await, "Olga Portal");
    let (status, profile) = json_request(router, "GET", "/api/v1/me/profile", &patient, None).await;
    assert_eq!(status, StatusCode::OK, "{profile}");
    assert_eq!(profile["name"], "Renata Portal-Meyer");
    let (status, users) = json_request(
        router,
        "GET",
        &format!("/api/v1/users?search={email}"),
        &bearer(app.suite.admin_id, "ceo"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{users}");
    let listed = users
        .as_array()
        .unwrap()
        .iter()
        .find(|row| row["id"] == json!(user_id))
        .unwrap_or_else(|| panic!("the login is listed: {users}"));
    assert_eq!(listed["name"], "Renata Portal-Meyer");
    let context: Value = sqlx::query_scalar(
        r#"SELECT context FROM audit_log
           WHERE action = 'update_lead' AND entity_id = $1
           ORDER BY created_at DESC LIMIT 1"#,
    )
    .bind(lead_id)
    .fetch_one(pool)
    .await
    .unwrap();
    assert_eq!(context["portal_name_synced"], true, "{context}");
    // Open pages follow at once: the event goes to the roles that list users
    // and to the login's own sessions, and it does not carry the name.
    let (actor, targets, roles, payload): (Option<Uuid>, Vec<Uuid>, Vec<String>, Value) =
        sqlx::query_as(
            r#"SELECT actor_user_id, target_user_ids, role_names, payload FROM realtime_events
               WHERE event_type = 'user.updated' AND entity_id = $1
               ORDER BY seq DESC LIMIT 1"#,
        )
        .bind(user_id)
        .fetch_one(pool)
        .await
        .unwrap();
    assert_eq!(actor, Some(app.patient_manager_id));
    assert!(targets.contains(&user_id), "{targets:?}");
    assert!(
        roles.contains(&"ceo".to_string()) && roles.contains(&"it_admin".to_string()),
        "{roles:?}"
    );
    assert_eq!(payload["change"], "name");
    assert_eq!(payload["lead_id"], json!(lead_id));
    assert!(!payload.to_string().contains("Renata"), "{payload}");
    assert_eq!(login_events(pool, user_id).await, 1);

    // Saving other data leaves the login's name alone; saving the name again
    // brings a login that drifted earlier into line.
    sqlx::query("UPDATE users SET name = 'Drifted' WHERE id = $1")
        .bind(user_id)
        .execute(pool)
        .await
        .unwrap();
    let (status, body) = json_request(
        router,
        "POST",
        &update,
        &pm,
        Some(json!({ "city": "Lviv" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(login_name(pool, user_id).await, "Drifted");
    assert_eq!(login_events(pool, user_id).await, 1);
    let (status, body) = json_request(
        router,
        "POST",
        &update,
        &pm,
        Some(json!({ "first_name": "Renata", "last_name": "Portal-Meyer" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(login_name(pool, user_id).await, "Renata Portal-Meyer");
    assert_eq!(login_events(pool, user_id).await, 2);

    // The lead renames itself in the cabinet.
    let (status, saved) = json_request(
        router,
        "POST",
        &format!("/api/v1/me/lead-requests/{lead_id}/personal-data"),
        &patient,
        Some(json!({ "first_name": "Rita" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{saved}");
    assert_eq!(login_name(pool, user_id).await, "Rita Portal-Meyer");
    let (actor, targets): (Option<Uuid>, Vec<Uuid>) = sqlx::query_as(
        r#"SELECT actor_user_id, target_user_ids FROM realtime_events
           WHERE event_type = 'user.updated' AND entity_id = $1
           ORDER BY seq DESC LIMIT 1"#,
    )
    .bind(user_id)
    .fetch_one(pool)
    .await
    .unwrap();
    assert_eq!(actor, Some(user_id));
    assert_eq!(targets, vec![user_id]);
    assert_eq!(login_events(pool, user_id).await, 3);

    // A converted lead's login is the patient's account: its name stays.
    let patient_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO patients (patient_id, first_name, last_name, birth_date, gender, created_by)
           VALUES ($1, 'Rita', 'Portal-Meyer', DATE '1985-02-03', 'female', $2) RETURNING id"#,
    )
    .bind(format!("P-RENAME-{}", Uuid::new_v4().simple()))
    .bind(app.suite.admin_id)
    .fetch_one(pool)
    .await
    .unwrap();
    sqlx::query(
        "UPDATE leads SET qualification_status = 'converted', converted_patient_id = $2,
                          status_changed_at = now() WHERE id = $1",
    )
    .bind(lead_id)
    .bind(patient_id)
    .execute(pool)
    .await
    .unwrap();
    let (status, body) = json_request(
        router,
        "POST",
        &update,
        &pm,
        Some(json!({ "first_name": "Zara", "last_name": "Portal-Meyer" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(login_name(pool, user_id).await, "Rita Portal-Meyer");
    assert_eq!(login_events(pool, user_id).await, 3);
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

    // A translation made from it as a document of its own (synthetic).
    let translation_id = Uuid::new_v4();
    sqlx::query(
        r#"INSERT INTO documents (
                id, lead_id, auto_name, original_filename, art, category, status, visibility,
                is_medical, mime_type, file_size, storage_key, version_root_document_id,
                version_number, uploaded_by, generated_manual_text, ursprung
           ) VALUES (
                $1, $2, 'Translation DE - Befund', 'translation-de.pdf', 'translated_document',
                'translation', 'active', 'internal', true, 'application/pdf', 10, $3, $1, 1, $4,
                'Befund: synthetisch', 'document_translation'
           )"#,
    )
    .bind(translation_id)
    .bind(lead_id)
    .bind(format!("{translation_id}_synthetic.pdf"))
    .bind(user_id)
    .execute(pool)
    .await
    .unwrap();
    sqlx::query(
        r#"INSERT INTO document_translations (
                document_id, target_language, provider, translated_text, translated_document_id,
                created_by
           ) VALUES ($1, 'de', 'manual', 'Befund: synthetisch', $2, $3)"#,
    )
    .bind(document_id)
    .bind(translation_id)
    .bind(user_id)
    .execute(pool)
    .await
    .unwrap();

    // Withdrawn before review; the translation goes with it.
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
    let (translation_key, translation_text, translation_reason): (
        Option<String>,
        Option<String>,
        Option<String>,
    ) = sqlx::query_as(
        "SELECT storage_key, generated_manual_text, file_delete_reason FROM documents WHERE id = $1",
    )
    .bind(translation_id)
    .fetch_one(pool)
    .await
    .unwrap();
    assert_eq!((translation_key, translation_text), (None, None));
    assert_eq!(
        translation_reason.as_deref(),
        Some("source_document_deleted")
    );

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
            "phone": "+4930123456",
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
    // Since the trigger flow (2026-10-07) staff enter the identity data, the
    // payment route is a follow-up block and the lead states the reason of
    // the request.
    // Birth data, the own economic interest and the legal questions are no
    // longer asked in the base form (owner 2026-10-09). Since 2026-10-11
    // (owner) the guardianship question follows a "yes" to "does somebody act
    // on your behalf?", and step 3 asks who receives the invoice first: "who
    // pays" and the payment method wait for that answer. The reason of the
    // request is optional since 2026-10-19 (owner).
    let still_missing = json!([
        "id_document_upload",
        "has_representative",
        "invoice_recipient"
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
    give_consent(router, lead_id, &patient, "health_data_processing").await;
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
    // The own economic interest is follow-up block L now, not the base form.
    assert!(!missing.contains(&json!("payer_own_account")), "{body}");
    let (status, body) = json_request(
        router,
        "POST",
        &format!("{request}/payer"),
        &patient,
        Some(json!({ "payer_kind": "self", "acts_on_own_account": true })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    // The reason of the request is optional (owner 2026-10-19): this lead
    // leaves it empty and still sends the request below.
    let mut identification = complete_identification();
    identification
        .as_object_mut()
        .unwrap()
        .remove("request_reason");
    let (status, body) = json_request(
        router,
        "POST",
        &format!("{request}/identification"),
        &patient,
        Some(identification),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert!(body["identification"]["request_reason"].is_null(), "{body}");
    // Without a trigger of the enhanced check a self-payer is asked nothing
    // about the source of funds (owner request 2026-10-07).
    assert_eq!(
        body["progress"]["missing_for_submit"],
        json!([
            "id_document_upload",
            "has_representative",
            "invoice_recipient",
            "payment_method"
        ]),
        "{body}"
    );
    // Nothing is scored before the send: no follow-up blocks.
    assert_eq!(body["follow_up"]["required"], false, "{body}");
    assert!(body.get("enhanced_check").is_none(), "{body}");
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
        json!(["id_document_upload", "invoice_recipient", "payment_method"]),
        "{body}"
    );
    // Who receives the invoice (step 3) and how the patient pays (phase 2).
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
    let marker_follows_submission: bool = sqlx::query_scalar(
        "SELECT (portal_field_updates->'has_insurance'->>'at')::timestamptz > portal_submitted_at
         FROM leads WHERE id = $1",
    )
    .bind(lead_id)
    .fetch_one(&app.suite.pool)
    .await
    .unwrap();
    assert!(
        marker_follows_submission,
        "the database clock orders a cabinet edit after submission"
    );
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
    // Step 3 asks who receives the invoice before who pays (owner 2026-10-11).
    assert!(
        body["progress"]["missing_for_submit"]
            .as_array()
            .unwrap()
            .contains(&json!("invoice_recipient")),
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
            "self_funds_source": "savings"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    // Staff write the patient's one record of the funds (2026-10-23).
    assert_eq!(
        body["declaration"]["self_funds_source"], "savings",
        "{body}"
    );
    assert_eq!(
        body["declaration"]["self_funds_entered_by"], "staff",
        "{body}"
    );
    assert!(body["declaration"]["source_of_funds"].is_null(), "{body}");
    assert_eq!(body["funds"]["patient"]["entered_by"], "staff", "{body}");

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
    // (phase 3b); until it is given it is the only payer key of the base
    // form missing. Why another relative pays is a follow-up block of the
    // risk assessment now (trigger flow 2026-10-07), never a base key.
    assert_eq!(
        missing_for_the_payer(&body),
        ["payer_cost_estimate_consent"],
        "{body}"
    );
    assert_eq!(body["follow_up"]["required"], false, "{body}");
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
    // The patient's own funds go with a third party (data minimisation); the
    // payer states its own (one source per person, 2026-10-23).
    assert!(stored["self_funds_source"].is_null(), "{declaration}");
    assert!(stored["source_of_funds"].is_null(), "{declaration}");
    assert_eq!(declaration["funds"]["relevant"], "payer", "{declaration}");
    assert_eq!(
        declaration["funds"]["payer"]["stated"], false,
        "{declaration}"
    );
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
        // Server-computed: the payer link locked the organisation details.
        "organisation_details_locked",
        // The lead's own answers of the extra step; staff write the
        // patient's funds only from the AML form (2026-10-23), and who
        // entered them is the server's.
        "self_funds_source",
        "self_funds_description",
        "self_funds_entered_by",
        "payer_funds_source_stated",
        "payer_funds_description_stated",
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
    assert!(
        declaration["declaration"]["source_of_funds"].is_null(),
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
    // Owner 2026-10-09: the base form no longer asks it (follow-up block L does);
    // the answers are stored the same way.
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
    assert!(!missing(&body, "payer_own_account"), "{body}");

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
    assert!(!missing(&body, "payer_beneficial_owner"), "{body}");
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
    // Without staff's identity data, with the statements of the follow-up
    // blocks and the reason of the request (trigger flow 2026-10-07).
    assert_eq!(empty.as_object().unwrap().len(), 32, "{body}");
    assert!(empty.get("id_document_number").is_none(), "{body}");
    assert!(empty["request_reason"].is_null(), "{body}");
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
            json!({ "id_document_type": "passport" }),
            "id_document_type",
            "staff_only",
        ),
        (
            json!({ "id_document_number": "AB123456" }),
            "id_document_number",
            "staff_only",
        ),
        (
            json!({ "id_issued_on": "2021-01-01" }),
            "id_issued_on",
            "staff_only",
        ),
        (
            json!({ "id_valid_until": "2099-01-01" }),
            "id_valid_until",
            "staff_only",
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
            "residence_since": " 2019 ",
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
    assert_eq!(stated["residence_since"], "2019", "{saved}");
    assert!(stated.get("id_document_number").is_none(), "{saved}");
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
    assert!(fields.contains(&json!("birth_place")), "{context}");
    assert!(fields.contains(&json!("residence_since")), "{context}");
    assert!(fields.contains(&json!("pep_related_details")), "{context}");
    assert!(!fields.contains(&json!("sanctions_links_details")));
    let audited = context.to_string();
    assert!(!audited.contains("Kyiv") && !audited.contains("Minister"));
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
    // A file whose content is not what its name says (an iPhone photo saved
    // as .jpg, a damaged file) is refused with a code the cabinet translates,
    // not with a bare "try again" (QA 2026-10-24); the medical documents too.
    for path in [identity_document.clone(), format!("{request}/documents")] {
        let (status, body) =
            upload_file(router, &path, &patient, "pass.jpg", "image/jpeg", PDF).await;
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
        assert_eq!(body["code"], "unsupported_file_type", "{path} {body}");
        // What the cabinet does not offer is refused for medical documents
        // too, and an iPhone photo (HEIC) says how to send it (owner
        // 2026-10-24).
        let (status, body) =
            upload_file(router, &path, &patient, "notes.txt", "text/plain", b"notes").await;
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
        assert_eq!(body["code"], "unsupported_file_type", "{path} {body}");
        assert_eq!(body["accept"], ".pdf,.jpg,.jpeg,.png", "{body}");
        let heic = b"\0\0\0\x18ftypheic\0\0\0\0mif1heic synthetic";
        let (status, body) =
            upload_file(router, &path, &patient, "IMG_0001.HEIC", "image/heic", heic).await;
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
        assert_eq!(body["code"], "unsupported_file_type", "{body}");
        assert_eq!(body["format"], "heic", "{body}");
    }
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
    // statements also for Sales (it is not medical); "N documents" counts
    // the medical files only, as the leads list does (QA 2026-10-11, A-11:
    // one definition; the UI says "medical documents").
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
    // Sales sees the file listed and opens it: it uploads and corrects
    // identity scans, so it reads them too (owner 2026-10-24).
    let (status, body) = json_request(
        router,
        "GET",
        &format!("/api/v1/documents/{document_id}/download"),
        &app.staff("sales"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
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
    // document, a proof of the own funds and the confirmation, as sent to
    // the manager.
    fill_in_complete_request(router, lead_id, &patient).await;
    let (status, body) = upload(
        router,
        &format!("/api/v1/me/lead-requests/{lead_id}/funds-proof"),
        &patient,
        PDF,
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    let funds_proof: Uuid = body["follow_up"]["funds_proof_documents"][0]["id"]
        .as_str()
        .unwrap()
        .parse()
        .unwrap();
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
    // the request holds. Not court-appointed: an authorised representative
    // (owner 2026-10-11).
    let representative = Uuid::new_v4();
    let (status, body) = json_request(
        router,
        "POST",
        &format!("/api/v1/me/lead-requests/{lead_id}/representation"),
        &patient,
        Some(json!({ "has_representative": true, "under_guardianship": false })),
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
    // A third party who receives the invoice (owner 2026-10-11).
    let (status, body) = json_request(
        router,
        "POST",
        &format!("/api/v1/me/lead-requests/{lead_id}/billing"),
        &patient,
        Some(json!({
            "invoice_recipient": "third_party",
            "recipient_type": "organisation",
            "recipient_organisation_name": "Beispiel GmbH",
            "recipient_city": "Berlin"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let recipients: i64 =
        sqlx::query_scalar("SELECT count(*) FROM lead_invoice_recipients WHERE lead_id = $1")
            .bind(lead_id)
            .fetch_one(pool)
            .await
            .unwrap();
    assert_eq!(recipients, 1);
    // The trusted persons of the cabinet (2026-10-14).
    let (status, body) = json_request(
        router,
        "POST",
        &format!("/api/v1/me/lead-requests/{lead_id}/trusted-persons"),
        &patient,
        Some(confirmed_disclosure(
            json!([{ "name": "Oma Lena", "relation": "relative",
            "scope_codes": ["medical"] }]),
            true,
        )),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");

    let (status, choices) = choose(
        router,
        lead_id,
        &patient,
        &json!({ "agency_processing": true, "doctors_to_agency": true, "data_system": true,
            "named_recipients": true }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{choices}");
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
    let choices: i64 =
        sqlx::query_scalar("SELECT count(*) FROM consent_form_choices WHERE lead_id=$1")
            .bind(lead_id)
            .fetch_one(pool)
            .await
            .unwrap();
    assert_eq!(
        choices, 0,
        "choice recipients must not survive lead erasure"
    );
    // The lead's own statements, the payer answer with the source of funds,
    // the copy of the identity document and the proof of funds go with the
    // lead.
    assert_eq!(statements, 0);
    assert_eq!(payer, 0);
    assert_eq!(documents, 0);
    let proof_files: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM documents WHERE id = $1 AND storage_key IS NOT NULL",
    )
    .bind(funds_proof)
    .fetch_one(pool)
    .await
    .unwrap();
    assert_eq!(proof_files, 0);
    // So do the answers about the invoice recipient.
    let recipients: i64 =
        sqlx::query_scalar("SELECT count(*) FROM lead_invoice_recipients WHERE lead_id = $1")
            .bind(lead_id)
            .fetch_one(pool)
            .await
            .unwrap();
    assert_eq!(recipients, 0);
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
    let trusted_persons: Value =
        sqlx::query_scalar("SELECT portal_trusted_persons FROM leads WHERE id = $1")
            .bind(lead_id)
            .fetch_one(pool)
            .await
            .unwrap();
    assert_eq!(
        trusted_persons,
        json!([]),
        "trusted persons go with the lead"
    );
    let (status, _) = json_request(router, "GET", "/api/v1/me/lead-requests", &patient, None).await;
    // The login itself is switched off with the lead.
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

/// The patient stays the invoice recipient but answers "the recipient is
/// also the payer" with no, as the cabinet asks it before a third party who
/// pays is named (step 3, owner decision 2026-10-11).
async fn someone_else_pays_the_patients_invoice(app: &axum::Router, lead_id: Uuid, bearer: &str) {
    let (status, body) = json_request(
        app,
        "POST",
        &format!("/api/v1/me/lead-requests/{lead_id}/billing"),
        bearer,
        Some(json!({ "invoice_recipient": "self", "invoice_recipient_is_payer": false })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(
        body["billing"]["invoice_recipient_is_payer"], false,
        "{body}"
    );
}

/// The payer keys of `progress.missing_for_submit`, with the reason why the
/// third party pays.
fn missing_for_the_payer(body: &Value) -> Vec<&str> {
    body["progress"]["missing_for_submit"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(Value::as_str)
        // The payer's keys of the base form and, of the extra step, why the
        // third party pays and what the patient knows of its funds.
        .filter(|key| key.starts_with("payer") || key.starts_with("enhanced_pay"))
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
    // The patient receives the invoice but does not pay it: the payer
    // question follows (step 3, the invoice recipient is the one source).
    someone_else_pays_the_patients_invoice(router, lead_id, &patient).await;
    // The company as the cabinet sends it; `extra` adds or replaces keys.
    let company = |extra: Value| {
        let mut body = json!({
            "payer_kind": "third_party",
            "payer_type": "company",
            "organisation_name": " Beispiel GmbH ",
            "street": "Ringstr. 9",
            "zip": "1010",
            "city": "Wien",
            "email": "kosten@example.com",
            "phone": "+43 1 5555",
            // The organisation mask (trigger flow 2026-10-07).
            "organisation_legal_form": "GmbH",
            "organisation_contact_name": "Erika Muster"
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
    // An organisation needs no relationship; why it pays it states on its
    // own link (owner 2026-10-24: no longer required of the lead).
    assert_eq!(
        missing_for_the_payer(&body),
        [
            "payer_country",
            "payer_contact_consent",
            "payer_cost_estimate_consent",
        ],
        "{body}"
    );
    assert_eq!(body["payer"]["organisation_legal_form"], "GmbH", "{body}");
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
    // An organisation's relationship is no question of the cabinet any more.
    assert_eq!(
        missing_for_the_payer(&body),
        ["payer_contact_consent", "payer_cost_estimate_consent"],
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

    // Why the company pays is one of the lead's statements; what the lead
    // knows of its funds goes to the declaration as the lead's words.
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
    let (status, body) = json_request(
        router,
        "POST",
        &format!("{request}/enhanced-details"),
        &patient,
        Some(json!({ "payer_funds_source": "income", "payer_funds_description": "Umsatz der Firma" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(
        body["follow_up"]["answers"]["payer_funds_source"], "income",
        "{body}"
    );
    assert_eq!(
        body["progress"]["missing_for_submit"],
        json!(["payer_contact_consent", "payer_cost_estimate_consent"]),
        "{body}"
    );
    // The own source of funds belongs to a self-payer.
    let (status, body) = json_request(
        router,
        "POST",
        &format!("{request}/enhanced-details"),
        &patient,
        Some(json!({ "funds_source": "savings" })),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{body}");
    assert_eq!(body["code"], "payer_not_self", "{body}");

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
        "phone": "+43 1 5555",
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
    // Both consents of the lead were given for the company, and so were
    // the lead's words on its funds. A person needs the e-mail for its own
    // link and the country; phone and city it states on that link (owner
    // 2026-10-24).
    assert!(
        body["payer"]["cost_estimate_consent_at"].is_null(),
        "{body}"
    );
    assert_eq!(
        missing_for_the_payer(&body),
        [
            "payer_contact_consent",
            "payer_cost_estimate_consent",
            "payer_email",
            "payer_country",
        ],
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
            "representative_id": mother,
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

    // "I pay (as a parent)" sent the way an older cabinet does, as a
    // third-party answer made of the template: the parent is recorded as the
    // paying representative, never as a third party (owner decision
    // 2026-10-19), and shown with the representative's own data. The parent
    // is the payer: no consent to contact somebody else is asked (QA
    // 2026-10-06).
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
    assert_eq!(body["payer"]["payer_kind"], "representative", "{body}");
    assert_eq!(
        body["payer"]["payer_representative_id"],
        json!(mother),
        "{body}"
    );
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

    // A wizard list without the mother keeps her: her access is open, and an
    // access never outlives its contact. The template stays hers (never the
    // other parent's).
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
    assert_eq!(
        body["payer_self_template"]["representative_id"],
        json!(mother),
        "{body}"
    );
    // Staff remove her contact: the access goes with it.
    let (status, body) = json_request(
        router,
        "DELETE",
        &format!("/api/v1/leads/{child}/trusted-contacts/{mother}"),
        &pm,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let (status, body) = json_request(router, "GET", &request, &parent, None).await;
    assert_ne!(status, StatusCode::OK, "{body}");
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
                // The invoice recipient of step 3 (2026-10-11).
                || key.starts_with("recipient_")
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
            "account_holder_suggestion": "Anna Portal",
            // Block C of the risk assessment (trigger flow 2026-10-07); the
            // expected total is no longer asked (owner 2026-10-12).
            "via_third_party_kind": null,
            // Step 3: the invoice recipient first (owner spec 2026-10-11).
            "invoice_recipient": null, "invoice_recipient_is_payer": null,
            "recipient": {
                "type": null, "name": null, "first_name": null, "last_name": null,
                "organisation_name": null, "legal_form": null, "contact_name": null,
                "street": null, "zip": null, "city": null, "country": null, "email": null,
                "phone": null, "relationship_kind": null, "relationship": null,
                "payment_reason": null
            }
        }),
        "{body}"
    );
    assert_eq!(
        missing_for_the_billing(&body),
        // The payment route (section 8) is follow-up block C since the trigger
        // flow (2026-10-07). Step 3 asks who receives the invoice first; the
        // bare payment method (owner 2026-10-10) waits for the payer.
        ["invoice_recipient"],
        "{body}"
    );
    let (status, body) = json_request(
        router,
        "POST",
        &billing,
        &patient,
        Some(json!({ "payment_method": "cash" })),
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
        Some(json!({ "payment_method": "cash" })),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (other_lead, _, _) = lead_with_login(&app, "Olga", "olga.billing@example.com").await;
    let (status, _) = json_request(
        router,
        "POST",
        &format!("/api/v1/me/lead-requests/{other_lead}/billing"),
        &patient,
        Some(json!({ "payment_method": "cash" })),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    // The patient pays himself. Section 7 is derived from the invoice
    // recipient of step 3 (the one source since 2026-10-23): its keys are no
    // longer the cabinet's to send.
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
    // Another address: a third party receives the invoice and does not pay;
    // section 7 names it at its address.
    let (status, body) = json_request(
        router,
        "POST",
        &billing,
        &patient,
        Some(json!({
            "invoice_recipient": "third_party",
            "invoice_recipient_is_payer": false,
            "recipient_type": "person",
            "recipient_first_name": " Anna ",
            "recipient_last_name": "Muster",
            "recipient_street": "Musterweg 1",
            "recipient_zip": "10115",
            "recipient_city": "Berlin",
            "recipient_email": "rechnung@example.com",
            "recipient_relationship_kind": "relative"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let shown = &body["billing"];
    assert_eq!(shown["invoice_to"], "other", "{body}");
    assert_eq!(shown["invoice_name"], "Anna Muster", "{body}");
    assert_eq!(shown["invoice_street"], "Musterweg 1", "{body}");
    assert_eq!(shown["invoice_email"], "rechnung@example.com", "{body}");
    assert_eq!(shown["invoice_recipient"], "third_party", "{body}");
    assert_eq!(shown["invoice_recipient_is_payer"], false, "{body}");
    assert_eq!(shown["recipient"]["name"], "Anna Muster", "{body}");
    // Nothing of section 7 is written onto the declaration.
    let column: Option<String> =
        sqlx::query_scalar("SELECT invoice_to FROM lead_payer_declarations WHERE lead_id = $1")
            .bind(lead_id)
            .fetch_one(pool)
            .await
            .unwrap();
    assert_eq!(column, None);
    let before = audit_count(pool, "lead_portal_update_billing", lead_id).await;
    let (status, body) = json_request(
        router,
        "POST",
        &billing,
        &patient,
        Some(json!({
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
    assert_eq!(shown["account_country"], "DE", "{body}");
    assert_eq!(shown["via_third_party"], true, "{body}");
    assert_eq!(shown["payment_route_by"], "patient", "{body}");
    // The recipient's country is still missing.
    assert_eq!(
        missing_for_the_billing(&body),
        ["recipient_country"],
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
             -- The same save audits the invoice recipient apart, with the
             -- same time: the billing event is the one without that source.
             AND context->>'source' IS DISTINCT FROM 'invoice_recipient'
           ORDER BY created_at DESC, id DESC LIMIT 1"#,
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
        Some(json!({ "account_country": "DE" })),
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
    // Block C's expected total is no longer asked (owner 2026-10-12,
    // 2026-10-23): a value sent by an older client is dropped; staff see
    // only an answer stored before (read-only).
    assert!(seen["expected_total_eur"].is_null(), "{staff}");
    let (status, body) = json_request(
        router,
        "POST",
        &billing,
        &patient,
        Some(json!({ "expected_total_eur": 6000 })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert!(
        body["billing"].get("expected_total_eur").is_none(),
        "{body}"
    );
    let (_, staff) = json_request(router, "GET", &intake, &manager, None).await;
    assert!(staff["billing"]["expected_total_eur"].is_null(), "{staff}");
    sqlx::query("UPDATE lead_payer_declarations SET expected_total_eur = 6000 WHERE lead_id = $1")
        .bind(lead_id)
        .execute(pool)
        .await
        .unwrap();
    let (_, staff) = json_request(router, "GET", &intake, &manager, None).await;
    assert_eq!(staff["billing"]["expected_total_eur"], "6000.00", "{staff}");
    let (status, concierge) =
        json_request(router, "GET", &intake, &app.staff("concierge"), None).await;
    assert_eq!(status, StatusCode::OK, "{concierge}");
    assert!(concierge["billing"].is_null(), "{concierge}");
    assert!(concierge["billing_updated_at"].is_null(), "{concierge}");

    // Cryptocurrency is no longer offered (owner 2026-10-12).
    let (status, body) = json_request(
        router,
        "POST",
        &billing,
        &patient,
        Some(json!({ "payment_method": "crypto" })),
    )
    .await;
    assert!(status.is_client_error(), "{status} {body}");

    // Cash and other methods are flagged; "to me" drops the other address
    // and keeps the e-mail named with it; `null` clears; "no" drops the
    // description.
    let (status, body) = json_request(
        router,
        "POST",
        &billing,
        &patient,
        Some(json!({
            "invoice_recipient": "self",
            "invoice_recipient_is_payer": true,
            "recipient_email": "rechnung@example.com",
            "payment_method": "other",
            "payment_method_details": "Scheck",
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
        json!(["other_method"]),
        "{staff}"
    );
    let (status, body) = json_request(
        router,
        "POST",
        &billing,
        &patient,
        Some(json!({ "payment_method": "cash", "recipient_email": null })),
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
        Some(json!({ "payment_method": "bank_transfer" })),
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
        // Viktor receives the invoice and pays it: "to the payer".
        Some(json!({
            "invoice_recipient": "third_party",
            "invoice_recipient_is_payer": true,
            "recipient_type": "person",
            "recipient_first_name": "Viktor",
            "recipient_last_name": "Zahler",
            "recipient_street": "Ringstr. 9",
            "recipient_zip": "1010",
            "recipient_city": "Wien",
            "recipient_country": "AT",
            "recipient_email": "rechnung@example.com",
            "recipient_relationship_kind": "friend"
        })),
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
        // The payment route (section 8) is follow-up block C since the trigger
        // flow (2026-10-07); the recipient named as payer no longer is it
        // (step 3, 2026-10-11): its confirmation is the open answer.
        ["invoice_recipient_is_payer"],
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

/// The keys of step 3 in `progress.missing_for_submit`: the invoice
/// recipient, who pays and the payment method.
fn missing_for_step_three(body: &Value) -> Vec<&str> {
    body["progress"]["missing_for_submit"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(Value::as_str)
        .filter(|key| {
            key.starts_with("invoice_")
                || key.starts_with("recipient_")
                || key.starts_with("payer_")
                || *key == "payment_method"
        })
        .collect()
}

#[tokio::test]
async fn step_three_asks_the_invoice_recipient_first_and_derives_section_seven() {
    let Some(app) = test_app().await else { return };
    let router = &app.suite.app;
    let pool = &app.suite.pool;
    let (lead_id, _, patient) = lead_with_login(&app, "Rita", "rita.recipient@example.com").await;
    let request = format!("/api/v1/me/lead-requests/{lead_id}");
    let billing = format!("{request}/billing");
    let payer = format!("{request}/payer");
    let manager = app.staff("patient_manager");
    let save = |body: Value| {
        let (router, billing, patient) = (router.clone(), billing.clone(), patient.clone());
        async move {
            let (status, answer) =
                json_request(&router, "POST", &billing, &patient, Some(body)).await;
            assert_eq!(status, StatusCode::OK, "{answer}");
            answer
        }
    };

    // Nothing answered: who receives the invoice comes first, no payer key.
    let (_, body) = json_request(router, "GET", &request, &patient, None).await;
    assert_eq!(
        missing_for_step_three(&body),
        ["invoice_recipient"],
        "{body}"
    );
    assert_eq!(
        body["progress"]["missing_by_step"]["billing"],
        json!(["invoice_recipient"]),
        "{body}"
    );
    assert!(
        body["progress"]["missing_by_step"].get("payer").is_none(),
        "{body}"
    );

    // A refused value names its key.
    for (refused, field) in [
        (
            json!({ "invoice_recipient": "insurer" }),
            "invoice_recipient",
        ),
        (
            json!({ "invoice_recipient_is_payer": "yes" }),
            "invoice_recipient_is_payer",
        ),
        (json!({ "recipient_type": "insurance" }), "recipient_type"),
        (
            json!({ "recipient_country": "Germany" }),
            "recipient_country",
        ),
        (
            json!({ "recipient_email": "no-at-sign" }),
            "recipient_email",
        ),
    ] {
        let (status, error) = json_request(router, "POST", &billing, &patient, Some(refused)).await;
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{error}");
        assert_eq!(error["field"], field, "{error}");
    }

    // A third party receives the invoice: answered before anybody pays.
    // "The recipient is also the payer" is ticked by default (owner
    // 2026-10-11): the recipient's own fields and confirmation are actionable;
    // a separate hidden "who pays" field must not block the form.
    let body = save(json!({ "invoice_recipient": "third_party" })).await;
    assert_eq!(
        body["billing"]["invoice_recipient"], "third_party",
        "{body}"
    );
    assert_eq!(
        body["billing"]["invoice_recipient_is_payer"], true,
        "{body}"
    );
    assert_eq!(
        missing_for_step_three(&body),
        [
            "recipient_type",
            "recipient_street",
            "recipient_zip",
            "recipient_city",
            "recipient_country",
            "invoice_recipient_is_payer"
        ],
        "{body}"
    );
    // Clearing the answer keeps the default while a recipient is chosen.
    let body = save(json!({ "invoice_recipient_is_payer": null })).await;
    assert_eq!(
        body["billing"]["invoice_recipient_is_payer"], true,
        "{body}"
    );
    // Unticked: the third party's data count.
    let body = save(json!({ "invoice_recipient_is_payer": false })).await;
    assert_eq!(
        missing_for_step_three(&body),
        [
            "recipient_type",
            "recipient_street",
            "recipient_zip",
            "recipient_city",
            "recipient_country",
            "payer_kind"
        ],
        "{body}"
    );
    // An organisation that does not pay: its data and why the invoice goes through it.
    let body = save(json!({
        "recipient_type": "organisation",
        "recipient_organisation_name": " Beispiel GmbH ",
        "recipient_legal_form": "GmbH",
        "recipient_contact_name": "Ben Muster",
        "recipient_street": "Hauptstraße 1",
        "recipient_zip": "10115",
        "recipient_city": "Berlin",
        "recipient_country": "de",
        "recipient_email": "rechnung@example.com",
        "recipient_payment_reason": "Der Arbeitgeber erhält die Rechnung.",
        "invoice_recipient_is_payer": false
    }))
    .await;
    let recipient = &body["billing"]["recipient"];
    assert_eq!(recipient["name"], "Beispiel GmbH", "{body}");
    assert_eq!(recipient["country"], "DE", "{body}");
    assert_eq!(
        body["billing"]["invoice_recipient_is_payer"], false,
        "{body}"
    );
    // Who pays is asked now; nobody is named yet, so section 7 waits.
    assert_eq!(missing_for_step_three(&body), ["payer_kind"], "{body}");
    assert!(body["billing"]["invoice_to"].is_null(), "{body}");

    // The patient pays: section 7 names the organisation at its address.
    let (status, body) = json_request(
        router,
        "POST",
        &payer,
        &patient,
        Some(json!({ "payer_kind": "self" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let shown = &body["billing"];
    assert_eq!(shown["invoice_to"], "other", "{body}");
    assert_eq!(shown["invoice_name"], "Beispiel GmbH", "{body}");
    assert_eq!(shown["invoice_city"], "Berlin", "{body}");
    assert_eq!(shown["invoice_country"], "DE", "{body}");
    assert_eq!(shown["invoice_email"], "rechnung@example.com", "{body}");
    assert_eq!(missing_for_step_three(&body), ["payment_method"], "{body}");

    // The recipient pays after all: the server names the organisation as the
    // payer at once (owner decision 2026-10-23), section 7 goes "to the
    // payer" and no separate "who pays" answer is open.
    let body = save(json!({ "invoice_recipient_is_payer": true })).await;
    assert_eq!(body["billing"]["invoice_to"], "payer", "{body}");
    assert_eq!(body["payer"]["payer_kind"], "third_party", "{body}");
    assert_eq!(
        body["payer"]["organisation_name"], "Beispiel GmbH",
        "{body}"
    );
    // The reason of a paying organisation is the payer's (`payment_background`).
    assert!(
        body["billing"]["recipient"]["payment_reason"].is_null(),
        "{body}"
    );
    assert!(
        !missing_for_step_three(&body).contains(&"invoice_recipient_is_payer"),
        "{body}"
    );
    assert!(
        !missing_for_step_three(&body).contains(&"payer_kind"),
        "{body}"
    );
    // The cabinet adds what GMED needs of the payer besides: section 7 stays
    // "to the payer".
    let (status, body) = json_request(
        router,
        "POST",
        &payer,
        &patient,
        Some(json!({
            "payer_kind": "third_party",
            "payer_type": "organisation",
            "organisation_name": "Beispiel GmbH",
            "organisation_legal_form": "GmbH",
            "organisation_contact_name": "Ben Muster",
            "street": "Hauptstraße 1",
            "zip": "10115",
            "city": "Berlin",
            "country": "DE",
            "email": "rechnung@example.com",
            "contact_consent": true
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["billing"]["invoice_to"], "payer", "{body}");
    assert!(body["billing"]["invoice_name"].is_null(), "{body}");
    // An organisation needs no relationship; its reason is optional.
    assert_eq!(
        missing_for_step_three(&body),
        ["payer_cost_estimate_consent"],
        "{body}"
    );

    // The patient receives the invoice and a third party pays.
    let body = save(json!({
        "invoice_recipient": "self",
        "invoice_recipient_is_payer": false,
        "recipient_email": "rita.rechnung@example.com"
    }))
    .await;
    assert_eq!(body["billing"]["invoice_to"], "self", "{body}");
    assert_eq!(
        body["billing"]["invoice_email"], "rita.rechnung@example.com",
        "{body}"
    );
    assert!(
        body["billing"]["recipient"]["organisation_name"].is_null(),
        "{body}"
    );
    assert!(
        !missing_for_step_three(&body).contains(&"payer_kind"),
        "{body}"
    );
    // "I receive and pay it": the patient is the payer at once.
    let body = save(json!({ "invoice_recipient_is_payer": true })).await;
    assert_eq!(body["payer"]["payer_kind"], "self", "{body}");
    assert_eq!(body["billing"]["invoice_to"], "self", "{body}");
    let open = missing_for_step_three(&body);
    assert!(!open.contains(&"payer_kind"), "{body}");
    assert!(!open.contains(&"invoice_recipient_is_payer"), "{body}");

    // Staff see the answers "from the patient", with when they were given.
    let (status, intake) = json_request(
        router,
        "GET",
        &format!("/api/v1/leads/{lead_id}/portal-intake"),
        &manager,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{intake}");
    assert_eq!(intake["billing"]["invoice_recipient"], "self", "{intake}");
    assert_eq!(
        intake["billing"]["invoice_recipient_is_payer"], true,
        "{intake}"
    );
    assert!(
        intake["billing"]["recipient_updated_at"].is_string(),
        "{intake}"
    );

    // Audited by key, never by value; section 7's derived changes as billing.
    let contexts: Vec<Value> = sqlx::query_scalar(
        r#"SELECT context FROM audit_log
           WHERE action = 'lead_portal_update_invoice_recipient' AND entity_id = $1"#,
    )
    .bind(lead_id)
    .fetch_all(pool)
    .await
    .unwrap();
    assert!(!contexts.is_empty());
    for context in &contexts {
        assert!(!context.to_string().contains("Beispiel"), "{context}");
    }
    assert!(audit_count(pool, "lead_portal_update_billing", lead_id).await >= 1);
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
            "street": "Hauptstraße 1",
            "zip": "10115",
            "city": "Berlin",
            "country": "DE",
            "contact_consent": true
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["billing"]["payment_route_by"], "guardian", "{body}");
    // The mother is the paying representative, no third party: the invoice
    // does not go "to the payer" (owner decision 2026-10-19).
    assert_eq!(body["billing"]["payer_declared"], false, "{body}");
    assert_eq!(body["payer"]["payer_kind"], "representative", "{body}");
    assert_eq!(
        body["billing"]["account_holder_suggestion"], "Anna Muster",
        "{body}"
    );
    assert_eq!(
        missing_for_the_billing(&body),
        // The payment route (section 8) is follow-up block C since the trigger
        // flow (2026-10-07); the base form asks who receives the invoice
        // (step 3, 2026-10-11) and the bare payment method (owner 2026-10-10).
        ["invoice_recipient", "payment_method"],
        "{body}"
    );
    // Why "another person" pays is asked only in the extra step (owner rule
    // 2026-10-07): a parent is the first circle, and without the triggers of
    // the enhanced check neither login is asked it; the paying parent's own
    // login never is (QA 2026-10-06, B4).
    let asks_background = |body: &Value| {
        body["progress"]["missing_for_submit"]
            .as_array()
            .unwrap()
            .iter()
            .any(|key| key == "payment_background" || key == "enhanced_payment_background")
    };
    assert!(!asks_background(&body), "{body}");
    assert_eq!(body["follow_up"]["required"], false, "{body}");
    let (status, body) = json_request(router, "GET", &request, ben, None).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert!(!asks_background(&body), "{body}");
    assert_eq!(body["follow_up"]["required"], false, "{body}");
    assert_eq!(body["billing"]["payment_route_by"], "payer", "{body}");
    assert!(
        body["billing"]["account_holder_suggestion"].is_null(),
        "{body}"
    );
    assert_eq!(
        missing_for_the_billing(&body),
        ["invoice_recipient"],
        "{body}"
    );
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
    // Where the invoice goes is the request's answer: either parent. The
    // paying mother is chosen as the parent who receives it (she is the
    // contracting party, no third-party recipient; owner decision 2026-10-19).
    let (status, body) = json_request(
        router,
        "POST",
        &billing,
        ben,
        Some(json!({
            "invoice_recipient": "self",
            "invoice_recipient_is_payer": true,
            "recipient_representative_id": mother
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["billing"]["invoice_recipient"], "self", "{body}");
    assert_eq!(
        body["billing"]["recipient"]["representative_id"],
        json!(mother),
        "{body}"
    );
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
    // Anna remains the parent who receives the invoice (section 7 names her
    // address). Naming Ben as the paying representative must not silently
    // transfer her recipient identity; the recipient/payer choice needs review.
    assert_eq!(body["payer"]["payer_kind"], "representative", "{body}");
    assert_eq!(body["billing"]["invoice_to"], "other", "{body}");
    assert_eq!(body["billing"]["recipient"]["first_name"], "Anna", "{body}");
    assert!(
        missing_for_the_billing(&body).contains(&"invoice_recipient_is_payer"),
        "{body}"
    );
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
    // She is recorded as the paying representative (owner decision
    // 2026-10-19): never a payer's link.
    assert_eq!(info["blocked_reason"], "payer_is_representative", "{info}");
    assert_eq!(info["can_send"], false);
    let (status, refused) = json_request(router, "POST", &link, &pm, Some(json!({}))).await;
    assert_eq!(status, StatusCode::CONFLICT, "{refused}");
    assert_eq!(refused["code"], "payer_is_representative");
    // Without a trigger of the enhanced check the paying parent, the
    // contracting party, gets no payer questions (owner 2026-10-21).
    let (_, body) = json_request(router, "GET", &request, anna, None).await;
    assert!(body["payer_questionnaire"].is_null(), "{body}");
    // A black-list citizenship requires the enhanced check: then she answers them.
    sqlx::query("UPDATE leads SET citizenships = ARRAY['DE', 'KP'] WHERE id = $1")
        .bind(child)
        .execute(pool)
        .await
        .unwrap();
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
    // The birth data are block K and the identity data staff's (QA 2026-10-10):
    // they never hold the parent's section; the scan does.
    assert!(!missing.contains(&json!("birth_place")), "{body}");
    assert!(!missing.contains(&json!("birth_country")), "{body}");
    assert!(!missing.contains(&json!("id_document_number")), "{body}");
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
    // She is the paying representative (owner decision 2026-10-19): staff's
    // form names her by id; her data stay her representative row's.
    assert_eq!(current["payer_kind"], "representative", "{stored}");
    for key in [
        "payer_kind",
        "payer_representative_id",
        "acts_on_own_account",
    ] {
        form.insert(key.to_string(), current[key].clone());
    }
    form.insert("source_of_funds".into(), json!("employment"));
    let (status, saved) = json_request(
        router,
        "POST",
        &format!("/api/v1/leads/{child}/payer-declaration"),
        &pm,
        Some(Value::Object(form)),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{saved}");
    assert_eq!(
        saved["declaration"]["source_of_funds"], "employment",
        "{saved}"
    );
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

/// The follow-up blocks the cabinet shows and what each still misses.
fn follow_up_missing(body: &Value) -> Value {
    body["follow_up"]["missing"].clone()
}

async fn assert_country_preview_has_no_stored_assessment(pool: &PgPool, lead: Uuid) {
    let (assessments, events, submitted): (i64, i64, bool) = sqlx::query_as(
        r#"SELECT (SELECT count(*) FROM lead_risk_assessments WHERE lead_id=$1),
                  (SELECT count(*) FROM lead_risk_events WHERE lead_id=$1),
                  portal_submitted_at IS NOT NULL FROM leads WHERE id=$1"#,
    )
    .bind(lead)
    .fetch_one(pool)
    .await
    .unwrap();
    assert_eq!(
        (assessments, events, submitted),
        (0, 0, false),
        "a draft preview never starts, scores or ratchets an assessment"
    );
}

fn assert_neutral_country_preview(body: &Value) {
    assert_eq!(body["follow_up"]["required"], true, "{body}");
    assert_eq!(body["follow_up"]["before_submit"], true, "{body}");
    // A list-1 country alone is level 1: F only; A, K and L open with the
    // enhanced check (one level per lead, owner 2026-10-24).
    assert_eq!(body["follow_up"]["blocks"], json!(["F"]), "{body}");
    for key in ["pep_self", "pep_related", "sanctions_links"] {
        assert!(
            body["identification"][key].is_null(),
            "a country is not a positive legal answer: {body}"
        );
    }
    for block in ["A", "K", "L"] {
        assert!(
            body["follow_up"]["missing"].get(block).is_none(),
            "{block} waits for the enhanced check: {body}"
        );
    }
    for key in ["points", "level", "triggers", "reasons"] {
        assert!(
            body["follow_up"].get(key).is_none(),
            "internal assessment data stays out of the preview: {body}"
        );
    }
}

#[tokio::test]
async fn a_listed_citizenship_or_residence_previews_questions_before_submission_and_reverts_without_history()
 {
    let Some(app) = test_app().await else { return };
    let router = &app.suite.app;
    let pool = &app.suite.pool;
    for (index, patch) in [
        json!({ "citizenships": ["RU"], "country": "DE" }),
        json!({ "citizenships": ["DE"], "country": "RU" }),
    ]
    .into_iter()
    .enumerate()
    {
        let (lead, _, patient) = lead_with_login(
            &app,
            &format!("CountryPreview{index}"),
            &format!("country.preview.{index}@example.com"),
        )
        .await;
        let request = format!("/api/v1/me/lead-requests/{lead}");
        let personal = format!("{request}/personal-data");
        let (status, body) = json_request(router, "POST", &personal, &patient, Some(patch)).await;
        assert_eq!(status, StatusCode::OK, "{body}");
        assert_neutral_country_preview(&body);
        assert_eq!(
            body["follow_up"]["funds_asked"], false,
            "no source of funds below level 2: {body}"
        );
        assert_country_preview_has_no_stored_assessment(pool, lead).await;
        let (status, read) = json_request(router, "GET", &request, &patient, None).await;
        assert_eq!(status, StatusCode::OK, "{read}");
        assert_neutral_country_preview(&read);
        assert_country_preview_has_no_stored_assessment(pool, lead).await;
        let (status, staff) = json_request(
            router,
            "GET",
            &format!("/api/v1/leads/{lead}/risk-assessment"),
            &app.staff("patient_manager"),
            None,
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{staff}");
        assert_eq!(staff["before_submit"], true, "{staff}");
        for key in ["points", "patient_points", "payer_points", "level"] {
            assert!(
                staff[key].is_null(),
                "a question preview is not a persisted score: {staff}"
            );
        }
        assert_eq!(staff["triggers"], json!([]), "{staff}");
        assert_eq!(staff["blocks"]["F"]["open"], true, "{staff}");
        // A, K and L wait for level 2 (one level per lead, owner 2026-10-24).
        for block in ["A", "G", "H", "I", "J", "K", "L"] {
            assert_eq!(staff["blocks"][block]["open"], false, "{staff}");
        }
        assert_country_preview_has_no_stored_assessment(pool, lead).await;
        let (status, cleared) = json_request(
            router,
            "POST",
            &personal,
            &patient,
            Some(json!({ "citizenships": ["DE"], "country": "DE" })),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{cleared}");
        assert_eq!(cleared["follow_up"]["required"], false, "{cleared}");
        assert_eq!(cleared["follow_up"]["before_submit"], false, "{cleared}");
        assert_eq!(cleared["follow_up"]["blocks"], json!([]), "{cleared}");
        assert_country_preview_has_no_stored_assessment(pool, lead).await;
    }
}

#[tokio::test]
async fn country_preview_uses_configured_lists_and_opens_legal_details_only_after_an_explicit_yes()
{
    let Some(app) = test_app().await else { return };
    let router = &app.suite.app;
    let pool = &app.suite.pool;
    let (lead, _, patient) =
        lead_with_login(&app, "ConfiguredCountry", "configured.country@example.com").await;
    let request = format!("/api/v1/me/lead-requests/{lead}");
    let personal = format!("{request}/personal-data");
    let config = gmed_server::risk::RiskConfig {
        list_1: vec!["CA".into()],
        list_2: Vec::new(),
        ..Default::default()
    };
    sqlx::query("INSERT INTO system_settings(key,value) VALUES('risk_assessment_config',$1) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value")
        .bind(json!(config)).execute(pool).await.unwrap();
    let (status, excluded) = json_request(
        router,
        "POST",
        &personal,
        &patient,
        Some(json!({ "citizenships": ["RU"], "country": "DE" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{excluded}");
    assert_eq!(
        excluded["follow_up"]["required"], false,
        "countries are not hardcoded: {excluded}"
    );
    let (status, included) = json_request(
        router,
        "POST",
        &personal,
        &patient,
        Some(json!({ "citizenships": ["CA"], "country": "DE" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{included}");
    assert_neutral_country_preview(&included);
    let (status, positive) = json_request(
        router,
        "POST",
        &format!("{request}/identification"),
        &patient,
        Some(json!({ "pep_self": true, "pep_related": false, "sanctions_links": true })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{positive}");
    assert_eq!(
        positive["follow_up"]["blocks"],
        json!(["A", "F", "H", "J", "K", "L"]),
        "{positive}"
    );
    assert!(
        positive["follow_up"]["missing"]["H"]
            .as_array()
            .unwrap()
            .contains(&json!("pep_office")),
        "{positive}"
    );
    assert!(
        positive["follow_up"]["missing"]["J"]
            .as_array()
            .unwrap()
            .contains(&json!("sanctions_link_name")),
        "{positive}"
    );
    let (status, corrected) = json_request(
        router,
        "POST",
        &format!("{request}/identification"),
        &patient,
        Some(json!({ "pep_self": false, "pep_related": false, "sanctions_links": false })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{corrected}");
    // Without the knock-out the list-1 country is level 1 again: F only
    // (one level per lead, owner 2026-10-24).
    assert_eq!(
        corrected["follow_up"]["blocks"],
        json!(["F"]),
        "{corrected}"
    );
    assert_country_preview_has_no_stored_assessment(pool, lead).await;
}

#[tokio::test]
async fn country_preview_blocks_first_submission_until_answers_are_complete_without_raising_the_country_score()
 {
    let Some(app) = test_app().await else { return };
    let router = &app.suite.app;
    let pool = &app.suite.pool;
    let (lead, _, patient) =
        lead_with_login(&app, "CountrySubmit", "country.first.submit@example.com").await;
    let request = format!("/api/v1/me/lead-requests/{lead}");
    fill_in_complete_request(router, lead, &patient).await;
    // The helper's legacy fixture contains legal/birth answers; this request
    // has not answered those additional questions yet.
    sqlx::query("UPDATE lead_gwg_declarations SET pep_self=NULL,pep_related=NULL,sanctions_links=NULL,birth_place=NULL,birth_country=NULL WHERE lead_id=$1")
        .bind(lead).execute(pool).await.unwrap();
    let (status, preview) = json_request(
        router,
        "POST",
        &format!("{request}/personal-data"),
        &patient,
        Some(json!({ "citizenships": ["RU"], "country": "DE" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{preview}");
    assert_neutral_country_preview(&preview);
    // A list-1 country alone stays below level 2: no source of funds, no
    // profession or sector (block A), no birth data (K) and no legal questions
    // (L) — only the residence (F); one level per lead, owner 2026-10-24.
    assert!(
        preview["follow_up"]["missing"].get("A").is_none(),
        "no block A without the enhanced check: {preview}"
    );
    assert_eq!(preview["follow_up"]["funds_asked"], false, "{preview}");
    let (status, refused) = json_request(
        router,
        "POST",
        &format!("{request}/submit"),
        &patient,
        declared(),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{refused}");
    assert_eq!(refused["code"], "follow_up_incomplete", "{refused}");
    assert_eq!(refused["before_submit"], true, "{refused}");
    assert!(
        refused["missing"]["F"]
            .as_array()
            .unwrap()
            .contains(&json!("residence_since")),
        "{refused}"
    );
    assert!(
        refused["missing"].get("L").is_none(),
        "the legal questions wait for level 2: {refused}"
    );
    assert_country_preview_has_no_stored_assessment(pool, lead).await;
    let (status, body) = json_request(
        router,
        "POST",
        &format!("{request}/enhanced-details"),
        &patient,
        Some(
            json!({ "funds_source": "income", "funds_description": "Synthetic salary",
            "occupation": "Engineer", "sector": "Manufacturing" }),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let (status, body) = json_request(
        router,
        "POST",
        &format!("{request}/identification"),
        &patient,
        Some(
            json!({ "pep_self": false, "pep_related": false, "sanctions_links": false,
            "birth_place": "Synthetic City", "birth_country": "DE", "residence_since": "2010",
            "stay_reason": "work" }),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let (status, complete) = upload_file(
        router,
        &format!("{request}/funds-proof"),
        &patient,
        "synthetic-income.pdf",
        "application/pdf",
        PDF,
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{complete}");
    for (block, missing) in complete["follow_up"]["missing"].as_object().unwrap() {
        assert_eq!(missing, &json!([]), "{block}: {complete}");
    }
    assert_country_preview_has_no_stored_assessment(pool, lead).await;
    let (status, sent) = json_request(
        router,
        "POST",
        &format!("{request}/submit"),
        &patient,
        declared(),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{sent}");
    assert_eq!(sent["follow_up"]["before_submit"], false, "{sent}");
    assert!(
        sent["follow_up"]["answered_at"].is_string(),
        "one send records the completed follow-up: {sent}"
    );
    let (points, level, knockout, triggers): (i32, i16, bool, Value) = sqlx::query_as(
        "SELECT points,level,knockout,triggers FROM lead_risk_assessments WHERE lead_id=$1",
    )
    .bind(lead)
    .fetch_one(pool)
    .await
    .unwrap();
    assert_eq!(
        (points, level, knockout),
        (2, 1, false),
        "country questions do not force a higher score: {triggers}"
    );
    assert_eq!(triggers.as_array().unwrap().len(), 1, "{triggers}");
    assert_eq!(triggers[0]["key"], "T1", "{triggers}");
    let answered: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM lead_risk_events WHERE lead_id=$1 AND kind='follow_up_answered'",
    )
    .bind(lead)
    .fetch_one(pool)
    .await
    .unwrap();
    assert_eq!(answered, 1);
    let (status, changed) = json_request(
        router,
        "POST",
        &format!("{request}/personal-data"),
        &patient,
        Some(json!({ "citizenships": ["DE"] })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{changed}");
    // F only at level 1 (one level per lead, owner 2026-10-24).
    assert_eq!(
        changed["follow_up"]["blocks"],
        json!(["F"]),
        "after submission the stored ratchet stays: {changed}"
    );
    for key in ["pep_self", "pep_related", "sanctions_links"] {
        assert_eq!(
            changed["identification"][key], false,
            "a country does not invent a positive answer: {changed}"
        );
    }
    let stored: Value =
        sqlx::query_scalar("SELECT triggers FROM lead_risk_assessments WHERE lead_id=$1")
            .bind(lead)
            .fetch_one(pool)
            .await
            .unwrap();
    assert_eq!(stored[0]["key"], "T1", "{stored}");
    assert_eq!(stored[0]["active"], false, "{stored}");
}

#[tokio::test]
async fn a_post_submission_country_change_holds_guarded_actions_only_until_its_answers_are_complete()
 {
    let Some(app) = test_app().await else { return };
    let router = &app.suite.app;
    let pool = &app.suite.pool;
    // Isolate the configured country-question gate from the separate CEO
    // country-block policy (which already blocks RU before this middleware).
    let config = gmed_server::risk::RiskConfig {
        list_1: vec!["CA".into()],
        list_2: Vec::new(),
        ..Default::default()
    };
    sqlx::query("INSERT INTO system_settings(key,value) VALUES('risk_assessment_config',$1) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value")
        .bind(json!(config)).execute(pool).await.unwrap();
    let (lead, _, patient) = lead_with_login(
        &app,
        "CountryEdited",
        "country.edited.after.submit@example.com",
    )
    .await;
    let request = format!("/api/v1/me/lead-requests/{lead}");
    fill_in_complete_request(router, lead, &patient).await;
    let (status, sent) = json_request(
        router,
        "POST",
        &format!("{request}/submit"),
        &patient,
        declared(),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{sent}");
    assert_eq!(sent["follow_up"]["required"], false, "{sent}");
    let (status, pending) = json_request(
        router,
        "POST",
        &format!("{request}/personal-data"),
        &patient,
        Some(json!({ "citizenships": ["CA"] })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{pending}");
    assert_eq!(pending["follow_up"]["before_submit"], false, "{pending}");
    // A list-1 country is level 1: the residence (F) is asked, nothing of the
    // enhanced check (A, K, L) — one level per lead, owner 2026-10-24.
    assert_eq!(pending["follow_up"]["blocks"], json!(["F"]), "{pending}");
    let (points, level, risk_status): (i32, i16, String) =
        sqlx::query_as("SELECT points,level,status FROM lead_risk_assessments WHERE lead_id=$1")
            .bind(lead)
            .fetch_one(pool)
            .await
            .unwrap();
    assert_eq!(
        (points, level, risk_status.as_str()),
        (2, 1, "awaiting_answers")
    );
    let qualify = format!("/api/v1/leads/{lead}/qualify");
    let (status, held) = json_request(
        router,
        "POST",
        &qualify,
        &app.staff("patient_manager"),
        Some(json!({ "status": "qualified" })),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{held}");
    assert_eq!(
        held["code"], "risk_review_required",
        "new country answers cannot be bypassed by qualification: {held}"
    );
    // The residence alone completes the follow-up: no source of funds, no
    // proof, no birth data and no legal questions at level 1.
    let (status, complete) = json_request(
        router,
        "POST",
        &format!("{request}/identification"),
        &patient,
        Some(json!({ "residence_since": "2010", "stay_reason": "work" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{complete}");
    assert_eq!(
        complete["follow_up"]["missing"],
        json!({ "F": [] }),
        "{complete}"
    );
    let (points, level, risk_status): (i32, i16, String) =
        sqlx::query_as("SELECT points,level,status FROM lead_risk_assessments WHERE lead_id=$1")
            .bind(lead)
            .fetch_one(pool)
            .await
            .unwrap();
    assert_eq!(
        (points, level, risk_status.as_str()),
        (2, 1, "clear"),
        "completed answers unblock without a score/level change"
    );
    let (_, unheld) = json_request(
        router,
        "POST",
        &qualify,
        &app.staff("patient_manager"),
        Some(json!({ "status": "qualified" })),
    )
    .await;
    assert_ne!(
        unheld["code"], "risk_review_required",
        "other qualification prerequisites are separate: {unheld}"
    );
}

#[tokio::test]
async fn a_black_list_citizenship_opens_follow_up_blocks_without_telling_why() {
    let Some(app) = test_app().await else { return };
    let router = &app.suite.app;
    let pool = &app.suite.pool;
    let (lead_id, _, patient) = lead_with_login(&app, "Mia", "mia.extra@example.com").await;
    let request = format!("/api/v1/me/lead-requests/{lead_id}");
    let enhanced = format!("{request}/enhanced-details");
    let funds_proof = format!("{request}/funds-proof");
    let submit = format!("{request}/submit");
    let follow_up_submit = format!("{request}/follow-up/submit");
    let intake_path = format!("/api/v1/leads/{lead_id}/portal-intake");
    let ceo_id = seed_user(&app.suite.pool, "lead-portal-risk", "ceo").await;
    let ceo = bearer(ceo_id, "ceo");

    let (status, body) = json_request(router, "POST", &follow_up_submit, &patient, None).await;
    assert_eq!(status, StatusCode::CONFLICT, "{body}");
    assert_eq!(body["code"], "follow_up_not_requested");
    // No funds question before the answer who pays.
    let (status, body) = json_request(
        router,
        "POST",
        &enhanced,
        &patient,
        Some(json!({ "funds_source": "savings" })),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{body}");
    assert_eq!(body["code"], "payer_not_declared", "{body}");

    // A complete self-paying request: nothing is scored before the send, so
    // there is nothing more to add; the extra step of 2026-10-07 is gone.
    let body = fill_in_complete_request(router, lead_id, &patient).await;
    assert_eq!(body["follow_up"]["required"], false, "{body}");
    assert!(body.get("enhanced_check").is_none(), "{body}");
    assert!(body.get("extra_questions").is_none(), "{body}");
    assert!(body.get("self_funds").is_none(), "{body}");
    let (status, body) = json_request(router, "POST", &submit, &patient, declared()).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["review_notice"], true, "{body}");
    assert_eq!(body["follow_up"]["required"], false, "{body}");

    // A black-list citizenship: block F appears at once — and nothing about
    // why.
    let (status, body) = json_request(
        router,
        "POST",
        &format!("{request}/personal-data"),
        &patient,
        Some(json!({ "citizenships": ["DE", "KP"] })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["follow_up"]["required"], true, "{body}");
    // Level 2 also opens the birth data (K) and the legal questions (L), owner 2026-10-09,
    // and the source of funds (A), QA 2026-10-10.
    assert_eq!(
        body["follow_up"]["blocks"],
        json!(["A", "F", "K", "L"]),
        "{body}"
    );
    assert_eq!(
        follow_up_missing(&body),
        json!({
            "A": [
                "funds_source",
                "occupation",
                "sector",
                "funds_proof_upload"
            ],
            "F": ["residence_since", "stay_reason"],
            "K": [],
            "L": []
        }),
        "{body}"
    );
    let whole = body.to_string();
    for word in [
        "\"reasons\"",
        "\"countries\"",
        "_blacklist",
        "patient_sanctioned",
        "\"level\"",
        "\"points\"",
        "list_2",
    ] {
        assert!(!whole.contains(word), "{word}: {whole}");
    }
    // The request itself stays sent; the base form misses nothing.
    assert_eq!(body["progress"]["missing_for_submit"], json!([]), "{body}");

    // Staff ask for the source of funds (block A).
    let (status, decided) = json_request(
        router,
        "POST",
        &format!("/api/v1/leads/{lead_id}/risk-assessment/decisions"),
        &ceo,
        Some(json!({
            "decision": "request_more",
            "reason": "Please state the source of the funds",
            "blocks": ["A"]
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{decided}");
    let (status, body) = json_request(router, "GET", &request, &patient, None).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(
        body["follow_up"]["blocks"],
        json!(["A", "F", "K", "L"]),
        "{body}"
    );
    assert_eq!(
        follow_up_missing(&body)["A"],
        json!(["funds_source", "occupation", "sector", "funds_proof_upload"]),
        "{body}"
    );
    assert_eq!(
        body["follow_up"]["funds_source_options"],
        json!([
            "income",
            "savings",
            "asset_sale",
            "inheritance_gift",
            "other"
        ]),
        "{body}"
    );
    let (status, refused) = json_request(router, "POST", &follow_up_submit, &patient, None).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{refused}");
    assert_eq!(refused["code"], "follow_up_incomplete", "{refused}");

    // Refused values name their key.
    for (patch, field) in [
        (json!({ "funds_source": "employment" }), "funds_source"),
        (json!({ "funds_source": "income,savings" }), "funds_source"),
        (
            json!({ "funds_description": "x".repeat(2001) }),
            "funds_description",
        ),
        (json!({ "occupation": "x".repeat(201) }), "occupation"),
        (json!({ "sector": "x".repeat(201) }), "sector"),
        (
            json!({ "self_funds_sources": ["savings"] }),
            "self_funds_sources",
        ),
        (
            json!({ "payment_background": "Weil" }),
            "payment_background",
        ),
        (json!({ "occupation": 5 }), "body"),
    ] {
        let (status, body) = json_request(router, "POST", &enhanced, &patient, Some(patch)).await;
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
        assert_eq!(body["code"], "invalid_field", "{body}");
        assert_eq!(body["field"], field, "{body}");
    }
    // What the patient knows of a payer's funds needs a third party.
    let (status, body) = json_request(
        router,
        "POST",
        &enhanced,
        &patient,
        Some(json!({ "payer_funds_source": "savings" })),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{body}");
    assert_eq!(body["code"], "payer_not_third_party", "{body}");

    // The answers, only the changed keys; the audit names the keys only.
    let (status, body) = json_request(
        router,
        "POST",
        &enhanced,
        &patient,
        Some(json!({
            "funds_source": "income",
            "funds_description": " Gehalt als Lehrerin ",
            "occupation": "Lehrerin",
            "sector": "Bildung"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let answers = &body["follow_up"]["answers"];
    assert_eq!(answers["funds_source"], "income", "{body}");
    assert_eq!(
        answers["funds_description"], "Gehalt als Lehrerin",
        "{body}"
    );
    assert_eq!(answers["occupation"], "Lehrerin", "{body}");
    assert_eq!(answers["sector"], "Bildung", "{body}");
    assert_eq!(
        follow_up_missing(&body)["A"],
        json!(["funds_proof_upload"]),
        "{body}"
    );
    assert_eq!(
        audit_count(pool, "lead_portal_update_enhanced_details", lead_id).await,
        1
    );
    let context: Value = sqlx::query_scalar(
        r#"SELECT context FROM audit_log
           WHERE action = 'lead_portal_update_enhanced_details' AND entity_id = $1"#,
    )
    .bind(lead_id)
    .fetch_one(pool)
    .await
    .unwrap();
    assert_eq!(
        context["fields"],
        json!(["occupation", "sector", "funds_source", "funds_description"]),
        "{context}"
    );
    assert!(!context.to_string().contains("Lehrerin"), "{context}");
    let (status, _) = json_request(
        router,
        "POST",
        &enhanced,
        &patient,
        Some(json!({ "occupation": "Lehrerin" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        audit_count(pool, "lead_portal_update_enhanced_details", lead_id).await,
        1,
        "the same answer writes nothing"
    );

    // One or more proofs, PDF, JPG or PNG.
    let (status, body) = upload_file(
        router,
        &funds_proof,
        &patient,
        "auszug.txt",
        "text/plain",
        b"not a statement",
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
    assert_eq!(body["code"], "unsupported_file_type", "{body}");
    for (name, mime, bytes) in [
        ("kontoauszug.png", "image/png", PNG),
        ("gehaltsnachweis.pdf", "application/pdf", PDF),
    ] {
        let (status, body) = upload_file(router, &funds_proof, &patient, name, mime, bytes).await;
        assert_eq!(status, StatusCode::CREATED, "{body}");
    }
    let (status, body) = json_request(router, "GET", &request, &patient, None).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let proofs = body["follow_up"]["funds_proof_documents"]
        .as_array()
        .unwrap();
    assert_eq!(proofs.len(), 2, "{body}");
    assert_eq!(proofs[0]["can_delete"], true, "{body}");
    assert_eq!(body["documents"], json!([]), "{body}");
    assert_eq!(follow_up_missing(&body)["A"], json!([]), "{body}");
    let proof: Uuid = proofs[0]["id"].as_str().unwrap().parse().unwrap();
    let (art, category, kind): (String, String, String) = sqlx::query_as(
        r#"SELECT d.art, COALESCE(d.category, ''), u.kind
           FROM documents d JOIN lead_portal_uploads u ON u.document_id = d.id
           WHERE d.id = $1 AND d.lead_id = $2"#,
    )
    .bind(proof)
    .bind(lead_id)
    .fetch_one(pool)
    .await
    .unwrap();
    assert_eq!(
        (art.as_str(), category.as_str(), kind.as_str()),
        ("self_funds_proof", "finance", "self_funds_proof")
    );

    // Staff read the answers and the files in "Данные от пациента"; the
    // concierge gets none of it. The lead's statement counts as the
    // declaration's source of funds; level 2 requires the enhanced check.
    let (status, intake) = json_request(
        router,
        "GET",
        &intake_path,
        &app.staff("patient_manager"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{intake}");
    let staff_view = &intake["enhanced_details"];
    assert_eq!(staff_view["check_required"], true, "{intake}");
    assert_eq!(staff_view["answers"]["funds_source"], "income", "{intake}");
    assert_eq!(staff_view["answers"]["sector"], "Bildung", "{intake}");
    assert_eq!(
        staff_view["funds_proof_documents"]
            .as_array()
            .unwrap()
            .len(),
        2,
        "{intake}"
    );
    assert!(staff_view["updated_at"].is_string(), "{intake}");
    let (status, hidden) =
        json_request(router, "GET", &intake_path, &app.staff("concierge"), None).await;
    assert_eq!(status, StatusCode::OK, "{hidden}");
    assert!(hidden["enhanced_details"].is_null(), "{hidden}");
    assert_eq!(
        hidden["consents"],
        json!([]),
        "consent records are restricted: {hidden}"
    );
    let (status, declaration) = json_request(
        router,
        "GET",
        &format!("/api/v1/leads/{lead_id}/payer-declaration"),
        &app.staff("patient_manager"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{declaration}");
    assert_eq!(
        declaration["declaration"]["self_funds_source"], "income",
        "{declaration}"
    );

    // Block F answered: the follow-up goes to the manager. A citizen of the country has a
    // reason of its own and no details to write (QA 2026-10-10).
    let (status, body) = json_request(
        router,
        "POST",
        &format!("{request}/identification"),
        &patient,
        Some(json!({ "residence_since": "2015", "stay_reason": "citizenship_or_birth" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(
        body["identification"]["stay_reason"], "citizenship_or_birth",
        "{body}"
    );
    let (status, body) = json_request(router, "POST", &follow_up_submit, &patient, None).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert!(body["follow_up"]["answered_at"].is_string(), "{body}");
    let answered_at = body["follow_up"]["answered_at"].clone();
    let (status, repeated) = json_request(router, "POST", &follow_up_submit, &patient, None).await;
    assert_eq!(status, StatusCode::OK, "{repeated}");
    let marker_times: Value = sqlx::query_scalar(
        "SELECT jsonb_build_object('fields', l.portal_field_updates,
            'uploads', (SELECT jsonb_agg(jsonb_build_object('kind', u.kind,
                'created_at', u.created_at, 'withdrawn_at', u.withdrawn_at))
                FROM lead_portal_uploads u WHERE u.lead_id=l.id),
            'clock', clock_timestamp()) FROM leads l WHERE l.id=$1",
    )
    .bind(lead_id)
    .fetch_one(pool)
    .await
    .unwrap();
    assert_eq!(
        repeated["follow_up"]["answered_at"], answered_at,
        "first_follow_up={}; repeated_follow_up={}; marker_times={marker_times}",
        body["follow_up"], repeated["follow_up"]
    );
    let events: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM lead_risk_events WHERE lead_id=$1 AND kind='follow_up_answered'",
    )
    .bind(lead_id)
    .fetch_one(pool)
    .await
    .unwrap();
    assert_eq!(events, 1, "unchanged follow-up is idempotent");

    // Staff ask for block A once more, though the lead filled it (QA
    // 2026-10-24, C-8): the follow-up waits for the lead's send again — the
    // cabinet shows the block open with nothing missing in it and no answer
    // recorded, staff see the block as open and the assessment waits — until
    // the lead sends the follow-up once more.
    let risk_assessment = format!("/api/v1/leads/{lead_id}/risk-assessment");
    let (status, decided) = json_request(
        router,
        "POST",
        &format!("{risk_assessment}/decisions"),
        &ceo,
        Some(json!({
            "decision": "request_more",
            "reason": "Please check the source of the funds once more",
            "blocks": ["A"]
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{decided}");
    let (status, body) = json_request(router, "GET", &request, &patient, None).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["follow_up"]["required"], true, "{body}");
    assert!(body["follow_up"]["answered_at"].is_null(), "{body}");
    assert!(body["follow_up"]["requested_at"].is_string(), "{body}");
    assert!(
        body["follow_up"]["blocks"]
            .as_array()
            .unwrap()
            .contains(&json!("A")),
        "{body}"
    );
    assert_eq!(follow_up_missing(&body)["A"], json!([]), "{body}");
    assert!(!body.to_string().contains("follow_up_submit"), "{body}");
    let (status, assessment) = json_request(router, "GET", &risk_assessment, &ceo, None).await;
    assert_eq!(status, StatusCode::OK, "{assessment}");
    assert_eq!(assessment["status"], "awaiting_answers", "{assessment}");
    assert!(
        assessment["follow_up_answered_at"].is_null(),
        "{assessment}"
    );
    assert!(
        assessment["follow_up_requested_at"].is_string(),
        "{assessment}"
    );
    assert_eq!(assessment["blocks"]["A"]["answered"], false, "{assessment}");
    assert_eq!(
        assessment["blocks"]["A"]["missing"],
        json!(["follow_up_submit"]),
        "{assessment}"
    );
    // The lead sends again: the request is answered, the review is staff's.
    let (status, body) = json_request(router, "POST", &follow_up_submit, &patient, None).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert!(body["follow_up"]["answered_at"].is_string(), "{body}");
    let (_, assessment) = json_request(router, "GET", &risk_assessment, &ceo, None).await;
    assert_eq!(assessment["status"], "review_required", "{assessment}");
    assert_eq!(assessment["blocks"]["A"]["answered"], true, "{assessment}");
    assert!(
        assessment["follow_up_answered_at"].is_string(),
        "{assessment}"
    );
    let (status, queue) =
        json_request(router, "GET", "/api/v1/compliance/risk-reviews", &ceo, None).await;
    assert_eq!(status, StatusCode::OK, "{queue}");
    assert!(queue.to_string().contains(&lead_id.to_string()), "{queue}");

    let (status, body) = json_request(router, "POST", &submit, &patient, declared()).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    // Two sends, two audit rows; the second one counts the two proofs. The
    // rows are not told apart by `created_at` (two transactions can share an
    // instant under load), so look for the row with the count.
    let mut counted: Vec<Value> = Vec::new();
    for _ in 0..50 {
        counted = sqlx::query_scalar(
            r#"SELECT context FROM audit_log
               WHERE action = 'lead_portal_submit' AND entity_id = $1"#,
        )
        .bind(lead_id)
        .fetch_all(pool)
        .await
        .unwrap();
        if counted.len() >= 2
            && counted
                .iter()
                .any(|context| context["self_funds_documents"] == 2)
        {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    }
    assert_eq!(counted.len(), 2, "{counted:?}");
    assert!(
        counted
            .iter()
            .any(|context| context["self_funds_documents"] == 2),
        "{counted:?}"
    );

    // A third party pays after all: the own source goes.
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
            "relationship_kind": "parent",
            "citizenships": ["AT"]
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert!(
        body["follow_up"]["answers"]["funds_source"].is_null(),
        "{body}"
    );
    let stored: (Option<String>, Option<String>) = sqlx::query_as(
        "SELECT self_funds_source, self_funds_description FROM lead_payer_declarations WHERE lead_id = $1",
    )
    .bind(lead_id)
    .fetch_one(pool)
    .await
    .unwrap();
    assert_eq!(stored, (None, None));
    let (status, body) = upload(router, &funds_proof, &patient, PDF).await;
    assert_eq!(status, StatusCode::CONFLICT, "{body}");
    assert_eq!(body["code"], "payer_not_self", "{body}");
}

#[tokio::test]
async fn a_sister_who_pays_alone_asks_nothing_more() {
    let Some(app) = test_app().await else { return };
    let router = &app.suite.app;
    let (lead_id, _, patient) = lead_with_login(&app, "Anna", "anna.sister@example.com").await;
    let request = format!("/api/v1/me/lead-requests/{lead_id}");
    let payer = format!("{request}/payer");
    fill_in_complete_request(router, lead_id, &patient).await;
    someone_else_pays_the_patients_invoice(router, lead_id, &patient).await;
    let sister = json!({
        "payer_kind": "third_party",
        "payer_type": "person",
        "first_name": "Mia",
        "last_name": "Muster",
        "citizenships": ["AT"],
        "relationship_kind": "sibling",
        "email": "mia.muster@example.com",
        "phone": "+43 660 1234",
        "messenger": " +43 660 1234 ",
        "country": "AT",
        "city": "Wien",
        "contact_consent": true
    });
    let (status, body) = json_request(router, "POST", &payer, &patient, Some(sister.clone())).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    // The messenger number goes with the payer.
    assert_eq!(body["payer"]["messenger"], "+43 660 1234", "{body}");
    let (status, body) = json_request(
        router,
        "POST",
        &format!("{payer}/cost-estimate-consent"),
        &patient,
        Some(json!({ "consent": true })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    // A sister paying alone is T4 + T5 = 3 points, level 1 (contract 8): the
    // base form asks nothing more, and after the send nothing follows up.
    assert_eq!(body["progress"]["missing_for_submit"], json!([]), "{body}");
    assert_eq!(body["follow_up"]["required"], false, "{body}");
    // What the patient knows of her funds may still be stated.
    let (status, body) = json_request(
        router,
        "POST",
        &format!("{request}/enhanced-details"),
        &patient,
        Some(json!({
            "payer_funds_source": "savings",
            "payer_funds_description": "Ersparnisse aus ihrem Gehalt"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let (status, intake) = json_request(
        router,
        "GET",
        &format!("/api/v1/leads/{lead_id}/portal-intake"),
        &app.staff("patient_manager"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{intake}");
    assert_eq!(
        intake["enhanced_details"]["answers"]["payer_funds_source"], "savings",
        "{intake}"
    );
    assert_eq!(
        intake["enhanced_details"]["check_required"], false,
        "{intake}"
    );
    // An older cabinet leaves the messenger out: it stays.
    let mut older = sister.clone();
    older.as_object_mut().unwrap().remove("messenger");
    let (status, body) = json_request(router, "POST", &payer, &patient, Some(older)).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["payer"]["messenger"], "+43 660 1234", "{body}");
    let (status, body) = json_request(
        router,
        "POST",
        &format!("{request}/submit"),
        &patient,
        declared(),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["follow_up"]["required"], false, "{body}");
    assert_eq!(body["review_notice"], true, "{body}");
}

/// QA 2026-10-10 (C2-c): follow-up blocks the lead completed before "send to
/// the manager" are sent with it — no second "send the details". A send while
/// a block still misses something leaves the follow-up open.
#[tokio::test]
async fn sending_the_request_also_sends_follow_up_blocks_that_are_complete() {
    let Some(app) = test_app().await else { return };
    let router = &app.suite.app;
    let pool = &app.suite.pool;
    let (lead_id, _, patient) = lead_with_login(&app, "Ben", "ben.followup@example.com").await;
    let request = format!("/api/v1/me/lead-requests/{lead_id}");
    let submit = format!("{request}/submit");
    fill_in_complete_request(router, lead_id, &patient).await;
    let (status, body) = json_request(router, "POST", &submit, &patient, declared()).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["follow_up"]["required"], false, "{body}");

    // A black-list citizenship opens A and F (K and L are answered already).
    let (status, body) = json_request(
        router,
        "POST",
        &format!("{request}/personal-data"),
        &patient,
        Some(json!({ "citizenships": ["DE", "KP"] })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["follow_up"]["required"], true, "{body}");
    assert!(body["follow_up"]["answered_at"].is_null(), "{body}");

    // Sent again while A and F miss something: the follow-up stays open.
    let (status, body) = json_request(router, "POST", &submit, &patient, declared()).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert!(body["follow_up"]["answered_at"].is_null(), "{body}");
    assert_ne!(follow_up_missing(&body)["A"], json!([]), "{body}");

    // The lead completes the blocks without pressing "send the details".
    let (status, body) = json_request(
        router,
        "POST",
        &format!("{request}/enhanced-details"),
        &patient,
        Some(json!({
            "funds_source": "income",
            "funds_description": "Gehalt",
            "occupation": "Ingenieur",
            "sector": "Maschinenbau"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let (status, body) = upload_file(
        router,
        &format!("{request}/funds-proof"),
        &patient,
        "nachweis.pdf",
        "application/pdf",
        PDF,
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    let (status, body) = json_request(
        router,
        "POST",
        &format!("{request}/identification"),
        &patient,
        Some(json!({ "residence_since": "2010", "stay_reason": "work" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    for (block, keys) in follow_up_missing(&body).as_object().unwrap() {
        assert_eq!(keys, &json!([]), "{block}: {body}");
    }
    assert!(body["follow_up"]["answered_at"].is_null(), "{body}");

    // "Send to the manager" sends them too.
    let (status, body) = json_request(router, "POST", &submit, &patient, declared()).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert!(body["follow_up"]["answered_at"].is_string(), "{body}");
    let (status, answered): (String, bool) = sqlx::query_as(
        r#"SELECT status, follow_up_answered_at IS NOT NULL
           FROM lead_risk_assessments WHERE lead_id = $1"#,
    )
    .bind(lead_id)
    .fetch_one(pool)
    .await
    .unwrap();
    assert_eq!((status.as_str(), answered), ("review_required", true));
    let events: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM lead_risk_events WHERE lead_id = $1 AND kind = 'follow_up_answered'",
    )
    .bind(lead_id)
    .fetch_one(pool)
    .await
    .unwrap();
    assert_eq!(events, 1);

    // Sent once more: recorded already, nothing new.
    let (status, body) = json_request(router, "POST", &submit, &patient, declared()).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let events: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM lead_risk_events WHERE lead_id = $1 AND kind = 'follow_up_answered'",
    )
    .bind(lead_id)
    .fetch_one(pool)
    .await
    .unwrap();
    assert_eq!(events, 1);
}

/// The consent form «Einverständniserklärung zur Datenübermittlung» prints its
/// boxes empty (owner 2026-10-11); with an electronic signature nobody could
/// tick them. The lead chooses the options in the cabinet (2026-10-12): only
/// the person, every save kept; the generated form records the newest choice,
/// which an electronic signature then needs.
#[tokio::test]
async fn the_lead_chooses_the_consent_form_options_and_the_form_records_the_choice() {
    let Some(app) = test_app().await else { return };
    let router = &app.suite.app;
    let pool = &app.suite.pool;
    let (lead_id, user_id, patient) =
        lead_with_login(&app, "Clara", "clara.consent@example.com").await;
    sqlx::query(
        r#"UPDATE leads SET date_of_birth = DATE '1984-02-02', legal_sex = 'female',
                            street_address = 'Musterweg 1', zip_code = '10115', city = 'Berlin',
                            country = 'DE', phone = '+49 30 1234567', primary_language = 'de'
           WHERE id = $1"#,
    )
    .bind(lead_id)
    .execute(pool)
    .await
    .unwrap();
    let path = format!("/api/v1/me/lead-requests/{lead_id}/consent-choices");
    let choices = json!({
        "agency_processing": true,
        "doctors_to_agency": true,
        "data_system": true,
        "named_recipients": false,
        "channel_email": false,
        "channel_threema": false,
        "channel_whatsapp": true,
        "channel_telegram": false
    });

    // An empty or partial "choice" is no consent (QA 2026-10-12, A2-02): the
    // three consents the service runs on are part of every saved choice.
    for partial in [
        json!({}),
        json!({ "agency_processing": true, "doctors_to_agency": true, "channel_email": true }),
    ] {
        let (status, body) = json_request(
            router,
            "POST",
            &path,
            &patient,
            Some(json!({ "choices": partial, "version": "2026-10-12", "language": "de" })),
        )
        .await;
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
        assert_eq!(body["code"], "consent_core_required", "{body}");
    }
    let saved_rows: i64 =
        sqlx::query_scalar("SELECT count(*) FROM consent_form_choices WHERE lead_id = $1")
            .bind(lead_id)
            .fetch_one(pool)
            .await
            .unwrap();
    assert_eq!(saved_rows, 0, "a refused choice is not saved");

    // Nothing is chosen in advance.
    let (status, list) =
        json_request(router, "GET", "/api/v1/me/lead-requests", &patient, None).await;
    assert_eq!(status, StatusCode::OK, "{list}");
    let form = &list["requests"][0]["consent_form"];
    assert_eq!(form["version"], "2026-10-12", "{form}");
    assert_eq!(form["choices"], Value::Null, "{form}");

    // Staff never choose for the person.
    let (status, body) = json_request(
        router,
        "POST",
        &path,
        &app.staff("patient_manager"),
        Some(json!({ "choices": choices, "version": "2026-10-12", "language": "de" })),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN, "{body}");
    // Outdated texts and unknown options are refused.
    let (status, body) = json_request(
        router,
        "POST",
        &path,
        &patient,
        Some(json!({ "choices": choices, "version": "2026-01-01", "language": "de" })),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{body}");
    assert_eq!(body["code"], "consent_version_outdated", "{body}");
    let (status, _) = json_request(
        router,
        "POST",
        &path,
        &patient,
        Some(json!({ "choices": { "staff_ticked": true }, "version": "2026-10-12", "language": "de" })),
    )
    .await;
    assert!(status.is_client_error(), "{status}");

    let (status, saved) = json_request(
        router,
        "POST",
        &path,
        &patient,
        Some(json!({ "choices": choices, "version": "2026-10-12", "language": "de" })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{saved}");
    assert_eq!(saved["choices"], choices);
    assert!(saved["chosen_at"].is_string(), "{saved}");
    let (chosen_by, access_kind, source): (Option<Uuid>, String, String) = sqlx::query_as(
        "SELECT chosen_by, access_kind, source FROM consent_form_choices WHERE lead_id = $1",
    )
    .bind(lead_id)
    .fetch_one(pool)
    .await
    .unwrap();
    assert_eq!(chosen_by, Some(user_id));
    assert_eq!(access_kind, "self");
    assert_eq!(source, "lead_portal");
    assert_eq!(
        audit_count(pool, "lead_portal_consent_choices_saved", lead_id).await,
        1
    );
    let (_, list) = json_request(router, "GET", "/api/v1/me/lead-requests", &patient, None).await;
    assert_eq!(list["requests"][0]["consent_form"]["choices"], choices);

    // A trusted contact is not automatically a consent recipient.
    sqlx::query("UPDATE leads SET trusted_contacts = $2 WHERE id = $1")
        .bind(lead_id).bind(json!([{ "id": Uuid::new_v4(), "name": "Unchosen Trusted Contact", "relation": "friend", "email": "unchosen@example.com" }]))
        .execute(pool).await.unwrap();
    // The generated form records the newest choice.
    let (status, generated) = json_request(
        router,
        "POST",
        "/api/v1/documents/generate",
        &app.staff("patient_manager"),
        Some(json!({ "template_id": "privacy_consents", "lead_id": lead_id, "language": "de" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{generated}");
    let document_id = Uuid::parse_str(generated["id"].as_str().unwrap()).unwrap();
    let recorded: Value = sqlx::query_scalar(
        "SELECT generated_bindings -> '_own_consent_choice' FROM documents WHERE id = $1",
    )
    .bind(document_id)
    .fetch_one(pool)
    .await
    .unwrap();
    let choice_id: Uuid =
        sqlx::query_scalar("SELECT id FROM consent_form_choices WHERE lead_id = $1")
            .bind(lead_id)
            .fetch_one(pool)
            .await
            .unwrap();
    assert_eq!(recorded["id"], json!(choice_id), "{recorded}");
    let legacy_recipients: Option<String> = sqlx::query_scalar(
        "SELECT generated_bindings ->> 'extra_release_recipients' FROM documents WHERE id = $1",
    )
    .bind(document_id)
    .fetch_one(pool)
    .await
    .unwrap();
    assert!(
        legacy_recipients.is_none(),
        "an own choice must not bind unchosen contacts"
    );
    assert_eq!(recorded["choices"], choices, "{recorded}");
    assert_eq!(recorded["source"], "lead_portal");
    // Who chose: the lead's own login, named as the person of the form, who
    // then has to sign it (QA 2026-10-12).
    assert_eq!(recorded["access_kind"], "self", "{recorded}");
    assert_eq!(recorded["chosen_by"], json!(user_id), "{recorded}");
    assert_eq!(recorded["chosen_by_name"], "Clara Portal", "{recorded}");
    assert!(
        recorded["chosen_by_emails"]
            .as_array()
            .is_some_and(|emails| emails.contains(&json!("clara.consent@example.com"))),
        "{recorded}"
    );

    // A changed choice must close open invitations, including a worker lease,
    // without changing already completed evidence.
    let mut signature_requests = Vec::new();
    for initial_status in [
        "pending",
        "submitting",
        "submission_unknown",
        "needs_review",
        "completed",
    ] {
        let source = Uuid::new_v4();
        // Separate source versions keep the one-active-request constraint valid.
        sqlx::query(
            r#"INSERT INTO documents
            (id, version_root_document_id, lead_id, auto_name, art, category, status,
             visibility, is_medical, uploaded_by, generated_template_id, generated_bindings)
            SELECT $1,$1,lead_id,auto_name,art,category,status,visibility,is_medical,
                   uploaded_by,generated_template_id,generated_bindings
            FROM documents WHERE id=$2"#,
        )
        .bind(source)
        .bind(document_id)
        .execute(pool)
        .await
        .unwrap();
        let request = Uuid::new_v4();
        let lease = Uuid::new_v4();
        sqlx::query(
            r#"INSERT INTO document_signature_requests
            (id, source_document_id, requested_by, source_sha256, source_context, signers,
             provider_account, test_mode, status, level, minimum_level, lease_token, lease_until,
             result_document_id, report_storage_key, signed_sha256, report_sha256, evidence)
            VALUES ($1,$2,$3,$4,'{}','[]','consent-test',true,$5,'QES','QES',
                    CASE WHEN $5='completed' THEN NULL ELSE $6 END,
                    CASE WHEN $5='completed' THEN NULL ELSE now()+interval '10 minutes' END,
                    $2,'synthetic-report',$4,$4,'{"synthetic":true}')"#,
        )
        .bind(request)
        .bind(source)
        .bind(app.patient_manager_id)
        .bind("a".repeat(64))
        .bind(initial_status)
        .bind(lease)
        .execute(pool)
        .await
        .unwrap();
        let before: Value =
            sqlx::query_scalar("SELECT to_jsonb(r) FROM document_signature_requests r WHERE id=$1")
                .bind(request)
                .fetch_one(pool)
                .await
                .unwrap();
        signature_requests.push((initial_status, request, lease, before));
    }
    // A new choice is a new record; the older one stays.
    let mut changed = choices.clone();
    changed["channel_email"] = json!(true);
    let (status, saved) = json_request(
        router,
        "POST",
        &path,
        &patient,
        Some(json!({ "choices": changed, "version": "2026-10-12", "language": "ru" })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{saved}");
    let rows: i64 =
        sqlx::query_scalar("SELECT count(*) FROM consent_form_choices WHERE lead_id = $1")
            .bind(lead_id)
            .fetch_one(pool)
            .await
            .unwrap();
    assert_eq!(rows, 2);
    for (initial_status, request, lease, before) in signature_requests {
        let after: Value =
            sqlx::query_scalar("SELECT to_jsonb(r) FROM document_signature_requests r WHERE id=$1")
                .bind(request)
                .fetch_one(pool)
                .await
                .unwrap();
        if initial_status == "completed" {
            assert_eq!(after, before, "completed evidence must remain immutable");
            continue;
        }
        assert_eq!(after["status"], "error", "{initial_status}: {after}");
        assert_eq!(after["last_error"], "consent_choice_changed");
        assert_eq!(after["closed_kind"], "abandoned");
        assert_eq!(after["close_reason"], "consent_choice_changed");
        assert!(after["lease_token"].is_null(), "{initial_status}: {after}");
        assert!(after["lease_until"].is_null(), "{initial_status}: {after}");
        // A worker that captured the old lease cannot promote stale evidence.
        let stale_publish = sqlx::query(
            "UPDATE document_signature_requests SET status='completed' WHERE id=$1 AND lease_token=$2",
        ).bind(request).bind(lease).execute(pool).await.unwrap();
        assert_eq!(stale_publish.rows_affected(), 0, "{initial_status}");
    }
    let marker: Value =
        sqlx::query_scalar("SELECT portal_field_updates->'consent_form' FROM leads WHERE id=$1")
            .bind(lead_id)
            .fetch_one(pool)
            .await
            .unwrap();
    assert!(marker["at"].is_string(), "{marker}");

    // The form generated before shows the older choice: no electronic
    // signature for it any more.
    let (status, state) = json_request(
        router,
        "GET",
        &format!("/api/v1/documents/{document_id}/signature-requests"),
        &app.staff("patient_manager"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{state}");
    assert_eq!(
        state["ineligible_reason"], "consent_choice_changed",
        "{state}"
    );
}

/// The text of a stored PDF, whitespace collapsed (layout line breaks).
async fn document_pdf_text(app: &axum::Router, document_id: Uuid, bearer: &str) -> String {
    let request = Request::builder()
        .method("GET")
        .uri(format!("/api/v1/documents/{document_id}/download"))
        .header("Authorization", bearer)
        .body(Body::empty())
        .unwrap();
    let response = app.clone().oneshot(request).await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = axum::body::to_bytes(response.into_body(), 8 * 1024 * 1024)
        .await
        .unwrap();
    pdf_extract::extract_text_from_mem(&bytes)
        .unwrap()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

/// QA 2026-10-12, A2-06: for a minor the parent chooses the consent options
/// for the child in the cabinet. The wizard's form is the child's form — the
/// parents declare and sign, the child is the data subject —, it names the
/// parent who chose, and that parent is suggested first. The adult forms in
/// the child's name are refused.
#[tokio::test]
async fn a_minor_leads_consent_form_is_the_childs_and_names_the_parent_who_chose() {
    let Some(app) = test_app().await else { return };
    let router = &app.suite.app;
    let pool = &app.suite.pool;
    let pm = app.staff("patient_manager");
    let (mother, father, friend) = (Uuid::new_v4(), Uuid::new_v4(), Uuid::new_v4());
    let (status, created) = json_request(
        router,
        "POST",
        "/api/v1/leads",
        &pm,
        Some(json!({
            "first_name": "Mia",
            "last_name": "MusterKid",
            "date_of_birth": "2015-05-10",
            "email": "mia.kid.consent@example.com",
            "trusted_contacts": [
                {
                    "id": mother,
                    "name": "Maria Muster",
                    "relation": "mother",
                    "email": "maria.consent@example.com",
                    "birth_date": "1985-02-01"
                },
                {
                    "id": father,
                    "name": "Ben Muster",
                    "relation": "father",
                    "email": "ben.consent@example.com",
                    "birth_date": "1983-01-02"
                },
                {
                    "id": friend,
                    "name": "Oma Beispiel",
                    "relation": "friend",
                    "email": "oma.consent@example.com"
                }
            ]
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{created}");
    let child: Uuid = created["id"].as_str().unwrap().parse().unwrap();
    // The father gets the login and chooses.
    let (status, issued) = json_request(
        router,
        "POST",
        &format!("/api/v1/leads/{child}/portal-guardians"),
        &pm,
        Some(json!({ "trusted_contact_id": father })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{issued}");
    let guardian: Uuid = issued["user_id"].as_str().unwrap().parse().unwrap();
    let parent = bearer(guardian, "patient");
    let (status, request) = json_request(
        router,
        "GET",
        &format!("/api/v1/me/lead-requests/{child}"),
        &parent,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{request}");
    assert_eq!(request["access_kind"], "guardian");
    assert_eq!(request["minor"], true);
    let choices = json!({
        "agency_processing": true,
        "doctors_to_agency": true,
        "data_system": true,
        "named_recipients": false,
        "channel_email": true,
        "channel_threema": false,
        "channel_whatsapp": false,
        "channel_telegram": false
    });
    let (status, saved) = json_request(
        router,
        "POST",
        &format!("/api/v1/me/lead-requests/{child}/consent-choices"),
        &parent,
        Some(json!({ "choices": choices, "version": "2026-10-12", "language": "ru" })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{saved}");
    let (access_kind, chosen_by): (String, Option<Uuid>) = sqlx::query_as(
        "SELECT access_kind, chosen_by FROM consent_form_choices WHERE lead_id = $1",
    )
    .bind(child)
    .fetch_one(pool)
    .await
    .unwrap();
    assert_eq!(access_kind, "guardian");
    assert_eq!(chosen_by, Some(guardian));

    // The adult forms in the child's name are refused.
    for template in ["privacy_consents", "confidentiality_release"] {
        let (status, body) = json_request(
            router,
            "POST",
            "/api/v1/documents/generate",
            &pm,
            Some(json!({ "template_id": template, "lead_id": child, "language": "de" })),
        )
        .await;
        assert_eq!(
            status,
            StatusCode::UNPROCESSABLE_ENTITY,
            "{template}: {body}"
        );
        assert_eq!(body["error"], "minor_consent_form_required", "{body}");
    }

    // The child's form: both parents declare, the father who chose first.
    let (status, generated) = json_request(
        router,
        "POST",
        "/api/v1/documents/generate",
        &pm,
        Some(json!({
            "template_id": "consent_data_release_child",
            "lead_id": child,
            "language": "de"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{generated}");
    let document_id: Uuid = generated["id"].as_str().unwrap().parse().unwrap();
    let recorded: Value = sqlx::query_scalar(
        "SELECT generated_bindings -> '_own_consent_choice' FROM documents WHERE id = $1",
    )
    .bind(document_id)
    .fetch_one(pool)
    .await
    .unwrap();
    assert_eq!(recorded["choices"], choices, "{recorded}");
    assert_eq!(recorded["access_kind"], "guardian", "{recorded}");
    assert_eq!(recorded["chosen_by"], json!(guardian), "{recorded}");
    assert_eq!(recorded["chosen_by_name"], "Ben Muster", "{recorded}");
    assert_eq!(
        recorded["chosen_by_role"], "Personensorgeberechtigte/r",
        "{recorded}"
    );
    assert!(
        recorded["chosen_by_emails"]
            .as_array()
            .is_some_and(|emails| emails.contains(&json!("ben.consent@example.com"))),
        "{recorded}"
    );
    let text = document_pdf_text(router, document_id, &pm).await;
    let father_at = text.find("Ben Muster, geb. am 02.01.1983").expect(&text);
    let mother_at = text.find("Maria Muster, geb. am 01.02.1985").expect(&text);
    assert!(father_at < mother_at, "{text}");
    assert!(
        text.contains("von unserem Kind: Mia MusterKid, geb. am 10.05.2015"),
        "{text}"
    );
    assert!(text.contains("sind damit einverstanden:"), "{text}");
    assert!(!text.contains("Die Auswahl hat"), "{text}");
    assert!(!text.contains("Kundenkabinett"), "{text}");
    assert!(text.contains("[x] E-mail"), "{text}");
    assert!(text.contains("[ ] WhatsApp-Messenger"), "{text}");
    // Trusted contacts are not recipients of an explicit consent choice;
    // the parent left the named-recipient option unticked.
    assert!(!text.contains("Oma Beispiel"), "{text}");
    assert!(!text.contains("Ich, Mia"), "{text}");
    assert!(!text.contains("meine eigene Auswahl"), "{text}");

    // The parent who chose is suggested first and must sign.
    let (status, state) = json_request(
        router,
        "GET",
        &format!("/api/v1/documents/{document_id}/signature-requests"),
        &pm,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{state}");
    assert_eq!(state["ineligible_reason"], Value::Null, "{state}");
    let clients: Vec<&str> = state["suggested_signers"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|signer| signer["role"] == "client")
        .map(|signer| signer["email"].as_str().unwrap())
        .collect();
    assert_eq!(
        clients,
        ["ben.consent@example.com", "maria.consent@example.com"],
        "{state}"
    );
}

/// Saves a consent choice through the cabinet.
async fn choose(
    app: &axum::Router,
    lead_id: Uuid,
    bearer: &str,
    choices: &Value,
) -> (StatusCode, Value) {
    json_request(
        app,
        "POST",
        &format!("/api/v1/me/lead-requests/{lead_id}/consent-choices"),
        bearer,
        Some(json!({ "choices": choices, "version": "2026-10-12", "language": "de" })),
    )
    .await
}

#[tokio::test]
async fn the_minor_access_notification_is_sent_once_for_parallel_reads() {
    let Some(app) = test_app().await else { return };
    let router = &app.suite.app;
    let pool = &app.suite.pool;
    let (lead_id, _, child) =
        lead_with_login(&app, "Mia", "mia.concurrent.notice@example.com").await;
    sqlx::query("UPDATE leads SET date_of_birth = '2015-05-10' WHERE id = $1")
        .bind(lead_id)
        .execute(pool)
        .await
        .unwrap();

    // Hold inserts until both readers reach their notification attempt.
    // The old check-then-insert implementation lets both pass NOT EXISTS;
    // the locked implementation lets one insert while the other waits on it.
    let mut gate = pool.begin().await.unwrap();
    let gate_pid: i32 = sqlx::query_scalar("SELECT pg_backend_pid()")
        .fetch_one(&mut *gate)
        .await
        .unwrap();
    sqlx::query("LOCK TABLE user_notifications IN SHARE MODE")
        .execute(&mut *gate)
        .await
        .unwrap();
    let mut readers = Vec::new();
    for _ in 0..2 {
        let router = router.clone();
        let bearer = child.clone();
        readers.push(tokio::spawn(async move {
            json_request(&router, "GET", "/api/v1/me/lead-requests", &bearer, None).await
        }));
    }
    let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(10);
    loop {
        sqlx::query("SELECT pg_stat_clear_snapshot()")
            .execute(&mut *gate)
            .await
            .unwrap();
        let blocked: i64 = sqlx::query_scalar(
            "SELECT count(*) FROM pg_stat_activity waiting
             WHERE $1 = ANY(pg_blocking_pids(waiting.pid))
                OR EXISTS(SELECT 1 FROM pg_stat_activity first_waiter
                          WHERE $1 = ANY(pg_blocking_pids(first_waiter.pid))
                            AND first_waiter.pid = ANY(pg_blocking_pids(waiting.pid)))",
        )
        .bind(gate_pid)
        .fetch_one(&mut *gate)
        .await
        .unwrap();
        if blocked >= 2 {
            break;
        }
        assert!(
            tokio::time::Instant::now() < deadline,
            "both readers must reach the lock gate"
        );
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    }
    gate.commit().await.unwrap();
    for reader in readers {
        let (status, list) = tokio::time::timeout(std::time::Duration::from_secs(10), reader)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(status, StatusCode::OK, "{list}");
        assert_eq!(list["own_access_closed"], true, "{list}");
        assert_eq!(list["requests"], json!([]), "{list}");
    }
    let (count, recipients): (i64, i64) = sqlx::query_as(
        "SELECT count(*), count(DISTINCT user_id) FROM user_notifications
         WHERE entity_type = 'lead' AND entity_id = $1 AND kind = 'lead_portal_minor'",
    )
    .bind(lead_id)
    .fetch_one(pool)
    .await
    .unwrap();
    assert!(count > 0, "the staff notification is stored");
    assert_eq!(count, recipients, "exactly one notice per staff recipient");
    json_request(router, "GET", "/api/v1/me/lead-requests", &child, None).await;
    let repeated: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM user_notifications
         WHERE entity_type = 'lead' AND entity_id = $1 AND kind = 'lead_portal_minor'",
    )
    .bind(lead_id)
    .fetch_one(pool)
    .await
    .unwrap();
    assert_eq!(repeated, count, "a later retry creates no further notices");
}

/// QA 2026-10-12, A3-01: a minor's own login (made while the lead had no date
/// of birth) is closed once staff set a date under 18 — since 2026-10-12
/// (owner) before a parent has access too: it reaches nothing of the request,
/// read or write, with a neutral 403; staff issue it no password and are told
/// to give the parents access. Only a parent's choice counts for the child's form —
/// a choice the child's login saved before is ignored and never shown as the
/// parent's. A corrected date of birth opens the login again.
#[tokio::test]
async fn a_minors_own_login_is_closed_while_the_parents_have_access() {
    let Some(app) = test_app().await else { return };
    let router = &app.suite.app;
    let pool = &app.suite.pool;
    let pm = app.staff("patient_manager");
    let (lead_id, child_login, child) =
        lead_with_login(&app, "Mia", "mia.closed.login@example.com").await;
    let all = json!({
        "agency_processing": true,
        "doctors_to_agency": true,
        "data_system": true,
        "named_recipients": true,
        "channel_email": true,
        "channel_threema": true,
        "channel_whatsapp": true,
        "channel_telegram": true
    });
    let request = format!("/api/v1/me/lead-requests/{lead_id}");
    // While nothing says the lead is a minor, the own login chooses.
    let recipients = json!([{
        "name": "Praxis Dr. Beispiel",
        "relation": "family_doctor",
        "contact": "praxis.consent@example.com",
        "scope_codes": ["medical"]
    }]);
    let (status, body) = save_disclosure(
        router,
        lead_id,
        &child,
        confirmed_disclosure(recipients.clone(), true),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let (status, body) = json_request(
        router,
        "POST",
        &format!("{request}/consent-choices"),
        &child,
        Some(json!({
            "choices": all, "recipients": recipients,
            "version": "2026-10-12", "language": "de"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    assert_eq!(body["recipients"], recipients, "{body}");
    let (status, intake) = json_request(
        router,
        "GET",
        &format!("/api/v1/leads/{lead_id}/portal-intake"),
        &pm,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{intake}");
    assert_eq!(intake["consent_form"]["recipients"], recipients, "{intake}");

    // Staff set a date of birth under 18 and name the mother.
    let mother = Uuid::new_v4();
    let (status, body) = json_request(
        router,
        "POST",
        &format!("/api/v1/leads/{lead_id}/update"),
        &pm,
        Some(json!({
            "date_of_birth": "2015-05-10",
            "trusted_contacts": [{
                "id": mother,
                "name": "Maria Muster",
                "relation": "mother",
                "email": "maria.closed.parent@example.com",
                "birth_date": "1985-02-01"
            }]
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");

    // Even before any parent has access the own login reaches nothing
    // (owner 2026-10-12), and staff are told once to issue the parents'
    // access.
    let notices = || async move {
        sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM user_notifications
             WHERE entity_type = 'lead' AND entity_id = $1 AND kind = 'lead_portal_minor'",
        )
        .bind(lead_id)
        .fetch_one(pool)
        .await
        .unwrap()
    };
    let (status, list) =
        json_request(router, "GET", "/api/v1/me/lead-requests", &child, None).await;
    assert_eq!(status, StatusCode::OK, "{list}");
    assert_eq!(list["own_access_closed"], true, "{list}");
    assert_eq!(list["requests"], json!([]), "{list}");
    let (status, body) = choose(router, lead_id, &child, &all).await;
    assert_eq!(status, StatusCode::FORBIDDEN, "{body}");
    assert_eq!(body["code"], "lead_request_guardian_only", "{body}");
    let told = notices().await;
    assert!(told > 0, "staff are told to issue the parents' access");
    json_request(router, "GET", "/api/v1/me/lead-requests", &child, None).await;
    assert_eq!(notices().await, told, "told once");

    // The mother gets her access: the child's own login closes.
    let (status, issued) = json_request(
        router,
        "POST",
        &format!("/api/v1/leads/{lead_id}/portal-guardians"),
        &pm,
        Some(json!({ "trusted_contact_id": mother })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{issued}");
    let guardian: Uuid = issued["user_id"].as_str().unwrap().parse().unwrap();
    let access_id: Uuid = issued["access_id"].as_str().unwrap().parse().unwrap();
    let parent = bearer(guardian, "patient");

    let (status, list) =
        json_request(router, "GET", "/api/v1/me/lead-requests", &child, None).await;
    assert_eq!(status, StatusCode::OK, "{list}");
    assert_eq!(list["requests"], json!([]), "{list}");
    assert_eq!(list["own_access_closed"], true, "{list}");
    let (_, me) = json_request(router, "GET", "/api/v1/me", &child, None).await;
    assert_eq!(
        me["portal_mode"], "lead",
        "the patient portal stays closed: {me}"
    );
    for (method, path, body) in [
        ("GET", request.clone(), None),
        (
            "POST",
            format!("{request}/personal-data"),
            Some(json!({ "city": "Hamburg" })),
        ),
        (
            "POST",
            format!("{request}/consent-choices"),
            Some(json!({ "choices": all, "version": "2026-10-12", "language": "de" })),
        ),
        (
            "POST",
            format!("{request}/representation"),
            Some(json!({ "custody": "sole_parent" })),
        ),
        ("POST", format!("{request}/submit"), declared()),
    ] {
        let (status, refused) = json_request(router, method, &path, &child, body).await;
        assert_eq!(status, StatusCode::FORBIDDEN, "{path}: {refused}");
        assert_eq!(
            refused["code"], "lead_request_guardian_only",
            "{path}: {refused}"
        );
        assert_eq!(
            refused["error"], "lead_request_guardian_only",
            "{path}: {refused}"
        );
    }
    let (status, body) = json_request(router, "GET", "/api/v1/me/documents", &child, None).await;
    assert_eq!(status, StatusCode::FORBIDDEN, "{body}");
    assert_eq!(body["code"], "lead_portal_only", "{body}");
    let active: bool = sqlx::query_scalar("SELECT is_active FROM users WHERE id = $1")
        .bind(child_login)
        .fetch_one(pool)
        .await
        .unwrap();
    assert!(active, "restricted, not switched off");

    // Staff see it and issue the child no password.
    let (status, account) = json_request(
        router,
        "GET",
        &format!("/api/v1/leads/{lead_id}/portal-account"),
        &pm,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{account}");
    assert_eq!(account["account"]["own_login_closed"], true, "{account}");
    let (status, body) = json_request(
        router,
        "POST",
        &format!("/api/v1/leads/{lead_id}/portal-account"),
        &pm,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{body}");
    assert_eq!(body["code"], "minor_own_login_closed", "{body}");
    let (_, intake) = json_request(
        router,
        "GET",
        &format!("/api/v1/leads/{lead_id}/portal-intake"),
        &pm,
        None,
    )
    .await;
    assert_eq!(intake["own_login_closed"], true, "{intake}");

    // The mother sees no choice of the child as hers, and chooses herself.
    let (status, own) = json_request(router, "GET", &request, &parent, None).await;
    assert_eq!(status, StatusCode::OK, "{own}");
    assert_eq!(own["access_kind"], "guardian");
    assert_eq!(own["consent_form"]["choices"], Value::Null, "{own}");
    let mine = json!({
        "agency_processing": true,
        "doctors_to_agency": true,
        "data_system": true,
        "named_recipients": false,
        "channel_email": true,
        "channel_threema": false,
        "channel_whatsapp": false,
        "channel_telegram": false
    });
    let (status, saved) = choose(router, lead_id, &parent, &mine).await;
    assert_eq!(status, StatusCode::CREATED, "{saved}");
    assert_eq!(saved["chosen_by_me"], true, "{saved}");
    let (status, staff) = json_request(
        router,
        "GET",
        &format!("/api/v1/leads/{lead_id}/portal-intake"),
        &pm,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{staff}");
    let form = &staff["consent_form"];
    assert_eq!(form["choices"], mine, "{form}");
    assert_eq!(form["chosen_by"], json!(guardian), "{form}");
    assert_eq!(form["access_kind"], "guardian", "{form}");
    assert_eq!(form["chosen_by_name"], "Maria Muster", "{form}");
    assert_eq!(
        form["chosen_by_role"], "Personensorgeberechtigte/r",
        "{form}"
    );
    assert_eq!(form["version"], "2026-10-12", "{form}");
    assert!(chrono::DateTime::parse_from_rfc3339(form["chosen_at"].as_str().unwrap()).is_ok());
    // A child's choice stored later (as before the rule) still never counts.
    sqlx::query(
        r#"INSERT INTO consent_form_choices
               (template_id, lead_id, choices, chosen_by, access_kind, source, language, text_version)
           VALUES ('privacy_consents', $1, $2, $3, 'self', 'lead_portal', 'de', '2026-10-12')"#,
    )
    .bind(lead_id)
    .bind(&all)
    .bind(child_login)
    .execute(pool)
    .await
    .unwrap();
    let (_, own) = json_request(router, "GET", &request, &parent, None).await;
    assert_eq!(own["consent_form"]["choices"], mine, "{own}");
    assert_eq!(own["consent_form"]["chosen_by_me"], true, "{own}");

    // The child's form records the mother's choice and is signed by her.
    let (status, generated) = json_request(
        router,
        "POST",
        "/api/v1/documents/generate",
        &pm,
        Some(json!({
            "template_id": "consent_data_release_single",
            "lead_id": lead_id,
            "language": "de"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{generated}");
    let document_id: Uuid = generated["id"].as_str().unwrap().parse().unwrap();
    let recorded: Value = sqlx::query_scalar(
        "SELECT generated_bindings -> '_own_consent_choice' FROM documents WHERE id = $1",
    )
    .bind(document_id)
    .fetch_one(pool)
    .await
    .unwrap();
    assert_eq!(recorded["access_kind"], "guardian", "{recorded}");
    assert_eq!(recorded["chosen_by"], json!(guardian), "{recorded}");
    assert_eq!(recorded["choices"], mine, "{recorded}");
    let text = document_pdf_text(router, document_id, &pm).await;
    assert_eq!(recorded["chosen_by_name"], "Maria Muster", "{recorded}");
    assert!(!text.contains("Die Auswahl hat"), "{text}");
    assert!(!text.contains("Kundenkabinett"), "{text}");
    let (status, state) = json_request(
        router,
        "GET",
        &format!("/api/v1/documents/{document_id}/signature-requests"),
        &pm,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{state}");
    assert_eq!(state["ineligible_reason"], Value::Null, "{state}");

    // A changed custody makes the next version the other variant of the same
    // form, not a second form beside it (QA 2026-10-12, round 3).
    let (status, version) = json_request(
        router,
        "POST",
        "/api/v1/documents/generate",
        &pm,
        Some(json!({
            "template_id": "consent_data_release_child",
            "lead_id": lead_id,
            "language": "de",
            "replace_document_id": document_id
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{version}");
    let version_id: Uuid = version["id"].as_str().unwrap().parse().unwrap();
    let (root, replaces): (Option<Uuid>, Option<Uuid>) = sqlx::query_as(
        "SELECT version_root_document_id, replaces_document_id FROM documents WHERE id = $1",
    )
    .bind(version_id)
    .fetch_one(pool)
    .await
    .unwrap();
    assert_eq!(root, Some(document_id));
    assert_eq!(replaces, Some(document_id));

    // Revoking the mother's access does not reopen the child's login.
    let (status, body) = json_request(
        router,
        "POST",
        &format!("/api/v1/leads/{lead_id}/portal-guardians/{access_id}/revoke"),
        &pm,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let (_, list) = json_request(router, "GET", "/api/v1/me/lead-requests", &child, None).await;
    assert_eq!(list["own_access_closed"], true, "{list}");

    // A corrected date of birth opens it again.
    let (status, body) = json_request(
        router,
        "POST",
        &format!("/api/v1/leads/{lead_id}/update"),
        &pm,
        Some(json!({ "date_of_birth": "1990-05-10" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let (_, list) = json_request(router, "GET", "/api/v1/me/lead-requests", &child, None).await;
    assert_eq!(list["own_access_closed"], false, "{list}");
    assert_eq!(list["requests"][0]["access_kind"], "self", "{list}");
    let (status, _) = json_request(router, "GET", &request, &child, None).await;
    assert_eq!(status, StatusCode::OK);
}

#[tokio::test]
async fn unchanged_submission_is_idempotent_but_a_real_edit_can_be_resubmitted() {
    let Some(app) = test_app().await else { return };
    let (lead, _, patient) = lead_with_login(&app, "Retry", "retry.submit@example.com").await;
    fill_in_complete_request(&app.suite.app, lead, &patient).await;
    let path = format!("/api/v1/me/lead-requests/{lead}/submit");
    let (status, first) = json_request(&app.suite.app, "POST", &path, &patient, declared()).await;
    assert_eq!(status, StatusCode::OK, "{first}");
    let snapshot = |pool: PgPool| async move {
        sqlx::query_as::<_, (Option<chrono::DateTime<chrono::Utc>>, Option<chrono::DateTime<chrono::Utc>>, i64, i64)>(
            "SELECT portal_submitted_at, (SELECT declared_correct_at FROM lead_gwg_declarations WHERE lead_id=$1),
                (SELECT count(*) FROM audit_log WHERE entity_id = $1 AND action = 'lead_portal_submit'),
                (SELECT count(*) FROM user_notifications WHERE entity_id = $1 AND kind = 'lead_portal_submitted')
             FROM leads WHERE id = $1")
            .bind(lead).fetch_one(&pool).await.unwrap()
    };
    let before = snapshot(app.suite.pool.clone()).await;
    let (a, b) = tokio::join!(
        json_request(&app.suite.app, "POST", &path, &patient, declared()),
        json_request(&app.suite.app, "POST", &path, &patient, declared())
    );
    assert_eq!(a.0, StatusCode::OK, "{}", a.1);
    assert_eq!(b.0, StatusCode::OK, "{}", b.1);
    assert_eq!(snapshot(app.suite.pool.clone()).await, before);
    let (status, saved) = json_request(
        &app.suite.app,
        "POST",
        &format!("/api/v1/me/lead-requests/{lead}/personal-data"),
        &patient,
        Some(json!({"city": "Bonn"})),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{saved}");
    let (status, resent) = json_request(&app.suite.app, "POST", &path, &patient, declared()).await;
    assert_eq!(status, StatusCode::OK, "{resent}");
    let after = snapshot(app.suite.pool.clone()).await;
    assert!(after.0 > before.0);
    assert_eq!(after.2, before.2 + 1);
}

#[tokio::test]
async fn guardian_identity_age_and_reactivation_boundaries_are_enforced() {
    let Some(app) = test_app().await else { return };
    let pool = &app.suite.pool;
    let router = &app.suite.app;
    let pm = app.staff("patient_manager");
    let (lead, _, child) = lead_with_login(&app, "Minor", "minor.boundaries@example.com").await;
    let (mother, father) = (Uuid::new_v4(), Uuid::new_v4());
    sqlx::query("UPDATE leads SET date_of_birth = '2015-01-01', trusted_contacts = $2 WHERE id = $1")
        .bind(lead).bind(json!([
            {"id": mother,"name":"Anna Guardian","relation":"mother","email":"anna.boundaries@example.com","birth_date":"1980-01-01"},
            {"id": father,"name":"Ben Guardian","relation":"father","email":"ben.boundaries@example.com","birth_date":"1980-02-02"}
        ])).execute(pool).await.unwrap();
    let issue_path = format!("/api/v1/leads/{lead}/portal-guardians");
    // First notification, then an actual access revoke must allow one new notice.
    json_request(router, "GET", "/api/v1/me/lead-requests", &child, None).await;
    let notices: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM user_notifications WHERE entity_id=$1 AND kind='lead_portal_minor'",
    )
    .bind(lead)
    .fetch_one(pool)
    .await
    .unwrap();
    assert!(notices > 0);
    let (status, issued) = json_request(
        router,
        "POST",
        &issue_path,
        &pm,
        Some(json!({"trusted_contact_id":mother})),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{issued}");
    let user: Uuid = issued["user_id"].as_str().unwrap().parse().unwrap();
    let access = issued["access_id"].as_str().unwrap();
    let parent = bearer(user, "patient");
    for (field, value) in [
        ("first_name", json!("Changed")),
        ("last_name", json!("Changed")),
        ("date_of_birth", json!("1981-01-01")),
    ] {
        let mut patch = json!({});
        patch[field] = value;
        let (status, refused) = json_request(
            router,
            "POST",
            &format!("/api/v1/me/lead-requests/{lead}/representatives/{father}"),
            &parent,
            Some(patch),
        )
        .await;
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{refused}");
        assert_eq!(refused["code"], "representative_not_yours", "{refused}");
        assert_eq!(refused["field"], field, "{refused}");
    }
    let (status, reset) = json_request(
        router,
        "POST",
        &format!("{issue_path}/{access}/password"),
        &pm,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{reset}");
    assert_eq!(
        audit_count(pool, "reset_lead_guardian_password", lead).await,
        1,
        "audit is durable before response"
    );
    sqlx::query("UPDATE leads SET date_of_birth='1990-01-01' WHERE id=$1")
        .bind(lead)
        .execute(pool)
        .await
        .unwrap();
    let (status, refused) = json_request(
        router,
        "POST",
        &format!("/api/v1/me/lead-requests/{lead}/personal-data"),
        &parent,
        Some(json!({"city":"Unauthorized change"})),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND, "{refused}");
    // The child is of age: the parent no longer reads the request either, and
    // the cabinet learns why (QA 2026-10-23: it still listed the request).
    let (status, list) =
        json_request(router, "GET", "/api/v1/me/lead-requests", &parent, None).await;
    assert_eq!(status, StatusCode::OK, "{list}");
    assert_eq!(list["requests"], json!([]), "{list}");
    assert_eq!(list["guardian_access_ended"], true, "{list}");
    let (status, read) = json_request(
        router,
        "GET",
        &format!("/api/v1/me/lead-requests/{lead}"),
        &parent,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND, "{read}");
    sqlx::query("UPDATE leads SET date_of_birth='2015-01-01' WHERE id=$1")
        .bind(lead)
        .execute(pool)
        .await
        .unwrap();
    // A converted lead: the parent's access lives on the patient record, so
    // revoking the request access alone is refused (H6, 2026-10-20).
    let converted_to: Uuid = sqlx::query_scalar(
        r#"INSERT INTO patients (patient_id, first_name, last_name, birth_date, gender, created_by)
           VALUES ($1, 'Kira', 'Guardian-Revoke', DATE '2015-01-01', 'female', $2) RETURNING id"#,
    )
    .bind(format!("P-REVOKE-{}", Uuid::new_v4().simple()))
    .bind(app.suite.admin_id)
    .fetch_one(pool)
    .await
    .unwrap();
    sqlx::query("UPDATE leads SET converted_patient_id = $2 WHERE id = $1")
        .bind(lead)
        .bind(converted_to)
        .execute(pool)
        .await
        .unwrap();
    let (status, refused) = json_request(
        router,
        "POST",
        &format!("{issue_path}/{access}/revoke"),
        &pm,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{refused}");
    assert!(
        refused
            .to_string()
            .contains("manage the access on the patient record"),
        "{refused}"
    );
    sqlx::query("UPDATE leads SET converted_patient_id = NULL WHERE id = $1")
        .bind(lead)
        .execute(pool)
        .await
        .unwrap();
    let (status, revoked) = json_request(
        router,
        "POST",
        &format!("{issue_path}/{access}/revoke"),
        &pm,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{revoked}");
    assert_eq!(revoked["login_deactivated"], true, "{revoked}");
    for _ in 0..2 {
        json_request(router, "GET", "/api/v1/me/lead-requests", &child, None).await;
    }
    let after: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM user_notifications WHERE entity_id=$1 AND kind='lead_portal_minor'",
    )
    .bind(lead)
    .fetch_one(pool)
    .await
    .unwrap();
    assert_eq!(
        after,
        notices * 2,
        "one new notice per recipient after revoke"
    );
    let (status, reissued) = json_request(
        router,
        "POST",
        &issue_path,
        &pm,
        Some(json!({"trusted_contact_id":mother})),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{reissued}");
    assert_eq!(reissued["user_id"], json!(user));
    let access = reissued["access_id"].as_str().unwrap();
    json_request(
        router,
        "POST",
        &format!("{issue_path}/{access}/revoke"),
        &pm,
        None,
    )
    .await;
    // An IT disable/update after the revoke makes staff reactivation mandatory.
    sqlx::query("UPDATE users SET is_active=false, updated_at=clock_timestamp() WHERE id=$1")
        .bind(user)
        .execute(pool)
        .await
        .unwrap();
    let (status, refused) = json_request(
        router,
        "POST",
        &issue_path,
        &pm,
        Some(json!({"trusted_contact_id":mother})),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{refused}");
    assert_eq!(refused["code"], "portal_account_inactive", "{refused}");
}

#[tokio::test]
async fn concurrent_uploads_respect_the_locked_thirty_document_limit() {
    let Some(app) = test_app().await else { return };
    let pool = &app.suite.pool;
    let (lead, user, patient) =
        lead_with_login(&app, "Limit", "limit.concurrent@example.com").await;
    give_consent(&app.suite.app, lead, &patient, "health_data_processing").await;
    for _ in 0..29 {
        let document = Uuid::new_v4();
        sqlx::query("INSERT INTO documents(id,version_root_document_id,lead_id,auto_name,art,category,status,visibility,is_medical,uploaded_by) VALUES($3,$3,$1,'Synthetic','report','medical','active','internal',true,$2)")
            .bind(lead).bind(user).bind(document).execute(pool).await.unwrap();
        sqlx::query("INSERT INTO lead_portal_uploads(document_id,lead_id,uploaded_by,access_kind,kind) VALUES($1,$2,$3,'self','medical')")
            .bind(document).bind(lead).bind(user).execute(pool).await.unwrap();
    }
    let mut gate = pool.begin().await.unwrap();
    sqlx::query("SELECT id FROM leads WHERE id=$1 FOR NO KEY UPDATE")
        .bind(lead)
        .execute(&mut *gate)
        .await
        .unwrap();
    let pid: i32 = sqlx::query_scalar("SELECT pg_backend_pid()")
        .fetch_one(&mut *gate)
        .await
        .unwrap();
    let mut uploads = Vec::new();
    for index in 0..2 {
        let router = app.suite.app.clone();
        let patient = patient.clone();
        // Two different files: the same one twice is a duplicate (owner 2026-10-24).
        let bytes = format!("%PDF-1.4\n% concurrent upload {index}\n%%EOF\n").into_bytes();
        uploads.push(tokio::spawn(async move {
            upload(
                &router,
                &format!("/api/v1/me/lead-requests/{lead}/documents"),
                &patient,
                &bytes,
            )
            .await
        }));
    }
    let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(10);
    loop {
        sqlx::query("SELECT pg_stat_clear_snapshot()")
            .execute(&mut *gate)
            .await
            .unwrap();
        let blocked: i64=sqlx::query_scalar("SELECT count(*) FROM pg_stat_activity waiting WHERE $1 = ANY(pg_blocking_pids(waiting.pid)) OR EXISTS(SELECT 1 FROM pg_stat_activity first_waiter WHERE $1 = ANY(pg_blocking_pids(first_waiter.pid)) AND first_waiter.pid = ANY(pg_blocking_pids(waiting.pid)))")
            .bind(pid).fetch_one(&mut *gate).await.unwrap();
        if blocked >= 2 {
            break;
        }
        assert!(
            tokio::time::Instant::now() < deadline,
            "uploads reached the gate"
        );
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    }
    gate.commit().await.unwrap();
    let mut statuses = Vec::new();
    for task in uploads {
        let result = tokio::time::timeout(std::time::Duration::from_secs(10), task)
            .await
            .unwrap()
            .unwrap();
        if result.0 == StatusCode::UNPROCESSABLE_ENTITY {
            assert_eq!(result.1["code"], "too_many_documents", "{}", result.1);
        }
        statuses.push(result.0);
    }
    assert_eq!(
        statuses
            .iter()
            .filter(|s| **s == StatusCode::CREATED)
            .count(),
        1,
        "{statuses:?}"
    );
    assert_eq!(
        statuses
            .iter()
            .filter(|s| **s == StatusCode::UNPROCESSABLE_ENTITY)
            .count(),
        1,
        "{statuses:?}"
    );
    let (uploads,docs):(i64,i64)=sqlx::query_as("SELECT (SELECT count(*) FROM lead_portal_uploads WHERE lead_id=$1 AND withdrawn_at IS NULL), (SELECT count(*) FROM documents WHERE lead_id=$1 AND file_deleted_at IS NULL)").bind(lead).fetch_one(pool).await.unwrap();
    assert_eq!(uploads, 30);
    assert_eq!(docs, 30, "refused stored document must be discarded");
}

#[tokio::test]
async fn historical_payer_snapshots_are_scrubbed_only_on_lead_erasure() {
    let Some(app) = test_app().await else { return };
    let pool = &app.suite.pool;
    let (lead, _, _) = lead_with_login(&app, "Audit", "audit.scrub@example.com").await;
    let event = gmed_server::audit::domain_diff_event(
        "lead_portal_update_payer_declaration",
        Some(app.patient_manager_id),
        "lead",
        Some(lead),
        json!({"name":"Previous Person","nested":{"email":"old@example.com"},"flag":true}),
        json!({"name":"New Person","nested":{"email":"new@example.com"},"flag":false}),
    );
    let mut conn = pool.acquire().await.unwrap();
    gmed_server::audit::write_in_transaction(&mut conn, &event)
        .await
        .unwrap();
    drop(conn);
    let id:i64=sqlx::query_scalar("SELECT id FROM audit_log WHERE action='lead_portal_update_payer_declaration' AND entity_id=$1").bind(lead).fetch_one(pool).await.unwrap();
    assert!(
        sqlx::query("UPDATE audit_log SET old_value='{}' WHERE id=$1")
            .bind(id)
            .execute(pool)
            .await
            .is_err()
    );
    let mut tx = pool.begin().await.unwrap();
    sqlx::query("SELECT set_config('gmed.dsgvo_erasure','on',true)")
        .execute(&mut *tx)
        .await
        .unwrap();
    assert!(sqlx::query("UPDATE audit_log SET old_value=gmed_scrub_jsonb_text(old_value,'(?s)^.+$','[erased]'), new_value=gmed_scrub_jsonb_text(new_value,'(?s)^.+$','[erased]') WHERE id=$1").bind(id).execute(&mut *tx).await.is_err(),"active lead snapshots remain immutable");
    tx.rollback().await.unwrap();
    let (status, erased) = json_request(
        &app.suite.app,
        "POST",
        &format!("/api/v1/leads/{lead}/failed-flow"),
        &app.staff("patient_manager"),
        Some(json!({"resolution":"delete","reason":"not_our_lead"})),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{erased}");
    let (old, new): (Value, Value) =
        sqlx::query_as("SELECT old_value,new_value FROM audit_log WHERE id=$1")
            .bind(id)
            .fetch_one(pool)
            .await
            .unwrap();
    assert_eq!(
        old,
        json!({"name":"[erased]","nested":{"email":"[erased]"},"flag":true})
    );
    assert_eq!(
        new,
        json!({"name":"[erased]","nested":{"email":"[erased]"},"flag":false})
    );
    let mut tx = pool.begin().await.unwrap();
    sqlx::query("SELECT set_config('gmed.dsgvo_erasure','on',true)")
        .execute(&mut *tx)
        .await
        .unwrap();
    assert!(
        sqlx::query(
            "UPDATE audit_log SET new_value=jsonb_set(new_value,'{flag}','true') WHERE id=$1"
        )
        .bind(id)
        .execute(&mut *tx)
        .await
        .is_err(),
        "erasure must preserve non-text evidence"
    );
    tx.rollback().await.unwrap();
}

#[tokio::test]
async fn rejected_minor_birth_date_notifies_staff_once_without_persisting_it() {
    let Some(app) = test_app().await else { return };
    let (lead, _, patient) = lead_with_login(&app, "Attempt", "attempt.minor@example.com").await;
    sqlx::query("UPDATE leads SET date_of_birth='1990-01-01' WHERE id=$1")
        .bind(lead)
        .execute(&app.suite.pool)
        .await
        .unwrap();
    let path = format!("/api/v1/me/lead-requests/{lead}/personal-data");
    let mut notice_count = 0;
    for attempt in 0..2 {
        let (status, body) = json_request(
            &app.suite.app,
            "POST",
            &path,
            &patient,
            Some(json!({"date_of_birth":"2015-01-01"})),
        )
        .await;
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
        assert_eq!(body["code"], "minor_needs_guardian", "{body}");
        let count: i64 = sqlx::query_scalar("SELECT count(*) FROM user_notifications WHERE entity_id=$1 AND kind='lead_portal_minor'")
            .bind(lead).fetch_one(&app.suite.pool).await.unwrap();
        if attempt == 0 {
            assert!(
                count > 0,
                "staff must be told about the rejected under-18 date"
            );
            notice_count = count;
        } else {
            assert_eq!(count, notice_count, "retries do not duplicate the notice");
        }
    }
    let dob: String = sqlx::query_scalar("SELECT date_of_birth::text FROM leads WHERE id=$1")
        .bind(lead)
        .fetch_one(&app.suite.pool)
        .await
        .unwrap();
    assert_eq!(dob, "1990-01-01");
}

/// Wait for the HTTP transaction to reach the row lock held by the test.
/// Use blocker identity: pg_stat_activity truncates long query text before its
/// trailing FOR UPDATE clause. No timing assumptions about Tokio scheduling.
async fn wait_for_cabinet_lead_lock(pool: &PgPool, blocker_pid: i32) {
    tokio::time::timeout(std::time::Duration::from_secs(10), async {
        loop {
            let waiting: bool = sqlx::query_scalar(
                "SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE datname = current_database()
                 AND pid <> pg_backend_pid() AND $1 = ANY(pg_blocking_pids(pid)))",
            )
            .bind(blocker_pid)
            .fetch_one(pool)
            .await
            .unwrap();
            if waiting {
                return;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("cabinet request did not reach the lead lock");
}

#[tokio::test]
async fn consent_choice_after_waiting_for_submission_is_a_new_change() {
    let Some(app) = test_app().await else { return };
    let pool = &app.suite.pool;
    let (lead, _, patient) = lead_with_login(&app, "Choice", "choice.clock@example.com").await;
    fill_in_complete_request(&app.suite.app, lead, &patient).await;
    let base = format!("/api/v1/me/lead-requests/{lead}");
    let (status, body) = json_request(
        &app.suite.app,
        "POST",
        &format!("{base}/submit"),
        &patient,
        declared(),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");

    let mut sending = pool.begin().await.unwrap();
    sqlx::query("SELECT id FROM leads WHERE id=$1 FOR UPDATE")
        .bind(lead)
        .execute(&mut *sending)
        .await
        .unwrap();
    let blocker_pid: i32 = sqlx::query_scalar("SELECT pg_backend_pid()")
        .fetch_one(&mut *sending)
        .await
        .unwrap();
    let router = app.suite.app.clone();
    let bearer = patient.clone();
    let path = format!("{base}/consent-choices");
    let choice = tokio::spawn(async move {
        json_request(&router, "POST", &path, &bearer, Some(json!({
            "version": "2026-10-12", "language": "en",
            "choices": {"agency_processing": true, "doctors_to_agency": true, "data_system": true}
        }))).await
    });
    wait_for_cabinet_lead_lock(pool, blocker_pid).await;
    // A concurrent submission finishes after the choice transaction started.
    sqlx::query("UPDATE leads SET portal_submitted_at=clock_timestamp() WHERE id=$1")
        .bind(lead)
        .execute(&mut *sending)
        .await
        .unwrap();
    sending.commit().await.unwrap();
    let (status, body) = choice.await.unwrap();
    assert_eq!(status, StatusCode::CREATED, "{body}");
    let newer: bool = sqlx::query_scalar(
        "SELECT c.chosen_at > l.portal_submitted_at FROM consent_form_choices c
         JOIN leads l ON l.id=c.lead_id WHERE l.id=$1 ORDER BY c.seq DESC LIMIT 1",
    )
    .bind(lead)
    .fetch_one(pool)
    .await
    .unwrap();
    assert!(
        newer,
        "the choice time must be taken after acquiring the lock"
    );
    let (status, current) = json_request(&app.suite.app, "GET", &base, &patient, None).await;
    assert_eq!(status, StatusCode::OK, "{current}");
    assert_eq!(current["changed_since_submit"], true, "{current}");
}

#[tokio::test]
async fn follow_up_after_waiting_for_an_edit_consumes_that_edit_once() {
    let Some(app) = test_app().await else { return };
    let pool = &app.suite.pool;
    let (lead, _, patient) = lead_with_login(&app, "Clock", "followup.clock@example.com").await;
    fill_in_complete_request(&app.suite.app, lead, &patient).await;
    let base = format!("/api/v1/me/lead-requests/{lead}");
    let (status, body) = json_request(
        &app.suite.app,
        "POST",
        &format!("{base}/submit"),
        &patient,
        declared(),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    // Setup writes are unrelated to the lock-order regression. Keep their
    // values and files, but give only their timestamps a fixed past baseline:
    // Docker's wall clock can jump backwards between these setup requests.
    // The new statements marker and the API's answer below remain untouched.
    sqlx::query(
        "UPDATE leads l SET portal_field_updates = COALESCE(
            (SELECT jsonb_object_agg(f.key, jsonb_set(f.value, '{at}',
                to_jsonb(TIMESTAMPTZ '2000-01-01 00:00:00+00')))
             FROM jsonb_each(l.portal_field_updates) f), '{}'::jsonb)
         WHERE l.id=$1",
    )
    .bind(lead)
    .execute(pool)
    .await
    .unwrap();
    sqlx::query(
        "UPDATE lead_portal_uploads SET created_at=TIMESTAMPTZ '2000-01-01 00:00:00+00',
            withdrawn_at=CASE WHEN withdrawn_at IS NOT NULL
                THEN TIMESTAMPTZ '2000-01-01 00:00:00+00' END
         WHERE lead_id=$1",
    )
    .bind(lead)
    .execute(pool)
    .await
    .unwrap();
    sqlx::query("UPDATE lead_risk_assessments SET requested_blocks=ARRAY['K'], follow_up_answered_at=NULL WHERE lead_id=$1")
        .bind(lead).execute(pool).await.unwrap();
    let mut editing = pool.begin().await.unwrap();
    sqlx::query("SELECT id FROM leads WHERE id=$1 FOR UPDATE")
        .bind(lead)
        .execute(&mut *editing)
        .await
        .unwrap();
    let blocker_pid: i32 = sqlx::query_scalar("SELECT pg_backend_pid()")
        .fetch_one(&mut *editing)
        .await
        .unwrap();
    let router = app.suite.app.clone();
    let bearer = patient.clone();
    let path = format!("{base}/follow-up/submit");
    let sending =
        tokio::spawn(async move { json_request(&router, "POST", &path, &bearer, None).await });
    wait_for_cabinet_lead_lock(pool, blocker_pid).await;
    sqlx::query("UPDATE leads SET portal_field_updates=portal_field_updates || jsonb_build_object('statements', jsonb_build_object('at',clock_timestamp())) WHERE id=$1")
        .bind(lead).execute(&mut *editing).await.unwrap();
    editing.commit().await.unwrap();
    let (status, body) = sending.await.unwrap();
    assert_eq!(status, StatusCode::OK, "{body}");
    let target_times: Value = sqlx::query_scalar(
        "SELECT jsonb_build_object(
            'target_marker', (l.portal_field_updates->'statements'->>'at')::timestamptz,
            'answered_at', a.follow_up_answered_at,
            'answer_after_target', a.follow_up_answered_at >
                (l.portal_field_updates->'statements'->>'at')::timestamptz)
         FROM leads l JOIN lead_risk_assessments a ON a.lead_id=l.id WHERE l.id=$1",
    )
    .bind(lead)
    .fetch_one(pool)
    .await
    .unwrap();
    assert_eq!(
        target_times["answer_after_target"], true,
        "the answer must be timed after the edit whose lock it awaited: {target_times}"
    );
    assert_eq!(
        body["follow_up"]["changed_since_answer"], false,
        "target_times={target_times}; request={body}"
    );
    let answered_at = body["follow_up"]["answered_at"].clone();
    let (status, again) = json_request(
        &app.suite.app,
        "POST",
        &format!("{base}/follow-up/submit"),
        &patient,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{again}");
    assert_eq!(again["follow_up"]["answered_at"], answered_at);
    let events: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM lead_risk_events WHERE lead_id=$1 AND kind='follow_up_answered'",
    )
    .bind(lead)
    .fetch_one(pool)
    .await
    .unwrap();
    assert_eq!(events, 1);
}

#[tokio::test]
async fn representative_follow_up_tracks_files_and_requires_current_inquiry_consent() {
    let Some(app) = test_app().await else { return };
    let router = &app.suite.app;
    let pool = &app.suite.pool;
    let (lead, _, patient) = lead_with_login(&app, "Files", "followup.files@example.com").await;
    fill_in_complete_request(router, lead, &patient).await;
    let base = format!("/api/v1/me/lead-requests/{lead}");
    let send = format!("{base}/follow-up/submit");
    let (status, body) = json_request(
        router,
        "POST",
        &format!("{base}/submit"),
        &patient,
        declared(),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let (status, body) = json_request(
        router,
        "POST",
        &format!("{base}/representation"),
        &patient,
        Some(json!({"has_representative": true, "under_guardianship": false})),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let agent = Uuid::new_v4();
    let person = format!("{base}/representatives/{agent}");
    let (status, body) = json_request(router, "POST", &person, &patient, Some(json!({
        "role": "authorised_representative", "first_name": "Alex", "last_name": "Example",
        "date_of_birth": "1980-01-01", "street": "Example 1", "zip": "10115", "city": "Berlin", "country": "DE"
    }))).await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    let mut documents = Vec::new();
    for (kind, key) in [
        ("identity-document", "identity_documents"),
        ("authority-document", "authority_documents"),
    ] {
        let (status, body) = upload_file(
            router,
            &format!("{person}/{kind}"),
            &patient,
            "representative.pdf",
            "application/pdf",
            PDF,
        )
        .await;
        assert_eq!(status, StatusCode::CREATED, "{body}");
        documents.push(
            body["representation"]["representatives"][0][key][0]["id"]
                .as_str()
                .unwrap()
                .to_string(),
        );
    }
    // Staff explicitly requested G; it remains open after the answer is complete.
    sqlx::query("UPDATE lead_risk_assessments SET requested_blocks=ARRAY['G'], follow_up_answered_at=NULL WHERE lead_id=$1")
        .bind(lead).execute(pool).await.unwrap();
    let (status, body) = json_request(router, "POST", &send, &patient, None).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["follow_up"]["changed_since_answer"], false, "{body}");
    let answered_at = body["follow_up"]["answered_at"].clone();
    // Removing required evidence must reopen the answer, and cannot pass as an unchanged retry.
    let (status, body) = json_request(
        router,
        "DELETE",
        &format!("{base}/documents/{}", documents[1]),
        &patient,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["follow_up"]["changed_since_answer"], true, "{body}");
    let (status, refusal) = json_request(router, "POST", &send, &patient, None).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{refusal}");
    assert_eq!(refusal["code"], "follow_up_incomplete");
    assert!(
        refusal["missing"]["G"]
            .as_array()
            .unwrap()
            .contains(&json!("agent_authority_upload"))
    );
    // The same missing state must be rejected even without a newer portal timestamp
    // (for example, staff discover that existing evidence no longer satisfies the request).
    sqlx::query(
        "UPDATE lead_risk_assessments SET follow_up_answered_at=clock_timestamp() WHERE lead_id=$1",
    )
    .bind(lead)
    .execute(pool)
    .await
    .unwrap();
    let (status, refusal) = json_request(router, "POST", &send, &patient, None).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{refusal}");
    assert_eq!(refusal["code"], "follow_up_incomplete");
    let (status, body) = upload_file(
        router,
        &format!("{person}/authority-document"),
        &patient,
        "replacement.pdf",
        "application/pdf",
        PDF,
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    assert_eq!(body["follow_up"]["changed_since_answer"], true, "{body}");
    let (status, body) = json_request(
        router,
        "POST",
        &format!("{base}/consent/revoke"),
        &patient,
        Some(json!({"purpose": "lead_inquiry_processing"})),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let (status, refusal) = json_request(router, "POST", &send, &patient, None).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{refusal}");
    assert_eq!(refusal["code"], "inquiry_consent_required");
    give_consent(router, lead, &patient, "lead_inquiry_processing").await;
    let (status, body) = json_request(router, "POST", &send, &patient, None).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["follow_up"]["changed_since_answer"], false, "{body}");
    assert_ne!(body["follow_up"]["answered_at"], answered_at);
    let (status, again) = json_request(router, "POST", &send, &patient, None).await;
    assert_eq!(status, StatusCode::OK, "{again}");
    assert_eq!(
        again["follow_up"]["answered_at"],
        body["follow_up"]["answered_at"]
    );
}

/// An explicit decision fixture; the production UI never presets these answers.
fn confirmed_disclosure(persons: Value, allow: bool) -> Value {
    json!({ "persons":persons, "allow_disclosure":allow, "consent_given":allow,
        "version":"2026-10-14", "language":"de" })
}

/// A trusted person with one scope code (owner 2026-10-19).
fn disclosure_person(name: &str, scope_code: &str) -> Value {
    json!({ "name":name, "relation":"friend", "scope_codes":[scope_code] })
}

async fn save_disclosure(
    router: &axum::Router,
    lead: Uuid,
    bearer: &str,
    body: Value,
) -> (StatusCode, Value) {
    json_request(
        router,
        "POST",
        &format!("/api/v1/me/lead-requests/{lead}/trusted-persons"),
        bearer,
        Some(body),
    )
    .await
}

fn assert_disclosure_receipt(receipt: &Value, allow: bool, chooser: Uuid, kind: &str) {
    assert_eq!(receipt["allow_disclosure"], allow, "{receipt}");
    assert_eq!(receipt["consent_given"], allow, "{receipt}");
    assert_eq!(receipt["version"], "2026-10-14", "{receipt}");
    assert_eq!(receipt["language"], "de", "{receipt}");
    assert_eq!(receipt["chosen_by"], json!(chooser), "{receipt}");
    assert_eq!(receipt["access_kind"], kind, "{receipt}");
    assert!(
        chrono::DateTime::parse_from_rfc3339(receipt["chosen_at"].as_str().unwrap()).is_ok(),
        "{receipt}"
    );
    assert!(
        receipt["company_name"]
            .as_str()
            .is_some_and(|name| !name.trim().is_empty()),
        "{receipt}"
    );
}

#[tokio::test]
async fn patient_form_disclosure_matches_the_cabinet_and_consent_and_rejects_stale_people() {
    let Some(app) = test_app().await else { return };
    let router = &app.suite.app;
    let pool = &app.suite.pool;
    let pm = app.staff("patient_manager");
    let (lead, user, patient) = lead_with_login(&app, "Form", "form.disclosure@example.com").await;
    let persons = json!([
        { "name": "Max Named", "relation": "friend", "contact": "max@example.test", "scope_codes": ["financial"] },
        { "name": "Olga Named", "relation": "relative", "contact": "+49 151 000000", "scope_codes": ["medical", "organisational"] }
    ]);
    // The contact is a phone number or an e-mail address, nothing else (QA 2026-10-22).
    let (status, refused) = save_disclosure(
        router,
        lead,
        &patient,
        confirmed_disclosure(
            json!([{ "name": "Max Named", "relation": "friend", "contact": "über Tochter", "scope_codes": ["financial"] }]),
            true,
        ),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{refused}");
    assert_eq!(refused["code"], "consent_recipients_invalid", "{refused}");
    assert_eq!(refused["field"], "contact", "{refused}");
    let (status, decision) = save_disclosure(
        router,
        lead,
        &patient,
        confirmed_disclosure(persons.clone(), true),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{decision}");
    let choices = json!({"agency_processing":true,"doctors_to_agency":true,"data_system":true,"named_recipients":true});
    let (status, chosen) = choose(router, lead, &patient, &choices).await;
    assert_eq!(status, StatusCode::CREATED, "{chosen}");
    sqlx::query("UPDATE leads SET portal_submitted_at=clock_timestamp(),portal_submitted_by=$2,portal_field_updates='{}' WHERE id=$1")
        .bind(lead).bind(user).execute(pool).await.unwrap();
    let mut generated_ids = Vec::new();
    for template in ["lead_self_disclosure", "privacy_consents"] {
        let (status, generated) = json_request(
            router,
            "POST",
            "/api/v1/documents/generate",
            &pm,
            Some(json!({"template_id":template,"lead_id":lead,"language":"de"})),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{generated}");
        let id: Uuid = generated["id"].as_str().unwrap().parse().unwrap();
        generated_ids.push(id);
        let recorded: Value = sqlx::query_scalar(
            "SELECT generated_bindings->'_own_consent_choice' FROM documents WHERE id=$1",
        )
        .bind(id)
        .fetch_one(pool)
        .await
        .unwrap();
        assert_eq!(recorded["recipients"], persons, "{recorded}");
        assert_eq!(recorded["disclosure"], decision["disclosure"], "{recorded}");
        let text = document_pdf_text(router, id, &pm).await;
        for person in persons.as_array().unwrap() {
            for field in ["name", "contact"] {
                assert!(
                    text.contains(person[field].as_str().unwrap()),
                    "{field}: {text}"
                );
            }
        }
        // The chosen scope is printed in words right with each person.
        for scope in [
            "max@example.test; Umfang der Auskunft: finanzielle Informationen",
            "+49 151 000000; Umfang der Auskunft: medizinische und organisatorische Informationen",
        ] {
            assert!(text.contains(scope), "{scope}: {text}");
        }
        // Anlage 1 names the persons once, under item 4 (c184f570); the
        // patient form keeps its Ja/Nein question.
        let ticked = if template == "privacy_consents" {
            "[x] dass meine personenbezogenen und medizinischen Daten an folgende Personen"
        } else {
            "[x] Ja, folgende Person(en)"
        };
        assert!(text.contains(ticked), "{text}");
        assert!(!text.contains("Kundenkabinett"), "{text}");
        assert!(!text.contains("Textversion"), "{text}");
    }
    let form = generated_ids[0];
    let marked: bool = sqlx::query_scalar("SELECT (generated_bindings->>'_third_party_disclosure_recorded')::boolean FROM documents WHERE id=$1")
        .bind(form).fetch_one(pool).await.unwrap();
    assert!(marked);
    let invitation = Uuid::new_v4();
    sqlx::query(r#"INSERT INTO document_signature_requests (id,source_document_id,requested_by,source_sha256,
        source_context,signers,provider_account,test_mode,status,level,minimum_level)
        VALUES($1,$2,$3,$4,'{}','[]','trusted-persons-test',true,'pending','QES','QES')"#)
        .bind(invitation).bind(form).bind(app.patient_manager_id).bind("a".repeat(64)).execute(pool).await.unwrap();
    let mut channel_change = choices.clone();
    channel_change["channel_email"] = json!(true);
    let (status, changed) = choose(router, lead, &patient, &channel_change).await;
    assert_eq!(status, StatusCode::CREATED, "{changed}");
    let (_, current) = json_request(
        router,
        "GET",
        &format!("/api/v1/documents/{form}/signature-requests"),
        &pm,
        None,
    )
    .await;
    assert_eq!(current["ineligible_reason"], Value::Null, "{current}");
    let pending: String =
        sqlx::query_scalar("SELECT status FROM document_signature_requests WHERE id=$1")
            .bind(invitation)
            .fetch_one(pool)
            .await
            .unwrap();
    assert_eq!(
        pending, "pending",
        "channel edits must preserve this invitation"
    );
    let changed_persons = json!([{ "name": "Different Named", "relation": "spouse", "contact": "other@example.test", "scope_codes": ["medical"] }]);
    let (status, changed) = save_disclosure(
        router,
        lead,
        &patient,
        confirmed_disclosure(changed_persons, true),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{changed}");
    for id in generated_ids {
        let (_, state) = json_request(
            router,
            "GET",
            &format!("/api/v1/documents/{id}/signature-requests"),
            &pm,
            None,
        )
        .await;
        assert_eq!(
            state["ineligible_reason"], "consent_choice_changed",
            "{state}"
        );
    }
    let status: String =
        sqlx::query_scalar("SELECT status FROM document_signature_requests WHERE id=$1")
            .bind(invitation)
            .fetch_one(pool)
            .await
            .unwrap();
    assert_eq!(status, "error");
    let mut legacy: Value =
        sqlx::query_scalar("SELECT generated_bindings FROM documents WHERE id=$1")
            .bind(form)
            .fetch_one(pool)
            .await
            .unwrap();
    legacy
        .as_object_mut()
        .unwrap()
        .remove(gmed_server::consent_choices::PATIENT_FORM_DISCLOSURE_KEY);
    assert_eq!(
        gmed_server::consent_choices::changed_since_generation(
            pool,
            Some("lead_self_disclosure"),
            Some(&legacy),
            Some(lead),
            None,
        )
        .await
        .unwrap(),
        None,
        "legacy signed forms keep their original evidence"
    );
    let text = document_pdf_text(router, form, &pm).await;
    assert!(
        text.contains("Max Named") && !text.contains("Different Named"),
        "old PDFs remain immutable: {text}"
    );
}

#[tokio::test]
async fn trusted_persons_require_an_explicit_decision_consent_and_a_scope_for_each_person() {
    let Some(app) = test_app().await else { return };
    let router = &app.suite.app;
    let pool = &app.suite.pool;
    let (lead, user, patient) = lead_with_login(&app, "Vera", "vera.disclosure@example.com").await;
    sqlx::query("UPDATE system_settings SET value=$1 WHERE key='agency_name'")
        .bind(json!("Synthetic Agency GmbH"))
        .execute(pool)
        .await
        .unwrap();
    let request = format!("/api/v1/me/lead-requests/{lead}");
    let (_, initial) = json_request(router, "GET", &request, &patient, None).await;
    assert_eq!(initial["trusted_persons"], json!([]), "{initial}");
    assert_eq!(
        initial["disclosure"],
        Value::Null,
        "no approval in advance: {initial}"
    );
    assert_eq!(
        initial["disclosure_company_name"], "Synthetic Agency GmbH",
        "{initial}"
    );
    for invalid in [
        json!([{ "name":" ","relation":"friend","scope_codes":["organisational"] }]),
        json!([{ "name":"Max","relation":"neighbour","scope_codes":["organisational"] }]),
        json!([{ "name":"x".repeat(121),"relation":"friend","scope_codes":["organisational"] }]),
        json!([{ "name":"Max","relation":"friend","contact":"x".repeat(121),"scope_codes":["organisational"] }]),
        json!([{ "name":"Max","relation":"friend" }]),
        json!([{ "name":"Max","relation":"friend","scope_codes":[] }]),
        // A legacy free text alone is asked again (owner 2026-10-19).
        json!([{ "name":"Max","relation":"friend","scope":"medizin" }]),
        json!(vec![disclosure_person("Max", "organisational"); 6]),
    ] {
        let (status, body) =
            save_disclosure(router, lead, &patient, confirmed_disclosure(invalid, true)).await;
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
        assert_eq!(body["code"], "consent_recipients_invalid", "{body}");
    }
    for unknown in [json!(["medizin"]), json!(["medical", "everything"])] {
        let (status, body) = save_disclosure(
            router,
            lead,
            &patient,
            confirmed_disclosure(
                json!([{ "name":"Max","relation":"friend","scope_codes":unknown }]),
                true,
            ),
        )
        .await;
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
        assert_eq!(body["code"], "invalid_field", "{body}");
        assert_eq!(body["field"], "scope_codes", "{body}");
    }
    for (invalid, code) in [
        (
            confirmed_disclosure(json!([]), true),
            "consent_recipients_required",
        ),
        (
            json!({"persons":[disclosure_person("Max","organisational")],"allow_disclosure":true,"consent_given":false,
            "version":"2026-10-14","language":"de"}),
            "disclosure_consent_required",
        ),
        (
            confirmed_disclosure(json!([disclosure_person("Max", "organisational")]), false),
            "disclosure_decision_invalid",
        ),
        (
            json!({"persons":[],"allow_disclosure":false,"consent_given":true,
            "version":"2026-10-14","language":"de"}),
            "disclosure_decision_invalid",
        ),
    ] {
        let (status, body) = save_disclosure(router, lead, &patient, invalid).await;
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
        assert_eq!(body["code"], code, "{body}");
    }
    for invalid in [
        json!({"persons":[disclosure_person("Max","organisational")]}),
        json!({"persons":[],"allow_disclosure":false,"consent_given":false,"version":"2026-10-14",
            "language":"de","acts_for_patient":true}),
    ] {
        let (status, body) = save_disclosure(router, lead, &patient, invalid).await;
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
    }
    let mut outdated = confirmed_disclosure(json!([]), false);
    outdated["version"] = json!("2026-10-12");
    let (status, body) = save_disclosure(router, lead, &patient, outdated).await;
    assert_eq!(status, StatusCode::CONFLICT, "{body}");
    assert_eq!(body["code"], "disclosure_version_outdated", "{body}");
    let (status, refused) = json_request(
        router,
        "POST",
        &format!("{request}/consent-choices"),
        &patient,
        Some(
            json!({ "choices": { "agency_processing": true, "doctors_to_agency": true,
            "data_system": true, "named_recipients": true },
            "recipients": [disclosure_person("Max", "organisational")],
            "version": "2026-10-12", "language": "de" }),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{refused}");
    assert_eq!(
        refused["code"], "disclosure_consent_required",
        "a core checkbox cannot create a fresh scoped disclosure: {refused}"
    );
    let rows: i64 =
        sqlx::query_scalar("SELECT count(*) FROM consent_form_choices WHERE lead_id=$1")
            .bind(lead)
            .fetch_one(pool)
            .await
            .unwrap();
    assert_eq!(rows, 0, "refusals create no decision receipt");
    let cleaned =
        json!([{ "name":"Max Muster","relation":"friend","scope_codes":["medical","financial"] }]);
    let (status,body)=save_disclosure(router,lead,&patient,confirmed_disclosure(
        json!([{ "name":"  Max   Muster ","relation":" friend ","contact":"","scope":"medizin","scope_codes":["financial"," medical","medical"] }]),true)).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["trusted_persons"], cleaned, "{body}");
    assert_disclosure_receipt(&body["disclosure"], true, user, "self");
    assert_eq!(
        body["disclosure"]["company_name"], "Synthetic Agency GmbH",
        "{body}"
    );
    assert_eq!(
        body["consent_form"]["choices"],
        Value::Null,
        "core questions remain unanswered: {body}"
    );
    let initial_flags: Value = sqlx::query_scalar(
        "SELECT choices FROM consent_form_choices WHERE lead_id=$1 ORDER BY seq DESC LIMIT 1",
    )
    .bind(lead)
    .fetch_one(pool)
    .await
    .unwrap();
    assert_eq!(initial_flags["named_recipients"], true, "{initial_flags}");
    for key in [
        "agency_processing",
        "doctors_to_agency",
        "data_system",
        "channel_email",
        "channel_threema",
        "channel_whatsapp",
        "channel_telegram",
    ] {
        assert_eq!(
            initial_flags[key], false,
            "disclosure is not core consent: {body}"
        );
    }
    let (context,marker):(Value,Value)=sqlx::query_as(r#"SELECT
        (SELECT context FROM audit_log WHERE action='lead_portal_trusted_persons_saved' AND entity_id=$1),
        portal_field_updates->'trusted_persons' FROM leads WHERE id=$1"#).bind(lead).fetch_one(pool).await.unwrap();
    assert_eq!(context["count"], 1, "{context}");
    assert_eq!(context["access_kind"], "self", "{context}");
    assert!(
        !context.to_string().contains("Max") && !context.to_string().contains("Medizinische"),
        "no personal data in audit: {context}"
    );
    assert_eq!(marker["by"], json!(user), "{marker}");
    let (status, staff) = json_request(
        router,
        "GET",
        &format!("/api/v1/leads/{lead}/portal-intake"),
        &app.staff("patient_manager"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{staff}");
    assert_eq!(staff["trusted_persons"], cleaned, "{staff}");
    assert_eq!(staff["disclosure"], body["disclosure"], "{staff}");
    let (status, staff) = json_request(
        router,
        "GET",
        &format!("/api/v1/leads/{lead}/portal-intake"),
        &app.staff("concierge"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{staff}");
    assert_eq!(staff["trusted_persons"], Value::Null, "{staff}");
    assert_eq!(staff["disclosure"], Value::Null, "{staff}");
    let (status, body) = save_disclosure(
        router,
        lead,
        &app.staff("patient_manager"),
        confirmed_disclosure(json!([]), false),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN, "{body}");
    let (minor, _, child) = lead_with_login(&app, "Mia", "mia.disclosure@example.com").await;
    sqlx::query("UPDATE leads SET date_of_birth='2015-05-10' WHERE id=$1")
        .bind(minor)
        .execute(pool)
        .await
        .unwrap();
    let (status, body) = save_disclosure(
        router,
        minor,
        &child,
        confirmed_disclosure(json!([]), false),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN, "{body}");
    assert_eq!(body["code"], "lead_request_guardian_only", "{body}");
}

#[tokio::test]
async fn core_consent_preserves_the_explicit_disclosure_receipt_but_cannot_change_its_people() {
    let Some(app) = test_app().await else { return };
    let router = &app.suite.app;
    let pool = &app.suite.pool;
    let (lead, user, patient) =
        lead_with_login(&app, "Ella", "ella.disclosure.core@example.com").await;
    let request = format!("/api/v1/me/lead-requests/{lead}");
    let persons = json!([disclosure_person("Max Muster", "organisational")]);
    let (status, decision) = save_disclosure(
        router,
        lead,
        &patient,
        confirmed_disclosure(persons.clone(), true),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{decision}");
    let named = json!({"agency_processing":true,"doctors_to_agency":true,"data_system":true,"named_recipients":true,
        "channel_email":true,"channel_threema":false,"channel_whatsapp":false,"channel_telegram":true});
    let (status, saved) = choose(router, lead, &patient, &named).await;
    assert_eq!(status, StatusCode::CREATED, "{saved}");
    assert_eq!(saved["recipients"], persons, "{saved}");
    let (_, current) = json_request(router, "GET", &request, &patient, None).await;
    assert_eq!(
        current["disclosure"], decision["disclosure"],
        "a core save preserves the explicit receipt: {current}"
    );
    let old_row: Value = sqlx::query_scalar(
        "SELECT to_jsonb(c) FROM consent_form_choices c WHERE lead_id=$1 ORDER BY seq DESC LIMIT 1",
    )
    .bind(lead)
    .fetch_one(pool)
    .await
    .unwrap();
    for changed in [
        json!([disclosure_person("Different Person", "financial")]),
        json!([disclosure_person("Max Muster", "medical")]),
    ] {
        let (status,refused)=json_request(router,"POST",&format!("{request}/consent-choices"),&patient,
            Some(json!({"choices":named,"recipients":changed,"version":"2026-10-12","language":"de"}))).await;
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{refused}");
        assert_eq!(refused["code"], "disclosure_consent_required", "{refused}");
    }
    let mut withdrawn = named.clone();
    withdrawn["named_recipients"] = json!(false);
    let (status,saved)=json_request(router,"POST",&format!("{request}/consent-choices"),&patient,
        Some(json!({"choices":withdrawn,"recipients":[{"name":"","relation":"invalid","contact":"x".repeat(121)}],
            "version":"2026-10-12","language":"de"}))).await;
    assert_eq!(status, StatusCode::CONFLICT, "{saved}");
    assert_eq!(
        saved["code"], "disclosure_choice_changed",
        "a stale core form must not silently revoke disclosure: {saved}"
    );
    let (_, current) = json_request(router, "GET", &request, &patient, None).await;
    assert_eq!(current["disclosure"], decision["disclosure"], "{current}");
    let (status, saved) = save_disclosure(
        router,
        lead,
        &patient,
        confirmed_disclosure(json!([]), false),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{saved}");
    let (_, current) = json_request(router, "GET", &request, &patient, None).await;
    assert_disclosure_receipt(&current["disclosure"], false, user, "self");
    let unchanged: Value =
        sqlx::query_scalar("SELECT to_jsonb(c) FROM consent_form_choices c WHERE id=$1")
            .bind(old_row["id"].as_str().unwrap().parse::<Uuid>().unwrap())
            .fetch_one(pool)
            .await
            .unwrap();
    assert_eq!(
        unchanged, old_row,
        "historical choices and receipt are immutable"
    );
    let (status, refused) = choose(router, lead, &patient, &named).await;
    assert_eq!(status, StatusCode::CONFLICT, "{refused}");
    assert_eq!(
        refused["code"], "disclosure_choice_changed",
        "core checkbox cannot grant disclosure again: {refused}"
    );
}

#[tokio::test]
async fn a_no_disclosure_decision_preserves_core_flags_and_invalidates_old_invitations() {
    let Some(app) = test_app().await else { return };
    let router = &app.suite.app;
    let pool = &app.suite.pool;
    let (lead, user, patient) =
        lead_with_login(&app, "Nora", "nora.disclosure.no@example.com").await;
    let request = format!("/api/v1/me/lead-requests/{lead}");
    let (status, decision) = save_disclosure(
        router,
        lead,
        &patient,
        confirmed_disclosure(json!([disclosure_person("Max Muster", "medical")]), true),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{decision}");
    let chosen = json!({"agency_processing":true,"doctors_to_agency":true,"data_system":true,"named_recipients":true,
        "channel_email":true,"channel_threema":true,"channel_whatsapp":false,"channel_telegram":true});
    let (status, body) = choose(router, lead, &patient, &chosen).await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    let old_choice: Value = sqlx::query_scalar(
        "SELECT to_jsonb(c) FROM consent_form_choices c WHERE lead_id=$1 ORDER BY seq DESC LIMIT 1",
    )
    .bind(lead)
    .fetch_one(pool)
    .await
    .unwrap();
    let document = Uuid::new_v4();
    sqlx::query(r#"INSERT INTO documents (id,version_root_document_id,lead_id,auto_name,art,category,status,
        visibility,is_medical,uploaded_by,generated_template_id)
        VALUES($1,$1,$2,'Synthetic consent','report','medical','active','internal',false,$3,'privacy_consents')"#)
        .bind(document).bind(lead).bind(app.patient_manager_id).execute(pool).await.unwrap();
    let invitation = Uuid::new_v4();
    let lease = Uuid::new_v4();
    sqlx::query(r#"INSERT INTO document_signature_requests (id,source_document_id,requested_by,source_sha256,
        source_context,signers,provider_account,test_mode,status,level,minimum_level,lease_token,lease_until)
        VALUES($1,$2,$3,$4,'{}','[]','trusted-persons-test',true,'pending','QES','QES',$5,now()+interval '10 minutes')"#)
        .bind(invitation).bind(document).bind(app.patient_manager_id).bind("a".repeat(64)).bind(lease).execute(pool).await.unwrap();
    sqlx::query("UPDATE leads SET portal_submitted_at=clock_timestamp(),portal_submitted_by=$2,portal_field_updates='{}' WHERE id=$1")
        .bind(lead).bind(user).execute(pool).await.unwrap();
    let (_, before) = json_request(router, "GET", &request, &patient, None).await;
    assert_eq!(before["changed_since_submit"], false, "{before}");
    let (status, body) = save_disclosure(
        router,
        lead,
        &patient,
        confirmed_disclosure(json!([]), false),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["trusted_persons"], json!([]), "{body}");
    assert_eq!(body["consent_form"]["recipients"], json!([]), "{body}");
    assert_disclosure_receipt(&body["disclosure"], false, user, "self");
    let mut expected = chosen;
    expected["named_recipients"] = json!(false);
    assert_eq!(body["consent_form"]["choices"], expected, "{body}");
    assert_eq!(body["changed_since_submit"], true, "{body}");
    let unchanged: Value =
        sqlx::query_scalar("SELECT to_jsonb(c) FROM consent_form_choices c WHERE id=$1")
            .bind(old_choice["id"].as_str().unwrap().parse::<Uuid>().unwrap())
            .fetch_one(pool)
            .await
            .unwrap();
    assert_eq!(
        unchanged, old_choice,
        "old consent evidence stays unchanged"
    );
    let closed: Value =
        sqlx::query_scalar("SELECT to_jsonb(r) FROM document_signature_requests r WHERE id=$1")
            .bind(invitation)
            .fetch_one(pool)
            .await
            .unwrap();
    assert_eq!(closed["status"], "error", "{closed}");
    assert_eq!(closed["last_error"], "consent_choice_changed", "{closed}");
    assert_eq!(closed["closed_by"], json!(user), "{closed}");
    assert!(
        closed["lease_token"].is_null() && closed["lease_until"].is_null(),
        "{closed}"
    );
    assert_eq!(
        audit_count(pool, "document_signature_consent_invalidated", document).await,
        1
    );
    let (_, staff) = json_request(
        router,
        "GET",
        &format!("/api/v1/leads/{lead}/portal-intake"),
        &app.staff("patient_manager"),
        None,
    )
    .await;
    assert_eq!(staff["changed_since_submit"], true, "{staff}");
}

#[tokio::test]
async fn a_guardian_changes_disclosure_only_for_an_active_link_and_owns_the_receipt() {
    let Some(app) = test_app().await else { return };
    let router = &app.suite.app;
    let pool = &app.suite.pool;
    let (lead, contact) =
        minor_lead(&app, "LinaTrusted", "lina.disclosure.parent@example.com").await;
    let (status, issued) = json_request(
        router,
        "POST",
        &format!("/api/v1/leads/{lead}/portal-guardians"),
        &app.staff("patient_manager"),
        Some(json!({"trusted_contact_id":contact})),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{issued}");
    let guardian: Uuid = issued["user_id"].as_str().unwrap().parse().unwrap();
    let access: Uuid = issued["access_id"].as_str().unwrap().parse().unwrap();
    let parent = bearer(guardian, "patient");
    let persons = json!([disclosure_person("Oma Muster", "organisational")]);
    let (status, body) =
        save_disclosure(router, lead, &parent, confirmed_disclosure(persons, true)).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_disclosure_receipt(&body["disclosure"], true, guardian, "guardian");
    let changed = json!([disclosure_person("Oma Muster", "medical")]);
    let (status, body) = save_disclosure(
        router,
        lead,
        &parent,
        confirmed_disclosure(changed.clone(), true),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_disclosure_receipt(&body["disclosure"], true, guardian, "guardian");
    let (chosen_by,kind,recipients,receipt):(Uuid,String,Value,Value)=sqlx::query_as(
        "SELECT chosen_by,access_kind,recipients,disclosure FROM consent_form_choices WHERE lead_id=$1 ORDER BY seq DESC LIMIT 1",
    ).bind(lead).fetch_one(pool).await.unwrap();
    assert_eq!(chosen_by, guardian);
    assert_eq!(kind, "guardian");
    assert_eq!(recipients, changed);
    assert_eq!(receipt, body["disclosure"]);
    let (_, _, foreign) =
        lead_with_login(&app, "ForeignDisclosure", "foreign.disclosure@example.com").await;
    let (status, body) = save_disclosure(
        router,
        lead,
        &foreign,
        confirmed_disclosure(json!([]), false),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND, "{body}");
    sqlx::query("UPDATE lead_portal_access SET revoked_at=now() WHERE id=$1")
        .bind(access)
        .execute(pool)
        .await
        .unwrap();
    let (status, body) = save_disclosure(
        router,
        lead,
        &parent,
        confirmed_disclosure(json!([]), false),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND, "{body}");
    let (stored,count):(Value,i64)=sqlx::query_as(
        "SELECT portal_trusted_persons,(SELECT count(*) FROM consent_form_choices WHERE lead_id=$1) FROM leads WHERE id=$1",
    ).bind(lead).fetch_one(pool).await.unwrap();
    assert_eq!(stored, changed);
    assert_eq!(count, 2, "refused writes append no choice or receipt");
}

#[tokio::test]
async fn every_explicit_disclosure_save_records_the_current_guardian_and_language() {
    let Some(app) = test_app().await else { return };
    let router = &app.suite.app;
    let pool = &app.suite.pool;
    let (lead, _) = minor_lead(
        &app,
        "RepeatedDisclosure",
        "unused.disclosure.parent@example.com",
    )
    .await;
    let first = seed_user(pool, "disclosure-first-parent", "patient").await;
    let second = seed_user(pool, "disclosure-second-parent", "patient").await;
    for parent in [first, second] {
        sqlx::query("INSERT INTO lead_portal_access (lead_id,user_id,kind,created_by) VALUES($1,$2,'guardian',$3)")
            .bind(lead).bind(parent).bind(app.patient_manager_id).execute(pool).await.unwrap();
    }
    let persons = json!([disclosure_person("Oma Muster", "all")]);
    let body = confirmed_disclosure(persons.clone(), true);
    let (status, saved) =
        save_disclosure(router, lead, &bearer(first, "patient"), body.clone()).await;
    assert_eq!(status, StatusCode::OK, "{saved}");
    assert_disclosure_receipt(&saved["disclosure"], true, first, "guardian");
    let original: Value = sqlx::query_scalar(
        "SELECT to_jsonb(c) FROM consent_form_choices c WHERE lead_id=$1 ORDER BY seq DESC LIMIT 1",
    )
    .bind(lead)
    .fetch_one(pool)
    .await
    .unwrap();
    let (status, again) =
        save_disclosure(router, lead, &bearer(first, "patient"), body.clone()).await;
    assert_eq!(status, StatusCode::OK, "{again}");
    assert_disclosure_receipt(&again["disclosure"], true, first, "guardian");
    let (status, other) = save_disclosure(router, lead, &bearer(second, "patient"), body).await;
    assert_eq!(status, StatusCode::OK, "{other}");
    assert_disclosure_receipt(&other["disclosure"], true, second, "guardian");
    let mut russian = confirmed_disclosure(persons, true);
    russian["language"] = json!("ru");
    let (status, translated) =
        save_disclosure(router, lead, &bearer(second, "patient"), russian).await;
    assert_eq!(status, StatusCode::OK, "{translated}");
    assert_eq!(
        translated["disclosure"]["chosen_by"],
        json!(second),
        "{translated}"
    );
    assert_eq!(translated["disclosure"]["language"], "ru", "{translated}");
    assert!(
        translated["disclosure"]["consent_text"]
            .as_str()
            .unwrap()
            .starts_with("Я даю явное согласие"),
        "{translated}"
    );
    let rows: i64 =
        sqlx::query_scalar("SELECT count(*) FROM consent_form_choices WHERE lead_id=$1")
            .bind(lead)
            .fetch_one(pool)
            .await
            .unwrap();
    assert_eq!(
        rows, 4,
        "each explicit save is a separate receipt, even for the same list"
    );
    let original_id = original["id"].as_str().unwrap().parse::<Uuid>().unwrap();
    let unchanged: Value =
        sqlx::query_scalar("SELECT to_jsonb(c) FROM consent_form_choices c WHERE id=$1")
            .bind(original_id)
            .fetch_one(pool)
            .await
            .unwrap();
    assert_eq!(
        unchanged, original,
        "later approval never changes the earlier receipt"
    );
    let illegal_update = sqlx::query("UPDATE consent_form_choices SET disclosure=jsonb_set(disclosure,'{allow_disclosure}','false'::jsonb) WHERE id=$1")
        .bind(original_id).execute(pool).await;
    assert!(
        illegal_update.is_err(),
        "the append-only trigger must reject receipt mutation"
    );
}

#[tokio::test]
async fn an_unchanged_legacy_named_choice_is_preserved_without_fabricating_a_disclosure_receipt() {
    let Some(app) = test_app().await else { return };
    let router = &app.suite.app;
    let pool = &app.suite.pool;
    let (lead, user, patient) =
        lead_with_login(&app, "Legacy", "legacy.disclosure@example.com").await;
    let request = format!("/api/v1/me/lead-requests/{lead}");
    let named = json!({"agency_processing":true,"doctors_to_agency":true,"data_system":true,"named_recipients":true});
    let persons = json!([{ "name":"Praxis Legacy","relation":"family_doctor" }]);
    sqlx::query(
        r#"INSERT INTO consent_form_choices
        (template_id,lead_id,choices,chosen_by,access_kind,source,language,text_version,recipients)
        VALUES('privacy_consents',$1,$2,$3,'self','lead_portal','de','2026-10-12',$4)"#,
    )
    .bind(lead)
    .bind(&named)
    .bind(user)
    .bind(&persons)
    .execute(pool)
    .await
    .unwrap();
    sqlx::query("UPDATE leads SET portal_trusted_persons=$2 WHERE id=$1")
        .bind(lead)
        .bind(&persons)
        .execute(pool)
        .await
        .unwrap();
    let (_, initial) = json_request(router, "GET", &request, &patient, None).await;
    assert_eq!(initial["disclosure"], Value::Null, "{initial}");
    let (status, saved) = choose(router, lead, &patient, &named).await;
    assert_eq!(status, StatusCode::CREATED, "{saved}");
    assert_eq!(saved["recipients"], persons, "{saved}");
    let (_, current) = json_request(router, "GET", &request, &patient, None).await;
    assert_eq!(
        current["disclosure"],
        Value::Null,
        "legacy evidence is not a new checkbox consent: {current}"
    );
    let (status, refused) = json_request(
        router,
        "POST",
        &format!("{request}/consent-choices"),
        &patient,
        Some(
            json!({"choices":named,"recipients":[{"name":"Another Legacy","relation":"friend"}],
            "version":"2026-10-12","language":"de"}),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{refused}");
    assert_eq!(refused["code"], "disclosure_consent_required", "{refused}");
    let (status, withdrawn) = choose(
        router,
        lead,
        &patient,
        &json!({"agency_processing":true,"doctors_to_agency":true,"data_system":true}),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{withdrawn}");
    let (_, current) = json_request(router, "GET", &request, &patient, None).await;
    assert_eq!(
        current["disclosure"],
        Value::Null,
        "a legacy withdrawal must not invent agreement to new text: {current}"
    );
    let (status, refused) = choose(router, lead, &patient, &named).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{refused}");
    assert_eq!(refused["code"], "disclosure_consent_required", "{refused}");
}

#[tokio::test]
async fn trusted_persons_backfill_uses_the_latest_eligible_choice_without_reviving_an_older_list() {
    let Some(app) = test_app().await else { return };
    let pool = &app.suite.pool;
    let (adult, adult_login, _) =
        lead_with_login(&app, "AdultBackfill", "adult.backfill@example.com").await;
    let (minor, minor_login, _) =
        lead_with_login(&app, "MinorBackfill", "minor.backfill@example.com").await;
    let (guarded, guarded_login, _) =
        lead_with_login(&app, "GuardedBackfill", "guarded.backfill@example.com").await;
    let (unticked, unticked_login, _) =
        lead_with_login(&app, "UntickedBackfill", "unticked.backfill@example.com").await;
    let guardian = seed_user(pool, "trusted-backfill-guardian", "patient").await;
    sqlx::query("UPDATE leads SET date_of_birth='2015-05-10' WHERE id=ANY($1)")
        .bind(vec![minor, guarded])
        .execute(pool)
        .await
        .unwrap();
    let named = json!({ "agency_processing": true, "doctors_to_agency": true,
        "data_system": true, "named_recipients": true });
    let core = json!({ "agency_processing": true, "doctors_to_agency": true,
        "data_system": true, "named_recipients": false });
    let valid = json!([{ "name": "Oma Valid", "relation": "relative" }]);
    let ignored = json!([{ "name": "Ignored Child Choice", "relation": "friend" }]);
    // The raw rows model the existing installation, before the new list column.
    for (lead, chooser, kind, choices, recipients) in [
        (adult, adult_login, "self", named.clone(), valid.clone()),
        (minor, minor_login, "self", named.clone(), ignored.clone()),
        (guarded, guardian, "guardian", named.clone(), valid.clone()),
        (guarded, guarded_login, "self", named.clone(), ignored),
        (unticked, unticked_login, "self", named, valid.clone()),
        (unticked, unticked_login, "self", core, json!([])),
    ] {
        sqlx::query(
            r#"INSERT INTO consent_form_choices
               (template_id, lead_id, choices, chosen_by, access_kind, source, language, text_version, recipients)
               VALUES ('privacy_consents',$1,$2,$3,$4,'lead_portal','de','2026-10-12',$5)"#,
        ).bind(lead).bind(choices).bind(chooser).bind(kind).bind(recipients).execute(pool).await.unwrap();
    }
    // Execute the actual migration, not a copy of its selection query.
    for _ in 0..2 {
        sqlx::raw_sql(include_str!(
            "../../../migrations/20261014120000_lead_portal_trusted_persons.sql"
        ))
        .execute(pool)
        .await
        .unwrap();
        for (lead, expected) in [
            (adult, valid.clone()),
            (minor, json!([])),
            (guarded, valid.clone()),
            (unticked, json!([])),
        ] {
            let stored: Value =
                sqlx::query_scalar("SELECT portal_trusted_persons FROM leads WHERE id=$1")
                    .bind(lead)
                    .fetch_one(pool)
                    .await
                    .unwrap();
            assert_eq!(stored, expected, "backfill for {lead}");
        }
        let fabricated: i64 = sqlx::query_scalar(
            "SELECT count(*) FROM consent_form_choices WHERE lead_id=ANY($1) AND disclosure IS NOT NULL",
        ).bind(vec![adult, minor, guarded, unticked]).fetch_one(pool).await.unwrap();
        assert_eq!(
            fabricated, 0,
            "migration must never fabricate agreement to the new disclosure text"
        );
    }
}

async fn active_guardian_links(pool: &PgPool, lead_id: Uuid) -> Vec<(Uuid, Option<Uuid>)> {
    sqlx::query_as(
        "SELECT user_id, trusted_contact_id FROM lead_portal_access
         WHERE lead_id = $1 AND kind = 'guardian' AND revoked_at IS NULL",
    )
    .bind(lead_id)
    .fetch_all(pool)
    .await
    .unwrap()
}

async fn minor_with_father(
    app: &TestApp,
    child: &str,
    father_name: &str,
    email: &str,
) -> (Uuid, Uuid) {
    let contact = Uuid::new_v4();
    let (status, created) = json_request(
        &app.suite.app,
        "POST",
        "/api/v1/leads",
        &app.staff("patient_manager"),
        Some(json!({
            "first_name": child,
            "last_name": "Portal",
            "date_of_birth": "2016-04-05",
            "trusted_contacts": [{
                "id": contact,
                "name": father_name,
                "relation": "father",
                "email": email
            }]
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{created}");
    (created["id"].as_str().unwrap().parse().unwrap(), contact)
}

/// Staff report 2026-10-19: the father already had a login and the child's
/// request named him with his patronymic; his cabinet showed no request.
/// Owner decision: a parent's existing login gets the child's request by
/// itself, with no new password; an access staff revoked stays revoked.
#[tokio::test]
async fn a_parent_who_already_has_a_login_gets_the_childs_request_by_itself() {
    let Some(app) = test_app().await else { return };
    let router = &app.suite.app;
    let pool = &app.suite.pool;
    let pm = app.staff("patient_manager");
    // The login is named "Ioann Portal".
    let (_, father, father_bearer) =
        lead_with_login(&app, "Ioann", "ioann.autolink@example.com").await;

    // A request created for the child links the login at once.
    let (child, contact) = minor_with_father(
        &app,
        "Adolf",
        "Ioann Mikolajovich Portal",
        " Ioann.Autolink@example.com",
    )
    .await;
    assert_eq!(
        active_guardian_links(pool, child).await,
        vec![(father, Some(contact))]
    );
    assert_eq!(
        audit_count(pool, "issue_lead_guardian_access", child).await,
        1
    );
    let (_, requests) = json_request(
        router,
        "GET",
        "/api/v1/me/lead-requests",
        &father_bearer,
        None,
    )
    .await;
    assert!(
        requests["requests"]
            .as_array()
            .unwrap()
            .iter()
            .any(|request| request["lead_id"] == json!(child)
                && request["access_kind"] == "guardian"),
        "{requests}"
    );
    let password_hash: String = sqlx::query_scalar("SELECT password_hash FROM users WHERE id = $1")
        .bind(father)
        .fetch_one(pool)
        .await
        .unwrap();

    // Revoked by staff: neither a save nor the next sign-in brings it back.
    let access: Uuid = sqlx::query_scalar(
        "SELECT id FROM lead_portal_access WHERE lead_id = $1 AND revoked_at IS NULL",
    )
    .bind(child)
    .fetch_one(pool)
    .await
    .unwrap();
    let (status, body) = json_request(
        router,
        "POST",
        &format!("/api/v1/leads/{child}/portal-guardians/{access}/revoke"),
        &pm,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let (status, body) = json_request(
        router,
        "POST",
        &format!("/api/v1/leads/{child}/update"),
        &pm,
        Some(json!({ "trusted_contacts": [{
            "id": contact, "name": "Ioann Mikolajovich Portal", "relation": "father",
            "email": "ioann.autolink@example.com"
        }] })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    json_request(router, "GET", "/api/v1/me", &father_bearer, None).await;
    assert!(active_guardian_links(pool, child).await.is_empty());

    // A request entered before the parent had a login: linked at the
    // parent's next load of the portal.
    let (earlier, earlier_contact) =
        minor_with_father(&app, "Stefan", "Petro Portal", "petro.autolink@example.com").await;
    assert!(active_guardian_links(pool, earlier).await.is_empty());
    let (_, petro, petro_bearer) =
        lead_with_login(&app, "Petro", "petro.autolink@example.com").await;
    assert!(active_guardian_links(pool, earlier).await.is_empty());
    let (status, me) = json_request(router, "GET", "/api/v1/me", &petro_bearer, None).await;
    assert_eq!(status, StatusCode::OK, "{me}");
    assert_eq!(
        active_guardian_links(pool, earlier).await,
        vec![(petro, Some(earlier_contact))]
    );
    assert_eq!(me["lead_portal"]["requests"], 2, "{me}");

    // Another person with the address is not linked.
    let (stranger_child, _) =
        minor_with_father(&app, "Mila", "Taras Inshyi", "petro.autolink@example.com").await;
    json_request(router, "GET", "/api/v1/me", &petro_bearer, None).await;
    assert!(active_guardian_links(pool, stranger_child).await.is_empty());

    let unchanged: String = sqlx::query_scalar("SELECT password_hash FROM users WHERE id = $1")
        .bind(father)
        .fetch_one(pool)
        .await
        .unwrap();
    assert_eq!(
        unchanged, password_hash,
        "no new password for a linked login"
    );
}

/// Owner decision 2026-10-19: a parent who is already a patient (own record,
/// own login) is linked to the child's request by itself — the login gets
/// the guardian access and the trusted contact points to the parent's
/// record, so the representative's identity is filled from that record
/// without overwriting what the request already states.
#[tokio::test]
async fn auto_linked_parent_patient_fills_the_representative_identity() {
    let Some(app) = test_app().await else { return };
    let pool = &app.suite.pool;
    let email = format!("ioann.parent.{}@example.com", Uuid::new_v4().simple());
    let parent_login: Uuid = sqlx::query_scalar(
        "INSERT INTO users(email,password_hash,name,role) VALUES($1,'synthetic','Ioann Testov','patient') RETURNING id",
    )
    .bind(&email)
    .fetch_one(pool)
    .await
    .unwrap();
    let parent_patient: Uuid = sqlx::query_scalar(
        r#"INSERT INTO patients(patient_id,first_name,last_name,birth_date,gender,email,
                                address_street,address_zip,address_city,address_country,created_by)
           VALUES($1,'Ioann','Testov',DATE '1980-01-02','male',$2,'Elternweg 5','10115','Berlin','DE',$3)
           RETURNING id"#,
    )
    .bind(format!("P-{}", Uuid::new_v4()))
    .bind(&email)
    .bind(app.patient_manager_id)
    .fetch_one(pool)
    .await
    .unwrap();
    sqlx::query("INSERT INTO patient_assignments(patient_id,user_id,assigned_by) VALUES($1,$2,$3)")
        .bind(parent_patient)
        .bind(parent_login)
        .bind(app.patient_manager_id)
        .execute(pool)
        .await
        .unwrap();

    let (child, contact) =
        minor_with_father(&app, "Mykola", "Ioann Mikolajovich Testov", &email).await;
    assert_eq!(
        active_guardian_links(pool, child).await,
        vec![(parent_login, Some(contact))]
    );
    let contacts: Value = sqlx::query_scalar("SELECT trusted_contacts FROM leads WHERE id=$1")
        .bind(child)
        .fetch_one(pool)
        .await
        .unwrap();
    assert_eq!(
        contacts[0]["related_patient_id"],
        json!(parent_patient),
        "{contacts}"
    );
    assert_eq!(
        contacts[0]["name"], "Ioann Mikolajovich Testov",
        "the request's own name stays"
    );
    assert_eq!(
        audit_count(pool, "link_guardian_own_patient", child).await,
        1
    );

    let mut conn = pool.acquire().await.unwrap();
    let identities = gmed_server::services::lead_guardian_identity::load(&mut conn, child)
        .await
        .unwrap();
    let father = identities
        .iter()
        .find(|identity| identity.contact_id == Some(contact))
        .expect("father identity");
    assert_eq!(father.related_patient_id, Some(parent_patient));
    assert_eq!(
        father.contact["birth_date"], "1980-01-02",
        "{:?}",
        father.contact
    );
    assert_eq!(father.contact["name"], "Ioann Mikolajovich Testov");
    assert_eq!(
        father.extras["street"], "Elternweg 5",
        "{:?}",
        father.extras
    );
    assert_eq!(father.extras["city"], "Berlin");
}

/// Security sweep 2026-10-23: the parents' access reads a request only while
/// the lead is a minor, as it writes only then (owner decision 2026-10-20:
/// the 18th birthday closes the parents' access). Before, a parent kept
/// reading the request of a lead who turned 18 or whose date of birth staff
/// corrected: the list, the request and the payer questionnaire.
#[tokio::test]
async fn a_parents_access_reads_nothing_once_the_lead_is_of_age() {
    let Some(app) = test_app().await else { return };
    let router = &app.suite.app;
    let pool = &app.suite.pool;
    let (child, contact) = minor_lead(&app, "Lina", "lina.of.age@example.com").await;
    let (status, issued) = json_request(
        router,
        "POST",
        &format!("/api/v1/leads/{child}/portal-guardians"),
        &app.staff("patient_manager"),
        Some(json!({ "trusted_contact_id": contact })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{issued}");
    let guardian: Uuid = issued["user_id"].as_str().unwrap().parse().unwrap();
    let parent = bearer(guardian, "patient");
    let (status, body) = json_request(
        router,
        "GET",
        &format!("/api/v1/me/lead-requests/{child}"),
        &parent,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");

    sqlx::query("UPDATE leads SET date_of_birth = DATE '2000-01-01' WHERE id = $1")
        .bind(child)
        .execute(pool)
        .await
        .unwrap();
    let (status, list) =
        json_request(router, "GET", "/api/v1/me/lead-requests", &parent, None).await;
    assert_eq!(status, StatusCode::OK, "{list}");
    assert!(
        list["requests"]
            .as_array()
            .unwrap()
            .iter()
            .all(|request| request["lead_id"] != json!(child)),
        "{list}"
    );
    for path in [
        format!("/api/v1/me/lead-requests/{child}"),
        format!("/api/v1/me/lead-requests/{child}/payer-questionnaire"),
    ] {
        let (status, body) = json_request(router, "GET", &path, &parent, None).await;
        assert_eq!(status, StatusCode::NOT_FOUND, "{path}: {body}");
    }
}

/// Security sweep 2026-10-23: a person the parent enters in the cabinet is
/// not linked to an existing patient login by itself. Otherwise a parent
/// could name any patient's name and e-mail as the second parent and read
/// that patient's address and birth date from the patient record in the
/// own cabinet.
#[tokio::test]
async fn a_second_parent_entered_in_the_cabinet_is_not_linked_to_a_patient_record() {
    let Some(app) = test_app().await else { return };
    let router = &app.suite.app;
    let pool = &app.suite.pool;
    let email = format!("victim.parent.{}@example.com", Uuid::new_v4().simple());
    let victim_login: Uuid = sqlx::query_scalar(
        "INSERT INTO users(email,password_hash,name,role) VALUES($1,'synthetic','Ivan Fremd','patient') RETURNING id",
    )
    .bind(&email)
    .fetch_one(pool)
    .await
    .unwrap();
    let victim_patient: Uuid = sqlx::query_scalar(
        r#"INSERT INTO patients(patient_id,first_name,last_name,birth_date,gender,email,
                                address_street,address_zip,address_city,address_country,created_by)
           VALUES($1,'Ivan','Fremd',DATE '1979-05-06','male',$2,'Geheimweg 7','20095','Hamburg','DE',$3)
           RETURNING id"#,
    )
    .bind(format!("P-{}", Uuid::new_v4()))
    .bind(&email)
    .bind(app.patient_manager_id)
    .fetch_one(pool)
    .await
    .unwrap();
    sqlx::query("INSERT INTO patient_assignments(patient_id,user_id,assigned_by) VALUES($1,$2,$3)")
        .bind(victim_patient)
        .bind(victim_login)
        .bind(app.patient_manager_id)
        .execute(pool)
        .await
        .unwrap();

    let (child, contact) = minor_lead(&app, "Oleh", "oleh.mother@example.com").await;
    let (status, issued) = json_request(
        router,
        "POST",
        &format!("/api/v1/leads/{child}/portal-guardians"),
        &app.staff("patient_manager"),
        Some(json!({ "trusted_contact_id": contact })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{issued}");
    let mother: Uuid = issued["user_id"].as_str().unwrap().parse().unwrap();
    let parent = bearer(mother, "patient");

    let second = Uuid::new_v4();
    let (status, body) = json_request(
        router,
        "POST",
        &format!("/api/v1/me/lead-requests/{child}/representatives/{second}"),
        &parent,
        Some(json!({
            "role": "legal_representative",
            "first_name": "Ivan",
            "last_name": "Fremd",
            "email": email,
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    assert!(
        active_guardian_links(pool, child)
            .await
            .iter()
            .all(|(user, _)| *user != victim_login),
        "the named login gets no access by itself"
    );
    let contacts: Value = sqlx::query_scalar("SELECT trusted_contacts FROM leads WHERE id=$1")
        .bind(child)
        .fetch_one(pool)
        .await
        .unwrap();
    assert!(
        contacts
            .as_array()
            .unwrap()
            .iter()
            .all(|entry| entry["related_patient_id"] != json!(victim_patient)),
        "{contacts}"
    );
    let (status, body) = json_request(
        router,
        "GET",
        &format!("/api/v1/me/lead-requests/{child}"),
        &parent,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let text = body.to_string();
    assert!(!text.contains("Geheimweg"), "{text}");
    assert!(!text.contains("1979-05-06"), "{text}");
}

/// Owner 2026-10-24: the same file in the same slot is not stored twice;
/// staff move a file uploaded in the wrong slot while it is not taken over;
/// a download of a lead's document is recorded with the lead.
#[tokio::test]
async fn duplicates_are_refused_files_move_between_slots_and_downloads_name_the_lead() {
    let Some(app) = test_app().await else { return };
    let router = &app.suite.app;
    let pool = &app.suite.pool;
    let (lead_id, _, patient) = lead_with_login(&app, "Mira", "mira.slots@example.com").await;
    let request = format!("/api/v1/me/lead-requests/{lead_id}");
    let identity_document = format!("{request}/identity-document");
    give_consent(router, lead_id, &patient, "lead_inquiry_processing").await;
    give_consent(router, lead_id, &patient, "health_data_processing").await;

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
    let document_id: Uuid = body["identity_documents"][0]["id"]
        .as_str()
        .unwrap()
        .parse()
        .unwrap();
    // The same content again, under another name: refused, nothing stored.
    let (status, body) = upload_file(
        router,
        &identity_document,
        &patient,
        "pass-2.png",
        "image/png",
        PNG,
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{body}");
    assert_eq!(body["code"], "duplicate_document", "{body}");
    let stored: i64 = sqlx::query_scalar("SELECT count(*) FROM documents WHERE lead_id = $1")
        .bind(lead_id)
        .fetch_one(pool)
        .await
        .unwrap();
    assert_eq!(stored, 1);
    // In another slot the same content is another document.
    let (status, body) = upload_file(
        router,
        &format!("{request}/documents"),
        &patient,
        "scan.png",
        "image/png",
        PNG,
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{body}");

    let move_path = format!("/api/v1/leads/{lead_id}/portal-intake/documents/{document_id}/move");
    // Concierge has no leads.edit: it cannot move a file.
    let (status, body) = json_request(
        router,
        "POST",
        &move_path,
        &app.staff("concierge"),
        Some(json!({ "kind": "relationship_proof" })),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN, "{body}");
    let pm = app.staff("patient_manager");
    let (status, body) = json_request(
        router,
        "POST",
        &move_path,
        &pm,
        Some(json!({ "kind": "medical" })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
    assert_eq!(body["code"], "invalid_upload_kind", "{body}");
    let (status, body) = json_request(
        router,
        "POST",
        &move_path,
        &pm,
        Some(json!({ "kind": "representative_identity", "representative_id": Uuid::new_v4() })),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND, "{body}");
    // Sales edits leads and opens identity scans (owner 2026-10-24): it may
    // move the file to another slot.
    let (status, body) = json_request(
        router,
        "POST",
        &move_path,
        &app.staff("sales"),
        Some(json!({ "kind": "relationship_proof" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["moved"], true, "{body}");
    let (art, category, auto_name, kind): (String, Option<String>, String, String) =
        sqlx::query_as(
            r#"SELECT d.art, d.category, d.auto_name, u.kind
               FROM documents d JOIN lead_portal_uploads u ON u.document_id = d.id
               WHERE d.id = $1"#,
        )
        .bind(document_id)
        .fetch_one(pool)
        .await
        .unwrap();
    assert_eq!(art, "relationship_proof");
    assert_eq!(category.as_deref(), Some("administrative"));
    assert_eq!(auto_name, "Nachweis der Beziehung zum Kostenübernehmer");
    assert_eq!(kind, "relationship_proof");
    assert_eq!(
        audit_count(pool, "lead_portal_upload_moved", document_id).await,
        1
    );
    let (_, body) = json_request(router, "GET", &request, &patient, None).await;
    assert_eq!(body["identity_documents"], json!([]), "{body}");

    // A review alone no longer pins the file (2026-10-24): staff may still
    // move a reviewed scan to another slot while nothing uses it.
    let (status, body) = json_request(
        router,
        "POST",
        &format!("/api/v1/leads/{lead_id}/portal-intake/documents/{document_id}/review"),
        &pm,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let (status, body) = json_request(
        router,
        "POST",
        &move_path,
        &pm,
        Some(json!({ "kind": "identity" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["moved"], true, "{body}");
    let kind: String =
        sqlx::query_scalar("SELECT kind FROM lead_portal_uploads WHERE document_id = $1")
            .bind(document_id)
            .fetch_one(pool)
            .await
            .unwrap();
    assert_eq!(kind, "identity");

    // The download is recorded, with the lead, before the file goes out.
    let download = Request::builder()
        .method("GET")
        .uri(format!("/api/v1/documents/{document_id}/download"))
        .header("Authorization", &pm)
        .body(Body::empty())
        .unwrap();
    let response = router.clone().oneshot(download).await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let context: Value = sqlx::query_scalar(
        "SELECT context FROM audit_log WHERE action = 'download_document' AND entity_id = $1",
    )
    .bind(document_id)
    .fetch_one(pool)
    .await
    .unwrap();
    assert_eq!(context["lead_id"], json!(lead_id), "{context}");
}
