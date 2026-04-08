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

async fn test_context() -> Option<(axum::Router, PgPool, Uuid, String)> {
    let db_url = match std::env::var("DATABASE_URL") {
        Ok(url) => url,
        Err(_) => return None,
    };

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
    let app = gmed_server::build_app(state);
    let token = jwt::issue_access_token(TEST_SECRET, admin_id, "ceo", Uuid::new_v4()).ok()?;

    Some((app, pool, admin_id, format!("Bearer {token}")))
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
    seed_provider_with_type(pool, tag, "medical", &format!("Country {tag}")).await
}

async fn seed_provider_with_type(
    pool: &PgPool,
    tag: &str,
    provider_type: &str,
    country: &str,
) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO providers (name, provider_type, address_city, fachbereich, address_country)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING id"#,
    )
    .bind(format!("Clinic {tag}"))
    .bind(provider_type)
    .bind(format!("City {tag}"))
    .bind(format!("Fach {tag}"))
    .bind(country)
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

async fn seed_service(pool: &PgPool, provider_id: Uuid, name: &str, description: &str) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO service_catalog (
                provider_id, service_name, description, price, currency, valid_from
           ) VALUES (
                $1, $2, $3, 100.0, 'EUR', '2026-01-01'
           ) RETURNING id"#,
    )
    .bind(provider_id)
    .bind(name)
    .bind(description)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn seed_order(
    pool: &PgPool,
    patient_id: Uuid,
    created_by: Uuid,
    order_number: &str,
    phase: &str,
    status: &str,
    needs_description: &str,
) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO orders (
                order_number, patient_id, phase, status, needs_description, created_by
           ) VALUES (
                $1, $2, $3, $4, $5, $6
           ) RETURNING id"#,
    )
    .bind(order_number)
    .bind(patient_id)
    .bind(phase)
    .bind(status)
    .bind(needs_description)
    .bind(created_by)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn seed_leistung(
    pool: &PgPool,
    order_id: Uuid,
    provider_id: Uuid,
    doctor_id: Uuid,
    description: &str,
) {
    sqlx::query(
        r#"INSERT INTO order_leistungen (
                order_id, description, quantity, unit_price, vat_rate, provider_id, doctor_id
           ) VALUES (
                $1, $2, $3, $4, $5, $6, $7
           )"#,
    )
    .bind(order_id)
    .bind(description)
    .bind(1.0_f64)
    .bind(150.0_f64)
    .bind(19.0_f64)
    .bind(provider_id)
    .bind(doctor_id)
    .execute(pool)
    .await
    .unwrap();
}

#[allow(clippy::too_many_arguments)]
async fn seed_appointment(
    pool: &PgPool,
    patient_id: Uuid,
    provider_id: Uuid,
    doctor_id: Uuid,
    created_by: Uuid,
    title: &str,
    status: &str,
    date: &str,
) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO appointments (
                patient_id, provider_id, doctor_id, appointment_type, title, date, status, created_by
           ) VALUES (
                $1, $2, $3, 'medical', $4, $5, $6, $7
           ) RETURNING id"#,
    )
    .bind(patient_id)
    .bind(provider_id)
    .bind(doctor_id)
    .bind(title)
    .bind(date)
    .bind(status)
    .bind(created_by)
    .fetch_one(pool)
    .await
    .unwrap()
}

#[allow(clippy::too_many_arguments)]
async fn seed_appointment_with_type(
    pool: &PgPool,
    patient_id: Uuid,
    provider_id: Uuid,
    doctor_id: Uuid,
    created_by: Uuid,
    title: &str,
    status: &str,
    date: &str,
    appointment_type: &str,
    location: Option<&str>,
) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO appointments (
                patient_id, provider_id, doctor_id, appointment_type, title, date, status, location, created_by
           ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9
           ) RETURNING id"#,
    )
    .bind(patient_id)
    .bind(provider_id)
    .bind(doctor_id)
    .bind(appointment_type)
    .bind(title)
    .bind(date)
    .bind(status)
    .bind(location)
    .bind(created_by)
    .fetch_one(pool)
    .await
    .unwrap()
}

#[allow(clippy::too_many_arguments)]
async fn seed_appointment_slot(
    pool: &PgPool,
    patient_id: Uuid,
    provider_id: Uuid,
    doctor_id: Uuid,
    created_by: Uuid,
    title: &str,
    status: &str,
    date: &str,
    appointment_type: &str,
    time_start: Option<&str>,
    time_end: Option<&str>,
    interpreter_id: Option<Uuid>,
) -> Uuid {
    let parsed_start = time_start.map(|value| {
        chrono::NaiveTime::parse_from_str(value, "%H:%M").expect("valid appointment time_start")
    });
    let parsed_end = time_end.map(|value| {
        chrono::NaiveTime::parse_from_str(value, "%H:%M").expect("valid appointment time_end")
    });

    sqlx::query_scalar(
        r#"INSERT INTO appointments (
                patient_id, provider_id, doctor_id, interpreter_id, appointment_type, title,
                date, time_start, time_end, status, created_by
           ) VALUES (
                $1, $2, $3, $4, $5, $6,
                $7, $8, $9, $10, $11
           ) RETURNING id"#,
    )
    .bind(patient_id)
    .bind(provider_id)
    .bind(doctor_id)
    .bind(interpreter_id)
    .bind(appointment_type)
    .bind(title)
    .bind(date)
    .bind(parsed_start)
    .bind(parsed_end)
    .bind(status)
    .bind(created_by)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn seed_case(
    pool: &PgPool,
    patient_id: Uuid,
    manager_id: Uuid,
    case_code: &str,
    status: &str,
    reason: &str,
) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO cases (
                case_id, patient_id, manager_id, status, hauptanfragegrund
           ) VALUES (
                $1, $2, $3, $4, $5
           ) RETURNING id"#,
    )
    .bind(case_code)
    .bind(patient_id)
    .bind(manager_id)
    .bind(status)
    .bind(reason)
    .fetch_one(pool)
    .await
    .unwrap()
}

#[tokio::test]
async fn leads_list_supports_search_and_status_filters() {
    let Some((app, pool, admin_id, bearer)) = test_context().await else {
        return;
    };

    let tag = unique_tag("lead-filter");
    let archived_tag = format!("{tag}-archived");

    sqlx::query(
        r#"INSERT INTO leads (
                first_name, last_name, source, country, qualification_status, created_by
           ) VALUES ($1, 'Match', 'Referral', 'UA', 'qualified', $2)"#,
    )
    .bind(tag.clone())
    .bind(admin_id)
    .execute(&pool)
    .await
    .unwrap();

    sqlx::query(
        r#"INSERT INTO leads (
                first_name, last_name, source, country, qualification_status, created_by
           ) VALUES ($1, 'Archive', 'Referral', 'UA', 'archived', $2)"#,
    )
    .bind(archived_tag.clone())
    .bind(admin_id)
    .execute(&pool)
    .await
    .unwrap();

    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/leads?search={tag}&status=qualified"),
        &bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let items = body.as_array().unwrap();
    assert_eq!(items.len(), 1);
    assert_eq!(items[0]["qualification_status"], "qualified");

    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/leads?search={archived_tag}&status=archived&include_archived=true"),
        &bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let items = body.as_array().unwrap();
    assert_eq!(items.len(), 1);
    assert_eq!(items[0]["qualification_status"], "archived");
}

#[tokio::test]
async fn orders_list_supports_search_phase_and_provider_doctor_filters() {
    let Some((app, pool, admin_id, bearer)) = test_context().await else {
        return;
    };

    let tag = unique_tag("order-filter");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let provider_id = seed_provider(&pool, &tag).await;
    let doctor_id = seed_doctor(&pool, provider_id, &tag).await;

    let matching_order = seed_order(
        &pool,
        patient_id,
        admin_id,
        &format!("A-{tag}"),
        "execution",
        "active",
        &format!("Need {tag}"),
    )
    .await;
    seed_leistung(
        &pool,
        matching_order,
        provider_id,
        doctor_id,
        &format!("Service {tag}"),
    )
    .await;

    let other_patient = seed_patient(&pool, admin_id, &format!("{tag}-other")).await;
    let other_order = seed_order(
        &pool,
        other_patient,
        admin_id,
        &format!("A-{tag}-other"),
        "discovery",
        "active",
        "Other need",
    )
    .await;
    seed_leistung(&pool, other_order, provider_id, doctor_id, "Other service").await;

    let (status, body) = json_request(
        &app,
        "GET",
        &format!(
            "/api/v1/orders?search={tag}&phase=execution&provider_id={provider_id}&doctor_id={doctor_id}"
        ),
        &bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let items = body.as_array().unwrap();
    assert_eq!(items.len(), 1);
    assert_eq!(items[0]["phase"], "execution");
    assert_eq!(items[0]["patient_id"], patient_id.to_string());
}

#[tokio::test]
async fn appointments_list_supports_context_and_date_filters() {
    let Some((app, pool, admin_id, bearer)) = test_context().await else {
        return;
    };

    let tag = unique_tag("apt-filter");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let provider_id = seed_provider(&pool, &tag).await;
    let doctor_id = seed_doctor(&pool, provider_id, &tag).await;

    seed_appointment(
        &pool,
        patient_id,
        provider_id,
        doctor_id,
        admin_id,
        &format!("Appointment {tag}"),
        "confirmed",
        "2026-04-18",
    )
    .await;

    seed_appointment(
        &pool,
        patient_id,
        provider_id,
        doctor_id,
        admin_id,
        "Non matching",
        "planned",
        "2026-05-02",
    )
    .await;

    let (status, body) = json_request(
        &app,
        "GET",
        &format!(
            "/api/v1/appointments?search={tag}&status=confirmed&provider_id={provider_id}&doctor_id={doctor_id}&date_from=2026-04-01&date_to=2026-04-30"
        ),
        &bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let items = body.as_array().unwrap();
    assert_eq!(items.len(), 1);
    assert_eq!(items[0]["status"], "confirmed");
    assert_eq!(items[0]["provider_id"], provider_id.to_string());
    assert_eq!(items[0]["doctor_id"], doctor_id.to_string());
}

#[tokio::test]
async fn cases_list_supports_search_and_status_filters() {
    let Some((app, pool, admin_id, bearer)) = test_context().await else {
        return;
    };

    let tag = unique_tag("case-filter");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    seed_case(
        &pool,
        patient_id,
        admin_id,
        &format!("C-{tag}"),
        "open",
        &format!("Reason {tag}"),
    )
    .await;

    let other_patient = seed_patient(&pool, admin_id, &format!("{tag}-other")).await;
    seed_case(
        &pool,
        other_patient,
        admin_id,
        &format!("C-{tag}-other"),
        "closed",
        "Other reason",
    )
    .await;

    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/cases?search={tag}&status=open"),
        &bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let items = body.as_array().unwrap();
    assert_eq!(items.len(), 1);
    assert_eq!(items[0]["status"], "open");
    assert_eq!(items[0]["patient_id"], patient_id.to_string());
}

#[tokio::test]
async fn invalid_filter_values_are_rejected() {
    let Some((app, _, _, bearer)) = test_context().await else {
        return;
    };

    let (status, _) =
        json_request(&app, "GET", "/api/v1/orders?phase=bad-phase", &bearer, None).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);

    let (status, _) = json_request(
        &app,
        "GET",
        "/api/v1/appointments?date_from=2026-99-99",
        &bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
}

#[tokio::test]
async fn appointments_meta_lists_only_active_interpreter_roles() {
    let Some((app, pool, _, _)) = test_context().await else {
        return;
    };

    let tag = unique_tag("apt-meta");
    let pm_id = seed_user(&pool, &tag, "patient_manager").await;
    let interpreter_id = seed_user(&pool, &tag, "interpreter").await;
    let teamlead_id = seed_user(&pool, &tag, "teamlead_interpreter").await;
    let sales_id = seed_user(&pool, &tag, "sales").await;

    sqlx::query("UPDATE users SET is_active = false WHERE id = $1")
        .bind(teamlead_id)
        .execute(&pool)
        .await
        .unwrap();

    let (status, body) = json_request(
        &app,
        "GET",
        "/api/v1/appointments/meta/interpreters",
        &auth_header_for(pm_id, "patient_manager"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let items = body.as_array().unwrap();
    assert!(
        items
            .iter()
            .any(|item| item["id"] == interpreter_id.to_string())
    );
    assert!(
        !items
            .iter()
            .any(|item| item["id"] == teamlead_id.to_string())
    );
    assert!(!items.iter().any(|item| item["id"] == sales_id.to_string()));
}

#[tokio::test]
async fn appointments_report_endpoint_returns_latest_report_state() {
    let Some((app, pool, admin_id, bearer)) = test_context().await else {
        return;
    };

    let tag = unique_tag("apt-report");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let provider_id = seed_provider(&pool, &tag).await;
    let doctor_id = seed_doctor(&pool, provider_id, &tag).await;
    let interpreter_id = seed_user(&pool, &tag, "interpreter").await;

    let appointment_id = seed_appointment(
        &pool,
        patient_id,
        provider_id,
        doctor_id,
        admin_id,
        &format!("Appointment {tag}"),
        "confirmed",
        "2026-04-21",
    )
    .await;

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/appointments/{appointment_id}/assign-interpreter"),
        &bearer,
        Some(json!({ "interpreter_id": interpreter_id })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let interpreter_bearer = auth_header_for(interpreter_id, "interpreter");
    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/appointments/{appointment_id}/report"),
        &interpreter_bearer,
        Some(json!({
            "hours": 2.5,
            "report_text": format!("Report {tag}"),
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    assert!(body["id"].is_string());

    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/appointments/{appointment_id}/report"),
        &bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["interpreter_id"], interpreter_id.to_string());
    assert_eq!(body["approval_status"], "pending");
    assert_eq!(body["hours"], "2.5");

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/appointments/{appointment_id}/report/approve"),
        &bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/appointments/{appointment_id}/report"),
        &bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["approval_status"], "approved");
}

#[tokio::test]
async fn patient_assignment_chain_enforces_supported_roles() {
    let Some((app, pool, admin_id, bearer)) = test_context().await else {
        return;
    };

    let tag = unique_tag("assign-chain");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let pm_id = seed_user(&pool, &tag, "patient_manager").await;
    let teamlead_id = seed_user(&pool, &tag, "teamlead_interpreter").await;
    let interpreter_id = seed_user(&pool, &tag, "interpreter").await;
    let concierge_id = seed_user(&pool, &tag, "concierge").await;
    let billing_id = seed_user(&pool, &tag, "billing").await;

    seed_patient_assignment(&pool, patient_id, pm_id, admin_id).await;
    seed_patient_assignment(&pool, patient_id, teamlead_id, admin_id).await;

    let pm_bearer = auth_header_for(pm_id, "patient_manager");
    let teamlead_bearer = auth_header_for(teamlead_id, "teamlead_interpreter");

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/patients/{patient_id}/assign"),
        &pm_bearer,
        Some(json!({ "user_id": interpreter_id })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/patients/{patient_id}/assign"),
        &pm_bearer,
        Some(json!({ "user_id": concierge_id })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/patients/{patient_id}/assign"),
        &pm_bearer,
        Some(json!({ "user_id": billing_id })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(
        body["message"],
        "This role cannot assign the selected user role"
    );

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/patients/{patient_id}/assign"),
        &teamlead_bearer,
        Some(json!({ "user_id": interpreter_id })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/patients/{patient_id}/assign"),
        &teamlead_bearer,
        Some(json!({ "user_id": concierge_id })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);

    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/patients/{patient_id}/assignments"),
        &bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let items = body.as_array().unwrap();
    assert!(
        items
            .iter()
            .any(|item| item["user_id"] == interpreter_id.to_string())
    );
    assert!(
        items
            .iter()
            .any(|item| item["user_id"] == concierge_id.to_string())
    );
}

#[tokio::test]
async fn interpreter_and_concierge_only_see_assigned_patients() {
    let Some((app, pool, admin_id, _)) = test_context().await else {
        return;
    };

    let tag = unique_tag("patient-visibility");
    let visible_patient_id = seed_patient(&pool, admin_id, &format!("{tag}-visible")).await;
    let hidden_patient_id = seed_patient(&pool, admin_id, &format!("{tag}-hidden")).await;
    let interpreter_id = seed_user(&pool, &tag, "interpreter").await;
    let concierge_id = seed_user(&pool, &tag, "concierge").await;

    seed_patient_assignment(&pool, visible_patient_id, interpreter_id, admin_id).await;
    seed_patient_assignment(&pool, visible_patient_id, concierge_id, admin_id).await;

    let interpreter_bearer = auth_header_for(interpreter_id, "interpreter");
    let concierge_bearer = auth_header_for(concierge_id, "concierge");

    let (status, body) =
        json_request(&app, "GET", "/api/v1/patients", &interpreter_bearer, None).await;
    assert_eq!(status, StatusCode::OK);
    let items = body.as_array().unwrap();
    assert!(
        items
            .iter()
            .any(|item| item["id"] == visible_patient_id.to_string())
    );
    assert!(
        !items
            .iter()
            .any(|item| item["id"] == hidden_patient_id.to_string())
    );

    let (status, body) =
        json_request(&app, "GET", "/api/v1/patients", &concierge_bearer, None).await;
    assert_eq!(status, StatusCode::OK);
    let items = body.as_array().unwrap();
    assert!(
        items
            .iter()
            .any(|item| item["id"] == visible_patient_id.to_string())
    );
    assert!(
        !items
            .iter()
            .any(|item| item["id"] == hidden_patient_id.to_string())
    );
}

#[tokio::test]
async fn concierge_sees_medical_appointments_as_blocked_slots() {
    let Some((app, pool, admin_id, _)) = test_context().await else {
        return;
    };

    let tag = unique_tag("concierge-blocked");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let provider_id = seed_provider(&pool, &tag).await;
    let doctor_id = seed_doctor(&pool, provider_id, &tag).await;
    let concierge_id = seed_user(&pool, &tag, "concierge").await;
    let concierge_bearer = auth_header_for(concierge_id, "concierge");

    seed_patient_assignment(&pool, patient_id, concierge_id, admin_id).await;

    let medical_id = seed_appointment_with_type(
        &pool,
        patient_id,
        provider_id,
        doctor_id,
        admin_id,
        "Cardiology consultation",
        "confirmed",
        "2026-04-22",
        "medical",
        Some("Clinic room A"),
    )
    .await;
    let non_medical_id = seed_appointment_with_type(
        &pool,
        patient_id,
        provider_id,
        doctor_id,
        admin_id,
        "Airport transfer",
        "planned",
        "2026-04-23",
        "non_medical",
        Some("Airport"),
    )
    .await;

    let (status, body) = json_request(
        &app,
        "GET",
        "/api/v1/appointments?date_from=2026-04-01&date_to=2026-04-30",
        &concierge_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let items = body.as_array().unwrap();
    let medical = items
        .iter()
        .find(|item| item["id"] == medical_id.to_string())
        .unwrap();
    assert_eq!(medical["title"], "Blocked medical slot");
    assert_eq!(medical["is_blocked"], true);
    assert!(medical["provider_name"].is_null());
    assert!(medical["location"].is_null());

    let non_medical = items
        .iter()
        .find(|item| item["id"] == non_medical_id.to_string())
        .unwrap();
    assert_eq!(non_medical["title"], "Airport transfer");
    assert_eq!(non_medical["is_blocked"], false);
    assert_eq!(non_medical["location"], "Airport");

    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/appointments/{medical_id}"),
        &concierge_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["title"], "Blocked medical slot");
    assert_eq!(body["is_blocked"], true);
    assert!(body["provider_name"].is_null());
    assert!(body["notes"].is_null());
}

#[tokio::test]
async fn non_medical_appointment_bootstraps_concierge_checklists_tasks_and_reminders() {
    let Some((app, pool, admin_id, _)) = test_context().await else {
        return;
    };

    let tag = unique_tag("concierge-bootstrap");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let provider_id = seed_provider_with_type(&pool, &tag, "non_medical", "Austria").await;
    let doctor_id = seed_doctor(&pool, provider_id, &tag).await;
    let pm_id = seed_user(&pool, &tag, "patient_manager").await;
    let concierge_id = seed_user(&pool, &tag, "concierge").await;

    seed_patient_assignment(&pool, patient_id, pm_id, admin_id).await;
    seed_patient_assignment(&pool, patient_id, concierge_id, admin_id).await;

    let pm_bearer = auth_header_for(pm_id, "patient_manager");
    let concierge_bearer = auth_header_for(concierge_id, "concierge");

    let (status, body) = json_request(
        &app,
        "POST",
        "/api/v1/appointments",
        &pm_bearer,
        Some(json!({
            "patient_id": patient_id,
            "provider_id": provider_id,
            "doctor_id": doctor_id,
            "appointment_type": "non_medical",
            "title": "VIP hotel transfer",
            "date": "2026-05-01",
            "time_start": "11:00",
            "time_end": "12:00"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let appointment_id = body["id"].as_str().unwrap().to_string();

    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/appointments/{appointment_id}/checklist"),
        &concierge_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let items = body.as_array().unwrap();
    assert!(items.len() >= 4);

    let open_item_id = items
        .iter()
        .find(|item| item["is_completed"] == false)
        .and_then(|item| item["id"].as_str())
        .unwrap()
        .to_string();

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/appointments/{appointment_id}/checklist/{open_item_id}/complete"),
        &concierge_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/tasks?appointment_id={appointment_id}"),
        &concierge_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let items = body.as_array().unwrap();
    assert!(items.iter().any(|item| {
        item["title"]
            .as_str()
            .unwrap_or_default()
            .contains("Coordinate concierge service")
    }));

    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/appointments/{appointment_id}/reminders"),
        &concierge_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let items = body.as_array().unwrap();
    assert!(items.iter().any(|item| {
        item["title"]
            .as_str()
            .unwrap_or_default()
            .contains("Upcoming concierge service")
    }));
}

#[tokio::test]
async fn non_medical_appointment_bootstraps_concierge_service_record() {
    let Some((app, pool, admin_id, _)) = test_context().await else {
        return;
    };

    let tag = unique_tag("concierge-service-bootstrap");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let provider_id = seed_provider_with_type(&pool, &tag, "non_medical", "Spain").await;
    let doctor_id = seed_doctor(&pool, provider_id, &tag).await;
    let pm_id = seed_user(&pool, &tag, "patient_manager").await;
    let concierge_id = seed_user(&pool, &tag, "concierge").await;

    seed_patient_assignment(&pool, patient_id, pm_id, admin_id).await;
    seed_patient_assignment(&pool, patient_id, concierge_id, admin_id).await;

    let pm_bearer = auth_header_for(pm_id, "patient_manager");
    let concierge_bearer = auth_header_for(concierge_id, "concierge");

    let (status, body) = json_request(
        &app,
        "POST",
        "/api/v1/appointments",
        &pm_bearer,
        Some(json!({
            "patient_id": patient_id,
            "provider_id": provider_id,
            "doctor_id": doctor_id,
            "appointment_type": "non_medical",
            "title": "Airport transfer",
            "date": "2026-05-02",
            "time_start": "08:00",
            "time_end": "09:00"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let appointment_id = body["id"].as_str().unwrap().to_string();

    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/concierge-services?appointment_id={appointment_id}"),
        &concierge_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let items = body.as_array().unwrap();
    assert_eq!(items.len(), 1);
    assert_eq!(items[0]["title"], "Airport transfer");
    assert_eq!(items[0]["service_kind"], "transfer");
    assert_eq!(items[0]["billing_status"], "draft");
    assert_eq!(items[0]["assigned_concierge_id"], concierge_id.to_string());
}

#[tokio::test]
async fn assign_interpreter_creates_patient_assignment_and_reminder() {
    let Some((app, pool, admin_id, bearer)) = test_context().await else {
        return;
    };

    let tag = unique_tag("assign-reminder");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let provider_id = seed_provider(&pool, &tag).await;
    let doctor_id = seed_doctor(&pool, provider_id, &tag).await;
    let interpreter_id = seed_user(&pool, &tag, "interpreter").await;

    let appointment_id = seed_appointment(
        &pool,
        patient_id,
        provider_id,
        doctor_id,
        admin_id,
        &format!("Appointment {tag}"),
        "confirmed",
        "2026-04-24",
    )
    .await;

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/appointments/{appointment_id}/assign-interpreter"),
        &bearer,
        Some(json!({ "interpreter_id": interpreter_id })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let assignment_exists: bool = sqlx::query_scalar(
        r#"SELECT EXISTS(
            SELECT 1
            FROM patient_assignments
            WHERE patient_id = $1
              AND user_id = $2
              AND revoked_at IS NULL
        )"#,
    )
    .bind(patient_id)
    .bind(interpreter_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(assignment_exists);

    let interpreter_bearer = auth_header_for(interpreter_id, "interpreter");
    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/appointments/{appointment_id}/reminders"),
        &interpreter_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let items = body.as_array().unwrap();
    assert!(items.iter().any(|item| {
        item["title"]
            .as_str()
            .unwrap_or_default()
            .contains("New assignment")
    }));
}

#[tokio::test]
async fn teamlead_can_assign_interpreter_for_assigned_patient() {
    let Some((app, pool, admin_id, _)) = test_context().await else {
        return;
    };

    let tag = unique_tag("teamlead-assign-interpreter");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let provider_id = seed_provider(&pool, &tag).await;
    let doctor_id = seed_doctor(&pool, provider_id, &tag).await;
    let teamlead_id = seed_user(&pool, &tag, "teamlead_interpreter").await;
    let interpreter_id = seed_user(&pool, &format!("{tag}-int"), "interpreter").await;

    seed_patient_assignment(&pool, patient_id, teamlead_id, admin_id).await;
    seed_patient_assignment(&pool, patient_id, interpreter_id, admin_id).await;

    let appointment_id = seed_appointment(
        &pool,
        patient_id,
        provider_id,
        doctor_id,
        admin_id,
        &format!("Appointment {tag}"),
        "confirmed",
        "2026-05-09",
    )
    .await;

    let teamlead_bearer = auth_header_for(teamlead_id, "teamlead_interpreter");
    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/appointments/{appointment_id}/assign-interpreter"),
        &teamlead_bearer,
        Some(json!({ "interpreter_id": interpreter_id })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
}

#[tokio::test]
async fn reminders_can_be_created_by_pm_and_completed_by_assignee() {
    let Some((app, pool, admin_id, _)) = test_context().await else {
        return;
    };

    let tag = unique_tag("reminder-flow");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let provider_id = seed_provider(&pool, &tag).await;
    let doctor_id = seed_doctor(&pool, provider_id, &tag).await;
    let pm_id = seed_user(&pool, &tag, "patient_manager").await;
    let interpreter_id = seed_user(&pool, &tag, "interpreter").await;

    seed_patient_assignment(&pool, patient_id, pm_id, admin_id).await;
    seed_patient_assignment(&pool, patient_id, interpreter_id, admin_id).await;

    let appointment_id = seed_appointment(
        &pool,
        patient_id,
        provider_id,
        doctor_id,
        pm_id,
        &format!("Appointment {tag}"),
        "confirmed",
        "2026-04-25",
    )
    .await;

    let pm_bearer = auth_header_for(pm_id, "patient_manager");
    let interpreter_bearer = auth_header_for(interpreter_id, "interpreter");

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/appointments/{appointment_id}/reminders"),
        &pm_bearer,
        Some(json!({
            "user_id": interpreter_id,
            "remind_at": "2026-04-24T12:00:00+00:00",
            "title": "Bring prep medication",
            "description": "Check colonoscopy prep before visit"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let reminder_id = body["id"].as_str().unwrap().to_string();

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/appointments/{appointment_id}/reminders/{reminder_id}/complete"),
        &interpreter_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/appointments/{appointment_id}/reminders"),
        &pm_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let items = body.as_array().unwrap();
    let completed = items.iter().find(|item| item["id"] == reminder_id).unwrap();
    assert_eq!(completed["is_completed"], true);
}

#[tokio::test]
async fn tasks_can_be_created_for_appointment_and_completed_by_assignee() {
    let Some((app, pool, admin_id, _)) = test_context().await else {
        return;
    };

    let tag = unique_tag("task-flow");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let provider_id = seed_provider(&pool, &tag).await;
    let doctor_id = seed_doctor(&pool, provider_id, &tag).await;
    let pm_id = seed_user(&pool, &tag, "patient_manager").await;
    let interpreter_id = seed_user(&pool, &tag, "interpreter").await;

    seed_patient_assignment(&pool, patient_id, pm_id, admin_id).await;
    seed_patient_assignment(&pool, patient_id, interpreter_id, admin_id).await;

    let appointment_id = seed_appointment(
        &pool,
        patient_id,
        provider_id,
        doctor_id,
        pm_id,
        &format!("Appointment {tag}"),
        "confirmed",
        "2026-04-26",
    )
    .await;

    let pm_bearer = auth_header_for(pm_id, "patient_manager");
    let interpreter_bearer = auth_header_for(interpreter_id, "interpreter");

    let (status, body) = json_request(
        &app,
        "POST",
        "/api/v1/tasks",
        &pm_bearer,
        Some(json!({
            "title": "Prepare briefing",
            "description": "Call clinic before arrival",
            "assigned_to": interpreter_id,
            "appointment_id": appointment_id,
            "priority": "high",
            "due_date": "2026-04-25T09:00:00+00:00"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let task_id = body["id"].as_str().unwrap().to_string();

    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/tasks?appointment_id={appointment_id}"),
        &interpreter_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let items = body.as_array().unwrap();
    assert_eq!(items.len(), 1);
    assert_eq!(items[0]["assigned_to"], interpreter_id.to_string());
    assert_eq!(items[0]["priority"], "high");

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/tasks/{task_id}/status"),
        &interpreter_bearer,
        Some(json!({ "status": "completed" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/tasks/{task_id}"),
        &pm_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["status"], "completed");
}

#[tokio::test]
async fn tasks_require_patient_link_for_operational_assignee() {
    let Some((app, pool, admin_id, _)) = test_context().await else {
        return;
    };

    let tag = unique_tag("task-scope");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let provider_id = seed_provider(&pool, &tag).await;
    let doctor_id = seed_doctor(&pool, provider_id, &tag).await;
    let pm_id = seed_user(&pool, &tag, "patient_manager").await;
    let interpreter_id = seed_user(&pool, &tag, "interpreter").await;

    seed_patient_assignment(&pool, patient_id, pm_id, admin_id).await;

    let appointment_id = seed_appointment(
        &pool,
        patient_id,
        provider_id,
        doctor_id,
        pm_id,
        &format!("Appointment {tag}"),
        "confirmed",
        "2026-04-27",
    )
    .await;

    let pm_bearer = auth_header_for(pm_id, "patient_manager");
    let (status, body) = json_request(
        &app,
        "POST",
        "/api/v1/tasks",
        &pm_bearer,
        Some(json!({
            "title": "Unlinked task",
            "assigned_to": interpreter_id,
            "appointment_id": appointment_id,
            "priority": "normal"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(
        body["message"],
        "Assignee must be linked to patient before task assignment"
    );
}

#[tokio::test]
async fn completed_non_medical_appointment_creates_billing_handoff_task() {
    let Some((app, pool, admin_id, _)) = test_context().await else {
        return;
    };

    let tag = unique_tag("billing-handoff");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let provider_id = seed_provider_with_type(&pool, &tag, "non_medical", "Italy").await;
    let doctor_id = seed_doctor(&pool, provider_id, &tag).await;
    let pm_id = seed_user(&pool, &tag, "patient_manager").await;
    let billing_id = seed_user(&pool, &tag, "billing").await;

    seed_patient_assignment(&pool, patient_id, pm_id, admin_id).await;

    let appointment_id = seed_appointment_with_type(
        &pool,
        patient_id,
        provider_id,
        doctor_id,
        pm_id,
        "VIP chauffeur",
        "confirmed",
        "2026-05-03",
        "non_medical",
        Some("Munich"),
    )
    .await;

    let pm_bearer = auth_header_for(pm_id, "patient_manager");
    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/appointments/{appointment_id}/status"),
        &pm_bearer,
        Some(json!({ "status": "completed" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let billing_bearer = auth_header_for(billing_id, "billing");
    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/tasks?appointment_id={appointment_id}"),
        &billing_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let items = body.as_array().unwrap();
    assert!(items.iter().any(|item| {
        item["assigned_to"] == billing_id.to_string()
            && item["title"]
                .as_str()
                .unwrap_or_default()
                .contains("Billing handoff")
    }));
}

#[tokio::test]
async fn appointments_list_supports_owner_filter() {
    let Some((app, pool, admin_id, bearer)) = test_context().await else {
        return;
    };

    let tag = unique_tag("apt-owner-filter");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let provider_id = seed_provider(&pool, &tag).await;
    let doctor_id = seed_doctor(&pool, provider_id, &tag).await;
    let owner_a = seed_user(&pool, &format!("{tag}-a"), "patient_manager").await;
    let owner_b = seed_user(&pool, &format!("{tag}-b"), "concierge").await;

    let apt_a = seed_appointment(
        &pool,
        patient_id,
        provider_id,
        doctor_id,
        admin_id,
        "Owned by PM",
        "confirmed",
        "2026-05-05",
    )
    .await;
    let apt_b = seed_appointment_with_type(
        &pool,
        patient_id,
        provider_id,
        doctor_id,
        admin_id,
        "Owned by concierge",
        "planned",
        "2026-05-06",
        "non_medical",
        Some("Hotel"),
    )
    .await;

    sqlx::query("UPDATE appointments SET owner_user_id = $2 WHERE id = $1")
        .bind(apt_a)
        .bind(owner_a)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("UPDATE appointments SET owner_user_id = $2 WHERE id = $1")
        .bind(apt_b)
        .bind(owner_b)
        .execute(&pool)
        .await
        .unwrap();

    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/appointments?owner_user_id={owner_b}"),
        &bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let items = body.as_array().unwrap();
    assert_eq!(items.len(), 1);
    assert_eq!(items[0]["id"], apt_b.to_string());
    assert_eq!(items[0]["owner_user_id"], owner_b.to_string());
}

#[tokio::test]
async fn teamlead_can_create_appointment_for_assigned_interpreter_owner() {
    let Some((app, pool, admin_id, _)) = test_context().await else {
        return;
    };

    let tag = unique_tag("teamlead-owner-create");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let provider_id = seed_provider(&pool, &tag).await;
    let doctor_id = seed_doctor(&pool, provider_id, &tag).await;
    let teamlead_id = seed_user(&pool, &tag, "teamlead_interpreter").await;
    let interpreter_id = seed_user(&pool, &format!("{tag}-int"), "interpreter").await;

    seed_patient_assignment(&pool, patient_id, teamlead_id, admin_id).await;
    seed_patient_assignment(&pool, patient_id, interpreter_id, admin_id).await;

    let teamlead_bearer = auth_header_for(teamlead_id, "teamlead_interpreter");
    let (status, body) = json_request(
        &app,
        "POST",
        "/api/v1/appointments",
        &teamlead_bearer,
        Some(json!({
            "patient_id": patient_id,
            "provider_id": provider_id,
            "doctor_id": doctor_id,
            "owner_user_id": interpreter_id,
            "interpreter_id": interpreter_id,
            "appointment_type": "medical",
            "title": "Interpreter-covered consultation",
            "date": "2026-05-07",
            "time_start": "13:00",
            "time_end": "14:00"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let appointment_id = body["id"].as_str().unwrap().to_string();

    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/appointments/{appointment_id}"),
        &teamlead_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["owner_user_id"], interpreter_id.to_string());
    assert_eq!(body["interpreter_id"], interpreter_id.to_string());
}

#[tokio::test]
async fn concierge_can_only_create_non_medical_appointments_for_self_owned_flow() {
    let Some((app, pool, admin_id, _)) = test_context().await else {
        return;
    };

    let tag = unique_tag("concierge-owner-create");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let provider_id = seed_provider_with_type(&pool, &tag, "non_medical", "Austria").await;
    let doctor_id = seed_doctor(&pool, provider_id, &tag).await;
    let concierge_id = seed_user(&pool, &tag, "concierge").await;

    seed_patient_assignment(&pool, patient_id, concierge_id, admin_id).await;

    let concierge_bearer = auth_header_for(concierge_id, "concierge");
    let (status, _) = json_request(
        &app,
        "POST",
        "/api/v1/appointments",
        &concierge_bearer,
        Some(json!({
            "patient_id": patient_id,
            "provider_id": provider_id,
            "doctor_id": doctor_id,
            "owner_user_id": concierge_id,
            "appointment_type": "medical",
            "title": "Forbidden medical slot",
            "date": "2026-05-08"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    let (status, body) = json_request(
        &app,
        "POST",
        "/api/v1/appointments",
        &concierge_bearer,
        Some(json!({
            "patient_id": patient_id,
            "provider_id": provider_id,
            "doctor_id": doctor_id,
            "owner_user_id": concierge_id,
            "appointment_type": "non_medical",
            "title": "Airport VIP handoff",
            "date": "2026-05-08"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(body["conflicts"]["has_conflicts"], false);
}

#[tokio::test]
async fn patient_manager_can_reschedule_appointment_and_reassign_owner() {
    let Some((app, pool, admin_id, _)) = test_context().await else {
        return;
    };

    let tag = unique_tag("apt-update-pm");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let provider_a = seed_provider(&pool, &format!("{tag}-a")).await;
    let doctor_a = seed_doctor(&pool, provider_a, &format!("{tag}-a")).await;
    let provider_b = seed_provider(&pool, &format!("{tag}-b")).await;
    let doctor_b = seed_doctor(&pool, provider_b, &format!("{tag}-b")).await;
    let pm_id = seed_user(&pool, &tag, "patient_manager").await;
    let owner_b = seed_user(&pool, &format!("{tag}-owner"), "concierge").await;

    seed_patient_assignment(&pool, patient_id, pm_id, admin_id).await;

    let appointment_id = seed_appointment_slot(
        &pool,
        patient_id,
        provider_a,
        doctor_a,
        admin_id,
        "Initial consultation",
        "planned",
        "2026-05-12",
        "medical",
        Some("09:00"),
        Some("10:00"),
        None,
    )
    .await;

    seed_appointment_slot(
        &pool,
        patient_id,
        provider_b,
        doctor_b,
        admin_id,
        "Existing overlap",
        "confirmed",
        "2026-05-14",
        "medical",
        Some("13:00"),
        Some("14:00"),
        None,
    )
    .await;

    let pm_bearer = auth_header_for(pm_id, "patient_manager");
    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/appointments/{appointment_id}/update"),
        &pm_bearer,
        Some(json!({
            "provider_id": provider_b,
            "doctor_id": doctor_b,
            "owner_user_id": owner_b,
            "interpreter_id": null,
            "title": "Rescheduled specialist consultation",
            "date": "2026-05-14",
            "time_start": "13:15",
            "time_end": "13:45",
            "location": "Vienna"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["ok"], true);
    assert_eq!(body["conflicts"]["has_conflicts"], true);
    assert_eq!(body["conflicts"]["patient_conflict_count"], 1);

    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/appointments/{appointment_id}"),
        &pm_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["provider_id"], provider_b.to_string());
    assert_eq!(body["doctor_id"], doctor_b.to_string());
    assert_eq!(body["owner_user_id"], owner_b.to_string());
    assert_eq!(body["title"], "Rescheduled specialist consultation");
    assert_eq!(body["date"], "2026-05-14");
    assert_eq!(body["time_start"], "13:15");
    assert_eq!(body["time_end"], "13:45");
    assert_eq!(body["location"], "Vienna");
}

#[tokio::test]
async fn teamlead_cannot_reassign_owner_to_patient_manager_during_reschedule() {
    let Some((app, pool, admin_id, _)) = test_context().await else {
        return;
    };

    let tag = unique_tag("apt-update-teamlead");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let provider_id = seed_provider(&pool, &tag).await;
    let doctor_id = seed_doctor(&pool, provider_id, &tag).await;
    let teamlead_id = seed_user(&pool, &tag, "teamlead_interpreter").await;
    let interpreter_id = seed_user(&pool, &format!("{tag}-int"), "interpreter").await;
    let pm_id = seed_user(&pool, &format!("{tag}-pm"), "patient_manager").await;

    seed_patient_assignment(&pool, patient_id, teamlead_id, admin_id).await;
    seed_patient_assignment(&pool, patient_id, interpreter_id, admin_id).await;

    let appointment_id = seed_appointment_slot(
        &pool,
        patient_id,
        provider_id,
        doctor_id,
        admin_id,
        "Teamlead-owned consultation",
        "planned",
        "2026-05-15",
        "medical",
        Some("10:00"),
        Some("11:00"),
        Some(interpreter_id),
    )
    .await;

    sqlx::query("UPDATE appointments SET owner_user_id = $2 WHERE id = $1")
        .bind(appointment_id)
        .bind(teamlead_id)
        .execute(&pool)
        .await
        .unwrap();

    let teamlead_bearer = auth_header_for(teamlead_id, "teamlead_interpreter");
    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/appointments/{appointment_id}/update"),
        &teamlead_bearer,
        Some(json!({
            "provider_id": provider_id,
            "doctor_id": doctor_id,
            "owner_user_id": pm_id,
            "interpreter_id": interpreter_id,
            "title": "Forbidden owner reassignment",
            "date": "2026-05-15",
            "time_start": "10:30",
            "time_end": "11:30",
            "location": "Remote"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/appointments/{appointment_id}/update"),
        &teamlead_bearer,
        Some(json!({
            "provider_id": provider_id,
            "doctor_id": doctor_id,
            "owner_user_id": interpreter_id,
            "interpreter_id": interpreter_id,
            "title": "Interpreter-owned follow-up",
            "date": "2026-05-15",
            "time_start": "10:30",
            "time_end": "11:30",
            "location": "Remote"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["ok"], true);

    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/appointments/{appointment_id}"),
        &teamlead_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["owner_user_id"], interpreter_id.to_string());
}

#[tokio::test]
async fn reschedule_with_same_interpreter_resets_response_and_creates_reminder() {
    let Some((app, pool, admin_id, _)) = test_context().await else {
        return;
    };

    let tag = unique_tag("apt-update-interpreter");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let provider_id = seed_provider(&pool, &tag).await;
    let doctor_id = seed_doctor(&pool, provider_id, &tag).await;
    let pm_id = seed_user(&pool, &tag, "patient_manager").await;
    let interpreter_id = seed_user(&pool, &format!("{tag}-int"), "interpreter").await;

    seed_patient_assignment(&pool, patient_id, pm_id, admin_id).await;
    seed_patient_assignment(&pool, patient_id, interpreter_id, admin_id).await;

    let appointment_id = seed_appointment_slot(
        &pool,
        patient_id,
        provider_id,
        doctor_id,
        admin_id,
        "Interpreter scheduled consultation",
        "confirmed",
        "2026-05-16",
        "medical",
        Some("11:00"),
        Some("12:00"),
        Some(interpreter_id),
    )
    .await;

    sqlx::query(
        "UPDATE appointments SET interpreter_response = 'accepted', owner_user_id = $2 WHERE id = $1",
    )
    .bind(appointment_id)
    .bind(pm_id)
    .execute(&pool)
    .await
    .unwrap();

    let pm_bearer = auth_header_for(pm_id, "patient_manager");
    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/appointments/{appointment_id}/update"),
        &pm_bearer,
        Some(json!({
            "provider_id": provider_id,
            "doctor_id": doctor_id,
            "owner_user_id": pm_id,
            "interpreter_id": interpreter_id,
            "title": "Interpreter scheduled consultation",
            "date": "2026-05-16",
            "time_start": "12:00",
            "time_end": "13:00",
            "location": "Clinic room 2"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["ok"], true);

    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/appointments/{appointment_id}"),
        &pm_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["interpreter_response"], "pending");
    assert_eq!(body["time_start"], "12:00");
    assert_eq!(body["time_end"], "13:00");

    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/appointments/{appointment_id}/reminders"),
        &pm_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let items = body.as_array().unwrap();
    assert!(items.iter().any(|item| {
        item["user_id"] == interpreter_id.to_string()
            && item["title"]
                .as_str()
                .unwrap_or_default()
                .contains("Appointment updated")
    }));
}

#[tokio::test]
async fn concierge_can_reschedule_non_medical_but_not_medical_appointments() {
    let Some((app, pool, admin_id, _)) = test_context().await else {
        return;
    };

    let tag = unique_tag("apt-update-concierge");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let provider_id = seed_provider_with_type(&pool, &tag, "non_medical", "Austria").await;
    let doctor_id = seed_doctor(&pool, provider_id, &tag).await;
    let concierge_id = seed_user(&pool, &tag, "concierge").await;

    seed_patient_assignment(&pool, patient_id, concierge_id, admin_id).await;

    let non_medical_id = seed_appointment_with_type(
        &pool,
        patient_id,
        provider_id,
        doctor_id,
        admin_id,
        "Airport pickup",
        "planned",
        "2026-05-17",
        "non_medical",
        Some("Airport"),
    )
    .await;
    let medical_id = seed_appointment_with_type(
        &pool,
        patient_id,
        provider_id,
        doctor_id,
        admin_id,
        "Clinical check",
        "planned",
        "2026-05-18",
        "medical",
        Some("Clinic"),
    )
    .await;

    sqlx::query("UPDATE appointments SET owner_user_id = $2 WHERE id = $1")
        .bind(non_medical_id)
        .bind(concierge_id)
        .execute(&pool)
        .await
        .unwrap();

    let concierge_bearer = auth_header_for(concierge_id, "concierge");
    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/appointments/{non_medical_id}/update"),
        &concierge_bearer,
        Some(json!({
            "provider_id": provider_id,
            "doctor_id": doctor_id,
            "owner_user_id": concierge_id,
            "interpreter_id": null,
            "title": "Airport pickup rescheduled",
            "date": "2026-05-17",
            "time_start": "18:00",
            "time_end": "19:00",
            "location": "VIP terminal"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["ok"], true);

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/appointments/{medical_id}/update"),
        &concierge_bearer,
        Some(json!({
            "provider_id": provider_id,
            "doctor_id": doctor_id,
            "owner_user_id": concierge_id,
            "interpreter_id": null,
            "title": "Forbidden medical reschedule",
            "date": "2026-05-18",
            "time_start": "09:00",
            "time_end": "10:00",
            "location": "Clinic"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn concierge_service_update_and_completion_flow_sets_ready_for_billing() {
    let Some((app, pool, admin_id, _)) = test_context().await else {
        return;
    };

    let tag = unique_tag("concierge-service-flow");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let provider_id = seed_provider_with_type(&pool, &tag, "non_medical", "France").await;
    let doctor_id = seed_doctor(&pool, provider_id, &tag).await;
    let pm_id = seed_user(&pool, &tag, "patient_manager").await;
    let concierge_id = seed_user(&pool, &tag, "concierge").await;
    let billing_id = seed_user(&pool, &tag, "billing").await;

    seed_patient_assignment(&pool, patient_id, pm_id, admin_id).await;
    seed_patient_assignment(&pool, patient_id, concierge_id, admin_id).await;

    let pm_bearer = auth_header_for(pm_id, "patient_manager");
    let concierge_bearer = auth_header_for(concierge_id, "concierge");
    let billing_bearer = auth_header_for(billing_id, "billing");

    let (status, body) = json_request(
        &app,
        "POST",
        "/api/v1/appointments",
        &pm_bearer,
        Some(json!({
            "patient_id": patient_id,
            "provider_id": provider_id,
            "doctor_id": doctor_id,
            "appointment_type": "non_medical",
            "title": "VIP chauffeur",
            "date": "2026-05-04",
            "time_start": "12:00",
            "time_end": "14:00"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let appointment_id = body["id"].as_str().unwrap().to_string();

    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/concierge-services?appointment_id={appointment_id}"),
        &concierge_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let service_id = body[0]["id"].as_str().unwrap().to_string();

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/concierge-services/{service_id}/update"),
        &concierge_bearer,
        Some(json!({
            "status": "booked",
            "booking_reference": "VIP-REF-42",
            "vendor_name": "Elite Drives",
            "actual_cost": 189.50,
            "service_notes": "Pickup confirmed with chauffeur"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["status"], "booked");
    assert_eq!(body["booking_reference"], "VIP-REF-42");
    assert_eq!(body["vendor_name"], "Elite Drives");
    assert_eq!(body["actual_cost"], "189.50");

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/appointments/{appointment_id}/status"),
        &pm_bearer,
        Some(json!({ "status": "completed" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/concierge-services/{service_id}"),
        &billing_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["status"], "completed");
    assert_eq!(body["billing_status"], "ready");

    let (status, body) = json_request(
        &app,
        "GET",
        "/api/v1/concierge-services?billing_status=ready&service_kind=chauffeur",
        &billing_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let items = body.as_array().unwrap();
    assert!(items.iter().any(|item| item["id"] == service_id));
}

#[tokio::test]
async fn appointment_conflicts_endpoint_reports_patient_and_interpreter_overlaps() {
    let Some((app, pool, admin_id, bearer)) = test_context().await else {
        return;
    };

    let tag = unique_tag("apt-conflicts");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let other_patient_id = seed_patient(&pool, admin_id, &format!("{tag}-other")).await;
    let provider_id = seed_provider(&pool, &tag).await;
    let doctor_id = seed_doctor(&pool, provider_id, &tag).await;
    let interpreter_id = seed_user(&pool, &tag, "interpreter").await;

    seed_appointment_slot(
        &pool,
        patient_id,
        provider_id,
        doctor_id,
        admin_id,
        "Patient overlap",
        "confirmed",
        "2026-04-28",
        "medical",
        Some("10:00"),
        Some("11:00"),
        Some(interpreter_id),
    )
    .await;

    seed_appointment_slot(
        &pool,
        other_patient_id,
        provider_id,
        doctor_id,
        admin_id,
        "Interpreter overlap",
        "planned",
        "2026-04-28",
        "medical",
        Some("10:30"),
        Some("11:30"),
        Some(interpreter_id),
    )
    .await;

    let (status, body) = json_request(
        &app,
        "GET",
        &format!(
            "/api/v1/appointments/meta/conflicts?patient_id={patient_id}&interpreter_id={interpreter_id}&date=2026-04-28&time_start=10:15&time_end=10:45"
        ),
        &bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["has_conflicts"], true);
    assert_eq!(body["patient_conflict_count"], 1);
    assert_eq!(body["interpreter_conflict_count"], 2);
    assert_eq!(body["patient_conflicts"][0]["title"], "Patient overlap");
}

#[tokio::test]
async fn create_appointment_returns_conflict_payload_with_interpreter_context() {
    let Some((app, pool, admin_id, bearer)) = test_context().await else {
        return;
    };

    let tag = unique_tag("apt-create-conflict");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let provider_id = seed_provider(&pool, &tag).await;
    let doctor_id = seed_doctor(&pool, provider_id, &tag).await;
    let interpreter_id = seed_user(&pool, &tag, "interpreter").await;

    seed_appointment_slot(
        &pool,
        patient_id,
        provider_id,
        doctor_id,
        admin_id,
        "Existing overlap",
        "confirmed",
        "2026-04-29",
        "medical",
        Some("09:00"),
        Some("10:00"),
        Some(interpreter_id),
    )
    .await;

    let (status, body) = json_request(
        &app,
        "POST",
        "/api/v1/appointments",
        &bearer,
        Some(json!({
            "patient_id": patient_id,
            "provider_id": provider_id,
            "doctor_id": doctor_id,
            "interpreter_id": interpreter_id,
            "appointment_type": "medical",
            "title": "New conflicting appointment",
            "date": "2026-04-29",
            "time_start": "09:30",
            "time_end": "10:15"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(body["conflicts"]["has_conflicts"], true);
    assert_eq!(body["conflicts"]["patient_conflict_count"], 1);
    assert_eq!(body["conflicts"]["interpreter_conflict_count"], 1);
}

#[tokio::test]
async fn providers_list_supports_country_and_doctor_filters() {
    let Some((app, pool, admin_id, _)) = test_context().await else {
        return;
    };

    let tag = unique_tag("provider-filters");
    let non_medical_provider_id =
        seed_provider_with_type(&pool, &format!("{tag}-travel"), "non_medical", "Poland").await;
    let medical_provider_id =
        seed_provider_with_type(&pool, &format!("{tag}-clinic"), "medical", "Germany").await;

    sqlx::query("UPDATE providers SET fachbereich = $2 WHERE id = $1")
        .bind(non_medical_provider_id)
        .bind("Travel assistance")
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("UPDATE providers SET fachbereich = $2 WHERE id = $1")
        .bind(medical_provider_id)
        .bind("Cardiology")
        .execute(&pool)
        .await
        .unwrap();

    let _ = seed_doctor(&pool, non_medical_provider_id, &format!("{tag}-guide")).await;
    let _ = seed_service(
        &pool,
        non_medical_provider_id,
        "VIP transfer",
        "Airport and hotel concierge support",
    )
    .await;
    sqlx::query(
        r#"UPDATE provider_doctors
           SET name = $2, fachbereich = $3
           WHERE provider_id = $1"#,
    )
    .bind(non_medical_provider_id)
    .bind("Guide Anna")
    .bind("Travel")
    .execute(&pool)
    .await
    .unwrap();

    let _ = seed_doctor(&pool, medical_provider_id, &format!("{tag}-cardio")).await;
    sqlx::query(
        r#"UPDATE provider_doctors
           SET name = $2, fachbereich = $3
           WHERE provider_id = $1"#,
    )
    .bind(medical_provider_id)
    .bind("Dr Cardio")
    .bind("Cardiology")
    .execute(&pool)
    .await
    .unwrap();

    let sales_bearer = auth_header_for(admin_id, "ceo");
    let (status, body) = json_request(
        &app,
        "GET",
        "/api/v1/providers?provider_type=non_medical&country=Poland&doctor_name=Guide&doctor_fachbereich=Travel&service_name=transfer",
        &sales_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let items = body.as_array().unwrap();
    assert_eq!(items.len(), 1);
    assert_eq!(items[0]["id"], non_medical_provider_id.to_string());
    assert_eq!(items[0]["provider_type"], "non_medical");
}
