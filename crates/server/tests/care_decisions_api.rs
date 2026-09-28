//! Owner decisions of 2026-09-28 on appointments, interpreter bookings and
//! reports, reminders and checklists (status reference
//! docs/architecture/statuses/02_care-tasks_ua.md). Synthetic data only.

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
    let token = jwt::issue_access_token(TEST_SECRET, ctx.admin_id, "ceo", Uuid::new_v4()).ok()?;
    Some((ctx.app, ctx.pool, ctx.admin_id, format!("Bearer {token}")))
}

async fn json_request(
    app: &axum::Router,
    method: &str,
    path: &str,
    bearer: &str,
    body: Option<Value>,
) -> (StatusCode, Value) {
    let body = match body {
        Some(v) => Body::from(serde_json::to_vec(&v).unwrap()),
        None => Body::empty(),
    };
    let req = Request::builder()
        .method(method)
        .uri(path)
        .header("Authorization", bearer)
        .header("Content-Type", "application/json")
        .body(body)
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();
    let status = resp.status();
    let bytes = axum::body::to_bytes(resp.into_body(), 1024 * 1024)
        .await
        .unwrap();
    let value: Value = serde_json::from_slice(&bytes).unwrap_or(json!(null));
    (status, value)
}

fn unique_tag(prefix: &str) -> String {
    format!("{prefix}-{}", Uuid::new_v4().simple())
}

/// A date relative to today in Germany, as the server counts days.
fn berlin_date(offset_days: i64) -> chrono::NaiveDate {
    gmed_server::app_time::today() + chrono::Duration::days(offset_days)
}

async fn seed_user(pool: &PgPool, tag: &str, role: &str) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO users (email, password_hash, name, role)
           VALUES ($1, $2, $3, $4)
           RETURNING id"#,
    )
    .bind(format!(
        "{tag}-{role}-{}@example.com",
        Uuid::new_v4().simple()
    ))
    .bind("test-password-hash")
    .bind(format!("{role} {tag}"))
    .bind(role)
    .fetch_one(pool)
    .await
    .unwrap()
}

fn auth_header_for(user_id: Uuid, role: &str) -> String {
    let token = jwt::issue_access_token(TEST_SECRET, user_id, role, Uuid::new_v4()).unwrap();
    format!("Bearer {token}")
}

async fn seed_patient(pool: &PgPool, created_by: Uuid, tag: &str) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO patients (
                patient_id, first_name, last_name, birth_date, gender, created_by
           ) VALUES (
                $1, $2, $3, '1990-01-01', 'diverse', $4
           ) RETURNING id"#,
    )
    .bind(format!("PT-{tag}-{}", Uuid::new_v4().simple()))
    .bind(format!("First {tag}"))
    .bind(format!("Last {tag}"))
    .bind(created_by)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn seed_patient_assignment(pool: &PgPool, patient_id: Uuid, user_id: Uuid, by: Uuid) {
    sqlx::query(
        r#"INSERT INTO patient_assignments (patient_id, user_id, assigned_by)
           VALUES ($1, $2, $3)
           ON CONFLICT (patient_id, user_id)
           DO UPDATE SET revoked_at = NULL, assigned_by = $3, assigned_at = now()"#,
    )
    .bind(patient_id)
    .bind(user_id)
    .bind(by)
    .execute(pool)
    .await
    .unwrap();
}

/// An internal appointment (no provider needed) at a fixed slot.
#[allow(clippy::too_many_arguments)]
async fn seed_slot(
    pool: &PgPool,
    patient_id: Uuid,
    created_by: Uuid,
    title: &str,
    status: &str,
    date: chrono::NaiveDate,
    time_start: &str,
    time_end: &str,
) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO appointments (
                patient_id, appointment_type, title, date, time_start, time_end, status, created_by
           ) VALUES ($1, 'internal', $2, $3, $4::time, $5::time, $6, $7)
           RETURNING id"#,
    )
    .bind(patient_id)
    .bind(title)
    .bind(date)
    .bind(time_start)
    .bind(time_end)
    .bind(status)
    .bind(created_by)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn assign_interpreter(
    app: &axum::Router,
    bearer: &str,
    appointment_id: Uuid,
    interpreter_id: Uuid,
) -> (StatusCode, Value) {
    json_request(
        app,
        "POST",
        &format!("/api/v1/appointments/{appointment_id}/assign-interpreter"),
        bearer,
        Some(json!({ "interpreter_id": interpreter_id })),
    )
    .await
}

async fn respond(
    app: &axum::Router,
    interpreter_bearer: &str,
    appointment_id: Uuid,
    response: &str,
) -> (StatusCode, Value) {
    json_request(
        app,
        "POST",
        &format!("/api/v1/appointments/{appointment_id}/interpreter-response"),
        interpreter_bearer,
        Some(json!({ "response": response, "comment": "Synthetic test answer" })),
    )
    .await
}

async fn interpreter_response_of(pool: &PgPool, appointment_id: Uuid) -> Option<String> {
    sqlx::query_scalar("SELECT interpreter_response FROM appointments WHERE id = $1")
        .bind(appointment_id)
        .fetch_one(pool)
        .await
        .unwrap()
}

/// The JSON bodies of a user's notifications of one kind, oldest first.
async fn notifications_of(pool: &PgPool, user_id: Uuid, kind: &str) -> Vec<Value> {
    sqlx::query_scalar::<_, Option<String>>(
        "SELECT body FROM user_notifications WHERE user_id = $1 AND kind = $2 ORDER BY created_at, id",
    )
    .bind(user_id)
    .bind(kind)
    .fetch_all(pool)
    .await
    .unwrap()
    .into_iter()
    .map(|body| {
        body.and_then(|value| serde_json::from_str(&value).ok())
            .unwrap_or(Value::Null)
    })
    .collect()
}

// ---------------------------------------------------------------------------
// Q7: a declined booking frees the interpreter's slot, is not counted as
// booked, and booking the same interpreter again asks for a new answer.
// ---------------------------------------------------------------------------

#[tokio::test]
async fn declined_booking_frees_the_slot_and_rebooking_resets_the_answer() {
    let Some((app, pool, admin_id, bearer)) = test_context().await else {
        return;
    };
    let tag = unique_tag("q7-declined");
    let interpreter_id = seed_user(&pool, &tag, "interpreter").await;
    let interpreter_bearer = auth_header_for(interpreter_id, "interpreter");
    let first_patient = seed_patient(&pool, admin_id, &format!("{tag}-a")).await;
    let second_patient = seed_patient(&pool, admin_id, &format!("{tag}-b")).await;
    let date = berlin_date(5);
    let declined = seed_slot(
        &pool,
        first_patient,
        admin_id,
        "Declined visit",
        "planned",
        date,
        "09:00",
        "10:00",
    )
    .await;
    let other = seed_slot(
        &pool,
        second_patient,
        admin_id,
        "Other visit",
        "planned",
        date,
        "09:30",
        "10:30",
    )
    .await;

    let (status, body) = assign_interpreter(&app, &bearer, declined, interpreter_id).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    // While the first booking holds the slot, the overlapping one is refused.
    let (status, body) = assign_interpreter(&app, &bearer, other, interpreter_id).await;
    assert_eq!(status, StatusCode::CONFLICT, "{body}");

    let (status, body) = respond(&app, &interpreter_bearer, declined, "declined").await;
    assert_eq!(status, StatusCode::OK, "{body}");

    // The conflict check ignores the declined booking ...
    let (status, body) = json_request(
        &app,
        "GET",
        &format!(
            "/api/v1/appointments/meta/conflicts?patient_id={second_patient}&interpreter_id={interpreter_id}&date={date}&time_start=09:30&time_end=10:30&appointment_id={other}"
        ),
        &bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["interpreter_conflict_count"], 0, "{body}");
    // ... and the interpreter can be booked on the overlapping visit.
    let (status, body) = assign_interpreter(&app, &bearer, other, interpreter_id).await;
    assert_eq!(status, StatusCode::OK, "{body}");

    // Only the active booking counts as booked.
    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/interpreters/{interpreter_id}/profile/operations"),
        &bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["summary"]["appointments_next_30_days"], 1, "{body}");

    // Accepting the declined booking again would double-book the slot now.
    let (status, body) = respond(&app, &interpreter_bearer, declined, "accepted").await;
    assert_eq!(status, StatusCode::CONFLICT, "{body}");
    assert_eq!(
        interpreter_response_of(&pool, declined).await.as_deref(),
        Some("declined")
    );

    // Booking the same interpreter again on a free slot asks for a new answer.
    let later = seed_slot(
        &pool,
        first_patient,
        admin_id,
        "Later visit",
        "planned",
        date,
        "14:00",
        "15:00",
    )
    .await;
    let (status, body) = assign_interpreter(&app, &bearer, later, interpreter_id).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let (status, body) = respond(&app, &interpreter_bearer, later, "declined").await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(
        interpreter_response_of(&pool, later).await.as_deref(),
        Some("declined")
    );
    let (status, body) = assign_interpreter(&app, &bearer, later, interpreter_id).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(
        interpreter_response_of(&pool, later).await.as_deref(),
        Some("pending")
    );
    let comment: Option<String> =
        sqlx::query_scalar("SELECT interpreter_response_comment FROM appointments WHERE id = $1")
            .bind(later)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(comment, None);
    // Re-assigning an interpreter who accepted keeps the answer.
    let (status, body) = respond(&app, &interpreter_bearer, later, "accepted").await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let (status, body) = assign_interpreter(&app, &bearer, later, interpreter_id).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(
        interpreter_response_of(&pool, later).await.as_deref(),
        Some("accepted")
    );
}

async fn set_status(
    app: &axum::Router,
    bearer: &str,
    appointment_id: Uuid,
    status: &str,
) -> (StatusCode, Value) {
    json_request(
        app,
        "POST",
        &format!("/api/v1/appointments/{appointment_id}/status"),
        bearer,
        Some(json!({ "status": status })),
    )
    .await
}

// ---------------------------------------------------------------------------
// Q2: interpreters are notified about their own bookings.
// ---------------------------------------------------------------------------

#[tokio::test]
async fn interpreters_hear_about_booking_changes_of_their_own_visits() {
    let Some((app, pool, admin_id, bearer)) = test_context().await else {
        return;
    };
    let tag = unique_tag("q2-notices");
    let first = seed_user(&pool, &tag, "interpreter").await;
    let second = seed_user(&pool, &tag, "interpreter").await;
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let date = berlin_date(7);
    let appointment_id = seed_slot(
        &pool,
        patient_id,
        admin_id,
        "Notice visit",
        "planned",
        date,
        "09:00",
        "10:00",
    )
    .await;

    let (status, body) = assign_interpreter(&app, &bearer, appointment_id, first).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let booked = notifications_of(&pool, first, "interpreter_booking_assigned").await;
    assert_eq!(booked.len(), 1, "{booked:?}");
    assert_eq!(booked[0]["appointment_title"], "Notice visit");
    // Re-confirming the standing booking is no news.
    let (status, _) = assign_interpreter(&app, &bearer, appointment_id, first).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        notifications_of(&pool, first, "interpreter_booking_assigned")
            .await
            .len(),
        1
    );

    // Rescheduling the visit tells the booked interpreter, with the old slot.
    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/appointments/{appointment_id}/update"),
        &bearer,
        Some(json!({
            "interpreter_id": first,
            "appointment_type": "internal",
            "title": "Notice visit",
            "date": berlin_date(8).to_string(),
            "time_start": "11:00",
            "time_end": "12:00",
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let moved = notifications_of(&pool, first, "interpreter_appointment_rescheduled").await;
    assert_eq!(moved.len(), 1, "{moved:?}");
    assert_eq!(moved[0]["previous_date"], date.to_string());
    assert_eq!(moved[0]["previous_time_start"], "09:00");
    assert_eq!(moved[0]["time_start"], "11:00");

    // Booking another interpreter: the first is taken off, the second booked.
    let (status, body) = assign_interpreter(&app, &bearer, appointment_id, second).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(
        notifications_of(&pool, first, "interpreter_booking_removed")
            .await
            .len(),
        1
    );
    // The unbooked interpreter's notification carries no link to the visit.
    let removed_entity: Option<Uuid> = sqlx::query_scalar(
        "SELECT entity_id FROM user_notifications WHERE user_id = $1 AND kind = 'interpreter_booking_removed'",
    )
    .bind(first)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(removed_entity, None);
    assert_eq!(
        notifications_of(&pool, second, "interpreter_booking_assigned")
            .await
            .len(),
        1
    );

    // Cancelling the visit tells the booked interpreter only.
    let (status, body) = set_status(&app, &bearer, appointment_id, "cancelled").await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(
        notifications_of(&pool, second, "interpreter_appointment_cancelled")
            .await
            .len(),
        1
    );
    assert!(
        notifications_of(&pool, first, "interpreter_appointment_cancelled")
            .await
            .is_empty()
    );
}

#[tokio::test]
async fn an_automatically_rejected_report_is_announced_to_its_interpreter() {
    let Some((app, pool, admin_id, bearer)) = test_context().await else {
        return;
    };
    let tag = unique_tag("q2-auto-reject");
    let interpreter_id = seed_user(&pool, &tag, "interpreter").await;
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let appointment_id = seed_slot(
        &pool,
        patient_id,
        admin_id,
        "Reported visit",
        "confirmed",
        berlin_date(0),
        "08:00",
        "09:00",
    )
    .await;
    let (status, _) = assign_interpreter(&app, &bearer, appointment_id, interpreter_id).await;
    assert_eq!(status, StatusCode::OK);
    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/appointments/{appointment_id}/report"),
        &auth_header_for(interpreter_id, "interpreter"),
        Some(json!({ "hours": 1.0, "report_text": "Synthetic report" })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{body}");

    let (status, body) = set_status(&app, &bearer, appointment_id, "cancelled").await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let rejected =
        notifications_of(&pool, interpreter_id, "interpreter_report_auto_rejected").await;
    assert_eq!(rejected.len(), 1, "{rejected:?}");
    assert_eq!(rejected[0]["reason"], "appointment_cancelled");
    assert_eq!(
        notifications_of(&pool, interpreter_id, "interpreter_appointment_cancelled")
            .await
            .len(),
        1
    );
}

// ---------------------------------------------------------------------------
// Q6: a team lead booked as interpreter reports; someone else reviews.
// ---------------------------------------------------------------------------

#[tokio::test]
async fn a_booked_team_lead_reports_but_cannot_review_its_own_report() {
    let Some((app, pool, admin_id, bearer)) = test_context().await else {
        return;
    };
    let tag = unique_tag("q6-teamlead");
    let teamlead = seed_user(&pool, &tag, "teamlead_interpreter").await;
    let other_teamlead = seed_user(&pool, &tag, "teamlead_interpreter").await;
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    seed_patient_assignment(&pool, patient_id, teamlead, admin_id).await;
    seed_patient_assignment(&pool, patient_id, other_teamlead, admin_id).await;
    let appointment_id = seed_slot(
        &pool,
        patient_id,
        admin_id,
        "Team lead visit",
        "confirmed",
        berlin_date(0),
        "08:00",
        "09:00",
    )
    .await;
    let (status, _) = assign_interpreter(&app, &bearer, appointment_id, teamlead).await;
    assert_eq!(status, StatusCode::OK);

    let teamlead_bearer = auth_header_for(teamlead, "teamlead_interpreter");
    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/appointments/{appointment_id}/report"),
        &teamlead_bearer,
        Some(json!({ "hours": 1.5, "report_text": "Synthetic report" })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{body}");

    for path in ["approve", "reject"] {
        let (status, body) = json_request(
            &app,
            "POST",
            &format!("/api/v1/appointments/{appointment_id}/report/{path}"),
            &teamlead_bearer,
            Some(json!({ "notes": "own" })),
        )
        .await;
        assert_eq!(status, StatusCode::FORBIDDEN, "{path}: {body}");
        assert_eq!(body["code"], "interpreter_report_self_review", "{body}");
    }
    // Another team lead approves.
    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/appointments/{appointment_id}/report/approve"),
        &auth_header_for(other_teamlead, "teamlead_interpreter"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
}

// ---------------------------------------------------------------------------
// Q8: an appointment with a billed approved report is not cancelled until the
// billing is reversed.
// ---------------------------------------------------------------------------

#[tokio::test]
async fn cancelling_a_visit_with_a_billed_report_needs_the_billing_reversed() {
    let Some((app, pool, admin_id, bearer)) = test_context().await else {
        return;
    };
    let tag = unique_tag("q8-billed");
    let interpreter_id = seed_user(&pool, &tag, "interpreter").await;
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let order_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO orders (order_number, patient_id, phase, status, needs_description, created_by)
           VALUES ($1, $2, 'execution', 'active', 'Synthetic needs', $3) RETURNING id"#,
    )
    .bind(format!("ORD-{tag}"))
    .bind(patient_id)
    .bind(admin_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    let appointment_id = seed_slot(
        &pool,
        patient_id,
        admin_id,
        "Billed visit",
        "confirmed",
        berlin_date(0),
        "08:00",
        "09:00",
    )
    .await;
    sqlx::query(
        "UPDATE appointments SET order_id = $2, interpreter_id = $3, interpreter_response = 'accepted' WHERE id = $1",
    )
    .bind(appointment_id)
    .bind(order_id)
    .bind(interpreter_id)
    .execute(&pool)
    .await
    .unwrap();
    let report_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO interpreter_reports (appointment_id, interpreter_id, hours, report_text,
                                          approval_status, approved_by, approved_at)
           VALUES ($1, $2, 2.0, 'Synthetic', 'approved', $3, now()) RETURNING id"#,
    )
    .bind(appointment_id)
    .bind(interpreter_id)
    .bind(admin_id)
    .fetch_one(&pool)
    .await
    .unwrap();

    // Approved but not billed yet: still refused, no order line named.
    let (status, body) = set_status(&app, &bearer, appointment_id, "cancelled").await;
    assert_eq!(status, StatusCode::CONFLICT, "{body}");
    assert_eq!(body["code"], "appointment_cancel_billed_report");
    assert_eq!(body["report_id"], report_id.to_string());
    assert!(body["order_leistung_id"].is_null(), "{body}");

    let line_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO order_leistungen (order_id, patient_id, description, quantity, unit_price,
                                        vat_rate, status, source_interpreter_report_id)
           VALUES ($1, $2, 'Dolmetscherstunden synthetic', 2.0, 95.0, 19.0, 'approved', $3)
           RETURNING id"#,
    )
    .bind(order_id)
    .bind(patient_id)
    .bind(report_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    let (status, body) = set_status(&app, &bearer, appointment_id, "cancelled").await;
    assert_eq!(status, StatusCode::CONFLICT, "{body}");
    assert_eq!(body["order_leistung_id"], line_id.to_string());
    assert_eq!(body["order_number"], format!("ORD-{tag}"));
    assert_eq!(
        body["order_leistung_description"],
        "Dolmetscherstunden synthetic"
    );

    // Once the billing line is reversed, the visit can be cancelled.
    sqlx::query(
        "UPDATE order_leistungen SET status = 'cancelled', cancelled_at = now(), cancelled_by = $2, cancellation_reason = 'Synthetic reversal' WHERE id = $1",
    )
    .bind(line_id)
    .bind(admin_id)
    .execute(&pool)
    .await
    .unwrap();
    let (status, body) = set_status(&app, &bearer, appointment_id, "cancelled").await;
    assert_eq!(status, StatusCode::OK, "{body}");
}
