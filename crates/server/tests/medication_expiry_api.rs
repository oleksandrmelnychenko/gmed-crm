mod support;

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
    let ctx = support::suite_context(TEST_SECRET).await?;
    Some((ctx.app, ctx.pool, ctx.admin_id))
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

fn auth_header_for(user_id: Uuid, role: &str) -> String {
    let token = jwt::issue_access_token(TEST_SECRET, user_id, role, Uuid::new_v4()).unwrap();
    format!("Bearer {token}")
}

fn unique_tag(prefix: &str) -> String {
    format!("{prefix}-{}", Uuid::new_v4().simple())
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
        r#"INSERT INTO patients (patient_id, first_name, last_name, birth_date, gender, created_by, languages)
           VALUES ($1, $2, $3, '1990-01-01', 'diverse', $4, ARRAY['de','en']::text[])
           RETURNING id"#,
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
    assigned_user_id: Uuid,
    assigned_by: Uuid,
) {
    sqlx::query(
        r#"INSERT INTO patient_assignments (patient_id, user_id, assigned_by)
           VALUES ($1, $2, $3)"#,
    )
    .bind(patient_id)
    .bind(assigned_user_id)
    .bind(assigned_by)
    .execute(pool)
    .await
    .unwrap();
}

#[tokio::test]
async fn permanent_medication_expiry_scheduler_creates_confirmation_work_without_duplicates() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("case-medication-expiry");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let pm_id = seed_user(&pool, &tag, "patient_manager").await;
    seed_patient_assignment(&pool, patient_id, pm_id, admin_id).await;
    let pm_bearer = auth_header_for(pm_id, "patient_manager");

    let (status, created_body) = json_request(
        &app,
        "POST",
        "/api/v1/cases",
        &pm_bearer,
        Some(json!({
            "patient_id": patient_id,
            "hauptanfragegrund": "Medication expiry review"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let case_id = Uuid::parse_str(created_body["id"].as_str().expect("created case id")).unwrap();

    let expired_on = (chrono::Utc::now().date_naive() - chrono::Duration::days(2)).to_string();
    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/cases/{case_id}/medikamente"),
        &pm_bearer,
        Some(json!({
            "items": [{
                "handelsname": "Atorvastatin",
                "wirkstoff": "Atorvastatin",
                "med_typ": "permanent",
                "expiry_date": expired_on,
                "dosis": "20",
                "dosis_einheit": "mg"
            }]
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["count"], 1);

    let (status, detail) = json_request(
        &app,
        "GET",
        &format!("/api/v1/cases/{case_id}"),
        &pm_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let medications = detail["medikamente"].as_array().expect("medication array");
    assert_eq!(medications.len(), 1);
    assert_eq!(medications[0]["expiry_date"], expired_on);
    assert_eq!(medications[0]["is_expired"], true);
    assert_eq!(medications[0]["pending_expiry_confirmation"], false);
    let medication_id =
        Uuid::parse_str(medications[0]["id"].as_str().expect("medication id")).unwrap();

    let state = AppState::new(
        pool.clone(),
        TEST_SECRET,
        SettingsCache::new(TokenSettings::default()),
    );
    let first_summary = gmed_server::routes::cases::run_medication_expiry_scheduler_once(&state)
        .await
        .expect("first medication expiry run");
    assert_eq!(first_summary.events_created, 1);
    assert_eq!(first_summary.notifications_created, 1);

    let second_summary = gmed_server::routes::cases::run_medication_expiry_scheduler_once(&state)
        .await
        .expect("second medication expiry run");
    assert_eq!(second_summary.events_created, 0);
    assert_eq!(second_summary.notifications_created, 0);

    let pending_events: i64 = sqlx::query_scalar(
        r#"SELECT count(*)
           FROM medication_expiry_events
           WHERE medication_id = $1
             AND status = 'pending_confirmation'"#,
    )
    .bind(medication_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(pending_events, 1);

    let notification_count: i64 = sqlx::query_scalar(
        r#"SELECT count(*)
           FROM user_notifications
           WHERE user_id = $1
             AND kind = 'medication_expiry_confirmation'
             AND entity_type = 'case'
             AND entity_id = $2"#,
    )
    .bind(pm_id)
    .bind(case_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(notification_count, 1);

    let (status, detail) = json_request(
        &app,
        "GET",
        &format!("/api/v1/cases/{case_id}"),
        &pm_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        detail["medikamente"][0]["pending_expiry_confirmation"],
        true
    );

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/cases/{case_id}/medikamente/{medication_id}/expiry-confirm"),
        &pm_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["ok"], true);

    let confirmed_events: i64 = sqlx::query_scalar(
        r#"SELECT count(*)
           FROM medication_expiry_events
           WHERE medication_id = $1
             AND status = 'confirmed'"#,
    )
    .bind(medication_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(confirmed_events, 1);

    let (status, detail) = json_request(
        &app,
        "GET",
        &format!("/api/v1/cases/{case_id}"),
        &pm_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        detail["medikamente"][0]["pending_expiry_confirmation"],
        false
    );
    assert_eq!(detail["medikamente"][0]["is_expired"], true);
}
