mod support;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use serde_json::{Value, json};
use sqlx::PgPool;
use tower::ServiceExt;
use uuid::Uuid;

use gmed_server::auth::jwt;

const TEST_SECRET: &str = "test-secret-at-least-32-characters-long!!";

fn auth_header_for(user_id: Uuid, role: &str) -> String {
    let token = jwt::issue_access_token(TEST_SECRET, user_id, role, Uuid::new_v4()).unwrap();
    format!("Bearer {token}")
}

async fn request_json(
    app: &axum::Router,
    method: &str,
    path: &str,
    bearer: &str,
) -> (StatusCode, Value) {
    let request = Request::builder()
        .method(method)
        .uri(path)
        .header("Authorization", bearer)
        .body(Body::empty())
        .unwrap();
    let response = app.clone().oneshot(request).await.unwrap();
    let status = response.status();
    let bytes = axum::body::to_bytes(response.into_body(), 1024 * 1024)
        .await
        .unwrap();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(json!(null)),
    )
}

async fn seed_user(pool: &PgPool, role: &str) -> Uuid {
    let tag = Uuid::new_v4().simple();
    sqlx::query_scalar(
        r#"INSERT INTO users (email, password_hash, name, role)
           VALUES ($1, 'test-password-hash', $2, $3)
           RETURNING id"#,
    )
    .bind(format!("notifications-{tag}@example.com"))
    .bind(format!("Notifications {tag}"))
    .bind(role)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn seed_notification(pool: &PgPool, user_id: Uuid, title: &str) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO user_notifications (
                user_id, kind, title, body, entity_type, entity_id
           ) VALUES ($1, 'document_release', $2, 'Portal-safe update', 'document', $3)
           RETURNING id"#,
    )
    .bind(user_id)
    .bind(title)
    .bind(Uuid::new_v4())
    .fetch_one(pool)
    .await
    .unwrap()
}

#[tokio::test]
async fn patient_notifications_are_self_scoped_and_presence_is_staff_only() {
    let Some(ctx) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let patient_id = seed_user(&ctx.pool, "patient").await;
    let other_patient_id = seed_user(&ctx.pool, "patient").await;
    let own_notification = seed_notification(&ctx.pool, patient_id, "Own update").await;
    let other_notification = seed_notification(&ctx.pool, other_patient_id, "Other update").await;
    let patient_auth = auth_header_for(patient_id, "patient");

    let (status, payload) =
        request_json(&ctx.app, "GET", "/api/v1/notifications", &patient_auth).await;
    assert_eq!(status, StatusCode::OK);
    let rows = payload.as_array().unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0]["id"], own_notification.to_string());
    assert_eq!(rows[0]["title"], "Own update");

    let (status, payload) = request_json(
        &ctx.app,
        "GET",
        "/api/v1/notifications/unread-count",
        &patient_auth,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(payload["count"], 1);

    let (status, _) = request_json(
        &ctx.app,
        "POST",
        &format!("/api/v1/notifications/{other_notification}/read"),
        &patient_auth,
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    let (status, _) = request_json(
        &ctx.app,
        "POST",
        &format!("/api/v1/notifications/{own_notification}/read"),
        &patient_auth,
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (status, payload) = request_json(
        &ctx.app,
        "GET",
        "/api/v1/notifications/unread-count",
        &patient_auth,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(payload["count"], 0);

    let (status, _) = request_json(&ctx.app, "GET", "/api/v1/users/online", &patient_auth).await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    let admin_auth = auth_header_for(ctx.admin_id, "ceo");
    let (status, _) = request_json(&ctx.app, "GET", "/api/v1/users/online", &admin_auth).await;
    assert_eq!(status, StatusCode::OK);
}
