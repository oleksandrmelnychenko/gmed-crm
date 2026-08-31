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
    .bind(format!("Key Custodian {tag}"))
    .bind(role)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn seed_patient(pool: &PgPool, created_by: Uuid, tag: &str) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO patients (
               patient_id, first_name, last_name, birth_date, gender, created_by
           ) VALUES ($1, 'Key', 'Service', '1990-01-01', 'diverse', $2)
           RETURNING id"#,
    )
    .bind(format!("KEY-{tag}"))
    .bind(created_by)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn seed_general_key_task(
    pool: &PgPool,
    patient_id: Uuid,
    assigned_to: Uuid,
    assigned_by: Uuid,
    tag: &str,
) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO tasks (
               title, assigned_to, assigned_by, patient_id,
               task_scope, task_kind, status
           ) VALUES ($1, $2, $3, $4, 'general', 'task', 'open')
           RETURNING id"#,
    )
    .bind(format!("Key handover {tag}"))
    .bind(assigned_to)
    .bind(assigned_by)
    .bind(patient_id)
    .fetch_one(pool)
    .await
    .unwrap()
}

#[tokio::test]
async fn general_task_keeps_task_native_key_custody_history() {
    let Some(ctx) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let tag = Uuid::new_v4().simple().to_string();
    let assignee_id = seed_user(&ctx.pool, "concierge", &format!("task-owner-{tag}")).await;
    let other_id = seed_user(&ctx.pool, "concierge", &format!("task-other-{tag}")).await;
    let manager_id = seed_user(&ctx.pool, "patient_manager", &format!("task-manager-{tag}")).await;
    let patient_id = seed_patient(&ctx.pool, ctx.admin_id, &format!("task-{tag}")).await;
    let task_id =
        seed_general_key_task(&ctx.pool, patient_id, assignee_id, ctx.admin_id, &tag).await;
    let path = format!("/api/v1/tasks/{task_id}/key-events");

    let (status, received) = json_request(
        &ctx.app,
        "POST",
        &path,
        &auth_header_for(assignee_id, "concierge"),
        Some(json!({ "action": "received", "note": "Task-native custody" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{received}");
    assert_eq!(received["event"]["task_id"], task_id.to_string());
    assert!(received["event"]["concierge_service_id"].is_null());
    assert_eq!(received["key_status"], "received");

    let (status, stored) = json_request(
        &ctx.app,
        "POST",
        &path,
        &auth_header_for(manager_id, "patient_manager"),
        Some(json!({
            "action": "stored",
            "responsible_user_id": assignee_id
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{stored}");

    let (status, history) = json_request(
        &ctx.app,
        "GET",
        &path,
        &auth_header_for(manager_id, "patient_manager"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{history}");
    assert_eq!(history.as_array().map(Vec::len), Some(2));
    assert!(history[0]["concierge_service_id"].is_null());

    let (status, forbidden) = json_request(
        &ctx.app,
        "GET",
        &path,
        &auth_header_for(other_id, "concierge"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN, "{forbidden}");

    let row: (String, Option<Uuid>, i64) = sqlx::query_as(
        r#"SELECT task.key_status, task.concierge_service_id,
                  (SELECT count(*) FROM concierge_service_key_events event
                   WHERE event.task_id = task.id
                     AND event.concierge_service_id IS NULL)
           FROM tasks task WHERE task.id = $1"#,
    )
    .bind(task_id)
    .fetch_one(&ctx.pool)
    .await
    .unwrap();
    assert_eq!(row.0, "stored");
    assert_eq!(row.1, None);
    assert_eq!(row.2, 2);
}

#[tokio::test]
async fn assigned_concierge_records_ordered_key_custody_history() {
    let Some(ctx) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let tag = Uuid::new_v4().simple().to_string();
    let concierge_id = seed_user(&ctx.pool, "concierge", &format!("owner-{tag}")).await;
    let other_concierge_id = seed_user(&ctx.pool, "concierge", &format!("other-{tag}")).await;
    let patient_id = seed_patient(&ctx.pool, ctx.admin_id, &tag).await;
    let admin_bearer = auth_header_for(ctx.admin_id, "ceo");
    let concierge_bearer = auth_header_for(concierge_id, "concierge");
    let other_bearer = auth_header_for(other_concierge_id, "concierge");

    let (status, service) = json_request(
        &ctx.app,
        "POST",
        "/api/v1/concierge-services",
        &admin_bearer,
        Some(json!({
            "patient_id": patient_id,
            "assigned_concierge_id": concierge_id,
            "service_kind": "other",
            "title": "Operational key handover"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{service}");
    assert!(service["key_status"].is_null());
    let service_id = service["id"].as_str().expect("service id");
    let events_path = format!("/api/v1/concierge-services/{service_id}/key-events");

    let (status, received) = json_request(
        &ctx.app,
        "POST",
        &events_path,
        &concierge_bearer,
        Some(json!({ "action": "received", "note": "Envelope intact" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{received}");
    assert_eq!(received["key_status"], "received");
    assert_eq!(
        received["key_responsible_user_id"],
        concierge_id.to_string()
    );
    assert_eq!(received["event"]["recorded_by"], concierge_id.to_string());

    let (status, invalid) = json_request(
        &ctx.app,
        "POST",
        &events_path,
        &concierge_bearer,
        Some(json!({ "action": "received" })),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{invalid}");

    for action in ["stored", "handed_over", "returned"] {
        let (status, payload) = json_request(
            &ctx.app,
            "POST",
            &events_path,
            &concierge_bearer,
            Some(json!({ "action": action })),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{payload}");
        assert_eq!(payload["key_status"], action);
    }

    let (status, history) =
        json_request(&ctx.app, "GET", &events_path, &concierge_bearer, None).await;
    assert_eq!(status, StatusCode::OK, "{history}");
    let actions = history
        .as_array()
        .expect("key history")
        .iter()
        .map(|event| event["action"].as_str().unwrap())
        .collect::<Vec<_>>();
    assert_eq!(actions, ["received", "stored", "handed_over", "returned"]);

    let (status, forbidden) =
        json_request(&ctx.app, "GET", &events_path, &other_bearer, None).await;
    assert_eq!(status, StatusCode::FORBIDDEN, "{forbidden}");

    let row: (Option<String>, Option<Uuid>, i64) = sqlx::query_as(
        r#"SELECT cs.key_status, cs.key_responsible_user_id,
                  (SELECT count(*) FROM concierge_service_key_events e
                   WHERE e.concierge_service_id = cs.id)
           FROM concierge_services cs
           WHERE cs.id = $1"#,
    )
    .bind(Uuid::parse_str(service_id).unwrap())
    .fetch_one(&ctx.pool)
    .await
    .unwrap();
    assert_eq!(row.0.as_deref(), Some("returned"));
    assert_eq!(row.1, Some(concierge_id));
    assert_eq!(row.2, 4);
}
