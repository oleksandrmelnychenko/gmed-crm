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

async fn seed_provider(pool: &PgPool, tag: &str) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO providers (
                name, provider_type, address_street, address_city, address_zip, address_country,
                phone, email, fachbereich
           ) VALUES (
                $1, 'medical', $2, $3, $4, $5, $6, $7, $8
           )
           RETURNING id"#,
    )
    .bind(format!("Clinic {tag}"))
    .bind(format!("{tag} Street 1"))
    .bind("Cologne")
    .bind("50667")
    .bind("Germany")
    .bind("+49 221 555000")
    .bind(format!("{tag}@clinic.example"))
    .bind(format!("Fach {tag}"))
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn seed_document(
    pool: &PgPool,
    patient_id: Uuid,
    uploaded_by: Uuid,
    tag: &str,
    visibility: &str,
) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO documents (
                patient_id, auto_name, original_filename, art, category, status, visibility,
                is_medical, mime_type, file_size, uploaded_by, notes
           ) VALUES (
                $1, $2, $3, 'medical_report', 'report', 'active', $4,
                true, 'application/pdf', 1024, $5, $6
           )
           RETURNING id"#,
    )
    .bind(patient_id)
    .bind(format!("Document {tag}"))
    .bind(format!("{tag}.pdf"))
    .bind(visibility)
    .bind(uploaded_by)
    .bind(format!("Notes {tag}"))
    .fetch_one(pool)
    .await
    .unwrap()
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
    assert!(body["expires_at"].is_string());

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
    assert!(
        exported_consents
            .iter()
            .any(|item| item["granted"] == true && item["expires_at"].is_string())
    );

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
async fn patient_manager_cannot_create_duplicate_open_privacy_request_for_patient() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("admin-privacy-dup");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let pm_id = seed_user(&pool, &tag, "patient_manager").await;
    seed_patient_assignment(&pool, patient_id, pm_id, admin_id).await;
    let bearer = auth_header_for(pm_id, "patient_manager");

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/admin/compliance/patient/{patient_id}/privacy-requests"),
        &bearer,
        Some(json!({
            "request_type": "restriction",
            "source": "admin_intake",
            "reason": "Initial intake note"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(body["status"], "requested");

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/admin/compliance/patient/{patient_id}/privacy-requests"),
        &bearer,
        Some(json!({
            "request_type": "restriction",
            "source": "admin_intake",
            "reason": "Duplicate intake should fail"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(
        body["message"],
        "An open privacy request of this type already exists"
    );
}

#[tokio::test]
async fn expired_consents_use_explicit_expiry_and_active_counts_ignore_them() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("admin-consent-expiry");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let pm_id = seed_user(&pool, &tag, "patient_manager").await;
    seed_patient_assignment(&pool, patient_id, pm_id, admin_id).await;

    sqlx::query(
        r#"INSERT INTO consent_records (
                patient_id, user_id, consent_type, granted, granted_at, expires_at, context
           ) VALUES (
                $1, $2, $3, true, now(), now() - interval '2 days', '{}'::jsonb
           )"#,
    )
    .bind(patient_id)
    .bind(pm_id)
    .bind("dsgvo_data_transfer")
    .execute(&pool)
    .await
    .unwrap();

    sqlx::query(
        r#"INSERT INTO consent_records (
                patient_id, user_id, consent_type, granted, granted_at, expires_at, context
           ) VALUES (
                $1, $2, $3, true, now() - interval '2 years', now() + interval '30 days', '{}'::jsonb
           )"#,
    )
    .bind(patient_id)
    .bind(pm_id)
    .bind("third_party_sharing")
    .execute(&pool)
    .await
    .unwrap();

    let bearer = auth_header_for(pm_id, "patient_manager");

    let (status, body) = json_request(
        &app,
        "GET",
        "/api/v1/admin/compliance/consents/expired",
        &bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let expired = body.as_array().expect("expired consents");
    assert_eq!(expired.len(), 1);
    assert_eq!(expired[0]["patient_id"], patient_id.to_string());
    assert_eq!(expired[0]["consent_type"], "dsgvo_data_transfer");
    assert!(expired[0]["expires_at"].is_string());

    let (status, body) = json_request(
        &app,
        "GET",
        "/api/v1/admin/compliance/consents",
        &bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["total"], 2);
    assert_eq!(body["granted_active"], 1);
    assert_eq!(body["by_type"][0]["active"], 0);
    assert_eq!(body["by_type"][1]["active"], 1);
}

#[tokio::test]
async fn patient_manager_erasure_request_can_be_reviewed_and_executed() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("privacy-erasure");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let patient_user_id = seed_user(&pool, &format!("{tag}-patient"), "patient").await;
    let pm_id = seed_user(&pool, &tag, "patient_manager").await;
    let it_admin_id = seed_user(&pool, &tag, "it_admin").await;
    seed_patient_assignment(&pool, patient_id, patient_user_id, admin_id).await;
    seed_patient_assignment(&pool, patient_id, pm_id, admin_id).await;

    let attachment_key = format!("gdpr-erasure-{}.txt", Uuid::new_v4().simple());
    let attachment_path = std::path::Path::new("uploads/chat").join(&attachment_key);
    tokio::fs::create_dir_all("uploads/chat").await.unwrap();
    tokio::fs::write(&attachment_path, b"sensitive-chat-attachment")
        .await
        .unwrap();

    sqlx::query(
        r#"INSERT INTO direct_messages (
                from_user, to_user, message,
                attachment_filename, attachment_mime, attachment_size, attachment_key
           ) VALUES (
                $1, $2, $3, $4, $5, $6, $7
           )"#,
    )
    .bind(patient_user_id)
    .bind(pm_id)
    .bind("Sensitive patient message")
    .bind("erasure-note.txt")
    .bind("text/plain")
    .bind(25_i64)
    .bind(&attachment_key)
    .execute(&pool)
    .await
    .unwrap();

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

    let redacted_message = sqlx::query(
        r#"SELECT message, attachment_key, redacted_at, redaction_reason
           FROM direct_messages
           WHERE (from_user = $1 AND to_user = $2) OR (from_user = $2 AND to_user = $1)
           ORDER BY created_at DESC
           LIMIT 1"#,
    )
    .bind(patient_user_id)
    .bind(pm_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        redacted_message
            .try_get::<Option<String>, _>("message")
            .unwrap()
            .as_deref(),
        Some("[redacted due to DSGVO erasure]")
    );
    assert_eq!(
        redacted_message
            .try_get::<Option<String>, _>("attachment_key")
            .unwrap(),
        None
    );
    assert!(
        redacted_message
            .try_get::<Option<chrono::DateTime<chrono::Utc>>, _>("redacted_at")
            .unwrap()
            .is_some()
    );
    assert_eq!(
        redacted_message
            .try_get::<Option<String>, _>("redaction_reason")
            .unwrap()
            .as_deref(),
        Some("dsgvo_erasure")
    );
    assert!(!attachment_path.exists());

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
async fn third_party_revoke_request_can_be_executed_by_patient_manager_and_revokes_only_external_consents_and_provider_document_shares()
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

    let provider_id = seed_provider(&pool, &format!("{tag}-provider")).await;
    let external_document_id = seed_document(
        &pool,
        patient_id,
        pm_id,
        &format!("{tag}-external"),
        "released_external",
    )
    .await;
    let portal_document_id = seed_document(
        &pool,
        patient_id,
        pm_id,
        &format!("{tag}-portal"),
        "patient_visible",
    )
    .await;

    sqlx::query(
        r#"INSERT INTO document_shares (
                document_id, shared_with_provider_id, shared_by, channel, requires_confirmation,
                confirmed, confirmed_at
           ) VALUES (
                $1, $2, $3, 'secure_email', true, true, now()
           )"#,
    )
    .bind(external_document_id)
    .bind(provider_id)
    .bind(pm_id)
    .execute(&pool)
    .await
    .unwrap();

    sqlx::query(
        r#"INSERT INTO document_shares (
                document_id, shared_with_user_id, shared_by, channel, requires_confirmation,
                confirmed, confirmed_at
           ) VALUES (
                $1, $2, $3, 'patient_portal', true, true, now()
           )"#,
    )
    .bind(portal_document_id)
    .bind(patient_user_id)
    .bind(pm_id)
    .execute(&pool)
    .await
    .unwrap();

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
    assert_eq!(body["execution"]["revoked_document_share_count"], 1);

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
    assert_eq!(legal_status["third_party_document_shares_revoked_count"], 1);

    let active_provider_share_count: i64 = sqlx::query_scalar(
        r#"SELECT count(*)
           FROM document_shares
           WHERE document_id = $1
             AND shared_with_provider_id = $2
             AND revoked_at IS NULL"#,
    )
    .bind(external_document_id)
    .bind(provider_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(active_provider_share_count, 0);

    let active_patient_portal_share_count: i64 = sqlx::query_scalar(
        r#"SELECT count(*)
           FROM document_shares
           WHERE document_id = $1
             AND shared_with_user_id = $2
             AND channel = 'patient_portal'
             AND revoked_at IS NULL"#,
    )
    .bind(portal_document_id)
    .bind(patient_user_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(active_patient_portal_share_count, 1);

    let patient_bearer = auth_header_for(patient_user_id, "patient");
    let (status, portal_documents) =
        json_request(&app, "GET", "/api/v1/me/documents", &patient_bearer, None).await;
    assert_eq!(status, StatusCode::OK);
    let portal_items = portal_documents.as_array().expect("portal documents");
    assert_eq!(portal_items.len(), 1);
    assert_eq!(portal_items[0]["id"], portal_document_id.to_string());
    assert_eq!(portal_items[0]["channel"], "patient_portal");

    let (status, peers_body) = json_request(
        &app,
        "GET",
        "/api/v1/messages/allowed-peers",
        &patient_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let peers = peers_body.as_array().expect("allowed peers");
    assert!(
        peers.iter().any(|item| item["id"] == pm_id.to_string()),
        "assigned patient manager should remain reachable after third_party_revoke execution"
    );

    let patient_message = "Portal release remains available after third-party revoke.";
    let (status, message_body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/messages/{pm_id}"),
        &patient_bearer,
        Some(json!({ "message": patient_message })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(message_body["ok"], true);

    let pm_bearer = auth_header_for(pm_id, "patient_manager");
    let (status, conversation_body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/messages/{patient_user_id}"),
        &pm_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let conversation = conversation_body.as_array().expect("pm conversation");
    assert!(
        conversation
            .iter()
            .any(|item| item["message"] == patient_message),
        "patient-manager chat should stay operational after third_party_revoke execution"
    );

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

    let document_share_revoke_audits: i64 = sqlx::query_scalar(
        r#"SELECT count(*)
           FROM audit_log
           WHERE entity_type = 'patient'
             AND entity_id = $1
             AND action = 'revoke_document_share_bundle'
             AND context->>'mode' = 'third_party_revoke'"#,
    )
    .bind(patient_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(document_share_revoke_audits, 1);
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
