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

async fn text_request(
    app: &axum::Router,
    method: &str,
    path: &str,
    bearer: &str,
) -> (StatusCode, String, Option<String>, Option<String>) {
    let request = Request::builder()
        .method(method)
        .uri(path)
        .header("Authorization", bearer)
        .body(Body::empty())
        .unwrap();

    let response = app.clone().oneshot(request).await.unwrap();
    let status = response.status();
    let content_type = response
        .headers()
        .get("Content-Type")
        .and_then(|value| value.to_str().ok())
        .map(str::to_string);
    let content_disposition = response
        .headers()
        .get("Content-Disposition")
        .and_then(|value| value.to_str().ok())
        .map(str::to_string);
    let bytes = axum::body::to_bytes(response.into_body(), 4 * 1024 * 1024)
        .await
        .unwrap();
    let body = String::from_utf8(bytes.to_vec()).unwrap_or_default();
    (status, body, content_type, content_disposition)
}

fn unique_tag(prefix: &str) -> String {
    format!("{prefix}-{}", Uuid::new_v4().simple())
}

fn auth_header_for(user_id: Uuid, role: &str) -> String {
    let token = jwt::issue_access_token(TEST_SECRET, user_id, role, Uuid::new_v4()).unwrap();
    format!("Bearer {token}")
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

async fn seed_patient(pool: &PgPool, created_by: Uuid, tag: &str, residence_country: &str) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO patients (
                patient_id, first_name, last_name, birth_date, gender,
                residence_country, created_by
           ) VALUES (
                $1, $2, $3, '1990-01-01', 'diverse',
                $4, $5
           ) RETURNING id"#,
    )
    .bind(format!("PT-{tag}"))
    .bind(format!("First {tag}"))
    .bind(format!("Last {tag}"))
    .bind(residence_country)
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
    seed_provider_with_type(pool, tag, "medical").await
}

async fn seed_provider_with_type(pool: &PgPool, tag: &str, provider_type: &str) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO providers (name, provider_type, address_city, address_country)
           VALUES ($1, $2, 'Cologne', 'DE')
           RETURNING id"#,
    )
    .bind(format!("Clinic {tag}"))
    .bind(provider_type)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn seed_doctor(pool: &PgPool, provider_id: Uuid, tag: &str) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO provider_doctors (provider_id, name, title, fachbereich)
           VALUES ($1, $2, 'Dr.', 'Cardiology')
           RETURNING id"#,
    )
    .bind(provider_id)
    .bind(format!("Doctor {tag}"))
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn seed_order(
    pool: &PgPool,
    patient_id: Uuid,
    created_by: Uuid,
    tag: &str,
    status: &str,
) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO orders (
                order_number, patient_id, phase, status, created_by
           ) VALUES (
                $1, $2, 'execution', $3, $4
           ) RETURNING id"#,
    )
    .bind(format!("ORD-{tag}-{}", Uuid::new_v4().simple()))
    .bind(patient_id)
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
    tag: &str,
    status: &str,
) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO cases (
                case_id, patient_id, manager_id, status, hauptanfragegrund
           ) VALUES (
                $1, $2, $3, $4, $5
           ) RETURNING id"#,
    )
    .bind(format!("CASE-{tag}-{}", Uuid::new_v4().simple()))
    .bind(patient_id)
    .bind(manager_id)
    .bind(status)
    .bind(format!("Main request {tag}"))
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn seed_order_service(
    pool: &PgPool,
    order_id: Uuid,
    provider_id: Uuid,
    doctor_id: Option<Uuid>,
    tag: &str,
    unit_price: i32,
) {
    sqlx::query(
        r#"INSERT INTO order_leistungen (
                order_id, description, quantity, unit_price, vat_rate, provider_id, doctor_id, status
           ) VALUES (
                $1, $2, 1, $3, 19, $4, $5, 'approved'
           )"#,
    )
    .bind(order_id)
    .bind(format!("Service {tag}"))
    .bind(unit_price)
    .bind(provider_id)
    .bind(doctor_id)
    .execute(pool)
    .await
    .unwrap();
}

async fn seed_provider_service(pool: &PgPool, provider_id: Uuid, service_name: &str) {
    sqlx::query(
        r#"INSERT INTO service_catalog (
                provider_id, service_name, description, price, currency, valid_from
           ) VALUES (
                $1, $2, $3, 120.0, 'EUR', CURRENT_DATE - 30
           )"#,
    )
    .bind(provider_id)
    .bind(service_name)
    .bind(format!("{service_name} package"))
    .execute(pool)
    .await
    .unwrap();
}

#[allow(clippy::too_many_arguments)]
async fn seed_invoice(
    pool: &PgPool,
    order_id: Uuid,
    patient_id: Uuid,
    created_by: Uuid,
    tag: &str,
    status: &str,
    total_gross: i32,
    paid_amount: i32,
    due_date_sql: &str,
    paid_at_sql: &str,
) {
    let sql = format!(
        r#"INSERT INTO invoices (
                order_id, patient_id, invoice_number, invoice_type, status,
                issued_at, due_date, total_net, total_vat, total_gross, paid_amount, paid_at, created_by
           ) VALUES (
                $1, $2, $3, 'final', $4,
                now(), {due_date_sql}, $5, $6, $7, $8, {paid_at_sql}, $9
           )"#
    );

    sqlx::query(&sql)
        .bind(order_id)
        .bind(patient_id)
        .bind(format!("INV-{tag}-{}", Uuid::new_v4().simple()))
        .bind(status)
        .bind(total_gross - (total_gross * 19 / 119))
        .bind(total_gross * 19 / 119)
        .bind(total_gross)
        .bind(paid_amount)
        .bind(created_by)
        .execute(pool)
        .await
        .unwrap();
}

async fn seed_quote(
    pool: &PgPool,
    order_id: Uuid,
    created_by: Uuid,
    tag: &str,
    status: &str,
    total_gross: i32,
    valid_until_sql: &str,
) {
    let sql = format!(
        r#"INSERT INTO quotes (
                order_id, quote_number, total_net, total_vat, total_gross,
                status, valid_until, paid_amount, line_items, created_by
           ) VALUES (
                $1, $2, $3, $4, $5,
                $6, {valid_until_sql}, 0, '[]'::jsonb, $7
           )"#
    );

    sqlx::query(&sql)
        .bind(order_id)
        .bind(format!("KV-{tag}-{}", Uuid::new_v4().simple()))
        .bind(total_gross - (total_gross * 19 / 119))
        .bind(total_gross * 19 / 119)
        .bind(total_gross)
        .bind(status)
        .bind(created_by)
        .execute(pool)
        .await
        .unwrap();
}

async fn seed_task(
    pool: &PgPool,
    assignee_id: Uuid,
    assigned_by: Uuid,
    patient_id: Uuid,
    order_id: Uuid,
    title: &str,
    due_date_sql: &str,
) {
    let sql = format!(
        r#"INSERT INTO tasks (
                title, assigned_to, assigned_by, patient_id, order_id, priority, status, due_date
           ) VALUES (
                $1, $2, $3, $4, $5, 'high', 'open', {due_date_sql}
           )"#
    );

    sqlx::query(&sql)
        .bind(title)
        .bind(assignee_id)
        .bind(assigned_by)
        .bind(patient_id)
        .bind(order_id)
        .execute(pool)
        .await
        .unwrap();
}

#[allow(clippy::too_many_arguments)]
async fn seed_workflow_item(
    pool: &PgPool,
    patient_id: Uuid,
    order_id: Uuid,
    owner_user_id: Uuid,
    created_by: Uuid,
    tag: &str,
    item_key: &str,
    completed: bool,
) {
    sqlx::query(
        r#"INSERT INTO workflow_checklist_items (
                scope_type, scope_id, patient_id, order_id, checklist_key, item_key, item_text,
                owner_role, owner_user_id, created_by, is_completed, completed_by, completed_at, sort_order
           ) VALUES (
                'order', $1, $2, $1, 'order_execution', $3, $4,
                'patient_manager', $5, $6, $7,
                CASE WHEN $7 THEN $5 ELSE NULL END,
                CASE WHEN $7 THEN now() ELSE NULL END,
                1
           )"#,
    )
    .bind(order_id)
    .bind(patient_id)
    .bind(item_key)
    .bind(format!("Checklist {tag} {item_key}"))
    .bind(owner_user_id)
    .bind(created_by)
    .bind(completed)
    .execute(pool)
    .await
    .unwrap();
}

#[allow(clippy::too_many_arguments)]
async fn seed_overdue_open_appointment(
    pool: &PgPool,
    patient_id: Uuid,
    provider_id: Uuid,
    doctor_id: Option<Uuid>,
    order_id: Uuid,
    owner_user_id: Uuid,
    created_by: Uuid,
    tag: &str,
) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO appointments (
                patient_id, provider_id, doctor_id, order_id, owner_user_id,
                appointment_type, title, date, time_start, time_end, status, created_by
           ) VALUES (
                $1, $2, $3, $4, $5,
                'medical', $6, CURRENT_DATE - 3, '09:00', '10:00', 'confirmed', $7
           ) RETURNING id"#,
    )
    .bind(patient_id)
    .bind(provider_id)
    .bind(doctor_id)
    .bind(order_id)
    .bind(owner_user_id)
    .bind(format!("Overdue visit {tag}"))
    .bind(created_by)
    .fetch_one(pool)
    .await
    .unwrap()
}

#[allow(clippy::too_many_arguments)]
async fn seed_appointment(
    pool: &PgPool,
    patient_id: Uuid,
    provider_id: Uuid,
    doctor_id: Option<Uuid>,
    order_id: Uuid,
    interpreter_id: Uuid,
    owner_user_id: Uuid,
    created_by: Uuid,
    tag: &str,
) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO appointments (
                patient_id, provider_id, doctor_id, order_id, interpreter_id, owner_user_id,
                appointment_type, title, date, time_start, time_end, status, created_by
           ) VALUES (
                $1, $2, $3, $4, $5, $6,
                'medical', $7, CURRENT_DATE - 5, '09:00', '11:00', 'completed', $8
           ) RETURNING id"#,
    )
    .bind(patient_id)
    .bind(provider_id)
    .bind(doctor_id)
    .bind(order_id)
    .bind(interpreter_id)
    .bind(owner_user_id)
    .bind(format!("Visit {tag}"))
    .bind(created_by)
    .fetch_one(pool)
    .await
    .unwrap()
}

#[allow(clippy::too_many_arguments)]
async fn seed_non_medical_appointment(
    pool: &PgPool,
    patient_id: Uuid,
    provider_id: Uuid,
    order_id: Uuid,
    owner_user_id: Uuid,
    created_by: Uuid,
    tag: &str,
) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO appointments (
                patient_id, provider_id, order_id, owner_user_id,
                appointment_type, title, date, time_start, time_end, status, created_by
           ) VALUES (
                $1, $2, $3, $4,
                'non_medical', $5, CURRENT_DATE - 3, '12:00', '13:00', 'completed', $6
           ) RETURNING id"#,
    )
    .bind(patient_id)
    .bind(provider_id)
    .bind(order_id)
    .bind(owner_user_id)
    .bind(format!("Concierge visit {tag}"))
    .bind(created_by)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn seed_interpreter_report(pool: &PgPool, appointment_id: Uuid, interpreter_id: Uuid) {
    sqlx::query(
        r#"INSERT INTO interpreter_reports (
                appointment_id, interpreter_id, hours, report_text,
                approval_status, approved_at
           ) VALUES (
                $1, $2, 2.0, 'Approved report',
                'approved', now()
           )"#,
    )
    .bind(appointment_id)
    .bind(interpreter_id)
    .execute(pool)
    .await
    .unwrap();
}

#[allow(clippy::too_many_arguments)]
async fn seed_concierge_service(
    pool: &PgPool,
    patient_id: Uuid,
    concierge_id: Uuid,
    created_by: Uuid,
    tag: &str,
    status: &str,
    billing_status: &str,
    request_source: &str,
    completed: bool,
) {
    sqlx::query(
        r#"INSERT INTO concierge_services (
                patient_id, assigned_concierge_id, service_kind, title, status,
                billing_status, request_source, completed_at, created_by
           ) VALUES (
                $1, $2, 'transfer', $3, $4,
                $5, $6,
                CASE WHEN $7 THEN now() ELSE NULL END,
                $8
           )"#,
    )
    .bind(patient_id)
    .bind(concierge_id)
    .bind(format!("Concierge {tag} {status}"))
    .bind(status)
    .bind(billing_status)
    .bind(request_source)
    .bind(completed)
    .bind(created_by)
    .execute(pool)
    .await
    .unwrap();
}

#[allow(clippy::too_many_arguments)]
async fn seed_provider_concierge_service(
    pool: &PgPool,
    patient_id: Uuid,
    provider_id: Uuid,
    concierge_id: Uuid,
    created_by: Uuid,
    tag: &str,
    status: &str,
    billing_status: &str,
    vendor_name: &str,
    service_kind: &str,
) {
    sqlx::query(
        r#"INSERT INTO concierge_services (
                patient_id, provider_id, assigned_concierge_id, service_kind, title, status,
                vendor_name, billing_status, completed_at, created_by
           ) VALUES (
                $1, $2, $3, $4, $5, $6,
                $7, $8,
                CASE WHEN $6 = 'completed' THEN now() ELSE NULL END,
                $9
           )"#,
    )
    .bind(patient_id)
    .bind(provider_id)
    .bind(concierge_id)
    .bind(service_kind)
    .bind(format!("{tag} {service_kind}"))
    .bind(status)
    .bind(vendor_name)
    .bind(billing_status)
    .bind(created_by)
    .execute(pool)
    .await
    .unwrap();
}

async fn seed_feedback(
    pool: &PgPool,
    patient_id: Uuid,
    provider_id: Uuid,
    patient_manager_id: Uuid,
    interpreter_id: Uuid,
    concierge_id: Uuid,
    submitted_by: Uuid,
) {
    sqlx::query(
        r#"INSERT INTO patient_feedback_forms (
                patient_id, provider_id, patient_manager_id, interpreter_id, concierge_id,
                submitted_by, source, status, overall_score, patient_manager_score,
                interpreter_score, concierge_score, treatment_score, doctor_score,
                organization_score, service_score, infrastructure_score, price_value_score,
                treatment_success, complication_reported, nps_score
           ) VALUES (
                $1, $2, $3, $4, $5,
                $6, 'staff_capture', 'reviewed', 5, 5,
                4, 5, 5, 5,
                4, 5, 4, 4,
                'yes', false, 10
           )"#,
    )
    .bind(patient_id)
    .bind(provider_id)
    .bind(patient_manager_id)
    .bind(interpreter_id)
    .bind(concierge_id)
    .bind(submitted_by)
    .execute(pool)
    .await
    .unwrap();
}

async fn seed_appointment_arztbrief(
    pool: &PgPool,
    patient_id: Uuid,
    order_id: Uuid,
    appointment_id: Uuid,
    uploaded_by: Uuid,
    tag: &str,
    turnaround_hours: i32,
) {
    sqlx::query(
        r#"INSERT INTO documents (
                patient_id, order_id, appointment_id, auto_name, original_filename,
                art, category, status, visibility, is_medical, mime_type, file_size,
                storage_key, uploaded_by, created_at
           )
           SELECT
                $1, $2, $3, $4, $5,
                'arztbrief', 'medical', 'active', 'released_external', true, 'application/pdf', 1024,
                $6, $7,
                ((a.date::timestamp + COALESCE(a.time_end, a.time_start, TIME '00:00')) AT TIME ZONE 'UTC')
                    + ($8::int * interval '1 hour')
           FROM appointments a
           WHERE a.id = $3"#,
    )
    .bind(patient_id)
    .bind(order_id)
    .bind(appointment_id)
    .bind(format!("{tag}-arztbrief"))
    .bind(format!("{tag}-arztbrief.pdf"))
    .bind(format!("documents/{tag}-arztbrief.pdf"))
    .bind(uploaded_by)
    .bind(turnaround_hours)
    .execute(pool)
    .await
    .unwrap();
}

#[allow(clippy::too_many_arguments)]
async fn seed_appointment_communication(
    pool: &PgPool,
    appointment_id: Uuid,
    patient_id: Uuid,
    provider_id: Option<Uuid>,
    doctor_id: Option<Uuid>,
    created_by: Uuid,
    target_type: &str,
    status: &str,
    created_hours_ago: i32,
    responded_hours_ago: Option<i32>,
) {
    sqlx::query(
        r#"INSERT INTO appointment_communications (
                appointment_id, patient_id, provider_id, doctor_id,
                target_type, direction, channel, status, subject,
                created_by, created_at, responded_at, closed_at
           ) VALUES (
                $1, $2, $3, $4,
                $5, 'outbound', 'email', $6, $7,
                $8,
                now() - ($9::int * interval '1 hour'),
                CASE
                    WHEN $10::int IS NULL THEN NULL
                    ELSE now() - ($10::int * interval '1 hour')
                END,
                CASE
                    WHEN $6 = 'closed' THEN COALESCE(
                        CASE
                            WHEN $10::int IS NULL THEN NULL
                            ELSE now() - ($10::int * interval '1 hour')
                        END,
                        now()
                    )
                    ELSE NULL
                END
           )"#,
    )
    .bind(appointment_id)
    .bind(patient_id)
    .bind(provider_id)
    .bind(doctor_id)
    .bind(target_type)
    .bind(status)
    .bind(format!("{target_type} communication"))
    .bind(created_by)
    .bind(created_hours_ago)
    .bind(responded_hours_ago)
    .execute(pool)
    .await
    .unwrap();
}

#[tokio::test]
async fn ceo_dashboard_exposes_supported_finance_operational_and_feedback_kpis() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("ceo-dashboard");
    let ceo_id = seed_user(&pool, &format!("{tag}-ceo"), "ceo").await;
    let pm_id = seed_user(&pool, &format!("{tag}-pm"), "patient_manager").await;
    let interpreter_id = seed_user(&pool, &format!("{tag}-interp"), "interpreter").await;
    let concierge_id = seed_user(&pool, &format!("{tag}-concierge"), "concierge").await;

    let patient_a = seed_patient(&pool, admin_id, &format!("{tag}-ua"), "UA").await;
    let patient_b = seed_patient(&pool, admin_id, &format!("{tag}-de"), "DE").await;
    seed_patient_assignment(&pool, patient_a, pm_id, admin_id).await;
    seed_patient_assignment(&pool, patient_b, pm_id, admin_id).await;

    let provider_id = seed_provider(&pool, &tag).await;

    let order_a_active =
        seed_order(&pool, patient_a, admin_id, &format!("{tag}-a1"), "active").await;
    let order_a_completed = seed_order(
        &pool,
        patient_a,
        admin_id,
        &format!("{tag}-a2"),
        "completed",
    )
    .await;
    let order_b_active =
        seed_order(&pool, patient_b, admin_id, &format!("{tag}-b1"), "active").await;

    seed_order_service(
        &pool,
        order_a_active,
        provider_id,
        None,
        &format!("{tag}-svc-a"),
        1200,
    )
    .await;
    seed_order_service(
        &pool,
        order_b_active,
        provider_id,
        None,
        &format!("{tag}-svc-b"),
        900,
    )
    .await;

    seed_invoice(
        &pool,
        order_a_active,
        patient_a,
        admin_id,
        &format!("{tag}-paid"),
        "paid",
        1200,
        1200,
        "CURRENT_DATE + 5",
        "now()",
    )
    .await;
    seed_invoice(
        &pool,
        order_b_active,
        patient_b,
        admin_id,
        &format!("{tag}-overdue"),
        "overdue",
        900,
        0,
        "CURRENT_DATE - 7",
        "NULL",
    )
    .await;

    seed_task(
        &pool,
        pm_id,
        admin_id,
        patient_a,
        order_a_active,
        &format!("PM task {tag}"),
        "now() - interval '1 day'",
    )
    .await;
    seed_workflow_item(
        &pool,
        patient_a,
        order_a_active,
        pm_id,
        admin_id,
        &tag,
        "pm-open",
        false,
    )
    .await;
    seed_workflow_item(
        &pool,
        patient_a,
        order_a_active,
        pm_id,
        admin_id,
        &tag,
        "pm-complete",
        true,
    )
    .await;

    let appointment_id = seed_appointment(
        &pool,
        patient_a,
        provider_id,
        None,
        order_a_active,
        interpreter_id,
        pm_id,
        admin_id,
        &tag,
    )
    .await;
    seed_interpreter_report(&pool, appointment_id, interpreter_id).await;

    seed_concierge_service(
        &pool,
        patient_a,
        concierge_id,
        admin_id,
        &format!("{tag}-active"),
        "planned",
        "draft",
        "patient_portal",
        false,
    )
    .await;
    seed_concierge_service(
        &pool,
        patient_a,
        concierge_id,
        admin_id,
        &format!("{tag}-done"),
        "completed",
        "ready",
        "staff",
        true,
    )
    .await;

    seed_feedback(
        &pool,
        patient_a,
        provider_id,
        pm_id,
        interpreter_id,
        concierge_id,
        admin_id,
    )
    .await;

    let (status, body) = json_request(
        &app,
        "GET",
        "/api/v1/stats/ceo/dashboard",
        &auth_header_for(ceo_id, "ceo"),
        None,
    )
    .await;

    assert_eq!(status, StatusCode::OK);
    assert!(body["summary"]["invoiced_this_month"].as_str().is_some());
    assert!(body["summary"]["on_time_payment_rate_pct"].is_number());
    assert!(
        body["summary"]["new_patients_this_month"]
            .as_i64()
            .unwrap_or_default()
            >= 2
    );
    assert!(
        body["summary"]["active_patients_under_care"]
            .as_i64()
            .unwrap_or_default()
            >= 2
    );
    assert!(
        body["summary"]["returning_patients"]
            .as_i64()
            .unwrap_or_default()
            >= 1
    );

    let countries = body["countries"].as_array().unwrap();
    assert!(countries.iter().any(|item| item["country"] == "UA"));
    assert!(countries.iter().any(|item| item["country"] == "DE"));

    let service_mix = body["service_mix"].as_array().unwrap();
    assert!(
        service_mix
            .iter()
            .any(|item| item["service_type"] == "medical")
    );

    let pm_name = format!("patient_manager {tag}-pm");
    let pm_rows = body["patient_manager_kpis"].as_array().unwrap();
    let pm_row = pm_rows
        .iter()
        .find(|item| item["name"] == pm_name)
        .expect("expected seeded PM KPI row");
    assert!(pm_row["active_patients"].as_i64().unwrap_or_default() >= 2);
    assert!(pm_row["open_tasks"].as_i64().unwrap_or_default() >= 1);
    assert!(pm_row["checklist_completion_rate_pct"].is_number());

    let interpreter_name = format!("interpreter {tag}-interp");
    let interpreter_rows = body["interpreter_kpis"].as_array().unwrap();
    let interpreter_row = interpreter_rows
        .iter()
        .find(|item| item["name"] == interpreter_name)
        .expect("expected seeded interpreter KPI row");
    assert_eq!(interpreter_row["approved_hours_30d"], "2");
    assert_eq!(interpreter_row["booked_hours_30d"], "2");
    assert!(
        interpreter_row["utilization_rate_pct"]
            .as_f64()
            .unwrap_or_default()
            >= 100.0
    );

    let concierge_name = format!("concierge {tag}-concierge");
    let concierge_rows = body["concierge_kpis"].as_array().unwrap();
    let concierge_row = concierge_rows
        .iter()
        .find(|item| item["name"] == concierge_name)
        .expect("expected seeded concierge KPI row");
    assert!(
        concierge_row["active_services"]
            .as_i64()
            .unwrap_or_default()
            >= 1
    );
    assert!(
        concierge_row["ready_for_billing"]
            .as_i64()
            .unwrap_or_default()
            >= 1
    );

    let provider_name = format!("Clinic {tag}");
    let provider_rows = body["provider_kpis"].as_array().unwrap();
    let provider_row = provider_rows
        .iter()
        .find(|item| item["name"] == provider_name)
        .expect("expected seeded provider KPI row");
    assert!(
        provider_row["appointments_90d"]
            .as_i64()
            .unwrap_or_default()
            >= 1
    );
    assert_ne!(provider_row["gross_service_volume"], "0");

    let _ = order_a_completed;
}

#[tokio::test]
async fn ceo_dashboard_is_forbidden_for_patient_manager() {
    let Some((app, pool, _admin_id)) = test_context().await else {
        return;
    };

    let pm_id = seed_user(
        &pool,
        &unique_tag("ceo-dashboard-forbidden"),
        "patient_manager",
    )
    .await;
    let (status, _) = json_request(
        &app,
        "GET",
        "/api/v1/stats/ceo/dashboard",
        &auth_header_for(pm_id, "patient_manager"),
        None,
    )
    .await;

    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn sales_cannot_access_executive_risk_or_restricted_exports() {
    let Some((app, pool, _admin_id)) = test_context().await else {
        return;
    };

    let sales_id = seed_user(&pool, &unique_tag("sales-rbac"), "sales").await;
    let sales_auth = auth_header_for(sales_id, "sales");

    let (status, _) = json_request(
        &app,
        "GET",
        "/api/v1/stats/ceo/dashboard",
        &sales_auth,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    let (status, _) = json_request(
        &app,
        "GET",
        "/api/v1/stats/risk-analysis",
        &sales_auth,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    let (status, _, _, _) = text_request(
        &app,
        "GET",
        "/api/v1/stats/reports/export?section=clinics",
        &sales_auth,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    let (status, _, _, _) = text_request(
        &app,
        "GET",
        "/api/v1/stats/reports/export?section=doctors",
        &sales_auth,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn ceo_can_open_risk_analysis_workspace() {
    let Some((app, pool, _admin_id)) = test_context().await else {
        return;
    };

    let ceo_id = seed_user(&pool, &unique_tag("ceo-risk"), "ceo").await;

    let (status, body) = json_request(
        &app,
        "GET",
        "/api/v1/stats/risk-analysis",
        &auth_header_for(ceo_id, "ceo"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(
        body["allowed_sections"]
            .as_array()
            .unwrap()
            .iter()
            .any(|value| value == "patient_manager")
    );
    assert!(
        body["allowed_sections"]
            .as_array()
            .unwrap()
            .iter()
            .any(|value| value == "billing")
    );
}

#[tokio::test]
async fn reports_workspace_returns_role_scoped_sections() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("reports-workspace");
    let sales_id = seed_user(&pool, &format!("{tag}-sales"), "sales").await;
    let billing_id = seed_user(&pool, &format!("{tag}-billing"), "billing").await;
    let concierge_id = seed_user(&pool, &format!("{tag}-concierge"), "concierge").await;

    let patient_id = seed_patient(&pool, admin_id, &tag, "UA").await;
    let provider_id = seed_provider(&pool, &tag).await;
    let doctor_id = seed_doctor(&pool, provider_id, &tag).await;
    let order_id = seed_order(&pool, patient_id, admin_id, &tag, "active").await;
    seed_order_service(&pool, order_id, provider_id, Some(doctor_id), &tag, 1400).await;
    let appointment_id = seed_appointment(
        &pool,
        patient_id,
        provider_id,
        Some(doctor_id),
        order_id,
        admin_id,
        admin_id,
        admin_id,
        &format!("{tag}-doctor"),
    )
    .await;
    seed_invoice(
        &pool,
        order_id,
        patient_id,
        admin_id,
        &format!("{tag}-invoice"),
        "sent",
        1400,
        0,
        "CURRENT_DATE + 14",
        "NULL",
    )
    .await;
    sqlx::query(
        r#"INSERT INTO order_followup_flows (
                order_id, doctor_followup_status, followup_1w_status, followup_1m_status,
                followup_6m_status, package_end_status, results_handoff_status
           ) VALUES (
                $1, 'completed', 'completed', 'completed',
                'completed', 'not_required', 'completed'
           )
           ON CONFLICT (order_id) DO UPDATE
           SET doctor_followup_status = EXCLUDED.doctor_followup_status,
               followup_1w_status = EXCLUDED.followup_1w_status,
               followup_1m_status = EXCLUDED.followup_1m_status,
               followup_6m_status = EXCLUDED.followup_6m_status,
               package_end_status = EXCLUDED.package_end_status,
               results_handoff_status = EXCLUDED.results_handoff_status"#,
    )
    .bind(order_id)
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        r#"INSERT INTO patient_feedback_forms (
                patient_id, appointment_id, provider_id, doctor_id, patient_manager_id,
                submitted_by, source, status, overall_score, treatment_score, doctor_score,
                organization_score, service_score, infrastructure_score, price_value_score,
                treatment_success, complication_reported, nps_score, comments
           ) VALUES (
                $1, $2, $3, $4, $5,
                $5, 'staff_capture', 'reviewed', 5, 4, 5,
                4, 5, 3, 4,
                'yes', false, 9, 'High quality provider experience'
           )"#,
    )
    .bind(patient_id)
    .bind(appointment_id)
    .bind(provider_id)
    .bind(doctor_id)
    .bind(admin_id)
    .execute(&pool)
    .await
    .unwrap();
    seed_appointment_arztbrief(
        &pool,
        patient_id,
        order_id,
        appointment_id,
        admin_id,
        &tag,
        36,
    )
    .await;
    seed_appointment_communication(
        &pool,
        appointment_id,
        patient_id,
        Some(provider_id),
        Some(doctor_id),
        admin_id,
        "clinic",
        "answered",
        30,
        Some(6),
    )
    .await;
    seed_appointment_communication(
        &pool,
        appointment_id,
        patient_id,
        Some(provider_id),
        Some(doctor_id),
        admin_id,
        "doctor",
        "answered",
        34,
        Some(4),
    )
    .await;
    seed_appointment_communication(
        &pool,
        appointment_id,
        patient_id,
        Some(provider_id),
        Some(doctor_id),
        admin_id,
        "doctor",
        "sent",
        5,
        None,
    )
    .await;

    let non_medical_provider_id =
        seed_provider_with_type(&pool, &format!("{tag}-travel"), "non_medical").await;
    seed_provider_service(&pool, non_medical_provider_id, "Airport transfer").await;
    seed_order_service(
        &pool,
        order_id,
        non_medical_provider_id,
        None,
        &format!("{tag}-travel"),
        300,
    )
    .await;
    let _ = seed_non_medical_appointment(
        &pool,
        patient_id,
        non_medical_provider_id,
        order_id,
        concierge_id,
        admin_id,
        &format!("{tag}-travel"),
    )
    .await;
    seed_provider_concierge_service(
        &pool,
        patient_id,
        non_medical_provider_id,
        concierge_id,
        admin_id,
        &format!("{tag}-travel-open"),
        "planned",
        "draft",
        "Elite Drives",
        "transfer",
    )
    .await;
    seed_provider_concierge_service(
        &pool,
        patient_id,
        non_medical_provider_id,
        concierge_id,
        admin_id,
        &format!("{tag}-travel-done"),
        "completed",
        "ready",
        "Sky Lounge",
        "vip_terminal",
    )
    .await;
    seed_feedback(
        &pool,
        patient_id,
        non_medical_provider_id,
        admin_id,
        admin_id,
        concierge_id,
        admin_id,
    )
    .await;

    let (sales_status, sales_body) = json_request(
        &app,
        "GET",
        "/api/v1/stats/reports/workspace",
        &auth_header_for(sales_id, "sales"),
        None,
    )
    .await;
    assert_eq!(sales_status, StatusCode::OK);
    assert!(
        !sales_body["financial_metrics_visible"]
            .as_bool()
            .unwrap_or(true)
    );
    assert!(
        sales_body["allowed_sections"]
            .as_array()
            .unwrap()
            .iter()
            .any(|value| value == "countries")
    );
    assert!(
        sales_body["allowed_sections"]
            .as_array()
            .unwrap()
            .iter()
            .any(|value| value == "service_types")
    );
    assert!(
        sales_body["allowed_sections"]
            .as_array()
            .unwrap()
            .iter()
            .all(|value| value != "clinics")
    );
    assert!(
        sales_body["allowed_sections"]
            .as_array()
            .unwrap()
            .iter()
            .all(|value| value != "doctors")
    );
    assert!(
        sales_body["allowed_sections"]
            .as_array()
            .unwrap()
            .iter()
            .any(|value| value == "non_medical_providers")
    );
    assert!(
        sales_body["countries"]
            .as_array()
            .unwrap()
            .iter()
            .any(|row| row["country"] == "UA")
    );
    assert_eq!(sales_body["service_types"][0]["gross_total"], Value::Null);
    let non_medical_sales_row = sales_body["non_medical_providers"]
        .as_array()
        .unwrap()
        .iter()
        .find(|row| row["provider_id"] == non_medical_provider_id.to_string())
        .expect("expected non medical provider report row for sales");
    assert_eq!(non_medical_sales_row["gross_service_volume"], Value::Null);
    assert_eq!(non_medical_sales_row["service_count"], 1);

    let (billing_status, billing_body) = json_request(
        &app,
        "GET",
        "/api/v1/stats/reports/workspace",
        &auth_header_for(billing_id, "billing"),
        None,
    )
    .await;
    assert_eq!(billing_status, StatusCode::OK);
    assert!(
        billing_body["financial_metrics_visible"]
            .as_bool()
            .unwrap_or(false)
    );
    assert!(
        billing_body["allowed_sections"]
            .as_array()
            .unwrap()
            .iter()
            .any(|value| value == "clinics")
    );
    assert!(
        billing_body["allowed_sections"]
            .as_array()
            .unwrap()
            .iter()
            .any(|value| value == "service_types")
    );
    assert!(
        billing_body["allowed_sections"]
            .as_array()
            .unwrap()
            .iter()
            .any(|value| value == "doctors")
    );
    assert!(
        billing_body["allowed_sections"]
            .as_array()
            .unwrap()
            .iter()
            .any(|value| value == "non_medical_providers")
    );
    assert!(
        billing_body["clinics"]
            .as_array()
            .unwrap()
            .iter()
            .any(|row| row["name"] == format!("Clinic {tag}"))
    );
    assert!(
        billing_body["clinics"]
            .as_array()
            .unwrap()
            .iter()
            .any(|row| row["doctor_count"].as_i64().unwrap_or_default() >= 1)
    );
    let clinic_row = billing_body["clinics"]
        .as_array()
        .unwrap()
        .iter()
        .find(|row| row["name"] == format!("Clinic {tag}"))
        .expect("expected clinic report row");
    assert_eq!(clinic_row["feedback_count"], 1);
    assert_eq!(clinic_row["avg_treatment_score"], 4.0);
    assert_eq!(clinic_row["avg_doctor_score"], 5.0);
    assert_eq!(clinic_row["avg_organization_score"], 4.0);
    assert_eq!(clinic_row["avg_service_score"], 5.0);
    assert_eq!(clinic_row["avg_infrastructure_score"], 3.0);
    assert_eq!(clinic_row["avg_price_value_score"], 4.0);
    assert_eq!(clinic_row["treatment_success_yes_rate"], 100.0);
    assert_eq!(clinic_row["complication_rate"], 0.0);
    assert_eq!(clinic_row["avg_response_hours"], 24.0);
    assert_eq!(clinic_row["avg_findings_turnaround_hours"], 36.0);
    assert_eq!(clinic_row["findings_sample_count"], 1);
    assert_eq!(clinic_row["response_sample_count"], 1);
    assert_eq!(clinic_row["open_communication_count"], 0);
    assert_eq!(clinic_row["followup_completed_orders"], 1);
    assert_eq!(clinic_row["followup_orders_total"], 1);
    assert_eq!(clinic_row["followup_completion_rate"], 100.0);
    let doctor_rows = billing_body["doctors"].as_array().unwrap();
    assert!(
        doctor_rows
            .iter()
            .any(|row| row["name"] == format!("Doctor {tag}")
                && row["provider_id"] == provider_id.to_string())
    );
    assert_eq!(
        billing_body["service_types"][0]["gross_total"]
            .as_str()
            .unwrap_or_default(),
        "1666"
    );
    let doctor_row = doctor_rows
        .iter()
        .find(|row| row["name"] == format!("Doctor {tag}"))
        .expect("expected doctor report row");
    assert_eq!(
        doctor_row["gross_service_volume"]
            .as_str()
            .unwrap_or_default(),
        "1666"
    );
    assert_eq!(doctor_row["feedback_count"], 1);
    assert_eq!(doctor_row["avg_treatment_score"], 4.0);
    assert_eq!(doctor_row["avg_doctor_score"], 5.0);
    assert_eq!(doctor_row["avg_organization_score"], 4.0);
    assert_eq!(doctor_row["avg_service_score"], 5.0);
    assert_eq!(doctor_row["avg_infrastructure_score"], 3.0);
    assert_eq!(doctor_row["avg_price_value_score"], 4.0);
    assert_eq!(doctor_row["treatment_success_yes_rate"], 100.0);
    assert_eq!(doctor_row["complication_rate"], 0.0);
    assert_eq!(doctor_row["avg_response_hours"], 30.0);
    assert_eq!(doctor_row["avg_findings_turnaround_hours"], 36.0);
    assert_eq!(doctor_row["findings_sample_count"], 1);
    assert_eq!(doctor_row["response_sample_count"], 1);
    assert_eq!(doctor_row["open_communication_count"], 1);
    assert_eq!(doctor_row["followup_completed_orders"], 1);
    assert_eq!(doctor_row["followup_orders_total"], 1);
    assert_eq!(doctor_row["followup_completion_rate"], 100.0);
    let non_medical_row = billing_body["non_medical_providers"]
        .as_array()
        .unwrap()
        .iter()
        .find(|row| row["provider_id"] == non_medical_provider_id.to_string())
        .expect("expected non medical provider report row");
    assert_eq!(non_medical_row["service_count"], 1);
    assert_eq!(non_medical_row["appointments_90d"], 1);
    assert_eq!(non_medical_row["concierge_requests_90d"], 2);
    assert_eq!(non_medical_row["open_concierge_requests"], 1);
    assert_eq!(non_medical_row["completed_concierge_requests_90d"], 1);
    assert_eq!(non_medical_row["feedback_count"], 1);
    assert_eq!(non_medical_row["avg_concierge_score"], 5.0);
    assert_eq!(
        non_medical_row["gross_service_volume"]
            .as_str()
            .unwrap_or_default(),
        "357"
    );
    assert!(
        non_medical_row["service_focus"]
            .as_array()
            .unwrap()
            .iter()
            .any(|value| value == "Airport transfer")
    );

    let (export_status, export_body, content_type, content_disposition) = text_request(
        &app,
        "GET",
        &format!("/api/v1/stats/reports/export?section=doctors&provider_id={provider_id}"),
        &auth_header_for(billing_id, "billing"),
    )
    .await;
    assert_eq!(export_status, StatusCode::OK);
    assert!(content_type.unwrap_or_default().contains("text/csv"));
    assert!(
        content_disposition
            .unwrap_or_default()
            .contains("doctor-report.csv")
    );
    assert!(export_body.contains(&format!("Clinic {tag}")));
    assert!(export_body.contains(&format!("Doctor {tag}")));
    assert!(export_body.contains("avg_response_hours"));
    assert!(export_body.contains("avg_findings_turnaround_hours"));
    assert!(export_body.contains("treatment_success_yes_rate"));
    assert!(export_body.contains("followup_completion_rate"));
    assert!(export_body.contains("100.0"));

    let (non_medical_export_status, non_medical_export_body, content_type, content_disposition) =
        text_request(
            &app,
            "GET",
            "/api/v1/stats/reports/export?section=non_medical_providers",
            &auth_header_for(billing_id, "billing"),
        )
        .await;
    assert_eq!(non_medical_export_status, StatusCode::OK);
    assert!(content_type.unwrap_or_default().contains("text/csv"));
    assert!(
        content_disposition
            .unwrap_or_default()
            .contains("non-medical-provider-report.csv")
    );
    assert!(non_medical_export_body.contains("Airport transfer"));
    assert!(non_medical_export_body.contains("Elite Drives"));
    assert!(non_medical_export_body.contains("concierge_score"));
}

#[tokio::test]
async fn forecasting_workspace_returns_pipeline_collection_followup_and_capacity_signals() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("forecasting");
    let ceo_id = seed_user(&pool, &format!("{tag}-ceo"), "ceo").await;
    let sales_id = seed_user(&pool, &format!("{tag}-sales"), "sales").await;
    let patient_id = seed_patient(&pool, admin_id, &tag, "UA").await;
    let provider_id = seed_provider(&pool, &tag).await;
    let doctor_id = seed_doctor(&pool, provider_id, &tag).await;
    let order_id = seed_order(&pool, patient_id, admin_id, &tag, "active").await;

    seed_order_service(&pool, order_id, provider_id, Some(doctor_id), &tag, 1800).await;
    seed_quote(
        &pool,
        order_id,
        admin_id,
        &format!("{tag}-draft"),
        "draft",
        1500,
        "CURRENT_DATE + 10",
    )
    .await;
    seed_quote(
        &pool,
        order_id,
        admin_id,
        &format!("{tag}-sent"),
        "sent",
        2400,
        "CURRENT_DATE + 5",
    )
    .await;
    seed_invoice(
        &pool,
        order_id,
        patient_id,
        admin_id,
        &format!("{tag}-due"),
        "sent",
        1100,
        0,
        "CURRENT_DATE + 7",
        "NULL",
    )
    .await;
    seed_invoice(
        &pool,
        order_id,
        patient_id,
        admin_id,
        &format!("{tag}-overdue"),
        "overdue",
        900,
        0,
        "CURRENT_DATE - 9",
        "NULL",
    )
    .await;

    sqlx::query(
        r#"INSERT INTO order_debt_management (
                order_id, status, note, next_review_at
           ) VALUES (
                $1, 'payment_plan', 'Installments agreed', now() + interval '3 day'
           )
           ON CONFLICT (order_id) DO UPDATE
           SET status = EXCLUDED.status,
               note = EXCLUDED.note,
               next_review_at = EXCLUDED.next_review_at"#,
    )
    .bind(order_id)
    .execute(&pool)
    .await
    .unwrap();

    sqlx::query(
        r#"INSERT INTO order_followup_flows (
                order_id, doctor_followup_status, followup_1w_status, followup_1m_status,
                package_end_date, package_end_status, results_handoff_status
           ) VALUES (
                $1, 'pending', 'pending', 'pending',
                CURRENT_DATE + 20, 'pending', 'pending'
           )
           ON CONFLICT (order_id) DO UPDATE
           SET doctor_followup_status = EXCLUDED.doctor_followup_status,
               followup_1w_status = EXCLUDED.followup_1w_status,
               followup_1m_status = EXCLUDED.followup_1m_status,
               package_end_date = EXCLUDED.package_end_date,
               package_end_status = EXCLUDED.package_end_status,
               results_handoff_status = EXCLUDED.results_handoff_status"#,
    )
    .bind(order_id)
    .execute(&pool)
    .await
    .unwrap();

    sqlx::query(
        r#"INSERT INTO workflow_lifecycle_events (
                entity_type, entity_id, from_stage, to_stage, transition_kind, metadata, changed_by, created_at
           ) VALUES (
                'order', $1, 'execution', 'closure', 'advance_phase', '{}'::jsonb, $2,
                now() - interval '2 day'
           )"#,
    )
    .bind(order_id)
    .bind(admin_id)
    .execute(&pool)
    .await
    .unwrap();

    sqlx::query(
        r#"INSERT INTO appointments (
                patient_id, provider_id, doctor_id, order_id, owner_user_id,
                appointment_type, title, date, time_start, time_end, status, checklist_phase, created_by
           ) VALUES (
                $1, $2, $3, $4, $5,
                'medical', $6, CURRENT_DATE + 7, '09:00', '10:00', 'planned', 'followup', $5
           )"#,
    )
    .bind(patient_id)
    .bind(provider_id)
    .bind(doctor_id)
    .bind(order_id)
    .bind(admin_id)
    .bind(format!("Forecast follow-up {tag}"))
    .execute(&pool)
    .await
    .unwrap();

    let (status, body) = json_request(
        &app,
        "GET",
        "/api/v1/stats/forecasting",
        &auth_header_for(ceo_id, "ceo"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(
        body["allowed_sections"]
            .as_array()
            .unwrap()
            .iter()
            .any(|value| value == "quote_pipeline")
    );
    assert!(
        body["allowed_sections"]
            .as_array()
            .unwrap()
            .iter()
            .any(|value| value == "collections")
    );
    assert!(
        body["allowed_sections"]
            .as_array()
            .unwrap()
            .iter()
            .any(|value| value == "followup")
    );
    assert!(
        body["allowed_sections"]
            .as_array()
            .unwrap()
            .iter()
            .any(|value| value == "clinic_capacity")
    );
    assert!(body["summary"]["open_quotes"].as_i64().unwrap_or_default() >= 2);
    assert!(
        body["quote_pipeline"]["by_status"]
            .as_array()
            .unwrap()
            .iter()
            .any(|row| row["status"] == "sent")
    );
    assert!(
        body["collections"]["payment_plan_count"]
            .as_i64()
            .unwrap_or_default()
            >= 1
    );
    assert!(
        body["followup"]["milestones_due_next_30d"]
            .as_i64()
            .unwrap_or_default()
            >= 2
    );
    assert!(
        body["clinic_capacity"]["clinics"]
            .as_array()
            .unwrap()
            .iter()
            .any(|row| row["provider_id"] == provider_id.to_string())
    );

    let (sales_status, sales_body) = json_request(
        &app,
        "GET",
        "/api/v1/stats/forecasting",
        &auth_header_for(sales_id, "sales"),
        None,
    )
    .await;
    assert_eq!(sales_status, StatusCode::OK);
    assert!(
        sales_body["allowed_sections"]
            .as_array()
            .unwrap()
            .iter()
            .any(|value| value == "quote_pipeline")
    );
    assert!(
        sales_body["allowed_sections"]
            .as_array()
            .unwrap()
            .iter()
            .all(|value| value != "collections")
    );
    assert_eq!(sales_body["quote_pipeline"]["gross_total"], Value::Null);
}

#[tokio::test]
async fn forecasting_workspace_counts_package_end_followup_due_next_30_days() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("forecasting-package-end");
    let ceo_id = seed_user(&pool, &format!("{tag}-ceo"), "ceo").await;
    let patient_id = seed_patient(&pool, admin_id, &tag, "DE").await;
    let provider_id = seed_provider(&pool, &tag).await;
    let order_id = seed_order(&pool, patient_id, admin_id, &tag, "active").await;

    sqlx::query(
        r#"INSERT INTO order_followup_flows (
                order_id, doctor_followup_status, followup_1w_status, followup_1m_status,
                followup_6m_status, package_end_date, package_end_status, results_handoff_status
           ) VALUES (
                $1, 'completed', 'completed', 'completed',
                'completed', CURRENT_DATE + 12, 'scheduled', 'completed'
           )
           ON CONFLICT (order_id) DO UPDATE
           SET doctor_followup_status = EXCLUDED.doctor_followup_status,
               followup_1w_status = EXCLUDED.followup_1w_status,
               followup_1m_status = EXCLUDED.followup_1m_status,
               followup_6m_status = EXCLUDED.followup_6m_status,
               package_end_date = EXCLUDED.package_end_date,
               package_end_status = EXCLUDED.package_end_status,
               results_handoff_status = EXCLUDED.results_handoff_status"#,
    )
    .bind(order_id)
    .execute(&pool)
    .await
    .unwrap();

    sqlx::query(
        r#"INSERT INTO appointments (
                patient_id, provider_id, appointment_type, title, date, status, created_by
           ) VALUES (
                $1, $2, 'medical', $3, CURRENT_DATE + 45, 'planned', $4
           )"#,
    )
    .bind(patient_id)
    .bind(provider_id)
    .bind(format!("Out-of-window follow-up {tag}"))
    .bind(admin_id)
    .execute(&pool)
    .await
    .unwrap();

    let (status, body) = json_request(
        &app,
        "GET",
        "/api/v1/stats/forecasting",
        &auth_header_for(ceo_id, "ceo"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        body["followup"]["package_end_due_next_30d"]
            .as_i64()
            .unwrap_or_default(),
        1
    );
    assert_eq!(
        body["followup"]["followup_1w_due_next_30d"]
            .as_i64()
            .unwrap_or_default(),
        0
    );
    assert_eq!(
        body["followup"]["followup_1m_due_next_30d"]
            .as_i64()
            .unwrap_or_default(),
        0
    );
    assert_eq!(
        body["followup"]["followup_6m_due_next_30d"]
            .as_i64()
            .unwrap_or_default(),
        0
    );
    assert_eq!(
        body["followup"]["milestones_due_next_30d"]
            .as_i64()
            .unwrap_or_default(),
        1
    );
}

#[tokio::test]
async fn risk_analysis_returns_role_scoped_patient_manager_and_billing_signals() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("risk-analysis");
    let pm_id = seed_user(&pool, &format!("{tag}-pm"), "patient_manager").await;
    let billing_id = seed_user(&pool, &format!("{tag}-billing"), "billing").await;

    let patient_pm = seed_patient(&pool, admin_id, &format!("{tag}-pm-patient"), "UA").await;
    let patient_other = seed_patient(&pool, admin_id, &format!("{tag}-other-patient"), "DE").await;
    seed_patient_assignment(&pool, patient_pm, pm_id, admin_id).await;

    sqlx::query("UPDATE patients SET functional_labels = ARRAY['high_risk']::text[] WHERE id = $1")
        .bind(patient_pm)
        .execute(&pool)
        .await
        .unwrap();

    let provider_id = seed_provider(&pool, &tag).await;
    let order_pm = seed_order(
        &pool,
        patient_pm,
        admin_id,
        &format!("{tag}-pm-order"),
        "active",
    )
    .await;
    let order_other = seed_order(
        &pool,
        patient_other,
        admin_id,
        &format!("{tag}-other-order"),
        "active",
    )
    .await;

    seed_case(&pool, patient_pm, pm_id, &format!("{tag}-pm-case"), "open").await;
    seed_case(
        &pool,
        patient_other,
        admin_id,
        &format!("{tag}-other-case"),
        "open",
    )
    .await;
    seed_overdue_open_appointment(
        &pool,
        patient_pm,
        provider_id,
        None,
        order_pm,
        pm_id,
        admin_id,
        &format!("{tag}-pm-apt"),
    )
    .await;
    seed_overdue_open_appointment(
        &pool,
        patient_other,
        provider_id,
        None,
        order_other,
        admin_id,
        admin_id,
        &format!("{tag}-other-apt"),
    )
    .await;
    seed_task(
        &pool,
        pm_id,
        admin_id,
        patient_pm,
        order_pm,
        "PM overdue coordination",
        "now() - interval '2 days'",
    )
    .await;
    seed_workflow_item(
        &pool,
        patient_pm,
        order_pm,
        pm_id,
        admin_id,
        &tag,
        "pm_followup",
        false,
    )
    .await;
    sqlx::query(
        r#"UPDATE workflow_checklist_items
           SET due_date = now() - interval '1 day'
           WHERE patient_id = $1
             AND order_id = $2"#,
    )
    .bind(patient_pm)
    .bind(order_pm)
    .execute(&pool)
    .await
    .unwrap();

    seed_order_service(
        &pool,
        order_pm,
        provider_id,
        None,
        &format!("{tag}-service"),
        2400,
    )
    .await;
    seed_invoice(
        &pool,
        order_pm,
        patient_pm,
        admin_id,
        &format!("{tag}-invoice"),
        "overdue",
        1000,
        0,
        "CURRENT_DATE - 10",
        "NULL",
    )
    .await;

    let (pm_status, pm_body) = json_request(
        &app,
        "GET",
        "/api/v1/stats/risk-analysis",
        &auth_header_for(pm_id, "patient_manager"),
        None,
    )
    .await;
    assert_eq!(pm_status, StatusCode::OK);
    assert!(
        pm_body["allowed_sections"]
            .as_array()
            .unwrap()
            .iter()
            .any(|value| value == "patient_manager")
    );
    assert!(
        pm_body["allowed_sections"]
            .as_array()
            .unwrap()
            .iter()
            .all(|value| value != "billing")
    );
    assert!(pm_body["billing"].is_null());
    let pm_alerts = pm_body["patient_manager"]["alerts"].as_array().unwrap();
    assert!(
        pm_alerts
            .iter()
            .any(|row| row["patient_id"] == patient_pm.to_string())
    );
    assert!(
        pm_alerts
            .iter()
            .all(|row| row["patient_id"] != patient_other.to_string())
    );
    assert!(
        pm_body["patient_manager"]["summary"]["urgent_alerts"]
            .as_i64()
            .unwrap_or_default()
            >= 1
    );

    let (billing_status, billing_body) = json_request(
        &app,
        "GET",
        "/api/v1/stats/risk-analysis",
        &auth_header_for(billing_id, "billing"),
        None,
    )
    .await;
    assert_eq!(billing_status, StatusCode::OK);
    assert!(
        billing_body["allowed_sections"]
            .as_array()
            .unwrap()
            .iter()
            .any(|value| value == "billing")
    );
    assert!(
        billing_body["allowed_sections"]
            .as_array()
            .unwrap()
            .iter()
            .all(|value| value != "patient_manager")
    );
    assert!(billing_body["patient_manager"].is_null());
    let billing_alerts = billing_body["billing"]["alerts"].as_array().unwrap();
    assert!(
        billing_alerts
            .iter()
            .any(|row| row["order_id"] == order_pm.to_string())
    );
    assert!(
        billing_body["billing"]["summary"]["overdue_invoice_count"]
            .as_i64()
            .unwrap_or_default()
            >= 1
    );

    let (ceo_status, ceo_body) = json_request(
        &app,
        "GET",
        "/api/v1/stats/risk-analysis",
        &auth_header_for(admin_id, "ceo"),
        None,
    )
    .await;
    assert_eq!(ceo_status, StatusCode::OK);
    assert!(
        ceo_body["allowed_sections"]
            .as_array()
            .unwrap()
            .iter()
            .any(|value| value == "patient_manager")
    );
    assert!(
        ceo_body["allowed_sections"]
            .as_array()
            .unwrap()
            .iter()
            .any(|value| value == "billing")
    );
    assert!(ceo_body["patient_manager"].is_object());
    assert!(ceo_body["billing"].is_object());
}
