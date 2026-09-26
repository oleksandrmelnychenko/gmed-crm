mod support;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use rust_decimal::Decimal;
use serde_json::{Value, json};
use sqlx::PgPool;
use tower::ServiceExt;
use uuid::Uuid;

use gmed_server::auth::jwt;

const TEST_SECRET: &str = "test-secret-at-least-32-characters-long!!";

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
        .body(body.map_or_else(Body::empty, |value| {
            Body::from(serde_json::to_vec(&value).unwrap())
        }))
        .unwrap();
    let response = app.clone().oneshot(request).await.unwrap();
    let status = response.status();
    let bytes = axum::body::to_bytes(response.into_body(), 4 * 1024 * 1024)
        .await
        .unwrap();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(json!(null)),
    )
}

fn auth_header(user_id: Uuid, role: &str) -> String {
    let token = jwt::issue_access_token(TEST_SECRET, user_id, role, Uuid::new_v4()).unwrap();
    format!("Bearer {token}")
}

fn money(value: &Value) -> Decimal {
    value
        .as_str()
        .unwrap_or_else(|| panic!("money value expected, got {value:?}"))
        .parse::<Decimal>()
        .unwrap()
}

fn cents(value: i64) -> Decimal {
    Decimal::new(value, 2)
}

async fn seed_user(pool: &PgPool, tag: &str, role: &str) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO users (email, password_hash, name, role)
           VALUES ($1, 'test-password-hash', $2, $3)
           RETURNING id"#,
    )
    .bind(format!("{tag}-{role}@example.com"))
    .bind(format!("{role} {tag}"))
    .bind(role)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn seed_assignment(pool: &PgPool, patient_id: Uuid, user_id: Uuid, assigned_by: Uuid) {
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

#[allow(clippy::too_many_arguments)]
async fn seed_service(
    pool: &PgPool,
    order_id: Uuid,
    patient_id: Uuid,
    description: &str,
    quantity: i64,
    unit_price: i64,
    status: &str,
    agency_service_id: Option<Uuid>,
) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO order_leistungen (
               order_id, patient_id, description, quantity, unit_price, currency,
               vat_rate, status, delivered_at, agency_service_id
           ) VALUES ($1, $2, $3, $4, $5, 'EUR', 19, $6,
                     CASE WHEN $6 = 'planned' THEN NULL ELSE now() END, $7)
           RETURNING id"#,
    )
    .bind(order_id)
    .bind(patient_id)
    .bind(description)
    .bind(Decimal::new(quantity, 0))
    .bind(Decimal::new(unit_price, 0))
    .bind(status)
    .bind(agency_service_id)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn service_status(pool: &PgPool, service_id: Uuid) -> String {
    sqlx::query_scalar("SELECT status FROM order_leistungen WHERE id = $1")
        .bind(service_id)
        .fetch_one(pool)
        .await
        .unwrap()
}

async fn record_payment(app: &axum::Router, bearer: &str, invoice_id: &str, amount: &str) -> Value {
    let (status, body) = json_request(
        app,
        "POST",
        &format!("/api/v1/invoices/{invoice_id}/payments"),
        bearer,
        Some(json!({
            "request_id": Uuid::new_v4(),
            "amount_gross": amount,
            "payment_method": "bank_transfer",
            "payment_reference": "TERMINATION-TEST",
            "received_on": chrono::Utc::now().date_naive().to_string(),
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "payment response: {body:?}");
    body
}

#[tokio::test]
async fn contract_termination_stops_open_orders_and_settles_what_accrued() {
    let Some(context) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let app = context.app;
    let pool = context.pool;
    let admin_id = context.admin_id;
    let tag = Uuid::new_v4().simple().to_string();

    let patient_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO patients (patient_id, first_name, last_name, birth_date, gender, created_by)
           VALUES ($1, 'Termination', 'Settlement', '1985-05-05', 'diverse', $2)
           RETURNING id"#,
    )
    .bind(format!("PT-{tag}"))
    .bind(admin_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    let manager_id = seed_user(&pool, &tag, "patient_manager").await;
    let billing_id = seed_user(&pool, &tag, "billing").await;
    let interpreter_id = seed_user(&pool, &tag, "interpreter").await;
    for user_id in [manager_id, billing_id, interpreter_id] {
        seed_assignment(&pool, patient_id, user_id, admin_id).await;
    }
    let manager = auth_header(manager_id, "patient_manager");
    let billing = auth_header(billing_id, "billing");
    let interpreter = auth_header(interpreter_id, "interpreter");

    let (status, contract) = json_request(
        &app,
        "POST",
        "/api/v1/framework-contracts",
        &manager,
        Some(json!({
            "patient_id": patient_id,
            "status": "signed",
            "valid_from": chrono::Utc::now().date_naive().to_string(),
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "contract: {contract:?}");
    let contract_id = contract["id"].as_str().unwrap().to_string();

    let flat_fee_catalog_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO agency_service_catalog (
               service_key, service_name, unit_label, unit_price, currency, vat_rate,
               is_active, valid_from, created_by, due_in_full_on_termination
           ) VALUES ($1, 'Organisation der Behandlung (bis 5 Ärzte)', 'Einheit', 450, 'EUR', 19,
                     true, CURRENT_DATE, $2, true)
           RETURNING id"#,
    )
    .bind(format!("organisation_treatment_5doc-{tag}"))
    .bind(admin_id)
    .fetch_one(&pool)
    .await
    .unwrap();

    let order_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO orders (
               order_number, patient_id, contract_id, phase, status, currency, created_by,
               billing_release_status, billing_released_by, billing_released_at,
               package_coverage_status, package_coverage_decided_by, package_coverage_decided_at
           ) VALUES ($1, $2, $3::uuid, 'execution', 'active', 'EUR', $4,
                     'granted', $4, now(), 'not_covered', $4, now())
           RETURNING id"#,
    )
    .bind(format!("ORD-{tag}"))
    .bind(patient_id)
    .bind(&contract_id)
    .bind(admin_id)
    .fetch_one(&pool)
    .await
    .unwrap();

    // 2 h interpreter delivered (142.80), one doctor appointment still planned
    // (cancelled on termination), the organisation flat fee still planned but
    // due in full (535.50).
    let delivered = seed_service(
        &pool,
        order_id,
        patient_id,
        "Dolmetscher-/Betreuungsleistung",
        2,
        60,
        "delivered",
        None,
    )
    .await;
    let planned = seed_service(
        &pool,
        order_id,
        patient_id,
        "Organisation der Behandlung (je 1 Arzt)",
        1,
        100,
        "planned",
        None,
    )
    .await;
    let flat_fee = seed_service(
        &pool,
        order_id,
        patient_id,
        "Organisation der Behandlung (bis 5 Ärzte)",
        1,
        450,
        "planned",
        Some(flat_fee_catalog_id),
    )
    .await;
    let (status, quote) = json_request(
        &app,
        "POST",
        &format!("/api/v1/orders/{order_id}/quotes"),
        &manager,
        Some(json!({ "notes": "Termination settlement quote" })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "quote: {quote:?}");
    let quote_id = quote["id"].as_str().unwrap().to_string();
    // Interpreter hours approved after the quote: billed from the order line.
    let late_hours = seed_service(
        &pool,
        order_id,
        patient_id,
        "Dolmetscher-/Betreuungsleistung (Bericht)",
        1,
        60,
        "approved",
        None,
    )
    .await;

    // Paid advance of 200.
    let advance_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO invoices (
               order_id, patient_id, invoice_number, invoice_type, status, due_date,
               total_net, total_vat, total_gross, paid_amount, line_items, created_by
           ) VALUES ($1, $2, $3, 'advance', 'sent', CURRENT_DATE + 14,
                     168.07, 31.93, 200, 0, '[]', $4)
           RETURNING id"#,
    )
    .bind(order_id)
    .bind(patient_id)
    .bind(format!("ADV-{tag}"))
    .bind(billing_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    record_payment(&app, &billing, &advance_id.to_string(), "200").await;

    let accrued = cents(14280) + cents(53550) + cents(7140);
    let paid = cents(20000);

    // Preview: nothing written, same figures as the later snapshot.
    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/framework-contracts/{contract_id}/termination-preview"),
        &interpreter,
        None,
    )
    .await;
    assert_eq!(
        status,
        StatusCode::FORBIDDEN,
        "interpreter preview: {body:?}"
    );
    let (status, preview) = json_request(
        &app,
        "GET",
        &format!("/api/v1/framework-contracts/{contract_id}/termination-preview"),
        &manager,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "preview: {preview:?}");
    let open_orders = preview["open_orders"].as_array().unwrap();
    assert_eq!(open_orders.len(), 1, "preview: {preview:?}");
    let preview_order = &open_orders[0];
    assert_eq!(preview_order["id"], order_id.to_string());
    assert_eq!(money(&preview_order["accrued_gross"]), accrued);
    assert_eq!(money(&preview_order["accrued_net"]), cents(63000));
    assert_eq!(money(&preview_order["paid_gross"]), paid);
    assert_eq!(money(&preview_order["invoiced_gross"]), Decimal::ZERO);
    assert_eq!(money(&preview_order["balance_gross"]), accrued - paid);
    assert_eq!(money(&preview_order["uninvoiced_gross"]), accrued);
    assert_eq!(preview_order["lines"].as_array().unwrap().len(), 3);
    assert_eq!(
        preview_order["cancelled_lines"].as_array().unwrap().len(),
        1
    );
    assert_eq!(
        preview_order["cancelled_lines"][0]["order_leistung_id"],
        planned.to_string()
    );
    assert_eq!(service_status(&pool, planned).await, "planned");

    // Termination during the running order.
    let (status, terminated) = json_request(
        &app,
        "POST",
        &format!("/api/v1/framework-contracts/{contract_id}/terminate"),
        &manager,
        Some(json!({ "reason": "Patient terminated the contract" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "terminate: {terminated:?}");
    assert_eq!(terminated["status"], "terminated");
    let settlements = terminated["settlements"].as_array().unwrap();
    assert_eq!(settlements.len(), 1, "terminate: {terminated:?}");
    assert_eq!(settlements[0]["order_id"], order_id.to_string());
    assert_eq!(settlements[0]["settlement_status"], "open");
    assert_eq!(money(&settlements[0]["accrued_gross"]), accrued);
    assert_eq!(money(&settlements[0]["paid_gross"]), paid);
    assert_eq!(money(&settlements[0]["balance_gross"]), accrued - paid);
    assert_eq!(money(&settlements[0]["uninvoiced_gross"]), accrued);
    assert_eq!(settlements[0]["cancelled_services"], 1);
    assert_eq!(settlements[0]["flat_fees_due"], 1);

    let (order_status, cancellation_reason): (String, Option<String>) =
        sqlx::query_as("SELECT status, cancellation_reason FROM orders WHERE id = $1")
            .bind(order_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(order_status, "cancelled");
    assert_eq!(cancellation_reason.as_deref(), Some("contract_terminated"));
    assert_eq!(service_status(&pool, planned).await, "cancelled");
    assert_eq!(service_status(&pool, flat_fee).await, "delivered");
    assert_eq!(service_status(&pool, delivered).await, "delivered");

    let (status, preview_after) = json_request(
        &app,
        "GET",
        &format!("/api/v1/framework-contracts/{contract_id}/termination-preview"),
        &manager,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(preview_after["open_orders"].as_array().unwrap().len(), 0);

    // Settlement views.
    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/orders/{order_id}/termination-settlement"),
        &interpreter,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN, "interpreter view: {body:?}");
    let (status, settlement) = json_request(
        &app,
        "GET",
        &format!("/api/v1/orders/{order_id}/termination-settlement"),
        &billing,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "settlement: {settlement:?}");
    assert_eq!(settlement["status"], "open");
    assert_eq!(settlement["contract_id"], contract_id);
    assert_eq!(money(&settlement["snapshot"]["accrued_gross"]), accrued);
    assert_eq!(money(&settlement["current"]["accrued_gross"]), accrued);
    assert_eq!(
        money(&settlement["current"]["balance_gross"]),
        accrued - paid
    );
    assert_eq!(settlement["can_settle"], false);
    assert!(settlement["final_invoice"].is_null());
    assert_eq!(settlement["lines"].as_array().unwrap().len(), 3);

    let (status, queue) = json_request(
        &app,
        "GET",
        "/api/v1/invoices/termination-settlements",
        &billing,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "queue: {queue:?}");
    assert!(
        queue
            .as_array()
            .unwrap()
            .iter()
            .any(|item| item["order_id"] == order_id.to_string()),
        "queue: {queue:?}"
    );
    let (status, patient_settlements) = json_request(
        &app,
        "GET",
        &format!("/api/v1/patients/{patient_id}/termination-settlements"),
        &billing,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(patient_settlements.as_array().unwrap().len(), 1);
    let (status, workspace) = json_request(
        &app,
        "GET",
        &format!("/api/v1/patients/{patient_id}/billing-workspace"),
        &billing,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "workspace: {workspace:?}");
    let workspace_order = workspace["orders"]
        .as_array()
        .unwrap()
        .iter()
        .find(|item| item["id"] == order_id.to_string())
        .expect("terminated order stays in the billing workspace while open");
    assert_eq!(
        workspace_order["cancellation_reason"],
        "contract_terminated"
    );
    assert_eq!(workspace_order["termination_settlement"]["status"], "open");

    // Not balanced yet: plain settle is refused, a write-off needs a note.
    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/orders/{order_id}/termination-settlement/settle"),
        &billing,
        Some(json!({})),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "unbalanced settle: {body:?}");
    assert_eq!(body["error"], "termination_settlement_not_balanced");
    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/orders/{order_id}/termination-settlement/settle"),
        &billing,
        Some(json!({ "force": true })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "force: {body:?}");
    for bearer in [&manager, &interpreter] {
        let (status, body) = json_request(
            &app,
            "POST",
            &format!("/api/v1/orders/{order_id}/termination-settlement/settle"),
            bearer,
            Some(json!({ "force": true, "note": "Write-off" })),
        )
        .await;
        assert_eq!(status, StatusCode::FORBIDDEN, "settle permission: {body:?}");
    }
    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/orders/{order_id}/termination-settlement/final-invoice"),
        &interpreter,
        None,
    )
    .await;
    assert_eq!(
        status,
        StatusCode::FORBIDDEN,
        "interpreter invoice: {body:?}"
    );

    // Final invoice: quote lines for the delivered service and the flat fee,
    // the late interpreter hours from the order line, the cancelled doctor
    // appointment is left out; the paid advance is applied.
    let (status, final_invoice) = json_request(
        &app,
        "POST",
        &format!("/api/v1/orders/{order_id}/termination-settlement/final-invoice"),
        &billing,
        None,
    )
    .await;
    assert_eq!(
        status,
        StatusCode::CREATED,
        "final invoice: {final_invoice:?}"
    );
    assert_eq!(final_invoice["invoice_type"], "final");
    assert_eq!(final_invoice["status"], "draft");
    assert_eq!(final_invoice["quote_id"], quote_id);
    assert_eq!(money(&final_invoice["total_gross"]), accrued);
    assert_eq!(final_invoice["idempotent_replay"], false);
    let final_invoice_id = final_invoice["id"].as_str().unwrap().to_string();
    let allocated_services: Vec<Uuid> = sqlx::query_scalar(
        r#"SELECT order_leistung_id FROM invoice_order_line_allocations
           WHERE invoice_id = $1::uuid ORDER BY order_leistung_id"#,
    )
    .bind(&final_invoice_id)
    .fetch_all(&pool)
    .await
    .unwrap();
    let mut expected_allocated = vec![delivered, flat_fee];
    expected_allocated.sort();
    assert_eq!(allocated_services, expected_allocated);
    let direct_lines = final_invoice["line_items"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|item| item["source"] == "termination_order_service")
        .collect::<Vec<_>>();
    assert_eq!(direct_lines.len(), 1, "invoice: {final_invoice:?}");
    assert_eq!(
        direct_lines[0]["source_order_leistung_id"],
        late_hours.to_string()
    );
    for service in [delivered, flat_fee, late_hours] {
        assert_eq!(service_status(&pool, service).await, "invoiced");
    }
    assert_eq!(service_status(&pool, planned).await, "cancelled");

    let (status, replay) = json_request(
        &app,
        "POST",
        &format!("/api/v1/orders/{order_id}/termination-settlement/final-invoice"),
        &billing,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "replay: {replay:?}");
    assert_eq!(replay["id"], final_invoice_id);
    assert_eq!(replay["idempotent_replay"], true);

    // Release, collect the rest, then close the settlement.
    let (status, sent) = json_request(
        &app,
        "POST",
        &format!("/api/v1/invoices/{final_invoice_id}/status"),
        &billing,
        Some(json!({ "status": "sent" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "send final invoice: {sent:?}");
    let (status, applied) = json_request(
        &app,
        "POST",
        &format!("/api/v1/invoices/{final_invoice_id}/prepayment-allocations"),
        &billing,
        Some(json!({
            "request_id": Uuid::new_v4(),
            "advance_invoice_id": advance_id,
            "amount_gross": "200.00",
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "apply advance: {applied:?}");
    let remaining = accrued - paid;
    record_payment(&app, &billing, &final_invoice_id, &remaining.to_string()).await;

    let (status, settlement) = json_request(
        &app,
        "GET",
        &format!("/api/v1/orders/{order_id}/termination-settlement"),
        &billing,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(money(&settlement["current"]["invoiced_gross"]), accrued);
    assert_eq!(money(&settlement["current"]["paid_gross"]), accrued);
    assert_eq!(
        money(&settlement["current"]["balance_gross"]),
        Decimal::ZERO
    );
    assert_eq!(
        money(&settlement["current"]["uninvoiced_gross"]),
        Decimal::ZERO
    );
    assert_eq!(settlement["can_settle"], true);
    assert_eq!(settlement["final_invoice"]["id"], final_invoice_id);

    let (status, settled) = json_request(
        &app,
        "POST",
        &format!("/api/v1/orders/{order_id}/termination-settlement/settle"),
        &billing,
        Some(json!({ "note": "Final invoice paid" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "settle: {settled:?}");
    assert_eq!(settled["status"], "settled");
    assert_eq!(settled["settlement_forced"], false);
    assert!(settled["settled_at"].is_string());
    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/orders/{order_id}/termination-settlement/settle"),
        &billing,
        Some(json!({})),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "second settle: {body:?}");

    let (status, settled_queue) = json_request(
        &app,
        "GET",
        "/api/v1/invoices/termination-settlements?status=settled",
        &billing,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(
        settled_queue
            .as_array()
            .unwrap()
            .iter()
            .any(|item| item["order_id"] == order_id.to_string())
    );
}

#[tokio::test]
async fn terminating_a_contract_without_activity_closes_the_empty_settlement() {
    let Some(context) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let app = context.app;
    let pool = context.pool;
    let admin_id = context.admin_id;
    let tag = Uuid::new_v4().simple().to_string();
    let patient_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO patients (patient_id, first_name, last_name, birth_date, gender, created_by)
           VALUES ($1, 'Empty', 'Settlement', '1985-05-05', 'diverse', $2)
           RETURNING id"#,
    )
    .bind(format!("PT-{tag}"))
    .bind(admin_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    let manager_id = seed_user(&pool, &tag, "patient_manager").await;
    seed_assignment(&pool, patient_id, manager_id, admin_id).await;
    let manager = auth_header(manager_id, "patient_manager");
    let (status, contract) = json_request(
        &app,
        "POST",
        "/api/v1/framework-contracts",
        &manager,
        Some(json!({
            "patient_id": patient_id,
            "status": "signed",
            "valid_from": chrono::Utc::now().date_naive().to_string(),
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "contract: {contract:?}");
    let contract_id = contract["id"].as_str().unwrap().to_string();
    let order_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO orders (order_number, patient_id, contract_id, status, currency, created_by)
           VALUES ($1, $2, $3::uuid, 'paused', 'EUR', $4)
           RETURNING id"#,
    )
    .bind(format!("ORD-{tag}"))
    .bind(patient_id)
    .bind(&contract_id)
    .bind(admin_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    let planned = seed_service(
        &pool, order_id, patient_id, "Transfer", 1, 100, "planned", None,
    )
    .await;

    let (status, terminated) = json_request(
        &app,
        "POST",
        &format!("/api/v1/framework-contracts/{contract_id}/terminate"),
        &manager,
        Some(json!({ "reason": "Patient moved abroad" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "terminate: {terminated:?}");
    assert_eq!(terminated["settlements"][0]["settlement_status"], "settled");
    assert_eq!(service_status(&pool, planned).await, "cancelled");
    let settlement_status: String =
        sqlx::query_scalar("SELECT status FROM order_termination_settlements WHERE order_id = $1")
            .bind(order_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(settlement_status, "settled");
}

/// A completed order (already in the final follow-up phase, or with a terminal
/// status) is left alone by the termination: it is neither previewed nor
/// stopped nor settled and keeps its status, phase and services. Running
/// orders are stopped and settled as before.
#[tokio::test]
async fn contract_termination_leaves_completed_orders_untouched() {
    let Some(context) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let app = context.app;
    let pool = context.pool;
    let admin_id = context.admin_id;
    let tag = Uuid::new_v4().simple().to_string();
    let patient_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO patients (patient_id, first_name, last_name, birth_date, gender, created_by)
           VALUES ($1, 'Completed', 'Order', '1985-05-05', 'diverse', $2)
           RETURNING id"#,
    )
    .bind(format!("PT-{tag}"))
    .bind(admin_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    let manager_id = seed_user(&pool, &tag, "patient_manager").await;
    seed_assignment(&pool, patient_id, manager_id, admin_id).await;
    let manager = auth_header(manager_id, "patient_manager");
    let (status, contract) = json_request(
        &app,
        "POST",
        "/api/v1/framework-contracts",
        &manager,
        Some(json!({
            "patient_id": patient_id,
            "status": "signed",
            "valid_from": chrono::Utc::now().date_naive().to_string(),
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "contract: {contract:?}");
    let contract_id = contract["id"].as_str().unwrap().to_string();

    let seed_order = |number: String, phase: &'static str, status: &'static str| {
        let pool = pool.clone();
        let contract_id = contract_id.clone();
        async move {
            sqlx::query_scalar::<_, Uuid>(
                r#"INSERT INTO orders (order_number, patient_id, contract_id, phase, status, currency, created_by)
                   VALUES ($1, $2, $3::uuid, $4, $5, 'EUR', $6)
                   RETURNING id"#,
            )
            .bind(number)
            .bind(patient_id)
            .bind(&contract_id)
            .bind(phase)
            .bind(status)
            .bind(admin_id)
            .fetch_one(&pool)
            .await
            .unwrap()
        }
    };
    // Finished and paid, stage 5/5 "follow-up": still `active`.
    let followup_order = seed_order(format!("ORD-FUP-{tag}"), "followup", "active").await;
    let followup_billed = seed_service(
        &pool,
        followup_order,
        patient_id,
        "Dolmetscher-/Betreuungsleistung",
        2,
        60,
        "invoiced",
        None,
    )
    .await;
    let followup_planned = seed_service(
        &pool,
        followup_order,
        patient_id,
        "Nachsorge-Telefonat",
        1,
        30,
        "planned",
        None,
    )
    .await;
    let completed_order = seed_order(format!("ORD-DONE-{tag}"), "followup", "completed").await;
    let running_order = seed_order(format!("ORD-RUN-{tag}"), "execution", "active").await;
    let running_planned = seed_service(
        &pool,
        running_order,
        patient_id,
        "Transfer",
        1,
        100,
        "planned",
        None,
    )
    .await;

    let (status, preview) = json_request(
        &app,
        "GET",
        &format!("/api/v1/framework-contracts/{contract_id}/termination-preview"),
        &manager,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "preview: {preview:?}");
    let open_orders = preview["open_orders"].as_array().unwrap();
    assert_eq!(open_orders.len(), 1, "preview: {preview:?}");
    assert_eq!(open_orders[0]["id"], running_order.to_string());

    let (status, terminated) = json_request(
        &app,
        "POST",
        &format!("/api/v1/framework-contracts/{contract_id}/terminate"),
        &manager,
        Some(json!({ "reason": "Patient terminated after the treatment" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "terminate: {terminated:?}");
    let settlements = terminated["settlements"].as_array().unwrap();
    assert_eq!(settlements.len(), 1, "terminate: {terminated:?}");
    assert_eq!(settlements[0]["order_id"], running_order.to_string());

    let order_state = |order_id: Uuid| {
        let pool = pool.clone();
        async move {
            sqlx::query_as::<_, (String, String, Option<String>, Option<Uuid>)>(
                "SELECT phase, status, cancellation_reason, contract_id FROM orders WHERE id = $1",
            )
            .bind(order_id)
            .fetch_one(&pool)
            .await
            .unwrap()
        }
    };
    let contract_uuid = Uuid::parse_str(&contract_id).unwrap();
    assert_eq!(
        order_state(followup_order).await,
        (
            "followup".to_string(),
            "active".to_string(),
            None,
            Some(contract_uuid)
        )
    );
    assert_eq!(
        order_state(completed_order).await,
        (
            "followup".to_string(),
            "completed".to_string(),
            None,
            Some(contract_uuid)
        )
    );
    let (_, running_status, running_reason, _) = order_state(running_order).await;
    assert_eq!(running_status, "cancelled");
    assert_eq!(running_reason.as_deref(), Some("contract_terminated"));

    assert_eq!(service_status(&pool, followup_billed).await, "invoiced");
    assert_eq!(service_status(&pool, followup_planned).await, "planned");
    assert_eq!(service_status(&pool, running_planned).await, "cancelled");
    let settled_orders: Vec<Uuid> = sqlx::query_scalar(
        "SELECT order_id FROM order_termination_settlements WHERE contract_id = $1",
    )
    .bind(contract_uuid)
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(settled_orders, vec![running_order]);
}

/// An unconfirmed intake draft (e.g. a repeat intake) linked to the contract is
/// not stopped or settled on termination: it is detached from the contract so
/// the intake continues and later needs a new contract.
#[tokio::test]
async fn contract_termination_detaches_unconfirmed_drafts_without_settling_them() {
    let Some(context) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let app = context.app;
    let pool = context.pool;
    let admin_id = context.admin_id;
    let tag = Uuid::new_v4().simple().to_string();
    let patient_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO patients (patient_id, first_name, last_name, birth_date, gender, created_by)
           VALUES ($1, 'Draft', 'Detach', '1985-05-05', 'diverse', $2)
           RETURNING id"#,
    )
    .bind(format!("PT-{tag}"))
    .bind(admin_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    let manager_id = seed_user(&pool, &tag, "patient_manager").await;
    seed_assignment(&pool, patient_id, manager_id, admin_id).await;
    let manager = auth_header(manager_id, "patient_manager");
    let (status, contract) = json_request(
        &app,
        "POST",
        "/api/v1/framework-contracts",
        &manager,
        Some(json!({
            "patient_id": patient_id,
            "status": "signed",
            "valid_from": chrono::Utc::now().date_naive().to_string(),
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "contract: {contract:?}");
    let contract_id = contract["id"].as_str().unwrap().to_string();

    let running_order: Uuid = sqlx::query_scalar(
        r#"INSERT INTO orders (order_number, patient_id, contract_id, status, currency, created_by)
           VALUES ($1, $2, $3::uuid, 'active', 'EUR', $4)
           RETURNING id"#,
    )
    .bind(format!("ORD-RUN-{tag}"))
    .bind(patient_id)
    .bind(&contract_id)
    .bind(admin_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    let running_planned = seed_service(
        &pool,
        running_order,
        patient_id,
        "Transfer",
        1,
        100,
        "planned",
        None,
    )
    .await;

    let draft_order: Uuid = sqlx::query_scalar(
        r#"INSERT INTO orders (
               order_number, patient_id, contract_id, phase, status, currency,
               intake_state, created_by
           ) VALUES ($1, $2, $3::uuid, 'discovery', 'active', 'EUR', 'draft', $4)
           RETURNING id"#,
    )
    .bind(format!("ORD-DRAFT-{tag}"))
    .bind(patient_id)
    .bind(&contract_id)
    .bind(admin_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    sqlx::query(
        r#"INSERT INTO order_intakes (order_id, data, prepared_data, baseline_facts)
           VALUES ($1,
                   jsonb_build_object('step', 3, 'contract_id', $2::uuid),
                   jsonb_build_object('contract_id', $2::uuid),
                   '{}'::jsonb)"#,
    )
    .bind(draft_order)
    .bind(Uuid::parse_str(&contract_id).unwrap())
    .execute(&pool)
    .await
    .unwrap();
    let draft_planned = seed_service(
        &pool,
        draft_order,
        patient_id,
        "Organisation der Behandlung (je 1 Arzt)",
        1,
        100,
        "planned",
        None,
    )
    .await;

    // The preview lists only the running order; the draft is not settled.
    let (status, preview) = json_request(
        &app,
        "GET",
        &format!("/api/v1/framework-contracts/{contract_id}/termination-preview"),
        &manager,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "preview: {preview:?}");
    let open_orders = preview["open_orders"].as_array().unwrap();
    assert_eq!(open_orders.len(), 1, "preview: {preview:?}");
    assert_eq!(open_orders[0]["id"], running_order.to_string());

    let (status, terminated) = json_request(
        &app,
        "POST",
        &format!("/api/v1/framework-contracts/{contract_id}/terminate"),
        &manager,
        Some(json!({ "reason": "Patient terminated the contract" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "terminate: {terminated:?}");
    let settlements = terminated["settlements"].as_array().unwrap();
    assert_eq!(settlements.len(), 1, "terminate: {terminated:?}");
    assert_eq!(settlements[0]["order_id"], running_order.to_string());
    let detached = terminated["detached_draft_orders"].as_array().unwrap();
    assert_eq!(detached.len(), 1, "terminate: {terminated:?}");
    assert_eq!(detached[0]["order_id"], draft_order.to_string());

    assert_eq!(service_status(&pool, running_planned).await, "cancelled");
    let (draft_status, draft_state, draft_contract, draft_reason): (
        String,
        String,
        Option<Uuid>,
        Option<String>,
    ) = sqlx::query_as(
        "SELECT status, intake_state, contract_id, cancellation_reason FROM orders WHERE id = $1",
    )
    .bind(draft_order)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(draft_status, "active");
    assert_eq!(draft_state, "draft");
    assert_eq!(draft_contract, None);
    assert_eq!(draft_reason, None);
    assert_eq!(service_status(&pool, draft_planned).await, "planned");
    let draft_settlements: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM order_termination_settlements WHERE order_id = $1",
    )
    .bind(draft_order)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(draft_settlements, 0);
    let (intake_data, prepared_data, revision): (Value, Value, i64) = sqlx::query_as(
        "SELECT data, prepared_data, revision FROM order_intakes WHERE order_id = $1",
    )
    .bind(draft_order)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(intake_data["contract_id"].is_null(), "{intake_data}");
    assert_eq!(intake_data["step"], 3);
    assert!(prepared_data["contract_id"].is_null(), "{prepared_data}");
    assert_eq!(revision, 1);
}
