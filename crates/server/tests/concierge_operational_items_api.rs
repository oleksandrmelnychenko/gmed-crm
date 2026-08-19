mod support;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use serde_json::{Value, json};
use sqlx::PgPool;
use tower::ServiceExt;
use uuid::Uuid;

use gmed_server::auth::jwt;

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

    let (status, updated) =
        json_request(&ctx.app, "POST", &update_path, &bearer, Some(update_body)).await;
    assert_eq!(status, StatusCode::OK, "{updated}");
    assert_eq!(updated["status"], "completed");
    assert!(updated["completed_at"].is_string());

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

    let (status, unknown_field) = json_request(
        &ctx.app,
        "POST",
        path,
        &bearer,
        Some(json!({
            "kind": "task",
            "title": "Unsafe task",
            "patient_id": patient_id
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
            "kind": "task",
            "title": "Unsafe linked service",
            "concierge_service_id": service_id
        })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{medical_link}");
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
            "kind": "task",
            "title": "Must stay forbidden"
        })),
    )
    .await;
    assert_eq!(create_status, StatusCode::FORBIDDEN, "{create}");
}
