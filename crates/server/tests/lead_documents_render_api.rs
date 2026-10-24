//! Renders every document GMED generates for a lead, for realistic synthetic
//! leads, and writes the PDFs to `$GMED_LEAD_DOCS_DIR/<scenario>/` so a person
//! can look at each page (owner request 2026-10-24: "перевір всі документи на
//! лідах"). Without that variable the test does nothing: CI never writes
//! files. Every step goes through the HTTP API the way the cabinet, the payer
//! link and the staff wizard call it; refusals of a generation are written to
//! `_results.txt` of the scenario instead of failing the run, only a server
//! error (5xx) fails it. Synthetic data only.
//!
//! ```text
//! GMED_LEAD_DOCS_DIR=$HOME/lead-docs cargo test -p gmed-server \
//!     --test lead_documents_render_api -- --nocapture
//! ```

mod support;

use std::collections::HashMap;
use std::net::SocketAddr;
use std::path::PathBuf;
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

fn peer() -> ConnectInfo<SocketAddr> {
    let n = NEXT_PEER.fetch_add(1, Ordering::Relaxed);
    ConnectInfo(SocketAddr::from(([10, 78, (n >> 8) as u8, n as u8], 40000)))
}

fn bearer(user_id: Uuid, role: &str) -> String {
    let token = jwt::issue_access_token(SECRET, user_id, role, Uuid::new_v4()).unwrap();
    format!("Bearer {token}")
}

fn unique(name: &str) -> String {
    format!("{name}.{}@example.com", Uuid::new_v4().simple())
}

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

async fn seed_user(pool: &PgPool, role: &str, name: &str) -> Uuid {
    sqlx::query_scalar(
        "INSERT INTO users (email, password_hash, name, role) VALUES ($1, 'test-password-hash', $2, $3) RETURNING id",
    )
    .bind(unique(&format!("render-{role}")))
    .bind(name)
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
    out: PathBuf,
    work_types: Vec<String>,
}

/// The findings of one scenario: what each step and generation answered.
struct Notes {
    dir: PathBuf,
    text: String,
}

impl Notes {
    fn new(app: &Scn, scenario: &str) -> Self {
        let dir = app.out.join(scenario);
        std::fs::create_dir_all(&dir).unwrap();
        Self {
            dir,
            text: format!("# {scenario}\n"),
        }
    }

    fn line(&mut self, line: impl AsRef<str>) {
        self.text.push_str(line.as_ref());
        self.text.push('\n');
    }

    fn save(&self) {
        std::fs::write(self.dir.join("_results.txt"), &self.text).unwrap();
    }
}

fn short(value: &Value) -> String {
    let text = value.to_string();
    if text.chars().count() > 600 {
        format!("{}…", text.chars().take(600).collect::<String>())
    } else {
        text
    }
}

impl Scn {
    async fn new() -> Option<Self> {
        let out = std::env::var_os("GMED_LEAD_DOCS_DIR").map(PathBuf::from)?;
        let suite = support::suite_context(SECRET).await?;
        let pm_id = seed_user(&suite.pool, "patient_manager", "Paula Managerin").await;
        let ceo_id = seed_user(&suite.pool, "ceo", "Dr. Konstantin Geschäftsführer").await;
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
        std::fs::create_dir_all(&out).unwrap();
        // Two work types of the catalog for the preliminary cost calculation.
        let code = format!("render_{}", Uuid::new_v4().simple());
        let specialization: Uuid = sqlx::query_scalar(
            r#"INSERT INTO medical_specializations (code, name_en, name_de, name_ru)
               VALUES ($1, 'Orthopedics', 'Orthopädie', 'Ортопедия') RETURNING id"#,
        )
        .bind(&code)
        .fetch_one(&suite.pool)
        .await
        .unwrap();
        let mut work_types = Vec::new();
        for (index, (name_de, name_ru, min, max)) in [
            (
                "Kniegelenksarthroskopie mit Meniskusteilresektion",
                "Артроскопия коленного сустава",
                2800,
                4500,
            ),
            ("MRT des Kniegelenks", "МРТ коленного сустава", 450, 700),
        ]
        .into_iter()
        .enumerate()
        {
            let id: Uuid = sqlx::query_scalar(
                r#"INSERT INTO medical_specialization_work_types (
                        specialization_id, code, name_de, name_ru, min_price_eur, max_price_eur, duration_hours
                   ) VALUES ($1, $2, $3, $4, $5, $6, 2) RETURNING id"#,
            )
            .bind(specialization)
            .bind(format!("{code}_{index}"))
            .bind(name_de)
            .bind(name_ru)
            .bind(min)
            .bind(max)
            .fetch_one(&suite.pool)
            .await
            .unwrap();
            sqlx::query(
                "INSERT INTO medical_specialization_work_type_assignments (work_type_id, specialization_id) VALUES ($1, $2)",
            )
            .bind(id)
            .bind(specialization)
            .execute(&suite.pool)
            .await
            .unwrap();
            work_types.push(id.to_string());
        }
        Some(Self {
            suite,
            app,
            fake,
            pm_id,
            ceo_id,
            out,
            work_types,
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

    async fn send(&self, request: Request<Body>) -> (StatusCode, Vec<u8>) {
        let mut request = request;
        request.extensions_mut().insert(peer());
        let response = self.app.clone().oneshot(request).await.unwrap();
        let status = response.status();
        let bytes = axum::body::to_bytes(response.into_body(), 32 * 1024 * 1024)
            .await
            .unwrap();
        (status, bytes.to_vec())
    }

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
        let (status, bytes) = self.send(request).await;
        (
            status,
            serde_json::from_slice(&bytes)
                .unwrap_or_else(|_| Value::String(String::from_utf8_lossy(&bytes).into_owned())),
        )
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

    /// A step the scenario needs: anything but 2xx fails the run.
    async fn ok(&self, method: &str, path: &str, auth: &str, body: Option<Value>) -> Value {
        let (status, value) = self.call(method, path, auth, body).await;
        assert!(status.is_success(), "{method} {path}: {status} {value}");
        value
    }

    /// A step whose refusal is a finding: written to the notes, never fatal
    /// unless the server fails (5xx).
    async fn soft(
        &self,
        notes: &mut Notes,
        method: &str,
        path: &str,
        auth: &str,
        body: Option<Value>,
    ) -> (StatusCode, Value) {
        let (status, value) = self.call(method, path, auth, body).await;
        if !status.is_success() {
            notes.line(format!("STEP {method} {path}: {status} {}", short(&value)));
        }
        assert!(
            !status.is_server_error(),
            "{method} {path}: {status} {value}"
        );
        (status, value)
    }

    async fn upload_with(&self, path: &str, headers: &[(&str, &str)]) -> (StatusCode, Value) {
        let boundary = format!("----gmed-render-{}", Uuid::new_v4().simple());
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
        let (status, bytes) = self.send(request.body(Body::from(body)).unwrap()).await;
        (
            status,
            serde_json::from_slice(&bytes).unwrap_or(Value::Null),
        )
    }

    async fn upload(&self, path: &str, auth: &str) {
        let (status, body) = self.upload_with(path, &[("Authorization", auth)]).await;
        assert_eq!(status, StatusCode::CREATED, "{path}: {body}");
    }

    async fn consents(&self, lead: Uuid, auth: &str) {
        for (purpose, version) in [
            ("health_data_processing", HEALTH_CONSENT_VERSION),
            ("lead_inquiry_processing", INQUIRY_CONSENT_VERSION),
        ] {
            self.ok(
                "POST",
                &format!("/me/lead-requests/{lead}/consent"),
                auth,
                Some(json!({ "purpose": purpose, "version": version, "language": "de" })),
            )
            .await;
        }
    }

    async fn guardian_access(&self, lead: Uuid, contact: Uuid) -> String {
        let issued = self
            .ok(
                "POST",
                &format!("/leads/{lead}/portal-guardians"),
                &self.pm(),
                Some(json!({ "trusted_contact_id": contact })),
            )
            .await;
        let user: Uuid = issued["user_id"].as_str().unwrap().parse().unwrap();
        bearer(user, "patient")
    }

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

    /// Staff send the payer's link; the payer verifies; (token, session).
    async fn payer_opens_link(&self, lead: Uuid) -> (String, String) {
        self.ok(
            "POST",
            &format!("/leads/{lead}/payer-link"),
            &self.pm(),
            Some(json!({ "language": "de" })),
        )
        .await;
        let token = self.last_token();
        let (status, body) = self
            .call_with(
                "POST",
                &format!("{LINK}/code"),
                &[("X-Payer-Link", &token)],
                None,
            )
            .await;
        assert_eq!(status, StatusCode::ACCEPTED, "{body}");
        let code = self.last_code();
        let (status, verified) = self
            .call_with(
                "POST",
                &format!("{LINK}/verify"),
                &[("X-Payer-Link", &token)],
                Some(json!({ "code": code })),
            )
            .await;
        assert_eq!(status, StatusCode::OK, "{verified}");
        let session = verified["session"].as_str().unwrap().to_string();
        let (status, body) = self
            .call_with(
                "POST",
                &format!("{LINK}/consent"),
                &[("X-Payer-Link", &token), ("X-Payer-Session", &session)],
                Some(json!({ "acknowledged": true, "contact_channels": ["email"] })),
            )
            .await;
        assert_eq!(status, StatusCode::OK, "{body}");
        (token, session)
    }

    /// The payer answers, uploads the identity document and sends.
    async fn payer_answers(&self, notes: &mut Notes, lead: Uuid, answers: Value) {
        let (token, session) = self.payer_opens_link(lead).await;
        let headers = [
            ("X-Payer-Link", token.as_str()),
            ("X-Payer-Session", session.as_str()),
        ];
        let (status, body) = self
            .call_with(
                "POST",
                &format!("{LINK}/questionnaire"),
                &headers,
                Some(answers),
            )
            .await;
        assert_eq!(status, StatusCode::OK, "{body}");
        let (status, body) = self
            .upload_with(&format!("{LINK}/identity-document"), &headers)
            .await;
        if status != StatusCode::CREATED {
            notes.line(format!("payer identity upload: {status} {}", short(&body)));
        }
        let (status, body) = self
            .call_with(
                "POST",
                &format!("{LINK}/submit"),
                &headers,
                Some(json!({ "declared_correct": true })),
            )
            .await;
        assert_eq!(status, StatusCode::OK, "payer submit: {body}");
    }

    async fn submit(&self, notes: &mut Notes, lead: Uuid, auth: &str) {
        self.soft(
            notes,
            "POST",
            &format!("/me/lead-requests/{lead}/submit"),
            auth,
            Some(json!({ "declared_correct": true })),
        )
        .await;
    }

    async fn identity_data(&self, lead: Uuid, representative: Option<Uuid>, number: &str) {
        let path = match representative {
            Some(id) => format!("/leads/{lead}/representatives/{id}/identity-document-data"),
            None => format!("/leads/{lead}/identity-document-data"),
        };
        self.ok(
            "PUT",
            &path,
            &self.pm(),
            Some(json!({
                "id_document_type": "passport", "id_document_number": number,
                "id_issuing_authority": "Landeshauptstadt München – Kreisverwaltungsreferat",
                "id_issuing_country": "DE",
                "id_issued_on": "2021-03-04", "id_valid_until": "2031-03-03"
            })),
        )
        .await;
    }

    /// The consent form's choices and the trusted persons of the cabinet.
    async fn consent_choices(&self, notes: &mut Notes, lead: Uuid, auth: &str) {
        self.soft(
            notes,
            "POST",
            &format!("/me/lead-requests/{lead}/trusted-persons"),
            auth,
            Some(json!({
                "persons": [
                    { "name": "Ludmila Øresund-Großmann", "relation": "relative",
                      "contact": "+49 89 1234567", "scope_codes": ["medical"] },
                    { "name": "Олександра Петрівна Ковальчук", "relation": "friend",
                      "scope_codes": ["all"] }
                ],
                "allow_disclosure": true, "consent_given": true,
                "version": "2026-10-14", "language": "de"
            })),
        )
        .await;
        self.soft(
            notes,
            "POST",
            &format!("/me/lead-requests/{lead}/consent-choices"),
            auth,
            Some(json!({
                "choices": {
                    "agency_processing": true, "doctors_to_agency": true, "data_system": true,
                    "named_recipients": true, "channel_email": true, "channel_threema": false,
                    "channel_whatsapp": true, "channel_telegram": false
                },
                "version": "2026-10-12", "language": "de"
            })),
        )
        .await;
    }

    /// The framework contract, the order with two services and its accepted
    /// quote, as the wizard's commercial step leaves them; the order.
    async fn commercial(&self, lead: Uuid) -> (Uuid, String) {
        let pool = self.pool();
        let tag = Uuid::new_v4().simple().to_string()[..8].to_uppercase();
        sqlx::query(
            r#"UPDATE leads SET primary_concern_text = COALESCE(primary_concern_text, 'Chronische Kniebeschwerden, Zweitmeinung'),
                   requested_specialties = '["orthopedics"]'::jsonb,
                   wizard_state = COALESCE(wizard_state, '{}'::jsonb)
                     || jsonb_build_object('selected_specialization_work_type_ids', $2::jsonb)
               WHERE id = $1"#,
        )
        .bind(lead)
        .bind(json!(self.work_types))
        .execute(pool)
        .await
        .unwrap();
        let contract: Uuid = sqlx::query_scalar(
            r#"INSERT INTO framework_contracts (lead_id, contract_number, status, created_by)
               VALUES ($1, $2, 'sent', $3) RETURNING id"#,
        )
        .bind(lead)
        .bind(format!("RV-{tag}"))
        .bind(self.pm_id)
        .fetch_one(pool)
        .await
        .unwrap();
        // Some steps (the payer's answers) may already have opened the order.
        let (order, number): (Uuid, String) = sqlx::query_as(
            r#"INSERT INTO orders (order_number, contract_id, source_lead_id, needs_description,
                                   prepayment_required, prepayment_amount, total_estimated, created_by)
               VALUES ($1, $2, $3, 'Koordination einer orthopädischen Zweitmeinung in München',
                       true, 500, 1785, $4)
               ON CONFLICT (source_lead_id) WHERE source_lead_id IS NOT NULL DO UPDATE
                 SET contract_id = EXCLUDED.contract_id, needs_description = EXCLUDED.needs_description,
                     prepayment_required = true, prepayment_amount = 500, total_estimated = 1785
               RETURNING id, order_number"#,
        )
        .bind(format!("A-{tag}"))
        .bind(contract)
        .bind(lead)
        .bind(self.pm_id)
        .fetch_one(pool)
        .await
        .unwrap();
        for (description, price) in [
            ("Organisation und Koordination der Behandlung", 1000),
            ("Dolmetscherleistungen (Deutsch – Ukrainisch)", 500),
        ] {
            sqlx::query(
                "INSERT INTO order_leistungen (order_id, description, quantity, unit_price, vat_rate) VALUES ($1, $2, 1, $3, 19)",
            )
            .bind(order)
            .bind(description)
            .bind(price)
            .execute(pool)
            .await
            .unwrap();
        }
        // The quote of the order's services, as the wizard creates it.
        self.ok(
            "POST",
            &format!("/orders/{order}/quotes"),
            &self.ceo(),
            Some(json!({})),
        )
        .await;
        (order, number)
    }

    /// Generates one document and writes its PDF; the document id.
    async fn render(
        &self,
        notes: &mut Notes,
        name: &str,
        lead: Uuid,
        order: Option<Uuid>,
        template: &str,
        bindings: Value,
    ) -> Option<String> {
        let mut body = json!({
            "template_id": template, "lead_id": lead,
            "language": "de", "document_language": "de",
            "document_direction": "outgoing", "document_variant": "original",
            "access_category": if template.contains("cost_estimate") { "financial" } else { "patient" },
            "status": "active", "bindings": bindings,
        });
        if let Some(order) = order {
            body["order_id"] = json!(order);
        }
        let (status, generated) = self
            .call("POST", "/documents/generate", &self.ceo(), Some(body))
            .await;
        if !status.is_success() {
            notes.line(format!(
                "{name} [{template}]: {status} {}",
                short(&generated)
            ));
            assert!(!status.is_server_error(), "{name}: {status} {generated}");
            return None;
        }
        let id = generated["id"].as_str().unwrap().to_string();
        self.store(notes, name, &id).await;
        let missing = &generated["signature_details"]["missing"];
        notes.line(format!(
            "{name} [{template}]: OK {} missing={}",
            generated["document_number"].as_str().unwrap_or("-"),
            if missing.is_null() {
                "-".to_string()
            } else {
                missing.to_string()
            }
        ));
        Some(id)
    }

    async fn store(&self, notes: &mut Notes, name: &str, id: &str) {
        let request = Request::builder()
            .method("GET")
            .uri(format!("/api/v1/documents/{id}/download"))
            .header("Authorization", self.ceo())
            .body(Body::empty())
            .unwrap();
        let (status, bytes) = self.send(request).await;
        assert_eq!(status, StatusCode::OK, "download {name}");
        let path = notes.dir.join(format!("{name}.pdf"));
        std::fs::write(&path, &bytes).unwrap();
    }

    /// Every lead template; `gwg` the subjects of the identification sheet.
    async fn render_all(
        &self,
        notes: &mut Notes,
        lead: Uuid,
        order: Option<(Uuid, String)>,
        gwg: &[(&str, String)],
        minor: bool,
        enhanced: bool,
    ) {
        let order_id = order.as_ref().map(|(id, _)| *id);
        let order_number = order.as_ref().map(|(_, number)| number.clone());
        // The wizard sends the lead's own city as `party_city`; without it the
        // server reads the lead's address itself.
        let base = json!({ "order_number": order_number });
        for (name, subject) in gwg {
            let mut bindings = base.clone();
            bindings["gwg_identification"] = json!({ "subject": subject });
            self.render(
                notes,
                &format!("gwg_{name}"),
                lead,
                order_id,
                "gwg_identification",
                bindings,
            )
            .await;
        }
        let mut edd = base.clone();
        edd["aml_enhanced_due_diligence"] = json!({
            "riskTier": if enhanced { "blacklist" } else { "individual" },
            "triggeredCountries": if enhanced { json!(["IR"]) } else { json!([]) },
            "internalRiskAnalysis": true, "individualReview": true,
            "pepContractPartner": enhanced, "pepBeneficialOwner": false,
            "pepOfficeFunction": if enhanced { json!("Mitglied des Bayerischen Landtags (Mutter)") } else { Value::Null },
            "highRiskCountryTransaction": false, "highRiskCountryResident": false,
            "affectedThirdCountry": if enhanced { json!("IR") } else { Value::Null },
            "unusualComplexOrLarge": false, "unusualPattern": false, "noLawfulPurpose": false,
            "additionalContractPartnerInfo": if enhanced { json!("Vater: iranischer Staatsangehöriger, seit 2005 in Deutschland") } else { Value::Null },
            "intendedBusinessRelationshipInfo": if enhanced { json!("Organisation einer orthopädischen Zweitmeinung") } else { Value::Null },
            "contractPartnerAssetInfo": if enhanced { json!("Gehalt aus nichtselbständiger Arbeit (Nachweis liegt vor)") } else { Value::Null },
            "transactionReasons": if enhanced { json!("Behandlungskosten des Kindes") } else { Value::Null },
            "plannedAssetUse": if enhanced { json!("Vergütung GMED und Auslagen") } else { Value::Null },
            "pepAssetOrigin": if enhanced { json!("Abgeordnetenentschädigung") } else { Value::Null },
            "investigationResults": "Keine Auffälligkeiten; Nachweise plausibel.",
            "continuousMonitoring": "Jährliche Überprüfung",
            "managerApprovalName": "Dr. Konstantin Geschäftsführer",
            "riskReason": "Staatsangehörigkeit eines Hochrisikodrittstaats",
            "assetOrigin": "Gehalt aus nichtselbständiger Arbeit",
            "reviewerName": "Dr. Konstantin Geschäftsführer",
            "reviewDate": "2026-10-24"
        });
        self.render(
            notes,
            "enhanced_due_diligence",
            lead,
            None,
            "enhanced_due_diligence",
            edd,
        )
        .await;
        for template in [
            "lead_self_disclosure",
            "privacy_information",
            "confidentiality_release",
        ] {
            self.render(notes, template, lead, None, template, base.clone())
                .await;
        }
        let consents: &[&str] = if minor {
            &[
                "consent_data_release_child",
                "consent_data_release_single",
                "privacy_consents",
            ]
        } else {
            &["privacy_consents", "consent_data_release_child"]
        };
        for template in consents {
            self.render(notes, template, lead, None, template, base.clone())
                .await;
        }
        let Some(order_id) = order_id else {
            notes.line("no order: commercial documents skipped");
            return;
        };
        let mut commercial = base.clone();
        commercial["specialties"] = json!("Orthopädie");
        commercial["period_from"] = json!("2026-11-02");
        commercial["period_to"] = json!("2026-11-20");
        commercial["estimate_total"] = json!("1.785,00 €");
        commercial["service_lines"] = json!([
            { "description": "Organisation und Koordination der Behandlung",
              "quantity": "1", "fee": "1.000,00 €", "line_total": "1.000,00 €",
              "vat_rate": "19", "is_cost_passthrough": false },
            { "description": "Dolmetscherleistungen (Deutsch – Ukrainisch)",
              "quantity": "1", "fee": "500,00 €", "line_total": "500,00 €",
              "vat_rate": "19", "is_cost_passthrough": false }
        ]);
        for template in [
            "framework_contract",
            "single_order",
            "order_cost_estimate",
            "cost_estimate",
        ] {
            let bindings = if template == "cost_estimate" {
                base.clone()
            } else {
                commercial.clone()
            };
            self.render(notes, template, lead, Some(order_id), template, bindings)
                .await;
        }
        for template in [
            "cost_coverage_declaration",
            "payer_self_disclosure",
            "patient_payer_statement",
            "payer_cost_estimate",
        ] {
            self.render(
                notes,
                &format!("direct_{template}"),
                lead,
                Some(order_id),
                template,
                base.clone(),
            )
            .await;
        }
        // The payer's signature package, the way staff prepare it.
        let (status, prepared) = self
            .soft(
                notes,
                "POST",
                &format!("/leads/{lead}/payer-signature-package/prepare"),
                &self.ceo(),
                Some(json!({})),
            )
            .await;
        if status.is_success() {
            for document in prepared["package"]["documents"]
                .as_array()
                .cloned()
                .unwrap_or_default()
            {
                if let Some(id) = document["document_id"]
                    .as_str()
                    .or_else(|| document["id"].as_str())
                {
                    let slot = document["slot"].as_str().unwrap_or("slot");
                    self.store(notes, &format!("package_{slot}"), id).await;
                    notes.line(format!("package_{slot}: OK"));
                }
            }
            if prepared["package"]["documents"].is_null() {
                notes.line(format!("package: {}", short(&prepared)));
            }
        }
    }
}

// ---------------------------------------------------------------- fixtures

fn long_address() -> Value {
    json!({
        "street_address": "Große Straße der Völkerfreundschaft 123a, Hinterhaus, 3. OG links",
        "zip_code": "80331",
        "city": "München-Schwabing-Freimann",
        "country": "DE",
        "phone": "+49 89 987654321"
    })
}

fn personal(birth: &str, sex: &str, citizenships: Value) -> Value {
    let mut value = long_address();
    value["date_of_birth"] = json!(birth);
    value["legal_sex"] = json!(sex);
    value["citizenships"] = citizenships;
    value
}

fn identification(birth_place: &str, country: &str) -> Value {
    json!({ "birth_place": birth_place, "birth_country": country,
            "pep_self": false, "pep_related": false, "sanctions_links": false,
            "request_reason": "Zweitmeinung zur Knieoperation" })
}

fn parent_details(street: &str, birth: &str, citizenship: &str) -> Value {
    json!({
        "date_of_birth": birth,
        "birth_place": "Würzburg",
        "citizenships": [citizenship],
        "street": street,
        "zip": "97070",
        "city": "Würzburg",
        "country": "DE",
        "phone": "+49 931 000000"
    })
}

fn bank(holder: &str) -> Value {
    json!({ "payment_method": "bank_transfer", "account_country": "DE",
            "account_holder": holder, "bank_name": "Stadtsparkasse München",
            "via_third_party": false })
}

/// An adult lead with its own login; (lead, bearer).
async fn adult_lead(app: &Scn, first: &str, last: &str, birth: &str) -> (Uuid, String) {
    let created = app
        .ok(
            "POST",
            "/leads",
            &app.pm(),
            Some(json!({ "first_name": first, "last_name": last,
                "date_of_birth": birth, "email": unique("adult") })),
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

/// The adult cabinet up to the payer: personal data, identification, the
/// identity document, consents and the consent form's choices.
async fn adult_cabinet(
    app: &Scn,
    notes: &mut Notes,
    lead: Uuid,
    auth: &str,
    birth: &str,
    sex: &str,
) {
    let base = format!("/me/lead-requests/{lead}");
    app.consents(lead, auth).await;
    app.ok(
        "POST",
        &format!("{base}/personal-data"),
        auth,
        Some(personal(birth, sex, json!(["DE"]))),
    )
    .await;
    app.ok(
        "POST",
        &format!("{base}/identification"),
        auth,
        Some(identification("Garmisch-Partenkirchen", "DE")),
    )
    .await;
    app.ok(
        "POST",
        &format!("{base}/representation"),
        auth,
        Some(json!({ "has_representative": false })),
    )
    .await;
    app.upload(&format!("{base}/identity-document"), auth).await;
    app.consent_choices(notes, lead, auth).await;
}

async fn cabinet_missing(app: &Scn, notes: &mut Notes, lead: Uuid, auth: &str) {
    let view = app
        .ok("GET", &format!("/me/lead-requests/{lead}"), auth, None)
        .await;
    notes.line(format!(
        "cabinet missing_for_submit={}",
        view["progress"]["missing_for_submit"]
    ));
}

fn person_payer_answers() -> Value {
    json!({
        "salutation": "mr",
        "date_of_birth": "1968-08-24",
        "citizenships": ["UA"],
        "birth_place": "Харків",
        "birth_country": "UA",
        "street": "вул. Хрещатик 22, кв. 15",
        "zip": "01001",
        "city": "Київ",
        "country": "UA",
        "id_document_type": "passport",
        "id_document_number": "FA123456",
        "id_issuing_authority": "ДМС 8001",
        "id_issuing_country": "UA",
        "id_valid_until": "2032-12-31",
        "relationship_kind": "other",
        "relationship": "Onkel / дядько",
        "occupation": "Підприємець",
        "funds_sources": ["savings"],
        "pep_self": false,
        "pep_related": false,
        "high_risk_country": false,
        "sanctions_links": false,
        "payment_method": "bank_transfer",
        "account_country": "UA",
        "account_holder": "Олександр Шевченко",
        "bank_name": "ПриватБанк",
        "via_third_party": false
    })
}

async fn mark_sent(app: &Scn, lead: Uuid) {
    sqlx::query(
        "UPDATE leads SET portal_submitted_at = clock_timestamp() + interval '5 seconds' WHERE id = $1",
    )
    .bind(lead)
    .execute(app.pool())
    .await
    .unwrap();
}

/// The client's Kostenvoranschlag the payer's copy is made from.
async fn client_estimate_consent(app: &Scn, notes: &mut Notes, lead: Uuid, auth: &str) {
    app.soft(
        notes,
        "POST",
        &format!("/me/lead-requests/{lead}/payer/cost-estimate-consent"),
        auth,
        Some(json!({ "consent": true })),
    )
    .await;
}

// ---------------------------------------------------------------- scenarios

#[tokio::test]
async fn render_lead_documents_for_review() {
    let Some(app) = Scn::new().await else {
        eprintln!("GMED_LEAD_DOCS_DIR or the database is not set: nothing rendered");
        return;
    };
    scenario_a_adult_self_payer(&app).await;
    scenario_b_third_party_person_payer(&app).await;
    scenario_c_organisation_payer(&app).await;
    scenario_d_joint_custody_enhanced(&app).await;
    scenario_e_sole_custody(&app).await;
    scenario_f_vormund(&app).await;
    scenario_g_betreuer(&app).await;
    scenario_h_repeat_request(&app).await;
    scenario_i_staff_filled(&app).await;
}

async fn scenario_a_adult_self_payer(app: &Scn) {
    let mut notes = Notes::new(app, "a_adult_self_payer");
    let (lead, auth) =
        adult_lead(app, "Jürgen-Maximilian", "Weißmüller-Ößwald", "1972-02-29").await;
    adult_cabinet(app, &mut notes, lead, &auth, "1972-02-29", "male").await;
    let base = format!("/me/lead-requests/{lead}");
    app.ok(
        "POST",
        &format!("{base}/payer"),
        &auth,
        Some(json!({ "payer_kind": "self", "acts_on_own_account": true })),
    )
    .await;
    let mut billing = bank("Jürgen-Maximilian Weißmüller-Ößwald");
    billing["invoice_recipient"] = json!("self");
    app.ok("POST", &format!("{base}/billing"), &auth, Some(billing))
        .await;
    cabinet_missing(app, &mut notes, lead, &auth).await;
    app.submit(&mut notes, lead, &auth).await;
    app.identity_data(lead, None, "C4J8R2T7X").await;
    let order = app.commercial(lead).await;
    app.render_all(
        &mut notes,
        lead,
        Some(order),
        &[("patient", "contract_partner".into())],
        false,
        false,
    )
    .await;
    notes.save();
}

async fn scenario_b_third_party_person_payer(app: &Scn) {
    let mut notes = Notes::new(app, "b_third_party_person_payer_ua");
    let (lead, auth) = adult_lead(app, "Olena", "Kovalenko-Šimková", "1990-07-14").await;
    adult_cabinet(app, &mut notes, lead, &auth, "1990-07-14", "female").await;
    let base = format!("/me/lead-requests/{lead}");
    app.ok(
        "POST",
        &format!("{base}/billing"),
        &auth,
        Some(json!({ "invoice_recipient": "self" })),
    )
    .await;
    app.ok(
        "POST",
        &format!("{base}/payer"),
        &auth,
        Some(json!({
            "payer_kind": "third_party", "payer_type": "person",
            "first_name": "Олександр", "last_name": "Шевченко",
            "date_of_birth": "1968-08-24", "citizenships": ["UA"],
            "relationship_kind": "relative", "email": unique("oleksandr"),
            "contact_consent": true, "country": "UA"
        })),
    )
    .await;
    app.soft(
        &mut notes,
        "POST",
        &format!("{base}/billing"),
        &auth,
        Some(json!({ "invoice_recipient_is_payer": false })),
    )
    .await;
    client_estimate_consent(app, &mut notes, lead, &auth).await;
    cabinet_missing(app, &mut notes, lead, &auth).await;
    app.soft(
        &mut notes,
        "POST",
        &format!("{base}/submit"),
        &auth,
        Some(json!({ "declared_correct": true })),
    )
    .await;
    mark_sent(app, lead).await;
    app.payer_answers(&mut notes, lead, person_payer_answers())
        .await;
    app.identity_data(lead, None, "FB7654321").await;
    let order = app.commercial(lead).await;
    // The client's estimate first: the payer's copy is made from it.
    app.render(
        &mut notes,
        "order_cost_estimate_client",
        lead,
        Some(order.0),
        "order_cost_estimate",
        json!({ "service_lines": [
            { "description": "Organisation und Koordination der Behandlung", "quantity": "1",
              "fee": "1.000,00 €", "line_total": "1.000,00 €", "vat_rate": "19",
              "is_cost_passthrough": false,
              "note": "Medizinische Kalkulation: MRT Knie, Arthroskopie – nur für die Patientin" }
        ]}),
    )
    .await;
    app.render_all(
        &mut notes,
        lead,
        Some(order),
        &[
            ("patient", "contract_partner".into()),
            ("payer", "payer".into()),
        ],
        false,
        false,
    )
    .await;
    notes.save();
}

async fn scenario_c_organisation_payer(app: &Scn) {
    let mut notes = Notes::new(app, "c_organisation_payer");
    let (lead, auth) = adult_lead(app, "Björn", "Lindqvist-Häberle", "1985-11-30").await;
    adult_cabinet(app, &mut notes, lead, &auth, "1985-11-30", "male").await;
    let base = format!("/me/lead-requests/{lead}");
    app.ok(
        "POST",
        &format!("{base}/billing"),
        &auth,
        Some(json!({ "invoice_recipient": "self" })),
    )
    .await;
    app.ok(
        "POST",
        &format!("{base}/payer"),
        &auth,
        Some(json!({
            "payer_kind": "third_party", "payer_type": "company",
            "organisation_name": "Müller & Söhne Präzisionstechnik GmbH & Co. KG – Niederlassung Süd",
            "country": "DE", "relationship_kind": "employer", "email": unique("kasse"),
            "contact_consent": true
        })),
    )
    .await;
    app.soft(
        &mut notes,
        "POST",
        &format!("{base}/billing"),
        &auth,
        Some(json!({ "invoice_recipient_is_payer": false })),
    )
    .await;
    client_estimate_consent(app, &mut notes, lead, &auth).await;
    cabinet_missing(app, &mut notes, lead, &auth).await;
    app.soft(
        &mut notes,
        "POST",
        &format!("{base}/submit"),
        &auth,
        Some(json!({ "declared_correct": true })),
    )
    .await;
    mark_sent(app, lead).await;
    let owner = |first: &str, last: &str, share: u32| {
        json!({ "first_name": first, "last_name": last, "date_of_birth": "1961-02-03",
                "country": "DE", "share_percent": share })
    };
    app.payer_answers(
        &mut notes,
        lead,
        json!({
            "legal_form": "GmbH & Co. KG",
            "register_court": "Amtsgericht München",
            "register_number": "HRA 123456",
            "street": "Industriestraße 147–149, Gebäude C", "zip": "85748", "city": "Garching b. München",
            "industry": "Maschinenbau",
            "representative_first_name": "Hans-Dieter",
            "representative_last_name": "Müller",
            "representative_role": "Geschäftsführer der Komplementär-GmbH",
            "beneficial_owners": [owner("Hans-Dieter", "Müller", 60), owner("Käthe", "Müller", 40)],
            "funds_sources": ["business_revenue"],
            "pep_self": false, "pep_related": false, "sanctions_links": false,
            "payment_method": "bank_transfer", "account_country": "DE",
            "account_holder": "Müller & Söhne Präzisionstechnik GmbH & Co. KG",
            "bank_name": "Bayerische Landesbank",
            "via_third_party": false,
            "id_document_type": "id_card", "id_document_number": "L01X00T47",
            "id_issuing_authority": "Stadt Garching", "id_issuing_country": "DE",
            "id_valid_until": "2099-12-31",
            "payment_reason": "Arbeitgeberleistung (betriebliche Gesundheitsförderung)"
        }),
    )
    .await;
    app.identity_data(lead, None, "C9K3M5P1Z").await;
    let order = app.commercial(lead).await;
    app.render(
        &mut notes,
        "order_cost_estimate_client",
        lead,
        Some(order.0),
        "order_cost_estimate",
        json!({}),
    )
    .await;
    app.render_all(
        &mut notes,
        lead,
        Some(order),
        &[
            ("patient", "contract_partner".into()),
            ("payer_legal_entity", "payer".into()),
        ],
        false,
        false,
    )
    .await;
    notes.save();
}

/// A minor lead with the trusted contacts staff named.
async fn minor_lead(app: &Scn, first: &str, last: &str, birth: &str, contacts: Value) -> Uuid {
    let created = app
        .ok(
            "POST",
            "/leads",
            &app.pm(),
            Some(
                json!({ "first_name": first, "last_name": last, "date_of_birth": birth,
                "email": unique("minor"), "trusted_contacts": contacts }),
            ),
        )
        .await;
    created["id"].as_str().unwrap().parse().unwrap()
}

async fn scenario_d_joint_custody_enhanced(app: &Scn) {
    let mut notes = Notes::new(app, "d_minor_joint_custody_enhanced");
    let (mother, father) = (Uuid::new_v4(), Uuid::new_v4());
    let father_email = unique("dariush");
    let lead = minor_lead(
        app,
        "Sophie-Charlotte",
        "Rahimi-Großkopf",
        "2015-06-01",
        json!([
            { "id": mother, "name": "Anna-Lena Großkopf", "relation": "mother",
              "email": unique("anna"), "phone": "+49 931 000001" },
            { "id": father, "name": "Dariush Rahimi", "relation": "father",
              "email": father_email, "phone": "+49 931 000002" }
        ]),
    )
    .await;
    let anna = app.guardian_access(lead, mother).await;
    let base = format!("/me/lead-requests/{lead}");
    app.consents(lead, &anna).await;
    let mut child = personal("2015-06-01", "female", json!(["DE", "IR"]));
    child["street_address"] = json!("Am Hubland 17, Zimmer 3");
    for (part, body) in [
        ("personal-data", child),
        ("representation", json!({ "custody": "joint" })),
        ("identification", identification("Würzburg", "DE")),
    ] {
        app.ok("POST", &format!("{base}/{part}"), &anna, Some(body))
            .await;
    }
    app.ok(
        "POST",
        &format!("{base}/representatives/{mother}"),
        &anna,
        Some(parent_details("Am Hubland 17", "1986-03-02", "DE")),
    )
    .await;
    let mut father_details = parent_details("Sanderstraße 4, 2. OG", "1981-04-06", "IR");
    father_details
        .as_object_mut()
        .unwrap()
        .remove("date_of_birth");
    app.ok(
        "POST",
        &format!("{base}/representatives/{father}"),
        &anna,
        Some(father_details),
    )
    .await;
    for path in [
        format!("{base}/identity-document"),
        format!("{base}/representatives/{mother}/identity-document"),
        format!("{base}/representatives/{father}/identity-document"),
    ] {
        app.upload(&path, &anna).await;
    }
    app.ok(
        "POST",
        &format!("{base}/billing"),
        &anna,
        Some(json!({ "invoice_recipient": "self" })),
    )
    .await;
    app.ok(
        "POST",
        &format!("{base}/payer"),
        &anna,
        Some(json!({
            "payer_kind": "third_party", "payer_type": "person", "relationship_kind": "parent",
            "first_name": "Dariush", "last_name": "Rahimi", "date_of_birth": "1981-04-06",
            "email": father_email, "citizenships": ["IR"], "country": "DE"
        })),
    )
    .await;
    app.ok(
        "POST",
        &format!("{base}/billing"),
        &anna,
        Some(json!({ "invoice_recipient_is_payer": false })),
    )
    .await;
    app.ok(
        "POST",
        &format!("{base}/billing"),
        &anna,
        Some(bank("Dariush Rahimi")),
    )
    .await;
    app.consent_choices(&mut notes, lead, &anna).await;
    // The father's block R; the mother's own PEP answer is "yes".
    app.soft(
        &mut notes,
        "POST",
        &format!("{base}/representatives/{father}/country-questions"),
        &anna,
        Some(json!({ "birth_place": "Teheran", "birth_country": "IR",
            "residence_since": "2005", "stay_reason": "family",
            "pep_self": false, "pep_related": false, "sanctions_links": false })),
    )
    .await;
    app.soft(
        &mut notes,
        "POST",
        &format!("{base}/representatives/{mother}/country-questions"),
        &anna,
        Some(json!({ "birth_place": "Würzburg", "birth_country": "DE",
            "residence_since": "1986", "stay_reason": "family",
            "pep_self": true, "pep_related": false,
            "pep_office": "Mitglied des Bayerischen Landtags", "pep_country": "DE",
            "pep_period": "2018–2023", "pep_wealth_origin": "Abgeordnetenentschädigung",
            "sanctions_links": false })),
    )
    .await;
    // The follow-up blocks the enhanced check asks before sending.
    app.soft(
        &mut notes,
        "POST",
        &format!("{base}/enhanced-details"),
        &anna,
        Some(json!({ "occupation": "Schülerin", "sector": "Schule / Bildung" })),
    )
    .await;
    app.soft(
        &mut notes,
        "POST",
        &format!("{base}/identification"),
        &anna,
        Some(json!({ "residence_since": "2015", "stay_reason": "family" })),
    )
    .await;
    // Block L, as the cabinet sends it: the answer of the payer section
    // (`acts_on_own_account` with the payer), not a statement.
    app.soft(
        &mut notes,
        "POST",
        &format!("{base}/payer"),
        &anna,
        Some(json!({
            "payer_kind": "third_party", "payer_type": "person", "relationship_kind": "parent",
            "first_name": "Dariush", "last_name": "Rahimi", "date_of_birth": "1981-04-06",
            "email": father_email, "citizenships": ["IR"], "country": "DE",
            "acts_on_own_account": true
        })),
    )
    .await;
    let view = app
        .ok("GET", &format!("/me/lead-requests/{lead}"), &anna, None)
        .await;
    notes.line(format!("follow_up={}", short(&view["follow_up"])));
    cabinet_missing(app, &mut notes, lead, &anna).await;
    app.soft(
        &mut notes,
        "POST",
        &format!("{base}/submit"),
        &anna,
        Some(json!({ "declared_correct": true })),
    )
    .await;
    // The father answers the payer questions with the source of funds.
    let ben = app.guardian_access(lead, father).await;
    let section = format!("{base}/payer-questionnaire");
    app.soft(
        &mut notes,
        "POST",
        &format!("{base}/representatives/{father}"),
        &ben,
        Some(json!({ "date_of_birth": "1981-04-06" })),
    )
    .await;
    app.soft(
        &mut notes,
        "POST",
        &format!("{section}/consent"),
        &ben,
        Some(json!({ "acknowledged": true, "contact_channels": ["email"] })),
    )
    .await;
    app.soft(
        &mut notes,
        "POST",
        &section,
        &ben,
        Some(json!({ "salutation": "mr", "occupation": "Bauingenieur",
            "funds_sources": ["employment"], "pep_self": false, "pep_related": false,
            "sanctions_links": false })),
    )
    .await;
    let (status, body) = app
        .upload_with(
            &format!("{section}/funds-proof"),
            &[("Authorization", &ben)],
        )
        .await;
    if status != StatusCode::CREATED {
        notes.line(format!("funds proof: {status} {}", short(&body)));
    }
    app.soft(
        &mut notes,
        "POST",
        &format!("{section}/submit"),
        &ben,
        Some(json!({ "declared_correct": true })),
    )
    .await;
    // The father completed his own data after the mother sent: she sends
    // the changed request again, as the cabinet asks.
    app.submit(&mut notes, lead, &anna).await;
    app.identity_data(lead, Some(mother), "C01X00T47").await;
    app.identity_data(lead, Some(father), "C02X00T48").await;
    let enhanced = app
        .ok(
            "GET",
            &format!("/leads/{lead}/enhanced-check"),
            &app.pm(),
            None,
        )
        .await;
    notes.line(format!(
        "enhanced-check required={} reasons={}",
        enhanced["required"], enhanced["reasons"]
    ));
    let order = app.commercial(lead).await;
    app.render(
        &mut notes,
        "order_cost_estimate_client",
        lead,
        Some(order.0),
        "order_cost_estimate",
        json!({}),
    )
    .await;
    app.render_all(
        &mut notes,
        lead,
        Some(order),
        &[
            ("mother", format!("representative:{mother}")),
            ("father", format!("representative:{father}")),
            ("payer", "payer".into()),
            ("child_contract_partner", "contract_partner".into()),
        ],
        true,
        true,
    )
    .await;
    notes.save();
}

async fn scenario_e_sole_custody(app: &Scn) {
    let mut notes = Notes::new(app, "e_minor_sole_custody");
    let mother = Uuid::new_v4();
    let lead = minor_lead(
        app,
        "Myroslava",
        "Bondarenko",
        "2012-12-24",
        json!([{ "id": mother, "name": "Nataliia Bondarenko", "relation": "mother",
                 "email": unique("natalia"), "phone": "+380 44 0000001" }]),
    )
    .await;
    let natalia = app.guardian_access(lead, mother).await;
    let base = format!("/me/lead-requests/{lead}");
    app.consents(lead, &natalia).await;
    let mut child = personal("2012-12-24", "female", json!(["UA"]));
    child["street_address"] = json!("Leopoldstraße 250, c/o Familie Huber-Schönberger");
    for (part, body) in [
        ("personal-data", child),
        ("representation", json!({ "custody": "sole_parent" })),
        ("identification", identification("Львів", "UA")),
    ] {
        app.ok("POST", &format!("{base}/{part}"), &natalia, Some(body))
            .await;
    }
    let mut details = parent_details("Leopoldstraße 250", "1984-09-09", "UA");
    details["birth_place"] = json!("Одеса");
    app.ok(
        "POST",
        &format!("{base}/representatives/{mother}"),
        &natalia,
        Some(details),
    )
    .await;
    for path in [
        format!("{base}/identity-document"),
        format!("{base}/representatives/{mother}/identity-document"),
    ] {
        app.upload(&path, &natalia).await;
    }
    app.ok(
        "POST",
        &format!("{base}/billing"),
        &natalia,
        Some(json!({ "invoice_recipient": "self" })),
    )
    .await;
    app.soft(
        &mut notes,
        "POST",
        &format!("{base}/billing"),
        &natalia,
        Some(bank("Nataliia Bondarenko")),
    )
    .await;
    app.consent_choices(&mut notes, lead, &natalia).await;
    cabinet_missing(app, &mut notes, lead, &natalia).await;
    app.soft(
        &mut notes,
        "POST",
        &format!("{base}/submit"),
        &natalia,
        Some(json!({ "declared_correct": true })),
    )
    .await;
    app.identity_data(lead, Some(mother), "FE1234567").await;
    let order = app.commercial(lead).await;
    app.render_all(
        &mut notes,
        lead,
        Some(order),
        &[
            ("mother", format!("representative:{mother}")),
            ("payer", "payer".into()),
        ],
        true,
        false,
    )
    .await;
    notes.save();
}

async fn scenario_f_vormund(app: &Scn) {
    let mut notes = Notes::new(app, "f_minor_vormund");
    let guardian = Uuid::new_v4();
    let lead = minor_lead(app, "Lina-Marie", "Österreicher", "2014-02-03", json!([])).await;
    app.ok(
        "POST",
        &format!("/leads/{lead}/representation"),
        &app.pm(),
        Some(json!({ "custody": "guardian" })),
    )
    .await;
    app.ok(
        "POST",
        &format!("/leads/{lead}/update"),
        &app.pm(),
        Some(json!({ "trusted_contacts": [
            { "id": guardian, "name": "Greta von Hohenzollern-Sigmaringen", "relation": "guardian",
              "email": unique("greta"), "phone": "+49 30 000003" }
        ] })),
    )
    .await;
    let greta = app.guardian_access(lead, guardian).await;
    let base = format!("/me/lead-requests/{lead}");
    app.consents(lead, &greta).await;
    for (part, body) in [
        (
            "personal-data".to_string(),
            personal("2014-02-03", "female", json!(["DE", "AT"])),
        ),
        (
            "identification".to_string(),
            identification("Salzburg", "AT"),
        ),
        (
            format!("representatives/{guardian}"),
            parent_details("Jugendamtstraße 3", "1975-05-06", "DE"),
        ),
        (
            "billing".to_string(),
            json!({ "invoice_recipient": "self" }),
        ),
    ] {
        app.ok("POST", &format!("{base}/{part}"), &greta, Some(body))
            .await;
    }
    for path in [
        format!("{base}/identity-document"),
        format!("{base}/representatives/{guardian}/identity-document"),
        format!("{base}/representatives/{guardian}/authority-document"),
    ] {
        app.upload(&path, &greta).await;
    }
    app.soft(
        &mut notes,
        "POST",
        &format!("{base}/billing"),
        &greta,
        Some(bank("Greta von Hohenzollern-Sigmaringen")),
    )
    .await;
    app.consent_choices(&mut notes, lead, &greta).await;
    cabinet_missing(app, &mut notes, lead, &greta).await;
    app.soft(
        &mut notes,
        "POST",
        &format!("{base}/submit"),
        &greta,
        Some(json!({ "declared_correct": true })),
    )
    .await;
    app.identity_data(lead, Some(guardian), "C03X00T49").await;
    let order = app.commercial(lead).await;
    app.render_all(
        &mut notes,
        lead,
        Some(order),
        &[
            ("vormund", format!("representative:{guardian}")),
            ("child_contract_partner", "contract_partner".into()),
        ],
        true,
        false,
    )
    .await;
    notes.save();
}

async fn scenario_g_betreuer(app: &Scn) {
    let mut notes = Notes::new(app, "g_adult_betreuer");
    let (lead, karl) = adult_lead(app, "Karl-Heinz", "Großmann", "1950-01-02").await;
    let base = format!("/me/lead-requests/{lead}");
    app.consents(lead, &karl).await;
    let betreuer = Uuid::new_v4();
    let mut billing = bank("Karl-Heinz Großmann");
    billing["invoice_recipient"] = json!("self");
    for (part, body) in [
        (
            "personal-data".to_string(),
            personal("1950-01-02", "male", json!(["DE"])),
        ),
        (
            "payer".to_string(),
            json!({ "payer_kind": "self", "acts_on_own_account": true }),
        ),
        ("billing".to_string(), billing),
        (
            "identification".to_string(),
            identification("Königsberg (Preußen)", "RU"),
        ),
        (
            "representation".to_string(),
            json!({ "has_representative": true, "under_guardianship": true }),
        ),
    ] {
        app.ok("POST", &format!("{base}/{part}"), &karl, Some(body))
            .await;
    }
    app.ok(
        "POST",
        &format!("{base}/representatives/{betreuer}"),
        &karl,
        Some(
            json!({ "role": "legal_guardian", "first_name": "Bernd-Ulrich",
            "last_name": "Betreuer-Schäfer", "date_of_birth": "1970-07-08",
            "street": "Betreuungsweg 4, Büro 12", "zip": "80333", "city": "München",
            "country": "DE", "email": unique("bernd") }),
        ),
    )
    .await;
    for path in [
        format!("{base}/identity-document"),
        format!("{base}/representatives/{betreuer}/identity-document"),
        format!("{base}/representatives/{betreuer}/authority-document"),
    ] {
        app.upload(&path, &karl).await;
    }
    app.consent_choices(&mut notes, lead, &karl).await;
    cabinet_missing(app, &mut notes, lead, &karl).await;
    app.submit(&mut notes, lead, &karl).await;
    app.identity_data(lead, None, "L01X00T11").await;
    app.identity_data(lead, Some(betreuer), "L01X00T47").await;
    let order = app.commercial(lead).await;
    app.render_all(
        &mut notes,
        lead,
        Some(order),
        &[
            ("patient", "contract_partner".into()),
            ("betreuer", format!("representative:{betreuer}")),
        ],
        false,
        false,
    )
    .await;
    notes.save();
}

async fn scenario_h_repeat_request(app: &Scn) {
    let mut notes = Notes::new(app, "h_repeat_request");
    let pool = app.pool();
    let patient: Uuid = sqlx::query_scalar(
        r#"INSERT INTO patients (patient_id, first_name, last_name, birth_date, gender, email,
                                 phone_primary, address_street, address_zip, address_city,
                                 address_country, lifecycle_status, created_by, languages)
           VALUES ($1, 'Olena', 'Muster-Петренко', DATE '1980-05-06', 'female', $2, '+380 44 0000000',
                   'Khreshchatyk 1, kv. 25', '01001', 'Kyiv', 'Ukraine', 'active', $3, ARRAY['uk'])
           RETURNING id"#,
    )
    .bind(format!("P-RND-{}", &Uuid::new_v4().simple().to_string()[..8]))
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
    sqlx::query(
        r#"INSERT INTO framework_contracts (patient_id, contract_number, signed_at, status, created_by)
           VALUES ($1, $2, now() - interval '200 days', 'signed', $3)"#,
    )
    .bind(patient)
    .bind(format!("RV-OLD-{}", &Uuid::new_v4().simple().to_string()[..6]))
    .bind(app.ceo_id)
    .execute(pool)
    .await
    .unwrap();
    let created = app
        .ok(
            "POST",
            "/leads",
            &app.pm(),
            Some(
                json!({ "first_name": "Olena", "last_name": "Muster-Петренко",
                "repeat_patient_id": patient, "creation_key": Uuid::new_v4() }),
            ),
        )
        .await;
    let lead: Uuid = created["id"].as_str().unwrap().parse().unwrap();
    notes.line(format!(
        "portal_account={}",
        short(&created["portal_account"])
    ));
    app.identity_data(lead, None, "FC7777777").await;
    let order = app.commercial(lead).await;
    app.render_all(
        &mut notes,
        lead,
        Some(order),
        &[("patient", "contract_partner".into())],
        false,
        false,
    )
    .await;
    notes.save();
}

async fn scenario_i_staff_filled(app: &Scn) {
    let mut notes = Notes::new(app, "i_staff_filled");
    let created = app
        .ok(
            "POST",
            "/leads",
            &app.pm(),
            Some(
                json!({ "first_name": "Zoë-Élise", "last_name": "Dubois-Schäuble",
                "date_of_birth": "1979-09-09", "email": unique("zoe"),
                "phone": "+33 1 23456789", "country": "FR", "citizenships": ["FR", "DE"] }),
            ),
        )
        .await;
    let lead: Uuid = created["id"].as_str().unwrap().parse().unwrap();
    app.ok(
        "POST",
        &format!("/leads/{lead}/update"),
        &app.pm(),
        Some(json!({
            "street_address": "12, Rue du Faubourg Saint-Honoré, Bâtiment B, Escalier 3",
            "zip_code": "75008", "city": "Paris", "country": "FR", "legal_sex": "female",
            "primary_language": "de",
            "primary_concern_text": "Kardiologische Abklärung (Herzrhythmusstörungen)"
        })),
    )
    .await;
    app.soft(
        &mut notes,
        "POST",
        &format!("/leads/{lead}/payer-declaration"),
        &app.pm(),
        Some(json!({ "payer_kind": "self" })),
    )
    .await;
    app.identity_data(lead, None, "19AB12345").await;
    let order = app.commercial(lead).await;
    app.render_all(
        &mut notes,
        lead,
        Some(order),
        &[("patient", "contract_partner".into())],
        false,
        false,
    )
    .await;
    notes.save();
}
