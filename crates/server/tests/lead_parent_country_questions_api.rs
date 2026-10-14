//! Contracting parents have independent country follow-up answers. Synthetic data only.
mod support;

use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use gmed_server::{auth::jwt, risk};
use serde_json::{Value, json};
use sqlx::PgPool;
use tower::ServiceExt;
use uuid::Uuid;

const SECRET: &str = "test-secret-at-least-32-characters-long!!";

struct App {
    suite: support::TestSuiteContext,
    pm: Uuid,
    parent: Uuid,
    lead: Uuid,
    first: Uuid,
    second: Uuid,
}

fn bearer(id: Uuid, role: &str) -> String {
    format!(
        "Bearer {}",
        jwt::issue_access_token(SECRET, id, role, Uuid::new_v4()).unwrap()
    )
}

async fn user(pool: &PgPool, role: &str) -> Uuid {
    sqlx::query_scalar("INSERT INTO users(email,password_hash,name,role) VALUES($1,'synthetic','Synthetic parent',$2) RETURNING id")
        .bind(format!("parent-{}@example.com", Uuid::new_v4())).bind(role).fetch_one(pool).await.unwrap()
}

async fn fixture(first_country: &str, second_country: &str) -> Option<App> {
    let suite = support::suite_context(SECRET).await?;
    let pm = user(&suite.pool, "patient_manager").await;
    let parent = user(&suite.pool, "patient").await;
    let first = Uuid::new_v4();
    let second = Uuid::new_v4();
    let lead = sqlx::query_scalar("INSERT INTO leads(first_name,last_name,date_of_birth,citizenships,country,email,created_by,trusted_contacts) VALUES('Mila','Synthetic','2016-04-04',ARRAY['DE'],'DE',$1,$2,$3) RETURNING id")
        .bind(format!("child-{}@example.com", Uuid::new_v4())).bind(pm)
        .bind(json!([
            {"id":first,"name":"Anna Synthetic","relation":"parent","birth_date":"1985-03-02","email":"anna@example.com"},
            {"id":second,"name":"Ben Synthetic","relation":"parent","birth_date":"1984-03-02","email":"ben@example.com"}
        ])).fetch_one(&suite.pool).await.unwrap();
    for (id, country) in [(first, first_country), (second, second_country)] {
        sqlx::query("INSERT INTO lead_representatives(lead_id,contact_id,role,contact_origin,citizenships,country) VALUES($1,$2,'legal_representative','staff',$3,'DE')")
            .bind(lead).bind(id).bind(vec![country.to_string()]).execute(&suite.pool).await.unwrap();
    }
    sqlx::query("INSERT INTO lead_gwg_declarations(lead_id,custody) VALUES($1,'joint')")
        .bind(lead)
        .execute(&suite.pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO lead_portal_access(lead_id,user_id,kind,trusted_contact_id,created_by) VALUES($1,$2,'guardian',$3,$4)")
        .bind(lead).bind(parent).bind(first).bind(pm).execute(&suite.pool).await.unwrap();
    let document = Uuid::new_v4();
    sqlx::query("INSERT INTO documents(id,version_root_document_id,lead_id,auto_name,art,category,status,visibility,is_medical,mime_type,uploaded_by,compliance_kind) VALUES($1,$1,$2,'Synthetic identity','report','administrative','active','internal',false,'application/pdf',$3,'identity')")
        .bind(document).bind(lead).bind(pm).execute(&suite.pool).await.unwrap();
    let config = risk::RiskConfig {
        list_1: vec!["RU".into(), "CA".into()],
        list_2: vec!["IR".into()],
        ..Default::default()
    };
    sqlx::query("INSERT INTO system_settings(key,value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value")
        .bind(risk::CONFIG_SETTING).bind(serde_json::to_value(config).unwrap()).execute(&suite.pool).await.unwrap();
    let app = App {
        suite,
        pm,
        parent,
        lead,
        first,
        second,
    };
    let (status, body) = request(
        &app,
        "POST",
        &format!("/me/lead-requests/{lead}/consent"),
        parent,
        "patient",
        Some(json!({"purpose":"lead_inquiry_processing","version":"2026-10-03","language":"de"})),
    )
    .await;
    assert!(
        matches!(status, StatusCode::OK | StatusCode::CREATED),
        "{body}"
    );
    Some(app)
}

async fn request(
    app: &App,
    method: &str,
    path: &str,
    actor: Uuid,
    role: &str,
    value: Option<Value>,
) -> (StatusCode, Value) {
    let body = value
        .map(|body| Body::from(serde_json::to_vec(&body).unwrap()))
        .unwrap_or_else(Body::empty);
    let req = Request::builder()
        .method(method)
        .uri(format!("/api/v1{path}"))
        .header("Authorization", bearer(actor, role))
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

async fn read(app: &App) -> Value {
    let (status, body) = request(
        app,
        "GET",
        &format!("/me/lead-requests/{}", app.lead),
        app.parent,
        "patient",
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    body
}

async fn paper_request(app: &App, document: Uuid, actor: Uuid, role: &str) -> (StatusCode, Value) {
    let req = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/documents/{document}/paper-signature"))
        .header("Authorization", bearer(actor, role))
        .header(
            "Content-Type",
            "multipart/form-data; boundary=synthetic-parent-test",
        )
        .body(Body::from("--synthetic-parent-test--\r\n"))
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

async fn save(app: &App, id: Uuid, fields: Value) -> Value {
    let (status, body) = request(
        app,
        "POST",
        &format!(
            "/me/lead-requests/{}/representatives/{id}/country-questions",
            app.lead
        ),
        app.parent,
        "patient",
        Some(fields),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    body
}

fn no_answers() -> Value {
    json!({"birth_place":"Synthetic birthplace","birth_country":"DE","residence_since":"2015","stay_reason":"family","pep_self":false,"pep_related":false,"sanctions_links":false})
}

async fn assert_draft_pure(app: &App) {
    let counts: (i64,i64) = sqlx::query_as("SELECT (SELECT count(*) FROM lead_risk_assessments WHERE lead_id=$1),(SELECT count(*) FROM lead_risk_events WHERE lead_id=$1)")
        .bind(app.lead).fetch_one(&app.suite.pool).await.unwrap();
    assert_eq!(counts, (0, 0));
}

#[tokio::test]
async fn only_the_listed_parent_gets_a_pure_preview_without_child_questions_or_account_dependency()
{
    let Some(app) = fixture("DE", "RU").await else {
        return;
    };
    let body = read(&app).await;
    assert_eq!(body["follow_up"]["before_submit"], true, "{body}");
    assert_eq!(body["follow_up"]["blocks"], json!(["R"]), "{body}");
    let people = body["follow_up"]["representatives"].as_array().unwrap();
    assert_eq!(people.len(), 1);
    assert_eq!(
        people[0]["id"],
        json!(app.second),
        "the second parent has no portal account"
    );
    for key in [
        "birth_place",
        "birth_country",
        "pep_self",
        "pep_related",
        "sanctions_links",
    ] {
        assert!(
            people[0]["fields"][key].is_null(),
            "no declaration is guessed"
        );
        if !matches!(key, "birth_place" | "birth_country") {
            assert!(
                body["identification"][key].is_null(),
                "the child's answer is separate"
            );
        }
        assert!(
            body["follow_up"]["missing"]["R"]
                .as_array()
                .unwrap()
                .contains(&json!(format!("representative:{}:{key}", app.second)))
        );
    }
    assert_draft_pure(&app).await;
    let (status, staff) = request(
        &app,
        "GET",
        &format!("/leads/{}/risk-assessment", app.lead),
        app.pm,
        "patient_manager",
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{staff}");
    assert!(staff["points"].is_null());
    assert_eq!(staff["blocks"]["R"]["open"], true);
    assert_eq!(staff["representatives"][0]["name"], "Ben Synthetic");
    assert_eq!(staff["preview"]["patient_points"], 3);
    assert_draft_pure(&app).await;
    sqlx::query("UPDATE lead_representatives SET citizenships=ARRAY['DE'] WHERE lead_id=$1 AND contact_id=$2")
        .bind(app.lead).bind(app.second).execute(&app.suite.pool).await.unwrap();
    let cleared = read(&app).await;
    assert_eq!(
        cleared["follow_up"]["required"], false,
        "draft country correction removes preview"
    );
    assert_eq!(cleared["follow_up"]["representatives"], json!([]));
    assert_draft_pure(&app).await;
}

#[tokio::test]
async fn existing_parent_birth_data_is_prefilled_without_freezing_it_on_question_saves() {
    let Some(app) = fixture("RU", "DE").await else {
        return;
    };
    let source: Uuid = sqlx::query_scalar("INSERT INTO leads(first_name,last_name,date_of_birth,citizenships,country,email,created_by) VALUES('Anna','Canonical','1985-03-02',ARRAY['AT'],'AT',$1,$2) RETURNING id")
        .bind(format!("source-{}@example.com", Uuid::new_v4())).bind(app.pm).fetch_one(&app.suite.pool).await.unwrap();
    sqlx::query("INSERT INTO lead_gwg_declarations(lead_id,birth_place,birth_country) VALUES($1,'Canonical birthplace','AT')")
        .bind(source).execute(&app.suite.pool).await.unwrap();
    let linked: Uuid = sqlx::query_scalar("INSERT INTO patients(patient_id,first_name,last_name,birth_date,gender,citizenships,residence_country,address_country,source_lead_id,created_by) VALUES($1,'Anna','Canonical','1985-03-02','female',ARRAY['AT'],'AT','AT',$2,$3) RETURNING id")
        .bind(format!("P-PARENT-{}", Uuid::new_v4().simple())).bind(source).bind(app.pm).fetch_one(&app.suite.pool).await.unwrap();
    sqlx::query("UPDATE leads SET trusted_contacts=jsonb_set(trusted_contacts,'{0,related_patient_id}',to_jsonb($2::uuid)) WHERE id=$1")
        .bind(app.lead).bind(linked).execute(&app.suite.pool).await.unwrap();
    let first = read(&app).await;
    let person = &first["follow_up"]["representatives"][0];
    assert_eq!(person["id"], json!(app.first));
    assert_eq!(person["fields"]["birth_place"], "Canonical birthplace");
    assert_eq!(person["fields"]["birth_country"], "AT");
    let missing = person["missing"].as_array().unwrap();
    assert!(!missing.contains(&json!("birth_place")));
    assert!(!missing.contains(&json!("birth_country")));
    save(&app, app.first, json!({"pep_self":false})).await;
    let stored: (Option<String>, Option<String>, Value) = sqlx::query_as("SELECT birth_place,birth_country,country_questions FROM lead_representatives WHERE lead_id=$1 AND contact_id=$2")
        .bind(app.lead).bind(app.first).fetch_one(&app.suite.pool).await.unwrap();
    assert_eq!((stored.0, stored.1), (None, None));
    assert!(stored.2.get("birth_place").is_none());
    assert!(stored.2.get("birth_country").is_none());
    sqlx::query("UPDATE lead_gwg_declarations SET birth_place='Corrected canonical birthplace',birth_country='CH' WHERE lead_id=$1")
        .bind(source).execute(&app.suite.pool).await.unwrap();
    let refreshed = read(&app).await;
    let person = &refreshed["follow_up"]["representatives"][0];
    assert_eq!(
        person["fields"]["birth_place"],
        "Corrected canonical birthplace"
    );
    assert_eq!(person["fields"]["birth_country"], "CH");
    assert_draft_pure(&app).await;
}

#[tokio::test]
async fn birth_only_question_updates_use_basic_identity_and_close_pending_invitations() {
    let Some(app) = fixture("RU", "DE").await else {
        return;
    };
    let questions = json!({"pep_self":false,"pep_related":false,"sanctions_links":false,"residence_since":"2015","stay_reason":"family"});
    sqlx::query(
        "UPDATE lead_representatives SET country_questions=$3 WHERE lead_id=$1 AND contact_id=$2",
    )
    .bind(app.lead)
    .bind(app.first)
    .bind(&questions)
    .execute(&app.suite.pool)
    .await
    .unwrap();
    let source = Uuid::new_v4();
    sqlx::query("INSERT INTO documents(id,version_root_document_id,lead_id,auto_name,art,category,status,visibility,is_medical,uploaded_by,generated_template_id) VALUES($1,$1,$2,'Synthetic contract','report','administrative','active','internal',false,$3,'framework_contract')")
        .bind(source).bind(app.lead).bind(app.pm).execute(&app.suite.pool).await.unwrap();
    let pending = Uuid::new_v4();
    sqlx::query("INSERT INTO document_signature_requests(id,source_document_id,requested_by,source_sha256,source_context,signers,provider_account,test_mode,status,level,minimum_level) VALUES($1,$2,$3,$4,'{}','[]','synthetic',true,'pending','QES','QES')")
        .bind(pending).bind(source).bind(app.pm).bind("a".repeat(64)).execute(&app.suite.pool).await.unwrap();
    let response = save(
        &app,
        app.first,
        json!({"birth_place":"  Synthetic birthplace  ","birth_country":"de"}),
    )
    .await;
    let person = &response["follow_up"]["representatives"][0];
    assert_eq!(person["fields"]["birth_place"], "Synthetic birthplace");
    assert_eq!(person["fields"]["birth_country"], "DE");
    assert_eq!(person["missing"], json!([]));
    let stored: (Option<String>, Option<String>, Value) = sqlx::query_as("SELECT birth_place,birth_country,country_questions FROM lead_representatives WHERE lead_id=$1 AND contact_id=$2")
        .bind(app.lead).bind(app.first).fetch_one(&app.suite.pool).await.unwrap();
    assert_eq!(
        stored,
        (
            Some("Synthetic birthplace".into()),
            Some("DE".into()),
            questions
        )
    );
    let status: (String, Option<String>) =
        sqlx::query_as("SELECT status,last_error FROM document_signature_requests WHERE id=$1")
            .bind(pending)
            .fetch_one(&app.suite.pool)
            .await
            .unwrap();
    assert_eq!(
        status,
        ("error".into(), Some("representative_changed".into()))
    );
    let context: Value = sqlx::query_scalar("SELECT context FROM audit_log WHERE entity_id=$1 AND action='lead_portal_representative_country_questions' ORDER BY created_at DESC LIMIT 1")
        .bind(app.lead).fetch_one(&app.suite.pool).await.unwrap();
    assert_eq!(context["fields"], json!(["birth_place", "birth_country"]));
    assert!(!context.to_string().contains("Synthetic birthplace"));
    assert_draft_pure(&app).await;
}

#[tokio::test]
async fn questionnaire_answers_belong_to_the_parent_and_no_clears_conditional_details() {
    let Some(app) = fixture("RU", "DE").await else {
        return;
    };
    let yes = save(
        &app,
        app.first,
        json!({"pep_self":true,"pep_related":true,"sanctions_links":true,"stay_reason":"other"}),
    )
    .await;
    let missing = yes["follow_up"]["representatives"][0]["missing"]
        .as_array()
        .unwrap();
    for key in [
        "pep_office",
        "pep_country",
        "pep_period",
        "pep_relationship",
        "pep_wealth_origin",
        "sanctions_link_name",
        "sanctions_link_kind",
        "sanctions_link_since_extent",
        "stay_reason_details",
    ] {
        assert!(missing.contains(&json!(key)), "{key}: {missing:?}");
    }
    save(&app, app.first, json!({"pep_office":"Synthetic office","pep_country":"ru","pep_period":"2020","pep_relationship":"Synthetic relative","pep_wealth_origin":"Salary","sanctions_link_name":"Synthetic person","sanctions_link_kind":"family","sanctions_link_since_extent":"2020","stay_reason_details":"Synthetic reason"})).await;
    let no = save(&app, app.first, no_answers()).await;
    let parent = &no["follow_up"]["representatives"][0];
    assert_eq!(parent["missing"], json!([]), "{parent}");
    for field in [
        "pep_office",
        "pep_country",
        "pep_period",
        "pep_relationship",
        "pep_wealth_origin",
        "sanctions_link_name",
        "sanctions_link_kind",
        "sanctions_link_since_extent",
        "stay_reason_details",
    ] {
        assert!(parent["fields"][field].is_null(), "{field}: {parent}");
    }
    assert!(no["identification"]["pep_self"].is_null());
    let actor: Option<Uuid> = sqlx::query_scalar("SELECT user_id FROM audit_log WHERE entity_id=$1 AND action='lead_portal_representative_country_questions' ORDER BY created_at DESC LIMIT 1")
        .bind(app.lead).fetch_one(&app.suite.pool).await.unwrap();
    assert_eq!(actor, Some(app.parent));
    assert_draft_pure(&app).await;
    for invalid in [
        json!({"pep_self":"no"}),
        json!({"stay_reason":"unknown"}),
        json!({"pep_country":"Russia"}),
        json!({"birth_country":"Russia"}),
        json!({"birth_place":"x".repeat(201)}),
        json!({"birth_place":true}),
        json!({"residence_since":"x".repeat(61)}),
        json!({"funds_source":"salary"}),
    ] {
        let (status, _) = request(
            &app,
            "POST",
            &format!(
                "/me/lead-requests/{}/representatives/{}/country-questions",
                app.lead, app.first
            ),
            app.parent,
            "patient",
            Some(invalid),
        )
        .await;
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    }
}

#[tokio::test]
async fn joint_custody_asks_each_listed_parent_and_sole_custody_keeps_only_the_acting_parent() {
    let Some(app) = fixture("RU", "CA").await else {
        return;
    };
    assert_eq!(
        read(&app).await["follow_up"]["representatives"]
            .as_array()
            .unwrap()
            .len(),
        2
    );
    save(&app, app.first, no_answers()).await;
    let incomplete = read(&app).await;
    assert!(
        !incomplete["follow_up"]["missing"]["R"]
            .as_array()
            .unwrap()
            .is_empty()
    );
    assert!(
        incomplete["follow_up"]["missing"]["R"]
            .as_array()
            .unwrap()
            .iter()
            .all(|key| key.as_str().unwrap().contains(&app.second.to_string()))
    );
    let (status, body) = request(
        &app,
        "POST",
        &format!("/leads/{}/representation", app.lead),
        app.pm,
        "patient_manager",
        Some(json!({"custody":"sole_parent"})),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let sole = read(&app).await;
    assert_eq!(
        sole["follow_up"]["representatives"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    assert_eq!(
        sole["follow_up"]["representatives"][0]["id"],
        json!(app.first)
    );
    let (status, _) = request(
        &app,
        "POST",
        &format!(
            "/me/lead-requests/{}/representatives/{}/country-questions",
            app.lead, app.second
        ),
        app.parent,
        "patient",
        Some(no_answers()),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::NOT_FOUND,
        "an inactive second parent cannot be answered"
    );
}

#[tokio::test]
async fn submitted_parent_questions_hold_level_one_and_keep_the_exact_parent_after_country_correction()
 {
    let Some(app) = fixture("CA", "DE").await else {
        return;
    };
    sqlx::query("UPDATE leads SET portal_submitted_at=now(),portal_submitted_by=$2 WHERE id=$1")
        .bind(app.lead)
        .bind(app.parent)
        .execute(&app.suite.pool)
        .await
        .unwrap();
    let (status, held) = request(
        &app,
        "POST",
        &format!("/leads/{}/qualify", app.lead),
        app.pm,
        "patient_manager",
        Some(json!({"status":"qualified"})),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{held}");
    assert_eq!(held["error"], "risk_review_required");
    let (status, started) = request(
        &app,
        "GET",
        &format!("/leads/{}/risk-assessment", app.lead),
        app.pm,
        "patient_manager",
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{started}");
    assert_eq!(started["level"], 1);
    assert_eq!(started["status"], "awaiting_answers");
    let required: Vec<Uuid> = sqlx::query_scalar(
        "SELECT representative_country_ids FROM lead_risk_assessments WHERE lead_id=$1",
    )
    .bind(app.lead)
    .fetch_one(&app.suite.pool)
    .await
    .unwrap();
    assert_eq!(required, vec![app.first]);
    let (status, blocked) = request(
        &app,
        "POST",
        &format!("/me/lead-requests/{}/follow-up/submit", app.lead),
        app.parent,
        "patient",
        None,
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{blocked}");
    assert_eq!(blocked["code"], "follow_up_incomplete");
    assert!(blocked["missing"]["R"].is_array());
    sqlx::query("UPDATE lead_representatives SET citizenships=ARRAY['DE'] WHERE lead_id=$1 AND contact_id=$2")
        .bind(app.lead).bind(app.first).execute(&app.suite.pool).await.unwrap();
    let pending = read(&app).await;
    assert_eq!(pending["follow_up"]["before_submit"], false);
    assert_eq!(
        pending["follow_up"]["representatives"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    assert_eq!(
        pending["follow_up"]["representatives"][0]["id"],
        json!(app.first)
    );
    save(&app, app.first, no_answers()).await;
    let (status, complete) = request(
        &app,
        "GET",
        &format!("/leads/{}/risk-assessment", app.lead),
        app.pm,
        "patient_manager",
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{complete}");
    assert_eq!(complete["status"], "clear");
    assert_eq!(complete["level"], 1);
    let (_, unheld) = request(
        &app,
        "POST",
        &format!("/leads/{}/qualify", app.lead),
        app.pm,
        "patient_manager",
        Some(json!({"status":"qualified"})),
    )
    .await;
    assert_ne!(
        unheld["error"], "risk_review_required",
        "completed country answers clear the risk hold: {unheld}"
    );
    let (status, sent) = request(
        &app,
        "POST",
        &format!("/me/lead-requests/{}/follow-up/submit", app.lead),
        app.parent,
        "patient",
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{sent}");
    assert_eq!(sent["follow_up"]["changed_since_answer"], false);
    assert_eq!(
        sent["changed_since_submit"], false,
        "questionnaire send clears only its own marker"
    );
}

#[tokio::test]
async fn foreign_revoked_and_child_logins_cannot_write_parent_questionnaires() {
    let Some(app) = fixture("RU", "DE").await else {
        return;
    };
    let outsider = user(&app.suite.pool, "patient").await;
    let endpoint = format!(
        "/me/lead-requests/{}/representatives/{}/country-questions",
        app.lead, app.first
    );
    let (status, _) = request(
        &app,
        "POST",
        &endpoint,
        outsider,
        "patient",
        Some(no_answers()),
    )
    .await;
    assert!(matches!(
        status,
        StatusCode::FORBIDDEN | StatusCode::NOT_FOUND
    ));
    sqlx::query("UPDATE lead_portal_access SET revoked_at=now() WHERE lead_id=$1")
        .bind(app.lead)
        .execute(&app.suite.pool)
        .await
        .unwrap();
    let (status, _) = request(
        &app,
        "POST",
        &endpoint,
        app.parent,
        "patient",
        Some(no_answers()),
    )
    .await;
    assert!(matches!(
        status,
        StatusCode::FORBIDDEN | StatusCode::NOT_FOUND
    ));
    sqlx::query("UPDATE leads SET portal_user_id=$2 WHERE id=$1")
        .bind(app.lead)
        .bind(outsider)
        .execute(&app.suite.pool)
        .await
        .unwrap();
    let (status, _) = request(
        &app,
        "POST",
        &endpoint,
        outsider,
        "patient",
        Some(no_answers()),
    )
    .await;
    assert!(matches!(
        status,
        StatusCode::FORBIDDEN | StatusCode::NOT_FOUND
    ));
    let fields: Value = sqlx::query_scalar(
        "SELECT country_questions FROM lead_representatives WHERE lead_id=$1 AND contact_id=$2",
    )
    .bind(app.lead)
    .bind(app.first)
    .fetch_one(&app.suite.pool)
    .await
    .unwrap();
    assert_eq!(fields, json!({}));
}

#[tokio::test]
async fn parent_identity_changes_and_a_new_explicit_legal_yes_close_pending_invitations_only() {
    let Some(app) = fixture("CA", "DE").await else {
        return;
    };
    let source = Uuid::new_v4();
    sqlx::query("INSERT INTO documents(id,version_root_document_id,lead_id,auto_name,art,category,status,visibility,is_medical,uploaded_by,generated_template_id) VALUES($1,$1,$2,'Synthetic contract','report','administrative','active','internal',false,$3,'framework_contract')")
        .bind(source).bind(app.lead).bind(app.pm).execute(&app.suite.pool).await.unwrap();
    let pending = Uuid::new_v4();
    let completed = Uuid::new_v4();
    for (id, status) in [(pending, "pending"), (completed, "completed")] {
        sqlx::query("INSERT INTO document_signature_requests(id,source_document_id,requested_by,source_sha256,source_context,signers,provider_account,test_mode,status,level,minimum_level,lease_token,lease_until,result_document_id,report_storage_key,report_sha256,signed_sha256) VALUES($1,$2,$3,$4,'{}','[]','synthetic',true,$5,'QES','QES',$6,now()+interval '10 minutes',$2,'synthetic/report.pdf',$4,$4)")
            .bind(id).bind(source).bind(app.pm).bind("a".repeat(64)).bind(status).bind(Uuid::new_v4()).execute(&app.suite.pool).await.unwrap();
    }
    let (status, body) = request(
        &app,
        "POST",
        &format!(
            "/me/lead-requests/{}/representatives/{}",
            app.lead, app.first
        ),
        app.parent,
        "patient",
        Some(json!({"first_name":"Anne"})),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let pending_state: (String, Option<String>, Option<Uuid>) = sqlx::query_as(
        "SELECT status,last_error,lease_token FROM document_signature_requests WHERE id=$1",
    )
    .bind(pending)
    .fetch_one(&app.suite.pool)
    .await
    .unwrap();
    assert_eq!(
        pending_state,
        (
            "error".to_string(),
            Some("representative_changed".to_string()),
            None
        )
    );
    let signed_status: String =
        sqlx::query_scalar("SELECT status FROM document_signature_requests WHERE id=$1")
            .bind(completed)
            .fetch_one(&app.suite.pool)
            .await
            .unwrap();
    assert_eq!(signed_status, "completed");
    // A newly declared PEP cannot complete a still-open low-risk invitation.
    sqlx::query("UPDATE document_signature_requests SET status='pending',last_error=NULL,closed_kind=NULL,close_reason=NULL,closed_by=NULL,closed_at=NULL WHERE id=$1")
        .bind(pending).execute(&app.suite.pool).await.unwrap();
    save(&app, app.first, json!({"pep_self":true})).await;
    let error: Option<String> =
        sqlx::query_scalar("SELECT last_error FROM document_signature_requests WHERE id=$1")
            .bind(pending)
            .fetch_one(&app.suite.pool)
            .await
            .unwrap();
    assert_eq!(error.as_deref(), Some("representative_changed"));
}

#[tokio::test]
async fn a_short_parent_form_can_send_the_child_request_but_cannot_create_a_contract() {
    let Some(app) = fixture("DE", "DE").await else {
        return;
    };
    let (status, consent) = request(
        &app,
        "POST",
        &format!("/me/lead-requests/{}/consent", app.lead),
        app.parent,
        "patient",
        Some(json!({"purpose":"health_data_processing","version":"2026-10-13","language":"de"})),
    )
    .await;
    assert!(
        matches!(status, StatusCode::OK | StatusCode::CREATED),
        "{consent}"
    );
    // The initial parents have no birth dates, addresses, passport data or files.
    sqlx::query("UPDATE leads SET trusted_contacts=(SELECT jsonb_agg(contact - 'birth_date') FROM jsonb_array_elements(trusted_contacts) contact) WHERE id=$1")
        .bind(app.lead).execute(&app.suite.pool).await.unwrap();
    for id in [app.first, app.second] {
        let (status, body) = request(
            &app,
            "POST",
            &format!("/me/lead-requests/{}/representatives/{id}", app.lead),
            app.parent,
            "patient",
            Some(json!({"phone":"+49 30 000000"})),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{body}");
    }
    for (part, fields) in [
        (
            "personal-data",
            json!({"legal_sex":"female","street_address":"Synthetic Street 1","zip_code":"10115","city":"Berlin","country":"DE"}),
        ),
        (
            "payer",
            json!({"payer_kind":"third_party","payer_type":"person","first_name":"Anna","last_name":"Synthetic","email":"anna@example.com","country":"DE","citizenships":["DE"],"relationship_kind":"parent"}),
        ),
        (
            "billing",
            json!({"invoice_to":"self","payment_method":"bank_transfer","account_country":"DE","account_holder":"Anna Synthetic","bank_name":"Synthetic bank","via_third_party":false}),
        ),
        (
            "identification",
            json!({"request_reason":"Synthetic second opinion"}),
        ),
    ] {
        let (status, body) = request(
            &app,
            "POST",
            &format!("/me/lead-requests/{}/{part}", app.lead),
            app.parent,
            "patient",
            Some(fields),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{part}: {body}");
    }
    sqlx::query("INSERT INTO lead_portal_uploads(document_id,lead_id,uploaded_by,access_kind,kind) SELECT id,lead_id,$2,'guardian','identity' FROM documents WHERE lead_id=$1 AND compliance_kind='identity'")
        .bind(app.lead).bind(app.parent).execute(&app.suite.pool).await.unwrap();
    let before = read(&app).await;
    assert_eq!(before["representation"]["document_stage"], false);
    assert_eq!(
        before["progress"]["missing_for_submit"],
        json!([]),
        "{before}"
    );
    let (status, sent) = request(
        &app,
        "POST",
        &format!("/me/lead-requests/{}/submit", app.lead),
        app.parent,
        "patient",
        Some(json!({"declared_correct":true})),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{sent}");
    assert_eq!(
        sent["follow_up"]["required"], false,
        "T13 must not immediately undo the short intake"
    );
    // Contract-stage gates still demand the full representative data.
    let (status, blocked) = request(
        &app,
        "POST",
        "/framework-contracts",
        app.pm,
        "patient_manager",
        Some(json!({"lead_id":app.lead,"status":"draft"})),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{blocked}");
    assert_eq!(
        blocked["code"], "representative_details_incomplete",
        "{blocked}"
    );
    assert!(
        blocked["missing"]
            .as_array()
            .unwrap()
            .contains(&json!("rep1_id_upload"))
    );
    assert!(
        blocked["missing"]
            .as_array()
            .unwrap()
            .contains(&json!("rep2_date_of_birth"))
    );
    let records: i64 =
        sqlx::query_scalar("SELECT count(*) FROM framework_contracts WHERE lead_id=$1")
            .bind(app.lead)
            .fetch_one(&app.suite.pool)
            .await
            .unwrap();
    assert_eq!(records, 0);
    let ceo = user(&app.suite.pool, "ceo").await;
    let (status,asked)=request(&app,"POST",&format!("/leads/{}/risk-assessment/decisions",app.lead),ceo,"ceo",Some(json!({"decision":"request_more","reason":"Synthetic document details request","blocks":["G"]}))).await;
    assert_eq!(status, StatusCode::CREATED, "{asked}");
    let full = read(&app).await;
    assert_eq!(full["representation"]["document_stage"], true);
    assert_eq!(full["follow_up"]["blocks"], json!(["G"]));
    assert!(
        full["progress"]["missing_for_submit"]
            .as_array()
            .unwrap()
            .contains(&json!("rep1_street"))
    );
}

#[tokio::test]
async fn paper_signatures_and_countersigning_cannot_bypass_the_full_parent_stage() {
    let Some(app) = fixture("DE", "DE").await else {
        return;
    };
    let document = Uuid::new_v4();
    sqlx::query("INSERT INTO documents(id,version_root_document_id,lead_id,auto_name,art,category,status,visibility,is_medical,uploaded_by,generated_template_id) VALUES($1,$1,$2,'Synthetic contract','report','administrative','active','internal',false,$3,'framework_contract')")
        .bind(document).bind(app.lead).bind(app.pm).execute(&app.suite.pool).await.unwrap();
    let mark_path = format!("/documents/{document}/mark-signed");
    let mark = request(
        &app,
        "POST",
        &mark_path,
        app.pm,
        "patient_manager",
        Some(json!({"compliance_kind":"framework_contract","signed_at":"2026-10-14T12:00:00Z"})),
    )
    .await;
    let paper = paper_request(&app, document, app.pm, "patient_manager").await;
    for (path, (status, body)) in [
        (mark_path, mark),
        (format!("/documents/{document}/paper-signature"), paper),
    ] {
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{path}: {body}");
        assert_eq!(
            body["code"], "representative_details_incomplete",
            "{path}: {body}"
        );
        assert!(
            body["missing"]
                .as_array()
                .unwrap()
                .contains(&json!("rep2_id_upload"))
        );
    }
    let contract = Uuid::new_v4();
    sqlx::query("INSERT INTO framework_contracts(id,lead_id,contract_number,status,created_by) VALUES($1,$2,$3,'draft',$4)")
        .bind(contract).bind(app.lead).bind(format!("FC-SYN-{contract}")).bind(app.pm).execute(&app.suite.pool).await.unwrap();
    let (status, body) = request(
        &app,
        "POST",
        &format!("/framework-contracts/{contract}/status"),
        app.pm,
        "patient_manager",
        Some(json!({"status":"signed"})),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
    assert_eq!(body["code"], "representative_details_incomplete", "{body}");
    let untouched: Option<chrono::DateTime<chrono::Utc>> =
        sqlx::query_scalar("SELECT signed_at FROM documents WHERE id=$1")
            .bind(document)
            .fetch_one(&app.suite.pool)
            .await
            .unwrap();
    assert!(untouched.is_none());
    let status: String = sqlx::query_scalar("SELECT status FROM framework_contracts WHERE id=$1")
        .bind(contract)
        .fetch_one(&app.suite.pool)
        .await
        .unwrap();
    assert_eq!(status, "draft");
}

#[tokio::test]
async fn canonical_parent_profile_changes_close_pending_invitations_only_when_inherited_identity_changes()
 {
    let Some(app) = fixture("DE", "DE").await else {
        return;
    };
    let ceo = user(&app.suite.pool, "ceo").await;
    let canonical: Uuid = sqlx::query_scalar("INSERT INTO patients(patient_id,first_name,last_name,birth_date,gender,citizenships,residence_country,address_country,passport_number,created_by) VALUES($1,'Anna','Canonical','1985-03-02','female',ARRAY['DE'],'DE','DE','SYNTHETIC-OLD',$2) RETURNING id")
        .bind(format!("P-PARENT-{}",Uuid::new_v4().simple())).bind(ceo).fetch_one(&app.suite.pool).await.unwrap();
    sqlx::query("UPDATE leads SET trusted_contacts=jsonb_set(trusted_contacts,'{0,related_patient_id}',to_jsonb($2::uuid)) WHERE id=$1")
        .bind(app.lead).bind(canonical).execute(&app.suite.pool).await.unwrap();
    let source = Uuid::new_v4();
    sqlx::query("INSERT INTO documents(id,version_root_document_id,lead_id,auto_name,art,category,status,visibility,is_medical,uploaded_by,generated_template_id) VALUES($1,$1,$2,'Synthetic contract','report','administrative','active','internal',false,$3,'framework_contract')")
        .bind(source).bind(app.lead).bind(app.pm).execute(&app.suite.pool).await.unwrap();
    let pending = Uuid::new_v4();
    let completed = Uuid::new_v4();
    for (id, status) in [(pending, "pending"), (completed, "completed")] {
        sqlx::query("INSERT INTO document_signature_requests(id,source_document_id,requested_by,source_sha256,source_context,signers,provider_account,test_mode,status,level,minimum_level,lease_token,lease_until,result_document_id,report_storage_key,report_sha256,signed_sha256) VALUES($1,$2,$3,$4,'{}','[]','synthetic',true,$5,'QES','QES',$6,now()+interval '10 minutes',$2,'synthetic/report.pdf',$4,$4)")
            .bind(id).bind(source).bind(app.pm).bind("a".repeat(64)).bind(status).bind(Uuid::new_v4()).execute(&app.suite.pool).await.unwrap();
    }
    let path = format!("/patients/{canonical}/update");
    let (status, body) = request(
        &app,
        "POST",
        &path,
        ceo,
        "ceo",
        Some(json!({"notes":"Synthetic clinical note"})),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let pending_status: String =
        sqlx::query_scalar("SELECT status FROM document_signature_requests WHERE id=$1")
            .bind(pending)
            .fetch_one(&app.suite.pool)
            .await
            .unwrap();
    assert_eq!(
        pending_status, "pending",
        "clinical data is not contracting identity"
    );

    let (status, body) = request(
        &app,
        "POST",
        &path,
        ceo,
        "ceo",
        Some(json!({"passport_number":"SYNTHETIC-NEW"})),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let changed: (String, Option<String>, Option<Uuid>) = sqlx::query_as(
        "SELECT status,last_error,lease_token FROM document_signature_requests WHERE id=$1",
    )
    .bind(pending)
    .fetch_one(&app.suite.pool)
    .await
    .unwrap();
    assert_eq!(
        changed,
        ("error".into(), Some("representative_changed".into()), None)
    );
    let completed_status: String =
        sqlx::query_scalar("SELECT status FROM document_signature_requests WHERE id=$1")
            .bind(completed)
            .fetch_one(&app.suite.pool)
            .await
            .unwrap();
    assert_eq!(completed_status, "completed", "signed history is preserved");
    let actor: Option<Uuid> = sqlx::query_scalar("SELECT user_id FROM audit_log WHERE action='document_signature_representative_invalidated' AND entity_id=$1 ORDER BY created_at DESC LIMIT 1")
        .bind(source).fetch_one(&app.suite.pool).await.unwrap();
    assert_eq!(actor, Some(ceo));

    // An explicit local identity wins: later canonical corrections that are
    // not inherited must not close an otherwise unchanged invitation.
    sqlx::query("UPDATE lead_representatives SET id_document_type='passport',id_document_number='LOCAL-SYNTHETIC' WHERE lead_id=$1 AND contact_id=$2")
        .bind(app.lead).bind(app.first).execute(&app.suite.pool).await.unwrap();
    sqlx::query("UPDATE document_signature_requests SET status='pending',last_error=NULL,closed_kind=NULL,close_reason=NULL,closed_by=NULL,closed_at=NULL WHERE id=$1")
        .bind(pending).execute(&app.suite.pool).await.unwrap();
    let (status, body) = request(
        &app,
        "POST",
        &path,
        ceo,
        "ceo",
        Some(json!({"passport_number":"SYNTHETIC-CORRECTED"})),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let pending_status: String =
        sqlx::query_scalar("SELECT status FROM document_signature_requests WHERE id=$1")
            .bind(pending)
            .fetch_one(&app.suite.pool)
            .await
            .unwrap();
    assert_eq!(
        pending_status, "pending",
        "non-inherited canonical data does not affect the contract party"
    );
    assert_draft_pure(&app).await;
}

#[tokio::test]
async fn unauthorized_parent_details_are_not_disclosed_and_standalone_privacy_stays_available() {
    let Some(app) = fixture("DE", "DE").await else {
        return;
    };
    let outsider = user(&app.suite.pool, "patient").await;
    let document = Uuid::new_v4();
    sqlx::query("INSERT INTO documents(id,version_root_document_id,lead_id,auto_name,art,category,status,visibility,is_medical,uploaded_by,generated_template_id) VALUES($1,$1,$2,'Synthetic contract','report','administrative','active','internal',false,$3,'framework_contract')")
        .bind(document).bind(app.lead).bind(app.pm).execute(&app.suite.pool).await.unwrap();
    let contract = Uuid::new_v4();
    sqlx::query("INSERT INTO framework_contracts(id,lead_id,contract_number,status,created_by) VALUES($1,$2,$3,'draft',$4)")
        .bind(contract).bind(app.lead).bind(format!("FC-SYN-{contract}")).bind(app.pm).execute(&app.suite.pool).await.unwrap();
    for (path, payload) in [
        (format!("/leads/{}/convert", app.lead), json!({})),
        (
            format!("/framework-contracts/{contract}/status"),
            json!({"status":"signed"}),
        ),
        (
            format!("/documents/{document}/mark-signed"),
            json!({"compliance_kind":"framework_contract"}),
        ),
    ] {
        let (status, body) = request(&app, "POST", &path, outsider, "patient", Some(payload)).await;
        assert_eq!(status, StatusCode::FORBIDDEN, "{path}: {body}");
        assert!(
            body.get("missing").is_none(),
            "foreign identity missing list: {body}"
        );
    }
    let (status, body) = paper_request(&app, document, outsider, "patient").await;
    assert_eq!(status, StatusCode::FORBIDDEN, "{body}");
    assert!(body.get("missing").is_none(), "{body}");

    let consent = Uuid::new_v4();
    sqlx::query("INSERT INTO documents(id,version_root_document_id,lead_id,auto_name,art,category,status,visibility,is_medical,uploaded_by,generated_template_id,compliance_kind) VALUES($1,$1,$2,'Synthetic privacy','privacy_consents','administrative','active','internal',false,$3,'privacy_consents','dsgvo')")
        .bind(consent).bind(app.lead).bind(app.pm).execute(&app.suite.pool).await.unwrap();
    let (status, body) = paper_request(&app, consent, app.pm, "patient_manager").await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
    assert_eq!(
        body["error"], "paper_signature_scan_required",
        "early privacy may reach its normal upload validation: {body}"
    );
    assert!(body.get("missing").is_none(), "{body}");
    let identity: Uuid = sqlx::query_scalar(
        "SELECT id FROM documents WHERE lead_id=$1 AND compliance_kind='identity'",
    )
    .bind(app.lead)
    .fetch_one(&app.suite.pool)
    .await
    .unwrap();
    let (status, body) = paper_request(&app, identity, app.pm, "patient_manager").await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
    assert_eq!(
        body["error"], "paper_signature_scan_required",
        "early identity may reach its normal upload validation: {body}"
    );
    assert!(body.get("missing").is_none(), "{body}");
}
