use axum::body::Body;
use axum::http::{Request, StatusCode};
use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};
use serde_json::{Value, json};
use sqlx::{PgPool, Row};
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
    .bind(format!("Portal document {tag}"))
    .bind(format!("{tag}.pdf"))
    .bind(visibility)
    .bind(uploaded_by)
    .bind(format!("Portal notes {tag}"))
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

async fn bytes_request(
    app: &axum::Router,
    method: &str,
    path: &str,
    bearer: &str,
) -> (StatusCode, Vec<u8>) {
    let request = Request::builder()
        .method(method)
        .uri(path)
        .header("Authorization", bearer)
        .body(Body::empty())
        .unwrap();

    let response = app.clone().oneshot(request).await.unwrap();
    let status = response.status();
    let bytes = axum::body::to_bytes(response.into_body(), 4 * 1024 * 1024)
        .await
        .unwrap();
    (status, bytes.to_vec())
}

async fn multipart_request(
    app: &axum::Router,
    path: &str,
    bearer: &str,
    file_content: &[u8],
    filename: &str,
    mime: &str,
    message: Option<&str>,
) -> (StatusCode, Value) {
    let boundary = "----TestBoundaryPortalMessages";
    let mut body = Vec::new();

    body.extend_from_slice(format!("--{boundary}\r\n").as_bytes());
    body.extend_from_slice(
        format!("Content-Disposition: form-data; name=\"file\"; filename=\"{filename}\"\r\n")
            .as_bytes(),
    );
    body.extend_from_slice(format!("Content-Type: {mime}\r\n\r\n").as_bytes());
    body.extend_from_slice(file_content);
    body.extend_from_slice(b"\r\n");

    if let Some(msg) = message {
        body.extend_from_slice(format!("--{boundary}\r\n").as_bytes());
        body.extend_from_slice(b"Content-Disposition: form-data; name=\"message\"\r\n\r\n");
        body.extend_from_slice(msg.as_bytes());
        body.extend_from_slice(b"\r\n");
    }

    body.extend_from_slice(format!("--{boundary}--\r\n").as_bytes());

    let request = Request::builder()
        .method("POST")
        .uri(path)
        .header("Authorization", bearer)
        .header(
            "Content-Type",
            format!("multipart/form-data; boundary={boundary}"),
        )
        .body(Body::from(body))
        .unwrap();

    let response = app.clone().oneshot(request).await.unwrap();
    let status = response.status();
    let bytes = axum::body::to_bytes(response.into_body(), 4 * 1024 * 1024)
        .await
        .unwrap();
    let payload = serde_json::from_slice(&bytes).unwrap_or(json!(null));
    (status, payload)
}

struct MultipartMessageUpload<'a> {
    file_content: &'a [u8],
    filename: &'a str,
    mime: &'a str,
    message: Option<&'a str>,
    extra_fields: &'a [(&'a str, &'a str)],
}

async fn multipart_request_with_extra_fields(
    app: &axum::Router,
    path: &str,
    bearer: &str,
    upload: MultipartMessageUpload<'_>,
) -> (StatusCode, Value) {
    let boundary = "----TestBoundaryPortalMessagesExtra";
    let mut body = Vec::new();

    body.extend_from_slice(format!("--{boundary}\r\n").as_bytes());
    body.extend_from_slice(
        format!(
            "Content-Disposition: form-data; name=\"file\"; filename=\"{}\"\r\n",
            upload.filename
        )
        .as_bytes(),
    );
    body.extend_from_slice(format!("Content-Type: {}\r\n\r\n", upload.mime).as_bytes());
    body.extend_from_slice(upload.file_content);
    body.extend_from_slice(b"\r\n");

    if let Some(msg) = upload.message {
        body.extend_from_slice(format!("--{boundary}\r\n").as_bytes());
        body.extend_from_slice(b"Content-Disposition: form-data; name=\"message\"\r\n\r\n");
        body.extend_from_slice(msg.as_bytes());
        body.extend_from_slice(b"\r\n");
    }

    for (name, value) in upload.extra_fields {
        body.extend_from_slice(format!("--{boundary}\r\n").as_bytes());
        body.extend_from_slice(
            format!("Content-Disposition: form-data; name=\"{name}\"\r\n\r\n").as_bytes(),
        );
        body.extend_from_slice(value.as_bytes());
        body.extend_from_slice(b"\r\n");
    }

    body.extend_from_slice(format!("--{boundary}--\r\n").as_bytes());

    let request = Request::builder()
        .method("POST")
        .uri(path)
        .header("Authorization", bearer)
        .header(
            "Content-Type",
            format!("multipart/form-data; boundary={boundary}"),
        )
        .body(Body::from(body))
        .unwrap();

    let response = app.clone().oneshot(request).await.unwrap();
    let status = response.status();
    let bytes = axum::body::to_bytes(response.into_body(), 4 * 1024 * 1024)
        .await
        .unwrap();
    let payload = serde_json::from_slice(&bytes).unwrap_or(json!(null));
    (status, payload)
}

async fn audit_contexts(pool: &PgPool, user_id: Uuid, peer_id: Uuid, action: &str) -> Vec<Value> {
    sqlx::query_scalar::<_, Value>(
        r#"SELECT context
           FROM audit_log
           WHERE user_id = $1
             AND entity_type = 'message_peer'
             AND entity_id = $2
             AND action = $3
           ORDER BY created_at"#,
    )
    .bind(user_id)
    .bind(peer_id)
    .bind(action)
    .fetch_all(pool)
    .await
    .unwrap()
}

async fn upsert_message_key(app: &axum::Router, bearer: &str, public_key: &[u8]) -> Value {
    let (status, payload) = json_request(
        app,
        "POST",
        "/api/v1/messages/e2e-key",
        bearer,
        Some(json!({
            "algorithm": "p256-hkdf-aes256gcm-v1",
            "public_key": BASE64.encode(public_key),
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    payload
}

#[tokio::test]
async fn patient_can_message_assigned_staff_and_exchange_file() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("portal-chat");
    let patient_user_id = seed_user(&pool, &tag, "patient").await;
    let patient_manager_id = seed_user(&pool, &format!("{tag}-pm"), "patient_manager").await;
    let sales_id = seed_user(&pool, &format!("{tag}-sales"), "sales").await;
    let patient_id = seed_patient(&pool, admin_id, &tag).await;

    seed_patient_assignment(&pool, patient_id, patient_user_id, admin_id).await;
    seed_patient_assignment(&pool, patient_id, patient_manager_id, admin_id).await;

    let patient_auth = auth_header_for(patient_user_id, "patient");
    let pm_auth = auth_header_for(patient_manager_id, "patient_manager");

    let (status, peers) = json_request(
        &app,
        "GET",
        "/api/v1/messages/allowed-peers",
        &patient_auth,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let peer_rows = peers.as_array().unwrap();
    assert!(
        peer_rows
            .iter()
            .any(|item| item["id"] == patient_manager_id.to_string()),
        "assigned patient manager should appear in patient-portal peers"
    );
    assert!(
        peer_rows
            .iter()
            .all(|item| item["id"] != sales_id.to_string()),
        "unassigned sales user must not appear in patient-portal peers"
    );

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/messages/{patient_manager_id}"),
        &patient_auth,
        Some(json!({ "message": "Need clarification about the treatment plan." })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["ok"], true);

    let file_bytes = b"portal-uploaded-chat-attachment";
    let (status, upload_body) = multipart_request(
        &app,
        &format!("/api/v1/messages/{patient_manager_id}/upload"),
        &patient_auth,
        file_bytes,
        "question.pdf",
        "application/pdf",
        Some("Attached file"),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let attachment_key = upload_body["attachment_key"].as_str().unwrap();

    let (status, conversation) = json_request(
        &app,
        "GET",
        &format!("/api/v1/messages/{patient_user_id}"),
        &pm_auth,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let messages = conversation.as_array().unwrap();
    assert!(
        messages
            .iter()
            .any(|item| item["message"] == "Need clarification about the treatment plan."),
        "patient manager should see text message from patient"
    );
    assert!(
        messages.iter().any(|item| {
            item["attachment_filename"] == "question.pdf"
                && item["message"] == "Attached file"
                && item["attachment_key"] == attachment_key
        }),
        "patient manager should see uploaded file in the same conversation"
    );

    let (status, downloaded) = bytes_request(
        &app,
        "GET",
        &format!("/api/v1/messages/file/{attachment_key}"),
        &pm_auth,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(downloaded, file_bytes);
}

#[tokio::test]
async fn patient_text_messages_can_use_e2e_envelopes() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("portal-chat-e2e");
    let patient_user_id = seed_user(&pool, &tag, "patient").await;
    let patient_manager_id = seed_user(&pool, &format!("{tag}-pm"), "patient_manager").await;
    let patient_id = seed_patient(&pool, admin_id, &tag).await;

    seed_patient_assignment(&pool, patient_id, patient_user_id, admin_id).await;
    seed_patient_assignment(&pool, patient_id, patient_manager_id, admin_id).await;

    let patient_auth = auth_header_for(patient_user_id, "patient");
    let pm_auth = auth_header_for(patient_manager_id, "patient_manager");

    let patient_key = upsert_message_key(&app, &patient_auth, &[1u8; 65]).await;
    let pm_key = upsert_message_key(&app, &pm_auth, &[2u8; 65]).await;

    let nonce = BASE64.encode([9u8; 12]);
    let salt = BASE64.encode([7u8; 16]);
    let ciphertext = BASE64.encode(b"opaque-e2e-ciphertext");
    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/messages/{patient_manager_id}"),
        &patient_auth,
        Some(json!({
            "e2e_algorithm": "p256-hkdf-aes256gcm-v1",
            "e2e_ciphertext": ciphertext,
            "e2e_nonce": nonce,
            "e2e_salt": salt,
            "sender_key_fingerprint": patient_key["fingerprint"],
            "recipient_key_fingerprint": pm_key["fingerprint"],
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["is_e2e"], true);

    let (status, conversation) = json_request(
        &app,
        "GET",
        &format!("/api/v1/messages/{patient_user_id}"),
        &pm_auth,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let messages = conversation.as_array().unwrap();
    let e2e_message = messages
        .iter()
        .find(|item| item["is_e2e"] == true)
        .expect("expected e2e message in conversation");
    assert!(e2e_message["message"].is_null());
    assert_eq!(
        e2e_message["sender_key_fingerprint"],
        patient_key["fingerprint"]
    );
    assert_eq!(
        e2e_message["recipient_key_fingerprint"],
        pm_key["fingerprint"]
    );
    assert_eq!(e2e_message["e2e_ciphertext"], ciphertext);

    let row = sqlx::query(
        r#"SELECT message, message_ciphertext, e2e_ciphertext
           FROM direct_messages
           WHERE from_user = $1
             AND to_user = $2
           ORDER BY created_at DESC
           LIMIT 1"#,
    )
    .bind(patient_user_id)
    .bind(patient_manager_id)
    .fetch_one(&pool)
    .await
    .unwrap();

    let plain_message = row
        .try_get::<Option<String>, _>("message")
        .unwrap_or_default();
    let legacy_ciphertext = row
        .try_get::<Option<Vec<u8>>, _>("message_ciphertext")
        .unwrap_or_default();
    let e2e_ciphertext = row
        .try_get::<Option<Vec<u8>>, _>("e2e_ciphertext")
        .unwrap_or_default();
    assert!(plain_message.is_none());
    assert!(legacy_ciphertext.is_none());
    assert!(e2e_ciphertext.is_some());
}

#[tokio::test]
async fn patient_attachments_can_use_e2e_envelopes() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("portal-chat-e2e-file");
    let patient_user_id = seed_user(&pool, &tag, "patient").await;
    let patient_manager_id = seed_user(&pool, &format!("{tag}-pm"), "patient_manager").await;
    let patient_id = seed_patient(&pool, admin_id, &tag).await;

    seed_patient_assignment(&pool, patient_id, patient_user_id, admin_id).await;
    seed_patient_assignment(&pool, patient_id, patient_manager_id, admin_id).await;

    let patient_auth = auth_header_for(patient_user_id, "patient");
    let pm_auth = auth_header_for(patient_manager_id, "patient_manager");

    let patient_key = upsert_message_key(&app, &patient_auth, &[3u8; 65]).await;
    let pm_key = upsert_message_key(&app, &pm_auth, &[4u8; 65]).await;

    let file_ciphertext = b"opaque-e2e-attachment-ciphertext";
    let attachment_nonce = BASE64.encode([5u8; 12]);
    let attachment_salt = BASE64.encode([6u8; 16]);
    let caption_ciphertext = BASE64.encode(b"opaque-e2e-caption");
    let caption_nonce = BASE64.encode([7u8; 12]);
    let caption_salt = BASE64.encode([8u8; 16]);
    let sender_fingerprint = patient_key["fingerprint"].as_str().unwrap().to_string();
    let recipient_fingerprint = pm_key["fingerprint"].as_str().unwrap().to_string();

    let (status, body) = multipart_request_with_extra_fields(
        &app,
        &format!("/api/v1/messages/{patient_manager_id}/upload"),
        &patient_auth,
        MultipartMessageUpload {
            file_content: file_ciphertext,
            filename: "secure-result.pdf",
            mime: "application/octet-stream",
            message: None,
            extra_fields: &[
                ("attachment_plaintext_size", "19"),
                ("attachment_e2e_algorithm", "p256-hkdf-aes256gcm-v1"),
                ("attachment_e2e_nonce", attachment_nonce.as_str()),
                ("attachment_e2e_salt", attachment_salt.as_str()),
                ("e2e_algorithm", "p256-hkdf-aes256gcm-v1"),
                ("e2e_ciphertext", caption_ciphertext.as_str()),
                ("e2e_nonce", caption_nonce.as_str()),
                ("e2e_salt", caption_salt.as_str()),
                ("sender_key_fingerprint", sender_fingerprint.as_str()),
                ("recipient_key_fingerprint", recipient_fingerprint.as_str()),
            ],
        },
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["attachment_is_e2e"], true);
    assert_eq!(body["attachment_size"], 19);
    let attachment_key = body["attachment_key"].as_str().unwrap();

    let (status, conversation) = json_request(
        &app,
        "GET",
        &format!("/api/v1/messages/{patient_user_id}"),
        &pm_auth,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let messages = conversation.as_array().unwrap();
    let e2e_attachment = messages
        .iter()
        .find(|item| item["attachment_key"] == attachment_key)
        .expect("expected E2E attachment message");
    assert_eq!(e2e_attachment["attachment_is_e2e"], true);
    assert_eq!(e2e_attachment["attachment_e2e_nonce"], attachment_nonce);
    assert_eq!(e2e_attachment["attachment_e2e_salt"], attachment_salt);
    assert_eq!(e2e_attachment["is_e2e"], true);
    assert_eq!(e2e_attachment["e2e_ciphertext"], caption_ciphertext);
    assert!(e2e_attachment["message"].is_null());

    let (status, downloaded) = bytes_request(
        &app,
        "GET",
        &format!("/api/v1/messages/file/{attachment_key}"),
        &pm_auth,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(downloaded, file_ciphertext);

    let row = sqlx::query(
        r#"SELECT message_ciphertext, message_nonce, e2e_ciphertext, attachment_nonce,
                  attachment_e2e_algorithm, attachment_e2e_nonce, attachment_e2e_salt,
                  sender_key_fingerprint, recipient_key_fingerprint
           FROM direct_messages
           WHERE attachment_key = $1
           LIMIT 1"#,
    )
    .bind(attachment_key)
    .fetch_one(&pool)
    .await
    .unwrap();

    assert!(
        row.try_get::<Option<Vec<u8>>, _>("message_ciphertext")
            .unwrap_or_default()
            .is_none()
    );
    assert!(
        row.try_get::<Option<Vec<u8>>, _>("message_nonce")
            .unwrap_or_default()
            .is_none()
    );
    assert!(
        row.try_get::<Option<Vec<u8>>, _>("e2e_ciphertext")
            .unwrap_or_default()
            .is_some()
    );
    assert!(
        row.try_get::<Option<Vec<u8>>, _>("attachment_nonce")
            .unwrap_or_default()
            .is_none()
    );
    assert_eq!(
        row.try_get::<Option<String>, _>("attachment_e2e_algorithm")
            .unwrap_or_default()
            .as_deref(),
        Some("p256-hkdf-aes256gcm-v1")
    );
    assert!(
        row.try_get::<Option<Vec<u8>>, _>("attachment_e2e_nonce")
            .unwrap_or_default()
            .is_some()
    );
    assert!(
        row.try_get::<Option<Vec<u8>>, _>("attachment_e2e_salt")
            .unwrap_or_default()
            .is_some()
    );
    assert_eq!(
        row.try_get::<Option<String>, _>("sender_key_fingerprint")
            .unwrap_or_default()
            .as_deref(),
        Some(sender_fingerprint.as_str())
    );
    assert_eq!(
        row.try_get::<Option<String>, _>("recipient_key_fingerprint")
            .unwrap_or_default()
            .as_deref(),
        Some(recipient_fingerprint.as_str())
    );
}

#[tokio::test]
async fn patient_message_creates_staff_notifications_and_mark_read_clears_them() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("portal-chat-notifications");
    let patient_user_id = seed_user(&pool, &tag, "patient").await;
    let patient_manager_id = seed_user(&pool, &format!("{tag}-pm"), "patient_manager").await;
    let patient_id = seed_patient(&pool, admin_id, &tag).await;

    seed_patient_assignment(&pool, patient_id, patient_user_id, admin_id).await;
    seed_patient_assignment(&pool, patient_id, patient_manager_id, admin_id).await;

    let patient_auth = auth_header_for(patient_user_id, "patient");
    let pm_auth = auth_header_for(patient_manager_id, "patient_manager");

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/messages/{patient_manager_id}"),
        &patient_auth,
        Some(json!({ "message": "Please check the latest portal upload." })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["ok"], true);

    let (status, _) = multipart_request(
        &app,
        &format!("/api/v1/messages/{patient_manager_id}/upload"),
        &patient_auth,
        b"portal-chat-notification-attachment",
        "portal-note.pdf",
        "application/pdf",
        Some("Attachment for review"),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let unread_notifications: i64 = sqlx::query_scalar(
        r#"SELECT count(*)::bigint
           FROM user_notifications
           WHERE user_id = $1
             AND entity_type = 'message_peer'
             AND entity_id = $2
             AND kind IN ('direct_message', 'direct_message_attachment')
             AND NOT is_read"#,
    )
    .bind(patient_manager_id)
    .bind(patient_user_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(unread_notifications, 2);

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/messages/{patient_user_id}/read"),
        &pm_auth,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["ok"], true);

    let remaining_unread: i64 = sqlx::query_scalar(
        r#"SELECT count(*)::bigint
           FROM user_notifications
           WHERE user_id = $1
             AND entity_type = 'message_peer'
             AND entity_id = $2
             AND kind IN ('direct_message', 'direct_message_attachment')
             AND NOT is_read"#,
    )
    .bind(patient_manager_id)
    .bind(patient_user_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(remaining_unread, 0);
}

#[tokio::test]
async fn patient_message_mark_read_sets_per_message_read_timestamps() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("portal-chat-read-at");
    let patient_user_id = seed_user(&pool, &tag, "patient").await;
    let patient_manager_id = seed_user(&pool, &format!("{tag}-pm"), "patient_manager").await;
    let patient_id = seed_patient(&pool, admin_id, &tag).await;

    seed_patient_assignment(&pool, patient_id, patient_user_id, admin_id).await;
    seed_patient_assignment(&pool, patient_id, patient_manager_id, admin_id).await;

    let patient_auth = auth_header_for(patient_user_id, "patient");
    let pm_auth = auth_header_for(patient_manager_id, "patient_manager");

    for message_text in [
        "First unread portal message.",
        "Second unread portal message.",
    ] {
        let (status, body) = json_request(
            &app,
            "POST",
            &format!("/api/v1/messages/{patient_manager_id}"),
            &patient_auth,
            Some(json!({ "message": message_text })),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["ok"], true);
    }

    let (status, conversation) = json_request(
        &app,
        "GET",
        &format!("/api/v1/messages/{patient_user_id}"),
        &pm_auth,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let unread_messages: Vec<&Value> = conversation
        .as_array()
        .unwrap()
        .iter()
        .filter(|item| item["from_user"] == patient_user_id.to_string())
        .collect();
    assert_eq!(unread_messages.len(), 2);
    assert!(unread_messages.iter().all(|item| item["is_read"] == false));
    assert!(unread_messages.iter().all(|item| item["read_at"].is_null()));

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/messages/{patient_user_id}/read"),
        &pm_auth,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["ok"], true);
    assert_eq!(body["marked_read_count"], 2);
    assert!(body["last_read_at"].as_str().is_some());

    let (status, conversation) = json_request(
        &app,
        "GET",
        &format!("/api/v1/messages/{patient_user_id}"),
        &pm_auth,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let read_messages: Vec<&Value> = conversation
        .as_array()
        .unwrap()
        .iter()
        .filter(|item| item["from_user"] == patient_user_id.to_string())
        .collect();
    assert_eq!(read_messages.len(), 2);
    assert!(read_messages.iter().all(|item| item["is_read"] == true));
    assert!(
        read_messages
            .iter()
            .all(|item| item["read_at"].as_str().is_some())
    );

    let stored_read_at_count: i64 = sqlx::query_scalar(
        r#"SELECT count(*)::bigint
           FROM direct_messages
           WHERE from_user = $1
             AND to_user = $2
             AND read_at IS NOT NULL"#,
    )
    .bind(patient_user_id)
    .bind(patient_manager_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(stored_read_at_count, 2);
}

#[tokio::test]
async fn deleting_portal_document_file_does_not_break_patient_manager_chat() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("portal-doc-delete-chat");
    let patient_user_id = seed_user(&pool, &tag, "patient").await;
    let patient_manager_id = seed_user(&pool, &format!("{tag}-pm"), "patient_manager").await;
    let patient_id = seed_patient(&pool, admin_id, &tag).await;

    seed_patient_assignment(&pool, patient_id, patient_user_id, admin_id).await;
    seed_patient_assignment(&pool, patient_id, patient_manager_id, admin_id).await;

    let document_id = seed_document(
        &pool,
        patient_id,
        patient_manager_id,
        &tag,
        "patient_visible",
    )
    .await;
    sqlx::query(
        r#"INSERT INTO document_shares (
                document_id, shared_with_user_id, shared_by, channel, requires_confirmation,
                confirmed, confirmed_at
           ) VALUES (
                $1, $2, $3, 'patient_portal', true, true, now()
           )"#,
    )
    .bind(document_id)
    .bind(patient_user_id)
    .bind(patient_manager_id)
    .execute(&pool)
    .await
    .unwrap();

    let patient_auth = auth_header_for(patient_user_id, "patient");
    let pm_auth = auth_header_for(patient_manager_id, "patient_manager");

    let (status, before_delete_docs) =
        json_request(&app, "GET", "/api/v1/me/documents", &patient_auth, None).await;
    assert_eq!(status, StatusCode::OK);
    let items = before_delete_docs
        .as_array()
        .expect("portal document list before delete");
    assert_eq!(items.len(), 1);
    assert_eq!(items[0]["id"], document_id.to_string());

    let delete_reason = "Portal binary removed after wrong upload";
    let (status, delete_body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/documents/{document_id}/delete"),
        &pm_auth,
        Some(json!({ "reason": delete_reason })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(delete_body["document"]["status"], "archived");
    assert_eq!(delete_body["revoked_share_count"], 1);

    let (status, after_delete_docs) =
        json_request(&app, "GET", "/api/v1/me/documents", &patient_auth, None).await;
    assert_eq!(status, StatusCode::OK);
    assert!(after_delete_docs.as_array().unwrap().is_empty());

    let patient_message = "The portal file disappeared, please resend the corrected document.";
    let (status, send_body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/messages/{patient_manager_id}"),
        &patient_auth,
        Some(json!({ "message": patient_message })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(send_body["ok"], true);

    let (status, conversation_body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/messages/{patient_user_id}"),
        &pm_auth,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let conversation = conversation_body
        .as_array()
        .expect("conversation after document delete");
    assert!(
        conversation
            .iter()
            .any(|item| item["message"] == patient_message),
        "patient-manager chat should stay available after portal document deletion"
    );
}

#[tokio::test]
async fn patient_message_operations_write_audit_trail() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("portal-chat-audit");
    let patient_user_id = seed_user(&pool, &tag, "patient").await;
    let patient_manager_id = seed_user(&pool, &format!("{tag}-pm"), "patient_manager").await;
    let patient_id = seed_patient(&pool, admin_id, &tag).await;

    seed_patient_assignment(&pool, patient_id, patient_user_id, admin_id).await;
    seed_patient_assignment(&pool, patient_id, patient_manager_id, admin_id).await;

    let patient_auth = auth_header_for(patient_user_id, "patient");
    let pm_auth = auth_header_for(patient_manager_id, "patient_manager");
    let message_text = "Need audit coverage.";

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/messages/{patient_manager_id}"),
        &patient_auth,
        Some(json!({ "message": message_text })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["ok"], true);

    let file_bytes = b"portal-audit-attachment";
    let (status, upload_body) = multipart_request(
        &app,
        &format!("/api/v1/messages/{patient_manager_id}/upload"),
        &patient_auth,
        file_bytes,
        "portal-audit.pdf",
        "application/pdf",
        Some("Attachment for audit"),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let attachment_key = upload_body["attachment_key"].as_str().unwrap();

    let (status, _) = json_request(
        &app,
        "GET",
        &format!("/api/v1/messages/{patient_user_id}"),
        &pm_auth,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (status, downloaded) = bytes_request(
        &app,
        "GET",
        &format!("/api/v1/messages/file/{attachment_key}"),
        &pm_auth,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(downloaded, file_bytes);

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/messages/{patient_user_id}/read"),
        &pm_auth,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["ok"], true);

    let send_audits =
        audit_contexts(&pool, patient_user_id, patient_manager_id, "send_message").await;
    assert_eq!(send_audits.len(), 1);
    assert_eq!(
        send_audits[0]["message_length"].as_u64(),
        Some(message_text.chars().count() as u64)
    );

    let upload_audits = audit_contexts(
        &pool,
        patient_user_id,
        patient_manager_id,
        "upload_message_attachment",
    )
    .await;
    assert_eq!(upload_audits.len(), 1);
    assert_eq!(upload_audits[0]["attachment_filename"], "portal-audit.pdf");
    assert_eq!(upload_audits[0]["has_message_text"], true);

    let view_audits = audit_contexts(
        &pool,
        patient_manager_id,
        patient_user_id,
        "view_message_conversation",
    )
    .await;
    assert_eq!(view_audits.len(), 1);
    assert_eq!(view_audits[0]["limit"].as_i64(), Some(50));
    assert_eq!(view_audits[0]["returned_count"].as_u64(), Some(2));

    let download_audits = audit_contexts(
        &pool,
        patient_manager_id,
        patient_user_id,
        "download_message_attachment",
    )
    .await;
    assert_eq!(download_audits.len(), 1);
    assert_eq!(
        download_audits[0]["attachment_filename"],
        "portal-audit.pdf"
    );

    let read_audits = audit_contexts(
        &pool,
        patient_manager_id,
        patient_user_id,
        "read_message_conversation",
    )
    .await;
    assert_eq!(read_audits.len(), 1);
    assert_eq!(read_audits[0]["marked_read_count"].as_u64(), Some(2));
}

#[tokio::test]
async fn patient_cannot_message_unassigned_staff() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("portal-chat-blocked");
    let patient_user_id = seed_user(&pool, &tag, "patient").await;
    let patient_manager_id = seed_user(&pool, &format!("{tag}-pm"), "patient_manager").await;
    let sales_id = seed_user(&pool, &format!("{tag}-sales"), "sales").await;
    let patient_id = seed_patient(&pool, admin_id, &tag).await;

    seed_patient_assignment(&pool, patient_id, patient_user_id, admin_id).await;
    seed_patient_assignment(&pool, patient_id, patient_manager_id, admin_id).await;

    let patient_auth = auth_header_for(patient_user_id, "patient");

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/messages/{sales_id}"),
        &patient_auth,
        Some(json!({ "message": "Can I pay this invoice later?" })),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(
        body["message"],
        "You cannot exchange messages with this user"
    );
}

#[tokio::test]
async fn sales_cannot_use_internal_chat_workspace_and_are_hidden_from_staff_peers() {
    let Some((app, pool, _admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("staff-chat-sales-deny");
    let patient_manager_id = seed_user(&pool, &format!("{tag}-pm"), "patient_manager").await;
    let billing_id = seed_user(&pool, &format!("{tag}-billing"), "billing").await;
    let sales_id = seed_user(&pool, &format!("{tag}-sales"), "sales").await;

    let pm_auth = auth_header_for(patient_manager_id, "patient_manager");
    let sales_auth = auth_header_for(sales_id, "sales");

    let (status, peers) = json_request(
        &app,
        "GET",
        "/api/v1/messages/allowed-peers",
        &pm_auth,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let peer_rows = peers.as_array().unwrap();
    assert!(
        peer_rows
            .iter()
            .any(|item| item["id"] == billing_id.to_string()),
        "billing peer should remain visible to patient manager"
    );
    assert!(
        peer_rows
            .iter()
            .all(|item| item["id"] != sales_id.to_string()),
        "sales must not appear in internal allowed-peer list"
    );

    let (status, body) = json_request(
        &app,
        "GET",
        "/api/v1/messages/allowed-peers",
        &sales_auth,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(
        body["message"],
        "Your role cannot access the chat workspace"
    );

    let (status, body) = json_request(
        &app,
        "GET",
        "/api/v1/messages/conversations",
        &sales_auth,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(
        body["message"],
        "Your role cannot access the chat workspace"
    );

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/messages/{patient_manager_id}"),
        &sales_auth,
        Some(json!({ "message": "Can we coordinate a partner offer?" })),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(
        body["message"],
        "Your role cannot access the chat workspace"
    );
}

#[tokio::test]
async fn unassigned_staff_cannot_open_patient_conversation() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("portal-chat-scope");
    let patient_user_id = seed_user(&pool, &tag, "patient").await;
    let assigned_pm_id = seed_user(&pool, &format!("{tag}-assigned"), "patient_manager").await;
    let other_pm_id = seed_user(&pool, &format!("{tag}-other"), "patient_manager").await;
    let patient_id = seed_patient(&pool, admin_id, &tag).await;

    seed_patient_assignment(&pool, patient_id, patient_user_id, admin_id).await;
    seed_patient_assignment(&pool, patient_id, assigned_pm_id, admin_id).await;

    let assigned_auth = auth_header_for(assigned_pm_id, "patient_manager");
    let other_auth = auth_header_for(other_pm_id, "patient_manager");

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/messages/{patient_user_id}"),
        &assigned_auth,
        Some(json!({ "message": "We updated your appointment schedule." })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["ok"], true);

    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/messages/{patient_user_id}"),
        &other_auth,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(
        body["message"],
        "You cannot exchange messages with this user"
    );
}
