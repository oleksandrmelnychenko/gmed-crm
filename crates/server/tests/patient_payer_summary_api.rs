//! Integration tests for the payer block of the patient card
//! (`GET /patients/{id}/payer-summary`): who may read it, what each role gets,
//! and the cases of the contract — self-payer, third-party person and
//! organisation, a minor whose parent pays, a minor paid by somebody else, a
//! patient without a lead, several converted leads, an open request.
//! Synthetic data only.

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
    fn user_id(&self, role: &str) -> Uuid {
        self.users
            .iter()
            .find(|(name, _)| *name == role)
            .map(|(_, id)| *id)
            .unwrap_or_else(|| panic!("unexpected test role: {role}"))
    }

    fn bearer(&self, role: &str) -> String {
        let token =
            jwt::issue_access_token(TEST_SECRET, self.user_id(role), role, Uuid::new_v4()).unwrap();
        format!("Bearer {token}")
    }

    fn pool(&self) -> &PgPool {
        &self.suite.pool
    }
}

async fn test_app() -> Option<TestApp> {
    let suite = support::suite_context(TEST_SECRET).await?;
    let mut users = Vec::new();
    for role in [
        "ceo",
        "ceo_assistant",
        "patient_manager",
        "billing",
        "sales",
        "concierge",
        "interpreter",
        "teamlead_interpreter",
        "it_admin",
        "patient",
    ] {
        let id: Uuid = sqlx::query_scalar(
            "INSERT INTO users (email, password_hash, name, role) VALUES ($1, 'x', $2, $3) RETURNING id",
        )
        .bind(format!("summary-{role}-{}@example.com", Uuid::new_v4().simple()))
        .bind(format!("{role} summary test"))
        .bind(role)
        .fetch_one(&suite.pool)
        .await
        .unwrap();
        users.push((role, id));
    }
    Some(TestApp { suite, users })
}

async fn get(app: &TestApp, path: &str, bearer: &str) -> (StatusCode, Value) {
    let request = Request::builder()
        .method("GET")
        .uri(path)
        .header("Authorization", bearer)
        .body(Body::empty())
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

async fn summary(app: &TestApp, patient_id: Uuid, role: &str) -> Value {
    let (status, body) = get(
        app,
        &format!("/api/v1/patients/{patient_id}/payer-summary"),
        &app.bearer(role),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{role}: {body}");
    body
}

/// A patient with a full postal address; `birth_date` decides adult or minor.
async fn seed_patient(app: &TestApp, first_name: &str, birth_date: &str) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO patients (
               patient_id, first_name, last_name, birth_date, gender, created_by,
               email, address_street, address_zip, address_city, address_country
           ) VALUES ($1, $2, 'Muster', $3::date, 'diverse', $4, $5,
                     'Patientenweg 3', '10117', 'Berlin', 'DE')
           RETURNING id"#,
    )
    .bind(format!("P-SUM-{}", Uuid::new_v4().simple()))
    .bind(first_name)
    .bind(birth_date)
    .bind(app.suite.admin_id)
    .bind(format!(
        "{}-{}@example.com",
        first_name.to_lowercase(),
        Uuid::new_v4().simple()
    ))
    .fetch_one(app.pool())
    .await
    .unwrap()
}

/// A lead of the patient, converted at `converted_at` (as the conversion
/// leaves it: status `converted`, the patient linked, the status change
/// dated). `trusted_contacts` are the parents of a minor.
async fn seed_converted_lead(
    app: &TestApp,
    patient_id: Uuid,
    first_name: &str,
    date_of_birth: &str,
    trusted_contacts: Value,
    converted_at: DateTime<Utc>,
) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO leads (first_name, last_name, email, date_of_birth, legal_sex,
                              street_address, city, zip_code, country, qualification_status,
                              compliance_status, intake_source, trusted_contacts,
                              converted_patient_id, status_changed_at)
           VALUES ($1, 'Muster', $2, $3::date, 'female', 'Teststr. 5', 'Berlin', '10115',
                   'DE', 'converted', 'signed', 'staff_wizard', $4, $5, $6)
           RETURNING id"#,
    )
    .bind(first_name)
    .bind(format!("lead-{}@example.com", Uuid::new_v4().simple()))
    .bind(date_of_birth)
    .bind(trusted_contacts)
    .bind(patient_id)
    .bind(converted_at)
    .fetch_one(app.pool())
    .await
    .unwrap()
}

/// The declaration of a lead as the wizard stores it; `patient_id` links it
/// to the patient like the conversion does. `declared_at` dates the payer
/// named (`identity_changed_at`).
async fn seed_declaration(
    app: &TestApp,
    lead_id: Uuid,
    patient_id: Option<Uuid>,
    declaration: Value,
    declared_at: DateTime<Utc>,
) {
    sqlx::query(
        r#"INSERT INTO lead_payer_declarations (
               lead_id, patient_id, payer_kind, payer_type, organisation_name, first_name,
               last_name, date_of_birth, street, zip, city, country, citizenships,
               relationship_kind, relationship, email, phone, source_of_funds,
               payer_informed_at, contact_consent_at, identity_changed_at,
               invoice_to, invoice_name, invoice_street, invoice_zip, invoice_city,
               invoice_country, invoice_email, invoice_vat_id, invoice_tax_number,
               payment_method, account_country, account_holder, via_third_party)
           SELECT $1, $2, v ->> 'payer_kind', v ->> 'payer_type', v ->> 'organisation_name',
                  v ->> 'first_name', v ->> 'last_name', (v ->> 'date_of_birth')::date,
                  v ->> 'street', v ->> 'zip', v ->> 'city', v ->> 'country',
                  ARRAY(SELECT jsonb_array_elements_text(v -> 'citizenships')),
                  v ->> 'relationship_kind', v ->> 'relationship', v ->> 'email', v ->> 'phone',
                  COALESCE(v ->> 'source_of_funds', 'employment'),
                  (v ->> 'payer_informed_at')::timestamptz,
                  (v ->> 'contact_consent_at')::timestamptz, $4,
                  v ->> 'invoice_to', v ->> 'invoice_name', v ->> 'invoice_street',
                  v ->> 'invoice_zip', v ->> 'invoice_city', v ->> 'invoice_country',
                  v ->> 'invoice_email', v ->> 'invoice_vat_id', v ->> 'invoice_tax_number',
                  v ->> 'payment_method', v ->> 'account_country', v ->> 'account_holder',
                  (v ->> 'via_third_party')::boolean
           FROM (SELECT $3::jsonb AS v) input"#,
    )
    .bind(lead_id)
    .bind(patient_id)
    .bind(declaration)
    .bind(declared_at)
    .execute(app.pool())
    .await
    .unwrap();
}

fn self_payer() -> Value {
    json!({ "payer_kind": "self", "source_of_funds": "employment" })
}

/// Viktor Zahler, an adult third party who is nobody's parent.
fn viktor() -> Value {
    json!({
        "payer_kind": "third_party",
        "payer_type": "person",
        "first_name": "Viktor",
        "last_name": "Zahler",
        "date_of_birth": "1970-05-01",
        "street": "Ringstr. 9",
        "zip": "1010",
        "city": "Wien",
        "country": "AT",
        "citizenships": ["AT"],
        "relationship_kind": "relative",
        "email": "viktor.zahler@example.com",
        "phone": "+43 1 0000000",
        "source_of_funds": "business_income",
        "payer_informed_at": "2026-10-05T19:00:00Z",
        "contact_consent_at": "2026-10-05T18:40:00Z"
    })
}

/// Anna Muster, the mother who pays, as the cabinet names her.
fn anna_pays() -> Value {
    json!({
        "payer_kind": "third_party",
        "payer_type": "person",
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
        "source_of_funds": "employment",
        "payer_informed_at": "2026-10-05T19:00:00Z",
        "contact_consent_at": "2026-10-05T18:40:00Z"
    })
}

async fn seed_relation(
    app: &TestApp,
    patient_id: Uuid,
    name: &str,
    relation_type: &str,
    email: Option<&str>,
    address: bool,
    is_default_payer: bool,
) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO patient_relations (
               patient_id, related_name, relation_type, email, is_default_payer,
               address_street, address_zip, address_city, address_country
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id"#,
    )
    .bind(patient_id)
    .bind(name)
    .bind(relation_type)
    .bind(email)
    .bind(is_default_payer)
    .bind(address.then_some("Musterweg 1"))
    .bind(address.then_some("10115"))
    .bind(address.then_some("Berlin"))
    .bind(address.then_some("DE"))
    .fetch_one(app.pool())
    .await
    .unwrap()
}

/// A stored document of the patient (moved there by the conversion).
async fn seed_patient_document(app: &TestApp, patient_id: Uuid) -> Uuid {
    let id = Uuid::new_v4();
    sqlx::query(
        r#"INSERT INTO documents (id, patient_id, auto_name, art, mime_type, storage_key,
                                  version_root_document_id, uploaded_by)
           VALUES ($1, $2, 'Kostenübernahme', 'framework_contract', 'application/pdf',
                   $3, $1, $4)"#,
    )
    .bind(id)
    .bind(patient_id)
    .bind(format!("summary-test-{}", id.simple()))
    .bind(app.suite.admin_id)
    .execute(app.pool())
    .await
    .unwrap();
    id
}

/// A completed live QES request on `source`, signed by `email` as `role`.
async fn seed_qes(app: &TestApp, source: Uuid, role: &str, email: &str, signed_at: DateTime<Utc>) {
    let id = Uuid::new_v4();
    sqlx::query(
        r#"INSERT INTO document_signature_requests (
               id, source_document_id, requested_by, source_sha256, source_context, signers,
               provider_account, test_mode, status, level, minimum_level, evidence,
               result_document_id, report_storage_key, report_sha256, signed_sha256, signed_at)
           VALUES ($1, $2, $3, $4, '{}'::jsonb, '[]'::jsonb, $5, false, 'completed', 'QES',
                   'QES', $6, $2, $7, $7, $7, now())"#,
    )
    .bind(id)
    .bind(source)
    .bind(app.suite.admin_id)
    .bind("a".repeat(64))
    .bind(format!("summary-test-{}", id.simple()))
    .bind(json!({ "provider": "skribble", "signatures": [{
        "email": email,
        "role": role,
        "signature_id": Uuid::new_v4(),
        "status": "SIGNED",
        "signed_at": signed_at.to_rfc3339(),
        "quality": "QES",
        "legislation": "EIDAS",
    }]}))
    .bind("c".repeat(64))
    .execute(app.pool())
    .await
    .unwrap();
}

fn minutes_ago(minutes: i64) -> DateTime<Utc> {
    Utc::now() - Duration::minutes(minutes)
}

#[tokio::test]
async fn the_roles_of_the_card_and_a_patient_without_a_lead() {
    let Some(app) = test_app().await else { return };
    let patient_id = seed_patient(&app, "Ada", "1980-05-05").await;
    let path = format!("/api/v1/patients/{patient_id}/payer-summary");

    // Roles without invoices.view, and a patient account, get nothing.
    for role in [
        "sales",
        "concierge",
        "interpreter",
        "teamlead_interpreter",
        "it_admin",
        "patient",
    ] {
        let (status, body) = get(&app, &path, &app.bearer(role)).await;
        assert_eq!(status, StatusCode::FORBIDDEN, "{role}: {body}");
        assert_eq!(body["error"], "forbidden", "{role}: {body}");
    }
    // A patient manager needs an active assignment, like the statement.
    let (status, body) = get(&app, &path, &app.bearer("patient_manager")).await;
    assert_eq!(status, StatusCode::FORBIDDEN, "{body}");
    assert_eq!(body["error"], "forbidden");
    sqlx::query(
        "INSERT INTO patient_assignments (patient_id, user_id, assigned_by) VALUES ($1, $2, $2)",
    )
    .bind(patient_id)
    .bind(app.user_id("patient_manager"))
    .execute(app.pool())
    .await
    .unwrap();
    for role in ["ceo", "ceo_assistant", "patient_manager", "billing"] {
        let (status, body) = get(&app, &path, &app.bearer(role)).await;
        assert_eq!(status, StatusCode::OK, "{role}: {body}");
    }
    let (status, body) = get(
        &app,
        &format!("/api/v1/patients/{}/payer-summary", Uuid::new_v4()),
        &app.bearer("ceo"),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND, "{body}");
    assert_eq!(body["error"], "not_found");

    // Never a lead: no declaration, no source, no identification; the
    // contracting party and the recipient follow today's rules.
    let body = summary(&app, patient_id, "ceo").await;
    assert_eq!(body["patient_id"], patient_id.to_string());
    assert_eq!(body["patient_is_minor"], false);
    assert!(body["source"].is_null(), "{body}");
    assert!(body["declaration"].is_null(), "{body}");
    assert!(body["identification"].is_null(), "{body}");
    assert!(body["open_request"].is_null(), "{body}");
    assert_eq!(body["contracting_party"]["kind"], "patient");
    assert_eq!(body["contracting_party"]["patient_name"], "Ada Muster");
    let mut recipient = body["invoice_recipient"].clone();
    let email = recipient["email"].take();
    assert!(
        email
            .as_str()
            .is_some_and(|email| email.starts_with("ada-")),
        "{body}"
    );
    assert_eq!(
        recipient,
        json!({
            "source": "none",
            "role": null,
            "kind": "patient",
            "name": "Ada Muster",
            "street": "Patientenweg 3",
            "zip": "10117",
            "city": "Berlin",
            "country": "DE",
            "email": null,
            "payer_patient_relation_id": null,
            "payer_patient_id": null,
            "missing": [],
            "minor_without_payer": false,
        }),
        "{body}"
    );

    // A minor without any relation would receive the invoice.
    let orphan = seed_patient(&app, "Mia", "2016-04-05").await;
    let body = summary(&app, orphan, "ceo").await;
    assert_eq!(body["patient_is_minor"], true);
    assert_eq!(body["contracting_party"]["kind"], "legal_representatives");
    assert_eq!(body["invoice_recipient"]["source"], "none");
    assert_eq!(body["invoice_recipient"]["minor_without_payer"], true);
}

#[tokio::test]
async fn a_self_payer_adult_and_a_third_party_person() {
    let Some(app) = test_app().await else { return };
    let pool = app.pool();

    // The patient pays: the declaration says so and names nobody.
    let own = seed_patient(&app, "Ben", "1980-05-05").await;
    let converted_at = minutes_ago(60);
    let own_lead =
        seed_converted_lead(&app, own, "Ben", "1980-05-05", json!([]), converted_at).await;
    seed_declaration(&app, own_lead, Some(own), self_payer(), minutes_ago(90)).await;
    let body = summary(&app, own, "ceo").await;
    assert_eq!(body["source"]["lead_id"], own_lead.to_string(), "{body}");
    assert_eq!(
        DateTime::parse_from_rfc3339(body["source"]["converted_at"].as_str().unwrap())
            .unwrap()
            .timestamp(),
        converted_at.timestamp()
    );
    assert!(body["source"]["declared_at"].is_string(), "{body}");
    let declaration = &body["declaration"];
    assert_eq!(declaration["payer_kind"], "self");
    for key in [
        "payer_type",
        "name",
        "organisation_name",
        "first_name",
        "last_name",
        "relationship_kind",
        "relationship",
        "street",
        "zip",
        "city",
        "country",
        "email",
        "phone",
        "contact_consent_at",
        "payer_informed_at",
        "invoice_to",
        "invoice_name",
        "invoice_street",
        "invoice_zip",
        "invoice_city",
        "invoice_country",
        "invoice_email",
        "invoice_vat_id",
        "invoice_tax_number",
    ] {
        assert!(declaration[key].is_null(), "{key}: {body}");
    }
    assert_eq!(body["contracting_party"]["kind"], "patient");
    assert_eq!(body["invoice_recipient"]["source"], "none");
    assert_eq!(body["invoice_recipient"]["kind"], "patient");
    assert_eq!(body["invoice_recipient"]["name"], "Ben Muster");
    assert_eq!(body["invoice_recipient"]["street"], "Patientenweg 3");
    assert_eq!(body["identification"]["minor"], false, "{body}");
    assert!(body["identification"]["payer"].is_null(), "{body}");
    assert_eq!(body["identification"]["representatives"], json!([]));

    // A third party pays: the card names the payer, and the invoice goes to
    // that payer as a cost bearer with the declared address.
    let paid = seed_patient(&app, "Carla", "1980-05-05").await;
    let paid_lead = seed_converted_lead(
        &app,
        paid,
        "Carla",
        "1980-05-05",
        json!([]),
        minutes_ago(60),
    )
    .await;
    // The lead also said the invoice goes to the payer and how Viktor pays
    // (section 8): the card shows the former, never the latter.
    let mut viktor_pays = viktor();
    viktor_pays["invoice_to"] = json!("payer");
    viktor_pays["invoice_vat_id"] = json!("ATU12345678");
    viktor_pays["payment_method"] = json!("cash");
    viktor_pays["via_third_party"] = json!(true);
    seed_declaration(&app, paid_lead, Some(paid), viktor_pays, minutes_ago(90)).await;
    let body = summary(&app, paid, "ceo").await;
    assert_eq!(
        body["declaration"],
        json!({
            "payer_kind": "third_party",
            "payer_type": "person",
            "name": "Viktor Zahler",
            "organisation_name": null,
            "first_name": "Viktor",
            "last_name": "Zahler",
            "relationship_kind": "relative",
            "relationship": null,
            "street": "Ringstr. 9",
            "zip": "1010",
            "city": "Wien",
            "country": "AT",
            "email": "viktor.zahler@example.com",
            "phone": "+43 1 0000000",
            "contact_consent_at": "2026-10-05T18:40:00+00:00",
            "payer_informed_at": "2026-10-05T19:00:00+00:00",
            "invoice_to": "payer",
            "invoice_name": null,
            "invoice_street": null,
            "invoice_zip": null,
            "invoice_city": null,
            "invoice_country": null,
            "invoice_email": null,
            "invoice_vat_id": "ATU12345678",
            "invoice_tax_number": null,
        }),
        "{body}"
    );
    // No GwG answer and nothing of the payment route leaves the server.
    let text = body.to_string();
    for forbidden in [
        "date_of_birth",
        "citizenships",
        "source_of_funds",
        "beneficial_owner",
        "acts_on_own_account",
        "1970-05-01",
        "payment_method",
        "via_third_party",
        "account_holder",
        "compliance_flags",
        "cash",
    ] {
        assert!(!text.contains(forbidden), "{forbidden} in {body}");
    }
    assert_eq!(
        body["invoice_recipient"],
        json!({
            "source": "payer_declaration",
            "role": "cost_bearer",
            "kind": "contact",
            "name": "Viktor Zahler",
            "street": "Ringstr. 9",
            "zip": "1010",
            "city": "Wien",
            "country": "AT",
            "email": "viktor.zahler@example.com",
            "payer_patient_relation_id": null,
            "payer_patient_id": null,
            "missing": [],
            "minor_without_payer": false,
        }),
        "{body}"
    );
    assert_eq!(
        body["identification"]["payer"],
        json!({ "qes": null, "own_account_payment": null, "same_person_as": null }),
        "{body}"
    );

    // Billing sees the same, without the identification — the invoice
    // recipient of section 7 and the tax fields included.
    let billing = summary(&app, paid, "billing").await;
    assert!(billing["identification"].is_null(), "{billing}");
    assert_eq!(billing["declaration"]["invoice_vat_id"], "ATU12345678");
    let mut expected = body.clone();
    expected["identification"] = Value::Null;
    assert_eq!(billing, expected);
    let assistant = summary(&app, paid, "ceo_assistant").await;
    assert_eq!(assistant, body);

    // "To another address": the invoice goes to the party at that address
    // (role `invoice_address`), not to a Kostenübernehmer.
    let moved = seed_patient(&app, "Elsa", "1980-05-05").await;
    let moved_lead = seed_converted_lead(
        &app,
        moved,
        "Elsa",
        "1980-05-05",
        json!([]),
        minutes_ago(60),
    )
    .await;
    seed_declaration(
        &app,
        moved_lead,
        Some(moved),
        json!({
            "payer_kind": "self",
            "source_of_funds": "employment",
            "invoice_to": "other",
            "invoice_name": "Elsa Muster",
            "invoice_street": "Nebenweg 2",
            "invoice_zip": "80331",
            "invoice_city": "München",
            "invoice_country": "DE",
            "invoice_email": "rechnung@example.com",
            "invoice_tax_number": "12/345/67890"
        }),
        minutes_ago(90),
    )
    .await;
    let body = summary(&app, moved, "billing").await;
    assert_eq!(body["declaration"]["payer_kind"], "self", "{body}");
    assert_eq!(body["declaration"]["invoice_to"], "other", "{body}");
    assert_eq!(body["declaration"]["invoice_city"], "München", "{body}");
    assert_eq!(body["declaration"]["invoice_tax_number"], "12/345/67890");
    assert_eq!(
        body["invoice_recipient"],
        json!({
            "source": "invoice_address",
            "role": "invoice_address",
            "kind": "contact",
            "name": "Elsa Muster",
            "street": "Nebenweg 2",
            "zip": "80331",
            "city": "München",
            "country": "DE",
            "email": "rechnung@example.com",
            "payer_patient_relation_id": null,
            "payer_patient_id": null,
            "missing": [],
            "minor_without_payer": false,
        }),
        "{body}"
    );

    // An organisation is named by its name; its signer's QES is the payer's.
    let company = seed_patient(&app, "Dora", "1980-05-05").await;
    let company_lead = seed_converted_lead(
        &app,
        company,
        "Dora",
        "1980-05-05",
        json!([]),
        minutes_ago(60),
    )
    .await;
    seed_declaration(
        &app,
        company_lead,
        Some(company),
        json!({
            "payer_kind": "third_party",
            "payer_type": "company",
            "organisation_name": "Beispiel GmbH",
            "street": "Industriestr. 2",
            "zip": "50667",
            "city": "Köln",
            "country": "DE",
            "relationship_kind": "employer",
            "email": "kosten@example.com",
            "source_of_funds": "business_income",
            "payer_informed_at": "2026-10-05T19:00:00Z"
        }),
        minutes_ago(90),
    )
    .await;
    let body = summary(&app, company, "ceo").await;
    assert_eq!(body["declaration"]["payer_type"], "company", "{body}");
    assert_eq!(body["declaration"]["name"], "Beispiel GmbH");
    assert_eq!(body["declaration"]["organisation_name"], "Beispiel GmbH");
    assert!(body["declaration"]["first_name"].is_null());
    assert!(body["declaration"]["last_name"].is_null());
    assert_eq!(body["invoice_recipient"]["source"], "payer_declaration");
    assert_eq!(body["invoice_recipient"]["name"], "Beispiel GmbH");
    assert_eq!(body["invoice_recipient"]["city"], "Köln");
    assert!(body["identification"]["payer"].is_object(), "{body}");
    let moved = seed_patient_document(&app, company).await;
    seed_qes(&app, moved, "payer", "kosten@example.com", minutes_ago(30)).await;
    let body = summary(&app, company, "ceo").await;
    assert!(
        body["identification"]["payer"]["qes"]["signed_at"].is_string(),
        "{body}"
    );
    let count: i64 =
        sqlx::query_scalar("SELECT count(*) FROM patient_relations WHERE patient_id = $1")
            .bind(company)
            .fetch_one(pool)
            .await
            .unwrap();
    assert_eq!(count, 0, "the summary stores nothing");
}

#[tokio::test]
async fn a_minor_whose_parent_pays_and_a_minor_paid_by_a_relative() {
    let Some(app) = test_app().await else { return };
    let (anna, ben) = (Uuid::new_v4(), Uuid::new_v4());
    let parents = json!([
        { "id": anna, "name": "Anna Muster", "relation": "mother",
          "email": "anna.muster@example.com", "birth_date": "1985-03-02" },
        { "id": ben, "name": "Ben Muster", "relation": "father",
          "email": "ben.muster@example.com" },
    ]);

    // Mia Muster, parents Anna (pays) and Ben; an older conversion that did
    // not mark the paying parent as default payer.
    let mia = seed_patient(&app, "Mia", "2016-04-05").await;
    let anna_relation = seed_relation(
        &app,
        mia,
        "Anna Muster",
        "parent",
        Some("anna.muster@example.com"),
        true,
        false,
    )
    .await;
    seed_relation(
        &app,
        mia,
        "Ben Muster",
        "parent",
        Some("ben.muster@example.com"),
        false,
        false,
    )
    .await;
    let converted_at = minutes_ago(60);
    let lead_id = seed_converted_lead(
        &app,
        mia,
        "Mia",
        "2016-04-05",
        parents.clone(),
        converted_at,
    )
    .await;
    seed_declaration(&app, lead_id, Some(mia), anna_pays(), minutes_ago(90)).await;
    // Anna signed the Kostenübernahmeerklärung after being named; the
    // document moved to the patient with the conversion.
    let moved = seed_patient_document(&app, mia).await;
    let signed_at = minutes_ago(30);
    seed_qes(&app, moved, "payer", "anna.muster@example.com", signed_at).await;

    let body = summary(&app, mia, "ceo").await;
    assert_eq!(body["patient_is_minor"], true, "{body}");
    assert_eq!(body["declaration"]["name"], "Anna Muster");
    assert_eq!(body["declaration"]["relationship_kind"], "parent");
    let party = &body["contracting_party"];
    assert_eq!(party["kind"], "legal_representatives");
    assert_eq!(party["explicit"], false);
    assert_eq!(party["patient_name"], "Mia Muster");
    assert_eq!(party["debtor_name"], "Anna Muster und Ben Muster");
    let anna_party = &party["representatives"][0];
    assert_eq!(anna_party["relation_id"], anna_relation.to_string());
    assert_eq!(anna_party["name"], "Anna Muster");
    assert_eq!(anna_party["email"], "anna.muster@example.com");
    assert_eq!(anna_party["address"], "Musterweg 1, 10115 Berlin, DE");
    assert_eq!(anna_party["is_default_payer"], false);
    assert_eq!(party["representatives"][1]["name"], "Ben Muster");
    // Without the default-payer mark the declaration decides: Anna as a
    // free-text cost bearer.
    assert_eq!(body["invoice_recipient"]["source"], "payer_declaration");
    assert_eq!(body["invoice_recipient"]["role"], "cost_bearer");
    assert_eq!(body["invoice_recipient"]["kind"], "contact");
    assert_eq!(body["invoice_recipient"]["name"], "Anna Muster");
    assert!(body["invoice_recipient"]["payer_patient_relation_id"].is_null());
    // The identification of the converted lead: both parents, the paying
    // parent on the payer line, her signature on a moved document counts.
    let identification = &body["identification"];
    assert_eq!(identification["minor"], true, "{body}");
    assert_eq!(
        identification["contract_partner"],
        json!({ "qes": null, "own_account_payment": null })
    );
    assert_eq!(
        identification["payer"]["same_person_as"],
        format!("representative:{anna}"),
        "{body}"
    );
    assert_eq!(
        DateTime::parse_from_rfc3339(
            identification["payer"]["qes"]["signed_at"]
                .as_str()
                .unwrap()
        )
        .unwrap()
        .timestamp(),
        signed_at.timestamp()
    );
    let lines = identification["representatives"].as_array().unwrap();
    assert_eq!(lines.len(), 2, "{body}");
    assert_eq!(lines[0]["id"], anna.to_string());
    assert_eq!(lines[0]["subject"], format!("representative:{anna}"));
    assert_eq!(lines[0]["name"], "Anna Muster");
    assert_eq!(lines[0]["relation"], "mother");
    assert_eq!(lines[0]["has_email"], true);
    assert!(lines[0]["qes"]["signed_at"].is_string(), "{body}");
    assert_eq!(lines[1]["name"], "Ben Muster");
    assert!(lines[1]["qes"].is_null());

    // Staff set the paying parent as default payer (what the conversion does
    // now): the invoice goes to her as contracting party.
    sqlx::query("UPDATE patient_relations SET is_default_payer = true WHERE id = $1")
        .bind(anna_relation)
        .execute(app.pool())
        .await
        .unwrap();
    let body = summary(&app, mia, "ceo").await;
    assert_eq!(
        body["invoice_recipient"],
        json!({
            "source": "default_payer",
            "role": "contracting_party",
            "kind": "relation",
            "name": "Anna Muster",
            "street": "Musterweg 1",
            "zip": "10115",
            "city": "Berlin",
            "country": "DE",
            "email": "anna.muster@example.com",
            "payer_patient_relation_id": anna_relation,
            "payer_patient_id": null,
            "missing": [],
            "minor_without_payer": false,
        }),
        "{body}"
    );
    assert_eq!(
        body["contracting_party"]["representatives"][0]["is_default_payer"],
        true
    );
    // Billing: the same card without the identification labels. An assigned
    // patient manager reads everything.
    let billing = summary(&app, mia, "billing").await;
    assert!(billing["identification"].is_null(), "{billing}");
    assert_eq!(billing["invoice_recipient"], body["invoice_recipient"]);
    assert_eq!(billing["contracting_party"], body["contracting_party"]);
    sqlx::query(
        "INSERT INTO patient_assignments (patient_id, user_id, assigned_by) VALUES ($1, $2, $2)",
    )
    .bind(mia)
    .bind(app.user_id("patient_manager"))
    .execute(app.pool())
    .await
    .unwrap();
    let manager = summary(&app, mia, "patient_manager").await;
    assert_eq!(manager, body);
}

#[tokio::test]
async fn a_relative_pays_for_a_minor_the_newest_conversion_counts_and_an_open_request_is_named() {
    let Some(app) = test_app().await else { return };
    let (anna, ben) = (Uuid::new_v4(), Uuid::new_v4());
    let parents = json!([
        { "id": anna, "name": "Anna Muster", "relation": "mother",
          "email": "anna.muster@example.com" },
        { "id": ben, "name": "Ben Muster", "relation": "father",
          "email": "ben.muster@example.com" },
    ]);
    let leo = seed_patient(&app, "Leo", "2015-01-01").await;
    seed_relation(
        &app,
        leo,
        "Anna Muster",
        "parent",
        Some("anna.muster@example.com"),
        true,
        false,
    )
    .await;
    seed_relation(
        &app,
        leo,
        "Ben Muster",
        "parent",
        Some("ben.muster@example.com"),
        true,
        false,
    )
    .await;
    let first_lead = seed_converted_lead(
        &app,
        leo,
        "Leo",
        "2015-01-01",
        parents.clone(),
        minutes_ago(600),
    )
    .await;
    seed_declaration(&app, first_lead, Some(leo), viktor(), minutes_ago(620)).await;

    let body = summary(&app, leo, "ceo").await;
    assert_eq!(body["source"]["lead_id"], first_lead.to_string(), "{body}");
    assert_eq!(body["declaration"]["relationship_kind"], "relative");
    assert_eq!(body["invoice_recipient"]["source"], "payer_declaration");
    assert_eq!(body["invoice_recipient"]["role"], "cost_bearer");
    assert_eq!(body["invoice_recipient"]["name"], "Viktor Zahler");
    assert_eq!(body["invoice_recipient"]["city"], "Wien");
    let identification = &body["identification"];
    assert_eq!(identification["minor"], true, "{body}");
    assert_eq!(
        identification["payer"],
        json!({ "qes": null, "own_account_payment": null, "same_person_as": null }),
        "{body}"
    );
    assert_eq!(
        identification["representatives"].as_array().unwrap().len(),
        2
    );

    // A second request, converted later: its declaration counts (the
    // patient pays now), and the source names that lead.
    let second_lead = seed_converted_lead(
        &app,
        leo,
        "Leo",
        "2015-01-01",
        parents.clone(),
        minutes_ago(60),
    )
    .await;
    seed_declaration(&app, second_lead, Some(leo), self_payer(), minutes_ago(90)).await;
    let body = summary(&app, leo, "ceo").await;
    assert_eq!(body["source"]["lead_id"], second_lead.to_string(), "{body}");
    assert_eq!(body["declaration"]["payer_kind"], "self");
    // Nobody declared, no default payer: the parents as contracting party.
    assert_eq!(body["invoice_recipient"]["source"], "contracting_party");
    assert_eq!(body["invoice_recipient"]["role"], "contracting_party");
    assert_eq!(body["invoice_recipient"]["kind"], "relation");
    assert_eq!(body["invoice_recipient"]["name"], "Anna Muster");
    assert!(body["open_request"].is_null(), "{body}");

    // An open repeat request of the patient is named, never counted.
    let open_lead: Uuid = sqlx::query_scalar(
        r#"INSERT INTO leads (first_name, last_name, email, date_of_birth, legal_sex,
                              qualification_status, compliance_status, intake_source,
                              intake_model, repeat_patient_id, trusted_contacts)
           VALUES ('Leo', 'Muster', $1, DATE '2015-01-01', 'male', 'new', 'pending',
                   'staff_wizard', 'patient_first', $2, $3)
           RETURNING id"#,
    )
    .bind(format!("open-{}@example.com", Uuid::new_v4().simple()))
    .bind(leo)
    .bind(parents)
    .fetch_one(app.pool())
    .await
    .unwrap();
    let body = summary(&app, leo, "ceo").await;
    assert_eq!(
        body["open_request"],
        json!({ "lead_id": open_lead, "has_declaration": false }),
        "{body}"
    );
    assert_eq!(body["source"]["lead_id"], second_lead.to_string());
    seed_declaration(&app, open_lead, None, viktor(), minutes_ago(5)).await;
    let body = summary(&app, leo, "ceo").await;
    assert_eq!(body["open_request"]["has_declaration"], true, "{body}");
    assert_eq!(body["declaration"]["payer_kind"], "self", "{body}");
    assert_eq!(body["invoice_recipient"]["source"], "contracting_party");
    // An archived request is no open request.
    sqlx::query(
        "UPDATE leads SET qualification_status = 'archived', failed_outcome_status = 'archived' WHERE id = $1",
    )
    .bind(open_lead)
    .execute(app.pool())
    .await
    .unwrap();
    let body = summary(&app, leo, "ceo").await;
    assert!(body["open_request"].is_null(), "{body}");

    // A prospect: the request the patient record was made for is open, and
    // there is no declaration of the patient yet.
    let prospect = seed_patient(&app, "Nora", "1980-05-05").await;
    let prospect_lead: Uuid = sqlx::query_scalar(
        r#"INSERT INTO leads (first_name, last_name, email, date_of_birth, legal_sex,
                              qualification_status, compliance_status, intake_source,
                              intake_model, prospect_patient_id)
           VALUES ('Nora', 'Muster', $1, DATE '1980-05-05', 'female', 'qualified', 'signed',
                   'staff_wizard', 'patient_first', $2)
           RETURNING id"#,
    )
    .bind(format!("prospect-{}@example.com", Uuid::new_v4().simple()))
    .bind(prospect)
    .fetch_one(app.pool())
    .await
    .unwrap();
    seed_declaration(&app, prospect_lead, None, viktor(), minutes_ago(5)).await;
    let body = summary(&app, prospect, "ceo").await;
    assert!(body["source"].is_null(), "{body}");
    assert!(body["declaration"].is_null(), "{body}");
    assert!(body["identification"].is_null(), "{body}");
    assert_eq!(
        body["open_request"],
        json!({ "lead_id": prospect_lead, "has_declaration": true })
    );
    assert_eq!(body["invoice_recipient"]["source"], "none");
}
