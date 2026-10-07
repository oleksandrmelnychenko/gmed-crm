//! The points-based risk assessment of leads ("Trigger-Ablauf", owner spec
//! 2026-10-07): staff API, decisions with four eyes at level 3, the gate,
//! the ratchet and what the lead cabinet sees (neutral follow-up blocks
//! only). Synthetic data only.

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
const PDF: &[u8] = b"%PDF-1.4\n% synthetic identity document\n%%EOF\n";

struct TestApp {
    suite: support::TestSuiteContext,
    ceo_id: Uuid,
    pm_id: Uuid,
    sales_id: Uuid,
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
        "risk-{role}-{}@example.com",
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
    Some(TestApp {
        suite,
        ceo_id,
        pm_id,
        sales_id,
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

async fn upload(app: &TestApp, path: &str, bearer: &str) -> (StatusCode, Value) {
    let boundary = format!("----gmed-risk-{}", Uuid::new_v4().simple());
    let mut body = Vec::new();
    body.extend_from_slice(format!("--{boundary}\r\n").as_bytes());
    body.extend_from_slice(
        b"Content-Disposition: form-data; name=\"file\"; filename=\"pass.pdf\"\r\nContent-Type: application/pdf\r\n\r\n",
    );
    body.extend_from_slice(PDF);
    body.extend_from_slice(format!("\r\n--{boundary}--\r\n").as_bytes());
    let req = Request::builder()
        .method("POST")
        .uri(format!("/api/v1{path}"))
        .header("Authorization", bearer)
        .header(
            "Content-Type",
            format!("multipart/form-data; boundary={boundary}"),
        )
        .body(Body::from(body))
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

/// A lead staff work without a cabinet submit, with its citizenships.
async fn insert_lead(app: &TestApp, first_name: &str, citizenships: &[&str]) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO leads (first_name, last_name, date_of_birth, citizenships, country,
                              email, created_by)
           VALUES ($1, 'Muster', '1980-04-02', $2, 'DE', $3, $4)
           RETURNING id"#,
    )
    .bind(first_name)
    .bind(
        citizenships
            .iter()
            .map(|code| code.to_string())
            .collect::<Vec<_>>(),
    )
    .bind(format!("lead-{}@example.com", Uuid::new_v4().simple()))
    .bind(app.pm_id)
    .fetch_one(app.pool())
    .await
    .unwrap()
}

async fn assessment(app: &TestApp, lead_id: Uuid) -> Value {
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

async fn stored_rows(app: &TestApp, lead_id: Uuid) -> i64 {
    sqlx::query_scalar("SELECT count(*) FROM lead_risk_assessments WHERE lead_id = $1")
        .bind(lead_id)
        .fetch_one(app.pool())
        .await
        .unwrap()
}

fn trigger<'a>(body: &'a Value, key: &str, subject: &str) -> Option<&'a Value> {
    body["triggers"]
        .as_array()
        .unwrap()
        .iter()
        .find(|trigger| trigger["key"] == key && trigger["subject"] == subject)
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

fn held(response: &(StatusCode, Value)) -> bool {
    response.0 == StatusCode::CONFLICT && response.1["error"] == "risk_review_required"
}

async fn decide(app: &TestApp, bearer: &str, lead_id: Uuid, body: Value) -> (StatusCode, Value) {
    request(
        app,
        "POST",
        &format!("/leads/{lead_id}/risk-assessment/decisions"),
        bearer,
        Some(body),
    )
    .await
}

#[tokio::test]
async fn staff_see_the_preview_then_the_assessment_decide_and_the_gate_follows() {
    let Some(app) = test_app().await else { return };
    // An Iranian citizen (list 2) without an identity document on file.
    let lead_id = insert_lead(&app, "Anna", &["IR"]).await;

    // Before the start nothing is stored: a live preview only.
    let before = assessment(&app, lead_id).await;
    assert!(before["started_at"].is_null(), "{before}");
    assert!(before["status"].is_null());
    assert_eq!(before["preview"]["level"], 2, "{before}");
    assert_eq!(before["preview"]["points"], 6);
    assert_eq!(stored_rows(&app, lead_id).await, 0);
    // The concierge (service side of a lead only) may not read it.
    let concierge = seed_user(app.pool(), "concierge", "Conny Concierge").await;
    let (status, _) = request(
        &app,
        "GET",
        &format!("/leads/{lead_id}/risk-assessment"),
        &app.bearer(concierge, "concierge"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    // The first gated call starts it and holds: level 2, nobody released.
    assert!(held(&qualify(&app, lead_id).await));
    let started = assessment(&app, lead_id).await;
    assert!(started["started_at"].is_string(), "{started}");
    assert_eq!(started["level"], 2);
    assert_eq!(started["patient_points"], 6);
    assert_eq!(started["points"], 6);
    let t1 = trigger(&started, "T1", "patient").expect("T1");
    assert_eq!(t1["variant"], "list_2");
    assert_eq!(t1["points"], 4);
    assert!(trigger(&started, "T12", "patient").is_some());
    // Level 2: the blocks of the triggers are open (F for the country, I
    // for the identity document).
    assert_eq!(started["blocks"]["F"]["open"], true, "{started}");
    assert_eq!(started["blocks"]["I"]["open"], true);
    assert_eq!(started["blocks"]["A"]["open"], false);
    assert_eq!(started["status"], "awaiting_answers");
    assert_eq!(started["four_eyes_required"], false);
    assert!(started["preview"].is_null());

    // Only reviewers decide, always with a reason.
    let (status, _) = decide(
        &app,
        &app.pm(),
        lead_id,
        json!({ "decision": "release", "reason": "Identity verified in person" }),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, body) = decide(
        &app,
        &app.ceo(),
        lead_id,
        json!({ "decision": "release", "reason": "ok" }),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(body["code"], "reason_required");
    let (status, body) = decide(
        &app,
        &app.ceo(),
        lead_id,
        json!({ "decision": "request_more", "reason": "Please describe the stay", "blocks": ["Z"] }),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");

    // Level 2: one reviewer releases at once; the gate lets the lead pass.
    let (status, released) = decide(
        &app,
        &app.ceo(),
        lead_id,
        json!({ "decision": "release", "reason": "Residence and identity checked in the video call" }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{released}");
    assert_eq!(released["status"], "released");
    assert!(!held(&qualify(&app, lead_id).await));

    // The ratchet: correcting the citizenship lowers nothing.
    sqlx::query("UPDATE leads SET citizenships = '{DE}' WHERE id = $1")
        .bind(lead_id)
        .execute(app.pool())
        .await
        .unwrap();
    let corrected = assessment(&app, lead_id).await;
    assert_eq!(corrected["level"], 2);
    assert_eq!(corrected["points"], 6);
    assert_eq!(
        trigger(&corrected, "T1", "patient").unwrap()["active"],
        false
    );
    assert_eq!(corrected["status"], "released");

    // A new trigger voids the release: a third party pays in cash.
    sqlx::query(
        r#"INSERT INTO lead_payer_declarations
               (lead_id, payer_kind, payer_type, first_name, last_name, relationship_kind,
                payment_method)
           VALUES ($1, 'third_party', 'person', 'Viktor', 'Zahler', 'friend', 'cash')"#,
    )
    .bind(lead_id)
    .execute(app.pool())
    .await
    .unwrap();
    let raised = assessment(&app, lead_id).await;
    assert_ne!(raised["status"], "released", "{raised}");
    // T4 1 + T5 2 + T9 4 = 7 for the payer; the higher subject counts.
    assert_eq!(raised["payer_points"], 7, "{raised}");
    assert_eq!(raised["points"], 7);
    assert!(held(&qualify(&app, lead_id).await));
    // History and decisions are kept.
    let kinds: Vec<&str> = raised["history"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|event| event["kind"].as_str())
        .collect();
    assert!(
        kinds.contains(&"started") && kinds.contains(&"raised"),
        "{kinds:?}"
    );
    assert_eq!(raised["decisions"].as_array().unwrap().len(), 1);
    let audited: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM audit_log WHERE action = 'lead_risk_decision' AND entity_id = $1",
    )
    .bind(lead_id)
    .fetch_one(app.pool())
    .await
    .unwrap();
    assert_eq!(audited, 1);
    // The history is append-only.
    let rewrite = sqlx::query("UPDATE lead_risk_events SET cause = 'staff' WHERE lead_id = $1")
        .bind(lead_id)
        .execute(app.pool())
        .await;
    assert!(rewrite.is_err());
}

#[tokio::test]
async fn level_three_needs_two_different_reviewers() {
    let Some(app) = test_app().await else { return };
    // The CEO names the patient manager a deputy reviewer; Sales cannot be one.
    let (status, config) = request(&app, "GET", "/compliance/risk-config", &app.ceo(), None).await;
    assert_eq!(status, StatusCode::OK, "{config}");
    assert_eq!(config["level_3_from"], 9);
    let mut wrong = config.clone();
    wrong["reviewers"] = json!([app.sales_id]);
    let (status, body) = request(
        &app,
        "PUT",
        "/compliance/risk-config",
        &app.ceo(),
        Some(wrong),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
    let (status, _) = request(
        &app,
        "PUT",
        "/compliance/risk-config",
        &app.pm(),
        Some(config.clone()),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let mut deputies = config.clone();
    deputies["reviewers"] = json!([app.pm_id]);
    let (status, stored) = request(
        &app,
        "PUT",
        "/compliance/risk-config",
        &app.ceo(),
        Some(deputies),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{stored}");
    assert_eq!(stored["version"], config["version"].as_i64().unwrap() + 1);
    assert_eq!(stored["reviewers"], json!([app.pm_id]));
    assert!(stored["reviewers_available"].as_u64().unwrap() >= 2);

    // A PEP (the lead's own "yes") is a knock-out: level 3.
    let lead_id = insert_lead(&app, "Ben", &["DE"]).await;
    sqlx::query("INSERT INTO lead_gwg_declarations (lead_id, pep_self) VALUES ($1, true)")
        .bind(lead_id)
        .execute(app.pool())
        .await
        .unwrap();
    let (status, restarted) = request(
        &app,
        "POST",
        &format!("/leads/{lead_id}/risk-assessment/restart"),
        &app.ceo(),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{restarted}");
    assert_eq!(restarted["level"], 3);
    assert_eq!(restarted["knockout"], true);
    assert_eq!(restarted["four_eyes_required"], true);

    // The CEO proposes the release: nothing is effective yet.
    let (status, proposed) = decide(
        &app,
        &app.ceo(),
        lead_id,
        json!({ "decision": "release", "reason": "Former local councillor, checked sources" }),
    )
    .await;
    assert_eq!(status, StatusCode::ACCEPTED, "{proposed}");
    assert_eq!(proposed["status"], "proposed");
    let proposal_id = proposed["pending_proposal"]["id"]
        .as_str()
        .unwrap()
        .to_string();
    assert!(held(&qualify(&app, lead_id).await));
    // A second proposal waits for the first.
    let (status, _) = decide(
        &app,
        &app.pm(),
        lead_id,
        json!({ "decision": "reject", "reason": "Second opinion: refuse the client" }),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    // The proposer cannot confirm the own proposal.
    let (status, body) = request(
        &app,
        "POST",
        &format!("/leads/{lead_id}/risk-assessment/decisions/{proposal_id}/confirm"),
        &app.ceo(),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(body["code"], "four_eyes_same_user");
    // The deputy confirms: released, the gate lets the lead pass.
    let (status, confirmed) = request(
        &app,
        "POST",
        &format!("/leads/{lead_id}/risk-assessment/decisions/{proposal_id}/confirm"),
        &app.pm(),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{confirmed}");
    assert_eq!(confirmed["status"], "released");
    assert!(confirmed["pending_proposal"].is_null());
    assert!(!held(&qualify(&app, lead_id).await));
    // The database refuses the same person confirming, too.
    let own = sqlx::query(
        r#"INSERT INTO lead_risk_decisions
               (lead_id, decision, reason, level, fingerprint, decided_by, confirms_decision_id)
           VALUES ($1, 'release', 'Confirmed by myself again', 3, 'x', $2, $3)"#,
    )
    .bind(lead_id)
    .bind(app.ceo_id)
    .bind(Uuid::parse_str(&proposal_id).unwrap())
    .execute(app.pool())
    .await;
    assert!(own.is_err());

    // A stale proposal: the assessment changes before the confirmation.
    let other = insert_lead(&app, "Mia", &["DE"]).await;
    sqlx::query("INSERT INTO lead_gwg_declarations (lead_id, sanctions_links) VALUES ($1, true)")
        .bind(other)
        .execute(app.pool())
        .await
        .unwrap();
    assert!(held(&qualify(&app, other).await));
    let (status, proposed) = decide(
        &app,
        &app.pm(),
        other,
        json!({ "decision": "reject", "reason": "Business ties to a listed company" }),
    )
    .await;
    assert_eq!(status, StatusCode::ACCEPTED, "{proposed}");
    let proposal_id = proposed["pending_proposal"]["id"]
        .as_str()
        .unwrap()
        .to_string();
    sqlx::query("UPDATE leads SET citizenships = '{SY}' WHERE id = $1")
        .bind(other)
        .execute(app.pool())
        .await
        .unwrap();
    let (status, body) = request(
        &app,
        "POST",
        &format!("/leads/{other}/risk-assessment/decisions/{proposal_id}/confirm"),
        &app.ceo(),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{body}");
    assert_eq!(body["code"], "assessment_changed");
    // The proposer withdraws it; the queue lists the lead for review.
    let (status, withdrawn) = request(
        &app,
        "POST",
        &format!("/leads/{other}/risk-assessment/decisions/{proposal_id}/withdraw"),
        &app.pm(),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{withdrawn}");
    assert!(withdrawn["pending_proposal"].is_null());
    let (status, queue) = request(&app, "GET", "/compliance/risk-reviews", &app.ceo(), None).await;
    assert_eq!(status, StatusCode::OK, "{queue}");
    assert!(
        queue["items"]
            .as_array()
            .unwrap()
            .iter()
            .any(|item| item["lead_id"] == json!(other))
    );
    let (status, _) = request(&app, "GET", "/compliance/risk-reviews", &app.sales(), None).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

/// Every key of a JSON value, recursively.
fn keys(value: &Value, into: &mut Vec<String>) {
    match value {
        Value::Object(object) => {
            for (key, value) in object {
                into.push(key.clone());
                keys(value, into);
            }
        }
        Value::Array(items) => {
            for item in items {
                keys(item, into);
            }
        }
        _ => {}
    }
}

#[tokio::test]
async fn the_cabinet_sees_neutral_follow_up_blocks_only() {
    let Some(app) = test_app().await else { return };
    let (status, created) = request(
        &app,
        "POST",
        "/leads",
        &app.pm(),
        Some(json!({ "first_name": "Anna", "last_name": "Muster", "email": format!("anna-{}@example.com", Uuid::new_v4().simple()) })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{created}");
    let lead_id: Uuid = created["id"].as_str().unwrap().parse().unwrap();
    let user_id: Uuid = created["portal_account"]["user_id"]
        .as_str()
        .unwrap()
        .parse()
        .unwrap();
    let patient = app.bearer(user_id, "patient");
    let path = format!("/me/lead-requests/{lead_id}");

    // Before the submit nothing is scored, the cabinet sees nothing to add.
    let (status, request_object) = request(&app, "GET", &path, &patient, None).await;
    assert_eq!(status, StatusCode::OK, "{request_object}");
    assert_eq!(request_object["follow_up"]["required"], false);
    assert_eq!(request_object["review_notice"], false);
    assert!(request_object.get("enhanced_check").is_none());
    assert!(request_object.get("extra_questions").is_none());
    assert!(
        request_object["progress"]["missing_by_step"]["documents"]
            .as_array()
            .unwrap()
            .contains(&json!("request_reason")),
        "{request_object}"
    );
    assert_eq!(stored_rows(&app, lead_id).await, 0);

    // Staff's identity data are not the lead's: 422 staff_only.
    let (status, body) = request(
        &app,
        "POST",
        &format!("{path}/identification"),
        &patient,
        Some(json!({ "id_document_number": "AB123456" })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(body["code"], "staff_only");
    assert_eq!(body["field"], "id_document_number");

    // The lead's reason of the request is the lead's own text.
    let (status, body) = request(
        &app,
        "POST",
        &format!("{path}/identification"),
        &patient,
        Some(json!({ "request_reason": "Zweitmeinung zur Knie-OP" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(
        body["identification"]["request_reason"],
        "Zweitmeinung zur Knie-OP"
    );
    assert!(body["identification"].get("id_document_number").is_none());
    assert!(
        !body["progress"]["missing_for_submit"]
            .as_array()
            .unwrap()
            .contains(&json!("request_reason"))
    );

    // An Iranian citizen without a document: staff start the assessment.
    sqlx::query("UPDATE leads SET citizenships = '{IR}' WHERE id = $1")
        .bind(lead_id)
        .execute(app.pool())
        .await
        .unwrap();
    let (status, _) = request(
        &app,
        "POST",
        &format!("/leads/{lead_id}/risk-assessment/restart"),
        &app.ceo(),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (status, request_object) = request(&app, "GET", &path, &patient, None).await;
    assert_eq!(status, StatusCode::OK);
    let follow_up = &request_object["follow_up"];
    assert_eq!(follow_up["required"], true, "{follow_up}");
    assert_eq!(follow_up["blocks"], json!(["F", "I"]));
    assert_eq!(
        follow_up["missing"]["F"],
        json!(["residence_since", "stay_reason"])
    );
    assert_eq!(follow_up["missing"]["I"], json!(["id_document_upload"]));
    // No points, level, triggers, reasons or decisions anywhere (P2).
    let mut all_keys = Vec::new();
    keys(&request_object, &mut all_keys);
    for forbidden in [
        "points",
        "patient_points",
        "payer_points",
        "level",
        "check_level",
        "triggers",
        "trigger",
        "knockout",
        "risk",
        "risk_assessment",
        "decision",
        "decisions",
        "reasons",
        "check_reasons",
    ] {
        assert!(
            !all_keys.iter().any(|key| key == forbidden),
            "the cabinet must not see `{forbidden}`"
        );
    }
    let text = request_object.to_string();
    for word in ["list_2", "knock", "review_required", "awaiting_answers"] {
        assert!(!text.contains(word), "{word}");
    }

    // Answers: F first; the follow-up cannot be sent while I misses the upload.
    let (status, _) = request(
        &app,
        "POST",
        &format!("{path}/identification"),
        &patient,
        Some(json!({ "residence_since": "2019", "stay_reason": "work" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let (status, body) = request(
        &app,
        "POST",
        &format!("{path}/follow-up/submit"),
        &patient,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
    assert_eq!(body["code"], "follow_up_incomplete");
    assert_eq!(body["missing"], json!({ "I": ["id_document_upload"] }));

    let (status, _) = request(
        &app,
        "POST",
        &format!("{path}/consent"),
        &patient,
        Some(json!({ "purpose": "lead_inquiry_processing", "version": CONSENT_VERSION, "language": "de" })),
    )
    .await;
    assert!(status.is_success());
    let (status, body) = upload(&app, &format!("{path}/identity-document"), &patient).await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    let (status, sent) = request(
        &app,
        "POST",
        &format!("{path}/follow-up/submit"),
        &patient,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{sent}");
    assert!(sent["follow_up"]["answered_at"].is_string(), "{sent}");

    // Staff: the blocks are answered, the lead waits for the review.
    let staff = assessment(&app, lead_id).await;
    assert_eq!(staff["status"], "review_required", "{staff}");
    assert!(staff["follow_up_answered_at"].is_string());
    assert_eq!(staff["blocks"]["F"]["answered"], true);
    // Staff enter the document data (a past validity is accepted: T12).
    let (status, data) = request(
        &app,
        "PUT",
        &format!("/leads/{lead_id}/identity-document-data"),
        &app.pm(),
        Some(json!({ "id_document_type": "passport", "id_document_number": "AB123456", "id_valid_until": "2020-01-31" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{data}");
    assert_eq!(data["id_data_entered_by_name"], "Paula Manager");
    // The reason of the request is medical: staff with medical access only.
    let (status, intake) = request(
        &app,
        "GET",
        &format!("/leads/{lead_id}/portal-intake"),
        &app.pm(),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{intake}");
    assert_eq!(
        intake["patient_request_reason"]["text"],
        "Zweitmeinung zur Knie-OP"
    );
    assert_eq!(intake["identification"]["residence_since"], "2019");
    let (status, intake) = request(
        &app,
        "GET",
        &format!("/leads/{lead_id}/portal-intake"),
        &app.sales(),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{intake}");
    assert!(intake["patient_request_reason"].is_null());

    // After the release the cabinet has nothing more to add.
    let (status, _) = decide(
        &app,
        &app.ceo(),
        lead_id,
        json!({ "decision": "release", "reason": "Residence and identity are plausible" }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let (_, request_object) = request(&app, "GET", &path, &patient, None).await;
    assert_eq!(request_object["follow_up"]["required"], false);
    assert_eq!(request_object["follow_up"]["blocks"], json!([]));
}
