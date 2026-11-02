//! Interpreter for several appointments of an order at once (planning stage
//! 5) and the planning readiness rule "an interpreter on every open medical
//! appointment". Synthetic data only.

mod support;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use chrono::{Duration, NaiveDate};
use serde_json::{Value, json};
use sqlx::PgPool;
use tower::ServiceExt;
use uuid::Uuid;

use gmed_server::auth::jwt;

const TEST_SECRET: &str = "test-secret-at-least-32-characters-long!!";

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
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(json!(null)),
    )
}

fn bearer(user_id: Uuid, role: &str) -> String {
    let token = jwt::issue_access_token(TEST_SECRET, user_id, role, Uuid::new_v4()).unwrap();
    format!("Bearer {token}")
}

async fn seed_user(pool: &PgPool, tag: &str, role: &str) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO users (email, password_hash, name, role)
           VALUES ($1, 'test-password-hash', $2, $3)
           RETURNING id"#,
    )
    .bind(format!(
        "{tag}-{role}-{}@example.com",
        Uuid::new_v4().simple()
    ))
    .bind(format!("{role} {tag}"))
    .bind(role)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn seed_patient(pool: &PgPool, tag: &str, created_by: Uuid) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO patients (patient_id, first_name, last_name, birth_date, gender, created_by)
           VALUES ($1, 'Synthetic', $2, '1985-03-04', 'diverse', $3)
           RETURNING id"#,
    )
    .bind(format!("PT-{tag}"))
    .bind(format!("Patient {tag}"))
    .bind(created_by)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn seed_order(pool: &PgPool, tag: &str, patient_id: Uuid, created_by: Uuid) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO orders (order_number, patient_id, needs_description, created_by)
           VALUES ($1, $2, 'Synthetic planning order', $3)
           RETURNING id"#,
    )
    .bind(format!("A-BATCH-{tag}"))
    .bind(patient_id)
    .bind(created_by)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn assign_patient(pool: &PgPool, patient_id: Uuid, user_id: Uuid, assigned_by: Uuid) {
    sqlx::query(
        "INSERT INTO patient_assignments (patient_id, user_id, assigned_by) VALUES ($1, $2, $3)",
    )
    .bind(patient_id)
    .bind(user_id)
    .bind(assigned_by)
    .execute(pool)
    .await
    .unwrap();
}

struct Fixture {
    app: axum::Router,
    pool: PgPool,
    tag: String,
    patient_id: Uuid,
    order_id: Uuid,
    pm_id: Uuid,
    pm: String,
}

async fn fixture() -> Option<Fixture> {
    let tag = format!("batch-interp-{}", Uuid::new_v4().simple());
    let ctx = support::suite_context(TEST_SECRET).await?;
    let pool = ctx.pool.clone();
    let patient_id = seed_patient(&pool, &tag, ctx.admin_id).await;
    let pm_id = seed_user(&pool, &tag, "patient_manager").await;
    assign_patient(&pool, patient_id, pm_id, ctx.admin_id).await;
    let order_id = seed_order(&pool, &tag, patient_id, pm_id).await;
    Some(Fixture {
        app: ctx.app,
        pool,
        tag,
        patient_id,
        order_id,
        pm_id,
        pm: bearer(pm_id, "patient_manager"),
    })
}

fn day(offset: i64) -> NaiveDate {
    gmed_server::app_time::today() + Duration::days(offset)
}

/// An appointment of the order (or of another order) without an interpreter.
async fn seed_visit(
    fx: &Fixture,
    order_id: Uuid,
    appointment_type: &str,
    date: NaiveDate,
    start: &str,
    end: &str,
) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO appointments (
                patient_id, order_id, appointment_type, title, date, time_start, time_end,
                status, created_by
           ) VALUES ($1, $2, $3, $4, $5, $6::time, $7::time, 'confirmed', $8)
           RETURNING id"#,
    )
    .bind(fx.patient_id)
    .bind(order_id)
    .bind(appointment_type)
    .bind(format!("{appointment_type} {start}"))
    .bind(date)
    .bind(start)
    .bind(end)
    .bind(fx.pm_id)
    .fetch_one(&fx.pool)
    .await
    .unwrap()
}

async fn assign_batch(
    fx: &Fixture,
    bearer: &str,
    interpreter_id: Option<Uuid>,
    appointment_ids: &[Uuid],
) -> (StatusCode, Value) {
    json_request(
        &fx.app,
        "POST",
        &format!(
            "/api/v1/orders/{}/appointments/assign-interpreter",
            fx.order_id
        ),
        bearer,
        Some(json!({
            "interpreter_id": interpreter_id,
            "appointment_ids": appointment_ids,
        })),
    )
    .await
}

async fn interpreter_of(fx: &Fixture, appointment_id: Uuid) -> Option<Uuid> {
    sqlx::query_scalar("SELECT interpreter_id FROM appointments WHERE id = $1")
        .bind(appointment_id)
        .fetch_one(&fx.pool)
        .await
        .unwrap()
}

async fn booking_notifications(fx: &Fixture, interpreter_id: Uuid) -> Vec<Value> {
    sqlx::query_scalar::<_, String>(
        r#"SELECT body FROM user_notifications
           WHERE user_id = $1 AND kind = 'interpreter_booking_assigned'
           ORDER BY created_at"#,
    )
    .bind(interpreter_id)
    .fetch_all(&fx.pool)
    .await
    .unwrap()
    .into_iter()
    .map(|body| serde_json::from_str(&body).unwrap())
    .collect()
}

async fn batch_audit_count(fx: &Fixture, appointment_ids: &[Uuid]) -> i64 {
    sqlx::query_scalar(
        r#"SELECT COUNT(*) FROM audit_log
           WHERE action = 'assign_interpreter'
             AND entity_type = 'appointment'
             AND entity_id = ANY($1)
             AND context ->> 'batch' = 'true'"#,
    )
    .bind(appointment_ids)
    .fetch_one(&fx.pool)
    .await
    .unwrap()
}

async fn readiness(fx: &Fixture) -> Value {
    let (status, detail) = json_request(
        &fx.app,
        "GET",
        &format!("/api/v1/orders/{}", fx.order_id),
        &fx.pm,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{detail}");
    detail["planning_preparation"].clone()
}

fn failure_ids(body: &Value) -> Vec<String> {
    body["failures"]
        .as_array()
        .unwrap_or_else(|| panic!("failures missing: {body}"))
        .iter()
        .map(|item| item["appointment_id"].as_str().unwrap().to_string())
        .collect()
}

#[tokio::test]
async fn batch_books_every_appointment_with_one_notification_and_audit_per_appointment() {
    let Some(fx) = fixture().await else {
        return;
    };
    let interpreter = seed_user(&fx.pool, &fx.tag, "interpreter").await;
    let first = seed_visit(&fx, fx.order_id, "medical", day(5), "09:00", "10:00").await;
    let second = seed_visit(&fx, fx.order_id, "medical", day(5), "11:00", "12:00").await;
    let third = seed_visit(&fx, fx.order_id, "non_medical", day(6), "09:00", "10:00").await;
    let ids = [first, second, third];

    let (status, body) = assign_batch(&fx, &fx.pm, Some(interpreter), &ids).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["appointments"].as_array().unwrap().len(), 3);
    for id in ids {
        assert_eq!(interpreter_of(&fx, id).await, Some(interpreter));
    }
    let response: Option<String> =
        sqlx::query_scalar("SELECT interpreter_response FROM appointments WHERE id = $1")
            .bind(first)
            .fetch_one(&fx.pool)
            .await
            .unwrap();
    assert_eq!(response.as_deref(), Some("pending"));

    let notices = booking_notifications(&fx, interpreter).await;
    assert_eq!(notices.len(), 1, "{notices:?}");
    assert_eq!(notices[0]["batch_count"], 3);
    assert_eq!(notices[0]["batch_last_date"], day(6).to_string());

    // The audit trail written in the transaction is immediately visible.
    assert_eq!(batch_audit_count(&fx, &ids).await, 3);

    // Booking the same interpreter again (a double click) is not news for
    // them and changes nothing: no notification, no further audit rows.
    let (status, body) = assign_batch(&fx, &fx.pm, Some(interpreter), &ids).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(booking_notifications(&fx, interpreter).await.len(), 1);
    for item in body["appointments"].as_array().unwrap() {
        assert_eq!(item["changed"], false, "{body}");
    }
    assert_eq!(batch_audit_count(&fx, &ids).await, 3);

    // A day with one new visit next to booked ones audits only the new one.
    let fourth = seed_visit(&fx, fx.order_id, "medical", day(5), "14:00", "15:00").await;
    let (status, body) =
        assign_batch(&fx, &fx.pm, Some(interpreter), &[first, second, fourth]).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(batch_audit_count(&fx, &[first, second]).await, 2);
    assert_eq!(batch_audit_count(&fx, &[fourth]).await, 1);
}

#[tokio::test]
async fn batch_is_all_or_nothing_for_a_foreign_or_conflicting_appointment() {
    let Some(fx) = fixture().await else {
        return;
    };
    let interpreter = seed_user(&fx.pool, &fx.tag, "interpreter").await;
    let own = seed_visit(&fx, fx.order_id, "medical", day(7), "09:00", "10:00").await;
    let other_order = seed_order(
        &fx.pool,
        &format!("{}-other", fx.tag),
        fx.patient_id,
        fx.pm_id,
    )
    .await;
    let foreign = seed_visit(&fx, other_order, "medical", day(7), "13:00", "14:00").await;

    let (status, body) = assign_batch(&fx, &fx.pm, Some(interpreter), &[own, foreign]).await;
    assert_eq!(status, StatusCode::CONFLICT, "{body}");
    assert_eq!(failure_ids(&body), vec![foreign.to_string()]);
    assert_eq!(body["failures"][0]["code"], "not_in_order");
    assert_eq!(interpreter_of(&fx, own).await, None);
    assert!(booking_notifications(&fx, interpreter).await.is_empty());

    // The interpreter is booked elsewhere at the time of the second visit.
    let elsewhere_patient = seed_patient(&fx.pool, &format!("{}-else", fx.tag), fx.pm_id).await;
    sqlx::query(
        r#"INSERT INTO appointments (
                patient_id, appointment_type, title, date, time_start, time_end, status,
                created_by, interpreter_id, interpreter_response
           ) VALUES ($1, 'medical', 'Other patient', $2, '11:00', '12:00', 'confirmed', $3, $4, 'accepted')"#,
    )
    .bind(elsewhere_patient)
    .bind(day(8))
    .bind(fx.pm_id)
    .bind(interpreter)
    .execute(&fx.pool)
    .await
    .unwrap();
    let free = seed_visit(&fx, fx.order_id, "medical", day(8), "08:00", "09:00").await;
    let busy = seed_visit(&fx, fx.order_id, "medical", day(8), "11:30", "12:30").await;
    let (status, body) = assign_batch(&fx, &fx.pm, Some(interpreter), &[free, busy]).await;
    assert_eq!(status, StatusCode::CONFLICT, "{body}");
    assert_eq!(failure_ids(&body), vec![busy.to_string()]);
    assert_eq!(body["failures"][0]["code"], "schedule_conflict");
    assert_eq!(interpreter_of(&fx, free).await, None);
    assert_eq!(interpreter_of(&fx, busy).await, None);
    assert!(booking_notifications(&fx, interpreter).await.is_empty());
    assert_eq!(batch_audit_count(&fx, &[free, busy]).await, 0);
}

#[tokio::test]
async fn batch_refuses_a_blocked_interpreter_and_a_caller_without_rights() {
    let Some(fx) = fixture().await else {
        return;
    };
    let visit = seed_visit(&fx, fx.order_id, "medical", day(9), "09:00", "10:00").await;

    // An interpreter who is not active cannot be booked.
    let inactive = seed_user(&fx.pool, &format!("{}-off", fx.tag), "interpreter").await;
    sqlx::query("UPDATE users SET is_active = false WHERE id = $1")
        .bind(inactive)
        .execute(&fx.pool)
        .await
        .unwrap();
    let (status, body) = assign_batch(&fx, &fx.pm, Some(inactive), &[visit]).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
    assert_eq!(interpreter_of(&fx, visit).await, None);

    // A blocked interpreter is not booked either, and nothing changes.
    let blocked = seed_user(&fx.pool, &format!("{}-blocked", fx.tag), "interpreter").await;
    sqlx::query(
        "INSERT INTO interpreter_profile_details (user_id, status, employment_kind) VALUES ($1, 'blocked', 'internal')",
    )
    .bind(blocked)
    .execute(&fx.pool)
    .await
    .unwrap();
    let (status, body) = assign_batch(&fx, &fx.pm, Some(blocked), &[visit]).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
    assert_eq!(body["message"], "Interpreter is blocked");
    assert_eq!(interpreter_of(&fx, visit).await, None);
    assert!(booking_notifications(&fx, blocked).await.is_empty());

    let interpreter = seed_user(&fx.pool, &fx.tag, "interpreter").await;

    // Sales and interpreters do not assign interpreters.
    let sales = seed_user(&fx.pool, &fx.tag, "sales").await;
    let (status, _) = assign_batch(&fx, &bearer(sales, "sales"), Some(interpreter), &[visit]).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, _) = assign_batch(
        &fx,
        &bearer(interpreter, "interpreter"),
        Some(interpreter),
        &[visit],
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    // A patient manager without the patient cannot change its appointments.
    let stranger = seed_user(&fx.pool, &format!("{}-x", fx.tag), "patient_manager").await;
    let (status, body) = assign_batch(
        &fx,
        &bearer(stranger, "patient_manager"),
        Some(interpreter),
        &[visit],
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN, "{body}");
    assert_eq!(interpreter_of(&fx, visit).await, None);
}

#[tokio::test]
async fn batch_takes_the_interpreter_off_with_one_notice() {
    let Some(fx) = fixture().await else {
        return;
    };
    let interpreter = seed_user(&fx.pool, &fx.tag, "interpreter").await;
    let first = seed_visit(&fx, fx.order_id, "medical", day(10), "09:00", "10:00").await;
    let second = seed_visit(&fx, fx.order_id, "medical", day(11), "09:00", "10:00").await;
    let (status, body) = assign_batch(&fx, &fx.pm, Some(interpreter), &[first, second]).await;
    assert_eq!(status, StatusCode::OK, "{body}");

    let (status, body) = assign_batch(&fx, &fx.pm, None, &[first, second]).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(interpreter_of(&fx, first).await, None);
    assert_eq!(interpreter_of(&fx, second).await, None);
    let removed: i64 = sqlx::query_scalar(
        r#"SELECT COUNT(*) FROM user_notifications
           WHERE user_id = $1 AND kind = 'interpreter_booking_removed'"#,
    )
    .bind(interpreter)
    .fetch_one(&fx.pool)
    .await
    .unwrap();
    assert_eq!(removed, 1);
}

#[tokio::test]
async fn readiness_needs_an_interpreter_on_every_open_medical_appointment() {
    let Some(fx) = fixture().await else {
        return;
    };
    let interpreter = seed_user(&fx.pool, &fx.tag, "interpreter").await;
    let (status, planning) = json_request(
        &fx.app,
        "POST",
        &format!("/api/v1/orders/{}/planning-preparation", fx.order_id),
        &fx.pm,
        Some(json!({ "interpreter_required": true })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{planning}");
    assert_eq!(planning["interpreter_assignment_ready"], false);

    let first = seed_visit(&fx, fx.order_id, "medical", day(12), "09:00", "10:00").await;
    let second = seed_visit(&fx, fx.order_id, "medical", day(13), "09:00", "10:00").await;
    // A transfer without an interpreter does not hold the plan.
    seed_visit(&fx, fx.order_id, "non_medical", day(13), "11:00", "12:00").await;

    // One booked visit out of two is not enough any more.
    let (status, body) = assign_batch(&fx, &fx.pm, Some(interpreter), &[first]).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let planning = readiness(&fx).await;
    assert_eq!(
        planning["interpreter_assignment_ready"], false,
        "{planning}"
    );
    assert_eq!(planning["interpreter_missing"], 1);
    assert!(
        planning["blocking_reasons"]
            .as_array()
            .unwrap()
            .iter()
            .any(|reason| reason == "Interpreter is required but not assigned yet")
    );

    let (status, body) = assign_batch(&fx, &fx.pm, Some(interpreter), &[second]).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let planning = readiness(&fx).await;
    assert_eq!(planning["interpreter_assignment_ready"], true, "{planning}");
    assert_eq!(planning["interpreter_confirmation_ready"], false);
    assert_eq!(planning["interpreter_unconfirmed"], 2);

    // Accepting one booking leaves the other one open.
    sqlx::query("UPDATE appointments SET interpreter_response = 'accepted' WHERE id = $1")
        .bind(first)
        .execute(&fx.pool)
        .await
        .unwrap();
    assert_eq!(
        readiness(&fx).await["interpreter_confirmation_ready"],
        false
    );
    sqlx::query("UPDATE appointments SET interpreter_response = 'accepted' WHERE id = $1")
        .bind(second)
        .execute(&fx.pool)
        .await
        .unwrap();
    assert_eq!(readiness(&fx).await["interpreter_confirmation_ready"], true);

    // A declined booking counts as missing again.
    sqlx::query("UPDATE appointments SET interpreter_response = 'declined' WHERE id = $1")
        .bind(second)
        .execute(&fx.pool)
        .await
        .unwrap();
    let planning = readiness(&fx).await;
    assert_eq!(planning["interpreter_assignment_ready"], false);
    assert_eq!(planning["interpreter_missing"], 1);
}
