mod support;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use serde_json::{Value, json};
use sqlx::PgPool;
use tower::ServiceExt;
use uuid::Uuid;

use gmed_server::auth::jwt;
const TEST_SECRET: &str = "test-secret-at-least-32-characters-long!!";

async fn test_context() -> Option<(axum::Router, PgPool, Uuid)> {
    let ctx = support::suite_context(TEST_SECRET).await?;
    Some((ctx.app, ctx.pool, ctx.admin_id))
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
    let patient_id = sqlx::query_scalar(
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
    .unwrap();
    support::seed_active_portal_subscription(pool, patient_id, created_by).await;
    patient_id
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

    // A second request of the same type while one is open: a code the portal
    // shows in the patient's language (QA C2-11), never the English text.
    let (status, body) = json_request(
        &app,
        "POST",
        "/api/v1/me/appointment-requests",
        &patient_bearer,
        Some(json!({
            "appointment_type": "medical",
            "preferred_date_from": "2026-05-20",
            "reason": "Second request"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{body}");
    assert_eq!(body["error"], "appointment_request_open_exists");

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
async fn sales_billing_and_it_admin_cannot_open_appointments_workspace() {
    let Some((app, pool, _admin_id)) = test_context().await else {
        return;
    };

    for role in ["sales", "billing", "it_admin"] {
        let user_id = seed_user(&pool, &unique_tag(&format!("appointments-{role}")), role).await;
        let bearer = auth_header_for(user_id, role);

        let (status, body) = json_request(&app, "GET", "/api/v1/appointments", &bearer, None).await;
        assert_eq!(status, StatusCode::FORBIDDEN, "role {role} must be denied");
        assert_eq!(body["message"], "Insufficient permissions");
    }

    // The CEO assistant reads the calendar (`appointments.view`) but cannot
    // create appointments.
    let assistant_id = seed_user(
        &pool,
        &unique_tag("appointments-assistant"),
        "ceo_assistant",
    )
    .await;
    let bearer = auth_header_for(assistant_id, "ceo_assistant");
    let (status, body) = json_request(&app, "GET", "/api/v1/appointments", &bearer, None).await;
    assert_eq!(status, StatusCode::OK, "{body:?}");
    let (status, _) = json_request(
        &app,
        "POST",
        "/api/v1/appointments",
        &bearer,
        Some(json!({
            "patient_id": Uuid::new_v4(),
            "appointment_type": "internal",
            "title": "Assistant may not book",
            "date": "2026-06-12",
            "time_start": "10:00",
            "time_end": "10:30"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn it_admin_has_no_appointment_patient_or_provider_workspace() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("appointment-it-admin-denied");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let it_admin_id = seed_user(&pool, &format!("{tag}-it"), "it_admin").await;
    let it_bearer = auth_header_for(it_admin_id, "it_admin");

    for path in [
        "/api/v1/appointments",
        "/api/v1/appointments/meta/staff",
        "/api/v1/patients",
        "/api/v1/providers",
    ] {
        let (status, body) = json_request(&app, "GET", path, &it_bearer, None).await;
        assert_eq!(status, StatusCode::FORBIDDEN, "{path}: {body:?}");
    }

    let (status, body) = json_request(
        &app,
        "POST",
        "/api/v1/appointments",
        &it_bearer,
        Some(json!({
            "patient_id": patient_id,
            "owner_user_id": it_admin_id,
            "appointment_type": "internal",
            "title": "Admin maintenance slot",
            "date": "2026-06-12",
            "time_start": "10:00",
            "time_end": "10:30"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN, "{body:?}");
}

#[tokio::test]
async fn appointment_owner_must_be_able_to_open_and_work_on_the_appointment() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("appointment-owner-roles");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let patient_manager_id = seed_user(&pool, &format!("{tag}-pm"), "patient_manager").await;
    let it_admin_id = seed_user(&pool, &format!("{tag}-it"), "it_admin").await;
    let interpreter_id = seed_user(&pool, &format!("{tag}-int"), "interpreter").await;
    let billing_id = seed_user(&pool, &format!("{tag}-bill"), "billing").await;
    let assistant_id = seed_user(&pool, &format!("{tag}-asst"), "ceo_assistant").await;
    let concierge_id = seed_user(&pool, &format!("{tag}-conc"), "concierge").await;
    let teamlead_id = seed_user(&pool, &format!("{tag}-tl"), "teamlead_interpreter").await;

    seed_patient_assignment(&pool, patient_id, patient_manager_id, admin_id).await;
    seed_patient_assignment(&pool, patient_id, teamlead_id, admin_id).await;

    let pm_bearer = auth_header_for(patient_manager_id, "patient_manager");
    let create = |bearer: String, owner_user_id: Uuid, date: &'static str| {
        let app = app.clone();
        async move {
            json_request(
                &app,
                "POST",
                "/api/v1/appointments",
                &bearer,
                Some(json!({
                    "patient_id": patient_id,
                    "owner_user_id": owner_user_id,
                    "appointment_type": "internal",
                    "title": "Internal coordination",
                    "date": date,
                    "time_start": "09:00",
                    "time_end": "09:30"
                })),
            )
            .await
        }
    };

    // An owner who could not open the appointment (IT, billing) or not work
    // on it (interpreter, CEO assistant) is refused.
    for owner in [it_admin_id, interpreter_id, billing_id, assistant_id] {
        let (status, body) = create(pm_bearer.clone(), owner, "2026-06-10").await;
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body:?}");
        assert_eq!(
            body["message"],
            "owner_user_id must reference an active user who can open and work on appointments (CEO, patient manager, interpreter team lead or concierge)"
        );
    }
    let owned: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM appointments WHERE patient_id = $1 AND owner_user_id = ANY($2)",
    )
    .bind(patient_id)
    .bind(vec![it_admin_id, interpreter_id, billing_id, assistant_id])
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(owned, 0);

    // A concierge owner opens the appointment it owns.
    let (status, body) = create(pm_bearer.clone(), concierge_id, "2026-06-10").await;
    assert_eq!(status, StatusCode::CREATED, "{body:?}");
    let appointment_id = body["id"].as_str().unwrap().to_string();
    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/appointments/{appointment_id}"),
        &auth_header_for(concierge_id, "concierge"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body:?}");
    assert_eq!(body["owner_role"], "concierge");

    // Handing the appointment to an IT admin later is refused as well.
    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/appointments/{appointment_id}/update"),
        &pm_bearer,
        Some(json!({
            "owner_user_id": it_admin_id,
            "title": "Internal coordination",
            "date": "2026-06-10",
            "time_start": "09:00",
            "time_end": "09:30"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body:?}");

    // The interpreter team lead no longer hands appointments to interpreters.
    let (status, body) = create(
        auth_header_for(teamlead_id, "teamlead_interpreter"),
        interpreter_id,
        "2026-06-12",
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body:?}");
    let (status, body) = create(
        auth_header_for(teamlead_id, "teamlead_interpreter"),
        teamlead_id,
        "2026-06-12",
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{body:?}");

    // An appointment an IT admin already owns keeps saving while the owner
    // stays unchanged.
    let legacy_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO appointments (
                patient_id, owner_user_id, appointment_type, title, date, status, created_by
           ) VALUES ($1, $2, 'internal', 'Legacy slot', '2026-06-11', 'planned', $3)
           RETURNING id"#,
    )
    .bind(patient_id)
    .bind(it_admin_id)
    .bind(admin_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/appointments/{legacy_id}/update"),
        &pm_bearer,
        Some(json!({
            "owner_user_id": it_admin_id,
            "title": "Legacy slot renamed",
            "date": "2026-06-11"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body:?}");
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
            "care_path_kind": "control",
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
    assert_eq!(body["care_path_kind"], "control");
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
    assert_eq!(items[0]["care_path_kind"], "control");
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
    assert_eq!(items[0]["care_path_kind"], "control");

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
    assert_eq!(items[0]["care_path_kind"], "control");
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
    assert_eq!(items[0]["care_path_kind"], "control");
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
    assert_eq!(body.as_array().unwrap()[0]["care_path_kind"], "control");
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
    // The patient sees when the request was reviewed, not who reviewed it.
    assert!(body.as_array().unwrap()[0].get("reviewed_by").is_none());
    assert!(
        body.as_array().unwrap()[0]
            .get("reviewed_by_name")
            .is_none()
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
    // The review note answers the patient; the reviewer stays internal.
    assert!(items[0].get("reviewed_by").is_none());
    assert!(items[0].get("reviewed_by_name").is_none());
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

async fn portal_appointment_ids(app: &axum::Router, patient_bearer: &str) -> Vec<String> {
    let (status, body) =
        json_request(app, "GET", "/api/v1/me/appointments", patient_bearer, None).await;
    assert_eq!(status, StatusCode::OK, "{body:?}");
    body.as_array()
        .unwrap()
        .iter()
        .map(|item| item["id"].as_str().unwrap_or_default().to_string())
        .collect()
}

async fn count_plan_notifications(pool: &PgPool, user_id: Uuid) -> i64 {
    sqlx::query_scalar(
        "SELECT count(*) FROM user_notifications WHERE user_id = $1 AND kind = 'appointment_plan_released'",
    )
    .bind(user_id)
    .fetch_one(pool)
    .await
    .unwrap()
}

/// Owner decision 2026-11-02: an appointment planned inside an order reaches
/// the portal only when the plan is released; one outside an order at once.
#[tokio::test]
async fn order_plan_reaches_the_portal_only_after_release() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("portal-plan-release");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let patient_user_id = seed_user(&pool, &tag, "patient").await;
    let patient_manager_id = seed_user(&pool, &format!("{tag}-pm"), "patient_manager").await;
    let other_pm_id = seed_user(&pool, &format!("{tag}-pm2"), "patient_manager").await;
    let concierge_id = seed_user(&pool, &format!("{tag}-conc"), "concierge").await;
    let teamlead_id = seed_user(&pool, &format!("{tag}-tl"), "teamlead_interpreter").await;
    let provider_id = seed_provider(&pool, &tag).await;
    let doctor_id = seed_doctor(&pool, provider_id, &tag).await;
    let order_id = seed_order(&pool, patient_id, admin_id, &tag).await;

    seed_patient_assignment(&pool, patient_id, patient_user_id, admin_id).await;
    seed_patient_assignment(&pool, patient_id, patient_manager_id, admin_id).await;
    seed_patient_assignment(&pool, patient_id, concierge_id, admin_id).await;
    seed_patient_assignment(&pool, patient_id, teamlead_id, admin_id).await;

    let patient_bearer = auth_header_for(patient_user_id, "patient");
    let pm_bearer = auth_header_for(patient_manager_id, "patient_manager");

    let create = |body: Value| {
        let app = app.clone();
        let bearer = pm_bearer.clone();
        async move {
            let (status, body) =
                json_request(&app, "POST", "/api/v1/appointments", &bearer, Some(body)).await;
            assert_eq!(status, StatusCode::CREATED, "{body:?}");
            body["id"].as_str().unwrap().to_string()
        }
    };
    let planned = create(json!({
        "patient_id": patient_id,
        "order_id": order_id,
        "provider_id": provider_id,
        "doctor_id": doctor_id,
        "appointment_type": "medical",
        "title": "Planned cardiology visit",
        "date": "2027-03-10",
        "time_start": "10:00",
        "time_end": "11:00"
    }))
    .await;
    let dropped = create(json!({
        "patient_id": patient_id,
        "order_id": order_id,
        "provider_id": provider_id,
        "doctor_id": doctor_id,
        "appointment_type": "medical",
        "title": "Dropped visit",
        "date": "2027-03-11",
        "time_start": "10:00",
        "time_end": "11:00"
    }))
    .await;
    let standalone = create(json!({
        "patient_id": patient_id,
        "provider_id": provider_id,
        "doctor_id": doctor_id,
        "appointment_type": "medical",
        "title": "Visit outside an order",
        "date": "2027-03-12",
        "time_start": "10:00",
        "time_end": "11:00"
    }))
    .await;
    sqlx::query("UPDATE appointments SET status = 'cancelled' WHERE id = $1::uuid")
        .bind(&dropped)
        .execute(&pool)
        .await
        .unwrap();

    // Before the release the portal, its dashboard and its notifications
    // know only the visit outside the order.
    assert_eq!(
        portal_appointment_ids(&app, &patient_bearer).await,
        vec![standalone.clone()]
    );
    let (status, body) = json_request(
        &app,
        "GET",
        "/api/v1/me/next-actions",
        &patient_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body:?}");
    assert!(!body.to_string().contains(&planned), "{body}");
    // The patient was told about the visit outside the order, and about no
    // visit of the plan that is not released yet (owner decision 2026-11-10).
    let patient_notifications: Vec<(String, Option<Uuid>)> = sqlx::query_as(
        "SELECT kind, entity_id FROM user_notifications WHERE user_id = $1 AND entity_type = 'appointment'",
    )
    .bind(patient_user_id)
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(
        patient_notifications,
        vec![(
            "patient_appointment_added".to_string(),
            Some(Uuid::parse_str(&standalone).unwrap())
        )]
    );

    // Staff see the plan with its release state.
    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/orders/{order_id}/pipeline"),
        &pm_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body:?}");
    let pipeline_appointment = body["appointments"]
        .as_array()
        .unwrap()
        .iter()
        .find(|item| item["id"] == planned.as_str())
        .cloned()
        .unwrap();
    assert!(
        pipeline_appointment["portal_released_at"].is_null(),
        "{pipeline_appointment}"
    );

    // Only the patient's planners release the plan.
    let release_path = format!("/api/v1/orders/{order_id}/appointments/release-to-portal");
    for bearer in [
        patient_bearer.clone(),
        auth_header_for(concierge_id, "concierge"),
        auth_header_for(teamlead_id, "teamlead_interpreter"),
        auth_header_for(other_pm_id, "patient_manager"),
    ] {
        let (status, body) = json_request(&app, "POST", &release_path, &bearer, None).await;
        assert_eq!(status, StatusCode::FORBIDDEN, "{body:?}");
    }
    assert_eq!(
        portal_appointment_ids(&app, &patient_bearer).await,
        vec![standalone.clone()]
    );

    let (status, body) = json_request(&app, "POST", &release_path, &pm_bearer, None).await;
    assert_eq!(status, StatusCode::OK, "{body:?}");
    assert_eq!(body["released"], 1);
    assert_eq!(body["appointment_ids"], json!([planned.clone()]));

    let mut visible = portal_appointment_ids(&app, &patient_bearer).await;
    visible.sort();
    let mut expected = vec![planned.clone(), standalone.clone()];
    expected.sort();
    assert_eq!(visible, expected);
    assert_eq!(count_plan_notifications(&pool, patient_user_id).await, 1);

    let released_by: Option<Uuid> =
        sqlx::query_scalar("SELECT portal_released_by FROM appointments WHERE id = $1::uuid")
            .bind(&planned)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(released_by, Some(patient_manager_id));
    let cancelled_released: bool = sqlx::query_scalar(
        "SELECT portal_released_at IS NOT NULL FROM appointments WHERE id = $1::uuid",
    )
    .bind(&dropped)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(
        !cancelled_released,
        "a cancelled visit is not part of the plan"
    );
    let audit_rows: i64 = sqlx::query_scalar(
        r#"SELECT count(*) FROM audit_log
           WHERE action = 'release_appointment_to_portal'
             AND entity_id = $1::uuid AND user_id = $2"#,
    )
    .bind(&planned)
    .bind(patient_manager_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(audit_rows, 1);

    // A second release changes nothing and notifies nobody again.
    let (status, body) = json_request(&app, "POST", &release_path, &pm_bearer, None).await;
    assert_eq!(status, StatusCode::OK, "{body:?}");
    assert_eq!(body["released"], 0);
    assert_eq!(count_plan_notifications(&pool, patient_user_id).await, 1);
}

/// Kind, stored title, stored text and facts of the patient's visit notices.
async fn patient_visit_notices(
    pool: &PgPool,
    user_id: Uuid,
) -> Vec<(String, String, Option<String>, Value)> {
    sqlx::query_as(
        r#"SELECT kind, title, body, params
           FROM user_notifications
           WHERE user_id = $1 AND kind LIKE 'patient_appointment_%'
           ORDER BY created_at, id"#,
    )
    .bind(user_id)
    .fetch_all(pool)
    .await
    .unwrap()
}

/// Owner decision 2026-11-10: the patient is told when a visit of the own
/// schedule is added, confirmed, moved or cancelled — once per save, in the
/// patient's language, never about an internal change and never about a
/// visit the portal does not show.
#[tokio::test]
async fn patient_is_told_about_changes_of_the_visits_the_portal_shows() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("portal-visit-notices");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let patient_user_id = seed_user(&pool, &tag, "patient").await;
    let patient_manager_id = seed_user(&pool, &format!("{tag}-pm"), "patient_manager").await;
    let provider_id = seed_provider(&pool, &tag).await;
    let doctor_id = seed_doctor(&pool, provider_id, &tag).await;
    let order_id = seed_order(&pool, patient_id, admin_id, &tag).await;
    seed_patient_assignment(&pool, patient_id, patient_user_id, admin_id).await;
    seed_patient_assignment(&pool, patient_id, patient_manager_id, admin_id).await;
    let pm_bearer = auth_header_for(patient_manager_id, "patient_manager");

    let visit_body = |date: &str, time_start: &str, time_end: &str, notes: Value| {
        json!({
            "patient_id": patient_id,
            "provider_id": provider_id,
            "doctor_id": doctor_id,
            "owner_user_id": patient_manager_id,
            "appointment_type": "medical",
            "title": "Cardiology check",
            "date": date,
            "time_start": time_start,
            "time_end": time_end,
            "notes": notes,
        })
    };

    // A visit outside an order is in the portal at once: one notice.
    let (status, body) = json_request(
        &app,
        "POST",
        "/api/v1/appointments",
        &pm_bearer,
        Some(visit_body("2027-04-10", "10:00", "11:00", Value::Null)),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{body:?}");
    let visit = body["id"].as_str().unwrap().to_string();
    let notices = patient_visit_notices(&pool, patient_user_id).await;
    assert_eq!(notices.len(), 1, "{notices:?}");
    assert_eq!(notices[0].0, "patient_appointment_added");
    assert_eq!(notices[0].1, "Новый приём в вашем расписании");
    assert_eq!(notices[0].3["appointment_date"], "2027-04-10");
    assert_eq!(notices[0].3["time_start"], "10:00");

    // An internal change (a note) tells the patient nothing.
    let update_path = format!("/api/v1/appointments/{visit}/update");
    let (status, body) = json_request(
        &app,
        "POST",
        &update_path,
        &pm_bearer,
        Some(visit_body(
            "2027-04-10",
            "10:00",
            "11:00",
            json!("Internal remark"),
        )),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body:?}");
    assert_eq!(patient_visit_notices(&pool, patient_user_id).await.len(), 1);

    // Confirmed, then moved: one notice each, the move with the old slot.
    let status_path = format!("/api/v1/appointments/{visit}/status");
    let (status, body) = json_request(
        &app,
        "POST",
        &status_path,
        &pm_bearer,
        Some(json!({ "status": "confirmed" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body:?}");
    let (status, body) = json_request(
        &app,
        "POST",
        &update_path,
        &pm_bearer,
        Some(visit_body(
            "2027-04-12",
            "14:00",
            "15:00",
            json!("Internal remark"),
        )),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body:?}");
    let notices = patient_visit_notices(&pool, patient_user_id).await;
    assert_eq!(notices.len(), 3, "{notices:?}");
    assert_eq!(notices[1].0, "patient_appointment_confirmed");
    assert_eq!(notices[2].0, "patient_appointment_rescheduled");
    assert_eq!(notices[2].3["previous_date"], "2027-04-10");
    assert_eq!(notices[2].3["previous_time_start"], "10:00");
    assert_eq!(notices[2].3["appointment_date"], "2027-04-12");
    assert_eq!(
        notices[2].2.as_deref(),
        Some("Cardiology check: 10.04.2027 10:00 → 12.04.2027 14:00")
    );

    // Cancelled: told in the language the patient chose.
    sqlx::query("UPDATE users SET preferred_language = 'de' WHERE id = $1")
        .bind(patient_user_id)
        .execute(&pool)
        .await
        .unwrap();
    let (status, body) = json_request(
        &app,
        "POST",
        &status_path,
        &pm_bearer,
        Some(json!({ "status": "cancelled" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body:?}");
    let notices = patient_visit_notices(&pool, patient_user_id).await;
    assert_eq!(notices.len(), 4, "{notices:?}");
    assert_eq!(notices[3].0, "patient_appointment_cancelled");
    assert_eq!(notices[3].1, "Termin abgesagt");
    let linked: Option<Uuid> = sqlx::query_scalar(
        "SELECT entity_id FROM user_notifications WHERE user_id = $1 AND kind = 'patient_appointment_cancelled'",
    )
    .bind(patient_user_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(linked, Some(Uuid::parse_str(&visit).unwrap()));

    // A visit of a plan that is not released, and an internal appointment,
    // stay silent whatever happens to them.
    let mut planned_body = visit_body("2027-04-20", "10:00", "11:00", Value::Null);
    planned_body["order_id"] = json!(order_id);
    let (status, body) = json_request(
        &app,
        "POST",
        "/api/v1/appointments",
        &pm_bearer,
        Some(planned_body),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{body:?}");
    let planned = body["id"].as_str().unwrap().to_string();
    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/appointments/{planned}/status"),
        &pm_bearer,
        Some(json!({ "status": "confirmed" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body:?}");
    let (status, body) = json_request(
        &app,
        "POST",
        "/api/v1/appointments",
        &pm_bearer,
        Some(json!({
            "patient_id": patient_id,
            "owner_user_id": patient_manager_id,
            "appointment_type": "internal",
            "title": "Internal coordination",
            "date": "2027-04-21",
            "time_start": "09:00",
            "time_end": "09:30"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{body:?}");
    assert_eq!(patient_visit_notices(&pool, patient_user_id).await.len(), 4);
}

#[allow(clippy::too_many_arguments)]
async fn seed_order_appointment(
    pool: &PgPool,
    patient_id: Uuid,
    order_id: Uuid,
    provider_id: Option<Uuid>,
    doctor_id: Option<Uuid>,
    appointment_type: &str,
    title: &str,
    days_ahead: i32,
    created_by: Uuid,
) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO appointments (
                patient_id, order_id, provider_id, doctor_id, appointment_type, title, date,
                status, created_by
           ) VALUES ($1, $2, $3, $4, $5, $6, CURRENT_DATE + $7, 'planned', $8)
           RETURNING id"#,
    )
    .bind(patient_id)
    .bind(order_id)
    .bind(provider_id)
    .bind(doctor_id)
    .bind(appointment_type)
    .bind(title)
    .bind(days_ahead)
    .bind(created_by)
    .fetch_one(pool)
    .await
    .unwrap()
}

/// Owner decision 2026-11-02 (question 5): a doctor outside the signed quote
/// may be planned, and the plan warns that completing the visit adds an
/// invoice line.
#[tokio::test]
async fn pipeline_flags_appointments_outside_the_signed_quote() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("plan-quote-warning");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let patient_manager_id = seed_user(&pool, &format!("{tag}-pm"), "patient_manager").await;
    seed_patient_assignment(&pool, patient_id, patient_manager_id, admin_id).await;
    let order_id = seed_order(&pool, patient_id, admin_id, &tag).await;
    let clinic = seed_provider(&pool, &format!("{tag}-a")).await;
    let quoted_doctor = seed_doctor(&pool, clinic, &format!("{tag}-a1")).await;
    let other_doctor = seed_doctor(&pool, clinic, &format!("{tag}-a2")).await;
    let lab = seed_provider(&pool, &format!("{tag}-b")).await;
    let lab_doctor = seed_doctor(&pool, lab, &format!("{tag}-b1")).await;

    let quoted = seed_order_appointment(
        &pool,
        patient_id,
        order_id,
        Some(clinic),
        Some(quoted_doctor),
        "medical",
        "Quoted doctor",
        10,
        admin_id,
    )
    .await;
    let unquoted = seed_order_appointment(
        &pool,
        patient_id,
        order_id,
        Some(clinic),
        Some(other_doctor),
        "medical",
        "Other doctor",
        11,
        admin_id,
    )
    .await;
    let provider_line = seed_order_appointment(
        &pool,
        patient_id,
        order_id,
        Some(lab),
        Some(lab_doctor),
        "medical",
        "Lab visit",
        12,
        admin_id,
    )
    .await;
    let internal = seed_order_appointment(
        &pool,
        patient_id,
        order_id,
        None,
        None,
        "internal",
        "Team call",
        13,
        admin_id,
    )
    .await;

    let pm_bearer = auth_header_for(patient_manager_id, "patient_manager");
    let flags = || {
        let app = app.clone();
        let bearer = pm_bearer.clone();
        async move {
            let (status, body) = json_request(
                &app,
                "GET",
                &format!("/api/v1/orders/{order_id}/pipeline"),
                &bearer,
                None,
            )
            .await;
            assert_eq!(status, StatusCode::OK, "{body:?}");
            body["appointments"]
                .as_array()
                .unwrap()
                .iter()
                .map(|item| {
                    (
                        item["id"].as_str().unwrap().to_string(),
                        item["outside_signed_quote"].as_bool().unwrap(),
                    )
                })
                .collect::<std::collections::HashMap<_, _>>()
        }
    };

    // Before a quote is signed there is nothing to compare with.
    let before = flags().await;
    assert!(before.values().all(|outside| !outside), "{before:?}");

    // The planning section adds the next visit under the same doctor: the
    // pipeline names the provider and doctor of each appointment by id.
    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/orders/{order_id}/pipeline"),
        &pm_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body:?}");
    let by_id = |id: &str| {
        body["appointments"]
            .as_array()
            .unwrap()
            .iter()
            .find(|item| item["id"] == id)
            .cloned()
            .unwrap()
    };
    let quoted_row = by_id(&quoted.to_string());
    assert_eq!(
        quoted_row["provider_id"],
        json!(clinic.to_string()),
        "{quoted_row}"
    );
    assert_eq!(
        quoted_row["doctor_id"],
        json!(quoted_doctor.to_string()),
        "{quoted_row}"
    );
    let internal_row = by_id(&internal.to_string());
    assert!(internal_row["provider_id"].is_null(), "{internal_row}");
    assert!(internal_row["doctor_id"].is_null(), "{internal_row}");

    // A draft quote naming the other doctor does not count; the accepted one
    // names the quoted doctor and the lab without a doctor.
    for (status, provider, doctor) in [
        ("draft", clinic, Some(other_doctor)),
        ("accepted", clinic, Some(quoted_doctor)),
    ] {
        let mut lines = vec![json!({
            "description": "Behandlungsorganisation",
            "quantity": "1",
            "unit_price": "100",
            "provider_id": provider,
            "doctor_id": doctor,
        })];
        if status == "accepted" {
            lines.push(json!({
                "description": "Labor",
                "quantity": "1",
                "unit_price": "50",
                "provider_id": lab,
                "doctor_id": null,
            }));
        }
        sqlx::query(
            r#"INSERT INTO quotes (
                    order_id, quote_number, total_net, total_vat, total_gross,
                    status, line_items, created_by
               ) VALUES ($1, $2, 150, 0, 150, $3, $4, $5)"#,
        )
        .bind(order_id)
        .bind(format!("KV-{tag}-{status}"))
        .bind(status)
        .bind(json!(lines))
        .bind(admin_id)
        .execute(&pool)
        .await
        .unwrap();
    }

    let after = flags().await;
    assert!(!after[&quoted.to_string()], "{after:?}");
    assert!(after[&unquoted.to_string()], "{after:?}");
    assert!(!after[&provider_line.to_string()], "{after:?}");
    assert!(!after[&internal.to_string()], "{after:?}");
}

/// A recommendation from a planned visit does not name the visit in the
/// portal before the plan is released.
#[tokio::test]
async fn portal_recommendation_hides_an_unreleased_source_appointment() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("portal-recommendation-source");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let patient_user_id = seed_user(&pool, &tag, "patient").await;
    seed_patient_assignment(&pool, patient_id, patient_user_id, admin_id).await;
    let order_id = seed_order(&pool, patient_id, admin_id, &tag).await;
    let appointment_id = seed_order_appointment(
        &pool,
        patient_id,
        order_id,
        None,
        None,
        "medical",
        "Secret planned visit",
        5,
        admin_id,
    )
    .await;
    sqlx::query("UPDATE appointments SET portal_released_at = NULL WHERE id = $1")
        .bind(appointment_id)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query(
        r#"INSERT INTO patient_recommendations (patient_id, title, source_appointment_id, portal_visible)
           VALUES ($1, 'Control in six months', $2, true)"#,
    )
    .bind(patient_id)
    .bind(appointment_id)
    .execute(&pool)
    .await
    .unwrap();

    let patient_bearer = auth_header_for(patient_user_id, "patient");
    let load = || {
        let app = app.clone();
        let bearer = patient_bearer.clone();
        async move {
            let (status, body) =
                json_request(&app, "GET", "/api/v1/me/recommendations", &bearer, None).await;
            assert_eq!(status, StatusCode::OK, "{body:?}");
            body.as_array().unwrap()[0].clone()
        }
    };

    let hidden = load().await;
    assert!(hidden["source_appointment_title"].is_null(), "{hidden}");
    assert!(hidden["source_appointment_id"].is_null(), "{hidden}");
    assert!(!hidden.to_string().contains("Secret planned visit"));

    sqlx::query("UPDATE appointments SET portal_released_at = now() WHERE id = $1")
        .bind(appointment_id)
        .execute(&pool)
        .await
        .unwrap();
    let shown = load().await;
    assert_eq!(shown["source_appointment_title"], "Secret planned visit");
    assert_eq!(shown["source_appointment_id"], appointment_id.to_string());
}

/// The portal's follow-up milestones neither count nor date a follow-up
/// visit that is not released yet; the staff view still does.
#[tokio::test]
async fn portal_followup_milestones_skip_unreleased_visits() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("portal-followup-release");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let patient_user_id = seed_user(&pool, &tag, "patient").await;
    let patient_manager_id = seed_user(&pool, &format!("{tag}-pm"), "patient_manager").await;
    let order_id = seed_order_with_phase(&pool, patient_id, admin_id, &tag, "closure").await;
    seed_patient_assignment(&pool, patient_id, patient_user_id, admin_id).await;
    seed_patient_assignment(&pool, patient_id, patient_manager_id, admin_id).await;

    sqlx::query(
        r#"INSERT INTO appointments (
                patient_id, order_id, appointment_type, title, date, status, checklist_phase,
                created_by, portal_released_at
           ) VALUES
                ($1, $2, 'medical', '1-week follow-up check-in', CURRENT_DATE + 7, 'planned', 'followup', $3, now()),
                ($1, $2, 'medical', '1-month follow-up check-in', CURRENT_DATE + 30, 'planned', 'followup', $3, NULL)"#,
    )
    .bind(patient_id)
    .bind(order_id)
    .bind(patient_manager_id)
    .execute(&pool)
    .await
    .unwrap();

    let (status, body) = json_request(
        &app,
        "GET",
        "/api/v1/me/followup-milestones",
        &auth_header_for(patient_user_id, "patient"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body:?}");
    let portal = &body.as_array().unwrap()[0];
    assert_eq!(portal["followup_appointments_total"], 1, "{portal}");
    assert_eq!(portal["followup_1w_visits"], 1, "{portal}");
    assert_eq!(portal["followup_1m_visits"], 0, "{portal}");
    assert!(portal["followup_1m_open_visit_date"].is_null(), "{portal}");

    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/orders/{order_id}"),
        &auth_header_for(patient_manager_id, "patient_manager"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body:?}");
    assert_eq!(
        body["followup_flow"]["followup_appointments_total"], 2,
        "{body}"
    );
    assert_eq!(body["followup_flow"]["followup_1m_visits"], 1, "{body}");
}

/// The manual agreement records that the plan was sent to the patient
/// (owner decision 2026-11-02, question 4), with its note, through the
/// audited planning update.
#[tokio::test]
async fn plan_agreement_records_the_plan_as_sent() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("plan-agreement-sent");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let patient_manager_id = seed_user(&pool, &format!("{tag}-pm"), "patient_manager").await;
    seed_patient_assignment(&pool, patient_id, patient_manager_id, admin_id).await;
    let order_id = seed_order(&pool, patient_id, admin_id, &tag).await;

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/orders/{order_id}/planning-preparation"),
        &auth_header_for(patient_manager_id, "patient_manager"),
        Some(json!({
            "treatment_plan_status": "sent",
            "treatment_plan_note": "Plan per E-Mail gesendet"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body:?}");
    assert_eq!(body["treatment_plan_status"], "sent", "{body}");

    let (status, note): (String, Option<String>) = sqlx::query_as(
        "SELECT treatment_plan_status, treatment_plan_note FROM order_planning_preparation WHERE order_id = $1",
    )
    .bind(order_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(status, "sent");
    assert_eq!(note.as_deref(), Some("Plan per E-Mail gesendet"));
}

/// «План для пациента» shows who set the status and when, and the newest
/// appointment of the plan, so staff see a plan that changed after it was
/// sent. A repeated click with the same status keeps the first actor/time.
#[tokio::test]
async fn plan_agreement_reports_status_actor_and_newest_appointment() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("plan-agreement-actor");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let patient_manager_id = seed_user(&pool, &format!("{tag}-pm"), "patient_manager").await;
    seed_patient_assignment(&pool, patient_id, patient_manager_id, admin_id).await;
    let order_id = seed_order(&pool, patient_id, admin_id, &tag).await;
    let pm = auth_header_for(patient_manager_id, "patient_manager");
    let planning_uri = format!("/api/v1/orders/{order_id}/planning-preparation");

    let (status, first) = json_request(
        &app,
        "POST",
        &planning_uri,
        &pm,
        Some(json!({ "treatment_plan_status": "sent" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{first:?}");
    assert_eq!(
        first["treatment_plan_status_updated_by"],
        json!(patient_manager_id),
        "{first}"
    );
    assert!(
        first["treatment_plan_status_updated_by_name"].is_string(),
        "{first}"
    );
    let set_at = first["treatment_plan_status_updated_at"]
        .as_str()
        .unwrap_or_else(|| panic!("status time missing: {first}"))
        .to_string();
    assert!(first["appointments_last_added_at"].is_null(), "{first}");

    // The same status again (a double click) does not move the time.
    let (status, again) = json_request(
        &app,
        "POST",
        &planning_uri,
        &pm,
        Some(json!({ "treatment_plan_status": "sent" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{again:?}");
    assert_eq!(again["treatment_plan_status_updated_at"], json!(set_at));

    sqlx::query(
        r#"INSERT INTO appointments (
                patient_id, order_id, appointment_type, title, date, status, created_by,
                created_at
           ) VALUES ($1, $2, 'medical', 'Added later', CURRENT_DATE + 3, 'planned', $3,
                     now() + interval '1 minute')"#,
    )
    .bind(patient_id)
    .bind(order_id)
    .bind(patient_manager_id)
    .execute(&pool)
    .await
    .unwrap();
    let (status, detail) = json_request(
        &app,
        "GET",
        &format!("/api/v1/orders/{order_id}"),
        &pm,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{detail:?}");
    let added = detail["planning_preparation"]["appointments_last_added_at"]
        .as_str()
        .unwrap_or_else(|| panic!("newest appointment missing: {detail}"));
    let added = chrono::DateTime::parse_from_rfc3339(added).unwrap();
    let set_at = chrono::DateTime::parse_from_rfc3339(&set_at).unwrap();
    assert!(added > set_at, "{added} vs {set_at}");
}
