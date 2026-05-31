mod support;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use serde_json::{Value, json};
use sqlx::{PgPool, Row};
use tower::ServiceExt;
use uuid::Uuid;

use gmed_server::auth::jwt;

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

#[tokio::test]
async fn manager_can_save_interpreter_profile_and_interpreter_can_view_self() {
    let Some((app, pool, _admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("interpreter-profile");
    let pm_id = seed_user(&pool, &format!("{tag}-pm"), "patient_manager").await;
    let interpreter_id = seed_user(&pool, &format!("{tag}-int"), "interpreter").await;
    let other_interpreter_id = seed_user(&pool, &format!("{tag}-other"), "interpreter").await;
    let pm_bearer = auth_header_for(pm_id, "patient_manager");
    let interpreter_bearer = auth_header_for(interpreter_id, "interpreter");
    let other_bearer = auth_header_for(other_interpreter_id, "interpreter");

    let (status, body) = json_request(&app, "GET", "/api/v1/interpreters", &pm_bearer, None).await;
    assert_eq!(status, StatusCode::OK);
    assert!(
        body.as_array()
            .unwrap()
            .iter()
            .any(|item| item["id"] == interpreter_id.to_string())
    );

    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/interpreters?status=active&search={tag}-int"),
        &pm_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body:?}");
    assert!(
        body.as_array()
            .unwrap()
            .iter()
            .any(|item| item["id"] == interpreter_id.to_string())
    );

    let profile = json!({
        "status": "active",
        "contractType": "freelancer",
        "employmentKind": "external",
        "phone": "+49 170 000000",
        "workCountries": ["DE"],
        "workLocations": ["Berlin", "Charite"],
        "languages": [
            { "language": "de", "level": "C1", "specialization": "medicine" }
        ],
        "compliance": {
            "confidentialityStatus": "signed",
            "gdprTrainingAt": "2026-05-31"
        },
        "finance": {
            "hourlyRate": 45,
            "billingStatus": "unpaid"
        },
        "access": {
            "level": "appointment_only",
            "autoBlockPolicy": "immediate"
        },
        "equipment": ["Secure phone"],
        "internalNotes": "Ready for controlled rollout"
    });

    let (status, body) = json_request(
        &app,
        "PUT",
        &format!("/api/v1/interpreters/{interpreter_id}/profile"),
        &pm_bearer,
        Some(profile.clone()),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body:?}");
    assert_eq!(body["profile"]["status"], "active");
    assert_eq!(body["profile"]["finance"]["hourlyRate"], 45);
    assert_eq!(body["profile"]["workCountries"], json!(["DE"]));
    assert_eq!(
        body["profile"]["workLocations"],
        json!(["Berlin", "Charite"])
    );

    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/interpreters?status=active&contract_type=freelancer&search={tag}"),
        &pm_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body:?}");
    assert!(
        body.as_array()
            .unwrap()
            .iter()
            .any(|item| item["id"] == interpreter_id.to_string())
    );

    let (status, body) = json_request(
        &app,
        "GET",
        "/api/v1/interpreters?status=invalid",
        &pm_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(body["message"], "Invalid interpreter status");

    let details = sqlx::query(
        r#"SELECT status, contract_type, phone, email_secure
           FROM interpreter_profile_details
           WHERE user_id = $1"#,
    )
    .bind(interpreter_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(details.try_get::<String, _>("status").unwrap(), "active");
    assert_eq!(
        details
            .try_get::<Option<String>, _>("contract_type")
            .unwrap()
            .as_deref(),
        Some("freelancer")
    );
    assert_eq!(
        details
            .try_get::<Option<String>, _>("phone")
            .unwrap()
            .as_deref(),
        Some("+49 170 000000")
    );
    assert!(!details.try_get::<bool, _>("email_secure").unwrap());

    let hourly_rate: Option<String> = sqlx::query_scalar(
        "SELECT hourly_rate::text FROM interpreter_finance_profiles WHERE user_id = $1",
    )
    .bind(interpreter_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(hourly_rate.as_deref(), Some("45.00"));

    let zone_count: i64 = sqlx::query_scalar(
        r#"SELECT count(*)
           FROM interpreter_work_zones
           WHERE interpreter_id = $1
             AND value IN ('DE', 'Berlin', 'Charite')"#,
    )
    .bind(interpreter_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(zone_count, 3);

    let equipment_count: i64 = sqlx::query_scalar(
        r#"SELECT count(*)
           FROM interpreter_equipment
           WHERE interpreter_id = $1
             AND label = 'Secure phone'"#,
    )
    .bind(interpreter_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(equipment_count, 1);

    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/interpreters/{interpreter_id}/profile"),
        &interpreter_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body:?}");
    assert_eq!(body["profile"]["contractType"], "freelancer");

    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/interpreters/{interpreter_id}/profile"),
        &other_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(body["message"], "Insufficient permissions");

    let (status, body) = json_request(
        &app,
        "PUT",
        &format!("/api/v1/interpreters/{interpreter_id}/profile"),
        &interpreter_bearer,
        Some(json!({ "status": "blocked" })),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(body["message"], "Insufficient permissions");
}

#[tokio::test]
async fn interpreter_profile_rejects_invalid_structured_values() {
    let Some((app, pool, _admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("interpreter-profile-invalid");
    let pm_id = seed_user(&pool, &format!("{tag}-pm"), "patient_manager").await;
    let interpreter_id = seed_user(&pool, &format!("{tag}-int"), "interpreter").await;
    let pm_bearer = auth_header_for(pm_id, "patient_manager");

    let (status, body) = json_request(
        &app,
        "PUT",
        &format!("/api/v1/interpreters/{interpreter_id}/profile"),
        &pm_bearer,
        Some(json!({
            "status": "unknown",
            "finance": { "hourlyRate": "not-a-number" }
        })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(body["message"], "Invalid interpreter status");
}
