mod support;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use serde_json::{Value, json};
use sqlx::PgPool;
use tower::ServiceExt;
use uuid::Uuid;

use gmed_server::auth::jwt;

const TEST_SECRET: &str = "test-secret-at-least-32-characters-long!!";

async fn test_context() -> Option<(axum::Router, PgPool, Uuid, String)> {
    let ctx = support::suite_context(TEST_SECRET).await?;
    let bearer = auth_header_for(ctx.admin_id, "ceo");
    Some((ctx.app, ctx.pool, ctx.admin_id, bearer))
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

fn auth_header_for(user_id: Uuid, role: &str) -> String {
    let token = jwt::issue_access_token(TEST_SECRET, user_id, role, Uuid::new_v4()).unwrap();
    format!("Bearer {token}")
}

fn unique_tag(prefix: &str) -> String {
    format!("{prefix}-{}", Uuid::new_v4().simple())
}

async fn seed_patient(pool: &PgPool, created_by: Uuid, tag: &str) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO patients (
                patient_id, first_name, last_name, birth_date, gender, created_by
           ) VALUES (
                $1, $2, $3, '1990-01-01', 'diverse', $4
           ) RETURNING id"#,
    )
    .bind(format!("PT-{tag}"))
    .bind(format!("First {tag}"))
    .bind(format!("Last {tag}"))
    .bind(created_by)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn taxonomy_node_id(pool: &PgPool, code: &str) -> Uuid {
    sqlx::query_scalar("SELECT id FROM provider_taxonomy_nodes WHERE code = $1")
        .bind(code)
        .fetch_one(pool)
        .await
        .unwrap_or_else(|_| panic!("taxonomy node {code} must be seeded"))
}

#[tokio::test]
async fn concierge_services_create_and_list_with_taxonomy_node_id() {
    let Some((app, pool, admin_id, bearer)) = test_context().await else {
        return;
    };

    let tag = unique_tag("concierge-taxonomy");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let chauffeur_id = taxonomy_node_id(&pool, "nonmedical_chauffeur").await;

    let (status, created) = json_request(
        &app,
        "POST",
        "/api/v1/concierge-services",
        &bearer,
        Some(json!({
            "patient_id": patient_id,
            "service_kind": "chauffeur",
            "taxonomy_node_id": chauffeur_id,
            "title": format!("Taxonomy chauffeur {tag}"),
            "vendor_name": "Taxonomy Drives"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{created}");
    let service_id = created["id"].as_str().expect("service id");
    assert_eq!(created["taxonomy_node_id"], chauffeur_id.to_string());
    assert_eq!(created["taxonomy_node_code"], "nonmedical_chauffeur");
    assert_eq!(created["service_kind"], "chauffeur");

    let (status, listed) = json_request(
        &app,
        "GET",
        &format!("/api/v1/concierge-services?taxonomy_node_id={chauffeur_id}&search={tag}"),
        &bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{listed}");
    let items = listed.as_array().expect("concierge services list");
    let row = items
        .iter()
        .find(|item| item["id"] == service_id)
        .expect("created service must be listed by taxonomy_node_id");
    assert_eq!(row["taxonomy_node_id"], chauffeur_id.to_string());
    assert_eq!(row["taxonomy_node_code"], "nonmedical_chauffeur");
}

#[tokio::test]
async fn concierge_services_reject_medical_taxonomy_node_id() {
    let Some((app, pool, admin_id, bearer)) = test_context().await else {
        return;
    };

    let tag = unique_tag("concierge-medical-taxonomy");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let medical_id = taxonomy_node_id(&pool, "medical_pharmacies").await;

    let (status, body) = json_request(
        &app,
        "POST",
        "/api/v1/concierge-services",
        &bearer,
        Some(json!({
            "patient_id": patient_id,
            "service_kind": "transfer",
            "taxonomy_node_id": medical_id,
            "title": format!("Invalid medical taxonomy {tag}")
        })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
    assert_eq!(
        body["message"],
        "taxonomy_node_id must reference an active non-medical taxonomy leaf"
    );
}

#[tokio::test]
async fn concierge_services_legacy_service_kind_still_works_without_taxonomy() {
    let Some((app, pool, admin_id, bearer)) = test_context().await else {
        return;
    };

    let tag = unique_tag("concierge-legacy-kind");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;

    let (status, created) = json_request(
        &app,
        "POST",
        "/api/v1/concierge-services",
        &bearer,
        Some(json!({
            "patient_id": patient_id,
            "service_kind": "hotel",
            "title": format!("Legacy hotel {tag}"),
            "vendor_name": "Legacy Hotel"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{created}");
    let service_id = created["id"].as_str().expect("service id");
    assert_eq!(created["service_kind"], "hotel");
    assert!(created["taxonomy_node_id"].is_null());

    let (status, listed) = json_request(
        &app,
        "GET",
        &format!("/api/v1/concierge-services?service_kind=hotel&search={tag}"),
        &bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{listed}");
    let items = listed.as_array().expect("concierge services list");
    assert!(
        items.iter().any(|item| item["id"] == service_id
            && item["service_kind"] == "hotel"
            && item["taxonomy_node_id"].is_null()),
        "legacy service_kind-only service must still be listed"
    );
}
