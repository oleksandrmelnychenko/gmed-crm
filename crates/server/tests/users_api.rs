mod support;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use serde_json::{Value, json};
use sqlx::PgPool;
use tower::ServiceExt;
use uuid::Uuid;

use gmed_server::auth::jwt;

const TEST_SECRET: &str = "test-secret-at-least-32-characters-long!!";

async fn test_context() -> Option<(axum::Router, PgPool, Uuid)> {
    let ctx = support::suite_context(TEST_SECRET).await?;
    Some((ctx.app, ctx.pool, ctx.admin_id))
}

fn auth_header_for(user_id: Uuid, role: &str) -> String {
    let token = jwt::issue_access_token(TEST_SECRET, user_id, role, Uuid::new_v4()).unwrap();
    format!("Bearer {token}")
}

async fn json_request(
    app: &axum::Router,
    method: &str,
    path: &str,
    bearer: &str,
    body: Value,
) -> (StatusCode, Value) {
    let request = Request::builder()
        .method(method)
        .uri(path)
        .header("Authorization", bearer)
        .header("Content-Type", "application/json")
        .body(Body::from(serde_json::to_vec(&body).unwrap()))
        .unwrap();

    let response = app.clone().oneshot(request).await.unwrap();
    let status = response.status();
    let bytes = axum::body::to_bytes(response.into_body(), 1024 * 1024)
        .await
        .unwrap();
    let payload: Value = serde_json::from_slice(&bytes).unwrap_or(json!(null));
    (status, payload)
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

#[tokio::test]
async fn create_user_rejects_password_without_required_character_classes() {
    let Some((app, _pool, admin_id)) = test_context().await else {
        return;
    };
    let bearer = auth_header_for(admin_id, "ceo");

    let (status, body) = json_request(
        &app,
        "POST",
        "/api/v1/users",
        &bearer,
        json!({
            "email": format!("weak-{}@example.com", Uuid::new_v4().simple()),
            "name": "Weak Password User",
            "password": "12345678",
            "role": "patient_manager"
        }),
    )
    .await;

    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(
        body["message"],
        "Password must contain uppercase and lowercase letters, a number, and a symbol"
    );
}

#[tokio::test]
async fn create_user_accepts_password_matching_policy() {
    let Some((app, _pool, admin_id)) = test_context().await else {
        return;
    };
    let bearer = auth_header_for(admin_id, "ceo");

    let (status, body) = json_request(
        &app,
        "POST",
        "/api/v1/users",
        &bearer,
        json!({
            "email": format!("strong-{}@example.com", Uuid::new_v4().simple()),
            "name": "Strong Password User",
            "password": "Password1!",
            "role": "patient_manager"
        }),
    )
    .await;

    assert_eq!(status, StatusCode::CREATED, "{body}");
}

#[tokio::test]
async fn external_interpreter_profiles_are_hidden_from_users_and_roles() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };
    let bearer = auth_header_for(admin_id, "ceo");
    let target_id = seed_user(&pool, "users-api-external-interpreter", "interpreter").await;

    sqlx::query(
        r#"INSERT INTO interpreter_profile_details (user_id, status, employment_kind)
           VALUES ($1, 'active', 'external')
           ON CONFLICT (user_id)
           DO UPDATE SET employment_kind = EXCLUDED.employment_kind"#,
    )
    .bind(target_id)
    .execute(&pool)
    .await
    .unwrap();

    let email: String = sqlx::query_scalar("SELECT email FROM users WHERE id = $1")
        .bind(target_id)
        .fetch_one(&pool)
        .await
        .unwrap();

    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/users?search={email}"),
        &bearer,
        json!(null),
    )
    .await;

    assert_eq!(status, StatusCode::OK, "{body}");
    assert!(
        !body
            .as_array()
            .expect("users array")
            .iter()
            .any(|row| row["id"] == target_id.to_string()),
        "external interpreter profile must not appear in Users & Roles: {body}"
    );
}

#[tokio::test]
async fn create_user_rejects_external_standalone_staff_email() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };
    let bearer = auth_header_for(admin_id, "ceo");
    let email = format!("external-{}@example.com", Uuid::new_v4().simple());

    sqlx::query(
        r#"INSERT INTO interpreter_standalone_profiles (name, email, profile)
           VALUES ($1, $2, '{"employmentKind":"external"}'::jsonb)"#,
    )
    .bind("External Interpreter")
    .bind(&email)
    .execute(&pool)
    .await
    .unwrap();

    let (status, body) = json_request(
        &app,
        "POST",
        "/api/v1/users",
        &bearer,
        json!({
            "email": email,
            "name": "External Interpreter",
            "password": "Password1!",
            "role": "interpreter"
        }),
    )
    .await;

    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(
        body["message"],
        "External contractors cannot be created as user accounts"
    );
}

#[tokio::test]
async fn changing_user_role_revokes_profile_and_direct_resource_access() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };
    let bearer = auth_header_for(admin_id, "ceo");
    let target_id = seed_user(&pool, "users-api-role-access-reset", "concierge").await;
    let profile_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO staff_access_profiles (name, created_by)
           VALUES ($1, $2)
           RETURNING id"#,
    )
    .bind(format!("Role reset profile {}", Uuid::new_v4().simple()))
    .bind(admin_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO staff_access_profile_roles (profile_id, role) VALUES ($1, 'concierge')",
    )
    .bind(profile_id)
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        r#"INSERT INTO staff_access_profile_assignments (
                user_id, profile_id, assigned_for_role, assigned_by
           ) VALUES ($1, $2, 'concierge', $3)"#,
    )
    .bind(target_id)
    .bind(profile_id)
    .bind(admin_id)
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        r#"INSERT INTO staff_user_access_rules (
                user_id, granted_for_role, resource_type, scope_type,
                resource_id, capability, effect, granted_by
           ) VALUES ($1, 'concierge', 'provider', 'record', $2, 'view', 'allow', $3)"#,
    )
    .bind(target_id)
    .bind(Uuid::new_v4())
    .bind(admin_id)
    .execute(&pool)
    .await
    .unwrap();

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/users/{target_id}/update"),
        &bearer,
        json!({ "role": "billing" }),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["role"], "billing");

    let (role, access_revision): (String, i64) =
        sqlx::query_as("SELECT role, access_revision FROM users WHERE id = $1")
            .bind(target_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(role, "billing");
    assert_eq!(access_revision, 1);

    let active_profile_assignments: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM staff_access_profile_assignments WHERE user_id = $1 AND revoked_at IS NULL",
    )
    .bind(target_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    let active_direct_rules: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM staff_user_access_rules WHERE user_id = $1 AND revoked_at IS NULL",
    )
    .bind(target_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(active_profile_assignments, 0);
    assert_eq!(active_direct_rules, 0);

    support::wait_until("role-change access revocation audit", || {
        let pool = pool.clone();
        async move {
            sqlx::query_scalar::<_, i64>(
                r#"SELECT count(*)
                   FROM audit_log
                   WHERE action = 'revoke_user_resource_access_on_role_change'
                     AND entity_type = 'user'
                     AND entity_id = $1"#,
            )
            .bind(target_id)
            .fetch_one(&pool)
            .await
            .is_ok_and(|count| count == 1)
        }
    })
    .await;
}

#[tokio::test]
async fn reset_password_rejects_password_without_required_character_classes() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };
    let bearer = auth_header_for(admin_id, "ceo");
    let target_id = seed_user(&pool, "users-api-reset", "patient_manager").await;

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/users/{target_id}/reset-password"),
        &bearer,
        json!({ "new_password": "password1!" }),
    )
    .await;

    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(
        body["message"],
        "Password must contain uppercase and lowercase letters, a number, and a symbol"
    );
}

#[tokio::test]
async fn reset_password_accepts_password_matching_policy() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };
    let bearer = auth_header_for(admin_id, "ceo");
    let target_id = seed_user(&pool, "users-api-reset-valid", "patient_manager").await;
    sqlx::query(
        r#"UPDATE users
           SET failed_login_attempts = 5,
               locked_until = now() + interval '30 minutes',
               password_changed_at = '2000-01-01'::timestamptz
           WHERE id = $1"#,
    )
    .bind(target_id)
    .execute(&pool)
    .await
    .unwrap();

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/users/{target_id}/reset-password"),
        &bearer,
        json!({ "new_password": "Password1!" }),
    )
    .await;

    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["password_reset_required"], true);
    assert!(
        body.get("one_time_password").is_none(),
        "a supplied password is never echoed back: {body}"
    );

    let row: (
        String,
        i32,
        Option<chrono::DateTime<chrono::Utc>>,
        chrono::DateTime<chrono::Utc>,
        i64,
        bool,
    ) = sqlx::query_as(
        r#"SELECT password_hash,
                      failed_login_attempts,
                      locked_until,
                      password_changed_at,
                      jsonb_array_length(password_history)::bigint,
                      password_reset_required
               FROM users
               WHERE id = $1"#,
    )
    .bind(target_id)
    .fetch_one(&pool)
    .await
    .unwrap();

    assert!(gmed_server::auth::password::verify_password("Password1!", &row.0).unwrap());
    assert_eq!(row.1, 0);
    assert!(row.2.is_none(), "password reset must remove the login lock");
    assert!(row.3 > chrono::Utc::now() - chrono::Duration::minutes(1));
    assert_eq!(
        row.4, 1,
        "the previous hash must be retained in password history"
    );
    assert!(
        row.5,
        "an administrator reset hands over a temporary password: change at next login"
    );
}

async fn login(app: &axum::Router, email: &str, password: &str) -> (StatusCode, Value) {
    let request = Request::builder()
        .method("POST")
        .uri("/api/v1/auth/login")
        .header("Content-Type", "application/json")
        .body(Body::from(
            serde_json::to_vec(&json!({ "email": email, "password": password })).unwrap(),
        ))
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

#[tokio::test]
async fn it_admin_onboards_a_user_with_a_one_time_password_that_must_be_changed() {
    let Some((app, pool, _admin_id)) = test_context().await else {
        return;
    };
    let it_admin_id = seed_user(&pool, "users-api-onboarding", "it_admin").await;
    let bearer = auth_header_for(it_admin_id, "it_admin");
    let email = format!("onboarded-{}@example.com", Uuid::new_v4().simple());

    // No password in the request: the server generates one and returns it once.
    let (status, created) = json_request(
        &app,
        "POST",
        "/api/v1/users",
        &bearer,
        json!({
            "email": email,
            "name": "Onboarded Manager",
            "role": "patient_manager"
        }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{created}");
    assert_eq!(created["password_reset_required"], true);
    assert_eq!(created["totp_enrolled"], false);
    assert_eq!(created["active_sessions"], 0);
    assert!(created["last_login_at"].is_null());
    let one_time_password = created["one_time_password"]
        .as_str()
        .expect("one-time password returned once")
        .to_string();
    assert_eq!(one_time_password.len(), 16);
    gmed_server::auth::password_policy::validate_password_policy(&one_time_password)
        .expect("generated password satisfies the policy");
    let created_id: Uuid = created["id"].as_str().unwrap().parse().unwrap();

    // The secret never reaches the audit trail; the event only records that
    // a one-time password was issued.
    support::wait_until("create_user audit event", || {
        let pool = pool.clone();
        async move {
            sqlx::query_scalar::<_, i64>(
                "SELECT count(*) FROM audit_log WHERE action = 'create_user' AND entity_id = $1",
            )
            .bind(created_id)
            .fetch_one(&pool)
            .await
            .is_ok_and(|count| count == 1)
        }
    })
    .await;
    let context: serde_json::Value = sqlx::query_scalar(
        "SELECT context FROM audit_log WHERE action = 'create_user' AND entity_id = $1",
    )
    .bind(created_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(context["one_time_password"], true, "{context}");
    assert!(
        !context.to_string().contains(&one_time_password),
        "audit context must not carry the secret: {context}"
    );

    // The list endpoint does not repeat the secret either.
    let (status, listed) = json_request(
        &app,
        "GET",
        &format!("/api/v1/users?search={email}"),
        &bearer,
        json!(null),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{listed}");
    let row = listed
        .as_array()
        .unwrap()
        .iter()
        .find(|row| row["id"] == created_id.to_string())
        .expect("created user listed");
    assert!(row.get("one_time_password").is_none(), "{row}");
    assert_eq!(row["password_reset_required"], true);

    // First login with the one-time password works and demands a change
    // (Stage 1's forced password change screen takes over).
    let (status, session) = login(&app, &email, &one_time_password).await;
    assert_eq!(status, StatusCode::OK, "{session}");
    assert_eq!(session["password_change_required"], true);
}

#[tokio::test]
async fn reset_password_with_generate_returns_a_one_time_password_and_forces_change() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };
    let bearer = auth_header_for(admin_id, "ceo");
    let target_id = seed_user(&pool, "users-api-reset-generate", "billing").await;
    let email: String = sqlx::query_scalar("SELECT email FROM users WHERE id = $1")
        .bind(target_id)
        .fetch_one(&pool)
        .await
        .unwrap();

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/users/{target_id}/reset-password"),
        &bearer,
        json!({ "generate": true }),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["password_reset_required"], true);
    assert_eq!(body["sessions_revoked"], true);
    let one_time_password = body["one_time_password"]
        .as_str()
        .expect("generated password returned once")
        .to_string();

    let (hash, reset_required): (String, bool) =
        sqlx::query_as("SELECT password_hash, password_reset_required FROM users WHERE id = $1")
            .bind(target_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert!(gmed_server::auth::password::verify_password(&one_time_password, &hash).unwrap());
    assert!(reset_required);

    let (status, session) = login(&app, &email, &one_time_password).await;
    assert_eq!(status, StatusCode::OK, "{session}");
    assert_eq!(session["password_change_required"], true);

    // An empty body behaves like `generate: true`.
    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/users/{target_id}/reset-password"),
        &bearer,
        json!({}),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert!(body["one_time_password"].is_string(), "{body}");
}

#[tokio::test]
async fn users_list_exposes_second_factor_session_and_reset_state() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };
    let bearer = auth_header_for(admin_id, "ceo");
    let target_id = seed_user(&pool, "users-api-summary", "concierge").await;
    let email: String = sqlx::query_scalar("SELECT email FROM users WHERE id = $1")
        .bind(target_id)
        .fetch_one(&pool)
        .await
        .unwrap();

    sqlx::query("UPDATE users SET password_reset_required = true WHERE id = $1")
        .bind(target_id)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query(
        r#"INSERT INTO user_totp (user_id, secret_ciphertext, secret_nonce, secret_key_id, confirmed_at)
           VALUES ($1, '\x00'::bytea, '\x00'::bytea, 'test', now())"#,
    )
    .bind(target_id)
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        r#"INSERT INTO token_families (user_id, is_revoked, created_at)
           VALUES ($1, false, now() - interval '1 hour'),
                  ($1, true, now() - interval '2 days')"#,
    )
    .bind(target_id)
    .execute(&pool)
    .await
    .unwrap();

    let (status, listed) = json_request(
        &app,
        "GET",
        &format!("/api/v1/users?search={email}"),
        &bearer,
        json!(null),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{listed}");
    let row = listed
        .as_array()
        .unwrap()
        .iter()
        .find(|row| row["id"] == target_id.to_string())
        .expect("seeded user listed");
    assert_eq!(row["password_reset_required"], true, "{row}");
    assert_eq!(row["totp_enrolled"], true, "{row}");
    assert_eq!(row["active_sessions"], 1, "{row}");
    assert!(row["last_login_at"].is_string(), "{row}");

    let (status, detail) = json_request(
        &app,
        "GET",
        &format!("/api/v1/users/{target_id}"),
        &bearer,
        json!(null),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{detail}");
    assert_eq!(detail["totp_enrolled"], true);
    assert_eq!(detail["active_sessions"], 1);
}

#[tokio::test]
async fn ceo_can_unlock_user_without_changing_password() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };
    let bearer = auth_header_for(admin_id, "ceo");
    let target_id = seed_user(&pool, "users-api-unlock", "patient_manager").await;
    sqlx::query(
        "UPDATE users SET failed_login_attempts = 5, locked_until = now() + interval '30 minutes' WHERE id = $1",
    )
    .bind(target_id)
    .execute(&pool)
    .await
    .unwrap();

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/users/{target_id}/unlock"),
        &bearer,
        json!(null),
    )
    .await;

    assert_eq!(status, StatusCode::NO_CONTENT, "{body}");
    let state: (i32, Option<chrono::DateTime<chrono::Utc>>) =
        sqlx::query_as("SELECT failed_login_attempts, locked_until FROM users WHERE id = $1")
            .bind(target_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(state.0, 0);
    assert!(state.1.is_none());
}

#[tokio::test]
async fn last_active_ceo_cannot_be_deactivated_or_demoted() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };
    // Each test owns its database, so it is safe to make `admin` the only CEO.
    let second_ceo = seed_user(&pool, "users-api-last-ceo", "ceo").await;
    sqlx::query("UPDATE users SET is_active = false WHERE role = 'ceo' AND id NOT IN ($1, $2)")
        .bind(admin_id)
        .bind(second_ceo)
        .execute(&pool)
        .await
        .unwrap();
    let admin = auth_header_for(admin_id, "ceo");
    let second = auth_header_for(second_ceo, "ceo");

    // Two active CEOs: deactivating one of them is allowed.
    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/users/{second_ceo}/deactivate"),
        &admin,
        json!(null),
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT, "{body}");

    // `admin` is now the only active CEO: demotion is refused and rolled back.
    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/users/{admin_id}/update"),
        &admin,
        json!({ "role": "billing" }),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{body}");
    assert_eq!(body["error"], "last_ceo_protected");
    let role: String = sqlx::query_scalar("SELECT role FROM users WHERE id = $1")
        .bind(admin_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(role, "ceo", "the transaction rolled back");

    // Re-activate the second CEO: with two active CEOs the admin may be
    // deactivated, after which the second CEO is protected in turn.
    sqlx::query("UPDATE users SET is_active = true WHERE id = $1")
        .bind(second_ceo)
        .execute(&pool)
        .await
        .unwrap();
    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/users/{admin_id}/deactivate"),
        &second,
        json!(null),
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT, "{body}");

    let third_ceo = seed_user(&pool, "users-api-third-ceo", "ceo").await;
    sqlx::query("UPDATE users SET is_active = false WHERE id = $1")
        .bind(third_ceo)
        .execute(&pool)
        .await
        .unwrap();
    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/users/{second_ceo}/update"),
        &second,
        json!({ "role": "it_admin" }),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{body}");
    assert_eq!(body["error"], "last_ceo_protected");

    // Renaming without touching the role is still fine for the last CEO.
    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/users/{second_ceo}/update"),
        &second,
        json!({ "name": "Only CEO" }),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["role"], "ceo");
}

#[tokio::test]
async fn it_admin_manages_users_but_never_the_ceo() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };
    let it_admin_id = seed_user(&pool, "users-api-it-admin", "it_admin").await;
    let bearer = auth_header_for(it_admin_id, "it_admin");
    let suffix = Uuid::new_v4().simple().to_string();

    // Listing and reading accounts is part of the technical cabinet.
    let (status, body) = json_request(&app, "GET", "/api/v1/users", &bearer, json!(null)).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/users/{admin_id}"),
        &bearer,
        json!(null),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");

    // Creating a regular staff account works...
    let (status, created) = json_request(
        &app,
        "POST",
        "/api/v1/users",
        &bearer,
        json!({
            "email": format!("it-admin-created-{suffix}@example.com"),
            "name": "Created by IT admin",
            "password": "Str0ng!Passw0rd",
            "role": "concierge"
        }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{created}");
    let created_id = created["id"].as_str().expect("created id").to_string();

    // ...but a CEO account can only be created by the CEO.
    let (status, body) = json_request(
        &app,
        "POST",
        "/api/v1/users",
        &bearer,
        json!({
            "email": format!("it-admin-ceo-{suffix}@example.com"),
            "name": "Would-be CEO",
            "password": "Str0ng!Passw0rd",
            "role": "ceo"
        }),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN, "{body}");

    // Regular accounts may be updated, locked, unlocked and reset.
    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/users/{created_id}/update"),
        &bearer,
        json!({ "name": "Renamed by IT admin" }),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/users/{created_id}/update"),
        &bearer,
        json!({ "role": "ceo" }),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN, "{body}");
    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/users/{created_id}/reset-password"),
        &bearer,
        json!({ "new_password": "An0ther!Passw0rd" }),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["password_reset_required"], true);
    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/users/{created_id}/deactivate"),
        &bearer,
        json!(null),
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT, "{body}");
    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/users/{created_id}/activate"),
        &bearer,
        json!(null),
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT, "{body}");
    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/users/{created_id}/totp/reset"),
        &bearer,
        json!(null),
    )
    .await;
    assert_ne!(status, StatusCode::FORBIDDEN, "{body}");

    // Every operation that targets an existing CEO account is refused.
    for path in [
        format!("/api/v1/users/{admin_id}/update"),
        format!("/api/v1/users/{admin_id}/deactivate"),
        format!("/api/v1/users/{admin_id}/unlock"),
        format!("/api/v1/users/{admin_id}/reset-password"),
        format!("/api/v1/users/{admin_id}/totp/reset"),
    ] {
        let (status, body) = json_request(
            &app,
            "POST",
            &path,
            &bearer,
            json!({ "name": "Tampered", "new_password": "An0ther!Passw0rd" }),
        )
        .await;
        assert_eq!(status, StatusCode::FORBIDDEN, "{path}: {body}");
    }
    let ceo_name: String = sqlx::query_scalar("SELECT name FROM users WHERE id = $1")
        .bind(admin_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_ne!(ceo_name, "Tampered");

    // Other roles never reach user administration.
    let billing_id = seed_user(&pool, "users-api-it-admin", "billing").await;
    let (status, body) = json_request(
        &app,
        "GET",
        "/api/v1/users",
        &auth_header_for(billing_id, "billing"),
        json!(null),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN, "{body}");
}
