mod support;

use axum::body::Body;
use axum::http::Request;
use axum::http::StatusCode;
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

async fn test_app() -> Option<TestContext> {
    test_context().await
}

/// Returns `(router, it_admin_user_id)`. Tests that exercise routes which
/// audit-log the actor (e.g. settings updates) need a real user row so the
/// `users(id)` foreign keys resolve.
async fn test_context() -> Option<TestContext> {
    let ctx = support::suite_context(TEST_SECRET).await?;
    let it_admin_id = seed_user(&ctx.pool, "admin_mfa_api", "it_admin").await;
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

async fn auth_header(app: &TestContext, role: &str) -> String {
    let user_id = if role == "it_admin" {
        app.it_admin_id
    } else {
        seed_user(&app.suite.pool, "admin_mfa_api", role).await
    };
    auth_header_for(role, user_id)
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
async fn settings_list_requires_it_admin() {
    let Some(app) = test_app().await else { return };
    let (status, _) = json_request(
        &app,
        "GET",
        "/api/v1/admin/settings",
        &auth_header(&app, "sales").await,
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
        &auth_header(&app, "it_admin").await,
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
    assert!(
        arr.iter()
            .any(|s| s["key"] == "clinical_case_retention_years")
    );
    // The IT admin changes only the technical settings (QA E-31).
    let editable = |key: &str| {
        arr.iter()
            .find(|s| s["key"] == key)
            .map(|s| s["editable"].clone())
    };
    assert_eq!(editable("access_token_minutes"), Some(json!(true)));
    assert_eq!(editable("agency_bank_iban"), Some(json!(false)));
    assert_eq!(
        editable("clinical_case_retention_years"),
        Some(json!(false))
    );
    assert_eq!(
        editable("interpreter_booking_access_days"),
        Some(json!(false))
    );

    let (status, body) = json_request(
        &app,
        "GET",
        "/api/v1/admin/settings",
        &auth_header_for("ceo", app.suite.admin_id),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(
        body.as_array()
            .unwrap()
            .iter()
            .all(|s| s["editable"] == json!(true)),
        "{body}"
    );
}

/// QA E-31 (2026-10-11): the agency bank account printed on invoices, tax
/// data, retention and access periods are the CEO's; the IT admin keeps the
/// technical settings.
#[tokio::test]
async fn it_admin_cannot_change_business_or_legal_settings() {
    let Some(app) = test_context().await else {
        return;
    };
    let admin = auth_header_for("it_admin", app.it_admin_id);
    for (key, value) in [
        ("agency_bank_iban", "DE89 3704 0044 0532 0130 00"),
        ("agency_bank_swift", "COBADEFFXXX"),
        ("agency_bank_holder", "Beispiel GmbH"),
        ("agency_vat_id", "DE123456789"),
        ("agency_tax_number", "143/123/12345"),
        ("agency_name", "Beispiel GmbH"),
        ("clinical_case_retention_years", "35"),
        ("patient_file_retention_days", "30"),
        ("interpreter_booking_access_days", "30"),
        ("unqualified_lead_retention_days", "30"),
        ("required_patient_documents", "[]"),
    ] {
        let before: Option<String> =
            sqlx::query_scalar("SELECT value::TEXT FROM system_settings WHERE key = $1")
                .bind(key)
                .fetch_optional(&app.suite.pool)
                .await
                .unwrap();
        let (status, body) = json_request(
            &app,
            "POST",
            &format!("/api/v1/admin/settings/{key}"),
            &admin,
            Some(json!({ "value": value })),
        )
        .await;
        if before.is_none() {
            assert_eq!(status, StatusCode::NOT_FOUND, "{key}: {body}");
            continue;
        }
        assert_eq!(status, StatusCode::FORBIDDEN, "{key}: {body}");
        assert_eq!(body["error"], "business_setting_ceo_only", "{key}");
        let after: Option<String> =
            sqlx::query_scalar("SELECT value::TEXT FROM system_settings WHERE key = $1")
                .bind(key)
                .fetch_optional(&app.suite.pool)
                .await
                .unwrap();
        assert_eq!(before, after, "{key}");
    }

    // A technical setting stays with the IT admin.
    let (status, body) = json_request(
        &app,
        "POST",
        "/api/v1/admin/settings/max_failed_login_attempts",
        &admin,
        Some(json!({ "value": "5" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
}

#[tokio::test]
async fn agency_bank_account_is_validated() {
    let Some(app) = test_context().await else {
        return;
    };
    let ceo = auth_header_for("ceo", app.suite.admin_id);
    for (key, value) in [
        ("agency_bank_iban", "DE00 0000 0000 0000 0000 00"),
        ("agency_bank_iban", "DE89 3704 0044 0532 0130 01"),
        ("agency_bank_swift", "MUSTERBIC"),
    ] {
        let (status, body) = json_request(
            &app,
            "POST",
            &format!("/api/v1/admin/settings/{key}"),
            &ceo,
            Some(json!({ "value": value })),
        )
        .await;
        assert_eq!(
            status,
            StatusCode::UNPROCESSABLE_ENTITY,
            "{key}={value}: {body}"
        );
    }
    let (status, body) = json_request(
        &app,
        "POST",
        "/api/v1/admin/settings/agency_bank_iban",
        &ceo,
        Some(json!({ "value": "de89370400440532013000" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let stored: String = sqlx::query_scalar(
        "SELECT value #>> '{}' FROM system_settings WHERE key = 'agency_bank_iban'",
    )
    .fetch_one(&app.suite.pool)
    .await
    .unwrap();
    assert_eq!(stored, "DE89 3704 0044 0532 0130 00");
}

#[tokio::test]
async fn settings_update_requires_it_admin() {
    let Some(app) = test_app().await else { return };
    let (status, _) = json_request(
        &app,
        "POST",
        "/api/v1/admin/settings/access_token_minutes",
        &auth_header(&app, "sales").await,
        Some(json!({"value": "30"})),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn settings_update_validates_bounds() {
    let Some(app) = test_app().await else { return };
    let admin = auth_header(&app, "it_admin").await;

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
    let Some(app) = test_context().await else {
        return;
    };
    let admin = auth_header_for("it_admin", app.it_admin_id);

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
    let Some(app) = test_context().await else {
        return;
    };
    // Business settings belong to the CEO (QA E-31).
    let admin = auth_header_for("ceo", app.suite.admin_id);

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

    for (key, value) in [
        ("agency_principal_birth_date", "1994-12-12"),
        ("agency_privacy_email", "privacy@gmed.de"),
        ("agency_sign_place", "München"),
        ("agency_data_system_name", "Configured CRM"),
        (
            "agency_data_processor_notice",
            "Configured processor and transfer notice.",
        ),
        ("agency_bank_holder", "GMED Operations"),
        ("agency_bank_name", "Musterbank"),
        ("agency_bank_swift", "COBADEFFXXX"),
        ("agency_bank_iban", "DE89 3704 0044 0532 0130 00"),
    ] {
        let (status, body) = json_request(
            &app,
            "POST",
            &format!("/api/v1/admin/settings/{key}"),
            &admin,
            Some(json!({"value": value})),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{key}: {body:?}");
        assert_eq!(body["ok"], true, "{key}");
    }

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

    let (status, body) = json_request(
        &app,
        "POST",
        "/api/v1/admin/settings/clinical_case_retention_years",
        &admin,
        Some(json!({"value": "35"})),
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
        &auth_header_for("ceo", app.suite.admin_id),
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
        &auth_header_for("ceo", app.suite.admin_id),
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
        &auth_header(&app, "it_admin").await,
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
        &auth_header(&app, "sales").await,
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
        &auth_header(&app, "it_admin").await,
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
        &auth_header(&app, "sales").await,
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
        &auth_header(&app, "sales").await,
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
        &auth_header(&app, "it_admin").await,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(body["items"].is_array());
    assert_eq!(body["limit"], 50);
    assert_eq!(body["offset"], 0);
    assert!(body["total"].is_number());
    assert!(body["has_more"].is_boolean());
    assert_eq!(body["retention"]["technical_days"], 3);
    assert_eq!(body["retention"]["meaningful_days"], 365);
}

#[tokio::test]
async fn activity_filter_by_action() {
    let Some(app) = test_app().await else { return };
    let (status, body) = json_request(
        &app,
        "GET",
        "/api/v1/admin/activity?action=login&limit=25&offset=0&date_from=2026-01-01&date_to=2026-12-31",
        &auth_header(&app, "it_admin").await,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(body["items"].is_array());
    assert_eq!(body["limit"], 25);
    assert_eq!(body["offset"], 0);
    assert!(body["total"].is_number());
}

#[tokio::test]
async fn activity_rejects_invalid_date_range() {
    let Some(app) = test_app().await else { return };
    let (status, _) = json_request(
        &app,
        "GET",
        "/api/v1/admin/activity?date_from=2026-12-31&date_to=2026-01-01",
        &auth_header(&app, "it_admin").await,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
}

#[tokio::test]
async fn mfa_pending_list_requires_it_admin() {
    let Some(app) = test_app().await else { return };
    let (status, _) = json_request(
        &app,
        "GET",
        "/api/v1/admin/mfa/pending",
        &auth_header(&app, "sales").await,
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
        &auth_header(&app, "it_admin").await,
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
        &auth_header(&app, "sales").await,
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
        &auth_header(&app, "it_admin").await,
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
        &auth_header(&app, "it_admin").await,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn check_pending_nonexistent_returns_not_found() {
    let Some(ctx) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let app = ctx.app.clone();
    let fake = uuid::Uuid::new_v4();
    let req = Request::builder()
        .uri(format!("/api/v1/auth/pending/{fake}"))
        .body(Body::empty())
        .unwrap();
    let resp = app.oneshot(req).await.unwrap();
    let status = resp.status();
    let bytes = axum::body::to_bytes(resp.into_body(), 1024 * 1024)
        .await
        .unwrap();
    let body = String::from_utf8_lossy(&bytes);
    assert_eq!(status, StatusCode::NOT_FOUND, "response body: {body}");
}
