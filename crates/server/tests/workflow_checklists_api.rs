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
    let db_url = std::env::var("DATABASE_URL").ok()?;
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
    let app = gmed_server::build_app(state);
    Some((app, pool, admin_id))
}

async fn json_request(
    app: &axum::Router,
    method: &str,
    path: &str,
    bearer: &str,
    body: Option<Value>,
) -> (StatusCode, Value) {
    let req = Request::builder()
        .method(method)
        .uri(path)
        .header("Authorization", bearer)
        .header("Content-Type", "application/json")
        .body(match body {
            Some(v) => Body::from(serde_json::to_vec(&v).unwrap()),
            None => Body::empty(),
        })
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();
    let status = resp.status();
    let bytes = axum::body::to_bytes(resp.into_body(), 4 * 1024 * 1024)
        .await
        .unwrap();
    let value = serde_json::from_slice(&bytes).unwrap_or(json!(null));
    (status, value)
}

fn auth_header_for(user_id: Uuid, role: &str) -> String {
    let token = jwt::issue_access_token(TEST_SECRET, user_id, role, Uuid::new_v4()).unwrap();
    format!("Bearer {token}")
}

fn unique_tag(prefix: &str) -> String {
    format!("{prefix}-{}", Uuid::new_v4().simple())
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

async fn create_patient(app: &axum::Router, bearer: &str, tag: &str) -> Uuid {
    let (status, body) = json_request(
        app,
        "POST",
        "/api/v1/patients",
        bearer,
        Some(json!({
            "first_name": format!("First {tag}"),
            "last_name": format!("Last {tag}"),
            "birth_date": "1990-01-01",
            "gender": "diverse",
            "phone_primary": "+49 221 123456"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    Uuid::parse_str(body["id"].as_str().unwrap()).unwrap()
}

async fn create_order(app: &axum::Router, bearer: &str, patient_id: Uuid) -> Uuid {
    let (status, body) = json_request(
        app,
        "POST",
        "/api/v1/orders",
        bearer,
        Some(json!({
            "patient_id": patient_id,
            "needs_description": "Workflow coverage order"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    Uuid::parse_str(body["id"].as_str().unwrap()).unwrap()
}

#[tokio::test]
async fn patient_and_order_creation_seed_default_workflow_checklists_and_tasks() {
    let Some((app, pool, _admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("workflow-seed");
    let pm_id = seed_user(&pool, &tag, "patient_manager").await;
    let pm_bearer = auth_header_for(pm_id, "patient_manager");

    let patient_id = create_patient(&app, &pm_bearer, &tag).await;

    let (status, patient_workflow) = json_request(
        &app,
        "GET",
        &format!("/api/v1/patients/{patient_id}/workflow-checklist"),
        &pm_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(patient_workflow["scope_type"], "patient");
    assert!(patient_workflow["open_count"].as_u64().unwrap() >= 4);
    assert!(
        patient_workflow["items"]
            .as_array()
            .unwrap()
            .iter()
            .all(|item| item["linked_task_id"].as_str().is_some())
    );

    let (status, patient_tasks) = json_request(
        &app,
        "GET",
        &format!("/api/v1/tasks?patient_id={patient_id}&mine_only=true"),
        &pm_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(patient_tasks.as_array().unwrap().iter().any(|item| {
        item["title"]
            .as_str()
            .unwrap_or_default()
            .contains("Patient checklist")
    }));

    let order_id = create_order(&app, &pm_bearer, patient_id).await;
    let (status, order_workflow) = json_request(
        &app,
        "GET",
        &format!("/api/v1/orders/{order_id}/workflow-checklist"),
        &pm_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(order_workflow["scope_type"], "order");
    let order_items = order_workflow["items"].as_array().unwrap();
    assert!(
        order_items
            .iter()
            .any(|item| item["checklist_key"] == "order_discovery")
    );

    let (status, order_tasks) = json_request(
        &app,
        "GET",
        &format!("/api/v1/tasks?order_id={order_id}&mine_only=true"),
        &pm_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(order_tasks.as_array().unwrap().iter().any(|item| {
        item["title"]
            .as_str()
            .unwrap_or_default()
            .contains("Order checklist")
    }));
}

#[tokio::test]
async fn order_phase_progression_backfills_new_workflow_groups() {
    let Some((app, pool, _admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("workflow-phase");
    let pm_id = seed_user(&pool, &tag, "patient_manager").await;
    let pm_bearer = auth_header_for(pm_id, "patient_manager");
    let patient_id = create_patient(&app, &pm_bearer, &tag).await;
    let order_id = create_order(&app, &pm_bearer, patient_id).await;

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/orders/{order_id}/phase"),
        &pm_bearer,
        Some(json!({ "phase": "execution" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/orders/{order_id}/workflow-checklist"),
        &pm_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let keys = body["items"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|item| item["checklist_key"].as_str())
        .collect::<Vec<_>>();
    assert!(keys.contains(&"order_discovery"));
    assert!(keys.contains(&"order_intake"));
    assert!(keys.contains(&"order_execution"));
}

#[tokio::test]
async fn completing_workflow_item_closes_task_and_writes_patient_timeline_event() {
    let Some((app, pool, _admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("workflow-complete");
    let pm_id = seed_user(&pool, &tag, "patient_manager").await;
    let pm_bearer = auth_header_for(pm_id, "patient_manager");
    let patient_id = create_patient(&app, &pm_bearer, &tag).await;

    let (status, checklist_body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/patients/{patient_id}/workflow-checklist"),
        &pm_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let item = checklist_body["items"].as_array().unwrap()[0].clone();
    let item_id = item["id"].as_str().unwrap();
    let task_id = item["linked_task_id"].as_str().unwrap();

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/patients/{patient_id}/workflow-checklist/{item_id}/complete"),
        &pm_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (status, task_body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/tasks/{task_id}"),
        &pm_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(task_body["status"], "completed");

    let (status, timeline_body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/patients/{patient_id}/timeline"),
        &pm_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(
        timeline_body["items"]
            .as_array()
            .unwrap()
            .iter()
            .any(|item| item["category"] == "workflow"
                && item["title"] == "Workflow checklist item completed")
    );
}

#[tokio::test]
async fn completing_linked_task_updates_workflow_item_state() {
    let Some((app, pool, _admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("workflow-task-sync");
    let pm_id = seed_user(&pool, &tag, "patient_manager").await;
    let pm_bearer = auth_header_for(pm_id, "patient_manager");
    let patient_id = create_patient(&app, &pm_bearer, &tag).await;

    let (status, checklist_body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/patients/{patient_id}/workflow-checklist"),
        &pm_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let item = checklist_body["items"].as_array().unwrap()[0].clone();
    let task_id = item["linked_task_id"].as_str().unwrap();
    let item_id = item["id"].as_str().unwrap().to_string();

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/tasks/{task_id}/status"),
        &pm_bearer,
        Some(json!({ "status": "completed" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (status, refreshed_body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/patients/{patient_id}/workflow-checklist"),
        &pm_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let refreshed_item = refreshed_body["items"]
        .as_array()
        .unwrap()
        .iter()
        .find(|item| item["id"].as_str() == Some(item_id.as_str()))
        .unwrap();
    assert_eq!(refreshed_item["is_completed"], true);
}
