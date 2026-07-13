mod support;

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

fn parse_date(value: &str) -> chrono::NaiveDate {
    chrono::NaiveDate::parse_from_str(value, "%Y-%m-%d").expect("valid test date")
}

fn parse_utc_datetime(value: &str) -> chrono::DateTime<chrono::Utc> {
    chrono::DateTime::parse_from_rfc3339(value)
        .expect("valid test datetime")
        .with_timezone(&chrono::Utc)
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

async fn taxonomy_node_id(pool: &PgPool, code: &str) -> Uuid {
    sqlx::query_scalar("SELECT id FROM provider_taxonomy_nodes WHERE code = $1")
        .bind(code)
        .fetch_one(pool)
        .await
        .unwrap_or_else(|_| panic!("taxonomy node {code} must be seeded"))
}

async fn assign_primary_provider_taxonomy(pool: &PgPool, provider_id: Uuid, code: &str) -> Uuid {
    let taxonomy_node_id = taxonomy_node_id(pool, code).await;
    sqlx::query(
        r#"UPDATE provider_taxonomy_assignments
           SET is_primary = FALSE
           WHERE provider_id = $1"#,
    )
    .bind(provider_id)
    .execute(pool)
    .await
    .unwrap();
    sqlx::query(
        r#"INSERT INTO provider_taxonomy_assignments (provider_id, taxonomy_node_id, is_primary)
           VALUES ($1, $2, TRUE)
           ON CONFLICT (provider_id, taxonomy_node_id)
           DO UPDATE SET is_primary = TRUE"#,
    )
    .bind(provider_id)
    .bind(taxonomy_node_id)
    .execute(pool)
    .await
    .unwrap();
    taxonomy_node_id
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

async fn seed_patient_diagnosis(
    pool: &PgPool,
    patient_id: Uuid,
    provider_id: Uuid,
    doctor_id: Option<Uuid>,
    treating_doctor_id: Option<Uuid>,
    label: &str,
) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO patient_diagnoses (
                patient_id, provider_id, doctor_id, treating_doctor_id,
                kind, label, certainty, status, source_mode
           ) VALUES (
                $1, $2, $3, $4, 'main', $5, 'bestaetigt', 'active', 'intern'
           )
           RETURNING id"#,
    )
    .bind(patient_id)
    .bind(provider_id)
    .bind(doctor_id)
    .bind(treating_doctor_id)
    .bind(label)
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

async fn seed_agency_service_catalog_item(
    pool: &PgPool,
    created_by: Uuid,
    service_key: &str,
    service_name: &str,
    valid_from: &str,
) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO agency_service_catalog (
                service_key, service_name, description, unit_label,
                unit_price, currency, vat_rate, is_active, valid_from, created_by
           ) VALUES (
                $1, $2, $3, 'hour',
                95.0, 'EUR', 19.0, true, $4, $5
           )
           ON CONFLICT (service_key) DO UPDATE
           SET service_name = EXCLUDED.service_name,
               description = EXCLUDED.description,
               unit_label = EXCLUDED.unit_label,
               unit_price = EXCLUDED.unit_price,
               currency = EXCLUDED.currency,
               vat_rate = EXCLUDED.vat_rate,
               is_active = true,
               valid_from = EXCLUDED.valid_from,
               valid_to = NULL,
               updated_by = EXCLUDED.created_by
           RETURNING id"#,
    )
    .bind(service_key)
    .bind(service_name)
    .bind(format!("{service_name} seeded for tests"))
    .bind(parse_date(valid_from))
    .bind(created_by)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn deactivate_agency_service_catalog_item(pool: &PgPool, service_key: &str) {
    sqlx::query("UPDATE agency_service_catalog SET is_active = false WHERE service_key = $1")
        .bind(service_key)
        .execute(pool)
        .await
        .unwrap();
}

struct ProviderConciergeServiceSeed<'a> {
    patient_id: Uuid,
    provider_id: Uuid,
    created_by: Uuid,
    service_kind: &'a str,
    title: &'a str,
    vendor_name: &'a str,
    status: &'a str,
}

async fn seed_provider_concierge_service(
    pool: &PgPool,
    seed: ProviderConciergeServiceSeed<'_>,
) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO concierge_services (
                patient_id, provider_id, service_kind, title, status,
                vendor_name, created_by
           ) VALUES (
                $1, $2, $3, $4, $5,
                $6, $7
           ) RETURNING id"#,
    )
    .bind(seed.patient_id)
    .bind(seed.provider_id)
    .bind(seed.service_kind)
    .bind(seed.title)
    .bind(seed.status)
    .bind(seed.vendor_name)
    .bind(seed.created_by)
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
    .bind(parse_date(date))
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
    .bind(parse_date(date))
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
    .bind(parse_date(date))
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
async fn orders_and_debt_queue_support_provider_taxonomy_filter() {
    let Some((app, pool, admin_id, _)) = test_context().await else {
        return;
    };

    let tag = unique_tag("order-taxonomy-filter");
    let billing_id = seed_user(&pool, &tag, "billing").await;
    let billing_bearer = auth_header_for(billing_id, "billing");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let reha_provider_id = seed_provider(&pool, &format!("{tag}-reha")).await;
    let reha_doctor_id = seed_doctor(&pool, reha_provider_id, &format!("{tag}-reha")).await;
    let pharmacy_provider_id = seed_provider(&pool, &format!("{tag}-pharmacy")).await;
    let pharmacy_doctor_id =
        seed_doctor(&pool, pharmacy_provider_id, &format!("{tag}-pharmacy")).await;
    assign_primary_provider_taxonomy(&pool, reha_provider_id, "medical_reha_clinics").await;
    assign_primary_provider_taxonomy(&pool, pharmacy_provider_id, "medical_pharmacies").await;
    let reha_group_id = taxonomy_node_id(&pool, "medical_reha_care").await;

    let reha_order_id = seed_order(
        &pool,
        patient_id,
        admin_id,
        &format!("A-{tag}-reha"),
        "execution",
        "active",
        &format!("Reha order {tag}"),
    )
    .await;
    seed_leistung(
        &pool,
        reha_order_id,
        reha_provider_id,
        reha_doctor_id,
        &format!("Reha service {tag}"),
    )
    .await;

    let pharmacy_order_id = seed_order(
        &pool,
        patient_id,
        admin_id,
        &format!("A-{tag}-pharmacy"),
        "execution",
        "active",
        &format!("Pharmacy order {tag}"),
    )
    .await;
    seed_leistung(
        &pool,
        pharmacy_order_id,
        pharmacy_provider_id,
        pharmacy_doctor_id,
        &format!("Pharmacy service {tag}"),
    )
    .await;

    for order_id in [reha_order_id, pharmacy_order_id] {
        sqlx::query(
            r#"INSERT INTO order_debt_management (order_id, status, note, next_review_at)
               VALUES ($1, 'payment_plan', $2, now() + interval '1 day')
               ON CONFLICT (order_id) DO UPDATE
               SET status = EXCLUDED.status,
                   note = EXCLUDED.note,
                   next_review_at = EXCLUDED.next_review_at"#,
        )
        .bind(order_id)
        .bind(format!("Debt workflow {tag}"))
        .execute(&pool)
        .await
        .unwrap();
    }
    sqlx::query(
        r#"INSERT INTO external_invoices (
                order_id, patient_id, provider_id, external_invoice_number,
                invoice_date, due_date, amount_net, amount_vat, amount_gross,
                status, created_by
           ) VALUES (
                $1, $2, $3, $4,
                $5, $6, 100.0, 19.0, 119.0,
                'expected', $7
           )"#,
    )
    .bind(reha_order_id)
    .bind(patient_id)
    .bind(reha_provider_id)
    .bind(format!("EXT-{tag}-reha"))
    .bind(parse_date("2030-02-01"))
    .bind(parse_date("2030-02-10"))
    .bind(admin_id)
    .execute(&pool)
    .await
    .unwrap();

    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/orders?search={tag}&provider_taxonomy_node_id={reha_group_id}"),
        &billing_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let items = body.as_array().unwrap();
    assert_eq!(items.len(), 1);
    assert_eq!(items[0]["id"], reha_order_id.to_string());

    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/orders/debt-management?provider_taxonomy_node_id={reha_group_id}"),
        &billing_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let debt_items = body.as_array().unwrap();
    assert!(
        debt_items
            .iter()
            .any(|item| item["order_id"] == reha_order_id.to_string())
    );
    assert!(
        !debt_items
            .iter()
            .any(|item| item["order_id"] == pharmacy_order_id.to_string())
    );

    let (status, detail) = json_request(
        &app,
        "GET",
        &format!("/api/v1/orders/{reha_order_id}"),
        &billing_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let leistungen = detail["leistungen"].as_array().unwrap();
    assert_eq!(
        leistungen[0]["provider_taxonomy_node_code"],
        "medical_reha_clinics"
    );
    let external_invoices = detail["external_invoices"].as_array().unwrap();
    assert_eq!(
        external_invoices[0]["provider_taxonomy_node_code"],
        "medical_reha_clinics"
    );
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

async fn patient_search_matches(
    app: &axum::Router,
    bearer: &str,
    query: &str,
    patient_id: Uuid,
) -> bool {
    let encoded = query.replace(' ', "%20");
    let (status, body) = json_request(
        app,
        "GET",
        &format!("/api/v1/patients?search={encoded}"),
        bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let needle = patient_id.to_string();
    body.as_array()
        .unwrap()
        .iter()
        .filter_map(|item| item["id"].as_str())
        .any(|id| id == needle)
}

#[tokio::test]
async fn patients_list_search_matches_contact_full_name_and_insurance() {
    let Some((app, pool, admin_id, bearer)) = test_context().await else {
        return;
    };

    let tag = unique_tag("psearch");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;

    // Give the patient distinctive contact + insurance identifiers to search by.
    let email = format!("mail-{tag}@example.org");
    let phone = format!("PHN-{tag}");
    let insurance = format!("INS-{tag}");
    sqlx::query(
        r#"UPDATE patients
           SET email = $2, phone_primary = $3, insurance_number = $4
           WHERE id = $1"#,
    )
    .bind(patient_id)
    .bind(&email)
    .bind(&phone)
    .bind(&insurance)
    .execute(&pool)
    .await
    .unwrap();

    // Widened search scope: each identifier must now match (regression for search-scope audit).
    assert!(
        patient_search_matches(&app, &bearer, &format!("mail-{tag}"), patient_id).await,
        "email should be searchable"
    );
    assert!(
        patient_search_matches(&app, &bearer, &phone, patient_id).await,
        "phone_primary should be searchable"
    );
    assert!(
        patient_search_matches(&app, &bearer, &insurance, patient_id).await,
        "insurance_number should be searchable"
    );
    assert!(
        patient_search_matches(
            &app,
            &bearer,
            &format!("First {tag} Last {tag}"),
            patient_id
        )
        .await,
        "full name (first + last) should match via concatenation"
    );
    // Existing per-column coverage must still work.
    assert!(
        patient_search_matches(&app, &bearer, &format!("PT-{tag}"), patient_id).await,
        "patient_id should still be searchable"
    );
    // Negative control: an unrelated token must not match. Uses no digits so the
    // phone digit-matching can't coincidentally match the tag's uuid digits.
    assert!(
        !patient_search_matches(&app, &bearer, "zzznomatchforthispatient", patient_id).await,
        "non-matching token must not return the patient"
    );

    // German umlaut/eszett tolerance: a query typed without a German keyboard (ASCII
    // digraphs ue/oe/ae/ss) must match stored text that contains the real umlauts.
    let de_tag = unique_tag("psearch-de");
    let de_patient = seed_patient(&pool, admin_id, &de_tag).await;
    let de_surname = format!("Müßner-{de_tag}"); // contains ü and ß
    sqlx::query("UPDATE patients SET last_name = $2 WHERE id = $1")
        .bind(de_patient)
        .bind(&de_surname)
        .execute(&pool)
        .await
        .unwrap();
    assert!(
        patient_search_matches(&app, &bearer, &format!("Muessner-{de_tag}"), de_patient).await,
        "ASCII digraph form (ue, ss) must match stored umlauts (ü, ß)"
    );
    assert!(
        patient_search_matches(&app, &bearer, &format!("MUESSNER-{de_tag}"), de_patient).await,
        "German digraph matching must be case-insensitive"
    );
    // And the real umlaut surname is still found by its own patient_id row.
    assert!(
        patient_search_matches(&app, &bearer, &format!("PT-{de_tag}"), de_patient).await,
        "patient_id still matches alongside German-folded name search"
    );

    // Phone format tolerance: a formatted number is found by its bare digits.
    sqlx::query("UPDATE patients SET phone_primary = $2 WHERE id = $1")
        .bind(patient_id)
        .bind("+49 170 1234567")
        .execute(&pool)
        .await
        .unwrap();
    assert!(
        patient_search_matches(&app, &bearer, "1701234567", patient_id).await,
        "phone search must ignore spacing/punctuation (digit-normalized)"
    );
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

    let billing_id = if let Some(existing) = sqlx::query_scalar(
        r#"SELECT id
           FROM users
           WHERE is_active = true
             AND role = 'billing'
           ORDER BY created_at
           LIMIT 1"#,
    )
    .fetch_optional(&pool)
    .await
    .unwrap()
    {
        existing
    } else {
        seed_user(&pool, &tag, "billing").await
    };
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
    let billing_id = if let Some(existing) = sqlx::query_scalar(
        r#"SELECT id
           FROM users
           WHERE is_active = true
             AND role = 'billing'
           ORDER BY created_at
           LIMIT 1"#,
    )
    .fetch_optional(&pool)
    .await
    .unwrap()
    {
        existing
    } else {
        seed_user(&pool, &tag, "billing").await
    };

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
async fn cost_passthrough_leistung_auto_links_single_supporting_document() {
    let Some((app, pool, admin_id, _)) = test_context().await else {
        return;
    };

    let tag = unique_tag("leistung-supporting-doc");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let provider_id = seed_provider(&pool, &tag).await;
    let doctor_id = seed_doctor(&pool, provider_id, &tag).await;
    let pm_id = seed_user(&pool, &tag, "patient_manager").await;
    let billing_id = seed_user(&pool, &format!("{tag}-billing"), "billing").await;
    seed_patient_assignment(&pool, patient_id, pm_id, admin_id).await;

    let order_id = seed_order(
        &pool,
        patient_id,
        admin_id,
        &format!("O-{tag}"),
        "execution",
        "active",
        "Supporting document auto-link",
    )
    .await;

    let supporting_document_id = Uuid::new_v4();
    sqlx::query(
        r#"INSERT INTO documents (
                id, patient_id, order_id, auto_name, original_filename, art, category,
                status, visibility, is_medical, version_root_document_id, version_number, uploaded_by
           ) VALUES (
                $1, $2, $3, $4, $5, 'receipt', 'payment',
                'active', 'released_internal', false, $1, 1, $6
           )"#,
    )
    .bind(supporting_document_id)
    .bind(patient_id)
    .bind(order_id)
    .bind("Clinic receipt")
    .bind("receipt.pdf")
    .bind(admin_id)
    .execute(&pool)
    .await
    .unwrap();

    let pm_bearer = auth_header_for(pm_id, "patient_manager");
    let billing_bearer = auth_header_for(billing_id, "billing");

    let (status, created_body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/orders/{order_id}/leistungen"),
        &pm_bearer,
        Some(json!({
            "description": "Clinic passthrough",
            "quantity": 1.0,
            "unit_price": 480.0,
            "vat_rate": 0.0,
            "is_cost_passthrough": true,
            "provider_id": provider_id,
            "doctor_id": doctor_id,
            "notes": "External receipt-backed service"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let leistung_id = Uuid::parse_str(created_body["id"].as_str().unwrap()).unwrap();

    let linked_doc_id: Option<Uuid> =
        sqlx::query_scalar("SELECT external_document_id FROM order_leistungen WHERE id = $1")
            .bind(leistung_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(linked_doc_id, Some(supporting_document_id));

    let (status, order_body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/orders/{order_id}"),
        &billing_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let leistungen = order_body["leistungen"].as_array().unwrap();
    let item = leistungen
        .iter()
        .find(|item| item["id"] == leistung_id.to_string())
        .expect("linked leistung");
    assert_eq!(
        item["external_document_id"],
        supporting_document_id.to_string()
    );
    assert_eq!(item["external_document_auto_name"], "Clinic receipt");
    assert_eq!(item["external_document_filename"], "receipt.pdf");
}

#[tokio::test]
async fn external_invoices_round_trip_through_order_detail_and_status_update() {
    let Some((app, pool, admin_id, _)) = test_context().await else {
        return;
    };

    let tag = unique_tag("external-invoice-order");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let provider_id = seed_provider(&pool, &tag).await;
    let pm_id = seed_user(&pool, &tag, "patient_manager").await;
    let billing_id = seed_user(&pool, &format!("{tag}-billing"), "billing").await;
    seed_patient_assignment(&pool, patient_id, pm_id, admin_id).await;

    let order_id = seed_order(
        &pool,
        patient_id,
        admin_id,
        &format!("O-{tag}"),
        "execution",
        "active",
        "External invoice order",
    )
    .await;

    let pm_bearer = auth_header_for(pm_id, "patient_manager");
    let billing_bearer = auth_header_for(billing_id, "billing");

    let (status, created_body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/orders/{order_id}/external-invoices"),
        &pm_bearer,
        Some(json!({
            "provider_id": provider_id,
            "external_invoice_number": format!("EXT-{tag}"),
            "invoice_date": "2026-04-10",
            "due_date": "2026-04-20",
            "amount_net": 100.0,
            "amount_vat": 19.0,
            "amount_gross": 119.0,
            "status": "received",
            "notes": "Inbound clinic invoice"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let external_invoice_id =
        Uuid::parse_str(created_body["id"].as_str().expect("external invoice id")).unwrap();

    let (status, order_detail) = json_request(
        &app,
        "GET",
        &format!("/api/v1/orders/{order_id}"),
        &billing_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let items = order_detail["external_invoices"]
        .as_array()
        .expect("external invoice array");
    assert_eq!(items.len(), 1);
    assert_eq!(items[0]["id"], external_invoice_id.to_string());
    assert_eq!(items[0]["provider_id"], provider_id.to_string());
    assert_eq!(items[0]["status"], "received");
    assert_eq!(items[0]["amount_gross"].as_str(), Some("119"));

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/orders/{order_id}/external-invoices/{external_invoice_id}/update"),
        &billing_bearer,
        Some(json!({ "status": "paid" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["ok"], true);

    let row = sqlx::query(
        r#"SELECT status, paid_at
           FROM external_invoices
           WHERE id = $1"#,
    )
    .bind(external_invoice_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(row.try_get::<String, _>("status").unwrap(), "paid");
    assert!(
        row.try_get::<Option<chrono::DateTime<chrono::Utc>>, _>("paid_at")
            .unwrap()
            .is_some()
    );
}

#[tokio::test]
async fn external_invoice_deadline_scheduler_marks_overdue_and_notifies_billing() {
    let Some((app, pool, admin_id, _)) = test_context().await else {
        return;
    };

    let tag = unique_tag("external-invoice-scheduler");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let provider_id = seed_provider(&pool, &tag).await;
    let pm_id = seed_user(&pool, &tag, "patient_manager").await;
    let billing_id = seed_user(&pool, &format!("{tag}-billing"), "billing").await;
    seed_patient_assignment(&pool, patient_id, pm_id, admin_id).await;

    let order_id = seed_order(
        &pool,
        patient_id,
        admin_id,
        &format!("O-{tag}"),
        "execution",
        "active",
        "External invoice overdue",
    )
    .await;

    let pm_bearer = auth_header_for(pm_id, "patient_manager");
    let due_date = (chrono::Utc::now().date_naive() - chrono::Duration::days(3)).to_string();

    let (status, created_body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/orders/{order_id}/external-invoices"),
        &pm_bearer,
        Some(json!({
            "provider_id": provider_id,
            "external_invoice_number": format!("EXT-DUE-{tag}"),
            "due_date": due_date,
            "amount_gross": 480.0,
            "status": "approved"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let external_invoice_id =
        Uuid::parse_str(created_body["id"].as_str().expect("external invoice id")).unwrap();

    let state = AppState::new(
        pool.clone(),
        TEST_SECRET,
        SettingsCache::new(TokenSettings::default()),
    );
    let first_summary =
        gmed_server::routes::orders::run_external_invoice_deadline_scheduler_once(&state)
            .await
            .expect("first external invoice run");
    assert_eq!(first_summary.overdue_marked, 1);
    assert!(first_summary.notifications_created >= 1);

    let second_summary =
        gmed_server::routes::orders::run_external_invoice_deadline_scheduler_once(&state)
            .await
            .expect("second external invoice run");
    assert_eq!(second_summary.overdue_marked, 0);
    assert_eq!(second_summary.notifications_created, 0);

    let row = sqlx::query(
        r#"SELECT status
           FROM external_invoices
           WHERE id = $1"#,
    )
    .bind(external_invoice_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(row.try_get::<String, _>("status").unwrap(), "overdue");

    let notifications: i64 = sqlx::query_scalar(
        r#"SELECT count(*)
           FROM user_notifications
           WHERE user_id = $1
             AND kind = 'external_invoice_overdue'
             AND entity_type = 'order'
             AND entity_id = $2"#,
    )
    .bind(billing_id)
    .bind(order_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(notifications, 1);
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
async fn appointments_list_and_attention_support_provider_taxonomy_filter() {
    let Some((app, pool, admin_id, bearer)) = test_context().await else {
        return;
    };

    let tag = unique_tag("apt-taxonomy-filter");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let reha_provider_id = seed_provider(&pool, &format!("{tag}-reha")).await;
    let reha_doctor_id = seed_doctor(&pool, reha_provider_id, &format!("{tag}-reha")).await;
    let pharmacy_provider_id = seed_provider(&pool, &format!("{tag}-pharmacy")).await;
    let pharmacy_doctor_id =
        seed_doctor(&pool, pharmacy_provider_id, &format!("{tag}-pharmacy")).await;
    assign_primary_provider_taxonomy(&pool, reha_provider_id, "medical_reha_clinics").await;
    assign_primary_provider_taxonomy(&pool, pharmacy_provider_id, "medical_pharmacies").await;
    let reha_group_id = taxonomy_node_id(&pool, "medical_reha_care").await;

    seed_appointment(
        &pool,
        patient_id,
        reha_provider_id,
        reha_doctor_id,
        admin_id,
        &format!("Reha appointment {tag}"),
        "confirmed",
        "2026-04-18",
    )
    .await;
    seed_appointment(
        &pool,
        patient_id,
        pharmacy_provider_id,
        pharmacy_doctor_id,
        admin_id,
        &format!("Pharmacy appointment {tag}"),
        "confirmed",
        "2026-04-19",
    )
    .await;

    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/appointments?search={tag}&provider_taxonomy_node_id={reha_group_id}"),
        &bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let items = body.as_array().unwrap();
    assert_eq!(items.len(), 1);
    assert_eq!(items[0]["provider_id"], reha_provider_id.to_string());
    assert_eq!(items[0]["title"], format!("Reha appointment {tag}"));

    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/appointments/meta/attention?search={tag}&provider_taxonomy_node_id={reha_group_id}"),
        &bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let attention_items = body.as_array().unwrap();
    assert_eq!(attention_items.len(), 1);
    assert_eq!(
        attention_items[0]["provider_id"],
        reha_provider_id.to_string()
    );
}

#[tokio::test]
async fn medical_appointments_support_care_path_kind_round_trip_and_filtering() {
    let Some((app, pool, admin_id, _)) = test_context().await else {
        return;
    };

    let tag = unique_tag("appointment-care-path-kind");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let provider_id = seed_provider(&pool, &tag).await;
    let doctor_id = seed_doctor(&pool, provider_id, &tag).await;
    let pm_id = seed_user(&pool, &tag, "patient_manager").await;
    seed_patient_assignment(&pool, patient_id, pm_id, admin_id).await;
    let pm_bearer = auth_header_for(pm_id, "patient_manager");

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
            "care_path_kind": "preventive",
            "title": format!("Preventive visit {tag}"),
            "date": "2026-08-12",
            "time_start": "08:30",
            "time_end": "09:15",
            "location": "Clinic reception"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let appointment_id = body["id"].as_str().unwrap().to_string();

    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/appointments/{appointment_id}"),
        &pm_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["care_path_kind"], "preventive");
    assert_eq!(body["type"], "medical");

    let (status, body) = json_request(
        &app,
        "GET",
        "/api/v1/appointments?care_path_kind=preventive",
        &pm_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let items = body.as_array().unwrap();
    assert!(
        items
            .iter()
            .any(|item| { item["id"] == appointment_id && item["care_path_kind"] == "preventive" })
    );

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/appointments/{appointment_id}/update"),
        &pm_bearer,
        Some(json!({
            "provider_id": provider_id,
            "doctor_id": doctor_id,
            "owner_user_id": pm_id,
            "interpreter_id": Value::Null,
            "care_path_kind": "control",
            "title": format!("Preventive visit {tag}"),
            "date": "2026-08-12",
            "time_start": "08:30",
            "time_end": "09:15",
            "location": "Clinic reception"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/appointments/{appointment_id}"),
        &pm_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["care_path_kind"], "control");

    let (status, body) = json_request(
        &app,
        "GET",
        "/api/v1/appointments?care_path_kind=control",
        &pm_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let items = body.as_array().unwrap();
    assert!(
        items
            .iter()
            .any(|item| { item["id"] == appointment_id && item["care_path_kind"] == "control" })
    );
}

#[tokio::test]
async fn medical_appointment_requires_provider_or_explicit_opt_out() {
    let Some((app, pool, admin_id, _)) = test_context().await else {
        return;
    };

    let tag = unique_tag("appointment-medical-provider-binding");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let pm_id = seed_user(&pool, &tag, "patient_manager").await;
    seed_patient_assignment(&pool, patient_id, pm_id, admin_id).await;
    let pm_bearer = auth_header_for(pm_id, "patient_manager");

    let base_payload = json!({
        "patient_id": patient_id,
        "owner_user_id": pm_id,
        "appointment_type": "medical",
        "title": format!("Unbound medical appointment {tag}"),
        "date": "2026-08-14",
        "time_start": "11:00",
        "time_end": "11:30",
        "location": "To be confirmed"
    });

    let (status, body) = json_request(
        &app,
        "POST",
        "/api/v1/appointments",
        &pm_bearer,
        Some(base_payload.clone()),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert!(
        body["message"]
            .as_str()
            .unwrap_or_default()
            .to_lowercase()
            .contains("provider")
    );

    let mut opt_out_payload = base_payload;
    opt_out_payload["skip_medical_provider_binding"] = json!(true);
    let (status, body) = json_request(
        &app,
        "POST",
        "/api/v1/appointments",
        &pm_bearer,
        Some(opt_out_payload),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let appointment_id = body["id"].as_str().unwrap();

    let (status, detail) = json_request(
        &app,
        "GET",
        &format!("/api/v1/appointments/{appointment_id}"),
        &pm_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(detail["type"], "medical");
    assert!(detail["provider_id"].is_null());
    assert!(detail["doctor_id"].is_null());
}

#[tokio::test]
async fn non_medical_appointments_reject_non_regular_care_path_kind() {
    let Some((app, pool, admin_id, _)) = test_context().await else {
        return;
    };

    let tag = unique_tag("appointment-care-path-invalid");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let provider_id = seed_provider(&pool, &tag).await;
    let pm_id = seed_user(&pool, &tag, "patient_manager").await;
    seed_patient_assignment(&pool, patient_id, pm_id, admin_id).await;
    let pm_bearer = auth_header_for(pm_id, "patient_manager");

    let (status, body) = json_request(
        &app,
        "POST",
        "/api/v1/appointments",
        &pm_bearer,
        Some(json!({
            "patient_id": patient_id,
            "provider_id": provider_id,
            "owner_user_id": pm_id,
            "appointment_type": "non_medical",
            "care_path_kind": "preventive",
            "title": format!("Transfer {tag}"),
            "date": "2026-08-13",
            "time_start": "10:00",
            "time_end": "11:00",
            "location": "Airport terminal"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(
        body["message"],
        "Only medical appointments can use preventive, control or followup care paths"
    );
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
    let non_medical_provider_id =
        seed_provider_with_type(&pool, &format!("{tag}-travel"), "non_medical", "Austria").await;
    let non_medical_doctor_id =
        seed_doctor(&pool, non_medical_provider_id, &format!("{tag}-guide")).await;

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
    assert!(
        doctors
            .iter()
            .all(|item| item["id"] != non_medical_doctor_id.to_string()),
        "case doctor registry metadata must not include non-medical provider staff"
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
                "wirkstoff": "Medication A",
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
async fn permanent_medication_expiry_scheduler_creates_confirmation_work_without_duplicates() {
    let Some((app, pool, admin_id, _)) = test_context().await else {
        return;
    };

    let tag = unique_tag("case-medication-expiry");
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
            "hauptanfragegrund": "Medication expiry review"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let case_id = Uuid::parse_str(created_body["id"].as_str().expect("created case id")).unwrap();

    let expired_on = (chrono::Utc::now().date_naive() - chrono::Duration::days(2)).to_string();
    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/cases/{case_id}/medikamente"),
        &pm_bearer,
        Some(json!({
            "items": [{
                "handelsname": "Atorvastatin",
                "wirkstoff": "Atorvastatin",
                "med_typ": "permanent",
                "expiry_date": expired_on,
                "dosis": "20",
                "dosis_einheit": "mg"
            }]
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["count"], 1);

    let (status, detail) = json_request(
        &app,
        "GET",
        &format!("/api/v1/cases/{case_id}"),
        &pm_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let medications = detail["medikamente"].as_array().expect("medication array");
    assert_eq!(medications.len(), 1);
    assert_eq!(medications[0]["expiry_date"], expired_on);
    assert_eq!(medications[0]["is_expired"], true);
    assert_eq!(medications[0]["pending_expiry_confirmation"], false);
    let medication_id =
        Uuid::parse_str(medications[0]["id"].as_str().expect("medication id")).unwrap();

    let state = AppState::new(
        pool.clone(),
        TEST_SECRET,
        SettingsCache::new(TokenSettings::default()),
    );
    let first_summary = gmed_server::routes::cases::run_medication_expiry_scheduler_once(&state)
        .await
        .expect("first medication expiry run");
    assert_eq!(first_summary.events_created, 1);
    assert_eq!(first_summary.notifications_created, 1);

    let second_summary = gmed_server::routes::cases::run_medication_expiry_scheduler_once(&state)
        .await
        .expect("second medication expiry run");
    assert_eq!(second_summary.events_created, 0);
    assert_eq!(second_summary.notifications_created, 0);

    let pending_events: i64 = sqlx::query_scalar(
        r#"SELECT count(*)
           FROM medication_expiry_events
           WHERE medication_id = $1
             AND status = 'pending_confirmation'"#,
    )
    .bind(medication_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(pending_events, 1);

    let notification_count: i64 = sqlx::query_scalar(
        r#"SELECT count(*)
           FROM user_notifications
           WHERE user_id = $1
             AND kind = 'medication_expiry_confirmation'
             AND entity_type = 'case'
             AND entity_id = $2"#,
    )
    .bind(pm_id)
    .bind(case_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(notification_count, 1);

    let (status, detail) = json_request(
        &app,
        "GET",
        &format!("/api/v1/cases/{case_id}"),
        &pm_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        detail["medikamente"][0]["pending_expiry_confirmation"],
        true
    );

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/cases/{case_id}/medikamente/{medication_id}/expiry-confirm"),
        &pm_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["ok"], true);

    let confirmed_events: i64 = sqlx::query_scalar(
        r#"SELECT count(*)
           FROM medication_expiry_events
           WHERE medication_id = $1
             AND status = 'confirmed'"#,
    )
    .bind(medication_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(confirmed_events, 1);

    let (status, detail) = json_request(
        &app,
        "GET",
        &format!("/api/v1/cases/{case_id}"),
        &pm_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        detail["medikamente"][0]["pending_expiry_confirmation"],
        false
    );
    assert_eq!(detail["medikamente"][0]["is_expired"], true);
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
async fn case_gastroenterology_subflow_round_trip_works() {
    let Some((app, pool, admin_id, _)) = test_context().await else {
        return;
    };

    let tag = unique_tag("case-gastroenterology");
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
            "hauptanfragegrund": "Gastroenterology case"
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
                "beschreibung": "Abdominal pain after meals",
                "fachrichtung": "gastroenterology"
            }]
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["count"], 1);

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/cases/{case_id}/gastroenterology"),
        &pm_bearer,
        Some(json!({
            "is_relevant": true,
            "abdominal_pain": true,
            "reflux": true,
            "nausea": false,
            "diarrhea": true,
            "constipation": false,
            "gi_bleeding": false,
            "prior_endoscopy": "Gastroscopy 2024",
            "bowel_habits": "Alternating diarrhea after meals",
            "liver_history": "Mild fatty liver",
            "food_intolerance": "Lactose intolerance suspected",
            "red_flags": "Weight loss and persistent pain",
            "notes": "Needs gastroenterology workup"
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
    assert_eq!(body["gastroenterology_recommended"], true);
    assert_eq!(body["gastroenterology"]["is_relevant"], true);
    assert_eq!(body["gastroenterology"]["abdominal_pain"], true);
    assert_eq!(body["gastroenterology"]["reflux"], true);
    assert_eq!(
        body["gastroenterology"]["prior_endoscopy"],
        "Gastroscopy 2024"
    );
    assert_eq!(
        body["gastroenterology"]["food_intolerance"],
        "Lactose intolerance suspected"
    );
    assert_eq!(
        body["gastroenterology"]["notes"],
        "Needs gastroenterology workup"
    );
}

#[tokio::test]
async fn case_orthopedics_subflow_round_trip_works() {
    let Some((app, pool, admin_id, _)) = test_context().await else {
        return;
    };

    let tag = unique_tag("case-orthopedics");
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
            "hauptanfragegrund": "Orthopedics case"
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
                "beschreibung": "Knee pain and reduced mobility",
                "fachrichtung": "orthopedics"
            }]
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["count"], 1);

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/cases/{case_id}/orthopedics"),
        &pm_bearer,
        Some(json!({
            "is_relevant": true,
            "joint_pain": true,
            "back_pain": false,
            "mobility_limitation": true,
            "trauma_history": true,
            "prior_imaging": "MRI knee 2025",
            "assistive_devices": "Brace during long walks",
            "physiotherapy_history": "6 sessions in 2025",
            "pain_triggers": "Stairs and prolonged standing",
            "red_flags": "Night pain after trauma",
            "notes": "Needs orthopedic workup"
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
    assert_eq!(body["orthopedics_recommended"], true);
    assert_eq!(body["orthopedics"]["is_relevant"], true);
    assert_eq!(body["orthopedics"]["joint_pain"], true);
    assert_eq!(body["orthopedics"]["mobility_limitation"], true);
    assert_eq!(body["orthopedics"]["prior_imaging"], "MRI knee 2025");
    assert_eq!(body["orthopedics"]["notes"], "Needs orthopedic workup");
}

#[tokio::test]
async fn case_neurology_subflow_round_trip_works() {
    let Some((app, pool, admin_id, _)) = test_context().await else {
        return;
    };

    let tag = unique_tag("case-neurology");
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
            "hauptanfragegrund": "Neurology case"
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
                "beschreibung": "Intermittent dizziness and sensory changes",
                "fachrichtung": "neurology"
            }]
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["count"], 1);

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/cases/{case_id}/neurology"),
        &pm_bearer,
        Some(json!({
            "is_relevant": true,
            "headache": true,
            "dizziness": true,
            "sensory_changes": true,
            "weakness": false,
            "seizure_history": false,
            "gait_balance_issues": true,
            "prior_neuro_imaging": "Brain MRI 2024",
            "prior_neurology_workup": "Outpatient neurology consult",
            "cognitive_changes": "Short episodes of word-finding issues",
            "red_flags": "Progressive imbalance",
            "notes": "Needs neurology workup"
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
    assert_eq!(body["neurology_recommended"], true);
    assert_eq!(body["neurology"]["is_relevant"], true);
    assert_eq!(body["neurology"]["dizziness"], true);
    assert_eq!(body["neurology"]["gait_balance_issues"], true);
    assert_eq!(body["neurology"]["prior_neuro_imaging"], "Brain MRI 2024");
    assert_eq!(body["neurology"]["notes"], "Needs neurology workup");
}

#[tokio::test]
async fn case_pulmonology_subflow_round_trip_works() {
    let Some((app, pool, admin_id, _)) = test_context().await else {
        return;
    };

    let tag = unique_tag("case-pulmonology");
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
            "hauptanfragegrund": "Pulmonology case"
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
                "beschreibung": "Chronic cough with wheezing",
                "fachrichtung": "pulmonology"
            }]
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["count"], 1);

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/cases/{case_id}/pulmonology"),
        &pm_bearer,
        Some(json!({
            "is_relevant": true,
            "chronic_cough": true,
            "dyspnea": true,
            "wheezing": true,
            "chest_tightness": false,
            "hemoptysis": false,
            "smoking_history": "15 pack years, stopped 2022",
            "prior_chest_imaging": "Chest CT 2025",
            "inhaler_therapy": "Budesonide/formoterol",
            "sleep_apnea_history": "CPAP since 2024",
            "red_flags": "Night symptoms and exertional dyspnea",
            "notes": "Needs pulmonology workup"
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
    assert_eq!(body["pulmonology_recommended"], true);
    assert_eq!(body["pulmonology"]["is_relevant"], true);
    assert_eq!(body["pulmonology"]["chronic_cough"], true);
    assert_eq!(body["pulmonology"]["dyspnea"], true);
    assert_eq!(body["pulmonology"]["prior_chest_imaging"], "Chest CT 2025");
    assert_eq!(body["pulmonology"]["notes"], "Needs pulmonology workup");
}

#[tokio::test]
async fn case_urology_subflow_round_trip_works() {
    let Some((app, pool, admin_id, _)) = test_context().await else {
        return;
    };

    let tag = unique_tag("case-urology");
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
            "hauptanfragegrund": "Urology case"
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
                "beschreibung": "Urinary frequency with flank pain",
                "fachrichtung": "urology"
            }]
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["count"], 1);

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/cases/{case_id}/urology"),
        &pm_bearer,
        Some(json!({
            "is_relevant": true,
            "dysuria": true,
            "hematuria": false,
            "flank_pain": true,
            "urinary_frequency": true,
            "urinary_retention": false,
            "incontinence": false,
            "prior_urology_workup": "Ultrasound 2024",
            "catheter_history": "None",
            "stone_history": "Kidney stone in 2023",
            "red_flags": "Fever with flank pain",
            "notes": "Needs urology workup"
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
    assert_eq!(body["urology_recommended"], true);
    assert_eq!(body["urology"]["is_relevant"], true);
    assert_eq!(body["urology"]["dysuria"], true);
    assert_eq!(body["urology"]["flank_pain"], true);
    assert_eq!(body["urology"]["stone_history"], "Kidney stone in 2023");
    assert_eq!(body["urology"]["notes"], "Needs urology workup");
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
    assert_eq!(status, StatusCode::OK, "report body: {body:?}");
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
async fn approved_interpreter_report_auto_creates_order_leistung_from_agency_catalog() {
    let Some((app, pool, admin_id, bearer)) = test_context().await else {
        return;
    };

    let tag = unique_tag("interp-billing-auto");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let provider_id = seed_provider(&pool, &tag).await;
    let doctor_id = seed_doctor(&pool, provider_id, &tag).await;
    let pm_id = seed_user(&pool, &tag, "patient_manager").await;
    let interpreter_id = seed_user(&pool, &tag, "interpreter").await;
    let order_id = seed_order(
        &pool,
        patient_id,
        pm_id,
        &format!("ORD-INT-{tag}"),
        "intake",
        "active",
        "Interpreter support",
    )
    .await;

    seed_patient_assignment(&pool, patient_id, pm_id, admin_id).await;
    seed_patient_assignment(&pool, patient_id, interpreter_id, admin_id).await;
    deactivate_agency_service_catalog_item(&pool, "interpreter_hours").await;

    let appointment_id = seed_appointment(
        &pool,
        patient_id,
        provider_id,
        doctor_id,
        pm_id,
        &format!("Interpreter billing {tag}"),
        "confirmed",
        "2026-04-21",
    )
    .await;

    sqlx::query(
        "UPDATE appointments
         SET order_id = $2, interpreter_id = $3, interpreter_response = 'accepted'
         WHERE id = $1",
    )
    .bind(appointment_id)
    .bind(order_id)
    .bind(interpreter_id)
    .execute(&pool)
    .await
    .unwrap();

    let agency_service_id = seed_agency_service_catalog_item(
        &pool,
        admin_id,
        "interpreter_hours",
        "Interpreter hours",
        "2026-01-01",
    )
    .await;

    let interpreter_bearer = auth_header_for(interpreter_id, "interpreter");
    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/appointments/{appointment_id}/report"),
        &interpreter_bearer,
        Some(json!({
            "hours": 2.5,
            "report_text": format!("Interpreter completed support for {tag}"),
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let report_id = body["id"].as_str().unwrap().to_string();

    let pm_bearer = auth_header_for(pm_id, "patient_manager");
    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/appointments/{appointment_id}/report/approve"),
        &pm_bearer,
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
    assert_eq!(body["billing_sync_status"], "synced");
    assert_eq!(body["billing_service_key"], "interpreter_hours");
    let billing_leistung_id = body["billing_leistung_id"]
        .as_str()
        .expect("billing leistung id");

    let (status, order_body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/orders/{order_id}"),
        &bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let leistungen = order_body["leistungen"]
        .as_array()
        .expect("leistungen array");
    assert_eq!(leistungen.len(), 1);
    assert_eq!(leistungen[0]["id"], billing_leistung_id);
    assert_eq!(leistungen[0]["status"], "approved");
    assert_eq!(leistungen[0]["quantity"], "2.5");
    assert_eq!(leistungen[0]["source_interpreter_report_id"], report_id);
    assert_eq!(leistungen[0]["agency_service_key"], "interpreter_hours");
    assert_eq!(leistungen[0]["agency_service_name"], "Interpreter hours");
    assert_eq!(
        leistungen[0]["agency_service_id"],
        agency_service_id.to_string()
    );
}

#[tokio::test]
async fn completed_medical_appointment_auto_creates_order_leistung_from_agency_catalog() {
    let Some((app, pool, admin_id, bearer)) = test_context().await else {
        return;
    };

    let tag = unique_tag("medical-billing-auto");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let provider_id = seed_provider(&pool, &tag).await;
    let doctor_id = seed_doctor(&pool, provider_id, &tag).await;
    let pm_id = seed_user(&pool, &tag, "patient_manager").await;
    let order_id = seed_order(
        &pool,
        patient_id,
        pm_id,
        &format!("ORD-MED-{tag}"),
        "execution",
        "active",
        "Treatment coordination",
    )
    .await;

    seed_patient_assignment(&pool, patient_id, pm_id, admin_id).await;

    let appointment_id = seed_appointment(
        &pool,
        patient_id,
        provider_id,
        doctor_id,
        pm_id,
        &format!("Medical billing {tag}"),
        "confirmed",
        "2026-04-24",
    )
    .await;

    sqlx::query("UPDATE appointments SET order_id = $2 WHERE id = $1")
        .bind(appointment_id)
        .bind(order_id)
        .execute(&pool)
        .await
        .unwrap();

    let agency_service_id = seed_agency_service_catalog_item(
        &pool,
        admin_id,
        "treatment_organization",
        "Organisation der Behandlung",
        "2026-01-01",
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

    let (status, order_body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/orders/{order_id}"),
        &bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let leistungen = order_body["leistungen"]
        .as_array()
        .expect("leistungen array after completion");
    assert_eq!(leistungen.len(), 1);
    assert_eq!(leistungen[0]["description"], "Organisation der Behandlung");
    assert_eq!(leistungen[0]["status"], "delivered");
    assert_eq!(leistungen[0]["quantity"], "1");
    assert_eq!(leistungen[0]["provider_id"], provider_id.to_string());
    assert_eq!(leistungen[0]["doctor_id"], doctor_id.to_string());
    assert_eq!(
        leistungen[0]["source_medical_appointment_id"],
        appointment_id.to_string()
    );
    assert_eq!(
        leistungen[0]["agency_service_key"],
        "treatment_organization"
    );
    assert_eq!(
        leistungen[0]["agency_service_name"],
        "Organisation der Behandlung"
    );
    assert_eq!(
        leistungen[0]["agency_service_id"],
        agency_service_id.to_string()
    );
    assert!(
        leistungen[0]["notes"]
            .as_str()
            .unwrap_or_default()
            .contains("Automatisch aus abgeschlossenem medizinischem Termin")
    );

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/appointments/{appointment_id}/status"),
        &pm_bearer,
        Some(json!({ "status": "completed" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (status, leistungen_body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/orders/{order_id}/leistungen"),
        &bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let leistungen = leistungen_body
        .as_array()
        .expect("leistungen array on second fetch");
    assert_eq!(leistungen.len(), 1);
    assert_eq!(
        leistungen[0]["source_medical_appointment_id"],
        appointment_id.to_string()
    );
}

#[tokio::test]
async fn interpreter_report_billing_scheduler_backfills_after_catalog_setup_without_duplicates() {
    let Some((app, pool, admin_id, bearer)) = test_context().await else {
        return;
    };

    let tag = unique_tag("interp-billing-scheduler");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let provider_id = seed_provider(&pool, &tag).await;
    let doctor_id = seed_doctor(&pool, provider_id, &tag).await;
    let pm_id = seed_user(&pool, &tag, "patient_manager").await;
    let interpreter_id = seed_user(&pool, &tag, "interpreter").await;
    let order_id = seed_order(
        &pool,
        patient_id,
        pm_id,
        &format!("ORD-SYNC-{tag}"),
        "intake",
        "active",
        "Interpreter follow-up",
    )
    .await;

    seed_patient_assignment(&pool, patient_id, pm_id, admin_id).await;
    seed_patient_assignment(&pool, patient_id, interpreter_id, admin_id).await;
    deactivate_agency_service_catalog_item(&pool, "interpreter_hours").await;

    let appointment_id = seed_appointment(
        &pool,
        patient_id,
        provider_id,
        doctor_id,
        pm_id,
        &format!("Interpreter scheduler {tag}"),
        "confirmed",
        "2026-04-22",
    )
    .await;

    sqlx::query(
        "UPDATE appointments
         SET order_id = $2, interpreter_id = $3, interpreter_response = 'accepted'
         WHERE id = $1",
    )
    .bind(appointment_id)
    .bind(order_id)
    .bind(interpreter_id)
    .execute(&pool)
    .await
    .unwrap();

    let interpreter_bearer = auth_header_for(interpreter_id, "interpreter");
    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/appointments/{appointment_id}/report"),
        &interpreter_bearer,
        Some(json!({
            "hours": 3.0,
            "report_text": format!("Missing catalog backfill {tag}"),
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);

    let pm_bearer = auth_header_for(pm_id, "patient_manager");
    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/appointments/{appointment_id}/report/approve"),
        &pm_bearer,
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
    assert_eq!(status, StatusCode::OK, "report body: {body:?}");
    assert_eq!(body["approval_status"], "approved");
    assert_eq!(body["billing_sync_status"], "missing_catalog");
    assert!(body["billing_leistung_id"].is_null());

    let state = AppState::new(
        pool.clone(),
        TEST_SECRET,
        SettingsCache::new(TokenSettings::default()),
    );

    let first_run =
        gmed_server::routes::appointments::run_interpreter_report_billing_sync_once(&state)
            .await
            .unwrap();
    assert_eq!(first_run.leistungen_created, 0);
    assert_eq!(first_run.missing_catalog, 1);

    seed_agency_service_catalog_item(
        &pool,
        admin_id,
        "interpreter_hours",
        "Interpreter hours",
        "2026-01-01",
    )
    .await;

    let second_run =
        gmed_server::routes::appointments::run_interpreter_report_billing_sync_once(&state)
            .await
            .unwrap();
    assert_eq!(second_run.leistungen_created, 1);
    assert_eq!(second_run.missing_catalog, 0);

    let third_run =
        gmed_server::routes::appointments::run_interpreter_report_billing_sync_once(&state)
            .await
            .unwrap();
    assert_eq!(third_run.leistungen_created, 0);
    assert_eq!(third_run.missing_catalog, 0);
    assert_eq!(third_run.missing_order, 0);

    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/appointments/{appointment_id}/report"),
        &bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["billing_sync_status"], "synced");
    assert_eq!(body["billing_service_key"], "interpreter_hours");
}

#[tokio::test]
async fn approved_interpreter_report_without_order_exposes_missing_order_billing_projection() {
    let Some((app, pool, admin_id, bearer)) = test_context().await else {
        return;
    };

    let tag = unique_tag("interp-billing-missing-order");
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
        &format!("Interpreter no-order {tag}"),
        "confirmed",
        "2026-04-23",
    )
    .await;

    let interpreter_bearer = auth_header_for(interpreter_id, "interpreter");
    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/appointments/{appointment_id}/report"),
        &interpreter_bearer,
        Some(json!({
            "hours": 1.5,
            "report_text": format!("No order yet {tag}"),
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let report_id = body["id"].as_str().unwrap().to_string();

    let pm_bearer = auth_header_for(pm_id, "patient_manager");
    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/appointments/{appointment_id}/report/approve"),
        &pm_bearer,
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
    assert_eq!(body["billing_sync_status"], "missing_order");
    assert!(body["billing_leistung_id"].is_null());
    assert!(body["billing_service_key"].is_null());

    let synced_count: i64 = sqlx::query_scalar(
        "SELECT count(*)::bigint FROM order_leistungen WHERE source_interpreter_report_id::text = $1",
    )
    .bind(report_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(synced_count, 0);
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
async fn patient_assignment_creates_assign_and_revoke_notifications_without_duplicates() {
    let Some((app, pool, admin_id, _)) = test_context().await else {
        return;
    };

    let tag = unique_tag("assign-notifications");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let pm_id = seed_user(&pool, &format!("{tag}-pm"), "patient_manager").await;
    let concierge_id = seed_user(&pool, &format!("{tag}-concierge"), "concierge").await;
    seed_patient_assignment(&pool, patient_id, pm_id, admin_id).await;
    let pm_bearer = auth_header_for(pm_id, "patient_manager");

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/patients/{patient_id}/assign"),
        &pm_bearer,
        Some(json!({ "user_id": concierge_id })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let assignment_rows = sqlx::query(
        r#"SELECT title, body
           FROM user_notifications
           WHERE user_id = $1
             AND kind = 'patient_assignment'
             AND entity_type = 'patient'
             AND entity_id = $2
           ORDER BY created_at ASC"#,
    )
    .bind(concierge_id)
    .bind(patient_id)
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(assignment_rows.len(), 1);
    let assignment_title = assignment_rows[0].get::<String, _>("title");
    let assignment_body = assignment_rows[0].get::<String, _>("body");
    assert!(assignment_title.contains("New patient assignment"));
    assert!(assignment_body.contains(&format!("PT-{tag}")));

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/patients/{patient_id}/assign"),
        &pm_bearer,
        Some(json!({ "user_id": concierge_id })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let assignment_count: i64 = sqlx::query_scalar(
        r#"SELECT count(*)
           FROM user_notifications
           WHERE user_id = $1
             AND kind = 'patient_assignment'
             AND entity_type = 'patient'
             AND entity_id = $2"#,
    )
    .bind(concierge_id)
    .bind(patient_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(assignment_count, 1);

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/patients/{patient_id}/revoke"),
        &pm_bearer,
        Some(json!({ "user_id": concierge_id })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let revoke_rows = sqlx::query(
        r#"SELECT title, body
           FROM user_notifications
           WHERE user_id = $1
             AND kind = 'patient_assignment_revoked'
             AND entity_type = 'patient'
             AND entity_id = $2
           ORDER BY created_at ASC"#,
    )
    .bind(concierge_id)
    .bind(patient_id)
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(revoke_rows.len(), 1);
    let revoke_title = revoke_rows[0].get::<String, _>("title");
    let revoke_body = revoke_rows[0].get::<String, _>("body");
    assert!(revoke_title.contains("Patient assignment revoked"));
    assert!(revoke_body.contains(&format!("PT-{tag}")));
}

#[tokio::test]
async fn patient_vitals_round_trip_and_clinical_warnings_flow_through_profile() {
    let Some((app, pool, admin_id, _)) = test_context().await else {
        return;
    };

    let tag = unique_tag("patient-vitals");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let pm_id = seed_user(&pool, &format!("{tag}-pm"), "patient_manager").await;
    seed_patient_assignment(&pool, patient_id, pm_id, admin_id).await;
    let pm_bearer = auth_header_for(pm_id, "patient_manager");

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/patients/{patient_id}/update"),
        &pm_bearer,
        Some(json!({
            "clinical_warnings": "Latex allergy\nMonitor blood pressure before sedation",
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/patients/{patient_id}/vitals"),
        &pm_bearer,
        Some(json!({
            "measured_at": "2026-04-14T09:45:00Z",
            "bp_systolic": 125.0,
            "bp_diastolic": 82.0,
            "heart_rate": 71,
            "weight_kg": 72.0,
            "height_cm": 175.0,
            "notes": "Pre-op baseline",
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/patients/{patient_id}/vitals"),
        &pm_bearer,
        Some(json!({
            "measured_at": "2026-04-13T08:15:00Z",
            "weight_kg": 71.2,
            "heart_rate": 69,
            "notes": "Day-before intake",
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (status, detail) = json_request(
        &app,
        "GET",
        &format!("/api/v1/patients/{patient_id}"),
        &pm_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        detail["clinical_warnings"],
        "Latex allergy\nMonitor blood pressure before sedation"
    );

    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/patients/{patient_id}/vitals"),
        &pm_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["count"], 2);
    let items = body["items"].as_array().expect("vitals array");
    assert_eq!(items.len(), 2);
    assert_eq!(items[0]["measured_at"], "2026-04-14T09:45:00+00:00");
    assert_eq!(items[0]["bp_systolic"], 125.0);
    assert_eq!(items[0]["bp_diastolic"], 82.0);
    assert_eq!(items[0]["heart_rate"], 71);
    assert_eq!(items[0]["weight_kg"], 72.0);
    assert_eq!(items[0]["height_cm"], 175.0);
    let bmi = items[0]["bmi"].as_f64().expect("bmi");
    assert!(
        (bmi - 23.5).abs() < 0.05,
        "expected auto-computed bmi close to 23.5, got {bmi}"
    );
    assert_eq!(items[0]["notes"], "Pre-op baseline");
    assert_eq!(items[1]["measured_at"], "2026-04-13T08:15:00+00:00");
}

#[tokio::test]
async fn billing_cannot_access_patient_vitals_routes() {
    let Some((app, pool, admin_id, _)) = test_context().await else {
        return;
    };

    let tag = unique_tag("patient-vitals-deny");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let billing_id = seed_user(&pool, &format!("{tag}-billing"), "billing").await;
    let billing_bearer = auth_header_for(billing_id, "billing");

    let (status, _) = json_request(
        &app,
        "GET",
        &format!("/api/v1/patients/{patient_id}/vitals"),
        &billing_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/patients/{patient_id}/vitals"),
        &billing_bearer,
        Some(json!({
            "measured_at": "2026-04-14T09:45:00Z",
            "heart_rate": 70,
        })),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn patient_card_entries_round_trip_and_appear_in_timeline() {
    let Some((app, pool, admin_id, _)) = test_context().await else {
        return;
    };

    let tag = unique_tag("patient-card-entry");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let pm_id = seed_user(&pool, &format!("{tag}-pm"), "patient_manager").await;
    seed_patient_assignment(&pool, patient_id, pm_id, admin_id).await;
    let pm_bearer = auth_header_for(pm_id, "patient_manager");

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/patients/{patient_id}/card-entries"),
        &pm_bearer,
        Some(json!({
            "entry_date": "2026-04-14T11:30:00Z",
            "category": "medical_update",
            "source": "Clinic intake call",
            "content": "Patient reports increased dizziness after morning medication adjustment.",
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/patients/{patient_id}/card-entries"),
        &pm_bearer,
        Some(json!({
            "entry_date": "2026-04-13T16:10:00Z",
            "category": "followup_note",
            "source": "Patient",
            "content": "Symptoms improved by the evening after hydration.",
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/patients/{patient_id}/card-entries"),
        &pm_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["count"], 2);
    let items = body["items"].as_array().expect("card entries array");
    assert_eq!(items.len(), 2);
    assert_eq!(items[0]["category"], "medical_update");
    assert_eq!(items[0]["source"], "Clinic intake call");
    assert_eq!(
        items[0]["content"],
        "Patient reports increased dizziness after morning medication adjustment."
    );
    assert_eq!(items[1]["category"], "followup_note");

    let (status, timeline) = json_request(
        &app,
        "GET",
        &format!("/api/v1/patients/{patient_id}/timeline?entity_type=card_entry"),
        &pm_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let timeline_items = timeline["items"].as_array().expect("timeline items");
    assert_eq!(timeline_items.len(), 2);
    assert_eq!(timeline_items[0]["entity_type"], "card_entry");
    assert_eq!(timeline_items[0]["category"], "medical_update");
    assert_eq!(timeline_items[0]["status"], "logged");
    let source_label = timeline_items[0]["source_label"]
        .as_str()
        .expect("source label");
    assert!(source_label.contains("Clinic intake call"));
    assert!(source_label.contains(&format!("patient_manager {tag}-pm")));
}

#[tokio::test]
async fn billing_cannot_access_patient_card_entries_routes() {
    let Some((app, pool, admin_id, _)) = test_context().await else {
        return;
    };

    let tag = unique_tag("patient-card-entry-deny");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let billing_id = seed_user(&pool, &format!("{tag}-billing"), "billing").await;
    let billing_bearer = auth_header_for(billing_id, "billing");

    let (status, _) = json_request(
        &app,
        "GET",
        &format!("/api/v1/patients/{patient_id}/card-entries"),
        &billing_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/patients/{patient_id}/card-entries"),
        &billing_bearer,
        Some(json!({
            "entry_date": "2026-04-14T11:30:00Z",
            "category": "warning",
            "content": "Finance role should not create clinical entries.",
        })),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn patient_medical_orders_round_trip_status_update_and_timeline() {
    let Some((app, pool, admin_id, _)) = test_context().await else {
        return;
    };

    let tag = unique_tag("patient-medical-order");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let pm_id = seed_user(&pool, &format!("{tag}-pm"), "patient_manager").await;
    seed_patient_assignment(&pool, patient_id, pm_id, admin_id).await;
    let pm_bearer = auth_header_for(pm_id, "patient_manager");

    let (status, create_body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/patients/{patient_id}/medical-orders"),
        &pm_bearer,
        Some(json!({
            "order_date": "2026-04-14T12:00:00Z",
            "order_type": "physiotherapy",
            "title": "Physiotherapy 2x weekly",
            "instructions": "Start with lumbar stabilization and gait assessment for six weeks.",
            "due_date": "2026-05-26",
            "source": "Discharge note",
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let medical_order_id = create_body["id"].as_str().expect("medical order id");

    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/patients/{patient_id}/medical-orders"),
        &pm_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["count"], 1);
    let items = body["items"].as_array().expect("medical orders array");
    assert_eq!(items[0]["order_type"], "physiotherapy");
    assert_eq!(items[0]["status"], "active");
    assert_eq!(items[0]["due_date"], "2026-05-26");
    assert_eq!(items[0]["source"], "Discharge note");

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/patients/{patient_id}/medical-orders/{medical_order_id}/update"),
        &pm_bearer,
        Some(json!({
            "status": "completed",
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/patients/{patient_id}/medical-orders"),
        &pm_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let items = body["items"].as_array().expect("medical orders array");
    assert_eq!(items[0]["status"], "completed");

    let (status, timeline) = json_request(
        &app,
        "GET",
        &format!("/api/v1/patients/{patient_id}/timeline?entity_type=medical_order"),
        &pm_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let timeline_items = timeline["items"].as_array().expect("timeline items");
    assert_eq!(timeline_items.len(), 1);
    assert_eq!(timeline_items[0]["entity_type"], "medical_order");
    assert_eq!(timeline_items[0]["category"], "physiotherapy");
    assert_eq!(timeline_items[0]["status"], "completed");
    assert_eq!(timeline_items[0]["title"], "Physiotherapy 2x weekly");
}

#[tokio::test]
async fn billing_cannot_access_patient_medical_orders_routes() {
    let Some((app, pool, admin_id, _)) = test_context().await else {
        return;
    };

    let tag = unique_tag("patient-medical-order-deny");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let billing_id = seed_user(&pool, &format!("{tag}-billing"), "billing").await;
    let billing_bearer = auth_header_for(billing_id, "billing");

    let (status, _) = json_request(
        &app,
        "GET",
        &format!("/api/v1/patients/{patient_id}/medical-orders"),
        &billing_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/patients/{patient_id}/medical-orders"),
        &billing_bearer,
        Some(json!({
            "order_date": "2026-04-14T12:00:00Z",
            "order_type": "other",
            "title": "Forbidden finance mutation",
            "instructions": "Should not be allowed.",
        })),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn patient_risk_scores_round_trip_and_timeline() {
    let Some((app, pool, admin_id, _)) = test_context().await else {
        return;
    };

    let tag = unique_tag("patient-risk-score");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let pm_id = seed_user(&pool, &format!("{tag}-pm"), "patient_manager").await;
    seed_patient_assignment(&pool, patient_id, pm_id, admin_id).await;
    let pm_bearer = auth_header_for(pm_id, "patient_manager");

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/patients/{patient_id}/risk-scores"),
        &pm_bearer,
        Some(json!({
            "computed_at": "2026-04-14T14:15:00Z",
            "score_type": "cha2ds2_vasc",
            "score_value": 4.0,
            "scale_max": 9.0,
            "interpretation": "Moderate-to-high stroke risk. Anticoagulation review required.",
            "source": "Cardiology review",
            "inputs": {
                "age_65_74": true,
                "hypertension": true,
                "diabetes": false,
                "prior_stroke_tia": true
            }
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/patients/{patient_id}/risk-scores"),
        &pm_bearer,
        Some(json!({
            "computed_at": "2026-04-13T09:00:00Z",
            "score_type": "fall_risk",
            "score_value": 2.0,
            "scale_max": 5.0,
            "interpretation": "Needs escort support during transfers.",
            "source": "Nursing intake"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/patients/{patient_id}/risk-scores"),
        &pm_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["count"], 2);
    let items = body["items"].as_array().expect("risk scores array");
    assert_eq!(items[0]["score_type"], "cha2ds2_vasc");
    assert_eq!(items[0]["score_value"], 4.0);
    assert_eq!(items[0]["scale_max"], 9.0);
    assert_eq!(items[0]["source"], "Cardiology review");
    assert_eq!(items[0]["inputs"]["hypertension"], true);
    assert_eq!(items[1]["score_type"], "fall_risk");

    let (status, timeline) = json_request(
        &app,
        "GET",
        &format!("/api/v1/patients/{patient_id}/timeline?entity_type=risk_score"),
        &pm_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let timeline_items = timeline["items"].as_array().expect("timeline items");
    assert_eq!(timeline_items.len(), 2);
    assert_eq!(timeline_items[0]["entity_type"], "risk_score");
    assert_eq!(timeline_items[0]["category"], "cha2ds2_vasc");
    assert_eq!(timeline_items[0]["status"], "recorded");
    let source_label = timeline_items[0]["source_label"]
        .as_str()
        .expect("source label");
    assert!(source_label.contains("Cardiology review"));
    assert!(source_label.contains(&format!("patient_manager {tag}-pm")));
}

#[tokio::test]
async fn billing_cannot_access_patient_risk_scores_routes() {
    let Some((app, pool, admin_id, _)) = test_context().await else {
        return;
    };

    let tag = unique_tag("patient-risk-score-deny");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let billing_id = seed_user(&pool, &format!("{tag}-billing"), "billing").await;
    let billing_bearer = auth_header_for(billing_id, "billing");

    let (status, _) = json_request(
        &app,
        "GET",
        &format!("/api/v1/patients/{patient_id}/risk-scores"),
        &billing_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/patients/{patient_id}/risk-scores"),
        &billing_bearer,
        Some(json!({
            "computed_at": "2026-04-14T14:15:00Z",
            "score_type": "other",
            "score_value": 1.0
        })),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
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
async fn teamlead_only_sees_assigned_patients_and_appointments() {
    let Some((app, pool, admin_id, _)) = test_context().await else {
        return;
    };

    let tag = unique_tag("teamlead-visibility");
    let visible_patient_id = seed_patient(&pool, admin_id, &format!("{tag}-visible")).await;
    let hidden_patient_id = seed_patient(&pool, admin_id, &format!("{tag}-hidden")).await;
    let provider_id = seed_provider(&pool, &tag).await;
    let doctor_id = seed_doctor(&pool, provider_id, &tag).await;
    let visible_appointment_id = seed_appointment(
        &pool,
        visible_patient_id,
        provider_id,
        doctor_id,
        admin_id,
        "Assigned interpreter slot",
        "planned",
        "2026-04-20",
    )
    .await;
    let hidden_appointment_id = seed_appointment(
        &pool,
        hidden_patient_id,
        provider_id,
        doctor_id,
        admin_id,
        "Hidden interpreter slot",
        "planned",
        "2026-04-21",
    )
    .await;
    let teamlead_id = seed_user(&pool, &tag, "teamlead_interpreter").await;
    seed_patient_assignment(&pool, visible_patient_id, teamlead_id, admin_id).await;

    let teamlead_bearer = auth_header_for(teamlead_id, "teamlead_interpreter");

    let (status, body) =
        json_request(&app, "GET", "/api/v1/patients", &teamlead_bearer, None).await;
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
        json_request(&app, "GET", "/api/v1/appointments", &teamlead_bearer, None).await;
    assert_eq!(status, StatusCode::OK);
    let items = body.as_array().unwrap();
    assert!(
        items
            .iter()
            .any(|item| item["id"] == visible_appointment_id.to_string())
    );
    assert!(
        !items
            .iter()
            .any(|item| item["id"] == hidden_appointment_id.to_string())
    );
}

#[tokio::test]
async fn patient_detail_view_audit_logs_visible_fields_for_role_filtered_payload() {
    let Some((app, pool, admin_id, _)) = test_context().await else {
        return;
    };

    let tag = unique_tag("patient-view-audit");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    sqlx::query("UPDATE patients SET functional_labels = $2, email = $3 WHERE id = $1")
        .bind(patient_id)
        .bind(vec!["vip".to_string(), "high_risk".to_string()])
        .bind("masked-interpreter@example.com")
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

    support::wait_until("interpreter patient view audit context", || async {
        let exists: Option<Value> = sqlx::query_scalar(
            r#"SELECT context
               FROM audit_log
               WHERE action = 'view_patient'
                 AND entity_type = 'patient'
                 AND entity_id = $1
               ORDER BY created_at DESC
               LIMIT 1"#,
        )
        .bind(patient_id)
        .fetch_optional(&pool)
        .await
        .unwrap();
        exists.is_some()
    })
    .await;
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
async fn ceo_assistant_can_read_patient_registry_with_role_filtered_fields() {
    let Some((app, pool, admin_id, _)) = test_context().await else {
        return;
    };

    let tag = unique_tag("ceo-assistant-patient-registry");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    sqlx::query(
        r#"UPDATE patients
           SET phone_primary = $2,
               email = $3,
               nationality = $4,
               residence_country = $5,
               languages = $6,
               functional_labels = $7,
               insurance_provider = $8,
               insurance_number = $9,
               insurance_type = $10,
               legal_status = $11,
               notes = $12
           WHERE id = $1"#,
    )
    .bind(patient_id)
    .bind("+49 123 4567")
    .bind("assistant-visible@example.com")
    .bind("DE")
    .bind("Germany")
    .bind(vec!["de".to_string(), "en".to_string()])
    .bind(vec!["vip".to_string(), "high_risk".to_string()])
    .bind("AOK")
    .bind("POL-123")
    .bind("private")
    .bind(json!({ "restriction_hold": true }))
    .bind("Internal notes must stay hidden")
    .execute(&pool)
    .await
    .unwrap();

    let assistant_id = seed_user(&pool, &tag, "ceo_assistant").await;
    let assistant_bearer = auth_header_for(assistant_id, "ceo_assistant");

    let (status, body) =
        json_request(&app, "GET", "/api/v1/patients", &assistant_bearer, None).await;
    assert_eq!(status, StatusCode::OK);
    let items = body.as_array().unwrap();
    let summary = items
        .iter()
        .find(|item| item["id"] == patient_id.to_string())
        .cloned()
        .expect("patient visible in ceo assistant registry");
    assert_eq!(summary["first_name"], format!("First {tag}"));
    assert_eq!(summary["email"], "assistant-visible@example.com");
    assert_eq!(summary["phone_primary"], "+49 123 4567");
    assert_eq!(summary["insurance_provider"], Value::Null);
    assert_eq!(summary["insurance_type"], Value::Null);
    assert!(summary.get("functional_labels").is_none());

    let (status, detail) = json_request(
        &app,
        "GET",
        &format!("/api/v1/patients/{patient_id}"),
        &assistant_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(detail["first_name"], format!("First {tag}"));
    assert_eq!(detail["last_name"], format!("Last {tag}"));
    assert_eq!(detail["email"], "assistant-visible@example.com");
    assert_eq!(detail["phone_primary"], "+49 123 4567");
    assert_eq!(detail["nationality"], "DE");
    assert_eq!(detail["residence_country"], "Germany");
    assert_eq!(detail["languages"][0], "de");
    assert_eq!(detail["languages"][1], "en");
    assert_eq!(detail["insurance_provider"], Value::Null);
    assert_eq!(detail["insurance_number"], Value::Null);
    assert_eq!(detail["insurance_type"], Value::Null);
    assert!(detail.get("functional_labels").is_none());
    assert!(detail.get("legal_status").is_none());
    assert!(detail.get("notes").is_none());
    assert!(detail.get("address_street").is_none());
    assert!(detail.get("emergency_contact_name").is_none());

    support::wait_until("ceo assistant patient view audit context", || async {
        let exists: Option<Value> = sqlx::query_scalar(
            r#"SELECT context
               FROM audit_log
               WHERE action = 'view_patient'
                 AND entity_type = 'patient'
                 AND entity_id = $1
               ORDER BY created_at DESC
               LIMIT 1"#,
        )
        .bind(patient_id)
        .fetch_optional(&pool)
        .await
        .unwrap();
        exists.is_some()
    })
    .await;
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

    assert_eq!(context["role"], "ceo_assistant");
    let visible_fields = context["visible_fields"]
        .as_array()
        .expect("visible_fields array");
    assert!(visible_fields.iter().any(|field| field == "email"));
    assert!(visible_fields.iter().any(|field| field == "phone_primary"));
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
    assert!(
        visible_fields
            .iter()
            .all(|field| field != "functional_labels")
    );
    assert!(visible_fields.iter().all(|field| field != "legal_status"));
    assert!(visible_fields.iter().all(|field| field != "notes"));
}

#[tokio::test]
async fn sales_cannot_open_patient_registry() {
    let Some((app, pool, admin_id, _)) = test_context().await else {
        return;
    };

    let tag = unique_tag("sales-patient-registry-block");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let sales_id = seed_user(&pool, &tag, "sales").await;
    let sales_bearer = auth_header_for(sales_id, "sales");

    let (status, _) = json_request(&app, "GET", "/api/v1/patients", &sales_bearer, None).await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    let (status, _) = json_request(
        &app,
        "GET",
        &format!("/api/v1/patients/{patient_id}"),
        &sales_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn it_admin_can_open_patient_registry_case_and_reports_workspace() {
    let Some((app, pool, admin_id, _)) = test_context().await else {
        return;
    };

    let tag = unique_tag("it-admin-rbac-full");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let case_id = seed_case(
        &pool,
        patient_id,
        admin_id,
        &format!("C-{tag}"),
        "open",
        "Restricted clinical context",
    )
    .await;
    let it_admin_id = seed_user(&pool, &tag, "it_admin").await;
    let it_admin_bearer = auth_header_for(it_admin_id, "it_admin");

    let (status, body) =
        json_request(&app, "GET", "/api/v1/patients", &it_admin_bearer, None).await;
    assert_eq!(status, StatusCode::OK);
    assert!(
        body.as_array().is_some_and(|patients| patients
            .iter()
            .any(|patient| patient["id"] == json!(patient_id.to_string()))),
        "IT admin should see the seeded patient in the registry: {body}"
    );

    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/patients/{patient_id}"),
        &it_admin_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["id"], json!(patient_id.to_string()));

    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/cases/{case_id}"),
        &it_admin_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["id"], json!(case_id.to_string()));

    let (status, body) = json_request(
        &app,
        "GET",
        "/api/v1/stats/reports/workspace",
        &it_admin_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(
        body["allowed_sections"]
            .as_array()
            .is_some_and(|sections| sections
                .iter()
                .any(|section| section.as_str() == Some("provider_costs"))),
        "IT admin should receive full reports workspace sections: {body}"
    );
}

#[tokio::test]
async fn billing_cannot_open_medical_case_detail() {
    let Some((app, pool, admin_id, _)) = test_context().await else {
        return;
    };

    let tag = unique_tag("billing-case-block");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let case_id = seed_case(
        &pool,
        patient_id,
        admin_id,
        &format!("C-{tag}"),
        "open",
        "Billing must not see medical details",
    )
    .await;
    let billing_id = seed_user(&pool, &tag, "billing").await;
    let billing_bearer = auth_header_for(billing_id, "billing");

    let (status, _) = json_request(
        &app,
        "GET",
        &format!("/api/v1/cases/{case_id}"),
        &billing_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
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
    .bind(parse_date("1990-04-10"))
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

    support::wait_until("patient label generation audit context", || async {
        let exists: Option<Value> = sqlx::query_scalar(
            r#"SELECT context
               FROM audit_log
               WHERE action = 'generate_patient_label'
                 AND entity_type = 'patient'
                 AND entity_id = $1
               ORDER BY created_at DESC
               LIMIT 1"#,
        )
        .bind(patient_uuid)
        .fetch_optional(&pool)
        .await
        .unwrap();
        exists.is_some()
    })
    .await;
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
    let appointment_id = Uuid::parse_str(body["id"].as_str().unwrap()).unwrap();

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
    let appointment_id = Uuid::parse_str(body["id"].as_str().unwrap()).unwrap();

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
            "recurrence_until": "2026-05-25"
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
async fn patient_manager_can_reschedule_whole_recurring_appointment_series() {
    let Some((app, pool, admin_id, _)) = test_context().await else {
        return;
    };

    let tag = unique_tag("recurring-appointment-update");
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
            "recurrence_count": 3
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let root_id = Uuid::parse_str(body["id"].as_str().unwrap()).unwrap();

    let updated_title = format!("Shifted recurring therapy {tag}");
    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/appointments/{root_id}/update"),
        &pm_bearer,
        Some(json!({
            "provider_id": provider_id,
            "doctor_id": doctor_id,
            "owner_user_id": pm_id,
            "interpreter_id": Value::Null,
            "title": updated_title,
            "date": "2026-05-06",
            "time_start": "11:00",
            "time_end": "12:30",
            "location": "Telemedicine room 2",
            "recurrence_scope": "series"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["recurrence_scope"], "series");
    assert_eq!(body["affected_count"], 3);

    let rows = sqlx::query(
        r#"SELECT title, date, time_start, time_end, location, recurrence_index
           FROM appointments
           WHERE recurrence_series_id = $1
           ORDER BY recurrence_index"#,
    )
    .bind(root_id)
    .fetch_all(&pool)
    .await
    .unwrap();

    assert_eq!(rows.len(), 3);
    let expected_dates = ["2026-05-06", "2026-05-13", "2026-05-20"];
    for (index, row) in rows.iter().enumerate() {
        let appointment_date = row
            .try_get::<chrono::NaiveDate, _>("date")
            .unwrap()
            .to_string();
        let time_start = row
            .try_get::<Option<chrono::NaiveTime>, _>("time_start")
            .unwrap()
            .unwrap()
            .to_string();
        let time_end = row
            .try_get::<Option<chrono::NaiveTime>, _>("time_end")
            .unwrap()
            .unwrap()
            .to_string();
        let recurrence_index: i32 = row.try_get("recurrence_index").unwrap();

        assert_eq!(recurrence_index, index as i32);
        assert_eq!(row.try_get::<String, _>("title").unwrap(), updated_title);
        assert_eq!(appointment_date, expected_dates[index]);
        assert_eq!(time_start, "11:00:00");
        assert_eq!(time_end, "12:30:00");
        assert_eq!(
            row.try_get::<Option<String>, _>("location")
                .unwrap()
                .as_deref(),
            Some("Telemedicine room 2")
        );
    }
}

#[tokio::test]
async fn appointment_update_preserves_category_and_persists_recurrence_rule_edits() {
    let Some((app, pool, admin_id, _)) = test_context().await else {
        return;
    };

    let tag = unique_tag("apt-edit-roundtrip");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let provider_id = seed_provider(&pool, &tag).await;
    let doctor_id = seed_doctor(&pool, provider_id, &tag).await;
    let pm_id = seed_user(&pool, &tag, "patient_manager").await;
    seed_patient_assignment(&pool, patient_id, pm_id, admin_id).await;
    let pm_bearer = auth_header_for(pm_id, "patient_manager");

    let title = format!("Recurring category {tag}");
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
            "location": "Initial room",
            "category": "initial_category",
            "notes": "Initial note",
            "recurrence_frequency": "weekly",
            "recurrence_interval": 1,
            "recurrence_count": 3
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let root_id = Uuid::parse_str(body["id"].as_str().unwrap()).unwrap();

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/appointments/{root_id}/update"),
        &pm_bearer,
        Some(json!({
            "provider_id": provider_id,
            "doctor_id": doctor_id,
            "owner_user_id": pm_id,
            "interpreter_id": Value::Null,
            "title": title,
            "date": "2026-05-04",
            "time_start": "09:30",
            "time_end": "10:30",
            "recurrence_scope": "single"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (status, detail) = json_request(
        &app,
        "GET",
        &format!("/api/v1/appointments/{root_id}"),
        &pm_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(detail["category"], "initial_category");
    assert_eq!(detail["notes"], "Initial note");
    assert_eq!(detail["location"], "Initial room");
    assert_eq!(detail["time_start"], "09:30");
    assert_eq!(detail["time_end"], "10:30");

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/appointments/{root_id}/update"),
        &pm_bearer,
        Some(json!({
            "provider_id": provider_id,
            "doctor_id": doctor_id,
            "owner_user_id": pm_id,
            "interpreter_id": Value::Null,
            "title": title,
            "date": "2026-05-04",
            "time_start": "09:30",
            "time_end": "10:30",
            "location": "Series room",
            "category": "updated_category",
            "notes": "Updated note",
            "recurrence_frequency": "weekly",
            "recurrence_interval": 2,
            "recurrence_count": 4,
            "recurrence_until": Value::Null,
            "recurrence_scope": "series"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["recurrence_scope"], "series");
    assert_eq!(body["affected_count"], 4);
    assert_eq!(body["created_occurrence_count"], 1);

    let (status, detail) = json_request(
        &app,
        "GET",
        &format!("/api/v1/appointments/{root_id}"),
        &pm_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(detail["category"], "updated_category");
    assert_eq!(detail["notes"], "Updated note");
    assert_eq!(detail["location"], "Series room");
    assert_eq!(detail["recurrence_frequency"], "weekly");
    assert_eq!(detail["recurrence_interval"], 2);
    assert_eq!(detail["recurrence_count"], 4);
    assert_eq!(detail["recurrence_until"], "2026-06-15");
    assert_eq!(detail["recurrence_series_size"], 4);

    let rows = sqlx::query(
        r#"SELECT date, category, notes, location, recurrence_interval, recurrence_count
           FROM appointments
           WHERE recurrence_series_id = $1
           ORDER BY recurrence_index"#,
    )
    .bind(root_id)
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(rows.len(), 4);
    let expected_dates = ["2026-05-04", "2026-05-18", "2026-06-01", "2026-06-15"];
    for (index, row) in rows.iter().enumerate() {
        assert_eq!(
            row.try_get::<chrono::NaiveDate, _>("date")
                .unwrap()
                .to_string(),
            expected_dates[index],
        );
        assert_eq!(
            row.try_get::<Option<String>, _>("category")
                .unwrap()
                .as_deref(),
            Some("updated_category"),
        );
        assert_eq!(
            row.try_get::<Option<String>, _>("notes")
                .unwrap()
                .as_deref(),
            Some("Updated note"),
        );
        assert_eq!(
            row.try_get::<Option<String>, _>("location")
                .unwrap()
                .as_deref(),
            Some("Series room"),
        );
        assert_eq!(
            row.try_get::<Option<i32>, _>("recurrence_interval")
                .unwrap(),
            Some(2)
        );
        assert_eq!(
            row.try_get::<Option<i32>, _>("recurrence_count").unwrap(),
            Some(4)
        );
    }
}

#[tokio::test]
async fn patient_manager_can_cancel_whole_recurring_appointment_series() {
    let Some((app, pool, admin_id, _)) = test_context().await else {
        return;
    };

    let tag = unique_tag("recurring-appointment-cancel");
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
    let root_id = Uuid::parse_str(body["id"].as_str().unwrap()).unwrap();

    let rows = sqlx::query(
        r#"SELECT id, recurrence_index
           FROM appointments
           WHERE recurrence_series_id = $1
           ORDER BY recurrence_index"#,
    )
    .bind(root_id)
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(rows.len(), 4);
    let last_occurrence_id: Uuid = rows[3].try_get("id").unwrap();

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/appointments/{last_occurrence_id}/status"),
        &pm_bearer,
        Some(json!({ "status": "completed" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["recurrence_scope"], "single");

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/appointments/{root_id}/status"),
        &pm_bearer,
        Some(json!({
            "status": "cancelled",
            "recurrence_scope": "series"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["recurrence_scope"], "series");
    assert_eq!(body["affected_count"], 3);

    let status_rows = sqlx::query(
        r#"SELECT recurrence_index, status
           FROM appointments
           WHERE recurrence_series_id = $1
           ORDER BY recurrence_index"#,
    )
    .bind(root_id)
    .fetch_all(&pool)
    .await
    .unwrap();

    assert_eq!(status_rows.len(), 4);
    for row in status_rows.iter().take(3) {
        assert_eq!(row.try_get::<String, _>("status").unwrap(), "cancelled");
    }
    assert_eq!(
        status_rows[3].try_get::<String, _>("status").unwrap(),
        "completed"
    );
}

#[tokio::test]
async fn patient_manager_can_confirm_whole_recurring_appointment_series() {
    let Some((app, pool, admin_id, _)) = test_context().await else {
        return;
    };

    let tag = unique_tag("recurring-appointment-confirm");
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
            "recurrence_count": 3
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let root_id = Uuid::parse_str(body["id"].as_str().unwrap()).unwrap();

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/appointments/{root_id}/status"),
        &pm_bearer,
        Some(json!({
            "status": "confirmed",
            "recurrence_scope": "series"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["recurrence_scope"], "series");
    assert_eq!(body["status"], "confirmed");
    assert_eq!(body["affected_count"], 3);

    let status_rows = sqlx::query(
        r#"SELECT status
           FROM appointments
           WHERE recurrence_series_id = $1
           ORDER BY recurrence_index"#,
    )
    .bind(root_id)
    .fetch_all(&pool)
    .await
    .unwrap();

    assert_eq!(status_rows.len(), 3);
    assert!(
        status_rows
            .iter()
            .all(|row| row.try_get::<String, _>("status").unwrap() == "confirmed")
    );
}

#[tokio::test]
async fn patient_manager_can_reschedule_this_and_following_occurrences() {
    let Some((app, pool, admin_id, _)) = test_context().await else {
        return;
    };

    let tag = unique_tag("recurring-appointment-following-update");
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
    let root_id = Uuid::parse_str(body["id"].as_str().unwrap()).unwrap();

    let rows = sqlx::query(
        r#"SELECT id, recurrence_index
           FROM appointments
           WHERE recurrence_series_id = $1
           ORDER BY recurrence_index"#,
    )
    .bind(root_id)
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(rows.len(), 4);
    let second_occurrence_id: Uuid = rows[1].try_get("id").unwrap();

    let updated_title = format!("Adjusted from midpoint {tag}");
    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/appointments/{second_occurrence_id}/update"),
        &pm_bearer,
        Some(json!({
            "provider_id": provider_id,
            "doctor_id": doctor_id,
            "owner_user_id": pm_id,
            "interpreter_id": Value::Null,
            "title": updated_title,
            "date": "2026-05-13",
            "time_start": "14:00",
            "time_end": "15:00",
            "location": "Recovery room 5",
            "recurrence_scope": "following"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["recurrence_scope"], "following");
    assert_eq!(body["affected_count"], 3);
    assert_eq!(body["split_performed"], true);

    let original_rows = sqlx::query(
        r#"SELECT recurrence_index, recurrence_count, recurrence_until, title, date
           FROM appointments
           WHERE recurrence_series_id = $1
           ORDER BY recurrence_index"#,
    )
    .bind(root_id)
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(original_rows.len(), 1);
    assert_eq!(
        original_rows[0]
            .try_get::<i32, _>("recurrence_index")
            .unwrap(),
        0
    );
    assert_eq!(
        original_rows[0]
            .try_get::<Option<i32>, _>("recurrence_count")
            .unwrap(),
        Some(1)
    );
    assert_eq!(
        original_rows[0]
            .try_get::<Option<chrono::NaiveDate>, _>("recurrence_until")
            .unwrap()
            .unwrap()
            .to_string(),
        "2026-05-04"
    );

    let updated_rows = sqlx::query(
        r#"SELECT recurrence_index, recurrence_count, recurrence_until, title, date, time_start, time_end, location
           FROM appointments
           WHERE recurrence_series_id = $1
           ORDER BY recurrence_index"#,
    )
    .bind(second_occurrence_id)
    .fetch_all(&pool)
    .await
    .unwrap();

    assert_eq!(updated_rows.len(), 3);
    let expected_dates = ["2026-05-13", "2026-05-20", "2026-05-27"];
    for (offset, row) in updated_rows.iter().enumerate() {
        assert_eq!(row.try_get::<String, _>("title").unwrap(), updated_title);
        assert_eq!(
            row.try_get::<i32, _>("recurrence_index").unwrap(),
            offset as i32
        );
        assert_eq!(
            row.try_get::<Option<i32>, _>("recurrence_count").unwrap(),
            Some(3)
        );
        assert_eq!(
            row.try_get::<Option<chrono::NaiveDate>, _>("recurrence_until")
                .unwrap()
                .unwrap()
                .to_string(),
            "2026-05-27"
        );
        assert_eq!(
            row.try_get::<chrono::NaiveDate, _>("date")
                .unwrap()
                .to_string(),
            expected_dates[offset]
        );
        assert_eq!(
            row.try_get::<Option<chrono::NaiveTime>, _>("time_start")
                .unwrap()
                .unwrap()
                .to_string(),
            "14:00:00"
        );
        assert_eq!(
            row.try_get::<Option<chrono::NaiveTime>, _>("time_end")
                .unwrap()
                .unwrap()
                .to_string(),
            "15:00:00"
        );
        assert_eq!(
            row.try_get::<Option<String>, _>("location")
                .unwrap()
                .as_deref(),
            Some("Recovery room 5")
        );
    }

    let (status, detail_body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/appointments/{second_occurrence_id}"),
        &pm_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        detail_body["recurrence_parent_series_id"].as_str(),
        Some(root_id.to_string().as_str())
    );
    assert_eq!(
        detail_body["recurrence_split_from_appointment_id"].as_str(),
        Some(second_occurrence_id.to_string().as_str())
    );
    assert_eq!(detail_body["recurrence_split_from_index"], 1);
    assert_eq!(
        detail_body["recurring_scope_preview"]
            .as_array()
            .map(|items| items.len()),
        Some(3)
    );
}

#[tokio::test]
async fn patient_manager_can_edit_whole_series_recurrence_rule() {
    let Some((app, pool, admin_id, _)) = test_context().await else {
        return;
    };

    let tag = unique_tag("recurring-appointment-series-rule");
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
    let root_id = Uuid::parse_str(body["id"].as_str().unwrap()).unwrap();

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/appointments/{root_id}/update"),
        &pm_bearer,
        Some(json!({
            "provider_id": provider_id,
            "doctor_id": doctor_id,
            "owner_user_id": pm_id,
            "interpreter_id": Value::Null,
            "title": format!("Reshaped recurring therapy {tag}"),
            "date": "2026-05-06",
            "time_start": "11:00",
            "time_end": "12:00",
            "location": "Series room",
            "recurrence_frequency": "weekly",
            "recurrence_interval": 2,
            "recurrence_count": 5,
            "recurrence_until": Value::Null,
            "recurrence_scope": "series"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["recurrence_scope"], "series");
    assert_eq!(body["created_occurrence_count"], 1);

    let rows = sqlx::query(
        r#"SELECT date, time_start, time_end, recurrence_index, recurrence_count, recurrence_until, recurrence_interval
           FROM appointments
           WHERE recurrence_series_id = $1
             AND status = 'planned'
           ORDER BY recurrence_index"#,
    )
    .bind(root_id)
    .fetch_all(&pool)
    .await
    .unwrap();

    let expected_dates = [
        "2026-05-06",
        "2026-05-20",
        "2026-06-03",
        "2026-06-17",
        "2026-07-01",
    ];
    assert_eq!(rows.len(), expected_dates.len());
    for (index, row) in rows.iter().enumerate() {
        assert_eq!(
            row.try_get::<chrono::NaiveDate, _>("date")
                .unwrap()
                .to_string(),
            expected_dates[index]
        );
        assert_eq!(
            row.try_get::<i32, _>("recurrence_index").unwrap(),
            index as i32
        );
        assert_eq!(
            row.try_get::<Option<i32>, _>("recurrence_count").unwrap(),
            Some(5)
        );
        assert_eq!(
            row.try_get::<Option<i32>, _>("recurrence_interval")
                .unwrap(),
            Some(2)
        );
        assert_eq!(
            row.try_get::<Option<chrono::NaiveDate>, _>("recurrence_until")
                .unwrap()
                .unwrap()
                .to_string(),
            "2026-07-01"
        );
        assert_eq!(
            row.try_get::<Option<chrono::NaiveTime>, _>("time_start")
                .unwrap()
                .unwrap()
                .to_string(),
            "11:00:00"
        );
        assert_eq!(
            row.try_get::<Option<chrono::NaiveTime>, _>("time_end")
                .unwrap()
                .unwrap()
                .to_string(),
            "12:00:00"
        );
    }
}

#[tokio::test]
async fn patient_manager_can_reshape_whole_series_without_self_conflict() {
    let Some((app, pool, admin_id, _)) = test_context().await else {
        return;
    };

    let tag = unique_tag("recurring-appointment-series-self-conflict");
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
            "recurrence_until": "2026-05-18"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let root_id = Uuid::parse_str(body["id"].as_str().unwrap()).unwrap();

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/appointments/{root_id}/update"),
        &pm_bearer,
        Some(json!({
            "provider_id": provider_id,
            "doctor_id": doctor_id,
            "owner_user_id": pm_id,
            "interpreter_id": Value::Null,
            "title": format!("Reshaped recurring therapy {tag}"),
            "date": "2026-05-04",
            "time_start": "09:00",
            "time_end": "10:00",
            "location": "Clinic Berlin",
            "recurrence_frequency": "weekly",
            "recurrence_interval": 2,
            "recurrence_count": 4,
            "recurrence_until": Value::Null,
            "recurrence_scope": "series"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["recurrence_scope"], "series");
    assert_eq!(body["affected_count"], 4);
    assert_eq!(body["created_occurrence_count"], 1);

    let rows = sqlx::query(
        r#"SELECT date, recurrence_index, recurrence_count, recurrence_interval, recurrence_until, status
           FROM appointments
           WHERE recurrence_series_id = $1
           ORDER BY recurrence_index"#,
    )
    .bind(root_id)
    .fetch_all(&pool)
    .await
    .unwrap();

    let expected_dates = ["2026-05-04", "2026-05-18", "2026-06-01", "2026-06-15"];
    assert_eq!(rows.len(), expected_dates.len());
    for (index, row) in rows.iter().enumerate() {
        assert_eq!(
            row.try_get::<chrono::NaiveDate, _>("date")
                .unwrap()
                .to_string(),
            expected_dates[index]
        );
        assert_eq!(
            row.try_get::<i32, _>("recurrence_index").unwrap(),
            index as i32
        );
        assert_eq!(
            row.try_get::<Option<i32>, _>("recurrence_count").unwrap(),
            Some(4)
        );
        assert_eq!(
            row.try_get::<Option<i32>, _>("recurrence_interval")
                .unwrap(),
            Some(2)
        );
        assert_eq!(
            row.try_get::<Option<chrono::NaiveDate>, _>("recurrence_until")
                .unwrap()
                .unwrap()
                .to_string(),
            "2026-06-15"
        );
        assert_ne!(row.try_get::<String, _>("status").unwrap(), "cancelled");
    }
}

#[tokio::test]
async fn patient_manager_can_cancel_this_and_following_occurrences() {
    let Some((app, pool, admin_id, _)) = test_context().await else {
        return;
    };

    let tag = unique_tag("recurring-appointment-following-cancel");
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
    let root_id = Uuid::parse_str(body["id"].as_str().unwrap()).unwrap();

    let rows = sqlx::query(
        r#"SELECT id, recurrence_index
           FROM appointments
           WHERE recurrence_series_id = $1
           ORDER BY recurrence_index"#,
    )
    .bind(root_id)
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(rows.len(), 4);
    let third_occurrence_id: Uuid = rows[2].try_get("id").unwrap();

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/appointments/{third_occurrence_id}/status"),
        &pm_bearer,
        Some(json!({
            "status": "cancelled",
            "recurrence_scope": "following"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["recurrence_scope"], "following");
    assert_eq!(body["affected_count"], 2);
    assert_eq!(body["split_performed"], true);

    let original_rows = sqlx::query(
        r#"SELECT recurrence_index, recurrence_count, recurrence_until, status
           FROM appointments
           WHERE recurrence_series_id = $1
           ORDER BY recurrence_index"#,
    )
    .bind(root_id)
    .fetch_all(&pool)
    .await
    .unwrap();

    assert_eq!(original_rows.len(), 2);
    assert_eq!(
        original_rows[0].try_get::<String, _>("status").unwrap(),
        "planned"
    );
    assert_eq!(
        original_rows[1].try_get::<String, _>("status").unwrap(),
        "planned"
    );
    assert_eq!(
        original_rows[1]
            .try_get::<Option<i32>, _>("recurrence_count")
            .unwrap(),
        Some(2)
    );
    assert_eq!(
        original_rows[1]
            .try_get::<Option<chrono::NaiveDate>, _>("recurrence_until")
            .unwrap()
            .unwrap()
            .to_string(),
        "2026-05-11"
    );

    let split_rows = sqlx::query(
        r#"SELECT recurrence_index, recurrence_count, recurrence_until, status
           FROM appointments
           WHERE recurrence_series_id = $1
           ORDER BY recurrence_index"#,
    )
    .bind(third_occurrence_id)
    .fetch_all(&pool)
    .await
    .unwrap();

    assert_eq!(split_rows.len(), 2);
    assert_eq!(
        split_rows[0].try_get::<String, _>("status").unwrap(),
        "cancelled"
    );
    assert_eq!(
        split_rows[1].try_get::<String, _>("status").unwrap(),
        "cancelled"
    );
    assert_eq!(
        split_rows[1]
            .try_get::<Option<i32>, _>("recurrence_count")
            .unwrap(),
        Some(2)
    );
    assert_eq!(
        split_rows[1]
            .try_get::<Option<chrono::NaiveDate>, _>("recurrence_until")
            .unwrap()
            .unwrap()
            .to_string(),
        "2026-05-25"
    );
}

#[tokio::test]
async fn patient_manager_can_trim_following_series_via_recurrence_rule() {
    let Some((app, pool, admin_id, _)) = test_context().await else {
        return;
    };

    let tag = unique_tag("recurring-appointment-following-rule");
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
    let root_id = Uuid::parse_str(body["id"].as_str().unwrap()).unwrap();

    let rows = sqlx::query(
        r#"SELECT id
           FROM appointments
           WHERE recurrence_series_id = $1
           ORDER BY recurrence_index"#,
    )
    .bind(root_id)
    .fetch_all(&pool)
    .await
    .unwrap();
    let second_occurrence_id: Uuid = rows[1].try_get("id").unwrap();

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/appointments/{second_occurrence_id}/update"),
        &pm_bearer,
        Some(json!({
            "provider_id": provider_id,
            "doctor_id": doctor_id,
            "owner_user_id": pm_id,
            "interpreter_id": Value::Null,
            "title": format!("Trimmed tail {tag}"),
            "date": "2026-05-11",
            "time_start": "13:00",
            "time_end": "14:00",
            "location": "Tail room",
            "recurrence_frequency": "weekly",
            "recurrence_interval": 1,
            "recurrence_count": 2,
            "recurrence_until": Value::Null,
            "recurrence_scope": "following"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["recurrence_scope"], "following");
    assert_eq!(body["split_performed"], true);
    assert_eq!(body["created_occurrence_count"], 0);
    let archived_series_id =
        Uuid::parse_str(body["archived_tail_series_id"].as_str().unwrap()).unwrap();

    let active_tail_rows = sqlx::query(
        r#"SELECT status, recurrence_index, recurrence_count, recurrence_until
           FROM appointments
           WHERE recurrence_series_id = $1
             AND status = 'planned'
           ORDER BY recurrence_index"#,
    )
    .bind(second_occurrence_id)
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(active_tail_rows.len(), 2);
    assert_eq!(
        active_tail_rows[1]
            .try_get::<Option<i32>, _>("recurrence_count")
            .unwrap(),
        Some(2)
    );
    assert_eq!(
        active_tail_rows[1]
            .try_get::<Option<chrono::NaiveDate>, _>("recurrence_until")
            .unwrap()
            .unwrap()
            .to_string(),
        "2026-05-18"
    );

    let archived_rows = sqlx::query(
        r#"SELECT status, recurrence_index, recurrence_count, recurrence_until, recurrence_parent_series_id
           FROM appointments
           WHERE recurrence_series_id = $1
           ORDER BY recurrence_index"#,
    )
    .bind(archived_series_id)
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(archived_rows.len(), 1);
    assert_eq!(
        archived_rows[0].try_get::<String, _>("status").unwrap(),
        "cancelled"
    );
    assert_eq!(
        archived_rows[0]
            .try_get::<Option<Uuid>, _>("recurrence_parent_series_id")
            .unwrap(),
        Some(second_occurrence_id)
    );
}

#[tokio::test]
async fn recurring_appointment_detail_exposes_scope_checklist_blockers() {
    let Some((app, pool, admin_id, _)) = test_context().await else {
        return;
    };

    let tag = unique_tag("recurring-appointment-scope-preview");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let provider_id = seed_provider(&pool, &tag).await;
    let doctor_id = seed_doctor(&pool, provider_id, &tag).await;
    let pm_id = seed_user(&pool, &tag, "patient_manager").await;

    seed_patient_assignment(&pool, patient_id, pm_id, admin_id).await;

    let pm_bearer = auth_header_for(pm_id, "patient_manager");

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
            "title": format!("Recurring checklist preview {tag}"),
            "date": "2026-06-01",
            "time_start": "10:00",
            "time_end": "11:00",
            "recurrence_frequency": "weekly",
            "recurrence_interval": 1,
            "recurrence_count": 3
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let root_id = Uuid::parse_str(body["id"].as_str().unwrap()).unwrap();

    let rows = sqlx::query(
        r#"SELECT id
           FROM appointments
           WHERE recurrence_series_id = $1
           ORDER BY recurrence_index"#,
    )
    .bind(root_id)
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(rows.len(), 3);
    let blocking_occurrence_id: Uuid = rows[2].try_get("id").unwrap();

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/appointments/{blocking_occurrence_id}/checklist"),
        &pm_bearer,
        Some(json!({
            "phase": "followup",
            "item_text": "Collect final findings"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);

    let (status, detail_body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/appointments/{root_id}"),
        &pm_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let preview = detail_body["recurring_scope_preview"]
        .as_array()
        .cloned()
        .unwrap_or_default();
    assert_eq!(preview.len(), 3);
    assert!(preview.iter().any(|item| {
        item["id"] == blocking_occurrence_id.to_string()
            && item["recurrence_index"] == 2
            && item["open_checklist_count"] == 1
    }));
}

#[tokio::test]
async fn recurring_appointment_detail_exposes_lineage_history_metrics() {
    let Some((app, pool, admin_id, _)) = test_context().await else {
        return;
    };

    let tag = unique_tag("recurring-appointment-lineage-history");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let provider_id = seed_provider(&pool, &tag).await;
    let doctor_id = seed_doctor(&pool, provider_id, &tag).await;
    let pm_id = seed_user(&pool, &tag, "patient_manager").await;

    seed_patient_assignment(&pool, patient_id, pm_id, admin_id).await;

    let pm_bearer = auth_header_for(pm_id, "patient_manager");

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
            "title": format!("Recurring lineage {tag}"),
            "date": "2026-06-01",
            "time_start": "10:00",
            "time_end": "11:00",
            "recurrence_frequency": "weekly",
            "recurrence_interval": 1,
            "recurrence_count": 4
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let root_id = Uuid::parse_str(body["id"].as_str().unwrap()).unwrap();

    let rows = sqlx::query(
        r#"SELECT id
           FROM appointments
           WHERE recurrence_series_id = $1
           ORDER BY recurrence_index"#,
    )
    .bind(root_id)
    .fetch_all(&pool)
    .await
    .unwrap();
    let second_occurrence_id: Uuid = rows[1].try_get("id").unwrap();

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/appointments/{second_occurrence_id}/update"),
        &pm_bearer,
        Some(json!({
            "provider_id": provider_id,
            "doctor_id": doctor_id,
            "owner_user_id": pm_id,
            "interpreter_id": Value::Null,
            "title": format!("Recurring lineage split {tag}"),
            "date": "2026-06-10",
            "time_start": "13:00",
            "time_end": "14:00",
            "location": "Lineage room",
            "recurrence_scope": "following"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["split_performed"], true);

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/appointments/{second_occurrence_id}/update"),
        &pm_bearer,
        Some(json!({
            "provider_id": provider_id,
            "doctor_id": doctor_id,
            "owner_user_id": pm_id,
            "interpreter_id": Value::Null,
            "title": format!("Recurring lineage trimmed {tag}"),
            "date": "2026-06-10",
            "time_start": "13:00",
            "time_end": "14:00",
            "location": "Lineage room",
            "recurrence_frequency": "weekly",
            "recurrence_interval": 1,
            "recurrence_count": 2,
            "recurrence_until": Value::Null,
            "recurrence_scope": "series"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let archived_tail_series_id =
        Uuid::parse_str(body["archived_tail_series_id"].as_str().unwrap()).unwrap();

    let (status, detail_body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/appointments/{second_occurrence_id}"),
        &pm_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let lineage = detail_body["recurring_lineage_history"]
        .as_array()
        .cloned()
        .unwrap_or_default();
    assert_eq!(lineage.len(), 3);
    assert!(lineage.iter().any(|item| {
        item["series_id"] == root_id.to_string()
            && item["relation"] == "ancestor"
            && item["total_occurrences"] == 1
    }));
    assert!(lineage.iter().any(|item| {
        item["series_id"] == second_occurrence_id.to_string()
            && item["relation"] == "current"
            && item["total_occurrences"] == 2
            && item["active_occurrences"] == 2
    }));
    assert!(lineage.iter().any(|item| {
        item["series_id"] == archived_tail_series_id.to_string()
            && item["relation"] == "descendant"
            && item["cancelled_occurrences"] == 1
    }));
}

#[tokio::test]
async fn appointment_schedule_exclusion_constraints_block_overlapping_patient_slots() {
    let Some((_app, pool, admin_id, _)) = test_context().await else {
        return;
    };

    let tag = unique_tag("appointment-exclusion");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let provider_id = seed_provider(&pool, &tag).await;
    let doctor_id = seed_doctor(&pool, provider_id, &tag).await;

    seed_appointment_slot(
        &pool,
        patient_id,
        provider_id,
        doctor_id,
        admin_id,
        "Anchor slot",
        "planned",
        "2026-08-04",
        "medical",
        Some("09:00"),
        Some("10:00"),
        None,
    )
    .await;

    let result = sqlx::query(
        r#"INSERT INTO appointments (
                patient_id, provider_id, doctor_id, appointment_type, title, date,
                time_start, time_end, status, created_by
           ) VALUES (
                $1, $2, $3, 'medical', $4, $5,
                $6, $7, 'planned', $8
           )"#,
    )
    .bind(patient_id)
    .bind(provider_id)
    .bind(doctor_id)
    .bind("Overlapping slot")
    .bind(parse_date("2026-08-04"))
    .bind(chrono::NaiveTime::parse_from_str("09:30", "%H:%M").expect("valid overlap start"))
    .bind(chrono::NaiveTime::parse_from_str("10:30", "%H:%M").expect("valid overlap end"))
    .bind(admin_id)
    .execute(&pool)
    .await;

    match result {
        Err(sqlx::Error::Database(db_error)) => {
            assert_eq!(db_error.code().as_deref(), Some("23P01"));
            assert_eq!(
                db_error.constraint(),
                Some("appointments_patient_timed_schedule_excl")
            );
        }
        other => panic!("expected exclusion violation, got {other:?}"),
    }
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
    let assignment_reminders = items
        .iter()
        .filter(|item| {
            item["title"]
                .as_str()
                .unwrap_or_default()
                .contains("New assignment")
        })
        .count();
    assert_eq!(assignment_reminders, 1);
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
    .bind(parse_utc_datetime(&reminder_at))
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
           VALUES ($1, 'followup', 'Send discharge summary to patient', 1)"#,
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
    let billing_id = if let Some(existing) = sqlx::query_scalar(
        r#"SELECT id
           FROM users
           WHERE is_active = true
             AND role = 'billing'
           ORDER BY created_at
           LIMIT 1"#,
    )
    .fetch_optional(&pool)
    .await
    .unwrap()
    {
        existing
    } else {
        seed_user(&pool, &tag, "billing").await
    };

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
    sqlx::query(
        r#"UPDATE appointment_checklists
           SET is_completed = true,
               completed_by = $2,
               completed_at = now()
           WHERE appointment_id = $1"#,
    )
    .bind(appointment_id)
    .bind(pm_id)
    .execute(&pool)
    .await
    .unwrap();
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
        item["title"]
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
        "Existing later slot",
        "confirmed",
        "2026-05-14",
        "medical",
        Some("15:00"),
        Some("16:00"),
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
    assert_eq!(body["conflicts"]["has_conflicts"], false);
    assert_eq!(body["conflicts"]["patient_conflict_count"], 0);

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
    let appointment_id = Uuid::parse_str(body["id"].as_str().unwrap()).unwrap();

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

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/concierge-services/{service_id}/update"),
        &concierge_bearer,
        Some(json!({
            "booking_reference": null,
            "vendor_name": null,
            "starts_at": null,
            "ends_at": null,
            "actual_cost": null,
            "service_notes": null
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(body["booking_reference"].is_null());
    assert!(body["vendor_name"].is_null());
    assert!(body["starts_at"].is_null());
    assert!(body["ends_at"].is_null());
    assert!(body["actual_cost"].is_null());
    assert!(body["service_notes"].is_null());

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/concierge-services/{service_id}/update"),
        &concierge_bearer,
        Some(json!({
            "title": "Concierge should not rename operational service"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(
        body["message"],
        "Concierge can only update operational service fields"
    );

    sqlx::query(
        r#"UPDATE appointment_checklists
           SET is_completed = true,
               completed_by = $2,
               completed_at = now()
           WHERE appointment_id = $1"#,
    )
    .bind(appointment_id)
    .bind(pm_id)
    .execute(&pool)
    .await
    .unwrap();

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
    let other_provider_id = seed_provider(&pool, &format!("{tag}-other")).await;
    let other_doctor_id = seed_doctor(&pool, other_provider_id, &format!("{tag}-other")).await;
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
        None,
    )
    .await;

    seed_appointment_slot(
        &pool,
        other_patient_id,
        other_provider_id,
        other_doctor_id,
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
            "/api/v1/appointments/meta/conflicts?patient_id={patient_id}&interpreter_id={interpreter_id}&doctor_id={doctor_id}&date=2026-04-28&time_start=10:15&time_end=10:45"
        ),
        &bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["has_conflicts"], true);
    assert_eq!(body["patient_conflict_count"], 1);
    assert_eq!(body["interpreter_conflict_count"], 1);
    assert_eq!(body["doctor_conflict_count"], 1);
    assert_eq!(body["patient_conflicts"][0]["title"], "Patient overlap");
    assert_eq!(body["doctor_conflicts"][0]["title"], "Patient overlap");
}

#[tokio::test]
async fn create_appointment_returns_conflict_error_for_overlapping_slot() {
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
    assert_eq!(status, StatusCode::CONFLICT);
    let message = body["message"].as_str().unwrap_or_default();
    assert!(message.contains("Appointment conflict"));
    assert!(message.contains("patient/interpreter/doctor"));
    assert!(message.contains("Existing overlap"));
    assert!(message.contains("09:00-10:00"));
    assert_eq!(body["conflicts"]["has_conflicts"], true);
    assert_eq!(body["conflicts"]["patient_conflict_count"], 1);
    assert_eq!(body["conflicts"]["interpreter_conflict_count"], 1);
    assert_eq!(body["conflicts"]["doctor_conflict_count"], 1);
    assert_eq!(
        body["conflicts"]["patient_conflicts"][0]["title"],
        "Existing overlap"
    );
    assert_eq!(
        body["conflicts"]["patient_conflicts"][0]["time_start"],
        "09:00"
    );
}

#[tokio::test]
async fn providers_list_supports_country_and_doctor_filters() {
    let Some((app, pool, _admin_id, _)) = test_context().await else {
        return;
    };

    let tag = unique_tag("provider-filters");
    let sales_id = seed_user(&pool, &format!("{tag}-sales"), "sales").await;
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

    let sales_bearer = auth_header_for(sales_id, "sales");
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
async fn providers_list_supports_all_and_inactive_only_filters() {
    let Some((app, pool, _admin_id, bearer)) = test_context().await else {
        return;
    };

    let tag = unique_tag("provider-active-filter");
    let active_provider_id =
        seed_provider_with_type(&pool, &format!("{tag}-active"), "medical", "Germany").await;
    let inactive_provider_id =
        seed_provider_with_type(&pool, &format!("{tag}-inactive"), "medical", "Germany").await;
    let taxonomy_node_id =
        assign_primary_provider_taxonomy(&pool, inactive_provider_id, "medical_pharmacies").await;
    sqlx::query("UPDATE providers SET is_active = false WHERE id = $1")
        .bind(inactive_provider_id)
        .execute(&pool)
        .await
        .unwrap();

    let provider_ids = |body: &Value| -> Vec<String> {
        body.as_array()
            .expect("providers array")
            .iter()
            .filter_map(|item| item["id"].as_str().map(ToOwned::to_owned))
            .collect()
    };

    let (status, default_body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/providers?search={tag}"),
        &bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let ids = provider_ids(&default_body);
    assert!(ids.contains(&active_provider_id.to_string()));
    assert!(!ids.contains(&inactive_provider_id.to_string()));

    let (status, all_body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/providers?search={tag}&active_only=false"),
        &bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let ids = provider_ids(&all_body);
    assert!(ids.contains(&active_provider_id.to_string()));
    assert!(ids.contains(&inactive_provider_id.to_string()));

    let (status, inactive_body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/providers?search={tag}&is_active=false"),
        &bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let ids = provider_ids(&inactive_body);
    assert!(!ids.contains(&active_provider_id.to_string()));
    assert!(ids.contains(&inactive_provider_id.to_string()));

    let (status, inactive_taxonomy_body) = json_request(
        &app,
        "GET",
        &format!(
            "/api/v1/providers?search={tag}&is_active=false&taxonomy_node_id={taxonomy_node_id}"
        ),
        &bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let ids = provider_ids(&inactive_taxonomy_body);
    assert_eq!(ids, vec![inactive_provider_id.to_string()]);
}

#[tokio::test]
async fn providers_list_and_detail_include_non_medical_concierge_activity() {
    let Some((app, pool, admin_id, _)) = test_context().await else {
        return;
    };

    let tag = unique_tag("provider-concierge-activity");
    let sales_id = seed_user(&pool, &tag, "sales").await;
    let sales_bearer = auth_header_for(sales_id, "sales");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let provider_id = seed_provider_with_type(&pool, &tag, "non_medical", "Austria").await;

    let concierge_service_id = seed_provider_concierge_service(
        &pool,
        ProviderConciergeServiceSeed {
            patient_id,
            provider_id,
            created_by: admin_id,
            service_kind: "vip_terminal",
            title: "VIP terminal escort",
            vendor_name: "Elite Drives",
            status: "planned",
        },
    )
    .await;

    let (status, body) = json_request(
        &app,
        "GET",
        "/api/v1/providers?provider_type=non_medical&service_name=Elite&search=escort",
        &sales_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let items = body.as_array().unwrap();
    assert_eq!(items.len(), 1);
    assert_eq!(items[0]["id"], provider_id.to_string());
    assert_eq!(items[0]["concierge_service_count"], 1);
    assert_eq!(items[0]["open_concierge_service_count"], 1);
    assert_eq!(items[0]["service_count"], 0);
    assert_ne!(items[0]["last_interaction_at"], Value::Null);

    let (status, detail) = json_request(
        &app,
        "GET",
        &format!("/api/v1/providers/{provider_id}"),
        &sales_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(detail["linked_patients"][0]["concierge_count"], 1);
    assert!(
        detail["interactions"]
            .as_array()
            .unwrap()
            .iter()
            .any(|item| {
                item["id"] == concierge_service_id.to_string()
                    && item["kind"] == "concierge_service"
                    && item["appointment_type"] == "vip_terminal"
                    && item["location"] == "Elite Drives"
            })
    );
}

#[tokio::test]
async fn sales_can_read_provider_registry_but_cannot_update_provider() {
    let Some((app, pool, _admin_id, _)) = test_context().await else {
        return;
    };

    let tag = unique_tag("sales-provider-readonly");
    let sales_id = seed_user(&pool, &tag, "sales").await;
    let sales_bearer = auth_header_for(sales_id, "sales");
    let provider_id = seed_provider_with_type(&pool, &tag, "non_medical", "Italy").await;

    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/providers/{provider_id}"),
        &sales_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["id"], provider_id.to_string());
    assert_eq!(body["provider_type"], "non_medical");

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/providers/{provider_id}/update"),
        &sales_bearer,
        Some(json!({
            "name": "Sales must stay read only",
            "provider_type": "non_medical"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
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
    assert_eq!(interactions.len(), 2);
    for item in interactions {
        assert_eq!(item["patient_uuid"], patient_id.to_string());
        assert_eq!(item["patient_id"], format!("PT-{tag}"));
    }
    assert!(
        interactions
            .iter()
            .any(|item| item["kind"] == "appointment")
    );
    assert!(interactions.iter().any(|item| item["kind"] == "leistung"));

    let diagnosing_patient_id = seed_patient(&pool, admin_id, &format!("{tag}-diagnosing")).await;
    seed_patient_diagnosis(
        &pool,
        diagnosing_patient_id,
        provider_id,
        Some(doctor_id),
        None,
        &format!("Doctor diagnosed {tag}"),
    )
    .await;
    let treating_patient_id = seed_patient(&pool, admin_id, &format!("{tag}-treating")).await;
    seed_patient_diagnosis(
        &pool,
        treating_patient_id,
        provider_id,
        None,
        Some(doctor_id),
        &format!("Doctor treating {tag}"),
    )
    .await;

    let (status, doctor_body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/providers/{provider_id}/doctors/{doctor_id}"),
        &bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(doctor_body["patient_count"], 3);
    assert_eq!(doctor_body["appointment_count"], 1);
    assert_eq!(doctor_body["license_number"], format!("LIC-{tag}"));
    assert_eq!(doctor_body["licensing_country"], "DE");
    assert_eq!(doctor_body["licensing_valid_until"], "2027-12-31");
    assert_eq!(doctor_body["languages"][0], "de");
    assert_eq!(doctor_body["languages"][1], "en");
    let doctor_interactions = doctor_body["interactions"].as_array().unwrap();
    assert_eq!(doctor_interactions.len(), 2);
    for item in doctor_interactions {
        assert_eq!(item["patient_uuid"], patient_id.to_string());
        assert_eq!(item["patient_id"], format!("PT-{tag}"));
    }
    assert_eq!(doctor_body["linked_patients"].as_array().unwrap().len(), 3);
    let doctor_patient_ids = doctor_body["linked_patients"]
        .as_array()
        .unwrap()
        .iter()
        .map(|patient| patient["id"].as_str().unwrap().to_owned())
        .collect::<Vec<_>>();
    assert!(doctor_patient_ids.contains(&patient_id.to_string()));
    assert!(doctor_patient_ids.contains(&diagnosing_patient_id.to_string()));
    assert!(doctor_patient_ids.contains(&treating_patient_id.to_string()));
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
async fn assigned_teamlead_can_update_interpreter_response() {
    let Some((app, pool, admin_id, bearer)) = test_context().await else {
        return;
    };

    let tag = unique_tag("teamlead-interpreter-response");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let provider_id = seed_provider(&pool, &tag).await;
    let doctor_id = seed_doctor(&pool, provider_id, &tag).await;
    let teamlead_id = seed_user(&pool, &tag, "teamlead_interpreter").await;

    seed_patient_assignment(&pool, patient_id, teamlead_id, admin_id).await;

    let appointment_id = seed_appointment_slot(
        &pool,
        patient_id,
        provider_id,
        doctor_id,
        admin_id,
        &format!("Appointment {tag}"),
        "planned",
        "2026-04-22",
        "medical",
        Some("10:00"),
        Some("11:00"),
        Some(teamlead_id),
    )
    .await;

    let teamlead_bearer = auth_header_for(teamlead_id, "teamlead_interpreter");

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/appointments/{appointment_id}/interpreter-response"),
        &teamlead_bearer,
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
        "closure",
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
    .bind(parse_utc_datetime("2030-01-12T09:00:00Z"))
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
    .bind(parse_utc_datetime("2030-01-13T09:00:00Z"))
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
    .bind(parse_utc_datetime("2030-01-14T10:00:00Z"))
    .bind(parse_date("2030-01-31"))
    .bind(100.0_f64)
    .bind(19.0_f64)
    .bind(119.0_f64)
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
    .bind(parse_utc_datetime("2030-01-15T10:00:00Z"))
    .bind(parse_date("2030-01-31"))
    .bind(100.0_f64)
    .bind(19.0_f64)
    .bind(119.0_f64)
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
async fn patient_relation_accepts_friend_type() {
    let Some((app, pool, admin_id, bearer)) = test_context().await else {
        return;
    };

    // "friend" is offered by the relationship editor and allowed by the backend
    // validator; the DB CHECK constraint must accept it too (regression: it used to
    // violate the constraint and fail with a generic "creation error").
    let tag = unique_tag("patient-relation-friend");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;

    let (status, created_body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/patients/{patient_id}/relations"),
        &bearer,
        Some(json!({
            "related_name": "Best friend",
            "relation_type": "friend",
            "is_emergency_contact": false
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{created_body}");
    assert_eq!(created_body["relation_type"], "friend");
}

#[tokio::test]
async fn patient_relation_accepts_standalone_emergency_contact() {
    let Some((app, pool, admin_id, bearer)) = test_context().await else {
        return;
    };

    let tag = unique_tag("patient-relation-emergency");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;

    let (status, created_body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/patients/{patient_id}/relations"),
        &bearer,
        Some(json!({
            "related_name": "Emergency Contact",
            "relation_type": "caregiver",
            "is_emergency_contact": true,
            "phone": "+49 30 111222",
            "notes": "Standalone non-patient contact"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{created_body}");
    assert_eq!(created_body["related_patient_id"], Value::Null);
    assert_eq!(created_body["related_name"], "Emergency Contact");
    assert_eq!(created_body["relation_type"], "caregiver");
    assert_eq!(created_body["is_emergency_contact"], true);
    assert_eq!(created_body["phone"], "+49 30 111222");
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

    support::wait_until("patient dsgvo export audit row", || async {
        let count: i64 = sqlx::query_scalar(
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
        count >= 1
    })
    .await;
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

    support::wait_until("patient dsgvo export audit row for timeline", || async {
        let count: i64 = sqlx::query_scalar(
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
        count >= 1
    })
    .await;

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
    .bind(parse_utc_datetime("2030-01-05T08:00:00Z"))
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
    .bind(parse_utc_datetime("2030-01-06T08:00:00Z"))
    .bind(parse_date("2030-01-20"))
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

#[tokio::test]
async fn patient_service_report_aggregates_order_leistungen_and_respects_rbac() {
    let Some((app, pool, admin_id, _)) = test_context().await else {
        return;
    };

    let tag = unique_tag("patient-service-report");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let provider_id = seed_provider(&pool, &tag).await;
    let doctor_id = seed_doctor(&pool, provider_id, &tag).await;
    let order_id = seed_order(
        &pool,
        patient_id,
        admin_id,
        &format!("ORD-SVC-{tag}"),
        "execution",
        "active",
        "Service report order",
    )
    .await;

    let pm_id = seed_user(&pool, &tag, "patient_manager").await;
    seed_patient_assignment(&pool, patient_id, pm_id, admin_id).await;
    let pm_bearer = auth_header_for(pm_id, "patient_manager");

    let billing_id = seed_user(&pool, &tag, "billing").await;
    let billing_bearer = auth_header_for(billing_id, "billing");

    let interpreter_id = seed_user(&pool, &tag, "interpreter").await;
    let interpreter_bearer = auth_header_for(interpreter_id, "interpreter");

    let approved_service_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO order_leistungen (
                order_id, description, quantity, unit_price, currency, vat_rate,
                is_cost_passthrough, provider_id, doctor_id, status, notes,
                delivered_at, approved_by, approved_at
           ) VALUES (
                $1, $2, $3, $4, 'EUR', $5,
                $6, $7, $8, 'approved', $9,
                $10, $11, $12
           ) RETURNING id"#,
    )
    .bind(order_id)
    .bind("Interpreter escort")
    .bind(2.0_f64)
    .bind(50.0_f64)
    .bind(20.0_f64)
    .bind(true)
    .bind(provider_id)
    .bind(doctor_id)
    .bind("Requires reimbursement")
    .bind(parse_utc_datetime("2030-02-03T10:00:00Z"))
    .bind(admin_id)
    .bind(parse_utc_datetime("2030-02-04T10:00:00Z"))
    .fetch_one(&pool)
    .await
    .unwrap();

    let delivered_service_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO order_leistungen (
                order_id, description, quantity, unit_price, currency, vat_rate,
                is_cost_passthrough, provider_id, doctor_id, status, notes, delivered_at
           ) VALUES (
                $1, $2, $3, $4, 'EUR', $5,
                $6, $7, $8, 'delivered', $9, $10
           ) RETURNING id"#,
    )
    .bind(order_id)
    .bind("Transport support")
    .bind(1.0_f64)
    .bind(80.0_f64)
    .bind(25.0_f64)
    .bind(false)
    .bind(provider_id)
    .bind(doctor_id)
    .bind(Option::<String>::None)
    .bind(parse_utc_datetime("2030-02-05T09:30:00Z"))
    .fetch_one(&pool)
    .await
    .unwrap();

    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/patients/{patient_id}/service-report"),
        &pm_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["patient_id"], patient_id.to_string());
    assert_eq!(body["summary"]["service_count"], 2);
    assert_eq!(body["summary"]["delivered_count"], 2);
    assert_eq!(body["summary"]["approved_count"], 1);
    assert_eq!(body["summary"]["total_gross"], "220");
    assert_eq!(
        body["summary"]["first_service_at"],
        "2030-02-04T10:00:00+00:00"
    );
    assert_eq!(
        body["summary"]["last_service_at"],
        "2030-02-05T09:30:00+00:00"
    );

    let items = body["items"].as_array().expect("service-report items");
    assert_eq!(items.len(), 2);
    assert_eq!(items[0]["id"], delivered_service_id.to_string());
    assert_eq!(items[0]["description"], "Transport support");
    assert_eq!(items[0]["status"], "delivered");
    assert_eq!(items[0]["line_net"], "80");
    assert_eq!(items[0]["line_vat"], "20");
    assert_eq!(items[0]["line_gross"], "100");
    assert_eq!(items[0]["order_id"], order_id.to_string());
    assert_eq!(items[0]["provider_id"], provider_id.to_string());
    assert_eq!(items[0]["doctor_id"], doctor_id.to_string());
    assert_eq!(items[0]["provider_name"], format!("Clinic {tag}"));
    assert_eq!(items[0]["doctor_name"], format!("Doctor {tag}"));
    assert_eq!(items[0]["is_cost_passthrough"], false);
    assert!(items[0]["approved_at"].is_null());

    assert_eq!(items[1]["id"], approved_service_id.to_string());
    assert_eq!(items[1]["description"], "Interpreter escort");
    assert_eq!(items[1]["status"], "approved");
    assert_eq!(items[1]["quantity"], "2");
    assert_eq!(items[1]["unit_price"], "50");
    assert_eq!(items[1]["line_net"], "100");
    assert_eq!(items[1]["line_vat"], "20");
    assert_eq!(items[1]["line_gross"], "120");
    assert_eq!(items[1]["currency"], "EUR");
    assert_eq!(items[1]["order_number"], format!("ORD-SVC-{tag}"));
    assert_eq!(items[1]["is_cost_passthrough"], true);
    assert_eq!(items[1]["notes"], "Requires reimbursement");
    assert_eq!(items[1]["approved_at"], "2030-02-04T10:00:00+00:00");

    let (status, billing_body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/patients/{patient_id}/service-report"),
        &billing_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(billing_body["summary"]["service_count"], 2);

    let (status, forbidden_body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/patients/{patient_id}/service-report"),
        &interpreter_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(forbidden_body["message"], "Insufficient permissions");
}

// --- EPIC 2: Partnerkliniken / Service Providers --------------------------------------------
// The block below cements Excel rows 8, 9, 14, 17 and the PM/Concierge non-medical handoff:
// create+round-trip via API (instead of the SQL-only seed helpers above), validation negatives,
// role enforcement on POST, kooperationsvertrag JSONB visibility for Billing, and the
// provider-level filters that the existing `providers_list_supports_country_and_doctor_filters`
// suite did not exercise (fachbereich, city, has_contract).

#[tokio::test]
async fn pm_can_create_provider_doctor_and_service_via_api_and_round_trip() {
    let Some((app, pool, admin_id, _)) = test_context().await else {
        return;
    };

    let tag = unique_tag("provider-create-roundtrip");
    let pm_id = seed_user(&pool, &tag, "patient_manager").await;
    let pm_bearer = auth_header_for(pm_id, "patient_manager");

    let kooperationsvertrag = json!({
        "valid_from": "2026-01-01",
        "valid_until": "2027-12-31",
        "discount_pct": 12.5,
        "payment_terms_days": 30,
        "billing_contact": "billing@clinic-roundtrip.example",
    });

    let (status, create_body) = json_request(
        &app,
        "POST",
        "/api/v1/providers",
        &pm_bearer,
        Some(json!({
            "name": format!("Clinic API {tag}"),
            "provider_type": "medical",
            "legal_name": format!("Clinic API {tag} GmbH"),
            "tax_id": format!("DE-TAX-{tag}"),
            "address_street": "Hauptstr. 1",
            "address_city": "Berlin",
            "address_zip": "10115",
            "address_country": "Germany",
            "phone": "+49 30 1112233",
            "email": format!("info-{tag}@clinic-api.example"),
            "contacts": [
                {
                    "contact_kind": "phone",
                    "contact_type": "work",
                    "label": "Reception",
                    "department": "front desk",
                    "value": "+49 30 1112233",
                    "is_primary": true
                },
                {
                    "contact_kind": "email",
                    "contact_type": "department",
                    "label": "Coordination",
                    "department": "international office",
                    "value": format!("info-{tag}@clinic-api.example"),
                    "is_primary": true
                }
            ],
            "website": "https://clinic-api.example",
            "opening_hours": "Mo-Fr 08:00-17:00",
            "fachbereich": "Cardiology",
            "specializations": ["Cardiology", "Neurology"],
            "organization_level": "organization",
            "kooperationsvertrag": kooperationsvertrag.clone(),
            "notes": "Created via PM happy-path round-trip test",
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let provider_id = Uuid::parse_str(create_body["id"].as_str().unwrap()).unwrap();

    let (status, specialization_list) = json_request(
        &app,
        "GET",
        "/api/v1/providers/specializations?include_inactive=true",
        &pm_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(
        specialization_list
            .as_array()
            .expect("specialization list")
            .iter()
            .any(|row| row["code"] == "cardiology")
    );

    let managed_specialization_code = format!("managed_specialization_{}", tag.replace('-', "_"));
    let (status, specialization_body) = json_request(
        &app,
        "POST",
        "/api/v1/providers/specializations",
        &pm_bearer,
        Some(json!({
            "code": managed_specialization_code,
            "name_en": format!("Managed specialization {tag}"),
            "name_de": format!("Verwaltete Spezialisierung {tag}"),
            "name_ru": format!("Managed specialization RU {tag}"),
            "sort_order": 18,
            "is_active": true,
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let managed_specialization_id =
        Uuid::parse_str(specialization_body["id"].as_str().unwrap()).unwrap();

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/providers/specializations/{managed_specialization_id}/update"),
        &pm_bearer,
        Some(json!({
            "name_en": format!("Managed specialization updated {tag}"),
            "name_de": format!("Verwaltete Spezialisierung aktualisiert {tag}"),
            "name_ru": format!("Managed specialization RU updated {tag}"),
            "sort_order": 19,
            "is_active": true,
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/providers/specializations/{managed_specialization_id}/deactivate"),
        &pm_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (status, active_specializations) = json_request(
        &app,
        "GET",
        "/api/v1/providers/specializations",
        &pm_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(
        !active_specializations
            .as_array()
            .expect("active specialization list")
            .iter()
            .any(|row| row["code"] == managed_specialization_code)
    );

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/providers/specializations/{managed_specialization_id}/activate"),
        &pm_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/providers/specializations/{managed_specialization_id}/delete"),
        &pm_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (status, specialization_list_after_delete) = json_request(
        &app,
        "GET",
        "/api/v1/providers/specializations?include_inactive=true",
        &pm_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(
        !specialization_list_after_delete
            .as_array()
            .expect("specialization list")
            .iter()
            .any(|row| row["code"] == managed_specialization_code)
    );

    let (status, doctor_body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/providers/{provider_id}/doctors"),
        &pm_bearer,
        Some(json!({
            "name": format!("Dr Roundtrip {tag}"),
            "first_name": "Roundtrip",
            "last_name": format!("{tag}"),
            "title": "Prof.",
            "role_code": "chefarzt",
            "gender": "female",
            "opening_hours": "Mon-Fri 09:00-16:00",
            "fachbereich": "Cardiology",
            "specializations": ["Cardiology", "Internal medicine"],
            "languages": ["de", "en", "uk"],
            "phone": "+49 30 4445566",
            "email": format!("doctor-{tag}@clinic-api.example"),
            "contacts": [
                {
                    "contact_kind": "phone",
                    "contact_type": "work",
                    "value": "+49 30 4445566",
                    "is_primary": true
                },
                {
                    "contact_kind": "email",
                    "contact_type": "work",
                    "value": format!("doctor-{tag}@clinic-api.example"),
                    "is_primary": true
                },
                {
                    "contact_kind": "phone",
                    "contact_type": "private",
                    "value": "+49 170 000000",
                    "is_primary": false
                }
            ],
            "license_number": format!("LIC-{tag}"),
            "licensing_country": "DE",
            "licensing_valid_until": "2028-06-30",
            "notes": "Senior consultant",
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let doctor_id = Uuid::parse_str(doctor_body["id"].as_str().unwrap()).unwrap();

    let (status, target_doctor_body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/providers/{provider_id}/doctors"),
        &pm_bearer,
        Some(json!({
            "name": format!("Dr Target {tag}"),
            "first_name": "Target",
            "last_name": format!("{tag}"),
            "title": "Dr. med.",
            "gender": "male",
            "languages": ["de"],
            "contacts": [],
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let target_doctor_id = Uuid::parse_str(target_doctor_body["id"].as_str().unwrap()).unwrap();

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/providers/{provider_id}/doctors/{doctor_id}/relationships"),
        &pm_bearer,
        Some(json!({
            "target_doctor_id": target_doctor_id,
            "target_provider_id": provider_id,
            "relationship_type": "referral",
            "description": "Approach target doctor for complex cases",
            "is_active": true,
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);

    let (status, target_relationships_body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/providers/{provider_id}/doctors/{target_doctor_id}/relationships"),
        &pm_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let target_relationships = target_relationships_body
        .as_array()
        .expect("target doctor relationships array");
    assert!(
        target_relationships.iter().any(|row| {
            row["target_doctor_id"] == doctor_id.to_string()
                && row["target_provider_id"] == provider_id.to_string()
                && row["relationship_type"] == "referral"
        }),
        "doctor relationships must be reciprocal"
    );

    let long_relationship_notes = "x".repeat(2001);
    let (status, relationship_notes_error) = json_request(
        &app,
        "POST",
        &format!("/api/v1/providers/{provider_id}/doctors/{doctor_id}/relationships"),
        &pm_bearer,
        Some(json!({
            "target_doctor_id": target_doctor_id,
            "target_provider_id": provider_id,
            "relationship_type": "professional",
            "notes": long_relationship_notes,
            "is_active": true,
        })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert!(
        relationship_notes_error["message"]
            .as_str()
            .unwrap_or_default()
            .contains("notes are too long")
    );

    let (status, fixed_service_body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/providers/{provider_id}/services"),
        &pm_bearer,
        Some(json!({
            "service_name": "Fixed-price medical service",
            "description": "Allowed fixed price for medical providers",
            "price_type": "fixed",
            "price": 300.0,
            "currency": "EUR",
            "valid_from": "2026-02-01",
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let fixed_service_id = Uuid::parse_str(fixed_service_body["id"].as_str().unwrap()).unwrap();

    let (status, service_body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/providers/{provider_id}/services"),
        &pm_bearer,
        Some(json!({
            "service_name": "Echocardiography",
            "description": "Resting echo with reporting",
            "price_type": "range",
            "price_from": 300.0,
            "price_to": 420.0,
            "currency": "EUR",
            "valid_from": "2026-02-01",
            "valid_to": "2026-12-31",
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let service_id = Uuid::parse_str(service_body["id"].as_str().unwrap()).unwrap();

    let (status, role_list) = json_request(
        &app,
        "GET",
        "/api/v1/providers/staff-roles?include_inactive=true",
        &pm_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(
        role_list
            .as_array()
            .expect("staff role list")
            .iter()
            .any(|row| row["code"] == "secretary")
    );

    let managed_role_code = format!("managed_{}", tag.replace('-', "_"));
    let (status, role_body) = json_request(
        &app,
        "POST",
        "/api/v1/providers/staff-roles",
        &pm_bearer,
        Some(json!({
            "code": managed_role_code,
            "name_en": format!("Managed role {tag}"),
            "name_de": format!("Verwaltete Rolle {tag}"),
            "name_ru": format!("Managed role RU {tag}"),
            "sort_order": 15,
            "is_active": true,
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let managed_role_id = Uuid::parse_str(role_body["id"].as_str().unwrap()).unwrap();

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/providers/staff-roles/{managed_role_id}/update"),
        &pm_bearer,
        Some(json!({
            "name_en": format!("Managed role updated {tag}"),
            "name_de": format!("Verwaltete Rolle aktualisiert {tag}"),
            "name_ru": format!("Managed role RU updated {tag}"),
            "sort_order": 16,
            "is_active": true,
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/providers/staff-roles/{managed_role_id}/deactivate"),
        &pm_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (status, active_roles) = json_request(
        &app,
        "GET",
        "/api/v1/providers/staff-roles",
        &pm_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(
        !active_roles
            .as_array()
            .expect("active staff role list")
            .iter()
            .any(|row| row["code"] == managed_role_code)
    );

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/providers/staff-roles/{managed_role_id}/activate"),
        &pm_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (status, staff_body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/providers/{provider_id}/staff"),
        &pm_bearer,
        Some(json!({
            "first_name": "Marta",
            "last_name": format!("Secretary {tag}"),
            "display_name": format!("Marta Secretary {tag}"),
            "role": managed_role_code,
            "department": "front desk",
            "gender": "female",
            "opening_hours": "Mon-Fri 08:00-18:00",
            "status": "active",
            "contacts": [
                {
                    "contact_kind": "phone",
                    "contact_type": "work",
                    "value": "+49 30 7778899",
                    "is_primary": true
                },
                {
                    "contact_kind": "email",
                    "contact_type": "work",
                    "value": format!("secretary-{tag}@clinic-api.example"),
                    "is_primary": true
                }
            ],
            "notes": "Clinic coordinator",
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let staff_id = Uuid::parse_str(staff_body["id"].as_str().unwrap()).unwrap();

    // Round-trip the entire payload through GET /providers/{id}.
    let (status, detail) = json_request(
        &app,
        "GET",
        &format!("/api/v1/providers/{provider_id}"),
        &pm_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(detail["id"], provider_id.to_string());
    assert_eq!(detail["name"], format!("Clinic API {tag}"));
    assert_eq!(detail["provider_type"], "medical");
    assert_eq!(detail["legal_name"], format!("Clinic API {tag} GmbH"));
    assert_eq!(detail["tax_id"], format!("DE-TAX-{tag}"));
    assert_eq!(detail["address_street"], "Hauptstr. 1");
    assert_eq!(detail["address_city"], "Berlin");
    assert_eq!(detail["address_zip"], "10115");
    assert_eq!(detail["address_country"], "Germany");
    assert_eq!(detail["phone"], "+49 30 1112233");
    assert_eq!(detail["email"], format!("info-{tag}@clinic-api.example"));
    let provider_contacts = detail["contacts"]
        .as_array()
        .expect("provider contacts array");
    assert!(provider_contacts.iter().any(|row| {
        row["contact_kind"] == "phone"
            && row["label"] == "Reception"
            && row["department"] == "front desk"
    }));
    assert!(provider_contacts.iter().any(|row| {
        row["contact_kind"] == "email"
            && row["contact_type"] == "department"
            && row["value"] == format!("info-{tag}@clinic-api.example")
    }));
    assert_eq!(detail["website"], "https://clinic-api.example");
    assert_eq!(detail["opening_hours"], "Mo-Fr 08:00-17:00");
    assert_eq!(detail["fachbereich"], "Cardiology");
    assert_eq!(detail["organization_level"], "organization");
    assert_eq!(detail["notes"], "Created via PM happy-path round-trip test");
    assert_eq!(detail["kooperationsvertrag"], kooperationsvertrag);
    let provider_specializations = detail["specializations"]
        .as_array()
        .expect("provider specializations array");
    assert!(
        provider_specializations
            .iter()
            .any(|row| row["name_en"] == "Cardiology")
    );
    assert!(
        provider_specializations
            .iter()
            .any(|row| row["name_en"] == "Neurology")
    );

    let doctors = detail["doctors"].as_array().expect("doctors array");
    let doctor_row = doctors
        .iter()
        .find(|row| row["id"] == doctor_id.to_string())
        .expect("created doctor visible in provider detail");
    assert_eq!(doctor_row["name"], format!("Dr Roundtrip {tag}"));
    assert_eq!(doctor_row["first_name"], "Roundtrip");
    assert_eq!(doctor_row["last_name"], tag);
    assert_eq!(doctor_row["title"], "Prof.");
    assert_eq!(doctor_row["role_code"], "chefarzt");
    assert_eq!(doctor_row["gender"], "female");
    assert_eq!(doctor_row["opening_hours"], "Mon-Fri 09:00-16:00");
    assert_eq!(doctor_row["fachbereich"], "Cardiology");
    let doctor_specializations = doctor_row["specializations"]
        .as_array()
        .expect("doctor specializations array");
    assert!(
        doctor_specializations
            .iter()
            .any(|row| row["name_en"] == "Internal medicine")
    );
    let doctor_contacts = doctor_row["contacts"]
        .as_array()
        .expect("doctor contacts array");
    assert!(
        doctor_contacts
            .iter()
            .any(|row| row["contact_kind"] == "phone" && row["contact_type"] == "private")
    );
    assert_eq!(doctor_row["license_number"], format!("LIC-{tag}"));
    assert_eq!(doctor_row["licensing_country"], "DE");
    assert_eq!(doctor_row["licensing_valid_until"], "2028-06-30");
    let relationships = doctor_row["relationships"]
        .as_array()
        .expect("doctor relationships array");
    assert!(relationships.iter().any(|row| {
        row["target_doctor_id"] == target_doctor_id.to_string()
            && row["target_provider_id"] == provider_id.to_string()
            && row["relationship_type"] == "referral"
    }));
    let langs = doctor_row["languages"].as_array().expect("languages array");
    assert!(langs.iter().any(|l| l == "de"));
    assert!(langs.iter().any(|l| l == "en"));
    assert!(langs.iter().any(|l| l == "uk"));

    let services = detail["services"].as_array().expect("services array");
    let fixed_service_row = services
        .iter()
        .find(|row| row["id"] == fixed_service_id.to_string())
        .expect("created fixed-price service visible in provider detail");
    assert_eq!(
        fixed_service_row["service_name"],
        "Fixed-price medical service"
    );
    assert_eq!(fixed_service_row["price_type"], "fixed");
    assert!(fixed_service_row["price"].to_string().contains("300"));

    let service_row = services
        .iter()
        .find(|row| row["id"] == service_id.to_string())
        .expect("created service visible in provider detail");
    assert_eq!(service_row["service_name"], "Echocardiography");
    assert_eq!(service_row["description"], "Resting echo with reporting");
    assert_eq!(service_row["price_type"], "range");
    assert!(service_row["price_from"].to_string().contains("300"));
    assert!(service_row["price_to"].to_string().contains("420"));
    assert_eq!(service_row["currency"], "EUR");
    assert_eq!(service_row["valid_from"], "2026-02-01");
    assert_eq!(service_row["valid_to"], "2026-12-31");

    let staff = detail["staff"].as_array().expect("staff array");
    let staff_row = staff
        .iter()
        .find(|row| row["id"] == staff_id.to_string())
        .expect("created staff visible in provider detail");
    assert_eq!(staff_row["display_name"], format!("Marta Secretary {tag}"));
    assert_eq!(staff_row["role"], managed_role_code);
    assert_eq!(staff_row["department"], "front desk");
    assert_eq!(staff_row["gender"], "female");
    assert_eq!(staff_row["opening_hours"], "Mon-Fri 08:00-18:00");
    let staff_contacts = staff_row["contacts"]
        .as_array()
        .expect("staff contacts array");
    assert!(
        staff_contacts
            .iter()
            .any(|row| row["contact_kind"] == "email" && row["contact_type"] == "work")
    );

    // Suppress the pool-only `admin_id` unused-warning if tests later evolve.
    let _ = admin_id;
}

#[tokio::test]
async fn create_provider_rejects_invalid_name_and_provider_type() {
    let Some((app, pool, _admin_id, bearer)) = test_context().await else {
        return;
    };
    let tag = unique_tag("provider-create-validation");
    let _ = (&pool, tag.as_str());

    // Missing/empty name.
    let (status, body) = json_request(
        &app,
        "POST",
        "/api/v1/providers",
        &bearer,
        Some(json!({
            "name": "   ",
            "provider_type": "medical",
        })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert!(
        body["message"]
            .as_str()
            .unwrap_or_default()
            .contains("name")
    );

    // Invalid provider_type enum.
    let (status, body) = json_request(
        &app,
        "POST",
        "/api/v1/providers",
        &bearer,
        Some(json!({
            "name": "Clinic Invalid Type",
            "provider_type": "hospital",
        })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert!(
        body["message"]
            .as_str()
            .unwrap_or_default()
            .contains("medical")
    );
}

#[tokio::test]
async fn non_medical_provider_rejects_provider_specializations() {
    let Some((app, _pool, _admin_id, bearer)) = test_context().await else {
        return;
    };

    let tag = unique_tag("provider-nonmedical-specs");
    let (status, body) = json_request(
        &app,
        "POST",
        "/api/v1/providers",
        &bearer,
        Some(json!({
            "name": format!("Travel Direct Specs {tag}"),
            "provider_type": "non_medical",
            "specializations": ["Cardiology"],
        })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert!(
        body["message"]
            .as_str()
            .unwrap_or_default()
            .to_lowercase()
            .contains("specializations")
    );

    let (status, create_body) = json_request(
        &app,
        "POST",
        "/api/v1/providers",
        &bearer,
        Some(json!({
            "name": format!("Travel Clean {tag}"),
            "provider_type": "non_medical",
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let non_medical_id = Uuid::parse_str(create_body["id"].as_str().unwrap()).unwrap();

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/providers/{non_medical_id}/doctors"),
        &bearer,
        Some(json!({
            "first_name": "Travel",
            "last_name": "Contact",
            "title": "PD",
            "specializations": ["Cardiology"],
        })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert!(
        body["message"]
            .as_str()
            .unwrap_or_default()
            .to_lowercase()
            .contains("specializations")
    );

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/providers/{non_medical_id}/update"),
        &bearer,
        Some(json!({
            "name": format!("Travel Clean Updated {tag}"),
            "provider_type": "non_medical",
            "specializations": ["Neurology"],
        })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert!(
        body["message"]
            .as_str()
            .unwrap_or_default()
            .to_lowercase()
            .contains("specializations")
    );

    let (status, medical_body) = json_request(
        &app,
        "POST",
        "/api/v1/providers",
        &bearer,
        Some(json!({
            "name": format!("Clinic Convert {tag}"),
            "provider_type": "medical",
            "specializations": ["Cardiology"],
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let medical_id = Uuid::parse_str(medical_body["id"].as_str().unwrap()).unwrap();

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/providers/{medical_id}/doctors"),
        &bearer,
        Some(json!({
            "first_name": "Invalid",
            "last_name": "Title",
            "title": "Frau Dr. med.",
            "gender": "female",
        })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert!(
        body["message"]
            .as_str()
            .unwrap_or_default()
            .to_lowercase()
            .contains("titel")
    );

    let (status, doctor_body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/providers/{medical_id}/doctors"),
        &bearer,
        Some(json!({
            "first_name": "Valid",
            "last_name": "Doctor",
            "title": "Dr. med.",
            "specializations": ["Cardiology"],
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let doctor_id = Uuid::parse_str(doctor_body["id"].as_str().unwrap()).unwrap();

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/providers/{medical_id}/update"),
        &bearer,
        Some(json!({
            "name": format!("Clinic Converted {tag}"),
            "provider_type": "non_medical",
            "specializations": [],
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (status, detail) = json_request(
        &app,
        "GET",
        &format!("/api/v1/providers/{medical_id}"),
        &bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(detail["provider_type"], "non_medical");
    assert_eq!(detail["specializations"].as_array().unwrap().len(), 0);
    let doctors = detail["doctors"].as_array().expect("doctors array");
    let doctor = doctors
        .iter()
        .find(|row| row["id"] == doctor_id.to_string())
        .expect("doctor remains visible after provider conversion");
    assert_eq!(doctor["specializations"].as_array().unwrap().len(), 0);
}

#[tokio::test]
async fn create_provider_is_forbidden_for_operational_non_admin_roles() {
    let Some((app, pool, _admin_id, _)) = test_context().await else {
        return;
    };

    let tag = unique_tag("provider-create-rbac");
    let payload = json!({
        "name": format!("Clinic Forbidden {tag}"),
        "provider_type": "medical",
    });

    for role in [
        "billing",
        "sales",
        "concierge",
        "interpreter",
        "teamlead_interpreter",
    ] {
        let user_id = seed_user(&pool, &format!("{tag}-{role}"), role).await;
        let bearer = auth_header_for(user_id, role);
        let (status, _) = json_request(
            &app,
            "POST",
            "/api/v1/providers",
            &bearer,
            Some(payload.clone()),
        )
        .await;
        assert_eq!(
            status,
            StatusCode::FORBIDDEN,
            "expected {role} to be forbidden from POST /providers"
        );
    }

    let it_admin_id = seed_user(&pool, &format!("{tag}-it-admin"), "it_admin").await;
    let it_admin_bearer = auth_header_for(it_admin_id, "it_admin");
    let (status, body) = json_request(
        &app,
        "POST",
        "/api/v1/providers",
        &it_admin_bearer,
        Some(json!({
            "name": format!("Clinic It Admin {tag}"),
            "provider_type": "medical",
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    assert!(body["id"].as_str().is_some());
}

#[tokio::test]
async fn create_doctor_and_service_validate_required_fields_and_date_windows() {
    let Some((app, pool, admin_id, bearer)) = test_context().await else {
        return;
    };

    let tag = unique_tag("provider-doctor-service-validation");
    let provider_id = seed_provider(&pool, &tag).await;
    let _ = admin_id;

    // Doctor: empty name.
    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/providers/{provider_id}/doctors"),
        &bearer,
        Some(json!({ "name": "" })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert!(
        body["message"]
            .as_str()
            .unwrap_or_default()
            .to_lowercase()
            .contains("name")
    );

    // Doctor: invalid licensing_valid_until format.
    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/providers/{provider_id}/doctors"),
        &bearer,
        Some(json!({
            "name": "Dr Bad Date",
            "licensing_valid_until": "31-12-2027",
        })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert!(
        body["message"]
            .as_str()
            .unwrap_or_default()
            .to_lowercase()
            .contains("date")
    );

    // Service: negative price.
    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/providers/{provider_id}/services"),
        &bearer,
        Some(json!({
            "service_name": "Negative price",
            "price": -50.0,
        })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert!(
        body["message"]
            .as_str()
            .unwrap_or_default()
            .to_lowercase()
            .contains("price")
    );

    // Service: valid_to before valid_from.
    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/providers/{provider_id}/services"),
        &bearer,
        Some(json!({
            "service_name": "Inverted window",
            "price": 100.0,
            "valid_from": "2026-06-01",
            "valid_to": "2026-05-01",
        })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert!(
        body["message"]
            .as_str()
            .unwrap_or_default()
            .to_lowercase()
            .contains("valid_to")
    );
}

#[tokio::test]
async fn billing_can_read_kooperationsvertrag_jsonb_via_provider_detail() {
    let Some((app, pool, _admin_id, _)) = test_context().await else {
        return;
    };

    let tag = unique_tag("provider-billing-koop");
    let provider_id = seed_provider(&pool, &tag).await;
    let billing_id = seed_user(&pool, &tag, "billing").await;
    let billing_bearer = auth_header_for(billing_id, "billing");

    let kooperationsvertrag = json!({
        "valid_from": "2026-01-01",
        "discount_pct": 7.0,
        "payment_terms_days": 14,
        "billing_contact": format!("billing-{tag}@clinic.example"),
        "internal_notes": "Confidential billing terms",
    });

    sqlx::query("UPDATE providers SET kooperationsvertrag = $2 WHERE id = $1")
        .bind(provider_id)
        .bind(&kooperationsvertrag)
        .execute(&pool)
        .await
        .unwrap();

    let (status, detail) = json_request(
        &app,
        "GET",
        &format!("/api/v1/providers/{provider_id}"),
        &billing_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(detail["id"], provider_id.to_string());
    assert_eq!(detail["kooperationsvertrag"], kooperationsvertrag);

    // The list endpoint must also surface `has_contract = true` once the JSONB is populated,
    // so Billing dashboards can filter for clinics with active cooperation terms.
    let (status, list) = json_request(
        &app,
        "GET",
        "/api/v1/providers?has_contract=true",
        &billing_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let row = list
        .as_array()
        .unwrap()
        .iter()
        .find(|row| row["id"] == provider_id.to_string())
        .expect("provider with kooperationsvertrag should be visible to billing");
    assert_eq!(row["has_contract"], true);
}

#[tokio::test]
async fn providers_list_supports_provider_level_fachbereich_city_and_contract_filters() {
    let Some((app, pool, _admin_id, bearer)) = test_context().await else {
        return;
    };

    let tag = unique_tag("provider-extra-filters");

    // Three providers: two medical (one cardio + Berlin + contract, one neuro + Munich + no
    // contract) and one non-medical decoy that should never match.
    let cardio_id =
        seed_provider_with_type(&pool, &format!("{tag}-cardio"), "medical", "Germany").await;
    let neuro_id =
        seed_provider_with_type(&pool, &format!("{tag}-neuro"), "medical", "Germany").await;
    let _decoy_non_medical =
        seed_provider_with_type(&pool, &format!("{tag}-decoy"), "non_medical", "Germany").await;

    sqlx::query(
        r#"UPDATE providers
           SET fachbereich = $2,
               address_city = $3,
               kooperationsvertrag = $4
           WHERE id = $1"#,
    )
    .bind(cardio_id)
    .bind("Cardiology")
    .bind("Berlin")
    .bind(json!({"valid_from": "2026-01-01"}))
    .execute(&pool)
    .await
    .unwrap();

    sqlx::query(
        r#"UPDATE providers
           SET fachbereich = $2,
               address_city = $3,
               kooperationsvertrag = NULL
           WHERE id = $1"#,
    )
    .bind(neuro_id)
    .bind("Neurology")
    .bind("Munich")
    .execute(&pool)
    .await
    .unwrap();

    // Provider-level Fachbereich filter (distinct from doctor_fachbereich already covered).
    let (status, body) = json_request(
        &app,
        "GET",
        "/api/v1/providers?fachbereich=Cardiology",
        &bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let items = body.as_array().unwrap();
    assert!(
        items.iter().any(|row| row["id"] == cardio_id.to_string()),
        "Cardiology fachbereich filter must include cardio provider"
    );
    assert!(
        !items.iter().any(|row| row["id"] == neuro_id.to_string()),
        "Cardiology fachbereich filter must exclude neuro provider"
    );

    // City filter — provider-level address_city.
    let (status, body) =
        json_request(&app, "GET", "/api/v1/providers?city=Munich", &bearer, None).await;
    assert_eq!(status, StatusCode::OK);
    let items = body.as_array().unwrap();
    assert!(items.iter().any(|row| row["id"] == neuro_id.to_string()));
    assert!(!items.iter().any(|row| row["id"] == cardio_id.to_string()));

    // has_contract=true → only cardio_id (which has kooperationsvertrag JSONB).
    let (status, body) = json_request(
        &app,
        "GET",
        "/api/v1/providers?has_contract=true",
        &bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let items = body.as_array().unwrap();
    assert!(items.iter().any(|row| row["id"] == cardio_id.to_string()));
    assert!(!items.iter().any(|row| row["id"] == neuro_id.to_string()));

    // has_contract=false → only neuro_id.
    let (status, body) = json_request(
        &app,
        "GET",
        "/api/v1/providers?has_contract=false",
        &bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let items = body.as_array().unwrap();
    assert!(items.iter().any(|row| row["id"] == neuro_id.to_string()));
    assert!(!items.iter().any(|row| row["id"] == cardio_id.to_string()));
}

#[tokio::test]
async fn providers_list_supports_minimum_rating_filter() {
    let Some((app, pool, admin_id, bearer)) = test_context().await else {
        return;
    };

    let tag = unique_tag("provider-rating-filter");
    let high_rated_id =
        seed_provider_with_type(&pool, &format!("{tag}-high"), "medical", "Germany").await;
    let low_rated_id =
        seed_provider_with_type(&pool, &format!("{tag}-low"), "medical", "Germany").await;
    let patient_a = seed_patient(&pool, admin_id, &format!("{tag}-patient-a")).await;
    let patient_b = seed_patient(&pool, admin_id, &format!("{tag}-patient-b")).await;
    let patient_c = seed_patient(&pool, admin_id, &format!("{tag}-patient-c")).await;

    sqlx::query(
        r#"INSERT INTO patient_feedback_forms (
                patient_id, provider_id, submitted_by, source, overall_score, nps_score
           ) VALUES
                ($1, $2, $3, 'staff_capture', 5, 10),
                ($4, $2, $3, 'staff_capture', 4, 9),
                ($5, $6, $3, 'staff_capture', 3, 6)"#,
    )
    .bind(patient_a)
    .bind(high_rated_id)
    .bind(admin_id)
    .bind(patient_b)
    .bind(patient_c)
    .bind(low_rated_id)
    .execute(&pool)
    .await
    .unwrap();

    let (status, body) =
        json_request(&app, "GET", "/api/v1/providers?rating_gte=4", &bearer, None).await;
    assert_eq!(status, StatusCode::OK);
    let items = body.as_array().unwrap();
    assert!(
        items
            .iter()
            .any(|row| row["id"] == high_rated_id.to_string())
    );
    assert!(
        !items
            .iter()
            .any(|row| row["id"] == low_rated_id.to_string())
    );

    let high_rated = items
        .iter()
        .find(|row| row["id"] == high_rated_id.to_string())
        .expect("high-rated provider must stay visible");
    assert_eq!(high_rated["rating_count"], 2);
    let avg_rating = high_rated["avg_rating"]
        .as_f64()
        .expect("avg_rating must be numeric");
    assert!(
        (avg_rating - 4.5).abs() < 0.01,
        "expected avg_rating 4.5, got {avg_rating}"
    );
}

// --- EPIC 1: Patientenakte ------------------------------------------------------------------
// Closes Excel rows 1, 2, 3 and 5 for the patient registry. The existing suite seeds patients
// via a raw SQL helper and only round-trips a minimal subset of fields; these tests cement
// `POST /patients` validation, a full 22-field round-trip, the `P-YYYYMMDD-NNNN` sequence
// format, the 4 anamnese sub-endpoints that were never exercised (`vorerkrankungen`,
// `allergien`, `impfstatus`, `pain`), the timeline filters Excel row 3 requires, and the CEO
// Vollzugriff + audit-log rule from row 5.

#[tokio::test]
async fn create_patient_rejects_missing_and_invalid_required_fields() {
    let Some((app, _pool, _admin_id, bearer)) = test_context().await else {
        return;
    };

    let base = json!({
        "first_name": "Ada",
        "last_name": "Lovelace",
        "birth_date": "1990-01-01",
        "gender": "female",
    });

    let mut missing_first = base.clone();
    missing_first["first_name"] = json!("");
    let (status, body) = json_request(
        &app,
        "POST",
        "/api/v1/patients",
        &bearer,
        Some(missing_first),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert!(
        body["message"]
            .as_str()
            .unwrap_or_default()
            .to_lowercase()
            .contains("first name")
    );

    let mut whitespace_first = base.clone();
    whitespace_first["first_name"] = json!("   ");
    let (status, body) = json_request(
        &app,
        "POST",
        "/api/v1/patients",
        &bearer,
        Some(whitespace_first),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert!(
        body["message"]
            .as_str()
            .unwrap_or_default()
            .to_lowercase()
            .contains("first name")
    );

    let mut missing_last = base.clone();
    missing_last["last_name"] = json!("");
    let (status, body) = json_request(
        &app,
        "POST",
        "/api/v1/patients",
        &bearer,
        Some(missing_last),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert!(
        body["message"]
            .as_str()
            .unwrap_or_default()
            .to_lowercase()
            .contains("last name")
    );

    let mut whitespace_last = base.clone();
    whitespace_last["last_name"] = json!("   ");
    let (status, body) = json_request(
        &app,
        "POST",
        "/api/v1/patients",
        &bearer,
        Some(whitespace_last),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert!(
        body["message"]
            .as_str()
            .unwrap_or_default()
            .to_lowercase()
            .contains("last name")
    );

    let mut missing_birth = base.clone();
    missing_birth["birth_date"] = json!("");
    let (status, body) = json_request(
        &app,
        "POST",
        "/api/v1/patients",
        &bearer,
        Some(missing_birth),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert!(
        body["message"]
            .as_str()
            .unwrap_or_default()
            .to_lowercase()
            .contains("birth")
    );

    let mut invalid_birth = base.clone();
    invalid_birth["birth_date"] = json!("not-a-date");
    let (status, body) = json_request(
        &app,
        "POST",
        "/api/v1/patients",
        &bearer,
        Some(invalid_birth),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert!(
        body["message"]
            .as_str()
            .unwrap_or_default()
            .to_lowercase()
            .contains("birth_date format")
    );

    let mut minor_without_guardian = base.clone();
    minor_without_guardian["birth_date"] = json!("2020-01-01");
    let (status, body) = json_request(
        &app,
        "POST",
        "/api/v1/patients",
        &bearer,
        Some(minor_without_guardian),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert!(
        body["message"]
            .as_str()
            .unwrap_or_default()
            .to_lowercase()
            .contains("guardian")
    );

    let mut bad_gender = base.clone();
    bad_gender["gender"] = json!("unspecified");
    let (status, body) =
        json_request(&app, "POST", "/api/v1/patients", &bearer, Some(bad_gender)).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert!(
        body["message"]
            .as_str()
            .unwrap_or_default()
            .to_lowercase()
            .contains("gender")
    );

    let mut bad_insurance = base.clone();
    bad_insurance["insurance_type"] = json!("corporate");
    let (status, body) = json_request(
        &app,
        "POST",
        "/api/v1/patients",
        &bearer,
        Some(bad_insurance),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert!(
        body["message"]
            .as_str()
            .unwrap_or_default()
            .to_lowercase()
            .contains("insurance type")
    );
}

#[tokio::test]
async fn create_and_update_patient_reject_noncanonical_select_fields() {
    let Some((app, _pool, _admin_id, bearer)) = test_context().await else {
        return;
    };

    let base = json!({
        "first_name": "Ada",
        "last_name": "Lovelace",
        "birth_date": "1990-01-01",
        "gender": "female",
    });

    let mut invalid_nationality = base.clone();
    invalid_nationality["nationality"] = json!("Martian");
    let (status, body) = json_request(
        &app,
        "POST",
        "/api/v1/patients",
        &bearer,
        Some(invalid_nationality),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert!(
        body["message"]
            .as_str()
            .unwrap_or_default()
            .to_lowercase()
            .contains("nationality")
    );

    let mut invalid_country = base.clone();
    invalid_country["address_country"] = json!("Atlantis");
    let (status, body) = json_request(
        &app,
        "POST",
        "/api/v1/patients",
        &bearer,
        Some(invalid_country),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert!(
        body["message"]
            .as_str()
            .unwrap_or_default()
            .to_lowercase()
            .contains("address_country")
    );

    let mut invalid_language = base.clone();
    invalid_language["languages"] = json!(["de", "xx"]);
    let (status, body) = json_request(
        &app,
        "POST",
        "/api/v1/patients",
        &bearer,
        Some(invalid_language),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert!(
        body["message"]
            .as_str()
            .unwrap_or_default()
            .to_lowercase()
            .contains("language")
    );

    let (status, create_body) = json_request(
        &app,
        "POST",
        "/api/v1/patients",
        &bearer,
        Some(json!({
            "first_name": "Valid",
            "last_name": "Selects",
            "birth_date": "1990-01-01",
            "gender": "female",
            "nationality": "Ukrainian",
            "residence_country": "Germany",
            "address_country": "Germany",
            "languages": ["de", "uk"],
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let patient_id = Uuid::parse_str(create_body["id"].as_str().unwrap()).unwrap();

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/patients/{patient_id}/update"),
        &bearer,
        Some(json!({
            "residence_country": "Neverland",
        })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert!(
        body["message"]
            .as_str()
            .unwrap_or_default()
            .to_lowercase()
            .contains("residence_country")
    );

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/patients/{patient_id}/update"),
        &bearer,
        Some(json!({
            "languages": ["de", "zz"],
        })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert!(
        body["message"]
            .as_str()
            .unwrap_or_default()
            .to_lowercase()
            .contains("language")
    );
}

#[tokio::test]
async fn create_patient_accepts_minor_with_guardian_relation() {
    let Some((app, _pool, _admin_id, bearer)) = test_context().await else {
        return;
    };

    let tag = unique_tag("patient-minor-guardian");
    let payload = json!({
        "first_name": "Minor",
        "last_name": format!("Patient {tag}"),
        "birth_date": "2020-01-01",
        "gender": "female",
        "patient_relations": [
            {
                "related_name": "Guardian Person",
                "relation_type": "guardian",
                "is_emergency_contact": true,
                "phone": "+49 30 123456"
            }
        ]
    });

    let (status, create_body) =
        json_request(&app, "POST", "/api/v1/patients", &bearer, Some(payload)).await;
    assert_eq!(status, StatusCode::CREATED);
    let patient_id = Uuid::parse_str(create_body["id"].as_str().unwrap()).unwrap();

    let (status, relations) = json_request(
        &app,
        "GET",
        &format!("/api/v1/patients/{patient_id}/relations"),
        &bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let relations = relations.as_array().expect("relations array");
    assert_eq!(relations.len(), 1);
    assert_eq!(relations[0]["relation_type"], "guardian");
    assert_eq!(relations[0]["related_name"], "Guardian Person");
    assert_eq!(relations[0]["is_emergency_contact"], true);
}

#[tokio::test]
async fn pm_can_create_patient_with_full_payload_and_round_trip_via_get_patient() {
    let Some((app, pool, admin_id, _)) = test_context().await else {
        return;
    };

    let tag = unique_tag("patient-full-payload");
    let pm_id = seed_user(&pool, &tag, "patient_manager").await;
    let pm_bearer = auth_header_for(pm_id, "patient_manager");

    let payload = json!({
        "title": "Dr.",
        "first_name": format!("First {tag}"),
        "last_name": format!("Last {tag}"),
        "birth_date": "1985-06-15",
        "gender": "female",
        "nationality": "Ukrainian",
        "residence_country": "Germany",
        "languages": ["de", "en", "uk"],
        "phone_primary": "+49 30 1112233",
        "phone_secondary": "+380 44 0000000",
        "email": format!("{tag}@example.com"),
        "address_street": "Hauptstr. 42",
        "address_city": "Berlin",
        "address_zip": "10115",
        "address_country": "Germany",
        "insurance_provider": "Techniker Krankenkasse",
        "insurance_number": format!("TK-{tag}"),
        "insurance_type": "public",
        "emergency_contact_name": "Emergency Contact",
        "emergency_contact_phone": "+49 30 4445566",
        "emergency_contact_relation": "spouse",
        "notes": "Full payload round-trip",
    });

    let (status, create_body) = json_request(
        &app,
        "POST",
        "/api/v1/patients",
        &pm_bearer,
        Some(payload.clone()),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let patient_id = Uuid::parse_str(create_body["id"].as_str().unwrap()).unwrap();
    let returned_patient_id = create_body["patient_id"]
        .as_str()
        .expect("patient_id returned on create")
        .to_string();
    assert!(
        returned_patient_id.starts_with("P-"),
        "patient_id must follow P-YYYYMMDD-NNNN format, got {returned_patient_id}"
    );

    // The create handler does not auto-assign the PM — the PM needs an explicit assignment to
    // read the record back. Seed one and then GET the full detail.
    seed_patient_assignment(&pool, patient_id, pm_id, admin_id).await;

    let (status, detail) = json_request(
        &app,
        "GET",
        &format!("/api/v1/patients/{patient_id}"),
        &pm_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(detail["id"], patient_id.to_string());
    assert_eq!(detail["patient_id"], returned_patient_id);
    assert_eq!(detail["title"], "Dr.");
    assert_eq!(detail["first_name"], format!("First {tag}"));
    assert_eq!(detail["last_name"], format!("Last {tag}"));
    assert_eq!(detail["birth_date"], "1985-06-15");
    assert_eq!(detail["gender"], "female");
    assert_eq!(detail["nationality"], "Ukrainian");
    assert_eq!(detail["residence_country"], "Germany");
    let langs = detail["languages"].as_array().expect("languages array");
    assert!(langs.iter().any(|l| l == "de"));
    assert!(langs.iter().any(|l| l == "en"));
    assert!(langs.iter().any(|l| l == "uk"));
    assert_eq!(detail["phone_primary"], "+49 30 1112233");
    assert_eq!(detail["phone_secondary"], "+380 44 0000000");
    assert_eq!(detail["email"], format!("{tag}@example.com"));
    assert_eq!(detail["address_street"], "Hauptstr. 42");
    assert_eq!(detail["address_city"], "Berlin");
    assert_eq!(detail["address_zip"], "10115");
    assert_eq!(detail["address_country"], "Germany");
    assert_eq!(detail["insurance_provider"], "Techniker Krankenkasse");
    assert_eq!(detail["insurance_number"], format!("TK-{tag}"));
    assert_eq!(detail["insurance_type"], "public");
    assert_eq!(detail["emergency_contact_name"], "Emergency Contact");
    assert_eq!(detail["emergency_contact_phone"], "+49 30 4445566");
    assert_eq!(detail["emergency_contact_relation"], "spouse");
    assert_eq!(detail["notes"], "Full payload round-trip");
}

#[tokio::test]
async fn patient_id_sequence_generates_unique_human_readable_codes() {
    let Some((app, _pool, _admin_id, bearer)) = test_context().await else {
        return;
    };

    let tag = unique_tag("patient-id-seq");
    let mut seen = Vec::new();
    for idx in 0..3 {
        let (status, body) = json_request(
            &app,
            "POST",
            "/api/v1/patients",
            &bearer,
            Some(json!({
                "first_name": format!("Seq {tag}-{idx}"),
                "last_name": "Tester",
                "birth_date": "1992-03-14",
                "gender": "diverse",
            })),
        )
        .await;
        assert_eq!(status, StatusCode::CREATED);
        let code = body["patient_id"]
            .as_str()
            .expect("patient_id present")
            .to_string();

        // Format: P-YYYYMMDD-NNNN
        let parts: Vec<&str> = code.split('-').collect();
        assert_eq!(parts.len(), 3, "unexpected patient_id format: {code}");
        assert_eq!(parts[0], "P");
        assert_eq!(parts[1].len(), 8, "date segment must be YYYYMMDD: {code}");
        assert!(
            parts[1].chars().all(|c| c.is_ascii_digit()),
            "date segment must be numeric: {code}"
        );
        assert_eq!(
            parts[2].len(),
            4,
            "sequence segment must be zero-padded 4: {code}"
        );
        assert!(
            parts[2].chars().all(|c| c.is_ascii_digit()),
            "sequence segment must be numeric: {code}"
        );

        assert!(
            !seen.contains(&code),
            "patient_id sequence must be unique, got duplicate {code}"
        );
        seen.push(code);
    }
    assert_eq!(seen.len(), 3);
}

#[tokio::test]
async fn case_vorerkrankungen_section_round_trip_via_api() {
    let Some((app, pool, admin_id, _)) = test_context().await else {
        return;
    };

    let tag = unique_tag("case-vorerkrankungen");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let pm_id = seed_user(&pool, &tag, "patient_manager").await;
    seed_patient_assignment(&pool, patient_id, pm_id, admin_id).await;
    let pm_bearer = auth_header_for(pm_id, "patient_manager");

    let (status, created) = json_request(
        &app,
        "POST",
        "/api/v1/cases",
        &pm_bearer,
        Some(json!({
            "patient_id": patient_id,
            "hauptanfragegrund": "Pre-existing conditions intake",
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let case_id = Uuid::parse_str(created["id"].as_str().unwrap()).unwrap();

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/cases/{case_id}/vorerkrankungen"),
        &pm_bearer,
        Some(json!({
            "items": [
                {
                    "erkrankung": "Hypertonie",
                    "erstdiagnose": "2020-05",
                    "notiz": "Dauermedikation seit 5 Jahren",
                },
                {
                    "erkrankung": "Typ-2-Diabetes",
                    "erstdiagnose": "2022-11",
                    "notiz": null,
                }
            ]
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["count"], 2);

    let (status, detail) = json_request(
        &app,
        "GET",
        &format!("/api/v1/cases/{case_id}"),
        &pm_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let items = detail["vorerkrankungen"]
        .as_array()
        .expect("vorerkrankungen array");
    assert_eq!(items.len(), 2);
    let hypertension = items
        .iter()
        .find(|row| row["erkrankung"] == "Hypertonie")
        .expect("Hypertonie row present");
    assert_eq!(hypertension["erstdiagnose"], "2020-05");
    assert_eq!(hypertension["notiz"], "Dauermedikation seit 5 Jahren");
    let diabetes = items
        .iter()
        .find(|row| row["erkrankung"] == "Typ-2-Diabetes")
        .expect("Diabetes row present");
    assert_eq!(diabetes["erstdiagnose"], "2022-11");
}

#[tokio::test]
async fn case_allergien_section_round_trip_via_api() {
    let Some((app, pool, admin_id, _)) = test_context().await else {
        return;
    };

    let tag = unique_tag("case-allergien");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let pm_id = seed_user(&pool, &tag, "patient_manager").await;
    seed_patient_assignment(&pool, patient_id, pm_id, admin_id).await;
    let pm_bearer = auth_header_for(pm_id, "patient_manager");

    let (status, created) = json_request(
        &app,
        "POST",
        "/api/v1/cases",
        &pm_bearer,
        Some(json!({
            "patient_id": patient_id,
            "hauptanfragegrund": "Allergie-Anamnese",
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let case_id = Uuid::parse_str(created["id"].as_str().unwrap()).unwrap();

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/cases/{case_id}/allergien"),
        &pm_bearer,
        Some(json!({
            "items": [
                {
                    "allergie": "Penicillin",
                    "reaktion": "Hautausschlag und Atemnot innerhalb 30 Minuten",
                },
                {
                    "allergie": "Latex",
                    "reaktion": "Hautrötung beim Kontakt",
                }
            ]
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["count"], 2);

    let (status, detail) = json_request(
        &app,
        "GET",
        &format!("/api/v1/cases/{case_id}"),
        &pm_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let items = detail["allergien"].as_array().expect("allergien array");
    assert_eq!(items.len(), 2);
    let penicillin = items
        .iter()
        .find(|row| row["allergie"] == "Penicillin")
        .expect("Penicillin row present");
    assert_eq!(
        penicillin["reaktion"],
        "Hautausschlag und Atemnot innerhalb 30 Minuten"
    );
    assert!(items.iter().any(|row| row["allergie"] == "Latex"));
}

#[tokio::test]
async fn case_impfstatus_section_round_trip_via_api() {
    let Some((app, pool, admin_id, _)) = test_context().await else {
        return;
    };

    let tag = unique_tag("case-impfstatus");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let pm_id = seed_user(&pool, &tag, "patient_manager").await;
    seed_patient_assignment(&pool, patient_id, pm_id, admin_id).await;
    let pm_bearer = auth_header_for(pm_id, "patient_manager");

    let (status, created) = json_request(
        &app,
        "POST",
        "/api/v1/cases",
        &pm_bearer,
        Some(json!({
            "patient_id": patient_id,
            "hauptanfragegrund": "Impfstatus",
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let case_id = Uuid::parse_str(created["id"].as_str().unwrap()).unwrap();

    let status_text = "Tetanus 2023, Grippe 2024, MMR vollständig";
    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/cases/{case_id}/impfstatus"),
        &pm_bearer,
        Some(json!({ "status_text": status_text })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (status, detail) = json_request(
        &app,
        "GET",
        &format!("/api/v1/cases/{case_id}"),
        &pm_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(detail["impfstatus"], status_text);
}

#[tokio::test]
async fn case_pain_records_section_round_trip_with_all_twelve_fields_via_api() {
    let Some((app, pool, admin_id, _)) = test_context().await else {
        return;
    };

    let tag = unique_tag("case-pain");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let pm_id = seed_user(&pool, &tag, "patient_manager").await;
    seed_patient_assignment(&pool, patient_id, pm_id, admin_id).await;
    let pm_bearer = auth_header_for(pm_id, "patient_manager");

    let (status, created) = json_request(
        &app,
        "POST",
        "/api/v1/cases",
        &pm_bearer,
        Some(json!({
            "patient_id": patient_id,
            "hauptanfragegrund": "Chronic back pain assessment",
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let case_id = Uuid::parse_str(created["id"].as_str().unwrap()).unwrap();

    // Cement the entire 12-field pain block exactly as described in the Anamnese PDF.
    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/cases/{case_id}/pain"),
        &pm_bearer,
        Some(json!({
            "items": [{
                "lokalisierung": "Lower back, right side",
                "seit_wann": "ca. 6 months ago",
                "ursache": "Heavy lifting at work, no trauma",
                "qualitaet": "ziehend, stechend bei Bewegung",
                "kontinuitaet": "bei Belastung und langem Stehen",
                "entwicklung": "zunehmend in letzten 4 Wochen",
                "nrs_aktuell": 7,
                "nrs_anfang": 4,
                "dauer_anfang": "wenige Minuten",
                "dauer_aktuell": "bis zu 2 Stunden nach Belastung",
                "ausstrahlung": "ins rechte Bein bis zum Knie",
                "auftreten": "schleichend"
            }]
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["count"], 1);

    let (status, detail) = json_request(
        &app,
        "GET",
        &format!("/api/v1/cases/{case_id}"),
        &pm_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let pains = detail["pain_records"]
        .as_array()
        .expect("pain_records array");
    assert_eq!(pains.len(), 1);
    let pain = &pains[0];
    assert_eq!(pain["lokalisierung"], "Lower back, right side");
    assert_eq!(pain["seit_wann"], "ca. 6 months ago");
    assert_eq!(pain["ursache"], "Heavy lifting at work, no trauma");
    assert_eq!(pain["qualitaet"], "ziehend, stechend bei Bewegung");
    assert_eq!(pain["kontinuitaet"], "bei Belastung und langem Stehen");
    assert_eq!(pain["entwicklung"], "zunehmend in letzten 4 Wochen");
    assert_eq!(pain["nrs_aktuell"], 7);
    assert_eq!(pain["nrs_anfang"], 4);
    assert_eq!(pain["dauer_anfang"], "wenige Minuten");
    assert_eq!(pain["dauer_aktuell"], "bis zu 2 Stunden nach Belastung");
    assert_eq!(pain["ausstrahlung"], "ins rechte Bein bis zum Knie");
    assert_eq!(pain["auftreten"], "schleichend");
}

#[tokio::test]
async fn case_text_snippets_support_create_list_update() {
    let Some((app, pool, _admin_id, _)) = test_context().await else {
        return;
    };

    let tag = unique_tag("case-text-snippets");
    let pm_id = seed_user(&pool, &tag, "patient_manager").await;
    let pm_bearer = auth_header_for(pm_id, "patient_manager");

    let (status, created) = json_request(
        &app,
        "POST",
        "/api/v1/cases/text-snippets",
        &pm_bearer,
        Some(json!({
            "label": "Initialer Verlauf",
            "category": "anamnese",
            "body": "Patient {patient_name} berichtet über {hauptanfragegrund}.",
            "is_active": true
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let snippet_id = created["id"].as_str().unwrap();

    let (status, list_body) =
        json_request(&app, "GET", "/api/v1/cases/text-snippets", &pm_bearer, None).await;
    assert_eq!(status, StatusCode::OK);
    let snippets = list_body.as_array().unwrap();
    let snippet = snippets
        .iter()
        .find(|item| item["id"] == snippet_id)
        .expect("created snippet present");
    assert_eq!(snippet["label"], "Initialer Verlauf");
    assert_eq!(snippet["category"], "anamnese");
    assert_eq!(
        snippet["body"],
        "Patient {patient_name} berichtet über {hauptanfragegrund}."
    );
    assert_eq!(snippet["is_active"], true);

    let (status, updated) = json_request(
        &app,
        "POST",
        &format!("/api/v1/cases/text-snippets/{snippet_id}/update"),
        &pm_bearer,
        Some(json!({
            "label": "Follow-up Verlauf",
            "category": "followup",
            "body": "Kontrolle am {today} für {patient_name}.",
            "is_active": false
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(updated["label"], "Follow-up Verlauf");
    assert_eq!(updated["is_active"], false);

    let (status, list_body) =
        json_request(&app, "GET", "/api/v1/cases/text-snippets", &pm_bearer, None).await;
    assert_eq!(status, StatusCode::OK);
    let snippets = list_body.as_array().unwrap();
    let snippet = snippets
        .iter()
        .find(|item| item["id"] == snippet_id)
        .expect("updated snippet present");
    assert_eq!(snippet["label"], "Follow-up Verlauf");
    assert_eq!(snippet["category"], "followup");
    assert_eq!(snippet["body"], "Kontrolle am {today} für {patient_name}.");
    assert_eq!(snippet["is_active"], false);
}

#[tokio::test]
async fn interpreter_cannot_manage_case_text_snippets() {
    let Some((app, pool, _admin_id, _)) = test_context().await else {
        return;
    };

    let tag = unique_tag("case-text-snippets-rbac");
    let interpreter_id = seed_user(&pool, &tag, "interpreter").await;
    let interpreter_bearer = auth_header_for(interpreter_id, "interpreter");

    let (status, _) = json_request(
        &app,
        "GET",
        "/api/v1/cases/text-snippets",
        &interpreter_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    let (status, _) = json_request(
        &app,
        "POST",
        "/api/v1/cases/text-snippets",
        &interpreter_bearer,
        Some(json!({
            "label": "Forbidden",
            "category": "anamnese",
            "body": "Should not be created",
            "is_active": true
        })),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn patient_timeline_supports_entity_type_category_source_and_range_filters() {
    let Some((app, pool, admin_id, bearer)) = test_context().await else {
        return;
    };

    let tag = unique_tag("timeline-filters");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let provider_id = seed_provider(&pool, &tag).await;
    let doctor_id = seed_doctor(&pool, provider_id, &tag).await;
    seed_appointment(
        &pool,
        patient_id,
        provider_id,
        doctor_id,
        admin_id,
        &format!("Timeline {tag} consult"),
        "confirmed",
        "2026-04-18",
    )
    .await;

    // Seed an old appointment that must fall out of the 30d range.
    sqlx::query(
        r#"INSERT INTO appointments (
                patient_id, provider_id, doctor_id, title, status, date, appointment_type,
                created_by
           ) VALUES ($1, $2, $3, $4, 'confirmed', $5, 'medical', $6)"#,
    )
    .bind(patient_id)
    .bind(provider_id)
    .bind(doctor_id)
    .bind(format!("Ancient {tag}"))
    .bind(chrono::NaiveDate::from_ymd_opt(2024, 1, 5).unwrap())
    .bind(admin_id)
    .execute(&pool)
    .await
    .unwrap();

    seed_case(
        &pool,
        patient_id,
        admin_id,
        &format!("C-{tag}"),
        "open",
        &format!("Timeline case {tag}"),
    )
    .await;

    // Plain read with no filters must surface both categories.
    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/patients/{patient_id}/timeline?limit=50"),
        &bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let items = body["items"].as_array().expect("items array");
    assert!(
        items
            .iter()
            .any(|item| item["entity_type"] == "appointment")
    );
    assert!(items.iter().any(|item| item["entity_type"] == "case"));

    // entity_type filter — only appointments remain.
    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/patients/{patient_id}/timeline?entity_type=appointment"),
        &bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let items = body["items"].as_array().unwrap();
    assert!(!items.is_empty());
    assert!(
        items
            .iter()
            .all(|item| item["entity_type"] == "appointment")
    );

    // category filter (appointment category = medical) still yields rows.
    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/patients/{patient_id}/timeline?entity_type=appointment&category=medical"),
        &bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let items = body["items"].as_array().unwrap();
    assert!(
        items
            .iter()
            .all(|item| item["category"] == "medical" && item["entity_type"] == "appointment")
    );

    // range filter drops the 2024 appointment, only the 2026-04-18 slot survives 30d window.
    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/patients/{patient_id}/timeline?entity_type=appointment&range=30d"),
        &bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let items = body["items"].as_array().unwrap();
    assert!(
        items
            .iter()
            .all(|item| item["title"] != format!("Ancient {tag}")),
        "range=30d must exclude the 2024 slot"
    );

    // Source (provider name) filter is an exact match against the concatenated
    // `"<Clinic> · <Doctor>"` source_label built by the timeline CTE.
    let source_label = format!("Clinic {tag} · Doctor {tag}");
    let (status, body) = json_request(
        &app,
        "GET",
        &format!(
            "/api/v1/patients/{patient_id}/timeline?entity_type=appointment&source={}",
            urlencode(&source_label)
        ),
        &bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let items = body["items"].as_array().unwrap();
    assert!(
        !items.is_empty(),
        "source filter by exact clinic·doctor label must match seeded appointment"
    );
    assert!(
        items
            .iter()
            .all(|item| item["source_label"] == source_label)
    );

    // `search=` applies ILIKE fuzzy matching across title + source_label, so a clinic
    // substring still returns the row without forcing the exact full label.
    let clinic_substring = format!("Clinic {tag}");
    let (status, body) = json_request(
        &app,
        "GET",
        &format!(
            "/api/v1/patients/{patient_id}/timeline?entity_type=appointment&search={}",
            urlencode(&clinic_substring)
        ),
        &bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let items = body["items"].as_array().unwrap();
    assert!(
        !items.is_empty(),
        "search filter by clinic substring must match seeded appointment"
    );

    // Invalid range returns 422 — cement the whitelist.
    let (status, _) = json_request(
        &app,
        "GET",
        &format!("/api/v1/patients/{patient_id}/timeline?range=forever"),
        &bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
}

fn urlencode(value: &str) -> String {
    value
        .chars()
        .map(|c| match c {
            ' ' => "%20".to_string(),
            c if c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | '~') => c.to_string(),
            c => {
                let mut buf = [0u8; 4];
                let bytes = c.encode_utf8(&mut buf).as_bytes();
                bytes.iter().map(|b| format!("%{b:02X}")).collect()
            }
        })
        .collect()
}

#[tokio::test]
async fn ceo_can_update_unassigned_patient_and_audit_log_records_the_mutation() {
    let Some((app, pool, _admin_id, bearer)) = test_context().await else {
        return;
    };

    let tag = unique_tag("ceo-update-audit");
    // Seed a brand-new admin so that CEO has zero assignment rows pointing at the patient.
    let patient_owner = seed_user(&pool, &format!("{tag}-other-admin"), "patient_manager").await;
    let patient_id = seed_patient(&pool, patient_owner, &tag).await;

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/patients/{patient_id}/update"),
        &bearer,
        Some(json!({
            "first_name": format!("CEO-Changed {tag}"),
            "last_name": "Updated",
            "birth_date": "2004-02-03",
            "gender": "diverse",
            "notes": "Updated by CEO without assignment",
            "legal_status": {
                "compliance_completed": true,
                "contract_status": "signed",
            }
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    // Verify the mutation is visible through GET.
    let (status, detail) = json_request(
        &app,
        "GET",
        &format!("/api/v1/patients/{patient_id}"),
        &bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(detail["first_name"], format!("CEO-Changed {tag}"));
    assert_eq!(detail["birth_date"], "2004-02-03");
    assert_eq!(detail["gender"], "diverse");
    assert_eq!(detail["notes"], "Updated by CEO without assignment");

    // Audit log records the `update_patient` domain event with the caller as actor.
    support::wait_until("update_patient audit entry", || async {
        let exists: Option<Uuid> = sqlx::query_scalar(
            r#"SELECT entity_id
               FROM audit_log
               WHERE action = 'update_patient'
                 AND entity_type = 'patient'
                 AND entity_id = $1
               ORDER BY created_at DESC
               LIMIT 1"#,
        )
        .bind(patient_id)
        .fetch_optional(&pool)
        .await
        .unwrap();
        exists.is_some()
    })
    .await;

    let context: Value = sqlx::query_scalar(
        r#"SELECT context
           FROM audit_log
           WHERE action = 'update_patient'
             AND entity_type = 'patient'
             AND entity_id = $1
           ORDER BY created_at DESC
           LIMIT 1"#,
    )
    .bind(patient_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(context["legal_status_updated"], true);
    assert_eq!(context["birth_date_updated"], true);
    assert_eq!(context["gender_updated"], true);
    assert_eq!(context["compliance_completed"], true);
    assert_eq!(context["contract_status"], "signed");
}

#[tokio::test]
async fn concierge_and_patient_manager_can_list_non_medical_providers() {
    let Some((app, pool, _admin_id, _)) = test_context().await else {
        return;
    };

    let tag = unique_tag("non-medical-list-roles");
    let non_medical_id =
        seed_provider_with_type(&pool, &format!("{tag}-travel"), "non_medical", "Austria").await;
    let medical_decoy_id =
        seed_provider_with_type(&pool, &format!("{tag}-clinic"), "medical", "Germany").await;

    let concierge_id = seed_user(&pool, &format!("{tag}-concierge"), "concierge").await;
    let pm_id = seed_user(&pool, &format!("{tag}-pm"), "patient_manager").await;

    for (role, user_id) in [("concierge", concierge_id), ("patient_manager", pm_id)] {
        let bearer = auth_header_for(user_id, role);
        let (status, body) = json_request(
            &app,
            "GET",
            "/api/v1/providers?provider_type=non_medical",
            &bearer,
            None,
        )
        .await;
        assert_eq!(
            status,
            StatusCode::OK,
            "{role} must be allowed to list non-medical providers"
        );
        let items = body.as_array().unwrap();
        assert!(
            items
                .iter()
                .any(|row| row["id"] == non_medical_id.to_string()),
            "{role} must see the seeded non-medical provider"
        );
        assert!(
            !items
                .iter()
                .any(|row| row["id"] == medical_decoy_id.to_string()),
            "{role} list with provider_type=non_medical must exclude medical providers"
        );
    }
}
