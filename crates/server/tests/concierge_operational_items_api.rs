mod support;

use std::{
    io::{Cursor, Write},
    time::Duration,
};

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

fn auth_header_for(user_id: Uuid, role: &str) -> String {
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
    let bytes = axum::body::to_bytes(response.into_body(), 1024 * 1024)
        .await
        .unwrap();
    let payload = serde_json::from_slice(&bytes).unwrap_or(json!(null));
    (status, payload)
}

async fn multipart_file_request(
    app: &axum::Router,
    path: &str,
    bearer: &str,
    file_name: &str,
    mime_type: &str,
    data: &[u8],
) -> (StatusCode, Value) {
    let boundary = format!("----gmed-task-attachment-{}", Uuid::new_v4().simple());
    let mut body = Vec::new();
    body.extend_from_slice(format!("--{boundary}\r\n").as_bytes());
    body.extend_from_slice(
        format!(
            "Content-Disposition: form-data; name=\"file\"; filename=\"{file_name}\"\r\nContent-Type: {mime_type}\r\n\r\n"
        )
        .as_bytes(),
    );
    body.extend_from_slice(data);
    body.extend_from_slice(format!("\r\n--{boundary}--\r\n").as_bytes());
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
    let bytes = axum::body::to_bytes(response.into_body(), 1024 * 1024)
        .await
        .unwrap();
    let payload = serde_json::from_slice(&bytes).unwrap_or(json!(null));
    (status, payload)
}

async fn raw_request(
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
    let bytes = axum::body::to_bytes(response.into_body(), 25 * 1024 * 1024)
        .await
        .unwrap();
    (status, bytes.to_vec())
}

fn minimal_docx_bytes() -> Vec<u8> {
    let mut archive = zip::ZipWriter::new(Cursor::new(Vec::new()));
    let options = zip::write::SimpleFileOptions::default();
    archive.start_file("[Content_Types].xml", options).unwrap();
    archive
        .write_all(br#"<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>"#)
        .unwrap();
    archive.start_file("word/document.xml", options).unwrap();
    archive
        .write_all(br#"<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"/>"#)
        .unwrap();
    archive.finish().unwrap().into_inner()
}

async fn seed_user(pool: &PgPool, role: &str, tag: &str) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO users (email, password_hash, name, role)
           VALUES ($1, 'test-hash', $2, $3)
           RETURNING id"#,
    )
    .bind(format!("{tag}@example.test"))
    .bind(format!("Operational User {tag}"))
    .bind(role)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn seed_patient(pool: &PgPool, created_by: Uuid, tag: &str) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO patients (
               patient_id, first_name, last_name, birth_date, gender, created_by
           ) VALUES ($1, 'Operational', 'Test', '1990-01-01', 'diverse', $2)
           RETURNING id"#,
    )
    .bind(format!("OPS-{tag}"))
    .bind(created_by)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn seed_provider(pool: &PgPool, provider_type: &str, tag: &str) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO providers (name, provider_type)
           VALUES ($1, $2)
           RETURNING id"#,
    )
    .bind(format!("Operational Provider {tag}"))
    .bind(provider_type)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn seed_service(
    pool: &PgPool,
    patient_id: Uuid,
    provider_id: Uuid,
    concierge_id: Uuid,
    created_by: Uuid,
    title: &str,
) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO concierge_services (
               patient_id, provider_id, assigned_concierge_id, service_kind, title, created_by
           ) VALUES ($1, $2, $3, 'other', $4, $5)
           RETURNING id"#,
    )
    .bind(patient_id)
    .bind(provider_id)
    .bind(concierge_id)
    .bind(title)
    .bind(created_by)
    .fetch_one(pool)
    .await
    .unwrap()
}

#[tokio::test]
async fn operational_staff_only_see_their_scope_and_same_rank_cannot_edit_anothers_task() {
    let Some(ctx) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let tag = Uuid::new_v4().simple().to_string();
    let concierge_id = seed_user(&ctx.pool, "concierge", &format!("owner-{tag}")).await;
    let other_id = seed_user(&ctx.pool, "concierge", &format!("other-{tag}")).await;
    let billing_id = seed_user(&ctx.pool, "billing", &format!("manager-{tag}")).await;
    let patient_id = seed_patient(&ctx.pool, ctx.admin_id, &tag).await;
    let provider_id = seed_provider(&ctx.pool, "non_medical", &tag).await;
    let service_id = seed_service(
        &ctx.pool,
        patient_id,
        provider_id,
        concierge_id,
        ctx.admin_id,
        "Driver coordination",
    )
    .await;
    let bearer = auth_header_for(concierge_id, "concierge");
    let other_bearer = auth_header_for(other_id, "concierge");
    let billing_bearer = auth_header_for(billing_id, "billing");
    let path = "/api/v1/concierge-operational-items";

    let (status, task) = json_request(
        &ctx.app,
        "POST",
        path,
        &bearer,
        Some(json!({
            "request_id": Uuid::new_v4(),
            "kind": "task",
            "title": "Confirm the driver",
            "note": "Call before pickup",
            "concierge_service_id": service_id,
            "due_at": "2026-08-20T09:00:00Z",
            "priority": "high"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{task}");
    assert_eq!(task["kind"], "task");
    assert_eq!(task["assigned_to"], concierge_id.to_string());
    assert_eq!(task["note"], "Call before pickup");
    assert_eq!(task["concierge_service_id"], service_id.to_string());
    assert!(task.get("patient_id").is_none());
    assert!(task.get("order_id").is_none());
    assert!(task.get("appointment_id").is_none());
    assert!(task.get("description").is_none());
    let task_id = Uuid::parse_str(task["id"].as_str().expect("task id")).unwrap();

    let (status, service_list) = json_request(
        &ctx.app,
        "GET",
        "/api/v1/concierge-services?mine_only=true",
        &bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{service_list}");
    let converted_service = service_list
        .as_array()
        .and_then(|rows| rows.iter().find(|row| row["id"] == service_id.to_string()))
        .expect("converted service");
    assert_eq!(converted_service["linked_task_id"], task_id.to_string());

    let (status, duplicate_conversion) = json_request(
        &ctx.app,
        "POST",
        path,
        &bearer,
        Some(json!({
            "request_id": Uuid::new_v4(),
            "kind": "task",
            "title": "Duplicate driver task",
            "concierge_service_id": service_id,
            "due_at": "2026-08-20T09:30:00Z",
            "priority": "normal"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{duplicate_conversion}");
    assert_eq!(
        duplicate_conversion["message"],
        "Concierge service request already converted to a task"
    );

    let (status, event) = json_request(
        &ctx.app,
        "POST",
        path,
        &bearer,
        Some(json!({
            "request_id": Uuid::new_v4(),
            "kind": "event",
            "title": "Key pickup",
            "starts_at": "2026-08-20T10:00:00Z",
            "ends_at": "2026-08-20T10:30:00Z",
            "location": "Main entrance"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{event}");
    assert_eq!(event["kind"], "event");
    assert_eq!(event["location"], "Main entrance");

    let (status, list) = json_request(&ctx.app, "GET", path, &bearer, None).await;
    assert_eq!(status, StatusCode::OK, "{list}");
    assert_eq!(list.as_array().expect("operational list").len(), 2);

    let (status, other_list) = json_request(&ctx.app, "GET", path, &other_bearer, None).await;
    assert_eq!(status, StatusCode::OK, "{other_list}");
    assert!(other_list.as_array().expect("other list").is_empty());

    let (status, manager_list) = json_request(&ctx.app, "GET", path, &billing_bearer, None).await;
    assert_eq!(status, StatusCode::OK, "{manager_list}");
    assert_eq!(manager_list.as_array().map(Vec::len), Some(2));

    let update_path = format!("{path}/{task_id}/update");
    let update_body = json!({
        "expected_updated_at": task["updated_at"],
        "kind": "task",
        "title": "Driver confirmed",
        "note": "Pickup point agreed",
        "concierge_service_id": service_id,
        "due_at": "2026-08-20T09:15:00Z",
        "priority": "normal",
        "status": "in_progress"
    });
    let (status, forbidden) = json_request(
        &ctx.app,
        "POST",
        &update_path,
        &other_bearer,
        Some(update_body.clone()),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN, "{forbidden}");

    let (status, updated) = json_request(
        &ctx.app,
        "POST",
        &update_path,
        &bearer,
        Some(update_body.clone()),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{updated}");
    assert_eq!(updated["status"], "in_progress");
    assert!(updated["completed_at"].is_null());

    let (status, stale_update) =
        json_request(&ctx.app, "POST", &update_path, &bearer, Some(update_body)).await;
    assert_eq!(status, StatusCode::CONFLICT, "{stale_update}");
    let (status, current) = json_request(
        &ctx.app,
        "GET",
        &update_path.replace("/update", ""),
        &bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{current}");
    assert_eq!(current["item"]["status"], "in_progress");

    let (status, manager_completed) = json_request(
        &ctx.app,
        "POST",
        &format!("{path}/{task_id}/status"),
        &billing_bearer,
        Some(json!({
            "expected_updated_at": current["item"]["updated_at"],
            "status": "completed"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{manager_completed}");
    assert_eq!(manager_completed["status"], "completed");

    let (status, generic) = json_request(
        &ctx.app,
        "GET",
        &format!("/api/v1/tasks/{task_id}"),
        &bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{generic}");
    assert_eq!(generic["id"], task_id.to_string());

    let row: (String, Option<Uuid>, Option<Uuid>, Option<Uuid>) = sqlx::query_as(
        "SELECT task_scope, patient_id, order_id, appointment_id FROM tasks WHERE id = $1",
    )
    .bind(task_id)
    .fetch_one(&ctx.pool)
    .await
    .unwrap();
    assert_eq!(row.0, "general");
    assert_eq!((row.1, row.2, row.3), (None, None, None));
}

#[tokio::test]
async fn service_generated_task_claims_unassigned_service_and_keeps_expense_link_on_reassignment() {
    let Some(ctx) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let tag = Uuid::new_v4().simple().to_string();
    let first_concierge_id =
        seed_user(&ctx.pool, "concierge", &format!("service-task-first-{tag}")).await;
    let second_concierge_id = seed_user(
        &ctx.pool,
        "concierge",
        &format!("service-task-second-{tag}"),
    )
    .await;
    let patient_id = seed_patient(&ctx.pool, ctx.admin_id, &tag).await;
    let provider_id = seed_provider(&ctx.pool, "non_medical", &tag).await;
    let service_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO concierge_services (
               patient_id, provider_id, service_kind, title, created_by
           ) VALUES ($1, $2, 'chauffeur', 'Airport driver', $3)
           RETURNING id"#,
    )
    .bind(patient_id)
    .bind(provider_id)
    .bind(ctx.admin_id)
    .fetch_one(&ctx.pool)
    .await
    .unwrap();
    let ceo_bearer = auth_header_for(ctx.admin_id, "ceo");
    let path = "/api/v1/concierge-operational-items";

    let (status, created) = json_request(
        &ctx.app,
        "POST",
        path,
        &ceo_bearer,
        Some(json!({
            "request_id": Uuid::new_v4(),
            "kind": "task",
            "title": "Запрос: Шофёр",
            "assigned_to": first_concierge_id,
            "concierge_service_id": service_id,
            "due_at": "2026-08-27T18:00:00Z",
            "priority": "normal"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{created}");
    assert_eq!(created["concierge_service_id"], service_id.to_string());
    let assigned_after_create: Option<Uuid> =
        sqlx::query_scalar("SELECT assigned_concierge_id FROM concierge_services WHERE id = $1")
            .bind(service_id)
            .fetch_one(&ctx.pool)
            .await
            .unwrap();
    assert_eq!(assigned_after_create, Some(first_concierge_id));

    let task_id = Uuid::parse_str(created["id"].as_str().unwrap()).unwrap();
    let (status, updated) = json_request(
        &ctx.app,
        "POST",
        &format!("{path}/{task_id}/update"),
        &ceo_bearer,
        Some(json!({
            "expected_updated_at": created["updated_at"],
            "kind": "task",
            "title": "Запрос: Шофёр",
            "assigned_to": second_concierge_id,
            "concierge_service_id": service_id,
            "due_at": "2026-08-27T18:00:00Z",
            "priority": "normal",
            "status": "open"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{updated}");
    assert_eq!(updated["assigned_to"], second_concierge_id.to_string());
    assert_eq!(updated["concierge_service_id"], service_id.to_string());
    let assigned_after_update: Option<Uuid> =
        sqlx::query_scalar("SELECT assigned_concierge_id FROM concierge_services WHERE id = $1")
            .bind(service_id)
            .fetch_one(&ctx.pool)
            .await
            .unwrap();
    assert_eq!(assigned_after_update, Some(second_concierge_id));
}

#[tokio::test]
async fn terminal_tasks_can_be_archived_filtered_restored_and_keep_history() {
    let Some(ctx) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let tag = Uuid::new_v4().simple().to_string();
    let creator_id = seed_user(&ctx.pool, "concierge", &format!("archive-owner-{tag}")).await;
    let creator_bearer = auth_header_for(creator_id, "concierge");
    let ceo_bearer = auth_header_for(ctx.admin_id, "ceo");
    let path = "/api/v1/concierge-operational-items";

    let (status, created) = json_request(
        &ctx.app,
        "POST",
        path,
        &creator_bearer,
        Some(json!({
            "request_id": Uuid::new_v4(),
            "kind": "task",
            "title": "Archive completed coordination",
            "due_at": "2026-08-23T12:00:00Z",
            "priority": "normal"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{created}");
    let task_id = Uuid::parse_str(created["id"].as_str().expect("task id")).unwrap();
    let archive_path = format!("{path}/{task_id}/archive");
    let restore_path = format!("{path}/{task_id}/restore");

    let (status, active_rejected) =
        json_request(&ctx.app, "POST", &archive_path, &ceo_bearer, None).await;
    assert_eq!(
        status,
        StatusCode::UNPROCESSABLE_ENTITY,
        "{active_rejected}"
    );

    let (status, in_progress) = json_request(
        &ctx.app,
        "POST",
        &format!("{path}/{task_id}/status"),
        &creator_bearer,
        Some(json!({
            "expected_updated_at": created["updated_at"],
            "status": "in_progress"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{in_progress}");
    let (status, completed) = json_request(
        &ctx.app,
        "POST",
        &format!("{path}/{task_id}/status"),
        &creator_bearer,
        Some(json!({
            "expected_updated_at": in_progress["updated_at"],
            "status": "completed"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{completed}");

    let (status, archived) = json_request(&ctx.app, "POST", &archive_path, &ceo_bearer, None).await;
    assert_eq!(status, StatusCode::OK, "{archived}");
    assert_eq!(archived["status"], "completed");
    assert!(archived["archived_at"].is_string());
    assert_eq!(archived["archived_by"], ctx.admin_id.to_string());

    let (status, default_list) = json_request(&ctx.app, "GET", path, &creator_bearer, None).await;
    assert_eq!(status, StatusCode::OK, "{default_list}");
    assert!(
        !default_list
            .as_array()
            .expect("default task list")
            .iter()
            .any(|item| item["id"] == task_id.to_string())
    );
    let (status, archive_list) = json_request(
        &ctx.app,
        "GET",
        &format!("{path}?archive=archived"),
        &creator_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{archive_list}");
    assert!(
        archive_list
            .as_array()
            .expect("archive task list")
            .iter()
            .any(|item| item["id"] == task_id.to_string())
    );

    let (status, detail) = json_request(
        &ctx.app,
        "GET",
        &format!("{path}/{task_id}"),
        &creator_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{detail}");
    assert!(
        detail["history"]
            .as_array()
            .expect("task history")
            .iter()
            .any(|event| event["event_type"] == "archived")
    );

    let (status, restored) = json_request(&ctx.app, "POST", &restore_path, &ceo_bearer, None).await;
    assert_eq!(status, StatusCode::OK, "{restored}");
    assert_eq!(restored["status"], "completed");
    assert!(restored["archived_at"].is_null());
    assert!(restored["archived_by"].is_null());

    let event_count: i64 = sqlx::query_scalar(
        r#"SELECT count(*)
           FROM concierge_operational_task_events
           WHERE task_id = $1 AND event_type IN ('archived', 'restored')"#,
    )
    .bind(task_id)
    .fetch_one(&ctx.pool)
    .await
    .unwrap();
    assert_eq!(event_count, 2);
    let notification_count: i64 = sqlx::query_scalar(
        r#"SELECT count(*)
           FROM user_notifications
           WHERE user_id = $1
             AND entity_id = $2
             AND kind IN ('operational_task_archived', 'operational_task_restored')"#,
    )
    .bind(creator_id)
    .bind(task_id)
    .fetch_one(&ctx.pool)
    .await
    .unwrap();
    assert_eq!(notification_count, 2);
}

#[tokio::test]
async fn ceo_can_assign_operational_items_to_ceo_and_billing() {
    let Some(ctx) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let tag = Uuid::new_v4().simple().to_string();
    let billing_id = seed_user(&ctx.pool, "billing", &format!("billing-{tag}")).await;
    let ceo_bearer = auth_header_for(ctx.admin_id, "ceo");
    let billing_bearer = auth_header_for(billing_id, "billing");
    let path = "/api/v1/concierge-operational-items";

    let (status, billing_task) = json_request(
        &ctx.app,
        "POST",
        path,
        &ceo_bearer,
        Some(json!({
            "request_id": Uuid::new_v4(),
            "kind": "task",
            "title": "Reconcile patient payment",
            "assigned_to": billing_id,
            "priority": "high"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{billing_task}");
    assert_eq!(billing_task["assigned_to"], billing_id.to_string());

    let (status, ceo_task) = json_request(
        &ctx.app,
        "POST",
        path,
        &ceo_bearer,
        Some(json!({
            "request_id": Uuid::new_v4(),
            "kind": "event",
            "title": "Executive review",
            "assigned_to": ctx.admin_id,
            "starts_at": "2026-08-21T09:00:00Z",
            "priority": "normal"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{ceo_task}");
    assert_eq!(ceo_task["assigned_to"], ctx.admin_id.to_string());

    let (status, billing_items) = json_request(&ctx.app, "GET", path, &billing_bearer, None).await;
    assert_eq!(status, StatusCode::OK, "{billing_items}");
    let billing_items = billing_items.as_array().expect("billing operational list");
    assert_eq!(billing_items.len(), 1);
    assert!(
        billing_items
            .iter()
            .any(|item| item["assigned_to"] == billing_id.to_string())
    );
}

#[tokio::test]
async fn operational_item_create_is_idempotent_for_replay_drift_and_concurrency() {
    let Some(ctx) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let tag = Uuid::new_v4().simple().to_string();
    let concierge_id = seed_user(&ctx.pool, "concierge", &format!("create-idem-{tag}")).await;
    let other_id = seed_user(&ctx.pool, "concierge", &format!("create-other-{tag}")).await;
    let patient_id = seed_patient(&ctx.pool, ctx.admin_id, &format!("create-idem-{tag}")).await;
    let provider_id = seed_provider(&ctx.pool, "non_medical", &format!("create-idem-{tag}")).await;
    let service_id = seed_service(
        &ctx.pool,
        patient_id,
        provider_id,
        concierge_id,
        ctx.admin_id,
        "Idempotent driver coordination",
    )
    .await;
    let bearer = auth_header_for(concierge_id, "concierge");
    let path = "/api/v1/concierge-operational-items";
    let request_id = Uuid::new_v4();
    let body = json!({
        "request_id": request_id,
        "kind": "task",
        "title": "Create exactly once",
        "note": "Stable normalized payload",
        "concierge_service_id": service_id,
        "due_at": "2026-08-20T09:00:00Z",
        "priority": "high"
    });

    let (first_status, first) =
        json_request(&ctx.app, "POST", path, &bearer, Some(body.clone())).await;
    assert_eq!(first_status, StatusCode::CREATED, "{first}");
    let (replay_status, replay) =
        json_request(&ctx.app, "POST", path, &bearer, Some(body.clone())).await;
    assert_eq!(replay_status, StatusCode::OK, "{replay}");
    assert_eq!(first["id"], replay["id"]);

    let mut drifted = body.clone();
    drifted["title"] = json!("Different task");
    let (drift_status, drift) = json_request(&ctx.app, "POST", path, &bearer, Some(drifted)).await;
    assert_eq!(drift_status, StatusCode::CONFLICT, "{drift}");

    let concurrent_request_id = Uuid::new_v4();
    let concurrent_body = json!({
        "request_id": concurrent_request_id,
        "kind": "event",
        "title": "Concurrent create",
        "starts_at": "2026-08-20T10:00:00Z",
        "ends_at": "2026-08-20T10:30:00Z",
        "location": "Main entrance"
    });
    let (concurrent_first, concurrent_second) = tokio::join!(
        json_request(
            &ctx.app,
            "POST",
            path,
            &bearer,
            Some(concurrent_body.clone()),
        ),
        json_request(&ctx.app, "POST", path, &bearer, Some(concurrent_body)),
    );
    assert!(
        (concurrent_first.0 == StatusCode::CREATED && concurrent_second.0 == StatusCode::OK)
            || (concurrent_first.0 == StatusCode::OK && concurrent_second.0 == StatusCode::CREATED),
        "first={:?} {} second={:?} {}",
        concurrent_first.0,
        concurrent_first.1,
        concurrent_second.0,
        concurrent_second.1,
    );
    assert_eq!(concurrent_first.1["id"], concurrent_second.1["id"]);

    sqlx::query("UPDATE concierge_services SET assigned_concierge_id = $2 WHERE id = $1")
        .bind(service_id)
        .bind(other_id)
        .execute(&ctx.pool)
        .await
        .unwrap();
    sqlx::query("UPDATE users SET is_active = false WHERE id = $1")
        .bind(concierge_id)
        .execute(&ctx.pool)
        .await
        .unwrap();
    let (mutable_replay_status, mutable_replay) =
        json_request(&ctx.app, "POST", path, &bearer, Some(body.clone())).await;
    assert_eq!(mutable_replay_status, StatusCode::OK, "{mutable_replay}");
    assert_eq!(first["id"], mutable_replay["id"]);

    let first_task_id = Uuid::parse_str(first["id"].as_str().expect("first task id")).unwrap();
    sqlx::query("UPDATE tasks SET assigned_to = $2, updated_at = now() WHERE id = $1")
        .bind(first_task_id)
        .bind(other_id)
        .execute(&ctx.pool)
        .await
        .unwrap();
    let (revoked_replay_status, revoked_replay) =
        json_request(&ctx.app, "POST", path, &bearer, Some(body)).await;
    assert_eq!(revoked_replay_status, StatusCode::OK, "{revoked_replay}");
    assert_eq!(revoked_replay["id"], first["id"]);

    let request_rows: i64 = sqlx::query_scalar(
        r#"SELECT count(*)
           FROM concierge_operational_item_create_requests
           WHERE request_id IN ($1, $2)"#,
    )
    .bind(request_id)
    .bind(concurrent_request_id)
    .fetch_one(&ctx.pool)
    .await
    .unwrap();
    assert_eq!(request_rows, 2);
    let created_task_rows: i64 = sqlx::query_scalar(
        r#"SELECT count(*)
           FROM tasks
           WHERE id IN ($1, $2) AND task_scope = 'general'"#,
    )
    .bind(first_task_id)
    .bind(
        Uuid::parse_str(
            concurrent_first.1["id"]
                .as_str()
                .expect("concurrent task id"),
        )
        .unwrap(),
    )
    .fetch_one(&ctx.pool)
    .await
    .unwrap();
    assert_eq!(created_task_rows, 2);
}

#[tokio::test]
async fn operational_item_api_rejects_clinical_payload_and_medical_service_links() {
    let Some(ctx) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let tag = Uuid::new_v4().simple().to_string();
    let concierge_id = seed_user(&ctx.pool, "concierge", &format!("privacy-{tag}")).await;
    let patient_id = seed_patient(&ctx.pool, ctx.admin_id, &format!("privacy-{tag}")).await;
    let provider_id = seed_provider(&ctx.pool, "medical", &format!("medical-{tag}")).await;
    let service_id = seed_service(
        &ctx.pool,
        patient_id,
        provider_id,
        concierge_id,
        ctx.admin_id,
        "Clinical coordination",
    )
    .await;
    let bearer = auth_header_for(concierge_id, "concierge");
    let path = "/api/v1/concierge-operational-items";

    let (status, missing_request_id) = json_request(
        &ctx.app,
        "POST",
        path,
        &bearer,
        Some(json!({
            "kind": "task",
            "title": "Missing idempotency key"
        })),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::UNPROCESSABLE_ENTITY,
        "{missing_request_id}"
    );

    let (status, unknown_field) = json_request(
        &ctx.app,
        "POST",
        path,
        &bearer,
        Some(json!({
            "request_id": Uuid::new_v4(),
            "kind": "task",
            "title": "Unsafe task",
            "diagnosis": "Sensitive clinical detail"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{unknown_field}");

    let (status, medical_link) = json_request(
        &ctx.app,
        "POST",
        path,
        &bearer,
        Some(json!({
            "request_id": Uuid::new_v4(),
            "kind": "task",
            "title": "Unsafe linked service",
            "concierge_service_id": service_id
        })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{medical_link}");
}

#[tokio::test]
async fn internal_and_external_task_audiences_round_trip_with_their_context() {
    let Some(ctx) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let tag = Uuid::new_v4().simple().to_string();
    let concierge_id = seed_user(&ctx.pool, "concierge", &format!("audience-{tag}")).await;
    let patient_id = seed_patient(&ctx.pool, ctx.admin_id, &format!("audience-{tag}")).await;
    let provider_id = seed_provider(&ctx.pool, "non_medical", &format!("audience-{tag}")).await;
    let bearer = auth_header_for(concierge_id, "concierge");
    let path = "/api/v1/concierge-operational-items";

    let (status, internal) = json_request(
        &ctx.app,
        "POST",
        path,
        &bearer,
        Some(json!({
            "request_id": Uuid::new_v4(),
            "kind": "task",
            "title": "Prepare patient arrival",
            "task_audience": "internal",
            "patient_id": patient_id,
            "due_at": "2026-08-24T09:00:00Z"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{internal}");
    assert_eq!(internal["task_audience"], "internal");
    assert_eq!(internal["patient_id"], patient_id.to_string());
    assert!(internal["patient_name"].is_string());
    assert!(internal["external_assignee_name"].is_null());

    let (status, external) = json_request(
        &ctx.app,
        "POST",
        path,
        &bearer,
        Some(json!({
            "request_id": Uuid::new_v4(),
            "kind": "task",
            "title": "Confirm airport pickup",
            "task_audience": "external",
            "provider_id": provider_id,
            "external_assignee_type": "driver",
            "external_assignee_name": "Berlin Driver GmbH",
            "external_assignee_phone": "+49 30 123456",
            "external_assignee_email": "dispatch@example.test",
            "due_at": "2026-08-24T10:00:00Z"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{external}");
    assert_eq!(external["task_audience"], "external");
    assert_eq!(external["provider_id"], provider_id.to_string());
    assert!(external["provider_name"].is_string());
    assert_eq!(external["external_assignee_type"], "driver");
    assert_eq!(external["external_assignee_name"], "Berlin Driver GmbH");

    let (status, invalid_external) = json_request(
        &ctx.app,
        "POST",
        path,
        &bearer,
        Some(json!({
            "request_id": Uuid::new_v4(),
            "kind": "task",
            "title": "Missing external recipient",
            "task_audience": "external",
            "external_assignee_type": "driver"
        })),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::UNPROCESSABLE_ENTITY,
        "{invalid_external}"
    );

    let (status, filtered) = json_request(
        &ctx.app,
        "GET",
        &format!("{path}?task_audience=internal&patient_id={patient_id}"),
        &bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{filtered}");
    assert_eq!(filtered.as_array().map(Vec::len), Some(1));
    assert_eq!(filtered[0]["id"], internal["id"]);
}

#[tokio::test]
async fn patient_manager_can_access_and_create_operational_items() {
    let Some(ctx) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let tag = Uuid::new_v4().simple().to_string();
    let manager_id = seed_user(&ctx.pool, "patient_manager", &format!("manager-{tag}")).await;
    let inactive_id = seed_user(&ctx.pool, "interpreter", &format!("inactive-{tag}")).await;
    sqlx::query("UPDATE users SET is_active = false WHERE id = $1")
        .bind(inactive_id)
        .execute(&ctx.pool)
        .await
        .unwrap();
    let bearer = auth_header_for(manager_id, "patient_manager");
    let path = "/api/v1/concierge-operational-items";

    let (list_status, list) = json_request(&ctx.release_app, "GET", path, &bearer, None).await;
    assert_eq!(list_status, StatusCode::OK, "{list}");

    let (create_status, create) = json_request(
        &ctx.release_app,
        "POST",
        path,
        &bearer,
        Some(json!({
            "request_id": Uuid::new_v4(),
            "kind": "task",
            "title": "Prepare patient documents"
        })),
    )
    .await;
    assert_eq!(create_status, StatusCode::CREATED, "{create}");
    assert_eq!(create["assigned_to"], manager_id.to_string());

    let (assignees_status, assignees) = json_request(
        &ctx.release_app,
        "GET",
        &format!("{path}/assignees"),
        &bearer,
        None,
    )
    .await;
    assert_eq!(assignees_status, StatusCode::OK, "{assignees}");
    assert!(
        assignees
            .as_array()
            .is_some_and(|rows| rows.iter().any(|row| row["id"] == manager_id.to_string()))
    );
    assert!(
        assignees
            .as_array()
            .is_some_and(|rows| rows.iter().all(|row| row["id"] != inactive_id.to_string()))
    );

    let (notifications_status, notifications) = json_request(
        &ctx.release_app,
        "GET",
        "/api/v1/notifications",
        &bearer,
        None,
    )
    .await;
    assert_eq!(notifications_status, StatusCode::OK, "{notifications}");

    let (files_status, files) = json_request(
        &ctx.release_app,
        "GET",
        "/api/v1/concierge-operational-attachments",
        &bearer,
        None,
    )
    .await;
    assert_eq!(files_status, StatusCode::OK, "{files}");

    let (patients_status, patients) =
        json_request(&ctx.release_app, "GET", "/api/v1/patients", &bearer, None).await;
    assert_eq!(patients_status, StatusCode::FORBIDDEN, "{patients}");
}

#[tokio::test]
async fn hierarchy_controls_mutations_and_task_notifications_are_delivered() {
    let Some(ctx) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let tag = Uuid::new_v4().simple().to_string();
    let creator_id = seed_user(&ctx.pool, "teamlead_interpreter", &format!("creator-{tag}")).await;
    let same_rank_id = seed_user(&ctx.pool, "concierge", &format!("same-rank-{tag}")).await;
    let assignee_id = seed_user(&ctx.pool, "interpreter", &format!("assignee-{tag}")).await;
    let billing_id = seed_user(&ctx.pool, "billing", &format!("billing-higher-{tag}")).await;
    let creator_bearer = auth_header_for(creator_id, "teamlead_interpreter");
    let same_rank_bearer = auth_header_for(same_rank_id, "concierge");
    let assignee_bearer = auth_header_for(assignee_id, "interpreter");
    let billing_bearer = auth_header_for(billing_id, "billing");
    let ceo_bearer = auth_header_for(ctx.admin_id, "ceo");
    let path = "/api/v1/concierge-operational-items";

    let (status, denied_assignment) = json_request(
        &ctx.app,
        "POST",
        path,
        &assignee_bearer,
        Some(json!({
            "request_id": Uuid::new_v4(),
            "kind": "task",
            "title": "Cannot assign upward",
            "assigned_to": billing_id,
            "priority": "normal"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN, "{denied_assignment}");

    let (status, task) = json_request(
        &ctx.app,
        "POST",
        path,
        &creator_bearer,
        Some(json!({
            "request_id": Uuid::new_v4(),
            "kind": "task",
            "title": "Arrange transfer",
            "assigned_to": assignee_id,
            "priority": "normal"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{task}");
    assert_eq!(task["assigned_by_role"], "teamlead_interpreter");
    let task_id = Uuid::parse_str(task["id"].as_str().expect("task id")).unwrap();
    let update_path = format!("{path}/{task_id}/update");
    let update_body = json!({
        "expected_updated_at": task["updated_at"],
        "kind": "task",
        "title": "Arrange transfer and driver",
        "assigned_to": assignee_id,
        "priority": "high",
        "status": "in_progress"
    });

    let assignee_notifications: i64 = sqlx::query_scalar(
        r#"SELECT count(*) FROM user_notifications
           WHERE user_id = $1 AND kind = 'operational_task_assigned'
             AND entity_type = 'concierge_task' AND entity_id = $2"#,
    )
    .bind(assignee_id)
    .bind(task_id)
    .fetch_one(&ctx.pool)
    .await
    .unwrap();
    assert_eq!(assignee_notifications, 1);

    for bearer in [&same_rank_bearer, &assignee_bearer, &billing_bearer] {
        let (status, denied) = json_request(
            &ctx.app,
            "POST",
            &update_path,
            bearer,
            Some(update_body.clone()),
        )
        .await;
        assert_eq!(status, StatusCode::FORBIDDEN, "{denied}");
    }

    let status_path = format!("{path}/{task_id}/status");
    let (status, denied_status) = json_request(
        &ctx.app,
        "POST",
        &status_path,
        &same_rank_bearer,
        Some(json!({
            "expected_updated_at": task["updated_at"],
            "status": "in_progress"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN, "{denied_status}");

    let (status, rejected_status_edit) = json_request(
        &ctx.app,
        "POST",
        &status_path,
        &assignee_bearer,
        Some(json!({
            "expected_updated_at": task["updated_at"],
            "status": "in_progress",
            "title": "Assignee must not edit task content through status endpoint"
        })),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::UNPROCESSABLE_ENTITY,
        "{rejected_status_edit}"
    );

    let (status, assignee_updated) = json_request(
        &ctx.app,
        "POST",
        &status_path,
        &assignee_bearer,
        Some(json!({
            "expected_updated_at": task["updated_at"],
            "status": "in_progress"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{assignee_updated}");
    assert_eq!(assignee_updated["status"], "in_progress");
    assert_eq!(assignee_updated["title"], "Arrange transfer");

    let (status, premature_completion) = json_request(
        &ctx.app,
        "POST",
        &status_path,
        &assignee_bearer,
        Some(json!({
            "expected_updated_at": assignee_updated["updated_at"],
            "status": "completed"
        })),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::UNPROCESSABLE_ENTITY,
        "{premature_completion}"
    );

    let (status, updated) = json_request(
        &ctx.app,
        "POST",
        &update_path,
        &ceo_bearer,
        Some(json!({
            "expected_updated_at": assignee_updated["updated_at"],
            "kind": "task",
            "title": "Arrange transfer and driver",
            "assigned_to": assignee_id,
            "priority": "high",
            "status": "completed"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{updated}");
    assert_eq!(updated["status"], "completed");

    let creator_update_notifications: i64 = sqlx::query_scalar(
        r#"SELECT count(*) FROM user_notifications
           WHERE user_id = $1 AND kind = 'operational_task_updated'
             AND entity_type = 'concierge_task' AND entity_id = $2"#,
    )
    .bind(creator_id)
    .bind(task_id)
    .fetch_one(&ctx.pool)
    .await
    .unwrap();
    assert_eq!(creator_update_notifications, 2);

    let delete_path = format!("{path}/{task_id}");
    let (status, denied) =
        json_request(&ctx.app, "DELETE", &delete_path, &same_rank_bearer, None).await;
    assert_eq!(status, StatusCode::FORBIDDEN, "{denied}");

    let (status, protected) =
        json_request(&ctx.app, "DELETE", &delete_path, &ceo_bearer, None).await;
    assert_eq!(status, StatusCode::CONFLICT, "{protected}");

    let (status, reopened) = json_request(
        &ctx.app,
        "POST",
        &status_path,
        &ceo_bearer,
        Some(json!({
            "expected_updated_at": updated["updated_at"],
            "status": "in_progress"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{reopened}");
    let (status, reopened) = json_request(
        &ctx.app,
        "POST",
        &status_path,
        &ceo_bearer,
        Some(json!({
            "expected_updated_at": reopened["updated_at"],
            "status": "open"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{reopened}");
    let (status, deleted) = json_request(&ctx.app, "DELETE", &delete_path, &ceo_bearer, None).await;
    assert_eq!(status, StatusCode::NO_CONTENT, "{deleted}");
    let (status, missing) =
        json_request(&ctx.app, "GET", &delete_path, &creator_bearer, None).await;
    assert_eq!(status, StatusCode::NOT_FOUND, "{missing}");

    let creator_delete_notifications: i64 = sqlx::query_scalar(
        r#"SELECT count(*) FROM user_notifications
           WHERE user_id = $1 AND kind = 'operational_task_deleted'
             AND entity_type = 'concierge_task' AND entity_id = $2"#,
    )
    .bind(creator_id)
    .bind(task_id)
    .fetch_one(&ctx.pool)
    .await
    .unwrap();
    assert_eq!(creator_delete_notifications, 1);
    let deletion: (bool, bool, String) = sqlx::query_as(
        r#"SELECT deleted_at IS NOT NULL, deleted_by = $2, event.event_type
           FROM tasks task
           JOIN concierge_operational_task_events event ON event.task_id = task.id
           WHERE task.id = $1 AND event.event_type = 'deleted'"#,
    )
    .bind(task_id)
    .bind(ctx.admin_id)
    .fetch_one(&ctx.pool)
    .await
    .unwrap();
    assert_eq!(deletion, (true, true, "deleted".to_string()));

    let (status, own_task) = json_request(
        &ctx.app,
        "POST",
        path,
        &creator_bearer,
        Some(json!({
            "request_id": Uuid::new_v4(),
            "kind": "task",
            "title": "Creator-owned follow-up",
            "priority": "normal"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{own_task}");
    let own_task_id = Uuid::parse_str(own_task["id"].as_str().expect("own task id")).unwrap();
    let (status, own_updated) = json_request(
        &ctx.app,
        "POST",
        &format!("{path}/{own_task_id}/update"),
        &creator_bearer,
        Some(json!({
            "expected_updated_at": own_task["updated_at"],
            "kind": "task",
            "title": "Creator-owned follow-up updated",
            "priority": "normal",
            "status": "open"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{own_updated}");
    let (status, own_deleted) = json_request(
        &ctx.app,
        "DELETE",
        &format!("{path}/{own_task_id}"),
        &creator_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT, "{own_deleted}");
    let self_change_notifications: i64 = sqlx::query_scalar(
        r#"SELECT count(*) FROM user_notifications
           WHERE user_id = $1
             AND kind IN ('operational_task_updated', 'operational_task_deleted')
             AND entity_id = $2"#,
    )
    .bind(creator_id)
    .bind(own_task_id)
    .fetch_one(&ctx.pool)
    .await
    .unwrap();
    assert_eq!(self_change_notifications, 0);

    let (status, ceo_task) = json_request(
        &ctx.app,
        "POST",
        path,
        &ceo_bearer,
        Some(json!({
            "request_id": Uuid::new_v4(),
            "kind": "task",
            "title": "CEO-owned review",
            "assigned_to": billing_id,
            "priority": "normal"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{ceo_task}");
    let ceo_task_id = ceo_task["id"].as_str().expect("ceo task id");
    let (status, denied) = json_request(
        &ctx.app,
        "POST",
        &format!("{path}/{ceo_task_id}/update"),
        &billing_bearer,
        Some(json!({
            "expected_updated_at": ceo_task["updated_at"],
            "kind": "task",
            "title": "Cannot change CEO-owned review",
            "assigned_to": billing_id,
            "priority": "normal",
            "status": "open"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN, "{denied}");
}

#[tokio::test]
async fn operational_task_attachments_follow_visibility_hierarchy_and_storage_rules() {
    let Some(ctx) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let tag = Uuid::new_v4().simple().to_string();
    let creator_id = seed_user(
        &ctx.pool,
        "teamlead_interpreter",
        &format!("file-creator-{tag}"),
    )
    .await;
    let same_rank_id = seed_user(&ctx.pool, "concierge", &format!("file-same-{tag}")).await;
    let assignee_id = seed_user(&ctx.pool, "interpreter", &format!("file-viewer-{tag}")).await;
    let patient_id = seed_patient(&ctx.pool, ctx.admin_id, &format!("file-{tag}")).await;
    let provider_id = seed_provider(&ctx.pool, "non_medical", &format!("file-{tag}")).await;
    let creator_bearer = auth_header_for(creator_id, "teamlead_interpreter");
    let same_rank_bearer = auth_header_for(same_rank_id, "concierge");
    let assignee_bearer = auth_header_for(assignee_id, "interpreter");
    let ceo_bearer = auth_header_for(ctx.admin_id, "ceo");
    let base_path = "/api/v1/concierge-operational-items";
    let (status, task) = json_request(
        &ctx.app,
        "POST",
        base_path,
        &creator_bearer,
        Some(json!({
            "request_id": Uuid::new_v4(),
            "kind": "task",
            "title": format!("Attachment task {tag}"),
            "assigned_to": assignee_id,
            "patient_id": patient_id,
            "provider_id": provider_id,
            "priority": "normal"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{task}");
    let task_id = Uuid::parse_str(task["id"].as_str().expect("task id")).unwrap();
    let attachment_path = format!("{base_path}/{task_id}/attachments");
    let file_name = format!("transfer-{tag}.pdf");
    let pdf = format!("%PDF-1.4\nGMED attachment {tag}\n%%EOF").into_bytes();

    let (status, spoofed) = multipart_file_request(
        &ctx.app,
        &attachment_path,
        &creator_bearer,
        "spoofed.pdf",
        "application/pdf",
        b"not a pdf",
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{spoofed}");

    let (status, invalid_extension) = multipart_file_request(
        &ctx.app,
        &attachment_path,
        &creator_bearer,
        "payload.exe",
        "application/pdf",
        &pdf,
    )
    .await;
    assert_eq!(
        status,
        StatusCode::UNPROCESSABLE_ENTITY,
        "{invalid_extension}"
    );

    let docx = minimal_docx_bytes();
    let docx_name = format!("instructions-{tag}.docx");
    let (status, word_attachment) = multipart_file_request(
        &ctx.app,
        &attachment_path,
        &creator_bearer,
        &docx_name,
        "application/octet-stream",
        &docx,
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{word_attachment}");
    assert_eq!(
        word_attachment["mime_type"],
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    );
    let word_attachment_id =
        Uuid::parse_str(word_attachment["id"].as_str().expect("word attachment id")).unwrap();
    let (status, deleted_word) = raw_request(
        &ctx.app,
        "DELETE",
        &format!("{attachment_path}/{word_attachment_id}"),
        &creator_bearer,
    )
    .await;
    assert_eq!(
        status,
        StatusCode::NO_CONTENT,
        "{}",
        String::from_utf8_lossy(&deleted_word)
    );

    let (status, forbidden) = multipart_file_request(
        &ctx.app,
        &attachment_path,
        &same_rank_bearer,
        &file_name,
        "application/pdf",
        &pdf,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN, "{forbidden}");

    let (status, attachment) = multipart_file_request(
        &ctx.app,
        &attachment_path,
        &creator_bearer,
        &file_name,
        "application/pdf",
        &pdf,
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{attachment}");
    assert_eq!(attachment["file_name"], file_name);
    assert_eq!(attachment["mime_type"], "application/pdf");
    assert_eq!(attachment["file_size"], pdf.len());
    let attachment_id = Uuid::parse_str(attachment["id"].as_str().expect("attachment id")).unwrap();

    let (status, list) =
        json_request(&ctx.app, "GET", &attachment_path, &assignee_bearer, None).await;
    assert_eq!(status, StatusCode::OK, "{list}");
    assert_eq!(list.as_array().map(Vec::len), Some(1));
    assert_eq!(list[0]["id"], attachment_id.to_string());

    let (status, detail) = json_request(
        &ctx.app,
        "GET",
        &format!("{base_path}/{task_id}"),
        &same_rank_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN, "{detail}");

    let download_path = format!("{attachment_path}/{attachment_id}/download");
    let (status, downloaded) = raw_request(&ctx.app, "GET", &download_path, &assignee_bearer).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(downloaded, pdf);

    let (status, files) = json_request(
        &ctx.app,
        "GET",
        &format!("/api/v1/concierge-operational-attachments?kind=task&q={file_name}"),
        &assignee_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{files}");
    assert_eq!(files.as_array().map(Vec::len), Some(1));
    assert_eq!(files[0]["task_id"], task_id.to_string());
    assert_eq!(files[0]["task_title"], format!("Attachment task {tag}"));
    assert_eq!(files[0]["task_kind"], "task");
    assert_eq!(files[0]["patient_id"], patient_id.to_string());
    assert_eq!(files[0]["provider_id"], provider_id.to_string());

    let delete_path = format!("{attachment_path}/{attachment_id}");
    let (status, denied) = raw_request(&ctx.app, "DELETE", &delete_path, &same_rank_bearer).await;
    assert_eq!(
        status,
        StatusCode::FORBIDDEN,
        "{}",
        String::from_utf8_lossy(&denied)
    );
    let (status, deleted) = raw_request(&ctx.app, "DELETE", &delete_path, &ceo_bearer).await;
    assert_eq!(
        status,
        StatusCode::NO_CONTENT,
        "{}",
        String::from_utf8_lossy(&deleted)
    );
    let (status, missing) = raw_request(&ctx.app, "GET", &download_path, &creator_bearer).await;
    assert_eq!(
        status,
        StatusCode::NOT_FOUND,
        "{}",
        String::from_utf8_lossy(&missing)
    );

    let correction_notifications: i64 = sqlx::query_scalar(
        r#"SELECT count(*) FROM user_notifications
           WHERE user_id = $1 AND kind = 'operational_task_updated'
             AND entity_id = $2 AND title = 'Task attachment deleted'"#,
    )
    .bind(creator_id)
    .bind(task_id)
    .fetch_one(&ctx.pool)
    .await
    .unwrap();
    assert_eq!(correction_notifications, 1);

    let second_file_name = format!("hotel-{tag}.pdf");
    let (status, second_attachment) = multipart_file_request(
        &ctx.app,
        &attachment_path,
        &creator_bearer,
        &second_file_name,
        "application/pdf",
        &pdf,
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{second_attachment}");
    let second_attachment_id = Uuid::parse_str(
        second_attachment["id"]
            .as_str()
            .expect("second attachment id"),
    )
    .unwrap();
    let task_path = format!("{base_path}/{task_id}");
    let (status, protected_task) = raw_request(&ctx.app, "DELETE", &task_path, &ceo_bearer).await;
    assert_eq!(
        status,
        StatusCode::CONFLICT,
        "{}",
        String::from_utf8_lossy(&protected_task)
    );
    let (status, deleted_second) = raw_request(
        &ctx.app,
        "DELETE",
        &format!("{attachment_path}/{second_attachment_id}"),
        &ceo_bearer,
    )
    .await;
    assert_eq!(
        status,
        StatusCode::NO_CONTENT,
        "{}",
        String::from_utf8_lossy(&deleted_second)
    );
    let (status, deleted_task) = raw_request(&ctx.app, "DELETE", &task_path, &ceo_bearer).await;
    assert_eq!(
        status,
        StatusCode::NO_CONTENT,
        "{}",
        String::from_utf8_lossy(&deleted_task)
    );
    let (status, inaccessible) =
        json_request(&ctx.app, "GET", &attachment_path, &creator_bearer, None).await;
    assert_eq!(status, StatusCode::NOT_FOUND, "{inaccessible}");
    let (status, inaccessible_download) = raw_request(
        &ctx.app,
        "GET",
        &format!("{attachment_path}/{second_attachment_id}/download"),
        &creator_bearer,
    )
    .await;
    assert_eq!(
        status,
        StatusCode::NOT_FOUND,
        "{}",
        String::from_utf8_lossy(&inaccessible_download)
    );
    let (status, hidden_files) = json_request(
        &ctx.app,
        "GET",
        &format!("/api/v1/concierge-operational-attachments?q={second_file_name}"),
        &creator_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{hidden_files}");
    assert!(hidden_files.as_array().is_some_and(Vec::is_empty));

    let attachment_events: i64 = sqlx::query_scalar(
        r#"SELECT count(*) FROM concierge_operational_task_events
           WHERE task_id = $1 AND event_type IN ('attachment_added', 'attachment_deleted')"#,
    )
    .bind(task_id)
    .fetch_one(&ctx.pool)
    .await
    .unwrap();
    assert_eq!(attachment_events, 6);
}

#[tokio::test]
async fn ceo_assigns_tasks_and_task_detail_keeps_idempotent_comments_checklist_history_and_reminders()
 {
    let Some(ctx) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let tag = Uuid::new_v4().simple().to_string();
    let concierge_id = seed_user(&ctx.pool, "concierge", &format!("manager-owner-{tag}")).await;
    let other_id = seed_user(&ctx.pool, "concierge", &format!("manager-other-{tag}")).await;
    let ceo_bearer = auth_header_for(ctx.admin_id, "ceo");
    let concierge_bearer = auth_header_for(concierge_id, "concierge");
    let other_bearer = auth_header_for(other_id, "concierge");
    let path = "/api/v1/concierge-operational-items";

    let (status, task) = json_request(
        &ctx.app,
        "POST",
        path,
        &ceo_bearer,
        Some(json!({
            "request_id": Uuid::new_v4(),
            "kind": "task",
            "title": "Confirm restaurant booking",
            "note": "Operational details only",
            "assigned_to": concierge_id,
            "due_at": "2026-08-20T09:00:00Z",
            "reminder_at": "2020-08-20T08:30:00Z",
            "priority": "urgent"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{task}");
    assert_eq!(task["assigned_to"], concierge_id.to_string());
    assert_eq!(task["checklist_total"], 0);
    assert_eq!(task["comment_count"], 0);
    let task_id = Uuid::parse_str(task["id"].as_str().expect("task id")).unwrap();

    let detail_path = format!("{path}/{task_id}");
    let (status, visible) = json_request(&ctx.app, "GET", &detail_path, &other_bearer, None).await;
    assert_eq!(status, StatusCode::FORBIDDEN, "{visible}");

    let comment_request_id = Uuid::new_v4();
    let comment_body = json!({
        "request_id": comment_request_id,
        "body": "Table and arrival time confirmed"
    });
    let (status, first_comment) = json_request(
        &ctx.app,
        "POST",
        &format!("{detail_path}/comments"),
        &concierge_bearer,
        Some(comment_body.clone()),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{first_comment}");
    let (status, replayed_comment) = json_request(
        &ctx.app,
        "POST",
        &format!("{detail_path}/comments"),
        &concierge_bearer,
        Some(comment_body),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{replayed_comment}");
    assert_eq!(first_comment["id"], replayed_comment["id"]);
    let comment_notification_recipients: Vec<Uuid> = sqlx::query_scalar(
        r#"SELECT user_id
           FROM user_notifications
           WHERE entity_type = 'concierge_task'
             AND entity_id = $1
             AND kind = 'operational_task_comment_added'"#,
    )
    .bind(task_id)
    .fetch_all(&ctx.pool)
    .await
    .unwrap();
    assert_eq!(comment_notification_recipients, vec![ctx.admin_id]);
    let (status, drift) = json_request(
        &ctx.app,
        "POST",
        &format!("{detail_path}/comments"),
        &concierge_bearer,
        Some(json!({ "request_id": comment_request_id, "body": "Different data" })),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{drift}");
    let comment_id = Uuid::parse_str(first_comment["id"].as_str().expect("comment id")).unwrap();
    let comment_update_path = format!("{detail_path}/comments/{comment_id}/update");
    let (status, denied_comment_edit) = json_request(
        &ctx.app,
        "POST",
        &comment_update_path,
        &ceo_bearer,
        Some(json!({
            "request_id": Uuid::new_v4(),
            "body": "Creator must not rewrite another author's comment"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN, "{denied_comment_edit}");
    let comment_update_request_id = Uuid::new_v4();
    let (status, edited_comment) = json_request(
        &ctx.app,
        "POST",
        &comment_update_path,
        &concierge_bearer,
        Some(json!({
            "request_id": comment_update_request_id,
            "body": "Table, arrival time, and contact person confirmed"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{edited_comment}");
    assert_eq!(
        edited_comment["body"],
        "Table, arrival time, and contact person confirmed"
    );
    assert!(edited_comment["edited_at"].is_string());

    let checklist_request_id = Uuid::new_v4();
    let checklist_path = format!("{detail_path}/checklist");
    let (status, checklist) = json_request(
        &ctx.app,
        "POST",
        &checklist_path,
        &concierge_bearer,
        Some(json!({ "request_id": checklist_request_id, "label": "Send written confirmation" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{checklist}");
    let checklist_id = Uuid::parse_str(checklist["id"].as_str().expect("checklist id")).unwrap();
    let checklist_update_path = format!("{checklist_path}/{checklist_id}/update");
    let (status, edited_checklist) = json_request(
        &ctx.app,
        "POST",
        &checklist_update_path,
        &concierge_bearer,
        Some(json!({
            "request_id": Uuid::new_v4(),
            "label": "Send written booking confirmation"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{edited_checklist}");
    assert_eq!(
        edited_checklist["label"],
        "Send written booking confirmation"
    );
    let toggle_request_id = Uuid::new_v4();
    let toggle_path = format!("{checklist_path}/{checklist_id}/toggle");
    let toggle_body = json!({ "request_id": toggle_request_id, "completed": true });
    let (status, toggled) = json_request(
        &ctx.app,
        "POST",
        &toggle_path,
        &concierge_bearer,
        Some(toggle_body.clone()),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{toggled}");
    assert_eq!(toggled["is_completed"], true);
    let (status, replayed_toggle) = json_request(
        &ctx.app,
        "POST",
        &toggle_path,
        &concierge_bearer,
        Some(toggle_body),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{replayed_toggle}");
    assert_eq!(toggled["updated_at"], replayed_toggle["updated_at"]);

    let (status, detail) =
        json_request(&ctx.app, "GET", &detail_path, &concierge_bearer, None).await;
    assert_eq!(status, StatusCode::OK, "{detail}");
    assert_eq!(detail["comments"].as_array().expect("comments").len(), 1);
    assert_eq!(detail["checklist"].as_array().expect("checklist").len(), 1);
    assert_eq!(detail["item"]["checklist_completed"], 1);
    assert!(
        detail["history"]
            .as_array()
            .expect("history")
            .iter()
            .any(|event| event["event_type"] == "comment_added")
    );
    assert!(
        detail["history"]
            .as_array()
            .expect("history")
            .iter()
            .any(|event| event["event_type"] == "checklist_item_toggled")
    );
    assert!(
        detail["history"]
            .as_array()
            .expect("history")
            .iter()
            .any(|event| event["event_type"] == "comment_edited")
    );
    assert!(
        detail["history"]
            .as_array()
            .expect("history")
            .iter()
            .any(|event| event["event_type"] == "checklist_item_edited")
    );

    let (status, deleted_comment) = json_request(
        &ctx.app,
        "POST",
        &format!("{detail_path}/comments/{comment_id}/delete"),
        &concierge_bearer,
        Some(json!({ "request_id": Uuid::new_v4() })),
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT, "{deleted_comment}");
    let (status, deleted_checklist) = json_request(
        &ctx.app,
        "POST",
        &format!("{checklist_path}/{checklist_id}/delete"),
        &concierge_bearer,
        Some(json!({ "request_id": Uuid::new_v4() })),
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT, "{deleted_checklist}");
    let (status, detail_after_delete) =
        json_request(&ctx.app, "GET", &detail_path, &concierge_bearer, None).await;
    assert_eq!(status, StatusCode::OK, "{detail_after_delete}");
    assert_eq!(
        detail_after_delete["comments"]
            .as_array()
            .expect("comments")
            .len(),
        0
    );
    assert_eq!(
        detail_after_delete["checklist"]
            .as_array()
            .expect("checklist")
            .len(),
        0
    );
    assert_eq!(detail_after_delete["item"]["comment_count"], 0);
    assert_eq!(detail_after_delete["item"]["checklist_total"], 0);

    let scheduler_state = AppState::new(
        ctx.pool.clone(),
        TEST_SECRET,
        SettingsCache::new(TokenSettings::default()),
    );
    assert_eq!(
        gmed_server::routes::concierge_operational_items::run_concierge_task_reminder_scheduler_once(&scheduler_state).await,
        1,
    );
    assert_eq!(
        gmed_server::routes::concierge_operational_items::run_concierge_task_reminder_scheduler_once(&scheduler_state).await,
        0,
    );
    let notification_count: i64 = sqlx::query_scalar(
        r#"SELECT COUNT(*)
           FROM user_notifications
           WHERE user_id = $1
             AND kind = 'concierge_task_reminder'
             AND entity_type = 'concierge_task'
             AND entity_id = $2"#,
    )
    .bind(concierge_id)
    .bind(task_id)
    .fetch_one(&ctx.pool)
    .await
    .unwrap();
    assert_eq!(notification_count, 1);
}

#[tokio::test]
async fn reassignment_serializes_and_revokes_former_assignee_child_access() {
    let Some(ctx) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let tag = Uuid::new_v4().simple().to_string();
    let old_concierge_id = seed_user(&ctx.pool, "concierge", &format!("race-old-{tag}")).await;
    let new_concierge_id = seed_user(&ctx.pool, "concierge", &format!("race-new-{tag}")).await;
    let old_bearer = auth_header_for(old_concierge_id, "concierge");
    let new_bearer = auth_header_for(new_concierge_id, "concierge");
    let ceo_bearer = auth_header_for(ctx.admin_id, "ceo");
    let base_path = "/api/v1/concierge-operational-items";

    let (status, task) = json_request(
        &ctx.app,
        "POST",
        base_path,
        &ceo_bearer,
        Some(json!({
            "request_id": Uuid::new_v4(),
            "kind": "task",
            "title": "Serialize reassignment",
            "assigned_to": old_concierge_id,
            "priority": "normal"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{task}");
    let task_id = Uuid::parse_str(task["id"].as_str().expect("task id")).unwrap();
    let detail_path = format!("{base_path}/{task_id}");
    let checklist_path = format!("{detail_path}/checklist");
    let (status, checklist) = json_request(
        &ctx.app,
        "POST",
        &checklist_path,
        &old_bearer,
        Some(json!({
            "request_id": Uuid::new_v4(),
            "label": "Must stay unchanged after reassignment"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{checklist}");
    let checklist_id = Uuid::parse_str(checklist["id"].as_str().expect("checklist id")).unwrap();

    let mut reassign_tx = ctx.pool.begin().await.unwrap();
    sqlx::query("UPDATE tasks SET assigned_to = $2, updated_at = now() WHERE id = $1")
        .bind(task_id)
        .bind(new_concierge_id)
        .execute(&mut *reassign_tx)
        .await
        .unwrap();

    let detail_app = ctx.app.clone();
    let detail_bearer = old_bearer.clone();
    let detail_request_path = detail_path.clone();
    let mut pending_detail = tokio::spawn(async move {
        json_request(
            &detail_app,
            "GET",
            &detail_request_path,
            &detail_bearer,
            None,
        )
        .await
    });
    let comment_app = ctx.app.clone();
    let comment_bearer = old_bearer.clone();
    let comment_path = format!("{detail_path}/comments");
    let denied_comment_request_id = Uuid::new_v4();
    let mut pending_comment = tokio::spawn(async move {
        json_request(
            &comment_app,
            "POST",
            &comment_path,
            &comment_bearer,
            Some(json!({
                "request_id": denied_comment_request_id,
                "body": "Must not survive reassignment"
            })),
        )
        .await
    });

    assert!(
        tokio::time::timeout(Duration::from_millis(150), &mut pending_detail)
            .await
            .is_err(),
        "detail read must wait for the reassignment row lock"
    );
    assert!(
        tokio::time::timeout(Duration::from_millis(150), &mut pending_comment)
            .await
            .is_err(),
        "comment mutation must wait for the reassignment row lock"
    );

    reassign_tx.commit().await.unwrap();
    let (detail_status, detail_body) = pending_detail.await.unwrap();
    assert_eq!(detail_status, StatusCode::FORBIDDEN, "{detail_body}");
    let (comment_status, comment_body) = pending_comment.await.unwrap();
    assert_eq!(comment_status, StatusCode::FORBIDDEN, "{comment_body}");

    let (status, shared_checklist) = json_request(
        &ctx.app,
        "POST",
        &checklist_path,
        &old_bearer,
        Some(json!({
            "request_id": Uuid::new_v4(),
            "label": "Former assignee must not collaborate"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN, "{shared_checklist}");
    let (status, shared_toggle) = json_request(
        &ctx.app,
        "POST",
        &format!("{checklist_path}/{checklist_id}/toggle"),
        &old_bearer,
        Some(json!({
            "request_id": Uuid::new_v4(),
            "completed": true
        })),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN, "{shared_toggle}");

    let (status, new_owner_comment) = json_request(
        &ctx.app,
        "POST",
        &format!("{detail_path}/comments"),
        &new_bearer,
        Some(json!({
            "request_id": Uuid::new_v4(),
            "body": "Only the current assignee receives this update"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{new_owner_comment}");
    let realtime_recipients: (Vec<Uuid>, Vec<String>) = sqlx::query_as(
        r#"SELECT target_user_ids, role_names
           FROM realtime_events
           WHERE event_type = 'concierge_operational_item.comment_added'
             AND entity_id = $1
           ORDER BY seq DESC
           LIMIT 1"#,
    )
    .bind(task_id)
    .fetch_one(&ctx.pool)
    .await
    .unwrap();
    assert!(realtime_recipients.0.contains(&new_concierge_id));
    assert!(!realtime_recipients.0.contains(&old_concierge_id));
    assert_eq!(realtime_recipients.1, vec!["ceo".to_string()]);

    let comment_count: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM concierge_operational_task_comments WHERE task_id = $1",
    )
    .bind(task_id)
    .fetch_one(&ctx.pool)
    .await
    .unwrap();
    assert_eq!(comment_count, 1);
    let checklist_state: (i64, i64) = sqlx::query_as(
        r#"SELECT count(*), count(*) FILTER (WHERE is_completed)
           FROM concierge_operational_task_checklist_items
           WHERE task_id = $1"#,
    )
    .bind(task_id)
    .fetch_one(&ctx.pool)
    .await
    .unwrap();
    assert_eq!(checklist_state, (1, 0));
}

#[tokio::test]
async fn concurrent_checklist_toggle_with_same_request_id_replays_as_two_successes() {
    let Some(ctx) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let tag = Uuid::new_v4().simple().to_string();
    let concierge_id = seed_user(&ctx.pool, "concierge", &format!("toggle-race-{tag}")).await;
    let bearer = auth_header_for(concierge_id, "concierge");
    let base_path = "/api/v1/concierge-operational-items";
    let (status, task) = json_request(
        &ctx.app,
        "POST",
        base_path,
        &bearer,
        Some(json!({
            "request_id": Uuid::new_v4(),
            "kind": "task",
            "title": "Concurrent toggle",
            "priority": "normal"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{task}");
    let task_id = Uuid::parse_str(task["id"].as_str().expect("task id")).unwrap();
    let checklist_path = format!("{base_path}/{task_id}/checklist");
    let (status, checklist) = json_request(
        &ctx.app,
        "POST",
        &checklist_path,
        &bearer,
        Some(json!({
            "request_id": Uuid::new_v4(),
            "label": "Toggle once"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{checklist}");
    let checklist_id = Uuid::parse_str(checklist["id"].as_str().expect("checklist id")).unwrap();
    let toggle_path = format!("{checklist_path}/{checklist_id}/toggle");
    let toggle_request_id = Uuid::new_v4();
    let toggle_body = json!({
        "request_id": toggle_request_id,
        "completed": true
    });

    let (first, second) = tokio::join!(
        json_request(
            &ctx.app,
            "POST",
            &toggle_path,
            &bearer,
            Some(toggle_body.clone()),
        ),
        json_request(&ctx.app, "POST", &toggle_path, &bearer, Some(toggle_body),),
    );
    assert_eq!(first.0, StatusCode::OK, "{}", first.1);
    assert_eq!(second.0, StatusCode::OK, "{}", second.1);
    assert_eq!(first.1["id"], second.1["id"]);
    assert_eq!(first.1["updated_at"], second.1["updated_at"]);
    assert_eq!(first.1["is_completed"], true);
    assert_eq!(second.1["is_completed"], true);

    let event_count: i64 = sqlx::query_scalar(
        r#"SELECT count(*)
           FROM concierge_operational_task_events
           WHERE task_id = $1 AND request_id = $2"#,
    )
    .bind(task_id)
    .bind(toggle_request_id)
    .fetch_one(&ctx.pool)
    .await
    .unwrap();
    assert_eq!(event_count, 1);
}

#[tokio::test]
async fn assigned_concierge_task_grants_non_clinical_patient_access_only() {
    let Some(ctx) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let tag = Uuid::new_v4().simple().to_string();
    let concierge_id = seed_user(&ctx.pool, "concierge", &format!("patient-scope-{tag}")).await;
    let concierge_bearer = auth_header_for(concierge_id, "concierge");
    let ceo_bearer = auth_header_for(ctx.admin_id, "ceo");
    let patient_id = seed_patient(&ctx.pool, ctx.admin_id, &format!("visible-{tag}")).await;
    let unrelated_patient_id =
        seed_patient(&ctx.pool, ctx.admin_id, &format!("hidden-{tag}")).await;
    let provider_id = seed_provider(&ctx.pool, "non_medical", &tag).await;
    let service_id = seed_service(
        &ctx.pool,
        patient_id,
        provider_id,
        concierge_id,
        ctx.admin_id,
        "Hotel coordination",
    )
    .await;

    sqlx::query(
        r#"UPDATE patients
           SET address_city = 'Berlin',
               passport_number = 'SAFE-PASSPORT',
               clinical_warnings = 'MEDICAL-WARNING-MUST-NOT-LEAK',
               notes = 'INTERNAL-NOTE-MUST-NOT-LEAK',
               intake_profile = '{"medical_note":"MUST-NOT-LEAK"}'::jsonb,
               lead_snapshot = '{"diagnosis":"MUST-NOT-LEAK"}'::jsonb
           WHERE id = $1"#,
    )
    .bind(patient_id)
    .execute(&ctx.pool)
    .await
    .unwrap();

    let (status, denied) = json_request(
        &ctx.app,
        "GET",
        &format!("/api/v1/patients/{patient_id}"),
        &concierge_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN, "{denied}");

    let (status, task) = json_request(
        &ctx.app,
        "POST",
        "/api/v1/concierge-operational-items",
        &ceo_bearer,
        Some(json!({
            "request_id": Uuid::new_v4(),
            "kind": "task",
            "title": "Arrange the hotel",
            "assigned_to": concierge_id,
            "concierge_service_id": service_id,
            "priority": "normal"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{task}");
    let task_id = Uuid::parse_str(task["id"].as_str().expect("task id")).unwrap();

    let (status, patients) =
        json_request(&ctx.app, "GET", "/api/v1/patients", &concierge_bearer, None).await;
    assert_eq!(status, StatusCode::OK, "{patients}");
    let patients = patients.as_array().expect("patient list");
    assert!(
        patients
            .iter()
            .any(|item| item["id"] == patient_id.to_string())
    );
    assert!(
        !patients
            .iter()
            .any(|item| item["id"] == unrelated_patient_id.to_string())
    );

    let (status, patient) = json_request(
        &ctx.app,
        "GET",
        &format!("/api/v1/patients/{patient_id}"),
        &concierge_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{patient}");
    assert_eq!(patient["address_city"], "Berlin");
    assert_eq!(patient["passport_number"], "SAFE-PASSPORT");
    for forbidden_field in [
        "clinical_warnings",
        "notes",
        "intake_profile",
        "lead_snapshot",
        "source_lead_id",
    ] {
        assert!(
            patient.get(forbidden_field).is_none(),
            "Concierge response leaked {forbidden_field}: {patient}"
        );
    }

    let (status, clinical) = json_request(
        &ctx.app,
        "GET",
        &format!("/api/v1/patients/{patient_id}/clinical"),
        &concierge_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN, "{clinical}");

    for restricted_path in [
        "cases",
        "orders",
        "appointments",
        "document-alerts",
        "timeline",
    ] {
        let (status, response) = json_request(
            &ctx.app,
            "GET",
            &format!("/api/v1/patients/{patient_id}/{restricted_path}"),
            &concierge_bearer,
            None,
        )
        .await;
        assert_eq!(
            status,
            StatusCode::FORBIDDEN,
            "Concierge unexpectedly accessed {restricted_path}: {response}"
        );
    }

    let non_medical_document_id = Uuid::new_v4();
    sqlx::query(
        r#"INSERT INTO documents (
                id, patient_id, auto_name, original_filename, art, category,
                status, visibility, is_medical, version_root_document_id,
                version_number, uploaded_by
           ) VALUES (
                $1, $2, 'Hotel confirmation', 'hotel-confirmation.pdf', 'other', 'general',
                'active', 'released_internal', false, $1, 1, $3
           )"#,
    )
    .bind(non_medical_document_id)
    .bind(patient_id)
    .bind(ctx.admin_id)
    .execute(&ctx.pool)
    .await
    .unwrap();
    let medical_document_id = Uuid::new_v4();
    sqlx::query(
        r#"INSERT INTO documents (
                id, patient_id, auto_name, original_filename, art, category,
                status, visibility, is_medical, version_root_document_id,
                version_number, uploaded_by
           ) VALUES (
                $1, $2, 'Medical report', 'medical-report.pdf', 'report', 'medical',
                'active', 'released_internal', true, $1, 1, $3
           )"#,
    )
    .bind(medical_document_id)
    .bind(patient_id)
    .bind(ctx.admin_id)
    .execute(&ctx.pool)
    .await
    .unwrap();

    let (status, documents) = json_request(
        &ctx.app,
        "GET",
        &format!("/api/v1/patients/{patient_id}/documents"),
        &concierge_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{documents}");
    let documents = documents.as_array().expect("document list");
    assert!(
        documents
            .iter()
            .any(|item| item["id"] == non_medical_document_id.to_string())
    );
    assert!(
        !documents
            .iter()
            .any(|item| item["id"] == medical_document_id.to_string())
    );

    sqlx::query("UPDATE tasks SET archived_at = now(), archived_by = $2 WHERE id = $1")
        .bind(task_id)
        .bind(ctx.admin_id)
        .execute(&ctx.pool)
        .await
        .unwrap();
    let (status, denied_after_archive) = json_request(
        &ctx.app,
        "GET",
        &format!("/api/v1/patients/{patient_id}"),
        &concierge_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN, "{denied_after_archive}");
}

#[tokio::test]
async fn project_members_can_read_project_tasks_but_cannot_mutate_unassigned_work() {
    let Some(ctx) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let tag = Uuid::new_v4().simple().to_string();
    let owner_id = seed_user(&ctx.pool, "concierge", &format!("project-owner-{tag}")).await;
    let member_id = seed_user(&ctx.pool, "concierge", &format!("project-member-{tag}")).await;
    let outsider_id = seed_user(&ctx.pool, "concierge", &format!("project-outsider-{tag}")).await;
    let ceo_bearer = auth_header_for(ctx.admin_id, "ceo");
    let member_bearer = auth_header_for(member_id, "concierge");
    let outsider_bearer = auth_header_for(outsider_id, "concierge");

    let (status, project) = json_request(
        &ctx.app,
        "POST",
        "/api/v1/projects",
        &ceo_bearer,
        Some(json!({
            "name": format!("Project {tag}"),
            "description": "Shared operational work",
            "status": "active",
            "priority": "high",
            "owner_id": owner_id,
            "member_ids": [owner_id, member_id]
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{project}");
    let project_id = Uuid::parse_str(project["id"].as_str().expect("project id")).unwrap();

    let (status, transferred_project) = json_request(
        &ctx.app,
        "POST",
        "/api/v1/projects",
        &member_bearer,
        Some(json!({
            "name": format!("Transferred project {tag}"),
            "owner_id": outsider_id,
            "member_ids": [outsider_id]
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{transferred_project}");
    assert!(
        transferred_project["members"]
            .as_array()
            .unwrap()
            .iter()
            .any(|row| row["id"] == member_id.to_string()),
        "project creator must retain read access after transferring ownership"
    );

    let (status, task) = json_request(
        &ctx.app,
        "POST",
        "/api/v1/concierge-operational-items",
        &ceo_bearer,
        Some(json!({
            "request_id": Uuid::new_v4(),
            "kind": "task",
            "title": "Owner work visible to the project team",
            "assigned_to": owner_id,
            "project_id": project_id,
            "priority": "normal"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{task}");
    let task_id = Uuid::parse_str(task["id"].as_str().expect("task id")).unwrap();

    let (status, projects) =
        json_request(&ctx.app, "GET", "/api/v1/projects", &member_bearer, None).await;
    assert_eq!(status, StatusCode::OK, "{projects}");
    assert!(
        projects
            .as_array()
            .unwrap()
            .iter()
            .any(|row| row["id"] == project_id.to_string())
    );

    let (status, tasks) = json_request(
        &ctx.app,
        "GET",
        &format!("/api/v1/concierge-operational-items?project_id={project_id}&archive=all"),
        &member_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{tasks}");
    assert!(
        tasks
            .as_array()
            .unwrap()
            .iter()
            .any(|row| row["id"] == task_id.to_string())
    );

    let (status, detail) = json_request(
        &ctx.app,
        "GET",
        &format!("/api/v1/concierge-operational-items/{task_id}"),
        &member_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{detail}");
    assert_eq!(detail["item"]["project_id"], project_id.to_string());

    let (status, denied) = json_request(
        &ctx.app,
        "POST",
        &format!("/api/v1/concierge-operational-items/{task_id}/status"),
        &member_bearer,
        Some(json!({
            "expected_updated_at": task["updated_at"],
            "status": "in_progress"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN, "{denied}");

    let (status, outsider_projects) =
        json_request(&ctx.app, "GET", "/api/v1/projects", &outsider_bearer, None).await;
    assert_eq!(status, StatusCode::OK, "{outsider_projects}");
    assert!(
        !outsider_projects
            .as_array()
            .unwrap()
            .iter()
            .any(|row| row["id"] == project_id.to_string())
    );

    let (status, denied) = json_request(
        &ctx.app,
        "GET",
        &format!("/api/v1/concierge-operational-items/{task_id}"),
        &outsider_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN, "{denied}");
}

#[tokio::test]
async fn work_center_reads_general_and_legacy_tasks_without_expanding_patient_scope() {
    let Some(ctx) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let tag = Uuid::new_v4().simple().to_string();
    let owner_id = seed_user(&ctx.pool, "concierge", &format!("work-owner-{tag}")).await;
    let patient_user_id = seed_user(&ctx.pool, "concierge", &format!("work-patient-{tag}")).await;
    let outsider_id = seed_user(&ctx.pool, "concierge", &format!("work-outsider-{tag}")).await;
    let patient_id = seed_patient(&ctx.pool, ctx.admin_id, &format!("work-{tag}")).await;
    sqlx::query(
        r#"INSERT INTO patient_assignments (patient_id, user_id, assigned_by)
           VALUES ($1, $2, $3)"#,
    )
    .bind(patient_id)
    .bind(patient_user_id)
    .bind(ctx.admin_id)
    .execute(&ctx.pool)
    .await
    .unwrap();

    let general_task_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO tasks (
               title, assigned_to, assigned_by, patient_id, task_scope, task_kind
           ) VALUES ($1, $2, $3, $4, 'general', 'task')
           RETURNING id"#,
    )
    .bind(format!("Lead workflow task {tag}"))
    .bind(owner_id)
    .bind(ctx.admin_id)
    .bind(patient_id)
    .fetch_one(&ctx.pool)
    .await
    .unwrap();
    let legacy_task_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO tasks (
               title, assigned_to, assigned_by, task_scope, task_kind
           ) VALUES ($1, $2, $3, 'concierge_operational', 'task')
           RETURNING id"#,
    )
    .bind(format!("Legacy operational task {tag}"))
    .bind(owner_id)
    .bind(ctx.admin_id)
    .fetch_one(&ctx.pool)
    .await
    .unwrap();

    let base_path = "/api/v1/concierge-operational-items";
    let owner_bearer = auth_header_for(owner_id, "concierge");
    let patient_bearer = auth_header_for(patient_user_id, "concierge");
    let outsider_bearer = auth_header_for(outsider_id, "concierge");

    let (status, owner_items) = json_request(&ctx.app, "GET", base_path, &owner_bearer, None).await;
    assert_eq!(status, StatusCode::OK, "{owner_items}");
    let owner_items = owner_items.as_array().expect("owner task list");
    assert!(
        owner_items
            .iter()
            .any(|item| item["id"] == general_task_id.to_string())
    );
    assert!(
        owner_items
            .iter()
            .any(|item| item["id"] == legacy_task_id.to_string())
    );

    let (status, patient_items) =
        json_request(&ctx.app, "GET", base_path, &patient_bearer, None).await;
    assert_eq!(status, StatusCode::OK, "{patient_items}");
    let patient_items = patient_items.as_array().expect("patient-scoped task list");
    assert!(
        patient_items
            .iter()
            .any(|item| item["id"] == general_task_id.to_string())
    );
    assert!(
        !patient_items
            .iter()
            .any(|item| item["id"] == legacy_task_id.to_string())
    );

    let general_path = format!("{base_path}/{general_task_id}");
    let (status, patient_detail) =
        json_request(&ctx.app, "GET", &general_path, &patient_bearer, None).await;
    assert_eq!(status, StatusCode::OK, "{patient_detail}");
    assert_eq!(patient_detail["item"]["id"], general_task_id.to_string());

    let (status, comment) = json_request(
        &ctx.app,
        "POST",
        &format!("{general_path}/comments"),
        &owner_bearer,
        Some(json!({
            "request_id": Uuid::new_v4(),
            "body": "Canonical task comment"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{comment}");

    let (status, patient_detail) =
        json_request(&ctx.app, "GET", &general_path, &patient_bearer, None).await;
    assert_eq!(status, StatusCode::OK, "{patient_detail}");
    assert_eq!(
        patient_detail["comments"]
            .as_array()
            .expect("patient-scoped comments")
            .len(),
        1
    );

    let (status, denied_status) = json_request(
        &ctx.app,
        "POST",
        &format!("{general_path}/status"),
        &patient_bearer,
        Some(json!({
            "expected_updated_at": patient_detail["item"]["updated_at"],
            "status": "in_progress"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN, "{denied_status}");

    let (status, outsider_items) =
        json_request(&ctx.app, "GET", base_path, &outsider_bearer, None).await;
    assert_eq!(status, StatusCode::OK, "{outsider_items}");
    assert!(
        !outsider_items
            .as_array()
            .expect("outsider task list")
            .iter()
            .any(|item| item["id"] == general_task_id.to_string())
    );
    let (status, denied_detail) =
        json_request(&ctx.app, "GET", &general_path, &outsider_bearer, None).await;
    assert_eq!(status, StatusCode::FORBIDDEN, "{denied_detail}");
}
