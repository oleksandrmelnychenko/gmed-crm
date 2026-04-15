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

#[tokio::test]
async fn patient_manager_sop_requires_ceo_approval_and_supports_acknowledgement() {
    let Some((app, pool, _admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("sop-flow");
    let ceo_id = seed_user(&pool, &format!("{tag}-ceo"), "ceo").await;
    let pm_id = seed_user(&pool, &format!("{tag}-pm"), "patient_manager").await;
    let interpreter_id = seed_user(&pool, &format!("{tag}-interp"), "interpreter").await;
    let concierge_id = seed_user(&pool, &format!("{tag}-concierge"), "concierge").await;
    let billing_id = seed_user(&pool, &format!("{tag}-billing"), "billing").await;

    let create_body = json!({
        "title": format!("Interpreter SOP {tag}"),
        "category": "sop",
        "summary": "Interpreter handoff and glossary workflow",
        "body_markdown": "1. Review case brief\n2. Confirm glossary\n3. Upload report",
        "target_roles": ["interpreter"],
        "target_user_ids": [concierge_id],
        "requires_ack": false
    });

    let (create_status, create_payload) = json_request(
        &app,
        "POST",
        "/api/v1/sops",
        &auth_header_for(pm_id, "patient_manager"),
        Some(create_body),
    )
    .await;
    assert_eq!(create_status, StatusCode::OK);
    assert_eq!(create_payload["status"], "pending_approval");
    assert_eq!(create_payload["ok"], true);
    let sop_id = create_payload["id"].as_str().unwrap().to_string();

    let (pm_list_status, pm_list) = json_request(
        &app,
        "GET",
        "/api/v1/sops",
        &auth_header_for(pm_id, "patient_manager"),
        None,
    )
    .await;
    assert_eq!(pm_list_status, StatusCode::OK);
    assert!(
        pm_list
            .as_array()
            .unwrap()
            .iter()
            .any(|row| row["id"] == sop_id && row["can_edit"] == true)
    );

    let (interpreter_before_status, interpreter_before) = json_request(
        &app,
        "GET",
        "/api/v1/sops",
        &auth_header_for(interpreter_id, "interpreter"),
        None,
    )
    .await;
    assert_eq!(interpreter_before_status, StatusCode::OK);
    assert!(
        interpreter_before
            .as_array()
            .unwrap()
            .iter()
            .all(|row| row["id"] != sop_id)
    );

    let (review_status, review_queue) = json_request(
        &app,
        "GET",
        "/api/v1/sops/review-queue",
        &auth_header_for(ceo_id, "ceo"),
        None,
    )
    .await;
    assert_eq!(review_status, StatusCode::OK);
    assert!(review_queue.as_array().unwrap().iter().any(|row| {
        row["id"] == sop_id
            && row["created_by_role"] == "patient_manager"
            && row["approval_required_role"] == "ceo"
    }));

    let (approve_status, approve_payload) = json_request(
        &app,
        "POST",
        &format!("/api/v1/sops/{sop_id}/review"),
        &auth_header_for(ceo_id, "ceo"),
        Some(json!({ "decision": "approve", "note": "Looks good" })),
    )
    .await;
    assert_eq!(approve_status, StatusCode::OK);
    assert_eq!(approve_payload["status"], "approved");

    let (interpreter_after_status, interpreter_after) = json_request(
        &app,
        "GET",
        "/api/v1/sops",
        &auth_header_for(interpreter_id, "interpreter"),
        None,
    )
    .await;
    assert_eq!(interpreter_after_status, StatusCode::OK);
    assert!(
        interpreter_after
            .as_array()
            .unwrap()
            .iter()
            .any(|row| row["id"] == sop_id && row["status"] == "approved")
    );

    let (_, concierge_list) = json_request(
        &app,
        "GET",
        "/api/v1/sops",
        &auth_header_for(concierge_id, "concierge"),
        None,
    )
    .await;
    assert!(
        concierge_list
            .as_array()
            .unwrap()
            .iter()
            .any(|row| row["id"] == sop_id)
    );

    let (_, billing_list) = json_request(
        &app,
        "GET",
        "/api/v1/sops",
        &auth_header_for(billing_id, "billing"),
        None,
    )
    .await;
    assert!(
        billing_list
            .as_array()
            .unwrap()
            .iter()
            .all(|row| row["id"] != sop_id)
    );

    let (ack_request_status, ack_request_payload) = json_request(
        &app,
        "POST",
        &format!("/api/v1/sops/{sop_id}/request-acknowledgement"),
        &auth_header_for(ceo_id, "ceo"),
        None,
    )
    .await;
    assert_eq!(ack_request_status, StatusCode::OK);
    assert!(
        ack_request_payload["recipient_count"]
            .as_i64()
            .unwrap_or_default()
            >= 2
    );

    let (_, interpreter_pending_ack) = json_request(
        &app,
        "GET",
        "/api/v1/sops",
        &auth_header_for(interpreter_id, "interpreter"),
        None,
    )
    .await;
    let interpreter_row = interpreter_pending_ack
        .as_array()
        .unwrap()
        .iter()
        .find(|row| row["id"] == sop_id)
        .unwrap();
    assert_eq!(interpreter_row["my_ack_status"], "pending");
    assert_eq!(interpreter_row["can_acknowledge"], true);

    let (_, concierge_pending_ack) = json_request(
        &app,
        "GET",
        "/api/v1/sops",
        &auth_header_for(concierge_id, "concierge"),
        None,
    )
    .await;
    let concierge_row = concierge_pending_ack
        .as_array()
        .unwrap()
        .iter()
        .find(|row| row["id"] == sop_id)
        .unwrap();
    assert_eq!(concierge_row["my_ack_status"], "pending");
    assert_eq!(concierge_row["can_acknowledge"], true);

    let (ack_status, ack_payload) = json_request(
        &app,
        "POST",
        &format!("/api/v1/sops/{sop_id}/acknowledge"),
        &auth_header_for(interpreter_id, "interpreter"),
        None,
    )
    .await;
    assert_eq!(ack_status, StatusCode::OK);
    assert_eq!(ack_payload["id"], sop_id);

    let (_, interpreter_acknowledged) = json_request(
        &app,
        "GET",
        "/api/v1/sops",
        &auth_header_for(interpreter_id, "interpreter"),
        None,
    )
    .await;
    let acknowledged_row = interpreter_acknowledged
        .as_array()
        .unwrap()
        .iter()
        .find(|row| row["id"] == sop_id)
        .unwrap();
    assert_eq!(acknowledged_row["my_ack_status"], "acknowledged");
}

#[tokio::test]
async fn patient_manager_cannot_target_non_team_roles_in_sop_scope() {
    let Some((app, pool, _admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("sop-scope");
    let pm_id = seed_user(&pool, &format!("{tag}-pm"), "patient_manager").await;
    let billing_id = seed_user(&pool, &format!("{tag}-billing"), "billing").await;

    let (status, payload) = json_request(
        &app,
        "POST",
        "/api/v1/sops",
        &auth_header_for(pm_id, "patient_manager"),
        Some(json!({
            "title": "Finance SOP",
            "category": "training",
            "summary": "Should not be allowed",
            "body_markdown": "Billing flow",
            "target_roles": ["billing"],
            "target_user_ids": [billing_id],
            "requires_ack": true
        })),
    )
    .await;

    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert!(
        payload["message"]
            .as_str()
            .unwrap_or_default()
            .contains("not allowed")
            || payload["message"]
                .as_str()
                .unwrap_or_default()
                .contains("team members")
    );
}

#[tokio::test]
async fn teamlead_interpreter_sop_requires_patient_manager_approval_before_publication() {
    let Some((app, pool, _admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("sop-teamlead");
    let ceo_id = seed_user(&pool, &format!("{tag}-ceo"), "ceo").await;
    let pm_id = seed_user(&pool, &format!("{tag}-pm"), "patient_manager").await;
    let teamlead_id = seed_user(&pool, &format!("{tag}-tl"), "teamlead_interpreter").await;
    let interpreter_id = seed_user(&pool, &format!("{tag}-interp"), "interpreter").await;

    let (create_status, create_payload) = json_request(
        &app,
        "POST",
        "/api/v1/sops",
        &auth_header_for(teamlead_id, "teamlead_interpreter"),
        Some(json!({
            "title": format!("Interpreter onboarding {tag}"),
            "category": "training",
            "summary": "Interpreter-only SOP",
            "body_markdown": "1. Review glossary\n2. Confirm transport note",
            "target_roles": ["interpreter"],
            "requires_ack": true
        })),
    )
    .await;
    assert_eq!(create_status, StatusCode::OK);
    assert_eq!(create_payload["status"], "pending_approval");
    let sop_id = create_payload["id"].as_str().unwrap().to_string();

    let (ceo_queue_status, ceo_queue) = json_request(
        &app,
        "GET",
        "/api/v1/sops/review-queue",
        &auth_header_for(ceo_id, "ceo"),
        None,
    )
    .await;
    assert_eq!(ceo_queue_status, StatusCode::OK);
    assert!(
        ceo_queue
            .as_array()
            .unwrap()
            .iter()
            .all(|row| row["id"] != sop_id)
    );

    let (pm_queue_status, pm_queue) = json_request(
        &app,
        "GET",
        "/api/v1/sops/review-queue",
        &auth_header_for(pm_id, "patient_manager"),
        None,
    )
    .await;
    assert_eq!(pm_queue_status, StatusCode::OK);
    assert!(pm_queue.as_array().unwrap().iter().any(|row| {
        row["id"] == sop_id
            && row["created_by_role"] == "teamlead_interpreter"
            && row["approval_required_role"] == "patient_manager"
    }));

    let (ceo_review_status, ceo_review_payload) = json_request(
        &app,
        "POST",
        &format!("/api/v1/sops/{sop_id}/review"),
        &auth_header_for(ceo_id, "ceo"),
        Some(json!({ "decision": "approve", "note": "Bypass attempt" })),
    )
    .await;
    assert_eq!(ceo_review_status, StatusCode::FORBIDDEN);
    assert!(
        ceo_review_payload["message"]
            .as_str()
            .unwrap_or_default()
            .contains("Insufficient permissions")
    );

    let (interpreter_before_status, interpreter_before) = json_request(
        &app,
        "GET",
        "/api/v1/sops",
        &auth_header_for(interpreter_id, "interpreter"),
        None,
    )
    .await;
    assert_eq!(interpreter_before_status, StatusCode::OK);
    assert!(
        interpreter_before
            .as_array()
            .unwrap()
            .iter()
            .all(|row| row["id"] != sop_id)
    );

    let (approve_status, approve_payload) = json_request(
        &app,
        "POST",
        &format!("/api/v1/sops/{sop_id}/review"),
        &auth_header_for(pm_id, "patient_manager"),
        Some(json!({ "decision": "approve", "note": "Approved for interpreter team" })),
    )
    .await;
    assert_eq!(approve_status, StatusCode::OK);
    assert_eq!(approve_payload["status"], "approved");

    let (ack_status, ack_payload) = json_request(
        &app,
        "POST",
        &format!("/api/v1/sops/{sop_id}/request-acknowledgement"),
        &auth_header_for(pm_id, "patient_manager"),
        None,
    )
    .await;
    assert_eq!(ack_status, StatusCode::OK);
    assert!(ack_payload["recipient_count"].as_i64().unwrap_or_default() >= 1);

    let (interpreter_after_status, interpreter_after) = json_request(
        &app,
        "GET",
        "/api/v1/sops",
        &auth_header_for(interpreter_id, "interpreter"),
        None,
    )
    .await;
    assert_eq!(interpreter_after_status, StatusCode::OK);
    let interpreter_row = interpreter_after
        .as_array()
        .unwrap()
        .iter()
        .find(|row| row["id"] == sop_id)
        .expect("expected interpreter-visible SOP");
    assert_eq!(interpreter_row["status"], "approved");
    assert_eq!(interpreter_row["my_ack_status"], "pending");
}

#[tokio::test]
async fn teamlead_interpreter_cannot_target_non_interpreter_roles_in_sop_scope() {
    let Some((app, pool, _admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("sop-teamlead-scope");
    let teamlead_id = seed_user(&pool, &format!("{tag}-tl"), "teamlead_interpreter").await;
    let concierge_id = seed_user(&pool, &format!("{tag}-concierge"), "concierge").await;

    let (status, payload) = json_request(
        &app,
        "POST",
        "/api/v1/sops",
        &auth_header_for(teamlead_id, "teamlead_interpreter"),
        Some(json!({
            "title": "Concierge SOP",
            "category": "sop",
            "summary": "Should be rejected",
            "body_markdown": "Escalate hotel bookings",
            "target_roles": ["concierge"],
            "target_user_ids": [concierge_id],
            "requires_ack": false
        })),
    )
    .await;

    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert!(
        payload["message"]
            .as_str()
            .unwrap_or_default()
            .contains("not allowed")
            || payload["message"]
                .as_str()
                .unwrap_or_default()
                .contains("team members")
    );
}
