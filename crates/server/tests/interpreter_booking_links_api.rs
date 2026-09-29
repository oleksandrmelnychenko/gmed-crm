mod support;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use chrono::{Duration, NaiveDate};
use serde_json::{Value, json};
use sqlx::PgPool;
use tower::ServiceExt;
use uuid::Uuid;

use gmed_server::auth::jwt;
use gmed_server::services::interpreter_booking_links;

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

/// A manual assignment, as a manager makes it.
async fn assign_manually(pool: &PgPool, patient_id: Uuid, user_id: Uuid, assigned_by: Uuid) {
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
    patient_id: Uuid,
    provider_id: Uuid,
    doctor_id: Uuid,
    pm_id: Uuid,
    pm: String,
}

async fn fixture(tag: &str) -> Option<Fixture> {
    let ctx = support::suite_context(TEST_SECRET).await?;
    let pool = ctx.pool.clone();
    let patient_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO patients (patient_id, first_name, last_name, birth_date, gender, created_by)
           VALUES ($1, 'Synthetic', $2, '1985-03-04', 'diverse', $3)
           RETURNING id"#,
    )
    .bind(format!("PT-{tag}"))
    .bind(format!("Patient {tag}"))
    .bind(ctx.admin_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    let provider_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO providers (name, provider_type, address_city, fachbereich, address_country)
           VALUES ($1, 'medical', 'Berlin', 'Cardiology', 'Germany')
           RETURNING id"#,
    )
    .bind(format!("Clinic {tag}"))
    .fetch_one(&pool)
    .await
    .unwrap();
    let doctor_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO provider_doctors (provider_id, name, fachbereich)
           VALUES ($1, $2, 'Cardiology')
           RETURNING id"#,
    )
    .bind(provider_id)
    .bind(format!("Dr {tag}"))
    .fetch_one(&pool)
    .await
    .unwrap();
    let pm_id = seed_user(&pool, tag, "patient_manager").await;
    assign_manually(&pool, patient_id, pm_id, ctx.admin_id).await;
    Some(Fixture {
        app: ctx.app,
        pool,
        patient_id,
        provider_id,
        doctor_id,
        pm_id,
        pm: bearer(pm_id, "patient_manager"),
    })
}

/// The manager books the interpreter on a new appointment of the patient.
async fn book(fx: &Fixture, interpreter_id: Uuid, date: NaiveDate, title: &str) -> Uuid {
    let (status, body) = json_request(
        &fx.app,
        "POST",
        "/api/v1/appointments",
        &fx.pm,
        Some(json!({
            "patient_id": fx.patient_id,
            "provider_id": fx.provider_id,
            "doctor_id": fx.doctor_id,
            "owner_user_id": fx.pm_id,
            "interpreter_id": interpreter_id,
            "appointment_type": "medical",
            "title": title,
            "date": date.to_string(),
            "time_start": "09:00",
            "time_end": "10:00"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    Uuid::parse_str(body["id"].as_str().unwrap()).unwrap()
}

/// An appointment written directly, as older data or another flow leaves it.
async fn seed_booked_visit(fx: &Fixture, interpreter_id: Uuid, date: NaiveDate) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO appointments (
                patient_id, provider_id, doctor_id, interpreter_id, interpreter_response,
                appointment_type, title, date, time_start, time_end, status, created_by
           ) VALUES ($1, $2, $3, $4, 'accepted', 'medical', 'Earlier visit', $5,
                     '09:00', '10:00', 'confirmed', $6)
           RETURNING id"#,
    )
    .bind(fx.patient_id)
    .bind(fx.provider_id)
    .bind(fx.doctor_id)
    .bind(interpreter_id)
    .bind(date)
    .bind(fx.pm_id)
    .fetch_one(&fx.pool)
    .await
    .unwrap()
}

/// `(source, active)` of the user's link to the patient.
async fn link(fx: &Fixture, user_id: Uuid) -> Option<(String, bool)> {
    sqlx::query_as::<_, (String, bool)>(
        r#"SELECT source, revoked_at IS NULL
           FROM patient_assignments
           WHERE patient_id = $1 AND user_id = $2"#,
    )
    .bind(fx.patient_id)
    .bind(user_id)
    .fetch_optional(&fx.pool)
    .await
    .unwrap()
}

fn booking_link(active: bool) -> Option<(String, bool)> {
    Some(("interpreter_booking".to_string(), active))
}

/// Audit actions about the user's link to the patient, oldest first.
async fn link_audit(fx: &Fixture, user_id: Uuid) -> Vec<(String, Value)> {
    sqlx::query_as::<_, (String, Value)>(
        r#"SELECT action, context
           FROM audit_log
           WHERE entity_type = 'patient'
             AND entity_id = $1
             AND action IN ('grant_booking_patient_access', 'end_booking_patient_access')
             AND context ->> 'user_id' = $2
           ORDER BY id"#,
    )
    .bind(fx.patient_id)
    .bind(user_id.to_string())
    .fetch_all(&fx.pool)
    .await
    .unwrap()
}

async fn patient_card(fx: &Fixture, interpreter_id: Uuid) -> StatusCode {
    json_request(
        &fx.app,
        "GET",
        &format!("/api/v1/patients/{}", fx.patient_id),
        &bearer(interpreter_id, "interpreter"),
        None,
    )
    .await
    .0
}

fn today() -> NaiveDate {
    gmed_server::app_time::today()
}

#[tokio::test]
async fn booking_grants_the_link_and_taking_the_interpreter_off_revokes_it() {
    let tag = format!("booking-link-{}", Uuid::new_v4().simple());
    let Some(fx) = fixture(&tag).await else {
        return;
    };
    let interpreter = seed_user(&fx.pool, &tag, "interpreter").await;
    let replacement = seed_user(&fx.pool, &format!("{tag}-2"), "interpreter").await;

    let visit = book(
        &fx,
        interpreter,
        today() + Duration::days(3),
        "Consultation",
    )
    .await;
    assert_eq!(link(&fx, interpreter).await, booking_link(true));
    assert_eq!(patient_card(&fx, interpreter).await, StatusCode::OK);
    let audit = link_audit(&fx, interpreter).await;
    assert_eq!(audit.len(), 1, "{audit:?}");
    assert_eq!(audit[0].0, "grant_booking_patient_access");
    assert_eq!(audit[0].1["cause"], "create_appointment");

    // Replacing the interpreter ends the first link and links the replacement.
    let (status, body) = json_request(
        &fx.app,
        "POST",
        &format!("/api/v1/appointments/{visit}/assign-interpreter"),
        &fx.pm,
        Some(json!({ "interpreter_id": replacement })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(link(&fx, interpreter).await, booking_link(false));
    assert_eq!(patient_card(&fx, interpreter).await, StatusCode::FORBIDDEN);
    assert_eq!(link(&fx, replacement).await, booking_link(true));
    let audit = link_audit(&fx, interpreter).await;
    assert_eq!(audit.last().unwrap().0, "end_booking_patient_access");
    assert_eq!(audit.last().unwrap().1["reason"], "no_active_booking");

    // A new booking grants the link again.
    book(&fx, interpreter, today() + Duration::days(10), "Follow-up").await;
    assert_eq!(link(&fx, interpreter).await, booking_link(true));
    assert_eq!(patient_card(&fx, interpreter).await, StatusCode::OK);
}

#[tokio::test]
async fn cancelling_declining_and_deleting_end_the_link_only_without_another_booking() {
    let tag = format!("booking-link-end-{}", Uuid::new_v4().simple());
    let Some(fx) = fixture(&tag).await else {
        return;
    };
    let interpreter = seed_user(&fx.pool, &tag, "interpreter").await;
    let first = book(&fx, interpreter, today() + Duration::days(2), "First visit").await;
    let second = book(
        &fx,
        interpreter,
        today() + Duration::days(5),
        "Second visit",
    )
    .await;

    let (status, body) = json_request(
        &fx.app,
        "POST",
        &format!("/api/v1/appointments/{first}/status"),
        &fx.pm,
        Some(json!({ "status": "cancelled" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    // The second visit still keeps the link.
    assert_eq!(link(&fx, interpreter).await, booking_link(true));

    let interpreter_bearer = bearer(interpreter, "interpreter");
    let (status, body) = json_request(
        &fx.app,
        "POST",
        &format!("/api/v1/appointments/{second}/interpreter-response"),
        &interpreter_bearer,
        Some(json!({ "response": "declined", "comment": "Not available" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(link(&fx, interpreter).await, booking_link(false));

    // Taking the visit back links the interpreter again.
    let (status, body) = json_request(
        &fx.app,
        "POST",
        &format!("/api/v1/appointments/{second}/interpreter-response"),
        &interpreter_bearer,
        Some(json!({ "response": "accepted" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(link(&fx, interpreter).await, booking_link(true));

    let (status, body) = json_request(
        &fx.app,
        "DELETE",
        &format!("/api/v1/appointments/{second}"),
        &fx.pm,
        None,
    )
    .await;
    assert!(status.is_success(), "{status}: {body}");
    assert_eq!(link(&fx, interpreter).await, booking_link(false));
    let actions: Vec<String> = link_audit(&fx, interpreter)
        .await
        .into_iter()
        .map(|(action, _)| action)
        .collect();
    assert_eq!(
        actions,
        vec![
            "grant_booking_patient_access",
            "end_booking_patient_access",
            "grant_booking_patient_access",
            "end_booking_patient_access",
        ]
    );
}

#[tokio::test]
async fn expiry_sweep_ends_links_after_the_configured_days_and_keeps_manual_links() {
    let tag = format!("booking-link-expiry-{}", Uuid::new_v4().simple());
    let Some(fx) = fixture(&tag).await else {
        return;
    };
    let interpreter = seed_user(&fx.pool, &tag, "interpreter").await;
    let manual_interpreter = seed_user(&fx.pool, &format!("{tag}-m"), "interpreter").await;
    assign_manually(&fx.pool, fx.patient_id, manual_interpreter, fx.pm_id).await;
    seed_booked_visit(&fx, manual_interpreter, today() - Duration::days(60)).await;

    let visit_date = today() + Duration::days(1);
    book(&fx, interpreter, visit_date, "Consultation").await;
    let sweep = |day: NaiveDate| {
        let pool = fx.pool.clone();
        async move {
            interpreter_booking_links::end_expired_links(&pool, day)
                .await
                .unwrap()
        }
    };

    assert_eq!(sweep(today()).await, 0);
    // The link lasts 14 days after the last booked appointment.
    assert_eq!(sweep(visit_date + Duration::days(13)).await, 0);
    assert_eq!(link(&fx, interpreter).await, booking_link(true));
    assert_eq!(sweep(visit_date + Duration::days(14)).await, 1);
    assert_eq!(link(&fx, interpreter).await, booking_link(false));
    let ended = link_audit(&fx, interpreter).await.pop().unwrap();
    assert_eq!(ended.0, "end_booking_patient_access");
    assert_eq!(ended.1["reason"], "expired");
    assert_eq!(ended.1["cause"], "expiry_sweep");
    assert_eq!(ended.1["access_days"], 14);
    assert_eq!(ended.1["last_booking_date"], visit_date.to_string());
    // A manual assignment never expires, whatever the bookings say.
    assert_eq!(
        link(&fx, manual_interpreter).await,
        Some(("manual".to_string(), true))
    );

    // Admins change the window in the system settings.
    sqlx::query("UPDATE system_settings SET value = '30' WHERE key = $1")
        .bind(interpreter_booking_links::ACCESS_DAYS_SETTING)
        .execute(&fx.pool)
        .await
        .unwrap();
    let next_date = today() + Duration::days(2);
    book(&fx, interpreter, next_date, "Check-up").await;
    assert_eq!(link(&fx, interpreter).await, booking_link(true));
    assert_eq!(sweep(next_date + Duration::days(29)).await, 0);
    assert_eq!(sweep(next_date + Duration::days(30)).await, 1);
    assert_eq!(link(&fx, interpreter).await, booking_link(false));
    assert_eq!(
        link(&fx, manual_interpreter).await,
        Some(("manual".to_string(), true))
    );
}

#[tokio::test]
async fn manual_assignment_takes_over_a_booking_link() {
    let tag = format!("booking-link-manual-{}", Uuid::new_v4().simple());
    let Some(fx) = fixture(&tag).await else {
        return;
    };
    let interpreter = seed_user(&fx.pool, &tag, "interpreter").await;
    let visit = book(
        &fx,
        interpreter,
        today() + Duration::days(4),
        "Consultation",
    )
    .await;
    assert_eq!(link(&fx, interpreter).await, booking_link(true));

    let (status, body) = json_request(
        &fx.app,
        "POST",
        &format!("/api/v1/patients/{}/assign", fx.patient_id),
        &fx.pm,
        Some(json!({ "user_id": interpreter })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(
        link(&fx, interpreter).await,
        Some(("manual".to_string(), true))
    );

    let (status, body) = json_request(
        &fx.app,
        "POST",
        &format!("/api/v1/appointments/{visit}/status"),
        &fx.pm,
        Some(json!({ "status": "cancelled" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    interpreter_booking_links::end_expired_links(&fx.pool, today() + Duration::days(100))
        .await
        .unwrap();
    assert_eq!(
        link(&fx, interpreter).await,
        Some(("manual".to_string(), true))
    );
}

#[tokio::test]
async fn a_managers_revocation_is_not_undone_by_bookings() {
    let tag = format!("booking-link-revoked-{}", Uuid::new_v4().simple());
    let Some(fx) = fixture(&tag).await else {
        return;
    };
    let interpreter = seed_user(&fx.pool, &tag, "interpreter").await;
    let visit = book(
        &fx,
        interpreter,
        today() + Duration::days(4),
        "Consultation",
    )
    .await;
    assert_eq!(link(&fx, interpreter).await, booking_link(true));

    let (status, body) = json_request(
        &fx.app,
        "POST",
        &format!("/api/v1/patients/{}/revoke", fx.patient_id),
        &fx.pm,
        Some(json!({ "user_id": interpreter })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(link(&fx, interpreter).await, booking_link(false));

    // Neither the interpreter's response nor a new booking grants it back.
    let (status, body) = json_request(
        &fx.app,
        "POST",
        &format!("/api/v1/appointments/{visit}/interpreter-response"),
        &bearer(interpreter, "interpreter"),
        Some(json!({ "response": "accepted" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(link(&fx, interpreter).await, booking_link(false));
    book(&fx, interpreter, today() + Duration::days(9), "Follow-up").await;
    assert_eq!(link(&fx, interpreter).await, booking_link(false));
    assert_eq!(patient_card(&fx, interpreter).await, StatusCode::FORBIDDEN);

    // A manager's new assignment lifts it.
    let (status, body) = json_request(
        &fx.app,
        "POST",
        &format!("/api/v1/patients/{}/assign", fx.patient_id),
        &fx.pm,
        Some(json!({ "user_id": interpreter })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(
        link(&fx, interpreter).await,
        Some(("manual".to_string(), true))
    );
}

#[tokio::test]
async fn booked_visit_stays_workable_without_the_patient_link() {
    let tag = format!("booking-link-visit-{}", Uuid::new_v4().simple());
    let Some(fx) = fixture(&tag).await else {
        return;
    };
    let interpreter = seed_user(&fx.pool, &tag, "interpreter").await;
    let late_interpreter = seed_user(&fx.pool, &format!("{tag}-late"), "interpreter").await;
    let past_visit = seed_booked_visit(&fx, interpreter, today() - Duration::days(30)).await;
    assert_eq!(link(&fx, interpreter).await, None);
    assert_eq!(patient_card(&fx, interpreter).await, StatusCode::FORBIDDEN);

    // Being booked on the visit opens the visit and its report by itself.
    let interpreter_bearer = bearer(interpreter, "interpreter");
    let (status, body) = json_request(
        &fx.app,
        "GET",
        &format!("/api/v1/appointments/{past_visit}"),
        &interpreter_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let (status, body) = json_request(
        &fx.app,
        "POST",
        &format!("/api/v1/appointments/{past_visit}/report"),
        &interpreter_bearer,
        Some(json!({ "hours": 1.5, "report_text": "Synthetic report" })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{body}");

    // Booking an interpreter on a visit whose access days are over grants no
    // link at all.
    let other_past_visit = seed_booked_visit(&fx, interpreter, today() - Duration::days(20)).await;
    let (status, body) = json_request(
        &fx.app,
        "POST",
        &format!("/api/v1/appointments/{other_past_visit}/assign-interpreter"),
        &fx.pm,
        Some(json!({ "interpreter_id": late_interpreter })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(link(&fx, late_interpreter).await, None);
}

/// The backfill statement of the migration, re-run on synthetic history.
fn backfill_sql() -> &'static str {
    let migration =
        include_str!("../../../migrations/20260928100000_interpreter_booking_patient_links.sql");
    let start = migration
        .find("WITH audit_horizon")
        .expect("backfill statement");
    &migration[start..]
}

#[tokio::test]
async fn backfill_marks_only_links_a_booking_unambiguously_granted() {
    let tag = format!("booking-link-backfill-{}", Uuid::new_v4().simple());
    let Some(fx) = fixture(&tag).await else {
        return;
    };
    let pool = &fx.pool;
    // The audit trail reaches back before the patient existed.
    sqlx::query(
        r#"INSERT INTO audit_log (user_id, action, entity_type, created_at)
           VALUES (NULL, 'backfill_test_horizon', 'test', now() - interval '400 days')"#,
    )
    .execute(pool)
    .await
    .unwrap();
    sqlx::query("UPDATE patients SET created_at = now() - interval '300 days' WHERE id = $1")
        .bind(fx.patient_id)
        .execute(pool)
        .await
        .unwrap();

    let granted_at = chrono::Utc::now() - Duration::days(200);
    let insert_link =
        |user_id: Uuid, assigned_by: Uuid, assigned_at: chrono::DateTime<chrono::Utc>| {
            let pool = pool.clone();
            let patient_id = fx.patient_id;
            async move {
                sqlx::query(
                r#"INSERT INTO patient_assignments (patient_id, user_id, assigned_by, assigned_at)
                   VALUES ($1, $2, $3, $4)"#,
            )
            .bind(patient_id)
            .bind(user_id)
            .bind(assigned_by)
            .bind(assigned_at)
            .execute(&pool)
            .await
            .unwrap();
            }
        };
    let booked_at = |interpreter_id: Uuid, created_at: chrono::DateTime<chrono::Utc>, day: i64| {
        let pool = pool.clone();
        let (patient_id, provider_id, doctor_id, pm_id) =
            (fx.patient_id, fx.provider_id, fx.doctor_id, fx.pm_id);
        async move {
            sqlx::query_scalar::<_, Uuid>(
                r#"INSERT INTO appointments (
                        patient_id, provider_id, doctor_id, interpreter_id, appointment_type,
                        title, date, status, created_by, created_at
                   ) VALUES ($1, $2, $3, $4, 'medical', 'Historic visit', $5, 'completed', $6, $7)
                   RETURNING id"#,
            )
            .bind(patient_id)
            .bind(provider_id)
            .bind(doctor_id)
            .bind(interpreter_id)
            .bind(created_at.date_naive() + Duration::days(day))
            .bind(pm_id)
            .bind(created_at)
            .fetch_one(&pool)
            .await
            .unwrap()
        }
    };

    // Created with the interpreter and linked by the same manager right away.
    let booked = seed_user(pool, &format!("{tag}-a"), "interpreter").await;
    booked_at(booked, granted_at, 7).await;
    insert_link(booked, fx.pm_id, granted_at + Duration::seconds(1)).await;

    // Assigned to an existing visit: the booking audit event is the evidence.
    let reassigned = seed_user(pool, &format!("{tag}-b"), "interpreter").await;
    let visit = booked_at(reassigned, granted_at - Duration::days(3), 15).await;
    let reassigned_at = granted_at + Duration::hours(2);
    sqlx::query(
        r#"INSERT INTO audit_log (user_id, action, entity_type, entity_id, context, created_at)
           VALUES ($1, 'assign_interpreter', 'appointment', $2, $3, $4)"#,
    )
    .bind(fx.pm_id)
    .bind(visit)
    .bind(json!({ "interpreter_id": reassigned }))
    .bind(reassigned_at + Duration::seconds(2))
    .execute(pool)
    .await
    .unwrap();
    insert_link(reassigned, fx.pm_id, reassigned_at).await;

    // Booked, but a manager also assigned them by hand: stays manual.
    let also_manual = seed_user(pool, &format!("{tag}-c"), "interpreter").await;
    booked_at(also_manual, granted_at, 8).await;
    insert_link(also_manual, fx.pm_id, granted_at + Duration::seconds(1)).await;
    sqlx::query(
        r#"INSERT INTO audit_log (user_id, action, entity_type, entity_id, context, created_at)
           VALUES ($1, 'assign_patient', 'patient', $2, $3, $4)"#,
    )
    .bind(fx.pm_id)
    .bind(fx.patient_id)
    .bind(json!({ "assigned_to": also_manual, "assigned_role": "interpreter" }))
    .bind(granted_at - Duration::days(10))
    .execute(pool)
    .await
    .unwrap();

    // Booked, but the link was granted at another time by someone else.
    let unrelated = seed_user(pool, &format!("{tag}-d"), "interpreter").await;
    booked_at(unrelated, granted_at, 9).await;
    insert_link(unrelated, fx.pm_id, granted_at + Duration::days(1)).await;

    sqlx::query(backfill_sql()).execute(pool).await.unwrap();

    for (user_id, expected) in [
        (booked, "interpreter_booking"),
        (reassigned, "interpreter_booking"),
        (also_manual, "manual"),
        (unrelated, "manual"),
        (fx.pm_id, "manual"),
    ] {
        assert_eq!(
            link(&fx, user_id).await,
            Some((expected.to_string(), true)),
            "{user_id}"
        );
    }
    let marked: Vec<String> = sqlx::query_scalar(
        r#"SELECT context ->> 'user_id'
           FROM audit_log
           WHERE action = 'mark_booking_patient_access' AND entity_id = $1
           ORDER BY context ->> 'user_id'"#,
    )
    .bind(fx.patient_id)
    .fetch_all(pool)
    .await
    .unwrap();
    let mut expected = vec![booked.to_string(), reassigned.to_string()];
    expected.sort();
    assert_eq!(marked, expected);

    // The history is kept; the sweep then ends what no booking keeps alive.
    assert_eq!(
        interpreter_booking_links::end_expired_links(pool, today())
            .await
            .unwrap(),
        2
    );
    assert_eq!(link(&fx, booked).await, booking_link(false));
}

#[tokio::test]
async fn backfill_leaves_links_manual_when_the_audit_trail_is_incomplete() {
    let tag = format!("booking-link-horizon-{}", Uuid::new_v4().simple());
    let Some(fx) = fixture(&tag).await else {
        return;
    };
    let pool = &fx.pool;
    // The oldest retained audit event is younger than the patient: a manual
    // assignment could have been purged, so nothing is marked.
    sqlx::query("UPDATE patients SET created_at = now() - interval '900 days' WHERE id = $1")
        .bind(fx.patient_id)
        .execute(pool)
        .await
        .unwrap();
    let interpreter = seed_user(pool, &tag, "interpreter").await;
    let created_at = chrono::Utc::now() - Duration::days(30);
    sqlx::query(
        r#"INSERT INTO appointments (
                patient_id, provider_id, doctor_id, interpreter_id, appointment_type,
                title, date, status, created_by, created_at
           ) VALUES ($1, $2, $3, $4, 'medical', 'Historic visit', $5, 'completed', $6, $7)"#,
    )
    .bind(fx.patient_id)
    .bind(fx.provider_id)
    .bind(fx.doctor_id)
    .bind(interpreter)
    .bind(created_at.date_naive())
    .bind(fx.pm_id)
    .bind(created_at)
    .execute(pool)
    .await
    .unwrap();
    sqlx::query(
        r#"INSERT INTO patient_assignments (patient_id, user_id, assigned_by, assigned_at)
           VALUES ($1, $2, $3, $4)"#,
    )
    .bind(fx.patient_id)
    .bind(interpreter)
    .bind(fx.pm_id)
    .bind(created_at)
    .execute(pool)
    .await
    .unwrap();

    sqlx::query(backfill_sql()).execute(pool).await.unwrap();
    assert_eq!(
        link(&fx, interpreter).await,
        Some(("manual".to_string(), true))
    );
}

/// Reported hours of a report payload (a decimal string).
fn hours_of(report: &Value) -> f64 {
    report["hours"]
        .as_str()
        .expect("report hours")
        .parse()
        .expect("decimal hours")
}

/// QA C-13: taken off a visit, the interpreter keeps reading the reports it
/// wrote there (hours, visit date and time, the decision and its reason, its
/// own text), read-only; the visit card and the patient follow the booking.
#[tokio::test]
async fn unbooked_interpreter_keeps_reading_its_own_reports_read_only() {
    let tag = format!("booking-link-own-report-{}", Uuid::new_v4().simple());
    let Some(fx) = fixture(&tag).await else {
        return;
    };
    let interpreter = seed_user(&fx.pool, &tag, "interpreter").await;
    let teamlead = seed_user(&fx.pool, &format!("{tag}-tl"), "teamlead_interpreter").await;
    let interpreter_bearer = bearer(interpreter, "interpreter");
    let teamlead_bearer = bearer(teamlead, "teamlead_interpreter");

    let visit_date = today();
    let visit = book(&fx, interpreter, visit_date, "Cardiology consultation").await;
    sqlx::query("UPDATE appointments SET status = 'confirmed' WHERE id = $1")
        .bind(visit)
        .execute(&fx.pool)
        .await
        .unwrap();
    assert_eq!(patient_card(&fx, interpreter).await, StatusCode::OK);

    // First report returned with a reason, the second one approved.
    let report_path = format!("/api/v1/appointments/{visit}/report");
    let (status, body) = json_request(
        &fx.app,
        "POST",
        &report_path,
        &interpreter_bearer,
        Some(json!({ "hours": 1.5, "report_text": "Synthetic first report" })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    let (status, body) = json_request(
        &fx.app,
        "POST",
        &format!("/api/v1/appointments/{visit}/report/reject"),
        &teamlead_bearer,
        Some(json!({ "notes": "Please correct the hours" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let (status, body) = json_request(
        &fx.app,
        "POST",
        &report_path,
        &interpreter_bearer,
        Some(json!({ "hours": 1.25, "report_text": "Synthetic corrected report" })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    let approved_report_id = body["id"].as_str().unwrap().to_string();
    let (status, body) = json_request(
        &fx.app,
        "POST",
        &format!("/api/v1/appointments/{visit}/report/approve"),
        &teamlead_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");

    // The manager takes the interpreter off the visit.
    let (status, body) = json_request(
        &fx.app,
        "POST",
        &format!("/api/v1/appointments/{visit}/update"),
        &fx.pm,
        Some(json!({
            "provider_id": fx.provider_id,
            "doctor_id": fx.doctor_id,
            "owner_user_id": fx.pm_id,
            "interpreter_id": Value::Null,
            "title": "Cardiology consultation",
            "date": visit_date.to_string(),
            "time_start": "09:00",
            "time_end": "10:00"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");

    // The visit card and the patient are closed to the interpreter now.
    let (status, body) = json_request(
        &fx.app,
        "GET",
        &format!("/api/v1/appointments/{visit}"),
        &interpreter_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN, "{body}");
    assert_eq!(patient_card(&fx, interpreter).await, StatusCode::FORBIDDEN);

    // Its own latest report stays readable, read-only, without visit details.
    let (status, report) =
        json_request(&fx.app, "GET", &report_path, &interpreter_bearer, None).await;
    assert_eq!(status, StatusCode::OK, "{report}");
    assert_eq!(report["id"], approved_report_id.as_str());
    assert!((hours_of(&report) - 1.25).abs() < 1e-9, "{report}");
    assert_eq!(report["approval_status"], "approved");
    assert_eq!(report["report_text"], "Synthetic corrected report");
    assert_eq!(report["appointment_date"], visit_date.to_string());
    assert_eq!(report["appointment_time_start"], "09:00");
    assert_eq!(report["appointment_time_end"], "10:00");
    assert_eq!(report["read_only"], true);
    assert_eq!(report["appointment_access"], false);
    let payload = report.to_string();
    assert!(!payload.contains("Cardiology consultation"), "{payload}");
    assert!(!payload.contains(&format!("Patient {tag}")), "{payload}");

    // Both reports stay in its list, the returned one with the reason.
    let (status, list) = json_request(
        &fx.app,
        "GET",
        "/api/v1/appointments/my-reports",
        &interpreter_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{list}");
    let reports = list.as_array().expect("own reports");
    assert_eq!(reports.len(), 2, "{list}");
    assert!(
        reports
            .iter()
            .all(|item| item["appointment_id"] == visit.to_string()
                && item["appointment_access"] == false)
    );
    let returned = reports
        .iter()
        .find(|item| item["approval_status"] == "rejected")
        .expect("returned report");
    assert_eq!(returned["notes"], "Please correct the hours");
    assert!((hours_of(returned) - 1.5).abs() < 1e-9, "{list}");
    assert!(!list.to_string().contains(&format!("Patient {tag}")), "{list}");

    // The report cannot be changed without the booking.
    let (status, body) = json_request(
        &fx.app,
        "POST",
        &report_path,
        &interpreter_bearer,
        Some(json!({ "hours": 2.0, "report_text": "Late change" })),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN, "{body}");

    // Its KPI still counts the approved hours.
    let (status, kpis) =
        json_request(&fx.app, "GET", "/api/v1/stats/my-kpis", &interpreter_bearer, None).await;
    assert_eq!(status, StatusCode::OK, "{kpis}");
    let approved_hours: f64 = kpis["kpi"]["approved_hours_30d"]
        .as_str()
        .expect("approved hours")
        .parse()
        .unwrap();
    assert!((approved_hours - 1.25).abs() < f64::EPSILON, "{kpis}");

    // The team lead and the manager read the report as before.
    for reader in [&teamlead_bearer, &fx.pm] {
        let (status, report) = json_request(&fx.app, "GET", &report_path, reader, None).await;
        assert_eq!(status, StatusCode::OK, "{report}");
        assert_eq!(report["id"], approved_report_id.as_str());
        assert_eq!(report["interpreter_id"], interpreter.to_string());
        assert!(report.get("read_only").is_none(), "{report}");
    }

    // Another interpreter never reads it.
    let stranger = seed_user(&fx.pool, &format!("{tag}-other"), "interpreter").await;
    let (status, body) =
        json_request(&fx.app, "GET", &report_path, &bearer(stranger, "interpreter"), None).await;
    assert_eq!(status, StatusCode::FORBIDDEN, "{body}");
    let (status, list) = json_request(
        &fx.app,
        "GET",
        "/api/v1/appointments/my-reports",
        &bearer(stranger, "interpreter"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{list}");
    assert!(list.as_array().expect("own reports").is_empty(), "{list}");
}
