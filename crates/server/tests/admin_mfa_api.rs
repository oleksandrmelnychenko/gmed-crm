use axum::body::Body;
use axum::http::Request;
use axum::http::StatusCode;
use serde_json::{Value, json};
use tower::ServiceExt;

use gmed_server::auth::jwt;
use gmed_server::settings::{SettingsCache, TokenSettings};
use gmed_server::state::AppState;

const TEST_SECRET: &str = "test-secret-at-least-32-characters-long!!";

async fn test_app() -> Option<axum::Router> {
    let db_url = match std::env::var("DATABASE_URL") {
        Ok(url) => url,
        Err(_) => return None,
    };
    let pool = gmed_db::create_pool(&db_url).await.ok()?;
    gmed_db::run_migrations(&pool).await.ok()?;
    let settings_cache = SettingsCache::new(TokenSettings::default());
    let state = AppState::new(pool, TEST_SECRET, settings_cache);
    Some(gmed_server::build_app(state))
}

fn auth_header(role: &str) -> String {
    let token = jwt::issue_access_token(
        TEST_SECRET,
        uuid::Uuid::new_v4(),
        role,
        uuid::Uuid::new_v4(),
    )
    .unwrap();
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
    let Some(app) = test_app().await else { return };
    let admin = auth_header("it_admin");

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
    let Some(app) = test_app().await else { return };
    let admin = auth_header("it_admin");

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
    assert!(body.is_array());
}

#[tokio::test]
async fn activity_filter_by_action() {
    let Some(app) = test_app().await else { return };
    let (status, body) = json_request(
        &app,
        "GET",
        "/api/v1/admin/activity?action=login",
        &auth_header("it_admin"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(body.is_array());
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
    let Some(app) = test_app().await else { return };
    let fake = uuid::Uuid::new_v4();
    let req = Request::builder()
        .uri(format!("/api/v1/auth/pending/{fake}"))
        .body(Body::empty())
        .unwrap();
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::NOT_FOUND);
}
