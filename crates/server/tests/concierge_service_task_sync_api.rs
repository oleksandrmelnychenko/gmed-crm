//! Owner decision 2026-09-28: the concierge task is the single source of truth
//! of a concierge service (Q1), billing moves forward only and billed amounts
//! are locked (Q3), appointment cancellation keeps staff services and partner
//! bookings (Q4), and portal requests are authored by staff (Q15).
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
    .bind(format!("sync-{role}-{tag}@example.test"))
    .bind(format!("Sync {role} {tag}"))
    .bind(role)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn seed_patient(pool: &PgPool, created_by: Uuid, tag: &str) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO patients (
               patient_id, first_name, last_name, birth_date, gender, created_by
           ) VALUES ($1, 'Sync', 'Patient', '1990-01-01', 'diverse', $2)
           RETURNING id"#,
    )
    .bind(format!("SYNC-{tag}"))
    .bind(created_by)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn assign(pool: &PgPool, patient_id: Uuid, user_id: Uuid, assigned_by: Uuid) {
    sqlx::query(
        r#"INSERT INTO patient_assignments (patient_id, user_id, assigned_by)
           VALUES ($1, $2, $3)"#,
    )
    .bind(patient_id)
    .bind(user_id)
    .bind(assigned_by)
    .execute(pool)
    .await
    .unwrap();
}

async fn seed_provider(pool: &PgPool, tag: &str) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO providers (
               name, provider_type, address_street, address_city, address_country, phone
           ) VALUES ($1, 'non_medical', 'Hauptstraße 1', 'München', 'Deutschland', '+49 89 1')
           RETURNING id"#,
    )
    .bind(format!("Sync Partner {tag}"))
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn seed_doctor(pool: &PgPool, provider_id: Uuid, tag: &str) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO provider_doctors (provider_id, name, fachbereich)
           VALUES ($1, $2, 'Fach')
           RETURNING id"#,
    )
    .bind(provider_id)
    .bind(format!("Doctor {tag}"))
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn service_state(pool: &PgPool, service_id: Uuid) -> (String, String) {
    sqlx::query_as("SELECT status, billing_status FROM concierge_services WHERE id = $1")
        .bind(service_id)
        .fetch_one(pool)
        .await
        .unwrap()
}

async fn task_of(pool: &PgPool, service_id: Uuid) -> (Uuid, String, String) {
    sqlx::query_as(
        r#"SELECT id, status, to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
           FROM tasks
           WHERE id = concierge_service_canonical_task_id($1)"#,
    )
    .bind(service_id)
    .fetch_one(pool)
    .await
    .unwrap()
}

struct Fixture {
    pm_id: Uuid,
    concierge_id: Uuid,
    patient_id: Uuid,
    provider_id: Uuid,
}

async fn fixture(pool: &PgPool, admin_id: Uuid, tag: &str) -> Fixture {
    let pm_id = seed_user(pool, "patient_manager", tag).await;
    let concierge_id = seed_user(pool, "concierge", tag).await;
    let patient_id = seed_patient(pool, admin_id, tag).await;
    assign(pool, patient_id, pm_id, admin_id).await;
    assign(pool, patient_id, concierge_id, admin_id).await;
    let provider_id = seed_provider(pool, tag).await;
    Fixture {
        pm_id,
        concierge_id,
        patient_id,
        provider_id,
    }
}

async fn create_staff_service(
    app: &axum::Router,
    fx: &Fixture,
    appointment_id: Option<Uuid>,
) -> Uuid {
    let (status, body) = json_request(
        app,
        "POST",
        "/api/v1/concierge-services",
        &auth_header_for(fx.pm_id, "patient_manager"),
        Some(json!({
            "patient_id": fx.patient_id,
            "appointment_id": appointment_id,
            "assigned_concierge_id": fx.concierge_id,
            "service_kind": "transfer",
            "title": "Airport transfer",
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    Uuid::parse_str(body["id"].as_str().unwrap()).unwrap()
}

async fn update_service(
    app: &axum::Router,
    bearer: &str,
    service_id: Uuid,
    body: Value,
) -> (StatusCode, Value) {
    json_request(
        app,
        "POST",
        &format!("/api/v1/concierge-services/{service_id}/update"),
        bearer,
        Some(body),
    )
    .await
}

async fn move_task(
    app: &axum::Router,
    pool: &PgPool,
    bearer: &str,
    service_id: Uuid,
    status: &str,
) -> (StatusCode, Value) {
    let (task_id, _, updated_at) = task_of(pool, service_id).await;
    json_request(
        app,
        "POST",
        &format!("/api/v1/concierge-operational-items/{task_id}/status"),
        bearer,
        Some(json!({ "status": status, "expected_updated_at": updated_at })),
    )
    .await
}

#[tokio::test]
async fn the_service_follows_its_task_and_stays_in_the_workspace() {
    let Some(ctx) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let tag = Uuid::new_v4().simple().to_string();
    let fx = fixture(&ctx.pool, ctx.admin_id, &tag).await;
    let pm = auth_header_for(fx.pm_id, "patient_manager");
    let concierge = auth_header_for(fx.concierge_id, "concierge");
    let service_id = create_staff_service(&ctx.app, &fx, None).await;

    // The assignee starts the service: the task is created and started.
    let (status, body) = update_service(
        &ctx.app,
        &concierge,
        service_id,
        json!({ "status": "in_service" }),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["status"], "in_service");
    assert_eq!(body["linked_task_status"], "in_progress");
    assert_eq!(body["allowed_statuses"], json!(["in_service"]));
    let (_, task_status, _) = task_of(&ctx.pool, service_id).await;
    assert_eq!(task_status, "in_progress");

    // Only the task's author completes it (work-center rules).
    let (status, body) = update_service(
        &ctx.app,
        &concierge,
        service_id,
        json!({ "status": "completed" }),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN, "{body}");
    assert_eq!(body["code"], "concierge_service_task_author");

    // Completing the task in the work center completes the service and hands
    // it to billing; the service stays in the concierge workspace.
    let (status, body) = move_task(&ctx.app, &ctx.pool, &pm, service_id, "completed").await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(
        service_state(&ctx.pool, service_id).await,
        ("completed".to_string(), "ready".to_string())
    );
    let (status, list) = json_request(
        &ctx.app,
        "GET",
        "/api/v1/concierge-services?mine_only=true",
        &concierge,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{list}");
    let listed = list
        .as_array()
        .unwrap()
        .iter()
        .find(|row| row["id"] == service_id.to_string())
        .expect("converted service stays listed");
    assert_eq!(listed["linked_task_status"], "completed");
    let derived_audit: i64 = sqlx::query_scalar(
        r#"SELECT COUNT(*) FROM audit_log
           WHERE action = 'derive_concierge_service_from_task'
             AND entity_id = $1 AND user_id = $2"#,
    )
    .bind(service_id)
    .bind(fx.pm_id)
    .fetch_one(&ctx.pool)
    .await
    .unwrap();
    assert!(derived_audit >= 1);

    // Reopening the task reopens the service; readiness goes back to draft.
    let (status, body) = move_task(&ctx.app, &ctx.pool, &pm, service_id, "in_progress").await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(
        service_state(&ctx.pool, service_id).await,
        ("in_service".to_string(), "draft".to_string())
    );

    // Cancelling the service on its surface cancels the task and waives it.
    let (status, body) =
        update_service(&ctx.app, &pm, service_id, json!({ "status": "cancelled" })).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["billing_status"], "waived");
    let (_, task_status, _) = task_of(&ctx.pool, service_id).await;
    assert_eq!(task_status, "cancelled");

    // A service status that contradicts its task is refused by the database.
    let contradiction =
        sqlx::query("UPDATE concierge_services SET status = 'planned' WHERE id = $1")
            .bind(service_id)
            .execute(&ctx.pool)
            .await;
    assert!(contradiction.is_err());
}

#[tokio::test]
async fn billing_moves_forward_and_billed_services_are_locked() {
    let Some(ctx) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let tag = Uuid::new_v4().simple().to_string();
    let fx = fixture(&ctx.pool, ctx.admin_id, &tag).await;
    let billing_id = seed_user(&ctx.pool, "billing", &tag).await;
    let pm = auth_header_for(fx.pm_id, "patient_manager");
    let billing = auth_header_for(billing_id, "billing");
    let service_id = create_staff_service(&ctx.app, &fx, None).await;

    // Readiness follows the task.
    let (status, body) = update_service(
        &ctx.app,
        &billing,
        service_id,
        json!({ "billing_status": "ready" }),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{body}");

    for next in ["in_service", "completed"] {
        let (status, body) =
            update_service(&ctx.app, &pm, service_id, json!({ "status": next })).await;
        assert_eq!(status, StatusCode::OK, "{next}: {body}");
    }
    assert_eq!(service_state(&ctx.pool, service_id).await.1, "ready");

    let (status, body) = update_service(
        &ctx.app,
        &billing,
        service_id,
        json!({ "billing_status": "billed", "actual_cost": 120.0 }),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["billing_status"], "billed");
    assert_eq!(body["financial_locked"], true);
    assert_eq!(
        body["allowed_billing_statuses"],
        json!(["billed", "settled"])
    );

    // Amounts are locked; resending them unchanged is fine.
    let (status, body) = update_service(
        &ctx.app,
        &billing,
        service_id,
        json!({ "actual_cost": 99.0 }),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{body}");
    assert_eq!(body["code"], "concierge_service_amounts_locked");
    let (status, body) = update_service(
        &ctx.app,
        &billing,
        service_id,
        json!({ "actual_cost": 120.0 }),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");

    // No way back from billed; waived only from draft or ready.
    for next in ["draft", "ready", "waived"] {
        let (status, body) = update_service(
            &ctx.app,
            &billing,
            service_id,
            json!({ "billing_status": next }),
        )
        .await;
        assert_eq!(status, StatusCode::CONFLICT, "{next}: {body}");
    }

    // A billed service is not cancelled, neither on the service nor its task.
    let (status, body) = move_task(&ctx.app, &ctx.pool, &pm, service_id, "in_progress").await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(service_state(&ctx.pool, service_id).await.1, "billed");
    let (status, body) =
        update_service(&ctx.app, &pm, service_id, json!({ "status": "cancelled" })).await;
    assert_eq!(status, StatusCode::CONFLICT, "{body}");
    assert_eq!(body["code"], "concierge_service_billed");
    let (status, body) = move_task(&ctx.app, &ctx.pool, &pm, service_id, "cancelled").await;
    assert_eq!(status, StatusCode::CONFLICT, "{body}");
    assert_eq!(body["code"], "concierge_service_billed");

    let (status, body) = update_service(
        &ctx.app,
        &billing,
        service_id,
        json!({ "billing_status": "settled" }),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["billing_status"], "settled");
}

#[tokio::test]
async fn appointment_cancellation_keeps_staff_services_and_partner_bookings() {
    let Some(ctx) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let tag = Uuid::new_v4().simple().to_string();
    let fx = fixture(&ctx.pool, ctx.admin_id, &tag).await;
    let doctor_id = seed_doctor(&ctx.pool, fx.provider_id, &tag).await;
    let pm = auth_header_for(fx.pm_id, "patient_manager");
    let concierge = auth_header_for(fx.concierge_id, "concierge");

    let mut appointment_ids = Vec::new();
    for day in ["2027-03-10", "2027-03-11"] {
        let (status, body) = json_request(
            &ctx.app,
            "POST",
            "/api/v1/appointments",
            &pm,
            Some(json!({
                "patient_id": fx.patient_id,
                "provider_id": fx.provider_id,
                "doctor_id": doctor_id,
                "appointment_type": "non_medical",
                "title": format!("Transfer {day}"),
                "date": day,
                "time_start": "09:00",
                "time_end": "10:00"
            })),
        )
        .await;
        assert_eq!(status, StatusCode::CREATED, "{body}");
        appointment_ids.push(Uuid::parse_str(body["id"].as_str().unwrap()).unwrap());
    }
    let auto_service = |appointment_id: Uuid| {
        let pool = ctx.pool.clone();
        async move {
            sqlx::query_scalar::<_, Uuid>(
                "SELECT id FROM concierge_services WHERE appointment_id = $1 AND request_source = 'appointment_bootstrap'",
            )
            .bind(appointment_id)
            .fetch_one(&pool)
            .await
            .unwrap()
        }
    };
    let plain_auto = auto_service(appointment_ids[0]).await;
    let booked_auto = auto_service(appointment_ids[1]).await;
    let staff_service = create_staff_service(&ctx.app, &fx, Some(appointment_ids[0])).await;

    let (status, body) = json_request(
        &ctx.app,
        "POST",
        &format!("/api/v1/concierge-services/{booked_auto}/book-provider"),
        &concierge,
        Some(json!({
            "request_id": Uuid::new_v4(),
            "provider_id": fx.provider_id,
            "booking_state": "requested",
            "channel": "phone",
            "starts_at": "2027-03-11T08:00:00Z",
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");

    for appointment_id in &appointment_ids {
        let (status, body) = json_request(
            &ctx.app,
            "POST",
            &format!("/api/v1/appointments/{appointment_id}/status"),
            &pm,
            Some(json!({ "status": "cancelled" })),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{body}");
    }

    assert_eq!(
        service_state(&ctx.pool, plain_auto).await,
        ("cancelled".to_string(), "waived".to_string())
    );
    assert_eq!(
        service_state(&ctx.pool, staff_service).await,
        ("planned".to_string(), "draft".to_string())
    );
    assert_eq!(service_state(&ctx.pool, booked_auto).await.0, "booked");
    let (_, booked_task_status, _) = task_of(&ctx.pool, booked_auto).await;
    assert_eq!(booked_task_status, "in_progress");
    let flagged: bool = sqlx::query_scalar(
        "SELECT booking_decision_required_at IS NOT NULL FROM concierge_services WHERE id = $1",
    )
    .bind(booked_auto)
    .fetch_one(&ctx.pool)
    .await
    .unwrap();
    assert!(flagged);
    let notices: i64 = sqlx::query_scalar(
        r#"SELECT COUNT(*) FROM user_notifications
           WHERE user_id = $1 AND kind = 'concierge_booking_decision' AND entity_id = $2"#,
    )
    .bind(fx.concierge_id)
    .bind(booked_auto)
    .fetch_one(&ctx.pool)
    .await
    .unwrap();
    assert_eq!(notices, 1);

    let (status, attention) = json_request(
        &ctx.app,
        "GET",
        "/api/v1/appointments/meta/attention",
        &pm,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{attention}");
    let item = attention
        .as_array()
        .unwrap()
        .iter()
        .find(|row| row["id"] == appointment_ids[1].to_string())
        .expect("cancelled appointment with a partner booking needs attention");
    assert!(
        item["reason_details"]
            .as_array()
            .unwrap()
            .iter()
            .any(|reason| reason["key"]
                == "appointments_attention_reason_concierge_booking_decision_count")
    );

    // The concierge keeps the booking: the flag is cleared once.
    let keep = format!("/api/v1/concierge-services/{booked_auto}/keep-booking");
    let (status, body) = json_request(&ctx.app, "POST", &keep, &concierge, None).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert!(body["booking_decision_required_at"].is_null());
    let (status, body) = json_request(&ctx.app, "POST", &keep, &concierge, None).await;
    assert_eq!(status, StatusCode::CONFLICT, "{body}");
}

#[tokio::test]
async fn portal_request_tasks_are_authored_by_the_coordinating_staff_member() {
    let Some(ctx) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let tag = Uuid::new_v4().simple().to_string();
    let fx = fixture(&ctx.pool, ctx.admin_id, &tag).await;
    let patient_user = seed_user(&ctx.pool, "patient", &tag).await;
    let insert_request = |patient_id: Uuid, assigned: Option<Uuid>| {
        let pool = ctx.pool.clone();
        async move {
            sqlx::query_scalar::<_, Uuid>(
                r#"INSERT INTO concierge_services (
                       patient_id, assigned_concierge_id, service_kind, title,
                       request_source, created_by
                   ) VALUES ($1, $2, 'hotel', 'Hotel near the clinic', 'patient_portal', $3)
                   RETURNING id"#,
            )
            .bind(patient_id)
            .bind(assigned)
            .bind(patient_user)
            .fetch_one(&pool)
            .await
            .unwrap()
        }
    };

    // With a concierge assigned to the patient, the concierge coordinates.
    let with_concierge = insert_request(fx.patient_id, Some(fx.concierge_id)).await;
    let (status, body) = update_service(
        &ctx.app,
        &auth_header_for(fx.concierge_id, "concierge"),
        with_concierge,
        json!({ "status": "in_service" }),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let author: (Uuid, Uuid) = sqlx::query_as(
        "SELECT assigned_by, assigned_to FROM tasks WHERE id = concierge_service_canonical_task_id($1)",
    )
    .bind(with_concierge)
    .fetch_one(&ctx.pool)
    .await
    .unwrap();
    assert_eq!(author, (fx.concierge_id, fx.concierge_id));

    // Only a patient manager assigned: the manager authors and works it.
    let other_patient = seed_patient(&ctx.pool, ctx.admin_id, &format!("{tag}-pm")).await;
    assign(&ctx.pool, other_patient, fx.pm_id, ctx.admin_id).await;
    let with_manager = insert_request(other_patient, None).await;
    let (status, body) = update_service(
        &ctx.app,
        &auth_header_for(fx.pm_id, "patient_manager"),
        with_manager,
        json!({ "status": "cancelled" }),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let author: (Uuid, Uuid, String) = sqlx::query_as(
        "SELECT assigned_by, assigned_to, status FROM tasks WHERE id = concierge_service_canonical_task_id($1)",
    )
    .bind(with_manager)
    .fetch_one(&ctx.pool)
    .await
    .unwrap();
    assert_eq!(author, (fx.pm_id, fx.pm_id, "cancelled".to_string()));
    let patient_notices: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM user_notifications WHERE user_id = $1")
            .bind(patient_user)
            .fetch_one(&ctx.pool)
            .await
            .unwrap();
    assert_eq!(patient_notices, 0);
}
