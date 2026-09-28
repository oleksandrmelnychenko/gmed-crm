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
    .bind(format!("announcements-{tag}@example.com"))
    .bind(format!("Announcements {tag}"))
    .bind(role)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn create_announcement(
    app: &axum::Router,
    bearer: &str,
    title: &str,
    variant: &str,
    audience: Option<&str>,
) -> String {
    let mut body =
        json!({ "title": title, "message": format!("{title} body"), "variant": variant });
    if let Some(audience) = audience {
        body["audience"] = json!(audience);
    }
    let (status, response) = json_request(
        app,
        "POST",
        "/api/v1/admin/announcements",
        bearer,
        Some(body),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{response}");
    response["id"].as_str().unwrap().to_string()
}

async fn active_ids(app: &axum::Router, bearer: &str) -> Vec<String> {
    let (status, body) =
        json_request(app, "GET", "/api/v1/announcements/active", bearer, None).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    body.as_array()
        .unwrap()
        .iter()
        .map(|item| item["id"].as_str().unwrap().to_string())
        .collect()
}

/// Owner decision 2026-09-28: announcements have an audience (staff,
/// patients, all; `all` by default as before).
#[tokio::test]
async fn announcements_reach_only_their_audience() {
    let Some(ctx) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let it_admin = auth_header_for(seed_user(&ctx.pool, "it_admin").await, "it_admin");
    let billing = auth_header_for(seed_user(&ctx.pool, "billing").await, "billing");
    let patient = auth_header_for(seed_user(&ctx.pool, "patient").await, "patient");

    let everyone = create_announcement(&ctx.app, &it_admin, "Everyone", "info", None).await;
    let staff = create_announcement(&ctx.app, &it_admin, "Staff", "info", Some("staff")).await;
    let patients =
        create_announcement(&ctx.app, &it_admin, "Patients", "warning", Some("patients")).await;

    let (status, body) = json_request(
        &ctx.app,
        "POST",
        "/api/v1/admin/announcements",
        &it_admin,
        Some(json!({ "title": "Bad", "message": "x", "audience": "partners" })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");

    let staff_view = active_ids(&ctx.app, &billing).await;
    assert!(staff_view.contains(&everyone));
    assert!(staff_view.contains(&staff));
    assert!(!staff_view.contains(&patients));

    let patient_view = active_ids(&ctx.app, &patient).await;
    assert!(patient_view.contains(&everyone));
    assert!(patient_view.contains(&patients));
    assert!(!patient_view.contains(&staff));

    // A patient cannot dismiss what is not addressed to them.
    let (status, _) = json_request(
        &ctx.app,
        "POST",
        &format!("/api/v1/announcements/{staff}/dismiss"),
        &patient,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    let (status, body) = json_request(
        &ctx.app,
        "GET",
        "/api/v1/admin/announcements",
        &it_admin,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let listed = body
        .as_array()
        .unwrap()
        .iter()
        .find(|item| item["id"] == staff.as_str())
        .expect("staff announcement listed");
    assert_eq!(listed["audience"], "staff");
    let listed = body
        .as_array()
        .unwrap()
        .iter()
        .find(|item| item["id"] == everyone.as_str())
        .expect("default announcement listed");
    assert_eq!(listed["audience"], "all");
}

/// Owner decision 2026-09-28: an error announcement cannot be dismissed while
/// it is active; other levels can.
#[tokio::test]
async fn error_announcements_cannot_be_dismissed_while_active() {
    let Some(ctx) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let it_admin = auth_header_for(seed_user(&ctx.pool, "it_admin").await, "it_admin");
    let manager = auth_header_for(
        seed_user(&ctx.pool, "patient_manager").await,
        "patient_manager",
    );

    let outage = create_announcement(&ctx.app, &it_admin, "Outage", "error", None).await;
    let notice = create_announcement(&ctx.app, &it_admin, "Notice", "warning", None).await;

    let (status, body) = json_request(
        &ctx.app,
        "GET",
        "/api/v1/announcements/active",
        &manager,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let items = body.as_array().unwrap();
    let outage_item = items
        .iter()
        .find(|item| item["id"] == outage.as_str())
        .unwrap();
    assert_eq!(outage_item["dismissible"], false);
    let notice_item = items
        .iter()
        .find(|item| item["id"] == notice.as_str())
        .unwrap();
    assert_eq!(notice_item["dismissible"], true);

    let (status, body) = json_request(
        &ctx.app,
        "POST",
        &format!("/api/v1/announcements/{outage}/dismiss"),
        &manager,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{body}");
    let (status, _) = json_request(
        &ctx.app,
        "POST",
        &format!("/api/v1/announcements/{notice}/dismiss"),
        &manager,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let view = active_ids(&ctx.app, &manager).await;
    assert!(view.contains(&outage));
    assert!(!view.contains(&notice));

    // Once switched off, the error announcement is gone and may be dismissed.
    let (status, body) = json_request(
        &ctx.app,
        "POST",
        &format!("/api/v1/admin/announcements/{outage}/update"),
        &it_admin,
        Some(json!({
            "title": "Outage",
            "message": "Outage body",
            "variant": "error",
            "is_active": false
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert!(!active_ids(&ctx.app, &manager).await.contains(&outage));
    let (status, _) = json_request(
        &ctx.app,
        "POST",
        &format!("/api/v1/announcements/{outage}/dismiss"),
        &manager,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
}
