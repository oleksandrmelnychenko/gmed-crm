mod support;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use serde_json::{Value, json};
use sqlx::PgPool;
use tower::ServiceExt;
use uuid::Uuid;

use gmed_server::auth::{jwt, password};

const TEST_SECRET: &str = "test-secret-at-least-32-characters-long!!";

async fn test_context() -> Option<(axum::Router, PgPool, Uuid)> {
    let ctx = support::suite_context(TEST_SECRET).await?;
    Some((ctx.app, ctx.pool, ctx.admin_id))
}

async fn seed_user_with_password(
    pool: &PgPool,
    tag: &str,
    role: &str,
    plain: &str,
) -> (Uuid, String) {
    let email = format!("{tag}-{role}-{}@example.com", Uuid::new_v4().simple());
    let hash = password::hash_password(plain).expect("hash");
    let id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO users (email, password_hash, name, role, password_changed_at)
           VALUES ($1, $2, $3, $4, now())
           RETURNING id"#,
    )
    .bind(&email)
    .bind(&hash)
    .bind(format!("{role} {tag}"))
    .bind(role)
    .fetch_one(pool)
    .await
    .expect("insert user");
    (id, email)
}

fn ceo_bearer(user_id: Uuid) -> String {
    let token = jwt::issue_access_token(TEST_SECRET, user_id, "ceo", Uuid::new_v4()).unwrap();
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
    let response = app
        .clone()
        .oneshot(builder.body(request_body).unwrap())
        .await
        .unwrap();
    let status = response.status();
    let bytes = axum::body::to_bytes(response.into_body(), 1024 * 1024)
        .await
        .unwrap();
    let payload: Value = serde_json::from_slice(&bytes).unwrap_or(json!(null));
    (status, payload)
}

async fn login(app: &axum::Router, email: &str, plain: &str) -> Value {
    let (status, body) = json_request(
        app,
        "POST",
        "/api/v1/auth/login",
        None,
        Some(json!({ "email": email, "password": plain })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    body
}

async fn audit_count(pool: &PgPool, user_id: Uuid, action: &str) -> i64 {
    support::wait_until(&format!("audit action {action}"), || async move {
        let count: i64 =
            sqlx::query_scalar("SELECT count(*) FROM audit_log WHERE user_id = $1 AND action = $2")
                .bind(user_id)
                .bind(action)
                .fetch_one(pool)
                .await
                .unwrap();
        count >= 1
    })
    .await;
    sqlx::query_scalar("SELECT count(*) FROM audit_log WHERE user_id = $1 AND action = $2")
        .bind(user_id)
        .bind(action)
        .fetch_one(pool)
        .await
        .unwrap()
}

#[tokio::test]
async fn own_password_change_checks_current_password_policy_and_history() {
    let Some((app, pool, _admin)) = test_context().await else {
        return;
    };
    let (user_id, email) =
        seed_user_with_password(&pool, "account-password", "billing", "Original-pass-1!").await;

    // Two sessions: the one changing the password survives, the other is revoked.
    let first = login(&app, &email, "Original-pass-1!").await;
    let second = login(&app, &email, "Original-pass-1!").await;
    let current = format!("Bearer {}", first["access_token"].as_str().unwrap());
    let other = format!("Bearer {}", second["access_token"].as_str().unwrap());
    let other_refresh = second["refresh_token"].as_str().unwrap().to_string();

    let (status, body) = json_request(
        &app,
        "PUT",
        "/api/v1/me/password",
        Some(&current),
        Some(json!({ "current_password": "Wrong-pass-1!", "new_password": "Replacement-pass-2!" })),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{body}");
    assert_eq!(body["error"], "invalid_current_password");

    let (status, body) = json_request(
        &app,
        "PUT",
        "/api/v1/me/password",
        Some(&current),
        Some(json!({ "current_password": "Original-pass-1!", "new_password": "weakpassword" })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
    assert_eq!(body["error"], "password_policy");

    let (status, body) = json_request(
        &app,
        "PUT",
        "/api/v1/me/password",
        Some(&current),
        Some(json!({ "current_password": "Original-pass-1!", "new_password": "Original-pass-1!" })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
    assert_eq!(body["error"], "password_policy");
    assert!(body["message"].as_str().unwrap().contains("used recently"));

    let (status, body) = json_request(
        &app,
        "PUT",
        "/api/v1/me/password",
        Some(&current),
        Some(json!({ "current_password": "Original-pass-1!", "new_password": "Replacement-pass-2!" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["other_sessions_revoked"], 1);

    let (status, _) = json_request(&app, "GET", "/api/v1/me", Some(&current), None).await;
    assert_eq!(
        status,
        StatusCode::OK,
        "the changing session stays signed in"
    );
    let (status, _) = json_request(&app, "GET", "/api/v1/me", Some(&other), None).await;
    assert_eq!(
        status,
        StatusCode::UNAUTHORIZED,
        "other sessions are revoked"
    );
    let (status, body) = json_request(
        &app,
        "POST",
        "/api/v1/auth/refresh",
        None,
        Some(json!({ "refresh_token": other_refresh })),
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(body["error"], "session_revoked");

    let revoked_reason: Option<String> = sqlx::query_scalar(
        "SELECT revoked_reason FROM token_families WHERE user_id = $1 AND is_revoked LIMIT 1",
    )
    .bind(user_id)
    .fetch_optional(&pool)
    .await
    .unwrap()
    .flatten();
    assert_eq!(revoked_reason.as_deref(), Some("password_change"));

    login(&app, &email, "Replacement-pass-2!").await;
    assert_eq!(audit_count(&pool, user_id, "change_own_password").await, 1);
    assert_eq!(
        audit_count(&pool, user_id, "change_own_password_rejected").await,
        1
    );
}

#[tokio::test]
async fn forced_password_change_confines_the_session_until_the_password_is_replaced() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };
    let (user_id, email) = seed_user_with_password(
        &pool,
        "account-forced",
        "patient_manager",
        "Original-pass-1!",
    )
    .await;
    let admin = ceo_bearer(admin_id);
    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/admin/users/{user_id}/force-password-reset"),
        Some(&admin),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let session = login(&app, &email, "Original-pass-1!").await;
    assert_eq!(session["password_change_required"], true);
    let bearer = format!("Bearer {}", session["access_token"].as_str().unwrap());

    let (status, me) = json_request(&app, "GET", "/api/v1/me", Some(&bearer), None).await;
    assert_eq!(status, StatusCode::OK, "{me}");
    assert_eq!(me["password_change_required"], true);
    let (status, _) = json_request(&app, "GET", "/api/v1/auth/sessions", Some(&bearer), None).await;
    assert_eq!(status, StatusCode::OK);

    for path in [
        "/api/v1/me/profile",
        "/api/v1/patients",
        "/api/v1/stats/my-kpis",
    ] {
        let (status, body) = json_request(&app, "GET", path, Some(&bearer), None).await;
        assert_eq!(status, StatusCode::FORBIDDEN, "{path}: {body}");
        assert_eq!(body["error"], "password_change_required", "{path}");
    }

    // Refresh keeps working (still gated) so the gate page can outlive the access token.
    let (status, refreshed) = json_request(
        &app,
        "POST",
        "/api/v1/auth/refresh",
        None,
        Some(json!({ "refresh_token": session["refresh_token"] })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{refreshed}");
    assert_eq!(refreshed["password_change_required"], true);

    let (status, body) = json_request(
        &app,
        "PUT",
        "/api/v1/me/password",
        Some(&bearer),
        Some(json!({ "current_password": "Original-pass-1!", "new_password": "Replacement-pass-2!" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");

    let (status, me) = json_request(&app, "GET", "/api/v1/me", Some(&bearer), None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(me["password_change_required"], false);
    let (status, _) = json_request(&app, "GET", "/api/v1/me/profile", Some(&bearer), None).await;
    assert_eq!(status, StatusCode::OK);

    let session = login(&app, &email, "Replacement-pass-2!").await;
    assert_eq!(session["password_change_required"], false);
}

#[tokio::test]
async fn expired_password_is_reported_as_change_required_instead_of_blocking_login() {
    let Some((app, pool, _admin)) = test_context().await else {
        return;
    };
    let (user_id, email) =
        seed_user_with_password(&pool, "account-expired", "concierge", "Expired-pass-1!").await;
    sqlx::query("UPDATE users SET password_changed_at = now() - interval '91 days' WHERE id = $1")
        .bind(user_id)
        .execute(&pool)
        .await
        .unwrap();

    let session = login(&app, &email, "Expired-pass-1!").await;
    assert_eq!(session["password_change_required"], true);
    let bearer = format!("Bearer {}", session["access_token"].as_str().unwrap());
    let (status, body) = json_request(&app, "GET", "/api/v1/patients", Some(&bearer), None).await;
    assert_eq!(status, StatusCode::FORBIDDEN, "{body}");
    assert_eq!(body["error"], "password_change_required");
}

#[tokio::test]
async fn own_profile_is_read_and_updated_and_reflected_in_me() {
    let Some((app, pool, _admin)) = test_context().await else {
        return;
    };
    let (user_id, email) =
        seed_user_with_password(&pool, "account-profile", "patient", "Patient-pass-1!").await;
    let session = login(&app, &email, "Patient-pass-1!").await;
    let bearer = format!("Bearer {}", session["access_token"].as_str().unwrap());

    let (status, profile) =
        json_request(&app, "GET", "/api/v1/me/profile", Some(&bearer), None).await;
    assert_eq!(status, StatusCode::OK, "{profile}");
    assert_eq!(profile["email"], email);
    assert!(profile["phone"].is_null());
    assert!(profile["preferred_language"].is_null());

    let (status, body) = json_request(
        &app,
        "PUT",
        "/api/v1/me/profile",
        Some(&bearer),
        Some(json!({ "name": " Anna Schmidt ", "phone": "+49 30 1234567", "preferred_language": "de" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["name"], "Anna Schmidt");
    assert_eq!(body["phone"], "+49 30 1234567");
    assert_eq!(body["preferred_language"], "de");

    let (status, body) = json_request(
        &app,
        "PUT",
        "/api/v1/me/profile",
        Some(&bearer),
        Some(json!({ "preferred_language": "en" })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
    let (status, body) = json_request(
        &app,
        "PUT",
        "/api/v1/me/profile",
        Some(&bearer),
        Some(json!({ "name": "" })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");

    let (status, me) = json_request(&app, "GET", "/api/v1/me", Some(&bearer), None).await;
    assert_eq!(status, StatusCode::OK, "{me}");
    assert_eq!(me["name"], "Anna Schmidt");
    assert_eq!(me["phone"], "+49 30 1234567");
    assert_eq!(me["preferred_language"], "de");
    assert_eq!(me["password_change_required"], false);

    let (status, body) = json_request(
        &app,
        "PUT",
        "/api/v1/me/profile",
        Some(&bearer),
        Some(json!({ "phone": "", "preferred_language": "" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert!(body["phone"].is_null());
    assert!(body["preferred_language"].is_null());
    assert_eq!(body["name"], "Anna Schmidt");

    assert!(audit_count(&pool, user_id, "update_own_profile").await >= 1);
}

#[tokio::test]
async fn own_sessions_mark_the_current_one() {
    let Some((app, pool, _admin)) = test_context().await else {
        return;
    };
    let (_user_id, email) =
        seed_user_with_password(&pool, "account-sessions", "billing", "Session-pass-1!").await;
    let first = login(&app, &email, "Session-pass-1!").await;
    let _second = login(&app, &email, "Session-pass-1!").await;
    let bearer = format!("Bearer {}", first["access_token"].as_str().unwrap());

    let (status, sessions) =
        json_request(&app, "GET", "/api/v1/auth/sessions", Some(&bearer), None).await;
    assert_eq!(status, StatusCode::OK, "{sessions}");
    let sessions = sessions.as_array().unwrap();
    assert_eq!(sessions.len(), 2);
    assert_eq!(
        sessions.iter().filter(|s| s["is_current"] == true).count(),
        1,
        "{sessions:?}"
    );
}
