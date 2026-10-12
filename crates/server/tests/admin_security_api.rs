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
    // The UI translates the stable reason code (QA E-06), not the English text.
    for (action, code) in [
        ("refresh_token_theft", "token_theft"),
        ("login_failure", "login_failure"),
        ("login_blocked", "login_blocked"),
    ] {
        assert!(
            recent
                .iter()
                .filter(|item| item["action"] == action)
                .all(|item| item["reason_code"] == code),
            "{action} -> {code}"
        );
    }
    assert!(
        recent
            .iter()
            .any(|item| item["reason_code"] == "executive_access")
    );
    assert!(
        recent
            .iter()
            .any(|item| item["reason_code"] == "off_hours_read")
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

/// QA E2-01 (2026-10-12): the security analytics follow the activity log —
/// a lead or patient reading their own file is not named to the IT admin
/// (no name, no account id, no record id); the CEO still sees who it was.
/// Sign-in events name the endpoint they came from (QA E2-06).
#[tokio::test]
async fn audit_analytics_hides_portal_readers_from_the_it_admin() {
    let Some(app) = test_context().await else {
        return;
    };
    let pool = app.suite.pool.clone();
    let ceo_id = seed_user(&pool, "audit-analytics-portal", "ceo").await;
    let pm_id = seed_user(&pool, "audit-analytics-portal", "patient_manager").await;
    let portal_name = format!("Anna Muster {}", Uuid::new_v4().simple());
    let portal_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO users (email, password_hash, name, role)
           VALUES ($1, 'test-password-hash', $2, 'patient')
           RETURNING id"#,
    )
    .bind(format!(
        "anna.muster.{}@example.com",
        Uuid::new_v4().simple()
    ))
    .bind(&portal_name)
    .fetch_one(&pool)
    .await
    .unwrap();
    let other_portal_id = seed_user(&pool, "audit-analytics-portal", "patient").await;
    let own_record = Uuid::new_v4();

    sqlx::query(
        r#"INSERT INTO audit_log (user_id, action, entity_type, entity_id, context, ip_address, created_at)
           VALUES
                ($1, 'read_patient', 'patient', $4, '{"route":"/api/v1/me/patient","status":200}'::jsonb, 'sha256:ip-p', now() - interval '1 hour'),
                ($1, 'read_document', 'document', $4, '{"route":"/api/v1/me/documents/{id}","status":200}'::jsonb, 'sha256:ip-p', now() - interval '2 hour'),
                ($2, 'read_patient', 'patient', gen_random_uuid(), '{}'::jsonb, 'sha256:ip-q', now() - interval '3 hour'),
                ($3, 'read_patient', 'patient', gen_random_uuid(), '{}'::jsonb, 'sha256:ip-s', now() - interval '4 hour'),
                ($1, 'login_failure', 'auth', $1, '{"reason":"wrong_password","failed_attempts":2}'::jsonb, 'sha256:ip-p', now() - interval '5 minute'),
                (NULL, 'login_failure', 'auth', NULL, '{"reason":"unknown_email"}'::jsonb, 'sha256:ip-x', now() - interval '6 minute')"#,
    )
    .bind(portal_id)
    .bind(other_portal_id)
    .bind(pm_id)
    .bind(own_record)
    .execute(&pool)
    .await
    .unwrap();

    let (status, body) = json_request(
        &app,
        "GET",
        "/api/v1/admin/audit-analytics",
        &auth_header_for("it_admin", app.it_admin_id),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let raw = body.to_string();
    assert!(!raw.contains(&portal_name), "{raw}");
    assert!(!raw.contains(&portal_id.to_string()), "{raw}");
    assert!(!raw.contains(&other_portal_id.to_string()), "{raw}");
    assert!(!raw.contains(&own_record.to_string()), "{raw}");

    let readers = body["top_sensitive_readers"].as_array().expect("readers");
    // Both portal logins collapse into one anonymous row.
    let portal_rows: Vec<&Value> = readers
        .iter()
        .filter(|row| row["user_role"] == "patient")
        .collect();
    assert_eq!(portal_rows.len(), 1, "{body}");
    assert_eq!(portal_rows[0]["user_id"], Value::Null);
    assert_eq!(portal_rows[0]["user_name"], Value::Null);
    assert_eq!(portal_rows[0]["event_count"], 3);
    // Staff readers stay named.
    assert!(
        readers
            .iter()
            .any(|row| row["user_id"] == pm_id.to_string() && row["event_count"] == 1),
        "{body}"
    );

    let recent = body["recent_suspicious_events"].as_array().expect("events");
    let portal_failure = recent
        .iter()
        .find(|row| row["action"] == "login_failure" && row["user_role"] == "patient")
        .expect("portal sign-in failure listed");
    assert_eq!(portal_failure["user_name"], Value::Null);
    assert_eq!(portal_failure["entity_id"], Value::Null);
    assert_eq!(portal_failure["context"], json!({ "redacted": true }));
    assert_eq!(portal_failure["route"], "/api/v1/auth/login");
    assert_eq!(portal_failure["method"], "POST");
    let unknown = recent
        .iter()
        .find(|row| row["action"] == "login_failure" && row["user_role"].is_null())
        .expect("unknown e-mail failure listed");
    assert_eq!(unknown["route"], "/api/v1/auth/login");
    assert_eq!(unknown["context"]["reason"], "unknown_email");

    // The CEO sees who read what.
    let (status, body) = json_request(
        &app,
        "GET",
        "/api/v1/admin/audit-analytics",
        &auth_header_for("ceo", ceo_id),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let readers = body["top_sensitive_readers"].as_array().expect("readers");
    assert!(
        readers
            .iter()
            .any(|row| row["user_name"] == portal_name.as_str()
                && row["user_id"] == portal_id.to_string()
                && row["event_count"] == 2),
        "{body}"
    );
}

/// QA E-14: "Datenänderungen 24 h" counted only rows with an HTTP write
/// method, so domain events (`update_lead`, `create_invoice`, ...) never
/// counted. Reads, downloads, sign-ins and technical rows still do not.
#[tokio::test]
async fn activity_data_change_kpi_counts_domain_writes_but_not_reads() {
    let Some(app) = test_context().await else {
        return;
    };
    let filter = gmed_server::routes::admin_settings::ACTIVITY_DATA_CHANGE_FILTER;
    let rows = [
        ("update_lead", "lead", json!({}), true),
        ("create_invoice", "invoice", json!({}), true),
        (
            "security_incident_reported",
            "security_incident",
            json!({}),
            true,
        ),
        (
            "update_patient",
            "patient",
            json!({ "method": "PUT" }),
            true,
        ),
        ("view_patient", "patient", json!({ "method": "GET" }), false),
        ("view_patient", "patient", json!({}), false),
        ("read_patient", "patient", json!({}), false),
        ("download_document", "document", json!({}), false),
        ("export_patient_clinical_pdf", "patient", json!({}), false),
        ("login_success", "auth", json!({}), false),
        ("revoke_all_sessions", "token_family", json!({}), false),
        ("http_request", "http", json!({ "method": "POST" }), false),
    ];
    for (action, entity_type, context, expected) in rows {
        let counted: bool = sqlx::query_scalar(&format!(
            "SELECT {filter} FROM (SELECT $1::text AS action, $2::text AS entity_type, $3::jsonb AS context) AS audit_row"
        ))
        .bind(action)
        .bind(entity_type)
        .bind(context.clone())
        .fetch_one(&app.suite.pool)
        .await
        .unwrap();
        assert_eq!(counted, expected, "{action} {entity_type} {context}");
    }
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

/// QA E-45 (2026-10-11): the activity log does not hand the IT admin
/// sanctions decisions, lead e-mails or other patient data; the CEO reads
/// everything.
#[tokio::test]
async fn activity_log_redacts_business_payloads_for_the_it_admin() {
    let Some(app) = test_context().await else {
        return;
    };
    let pool = app.suite.pool.clone();
    let ceo_id = seed_user(&pool, "admin_security_api", "ceo").await;
    let portal_id = seed_user(&pool, "admin_security_api", "patient").await;
    let marker = format!("Synthetik-{}", Uuid::new_v4().simple());
    sqlx::query(
        r#"INSERT INTO audit_log (user_id, action, entity_type, entity_id, context, created_at)
           VALUES
                ($1, 'sanctions_hit_decided', 'sanctions_hit', gen_random_uuid(),
                 jsonb_build_object('decision', 'false_positive', 'reason', $3::text), now() - interval '1 minute'),
                ($1, 'create_lead_portal_account', 'lead', gen_random_uuid(),
                 jsonb_build_object('email', $3::text || '@example.com'), now() - interval '2 minute'),
                ($1, 'reset_password', 'user', $2,
                 jsonb_build_object('note', $3::text), now() - interval '3 minute'),
                ($2, 'lead_portal_update_step1', 'lead', gen_random_uuid(),
                 jsonb_build_object('field', $3::text), now() - interval '4 minute'),
                ($1, 'update_setting', 'system_settings', NULL,
                 jsonb_build_object('key', 'access_token_minutes', 'marker', $3::text), now() - interval '5 minute')"#,
    )
    .bind(ceo_id)
    .bind(portal_id)
    .bind(&marker)
    .execute(&pool)
    .await
    .unwrap();

    let it_admin = auth_header_for("it_admin", app.it_admin_id);
    let (status, body) = json_request(
        &app,
        "GET",
        "/api/v1/admin/activity?limit=200",
        &it_admin,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let items = body["items"].as_array().expect("items");
    let by_action = |action: &str| {
        items
            .iter()
            .find(|item| item["action"] == action)
            .unwrap_or_else(|| panic!("{action} missing: {body}"))
    };
    for action in [
        "sanctions_hit_decided",
        "create_lead_portal_account",
        "reset_password",
        "lead_portal_update_step1",
    ] {
        assert_eq!(
            by_action(action)["context"],
            json!({ "redacted": true }),
            "{action}"
        );
    }
    // A portal login acting in its cabinet stays anonymous.
    let portal_row = by_action("lead_portal_update_step1");
    assert_eq!(portal_row["user_name"], "");
    assert_eq!(portal_row["user_email"], "");
    // Technical settings keep their context.
    assert_eq!(
        by_action("update_setting")["context"]["key"],
        "access_token_minutes"
    );
    // The search does not find what is hidden … apart from technical rows.
    let (status, found) = json_request(
        &app,
        "GET",
        &format!("/api/v1/admin/activity?search={marker}&limit=200"),
        &it_admin,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let found_actions: Vec<&str> = found["items"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|item| item["action"].as_str())
        .collect();
    assert_eq!(found_actions, ["update_setting"], "{found}");

    // The CEO reads every payload.
    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/admin/activity?search={marker}&limit=200"),
        &auth_header_for("ceo", ceo_id),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let decided = body["items"]
        .as_array()
        .unwrap()
        .iter()
        .find(|item| item["action"] == "sanctions_hit_decided")
        .expect("ceo sees the decision");
    assert_eq!(decided["context"]["reason"], json!(marker));
    assert_eq!(body["total"], 5, "{body}");
}

/// QA E-42 (2026-10-11): interpreters never get the clinical record; the
/// matrix shows those fields locked and nobody can open them.
#[tokio::test]
async fn interpreter_clinical_fields_are_locked_hidden() {
    let Some(app) = test_context().await else {
        return;
    };
    let ceo_id = seed_user(&app.suite.pool, "admin_security_api", "ceo").await;
    let (status, body) = json_request(
        &app,
        "GET",
        "/api/v1/access-policies?entity_type=patient",
        &auth_header_for("ceo", ceo_id),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    for role in ["interpreter", "teamlead_interpreter"] {
        for field in ["diagnosis", "medications", "allergies", "vitals"] {
            let policy = body
                .as_array()
                .unwrap()
                .iter()
                .find(|policy| policy["role"] == role && policy["field_name"] == field)
                .unwrap_or_else(|| panic!("{role} {field}"));
            assert_eq!(policy["access_level"], "hidden", "{policy}");
            assert_eq!(policy["is_system_locked"], true, "{policy}");
            let (status, response) = json_request(
                &app,
                "POST",
                "/api/v1/access-policies/update",
                &auth_header_for("ceo", ceo_id),
                Some(json!({
                    "role": role,
                    "entity_type": "patient",
                    "field_name": field,
                    "access_level": "conditional",
                    "condition_type": "assigned_appointment"
                })),
            )
            .await;
            assert_eq!(status, StatusCode::FORBIDDEN, "{role} {field}: {response}");
        }
    }
}

/// Owner decision 2026-10-11: the CEO Assistant reads everything (read-only),
/// the clinical record, insurance, internal notes and labels included. The
/// matrix shows those fields as read access, system locked, and nobody can
/// hide or change them there.
#[tokio::test]
async fn ceo_assistant_fields_show_locked_read_access() {
    let Some(app) = test_context().await else {
        return;
    };
    let ceo_id = seed_user(&app.suite.pool, "admin_security_api", "ceo").await;
    let (status, body) = json_request(
        &app,
        "GET",
        "/api/v1/access-policies?entity_type=patient",
        &auth_header_for("ceo", ceo_id),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    for field in [
        "insurance",
        "diagnosis",
        "medications",
        "allergies",
        "vitals",
        "internal_notes",
        "functional_labels",
    ] {
        let policy = body
            .as_array()
            .unwrap()
            .iter()
            .find(|policy| policy["role"] == "ceo_assistant" && policy["field_name"] == field)
            .unwrap_or_else(|| panic!("ceo_assistant {field}"));
        assert_eq!(policy["access_level"], "full", "{policy}");
        assert_eq!(policy["is_system_locked"], true, "{policy}");
        let (status, response) = json_request(
            &app,
            "POST",
            "/api/v1/access-policies/update",
            &auth_header_for("ceo", ceo_id),
            Some(json!({
                "role": "ceo_assistant",
                "entity_type": "patient",
                "field_name": field,
                "access_level": "hidden"
            })),
        )
        .await;
        assert_eq!(status, StatusCode::FORBIDDEN, "{field}: {response}");
    }
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

/// The technical admin manages every account except the CEO; the security
/// and session screens must not open a side door to the CEO account.
#[tokio::test]
async fn it_admin_security_actions_cannot_target_the_ceo() {
    let Some(app) = test_context().await else {
        return;
    };
    let ceo_id = seed_user(&app.suite.pool, "admin_security_ceo_guard", "ceo").await;
    let pm_id = seed_user(
        &app.suite.pool,
        "admin_security_ceo_guard",
        "patient_manager",
    )
    .await;
    sqlx::query("UPDATE users SET failed_login_attempts = 5, locked_until = now() + interval '30 minutes' WHERE id = ANY($1)")
        .bind(vec![ceo_id, pm_id])
        .execute(&app.suite.pool)
        .await
        .unwrap();
    let it_admin = auth_header_for("it_admin", app.it_admin_id);

    let actions = |user_id: Uuid| {
        [
            (format!("/api/v1/admin/users/{user_id}/unlock"), None),
            (
                format!("/api/v1/admin/users/{user_id}/force-password-reset"),
                None,
            ),
            (
                format!("/api/v1/admin/mfa/user/{user_id}/toggle"),
                Some(json!({ "enabled": true })),
            ),
            (
                format!("/api/v1/admin/sessions/user/{user_id}/revoke"),
                None,
            ),
        ]
    };

    for (path, body) in actions(ceo_id) {
        let (status, response) = json_request(&app, "POST", &path, &it_admin, body).await;
        assert_eq!(status, StatusCode::FORBIDDEN, "{path}: {response}");
    }
    let (locked, reset_required, mfa_required): (bool, bool, bool) = sqlx::query_as(
        "SELECT locked_until IS NOT NULL, password_reset_required, mfa_required FROM users WHERE id = $1",
    )
    .bind(ceo_id)
    .fetch_one(&app.suite.pool)
    .await
    .unwrap();
    assert!(locked, "the CEO lock must stay untouched");
    assert!(!reset_required && !mfa_required);

    for (path, body) in actions(pm_id) {
        let (status, response) = json_request(&app, "POST", &path, &it_admin, body).await;
        assert_eq!(status, StatusCode::OK, "{path}: {response}");
    }
    let (locked, reset_required, mfa_required): (bool, bool, bool) = sqlx::query_as(
        "SELECT locked_until IS NOT NULL, password_reset_required, mfa_required FROM users WHERE id = $1",
    )
    .bind(pm_id)
    .fetch_one(&app.suite.pool)
    .await
    .unwrap();
    assert!(!locked && reset_required && mfa_required);

    let unknown = Uuid::new_v4();
    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/admin/users/{unknown}/unlock"),
        &it_admin,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}
