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

// ---------------------------------------------------------------------------
// Q12: due reminders are delivered once as notifications. Q13: cancellation
// closes checklist items and reminders "without completion".
// ---------------------------------------------------------------------------

async fn seed_reminder(
    pool: &PgPool,
    appointment_id: Uuid,
    user_id: Uuid,
    remind_at: chrono::DateTime<chrono::Utc>,
    title: &str,
    completed: bool,
) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO reminders (appointment_id, user_id, remind_at, title, is_completed, completed_at)
           VALUES ($1, $2, $3, $4, $5, CASE WHEN $5 THEN now() END)
           RETURNING id"#,
    )
    .bind(appointment_id)
    .bind(user_id)
    .bind(remind_at)
    .bind(title)
    .bind(completed)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn reminder_notifications(pool: &PgPool, user_id: Uuid, reminder_id: Uuid) -> usize {
    notifications_of(pool, user_id, "appointment_reminder")
        .await
        .into_iter()
        .filter(|body| body["reminder_id"] == reminder_id.to_string())
        .count()
}

#[tokio::test]
async fn due_reminders_are_delivered_once_and_cancellation_closes_without_completion() {
    let Some(ctx) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let pool = ctx.pool.clone();
    let admin_id = ctx.admin_id;
    let app = ctx.app.clone();
    let bearer = format!(
        "Bearer {}",
        jwt::issue_access_token(TEST_SECRET, admin_id, "ceo", Uuid::new_v4()).unwrap()
    );
    let tag = unique_tag("q12-reminders");
    let manager = seed_user(&pool, &tag, "patient_manager").await;
    let billing = seed_user(&pool, &tag, "billing").await;
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    seed_patient_assignment(&pool, patient_id, manager, admin_id).await;
    let appointment_id = seed_slot(
        &pool,
        patient_id,
        admin_id,
        "Reminder visit",
        "planned",
        berlin_date(3),
        "10:00",
        "11:00",
    )
    .await;
    let now = chrono::Utc::now();
    let due = seed_reminder(
        &pool,
        appointment_id,
        manager,
        now - chrono::Duration::minutes(5),
        "Due reminder",
        false,
    )
    .await;
    let future = seed_reminder(
        &pool,
        appointment_id,
        manager,
        now + chrono::Duration::days(1),
        "Future reminder",
        false,
    )
    .await;
    let done = seed_reminder(
        &pool,
        appointment_id,
        manager,
        now - chrono::Duration::hours(1),
        "Done reminder",
        true,
    )
    .await;
    // Billing never works on appointments: its (legacy) reminder is not delivered.
    let ineligible = seed_reminder(
        &pool,
        appointment_id,
        billing,
        now - chrono::Duration::minutes(5),
        "Billing reminder",
        false,
    )
    .await;

    gmed_server::routes::appointments::run_appointment_reminder_delivery_once(&ctx.state).await;
    gmed_server::routes::appointments::run_appointment_reminder_delivery_once(&ctx.state).await;

    assert_eq!(reminder_notifications(&pool, manager, due).await, 1);
    assert_eq!(reminder_notifications(&pool, manager, future).await, 0);
    assert_eq!(reminder_notifications(&pool, manager, done).await, 0);
    assert_eq!(reminder_notifications(&pool, billing, ineligible).await, 0);
    let sent: Vec<(Uuid, bool)> = sqlx::query_as(
        "SELECT id, sent_at IS NOT NULL FROM reminders WHERE appointment_id = $1 ORDER BY remind_at",
    )
    .bind(appointment_id)
    .fetch_all(&pool)
    .await
    .unwrap();
    for (id, is_sent) in sent {
        assert_eq!(is_sent, id == due, "reminder {id}");
    }
    let audited: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM audit_log WHERE action = 'deliver_appointment_reminder' AND context->>'reminder_id' = $1",
    )
    .bind(due.to_string())
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(audited, 1);

    // Q13: an open checklist item and the open reminders close without
    // completion when the appointment is cancelled; the completed one stays.
    let checklist_id: Uuid = sqlx::query_scalar(
        "INSERT INTO appointment_checklists (appointment_id, phase, item_text) VALUES ($1, 'preparation', 'Synthetic step') RETURNING id",
    )
    .bind(appointment_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    let (status, body) = set_status(&app, &bearer, appointment_id, "cancelled").await;
    assert_eq!(status, StatusCode::OK, "{body}");

    let (status, checklist) = json_request(
        &app,
        "GET",
        &format!("/api/v1/appointments/{appointment_id}/checklist"),
        &bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{checklist}");
    let item = checklist
        .as_array()
        .unwrap()
        .iter()
        .find(|item| item["id"] == checklist_id.to_string())
        .unwrap();
    assert_eq!(item["is_completed"], true);
    assert_eq!(item["closed_reason"], "appointment_cancelled");

    let (status, reminders) = json_request(
        &app,
        "GET",
        &format!("/api/v1/appointments/{appointment_id}/reminders"),
        &bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{reminders}");
    for reminder in reminders.as_array().unwrap() {
        assert_eq!(reminder["is_completed"], true, "{reminder}");
        let expected = if reminder["id"] == done.to_string() {
            Value::Null
        } else {
            json!("appointment_cancelled")
        };
        assert_eq!(reminder["closed_reason"], expected, "{reminder}");
    }
    // A cancelled appointment's reminders are never delivered afterwards.
    gmed_server::routes::appointments::run_appointment_reminder_delivery_once(&ctx.state).await;
    assert_eq!(reminder_notifications(&pool, manager, future).await, 0);
}

// ---------------------------------------------------------------------------
// Q9 / Q14: work-center review rules.
// ---------------------------------------------------------------------------

async fn create_task(
    app: &axum::Router,
    bearer: &str,
    title: &str,
    assigned_to: Uuid,
    parent: Option<&str>,
) -> Value {
    let (status, task) = json_request(
        app,
        "POST",
        "/api/v1/concierge-operational-items",
        bearer,
        Some(json!({
            "request_id": Uuid::new_v4(),
            "kind": "task",
            "title": title,
            "assigned_to": assigned_to,
            "starts_at": "2026-10-01T09:00:00Z",
            "due_at": "2026-10-02T17:00:00Z",
            "parent_task_id": parent,
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{task}");
    task
}

async fn change_task_status(
    app: &axum::Router,
    bearer: &str,
    task: &Value,
    status: &str,
) -> (StatusCode, Value) {
    json_request(
        app,
        "POST",
        &format!(
            "/api/v1/concierge-operational-items/{}/status",
            task["id"].as_str().unwrap()
        ),
        bearer,
        Some(json!({ "status": status, "expected_updated_at": task["updated_at"] })),
    )
    .await
}

async fn task_notification_titles(pool: &PgPool, user_id: Uuid, kind: &str) -> Vec<String> {
    sqlx::query_scalar(
        "SELECT title FROM user_notifications WHERE user_id = $1 AND kind = $2 ORDER BY created_at, id",
    )
    .bind(user_id)
    .bind(kind)
    .fetch_all(pool)
    .await
    .unwrap()
}

#[tokio::test]
async fn closing_subtasks_applies_the_review_rule_per_child_and_assignees_hear_decisions() {
    let Some((app, pool, admin_id, ceo_bearer)) = test_context().await else {
        return;
    };
    let tag = unique_tag("q9-subtasks");
    let manager = seed_user(&pool, &tag, "patient_manager").await;
    let concierge = seed_user(&pool, &tag, "concierge").await;
    let manager_bearer = auth_header_for(manager, "patient_manager");
    let concierge_bearer = auth_header_for(concierge, "concierge");

    let parent = create_task(&app, &manager_bearer, "Parent", concierge, None).await;
    let parent_id = parent["id"].as_str().unwrap().to_string();
    let own_child = create_task(
        &app,
        &manager_bearer,
        "Own child",
        concierge,
        Some(&parent_id),
    )
    .await;
    // A sub-task of the CEO: the manager is not its reviewer.
    let ceo_child = create_task(&app, &ceo_bearer, "CEO child", concierge, Some(&parent_id)).await;

    // The assignee hands its sub-task in; the author accepts it.
    let (status, started) =
        change_task_status(&app, &concierge_bearer, &own_child, "in_progress").await;
    assert_eq!(status, StatusCode::OK, "{started}");
    let (status, in_review) = change_task_status(&app, &concierge_bearer, &started, "review").await;
    assert_eq!(status, StatusCode::OK, "{in_review}");
    let (status, returned) =
        change_task_status(&app, &manager_bearer, &in_review, "in_progress").await;
    assert_eq!(status, StatusCode::OK, "{returned}");
    assert_eq!(
        task_notification_titles(&pool, concierge, "operational_task_review_decision").await,
        vec!["Task returned for rework".to_string()]
    );
    let (status, in_review) =
        change_task_status(&app, &concierge_bearer, &returned, "review").await;
    assert_eq!(status, StatusCode::OK, "{in_review}");

    // Cancelling the parent: the manager closes what it reviews, the CEO's
    // sub-task stays open and is reported as skipped.
    let (status, closed) = json_request(
        &app,
        "POST",
        &format!("/api/v1/concierge-operational-items/{parent_id}/close-children"),
        &manager_bearer,
        Some(json!({ "status": "cancelled" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{closed}");
    assert_eq!(closed["closed_count"], 1, "{closed}");
    assert_eq!(closed["skipped_count"], 1, "{closed}");
    assert_eq!(closed["skipped_ids"][0], ceo_child["id"], "{closed}");
    let statuses: Vec<(Uuid, String)> = sqlx::query_as(
        "SELECT id, status FROM tasks WHERE parent_task_id = $1::uuid ORDER BY title",
    )
    .bind(&parent_id)
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(
        statuses
            .iter()
            .map(|(_, status)| status.as_str())
            .collect::<Vec<_>>(),
        vec!["open", "cancelled"]
    );
    // The assignee hears the decision on the sub-task it had handed in.
    assert_eq!(
        task_notification_titles(&pool, concierge, "operational_task_review_decision").await,
        vec![
            "Task returned for rework".to_string(),
            "Task cancelled after review".to_string()
        ]
    );
    let _ = admin_id;
}

#[tokio::test]
async fn the_ceo_assistant_reads_concierge_tasks_but_changes_only_its_own() {
    let Some((app, pool, _admin_id, _bearer)) = test_context().await else {
        return;
    };
    let tag = unique_tag("q14-assistant");
    let assistant = seed_user(&pool, &tag, "ceo_assistant").await;
    let concierge = seed_user(&pool, &tag, "concierge").await;
    let assistant_bearer = auth_header_for(assistant, "ceo_assistant");
    let concierge_bearer = auth_header_for(concierge, "concierge");

    let concierge_task =
        create_task(&app, &concierge_bearer, "Concierge own", concierge, None).await;
    let task_id = concierge_task["id"].as_str().unwrap();
    let (status, detail) = json_request(
        &app,
        "GET",
        &format!("/api/v1/concierge-operational-items/{task_id}"),
        &assistant_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{detail}");
    let (status, body) =
        change_task_status(&app, &assistant_bearer, &concierge_task, "cancelled").await;
    assert_eq!(status, StatusCode::FORBIDDEN, "{body}");
    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/concierge-operational-items/{task_id}/comments"),
        &assistant_bearer,
        Some(json!({ "request_id": Uuid::new_v4(), "body": "Synthetic comment" })),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN, "{body}");

    // A task the assistant created stays in its hands.
    let own = create_task(&app, &assistant_bearer, "Assistant own", concierge, None).await;
    let (status, body) = change_task_status(&app, &assistant_bearer, &own, "cancelled").await;
    assert_eq!(status, StatusCode::OK, "{body}");
}

// ---------------------------------------------------------------------------
// Q5: open appointment requests can be withdrawn (portal) or cancelled (staff).
// ---------------------------------------------------------------------------

async fn portal_request(app: &axum::Router, patient_bearer: &str, care_path_kind: &str) -> String {
    let (status, body) = json_request(
        app,
        "POST",
        "/api/v1/me/appointment-requests",
        patient_bearer,
        Some(json!({
            "appointment_type": "medical",
            "care_path_kind": care_path_kind,
            "preferred_date_from": "2026-11-10",
            "reason": "Synthetic request",
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    body["id"].as_str().unwrap().to_string()
}

#[tokio::test]
async fn open_appointment_requests_can_be_withdrawn_or_cancelled() {
    let Some((app, pool, admin_id, _bearer)) = test_context().await else {
        return;
    };
    let tag = unique_tag("q5-requests");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let patient_user = seed_user(&pool, &tag, "patient").await;
    let manager = seed_user(&pool, &tag, "patient_manager").await;
    seed_patient_assignment(&pool, patient_id, patient_user, admin_id).await;
    seed_patient_assignment(&pool, patient_id, manager, admin_id).await;
    let patient_bearer = auth_header_for(patient_user, "patient");
    let manager_bearer = auth_header_for(manager, "patient_manager");

    // An approved request the patient no longer needs: withdrawn in the portal.
    let approved = portal_request(&app, &patient_bearer, "regular").await;
    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/appointments/requests/{approved}/review"),
        &manager_bearer,
        Some(json!({ "status": "approved" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/me/appointment-requests/{approved}/withdraw"),
        &patient_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["status"], "cancelled");
    assert_eq!(body["cancelled_by_patient"], true);
    let withdrawn: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM user_notifications WHERE user_id = $1 AND kind = 'appointment_request_withdrawn' AND entity_id = $2::uuid",
    )
    .bind(manager)
    .bind(&approved)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(withdrawn, 1);
    // Twice is refused; so is a request of someone else.
    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/me/appointment-requests/{approved}/withdraw"),
        &patient_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);

    // Staff cancel a requested one, with a reason the patient sees.
    let requested = portal_request(&app, &patient_bearer, "regular").await;
    let other_patient_user = seed_user(&pool, &format!("{tag}-other"), "patient").await;
    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/me/appointment-requests/{requested}/withdraw"),
        &auth_header_for(other_patient_user, "patient"),
        None,
    )
    .await;
    assert!(status.is_client_error(), "{status}");
    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/appointments/requests/{requested}/cancel"),
        &manager_bearer,
        Some(json!({ "reason": "" })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/appointments/requests/{requested}/cancel"),
        &manager_bearer,
        Some(json!({ "reason": "Termin nicht mehr nötig" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["status"], "cancelled");
    assert_eq!(body["cancellation_reason"], "Termin nicht mehr nötig");
    let (status, mine) = json_request(
        &app,
        "GET",
        "/api/v1/me/appointment-requests",
        &patient_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(
        mine.as_array()
            .unwrap()
            .iter()
            .all(|item| item["status"] == "cancelled"),
        "{mine}"
    );
    let audited: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM audit_log WHERE entity_type = 'appointment_request' AND action IN ('withdraw_appointment_request', 'cancel_appointment_request') AND entity_id IN ($1::uuid, $2::uuid)",
    )
    .bind(&approved)
    .bind(&requested)
    .fetch_one(&pool)
    .await
    .unwrap_or(0);
    // The audit channel writes asynchronously; both rows arrive.
    if audited < 2 {
        support::wait_until("request cancellation audit rows", || {
            let pool = pool.clone();
            let approved = approved.clone();
            let requested = requested.clone();
            async move {
                sqlx::query_scalar::<_, i64>(
                    "SELECT count(*) FROM audit_log WHERE entity_type = 'appointment_request' AND action IN ('withdraw_appointment_request', 'cancel_appointment_request') AND entity_id IN ($1::uuid, $2::uuid)",
                )
                .bind(&approved)
                .bind(&requested)
                .fetch_one(&pool)
                .await
                .unwrap_or(0)
                    >= 2
            }
        })
        .await;
    }
}

// ---------------------------------------------------------------------------
// Q10: a cancelled order closes its open checklist items; its steps lock.
// ---------------------------------------------------------------------------

#[tokio::test]
async fn cancelling_an_order_closes_its_checklist_and_locks_its_steps() {
    let Some((app, pool, admin_id, bearer)) = test_context().await else {
        return;
    };
    let tag = unique_tag("q10-order");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let order_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO orders (order_number, patient_id, phase, status, needs_description, created_by)
           VALUES ($1, $2, 'discovery', 'active', 'Synthetic needs', $3) RETURNING id"#,
    )
    .bind(format!("ORD-{tag}"))
    .bind(patient_id)
    .bind(admin_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    // Creating the checklist opens its template items with tasks.
    let (status, checklist) = json_request(
        &app,
        "GET",
        &format!("/api/v1/orders/{order_id}/workflow-checklist"),
        &bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{checklist}");
    let open_items: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM workflow_checklist_items WHERE order_id = $1 AND NOT is_completed",
    )
    .bind(order_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(open_items > 0, "{checklist}");

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/orders/{order_id}/status"),
        &bearer,
        Some(json!({ "status": "cancelled", "reason": "Synthetic cancellation" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");

    let items: Vec<(bool, Option<String>, Option<String>)> = sqlx::query_as(
        r#"SELECT item.is_completed, item.not_required_reason, task.status
           FROM workflow_checklist_items item
           LEFT JOIN tasks task ON task.id = item.linked_task_id
           WHERE item.order_id = $1"#,
    )
    .bind(order_id)
    .fetch_all(&pool)
    .await
    .unwrap();
    for (completed, reason, task_status) in &items {
        assert!(completed);
        assert_eq!(reason.as_deref(), Some("order_cancelled"));
        if let Some(task_status) = task_status {
            assert_eq!(task_status, "cancelled");
        }
    }
    // Such an item cannot be reopened.
    let item_id: Uuid =
        sqlx::query_scalar("SELECT id FROM workflow_checklist_items WHERE order_id = $1 LIMIT 1")
            .bind(order_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/orders/{order_id}/workflow-checklist/{item_id}/reopen"),
        &bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{body}");

    // The steps are locked.
    for (path, payload) in [
        ("execution-flow", json!({ "arrival_status": "arrived" })),
        (
            "followup-flow",
            json!({ "followup_1w_status": "completed" }),
        ),
        (
            "planning-preparation",
            json!({ "treatment_plan_status": "agreed" }),
        ),
    ] {
        let (status, body) = json_request(
            &app,
            "POST",
            &format!("/api/v1/orders/{order_id}/{path}"),
            &bearer,
            Some(payload),
        )
        .await;
        assert_eq!(status, StatusCode::CONFLICT, "{path}: {body}");
        assert_eq!(body["code"], "order_steps_locked", "{path}: {body}");
    }
}

// ---------------------------------------------------------------------------
// Q11: a recommendation's status and clinical lifecycle stay in step.
// ---------------------------------------------------------------------------

#[tokio::test]
async fn recommendation_status_and_lifecycle_follow_each_other() {
    let Some((app, pool, admin_id, bearer)) = test_context().await else {
        return;
    };
    let tag = unique_tag("q11-recommendation");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let patient_user = seed_user(&pool, &tag, "patient").await;
    seed_patient_assignment(&pool, patient_id, patient_user, admin_id).await;
    let (status, created) = json_request(
        &app,
        "POST",
        &format!("/api/v1/patients/{patient_id}/recommendations"),
        &bearer,
        Some(json!({ "title": "Synthetic check-up", "lifecycle_status": "aktiv" })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{created}");
    let id = created["id"].as_str().unwrap().to_string();
    assert_eq!(created["status"], "active");

    // The patient reports it done in the portal: the clinical tab follows.
    let (status, decided) = json_request(
        &app,
        "POST",
        &format!("/api/v1/me/recommendations/{id}/decision"),
        &auth_header_for(patient_user, "patient"),
        Some(json!({ "decision": "already_done" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{decided}");
    assert_eq!(decided["status"], "completed");
    // The outcome tracking is staff-only (QA C-12): the portal answer leaves
    // it out, the clinical tab shows it.
    assert!(decided.get("lifecycle_status").is_none(), "{decided}");
    let (status, listed) = json_request(
        &app,
        "GET",
        &format!("/api/v1/patients/{patient_id}/recommendations"),
        &bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{listed}");
    let staff_view = listed
        .as_array()
        .expect("recommendation list")
        .iter()
        .find(|item| item["id"] == id.as_str())
        .expect("staff sees the recommendation");
    assert_eq!(staff_view["lifecycle_status"], "erfolg");

    // The clinical tab records "not done": the status follows.
    let update = format!("/api/v1/patients/{patient_id}/recommendations/{id}/update");
    let (status, updated) = json_request(
        &app,
        "POST",
        &update,
        &bearer,
        Some(json!({ "lifecycle_status": "nicht_erfolgt" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{updated}");
    assert_eq!(updated["status"], "cancelled");
    assert_eq!(updated["lifecycle_status"], "nicht_erfolgt");

    // Contradicting changes are refused.
    let (status, body) = json_request(
        &app,
        "POST",
        &update,
        &bearer,
        Some(json!({ "status": "active", "lifecycle_status": "erfolg" })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");

    // The database refuses a disagreeing pair outright.
    let refused = sqlx::query(
        "UPDATE patient_recommendations SET lifecycle_status = 'aktiv' WHERE id = $1::uuid",
    )
    .bind(&id)
    .execute(&pool)
    .await;
    assert!(refused.is_err());
}
