mod support;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use chrono::{Duration, Utc};
use serde_json::{Value, json};
use sqlx::{PgPool, Row};
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
    let date = match checklist_phase {
        "execution" => gmed_server::app_time::today() + Duration::days(10),
        "followup" => gmed_server::app_time::today() + Duration::days(20),
        _ => gmed_server::app_time::today(),
    };
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
    .bind(date)
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
    let phase_offset = match context.checklist_phase {
        "preparation" => 0,
        "execution" => 10,
        "followup" => 20,
        _ => 30,
    };
    let type_offset = match context.appointment_type {
        "medical" => 0,
        "non_medical" => 1,
        other => {
            if context.interpreter_id.is_some() || other.contains("interpreter") {
                2
            } else {
                3
            }
        }
    };
    let date = gmed_server::app_time::today() + Duration::days(phase_offset + type_offset);
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
    .bind(date)
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
    let document_id = Uuid::new_v4();
    sqlx::query(
        r#"INSERT INTO documents (
                id, patient_id, auto_name, original_filename, art, category,
                version_root_document_id, version_number, uploaded_by
           ) VALUES (
                $1, $2, $3, $4, $5, $6, $1, 1, $7
           )"#,
    )
    .bind(document_id)
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
async fn updating_lead_gates_allows_qualification_but_conversion_requires_onboarding() {
    let Some((app, pool, _admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("lead-convert");
    let pm_id = seed_user(&pool, &tag, "patient_manager").await;
    let pm_bearer = auth_header_for(pm_id, "patient_manager");
    let lead_id = create_lead(&app, &pm_bearer, &tag).await;
    // Stands for the DSGVO signature flow: staff cannot set `signed` by hand.
    sqlx::query("UPDATE leads SET compliance_status = 'signed' WHERE id::text = $1")
        .bind(lead_id.to_string())
        .execute(&pool)
        .await
        .unwrap();

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
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{converted}");
    assert_eq!(converted["message"], "Lead is not conversion-ready");
    assert!(
        converted["blocking_reasons"]
            .as_array()
            .is_some_and(|reasons| reasons
                .iter()
                .any(|reason| { reason == "Signed confidentiality release is missing" })),
        "{converted}"
    );
}

#[tokio::test]
async fn overdue_debt_remains_visible_without_blocking_execution() {
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
    assert_eq!(status, StatusCode::OK, "{body}");
    let (status, detail) = json_request(
        &app,
        "GET",
        &format!("/api/v1/orders/{order_id}"),
        &billing_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{detail}");
    assert_eq!(detail["process_gates"]["debt_hold"], false);
    assert_eq!(detail["process_gates"]["overdue_invoice_count"], 1);
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
        gates["debt_management"]["attention_reason"]
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

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/orders/{order_id}/phase"),
        &pm_bearer,
        Some(json!({ "phase": "intake" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

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

    let (status, _planning) = json_request(
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
async fn existing_customer_recheck_reports_missing_data_without_a_debt_hold() {
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
    assert_eq!(body["debt_hold"], false);
    assert_eq!(body["overdue_invoice_count"], 1);
    assert!(
        body["base_data_missing_fields"]
            .as_array()
            .unwrap()
            .iter()
            .any(|item| item == "country")
    );
    assert!(
        !body["blocking_reasons"]
            .as_array()
            .unwrap()
            .iter()
            .any(|item| item
                .as_str()
                .unwrap_or_default()
                .contains("debt-management"))
    );
}

#[tokio::test]
async fn new_patient_recheck_does_not_require_existing_customer_history() {
    let Some((app, pool, _admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("patient-recheck-new");
    let pm_id = seed_user(&pool, &tag, "patient_manager").await;
    let pm_bearer = auth_header_for(pm_id, "patient_manager");
    let patient_id = create_patient(&app, &pm_bearer, &tag).await;

    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/patients/{patient_id}/recheck"),
        &pm_bearer,
        None,
    )
    .await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["requires_recheck"], false);
    assert_eq!(body["can_create_order"], true);
    assert_eq!(body["blocking_reasons"].as_array().unwrap().len(), 0);
    assert_eq!(body["checks"].as_array().unwrap().len(), 0);
    assert_eq!(body["document_alerts"]["missing_count"], 0);
    assert_eq!(body["document_alerts"]["document_pack_complete"], true);
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
            "residence_country": "Germany",
            "languages": ["de"],
            "legal_status": {
                "dsgvo_signed": true,
                "confidentiality_release_signed": false,
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
    assert_eq!(recheck["can_create_order"], false);
    assert_eq!(recheck["confidentiality_release_ready"], false);
    assert_eq!(
        recheck["legal_status"]["confidentiality_release_signed"],
        false
    );
    assert!(
        recheck["checks"]
            .as_array()
            .unwrap()
            .iter()
            .any(|check| { check["key"] == "confidentiality_release" && check["passed"] == false })
    );
    assert!(
        recheck["blocking_reasons"]
            .as_array()
            .unwrap()
            .iter()
            .any(|reason| reason
                .as_str()
                .unwrap_or_default()
                .contains("confidentiality release"))
    );

    let (status, blocked) = json_request(
        &app,
        "POST",
        "/api/v1/orders",
        &pm_bearer,
        Some(json!({
            "patient_id": patient_id,
            "needs_description": "Repeat execution without confidentiality release"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(
        blocked["message"],
        "Existing customer re-check is incomplete"
    );

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/patients/{patient_id}/update"),
        &pm_bearer,
        Some(json!({
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
    assert_eq!(recheck["confidentiality_release_ready"], true);
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
async fn order_status_machine_blocks_phase_changes_and_terminal_reopen() {
    let Some((app, pool, _admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("order-status-machine");
    let pm_id = seed_user(&pool, &tag, "patient_manager").await;
    let pm_bearer = auth_header_for(pm_id, "patient_manager");
    let patient_id = create_patient(&app, &pm_bearer, &tag).await;
    let order_id = create_order(&app, &pm_bearer, patient_id).await;

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/orders/{order_id}/status"),
        &pm_bearer,
        Some(json!({ "status": "paused", "note": "Waiting for patient" })),
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
    assert_eq!(detail["status"], "paused");
    assert_eq!(
        detail["lifecycle"]["allowed_transitions"][0]["blocked"],
        true
    );
    assert!(
        detail["lifecycle"]["allowed_status_transitions"]
            .as_array()
            .unwrap()
            .iter()
            .any(|transition| transition["status"] == "active")
    );

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/orders/{order_id}/phase"),
        &pm_bearer,
        Some(json!({ "phase": "intake" })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert!(
        body["message"]
            .as_str()
            .unwrap_or_default()
            .contains("must be active")
    );

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/orders/{order_id}/status"),
        &pm_bearer,
        Some(json!({ "status": "active" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/orders/{order_id}/status"),
        &pm_bearer,
        Some(json!({ "status": "completed" })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert!(
        body["blocking_reasons"]
            .as_array()
            .unwrap()
            .iter()
            .any(|reason| reason
                .as_str()
                .unwrap_or_default()
                .contains("follow-up phase"))
    );

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/orders/{order_id}/status"),
        &pm_bearer,
        Some(json!({ "status": "cancelled", "reason": "Patient withdrew the request" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/orders/{order_id}/status"),
        &pm_bearer,
        Some(json!({ "status": "active" })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
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

    let (status, _planning) = json_request(
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
                .contains("Medical execution"))
    );

    insert_order_appointment(&pool, order_id, patient_id, pm_id, "execution", "completed").await;
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
            .any(|item| item.as_str().unwrap_or_default().contains("follow-up"))
    );

    insert_order_appointment(&pool, order_id, patient_id, pm_id, "followup", "planned").await;

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/orders/{order_id}/followup-flow"),
        &pm_bearer,
        Some(json!({
            "doctor_followup_status": "not_required",
            "followup_1w_status": "not_required",
            "followup_1m_status": "not_required",
            "followup_6m_status": "not_required",
            "package_end_status": "not_required",
            "results_handoff_status": "completed",
            "followup_summary": "Minimal follow-up trail recorded for lifecycle progression."
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    // Billing must be closed before the order leaves closure: approved
    // services invoiced and no open patient invoice (owner decision Q5).
    let approved_line: Uuid = sqlx::query_scalar(
        r#"INSERT INTO order_leistungen (order_id, patient_id, description, quantity, unit_price, currency, vat_rate, status, delivered_at)
           VALUES ($1, $2, 'Organisation der Behandlung', 1, 200, 'EUR', 0, 'approved', now())
           RETURNING id"#,
    )
    .bind(order_id)
    .bind(patient_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    let draft_invoice: Uuid = sqlx::query_scalar(
        r#"INSERT INTO invoices (
               order_id, patient_id, invoice_type, status,
               total_net, total_vat, total_gross, paid_amount, line_items, created_by
           ) VALUES ($1, $2, 'interim', 'draft', 200, 0, 200, 0, '[]', $3)
           RETURNING id"#,
    )
    .bind(order_id)
    .bind(patient_id)
    .bind(pm_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/orders/{order_id}/phase"),
        &pm_bearer,
        Some(json!({ "phase": "followup" })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
    let reasons: Vec<String> = body["blocking_reasons"]
        .as_array()
        .unwrap()
        .iter()
        .map(|reason| reason.as_str().unwrap_or_default().to_string())
        .collect();
    assert!(
        reasons.contains(&"1 approved service item(s) are not invoiced yet".to_string()),
        "{reasons:?}"
    );
    assert!(
        reasons.contains(&"1 draft patient invoice(s) are not issued yet".to_string()),
        "{reasons:?}"
    );
    sqlx::query("UPDATE order_leistungen SET status = 'invoiced' WHERE id = $1")
        .bind(approved_line)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("UPDATE invoices SET status = 'cancelled' WHERE id = $1")
        .bind(draft_invoice)
        .execute(&pool)
        .await
        .unwrap();

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/orders/{order_id}/phase"),
        &pm_bearer,
        Some(json!({ "phase": "followup" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let audited: i64 = sqlx::query_scalar(
        r#"SELECT COUNT(*) FROM audit_log
           WHERE action = 'update_phase' AND entity_id = $1
             AND context->>'phase' = 'followup'"#,
    )
    .bind(order_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(audited, 1);
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
                $1, $2, 'medical', 'Execution visit', CURRENT_DATE + 10, 'completed',
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

    // Planning required both services, so the untouched execution row must not
    // read as "not_required" while the gate still waits for them.
    let (status, detail) = json_request(
        &app,
        "GET",
        &format!("/api/v1/orders/{order_id}"),
        &pm_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        detail["execution_flow"]["interpreter_service_status"],
        "pending"
    );
    assert_eq!(
        detail["execution_flow"]["non_medical_execution_status"],
        "pending"
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

/// A milestone marked "scheduled" with a date in the order's follow-up
/// section satisfies the follow-up gate without a separate visit or reminder;
/// "scheduled" without a date still blocks.
#[tokio::test]
async fn followup_flow_accepts_milestones_planned_with_a_date() {
    let Some((app, pool, _admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("order-followup-dates");
    let pm_id = seed_user(&pool, &tag, "patient_manager").await;
    let pm_bearer = auth_header_for(pm_id, "patient_manager");
    let patient_id = create_patient(&app, &pm_bearer, &tag).await;
    let order_id = create_order(&app, &pm_bearer, patient_id).await;
    let visit_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO appointments (
                patient_id, order_id, appointment_type, title, date, status,
                checklist_phase, created_by
           ) VALUES ($1, $2, 'medical', 'Consultation', CURRENT_DATE - 1, 'completed', 'execution', $3)
           RETURNING id"#,
    )
    .bind(patient_id)
    .bind(order_id)
    .bind(pm_id)
    .fetch_one(&pool)
    .await
    .unwrap();

    let (status, flow) = json_request(
        &app,
        "POST",
        &format!("/api/v1/orders/{order_id}/followup-flow"),
        &pm_bearer,
        Some(json!({
            "doctor_followup_status": "not_required",
            "followup_1w_status": "scheduled",
            "followup_1m_status": "scheduled",
            "followup_6m_status": "scheduled",
            "followup_1w_date": "2026-10-05",
            "followup_1m_date": "2026-10-28",
            "package_end_status": "not_required",
            "results_handoff_status": "not_required"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{flow}");
    assert_eq!(flow["followup_1w_ready"], true, "{flow}");
    assert_eq!(flow["followup_1m_ready"], true, "{flow}");
    assert_eq!(flow["followup_6m_ready"], false, "{flow}");
    assert_eq!(flow["followup_1w_date"], "2026-10-05");
    assert_eq!(flow["followup_6m_date"], Value::Null);
    assert_eq!(
        flow["reminder_anchor_appointment_id"],
        json!(visit_id.to_string())
    );
    assert_eq!(
        flow["blocking_reasons"],
        json!(["6-month follow-up is not scheduled yet"])
    );

    let (status, flow) = json_request(
        &app,
        "POST",
        &format!("/api/v1/orders/{order_id}/followup-flow"),
        &pm_bearer,
        Some(json!({ "followup_6m_date": "2027-03-28" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{flow}");
    assert_eq!(flow["followup_ready"], true, "{flow}");
    assert_eq!(flow["blocking_reasons"], json!([]));

    // Clearing a date blocks the milestone again; a bad date is rejected.
    let (status, flow) = json_request(
        &app,
        "POST",
        &format!("/api/v1/orders/{order_id}/followup-flow"),
        &pm_bearer,
        Some(json!({ "followup_1w_date": "" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{flow}");
    assert_eq!(flow["followup_1w_ready"], false, "{flow}");
    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/orders/{order_id}/followup-flow"),
        &pm_bearer,
        Some(json!({ "followup_1w_date": "05.10.2026" })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
}

#[tokio::test]
async fn followup_flow_recognizes_localized_and_completed_reminders() {
    let Some((app, pool, _admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("order-localized-followup");
    let pm_id = seed_user(&pool, &tag, "patient_manager").await;
    let pm_bearer = auth_header_for(pm_id, "patient_manager");
    let patient_id = create_patient(&app, &pm_bearer, &tag).await;
    let order_id = create_order(&app, &pm_bearer, patient_id).await;

    let appointment_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO appointments (
                patient_id, order_id, appointment_type, title, date, status,
                checklist_phase, created_by
           ) VALUES (
                $1, $2, 'medical', 'Completed source visit', CURRENT_DATE,
                'completed', 'execution', $3
           )
           RETURNING id"#,
    )
    .bind(patient_id)
    .bind(order_id)
    .bind(pm_id)
    .fetch_one(&pool)
    .await
    .unwrap();

    sqlx::query(
        r#"INSERT INTO reminders (
                appointment_id, user_id, remind_at, title, is_completed, completed_at
           ) VALUES
                ($1, $2, now() + interval '7 days', 'Контроль через 1 неделю', true, now()),
                ($1, $2, now() + interval '1 month', 'Nachsorge nach 1 Monat', false, NULL),
                ($1, $2, now() + interval '6 months', 'Контрольный контакт через 6 месяцев', false, NULL)"#,
    )
    .bind(appointment_id)
    .bind(pm_id)
    .execute(&pool)
    .await
    .unwrap();

    let (status, flow) = json_request(
        &app,
        "POST",
        &format!("/api/v1/orders/{order_id}/followup-flow"),
        &pm_bearer,
        Some(json!({
            "doctor_followup_status": "not_required",
            "followup_1w_status": "scheduled",
            "followup_1m_status": "scheduled",
            "followup_6m_status": "scheduled",
            "package_end_date": "2026-12-31",
            "package_end_status": "not_required",
            "results_handoff_status": "not_required"
        })),
    )
    .await;

    assert_eq!(status, StatusCode::OK, "{flow}");
    assert_eq!(flow["followup_1w_reminders"], 1);
    assert_eq!(flow["followup_1m_reminders"], 1);
    assert_eq!(flow["followup_6m_reminders"], 1);
    assert_eq!(flow["package_end_required"], false);
    assert_eq!(flow["followup_ready"], true, "{flow}");
    assert_eq!(flow["blocking_reasons"], json!([]));
}

async fn order_completion_reasons(app: &axum::Router, bearer: &str, order_id: Uuid) -> Vec<String> {
    let (status, detail) = json_request(
        app,
        "GET",
        &format!("/api/v1/orders/{order_id}"),
        bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{detail}");
    detail["lifecycle"]["allowed_status_transitions"]
        .as_array()
        .unwrap()
        .iter()
        .find(|transition| transition["status"] == "completed")
        .unwrap_or_else(|| panic!("completion transition: {detail}"))["reasons"]
        .as_array()
        .unwrap()
        .iter()
        .map(|reason| reason.as_str().unwrap_or_default().to_string())
        .collect()
}

/// QA D-19: a follow-up milestone is completed through its visits. While a
/// visit of the milestone is still planned (or, without a visit, before its
/// planned date) "completed" is refused, and a visit kept for a milestone
/// marked not required keeps the order open until it is held or cancelled.
#[tokio::test]
async fn followup_milestone_completion_follows_its_visits() {
    let Some((app, pool, _admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("followup-visit-completion");
    let pm_id = seed_user(&pool, &tag, "patient_manager").await;
    let pm = auth_header_for(pm_id, "patient_manager");
    let patient_id = create_patient(&app, &pm, &tag).await;
    let order_id = create_order(&app, &pm, patient_id).await;
    sqlx::query("UPDATE orders SET phase = 'followup' WHERE id = $1")
        .bind(order_id)
        .execute(&pool)
        .await
        .unwrap();

    let today = gmed_server::app_time::today();
    let week_date = today + Duration::days(22);
    let half_year_date = today + Duration::days(181);
    // An older visit recognised by its title only, and a visit typed by
    // `followup_milestone` whose title says nothing about the milestone.
    let week_visit: Uuid = sqlx::query_scalar(
        r#"INSERT INTO appointments (
                patient_id, order_id, appointment_type, title, date, status,
                care_path_kind, created_by
           ) VALUES ($1, $2, 'medical', 'Контроль через 1 неделю (QA)', $3, 'planned',
                     'followup', $4)
           RETURNING id"#,
    )
    .bind(patient_id)
    .bind(order_id)
    .bind(week_date)
    .bind(pm_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    let half_year_visit: Uuid = sqlx::query_scalar(
        r#"INSERT INTO appointments (
                patient_id, order_id, appointment_type, title, date, status,
                care_path_kind, followup_milestone, created_by
           ) VALUES ($1, $2, 'medical', 'Kontrolltermin Kardiologie', $3, 'confirmed',
                     'followup', 'post_6m', $4)
           RETURNING id"#,
    )
    .bind(patient_id)
    .bind(order_id)
    .bind(half_year_date)
    .bind(pm_id)
    .fetch_one(&pool)
    .await
    .unwrap();

    let followup = |body: Value| {
        let app = app.clone();
        let pm = pm.clone();
        async move {
            json_request(
                &app,
                "POST",
                &format!("/api/v1/orders/{order_id}/followup-flow"),
                &pm,
                Some(body),
            )
            .await
        }
    };
    let week_label = week_date.format("%d.%m.%Y").to_string();
    let half_year_label = half_year_date.format("%d.%m.%Y").to_string();

    // The 1-week visit on its date is still ahead: the milestone is not done.
    let (status, body) = followup(json!({ "followup_1w_status": "completed" })).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
    assert_eq!(
        body["message"],
        format!("1-week follow-up visit on {week_label} is still open")
    );
    assert_eq!(body["details"]["code"], "followup_visit_open");
    assert_eq!(body["details"]["appointment_id"], json!(week_visit));

    // A contact without a visit is not completed before its planned date,
    // also not by clearing the date; recording the day it took place does.
    let (status, body) = followup(json!({
        "followup_1m_status": "completed",
        "followup_1m_date": (today + Duration::days(30)).to_string(),
    }))
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
    assert_eq!(body["details"]["code"], "followup_before_date");
    let (status, body) = followup(json!({
        "followup_1m_status": "scheduled",
        "followup_1m_date": (today + Duration::days(30)).to_string(),
    }))
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let (status, body) = followup(json!({
        "followup_1m_status": "completed",
        "followup_1m_date": "",
    }))
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
    assert_eq!(
        body["message"],
        format!(
            "1-month follow-up cannot be completed before {}",
            (today + Duration::days(30)).format("%d.%m.%Y")
        )
    );
    let (status, flow) = followup(json!({
        "followup_1m_status": "completed",
        "followup_1m_date": today.to_string(),
    }))
    .await;
    assert_eq!(status, StatusCode::OK, "{flow}");
    assert_eq!(flow["followup_1w_status"], "pending", "refused change kept");
    assert_eq!(flow["followup_1m_status"], "completed");
    assert_eq!(flow["followup_1w_visits"], 1);
    assert_eq!(flow["followup_1w_open_visits"], 1);
    assert_eq!(flow["followup_1w_open_visit_date"], week_date.to_string());
    assert_eq!(flow["followup_6m_open_visits"], 1);

    // Marking the 6-month contact not required leaves its visit in place,
    // and that visit keeps the order open.
    let (status, flow) = followup(json!({
        "doctor_followup_status": "not_required",
        "followup_6m_status": "not_required",
        "package_end_status": "not_required",
        "results_handoff_status": "completed",
    }))
    .await;
    assert_eq!(status, StatusCode::OK, "{flow}");
    let reasons = order_completion_reasons(&app, &pm, order_id).await;
    let half_year_reason = format!("6-month follow-up visit on {half_year_label} is still open");
    assert!(reasons.contains(&half_year_reason), "{reasons:?}");
    assert!(
        reasons.contains(&"1-week follow-up must be completed or marked not required".to_string()),
        "{reasons:?}"
    );

    // Cancelling visits needs the milestone marked not required.
    let (status, body) = followup(json!({ "cancel_open_visits_for": ["post_1w"] })).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
    let (status, body) = followup(json!({ "cancel_open_visits_for": ["post_2w"] })).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
    let (status, flow) = followup(json!({ "cancel_open_visits_for": ["post_6m"] })).await;
    assert_eq!(status, StatusCode::OK, "{flow}");
    assert_eq!(flow["followup_6m_open_visits"], 0);
    let statuses: Vec<(Uuid, String)> =
        sqlx::query_as("SELECT id, status FROM appointments WHERE id = ANY($1) ORDER BY date")
            .bind(vec![week_visit, half_year_visit])
            .fetch_all(&pool)
            .await
            .unwrap();
    assert_eq!(
        statuses,
        vec![
            (week_visit, "planned".to_string()),
            (half_year_visit, "cancelled".to_string()),
        ]
    );
    let reasons = order_completion_reasons(&app, &pm, order_id).await;
    assert!(!reasons.contains(&half_year_reason), "{reasons:?}");

    // A milestone already stored as completed (before this rule) still does
    // not count while its visit is open.
    sqlx::query(
        "UPDATE order_followup_flows SET followup_1w_status = 'completed' WHERE order_id = $1",
    )
    .bind(order_id)
    .execute(&pool)
    .await
    .unwrap();
    let reasons = order_completion_reasons(&app, &pm, order_id).await;
    assert!(
        reasons.contains(&format!(
            "1-week follow-up visit on {week_label} is still open"
        )),
        "{reasons:?}"
    );

    // Once the visit took place the milestone counts as completed.
    sqlx::query("UPDATE appointments SET date = $2, status = 'completed' WHERE id = $1")
        .bind(week_visit)
        .bind(today - Duration::days(1))
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query(
        "UPDATE order_followup_flows SET followup_1w_status = 'pending' WHERE order_id = $1",
    )
    .bind(order_id)
    .execute(&pool)
    .await
    .unwrap();
    let (status, flow) = followup(json!({ "followup_1w_status": "completed" })).await;
    assert_eq!(status, StatusCode::OK, "{flow}");
    let reasons = order_completion_reasons(&app, &pm, order_id).await;
    assert!(
        !reasons.iter().any(|reason| reason.contains("follow-up")),
        "{reasons:?}"
    );
}

#[tokio::test]
async fn order_amendment_requires_separate_approval_and_updates_total() {
    let Some((app, pool, _admin_id)) = test_context().await else {
        return;
    };
    let tag = format!("amend-{}", Uuid::new_v4().simple());
    let pm_id = seed_user(&pool, &tag, "patient_manager").await;
    let billing_id = seed_user(&pool, &format!("{tag}-b"), "billing").await;
    let pm = auth_header_for(pm_id, "patient_manager");
    let billing = auth_header_for(billing_id, "billing");

    let patient_id = create_patient(&app, &pm, &tag).await;
    let order_id = insert_existing_order(&pool, patient_id, pm_id, &tag).await;
    // The order total is the gross of its services: one 1000 EUR line (0 %).
    sqlx::query(
        r#"INSERT INTO order_leistungen (order_id, patient_id, description, quantity, unit_price, currency, vat_rate, status)
           VALUES ($1, $2, 'Organisation der Behandlung', 1, 1000, 'EUR', 0, 'planned')"#,
    )
    .bind(order_id)
    .bind(patient_id)
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query("UPDATE orders SET total_estimated = 1000 WHERE id = $1")
        .bind(order_id)
        .execute(&pool)
        .await
        .unwrap();

    // How the amount is taxed must be recorded with the proposal.
    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/orders/{order_id}/amendments"),
        &pm,
        Some(json!({
            "delta_amount": "300",
            "agreed_note": "3 extra hours agreed with the patient"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");

    // A reduction is not an amendment (the line is changed or the invoice credited).
    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/orders/{order_id}/amendments"),
        &pm,
        Some(json!({
            "delta_amount": "-50",
            "agreed_note": "Goodwill",
            "vat_treatment": "standard_vat"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");

    // Propose +300 gross at the standard VAT rate.
    let (status, amendment) = json_request(
        &app,
        "POST",
        &format!("/api/v1/orders/{order_id}/amendments"),
        &pm,
        Some(json!({
            "delta_amount": "300",
            "agreed_note": "3 extra hours agreed with the patient",
            "vat_treatment": "standard_vat"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{amendment}");
    assert_eq!(amendment["status"], "pending");
    assert_eq!(amendment["vat_treatment"], "standard_vat");
    assert_eq!(amendment["vat_rate"], "19");
    assert_eq!(amendment["order_leistung_id"], Value::Null);
    let amendment_id = amendment["id"].as_str().unwrap().to_string();

    // The requester may not approve their own amendment.
    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/orders/{order_id}/amendments/{amendment_id}/decision"),
        &pm,
        Some(json!({ "decision": "approve" })),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    // A different approver approves -> a billable service line is added and
    // the order total goes 1000 -> 1300.
    let (status, decided) = json_request(
        &app,
        "POST",
        &format!("/api/v1/orders/{order_id}/amendments/{amendment_id}/decision"),
        &billing,
        Some(json!({ "decision": "approve", "note": "Approved" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{decided}");
    assert_eq!(decided["amendment"]["status"], "approved");
    assert_eq!(decided["order_total_estimated"], "1300");
    let line_id = Uuid::parse_str(decided["order_leistung_id"].as_str().unwrap()).unwrap();
    assert_eq!(
        decided["amendment"]["order_leistung_id"],
        json!(line_id.to_string())
    );

    let line = sqlx::query(
        r#"SELECT status, quantity, unit_price, vat_rate, is_cost_passthrough, description,
                  source_order_amendment_id, approved_by
           FROM order_leistungen WHERE id = $1"#,
    )
    .bind(line_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(line.get::<String, _>("status"), "approved");
    assert_eq!(
        line.get::<rust_decimal::Decimal, _>("unit_price")
            .to_string(),
        "252.10"
    );
    assert_eq!(
        line.get::<rust_decimal::Decimal, _>("vat_rate"),
        rust_decimal::Decimal::new(19, 0)
    );
    assert!(!line.get::<bool, _>("is_cost_passthrough"));
    assert_eq!(
        line.get::<String, _>("description"),
        "Anpassung: 3 extra hours agreed with the patient"
    );
    assert_eq!(
        line.get::<Option<Uuid>, _>("source_order_amendment_id"),
        Some(Uuid::parse_str(&amendment_id).unwrap())
    );
    assert_eq!(line.get::<Option<Uuid>, _>("approved_by"), Some(billing_id));

    // Header, list and finance card all read the same order total.
    let (status, order) = json_request(
        &app,
        "GET",
        &format!("/api/v1/orders/{order_id}"),
        &pm,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{order}");
    assert_eq!(
        order["total_estimated"]
            .as_str()
            .and_then(|value| value.parse::<rust_decimal::Decimal>().ok()),
        Some(rust_decimal::Decimal::new(1300, 0))
    );
    let (status, economics) = json_request(
        &app,
        "GET",
        &format!("/api/v1/orders/{order_id}/economics"),
        &billing,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{economics}");
    assert_eq!(economics["planned"]["revenue_gross"], "1300");

    // The next quote bills the amendment.
    let (status, quote) = json_request(
        &app,
        "POST",
        &format!("/api/v1/orders/{order_id}/quotes"),
        &billing,
        Some(json!({})),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{quote}");
    assert_eq!(quote["total_gross"], "1300");
    assert!(
        quote["line_items"]
            .as_array()
            .unwrap()
            .iter()
            .any(
                |item| item["source_order_leistung_id"] == json!(line_id.to_string())
                    && item["line_gross"] == "300"
            ),
        "{quote}"
    );

    // Re-deciding a settled amendment conflicts.
    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/orders/{order_id}/amendments/{amendment_id}/decision"),
        &billing,
        Some(json!({ "decision": "reject" })),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);

    // An amendment approved before approvals created service lines is billed
    // explicitly, with the VAT treatment chosen then.
    let legacy_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO order_amendments (
                order_id, delta_amount, currency, agreed_note, status, requested_by,
                decided_by, decided_at
           ) VALUES ($1, 50, 'EUR', 'Extra transfer', 'approved', $2, $3, now())
           RETURNING id"#,
    )
    .bind(order_id)
    .bind(pm_id)
    .bind(billing_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    let (status, amendments) = json_request(
        &app,
        "GET",
        &format!("/api/v1/orders/{order_id}/amendments"),
        &pm,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{amendments}");
    let legacy = amendments
        .as_array()
        .unwrap()
        .iter()
        .find(|item| item["id"] == json!(legacy_id.to_string()))
        .unwrap();
    assert_eq!(legacy["billable"], true);
    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/orders/{order_id}/amendments/{legacy_id}/billing-line"),
        &pm,
        Some(json!({})),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
    let (status, billed) = json_request(
        &app,
        "POST",
        &format!("/api/v1/orders/{order_id}/amendments/{legacy_id}/billing-line"),
        &pm,
        Some(json!({ "vat_treatment": "cost_passthrough" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{billed}");
    assert_eq!(billed["order_total_estimated"], "1350");
    assert_eq!(billed["amendment"]["billable"], false);
    assert_eq!(billed["amendment"]["is_cost_passthrough"], true);
    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/orders/{order_id}/amendments/{legacy_id}/billing-line"),
        &pm,
        Some(json!({ "vat_treatment": "cost_passthrough" })),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
}

#[tokio::test]
async fn ceo_assistant_reads_the_orders_it_lists_but_cannot_change_them() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };
    let tag = unique_tag("assistant-orders");
    let pm_id = seed_user(&pool, &tag, "patient_manager").await;
    let pm = auth_header_for(pm_id, "patient_manager");
    let assistant_id = seed_user(&pool, &tag, "ceo_assistant").await;
    let assistant = auth_header_for(assistant_id, "ceo_assistant");
    let other_assistant_id = seed_user(&pool, &format!("{tag}-other"), "ceo_assistant").await;
    let other_assistant = auth_header_for(other_assistant_id, "ceo_assistant");

    let patient_id = create_patient(&app, &pm, &tag).await;
    let order_id = insert_existing_order(&pool, patient_id, pm_id, &tag).await;
    sqlx::query(
        "INSERT INTO patient_assignments (patient_id, user_id, assigned_by) VALUES ($1, $2, $3)",
    )
    .bind(patient_id)
    .bind(assistant_id)
    .bind(admin_id)
    .execute(&pool)
    .await
    .unwrap();

    // The order the assistant can list opens read-only with its workspace data.
    let (status, list) = json_request(
        &app,
        "GET",
        &format!("/api/v1/orders?patient_id={patient_id}"),
        &assistant,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{list}");
    assert!(
        list.as_array()
            .unwrap()
            .iter()
            .any(|order| order["id"] == json!(order_id.to_string()))
    );
    for path in [
        format!("/api/v1/orders/{order_id}"),
        format!("/api/v1/orders/{order_id}/leistungen"),
        format!("/api/v1/orders/{order_id}/economics"),
        format!("/api/v1/orders/{order_id}/group"),
        format!("/api/v1/orders/{order_id}/amendments"),
    ] {
        let (status, body) = json_request(&app, "GET", &path, &assistant, None).await;
        assert_eq!(status, StatusCode::OK, "{path}: {body}");
    }
    let (_, economics) = json_request(
        &app,
        "GET",
        &format!("/api/v1/orders/{order_id}/economics"),
        &assistant,
        None,
    )
    .await;
    assert_eq!(economics["margin_visible"], false);

    // Writes stay closed for the read-only role.
    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/orders/{order_id}/status"),
        &assistant,
        Some(json!({ "status": "paused" })),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/orders/{order_id}/amendments"),
        &assistant,
        Some(json!({ "delta_amount": "10", "agreed_note": "Not allowed" })),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    // An assistant without access to the patient still gets nothing.
    let (status, _) = json_request(
        &app,
        "GET",
        &format!("/api/v1/orders/{order_id}"),
        &other_assistant,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn new_order_endpoints_require_access_to_target_and_sources() {
    let Some((app, pool, _admin_id)) = test_context().await else {
        return;
    };
    let tag = format!("order-access-{}", Uuid::new_v4().simple());
    let pm_a_id = seed_user(&pool, &format!("{tag}-a"), "patient_manager").await;
    let pm_b_id = seed_user(&pool, &format!("{tag}-b"), "patient_manager").await;
    let pm_a = auth_header_for(pm_a_id, "patient_manager");
    let pm_b = auth_header_for(pm_b_id, "patient_manager");

    let patient_a = create_patient(&app, &pm_a, &format!("{tag}-pa")).await;
    let patient_b = create_patient(&app, &pm_b, &format!("{tag}-pb")).await;
    let order_a = insert_existing_order(&pool, patient_a, pm_a_id, &format!("{tag}-oa")).await;
    let order_b = insert_existing_order(&pool, patient_b, pm_b_id, &format!("{tag}-ob")).await;

    let (status, _) = json_request(
        &app,
        "GET",
        &format!("/api/v1/orders/{order_b}/amendments"),
        &pm_a,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/orders/{order_b}/payer"),
        &pm_a,
        Some(json!({ "payer_contact_name": "Not my patient" })),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/orders/{order_a}/merge"),
        &pm_a,
        Some(json!({ "source_order_ids": [order_b] })),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn head_order_groups_subs_rolls_up_and_ungroups() {
    let Some((app, pool, _admin_id)) = test_context().await else {
        return;
    };
    let tag = format!("head-{}", Uuid::new_v4().simple());
    let pm_id = seed_user(&pool, &tag, "patient_manager").await;
    let pm = auth_header_for(pm_id, "patient_manager");

    let father = create_patient(&app, &pm, &format!("{tag}-f")).await;
    let child = create_patient(&app, &pm, &format!("{tag}-c")).await;
    let head = insert_existing_order(&pool, father, pm_id, &format!("{tag}-A")).await;
    let sub = insert_existing_order(&pool, child, pm_id, &format!("{tag}-B")).await;
    sqlx::query("UPDATE orders SET total_estimated = 1000 WHERE id = $1")
        .bind(head)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("UPDATE orders SET total_estimated = 300 WHERE id = $1")
        .bind(sub)
        .execute(&pool)
        .await
        .unwrap();

    // An order cannot be grouped under itself.
    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/orders/{head}/group"),
        &pm,
        Some(json!({ "head_order_id": head })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);

    // Group the child's order under the father's -> father becomes MAIN, rollup 1300.
    let (status, group) = json_request(
        &app,
        "POST",
        &format!("/api/v1/orders/{sub}/group"),
        &pm,
        Some(json!({ "head_order_id": head })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{group}");
    assert_eq!(group["head"]["order_role"], "main");
    assert_eq!(group["rollup_total_estimated"], "1300");
    assert_eq!(group["subs"].as_array().unwrap().len(), 1);
    let covered = group["covered_patient_ids"].as_array().unwrap();
    assert!(covered.iter().any(|v| v == &json!(father.to_string())));
    assert!(covered.iter().any(|v| v == &json!(child.to_string())));

    // Reading the group from the sub resolves to the head.
    let (status, from_sub) = json_request(
        &app,
        "GET",
        &format!("/api/v1/orders/{sub}/group"),
        &pm,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(from_sub["head"]["id"], json!(head.to_string()));

    // Designate the payer (the father).
    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/orders/{head}/payer"),
        &pm,
        Some(json!({ "payer_contact_name": "Father pays for the family" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    // A cancelled sub (e.g. stopped by a contract termination) stays listed
    // but no longer counts toward the group total.
    sqlx::query("UPDATE orders SET status = 'cancelled', cancelled_at = now() WHERE id = $1")
        .bind(sub)
        .execute(&pool)
        .await
        .unwrap();
    let (status, with_cancelled_sub) = json_request(
        &app,
        "GET",
        &format!("/api/v1/orders/{head}/group"),
        &pm,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(with_cancelled_sub["subs"].as_array().unwrap().len(), 1);
    assert_eq!(with_cancelled_sub["subs"][0]["status"], "cancelled");
    assert_eq!(with_cancelled_sub["rollup_total_estimated"], "1000");

    // Ungroup -> the head reverts to standalone and the rollup drops to 1000.
    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/orders/{sub}/ungroup"),
        &pm,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let (status, after) = json_request(
        &app,
        "GET",
        &format!("/api/v1/orders/{head}/group"),
        &pm,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(after["head"]["order_role"], "standalone");
    assert_eq!(after["subs"].as_array().unwrap().len(), 0);
    assert_eq!(after["rollup_total_estimated"], "1000");
}

#[tokio::test]
async fn merge_orders_folds_groups_flattens_and_is_reversible() {
    let Some((app, pool, _admin_id)) = test_context().await else {
        return;
    };
    let tag = format!("merge-{}", Uuid::new_v4().simple());
    let pm_id = seed_user(&pool, &tag, "patient_manager").await;
    let pm = auth_header_for(pm_id, "patient_manager");

    let father = create_patient(&app, &pm, &format!("{tag}-f")).await;
    let c1 = create_patient(&app, &pm, &format!("{tag}-c1")).await;
    let c2 = create_patient(&app, &pm, &format!("{tag}-c2")).await;
    let c3 = create_patient(&app, &pm, &format!("{tag}-c3")).await;

    let target = insert_existing_order(&pool, father, pm_id, &format!("{tag}-T")).await;
    let b = insert_existing_order(&pool, c1, pm_id, &format!("{tag}-B")).await;
    let c_main = insert_existing_order(&pool, c2, pm_id, &format!("{tag}-CM")).await;
    let c_sub = insert_existing_order(&pool, c3, pm_id, &format!("{tag}-CS")).await;
    for (id, amount) in [(target, 1000), (b, 300), (c_main, 500), (c_sub, 200)] {
        sqlx::query(&format!(
            "UPDATE orders SET total_estimated = {amount} WHERE id = $1"
        ))
        .bind(id)
        .execute(&pool)
        .await
        .unwrap();
    }

    // Build a real group C: c_sub under c_main (c_main becomes MAIN).
    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/orders/{c_sub}/group"),
        &pm,
        Some(json!({ "head_order_id": c_main })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    // Empty source list is rejected.
    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/orders/{target}/merge"),
        &pm,
        Some(json!({ "source_order_ids": [] })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);

    // Merge the standalone B and the whole group C into the target. Group C is
    // flattened: c_sub re-parents up to the target too (one level only).
    let (status, group) = json_request(
        &app,
        "POST",
        &format!("/api/v1/orders/{target}/merge"),
        &pm,
        Some(json!({ "source_order_ids": [b, c_main] })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{group}");
    assert_eq!(group["head"]["id"], json!(target.to_string()));
    assert_eq!(group["head"]["order_role"], "main");
    assert_eq!(group["subs"].as_array().unwrap().len(), 3);
    assert_eq!(group["rollup_total_estimated"], "2000");
    let covered = group["covered_patient_ids"].as_array().unwrap();
    for p in [father, c1, c2, c3] {
        assert!(
            covered.iter().any(|v| v == &json!(p.to_string())),
            "missing {p}"
        );
    }

    // The flattened grandchild now resolves to the target as its head.
    let (status, from_sub) = json_request(
        &app,
        "GET",
        &format!("/api/v1/orders/{c_sub}/group"),
        &pm,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(from_sub["head"]["id"], json!(target.to_string()));

    // A sub-order cannot be a merge target (one level only).
    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/orders/{c_sub}/merge"),
        &pm,
        Some(json!({ "source_order_ids": [b] })),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);

    // Reversible: ungroup c_main -> it reverts to standalone and drops out of the
    // rollup, while its former grandchild c_sub stays under the target.
    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/orders/{c_main}/ungroup"),
        &pm,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let (status, after) = json_request(
        &app,
        "GET",
        &format!("/api/v1/orders/{target}/group"),
        &pm,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(after["subs"].as_array().unwrap().len(), 2);
    assert_eq!(after["rollup_total_estimated"], "1500");
    let (status, cm_group) = json_request(
        &app,
        "GET",
        &format!("/api/v1/orders/{c_main}/group"),
        &pm,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(cm_group["head"]["order_role"], "standalone");
}

#[tokio::test]
async fn appointment_creation_rejects_arbitrary_cross_patient_order_id() {
    let Some((app, pool, _admin_id)) = test_context().await else {
        return;
    };
    let tag = format!("apt-order-{}", Uuid::new_v4().simple());
    let pm_id = seed_user(&pool, &tag, "patient_manager").await;
    let pm = auth_header_for(pm_id, "patient_manager");

    let patient_a = create_patient(&app, &pm, &format!("{tag}-a")).await;
    let patient_b = create_patient(&app, &pm, &format!("{tag}-b")).await;
    let order_a = insert_existing_order(&pool, patient_a, pm_id, &format!("{tag}-oa")).await;

    let (status, body) = json_request(
        &app,
        "POST",
        "/api/v1/appointments",
        &pm,
        Some(json!({
            "patient_id": patient_b,
            "order_id": order_a,
            "appointment_type": "internal",
            "title": "Cross patient order should fail",
            "date": "2030-03-10"
        })),
    )
    .await;

    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
    assert_eq!(body["message"], "Order does not belong to patient");
}

#[tokio::test]
async fn main_order_accepts_related_patient_appointment() {
    let Some((app, pool, _admin_id)) = test_context().await else {
        return;
    };
    let tag = format!("apt-family-order-{}", Uuid::new_v4().simple());
    let pm_id = seed_user(&pool, &tag, "patient_manager").await;
    let pm = auth_header_for(pm_id, "patient_manager");

    let father = create_patient(&app, &pm, &format!("{tag}-father")).await;
    let child = create_patient(&app, &pm, &format!("{tag}-child")).await;
    let head_order = insert_existing_order(&pool, father, pm_id, &format!("{tag}-head")).await;
    sqlx::query("UPDATE orders SET order_role = 'main' WHERE id = $1")
        .bind(head_order)
        .execute(&pool)
        .await
        .unwrap();

    let (status, relation) = json_request(
        &app,
        "POST",
        &format!("/api/v1/patients/{father}/relations"),
        &pm,
        Some(json!({
            "related_patient_id": child,
            "related_name": "Child",
            "relation_type": "child",
            "is_emergency_contact": true
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{relation}");

    let (status, body) = json_request(
        &app,
        "POST",
        "/api/v1/appointments",
        &pm,
        Some(json!({
            "patient_id": child,
            "order_id": head_order,
            "appointment_type": "internal",
            "title": "Child appointment on family head order",
            "date": "2030-03-11"
        })),
    )
    .await;

    assert_eq!(status, StatusCode::CREATED, "{body}");
    let appointment_id = Uuid::parse_str(body["id"].as_str().expect("appointment id")).unwrap();
    let persisted_link: (Uuid, Option<Uuid>) =
        sqlx::query_as("SELECT patient_id, order_id FROM appointments WHERE id = $1")
            .bind(appointment_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(persisted_link.0, child);
    assert_eq!(persisted_link.1, Some(head_order));
}

#[tokio::test]
async fn cancelling_an_order_requires_a_reason_and_winds_down_open_work() {
    let Some((app, pool, _admin_id)) = test_context().await else {
        return;
    };
    let tag = unique_tag("order-cancel");
    let pm_id = seed_user(&pool, &tag, "patient_manager").await;
    let pm = auth_header_for(pm_id, "patient_manager");
    let patient_id = create_patient(&app, &pm, &tag).await;
    let order_id = create_order(&app, &pm, patient_id).await;

    let planned_line: Uuid = sqlx::query_scalar(
        r#"INSERT INTO order_leistungen (order_id, patient_id, description, quantity, unit_price, currency, vat_rate, status)
           VALUES ($1, $2, 'Dolmetscher', 2, 50, 'EUR', 19, 'planned')
           RETURNING id"#,
    )
    .bind(order_id)
    .bind(patient_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    let delivered_line: Uuid = sqlx::query_scalar(
        r#"INSERT INTO order_leistungen (order_id, patient_id, description, quantity, unit_price, currency, vat_rate, status, delivered_at)
           VALUES ($1, $2, 'Organisation der Behandlung', 1, 200, 'EUR', 0, 'delivered', now())
           RETURNING id"#,
    )
    .bind(order_id)
    .bind(patient_id)
    .fetch_one(&pool)
    .await
    .unwrap();

    let appointment_ids: Vec<Uuid> = sqlx::query_scalar(
        r#"INSERT INTO appointments (
                patient_id, order_id, appointment_type, title, date, status, checklist_phase, created_by
           ) VALUES
                ($1, $2, 'medical', 'Upcoming consultation', CURRENT_DATE + 5, 'planned', 'execution', $3),
                ($1, $2, 'medical', 'Confirmed MRI', CURRENT_DATE + 9, 'confirmed', 'execution', $3),
                ($1, $2, 'medical', 'Past consultation', CURRENT_DATE - 3, 'completed', 'execution', $3)
           RETURNING id"#,
    )
    .bind(patient_id)
    .bind(order_id)
    .bind(pm_id)
    .fetch_all(&pool)
    .await
    .unwrap();
    sqlx::query(
        r#"INSERT INTO reminders (appointment_id, user_id, remind_at, title)
           VALUES ($1, $2, now() + interval '4 days', 'Call the clinic')"#,
    )
    .bind(appointment_ids[1])
    .bind(pm_id)
    .execute(&pool)
    .await
    .unwrap();

    let (status, quote) = json_request(
        &app,
        "POST",
        &format!("/api/v1/orders/{order_id}/quotes"),
        &pm,
        Some(json!({})),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{quote}");
    let quote_id = Uuid::parse_str(quote["id"].as_str().unwrap()).unwrap();

    let amendment_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO order_amendments (order_id, delta_amount, agreed_note, requested_by, vat_treatment, vat_rate)
           VALUES ($1, 80, 'Extra hour', $2, 'standard_vat', 19)
           RETURNING id"#,
    )
    .bind(order_id)
    .bind(pm_id)
    .fetch_one(&pool)
    .await
    .unwrap();

    // A reason is required.
    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/orders/{order_id}/status"),
        &pm,
        Some(json!({ "status": "cancelled" })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");

    // The preview shows what would change, and changes nothing.
    let (status, preview) = json_request(
        &app,
        "GET",
        &format!("/api/v1/orders/{order_id}/cancellation-preview"),
        &pm,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{preview}");
    assert_eq!(
        preview["cancelled_services"]
            .as_array()
            .unwrap()
            .iter()
            .map(|item| item["id"].clone())
            .collect::<Vec<_>>(),
        vec![json!(planned_line.to_string())]
    );
    assert_eq!(preview["cancelled_services"][0]["gross"], "119");
    assert_eq!(
        preview["cancelled_appointment_ids"]
            .as_array()
            .unwrap()
            .len(),
        2
    );
    assert_eq!(
        preview["closed_quotes"][0]["id"],
        json!(quote_id.to_string())
    );
    assert_eq!(preview["settlement"]["accrued_gross"], "200");
    let still_planned: String =
        sqlx::query_scalar("SELECT status FROM order_leistungen WHERE id = $1")
            .bind(planned_line)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(still_planned, "planned");

    let (status, cancelled) = json_request(
        &app,
        "POST",
        &format!("/api/v1/orders/{order_id}/status"),
        &pm,
        Some(json!({ "status": "cancelled", "reason": "Patient postponed the treatment" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{cancelled}");
    assert_eq!(
        cancelled["cancellation"]["settlement"]["accrued_gross"],
        "200"
    );
    assert_eq!(
        cancelled["cancellation"]["settlement"]["balance_gross"],
        "200"
    );

    let order = sqlx::query(
        "SELECT status, cancellation_reason, cancelled_by, cancelled_at FROM orders WHERE id = $1",
    )
    .bind(order_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(order.get::<String, _>("status"), "cancelled");
    assert_eq!(
        order
            .get::<Option<String>, _>("cancellation_reason")
            .as_deref(),
        Some("Patient postponed the treatment")
    );
    assert_eq!(order.get::<Option<Uuid>, _>("cancelled_by"), Some(pm_id));

    let lines: Vec<(Uuid, String, Option<Uuid>, Option<String>)> = sqlx::query_as(
        "SELECT id, status, cancelled_by, cancellation_reason FROM order_leistungen WHERE order_id = $1",
    )
    .bind(order_id)
    .fetch_all(&pool)
    .await
    .unwrap();
    let planned = lines.iter().find(|line| line.0 == planned_line).unwrap();
    assert_eq!(planned.1, "cancelled");
    assert_eq!(planned.2, Some(pm_id));
    assert_eq!(
        planned.3.as_deref(),
        Some("Patient postponed the treatment")
    );
    let delivered = lines.iter().find(|line| line.0 == delivered_line).unwrap();
    assert_eq!(delivered.1, "delivered");

    let appointment_statuses: Vec<(Uuid, String)> =
        sqlx::query_as("SELECT id, status FROM appointments WHERE order_id = $1")
            .bind(order_id)
            .fetch_all(&pool)
            .await
            .unwrap();
    for (id, status) in &appointment_statuses {
        let expected = if *id == appointment_ids[2] {
            "completed"
        } else {
            "cancelled"
        };
        assert_eq!(status, expected, "appointment {id}");
    }
    let open_reminders: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM reminders WHERE appointment_id = $1 AND NOT is_completed",
    )
    .bind(appointment_ids[1])
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(open_reminders, 0);

    let quote_status: String = sqlx::query_scalar("SELECT status FROM quotes WHERE id = $1")
        .bind(quote_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(quote_status, "rejected");
    let closing_version: Option<String> = sqlx::query_scalar(
        "SELECT change_reason FROM quote_versions WHERE quote_id = $1 ORDER BY version_number DESC LIMIT 1",
    )
    .bind(quote_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(closing_version.as_deref(), Some("order_cancelled"));
    let amendment_status: String =
        sqlx::query_scalar("SELECT status FROM order_amendments WHERE id = $1")
            .bind(amendment_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(amendment_status, "rejected");

    // The order shows what stays as the basis for final billing or a refund.
    let (status, detail) = json_request(
        &app,
        "GET",
        &format!("/api/v1/orders/{order_id}"),
        &pm,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{detail}");
    assert_eq!(detail["status"], "cancelled");
    assert_eq!(
        detail["cancellation_reason"],
        "Patient postponed the treatment"
    );
    assert_eq!(detail["cancellation"]["settlement"]["accrued_gross"], "200");
    assert_eq!(
        detail["cancellation"]["settlement"]["uninvoiced_gross"],
        "200"
    );

    // Repeating the request changes nothing; the order cannot be reopened.
    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/orders/{order_id}/status"),
        &pm,
        Some(json!({ "status": "cancelled", "reason": "Again" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let reason: Option<String> =
        sqlx::query_scalar("SELECT cancellation_reason FROM orders WHERE id = $1")
            .bind(order_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(reason.as_deref(), Some("Patient postponed the treatment"));
    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/orders/{order_id}/status"),
        &pm,
        Some(json!({ "status": "active" })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
}
