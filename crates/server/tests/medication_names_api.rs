mod support;

use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use gmed_server::auth::jwt;
use serde_json::{Value, json};
use tower::ServiceExt;
use uuid::Uuid;

const SECRET: &str = "medication-names-test-secret-at-least-32-characters";

async fn context() -> Option<(support::TestSuiteContext, Uuid, String)> {
    let suite = support::suite_context(SECRET).await?;
    let user_id: Uuid = sqlx::query_scalar(
        "INSERT INTO users (email, password_hash, name, role)
         VALUES ($1, 'test-hash', 'Name dictionary test', 'ceo') RETURNING id",
    )
    .bind(format!("names-{}@example.com", Uuid::new_v4()))
    .fetch_one(&suite.pool)
    .await
    .unwrap();
    let patient_id: Uuid = sqlx::query_scalar(
        "INSERT INTO patients (patient_id, first_name, last_name, birth_date, gender, created_by)
         VALUES ($1, 'Name', 'Test', '1980-01-01', 'female', $2) RETURNING id",
    )
    .bind(format!("NAME-{}", Uuid::new_v4()))
    .bind(user_id)
    .fetch_one(&suite.pool)
    .await
    .unwrap();
    let token = jwt::issue_access_token(SECRET, user_id, "ceo", Uuid::new_v4()).unwrap();
    Some((suite, patient_id, format!("Bearer {token}")))
}

async fn request(
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
        .body(body.map_or(Body::empty(), |value| Body::from(value.to_string())))
        .unwrap();
    let response = app.clone().oneshot(request).await.unwrap();
    let status = response.status();
    let bytes = axum::body::to_bytes(response.into_body(), 1024 * 1024)
        .await
        .unwrap();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}

fn search(field: &str, q: &str, related: &str) -> String {
    let mut url = reqwest::Url::parse("http://test/api/v1/medication-names").unwrap();
    url.query_pairs_mut()
        .append_pair("field", field)
        .append_pair("q", q)
        .append_pair("related", related);
    format!("{}?{}", url.path(), url.query().unwrap())
}

#[tokio::test]
async fn successful_medication_save_remembers_normalized_pairs_in_both_directions() {
    let Some((suite, patient_id, bearer)) = context().await else {
        return;
    };
    let path = format!("/api/v1/patients/{patient_id}/medications");
    let (status, body) = request(
        &suite.app,
        "POST",
        &path,
        &bearer,
        Some(json!({ "items": [
        { "handelsname": "  Test  Brand ", "wirkstoff": "Test Substance" },
        { "handelsname": "test brand", "wirkstoff": " test  substance " },
        { "handelsname": "Second Brand", "wirkstoff": "Test Substance" },
        { "handelsname": "Test Brand", "wirkstoff": "Another Substance" },
        { "handelsname": "", "wirkstoff": "Unnamed Brand Substance" }
    ] })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM medication_name_pairs")
        .fetch_one(&suite.pool)
        .await
        .unwrap();
    assert_eq!(count, 4);

    let (status, body) = request(
        &suite.app,
        "GET",
        &search("handelsname", "", " TEST  SUBSTANCE "),
        &bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["items"], json!(["Second Brand", "Test Brand"]));
    assert_eq!(body["has_more"], false);
    let (_, body) = request(
        &suite.app,
        "GET",
        &search("wirkstoff", "", "test brand"),
        &bearer,
        None,
    )
    .await;
    assert_eq!(
        body["items"],
        json!(["Another Substance", "Test Substance"])
    );
    let (_, body) = request(
        &suite.app,
        "GET",
        &search("wirkstoff", "Unnamed", ""),
        &bearer,
        None,
    )
    .await;
    assert_eq!(body["items"], json!(["Unnamed Brand Substance"]));
    let (_, body) = request(
        &suite.app,
        "GET",
        &search("handelsname", "", "Unnamed Brand Substance"),
        &bearer,
        None,
    )
    .await;
    assert_eq!(body["items"], json!([]));

    // Removing a patient medication does not erase the learned vocabulary.
    assert_eq!(
        request(
            &suite.app,
            "POST",
            &path,
            &bearer,
            Some(json!({ "items": [] }))
        )
        .await
        .0,
        StatusCode::OK
    );
    let (_, body) = request(
        &suite.app,
        "GET",
        &search("handelsname", "Second", ""),
        &bearer,
        None,
    )
    .await;
    assert_eq!(body["items"], json!(["Second Brand"]));
}

#[tokio::test]
async fn failed_medication_save_rolls_back_dictionary_changes() {
    let Some((suite, patient_id, bearer)) = context().await else {
        return;
    };
    let (status, _) = request(&suite.app, "POST", &format!("/api/v1/patients/{patient_id}/medications"), &bearer, Some(json!({ "items": [
        { "handelsname": "Not Saved", "wirkstoff": "Not Saved Substance" },
        { "handelsname": "Invalid Range", "wirkstoff": "Range Substance", "einnahme_von": "2026-09-10", "einnahme_bis": "2026-09-01" }
    ] }))).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM medication_name_pairs")
        .fetch_one(&suite.pool)
        .await
        .unwrap();
    assert_eq!(count, 0);
}

#[tokio::test]
async fn medication_name_search_reports_truncation_escapes_wildcards_and_enforces_access() {
    let Some((suite, _, bearer)) = context().await else {
        return;
    };
    sqlx::query(
        "INSERT INTO medication_name_pairs (handelsname, wirkstoff)
        SELECT 'Brand ' || n, 'Common' FROM generate_series(1, 51) AS n",
    )
    .execute(&suite.pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO medication_name_pairs (handelsname, wirkstoff) VALUES ('Brand 5%', 'Percent')",
    )
    .execute(&suite.pool)
    .await
    .unwrap();
    let (_, body) = request(
        &suite.app,
        "GET",
        &search("handelsname", "", "Common"),
        &bearer,
        None,
    )
    .await;
    assert_eq!(body["items"].as_array().unwrap().len(), 50);
    assert_eq!(body["has_more"], true);
    let (_, body) = request(
        &suite.app,
        "GET",
        &search("handelsname", "%", ""),
        &bearer,
        None,
    )
    .await;
    assert_eq!(body["items"], json!(["Brand 5%"]));
    assert_eq!(
        request(&suite.app, "GET", &search("invalid", "", ""), &bearer, None)
            .await
            .0,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        request(&suite.app, "GET", &search("handelsname", "", ""), "", None)
            .await
            .0,
        StatusCode::UNAUTHORIZED
    );

    let denied_user: Uuid = sqlx::query_scalar(
        "INSERT INTO users (email, password_hash, name, role)
        VALUES ('denied-names@example.com', 'hash', 'Denied', 'billing') RETURNING id",
    )
    .fetch_one(&suite.pool)
    .await
    .unwrap();
    let token = jwt::issue_access_token(SECRET, denied_user, "billing", Uuid::new_v4()).unwrap();
    assert_eq!(
        request(
            &suite.app,
            "GET",
            &search("handelsname", "", ""),
            &format!("Bearer {token}"),
            None
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
}
