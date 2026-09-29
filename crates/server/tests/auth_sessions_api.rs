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
        None,
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
        None,
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
        None,
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
async fn login_validation_rejects_short_password() {
    let Some((app, _pool)) = test_context().await else {
        return;
    };

    let (status, body) = json_request(
        &app,
        "POST",
        "/api/v1/auth/login",
        None,
        Some(json!({ "email": "a@b.co", "password": "short" })),
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
            Some(json!({ "email": email.clone(), "password": "bad-pass" })),
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
        Some(json!({ "email": email.clone(), "password": "bad-pass" })),
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
async fn expired_lock_restarts_the_failed_attempt_count() {
    let Some((app, pool)) = test_context().await else {
        return;
    };

    let tag = Uuid::new_v4().simple();
    let email = format!("auth-lock-expired-{tag}@example.com");
    let user_id = seed_user_with_password_and_flags(
        &pool,
        &email,
        "billing",
        "real-password-only",
        true,
        false,
        Some(Utc::now() - Duration::minutes(1)),
    )
    .await;
    sqlx::query("UPDATE users SET failed_login_attempts = 5 WHERE id = $1")
        .bind(user_id)
        .execute(&pool)
        .await
        .unwrap();

    // The lock ran out: one typo is an ordinary failed attempt, not a new lock.
    let (status, body) = json_request(
        &app,
        "POST",
        "/api/v1/auth/login",
        None,
        Some(json!({ "email": email.clone(), "password": "bad-pass" })),
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED, "{body}");
    let (attempts, locked): (i32, bool) = sqlx::query_as(
        "SELECT failed_login_attempts, locked_until IS NOT NULL FROM users WHERE id = $1",
    )
    .bind(user_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(attempts, 1);
    assert!(!locked);

    let (status, _) = json_request(
        &app,
        "POST",
        "/api/v1/auth/login",
        None,
        Some(json!({ "email": email, "password": "real-password-only" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
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
async fn concurrent_refresh_claims_only_one_child_and_revokes_the_family() {
    let Some((app, pool)) = test_context().await else {
        return;
    };
    let user_id = seed_user(&pool, "auth_sessions_concurrent_refresh", "patient_manager").await;
    let session = tokens::create_session(
        &pool,
        TEST_SECRET,
        user_id,
        "patient_manager",
        None,
        None,
        None,
        None,
        &TokenSettings::default(),
    )
    .await
    .unwrap();
    let refresh = session.refresh_token;
    let left_body = json!({ "refresh_token": refresh.clone() });
    let right_body = json!({ "refresh_token": refresh });

    let (left, right) = tokio::join!(
        json_request(&app, "POST", "/api/v1/auth/refresh", None, Some(left_body)),
        json_request(&app, "POST", "/api/v1/auth/refresh", None, Some(right_body)),
    );
    let responses = [left, right];
    assert_eq!(
        responses
            .iter()
            .filter(|(status, _)| *status == StatusCode::OK)
            .count(),
        1
    );
    assert_eq!(
        responses
            .iter()
            .filter(|(status, body)| {
                *status == StatusCode::UNAUTHORIZED && body["error"] == "token_theft_detected"
            })
            .count(),
        1
    );
    let active_families: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM token_families WHERE user_id = $1 AND NOT is_revoked",
    )
    .bind(user_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(active_families, 0);
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
async fn forced_password_reset_revokes_sessions_and_gates_new_logins_until_password_is_replaced() {
    let Some((app, pool)) = test_context().await else {
        return;
    };
    let tag = Uuid::new_v4().simple();
    let email = format!("auth-force-reset-{tag}@example.com");
    let user_id = seed_user_with_password_and_flags(
        &pool,
        &email,
        "patient_manager",
        "original-password-1!",
        true,
        false,
        None,
    )
    .await;
    let (status, login) = json_request(
        &app,
        "POST",
        "/api/v1/auth/login",
        None,
        Some(json!({ "email": email, "password": "original-password-1!" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let refresh = login["refresh_token"].as_str().unwrap().to_string();
    let access = bearer(login["access_token"].as_str().unwrap());

    let admin_id: Uuid = sqlx::query_scalar("SELECT id FROM users WHERE email = 'admin@gmed.de'")
        .fetch_one(&pool)
        .await
        .unwrap();
    let admin = ceo_admin_bearer(admin_id);
    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/admin/users/{user_id}/force-password-reset"),
        Some(&admin),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (status, refresh_body) = json_request(
        &app,
        "POST",
        "/api/v1/auth/refresh",
        None,
        Some(json!({ "refresh_token": refresh })),
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(refresh_body["error"], "session_revoked");
    let (status, body) =
        json_request(&app, "GET", "/api/v1/auth/sessions", Some(&access), None).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(body["error"], "unauthorized");
    // Sign-in succeeds but the new session is flagged and confined to the
    // password-change endpoints (see `account_api::forced_password_change_*`).
    let (status, gated) = json_request(
        &app,
        "POST",
        "/api/v1/auth/login",
        None,
        Some(json!({ "email": email, "password": "original-password-1!" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{gated}");
    assert_eq!(gated["password_change_required"], true);
    let gated_access = bearer(gated["access_token"].as_str().unwrap());
    let (status, body) =
        json_request(&app, "GET", "/api/v1/patients", Some(&gated_access), None).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(body["error"], "password_change_required");

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/users/{user_id}/reset-password"),
        Some(&admin),
        Some(json!({ "new_password": "Replacement-password-2!" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let (status, body) = json_request(
        &app,
        "POST",
        "/api/v1/auth/login",
        None,
        Some(json!({ "email": email, "password": "Replacement-password-2!" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    // An admin reset always hands over a temporary password: the next login
    // must replace it (Stage 5 onboarding rule).
    assert_eq!(body["password_change_required"], true);
}

#[tokio::test]
async fn legacy_account_without_password_changed_at_can_sign_in() {
    let Some((app, pool)) = test_context().await else {
        return;
    };
    let tag = Uuid::new_v4().simple();
    let email = format!("auth-legacy-password-{tag}@example.com");
    let user_id = seed_user_with_password_and_flags(
        &pool,
        &email,
        "patient_manager",
        "legacy-password-1!",
        true,
        false,
        None,
    )
    .await;
    sqlx::query(
        "UPDATE users
         SET password_changed_at = NULL, password_reset_required = false
         WHERE id = $1",
    )
    .bind(user_id)
    .execute(&pool)
    .await
    .unwrap();

    let (status, body) = json_request(
        &app,
        "POST",
        "/api/v1/auth/login",
        None,
        Some(json!({ "email": email, "password": "legacy-password-1!" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert!(body["access_token"].as_str().is_some());
}

#[tokio::test]
async fn expired_password_starts_a_gated_session() {
    let Some((app, pool)) = test_context().await else {
        return;
    };
    let tag = Uuid::new_v4().simple();
    let email = format!("auth-expired-password-{tag}@example.com");
    let user_id = seed_user_with_password_and_flags(
        &pool,
        &email,
        "patient_manager",
        "expired-password-1!",
        true,
        false,
        None,
    )
    .await;
    sqlx::query("UPDATE users SET password_changed_at = now() - interval '91 days' WHERE id = $1")
        .bind(user_id)
        .execute(&pool)
        .await
        .unwrap();

    let (status, body) = json_request(
        &app,
        "POST",
        "/api/v1/auth/login",
        None,
        Some(json!({ "email": email, "password": "expired-password-1!" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["password_change_required"], true);
    let access = bearer(body["access_token"].as_str().unwrap());
    let (status, body) =
        json_request(&app, "GET", "/api/v1/auth/sessions", Some(&access), None).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let (status, body) = json_request(&app, "GET", "/api/v1/patients", Some(&access), None).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(body["error"], "password_change_required");
}

#[tokio::test]
async fn stale_role_access_token_is_rejected_after_the_database_role_changes() {
    let Some((app, pool)) = test_context().await else {
        return;
    };
    let user_id = seed_user(&pool, "auth-stale-role", "patient_manager").await;
    let session = tokens::create_session(
        &pool,
        TEST_SECRET,
        user_id,
        "patient_manager",
        None,
        None,
        None,
        None,
        &TokenSettings::default(),
    )
    .await
    .unwrap();
    let auth = bearer(&session.access_token);

    let (status, _) = json_request(&app, "GET", "/api/v1/auth/sessions", Some(&auth), None).await;
    assert_eq!(status, StatusCode::OK);

    sqlx::query("UPDATE users SET role = 'sales' WHERE id = $1")
        .bind(user_id)
        .execute(&pool)
        .await
        .unwrap();

    let (status, body) =
        json_request(&app, "GET", "/api/v1/auth/sessions", Some(&auth), None).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(body["error"], "unauthorized");
}

#[tokio::test]
async fn session_creation_rejects_a_password_snapshot_replaced_after_verification() {
    let Some((_app, pool)) = test_context().await else {
        return;
    };
    let user_id = seed_user(&pool, "auth-password-snapshot", "patient_manager").await;
    let observed_password_changed_at: chrono::DateTime<Utc> =
        sqlx::query_scalar("SELECT password_changed_at FROM users WHERE id = $1")
            .bind(user_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    sqlx::query("UPDATE users SET password_changed_at = $2 + interval '1 second' WHERE id = $1")
        .bind(user_id)
        .bind(observed_password_changed_at)
        .execute(&pool)
        .await
        .unwrap();

    let result = tokens::create_session(
        &pool,
        TEST_SECRET,
        user_id,
        "patient_manager",
        Some(observed_password_changed_at),
        None,
        None,
        None,
        &TokenSettings::default(),
    )
    .await;
    assert!(matches!(result, Err(tokens::TokenError::FamilyRevoked)));

    let family_count: i64 =
        sqlx::query_scalar("SELECT count(*) FROM token_families WHERE user_id = $1")
            .bind(user_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(family_count, 0);
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

    let (status, replay) = json_request(
        &app,
        "GET",
        &format!("/api/v1/auth/pending/{pending_id}"),
        None,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(replay["status"], "rejected");
    assert!(replay.get("access_token").is_none());

    let family_count: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM token_families tf
         JOIN pending_logins pl ON pl.user_id = tf.user_id
         WHERE pl.id = $1",
    )
    .bind(Uuid::parse_str(pending_id).unwrap())
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(family_count, 1);
}

#[tokio::test]
async fn expired_mfa_pending_login_cannot_be_approved_or_redeemed() {
    let Some((app, pool)) = test_context().await else {
        return;
    };
    let tag = Uuid::new_v4().simple();
    let email = format!("auth-mfa-expired-{tag}@example.com");
    seed_user_with_password_and_flags(
        &pool,
        &email,
        "patient_manager",
        "mfa-expired-pass",
        true,
        true,
        None,
    )
    .await;
    let (_, login_body) = json_request(
        &app,
        "POST",
        "/api/v1/auth/login",
        None,
        Some(json!({ "email": email, "password": "mfa-expired-pass" })),
    )
    .await;
    let pending_id = Uuid::parse_str(login_body["pending_id"].as_str().unwrap()).unwrap();
    sqlx::query("UPDATE pending_logins SET expires_at = now() - interval '1 second' WHERE id = $1")
        .bind(pending_id)
        .execute(&pool)
        .await
        .unwrap();

    let admin_id: Uuid = sqlx::query_scalar("SELECT id FROM users WHERE email = 'admin@gmed.de'")
        .fetch_one(&pool)
        .await
        .unwrap();
    let (approve_status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/admin/mfa/pending/{pending_id}/approve"),
        Some(&ceo_admin_bearer(admin_id)),
        None,
    )
    .await;
    assert_eq!(approve_status, StatusCode::NOT_FOUND);
    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/auth/pending/{pending_id}"),
        None,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["status"], "rejected");
}

#[tokio::test]
async fn password_replacement_invalidates_an_approved_mfa_pending_login() {
    let Some((app, pool)) = test_context().await else {
        return;
    };
    let tag = Uuid::new_v4().simple();
    let email = format!("auth-mfa-password-replaced-{tag}@example.com");
    let user_id = seed_user_with_password_and_flags(
        &pool,
        &email,
        "patient_manager",
        "mfa-old-password-1!",
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
        Some(json!({ "email": email, "password": "mfa-old-password-1!" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let pending_id = Uuid::parse_str(login_body["pending_id"].as_str().unwrap()).unwrap();

    let admin_id: Uuid = sqlx::query_scalar("SELECT id FROM users WHERE email = 'admin@gmed.de'")
        .fetch_one(&pool)
        .await
        .unwrap();
    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/admin/mfa/pending/{pending_id}/approve"),
        Some(&ceo_admin_bearer(admin_id)),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let replacement_hash =
        password::hash_password("mfa-replacement-password-2!").expect("replacement hash");
    sqlx::query(
        "UPDATE users u
         SET password_hash = $2, password_changed_at = pl.created_at + interval '1 second'
         FROM pending_logins pl
         WHERE u.id = $1 AND pl.id = $3",
    )
    .bind(user_id)
    .bind(replacement_hash)
    .bind(pending_id)
    .execute(&pool)
    .await
    .unwrap();

    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/auth/pending/{pending_id}"),
        None,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["status"], "rejected");
    assert!(body.get("access_token").is_none());

    let family_count: i64 =
        sqlx::query_scalar("SELECT count(*) FROM token_families WHERE user_id = $1")
            .bind(user_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(family_count, 0);
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

#[tokio::test]
async fn totp_enrolment_adds_a_second_step_to_login_and_refuses_replayed_codes() {
    let Some((app, pool)) = test_context().await else {
        return;
    };
    let email = format!("totp-{}@example.com", Uuid::new_v4().simple());
    let user_id = seed_user_with_password_and_flags(
        &pool,
        &email,
        "patient_manager",
        "Str0ng!Passw0rd",
        true,
        false,
        None,
    )
    .await;
    // A token for the seeded user in their own role.
    let staff = format!(
        "Bearer {}",
        jwt::issue_access_token(TEST_SECRET, user_id, "patient_manager", Uuid::new_v4())
            .expect("issue jwt")
    );

    let (status, body) = json_request(&app, "GET", "/api/v1/me/totp", Some(&staff), None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["enrolled"], false);
    assert_eq!(
        body["required"], true,
        "patient managers must enrol by default"
    );

    let (status, setup) =
        json_request(&app, "POST", "/api/v1/me/totp/setup", Some(&staff), None).await;
    assert_eq!(status, StatusCode::OK, "{setup}");
    let secret_b32 = setup["secret"].as_str().expect("secret").to_string();
    assert!(
        setup["otpauth_uri"]
            .as_str()
            .unwrap()
            .starts_with("otpauth://totp/")
    );
    let secret = base32_decode(&secret_b32);

    // Not confirmed yet: the login is still password-only.
    let (status, _) = json_request(
        &app,
        "POST",
        "/api/v1/auth/login",
        None,
        Some(json!({ "email": email, "password": "Str0ng!Passw0rd" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let now = u64::try_from(Utc::now().timestamp()).unwrap();
    let code = |offset_steps: u64| {
        format!(
            "{:06}",
            gmed_server::auth::totp::code_at_step(
                &secret,
                gmed_server::auth::totp::step_for(now) + offset_steps
            )
        )
    };
    let (status, _) = json_request(
        &app,
        "POST",
        "/api/v1/me/totp/confirm",
        Some(&staff),
        Some(json!({ "code": "000000" })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    let (status, _) = json_request(
        &app,
        "POST",
        "/api/v1/me/totp/confirm",
        Some(&staff),
        Some(json!({ "code": code(0) })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    // From now on the password only opens a challenge …
    let (status, body) = json_request(
        &app,
        "POST",
        "/api/v1/auth/login",
        None,
        Some(json!({ "email": email, "password": "Str0ng!Passw0rd" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["status"], "totp_required");
    let challenge_id = body["challenge_id"]
        .as_str()
        .expect("challenge")
        .to_string();

    // … a wrong code is refused, the code used at enrolment cannot be replayed,
    // and the next step's code signs in.
    let (status, _) = json_request(
        &app,
        "POST",
        "/api/v1/auth/totp",
        None,
        Some(json!({ "challenge_id": challenge_id, "code": "000000" })),
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    let (status, _) = json_request(
        &app,
        "POST",
        "/api/v1/auth/totp",
        None,
        Some(json!({ "challenge_id": challenge_id, "code": code(0) })),
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED, "enrolment code replayed");
    let (status, tokens) = json_request(
        &app,
        "POST",
        "/api/v1/auth/totp",
        None,
        Some(json!({ "challenge_id": challenge_id, "code": code(1) })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{tokens}");
    assert!(tokens["access_token"].is_string());

    // The challenge is single use.
    let (status, _) = json_request(
        &app,
        "POST",
        "/api/v1/auth/totp",
        None,
        Some(json!({ "challenge_id": challenge_id, "code": code(1) })),
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

fn base32_decode(value: &str) -> Vec<u8> {
    const ALPHABET: &[u8; 32] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    let mut out = Vec::new();
    let mut buffer: u64 = 0;
    let mut bits = 0u32;
    for ch in value.bytes() {
        let index = ALPHABET.iter().position(|c| *c == ch).expect("base32 char") as u64;
        buffer = (buffer << 5) | index;
        bits += 5;
        if bits >= 8 {
            bits -= 8;
            out.push(((buffer >> bits) & 0xff) as u8);
        }
    }
    out
}

async fn seeded_admin_bearer(pool: &PgPool) -> String {
    let admin_id: Uuid = sqlx::query_scalar("SELECT id FROM users WHERE email = $1")
        .bind("admin@gmed.de")
        .fetch_one(pool)
        .await
        .expect("seeded admin");
    ceo_admin_bearer(admin_id)
}

/// Owner decision 2026-09-28 (Q12): an account with admin approval and a
/// forced password change used to be refused on approval forever. Approval
/// now starts a session confined to the password change.
#[tokio::test]
async fn admin_approval_with_a_forced_password_change_starts_a_confined_session() {
    let Some((app, pool)) = test_context().await else {
        return;
    };
    let email = format!("mfa-reset-{}@example.com", Uuid::new_v4().simple());
    let user_id = seed_user_with_password_and_flags(
        &pool,
        &email,
        "billing",
        "Str0ng!Passw0rd",
        true,
        true,
        None,
    )
    .await;
    sqlx::query("UPDATE users SET password_reset_required = true WHERE id = $1")
        .bind(user_id)
        .execute(&pool)
        .await
        .unwrap();

    let (status, login_body) = json_request(
        &app,
        "POST",
        "/api/v1/auth/login",
        None,
        Some(json!({ "email": email, "password": "Str0ng!Passw0rd" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{login_body}");
    assert_eq!(login_body["status"], "mfa_pending");
    let pending_id = login_body["pending_id"].as_str().unwrap().to_string();

    let admin = seeded_admin_bearer(&pool).await;
    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/admin/mfa/pending/{pending_id}/approve"),
        Some(&admin),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");

    let (status, redeemed) = json_request(
        &app,
        "GET",
        &format!("/api/v1/auth/pending/{pending_id}"),
        None,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{redeemed}");
    assert_eq!(redeemed["status"], "approved");
    assert_eq!(redeemed["password_change_required"], true);
    let session = bearer(redeemed["access_token"].as_str().unwrap());

    // Confined to the password change until it is replaced.
    let (status, me) = json_request(&app, "GET", "/api/v1/me", Some(&session), None).await;
    assert_eq!(status, StatusCode::OK, "{me}");
    let (status, blocked) =
        json_request(&app, "GET", "/api/v1/patients", Some(&session), None).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(blocked["error"], "password_change_required");
}

/// Owner decision 2026-09-28 (Q12): the login e-mail matches regardless of
/// case and surrounding blanks.
#[tokio::test]
async fn login_matches_the_email_case_insensitively() {
    let Some((app, pool)) = test_context().await else {
        return;
    };
    let tag = Uuid::new_v4().simple();
    let stored = format!("Mixed.Case-{tag}@Example.com");
    seed_user_with_password_and_flags(
        &pool,
        &stored,
        "billing",
        "Str0ng!Passw0rd",
        true,
        false,
        None,
    )
    .await;

    for typed in [
        stored.to_lowercase(),
        stored.to_uppercase(),
        format!("  {stored} "),
    ] {
        let (status, body) = json_request(
            &app,
            "POST",
            "/api/v1/auth/login",
            None,
            Some(json!({ "email": typed, "password": "Str0ng!Passw0rd" })),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{typed}: {body}");
        assert!(body["access_token"].is_string(), "{typed}: {body}");
    }

    // A second account differing only in case cannot be created.
    let admin = seeded_admin_bearer(&pool).await;
    let (status, body) = json_request(
        &app,
        "POST",
        "/api/v1/users",
        Some(&admin),
        Some(json!({
            "email": stored.to_uppercase(),
            "name": "Duplicate",
            "role": "billing"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{body}");
}

async fn login_tokens(app: &axum::Router, email: &str, password: &str) -> Value {
    let (status, body) = json_request(
        app,
        "POST",
        "/api/v1/auth/login",
        None,
        Some(json!({ "email": email, "password": password })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    body
}

async fn family_state(pool: &PgPool, access_token: &str) -> (Uuid, bool, Option<String>) {
    let family_id = jwt::verify_access_token(TEST_SECRET, access_token)
        .expect("claims")
        .claims
        .fam;
    let row: (bool, Option<String>) =
        sqlx::query_as("SELECT is_revoked, revoked_reason FROM token_families WHERE id = $1")
            .bind(family_id)
            .fetch_one(pool)
            .await
            .unwrap();
    (family_id, row.0, row.1)
}

/// Owner decision 2026-09-28 (Q12): `session_idle_days` ends a session that
/// was not refreshed for that long.
#[tokio::test]
async fn an_idle_session_cannot_be_refreshed() {
    let Some((app, pool)) = test_context().await else {
        return;
    };
    let email = format!("idle-{}@example.com", Uuid::new_v4().simple());
    seed_user_with_password_and_flags(
        &pool,
        &email,
        "billing",
        "Str0ng!Passw0rd",
        true,
        false,
        None,
    )
    .await;
    let tokens_body = login_tokens(&app, &email, "Str0ng!Passw0rd").await;
    let access = tokens_body["access_token"].as_str().unwrap();
    let (family_id, _, _) = family_state(&pool, access).await;
    let idle_days = TokenSettings::default().session_idle_days;
    sqlx::query(
        "UPDATE token_families SET last_activity_at = now() - ($2::bigint * interval '1 day') - interval '1 hour'
         WHERE id = $1",
    )
    .bind(family_id)
    .bind(idle_days)
    .execute(&pool)
    .await
    .unwrap();

    let (status, _) = json_request(
        &app,
        "POST",
        "/api/v1/auth/refresh",
        None,
        Some(json!({ "refresh_token": tokens_body["refresh_token"] })),
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    let (_, revoked, reason) = family_state(&pool, access).await;
    assert!(revoked);
    assert_eq!(reason.as_deref(), Some("idle_timeout"));
    // Its access token is refused as well.
    let (status, _) = json_request(&app, "GET", "/api/v1/me", Some(&bearer(access)), None).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

/// Owner decision 2026-09-28 (Q12): `max_sessions_per_user` is enforced by
/// ending the least recently used session.
#[tokio::test]
async fn a_new_session_over_the_limit_ends_the_least_recent_one() {
    let Some((app, pool)) = test_context().await else {
        return;
    };
    let tag = Uuid::new_v4().simple();
    let user_id = seed_user(&pool, &format!("limit-{tag}"), "billing").await;
    let settings = TokenSettings {
        max_sessions_per_user: 2,
        ..TokenSettings::default()
    };
    let mut families = Vec::new();
    for _ in 0..3 {
        let pair = tokens::create_session(
            &pool,
            TEST_SECRET,
            user_id,
            "billing",
            None,
            None,
            Some("127.0.0.1"),
            Some("test-agent"),
            &settings,
        )
        .await
        .expect("session");
        let (family_id, _, _) = family_state(&pool, &pair.access_token).await;
        // Make the order of activity explicit.
        sqlx::query(
            "UPDATE token_families SET last_activity_at = now() - ($2::int * interval '1 minute') WHERE id = $1",
        )
        .bind(family_id)
        .bind(10 - families.len() as i32)
        .execute(&pool)
        .await
        .unwrap();
        families.push((family_id, pair.access_token));
    }

    let (_, oldest_revoked, reason) = family_state(&pool, &families[0].1).await;
    assert!(oldest_revoked);
    assert_eq!(reason.as_deref(), Some("session_limit"));
    for (_, access) in &families[1..] {
        let (_, revoked, _) = family_state(&pool, access).await;
        assert!(!revoked);
    }
    let (status, _) = json_request(
        &app,
        "GET",
        "/api/v1/me",
        Some(&bearer(&families[0].1)),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    let (status, _) = json_request(
        &app,
        "GET",
        "/api/v1/me",
        Some(&bearer(&families[2].1)),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
}

/// Owner decision 2026-09-28 (Q12): the session sweeper revokes idle and
/// expired sessions, so active-session counts stay right.
#[tokio::test]
async fn the_session_sweeper_revokes_idle_and_expired_sessions() {
    let Some((_app, pool)) = test_context().await else {
        return;
    };
    let tag = Uuid::new_v4().simple();
    let user_id = seed_user(&pool, &format!("sweep-{tag}"), "billing").await;
    let settings = TokenSettings::default();
    let mut families = Vec::new();
    for _ in 0..3 {
        let pair = tokens::create_session(
            &pool,
            TEST_SECRET,
            user_id,
            "billing",
            None,
            None,
            None,
            None,
            &settings,
        )
        .await
        .expect("session");
        families.push(family_state(&pool, &pair.access_token).await.0);
    }
    let (idle, expired, live) = (families[0], families[1], families[2]);
    sqlx::query(
        "UPDATE token_families SET last_activity_at = now() - ($2::bigint * interval '1 day') - interval '1 hour'
         WHERE id = $1",
    )
    .bind(idle)
    .bind(settings.session_idle_days)
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        "UPDATE refresh_tokens SET expires_at = now() - interval '1 minute' WHERE family_id = $1",
    )
    .bind(expired)
    .execute(&pool)
    .await
    .unwrap();

    let (idle_count, expired_count) = tokens::revoke_stale_families(&pool, &settings)
        .await
        .expect("sweep");
    assert!(idle_count >= 1 && expired_count >= 1);

    let reasons: Vec<(Uuid, bool, Option<String>)> = sqlx::query_as(
        "SELECT id, is_revoked, revoked_reason FROM token_families WHERE user_id = $1",
    )
    .bind(user_id)
    .fetch_all(&pool)
    .await
    .unwrap();
    let find = |id: Uuid| reasons.iter().find(|row| row.0 == id).unwrap().clone();
    assert_eq!(find(idle).2.as_deref(), Some("idle_timeout"));
    assert_eq!(find(expired).2.as_deref(), Some("expired"));
    assert!(!find(live).1);
}

/// Owner decision 2026-09-28 (Q12): an enrolled authenticator app does not
/// replace the per-user admin approval (TOM, section "Zweiter Faktor").
#[tokio::test]
async fn admin_approval_still_applies_after_the_authenticator_code() {
    let Some((app, pool)) = test_context().await else {
        return;
    };
    let email = format!("totp-mfa-{}@example.com", Uuid::new_v4().simple());
    let user_id = seed_user_with_password_and_flags(
        &pool,
        &email,
        "patient_manager",
        "Str0ng!Passw0rd",
        true,
        false,
        None,
    )
    .await;
    let staff = format!(
        "Bearer {}",
        jwt::issue_access_token(TEST_SECRET, user_id, "patient_manager", Uuid::new_v4())
            .expect("issue jwt")
    );
    let (status, setup) =
        json_request(&app, "POST", "/api/v1/me/totp/setup", Some(&staff), None).await;
    assert_eq!(status, StatusCode::OK, "{setup}");
    let secret = base32_decode(setup["secret"].as_str().unwrap());
    let now = u64::try_from(Utc::now().timestamp()).unwrap();
    let code = |offset_steps: u64| {
        format!(
            "{:06}",
            gmed_server::auth::totp::code_at_step(
                &secret,
                gmed_server::auth::totp::step_for(now) + offset_steps
            )
        )
    };
    let (status, _) = json_request(
        &app,
        "POST",
        "/api/v1/me/totp/confirm",
        Some(&staff),
        Some(json!({ "code": code(0) })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    sqlx::query("UPDATE users SET mfa_required = true WHERE id = $1")
        .bind(user_id)
        .execute(&pool)
        .await
        .unwrap();

    let body = login_tokens(&app, &email, "Str0ng!Passw0rd").await;
    assert_eq!(body["status"], "totp_required");
    let (status, body) = json_request(
        &app,
        "POST",
        "/api/v1/auth/totp",
        None,
        Some(json!({ "challenge_id": body["challenge_id"], "code": code(1) })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["status"], "mfa_pending", "{body}");
    assert!(body.get("access_token").is_none());
    let pending_id = body["pending_id"].as_str().unwrap().to_string();

    let admin = seeded_admin_bearer(&pool).await;
    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/admin/mfa/pending/{pending_id}/approve"),
        Some(&admin),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let (status, redeemed) = json_request(
        &app,
        "GET",
        &format!("/api/v1/auth/pending/{pending_id}"),
        None,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(redeemed["status"], "approved");
    assert!(redeemed["access_token"].is_string());
}
