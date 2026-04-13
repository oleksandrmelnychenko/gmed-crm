use axum::body::Body;
use axum::http::{Request, StatusCode};
use chrono::{Duration, Utc};
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
    let app = gmed_server::build_app(state);
    Some((app, pool, admin_id))
}

async fn json_request(
    app: &axum::Router,
    method: &str,
    path: &str,
    bearer: &str,
    body: Option<Value>,
) -> (StatusCode, Value) {
    let req = Request::builder()
        .method(method)
        .uri(path)
        .header("Authorization", bearer)
        .header("Content-Type", "application/json")
        .body(match body {
            Some(v) => Body::from(serde_json::to_vec(&v).unwrap()),
            None => Body::empty(),
        })
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();
    let status = resp.status();
    let bytes = axum::body::to_bytes(resp.into_body(), 4 * 1024 * 1024)
        .await
        .unwrap();
    let value = serde_json::from_slice(&bytes).unwrap_or(json!(null));
    (status, value)
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

async fn create_lead(app: &axum::Router, bearer: &str, tag: &str) -> Uuid {
    let (status, body) = json_request(
        app,
        "POST",
        "/api/v1/leads",
        bearer,
        Some(json!({
            "first_name": format!("Lead {tag}"),
            "last_name": "Process",
            "email": format!("{tag}@example.com")
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    Uuid::parse_str(body["id"].as_str().unwrap()).unwrap()
}

async fn create_patient(app: &axum::Router, bearer: &str, tag: &str) -> Uuid {
    let (status, body) = json_request(
        app,
        "POST",
        "/api/v1/patients",
        bearer,
        Some(json!({
            "first_name": format!("First {tag}"),
            "last_name": format!("Last {tag}"),
            "birth_date": "1990-01-01",
            "gender": "diverse",
            "phone_primary": "+49 221 123456"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    Uuid::parse_str(body["id"].as_str().unwrap()).unwrap()
}

async fn create_order(app: &axum::Router, bearer: &str, patient_id: Uuid) -> Uuid {
    let (status, body) = json_request(
        app,
        "POST",
        "/api/v1/orders",
        bearer,
        Some(json!({
            "patient_id": patient_id,
            "needs_description": "Process gate order"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    Uuid::parse_str(body["id"].as_str().unwrap()).unwrap()
}

async fn insert_order_appointment(
    pool: &PgPool,
    order_id: Uuid,
    patient_id: Uuid,
    created_by: Uuid,
    checklist_phase: &str,
    status: &str,
) {
    sqlx::query(
        r#"INSERT INTO appointments (
                patient_id, order_id, appointment_type, title, date,
                status, checklist_phase, created_by
           ) VALUES (
                $1, $2, 'medical', $3, $4, $5, $6, $7
           )"#,
    )
    .bind(patient_id)
    .bind(order_id)
    .bind(format!("Lifecycle {checklist_phase} appointment"))
    .bind(Utc::now().date_naive())
    .bind(status)
    .bind(checklist_phase)
    .bind(created_by)
    .execute(pool)
    .await
    .unwrap();
}

struct AppointmentInsertContext<'a> {
    appointment_type: &'a str,
    checklist_phase: &'a str,
    status: &'a str,
    interpreter_id: Option<Uuid>,
    interpreter_response: Option<&'a str>,
}

async fn insert_order_appointment_with_context(
    pool: &PgPool,
    order_id: Uuid,
    patient_id: Uuid,
    created_by: Uuid,
    context: AppointmentInsertContext<'_>,
) {
    sqlx::query(
        r#"INSERT INTO appointments (
                patient_id, order_id, appointment_type, title, date,
                status, checklist_phase, created_by, interpreter_id, interpreter_response
           ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9, $10
           )"#,
    )
    .bind(patient_id)
    .bind(order_id)
    .bind(context.appointment_type)
    .bind(format!(
        "{} {} appointment",
        context.appointment_type, context.checklist_phase
    ))
    .bind(Utc::now().date_naive())
    .bind(context.status)
    .bind(context.checklist_phase)
    .bind(created_by)
    .bind(context.interpreter_id)
    .bind(context.interpreter_response)
    .execute(pool)
    .await
    .unwrap();
}

async fn insert_existing_order(
    pool: &PgPool,
    patient_id: Uuid,
    created_by: Uuid,
    tag: &str,
) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO orders (order_number, patient_id, needs_description, created_by)
           VALUES ($1, $2, $3, $4)
           RETURNING id"#,
    )
    .bind(format!("A-LEGACY-{tag}"))
    .bind(patient_id)
    .bind("Existing customer order")
    .bind(created_by)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn insert_patient_document(
    pool: &PgPool,
    patient_id: Uuid,
    uploaded_by: Uuid,
    art: &str,
    category: &str,
) {
    sqlx::query(
        r#"INSERT INTO documents (
                patient_id, auto_name, original_filename, art, category, uploaded_by
           ) VALUES (
                $1, $2, $3, $4, $5, $6
           )"#,
    )
    .bind(patient_id)
    .bind(format!("{art}-document"))
    .bind(format!("{art}.pdf"))
    .bind(art)
    .bind(category)
    .bind(uploaded_by)
    .execute(pool)
    .await
    .unwrap();
}

async fn insert_signed_framework_contract(
    pool: &PgPool,
    patient_id: Uuid,
    created_by: Uuid,
    tag: &str,
) {
    sqlx::query(
        r#"INSERT INTO framework_contracts (
                patient_id, contract_number, signed_at, valid_from, valid_to, status, created_by
           ) VALUES (
                $1, $2, now(), CURRENT_DATE - 7, CURRENT_DATE + 90, 'signed', $3
           )"#,
    )
    .bind(patient_id)
    .bind(format!("FC-{tag}"))
    .bind(created_by)
    .execute(pool)
    .await
    .unwrap();
}

async fn complete_order_workflow_group(pool: &PgPool, order_id: Uuid, checklist_key: &str) {
    sqlx::query(
        r#"UPDATE workflow_checklist_items
           SET is_completed = true,
               completed_at = now()
           WHERE order_id = $1
             AND checklist_key = $2"#,
    )
    .bind(order_id)
    .bind(checklist_key)
    .execute(pool)
    .await
    .unwrap();
}

async fn insert_interpreter_report(
    pool: &PgPool,
    appointment_id: Uuid,
    interpreter_id: Uuid,
    approved_by: Uuid,
) {
    sqlx::query(
        r#"INSERT INTO interpreter_reports (
                appointment_id, interpreter_id, hours, report_text, approval_status,
                approved_by, approved_at
           ) VALUES (
                $1, $2, 1.5, 'Execution support confirmed', 'approved', $3, now()
           )"#,
    )
    .bind(appointment_id)
    .bind(interpreter_id)
    .bind(approved_by)
    .execute(pool)
    .await
    .unwrap();
}

async fn insert_order_task(
    pool: &PgPool,
    order_id: Uuid,
    patient_id: Uuid,
    assigned_by: Uuid,
    title: &str,
) {
    sqlx::query(
        r#"INSERT INTO tasks (
                title, description, assigned_to, assigned_by, patient_id, order_id, priority, status
           ) VALUES (
                $1, 'Follow-up task', $2, $2, $3, $4, 'normal', 'open'
           )"#,
    )
    .bind(title)
    .bind(assigned_by)
    .bind(patient_id)
    .bind(order_id)
    .execute(pool)
    .await
    .unwrap();
}

#[tokio::test]
async fn qualifying_lead_requires_readiness_gates() {
    let Some((app, pool, _admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("lead-gates");
    let sales_id = seed_user(&pool, &tag, "sales").await;
    let sales_bearer = auth_header_for(sales_id, "sales");
    let lead_id = create_lead(&app, &sales_bearer, &tag).await;

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/leads/{lead_id}/qualify"),
        &sales_bearer,
        Some(json!({ "status": "qualified" })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert!(
        body["blocking_reasons"]
            .as_array()
            .unwrap()
            .iter()
            .any(|item| item.as_str().unwrap_or_default().contains("Compliance"))
    );
}

#[tokio::test]
async fn updating_lead_gates_allows_qualification_and_conversion() {
    let Some((app, pool, _admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("lead-convert");
    let pm_id = seed_user(&pool, &tag, "patient_manager").await;
    let pm_bearer = auth_header_for(pm_id, "patient_manager");
    let lead_id = create_lead(&app, &pm_bearer, &tag).await;

    let (status, updated) = json_request(
        &app,
        "POST",
        &format!("/api/v1/leads/{lead_id}/update"),
        &pm_bearer,
        Some(json!({
            "phone": "+49 30 123456",
            "primary_language": "de",
            "date_of_birth": "1987-05-12",
            "legal_sex": "female",
            "compliance_status": "signed",
            "consent_healthcare": true,
            "consent_privacy_practices": true
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(updated["readiness"]["qualification_ready"], true);

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/leads/{lead_id}/qualify"),
        &pm_bearer,
        Some(json!({ "status": "qualified" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (status, converted) = json_request(
        &app,
        "POST",
        &format!("/api/v1/leads/{lead_id}/convert"),
        &pm_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(converted["patient_id"].as_str().is_some());
}

#[tokio::test]
async fn overdue_debt_blocks_execution_even_with_billing_release() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("order-debt");
    let pm_id = seed_user(&pool, &tag, "patient_manager").await;
    let billing_id = seed_user(&pool, &tag, "billing").await;
    let pm_bearer = auth_header_for(pm_id, "patient_manager");
    let billing_bearer = auth_header_for(billing_id, "billing");
    let patient_id = create_patient(&app, &pm_bearer, &tag).await;
    let order_id = create_order(&app, &pm_bearer, patient_id).await;

    sqlx::query("UPDATE orders SET signed_patient = true, signed_agency = true WHERE id = $1")
        .bind(order_id)
        .execute(&pool)
        .await
        .unwrap();

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/orders/{order_id}/process-gates"),
        &billing_bearer,
        Some(json!({
            "billing_release_status": "granted",
            "billing_release_note": "Ready from billing"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    sqlx::query(
        r#"INSERT INTO invoices (
                order_id, patient_id, invoice_number, invoice_type, status, due_date,
                total_net, total_vat, total_gross, paid_amount, created_by
           )
           VALUES ($1, $2, $3, 'final', 'overdue', $4, 100, 0, 100, 0, $5)"#,
    )
    .bind(order_id)
    .bind(patient_id)
    .bind(format!("INV-DEBT-{}", Uuid::new_v4().simple()))
    .bind((Utc::now() - Duration::days(10)).date_naive())
    .bind(admin_id)
    .execute(&pool)
    .await
    .unwrap();

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/orders/{order_id}/phase"),
        &pm_bearer,
        Some(json!({ "phase": "execution" })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert!(
        body["blocking_reasons"]
            .as_array()
            .unwrap()
            .iter()
            .any(|item| item
                .as_str()
                .unwrap_or_default()
                .contains("debt-management hold"))
    );
}

#[tokio::test]
async fn debt_management_queue_and_order_detail_reflect_workflow_updates() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("debt-workflow");
    let pm_id = seed_user(&pool, &tag, "patient_manager").await;
    let billing_id = seed_user(&pool, &tag, "billing").await;
    let pm_bearer = auth_header_for(pm_id, "patient_manager");
    let billing_bearer = auth_header_for(billing_id, "billing");
    let patient_id = create_patient(&app, &pm_bearer, &tag).await;
    let order_id = create_order(&app, &pm_bearer, patient_id).await;

    sqlx::query(
        r#"INSERT INTO invoices (
                order_id, patient_id, invoice_number, invoice_type, status, due_date,
                total_net, total_vat, total_gross, paid_amount, created_by
           )
           VALUES ($1, $2, $3, 'final', 'overdue', $4, 100, 0, 100, 0, $5)"#,
    )
    .bind(order_id)
    .bind(patient_id)
    .bind(format!("INV-WORKFLOW-{}", Uuid::new_v4().simple()))
    .bind((Utc::now() - Duration::days(12)).date_naive())
    .bind(admin_id)
    .execute(&pool)
    .await
    .unwrap();

    let (status, queue) = json_request(
        &app,
        "GET",
        "/api/v1/orders/debt-management",
        &billing_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(
        queue
            .as_array()
            .unwrap()
            .iter()
            .any(|item| item["order_id"] == order_id.to_string())
    );

    let (status, gates) = json_request(
        &app,
        "POST",
        &format!("/api/v1/orders/{order_id}/debt-management"),
        &billing_bearer,
        Some(json!({
            "status": "payment_plan",
            "note": "Instalments agreed with patient",
            "owner_user_id": billing_id,
            "next_review_at": (Utc::now() + Duration::days(3)).to_rfc3339(),
            "last_contact_at": Utc::now().to_rfc3339(),
            "resolution_note": "Awaiting first transfer"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(gates["debt_management"]["status"], "payment_plan");
    assert_eq!(
        gates["debt_management"]["owner_user_id"],
        billing_id.to_string()
    );
    assert!(
        gates["debt_management"]["blocking_reason"]
            .as_str()
            .unwrap_or_default()
            .contains("payment-plan")
    );

    let (status, detail) = json_request(
        &app,
        "GET",
        &format!("/api/v1/orders/{order_id}"),
        &billing_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        detail["process_gates"]["debt_management"]["effective_status"],
        "payment_plan"
    );
    assert_eq!(
        detail["process_gates"]["debt_management"]["resolution_note"],
        "Awaiting first transfer"
    );
}

#[tokio::test]
async fn package_coverage_can_unblock_execution_for_repeat_order() {
    let Some((app, pool, _admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("order-package");
    let pm_id = seed_user(&pool, &tag, "patient_manager").await;
    let pm_bearer = auth_header_for(pm_id, "patient_manager");
    let patient_id = create_patient(&app, &pm_bearer, &tag).await;
    let order_id = create_order(&app, &pm_bearer, patient_id).await;

    let (status, gates) = json_request(
        &app,
        "POST",
        &format!("/api/v1/orders/{order_id}/process-gates"),
        &pm_bearer,
        Some(json!({
            "package_coverage_status": "covered",
            "package_coverage_note": "Existing package covers this order"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(gates["execution_ready"], true);

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/orders/{order_id}/phase"),
        &pm_bearer,
        Some(json!({ "phase": "execution" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
}

#[tokio::test]
async fn planning_preparation_blocks_execution_until_plan_slots_and_handoffs_are_ready() {
    let Some((app, pool, _admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("order-planning");
    let pm_id = seed_user(&pool, &tag, "patient_manager").await;
    let interpreter_id = seed_user(&pool, &tag, "interpreter").await;
    let pm_bearer = auth_header_for(pm_id, "patient_manager");
    let patient_id = create_patient(&app, &pm_bearer, &tag).await;
    let order_id = create_order(&app, &pm_bearer, patient_id).await;

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/orders/{order_id}/phase"),
        &pm_bearer,
        Some(json!({ "phase": "intake" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/orders/{order_id}/process-gates"),
        &pm_bearer,
        Some(json!({
            "package_coverage_status": "covered",
            "package_coverage_note": "Package already covers execution"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/orders/{order_id}/phase"),
        &pm_bearer,
        Some(json!({ "phase": "execution" })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert!(
        body["blocking_reasons"]
            .as_array()
            .unwrap()
            .iter()
            .any(|item| item.as_str().unwrap_or_default().contains("Treatment plan"))
    );

    let (status, planning) = json_request(
        &app,
        "POST",
        &format!("/api/v1/orders/{order_id}/planning-preparation"),
        &pm_bearer,
        Some(json!({
            "treatment_plan_status": "finalized",
            "treatment_plan_note": "Patient approved the treatment plan",
            "non_medical_required": true,
            "interpreter_required": true,
            "preparation_documents_status": "sent",
            "interpreter_briefing_status": "completed"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(planning["planning_ready"], false);
    assert_eq!(planning["interpreter_required"], true);

    insert_order_appointment_with_context(
        &pool,
        order_id,
        patient_id,
        pm_id,
        AppointmentInsertContext {
            appointment_type: "medical",
            checklist_phase: "preparation",
            status: "confirmed",
            interpreter_id: Some(interpreter_id),
            interpreter_response: Some("accepted"),
        },
    )
    .await;
    insert_order_appointment_with_context(
        &pool,
        order_id,
        patient_id,
        pm_id,
        AppointmentInsertContext {
            appointment_type: "non_medical",
            checklist_phase: "preparation",
            status: "confirmed",
            interpreter_id: None,
            interpreter_response: None,
        },
    )
    .await;

    let (status, detail) = json_request(
        &app,
        "GET",
        &format!("/api/v1/orders/{order_id}"),
        &pm_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(detail["planning_preparation"]["planning_ready"], true);
    assert_eq!(detail["planning_preparation"]["medical_confirmed"], 1);
    assert_eq!(detail["planning_preparation"]["non_medical_confirmed"], 1);
    assert_eq!(detail["planning_preparation"]["interpreter_confirmed"], 1);

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/orders/{order_id}/phase"),
        &pm_bearer,
        Some(json!({ "phase": "execution" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
}

#[tokio::test]
async fn existing_customer_recheck_reports_missing_data_and_debt_hold() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("patient-recheck-gap");
    let pm_id = seed_user(&pool, &tag, "patient_manager").await;
    let pm_bearer = auth_header_for(pm_id, "patient_manager");
    let patient_id = create_patient(&app, &pm_bearer, &tag).await;
    let legacy_order_id = insert_existing_order(&pool, patient_id, pm_id, &tag).await;

    sqlx::query(
        r#"INSERT INTO invoices (
                order_id, patient_id, invoice_number, invoice_type, status, due_date,
                total_net, total_vat, total_gross, paid_amount, created_by
           ) VALUES ($1, $2, $3, 'final', 'overdue', $4, 100, 0, 100, 0, $5)"#,
    )
    .bind(legacy_order_id)
    .bind(patient_id)
    .bind(format!("INV-RECHECK-{tag}"))
    .bind((Utc::now() - Duration::days(5)).date_naive())
    .bind(admin_id)
    .execute(&pool)
    .await
    .unwrap();

    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/patients/{patient_id}/recheck"),
        &pm_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["can_create_order"], false);
    assert_eq!(body["base_data_ready"], false);
    assert_eq!(body["debt_hold"], true);
    assert_eq!(body["overdue_invoice_count"], 1);
    assert!(
        body["base_data_missing_fields"]
            .as_array()
            .unwrap()
            .iter()
            .any(|item| item == "country")
    );
    assert!(
        body["blocking_reasons"]
            .as_array()
            .unwrap()
            .iter()
            .any(|item| item
                .as_str()
                .unwrap_or_default()
                .contains("debt-management hold"))
    );
}

#[tokio::test]
async fn create_order_is_blocked_until_existing_customer_recheck_passes() {
    let Some((app, pool, _admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("patient-recheck-create");
    let pm_id = seed_user(&pool, &tag, "patient_manager").await;
    let pm_bearer = auth_header_for(pm_id, "patient_manager");
    let patient_id = create_patient(&app, &pm_bearer, &tag).await;
    let _legacy_order_id = insert_existing_order(&pool, patient_id, pm_id, &tag).await;

    let (status, body) = json_request(
        &app,
        "POST",
        "/api/v1/orders",
        &pm_bearer,
        Some(json!({
            "patient_id": patient_id,
            "needs_description": "Repeat execution without re-check"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(body["message"], "Existing customer re-check is incomplete");
    assert_eq!(body["recheck"]["can_create_order"], false);

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/patients/{patient_id}/update"),
        &pm_bearer,
        Some(json!({
            "residence_country": "DE",
            "languages": ["de"],
            "legal_status": {
                "dsgvo_signed": true,
                "confidentiality_release_signed": true,
                "identity_verified": true,
                "document_pack_complete": true,
                "compliance_completed": true,
                "contract_status": "signed",
                "notes": "Existing customer re-check complete"
            }
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    insert_patient_document(&pool, patient_id, pm_id, "passport", "identity").await;
    insert_patient_document(&pool, patient_id, pm_id, "consent_form", "consent").await;
    insert_signed_framework_contract(&pool, patient_id, pm_id, &tag).await;

    let (status, recheck) = json_request(
        &app,
        "GET",
        &format!("/api/v1/patients/{patient_id}/recheck"),
        &pm_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(recheck["can_create_order"], true);
    assert_eq!(recheck["document_pack_ready"], true);
    assert_eq!(recheck["contract_ready"], true);

    let (status, created) = json_request(
        &app,
        "POST",
        "/api/v1/orders",
        &pm_bearer,
        Some(json!({
            "patient_id": patient_id,
            "needs_description": "Repeat execution after re-check"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    assert!(created["id"].as_str().is_some());
}

#[tokio::test]
async fn failed_lead_resolution_requires_controlled_flow_and_records_history() {
    let Some((app, pool, _admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("failed-lead-archive");
    let sales_id = seed_user(&pool, &tag, "sales").await;
    let sales_bearer = auth_header_for(sales_id, "sales");
    let lead_id = create_lead(&app, &sales_bearer, &tag).await;

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/leads/{lead_id}/qualify"),
        &sales_bearer,
        Some(json!({ "status": "archived" })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/leads/{lead_id}/failed-flow"),
        &sales_bearer,
        Some(json!({
            "resolution": "archive",
            "reason": "Patient no longer interested",
            "note": "Close after repeated outreach"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["failed_outcome"]["status"], "archived");
    assert_eq!(body["lifecycle"]["current_stage"], "archived");

    let (status, detail) = json_request(
        &app,
        "GET",
        &format!("/api/v1/leads/{lead_id}"),
        &sales_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(detail["qualification_status"], "archived");
    assert_eq!(
        detail["failed_outcome"]["reason"],
        "Patient no longer interested"
    );
    assert!(
        detail["lifecycle"]["history"]
            .as_array()
            .unwrap()
            .iter()
            .any(|item| item["to_stage"] == "archived")
    );
}

#[tokio::test]
async fn deleting_failed_lead_anonymizes_payload_and_removes_attachments() {
    let Some((app, pool, _admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("failed-lead-delete");
    let pm_id = seed_user(&pool, &tag, "patient_manager").await;
    let pm_bearer = auth_header_for(pm_id, "patient_manager");
    let lead_id = create_lead(&app, &pm_bearer, &tag).await;

    sqlx::query(
        r#"INSERT INTO lead_attachments (
                lead_id, file_name, content_type, size_bytes, data
           ) VALUES (
                $1, $2, $3, $4, $5
           )"#,
    )
    .bind(lead_id)
    .bind("passport.pdf")
    .bind("application/pdf")
    .bind(4_i64)
    .bind(vec![0x25_u8, 0x50, 0x44, 0x46])
    .execute(&pool)
    .await
    .unwrap();

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/leads/{lead_id}/failed-flow"),
        &pm_bearer,
        Some(json!({
            "resolution": "delete",
            "reason": "Delete failed intake payload",
            "note": "No commercial relationship established"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (status, detail) = json_request(
        &app,
        "GET",
        &format!("/api/v1/leads/{lead_id}"),
        &pm_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(detail["first_name"], "Deleted");
    assert_eq!(detail["last_name"], "Lead");
    assert!(detail["email"].is_null());
    assert_eq!(detail["failed_outcome"]["status"], "delete_anonymized");
    assert_eq!(detail["lifecycle"]["current_stage"], "deleted");
    assert_eq!(
        detail["attachments"]
            .as_array()
            .map(Vec::len)
            .unwrap_or_default(),
        0
    );

    let attachment_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM lead_attachments WHERE lead_id = $1")
            .bind(lead_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(attachment_count, 0);
}

#[tokio::test]
async fn order_lifecycle_only_allows_next_phase_and_tracks_history() {
    let Some((app, pool, _admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("order-lifecycle");
    let pm_id = seed_user(&pool, &tag, "patient_manager").await;
    let pm_bearer = auth_header_for(pm_id, "patient_manager");
    let patient_id = create_patient(&app, &pm_bearer, &tag).await;
    let order_id = create_order(&app, &pm_bearer, patient_id).await;

    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/orders/{order_id}"),
        &pm_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["lifecycle"]["current_stage"], "discovery");
    assert_eq!(body["lifecycle"]["next_stage"], "intake");

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/orders/{order_id}/phase"),
        &pm_bearer,
        Some(json!({ "phase": "closure" })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert!(
        body["message"]
            .as_str()
            .unwrap_or_default()
            .contains("next lifecycle phase")
    );

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/orders/{order_id}/phase"),
        &pm_bearer,
        Some(json!({ "phase": "intake", "note": "Planning accepted" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (status, detail) = json_request(
        &app,
        "GET",
        &format!("/api/v1/orders/{order_id}"),
        &pm_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(detail["phase"], "intake");
    assert_eq!(detail["lifecycle"]["current_stage"], "intake");
    assert_eq!(detail["lifecycle"]["next_stage"], "execution");
    assert!(
        detail["lifecycle"]["history"]
            .as_array()
            .unwrap()
            .iter()
            .any(|item| item["to_stage"] == "intake")
    );
}

#[tokio::test]
async fn order_lifecycle_blocks_closure_and_followup_until_evidence_exists() {
    let Some((app, pool, _admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("order-lifecycle-blockers");
    let pm_id = seed_user(&pool, &tag, "patient_manager").await;
    let pm_bearer = auth_header_for(pm_id, "patient_manager");
    let patient_id = create_patient(&app, &pm_bearer, &tag).await;
    let order_id = create_order(&app, &pm_bearer, patient_id).await;

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/orders/{order_id}/phase"),
        &pm_bearer,
        Some(json!({ "phase": "intake" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/orders/{order_id}/process-gates"),
        &pm_bearer,
        Some(json!({
            "package_coverage_status": "covered",
            "package_coverage_note": "Package allows repeat execution"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/orders/{order_id}/phase"),
        &pm_bearer,
        Some(json!({ "phase": "execution" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/orders/{order_id}/phase"),
        &pm_bearer,
        Some(json!({ "phase": "closure" })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert!(
        body["blocking_reasons"]
            .as_array()
            .unwrap()
            .iter()
            .any(|item| item
                .as_str()
                .unwrap_or_default()
                .contains("execution appointment"))
    );

    insert_order_appointment(&pool, order_id, patient_id, pm_id, "execution", "completed").await;

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/orders/{order_id}/phase"),
        &pm_bearer,
        Some(json!({ "phase": "closure" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/orders/{order_id}/phase"),
        &pm_bearer,
        Some(json!({ "phase": "followup" })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert!(
        body["blocking_reasons"]
            .as_array()
            .unwrap()
            .iter()
            .any(|item| item
                .as_str()
                .unwrap_or_default()
                .contains("follow-up appointment"))
    );

    insert_order_appointment(&pool, order_id, patient_id, pm_id, "followup", "planned").await;

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/orders/{order_id}/phase"),
        &pm_bearer,
        Some(json!({ "phase": "followup" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
}

#[tokio::test]
async fn execution_flow_blocks_closure_until_arrival_scope_and_checklists_are_closed() {
    let Some((app, pool, _admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("order-execution-flow");
    let pm_id = seed_user(&pool, &tag, "patient_manager").await;
    let interpreter_id = seed_user(&pool, &tag, "interpreter").await;
    let pm_bearer = auth_header_for(pm_id, "patient_manager");
    let patient_id = create_patient(&app, &pm_bearer, &tag).await;
    let order_id = create_order(&app, &pm_bearer, patient_id).await;

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/orders/{order_id}/phase"),
        &pm_bearer,
        Some(json!({ "phase": "intake" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/orders/{order_id}/process-gates"),
        &pm_bearer,
        Some(json!({
            "package_coverage_status": "covered",
            "package_coverage_note": "Package covers execution"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/orders/{order_id}/planning-preparation"),
        &pm_bearer,
        Some(json!({
            "treatment_plan_status": "finalized",
            "non_medical_required": true,
            "interpreter_required": true,
            "preparation_documents_status": "sent",
            "interpreter_briefing_status": "completed"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    insert_order_appointment_with_context(
        &pool,
        order_id,
        patient_id,
        pm_id,
        AppointmentInsertContext {
            appointment_type: "medical",
            checklist_phase: "preparation",
            status: "confirmed",
            interpreter_id: Some(interpreter_id),
            interpreter_response: Some("accepted"),
        },
    )
    .await;
    insert_order_appointment_with_context(
        &pool,
        order_id,
        patient_id,
        pm_id,
        AppointmentInsertContext {
            appointment_type: "non_medical",
            checklist_phase: "preparation",
            status: "confirmed",
            interpreter_id: None,
            interpreter_response: None,
        },
    )
    .await;

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/orders/{order_id}/phase"),
        &pm_bearer,
        Some(json!({ "phase": "execution" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let execution_appointment_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO appointments (
                patient_id, order_id, appointment_type, title, date, status,
                checklist_phase, created_by, interpreter_id, interpreter_response
           ) VALUES (
                $1, $2, 'medical', 'Execution visit', CURRENT_DATE, 'completed',
                'execution', $3, $4, 'accepted'
           ) RETURNING id"#,
    )
    .bind(patient_id)
    .bind(order_id)
    .bind(pm_id)
    .bind(interpreter_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    insert_order_appointment_with_context(
        &pool,
        order_id,
        patient_id,
        pm_id,
        AppointmentInsertContext {
            appointment_type: "non_medical",
            checklist_phase: "execution",
            status: "completed",
            interpreter_id: None,
            interpreter_response: None,
        },
    )
    .await;
    insert_interpreter_report(&pool, execution_appointment_id, interpreter_id, pm_id).await;

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/orders/{order_id}/phase"),
        &pm_bearer,
        Some(json!({ "phase": "closure" })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert!(
        body["blocking_reasons"]
            .as_array()
            .unwrap()
            .iter()
            .any(|item| item.as_str().unwrap_or_default().contains("arrival"))
    );

    complete_order_workflow_group(&pool, order_id, "order_execution").await;

    let (status, flow) = json_request(
        &app,
        "POST",
        &format!("/api/v1/orders/{order_id}/execution-flow"),
        &pm_bearer,
        Some(json!({
            "arrival_status": "arrived",
            "medical_execution_status": "completed",
            "non_medical_execution_status": "completed",
            "interpreter_service_status": "completed",
            "issue_status": "resolved",
            "execution_summary": "Patient arrived and execution finished without unresolved blockers."
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(flow["closure_ready"], true);

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/orders/{order_id}/phase"),
        &pm_bearer,
        Some(json!({ "phase": "closure" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
}

#[tokio::test]
async fn followup_flow_requires_explicit_milestones_before_order_enters_followup() {
    let Some((app, pool, _admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("order-followup-flow");
    let pm_id = seed_user(&pool, &tag, "patient_manager").await;
    let pm_bearer = auth_header_for(pm_id, "patient_manager");
    let patient_id = create_patient(&app, &pm_bearer, &tag).await;
    let order_id = create_order(&app, &pm_bearer, patient_id).await;

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/orders/{order_id}/phase"),
        &pm_bearer,
        Some(json!({ "phase": "intake" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/orders/{order_id}/process-gates"),
        &pm_bearer,
        Some(json!({
            "package_coverage_status": "covered",
            "package_coverage_note": "Covered package"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/orders/{order_id}/planning-preparation"),
        &pm_bearer,
        Some(json!({
            "treatment_plan_status": "finalized",
            "preparation_documents_status": "sent"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    insert_order_appointment_with_context(
        &pool,
        order_id,
        patient_id,
        pm_id,
        AppointmentInsertContext {
            appointment_type: "medical",
            checklist_phase: "preparation",
            status: "confirmed",
            interpreter_id: None,
            interpreter_response: None,
        },
    )
    .await;

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/orders/{order_id}/phase"),
        &pm_bearer,
        Some(json!({ "phase": "execution" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    insert_order_appointment_with_context(
        &pool,
        order_id,
        patient_id,
        pm_id,
        AppointmentInsertContext {
            appointment_type: "medical",
            checklist_phase: "execution",
            status: "completed",
            interpreter_id: None,
            interpreter_response: None,
        },
    )
    .await;
    complete_order_workflow_group(&pool, order_id, "order_execution").await;

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/orders/{order_id}/execution-flow"),
        &pm_bearer,
        Some(json!({
            "arrival_status": "arrived",
            "medical_execution_status": "completed",
            "issue_status": "resolved"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/orders/{order_id}/phase"),
        &pm_bearer,
        Some(json!({ "phase": "closure" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/orders/{order_id}/phase"),
        &pm_bearer,
        Some(json!({ "phase": "followup" })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert!(
        body["blocking_reasons"]
            .as_array()
            .unwrap()
            .iter()
            .any(|item| item
                .as_str()
                .unwrap_or_default()
                .contains("1-week follow-up"))
    );

    sqlx::query(
        r#"INSERT INTO appointments (
                patient_id, order_id, appointment_type, title, date, status, checklist_phase, created_by
           ) VALUES
                ($1, $2, 'medical', 'Doctor-directed: Echo review', CURRENT_DATE + 5, 'planned', 'followup', $3),
                ($1, $2, 'medical', '1-week follow-up check-in', CURRENT_DATE + 7, 'planned', 'followup', $3),
                ($1, $2, 'medical', '1-month follow-up check-in', CURRENT_DATE + 30, 'planned', 'followup', $3),
                ($1, $2, 'medical', '6-month follow-up check-in', CURRENT_DATE + 180, 'planned', 'followup', $3)"#,
    )
    .bind(patient_id)
    .bind(order_id)
    .bind(pm_id)
    .execute(&pool)
    .await
    .unwrap();
    insert_order_task(
        &pool,
        order_id,
        patient_id,
        pm_id,
        "Package-end: Renewal outreach",
    )
    .await;

    let (status, flow) = json_request(
        &app,
        "POST",
        &format!("/api/v1/orders/{order_id}/followup-flow"),
        &pm_bearer,
        Some(json!({
            "doctor_followup_status": "scheduled",
            "followup_1w_status": "scheduled",
            "followup_1m_status": "scheduled",
            "followup_6m_status": "scheduled",
            "package_end_date": "2026-12-31",
            "package_end_status": "scheduled",
            "results_handoff_status": "completed",
            "followup_summary": "Patient informed about the long-tail follow-up schedule."
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(flow["followup_ready"], true);

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/orders/{order_id}/phase"),
        &pm_bearer,
        Some(json!({ "phase": "followup" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
}
