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
