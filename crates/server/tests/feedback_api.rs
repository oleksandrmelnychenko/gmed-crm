mod support;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use serde_json::{Value, json};
use sqlx::PgPool;
use tower::ServiceExt;
use uuid::Uuid;

use gmed_server::auth::jwt;
const TEST_SECRET: &str = "test-secret-at-least-32-characters-long!!";

struct TestContext {
    suite: support::TestSuiteContext,
}

impl std::ops::Deref for TestContext {
    type Target = axum::Router;

    fn deref(&self) -> &Self::Target {
        &self.suite.app
    }
}

impl TestContext {
    fn router(&self) -> axum::Router {
        self.suite.app.clone()
    }

    fn pool(&self) -> &PgPool {
        &self.suite.pool
    }

    fn admin_id(&self) -> Uuid {
        self.suite.admin_id
    }
}

async fn test_context() -> Option<TestContext> {
    Some(TestContext {
        suite: support::suite_context(TEST_SECRET).await?,
    })
}

async fn json_request(
    app: &axum::Router,
    method: &str,
    path: &str,
    bearer: &str,
    body: Option<Value>,
) -> (StatusCode, Value) {
    let request = Request::builder()
        .method(method)
        .uri(path)
        .header("Authorization", bearer)
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
    let payload = serde_json::from_slice(&bytes).unwrap_or(json!(null));
    (status, payload)
}

fn unique_tag(prefix: &str) -> String {
    format!("{prefix}-{}", Uuid::new_v4().simple())
}

fn auth_header_for(user_id: Uuid, role: &str) -> String {
    let token = jwt::issue_access_token(TEST_SECRET, user_id, role, Uuid::new_v4()).unwrap();
    format!("Bearer {token}")
}

async fn seed_user(pool: &PgPool, tag: &str, role: &str) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO users (email, password_hash, name, role)
           VALUES ($1, $2, $3, $4)
           RETURNING id"#,
    )
    .bind(format!("{tag}-{role}@example.com"))
    .bind("test-password-hash")
    .bind(format!("{role} {tag}"))
    .bind(role)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn seed_patient(pool: &PgPool, created_by: Uuid, tag: &str) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO patients (
                patient_id, first_name, last_name, birth_date, gender, created_by
           ) VALUES (
                $1, $2, $3, '1990-01-01', 'diverse', $4
           ) RETURNING id"#,
    )
    .bind(format!("PT-{tag}"))
    .bind(format!("First {tag}"))
    .bind(format!("Last {tag}"))
    .bind(created_by)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn seed_patient_assignment(
    pool: &PgPool,
    patient_id: Uuid,
    user_id: Uuid,
    assigned_by: Uuid,
) {
    sqlx::query(
        r#"INSERT INTO patient_assignments (patient_id, user_id, assigned_by)
           VALUES ($1, $2, $3)
           ON CONFLICT (patient_id, user_id)
           DO UPDATE SET revoked_at = NULL, assigned_by = $3, assigned_at = now()"#,
    )
    .bind(patient_id)
    .bind(user_id)
    .bind(assigned_by)
    .execute(pool)
    .await
    .unwrap();
}

async fn seed_provider(pool: &PgPool, tag: &str) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO providers (name, provider_type, address_city, address_country)
           VALUES ($1, 'medical', 'Cologne', 'DE')
           RETURNING id"#,
    )
    .bind(format!("Clinic {tag}"))
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn seed_doctor(pool: &PgPool, provider_id: Uuid, tag: &str) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO provider_doctors (provider_id, name, fachbereich)
           VALUES ($1, $2, 'cardiology')
           RETURNING id"#,
    )
    .bind(provider_id)
    .bind(format!("Dr. {tag}"))
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn seed_appointment(
    pool: &PgPool,
    patient_id: Uuid,
    provider_id: Uuid,
    doctor_id: Uuid,
    interpreter_id: Uuid,
    created_by: Uuid,
    tag: &str,
) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO appointments (
                patient_id, provider_id, doctor_id, interpreter_id,
                appointment_type, title, date, status, created_by
           ) VALUES (
                $1, $2, $3, $4,
                'medical', $5, '2026-05-10', 'completed', $6
           ) RETURNING id"#,
    )
    .bind(patient_id)
    .bind(provider_id)
    .bind(doctor_id)
    .bind(interpreter_id)
    .bind(format!("Visit {tag}"))
    .bind(created_by)
    .fetch_one(pool)
    .await
    .unwrap()
}

#[tokio::test]
async fn patient_can_submit_feedback_and_pm_gets_summary() {
    let Some(ctx) = test_context().await else {
        return;
    };
    let app = ctx.router();
    let pool = ctx.pool();
    let admin_id = ctx.admin_id();

    let tag = unique_tag("feedback-portal");
    let patient_user_id = seed_user(pool, &tag, "patient").await;
    let patient_manager_id = seed_user(pool, &format!("{tag}-pm"), "patient_manager").await;
    let teamlead_id = seed_user(pool, &format!("{tag}-tl"), "teamlead_interpreter").await;
    let concierge_id = seed_user(pool, &format!("{tag}-concierge"), "concierge").await;
    let interpreter_id = seed_user(pool, &format!("{tag}-interp"), "interpreter").await;
    let patient_id = seed_patient(pool, admin_id, &tag).await;
    let provider_id = seed_provider(pool, &tag).await;
    let doctor_id = seed_doctor(pool, provider_id, &tag).await;
    let appointment_id = seed_appointment(
        pool,
        patient_id,
        provider_id,
        doctor_id,
        interpreter_id,
        admin_id,
        &tag,
    )
    .await;

    seed_patient_assignment(pool, patient_id, patient_user_id, admin_id).await;
    seed_patient_assignment(pool, patient_id, patient_manager_id, admin_id).await;
    seed_patient_assignment(pool, patient_id, teamlead_id, admin_id).await;
    seed_patient_assignment(pool, patient_id, concierge_id, admin_id).await;
    seed_patient_assignment(pool, patient_id, interpreter_id, admin_id).await;

    let patient_auth = auth_header_for(patient_user_id, "patient");
    let pm_auth = auth_header_for(patient_manager_id, "patient_manager");

    let (status, body) = json_request(
        &app,
        "POST",
        "/api/v1/me/feedback",
        &patient_auth,
        Some(json!({
            "appointment_id": appointment_id,
            "overall_score": 5,
            "patient_manager_score": 5,
            "interpreter_score": 4,
            "concierge_score": 4,
            "treatment_score": 5,
            "doctor_score": 5,
            "organization_score": 4,
            "service_score": 5,
            "infrastructure_score": 4,
            "price_value_score": 4,
            "treatment_success": "yes",
            "complication_reported": false,
            "nps_score": 10,
            "comments": "Everything was coordinated well",
            "improvement_notes": "Keep this quality"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(body["source"], "patient_portal");

    let (status, history) =
        json_request(&app, "GET", "/api/v1/me/feedback", &patient_auth, None).await;
    assert_eq!(status, StatusCode::OK);
    let history_items = history.as_array().unwrap();
    assert_eq!(history_items.len(), 1);
    assert_eq!(history_items[0]["nps_score"], 10);

    let (status, queue) = json_request(&app, "GET", "/api/v1/feedback", &pm_auth, None).await;
    assert_eq!(status, StatusCode::OK);
    let queue_items = queue.as_array().unwrap();
    assert_eq!(queue_items.len(), 1);
    assert_eq!(queue_items[0]["provider_id"], provider_id.to_string());
    assert_eq!(queue_items[0]["doctor_id"], doctor_id.to_string());

    let (status, summary) =
        json_request(&app, "GET", "/api/v1/feedback/summary", &pm_auth, None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(summary["total_feedback"], 1);
    assert_eq!(summary["nps_score"], 100);
    assert_eq!(summary["average_scores"]["service"], 5.0);
    assert_eq!(summary["average_scores"]["organization"], 4.0);
    assert_eq!(summary["treatment_success_yes_rate"], 100.0);
    assert_eq!(summary["complication_rate"], 0.0);

    let notification_count: i64 = sqlx::query_scalar(
        r#"SELECT count(*)
           FROM user_notifications
           WHERE user_id = $1
             AND kind = 'feedback'
             AND entity_type = 'patient'
             AND entity_id = $2"#,
    )
    .bind(patient_manager_id)
    .bind(patient_id)
    .fetch_one(pool)
    .await
    .unwrap();
    assert_eq!(notification_count, 1);
}

#[tokio::test]
async fn billing_sales_and_interpreter_cannot_open_feedback_workspace() {
    let Some(ctx) = test_context().await else {
        return;
    };
    let app = ctx.router();
    let pool = ctx.pool();

    for role in ["billing", "sales", "interpreter"] {
        let user_id = seed_user(pool, &unique_tag(&format!("feedback-{role}")), role).await;
        let bearer = auth_header_for(user_id, role);

        let (status, body) = json_request(&app, "GET", "/api/v1/feedback", &bearer, None).await;
        assert_eq!(status, StatusCode::FORBIDDEN, "role {role} must be denied");
        assert_eq!(body["message"], "Insufficient permissions");

        let (status, body) =
            json_request(&app, "GET", "/api/v1/feedback/summary", &bearer, None).await;
        assert_eq!(status, StatusCode::FORBIDDEN, "role {role} must be denied");
        assert_eq!(body["message"], "Insufficient permissions");
    }
}

#[tokio::test]
async fn it_admin_can_open_feedback_workspace() {
    let Some(ctx) = test_context().await else {
        return;
    };
    let app = ctx.router();
    let pool = ctx.pool();
    let user_id = seed_user(pool, &unique_tag("feedback-it-admin-full"), "it_admin").await;
    let bearer = auth_header_for(user_id, "it_admin");

    let (status, _) = json_request(&app, "GET", "/api/v1/feedback", &bearer, None).await;
    assert_eq!(status, StatusCode::OK);

    let (status, _) = json_request(&app, "GET", "/api/v1/feedback/summary", &bearer, None).await;
    assert_eq!(status, StatusCode::OK);
}

#[tokio::test]
async fn teamlead_and_concierge_only_see_relevant_feedback_rows() {
    let Some(ctx) = test_context().await else {
        return;
    };
    let app = ctx.router();
    let pool = ctx.pool();
    let admin_id = ctx.admin_id();

    let tag = unique_tag("feedback-scope");
    let patient_manager_id = seed_user(pool, &format!("{tag}-pm"), "patient_manager").await;
    let teamlead_id = seed_user(pool, &format!("{tag}-tl"), "teamlead_interpreter").await;
    let concierge_id = seed_user(pool, &format!("{tag}-concierge"), "concierge").await;
    let interpreter_id = seed_user(pool, &format!("{tag}-interp"), "interpreter").await;
    let patient_id = seed_patient(pool, admin_id, &tag).await;
    let provider_id = seed_provider(pool, &tag).await;
    let doctor_id = seed_doctor(pool, provider_id, &tag).await;
    let appointment_id = seed_appointment(
        pool,
        patient_id,
        provider_id,
        doctor_id,
        interpreter_id,
        admin_id,
        &tag,
    )
    .await;

    seed_patient_assignment(pool, patient_id, patient_manager_id, admin_id).await;
    seed_patient_assignment(pool, patient_id, teamlead_id, admin_id).await;
    seed_patient_assignment(pool, patient_id, concierge_id, admin_id).await;

    let pm_auth = auth_header_for(patient_manager_id, "patient_manager");
    let teamlead_auth = auth_header_for(teamlead_id, "teamlead_interpreter");
    let concierge_auth = auth_header_for(concierge_id, "concierge");

    let (status, _) = json_request(
        &app,
        "POST",
        "/api/v1/feedback",
        &pm_auth,
        Some(json!({
            "patient_id": patient_id,
            "appointment_id": appointment_id,
            "overall_score": 4,
            "patient_manager_score": 4,
            "interpreter_score": 5,
            "treatment_score": 4,
            "doctor_score": 4,
            "organization_score": 4,
            "service_score": 5,
            "infrastructure_score": 4,
            "price_value_score": 4,
            "treatment_success": "yes",
            "complication_reported": false,
            "nps_score": 9,
            "comments": "Interpreter was excellent"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);

    let (status, _) = json_request(
        &app,
        "POST",
        "/api/v1/feedback",
        &pm_auth,
        Some(json!({
            "patient_id": patient_id,
            "overall_score": 4,
            "patient_manager_score": 4,
            "concierge_score": 5,
            "treatment_score": 4,
            "doctor_score": 4,
            "organization_score": 5,
            "service_score": 5,
            "infrastructure_score": 4,
            "price_value_score": 4,
            "treatment_success": "partial",
            "complication_reported": true,
            "nps_score": 8,
            "comments": "Concierge support was excellent"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);

    let (status, teamlead_rows) =
        json_request(&app, "GET", "/api/v1/feedback", &teamlead_auth, None).await;
    assert_eq!(status, StatusCode::OK);
    let teamlead_items = teamlead_rows.as_array().unwrap();
    assert_eq!(teamlead_items.len(), 1);
    assert_eq!(teamlead_items[0]["interpreter_score"], 5);

    let (status, concierge_rows) =
        json_request(&app, "GET", "/api/v1/feedback", &concierge_auth, None).await;
    assert_eq!(status, StatusCode::OK);
    let concierge_items = concierge_rows.as_array().unwrap();
    assert_eq!(concierge_items.len(), 1);
    assert_eq!(concierge_items[0]["concierge_score"], 5);
}

#[tokio::test]
async fn review_writes_timeline_feedback_events() {
    let Some(ctx) = test_context().await else {
        return;
    };
    let app = ctx.router();
    let pool = ctx.pool();
    let admin_id = ctx.admin_id();

    let tag = unique_tag("feedback-timeline");
    let patient_manager_id = seed_user(pool, &format!("{tag}-pm"), "patient_manager").await;
    let interpreter_id = seed_user(pool, &format!("{tag}-interp"), "interpreter").await;
    let patient_id = seed_patient(pool, admin_id, &tag).await;
    let provider_id = seed_provider(pool, &tag).await;
    let doctor_id = seed_doctor(pool, provider_id, &tag).await;
    let appointment_id = seed_appointment(
        pool,
        patient_id,
        provider_id,
        doctor_id,
        interpreter_id,
        admin_id,
        &tag,
    )
    .await;

    seed_patient_assignment(pool, patient_id, patient_manager_id, admin_id).await;

    let pm_auth = auth_header_for(patient_manager_id, "patient_manager");
    let (status, created) = json_request(
        &app,
        "POST",
        "/api/v1/feedback",
        &pm_auth,
        Some(json!({
            "patient_id": patient_id,
            "appointment_id": appointment_id,
            "overall_score": 4,
            "patient_manager_score": 4,
            "interpreter_score": 4,
            "treatment_score": 4,
            "doctor_score": 4,
            "organization_score": 4,
            "service_score": 4,
            "infrastructure_score": 3,
            "price_value_score": 4,
            "treatment_success": "partial",
            "complication_reported": false,
            "nps_score": 8,
            "comments": "Follow-up call summary"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let feedback_id = created["id"].as_str().unwrap();

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/feedback/{feedback_id}/review"),
        &pm_auth,
        Some(json!({
            "status": "reviewed",
            "review_note": "Reviewed with clinic operations"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let timeline_path = format!("/api/v1/patients/{patient_id}/timeline");
    support::wait_until("feedback review timeline events", || {
        let app = app.clone();
        let pm_auth = pm_auth.clone();
        let timeline_path = timeline_path.clone();
        async move {
            let (status, timeline) =
                json_request(&app, "GET", &timeline_path, &pm_auth, None).await;
            if status != StatusCode::OK {
                return false;
            }
            let Some(items) = timeline["items"].as_array() else {
                return false;
            };
            let has_submitted = items
                .iter()
                .any(|item| item["title"] == "Patient feedback submitted");
            let has_reviewed = items
                .iter()
                .any(|item| item["title"] == "Patient feedback reviewed");
            has_submitted && has_reviewed
        }
    })
    .await;
}

#[tokio::test]
async fn reviewed_portal_feedback_flows_back_into_patient_history() {
    let Some(ctx) = test_context().await else {
        return;
    };
    let app = ctx.router();
    let pool = ctx.pool();
    let admin_id = ctx.admin_id();

    let tag = unique_tag("feedback-portal-review");
    let patient_user_id = seed_user(pool, &tag, "patient").await;
    let patient_manager_id = seed_user(pool, &format!("{tag}-pm"), "patient_manager").await;
    let interpreter_id = seed_user(pool, &format!("{tag}-interp"), "interpreter").await;
    let patient_id = seed_patient(pool, admin_id, &tag).await;
    let provider_id = seed_provider(pool, &tag).await;
    let doctor_id = seed_doctor(pool, provider_id, &tag).await;
    let appointment_id = seed_appointment(
        pool,
        patient_id,
        provider_id,
        doctor_id,
        interpreter_id,
        admin_id,
        &tag,
    )
    .await;

    seed_patient_assignment(pool, patient_id, patient_user_id, admin_id).await;
    seed_patient_assignment(pool, patient_id, patient_manager_id, admin_id).await;

    let patient_auth = auth_header_for(patient_user_id, "patient");
    let pm_auth = auth_header_for(patient_manager_id, "patient_manager");

    let (status, created) = json_request(
        &app,
        "POST",
        "/api/v1/me/feedback",
        &patient_auth,
        Some(json!({
            "appointment_id": appointment_id,
            "overall_score": 5,
            "patient_manager_score": 5,
            "interpreter_score": 4,
            "treatment_score": 5,
            "doctor_score": 5,
            "organization_score": 4,
            "service_score": 5,
            "infrastructure_score": 4,
            "price_value_score": 4,
            "treatment_success": "yes",
            "complication_reported": false,
            "nps_score": 9,
            "comments": "Everything felt coordinated."
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let feedback_id = created["id"].as_str().expect("feedback id");

    let (status, reviewed) = json_request(
        &app,
        "POST",
        &format!("/api/v1/feedback/{feedback_id}/review"),
        &pm_auth,
        Some(json!({
            "status": "reviewed",
            "review_note": "Reviewed with the clinic and no follow-up is needed."
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(reviewed["status"], "reviewed");
    assert_eq!(
        reviewed["review_note"],
        "Reviewed with the clinic and no follow-up is needed."
    );

    let (status, history) =
        json_request(&app, "GET", "/api/v1/me/feedback", &patient_auth, None).await;
    assert_eq!(status, StatusCode::OK);
    let items = history.as_array().expect("feedback history");
    assert_eq!(items.len(), 1);
    assert_eq!(items[0]["status"], "reviewed");
    assert_eq!(
        items[0]["review_note"],
        "Reviewed with the clinic and no follow-up is needed."
    );
    assert_eq!(
        items[0]["reviewed_by_name"],
        format!("patient_manager {tag}-pm")
    );
    assert!(
        items[0]["reviewed_at"].as_str().is_some(),
        "patient portal history should expose reviewed_at after staff review"
    );
    assert!(
        items[0].get("internal_note").is_none(),
        "patient portal history must not expose internal feedback notes"
    );

    let (status, summary) =
        json_request(&app, "GET", "/api/v1/feedback/summary", &pm_auth, None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(summary["total_feedback"], 1);
    assert_eq!(summary["reviewed_feedback"], 1);
}

#[tokio::test]
async fn portal_feedback_notifications_are_scoped_to_assigned_patient_roles() {
    let Some(ctx) = test_context().await else {
        return;
    };
    let app = ctx.router();
    let pool = ctx.pool();
    let admin_id = ctx.admin_id();

    let tag = unique_tag("feedback-notify-scope");
    let patient_user_id = seed_user(pool, &tag, "patient").await;
    let patient_manager_id = seed_user(pool, &format!("{tag}-pm"), "patient_manager").await;
    let teamlead_id = seed_user(pool, &format!("{tag}-tl"), "teamlead_interpreter").await;
    let concierge_id = seed_user(pool, &format!("{tag}-concierge"), "concierge").await;
    let unrelated_pm_id = seed_user(pool, &format!("{tag}-other-pm"), "patient_manager").await;
    let unrelated_concierge_id =
        seed_user(pool, &format!("{tag}-other-concierge"), "concierge").await;
    let interpreter_id = seed_user(pool, &format!("{tag}-interp"), "interpreter").await;
    let patient_id = seed_patient(pool, admin_id, &tag).await;
    let provider_id = seed_provider(pool, &tag).await;
    let doctor_id = seed_doctor(pool, provider_id, &tag).await;
    let appointment_id = seed_appointment(
        pool,
        patient_id,
        provider_id,
        doctor_id,
        interpreter_id,
        admin_id,
        &tag,
    )
    .await;

    seed_patient_assignment(pool, patient_id, patient_user_id, admin_id).await;
    seed_patient_assignment(pool, patient_id, patient_manager_id, admin_id).await;
    seed_patient_assignment(pool, patient_id, teamlead_id, admin_id).await;
    seed_patient_assignment(pool, patient_id, concierge_id, admin_id).await;

    let patient_auth = auth_header_for(patient_user_id, "patient");
    let teamlead_auth = auth_header_for(teamlead_id, "teamlead_interpreter");
    let concierge_auth = auth_header_for(concierge_id, "concierge");
    let unrelated_pm_auth = auth_header_for(unrelated_pm_id, "patient_manager");

    let (status, created) = json_request(
        &app,
        "POST",
        "/api/v1/me/feedback",
        &patient_auth,
        Some(json!({
            "appointment_id": appointment_id,
            "overall_score": 4,
            "patient_manager_score": 5,
            "interpreter_score": 4,
            "concierge_score": 5,
            "treatment_score": 4,
            "doctor_score": 4,
            "organization_score": 4,
            "service_score": 5,
            "infrastructure_score": 4,
            "price_value_score": 4,
            "treatment_success": "partial",
            "complication_reported": false,
            "nps_score": 8,
            "comments": "Coordination and support were strong."
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(created["source"], "patient_portal");

    for (user_id, expected_count) in [
        (patient_manager_id, 1_i64),
        (teamlead_id, 1_i64),
        (concierge_id, 1_i64),
        (unrelated_pm_id, 0_i64),
        (unrelated_concierge_id, 0_i64),
    ] {
        let count: i64 = sqlx::query_scalar(
            r#"SELECT count(*)
               FROM user_notifications
               WHERE user_id = $1
                 AND kind = 'feedback'
                 AND entity_type = 'patient'
                 AND entity_id = $2"#,
        )
        .bind(user_id)
        .bind(patient_id)
        .fetch_one(pool)
        .await
        .unwrap();
        assert_eq!(
            count, expected_count,
            "unexpected feedback notification scope"
        );
    }

    let (status, teamlead_rows) =
        json_request(&app, "GET", "/api/v1/feedback", &teamlead_auth, None).await;
    assert_eq!(status, StatusCode::OK);
    let teamlead_items = teamlead_rows.as_array().expect("teamlead feedback queue");
    assert_eq!(teamlead_items.len(), 1);
    assert_eq!(teamlead_items[0]["patient_id"], patient_id.to_string());

    let (status, concierge_rows) =
        json_request(&app, "GET", "/api/v1/feedback", &concierge_auth, None).await;
    assert_eq!(status, StatusCode::OK);
    let concierge_items = concierge_rows.as_array().expect("concierge feedback queue");
    assert_eq!(concierge_items.len(), 1);
    assert_eq!(concierge_items[0]["patient_id"], patient_id.to_string());

    let (status, unrelated_pm_rows) =
        json_request(&app, "GET", "/api/v1/feedback", &unrelated_pm_auth, None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        unrelated_pm_rows
            .as_array()
            .expect("unrelated pm queue")
            .len(),
        0,
        "unrelated PM must not see feedback from unassigned patient"
    );
}
