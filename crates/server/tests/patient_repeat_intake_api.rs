mod support;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use serde_json::{Value, json};
use tower::ServiceExt;
use uuid::Uuid;

use gmed_server::auth::jwt;

const TEST_SECRET: &str = "test-secret-at-least-32-characters-long!!";
const RETIRED_MESSAGE: &str =
    "Repeat intake has been retired. Create a new order for the existing patient.";

fn auth_header_for(user_id: Uuid, role: &str) -> String {
    let token = jwt::issue_access_token(TEST_SECRET, user_id, role, Uuid::new_v4()).unwrap();
    format!("Bearer {token}")
}

async fn post(app: &axum::Router, path: &str, bearer: &str) -> (StatusCode, Value) {
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(path)
                .header("Authorization", bearer)
                .header("Content-Type", "application/json")
                .body(Body::from(
                    serde_json::to_vec(&json!({ "request_id": Uuid::new_v4() })).unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    let status = response.status();
    let bytes = axum::body::to_bytes(response.into_body(), 1024 * 1024)
        .await
        .unwrap();
    let payload = serde_json::from_slice(&bytes).unwrap_or(json!(null));
    (status, payload)
}

#[tokio::test]
async fn repeat_intake_is_retired_and_cannot_create_duplicate_leads() {
    let Some(ctx) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let before: i64 =
        sqlx::query_scalar("SELECT count(*) FROM leads WHERE flow = 'repeat_patient'")
            .fetch_one(&ctx.pool)
            .await
            .unwrap();

    let patient_id = Uuid::new_v4();
    let path = format!("/api/v1/patients/{patient_id}/repeat-intake");
    let bearer = auth_header_for(ctx.admin_id, "ceo");
    let (status, payload) = post(&ctx.app, &path, &bearer).await;

    assert_eq!(status, StatusCode::GONE, "{payload}");
    assert_eq!(payload["message"], RETIRED_MESSAGE);

    let after: i64 =
        sqlx::query_scalar("SELECT count(*) FROM leads WHERE flow = 'repeat_patient'")
            .fetch_one(&ctx.pool)
            .await
            .unwrap();
    assert_eq!(after, before, "retired endpoint must not create a lead");
}
