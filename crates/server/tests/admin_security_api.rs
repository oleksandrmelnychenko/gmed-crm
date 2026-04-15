mod support;

use axum::body::Body;
use axum::http::{Request, StatusCode};
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

async fn test_context() -> Option<TestContext> {
    let ctx = support::suite_context(TEST_SECRET).await?;
    let it_admin_id = seed_user(&ctx.pool, "admin_security_api", "it_admin").await;
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
async fn audit_analytics_requires_it_admin() {
    let Some(app) = test_context().await else {
        return;
    };
    let pm_id = seed_user(&app.suite.pool, "admin_security_api", "patient_manager").await;

    let (status, _) = json_request(
        &app,
        "GET",
        "/api/v1/admin/audit-analytics",
        &auth_header_for("patient_manager", pm_id),
        None,
    )
    .await;

    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn audit_analytics_surfaces_summary_recent_events_and_top_readers() {
    let Some(app) = test_context().await else {
        return;
    };

    let pool = &app.suite.pool;
    let admin_bearer = auth_header_for("it_admin", app.it_admin_id);
    let ceo_assistant_id = seed_user(pool, "audit-analytics", "ceo_assistant").await;
    let patient_manager_id = seed_user(pool, "audit-analytics", "patient_manager").await;

    let now = chrono::Utc::now();
    let off_hours_today = now
        .date_naive()
        .and_hms_opt(2, 0, 0)
        .expect("valid off-hours time")
        .and_utc();
    let off_hours_time = if off_hours_today < now {
        off_hours_today
    } else {
        off_hours_today - chrono::Duration::days(1)
    };
    let on_hours_today = now
        .date_naive()
        .and_hms_opt(12, 0, 0)
        .expect("valid on-hours time")
        .and_utc();
    let on_hours_time = if on_hours_today < now {
        on_hours_today
    } else {
        on_hours_today - chrono::Duration::days(1)
    };

    sqlx::query(
        r#"INSERT INTO audit_log (user_id, action, entity_type, entity_id, context, ip_address, created_at)
           VALUES
                (NULL, 'login_failure', 'auth', NULL, '{"route":"/api/v1/auth/login","status":401}'::jsonb, 'sha256:ip-1', now() - interval '1 hour'),
                (NULL, 'login_blocked', 'auth', NULL, '{"route":"/api/v1/auth/login","status":403}'::jsonb, 'sha256:ip-1', now() - interval '2 hour'),
                (NULL, 'refresh_token_theft', 'auth', NULL, '{"severity":"critical"}'::jsonb, 'sha256:ip-2', now() - interval '3 hour'),
                ($1, 'view_message_conversation', 'message_conversation', $3, '{"is_ceo_access":true,"route":"/api/v1/messages/{peer}","status":200}'::jsonb, 'sha256:ip-3', $8),
                ($2, 'read_patient', 'patient', $4, '{"route":"/api/v1/patients/{id}","status":200}'::jsonb, 'sha256:ip-4', $5),
                ($2, 'read_document', 'document', $6, '{"route":"/api/v1/documents/{id}","status":200}'::jsonb, 'sha256:ip-4', $7)"#,
    )
    .bind(ceo_assistant_id)
    .bind(patient_manager_id)
    .bind(Uuid::new_v4())
    .bind(Uuid::new_v4())
    .bind(off_hours_time)
    .bind(Uuid::new_v4())
    .bind(on_hours_time)
    .bind(on_hours_time)
    .execute(pool)
    .await
    .unwrap();

    let (status, body) = json_request(
        &app,
        "GET",
        "/api/v1/admin/audit-analytics",
        &admin_bearer,
        None,
    )
    .await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["summary"]["failed_logins_24h"], 1);
    assert_eq!(body["summary"]["blocked_logins_24h"], 1);
    assert_eq!(body["summary"]["token_theft_30d"], 1);
    assert_eq!(body["summary"]["executive_sensitive_access_7d"], 1);
    assert_eq!(body["summary"]["off_hours_sensitive_access_7d"], 1);

    let recent = body["recent_suspicious_events"]
        .as_array()
        .expect("recent suspicious events");
    assert!(
        recent
            .iter()
            .any(|item| item["action"] == "refresh_token_theft")
    );
    assert!(
        recent
            .iter()
            .any(|item| item["reason"] == "Executive access to sensitive communication surface")
    );
    assert!(
        recent
            .iter()
            .any(|item| item["reason"] == "Off-hours sensitive read")
    );

    let top = body["top_sensitive_readers"]
        .as_array()
        .expect("top sensitive readers");
    assert!(!top.is_empty());
    assert!(
        top.iter()
            .any(|item| item["user_id"] == patient_manager_id.to_string()
                && item["event_count"] == 2)
    );
}
