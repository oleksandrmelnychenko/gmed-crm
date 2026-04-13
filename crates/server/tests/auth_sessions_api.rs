use axum::body::Body;
use axum::http::{Request, StatusCode};
use serde_json::{Value, json};
use sqlx::PgPool;
use tower::ServiceExt;
use uuid::Uuid;

use gmed_server::auth::{jwt, tokens};
use gmed_server::settings::{SettingsCache, TokenSettings};
use gmed_server::state::AppState;

const TEST_SECRET: &str = "test-secret-at-least-32-characters-long!!";

async fn test_context() -> Option<(axum::Router, PgPool)> {
    let db_url = match std::env::var("DATABASE_URL") {
        Ok(url) => url,
        Err(_) => return None,
    };

    let pool = gmed_db::create_pool(&db_url).await.ok()?;
    gmed_db::run_migrations(&pool).await.ok()?;

    let state = AppState::new(
        pool.clone(),
        TEST_SECRET,
        SettingsCache::new(TokenSettings::default()),
    );

    Some((gmed_server::build_app(state), pool))
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
