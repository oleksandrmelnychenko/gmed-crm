mod support;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use serde_json::{Value, json};
use sqlx::PgPool;
use tower::ServiceExt;
use uuid::Uuid;

use gmed_server::auth::jwt;
const TEST_SECRET: &str = "test-secret-at-least-32-characters-long!!";

async fn test_context() -> Option<(axum::Router, PgPool, Uuid)> {
    let ctx = support::suite_context(TEST_SECRET).await?;
    Some((ctx.app, ctx.pool, ctx.admin_id))
}

async fn wait_for_patient_audit_action(
    pool: &PgPool,
    patient_id: Uuid,
    action: &str,
    minimum_count: i64,
) -> i64 {
    support::wait_until(
        &format!("patient audit action '{action}' for {patient_id}"),
        || async move {
            let count: i64 = sqlx::query_scalar(
                r#"SELECT count(*)
                   FROM audit_log
                   WHERE entity_type = 'patient'
                     AND entity_id = $1
                     AND action = $2"#,
            )
            .bind(patient_id)
            .bind(action)
            .fetch_one(pool)
            .await
            .unwrap();
            count >= minimum_count
        },
    )
    .await;

    sqlx::query_scalar(
        r#"SELECT count(*)
           FROM audit_log
           WHERE entity_type = 'patient'
             AND entity_id = $1
             AND action = $2"#,
    )
    .bind(patient_id)
    .bind(action)
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
    let patient_id = sqlx::query_scalar(
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
    .unwrap();
    support::seed_active_portal_subscription(pool, patient_id, created_by).await;
    patient_id
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

async fn taxonomy_node_id(pool: &PgPool, code: &str) -> Uuid {
    sqlx::query_scalar("SELECT id FROM provider_taxonomy_nodes WHERE code = $1")
        .bind(code)
        .fetch_one(pool)
        .await
        .unwrap_or_else(|_| panic!("taxonomy node {code} must be seeded"))
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

    let audit_count =
        wait_for_patient_audit_action(&pool, patient_id, "privacy_request_created", 1).await;
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

    let audit_count =
        wait_for_patient_audit_action(&pool, patient_id, "dsgvo_data_export", 1).await;
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

    let audit_count =
        wait_for_patient_audit_action(&pool, patient_id, "dsgvo_data_export", 1).await;
    assert!(audit_count >= 1);
}

/// A document with a stored row only, shared with `login` on the portal.
async fn seed_shared_document(
    pool: &PgPool,
    patient_id: Uuid,
    login: Uuid,
    staff: Uuid,
    art: &str,
    category: &str,
) -> Uuid {
    let document_id = Uuid::new_v4();
    sqlx::query(
        r#"INSERT INTO documents (
                id, patient_id, auto_name, original_filename, art, category, status, visibility,
                is_medical, mime_type, file_size, version_root_document_id, version_number,
                uploaded_by, notes
           ) VALUES (
                $1, $2, $3, $4, $3, $5, 'active', 'patient_visible',
                false, 'application/pdf', 128, $1, 1, $6, 'STAFF-NOTE-document'
           )"#,
    )
    .bind(document_id)
    .bind(patient_id)
    .bind(art)
    .bind(format!("{art}.pdf"))
    .bind(category)
    .bind(staff)
    .execute(pool)
    .await
    .unwrap();
    sqlx::query(
        r#"INSERT INTO document_shares (document_id, shared_with_user_id, shared_by, channel)
           VALUES ($1, $2, $3, 'patient_portal')"#,
    )
    .bind(document_id)
    .bind(login)
    .bind(staff)
    .execute(pool)
    .await
    .unwrap();
    document_id
}

async fn seed_chat_message(pool: &PgPool, from_user: Uuid, to_user: Uuid, text: &str) {
    sqlx::query("INSERT INTO direct_messages (from_user, to_user, message) VALUES ($1, $2, $3)")
        .bind(from_user)
        .bind(to_user)
        .bind(text)
        .execute(pool)
        .await
        .unwrap();
}

fn listed_ids(export: &Value, section: &str) -> Vec<String> {
    export[section]
        .as_array()
        .unwrap_or_else(|| panic!("{section}: {export}"))
        .iter()
        .map(|item| item["id"].as_str().unwrap().to_string())
        .collect()
}

/// QA 2026-10-31: the patient's own Art. 15 download holds what the login sees
/// in the portal. AML evidence and a third party's papers stay out even with
/// a share (§ 47 GwG), and so do what staff did not release, staff notes,
/// the other parent's uploads and chat.
#[tokio::test]
async fn the_patients_own_export_holds_what_the_login_sees_in_the_portal() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };
    let tag = unique_tag("me-export-narrow");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let mother = seed_user(&pool, &format!("{tag}-mother"), "patient").await;
    let father = seed_user(&pool, &format!("{tag}-father"), "patient").await;
    let manager = seed_user(&pool, &tag, "patient_manager").await;
    for user in [mother, father, manager] {
        seed_patient_assignment(&pool, patient_id, user, admin_id).await;
    }
    let mother_bearer = auth_header_for(mother, "patient");
    let father_bearer = auth_header_for(father, "patient");
    let manager_bearer = auth_header_for(manager, "patient_manager");
    sqlx::query("UPDATE patients SET notes = 'STAFF-NOTE-patient' WHERE id = $1")
        .bind(patient_id)
        .execute(&pool)
        .await
        .unwrap();
    let order_id = seed_order(&pool, patient_id, admin_id, &tag).await;
    sqlx::query("UPDATE orders SET notes = 'STAFF-NOTE-order' WHERE id = $1")
        .bind(order_id)
        .execute(&pool)
        .await
        .unwrap();

    // Staff file three documents; only the first goes to the portal.
    let mut filed = Vec::new();
    for name in ["released", "unreleased", "signed-off"] {
        let (status, body) = multipart_upload(
            &app,
            "/api/v1/documents/upload",
            &manager_bearer,
            &[
                ("patient_id", patient_id.to_string()),
                ("auto_name", format!("{name} {tag}")),
                ("art", "arztbrief".to_string()),
                ("category", "medical".to_string()),
                ("status", "active".to_string()),
                ("visibility", "released_internal".to_string()),
                ("is_medical", "true".to_string()),
                ("notes", "STAFF-NOTE-document".to_string()),
            ],
            &format!("{name}.pdf"),
            "application/pdf",
            b"%PDF-1.4 synthetic",
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{body}");
        filed.push(body["id"].as_str().unwrap().to_string());
    }
    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/documents/{}/portal-release", filed[0]),
        &manager_bearer,
        Some(json!({ "channel": "patient_portal", "requires_confirmation": false })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");

    // Each parent uploads a document of their own.
    let mut uploads = Vec::new();
    for bearer in [&mother_bearer, &father_bearer] {
        let (status, body) = multipart_upload(
            &app,
            "/api/v1/me/documents/upload",
            bearer,
            &[("upload_kind", "medical_record".to_string())],
            "mine.pdf",
            "application/pdf",
            b"%PDF-1.4 synthetic",
        )
        .await;
        assert_eq!(status, StatusCode::CREATED, "{body}");
        uploads.push(body["id"].as_str().unwrap().to_string());
    }

    // The portal takes documents only (global QA 2026-11-10: `.exe` and `.sh`
    // were stored and shown to staff).
    for (file_name, bytes) in [
        ("qa-test.exe", b"MZ\x90\x00synthetic".as_slice()),
        ("qa-script.sh", b"#!/bin/sh\necho synthetic".as_slice()),
        ("befund.txt", b"#!/bin/sh\necho synthetic".as_slice()),
    ] {
        let (status, body) = multipart_upload(
            &app,
            "/api/v1/me/documents/upload",
            &mother_bearer,
            &[("upload_kind", "general".to_string())],
            file_name,
            "application/octet-stream",
            bytes,
        )
        .await;
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
        assert_eq!(
            body["error"], "portal_upload_type_not_allowed",
            "{file_name}"
        );
    }

    // Released by mistake, they are still closed.
    for (art, category) in [
        ("enhanced_due_diligence", "compliance_aml"),
        ("gwg_identification", "compliance_aml"),
        ("payer_identity", "identity"),
        ("payer_funds_proof", "administrative"),
    ] {
        seed_shared_document(&pool, patient_id, mother, manager, art, category).await;
    }

    // Issued, a draft, hidden, and issued without the amounts.
    let issued = seed_invoice(&pool, order_id, patient_id, admin_id, &format!("{tag}-1")).await;
    let draft = seed_invoice_with_status(
        &pool,
        order_id,
        patient_id,
        admin_id,
        &format!("{tag}-2"),
        "draft",
    )
    .await;
    let hidden = seed_invoice(&pool, order_id, patient_id, admin_id, &format!("{tag}-3")).await;
    let other_order = seed_order(&pool, patient_id, admin_id, &format!("{tag}-paid")).await;
    let no_amounts = seed_invoice(
        &pool,
        other_order,
        patient_id,
        admin_id,
        &format!("{tag}-4"),
    )
    .await;
    sqlx::query(
        r#"UPDATE invoices
           SET internal_note = 'STAFF-NOTE-invoice',
               portal_visible = (id <> $1),
               hide_amounts_from_patient = (id = $2)
           WHERE patient_id = $3"#,
    )
    .bind(hidden)
    .bind(no_amounts)
    .bind(patient_id)
    .execute(&pool)
    .await
    .unwrap();

    // A quote sent, a draft, and one of the order whose amounts are hidden.
    let quoted_order = seed_order(&pool, patient_id, admin_id, &format!("{tag}-quoted")).await;
    let mut quotes = Vec::new();
    for (suffix, order, quote_status) in [
        ("sent", quoted_order, "sent"),
        ("draft", quoted_order, "draft"),
        ("paid", other_order, "accepted"),
    ] {
        let quote: String = sqlx::query_scalar(
            r#"INSERT INTO quotes (
                    order_id, quote_number, total_net, total_vat, total_gross, status,
                    line_items, notes, internal_note, created_by
               ) VALUES ($1, $2, 100, 19, 119, $3, '[]'::jsonb, 'STAFF-NOTE-quote',
                         'STAFF-NOTE-quote', $4)
               RETURNING id::text"#,
        )
        .bind(order)
        .bind(format!("KV-{tag}-{suffix}"))
        .bind(quote_status)
        .bind(admin_id)
        .fetch_one(&pool)
        .await
        .unwrap();
        quotes.push(quote);
    }

    seed_chat_message(&pool, mother, manager, "CHAT-of-the-mother").await;
    seed_chat_message(&pool, manager, father, "CHAT-of-the-father").await;

    let (status, export) =
        json_request(&app, "GET", "/api/v1/me/export", &mother_bearer, None).await;
    assert_eq!(status, StatusCode::OK, "{export}");
    let payload = export.to_string();
    assert!(!payload.contains("STAFF-NOTE"), "{payload}");
    assert!(!payload.contains("CHAT-of-the-father"), "{payload}");
    assert!(payload.contains("CHAT-of-the-mother"), "{payload}");

    let mut documents = listed_ids(&export, "documents");
    documents.sort();
    let mut expected = vec![filed[0].clone(), uploads[0].clone()];
    expected.sort();
    assert_eq!(documents, expected, "{export}");
    assert!(!payload.contains("enhanced_due_diligence"), "{payload}");
    assert!(!payload.contains("gwg_identification"), "{payload}");
    assert!(!payload.contains("payer_identity"), "{payload}");

    let mut invoices = listed_ids(&export, "invoices");
    invoices.sort();
    let mut expected = vec![issued.to_string(), no_amounts.to_string()];
    expected.sort();
    assert_eq!(invoices, expected, "{export}");
    assert!(!invoices.contains(&draft.to_string()));
    let shown = |id: Uuid| {
        export["invoices"]
            .as_array()
            .unwrap()
            .iter()
            .find(|invoice| invoice["id"] == id.to_string())
            .unwrap()
            .clone()
    };
    assert_eq!(shown(issued)["total_gross"], "119.00", "{export}");
    assert!(shown(no_amounts)["total_gross"].is_null(), "{export}");
    assert_eq!(shown(no_amounts)["line_items"], json!([]), "{export}");

    let mut listed_quotes = listed_ids(&export, "quotes");
    listed_quotes.sort();
    let mut expected = vec![quotes[0].clone(), quotes[2].clone()];
    expected.sort();
    assert_eq!(listed_quotes, expected, "{export}");
    let quote = |id: &str| {
        export["quotes"]
            .as_array()
            .unwrap()
            .iter()
            .find(|quote| quote["id"] == id)
            .unwrap()
            .clone()
    };
    assert_eq!(quote(&quotes[0])["total_gross"], "119", "{export}");
    assert!(quote(&quotes[2])["total_gross"].is_null(), "{export}");

    for section in [
        "tasks",
        "reminders",
        "messages_manual_review",
        "medication_evidence_reviews",
        "medication_ai_analyses",
        "medication_ai_analysis_events",
    ] {
        assert!(export.get(section).is_none(), "{section}: {export}");
    }

    // The ZIP holds the same files and no others.
    let (status, bytes) =
        bytes_request(&app, "GET", "/api/v1/me/export?format=zip", &mother_bearer).await;
    assert_eq!(status, StatusCode::OK);
    let archive = zip::ZipArchive::new(std::io::Cursor::new(bytes)).unwrap();
    let mut files: Vec<String> = archive
        .file_names()
        .map(|name| name.unwrap().to_string())
        .filter(|name| name.starts_with("documents/"))
        .map(|name| name.rsplit('-').next().unwrap().to_string())
        .collect();
    files.sort();
    assert_eq!(files, ["mine.pdf", "released.pdf"], "{files:?}");

    // The staff handler still gets the whole file and reviews it.
    let path = format!("/api/v1/admin/compliance/patient/{patient_id}/export");
    let (status, full) = json_request(&app, "GET", &path, &manager_bearer, None).await;
    assert_eq!(status, StatusCode::OK, "{full}");
    let payload = full.to_string();
    assert!(payload.contains("STAFF-NOTE-patient"), "{payload}");
    assert!(payload.contains("enhanced_due_diligence"), "{payload}");
    assert_eq!(listed_ids(&full, "invoices").len(), 4, "{full}");
    assert!(payload.contains("CHAT-of-the-mother"), "{payload}");
    assert!(payload.contains("CHAT-of-the-father"), "{payload}");
    assert_eq!(full["messages_manual_review"], json!([]), "{full}");

    // A parent with another child: his chat concerns that child too, so it
    // is named for manual handling instead of going into this patient's file.
    let sibling = seed_patient(&pool, admin_id, &format!("{tag}-sibling")).await;
    seed_patient_assignment(&pool, sibling, father, admin_id).await;
    let (status, full) = json_request(&app, "GET", &path, &manager_bearer, None).await;
    assert_eq!(status, StatusCode::OK, "{full}");
    let payload = full.to_string();
    assert!(payload.contains("CHAT-of-the-mother"), "{payload}");
    assert!(!payload.contains("CHAT-of-the-father"), "{payload}");
    let manual = full["messages_manual_review"].as_array().unwrap();
    assert_eq!(manual.len(), 1, "{full}");
    assert_eq!(manual[0]["user_id"], father.to_string(), "{full}");
    assert_eq!(manual[0]["message_count"], 1, "{full}");

    // So is a login whose access to the patient ended.
    sqlx::query(
        "UPDATE patient_assignments SET revoked_at = now() WHERE patient_id = $1 AND user_id = $2",
    )
    .bind(patient_id)
    .bind(mother)
    .execute(&pool)
    .await
    .unwrap();
    let (status, full) = json_request(&app, "GET", &path, &manager_bearer, None).await;
    assert_eq!(status, StatusCode::OK, "{full}");
    assert!(!full.to_string().contains("CHAT-of-the-mother"), "{full}");
    assert_eq!(
        full["messages_manual_review"].as_array().unwrap().len(),
        2,
        "{full}"
    );
}

/// QA 2026-11-13 F-B2: the staff's Art. 15 export holds the patient's own data
/// only, like the patient's own download: the payer's GwG sheet (person or
/// organisation), the payer's Selbstauskunft, the declaration on the third
/// party's cost coverage and a representative's ID scan are named as not
/// included, without their name, notes or file.
#[tokio::test]
async fn the_staff_export_leaves_out_other_persons_documents() {
    use std::io::Read;

    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };
    let tag = unique_tag("staff-export-third-party");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let manager = seed_user(&pool, &tag, "patient_manager").await;
    seed_patient_assignment(&pool, patient_id, manager, admin_id).await;
    let manager_bearer = auth_header_for(manager, "patient_manager");

    let mut filed = Vec::new();
    for name in [
        "own-passport",
        "own-gwg-sheet",
        "payer-gwg-sheet",
        "organisation-gwg-sheet",
        "payer-selbstauskunft",
        "payer-statement",
        "parent-passport",
    ] {
        let (status, body) = multipart_upload(
            &app,
            "/api/v1/documents/upload",
            &manager_bearer,
            &[
                ("patient_id", patient_id.to_string()),
                ("auto_name", format!("{name} THIRD-PARTY-NAME {tag}")),
                ("art", "arztbrief".to_string()),
                ("category", "administrative".to_string()),
                ("status", "active".to_string()),
                ("visibility", "released_internal".to_string()),
                ("is_medical", "false".to_string()),
                ("notes", "THIRD-PARTY-NOTE".to_string()),
            ],
            &format!("{name}.pdf"),
            "application/pdf",
            b"%PDF-1.4 synthetic",
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{body}");
        filed.push(Uuid::parse_str(body["id"].as_str().unwrap()).unwrap());
    }
    for (index, (art, template, bindings)) in [
        ("passport", None, Value::Null),
        (
            "gwg_identification",
            Some("gwg_identification"),
            json!({"gwg_identification": {"subject": "contract_partner"}}),
        ),
        (
            "gwg_identification",
            Some("gwg_identification"),
            json!({"gwg_identification": {"subject": "payer"}}),
        ),
        (
            "gwg_identification",
            Some("gwg_identification"),
            json!({"gwg_identification": {"subject": "payer", "form": "legal_entity"}}),
        ),
        (
            "payer_self_disclosure",
            Some("payer_self_disclosure"),
            Value::Null,
        ),
        (
            "patient_payer_statement",
            Some("patient_payer_statement"),
            Value::Null,
        ),
        ("representative_identity", None, Value::Null),
    ]
    .into_iter()
    .enumerate()
    {
        sqlx::query(
            r#"UPDATE documents
               SET art = $2, generated_template_id = $3,
                   generated_bindings = CASE WHEN $4::jsonb = 'null'::jsonb THEN NULL ELSE $4::jsonb END
               WHERE id = $1"#,
        )
        .bind(filed[index])
        .bind(art)
        .bind(template)
        .bind(&bindings)
        .execute(&pool)
        .await
        .unwrap();
    }

    let path = format!("/api/v1/admin/compliance/patient/{patient_id}/export");
    let (status, full) = json_request(&app, "GET", &path, &manager_bearer, None).await;
    assert_eq!(status, StatusCode::OK, "{full}");
    let documents = full["documents"].as_array().unwrap();
    assert_eq!(documents.len(), 7, "{full}");
    for document in documents {
        let id = Uuid::parse_str(document["id"].as_str().unwrap()).unwrap();
        let own = id == filed[0] || id == filed[1];
        assert_eq!(document["other_person"] == json!(true), !own, "{document}");
        if !own {
            assert!(document.get("auto_name").is_none(), "{document}");
            assert!(document.get("notes").is_none(), "{document}");
        }
    }
    let payload = full.to_string();
    assert_eq!(payload.matches("THIRD-PARTY-NOTE").count(), 2, "{payload}");
    assert_eq!(payload.matches("THIRD-PARTY-NAME").count(), 2, "{payload}");

    let (status, bytes) =
        bytes_request(&app, "GET", &format!("{path}?format=zip"), &manager_bearer).await;
    assert_eq!(status, StatusCode::OK);
    let mut archive = zip::ZipArchive::new(std::io::Cursor::new(bytes)).unwrap();
    let mut files: Vec<String> = archive
        .file_names()
        .map(|name| name.unwrap().to_string())
        .filter(|name| name.starts_with("documents/"))
        .map(|name| name.rsplit('-').next().unwrap().to_string())
        .collect();
    files.sort();
    assert_eq!(files, ["passport.pdf", "sheet.pdf"], "{files:?}");
    let mut readme = String::new();
    archive
        .by_name("README.txt")
        .unwrap()
        .read_to_string(&mut readme)
        .unwrap();
    assert!(
        readme.contains("документ третьего лица — не включён"),
        "{readme}"
    );
    for kind in [
        "payer_self_disclosure",
        "patient_payer_statement",
        "representative_identity",
    ] {
        assert!(readme.contains(kind), "{kind}: {readme}");
    }
    assert!(!readme.contains("THIRD-PARTY-NAME"), "{readme}");
    assert!(!readme.contains("selbstauskunft"), "{readme}");
}

/// QA 2026-10-31: the staff's note on an order event stays with the staff.
#[tokio::test]
async fn an_order_event_reaches_the_patient_without_the_staff_note() {
    let Some(suite) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let tag = unique_tag("order-note");
    let patient_id = seed_patient(&suite.pool, suite.admin_id, &tag).await;
    let login = seed_user(&suite.pool, &tag, "patient").await;
    let manager = seed_user(&suite.pool, &tag, "patient_manager").await;
    seed_patient_assignment(&suite.pool, patient_id, login, suite.admin_id).await;
    seed_patient_assignment(&suite.pool, patient_id, manager, suite.admin_id).await;
    let order_id = seed_order(&suite.pool, patient_id, suite.admin_id, &tag).await;

    gmed_server::realtime::publish_order_event(
        &suite.state,
        Some(suite.admin_id),
        "order.phase_changed",
        order_id,
        json!({ "phase": "execution", "note": "Zahlung erst nach Rueckruf" }),
    )
    .await;

    let events: Vec<(Vec<Uuid>, Value)> = sqlx::query_as(
        "SELECT target_user_ids, payload FROM realtime_events
         WHERE event_type = 'order.phase_changed' AND entity_id = $1",
    )
    .bind(order_id)
    .fetch_all(&suite.pool)
    .await
    .unwrap();
    assert_eq!(events.len(), 2, "{events:?}");
    let portal = events
        .iter()
        .find(|(users, _)| users.contains(&login))
        .unwrap();
    assert_eq!(portal.0, vec![login], "{events:?}");
    assert_eq!(portal.1, json!({ "phase": "execution" }), "{events:?}");
    let staff = events
        .iter()
        .find(|(users, _)| users.contains(&manager))
        .unwrap();
    assert_eq!(staff.1["note"], "Zahlung erst nach Rueckruf", "{events:?}");
    assert!(!staff.0.contains(&login), "{events:?}");
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

    let document_id = Uuid::new_v4();
    sqlx::query(
        r#"INSERT INTO documents (
                id, patient_id, auto_name, original_filename, art, category, status, visibility,
                is_medical, mime_type, file_size, version_root_document_id, version_number, uploaded_by
           ) VALUES (
                $1, $2, 'Passport scan', 'passport.pdf', 'passport', 'identity', 'active', 'internal',
                false, 'application/pdf', 1024, $1, 1, $3
           )"#,
    )
    .bind(document_id)
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
    let required_documents = body["required_documents"]
        .as_array()
        .expect("required document alerts");
    let passport = required_documents
        .iter()
        .find(|rule| rule["key"] == "passport")
        .expect("passport alert");
    assert_eq!(passport["fulfilled"], true);
    assert!(
        passport["matching_documents"]
            .as_array()
            .expect("passport matches")
            .is_empty()
    );
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
    // QA 2026-10-31: staff write the same column, so it stays out.
    assert!(items[0].get("notes").is_none(), "{body}");

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
async fn patient_identity_upload_is_stored_as_a_passport_scan() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("me-upload-identity");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let patient_user_id = seed_user(&pool, &tag, "patient").await;
    seed_patient_assignment(&pool, patient_id, patient_user_id, admin_id).await;
    let patient_bearer = auth_header_for(patient_user_id, "patient");

    let (status, body) = multipart_upload(
        &app,
        "/api/v1/me/documents/upload",
        &patient_bearer,
        &[
            ("upload_kind", "identity_document".to_string()),
            ("auto_name", "Reisepass".to_string()),
        ],
        "reisepass.pdf",
        "application/pdf",
        b"%PDF-passport-upload%",
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(body["upload_kind"], "identity_document");
    let document_id = body["id"].as_str().unwrap();

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
    // The type and category the required "passport" document accepts.
    assert_eq!(items[0]["art"], "passport_scan");
    assert_eq!(items[0]["category"], "identity");
    assert_eq!(items[0]["is_medical"], false);
    assert_eq!(items[0]["visibility"], "internal");
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
            ("auto_name", format!("Wire transfer receipt INV-{tag}")),
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
    let hotel_taxonomy_id = taxonomy_node_id(&pool, "nonmedical_hotels").await;

    let (status, body) = json_request(
        &app,
        "POST",
        "/api/v1/me/concierge-services",
        &patient_bearer,
        Some(json!({
            "service_kind": "hotel",
            "taxonomy_node_id": hotel_taxonomy_id,
            "title": "Airport hotel stay",
            "vendor_name": "Motel One",
            "starts_at": "2099-04-18T12:00:00Z",
            "ends_at": "2099-04-20T10:00:00Z",
            "service_notes": "Need late check-in close to the clinic"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let service_id = body["id"].as_str().expect("service id");
    assert_eq!(body["service_kind"], "hotel");
    assert_eq!(body["taxonomy_node_id"], hotel_taxonomy_id.to_string());
    assert_eq!(body["taxonomy_node_code"], "nonmedical_hotels");
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
    assert_eq!(items[0]["taxonomy_node_id"], hotel_taxonomy_id.to_string());
    assert_eq!(items[0]["taxonomy_node_code"], "nonmedical_hotels");
    assert_eq!(items[0]["request_source"], "patient_portal");

    let medical_taxonomy_id = taxonomy_node_id(&pool, "medical_pharmacies").await;
    let (status, body) = json_request(
        &app,
        "POST",
        "/api/v1/me/concierge-services",
        &patient_bearer,
        Some(json!({
            "service_kind": "hotel",
            "taxonomy_node_id": medical_taxonomy_id,
            "title": "Invalid medical taxonomy"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(
        body["message"],
        "taxonomy_node_id must reference an active non-medical taxonomy leaf"
    );

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
            "starts_at": "2099-04-22T09:00:00Z",
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
            "starts_at": "2099-04-24T12:00:00Z",
            "ends_at": "2099-04-26T10:00:00Z",
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

    let (status, rejected) = json_request(
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
    assert_eq!(status, StatusCode::CONFLICT, "{rejected}");

    let provider_id: Uuid = sqlx::query_scalar(
        "INSERT INTO providers (name, provider_type) VALUES ($1, 'non_medical') RETURNING id",
    )
    .bind(format!("Airport Hilton {tag}"))
    .fetch_one(&pool)
    .await
    .unwrap();
    let (status, booked) = json_request(
        &app,
        "POST",
        &format!("/api/v1/concierge-services/{service_id}/book-provider"),
        &concierge_bearer,
        Some(json!({
            "request_id": Uuid::new_v4(),
            "provider_id": provider_id,
            "booking_state": "requested",
            "channel": "email",
            "booking_reference": "HTL-7788",
            "vendor_contact": "booking@hilton.example",
            "starts_at": "2026-04-24T12:00:00Z",
            "ends_at": "2026-04-26T10:00:00Z",
            "service_address": "Airport hotel, Munich",
            "note": "Booking requested by concierge."
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{booked}");
    assert_eq!(booked["service"]["status"], "booked");
    // The name the patient gave stays; the partner booking fills only an
    // empty vendor name (concierge QA 2026-11-12 D-5).
    assert_eq!(booked["service"]["vendor_name"], "Airport Hilton");
    // The patient is told that the booking was requested (D-3 / B S2-1).
    let booking_notices: i64 = sqlx::query_scalar(
        r#"SELECT COUNT(*) FROM user_notifications
           WHERE user_id = $1
             AND kind = 'patient_service_status_changed'
             AND entity_id = $2::uuid"#,
    )
    .bind(patient_user_id)
    .bind(service_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(booking_notices, 1);
    let (status, updated) = json_request(
        &app,
        "POST",
        &format!("/api/v1/concierge-services/{service_id}/update"),
        &concierge_bearer,
        Some(json!({
            "service_notes": "INTERNAL: partner overcharges, negotiate.",
            "patient_visible_note": "Booked by concierge and confirmed with the patient.",
            "patient_note": "Staff must not be able to replace this."
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(updated["status"], "booked");
    assert_eq!(updated["booking_reference"], "HTL-7788");
    assert_eq!(
        updated["service_notes"],
        "INTERNAL: partner overcharges, negotiate."
    );
    assert_eq!(
        updated["patient_note"],
        "Please confirm a quiet room close to the clinic."
    );

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
        portal_items[0]["patient_visible_note"],
        "Booked by concierge and confirmed with the patient."
    );
    assert_eq!(
        portal_items[0]["patient_note"],
        "Please confirm a quiet room close to the clinic."
    );
    assert!(
        !portal_history.to_string().contains("INTERNAL"),
        "the internal staff note must never reach the portal: {portal_history}"
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

/// Release QA S2-1 (owner decision 2026-11-11): staff keep an internal note,
/// write a separate note for the patient, and never change the patient's
/// own request note; the portal API carries none of the internal text and
/// no amount of the internal calculation.
#[tokio::test]
async fn portal_service_api_never_carries_internal_staff_text() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("me-concierge-note-split");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let patient_user_id = seed_user(&pool, &tag, "patient").await;
    let patient_manager_id = seed_user(&pool, &format!("{tag}-pm"), "patient_manager").await;
    seed_patient_assignment(&pool, patient_id, patient_user_id, admin_id).await;
    seed_patient_assignment(&pool, patient_id, patient_manager_id, admin_id).await;
    let patient_bearer = auth_header_for(patient_user_id, "patient");
    let pm_bearer = auth_header_for(patient_manager_id, "patient_manager");

    // A staff-created service with every kind of staff text.
    let (status, staff_created) = json_request(
        &app,
        "POST",
        "/api/v1/concierge-services",
        &pm_bearer,
        Some(json!({
            "patient_id": patient_id,
            "service_kind": "transfer",
            "title": "Airport transfer",
            "booking_reference": "BOOK-SPLIT-1",
            "vendor_name": "Synthetic Taxi GmbH",
            "vendor_contact": "INTERNAL-CONTACT dispatcher line",
            "cost_estimate": 987.65,
            "service_notes": "INTERNAL-NOTE vendor overcharges, negotiate",
            "billing_notes": "INTERNAL-BILLING pass through at cost",
            "patient_visible_note": "Your driver waits at exit B."
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{staff_created}");
    assert_eq!(
        staff_created["service_notes"],
        "INTERNAL-NOTE vendor overcharges, negotiate"
    );
    assert_eq!(
        staff_created["patient_visible_note"],
        "Your driver waits at exit B."
    );

    // A patient request whose own note staff then try to overwrite.
    let (status, requested) = json_request(
        &app,
        "POST",
        "/api/v1/me/concierge-services",
        &patient_bearer,
        Some(json!({
            "service_kind": "hotel",
            "title": "Hotel near the clinic",
            "patient_note": "Ground floor room, please.",
            "patient_budget": 450
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{requested}");
    assert_eq!(requested["patient_note"], "Ground floor room, please.");
    // The patient's budget has its own field (owner 2026-11-11); the internal
    // estimate is not prefilled from it.
    assert_eq!(requested["patient_budget"], "450.00");
    assert!(requested.get("cost_estimate").is_none(), "{requested}");
    let request_id = requested["id"].as_str().expect("request id").to_string();

    let (status, staff_view) = json_request(
        &app,
        "GET",
        &format!("/api/v1/concierge-services/{request_id}"),
        &pm_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{staff_view}");
    assert_eq!(staff_view["patient_note"], "Ground floor room, please.");
    assert!(staff_view["service_notes"].is_null());
    assert_eq!(staff_view["patient_budget"], "450.00");
    assert!(staff_view["cost_estimate"].is_null(), "{staff_view}");

    let (status, saved) = json_request(
        &app,
        "POST",
        &format!("/api/v1/concierge-services/{request_id}/update"),
        &pm_bearer,
        Some(json!({
            "service_notes": "INTERNAL-NOTE second request",
            "patient_note": "INTERNAL-OVERWRITE attempt",
            "patient_budget": 1.11,
            "cost_estimate": 123.45
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{saved}");
    assert_eq!(saved["service_notes"], "INTERNAL-NOTE second request");
    assert_eq!(saved["patient_note"], "Ground floor room, please.");
    // Staff set their own estimate; the patient's budget stays as requested.
    assert_eq!(saved["cost_estimate"], "123.45");
    assert_eq!(saved["patient_budget"], "450.00");

    // Owner decision 2026-11-12: the concierge may change the internal
    // estimate too; it stays internal like the PM's.
    let concierge_id = seed_user(&pool, &format!("{tag}-concierge"), "concierge").await;
    seed_patient_assignment(&pool, patient_id, concierge_id, admin_id).await;
    let concierge_bearer = auth_header_for(concierge_id, "concierge");
    let (status, concierge_saved) = json_request(
        &app,
        "POST",
        &format!("/api/v1/concierge-services/{request_id}/update"),
        &concierge_bearer,
        Some(json!({ "cost_estimate": 234.56 })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{concierge_saved}");
    assert_eq!(concierge_saved["cost_estimate"], "234.56");
    assert_eq!(concierge_saved["patient_budget"], "450.00");
    let stored_patient_budget: Option<rust_decimal::Decimal> =
        sqlx::query_scalar("SELECT patient_budget FROM concierge_services WHERE id = $1")
            .bind(Uuid::parse_str(&request_id).unwrap())
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(
        stored_patient_budget
            .map(|value| value.to_string())
            .as_deref(),
        Some("450.00")
    );
    let stored_patient_note: Option<String> =
        sqlx::query_scalar("SELECT patient_request_note FROM concierge_services WHERE id = $1")
            .bind(Uuid::parse_str(&request_id).unwrap())
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(
        stored_patient_note.as_deref(),
        Some("Ground floor room, please.")
    );

    let (status, portal) = json_request(
        &app,
        "GET",
        "/api/v1/me/concierge-services",
        &patient_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{portal}");
    let serialized = portal.to_string();
    for hidden in ["INTERNAL", "987.65", "123.45", "234.56"] {
        assert!(
            !serialized.contains(hidden),
            "{hidden} must not reach the portal: {portal}"
        );
    }
    let items = portal.as_array().expect("portal services");
    assert_eq!(items.len(), 2);
    for item in items {
        for key in [
            "service_notes",
            "billing_notes",
            "vendor_contact",
            "cost_estimate",
            "actual_cost",
            "unit_price",
            "quantity",
        ] {
            assert!(item.get(key).is_none(), "portal item carries {key}: {item}");
        }
    }
    let transfer = items
        .iter()
        .find(|item| item["title"] == "Airport transfer")
        .expect("staff-created service");
    assert_eq!(
        transfer["patient_visible_note"],
        "Your driver waits at exit B."
    );
    assert_eq!(transfer["booking_reference"], "BOOK-SPLIT-1");
    assert_eq!(transfer["vendor_name"], "Synthetic Taxi GmbH");
    let hotel = items
        .iter()
        .find(|item| item["title"] == "Hotel near the clinic")
        .expect("patient request");
    assert_eq!(hotel["patient_note"], "Ground floor room, please.");
    assert!(hotel["patient_visible_note"].is_null());
    // «Ваш бюджет»: the patient's own amount, unchanged by the staff save.
    assert_eq!(hotel["patient_budget"], "450.00");
    assert!(transfer["patient_budget"].is_null());
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
            "starts_at": "2099-04-28T08:30:00Z",
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

#[tokio::test]
async fn me_reports_the_role_capabilities() {
    let Some((app, pool, _admin_id)) = test_context().await else {
        return;
    };
    let tag = Uuid::new_v4().simple().to_string();

    let sales_id = seed_user(&pool, &format!("me-caps-{tag}"), "sales").await;
    let (status, body) = json_request(
        &app,
        "GET",
        "/api/v1/me",
        &auth_header_for(sales_id, "sales"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let capabilities = body["capabilities"]
        .as_array()
        .expect("capabilities array")
        .iter()
        .filter_map(Value::as_str)
        .collect::<Vec<_>>();
    assert!(capabilities.contains(&"leads.edit"), "{capabilities:?}");
    assert!(capabilities.contains(&"chat.use"), "{capabilities:?}");
    assert!(!capabilities.contains(&"patients.view"), "{capabilities:?}");

    let it_admin_id = seed_user(&pool, &format!("me-caps-{tag}"), "it_admin").await;
    let (status, body) = json_request(
        &app,
        "GET",
        "/api/v1/me",
        &auth_header_for(it_admin_id, "it_admin"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let capabilities = body["capabilities"]
        .as_array()
        .expect("capabilities array")
        .iter()
        .filter_map(Value::as_str)
        .collect::<Vec<_>>();
    assert!(capabilities.contains(&"users.manage"), "{capabilities:?}");
    assert!(
        !capabilities.contains(&"users.manage_ceo"),
        "{capabilities:?}"
    );
    assert!(!capabilities.contains(&"patients.view"), "{capabilities:?}");
}

/// Owner 2026-10-26: the idle sign-out is a CEO setting (15–720 minutes,
/// 0 = off) that every signed-in client, patient logins included, reads from
/// `GET /me`.
#[tokio::test]
async fn me_carries_the_idle_logout_minutes_the_ceo_set() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };
    let tag = Uuid::new_v4().simple().to_string();
    let ceo = auth_header_for(admin_id, "ceo");
    let path = "/api/v1/admin/settings/idle_logout_minutes";

    for invalid in ["14", "721", "-1"] {
        let (status, body) =
            json_request(&app, "POST", path, &ceo, Some(json!({ "value": invalid }))).await;
        assert_eq!(
            status,
            StatusCode::UNPROCESSABLE_ENTITY,
            "{invalid}: {body}"
        );
    }

    let it_admin_id = seed_user(&pool, &format!("me-idle-{tag}"), "it_admin").await;
    let (status, body) = json_request(
        &app,
        "POST",
        path,
        &auth_header_for(it_admin_id, "it_admin"),
        Some(json!({ "value": "45" })),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN, "{body}");
    assert_eq!(body["error"], "business_setting_ceo_only");

    let (status, body) =
        json_request(&app, "POST", path, &ceo, Some(json!({ "value": "45" }))).await;
    assert_eq!(status, StatusCode::OK, "{body}");

    let patient_id = seed_user(&pool, &format!("me-idle-{tag}"), "patient").await;
    for (user_id, role) in [(patient_id, "patient"), (it_admin_id, "it_admin")] {
        let (status, body) = json_request(
            &app,
            "GET",
            "/api/v1/me",
            &auth_header_for(user_id, role),
            None,
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{role}: {body}");
        assert_eq!(body["idle_logout_minutes"], json!(45), "{role}: {body}");
    }

    let (status, body) =
        json_request(&app, "POST", path, &ceo, Some(json!({ "value": "0" }))).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let (_, body) = json_request(
        &app,
        "GET",
        "/api/v1/me",
        &auth_header_for(patient_id, "patient"),
        None,
    )
    .await;
    assert_eq!(body["idle_logout_minutes"], json!(0), "{body}");

    let (status, body) =
        json_request(&app, "POST", path, &ceo, Some(json!({ "value": "120" }))).await;
    assert_eq!(status, StatusCode::OK, "{body}");
}
