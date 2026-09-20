mod support;

use axum::Extension;
use axum::body::Body;
use axum::extract::ConnectInfo;
use axum::http::{Request, StatusCode};
use secrecy::SecretString;
use serde_json::{Value, json};
use sqlx::PgPool;
use tower::ServiceExt;
use uuid::Uuid;

use gmed_server::auth::jwt;
use gmed_server::config::MedicationAiConfig;
use gmed_server::settings::{SettingsCache, TokenSettings};
use gmed_server::state::AppState;

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
async fn system_health_requires_it_admin() {
    let Some(app) = test_context().await else {
        return;
    };
    let pm_id = seed_user(&app.suite.pool, "system-health", "patient_manager").await;

    let (status, _) = json_request(
        &app,
        "GET",
        "/api/v1/admin/health",
        &auth_header_for("patient_manager", pm_id),
        None,
    )
    .await;

    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn system_health_exposes_only_aggregate_medication_ai_state() {
    let Some(app) = test_context().await else {
        return;
    };
    let secret = "sk-test-health-secret-must-never-leak";
    let model = "gpt-test-health";
    let governance_review_id = "gov-review-test-001";
    let state = AppState::new(
        app.suite.pool.clone(),
        TEST_SECRET,
        SettingsCache::new(TokenSettings::default()),
    )
    .with_medication_ai(MedicationAiConfig {
        enabled: true,
        explicitly_configured: true,
        patient_data_transfer_approved: true,
        governance_review_id: Some(governance_review_id.to_string()),
        openai_api_key: Some(SecretString::from(secret.to_string())),
        openai_model: Some(model.to_string()),
    });
    let configured_app =
        gmed_server::build_app_for_role_contract_tests(state).layer(Extension(ConnectInfo(
            "127.0.0.1:40124"
                .parse::<std::net::SocketAddr>()
                .expect("valid peer address"),
        )));

    let (status, body) = json_request(
        &configured_app,
        "GET",
        "/api/v1/admin/health",
        &auth_header_for("it_admin", app.it_admin_id),
        None,
    )
    .await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["medication_ai"]["provider"]["kind"], "openai");
    assert_eq!(body["medication_ai"]["provider"]["status"], "ready");
    assert_eq!(
        body["medication_ai"]["provider"]["external_calls_enabled"],
        true
    );
    assert_eq!(body["medication_ai"]["provider"]["model"], model);
    assert!(body["medication_ai"]["queue"]["available"].is_boolean());
    assert!(body["medication_ai"]["queue"]["total"].is_number());

    let serialized = serde_json::to_string(&body).expect("serialize health response");
    for forbidden in [
        secret,
        governance_review_id,
        "api_key",
        "authorization",
        "instructions",
        "prompt_version",
        "provider_response_id",
        "provider_response_model",
        "output_json",
        "input_fingerprint",
        "patient_id",
        "review_id",
        "bundle_id",
        "requested_by",
        "medication-evidence-selection-v1",
    ] {
        assert!(
            !serialized.to_ascii_lowercase().contains(forbidden),
            "health response leaked forbidden AI field or value: {forbidden}"
        );
    }
}

#[tokio::test]
async fn release_router_limits_security_analytics_to_technical_admins() {
    let Some(app) = test_context().await else {
        return;
    };
    let assistant_id = seed_user(&app.suite.pool, "release-gate", "ceo_assistant").await;
    let sales_id = seed_user(&app.suite.pool, "release-gate", "sales").await;

    for (role, user_id) in [("ceo_assistant", assistant_id), ("sales", sales_id)] {
        let (status, _) = json_request(
            &app.suite.release_app,
            "GET",
            "/api/v1/admin/audit-analytics",
            &auth_header_for(role, user_id),
            None,
        )
        .await;
        assert_eq!(status, StatusCode::FORBIDDEN, "{role}");
    }

    // The technical admin owns the security cabinet on the production router.
    let (status, body) = json_request(
        &app.suite.release_app,
        "GET",
        "/api/v1/admin/audit-analytics",
        &auth_header_for("it_admin", app.it_admin_id),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");

    // ...but never the patient workspace.
    let (status, _) = json_request(
        &app.suite.release_app,
        "GET",
        "/api/v1/patients",
        &auth_header_for("it_admin", app.it_admin_id),
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

#[tokio::test]
async fn activity_access_category_returns_only_account_and_permission_events() {
    let Some(app) = test_context().await else {
        return;
    };
    let pool = app.suite.pool.clone();
    let actor = app.it_admin_id;
    let target = Uuid::new_v4();
    sqlx::query(
        r#"INSERT INTO audit_log (user_id, action, entity_type, entity_id, context, created_at)
           VALUES
                ($1, 'create_user', 'user', $2, '{"role":"billing","one_time_password":true}'::jsonb, now() - interval '1 minute'),
                ($1, 'update_user', 'user', $2, '{}'::jsonb, now() - interval '2 minute'),
                ($1, 'reset_password', 'user', $2, '{"one_time_password":true}'::jsonb, now() - interval '3 minute'),
                ($1, 'totp_reset', 'user', $2, '{}'::jsonb, now() - interval '4 minute'),
                ($1, 'update_access_policy', 'field_access_policy', $2, '{}'::jsonb, now() - interval '5 minute'),
                ($1, 'login_success', 'auth', NULL, '{}'::jsonb, now() - interval '6 minute'),
                ($1, 'read_patient', 'patient', $2, '{}'::jsonb, now() - interval '7 minute'),
                ($1, 'http_request', 'http', NULL, '{"method":"GET"}'::jsonb, now() - interval '8 minute')"#,
    )
    .bind(actor)
    .bind(target)
    .execute(&pool)
    .await
    .unwrap();
    let bearer = auth_header_for("it_admin", actor);

    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/admin/activity?category=access&user_id={actor}&limit=100"),
        &bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let actions: Vec<&str> = body["items"]
        .as_array()
        .expect("items")
        .iter()
        .filter_map(|item| item["action"].as_str())
        .collect();
    assert_eq!(
        actions,
        [
            "create_user",
            "update_user",
            "reset_password",
            "totp_reset",
            "update_access_policy"
        ],
        "{body}"
    );
    assert_eq!(body["total"], 5);

    // Without the parameter the stream keeps its previous shape: every
    // meaningful action, technical requests excluded.
    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/admin/activity?user_id={actor}&limit=100"),
        &bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let actions: Vec<&str> = body["items"]
        .as_array()
        .expect("items")
        .iter()
        .filter_map(|item| item["action"].as_str())
        .collect();
    assert!(actions.contains(&"login_success"), "{actions:?}");
    assert!(actions.contains(&"read_patient"), "{actions:?}");
    assert!(!actions.contains(&"http_request"), "{actions:?}");

    let (status, body) = json_request(
        &app,
        "GET",
        "/api/v1/admin/activity?category=noise",
        &bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");

    // The stream is limited to `admin.activity` holders.
    let billing_id = seed_user(&pool, "admin_security_api", "billing").await;
    let (status, _) = json_request(
        &app,
        "GET",
        "/api/v1/admin/activity?category=access",
        &auth_header_for("billing", billing_id),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn access_policy_matrix_exposes_it_admin_as_locked_hidden() {
    let Some(app) = test_context().await else {
        return;
    };
    let bearer = auth_header_for("it_admin", app.it_admin_id);

    let (status, body) = json_request(
        &app,
        "GET",
        "/api/v1/access-policies?entity_type=patient",
        &bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let policies = body.as_array().expect("policies");
    let it_admin: Vec<&Value> = policies
        .iter()
        .filter(|policy| policy["role"] == "it_admin")
        .collect();
    assert_eq!(it_admin.len(), 14, "one locked row per patient field");
    for policy in &it_admin {
        assert_eq!(policy["access_level"], "hidden", "{policy}");
        assert_eq!(policy["is_system_locked"], true, "{policy}");
        assert!(policy["condition_type"].is_null(), "{policy}");
    }
    assert!(
        !policies.iter().any(|policy| policy["role"] == "ceo"),
        "ceo stays implicit full and is not a matrix row"
    );

    // The column is not editable, not even by the CEO.
    let ceo_id = seed_user(&app.suite.pool, "admin_security_api", "ceo").await;
    for bearer in [bearer, auth_header_for("ceo", ceo_id)] {
        let (status, body) = json_request(
            &app,
            "POST",
            "/api/v1/access-policies/update",
            &bearer,
            Some(json!({
                "role": "it_admin",
                "entity_type": "patient",
                "field_name": "name",
                "access_level": "full"
            })),
        )
        .await;
        assert_eq!(status, StatusCode::FORBIDDEN, "{body}");
    }
    let level: String = sqlx::query_scalar(
        "SELECT access_level FROM field_access_policies WHERE role = 'it_admin' AND entity_type = 'patient' AND field_name = 'name'",
    )
    .fetch_one(&app.suite.pool)
    .await
    .unwrap();
    assert_eq!(level, "hidden");

    // A reset restores the locked column together with the editable defaults.
    let (status, body) = json_request(
        &app,
        "POST",
        "/api/v1/access-policies/reset",
        &auth_header_for("it_admin", app.it_admin_id),
        Some(json!({ "entity_type": "patient" })),
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT, "{body}");
    let locked_rows: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM field_access_policies WHERE role = 'it_admin' AND entity_type = 'patient' AND is_system_locked AND access_level = 'hidden'",
    )
    .fetch_one(&app.suite.pool)
    .await
    .unwrap();
    assert_eq!(locked_rows, 14);
}
