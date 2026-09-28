//! Owner decision 2026-09-28 (Q11): inactive or archived providers and
//! blocked, terminated or AVV-less interpreters take no new work; existing
//! records keep them; deleting a provider archives it. Synthetic data only.

mod support;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use serde_json::{Value, json};
use sqlx::PgPool;
use tower::ServiceExt;
use std::sync::atomic::{AtomicU32, Ordering};

use uuid::Uuid;

/// Every appointment gets its own day, so no slot conflicts arise.
static NEXT_DAY: AtomicU32 = AtomicU32::new(0);

use gmed_server::auth::jwt;

const TEST_SECRET: &str = "test-secret-at-least-32-characters-long!!";

fn bearer(user_id: Uuid, role: &str) -> String {
    let token = jwt::issue_access_token(TEST_SECRET, user_id, role, Uuid::new_v4()).unwrap();
    format!("Bearer {token}")
}

async fn json_request(
    app: &axum::Router,
    method: &str,
    path: &str,
    auth: &str,
    body: Option<Value>,
) -> (StatusCode, Value) {
    let request = Request::builder()
        .method(method)
        .uri(path)
        .header("Authorization", auth)
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
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(json!(null)),
    )
}

fn tag() -> String {
    Uuid::new_v4().simple().to_string()
}

async fn seed_user(pool: &PgPool, role: &str) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO users (email, password_hash, name, role)
           VALUES ($1, 'test-password-hash', $2, $3) RETURNING id"#,
    )
    .bind(format!("elig-{}@example.com", tag()))
    .bind(format!("Eligibility {role} {}", tag()))
    .bind(role)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn seed_patient(pool: &PgPool, created_by: Uuid) -> Uuid {
    let tag = tag();
    sqlx::query_scalar(
        r#"INSERT INTO patients (patient_id, first_name, last_name, birth_date, gender, created_by)
           VALUES ($1, 'First', 'Last', '1990-01-01', 'diverse', $2) RETURNING id"#,
    )
    .bind(format!("PT-{tag}"))
    .bind(created_by)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn seed_provider(pool: &PgPool) -> (Uuid, Uuid) {
    let tag = tag();
    let provider_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO providers (name, provider_type, address_city, fachbereich, address_country)
           VALUES ($1, 'medical', 'Berlin', 'Cardiology', 'Germany') RETURNING id"#,
    )
    .bind(format!("Clinic {tag}"))
    .fetch_one(pool)
    .await
    .unwrap();
    let doctor_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO provider_doctors (provider_id, name, fachbereich)
           VALUES ($1, $2, 'Cardiology') RETURNING id"#,
    )
    .bind(provider_id)
    .bind(format!("Dr {tag}"))
    .fetch_one(pool)
    .await
    .unwrap();
    (provider_id, doctor_id)
}

fn appointment_body(
    patient_id: Uuid,
    provider_id: Uuid,
    doctor_id: Uuid,
    interpreter_id: Option<Uuid>,
) -> Value {
    json!({
        "patient_id": patient_id,
        "provider_id": provider_id,
        "doctor_id": doctor_id,
        "interpreter_id": interpreter_id,
        "appointment_type": "medical",
        "title": format!("Visit {}", tag()),
        "date": (chrono::NaiveDate::from_ymd_opt(2026, 11, 1).unwrap()
            + chrono::Duration::days(i64::from(NEXT_DAY.fetch_add(1, Ordering::SeqCst))))
        .to_string(),
        "time_start": "08:30",
        "time_end": "09:15",
        "location": "Clinic reception"
    })
}

#[tokio::test]
async fn inactive_or_archived_providers_take_no_new_appointments() {
    let Some(ctx) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let ceo = bearer(ctx.admin_id, "ceo");
    let patient_id = seed_patient(&ctx.pool, ctx.admin_id).await;
    let (provider_id, doctor_id) = seed_provider(&ctx.pool).await;

    let (status, existing) = json_request(
        &ctx.app,
        "POST",
        "/api/v1/appointments",
        &ceo,
        Some(appointment_body(patient_id, provider_id, doctor_id, None)),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{existing}");
    let existing_id = existing["id"].as_str().unwrap().to_string();

    // Deleting archives: the provider stays on its appointment.
    let (status, body) = json_request(
        &ctx.app,
        "POST",
        &format!("/api/v1/providers/{provider_id}/delete"),
        &ceo,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT, "{body}");
    let (is_active, archived): (bool, bool) =
        sqlx::query_as("SELECT is_active, archived_at IS NOT NULL FROM providers WHERE id = $1")
            .bind(provider_id)
            .fetch_one(&ctx.pool)
            .await
            .unwrap();
    assert!(!is_active && archived);
    let (status, body) = json_request(
        &ctx.app,
        "GET",
        &format!("/api/v1/appointments/{existing_id}"),
        &ceo,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["provider_id"], provider_id.to_string());

    // Hidden from the registry, visible under the explicit inactive filter.
    let listed = |body: &Value| {
        body.as_array()
            .map(|items| {
                items
                    .iter()
                    .any(|item| item["id"] == provider_id.to_string())
            })
            .unwrap_or(false)
    };
    let (status, body) = json_request(
        &ctx.app,
        "GET",
        "/api/v1/providers?active_only=false",
        &ceo,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(!listed(&body));
    let (status, body) = json_request(
        &ctx.app,
        "GET",
        "/api/v1/providers?is_active=false",
        &ceo,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(listed(&body));

    // No new appointment with it.
    let (status, body) = json_request(
        &ctx.app,
        "POST",
        "/api/v1/appointments",
        &ceo,
        Some(appointment_body(patient_id, provider_id, doctor_id, None)),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");

    // Activating restores it from the archive.
    let (status, _) = json_request(
        &ctx.app,
        "POST",
        &format!("/api/v1/providers/{provider_id}/activate"),
        &ceo,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    let (status, body) = json_request(
        &ctx.app,
        "POST",
        "/api/v1/appointments",
        &ceo,
        Some(appointment_body(patient_id, provider_id, doctor_id, None)),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
}

async fn seed_interpreter(
    pool: &PgPool,
    status: &str,
    employment_kind: &str,
    avv: Option<&str>,
) -> Uuid {
    let user_id = seed_user(pool, "interpreter").await;
    sqlx::query(
        "INSERT INTO interpreter_profile_details (user_id, status, employment_kind) VALUES ($1, $2, $3)",
    )
    .bind(user_id)
    .bind(status)
    .bind(employment_kind)
    .execute(pool)
    .await
    .unwrap();
    if let Some(avv) = avv {
        sqlx::query(
            "INSERT INTO interpreter_compliance_profiles (user_id, avv_status) VALUES ($1, $2)",
        )
        .bind(user_id)
        .bind(avv)
        .execute(pool)
        .await
        .unwrap();
    }
    user_id
}

#[tokio::test]
async fn blocked_terminated_or_avv_less_interpreters_are_not_assignable() {
    let Some(ctx) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let ceo = bearer(ctx.admin_id, "ceo");
    let patient_id = seed_patient(&ctx.pool, ctx.admin_id).await;
    let (provider_id, doctor_id) = seed_provider(&ctx.pool).await;

    let active = seed_interpreter(&ctx.pool, "active", "internal", None).await;
    let external_signed = seed_interpreter(&ctx.pool, "active", "external", Some("signed")).await;
    let blocked = seed_interpreter(&ctx.pool, "blocked", "internal", None).await;
    let terminated = seed_interpreter(&ctx.pool, "terminated", "internal", None).await;
    let external_pending = seed_interpreter(&ctx.pool, "active", "external", Some("pending")).await;

    for (interpreter, expected) in [
        (active, StatusCode::CREATED),
        (external_signed, StatusCode::CREATED),
        (blocked, StatusCode::UNPROCESSABLE_ENTITY),
        (terminated, StatusCode::UNPROCESSABLE_ENTITY),
        (external_pending, StatusCode::UNPROCESSABLE_ENTITY),
    ] {
        let (status, body) = json_request(
            &ctx.app,
            "POST",
            "/api/v1/appointments",
            &ceo,
            Some(appointment_body(
                patient_id,
                provider_id,
                doctor_id,
                Some(interpreter),
            )),
        )
        .await;
        assert_eq!(status, expected, "{interpreter}: {body}");
    }

    let (status, body) = json_request(
        &ctx.app,
        "GET",
        "/api/v1/appointments/meta/interpreters",
        &ceo,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let assignable = |id: Uuid| {
        body.as_array()
            .unwrap()
            .iter()
            .find(|item| item["id"] == id.to_string())
            .map(|item| item["assignable"].clone())
    };
    assert_eq!(assignable(active), Some(json!(true)));
    assert_eq!(assignable(external_signed), Some(json!(true)));
    assert_eq!(assignable(blocked), Some(json!(false)));
    assert_eq!(assignable(terminated), Some(json!(false)));
    assert_eq!(assignable(external_pending), Some(json!(false)));

    // A blocked interpreter is not given a new patient either.
    let (status, body) = json_request(
        &ctx.app,
        "POST",
        &format!("/api/v1/patients/{patient_id}/assign"),
        &ceo,
        Some(json!({ "user_id": blocked })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
}
