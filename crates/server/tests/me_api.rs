use axum::body::Body;
use axum::http::{Request, StatusCode};
use serde_json::{Value, json};
use sqlx::PgPool;
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

async fn multipart_upload(
    app: &axum::Router,
    path: &str,
    bearer: &str,
    text_fields: &[(&str, String)],
    file_name: &str,
    mime_type: &str,
    file_bytes: &[u8],
) -> (StatusCode, Value) {
    let boundary = format!("----gmed-boundary-{}", Uuid::new_v4().simple());
    let mut body = Vec::new();

    for (name, value) in text_fields {
        body.extend_from_slice(format!("--{boundary}\r\n").as_bytes());
        body.extend_from_slice(
            format!("Content-Disposition: form-data; name=\"{name}\"\r\n\r\n").as_bytes(),
        );
        body.extend_from_slice(value.as_bytes());
        body.extend_from_slice(b"\r\n");
    }

    body.extend_from_slice(format!("--{boundary}\r\n").as_bytes());
    body.extend_from_slice(
        format!(
            "Content-Disposition: form-data; name=\"file\"; filename=\"{file_name}\"\r\nContent-Type: {mime_type}\r\n\r\n"
        )
        .as_bytes(),
    );
    body.extend_from_slice(file_bytes);
    body.extend_from_slice(b"\r\n");
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

async fn configure_required_patient_documents(pool: &PgPool, value: Value) {
    sqlx::query(
        r#"UPDATE system_settings
           SET value = $2::jsonb
           WHERE key = $1"#,
    )
    .bind("required_patient_documents")
    .bind(value)
    .execute(pool)
    .await
    .unwrap();
}

async fn seed_order(pool: &PgPool, patient_id: Uuid, created_by: Uuid, tag: &str) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO orders (order_number, patient_id, phase, status, created_by)
           VALUES ($1, $2, 'execution', 'active', $3)
           RETURNING id"#,
    )
    .bind(format!("ORD-{tag}"))
    .bind(patient_id)
    .bind(created_by)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn seed_invoice(
    pool: &PgPool,
    order_id: Uuid,
    patient_id: Uuid,
    created_by: Uuid,
    tag: &str,
) -> Uuid {
    seed_invoice_with_status(pool, order_id, patient_id, created_by, tag, "sent").await
}

async fn seed_invoice_with_status(
    pool: &PgPool,
    order_id: Uuid,
    patient_id: Uuid,
    created_by: Uuid,
    tag: &str,
    status: &str,
) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO invoices (
                order_id, patient_id, invoice_number, invoice_type, status, due_date,
                total_net, total_vat, total_gross, paid_amount, line_items, notes, created_by
           ) VALUES (
                $1, $2, $3, 'final', $4, '2026-05-10',
                100.00, 19.00, 119.00, 0,
                $5, 'Portal-visible invoice', $6
           ) RETURNING id"#,
    )
    .bind(order_id)
    .bind(patient_id)
    .bind(format!("INV-{tag}"))
    .bind(status)
    .bind(json!([
        {
            "description": "Treatment package",
            "quantity": "1",
            "unit_price": "100.00",
            "vat_rate": "19",
            "is_cost_passthrough": false,
            "line_net": "100.00",
            "line_vat": "19.00",
            "line_gross": "119.00"
        }
    ]))
    .bind(created_by)
    .fetch_one(pool)
    .await
    .unwrap()
}

#[tokio::test]
async fn patient_can_submit_privacy_request_for_self_and_pm_gets_notification() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("me-privacy");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let patient_user_id = seed_user(&pool, &tag, "patient").await;
    let patient_manager_id = seed_user(&pool, &format!("{tag}-pm"), "patient_manager").await;

    seed_patient_assignment(&pool, patient_id, patient_user_id, admin_id).await;
    seed_patient_assignment(&pool, patient_id, patient_manager_id, admin_id).await;

    let patient_bearer = auth_header_for(patient_user_id, "patient");

    let (status, body) = json_request(
        &app,
        "POST",
        "/api/v1/me/privacy-requests",
        &patient_bearer,
        Some(json!({
            "request_type": "erasure",
            "reason": "Please delete my data"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(body["request_type"], "erasure");
    assert_eq!(body["source"], "patient_request");
    assert_eq!(body["status"], "requested");

    let (status, body) = json_request(
        &app,
        "GET",
        "/api/v1/me/privacy-requests",
        &patient_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let items = body.as_array().expect("privacy request history");
    assert_eq!(items.len(), 1);
    assert_eq!(items[0]["request_type"], "erasure");
    assert!(items[0].get("review_note").is_none());

    let notifications: i64 = sqlx::query_scalar(
        r#"SELECT count(*)
           FROM user_notifications
           WHERE user_id = $1
             AND kind = 'privacy_request'
             AND entity_type = 'patient'
             AND entity_id = $2"#,
    )
    .bind(patient_manager_id)
    .bind(patient_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(notifications, 1);

    let audit_count: i64 = sqlx::query_scalar(
        r#"SELECT count(*)
           FROM audit_log
           WHERE entity_type = 'patient'
             AND entity_id = $1
             AND action = 'privacy_request_created'"#,
    )
    .bind(patient_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(audit_count, 1);
}

#[tokio::test]
async fn patient_can_export_own_data_via_me_export() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("me-export");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let patient_user_id = seed_user(&pool, &tag, "patient").await;

    seed_patient_assignment(&pool, patient_id, patient_user_id, admin_id).await;
    let order_id = seed_order(&pool, patient_id, admin_id, &tag).await;

    let patient_bearer = auth_header_for(patient_user_id, "patient");
    let (status, body) =
        json_request(&app, "GET", "/api/v1/me/export", &patient_bearer, None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["export_type"], "DSGVO Art. 15 - Right of Access");
    assert_eq!(body["patient"]["id"], patient_id.to_string());
    let orders = body["orders"].as_array().expect("orders export array");
    assert!(orders.iter().any(|item| item["id"] == order_id.to_string()));

    let audit_count: i64 = sqlx::query_scalar(
        r#"SELECT count(*)
           FROM audit_log
           WHERE entity_type = 'patient'
             AND entity_id = $1
             AND action = 'dsgvo_data_export'"#,
    )
    .bind(patient_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(audit_count >= 1);
}

#[tokio::test]
async fn patient_can_download_own_data_export_bundle_as_zip() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("me-export-zip");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let patient_user_id = seed_user(&pool, &tag, "patient").await;

    seed_patient_assignment(&pool, patient_id, patient_user_id, admin_id).await;

    let patient_bearer = auth_header_for(patient_user_id, "patient");
    let (status, bytes) =
        bytes_request(&app, "GET", "/api/v1/me/export?format=zip", &patient_bearer).await;
    assert_eq!(status, StatusCode::OK);
    assert!(
        bytes.starts_with(b"PK"),
        "zip bundle should start with PK signature"
    );

    let audit_count: i64 = sqlx::query_scalar(
        r#"SELECT count(*)
           FROM audit_log
           WHERE entity_type = 'patient'
             AND entity_id = $1
             AND action = 'dsgvo_data_export'"#,
    )
    .bind(patient_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(audit_count >= 1);
}

#[tokio::test]
async fn patient_cannot_open_duplicate_privacy_request() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("me-privacy-dup");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let patient_user_id = seed_user(&pool, &tag, "patient").await;

    seed_patient_assignment(&pool, patient_id, patient_user_id, admin_id).await;

    let patient_bearer = auth_header_for(patient_user_id, "patient");

    let (status, _) = json_request(
        &app,
        "POST",
        "/api/v1/me/privacy-requests",
        &patient_bearer,
        Some(json!({
            "request_type": "restriction",
            "reason": "Temporary restriction"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);

    let (status, body) = json_request(
        &app,
        "POST",
        "/api/v1/me/privacy-requests",
        &patient_bearer,
        Some(json!({
            "request_type": "restriction",
            "reason": "Second request should fail"
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
async fn patient_can_submit_third_party_revoke_request_for_self() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("me-privacy-third-party");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let patient_user_id = seed_user(&pool, &tag, "patient").await;
    let patient_manager_id = seed_user(&pool, &format!("{tag}-pm"), "patient_manager").await;

    seed_patient_assignment(&pool, patient_id, patient_user_id, admin_id).await;
    seed_patient_assignment(&pool, patient_id, patient_manager_id, admin_id).await;

    let patient_bearer = auth_header_for(patient_user_id, "patient");

    let (status, body) = json_request(
        &app,
        "POST",
        "/api/v1/me/privacy-requests",
        &patient_bearer,
        Some(json!({
            "request_type": "third_party_revoke",
            "reason": "Stop sharing my data with clinics"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(body["request_type"], "third_party_revoke");
    assert_eq!(body["status"], "requested");

    let (status, body) = json_request(
        &app,
        "GET",
        "/api/v1/me/privacy-requests",
        &patient_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let items = body.as_array().expect("privacy request history");
    assert_eq!(items.len(), 1);
    assert_eq!(items[0]["request_type"], "third_party_revoke");

    let notification_count: i64 = sqlx::query_scalar(
        r#"SELECT count(*)
           FROM user_notifications
           WHERE user_id = $1
             AND kind = 'privacy_request'
             AND entity_type = 'patient'
             AND entity_id = $2"#,
    )
    .bind(patient_manager_id)
    .bind(patient_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(notification_count, 1);
}

#[tokio::test]
async fn patient_without_linked_record_cannot_submit_privacy_request() {
    let Some((app, pool, _admin_id)) = test_context().await else {
        return;
    };

    let patient_user_id = seed_user(&pool, &unique_tag("me-privacy-unlinked"), "patient").await;

    let (status, body) = json_request(
        &app,
        "POST",
        "/api/v1/me/privacy-requests",
        &auth_header_for(patient_user_id, "patient"),
        Some(json!({
            "request_type": "erasure"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(body["message"], "Linked patient record not found");
}

#[tokio::test]
async fn patient_can_see_required_document_alerts_in_portal_scope() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };

    configure_required_patient_documents(
        &pool,
        json!([
            {
                "key": "passport",
                "label": "Passport",
                "art": ["passport"]
            },
            {
                "key": "consent",
                "label": "Consent form",
                "art": ["consent_form"]
            }
        ]),
    )
    .await;

    let tag = unique_tag("me-document-alerts");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let patient_user_id = seed_user(&pool, &tag, "patient").await;

    seed_patient_assignment(&pool, patient_id, patient_user_id, admin_id).await;

    sqlx::query(
        r#"INSERT INTO documents (
                patient_id, auto_name, original_filename, art, category, status, visibility,
                is_medical, mime_type, file_size, created_by
           ) VALUES (
                $1, 'Passport scan', 'passport.pdf', 'passport', 'identity', 'active', 'internal',
                false, 'application/pdf', 1024, $2
           )"#,
    )
    .bind(patient_id)
    .bind(admin_id)
    .execute(&pool)
    .await
    .unwrap();

    let patient_bearer = auth_header_for(patient_user_id, "patient");

    let (status, body) = json_request(
        &app,
        "GET",
        "/api/v1/me/document-alerts",
        &patient_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["configured_rule_count"], 2);
    assert_eq!(body["document_pack_complete"], false);
    assert_eq!(body["missing_count"], 1);
    let missing = body["missing_documents"]
        .as_array()
        .expect("missing documents");
    assert_eq!(missing.len(), 1);
    assert_eq!(missing[0]["key"], "consent");
    assert_eq!(missing[0]["label"], "Consent form");
}

#[tokio::test]
async fn patient_can_upload_document_for_self_and_download_it() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("me-upload");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let patient_user_id = seed_user(&pool, &tag, "patient").await;
    let patient_manager_id = seed_user(&pool, &format!("{tag}-pm"), "patient_manager").await;

    seed_patient_assignment(&pool, patient_id, patient_user_id, admin_id).await;
    seed_patient_assignment(&pool, patient_id, patient_manager_id, admin_id).await;

    let patient_bearer = auth_header_for(patient_user_id, "patient");

    let (status, body) = multipart_upload(
        &app,
        "/api/v1/me/documents/upload",
        &patient_bearer,
        &[
            ("upload_kind", "medical_record".to_string()),
            ("auto_name", "Portal MRI".to_string()),
            ("notes", "Uploaded from home portal".to_string()),
        ],
        "mri.pdf",
        "application/pdf",
        b"%PDF-patient-upload%",
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let document_id = body["id"].as_str().unwrap();
    assert_eq!(body["upload_kind"], "medical_record");

    let (status, body) = json_request(
        &app,
        "GET",
        "/api/v1/me/documents/uploads",
        &patient_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let items = body.as_array().expect("patient uploads");
    assert_eq!(items.len(), 1);
    assert_eq!(items[0]["id"], document_id);
    assert_eq!(items[0]["art"], "patient_medical_upload");

    let (status, bytes) = bytes_request(
        &app,
        "GET",
        &format!("/api/v1/me/documents/uploads/{document_id}/download"),
        &patient_bearer,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(String::from_utf8_lossy(&bytes).contains("%PDF-patient-upload%"));

    let notification_count: i64 = sqlx::query_scalar(
        r#"SELECT count(*)
           FROM user_notifications
           WHERE user_id = $1
             AND kind = 'patient_upload'
             AND entity_type = 'document'"#,
    )
    .bind(patient_manager_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(notification_count, 1);
}

#[tokio::test]
async fn patient_can_list_own_invoices_and_payment_proof_status() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("me-invoices");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let patient_user_id = seed_user(&pool, &tag, "patient").await;

    seed_patient_assignment(&pool, patient_id, patient_user_id, admin_id).await;

    let order_id = seed_order(&pool, patient_id, admin_id, &tag).await;
    let invoice_id = seed_invoice(&pool, order_id, patient_id, admin_id, &tag).await;
    let patient_bearer = auth_header_for(patient_user_id, "patient");

    let (status, body) =
        json_request(&app, "GET", "/api/v1/me/invoices", &patient_bearer, None).await;
    assert_eq!(status, StatusCode::OK);
    let items = body.as_array().expect("invoice list");
    assert_eq!(items.len(), 1);
    assert_eq!(items[0]["id"], invoice_id.to_string());
    assert_eq!(items[0]["payment_proof_count"], 0);

    let (status, body) = multipart_upload(
        &app,
        "/api/v1/me/documents/upload",
        &patient_bearer,
        &[
            ("upload_kind", "payment_proof".to_string()),
            ("order_id", order_id.to_string()),
            ("auto_name", "Wire transfer receipt".to_string()),
        ],
        "receipt.pdf",
        "application/pdf",
        b"%PDF-payment-proof%",
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(body["upload_kind"], "payment_proof");

    let (status, body) =
        json_request(&app, "GET", "/api/v1/me/invoices", &patient_bearer, None).await;
    assert_eq!(status, StatusCode::OK);
    let items = body.as_array().expect("invoice list");
    assert_eq!(items.len(), 1);
    assert_eq!(items[0]["payment_proof_count"], 1);
    assert!(items[0]["last_payment_proof_at"].is_string());

    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/me/invoices/{invoice_id}"),
        &patient_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["payment_proof_count"], 1);
    assert!(body["line_items"].as_array().unwrap().len() == 1);
}

#[tokio::test]
async fn patient_cannot_see_draft_invoices_in_portal_scope() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("me-invoices-draft-hidden");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let patient_user_id = seed_user(&pool, &tag, "patient").await;

    seed_patient_assignment(&pool, patient_id, patient_user_id, admin_id).await;

    let order_id = seed_order(&pool, patient_id, admin_id, &tag).await;
    let visible_invoice_id = seed_invoice_with_status(
        &pool,
        order_id,
        patient_id,
        admin_id,
        &format!("{tag}-sent"),
        "sent",
    )
    .await;
    let draft_invoice_id = seed_invoice_with_status(
        &pool,
        order_id,
        patient_id,
        admin_id,
        &format!("{tag}-draft"),
        "draft",
    )
    .await;
    let patient_bearer = auth_header_for(patient_user_id, "patient");

    let (status, body) =
        json_request(&app, "GET", "/api/v1/me/invoices", &patient_bearer, None).await;
    assert_eq!(status, StatusCode::OK);
    let items = body.as_array().expect("invoice list");
    assert_eq!(items.len(), 1);
    assert_eq!(items[0]["id"], visible_invoice_id.to_string());
    assert_ne!(items[0]["id"], draft_invoice_id.to_string());

    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/me/invoices/{draft_invoice_id}"),
        &patient_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(body["message"], "Invoice not found");

    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/me/invoices/{visible_invoice_id}"),
        &patient_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["id"], visible_invoice_id.to_string());

    let req = Request::builder()
        .method("GET")
        .uri(format!("/api/v1/me/invoices/{draft_invoice_id}/pdf"))
        .header("Authorization", &patient_bearer)
        .body(Body::empty())
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();
    let status = resp.status();
    let bytes = axum::body::to_bytes(resp.into_body(), 1024 * 1024)
        .await
        .unwrap();
    let body: Value = serde_json::from_slice(&bytes).unwrap_or(json!(null));
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(body["message"], "Invoice not found");
}

#[tokio::test]
async fn patient_can_request_additional_service_and_assigned_staff_get_notifications() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("me-concierge-request");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let patient_user_id = seed_user(&pool, &tag, "patient").await;
    let patient_manager_id = seed_user(&pool, &tag, "patient_manager").await;
    let concierge_id = seed_user(&pool, &tag, "concierge").await;

    seed_patient_assignment(&pool, patient_id, patient_user_id, admin_id).await;
    seed_patient_assignment(&pool, patient_id, patient_manager_id, admin_id).await;
    seed_patient_assignment(&pool, patient_id, concierge_id, admin_id).await;

    let patient_bearer = auth_header_for(patient_user_id, "patient");

    let (status, body) = json_request(
        &app,
        "POST",
        "/api/v1/me/concierge-services",
        &patient_bearer,
        Some(json!({
            "service_kind": "hotel",
            "title": "Airport hotel stay",
            "vendor_name": "Motel One",
            "starts_at": "2026-04-18T12:00:00Z",
            "ends_at": "2026-04-20T10:00:00Z",
            "service_notes": "Need late check-in close to the clinic"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let service_id = body["id"].as_str().expect("service id");
    assert_eq!(body["service_kind"], "hotel");
    assert_eq!(body["request_source"], "patient_portal");
    assert_eq!(body["status"], "planned");
    assert_eq!(body["vendor_name"], "Motel One");
    assert_eq!(body["can_cancel"], true);

    let (status, body) = json_request(
        &app,
        "GET",
        "/api/v1/me/concierge-services",
        &patient_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let items = body.as_array().expect("service list");
    assert_eq!(items.len(), 1);
    assert_eq!(items[0]["id"], service_id);
    assert_eq!(items[0]["request_source"], "patient_portal");

    let concierge_notifications: i64 = sqlx::query_scalar(
        r#"SELECT count(*)
           FROM user_notifications
           WHERE user_id = $1
             AND kind = 'concierge_service_request'
             AND entity_type = 'concierge_service'"#,
    )
    .bind(concierge_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(concierge_notifications, 1);

    let pm_notifications: i64 = sqlx::query_scalar(
        r#"SELECT count(*)
           FROM user_notifications
           WHERE user_id = $1
             AND kind = 'concierge_service_request'
             AND entity_type = 'concierge_service'"#,
    )
    .bind(patient_manager_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(pm_notifications, 1);
}

#[tokio::test]
async fn patient_can_cancel_own_pending_additional_service_request() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("me-concierge-cancel");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let patient_user_id = seed_user(&pool, &tag, "patient").await;
    let concierge_id = seed_user(&pool, &tag, "concierge").await;

    seed_patient_assignment(&pool, patient_id, patient_user_id, admin_id).await;
    seed_patient_assignment(&pool, patient_id, concierge_id, admin_id).await;

    let patient_bearer = auth_header_for(patient_user_id, "patient");

    let (status, body) = json_request(
        &app,
        "POST",
        "/api/v1/me/concierge-services",
        &patient_bearer,
        Some(json!({
            "service_kind": "transfer",
            "title": "Airport pickup",
            "starts_at": "2026-04-22T09:00:00Z",
            "service_notes": "One large suitcase"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let service_id = body["id"].as_str().expect("service id");

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/me/concierge-services/{service_id}/cancel"),
        &patient_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["status"], "cancelled");
    assert_eq!(body["can_cancel"], false);

    let status_in_db: String =
        sqlx::query_scalar("SELECT status FROM concierge_services WHERE id = $1")
            .bind(Uuid::parse_str(service_id).unwrap())
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(status_in_db, "cancelled");
}

#[tokio::test]
async fn patient_sees_staff_processing_updates_for_portal_service_and_loses_cancel_right() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("me-concierge-crossflow");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let patient_user_id = seed_user(&pool, &tag, "patient").await;
    let concierge_id = seed_user(&pool, &tag, "concierge").await;
    let patient_manager_id = seed_user(&pool, &tag, "patient_manager").await;

    seed_patient_assignment(&pool, patient_id, patient_user_id, admin_id).await;
    seed_patient_assignment(&pool, patient_id, concierge_id, admin_id).await;
    seed_patient_assignment(&pool, patient_id, patient_manager_id, admin_id).await;

    let patient_bearer = auth_header_for(patient_user_id, "patient");
    let concierge_bearer = auth_header_for(concierge_id, "concierge");

    let (status, created) = json_request(
        &app,
        "POST",
        "/api/v1/me/concierge-services",
        &patient_bearer,
        Some(json!({
            "service_kind": "hotel",
            "title": "Clinic hotel coordination",
            "vendor_name": "Airport Hilton",
            "starts_at": "2026-04-24T12:00:00Z",
            "ends_at": "2026-04-26T10:00:00Z",
            "service_notes": "Please confirm a quiet room close to the clinic."
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let service_id = created["id"].as_str().expect("service id");
    assert_eq!(created["status"], "planned");
    assert_eq!(created["request_source"], "patient_portal");
    assert_eq!(created["can_cancel"], true);

    let (status, staff_queue) = json_request(
        &app,
        "GET",
        &format!("/api/v1/concierge-services?patient_id={patient_id}"),
        &concierge_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let staff_items = staff_queue.as_array().expect("staff queue");
    assert_eq!(staff_items.len(), 1);
    assert_eq!(staff_items[0]["id"], service_id);
    assert_eq!(staff_items[0]["request_source"], "patient_portal");
    assert_eq!(staff_items[0]["status"], "planned");

    let (status, updated) = json_request(
        &app,
        "POST",
        &format!("/api/v1/concierge-services/{service_id}/update"),
        &concierge_bearer,
        Some(json!({
            "status": "booked",
            "booking_reference": "HTL-7788",
            "vendor_contact": "booking@hilton.example",
            "service_notes": "Booked by concierge and confirmed with the patient."
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(updated["status"], "booked");
    assert_eq!(updated["booking_reference"], "HTL-7788");

    let (status, portal_history) = json_request(
        &app,
        "GET",
        "/api/v1/me/concierge-services",
        &patient_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let portal_items = portal_history.as_array().expect("portal history");
    assert_eq!(portal_items.len(), 1);
    assert_eq!(portal_items[0]["id"], service_id);
    assert_eq!(portal_items[0]["status"], "booked");
    assert_eq!(portal_items[0]["booking_reference"], "HTL-7788");
    assert_eq!(
        portal_items[0]["service_notes"],
        "Booked by concierge and confirmed with the patient."
    );
    assert_eq!(portal_items[0]["can_cancel"], false);
    assert_eq!(
        portal_items[0]["assigned_concierge_name"],
        format!("concierge {tag}")
    );

    let (status, cancel_body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/me/concierge-services/{service_id}/cancel"),
        &patient_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(
        cancel_body["message"],
        "Service request is already being processed and can no longer be cancelled"
    );
}

#[tokio::test]
async fn portal_service_notifications_and_staff_queue_stay_assignment_scoped() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("me-concierge-scope");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let patient_user_id = seed_user(&pool, &tag, "patient").await;
    let assigned_pm_id = seed_user(&pool, &format!("{tag}-pm"), "patient_manager").await;
    let assigned_concierge_id = seed_user(&pool, &format!("{tag}-concierge"), "concierge").await;
    let unrelated_pm_id = seed_user(&pool, &format!("{tag}-other-pm"), "patient_manager").await;
    let unrelated_concierge_id =
        seed_user(&pool, &format!("{tag}-other-concierge"), "concierge").await;

    seed_patient_assignment(&pool, patient_id, patient_user_id, admin_id).await;
    seed_patient_assignment(&pool, patient_id, assigned_pm_id, admin_id).await;
    seed_patient_assignment(&pool, patient_id, assigned_concierge_id, admin_id).await;

    let patient_bearer = auth_header_for(patient_user_id, "patient");
    let assigned_concierge_bearer = auth_header_for(assigned_concierge_id, "concierge");
    let unrelated_concierge_bearer = auth_header_for(unrelated_concierge_id, "concierge");
    let unrelated_pm_bearer = auth_header_for(unrelated_pm_id, "patient_manager");

    let (status, created) = json_request(
        &app,
        "POST",
        "/api/v1/me/concierge-services",
        &patient_bearer,
        Some(json!({
            "service_kind": "transfer",
            "title": "Airport pickup coordination",
            "starts_at": "2026-04-28T08:30:00Z",
            "service_notes": "One passenger with two bags."
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let service_id = created["id"].as_str().expect("service id");

    for (user_id, expected_count) in [(assigned_pm_id, 1_i64), (assigned_concierge_id, 1_i64)] {
        let count: i64 = sqlx::query_scalar(
            r#"SELECT count(*)
               FROM user_notifications
               WHERE user_id = $1
                 AND kind = 'concierge_service_request'
                 AND entity_type = 'concierge_service'
                 AND entity_id = $2"#,
        )
        .bind(user_id)
        .bind(Uuid::parse_str(service_id).unwrap())
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(
            count, expected_count,
            "assigned staff should get service request notification"
        );
    }

    for user_id in [unrelated_pm_id, unrelated_concierge_id] {
        let count: i64 = sqlx::query_scalar(
            r#"SELECT count(*)
               FROM user_notifications
               WHERE user_id = $1
                 AND kind = 'concierge_service_request'
                 AND entity_type = 'concierge_service'
                 AND entity_id = $2"#,
        )
        .bind(user_id)
        .bind(Uuid::parse_str(service_id).unwrap())
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(
            count, 0,
            "unrelated staff must not get portal service notifications"
        );
    }

    let (status, assigned_queue) = json_request(
        &app,
        "GET",
        &format!("/api/v1/concierge-services?patient_id={patient_id}"),
        &assigned_concierge_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let assigned_items = assigned_queue.as_array().expect("assigned concierge queue");
    assert_eq!(assigned_items.len(), 1);
    assert_eq!(assigned_items[0]["id"], service_id);
    assert_eq!(assigned_items[0]["request_source"], "patient_portal");

    let (status, unrelated_queue) = json_request(
        &app,
        "GET",
        &format!("/api/v1/concierge-services?patient_id={patient_id}"),
        &unrelated_concierge_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        unrelated_queue
            .as_array()
            .expect("unrelated concierge queue")
            .len(),
        0,
        "unrelated concierge must not see portal service row"
    );

    let (status, unrelated_pm_queue) = json_request(
        &app,
        "GET",
        &format!("/api/v1/concierge-services?patient_id={patient_id}"),
        &unrelated_pm_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        unrelated_pm_queue
            .as_array()
            .expect("unrelated pm queue")
            .len(),
        0,
        "unrelated PM must not see portal service row"
    );
}
