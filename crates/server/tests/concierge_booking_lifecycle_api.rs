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
    .bind(format!("booking-{tag}@example.test"))
    .bind(format!("Booking User {tag}"))
    .bind(role)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn seed_patient(pool: &PgPool, created_by: Uuid, tag: &str) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO patients (
               patient_id, first_name, last_name, birth_date, gender, created_by
           ) VALUES ($1, 'Booking', 'Workflow', '1990-01-01', 'diverse', $2)
           RETURNING id"#,
    )
    .bind(format!("BOOKING-{tag}"))
    .bind(created_by)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn seed_provider(pool: &PgPool, provider_type: &str, tag: &str) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO providers (
               name, provider_type, address_street, address_city, address_country, phone, email
           ) VALUES ($1, $2, 'Airport Terminal 1', 'München', 'Deutschland', '+49 89 555', $3)
           RETURNING id"#,
    )
    .bind(format!("Booking Partner {tag}"))
    .bind(provider_type)
    .bind(format!("reservation-{tag}@example.test"))
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn seed_service(
    pool: &PgPool,
    patient_id: Uuid,
    concierge_id: Uuid,
    created_by: Uuid,
    tag: &str,
) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO concierge_services (
               patient_id, assigned_concierge_id, service_kind, title, status, created_by
           ) VALUES ($1, $2, 'transfer', $3, 'planned', $4)
           RETURNING id"#,
    )
    .bind(patient_id)
    .bind(concierge_id)
    .bind(format!("Airport pickup {tag}"))
    .bind(created_by)
    .fetch_one(pool)
    .await
    .unwrap()
}

fn booking_body(request_id: Uuid, provider_id: Uuid, booking_state: &str) -> Value {
    json!({
        "request_id": request_id,
        "provider_id": provider_id,
        "booking_state": booking_state,
        "channel": "phone",
        "contact_person": "Anna Dispatch",
        "vendor_contact": "+49 89 555",
        "booking_reference": if booking_state == "confirmed" { Some("CAR-2026-0819") } else { None },
        "starts_at": "2026-08-21T10:00:00Z",
        "ends_at": "2026-08-21T11:00:00Z",
        "service_address": "Terminal 1, Munich Airport",
        "note": "Meet at arrivals"
    })
}

#[tokio::test]
async fn assigned_concierge_books_non_medical_partner_with_retry_safe_history() {
    let Some(ctx) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let tag = Uuid::new_v4().simple().to_string();
    let concierge_id = seed_user(&ctx.pool, "concierge", &format!("owner-{tag}")).await;
    let other_id = seed_user(&ctx.pool, "concierge", &format!("other-{tag}")).await;
    let manager_id = seed_user(&ctx.pool, "patient_manager", &format!("manager-{tag}")).await;
    let patient_id = seed_patient(&ctx.pool, ctx.admin_id, &tag).await;
    let provider_id = seed_provider(&ctx.pool, "non_medical", &tag).await;
    let service_id = seed_service(&ctx.pool, patient_id, concierge_id, ctx.admin_id, &tag).await;
    let path = format!("/api/v1/concierge-services/{service_id}/book-provider");
    let bearer = auth_header_for(concierge_id, "concierge");
    let request_id = Uuid::new_v4();
    let requested_body = booking_body(request_id, provider_id, "requested");

    let (status, requested) = json_request(
        &ctx.app,
        "POST",
        &path,
        &bearer,
        Some(requested_body.clone()),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{requested}");
    assert_eq!(requested["service"]["status"], "booked");
    assert_eq!(requested["service"]["provider_id"], provider_id.to_string());
    assert_eq!(
        requested["service"]["service_address"],
        "Terminal 1, Munich Airport"
    );
    let first_interaction = requested["interaction_id"].clone();

    let (status, retry) =
        json_request(&ctx.app, "POST", &path, &bearer, Some(requested_body)).await;
    assert_eq!(status, StatusCode::OK, "{retry}");
    assert_eq!(retry["interaction_id"], first_interaction);

    let count: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM concierge_service_partner_interactions WHERE concierge_service_id = $1",
    )
    .bind(service_id)
    .fetch_one(&ctx.pool)
    .await
    .unwrap();
    assert_eq!(count, 1);

    let (status, duplicate_operation) = json_request(
        &ctx.app,
        "POST",
        &path,
        &bearer,
        Some(booking_body(Uuid::new_v4(), provider_id, "requested")),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{duplicate_operation}");

    let (status, forbidden) = json_request(
        &ctx.app,
        "POST",
        &path,
        &auth_header_for(other_id, "concierge"),
        Some(booking_body(Uuid::new_v4(), provider_id, "confirmed")),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN, "{forbidden}");

    let (status, manager_forbidden) = json_request(
        &ctx.app,
        "POST",
        &path,
        &auth_header_for(manager_id, "patient_manager"),
        Some(booking_body(Uuid::new_v4(), provider_id, "confirmed")),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN, "{manager_forbidden}");

    let (status, generic_manager_forbidden) = json_request(
        &ctx.app,
        "POST",
        &format!("/api/v1/concierge-services/{service_id}/partner-interactions"),
        &auth_header_for(manager_id, "patient_manager"),
        Some(json!({
            "channel": "phone",
            "direction": "outbound",
            "outcome": "booking_confirmed",
            "contact_person": "Bypass attempt"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN, "{generic_manager_forbidden}");

    let (status, generic_bypass) = json_request(
        &ctx.app,
        "POST",
        &format!("/api/v1/concierge-services/{service_id}/update"),
        &bearer,
        Some(json!({ "status": "confirmed" })),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{generic_bypass}");

    let (status, confirmed) = json_request(
        &ctx.app,
        "POST",
        &path,
        &bearer,
        Some(booking_body(Uuid::new_v4(), provider_id, "confirmed")),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{confirmed}");
    assert_eq!(confirmed["service"]["status"], "confirmed");
    assert_eq!(confirmed["service"]["booking_reference"], "CAR-2026-0819");

    let outcomes: Vec<String> = sqlx::query_scalar(
        r#"SELECT outcome
           FROM concierge_service_partner_interactions
           WHERE concierge_service_id = $1
           ORDER BY occurred_at, created_at"#,
    )
    .bind(service_id)
    .fetch_all(&ctx.pool)
    .await
    .unwrap();
    assert_eq!(outcomes, vec!["booking_requested", "booking_confirmed"]);

    let cancelled_service_id = seed_service(
        &ctx.pool,
        patient_id,
        concierge_id,
        ctx.admin_id,
        "cancelled",
    )
    .await;
    sqlx::query("UPDATE concierge_services SET status = 'cancelled' WHERE id = $1")
        .bind(cancelled_service_id)
        .execute(&ctx.pool)
        .await
        .unwrap();
    let (status, cancelled_bypass) = json_request(
        &ctx.app,
        "POST",
        &format!("/api/v1/concierge-services/{cancelled_service_id}/partner-interactions"),
        &bearer,
        Some(json!({
            "channel": "phone",
            "direction": "outbound",
            "outcome": "booking_confirmed",
            "contact_person": "Late confirmation"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{cancelled_bypass}");
    let cancelled_state: (String, i64) = sqlx::query_as(
        r#"SELECT cs.status,
                  (SELECT count(*) FROM concierge_service_partner_interactions pi
                   WHERE pi.concierge_service_id = cs.id)
           FROM concierge_services cs
           WHERE cs.id = $1"#,
    )
    .bind(cancelled_service_id)
    .fetch_one(&ctx.pool)
    .await
    .unwrap();
    assert_eq!(cancelled_state, ("cancelled".to_string(), 0));
}

#[tokio::test]
async fn concierge_booking_rejects_medical_provider_and_unknown_clinical_payload() {
    let Some(ctx) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let tag = Uuid::new_v4().simple().to_string();
    let concierge_id = seed_user(&ctx.pool, "concierge", &format!("privacy-{tag}")).await;
    let patient_id = seed_patient(&ctx.pool, ctx.admin_id, &format!("privacy-{tag}")).await;
    let medical_provider_id = seed_provider(&ctx.pool, "medical", &format!("medical-{tag}")).await;
    let service_id = seed_service(&ctx.pool, patient_id, concierge_id, ctx.admin_id, &tag).await;
    let path = format!("/api/v1/concierge-services/{service_id}/book-provider");
    let bearer = auth_header_for(concierge_id, "concierge");

    let (status, medical) = json_request(
        &ctx.app,
        "POST",
        &path,
        &bearer,
        Some(booking_body(
            Uuid::new_v4(),
            medical_provider_id,
            "requested",
        )),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{medical}");

    let mut clinical_payload = booking_body(Uuid::new_v4(), medical_provider_id, "requested");
    clinical_payload["diagnosis"] = json!("must never be accepted here");
    let (status, unknown) =
        json_request(&ctx.app, "POST", &path, &bearer, Some(clinical_payload)).await;
    assert!(
        matches!(
            status,
            StatusCode::BAD_REQUEST | StatusCode::UNPROCESSABLE_ENTITY
        ),
        "{unknown}"
    );
}
