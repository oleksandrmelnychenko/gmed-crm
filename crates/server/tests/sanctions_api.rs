//! EU sanctions list screening and the blocked-country policy: list upload,
//! live check, hits, CEO decisions, the server-side gates and retention.
//!
//! The list is a tiny synthetic file in the FSF 1.1 layout; every name in it is
//! invented.

mod support;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use serde_json::{Value, json};
use sqlx::PgPool;
use tower::ServiceExt;
use uuid::Uuid;

use gmed_server::auth::jwt;

const TEST_SECRET: &str = "test-secret-at-least-32-characters-long!!";
const SYNTHETIC_LIST: &str = include_str!("../src/sanctions/testdata/synthetic_fsf_1_1.xml");
/// The next list version: the same entries and two invented listed banks.
const SYNTHETIC_BANK_LIST: &str =
    include_str!("../src/sanctions/testdata/synthetic_fsf_1_1_banks.xml");

struct TestApp {
    suite: support::TestSuiteContext,
    ceo_id: Uuid,
    pm_id: Uuid,
    sales_id: Uuid,
    it_admin_id: Uuid,
}

impl TestApp {
    fn bearer(&self, user_id: Uuid, role: &str) -> String {
        let token = jwt::issue_access_token(TEST_SECRET, user_id, role, Uuid::new_v4()).unwrap();
        format!("Bearer {token}")
    }
    fn ceo(&self) -> String {
        self.bearer(self.ceo_id, "ceo")
    }
    fn pm(&self) -> String {
        self.bearer(self.pm_id, "patient_manager")
    }
    fn sales(&self) -> String {
        self.bearer(self.sales_id, "sales")
    }
    fn it_admin(&self) -> String {
        self.bearer(self.it_admin_id, "it_admin")
    }
    fn pool(&self) -> &PgPool {
        &self.suite.pool
    }
}

async fn seed_user(pool: &PgPool, role: &str, name: &str) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO users (email, password_hash, name, role)
           VALUES ($1, 'test-password-hash', $2, $3)
           RETURNING id"#,
    )
    .bind(format!(
        "sanctions-{role}-{}@example.com",
        Uuid::new_v4().simple()
    ))
    .bind(name)
    .bind(role)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn test_app() -> Option<TestApp> {
    let suite = support::suite_context(TEST_SECRET).await?;
    let ceo_id = seed_user(&suite.pool, "ceo", "Clara Chefin").await;
    let pm_id = seed_user(&suite.pool, "patient_manager", "Paula Manager").await;
    let sales_id = seed_user(&suite.pool, "sales", "Sam Sales").await;
    let it_admin_id = seed_user(&suite.pool, "it_admin", "Ivo Admin").await;
    Some(TestApp {
        suite,
        ceo_id,
        pm_id,
        sales_id,
        it_admin_id,
    })
}

async fn request(
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
    let req = Request::builder()
        .method(method)
        .uri(format!("/api/v1{path}"))
        .header("Authorization", bearer)
        .header("Content-Type", "application/json")
        .body(body)
        .unwrap();
    let response = app.suite.app.clone().oneshot(req).await.unwrap();
    let status = response.status();
    let bytes = axum::body::to_bytes(response.into_body(), 4 * 1024 * 1024)
        .await
        .unwrap();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}

async fn upload_list(app: &TestApp, bearer: &str, xml: &str) -> (StatusCode, Value) {
    let boundary = format!("----gmed-sanctions-{}", Uuid::new_v4().simple());
    let body = format!(
        "--{boundary}\r\n\
Content-Disposition: form-data; name=\"file\"; filename=\"FULL-1_1.xml\"\r\n\
Content-Type: application/xml\r\n\r\n\
{xml}\r\n\
--{boundary}--\r\n"
    );
    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/sanctions/list/upload")
        .header("Authorization", bearer)
        .header(
            "Content-Type",
            format!("multipart/form-data; boundary={boundary}"),
        )
        .body(Body::from(body))
        .unwrap();
    let response = app.suite.app.clone().oneshot(req).await.unwrap();
    let status = response.status();
    let bytes = axum::body::to_bytes(response.into_body(), 1024 * 1024)
        .await
        .unwrap();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}

async fn insert_lead(
    app: &TestApp,
    first_name: &str,
    last_name: &str,
    date_of_birth: Option<&str>,
    citizenships: &[&str],
    trusted_contacts: Value,
) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO leads (first_name, last_name, date_of_birth, citizenships,
                              trusted_contacts, email, created_by)
           VALUES ($1, $2, $3::date, $4, $5, $6, $7)
           RETURNING id"#,
    )
    .bind(first_name)
    .bind(last_name)
    .bind(date_of_birth)
    .bind(
        citizenships
            .iter()
            .map(|code| code.to_string())
            .collect::<Vec<_>>(),
    )
    .bind(trusted_contacts)
    .bind(format!("lead-{}@example.com", Uuid::new_v4().simple()))
    .bind(app.pm_id)
    .fetch_one(app.pool())
    .await
    .unwrap()
}

async fn lead_status(app: &TestApp, lead_id: Uuid) -> Value {
    let (status, body) = request(
        app,
        "GET",
        &format!("/sanctions/leads/{lead_id}/status"),
        &app.pm(),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    body
}

/// The lead's enhanced check (owner rule 2026-10-07) as staff read it.
async fn enhanced_check(app: &TestApp, lead_id: Uuid) -> Value {
    let (status, body) = request(
        app,
        "GET",
        &format!("/leads/{lead_id}/enhanced-check"),
        &app.pm(),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    body
}

async fn open_hits(app: &TestApp) -> Vec<Value> {
    let (status, body) = request(app, "GET", "/sanctions/hits?status=open", &app.ceo(), None).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    body["hits"].as_array().unwrap().clone()
}

async fn load_synthetic_list(app: &TestApp) {
    let (status, body) = upload_list(app, &app.ceo(), SYNTHETIC_LIST).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["outcome"]["result"], "imported");
    assert_eq!(body["outcome"]["entries"], 3);
    assert_eq!(body["outcome"]["list_date"], "2026-09-30");
}

#[tokio::test]
async fn list_upload_and_live_check() {
    let Some(app) = test_app().await else {
        return;
    };

    // Before any list: the live check says so instead of "clear".
    let (status, body) = request(
        &app,
        "POST",
        "/sanctions/check",
        &app.sales(),
        Some(json!({ "first_name": "Testomir", "last_name": "Korneev" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["status"], "unavailable");

    // Only the CEO uploads the list; wrong files keep nothing.
    let (status, _) = upload_list(&app, &app.pm(), SYNTHETIC_LIST).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, body) = upload_list(&app, &app.ceo(), "<rss><channel/></rss>").await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
    assert_eq!(body["error"], "list_format");
    load_synthetic_list(&app).await;
    // The same file again is not a new version.
    let (status, body) = upload_list(&app, &app.ceo(), SYNTHETIC_LIST).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["outcome"]["result"], "unchanged");

    let (status, body) = request(&app, "GET", "/sanctions/list", &app.ceo(), None).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["list"]["active"]["entry_count"], 3);
    assert_eq!(body["list"]["active"]["source"], "upload");
    assert_eq!(body["list"]["active"]["imported_by_name"], "Clara Chefin");
    assert_eq!(body["blocked_countries"], json!(["RU"]));
    let (status, _) = request(&app, "GET", "/sanctions/list", &app.pm(), None).await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    // Transliteration variants match; the answer has no list details.
    for (first, last) in [
        ("Testomir", "Korneev"),
        ("Testomir", "Kornejew"),
        ("Тестомир", "Корнеев"),
    ] {
        let (status, body) = request(
            &app,
            "POST",
            "/sanctions/check",
            &app.sales(),
            Some(json!({ "first_name": first, "last_name": last })),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{body}");
        assert_eq!(body["status"], "possible_match", "{first} {last}");
        assert_eq!(body["list_version_date"], "2026-09-30");
        assert_eq!(body.as_object().unwrap().len(), 2, "{body}");
    }
    let (_, body) = request(
        &app,
        "POST",
        "/sanctions/check",
        &app.pm(),
        Some(
            json!({ "first_name": "Anna", "last_name": "Beispiel", "date_of_birth": "1990-01-01" }),
        ),
    )
    .await;
    assert_eq!(body["status"], "clear");
    // A contradicting birth date clears a common name.
    let (_, body) = request(
        &app,
        "POST",
        "/sanctions/check",
        &app.pm(),
        Some(json!({ "first_name": "Testomir", "last_name": "Korneev", "date_of_birth": "1999-05-05" })),
    )
    .await;
    assert_eq!(body["status"], "clear");

    // The upload is audited.
    let audited: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM audit_log WHERE action = 'sanctions_list_imported'",
    )
    .fetch_one(app.pool())
    .await
    .unwrap();
    assert_eq!(audited, 1);
}

#[tokio::test]
async fn possible_match_blocks_until_the_ceo_decides_and_confirmation_is_final() {
    let Some(app) = test_app().await else {
        return;
    };
    load_synthetic_list(&app).await;
    let lead_id = insert_lead(
        &app,
        "Testomir",
        "Korneev",
        Some("1961-11-30"),
        &[],
        json!([]),
    )
    .await;
    // An order created before the screening ran.
    let (code, order) = request(
        &app,
        "POST",
        "/orders",
        &app.pm(),
        Some(json!({ "source_lead_id": lead_id })),
    )
    .await;
    assert_eq!(code, StatusCode::CREATED, "{order}");
    let order_id = order["id"].as_str().unwrap().to_string();

    // The trigger queued the lead; the status call screens it.
    let status = lead_status(&app, lead_id).await;
    assert_eq!(status["screening"], "review_pending", "{status}");
    assert_eq!(status["open_hits"], 1);
    assert_eq!(
        status["sanctions_block"]["code"],
        "sanctions_review_pending"
    );
    assert_eq!(status["can_review"], false);
    // An open possible match is named but does not require the enhanced
    // check (owner rule 2026-10-07).
    assert_eq!(
        enhanced_check(&app, lead_id).await,
        json!({ "required": false, "reasons": ["sanctions_review_pending"], "countries": [] })
    );

    // The CEO is told, without the person's name in the notification.
    let notification: (String, String) = sqlx::query_as(
        "SELECT title, COALESCE(body, '') FROM user_notifications WHERE user_id = $1 AND kind = 'sanctions_possible_match'",
    )
    .bind(app.ceo_id)
    .fetch_one(app.pool())
    .await
    .unwrap();
    assert!(!notification.0.contains("Korneev") && !notification.1.contains("Korneev"));

    // Open hit: qualification, conversion and order/contract work are blocked.
    let (code, body) = request(
        &app,
        "POST",
        &format!("/leads/{lead_id}/qualify"),
        &app.pm(),
        Some(json!({ "status": "qualified" })),
    )
    .await;
    assert_eq!(code, StatusCode::CONFLICT, "{body}");
    assert_eq!(body["error"], "sanctions_review_pending");
    let (code, body) = request(
        &app,
        "POST",
        &format!("/leads/{lead_id}/convert"),
        &app.pm(),
        Some(json!({})),
    )
    .await;
    assert_eq!(code, StatusCode::CONFLICT, "{body}");
    let (code, body) = request(
        &app,
        "POST",
        "/orders",
        &app.pm(),
        Some(json!({ "source_lead_id": lead_id })),
    )
    .await;
    assert_eq!(code, StatusCode::CONFLICT, "{body}");
    assert_eq!(body["error"], "sanctions_review_pending");
    // Work on the existing order stops too; cancelling it stays possible.
    let (code, body) = request(
        &app,
        "POST",
        &format!("/orders/{order_id}/commercial-basis"),
        &app.pm(),
        Some(json!({ "needs_description": "Check-up" })),
    )
    .await;
    assert_eq!(code, StatusCode::CONFLICT, "{body}");
    let (_, body) = request(
        &app,
        "POST",
        &format!("/orders/{order_id}/status"),
        &app.pm(),
        Some(json!({ "status": "cancelled" })),
    )
    .await;
    assert!(not_a_gate_block(&body), "{body}");
    // Moving the lead to "in progress" is not qualification and passes the gate.
    let (_, body) = request(
        &app,
        "POST",
        &format!("/leads/{lead_id}/qualify"),
        &app.pm(),
        Some(json!({ "status": "in_progress" })),
    )
    .await;
    assert!(not_a_gate_block(&body), "{body}");
    // The client's signature of the patient form waits too: on paper and when
    // staff confirm it ("Подтвердить подпись", QA 2026-10-10 C3-e).
    let patient_form = insert_patient_form(&app, lead_id).await;
    for route in ["paper-signature", "mark-signed"] {
        let (code, body) = request(
            &app,
            "POST",
            &format!("/documents/{patient_form}/{route}"),
            &app.pm(),
            Some(json!({ "compliance_kind": "other" })),
        )
        .await;
        assert_eq!(code, StatusCode::CONFLICT, "{route}: {body}");
        assert_eq!(body["error"], "sanctions_review_pending", "{route}");
    }
    // The DSGVO consent and the identity document are never held.
    assert_consent_and_identity_free(&app, lead_id).await;

    // Only the CEO sees the hits; the comparison carries the list entry.
    let (code, _) = request(&app, "GET", "/sanctions/hits", &app.pm(), None).await;
    assert_eq!(code, StatusCode::FORBIDDEN);
    let hits = open_hits(&app).await;
    assert_eq!(hits.len(), 1);
    let hit = &hits[0];
    assert_eq!(hit["subject_kind"], "lead_patient");
    assert_eq!(hit["match_details"]["dob"], "year");
    assert_eq!(hit["list_entry"]["eu_reference"], "EU.9001.01");
    assert_eq!(hit["list_entry"]["regulations"][0]["programme"], "UKR");
    assert!(
        hit["list_entry"]["regulations"][0]["url"]
            .as_str()
            .unwrap()
            .starts_with("https://eur-lex.europa.eu/")
    );
    assert_eq!(hit["current_subject"]["last_name"], "Korneev");
    let hit_id = hit["id"].as_str().unwrap().to_string();

    // A decision needs a reason; the PM cannot decide.
    let (code, _) = request(
        &app,
        "POST",
        &format!("/sanctions/hits/{hit_id}/decision"),
        &app.pm(),
        Some(json!({ "decision": "false_positive", "reason": "Different person entirely" })),
    )
    .await;
    assert_eq!(code, StatusCode::FORBIDDEN);
    let (code, body) = request(
        &app,
        "POST",
        &format!("/sanctions/hits/{hit_id}/decision"),
        &app.ceo(),
        Some(json!({ "decision": "false_positive", "reason": "short" })),
    )
    .await;
    assert_eq!(code, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
    let (code, body) = request(
        &app,
        "POST",
        &format!("/sanctions/hits/{hit_id}/decision"),
        &app.ceo(),
        Some(json!({ "decision": "false_positive", "reason": "Born in another city, passport checked" })),
    )
    .await;
    assert_eq!(code, StatusCode::OK, "{body}");
    assert_eq!(body["status"], "false_positive");
    assert_eq!(body["decided_by_name"], "Clara Chefin");

    // False positive unblocks; re-screening with the same data keeps it closed.
    let status = lead_status(&app, lead_id).await;
    assert_eq!(status["screening"], "clear", "{status}");
    assert_eq!(enhanced_check(&app, lead_id).await["reasons"], json!([]));
    let (_, body) = request(
        &app,
        "POST",
        &format!("/leads/{lead_id}/qualify"),
        &app.pm(),
        Some(json!({ "status": "qualified" })),
    )
    .await;
    assert!(not_a_gate_block(&body), "{body}");
    let (_, body) = request(
        &app,
        "POST",
        &format!("/documents/{patient_form}/mark-signed"),
        &app.pm(),
        Some(json!({ "compliance_kind": "other" })),
    )
    .await;
    assert!(not_a_gate_block(&body), "{body}");
    gmed_server::sanctions::screening::screen_lead(&app.suite.state, lead_id)
        .await
        .unwrap();
    assert!(open_hits(&app).await.is_empty());

    // A decision is final.
    let (code, body) = request(
        &app,
        "POST",
        &format!("/sanctions/hits/{hit_id}/decision"),
        &app.ceo(),
        Some(json!({ "decision": "confirmed", "reason": "Changed my mind about it" })),
    )
    .await;
    assert_eq!(code, StatusCode::CONFLICT, "{body}");
    assert_eq!(body["error"], "sanctions_hit_decided");

    // New data (the exact birth date) is a new possible match.
    sqlx::query("UPDATE leads SET date_of_birth = DATE '1961-03-14' WHERE id = $1")
        .bind(lead_id)
        .execute(app.pool())
        .await
        .unwrap();
    let status = lead_status(&app, lead_id).await;
    assert_eq!(status["screening"], "review_pending", "{status}");
    let hits = open_hits(&app).await;
    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0]["match_details"]["dob"], "exact");
    let confirmed_id = hits[0]["id"].as_str().unwrap().to_string();
    let (code, body) = request(
        &app,
        "POST",
        &format!("/sanctions/hits/{confirmed_id}/decision"),
        &app.ceo(),
        Some(
            json!({ "decision": "confirmed", "reason": "Name, birth date and citizenship match" }),
        ),
    )
    .await;
    assert_eq!(code, StatusCode::OK, "{body}");

    // Confirmed: a permanent stop for qualification, countersignature and work.
    let (code, body) = request(
        &app,
        "POST",
        &format!("/leads/{lead_id}/qualify"),
        &app.pm(),
        Some(json!({ "status": "qualified" })),
    )
    .await;
    assert_eq!(code, StatusCode::CONFLICT, "{body}");
    assert_eq!(body["error"], "sanctions_confirmed");
    assert_eq!(body["permanent"], true);
    let (code, body) = request(
        &app,
        "POST",
        "/framework-contracts",
        &app.ceo(),
        Some(json!({ "lead_id": lead_id.to_string(), "status": "signed" })),
    )
    .await;
    assert_eq!(code, StatusCode::CONFLICT, "{body}");
    assert_eq!(body["error"], "sanctions_confirmed");
    // Also for a new version of the patient form confirmed as signed by staff.
    let patient_form = insert_patient_form(&app, lead_id).await;
    let (code, body) = request(
        &app,
        "POST",
        &format!("/documents/{patient_form}/mark-signed"),
        &app.pm(),
        Some(json!({ "compliance_kind": "other" })),
    )
    .await;
    assert_eq!(code, StatusCode::CONFLICT, "{body}");
    assert_eq!(body["error"], "sanctions_confirmed");
    let signed: Option<chrono::DateTime<chrono::Utc>> =
        sqlx::query_scalar("SELECT signed_at FROM documents WHERE id = $1")
            .bind(patient_form)
            .fetch_one(app.pool())
            .await
            .unwrap();
    assert!(signed.is_none());
    // Not even a confirmed match holds the DSGVO consent or the identity document.
    assert_consent_and_identity_free(&app, lead_id).await;
    let status = lead_status(&app, lead_id).await;
    assert_eq!(status["screening"], "confirmed");
    // A confirmed match requires the enhanced check.
    assert_eq!(
        enhanced_check(&app, lead_id).await,
        json!({ "required": true, "reasons": ["patient_sanctioned"], "countries": [] })
    );
    // Even a direct database update cannot reopen a decided hit.
    let reopened = sqlx::query("UPDATE sanctions_hits SET status = 'open', decided_by = NULL, decided_at = NULL, decision_reason = NULL WHERE id = $1")
        .bind(Uuid::parse_str(&confirmed_id).unwrap())
        .execute(app.pool())
        .await;
    assert!(reopened.is_err());

    // Decisions are audited in the same transaction.
    let decisions: i64 =
        sqlx::query_scalar("SELECT count(*) FROM audit_log WHERE action = 'sanctions_hit_decided'")
            .fetch_one(app.pool())
            .await
            .unwrap();
    assert_eq!(decisions, 2);
}

/// A generated patient form (`lead_self_disclosure`) of the lead, not signed.
async fn insert_patient_form(app: &TestApp, lead_id: Uuid) -> Uuid {
    let document_id = Uuid::new_v4();
    sqlx::query(
        r#"INSERT INTO documents (
               id, lead_id, auto_name, original_filename, art, category,
               status, visibility, is_medical, mime_type, generated_template_id,
               version_root_document_id, version_number, uploaded_by
           ) VALUES (
               $1, $2, 'Patientenformular', 'Patientenformular.pdf', 'lead_self_disclosure',
               'administrative', 'active', 'internal', false, 'application/pdf',
               'lead_self_disclosure', $1, 1, $3
           )"#,
    )
    .bind(document_id)
    .bind(lead_id)
    .bind(app.pm_id)
    .execute(app.pool())
    .await
    .unwrap();
    document_id
}

/// An unsigned document of the lead with the given type and template: the
/// wizard's DSGVO consent (`privacy_consents`, no compliance kind until it is
/// signed) or a scan of the identity document.
async fn insert_lead_document(
    app: &TestApp,
    lead_id: Uuid,
    art: &str,
    template: Option<&str>,
) -> Uuid {
    let document_id = Uuid::new_v4();
    sqlx::query(
        r#"INSERT INTO documents (
               id, lead_id, auto_name, original_filename, art, category,
               status, visibility, is_medical, mime_type, generated_template_id,
               version_root_document_id, version_number, uploaded_by
           ) VALUES (
               $1, $2, $3, $3 || '.pdf', $3, 'administrative', 'active', 'internal',
               false, 'application/pdf', $4, $1, 1, $5
           )"#,
    )
    .bind(document_id)
    .bind(lead_id)
    .bind(art)
    .bind(template)
    .bind(app.pm_id)
    .execute(app.pool())
    .await
    .unwrap();
    document_id
}

/// "Подтвердить подпись" of the DSGVO consent and "Подтвердить документ" of
/// the identity document pass the sanctions and the risk gate (owner decision
/// 2026-10-10), also before they carry a compliance kind (QA 2026-10-10 V1-a).
async fn assert_consent_and_identity_free(app: &TestApp, lead_id: Uuid) {
    let consent =
        insert_lead_document(app, lead_id, "privacy_consents", Some("privacy_consents")).await;
    let identity = insert_lead_document(app, lead_id, "passport", None).await;
    for (document, kind) in [(consent, "dsgvo"), (identity, "identity")] {
        let (code, body) = request(
            app,
            "POST",
            &format!("/documents/{document}/mark-signed"),
            &app.pm(),
            Some(json!({ "compliance_kind": kind })),
        )
        .await;
        assert!(not_a_gate_block(&body), "{kind}: {body}");
        assert_ne!(body["error"], "risk_review_required", "{kind}: {body}");
        if kind == "dsgvo" {
            // The generated consent reaches the handler, which wants the signed
            // scan or a QES as proof (owner decision 2026-10-11).
            assert_eq!(code, StatusCode::CONFLICT, "{kind}: {body}");
            assert_eq!(
                body["error"], "signature_evidence_required",
                "{kind}: {body}"
            );
        } else {
            assert_eq!(code, StatusCode::OK, "{kind}: {body}");
        }
    }
}

/// The gate's own error codes start with `sanctions_` or are `blocked_country`;
/// anything else came from the handler behind it.
fn not_a_gate_block(body: &Value) -> bool {
    let code = body["error"].as_str().unwrap_or_default();
    !code.starts_with("sanctions_") && code != "blocked_country"
}

#[tokio::test]
async fn guardians_of_minors_and_patients_are_screened() {
    let Some(app) = test_app().await else {
        return;
    };
    load_synthetic_list(&app).await;
    let guardian_id = Uuid::new_v4();
    let minor = insert_lead(
        &app,
        "Mila",
        "Beispiel",
        Some("2016-04-04"),
        &[],
        json!([
            { "id": guardian_id, "name": "Testomir Korneev", "relation": "Father", "birth_date": "1961-03-14" },
            { "id": Uuid::new_v4(), "name": "Zorana Miletich", "relation": "Aunt" }
        ]),
    )
    .await;
    let status = lead_status(&app, minor).await;
    assert_eq!(status["screening"], "review_pending", "{status}");
    let hits = open_hits(&app).await;
    assert_eq!(hits.len(), 1, "only the parent is screened: {hits:?}");
    assert_eq!(hits[0]["subject_kind"], "lead_guardian");
    assert_eq!(hits[0]["current_subject"]["relation"], "Father");

    // An adult's contacts are not screened.
    let adult = insert_lead(
        &app,
        "Max",
        "Beispiel",
        Some("1980-04-04"),
        &[],
        json!([{ "id": Uuid::new_v4(), "name": "Testomir Korneev", "relation": "Father" }]),
    )
    .await;
    assert_eq!(lead_status(&app, adult).await["screening"], "clear");

    // Patients are screened through the queue worker.
    let patient_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO patients (patient_id, first_name, last_name, birth_date, gender,
                                 lifecycle_status, is_active, created_by, languages)
           VALUES ($1, 'Zorana', 'Miletić-Bauer', DATE '1978-06-01', 'female',
                   'active', true, $2, ARRAY['de']::text[])
           RETURNING id"#,
    )
    .bind(format!(
        "P-SAN-{}",
        &Uuid::new_v4().simple().to_string()[..8]
    ))
    .bind(app.pm_id)
    .fetch_one(app.pool())
    .await
    .unwrap();
    gmed_server::sanctions::screening::process_queue(&app.suite.state)
        .await
        .unwrap();
    let patient_hits: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM sanctions_hits WHERE patient_id = $1 AND status = 'open'",
    )
    .bind(patient_id)
    .fetch_one(app.pool())
    .await
    .unwrap();
    assert_eq!(patient_hits, 1);
    // Work for that patient is blocked until the CEO decides.
    let (code, body) = request(
        &app,
        "POST",
        &format!("/patients/{patient_id}/order-intakes"),
        &app.pm(),
        Some(json!({})),
    )
    .await;
    assert_eq!(code, StatusCode::CONFLICT, "{body}");
    assert_eq!(body["error"], "sanctions_review_pending");

    // The leads list shows flags for blocked leads.
    let (code, flags) = request(&app, "GET", "/sanctions/leads/flags", &app.sales(), None).await;
    assert_eq!(code, StatusCode::OK, "{flags}");
    assert!(
        flags
            .as_array()
            .unwrap()
            .iter()
            .any(|flag| flag["lead_id"] == json!(minor) && flag["flag"] == "review_pending")
    );
}

/// What the cabinet holds about a representative (`lead_representatives`) is
/// part of the screened person: a change queues the lead, and new data of a
/// parent is a new possible match even after a "false positive" decision.
#[tokio::test]
async fn cabinet_data_reopens_a_parents_decision_and_an_adults_representative_is_screened() {
    let Some(app) = test_app().await else {
        return;
    };
    load_synthetic_list(&app).await;
    let father = Uuid::new_v4();
    let minor = insert_lead(
        &app,
        "Mila",
        "Beispiel",
        Some("2016-04-04"),
        &[],
        json!([{ "id": father, "name": "Testomir Korneev", "relation": "father" }]),
    )
    .await;
    let status = lead_status(&app, minor).await;
    assert_eq!(status["screening"], "review_pending", "{status}");
    let hits = open_hits(&app).await;
    assert_eq!(hits.len(), 1, "{hits:?}");
    assert_eq!(hits[0]["subject_kind"], "lead_guardian");
    let (code, body) = request(
        &app,
        "POST",
        &format!(
            "/sanctions/hits/{}/decision",
            hits[0]["id"].as_str().unwrap()
        ),
        &app.ceo(),
        Some(json!({ "decision": "false_positive", "reason": "Another person, passport checked" })),
    )
    .await;
    assert_eq!(code, StatusCode::OK, "{body}");
    assert_eq!(lead_status(&app, minor).await["screening"], "clear");
    assert!(!lead_is_queued(&app, minor).await);

    // The father states his citizenship in the cabinet: the row of the
    // representative queues the lead, and the same person with more data is
    // one new open hit under the same reference.
    sqlx::query(
        r#"INSERT INTO lead_representatives
               (lead_id, contact_id, role, contact_origin, first_name, last_name, citizenships)
           VALUES ($1, $2, 'legal_representative', 'staff', 'Testomir', 'Korneev', ARRAY['UA'])"#,
    )
    .bind(minor)
    .bind(father)
    .execute(app.pool())
    .await
    .unwrap();
    assert!(lead_is_queued(&app, minor).await);
    let status = lead_status(&app, minor).await;
    assert_eq!(status["screening"], "review_pending", "{status}");
    assert_eq!(status["open_hits"], 1, "{status}");
    let hits = open_hits(&app).await;
    assert_eq!(hits.len(), 1, "{hits:?}");
    assert_eq!(hits[0]["subject_kind"], "lead_guardian");
    assert_eq!(
        hits[0]["current_subject"]["citizenships"],
        json!(["UA"]),
        "{hits:?}"
    );
    let references: Vec<(String, String)> = sqlx::query_as(
        "SELECT subject_ref, status FROM sanctions_hits WHERE lead_id = $1 ORDER BY created_at",
    )
    .bind(minor)
    .fetch_all(app.pool())
    .await
    .unwrap();
    assert_eq!(
        references,
        vec![
            (father.to_string(), "false_positive".to_string()),
            (father.to_string(), "open".to_string()),
        ]
    );
    // Removing the row queues the lead again.
    assert!(!lead_is_queued(&app, minor).await);
    sqlx::query("DELETE FROM lead_representatives WHERE lead_id = $1")
        .bind(minor)
        .execute(app.pool())
        .await
        .unwrap();
    assert!(lead_is_queued(&app, minor).await);

    // An adult's contacts are not screened — but for the representative and
    // the legal guardian the adult named in the cabinet (a row of that role).
    let agent = Uuid::new_v4();
    let adult = insert_lead(
        &app,
        "Max",
        "Beispiel",
        Some("1980-04-04"),
        &[],
        json!([{ "id": agent, "name": "Testomir Korneev", "relation": "representative" }]),
    )
    .await;
    assert_eq!(lead_status(&app, adult).await["screening"], "clear");
    sqlx::query(
        r#"INSERT INTO lead_representatives
               (lead_id, contact_id, role, contact_origin, first_name, last_name)
           VALUES ($1, $2, 'authorised_representative', 'portal', 'Testomir', 'Korneev')"#,
    )
    .bind(adult)
    .bind(agent)
    .execute(app.pool())
    .await
    .unwrap();
    let status = lead_status(&app, adult).await;
    assert_eq!(status["screening"], "review_pending", "{status}");
    let represented: (String, String, Option<String>) = sqlx::query_as(
        r#"SELECT subject_kind, subject_ref, subject_snapshot ->> 'relation'
           FROM sanctions_hits WHERE lead_id = $1 AND status = 'open'"#,
    )
    .bind(adult)
    .fetch_one(app.pool())
    .await
    .unwrap();
    assert_eq!(
        represented,
        (
            "lead_guardian".to_string(),
            agent.to_string(),
            Some("authorised_representative".to_string())
        )
    );
}

async fn lead_is_queued(app: &TestApp, lead_id: Uuid) -> bool {
    sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM sanctions_screening_queue
                        WHERE subject_type = 'lead' AND subject_id = $1)",
    )
    .bind(lead_id)
    .fetch_one(app.pool())
    .await
    .unwrap()
}

#[tokio::test]
async fn an_organisation_payer_is_queued_and_screened_as_an_organisation() {
    let Some(app) = test_app().await else {
        return;
    };
    load_synthetic_list(&app).await;
    let lead_id = insert_lead(
        &app,
        "Anna",
        "Beispiel",
        Some("1990-02-02"),
        &["DE"],
        json!([]),
    )
    .await;
    assert_eq!(lead_status(&app, lead_id).await["screening"], "clear");
    assert!(!lead_is_queued(&app, lead_id).await);
    let declaration = format!("/leads/{lead_id}/payer-declaration");
    let company = |name: &str| {
        json!({
            "payer_kind": "third_party",
            "payer_type": "company",
            "organisation_name": name,
            "source_of_funds": "business_income",
            "street": "Hafenstr. 1",
            "zip": "3030",
            "city": "Limassol",
            "country": "CY"
        })
    };

    // A person with the words of the listed company as a name is no match:
    // persons are compared with persons only.
    let (code, body) = request(
        &app,
        "POST",
        &declaration,
        &app.pm(),
        Some(json!({
            "payer_kind": "third_party",
            "first_name": "Polartek",
            "last_name": "Shipping",
            "source_of_funds": "savings"
        })),
    )
    .await;
    assert_eq!(code, StatusCode::OK, "{body}");
    assert!(lead_is_queued(&app, lead_id).await);
    assert_eq!(lead_status(&app, lead_id).await["screening"], "clear");

    // The company named as the payer queues the lead and is screened against
    // the listed entities by its name; the seat is its residence.
    let (code, body) = request(
        &app,
        "POST",
        &declaration,
        &app.pm(),
        Some(company("Polartek Shipping LLC")),
    )
    .await;
    assert_eq!(code, StatusCode::OK, "{body}");
    assert!(
        lead_is_queued(&app, lead_id).await,
        "a change of the payer type and the organisation name queues the lead"
    );
    let status = lead_status(&app, lead_id).await;
    assert_eq!(status["screening"], "review_pending", "{status}");
    let hits = open_hits(&app).await;
    assert_eq!(hits.len(), 1, "{hits:?}");
    let hit = &hits[0];
    assert_eq!(hit["subject_kind"], "lead_payer");
    assert_eq!(hit["subject_snapshot"]["organisation"], true, "{hit}");
    let subject = &hit["current_subject"];
    assert_eq!(subject["organisation"], true, "{hit}");
    assert_eq!(subject["first_name"], "", "{hit}");
    assert_eq!(subject["last_name"], "Polartek Shipping LLC", "{hit}");
    assert!(subject["date_of_birth"].is_null(), "{hit}");
    assert_eq!(subject["citizenships"], json!([]), "{hit}");
    assert_eq!(subject["residence"], json!(["CY"]), "{hit}");

    // Only the name changes: the lead is queued again, and the other company
    // no longer matches.
    let (code, body) = request(
        &app,
        "POST",
        &declaration,
        &app.pm(),
        Some(company("Nordwind Logistik GmbH")),
    )
    .await;
    assert_eq!(code, StatusCode::OK, "{body}");
    assert!(lead_is_queued(&app, lead_id).await);
    lead_status(&app, lead_id).await;
    let still_matches: bool =
        sqlx::query_scalar("SELECT still_matches FROM sanctions_hits WHERE lead_id = $1")
            .bind(lead_id)
            .fetch_one(app.pool())
            .await
            .unwrap();
    assert!(!still_matches);
}

#[tokio::test]
async fn blocked_country_needs_the_ceo_to_lift_it_for_the_lead() {
    let Some(app) = test_app().await else {
        return;
    };
    // The country policy works without a list.
    let lead_id = insert_lead(
        &app,
        "Anna",
        "Beispiel",
        Some("1990-02-02"),
        &["DE", "RU"],
        json!([]),
    )
    .await;
    let status = lead_status(&app, lead_id).await;
    assert_eq!(status["country"]["blocking"], json!(["RU"]), "{status}");
    assert_eq!(status["screening"], "not_screened");

    let (code, body) = request(
        &app,
        "POST",
        &format!("/leads/{lead_id}/qualify"),
        &app.pm(),
        Some(json!({ "status": "qualified" })),
    )
    .await;
    assert_eq!(code, StatusCode::CONFLICT, "{body}");
    assert_eq!(body["error"], "blocked_country");
    assert_eq!(body["countries"], json!(["RU"]));
    // A blocked country does not stop other order work, but the agency's
    // countersignature of the order.
    let (code, order) = request(
        &app,
        "POST",
        "/orders",
        &app.pm(),
        Some(json!({ "source_lead_id": lead_id })),
    )
    .await;
    assert_eq!(code, StatusCode::CREATED, "{order}");
    let order_id = order["id"].as_str().unwrap().to_string();
    let (_, body) = request(
        &app,
        "POST",
        &format!("/orders/{order_id}/commercial-basis"),
        &app.pm(),
        Some(json!({ "needs_description": "Check-up" })),
    )
    .await;
    assert!(not_a_gate_block(&body), "{body}");
    let (code, body) = request(
        &app,
        "POST",
        &format!("/orders/{order_id}/commercial-basis"),
        &app.pm(),
        Some(json!({ "signed_agency": true })),
    )
    .await;
    assert_eq!(code, StatusCode::CONFLICT, "{body}");
    assert_eq!(body["error"], "blocked_country");
    // On paper: the agency's countersignature of the order document is held,
    // the client's own signature of the patient form is not, although the
    // form names the order (QA 2026-10-10).
    let order_uuid = Uuid::parse_str(&order_id).unwrap();
    let mut paper = Vec::new();
    for (template, name) in [
        ("single_order", "Einzelauftrag"),
        ("lead_self_disclosure", "Patientenformular"),
    ] {
        let document_id = Uuid::new_v4();
        sqlx::query(
            r#"INSERT INTO documents (
                   id, lead_id, order_id, auto_name, original_filename, art, category,
                   status, visibility, is_medical, mime_type, generated_template_id,
                   version_root_document_id, version_number, uploaded_by
               ) VALUES (
                   $1, $2, $3, $4, $5, $6, 'administrative',
                   'active', 'internal', false, 'application/pdf', $6, $1, 1, $7
               )"#,
        )
        .bind(document_id)
        .bind(lead_id)
        .bind(order_uuid)
        .bind(name)
        .bind(format!("{name}.pdf"))
        .bind(template)
        .bind(app.pm_id)
        .execute(app.pool())
        .await
        .unwrap();
        paper.push(document_id);
    }
    let (code, body) = request(
        &app,
        "POST",
        &format!("/documents/{}/paper-signature", paper[0]),
        &app.pm(),
        None,
    )
    .await;
    assert_eq!(code, StatusCode::CONFLICT, "{body}");
    assert_eq!(body["error"], "blocked_country");
    let (_, body) = request(
        &app,
        "POST",
        &format!("/documents/{}/paper-signature", paper[1]),
        &app.pm(),
        None,
    )
    .await;
    assert!(not_a_gate_block(&body), "{body}");
    // A signature confirmed by staff follows the same rule (C3-e).
    let (code, body) = request(
        &app,
        "POST",
        &format!("/documents/{}/mark-signed", paper[0]),
        &app.pm(),
        Some(json!({ "compliance_kind": "other" })),
    )
    .await;
    assert_eq!(code, StatusCode::CONFLICT, "{body}");
    assert_eq!(body["error"], "blocked_country");
    let (_, body) = request(
        &app,
        "POST",
        &format!("/documents/{}/mark-signed", paper[1]),
        &app.pm(),
        Some(json!({ "compliance_kind": "other" })),
    )
    .await;
    assert!(not_a_gate_block(&body), "{body}");

    // The IT admin settings page cannot change the list; only the CEO can.
    let (code, _) = request(
        &app,
        "POST",
        "/admin/settings/blocked_countries",
        &app.it_admin(),
        Some(json!({ "value": "[]" })),
    )
    .await;
    assert_eq!(code, StatusCode::NOT_FOUND);
    let (code, _) = request(
        &app,
        "PUT",
        "/sanctions/settings/blocked-countries",
        &app.pm(),
        Some(json!({ "countries": [] })),
    )
    .await;
    assert_eq!(code, StatusCode::FORBIDDEN);
    let (code, _) = request(
        &app,
        "PUT",
        "/sanctions/settings/blocked-countries",
        &app.ceo(),
        Some(json!({ "countries": ["Russia"] })),
    )
    .await;
    assert_eq!(code, StatusCode::UNPROCESSABLE_ENTITY);

    // Lifting needs the CEO and a reason.
    let (code, _) = request(
        &app,
        "POST",
        &format!("/sanctions/leads/{lead_id}/country-override"),
        &app.pm(),
        Some(json!({ "reason": "Patient lives in Germany for years" })),
    )
    .await;
    assert_eq!(code, StatusCode::FORBIDDEN);
    let (code, _) = request(
        &app,
        "POST",
        &format!("/sanctions/leads/{lead_id}/country-override"),
        &app.ceo(),
        Some(json!({ "reason": " " })),
    )
    .await;
    assert_eq!(code, StatusCode::UNPROCESSABLE_ENTITY);
    let (code, lift) = request(
        &app,
        "POST",
        &format!("/sanctions/leads/{lead_id}/country-override"),
        &app.ceo(),
        Some(json!({ "reason": "Patient lives in Germany for years" })),
    )
    .await;
    assert_eq!(code, StatusCode::CREATED, "{lift}");
    let status = lead_status(&app, lead_id).await;
    assert_eq!(status["country"]["blocking"], json!([]), "{status}");
    assert_eq!(status["country"]["lift"]["lifted_by_name"], "Clara Chefin");
    assert_eq!(
        status["country"]["lift"]["reason"],
        "Patient lives in Germany for years"
    );
    let (_, body) = request(
        &app,
        "POST",
        &format!("/leads/{lead_id}/qualify"),
        &app.pm(),
        Some(json!({ "status": "qualified" })),
    )
    .await;
    assert!(not_a_gate_block(&body), "{body}");
    let (_, body) = request(
        &app,
        "POST",
        &format!("/orders/{order_id}/commercial-basis"),
        &app.pm(),
        Some(json!({ "signed_agency": true })),
    )
    .await;
    assert!(not_a_gate_block(&body), "{body}");

    // A country the lift did not cover blocks again.
    let (code, body) = request(
        &app,
        "PUT",
        "/sanctions/settings/blocked-countries",
        &app.ceo(),
        Some(json!({ "countries": ["ru", "BY"] })),
    )
    .await;
    assert_eq!(code, StatusCode::OK, "{body}");
    assert_eq!(body["blocked_countries"], json!(["BY", "RU"]));
    sqlx::query("UPDATE leads SET country = 'BY' WHERE id = $1")
        .bind(lead_id)
        .execute(app.pool())
        .await
        .unwrap();
    let status = lead_status(&app, lead_id).await;
    assert_eq!(status["country"]["blocking"], json!(["BY"]), "{status}");

    // Revoking the lift restores the block; both are audited.
    let override_id = lift["id"].as_str().unwrap();
    let (code, body) = request(
        &app,
        "POST",
        &format!("/sanctions/country-overrides/{override_id}/revoke"),
        &app.ceo(),
        Some(json!({ "reason": "Residence moved to a blocked country" })),
    )
    .await;
    assert_eq!(code, StatusCode::OK, "{body}");
    let status = lead_status(&app, lead_id).await;
    assert_eq!(
        status["country"]["blocking"],
        json!(["BY", "RU"]),
        "{status}"
    );
    let audited: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM audit_log WHERE action IN ('sanctions_country_block_lifted', 'sanctions_country_block_lift_revoked', 'sanctions_blocked_countries_updated')",
    )
    .fetch_one(app.pool())
    .await
    .unwrap();
    assert_eq!(audited, 3);
}

#[tokio::test]
async fn screening_results_follow_the_lead_retention() {
    let Some(app) = test_app().await else {
        return;
    };
    load_synthetic_list(&app).await;
    let lead_id = insert_lead(&app, "Testomir", "Korneev", None, &[], json!([])).await;
    assert_eq!(
        lead_status(&app, lead_id).await["screening"],
        "review_pending"
    );
    let hits: i64 = sqlx::query_scalar("SELECT count(*) FROM sanctions_hits WHERE lead_id = $1")
        .bind(lead_id)
        .fetch_one(app.pool())
        .await
        .unwrap();
    assert_eq!(hits, 1);

    let (code, body) = request(
        &app,
        "POST",
        &format!("/leads/{lead_id}/failed-flow"),
        &app.pm(),
        Some(json!({ "resolution": "delete", "reason": "not_our_lead" })),
    )
    .await;
    assert_eq!(code, StatusCode::OK, "{body}");
    let remaining: i64 =
        sqlx::query_scalar("SELECT count(*) FROM sanctions_hits WHERE lead_id = $1")
            .bind(lead_id)
            .fetch_one(app.pool())
            .await
            .unwrap();
    assert_eq!(remaining, 0);
    let notifications: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM user_notifications WHERE kind = 'sanctions_possible_match'",
    )
    .fetch_one(app.pool())
    .await
    .unwrap();
    assert_eq!(notifications, 0);
}

/// The risk assessment of a lead as staff read it (trigger flow 2026-10-07).
async fn risk_assessment(app: &TestApp, lead_id: Uuid) -> Value {
    let (status, body) = request(
        app,
        "GET",
        &format!("/leads/{lead_id}/risk-assessment"),
        &app.pm(),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    body
}

/// What an OPEN (undecided) hit must leave as it is (owner decision
/// 2026-10-07, QA 2026-10-11 A-15/A-21/A-33): no T16, the level of the
/// other triggers, no follow-up block of the enhanced check for the lead's
/// cabinet (A source of funds, K birth data, L legal questions) and the
/// enhanced check optional — which keeps the payer's proof of funds optional
/// on the payer's own link (its check level is 2 only when the check is
/// required). The hit is named for staff as `sanctions_review_pending` and
/// holds qualification through the sanctions gate.
async fn assert_an_open_hit_changes_nothing(app: &TestApp, lead_id: Uuid) {
    let assessment = risk_assessment(app, lead_id).await;
    assert!(
        assessment["triggers"]
            .as_array()
            .unwrap()
            .iter()
            .all(|trigger| trigger["key"] != "T16"),
        "{assessment}"
    );
    assert_eq!(assessment["knockout"], false, "{assessment}");
    assert_eq!(assessment["level"], 1, "{assessment}");
    for block in ["A", "K", "L"] {
        assert_eq!(
            assessment["blocks"][block]["open"], false,
            "{block}: {assessment}"
        );
    }
    let check = enhanced_check(app, lead_id).await;
    assert_eq!(check["required"], false, "{check}");
    assert_eq!(
        check["reasons"],
        json!(["sanctions_review_pending"]),
        "{check}"
    );
    let (code, body) = qualify(app, lead_id).await;
    assert_eq!(code, StatusCode::CONFLICT, "{body}");
    assert_eq!(body["error"], "sanctions_review_pending", "{body}");
}

/// After a CONFIRMED hit: T16 of `subject`, a knock-out (level 3), the
/// enhanced check required with `reason`, its blocks open for the cabinet.
async fn assert_a_confirmed_hit_is_a_knockout(
    app: &TestApp,
    lead_id: Uuid,
    subject: &str,
    reason: &str,
) {
    let assessment = risk_assessment(app, lead_id).await;
    assert!(
        assessment["triggers"]
            .as_array()
            .unwrap()
            .iter()
            .any(|trigger| trigger["key"] == "T16" && trigger["subject"] == subject),
        "{assessment}"
    );
    assert_eq!(assessment["knockout"], true, "{assessment}");
    assert_eq!(assessment["level"], 3, "{assessment}");
    for block in ["A", "K", "L"] {
        assert_eq!(
            assessment["blocks"][block]["open"], true,
            "{block}: {assessment}"
        );
    }
    let check = enhanced_check(app, lead_id).await;
    assert_eq!(check["required"], true, "{check}");
    assert!(
        check["reasons"]
            .as_array()
            .unwrap()
            .iter()
            .any(|known| known == reason),
        "{check}"
    );
}

#[tokio::test]
async fn an_open_hit_only_holds_and_only_a_confirmed_hit_is_a_knockout() {
    let Some(app) = test_app().await else {
        return;
    };
    load_synthetic_list(&app).await;
    let lead_id = insert_lead(
        &app,
        "Testomir",
        "Korneev",
        Some("1961-11-30"),
        &[],
        json!([]),
    )
    .await;
    let status = lead_status(&app, lead_id).await;
    assert_eq!(status["open_hits"], 1, "{status}");

    // The CEO starts the assessment: the open hit is no trigger.
    let (code, started) = request(
        &app,
        "POST",
        &format!("/leads/{lead_id}/risk-assessment/restart"),
        &app.ceo(),
        None,
    )
    .await;
    assert_eq!(code, StatusCode::OK, "{started}");
    assert_an_open_hit_changes_nothing(&app, lead_id).await;

    // A T16 an open hit set before 2026-10-11 goes at the next reassessment.
    sqlx::query(
        r#"UPDATE lead_risk_assessments
           SET triggers = triggers || jsonb_build_array(jsonb_build_object(
                   'key', 'T16', 'subject', 'patient', 'variant', NULL, 'points', 0,
                   'knockout', true, 'first_fired_at', now(), 'last_fired_at', now(),
                   'active', true)),
               knockout = true, level = 3
           WHERE lead_id = $1"#,
    )
    .bind(lead_id)
    .execute(app.pool())
    .await
    .unwrap();
    assert_an_open_hit_changes_nothing(&app, lead_id).await;
    let after = risk_assessment(&app, lead_id).await;
    assert!(
        after["history"]
            .as_array()
            .unwrap()
            .iter()
            .any(|event| event["kind"] == "trigger_withdrawn"),
        "{after}"
    );

    // The CEO confirms the match: now T16 of the patient, a knock-out.
    let hit_id = open_hits(&app)
        .await
        .into_iter()
        .find(|hit| hit["lead_id"] == json!(lead_id))
        .unwrap()["id"]
        .as_str()
        .unwrap()
        .to_string();
    decide(
        &app,
        &hit_id,
        "confirmed",
        "Same name, date and place of birth as the EU entry",
    )
    .await;
    assert_a_confirmed_hit_is_a_knockout(&app, lead_id, "patient", "patient_sanctioned").await;
    let confirmed = risk_assessment(&app, lead_id).await;
    let raised = confirmed["history"]
        .as_array()
        .unwrap()
        .iter()
        .rfind(|event| event["kind"] == "raised")
        .cloned()
        .unwrap_or_else(|| panic!("no raise: {confirmed}"));
    assert_eq!(raised["cause"], "hit_decision");
    assert_eq!(raised["actor"], json!(app.ceo_id));
    assert_eq!(confirmed["sanctions_confirmed"], true, "{confirmed}");
}

/// QA 2026-10-11 (A-38a): a lead with a sanctions hit AND a blocked country
/// is listed in the CEO's «Страны» tab; the country block is lifted on its
/// own while the hit still waits. The leads list keeps one flag per lead
/// (the sanctions flag).
#[tokio::test]
async fn a_lead_with_a_hit_is_listed_under_blocked_countries_too() {
    let Some(app) = test_app().await else {
        return;
    };
    load_synthetic_list(&app).await;
    let lead_id = insert_lead(
        &app,
        "Testomir",
        "Korneev",
        Some("1961-11-30"),
        &["RU"],
        json!([]),
    )
    .await;
    let status = lead_status(&app, lead_id).await;
    assert_eq!(status["screening"], "review_pending", "{status}");
    assert_eq!(status["country"]["blocking"], json!(["RU"]), "{status}");

    // `{ "leads": [...] }` of the CEO's «Страны» tab.
    let listed = |items: &Value| {
        items["leads"]
            .as_array()
            .unwrap_or_else(|| panic!("no list: {items}"))
            .iter()
            .find(|item| item["lead_id"] == json!(lead_id))
            .cloned()
    };
    let (code, blocks) = request(&app, "GET", "/sanctions/country-blocks", &app.ceo(), None).await;
    assert_eq!(code, StatusCode::OK, "{blocks}");
    let item = listed(&blocks).unwrap_or_else(|| panic!("not listed: {blocks}"));
    assert_eq!(item["flag"], "blocked_country", "{item}");
    assert_eq!(item["blocking"], json!(["RU"]), "{item}");

    // The CEO lifts the country block while the hit is still open.
    let (code, body) = request(
        &app,
        "POST",
        &format!("/sanctions/leads/{lead_id}/country-override"),
        &app.ceo(),
        Some(json!({ "reason": "Resident in Germany since 2001, checked" })),
    )
    .await;
    assert_eq!(code, StatusCode::CREATED, "{body}");
    let (_, blocks) = request(&app, "GET", "/sanctions/country-blocks", &app.ceo(), None).await;
    assert_eq!(listed(&blocks).unwrap()["flag"], "country_lifted");
    // The hit still holds.
    let (code, body) = qualify(&app, lead_id).await;
    assert_eq!(code, StatusCode::CONFLICT, "{body}");
    assert_eq!(body["error"], "sanctions_review_pending");

    // The leads list: one flag, the sanctions one.
    let (code, flags) = request(&app, "GET", "/sanctions/leads/flags", &app.pm(), None).await;
    assert_eq!(code, StatusCode::OK, "{flags}");
    let mine: Vec<&Value> = flags
        .as_array()
        .unwrap()
        .iter()
        .filter(|flag| flag["lead_id"] == json!(lead_id))
        .collect();
    assert_eq!(mine.len(), 1, "{flags}");
    assert_eq!(mine[0]["flag"], "review_pending");
}

/// Section 8 as any writer stores it (the cabinet, the payer's own link,
/// staff): the bank and the account country of a transfer.
async fn set_payment_route(app: &TestApp, lead_id: Uuid, bank_name: &str, account_country: &str) {
    let updated = sqlx::query(
        r#"UPDATE lead_payer_declarations
           SET payment_method = 'bank_transfer', bank_name = $2, account_country = $3,
               updated_at = now()
           WHERE lead_id = $1"#,
    )
    .bind(lead_id)
    .bind(bank_name)
    .bind(account_country)
    .execute(app.pool())
    .await
    .unwrap();
    assert_eq!(updated.rows_affected(), 1);
}

async fn declare_payer(app: &TestApp, lead_id: Uuid, body: Value) {
    let (code, response) = request(
        app,
        "POST",
        &format!("/leads/{lead_id}/payer-declaration"),
        &app.pm(),
        Some(body),
    )
    .await;
    assert_eq!(code, StatusCode::OK, "{response}");
}

/// T16 of the risk assessment after a restart by the CEO, by subject.
async fn t16_subjects(app: &TestApp, lead_id: Uuid) -> Vec<String> {
    let (code, body) = request(
        app,
        "POST",
        &format!("/leads/{lead_id}/risk-assessment/restart"),
        &app.ceo(),
        None,
    )
    .await;
    assert_eq!(code, StatusCode::OK, "{body}");
    let mut subjects: Vec<String> = body["triggers"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|trigger| trigger["key"] == "T16")
        .map(|trigger| trigger["subject"].as_str().unwrap_or_default().to_string())
        .collect();
    subjects.sort();
    subjects
}

async fn qualify(app: &TestApp, lead_id: Uuid) -> (StatusCode, Value) {
    request(
        app,
        "POST",
        &format!("/leads/{lead_id}/qualify"),
        &app.pm(),
        Some(json!({ "status": "qualified" })),
    )
    .await
}

async fn decide(app: &TestApp, hit_id: &str, decision: &str, reason: &str) {
    let (code, body) = request(
        app,
        "POST",
        &format!("/sanctions/hits/{hit_id}/decision"),
        &app.ceo(),
        Some(json!({ "decision": decision, "reason": reason })),
    )
    .await;
    assert_eq!(code, StatusCode::OK, "{body}");
}

#[tokio::test]
async fn the_bank_of_the_payment_route_is_screened_held_and_decided_like_any_hit() {
    let Some(app) = test_app().await else {
        return;
    };
    load_synthetic_list(&app).await;

    // The patient pays from a bank that is not listed yet.
    let own = insert_lead(
        &app,
        "Anna",
        "Muster",
        Some("1990-02-02"),
        &["DE"],
        json!([]),
    )
    .await;
    declare_payer(
        &app,
        own,
        json!({ "payer_kind": "self", "source_of_funds": "employment" }),
    )
    .await;
    lead_status(&app, own).await;
    set_payment_route(&app, own, "Testgrad Commerce Bank", "RU").await;
    assert!(
        lead_is_queued(&app, own).await,
        "a change of the bank queues the lead"
    );
    let status = lead_status(&app, own).await;
    assert_eq!(status["screening"], "clear", "{status}");
    // The account country is no citizenship or residence: no country block.
    assert_eq!(status["country"]["found"], json!([]), "{status}");

    // A third party pays from a bank that is not on any list.
    let paid = insert_lead(
        &app,
        "Ben",
        "Muster",
        Some("1985-03-03"),
        &["DE"],
        json!([]),
    )
    .await;
    declare_payer(
        &app,
        paid,
        json!({
            "payer_kind": "third_party",
            "first_name": "Viktor",
            "last_name": "Zahler",
            "source_of_funds": "savings"
        }),
    )
    .await;
    set_payment_route(&app, paid, "Deutsche Bank AG", "DE").await;
    assert_eq!(lead_status(&app, paid).await["screening"], "clear");

    // The next list version names the bank: the re-screening of every open
    // lead finds it.
    let (code, body) = upload_list(&app, &app.ceo(), SYNTHETIC_BANK_LIST).await;
    assert_eq!(code, StatusCode::OK, "{body}");
    assert_eq!(body["outcome"]["result"], "imported", "{body}");
    assert_eq!(body["outcome"]["entries"], 5);
    assert_eq!(body["rescreen"]["new_hits"], 1, "{body}");
    let status = lead_status(&app, own).await;
    assert_eq!(status["screening"], "review_pending", "{status}");
    assert_eq!(
        status["sanctions_block"]["code"],
        "sanctions_review_pending"
    );
    assert_eq!(lead_status(&app, paid).await["screening"], "clear");
    let hits = open_hits(&app).await;
    assert_eq!(hits.len(), 1, "{hits:?}");
    let own_hit = hits[0].clone();
    assert_eq!(own_hit["subject_kind"], "lead_bank", "{own_hit}");
    assert_eq!(own_hit["subject_ref"], "patient-bank", "{own_hit}");
    assert_eq!(own_hit["lead_id"], json!(own));
    assert_eq!(own_hit["owner_name"], "Anna Muster");
    assert_eq!(own_hit["list_logical_id"], "900301");
    assert_eq!(own_hit["list_entry"]["subject_type"], "entity");
    let subject = &own_hit["current_subject"];
    assert_eq!(subject["organisation"], true, "{own_hit}");
    assert_eq!(subject["last_name"], "Testgrad Commerce Bank", "{own_hit}");
    assert_eq!(subject["residence"], json!(["RU"]), "{own_hit}");
    assert_eq!(subject["relation"], "patient_bank", "{own_hit}");
    assert_eq!(
        own_hit["subject_snapshot"]["last_name"],
        "Testgrad Commerce Bank"
    );
    // The CEO is told without the bank's or the patient's name.
    let notifications: Vec<(String, String)> = sqlx::query_as(
        "SELECT title, COALESCE(body, '') FROM user_notifications WHERE user_id = $1 AND kind = 'sanctions_possible_match'",
    )
    .bind(app.ceo_id)
    .fetch_all(app.pool())
    .await
    .unwrap();
    assert_eq!(notifications.len(), 1);
    for (title, body) in &notifications {
        for name in ["Testgrad", "Muster"] {
            assert!(
                !title.contains(name) && !body.contains(name),
                "{title} {body}"
            );
        }
    }

    // The payer names the listed bank in another spelling: re-screened at
    // once, the payer's bank.
    set_payment_route(&app, paid, "PAO Testgradkommerzbank", "RU").await;
    assert!(lead_is_queued(&app, paid).await);
    assert_eq!(lead_status(&app, paid).await["screening"], "review_pending");
    let payer_hit = open_hits(&app)
        .await
        .into_iter()
        .find(|hit| hit["lead_id"] == json!(paid))
        .unwrap();
    assert_eq!(payer_hit["subject_kind"], "lead_bank");
    assert_eq!(payer_hit["subject_ref"], "payer-bank");
    assert_eq!(payer_hit["current_subject"]["relation"], "payer_bank");
    // The payer itself is no match.
    assert!(
        open_hits(&app)
            .await
            .iter()
            .all(|hit| hit["subject_kind"] == "lead_bank")
    );

    // The hold is the one of any open hit.
    for lead in [own, paid] {
        let (code, body) = qualify(&app, lead).await;
        assert_eq!(code, StatusCode::CONFLICT, "{body}");
        assert_eq!(body["error"], "sanctions_review_pending");
    }

    // An open bank hit only holds (QA 2026-10-11 A-15, A-33): no T16, no
    // change of the level, no follow-up block, the proof of funds stays
    // optional — for the patient's bank and for the payer's bank.
    for lead in [own, paid] {
        assert!(t16_subjects(&app, lead).await.is_empty());
        assert_an_open_hit_changes_nothing(&app, lead).await;
    }

    // The CEO decides: the patient's bank is another bank, the payer's bank
    // is the listed one.
    decide(
        &app,
        own_hit["id"].as_str().unwrap(),
        "false_positive",
        "Other bank: BIC and seat in Germany checked",
    )
    .await;
    let status = lead_status(&app, own).await;
    assert_eq!(status["screening"], "clear", "{status}");
    assert!(t16_subjects(&app, own).await.is_empty());
    let (_, body) = qualify(&app, own).await;
    assert!(not_a_gate_block(&body), "{body}");
    // The same bank screened again keeps the decision.
    set_payment_route(&app, own, "Testgrad Commerce Bank", "RU").await;
    assert_eq!(lead_status(&app, own).await["screening"], "clear");

    decide(
        &app,
        payer_hit["id"].as_str().unwrap(),
        "confirmed",
        "Listed bank, same name and seat as the EU entry",
    )
    .await;
    let status = lead_status(&app, paid).await;
    assert_eq!(status["screening"], "confirmed", "{status}");
    let (code, body) = qualify(&app, paid).await;
    assert_eq!(code, StatusCode::CONFLICT, "{body}");
    assert_eq!(body["error"], "sanctions_confirmed");
    // Confirmed: T16 of the payer, who pays through the bank — as before.
    assert_eq!(t16_subjects(&app, paid).await, vec!["payer"]);
    assert_a_confirmed_hit_is_a_knockout(&app, paid, "payer", "payer_sanctioned").await;

    // Another bank later does not undo the confirmation.
    set_payment_route(&app, paid, "Deutsche Bank AG", "DE").await;
    assert_eq!(lead_status(&app, paid).await["screening"], "confirmed");
}

/// Step 3 of the cabinet as any writer stores it: the invoice recipient
/// answers (`lead_invoice_recipients`), the keys of `recipient` only.
async fn set_recipient(app: &TestApp, lead_id: Uuid, recipient: Value) {
    sqlx::query(
        r#"INSERT INTO lead_invoice_recipients
               (lead_id, recipient, recipient_is_payer, recipient_type, first_name, last_name,
                organisation_name, country)
           SELECT $1, r.recipient, r.recipient_is_payer, r.recipient_type, r.first_name,
                  r.last_name, r.organisation_name, r.country
           FROM jsonb_populate_record(NULL::lead_invoice_recipients, $2) r
           ON CONFLICT (lead_id) DO UPDATE SET
               recipient = EXCLUDED.recipient,
               recipient_is_payer = EXCLUDED.recipient_is_payer,
               recipient_type = EXCLUDED.recipient_type,
               first_name = EXCLUDED.first_name,
               last_name = EXCLUDED.last_name,
               organisation_name = EXCLUDED.organisation_name,
               country = EXCLUDED.country,
               updated_at = now()"#,
    )
    .bind(lead_id)
    .bind(recipient)
    .execute(app.pool())
    .await
    .unwrap();
}

async fn lead_hits(app: &TestApp, lead_id: Uuid) -> Vec<Value> {
    open_hits(app)
        .await
        .into_iter()
        .filter(|hit| hit["lead_id"] == json!(lead_id))
        .collect()
}

#[tokio::test]
async fn a_third_party_invoice_recipient_who_does_not_pay_is_screened_like_a_payer() {
    let Some(app) = test_app().await else {
        return;
    };
    load_synthetic_list(&app).await;

    // A person receives the invoice; the patient pays (nobody declared).
    let person_lead = insert_lead(
        &app,
        "Anna",
        "Muster",
        Some("1990-02-02"),
        &["DE"],
        json!([]),
    )
    .await;
    assert_eq!(lead_status(&app, person_lead).await["screening"], "clear");
    assert!(!lead_is_queued(&app, person_lead).await);
    set_recipient(
        &app,
        person_lead,
        json!({
            "recipient": "third_party",
            "recipient_is_payer": false,
            "recipient_type": "person",
            "first_name": "Testomir",
            "last_name": "Korneev",
            "country": "AT"
        }),
    )
    .await;
    assert!(
        lead_is_queued(&app, person_lead).await,
        "the recipient's answers queue the lead"
    );
    let status = lead_status(&app, person_lead).await;
    assert_eq!(status["screening"], "review_pending", "{status}");
    let hits = lead_hits(&app, person_lead).await;
    assert_eq!(hits.len(), 1, "{hits:?}");
    let person_hit = hits[0].clone();
    assert_eq!(person_hit["subject_kind"], "lead_recipient", "{person_hit}");
    assert_eq!(person_hit["subject_ref"], "invoice-recipient");
    assert_eq!(person_hit["owner_name"], "Anna Muster");
    assert_eq!(person_hit["list_logical_id"], "900101");
    let subject = &person_hit["current_subject"];
    assert_eq!(subject["organisation"], false, "{person_hit}");
    assert_eq!(subject["first_name"], "Testomir", "{person_hit}");
    assert_eq!(subject["last_name"], "Korneev", "{person_hit}");
    assert_eq!(subject["residence"], json!(["AT"]), "{person_hit}");
    assert_eq!(subject["relation"], "invoice_recipient", "{person_hit}");
    // The CEO is told without the recipient's or the patient's name.
    let notifications: Vec<(String, String)> = sqlx::query_as(
        "SELECT title, COALESCE(body, '') FROM user_notifications WHERE user_id = $1 AND kind = 'sanctions_possible_match'",
    )
    .bind(app.ceo_id)
    .fetch_all(app.pool())
    .await
    .unwrap();
    assert_eq!(notifications.len(), 1);
    for (title, body) in &notifications {
        for name in ["Testomir", "Korneev", "Muster"] {
            assert!(
                !title.contains(name) && !body.contains(name),
                "{title} {body}"
            );
        }
    }
    // The hold of any open hit, nothing else (QA 2026-10-11 A-21): no T16,
    // no level, no follow-up block for the lead — the extra questions must
    // not appear right when the recipient was named.
    let (code, body) = qualify(&app, person_lead).await;
    assert_eq!(code, StatusCode::CONFLICT, "{body}");
    assert_eq!(body["error"], "sanctions_review_pending");
    assert!(t16_subjects(&app, person_lead).await.is_empty());
    assert_an_open_hit_changes_nothing(&app, person_lead).await;

    // An organisation receives the invoice: screened against the listed
    // entities by its name, its seat as residence.
    let organisation_lead = insert_lead(
        &app,
        "Ben",
        "Muster",
        Some("1985-03-03"),
        &["DE"],
        json!([]),
    )
    .await;
    set_recipient(
        &app,
        organisation_lead,
        json!({
            "recipient": "third_party",
            "recipient_is_payer": false,
            "recipient_type": "organisation",
            "organisation_name": "Polartek Shipping LLC",
            "country": "CY"
        }),
    )
    .await;
    assert_eq!(
        lead_status(&app, organisation_lead).await["screening"],
        "review_pending"
    );
    let hits = lead_hits(&app, organisation_lead).await;
    assert_eq!(hits.len(), 1, "{hits:?}");
    let organisation_hit = hits[0].clone();
    assert_eq!(organisation_hit["subject_kind"], "lead_recipient");
    assert_eq!(organisation_hit["list_entry"]["subject_type"], "entity");
    let subject = &organisation_hit["current_subject"];
    assert_eq!(subject["organisation"], true, "{organisation_hit}");
    assert_eq!(subject["first_name"], "", "{organisation_hit}");
    assert_eq!(
        subject["last_name"], "Polartek Shipping LLC",
        "{organisation_hit}"
    );
    assert_eq!(subject["residence"], json!(["CY"]), "{organisation_hit}");

    // A confirmed recipient match: the enhanced check is required (the
    // payer's side, named as the recipient's: QA 2026-10-11 N-08) and the
    // gates hold.
    decide(
        &app,
        organisation_hit["id"].as_str().unwrap(),
        "confirmed",
        "Same company name and seat as the EU entry",
    )
    .await;
    assert_eq!(
        lead_status(&app, organisation_lead).await["screening"],
        "confirmed"
    );
    let (code, body) = qualify(&app, organisation_lead).await;
    assert_eq!(code, StatusCode::CONFLICT, "{body}");
    assert_eq!(body["error"], "sanctions_confirmed");
    let check = enhanced_check(&app, organisation_lead).await;
    assert_eq!(check["required"], true, "{check}");
    assert!(
        check["reasons"]
            .as_array()
            .unwrap()
            .iter()
            .any(|reason| reason == "recipient_sanctioned"),
        "{check}"
    );
    // Confirmed: T16 of the payer's side although the patient pays (the
    // recipient is a third party on the money side) — as before.
    assert_eq!(t16_subjects(&app, organisation_lead).await, vec!["payer"]);
    assert_a_confirmed_hit_is_a_knockout(&app, organisation_lead, "payer", "recipient_sanctioned")
        .await;

    // A recipient who pays is the third-party payer: screened once, as the
    // payer, never as the recipient besides.
    let paying_lead = insert_lead(
        &app,
        "Mia",
        "Muster",
        Some("1992-04-04"),
        &["DE"],
        json!([]),
    )
    .await;
    declare_payer(
        &app,
        paying_lead,
        json!({
            "payer_kind": "third_party",
            "payer_type": "person",
            "first_name": "Testomir",
            "last_name": "Korneev",
            "source_of_funds": "savings"
        }),
    )
    .await;
    set_recipient(
        &app,
        paying_lead,
        json!({
            "recipient": "third_party",
            "recipient_is_payer": true,
            "recipient_type": "person",
            "first_name": "Testomir",
            "last_name": "Korneev",
            "country": "AT"
        }),
    )
    .await;
    assert_eq!(
        lead_status(&app, paying_lead).await["screening"],
        "review_pending"
    );
    let hits = lead_hits(&app, paying_lead).await;
    assert_eq!(hits.len(), 1, "{hits:?}");
    assert_eq!(hits[0]["subject_kind"], "lead_payer", "{hits:?}");
    let recipient_hits: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM sanctions_hits WHERE lead_id = $1 AND subject_kind = 'lead_recipient'",
    )
    .bind(paying_lead)
    .fetch_one(app.pool())
    .await
    .unwrap();
    assert_eq!(recipient_hits, 0);

    // Another recipient re-screens at once: the old match no longer matches.
    set_recipient(
        &app,
        person_lead,
        json!({
            "recipient": "third_party",
            "recipient_is_payer": false,
            "recipient_type": "person",
            "first_name": "Mia",
            "last_name": "Beispiel",
            "country": "AT"
        }),
    )
    .await;
    assert!(lead_is_queued(&app, person_lead).await);
    lead_status(&app, person_lead).await;
    let still_matches: bool = sqlx::query_scalar(
        "SELECT still_matches FROM sanctions_hits WHERE lead_id = $1 AND subject_kind = 'lead_recipient'",
    )
    .bind(person_lead)
    .fetch_one(app.pool())
    .await
    .unwrap();
    assert!(!still_matches);
    // Removing the answers queues the lead as well.
    sqlx::query("DELETE FROM lead_invoice_recipients WHERE lead_id = $1")
        .bind(person_lead)
        .execute(app.pool())
        .await
        .unwrap();
    assert!(lead_is_queued(&app, person_lead).await);
    // The CEO's false positive ends the hold; there never was a T16.
    decide(
        &app,
        person_hit["id"].as_str().unwrap(),
        "false_positive",
        "Another person: born in Austria, passport checked",
    )
    .await;
    assert_eq!(lead_status(&app, person_lead).await["screening"], "clear");
    assert!(t16_subjects(&app, person_lead).await.is_empty());
}

/// An active patient as the patient card creates one.
async fn insert_patient(
    app: &TestApp,
    first_name: &str,
    last_name: &str,
    birth_date: &str,
) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO patients (patient_id, first_name, last_name, birth_date, gender,
                                 lifecycle_status, is_active, created_by, languages)
           VALUES ($1, $2, $3, $4::date, 'female', 'active', true, $5, ARRAY['de']::text[])
           RETURNING id"#,
    )
    .bind(format!(
        "P-REL-{}",
        &Uuid::new_v4().simple().to_string()[..8]
    ))
    .bind(first_name)
    .bind(last_name)
    .bind(birth_date)
    .bind(app.pm_id)
    .fetch_one(app.pool())
    .await
    .unwrap()
}

async fn patient_is_queued(app: &TestApp, patient_id: Uuid) -> bool {
    sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM sanctions_screening_queue
                        WHERE subject_type = 'patient' AND subject_id = $1)",
    )
    .bind(patient_id)
    .fetch_one(app.pool())
    .await
    .unwrap()
}

/// The queue worker's turn.
async fn screen_queue(app: &TestApp) {
    gmed_server::sanctions::screening::process_queue(&app.suite.state)
        .await
        .unwrap();
}

async fn patient_hits(app: &TestApp, patient_id: Uuid) -> Vec<Value> {
    open_hits(app)
        .await
        .into_iter()
        .filter(|hit| hit["patient_id"] == json!(patient_id))
        .collect()
}

/// The relation dialog of the patient card ("Связи" → "Новая связь").
async fn save_relation(
    app: &TestApp,
    patient_id: Uuid,
    relation_id: Option<&str>,
    body: Value,
) -> Value {
    let (path, expected) = match relation_id {
        Some(relation_id) => (
            format!("/patients/{patient_id}/relations/{relation_id}/update"),
            StatusCode::OK,
        ),
        None => (
            format!("/patients/{patient_id}/relations"),
            StatusCode::CREATED,
        ),
    };
    let (code, saved) = request(app, "POST", &path, &app.ceo(), Some(body)).await;
    assert_eq!(code, expected, "{saved}");
    // Nothing about the screening reaches the relation's answer.
    assert!(!saved.to_string().contains("sanction"), "{saved}");
    saved
}

/// QA 2026-10-11 B-25: a relation marked "Оплачивает счета пациента по
/// умолчанию" becomes the invoice recipient; it is screened against the EU
/// list like the lead's payer and invoice recipient, the hit belongs to the
/// patient and holds the patient's work until the CEO decides.
#[tokio::test]
async fn a_patients_relation_who_pays_is_screened_and_held_like_the_patient() {
    let Some(app) = test_app().await else {
        return;
    };
    load_synthetic_list(&app).await;
    let patient = insert_patient(&app, "Anna", "Muster", "1990-02-02").await;
    screen_queue(&app).await;
    assert!(patient_hits(&app, patient).await.is_empty());

    // A separate contact who does not pay is no subject.
    let relation = save_relation(
        &app,
        patient,
        None,
        json!({
            "related_name": "Testomir Korneev",
            "relation_type": "friend",
            "is_default_payer": false
        }),
    )
    .await;
    let relation_id = relation["id"].as_str().unwrap().to_string();
    assert!(
        patient_is_queued(&app, patient).await,
        "a new relation queues its patient"
    );
    screen_queue(&app).await;
    assert!(patient_hits(&app, patient).await.is_empty());

    // Marked as the default payer, with the country from the ISO picker.
    save_relation(
        &app,
        patient,
        Some(&relation_id),
        json!({
            "related_name": "Testomir Korneev",
            "relation_type": "other",
            "email": "zahler@example.com",
            "address_street": "Musterweg 1",
            "address_zip": "10115",
            "address_city": "Berlin",
            "address_country": "DE",
            "is_default_payer": true
        }),
    )
    .await;
    assert!(
        patient_is_queued(&app, patient).await,
        "the payer flag queues the patient"
    );
    screen_queue(&app).await;
    let hits = patient_hits(&app, patient).await;
    assert_eq!(hits.len(), 1, "{hits:?}");
    let hit = hits[0].clone();
    assert_eq!(hit["subject_kind"], "patient_relation", "{hit}");
    assert_eq!(hit["subject_ref"], json!(relation_id));
    assert_eq!(hit["lead_id"], Value::Null);
    assert_eq!(hit["owner_name"], "Anna Muster");
    assert_eq!(hit["list_logical_id"], "900101");
    let subject = &hit["current_subject"];
    assert_eq!(subject["organisation"], false, "{hit}");
    assert_eq!(subject["first_name"], "Testomir", "{hit}");
    assert_eq!(subject["last_name"], "Korneev", "{hit}");
    assert_eq!(subject["residence"], json!(["DE"]), "{hit}");
    assert_eq!(subject["relation"], "default_payer", "{hit}");
    // The CEO is told without the relation's or the patient's name.
    let notifications: Vec<(String, String)> = sqlx::query_as(
        "SELECT title, COALESCE(body, '') FROM user_notifications WHERE user_id = $1 AND kind = 'sanctions_possible_match'",
    )
    .bind(app.ceo_id)
    .fetch_all(app.pool())
    .await
    .unwrap();
    assert_eq!(notifications.len(), 1);
    for (title, body) in &notifications {
        for name in ["Testomir", "Korneev", "Muster"] {
            assert!(
                !title.contains(name) && !body.contains(name),
                "{title} {body}"
            );
        }
    }
    // The hold of any open hit of the patient; the relations list tells
    // nothing.
    let (code, body) = request(
        &app,
        "POST",
        &format!("/patients/{patient}/order-intakes"),
        &app.pm(),
        Some(json!({})),
    )
    .await;
    assert_eq!(code, StatusCode::CONFLICT, "{body}");
    assert_eq!(body["error"], "sanctions_review_pending");
    let (code, relations) = request(
        &app,
        "GET",
        &format!("/patients/{patient}/relations"),
        &app.ceo(),
        None,
    )
    .await;
    assert_eq!(code, StatusCode::OK, "{relations}");
    assert!(!relations.to_string().contains("sanction"), "{relations}");

    // A default payer whose name is not on the list: no hit.
    let other = insert_patient(&app, "Ben", "Muster", "1985-03-03").await;
    save_relation(
        &app,
        other,
        None,
        json!({
            "related_name": "Mia Beispiel",
            "relation_type": "spouse",
            "address_country": "AT",
            "is_default_payer": true
        }),
    )
    .await;
    screen_queue(&app).await;
    assert!(patient_hits(&app, other).await.is_empty());

    // A relation an order names as payer is an invoice recipient: the order
    // queues the patient.
    let friend = save_relation(
        &app,
        other,
        None,
        json!({
            "related_name": "OOO Polartek Shipping",
            "relation_type": "other"
        }),
    )
    .await;
    screen_queue(&app).await;
    assert!(patient_hits(&app, other).await.is_empty());
    let order_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO orders (order_number, patient_id, phase, status, created_by)
           VALUES ($1, $2, 'execution', 'active', $3)
           RETURNING id"#,
    )
    .bind(format!(
        "ORD-REL-{}",
        &Uuid::new_v4().simple().to_string()[..8]
    ))
    .bind(other)
    .bind(app.pm_id)
    .fetch_one(app.pool())
    .await
    .unwrap();
    screen_queue(&app).await;
    sqlx::query("UPDATE orders SET payer_patient_relation_id = $2 WHERE id = $1")
        .bind(order_id)
        .bind(Uuid::parse_str(friend["id"].as_str().unwrap()).unwrap())
        .execute(app.pool())
        .await
        .unwrap();
    assert!(
        patient_is_queued(&app, other).await,
        "the order's payer queues the patient"
    );
    screen_queue(&app).await;
    let order_hits = patient_hits(&app, other).await;
    assert_eq!(order_hits.len(), 1, "{order_hits:?}");
    assert_eq!(order_hits[0]["subject_kind"], "patient_relation");
    assert_eq!(order_hits[0]["list_entry"]["subject_type"], "entity");
    assert_eq!(order_hits[0]["current_subject"]["organisation"], true);
    assert_eq!(
        order_hits[0]["current_subject"]["relation"],
        "invoice_payer"
    );

    // Another name re-screens at once: the open match stays open but no
    // longer matches (a rename never closes a review).
    save_relation(
        &app,
        patient,
        Some(&relation_id),
        json!({
            "related_name": "Viktor Zahler",
            "relation_type": "other",
            "address_country": "DE",
            "is_default_payer": true
        }),
    )
    .await;
    assert!(patient_is_queued(&app, patient).await);
    screen_queue(&app).await;
    let still_matches: bool = sqlx::query_scalar(
        "SELECT still_matches FROM sanctions_hits WHERE patient_id = $1 AND subject_kind = 'patient_relation'",
    )
    .bind(patient)
    .fetch_one(app.pool())
    .await
    .unwrap();
    assert!(!still_matches);
    assert_eq!(patient_hits(&app, patient).await.len(), 1);

    // The CEO's false positive releases the hold.
    decide(
        &app,
        hit["id"].as_str().unwrap(),
        "false_positive",
        "Another person: born in Berlin in 1990, passport checked",
    )
    .await;
    let (_, body) = request(
        &app,
        "POST",
        &format!("/patients/{patient}/order-intakes"),
        &app.pm(),
        Some(json!({})),
    )
    .await;
    assert!(not_a_gate_block(&body), "{body}");
}

/// An order of a patient, as the order intake creates one.
async fn insert_patient_order(app: &TestApp, patient_id: Uuid) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO orders (order_number, patient_id, phase, status, created_by)
           VALUES ($1, $2, 'execution', 'active', $3)
           RETURNING id"#,
    )
    .bind(format!(
        "ORD-RC-{}",
        &Uuid::new_v4().simple().to_string()[..8]
    ))
    .bind(patient_id)
    .bind(app.pm_id)
    .fetch_one(app.pool())
    .await
    .unwrap()
}

/// The agency's countersignature of an order.
async fn countersign(app: &TestApp, order_id: Uuid) -> (StatusCode, Value) {
    request(
        app,
        "POST",
        &format!("/orders/{order_id}/commercial-basis"),
        &app.pm(),
        Some(json!({ "signed_agency": true })),
    )
    .await
}

/// The patient's entry in the CEO's «Страны» tab.
async fn patient_country_block(app: &TestApp, patient_id: Uuid) -> Option<Value> {
    let (code, blocks) = request(app, "GET", "/sanctions/country-blocks", &app.ceo(), None).await;
    assert_eq!(code, StatusCode::OK, "{blocks}");
    blocks["patients"]
        .as_array()
        .unwrap_or_else(|| panic!("no patients: {blocks}"))
        .iter()
        .find(|item| item["patient_id"] == json!(patient_id))
        .cloned()
}

/// Owner rule 2026-10-11 on the patient side (2026-10-12): the country of a
/// relation that pays or receives the invoices holds what the patient's own
/// blocked country holds — the agency countersignature, not other order
/// work — until the CEO lifts it for the patient in the «Страны» tab. The
/// relation and the patient learn nothing.
#[tokio::test]
async fn a_paying_relations_blocked_country_holds_until_the_ceo_lifts_it_for_the_patient() {
    let Some(app) = test_app().await else {
        return;
    };
    // The country policy works without a list (default: RU).
    let patient = insert_patient(&app, "Anna", "Muster", "1990-02-02").await;
    let order_id = insert_patient_order(&app, patient).await;

    // A friend who pays nothing: the country does not count.
    save_relation(
        &app,
        patient,
        None,
        json!({ "related_name": "Mia Beispiel", "relation_type": "friend", "address_country": "RU" }),
    )
    .await;
    let (_, body) = countersign(&app, order_id).await;
    assert!(not_a_gate_block(&body), "{body}");
    assert!(patient_country_block(&app, patient).await.is_none());

    // The default payer lives in a blocked country.
    let payer = save_relation(
        &app,
        patient,
        None,
        json!({
            "related_name": "Viktor Zahler",
            "relation_type": "other",
            "address_street": "Musterweg 1",
            "address_zip": "10115",
            "address_city": "Moskau",
            "address_country": "RU",
            "is_default_payer": true
        }),
    )
    .await;
    let payer_id = payer["id"].as_str().unwrap().to_string();
    let (code, body) = countersign(&app, order_id).await;
    assert_eq!(code, StatusCode::CONFLICT, "{body}");
    assert_eq!(body["error"], "blocked_country");
    assert_eq!(body["countries"], json!(["RU"]));
    // Other order work goes on, as for the patient's own country.
    let (_, body) = request(
        &app,
        "POST",
        &format!("/orders/{order_id}/commercial-basis"),
        &app.pm(),
        Some(json!({ "needs_description": "Check-up" })),
    )
    .await;
    assert!(not_a_gate_block(&body), "{body}");
    let (_, body) = request(
        &app,
        "POST",
        &format!("/patients/{patient}/order-intakes"),
        &app.pm(),
        Some(json!({})),
    )
    .await;
    assert!(not_a_gate_block(&body), "{body}");
    // Nothing about the block in the relations list.
    let (code, relations) = request(
        &app,
        "GET",
        &format!("/patients/{patient}/relations"),
        &app.ceo(),
        None,
    )
    .await;
    assert_eq!(code, StatusCode::OK, "{relations}");
    let text = relations.to_string();
    assert!(
        !text.contains("blocked") && !text.contains("sanction"),
        "{relations}"
    );

    // The CEO sees the patient in the «Страны» tab; nobody else reads it.
    let item = patient_country_block(&app, patient)
        .await
        .expect("the patient is listed");
    assert_eq!(item["flag"], "blocked_country", "{item}");
    assert_eq!(item["blocking"], json!(["RU"]), "{item}");
    assert_eq!(item["name"], "Anna Muster", "{item}");
    assert!(item["patient_number"].is_string(), "{item}");
    let (code, _) = request(&app, "GET", "/sanctions/country-blocks", &app.pm(), None).await;
    assert_eq!(code, StatusCode::FORBIDDEN);

    // Lifting needs the CEO and a reason.
    let lift_path = format!("/sanctions/patients/{patient}/country-override");
    let reason = json!({ "reason": "Payer lives in Germany since 2001, checked" });
    let (code, _) = request(&app, "POST", &lift_path, &app.pm(), Some(reason.clone())).await;
    assert_eq!(code, StatusCode::FORBIDDEN);
    let (code, lift) = request(&app, "POST", &lift_path, &app.ceo(), Some(reason)).await;
    assert_eq!(code, StatusCode::CREATED, "{lift}");
    assert_eq!(lift["countries"], json!(["RU"]), "{lift}");
    assert_eq!(lift["patient_id"], json!(patient), "{lift}");
    let item = patient_country_block(&app, patient).await.unwrap();
    assert_eq!(item["flag"], "country_lifted", "{item}");
    assert_eq!(item["lift"]["lifted_by_name"], "Clara Chefin", "{item}");
    let (_, body) = countersign(&app, order_id).await;
    assert!(not_a_gate_block(&body), "{body}");

    // A country the lift did not cover blocks again.
    let (code, body) = request(
        &app,
        "PUT",
        "/sanctions/settings/blocked-countries",
        &app.ceo(),
        Some(json!({ "countries": ["RU", "BY"] })),
    )
    .await;
    assert_eq!(code, StatusCode::OK, "{body}");
    save_relation(
        &app,
        patient,
        Some(&payer_id),
        json!({
            "related_name": "Viktor Zahler",
            "relation_type": "other",
            "address_country": "BY",
            "is_default_payer": true
        }),
    )
    .await;
    let (code, body) = countersign(&app, order_id).await;
    assert_eq!(code, StatusCode::CONFLICT, "{body}");
    assert_eq!(body["countries"], json!(["BY"]));
    assert_eq!(
        patient_country_block(&app, patient).await.unwrap()["flag"],
        "blocked_country"
    );

    // A minor's parent is the contracting party: its country counts too.
    let child = insert_patient(&app, "Mia", "Muster", "2015-06-01").await;
    let child_order = insert_patient_order(&app, child).await;
    save_relation(
        &app,
        child,
        None,
        json!({ "related_name": "Ben Muster", "relation_type": "parent", "address_country": "RU" }),
    )
    .await;
    let (code, body) = countersign(&app, child_order).await;
    assert_eq!(code, StatusCode::CONFLICT, "{body}");
    assert_eq!(body["error"], "blocked_country");

    let audited: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM audit_log WHERE action = 'sanctions_country_block_lifted' AND entity_type = 'patient' AND entity_id = $1",
    )
    .bind(patient)
    .fetch_one(app.pool())
    .await
    .unwrap();
    assert_eq!(audited, 1);
}

/// The box "Организация" of the relation dialog (2026-10-12) decides how a
/// separate contact is screened; the legal-form guess stays for rows without
/// an answer.
#[tokio::test]
async fn the_organisation_box_screens_a_relation_as_an_organisation() {
    let Some(app) = test_app().await else {
        return;
    };
    load_synthetic_list(&app).await;
    let patient = insert_patient(&app, "Anna", "Muster", "1990-02-02").await;
    screen_queue(&app).await;

    // A company name without a legal form, the box not ticked: a person.
    let relation = save_relation(
        &app,
        patient,
        None,
        json!({
            "related_name": "Polartek Shipping",
            "relation_type": "other",
            "is_default_payer": true,
            "is_organisation": false
        }),
    )
    .await;
    assert_eq!(relation["is_organisation"], false, "{relation}");
    let relation_id = relation["id"].as_str().unwrap().to_string();
    screen_queue(&app).await;
    assert!(patient_hits(&app, patient).await.is_empty());

    // Ticked: an organisation, screened against the listed entities.
    let saved = save_relation(
        &app,
        patient,
        Some(&relation_id),
        json!({
            "related_name": "Polartek Shipping",
            "relation_type": "other",
            "is_default_payer": true,
            "is_organisation": true
        }),
    )
    .await;
    assert_eq!(saved["is_organisation"], true, "{saved}");
    assert!(
        patient_is_queued(&app, patient).await,
        "the box queues the patient"
    );
    screen_queue(&app).await;
    let hits = patient_hits(&app, patient).await;
    assert_eq!(hits.len(), 1, "{hits:?}");
    assert_eq!(hits[0]["subject_kind"], "patient_relation");
    assert_eq!(hits[0]["list_entry"]["subject_type"], "entity");
    assert_eq!(hits[0]["current_subject"]["organisation"], true);
    assert_eq!(hits[0]["current_subject"]["last_name"], "Polartek Shipping");

    // An older client that does not send the box keeps the answer.
    let kept = save_relation(
        &app,
        patient,
        Some(&relation_id),
        json!({
            "related_name": "Polartek Shipping",
            "relation_type": "other",
            "is_default_payer": true
        }),
    )
    .await;
    assert_eq!(kept["is_organisation"], true, "{kept}");
    let stored: Option<bool> =
        sqlx::query_scalar("SELECT is_organisation FROM patient_relations WHERE id = $1")
            .bind(Uuid::parse_str(&relation_id).unwrap())
            .fetch_one(app.pool())
            .await
            .unwrap();
    assert_eq!(stored, Some(true));

    // Rows without an answer (the lead conversion, before the box) show how
    // they are screened: by the legal form in the name.
    let other = insert_patient(&app, "Ben", "Muster", "1985-03-03").await;
    for name in ["Beispiel GmbH", "Viktor Zahler"] {
        sqlx::query(
            "INSERT INTO patient_relations (patient_id, related_name, relation_type) VALUES ($1, $2, 'other')",
        )
        .bind(other)
        .bind(name)
        .execute(app.pool())
        .await
        .unwrap();
    }
    // A linked patient record is a person and stores no answer.
    let linked = save_relation(
        &app,
        other,
        None,
        json!({
            "related_patient_id": patient,
            "related_name": "Anna Muster",
            "relation_type": "sibling",
            "is_organisation": true
        }),
    )
    .await;
    assert_eq!(linked["is_organisation"], false, "{linked}");
    let (code, relations) = request(
        &app,
        "GET",
        &format!("/patients/{other}/relations"),
        &app.ceo(),
        None,
    )
    .await;
    assert_eq!(code, StatusCode::OK, "{relations}");
    let shown = |name: &str| {
        relations
            .as_array()
            .unwrap()
            .iter()
            .find(|relation| relation["related_name"] == name)
            .unwrap_or_else(|| panic!("{name}: {relations}"))["is_organisation"]
            .clone()
    };
    assert_eq!(shown("Beispiel GmbH"), true);
    assert_eq!(shown("Viktor Zahler"), false);
    assert_eq!(shown("Anna Muster"), false);
    let linked_answer: Option<bool> = sqlx::query_scalar(
        "SELECT is_organisation FROM patient_relations WHERE patient_id = $1 AND related_patient_id IS NOT NULL",
    )
    .bind(other)
    .fetch_one(app.pool())
    .await
    .unwrap();
    assert_eq!(linked_answer, None);
}

/// A free-text payer contact of an order or an invoice (`payer_contact_name`,
/// not a relation, 2026-10-12) is screened like the other payers: one subject
/// per name, owned by the patient — or by the lead while its patient is
/// prospective — held until the CEO decides; its country counts for the
/// blocked-country policy. The payer a lead declared, which the declaration
/// writes onto the lead's orders as such a contact, is screened once.
#[tokio::test]
async fn a_free_text_payer_contact_of_an_order_or_invoice_is_screened() {
    let Some(app) = test_app().await else {
        return;
    };
    load_synthetic_list(&app).await;

    // The patient's order names a contact as payer.
    let patient = insert_patient(&app, "Anna", "Muster", "1990-02-02").await;
    let order_id = insert_patient_order(&app, patient).await;
    screen_queue(&app).await;
    assert!(patient_hits(&app, patient).await.is_empty());
    sqlx::query(
        "UPDATE orders SET payer_contact_name = 'Testomir Korneev', payer_address_country = 'AT' WHERE id = $1",
    )
    .bind(order_id)
    .execute(app.pool())
    .await
    .unwrap();
    assert!(
        patient_is_queued(&app, patient).await,
        "the order's payer contact queues the patient"
    );
    screen_queue(&app).await;
    let hits = patient_hits(&app, patient).await;
    assert_eq!(hits.len(), 1, "{hits:?}");
    let hit = hits[0].clone();
    assert_eq!(hit["subject_kind"], "payer_contact", "{hit}");
    assert!(
        hit["subject_ref"]
            .as_str()
            .is_some_and(|reference| reference.starts_with("contact-")),
        "{hit}"
    );
    assert_eq!(hit["lead_id"], Value::Null);
    assert_eq!(hit["owner_name"], "Anna Muster");
    assert_eq!(hit["list_logical_id"], "900101");
    assert_eq!(hit["current_subject"]["first_name"], "Testomir", "{hit}");
    assert_eq!(hit["current_subject"]["last_name"], "Korneev", "{hit}");
    assert_eq!(hit["current_subject"]["relation"], "payer_contact", "{hit}");
    assert_eq!(hit["current_subject"]["residence"], json!(["AT"]), "{hit}");
    // Held like the patient's own hit.
    let (code, body) = request(
        &app,
        "POST",
        &format!("/patients/{patient}/order-intakes"),
        &app.pm(),
        Some(json!({})),
    )
    .await;
    assert_eq!(code, StatusCode::CONFLICT, "{body}");
    assert_eq!(body["error"], "sanctions_review_pending");

    // The same contact on an invoice: one subject, both countries.
    sqlx::query(
        r#"INSERT INTO invoices (order_id, patient_id, invoice_type, status, total_net,
                                 total_vat, total_gross, line_items, portal_visible,
                                 created_by, payer_contact_name, payer_address_country)
           VALUES ($1, $2, 'final', 'draft', 30, 0, 30, '[]', true, $3,
                   'Korneev  Testomir', 'CY')"#,
    )
    .bind(order_id)
    .bind(patient)
    .bind(app.pm_id)
    .execute(app.pool())
    .await
    .unwrap();
    assert!(
        patient_is_queued(&app, patient).await,
        "the invoice's payer contact queues the patient"
    );
    screen_queue(&app).await;
    let hits = patient_hits(&app, patient).await;
    assert_eq!(hits.len(), 1, "{hits:?}");
    assert_eq!(hits[0]["id"], hit["id"]);
    assert_eq!(
        hits[0]["current_subject"]["residence"],
        json!(["AT", "CY"]),
        "{hits:?}"
    );

    // The CEO's false positive releases the hold.
    decide(
        &app,
        hit["id"].as_str().unwrap(),
        "false_positive",
        "Another person: payer's passport and birth date checked",
    )
    .await;
    let (_, body) = countersign(&app, order_id).await;
    assert!(not_a_gate_block(&body), "{body}");
    // The payer's country in the blocked list holds the countersignature
    // until the CEO lifts it for the patient.
    sqlx::query("UPDATE orders SET payer_address_country = 'RU' WHERE id = $1")
        .bind(order_id)
        .execute(app.pool())
        .await
        .unwrap();
    let (code, body) = countersign(&app, order_id).await;
    assert_eq!(code, StatusCode::CONFLICT, "{body}");
    assert_eq!(body["error"], "blocked_country");
    assert_eq!(body["countries"], json!(["RU"]));
    let item = patient_country_block(&app, patient)
        .await
        .expect("the patient is listed");
    assert_eq!(item["blocking"], json!(["RU"]), "{item}");

    // A contact staff named on an open lead's order: the lead's subject.
    let lead = insert_lead(&app, "Mia", "Beispiel", Some("1992-04-04"), &[], json!([])).await;
    assert_eq!(lead_status(&app, lead).await["screening"], "clear");
    let (code, order) = request(
        &app,
        "POST",
        "/orders",
        &app.pm(),
        Some(json!({ "source_lead_id": lead })),
    )
    .await;
    assert_eq!(code, StatusCode::CREATED, "{order}");
    let lead_order = Uuid::parse_str(order["id"].as_str().unwrap()).unwrap();
    sqlx::query(
        "UPDATE orders SET payer_contact_name = 'OOO Polartek Shipping', payer_address_country = 'CY' WHERE id = $1",
    )
    .bind(lead_order)
    .execute(app.pool())
    .await
    .unwrap();
    assert!(
        lead_is_queued(&app, lead).await,
        "the order's payer contact queues the lead"
    );
    let status = lead_status(&app, lead).await;
    assert_eq!(status["screening"], "review_pending", "{status}");
    let hits = lead_hits(&app, lead).await;
    assert_eq!(hits.len(), 1, "{hits:?}");
    assert_eq!(hits[0]["subject_kind"], "payer_contact");
    assert_eq!(hits[0]["patient_id"], Value::Null);
    assert_eq!(hits[0]["current_subject"]["organisation"], true);
    let (code, body) = qualify(&app, lead).await;
    assert_eq!(code, StatusCode::CONFLICT, "{body}");
    assert_eq!(body["error"], "sanctions_review_pending");

    // The payer a lead declared is written onto its orders as a contact: it
    // is screened once, as the lead's payer.
    let paying = insert_lead(&app, "Ben", "Beispiel", Some("1988-08-08"), &[], json!([])).await;
    let (code, order) = request(
        &app,
        "POST",
        "/orders",
        &app.pm(),
        Some(json!({ "source_lead_id": paying })),
    )
    .await;
    assert_eq!(code, StatusCode::CREATED, "{order}");
    let paying_order = Uuid::parse_str(order["id"].as_str().unwrap()).unwrap();
    declare_payer(
        &app,
        paying,
        json!({
            "payer_kind": "third_party",
            "payer_type": "person",
            "first_name": "Testomir",
            "last_name": "Korneev",
            "source_of_funds": "savings"
        }),
    )
    .await;
    let contact: Option<String> =
        sqlx::query_scalar("SELECT payer_contact_name FROM orders WHERE id = $1")
            .bind(paying_order)
            .fetch_one(app.pool())
            .await
            .unwrap();
    assert_eq!(contact.as_deref(), Some("Testomir Korneev"));
    assert_eq!(
        lead_status(&app, paying).await["screening"],
        "review_pending"
    );
    let kinds: Vec<String> = lead_hits(&app, paying)
        .await
        .iter()
        .map(|hit| hit["subject_kind"].as_str().unwrap().to_string())
        .collect();
    assert_eq!(kinds, ["lead_payer"]);
}

/// The order payer dialog ("Плательщик"), as the order group panel sends it.
async fn set_order_payer(app: &TestApp, order_id: Uuid, payer: Value) -> Value {
    let (code, body) = request(
        app,
        "POST",
        &format!("/orders/{order_id}/payer"),
        &app.ceo(),
        Some(payer),
    )
    .await;
    assert_eq!(code, StatusCode::OK, "{body}");
    assert!(!body.to_string().contains("sanction"), "{body}");
    body
}

async fn stored_order_answer(app: &TestApp, order_id: Uuid) -> Option<bool> {
    sqlx::query_scalar("SELECT payer_contact_is_organisation FROM orders WHERE id = $1")
        .bind(order_id)
        .fetch_one(app.pool())
        .await
        .unwrap()
}

/// The box "Организация" of the order and invoice payer dialogs
/// (2026-10-12): a free-text payer contact is screened as an organisation or
/// a person as staff say; the legal-form guess stays for rows without an
/// answer and is what the dialogs show for them.
#[tokio::test]
async fn the_payer_dialogs_organisation_box_screens_a_payer_contact() {
    let Some(app) = test_app().await else {
        return;
    };
    load_synthetic_list(&app).await;
    let patient = insert_patient(&app, "Anna", "Muster", "1990-02-02").await;
    let order_id = insert_patient_order(&app, patient).await;
    screen_queue(&app).await;

    // A company name without a legal form, the box not ticked: a person.
    let contact = |organisation: Option<bool>| {
        let mut payer = json!({
            "payer_contact_name": "Polartek Shipping",
            "payer_address_street": "Hafenweg 1",
            "payer_address_zip": "20457",
            "payer_address_city": "Hamburg",
            "payer_address_country": "DE",
            "payer_role": "cost_bearer"
        });
        if let Some(organisation) = organisation {
            payer["payer_contact_is_organisation"] = json!(organisation);
        }
        payer
    };
    let saved = set_order_payer(&app, order_id, contact(Some(false))).await;
    assert_eq!(saved["payer_contact_is_organisation"], false, "{saved}");
    assert_eq!(stored_order_answer(&app, order_id).await, Some(false));
    screen_queue(&app).await;
    assert!(patient_hits(&app, patient).await.is_empty());
    // An older client that does not send the box keeps the answer.
    set_order_payer(&app, order_id, contact(None)).await;
    assert_eq!(stored_order_answer(&app, order_id).await, Some(false));
    let (code, group) = request(
        &app,
        "GET",
        &format!("/orders/{order_id}/group"),
        &app.ceo(),
        None,
    )
    .await;
    assert_eq!(code, StatusCode::OK, "{group}");
    assert_eq!(group["head"]["payer_contact_is_organisation"], false);

    // Ticked: an organisation, screened against the listed entities.
    let saved = set_order_payer(&app, order_id, contact(Some(true))).await;
    assert_eq!(saved["payer_contact_is_organisation"], true, "{saved}");
    assert!(
        patient_is_queued(&app, patient).await,
        "the box queues the patient"
    );
    screen_queue(&app).await;
    let hits = patient_hits(&app, patient).await;
    assert_eq!(hits.len(), 1, "{hits:?}");
    assert_eq!(hits[0]["subject_kind"], "payer_contact");
    assert_eq!(hits[0]["list_entry"]["subject_type"], "entity");
    assert_eq!(hits[0]["current_subject"]["organisation"], true);
    assert_eq!(hits[0]["current_subject"]["last_name"], "Polartek Shipping");

    // The invoice payer dialog: a row from before the box shows the guess
    // by the legal form; the answer staff give is stored and screened.
    let other = insert_patient(&app, "Ben", "Muster", "1985-03-03").await;
    let other_order = insert_patient_order(&app, other).await;
    let invoice_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO invoices (order_id, patient_id, invoice_type, status, total_net,
                                 total_vat, total_gross, line_items, portal_visible,
                                 created_by, payer_contact_name, payer_address_country)
           VALUES ($1, $2, 'final', 'draft', 30, 0, 30, '[]', true, $3,
                   'Beispiel GmbH', 'DE')
           RETURNING id"#,
    )
    .bind(other_order)
    .bind(other)
    .bind(app.pm_id)
    .fetch_one(app.pool())
    .await
    .unwrap();
    let (code, invoice) = request(
        &app,
        "GET",
        &format!("/invoices/{invoice_id}"),
        &app.ceo(),
        None,
    )
    .await;
    assert_eq!(code, StatusCode::OK, "{invoice}");
    assert_eq!(
        invoice["payer"]["contact_is_organisation"], true,
        "{invoice}"
    );
    screen_queue(&app).await;
    assert!(patient_hits(&app, other).await.is_empty());
    let (code, invoice) = request(
        &app,
        "POST",
        &format!("/invoices/{invoice_id}/payer"),
        &app.ceo(),
        Some(contact(Some(true))),
    )
    .await;
    assert_eq!(code, StatusCode::OK, "{invoice}");
    assert_eq!(
        invoice["payer"]["contact_is_organisation"], true,
        "{invoice}"
    );
    let stored: Option<bool> =
        sqlx::query_scalar("SELECT payer_contact_is_organisation FROM invoices WHERE id = $1")
            .bind(invoice_id)
            .fetch_one(app.pool())
            .await
            .unwrap();
    assert_eq!(stored, Some(true));
    screen_queue(&app).await;
    let hits = patient_hits(&app, other).await;
    assert_eq!(hits.len(), 1, "{hits:?}");
    assert_eq!(hits[0]["subject_kind"], "payer_contact");
    assert_eq!(hits[0]["current_subject"]["organisation"], true);
    // The answer is audited with the payer.
    let audited: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM audit_log WHERE action = 'payer_assigned' AND entity_id = $1 AND (new_value ->> 'payer_contact_is_organisation') = 'true'",
    )
    .bind(invoice_id)
    .fetch_one(app.pool())
    .await
    .unwrap();
    assert_eq!(audited, 1);
}

/// Another patient record named as payer of an order or invoice
/// (`payer_patient_id`, 2026-10-12) is screened as its own patient; its own
/// open or confirmed hit and its countries hold the patient it pays for like
/// a paying relation's. The hit stays the payer record's; the paid-for
/// patient's data say nothing about it.
#[tokio::test]
async fn a_paying_patient_records_hit_holds_the_patient_it_pays_for() {
    let Some(app) = test_app().await else {
        return;
    };
    load_synthetic_list(&app).await;
    let patient = insert_patient(&app, "Anna", "Muster", "1990-02-02").await;
    let payer = insert_patient(&app, "Testomir", "Korneev", "1961-03-14").await;
    screen_queue(&app).await;
    let payer_hits = patient_hits(&app, payer).await;
    assert_eq!(payer_hits.len(), 1, "{payer_hits:?}");
    assert_eq!(payer_hits[0]["subject_kind"], "patient");
    assert!(patient_hits(&app, patient).await.is_empty());
    let intake = |patient_id: Uuid| {
        let app = &app;
        async move {
            request(
                app,
                "POST",
                &format!("/patients/{patient_id}/order-intakes"),
                &app.pm(),
                Some(json!({})),
            )
            .await
        }
    };
    let (_, body) = intake(patient).await;
    assert!(not_a_gate_block(&body), "{body}");

    // The order names the payer's patient record.
    let order_id = insert_patient_order(&app, patient).await;
    set_order_payer(
        &app,
        order_id,
        json!({ "payer_patient_id": payer, "payer_role": "cost_bearer" }),
    )
    .await;
    let (code, body) = intake(patient).await;
    assert_eq!(code, StatusCode::CONFLICT, "{body}");
    assert_eq!(body["error"], "sanctions_review_pending");
    let (code, body) = countersign(&app, order_id).await;
    assert_eq!(code, StatusCode::CONFLICT, "{body}");
    assert_eq!(body["error"], "sanctions_review_pending");
    // The hit stays the payer record's; nothing new for the patient, nothing
    // about it in the patient's order group.
    assert!(patient_hits(&app, patient).await.is_empty());
    let (code, group) = request(
        &app,
        "GET",
        &format!("/orders/{order_id}/group"),
        &app.ceo(),
        None,
    )
    .await;
    assert_eq!(code, StatusCode::OK, "{group}");
    assert!(!group.to_string().contains("sanction"), "{group}");

    // Only the payer record's own hit counts, not the hits of its own
    // relations.
    save_relation(
        &app,
        payer,
        None,
        json!({
            "related_name": "OOO Polartek Shipping",
            "relation_type": "other",
            "is_default_payer": true
        }),
    )
    .await;
    screen_queue(&app).await;
    assert_eq!(patient_hits(&app, payer).await.len(), 2);
    decide(
        &app,
        payer_hits[0]["id"].as_str().unwrap(),
        "false_positive",
        "Another person: payer's passport and birth place checked",
    )
    .await;
    let (_, body) = intake(patient).await;
    assert!(not_a_gate_block(&body), "{body}");
    let (code, body) = intake(payer).await;
    assert_eq!(code, StatusCode::CONFLICT, "{body}");
    assert_eq!(body["error"], "sanctions_review_pending");

    // The payer record's residence in a blocked country holds the agency
    // countersignature until the CEO lifts it for the patient.
    sqlx::query("UPDATE patients SET address_country = 'RU' WHERE id = $1")
        .bind(payer)
        .execute(app.pool())
        .await
        .unwrap();
    let (code, body) = countersign(&app, order_id).await;
    assert_eq!(code, StatusCode::CONFLICT, "{body}");
    assert_eq!(body["error"], "blocked_country");
    assert_eq!(body["countries"], json!(["RU"]));
    let item = patient_country_block(&app, patient)
        .await
        .expect("the patient is listed");
    assert_eq!(item["blocking"], json!(["RU"]), "{item}");
    let (code, lift) = request(
        &app,
        "POST",
        &format!("/sanctions/patients/{patient}/country-override"),
        &app.ceo(),
        Some(json!({ "reason": "Payer lives in Germany since 2001, checked" })),
    )
    .await;
    assert_eq!(code, StatusCode::CREATED, "{lift}");
    assert_eq!(lift["countries"], json!(["RU"]), "{lift}");
    let (_, body) = countersign(&app, order_id).await;
    assert!(not_a_gate_block(&body), "{body}");

    // A confirmed hit of a record an invoice names as payer is final for the
    // patient it pays for too.
    let child = insert_patient(&app, "Mia", "Muster", "2001-06-01").await;
    let second_payer = insert_patient(&app, "Testomir", "Korneev", "1961-03-14").await;
    let child_order = insert_patient_order(&app, child).await;
    screen_queue(&app).await;
    let second_hits = patient_hits(&app, second_payer).await;
    assert_eq!(second_hits.len(), 1, "{second_hits:?}");
    sqlx::query(
        r#"INSERT INTO invoices (order_id, patient_id, invoice_type, status, total_net,
                                 total_vat, total_gross, line_items, portal_visible,
                                 created_by, payer_patient_id)
           VALUES ($1, $2, 'final', 'draft', 30, 0, 30, '[]', true, $3, $4)"#,
    )
    .bind(child_order)
    .bind(child)
    .bind(app.pm_id)
    .bind(second_payer)
    .execute(app.pool())
    .await
    .unwrap();
    decide(
        &app,
        second_hits[0]["id"].as_str().unwrap(),
        "confirmed",
        "Name, birth date and citizenship match",
    )
    .await;
    let (code, body) = intake(child).await;
    assert_eq!(code, StatusCode::CONFLICT, "{body}");
    assert_eq!(body["error"], "sanctions_confirmed");
    assert_eq!(body["permanent"], true);
    // The child's own hit list stays empty.
    let child_hits: i64 =
        sqlx::query_scalar("SELECT count(*) FROM sanctions_hits WHERE patient_id = $1")
            .bind(child)
            .fetch_one(app.pool())
            .await
            .unwrap();
    assert_eq!(child_hits, 0);
}
