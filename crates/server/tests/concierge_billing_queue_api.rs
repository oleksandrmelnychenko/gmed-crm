//! Owner decisions 2026-11-12 (7, 8): concierge sale prices in the order
//! economics (information only, never in the totals, no cost of the salaried
//! concierge) and the Billing work list of services ready to bill.

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

async fn get_json(app: &axum::Router, path: &str, bearer: &str) -> (StatusCode, Value) {
    let request = Request::builder()
        .method("GET")
        .uri(path)
        .header("Authorization", bearer)
        .body(Body::empty())
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

async fn seed_patient(pool: &PgPool, created_by: Uuid, pid: &str) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO patients (
               patient_id, first_name, last_name, birth_date, gender, created_by
           ) VALUES ($1, 'Synth', 'Concierge', '1990-01-01', 'diverse', $2)
           RETURNING id"#,
    )
    .bind(pid)
    .bind(created_by)
    .fetch_one(pool)
    .await
    .unwrap()
}

#[allow(clippy::too_many_arguments)]
async fn seed_concierge_service(
    pool: &PgPool,
    patient_id: Uuid,
    order_id: Option<Uuid>,
    appointment_id: Option<Uuid>,
    title: &str,
    status: &str,
    billing_status: &str,
    currency: &str,
    quantity: Decimal,
    unit_price: Option<Decimal>,
    created_by: Uuid,
) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO concierge_services (
               patient_id, order_id, appointment_id, service_kind, title, status,
               billing_status, currency, quantity, unit_price, cost_estimate,
               actual_cost, starts_at, completed_at, created_by
           ) VALUES (
               $1, $2, $3, 'transfer', $4, $5,
               $6, $7, $8, $9, 40, 45, now() - interval '1 day',
               CASE WHEN $5 = 'completed' THEN now() ELSE NULL END, $10
           )
           RETURNING id"#,
    )
    .bind(patient_id)
    .bind(order_id)
    .bind(appointment_id)
    .bind(title)
    .bind(status)
    .bind(billing_status)
    .bind(currency)
    .bind(quantity)
    .bind(unit_price)
    .bind(created_by)
    .fetch_one(pool)
    .await
    .unwrap()
}

fn service_ids(items: &Value) -> Vec<String> {
    items
        .as_array()
        .unwrap()
        .iter()
        .map(|item| item["id"].as_str().unwrap().to_string())
        .collect()
}

#[tokio::test]
async fn concierge_sale_prices_are_information_in_the_economics_and_ready_ones_feed_the_billing_list()
 {
    let Some(context) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let app = context.app;
    let pool = context.pool;
    let admin_id = context.admin_id;
    let tag = Uuid::new_v4().simple().to_string();

    let billing_id = seed_user(&pool, &tag, "billing").await;
    let assistant_id = seed_user(&pool, &tag, "ceo_assistant").await;
    let manager_id = seed_user(&pool, &tag, "patient_manager").await;
    let concierge_id = seed_user(&pool, &tag, "concierge").await;
    let patient_id = seed_patient(&pool, admin_id, &format!("PT-CQ-{tag}")).await;
    let other_patient_id = seed_patient(&pool, admin_id, &format!("PT-CQO-{tag}")).await;
    sqlx::query(
        "INSERT INTO patient_assignments (patient_id, user_id, assigned_by) VALUES ($1, $2, $3)",
    )
    .bind(patient_id)
    .bind(manager_id)
    .bind(admin_id)
    .execute(&pool)
    .await
    .unwrap();

    let order_number = format!("ORD-CQ-{tag}");
    let order_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO orders (order_number, patient_id, phase, status, currency, created_by)
           VALUES ($1, $2, 'execution', 'active', 'EUR', $3)
           RETURNING id"#,
    )
    .bind(&order_number)
    .bind(patient_id)
    .bind(admin_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    // One released invoice of 100 net: the recognized revenue must stay
    // exactly that whatever the concierge services carry.
    sqlx::query(
        r#"INSERT INTO invoices (
               order_id, patient_id, invoice_number, invoice_type, status,
               total_net, total_vat, total_gross, line_items, created_by
           ) VALUES ($1, $2, $3, 'final', 'sent', 100, 19, 119, '[]', $4)"#,
    )
    .bind(order_id)
    .bind(patient_id)
    .bind(format!("INV-CQ-{tag}"))
    .bind(admin_id)
    .execute(&pool)
    .await
    .unwrap();
    let appointment_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO appointments (
               patient_id, order_id, appointment_type, title, date, status, created_by
           ) VALUES ($1, $2, 'non_medical', 'Dinner', CURRENT_DATE - 1, 'completed', $3)
           RETURNING id"#,
    )
    .bind(patient_id)
    .bind(order_id)
    .bind(admin_id)
    .fetch_one(&pool)
    .await
    .unwrap();

    // Ready, linked directly: 1 × 180 not billed yet.
    let ready_id = seed_concierge_service(
        &pool,
        patient_id,
        Some(order_id),
        None,
        "Meet and greet",
        "completed",
        "ready",
        "EUR",
        Decimal::ONE,
        Some(Decimal::new(180, 0)),
        admin_id,
    )
    .await;
    // Billed, linked through its appointment: 2 × 50.
    let billed_id = seed_concierge_service(
        &pool,
        patient_id,
        None,
        Some(appointment_id),
        "Restaurant booking",
        "completed",
        "billed",
        "EUR",
        Decimal::new(2, 0),
        Some(Decimal::new(50, 0)),
        admin_id,
    )
    .await;
    // No sale price: adds nothing, still on the Billing list.
    let unpriced_id = seed_concierge_service(
        &pool,
        patient_id,
        Some(order_id),
        None,
        "Pharmacy run",
        "completed",
        "ready",
        "EUR",
        Decimal::ONE,
        None,
        admin_id,
    )
    .await;
    // Waived: adds nothing, not on the list.
    let waived_id = seed_concierge_service(
        &pool,
        patient_id,
        Some(order_id),
        None,
        "Cancelled transfer",
        "cancelled",
        "waived",
        "EUR",
        Decimal::ONE,
        Some(Decimal::new(90, 0)),
        admin_id,
    )
    .await;
    // Other currency: listed, outside the totals.
    let usd_id = seed_concierge_service(
        &pool,
        patient_id,
        Some(order_id),
        None,
        "Limousine",
        "booked",
        "draft",
        "USD",
        Decimal::ONE,
        Some(Decimal::new(10, 0)),
        admin_id,
    )
    .await;
    // Another patient's ready service, without order.
    let other_ready_id = seed_concierge_service(
        &pool,
        other_patient_id,
        None,
        None,
        "Airport pickup",
        "completed",
        "ready",
        "EUR",
        Decimal::ONE,
        Some(Decimal::new(75, 0)),
        admin_id,
    )
    .await;

    // --- Order economics -------------------------------------------------
    let billing = auth_header(billing_id, "billing");
    let (status, economics) = get_json(
        &app,
        &format!("/api/v1/orders/{order_id}/economics"),
        &billing,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{economics}");
    // The totals are untouched: revenue only from the invoice, no planned
    // revenue (no order lines), no cost from the salaried concierge (its
    // cost estimate / actual cost are not partner costs).
    assert_eq!(economics["actual"]["recognized_revenue_net"], "100");
    assert_eq!(economics["planned"]["revenue_net"], "0");
    assert_eq!(economics["actual"]["partner_cost_net"], "0");
    assert_eq!(economics["actual"]["margin_net"], "100");
    let sales = &economics["concierge_sales"];
    assert_eq!(sales["counted_in_totals"], false);
    assert_eq!(sales["unbilled_total"], "180");
    assert_eq!(sales["billed_total"], "100");
    assert_eq!(sales["other_currency_count"], 1);
    let listed = service_ids(&sales["services"]);
    assert!(listed.contains(&ready_id.to_string()));
    assert!(listed.contains(&billed_id.to_string()));
    assert!(listed.contains(&usd_id.to_string()));
    assert!(!listed.contains(&unpriced_id.to_string()));
    assert!(!listed.contains(&waived_id.to_string()));
    assert!(!listed.contains(&other_ready_id.to_string()));
    let billed = sales["services"]
        .as_array()
        .unwrap()
        .iter()
        .find(|item| item["id"] == billed_id.to_string())
        .unwrap();
    assert_eq!(billed["sale_price"], "100");
    assert_eq!(billed["billed"], true);

    // --- Billing work list -------------------------------------------------
    let (status, queue) = get_json(
        &app,
        &format!("/api/v1/concierge-billing-queue?patient_id={patient_id}"),
        &billing,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{queue}");
    let listed = service_ids(&queue["items"]);
    assert_eq!(listed.len(), 2, "{queue}");
    assert!(listed.contains(&ready_id.to_string()));
    assert!(listed.contains(&unpriced_id.to_string()));
    let ready = queue["items"]
        .as_array()
        .unwrap()
        .iter()
        .find(|item| item["id"] == ready_id.to_string())
        .unwrap();
    assert_eq!(ready["sale_price"], "180");
    assert_eq!(ready["order_id"], order_id.to_string());
    assert_eq!(ready["order_number"], order_number);
    assert_eq!(ready["patient_id"], patient_id.to_string());
    let unpriced = queue["items"]
        .as_array()
        .unwrap()
        .iter()
        .find(|item| item["id"] == unpriced_id.to_string())
        .unwrap();
    assert!(unpriced["sale_price"].is_null());

    // Billing and the CEO assistant read every patient.
    let (status, queue) = get_json(&app, "/api/v1/concierge-billing-queue", &billing).await;
    assert_eq!(status, StatusCode::OK);
    assert!(service_ids(&queue["items"]).contains(&other_ready_id.to_string()));
    let (status, queue) = get_json(
        &app,
        "/api/v1/concierge-billing-queue",
        &auth_header(assistant_id, "ceo_assistant"),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(service_ids(&queue["items"]).contains(&other_ready_id.to_string()));

    // A patient manager only their own patients.
    let (status, queue) = get_json(
        &app,
        "/api/v1/concierge-billing-queue",
        &auth_header(manager_id, "patient_manager"),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let listed = service_ids(&queue["items"]);
    assert!(listed.contains(&ready_id.to_string()));
    assert!(!listed.contains(&other_ready_id.to_string()));

    // The concierge has no access.
    let (status, _) = get_json(
        &app,
        "/api/v1/concierge-billing-queue",
        &auth_header(concierge_id, "concierge"),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

async fn json_request(
    app: &axum::Router,
    method: &str,
    path: &str,
    bearer: &str,
    body: Value,
) -> (StatusCode, Value) {
    let request = Request::builder()
        .method(method)
        .uri(path)
        .header("Authorization", bearer)
        .header("Content-Type", "application/json")
        .body(Body::from(serde_json::to_vec(&body).unwrap()))
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

async fn billing_status_of(pool: &PgPool, service_id: Uuid) -> String {
    sqlx::query_scalar("SELECT billing_status FROM concierge_services WHERE id = $1")
        .bind(service_id)
        .fetch_one(pool)
        .await
        .unwrap()
}

fn money(value: &Value) -> Decimal {
    value
        .as_str()
        .and_then(|text| text.parse::<Decimal>().ok())
        .unwrap_or_else(|| panic!("money value expected, got {value}"))
}

/// F-C8 (screens QA 2026-11-12): a ready concierge service with a sale price
/// is billed from the patient's billing tab, exactly once; the release moves
/// it to billed and the order economics count it; a cancelled invoice gives
/// it back to billing.
#[tokio::test]
async fn a_ready_concierge_service_is_billed_once_from_the_patient_billing_tab() {
    let Some(context) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let app = context.app;
    let pool = context.pool;
    let admin_id = context.admin_id;
    let tag = Uuid::new_v4().simple().to_string();

    let billing = auth_header(seed_user(&pool, &tag, "billing").await, "billing");
    let patient_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO patients (patient_id, first_name, last_name, birth_date, gender, created_by,
                               address_street, address_zip, address_city, address_country)
           VALUES ($1, 'Synth', 'Conciergebill', '1980-02-02', 'diverse', $2,
                   'Teststraße 1', '10115', 'Berlin', 'Deutschland')
           RETURNING id"#,
    )
    .bind(format!("PT-CB-{tag}"))
    .bind(admin_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    let order_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO orders (order_number, patient_id, phase, status, currency, created_by)
           VALUES ($1, $2, 'execution', 'active', 'EUR', $3)
           RETURNING id"#,
    )
    .bind(format!("ORD-CB-{tag}"))
    .bind(patient_id)
    .bind(admin_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    let priced_id = seed_concierge_service(
        &pool,
        patient_id,
        Some(order_id),
        None,
        "Airport transfer",
        "completed",
        "ready",
        "EUR",
        Decimal::ONE,
        Some(Decimal::new(120, 0)),
        admin_id,
    )
    .await;
    let unpriced_id = seed_concierge_service(
        &pool,
        patient_id,
        Some(order_id),
        None,
        "Pharmacy run",
        "completed",
        "ready",
        "EUR",
        Decimal::ONE,
        None,
        admin_id,
    )
    .await;
    let path = format!("/api/v1/patients/{patient_id}/billing-invoices");
    let draft_body = |services: Vec<Uuid>, order: Option<Uuid>| {
        json!({
            "request_id": Uuid::new_v4(),
            "order_id": order,
            "currency": "EUR",
            "invoice_type": "interim",
            "external_invoice_ids": [],
            "concierge_service_ids": services,
        })
    };

    // Without its order, without a price: refused.
    let (status, body) = json_request(
        &app,
        "POST",
        &path,
        &billing,
        draft_body(vec![priced_id], None),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{body}");
    assert_eq!(body["error"], "concierge_service_other_order");
    let (status, body) = json_request(
        &app,
        "POST",
        &path,
        &billing,
        draft_body(vec![unpriced_id], Some(order_id)),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
    assert_eq!(body["error"], "concierge_service_without_price");

    // The draft bills 1 × 120 net with the default VAT and names the service.
    let (status, draft) = json_request(
        &app,
        "POST",
        &path,
        &billing,
        draft_body(vec![priced_id], Some(order_id)),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{draft}");
    let invoice_id = Uuid::parse_str(draft["id"].as_str().unwrap()).unwrap();
    let (line, total_net): (Value, Decimal) =
        sqlx::query_as("SELECT line_items->0, total_net FROM invoices WHERE id = $1")
            .bind(invoice_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(line["source"], "concierge_service");
    assert_eq!(line["source_concierge_service_id"], priced_id.to_string());
    assert_eq!(line["description"], "Airport transfer");
    assert_eq!(money(&line["line_net"]), Decimal::new(120, 0));
    assert_eq!(total_net, Decimal::new(12000, 2));
    // A draft only reserves the service.
    assert_eq!(billing_status_of(&pool, priced_id).await, "ready");

    // Never twice: a second draft is refused.
    let (status, body) = json_request(
        &app,
        "POST",
        &path,
        &billing,
        draft_body(vec![priced_id], Some(order_id)),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{body}");
    assert_eq!(body["error"], "concierge_service_already_invoiced");

    // The billing tab lists both, neither billable now.
    let (status, workspace) = get_json(
        &app,
        &format!("/api/v1/patients/{patient_id}/billing-workspace"),
        &billing,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{workspace}");
    let listed = workspace["concierge_services"].as_array().unwrap();
    let priced = listed
        .iter()
        .find(|item| item["id"] == priced_id.to_string())
        .unwrap();
    assert_eq!(priced["billable"], false);
    assert_eq!(priced["invoice_id"], invoice_id.to_string());
    let unpriced = listed
        .iter()
        .find(|item| item["id"] == unpriced_id.to_string())
        .unwrap();
    assert_eq!(unpriced["billable"], false);
    assert!(unpriced["sale_price_net"].is_null());

    // The release bills the service; the economics count it exactly.
    let status_path = format!("/api/v1/invoices/{invoice_id}/status");
    let (status, body) = json_request(
        &app,
        "POST",
        &status_path,
        &billing,
        json!({ "status": "sent" }),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(billing_status_of(&pool, priced_id).await, "billed");
    let (status, economics) = get_json(
        &app,
        &format!("/api/v1/orders/{order_id}/economics"),
        &billing,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{economics}");
    assert_eq!(economics["actual"]["recognized_revenue_net"], "120");
    assert_eq!(economics["concierge_sales"]["invoiced_total"], "120");
    assert_eq!(economics["concierge_sales"]["billed_total"], "0");
    assert!(
        !economics["warnings"]
            .as_array()
            .unwrap()
            .iter()
            .any(|warning| warning == "unassigned_invoice_revenue"),
        "{economics}"
    );

    // Cancelling the released invoice gives the service back to billing.
    let (status, body) = json_request(
        &app,
        "POST",
        &status_path,
        &billing,
        json!({ "status": "cancelled", "reason": "Falscher Empfänger" }),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(billing_status_of(&pool, priced_id).await, "ready");
    let (status, body) = json_request(
        &app,
        "POST",
        &path,
        &billing,
        draft_body(vec![priced_id], Some(order_id)),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
}

async fn pdf_text(app: &axum::Router, path: &str, bearer: &str) -> String {
    let request = Request::builder()
        .method("GET")
        .uri(path)
        .header("Authorization", bearer)
        .body(Body::empty())
        .unwrap();
    let response = app.clone().oneshot(request).await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = axum::body::to_bytes(response.into_body(), 10 * 1024 * 1024)
        .await
        .unwrap();
    pdf_extract::extract_text_from_mem(&bytes).unwrap()
}

/// F-B1 (release QA 2026-11-13): an interim invoice of a Concierge service and
/// its re-billed receipt, both of 12.11.2026, printed the order's planned
/// appointments weeks ahead as its Leistungszeitraum. Dated lines date the
/// invoice; the order's appointments only stand in when no line has a date.
#[tokio::test]
async fn an_invoice_of_a_concierge_service_and_its_receipt_is_dated_by_its_lines() {
    let Some(context) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let app = context.app;
    let pool = context.pool;
    let admin_id = context.admin_id;
    let tag = Uuid::new_v4().simple().to_string();

    let ceo = auth_header(admin_id, "ceo");
    let billing = auth_header(seed_user(&pool, &tag, "billing").await, "billing");
    let patient_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO patients (patient_id, first_name, last_name, birth_date, gender, created_by,
                               address_street, address_zip, address_city, address_country)
           VALUES ($1, 'Synth', 'Conciergedate', '1980-02-02', 'diverse', $2,
                   'Teststraße 1', '10115', 'Berlin', 'Deutschland')
           RETURNING id"#,
    )
    .bind(format!("PT-CD-{tag}"))
    .bind(admin_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    let order_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO orders (order_number, patient_id, phase, status, currency, created_by)
           VALUES ($1, $2, 'execution', 'active', 'EUR', $3)
           RETURNING id"#,
    )
    .bind(format!("ORD-CD-{tag}"))
    .bind(patient_id)
    .bind(admin_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    // A visit of the order still ahead: the old code printed it.
    let planned_day = gmed_server::app_time::today() + chrono::Duration::days(40);
    sqlx::query(
        r#"INSERT INTO appointments (
               patient_id, order_id, appointment_type, title, date, status, created_by
           ) VALUES ($1, $2, 'non_medical', 'Geplanter Termin', $3, 'planned', $4)"#,
    )
    .bind(patient_id)
    .bind(order_id)
    .bind(planned_day)
    .bind(admin_id)
    .execute(&pool)
    .await
    .unwrap();
    let service_id = seed_concierge_service(
        &pool,
        patient_id,
        Some(order_id),
        None,
        "Airport transfer",
        "completed",
        "ready",
        "EUR",
        Decimal::ONE,
        Some(Decimal::new(180, 0)),
        admin_id,
    )
    .await;
    sqlx::query(
        r#"UPDATE concierge_services
           SET starts_at = '2026-11-12 09:00:00+01', completed_at = '2026-11-12 11:00:00+01'
           WHERE id = $1"#,
    )
    .bind(service_id)
    .execute(&pool)
    .await
    .unwrap();

    // The receipt of 12.11.2026, paid by GMED and settled with the supplier.
    let provider_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO providers (name, provider_type, address_city, fachbereich, address_country)
           VALUES ($1, 'medical', 'Berlin', 'Cardiology', 'Germany')
           RETURNING id"#,
    )
    .bind(format!("Clinic {tag}"))
    .fetch_one(&pool)
    .await
    .unwrap();
    let (status, receipt) = json_request(
        &app,
        "POST",
        &format!("/api/v1/orders/{order_id}/external-invoices"),
        &ceo,
        json!({
            "provider_id": provider_id,
            "external_invoice_number": format!("REST-{tag}"),
            "invoice_date": "2026-11-12",
            "amount_net": 100,
            "amount_vat": 0,
            "amount_gross": 100,
            "currency": "EUR",
            "status": "approved"
        }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{receipt}");
    let receipt_id = Uuid::parse_str(receipt["id"].as_str().unwrap()).unwrap();
    let account_id: Uuid = sqlx::query_scalar(
        "SELECT id FROM company_financial_accounts WHERE currency = 'EUR' AND is_default",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    let (status, payment) = json_request(
        &app,
        "POST",
        &format!("/api/v1/company-provider-liabilities/{receipt_id}/settlements"),
        &ceo,
        json!({
            "request_id": Uuid::new_v4(),
            "financial_account_id": account_id,
            "amount_gross": "100",
            "paid_on": gmed_server::app_time::today().to_string(),
            "payment_method": "bank_transfer"
        }),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{payment}");

    let (status, draft) = json_request(
        &app,
        "POST",
        &format!("/api/v1/patients/{patient_id}/billing-invoices"),
        &billing,
        json!({
            "request_id": Uuid::new_v4(),
            "order_id": order_id,
            "currency": "EUR",
            "invoice_type": "interim",
            "external_invoice_ids": [receipt_id],
            "concierge_service_ids": [service_id],
        }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{draft}");
    let invoice_id = draft["id"].as_str().unwrap().to_string();
    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/invoices/{invoice_id}/status"),
        &billing,
        json!({ "status": "sent" }),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");

    let text = pdf_text(
        &app,
        &format!("/api/v1/invoices/{invoice_id}/pdf"),
        &billing,
    )
    .await;
    assert!(text.contains("Leistungsdatum"), "{text}");
    assert!(text.contains("12.11.2026"), "{text}");
    assert!(!text.contains("Leistungszeitraum"), "{text}");
    assert!(
        !text.contains(&planned_day.format("%d.%m.%Y").to_string()),
        "{text}"
    );

    // F-B4: the receipt re-billed at cost and the Concierge service are both
    // assigned revenue, so no «unassigned revenue» warning.
    let (status, economics) = get_json(
        &app,
        &format!("/api/v1/orders/{order_id}/economics"),
        &billing,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{economics}");
    assert!(
        !economics["warnings"]
            .as_array()
            .unwrap()
            .iter()
            .any(|warning| warning == "unassigned_invoice_revenue"),
        "{economics}"
    );
}
