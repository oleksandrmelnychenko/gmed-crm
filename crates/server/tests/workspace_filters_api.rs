use axum::body::Body;
use axum::http::{Request, StatusCode};
use serde_json::{Value, json};
use sqlx::{PgPool, Row};
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

async fn bytes_request(
    app: &axum::Router,
    method: &str,
    path: &str,
    bearer: &str,
) -> (StatusCode, Vec<u8>) {
    let req = Request::builder()
        .method(method)
        .uri(path)
        .header("Authorization", bearer)
        .body(Body::empty())
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    let status = resp.status();
    let bytes = axum::body::to_bytes(resp.into_body(), 4 * 1024 * 1024)
        .await
        .unwrap();
    (status, bytes.to_vec())
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

async fn seed_leistung_returning_id(
    pool: &PgPool,
    order_id: Uuid,
    provider_id: Uuid,
    doctor_id: Uuid,
    description: &str,
) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO order_leistungen (
                order_id, description, quantity, unit_price, vat_rate, provider_id, doctor_id
           ) VALUES (
                $1, $2, $3, $4, $5, $6, $7
           ) RETURNING id"#,
    )
    .bind(order_id)
    .bind(description)
    .bind(1.0_f64)
    .bind(150.0_f64)
    .bind(19.0_f64)
    .bind(provider_id)
    .bind(doctor_id)
    .fetch_one(pool)
    .await
    .unwrap()
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
async fn patients_list_supports_provider_and_doctor_filters_across_appointments_and_orders() {
    let Some((app, pool, admin_id, bearer)) = test_context().await else {
        return;
    };

    let tag = unique_tag("patient-provider-filter");
    let provider_id = seed_provider(&pool, &tag).await;
    let doctor_id = seed_doctor(&pool, provider_id, &tag).await;

    let appointment_patient = seed_patient(&pool, admin_id, &format!("{tag}-apt")).await;
    seed_appointment(
        &pool,
        appointment_patient,
        provider_id,
        doctor_id,
        admin_id,
        &format!("Appointment {tag}"),
        "confirmed",
        "2026-04-18",
    )
    .await;

    let order_patient = seed_patient(&pool, admin_id, &format!("{tag}-order")).await;
    let order_id = seed_order(
        &pool,
        order_patient,
        admin_id,
        &format!("O-{tag}"),
        "execution",
        "active",
        "Need provider-doctor linked service",
    )
    .await;
    seed_leistung(
        &pool,
        order_id,
        provider_id,
        doctor_id,
        &format!("Service {tag}"),
    )
    .await;

    let other_provider_id = seed_provider(&pool, &format!("{tag}-other")).await;
    let other_doctor_id = seed_doctor(&pool, other_provider_id, &format!("{tag}-other")).await;
    let hidden_patient = seed_patient(&pool, admin_id, &format!("{tag}-hidden")).await;
    seed_appointment(
        &pool,
        hidden_patient,
        other_provider_id,
        other_doctor_id,
        admin_id,
        "Other appointment",
        "confirmed",
        "2026-04-19",
    )
    .await;

    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/patients?provider_id={provider_id}&doctor_id={doctor_id}"),
        &bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let items = body.as_array().unwrap();
    assert_eq!(items.len(), 2);
    let ids: Vec<_> = items
        .iter()
        .filter_map(|item| item["id"].as_str())
        .collect();
    assert!(ids.contains(&appointment_patient.to_string().as_str()));
    assert!(ids.contains(&order_patient.to_string().as_str()));
    assert!(!ids.contains(&hidden_patient.to_string().as_str()));
}

#[tokio::test]
async fn order_detail_includes_provider_and_doctor_chain_for_leistungen() {
    let Some((app, pool, admin_id, _)) = test_context().await else {
        return;
    };

    let tag = unique_tag("order-detail-chain");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let provider_id = seed_provider(&pool, &tag).await;
    let doctor_id = seed_doctor(&pool, provider_id, &tag).await;
    let order_id = seed_order(
        &pool,
        patient_id,
        admin_id,
        &format!("O-{tag}"),
        "execution",
        "active",
        "Needs linked provider and doctor details",
    )
    .await;
    seed_leistung(
        &pool,
        order_id,
        provider_id,
        doctor_id,
        &format!("Cardio package {tag}"),
    )
    .await;

    let billing_id = seed_user(&pool, &tag, "billing").await;
    let billing_bearer = auth_header_for(billing_id, "billing");

    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/orders/{order_id}"),
        &billing_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let leistungen = body["leistungen"].as_array().unwrap();
    assert_eq!(leistungen.len(), 1);
    assert_eq!(leistungen[0]["provider_id"], provider_id.to_string());
    assert_eq!(leistungen[0]["doctor_id"], doctor_id.to_string());
    assert_eq!(leistungen[0]["provider_name"], format!("Clinic {tag}"));
    assert_eq!(leistungen[0]["doctor_name"], format!("Doctor {tag}"));
}

#[tokio::test]
async fn billing_sees_order_leistung_vat_and_cost_passthrough_fields() {
    let Some((app, pool, admin_id, _)) = test_context().await else {
        return;
    };

    let tag = unique_tag("billing-leistung-values");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let provider_id = seed_provider(&pool, &tag).await;
    let doctor_id = seed_doctor(&pool, provider_id, &tag).await;
    let pm_id = seed_user(&pool, &tag, "patient_manager").await;
    let billing_id = seed_user(&pool, &tag, "billing").await;

    seed_patient_assignment(&pool, patient_id, pm_id, admin_id).await;

    let order_id = seed_order(
        &pool,
        patient_id,
        admin_id,
        &format!("O-{tag}"),
        "execution",
        "active",
        "Billing intake values",
    )
    .await;

    let pm_bearer = auth_header_for(pm_id, "patient_manager");
    let billing_bearer = auth_header_for(billing_id, "billing");

    let (status, first_body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/orders/{order_id}/leistungen"),
        &pm_bearer,
        Some(json!({
            "description": "Organisation der Behandlung",
            "quantity": 2.0,
            "unit_price": 150.0,
            "provider_id": provider_id,
            "doctor_id": doctor_id,
            "notes": "Default VAT service"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let first_id = first_body["id"].as_str().unwrap().to_string();

    let (status, second_body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/orders/{order_id}/leistungen"),
        &pm_bearer,
        Some(json!({
            "description": "Clinic invoice passthrough",
            "quantity": 1.0,
            "unit_price": 480.0,
            "vat_rate": 0.0,
            "is_cost_passthrough": true,
            "provider_id": provider_id,
            "doctor_id": doctor_id,
            "notes": "External invoice"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let second_id = second_body["id"].as_str().unwrap().to_string();

    let first_row = sqlx::query(
        "SELECT vat_rate::text AS vat_rate, is_cost_passthrough FROM order_leistungen WHERE id = $1",
    )
    .bind(Uuid::parse_str(&first_id).unwrap())
    .fetch_one(&pool)
    .await
    .unwrap();
    let second_row = sqlx::query(
        "SELECT vat_rate::text AS vat_rate, is_cost_passthrough FROM order_leistungen WHERE id = $1",
    )
    .bind(Uuid::parse_str(&second_id).unwrap())
    .fetch_one(&pool)
    .await
    .unwrap();

    let first_vat = first_row.try_get::<String, _>("vat_rate").unwrap();
    assert!(first_vat == "19" || first_vat == "19.0");
    assert!(!first_row.try_get::<bool, _>("is_cost_passthrough").unwrap());
    let second_vat = second_row.try_get::<String, _>("vat_rate").unwrap();
    assert!(second_vat == "0" || second_vat == "0.0");
    assert!(
        second_row
            .try_get::<bool, _>("is_cost_passthrough")
            .unwrap()
    );

    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/orders/{order_id}/leistungen"),
        &billing_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let items = body.as_array().unwrap();
    assert_eq!(items.len(), 2);

    let default_item = items
        .iter()
        .find(|item| item["id"] == first_id)
        .expect("default VAT leistung visible");
    let passthrough_item = items
        .iter()
        .find(|item| item["id"] == second_id)
        .expect("cost passthrough leistung visible");

    assert_eq!(default_item["is_cost_passthrough"], false);
    assert_eq!(passthrough_item["is_cost_passthrough"], true);
    assert_eq!(default_item["provider_id"], provider_id.to_string());
    assert_eq!(passthrough_item["doctor_id"], doctor_id.to_string());
}

#[tokio::test]
async fn only_patient_manager_can_approve_delivered_leistung_for_billing_flow() {
    let Some((app, pool, admin_id, _)) = test_context().await else {
        return;
    };

    let tag = unique_tag("billing-approve");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let provider_id = seed_provider(&pool, &tag).await;
    let doctor_id = seed_doctor(&pool, provider_id, &tag).await;
    let pm_id = seed_user(&pool, &tag, "patient_manager").await;
    let billing_id = seed_user(&pool, &tag, "billing").await;

    seed_patient_assignment(&pool, patient_id, pm_id, admin_id).await;

    let order_id = seed_order(
        &pool,
        patient_id,
        admin_id,
        &format!("O-{tag}"),
        "execution",
        "active",
        "Delivered leistung approval",
    )
    .await;
    let leistung_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO order_leistungen (
                order_id, description, quantity, unit_price, vat_rate, provider_id, doctor_id
           ) VALUES (
                $1, $2, $3, $4, $5, $6, $7
           ) RETURNING id"#,
    )
    .bind(order_id)
    .bind("Delivered interpreter and coordination package")
    .bind(1.0_f64)
    .bind(150.0_f64)
    .bind(19.0_f64)
    .bind(provider_id)
    .bind(doctor_id)
    .fetch_one(&pool)
    .await
    .unwrap();

    sqlx::query(
        "UPDATE order_leistungen SET status = 'delivered', delivered_at = now() WHERE id = $1",
    )
    .bind(leistung_id)
    .execute(&pool)
    .await
    .unwrap();

    let pm_bearer = auth_header_for(pm_id, "patient_manager");
    let billing_bearer = auth_header_for(billing_id, "billing");

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/orders/{order_id}/leistungen/{leistung_id}/approve"),
        &billing_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/orders/{order_id}/leistungen/{leistung_id}/approve"),
        &pm_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["ok"], true);

    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/orders/{order_id}"),
        &billing_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let approved_item = body["leistungen"]
        .as_array()
        .unwrap()
        .iter()
        .find(|item| item["id"] == leistung_id.to_string())
        .cloned()
        .expect("approved leistung present in billing detail");

    assert_eq!(approved_item["status"], "approved");
    assert!(approved_item["approved_at"].as_str().is_some());
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
async fn case_doctor_registry_metadata_and_fk_round_trip_work() {
    let Some((app, pool, admin_id, _)) = test_context().await else {
        return;
    };

    let tag = unique_tag("case-doctor-fk");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let pm_id = seed_user(&pool, &tag, "patient_manager").await;
    seed_patient_assignment(&pool, patient_id, pm_id, admin_id).await;
    let pm_bearer = auth_header_for(pm_id, "patient_manager");

    let provider_id = seed_provider(&pool, &tag).await;
    let doctor_id = seed_doctor(&pool, provider_id, &tag).await;

    let (status, doctors_body) =
        json_request(&app, "GET", "/api/v1/cases/meta/doctors", &pm_bearer, None).await;
    assert_eq!(status, StatusCode::OK);
    let doctors = doctors_body.as_array().expect("doctors array");
    assert!(
        doctors.iter().any(|item| {
            item["id"] == doctor_id.to_string() && item["provider_id"] == provider_id.to_string()
        }),
        "expected seeded doctor in case doctor registry metadata"
    );

    let (status, created_body) = json_request(
        &app,
        "POST",
        "/api/v1/cases",
        &pm_bearer,
        Some(json!({
            "patient_id": patient_id,
            "hauptanfragegrund": "Doctor FK case",
            "zuweiser_doctor_id": doctor_id
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let case_id = Uuid::parse_str(created_body["id"].as_str().expect("created case id")).unwrap();

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/cases/{case_id}/operationen"),
        &pm_bearer,
        Some(json!({
            "items": [{
                "datum": "2026-04-01",
                "grund": "Shoulder surgery",
                "arzt_id": doctor_id,
                "notiz": "registry linked"
            }]
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["count"], 1);

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/cases/{case_id}/medikamente"),
        &pm_bearer,
        Some(json!({
            "items": [{
                "handelsname": "Medication A",
                "med_typ": "permanent",
                "verordnender_arzt_id": doctor_id
            }]
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["count"], 1);

    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/cases/{case_id}"),
        &pm_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["zuweiser_doctor_id"], doctor_id.to_string());
    assert_eq!(body["zuweiser"], format!("Doctor {tag}"));
    assert_eq!(body["operationen"][0]["arzt_id"], doctor_id.to_string());
    assert_eq!(body["operationen"][0]["arzt"], format!("Doctor {tag}"));
    assert_eq!(
        body["medikamente"][0]["verordnender_arzt_id"],
        doctor_id.to_string()
    );
    assert_eq!(
        body["medikamente"][0]["verordnender_arzt"],
        format!("Doctor {tag}")
    );
}

#[tokio::test]
async fn case_cardiology_subflow_round_trip_works() {
    let Some((app, pool, admin_id, _)) = test_context().await else {
        return;
    };

    let tag = unique_tag("case-cardiology");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let pm_id = seed_user(&pool, &tag, "patient_manager").await;
    seed_patient_assignment(&pool, patient_id, pm_id, admin_id).await;
    let pm_bearer = auth_header_for(pm_id, "patient_manager");

    let (status, created_body) = json_request(
        &app,
        "POST",
        "/api/v1/cases",
        &pm_bearer,
        Some(json!({
            "patient_id": patient_id,
            "hauptanfragegrund": "Cardiology case"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let case_id = Uuid::parse_str(created_body["id"].as_str().expect("created case id")).unwrap();

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/cases/{case_id}/symptome"),
        &pm_bearer,
        Some(json!({
            "items": [{
                "beschreibung": "Chest pain on exertion",
                "fachrichtung": "cardiology"
            }]
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["count"], 1);

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/cases/{case_id}/cardiology"),
        &pm_bearer,
        Some(json!({
            "is_relevant": true,
            "chest_pain": true,
            "dyspnea": true,
            "palpitations": false,
            "syncope": false,
            "edema": false,
            "known_diagnosis": "Hypertension",
            "prior_cardiac_workup": "Echo 2025",
            "cardiovascular_risk_factors": "Smoking history",
            "anticoagulation": "None",
            "family_history": "Father with CAD",
            "red_flags": "Exertional chest pain",
            "notes": "Needs cardiology workup"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/cases/{case_id}"),
        &pm_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["cardiology_recommended"], true);
    assert_eq!(body["cardiology"]["is_relevant"], true);
    assert_eq!(body["cardiology"]["chest_pain"], true);
    assert_eq!(body["cardiology"]["known_diagnosis"], "Hypertension");
    assert_eq!(body["cardiology"]["prior_cardiac_workup"], "Echo 2025");
    assert_eq!(body["cardiology"]["notes"], "Needs cardiology workup");
}

#[tokio::test]
async fn case_history_exposes_system_uuid_retention_and_append_only_versions() {
    let Some((app, pool, admin_id, _)) = test_context().await else {
        return;
    };

    let tag = unique_tag("case-history");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let pm_id = seed_user(&pool, &tag, "patient_manager").await;
    seed_patient_assignment(&pool, patient_id, pm_id, admin_id).await;
    let pm_bearer = auth_header_for(pm_id, "patient_manager");

    let (status, created_body) = json_request(
        &app,
        "POST",
        "/api/v1/cases",
        &pm_bearer,
        Some(json!({
            "patient_id": patient_id,
            "hauptanfragegrund": "Clinical retention case",
            "aktuelle_anamnese": "Initial narrative"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let case_id = Uuid::parse_str(created_body["id"].as_str().expect("created case id")).unwrap();
    assert_eq!(created_body["case_uuid"], case_id.to_string());
    assert!(created_body["retention_until"].as_str().is_some());

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/cases/{case_id}/anamnesis"),
        &pm_bearer,
        Some(json!({
            "aktuelle_anamnese": "Updated narrative"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/cases/{case_id}/vegetative"),
        &pm_bearer,
        Some(json!({
            "appetit_durst": "Reduced appetite",
            "koerpergroesse": 172.0,
            "gewicht": 68.5,
            "gewichtsveraenderung": "Recent loss",
            "grund": "Stress"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/cases/{case_id}"),
        &pm_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["case_uuid"], case_id.to_string());
    assert!(body["retention_until"].as_str().is_some());
    assert!(body["last_clinical_update_at"].as_str().is_some());
    assert!(body["version_count"].as_i64().unwrap_or_default() >= 3);
    assert!(
        body["history"]
            .as_array()
            .is_some_and(|items| !items.is_empty())
    );

    let (status, history_body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/cases/{case_id}/history?limit=10"),
        &pm_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let history = history_body.as_array().expect("history array");
    let overview_entry = history
        .iter()
        .find(|entry| entry["section"] == "overview" && entry["old_value"].is_object())
        .expect("overview history entry with old/new payload");
    assert_eq!(
        overview_entry["old_value"]["aktuelle_anamnese"],
        "Initial narrative"
    );
    assert_eq!(
        overview_entry["new_value"]["aktuelle_anamnese"],
        "Updated narrative"
    );

    let version_id = history[0]["id"].as_i64().expect("history row id");
    let update_attempt = sqlx::query("UPDATE case_versions SET section = 'tampered' WHERE id = $1")
        .bind(version_id)
        .execute(&pool)
        .await;
    assert!(update_attempt.is_err(), "case_versions must be immutable");
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
async fn patient_detail_view_audit_logs_visible_fields_for_role_filtered_payload() {
    let Some((app, pool, admin_id, _)) = test_context().await else {
        return;
    };

    let tag = unique_tag("patient-view-audit");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    sqlx::query("UPDATE patients SET functional_labels = $2 WHERE id = $1")
        .bind(patient_id)
        .bind(vec!["vip".to_string(), "high_risk".to_string()])
        .execute(&pool)
        .await
        .unwrap();
    let interpreter_id = seed_user(&pool, &tag, "interpreter").await;
    seed_patient_assignment(&pool, patient_id, interpreter_id, admin_id).await;
    let interpreter_bearer = auth_header_for(interpreter_id, "interpreter");

    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/patients/{patient_id}"),
        &interpreter_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(body.get("email").is_some());
    assert!(body.get("insurance_provider").is_none());
    assert!(body.get("insurance_number").is_none());
    assert!(body.get("legal_status").is_none());
    assert!(body.get("notes").is_none());
    assert_eq!(body["functional_labels"][0], "vip");
    assert_eq!(body["functional_labels"][1], "high_risk");

    let context: Value = sqlx::query_scalar(
        r#"SELECT context
           FROM audit_log
           WHERE action = 'view_patient'
             AND entity_type = 'patient'
             AND entity_id = $1
           ORDER BY created_at DESC
           LIMIT 1"#,
    )
    .bind(patient_id)
    .fetch_one(&pool)
    .await
    .unwrap();

    assert_eq!(context["role"], "interpreter");
    let visible_fields = context["visible_fields"]
        .as_array()
        .expect("visible_fields array");
    assert!(visible_fields.iter().any(|field| field == "email"));
    assert!(
        visible_fields
            .iter()
            .all(|field| field != "insurance_provider")
    );
    assert!(
        visible_fields
            .iter()
            .all(|field| field != "insurance_number")
    );
    assert!(visible_fields.iter().all(|field| field != "legal_status"));
    assert!(visible_fields.iter().all(|field| field != "notes"));
    assert!(
        visible_fields
            .iter()
            .any(|field| field == "functional_labels")
    );
}

#[tokio::test]
async fn patient_manager_can_fetch_patient_label_payload() {
    let Some((app, pool, admin_id, _)) = test_context().await else {
        return;
    };

    let tag = unique_tag("patient-label");
    let patient_uuid = seed_patient(&pool, admin_id, &tag).await;
    let pm_id = seed_user(&pool, &tag, "patient_manager").await;
    let pm_bearer = auth_header_for(pm_id, "patient_manager");
    seed_patient_assignment(&pool, patient_uuid, pm_id, admin_id).await;

    sqlx::query(
        r#"UPDATE patients
           SET title = $2,
               first_name = $3,
               last_name = $4,
               birth_date = $5,
               gender = $6,
               nationality = $7,
               residence_country = $8,
               insurance_provider = $9
           WHERE id = $1"#,
    )
    .bind(patient_uuid)
    .bind("Dr.")
    .bind("Max")
    .bind("Mustermann")
    .bind("1990-04-10")
    .bind("male")
    .bind("Deutschland")
    .bind("Germany")
    .bind("AXA")
    .execute(&pool)
    .await
    .unwrap();

    for (key, value, description) in [
        ("agency_name", "GMED Ops", "Agency name"),
        ("agency_care_of", "c/o GMED Ops", "Agency care of"),
        ("agency_address", "Main Street 1, Berlin", "Agency address"),
        ("agency_phone", "+49 30 000000", "Agency phone"),
        ("agency_email", "ops@gmed.de", "Agency email"),
    ] {
        sqlx::query(
            r#"INSERT INTO system_settings (key, value, description, updated_by)
               VALUES ($1, to_jsonb($2::text), $3, $4)
               ON CONFLICT (key)
               DO UPDATE SET
                   value = EXCLUDED.value,
                   description = EXCLUDED.description,
                   updated_by = EXCLUDED.updated_by,
                   updated_at = now()"#,
        )
        .bind(key)
        .bind(value)
        .bind(description)
        .bind(admin_id)
        .execute(&pool)
        .await
        .unwrap();
    }

    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/patients/{patient_uuid}/label?format=sheet-70x37"),
        &pm_bearer,
        None,
    )
    .await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["patient_id"], format!("PT-{tag}"));
    assert_eq!(body["salutation"], "Herr");
    assert_eq!(body["country_code"], "DE");
    assert_eq!(body["insurance_provider"], "AXA");
    assert_eq!(body["format"]["id"], "sheet-70x37");
    assert_eq!(body["agency"]["care_of"], "c/o GMED Ops");
    assert_eq!(body["agency"]["address"], "Main Street 1, Berlin");
    assert_eq!(body["agency"]["phone"], "+49 30 000000");
    assert_eq!(body["agency"]["email"], "ops@gmed.de");
    assert!(
        body["available_formats"]
            .as_array()
            .expect("available formats array")
            .len()
            >= 3
    );

    let context: Value = sqlx::query_scalar(
        r#"SELECT context
           FROM audit_log
           WHERE action = 'generate_patient_label'
             AND entity_type = 'patient'
             AND entity_id = $1
           ORDER BY created_at DESC
           LIMIT 1"#,
    )
    .bind(patient_uuid)
    .fetch_one(&pool)
    .await
    .unwrap();

    assert_eq!(context["format"], "sheet-70x37");
    assert_eq!(context["country_code"], "DE");
}

#[tokio::test]
async fn interpreter_cannot_fetch_patient_label_payload() {
    let Some((app, pool, admin_id, _)) = test_context().await else {
        return;
    };

    let tag = unique_tag("patient-label-forbidden");
    let patient_uuid = seed_patient(&pool, admin_id, &tag).await;
    let interpreter_id = seed_user(&pool, &tag, "interpreter").await;
    let interpreter_bearer = auth_header_for(interpreter_id, "interpreter");
    seed_patient_assignment(&pool, patient_uuid, interpreter_id, admin_id).await;

    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/patients/{patient_uuid}/label"),
        &interpreter_bearer,
        None,
    )
    .await;

    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(body["message"], "Insufficient permissions");
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
async fn patient_manager_can_create_weekly_recurring_appointment_series() {
    let Some((app, pool, admin_id, _)) = test_context().await else {
        return;
    };

    let tag = unique_tag("recurring-appointment");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let provider_id = seed_provider(&pool, &tag).await;
    let doctor_id = seed_doctor(&pool, provider_id, &tag).await;
    let pm_id = seed_user(&pool, &tag, "patient_manager").await;

    seed_patient_assignment(&pool, patient_id, pm_id, admin_id).await;

    let pm_bearer = auth_header_for(pm_id, "patient_manager");
    let title = format!("Recurring therapy {tag}");

    let (status, body) = json_request(
        &app,
        "POST",
        "/api/v1/appointments",
        &pm_bearer,
        Some(json!({
            "patient_id": patient_id,
            "provider_id": provider_id,
            "doctor_id": doctor_id,
            "owner_user_id": pm_id,
            "appointment_type": "medical",
            "title": title,
            "date": "2026-05-04",
            "time_start": "09:00",
            "time_end": "10:00",
            "recurrence_frequency": "weekly",
            "recurrence_interval": 1,
            "recurrence_count": 4
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(body["series_created_count"], 4);
    let root_id = Uuid::parse_str(body["id"].as_str().unwrap()).unwrap();

    let rows = sqlx::query(
        r#"SELECT id, date, recurrence_series_id, recurrence_frequency, recurrence_interval,
                  recurrence_count, recurrence_index
           FROM appointments
           WHERE patient_id = $1
             AND title = $2
           ORDER BY date, recurrence_index"#,
    )
    .bind(patient_id)
    .bind(&title)
    .fetch_all(&pool)
    .await
    .unwrap();

    assert_eq!(rows.len(), 4);
    let expected_dates = ["2026-05-04", "2026-05-11", "2026-05-18", "2026-05-25"];

    for (index, row) in rows.iter().enumerate() {
        let appointment_id: Uuid = row.try_get("id").unwrap();
        let recurrence_series_id: Option<Uuid> = row.try_get("recurrence_series_id").unwrap();
        let recurrence_frequency: Option<String> = row.try_get("recurrence_frequency").unwrap();
        let recurrence_interval: Option<i32> = row.try_get("recurrence_interval").unwrap();
        let recurrence_count: Option<i32> = row.try_get("recurrence_count").unwrap();
        let recurrence_index: i32 = row.try_get("recurrence_index").unwrap();
        let appointment_date = row
            .try_get::<chrono::NaiveDate, _>("date")
            .unwrap()
            .to_string();

        if index == 0 {
            assert_eq!(appointment_id, root_id);
        }
        assert_eq!(recurrence_series_id, Some(root_id));
        assert_eq!(recurrence_frequency.as_deref(), Some("weekly"));
        assert_eq!(recurrence_interval, Some(1));
        assert_eq!(recurrence_count, Some(4));
        assert_eq!(recurrence_index, index as i32);
        assert_eq!(appointment_date, expected_dates[index]);
    }

    let (status, detail) = json_request(
        &app,
        "GET",
        &format!("/api/v1/appointments/{root_id}"),
        &pm_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(detail["recurrence_frequency"], "weekly");
    assert_eq!(detail["recurrence_series_size"], 4);
    assert_eq!(detail["recurrence_index"], 0);

    let (status, list_body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/appointments?search={tag}"),
        &pm_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let items = list_body.as_array().unwrap();
    assert_eq!(items.len(), 4);
    assert!(items.iter().all(|item| item["recurrence_series_size"] == 4));
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
async fn patient_manager_can_log_and_close_appointment_communication() {
    let Some((app, pool, admin_id, _)) = test_context().await else {
        return;
    };

    let tag = unique_tag("appointment-communication");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let provider_id = seed_provider(&pool, &tag).await;
    let doctor_id = seed_doctor(&pool, provider_id, &tag).await;
    let pm_id = seed_user(&pool, &tag, "patient_manager").await;

    seed_patient_assignment(&pool, patient_id, pm_id, admin_id).await;

    let appointment_id = seed_appointment(
        &pool,
        patient_id,
        provider_id,
        doctor_id,
        pm_id,
        &format!("Appointment {tag}"),
        "confirmed",
        "2026-05-01",
    )
    .await;

    let pm_bearer = auth_header_for(pm_id, "patient_manager");
    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/appointments/{appointment_id}/communications"),
        &pm_bearer,
        Some(json!({
            "target_type": "doctor",
            "direction": "outbound",
            "channel": "email",
            "status": "sent",
            "subject": "Request Arztbrief",
            "message": "Please send the post-visit findings and recommendations.",
            "contact_name": "Dr. Weber",
            "due_at": "2026-05-03T09:00:00+00:00"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let communication_id = body["id"].as_str().unwrap().to_string();

    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/appointments/{appointment_id}/communications"),
        &pm_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let items = body.as_array().unwrap();
    assert_eq!(items.len(), 1);
    assert_eq!(items[0]["id"], communication_id);
    assert_eq!(items[0]["target_type"], "doctor");
    assert_eq!(items[0]["status"], "sent");

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/appointments/{appointment_id}/communications/{communication_id}/status"),
        &pm_bearer,
        Some(json!({ "status": "closed" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/appointments/{appointment_id}/communications"),
        &pm_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let item = body.as_array().unwrap().first().unwrap();
    assert_eq!(item["status"], "closed");
    assert!(item["closed_at"].as_str().unwrap_or_default().contains('T'));
}

#[tokio::test]
async fn assigned_interpreter_can_view_appointment_communications() {
    let Some((app, pool, admin_id, _)) = test_context().await else {
        return;
    };

    let tag = unique_tag("communication-interpreter");
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
        "2026-05-02",
    )
    .await;

    sqlx::query("UPDATE appointments SET interpreter_id = $2 WHERE id = $1")
        .bind(appointment_id)
        .bind(interpreter_id)
        .execute(&pool)
        .await
        .unwrap();

    let pm_bearer = auth_header_for(pm_id, "patient_manager");
    let interpreter_bearer = auth_header_for(interpreter_id, "interpreter");

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/appointments/{appointment_id}/communications"),
        &pm_bearer,
        Some(json!({
            "target_type": "clinic",
            "direction": "outbound",
            "channel": "phone",
            "status": "sent",
            "subject": "Confirm arrival slot"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);

    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/appointments/{appointment_id}/communications"),
        &interpreter_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let items = body.as_array().unwrap();
    assert_eq!(items.len(), 1);
    assert_eq!(items[0]["subject"], "Confirm arrival slot");
}

#[tokio::test]
async fn concierge_cannot_access_communications_for_blocked_medical_slots() {
    let Some((app, pool, admin_id, _)) = test_context().await else {
        return;
    };

    let tag = unique_tag("communication-blocked");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let provider_id = seed_provider(&pool, &tag).await;
    let doctor_id = seed_doctor(&pool, provider_id, &tag).await;
    let pm_id = seed_user(&pool, &tag, "patient_manager").await;
    let concierge_id = seed_user(&pool, &tag, "concierge").await;

    seed_patient_assignment(&pool, patient_id, pm_id, admin_id).await;
    seed_patient_assignment(&pool, patient_id, concierge_id, admin_id).await;

    let appointment_id = seed_appointment(
        &pool,
        patient_id,
        provider_id,
        doctor_id,
        pm_id,
        &format!("Appointment {tag}"),
        "confirmed",
        "2026-05-03",
    )
    .await;

    sqlx::query("UPDATE appointments SET owner_user_id = $2 WHERE id = $1")
        .bind(appointment_id)
        .bind(concierge_id)
        .execute(&pool)
        .await
        .unwrap();

    let concierge_bearer = auth_header_for(concierge_id, "concierge");
    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/appointments/{appointment_id}/communications"),
        &concierge_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(
        body["message"],
        "Blocked medical slots do not expose communication details"
    );
}

#[tokio::test]
async fn attention_endpoint_flags_past_visit_with_unprocessed_follow_up() {
    let Some((app, pool, admin_id, _)) = test_context().await else {
        return;
    };

    let tag = unique_tag("attention-past");
    let today = chrono::Utc::now().date_naive();
    let appointment_date = (today - chrono::Days::new(1)).to_string();
    let reminder_at = format!("{}T08:00:00+00:00", today - chrono::Days::new(1));

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
        &appointment_date,
    )
    .await;

    sqlx::query(
        "UPDATE appointments
         SET interpreter_id = $2, interpreter_response = 'pending'
         WHERE id = $1",
    )
    .bind(appointment_id)
    .bind(interpreter_id)
    .execute(&pool)
    .await
    .unwrap();

    sqlx::query(
        r#"INSERT INTO reminders (appointment_id, user_id, remind_at, title)
           VALUES ($1, $2, $3, $4)"#,
    )
    .bind(appointment_id)
    .bind(pm_id)
    .bind(reminder_at)
    .bind("Post-visit follow-up")
    .execute(&pool)
    .await
    .unwrap();

    let pm_bearer = auth_header_for(pm_id, "patient_manager");
    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/appointments/meta/attention?patient_id={patient_id}"),
        &pm_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let items = body.as_array().unwrap();
    assert_eq!(items.len(), 1);
    let reasons = items[0]["reasons"].as_array().unwrap();
    assert!(
        reasons
            .iter()
            .any(|item| item == "Past visit is still not closed")
    );
    assert!(
        reasons
            .iter()
            .any(|item| item == "Interpreter report or approval is still pending")
    );
    assert!(
        reasons
            .iter()
            .any(|item| item == "1 reminder(s) are overdue")
    );
}

#[tokio::test]
async fn attention_endpoint_flags_upcoming_slot_with_preparation_gaps() {
    let Some((app, pool, admin_id, _)) = test_context().await else {
        return;
    };

    let tag = unique_tag("attention-upcoming");
    let appointment_date = (chrono::Utc::now().date_naive() + chrono::Days::new(1)).to_string();

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
        &appointment_date,
    )
    .await;

    sqlx::query(
        "UPDATE appointments
         SET interpreter_id = $2, interpreter_response = 'pending'
         WHERE id = $1",
    )
    .bind(appointment_id)
    .bind(interpreter_id)
    .execute(&pool)
    .await
    .unwrap();

    sqlx::query(
        r#"INSERT INTO appointment_checklists (appointment_id, phase, item_text, sort_order)
           VALUES ($1, 'preparation', 'Confirm clinic file transfer', 1)"#,
    )
    .bind(appointment_id)
    .execute(&pool)
    .await
    .unwrap();

    let pm_bearer = auth_header_for(pm_id, "patient_manager");
    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/appointments/meta/attention?patient_id={patient_id}"),
        &pm_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let items = body.as_array().unwrap();
    assert_eq!(items.len(), 1);
    let reasons = items[0]["reasons"].as_array().unwrap();
    assert!(reasons.iter().any(|item| {
        item.as_str()
            .unwrap_or_default()
            .contains("preparation or follow-up checklist item")
    }));
    assert!(
        reasons
            .iter()
            .any(|item| item == "Interpreter confirmation is still pending")
    );
}

#[tokio::test]
async fn attention_endpoint_excludes_resolved_completed_visits() {
    let Some((app, pool, admin_id, _)) = test_context().await else {
        return;
    };

    let tag = unique_tag("attention-resolved");
    let appointment_date = (chrono::Utc::now().date_naive() - chrono::Days::new(2)).to_string();

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
        "completed",
        &appointment_date,
    )
    .await;

    sqlx::query(
        "UPDATE appointments
         SET interpreter_id = $2, interpreter_response = 'accepted'
         WHERE id = $1",
    )
    .bind(appointment_id)
    .bind(interpreter_id)
    .execute(&pool)
    .await
    .unwrap();

    sqlx::query(
        r#"INSERT INTO interpreter_reports (
                appointment_id, interpreter_id, hours, report_text, approval_status,
                approved_by, approved_at
           ) VALUES (
                $1, $2, 2.0, 'done', 'approved', $3, now()
           )"#,
    )
    .bind(appointment_id)
    .bind(interpreter_id)
    .bind(pm_id)
    .execute(&pool)
    .await
    .unwrap();

    let pm_bearer = auth_header_for(pm_id, "patient_manager");
    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/appointments/meta/attention?patient_id={patient_id}"),
        &pm_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let items = body.as_array().unwrap();
    assert!(items.is_empty());
}

#[tokio::test]
async fn appointment_completion_is_blocked_when_checklist_items_remain_open() {
    let Some((app, pool, admin_id, _)) = test_context().await else {
        return;
    };

    let tag = unique_tag("appointment-complete-gate");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let provider_id = seed_provider(&pool, &tag).await;
    let doctor_id = seed_doctor(&pool, provider_id, &tag).await;
    let pm_id = seed_user(&pool, &tag, "patient_manager").await;
    seed_patient_assignment(&pool, patient_id, pm_id, admin_id).await;

    let appointment_id = seed_appointment(
        &pool,
        patient_id,
        provider_id,
        doctor_id,
        pm_id,
        "Checklist-blocked visit",
        "confirmed",
        "2026-05-10",
    )
    .await;

    sqlx::query(
        r#"INSERT INTO appointment_checklists (appointment_id, phase, item_text, sort_order)
           VALUES ($1, 'follow_up', 'Send discharge summary to patient', 1)"#,
    )
    .bind(appointment_id)
    .execute(&pool)
    .await
    .unwrap();

    let pm_bearer = auth_header_for(pm_id, "patient_manager");
    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/appointments/{appointment_id}/status"),
        &pm_bearer,
        Some(json!({ "status": "completed" })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert!(
        body["message"]
            .as_str()
            .unwrap_or_default()
            .contains("open checklist")
    );
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
async fn billing_can_only_update_financial_fields_on_concierge_service() {
    let Some((app, pool, admin_id, _)) = test_context().await else {
        return;
    };

    let tag = unique_tag("billing-concierge-boundary");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let provider_id = seed_provider_with_type(&pool, &tag, "non_medical", "Italy").await;
    let doctor_id = seed_doctor(&pool, provider_id, &tag).await;
    let pm_id = seed_user(&pool, &tag, "patient_manager").await;
    let concierge_id = seed_user(&pool, &tag, "concierge").await;
    let billing_id = seed_user(&pool, &tag, "billing").await;

    seed_patient_assignment(&pool, patient_id, pm_id, admin_id).await;
    seed_patient_assignment(&pool, patient_id, concierge_id, admin_id).await;

    let pm_bearer = auth_header_for(pm_id, "patient_manager");
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
            "title": "Airport transfer",
            "date": "2026-05-12",
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
        &billing_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let service_id = body[0]["id"].as_str().unwrap().to_string();

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/concierge-services/{service_id}/update"),
        &billing_bearer,
        Some(json!({
            "actual_cost": 129.50,
            "billing_status": "ready",
            "billing_notes": "Ready for invoice handoff"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["actual_cost"], "129.50");
    assert_eq!(body["billing_status"], "ready");
    assert_eq!(body["billing_notes"], "Ready for invoice handoff");

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/concierge-services/{service_id}/update"),
        &billing_bearer,
        Some(json!({
            "title": "Billing should not rename operational service"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(
        body["message"],
        "Billing can only update cost handoff and billing fields"
    );
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

#[tokio::test]
async fn provider_and_doctor_detail_expose_linked_patients_and_interactions() {
    let Some((app, pool, admin_id, bearer)) = test_context().await else {
        return;
    };

    let tag = unique_tag("provider-detail");
    let provider_id = seed_provider(&pool, &tag).await;
    let doctor_id = seed_doctor(&pool, provider_id, &tag).await;
    sqlx::query(
        r#"UPDATE providers
           SET legal_name = $2,
               tax_id = $3
           WHERE id = $1"#,
    )
    .bind(provider_id)
    .bind(format!("Clinic Legal {tag} GmbH"))
    .bind(format!("DE-TAX-{tag}"))
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        r#"UPDATE provider_doctors
           SET languages = $3,
               license_number = $4,
               licensing_country = $5,
               licensing_valid_until = $6
           WHERE provider_id = $1
             AND id = $2"#,
    )
    .bind(provider_id)
    .bind(doctor_id)
    .bind(vec!["de".to_string(), "en".to_string()])
    .bind(format!("LIC-{tag}"))
    .bind("DE")
    .bind(chrono::NaiveDate::from_ymd_opt(2027, 12, 31).unwrap())
    .execute(&pool)
    .await
    .unwrap();
    let patient_id = seed_patient(&pool, admin_id, &tag).await;

    seed_appointment(
        &pool,
        patient_id,
        provider_id,
        doctor_id,
        admin_id,
        &format!("Visit {tag}"),
        "confirmed",
        "2026-04-20",
    )
    .await;
    let order_id = seed_order(
        &pool,
        patient_id,
        admin_id,
        &format!("O-{tag}"),
        "execution",
        "active",
        "Provider interaction chain",
    )
    .await;
    seed_leistung(
        &pool,
        order_id,
        provider_id,
        doctor_id,
        &format!("Leistung {tag}"),
    )
    .await;

    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/providers/{provider_id}"),
        &bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let linked_patients = body["linked_patients"].as_array().unwrap();
    assert_eq!(linked_patients.len(), 1);
    assert_eq!(linked_patients[0]["id"], patient_id.to_string());
    assert_eq!(linked_patients[0]["appointment_count"], 1);
    assert_eq!(linked_patients[0]["leistung_count"], 1);
    assert_eq!(body["legal_name"], format!("Clinic Legal {tag} GmbH"));
    assert_eq!(body["tax_id"], format!("DE-TAX-{tag}"));
    let interactions = body["interactions"].as_array().unwrap();
    assert!(
        interactions
            .iter()
            .any(|item| item["kind"] == "appointment")
    );
    assert!(interactions.iter().any(|item| item["kind"] == "leistung"));

    let (status, doctor_body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/providers/{provider_id}/doctors/{doctor_id}"),
        &bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(doctor_body["patient_count"], 1);
    assert_eq!(doctor_body["appointment_count"], 1);
    assert_eq!(doctor_body["license_number"], format!("LIC-{tag}"));
    assert_eq!(doctor_body["licensing_country"], "DE");
    assert_eq!(doctor_body["licensing_valid_until"], "2027-12-31");
    assert_eq!(doctor_body["languages"][0], "de");
    assert_eq!(doctor_body["languages"][1], "en");
    assert_eq!(
        doctor_body["linked_patients"]
            .as_array()
            .unwrap()
            .first()
            .unwrap()["id"],
        patient_id.to_string()
    );
}

#[tokio::test]
async fn assigned_interpreter_can_update_response_and_non_assignee_cannot() {
    let Some((app, pool, admin_id, bearer)) = test_context().await else {
        return;
    };

    let tag = unique_tag("interpreter-response");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let provider_id = seed_provider(&pool, &tag).await;
    let doctor_id = seed_doctor(&pool, provider_id, &tag).await;
    let assigned_interpreter_id = seed_user(&pool, &tag, "interpreter").await;
    let other_interpreter_id = seed_user(&pool, &format!("{tag}-other"), "interpreter").await;

    let appointment_id = seed_appointment_slot(
        &pool,
        patient_id,
        provider_id,
        doctor_id,
        admin_id,
        &format!("Appointment {tag}"),
        "planned",
        "2026-04-21",
        "medical",
        Some("10:00"),
        Some("11:00"),
        Some(assigned_interpreter_id),
    )
    .await;

    let assigned_bearer = auth_header_for(assigned_interpreter_id, "interpreter");
    let other_bearer = auth_header_for(other_interpreter_id, "interpreter");

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/appointments/{appointment_id}/interpreter-response"),
        &assigned_bearer,
        Some(json!({ "response": "discussion_requested" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (status, detail_body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/appointments/{appointment_id}"),
        &bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(detail_body["interpreter_response"], "discussion_requested");

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/appointments/{appointment_id}/interpreter-response"),
        &assigned_bearer,
        Some(json!({ "response": "accepted" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (status, detail_body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/appointments/{appointment_id}"),
        &bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(detail_body["interpreter_response"], "accepted");

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/appointments/{appointment_id}/interpreter-response"),
        &other_bearer,
        Some(json!({ "response": "declined" })),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/appointments/{appointment_id}/interpreter-response"),
        &assigned_bearer,
        Some(json!({ "response": "invalid" })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
}

#[tokio::test]
async fn patient_profile_nested_endpoints_return_only_linked_records() {
    let Some((app, pool, admin_id, bearer)) = test_context().await else {
        return;
    };

    let tag = unique_tag("patient-tabs");
    let patient_id = seed_patient(&pool, admin_id, &format!("{tag}-visible")).await;
    let other_patient_id = seed_patient(&pool, admin_id, &format!("{tag}-hidden")).await;
    let provider_id = seed_provider(&pool, &tag).await;
    let doctor_id = seed_doctor(&pool, provider_id, &tag).await;

    let case_id = seed_case(
        &pool,
        patient_id,
        admin_id,
        &format!("CASE-{tag}"),
        "open",
        "Visible case",
    )
    .await;
    let hidden_case_id = seed_case(
        &pool,
        other_patient_id,
        admin_id,
        &format!("CASE-{tag}-hidden"),
        "closed",
        "Hidden case",
    )
    .await;

    let order_id = seed_order(
        &pool,
        patient_id,
        admin_id,
        &format!("ORD-{tag}"),
        "execution",
        "active",
        "Visible order",
    )
    .await;
    let hidden_order_id = seed_order(
        &pool,
        other_patient_id,
        admin_id,
        &format!("ORD-{tag}-hidden"),
        "closed",
        "completed",
        "Hidden order",
    )
    .await;

    let appointment_id = seed_appointment(
        &pool,
        patient_id,
        provider_id,
        doctor_id,
        admin_id,
        "Visible appointment",
        "planned",
        "2030-01-10",
    )
    .await;
    let hidden_appointment_id = seed_appointment(
        &pool,
        other_patient_id,
        provider_id,
        doctor_id,
        admin_id,
        "Hidden appointment",
        "planned",
        "2030-01-11",
    )
    .await;

    let document_id_seed = Uuid::new_v4();
    let document_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO documents (
                id, patient_id, order_id, appointment_id, auto_name, original_filename,
                art, category, status, visibility, is_medical, version_root_document_id,
                version_number, uploaded_by
           ) VALUES (
                $1, $2, $3, $4, $5, $6,
                $7, $8, $9, $10, $11, $1,
                1, $12
           ) RETURNING id"#,
    )
    .bind(document_id_seed)
    .bind(patient_id)
    .bind(order_id)
    .bind(appointment_id)
    .bind("Visible document")
    .bind("visible.pdf")
    .bind("report")
    .bind("medical")
    .bind("active")
    .bind("released_internal")
    .bind(true)
    .bind(admin_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    let hidden_document_id_seed = Uuid::new_v4();
    let hidden_document_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO documents (
                id, patient_id, order_id, appointment_id, auto_name, original_filename,
                art, category, status, visibility, is_medical, version_root_document_id,
                version_number, uploaded_by
           ) VALUES (
                $1, $2, $3, $4, $5, $6,
                $7, $8, $9, $10, $11, $1,
                1, $12
           ) RETURNING id"#,
    )
    .bind(hidden_document_id_seed)
    .bind(other_patient_id)
    .bind(hidden_order_id)
    .bind(hidden_appointment_id)
    .bind("Hidden document")
    .bind("hidden.pdf")
    .bind("report")
    .bind("medical")
    .bind("active")
    .bind("released_internal")
    .bind(true)
    .bind(admin_id)
    .fetch_one(&pool)
    .await
    .unwrap();

    let contract_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO framework_contracts (
                patient_id, contract_number, signed_at, status, created_by
           ) VALUES (
                $1, $2, $3, $4, $5
           ) RETURNING id"#,
    )
    .bind(patient_id)
    .bind(format!("FC-{tag}"))
    .bind("2030-01-12T09:00:00Z")
    .bind("signed")
    .bind(admin_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    let hidden_contract_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO framework_contracts (
                patient_id, contract_number, signed_at, status, created_by
           ) VALUES (
                $1, $2, $3, $4, $5
           ) RETURNING id"#,
    )
    .bind(other_patient_id)
    .bind(format!("FC-{tag}-hidden"))
    .bind("2030-01-13T09:00:00Z")
    .bind("signed")
    .bind(admin_id)
    .fetch_one(&pool)
    .await
    .unwrap();

    let invoice_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO invoices (
                order_id, patient_id, invoice_number, invoice_type, status,
                issued_at, due_date, total_net, total_vat, total_gross, line_items, created_by
           ) VALUES (
                $1, $2, $3, $4, $5,
                $6, $7, $8, $9, $10, $11, $12
           ) RETURNING id"#,
    )
    .bind(order_id)
    .bind(patient_id)
    .bind(format!("INV-{tag}"))
    .bind("final")
    .bind("sent")
    .bind("2030-01-14T10:00:00Z")
    .bind("2030-01-31")
    .bind("100.00")
    .bind("19.00")
    .bind("119.00")
    .bind(json!([]))
    .bind(admin_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    let hidden_invoice_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO invoices (
                order_id, patient_id, invoice_number, invoice_type, status,
                issued_at, due_date, total_net, total_vat, total_gross, line_items, created_by
           ) VALUES (
                $1, $2, $3, $4, $5,
                $6, $7, $8, $9, $10, $11, $12
           ) RETURNING id"#,
    )
    .bind(hidden_order_id)
    .bind(other_patient_id)
    .bind(format!("INV-{tag}-hidden"))
    .bind("final")
    .bind("sent")
    .bind("2030-01-15T10:00:00Z")
    .bind("2030-01-31")
    .bind("100.00")
    .bind("19.00")
    .bind("119.00")
    .bind(json!([]))
    .bind(admin_id)
    .fetch_one(&pool)
    .await
    .unwrap();

    let (status, cases_body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/patients/{patient_id}/cases"),
        &bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let cases = cases_body.as_array().expect("cases array");
    assert_eq!(cases.len(), 1);
    assert_eq!(cases[0]["id"], case_id.to_string());
    assert_ne!(cases[0]["id"], hidden_case_id.to_string());

    let (status, orders_body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/patients/{patient_id}/orders"),
        &bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let orders = orders_body.as_array().expect("orders array");
    assert_eq!(orders.len(), 1);
    assert_eq!(orders[0]["id"], order_id.to_string());
    assert_ne!(orders[0]["id"], hidden_order_id.to_string());

    let (status, appointments_body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/patients/{patient_id}/appointments"),
        &bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let appointments = appointments_body.as_array().expect("appointments array");
    assert_eq!(appointments.len(), 1);
    assert_eq!(appointments[0]["id"], appointment_id.to_string());
    assert_ne!(appointments[0]["id"], hidden_appointment_id.to_string());

    let (status, documents_body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/patients/{patient_id}/documents"),
        &bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let documents = documents_body.as_array().expect("documents array");
    assert_eq!(documents.len(), 1);
    assert_eq!(documents[0]["id"], document_id.to_string());
    assert_ne!(documents[0]["id"], hidden_document_id.to_string());

    let (status, contracts_body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/patients/{patient_id}/framework-contracts"),
        &bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let contracts = contracts_body.as_array().expect("contracts array");
    assert_eq!(contracts.len(), 1);
    assert_eq!(contracts[0]["id"], contract_id.to_string());
    assert_ne!(contracts[0]["id"], hidden_contract_id.to_string());

    let (status, invoices_body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/patients/{patient_id}/invoices"),
        &bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let invoices = invoices_body.as_array().expect("invoices array");
    assert_eq!(invoices.len(), 1);
    assert_eq!(invoices[0]["id"], invoice_id.to_string());
    assert_ne!(invoices[0]["id"], hidden_invoice_id.to_string());
}

#[tokio::test]
async fn patient_relations_crud_round_trip() {
    let Some((app, pool, admin_id, bearer)) = test_context().await else {
        return;
    };

    let tag = unique_tag("patient-relations");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let related_patient_id = seed_patient(&pool, admin_id, &format!("{tag}-linked")).await;

    let (status, created_body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/patients/{patient_id}/relations"),
        &bearer,
        Some(json!({
            "related_patient_id": related_patient_id,
            "related_name": "Primary relative",
            "relation_type": "parent",
            "is_emergency_contact": true,
            "phone": "+49 111 222",
            "notes": "Reachable after 18:00"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let relation_id = Uuid::parse_str(created_body["id"].as_str().unwrap()).unwrap();

    let (status, list_body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/patients/{patient_id}/relations"),
        &bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let relations = list_body.as_array().expect("relations array");
    assert_eq!(relations.len(), 1);
    assert_eq!(relations[0]["relation_type"], "parent");
    assert_eq!(
        relations[0]["related_patient_id"],
        related_patient_id.to_string()
    );

    let (status, updated_body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/patients/{patient_id}/relations/{relation_id}/update"),
        &bearer,
        Some(json!({
            "related_patient_id": related_patient_id,
            "related_name": "Updated relative",
            "relation_type": "caregiver",
            "is_emergency_contact": false,
            "phone": "+49 333 444",
            "notes": "Updated note"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(updated_body["relation_type"], "caregiver");
    assert_eq!(updated_body["related_name"], "Updated relative");

    let (status, delete_body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/patients/{patient_id}/relations/{relation_id}/delete"),
        &bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(delete_body["ok"], true);

    let (status, list_body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/patients/{patient_id}/relations"),
        &bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(list_body.as_array().expect("relations array").len(), 0);
}

#[tokio::test]
async fn patient_profile_updates_structured_legal_status() {
    let Some((app, pool, admin_id, bearer)) = test_context().await else {
        return;
    };

    let tag = unique_tag("patient-legal-status");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/patients/{patient_id}/update"),
        &bearer,
        Some(json!({
            "legal_status": {
                "dsgvo_signed": true,
                "confidentiality_release_signed": true,
                "identity_verified": true,
                "document_pack_complete": false,
                "compliance_completed": false,
                "contract_status": "sent",
                "notes": "Waiting for signed framework package"
            },
            "functional_labels": ["vip", "high_risk"]
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["ok"], true);

    let (status, detail_body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/patients/{patient_id}"),
        &bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(detail_body["legal_status"]["dsgvo_signed"], true);
    assert_eq!(
        detail_body["legal_status"]["confidentiality_release_signed"],
        true
    );
    assert_eq!(detail_body["legal_status"]["identity_verified"], true);
    assert_eq!(detail_body["legal_status"]["document_pack_complete"], false);
    assert_eq!(detail_body["legal_status"]["compliance_completed"], false);
    assert_eq!(detail_body["legal_status"]["contract_status"], "sent");
    assert_eq!(
        detail_body["legal_status"]["notes"],
        "Waiting for signed framework package"
    );
    assert_eq!(detail_body["functional_labels"][0], "vip");
    assert_eq!(detail_body["functional_labels"][1], "high_risk");
}

#[tokio::test]
async fn patient_manager_can_export_patient_dsgvo_bundle() {
    let Some((app, pool, admin_id, _)) = test_context().await else {
        return;
    };

    let tag = unique_tag("patient-dsgvo-export");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    sqlx::query("UPDATE patients SET functional_labels = $2 WHERE id = $1")
        .bind(patient_id)
        .bind(vec!["complex_coordination".to_string()])
        .execute(&pool)
        .await
        .unwrap();
    let pm_id = seed_user(&pool, &tag, "patient_manager").await;
    seed_patient_assignment(&pool, patient_id, pm_id, admin_id).await;
    let pm_bearer = auth_header_for(pm_id, "patient_manager");

    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/admin/compliance/patient/{patient_id}/export"),
        &pm_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["export_type"], "DSGVO Art. 15 - Right of Access");
    assert_eq!(body["patient"]["id"], patient_id.to_string());
    assert_eq!(
        body["patient"]["functional_labels"][0],
        "complex_coordination"
    );
    assert!(body["appointments"].is_array());
    assert!(body["cases"].is_array());
    assert!(body["orders"].is_array());
    assert!(body["assignments"].is_array());
}

#[tokio::test]
async fn patient_manager_can_download_patient_dsgvo_bundle_as_zip() {
    let Some((app, pool, admin_id, _)) = test_context().await else {
        return;
    };

    let tag = unique_tag("patient-dsgvo-export-zip");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let pm_id = seed_user(&pool, &tag, "patient_manager").await;
    seed_patient_assignment(&pool, patient_id, pm_id, admin_id).await;
    let pm_bearer = auth_header_for(pm_id, "patient_manager");

    let (status, bytes) = bytes_request(
        &app,
        "GET",
        &format!("/api/v1/admin/compliance/patient/{patient_id}/export?format=zip"),
        &pm_bearer,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(
        bytes.starts_with(b"PK"),
        "zip bundle should start with PK signature"
    );

    let audit_count: i64 = sqlx::query_scalar(
        r#"SELECT count(*)
           FROM audit_log
           WHERE entity_type = 'patient'
             AND entity_id = $1
             AND action = 'dsgvo_data_export'"#,
    )
    .bind(patient_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(audit_count >= 1);
}

#[tokio::test]
async fn patient_timeline_includes_compliance_audit_events() {
    let Some((app, pool, admin_id, bearer)) = test_context().await else {
        return;
    };

    let tag = unique_tag("patient-compliance-timeline");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let pm_id = seed_user(&pool, &tag, "patient_manager").await;
    seed_patient_assignment(&pool, patient_id, pm_id, admin_id).await;
    let pm_bearer = auth_header_for(pm_id, "patient_manager");

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/patients/{patient_id}/update"),
        &bearer,
        Some(json!({
            "legal_status": {
                "dsgvo_signed": true,
                "compliance_completed": false,
                "contract_status": "pending"
            }
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (status, _) = json_request(
        &app,
        "GET",
        &format!("/api/v1/admin/compliance/patient/{patient_id}/export"),
        &pm_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/patients/{patient_id}/timeline"),
        &bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let items = body["items"].as_array().expect("timeline array");
    assert!(
        items.iter().any(|item| {
            item["entity_type"] == "compliance"
                && item["title"] == "Legal/compliance status updated"
        }),
        "expected compliance status update event in patient timeline"
    );
    assert!(
        items.iter().any(|item| {
            item["entity_type"] == "compliance" && item["title"] == "DSGVO data export"
        }),
        "expected dsgvo export event in patient timeline"
    );
}

#[tokio::test]
async fn patient_timeline_aggregates_events_in_descending_order() {
    let Some((app, pool, admin_id, bearer)) = test_context().await else {
        return;
    };

    let tag = unique_tag("patient-timeline");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let provider_id = seed_provider(&pool, &tag).await;
    let doctor_id = seed_doctor(&pool, provider_id, &tag).await;

    let case_id = seed_case(
        &pool,
        patient_id,
        admin_id,
        &format!("CASE-{tag}"),
        "open",
        "Timeline case",
    )
    .await;
    let order_id = seed_order(
        &pool,
        patient_id,
        admin_id,
        &format!("ORD-{tag}"),
        "execution",
        "active",
        "Timeline order",
    )
    .await;
    let service_id =
        seed_leistung_returning_id(&pool, order_id, provider_id, doctor_id, "Delivered service")
            .await;
    let appointment_id = seed_appointment(
        &pool,
        patient_id,
        provider_id,
        doctor_id,
        admin_id,
        "Timeline appointment",
        "planned",
        "2030-01-03",
    )
    .await;
    let document_id_seed = Uuid::new_v4();
    let document_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO documents (
                id, patient_id, order_id, appointment_id, auto_name, original_filename,
                art, category, status, visibility, is_medical, version_root_document_id,
                version_number, uploaded_by
           ) VALUES (
                $1, $2, $3, $4, $5, $6,
                $7, $8, $9, $10, $11, $1,
                1, $12
           ) RETURNING id"#,
    )
    .bind(document_id_seed)
    .bind(patient_id)
    .bind(order_id)
    .bind(appointment_id)
    .bind("Bloodwork summary")
    .bind("bloodwork.pdf")
    .bind("report")
    .bind("lab")
    .bind("active")
    .bind("released_internal")
    .bind(true)
    .bind(admin_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    let contract_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO framework_contracts (
                patient_id, contract_number, signed_at, status, created_by
           ) VALUES (
                $1, $2, $3, $4, $5
           ) RETURNING id"#,
    )
    .bind(patient_id)
    .bind(format!("FC-{tag}"))
    .bind("2030-01-05T08:00:00Z")
    .bind("signed")
    .bind(admin_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    let invoice_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO invoices (
                order_id, patient_id, invoice_number, invoice_type, status,
                issued_at, due_date, total_net, total_vat, total_gross, line_items, created_by
           ) VALUES (
                $1, $2, $3, $4, $5,
                $6, $7, $8, $9, $10, $11, $12
           ) RETURNING id"#,
    )
    .bind(order_id)
    .bind(patient_id)
    .bind(format!("INV-{tag}"))
    .bind("final")
    .bind("sent")
    .bind("2030-01-06T08:00:00Z")
    .bind("2030-01-20")
    .bind(100.0_f64)
    .bind(19.0_f64)
    .bind(119.0_f64)
    .bind(json!([]))
    .bind(admin_id)
    .fetch_one(&pool)
    .await
    .unwrap();

    sqlx::query("UPDATE cases SET created_at = '2030-01-01T08:00:00Z' WHERE id = $1")
        .bind(case_id)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("UPDATE orders SET created_at = '2030-01-02T08:00:00Z' WHERE id = $1")
        .bind(order_id)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("UPDATE order_leistungen SET created_at = '2030-01-04T08:00:00Z' WHERE id = $1")
        .bind(service_id)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("UPDATE documents SET created_at = '2030-01-07T08:00:00Z' WHERE id = $1")
        .bind(document_id)
        .execute(&pool)
        .await
        .unwrap();

    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/patients/{patient_id}/timeline?limit=7&offset=0"),
        &bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(body["total"].as_i64().unwrap_or_default() >= 7);
    assert_eq!(body["limit"].as_i64().unwrap_or_default(), 7);
    let items = body["items"].as_array().expect("timeline array");
    assert!(items.len() >= 7);
    assert_eq!(items[0]["entity_type"], "document");
    assert_eq!(items[0]["entity_id"], document_id.to_string());
    assert_eq!(items[1]["entity_type"], "invoice");
    assert_eq!(items[1]["entity_id"], invoice_id.to_string());
    assert_eq!(items[2]["entity_type"], "contract");
    assert_eq!(items[2]["entity_id"], contract_id.to_string());
    assert_eq!(items[3]["entity_type"], "service");
    assert_eq!(items[3]["entity_id"], service_id.to_string());
    assert_eq!(items[4]["entity_type"], "appointment");
    assert_eq!(items[4]["entity_id"], appointment_id.to_string());
    assert_eq!(items[5]["entity_type"], "order");
    assert_eq!(items[5]["entity_id"], order_id.to_string());
    assert_eq!(items[6]["entity_type"], "case");
    assert_eq!(items[6]["entity_id"], case_id.to_string());
}
