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

    assert_eq!(status, StatusCode::NO_CONTENT, "{body}");

    let row: (
        String,
        i32,
        Option<chrono::DateTime<chrono::Utc>>,
        chrono::DateTime<chrono::Utc>,
        i64,
    ) = sqlx::query_as(
        r#"SELECT password_hash,
                      failed_login_attempts,
                      locked_until,
                      password_changed_at,
                      jsonb_array_length(password_history)::bigint
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
