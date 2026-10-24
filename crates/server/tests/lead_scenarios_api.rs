//! End-to-end scenarios of the lead wizard and the parents' / guardians'
//! cabinet against the real server and a disposable database: every step
//! goes through the HTTP API the way the cabinet and the staff wizard call
//! it, and asserts what the screens would show next. Synthetic data only.

mod support;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use serde_json::{Value, json};
use sqlx::PgPool;
use tower::ServiceExt;
use uuid::Uuid;

use gmed_server::auth::jwt;

const SECRET: &str = "test-secret-at-least-32-characters-long!!";
const INQUIRY_CONSENT_VERSION: &str = "2026-10-03";
const HEALTH_CONSENT_VERSION: &str = "2026-10-13";
const PDF: &[u8] = b"%PDF-1.4\n% synthetic scenario document\n%%EOF\n";

struct Scn {
    suite: support::TestSuiteContext,
    pm_id: Uuid,
    ceo_id: Uuid,
}

fn bearer(user_id: Uuid, role: &str) -> String {
    let token = jwt::issue_access_token(SECRET, user_id, role, Uuid::new_v4()).unwrap();
    format!("Bearer {token}")
}

fn unique(name: &str) -> String {
    format!("{name}.{}@example.com", Uuid::new_v4().simple())
}

async fn seed_user(pool: &PgPool, role: &str) -> Uuid {
    sqlx::query_scalar(
        "INSERT INTO users (email, password_hash, name, role) VALUES ($1, 'test-password-hash', $2, $3) RETURNING id",
    )
    .bind(unique(&format!("scenario-{role}")))
    .bind(format!("Scenario {role}"))
    .bind(role)
    .fetch_one(pool)
    .await
    .unwrap()
}

impl Scn {
    async fn new() -> Option<Self> {
        let suite = support::suite_context(SECRET).await?;
        let pm_id = seed_user(&suite.pool, "patient_manager").await;
        let ceo_id = seed_user(&suite.pool, "ceo").await;
        Some(Self {
            suite,
            pm_id,
            ceo_id,
        })
    }

    fn pool(&self) -> &PgPool {
        &self.suite.pool
    }

    fn pm(&self) -> String {
        bearer(self.pm_id, "patient_manager")
    }

    fn ceo(&self) -> String {
        bearer(self.ceo_id, "ceo")
    }

    async fn call(
        &self,
        method: &str,
        path: &str,
        auth: &str,
        body: Option<Value>,
    ) -> (StatusCode, Value) {
        let body = match body {
            Some(value) => Body::from(serde_json::to_vec(&value).unwrap()),
            None => Body::empty(),
        };
        let request = Request::builder()
            .method(method)
            .uri(format!("/api/v1{path}"))
            .header("Authorization", auth)
            .header("Content-Type", "application/json")
            .body(body)
            .unwrap();
        let response = self.suite.app.clone().oneshot(request).await.unwrap();
        let status = response.status();
        let bytes = axum::body::to_bytes(response.into_body(), 8 * 1024 * 1024)
            .await
            .unwrap();
        (
            status,
            serde_json::from_slice(&bytes).unwrap_or(Value::Null),
        )
    }

    /// The call must answer `expected`; returns the body.
    async fn ok(
        &self,
        expected: StatusCode,
        method: &str,
        path: &str,
        auth: &str,
        body: Option<Value>,
    ) -> Value {
        let (status, value) = self.call(method, path, auth, body).await;
        assert_eq!(status, expected, "{method} {path}: {value}");
        value
    }

    async fn upload(&self, path: &str, auth: &str) -> (StatusCode, Value) {
        self.upload_with(path, auth, b"").await
    }

    /// Uploads the synthetic PDF with `extra` bytes appended: another scan
    /// of the same kind (the same bytes twice are refused as a duplicate).
    async fn upload_with(&self, path: &str, auth: &str, extra: &[u8]) -> (StatusCode, Value) {
        let boundary = format!("----gmed-scenario-{}", Uuid::new_v4().simple());
        let mut body = Vec::new();
        body.extend_from_slice(format!("--{boundary}\r\n").as_bytes());
        body.extend_from_slice(
            b"Content-Disposition: form-data; name=\"file\"; filename=\"ausweis.pdf\"\r\nContent-Type: application/pdf\r\n\r\n",
        );
        body.extend_from_slice(PDF);
        body.extend_from_slice(extra);
        body.extend_from_slice(format!("\r\n--{boundary}--\r\n").as_bytes());
        let request = Request::builder()
            .method("POST")
            .uri(format!("/api/v1{path}"))
            .header("Authorization", auth)
            .header(
                "Content-Type",
                format!("multipart/form-data; boundary={boundary}"),
            )
            .body(Body::from(body))
            .unwrap();
        let response = self.suite.app.clone().oneshot(request).await.unwrap();
        let status = response.status();
        let bytes = axum::body::to_bytes(response.into_body(), 8 * 1024 * 1024)
            .await
            .unwrap();
        (
            status,
            serde_json::from_slice(&bytes).unwrap_or(Value::Null),
        )
    }

    async fn consent(&self, lead: Uuid, auth: &str, purpose: &str) {
        let version = if purpose == "lead_inquiry_processing" {
            INQUIRY_CONSENT_VERSION
        } else {
            HEALTH_CONSENT_VERSION
        };
        let (status, body) = self
            .call(
                "POST",
                &format!("/me/lead-requests/{lead}/consent"),
                auth,
                Some(json!({ "purpose": purpose, "version": version, "language": "de" })),
            )
            .await;
        assert!(
            status == StatusCode::OK || status == StatusCode::CREATED,
            "consent {purpose}: {status} {body}"
        );
    }

    /// Staff create a minor lead with the given trusted contacts.
    async fn minor_lead(&self, first_name: &str, contacts: Value) -> Uuid {
        let created = self
            .ok(
                StatusCode::CREATED,
                "POST",
                "/leads",
                &self.pm(),
                Some(json!({
                    "first_name": first_name,
                    "last_name": "Muster",
                    "date_of_birth": "2016-04-05",
                    "email": unique(&first_name.to_lowercase()),
                    "trusted_contacts": contacts,
                })),
            )
            .await;
        assert!(created["portal_account"].is_null(), "{created}");
        created["id"].as_str().unwrap().parse().unwrap()
    }

    /// Staff issue a parent's / guardian's own access; returns (user, bearer).
    async fn guardian_access(&self, lead: Uuid, contact: Uuid) -> (Uuid, String) {
        let issued = self
            .ok(
                StatusCode::CREATED,
                "POST",
                &format!("/leads/{lead}/portal-guardians"),
                &self.pm(),
                Some(json!({ "trusted_contact_id": contact })),
            )
            .await;
        let user: Uuid = issued["user_id"].as_str().unwrap().parse().unwrap();
        (user, bearer(user, "patient"))
    }

    async fn cabinet(&self, lead: Uuid, auth: &str) -> Value {
        self.ok(
            StatusCode::OK,
            "GET",
            &format!("/me/lead-requests/{lead}"),
            auth,
            None,
        )
        .await
    }

    async fn staff_lead(&self, lead: Uuid) -> Value {
        self.ok(
            StatusCode::OK,
            "GET",
            &format!("/leads/{lead}"),
            &self.pm(),
            None,
        )
        .await
    }
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

/// id, name, relation, default payer, birth date, street of a patient relation.
type RelationRow = (
    Uuid,
    String,
    String,
    bool,
    Option<chrono::NaiveDate>,
    Option<String>,
);

fn parent_details(street: &str, birth: &str, citizenship: &str) -> Value {
    json!({
        "date_of_birth": birth,
        "birth_place": "Berlin",
        "citizenships": [citizenship],
        "street": street,
        "zip": "10115",
        "city": "Berlin",
        "country": "DE",
        "phone": "+49 30 000000"
    })
}

fn child_personal_data() -> Value {
    json!({
        "date_of_birth": "2016-04-05",
        "legal_sex": "female",
        "citizenships": ["DE"],
        "street_address": "Musterweg 1",
        "zip_code": "10115",
        "city": "Berlin",
        "country": "DE",
        "phone": "+49 30 1234567"
    })
}

/// The onboarding artifacts staff produce outside the cabinet (case, signed
/// consents, framework contract, order, accepted quote, generated contract
/// documents), as `leads_api.rs` seeds them: the scenarios drive the
/// cabinet, identification and conversion through the API, not the
/// contract and quote editors. Returns the order.
async fn seed_onboarding(app: &Scn, lead: Uuid) -> Uuid {
    let pool = app.pool();
    let tag = lead.simple().to_string();
    let pm = app.pm_id;
    let work_type = "7a3c9e21-5b64-4f0d-9c2e-1d8b6a4f3e70";
    sqlx::query(
        r#"UPDATE leads
           SET primary_concern_text = 'Chronic knee pain',
               requested_specialties = '["orthopedics"]'::jsonb,
               compliance_status = 'signed',
               consent_healthcare = true,
               consent_privacy_practices = true,
               wizard_state = COALESCE(wizard_state, '{}'::jsonb)
                   || jsonb_build_object('selected_specialization_work_type_ids', jsonb_build_array($2::text))
           WHERE id = $1"#,
    )
    .bind(lead)
    .bind(work_type)
    .execute(pool)
    .await
    .unwrap();
    // The wizard's prospect step opened the case; its intake is complete.
    let updated = sqlx::query(
        r#"UPDATE cases SET hauptanfragegrund = 'Chronic knee pain', zuweiser = 'Self referral',
                            intake_completed_at = now(), intake_completed_by = $2
           WHERE lead_id = $1 OR source_lead_id = $1"#,
    )
    .bind(lead)
    .bind(pm)
    .execute(pool)
    .await
    .unwrap()
    .rows_affected();
    assert!(updated > 0, "the prospect step opens the case");
    for (kind, template) in [
        ("identity", None),
        ("dsgvo", None),
        ("confidentiality_release", None),
        ("other", Some("lead_self_disclosure")),
    ] {
        let id = Uuid::new_v4();
        sqlx::query(
            r#"INSERT INTO documents (
                    id, lead_id, auto_name, original_filename, art, category, status,
                    visibility, is_medical, mime_type, file_size, generated_template_id,
                    version_root_document_id, version_number, uploaded_by, signed_at,
                    signed_by, compliance_kind)
               VALUES ($1, $2, $3, $3, $4, 'administrative', 'active', 'internal', false,
                       'application/pdf', 128, $5, $1, 1, $6, now(), $6,
                       CASE WHEN $5::text IS NULL THEN $4 END)"#,
        )
        .bind(id)
        .bind(lead)
        .bind(format!("{kind}-{tag}.pdf"))
        .bind(kind)
        .bind(template)
        .bind(pm)
        .execute(pool)
        .await
        .unwrap();
    }
    let contract: Uuid = sqlx::query_scalar(
        r#"INSERT INTO framework_contracts (lead_id, contract_number, signed_at, status, created_by, client_reference)
           VALUES ($1, $2, now(), 'signed', $3, $4) RETURNING id"#,
    )
    .bind(lead)
    .bind(format!("FC-SCN-{tag}"))
    .bind(pm)
    .bind(format!("lead-onboarding:{lead}:framework"))
    .fetch_one(pool)
    .await
    .unwrap();
    let order: Uuid = sqlx::query_scalar(
        r#"INSERT INTO orders (order_number, contract_id, source_lead_id, needs_description,
                               signed_patient, signed_agency, signed_patient_at, signed_agency_at,
                               signed_at, prepayment_required, total_estimated, created_by)
           VALUES ($1, $2, $3, 'Coordinate orthopedic treatment', true, true, now(), now(),
                   now(), true, 119, $4)
           ON CONFLICT (source_lead_id) WHERE source_lead_id IS NOT NULL DO UPDATE
             SET contract_id = EXCLUDED.contract_id, prepayment_required = true,
                 total_estimated = 119, signed_patient = true, signed_agency = true,
                 signed_at = now(), signed_patient_at = now(), signed_agency_at = now()
           RETURNING id"#,
    )
    .bind(format!("A-SCN-{tag}"))
    .bind(contract)
    .bind(lead)
    .bind(pm)
    .fetch_one(pool)
    .await
    .unwrap();
    sqlx::query(
        r#"INSERT INTO order_leistungen (order_id, description, quantity, unit_price, vat_rate, client_reference)
           VALUES ($1, 'Initial orthopedic coordination', 1, 100, 19, $2)"#,
    )
    .bind(order)
    .bind(format!("lead-onboarding:{lead}:service:1"))
    .execute(pool)
    .await
    .unwrap();
    sqlx::query(
        r#"INSERT INTO quotes (order_id, quote_number, total_net, total_vat, total_gross, status,
                               paid_amount, paid_at, line_items, created_by)
           VALUES ($1, $2, 100, 19, 119, 'accepted', 119, now(),
                   '[{"description":"Initial orthopedic coordination","quantity":1,"unit_price":100,"vat_rate":19}]'::jsonb,
                   $3)"#,
    )
    .bind(order)
    .bind(format!("KV-SCN-{tag}"))
    .bind(pm)
    .execute(pool)
    .await
    .unwrap();
    for (template, category) in [
        ("framework_contract", "contract"),
        ("single_order", "administrative_single_order"),
        ("order_cost_estimate", "finance_order_cost_estimate"),
        ("cost_estimate", "finance_cost_estimate"),
    ] {
        let id = Uuid::new_v4();
        let bindings = (template == "cost_estimate")
            .then(|| json!({ "_cost_estimate_work_type_ids": [work_type] }));
        sqlx::query(
            r#"INSERT INTO documents (
                    id, lead_id, order_id, auto_name, original_filename, art, category, status,
                    visibility, is_medical, mime_type, file_size, generated_template_id,
                    version_root_document_id, version_number, uploaded_by, generated_bindings)
               VALUES ($1, $2, $3, $4, $4, $5, $6, 'active', 'patient_visible', false,
                       'application/pdf', 128, $5, $1, 1, $7, $8)"#,
        )
        .bind(id)
        .bind(lead)
        .bind(order)
        .bind(format!("{template}-{tag}.pdf"))
        .bind(template)
        .bind(category)
        .bind(pm)
        .bind(bindings)
        .execute(pool)
        .await
        .unwrap();
    }
    sqlx::query(
        "UPDATE documents SET order_intake_context = repeat_order_document_context(order_id) WHERE order_id = $1",
    )
    .bind(order)
    .execute(pool)
    .await
    .unwrap();
    order
}

/// A minor's request the mother filled in: both parents in joint custody,
/// the child's and both parents' identity documents, the mother receives
/// the invoice and the father pays as representative.
struct MinorRequest {
    lead: Uuid,
    mother: Uuid,
    father: Uuid,
    mother_login: Uuid,
    anna: String,
}

impl MinorRequest {
    fn base(&self) -> String {
        format!("/me/lead-requests/{}", self.lead)
    }
}

async fn fill_joint_custody_request(app: &Scn, father_citizenship: &str) -> MinorRequest {
    let strict = father_citizenship == "DE";
    let (mother, father) = (Uuid::new_v4(), Uuid::new_v4());
    let father_email = unique("ben.vater");
    let lead = app
        .minor_lead(
            "Mia",
            json!([
                { "id": mother, "name": "Anna Muster", "relation": "mother",
                  "email": unique("anna.mutter"), "phone": "+49 30 000001" },
                { "id": father, "name": "Ben Muster", "relation": "father",
                  "email": father_email, "phone": "+49 30 000002" }
            ]),
        )
        .await;
    let (mother_login, anna) = app.guardian_access(lead, mother).await;
    let request = MinorRequest {
        lead,
        mother,
        father,
        mother_login,
        anna,
    };
    let base = request.base();
    let anna = &request.anna;

    let fresh = app.cabinet(lead, anna).await;
    for key in ["custody", "invoice_recipient", "id_document_upload"] {
        assert!(missing(&fresh).contains(&key.to_string()), "{key}: {fresh}");
    }
    assert_eq!(fresh["minor"], true);
    assert_eq!(fresh["access_kind"], "guardian");
    app.consent(lead, anna, "health_data_processing").await;
    app.consent(lead, anna, "lead_inquiry_processing").await;
    for (part, body) in [
        ("personal-data", child_personal_data()),
        ("representation", json!({ "custody": "joint" })),
        (
            "identification",
            json!({ "birth_place": "Berlin", "birth_country": "DE",
                    "pep_self": false, "pep_related": false, "sanctions_links": false,
                    "request_reason": "Zweitmeinung" }),
        ),
    ] {
        app.ok(
            StatusCode::OK,
            "POST",
            &format!("{base}/{part}"),
            anna,
            Some(body),
        )
        .await;
    }
    // Her own data in full; the father's address and citizenship. His name
    // and date of birth are his own (or staff's): the cabinet does not ask
    // the mother for them.
    app.ok(
        StatusCode::OK,
        "POST",
        &format!("{base}/representatives/{mother}"),
        anna,
        Some(parent_details("Mutterweg 1", "1985-03-02", "DE")),
    )
    .await;
    let (status, refused) = app
        .call(
            "POST",
            &format!("{base}/representatives/{father}"),
            anna,
            Some(json!({ "date_of_birth": "1983-04-06" })),
        )
        .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{refused}");
    assert_eq!(refused["code"], "representative_not_yours", "{refused}");
    let mut father_details = parent_details("Vaterweg 2", "1983-04-06", father_citizenship);
    father_details
        .as_object_mut()
        .unwrap()
        .remove("date_of_birth");
    app.ok(
        StatusCode::OK,
        "POST",
        &format!("{base}/representatives/{father}"),
        anna,
        Some(father_details),
    )
    .await;
    for path in [
        format!("{base}/identity-document"),
        format!("{base}/representatives/{mother}/identity-document"),
        format!("{base}/representatives/{father}/identity-document"),
    ] {
        let (status, body) = app.upload(&path, anna).await;
        assert_eq!(status, StatusCode::CREATED, "{path}: {body}");
    }
    // "Ich" of the mother's login is the mother.
    let body = app
        .ok(
            StatusCode::OK,
            "POST",
            &format!("{base}/billing"),
            anna,
            Some(json!({ "invoice_recipient": "self" })),
        )
        .await;
    assert_eq!(
        body["billing"]["recipient"]["representative_id"],
        json!(mother)
    );
    let body = app
        .ok(
            StatusCode::OK,
            "POST",
            &format!("{base}/payer"),
            anna,
            Some(json!({
                "payer_kind": "third_party", "payer_type": "person",
                "relationship_kind": "parent",
                "first_name": "Ben", "last_name": "Muster",
                "date_of_birth": "1983-04-06", "email": father_email,
                "citizenships": [father_citizenship], "country": "DE"
            })),
        )
        .await;
    // The father is the paying representative, never a third party.
    assert_eq!(body["payer"]["payer_kind"], "representative", "{body}");
    // A listed citizenship adds the follow-up questions of the parent.
    let base_missing = |body: &Value| -> Vec<String> {
        missing(body)
            .into_iter()
            .filter(|key| {
                strict
                    || !body["follow_up"]["missing"]
                        .to_string()
                        .contains(&format!("\"{key}\""))
            })
            .collect()
    };
    assert_eq!(
        base_missing(&body),
        vec!["invoice_recipient_is_payer".to_string()],
        "{body}"
    );
    let body = app
        .ok(
            StatusCode::OK,
            "POST",
            &format!("{base}/billing"),
            anna,
            Some(json!({ "invoice_recipient_is_payer": false })),
        )
        .await;
    // The father has no login: the mother answers how he pays (section 8).
    // The account holder offered is the paying father — a minor holds no
    // account (before: the child's name).
    assert_eq!(
        base_missing(&body),
        vec!["payment_method".to_string()],
        "{body}"
    );
    assert_eq!(body["billing"]["payment_route_by"], "patient", "{body}");
    assert_eq!(
        body["billing"]["account_holder_suggestion"], "Ben Muster",
        "{}",
        body["billing"]
    );
    let body = app
        .ok(
            StatusCode::OK,
            "POST",
            &format!("{base}/billing"),
            anna,
            Some(json!({
                "payment_method": "bank_transfer", "account_country": "DE",
                "account_holder": "Ben Muster", "bank_name": "Musterbank",
                "via_third_party": false
            })),
        )
        .await;
    assert_eq!(base_missing(&body), Vec::<String>::new(), "{body}");
    request
}

async fn submit(app: &Scn, request: &MinorRequest, auth: &str) -> Value {
    app.ok(
        StatusCode::OK,
        "POST",
        &format!("{}/submit", request.base()),
        auth,
        Some(json!({ "declared_correct": true })),
    )
    .await
}

/// Staff complete a trusted contact in the wizard (the full list is sent).
async fn staff_set_contact(app: &Scn, lead: Uuid, contact: Uuid, patch: Value) {
    let current = app.staff_lead(lead).await;
    let mut contacts = current["trusted_contacts"].as_array().unwrap().clone();
    let entry = contacts
        .iter_mut()
        .find(|entry| entry["id"] == json!(contact))
        .unwrap_or_else(|| panic!("no contact {contact}: {current}"));
    for (key, value) in patch.as_object().unwrap() {
        entry[key] = value.clone();
    }
    app.ok(
        StatusCode::OK,
        "POST",
        &format!("/leads/{lead}/update"),
        &app.pm(),
        Some(json!({ "trusted_contacts": contacts })),
    )
    .await;
}

async fn enter_identity_data(app: &Scn, lead: Uuid, representative: Uuid, number: &str) {
    let stored = app
        .ok(
            StatusCode::OK,
            "PUT",
            &format!("/leads/{lead}/representatives/{representative}/identity-document-data"),
            &app.pm(),
            Some(json!({
                "id_document_type": "passport", "id_document_number": number,
                "id_issuing_authority": "Stadt Berlin",
                // A country name from the scan becomes its code.
                "id_issuing_country": "Deutschland",
                "id_issued_on": "2020-01-02", "id_valid_until": "2030-01-01"
            })),
        )
        .await;
    assert_eq!(stored["id_issuing_country"], "DE", "{stored}");
}

/// Generates the GwG identification sheet of a subject; returns the body.
async fn gwg_sheet(app: &Scn, lead: Uuid, subject: &str) -> (StatusCode, Value) {
    app.call(
        "POST",
        "/documents/generate",
        &app.ceo(),
        Some(json!({
            "template_id": "gwg_identification", "lead_id": lead,
            "language": "de", "status": "active",
            "bindings": { "gwg_identification": { "subject": subject } }
        })),
    )
    .await
}

fn line<'a>(status: &'a Value, list: &str, id: Uuid) -> &'a Value {
    status[list]
        .as_array()
        .unwrap_or_else(|| panic!("no {list}: {status}"))
        .iter()
        .find(|line| line["id"] == json!(id))
        .unwrap_or_else(|| panic!("no {list} line {id}: {status}"))
}

async fn qualify_and_convert(app: &Scn, lead: Uuid) -> Uuid {
    // The wizard creates the prospect patient (and the case) first.
    let prospect = app
        .ok(
            StatusCode::OK,
            "POST",
            &format!("/leads/{lead}/prospect"),
            &app.pm(),
            Some(json!({ "hauptanfragegrund": "Chronic knee pain", "zuweiser": "Self referral" })),
        )
        .await;
    let prospect_patient: Uuid = prospect["patient_id"].as_str().unwrap().parse().unwrap();
    seed_onboarding(app, lead).await;
    app.ok(
        StatusCode::OK,
        "POST",
        &format!("/leads/{lead}/qualify"),
        &app.pm(),
        Some(json!({ "status": "qualified" })),
    )
    .await;
    let staff = app.staff_lead(lead).await;
    assert_eq!(
        staff["readiness"]["conversion_ready"], true,
        "{}",
        staff["readiness"]["blocking_reasons"]
    );
    let converted = app
        .ok(
            StatusCode::OK,
            "POST",
            &format!("/leads/{lead}/wizard-convert"),
            &app.pm(),
            Some(json!({ "confirmed": true })),
        )
        .await;
    let patient: Uuid = converted["patient_id"].as_str().unwrap().parse().unwrap();
    assert_eq!(patient, prospect_patient, "{converted}");
    patient
}

/// Scenario 1: a minor in joint custody, the mother fills the cabinet, the
/// father pays as representative; staff identify both parents, sign their
/// GwG sheets, confirm the father's own-account payment, qualify and
/// convert.
#[tokio::test]
async fn scenario_joint_custody_minor_from_cabinet_to_conversion() {
    let Some(app) = Scn::new().await else { return };
    let request = fill_joint_custody_request(&app, "DE").await;
    let (lead, mother, father) = (request.lead, request.mother, request.father);
    let before = app.cabinet(lead, &request.anna).await;
    assert_eq!(missing(&before), Vec::<String>::new(), "{before}");
    assert_eq!(before["follow_up"]["required"], false, "{before}");
    assert!(before["payer_questionnaire"].is_null(), "{before}");
    let sent = submit(&app, &request, &request.anna).await;
    assert!(sent["submitted_at"].is_string(), "{sent}");
    let after = app.cabinet(lead, &request.anna).await;
    assert!(after["submitted_at"].is_string(), "{after}");
    assert_eq!(after["changed_since_submit"], false, "{after}");

    // Staff: the father's date of birth from the wizard, the identity
    // document data of both parents.
    staff_set_contact(&app, lead, father, json!({ "birth_date": "1983-04-06" })).await;
    enter_identity_data(&app, lead, mother, "C01X00T47").await;
    enter_identity_data(&app, lead, father, "C02X00T48").await;

    let status = app
        .ok(
            StatusCode::OK,
            "GET",
            &format!("/leads/{lead}/identification-status"),
            &app.pm(),
            None,
        )
        .await;
    assert_eq!(status["minor"], true, "{status}");
    assert_eq!(
        status["payer"]["same_person_as"],
        format!("representative:{father}"),
        "{status}"
    );
    // One sheet per parent; nothing is missing for either signature.
    for id in [mother, father] {
        let (code, sheet) = gwg_sheet(&app, lead, &format!("representative:{id}")).await;
        assert_eq!(code, StatusCode::OK, "{sheet}");
        assert_eq!(
            sheet["signature_details"]["missing"],
            json!([]),
            "{id}: {sheet}"
        );
        app.ok(
            StatusCode::OK,
            "POST",
            &format!("/documents/{}/mark-signed", sheet["id"].as_str().unwrap()),
            &app.pm(),
            Some(json!({ "compliance_kind": "other" })),
        )
        .await;
    }
    // The paying father is the payer's line: one confirmation for both.
    let confirmed = app
        .ok(
            StatusCode::OK,
            "POST",
            &format!("/leads/{lead}/identification-status/payer/own-account-payment"),
            &app.pm(),
            Some(json!({ "confirmed": true })),
        )
        .await;
    assert!(confirmed["payer"]["own_account_payment"].is_object());
    assert!(line(&confirmed, "representatives", father)["own_account_payment"].is_object());
    assert!(line(&confirmed, "representatives", mother)["own_account_payment"].is_null());

    let patient = qualify_and_convert(&app, lead).await;
    let pool = app.pool();
    let (custody, contracting): (Option<String>, Vec<Uuid>) =
        sqlx::query_as("SELECT custody, contracting_relation_ids FROM patients WHERE id = $1")
            .bind(patient)
            .fetch_one(pool)
            .await
            .unwrap();
    assert_eq!(custody.as_deref(), Some("joint"));
    let relations: Vec<RelationRow> = sqlx::query_as(
        r#"SELECT id, related_name, relation_type, is_default_payer, birth_date, address_street
               FROM patient_relations WHERE patient_id = $1 ORDER BY related_name"#,
    )
    .bind(patient)
    .fetch_all(pool)
    .await
    .unwrap();
    assert_eq!(relations.len(), 2, "{relations:?}");
    let (anna_relation, name, kind, anna_default, anna_birth, anna_street) = relations[0].clone();
    assert_eq!((name.as_str(), kind.as_str()), ("Anna Muster", "mother"));
    let (ben_relation, name, kind, ben_default, ben_birth, ben_street) = relations[1].clone();
    assert_eq!((name.as_str(), kind.as_str()), ("Ben Muster", "father"));
    assert_eq!(anna_birth, chrono::NaiveDate::from_ymd_opt(1985, 3, 2));
    assert_eq!(ben_birth, chrono::NaiveDate::from_ymd_opt(1983, 4, 6));
    assert_eq!(anna_street.as_deref(), Some("Mutterweg 1"));
    assert_eq!(ben_street.as_deref(), Some("Vaterweg 2"));
    // The parent who receives the invoice is the default payer.
    assert!(anna_default && !ben_default, "{relations:?}");
    let mut expected = vec![anna_relation, ben_relation];
    expected.sort();
    let mut contracting = contracting;
    contracting.sort();
    assert_eq!(
        contracting, expected,
        "both parents contract in joint custody"
    );
    let assignments: Vec<(Uuid, String)> = sqlx::query_as(
        "SELECT user_id, source FROM patient_assignments WHERE patient_id = $1 AND revoked_at IS NULL AND source = 'lead_guardian'",
    )
    .bind(patient)
    .fetch_all(pool)
    .await
    .unwrap();
    assert_eq!(
        assignments,
        vec![(request.mother_login, "lead_guardian".to_string())]
    );
    // The converted request is the patient record now: the cabinet closes it.
    let (code, _) = app.call("GET", &request.base(), &request.anna, None).await;
    assert_eq!(code, StatusCode::NOT_FOUND);
    let (code, me) = app.call("GET", "/me/export", &request.anna, None).await;
    assert_eq!(code, StatusCode::OK, "{me}");
    assert_eq!(me["patient"]["id"], json!(patient), "{me}");
}

/// Scenario 2: the father gets his own login and edits the same request:
/// own data, last write, custody stated by staff, sending again, and staff
/// uploads after sending.
#[tokio::test]
async fn scenario_both_parents_edit_the_same_request() {
    let Some(app) = Scn::new().await else { return };
    let request = fill_joint_custody_request(&app, "DE").await;
    let (lead, father) = (request.lead, request.father);
    let base = request.base();
    let anna = request.anna.clone();
    let (_, ben) = app.guardian_access(lead, father).await;

    // The paying father answers the payment route in his own cabinet now;
    // what the mother answered for him is there, nothing is missing.
    let his = app.cabinet(lead, &ben).await;
    assert_eq!(missing(&his), Vec::<String>::new(), "{his}");
    assert_eq!(his["billing"]["payment_route_by"], "guardian", "{his}");
    assert_eq!(his["billing"]["account_holder"], "Ben Muster", "{his}");
    let own_row = his["representation"]["representatives"]
        .as_array()
        .unwrap()
        .iter()
        .find(|person| person["id"] == json!(father))
        .cloned()
        .unwrap();
    assert_eq!(own_row["mine"], true, "{own_row}");
    let hers = app.cabinet(lead, &anna).await;
    assert_eq!(hers["billing"]["payment_route_by"], "payer", "{hers}");
    assert!(hers["billing"]["payment_method"].is_null(), "{hers}");

    // His birth date is his to state, not the mother's to change.
    app.ok(
        StatusCode::OK,
        "POST",
        &format!("{base}/representatives/{father}"),
        &ben,
        Some(json!({ "date_of_birth": "1983-04-06" })),
    )
    .await;
    let (code, refused) = app
        .call(
            "POST",
            &format!("{base}/representatives/{father}"),
            &anna,
            Some(json!({ "date_of_birth": "1983-04-07" })),
        )
        .await;
    assert_eq!(code, StatusCode::UNPROCESSABLE_ENTITY, "{refused}");
    assert_eq!(refused["code"], "representative_not_yours", "{refused}");

    // Both parents save the child's city at the same moment: both saves
    // answer, one of the two values stays; afterwards the later write stands.
    let personal = format!("{base}/personal-data");
    let (first, second) = tokio::join!(
        app.call("POST", &personal, &anna, Some(json!({ "city": "Potsdam" }))),
        app.call("POST", &personal, &ben, Some(json!({ "city": "Hamburg" }))),
    );
    assert_eq!((first.0, second.0), (StatusCode::OK, StatusCode::OK));
    let city = app.cabinet(lead, &anna).await["personal_data"]["city"].clone();
    assert!(city == "Potsdam" || city == "Hamburg", "{city}");
    app.ok(
        StatusCode::OK,
        "POST",
        &personal,
        &ben,
        Some(json!({ "city": "Berlin" })),
    )
    .await;
    assert_eq!(
        app.cabinet(lead, &anna).await["personal_data"]["city"],
        "Berlin"
    );

    // Staff confirm the custody the cabinet stated: read-only for both.
    app.ok(
        StatusCode::OK,
        "POST",
        &format!("/leads/{lead}/representation"),
        &app.pm(),
        Some(json!({ "custody": "joint" })),
    )
    .await;
    for login in [&anna, &ben] {
        let view = app.cabinet(lead, login).await;
        assert_eq!(
            view["representation"]["custody_set_by_staff"], true,
            "{view}"
        );
        let (code, refused) = app
            .call(
                "POST",
                &format!("{base}/representation"),
                login,
                Some(json!({ "custody": "sole_parent" })),
            )
            .await;
        assert_eq!(code, StatusCode::CONFLICT, "{refused}");
        assert_eq!(refused["code"], "custody_set_by_staff", "{refused}");
        // The same value is no change.
        app.ok(
            StatusCode::OK,
            "POST",
            &format!("{base}/representation"),
            login,
            Some(json!({ "custody": "joint" })),
        )
        .await;
    }

    // The mother sends; the father changes his phone afterwards: both see
    // "send again". He sends himself, after his own request consent.
    submit(&app, &request, &anna).await;
    app.ok(
        StatusCode::OK,
        "POST",
        &format!("{base}/representatives/{father}"),
        &ben,
        Some(json!({ "phone": "+49 30 999999" })),
    )
    .await;
    for login in [&anna, &ben] {
        assert_eq!(app.cabinet(lead, login).await["changed_since_submit"], true);
    }
    let (code, refused) = app
        .call(
            "POST",
            &format!("{base}/submit"),
            &ben,
            Some(json!({ "declared_correct": true })),
        )
        .await;
    assert_eq!(code, StatusCode::UNPROCESSABLE_ENTITY, "{refused}");
    assert_eq!(refused["code"], "inquiry_consent_required", "{refused}");
    app.consent(lead, &ben, "lead_inquiry_processing").await;
    submit(&app, &request, &ben).await;
    assert_eq!(
        app.cabinet(lead, &anna).await["changed_since_submit"],
        false
    );

    // Staff upload another scan of the father's identity document in the
    // wizard after sending (the parents' own scan is on file, the same bytes
    // again would be a duplicate): no change by the parents, nothing to send
    // again.
    let (code, uploaded) = app
        .upload_with(
            &format!("/leads/{lead}/representatives/{father}/identity-document"),
            &app.pm(),
            b"% second scan by staff\n",
        )
        .await;
    assert_eq!(code, StatusCode::CREATED, "{uploaded}");
    assert_eq!(
        app.cabinet(lead, &anna).await["changed_since_submit"],
        false
    );
    let intake = app
        .ok(
            StatusCode::OK,
            "GET",
            &format!("/leads/{lead}/portal-intake"),
            &app.pm(),
            None,
        )
        .await;
    assert_eq!(intake["changed_since_submit"], false, "{intake}");
}

/// Owner decision 2026-10-23: the payment method is the paying person's
/// answer. The father pays and has an own login: the mother sends the
/// request without it, the father answers it in his cabinet and sends
/// again; his save reaches the mother's open cabinet as a realtime event.
#[tokio::test]
async fn scenario_the_paying_parent_answers_the_payment_method() {
    let Some(app) = Scn::new().await else { return };
    let request = fill_joint_custody_request(&app, "DE").await;
    let (lead, father) = (request.lead, request.father);
    let base = request.base();
    let anna = request.anna.clone();
    let (father_login, ben) = app.guardian_access(lead, father).await;
    // Section 8 not answered yet: the father answers it himself.
    sqlx::query(
        "UPDATE lead_payer_declarations
         SET payment_method = NULL, payment_method_details = NULL, account_country = NULL,
             account_holder = NULL, bank_name = NULL, via_third_party = NULL,
             via_third_party_details = NULL
         WHERE lead_id = $1",
    )
    .bind(lead)
    .execute(app.pool())
    .await
    .unwrap();

    let hers = app.cabinet(lead, &anna).await;
    assert_eq!(hers["billing"]["payment_route_by"], "payer", "{hers}");
    assert_eq!(missing(&hers), Vec::<String>::new(), "{hers}");
    let his = app.cabinet(lead, &ben).await;
    assert_eq!(his["billing"]["payment_route_by"], "guardian", "{his}");
    assert_eq!(missing(&his), vec!["payment_method".to_string()], "{his}");

    // The mother sends without the payment method.
    let sent = submit(&app, &request, &anna).await;
    assert!(sent["submitted_at"].is_string(), "{sent}");
    assert_eq!(sent["changed_since_submit"], false, "{sent}");

    // The father answers it in his own cabinet and sends again.
    app.consent(lead, &ben, "lead_inquiry_processing").await;
    let answered = app
        .ok(
            StatusCode::OK,
            "POST",
            &format!("{base}/billing"),
            &ben,
            Some(json!({
                "payment_method": "bank_transfer", "account_country": "DE",
                "account_holder": "Ben Muster", "bank_name": "Musterbank",
                "via_third_party": false
            })),
        )
        .await;
    assert_eq!(missing(&answered), Vec::<String>::new(), "{answered}");
    assert_eq!(answered["changed_since_submit"], true, "{answered}");
    // The mother's open cabinet is told (metadata only) and reads it again.
    let targets: Vec<Uuid> = sqlx::query_scalar(
        "SELECT target_user_ids FROM realtime_events
         WHERE entity_id = $1 AND event_type = 'lead.portal_updated' AND actor_user_id = $2
         ORDER BY seq DESC LIMIT 1",
    )
    .bind(lead)
    .bind(father_login)
    .fetch_one(app.pool())
    .await
    .unwrap();
    assert!(targets.contains(&request.mother_login), "{targets:?}");
    let hers = app.cabinet(lead, &anna).await;
    assert_eq!(hers["changed_since_submit"], true, "{hers}");
    assert_eq!(hers["billing"]["payment_method"], Value::Null, "{hers}");

    let sent = submit(&app, &request, &ben).await;
    assert_eq!(sent["changed_since_submit"], false, "{sent}");
    assert_eq!(missing(&sent), Vec::<String>::new(), "{sent}");
    assert_eq!(
        app.cabinet(lead, &anna).await["changed_since_submit"],
        false
    );
}

/// Scenario 3: a minor under a court-appointed guardian (Vormund): the
/// guardian relation needs the custody "guardian" at the wizard and in the
/// cabinet; the Vormund fills the request, is identified with an own sheet
/// and is the contracting party after the conversion.
#[tokio::test]
async fn scenario_minor_with_a_court_guardian() {
    let Some(app) = Scn::new().await else { return };
    let guardian = Uuid::new_v4();
    let guardian_contact = json!({ "id": guardian, "name": "Greta Vormund", "relation": "guardian",
        "email": unique("greta.vormund"), "phone": "+49 30 000003" });
    // A new lead has no custody yet: the Vormund is refused at the contact.
    let (code, refused) = app
        .call(
            "POST",
            "/leads",
            &app.pm(),
            Some(json!({ "first_name": "Lina", "last_name": "Muster",
                "date_of_birth": "2014-02-03", "email": unique("lina"),
                "trusted_contacts": [guardian_contact.clone()] })),
        )
        .await;
    assert_eq!(code, StatusCode::UNPROCESSABLE_ENTITY, "{refused}");
    assert_eq!(refused["code"], "relation_guardian_needs_custody");
    assert_eq!(refused["contact_id"], json!(guardian));
    // Staff state the guardianship first, then name the Vormund.
    let lead = app.minor_lead("Lina", json!([])).await;
    // The child's date of birth is staff's to set: the cabinet may only
    // repeat it (owner rule, server 422 `dob_staff_only` on a change).
    sqlx::query("UPDATE leads SET date_of_birth = DATE '2014-02-03' WHERE id = $1")
        .bind(lead)
        .execute(app.pool())
        .await
        .unwrap();
    app.ok(
        StatusCode::OK,
        "POST",
        &format!("/leads/{lead}/representation"),
        &app.pm(),
        Some(json!({ "custody": "guardian" })),
    )
    .await;
    app.ok(
        StatusCode::OK,
        "POST",
        &format!("/leads/{lead}/update"),
        &app.pm(),
        Some(json!({ "trusted_contacts": [guardian_contact] })),
    )
    .await;
    // While the contact is the Vormund, neither staff nor the cabinet leave
    // the custody "guardian".
    for custody in [json!("joint"), json!("sole_parent"), Value::Null] {
        let (code, refused) = app
            .call(
                "POST",
                &format!("/leads/{lead}/representation"),
                &app.pm(),
                Some(json!({ "custody": custody })),
            )
            .await;
        assert_eq!(code, StatusCode::UNPROCESSABLE_ENTITY, "{refused}");
        assert_eq!(
            refused["code"], "relation_guardian_needs_custody",
            "{refused}"
        );
    }
    let (_, greta) = app.guardian_access(lead, guardian).await;
    let base = format!("/me/lead-requests/{lead}");
    let view = app.cabinet(lead, &greta).await;
    assert_eq!(view["representation"]["custody"], "guardian", "{view}");
    assert_eq!(view["representation"]["custody_set_by_staff"], true);
    let people = view["representation"]["representatives"]
        .as_array()
        .unwrap();
    assert_eq!(people.len(), 1, "{view}");
    assert_eq!(people[0]["relation"], "guardian");
    assert_eq!(people[0]["mine"], true);
    assert!(!missing(&view).iter().any(|key| key == "custody"), "{view}");
    // Staff stated it: the cabinet may not change it (409 before the
    // relation rule).
    let (code, refused) = app
        .call(
            "POST",
            &format!("{base}/representation"),
            &greta,
            Some(json!({ "custody": "joint" })),
        )
        .await;
    assert_eq!(code, StatusCode::CONFLICT, "{refused}");
    assert_eq!(refused["code"], "custody_set_by_staff", "{refused}");

    app.consent(lead, &greta, "health_data_processing").await;
    app.consent(lead, &greta, "lead_inquiry_processing").await;
    let mut child = child_personal_data();
    child["date_of_birth"] = json!("2014-02-03");
    let steps = [
        ("personal-data".to_string(), child),
        (
            "identification".to_string(),
            json!({ "birth_place": "Berlin", "birth_country": "DE",
                    "pep_self": false, "pep_related": false, "sanctions_links": false,
                    "request_reason": "Zweitmeinung" }),
        ),
        (
            format!("representatives/{guardian}"),
            parent_details("Vormundweg 3", "1975-05-06", "DE"),
        ),
        (
            "billing".to_string(),
            json!({ "invoice_recipient": "self" }),
        ),
    ];
    for (part, body) in steps {
        app.ok(
            StatusCode::OK,
            "POST",
            &format!("{base}/{part}"),
            &greta,
            Some(body),
        )
        .await;
    }
    for path in [
        format!("{base}/identity-document"),
        format!("{base}/representatives/{guardian}/identity-document"),
        format!("{base}/representatives/{guardian}/authority-document"),
    ] {
        let (code, body) = app.upload(&path, &greta).await;
        assert_eq!(code, StatusCode::CREATED, "{path}: {body}");
    }
    let view = app.cabinet(lead, &greta).await;
    // "The recipient pays" (ticked by default) names the Vormund as payer at
    // once (owner decision 2026-10-23): she is the paying representative,
    // and her own login answers how she pays.
    assert_eq!(view["payer"]["payer_kind"], "representative", "{view}");
    assert_eq!(missing(&view), vec!["payment_method".to_string()], "{view}");
    assert_eq!(view["billing"]["recipient"]["name"], "Greta Vormund");
    // Sending the answer again and naming her as payer change nothing.
    let body = app
        .ok(
            StatusCode::OK,
            "POST",
            &format!("{base}/billing"),
            &greta,
            Some(json!({ "invoice_recipient_is_payer": true })),
        )
        .await;
    assert_eq!(
        body["billing"]["invoice_recipient_is_payer"], true,
        "{body}"
    );
    let body = app
        .ok(
            StatusCode::OK,
            "POST",
            &format!("{base}/payer"),
            &greta,
            Some(json!({
                "payer_kind": "third_party", "payer_type": "person",
                "relationship_kind": "other", "relationship": "Vormund",
                "first_name": "Greta", "last_name": "Vormund",
                "date_of_birth": "1975-05-06",
                "email": view["representation"]["representatives"][0]["email"],
                "citizenships": ["DE"], "country": "DE"
            })),
        )
        .await;
    assert_eq!(body["payer"]["payer_kind"], "representative", "{body}");
    assert_eq!(missing(&body), vec!["payment_method".to_string()], "{body}");
    assert_eq!(body["billing"]["payment_route_by"], "guardian", "{body}");
    assert_eq!(
        body["billing"]["account_holder_suggestion"],
        "Greta Vormund"
    );
    let body = app
        .ok(
            StatusCode::OK,
            "POST",
            &format!("{base}/billing"),
            &greta,
            Some(
                json!({ "payment_method": "bank_transfer", "account_country": "DE",
                "account_holder": "Greta Vormund", "via_third_party": false }),
            ),
        )
        .await;
    assert_eq!(missing(&body), Vec::<String>::new(), "{body}");
    submit(
        &app,
        &MinorRequest {
            lead,
            mother: guardian,
            father: guardian,
            mother_login: Uuid::nil(),
            anna: greta.clone(),
        },
        &greta,
    )
    .await;
    let declaration = app
        .ok(
            StatusCode::OK,
            "GET",
            &format!("/leads/{lead}/payer-declaration"),
            &app.pm(),
            None,
        )
        .await;
    assert_eq!(
        declaration["declaration"]["payer_representative_id"],
        json!(guardian),
        "{declaration}"
    );

    enter_identity_data(&app, lead, guardian, "C03X00T49").await;
    let status = app
        .ok(
            StatusCode::OK,
            "GET",
            &format!("/leads/{lead}/identification-status"),
            &app.pm(),
            None,
        )
        .await;
    assert_eq!(
        line(&status, "representatives", guardian)["relation"],
        "guardian"
    );
    let (code, sheet) = gwg_sheet(&app, lead, &format!("representative:{guardian}")).await;
    assert_eq!(code, StatusCode::OK, "{sheet}");
    assert_eq!(sheet["signature_details"]["missing"], json!([]), "{sheet}");
    let (code, refused) = gwg_sheet(&app, lead, "contract_partner").await;
    assert_eq!(code, StatusCode::UNPROCESSABLE_ENTITY, "{refused}");
    assert_eq!(refused["code"], "minor_sheet_per_representative");

    let patient = qualify_and_convert(&app, lead).await;
    let (custody, contracting): (Option<String>, Vec<Uuid>) =
        sqlx::query_as("SELECT custody, contracting_relation_ids FROM patients WHERE id = $1")
            .bind(patient)
            .fetch_one(app.pool())
            .await
            .unwrap();
    assert_eq!(custody.as_deref(), Some("guardian"));
    let relations: Vec<(Uuid, String, bool)> = sqlx::query_as(
        "SELECT id, relation_type, is_default_payer FROM patient_relations WHERE patient_id = $1",
    )
    .bind(patient)
    .fetch_all(app.pool())
    .await
    .unwrap();
    assert_eq!(relations.len(), 1, "{relations:?}");
    assert_eq!(relations[0].1, "guardian");
    assert_eq!(contracting, vec![relations[0].0]);
    // The Vormund is the default payer and the only contracting party.
    assert!(relations[0].2, "{relations:?}");
}

/// Scenario 4: the paying father's black-list citizenship requires the
/// enhanced check (before: a paying parent, stored as representative since
/// 2026-10-19, never counted as the payer of the rule). The mother answers
/// the father's block R, the father answers the payer questions with the
/// source of funds in his own cabinet, the funds have one source, and each
/// parent's sheet carries that parent's PEP answer only.
#[tokio::test]
async fn scenario_enhanced_check_by_a_parents_citizenship() {
    let Some(app) = Scn::new().await else { return };
    let request = fill_joint_custody_request(&app, "IR").await;
    let (lead, mother, father) = (request.lead, request.mother, request.father);
    let base = request.base();
    let anna = request.anna.clone();
    let enhanced = app
        .ok(
            StatusCode::OK,
            "GET",
            &format!("/leads/{lead}/enhanced-check"),
            &app.pm(),
            None,
        )
        .await;
    assert_eq!(enhanced["required"], true, "{enhanced}");
    assert_eq!(enhanced["countries"], json!(["IR"]), "{enhanced}");
    assert!(
        enhanced["reasons"]
            .as_array()
            .unwrap()
            .contains(&json!("payer_citizenship_blacklist")),
        "{enhanced}"
    );

    // Block R of the father, before sending; the reason is never shown.
    let hers = app.cabinet(lead, &anna).await;
    assert_eq!(hers["follow_up"]["before_submit"], true, "{hers}");
    assert_eq!(hers["follow_up"]["blocks"], json!(["R"]), "{hers}");
    assert!(!hers.to_string().contains("blacklist"), "{hers}");
    assert!(hers["payer_questionnaire"].is_null(), "{hers}");
    let (code, refused) = app
        .call(
            "POST",
            &format!("{base}/submit"),
            &anna,
            Some(json!({ "declared_correct": true })),
        )
        .await;
    assert_eq!(code, StatusCode::UNPROCESSABLE_ENTITY, "{refused}");
    assert_eq!(refused["code"], "follow_up_incomplete", "{refused}");
    let answered = app
        .ok(
            StatusCode::OK,
            "POST",
            &format!("{base}/representatives/{father}/country-questions"),
            &anna,
            Some(json!({ "birth_place": "Teheran", "birth_country": "IR",
                "residence_since": "2005", "stay_reason": "family",
                "pep_self": false, "pep_related": true,
                "pep_relationship": "Onkel", "pep_office": "Minister",
                "pep_country": "IR", "pep_period": "2010-2020",
                "pep_wealth_origin": "Gehalt", "sanctions_links": false })),
        )
        .await;
    assert_eq!(
        answered["follow_up"]["missing"]["R"],
        json!([]),
        "{answered}"
    );
    submit(&app, &request, &anna).await;

    // The father pays: his own cabinet has the payer questions, with the
    // source of funds and its proof.
    let (_, ben) = app.guardian_access(lead, father).await;
    let his = app.cabinet(lead, &ben).await;
    assert_eq!(his["payer_questionnaire"]["available"], true, "{his}");
    let section = format!("{base}/payer-questionnaire");
    let questions = app.ok(StatusCode::OK, "GET", &section, &ben, None).await;
    assert_eq!(questions["funds_required"], true, "{questions}");
    assert_eq!(questions["funds_proof_required"], true, "{questions}");
    app.ok(
        StatusCode::OK,
        "POST",
        &format!("{base}/representatives/{father}"),
        &ben,
        Some(json!({ "date_of_birth": "1983-04-06" })),
    )
    .await;
    app.ok(
        StatusCode::OK,
        "POST",
        &format!("{section}/consent"),
        &ben,
        Some(json!({ "acknowledged": true, "contact_channels": ["email"] })),
    )
    .await;
    // The relationship is the father's own relation to the child: neither
    // asked nor accepted in his section (before: required and refused, so
    // the section could never be sent).
    let (code, refused) = app
        .call(
            "POST",
            &section,
            &ben,
            Some(json!({ "relationship_kind": "parent" })),
        )
        .await;
    assert_eq!(code, StatusCode::UNPROCESSABLE_ENTITY, "{refused}");
    assert_eq!(refused["field"], "relationship_kind", "{refused}");
    let answers = app
        .ok(
            StatusCode::OK,
            "POST",
            &section,
            &ben,
            Some(json!({ "salutation": "mr", "occupation": "Ingenieur",
                "funds_sources": ["employment"], "pep_self": false, "pep_related": true,
                "pep_related_details": "Onkel ist Minister",
                "sanctions_links": false })),
        )
        .await;
    assert_eq!(
        answers["answers"]["relationship_kind"], "parent",
        "{answers}"
    );
    assert_eq!(
        answers["missing_for_submit"],
        json!(["funds_proof_upload"]),
        "{answers}"
    );
    let (code, proof) = app.upload(&format!("{section}/funds-proof"), &ben).await;
    assert_eq!(code, StatusCode::CREATED, "{proof}");
    app.ok(
        StatusCode::OK,
        "POST",
        &format!("{section}/submit"),
        &ben,
        Some(json!({ "declared_correct": true })),
    )
    .await;
    let his = app.cabinet(lead, &ben).await;
    assert!(
        his["payer_questionnaire"]["submitted_at"].is_string(),
        "{his}"
    );
    // One source of the payer's funds: the father's own statement.
    let declaration = app
        .ok(
            StatusCode::OK,
            "GET",
            &format!("/leads/{lead}/payer-declaration"),
            &app.pm(),
            None,
        )
        .await;
    let funds = &declaration["funds"];
    assert_eq!(funds["relevant"], "payer", "{funds}");
    assert_eq!(funds["payer"]["entered_by"], "payer", "{funds}");
    assert_eq!(funds["payer"]["sources"], json!(["employment"]), "{funds}");
    assert_eq!(funds["patient"]["sources"], json!([]), "{funds}");
    // The paying representative stays the representative.
    assert_eq!(
        declaration["declaration"]["payer_kind"], "representative",
        "{declaration}"
    );
    // The mother never sees the father's payer answers.
    let hers = app.cabinet(lead, &anna).await;
    assert!(hers["payer_questionnaire"].is_null(), "{hers}");
    assert!(!hers.to_string().contains("Ingenieur"), "{hers}");

    // Each parent's sheet: the own PEP answer only, never the other's.
    enter_identity_data(&app, lead, mother, "C01X00T47").await;
    enter_identity_data(&app, lead, father, "C02X00T48").await;
    let mut texts = Vec::new();
    for id in [mother, father] {
        let (code, sheet) = gwg_sheet(&app, lead, &format!("representative:{id}")).await;
        assert_eq!(code, StatusCode::OK, "{sheet}");
        assert_eq!(sheet["signature_details"]["missing"], json!([]), "{sheet}");
        texts.push(document_text(&app, sheet["id"].as_str().unwrap()).await);
    }
    let pep_line = |text: &str| {
        let start = text
            .find("Angabe der Person")
            .unwrap_or_else(|| panic!("no PEP line: {text}"));
        text[start..].chars().take(120).collect::<String>()
    };
    assert!(
        pep_line(&texts[0]).starts_with("Angabe der Person keine Angabe"),
        "{}",
        pep_line(&texts[0])
    );
    assert!(!texts[0].contains("Minister"), "mother's sheet");
    assert!(
        pep_line(&texts[1]).contains("ja – Familienmitglied oder nahestehende Person einer PeP"),
        "{}",
        pep_line(&texts[1])
    );
    assert!(texts[1].contains("Minister"), "father's sheet");
}

/// Block L of a minor's enhanced check (the own economic interest of the
/// paying parent) is answered where the cabinet asks it: in the payer
/// section, as `acts_on_own_account` with the payer — never as a statement
/// (`/identification` refuses the key). Document review 2026-10-24.
#[tokio::test]
async fn scenario_block_l_of_a_paying_parent_is_answered_with_the_payer() {
    let Some(app) = Scn::new().await else { return };
    let request = fill_joint_custody_request(&app, "IR").await;
    let (lead, father) = (request.lead, request.father);
    let base = request.base();
    let anna = request.anna.clone();
    // The child is an Iranian citizen too: block L joins the follow-up.
    let mut child = child_personal_data();
    child["citizenships"] = json!(["DE", "IR"]);
    app.ok(
        StatusCode::OK,
        "POST",
        &format!("{base}/personal-data"),
        &anna,
        Some(child),
    )
    .await;
    app.ok(
        StatusCode::OK,
        "POST",
        &format!("{base}/representatives/{father}/country-questions"),
        &anna,
        Some(json!({ "birth_place": "Teheran", "birth_country": "IR",
            "residence_since": "2005", "stay_reason": "family",
            "pep_self": false, "pep_related": false, "sanctions_links": false })),
    )
    .await;
    let view = app.cabinet(lead, &anna).await;
    assert!(
        view["follow_up"]["missing"]["L"]
            .as_array()
            .is_some_and(|keys| keys.contains(&json!("payer_own_account"))),
        "{}",
        view["follow_up"]
    );
    // The statement endpoint does not take it.
    let (code, refused) = app
        .call(
            "POST",
            &format!("{base}/identification"),
            &anna,
            Some(json!({ "payer_own_account": true })),
        )
        .await;
    assert_eq!(code, StatusCode::UNPROCESSABLE_ENTITY, "{refused}");
    // The payer section does, for the paying father (named as the cabinet
    // names him: with his e-mail on file).
    let father_email = view["representation"]["representatives"]
        .as_array()
        .unwrap()
        .iter()
        .find(|person| person["id"] == json!(father))
        .and_then(|person| person["email"].as_str())
        .unwrap_or_else(|| panic!("no father e-mail: {view}"))
        .to_string();
    let body = app
        .ok(
            StatusCode::OK,
            "POST",
            &format!("{base}/payer"),
            &anna,
            Some(json!({
                "payer_kind": "third_party", "payer_type": "person",
                "relationship_kind": "parent",
                "first_name": "Ben", "last_name": "Muster",
                "date_of_birth": "1983-04-06", "email": father_email,
                "citizenships": ["IR"], "country": "DE",
                "acts_on_own_account": true
            })),
        )
        .await;
    assert_eq!(body["payer"]["payer_kind"], "representative", "{body}");
    assert_eq!(body["payer"]["acts_on_own_account"], true, "{body}");
    assert_eq!(
        body["follow_up"]["missing"]["L"],
        json!([]),
        "{}",
        body["follow_up"]
    );
}

async fn document_text(app: &Scn, document: &str) -> String {
    let request = Request::builder()
        .method("GET")
        .uri(format!("/api/v1/documents/{document}/download"))
        .header("Authorization", app.ceo())
        .body(Body::empty())
        .unwrap();
    let response = app.suite.app.clone().oneshot(request).await.unwrap();
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

/// Scenario 5: the converted child turns 18: the job closes both parents'
/// access and logins (they reach nothing else), staff are told once, and
/// the patient gets an own login.
#[tokio::test]
async fn scenario_the_child_comes_of_age() {
    let Some(app) = Scn::new().await else { return };
    let request = fill_joint_custody_request(&app, "DE").await;
    let (lead, mother, father) = (request.lead, request.mother, request.father);
    let (father_login, ben) = app.guardian_access(lead, father).await;
    submit(&app, &request, &request.anna).await;
    staff_set_contact(&app, lead, father, json!({ "birth_date": "1983-04-06" })).await;
    enter_identity_data(&app, lead, mother, "C01X00T47").await;
    enter_identity_data(&app, lead, father, "C02X00T48").await;
    let patient = qualify_and_convert(&app, lead).await;
    let pool = app.pool();
    for login in [&request.anna, &ben] {
        let (code, me) = app.call("GET", "/me/export", login, None).await;
        assert_eq!(code, StatusCode::OK, "{me}");
        assert_eq!(me["patient"]["id"], json!(patient));
    }
    let today = gmed_server::app_time::today();
    let birth = today
        .checked_sub_months(chrono::Months::new(18 * 12))
        .unwrap();
    // The day before the birthday nothing happens.
    sqlx::query("UPDATE patients SET birth_date = $2 WHERE id = $1")
        .bind(patient)
        .bind(birth)
        .execute(pool)
        .await
        .unwrap();
    let eve = today.pred_opt().unwrap();
    let report = gmed_server::services::coming_of_age::run_on(&app.suite.state, eve)
        .await
        .unwrap();
    assert_eq!(report.patients, 0, "{report:?}");
    let report = gmed_server::services::coming_of_age::run_on(&app.suite.state, today)
        .await
        .unwrap();
    assert_eq!(report.patients, 1, "{report:?}");
    assert_eq!(report.assignments_revoked, 2, "{report:?}");
    assert_eq!(report.lead_accesses_revoked, 2, "{report:?}");
    assert_eq!(report.logins_deactivated, 2, "{report:?}");
    assert_eq!(report.notifications, 1, "{report:?}");
    // Both parents' logins reached only this child: switched off, the
    // cabinet answers 401 to their sessions.
    for login in [&request.anna, &ben] {
        let (code, _) = app.call("GET", "/me/lead-requests", login, None).await;
        assert_eq!(code, StatusCode::UNAUTHORIZED);
    }
    let active: Vec<bool> =
        sqlx::query_scalar("SELECT is_active FROM users WHERE id = ANY($1) ORDER BY id")
            .bind(vec![request.mother_login, father_login])
            .fetch_all(pool)
            .await
            .unwrap();
    assert_eq!(active, vec![false, false]);
    let again = gmed_server::services::coming_of_age::run_on(&app.suite.state, today)
        .await
        .unwrap();
    assert_eq!(
        again,
        gmed_server::services::coming_of_age::ComingOfAgeReport::default()
    );
    // The patient's own login.
    let issued = app
        .ok(
            StatusCode::CREATED,
            "POST",
            &format!("/patients/{patient}/portal-account"),
            &app.ceo(),
            None,
        )
        .await;
    assert_eq!(issued["created"], true, "{issued}");
    let own: Uuid = issued["user_id"].as_str().unwrap().parse().unwrap();
    let (code, me) = app
        .call("GET", "/me/export", &bearer(own, "patient"), None)
        .await;
    assert_eq!(code, StatusCode::OK, "{me}");
    assert_eq!(me["patient"]["id"], json!(patient));
}

/// Scenario 6: an adult under a legal guardianship (Betreuer): the adult
/// names the Betreuer in the own cabinet; the Betreuer is identified with an
/// own line and sheet; no parents' access exists for an adult.
#[tokio::test]
async fn scenario_adult_with_a_legal_guardian() {
    let Some(app) = Scn::new().await else { return };
    let created = app
        .ok(
            StatusCode::CREATED,
            "POST",
            "/leads",
            &app.pm(),
            Some(json!({ "first_name": "Karl", "last_name": "Muster",
                "date_of_birth": "1950-01-02", "email": unique("karl") })),
        )
        .await;
    let lead: Uuid = created["id"].as_str().unwrap().parse().unwrap();
    let karl_user: Uuid = created["portal_account"]["user_id"]
        .as_str()
        .unwrap()
        .parse()
        .unwrap();
    let karl = bearer(karl_user, "patient");
    let base = format!("/me/lead-requests/{lead}");
    app.consent(lead, &karl, "health_data_processing").await;
    app.consent(lead, &karl, "lead_inquiry_processing").await;
    let betreuer = Uuid::new_v4();
    let mut adult = child_personal_data();
    adult["date_of_birth"] = json!("1950-01-02");
    adult["legal_sex"] = json!("male");
    let steps = [
        ("personal-data".to_string(), adult),
        (
            "payer".to_string(),
            json!({ "payer_kind": "self", "acts_on_own_account": true }),
        ),
        (
            "billing".to_string(),
            json!({ "invoice_recipient": "self", "payment_method": "bank_transfer",
                    "account_country": "DE", "account_holder": "Karl Muster",
                    "bank_name": "Musterbank", "via_third_party": false }),
        ),
        (
            "identification".to_string(),
            json!({ "birth_place": "Berlin", "birth_country": "DE",
                    "pep_self": false, "pep_related": false, "sanctions_links": false,
                    "request_reason": "Zweitmeinung" }),
        ),
    ];
    for (part, body) in steps {
        app.ok(
            StatusCode::OK,
            "POST",
            &format!("{base}/{part}"),
            &karl,
            Some(body),
        )
        .await;
    }
    let body = app
        .ok(
            StatusCode::OK,
            "POST",
            &format!("{base}/representation"),
            &karl,
            Some(json!({ "has_representative": true, "under_guardianship": true })),
        )
        .await;
    for key in [
        "guardian_first_name",
        "guardian_date_of_birth",
        "guardian_id_upload",
        "guardian_authority_upload",
    ] {
        assert!(missing(&body).contains(&key.to_string()), "{key}: {body}");
    }
    let (code, body) = app
        .call(
            "POST",
            &format!("{base}/representatives/{betreuer}"),
            &karl,
            Some(
                json!({ "role": "legal_guardian", "first_name": "Bernd", "last_name": "Betreuer",
                    "date_of_birth": "1970-07-08", "street": "Betreuerweg 4", "zip": "10115",
                    "city": "Berlin", "country": "DE", "email": unique("bernd.betreuer") }),
            ),
        )
        .await;
    assert_eq!(code, StatusCode::CREATED, "{body}");
    for path in [
        format!("{base}/identity-document"),
        format!("{base}/representatives/{betreuer}/identity-document"),
        format!("{base}/representatives/{betreuer}/authority-document"),
    ] {
        let (code, body) = app.upload(&path, &karl).await;
        assert_eq!(code, StatusCode::CREATED, "{path}: {body}");
    }
    let view = app.cabinet(lead, &karl).await;
    assert_eq!(missing(&view), Vec::<String>::new(), "{view}");
    assert_eq!(view["minor"], false);
    let row = view["representation"]["representatives"]
        .as_array()
        .unwrap()
        .iter()
        .find(|person| person["id"] == json!(betreuer))
        .cloned()
        .unwrap_or_else(|| panic!("{view}"));
    assert_eq!(row["role"], "legal_guardian", "{row}");
    assert_eq!(row["slot"], "guardian", "{row}");
    submit(
        &app,
        &MinorRequest {
            lead,
            mother: betreuer,
            father: betreuer,
            mother_login: karl_user,
            anna: karl.clone(),
        },
        &karl,
    )
    .await;

    // An adult has no parents' access: the Betreuer gets none.
    let (code, refused) = app
        .call(
            "POST",
            &format!("/leads/{lead}/portal-guardians"),
            &app.pm(),
            Some(json!({ "trusted_contact_id": betreuer })),
        )
        .await;
    assert_eq!(code, StatusCode::UNPROCESSABLE_ENTITY, "{refused}");
    assert_eq!(refused["code"], "guardian_access_minors_only");

    // Staff identify the Betreuer: an own line and an own sheet.
    let stored = app
        .ok(
            StatusCode::OK,
            "PUT",
            &format!("/leads/{lead}/representatives/{betreuer}/identity-document-data"),
            &app.pm(),
            Some(
                json!({ "id_document_type": "id_card", "id_document_number": "L01X00T47",
                "id_issuing_authority": "Stadt Berlin", "id_issuing_country": "Deutschland",
                "id_issued_on": "2020-01-02", "id_valid_until": "2030-01-01" }),
            ),
        )
        .await;
    assert_eq!(stored["id_issuing_country"], "DE");
    let status = app
        .ok(
            StatusCode::OK,
            "GET",
            &format!("/leads/{lead}/identification-status"),
            &app.pm(),
            None,
        )
        .await;
    assert_eq!(status["minor"], false);
    assert_eq!(status["representatives"], json!([]));
    let acting = line(&status, "acting_persons", betreuer);
    assert_eq!(acting["slot"], "guardian", "{status}");
    assert_eq!(acting["role"], "legal_guardian", "{status}");
    let (code, sheet) = gwg_sheet(&app, lead, &format!("representative:{betreuer}")).await;
    assert_eq!(code, StatusCode::OK, "{sheet}");
    assert_eq!(sheet["signature_details"]["missing"], json!([]), "{sheet}");
    app.ok(
        StatusCode::OK,
        "POST",
        &format!("/documents/{}/mark-signed", sheet["id"].as_str().unwrap()),
        &app.pm(),
        Some(json!({ "compliance_kind": "other" })),
    )
    .await;
    // Karl's own sheet waits for his document data.
    let (code, own) = gwg_sheet(&app, lead, "contract_partner").await;
    assert_eq!(code, StatusCode::OK, "{own}");
    assert!(
        own["signature_details"]["missing"]
            .as_array()
            .unwrap()
            .contains(&json!("patient_id_document_number")),
        "{own}"
    );
}

/// Scenario 7: a repeat request of an existing patient: the country written
/// out on the patient becomes the ISO code of the lead, and the patient form
/// is no conversion blocker of a repeat order. Then a converted minor's
/// repeat request: the parents and the custody come from the record.
#[tokio::test]
async fn scenario_repeat_request_of_an_existing_patient() {
    let Some(app) = Scn::new().await else { return };
    let pool = app.pool();
    let patient: Uuid = sqlx::query_scalar(
        r#"INSERT INTO patients (patient_id, first_name, last_name, birth_date, gender, email,
                                 phone_primary, address_street, address_zip, address_city,
                                 address_country, lifecycle_status, created_by, languages)
           VALUES ($1, 'Olena', 'Muster', DATE '1980-05-06', 'female', $2, '+380 44 0000000',
                   'Khreshchatyk 1', '01001', 'Kyiv', 'Ukraine', 'active', $3, ARRAY['uk'])
           RETURNING id"#,
    )
    .bind(format!("P-SCN-{}", Uuid::new_v4()))
    .bind(unique("olena"))
    .bind(app.ceo_id)
    .fetch_one(pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO patient_assignments (patient_id, user_id, assigned_by) VALUES ($1, $2, $3)",
    )
    .bind(patient)
    .bind(app.pm_id)
    .bind(app.ceo_id)
    .execute(pool)
    .await
    .unwrap();
    let created = app
        .ok(
            StatusCode::CREATED,
            "POST",
            "/leads",
            &app.pm(),
            Some(json!({ "first_name": "Olena", "last_name": "Muster",
                "repeat_patient_id": patient, "creation_key": Uuid::new_v4() })),
        )
        .await;
    let lead: Uuid = created["id"].as_str().unwrap().parse().unwrap();
    let staff = app.staff_lead(lead).await;
    assert_eq!(staff["country"], "UA", "{staff}");
    assert_eq!(staff["city"], "Kyiv", "{staff}");
    let reasons = staff["readiness"]["blocking_reasons"].to_string();
    assert!(!reasons.contains("Patient form is not signed"), "{reasons}");

    // A converted minor's repeat request starts with the parents on record.
    let request = fill_joint_custody_request(&app, "DE").await;
    let (first, mother, father) = (request.lead, request.mother, request.father);
    submit(&app, &request, &request.anna).await;
    staff_set_contact(&app, first, father, json!({ "birth_date": "1983-04-06" })).await;
    enter_identity_data(&app, first, mother, "C01X00T47").await;
    enter_identity_data(&app, first, father, "C02X00T48").await;
    let child = qualify_and_convert(&app, first).await;
    let created = app
        .ok(
            StatusCode::CREATED,
            "POST",
            "/leads",
            &app.pm(),
            Some(json!({ "first_name": "Mia", "last_name": "Muster",
                "repeat_patient_id": child, "creation_key": Uuid::new_v4() })),
        )
        .await;
    let repeat: Uuid = created["id"].as_str().unwrap().parse().unwrap();
    let staff = app.staff_lead(repeat).await;
    let contacts = staff["trusted_contacts"].as_array().cloned().unwrap();
    assert_eq!(contacts.len(), 2, "{contacts:?}");
    let reasons = staff["readiness"]["blocking_reasons"].to_string();
    assert!(!reasons.contains("Patient form is not signed"), "{reasons}");
    // The mother's login does not reach the new request by itself; staff
    // issue her access and the same login is reused.
    let (code, list) = app
        .call("GET", "/me/lead-requests", &request.anna, None)
        .await;
    assert_eq!(code, StatusCode::OK, "{list}");
    assert_eq!(list["requests"], json!([]), "{list}");
    let mother_contact: Uuid = contacts
        .iter()
        .find(|contact| contact["relation"] == "mother")
        .and_then(|contact| contact["id"].as_str())
        .unwrap()
        .parse()
        .unwrap();
    let issued = app
        .ok(
            StatusCode::CREATED,
            "POST",
            &format!("/leads/{repeat}/portal-guardians"),
            &app.pm(),
            Some(json!({ "trusted_contact_id": mother_contact })),
        )
        .await;
    assert_eq!(issued["reused"], true, "{issued}");
    assert_eq!(issued["user_id"], json!(request.mother_login), "{issued}");
    let view = app.cabinet(repeat, &request.anna).await;
    // The custody comes from the record and is staff's; the child's
    // citizenships come back from the record (before: asked again). The
    // parents' citizenships have no place on the patient relations and are
    // asked again.
    assert_eq!(view["representation"]["custody"], "joint", "{view}");
    assert_eq!(
        view["representation"]["custody_set_by_staff"], true,
        "{view}"
    );
    assert_eq!(
        view["personal_data"]["citizenships"],
        json!(["DE"]),
        "{view}"
    );
    assert!(
        !missing(&view).contains(&"citizenships".to_string()),
        "{view}"
    );
}
