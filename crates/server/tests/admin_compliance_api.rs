use axum::body::Body;
use axum::http::{Request, StatusCode};
use serde_json::{Value, json};
use sqlx::PgPool;
use sqlx::Row;
use tower::ServiceExt;
use uuid::Uuid;

use gmed_server::auth::jwt;
use gmed_server::settings::{SettingsCache, TokenSettings};
use gmed_server::state::AppState;

const TEST_SECRET: &str = "test-secret-at-least-32-characters-long!!";

async fn test_context() -> Option<(axum::Router, PgPool, Uuid)> {
    let db_url = match std::env::var("DATABASE_URL") {
        Ok(url) => url,
        Err(_) => return None,
    };

    let pool = gmed_db::create_pool(&db_url).await.ok()?;
    gmed_db::run_migrations(&pool).await.ok()?;

    let admin_id: Uuid = sqlx::query_scalar("SELECT id FROM users WHERE email = $1")
        .bind("admin@gmed.de")
        .fetch_one(&pool)
        .await
        .ok()?;

    let state = AppState::new(
        pool.clone(),
        TEST_SECRET,
        SettingsCache::new(TokenSettings::default()),
    );

    Some((gmed_server::build_app(state), pool, admin_id))
}

async fn json_request(
    app: &axum::Router,
    method: &str,
    path: &str,
    bearer: &str,
    body: Option<Value>,
) -> (StatusCode, Value) {
    let request_body = match body {
        Some(value) => Body::from(serde_json::to_vec(&value).unwrap()),
        None => Body::empty(),
    };

    let request = Request::builder()
        .method(method)
        .uri(path)
        .header("Authorization", bearer)
        .header("Content-Type", "application/json")
        .body(request_body)
        .unwrap();

    let response = app.clone().oneshot(request).await.unwrap();
    let status = response.status();
    let bytes = axum::body::to_bytes(response.into_body(), 1024 * 1024)
        .await
        .unwrap();
    let payload: Value = serde_json::from_slice(&bytes).unwrap_or(json!(null));
    (status, payload)
}

fn unique_tag(prefix: &str) -> String {
    format!("{prefix}-{}", Uuid::new_v4().simple())
}

fn auth_header_for(user_id: Uuid, role: &str) -> String {
    let token = jwt::issue_access_token(TEST_SECRET, user_id, role, Uuid::new_v4()).unwrap();
    format!("Bearer {token}")
}

async fn seed_user(pool: &PgPool, tag: &str, role: &str) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO users (email, password_hash, name, role)
           VALUES ($1, $2, $3, $4)
           RETURNING id"#,
    )
    .bind(format!("{tag}-{role}@example.com"))
    .bind("test-password-hash")
    .bind(format!("{role} {tag}"))
    .bind(role)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn seed_patient(pool: &PgPool, created_by: Uuid, tag: &str) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO patients (
                patient_id, first_name, last_name, birth_date, gender, created_by
           ) VALUES (
                $1, $2, $3, '1990-01-01', 'diverse', $4
           ) RETURNING id"#,
    )
    .bind(format!("PT-{tag}"))
    .bind(format!("First {tag}"))
    .bind(format!("Last {tag}"))
    .bind(created_by)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn seed_patient_assignment(
    pool: &PgPool,
    patient_id: Uuid,
    user_id: Uuid,
    assigned_by: Uuid,
) {
    sqlx::query(
        r#"INSERT INTO patient_assignments (patient_id, user_id, assigned_by)
           VALUES ($1, $2, $3)
           ON CONFLICT (patient_id, user_id)
           DO UPDATE SET revoked_at = NULL, assigned_by = $3, assigned_at = now()"#,
    )
    .bind(patient_id)
    .bind(user_id)
    .bind(assigned_by)
    .execute(pool)
    .await
    .unwrap();
}

#[tokio::test]
async fn patient_manager_can_manage_patient_consents_and_export_contains_history() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("admin-consent");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let pm_id = seed_user(&pool, &tag, "patient_manager").await;
    seed_patient_assignment(&pool, patient_id, pm_id, admin_id).await;
    let pm_bearer = auth_header_for(pm_id, "patient_manager");

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/admin/compliance/patient/{patient_id}/consents"),
        &pm_bearer,
        Some(json!({
            "consent_type": "DSGVO data transfer",
            "action": "grant",
            "note": "Signed in clinic"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(body["consent_type"], "dsgvo_data_transfer");
    assert_eq!(body["granted"], true);

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/admin/compliance/patient/{patient_id}/consents"),
        &pm_bearer,
        Some(json!({
            "consent_type": "DSGVO data transfer",
            "action": "revoke",
            "note": "Patient requested revocation"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(body["consent_type"], "dsgvo_data_transfer");
    assert_eq!(body["granted"], false);

    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/admin/compliance/patient/{patient_id}/consents"),
        &pm_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let history = body.as_array().expect("patient consent history");
    assert_eq!(history.len(), 2);
    assert!(history.iter().any(|item| item["granted"] == true));
    assert!(history.iter().any(|item| item["granted"] == false));

    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/admin/compliance/patient/{patient_id}/export"),
        &pm_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let exported_consents = body["consents"].as_array().expect("exported consents");
    assert_eq!(exported_consents.len(), 2);

    let audit_count: i64 = sqlx::query_scalar(
        r#"SELECT count(*)
           FROM audit_log
           WHERE entity_type = 'patient'
             AND entity_id = $1
             AND action IN ('consent_granted', 'consent_revoked')"#,
    )
    .bind(patient_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(audit_count, 2);
}

#[tokio::test]
async fn patient_manager_cannot_manage_unassigned_patient_consents() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("admin-consent-forbidden");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let pm_id = seed_user(&pool, &tag, "patient_manager").await;
    let pm_bearer = auth_header_for(pm_id, "patient_manager");

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/admin/compliance/patient/{patient_id}/consents"),
        &pm_bearer,
        Some(json!({
            "consent_type": "third_party_sharing",
            "action": "grant"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(body["message"], "Insufficient permissions");

    let (status, _) = json_request(
        &app,
        "GET",
        &format!("/api/v1/admin/compliance/patient/{patient_id}/consents"),
        &pm_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn compliance_dashboard_is_scoped_to_assigned_patients() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("admin-consent-scope");
    let pm_a = seed_user(&pool, &format!("{tag}-a"), "patient_manager").await;
    let pm_b = seed_user(&pool, &format!("{tag}-b"), "patient_manager").await;
    let patient_a = seed_patient(&pool, admin_id, &format!("{tag}-pa")).await;
    let patient_b = seed_patient(&pool, admin_id, &format!("{tag}-pb")).await;
    seed_patient_assignment(&pool, patient_a, pm_a, admin_id).await;
    seed_patient_assignment(&pool, patient_b, pm_b, admin_id).await;

    sqlx::query(
        r#"INSERT INTO consent_records (
                patient_id, user_id, consent_type, granted, granted_at, context
           ) VALUES (
                $1, $2, $3, true, now(), '{}'::jsonb
           )"#,
    )
    .bind(patient_a)
    .bind(pm_a)
    .bind("dsgvo_data_transfer")
    .execute(&pool)
    .await
    .unwrap();

    sqlx::query(
        r#"INSERT INTO consent_records (
                patient_id, user_id, consent_type, granted, granted_at, context
           ) VALUES (
                $1, $2, $3, true, now(), '{}'::jsonb
           )"#,
    )
    .bind(patient_b)
    .bind(pm_b)
    .bind("third_party_sharing")
    .execute(&pool)
    .await
    .unwrap();

    let (status, body) = json_request(
        &app,
        "GET",
        "/api/v1/admin/compliance/consents",
        &auth_header_for(pm_a, "patient_manager"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["total"], 1);
    assert_eq!(body["granted_active"], 1);
    assert_eq!(
        body["recent_changes"][0]["patient_id"],
        patient_a.to_string()
    );
    assert_eq!(
        body["recent_changes"][0]["consent_type"],
        "dsgvo_data_transfer"
    );
}

#[tokio::test]
async fn patient_manager_erasure_request_can_be_reviewed_and_executed() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("privacy-erasure");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let pm_id = seed_user(&pool, &tag, "patient_manager").await;
    let it_admin_id = seed_user(&pool, &tag, "it_admin").await;
    seed_patient_assignment(&pool, patient_id, pm_id, admin_id).await;

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/admin/compliance/patient/{patient_id}/privacy-requests"),
        &auth_header_for(pm_id, "patient_manager"),
        Some(json!({
            "request_type": "erasure",
            "reason": "Patient asked to be forgotten"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(body["status"], "requested");
    assert_eq!(body["request_type"], "erasure");
    let request_id = body["id"].as_str().expect("privacy request id");

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/admin/compliance/privacy-requests/{request_id}/review"),
        &auth_header_for(it_admin_id, "it_admin"),
        Some(json!({ "action": "approve" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["status"], "approved");

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/admin/compliance/privacy-requests/{request_id}/execute"),
        &auth_header_for(it_admin_id, "it_admin"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["request_type"], "erasure");
    assert_eq!(body["execution"]["mode"], "erasure");

    let patient_row = sqlx::query(
        r#"SELECT patient_id, first_name, last_name, email, is_active
           FROM patients
           WHERE id = $1"#,
    )
    .bind(patient_id)
    .fetch_one(&pool)
    .await
    .unwrap();

    let anonymized_pid = patient_row.try_get::<String, _>("patient_id").unwrap();
    assert!(anonymized_pid.starts_with("ANON-"));
    assert_eq!(
        patient_row.try_get::<String, _>("first_name").unwrap(),
        anonymized_pid
    );
    assert_eq!(
        patient_row.try_get::<String, _>("last_name").unwrap(),
        anonymized_pid
    );
    assert_eq!(
        patient_row.try_get::<Option<String>, _>("email").unwrap(),
        None
    );
    assert!(!patient_row.try_get::<bool, _>("is_active").unwrap());

    let audit_count: i64 = sqlx::query_scalar(
        r#"SELECT count(*)
           FROM audit_log
           WHERE entity_type = 'patient'
             AND entity_id = $1
             AND action IN (
                 'privacy_request_created',
                 'privacy_request_reviewed',
                 'privacy_request_executed',
                 'dsgvo_anonymize'
             )"#,
    )
    .bind(patient_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(audit_count, 4);
}

#[tokio::test]
async fn restriction_request_updates_legal_status_and_queue_is_assignment_scoped() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("privacy-restriction");
    let patient_a = seed_patient(&pool, admin_id, &format!("{tag}-a")).await;
    let patient_b = seed_patient(&pool, admin_id, &format!("{tag}-b")).await;
    let pm_a = seed_user(&pool, &format!("{tag}-a"), "patient_manager").await;
    let pm_b = seed_user(&pool, &format!("{tag}-b"), "patient_manager").await;
    let it_admin_id = seed_user(&pool, &format!("{tag}-it"), "it_admin").await;
    seed_patient_assignment(&pool, patient_a, pm_a, admin_id).await;
    seed_patient_assignment(&pool, patient_b, pm_b, admin_id).await;

    let (_, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/admin/compliance/patient/{patient_a}/privacy-requests"),
        &auth_header_for(pm_a, "patient_manager"),
        Some(json!({
            "request_type": "restriction",
            "reason": "Temporary legal hold"
        })),
    )
    .await;
    let request_a = body["id"].as_str().expect("request a").to_string();

    let (_, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/admin/compliance/patient/{patient_b}/privacy-requests"),
        &auth_header_for(pm_b, "patient_manager"),
        Some(json!({
            "request_type": "erasure",
            "reason": "Other PM patient"
        })),
    )
    .await;
    let request_b = body["id"].as_str().expect("request b").to_string();

    let (status, body) = json_request(
        &app,
        "GET",
        "/api/v1/admin/compliance/privacy-requests",
        &auth_header_for(pm_a, "patient_manager"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let items = body.as_array().expect("privacy queue");
    assert_eq!(items.len(), 1);
    assert_eq!(items[0]["patient_id"], patient_a.to_string());
    assert_eq!(items[0]["request_type"], "restriction");

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/admin/compliance/privacy-requests/{request_a}/review"),
        &auth_header_for(it_admin_id, "it_admin"),
        Some(json!({ "action": "approve" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["status"], "approved");

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/admin/compliance/privacy-requests/{request_a}/execute"),
        &auth_header_for(it_admin_id, "it_admin"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["execution"]["mode"], "restriction");

    let legal_status: Value = sqlx::query_scalar("SELECT legal_status FROM patients WHERE id = $1")
        .bind(patient_a)
        .fetch_one(&pool)
        .await
        .unwrap();

    assert_eq!(legal_status["processing_restricted"], true);
    assert_eq!(legal_status["processing_restriction_request_id"], request_a);

    let (status, body) = json_request(
        &app,
        "GET",
        "/api/v1/admin/compliance/privacy-requests",
        &auth_header_for(pm_a, "patient_manager"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let items = body.as_array().expect("privacy queue after execution");
    assert_eq!(items.len(), 1);
    assert_eq!(items[0]["id"], request_a);
    assert_ne!(items[0]["id"], request_b);
}

#[tokio::test]
async fn third_party_revoke_request_can_be_executed_by_patient_manager_and_revokes_only_external_consents()
 {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("privacy-third-party-revoke");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let patient_user_id = seed_user(&pool, &format!("{tag}-patient"), "patient").await;
    let pm_id = seed_user(&pool, &format!("{tag}-pm"), "patient_manager").await;
    seed_patient_assignment(&pool, patient_id, patient_user_id, admin_id).await;
    seed_patient_assignment(&pool, patient_id, pm_id, admin_id).await;

    for consent_type in [
        "dsgvo_data_transfer",
        "third_party_sharing",
        "schweigepflicht_release",
        "treatment_contract",
    ] {
        sqlx::query(
            r#"INSERT INTO consent_records (
                    patient_id, user_id, consent_type, granted, granted_at, context
               ) VALUES (
                    $1, $2, $3, true, now(), '{}'::jsonb
               )"#,
        )
        .bind(patient_id)
        .bind(pm_id)
        .bind(consent_type)
        .execute(&pool)
        .await
        .unwrap();
    }

    let (status, body) = json_request(
        &app,
        "POST",
        "/api/v1/me/privacy-requests",
        &auth_header_for(patient_user_id, "patient"),
        Some(json!({
            "request_type": "third_party_revoke",
            "reason": "Withdraw all third-party releases"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let request_id = body["id"].as_str().expect("privacy request id");

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/admin/compliance/privacy-requests/{request_id}/review"),
        &auth_header_for(pm_id, "patient_manager"),
        Some(json!({ "action": "approve" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["status"], "approved");

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/admin/compliance/privacy-requests/{request_id}/execute"),
        &auth_header_for(pm_id, "patient_manager"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["request_type"], "third_party_revoke");
    assert_eq!(body["execution"]["mode"], "third_party_revoke");
    assert_eq!(body["execution"]["revoked_count"], 3);

    let still_active: Vec<String> = sqlx::query_scalar(
        r#"SELECT consent_type
           FROM consent_records
           WHERE patient_id = $1
             AND granted = true
             AND revoked_at IS NULL
           ORDER BY consent_type"#,
    )
    .bind(patient_id)
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(still_active, vec!["treatment_contract".to_string()]);

    let legal_status: Value = sqlx::query_scalar("SELECT legal_status FROM patients WHERE id = $1")
        .bind(patient_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(legal_status["third_party_sharing_request_id"], request_id);

    let consent_revoke_audits: i64 = sqlx::query_scalar(
        r#"SELECT count(*)
           FROM audit_log
           WHERE entity_type = 'patient'
             AND entity_id = $1
             AND action = 'consent_revoked'
             AND context->>'mode' = 'third_party_revoke'"#,
    )
    .bind(patient_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(consent_revoke_audits, 1);
}

#[tokio::test]
async fn direct_patient_delete_is_blocked_in_favor_of_compliance_workflow() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };

    let patient_id = seed_patient(&pool, admin_id, &unique_tag("blocked-delete")).await;

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/patients/{patient_id}/delete"),
        &auth_header_for(admin_id, "ceo"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(
        body["message"],
        "Direct patient deletion is disabled. Use the DSGVO compliance workflow."
    );
}
