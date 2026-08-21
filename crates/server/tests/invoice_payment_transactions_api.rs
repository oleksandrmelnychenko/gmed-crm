mod support;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use rust_decimal::Decimal;
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

fn unique_tag(prefix: &str) -> String {
    format!("{prefix}-{}", Uuid::new_v4().simple())
}

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
        .body(body.map_or_else(Body::empty, |value| {
            Body::from(serde_json::to_vec(&value).unwrap())
        }))
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

async fn seed_patient(pool: &PgPool, created_by: Uuid, tag: &str) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO patients (
                patient_id, first_name, last_name, birth_date, gender, created_by
           ) VALUES ($1, 'Payment', 'Journal', '1990-01-01', 'diverse', $2)
           RETURNING id"#,
    )
    .bind(format!("PT-{tag}"))
    .bind(created_by)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn seed_assignment(pool: &PgPool, patient_id: Uuid, user_id: Uuid, actor_id: Uuid) {
    sqlx::query(
        r#"INSERT INTO patient_assignments (patient_id, user_id, assigned_by)
           VALUES ($1, $2, $3)"#,
    )
    .bind(patient_id)
    .bind(user_id)
    .bind(actor_id)
    .execute(pool)
    .await
    .unwrap();
}

async fn seed_order(pool: &PgPool, patient_id: Uuid, created_by: Uuid, tag: &str) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO orders (order_number, patient_id, phase, status, created_by)
           VALUES ($1, $2, 'execution', 'active', $3)
           RETURNING id"#,
    )
    .bind(format!("ORD-{tag}"))
    .bind(patient_id)
    .bind(created_by)
    .fetch_one(pool)
    .await
    .unwrap()
}

#[allow(clippy::too_many_arguments)]
async fn seed_invoice(
    pool: &PgPool,
    order_id: Uuid,
    patient_id: Uuid,
    created_by: Uuid,
    tag: &str,
    invoice_type: &str,
    gross: i64,
    hide_amounts: bool,
) -> Uuid {
    let net = Decimal::new(gross, 0) * Decimal::new(100, 0) / Decimal::new(119, 0);
    let net = net.round_dp(2);
    let gross = Decimal::new(gross, 0);
    sqlx::query_scalar(
        r#"INSERT INTO invoices (
                order_id, patient_id, invoice_number, invoice_type, status,
                due_date, total_net, total_vat, total_gross, paid_amount,
                line_items, notes, portal_visible, hide_amounts_from_patient, created_by
           ) VALUES (
                $1, $2, $3, $4, 'sent', CURRENT_DATE + 14,
                $5, $6, $7, 0, $8, 'Payment journal test', true, $9, $10
           ) RETURNING id"#,
    )
    .bind(order_id)
    .bind(patient_id)
    .bind(format!("INV-{tag}"))
    .bind(invoice_type)
    .bind(net)
    .bind(gross - net)
    .bind(gross)
    .bind(json!([{
        "description": "Care service",
        "quantity": "1",
        "unit_price": net.to_string(),
        "vat_rate": "19",
        "is_cost_passthrough": false,
        "line_net": net.to_string(),
        "line_vat": (gross - net).to_string(),
        "line_gross": gross.to_string()
    }]))
    .bind(hide_amounts)
    .bind(created_by)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn record_payment(
    app: &axum::Router,
    bearer: &str,
    invoice_id: Uuid,
    request_id: Uuid,
    amount: i64,
    reference: &str,
) -> Value {
    let (status, body) = json_request(
        app,
        "POST",
        &format!("/api/v1/invoices/{invoice_id}/payments"),
        bearer,
        Some(json!({
            "request_id": request_id,
            "amount_gross": amount,
            "payment_method": "bank_transfer",
            "payment_reference": reference,
            "received_on": chrono::Utc::now().date_naive().to_string(),
            "note": format!("Internal {reference}")
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "payment response: {body:?}");
    body
}

#[tokio::test]
async fn multiple_payments_reversal_accounting_and_portal_visibility_are_consistent() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };
    let tag = unique_tag("invoice-payments");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let other_patient_id = seed_patient(&pool, admin_id, &format!("{tag}-other")).await;
    let billing_id = seed_user(&pool, &tag, "billing").await;
    let manager_id = seed_user(&pool, &tag, "patient_manager").await;
    let patient_user_id = seed_user(&pool, &tag, "patient").await;
    let other_patient_user_id = seed_user(&pool, &format!("{tag}-other"), "patient").await;
    for user_id in [billing_id, manager_id, patient_user_id] {
        seed_assignment(&pool, patient_id, user_id, admin_id).await;
    }
    seed_assignment(&pool, other_patient_id, other_patient_user_id, admin_id).await;
    let order_id = seed_order(&pool, patient_id, admin_id, &tag).await;
    let invoice_id = seed_invoice(
        &pool, order_id, patient_id, billing_id, &tag, "final", 119, false,
    )
    .await;
    let hidden_invoice_id = seed_invoice(
        &pool,
        order_id,
        patient_id,
        billing_id,
        &format!("{tag}-hidden"),
        "interim",
        50,
        true,
    )
    .await;
    let billing = auth_header_for(billing_id, "billing");
    let manager = auth_header_for(manager_id, "patient_manager");
    let patient = auth_header_for(patient_user_id, "patient");
    let other_patient = auth_header_for(other_patient_user_id, "patient");

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/invoices/{invoice_id}/payments"),
        &manager,
        Some(json!({
            "request_id": Uuid::new_v4(),
            "amount_gross": 1,
            "payment_method": "cash",
            "received_on": chrono::Utc::now().date_naive().to_string()
        })),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN, "manager response: {body:?}");

    let first_request_id = Uuid::new_v4();
    let first = record_payment(&app, &billing, invoice_id, first_request_id, 40, "BANK-001").await;
    let first_payment_id =
        Uuid::parse_str(first["payment_transaction_id"].as_str().unwrap()).unwrap();
    assert_eq!(first["invoice"]["paid_amount"], "40");
    assert_eq!(first["invoice"]["status"], "partially_paid");
    assert_eq!(first["invoice"]["balance_due"], "79");

    let (replay_status, replay) = json_request(
        &app,
        "POST",
        &format!("/api/v1/invoices/{invoice_id}/payments"),
        &billing,
        Some(json!({
            "request_id": first_request_id,
            "amount_gross": 40,
            "payment_method": "bank_transfer",
            "payment_reference": "BANK-001",
            "received_on": chrono::Utc::now().date_naive().to_string(),
            "note": "Internal BANK-001"
        })),
    )
    .await;
    assert_eq!(replay_status, StatusCode::OK, "payment replay: {replay:?}");
    assert_eq!(
        replay["payment_transaction_id"],
        first_payment_id.to_string()
    );
    assert_eq!(replay["idempotent_replay"], true);
    let (drift_status, drift) = json_request(
        &app,
        "POST",
        &format!("/api/v1/invoices/{invoice_id}/payments"),
        &billing,
        Some(json!({
            "request_id": first_request_id,
            "amount_gross": 41,
            "payment_method": "bank_transfer",
            "payment_reference": "BANK-001",
            "received_on": chrono::Utc::now().date_naive().to_string(),
            "note": "Internal BANK-001"
        })),
    )
    .await;
    assert_eq!(
        drift_status,
        StatusCode::CONFLICT,
        "payment drift: {drift:?}"
    );

    let second = record_payment(&app, &billing, invoice_id, Uuid::new_v4(), 79, "BANK-002").await;
    assert_eq!(second["invoice"]["paid_amount"], "119");
    assert_eq!(second["invoice"]["status"], "paid");
    assert_eq!(second["invoice"]["balance_due"], "0");
    let today = chrono::Utc::now().date_naive().to_string();
    assert_eq!(
        second["invoice"]["paid_at"]
            .as_str()
            .and_then(|value| value.get(..10)),
        Some(today.as_str())
    );

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/invoices/{invoice_id}/payments"),
        &billing,
        Some(json!({
            "request_id": Uuid::new_v4(),
            "amount_gross": 1,
            "payment_method": "cash",
            "received_on": chrono::Utc::now().date_naive().to_string()
        })),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::CONFLICT,
        "overpayment response: {body:?}"
    );

    let (status, staff_history) = json_request(
        &app,
        "GET",
        &format!("/api/v1/invoices/{invoice_id}/payments"),
        &billing,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(staff_history["items"].as_array().unwrap().len(), 2);
    assert!(staff_history["items"][0].get("note").is_some());
    assert!(staff_history["items"][0].get("created_by_name").is_some());

    let (status, portal_history) = json_request(
        &app,
        "GET",
        &format!("/api/v1/me/invoices/{invoice_id}/payments"),
        &patient,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "portal history: {portal_history:?}");
    assert_eq!(portal_history["items"].as_array().unwrap().len(), 2);
    assert!(portal_history["items"][0].get("note").is_none());
    assert!(portal_history["items"][0].get("created_by").is_none());
    assert_eq!(portal_history["items"][1]["payment_reference"], "BANK-001");

    let (status, _) = json_request(
        &app,
        "GET",
        &format!("/api/v1/me/invoices/{hidden_invoice_id}/payments"),
        &patient,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, _) = json_request(
        &app,
        "GET",
        &format!("/api/v1/me/invoices/{invoice_id}/payments"),
        &other_patient,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    let (status, reversal) = json_request(
        &app,
        "POST",
        &format!("/api/v1/invoices/{invoice_id}/payments/{first_payment_id}/reversal"),
        &billing,
        Some(json!({ "note": "Duplicate bank receipt" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "reversal response: {reversal:?}");
    assert_eq!(reversal["invoice"]["paid_amount"], "79");
    assert_eq!(reversal["invoice"]["status"], "partially_paid");
    assert_eq!(reversal["invoice"]["balance_due"], "40");
    assert!(reversal["invoice"]["paid_at"].is_null());

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/invoices/{invoice_id}/payments/{first_payment_id}/reversal"),
        &billing,
        Some(json!({ "note": "Second reversal" })),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "second reversal: {body:?}");

    let accounting = sqlx::query(
        r#"SELECT COUNT(*)::BIGINT AS entry_count,
                  COUNT(DISTINCT source_invoice_payment_transaction_id)::BIGINT AS transaction_count,
                  COALESCE(SUM(amount_gross), 0) AS gross
           FROM accounting_entries
           WHERE source_invoice_id = $1
             AND source_invoice_payment_transaction_id IS NOT NULL"#,
    )
    .bind(invoice_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(accounting.get::<i64, _>("entry_count"), 3);
    assert_eq!(accounting.get::<i64, _>("transaction_count"), 3);
    assert_eq!(accounting.get::<Decimal, _>("gross"), Decimal::new(79, 0));

    let delete_error = sqlx::query("DELETE FROM invoice_payment_transactions WHERE id = $1")
        .bind(first_payment_id)
        .execute(&pool)
        .await
        .unwrap_err();
    let delete_database_error = delete_error.as_database_error().unwrap();
    assert_eq!(delete_database_error.code().as_deref(), Some("P0001"));

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/invoices/{invoice_id}/status"),
        &billing,
        Some(json!({ "status": "sent", "paid_amount": 0 })),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::UNPROCESSABLE_ENTITY,
        "status mutation: {body:?}"
    );
}

#[tokio::test]
async fn cash_payment_recompute_preserves_prepayment_allocations() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };
    let tag = unique_tag("invoice-payment-prepayment");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let billing_id = seed_user(&pool, &tag, "billing").await;
    seed_assignment(&pool, patient_id, billing_id, admin_id).await;
    let order_id = seed_order(&pool, patient_id, admin_id, &tag).await;
    let advance_id = seed_invoice(
        &pool,
        order_id,
        patient_id,
        billing_id,
        &format!("{tag}-advance"),
        "advance",
        60,
        false,
    )
    .await;
    let settlement_id = seed_invoice(
        &pool,
        order_id,
        patient_id,
        billing_id,
        &format!("{tag}-final"),
        "final",
        119,
        false,
    )
    .await;
    let billing = auth_header_for(billing_id, "billing");

    record_payment(&app, &billing, advance_id, Uuid::new_v4(), 60, "ADVANCE").await;
    let settlement_payment =
        record_payment(&app, &billing, settlement_id, Uuid::new_v4(), 59, "CASH").await;
    let settlement_payment_id = Uuid::parse_str(
        settlement_payment["payment_transaction_id"]
            .as_str()
            .unwrap(),
    )
    .unwrap();

    let (status, applied) = json_request(
        &app,
        "POST",
        &format!("/api/v1/invoices/{settlement_id}/prepayment-allocations"),
        &billing,
        Some(json!({
            "request_id": Uuid::new_v4(),
            "advance_invoice_id": advance_id,
            "amount_gross": 60
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "prepayment response: {applied:?}");
    assert_eq!(applied["paid_amount"], "59");
    assert_eq!(applied["prepayment_applied_amount"], "60");
    assert_eq!(applied["status"], "paid");
    assert_eq!(applied["balance_due"], "0");

    let (status, reversed) = json_request(
        &app,
        "POST",
        &format!("/api/v1/invoices/{settlement_id}/payments/{settlement_payment_id}/reversal"),
        &billing,
        Some(json!({ "note": "Cash receipt belonged to another invoice" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "reversal response: {reversed:?}");
    assert_eq!(reversed["invoice"]["paid_amount"], "0");
    assert_eq!(reversed["invoice"]["prepayment_applied_amount"], "60");
    assert_eq!(reversed["invoice"]["status"], "partially_paid");
    assert_eq!(reversed["invoice"]["balance_due"], "59");
}
