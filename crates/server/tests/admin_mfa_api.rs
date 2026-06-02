mod support;

use axum::body::Body;
use axum::http::Request;
use axum::http::StatusCode;
use serde_json::{Value, json};
use sqlx::PgPool;
use tower::ServiceExt;
use uuid::Uuid;

use gmed_server::auth::jwt;
const TEST_SECRET: &str = "test-secret-at-least-32-characters-long!!";

struct TestContext {
    suite: support::TestSuiteContext,
    it_admin_id: Uuid,
}

impl std::ops::Deref for TestContext {
    type Target = axum::Router;

    fn deref(&self) -> &Self::Target {
        &self.suite.app
    }
}

async fn test_app() -> Option<TestContext> {
    test_context().await
}

/// Returns `(router, it_admin_user_id)`. Tests that exercise routes which
/// audit-log the actor (e.g. settings updates) need a real user row so the
/// `users(id)` foreign keys resolve.
async fn test_context() -> Option<TestContext> {
    let ctx = support::suite_context(TEST_SECRET).await?;
    let it_admin_id = seed_user(&ctx.pool, "admin_mfa_api", "it_admin").await;
    Some(TestContext {
        suite: ctx,
        it_admin_id,
    })
}

async fn seed_user(pool: &PgPool, tag: &str, role: &str) -> Uuid {
    let suffix = Uuid::new_v4().simple().to_string();
    sqlx::query_scalar(
        r#"INSERT INTO users (email, password_hash, name, role)
           VALUES ($1, $2, $3, $4)
           RETURNING id"#,
    )
    .bind(format!("{tag}-{role}-{suffix}@example.com"))
    .bind("test-password-hash")
    .bind(format!("{role} {tag}"))
    .bind(role)
    .fetch_one(pool)
    .await
    .unwrap()
}

fn auth_header(role: &str) -> String {
    auth_header_for(role, Uuid::new_v4())
}

fn auth_header_for(role: &str, user_id: Uuid) -> String {
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
    let body = match body {
        Some(v) => Body::from(serde_json::to_vec(&v).unwrap()),
        None => Body::empty(),
    };
    let req = Request::builder()
        .method(method)
        .uri(path)
        .header("Authorization", bearer)
        .header("Content-Type", "application/json")
        .body(body)
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();
    let status = resp.status();
    let bytes = axum::body::to_bytes(resp.into_body(), 1024 * 1024)
        .await
        .unwrap();
    let value: Value = serde_json::from_slice(&bytes).unwrap_or(json!(null));
    (status, value)
}

#[tokio::test]
async fn settings_list_requires_it_admin() {
    let Some(app) = test_app().await else { return };
    let (status, _) = json_request(
        &app,
        "GET",
        "/api/v1/admin/settings",
        &auth_header("sales"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn settings_list_ok_for_it_admin() {
    let Some(app) = test_app().await else { return };
    let (status, body) = json_request(
        &app,
        "GET",
        "/api/v1/admin/settings",
        &auth_header("it_admin"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(body.is_array());
    let arr = body.as_array().unwrap();
    assert!(arr.iter().any(|s| s["key"] == "access_token_minutes"));
    assert!(arr.iter().any(|s| s["key"] == "refresh_token_days"));
    assert!(arr.iter().any(|s| s["key"] == "agency_name"));
    assert!(arr.iter().any(|s| s["key"] == "agency_email"));
    assert!(arr.iter().any(|s| s["key"] == "required_patient_documents"));
    assert!(
        arr.iter()
            .any(|s| s["key"] == "clinical_case_retention_years")
    );
}

#[tokio::test]
async fn settings_update_requires_it_admin() {
    let Some(app) = test_app().await else { return };
    let (status, _) = json_request(
        &app,
        "POST",
        "/api/v1/admin/settings/access_token_minutes",
        &auth_header("sales"),
        Some(json!({"value": "30"})),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn settings_update_validates_bounds() {
    let Some(app) = test_app().await else { return };
    let admin = auth_header("it_admin");

    let (status, _) = json_request(
        &app,
        "POST",
        "/api/v1/admin/settings/access_token_minutes",
        &admin,
        Some(json!({"value": "9999"})),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);

    let (status, _) = json_request(
        &app,
        "POST",
        "/api/v1/admin/settings/access_token_minutes",
        &admin,
        Some(json!({"value": "0"})),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);

    let (status, _) = json_request(
        &app,
        "POST",
        "/api/v1/admin/settings/access_token_minutes",
        &admin,
        Some(json!({"value": "not_a_number"})),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
}

#[tokio::test]
async fn settings_update_valid_value() {
    let Some(app) = test_context().await else {
        return;
    };
    let admin = auth_header_for("it_admin", app.it_admin_id);

    let (status, body) = json_request(
        &app,
        "POST",
        "/api/v1/admin/settings/access_token_minutes",
        &admin,
        Some(json!({"value": "20"})),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["ok"], true);

    let (status, body) = json_request(
        &app,
        "POST",
        "/api/v1/admin/settings/access_token_minutes",
        &admin,
        Some(json!({"value": "15"})),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["ok"], true);
}

#[tokio::test]
async fn settings_update_accepts_agency_profile_values() {
    let Some(app) = test_context().await else {
        return;
    };
    let admin = auth_header_for("it_admin", app.it_admin_id);

    let (status, body) = json_request(
        &app,
        "POST",
        "/api/v1/admin/settings/agency_name",
        &admin,
        Some(json!({"value": "GMED Operations"})),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["ok"], true);

    let (status, body) = json_request(
        &app,
        "POST",
        "/api/v1/admin/settings/agency_email",
        &admin,
        Some(json!({"value": "ops@gmed.de"})),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["ok"], true);

    let (status, body) = json_request(
        &app,
        "POST",
        "/api/v1/admin/settings/required_patient_documents",
        &admin,
        Some(json!({"value": r#"[
          {"key":"passport","label":"Reisepass","art":["passport_scan"],"category":["identity"]},
          {"key":"consent_form","label":"Einverständniserklärung","art":["consent_form"],"category":["consent"]}
        ]"#})),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["ok"], true);

    let (status, body) = json_request(
        &app,
        "POST",
        "/api/v1/admin/settings/clinical_case_retention_years",
        &admin,
        Some(json!({"value": "35"})),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["ok"], true);
}

#[tokio::test]
async fn settings_update_rejects_invalid_agency_email() {
    let Some(app) = test_app().await else { return };
    let (status, _) = json_request(
        &app,
        "POST",
        "/api/v1/admin/settings/agency_email",
        &auth_header("it_admin"),
        Some(json!({"value": "invalid-email"})),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
}

#[tokio::test]
async fn settings_update_rejects_invalid_required_patient_documents_json() {
    let Some(app) = test_app().await else { return };
    let (status, _) = json_request(
        &app,
        "POST",
        "/api/v1/admin/settings/required_patient_documents",
        &auth_header("it_admin"),
        Some(json!({"value": r#"{"key":"passport"}"#})),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
}

#[tokio::test]
async fn settings_update_nonexistent_key() {
    let Some(app) = test_app().await else { return };
    let (status, _) = json_request(
        &app,
        "POST",
        "/api/v1/admin/settings/nonexistent_key",
        &auth_header("it_admin"),
        Some(json!({"value": "10"})),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn sessions_list_requires_it_admin() {
    let Some(app) = test_app().await else { return };
    let (status, _) = json_request(
        &app,
        "GET",
        "/api/v1/admin/sessions",
        &auth_header("sales"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn sessions_list_ok_for_it_admin() {
    let Some(app) = test_app().await else { return };
    let (status, body) = json_request(
        &app,
        "GET",
        "/api/v1/admin/sessions",
        &auth_header("it_admin"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(body.is_array());
}

#[tokio::test]
async fn revoke_all_sessions_requires_it_admin() {
    let Some(app) = test_app().await else { return };
    let (status, _) = json_request(
        &app,
        "POST",
        "/api/v1/admin/sessions/revoke-all",
        &auth_header("sales"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn activity_list_requires_it_admin() {
    let Some(app) = test_app().await else { return };
    let (status, _) = json_request(
        &app,
        "GET",
        "/api/v1/admin/activity",
        &auth_header("sales"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn activity_list_ok_for_it_admin() {
    let Some(app) = test_app().await else { return };
    let (status, body) = json_request(
        &app,
        "GET",
        "/api/v1/admin/activity",
        &auth_header("it_admin"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(body["items"].is_array());
    assert_eq!(body["limit"], 50);
    assert_eq!(body["offset"], 0);
    assert!(body["total"].is_number());
    assert!(body["has_more"].is_boolean());
}

#[tokio::test]
async fn activity_filter_by_action() {
    let Some(app) = test_app().await else { return };
    let (status, body) = json_request(
        &app,
        "GET",
        "/api/v1/admin/activity?action=login&limit=25&offset=0&date_from=2026-01-01&date_to=2026-12-31",
        &auth_header("it_admin"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(body["items"].is_array());
    assert_eq!(body["limit"], 25);
    assert_eq!(body["offset"], 0);
    assert!(body["total"].is_number());
}

#[tokio::test]
async fn activity_rejects_invalid_date_range() {
    let Some(app) = test_app().await else { return };
    let (status, _) = json_request(
        &app,
        "GET",
        "/api/v1/admin/activity?date_from=2026-12-31&date_to=2026-01-01",
        &auth_header("it_admin"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
}

#[tokio::test]
async fn mfa_pending_list_requires_it_admin() {
    let Some(app) = test_app().await else { return };
    let (status, _) = json_request(
        &app,
        "GET",
        "/api/v1/admin/mfa/pending",
        &auth_header("sales"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn mfa_pending_list_ok_for_it_admin() {
    let Some(app) = test_app().await else { return };
    let (status, body) = json_request(
        &app,
        "GET",
        "/api/v1/admin/mfa/pending",
        &auth_header("it_admin"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(body.is_array());
}

#[tokio::test]
async fn mfa_toggle_requires_it_admin() {
    let Some(app) = test_app().await else { return };
    let fake = uuid::Uuid::new_v4();
    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/admin/mfa/user/{fake}/toggle"),
        &auth_header("sales"),
        Some(json!({"enabled": true})),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn mfa_approve_nonexistent_returns_not_found() {
    let Some(app) = test_app().await else { return };
    let fake = uuid::Uuid::new_v4();
    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/admin/mfa/pending/{fake}/approve"),
        &auth_header("it_admin"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn mfa_reject_nonexistent_returns_not_found() {
    let Some(app) = test_app().await else { return };
    let fake = uuid::Uuid::new_v4();
    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/admin/mfa/pending/{fake}/reject"),
        &auth_header("it_admin"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn check_pending_nonexistent_returns_not_found() {
    let Some(ctx) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let app = ctx.app.clone();
    let fake = uuid::Uuid::new_v4();
    let req = Request::builder()
        .uri(format!("/api/v1/auth/pending/{fake}"))
        .body(Body::empty())
        .unwrap();
    let resp = app.oneshot(req).await.unwrap();
    let status = resp.status();
    let bytes = axum::body::to_bytes(resp.into_body(), 1024 * 1024)
        .await
        .unwrap();
    let body = String::from_utf8_lossy(&bytes);
    assert_eq!(status, StatusCode::NOT_FOUND, "response body: {body}");
}
