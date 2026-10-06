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
