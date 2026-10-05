//! Integration tests for the identification of a lead's contract partners by
//! qualified electronic signature (§ 12 Abs. 1 GwG): the status of the patient
//! and of a third-party payer, and staff's confirmation of the payment from
//! the person's own account. Synthetic data only.

mod support;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use chrono::{DateTime, Duration, Utc};
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

/// The name a test user of that role is created with.
fn staff_name(role: &str) -> String {
    format!("{role} ident test")
}

async fn test_app() -> Option<TestApp> {
    let suite = support::suite_context(TEST_SECRET).await?;
    let mut users = Vec::new();
    for role in [
        "sales",
        "patient_manager",
        "ceo",
        "ceo_assistant",
        "concierge",
        "billing",
    ] {
        let id: Uuid = sqlx::query_scalar(
            "INSERT INTO users (email, password_hash, name, role) VALUES ($1, 'x', $2, $3) RETURNING id",
        )
        .bind(format!("ident-{role}-{}@example.com", Uuid::new_v4().simple()))
        .bind(staff_name(role))
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
           VALUES ('Anna', 'Muster', $1, '+4915100000000', DATE '1985-02-03', 'female',
                   'Teststr. 5', 'Berlin', '10115', 'DE', 'qualified', 'signed', 'staff_wizard')
           RETURNING id"#,
    )
    .bind(format!(
        "ident-lead-{}@example.com",
        Uuid::new_v4().simple()
    ))
    .fetch_one(pool)
    .await
    .unwrap()
}

fn third_party_payer() -> Value {
    json!({
        "payer_kind": "third_party",
        "acts_on_own_account": true,
        "source_of_funds": "business_income",
        "first_name": "Viktor",
        "last_name": "Zahler",
        "date_of_birth": "1970-05-01",
        "street": "Ringstr. 9",
        "zip": "1010",
        "city": "Wien",
        "country": "AT",
        "citizenships": ["AT"],
        "relationship": "Bruder",
        "email": "viktor.zahler@example.com",
        "payer_informed": true
    })
}

/// A stored document; of the lead when `lead_id` is given.
async fn seed_document(app: &TestApp, lead_id: Option<Uuid>) -> Uuid {
    let id = Uuid::new_v4();
    sqlx::query(
        r#"INSERT INTO documents (id, lead_id, auto_name, art, mime_type, storage_key,
                                  version_root_document_id, uploaded_by)
           VALUES ($1, $2, 'Rahmenvertrag', 'framework_contract', 'application/pdf', $3, $1, $4)"#,
    )
    .bind(id)
    .bind(lead_id)
    .bind(format!("ident-test-{}", id.simple()))
    .bind(app.suite.admin_id)
    .execute(app.pool())
    .await
    .unwrap();
    id
}

/// One signer of a signature request as the provider evidence records it.
fn signer(role: &str, quality: &str, signed_at: DateTime<Utc>) -> Value {
    json!({
        "email": format!("{role}.signer@example.com"),
        "role": role,
        "signature_id": Uuid::new_v4(),
        "status": "SIGNED",
        "signed_at": signed_at.to_rfc3339(),
        "quality": quality,
        "legislation": "EIDAS",
    })
}

/// A signature request for `source` as the signing flow leaves it; a completed
/// one carries its result and report like the table requires.
async fn seed_signature_request(
    app: &TestApp,
    source: Uuid,
    status: &str,
    level: &str,
    test_mode: bool,
    signatures: Vec<Value>,
) -> Uuid {
    let id = Uuid::new_v4();
    let archived = (status == "completed").then(|| "c".repeat(64));
    sqlx::query(
        r#"INSERT INTO document_signature_requests (
               id, source_document_id, requested_by, source_sha256, source_context, signers,
               provider_account, test_mode, status, level, minimum_level, evidence,
               result_document_id, report_storage_key, report_sha256, signed_sha256, signed_at)
           VALUES ($1, $2, $3, $4, '{}'::jsonb, '[]'::jsonb, $5, $6, $7, $8, $8, $9,
                   $10, $11, $11, $11, CASE WHEN $7 = 'completed' THEN now() END)"#,
    )
    .bind(id)
    .bind(source)
    .bind(app.suite.admin_id)
    .bind("a".repeat(64))
    .bind(format!("ident-test-{}", id.simple()))
    .bind(test_mode)
    .bind(status)
    .bind(level)
    .bind(json!({ "provider": "skribble", "signatures": signatures }))
    .bind(archived.as_ref().map(|_| source))
    .bind(archived)
    .execute(app.pool())
    .await
    .unwrap();
    id
}

/// A minor lead (Mia Muster) with the given trusted contacts.
async fn seed_minor_lead(pool: &PgPool, trusted_contacts: Value) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO leads (first_name, last_name, email, date_of_birth, legal_sex,
                              street_address, city, zip_code, country, qualification_status,
                              compliance_status, intake_source, trusted_contacts)
           VALUES ('Mia', 'Muster', $1, DATE '2016-04-05', 'female', 'Teststr. 5', 'Berlin',
                   '10115', 'DE', 'qualified', 'signed', 'staff_wizard', $2)
           RETURNING id"#,
    )
    .bind(format!(
        "ident-minor-{}@example.com",
        Uuid::new_v4().simple()
    ))
    .bind(trusted_contacts)
    .fetch_one(pool)
    .await
    .unwrap()
}

/// One signature as the provider evidence records it, made with `email`.
fn signature_by(role: &str, email: &str, signed_at: DateTime<Utc>) -> Value {
    let mut entry = signer(role, "QES", signed_at);
    entry["email"] = json!(email);
    entry
}

/// A completed live QES request whose `signers` name the persons who signed
/// (`first name`, `last name`, `email`, `role`).
async fn seed_named_signature_request(
    app: &TestApp,
    source: Uuid,
    signatures: Vec<Value>,
    signers: Value,
) -> Uuid {
    let id = seed_signature_request(app, source, "completed", "QES", false, signatures).await;
    sqlx::query("UPDATE document_signature_requests SET signers = $2 WHERE id = $1")
        .bind(id)
        .bind(signers)
        .execute(app.pool())
        .await
        .unwrap();
    id
}

/// The line of one representative in the identification status.
fn representative_line(status: &Value, id: Uuid) -> Value {
    status["representatives"]
        .as_array()
        .unwrap_or_else(|| panic!("no representatives: {status}"))
        .iter()
        .find(|line| line["id"] == json!(id))
        .cloned()
        .unwrap_or_else(|| panic!("no line of {id}: {status}"))
}

fn instant(value: &Value) -> DateTime<Utc> {
    DateTime::parse_from_rfc3339(value.as_str().unwrap_or_else(|| panic!("no time: {value}")))
        .unwrap()
        .with_timezone(&Utc)
}

async fn audit_count(pool: &PgPool, action: &str, lead_id: Uuid) -> i64 {
    sqlx::query_scalar(
        "SELECT count(*) FROM audit_log WHERE action = $1 AND entity_type = 'lead' AND entity_id = $2",
    )
    .bind(action)
    .bind(lead_id)
    .fetch_one(pool)
    .await
    .unwrap()
}

#[tokio::test]
async fn the_status_reports_the_qualified_signature_of_the_patient() {
    let Some(app) = test_app().await else { return };
    let lead_id = seed_lead(app.pool()).await;
    let path = format!("/api/v1/leads/{lead_id}/identification-status");
    let sales = app.bearer("sales");

    // The same readers as the payer declaration.
    for role in ["concierge", "billing"] {
        let (status, _) = json_request(&app, "GET", &path, &app.bearer(role), None).await;
        assert_eq!(status, StatusCode::FORBIDDEN, "{role} must not read");
    }
    for role in ["sales", "patient_manager", "ceo", "ceo_assistant"] {
        let (status, body) = json_request(&app, "GET", &path, &app.bearer(role), None).await;
        assert_eq!(status, StatusCode::OK, "{role}: {body}");
    }
    let (status, _) = json_request(
        &app,
        "GET",
        &format!("/api/v1/leads/{}/identification-status", Uuid::new_v4()),
        &sales,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    // Nothing signed, nothing confirmed, nobody else pays.
    let (status, empty) = json_request(&app, "GET", &path, &sales, None).await;
    assert_eq!(status, StatusCode::OK, "{empty}");
    // An adult: no legal representatives to identify.
    assert_eq!(
        empty,
        json!({
            "minor": false,
            "contract_partner": { "qes": null, "own_account_payment": null },
            "payer": null,
            "representatives": [],
        })
    );

    let signed_at = Utc::now() - Duration::hours(3);
    // None of these is a qualified signature of the patient: an advanced
    // signature, a request that is still open, a request only GMED signed,
    // and the qualified signature on another lead's document.
    let advanced = seed_document(&app, Some(lead_id)).await;
    seed_signature_request(
        &app,
        advanced,
        "completed",
        "AES",
        false,
        vec![signer("client", "AES", signed_at)],
    )
    .await;
    let open = seed_document(&app, Some(lead_id)).await;
    seed_signature_request(
        &app,
        open,
        "pending",
        "QES",
        false,
        vec![signer("client", "QES", signed_at)],
    )
    .await;
    let agency_only = seed_document(&app, Some(lead_id)).await;
    seed_signature_request(
        &app,
        agency_only,
        "completed",
        "QES",
        false,
        vec![signer("agency", "QES", signed_at)],
    )
    .await;
    let other_lead = seed_lead(app.pool()).await;
    let foreign = seed_document(&app, Some(other_lead)).await;
    seed_signature_request(
        &app,
        foreign,
        "completed",
        "QES",
        false,
        vec![signer("client", "QES", signed_at)],
    )
    .await;
    let (_, status_body) = json_request(&app, "GET", &path, &sales, None).await;
    assert!(
        status_body["contract_partner"]["qes"].is_null(),
        "{status_body}"
    );

    // A test signature of the demo account is reported as a test.
    let demo = seed_document(&app, Some(lead_id)).await;
    let demo_signed_at = Utc::now() - Duration::hours(1);
    seed_signature_request(
        &app,
        demo,
        "completed",
        "QES",
        true,
        vec![signer("client", "DEMO", demo_signed_at)],
    )
    .await;
    let (_, status_body) = json_request(&app, "GET", &path, &sales, None).await;
    let qes = &status_body["contract_partner"]["qes"];
    assert_eq!(qes["test_mode"], true, "{status_body}");
    assert_eq!(
        instant(&qes["signed_at"]).timestamp(),
        demo_signed_at.timestamp()
    );

    // The completed qualified signature of the patient counts — also when the
    // lead's document is one member of a signed package — and stands before
    // the later test signature. GMED's own signature is not the patient's.
    let package_primary = seed_document(&app, None).await;
    let member = seed_document(&app, Some(lead_id)).await;
    let package = seed_signature_request(
        &app,
        package_primary,
        "completed",
        "QES",
        false,
        vec![
            signer("client", "QES", signed_at),
            signer("agency", "QES", signed_at + Duration::minutes(5)),
        ],
    )
    .await;
    sqlx::query(
        r#"INSERT INTO document_signature_members (request_id, document_id, position, sha256, source_context)
           VALUES ($1, $2, 1, $3, '{}'::jsonb)"#,
    )
    .bind(package)
    .bind(member)
    .bind("b".repeat(64))
    .execute(app.pool())
    .await
    .unwrap();
    let (_, status_body) = json_request(&app, "GET", &path, &sales, None).await;
    let qes = &status_body["contract_partner"]["qes"];
    assert_eq!(qes["test_mode"], false, "{status_body}");
    assert_eq!(
        instant(&qes["signed_at"]).timestamp(),
        signed_at.timestamp()
    );
    assert!(status_body["payer"].is_null(), "{status_body}");
    assert!(
        status_body["contract_partner"]["own_account_payment"].is_null(),
        "{status_body}"
    );
}

#[tokio::test]
async fn staff_confirm_and_take_back_the_own_account_payment() {
    let Some(app) = test_app().await else { return };
    let pool = app.pool();
    let lead_id = seed_lead(pool).await;
    let path = format!(
        "/api/v1/leads/{lead_id}/identification-status/contract_partner/own-account-payment"
    );
    let sales = app.bearer("sales");
    let pm = app.bearer("patient_manager");
    let confirm = || Some(json!({ "confirmed": true }));

    // Roles without leads.edit do not confirm; the CEO Assistant only reads.
    for role in ["concierge", "billing", "ceo_assistant"] {
        let (status, _) = json_request(&app, "POST", &path, &app.bearer(role), confirm()).await;
        assert_eq!(status, StatusCode::FORBIDDEN, "{role} must not confirm");
    }
    let (status, error) = json_request(
        &app,
        "POST",
        &format!("/api/v1/leads/{lead_id}/identification-status/guardian/own-account-payment"),
        &sales,
        confirm(),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{error}");
    assert_eq!(error["error"], "identification_subject_invalid");
    let (status, _) = json_request(
        &app,
        "POST",
        &format!(
            "/api/v1/leads/{}/identification-status/contract_partner/own-account-payment",
            Uuid::new_v4()
        ),
        &sales,
        confirm(),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (status, error) = json_request(
        &app,
        "POST",
        &path,
        &sales,
        Some(json!({ "confirmed": true, "note": "x".repeat(501) })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{error}");
    assert_eq!(error["error"], "identification_note_too_long");
    assert_eq!(
        audit_count(pool, "confirm_lead_own_account_payment", lead_id).await,
        0
    );

    // Sales works the lead (leads.edit) and confirms, with a note.
    let (status, confirmed) = json_request(
        &app,
        "POST",
        &path,
        &sales,
        Some(json!({ "confirmed": true, "note": "  Kontoauszug geprüft  " })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{confirmed}");
    let payment = &confirmed["contract_partner"]["own_account_payment"];
    assert_eq!(payment["confirmed_by_name"], staff_name("sales"));
    assert_eq!(payment["note"], "Kontoauszug geprüft");
    let first_confirmed_at = instant(&payment["confirmed_at"]);
    assert!(confirmed["contract_partner"]["qes"].is_null());
    assert!(confirmed["payer"].is_null());
    assert_eq!(
        audit_count(pool, "confirm_lead_own_account_payment", lead_id).await,
        1
    );

    // Confirming again changes nothing: the first confirmation keeps its time
    // and author, and nothing new is audited.
    let (status, again) = json_request(&app, "POST", &path, &pm, confirm()).await;
    assert_eq!(status, StatusCode::OK, "{again}");
    assert_eq!(again, confirmed);
    assert_eq!(
        audit_count(pool, "confirm_lead_own_account_payment", lead_id).await,
        1
    );
    // A later note replaces the note only.
    let (status, noted) = json_request(
        &app,
        "POST",
        &path,
        &pm,
        Some(json!({ "confirmed": true, "note": "Überweisung vom eigenen Konto" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{noted}");
    let payment = &noted["contract_partner"]["own_account_payment"];
    assert_eq!(payment["note"], "Überweisung vom eigenen Konto");
    assert_eq!(payment["confirmed_by_name"], staff_name("sales"));
    assert_eq!(instant(&payment["confirmed_at"]), first_confirmed_at);
    assert_eq!(
        audit_count(pool, "confirm_lead_own_account_payment", lead_id).await,
        2
    );
    let (_, read) = json_request(
        &app,
        "GET",
        &format!("/api/v1/leads/{lead_id}/identification-status"),
        &app.bearer("ceo_assistant"),
        None,
    )
    .await;
    assert_eq!(read, noted);

    // Taking the confirmation back removes the mark.
    let (status, revoked) = json_request(
        &app,
        "POST",
        &path,
        &sales,
        Some(json!({ "confirmed": false })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{revoked}");
    assert!(
        revoked["contract_partner"]["own_account_payment"].is_null(),
        "{revoked}"
    );
    let (status, _) = json_request(
        &app,
        "POST",
        &path,
        &sales,
        Some(json!({ "confirmed": false })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        audit_count(pool, "revoke_lead_own_account_payment", lead_id).await,
        1,
        "taking back what is not confirmed is not an event"
    );

    // The audit events name the person's role in the lead, never the note.
    let (subjects, with_note): (i64, i64) = sqlx::query_as(
        r#"SELECT count(*) FILTER (WHERE context ->> 'subject' = 'contract_partner'),
                  count(*) FILTER (WHERE context::text ILIKE '%Kontoauszug%'
                                      OR context::text ILIKE '%Überweisung%'
                                      OR old_value::text ILIKE '%Kontoauszug%'
                                      OR new_value::text ILIKE '%Kontoauszug%')
           FROM audit_log
           WHERE entity_type = 'lead' AND entity_id = $1
             AND action IN ('confirm_lead_own_account_payment', 'revoke_lead_own_account_payment')"#,
    )
    .bind(lead_id)
    .fetch_one(pool)
    .await
    .unwrap();
    assert_eq!(subjects, 3);
    assert_eq!(with_note, 0);

    // After a removal the next confirmation is a new one.
    let (status, renewed) = json_request(&app, "POST", &path, &pm, confirm()).await;
    assert_eq!(status, StatusCode::OK, "{renewed}");
    let payment = &renewed["contract_partner"]["own_account_payment"];
    assert_eq!(payment["confirmed_by_name"], staff_name("patient_manager"));
    assert!(payment["note"].is_null(), "{renewed}");
    assert!(instant(&payment["confirmed_at"]) >= first_confirmed_at);

    // A deleted lead is closed for changes, like its payer declaration; the
    // status can still be read.
    sqlx::query("UPDATE leads SET qualification_status = 'deleted' WHERE id = $1")
        .bind(lead_id)
        .execute(pool)
        .await
        .unwrap();
    let (status, error) = json_request(
        &app,
        "POST",
        &path,
        &pm,
        Some(json!({ "confirmed": false })),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{error}");
    assert_eq!(error["error"], "lead_deleted");
    let (status, kept) = json_request(
        &app,
        "GET",
        &format!("/api/v1/leads/{lead_id}/identification-status"),
        &pm,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{kept}");
    assert_eq!(kept, renewed);

    // A converted lead stays open for the mark: the payment usually arrives
    // after the conversion (owner default 2026-10-06), and the patient card
    // reads the status of the converted lead.
    let patient_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO patients (patient_id, first_name, last_name, birth_date, gender, nationality, created_by)
           VALUES ($1, 'Anna', 'Muster', DATE '1985-02-03', 'female', 'German', $2) RETURNING id"#,
    )
    .bind(format!("P-IDENT-{}", Uuid::new_v4().simple()))
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
    let (status, revoked) = json_request(
        &app,
        "POST",
        &path,
        &pm,
        Some(json!({ "confirmed": false })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{revoked}");
    assert!(
        revoked["contract_partner"]["own_account_payment"].is_null(),
        "{revoked}"
    );
    let (status, confirmed) = json_request(
        &app,
        "POST",
        &path,
        &sales,
        Some(json!({ "confirmed": true, "note": "nach Konvertierung" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{confirmed}");
    assert_eq!(
        confirmed["contract_partner"]["own_account_payment"]["confirmed_by_name"],
        staff_name("sales"),
        "{confirmed}"
    );
    let (status, kept) = json_request(
        &app,
        "GET",
        &format!("/api/v1/leads/{lead_id}/identification-status"),
        &pm,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{kept}");
    assert_eq!(kept, confirmed);
}

/// A patient record the converted lead became.
async fn seed_patient(app: &TestApp, first_name: &str, birth_date: &str) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO patients (patient_id, first_name, last_name, birth_date, gender, created_by)
           VALUES ($1, $2, 'Muster', $3::date, 'female', $4) RETURNING id"#,
    )
    .bind(format!("P-IDENT-{}", Uuid::new_v4().simple()))
    .bind(first_name)
    .bind(birth_date)
    .bind(app.suite.admin_id)
    .fetch_one(app.pool())
    .await
    .unwrap()
}

/// Converts a lead the way the conversion does for what the identification
/// reads: the lead's documents move to the patient (`lead_id` cleared), the
/// lead is marked converted at `converted_at`.
async fn convert_by_sql(
    app: &TestApp,
    lead_id: Uuid,
    patient_id: Uuid,
    converted_at: DateTime<Utc>,
) {
    sqlx::query("UPDATE documents SET patient_id = $2, lead_id = NULL WHERE lead_id = $1")
        .bind(lead_id)
        .bind(patient_id)
        .execute(app.pool())
        .await
        .unwrap();
    sqlx::query(r#"UPDATE lead_payer_declarations SET patient_id = $2 WHERE lead_id = $1"#)
        .bind(lead_id)
        .bind(patient_id)
        .execute(app.pool())
        .await
        .unwrap();
    sqlx::query(
        r#"UPDATE leads SET qualification_status = 'converted', converted_patient_id = $2,
                            status_changed_at = $3 WHERE id = $1"#,
    )
    .bind(lead_id)
    .bind(patient_id)
    .bind(converted_at)
    .execute(app.pool())
    .await
    .unwrap();
}

#[tokio::test]
async fn a_converted_lead_keeps_its_signatures_and_its_representatives() {
    let Some(app) = test_app().await else { return };
    let pool = app.pool();
    let pm = app.bearer("patient_manager");
    let status_of = |lead_id: Uuid| format!("/api/v1/leads/{lead_id}/identification-status");

    // The adult signed the framework contract; the conversion moved the
    // document to the patient. The signature still counts for the lead.
    let lead_id = seed_lead(pool).await;
    let contract = seed_document(&app, Some(lead_id)).await;
    let client_signed_at = Utc::now() - Duration::days(3);
    seed_signature_request(
        &app,
        contract,
        "completed",
        "QES",
        false,
        vec![signer("client", "QES", client_signed_at)],
    )
    .await;
    let patient_id = seed_patient(&app, "Anna", "1985-02-03").await;
    convert_by_sql(&app, lead_id, patient_id, Utc::now() - Duration::days(2)).await;
    let (status, converted) = json_request(&app, "GET", &status_of(lead_id), &pm, None).await;
    assert_eq!(status, StatusCode::OK, "{converted}");
    assert_eq!(
        instant(&converted["contract_partner"]["qes"]["signed_at"]).timestamp(),
        client_signed_at.timestamp(),
        "{converted}"
    );
    // A signature on a document of one of the patient's orders counts too.
    let order_id: Uuid = sqlx::query_scalar(
        "INSERT INTO orders (order_number, patient_id, created_by) VALUES ($1, $2, $3) RETURNING id",
    )
    .bind(format!("A-IDENT-{}", Uuid::new_v4().simple()))
    .bind(patient_id)
    .bind(app.suite.admin_id)
    .fetch_one(pool)
    .await
    .unwrap();
    let order_document = seed_document(&app, None).await;
    sqlx::query("UPDATE documents SET order_id = $2 WHERE id = $1")
        .bind(order_document)
        .bind(order_id)
        .execute(pool)
        .await
        .unwrap();
    let later = Utc::now() - Duration::days(1);
    seed_signature_request(
        &app,
        order_document,
        "completed",
        "QES",
        false,
        vec![signer("client", "QES", later)],
    )
    .await;
    let (_, with_order) = json_request(&app, "GET", &status_of(lead_id), &pm, None).await;
    assert_eq!(
        instant(&with_order["contract_partner"]["qes"]["signed_at"]).timestamp(),
        later.timestamp(),
        "{with_order}"
    );

    // A second request of the same patient names another payer: what the
    // first payer signed does not count for the second (named later), what
    // the second signs on a document of the patient does.
    let first_payer_signed_at = Utc::now() - Duration::hours(10);
    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/leads/{lead_id}/payer-declaration"),
        &pm,
        Some(third_party_payer()),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::CONFLICT,
        "a converted lead's declaration is closed"
    );
    let second_lead = seed_lead(pool).await;
    let mut other = third_party_payer();
    other["last_name"] = json!("Anders");
    other["email"] = json!("erika.anders@example.com");
    let (status, saved) = json_request(
        &app,
        "POST",
        &format!("/api/v1/leads/{second_lead}/payer-declaration"),
        &pm,
        Some(other),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{saved}");
    // The first payer's signature, dated before the second payer was named,
    // sits on a document of the patient now.
    let earlier_cost_assumption = seed_document(&app, None).await;
    sqlx::query("UPDATE documents SET patient_id = $2 WHERE id = $1")
        .bind(earlier_cost_assumption)
        .bind(patient_id)
        .execute(pool)
        .await
        .unwrap();
    seed_signature_request(
        &app,
        earlier_cost_assumption,
        "completed",
        "QES",
        false,
        vec![signature_by(
            "payer",
            "viktor.zahler@example.com",
            first_payer_signed_at,
        )],
    )
    .await;
    convert_by_sql(
        &app,
        second_lead,
        patient_id,
        Utc::now() - Duration::hours(1),
    )
    .await;
    let (status, second) = json_request(&app, "GET", &status_of(second_lead), &pm, None).await;
    assert_eq!(status, StatusCode::OK, "{second}");
    assert!(second["payer"]["qes"].is_null(), "{second}");
    let named_at: DateTime<Utc> = sqlx::query_scalar(
        "SELECT identity_changed_at FROM lead_payer_declarations WHERE lead_id = $1",
    )
    .bind(second_lead)
    .fetch_one(pool)
    .await
    .unwrap();
    let second_payer_signed_at = named_at + Duration::milliseconds(1);
    let moved_cost_assumption = seed_document(&app, None).await;
    sqlx::query("UPDATE documents SET patient_id = $2 WHERE id = $1")
        .bind(moved_cost_assumption)
        .bind(patient_id)
        .execute(pool)
        .await
        .unwrap();
    seed_signature_request(
        &app,
        moved_cost_assumption,
        "completed",
        "QES",
        false,
        vec![signature_by(
            "payer",
            "erika.anders@example.com",
            second_payer_signed_at,
        )],
    )
    .await;
    let (_, second) = json_request(&app, "GET", &status_of(second_lead), &pm, None).await;
    assert_eq!(
        instant(&second["payer"]["qes"]["signed_at"]).timestamp(),
        second_payer_signed_at.timestamp(),
        "{second}"
    );

    // A minor who turned 18 since the conversion: the lead is read as of
    // the conversion day, so the parents stay the persons to identify.
    let (anna, ben) = (Uuid::new_v4(), Uuid::new_v4());
    let eighteen_today = gmed_server::app_time::today()
        .checked_sub_months(chrono::Months::new(18 * 12))
        .unwrap();
    let grown_up = seed_minor_lead(
        pool,
        json!([
            { "id": anna, "name": "Anna Muster", "relation": "mother",
              "email": "anna.muster@example.com" },
            { "id": ben, "name": "Ben Muster", "relation": "father" },
        ]),
    )
    .await;
    sqlx::query("UPDATE leads SET date_of_birth = $2 WHERE id = $1")
        .bind(grown_up)
        .bind(eighteen_today)
        .execute(pool)
        .await
        .unwrap();
    let (_, adult_today) = json_request(&app, "GET", &status_of(grown_up), &pm, None).await;
    assert_eq!(adult_today["minor"], false, "{adult_today}");
    let young_patient = seed_patient(&app, "Mia", &eighteen_today.to_string()).await;
    let converted_at = Utc::now() - Duration::days(10);
    convert_by_sql(&app, grown_up, young_patient, converted_at).await;
    let (status, as_of_conversion) =
        json_request(&app, "GET", &status_of(grown_up), &pm, None).await;
    assert_eq!(status, StatusCode::OK, "{as_of_conversion}");
    assert_eq!(as_of_conversion["minor"], true, "{as_of_conversion}");
    assert_eq!(
        as_of_conversion["representatives"]
            .as_array()
            .unwrap()
            .len(),
        2,
        "{as_of_conversion}"
    );
    // The parents' marks are still confirmed on the converted lead.
    let (status, confirmed) = json_request(
        &app,
        "POST",
        &format!(
            "/api/v1/leads/{grown_up}/identification-status/representative:{anna}/own-account-payment"
        ),
        &pm,
        Some(json!({ "confirmed": true })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{confirmed}");
    assert!(
        representative_line(&confirmed, anna)["own_account_payment"].is_object(),
        "{confirmed}"
    );
    // Nothing moves the status date of a converted lead: the status
    // transitions and the failed-lead flow refuse it, so the conversion day
    // stays the day the minor is judged on.
    for (path, body) in [
        (
            format!("/api/v1/leads/{grown_up}/qualify"),
            json!({ "status": "in_progress" }),
        ),
        (
            format!("/api/v1/leads/{grown_up}/failed-flow"),
            json!({ "resolution": "archive", "reason": "duplicate" }),
        ),
    ] {
        let (status, refused) = json_request(&app, "POST", &path, &pm, Some(body)).await;
        assert_eq!(status, StatusCode::CONFLICT, "{path}: {refused}");
    }
    let unchanged: DateTime<Utc> =
        sqlx::query_scalar("SELECT status_changed_at FROM leads WHERE id = $1")
            .bind(grown_up)
            .fetch_one(pool)
            .await
            .unwrap();
    assert_eq!(unchanged.timestamp(), converted_at.timestamp());
    let (_, still) = json_request(&app, "GET", &status_of(grown_up), &pm, None).await;
    assert_eq!(still["minor"], true, "{still}");
}

#[tokio::test]
async fn the_payer_is_a_person_of_its_own_only_while_a_third_party_pays() {
    let Some(app) = test_app().await else { return };
    let pool = app.pool();
    let lead_id = seed_lead(pool).await;
    let pm = app.bearer("patient_manager");
    let status_path = format!("/api/v1/leads/{lead_id}/identification-status");
    let payer_path =
        format!("/api/v1/leads/{lead_id}/identification-status/payer/own-account-payment");
    let declaration_path = format!("/api/v1/leads/{lead_id}/payer-declaration");
    let confirm = || Some(json!({ "confirmed": true }));

    // Without a third-party payer there is no payer to confirm anything for.
    let (status, error) = json_request(&app, "POST", &payer_path, &pm, confirm()).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{error}");
    assert_eq!(error["error"], "payer_declaration_not_third_party");

    // A payer signature from before the payer was named belongs to nobody
    // the declaration names.
    let earlier = seed_document(&app, Some(lead_id)).await;
    seed_signature_request(
        &app,
        earlier,
        "completed",
        "QES",
        true,
        vec![signer("payer", "DEMO", Utc::now() - Duration::days(2))],
    )
    .await;
    let (status, saved) = json_request(
        &app,
        "POST",
        &declaration_path,
        &pm,
        Some(third_party_payer()),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{saved}");
    let (status, named) = json_request(&app, "GET", &status_path, &pm, None).await;
    assert_eq!(status, StatusCode::OK, "{named}");
    // (An adult's payer is never one of the lead's representatives.)
    assert_eq!(
        named["payer"],
        json!({ "qes": null, "own_account_payment": null, "same_person_as": null }),
        "{named}"
    );

    // The payer signs the cost assumption after being named: the signature is
    // the payer's, not the patient's.
    let named_at: DateTime<Utc> = sqlx::query_scalar(
        "SELECT identity_changed_at FROM lead_payer_declarations WHERE lead_id = $1",
    )
    .bind(lead_id)
    .fetch_one(pool)
    .await
    .unwrap();
    let cost_assumption = seed_document(&app, Some(lead_id)).await;
    let payer_signed_at = named_at + Duration::milliseconds(1);
    seed_signature_request(
        &app,
        cost_assumption,
        "completed",
        "QES",
        false,
        vec![signer("payer", "QES", payer_signed_at)],
    )
    .await;
    let (_, signed) = json_request(&app, "GET", &status_path, &pm, None).await;
    assert_eq!(signed["payer"]["qes"]["test_mode"], false, "{signed}");
    assert_eq!(
        instant(&signed["payer"]["qes"]["signed_at"]).timestamp(),
        payer_signed_at.timestamp()
    );
    assert!(signed["contract_partner"]["qes"].is_null(), "{signed}");

    // Each person has a confirmation of its own.
    let (status, confirmed) = json_request(&app, "POST", &payer_path, &pm, confirm()).await;
    assert_eq!(status, StatusCode::OK, "{confirmed}");
    assert_eq!(
        confirmed["payer"]["own_account_payment"]["confirmed_by_name"],
        staff_name("patient_manager")
    );
    assert!(
        confirmed["contract_partner"]["own_account_payment"].is_null(),
        "{confirmed}"
    );
    let payer_audits: i64 = sqlx::query_scalar(
        r#"SELECT count(*) FROM audit_log
           WHERE action = 'confirm_lead_own_account_payment' AND entity_id = $1
             AND context ->> 'subject' = 'payer'"#,
    )
    .bind(lead_id)
    .fetch_one(pool)
    .await
    .unwrap();
    assert_eq!(payer_audits, 1);

    // Somebody else pays now: the signature and the confirmation of the
    // earlier payer do not count for the new one.
    let mut other = third_party_payer();
    other["last_name"] = json!("Anders");
    let (status, changed) = json_request(&app, "POST", &declaration_path, &pm, Some(other)).await;
    assert_eq!(status, StatusCode::OK, "{changed}");
    let (_, replaced) = json_request(&app, "GET", &status_path, &pm, None).await;
    assert_eq!(
        replaced["payer"],
        json!({ "qes": null, "own_account_payment": null, "same_person_as": null }),
        "{replaced}"
    );
    // The new payer's payment is confirmed anew, by whoever confirms it.
    let (status, reconfirmed) =
        json_request(&app, "POST", &payer_path, &app.bearer("sales"), confirm()).await;
    assert_eq!(status, StatusCode::OK, "{reconfirmed}");
    assert_eq!(
        reconfirmed["payer"]["own_account_payment"]["confirmed_by_name"],
        staff_name("sales")
    );

    // The patient pays after all: no payer line and nothing to confirm.
    let (status, own) = json_request(
        &app,
        "POST",
        &declaration_path,
        &pm,
        Some(json!({ "payer_kind": "self", "source_of_funds": "employment" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{own}");
    let (_, alone) = json_request(&app, "GET", &status_path, &pm, None).await;
    assert!(alone["payer"].is_null(), "{alone}");
    let (status, error) = json_request(&app, "POST", &payer_path, &pm, confirm()).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{error}");
}

#[tokio::test]
async fn the_identification_sheet_generates_with_the_signature_and_the_marks_go_with_the_lead() {
    let Some(app) = test_app().await else { return };
    let pool = app.pool();
    let lead_id = seed_lead(pool).await;
    let pm = app.bearer("patient_manager");
    let ceo = app.bearer("ceo");
    let generate = |lead_id: Uuid, subject: &str| {
        Some(json!({
            "template_id": "gwg_identification",
            "lead_id": lead_id,
            "language": "de",
            "status": "active",
            "bindings": { "gwg_identification": { "subject": subject } }
        }))
    };

    // The patient signed with a qualified signature and the payment is
    // confirmed; a third party pays and has neither yet.
    let contract = seed_document(&app, Some(lead_id)).await;
    seed_signature_request(
        &app,
        contract,
        "completed",
        "QES",
        true,
        vec![signer("client", "DEMO", Utc::now() - Duration::hours(2))],
    )
    .await;
    let (status, confirmed) = json_request(
        &app,
        "POST",
        &format!(
            "/api/v1/leads/{lead_id}/identification-status/contract_partner/own-account-payment"
        ),
        &pm,
        Some(json!({ "confirmed": true })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{confirmed}");
    assert_eq!(confirmed["contract_partner"]["qes"]["test_mode"], true);
    let (status, saved) = json_request(
        &app,
        "POST",
        &format!("/api/v1/leads/{lead_id}/payer-declaration"),
        &pm,
        Some(third_party_payer()),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{saved}");

    for subject in ["contract_partner", "payer"] {
        let (status, generated) = json_request(
            &app,
            "POST",
            "/api/v1/documents/generate",
            &ceo,
            generate(lead_id, subject),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{subject}: {generated}");
        let template: Option<String> =
            sqlx::query_scalar("SELECT generated_template_id FROM documents WHERE id = $1")
                .bind(Uuid::parse_str(generated["id"].as_str().unwrap()).unwrap())
                .fetch_one(pool)
                .await
                .unwrap();
        assert_eq!(template.as_deref(), Some("gwg_identification"));
    }

    // Deleting a lead removes its confirmations with it.
    let discarded = seed_lead(pool).await;
    let (status, body) = json_request(
        &app,
        "POST",
        &format!(
            "/api/v1/leads/{discarded}/identification-status/contract_partner/own-account-payment"
        ),
        &pm,
        Some(json!({ "confirmed": true, "note": "Kontoauszug geprüft" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let marks = |lead: Uuid| async move {
        sqlx::query_scalar::<_, i64>(
            "SELECT count(*) FROM lead_identification_payments WHERE lead_id = $1",
        )
        .bind(lead)
        .fetch_one(pool)
        .await
        .unwrap()
    };
    assert_eq!(marks(discarded).await, 1);
    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/leads/{discarded}/failed-flow"),
        &pm,
        Some(json!({ "resolution": "delete", "reason": "not_our_lead" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(marks(discarded).await, 0);
    assert_eq!(marks(lead_id).await, 1, "other leads keep theirs");
}

#[tokio::test]
async fn each_parent_of_a_minor_is_identified_by_the_own_signature() {
    let Some(app) = test_app().await else { return };
    let pool = app.pool();
    let pm = app.bearer("patient_manager");
    let (anna, ben, aunt) = (Uuid::new_v4(), Uuid::new_v4(), Uuid::new_v4());
    let lead_id = seed_minor_lead(
        pool,
        json!([
            { "id": aunt, "name": "Tante Muster", "relation": "aunt",
              "email": "tante.muster@example.com" },
            { "id": anna, "name": "Anna Muster", "relation": "mother",
              "email": "Anna.Muster@example.com" },
            { "id": ben, "name": "Ben Muster", "relation": "father",
              "email": "ben.muster@example.com" },
        ]),
    )
    .await;
    let status_path = format!("/api/v1/leads/{lead_id}/identification-status");
    let payment_path = |subject: &str| {
        format!("/api/v1/leads/{lead_id}/identification-status/{subject}/own-account-payment")
    };
    let confirm = || Some(json!({ "confirmed": true }));

    // Nothing signed: the parents are the persons to identify, the child and
    // the aunt are not.
    let (status, empty) = json_request(&app, "GET", &status_path, &pm, None).await;
    assert_eq!(status, StatusCode::OK, "{empty}");
    assert_eq!(
        empty,
        json!({
            "minor": true,
            "contract_partner": { "qes": null, "own_account_payment": null },
            "payer": null,
            "representatives": [
                { "id": anna, "subject": format!("representative:{anna}"), "name": "Anna Muster",
                  "relation": "mother", "has_email": true, "qes": null,
                  "own_account_payment": null },
                { "id": ben, "subject": format!("representative:{ben}"), "name": "Ben Muster",
                  "relation": "father", "has_email": true, "qes": null,
                  "own_account_payment": null },
            ],
        })
    );

    // One request, signed by both parents as `client` and by GMED: each
    // parent has the own time, and nothing counts for the child.
    let anna_signed_at = Utc::now() - Duration::hours(5);
    let ben_signed_at = Utc::now() - Duration::hours(3);
    let contract = seed_document(&app, Some(lead_id)).await;
    seed_named_signature_request(
        &app,
        contract,
        vec![
            signature_by("client", "anna.muster@example.com", anna_signed_at),
            signature_by("client", "ben.muster@example.com", ben_signed_at),
            signature_by("agency", "office@example.com", ben_signed_at),
        ],
        json!([]),
    )
    .await;
    let (_, signed) = json_request(&app, "GET", &status_path, &pm, None).await;
    assert_eq!(signed["minor"], true, "{signed}");
    assert!(signed["contract_partner"]["qes"].is_null(), "{signed}");
    let anna_line = representative_line(&signed, anna);
    let ben_line = representative_line(&signed, ben);
    assert_eq!(anna_line["qes"]["test_mode"], false, "{signed}");
    assert_eq!(
        instant(&anna_line["qes"]["signed_at"]).timestamp(),
        anna_signed_at.timestamp()
    );
    assert_eq!(
        instant(&ben_line["qes"]["signed_at"]).timestamp(),
        ben_signed_at.timestamp()
    );

    // A parent who signed with another address is found by the name the
    // request gave that signer; a stranger's signature is nobody's.
    let later = Utc::now() - Duration::hours(1);
    let order = seed_document(&app, Some(lead_id)).await;
    seed_named_signature_request(
        &app,
        order,
        vec![
            signature_by("client", "ben.privat@example.com", later),
            signature_by("client", "fremd@example.com", later),
        ],
        json!([
            { "first_name": "Ben", "last_name": "Muster", "email": "ben.privat@example.com",
              "role": "client" },
            { "first_name": "Viktor", "last_name": "Fremd", "email": "fremd@example.com",
              "role": "client" },
        ]),
    )
    .await;
    let (_, renamed) = json_request(&app, "GET", &status_path, &pm, None).await;
    assert_eq!(
        instant(&representative_line(&renamed, ben)["qes"]["signed_at"]).timestamp(),
        later.timestamp(),
        "{renamed}"
    );
    assert_eq!(
        instant(&representative_line(&renamed, anna)["qes"]["signed_at"]).timestamp(),
        anna_signed_at.timestamp(),
        "{renamed}"
    );
    assert!(renamed["contract_partner"]["qes"].is_null(), "{renamed}");

    // The payment is confirmed per parent; for the child there is none.
    let (status, error) = json_request(
        &app,
        "POST",
        &payment_path("contract_partner"),
        &pm,
        confirm(),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{error}");
    assert_eq!(error["error"], "identification_subject_minor", "{error}");
    for stranger in [aunt, Uuid::new_v4()] {
        let (status, error) = json_request(
            &app,
            "POST",
            &payment_path(&format!("representative:{stranger}")),
            &pm,
            confirm(),
        )
        .await;
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{error}");
        assert_eq!(error["error"], "identification_subject_invalid", "{error}");
    }
    let (status, error) = json_request(
        &app,
        "POST",
        &payment_path("representative:someone"),
        &pm,
        confirm(),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{error}");
    let (status, confirmed) = json_request(
        &app,
        "POST",
        &payment_path(&format!("representative:{anna}")),
        &pm,
        confirm(),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{confirmed}");
    assert_eq!(
        representative_line(&confirmed, anna)["own_account_payment"]["confirmed_by_name"],
        staff_name("patient_manager"),
        "{confirmed}"
    );
    assert!(
        representative_line(&confirmed, ben)["own_account_payment"].is_null(),
        "{confirmed}"
    );
    assert!(
        confirmed["contract_partner"]["own_account_payment"].is_null(),
        "{confirmed}"
    );
    let subjects: Vec<String> =
        sqlx::query_scalar("SELECT subject FROM lead_identification_payments WHERE lead_id = $1")
            .bind(lead_id)
            .fetch_all(pool)
            .await
            .unwrap();
    assert_eq!(subjects, vec![format!("representative:{anna}")]);

    // An adult has no representatives to confirm anything for, and the
    // adult's own line works as before.
    let adult = seed_lead(pool).await;
    let (status, error) = json_request(
        &app,
        "POST",
        &format!(
            "/api/v1/leads/{adult}/identification-status/representative:{anna}/own-account-payment"
        ),
        &pm,
        confirm(),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{error}");
    assert_eq!(error["error"], "identification_subject_invalid", "{error}");
}

#[tokio::test]
async fn a_parent_who_pays_is_one_person_with_the_payer() {
    let Some(app) = test_app().await else { return };
    let pool = app.pool();
    let pm = app.bearer("patient_manager");
    let (anna, ben) = (Uuid::new_v4(), Uuid::new_v4());
    // The mother has an address; the father has none, but a date of birth.
    let lead_id = seed_minor_lead(
        pool,
        json!([
            { "id": anna, "name": "Anna Muster", "relation": "mother",
              "email": "anna.muster@example.com" },
            { "id": ben, "name": "Ben Muster", "relation": "father",
              "birth_date": "1984-07-09" },
        ]),
    )
    .await;
    let status_path = format!("/api/v1/leads/{lead_id}/identification-status");
    let declaration_path = format!("/api/v1/leads/{lead_id}/payer-declaration");
    let payer_payment =
        format!("/api/v1/leads/{lead_id}/identification-status/payer/own-account-payment");
    let payer = |first_name: &str, last_name: &str, date_of_birth: &str, email: &str| {
        let mut payer = third_party_payer();
        payer["first_name"] = json!(first_name);
        payer["last_name"] = json!(last_name);
        payer["date_of_birth"] = json!(date_of_birth);
        payer["email"] = json!(email);
        payer["relationship"] = json!("Elternteil");
        payer
    };

    // "I pay (as a parent)": the payer has the mother's address.
    let (status, saved) = json_request(
        &app,
        "POST",
        &declaration_path,
        &pm,
        Some(payer(
            "Anna",
            "Muster",
            "1985-03-02",
            "Anna.Muster@example.com",
        )),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{saved}");
    let (_, named) = json_request(&app, "GET", &status_path, &pm, None).await;
    assert_eq!(
        named["payer"],
        json!({
            "qes": null,
            "own_account_payment": null,
            "same_person_as": format!("representative:{anna}"),
        }),
        "{named}"
    );

    // She signs the cost assumption as `payer`: it is her signature on both
    // lines, and the father's line stays empty.
    let signed_at = Utc::now() - Duration::hours(2);
    let cost_assumption = seed_document(&app, Some(lead_id)).await;
    seed_named_signature_request(
        &app,
        cost_assumption,
        vec![signature_by("payer", "anna.muster@example.com", signed_at)],
        json!([]),
    )
    .await;
    let (_, signed) = json_request(&app, "GET", &status_path, &pm, None).await;
    for line in [&signed["payer"], &representative_line(&signed, anna)] {
        assert_eq!(
            instant(&line["qes"]["signed_at"]).timestamp(),
            signed_at.timestamp(),
            "{signed}"
        );
    }
    assert!(
        representative_line(&signed, ben)["qes"].is_null(),
        "{signed}"
    );
    assert!(signed["contract_partner"]["qes"].is_null(), "{signed}");

    // The payment confirmed on the payer's line is the mother's mark.
    let (status, confirmed) = json_request(
        &app,
        "POST",
        &payer_payment,
        &pm,
        Some(json!({ "confirmed": true })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{confirmed}");
    for line in [&confirmed["payer"], &representative_line(&confirmed, anna)] {
        assert_eq!(
            line["own_account_payment"]["confirmed_by_name"],
            staff_name("patient_manager"),
            "{confirmed}"
        );
    }
    let subjects: Vec<String> =
        sqlx::query_scalar("SELECT subject FROM lead_identification_payments WHERE lead_id = $1")
            .bind(lead_id)
            .fetch_all(pool)
            .await
            .unwrap();
    assert_eq!(subjects, vec![format!("representative:{anna}")]);
    // Taking it back on the payer's line removes that one mark.
    let (status, revoked) = json_request(
        &app,
        "POST",
        &payer_payment,
        &pm,
        Some(json!({ "confirmed": false })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{revoked}");
    assert!(
        representative_line(&revoked, anna)["own_account_payment"].is_null(),
        "{revoked}"
    );

    // The father pays instead. His contact has no address, so name and date
    // of birth say that he is the payer; what he signs as payer with the
    // payer's address is his signature.
    let (status, saved) = json_request(
        &app,
        "POST",
        &declaration_path,
        &pm,
        Some(payer(
            "ben",
            "MUSTER",
            "1984-07-09",
            "ben.zahlt@example.com",
        )),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{saved}");
    let named_at: DateTime<Utc> = sqlx::query_scalar(
        "SELECT identity_changed_at FROM lead_payer_declarations WHERE lead_id = $1",
    )
    .bind(lead_id)
    .fetch_one(pool)
    .await
    .unwrap();
    let ben_signed_at = named_at + Duration::milliseconds(1);
    let second = seed_document(&app, Some(lead_id)).await;
    seed_named_signature_request(
        &app,
        second,
        vec![signature_by(
            "payer",
            "ben.zahlt@example.com",
            ben_signed_at,
        )],
        json!([]),
    )
    .await;
    let (_, father) = json_request(&app, "GET", &status_path, &pm, None).await;
    assert_eq!(
        father["payer"]["same_person_as"],
        format!("representative:{ben}"),
        "{father}"
    );
    assert_eq!(representative_line(&father, ben)["has_email"], false);
    for line in [&father["payer"], &representative_line(&father, ben)] {
        assert_eq!(
            instant(&line["qes"]["signed_at"]).timestamp(),
            ben_signed_at.timestamp(),
            "{father}"
        );
    }
    // The mother's signature stays hers.
    assert_eq!(
        instant(&representative_line(&father, anna)["qes"]["signed_at"]).timestamp(),
        signed_at.timestamp(),
        "{father}"
    );

    // Somebody else pays: a person of its own again, with nothing yet.
    let (status, saved) = json_request(
        &app,
        "POST",
        &declaration_path,
        &pm,
        Some(third_party_payer()),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{saved}");
    let (_, other) = json_request(&app, "GET", &status_path, &pm, None).await;
    assert_eq!(
        other["payer"],
        json!({ "qes": null, "own_account_payment": null, "same_person_as": null }),
        "{other}"
    );
    let (status, confirmed) = json_request(
        &app,
        "POST",
        &payer_payment,
        &pm,
        Some(json!({ "confirmed": true })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{confirmed}");
    assert!(
        confirmed["payer"]["own_account_payment"].is_object(),
        "{confirmed}"
    );
    assert!(
        representative_line(&confirmed, ben)["own_account_payment"].is_null(),
        "{confirmed}"
    );
}

#[tokio::test]
async fn a_minor_has_one_identification_sheet_per_legal_representative() {
    let Some(app) = test_app().await else { return };
    let pool = app.pool();
    let pm = app.bearer("patient_manager");
    let ceo = app.bearer("ceo");
    let (anna, ben, aunt) = (Uuid::new_v4(), Uuid::new_v4(), Uuid::new_v4());
    let lead_id = seed_minor_lead(
        pool,
        json!([
            { "id": anna, "name": "Anna Muster", "relation": "mother",
              "email": "anna.muster@example.com", "birth_date": "1985-03-02" },
            { "id": ben, "name": "Ben Muster", "relation": "father" },
            { "id": aunt, "name": "Tante Muster", "relation": "aunt" },
        ]),
    )
    .await;
    let generate = |lead_id: Uuid, subject: Option<&str>| {
        let mut body = json!({
            "template_id": "gwg_identification",
            "lead_id": lead_id,
            "language": "de",
            "status": "active"
        });
        if let Some(subject) = subject {
            body["bindings"] = json!({ "gwg_identification": { "subject": subject } });
        }
        Some(body)
    };

    // The child has no sheet of its own: the parents are identified.
    for subject in [None, Some("contract_partner")] {
        let (status, refused) = json_request(
            &app,
            "POST",
            "/api/v1/documents/generate",
            &ceo,
            generate(lead_id, subject),
        )
        .await;
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{refused}");
        assert_eq!(
            refused["code"], "minor_sheet_per_representative",
            "{refused}"
        );
        assert_eq!(
            refused["error"], "minor_sheet_per_representative",
            "{refused}"
        );
    }
    // Only a legal representative has one.
    for subject in [
        format!("representative:{aunt}"),
        format!("representative:{}", Uuid::new_v4()),
        "representative:someone".to_string(),
        "representative".to_string(),
    ] {
        let (status, refused) = json_request(
            &app,
            "POST",
            "/api/v1/documents/generate",
            &ceo,
            generate(lead_id, Some(subject.as_str())),
        )
        .await;
        assert_eq!(
            status,
            StatusCode::UNPROCESSABLE_ENTITY,
            "{subject}: {refused}"
        );
        assert_eq!(
            refused["code"], "representative_sheet_not_available",
            "{subject}: {refused}"
        );
        assert_eq!(
            refused["error"], "representative_sheet_not_available",
            "{subject}: {refused}"
        );
    }

    // The mother also pays: one person, and her sheet says so. Each parent
    // gets an own sheet, named in the stored binding.
    let mut payer = third_party_payer();
    payer["first_name"] = json!("Anna");
    payer["last_name"] = json!("Muster");
    payer["email"] = json!("anna.muster@example.com");
    let (status, saved) = json_request(
        &app,
        "POST",
        &format!("/api/v1/leads/{lead_id}/payer-declaration"),
        &pm,
        Some(payer),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{saved}");
    for parent in [anna, ben] {
        let subject = format!("representative:{parent}");
        let (status, generated) = json_request(
            &app,
            "POST",
            "/api/v1/documents/generate",
            &ceo,
            generate(lead_id, Some(subject.as_str())),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{subject}: {generated}");
        let (template, binding): (Option<String>, Option<String>) = sqlx::query_as(
            "SELECT generated_template_id, generated_bindings::text FROM documents WHERE id = $1",
        )
        .bind(Uuid::parse_str(generated["id"].as_str().unwrap()).unwrap())
        .fetch_one(pool)
        .await
        .unwrap();
        assert_eq!(template.as_deref(), Some("gwg_identification"));
        assert!(
            binding
                .as_deref()
                .is_some_and(|binding| binding.contains(&subject)),
            "{binding:?}"
        );
    }
    // The payer's own sheet stays possible on the server.
    let (status, generated) = json_request(
        &app,
        "POST",
        "/api/v1/documents/generate",
        &ceo,
        generate(lead_id, Some("payer")),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{generated}");

    // An adult's sheet is the adult's own; nobody has a sheet as the adult's
    // representative.
    let adult = seed_lead(pool).await;
    let (status, refused) = json_request(
        &app,
        "POST",
        "/api/v1/documents/generate",
        &ceo,
        generate(adult, Some(format!("representative:{anna}").as_str())),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{refused}");
    assert_eq!(
        refused["code"], "representative_sheet_not_available",
        "{refused}"
    );
    let (status, generated) = json_request(
        &app,
        "POST",
        "/api/v1/documents/generate",
        &ceo,
        generate(adult, Some("contract_partner")),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{generated}");
}
