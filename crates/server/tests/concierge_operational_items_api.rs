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

#[tokio::test]
async fn concierge_projects_are_creator_scoped_and_ceo_can_delete_any_project() {
    let Some(ctx) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let tag = Uuid::new_v4().simple().to_string();
    let creator = seed_user(&ctx.pool, "concierge", &format!("creator-{tag}")).await;
    let peer = seed_user(&ctx.pool, "concierge", &format!("peer-{tag}")).await;
    let creator_bearer = auth_header_for(creator, "concierge");
    let peer_bearer = auth_header_for(peer, "concierge");
    let ceo_bearer = auth_header_for(ctx.admin_id, "ceo");
    let create_body =
        json!({ "name": "Creator scoped project", "owner_id": peer, "member_ids": [peer] });
    let (status, own) = json_request(
        &ctx.app,
        "POST",
        "/api/v1/projects",
        &creator_bearer,
        Some(create_body.clone()),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{own}");
    assert_eq!(own["created_by"], creator.to_string());
    assert_eq!(own["owner_id"], peer.to_string());
    let own_id = own["id"].as_str().unwrap();
    // Manager membership and ownership are not substitutes for authorship.
    sqlx::query("UPDATE crm_project_members SET member_role = 'manager' WHERE project_id = $1 AND user_id = $2")
        .bind(Uuid::parse_str(own_id).unwrap()).bind(peer).execute(&ctx.pool).await.unwrap();
    for path in [
        format!("/api/v1/projects/{own_id}"),
        format!("/api/v1/projects/{own_id}/workflow/dependencies"),
    ] {
        assert_eq!(
            json_request(&ctx.app, "GET", &path, &creator_bearer, None)
                .await
                .0,
            StatusCode::OK
        );
        assert_eq!(
            json_request(&ctx.app, "GET", &path, &peer_bearer, None)
                .await
                .0,
            StatusCode::NOT_FOUND
        );
    }
    let (_, peer_list) =
        json_request(&ctx.app, "GET", "/api/v1/projects", &peer_bearer, None).await;
    assert!(
        !peer_list
            .as_array()
            .unwrap()
            .iter()
            .any(|p| p["id"] == own_id)
    );
    let mut update_body = create_body.clone();
    update_body["name"] = json!("Edited by creator");
    update_body["expected_updated_at"] = own["updated_at"].clone();
    assert_eq!(
        json_request(
            &ctx.app,
            "POST",
            &format!("/api/v1/projects/{own_id}/update"),
            &peer_bearer,
            Some(update_body.clone())
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        json_request(
            &ctx.app,
            "POST",
            &format!("/api/v1/projects/{own_id}/delete"),
            &peer_bearer,
            Some(json!({ "expected_updated_at": own["updated_at"] }))
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    let (status, edited) = json_request(
        &ctx.app,
        "POST",
        &format!("/api/v1/projects/{own_id}/update"),
        &creator_bearer,
        Some(update_body),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{edited}");
    let task_body = json!({ "request_id": Uuid::new_v4(), "kind": "task", "title": "Keep task history", "project_id": own_id, "assigned_to": creator });
    let (status, task) = json_request(
        &ctx.app,
        "POST",
        "/api/v1/concierge-operational-items",
        &creator_bearer,
        Some(task_body.clone()),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{task}");
    let mut foreign_task = task_body;
    foreign_task["request_id"] = json!(Uuid::new_v4());
    foreign_task["assigned_to"] = json!(peer);
    assert_eq!(
        json_request(
            &ctx.app,
            "POST",
            "/api/v1/concierge-operational-items",
            &peer_bearer,
            Some(foreign_task)
        )
        .await
        .0,
        StatusCode::UNPROCESSABLE_ENTITY
    );
    assert_eq!(
        json_request(
            &ctx.app,
            "GET",
            &format!("/api/v1/concierge-operational-items?project_id={own_id}"),
            &peer_bearer,
            None
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    let (status, _) = json_request(
        &ctx.app,
        "POST",
        &format!("/api/v1/projects/{own_id}/delete"),
        &creator_bearer,
        Some(json!({ "expected_updated_at": own["updated_at"] })),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::CONFLICT,
        "stale confirmation must not delete a changed project"
    );
    assert_eq!(
        json_request(
            &ctx.app,
            "POST",
            &format!("/api/v1/projects/{own_id}/delete"),
            &creator_bearer,
            Some(json!({ "expected_updated_at": edited["updated_at"] }))
        )
        .await
        .0,
        StatusCode::NO_CONTENT
    );
    assert_eq!(
        json_request(
            &ctx.app,
            "GET",
            &format!("/api/v1/projects/{own_id}"),
            &ceo_bearer,
            None
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
    let task_exists: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM tasks WHERE id = $1 AND deleted_at IS NULL)",
    )
    .bind(Uuid::parse_str(task["id"].as_str().unwrap()).unwrap())
    .fetch_one(&ctx.pool)
    .await
    .unwrap();
    assert!(task_exists);
    let (_, another) = json_request(
        &ctx.app,
        "POST",
        "/api/v1/projects",
        &peer_bearer,
        Some(json!({ "name": "CEO can remove this" })),
    )
    .await;
    assert_eq!(
        json_request(
            &ctx.app,
            "POST",
            &format!(
                "/api/v1/projects/{}/delete",
                another["id"].as_str().unwrap()
            ),
            &ceo_bearer,
            Some(json!({ "expected_updated_at": another["updated_at"] }))
        )
        .await
        .0,
        StatusCode::NO_CONTENT
    );
}

#[tokio::test]
async fn work_center_intervals_hold_and_children_are_persisted_and_authorized() {
    let Some(ctx) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let tag = Uuid::new_v4().simple().to_string();
    let owner = seed_user(&ctx.pool, "concierge", &format!("timeline-{tag}")).await;
    let peer = seed_user(&ctx.pool, "concierge", &format!("peer-{tag}")).await;
    let bearer = auth_header_for(owner, "concierge");
    let peer_bearer = auth_header_for(peer, "concierge");
    let base = json!({ "request_id": Uuid::new_v4(), "kind": "task", "title": "Timeline parent",
        "assigned_to": owner, "starts_at": "2026-09-10T09:00:00Z", "due_at": "2026-09-12T17:00:00Z" });
    let (status, mut parent) = json_request(
        &ctx.app,
        "POST",
        "/api/v1/concierge-operational-items",
        &bearer,
        Some(base.clone()),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{parent}");
    let id = parent["id"].as_str().unwrap().to_string();
    assert!(
        parent["starts_at"]
            .as_str()
            .unwrap()
            .starts_with("2026-09-10")
    );
    for next in ["in_progress", "on_hold", "in_progress"] {
        let (status, changed) = json_request(
            &ctx.app,
            "POST",
            &format!("/api/v1/concierge-operational-items/{id}/status"),
            &bearer,
            Some(json!({ "status": next, "expected_updated_at": parent["updated_at"] })),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{changed}");
        assert_eq!(changed["status"], next);
        assert_eq!(changed["due_at"], parent["due_at"]);
        parent = changed;
    }
    let mut child_body = base.clone();
    child_body["request_id"] = json!(Uuid::new_v4());
    child_body["parent_task_id"] = json!(id);
    child_body["title"] = json!("Child task");
    let (status, child) = json_request(
        &ctx.app,
        "POST",
        "/api/v1/concierge-operational-items",
        &bearer,
        Some(child_body.clone()),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{child}");
    assert_eq!(child["parent_task_id"], id);
    let (status, replay) = json_request(
        &ctx.app,
        "POST",
        "/api/v1/concierge-operational-items",
        &bearer,
        Some(child_body.clone()),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(replay["id"], child["id"]);
    let mut different_parent = child_body.clone();
    different_parent["parent_task_id"] = Value::Null;
    let (status, _) = json_request(
        &ctx.app,
        "POST",
        "/api/v1/concierge-operational-items",
        &bearer,
        Some(different_parent),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    child_body["request_id"] = json!(Uuid::new_v4());
    child_body["kind"] = json!("event");
    child_body["ends_at"] = child_body["due_at"].take();
    let (status, event) = json_request(
        &ctx.app,
        "POST",
        "/api/v1/concierge-operational-items",
        &bearer,
        Some(child_body.clone()),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{event}");
    assert_eq!(event["parent_task_id"], id);
    child_body["request_id"] = json!(Uuid::new_v4());
    child_body["assigned_to"] = json!(peer);
    let (status, _) = json_request(
        &ctx.app,
        "POST",
        "/api/v1/concierge-operational-items",
        &peer_bearer,
        Some(child_body.clone()),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    child_body["assigned_to"] = json!(owner);
    child_body["parent_task_id"] = event["id"].clone();
    let (status, _) = json_request(
        &ctx.app,
        "POST",
        "/api/v1/concierge-operational-items",
        &bearer,
        Some(child_body),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    let (_, detail) = json_request(
        &ctx.app,
        "GET",
        &format!("/api/v1/concierge-operational-items/{id}"),
        &bearer,
        None,
    )
    .await;
    assert_eq!(detail["item"]["child_count"], 2);
    assert!(
        detail["history"]
            .as_array()
            .unwrap()
            .iter()
            .any(|entry| entry["payload"]["status"] == "on_hold")
    );
    // Database guard also protects non-Work-Center mutation routes.
    assert!(
        sqlx::query("UPDATE tasks SET parent_task_id = id WHERE id = $1")
            .bind(Uuid::parse_str(&id).unwrap())
            .execute(&ctx.pool)
            .await
            .is_err()
    );
    assert!(
        sqlx::query("UPDATE tasks SET deleted_at = now() WHERE id = $1")
            .bind(Uuid::parse_str(&id).unwrap())
            .execute(&ctx.pool)
            .await
            .is_err()
    );
}

#[tokio::test]
async fn concierge_creators_can_delete_own_worked_tasks_but_not_foreign_tasks_or_children() {
    let Some(ctx) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let tag = Uuid::new_v4().simple().to_string();
    let owner = seed_user(&ctx.pool, "concierge", &format!("delete-owner-{tag}")).await;
    let peer = seed_user(&ctx.pool, "concierge", &format!("delete-peer-{tag}")).await;
    let bearer = auth_header_for(owner, "concierge");
    let peer_bearer = auth_header_for(peer, "concierge");
    let manager_bearer = auth_header_for(ctx.admin_id, "ceo");
    let path = "/api/v1/concierge-operational-items";
    let (status, assigned_parent) = json_request(&ctx.app, "POST", path, &manager_bearer, Some(json!({
        "request_id": Uuid::new_v4(), "kind": "task", "title": "Manager's task", "assigned_to": owner,
    }))).await;
    assert_eq!(status, StatusCode::CREATED, "{assigned_parent}");
    let manager_path = format!("{path}/{}", assigned_parent["id"].as_str().unwrap());
    assert_eq!(
        json_request(&ctx.app, "DELETE", &manager_path, &bearer, None)
            .await
            .0,
        StatusCode::FORBIDDEN
    );

    let (status, child) = json_request(
        &ctx.app,
        "POST",
        path,
        &bearer,
        Some(json!({
            "request_id": Uuid::new_v4(), "kind": "task", "title": "Personal subtask",
            "assigned_to": owner, "parent_task_id": assigned_parent["id"],
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{child}");
    assert_eq!(child["assigned_by"], owner.to_string());
    let child_id = Uuid::parse_str(child["id"].as_str().unwrap()).unwrap();
    let child_path = format!("{path}/{child_id}");
    let (status, started) = json_request(
        &ctx.app,
        "POST",
        &format!("{child_path}/status"),
        &bearer,
        Some(json!({ "status": "in_progress", "expected_updated_at": child["updated_at"] })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{started}");
    let (status, comment) = json_request(
        &ctx.app,
        "POST",
        &format!("{child_path}/comments"),
        &bearer,
        Some(json!({ "request_id": Uuid::new_v4(), "body": "Work recorded for audit" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{comment}");
    let (status, checklist) = json_request(
        &ctx.app,
        "POST",
        &format!("{child_path}/checklist"),
        &bearer,
        Some(json!({ "request_id": Uuid::new_v4(), "label": "Recorded step" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{checklist}");
    let attachment_path = format!("{child_path}/attachments");
    let (status, attachment) = multipart_file_request(
        &ctx.app,
        &attachment_path,
        &bearer,
        "audit.pdf",
        "application/pdf",
        b"%PDF-1.4\nAudit attachment\n%%EOF",
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{attachment}");
    assert_eq!(
        json_request(&ctx.app, "DELETE", &child_path, &peer_bearer, None)
            .await
            .0,
        StatusCode::FORBIDDEN
    );
    let (status, deleted) = json_request(&ctx.app, "DELETE", &child_path, &bearer, None).await;
    assert_eq!(status, StatusCode::NO_CONTENT, "{deleted}");
    assert_eq!(
        json_request(&ctx.app, "GET", &child_path, &bearer, None)
            .await
            .0,
        StatusCode::NOT_FOUND
    );
    let download_path = format!(
        "{attachment_path}/{}/download",
        attachment["id"].as_str().unwrap()
    );
    assert_eq!(
        raw_request(&ctx.app, "GET", &download_path, &bearer)
            .await
            .0,
        StatusCode::NOT_FOUND
    );
    let retained: (bool, bool, i64, i64, i64, i64) = sqlx::query_as(
        r#"SELECT task.deleted_at IS NOT NULL, task.deleted_by = $2,
                  (SELECT count(*) FROM concierge_operational_task_comments WHERE task_id = task.id AND deleted_at IS NULL),
                  (SELECT count(*) FROM concierge_operational_task_checklist_items WHERE task_id = task.id AND deleted_at IS NULL),
                  (SELECT count(*) FROM concierge_operational_task_attachments WHERE task_id = task.id AND deleted_at IS NULL),
                  (SELECT count(*) FROM concierge_operational_task_events WHERE task_id = task.id AND event_type = 'deleted')
           FROM tasks task WHERE task.id = $1"#,
    ).bind(child_id).bind(owner).fetch_one(&ctx.pool).await.unwrap();
    assert_eq!(retained, (true, true, 1, 1, 1, 1));
    // The legacy general-task endpoints must not expose or mutate a task
    // deleted through Work Center either.
    let legacy_path = format!("/api/v1/tasks/{child_id}");
    assert_eq!(
        json_request(&ctx.app, "GET", &legacy_path, &bearer, None)
            .await
            .0,
        StatusCode::NOT_FOUND
    );
    // The legacy status path is the work-center handler and needs the
    // optimistic-lock token like every status change.
    assert_eq!(
        json_request(
            &ctx.app,
            "POST",
            &format!("{legacy_path}/status"),
            &bearer,
            Some(json!({ "status": "open", "expected_updated_at": started["updated_at"] }))
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
    for list_path in [path, "/api/v1/tasks"] {
        let (status, rows) = json_request(&ctx.app, "GET", list_path, &bearer, None).await;
        assert_eq!(status, StatusCode::OK, "{rows}");
        assert!(
            !rows
                .as_array()
                .unwrap()
                .iter()
                .any(|row| row["id"] == child["id"])
        );
    }
    let (_, detail) = json_request(&ctx.app, "GET", &manager_path, &bearer, None).await;
    assert_eq!(detail["item"]["child_count"], 0);

    // A regular task is owned by its creator, not its assignee. Owning the
    // parent does not grant concierge rights to delete somebody else's child.
    let (status, own_parent) = json_request(&ctx.app, "POST", path, &bearer, Some(json!({
        "request_id": Uuid::new_v4(), "kind": "task", "title": "Concierge's regular task", "assigned_to": peer,
    }))).await;
    assert_eq!(status, StatusCode::CREATED, "{own_parent}");
    let own_path = format!("{path}/{}", own_parent["id"].as_str().unwrap());
    assert_eq!(
        json_request(&ctx.app, "DELETE", &own_path, &peer_bearer, None)
            .await
            .0,
        StatusCode::FORBIDDEN
    );
    let (status, peer_child) = json_request(
        &ctx.app,
        "POST",
        path,
        &peer_bearer,
        Some(json!({
            "request_id": Uuid::new_v4(), "kind": "task", "title": "Peer's personal subtask",
            "assigned_to": peer, "parent_task_id": own_parent["id"],
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{peer_child}");
    let peer_child_path = format!("{path}/{}", peer_child["id"].as_str().unwrap());
    assert_eq!(
        json_request(&ctx.app, "DELETE", &peer_child_path, &bearer, None)
            .await
            .0,
        StatusCode::FORBIDDEN
    );
    let (status, blocked) = json_request(&ctx.app, "DELETE", &own_path, &bearer, None).await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(
        blocked["message"],
        "Delete subtasks and events before deleting this task"
    );
    assert_eq!(
        json_request(&ctx.app, "DELETE", &peer_child_path, &peer_bearer, None)
            .await
            .0,
        StatusCode::NO_CONTENT
    );
    assert_eq!(
        json_request(&ctx.app, "DELETE", &own_path, &bearer, None)
            .await
            .0,
        StatusCode::NO_CONTENT
    );
}

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

async fn seed_patient_assignment(
    pool: &PgPool,
    patient_id: Uuid,
    user_id: Uuid,
    assigned_by: Uuid,
) {
    sqlx::query(
        r#"INSERT INTO patient_assignments (patient_id, user_id, assigned_by)
           VALUES ($1, $2, $3)"#,
    )
    .bind(patient_id)
    .bind(user_id)
    .bind(assigned_by)
    .execute(pool)
    .await
    .unwrap();
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
    assert!(task["patient_id"].is_null());
    // Items name the order they belong to (generated order work links back to
    // it); a service task has none. The appointment link stays internal.
    assert!(task["order_id"].is_null());
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

    // Billing sees only its own tasks: a concierge's work is not opened by
    // rank (owner decision 2026-09-28); the CEO sees everything.
    let (status, billing_list) = json_request(
        &ctx.app,
        "GET",
        &format!("{path}?assigned_to={concierge_id}"),
        &billing_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{billing_list}");
    assert_eq!(billing_list.as_array().map(Vec::len), Some(0));
    let ceo_bearer = auth_header_for(ctx.admin_id, "ceo");
    let (status, manager_list) = json_request(
        &ctx.app,
        "GET",
        &format!("{path}?assigned_to={concierge_id}"),
        &ceo_bearer,
        None,
    )
    .await;
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

    let (status, billing_denied) = json_request(
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
    assert_eq!(status, StatusCode::FORBIDDEN, "{billing_denied}");
    let (status, manager_completed) = json_request(
        &ctx.app,
        "POST",
        &format!("{path}/{task_id}/status"),
        &ceo_bearer,
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

    let (status, billing_items) = json_request(
        &ctx.app,
        "GET",
        &format!("{path}?assigned_to={billing_id}"),
        &billing_bearer,
        None,
    )
    .await;
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
    // A disabled account must not bypass authentication, even for a replay.
    assert_eq!(
        mutable_replay_status,
        StatusCode::UNAUTHORIZED,
        "{mutable_replay}"
    );
    sqlx::query("UPDATE users SET is_active = true WHERE id = $1")
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
    seed_patient_assignment(&ctx.pool, patient_id, concierge_id, ctx.admin_id).await;
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

    // Patient managers belong to the release workspace, so the patients
    // surface is open to them as well.
    let (patients_status, patients) =
        json_request(&ctx.release_app, "GET", "/api/v1/patients", &bearer, None).await;
    assert_eq!(patients_status, StatusCode::OK, "{patients}");
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
    seed_patient_assignment(&ctx.pool, patient_id, creator_id, ctx.admin_id).await;
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

    // The assignee documents its work: it attaches files to its own task and
    // removes only its own uploads; the creator is notified.
    let (status, own_upload) = multipart_file_request(
        &ctx.app,
        &attachment_path,
        &assignee_bearer,
        &format!("receipt-{tag}.pdf"),
        "application/pdf",
        &pdf,
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{own_upload}");
    assert_eq!(own_upload["uploaded_by"], assignee_id.to_string());
    let own_upload_id = Uuid::parse_str(own_upload["id"].as_str().expect("own upload id")).unwrap();
    let upload_notifications: i64 = sqlx::query_scalar(
        r#"SELECT count(*) FROM user_notifications
           WHERE user_id = $1 AND kind = 'operational_task_updated'
             AND entity_id = $2 AND title = 'Task attachment added'"#,
    )
    .bind(creator_id)
    .bind(task_id)
    .fetch_one(&ctx.pool)
    .await
    .unwrap();
    assert_eq!(upload_notifications, 1);
    let (status, creator_file) = multipart_file_request(
        &ctx.app,
        &attachment_path,
        &creator_bearer,
        &format!("briefing-{tag}.pdf"),
        "application/pdf",
        &pdf,
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{creator_file}");
    let creator_file_id =
        Uuid::parse_str(creator_file["id"].as_str().expect("creator file id")).unwrap();
    let (status, denied_foreign) = raw_request(
        &ctx.app,
        "DELETE",
        &format!("{attachment_path}/{creator_file_id}"),
        &assignee_bearer,
    )
    .await;
    assert_eq!(
        status,
        StatusCode::FORBIDDEN,
        "{}",
        String::from_utf8_lossy(&denied_foreign)
    );
    let (status, removed_own) = raw_request(
        &ctx.app,
        "DELETE",
        &format!("{attachment_path}/{own_upload_id}"),
        &assignee_bearer,
    )
    .await;
    assert_eq!(
        status,
        StatusCode::NO_CONTENT,
        "{}",
        String::from_utf8_lossy(&removed_own)
    );
    let (status, removed_creator_file) = raw_request(
        &ctx.app,
        "DELETE",
        &format!("{attachment_path}/{creator_file_id}"),
        &creator_bearer,
    )
    .await;
    assert_eq!(
        status,
        StatusCode::NO_CONTENT,
        "{}",
        String::from_utf8_lossy(&removed_creator_file)
    );

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
    assert_eq!(attachment_events, 10);
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
async fn reassigned_task_notifies_its_new_assignee() {
    let Some(ctx) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let tag = Uuid::new_v4().simple().to_string();
    let creator_id = seed_user(&ctx.pool, "patient_manager", &format!("notify-pm-{tag}")).await;
    let first_id = seed_user(&ctx.pool, "concierge", &format!("notify-first-{tag}")).await;
    let second_id = seed_user(&ctx.pool, "concierge", &format!("notify-second-{tag}")).await;
    let creator_bearer = auth_header_for(creator_id, "patient_manager");
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
            "title": format!("Book restaurant {tag}"),
            "assigned_to": first_id,
            "priority": "normal"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{task}");
    let task_id = Uuid::parse_str(task["id"].as_str().expect("task id")).unwrap();
    let update_path = format!("{base_path}/{task_id}/update");

    let (status, reassigned) = json_request(
        &ctx.app,
        "POST",
        &update_path,
        &creator_bearer,
        Some(json!({
            "expected_updated_at": task["updated_at"],
            "kind": "task",
            "title": format!("Book restaurant {tag}"),
            "assigned_to": second_id,
            "priority": "normal",
            "status": "open"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{reassigned}");

    let (status, back_to_creator) = json_request(
        &ctx.app,
        "POST",
        &update_path,
        &ceo_bearer,
        Some(json!({
            "expected_updated_at": reassigned["updated_at"],
            "kind": "task",
            "title": format!("Book restaurant {tag}"),
            "assigned_to": creator_id,
            "priority": "normal",
            "status": "open"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{back_to_creator}");

    let notifications = |user_id: Uuid, kind: &'static str| {
        let pool = ctx.pool.clone();
        async move {
            sqlx::query_scalar::<_, i64>(
                r#"SELECT count(*) FROM user_notifications
                   WHERE user_id = $1 AND kind = $2 AND entity_id = $3"#,
            )
            .bind(user_id)
            .bind(kind)
            .bind(task_id)
            .fetch_one(&pool)
            .await
            .unwrap()
        }
    };
    assert_eq!(
        notifications(first_id, "operational_task_assigned").await,
        1
    );
    assert_eq!(
        notifications(second_id, "operational_task_assigned").await,
        1
    );
    // The creator gets one "new task" notice, not a second "task updated" one.
    assert_eq!(
        notifications(creator_id, "operational_task_assigned").await,
        1
    );
    assert_eq!(
        notifications(creator_id, "operational_task_updated").await,
        0
    );
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

    // The patient card's appointment list is open to the concierge (medical
    // appointments as blocked slots); the rest of the care history is not.
    let (status, appointments) = json_request(
        &ctx.app,
        "GET",
        &format!("/api/v1/patients/{patient_id}/appointments"),
        &concierge_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{appointments}");
    assert!(appointments.is_array(), "{appointments}");

    for restricted_path in ["cases", "orders", "document-alerts", "timeline"] {
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

    sqlx::query("UPDATE tasks SET status = 'completed', archived_at = now(), archived_by = $2 WHERE id = $1")
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
    let member_id = seed_user(&ctx.pool, "billing", &format!("project-member-{tag}")).await;
    let outsider_id = seed_user(&ctx.pool, "concierge", &format!("project-outsider-{tag}")).await;
    let ceo_bearer = auth_header_for(ctx.admin_id, "ceo");
    let member_bearer = auth_header_for(member_id, "billing");
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

    // A concierge assigned to the same patient does not see a task that is
    // neither assigned to it, created by it nor shared through a project: the
    // executor roles work on their own tasks ("W (свої)").
    let (status, patient_items) =
        json_request(&ctx.app, "GET", base_path, &patient_bearer, None).await;
    assert_eq!(status, StatusCode::OK, "{patient_items}");
    let patient_items = patient_items.as_array().expect("patient-scoped task list");
    assert!(
        !patient_items
            .iter()
            .any(|item| item["id"] == general_task_id.to_string())
    );
    assert!(
        !patient_items
            .iter()
            .any(|item| item["id"] == legacy_task_id.to_string())
    );

    let general_path = format!("{base_path}/{general_task_id}");
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
    let (status, owner_detail) =
        json_request(&ctx.app, "GET", &general_path, &owner_bearer, None).await;
    assert_eq!(status, StatusCode::OK, "{owner_detail}");

    for path in [general_path.clone(), format!("{general_path}/attachments")] {
        let (status, body) = json_request(&ctx.app, "GET", &path, &patient_bearer, None).await;
        assert_eq!(status, StatusCode::FORBIDDEN, "{path}: {body}");
        assert!(
            !body.to_string().contains("Canonical task comment"),
            "{path}: {body}"
        );
    }
    let (status, denied_status) = json_request(
        &ctx.app,
        "POST",
        &format!("{general_path}/status"),
        &patient_bearer,
        Some(json!({
            "expected_updated_at": owner_detail["item"]["updated_at"],
            "status": "in_progress"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN, "{denied_status}");

    // The same holds for an interpreter linked to the patient, while the
    // patient manager of that patient keeps the patient-wide task view.
    let interpreter_id = seed_user(&ctx.pool, "interpreter", &format!("work-interp-{tag}")).await;
    let manager_id = seed_user(&ctx.pool, "patient_manager", &format!("work-pm-{tag}")).await;
    for user_id in [interpreter_id, manager_id] {
        sqlx::query(
            r#"INSERT INTO patient_assignments (patient_id, user_id, assigned_by)
               VALUES ($1, $2, $3)"#,
        )
        .bind(patient_id)
        .bind(user_id)
        .bind(ctx.admin_id)
        .execute(&ctx.pool)
        .await
        .unwrap();
    }
    let interpreter_bearer = auth_header_for(interpreter_id, "interpreter");
    let (status, interpreter_items) =
        json_request(&ctx.app, "GET", base_path, &interpreter_bearer, None).await;
    assert_eq!(status, StatusCode::OK, "{interpreter_items}");
    assert!(
        !interpreter_items
            .as_array()
            .expect("interpreter task list")
            .iter()
            .any(|item| item["id"] == general_task_id.to_string())
    );
    let (status, body) =
        json_request(&ctx.app, "GET", &general_path, &interpreter_bearer, None).await;
    assert_eq!(status, StatusCode::FORBIDDEN, "{body}");
    let (status, manager_detail) = json_request(
        &ctx.app,
        "GET",
        &general_path,
        &auth_header_for(manager_id, "patient_manager"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{manager_detail}");
    assert_eq!(manager_detail["item"]["id"], general_task_id.to_string());

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

async fn create_work_center_task(
    app: &axum::Router,
    bearer: &str,
    assigned_to: Uuid,
    title: &str,
    parent_task_id: Option<&str>,
) -> Value {
    let (status, task) = json_request(
        app,
        "POST",
        "/api/v1/concierge-operational-items",
        bearer,
        Some(json!({
            "request_id": Uuid::new_v4(),
            "kind": "task",
            "title": title,
            "assigned_to": assigned_to,
            "starts_at": "2026-10-01T09:00:00Z",
            "due_at": "2026-10-02T17:00:00Z",
            "parent_task_id": parent_task_id,
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{task}");
    task
}

async fn work_center_detail(app: &axum::Router, bearer: &str, id: &str) -> Value {
    let (status, detail) = json_request(
        app,
        "GET",
        &format!("/api/v1/concierge-operational-items/{id}"),
        bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{detail}");
    detail
}

#[tokio::test]
async fn closing_a_parent_can_close_its_open_subtasks_and_reports_child_progress() {
    let Some(ctx) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let tag = Uuid::new_v4().simple().to_string();
    let owner = seed_user(&ctx.pool, "concierge", &format!("subtasks-{tag}")).await;
    let peer = seed_user(&ctx.pool, "concierge", &format!("subtasks-peer-{tag}")).await;
    let bearer = auth_header_for(owner, "concierge");
    let peer_bearer = auth_header_for(peer, "concierge");

    let parent = create_work_center_task(&ctx.app, &bearer, owner, "Parent", None).await;
    let parent_id = parent["id"].as_str().unwrap().to_string();
    let open_child =
        create_work_center_task(&ctx.app, &bearer, owner, "Open child", Some(&parent_id)).await;
    let open_child_id = open_child["id"].as_str().unwrap().to_string();
    let grandchild =
        create_work_center_task(&ctx.app, &bearer, owner, "Grandchild", Some(&open_child_id)).await;
    let mut done_child =
        create_work_center_task(&ctx.app, &bearer, owner, "Done child", Some(&parent_id)).await;
    let done_child_id = done_child["id"].as_str().unwrap().to_string();
    for next in ["in_progress", "completed"] {
        let (status, changed) = json_request(
            &ctx.app,
            "POST",
            &format!("/api/v1/concierge-operational-items/{done_child_id}/status"),
            &bearer,
            Some(json!({ "status": next, "expected_updated_at": done_child["updated_at"] })),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{changed}");
        done_child = changed;
    }

    let detail = work_center_detail(&ctx.app, &bearer, &parent_id).await;
    assert_eq!(detail["item"]["child_count"], 2, "{detail}");
    assert_eq!(detail["item"]["child_completed_count"], 1, "{detail}");
    assert_eq!(detail["item"]["child_open_count"], 1, "{detail}");

    let close_path = format!("/api/v1/concierge-operational-items/{parent_id}/close-children");
    let (status, body) = json_request(
        &ctx.app,
        "POST",
        &close_path,
        &bearer,
        Some(json!({ "status": "open" })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
    let (status, body) = json_request(
        &ctx.app,
        "POST",
        &close_path,
        &peer_bearer,
        Some(json!({ "status": "completed" })),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN, "{body}");

    let (status, closed) = json_request(
        &ctx.app,
        "POST",
        &close_path,
        &bearer,
        Some(json!({ "status": "completed" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{closed}");
    assert_eq!(closed["closed_count"], 2, "{closed}");

    for id in [open_child_id.as_str(), grandchild["id"].as_str().unwrap()] {
        let detail = work_center_detail(&ctx.app, &bearer, id).await;
        assert_eq!(detail["item"]["status"], "completed", "{detail}");
        assert!(
            detail["history"].as_array().unwrap().iter().any(|entry| {
                entry["payload"]["reason"] == "parent_closed"
                    && entry["payload"]["parent_task_id"] == json!(parent_id)
            }),
            "{detail}"
        );
    }
    let detail = work_center_detail(&ctx.app, &bearer, &parent_id).await;
    assert_eq!(detail["item"]["status"], "open", "{detail}");
    assert_eq!(detail["item"]["child_completed_count"], 2, "{detail}");
    assert_eq!(detail["item"]["child_open_count"], 0, "{detail}");

    // Nothing left to close: the call is a no-op.
    let (status, closed) = json_request(
        &ctx.app,
        "POST",
        &close_path,
        &bearer,
        Some(json!({ "status": "completed" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{closed}");
    assert_eq!(closed["closed_count"], 0, "{closed}");
}

async fn create_pool_task(
    app: &axum::Router,
    bearer: &str,
    title: &str,
    patient_id: Option<Uuid>,
) -> Value {
    let (status, task) = json_request(
        app,
        "POST",
        "/api/v1/concierge-operational-items",
        bearer,
        Some(json!({
            "request_id": Uuid::new_v4(),
            "kind": "task",
            "title": title,
            "patient_id": patient_id,
            "priority": "normal"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{task}");
    task
}

async fn list_work_center(app: &axum::Router, bearer: &str) -> Value {
    let (status, list) = json_request(
        app,
        "GET",
        "/api/v1/concierge-operational-items?archive=all",
        bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{list}");
    list
}

fn listed_ids(list: &Value) -> Vec<String> {
    list.as_array()
        .expect("task list")
        .iter()
        .filter_map(|row| row["id"].as_str().map(str::to_owned))
        .collect()
}

async fn count_task_files(app: &axum::Router, bearer: &str, file_name: &str) -> usize {
    let (status, files) = json_request(
        app,
        "GET",
        &format!("/api/v1/concierge-operational-attachments?q={file_name}"),
        bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{files}");
    files.as_array().map(Vec::len).unwrap_or_default()
}

/// Owner decision 2026-09-28 ("limit to the pool"): a rank over the concierge
/// does not open its tasks. The patient manager sees and manages concierge
/// work only for the patients of its pool, billing and sales see only their
/// own tasks, the CEO sees everything and the CEO assistant reads everything
/// without changing it.
#[tokio::test]
async fn managers_see_concierge_tasks_only_within_their_pool() {
    let Some(ctx) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let tag = Uuid::new_v4().simple().to_string();
    let concierge_id = seed_user(&ctx.pool, "concierge", &format!("pool-concierge-{tag}")).await;
    let manager_id = seed_user(&ctx.pool, "patient_manager", &format!("pool-pm-{tag}")).await;
    let billing_id = seed_user(&ctx.pool, "billing", &format!("pool-billing-{tag}")).await;
    let sales_id = seed_user(&ctx.pool, "sales", &format!("pool-sales-{tag}")).await;
    let assistant_id =
        seed_user(&ctx.pool, "ceo_assistant", &format!("pool-assistant-{tag}")).await;
    let own_patient_id = seed_patient(&ctx.pool, ctx.admin_id, &format!("pool-own-{tag}")).await;
    let foreign_patient_id =
        seed_patient(&ctx.pool, ctx.admin_id, &format!("pool-foreign-{tag}")).await;
    seed_patient_assignment(&ctx.pool, own_patient_id, manager_id, ctx.admin_id).await;
    // The concierge works for both patients (a task names only a patient its
    // author may open).
    for patient_id in [own_patient_id, foreign_patient_id] {
        seed_patient_assignment(&ctx.pool, patient_id, concierge_id, ctx.admin_id).await;
    }

    let concierge = auth_header_for(concierge_id, "concierge");
    let manager = auth_header_for(manager_id, "patient_manager");
    let billing = auth_header_for(billing_id, "billing");
    let sales = auth_header_for(sales_id, "sales");
    let assistant = auth_header_for(assistant_id, "ceo_assistant");
    let ceo = auth_header_for(ctx.admin_id, "ceo");
    let base_path = "/api/v1/concierge-operational-items";

    let foreign_task = create_pool_task(
        &ctx.app,
        &concierge,
        &format!("Foreign transfer {tag}"),
        Some(foreign_patient_id),
    )
    .await;
    let own_task = create_pool_task(
        &ctx.app,
        &concierge,
        &format!("Own transfer {tag}"),
        Some(own_patient_id),
    )
    .await;
    let patientless_task =
        create_pool_task(&ctx.app, &concierge, &format!("Office errand {tag}"), None).await;
    let billing_task = create_pool_task(
        &ctx.app,
        &billing,
        &format!("Billing follow-up {tag}"),
        None,
    )
    .await;
    let sales_task =
        create_pool_task(&ctx.app, &sales, &format!("Sales follow-up {tag}"), None).await;
    let foreign_id = foreign_task["id"].as_str().unwrap().to_owned();
    let own_id = own_task["id"].as_str().unwrap().to_owned();
    let patientless_id = patientless_task["id"].as_str().unwrap().to_owned();
    let billing_task_id = billing_task["id"].as_str().unwrap().to_owned();
    let sales_task_id = sales_task["id"].as_str().unwrap().to_owned();

    // A file on the foreign task must not surface in the file lists either.
    let file_name = format!("foreign-{tag}.pdf");
    let (status, attachment) = multipart_file_request(
        &ctx.app,
        &format!("{base_path}/{foreign_id}/attachments"),
        &concierge,
        &file_name,
        "application/pdf",
        format!("%PDF-1.4\nGMED pool {tag}\n%%EOF").as_bytes(),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{attachment}");

    // Patient manager: the concierge task of its own patient, not the others.
    let manager_list = list_work_center(&ctx.app, &manager).await;
    let manager_ids = listed_ids(&manager_list);
    assert!(manager_ids.contains(&own_id));
    assert!(!manager_ids.contains(&foreign_id));
    assert!(!manager_ids.contains(&patientless_id));
    let own_row = manager_list
        .as_array()
        .unwrap()
        .iter()
        .find(|row| row["id"] == own_id.as_str())
        .unwrap();
    assert_eq!(own_row["can_manage"], true, "{own_row}");
    assert_eq!(count_task_files(&ctx.app, &manager, &file_name).await, 0);
    for path in [
        format!("{base_path}/{foreign_id}"),
        format!("{base_path}/{foreign_id}/attachments"),
        format!("/api/v1/tasks/{foreign_id}"),
    ] {
        let (status, body) = json_request(&ctx.app, "GET", &path, &manager, None).await;
        assert_eq!(status, StatusCode::FORBIDDEN, "{path}: {body}");
        assert!(
            !body.to_string().contains("Foreign transfer"),
            "{path}: {body}"
        );
    }
    // The legacy status path runs the same handler.
    for path in [
        format!("{base_path}/{foreign_id}/status"),
        format!("/api/v1/tasks/{foreign_id}/status"),
    ] {
        let (status, body) = json_request(
            &ctx.app,
            "POST",
            &path,
            &manager,
            Some(json!({
                "expected_updated_at": foreign_task["updated_at"],
                "status": "in_progress"
            })),
        )
        .await;
        assert_eq!(status, StatusCode::FORBIDDEN, "{path}: {body}");
    }
    let (status, body) = json_request(
        &ctx.app,
        "POST",
        &format!("{base_path}/{foreign_id}/comments"),
        &manager,
        Some(json!({ "request_id": Uuid::new_v4(), "body": "Not my patient" })),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN, "{body}");
    let (status, detail) = json_request(
        &ctx.app,
        "GET",
        &format!("{base_path}/{own_id}"),
        &manager,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{detail}");
    assert_eq!(detail["item"]["can_manage"], true);
    let (status, started) = json_request(
        &ctx.app,
        "POST",
        &format!("{base_path}/{own_id}/status"),
        &manager,
        Some(json!({
            "expected_updated_at": own_task["updated_at"],
            "status": "in_progress"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{started}");

    // Billing and sales: only their own tasks.
    for (bearer, own_task_id, other_task_id) in [
        (&billing, &billing_task_id, &sales_task_id),
        (&sales, &sales_task_id, &billing_task_id),
    ] {
        let ids = listed_ids(&list_work_center(&ctx.app, bearer).await);
        assert!(ids.contains(own_task_id));
        for hidden in [&foreign_id, &own_id, &patientless_id, other_task_id] {
            assert!(!ids.contains(hidden), "{hidden} leaked into {ids:?}");
        }
        assert_eq!(count_task_files(&ctx.app, bearer, &file_name).await, 0);
        let (status, body) = json_request(
            &ctx.app,
            "GET",
            &format!("{base_path}/{own_id}"),
            bearer,
            None,
        )
        .await;
        assert_eq!(status, StatusCode::FORBIDDEN, "{body}");
        let (status, body) = json_request(
            &ctx.app,
            "POST",
            &format!("{base_path}/{patientless_id}/status"),
            bearer,
            Some(json!({
                "expected_updated_at": patientless_task["updated_at"],
                "status": "in_progress"
            })),
        )
        .await;
        assert_eq!(status, StatusCode::FORBIDDEN, "{body}");
    }

    // CEO and CEO assistant see every task; only the CEO changes them.
    for bearer in [&ceo, &assistant] {
        let ids = listed_ids(&list_work_center(&ctx.app, bearer).await);
        for visible in [
            &foreign_id,
            &own_id,
            &patientless_id,
            &billing_task_id,
            &sales_task_id,
        ] {
            assert!(ids.contains(visible), "{visible} missing from {ids:?}");
        }
        assert_eq!(count_task_files(&ctx.app, bearer, &file_name).await, 1);
    }
    let (status, detail) = json_request(
        &ctx.app,
        "GET",
        &format!("{base_path}/{foreign_id}"),
        &assistant,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{detail}");
    assert_eq!(detail["item"]["can_manage"], false);
    let (status, body) = json_request(
        &ctx.app,
        "POST",
        &format!("{base_path}/{foreign_id}/status"),
        &assistant,
        Some(json!({
            "expected_updated_at": foreign_task["updated_at"],
            "status": "in_progress"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN, "{body}");
    let (status, body) = json_request(
        &ctx.app,
        "POST",
        &format!("{base_path}/{foreign_id}/update"),
        &assistant,
        Some(json!({
            "expected_updated_at": foreign_task["updated_at"],
            "kind": "task",
            "title": "Assistant must not rename it",
            "priority": "normal",
            "status": "open"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN, "{body}");
    let (status, body) = json_request(
        &ctx.app,
        "POST",
        &format!("{base_path}/{foreign_id}/comments"),
        &assistant,
        Some(json!({ "request_id": Uuid::new_v4(), "body": "Read-only role" })),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN, "{body}");
    let (status, detail) = json_request(
        &ctx.app,
        "GET",
        &format!("{base_path}/{foreign_id}"),
        &ceo,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{detail}");
    assert_eq!(detail["item"]["can_manage"], true);
    let (status, body) = json_request(
        &ctx.app,
        "POST",
        &format!("{base_path}/{foreign_id}/status"),
        &ceo,
        Some(json!({
            "expected_updated_at": detail["item"]["updated_at"],
            "status": "in_progress"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
}

async fn post_task(app: &axum::Router, bearer: &str, body: Value) -> (StatusCode, Value) {
    json_request(
        app,
        "POST",
        "/api/v1/concierge-operational-items",
        bearer,
        Some(body),
    )
    .await
}

fn task_body(title: &str, patient_id: Option<Uuid>) -> Value {
    json!({
        "request_id": Uuid::new_v4(),
        "kind": "task",
        "title": title,
        "patient_id": patient_id,
        "priority": "normal"
    })
}

fn update_body(task: &Value, patient_id: Option<Uuid>) -> Value {
    json!({
        "expected_updated_at": task["updated_at"],
        "kind": "task",
        "title": task["title"],
        "patient_id": patient_id,
        "priority": "normal",
        "status": "open"
    })
}

/// A task names only a patient its author may open (`patients.view` and the
/// shared patient access rule), and a task visible without its patient (for
/// example shared through a project) shows neither the patient's name nor
/// the birth date: otherwise knowing a patient UUID would reveal the person.
#[tokio::test]
async fn tasks_name_only_patients_their_author_may_open() {
    let Some(ctx) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let tag = Uuid::new_v4().simple().to_string();
    let hidden_name = format!("Hidden{}", &tag[..12]);
    let patient_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO patients (
               patient_id, first_name, last_name, birth_date, gender, created_by
           ) VALUES ($1, 'Private', $2, '1984-05-06', 'diverse', $3)
           RETURNING id"#,
    )
    .bind(format!("OPS-LINK-{tag}"))
    .bind(&hidden_name)
    .bind(ctx.admin_id)
    .fetch_one(&ctx.pool)
    .await
    .unwrap();
    let concierge_id = seed_user(&ctx.pool, "concierge", &format!("link-concierge-{tag}")).await;
    let assigned_pm_id = seed_user(&ctx.pool, "patient_manager", &format!("link-pm-{tag}")).await;
    let other_pm_id = seed_user(&ctx.pool, "patient_manager", &format!("link-other-{tag}")).await;
    let interpreter_id = seed_user(&ctx.pool, "interpreter", &format!("link-interp-{tag}")).await;
    let billing_id = seed_user(&ctx.pool, "billing", &format!("link-billing-{tag}")).await;
    let sales_id = seed_user(&ctx.pool, "sales", &format!("link-sales-{tag}")).await;
    let assistant_id =
        seed_user(&ctx.pool, "ceo_assistant", &format!("link-assistant-{tag}")).await;
    for user_id in [concierge_id, assigned_pm_id] {
        seed_patient_assignment(&ctx.pool, patient_id, user_id, ctx.admin_id).await;
    }
    let concierge = auth_header_for(concierge_id, "concierge");
    let assigned_pm = auth_header_for(assigned_pm_id, "patient_manager");
    let other_pm = auth_header_for(other_pm_id, "patient_manager");
    let interpreter = auth_header_for(interpreter_id, "interpreter");
    let billing = auth_header_for(billing_id, "billing");
    let sales = auth_header_for(sales_id, "sales");
    let assistant = auth_header_for(assistant_id, "ceo_assistant");
    let ceo = auth_header_for(ctx.admin_id, "ceo");
    let base_path = "/api/v1/concierge-operational-items";

    // Creating: sales (no patients.view) and a patient manager outside the
    // pool are refused and no task is stored; an unknown patient is 422.
    for (bearer, title) in [
        (&sales, format!("Sales probe {tag}")),
        (&other_pm, format!("Foreign PM probe {tag}")),
    ] {
        let (status, body) = post_task(&ctx.app, bearer, task_body(&title, Some(patient_id))).await;
        assert_eq!(status, StatusCode::FORBIDDEN, "{title}: {body}");
        assert!(!body.to_string().contains(&hidden_name), "{body}");
        let stored: i64 = sqlx::query_scalar("SELECT count(*) FROM tasks WHERE title = $1")
            .bind(&title)
            .fetch_one(&ctx.pool)
            .await
            .unwrap();
        assert_eq!(stored, 0, "{title}");
    }
    let (status, body) = post_task(
        &ctx.app,
        &assigned_pm,
        task_body("Unknown patient", Some(Uuid::new_v4())),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");

    // The patient manager of the patient, billing (basic patient data), the
    // CEO assistant and the CEO may name the patient.
    let mut pm_task = Value::Null;
    for bearer in [&assigned_pm, &billing, &assistant, &ceo] {
        let (status, task) = post_task(
            &ctx.app,
            bearer,
            task_body(&format!("Allowed link {tag}"), Some(patient_id)),
        )
        .await;
        assert_eq!(status, StatusCode::CREATED, "{task}");
        assert_eq!(task["patient_name"], format!("Private {hidden_name}"));
        assert_eq!(task["patient_birth_date"], "1984-05-06");
        if pm_task.is_null() {
            pm_task = task;
        }
    }

    // Sub-tasks and edits follow the same rule.
    let (status, sales_task) = post_task(
        &ctx.app,
        &sales,
        task_body(&format!("Sales own {tag}"), None),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{sales_task}");
    let mut subtask = task_body(&format!("Sales subtask {tag}"), Some(patient_id));
    subtask["parent_task_id"] = sales_task["id"].clone();
    let (status, body) = post_task(&ctx.app, &sales, subtask).await;
    assert_eq!(status, StatusCode::FORBIDDEN, "{body}");
    let (status, body) = json_request(
        &ctx.app,
        "POST",
        &format!("{base_path}/{}/update", sales_task["id"].as_str().unwrap()),
        &sales,
        Some(update_body(&sales_task, Some(patient_id))),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN, "{body}");
    let (status, other_pm_task) = post_task(
        &ctx.app,
        &other_pm,
        task_body(&format!("Other PM own {tag}"), None),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{other_pm_task}");
    let (status, body) = json_request(
        &ctx.app,
        "POST",
        &format!(
            "{base_path}/{}/update",
            other_pm_task["id"].as_str().unwrap()
        ),
        &other_pm,
        Some(update_body(&other_pm_task, Some(patient_id))),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN, "{body}");

    // A kept link stays editable after the assignment ends, but the patient's
    // data is no longer shown to the former manager.
    sqlx::query(
        "UPDATE patient_assignments SET revoked_at = now() WHERE patient_id = $1 AND user_id = $2",
    )
    .bind(patient_id)
    .bind(assigned_pm_id)
    .execute(&ctx.pool)
    .await
    .unwrap();
    let (status, kept) = json_request(
        &ctx.app,
        "POST",
        &format!("{base_path}/{}/update", pm_task["id"].as_str().unwrap()),
        &assigned_pm,
        Some(update_body(&pm_task, Some(patient_id))),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{kept}");
    assert_eq!(kept["patient_id"], patient_id.to_string());
    assert!(kept["patient_name"].is_null(), "{kept}");
    assert!(kept["patient_birth_date"].is_null(), "{kept}");

    // A project shares a patient task with members who may not open the
    // patient: they see the task, not the patient's name or birth date.
    let (status, project) = json_request(
        &ctx.app,
        "POST",
        "/api/v1/projects",
        &ceo,
        Some(json!({
            "name": format!("Shared project {tag}"),
            "status": "active",
            "priority": "normal",
            "owner_id": ctx.admin_id,
            "member_ids": [other_pm_id, interpreter_id]
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{project}");
    let mut shared = task_body(&format!("Shared transfer {tag}"), Some(patient_id));
    shared["assigned_to"] = json!(concierge_id);
    shared["project_id"] = project["id"].clone();
    let (status, shared_task) = post_task(&ctx.app, &ceo, shared).await;
    assert_eq!(status, StatusCode::CREATED, "{shared_task}");
    let shared_id = shared_task["id"].as_str().unwrap().to_owned();
    let file_name = format!("shared-{tag}.pdf");
    let (status, attachment) = multipart_file_request(
        &ctx.app,
        &format!("{base_path}/{shared_id}/attachments"),
        &ceo,
        &file_name,
        "application/pdf",
        format!("%PDF-1.4\nGMED shared {tag}\n%%EOF").as_bytes(),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{attachment}");

    for bearer in [&other_pm, &interpreter] {
        let list = list_work_center(&ctx.app, bearer).await;
        let row = list
            .as_array()
            .unwrap()
            .iter()
            .find(|row| row["id"] == shared_id.as_str())
            .expect("project task is visible");
        assert_eq!(row["patient_id"], patient_id.to_string());
        assert!(row["patient_name"].is_null(), "{row}");
        assert!(row["patient_birth_date"].is_null(), "{row}");
        let (status, detail) = json_request(
            &ctx.app,
            "GET",
            &format!("{base_path}/{shared_id}"),
            bearer,
            None,
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{detail}");
        assert!(!detail.to_string().contains(&hidden_name), "{detail}");
        assert!(!detail.to_string().contains("1984-05-06"), "{detail}");
        let (status, files) = json_request(
            &ctx.app,
            "GET",
            &format!("/api/v1/concierge-operational-attachments?q={file_name}"),
            bearer,
            None,
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{files}");
        assert_eq!(files.as_array().map(Vec::len), Some(1), "{files}");
        assert!(files[0]["patient_name"].is_null(), "{files}");
        // Searching by the patient's name does not reveal the hidden patient.
        assert_eq!(count_task_files(&ctx.app, bearer, &hidden_name).await, 0);
    }
    // Those who may open the patient keep its data.
    for bearer in [&concierge, &assistant, &ceo] {
        let (status, detail) = json_request(
            &ctx.app,
            "GET",
            &format!("{base_path}/{shared_id}"),
            bearer,
            None,
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{detail}");
        assert_eq!(
            detail["item"]["patient_name"],
            format!("Private {hidden_name}")
        );
        assert_eq!(detail["item"]["patient_birth_date"], "1984-05-06");
    }
    assert_eq!(count_task_files(&ctx.app, &ceo, &hidden_name).await, 1);
}
