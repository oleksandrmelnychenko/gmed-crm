mod support;

use std::time::Duration;

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
async fn assigned_concierge_manages_only_own_non_clinical_tasks_and_events() {
    let Some(ctx) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let tag = Uuid::new_v4().simple().to_string();
    let concierge_id = seed_user(&ctx.pool, "concierge", &format!("owner-{tag}")).await;
    let other_id = seed_user(&ctx.pool, "concierge", &format!("other-{tag}")).await;
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

    let update_path = format!("{path}/{task_id}/update");
    let update_body = json!({
        "expected_updated_at": task["updated_at"],
        "kind": "task",
        "title": "Driver confirmed",
        "note": "Pickup point agreed",
        "concierge_service_id": service_id,
        "due_at": "2026-08-20T09:15:00Z",
        "priority": "normal",
        "status": "completed"
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
    assert_eq!(updated["status"], "completed");
    assert!(updated["completed_at"].is_string());

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
    assert_eq!(current["item"]["status"], "completed");

    let (status, generic) = json_request(
        &ctx.app,
        "GET",
        &format!("/api/v1/tasks/{task_id}"),
        &bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND, "{generic}");

    let row: (String, Option<Uuid>, Option<Uuid>, Option<Uuid>) = sqlx::query_as(
        "SELECT task_scope, patient_id, order_id, appointment_id FROM tasks WHERE id = $1",
    )
    .bind(task_id)
    .fetch_one(&ctx.pool)
    .await
    .unwrap();
    assert_eq!(row.0, "concierge_operational");
    assert_eq!((row.1, row.2, row.3), (None, None, None));
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
    assert_eq!(billing_items[0]["assigned_to"], billing_id.to_string());
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
    assert_eq!(
        revoked_replay_status,
        StatusCode::FORBIDDEN,
        "{revoked_replay}"
    );
    assert!(revoked_replay.get("note").is_none(), "{revoked_replay}");

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
           WHERE id IN ($1, $2) AND task_scope = 'concierge_operational'"#,
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
async fn patient_manager_cannot_access_concierge_operational_items() {
    let Some(ctx) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let tag = Uuid::new_v4().simple().to_string();
    let manager_id = seed_user(&ctx.pool, "patient_manager", &format!("manager-{tag}")).await;
    let bearer = auth_header_for(manager_id, "patient_manager");
    let path = "/api/v1/concierge-operational-items";

    let (list_status, list) = json_request(&ctx.app, "GET", path, &bearer, None).await;
    assert_eq!(list_status, StatusCode::FORBIDDEN, "{list}");

    let (create_status, create) = json_request(
        &ctx.app,
        "POST",
        path,
        &bearer,
        Some(json!({
            "request_id": Uuid::new_v4(),
            "kind": "task",
            "title": "Must stay forbidden"
        })),
    )
    .await;
    assert_eq!(create_status, StatusCode::FORBIDDEN, "{create}");
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
    let (status, forbidden) =
        json_request(&ctx.app, "GET", &detail_path, &other_bearer, None).await;
    assert_eq!(status, StatusCode::FORBIDDEN, "{forbidden}");

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
    let (status, drift) = json_request(
        &ctx.app,
        "POST",
        &format!("{detail_path}/comments"),
        &concierge_bearer,
        Some(json!({ "request_id": comment_request_id, "body": "Different data" })),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{drift}");

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
async fn reassignment_serializes_detail_and_child_mutations_before_revoking_old_assignee() {
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

    let (status, denied_checklist) = json_request(
        &ctx.app,
        "POST",
        &checklist_path,
        &old_bearer,
        Some(json!({
            "request_id": Uuid::new_v4(),
            "label": "Former assignee cannot append"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN, "{denied_checklist}");
    let (status, denied_toggle) = json_request(
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
    assert_eq!(status, StatusCode::FORBIDDEN, "{denied_toggle}");

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
    let checklist_state: (i64, bool) = sqlx::query_as(
        r#"SELECT count(*) OVER (), is_completed
           FROM concierge_operational_task_checklist_items
           WHERE task_id = $1"#,
    )
    .bind(task_id)
    .fetch_one(&ctx.pool)
    .await
    .unwrap();
    assert_eq!(checklist_state, (1, false));
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
