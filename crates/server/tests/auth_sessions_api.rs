mod support;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use chrono::{Duration, Utc};
use serde_json::{Value, json};
use sqlx::PgPool;
use tower::ServiceExt;
use uuid::Uuid;

use gmed_server::auth::{jwt, password, tokens};
use gmed_server::settings::TokenSettings;

const TEST_SECRET: &str = "test-secret-at-least-32-characters-long!!";

async fn test_context() -> Option<(axum::Router, PgPool)> {
    let ctx = support::suite_context(TEST_SECRET).await?;
    Some((ctx.app, ctx.pool))
}

async fn seed_user(pool: &PgPool, tag: &str, role: &str) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO users (email, password_hash, name, role)
           VALUES ($1, $2, $3, $4)
           RETURNING id"#,
    )
    .bind(format!(
        "{tag}-{role}-{}@example.com",
        Uuid::new_v4().simple()
    ))
    .bind("test-password-hash")
    .bind(format!("{role} {tag}"))
    .bind(role)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn seed_user_with_password_and_flags(
    pool: &PgPool,
    email: &str,
    role: &str,
    password_plain: &str,
    is_active: bool,
    mfa_required: bool,
    locked_until: Option<chrono::DateTime<Utc>>,
) -> Uuid {
    let hash = password::hash_password(password_plain).expect("password hash");
    let id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO users (email, password_hash, name, role, is_active, mfa_required, locked_until)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING id"#,
    )
    .bind(email)
    .bind(&hash)
    .bind(format!("Auth test {role}"))
    .bind(role)
    .bind(is_active)
    .bind(mfa_required)
    .bind(locked_until)
    .fetch_one(pool)
    .await
    .expect("insert user");
    id
}

fn ceo_admin_bearer(admin_id: Uuid) -> String {
    let token = jwt::issue_access_token(TEST_SECRET, admin_id, "ceo", Uuid::new_v4())
        .expect("issue admin jwt");
    format!("Bearer {token}")
}

async fn json_request(
    app: &axum::Router,
    method: &str,
    path: &str,
    bearer: Option<&str>,
    body: Option<Value>,
) -> (StatusCode, Value) {
    let request_body = match body {
        Some(value) => Body::from(serde_json::to_vec(&value).unwrap()),
        None => Body::empty(),
    };

    let mut builder = Request::builder()
        .method(method)
        .uri(path)
        .header("Content-Type", "application/json");
    if let Some(token) = bearer {
        builder = builder.header("Authorization", token);
    }

    let request = builder.body(request_body).unwrap();
    let response = app.clone().oneshot(request).await.unwrap();
    let status = response.status();
    let bytes = axum::body::to_bytes(response.into_body(), 1024 * 1024)
        .await
        .unwrap();
    let payload: Value = serde_json::from_slice(&bytes).unwrap_or(json!(null));
    (status, payload)
}

fn bearer(access_token: &str) -> String {
    format!("Bearer {access_token}")
}

#[tokio::test]
async fn missing_api_route_returns_json_not_found() {
    let Some((app, _pool)) = test_context().await else {
        return;
    };

    let (status, body) = json_request(&app, "GET", "/api/v1/no-such-route", None, None).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(body["error"], "not_found");
}

#[tokio::test]
async fn logout_blacklists_current_access_token_and_revokes_family_refresh() {
    let Some((app, pool)) = test_context().await else {
        return;
    };

    let user_id = seed_user(&pool, "auth_sessions_logout", "patient_manager").await;
    let settings = TokenSettings::default();
    let session = tokens::create_session(
        &pool,
        TEST_SECRET,
        user_id,
        "patient_manager",
        Some("device-a"),
        Some("127.0.0.1"),
        Some("integration-test"),
        &settings,
    )
    .await
    .unwrap();
    let claims = jwt::verify_access_token(TEST_SECRET, &session.access_token)
        .unwrap()
        .claims;
    let auth = bearer(&session.access_token);

    let (status, sessions_before) =
        json_request(&app, "GET", "/api/v1/auth/sessions", Some(&auth), None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(sessions_before.as_array().map_or(0, |items| items.len()), 1);

    let (status, body) = json_request(&app, "POST", "/api/v1/auth/logout", Some(&auth), None).await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    assert!(body.is_null());

    let current_token_revoked: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM revoked_access_tokens WHERE jti = $1)")
            .bind(claims.jti)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert!(current_token_revoked);

    let family_blacklisted: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM revoked_access_tokens WHERE family_id = $1)",
    )
    .bind(claims.fam)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(family_blacklisted);

    let (status, unauthorized_body) =
        json_request(&app, "GET", "/api/v1/auth/sessions", Some(&auth), None).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(unauthorized_body["error"], "unauthorized");

    let (status, refresh_body) = json_request(
        &app,
        "POST",
        "/api/v1/auth/refresh",
        None,
        Some(json!({ "refresh_token": session.refresh_token })),
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(refresh_body["error"], "session_revoked");
}

#[tokio::test]
async fn logout_all_revokes_other_session_access_tokens_too() {
    let Some((app, pool)) = test_context().await else {
        return;
    };

    let user_id = seed_user(&pool, "auth_sessions_logout_all", "patient_manager").await;
    let settings = TokenSettings::default();

    let session_a = tokens::create_session(
        &pool,
        TEST_SECRET,
        user_id,
        "patient_manager",
        Some("device-a"),
        Some("127.0.0.1"),
        Some("integration-test-a"),
        &settings,
    )
    .await
    .unwrap();
    let session_b = tokens::create_session(
        &pool,
        TEST_SECRET,
        user_id,
        "patient_manager",
        Some("device-b"),
        Some("127.0.0.2"),
        Some("integration-test-b"),
        &settings,
    )
    .await
    .unwrap();

    let claims_a = jwt::verify_access_token(TEST_SECRET, &session_a.access_token)
        .unwrap()
        .claims;
    let claims_b = jwt::verify_access_token(TEST_SECRET, &session_b.access_token)
        .unwrap()
        .claims;
    let auth_a = bearer(&session_a.access_token);
    let auth_b = bearer(&session_b.access_token);

    let (status, sessions_before) =
        json_request(&app, "GET", "/api/v1/auth/sessions", Some(&auth_b), None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(sessions_before.as_array().map_or(0, |items| items.len()), 2);

    let (status, body) =
        json_request(&app, "POST", "/api/v1/auth/logout-all", Some(&auth_a), None).await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    assert!(body.is_null());

    let family_a_blacklisted: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM revoked_access_tokens WHERE family_id = $1)",
    )
    .bind(claims_a.fam)
    .fetch_one(&pool)
    .await
    .unwrap();
    let family_b_blacklisted: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM revoked_access_tokens WHERE family_id = $1)",
    )
    .bind(claims_b.fam)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(family_a_blacklisted);
    assert!(family_b_blacklisted);

    let (status, unauthorized_body) =
        json_request(&app, "GET", "/api/v1/auth/sessions", Some(&auth_b), None).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(unauthorized_body["error"], "unauthorized");

    let (status, refresh_body) = json_request(
        &app,
        "POST",
        "/api/v1/auth/refresh",
        None,
        Some(json!({ "refresh_token": session_b.refresh_token })),
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(refresh_body["error"], "session_revoked");
}

#[tokio::test]
async fn login_succeeds_with_seeded_admin_crypt_password() {
    let Some((app, _pool)) = test_context().await else {
        return;
    };

    let (status, body) = json_request(
        &app,
        "POST",
        "/api/v1/auth/login",
        None,
        Some(json!({ "email": "admin@gmed.de", "password": "admin123" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(body["access_token"].as_str().is_some());
    assert!(body["refresh_token"].as_str().is_some());
    assert_eq!(body["token_type"], "Bearer");
    assert!(body["expires_in"].as_i64().is_some_and(|v| v > 0));
}

#[tokio::test]
async fn login_rejects_unknown_email() {
    let Some((app, _pool)) = test_context().await else {
        return;
    };

    let bogus = format!("no-such-user-{}@example.com", Uuid::new_v4().simple());
    let (status, body) = json_request(
        &app,
        "POST",
        "/api/v1/auth/login",
        None,
        Some(json!({ "email": bogus, "password": "irrelevant" })),
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(body["error"], "unauthorized");
}

#[tokio::test]
async fn login_rejects_wrong_password() {
    let Some((app, pool)) = test_context().await else {
        return;
    };

    let tag = Uuid::new_v4().simple();
    let email = format!("auth-wrong-pw-{tag}@example.com");
    let _ = seed_user_with_password_and_flags(
        &pool,
        &email,
        "patient_manager",
        "correct-horse-battery",
        true,
        false,
        None,
    )
    .await;

    let (status, body) = json_request(
        &app,
        "POST",
        "/api/v1/auth/login",
        None,
        Some(json!({ "email": email, "password": "wrong-password" })),
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(body["error"], "unauthorized");
}

#[tokio::test]
async fn login_validation_rejects_invalid_email() {
    let Some((app, _pool)) = test_context().await else {
        return;
    };

    let (status, body) = json_request(
        &app,
        "POST",
        "/api/v1/auth/login",
        None,
        Some(json!({ "email": "not-an-email", "password": "x" })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(body["error"], "validation_error");
}

#[tokio::test]
async fn login_validation_rejects_empty_password() {
    let Some((app, _pool)) = test_context().await else {
        return;
    };

    let (status, body) = json_request(
        &app,
        "POST",
        "/api/v1/auth/login",
        None,
        Some(json!({ "email": "a@b.co", "password": "" })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(body["error"], "validation_error");
}

#[tokio::test]
async fn login_rejects_inactive_user() {
    let Some((app, pool)) = test_context().await else {
        return;
    };

    let tag = Uuid::new_v4().simple();
    let email = format!("auth-inactive-{tag}@example.com");
    let _ = seed_user_with_password_and_flags(
        &pool,
        &email,
        "patient_manager",
        "secret-pass",
        false,
        false,
        None,
    )
    .await;

    let (status, body) = json_request(
        &app,
        "POST",
        "/api/v1/auth/login",
        None,
        Some(json!({ "email": email, "password": "secret-pass" })),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(body["error"], "forbidden");
}

#[tokio::test]
async fn login_rejects_account_locked_until_expires() {
    let Some((app, pool)) = test_context().await else {
        return;
    };

    let tag = Uuid::new_v4().simple();
    let email = format!("auth-locked-{tag}@example.com");
    let lock_until = Utc::now() + Duration::hours(1);
    let _ = seed_user_with_password_and_flags(
        &pool,
        &email,
        "patient_manager",
        "still-secret",
        true,
        false,
        Some(lock_until),
    )
    .await;

    let (status, body) = json_request(
        &app,
        "POST",
        "/api/v1/auth/login",
        None,
        Some(json!({ "email": email, "password": "still-secret" })),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(body["error"], "account_locked");
}

#[tokio::test]
async fn login_locks_after_max_failed_password_attempts() {
    let Some((app, pool)) = test_context().await else {
        return;
    };

    let tag = Uuid::new_v4().simple();
    let email = format!("auth-lockout-{tag}@example.com");
    let _ = seed_user_with_password_and_flags(
        &pool,
        &email,
        "billing",
        "real-password-only",
        true,
        false,
        None,
    )
    .await;

    for _ in 0..4 {
        let (status, body) = json_request(
            &app,
            "POST",
            "/api/v1/auth/login",
            None,
            Some(json!({ "email": email.clone(), "password": "bad" })),
        )
        .await;
        assert_eq!(status, StatusCode::UNAUTHORIZED);
        assert_eq!(body["error"], "unauthorized");
    }

    let (status, body) = json_request(
        &app,
        "POST",
        "/api/v1/auth/login",
        None,
        Some(json!({ "email": email.clone(), "password": "bad" })),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(body["error"], "account_locked");

    let (status, body) = json_request(
        &app,
        "POST",
        "/api/v1/auth/login",
        None,
        Some(json!({ "email": email, "password": "real-password-only" })),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(body["error"], "account_locked");
}

#[tokio::test]
async fn refresh_rotates_refresh_token_and_old_refresh_triggers_theft() {
    let Some((app, _pool)) = test_context().await else {
        return;
    };

    let (status, login_body) = json_request(
        &app,
        "POST",
        "/api/v1/auth/login",
        None,
        Some(json!({ "email": "admin@gmed.de", "password": "admin123" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let refresh0 = login_body["refresh_token"]
        .as_str()
        .expect("refresh0")
        .to_string();

    let (status, rot1) = json_request(
        &app,
        "POST",
        "/api/v1/auth/refresh",
        None,
        Some(json!({ "refresh_token": refresh0 })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let refresh1 = rot1["refresh_token"]
        .as_str()
        .expect("refresh1")
        .to_string();
    assert_ne!(refresh0, refresh1);

    let (status, theft_body) = json_request(
        &app,
        "POST",
        "/api/v1/auth/refresh",
        None,
        Some(json!({ "refresh_token": refresh0 })),
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(theft_body["error"], "token_theft_detected");

    let (status, revoked_body) = json_request(
        &app,
        "POST",
        "/api/v1/auth/refresh",
        None,
        Some(json!({ "refresh_token": refresh1 })),
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(revoked_body["error"], "session_revoked");
}

#[tokio::test]
async fn refresh_rejects_unknown_token() {
    let Some((app, _pool)) = test_context().await else {
        return;
    };

    let (status, body) = json_request(
        &app,
        "POST",
        "/api/v1/auth/refresh",
        None,
        Some(json!({ "refresh_token": "00".repeat(48) })),
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(body["error"], "invalid_token");
}

#[tokio::test]
async fn refresh_validation_rejects_empty_token() {
    let Some((app, _pool)) = test_context().await else {
        return;
    };

    let (status, body) = json_request(
        &app,
        "POST",
        "/api/v1/auth/refresh",
        None,
        Some(json!({ "refresh_token": "" })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(body["error"], "validation_error");
}

#[tokio::test]
async fn mfa_pending_login_admin_approve_yields_tokens_via_check_pending() {
    let Some((app, pool)) = test_context().await else {
        return;
    };

    let tag = Uuid::new_v4().simple();
    let email = format!("auth-mfa-ok-{tag}@example.com");
    let _ = seed_user_with_password_and_flags(
        &pool,
        &email,
        "patient_manager",
        "mfa-user-pass",
        true,
        true,
        None,
    )
    .await;

    let (status, login_body) = json_request(
        &app,
        "POST",
        "/api/v1/auth/login",
        None,
        Some(json!({ "email": email, "password": "mfa-user-pass" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(login_body["status"], "mfa_pending");
    let pending_id = login_body["pending_id"].as_str().expect("pending_id");

    let (status, check1) = json_request(
        &app,
        "GET",
        &format!("/api/v1/auth/pending/{pending_id}"),
        None,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(check1["status"], "pending");

    let admin_id: Uuid = sqlx::query_scalar("SELECT id FROM users WHERE email = $1")
        .bind("admin@gmed.de")
        .fetch_one(&pool)
        .await
        .expect("seeded admin");
    let admin_bearer = ceo_admin_bearer(admin_id);
    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/admin/mfa/pending/{pending_id}/approve"),
        Some(&admin_bearer),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (status, check2) = json_request(
        &app,
        "GET",
        &format!("/api/v1/auth/pending/{pending_id}"),
        None,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(check2["status"], "approved");
    let access = check2["access_token"]
        .as_str()
        .expect("access after approve");
    let auth = bearer(access);
    let (status, sessions) =
        json_request(&app, "GET", "/api/v1/auth/sessions", Some(&auth), None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(sessions.as_array().map_or(0, |a| a.len()), 1);
}

#[tokio::test]
async fn mfa_pending_login_admin_reject_surfaces_on_check_pending() {
    let Some((app, pool)) = test_context().await else {
        return;
    };

    let tag = Uuid::new_v4().simple();
    let email = format!("auth-mfa-reject-{tag}@example.com");
    let _ = seed_user_with_password_and_flags(
        &pool,
        &email,
        "concierge",
        "mfa-reject-pass",
        true,
        true,
        None,
    )
    .await;

    let (status, login_body) = json_request(
        &app,
        "POST",
        "/api/v1/auth/login",
        None,
        Some(json!({ "email": email, "password": "mfa-reject-pass" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(login_body["status"], "mfa_pending");
    let pending_id = login_body["pending_id"].as_str().expect("pending_id");

    let admin_id: Uuid = sqlx::query_scalar("SELECT id FROM users WHERE email = $1")
        .bind("admin@gmed.de")
        .fetch_one(&pool)
        .await
        .expect("seeded admin");
    let admin_bearer = ceo_admin_bearer(admin_id);
    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/admin/mfa/pending/{pending_id}/reject"),
        Some(&admin_bearer),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (status, check) = json_request(
        &app,
        "GET",
        &format!("/api/v1/auth/pending/{pending_id}"),
        None,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(check["status"], "rejected");
}
