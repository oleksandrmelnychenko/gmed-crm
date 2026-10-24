//! More end-to-end scenarios of the lead wizard, the parents' / guardians'
//! cabinet and the payer's own link against the real server and a
//! disposable database (see `lead_scenarios_api.rs` for the first set):
//! staff and a parent editing the same request, the payer link of a person
//! and of a company end to end, the lifecycle edges of a request (purge,
//! archive and reopen) and a switch from joint to sole custody. Every step
//! goes through the HTTP API the way the cabinet, the payer page and the
//! staff wizard call it; a local stand-in for the Mittaro API records the
//! e-mails. Synthetic data only.

mod support;

use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};

use axum::Router;
use axum::body::Body;
use axum::extract::{ConnectInfo, State};
use axum::http::{HeaderMap, Request, StatusCode};
use axum::response::IntoResponse;
use axum::routing::post;
use secrecy::SecretString;
use serde_json::{Value, json};
use sqlx::PgPool;
use tower::ServiceExt;
use uuid::Uuid;

use gmed_server::auth::jwt;
use gmed_server::config::MailConfig;

const SECRET: &str = "test-secret-at-least-32-characters-long!!";
const INQUIRY_CONSENT_VERSION: &str = "2026-10-03";
const HEALTH_CONSENT_VERSION: &str = "2026-10-13";
const PDF: &[u8] = b"%PDF-1.4\n% synthetic scenario document\n%%EOF\n";
const LINK: &str = "/public/payer-link";

static NEXT_PEER: AtomicU32 = AtomicU32::new(1);

/// A peer address of its own for every request: the tight limiter of the
/// payer link never interferes.
fn peer() -> ConnectInfo<SocketAddr> {
    let n = NEXT_PEER.fetch_add(1, Ordering::Relaxed);
    ConnectInfo(SocketAddr::from(([10, 77, (n >> 8) as u8, n as u8], 40000)))
}

fn bearer(user_id: Uuid, role: &str) -> String {
    let token = jwt::issue_access_token(SECRET, user_id, role, Uuid::new_v4()).unwrap();
    format!("Bearer {token}")
}

fn unique(name: &str) -> String {
    format!("{name}.{}@example.com", Uuid::new_v4().simple())
}

/// What the stand-in Mittaro API received.
#[derive(Clone, Default)]
struct FakeMittaro {
    received: Arc<Mutex<Vec<Value>>>,
    accepted: Arc<Mutex<HashMap<String, String>>>,
}

async fn fake_send(
    State(fake): State<FakeMittaro>,
    headers: HeaderMap,
    body: axum::body::Bytes,
) -> axum::response::Response {
    let key = headers
        .get("idempotency-key")
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default()
        .to_string();
    fake.received
        .lock()
        .unwrap()
        .push(serde_json::from_slice(&body).unwrap());
    let mut accepted = fake.accepted.lock().unwrap();
    let id = format!("email_{}", accepted.len() + 1);
    accepted.insert(key, id.clone());
    (
        StatusCode::ACCEPTED,
        axum::Json(json!({ "id": id, "status": "queued" })),
    )
        .into_response()
}

async fn seed_user(pool: &PgPool, role: &str) -> Uuid {
    sqlx::query_scalar(
        "INSERT INTO users (email, password_hash, name, role) VALUES ($1, 'test-password-hash', $2, $3) RETURNING id",
    )
    .bind(unique(&format!("scenario-more-{role}")))
    .bind(format!("Scenario {role}"))
    .bind(role)
    .fetch_one(pool)
    .await
    .unwrap()
}

struct Scn {
    suite: support::TestSuiteContext,
    app: Router,
    fake: FakeMittaro,
    pm_id: Uuid,
    ceo_id: Uuid,
}

impl Scn {
    async fn new() -> Option<Self> {
        let suite = support::suite_context(SECRET).await?;
        let pm_id = seed_user(&suite.pool, "patient_manager").await;
        let ceo_id = seed_user(&suite.pool, "ceo").await;
        let fake = FakeMittaro::default();
        let router = Router::new()
            .route("/v1/emails", post(fake_send))
            .with_state(fake.clone());
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        tokio::spawn(async move {
            axum::serve(listener, router).await.unwrap();
        });
        let state = suite.state.clone().with_mailer(MailConfig {
            mittaro_api_key: Some(SecretString::from("tx_live_test")),
            mittaro_api_url: Some(format!("http://{address}/v1/emails")),
            from: Some("zugang@gmed-health.test".into()),
            reply_to: None,
            console_url: Some("https://console.gmed-health.test".into()),
        });
        let app = gmed_server::build_app_for_role_contract_tests(state);
        Some(Self {
            suite,
            app,
            fake,
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

    async fn send(&self, request: Request<Body>) -> (StatusCode, Value) {
        let mut request = request;
        request.extensions_mut().insert(peer());
        let response = self.app.clone().oneshot(request).await.unwrap();
        let status = response.status();
        let bytes = axum::body::to_bytes(response.into_body(), 8 * 1024 * 1024)
            .await
            .unwrap();
        (
            status,
            serde_json::from_slice(&bytes).unwrap_or(Value::Null),
        )
    }

    /// A call with a bearer, or with the payer's headers when `auth` is empty.
    async fn call_with(
        &self,
        method: &str,
        path: &str,
        headers: &[(&str, &str)],
        body: Option<Value>,
    ) -> (StatusCode, Value) {
        let mut request = Request::builder()
            .method(method)
            .uri(format!("/api/v1{path}"))
            .header("Content-Type", "application/json");
        for (name, value) in headers {
            request = request.header(*name, *value);
        }
        let request = request
            .body(match body {
                Some(value) => Body::from(serde_json::to_vec(&value).unwrap()),
                None => Body::empty(),
            })
            .unwrap();
        self.send(request).await
    }

    async fn call(
        &self,
        method: &str,
        path: &str,
        auth: &str,
        body: Option<Value>,
    ) -> (StatusCode, Value) {
        self.call_with(method, path, &[("Authorization", auth)], body)
            .await
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

    async fn upload_with(&self, path: &str, headers: &[(&str, &str)]) -> (StatusCode, Value) {
        let boundary = format!("----gmed-scenario-{}", Uuid::new_v4().simple());
        let mut body = Vec::new();
        body.extend_from_slice(format!("--{boundary}\r\n").as_bytes());
        body.extend_from_slice(
            b"Content-Disposition: form-data; name=\"file\"; filename=\"ausweis.pdf\"\r\nContent-Type: application/pdf\r\n\r\n",
        );
        body.extend_from_slice(PDF);
        body.extend_from_slice(format!("\r\n--{boundary}--\r\n").as_bytes());
        let mut request = Request::builder()
            .method("POST")
            .uri(format!("/api/v1{path}"))
            .header(
                "Content-Type",
                format!("multipart/form-data; boundary={boundary}"),
            );
        for (name, value) in headers {
            request = request.header(*name, *value);
        }
        self.send(request.body(Body::from(body)).unwrap()).await
    }

    async fn upload(&self, path: &str, auth: &str) -> (StatusCode, Value) {
        self.upload_with(path, &[("Authorization", auth)]).await
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

    async fn declaration(&self, lead: Uuid) -> Value {
        self.ok(
            StatusCode::OK,
            "GET",
            &format!("/leads/{lead}/payer-declaration"),
            &self.pm(),
            None,
        )
        .await
    }

    /// The e-mail texts the stand-in received, oldest first.
    fn texts(&self) -> Vec<String> {
        self.fake
            .received
            .lock()
            .unwrap()
            .iter()
            .map(|message| message["text"].as_str().unwrap_or_default().to_string())
            .collect()
    }

    fn last_token(&self) -> String {
        let text = self
            .texts()
            .into_iter()
            .rev()
            .find(|text| text.contains("/payer#"))
            .expect("an invitation");
        let start = text.find("/payer#").unwrap() + "/payer#".len();
        text[start..start + 64].to_string()
    }

    fn last_code(&self) -> String {
        self.texts()
            .into_iter()
            .rev()
            .find_map(|text| {
                text.lines().find_map(|line| {
                    let (_, code) = line.rsplit_once(": ")?;
                    (code.len() == 6 && code.bytes().all(|byte| byte.is_ascii_digit()))
                        .then(|| code.to_string())
                })
            })
            .expect("a code e-mail")
    }

    /// Staff send the payer's link; returns the token.
    async fn send_link(&self, lead: Uuid, body: Value) -> (String, Value) {
        let sent = self
            .ok(
                StatusCode::OK,
                "POST",
                &format!("/leads/{lead}/payer-link"),
                &self.pm(),
                Some(body),
            )
            .await;
        (self.last_token(), sent)
    }

    /// The payer asks for a code and verifies it; returns the session.
    async fn payer_session(&self, token: &str) -> String {
        let (status, body) = self
            .call_with(
                "POST",
                &format!("{LINK}/code"),
                &[("X-Payer-Link", token)],
                None,
            )
            .await;
        assert_eq!(status, StatusCode::ACCEPTED, "{body}");
        let code = self.last_code();
        let (status, verified) = self
            .call_with(
                "POST",
                &format!("{LINK}/verify"),
                &[("X-Payer-Link", token)],
                Some(json!({ "code": code })),
            )
            .await;
        assert_eq!(status, StatusCode::OK, "{verified}");
        let session = verified["session"].as_str().unwrap().to_string();
        let (status, body) = self
            .call_with(
                "POST",
                &format!("{LINK}/consent"),
                &[("X-Payer-Link", token), ("X-Payer-Session", &session)],
                Some(json!({ "acknowledged": true, "contact_channels": ["email"] })),
            )
            .await;
        assert_eq!(status, StatusCode::OK, "{body}");
        session
    }

    async fn payer(
        &self,
        method: &str,
        part: &str,
        token: &str,
        session: &str,
        body: Option<Value>,
    ) -> (StatusCode, Value) {
        self.call_with(
            method,
            &format!("{LINK}{part}"),
            &[("X-Payer-Link", token), ("X-Payer-Session", session)],
            body,
        )
        .await
    }

    async fn audit(&self, action: &str, lead: Uuid) -> Vec<(Option<Uuid>, Value)> {
        sqlx::query_as(
            r#"SELECT user_id, context FROM audit_log
               WHERE action = $1 AND (entity_id = $2 OR context->>'lead_id' = $2::text)
               ORDER BY created_at"#,
        )
        .bind(action)
        .bind(lead)
        .fetch_all(self.pool())
        .await
        .unwrap()
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

fn contact(lead: &Value, id: Uuid) -> &Value {
    lead["trusted_contacts"]
        .as_array()
        .unwrap_or_else(|| panic!("no contacts: {lead}"))
        .iter()
        .find(|entry| entry["id"] == json!(id))
        .unwrap_or_else(|| panic!("no contact {id}: {lead}"))
}

fn representative(view: &Value, id: Uuid) -> &Value {
    view["representation"]["representatives"]
        .as_array()
        .unwrap_or_else(|| panic!("no representation: {view}"))
        .iter()
        .find(|person| person["id"] == json!(id))
        .unwrap_or_else(|| panic!("no representative {id}: {view}"))
}

/// The onboarding artifacts staff produce outside the cabinet, as
/// `lead_scenarios_api.rs` seeds them. Returns the order.
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
    sqlx::query(
        r#"UPDATE cases SET hauptanfragegrund = 'Chronic knee pain', zuweiser = 'Self referral',
                            intake_completed_at = now(), intake_completed_by = $2
           WHERE lead_id = $1 OR source_lead_id = $1"#,
    )
    .bind(lead)
    .bind(pm)
    .execute(pool)
    .await
    .unwrap();
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
    .bind(format!("FC-SCM-{tag}"))
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
    .bind(format!("A-SCM-{tag}"))
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
    .bind(format!("KV-SCM-{tag}"))
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
    father_email: String,
}

impl MinorRequest {
    fn base(&self) -> String {
        format!("/me/lead-requests/{}", self.lead)
    }
}

async fn fill_joint_custody_request(app: &Scn) -> MinorRequest {
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
        father_email: father_email.clone(),
    };
    let base = request.base();
    let anna = &request.anna;
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
    app.ok(
        StatusCode::OK,
        "POST",
        &format!("{base}/representatives/{mother}"),
        anna,
        Some(parent_details("Mutterweg 1", "1985-03-02", "DE")),
    )
    .await;
    let mut father_details = parent_details("Vaterweg 2", "1983-04-06", "DE");
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
    app.ok(
        StatusCode::OK,
        "POST",
        &format!("{base}/billing"),
        anna,
        Some(json!({ "invoice_recipient": "self" })),
    )
    .await;
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
                "citizenships": ["DE"], "country": "DE"
            })),
        )
        .await;
    assert_eq!(body["payer"]["payer_kind"], "representative", "{body}");
    app.ok(
        StatusCode::OK,
        "POST",
        &format!("{base}/billing"),
        anna,
        Some(json!({ "invoice_recipient_is_payer": false })),
    )
    .await;
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
    assert_eq!(missing(&body), Vec::<String>::new(), "{body}");
    request
}

async fn submit(app: &Scn, lead: Uuid, auth: &str) -> Value {
    app.ok(
        StatusCode::OK,
        "POST",
        &format!("/me/lead-requests/{lead}/submit"),
        auth,
        Some(json!({ "declared_correct": true })),
    )
    .await
}

async fn enter_identity_data(app: &Scn, lead: Uuid, representative: Uuid, number: &str) {
    app.ok(
        StatusCode::OK,
        "PUT",
        &format!("/leads/{lead}/representatives/{representative}/identity-document-data"),
        &app.pm(),
        Some(json!({
            "id_document_type": "passport", "id_document_number": number,
            "id_issuing_authority": "Stadt Berlin", "id_issuing_country": "DE",
            "id_issued_on": "2020-01-02", "id_valid_until": "2030-01-01"
        })),
    )
    .await;
}

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

async fn qualify_and_convert(app: &Scn, lead: Uuid) -> Uuid {
    app.ok(
        StatusCode::OK,
        "POST",
        &format!("/leads/{lead}/prospect"),
        &app.pm(),
        Some(json!({ "hauptanfragegrund": "Chronic knee pain", "zuweiser": "Self referral" })),
    )
    .await;
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
    converted["patient_id"].as_str().unwrap().parse().unwrap()
}

/// Staff wizard save of the whole contact list as `snapshot` held it, with
/// `patch` applied to one contact (the wizard sends every contact it loaded).
async fn wizard_save_contacts(
    app: &Scn,
    lead: Uuid,
    snapshot: &Value,
    changed: Option<(Uuid, Value)>,
    drop: Option<Uuid>,
    with_base: bool,
) -> (StatusCode, Value) {
    let loaded = snapshot["trusted_contacts"].as_array().unwrap().clone();
    let mut contacts = loaded.clone();
    if let Some((id, patch)) = changed {
        let entry = contacts
            .iter_mut()
            .find(|entry| entry["id"] == json!(id))
            .unwrap();
        for (key, value) in patch.as_object().unwrap() {
            entry[key] = value.clone();
        }
    }
    if let Some(id) = drop {
        contacts.retain(|entry| entry["id"] != json!(id));
    }
    // A newer wizard sends the list it loaded with the save; an older one
    // does not.
    let body = if with_base {
        json!({ "trusted_contacts": contacts, "trusted_contacts_base": loaded })
    } else {
        json!({ "trusted_contacts": contacts })
    };
    app.call(
        "POST",
        &format!("/leads/{lead}/update"),
        &app.pm(),
        Some(body),
    )
    .await
}

// ---------------------------------------------------------------------------
// Scenario 1: staff and a parent edit the same request at the same time.
// ---------------------------------------------------------------------------

#[tokio::test]
async fn scenario_staff_and_parent_edit_the_same_request_at_once() {
    let Some(app) = Scn::new().await else { return };
    let request = fill_joint_custody_request(&app).await;
    let (lead, mother, father) = (request.lead, request.mother, request.father);
    let base = request.base();
    let anna = request.anna.clone();
    submit(&app, lead, &anna).await;

    // The wizard loaded the lead; meanwhile the mother corrects her phone in
    // the cabinet. Staff then save the father's date of birth with the list
    // they loaded: the mother's new phone stays (no lost update).
    let loaded = app.staff_lead(lead).await;
    app.ok(
        StatusCode::OK,
        "POST",
        &format!("{base}/representatives/{mother}"),
        &anna,
        Some(json!({ "phone": "+49 30 111111" })),
    )
    .await;
    let (code, saved) = wizard_save_contacts(
        &app,
        lead,
        &loaded,
        Some((father, json!({ "birth_date": "1983-04-06" }))),
        None,
        true,
    )
    .await;
    assert_eq!(code, StatusCode::OK, "{saved}");
    let staff = app.staff_lead(lead).await;
    assert_eq!(contact(&staff, father)["birth_date"], "1983-04-06");
    assert_eq!(
        contact(&staff, mother)["phone"],
        "+49 30 111111",
        "the cabinet's change survives the wizard's older list: {staff}"
    );
    let view = app.cabinet(lead, &anna).await;
    assert_eq!(representative(&view, mother)["phone"], "+49 30 111111");
    // The mother's change marks the request changed; the staff save does
    // not add to it.
    assert_eq!(view["changed_since_submit"], true, "{view}");
    submit(&app, lead, &anna).await;
    let (code, saved) = wizard_save_contacts(
        &app,
        lead,
        &app.staff_lead(lead).await,
        Some((father, json!({ "phone": "+49 30 222222" }))),
        None,
        true,
    )
    .await;
    assert_eq!(code, StatusCode::OK, "{saved}");
    assert_eq!(
        app.cabinet(lead, &anna).await["changed_since_submit"],
        false,
        "a staff change is no change of the parents"
    );

    // Staff confirm the custody while the mother changes it in the cabinet
    // at the same moment: whichever comes first, the staff's value stands
    // and it is staff's (read-only in the cabinet).
    let pm = app.pm();
    let (staff_path, cabinet_path) = (
        format!("/leads/{lead}/representation"),
        format!("{base}/representation"),
    );
    let (staff_side, cabinet_side) = tokio::join!(
        app.call(
            "POST",
            &staff_path,
            &pm,
            Some(json!({ "custody": "joint" })),
        ),
        app.call(
            "POST",
            &cabinet_path,
            &anna,
            Some(json!({ "custody": "sole_parent" })),
        ),
    );
    assert_eq!(staff_side.0, StatusCode::OK, "{}", staff_side.1);
    assert!(
        cabinet_side.0 == StatusCode::OK
            || (cabinet_side.0 == StatusCode::CONFLICT
                && cabinet_side.1["code"] == "custody_set_by_staff"),
        "{cabinet_side:?}"
    );
    let view = app.cabinet(lead, &anna).await;
    assert_eq!(view["representation"]["custody"], "joint", "{view}");
    assert_eq!(view["representation"]["custody_set_by_staff"], true);
    // Both parents keep their places under joint custody.
    assert_eq!(representative(&view, father)["slot"], "rep2", "{view}");

    // Staff record the invoice VAT id while the mother changes the bank in
    // the cabinet: both answers stay.
    let (staff_path, cabinet_path) = (
        format!("/leads/{lead}/payer-declaration"),
        format!("{base}/billing"),
    );
    let (staff_side, cabinet_side) = tokio::join!(
        app.call(
            "POST",
            &staff_path,
            &pm,
            Some(json!({
                "payer_kind": "representative", "payer_representative_id": father,
                "invoice_vat_id": "DE123456789"
            })),
        ),
        app.call(
            "POST",
            &cabinet_path,
            &anna,
            Some(json!({ "bank_name": "Neue Bank" })),
        ),
    );
    assert_eq!(staff_side.0, StatusCode::OK, "{}", staff_side.1);
    assert_eq!(cabinet_side.0, StatusCode::OK, "{}", cabinet_side.1);
    let declaration = app.declaration(lead).await;
    assert_eq!(
        declaration["declaration"]["bank_name"], "Neue Bank",
        "{declaration}"
    );
    assert_eq!(
        declaration["declaration"]["invoice_vat_id"], "DE123456789",
        "{declaration}"
    );
    assert_eq!(
        declaration["declaration"]["payer_representative_id"],
        json!(father)
    );
    assert_eq!(
        declaration["declaration"]["payment_method"],
        "bank_transfer"
    );

    // The audit names the actor of each side.
    let custody = app.audit("set_lead_custody", lead).await;
    assert!(
        custody.iter().all(|(user, _)| *user == Some(app.pm_id)),
        "{custody:?}"
    );
    let cabinet_rows = app.audit("lead_portal_update_representative", lead).await;
    assert!(!cabinet_rows.is_empty());
    assert!(
        cabinet_rows
            .iter()
            .all(|(user, _)| *user == Some(request.mother_login)),
        "{cabinet_rows:?}"
    );
    let billing_rows = app.audit("lead_portal_update_billing", lead).await;
    assert!(
        billing_rows
            .iter()
            .all(|(user, _)| *user == Some(request.mother_login)),
        "{billing_rows:?}"
    );
    let staff_rows = app.audit("update_lead", lead).await;
    assert!(
        staff_rows.iter().all(|(user, _)| *user == Some(app.pm_id)),
        "{staff_rows:?}"
    );

    // Identity document data staff entered are never overwritten by the
    // cabinet.
    enter_identity_data(&app, lead, mother, "C01X00T47").await;
    let (_, _answer) = app
        .call(
            "POST",
            &format!("{base}/representatives/{mother}"),
            &anna,
            Some(json!({ "id_document_number": "ZZ9999999", "phone": "+49 30 333333" })),
        )
        .await;
    let stored: Option<String> = sqlx::query_scalar(
        "SELECT id_document_number FROM lead_representatives WHERE lead_id = $1 AND contact_id = $2",
    )
    .bind(lead)
    .bind(mother)
    .fetch_one(app.pool())
    .await
    .unwrap();
    assert_eq!(stored.as_deref(), Some("C01X00T47"));
    let view = app.cabinet(lead, &anna).await;
    assert_ne!(
        representative(&view, mother)["id_document_number"],
        "ZZ9999999",
        "{view}"
    );
}

// ---------------------------------------------------------------------------
// Scenario 1b: a wizard list loaded before the father got his own access
// leaves him out; his access must not outlive the contact.
// ---------------------------------------------------------------------------

#[tokio::test]
async fn scenario_an_older_wizard_list_does_not_orphan_a_parents_access() {
    let Some(app) = Scn::new().await else { return };
    let (mother, father) = (Uuid::new_v4(), Uuid::new_v4());
    let lead = app
        .minor_lead(
            "Lea",
            json!([{ "id": mother, "name": "Anna Muster", "relation": "mother",
                     "email": unique("anna"), "phone": "+49 30 000001" }]),
        )
        .await;
    // The wizard of a second tab loads the request with the mother only.
    let older = app.staff_lead(lead).await;
    let fresh = app.staff_lead(lead).await;
    let mut contacts = fresh["trusted_contacts"].as_array().unwrap().clone();
    contacts.push(
        json!({ "id": father, "name": "Ben Muster", "relation": "father",
                          "email": unique("ben"), "phone": "+49 30 000002" }),
    );
    app.ok(
        StatusCode::OK,
        "POST",
        &format!("/leads/{lead}/update"),
        &app.pm(),
        Some(json!({ "trusted_contacts": contacts })),
    )
    .await;
    let (_, ben) = app.guardian_access(lead, father).await;
    assert_eq!(app.cabinet(lead, &ben).await["minor"], true);
    // The older tab saves the mother's phone with its list.
    let (code, saved) = wizard_save_contacts(
        &app,
        lead,
        &older,
        Some((mother, json!({ "phone": "+49 30 999999" }))),
        None,
        false,
    )
    .await;
    assert_eq!(code, StatusCode::OK, "{saved}");
    let staff = app.staff_lead(lead).await;
    let kept = staff["trusted_contacts"]
        .as_array()
        .unwrap()
        .iter()
        .any(|entry| entry["id"] == json!(father));
    let (code, _) = app
        .call("GET", &format!("/me/lead-requests/{lead}"), &ben, None)
        .await;
    assert!(
        kept || code != StatusCode::OK,
        "the father is gone from the contacts but still reads the request: {staff}"
    );
    if kept {
        // The father with his own access is still a representative.
        let view = app.cabinet(lead, &ben).await;
        assert_eq!(representative(&view, father)["mine"], true, "{view}");
    }
}

// ---------------------------------------------------------------------------
// Scenario 2a: the payer link of a company end to end.
// ---------------------------------------------------------------------------

/// An adult lead with its own login and a sent request; returns lead and bearer.
async fn adult_lead(app: &Scn, first: &str) -> (Uuid, String) {
    let created = app
        .ok(
            StatusCode::CREATED,
            "POST",
            "/leads",
            &app.pm(),
            Some(json!({ "first_name": first, "last_name": "Muster",
                "date_of_birth": "1980-02-03", "email": unique(&first.to_lowercase()) })),
        )
        .await;
    let lead: Uuid = created["id"].as_str().unwrap().parse().unwrap();
    let user: Uuid = created["portal_account"]["user_id"]
        .as_str()
        .unwrap()
        .parse()
        .unwrap();
    (lead, bearer(user, "patient"))
}

async fn mark_sent(app: &Scn, lead: Uuid) {
    // A few seconds ahead: the clock of a WSL test host may step back.
    sqlx::query(
        "UPDATE leads SET portal_submitted_at = clock_timestamp() + interval '5 seconds' WHERE id = $1",
    )
        .bind(lead)
        .execute(app.pool())
        .await
        .unwrap();
}

#[tokio::test]
async fn scenario_company_payer_link_end_to_end() {
    let Some(app) = Scn::new().await else { return };
    let (lead, olga) = adult_lead(&app, "Olga").await;
    let base = format!("/me/lead-requests/{lead}");
    app.consent(lead, &olga, "lead_inquiry_processing").await;
    app.ok(
        StatusCode::OK,
        "POST",
        &format!("{base}/payer"),
        &olga,
        Some(json!({
            "payer_kind": "third_party", "payer_type": "company",
            "organisation_name": "Beispiel GmbH", "country": "DE",
            "relationship_kind": "employer", "email": unique("kasse"),
            "contact_consent": true
        })),
    )
    .await;
    mark_sent(&app, lead).await;
    let (token, sent) = app.send_link(lead, json!({})).await;
    assert_eq!(sent["link"]["status"], "sent", "{sent}");
    let session = app.payer_session(&token).await;

    let owner = |first: &str, share: u32| {
        json!({ "first_name": first, "last_name": "Muster", "date_of_birth": "1975-02-03",
                "country": "DE", "share_percent": share })
    };
    let (code, body) = app
        .payer(
            "POST",
            "/questionnaire",
            &token,
            &session,
            Some(json!({
                "legal_form": "GmbH",
                "register_court": "Amtsgericht Berlin-Charlottenburg",
                "register_number": "HRB 12345",
                "street": "Handelsweg 1", "zip": "10115", "city": "Berlin",
                "industry": "Handel",
                "representative_first_name": "Viktor",
                "representative_last_name": "Zahler",
                "representative_role": "Geschäftsführer",
                "beneficial_owners": [owner("Anna", 60), owner("Ben", 40)],
                "funds_sources": ["business_revenue"],
                "pep_self": false, "pep_related": false, "sanctions_links": false,
                "payment_method": "bank_transfer", "account_country": "DE",
                "account_holder": "Beispiel GmbH", "bank_name": "Beispielbank",
                "via_third_party": false
            })),
        )
        .await;
    assert_eq!(code, StatusCode::OK, "{body}");
    // Whatever is still missing is named; fill the identity document of the
    // representative when asked.
    let mut body = body;
    if body["missing_for_submit"]
        .as_array()
        .is_some_and(|missing| missing.contains(&json!("id_document_upload")))
    {
        let (code, uploaded) = app
            .upload_with(
                &format!("{LINK}/identity-document"),
                &[("X-Payer-Link", &token), ("X-Payer-Session", &session)],
            )
            .await;
        assert_eq!(code, StatusCode::CREATED, "{uploaded}");
        body = uploaded;
    }
    let still: Vec<Value> = body["missing_for_submit"]
        .as_array()
        .cloned()
        .unwrap_or_default();
    if !still.is_empty() {
        // The identity document data of the person acting for the company.
        let (code, answered) = app
            .payer(
                "POST",
                "/questionnaire",
                &token,
                &session,
                Some(json!({
                    "id_document_type": "id_card", "id_document_number": "L01X00T47",
                    "id_issuing_authority": "Stadt Berlin", "id_issuing_country": "DE",
                    "id_valid_until": "2099-12-31",
                    "payment_reason": "Arbeitgeberleistung"
                })),
            )
            .await;
        assert_eq!(code, StatusCode::OK, "{answered}");
        body = answered;
    }
    assert_eq!(body["missing_for_submit"], json!([]), "{body}");
    let (code, sent) = app
        .payer(
            "POST",
            "/submit",
            &token,
            &session,
            Some(json!({ "declared_correct": true })),
        )
        .await;
    assert_eq!(code, StatusCode::OK, "{sent}");
    assert_eq!(sent["state"], "submitted");

    // Staff: the declaration and the payer's line; the lead sees nothing of
    // the company's answers.
    let declaration = app.declaration(lead).await;
    assert_eq!(
        declaration["declaration"]["payer_type"], "company",
        "{declaration}"
    );
    assert_eq!(
        declaration["declaration"]["organisation_name"],
        "Beispiel GmbH"
    );
    let view = app.cabinet(lead, &olga).await;
    assert!(!view.to_string().contains("HRB 12345"), "{view}");
    assert!(!view.to_string().contains("Beispielbank"), "{view}");

    // The GwG sheet of the company is the legal-entity form; nothing the
    // company stated is reported missing for the signature.
    let (code, sheet) = gwg_sheet(&app, lead, "payer").await;
    assert_eq!(code, StatusCode::OK, "{sheet}");
    let form: Option<String> = sqlx::query_scalar(
        "SELECT generated_bindings #>> '{gwg_identification,form}' FROM documents WHERE id = $1",
    )
    .bind(sheet["id"].as_str().unwrap().parse::<Uuid>().unwrap())
    .fetch_one(app.pool())
    .await
    .unwrap();
    assert_eq!(form.as_deref(), Some("legal_entity"), "{sheet}");
    let sheet_missing = sheet["signature_details"]["missing"].to_string();
    for stated in [
        "legal_form",
        "register",
        "beneficial",
        "representative_name",
        "street",
    ] {
        assert!(
            !sheet_missing.contains(stated),
            "{stated} was stated by the company: {sheet_missing}"
        );
    }

    // Staff reopen; the reopen is audited; the company corrects and sends again.
    let (status, refused) = app
        .call(
            "POST",
            &format!("/leads/{lead}/payer-link"),
            &app.pm(),
            Some(json!({})),
        )
        .await;
    assert_eq!(status, StatusCode::CONFLICT, "{refused}");
    let (token2, reopened) = app.send_link(lead, json!({ "reopen": true })).await;
    assert!(
        reopened["questionnaire"]["submitted_at"].is_null(),
        "{reopened}"
    );
    assert_eq!(
        app.audit("payer_questionnaire_reopened", lead).await.len(),
        1
    );
    let session2 = app.payer_session(&token2).await;
    let (code, body) = app
        .payer(
            "POST",
            "/questionnaire",
            &token2,
            &session2,
            Some(json!({ "bank_name": "Andere Bank" })),
        )
        .await;
    assert_eq!(code, StatusCode::OK, "{body}");
    let (code, _) = app
        .payer(
            "POST",
            "/submit",
            &token2,
            &session2,
            Some(json!({ "declared_correct": true })),
        )
        .await;
    assert_eq!(code, StatusCode::OK);

    // Staff review the payer's PEP status.
    let mut wizard_state = app.staff_lead(lead).await["wizard_state"].clone();
    if !wizard_state.is_object() {
        wizard_state = json!({});
    }
    wizard_state["aml_enhanced_due_diligence"] = json!({
        "pepReviews": { "payer": { "checked": true, "isPep": false } }
    });
    app.ok(
        StatusCode::OK,
        "POST",
        &format!("/leads/{lead}/update"),
        &app.pm(),
        Some(json!({ "wizard_state": wizard_state })),
    )
    .await;
    let reviewed: Option<Value> = sqlx::query_scalar(
        "SELECT wizard_state #> '{aml_enhanced_due_diligence,pepReviews,payer}' FROM leads WHERE id = $1",
    )
    .bind(lead)
    .fetch_one(app.pool())
    .await
    .unwrap();
    assert_eq!(
        reviewed.as_ref().map(|review| review["checked"].clone()),
        Some(json!(true))
    );

    // The company has answered: the lead no longer changes the payer, GMED
    // does.
    let other_payer = json!({
        "payer_kind": "third_party", "payer_type": "person",
        "first_name": "Viktor", "last_name": "Zahler", "date_of_birth": "1970-05-01",
        "citizenships": ["AT"], "relationship_kind": "friend",
        "email": unique("viktor"), "contact_consent": true
    });
    let (code, refused) = app
        .call(
            "POST",
            &format!("{base}/payer"),
            &olga,
            Some(other_payer.clone()),
        )
        .await;
    assert_eq!(code, StatusCode::CONFLICT, "{refused}");
    assert_eq!(refused["code"], "payer_answered_by_payer");
    // Staff name another payer: the company's link ends, its answers and
    // files go, and staff's PEP review of the company does not carry over.
    let mut staff_payer = other_payer.clone();
    staff_payer
        .as_object_mut()
        .unwrap()
        .remove("contact_consent");
    app.ok(
        StatusCode::OK,
        "POST",
        &format!("/leads/{lead}/payer-declaration"),
        &app.pm(),
        Some(staff_payer),
    )
    .await;
    let active: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM lead_payer_links WHERE lead_id = $1 AND revoked_at IS NULL",
    )
    .bind(lead)
    .fetch_one(app.pool())
    .await
    .unwrap();
    assert_eq!(active, 0);
    let (code, gone) = app
        .call_with(
            "GET",
            LINK,
            &[("X-Payer-Link", &token2), ("X-Payer-Session", &session2)],
            None,
        )
        .await;
    assert_ne!(code, StatusCode::OK, "{gone}");
    let reviewed: Option<Value> = sqlx::query_scalar(
        "SELECT wizard_state #> '{aml_enhanced_due_diligence,pepReviews,payer}' FROM leads WHERE id = $1",
    )
    .bind(lead)
    .fetch_one(app.pool())
    .await
    .unwrap();
    assert!(reviewed.is_none(), "{reviewed:?}");
    let declaration = app.declaration(lead).await;
    assert!(
        declaration["declaration"]["organisation_name"].is_null(),
        "{declaration}"
    );
    assert!(
        !declaration.to_string().contains("HRB 12345"),
        "{declaration}"
    );
    // The new payer's sheet is the natural-person form, without the old review.
    let (code, sheet) = gwg_sheet(&app, lead, "payer").await;
    assert_eq!(code, StatusCode::OK, "{sheet}");
    let form: Option<String> = sqlx::query_scalar(
        "SELECT generated_bindings #>> '{gwg_identification,form}' FROM documents WHERE id = $1",
    )
    .bind(sheet["id"].as_str().unwrap().parse::<Uuid>().unwrap())
    .fetch_one(app.pool())
    .await
    .unwrap();
    assert_ne!(form.as_deref(), Some("legal_entity"), "{sheet}");
}

// ---------------------------------------------------------------------------
// Scenario 2b: the payer link of a person: expiry, revocation, a new link.
// ---------------------------------------------------------------------------

#[tokio::test]
async fn scenario_person_payer_link_expires_is_revoked_and_sent_again() {
    let Some(app) = Scn::new().await else { return };
    let (lead, olga) = adult_lead(&app, "Olga").await;
    let base = format!("/me/lead-requests/{lead}");
    let payer_email = unique("viktor");
    app.consent(lead, &olga, "lead_inquiry_processing").await;
    app.ok(
        StatusCode::OK,
        "POST",
        &format!("{base}/payer"),
        &olga,
        Some(json!({
            "payer_kind": "third_party", "payer_type": "person",
            "first_name": "Viktor", "last_name": "Zahler", "date_of_birth": "1970-05-01",
            "citizenships": ["AT"], "relationship_kind": "friend",
            "email": payer_email, "contact_consent": true
        })),
    )
    .await;
    mark_sent(&app, lead).await;
    let (token, _) = app.send_link(lead, json!({})).await;
    let session = app.payer_session(&token).await;
    let (code, body) = app
        .payer(
            "POST",
            "/questionnaire",
            &token,
            &session,
            Some(
                json!({ "occupation": "Kaufmann", "street": "Ringstraße 9", "zip": "1010",
                         "city": "Wien", "country": "AT" }),
            ),
        )
        .await;
    assert_eq!(code, StatusCode::OK, "{body}");

    // The link expires: the payer is told, staff see "expired".
    sqlx::query(
        "UPDATE lead_payer_links SET expires_at = now() - interval '1 minute' WHERE lead_id = $1 AND revoked_at IS NULL",
    )
    .bind(lead)
    .execute(app.pool())
    .await
    .unwrap();
    let (code, refused) = app
        .payer(
            "POST",
            "/questionnaire",
            &token,
            &session,
            Some(json!({ "occupation": "Händler" })),
        )
        .await;
    assert_ne!(code, StatusCode::OK, "{refused}");
    let info = app
        .ok(
            StatusCode::OK,
            "GET",
            &format!("/leads/{lead}/payer-link"),
            &app.pm(),
            None,
        )
        .await;
    assert_eq!(info["link"]["status"], "expired", "{info}");
    // A new link keeps the same payer's draft answers.
    let (token2, _) = app.send_link(lead, json!({})).await;
    assert_ne!(token, token2);
    let session2 = app.payer_session(&token2).await;
    let (code, draft) = app
        .payer("GET", "/questionnaire", &token2, &session2, None)
        .await;
    assert_eq!(code, StatusCode::OK, "{draft}");
    assert_eq!(draft["answers"]["occupation"], "Kaufmann", "{draft}");

    // Staff revoke it: the open session ends at once.
    app.ok(
        StatusCode::OK,
        "POST",
        &format!("/leads/{lead}/payer-link/revoke"),
        &app.pm(),
        None,
    )
    .await;
    let (code, refused) = app
        .payer(
            "POST",
            "/questionnaire",
            &token2,
            &session2,
            Some(json!({ "occupation": "Händler" })),
        )
        .await;
    assert_ne!(code, StatusCode::OK, "{refused}");
    let revoked = app.audit("payer_link_revoked", lead).await;
    assert!(
        revoked.iter().any(|(user, _)| *user == Some(app.pm_id)),
        "{revoked:?}"
    );

    // The lead withdraws the consent to contact the payer: no new link.
    app.ok(
        StatusCode::OK,
        "POST",
        &format!("{base}/payer"),
        &olga,
        Some(json!({
            "payer_kind": "third_party", "payer_type": "person",
            "first_name": "Viktor", "last_name": "Zahler", "date_of_birth": "1970-05-01",
            "citizenships": ["AT"], "relationship_kind": "friend",
            "email": payer_email, "contact_consent": false
        })),
    )
    .await;
    let (code, refused) = app
        .call(
            "POST",
            &format!("/leads/{lead}/payer-link"),
            &app.pm(),
            Some(json!({})),
        )
        .await;
    assert_ne!(code, StatusCode::OK, "{refused}");
}

// ---------------------------------------------------------------------------
// Scenario 3a: an unsigned minor request is purged after 14 days.
// ---------------------------------------------------------------------------

#[tokio::test]
async fn scenario_unsigned_minor_request_is_purged_with_the_parents_access() {
    let Some(app) = Scn::new().await else { return };
    let pool = app.pool();
    let request = fill_joint_custody_request(&app).await;
    let (lead, mother, father) = (request.lead, request.mother, request.father);
    let (father_login, ben) = app.guardian_access(lead, father).await;
    submit(&app, lead, &request.anna).await;
    // The mother has a second child whose request stays: her login stays,
    // only the purged request is gone from it.
    let sibling = app
        .minor_lead(
            "Tom",
            json!([{ "id": Uuid::new_v4(), "name": "Anna Muster", "relation": "mother",
                     "email": contact(&app.staff_lead(lead).await, mother)["email"],
                     "phone": "+49 30 000001" }]),
        )
        .await;
    let sibling_contact: Uuid = app.staff_lead(sibling).await["trusted_contacts"][0]["id"]
        .as_str()
        .unwrap()
        .parse()
        .unwrap();
    // Her login reaches the sibling's request: linked by her address when
    // staff named her, or issued now (the same login).
    let (code, issued) = app
        .call(
            "POST",
            &format!("/leads/{sibling}/portal-guardians"),
            &app.pm(),
            Some(json!({ "trusted_contact_id": sibling_contact })),
        )
        .await;
    if code == StatusCode::CREATED {
        assert_eq!(issued["user_id"], json!(request.mother_login), "{issued}");
    } else {
        assert_eq!(issued["code"], "guardian_access_exists", "{issued}");
    }
    assert_eq!(app.cabinet(sibling, &request.anna).await["minor"], true);
    let documents: Vec<Uuid> =
        sqlx::query_scalar("SELECT document_id FROM lead_portal_uploads WHERE lead_id = $1")
            .bind(lead)
            .fetch_all(pool)
            .await
            .unwrap();
    assert_eq!(documents.len(), 3, "{documents:?}");

    sqlx::query("UPDATE leads SET created_at = now() - interval '15 days' WHERE id = $1")
        .bind(lead)
        .execute(pool)
        .await
        .unwrap();
    let policy = gmed_server::routes::leads::UnqualifiedLeadRetention {
        days: 14,
        effective_at: chrono::Utc::now() - chrono::Duration::days(60),
    };
    let report = gmed_server::routes::leads::purge_unqualified_leads(
        &app.suite.state,
        policy,
        chrono::Utc::now(),
        Some(&[lead, sibling]),
    )
    .await
    .unwrap();
    assert_eq!((report.purged, report.errors), (1, 0), "{report:?}");

    // The father reached only this request: his login is off.
    let (code, _) = app.call("GET", "/me/lead-requests", &ben, None).await;
    assert_eq!(code, StatusCode::UNAUTHORIZED);
    let (active, email): (bool, String) =
        sqlx::query_as("SELECT is_active, email FROM users WHERE id = $1")
            .bind(father_login)
            .fetch_one(pool)
            .await
            .unwrap();
    assert!(!active);
    assert_ne!(email, request.father_email, "the login is anonymised");
    // The mother keeps her login for the sibling; the purged request is gone.
    let list = app
        .ok(
            StatusCode::OK,
            "GET",
            "/me/lead-requests",
            &request.anna,
            None,
        )
        .await;
    let ids: Vec<Value> = list["requests"]
        .as_array()
        .unwrap()
        .iter()
        .map(|item| item["lead_id"].clone())
        .collect();
    assert_eq!(ids, vec![json!(sibling)], "{list}");
    let (code, _) = app.call("GET", &request.base(), &request.anna, None).await;
    assert_eq!(code, StatusCode::NOT_FOUND);
    for (path, body) in [
        ("personal-data".to_string(), json!({ "city": "Potsdam" })),
        ("billing".to_string(), json!({ "bank_name": "Neue Bank" })),
        (
            format!("representatives/{mother}"),
            json!({ "phone": "+49 30 111111" }),
        ),
    ] {
        let (code, body) = app
            .call(
                "POST",
                &format!("{}/{path}", request.base()),
                &request.anna,
                Some(body),
            )
            .await;
        assert!(
            code == StatusCode::NOT_FOUND || code == StatusCode::FORBIDDEN,
            "{path}: {code} {body}"
        );
    }
    let open_accesses: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM lead_portal_access WHERE lead_id = $1 AND revoked_at IS NULL",
    )
    .bind(lead)
    .fetch_one(pool)
    .await
    .unwrap();
    assert_eq!(open_accesses, 0);
    // Nothing of the request is left to read.
    let left: i64 = sqlx::query_scalar("SELECT count(*) FROM documents WHERE id = ANY($1)")
        .bind(&documents)
        .fetch_one(pool)
        .await
        .unwrap();
    assert_eq!(left, 0, "the uploaded documents are removed");
    let (contacts, first_name): (Value, String) =
        sqlx::query_as("SELECT trusted_contacts, first_name FROM leads WHERE id = $1")
            .bind(lead)
            .fetch_one(pool)
            .await
            .unwrap();
    assert_eq!(contacts, json!([]));
    assert_eq!(first_name, "Deleted");
    for table in [
        "lead_representatives",
        "lead_payer_declarations",
        "lead_invoice_recipients",
        "lead_portal_uploads",
    ] {
        let rows: i64 =
            sqlx::query_scalar(&format!("SELECT count(*) FROM {table} WHERE lead_id = $1"))
                .bind(lead)
                .fetch_one(pool)
                .await
                .unwrap();
        assert_eq!(rows, 0, "{table} keeps rows of the purged lead");
    }
    let gwg_answers: i64 = sqlx::query_scalar(
        r#"SELECT count(*) FROM lead_gwg_declarations
           WHERE lead_id = $1 AND (birth_place IS NOT NULL OR custody IS NOT NULL)"#,
    )
    .bind(lead)
    .fetch_one(pool)
    .await
    .unwrap();
    assert_eq!(gwg_answers, 0, "the GwG answers of the purged lead stay");
    // Staff cannot write into the tombstone.
    let (code, _) = app
        .call(
            "POST",
            &format!("/leads/{lead}/representation"),
            &app.pm(),
            Some(json!({ "custody": "joint" })),
        )
        .await;
    assert_eq!(code, StatusCode::CONFLICT);
    // The sibling's request is untouched.
    let sibling_view = app.cabinet(sibling, &request.anna).await;
    assert_eq!(sibling_view["minor"], true);
}

// ---------------------------------------------------------------------------
// Scenario 3b: a request archived as failed, reopened and converted.
// ---------------------------------------------------------------------------

#[tokio::test]
async fn scenario_archived_request_is_reopened_and_converted() {
    let Some(app) = Scn::new().await else { return };
    let request = fill_joint_custody_request(&app).await;
    let (lead, mother, father) = (request.lead, request.mother, request.father);
    submit(&app, lead, &request.anna).await;
    app.ok(
        StatusCode::OK,
        "POST",
        &format!("/leads/{lead}/failed-flow"),
        &app.pm(),
        Some(json!({ "resolution": "archive", "reason": "Kein Kontakt" })),
    )
    .await;
    let staff = app.staff_lead(lead).await;
    assert_eq!(staff["qualification_status"], "archived", "{staff}");
    // The mother still reads her request; what she sends after the archive
    // reaches staff as a change.
    let view = app.cabinet(lead, &request.anna).await;
    assert!(view["submitted_at"].is_string(), "{view}");
    let (code, body) = app
        .call(
            "POST",
            &format!("{}/personal-data", request.base()),
            &request.anna,
            Some(json!({ "city": "Potsdam" })),
        )
        .await;
    if code == StatusCode::OK {
        let intake = app
            .ok(
                StatusCode::OK,
                "GET",
                &format!("/leads/{lead}/portal-intake"),
                &app.pm(),
                None,
            )
            .await;
        assert_eq!(intake["changed_since_submit"], true, "{intake}");
    } else {
        assert_eq!(code, StatusCode::CONFLICT, "{body}");
    }

    // Staff reopen the request and convert it.
    app.ok(
        StatusCode::OK,
        "POST",
        &format!("/leads/{lead}/qualify"),
        &app.pm(),
        Some(json!({ "status": "in_progress" })),
    )
    .await;
    if app.cabinet(lead, &request.anna).await["changed_since_submit"] == true {
        submit(&app, lead, &request.anna).await;
    }
    app.ok(
        StatusCode::OK,
        "POST",
        &format!("/leads/{lead}/update"),
        &app.pm(),
        Some(
            json!({ "trusted_contacts": app.staff_lead(lead).await["trusted_contacts"]
            .as_array().unwrap().iter().map(|entry| {
                let mut entry = entry.clone();
                if entry["id"] == json!(father) { entry["birth_date"] = json!("1983-04-06"); }
                entry
            }).collect::<Vec<_>>() }),
        ),
    )
    .await;
    enter_identity_data(&app, lead, mother, "C01X00T47").await;
    enter_identity_data(&app, lead, father, "C02X00T48").await;
    let patient = qualify_and_convert(&app, lead).await;
    let (status, outcome): (String, Option<String>) = sqlx::query_as(
        "SELECT qualification_status, failed_outcome_status FROM leads WHERE id = $1",
    )
    .bind(lead)
    .fetch_one(app.pool())
    .await
    .unwrap();
    assert_eq!(status, "converted");
    assert_ne!(
        outcome.as_deref(),
        Some("archived"),
        "a converted lead is no failed one any more"
    );
    let (code, me) = app.call("GET", "/me/export", &request.anna, None).await;
    assert_eq!(code, StatusCode::OK, "{me}");
    assert_eq!(me["patient"]["id"], json!(patient));
}

// ---------------------------------------------------------------------------
// Scenario 4: joint custody, then staff state sole custody.
// ---------------------------------------------------------------------------

#[tokio::test]
async fn scenario_joint_then_sole_custody_does_not_keep_the_other_parent_as_payer() {
    let Some(app) = Scn::new().await else { return };
    let request = fill_joint_custody_request(&app).await;
    let (lead, mother, father) = (request.lead, request.mother, request.father);
    let (father_login, ben) = app.guardian_access(lead, father).await;
    submit(&app, lead, &request.anna).await;
    enter_identity_data(&app, lead, mother, "C01X00T47").await;
    enter_identity_data(&app, lead, father, "C02X00T48").await;
    app.ok(
        StatusCode::OK,
        "POST",
        &format!("/leads/{lead}/update"),
        &app.pm(),
        Some(
            json!({ "trusted_contacts": app.staff_lead(lead).await["trusted_contacts"]
            .as_array().unwrap().iter().map(|entry| {
                let mut entry = entry.clone();
                if entry["id"] == json!(father) { entry["birth_date"] = json!("1983-04-06"); }
                entry
            }).collect::<Vec<_>>() }),
        ),
    )
    .await;

    // The mother has custody alone.
    app.ok(
        StatusCode::OK,
        "POST",
        &format!("/leads/{lead}/representation"),
        &app.pm(),
        Some(json!({ "custody": "sole_parent" })),
    )
    .await;
    let view = app.cabinet(lead, &request.anna).await;
    assert_eq!(view["representation"]["custody"], "sole_parent");
    assert_eq!(representative(&view, mother)["slot"], "rep1", "{view}");
    assert!(representative(&view, father)["slot"].is_null(), "{view}");
    // The mother's cabinet asks who pays again (live check 2026-10-24: step
    // 3 was "complete" with an empty payer).
    assert!(
        missing(&view).contains(&"payer_kind".to_string()),
        "{}",
        view["progress"]
    );

    // The father paid: without custody he is no paying representative any
    // more; staff are told, the father is not silently kept as payer.
    let staff = app.staff_lead(lead).await;
    let reasons = staff["readiness"]["blocking_reasons"].to_string();
    assert!(
        reasons.contains("Paying parent or legal representative is not named"),
        "{reasons}"
    );
    let status = app
        .ok(
            StatusCode::OK,
            "GET",
            &format!("/leads/{lead}/identification-status"),
            &app.pm(),
            None,
        )
        .await;
    assert_ne!(
        status["payer"]["same_person_as"],
        format!("representative:{father}"),
        "{status}"
    );
    // Owner decision 2026-10-23: his access to the request ended with the
    // custody change (audited, staff told once); his login stays and the
    // cabinet says neutrally that the access ended.
    assert_custody_ended_access(&app, lead, father_login, &ben, app.pm_id).await;
    // Staff cannot name him as payer again; they name the mother.
    let (code, refused) = app
        .call(
            "POST",
            &format!("/leads/{lead}/payer-declaration"),
            &app.pm(),
            Some(json!({ "payer_kind": "representative", "payer_representative_id": father })),
        )
        .await;
    assert_eq!(code, StatusCode::UNPROCESSABLE_ENTITY, "{refused}");
    assert_eq!(refused["error"], "payer_representative_invalid");
    app.ok(
        StatusCode::OK,
        "POST",
        &format!("/leads/{lead}/payer-declaration"),
        &app.pm(),
        Some(
            json!({ "payer_kind": "representative", "payer_representative_id": mother,
                     "acts_on_own_account": true }),
        ),
    )
    .await;
    // The mother's sheet is the only one asked for.
    let (code, sheet) = gwg_sheet(&app, lead, &format!("representative:{mother}")).await;
    assert_eq!(code, StatusCode::OK, "{sheet}");
    if app.cabinet(lead, &request.anna).await["changed_since_submit"] == true {
        submit(&app, lead, &request.anna).await;
    }

    let patient = qualify_and_convert(&app, lead).await;
    let (custody, contracting): (Option<String>, Vec<Uuid>) =
        sqlx::query_as("SELECT custody, contracting_relation_ids FROM patients WHERE id = $1")
            .bind(patient)
            .fetch_one(app.pool())
            .await
            .unwrap();
    assert_eq!(custody.as_deref(), Some("sole_parent"));
    let relations: Vec<(Uuid, String, bool)> = sqlx::query_as(
        "SELECT id, related_name, is_default_payer FROM patient_relations WHERE patient_id = $1 ORDER BY related_name",
    )
    .bind(patient)
    .fetch_all(app.pool())
    .await
    .unwrap();
    let anna_relation = relations
        .iter()
        .find(|(_, name, _)| name == "Anna Muster")
        .unwrap_or_else(|| panic!("{relations:?}"));
    assert_eq!(contracting, vec![anna_relation.0], "{relations:?}");
    assert!(anna_relation.2, "the mother pays: {relations:?}");
    assert!(
        relations
            .iter()
            .filter(|(_, name, _)| name == "Ben Muster")
            .all(|(_, _, default)| !default),
        "{relations:?}"
    );
}

/// A custody change ended the parent's access (owner decision 2026-10-23):
/// revoked as `custody_changed` by `actor`, audited, one staff notice naming
/// the request only; the login stays active and the cabinet reports the end.
async fn assert_custody_ended_access(
    app: &Scn,
    lead: Uuid,
    login: Uuid,
    bearer: &str,
    actor: Uuid,
) {
    let pool = app.pool();
    let (code, _) = app
        .call("GET", &format!("/me/lead-requests/{lead}"), bearer, None)
        .await;
    assert_eq!(code, StatusCode::NOT_FOUND);
    let list = app
        .ok(StatusCode::OK, "GET", "/me/lead-requests", bearer, None)
        .await;
    assert_eq!(list["requests"], json!([]), "{list}");
    assert_eq!(list["guardian_access_ended"], true, "{list}");
    assert_eq!(
        list["guardian_access_ended_reason"], "custody_changed",
        "{list}"
    );
    let active: bool = sqlx::query_scalar("SELECT is_active FROM users WHERE id = $1")
        .bind(login)
        .fetch_one(pool)
        .await
        .unwrap();
    assert!(active, "the login stays");
    let me = app.ok(StatusCode::OK, "GET", "/me", bearer, None).await;
    assert_eq!(me["portal_mode"], "lead", "{me}");
    let revoked: Vec<(Option<Uuid>, Option<String>)> = sqlx::query_as(
        "SELECT revoked_by, revoked_reason FROM lead_portal_access WHERE lead_id = $1 AND user_id = $2",
    )
    .bind(lead)
    .bind(login)
    .fetch_all(pool)
    .await
    .unwrap();
    assert_eq!(
        revoked,
        vec![(Some(actor), Some("custody_changed".to_string()))]
    );
    let audited = app.audit("lead_guardian_access_revoked", lead).await;
    assert_eq!(audited.len(), 1, "{audited:?}");
    assert_eq!(audited[0].0, Some(actor));
    assert_eq!(audited[0].1["reason"], "custody_changed");
    let notices: Vec<(Uuid, String, Option<String>)> = sqlx::query_as(
        r#"SELECT user_id, title, body FROM user_notifications
           WHERE entity_type = 'lead' AND entity_id = $1
             AND kind = 'lead_guardian_access_custody_ended'"#,
    )
    .bind(lead)
    .fetch_all(pool)
    .await
    .unwrap();
    assert!(!notices.is_empty(), "staff are told");
    let mut recipients: Vec<Uuid> = notices.iter().map(|(user, _, _)| *user).collect();
    recipients.sort();
    recipients.dedup();
    assert_eq!(recipients.len(), notices.len(), "one notice per person");
    for (_, title, body) in &notices {
        let text = format!("{title} {}", body.clone().unwrap_or_default());
        assert!(
            !text.contains("Muster") && !text.contains("Ben") && !text.contains("Mia"),
            "{text}"
        );
    }
}

// ---------------------------------------------------------------------------
// Scenario 4b: the mother changes the custody in the cabinet herself.
// ---------------------------------------------------------------------------

#[tokio::test]
async fn scenario_cabinet_sole_custody_ends_the_other_parents_access() {
    let Some(app) = Scn::new().await else { return };
    let request = fill_joint_custody_request(&app).await;
    let (lead, mother, father) = (request.lead, request.mother, request.father);
    let (father_login, ben) = app.guardian_access(lead, father).await;
    assert_eq!(app.cabinet(lead, &ben).await["minor"], true);
    let view = app
        .ok(
            StatusCode::OK,
            "POST",
            &format!("{}/representation", request.base()),
            &request.anna,
            Some(json!({ "custody": "sole_parent" })),
        )
        .await;
    assert_eq!(view["representation"]["custody"], "sole_parent", "{view}");
    assert_eq!(representative(&view, mother)["slot"], "rep1", "{view}");
    assert_custody_ended_access(&app, lead, father_login, &ben, request.mother_login).await;
    // Joint custody again does not bring the access back by itself: staff
    // issue it again, to the same login.
    app.ok(
        StatusCode::OK,
        "POST",
        &format!("{}/representation", request.base()),
        &request.anna,
        Some(json!({ "custody": "joint" })),
    )
    .await;
    let (code, _) = app.call("GET", &request.base(), &ben, None).await;
    assert_eq!(code, StatusCode::NOT_FOUND);
    let (again, ben_again) = app.guardian_access(lead, father).await;
    assert_eq!(again, father_login, "the same login");
    assert_eq!(app.cabinet(lead, &ben_again).await["minor"], true);
    let list = app
        .ok(StatusCode::OK, "GET", "/me/lead-requests", &ben_again, None)
        .await;
    assert_eq!(list["guardian_access_ended"], false, "{list}");
    // The mother's access is untouched throughout.
    assert_eq!(app.cabinet(lead, &request.anna).await["minor"], true);
}
