use axum::body::Body;
use axum::http::{Request, StatusCode};
use serde_json::{Value, json};
use sqlx::PgPool;
use tower::ServiceExt;
use uuid::Uuid;

use gmed_server::auth::jwt;
use gmed_server::settings::{SettingsCache, TokenSettings};
use gmed_server::state::AppState;

const TEST_SECRET: &str = "test-secret-at-least-32-characters-long!!";

async fn test_context() -> Option<(axum::Router, PgPool, Uuid)> {
    let db_url = std::env::var("DATABASE_URL").ok()?;
    let pool = gmed_db::create_pool(&db_url).await.ok()?;
    gmed_db::run_migrations(&pool).await.ok()?;

    let admin_id: Uuid = sqlx::query_scalar("SELECT id FROM users WHERE email = $1")
        .bind("admin@gmed.de")
        .fetch_one(&pool)
        .await
        .ok()?;

    let state = AppState::new(
        pool.clone(),
        TEST_SECRET,
        SettingsCache::new(TokenSettings::default()),
    );

    Some((gmed_server::build_app(state), pool, admin_id))
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
    let bytes = axum::body::to_bytes(response.into_body(), 4 * 1024 * 1024)
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

async fn seed_user(pool: &PgPool, tag: &str, role: &str) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO users (email, password_hash, name, role)
           VALUES ($1, $2, $3, $4)
           RETURNING id"#,
    )
    .bind(format!("{tag}-{role}@example.com"))
    .bind("test-password-hash")
    .bind(format!("{role} {tag}"))
    .bind(role)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn seed_patient(pool: &PgPool, created_by: Uuid, tag: &str) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO patients (patient_id, first_name, last_name, birth_date, gender, created_by)
           VALUES ($1, $2, $3, '1990-01-01', 'diverse', $4)
           RETURNING id"#,
    )
    .bind(format!("PT-{tag}"))
    .bind(format!("First {tag}"))
    .bind(format!("Last {tag}"))
    .bind(created_by)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn seed_patient_assignment(
    pool: &PgPool,
    patient_id: Uuid,
    user_id: Uuid,
    assigned_by: Uuid,
) {
    sqlx::query(
        r#"INSERT INTO patient_assignments (patient_id, user_id, assigned_by)
           VALUES ($1, $2, $3)
           ON CONFLICT (patient_id, user_id)
           DO UPDATE SET revoked_at = NULL, assigned_by = $3, assigned_at = now()"#,
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
        r#"INSERT INTO providers (name, provider_type, address_city, fachbereich, address_country)
           VALUES ($1, 'medical', $2, $3, 'Germany')
           RETURNING id"#,
    )
    .bind(format!("Clinic {tag}"))
    .bind(format!("City {tag}"))
    .bind(format!("Fach {tag}"))
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn seed_doctor(pool: &PgPool, provider_id: Uuid, tag: &str) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO provider_doctors (provider_id, name, fachbereich)
           VALUES ($1, $2, $3)
           RETURNING id"#,
    )
    .bind(provider_id)
    .bind(format!("Doctor {tag}"))
    .bind(format!("Fach {tag}"))
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn seed_order(pool: &PgPool, patient_id: Uuid, created_by: Uuid, tag: &str) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO orders (order_number, patient_id, phase, status, created_by)
           VALUES ($1, $2, 'execution', 'active', $3)
           RETURNING id"#,
    )
    .bind(format!("ORD-{tag}"))
    .bind(patient_id)
    .bind(created_by)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn seed_order_with_phase(
    pool: &PgPool,
    patient_id: Uuid,
    created_by: Uuid,
    tag: &str,
    phase: &str,
) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO orders (order_number, patient_id, phase, status, created_by)
           VALUES ($1, $2, $3, 'active', $4)
           RETURNING id"#,
    )
    .bind(format!("ORD-{tag}-{phase}"))
    .bind(patient_id)
    .bind(phase)
    .bind(created_by)
    .fetch_one(pool)
    .await
    .unwrap()
}

#[tokio::test]
async fn patient_can_create_appointment_request_and_pm_can_review_queue() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("portal-appointment-request");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let patient_user_id = seed_user(&pool, &tag, "patient").await;
    let patient_manager_id = seed_user(&pool, &format!("{tag}-pm"), "patient_manager").await;

    seed_patient_assignment(&pool, patient_id, patient_user_id, admin_id).await;
    seed_patient_assignment(&pool, patient_id, patient_manager_id, admin_id).await;

    let patient_bearer = auth_header_for(patient_user_id, "patient");
    let pm_bearer = auth_header_for(patient_manager_id, "patient_manager");

    let (status, body) = json_request(
        &app,
        "POST",
        "/api/v1/me/appointment-requests",
        &patient_bearer,
        Some(json!({
            "appointment_type": "medical",
            "preferred_date_from": "2026-05-10",
            "preferred_date_to": "2026-05-12",
            "preferred_time_of_day": "morning",
            "specialty": "Cardiology",
            "reason": "Need follow-up diagnostics"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let request_id = body["id"].as_str().unwrap().to_string();
    assert_eq!(body["status"], "requested");

    let (status, body) = json_request(
        &app,
        "GET",
        "/api/v1/me/appointment-requests",
        &patient_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body.as_array().unwrap().len(), 1);

    let (status, body) = json_request(
        &app,
        "GET",
        "/api/v1/appointments/requests?status=requested",
        &pm_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body.as_array().unwrap().len(), 1);
    assert_eq!(body.as_array().unwrap()[0]["id"], request_id);

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/appointments/requests/{request_id}/review"),
        &pm_bearer,
        Some(json!({
            "status": "approved",
            "review_note": "We will coordinate with the clinic."
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["status"], "approved");
    assert_eq!(body["review_note"], "We will coordinate with the clinic.");

    let (status, body) = json_request(
        &app,
        "GET",
        "/api/v1/me/appointment-requests",
        &patient_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body.as_array().unwrap()[0]["status"], "approved");

    let pm_notifications: i64 = sqlx::query_scalar(
        r#"SELECT count(*)
           FROM user_notifications
           WHERE user_id = $1
             AND kind = 'appointment_request'"#,
    )
    .bind(patient_manager_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(pm_notifications, 1);

    let patient_notifications: i64 = sqlx::query_scalar(
        r#"SELECT count(*)
           FROM user_notifications
           WHERE user_id = $1
             AND kind = 'appointment_request_update'"#,
    )
    .bind(patient_user_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(patient_notifications, 1);
}

#[tokio::test]
async fn sales_billing_ceo_assistant_and_it_admin_cannot_open_appointments_workspace() {
    let Some((app, pool, _admin_id)) = test_context().await else {
        return;
    };

    for role in ["sales", "billing", "ceo_assistant", "it_admin"] {
        let user_id = seed_user(&pool, &unique_tag(&format!("appointments-{role}")), role).await;
        let bearer = auth_header_for(user_id, role);

        let (status, body) = json_request(&app, "GET", "/api/v1/appointments", &bearer, None).await;
        assert_eq!(status, StatusCode::FORBIDDEN, "role {role} must be denied");
        assert_eq!(body["message"], "Forbidden");
    }
}

#[tokio::test]
async fn approved_request_can_be_converted_and_patient_sees_schedule() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("portal-appointment-convert");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let patient_user_id = seed_user(&pool, &tag, "patient").await;
    let patient_manager_id = seed_user(&pool, &format!("{tag}-pm"), "patient_manager").await;
    let provider_id = seed_provider(&pool, &tag).await;
    let doctor_id = seed_doctor(&pool, provider_id, &tag).await;
    let order_id = seed_order(&pool, patient_id, admin_id, &tag).await;

    seed_patient_assignment(&pool, patient_id, patient_user_id, admin_id).await;
    seed_patient_assignment(&pool, patient_id, patient_manager_id, admin_id).await;

    let patient_bearer = auth_header_for(patient_user_id, "patient");
    let pm_bearer = auth_header_for(patient_manager_id, "patient_manager");

    let (status, body) = json_request(
        &app,
        "POST",
        "/api/v1/me/appointment-requests",
        &patient_bearer,
        Some(json!({
            "appointment_type": "medical",
            "order_id": order_id,
            "preferred_date_from": "2026-05-20",
            "preferred_time_of_day": "afternoon",
            "reason": "Need specialist consultation"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let request_id = body["id"].as_str().unwrap().to_string();
    assert_eq!(body["status"], "requested");
    assert_eq!(body["order_id"], order_id.to_string());
    assert_eq!(body["appointment_type"], "medical");
    assert!(body["requested_at"].as_str().unwrap_or_default().len() > 10);

    let (status, body) = json_request(
        &app,
        "GET",
        "/api/v1/me/appointment-requests",
        &patient_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let items = body.as_array().unwrap();
    assert_eq!(items.len(), 1);
    assert_eq!(items[0]["id"], request_id);
    assert_eq!(items[0]["status"], "requested");
    assert!(items[0]["converted_appointment_id"].is_null());

    let (status, body) = json_request(
        &app,
        "GET",
        "/api/v1/appointments/requests?status=requested",
        &pm_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let items = body.as_array().unwrap();
    assert_eq!(items.len(), 1);
    assert_eq!(items[0]["id"], request_id);
    assert_eq!(items[0]["status"], "requested");

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/appointments/requests/{request_id}/review"),
        &pm_bearer,
        Some(json!({ "status": "approved" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["status"], "approved");
    assert_eq!(body["reviewed_by"], patient_manager_id.to_string());
    assert!(body["reviewed_at"].as_str().unwrap_or_default().len() > 10);
    assert_eq!(body["patient_id"], patient_id.to_string());

    let (status, body) = json_request(
        &app,
        "GET",
        "/api/v1/appointments/requests?status=requested",
        &pm_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(body.as_array().unwrap().is_empty());

    let (status, body) = json_request(
        &app,
        "GET",
        "/api/v1/appointments/requests?status=approved",
        &pm_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let items = body.as_array().unwrap();
    assert_eq!(items.len(), 1);
    assert_eq!(items[0]["id"], request_id);
    assert_eq!(items[0]["status"], "approved");
    assert_eq!(items[0]["reviewed_by"], patient_manager_id.to_string());

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/appointments/requests/{request_id}/convert"),
        &pm_bearer,
        Some(json!({
            "provider_id": provider_id,
            "doctor_id": doctor_id,
            "order_id": order_id,
            "title": "Scheduled cardiology consultation",
            "date": "2026-05-22",
            "time_start": "14:00",
            "time_end": "15:00",
            "location": "Clinic reception"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let appointment_id = body["appointment_id"].as_str().unwrap().to_string();
    assert_eq!(body["status"], "converted");

    let (status, body) = json_request(
        &app,
        "GET",
        "/api/v1/me/appointments",
        &patient_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let items = body.as_array().unwrap();
    assert_eq!(items.len(), 1);
    assert_eq!(items[0]["id"], appointment_id);
    assert_eq!(items[0]["title"], "Scheduled cardiology consultation");
    assert_eq!(items[0]["provider_name"], format!("Clinic {tag}"));
    assert_eq!(items[0]["doctor_name"], format!("Doctor {tag}"));
    assert_eq!(items[0]["status"], "planned");

    let (status, body) = json_request(
        &app,
        "GET",
        "/api/v1/appointments/requests?status=approved",
        &pm_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(body.as_array().unwrap().is_empty());

    let (status, body) = json_request(
        &app,
        "GET",
        "/api/v1/appointments/requests?status=converted",
        &pm_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let items = body.as_array().unwrap();
    assert_eq!(items.len(), 1);
    assert_eq!(items[0]["id"], request_id);
    assert_eq!(items[0]["status"], "converted");
    assert_eq!(items[0]["converted_appointment_id"], appointment_id);
    assert_eq!(
        items[0]["converted_appointment_title"],
        "Scheduled cardiology consultation"
    );
    assert_eq!(items[0]["converted_appointment_date"], "2026-05-22");

    let (status, body) = json_request(
        &app,
        "GET",
        "/api/v1/me/appointment-requests",
        &patient_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body.as_array().unwrap()[0]["status"], "converted");
    assert_eq!(
        body.as_array().unwrap()[0]["converted_appointment_id"],
        appointment_id
    );
    assert_eq!(
        body.as_array().unwrap()[0]["converted_appointment_title"],
        "Scheduled cardiology consultation"
    );
    assert_eq!(
        body.as_array().unwrap()[0]["converted_appointment_date"],
        "2026-05-22"
    );
    assert_eq!(
        body.as_array().unwrap()[0]["reviewed_by"],
        patient_manager_id.to_string()
    );
    assert!(
        body.as_array().unwrap()[0]["reviewed_at"]
            .as_str()
            .unwrap_or_default()
            .len()
            > 10
    );

    let patient_notifications: i64 = sqlx::query_scalar(
        r#"SELECT count(*)
           FROM user_notifications
           WHERE user_id = $1
             AND kind = 'appointment_request_update'"#,
    )
    .bind(patient_user_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(patient_notifications, 2);
}

#[tokio::test]
async fn rejected_request_stays_in_patient_history_and_never_creates_appointment() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("portal-appointment-reject");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let patient_user_id = seed_user(&pool, &tag, "patient").await;
    let patient_manager_id = seed_user(&pool, &format!("{tag}-pm"), "patient_manager").await;

    seed_patient_assignment(&pool, patient_id, patient_user_id, admin_id).await;
    seed_patient_assignment(&pool, patient_id, patient_manager_id, admin_id).await;

    let patient_bearer = auth_header_for(patient_user_id, "patient");
    let pm_bearer = auth_header_for(patient_manager_id, "patient_manager");

    let (status, body) = json_request(
        &app,
        "POST",
        "/api/v1/me/appointment-requests",
        &patient_bearer,
        Some(json!({
            "appointment_type": "medical",
            "preferred_date_from": "2026-06-03",
            "preferred_date_to": "2026-06-05",
            "preferred_time_of_day": "morning",
            "specialty": "Neurology",
            "reason": "Need a specialist but dates are flexible"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let request_id = body["id"].as_str().unwrap().to_string();
    assert_eq!(body["status"], "requested");

    let (status, body) = json_request(
        &app,
        "GET",
        "/api/v1/appointments/requests?status=requested",
        &pm_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let items = body.as_array().unwrap();
    assert_eq!(items.len(), 1);
    assert_eq!(items[0]["id"], request_id);

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/appointments/requests/{request_id}/review"),
        &pm_bearer,
        Some(json!({
            "status": "rejected",
            "review_note": "The requested slot range is not available; please submit a new range."
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["status"], "rejected");
    assert_eq!(
        body["review_note"],
        "The requested slot range is not available; please submit a new range."
    );
    assert_eq!(body["reviewed_by"], patient_manager_id.to_string());
    assert!(body["reviewed_at"].as_str().unwrap_or_default().len() > 10);
    assert!(body["converted_appointment_id"].is_null());

    let (status, body) = json_request(
        &app,
        "GET",
        "/api/v1/appointments/requests?status=requested",
        &pm_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(body.as_array().unwrap().is_empty());

    let (status, body) = json_request(
        &app,
        "GET",
        "/api/v1/appointments/requests?status=rejected",
        &pm_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let items = body.as_array().unwrap();
    assert_eq!(items.len(), 1);
    assert_eq!(items[0]["id"], request_id);
    assert_eq!(items[0]["status"], "rejected");
    assert_eq!(
        items[0]["review_note"],
        "The requested slot range is not available; please submit a new range."
    );

    let (status, body) = json_request(
        &app,
        "GET",
        "/api/v1/me/appointment-requests",
        &patient_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let items = body.as_array().unwrap();
    assert_eq!(items.len(), 1);
    assert_eq!(items[0]["id"], request_id);
    assert_eq!(items[0]["status"], "rejected");
    assert_eq!(
        items[0]["review_note"],
        "The requested slot range is not available; please submit a new range."
    );
    assert_eq!(items[0]["reviewed_by"], patient_manager_id.to_string());
    assert!(items[0]["converted_appointment_id"].is_null());

    let (status, body) = json_request(
        &app,
        "GET",
        "/api/v1/me/appointments",
        &patient_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(body.as_array().unwrap().is_empty());

    let patient_notifications: i64 = sqlx::query_scalar(
        r#"SELECT count(*)
           FROM user_notifications
           WHERE user_id = $1
             AND kind = 'appointment_request_update'"#,
    )
    .bind(patient_user_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(patient_notifications, 1);
}

#[tokio::test]
async fn patient_can_view_order_followup_milestones_from_portal() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("portal-followup");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let patient_user_id = seed_user(&pool, &tag, "patient").await;
    let patient_manager_id = seed_user(&pool, &format!("{tag}-pm"), "patient_manager").await;
    let order_id = seed_order_with_phase(&pool, patient_id, admin_id, &tag, "closure").await;

    seed_patient_assignment(&pool, patient_id, patient_user_id, admin_id).await;
    seed_patient_assignment(&pool, patient_id, patient_manager_id, admin_id).await;

    sqlx::query(
        r#"INSERT INTO order_followup_flows (
                order_id, doctor_followup_status, followup_1w_status, followup_1m_status,
                followup_6m_status, package_end_date, package_end_status, results_handoff_status,
                followup_summary
           ) VALUES (
                $1, 'scheduled', 'scheduled', 'scheduled',
                'scheduled', '2026-12-31', 'scheduled', 'completed',
                'Portal-visible follow-up plan'
           )"#,
    )
    .bind(order_id)
    .execute(&pool)
    .await
    .unwrap();

    sqlx::query(
        r#"INSERT INTO workflow_lifecycle_events (
                entity_type, entity_id, from_stage, to_stage, transition_kind, metadata, changed_by
           ) VALUES (
                'order', $1, 'execution', 'closure', 'phase_change', '{}'::jsonb, $2
           )"#,
    )
    .bind(order_id)
    .bind(patient_manager_id)
    .execute(&pool)
    .await
    .unwrap();

    sqlx::query(
        r#"INSERT INTO appointments (
                patient_id, order_id, appointment_type, title, date, status, checklist_phase, created_by
           ) VALUES
                ($1, $2, 'medical', 'Doctor-directed: Echo review', CURRENT_DATE + 3, 'planned', 'followup', $3),
                ($1, $2, 'medical', '1-week follow-up check-in', CURRENT_DATE + 7, 'planned', 'followup', $3),
                ($1, $2, 'medical', '1-month follow-up check-in', CURRENT_DATE + 30, 'planned', 'followup', $3),
                ($1, $2, 'medical', '6-month follow-up check-in', CURRENT_DATE + 180, 'planned', 'followup', $3)"#,
    )
    .bind(patient_id)
    .bind(order_id)
    .bind(patient_manager_id)
    .execute(&pool)
    .await
    .unwrap();

    sqlx::query(
        r#"INSERT INTO tasks (
                title, description, assigned_to, assigned_by, patient_id, order_id, priority, status
           ) VALUES (
                'Package-end: Renewal outreach', 'Package handoff', $1, $1, $2, $3, 'normal', 'open'
           )"#,
    )
    .bind(patient_manager_id)
    .bind(patient_id)
    .bind(order_id)
    .execute(&pool)
    .await
    .unwrap();

    let patient_bearer = auth_header_for(patient_user_id, "patient");

    let (status, body) = json_request(
        &app,
        "GET",
        "/api/v1/me/followup-milestones",
        &patient_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let items = body.as_array().unwrap();
    assert_eq!(items.len(), 1);
    assert_eq!(items[0]["order_id"], order_id.to_string());
    assert_eq!(items[0]["doctor_followup_status"], "scheduled");
    assert_eq!(items[0]["package_end_status"], "scheduled");
    assert_eq!(items[0]["results_handoff_status"], "completed");
    assert_eq!(items[0]["followup_ready"], true);
}
