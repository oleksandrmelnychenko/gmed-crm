mod support;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use serde_json::{Value, json};
use sqlx::PgPool;
use sqlx::Row;
use tower::ServiceExt;
use uuid::Uuid;

use gmed_server::auth::jwt;
const TEST_SECRET: &str = "test-secret-at-least-32-characters-long!!";

async fn test_context() -> Option<(axum::Router, PgPool, Uuid)> {
    let ctx = support::suite_context(TEST_SECRET).await?;
    Some((ctx.app, ctx.pool, ctx.admin_id))
}

async fn wait_for_patient_audit_actions(
    pool: &PgPool,
    patient_id: Uuid,
    expected_count: i64,
    actions: &[&str],
) -> i64 {
    support::wait_until(
        &format!(
            "patient audit actions for {patient_id}: {}",
            actions.join(",")
        ),
        || async move {
            let count: i64 = sqlx::query_scalar(
                r#"SELECT count(*)
                   FROM audit_log
                   WHERE entity_type = 'patient'
                     AND entity_id = $1
                     AND action = ANY($2)"#,
            )
            .bind(patient_id)
            .bind(actions)
            .fetch_one(pool)
            .await
            .unwrap();
            count >= expected_count
        },
    )
    .await;

    sqlx::query_scalar(
        r#"SELECT count(*)
           FROM audit_log
           WHERE entity_type = 'patient'
             AND entity_id = $1
             AND action = ANY($2)"#,
    )
    .bind(patient_id)
    .bind(actions)
    .fetch_one(pool)
    .await
    .unwrap()
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
    let document_id = Uuid::new_v4();
    sqlx::query_scalar(
        r#"INSERT INTO documents (
                id, patient_id, auto_name, original_filename, art, category, status, visibility,
                is_medical, mime_type, file_size, version_root_document_id, version_number,
                uploaded_by, notes
           ) VALUES (
                $1, $2, $3, $4, 'medical_report', 'report', 'active', $5,
                true, 'application/pdf', 1024, $1, 1, $6, $7
           )
           RETURNING id"#,
    )
    .bind(document_id)
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

/// An erasure through the register, the only way since the direct
/// `…/anonymize` endpoint was retired: recorded by GMED (no identity check
/// needed), approved and executed. Returns the execution's response.
async fn erase_through_register(app: &axum::Router, patient_id: Uuid, bearer: &str) -> Value {
    let (status, body) = json_request(
        app,
        "POST",
        &format!("/api/v1/admin/compliance/patient/{patient_id}/privacy-requests"),
        bearer,
        Some(json!({
            "request_type": "erasure",
            "source": "admin_intake",
            "reason": "Synthetic erasure for the test",
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    let request_id = body["id"].as_str().unwrap().to_string();
    let (status, body) = json_request(
        app,
        "POST",
        &format!("/api/v1/admin/compliance/privacy-requests/{request_id}/review"),
        bearer,
        Some(json!({ "action": "approve" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let (status, body) = json_request(
        app,
        "POST",
        &format!("/api/v1/admin/compliance/privacy-requests/{request_id}/execute"),
        bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    body
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

    let audit_count = wait_for_patient_audit_actions(
        &pool,
        patient_id,
        2,
        &["consent_granted", "consent_revoked"],
    )
    .await;
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

    let message_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO direct_messages (
                from_user, to_user, message,
                e2e_algorithm, e2e_ciphertext, e2e_nonce, e2e_salt,
                sender_key_fingerprint, recipient_key_fingerprint,
                attachment_filename, attachment_mime, attachment_size, attachment_key,
                attachment_e2e_algorithm, attachment_e2e_nonce, attachment_e2e_salt
           ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9,
                $10, $11, $12, $13, $14, $15, $16
           ) RETURNING id"#,
    )
    .bind(patient_user_id)
    .bind(pm_id)
    .bind("Sensitive patient message")
    .bind("p256-hkdf-aes256gcm-v1")
    .bind(vec![1_u8, 2, 3])
    .bind(vec![4_u8; 12])
    .bind(vec![5_u8; 16])
    .bind("a".repeat(64))
    .bind("b".repeat(64))
    .bind("erasure-note.txt")
    .bind("text/plain")
    .bind(25_i64)
    .bind(&attachment_key)
    .bind("p256-hkdf-aes256gcm-v1")
    .bind(vec![6_u8; 12])
    .bind(vec![7_u8; 16])
    .fetch_one(&pool)
    .await
    .unwrap();

    sqlx::query(
        r#"INSERT INTO user_notifications (
               user_id, kind, title, body, entity_type, entity_id, source_message_id
           ) VALUES ($1, 'direct_message', 'New message', $2, 'message_peer', $3, $4)"#,
    )
    .bind(pm_id)
    .bind("Sensitive patient message")
    .bind(patient_user_id)
    .bind(message_id)
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
    assert_eq!(body["identity_verification_required"], true);

    // The patient filed it: no erasure before the identity check is recorded.
    let execute_path = format!("/api/v1/admin/compliance/privacy-requests/{request_id}/execute");
    let (status, body) = json_request(
        &app,
        "POST",
        &execute_path,
        &auth_header_for(it_admin_id, "it_admin"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{body}");
    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/admin/compliance/privacy-requests/{request_id}/step"),
        &auth_header_for(it_admin_id, "it_admin"),
        Some(json!({ "step": "verify_identity", "method": "callback" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (status, body) = json_request(
        &app,
        "POST",
        &execute_path,
        &auth_header_for(it_admin_id, "it_admin"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["request_type"], "erasure");
    assert_eq!(body["execution"]["mode"], "erasure");

    let patient_row = sqlx::query(
        r#"SELECT patient_id, first_name, last_name, email, is_active,
                  lifecycle_status, inactive_since IS NOT NULL AS has_inactive_since
           FROM patients
           WHERE id = $1"#,
    )
    .bind(patient_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    // is_active and the lifecycle stay in step: an erased file is inactive.
    assert_eq!(
        patient_row
            .try_get::<String, _>("lifecycle_status")
            .unwrap(),
        "inactive"
    );
    assert!(
        patient_row
            .try_get::<bool, _>("has_inactive_since")
            .unwrap()
    );

    // The anonymised shell is neither reactivated nor edited.
    let ceo_auth = auth_header_for(admin_id, "ceo");
    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/patients/{patient_id}/activate"),
        &ceo_auth,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::LOCKED, "{body}");
    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/admin/compliance/privacy-requests/{request_id}/execute"),
        &auth_header_for(it_admin_id, "it_admin"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);

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
        r#"SELECT message, message_ciphertext, message_nonce,
                  e2e_algorithm, e2e_ciphertext, e2e_nonce, e2e_salt,
                  sender_key_fingerprint, recipient_key_fingerprint,
                  attachment_key, attachment_nonce, attachment_e2e_algorithm,
                  attachment_e2e_nonce, attachment_e2e_salt,
                  redacted_at, redaction_reason
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
    for field in [
        "message_ciphertext",
        "message_nonce",
        "e2e_ciphertext",
        "e2e_nonce",
        "e2e_salt",
        "attachment_nonce",
        "attachment_e2e_nonce",
        "attachment_e2e_salt",
    ] {
        assert_eq!(
            redacted_message
                .try_get::<Option<Vec<u8>>, _>(field)
                .unwrap(),
            None,
            "{field} must be cleared"
        );
    }
    for field in [
        "e2e_algorithm",
        "sender_key_fingerprint",
        "recipient_key_fingerprint",
        "attachment_e2e_algorithm",
    ] {
        assert_eq!(
            redacted_message
                .try_get::<Option<String>, _>(field)
                .unwrap(),
            None,
            "{field} must be cleared"
        );
    }
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

    let chat_notifications: i64 = sqlx::query_scalar(
        r#"SELECT count(*) FROM user_notifications
           WHERE entity_type = 'message_peer'
             AND kind IN ('direct_message', 'direct_message_attachment')
             AND (user_id = $1 OR entity_id = $1)"#,
    )
    .bind(patient_user_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(chat_notifications, 0);

    let audit_count = wait_for_patient_audit_actions(
        &pool,
        patient_id,
        4,
        &[
            "privacy_request_created",
            "privacy_request_reviewed",
            "privacy_request_executed",
            "dsgvo_anonymize",
        ],
    )
    .await;
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

    // The restriction is enforced, not just recorded: edits are locked …
    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/patients/{patient_a}/update"),
        &auth_header_for(pm_a, "patient_manager"),
        Some(json!({ "notes": "changed while restricted" })),
    )
    .await;
    assert_eq!(status, StatusCode::LOCKED);

    // … the patient's documents are kept unchanged (no edit, no file deletion) …
    let document_id = seed_document(&pool, patient_a, pm_a, &tag, "internal").await;
    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/documents/{document_id}/update"),
        &auth_header_for(pm_a, "patient_manager"),
        Some(json!({ "notes": "changed while restricted" })),
    )
    .await;
    assert_eq!(status, StatusCode::LOCKED, "{body}");
    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/documents/{document_id}/delete"),
        &auth_header_for(pm_a, "patient_manager"),
        Some(json!({ "reason": "cleanup while restricted" })),
    )
    .await;
    assert_eq!(status, StatusCode::LOCKED, "{body}");

    // … but taking access away stays possible: it only narrows processing.
    let interpreter = seed_user(&pool, &format!("{tag}-int"), "interpreter").await;
    seed_patient_assignment(&pool, patient_a, interpreter, admin_id).await;
    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/patients/{patient_a}/revoke"),
        &auth_header_for(pm_a, "patient_manager"),
        Some(json!({ "user_id": interpreter })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/patients/{patient_a}/assignments"),
        &auth_header_for(pm_a, "patient_manager"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let revoked = body
        .as_array()
        .expect("assignments")
        .iter()
        .find(|row| row["user_id"] == interpreter.to_string())
        .expect("revoked interpreter link");
    assert!(revoked["revoked_at"].is_string());
    assert_eq!(revoked["source"], "manual");

    // … lifting needs a reason …
    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/admin/compliance/patient/{patient_a}/restriction/lift"),
        &auth_header_for(it_admin_id, "it_admin"),
        Some(json!({ "reason": "short" })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/admin/compliance/patient/{patient_a}/restriction/lift"),
        &auth_header_for(it_admin_id, "it_admin"),
        Some(json!({ "reason": "Accuracy check finished, patient informed by e-mail" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["restricted"], false);

    // … and afterwards the record is editable again.
    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/patients/{patient_a}/update"),
        &auth_header_for(pm_a, "patient_manager"),
        Some(json!({ "notes": "changed after lifting" })),
    )
    .await;
    assert_ne!(status, StatusCode::LOCKED);

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
    support::seed_active_portal_subscription(&pool, patient_id, admin_id).await;
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
    // The withdrawn DSGVO data transfer and Schweigepflichtsentbindung untick
    // their legal-status items until consents signed later exist (owner
    // decision 2026-10-12).
    assert_eq!(legal_status["dsgvo_signed"], false, "{legal_status}");
    assert_eq!(
        legal_status["confidentiality_release_signed"], false,
        "{legal_status}"
    );
    assert!(legal_status["dsgvo_revoked_at"].is_string());
    assert!(legal_status["confidentiality_release_revoked_at"].is_string());

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
    assert_eq!(
        status,
        StatusCode::OK,
        "allowed peers response: {peers_body:?}"
    );
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

    support::wait_until("third_party_revoke consent_revoked audit", || async {
        let count: i64 = sqlx::query_scalar(
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
        count >= 1
    })
    .await;
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

    support::wait_until(
        "third_party_revoke revoke_document_share_bundle audit",
        || async {
            let count: i64 = sqlx::query_scalar(
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
            count >= 1
        },
    )
    .await;
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
async fn it_admin_picks_dsgvo_patients_by_number_and_name_only() {
    // QA E-41 (2026-10-11): the IT admin handles data-subject requests but
    // has no patient access; its picker gets the number and the name only.
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };
    let tag = unique_tag("dsgvo-lookup");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let it_admin = auth_header_for(seed_user(&pool, &tag, "it_admin").await, "it_admin");

    let (status, _) = json_request(&app, "GET", "/api/v1/patients", &it_admin, None).await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    let (status, rows) = json_request(
        &app,
        "GET",
        &format!("/api/v1/admin/compliance/patient-lookup?search={tag}"),
        &it_admin,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{rows}");
    let rows = rows.as_array().expect("rows");
    assert_eq!(rows.len(), 1, "{rows:?}");
    let row = rows[0].as_object().expect("row");
    assert_eq!(row["id"], json!(patient_id));
    assert_eq!(row["patient_id"], json!(format!("PT-{tag}")));
    let mut keys: Vec<&str> = row.keys().map(String::as_str).collect();
    keys.sort_unstable();
    assert_eq!(keys, ["first_name", "id", "last_name", "patient_id"]);

    let sales = auth_header_for(
        seed_user(&pool, &format!("{tag}-s"), "sales").await,
        "sales",
    );
    let (status, _) = json_request(
        &app,
        "GET",
        "/api/v1/admin/compliance/patient-lookup",
        &sales,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
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

#[tokio::test]
async fn access_request_is_fulfilled_manually_and_records_the_art_12_steps() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("privacy-access");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let pm_id = seed_user(&pool, &tag, "patient_manager").await;
    seed_patient_assignment(&pool, patient_id, pm_id, admin_id).await;
    let pm = auth_header_for(pm_id, "patient_manager");

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/admin/compliance/patient/{patient_id}/privacy-requests"),
        &pm,
        Some(json!({ "request_type": "access", "reason": "Patient asked for a copy by letter" })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let request_id = body["id"].as_str().expect("request id").to_string();
    let step_path = format!("/api/v1/admin/compliance/privacy-requests/{request_id}/step");

    let (status, _) = json_request(
        &app,
        "POST",
        &step_path,
        &pm,
        Some(json!({ "step": "verify_identity", "method": "id_document" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    // An extension needs a reason and is granted only once.
    let (status, _) = json_request(
        &app,
        "POST",
        &step_path,
        &pm,
        Some(json!({ "step": "extend_deadline" })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    let extension = json!({ "step": "extend_deadline", "note": "Archive boxes must be retrieved" });
    let (status, _) = json_request(&app, "POST", &step_path, &pm, Some(extension.clone())).await;
    assert_eq!(status, StatusCode::OK);
    let (status, _) = json_request(&app, "POST", &step_path, &pm, Some(extension)).await;
    assert_eq!(status, StatusCode::CONFLICT);

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/admin/compliance/privacy-requests/{request_id}/review"),
        &pm,
        Some(json!({ "action": "approve" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    // A patient manager may close an access request; the record is untouched.
    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/admin/compliance/privacy-requests/{request_id}/execute"),
        &pm,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["execution"]["mode"], "manual_fulfilment");

    let still_active: bool = sqlx::query_scalar("SELECT is_active FROM patients WHERE id = $1")
        .bind(patient_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert!(still_active);

    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/admin/compliance/patient/{patient_id}/privacy-requests"),
        &pm,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let record = &body.as_array().expect("requests")[0];
    assert_eq!(record["identity_verification"]["method"], "id_document");
    assert_eq!(record["deadline_extension"]["days"], 60);
}

#[tokio::test]
async fn incident_register_tracks_the_72_hour_decision() {
    let Some((app, pool, _admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("incident");
    let interpreter = seed_user(&pool, &format!("{tag}-int"), "interpreter").await;
    let it_admin = seed_user(&pool, &format!("{tag}-it"), "it_admin").await;
    let reporter = auth_header_for(interpreter, "interpreter");
    let manager = auth_header_for(it_admin, "it_admin");

    // Any member of staff can report, but only compliance reads the register.
    let (status, body) = json_request(
        &app,
        "POST",
        "/api/v1/admin/compliance/incidents",
        &reporter,
        Some(json!({
            "title": format!("Report sent to the wrong clinic {tag}"),
            "description": "A discharge letter went to the wrong provider by e-mail.",
            "category": "confidentiality",
            "severity": "high",
            "affected_subjects_count": 1
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let incident_id = body["id"].as_str().expect("incident id").to_string();
    assert!(body["reference"].as_str().unwrap().starts_with("INC-"));

    let (status, _) = json_request(
        &app,
        "GET",
        "/api/v1/admin/compliance/incidents",
        &reporter,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    // Closing without the report or the reason for not reporting is refused.
    let path = format!("/api/v1/admin/compliance/incidents/{incident_id}");
    let (status, _) = json_request(
        &app,
        "POST",
        &path,
        &manager,
        Some(json!({ "status": "closed" })),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);

    let (status, body) = json_request(
        &app,
        "POST",
        &path,
        &manager,
        Some(json!({
            "status": "closed",
            "risk_assessment": "no_risk",
            "no_notification_reason": "Recipient is bound by medical secrecy and deleted the letter"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["status"], "closed");
    assert_eq!(body["notification_decision_documented"], true);
    assert_eq!(body["authority_deadline_missed"], false);
}

/// QA B-23 a: requests take the snapshot of the patient's retention; an
/// erasure is neither approved nor executed (nor run through the direct
/// endpoint) while the medical documentation must be kept (§ 630f BGB,
/// Art. 17 Abs. 3 lit. b DSGVO); holding it restricts processing instead.
#[tokio::test]
async fn erasure_waits_for_the_clinical_retention_and_restricts_processing_instead() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("privacy-retention");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let patient_user_id = seed_user(&pool, &format!("{tag}-patient"), "patient").await;
    let pm_id = seed_user(&pool, &tag, "patient_manager").await;
    let it_admin_id = seed_user(&pool, &tag, "it_admin").await;
    seed_patient_assignment(&pool, patient_id, patient_user_id, admin_id).await;
    seed_patient_assignment(&pool, patient_id, pm_id, admin_id).await;
    let pm = auth_header_for(pm_id, "patient_manager");
    let it = auth_header_for(it_admin_id, "it_admin");
    let ceo = auth_header_for(admin_id, "ceo");

    // A clinical entry keeps the medical documentation for decades.
    let retention_until: chrono::DateTime<chrono::Utc> = sqlx::query_scalar(
        r#"UPDATE patients
           SET clinical_retention_until = date_trunc('second', now()) + interval '30 years'
           WHERE id = $1
           RETURNING clinical_retention_until"#,
    )
    .bind(patient_id)
    .fetch_one(&pool)
    .await
    .unwrap();

    // Filed in the portal and recorded by staff: both inherit the snapshot.
    let (status, body) = json_request(
        &app,
        "POST",
        "/api/v1/me/privacy-requests",
        &auth_header_for(patient_user_id, "patient"),
        Some(json!({ "request_type": "erasure", "reason": "Please delete my data" })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    let erasure_id = Uuid::parse_str(body["id"].as_str().unwrap()).unwrap();
    let snapshot: Option<chrono::DateTime<chrono::Utc>> =
        sqlx::query_scalar("SELECT retention_until FROM patient_privacy_requests WHERE id = $1")
            .bind(erasure_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(snapshot, Some(retention_until));
    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/admin/compliance/patient/{patient_id}/privacy-requests"),
        &pm,
        Some(json!({ "request_type": "access", "source": "patient_request" })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    assert!(body["retention_until"].is_string(), "{body}");
    assert_eq!(body["created_via"], "admin_compliance_workspace");

    // The patient's history lists both; the erasure is marked as blocked.
    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/admin/compliance/patient/{patient_id}/privacy-requests"),
        &pm,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let history = body.as_array().expect("privacy request history");
    assert_eq!(history.len(), 2, "{body}");
    let erasure = history
        .iter()
        .find(|row| row["id"] == erasure_id.to_string())
        .expect("erasure in history");
    assert_eq!(erasure["erasure_blocked_by_retention"], true);
    assert_eq!(erasure["created_via"], "patient_self_service");
    assert!(erasure["patient_retention_until"].is_string());

    // Approving is refused with the date and the legal basis.
    let review = format!("/api/v1/admin/compliance/privacy-requests/{erasure_id}/review");
    let (status, body) = json_request(
        &app,
        "POST",
        &review,
        &it,
        Some(json!({ "action": "approve" })),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{body}");
    assert_eq!(body["error"], "erasure_blocked_by_retention");
    let display = body["retention_until_display"].as_str().unwrap();
    assert_eq!(display.len(), 10, "{display}");
    assert_eq!(&display[2..3], ".");
    assert!(body["legal_basis"].as_str().unwrap().contains("630f"));

    // The old direct endpoint is retired: no erasure outside the register,
    // and nothing is recorded.
    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/admin/compliance/patient/{patient_id}/anonymize"),
        &ceo,
        None,
    )
    .await;
    assert!(
        matches!(
            status,
            StatusCode::NOT_FOUND | StatusCode::METHOD_NOT_ALLOWED
        ),
        "{status} {body}"
    );
    let erasure_requests: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM patient_privacy_requests WHERE patient_id = $1 AND request_type = 'erasure'",
    )
    .bind(patient_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(erasure_requests, 1);

    // An erasure approved before the clinical entry is not executed either.
    sqlx::query(
        r#"UPDATE patient_privacy_requests
           SET status = 'approved',
               context = context || jsonb_build_object(
                   'identity_verification',
                   jsonb_build_object('method', 'callback', 'at', now()))
           WHERE id = $1"#,
    )
    .bind(erasure_id)
    .execute(&pool)
    .await
    .unwrap();
    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/admin/compliance/privacy-requests/{erasure_id}/execute"),
        &it,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{body}");
    assert_eq!(body["error"], "erasure_blocked_by_retention");
    let (first_name, anonymized, request_status): (String, bool, String) = sqlx::query_as(
        r#"SELECT p.first_name, (p.legal_status->>'anonymized_at') IS NOT NULL, pr.status
           FROM patients p
           JOIN patient_privacy_requests pr ON pr.patient_id = p.id
           WHERE pr.id = $1"#,
    )
    .bind(erasure_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(first_name, format!("First {tag}"));
    assert!(!anonymized);
    assert_eq!(request_status, "approved");

    // Holding it until the retention ends restricts the processing instead.
    let reason = "Medical documentation must be kept (§ 630f BGB); processing is restricted.";
    let (status, body) = json_request(
        &app,
        "POST",
        &review,
        &it,
        Some(json!({ "action": "hold", "reason": reason })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["status"], "retention_hold");
    assert_eq!(body["is_overdue"], false);
    assert_eq!(body["decision_reason"], reason);
    let held_until: Option<chrono::DateTime<chrono::Utc>> =
        sqlx::query_scalar("SELECT retention_until FROM patient_privacy_requests WHERE id = $1")
            .bind(erasure_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(held_until, Some(retention_until));
    let legal_status: Value = sqlx::query_scalar("SELECT legal_status FROM patients WHERE id = $1")
        .bind(patient_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(
        legal_status["processing_restricted"], true,
        "{legal_status}"
    );
    assert_eq!(
        legal_status["processing_restriction_basis"],
        "erasure_retention_hold"
    );
    assert_eq!(
        legal_status["processing_restriction_request_id"],
        erasure_id.to_string()
    );

    // A second request of the same type is refused with a code the UI translates.
    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/admin/compliance/patient/{patient_id}/privacy-requests"),
        &pm,
        Some(json!({ "request_type": "erasure", "source": "admin_intake" })),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{body}");
    assert_eq!(body["error"], "privacy_request_open_exists");
}

/// QA B-23 addendum: the erasure leaves no name or content on the patient's
/// documents (generated name, file name, people named on it, extracted text,
/// template bindings, translations, import drafts), removes the extra
/// contacts and the notifications that name the patient and switches the
/// portal login off. Invoices keep their documents (§ 147 AO).
#[tokio::test]
async fn erasure_removes_names_and_content_from_the_patients_documents() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("privacy-erase-docs");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let patient_user_id = seed_user(&pool, &format!("{tag}-patient"), "patient").await;
    let pm_id = seed_user(&pool, &tag, "patient_manager").await;
    seed_patient_assignment(&pool, patient_id, patient_user_id, admin_id).await;
    seed_patient_assignment(&pool, patient_id, pm_id, admin_id).await;
    let person = format!("First {tag} Last {tag}");

    let insert_document = |art: &'static str, category: &'static str, with_file: bool| {
        let person = person.clone();
        let pool = pool.clone();
        async move {
            let id = Uuid::new_v4();
            sqlx::query(
                r#"INSERT INTO documents (
                        id, patient_id, auto_name, original_filename, art, category, status,
                        visibility, is_medical, mime_type, file_size, storage_key,
                        version_root_document_id, version_number, uploaded_by, notes,
                        addressee_person, source_person, extracted_text, text_extraction_status,
                        generated_bindings, generated_manual_text,
                        file_deleted_at, file_delete_reason
                   ) VALUES (
                        $1, $2, $3, $4, $5, $6, 'active',
                        'internal', false, 'application/pdf', 10, $7,
                        $1, 1, $8, $9,
                        $10, 'Dr. Beispiel', $11, 'completed',
                        jsonb_build_object('patient_name', $10::text), $11,
                        $12, $13
                   )"#,
            )
            .bind(id)
            .bind(patient_id)
            .bind(format!("{art} {person}"))
            .bind(format!("{art}-{person}.pdf"))
            .bind(art)
            .bind(category)
            .bind(with_file.then(|| format!("{id}_synthetic.pdf")))
            .bind(admin_id)
            .bind(format!("Notes about {person}"))
            .bind(&person)
            .bind(format!("Name: {person}"))
            .bind((!with_file).then(chrono::Utc::now))
            .bind((!with_file).then_some("earlier deletion"))
            .execute(&pool)
            .await
            .unwrap();
            id
        }
    };
    let sticker = insert_document("patient_sticker_compact", "administrative", true).await;
    let earlier_deleted = insert_document("medical_report", "medical", false).await;
    let invoice = insert_document("invoice_document", "invoice", true).await;

    let translation_request: Uuid = sqlx::query_scalar(
        r#"INSERT INTO document_translation_requests (
                document_id, patient_id, requested_language, requested_by, status,
                source_text, translated_text
           ) VALUES ($1, $2, 'ru', $3, 'completed', $4, $4)
           RETURNING id"#,
    )
    .bind(sticker)
    .bind(patient_id)
    .bind(admin_id)
    .bind(format!("Name: {person}"))
    .fetch_one(&pool)
    .await
    .unwrap();
    // The translation generated as a document of its own; it names no patient
    // (as one made from a lead's document), so only its source leads to it.
    let translated_document = Uuid::new_v4();
    sqlx::query(
        r#"INSERT INTO documents (
                id, auto_name, original_filename, art, category, status, visibility,
                is_medical, mime_type, file_size, storage_key, version_root_document_id,
                version_number, uploaded_by, generated_manual_text, ursprung
           ) VALUES (
                $1, $2, 'translation-ru.pdf', 'translated_document', 'translation', 'active',
                'internal', false, 'application/pdf', 10, $3, $1, 1, $4, $5,
                'document_translation'
           )"#,
    )
    .bind(translated_document)
    .bind(format!("Translation RU - {person}"))
    .bind(format!("{translated_document}_synthetic.pdf"))
    .bind(admin_id)
    .bind(format!("Имя: {person}"))
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        r#"INSERT INTO document_translations (
                document_id, target_language, provider, source_text, translated_text,
                translated_document_id, created_by
           ) VALUES ($1, 'ru', 'manual', $2, $2, $3, $4)"#,
    )
    .bind(sticker)
    .bind(format!("Name: {person}"))
    .bind(translated_document)
    .bind(admin_id)
    .execute(&pool)
    .await
    .unwrap();

    // Relations: a relative no business record names, and the father who
    // pays the order (Kostenträger of the business record).
    let relative: Uuid = sqlx::query_scalar(
        r#"INSERT INTO patient_relations (
                patient_id, related_name, relation_type, is_emergency_contact, phone, notes,
                email, address_street, address_city, address_zip, address_country
           ) VALUES ($1, 'Ben Muster', 'spouse', true, '+49 30 1111111', 'Calls in the evening',
                     'ben.muster@example.com', 'Musterweg 1', 'Berlin', '10115', 'DE')
           RETURNING id"#,
    )
    .bind(patient_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    let payer: Uuid = sqlx::query_scalar(
        r#"INSERT INTO patient_relations (
                patient_id, related_name, relation_type, is_emergency_contact, phone, notes,
                email, address_street, address_city, address_zip, address_country,
                is_default_payer
           ) VALUES ($1, 'Viktor Zahler', 'parent', true, '+49 30 2222222', 'Pays by transfer',
                     'viktor.zahler@example.com', 'Zahlerstraße 2', 'Köln', '50667', 'DE', true)
           RETURNING id"#,
    )
    .bind(patient_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    // A completed order: an open one would hold the erasure (audit item 6).
    let order_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO orders (order_number, patient_id, phase, status, created_by,
                               payer_patient_relation_id)
           VALUES ($1, $2, 'closure', 'completed', $3, $4)
           RETURNING id"#,
    )
    .bind(format!("ORD-{tag}"))
    .bind(patient_id)
    .bind(admin_id)
    .bind(payer)
    .fetch_one(&pool)
    .await
    .unwrap();
    // The order preparation keeps copies of the record and the identity.
    let facts = json!({
        "insurance_type": "private",
        "insurance_provider": "Beispiel Versicherung",
        "insurance_number": "A123456789",
        "phone_primary": "+49 30 1234567",
        "email": format!("{tag}@example.com"),
        "address_street": "Musterweg 1",
        "address_city": "Berlin",
        "address_zip": "10115",
        "address_country": "DE",
        "pep_contract_partner": false,
        "pep_beneficial_owner": false,
        "pep_office": "",
        "pep_asset_origin": "",
        "representative_name": "Viktor Zahler",
        "representative_phone": "+49 30 2222222",
        "representative_authority": "parent",
    });
    let identity =
        json!({ "first_name": format!("First {tag}"), "last_name": format!("Last {tag}") });
    sqlx::query(
        r#"INSERT INTO order_intakes (
                order_id, data, prepared_data, baseline_facts, confirmed_facts, confirmation_snapshot
           ) VALUES ($1, $2, $2, $3, $3, $4)"#,
    )
    .bind(order_id)
    .bind(json!({ "facts": facts, "needs_description": "Check-up" }))
    .bind(&facts)
    .bind(json!({
        "context": { "data": { "facts": facts }, "facts": facts, "identity": identity },
        "checks": [],
    }))
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        r#"INSERT INTO order_intake_fact_reviews (order_id, before_facts, after_facts, confirmed_by)
           VALUES ($1, $2, $2, $3)"#,
    )
    .bind(order_id)
    .bind(&facts)
    .bind(admin_id)
    .execute(&pool)
    .await
    .unwrap();
    // The order document is kept (§ 257 HGB); its stored context is not.
    let order_document = Uuid::new_v4();
    sqlx::query(
        r#"INSERT INTO documents (
                id, patient_id, order_id, auto_name, original_filename, art, category, status,
                visibility, is_medical, mime_type, file_size, storage_key,
                version_root_document_id, version_number, uploaded_by, order_intake_context
           ) VALUES (
                $1, $2, $3, 'Einzelauftrag', 'einzelauftrag.pdf', 'single_order', 'order',
                'active', 'internal', false, 'application/pdf', 10, $4, $1, 1, $5, $6
           )"#,
    )
    .bind(order_document)
    .bind(patient_id)
    .bind(order_id)
    .bind(format!("{order_document}_synthetic.pdf"))
    .bind(admin_id)
    .bind(json!({ "order_id": order_id, "facts": facts, "identity": identity, "data": { "facts": facts } }))
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        r#"INSERT INTO clinical_document_imports (patient_id, document_id, requested_by, status, draft)
           VALUES ($1, $2, $3, 'applied', jsonb_build_object('candidates',
                   jsonb_build_array(jsonb_build_object('text', $4::text)), 'warnings', '[]'::jsonb))"#,
    )
    .bind(patient_id)
    .bind(earlier_deleted)
    .bind(admin_id)
    .bind(&person)
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO patient_contacts (patient_id, contact_kind, value) VALUES ($1, 'email', $2)",
    )
    .bind(patient_id)
    .bind(format!("{tag}@example.com"))
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        r#"INSERT INTO user_notifications (user_id, kind, title, body, entity_type, entity_id)
           VALUES ($1, 'privacy_request', $2, 'Due soon', 'patient', $3)"#,
    )
    .bind(pm_id)
    .bind(format!("Patient GDPR request: {person}"))
    .bind(patient_id)
    .execute(&pool)
    .await
    .unwrap();

    // Free text of tasks and appointments names the patient (audit item 1/15).
    let appointment_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO appointments (patient_id, appointment_type, title, date, status, notes, created_by)
           VALUES ($1, 'medical', $2, CURRENT_DATE + 7, 'planned', $3, $4)
           RETURNING id"#,
    )
    .bind(patient_id)
    .bind(format!("Kardiologie {person}"))
    .bind(format!("Patient {person}, mail {tag}@example.com, PT-{tag}"))
    .bind(admin_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    let task_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO tasks (title, description, assigned_to, assigned_by, patient_id,
                              appointment_id, due_date)
           VALUES ($1, $2, $3, $3, $4, $5, now() + interval '2 days')
           RETURNING id"#,
    )
    .bind(format!("Call {person}"))
    .bind(format!("Reminder for Last {tag}: bring the passport"))
    .bind(admin_id)
    .bind(patient_id)
    .bind(appointment_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    sqlx::query(
        r#"INSERT INTO concierge_operational_task_comments (task_id, body, created_by, request_id)
           VALUES ($1, $2, $3, gen_random_uuid())"#,
    )
    .bind(task_id)
    .bind(format!("{person} asked for a taxi"))
    .bind(admin_id)
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        r#"INSERT INTO patient_appointment_requests (patient_id, requested_by, appointment_type, reason)
           VALUES ($1, $2, 'medical', $3)"#,
    )
    .bind(patient_id)
    .bind(patient_user_id)
    .bind(format!("Termin für {person}"))
    .execute(&pool)
    .await
    .unwrap();
    // A checklist item near its limit repeats a short phone number: with the
    // longer label in its place the text is cut to the 500 characters the
    // column allows, and the erasure does not fail on it.
    let short_phone = format!("+{}", 100_000_000 + Uuid::new_v4().as_u128() % 900_000_000);
    sqlx::query(
        "INSERT INTO patient_contacts (patient_id, contact_kind, value) VALUES ($1, 'phone', $2)",
    )
    .bind(patient_id)
    .bind(&short_phone)
    .execute(&pool)
    .await
    .unwrap();
    let long_label = vec![short_phone.clone(); 45].join(" ");
    assert!(long_label.chars().count() <= 500);
    sqlx::query(
        r#"INSERT INTO concierge_operational_task_checklist_items (task_id, label, created_by, request_id)
           VALUES ($1, $2, $3, gen_random_uuid())"#,
    )
    .bind(task_id)
    .bind(&long_label)
    .bind(admin_id)
    .execute(&pool)
    .await
    .unwrap();
    // A file attached to the task: the stored file goes, the row stays as the
    // record that a file was there, without the name.
    let attachment_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO concierge_operational_task_attachments (
                task_id, file_name, mime_type, file_size, storage_key,
                file_nonce, encryption_key_id, uploaded_by
           ) VALUES ($1, $2, 'application/pdf', 10, $3, '\x00'::bytea, 'test', $4)
           RETURNING id"#,
    )
    .bind(task_id)
    .bind(format!("Befund {person}.pdf"))
    .bind(format!("synthetic/{tag}-task-attachment.pdf"))
    .bind(admin_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    // The task history (append-only) keeps an edited comment's earlier text
    // and the attachment name; the erasure may change the text values only.
    let comment_ref = Uuid::new_v4();
    let history_event: Uuid = sqlx::query_scalar(
        r#"INSERT INTO concierge_operational_task_events (task_id, event_type, actor_id, payload)
           VALUES ($1, 'comment_edited', $2, $3) RETURNING id"#,
    )
    .bind(task_id)
    .bind(admin_id)
    .bind(json!({
        "comment_id": comment_ref,
        "previous_body": format!("{person} called, mail {tag}@example.com"),
        "body": "Call back tomorrow",
        "attachments": [{ "file_name": format!("Befund {person}.pdf"), "file_size": 10 }],
        "edited": true,
    }))
    .fetch_one(&pool)
    .await
    .unwrap();
    // Shared internal notes link to no patient: the full name and the e-mail
    // address are replaced, a first name alone (anyone's) stays.
    let named_note: Uuid = sqlx::query_scalar(
        r#"INSERT INTO internal_notes (title, body, created_by, updated_by)
           VALUES ($1, $2, $3, $3) RETURNING id"#,
    )
    .bind(format!("Rückruf {person}"))
    .bind(format!("Mail an {tag}@example.com senden"))
    .bind(admin_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    let first_name_note: Uuid = sqlx::query_scalar(
        r#"INSERT INTO internal_notes (title, body, created_by, updated_by)
           VALUES ($1, NULL, $2, $2) RETURNING id"#,
    )
    .bind(format!("Dienstplan First {tag}"))
    .bind(admin_id)
    .fetch_one(&pool)
    .await
    .unwrap();

    // Another patient's file names the erased person: as a spouse (nothing
    // else names that relation) and as the payer of his completed order.
    let other_patient = seed_patient(&pool, admin_id, &format!("{tag}-other")).await;
    let mut linked = Vec::new();
    for (relation_type, phone) in [("spouse", "+49 30 3333333"), ("relative", "+49 30 4444444")] {
        let relation_id: Uuid = sqlx::query_scalar(
            r#"INSERT INTO patient_relations (
                    patient_id, related_patient_id, related_name, relation_type,
                    is_emergency_contact, phone, notes, email, address_street
               ) VALUES ($1, $2, $3, $4, true, $5, 'Synthetic note', 'linked@example.com',
                         'Musterweg 1')
               RETURNING id"#,
        )
        .bind(other_patient)
        .bind(patient_id)
        .bind(&person)
        .bind(relation_type)
        .bind(phone)
        .fetch_one(&pool)
        .await
        .unwrap();
        linked.push(relation_id);
    }
    let (linked_spouse, linked_payer) = (linked[0], linked[1]);
    sqlx::query(
        r#"INSERT INTO orders (order_number, patient_id, phase, status, created_by,
                               payer_patient_relation_id)
           VALUES ($1, $2, 'closure', 'completed', $3, $4)"#,
    )
    .bind(format!("ORD-{tag}-other"))
    .bind(other_patient)
    .bind(admin_id)
    .bind(linked_payer)
    .execute(&pool)
    .await
    .unwrap();

    // The erasure runs through the register only (the direct endpoint is
    // retired): recorded, approved and executed by the CEO.
    let body = erase_through_register(&app, patient_id, &auth_header_for(admin_id, "ceo")).await;
    assert_eq!(body["execution"]["erased_documents"], 2, "{body}");
    assert_eq!(body["execution"]["disabled_portal_accounts"], 1, "{body}");
    assert_eq!(
        body["execution"]["erased_document_content"]["translated_documents"], 1,
        "{body}"
    );
    assert_eq!(
        body["execution"]["erased_relations"],
        json!({
            "removed": 1,
            "kept_for_business_records": 1,
            "linked_removed": 1,
            "linked_kept": 1,
        }),
        "{body}"
    );
    // Tasks and appointments keep dates and statuses; the patient is the
    // anonymised label in their text.
    let anon = body["execution"]["anonymized_name"]
        .as_str()
        .unwrap()
        .to_string();
    let scrubbed = &body["execution"]["scrubbed_free_text"];
    for (counter, expected) in [
        ("tasks", 1),
        ("task_comments", 1),
        ("task_checklist_items", 1),
        ("appointments", 1),
        ("appointment_requests", 1),
        ("internal_notes", 1),
        ("task_attachments_deleted", 1),
    ] {
        assert_eq!(scrubbed[counter], expected, "{counter}: {scrubbed}");
    }
    let label: String = sqlx::query_scalar(
        "SELECT label FROM concierge_operational_task_checklist_items WHERE task_id = $1",
    )
    .bind(task_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(label.chars().count(), 500, "{label}");
    assert!(label.starts_with(&format!("{anon} {anon} ")), "{label}");
    assert!(!label.contains(&short_phone), "{label}");
    let attachment = sqlx::query(
        r#"SELECT file_name, mime_type, file_size, deleted_at IS NOT NULL AS deleted, deleted_by
           FROM concierge_operational_task_attachments WHERE id = $1"#,
    )
    .bind(attachment_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(attachment.get::<String, _>("file_name"), "erased-file.pdf");
    assert_eq!(attachment.get::<String, _>("mime_type"), "application/pdf");
    assert_eq!(attachment.get::<i64, _>("file_size"), 10);
    assert!(attachment.get::<bool, _>("deleted"));
    assert_eq!(
        attachment.get::<Option<Uuid>, _>("deleted_by"),
        Some(admin_id)
    );
    let named_note_row: (String, Option<String>) =
        sqlx::query_as("SELECT title, body FROM internal_notes WHERE id = $1")
            .bind(named_note)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(
        named_note_row,
        (
            format!("Rückruf {anon}"),
            Some(format!("Mail an {anon} senden"))
        )
    );
    let first_name_note_title: String =
        sqlx::query_scalar("SELECT title FROM internal_notes WHERE id = $1")
            .bind(first_name_note)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(first_name_note_title, format!("Dienstplan First {tag}"));
    assert!(
        scrubbed["task_events"].as_u64().unwrap_or_default() >= 1,
        "{scrubbed}"
    );
    let history_payload: Value =
        sqlx::query_scalar("SELECT payload FROM concierge_operational_task_events WHERE id = $1")
            .bind(history_event)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(
        history_payload,
        json!({
            "comment_id": comment_ref,
            "previous_body": format!("{anon} called, mail {anon}"),
            "body": "Call back tomorrow",
            "attachments": [{ "file_name": format!("Befund {anon}.pdf"), "file_size": 10 }],
            "edited": true,
        })
    );
    // The exception ends with the erasure: an ordinary update is refused.
    let refused = sqlx::query(
        r#"UPDATE concierge_operational_task_events
           SET payload = jsonb_set(payload, '{body}', '"changed"')
           WHERE id = $1"#,
    )
    .bind(history_event)
    .execute(&pool)
    .await
    .unwrap_err();
    assert!(refused.to_string().contains("append-only"), "{refused}");
    let (task_title, task_description, task_status, task_due): (
        String,
        Option<String>,
        String,
        Option<chrono::DateTime<chrono::Utc>>,
    ) = sqlx::query_as("SELECT title, description, status, due_date FROM tasks WHERE id = $1")
        .bind(task_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(task_title, format!("Call {anon}"));
    assert_eq!(
        task_description.as_deref(),
        Some(format!("Reminder for {anon}: bring the passport").as_str())
    );
    assert_eq!(task_status, "open");
    assert!(task_due.is_some());
    let comment: String = sqlx::query_scalar(
        "SELECT body FROM concierge_operational_task_comments WHERE task_id = $1",
    )
    .bind(task_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(comment, format!("{anon} asked for a taxi"));
    let (appointment_title, appointment_notes, appointment_status): (
        String,
        Option<String>,
        String,
    ) = sqlx::query_as("SELECT title, notes, status FROM appointments WHERE id = $1")
        .bind(appointment_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(appointment_title, format!("Kardiologie {anon}"));
    assert_eq!(
        appointment_notes.as_deref(),
        Some(format!("Patient {anon}, mail {anon}, {anon}").as_str())
    );
    assert_eq!(appointment_status, "planned");
    let request_reason: Option<String> =
        sqlx::query_scalar("SELECT reason FROM patient_appointment_requests WHERE patient_id = $1")
            .bind(patient_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(request_reason, Some(format!("Termin für {anon}")));

    // The other patient's file: the spouse entry is gone; the payer of his
    // order stays for that order, without phone and notes, unlinked from the
    // erased record (no released invoice froze it).
    let linked_rows = sqlx::query(
        "SELECT id, related_patient_id, phone, notes, is_emergency_contact FROM patient_relations WHERE id = ANY($1)",
    )
    .bind(vec![linked_spouse, linked_payer])
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(linked_rows.len(), 1);
    let linked_row = &linked_rows[0];
    assert_eq!(linked_row.get::<Uuid, _>("id"), linked_payer);
    assert_eq!(
        linked_row.get::<Option<Uuid>, _>("related_patient_id"),
        None
    );
    assert_eq!(linked_row.get::<Option<String>, _>("phone"), None);
    assert_eq!(linked_row.get::<Option<String>, _>("notes"), None);
    assert!(!linked_row.get::<bool, _>("is_emergency_contact"));
    assert_eq!(
        body["execution"]["erased_order_intake_facts"],
        json!({ "order_intakes": 1, "fact_reviews": 1, "document_contexts": 1 }),
        "{body}"
    );

    // The relative is gone; the payer of the order stays with the name and
    // billing address the business record needs, without phone and notes.
    let relations = sqlx::query(
        r#"SELECT id, related_name, phone, notes, address_street,
                  is_emergency_contact, is_default_payer
           FROM patient_relations WHERE patient_id = $1"#,
    )
    .bind(patient_id)
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(relations.len(), 1);
    let kept = &relations[0];
    assert_eq!(kept.get::<Uuid, _>("id"), payer);
    assert_ne!(kept.get::<Uuid, _>("id"), relative);
    assert_eq!(kept.get::<String, _>("related_name"), "Viktor Zahler");
    assert_eq!(kept.get::<Option<String>, _>("phone"), None);
    assert_eq!(kept.get::<Option<String>, _>("notes"), None);
    assert_eq!(
        kept.get::<Option<String>, _>("address_street").as_deref(),
        Some("Zahlerstraße 2")
    );
    assert!(!kept.get::<bool, _>("is_emergency_contact"));
    assert!(!kept.get::<bool, _>("is_default_payer"));
    let order_payer: Option<Uuid> =
        sqlx::query_scalar("SELECT payer_patient_relation_id FROM orders WHERE id = $1")
            .bind(order_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(order_payer, Some(payer));

    // The order preparation keeps no copy of the record or the identity; the
    // GwG answers and the order's content stay.
    let (data, prepared, baseline, confirmed, snapshot): (Value, Value, Value, Value, Value) =
        sqlx::query_as(
            r#"SELECT data, prepared_data, baseline_facts, confirmed_facts, confirmation_snapshot
               FROM order_intakes WHERE order_id = $1"#,
        )
        .bind(order_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    for stored in [
        &data["facts"],
        &prepared["facts"],
        &baseline,
        &confirmed,
        &snapshot["context"]["facts"],
        &snapshot["context"]["data"]["facts"],
    ] {
        for field in [
            "insurance_number",
            "email",
            "phone_primary",
            "address_street",
        ] {
            assert_eq!(stored[field], "", "{field} in {stored}");
        }
        assert_eq!(stored["representative_name"], "Viktor Zahler", "{stored}");
    }
    assert!(snapshot["context"]["identity"].is_null(), "{snapshot}");
    assert_eq!(data["needs_description"], "Check-up");
    let (before, after): (Value, Value) = sqlx::query_as(
        "SELECT before_facts, after_facts FROM order_intake_fact_reviews WHERE order_id = $1",
    )
    .bind(order_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        (&before["email"], &after["email"]),
        (&json!(""), &json!(""))
    );
    let (order_document_key, order_context): (Option<String>, Value) =
        sqlx::query_as("SELECT storage_key, order_intake_context FROM documents WHERE id = $1")
            .bind(order_document)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert!(order_document_key.is_some(), "the order document is kept");
    assert!(order_context["identity"].is_null(), "{order_context}");
    assert_eq!(order_context["facts"]["insurance_number"], "");
    assert_eq!(order_context["order_id"], order_id.to_string());

    // The translation generated from an erased document lost its file and text.
    let (translation_key, translation_text, translation_reason): (
        Option<String>,
        Option<String>,
        Option<String>,
    ) = sqlx::query_as(
        "SELECT storage_key, generated_manual_text, file_delete_reason FROM documents WHERE id = $1",
    )
    .bind(translated_document)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(translation_key, None);
    assert_eq!(translation_text, None);
    assert_eq!(
        translation_reason.as_deref(),
        Some("source_document_deleted")
    );

    let scrubbed = sqlx::query(
        r#"SELECT id, auto_name, original_filename, notes, addressee_person, source_person,
                  extracted_text, generated_bindings, generated_manual_text, storage_key,
                  file_deleted_at, file_delete_reason
           FROM documents
           WHERE id = ANY($1)"#,
    )
    .bind(vec![sticker, earlier_deleted])
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(scrubbed.len(), 2);
    for row in &scrubbed {
        let id: Uuid = row.get("id");
        let expected_name = if id == sticker {
            "patient_sticker_compact"
        } else {
            "medical_report"
        };
        assert_eq!(row.get::<String, _>("auto_name"), expected_name);
        for column in [
            "original_filename",
            "notes",
            "addressee_person",
            "source_person",
            "extracted_text",
            "generated_manual_text",
            "storage_key",
        ] {
            assert_eq!(
                row.get::<Option<String>, _>(column),
                None,
                "{column} of {expected_name}"
            );
        }
        assert_eq!(row.get::<Option<Value>, _>("generated_bindings"), None);
        assert!(
            row.get::<Option<chrono::DateTime<chrono::Utc>>, _>("file_deleted_at")
                .is_some()
        );
    }
    let sticker_reason = scrubbed
        .iter()
        .find(|row| row.get::<Uuid, _>("id") == sticker)
        .map(|row| row.get::<Option<String>, _>("file_delete_reason"))
        .unwrap();
    assert_eq!(sticker_reason.as_deref(), Some("dsgvo_erasure"));

    // The invoice keeps its document as it was (§ 147 AO).
    let (invoice_name, invoice_key): (String, Option<String>) =
        sqlx::query_as("SELECT auto_name, storage_key FROM documents WHERE id = $1")
            .bind(invoice)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(invoice_name, format!("invoice_document {person}"));
    assert!(invoice_key.is_some());

    let (source_text, translated_text): (Option<String>, Option<String>) = sqlx::query_as(
        "SELECT source_text, translated_text FROM document_translation_requests WHERE id = $1",
    )
    .bind(translation_request)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!((source_text, translated_text), (None, None));
    let stored_translation: String = sqlx::query_scalar(
        "SELECT translated_text FROM document_translations WHERE document_id = $1",
    )
    .bind(sticker)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(stored_translation, "");
    let draft: Value =
        sqlx::query_scalar("SELECT draft FROM clinical_document_imports WHERE document_id = $1")
            .bind(earlier_deleted)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(draft, json!({ "candidates": [], "warnings": [] }));

    let (contacts, notifications): (i64, i64) = sqlx::query_as(
        r#"SELECT (SELECT count(*) FROM patient_contacts WHERE patient_id = $1),
                  (SELECT count(*) FROM user_notifications
                   WHERE entity_type = 'patient' AND entity_id = $1)"#,
    )
    .bind(patient_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!((contacts, notifications), (0, 0));

    let (email, name, active): (String, String, bool) =
        sqlx::query_as("SELECT email, name, is_active FROM users WHERE id = $1")
            .bind(patient_user_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(email, format!("deleted-patient-{patient_user_id}@invalid"));
    assert_eq!(name, "Deleted patient");
    assert!(!active);
}

/// Audit 2026-10-01, item 6: an erasure is not executed while the business
/// with the patient is open — a running order, an invoice with an amount to
/// settle, an invoice draft. The refusal names them with a code the UI
/// translates; the request stays and the handler can hold or reject it.
/// Runs `statement` (binding `$1`) in a transaction with the erasure setting
/// on, as the erasure does; commits when it succeeds.
async fn update_task_history_in_erasure(
    pool: &PgPool,
    statement: &str,
    event_id: Uuid,
) -> Result<u64, sqlx::Error> {
    let mut tx = pool.begin().await.unwrap();
    sqlx::query("SELECT set_config('gmed.dsgvo_erasure', 'on', true)")
        .execute(&mut *tx)
        .await
        .unwrap();
    match sqlx::query(statement)
        .bind(event_id)
        .execute(&mut *tx)
        .await
    {
        Ok(done) => {
            tx.commit().await.unwrap();
            Ok(done.rows_affected())
        }
        Err(error) => {
            let _ = tx.rollback().await;
            Err(error)
        }
    }
}

#[tokio::test]
async fn task_history_stays_append_only_except_for_text_in_the_erasure() {
    let Some((_app, pool, admin_id)) = test_context().await else {
        return;
    };
    let tag = unique_tag("task-history-append-only");
    let task_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO tasks (title, assigned_to, assigned_by, status)
           VALUES ($1, $2, $2, 'open') RETURNING id"#,
    )
    .bind(format!("Call {tag}"))
    .bind(admin_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    let event_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO concierge_operational_task_events (task_id, event_type, actor_id, payload)
           VALUES ($1, 'comment_edited', $2, $3) RETURNING id"#,
    )
    .bind(task_id)
    .bind(admin_id)
    .bind(json!({ "previous_body": format!("Text {tag}"), "count": 1, "tags": ["a"] }))
    .fetch_one(&pool)
    .await
    .unwrap();
    let append_only = |error: sqlx::Error| {
        assert!(error.to_string().contains("append-only"), "{error}");
    };

    // Outside the erasure nothing changes, not even a text.
    append_only(
        sqlx::query(
            r#"UPDATE concierge_operational_task_events
               SET payload = jsonb_set(payload, '{previous_body}', '"changed"')
               WHERE id = $1"#,
        )
        .bind(event_id)
        .execute(&pool)
        .await
        .unwrap_err(),
    );
    // In the erasure: no other column, no number, no new or removed key, no
    // delete.
    for statement in [
        "UPDATE concierge_operational_task_events SET event_type = 'edited' WHERE id = $1",
        "UPDATE concierge_operational_task_events SET created_at = now() - interval '1 day' WHERE id = $1",
        r#"UPDATE concierge_operational_task_events SET payload = jsonb_set(payload, '{count}', '2') WHERE id = $1"#,
        r#"UPDATE concierge_operational_task_events SET payload = payload || '{"extra": "x"}' WHERE id = $1"#,
        "UPDATE concierge_operational_task_events SET payload = payload - 'tags' WHERE id = $1",
        r#"UPDATE concierge_operational_task_events SET payload = jsonb_set(payload, '{tags}', '["a", "b"]') WHERE id = $1"#,
        "DELETE FROM concierge_operational_task_events WHERE id = $1",
    ] {
        append_only(
            update_task_history_in_erasure(&pool, statement, event_id)
                .await
                .unwrap_err(),
        );
    }
    // Texts may change there, also inside an array.
    let changed = update_task_history_in_erasure(
        &pool,
        r#"UPDATE concierge_operational_task_events
           SET payload = jsonb_set(jsonb_set(payload, '{previous_body}', '"ANON-0000"'),
                                   '{tags,0}', '"b"')
           WHERE id = $1"#,
        event_id,
    )
    .await
    .unwrap();
    assert_eq!(changed, 1);
    let payload: Value =
        sqlx::query_scalar("SELECT payload FROM concierge_operational_task_events WHERE id = $1")
            .bind(event_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(
        payload,
        json!({ "previous_body": "ANON-0000", "count": 1, "tags": ["b"] })
    );
    // The setting ends with its transaction.
    append_only(
        sqlx::query(
            r#"UPDATE concierge_operational_task_events
               SET payload = jsonb_set(payload, '{previous_body}', '"again"')
               WHERE id = $1"#,
        )
        .bind(event_id)
        .execute(&pool)
        .await
        .unwrap_err(),
    );
    // The scrub helper cuts a changed text to the limit of its key and leaves
    // the rest alone.
    let scrubbed: Value = sqlx::query_scalar(
        r#"SELECT gmed_scrub_jsonb_text(
                  $1, '(^|[^[:alnum:]_])(Anna Muster)(?=[^[:alnum:]_]|$)', '\1ANON-12345678',
                  '{"label": 12}'::jsonb)"#,
    )
    .bind(json!({
        "label": "Anna Muster here",
        "other": "anna muster",
        "untouched": "Annamuster",
        "nested": [{ "label": "x" }, 3, null],
    }))
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        scrubbed,
        json!({
            "label": "ANON-1234567",
            "other": "ANON-12345678",
            "untouched": "Annamuster",
            "nested": [{ "label": "x" }, 3, null],
        })
    );
}

#[tokio::test]
async fn erasure_waits_for_open_orders_and_invoices() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };
    let tag = unique_tag("privacy-open-business");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let ceo = auth_header_for(admin_id, "ceo");
    let order_number = format!("ORD-{tag}");
    let order_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO orders (order_number, patient_id, phase, status, created_by)
           VALUES ($1, $2, 'execution', 'active', $3)
           RETURNING id"#,
    )
    .bind(&order_number)
    .bind(patient_id)
    .bind(admin_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    let invoice_number = format!("INV-{tag}");
    for (number, status) in [(Some(invoice_number.clone()), "sent"), (None, "draft")] {
        sqlx::query(
            r#"INSERT INTO invoices (
                    order_id, patient_id, invoice_number, invoice_type, status,
                    total_net, total_vat, total_gross, line_items, portal_visible, created_by
               ) VALUES ($1, $2, $3, 'final', $4, 30, 0, 30, '[]', true, $5)"#,
        )
        .bind(order_id)
        .bind(patient_id)
        .bind(number)
        .bind(status)
        .bind(admin_id)
        .execute(&pool)
        .await
        .unwrap();
    }

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/admin/compliance/patient/{patient_id}/privacy-requests"),
        &ceo,
        Some(json!({
            "request_type": "erasure",
            "source": "admin_intake",
            "reason": "Synthetic erasure with open business",
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    let request_id = body["id"].as_str().unwrap().to_string();
    let review = format!("/api/v1/admin/compliance/privacy-requests/{request_id}/review");
    let (status, body) = json_request(
        &app,
        "POST",
        &review,
        &ceo,
        Some(json!({ "action": "approve" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/admin/compliance/privacy-requests/{request_id}/execute"),
        &ceo,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{body}");
    assert_eq!(body["error"], "erasure_blocked_by_open_business");
    assert_eq!(body["open_orders"], json!([order_number]));
    assert_eq!(body["open_invoices"], json!([invoice_number]));
    assert_eq!(body["open_invoice_drafts"], 1);
    assert_eq!(body["open_orders_label"], order_number);

    // Nothing changed: the record keeps its name, the request stays approved.
    let (first_name, anonymized, request_status): (String, bool, String) = sqlx::query_as(
        r#"SELECT p.first_name, (p.legal_status->>'anonymized_at') IS NOT NULL, pr.status
           FROM patients p
           JOIN patient_privacy_requests pr ON pr.patient_id = p.id
           WHERE pr.id = $1::uuid"#,
    )
    .bind(&request_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(first_name, format!("First {tag}"));
    assert!(!anonymized);
    assert_eq!(request_status, "approved");

    // The handler can still put it on hold with a reason.
    let (status, body) = json_request(
        &app,
        "POST",
        &review,
        &ceo,
        Some(json!({
            "action": "hold",
            "reason": "Order and invoice still open; erasure after settlement",
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["status"], "retention_hold");
}

/// QA 2026-10-12 B3-11: the CEO Assistant reads everything and writes
/// nothing — the DSGVO register (requests and their history, consents and
/// revocations, Art. 19 recipients, the incident register, the patient
/// lookup) answers its reads; every change stays refused.
#[tokio::test]
async fn ceo_assistant_reads_the_dsgvo_register_and_changes_nothing() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };
    let tag = unique_tag("b311");
    let assistant_id = seed_user(&pool, &tag, "ceo_assistant").await;
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let ceo = auth_header_for(admin_id, "ceo");
    let assistant = auth_header_for(assistant_id, "ceo_assistant");

    let (status, request) = json_request(
        &app,
        "POST",
        &format!("/api/v1/admin/compliance/patient/{patient_id}/privacy-requests"),
        &ceo,
        Some(json!({ "request_type": "access", "source": "patient_request" })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{request}");
    let request_id = request["id"].as_str().unwrap().to_string();
    let (status, consent) = json_request(
        &app,
        "POST",
        &format!("/api/v1/admin/compliance/patient/{patient_id}/consents"),
        &ceo,
        Some(json!({ "consent_type": "dsgvo_data_transfer", "action": "grant" })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{consent}");

    for path in [
        "/api/v1/admin/compliance/privacy-requests".to_string(),
        format!("/api/v1/admin/compliance/patient/{patient_id}/privacy-requests"),
        format!("/api/v1/admin/compliance/patient/{patient_id}/consents"),
        format!("/api/v1/admin/compliance/patient/{patient_id}/recipients"),
        "/api/v1/admin/compliance/consents".to_string(),
        "/api/v1/admin/compliance/consents/expired".to_string(),
        "/api/v1/admin/compliance/incidents".to_string(),
        format!("/api/v1/admin/compliance/patient-lookup?search=PT-{tag}"),
    ] {
        let (status, body) = json_request(&app, "GET", &path, &assistant, None).await;
        assert_eq!(status, StatusCode::OK, "{path}: {body}");
    }
    let (_, history) = json_request(
        &app,
        "GET",
        &format!("/api/v1/admin/compliance/patient/{patient_id}/privacy-requests"),
        &assistant,
        None,
    )
    .await;
    assert_eq!(history[0]["id"], request_id, "{history}");
    let (_, consents) = json_request(
        &app,
        "GET",
        &format!("/api/v1/admin/compliance/patient/{patient_id}/consents"),
        &assistant,
        None,
    )
    .await;
    assert_eq!(
        consents[0]["consent_type"], "dsgvo_data_transfer",
        "{consents}"
    );
    let (_, lookup) = json_request(
        &app,
        "GET",
        &format!("/api/v1/admin/compliance/patient-lookup?search=PT-{tag}"),
        &assistant,
        None,
    )
    .await;
    assert_eq!(lookup[0]["id"], patient_id.to_string(), "{lookup}");

    // Every write stays with the handlers.
    for (path, body) in [
        (
            format!("/api/v1/admin/compliance/patient/{patient_id}/privacy-requests"),
            json!({ "request_type": "erasure", "source": "patient_request" }),
        ),
        (
            format!("/api/v1/admin/compliance/patient/{patient_id}/consents"),
            json!({
                "consent_type": "dsgvo_data_transfer",
                "action": "revoke",
                "note": "E-Mail: Widerruf vom 12.10.2026",
            }),
        ),
        (
            format!("/api/v1/admin/compliance/privacy-requests/{request_id}/review"),
            json!({ "action": "approve" }),
        ),
        (
            format!("/api/v1/admin/compliance/privacy-requests/{request_id}/step"),
            json!({ "step": "verify_identity", "method": "id_document" }),
        ),
        (
            format!("/api/v1/admin/compliance/privacy-requests/{request_id}/execute"),
            json!({}),
        ),
        (
            format!("/api/v1/admin/compliance/patient/{patient_id}/restriction/lift"),
            json!({ "reason": "Synthetic lift of the restriction" }),
        ),
    ] {
        let (status, response) = json_request(&app, "POST", &path, &assistant, Some(body)).await;
        assert_eq!(status, StatusCode::FORBIDDEN, "{path}: {response}");
    }
    let (status, _) = json_request(
        &app,
        "GET",
        &format!("/api/v1/admin/compliance/patient/{patient_id}/export"),
        &assistant,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let open_requests: i64 =
        sqlx::query_scalar("SELECT count(*) FROM patient_privacy_requests WHERE patient_id = $1")
            .bind(patient_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(open_requests, 1);
}

#[tokio::test]
async fn erasure_cleans_source_lead_portal_choices_mail_uploads_and_guardians() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };
    let tag = unique_tag("source-lead-cleanup");
    let patient = seed_patient(&pool, admin_id, &tag).await;
    let guardian = seed_user(&pool, &format!("{tag}-parent"), "patient").await;
    let pm = seed_user(&pool, &tag, "patient_manager").await;
    seed_patient_assignment(&pool, patient, pm, admin_id).await;
    seed_patient_assignment(&pool, patient, guardian, admin_id).await;
    let lead:Uuid=sqlx::query_scalar("INSERT INTO leads(first_name,last_name,date_of_birth,qualification_status,converted_patient_id,created_by) VALUES('Synthetic','Child','2015-01-01','converted',$1,$2) RETURNING id").bind(patient).bind(pm).fetch_one(&pool).await.unwrap();
    sqlx::query("INSERT INTO lead_portal_access(lead_id,user_id,kind,trusted_contact_id,created_by) VALUES($1,$2,'guardian',$3,$4)").bind(lead).bind(guardian).bind(Uuid::new_v4()).bind(pm).execute(&pool).await.unwrap();
    sqlx::query("INSERT INTO consent_form_choices(template_id,lead_id,patient_id,choices,recipients,chosen_by,access_kind,source,language,text_version) VALUES('privacy_consents',$1,$2,'{}','[{\"name\":\"Private Recipient\"}]',$3,'guardian','lead_portal','de','2026-10-12')").bind(lead).bind(patient).bind(guardian).execute(&pool).await.unwrap();
    sqlx::query("INSERT INTO portal_login_emails(lead_id,user_id,recipient,language,status,sent_by) VALUES($1,$2,'private@example.com','de','failed',$3)").bind(lead).bind(guardian).bind(pm).execute(&pool).await.unwrap();
    let doc = Uuid::new_v4();
    sqlx::query("INSERT INTO documents(id,version_root_document_id,lead_id,auto_name,art,category,status,visibility,is_medical,uploaded_by) VALUES($3,$3,$1,'Private','report','medical','active','internal',true,$2)")
        .bind(lead).bind(guardian).bind(doc).execute(&pool).await.unwrap();
    sqlx::query("INSERT INTO lead_portal_uploads(document_id,lead_id,uploaded_by,access_kind,kind) VALUES($1,$2,$3,'guardian','medical')").bind(doc).bind(lead).bind(guardian).execute(&pool).await.unwrap();
    erase_through_register(&app, patient, &auth_header_for(admin_id, "ceo")).await;
    let counts:(i64,i64,i64,i64)=sqlx::query_as("SELECT (SELECT count(*) FROM consent_form_choices WHERE lead_id=$1),(SELECT count(*) FROM portal_login_emails WHERE lead_id=$1),(SELECT count(*) FROM lead_portal_uploads WHERE lead_id=$1),(SELECT count(*) FROM lead_portal_access WHERE lead_id=$1 AND revoked_at IS NULL)").bind(lead).fetch_one(&pool).await.unwrap();
    assert_eq!(counts, (0, 0, 0, 0));
    let active: bool = sqlx::query_scalar("SELECT is_active FROM users WHERE id=$1")
        .bind(guardian)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert!(!active);
}
