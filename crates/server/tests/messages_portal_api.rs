mod support;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};
use serde_json::{Value, json};
use sqlx::{PgPool, Row};
use tower::ServiceExt;
use uuid::Uuid;

use gmed_server::auth::jwt;
const TEST_SECRET: &str = "test-secret-at-least-32-characters-long!!";

async fn test_context() -> Option<(axum::Router, PgPool, Uuid)> {
    let ctx = support::suite_context(TEST_SECRET).await?;
    Some((ctx.app, ctx.pool, ctx.admin_id))
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
    support::wait_until(
        &format!("message audit contexts for action '{action}' between {user_id} and {peer_id}"),
        || async move {
            let rows: Vec<Value> = sqlx::query_scalar(
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
            .unwrap();
            !rows.is_empty()
        },
    )
    .await;

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
    let file_bytes = b"%PDF-1.4\nportal-uploaded-chat-attachment";
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
    assert_eq!(status, StatusCode::OK, "upload response: {upload_body:?}");
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
                ("attachment_plaintext_size", "16"),
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
    assert_eq!(body["attachment_size"], 16);
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
    let text_message_id = Uuid::parse_str(body["id"].as_str().unwrap()).unwrap();

    let (status, _) = multipart_request(
        &app,
        &format!("/api/v1/messages/{patient_manager_id}/upload"),
        &patient_auth,
        b"%PDF-1.4\nportal-chat-notification-attachment",
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

    let notification_bodies: Vec<(String, Option<Uuid>)> = sqlx::query_as(
        r#"SELECT body, source_message_id
           FROM user_notifications
           WHERE user_id = $1
             AND entity_type = 'message_peer'
             AND entity_id = $2
             AND kind IN ('direct_message', 'direct_message_attachment')"#,
    )
    .bind(patient_manager_id)
    .bind(patient_user_id)
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(notification_bodies.len(), 2);
    assert!(
        notification_bodies
            .iter()
            .all(|(body, source_message_id)| body == "Open chat" && source_message_id.is_some())
    );

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

    let (status, _) = json_request(
        &app,
        "DELETE",
        &format!("/api/v1/messages/{patient_manager_id}/{text_message_id}"),
        &patient_auth,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let deleted_notification_count: i64 = sqlx::query_scalar(
        "SELECT count(*)::bigint FROM user_notifications WHERE source_message_id = $1",
    )
    .bind(text_message_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(deleted_notification_count, 0);
}

#[tokio::test]
async fn expired_message_purge_clears_payload_and_linked_notification() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("portal-chat-expiry-cleanup");
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
        Some(json!({
            "message": "short-lived payload",
            "expires_in_seconds": 60,
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let message_id = Uuid::parse_str(body["id"].as_str().unwrap()).unwrap();
    sqlx::query(
        "UPDATE direct_messages SET expires_at = now() - interval '1 minute' WHERE id = $1",
    )
    .bind(message_id)
    .execute(&pool)
    .await
    .unwrap();

    let (status, conversation) = json_request(
        &app,
        "GET",
        &format!("/api/v1/messages/{patient_user_id}"),
        &pm_auth,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let message_id_text = message_id.to_string();
    assert!(conversation.as_array().is_some_and(|messages| {
        messages
            .iter()
            .all(|message| message["id"].as_str() != Some(message_id_text.as_str()))
    }));

    let row = sqlx::query(
        "SELECT deleted_at, message, message_ciphertext FROM direct_messages WHERE id = $1",
    )
    .bind(message_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(
        row.try_get::<Option<chrono::DateTime<chrono::Utc>>, _>("deleted_at")
            .unwrap_or_default()
            .is_some()
    );
    assert!(
        row.try_get::<Option<String>, _>("message")
            .unwrap_or_default()
            .is_none()
    );
    assert!(
        row.try_get::<Option<Vec<u8>>, _>("message_ciphertext")
            .unwrap_or_default()
            .is_none()
    );
    let remaining_notifications: i64 = sqlx::query_scalar(
        "SELECT count(*)::bigint FROM user_notifications WHERE source_message_id = $1",
    )
    .bind(message_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(remaining_notifications, 0);
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
async fn message_key_fingerprint_cannot_be_claimed_by_another_account() {
    let Some((app, pool, _)) = test_context().await else {
        return;
    };

    let tag = unique_tag("chat-key-owner");
    let first_user = seed_user(&pool, &tag, "patient").await;
    let second_user = seed_user(&pool, &format!("{tag}-second"), "concierge").await;
    let first_auth = auth_header_for(first_user, "patient");
    let second_auth = auth_header_for(second_user, "concierge");
    let public_key = [42_u8; 91];

    let first_key = upsert_message_key(&app, &first_auth, &public_key).await;
    let (status, body) = json_request(
        &app,
        "POST",
        "/api/v1/messages/e2e-key",
        &second_auth,
        Some(json!({
            "algorithm": "p256-hkdf-aes256gcm-v1",
            "public_key": BASE64.encode(public_key),
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{body}");

    let (status, persisted) =
        json_request(&app, "GET", "/api/v1/messages/e2e-key", &first_auth, None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(persisted["user_id"], first_user.to_string());
    assert_eq!(persisted["fingerprint"], first_key["fingerprint"]);

    let (status, _) =
        json_request(&app, "GET", "/api/v1/messages/e2e-key", &second_auth, None).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn plaintext_downgrade_is_rejected_when_recipient_has_an_active_key() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("chat-no-downgrade");
    let patient_user_id = seed_user(&pool, &tag, "patient").await;
    let concierge_id = seed_user(&pool, &format!("{tag}-concierge"), "concierge").await;
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    seed_patient_assignment(&pool, patient_id, patient_user_id, admin_id).await;
    seed_patient_assignment(&pool, patient_id, concierge_id, admin_id).await;

    let patient_auth = auth_header_for(patient_user_id, "patient");
    let concierge_auth = auth_header_for(concierge_id, "concierge");
    upsert_message_key(&app, &concierge_auth, &[7_u8; 91]).await;

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/messages/{concierge_id}"),
        &patient_auth,
        Some(json!({ "message": "must not downgrade" })),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{body}");
}

#[tokio::test]
async fn plaintext_text_and_attachment_are_rejected_when_sender_has_an_active_key() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("chat-sender-no-downgrade");
    let patient_user_id = seed_user(&pool, &tag, "patient").await;
    let concierge_id = seed_user(&pool, &format!("{tag}-concierge"), "concierge").await;
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    seed_patient_assignment(&pool, patient_id, patient_user_id, admin_id).await;
    seed_patient_assignment(&pool, patient_id, concierge_id, admin_id).await;

    let patient_auth = auth_header_for(patient_user_id, "patient");
    upsert_message_key(&app, &patient_auth, &[8_u8; 91]).await;

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/messages/{concierge_id}"),
        &patient_auth,
        Some(json!({ "message": "must stay encrypted" })),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{body}");

    let (status, body) = multipart_request(
        &app,
        &format!("/api/v1/messages/{concierge_id}/upload"),
        &patient_auth,
        b"%PDF-1.4\nplaintext downgrade",
        "plaintext.pdf",
        "application/pdf",
        None,
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{body}");
}

#[tokio::test]
async fn e2e_send_rejects_a_retired_recipient_key() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("chat-retired-recipient-key");
    let patient_user_id = seed_user(&pool, &tag, "patient").await;
    let concierge_id = seed_user(&pool, &format!("{tag}-concierge"), "concierge").await;
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    seed_patient_assignment(&pool, patient_id, patient_user_id, admin_id).await;
    seed_patient_assignment(&pool, patient_id, concierge_id, admin_id).await;

    let patient_auth = auth_header_for(patient_user_id, "patient");
    let concierge_auth = auth_header_for(concierge_id, "concierge");
    let sender_key = upsert_message_key(&app, &patient_auth, &[9_u8; 91]).await;
    let retired_key = upsert_message_key(&app, &concierge_auth, &[10_u8; 91]).await;
    let active_key = upsert_message_key(&app, &concierge_auth, &[11_u8; 91]).await;
    assert_ne!(retired_key["fingerprint"], active_key["fingerprint"]);

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/messages/{concierge_id}"),
        &patient_auth,
        Some(json!({
            "e2e_algorithm": "p256-hkdf-aes256gcm-v1",
            "e2e_ciphertext": BASE64.encode(b"opaque"),
            "e2e_nonce": BASE64.encode([1_u8; 12]),
            "e2e_salt": BASE64.encode([2_u8; 16]),
            "sender_key_fingerprint": sender_key["fingerprint"],
            "recipient_key_fingerprint": retired_key["fingerprint"],
        })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
    assert_eq!(body["message"], "Recipient message key is not active");
}

#[tokio::test]
async fn revoked_patient_identity_is_not_reactivated_by_chat_email_fallback() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("portal-chat-revoked-self-link");
    let patient_user_id = seed_user(&pool, &tag, "patient").await;
    let concierge_id = seed_user(&pool, &format!("{tag}-concierge"), "concierge").await;
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    sqlx::query(
        "UPDATE patients SET email = (SELECT email FROM users WHERE id = $2) WHERE id = $1",
    )
    .bind(patient_id)
    .bind(patient_user_id)
    .execute(&pool)
    .await
    .unwrap();
    seed_patient_assignment(&pool, patient_id, patient_user_id, admin_id).await;
    seed_patient_assignment(&pool, patient_id, concierge_id, admin_id).await;
    sqlx::query(
        "UPDATE patient_assignments SET revoked_at = now() WHERE patient_id = $1 AND user_id = $2",
    )
    .bind(patient_id)
    .bind(patient_user_id)
    .execute(&pool)
    .await
    .unwrap();

    let (status, _) = json_request(
        &app,
        "GET",
        &format!("/api/v1/messages/{concierge_id}"),
        &auth_header_for(patient_user_id, "patient"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    let revoked_at: Option<chrono::DateTime<chrono::Utc>> = sqlx::query_scalar(
        "SELECT revoked_at FROM patient_assignments WHERE patient_id = $1 AND user_id = $2",
    )
    .bind(patient_id)
    .bind(patient_user_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(
        revoked_at.is_some(),
        "chat request must preserve revocation"
    );
}

#[tokio::test]
async fn first_run_patient_email_link_still_supports_assigned_chat() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("portal-chat-first-email-link");
    let patient_user_id = seed_user(&pool, &tag, "patient").await;
    let concierge_id = seed_user(&pool, &format!("{tag}-concierge"), "concierge").await;
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    sqlx::query(
        "UPDATE patients SET email = (SELECT email FROM users WHERE id = $2) WHERE id = $1",
    )
    .bind(patient_id)
    .bind(patient_user_id)
    .execute(&pool)
    .await
    .unwrap();
    seed_patient_assignment(&pool, patient_id, concierge_id, admin_id).await;

    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/messages/{concierge_id}"),
        &auth_header_for(patient_user_id, "patient"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");

    let active_link: bool = sqlx::query_scalar(
        r#"SELECT EXISTS(
               SELECT 1 FROM patient_assignments
               WHERE patient_id = $1 AND user_id = $2 AND revoked_at IS NULL
           )"#,
    )
    .bind(patient_id)
    .bind(patient_user_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(
        active_link,
        "first-run compatibility link should be created"
    );
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

    let file_bytes = b"%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n";
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
    assert_eq!(status, StatusCode::OK, "upload response: {upload_body:?}");
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
    assert!(upload_audits[0].get("attachment_filename").is_none());
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
    assert!(download_audits[0].get("attachment_filename").is_none());

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

#[tokio::test]
async fn e2e_attachment_upload_enforces_plaintext_size_and_body_limit() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("portal-chat-upload-limit");
    let patient_user_id = seed_user(&pool, &tag, "patient").await;
    let patient_manager_id = seed_user(&pool, &format!("{tag}-pm"), "patient_manager").await;
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    seed_patient_assignment(&pool, patient_id, patient_user_id, admin_id).await;
    seed_patient_assignment(&pool, patient_id, patient_manager_id, admin_id).await;

    let patient_auth = auth_header_for(patient_user_id, "patient");
    let patient_key = upsert_message_key(&app, &patient_auth, &[21u8; 65]).await;
    let pm_auth = auth_header_for(patient_manager_id, "patient_manager");
    let pm_key = upsert_message_key(&app, &pm_auth, &[22u8; 65]).await;
    let sender_fingerprint = patient_key["fingerprint"].as_str().unwrap().to_string();
    let recipient_fingerprint = pm_key["fingerprint"].as_str().unwrap().to_string();
    let nonce = BASE64.encode([23u8; 12]);
    let salt = BASE64.encode([24u8; 16]);
    for size_megabytes in [1_usize, 2, 19] {
        let plaintext_size = size_megabytes * 1024 * 1024;
        let plaintext_size_field = plaintext_size.to_string();
        let ciphertext = vec![0x5a; plaintext_size + 16];
        let filename = format!("{size_megabytes}-megabytes.pdf");

        let (status, body) = multipart_request_with_extra_fields(
            &app,
            &format!("/api/v1/messages/{patient_manager_id}/upload"),
            &patient_auth,
            MultipartMessageUpload {
                file_content: &ciphertext,
                filename: filename.as_str(),
                mime: "application/octet-stream",
                message: None,
                extra_fields: &[
                    ("attachment_plaintext_size", plaintext_size_field.as_str()),
                    ("attachment_e2e_algorithm", "p256-hkdf-aes256gcm-v1"),
                    ("attachment_e2e_nonce", nonce.as_str()),
                    ("attachment_e2e_salt", salt.as_str()),
                    ("sender_key_fingerprint", sender_fingerprint.as_str()),
                    ("recipient_key_fingerprint", recipient_fingerprint.as_str()),
                ],
            },
        )
        .await;
        assert_eq!(status, StatusCode::OK, "upload response: {body:?}");
        assert_eq!(body["attachment_size"], plaintext_size as i64);

        let message_id = Uuid::parse_str(body["id"].as_str().unwrap()).unwrap();
        let (status, _) = json_request(
            &app,
            "DELETE",
            &format!("/api/v1/messages/{patient_manager_id}/{message_id}"),
            &patient_auth,
            None,
        )
        .await;
        assert_eq!(status, StatusCode::OK);
    }

    let oversized = vec![0u8; 21 * 1024 * 1024];
    let (status, _) = multipart_request(
        &app,
        &format!("/api/v1/messages/{patient_manager_id}/upload"),
        &patient_auth,
        &oversized,
        "twenty-one-megabytes.bin",
        "application/octet-stream",
        None,
    )
    .await;
    assert_eq!(status, StatusCode::PAYLOAD_TOO_LARGE);
}

#[tokio::test]
async fn e2e_attachment_upload_rejects_forged_size_and_exhausted_user_quota() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("portal-chat-upload-quota");
    let patient_user_id = seed_user(&pool, &tag, "patient").await;
    let patient_manager_id = seed_user(&pool, &format!("{tag}-pm"), "patient_manager").await;
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    seed_patient_assignment(&pool, patient_id, patient_user_id, admin_id).await;
    seed_patient_assignment(&pool, patient_id, patient_manager_id, admin_id).await;

    let patient_auth = auth_header_for(patient_user_id, "patient");
    let patient_key = upsert_message_key(&app, &patient_auth, &[31u8; 65]).await;
    let pm_auth = auth_header_for(patient_manager_id, "patient_manager");
    let pm_key = upsert_message_key(&app, &pm_auth, &[32u8; 65]).await;
    let sender_fingerprint = patient_key["fingerprint"].as_str().unwrap().to_string();
    let recipient_fingerprint = pm_key["fingerprint"].as_str().unwrap().to_string();
    let nonce = BASE64.encode([33u8; 12]);
    let salt = BASE64.encode([34u8; 16]);
    let ciphertext = vec![0x7b; 32];

    let (status, body) = multipart_request_with_extra_fields(
        &app,
        &format!("/api/v1/messages/{patient_manager_id}/upload"),
        &patient_auth,
        MultipartMessageUpload {
            file_content: &ciphertext,
            filename: "blocked.exe",
            mime: "application/octet-stream",
            message: None,
            extra_fields: &[
                ("attachment_plaintext_size", "16"),
                ("attachment_e2e_algorithm", "p256-hkdf-aes256gcm-v1"),
                ("attachment_e2e_nonce", nonce.as_str()),
                ("attachment_e2e_salt", salt.as_str()),
                ("sender_key_fingerprint", sender_fingerprint.as_str()),
                ("recipient_key_fingerprint", recipient_fingerprint.as_str()),
            ],
        },
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(body["message"], "Encrypted attachment type is not allowed");

    let (status, body) = multipart_request_with_extra_fields(
        &app,
        &format!("/api/v1/messages/{patient_manager_id}/upload"),
        &patient_auth,
        MultipartMessageUpload {
            file_content: &ciphertext,
            filename: "forged-size.pdf",
            mime: "application/octet-stream",
            message: None,
            extra_fields: &[
                ("attachment_plaintext_size", "1"),
                ("attachment_e2e_algorithm", "p256-hkdf-aes256gcm-v1"),
                ("attachment_e2e_nonce", nonce.as_str()),
                ("attachment_e2e_salt", salt.as_str()),
                ("sender_key_fingerprint", sender_fingerprint.as_str()),
                ("recipient_key_fingerprint", recipient_fingerprint.as_str()),
            ],
        },
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(
        body["message"],
        "Encrypted attachment size does not match plaintext size"
    );

    sqlx::query(
        r#"INSERT INTO direct_messages (
               from_user, to_user, message, attachment_key, attachment_size,
               attachment_e2e_algorithm, attachment_e2e_nonce, attachment_e2e_salt, expires_at
           ) VALUES ($1, $2, $3, $4, $5, 'p256-hkdf-aes256gcm-v1', $6, $7,
                     now() - interval '1 minute')"#,
    )
    .bind(patient_user_id)
    .bind(patient_manager_id)
    .bind("quota reservation")
    .bind(format!("quota-reservation-{tag}"))
    .bind(500_i64 * 1024 * 1024 - 1)
    .bind(vec![1u8; 12])
    .bind(vec![2u8; 16])
    .execute(&pool)
    .await
    .unwrap();

    let (status, body) = multipart_request_with_extra_fields(
        &app,
        &format!("/api/v1/messages/{patient_manager_id}/upload"),
        &patient_auth,
        MultipartMessageUpload {
            file_content: &ciphertext,
            filename: "over-quota.pdf",
            mime: "application/octet-stream",
            message: None,
            extra_fields: &[
                ("attachment_plaintext_size", "16"),
                ("attachment_e2e_algorithm", "p256-hkdf-aes256gcm-v1"),
                ("attachment_e2e_nonce", nonce.as_str()),
                ("attachment_e2e_salt", salt.as_str()),
                ("sender_key_fingerprint", sender_fingerprint.as_str()),
                ("recipient_key_fingerprint", recipient_fingerprint.as_str()),
            ],
        },
    )
    .await;
    assert_eq!(status, StatusCode::INSUFFICIENT_STORAGE);
    assert_eq!(body["message"], "Chat attachment quota exceeded");
}

#[tokio::test]
async fn legacy_plaintext_attachment_is_migrated_before_download() {
    let Some(ctx) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let app = ctx.app.clone();
    let pool = ctx.pool.clone();
    let tag = unique_tag("portal-chat-legacy-migration");
    let patient_user_id = seed_user(&pool, &tag, "patient").await;
    let patient_manager_id = seed_user(&pool, &format!("{tag}-pm"), "patient_manager").await;
    let patient_id = seed_patient(&pool, ctx.admin_id, &tag).await;
    seed_patient_assignment(&pool, patient_id, patient_user_id, ctx.admin_id).await;
    seed_patient_assignment(&pool, patient_id, patient_manager_id, ctx.admin_id).await;

    let upload_dir = std::path::Path::new(gmed_server::routes::messages::CHAT_UPLOAD_DIR);
    tokio::fs::create_dir_all(upload_dir).await.unwrap();
    let legacy_key = format!("{}_legacy.txt", Uuid::new_v4());
    let legacy_path = upload_dir.join(&legacy_key);
    let plaintext = b"legacy attachment requiring at-rest migration";
    tokio::fs::write(&legacy_path, plaintext).await.unwrap();

    let message_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO direct_messages (
               from_user, to_user, message, attachment_filename, attachment_mime,
               attachment_size, attachment_key
           ) VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING id"#,
    )
    .bind(patient_user_id)
    .bind(patient_manager_id)
    .bind("legacy attachment")
    .bind("legacy.txt")
    .bind("text/plain")
    .bind(plaintext.len() as i64)
    .bind(&legacy_key)
    .fetch_one(&pool)
    .await
    .unwrap();

    let (migrated, _) =
        gmed_server::routes::messages::migrate_legacy_chat_attachments_batch(&ctx.state).await;
    assert!(migrated >= 1);

    let (new_key, nonce, key_id): (String, Option<Vec<u8>>, Option<String>) = sqlx::query_as(
        r#"SELECT attachment_key, attachment_nonce, encryption_key_id
           FROM direct_messages
           WHERE id = $1"#,
    )
    .bind(message_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_ne!(new_key, legacy_key);
    assert!(nonce.is_some());
    assert!(key_id.is_some());
    assert!(!tokio::fs::try_exists(&legacy_path).await.unwrap());

    let pm_auth = auth_header_for(patient_manager_id, "patient_manager");
    let (status, downloaded) = bytes_request(
        &app,
        "GET",
        &format!("/api/v1/messages/file/{new_key}"),
        &pm_auth,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(downloaded.as_slice(), plaintext);

    let patient_auth = auth_header_for(patient_user_id, "patient");
    let (status, _) = json_request(
        &app,
        "DELETE",
        &format!("/api/v1/messages/{patient_manager_id}/{message_id}"),
        &patient_auth,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(
        !tokio::fs::try_exists(upload_dir.join(new_key))
            .await
            .unwrap()
    );
}
