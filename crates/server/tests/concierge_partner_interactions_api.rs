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
    .bind(format!("Partner User {tag}"))
    .bind(role)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn seed_patient(pool: &PgPool, created_by: Uuid, tag: &str) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO patients (
               patient_id, first_name, last_name, birth_date, gender, created_by
           ) VALUES ($1, 'Partner', 'Workflow', '1990-01-01', 'diverse', $2)
           RETURNING id"#,
    )
    .bind(format!("PARTNER-{tag}"))
    .bind(created_by)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn seed_provider(pool: &PgPool, provider_type: &str, tag: &str) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO providers (
               name, provider_type, address_street, address_city, address_country, phone, email
           ) VALUES ($1, $2, 'Testweg 8', 'München', 'Deutschland', '+49 89 123', $3)
           RETURNING id"#,
    )
    .bind(format!("Partner {tag}"))
    .bind(provider_type)
    .bind(format!("booking-{tag}@example.test"))
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn seed_concierge_service(
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
async fn assigned_concierge_records_non_medical_partner_booking_history() {
    let Some(ctx) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let tag = Uuid::new_v4().simple().to_string();
    let concierge_id = seed_user(&ctx.pool, "concierge", &format!("owner-{tag}")).await;
    let other_id = seed_user(&ctx.pool, "concierge", &format!("other-{tag}")).await;
    let patient_id = seed_patient(&ctx.pool, ctx.admin_id, &tag).await;
    let provider_id = seed_provider(&ctx.pool, "non_medical", &tag).await;
    let service_id = seed_concierge_service(
        &ctx.pool,
        patient_id,
        provider_id,
        concierge_id,
        ctx.admin_id,
        "Restaurant reservation",
    )
    .await;
    let concierge_bearer = auth_header_for(concierge_id, "concierge");
    let other_bearer = auth_header_for(other_id, "concierge");
    let path = format!("/api/v1/concierge-services/{service_id}/partner-interactions");
    let first_request_id = Uuid::new_v4();

    let (status, first) = json_request(
        &ctx.app,
        "POST",
        &path,
        &concierge_bearer,
        Some(json!({
            "request_id": first_request_id,
            "channel": "phone",
            "direction": "outbound",
            "outcome": "quote_received",
            "contact_person": "Anna Booking",
            "note": "Table and transfer option held until 18:00",
            "quoted_cost": 85.5,
            "quoted_currency": "eur"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{first}");
    assert_eq!(first["provider_id"], provider_id.to_string());
    assert_eq!(first["outcome"], "quote_received");
    assert_eq!(first["quoted_cost"], "85.50");
    assert_eq!(first["quoted_currency"], "EUR");
    assert_eq!(first["recorded_by"], concierge_id.to_string());

    let (status, replayed) = json_request(
        &ctx.app,
        "POST",
        &path,
        &concierge_bearer,
        Some(json!({
            "request_id": first_request_id,
            "channel": "phone",
            "direction": "outbound",
            "outcome": "quote_received",
            "contact_person": "Anna Booking",
            "note": "Table and transfer option held until 18:00",
            "quoted_cost": 85.5,
            "quoted_currency": "eur"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{replayed}");
    assert_eq!(replayed["id"], first["id"]);

    let first_id = Uuid::parse_str(first["id"].as_str().expect("interaction id")).unwrap();
    let apply_path = format!(
        "/api/v1/concierge-services/{service_id}/partner-interactions/{first_id}/apply-cost-estimate"
    );
    let (status, applied) =
        json_request(&ctx.app, "POST", &apply_path, &concierge_bearer, None).await;
    assert_eq!(status, StatusCode::OK, "{applied}");
    assert_eq!(applied["interaction_id"], first_id.to_string());
    assert_eq!(applied["cost_estimate"], "85.50");
    assert_eq!(applied["currency"], "EUR");
    assert_eq!(applied["applied_by"], concierge_id.to_string());

    let cost_estimate: rust_decimal::Decimal =
        sqlx::query_scalar("SELECT cost_estimate FROM concierge_services WHERE id = $1")
            .bind(service_id)
            .fetch_one(&ctx.pool)
            .await
            .unwrap();
    assert_eq!(cost_estimate.to_string(), "85.50");

    let (status, duplicate) =
        json_request(&ctx.app, "POST", &apply_path, &concierge_bearer, None).await;
    assert_eq!(status, StatusCode::CONFLICT, "{duplicate}");

    let (status, forbidden_apply) =
        json_request(&ctx.app, "POST", &apply_path, &other_bearer, None).await;
    assert_eq!(status, StatusCode::FORBIDDEN, "{forbidden_apply}");

    let (status, second) = json_request(
        &ctx.app,
        "POST",
        &path,
        &concierge_bearer,
        Some(json!({
            "channel": "email",
            "direction": "inbound",
            "outcome": "reached",
            "contact_person": "Anna Booking"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{second}");

    let (status, history) = json_request(&ctx.app, "GET", &path, &concierge_bearer, None).await;
    assert_eq!(status, StatusCode::OK, "{history}");
    let rows = history.as_array().expect("interaction history");
    assert_eq!(rows.len(), 2);
    assert_eq!(rows[0]["outcome"], "quote_received");
    assert_eq!(rows[0]["applied_by"], concierge_id.to_string());
    assert!(rows[0]["applied_as_cost_estimate_at"].is_string());
    assert_eq!(rows[1]["outcome"], "reached");

    let (status, forbidden) = json_request(&ctx.app, "GET", &path, &other_bearer, None).await;
    assert_eq!(status, StatusCode::FORBIDDEN, "{forbidden}");

    let count: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM concierge_service_partner_interactions WHERE concierge_service_id = $1",
    )
    .bind(service_id)
    .fetch_one(&ctx.pool)
    .await
    .unwrap();
    assert_eq!(count, 2);
}

#[tokio::test]
async fn concierge_partner_workflow_rejects_and_redacts_medical_provider() {
    let Some(ctx) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let tag = Uuid::new_v4().simple().to_string();
    let concierge_id = seed_user(&ctx.pool, "concierge", &format!("medical-{tag}")).await;
    let patient_id = seed_patient(&ctx.pool, ctx.admin_id, &format!("medical-{tag}")).await;
    let provider_id = seed_provider(&ctx.pool, "medical", &format!("secret-{tag}")).await;
    let service_id = seed_concierge_service(
        &ctx.pool,
        patient_id,
        provider_id,
        concierge_id,
        ctx.admin_id,
        "Sensitive clinic coordination",
    )
    .await;
    let bearer = auth_header_for(concierge_id, "concierge");

    let (status, service) = json_request(
        &ctx.app,
        "GET",
        &format!("/api/v1/concierge-services/{service_id}"),
        &bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{service}");
    assert_eq!(service["title"], "Service request");
    assert!(service["provider_id"].is_null());
    assert!(service["provider_name"].is_null());

    let (status, rejected) = json_request(
        &ctx.app,
        "GET",
        &format!("/api/v1/concierge-services/{service_id}/partner-interactions"),
        &bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{rejected}");
    assert_eq!(
        rejected["message"],
        "Service has no linked non-medical partner"
    );
    assert!(
        !rejected
            .to_string()
            .contains(&format!("Partner secret-{tag}"))
    );
}
