use axum::body::Body;
use axum::http::{Request, StatusCode};
use serde_json::{Value, json};
use sqlx::PgPool;
use tower::ServiceExt;
use uuid::Uuid;

use gmed_server::auth::jwt;
use gmed_server::settings::{SettingsCache, TokenSettings};
use gmed_server::state::AppState;

const TEST_SECRET: &str = "test-secret-at-least-32-characters-long!!";

async fn test_context() -> Option<(axum::Router, PgPool, Uuid)> {
    let db_url = std::env::var("DATABASE_URL").ok()?;
    let pool = gmed_db::create_pool(&db_url).await.ok()?;
    gmed_db::run_migrations(&pool).await.ok()?;

    let admin_id: Uuid = sqlx::query_scalar("SELECT id FROM users WHERE email = $1")
        .bind("admin@gmed.de")
        .fetch_one(&pool)
        .await
        .ok()?;

    let state = AppState::new(
        pool.clone(),
        TEST_SECRET,
        SettingsCache::new(TokenSettings::default()),
    );

    Some((gmed_server::build_app(state), pool, admin_id))
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
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("feedback-portal");
    let patient_user_id = seed_user(&pool, &tag, "patient").await;
    let patient_manager_id = seed_user(&pool, &format!("{tag}-pm"), "patient_manager").await;
    let teamlead_id = seed_user(&pool, &format!("{tag}-tl"), "teamlead_interpreter").await;
    let concierge_id = seed_user(&pool, &format!("{tag}-concierge"), "concierge").await;
    let interpreter_id = seed_user(&pool, &format!("{tag}-interp"), "interpreter").await;
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let provider_id = seed_provider(&pool, &tag).await;
    let doctor_id = seed_doctor(&pool, provider_id, &tag).await;
    let appointment_id = seed_appointment(
        &pool,
        patient_id,
        provider_id,
        doctor_id,
        interpreter_id,
        admin_id,
        &tag,
    )
    .await;

    seed_patient_assignment(&pool, patient_id, patient_user_id, admin_id).await;
    seed_patient_assignment(&pool, patient_id, patient_manager_id, admin_id).await;
    seed_patient_assignment(&pool, patient_id, teamlead_id, admin_id).await;
    seed_patient_assignment(&pool, patient_id, concierge_id, admin_id).await;
    seed_patient_assignment(&pool, patient_id, interpreter_id, admin_id).await;

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
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(notification_count, 1);
}

#[tokio::test]
async fn teamlead_and_concierge_only_see_relevant_feedback_rows() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("feedback-scope");
    let patient_manager_id = seed_user(&pool, &format!("{tag}-pm"), "patient_manager").await;
    let teamlead_id = seed_user(&pool, &format!("{tag}-tl"), "teamlead_interpreter").await;
    let concierge_id = seed_user(&pool, &format!("{tag}-concierge"), "concierge").await;
    let interpreter_id = seed_user(&pool, &format!("{tag}-interp"), "interpreter").await;
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let provider_id = seed_provider(&pool, &tag).await;
    let doctor_id = seed_doctor(&pool, provider_id, &tag).await;
    let appointment_id = seed_appointment(
        &pool,
        patient_id,
        provider_id,
        doctor_id,
        interpreter_id,
        admin_id,
        &tag,
    )
    .await;

    seed_patient_assignment(&pool, patient_id, patient_manager_id, admin_id).await;
    seed_patient_assignment(&pool, patient_id, teamlead_id, admin_id).await;
    seed_patient_assignment(&pool, patient_id, concierge_id, admin_id).await;

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
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("feedback-timeline");
    let patient_manager_id = seed_user(&pool, &format!("{tag}-pm"), "patient_manager").await;
    let interpreter_id = seed_user(&pool, &format!("{tag}-interp"), "interpreter").await;
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let provider_id = seed_provider(&pool, &tag).await;
    let doctor_id = seed_doctor(&pool, provider_id, &tag).await;
    let appointment_id = seed_appointment(
        &pool,
        patient_id,
        provider_id,
        doctor_id,
        interpreter_id,
        admin_id,
        &tag,
    )
    .await;

    seed_patient_assignment(&pool, patient_id, patient_manager_id, admin_id).await;

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

    let (status, timeline) = json_request(
        &app,
        "GET",
        &format!("/api/v1/patients/{patient_id}/timeline"),
        &pm_auth,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let items = timeline["items"].as_array().unwrap();
    assert!(
        items
            .iter()
            .any(|item| item["title"] == "Patient feedback submitted"),
        "feedback submission should appear in patient timeline"
    );
    assert!(
        items
            .iter()
            .any(|item| item["title"] == "Patient feedback reviewed"),
        "feedback review should appear in patient timeline"
    );
}
