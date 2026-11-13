//! Several visits of an order created in one action from the planning grid
//! (planning stage 6) and the busy time the grid shows. Synthetic data only.

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
    .bind(format!("A-GRID-{tag}"))
    .bind(patient_id)
    .bind(created_by)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn seed_provider(pool: &PgPool, tag: &str) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO providers (name, provider_type, address_city, fachbereich, address_country)
           VALUES ($1, 'medical', 'Berlin', 'Kardiologie', 'Germany')
           RETURNING id"#,
    )
    .bind(format!("Clinic {tag}"))
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn seed_doctor(pool: &PgPool, provider_id: Uuid, tag: &str) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO provider_doctors (provider_id, name, fachbereich)
           VALUES ($1, $2, 'Kardiologie')
           RETURNING id"#,
    )
    .bind(provider_id)
    .bind(format!("Doctor {tag}"))
    .fetch_one(pool)
    .await
    .unwrap()
}

struct Fixture {
    app: axum::Router,
    pool: PgPool,
    tag: String,
    patient_id: Uuid,
    order_id: Uuid,
    pm_id: Uuid,
    pm: String,
    provider_id: Uuid,
    doctor_a: Uuid,
    doctor_b: Uuid,
}

async fn fixture() -> Option<Fixture> {
    let tag = format!("grid-{}", Uuid::new_v4().simple());
    let ctx = support::suite_context(TEST_SECRET).await?;
    let pool = ctx.pool.clone();
    let patient_id = seed_patient(&pool, &tag, ctx.admin_id).await;
    let pm_id = seed_user(&pool, &tag, "patient_manager").await;
    sqlx::query(
        "INSERT INTO patient_assignments (patient_id, user_id, assigned_by) VALUES ($1, $2, $3)",
    )
    .bind(patient_id)
    .bind(pm_id)
    .bind(ctx.admin_id)
    .execute(&pool)
    .await
    .unwrap();
    let order_id = seed_order(&pool, &tag, patient_id, pm_id).await;
    let provider_id = seed_provider(&pool, &tag).await;
    let doctor_a = seed_doctor(&pool, provider_id, &format!("{tag}-a")).await;
    let doctor_b = seed_doctor(&pool, provider_id, &format!("{tag}-b")).await;
    Some(Fixture {
        app: ctx.app,
        pool,
        tag,
        patient_id,
        order_id,
        pm_id,
        pm: bearer(pm_id, "patient_manager"),
        provider_id,
        doctor_a,
        doctor_b,
    })
}

fn day(offset: i64) -> NaiveDate {
    gmed_server::app_time::today() + Duration::days(offset)
}

fn visit(fx: &Fixture, doctor: Uuid, date: NaiveDate, start: &str, end: &str) -> Value {
    json!({
        "provider_id": fx.provider_id,
        "doctor_id": doctor,
        "title": format!("Visit {start}"),
        "date": date.to_string(),
        "time_start": start,
        "time_end": end,
    })
}

async fn post_batch(
    fx: &Fixture,
    bearer: &str,
    dry_run: bool,
    items: Vec<Value>,
) -> (StatusCode, Value) {
    json_request(
        &fx.app,
        "POST",
        &format!("/api/v1/orders/{}/appointments/batch", fx.order_id),
        bearer,
        Some(json!({ "dry_run": dry_run, "items": items })),
    )
    .await
}

async fn order_visit_count(fx: &Fixture) -> i64 {
    sqlx::query_scalar("SELECT COUNT(*) FROM appointments WHERE order_id = $1")
        .bind(fx.order_id)
        .fetch_one(&fx.pool)
        .await
        .unwrap()
}

/// A visit of another patient with the given doctor.
async fn seed_foreign_booking(fx: &Fixture, doctor: Uuid, date: NaiveDate, start: &str, end: &str) {
    let other = seed_patient(&fx.pool, &format!("{}-other-{start}", fx.tag), fx.pm_id).await;
    sqlx::query(
        r#"INSERT INTO appointments (patient_id, provider_id, doctor_id, appointment_type, title,
                date, time_start, time_end, status, created_by)
           VALUES ($1, $2, $3, 'medical', 'Secret foreign title', $4, $5::time, $6::time, 'confirmed', $7)"#,
    )
    .bind(other)
    .bind(fx.provider_id)
    .bind(doctor)
    .bind(date)
    .bind(start)
    .bind(end)
    .bind(fx.pm_id)
    .execute(&fx.pool)
    .await
    .unwrap();
}

fn failure_codes(body: &Value) -> Vec<(u64, String)> {
    let mut codes: Vec<(u64, String)> = body["failures"]
        .as_array()
        .unwrap_or_else(|| panic!("failures missing: {body}"))
        .iter()
        .map(|item| {
            (
                item["index"].as_u64().unwrap(),
                item["code"].as_str().unwrap().to_string(),
            )
        })
        .collect();
    codes.sort();
    codes
}

#[tokio::test]
async fn dry_run_lists_batch_and_existing_conflicts_and_writes_nothing() {
    let Some(fx) = fixture().await else {
        return;
    };
    seed_foreign_booking(&fx, fx.doctor_b, day(10), "14:00", "15:00").await;
    let items = vec![
        visit(&fx, fx.doctor_a, day(10), "09:00", "10:00"),
        // The patient cannot be at two doctors at 09:30.
        visit(&fx, fx.doctor_b, day(10), "09:30", "10:30"),
        // Doctor B sees another patient at 14:00.
        visit(&fx, fx.doctor_b, day(10), "14:30", "15:00"),
    ];

    let (status, body) = post_batch(&fx, &fx.pm, true, items.clone()).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["ok"], false);
    assert_eq!(
        failure_codes(&body),
        vec![
            (0, "batch_overlap".to_string()),
            (1, "batch_overlap".to_string())
        ]
    );
    assert_eq!(body["failures"][0]["scopes"], json!(["patient"]));

    // Without the in-batch overlap the existing booking is reported.
    let (status, body) =
        post_batch(&fx, &fx.pm, true, vec![items[0].clone(), items[2].clone()]).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(failure_codes(&body), vec![(1, "conflict".to_string())]);
    assert_eq!(body["failures"][0]["conflicts"]["doctor_conflict_count"], 1);
    assert_eq!(order_visit_count(&fx).await, 0);

    // A real run is refused the same way, all or nothing.
    let (status, body) =
        post_batch(&fx, &fx.pm, false, vec![items[0].clone(), items[2].clone()]).await;
    assert_eq!(status, StatusCode::CONFLICT, "{body}");
    assert_eq!(order_visit_count(&fx).await, 0);

    // A clean plan passes the dry run and still writes nothing.
    let (status, body) = post_batch(&fx, &fx.pm, true, vec![items[0].clone()]).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["ok"], true);
    assert_eq!(order_visit_count(&fx).await, 0);
}

#[tokio::test]
async fn batch_creates_unreleased_visits_with_audit_and_one_interpreter_notice() {
    let Some(fx) = fixture().await else {
        return;
    };
    let interpreter = seed_user(&fx.pool, &fx.tag, "interpreter").await;
    let mut first = visit(&fx, fx.doctor_a, day(11), "09:00", "10:00");
    first["interpreter_id"] = json!(interpreter);
    let mut second = visit(&fx, fx.doctor_b, day(11), "11:00", "11:30");
    second["interpreter_id"] = json!(interpreter);
    let mut third = visit(&fx, fx.doctor_a, day(12), "08:00", "09:00");
    third["interpreter_needed"] = json!(false);

    let (status, body) = post_batch(&fx, &fx.pm, false, vec![first, second, third]).await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    let ids: Vec<Uuid> = body["created"]
        .as_array()
        .unwrap()
        .iter()
        .map(|item| Uuid::parse_str(item["id"].as_str().unwrap()).unwrap())
        .collect();
    assert_eq!(ids.len(), 3);

    type CreatedRow = (
        Option<chrono::DateTime<chrono::Utc>>,
        Option<Uuid>,
        Option<bool>,
        Option<String>,
        String,
    );
    let rows: Vec<CreatedRow> =
        sqlx::query_as(
            r#"SELECT portal_released_at, interpreter_id, interpreter_needed, interpreter_response, appointment_type
               FROM appointments WHERE id = ANY($1) ORDER BY date, time_start"#,
        )
        .bind(&ids)
        .fetch_all(&fx.pool)
        .await
        .unwrap();
    // The plan waits for its release to the portal.
    assert!(rows.iter().all(|row| row.0.is_none() && row.4 == "medical"));
    assert_eq!(rows[0].1, Some(interpreter));
    assert_eq!(rows[0].2, Some(true));
    assert_eq!(rows[0].3.as_deref(), Some("pending"));
    assert_eq!(rows[2].1, None);
    assert_eq!(rows[2].2, Some(false));

    let audit_rows: i64 = sqlx::query_scalar(
        r#"SELECT COUNT(*) FROM audit_log
           WHERE action = 'create_appointment' AND entity_type = 'appointment'
             AND entity_id = ANY($1) AND context ->> 'batch' = 'true'"#,
    )
    .bind(&ids)
    .fetch_one(&fx.pool)
    .await
    .unwrap();
    assert_eq!(audit_rows, 3);

    let notices: Vec<String> = sqlx::query_scalar(
        r#"SELECT body FROM user_notifications
           WHERE user_id = $1 AND kind = 'interpreter_booking_assigned'"#,
    )
    .bind(interpreter)
    .fetch_all(&fx.pool)
    .await
    .unwrap();
    assert_eq!(notices.len(), 1, "{notices:?}");
    let notice: Value = serde_json::from_str(&notices[0]).unwrap();
    assert_eq!(notice["batch_count"], 2);
}

#[tokio::test]
async fn busy_time_hides_other_patients_and_only_planners_may_batch() {
    let Some(fx) = fixture().await else {
        return;
    };
    seed_foreign_booking(&fx, fx.doctor_a, day(13), "10:00", "11:00").await;
    let (status, body) = post_batch(
        &fx,
        &fx.pm,
        false,
        vec![visit(&fx, fx.doctor_b, day(13), "08:00", "09:00")],
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{body}");

    let (status, body) = json_request(
        &fx.app,
        "GET",
        &format!(
            "/api/v1/orders/{}/appointments/busy?from={}&to={}&doctor_ids={}",
            fx.order_id,
            day(13),
            day(14),
            fx.doctor_a
        ),
        &fx.pm,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let items = body["items"].as_array().unwrap();
    assert_eq!(items.len(), 2, "{body}");
    assert_eq!(items[0]["scopes"], json!(["patient"]));
    assert_eq!(items[0]["title"], "Visit 08:00");
    assert_eq!(items[0]["same_order"], true);
    assert_eq!(items[1]["scopes"], json!(["doctor"]));
    assert!(items[1]["title"].is_null(), "{body}");
    assert!(items[1]["id"].is_null(), "{body}");
    assert!(!body.to_string().contains("Secret foreign title"));

    // An interpreter cannot plan; a PM without the patient cannot either.
    let interpreter = seed_user(&fx.pool, &fx.tag, "interpreter").await;
    let (status, _) = post_batch(
        &fx,
        &bearer(interpreter, "interpreter"),
        true,
        vec![visit(&fx, fx.doctor_b, day(14), "08:00", "09:00")],
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let stranger = seed_user(&fx.pool, &format!("{}-x", fx.tag), "patient_manager").await;
    let (status, _) = post_batch(
        &fx,
        &bearer(stranger, "patient_manager"),
        true,
        vec![visit(&fx, fx.doctor_b, day(14), "08:00", "09:00")],
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let _ = fx.patient_id;
}

#[tokio::test]
async fn invalid_items_are_listed_by_index() {
    let Some(fx) = fixture().await else {
        return;
    };
    let other_provider = seed_provider(&fx.pool, &format!("{}-p2", fx.tag)).await;
    let mut wrong_doctor = visit(&fx, fx.doctor_a, day(15), "09:00", "10:00");
    wrong_doctor["provider_id"] = json!(other_provider);
    let inverted = visit(&fx, fx.doctor_b, day(15), "12:00", "11:00");
    let no_title = json!({
        "provider_id": fx.provider_id,
        "title": " ",
        "date": day(15).to_string(),
        "time_start": "13:00",
        "time_end": "14:00",
    });
    let (status, body) =
        post_batch(&fx, &fx.pm, false, vec![wrong_doctor, inverted, no_title]).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
    assert_eq!(
        failure_codes(&body),
        vec![
            (0, "invalid".to_string()),
            (1, "invalid".to_string()),
            (2, "invalid".to_string())
        ]
    );
    assert_eq!(order_visit_count(&fx).await, 0);
}
