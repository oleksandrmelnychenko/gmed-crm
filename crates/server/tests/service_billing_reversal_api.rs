//! Owner decision 2026-09-29: services whose billing is in force can be
//! cancelled. An approved line that no released invoice bills is cancelled
//! with a reason; an invoiced line is cancelled together with a credit note
//! (finance roles); appointments with an approved interpreter report and
//! billed concierge services are cancelled with their billing reversed, in
//! one transaction. Synthetic data only.

mod support;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use rust_decimal::Decimal;
use serde_json::{Value, json};
use sqlx::PgPool;
use std::str::FromStr;
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
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(json!(null)),
    )
}

fn dec(value: &str) -> Decimal {
    Decimal::from_str(value).unwrap()
}

fn money(value: &Value) -> Decimal {
    Decimal::from_str(value.as_str().unwrap_or("0")).unwrap()
}

async fn seed_user(pool: &PgPool, role: &str, tag: &str) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO users (email, password_hash, name, role)
           VALUES ($1, 'test-hash', $2, $3)
           RETURNING id"#,
    )
    .bind(format!(
        "reversal-{role}-{tag}-{}@example.test",
        Uuid::new_v4().simple()
    ))
    .bind(format!("Reversal {role} {tag}"))
    .bind(role)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn assign(pool: &PgPool, patient_id: Uuid, user_id: Uuid, assigned_by: Uuid) {
    sqlx::query(
        "INSERT INTO patient_assignments (patient_id, user_id, assigned_by) VALUES ($1, $2, $3)",
    )
    .bind(patient_id)
    .bind(user_id)
    .bind(assigned_by)
    .execute(pool)
    .await
    .unwrap();
}

struct Case {
    patient_id: Uuid,
    order_id: Uuid,
    order_number: String,
    pm_id: Uuid,
    billing_id: Uuid,
    concierge_id: Uuid,
    sales_id: Uuid,
}

async fn case(pool: &PgPool, admin_id: Uuid, tag: &str) -> Case {
    let patient_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO patients (patient_id, first_name, last_name, birth_date, gender, created_by)
           VALUES ($1, 'Storno', 'Patient', '1990-01-01', 'diverse', $2)
           RETURNING id"#,
    )
    .bind(format!("PT-{tag}"))
    .bind(admin_id)
    .fetch_one(pool)
    .await
    .unwrap();
    let order_number = format!("ORD-{tag}");
    let order_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO orders (order_number, patient_id, phase, status, needs_description, created_by)
           VALUES ($1, $2, 'execution', 'active', 'Synthetic needs', $3)
           RETURNING id"#,
    )
    .bind(&order_number)
    .bind(patient_id)
    .bind(admin_id)
    .fetch_one(pool)
    .await
    .unwrap();
    let pm_id = seed_user(pool, "patient_manager", tag).await;
    let billing_id = seed_user(pool, "billing", tag).await;
    let concierge_id = seed_user(pool, "concierge", tag).await;
    let sales_id = seed_user(pool, "sales", tag).await;
    for user_id in [pm_id, concierge_id] {
        assign(pool, patient_id, user_id, admin_id).await;
    }
    Case {
        patient_id,
        order_id,
        order_number,
        pm_id,
        billing_id,
        concierge_id,
        sales_id,
    }
}

async fn seed_line(
    pool: &PgPool,
    case: &Case,
    description: &str,
    status: &str,
    report_id: Option<Uuid>,
) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO order_leistungen (
                order_id, patient_id, description, quantity, unit_price, vat_rate, status,
                delivered_at, approved_at, source_interpreter_report_id
           ) VALUES (
                $1, $2, $3, 1, 100, 19, $4,
                CASE WHEN $4 <> 'planned' THEN now() END,
                CASE WHEN $4 IN ('approved', 'invoiced') THEN now() END,
                $5
           ) RETURNING id"#,
    )
    .bind(case.order_id)
    .bind(case.patient_id)
    .bind(description)
    .bind(status)
    .bind(report_id)
    .fetch_one(pool)
    .await
    .unwrap()
}

/// An invoice billing `service_id` (100 + 19 % VAT) and a second, unrelated
/// line (50 + 19 % VAT).
async fn seed_invoice(
    pool: &PgPool,
    admin_id: Uuid,
    case: &Case,
    service_id: Uuid,
    status: &str,
    number: Option<&str>,
) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO invoices (
                order_id, patient_id, invoice_number, invoice_type, status,
                issued_at, due_date, total_net, total_vat, total_gross,
                paid_amount, line_items, portal_visible, hide_amounts_from_patient, created_by
           ) VALUES (
                $1, $2, $3, 'final', $4,
                now() - interval '3 days',
                CURRENT_DATE + 10, 150, 28.50, 178.50, 0, $5, true, false, $6
           ) RETURNING id"#,
    )
    .bind(case.order_id)
    .bind(case.patient_id)
    .bind(number)
    .bind(status)
    .bind(json!([
        {
            "description": "Transfer synthetic",
            "quantity": "1", "unit_price": "100", "vat_rate": "19",
            "line_net": "100", "line_vat": "19", "line_gross": "119",
            "source_order_leistung_id": service_id,
        },
        {
            "description": "Other synthetic",
            "quantity": "1", "unit_price": "50", "vat_rate": "19",
            "line_net": "50", "line_vat": "9.50", "line_gross": "59.50",
        }
    ]))
    .bind(admin_id)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn line_status(pool: &PgPool, line_id: Uuid) -> (String, Option<String>) {
    sqlx::query_as("SELECT status, cancellation_reason FROM order_leistungen WHERE id = $1")
        .bind(line_id)
        .fetch_one(pool)
        .await
        .unwrap()
}

async fn audit_count(pool: &PgPool, action: &str, entity_id: Uuid) -> i64 {
    sqlx::query_scalar("SELECT count(*) FROM audit_log WHERE action = $1 AND entity_id = $2")
        .bind(action)
        .bind(entity_id)
        .fetch_one(pool)
        .await
        .unwrap()
}

fn cancel_path(case: &Case, line_id: Uuid) -> String {
    format!(
        "/api/v1/orders/{}/leistungen/{line_id}/cancel",
        case.order_id
    )
}

#[tokio::test]
async fn approved_lines_without_released_invoice_are_cancelled_with_a_reason() {
    let Some(ctx) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let tag = Uuid::new_v4().simple().to_string();
    let case = case(&ctx.pool, ctx.admin_id, &tag).await;
    let pm = auth_header_for(case.pm_id, "patient_manager");
    let approved = seed_line(&ctx.pool, &case, "Approved transfer", "approved", None).await;
    let delivered = seed_line(&ctx.pool, &case, "Delivered transfer", "delivered", None).await;
    let reason = "Service was not needed after all";

    // Other roles cannot cancel; a reason is required.
    let (status, body) = json_request(
        &ctx.app,
        "POST",
        &cancel_path(&case, approved),
        &auth_header_for(case.sales_id, "sales"),
        Some(json!({ "reason": reason })),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN, "{body}");
    let (status, body) = json_request(
        &ctx.app,
        "POST",
        &cancel_path(&case, approved),
        &pm,
        Some(json!({ "reason": "no" })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");

    // The preview tells the dialog that no credit note is needed.
    let (status, preview) = json_request(
        &ctx.app,
        "GET",
        &format!(
            "/api/v1/orders/{}/leistungen/{approved}/cancellation-preview",
            case.order_id
        ),
        &pm,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{preview}");
    assert_eq!(preview["requires_credit_note"], false);
    assert!(preview["blocked_reason"].is_null(), "{preview}");

    let (status, body) = json_request(
        &ctx.app,
        "POST",
        &cancel_path(&case, approved),
        &pm,
        Some(json!({ "reason": reason })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["status"], "cancelled");
    assert_eq!(body["previous_status"], "approved");
    assert_eq!(body["credit_notes"], json!([]));
    assert_eq!(
        line_status(&ctx.pool, approved).await,
        ("cancelled".to_string(), Some(reason.to_string()))
    );
    // Audited in the same transaction: the row is there right after the answer.
    let audited: i64 = sqlx::query_scalar(
        r#"SELECT count(*) FROM audit_log
           WHERE action = 'cancel_order_service' AND entity_id = $1
             AND context->>'previous_status' = 'approved'
             AND context->>'origin' = 'order_service'"#,
    )
    .bind(approved)
    .fetch_one(&ctx.pool)
    .await
    .unwrap();
    assert_eq!(audited, 1);

    // Billing (invoices.finance) may cancel too.
    let (status, body) = json_request(
        &ctx.app,
        "POST",
        &cancel_path(&case, delivered),
        &auth_header_for(case.billing_id, "billing"),
        Some(json!({ "reason": reason })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["previous_status"], "delivered");

    // Already cancelled: 409.
    let (status, body) = json_request(
        &ctx.app,
        "POST",
        &cancel_path(&case, approved),
        &pm,
        Some(json!({ "reason": reason })),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{body}");
    assert_eq!(body["code"], "order_service_already_cancelled");

    // A line reserved by a draft invoice is refused until the draft is
    // cancelled; the answer names the draft.
    let drafted = seed_line(&ctx.pool, &case, "Drafted transfer", "approved", None).await;
    let draft_id = seed_invoice(&ctx.pool, ctx.admin_id, &case, drafted, "draft", None).await;
    let (status, body) = json_request(
        &ctx.app,
        "POST",
        &cancel_path(&case, drafted),
        &pm,
        Some(json!({ "reason": reason })),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{body}");
    assert_eq!(body["code"], "order_service_on_draft_invoice");
    assert_eq!(body["draft_invoice_ids"], json!([draft_id]));
    assert_eq!(line_status(&ctx.pool, drafted).await.0, "approved");
    sqlx::query("UPDATE invoices SET status = 'cancelled' WHERE id = $1")
        .bind(draft_id)
        .execute(&ctx.pool)
        .await
        .unwrap();
    let (status, body) = json_request(
        &ctx.app,
        "POST",
        &cancel_path(&case, drafted),
        &pm,
        Some(json!({ "reason": reason })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
}

#[tokio::test]
async fn invoiced_lines_are_cancelled_with_a_credit_note_by_finance_roles() {
    let Some(ctx) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let tag = Uuid::new_v4().simple().to_string();
    let case = case(&ctx.pool, ctx.admin_id, &tag).await;
    let pm = auth_header_for(case.pm_id, "patient_manager");
    let billing = auth_header_for(case.billing_id, "billing");
    let line = seed_line(&ctx.pool, &case, "Invoiced transfer", "invoiced", None).await;
    let invoice_id = seed_invoice(
        &ctx.pool,
        ctx.admin_id,
        &case,
        line,
        "sent",
        Some(&format!("INV-{tag}")),
    )
    .await;
    let reason = "Transfer was cancelled by the partner";

    let (status, preview) = json_request(
        &ctx.app,
        "GET",
        &format!(
            "/api/v1/orders/{}/leistungen/{line}/cancellation-preview",
            case.order_id
        ),
        &billing,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{preview}");
    assert_eq!(preview["requires_credit_note"], true);
    assert_eq!(money(&preview["credit_total_gross"]), dec("119"));
    assert_eq!(
        preview["credit_notes"][0]["invoice_id"],
        invoice_id.to_string()
    );
    assert_eq!(preview["can_issue_credit_note"], true);

    // A patient manager cannot issue credit notes.
    let (status, body) = json_request(
        &ctx.app,
        "POST",
        &cancel_path(&case, line),
        &pm,
        Some(json!({ "reason": reason, "issue_credit_note": true })),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN, "{body}");
    assert_eq!(body["code"], "order_service_reversal_requires_finance");

    // Without the confirmation nothing happens; the answer carries the amount.
    let (status, body) = json_request(
        &ctx.app,
        "POST",
        &cancel_path(&case, line),
        &billing,
        Some(json!({ "reason": reason })),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{body}");
    assert_eq!(body["code"], "order_service_cancel_requires_credit_note");
    assert_eq!(money(&body["reversal"]["credit_total_gross"]), dec("119"));
    assert_eq!(line_status(&ctx.pool, line).await.0, "invoiced");

    let (status, body) = json_request(
        &ctx.app,
        "POST",
        &cancel_path(&case, line),
        &billing,
        Some(json!({ "reason": reason, "issue_credit_note": true })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["previous_status"], "invoiced");
    let credit = &body["credit_notes"][0];
    let number = credit["document_number"].as_str().unwrap();
    assert!(number.starts_with("CN-"), "{number}");
    assert_eq!(money(&credit["amount_gross"]), dec("119"));
    assert_eq!(money(&credit["amount_vat"]), dec("19"));
    let credit_id =
        Uuid::parse_str(credit["credit_note_transaction_id"].as_str().unwrap()).unwrap();
    assert_eq!(line_status(&ctx.pool, line).await.0, "cancelled");

    // Balances, the credited line, the archived PDF and the link to the line.
    let (credited, source, credited_line): (Decimal, Option<Uuid>, Option<i64>) = sqlx::query_as(
        r#"SELECT invoice.credited_amount, credit.source_order_leistung_id,
                  (credit.line_items -> 0 ->> 'invoice_line_index')::BIGINT
           FROM invoice_credit_note_transactions credit
           JOIN invoices invoice ON invoice.id = credit.invoice_id
           WHERE credit.id = $1"#,
    )
    .bind(credit_id)
    .fetch_one(&ctx.pool)
    .await
    .unwrap();
    assert_eq!(credited, dec("119"));
    assert_eq!(source, Some(line));
    assert_eq!(credited_line, Some(0));
    let documents: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM invoice_documents WHERE credit_note_transaction_id = $1 AND generation_trigger = 'issue'",
    )
    .bind(credit_id)
    .fetch_one(&ctx.pool)
    .await
    .unwrap();
    assert_eq!(documents, 1);
    let (status, detail) = json_request(
        &ctx.app,
        "GET",
        &format!("/api/v1/invoices/{invoice_id}"),
        &billing,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{detail}");
    assert_eq!(money(&detail["balance_due"]), dec("59.5"));
    assert_eq!(
        audit_count(&ctx.pool, "cancel_order_service", line).await,
        1
    );
    assert_eq!(
        audit_count(&ctx.pool, "credit_note_created", invoice_id).await,
        1
    );

    // The credit note belongs to the cancellation and is not reversed alone.
    let (status, body) = json_request(
        &ctx.app,
        "POST",
        &format!("/api/v1/invoices/{invoice_id}/credit-notes/{credit_id}/reversal"),
        &billing,
        Some(json!({ "reason": "Synthetic reversal attempt" })),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{body}");
    assert_eq!(body["code"], "credit_note_of_cancelled_order_service");
}

async fn seed_visit_with_report(
    pool: &PgPool,
    admin_id: Uuid,
    case: &Case,
    tag: &str,
    start: &str,
) -> (Uuid, Uuid) {
    let interpreter_id = seed_user(pool, "interpreter", tag).await;
    let appointment_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO appointments (
                patient_id, appointment_type, title, date, time_start, time_end, status,
                created_by, order_id, interpreter_id, interpreter_response
           ) VALUES ($1, 'internal', 'Billed visit', $2, $3::time, $3::time + interval '1 hour',
                     'confirmed', $4, $5, $6, 'accepted')
           RETURNING id"#,
    )
    .bind(case.patient_id)
    .bind(gmed_server::app_time::today())
    .bind(start)
    .bind(admin_id)
    .bind(case.order_id)
    .bind(interpreter_id)
    .fetch_one(pool)
    .await
    .unwrap();
    let report_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO interpreter_reports (appointment_id, interpreter_id, hours, report_text,
                                          approval_status, approved_by, approved_at)
           VALUES ($1, $2, 1.0, 'Synthetic', 'approved', $3, now()) RETURNING id"#,
    )
    .bind(appointment_id)
    .bind(interpreter_id)
    .bind(admin_id)
    .fetch_one(pool)
    .await
    .unwrap();
    (appointment_id, report_id)
}

async fn cancel_appointment(
    app: &axum::Router,
    bearer: &str,
    appointment_id: Uuid,
    reversal: Option<&str>,
) -> (StatusCode, Value) {
    let body = match reversal {
        Some(reason) => json!({
            "status": "cancelled",
            "reverse_billing": true,
            "billing_reversal_reason": reason,
        }),
        None => json!({ "status": "cancelled" }),
    };
    json_request(
        app,
        "POST",
        &format!("/api/v1/appointments/{appointment_id}/status"),
        bearer,
        Some(body),
    )
    .await
}

#[tokio::test]
async fn appointments_with_an_approved_report_are_cancelled_with_billing_reversal() {
    let Some(ctx) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let tag = Uuid::new_v4().simple().to_string();
    let case = case(&ctx.pool, ctx.admin_id, &tag).await;
    let pm = auth_header_for(case.pm_id, "patient_manager");
    let ceo = auth_header_for(ctx.admin_id, "ceo");
    let reason = "Patient did not attend, hours are not charged";

    // Approved line, not invoiced: the patient manager reverses it.
    let (appointment_id, report_id) =
        seed_visit_with_report(&ctx.pool, ctx.admin_id, &case, &tag, "08:00").await;
    let line = seed_line(
        &ctx.pool,
        &case,
        "Dolmetscher synthetic",
        "approved",
        Some(report_id),
    )
    .await;
    let (status, body) = cancel_appointment(&ctx.app, &pm, appointment_id, None).await;
    assert_eq!(status, StatusCode::CONFLICT, "{body}");
    assert_eq!(body["code"], "appointment_cancel_billed_report");
    assert_eq!(body["reverse_billing_available"], true);
    assert_eq!(body["reversal"]["requires_credit_note"], false);
    assert_eq!(body["order_number"], case.order_number);
    let (status, body) = cancel_appointment(&ctx.app, &pm, appointment_id, Some(" ")).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
    let (status, body) = cancel_appointment(&ctx.app, &pm, appointment_id, Some(reason)).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["billing_reversals"][0]["id"], line.to_string());
    assert_eq!(line_status(&ctx.pool, line).await.0, "cancelled");
    let (appointment_status, reversed_reason): (String, Option<String>) = sqlx::query_as(
        r#"SELECT a.status, report.billing_reversal_reason
           FROM appointments a JOIN interpreter_reports report ON report.appointment_id = a.id
           WHERE a.id = $1"#,
    )
    .bind(appointment_id)
    .fetch_one(&ctx.pool)
    .await
    .unwrap();
    assert_eq!(appointment_status, "cancelled");
    assert_eq!(reversed_reason.as_deref(), Some(reason));
    assert_eq!(
        audit_count(&ctx.pool, "reverse_interpreter_report_billing", report_id).await,
        1
    );
    let origin: String = sqlx::query_scalar(
        "SELECT context->>'origin' FROM audit_log WHERE action = 'cancel_order_service' AND entity_id = $1",
    )
    .bind(line)
    .fetch_one(&ctx.pool)
    .await
    .unwrap();
    assert_eq!(origin, "appointment_cancellation");

    // Invoiced line: the patient manager is refused (credit note), the CEO
    // cancels with a credit note; everything or nothing is written.
    let (appointment_id, report_id) =
        seed_visit_with_report(&ctx.pool, ctx.admin_id, &case, &format!("{tag}-2"), "10:00").await;
    let line = seed_line(
        &ctx.pool,
        &case,
        "Dolmetscher invoiced",
        "invoiced",
        Some(report_id),
    )
    .await;
    let invoice_id = seed_invoice(
        &ctx.pool,
        ctx.admin_id,
        &case,
        line,
        "sent",
        Some(&format!("INV-A-{tag}")),
    )
    .await;
    let (status, body) = cancel_appointment(&ctx.app, &pm, appointment_id, Some(reason)).await;
    assert_eq!(status, StatusCode::FORBIDDEN, "{body}");
    assert_eq!(body["code"], "order_service_reversal_requires_finance");
    let status_after: String = sqlx::query_scalar("SELECT status FROM appointments WHERE id = $1")
        .bind(appointment_id)
        .fetch_one(&ctx.pool)
        .await
        .unwrap();
    assert_eq!(status_after, "confirmed");
    let (status, body) = cancel_appointment(&ctx.app, &ceo, appointment_id, Some(reason)).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let credit = &body["billing_reversals"][0]["credit_notes"][0];
    assert!(
        credit["document_number"]
            .as_str()
            .unwrap()
            .starts_with("CN-")
    );
    assert_eq!(credit["invoice_id"], invoice_id.to_string());
    assert_eq!(line_status(&ctx.pool, line).await.0, "cancelled");

    // Approved report without a line yet: the billing is reversed on the
    // report and the billing sync never bills it afterwards.
    let (appointment_id, report_id) =
        seed_visit_with_report(&ctx.pool, ctx.admin_id, &case, &format!("{tag}-3"), "12:00").await;
    let (status, body) = cancel_appointment(&ctx.app, &pm, appointment_id, Some(reason)).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    gmed_server::routes::appointments::run_interpreter_report_billing_sync_once(&ctx.state)
        .await
        .unwrap();
    let billed: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM order_leistungen WHERE source_interpreter_report_id = $1",
    )
    .bind(report_id)
    .fetch_one(&ctx.pool)
    .await
    .unwrap();
    assert_eq!(billed, 0);
}

async fn create_billed_service(ctx: &support::TestSuiteContext, case: &Case, title: &str) -> Uuid {
    let pm = auth_header_for(case.pm_id, "patient_manager");
    let (status, body) = json_request(
        &ctx.app,
        "POST",
        "/api/v1/concierge-services",
        &pm,
        Some(json!({
            "patient_id": case.patient_id,
            "assigned_concierge_id": case.concierge_id,
            "service_kind": "transfer",
            "title": title,
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    let service_id = Uuid::parse_str(body["id"].as_str().unwrap()).unwrap();
    for next in ["in_service", "completed"] {
        let (status, body) = json_request(
            &ctx.app,
            "POST",
            &format!("/api/v1/concierge-services/{service_id}/update"),
            &pm,
            Some(json!({ "status": next })),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{next}: {body}");
    }
    let (status, body) = json_request(
        &ctx.app,
        "POST",
        &format!("/api/v1/concierge-services/{service_id}/update"),
        &auth_header_for(case.billing_id, "billing"),
        Some(json!({ "billing_status": "billed", "actual_cost": 119.0 })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    service_id
}

async fn service_state(pool: &PgPool, service_id: Uuid) -> (String, String, String) {
    sqlx::query_as(
        r#"SELECT service.status, service.billing_status, task.status
           FROM concierge_services service
           JOIN tasks task ON task.id = concierge_service_canonical_task_id(service.id)
           WHERE service.id = $1"#,
    )
    .bind(service_id)
    .fetch_one(pool)
    .await
    .unwrap()
}

#[tokio::test]
async fn billed_concierge_services_are_cancelled_with_billing_reversal() {
    let Some(ctx) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let tag = Uuid::new_v4().simple().to_string();
    let case = case(&ctx.pool, ctx.admin_id, &tag).await;
    let pm = auth_header_for(case.pm_id, "patient_manager");
    let ceo = auth_header_for(ctx.admin_id, "ceo");
    let reason = "Partner cancelled the transfer";
    let service_id = create_billed_service(&ctx, &case, "Airport transfer").await;
    let line = seed_line(&ctx.pool, &case, "Airport transfer line", "invoiced", None).await;
    let invoice_id = seed_invoice(
        &ctx.pool,
        ctx.admin_id,
        &case,
        line,
        "sent",
        Some(&format!("INV-C-{tag}")),
    )
    .await;

    // The ordinary cancellation still answers 409 with the hint.
    let (status, body) = json_request(
        &ctx.app,
        "POST",
        &format!("/api/v1/concierge-services/{service_id}/update"),
        &pm,
        Some(json!({ "status": "cancelled" })),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{body}");

    // The options list the patient's service line with its credit note.
    let (status, options) = json_request(
        &ctx.app,
        "GET",
        &format!("/api/v1/concierge-services/{service_id}/billing-reversal-options"),
        &pm,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{options}");
    let listed = options["order_lines"]
        .as_array()
        .unwrap()
        .iter()
        .find(|row| row["order_leistung_id"] == line.to_string())
        .expect("the invoiced service line is offered");
    assert_eq!(listed["requires_credit_note"], true);
    assert_eq!(money(&listed["credit_total_gross"]), dec("119"));
    assert_eq!(options["can_issue_credit_note"], false);

    let path = format!("/api/v1/concierge-services/{service_id}/cancel-with-billing-reversal");
    let (status, body) = json_request(
        &ctx.app,
        "POST",
        &path,
        &auth_header_for(case.concierge_id, "concierge"),
        Some(json!({ "reason": reason })),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN, "{body}");
    let (status, body) = json_request(
        &ctx.app,
        "POST",
        &path,
        &pm,
        Some(json!({ "reason": reason, "order_leistung_id": line, "issue_credit_note": true })),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN, "{body}");
    assert_eq!(body["code"], "order_service_reversal_requires_finance");
    assert_eq!(
        service_state(&ctx.pool, service_id).await,
        (
            "completed".to_string(),
            "billed".to_string(),
            "completed".to_string()
        )
    );

    let (status, body) = json_request(
        &ctx.app,
        "POST",
        &path,
        &ceo,
        Some(json!({ "reason": reason, "order_leistung_id": line, "issue_credit_note": true })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["status"], "cancelled");
    assert_eq!(body["billing_status"], "reversed");
    assert_eq!(body["billing_reversal_order_leistung_id"], line.to_string());
    let credit = &body["billing_reversal"]["credit_notes"][0];
    assert!(
        credit["document_number"]
            .as_str()
            .unwrap()
            .starts_with("CN-")
    );
    assert_eq!(credit["invoice_id"], invoice_id.to_string());
    assert_eq!(
        service_state(&ctx.pool, service_id).await,
        (
            "cancelled".to_string(),
            "reversed".to_string(),
            "cancelled".to_string()
        )
    );
    assert_eq!(line_status(&ctx.pool, line).await.0, "cancelled");
    assert_eq!(
        audit_count(&ctx.pool, "reverse_concierge_service_billing", service_id).await,
        1
    );

    // Reopening the service starts a new billing cycle.
    let (task_id, updated_at): (Uuid, String) = sqlx::query_as(
        r#"SELECT id, to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
           FROM tasks WHERE id = concierge_service_canonical_task_id($1)"#,
    )
    .bind(service_id)
    .fetch_one(&ctx.pool)
    .await
    .unwrap();
    let (status, body) = json_request(
        &ctx.app,
        "POST",
        &format!("/api/v1/concierge-operational-items/{task_id}/status"),
        &pm,
        Some(json!({ "status": "open", "expected_updated_at": updated_at })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(service_state(&ctx.pool, service_id).await.1, "draft");

    // A service billed outside GMED: the patient manager reverses its
    // billing state without an order line.
    let outside = create_billed_service(&ctx, &case, "Hotel booking").await;
    let (status, body) = json_request(
        &ctx.app,
        "POST",
        &format!("/api/v1/concierge-services/{outside}/cancel-with-billing-reversal"),
        &pm,
        Some(json!({ "reason": reason })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["billing_status"], "reversed");
    assert!(body["billing_reversal_order_leistung_id"].is_null());

    // Not billed: the ordinary cancellation applies.
    let (status, body) = json_request(
        &ctx.app,
        "POST",
        &format!("/api/v1/concierge-services/{outside}/cancel-with-billing-reversal"),
        &pm,
        Some(json!({ "reason": reason })),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{body}");
    assert_eq!(body["code"], "concierge_service_not_billed");
}
