mod support;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use serde_json::{Value, json};
use sqlx::PgPool;
use tower::ServiceExt;
use uuid::Uuid;

use gmed_server::auth::jwt;

const TEST_SECRET: &str = "test-secret-at-least-32-characters-long!!";
const TINY_TRANSPARENT_PNG: &[u8] = &[
    137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0,
    0, 0, 31, 21, 196, 137, 0, 0, 0, 13, 73, 68, 65, 84, 8, 29, 99, 248, 255, 255, 255, 127, 0, 9,
    251, 3, 253, 5, 67, 69, 202, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130,
];

fn auth_header_for(user_id: Uuid, role: &str) -> String {
    let token = jwt::issue_access_token(TEST_SECRET, user_id, role, Uuid::new_v4()).unwrap();
    format!("Bearer {token}")
}

async fn seed_user(pool: &PgPool, role: &str, tag: &str) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO users (email, password_hash, name, role)
           VALUES ($1, 'test-hash', $2, $3)
           RETURNING id"#,
    )
    .bind(format!("{tag}-{role}@example.test"))
    .bind(format!("{role} {tag}"))
    .bind(role)
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
    let request = Request::builder()
        .method(method)
        .uri(path)
        .header("Authorization", bearer)
        .header("Content-Type", "application/json")
        .body(match body {
            Some(value) => Body::from(serde_json::to_vec(&value).unwrap()),
            None => Body::empty(),
        })
        .unwrap();
    let response = app.clone().oneshot(request).await.unwrap();
    let status = response.status();
    let bytes = axum::body::to_bytes(response.into_body(), 4 * 1024 * 1024)
        .await
        .unwrap();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(json!(null)),
    )
}

async fn bytes_request(app: &axum::Router, path: &str, bearer: &str) -> (StatusCode, Vec<u8>) {
    let request = Request::builder()
        .method("GET")
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
    fields: &[(&str, String)],
    file_name: &str,
    mime_type: &str,
    file_bytes: &[u8],
) -> (StatusCode, Value) {
    let boundary = format!("----gmed-p0-{}", Uuid::new_v4().simple());
    let mut body = Vec::new();
    for (name, value) in fields {
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
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(json!(null)),
    )
}

#[tokio::test]
async fn internal_notes_support_crud_encrypted_attachments_and_staff_only_access() {
    let Some(ctx) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let tag = Uuid::new_v4().simple().to_string();
    let sales_id = seed_user(&ctx.pool, "sales", &tag).await;
    let patient_id = seed_user(&ctx.pool, "patient", &tag).await;
    let ceo = auth_header_for(ctx.admin_id, "ceo");
    let sales = auth_header_for(sales_id, "sales");
    let patient = auth_header_for(patient_id, "patient");

    let (status, created) = json_request(
        &ctx.app,
        "POST",
        "/api/v1/internal-notes",
        &ceo,
        Some(json!({
            "title": format!("P0 handover {tag}"),
            "body": "Operational handover without medical data"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{created}");
    let note_id = created["id"].as_str().expect("note id");

    let (status, sales_list) =
        json_request(&ctx.app, "GET", "/api/v1/internal-notes", &sales, None).await;
    assert_eq!(status, StatusCode::OK, "{sales_list}");
    assert!(
        sales_list
            .as_array()
            .is_some_and(|rows| rows.iter().any(|row| row["id"] == note_id))
    );

    let (status, denied) =
        json_request(&ctx.app, "GET", "/api/v1/internal-notes", &patient, None).await;
    assert_eq!(status, StatusCode::FORBIDDEN, "{denied}");

    let attachment_path = format!("/api/v1/internal-notes/{note_id}/attachments");
    let (status, with_attachment) = multipart_upload(
        &ctx.app,
        &attachment_path,
        &ceo,
        &[],
        "handover.png",
        "image/png",
        TINY_TRANSPARENT_PNG,
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{with_attachment}");
    let attachment_id = with_attachment["attachments"][0]["id"]
        .as_str()
        .expect("attachment id");
    assert_eq!(
        with_attachment["attachments"][0]["file_name"],
        "handover.png"
    );

    let download_path =
        format!("/api/v1/internal-notes/{note_id}/attachments/{attachment_id}/download");
    let (status, bytes) = bytes_request(&ctx.app, &download_path, &sales).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(bytes, TINY_TRANSPARENT_PNG);

    let (status, updated) = json_request(
        &ctx.app,
        "POST",
        &format!("/api/v1/internal-notes/{note_id}/update"),
        &ceo,
        Some(json!({
            "title": format!("P0 handover updated {tag}"),
            "body": "Updated operational handover",
            "expected_updated_at": with_attachment["updated_at"]
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{updated}");
    assert_eq!(updated["title"], format!("P0 handover updated {tag}"));
}

#[tokio::test]
async fn provider_documents_link_medical_files_to_both_provider_and_patient_with_rbac() {
    let Some(ctx) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let tag = Uuid::new_v4().simple().to_string();
    let concierge_id = seed_user(&ctx.pool, "concierge", &tag).await;
    let interpreter_id = seed_user(&ctx.pool, "interpreter", &tag).await;
    let patient_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO patients (patient_id, first_name, last_name, birth_date, gender, created_by)
           VALUES ($1, 'Provider', 'Document', '1990-01-01', 'diverse', $2)
           RETURNING id"#,
    )
    .bind(format!("P0-{tag}"))
    .bind(ctx.admin_id)
    .fetch_one(&ctx.pool)
    .await
    .unwrap();
    let provider_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO providers (name, provider_type)
           VALUES ($1, 'medical') RETURNING id"#,
    )
    .bind(format!("P0 Clinic {tag}"))
    .fetch_one(&ctx.pool)
    .await
    .unwrap();
    let ceo = auth_header_for(ctx.admin_id, "ceo");
    let concierge = auth_header_for(concierge_id, "concierge");
    let interpreter = auth_header_for(interpreter_id, "interpreter");
    let path = format!("/api/v1/providers/{provider_id}/documents");

    let fields = [
        ("title", format!("Linked medical file {tag}")),
        ("patient_id", patient_id.to_string()),
        ("is_medical", "true".to_string()),
        ("notes", "Provider-origin medical document".to_string()),
    ];
    let (status, uploaded) = multipart_upload(
        &ctx.app,
        &path,
        &ceo,
        &fields,
        "provider-medical.png",
        "image/png",
        TINY_TRANSPARENT_PNG,
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{uploaded}");
    let document_id = uploaded["id"].as_str().expect("document id");
    assert_eq!(uploaded["patient_id"], patient_id.to_string());

    let (status, visible) = json_request(
        &ctx.app,
        "GET",
        &format!("{path}?patient_id={patient_id}"),
        &concierge,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{visible}");
    assert_eq!(visible.as_array().map(Vec::len), Some(1));
    assert_eq!(visible[0]["id"], document_id);
    assert_eq!(visible[0]["patient_id"], patient_id.to_string());
    assert_eq!(visible[0]["is_medical"], true);

    let (status, denied_list) = json_request(&ctx.app, "GET", &path, &interpreter, None).await;
    assert_eq!(status, StatusCode::FORBIDDEN, "{denied_list}");
    let (status, denied_upload) = multipart_upload(
        &ctx.app,
        &path,
        &concierge,
        &fields,
        "forbidden.png",
        "image/png",
        TINY_TRANSPARENT_PNG,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN, "{denied_upload}");

    let linked: (Uuid, Uuid) = sqlx::query_as(
        r#"SELECT link.provider_id, document.patient_id
           FROM provider_document_links link
           JOIN documents document ON document.id = link.document_id
           WHERE link.document_id = $1"#,
    )
    .bind(Uuid::parse_str(document_id).unwrap())
    .fetch_one(&ctx.pool)
    .await
    .unwrap();
    assert_eq!(linked, (provider_id, patient_id));
}

#[tokio::test]
async fn operations_workspaces_enforce_the_release_role_matrix() {
    let Some(ctx) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let tag = Uuid::new_v4().simple().to_string();
    let billing_id = seed_user(&ctx.pool, "billing", &tag).await;
    let concierge_id = seed_user(&ctx.pool, "concierge", &tag).await;
    let manager_id = seed_user(&ctx.pool, "patient_manager", &tag).await;
    let patient_id = seed_user(&ctx.pool, "patient", &tag).await;
    let ceo = auth_header_for(ctx.admin_id, "ceo");
    let billing = auth_header_for(billing_id, "billing");
    let concierge = auth_header_for(concierge_id, "concierge");
    let manager = auth_header_for(manager_id, "patient_manager");
    let patient = auth_header_for(patient_id, "patient");

    for bearer in [&ceo, &billing, &concierge] {
        let (status, body) = json_request(
            &ctx.app,
            "GET",
            "/api/v1/concierge-operational-items",
            bearer,
            None,
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{body}");
    }
    for bearer in [&manager, &patient] {
        let (status, body) = json_request(
            &ctx.app,
            "GET",
            "/api/v1/concierge-operational-items",
            bearer,
            None,
        )
        .await;
        assert_eq!(status, StatusCode::FORBIDDEN, "{body}");
    }

    for bearer in [&ceo, &billing] {
        let (status, body) = json_request(
            &ctx.app,
            "GET",
            "/api/v1/company-financial-position",
            bearer,
            None,
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{body}");
    }
    for bearer in [&concierge, &manager, &patient] {
        let (status, body) = json_request(
            &ctx.app,
            "GET",
            "/api/v1/company-financial-position",
            bearer,
            None,
        )
        .await;
        assert_eq!(status, StatusCode::FORBIDDEN, "{body}");
    }
}
