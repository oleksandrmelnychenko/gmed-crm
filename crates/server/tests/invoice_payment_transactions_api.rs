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
                patient_id, first_name, last_name, birth_date, gender, created_by,
                address_street, address_zip, address_city, address_country
           ) VALUES ($1, 'Payment', 'Journal', '1990-01-01', 'diverse', $2,
                'Teststraße 1', '10115', 'Berlin', 'Deutschland')
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
    seed_invoice_in_status(
        pool,
        order_id,
        patient_id,
        created_by,
        tag,
        invoice_type,
        gross,
        hide_amounts,
        "sent",
    )
    .await
}

/// A released (`sent`) invoice carries its number; a draft is numbered only
/// when it is released and can never return to draft afterwards.
#[allow(clippy::too_many_arguments)]
async fn seed_invoice_in_status(
    pool: &PgPool,
    order_id: Uuid,
    patient_id: Uuid,
    created_by: Uuid,
    tag: &str,
    invoice_type: &str,
    gross: i64,
    hide_amounts: bool,
    status: &str,
) -> Uuid {
    let net = Decimal::new(gross, 0) * Decimal::new(100, 0) / Decimal::new(119, 0);
    let net = gmed_server::money::round_cents(net);
    let gross = Decimal::new(gross, 0);
    sqlx::query_scalar(
        r#"INSERT INTO invoices (
                order_id, patient_id, invoice_number, invoice_type, status,
                due_date, total_net, total_vat, total_gross, paid_amount,
                line_items, notes, portal_visible, hide_amounts_from_patient, created_by
           ) VALUES (
                $1, $2, CASE WHEN $11 = 'draft' THEN NULL ELSE $3 END, $4, $11, CURRENT_DATE + 14,
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
    .bind(status)
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
            "received_on": gmed_server::app_time::today().to_string(),
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
            "received_on": gmed_server::app_time::today().to_string()
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
            "received_on": gmed_server::app_time::today().to_string(),
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
            "received_on": gmed_server::app_time::today().to_string(),
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
    let today = gmed_server::app_time::today().to_string();
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
            "received_on": gmed_server::app_time::today().to_string()
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

    // The final invoice is already released, so the advance paid now is
    // credited to it automatically.
    record_payment(&app, &billing, advance_id, Uuid::new_v4(), 60, "ADVANCE").await;
    let allocated: Decimal = sqlx::query_scalar(
        r#"SELECT COALESCE(SUM(amount_gross), 0) FROM invoice_prepayment_allocations
           WHERE target_invoice_id = $1 AND advance_invoice_id = $2"#,
    )
    .bind(settlement_id)
    .bind(advance_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(allocated, Decimal::new(60, 0));
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
        "GET",
        &format!("/api/v1/invoices/{settlement_id}"),
        &billing,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "settlement invoice: {applied:?}");
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

#[tokio::test]
async fn payment_correction_reverses_the_original_and_appends_the_corrected_receipt() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };
    let tag = unique_tag("payment-correction");
    let billing_id = seed_user(&pool, &tag, "billing").await;
    let manager_id = seed_user(&pool, &format!("{tag}-pm"), "patient_manager").await;
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    seed_assignment(&pool, patient_id, billing_id, admin_id).await;
    seed_assignment(&pool, patient_id, manager_id, admin_id).await;
    let order_id = seed_order(&pool, patient_id, admin_id, &tag).await;
    let invoice_id = seed_invoice(
        &pool, order_id, patient_id, admin_id, &tag, "interim", 119, false,
    )
    .await;
    let billing = auth_header_for(billing_id, "billing");
    let manager = auth_header_for(manager_id, "patient_manager");

    let payment = record_payment(&app, &billing, invoice_id, Uuid::new_v4(), 100, "WRONG").await;
    let payment_id = payment["payment_transaction_id"].as_str().unwrap();
    let correction_path = format!("/api/v1/invoices/{invoice_id}/payments/{payment_id}/correction");
    let today = gmed_server::app_time::today().to_string();
    let correction = |amount: i64, request_id: Uuid, reason: &str| {
        json!({
            "request_id": request_id,
            "amount_gross": amount,
            "payment_method": "cash",
            "payment_reference": "RIGHT",
            "received_on": today,
            "note": null,
            "reason": reason
        })
    };

    let (status, _) = json_request(
        &app,
        "POST",
        &correction_path,
        &manager,
        Some(correction(60, Uuid::new_v4(), "typo")),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    let (status, _) = json_request(
        &app,
        "POST",
        &correction_path,
        &billing,
        Some(correction(60, Uuid::new_v4(), " ")),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);

    let (status, _) = json_request(
        &app,
        "POST",
        &correction_path,
        &billing,
        Some(correction(120, Uuid::new_v4(), "typo")),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::CONFLICT,
        "correction above the invoice total"
    );

    let request_id = Uuid::new_v4();
    let (status, body) = json_request(
        &app,
        "POST",
        &correction_path,
        &billing,
        Some(correction(60, request_id, "typo")),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "correction response: {body:?}");
    assert_eq!(body["invoice"]["status"], "partially_paid");
    let corrected_id = body["payment_transaction_id"].as_str().unwrap().to_string();

    let (status, replay) = json_request(
        &app,
        "POST",
        &correction_path,
        &billing,
        Some(correction(60, request_id, "typo")),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(replay["idempotent_replay"], true);
    assert_eq!(replay["payment_transaction_id"], corrected_id.as_str());

    let (status, _) = json_request(
        &app,
        "POST",
        &correction_path,
        &billing,
        Some(correction(70, Uuid::new_v4(), "again")),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::CONFLICT,
        "a corrected payment is already reversed"
    );

    let paid_amount: Decimal = sqlx::query_scalar("SELECT paid_amount FROM invoices WHERE id = $1")
        .bind(invoice_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(paid_amount, Decimal::new(60, 0));

    let (status, history) = json_request(
        &app,
        "GET",
        &format!("/api/v1/invoices/{invoice_id}/payments"),
        &billing,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let items = history["items"].as_array().unwrap();
    assert_eq!(items.len(), 3, "original, reversal and corrected receipt");
    let original = items.iter().find(|item| item["id"] == payment_id).unwrap();
    assert_eq!(original["is_reversed"], true);
    assert_eq!(
        original["corrected_by_transaction_id"],
        corrected_id.as_str()
    );
    let corrected = items
        .iter()
        .find(|item| item["id"] == corrected_id.as_str())
        .unwrap();
    assert_eq!(corrected["corrects_transaction_id"], payment_id);
    assert_eq!(corrected["payment_method"], "cash");

    let ledger_gross: Decimal = sqlx::query_scalar(
        "SELECT COALESCE(SUM(amount_gross), 0) FROM accounting_entries
         WHERE source_invoice_id = $1 AND source_invoice_payment_transaction_id IS NOT NULL",
    )
    .bind(invoice_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(ledger_gross, Decimal::new(60, 0));
}

#[tokio::test]
async fn overdue_invoice_stays_overdue_after_a_partial_payment() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };
    let tag = unique_tag("overdue-partial");
    let billing_id = seed_user(&pool, &tag, "billing").await;
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    seed_assignment(&pool, patient_id, billing_id, admin_id).await;
    let order_id = seed_order(&pool, patient_id, admin_id, &tag).await;
    let invoice_id = seed_invoice(
        &pool, order_id, patient_id, admin_id, &tag, "interim", 119, false,
    )
    .await;
    sqlx::query(
        "UPDATE invoices SET status = 'overdue', due_date = CURRENT_DATE - 5 WHERE id = $1",
    )
    .bind(invoice_id)
    .execute(&pool)
    .await
    .unwrap();
    let billing = auth_header_for(billing_id, "billing");

    let partial = record_payment(&app, &billing, invoice_id, Uuid::new_v4(), 19, "PART").await;
    assert_eq!(partial["invoice"]["status"], "overdue");
    assert_eq!(partial["invoice"]["paid_amount"], "19");
    let today = gmed_server::app_time::today();
    let (status, statement) = json_request(
        &app,
        "GET",
        &format!("/api/v1/patients/{patient_id}/account-statement?to={today}"),
        &billing,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{statement}");
    assert_eq!(statement["items"][0]["status"], "overdue");
    assert_eq!(statement["items"][0]["amount_due"], "100");

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/invoices/{invoice_id}/status"),
        &billing,
        Some(json!({ "status": "draft" })),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "overdue -> draft: {body:?}");

    let settled = record_payment(&app, &billing, invoice_id, Uuid::new_v4(), 100, "REST").await;
    assert_eq!(settled["invoice"]["status"], "paid");
}

/// Owner decision 2026-11-12 (replaces QA 2026-11-01 R4-1/R4-4, which netted
/// the credit): a credit balance on another invoice is not taken off an
/// overdue invoice. The invoice stays in the overdue list, a reminder demands
/// its own open amount, and the detail names the credit as available for
/// Billing's explicit transfer.
#[tokio::test]
async fn an_overdue_invoice_keeps_its_own_open_amount_next_to_a_credit_on_another_invoice() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };
    let tag = unique_tag("covered-overdue");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let billing_id = seed_user(&pool, &tag, "billing").await;
    seed_assignment(&pool, patient_id, billing_id, admin_id).await;
    let order_id = seed_order(&pool, patient_id, admin_id, &tag).await;
    let overpaid = seed_invoice(
        &pool,
        order_id,
        patient_id,
        admin_id,
        &format!("{tag}-a"),
        "interim",
        100,
        false,
    )
    .await;
    let covered = seed_invoice_in_status(
        &pool,
        order_id,
        patient_id,
        admin_id,
        &format!("{tag}-b"),
        "interim",
        50,
        false,
        "overdue",
    )
    .await;
    let open = seed_invoice_in_status(
        &pool,
        order_id,
        patient_id,
        admin_id,
        &format!("{tag}-c"),
        "interim",
        70,
        false,
        "overdue",
    )
    .await;
    let billing = auth_header_for(billing_id, "billing");
    // 80 beyond the 100: a credit of 80, not netted into either overdue invoice.
    let (status, payment) = json_request(
        &app,
        "POST",
        &format!("/api/v1/invoices/{overpaid}/payments"),
        &billing,
        Some(json!({
            "request_id": Uuid::new_v4(),
            "amount_gross": "180",
            "payment_method": "bank_transfer",
            "received_on": gmed_server::app_time::today().to_string(),
            "accept_overpayment": true,
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{payment:?}");

    let (status, list) = json_request(
        &app,
        "GET",
        &format!("/api/v1/invoices?order_id={order_id}&status=overdue"),
        &billing,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{list:?}");
    let mut ids = list["items"]
        .as_array()
        .unwrap()
        .iter()
        .map(|item| item["id"].as_str().unwrap().to_string())
        .collect::<Vec<_>>();
    ids.sort();
    let mut expected = vec![covered.to_string(), open.to_string()];
    expected.sort();
    assert_eq!(ids, expected, "{list:?}");
    assert_eq!(list["total"], 2);

    let detail = invoice_detail(&app, &billing, covered).await;
    assert_eq!(detail["status"], "overdue");
    assert_eq!(detail["balance_due"], "50");
    assert_eq!(detail["reminder_amount"], "50");
    assert_eq!(detail["recipient_credit_available"], "80");
    let detail = invoice_detail(&app, &billing, open).await;
    assert_eq!(detail["reminder_amount"], "70");
    assert_eq!(detail["recipient_credit_available"], "80");

    // The statement asks for each invoice's own open amount and names the
    // credit separately.
    let (status, statement) = json_request(
        &app,
        "GET",
        &format!("/api/v1/patients/{patient_id}/account-statement"),
        &billing,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{statement:?}");
    assert_eq!(statement["summary"]["amount_to_pay"], "120");
    assert_eq!(statement["summary"]["credit_balance"], "80");
}

async fn category_totals(pool: &PgPool, invoice_id: Uuid) -> Vec<(String, Decimal)> {
    sqlx::query(
        r#"SELECT category, SUM(amount_gross) AS gross
           FROM accounting_entries
           WHERE source_invoice_id = $1
           GROUP BY category
           HAVING SUM(amount_gross) <> 0
           ORDER BY category"#,
    )
    .bind(invoice_id)
    .fetch_all(pool)
    .await
    .unwrap()
    .into_iter()
    .map(|row| (row.get("category"), row.get("gross")))
    .collect()
}

#[tokio::test]
async fn overpayment_becomes_patient_credit_that_can_be_moved_to_another_invoice() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };
    let tag = unique_tag("overpayment");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let billing_id = seed_user(&pool, &tag, "billing").await;
    seed_assignment(&pool, patient_id, billing_id, admin_id).await;
    let order_id = seed_order(&pool, patient_id, admin_id, &tag).await;
    let paid_invoice = seed_invoice(
        &pool,
        order_id,
        patient_id,
        admin_id,
        &format!("{tag}-a"),
        "interim",
        100,
        false,
    )
    .await;
    let open_invoice = seed_invoice(
        &pool,
        order_id,
        patient_id,
        admin_id,
        &format!("{tag}-b"),
        "final",
        200,
        false,
    )
    .await;
    let billing = auth_header_for(billing_id, "billing");
    let today = gmed_server::app_time::today().to_string();
    let receipt = |accept: bool| {
        json!({
            "request_id": Uuid::new_v4(),
            "amount_gross": "150",
            "payment_method": "bank_transfer",
            "payment_reference": "BANK-150",
            "received_on": today,
            "accept_overpayment": accept,
        })
    };

    // Unconfirmed overpayments are still refused, with the excess named.
    let (status, refused) = json_request(
        &app,
        "POST",
        &format!("/api/v1/invoices/{paid_invoice}/payments"),
        &billing,
        Some(receipt(false)),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{refused:?}");
    assert_eq!(refused["error"], "payment_exceeds_balance");
    assert_eq!(refused["overpayment_gross"], "50");

    let (status, overpaid) = json_request(
        &app,
        "POST",
        &format!("/api/v1/invoices/{paid_invoice}/payments"),
        &billing,
        Some(receipt(true)),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{overpaid:?}");
    assert_eq!(overpaid["overpayment_gross"], "50");
    assert_eq!(overpaid["invoice"]["status"], "paid");
    assert_eq!(overpaid["invoice"]["paid_amount"], "150");
    assert_eq!(overpaid["invoice"]["balance_due"], "0");
    assert_eq!(overpaid["invoice"]["credit_balance"], "50");
    assert_eq!(overpaid["invoice"]["refundable_cash_amount"], "50");
    assert_eq!(
        overpaid["invoice"]["credit_transfer_targets"][0]["invoice_id"],
        open_invoice.to_string()
    );
    assert_eq!(
        overpaid["invoice"]["credit_transfer_targets"][0]["balance_due"],
        "200"
    );
    // The excess is patient credit, not revenue with VAT.
    assert_eq!(
        category_totals(&pool, paid_invoice).await,
        vec![
            ("patient_credit".to_string(), Decimal::new(50, 0)),
            ("service_revenue".to_string(), Decimal::new(100, 0)),
        ]
    );

    let transfer_request = json!({
        "request_id": Uuid::new_v4(),
        "target_invoice_id": open_invoice,
        "amount_gross": "50",
        "transferred_on": today,
        "note": "Overpayment of BANK-150",
    });
    let (status, transferred) = json_request(
        &app,
        "POST",
        &format!("/api/v1/invoices/{paid_invoice}/credit-transfers"),
        &billing,
        Some(transfer_request.clone()),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{transferred:?}");
    let transfer_id = transferred["credit_transfer_id"]
        .as_str()
        .unwrap()
        .to_string();
    assert_eq!(transferred["invoice"]["credit_balance"], "0");
    assert_eq!(transferred["invoice"]["paid_amount"], "100");
    assert_eq!(transferred["invoice"]["status"], "paid");
    assert_eq!(
        transferred["invoice"]["credit_transfers"][0]["direction"],
        "out"
    );
    let (status, replay) = json_request(
        &app,
        "POST",
        &format!("/api/v1/invoices/{paid_invoice}/credit-transfers"),
        &billing,
        Some(transfer_request),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{replay:?}");
    assert_eq!(replay["idempotent_replay"], true);

    let (status, target) = json_request(
        &app,
        "GET",
        &format!("/api/v1/invoices/{open_invoice}"),
        &billing,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(target["paid_amount"], "50");
    assert_eq!(target["balance_due"], "150");
    assert_eq!(target["status"], "partially_paid");
    assert_eq!(target["credit_transfers"][0]["direction"], "in");
    assert_eq!(
        category_totals(&pool, paid_invoice).await,
        vec![("service_revenue".to_string(), Decimal::new(100, 0))]
    );
    assert_eq!(
        category_totals(&pool, open_invoice).await,
        vec![("service_revenue".to_string(), Decimal::new(50, 0))]
    );
    // The patient statement names the receiving leg a credit from the source
    // invoice, not "Payment received": no money came in. Neither leg is a
    // payment or a refund (QA D3-05): the transfer moves credit, no cash.
    let (status, statement) = json_request(
        &app,
        "GET",
        &format!("/api/v1/patients/{patient_id}/account-statement"),
        &billing,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{statement:?}");
    let movements = statement["movements"].as_array().unwrap();
    let credit_legs = movements
        .iter()
        .filter(|movement| {
            movement["kind"] == "credit_transfer_in"
                && movement["description"]
                    .as_str()
                    .is_some_and(|text| text.starts_with("Credit from invoice "))
        })
        .count();
    assert_eq!(credit_legs, 1, "{movements:?}");
    let source_legs = movements
        .iter()
        .filter(|movement| {
            movement["kind"] == "credit_transfer_out"
                && movement["description"]
                    .as_str()
                    .is_some_and(|text| text.starts_with("Credit applied to invoice "))
        })
        .count();
    assert_eq!(source_legs, 1, "{movements:?}");
    assert!(
        !movements
            .iter()
            .any(|movement| movement["kind"] == "refund"),
        "{movements:?}"
    );

    // The accounting ledger names both legs a credit transfer, not a refund
    // and a receipt, and the CSV books them as a non-cash transfer.
    let (status, ledger) = json_request(
        &app,
        "GET",
        &format!(
            "/api/v1/invoices/accounting-ledger?patient_id={patient_id}&year={}",
            &today[..4]
        ),
        &billing,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{ledger:?}");
    let transfer_entries = ledger["entries"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|entry| entry["payment_method"] == "credit_transfer")
        .collect::<Vec<_>>();
    assert!(!transfer_entries.is_empty(), "{ledger:?}");
    assert!(transfer_entries.iter().all(|entry| {
        entry["cash_effective"] == false
            && entry["description"].as_str().is_some_and(|text| {
                text.starts_with("Credit applied to invoice ")
                    || text.starts_with("Credit from invoice ")
            })
    }));
    let csv_request = axum::http::Request::builder()
        .uri(format!(
            "/api/v1/invoices/accounting-ledger/export?patient_id={patient_id}&year={}",
            &today[..4]
        ))
        .header("Authorization", &billing)
        .body(Body::empty())
        .unwrap();
    let csv_response = app.clone().oneshot(csv_request).await.unwrap();
    assert_eq!(csv_response.status(), StatusCode::OK);
    let csv = String::from_utf8(
        axum::body::to_bytes(csv_response.into_body(), 1024 * 1024)
            .await
            .unwrap()
            .to_vec(),
    )
    .unwrap();
    assert!(csv.contains("Guthabenumbuchung"), "{csv}");
    assert!(!csv.contains("invoice_refund"), "{csv}");
    assert!(!csv.contains("Rückerstattung"), "{csv}");

    // A transfer leg cannot be reversed or corrected on its own.
    let target_payment_id: Uuid = sqlx::query_scalar(
        "SELECT target_payment_transaction_id FROM invoice_credit_transfers WHERE id = $1::uuid",
    )
    .bind(&transfer_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    let source_refund_id: Uuid = sqlx::query_scalar(
        "SELECT source_refund_transaction_id FROM invoice_credit_transfers WHERE id = $1::uuid",
    )
    .bind(&transfer_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/invoices/{open_invoice}/payments/{target_payment_id}/reversal"),
        &billing,
        Some(json!({ "note": "Wrong" })),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{body:?}");
    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/invoices/{paid_invoice}/refunds/{source_refund_id}/reversal"),
        &billing,
        Some(json!({ "reason": "Wrong" })),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{body:?}");
    let mut half_reversal = pool.begin().await.unwrap();
    sqlx::query(
        r#"INSERT INTO invoice_payment_transactions (
               invoice_id, transaction_type, reverses_transaction_id, amount_gross,
               payment_method, received_on, note, created_by
           ) VALUES ($1, 'reversal', $2, 50, 'credit_transfer', CURRENT_DATE, 'half', $3)"#,
    )
    .bind(open_invoice)
    .bind(target_payment_id)
    .bind(admin_id)
    .execute(&mut *half_reversal)
    .await
    .unwrap();
    let error = half_reversal.commit().await.unwrap_err();
    assert!(
        error.to_string().contains("reversed only as a whole"),
        "{error}"
    );

    let (status, reversed) = json_request(
        &app,
        "POST",
        &format!("/api/v1/invoices/{open_invoice}/credit-transfers/{transfer_id}/reversal"),
        &billing,
        Some(json!({ "reason": "Patient wants the money back" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{reversed:?}");
    assert_eq!(reversed["invoice"]["paid_amount"], "0");
    assert_eq!(
        reversed["invoice"]["credit_transfers"][0]["is_reversed"],
        true
    );
    let (_, source) = json_request(
        &app,
        "GET",
        &format!("/api/v1/invoices/{paid_invoice}"),
        &billing,
        None,
    )
    .await;
    assert_eq!(source["credit_balance"], "50");
    assert_eq!(
        category_totals(&pool, paid_invoice).await,
        vec![
            ("patient_credit".to_string(), Decimal::new(50, 0)),
            ("service_revenue".to_string(), Decimal::new(100, 0)),
        ]
    );

    // The credit is refunded through the regular refund journal.
    let (status, refunded) = json_request(
        &app,
        "POST",
        &format!("/api/v1/invoices/{paid_invoice}/refunds"),
        &billing,
        Some(json!({
            "request_id": Uuid::new_v4(),
            "amount_gross": "50",
            "payment_method": "bank_transfer",
            "refunded_on": today,
            "reason": "Overpayment returned"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{refunded:?}");
    assert_eq!(refunded["invoice"]["credit_balance"], "0");
    assert_eq!(
        category_totals(&pool, paid_invoice).await,
        vec![("service_revenue".to_string(), Decimal::new(100, 0))]
    );
}

/// Owner decision 2026-11-12 (QA L12, replaces the D3-04 confirmation):
/// credit never moves to another recipient's invoice. The target list leaves
/// it out and the route refuses it with a 422 naming both recipients, also
/// with the old confirmation and when the order is cancelled.
#[tokio::test]
async fn credit_transfer_to_another_recipient_is_refused() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };
    let tag = unique_tag("transfer-recipients");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let billing_id = seed_user(&pool, &tag, "billing").await;
    seed_assignment(&pool, patient_id, billing_id, admin_id).await;
    let order_id = seed_order(&pool, patient_id, admin_id, &tag).await;
    let source = seed_invoice(
        &pool,
        order_id,
        patient_id,
        admin_id,
        &format!("{tag}-a"),
        "interim",
        100,
        false,
    )
    .await;
    let target: Uuid = sqlx::query_scalar(
        r#"INSERT INTO invoices (
                order_id, patient_id, invoice_number, invoice_type, status,
                due_date, total_net, total_vat, total_gross, paid_amount,
                line_items, notes, portal_visible, hide_amounts_from_patient,
                created_by, recipient_snapshot
           ) VALUES (
                $1, $2, $3, 'final', 'sent', CURRENT_DATE + 14,
                95, 18.05, 113.05, 0,
                '[{"description":"Flughafentransfer","quantity":"1","unit_price":"95","vat_rate":"19","is_cost_passthrough":false,"line_net":"95","line_vat":"18.05","line_gross":"113.05"}]',
                'Payment journal test', true, false, $4,
                '{"kind":"payer","name":"Beispiel GmbH"}'::jsonb
           ) RETURNING id"#,
    )
    .bind(order_id)
    .bind(patient_id)
    .bind(format!("INV-{tag}-b"))
    .bind(admin_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    let billing = auth_header_for(billing_id, "billing");
    let today = gmed_server::app_time::today().to_string();
    let (status, overpaid) = json_request(
        &app,
        "POST",
        &format!("/api/v1/invoices/{source}/payments"),
        &billing,
        Some(json!({
            "request_id": Uuid::new_v4(),
            "amount_gross": "130",
            "payment_method": "bank_transfer",
            "received_on": today,
            "accept_overpayment": true,
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{overpaid:?}");
    // Owner decision 2026-11-12 (QA L12): another person's invoice is no
    // target, and the move is refused even with the old confirmation.
    let targets = overpaid["invoice"]["credit_transfer_targets"]
        .as_array()
        .unwrap();
    assert!(
        targets
            .iter()
            .all(|item| item["invoice_id"] != target.to_string()),
        "{targets:?}"
    );

    let request = json!({
        "request_id": Uuid::new_v4(),
        "target_invoice_id": target,
        "amount_gross": "30",
        "transferred_on": today,
    });
    let mut confirmed = request.clone();
    confirmed["confirm_recipient_mismatch"] = json!(true);
    for body in [request, confirmed] {
        let (status, refused) = json_request(
            &app,
            "POST",
            &format!("/api/v1/invoices/{source}/credit-transfers"),
            &billing,
            Some(body),
        )
        .await;
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{refused:?}");
        assert_eq!(refused["error"], "credit_transfer_other_person");
        assert_eq!(refused["target_recipient_name"], "Beispiel GmbH");
        assert_eq!(refused["target_invoice_number"], format!("INV-{tag}-b"));
        assert_eq!(refused["source_invoice_number"], format!("INV-{tag}-a"));
        assert!(
            refused["source_recipient_name"]
                .as_str()
                .is_some_and(|name| !name.is_empty()),
            "{refused:?}"
        );
    }

    // Also when the credit comes from a cancelled order.
    sqlx::query("UPDATE orders SET status = 'cancelled', cancelled_at = now() WHERE id = $1")
        .bind(order_id)
        .execute(&pool)
        .await
        .unwrap();
    let (status, refused) = json_request(
        &app,
        "POST",
        &format!("/api/v1/invoices/{source}/credit-transfers"),
        &billing,
        Some(json!({
            "request_id": Uuid::new_v4(),
            "target_invoice_id": target,
            "amount_gross": "30",
            "transferred_on": today,
        })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{refused:?}");
    assert_eq!(refused["error"], "credit_transfer_other_person");

    let statement_path = format!("/api/v1/patients/{patient_id}/account-statement");
    let (status, before) = json_request(&app, "GET", &statement_path, &billing, None).await;
    assert_eq!(status, StatusCode::OK, "{before}");
    let target_item = before["items"]
        .as_array()
        .unwrap()
        .iter()
        .find(|item| item["id"] == target.to_string())
        .unwrap();
    assert_eq!(target_item["amount_due"], "113.05");
    // Credit is never netted (owner decision 2026-11-12): no such figure.
    assert!(target_item.get("credit_applied").is_none(), "{target_item}");
    assert_eq!(before["summary"]["total_due"], "113.05");

    // Nothing moved: the credit stays with whoever paid it.
    let moved: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM invoice_credit_transfers WHERE source_invoice_id = $1",
    )
    .bind(source)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(moved, 0);
}

/// Release QA D R-02: an invoice to the patient and one to the patient's own
/// name at another invoice address are one recipient. The target list does
/// not call it another recipient and the move needs no confirmation.
#[tokio::test]
async fn credit_transfer_to_the_same_person_at_another_address_asks_nothing() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };
    let tag = unique_tag("transfer-same-person");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let billing_id = seed_user(&pool, &tag, "billing").await;
    seed_assignment(&pool, patient_id, billing_id, admin_id).await;
    let order_id = seed_order(&pool, patient_id, admin_id, &tag).await;
    let source = seed_invoice(
        &pool,
        order_id,
        patient_id,
        admin_id,
        &format!("{tag}-a"),
        "interim",
        100,
        false,
    )
    .await;
    let patient_name: String = sqlx::query_scalar(
        "SELECT gmed_person_display_name(title, first_name, last_name) FROM patients WHERE id = $1",
    )
    .bind(patient_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    let target: Uuid = sqlx::query_scalar(
        r#"INSERT INTO invoices (
                order_id, patient_id, invoice_number, invoice_type, status,
                due_date, total_net, total_vat, total_gross, paid_amount,
                line_items, notes, portal_visible, hide_amounts_from_patient,
                created_by, recipient_snapshot
           ) VALUES (
                $1, $2, $3, 'final', 'sent', CURRENT_DATE + 14,
                95, 18.05, 113.05, 0,
                '[{"description":"Flughafentransfer","quantity":"1","unit_price":"95","vat_rate":"19","is_cost_passthrough":false,"line_net":"95","line_vat":"18.05","line_gross":"113.05"}]',
                'Payment journal test', true, false, $4,
                jsonb_build_object('kind', 'payer', 'name', $5::text)
           ) RETURNING id"#,
    )
    .bind(order_id)
    .bind(patient_id)
    .bind(format!("INV-{tag}-b"))
    .bind(admin_id)
    .bind(&patient_name)
    .fetch_one(&pool)
    .await
    .unwrap();
    let billing = auth_header_for(billing_id, "billing");
    let today = gmed_server::app_time::today().to_string();
    let (status, overpaid) = json_request(
        &app,
        "POST",
        &format!("/api/v1/invoices/{source}/payments"),
        &billing,
        Some(json!({
            "request_id": Uuid::new_v4(),
            "amount_gross": "130",
            "payment_method": "bank_transfer",
            "received_on": today,
            "accept_overpayment": true,
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{overpaid:?}");
    let listed = overpaid["invoice"]["credit_transfer_targets"]
        .as_array()
        .unwrap()
        .iter()
        .find(|item| item["invoice_id"] == target.to_string())
        .unwrap();
    assert_eq!(listed["same_recipient"], true, "{listed}");

    let (status, moved) = json_request(
        &app,
        "POST",
        &format!("/api/v1/invoices/{source}/credit-transfers"),
        &billing,
        Some(json!({
            "request_id": Uuid::new_v4(),
            "target_invoice_id": target,
            "amount_gross": "30",
            "transferred_on": today,
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{moved:?}");
}

/// Paid advances settle the final invoice as soon as it is released (oldest
/// first, up to its balance), and an advance paid later still reaches a
/// released final invoice. Every "to pay" figure is net of advances: before,
/// the portal asked for the full final invoice next to a balance that already
/// counted the advance, so the patient could pay twice.
#[tokio::test]
async fn released_final_invoice_takes_paid_advances_and_to_pay_figures_are_net() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };
    let tag = unique_tag("advance-application");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let billing_id = seed_user(&pool, &tag, "billing").await;
    let manager_id = seed_user(&pool, &tag, "patient_manager").await;
    for user_id in [billing_id, manager_id] {
        seed_assignment(&pool, patient_id, user_id, admin_id).await;
    }
    let order_id = seed_order(&pool, patient_id, admin_id, &tag).await;
    let first_advance = seed_invoice(
        &pool,
        order_id,
        patient_id,
        admin_id,
        &format!("{tag}-adv1"),
        "advance",
        500,
        false,
    )
    .await;
    let second_advance = seed_invoice(
        &pool,
        order_id,
        patient_id,
        admin_id,
        &format!("{tag}-adv2"),
        "advance",
        300,
        false,
    )
    .await;
    let late_advance = seed_invoice(
        &pool,
        order_id,
        patient_id,
        admin_id,
        &format!("{tag}-adv3"),
        "advance",
        100,
        false,
    )
    .await;
    sqlx::query("UPDATE invoices SET issued_at = now() - interval '3 days' WHERE id = $1")
        .bind(first_advance)
        .execute(&pool)
        .await
        .unwrap();
    // A draft: a released invoice can never return to draft.
    let final_invoice = seed_invoice_in_status(
        &pool,
        order_id,
        patient_id,
        admin_id,
        &format!("{tag}-final"),
        "final",
        1000,
        false,
        "draft",
    )
    .await;
    let billing = auth_header_for(billing_id, "billing");
    let manager = auth_header_for(manager_id, "patient_manager");
    record_payment(&app, &billing, first_advance, Uuid::new_v4(), 500, "ADV-1").await;
    record_payment(&app, &billing, second_advance, Uuid::new_v4(), 300, "ADV-2").await;

    let (status, released) = json_request(
        &app,
        "POST",
        &format!("/api/v1/invoices/{final_invoice}/status"),
        &billing,
        Some(json!({ "status": "sent" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{released:?}");
    assert_eq!(released["prepayment_applied_amount"], "800");
    assert_eq!(released["balance_due"], "200");
    assert_eq!(released["status"], "partially_paid");
    let allocations = released["prepayment_allocations"].as_array().unwrap();
    assert_eq!(allocations.len(), 2);
    assert_eq!(
        allocations[0]["advance_invoice_id"],
        first_advance.to_string()
    );
    assert_eq!(allocations[0]["amount_gross"], "500");
    support::wait_until("automatic advance audit", || {
        let pool = pool.clone();
        async move {
            sqlx::query_scalar::<_, i64>(
                r#"SELECT COUNT(*) FROM audit_log
                   WHERE entity_id = $1 AND action = 'apply_invoice_prepayment'
                     AND context ->> 'automatic' = 'true'"#,
            )
            .bind(final_invoice)
            .fetch_one(&pool)
            .await
            .unwrap()
                >= 2
        }
    })
    .await;

    // The advance still unpaid at the release is billed by the final invoice:
    // its request is closed by a credit note, so the patient is not asked
    // twice (QA D-56).
    let (_, late_detail) = json_request(
        &app,
        "GET",
        &format!("/api/v1/invoices/{late_advance}"),
        &billing,
        None,
    )
    .await;
    assert_eq!(late_detail["credited_amount"], "100", "{late_detail}");
    assert_eq!(late_detail["balance_due"], "0");
    assert_eq!(late_detail["display_status"], "credited");
    assert_eq!(
        late_detail["advance_settlement"]["final_invoice_id"],
        final_invoice.to_string()
    );
    assert_eq!(late_detail["advance_settlement"]["open_rest"], "0");
    let credit_reason: String = sqlx::query_scalar(
        "SELECT reason FROM invoice_credit_note_transactions WHERE invoice_id = $1",
    )
    .bind(late_advance)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(credit_reason.contains("Schlussrechnung"), "{credit_reason}");
    // The patient pays the rest on the final invoice.
    record_payment(&app, &billing, final_invoice, Uuid::new_v4(), 100, "FINAL").await;
    let (_, final_detail) = json_request(
        &app,
        "GET",
        &format!("/api/v1/invoices/{final_invoice}"),
        &billing,
        None,
    )
    .await;
    assert_eq!(final_detail["prepayment_applied_amount"], "800");
    assert_eq!(final_detail["balance_due"], "100");

    // One "to pay" figure everywhere: order card, invoice list, statement.
    let (status, economics) = json_request(
        &app,
        "GET",
        &format!("/api/v1/orders/{order_id}/economics"),
        &manager,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{economics:?}");
    assert_eq!(economics["actual"]["invoice_outstanding_gross"], "100");
    assert_eq!(economics["actual"]["advance_available_gross"], "0");
    assert_eq!(economics["actual"]["patient_open_gross"], "100");
    let (status, statement) = json_request(
        &app,
        "GET",
        &format!("/api/v1/patients/{patient_id}/account-statement?currency=EUR"),
        &auth_header_for(admin_id, "ceo"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{statement:?}");
    assert_eq!(statement["summary"]["amount_to_pay"], "100");
    assert_eq!(statement["summary"]["total_due"], "100");
    assert_eq!(statement["summary"]["calculated_balance"], "100");

    // An advance deducted on the issued final is part of it: no release by
    // one click (money QA 2026-11-15, S1-2).
    let second_allocation = allocations[1]["id"].as_str().unwrap().to_string();
    let (status, refused) = json_request(
        &app,
        "DELETE",
        &format!("/api/v1/invoices/{final_invoice}/prepayment-allocations/{second_allocation}"),
        &billing,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{refused:?}");
    assert_eq!(refused["error"], "prepayment_locked_by_issued_final");
    // Released by a correction document (as a credit note on the final
    // does): an advance still unapplied is netted, not demanded.
    let mut tx = pool.begin().await.unwrap();
    sqlx::query("SELECT set_config('gmed.prepayment_release_context', 'correction', true)")
        .execute(&mut *tx)
        .await
        .unwrap();
    sqlx::query("DELETE FROM invoice_prepayment_allocations WHERE id = $1")
        .bind(Uuid::parse_str(&second_allocation).unwrap())
        .execute(&mut *tx)
        .await
        .unwrap();
    tx.commit().await.unwrap();
    let released_allocation = invoice_detail(&app, &billing, final_invoice).await;
    assert_eq!(released_allocation["balance_due"], "400");
    let (_, list) = json_request(
        &app,
        "GET",
        &format!("/api/v1/invoices?order_id={order_id}&invoice_type=final"),
        &billing,
        None,
    )
    .await;
    assert_eq!(list["items"][0]["balance_due"], "400");
    assert_eq!(list["items"][0]["advance_credit_available"], "300");
    assert_eq!(list["items"][0]["amount_to_pay"], "100");
    let (_, economics) = json_request(
        &app,
        "GET",
        &format!("/api/v1/orders/{order_id}/economics"),
        &manager,
        None,
    )
    .await;
    assert_eq!(economics["actual"]["invoice_outstanding_gross"], "400");
    assert_eq!(economics["actual"]["advance_available_gross"], "300");
    assert_eq!(economics["actual"]["patient_open_gross"], "100");
    let (_, statement) = json_request(
        &app,
        "GET",
        &format!("/api/v1/patients/{patient_id}/account-statement?currency=EUR"),
        &auth_header_for(admin_id, "ceo"),
        None,
    )
    .await;
    assert_eq!(statement["summary"]["invoice_due"], "400");
    assert_eq!(statement["summary"]["amount_to_pay"], "100");
    assert_eq!(statement["summary"]["total_due"], "100");
    let final_item = statement["items"]
        .as_array()
        .unwrap()
        .iter()
        .find(|item| item["id"] == final_invoice.to_string())
        .unwrap();
    assert_eq!(final_item["invoice_balance_due"], "400");
    assert_eq!(final_item["advance_credit"], "300");
    assert_eq!(final_item["amount_due"], "100");
}

fn money(value: &Value) -> Decimal {
    value.as_str().unwrap().parse::<Decimal>().unwrap()
}

/// When the default account of the currency is a cash account (Kasse), a
/// refund, a payment reversal or a lower corrected receipt never takes it
/// below zero; receipts only add money (2026-10-12).
#[tokio::test]
async fn refunds_and_payment_reversals_from_a_cash_default_account_need_the_cash() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };
    let tag = unique_tag("cash-default");
    let billing_id = seed_user(&pool, &tag, "billing").await;
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    seed_assignment(&pool, patient_id, billing_id, admin_id).await;
    let order_id = seed_order(&pool, patient_id, admin_id, &tag).await;
    let invoice_id = seed_invoice(
        &pool, order_id, patient_id, admin_id, &tag, "interim", 100, false,
    )
    .await;
    // A new, empty Kasse becomes the default EUR account (the seeded bank
    // account keeps its own movements).
    sqlx::query(
        "UPDATE company_financial_accounts SET is_default = false WHERE currency = 'EUR' AND is_default",
    )
    .execute(&pool)
    .await
    .unwrap();
    let kasse: Uuid = sqlx::query_scalar(
        r#"INSERT INTO company_financial_accounts (
               name, account_type, currency, opening_balance, opening_balance_on,
               is_default, is_active, created_by
           ) VALUES ($1, 'cash', 'EUR', 0, '2020-01-01', true, true, $2)
           RETURNING id"#,
    )
    .bind(format!("Kasse {tag}"))
    .bind(admin_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    let billing = auth_header_for(billing_id, "billing");
    let today = gmed_server::app_time::today().to_string();

    // 150 in cash for a 100 invoice (50 patient credit), then 120 leave the
    // Kasse: 30 are left.
    let (status, paid) = json_request(
        &app,
        "POST",
        &format!("/api/v1/invoices/{invoice_id}/payments"),
        &billing,
        Some(json!({
            "request_id": Uuid::new_v4(),
            "amount_gross": "150",
            "payment_method": "cash",
            "received_on": today,
            "accept_overpayment": true,
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{paid:?}");
    let payment_id = paid["payment_transaction_id"].as_str().unwrap().to_string();
    sqlx::query(
        r#"INSERT INTO company_financial_account_adjustments (
               financial_account_id, transaction_type, request_id, direction,
               amount, effective_on, reason, created_by
           ) VALUES ($1, 'adjustment', $2, 'outflow', 120, CURRENT_DATE, 'Barauszahlung', $3)"#,
    )
    .bind(kasse)
    .bind(Uuid::new_v4())
    .bind(admin_id)
    .execute(&pool)
    .await
    .unwrap();
    let refund = |amount: &str| {
        json!({
            "request_id": Uuid::new_v4(),
            "amount_gross": amount,
            "payment_method": "cash",
            "refunded_on": today,
            "reason": "Überzahlung bar zurück"
        })
    };
    let refunds_path = format!("/api/v1/invoices/{invoice_id}/refunds");
    let (status, refused) =
        json_request(&app, "POST", &refunds_path, &billing, Some(refund("50"))).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{refused:?}");
    assert_eq!(refused["error"], "cash_account_insufficient_balance");
    assert_eq!(money(&refused["available_balance"]), Decimal::new(30, 0));
    let refund_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM invoice_refund_transactions WHERE invoice_id = $1",
    )
    .bind(invoice_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(refund_count, 0);

    // Reversing the whole receipt would take 150 out of a Kasse holding 30.
    let (status, refused) = json_request(
        &app,
        "POST",
        &format!("/api/v1/invoices/{invoice_id}/payments/{payment_id}/reversal"),
        &billing,
        Some(json!({ "note": "Falsch erfasst" })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{refused:?}");
    assert_eq!(refused["error"], "cash_account_insufficient_balance");

    // A correction 150 -> 140 takes 10 out: allowed; 140 -> 100 more than is left.
    let correction = |amount: &str| {
        json!({
            "request_id": Uuid::new_v4(),
            "amount_gross": amount,
            "payment_method": "cash",
            "received_on": today,
            "reason": "Betrag korrigiert",
            "accept_overpayment": true,
        })
    };
    let (status, corrected) = json_request(
        &app,
        "POST",
        &format!("/api/v1/invoices/{invoice_id}/payments/{payment_id}/correction"),
        &billing,
        Some(correction("140")),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{corrected:?}");
    let corrected_id = corrected["payment_transaction_id"]
        .as_str()
        .unwrap()
        .to_string();
    let (status, refused) = json_request(
        &app,
        "POST",
        &format!("/api/v1/invoices/{invoice_id}/payments/{corrected_id}/correction"),
        &billing,
        Some(correction("100")),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{refused:?}");
    assert_eq!(money(&refused["available_balance"]), Decimal::new(20, 0));

    // The 20 left may leave as a refund, not a cent more.
    let (status, refunded) =
        json_request(&app, "POST", &refunds_path, &billing, Some(refund("20"))).await;
    assert_eq!(status, StatusCode::CREATED, "{refunded:?}");
    let (status, refused) =
        json_request(&app, "POST", &refunds_path, &billing, Some(refund("0.01"))).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{refused:?}");
    assert_eq!(money(&refused["available_balance"]), Decimal::ZERO);
}

/// An advance whose line snapshot carries no amounts (old format: only
/// `total_gross` per line, like the seeded `INV-…` of the QA stack).
async fn seed_legacy_advance(
    pool: &PgPool,
    order_id: Uuid,
    patient_id: Uuid,
    created_by: Uuid,
    tag: &str,
) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO invoices (
                order_id, patient_id, invoice_number, invoice_type, status, issued_at,
                due_date, total_net, total_vat, total_gross, paid_amount, line_items,
                notes, created_by
           ) VALUES (
                $1, $2, $3, 'advance', 'sent', now() - interval '1 day', CURRENT_DATE + 14,
                1000, 0, 1000, 0, $4, 'Legacy advance', $5
           ) RETURNING id"#,
    )
    .bind(order_id)
    .bind(patient_id)
    .bind(format!("INV-{tag}"))
    .bind(json!([{
        "description": "Treatment package",
        "quantity": 1,
        "unit_price": "1000.00",
        "total_gross": "1000.00"
    }]))
    .bind(created_by)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn invoice_detail(app: &axum::Router, bearer: &str, invoice_id: Uuid) -> Value {
    let (status, detail) = json_request(
        app,
        "GET",
        &format!("/api/v1/invoices/{invoice_id}"),
        bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{detail:?}");
    detail
}

/// QA D-55/D-56 (round 2): the rest of an advance whose lines are an old
/// snapshot is closed from the invoice balance, by amount, both when the
/// final invoice is released and with the manual button; the patient is
/// asked for 400, not 800. The credit-note form offers what the server
/// accepts (D2-01).
#[tokio::test]
async fn the_rest_of_an_advance_with_an_old_line_snapshot_is_closed_by_amount() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };
    let tag = unique_tag("legacy-advance-rest");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let billing = auth_header_for(seed_user(&pool, &tag, "billing").await, "billing");

    // At the release of the final invoice.
    let order_id = seed_order(&pool, patient_id, admin_id, &tag).await;
    let advance = seed_legacy_advance(&pool, order_id, patient_id, admin_id, &tag).await;
    record_payment(&app, &billing, advance, Uuid::new_v4(), 600, "LEGACY-ADV").await;
    let detail = invoice_detail(&app, &billing, advance).await;
    assert_eq!(detail["creditable_lines"], json!([]), "{detail}");
    assert_eq!(detail["credit_note_limit_gross"], "1000");
    let final_invoice = seed_invoice_in_status(
        &pool,
        order_id,
        patient_id,
        admin_id,
        &format!("{tag}-final"),
        "final",
        1000,
        false,
        "draft",
    )
    .await;
    let (status, released) = json_request(
        &app,
        "POST",
        &format!("/api/v1/invoices/{final_invoice}/status"),
        &billing,
        Some(json!({ "status": "sent" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{released:?}");
    assert_eq!(released["prepayment_applied_amount"], "600");
    assert_eq!(released["balance_due"], "400");
    let detail = invoice_detail(&app, &billing, advance).await;
    assert_eq!(detail["credited_amount"], "400", "{detail}");
    assert_eq!(detail["balance_due"], "0", "{detail}");
    assert_eq!(detail["advance_settlement"]["open_rest"], "0", "{detail}");
    assert_eq!(detail["credit_note_limit_gross"], "0", "QA D2-01: {detail}");
    let (mode, vat, line_items): (String, Decimal, Option<Value>) = sqlx::query_as(
        r#"SELECT credit_mode, amount_vat, line_items
           FROM invoice_credit_note_transactions WHERE invoice_id = $1"#,
    )
    .bind(advance)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(mode, "legacy_pro_rata");
    assert_eq!(vat, Decimal::ZERO, "the advance's own VAT split (0 %)");
    assert!(line_items.is_none());

    // With the manual button, for an advance whose final invoice was
    // released before the rule existed.
    let second_order = seed_order(&pool, patient_id, admin_id, &format!("{tag}-2")).await;
    let second_advance = seed_legacy_advance(
        &pool,
        second_order,
        patient_id,
        admin_id,
        &format!("{tag}-2"),
    )
    .await;
    record_payment(
        &app,
        &billing,
        second_advance,
        Uuid::new_v4(),
        600,
        "LEGACY-2",
    )
    .await;
    let second_final = seed_invoice(
        &pool,
        second_order,
        patient_id,
        admin_id,
        &format!("{tag}-2-final"),
        "final",
        1000,
        false,
    )
    .await;
    let (status, applied) = json_request(
        &app,
        "POST",
        &format!("/api/v1/invoices/{second_final}/prepayment-allocations"),
        &billing,
        Some(json!({
            "request_id": Uuid::new_v4(),
            "advance_invoice_id": second_advance,
            "amount_gross": "600",
        })),
    )
    .await;
    assert!(status.is_success(), "{applied:?}");
    let detail = invoice_detail(&app, &billing, second_advance).await;
    assert_eq!(detail["advance_settlement"]["open_rest"], "400", "{detail}");
    let (status, closed) = json_request(
        &app,
        "POST",
        &format!("/api/v1/invoices/{second_advance}/advance-rest"),
        &billing,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{closed:?}");
    assert_eq!(closed["amount_gross"], "400");
    assert_eq!(closed["invoice"]["balance_due"], "0", "{closed}");
    assert_eq!(closed["invoice"]["credited_amount"], "400");
}

/// QA D2-11: an order without a required prepayment gets no "prepayment
/// status" notice for its payments.
#[tokio::test]
async fn payments_of_an_order_without_required_prepayment_send_no_prepayment_notice() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };
    let tag = unique_tag("no-prepayment-notice");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let billing_id = seed_user(&pool, &tag, "billing").await;
    let billing = auth_header_for(billing_id, "billing");
    let order_id = seed_order(&pool, patient_id, admin_id, &tag).await;
    let invoice = seed_invoice(
        &pool, order_id, patient_id, admin_id, &tag, "final", 1000, false,
    )
    .await;
    record_payment(
        &app,
        &billing,
        invoice,
        Uuid::new_v4(),
        600,
        "NO-PREPAYMENT",
    )
    .await;
    let notices: i64 = sqlx::query_scalar(
        r#"SELECT count(*) FROM user_notifications
           WHERE entity_id = $1 AND kind = 'order_payment_status'"#,
    )
    .bind(order_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(notices, 0);
    let tracked: String = sqlx::query_scalar(
        "SELECT payment_status FROM order_payment_notification_state WHERE order_id = $1",
    )
    .bind(order_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(tracked, "not_required", "the state is still tracked");
}

#[tokio::test]
async fn historical_statement_after_storno() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };
    let tag = unique_tag("historical-storno");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let billing_id = seed_user(&pool, &tag, "billing").await;
    seed_assignment(&pool, patient_id, billing_id, admin_id).await;
    let order_id = seed_order(&pool, patient_id, admin_id, &tag).await;
    let invoice:Uuid=sqlx::query_scalar(r#"INSERT INTO invoices
        (order_id,patient_id,invoice_number,invoice_type,status,due_date,total_net,total_vat,total_gross,
         paid_amount,line_items,portal_visible,hide_amounts_from_patient,created_by,issued_at)
        VALUES ($1,$2,$3,'interim','sent',CURRENT_DATE+14,100,19,119,0,
          '[{"description":"Review care","quantity":"1","unit_price":"100","vat_rate":"19","line_net":"100","line_vat":"19","line_gross":"119"}]',
          true,false,$4,now()-interval '2 days') RETURNING id"#)
      .bind(order_id).bind(patient_id).bind(format!("INV-{tag}")).bind(admin_id).fetch_one(&pool).await.unwrap();
    let billing = auth_header_for(billing_id, "billing");
    let yesterday = (gmed_server::app_time::today() - chrono::Duration::days(1)).to_string();
    let path = format!("/api/v1/patients/{patient_id}/account-statement?to={yesterday}");
    let (status, before) = json_request(&app, "GET", &path, &billing, None).await;
    assert_eq!(status, StatusCode::OK, "{before:?}");
    let (status, cancelled) = json_request(
        &app,
        "POST",
        &format!("/api/v1/invoices/{invoice}/status"),
        &billing,
        Some(json!({"status":"cancelled","reason":"Review cancellation today"})),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{cancelled:?}");
    let (status, after) = json_request(&app, "GET", &path, &billing, None).await;
    assert_eq!(status, StatusCode::OK, "{after:?}");
    assert_eq!(before["summary"]["invoiced_gross"], "119");
    assert_eq!(after["summary"], before["summary"]);
    assert_eq!(after["items"], before["items"]);
    assert_eq!(after["movements"], before["movements"]);
    let (status, current) = json_request(
        &app,
        "GET",
        &format!("/api/v1/patients/{patient_id}/account-statement"),
        &billing,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{current}");
    assert_eq!(current["summary"]["closing_balance"], "0");
    assert!(current["items"].as_array().unwrap().is_empty());
    let today = gmed_server::app_time::today();
    let (status, period) = json_request(
        &app,
        "GET",
        &format!("/api/v1/patients/{patient_id}/account-statement?from={today}&to={today}"),
        &billing,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{period}");
    assert_eq!(period["summary"]["opening_balance"], "119");
    assert_eq!(period["summary"]["credit_total"], "119");
    assert_eq!(period["summary"]["closing_balance"], "0");
    let (status, historical_summary) = json_request(
        &app,
        "GET",
        &format!("/api/v1/patients/{patient_id}/financial-summary?to={yesterday}"),
        &billing,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{historical_summary}");
    assert_eq!(
        historical_summary["revenue_gross"], "119",
        "{historical_summary}"
    );
}

#[tokio::test]
async fn historical_waiver_reversal_preserves_prior_balance() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };
    let tag = unique_tag("historical-waiver");
    let patient = seed_patient(&pool, admin_id, &tag).await;
    let billing_id = seed_user(&pool, &tag, "billing").await;
    seed_assignment(&pool, patient, billing_id, admin_id).await;
    let order = seed_order(&pool, patient, admin_id, &tag).await;
    let external:Uuid=sqlx::query_scalar(r#"INSERT INTO external_invoices
       (order_id,patient_id,external_invoice_number,amount_net,amount_vat,amount_gross,currency,status,paid_by,service_delivered,created_by,invoice_date,created_at)
       VALUES($1,$2,$3,100,0,100,'EUR','paid','agency',true,$4,CURRENT_DATE-3,now()-interval '3 days') RETURNING id"#)
       .bind(order).bind(patient).bind(format!("EXT-{tag}")).bind(admin_id).fetch_one(&pool).await.unwrap();
    let waiver: Uuid = sqlx::query_scalar(
        r#"INSERT INTO external_invoice_rebilling_waivers
       (external_invoice_id,request_id,amount_gross,reason,created_by,created_at)
       VALUES($1,$2,100,'Synthetic historic goodwill',$3,now()-interval '2 days') RETURNING id"#,
    )
    .bind(external)
    .bind(Uuid::new_v4())
    .bind(admin_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    let billing = auth_header_for(billing_id, "billing");
    let yesterday = (gmed_server::app_time::today() - chrono::Duration::days(1)).to_string();
    let path = format!("/api/v1/patients/{patient}/account-statement?to={yesterday}");
    let (status, before) = json_request(&app, "GET", &path, &billing, None).await;
    assert_eq!(status, StatusCode::OK, "{before}");
    let (status, reversed) = json_request(
        &app,
        "POST",
        &format!("/api/v1/external-invoices/{external}/rebilling-waivers/{waiver}/reversal"),
        &billing,
        Some(json!({"reason":"Synthetic reversal today"})),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{reversed}");
    let (status, after) = json_request(&app, "GET", &path, &billing, None).await;
    assert_eq!(status, StatusCode::OK, "{after}");
    assert_eq!(before["summary"]["closing_balance"], "0");
    assert_eq!(after["summary"], before["summary"]);
    assert_eq!(after["items"], before["items"]);
    assert_eq!(after["movements"], before["movements"]);
    let (status, current) = json_request(
        &app,
        "GET",
        &format!("/api/v1/patients/{patient}/account-statement"),
        &billing,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{current}");
    assert_eq!(current["summary"]["closing_balance"], "100");
    assert_eq!(current["summary"]["external_receivable"], "100");
    assert!(
        current["movements"]
            .as_array()
            .unwrap()
            .iter()
            .any(|m| m["kind"] == "external_rebilling_waived")
    );
    assert!(
        current["movements"]
            .as_array()
            .unwrap()
            .iter()
            .any(|m| m["kind"] == "external_rebilling_waiver_reversal")
    );
    let today = gmed_server::app_time::today();
    let (status, period) = json_request(
        &app,
        "GET",
        &format!("/api/v1/patients/{patient}/account-statement?from={today}&to={today}"),
        &billing,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{period}");
    assert_eq!(period["summary"]["opening_balance"], "0");
    assert_eq!(period["summary"]["debit_total"], "100");
    assert_eq!(period["summary"]["credit_total"], "0");
    assert_eq!(period["summary"]["closing_balance"], "100");
    let (status, historical_summary) = json_request(
        &app,
        "GET",
        &format!("/api/v1/patients/{patient}/financial-summary?to={yesterday}"),
        &billing,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{historical_summary}");
    assert_eq!(
        historical_summary["external_receivable_gross"], "0",
        "{historical_summary}"
    );
}

/// Money QA 2026-11-15 (money-C S2-2): recording the advance payment and
/// releasing the final invoice at the same time never miss the set-off and
/// never deadlock: both take the order's advance lock first.
#[tokio::test]
async fn advance_payment_and_final_release_at_once_always_set_off_the_advance() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };
    for round in 0..3 {
        let tag = unique_tag(&format!("advance-race-{round}"));
        let patient_id = seed_patient(&pool, admin_id, &tag).await;
        let billing_id = seed_user(&pool, &tag, "billing").await;
        seed_assignment(&pool, patient_id, billing_id, admin_id).await;
        let order_id = seed_order(&pool, patient_id, admin_id, &tag).await;
        let advance = seed_invoice(
            &pool,
            order_id,
            patient_id,
            admin_id,
            &format!("{tag}-adv"),
            "advance",
            500,
            false,
        )
        .await;
        sqlx::query("UPDATE invoices SET issued_at = now() - interval '1 day' WHERE id = $1")
            .bind(advance)
            .execute(&pool)
            .await
            .unwrap();
        let final_invoice = seed_invoice_in_status(
            &pool,
            order_id,
            patient_id,
            admin_id,
            &format!("{tag}-final"),
            "final",
            1000,
            false,
            "draft",
        )
        .await;
        let billing = auth_header_for(billing_id, "billing");
        let payment_path = format!("/api/v1/invoices/{advance}/payments");
        let release_path = format!("/api/v1/invoices/{final_invoice}/status");
        let payment = json_request(
            &app,
            "POST",
            &payment_path,
            &billing,
            Some(json!({
                "request_id": Uuid::new_v4(),
                "amount_gross": 500,
                "payment_method": "bank_transfer",
                "received_on": gmed_server::app_time::today().to_string(),
            })),
        );
        let release = json_request(
            &app,
            "POST",
            &release_path,
            &billing,
            Some(json!({ "status": "sent" })),
        );
        let ((payment_status, payment_body), (release_status, release_body)) =
            tokio::join!(payment, release);
        assert_eq!(release_status, StatusCode::OK, "{release_body:?}");
        let detail = invoice_detail(&app, &billing, final_invoice).await;
        if payment_status == StatusCode::CREATED {
            // Paid first or after the release: the money is set off either way.
            assert_eq!(detail["prepayment_applied_amount"], "500", "round {round}");
            assert_eq!(detail["balance_due"], "500", "round {round}");
        } else {
            // Released first: the unpaid advance was closed by a credit note
            // (QA D-56), so the payment reads as an overpayment; nothing lost.
            assert_eq!(payment_status, StatusCode::CONFLICT, "{payment_body:?}");
            assert_eq!(payment_body["error"], "payment_exceeds_balance");
            assert_eq!(detail["balance_due"], "1000", "round {round}");
            let advance_detail = invoice_detail(&app, &billing, advance).await;
            assert_eq!(advance_detail["credited_amount"], "500", "round {round}");
        }
    }
}

/// Owner 2026-11-15: a part payment on an advance may be split over its VAT
/// categories by hand; the booking follows the split, the server refuses a
/// split that does not add up or exceeds a category.
#[tokio::test]
async fn a_part_payment_on_an_advance_can_be_split_by_hand() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };
    let tag = unique_tag("advance-split");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let billing_id = seed_user(&pool, &tag, "billing").await;
    seed_assignment(&pool, patient_id, billing_id, admin_id).await;
    let order_id = seed_order(&pool, patient_id, admin_id, &tag).await;
    let advance: Uuid = sqlx::query_scalar(
        r#"INSERT INTO invoices (
                order_id, patient_id, invoice_number, invoice_type, status, due_date,
                total_net, total_vat, total_gross, paid_amount, line_items, created_by
           ) VALUES ($1, $2, $3, 'advance', 'sent', CURRENT_DATE + 14, 400, 19, 419, 0, $4, $5)
           RETURNING id"#,
    )
    .bind(order_id)
    .bind(patient_id)
    .bind(format!("INV-{tag}-adv"))
    .bind(json!([
        {"description": "Anzahlung – Anteil 19 % USt.", "quantity": "1", "unit_price": "100",
         "vat_rate": "19", "is_cost_passthrough": false, "line_net": "100", "line_vat": "19",
         "line_gross": "119", "source": "advance_prepayment"},
        {"description": "Anzahlung – Anteil Auslagen", "quantity": "1", "unit_price": "300",
         "vat_rate": "0", "is_cost_passthrough": true, "line_net": "300", "line_vat": "0",
         "line_gross": "300", "source": "advance_prepayment"}
    ]))
    .bind(admin_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    let billing = auth_header_for(billing_id, "billing");
    let pay = |amount: &str, split: Value| {
        let app = app.clone();
        let billing = billing.clone();
        let body = json!({
            "request_id": Uuid::new_v4(),
            "amount_gross": amount,
            "payment_method": "bank_transfer",
            "received_on": gmed_server::app_time::today().to_string(),
            "category_split": split,
        });
        async move {
            json_request(
                &app,
                "POST",
                &format!("/api/v1/invoices/{advance}/payments"),
                &billing,
                Some(body),
            )
            .await
        }
    };
    let (status, body) = pay(
        "200",
        json!([
            {"kind": "taxed", "vat_rate": "19", "amount_gross": "119"},
            {"kind": "passthrough", "amount_gross": "50"}
        ]),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body:?}");
    let (status, body) = pay(
        "200",
        json!([
            {"kind": "taxed", "vat_rate": "19", "amount_gross": "119"},
            {"kind": "passthrough", "amount_gross": "81"}
        ]),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{body:?}");
    let totals = category_totals(&pool, advance).await;
    assert!(
        totals.contains(&("service_revenue".to_string(), Decimal::new(119, 0))),
        "{totals:?}"
    );
    assert!(
        totals.contains(&("cost_passthrough_revenue".to_string(), Decimal::new(81, 0))),
        "{totals:?}"
    );
    let service_vat: Decimal = sqlx::query_scalar(
        "SELECT COALESCE(SUM(amount_vat), 0) FROM accounting_entries WHERE source_invoice_id = $1",
    )
    .bind(advance)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(service_vat, Decimal::new(19, 0));
    // The 19 % category is paid in full: nothing more fits there.
    let (status, body) = pay(
        "100",
        json!([
            {"kind": "taxed", "vat_rate": "19", "amount_gross": "50"},
            {"kind": "passthrough", "amount_gross": "50"}
        ]),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body:?}");
    let detail = invoice_detail(&app, &billing, advance).await;
    let categories = detail["advance_categories"]["categories"]
        .as_array()
        .unwrap();
    let taxed = categories
        .iter()
        .find(|category| category["kind"] == "taxed")
        .unwrap();
    assert_eq!(taxed["open_gross"], "0");
}

/// QA 2026-11-16 (verify-A A1): an advance of 800 (19 % 473,42 incl. 75,59
/// VAT, 0 % 326,58) paid 300 without a split, then 200 split by hand 50 @19 %
/// / 150 @0 %. Each payment keeps its split (S1-1): the manual payment books
/// 7,98 VAT, the final deducts 227,53 / 36,33 VAT + 272,47. The order panel
/// asks the advance's own open rest (S2-1). The Storno of the final states
/// the released advances and the negative of what the final asked (S2-3).
#[tokio::test]
async fn a_manual_split_after_a_pro_rata_payment_is_booked_and_deducted_as_entered() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };
    let tag = unique_tag("frozen-split");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let billing_id = seed_user(&pool, &tag, "billing").await;
    let manager_id = seed_user(&pool, &tag, "patient_manager").await;
    for user_id in [billing_id, manager_id] {
        seed_assignment(&pool, patient_id, user_id, admin_id).await;
    }
    let order_id = seed_order(&pool, patient_id, admin_id, &tag).await;
    let advance: Uuid = sqlx::query_scalar(
        r#"INSERT INTO invoices (
                order_id, patient_id, invoice_number, invoice_type, status, due_date,
                total_net, total_vat, total_gross, paid_amount, line_items, created_by,
                issued_at
           ) VALUES ($1, $2, $3, 'advance', 'sent', CURRENT_DATE + 14, 724.41, 75.59, 800, 0,
                     $4, $5, now() - interval '1 day')
           RETURNING id"#,
    )
    .bind(order_id)
    .bind(patient_id)
    .bind(format!("INV-{tag}-adv"))
    .bind(json!([
        {"description": "Anzahlung – Anteil 19 % USt.", "quantity": "1", "unit_price": "397.83",
         "vat_rate": "19", "is_cost_passthrough": false, "line_net": "397.83", "line_vat": "75.59",
         "line_gross": "473.42", "source": "advance_prepayment"},
        {"description": "Anzahlung – Anteil 0 % USt.", "quantity": "1", "unit_price": "326.58",
         "vat_rate": "0", "is_cost_passthrough": false, "line_net": "326.58", "line_vat": "0",
         "line_gross": "326.58", "source": "advance_prepayment"}
    ]))
    .bind(admin_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    let billing = auth_header_for(billing_id, "billing");
    let manager = auth_header_for(manager_id, "patient_manager");
    let open_on_order = || {
        let app = app.clone();
        let manager = manager.clone();
        async move {
            let (status, economics) = json_request(
                &app,
                "GET",
                &format!("/api/v1/orders/{order_id}/economics"),
                &manager,
                None,
            )
            .await;
            assert_eq!(status, StatusCode::OK, "{economics:?}");
            money(&economics["actual"]["patient_open_gross"])
        }
    };
    let pay = |amount: &str, split: Option<Value>| {
        let app = app.clone();
        let billing = billing.clone();
        let mut body = json!({
            "request_id": Uuid::new_v4(),
            "amount_gross": amount,
            "payment_method": "bank_transfer",
            "received_on": gmed_server::app_time::today().to_string(),
        });
        if let Some(split) = split {
            body["category_split"] = split;
        }
        async move {
            let (status, body) = json_request(
                &app,
                "POST",
                &format!("/api/v1/invoices/{advance}/payments"),
                &billing,
                Some(body),
            )
            .await;
            assert_eq!(status, StatusCode::CREATED, "{body:?}");
            Uuid::parse_str(body["payment_transaction_id"].as_str().unwrap()).unwrap()
        }
    };
    let payment_vat = |payment: Uuid| {
        let pool = pool.clone();
        async move {
            sqlx::query_scalar::<_, Decimal>(
                "SELECT COALESCE(SUM(amount_vat), 0) FROM accounting_entries
                 WHERE source_invoice_payment_transaction_id = $1",
            )
            .bind(payment)
            .fetch_one(&pool)
            .await
            .unwrap()
        }
    };
    let dec = |value: &str| value.parse::<Decimal>().unwrap();

    assert_eq!(open_on_order().await, dec("800"));
    let first = pay("300", None).await;
    // S2-1: 800 billed, 300 received: 500 still to receive (not 200).
    assert_eq!(open_on_order().await, dec("500"));
    let frozen = sqlx::query(
        "SELECT manual, rows FROM invoice_payment_category_splits WHERE payment_transaction_id = $1",
    )
    .bind(first)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(!frozen.get::<bool, _>("manual"));
    let rows = frozen.get::<Value, _>("rows");
    let taxed = rows
        .as_array()
        .unwrap()
        .iter()
        .find(|row| row["kind"] == "taxed")
        .unwrap()
        .clone();
    assert_eq!(money(&taxed["gross"]), dec("177.53"));
    assert_eq!(money(&taxed["vat"]), dec("28.35"));
    assert_eq!(payment_vat(first).await, dec("28.35"));

    let second = pay(
        "200",
        Some(json!([
            {"kind": "taxed", "vat_rate": "19", "amount_gross": "50"},
            {"kind": "zero_rated", "amount_gross": "150"}
        ])),
    )
    .await;
    assert_eq!(payment_vat(second).await, dec("7.98"));
    assert_eq!(open_on_order().await, dec("300"));
    let detail = invoice_detail(&app, &billing, advance).await;
    let categories = detail["advance_categories"]["categories"]
        .as_array()
        .unwrap()
        .clone();
    let paid = |kind: &str| {
        money(
            &categories
                .iter()
                .find(|category| category["kind"] == kind)
                .unwrap()["paid_gross"],
        )
    };
    assert_eq!(paid("taxed"), dec("227.53"));
    assert_eq!(paid("zero_rated"), dec("272.47"));
    let (status, payments) = json_request(
        &app,
        "GET",
        &format!("/api/v1/invoices/{advance}/payments"),
        &billing,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{payments:?}");
    let listed = payments["items"].as_array().unwrap().clone();
    let split_of = |id: Uuid| {
        listed
            .iter()
            .find(|item| item["id"] == id.to_string())
            .unwrap()["category_split"]
            .clone()
    };
    assert!(split_of(first).is_null(), "a pro rata split is not shown");
    assert_eq!(split_of(second).as_array().unwrap().len(), 2);

    // The final bills 19 % 1.000 (VAT 159,66) and 0 % 1.000.
    let final_invoice: Uuid = sqlx::query_scalar(
        r#"INSERT INTO invoices (
                order_id, patient_id, invoice_type, status, due_date,
                total_net, total_vat, total_gross, paid_amount, line_items, created_by
           ) VALUES ($1, $2, 'final', 'draft', CURRENT_DATE + 14, 1840.34, 159.66, 2000, 0, $3, $4)
           RETURNING id"#,
    )
    .bind(order_id)
    .bind(patient_id)
    .bind(json!([
        {"description": "Dolmetscher", "quantity": "1", "unit_price": "840.34",
         "vat_rate": "19", "is_cost_passthrough": false, "line_net": "840.34",
         "line_vat": "159.66", "line_gross": "1000"},
        {"description": "Organisation", "quantity": "1", "unit_price": "1000",
         "vat_rate": "0", "is_cost_passthrough": false, "line_net": "1000",
         "line_vat": "0", "line_gross": "1000"}
    ]))
    .bind(admin_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    let (status, released) = json_request(
        &app,
        "POST",
        &format!("/api/v1/invoices/{final_invoice}/status"),
        &billing,
        Some(json!({ "status": "sent" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{released:?}");
    assert_eq!(money(&released["prepayment_applied_amount"]), dec("500"));
    let vat_rows: Value = sqlx::query_scalar(
        "SELECT vat_rows FROM invoice_prepayment_allocations WHERE target_invoice_id = $1",
    )
    .bind(final_invoice)
    .fetch_one(&pool)
    .await
    .unwrap();
    let deducted = |kind: &str, field: &str| {
        money(
            &vat_rows
                .as_array()
                .unwrap()
                .iter()
                .find(|row| row["kind"] == kind)
                .unwrap()[field],
        )
    };
    assert_eq!(deducted("taxed", "gross"), dec("227.53"));
    assert_eq!(deducted("taxed", "vat"), dec("36.33"));
    assert_eq!(deducted("zero_rated", "gross"), dec("272.47"));

    // S2-3: the Storno of the final releases the deductions and states them.
    let (status, cancelled) = json_request(
        &app,
        "POST",
        &format!("/api/v1/invoices/{final_invoice}/status"),
        &billing,
        Some(json!({ "status": "cancelled", "reason": "Falsche Positionen" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{cancelled:?}");
    let released_allocations: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM invoice_prepayment_allocations WHERE advance_invoice_id = $1",
    )
    .bind(advance)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(released_allocations, 0);
    let storno = sqlx::query(
        "SELECT amount_gross, deducted_advances FROM invoice_storno_documents
         WHERE invoice_id = $1",
    )
    .bind(final_invoice)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(storno.get::<Decimal, _>("amount_gross"), dec("-2000"));
    let advances = storno.get::<Value, _>("deducted_advances");
    assert_eq!(advances[0]["invoice_number"], format!("INV-{tag}-adv"));
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!("/api/v1/invoices/{final_invoice}/storno/pdf"))
                .header("Authorization", &billing)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = axum::body::to_bytes(response.into_body(), 16 * 1024 * 1024)
        .await
        .unwrap();
    let text = pdf_extract::extract_text_from_mem(&bytes).unwrap();
    assert!(text.contains(&format!("INV-{tag}-adv")), "{text}");
    assert!(text.contains("227,53"), "{text}");
    // What the final asked: 2.000,00 − 500,00 = 1.500,00, VAT 159,66 − 36,33.
    assert!(text.contains("-1.500,00"), "{text}");
    assert!(text.contains("-123,33"), "{text}");

    // The unpaid 300 was closed per category at the release (19 % 245,89,
    // 0 % 54,11); the Storno of the final reverses that credit note
    // (verify2-A S2-3): the advance asks its full amount again, each
    // category keeps what it was paid, and a new final deducts the same rows.
    let detail = invoice_detail(&app, &billing, advance).await;
    let categories = detail["advance_categories"]["categories"]
        .as_array()
        .unwrap()
        .clone();
    let category = |kind: &str, field: &str| {
        money(
            &categories
                .iter()
                .find(|category| category["kind"] == kind)
                .unwrap()[field],
        )
    };
    assert_eq!(category("taxed", "gross"), dec("473.42"));
    assert_eq!(category("taxed", "paid_gross"), dec("227.53"));
    assert_eq!(category("zero_rated", "gross"), dec("326.58"));
    assert_eq!(category("zero_rated", "paid_gross"), dec("272.47"));
    assert_eq!(money(&detail["credited_amount"]), dec("0"));
    let second_final: Uuid = sqlx::query_scalar(
        r#"INSERT INTO invoices (
                order_id, patient_id, invoice_type, status, due_date,
                total_net, total_vat, total_gross, paid_amount, line_items, created_by
           ) SELECT order_id, patient_id, 'final', 'draft', CURRENT_DATE + 14,
                    total_net, total_vat, total_gross, 0, line_items, created_by
             FROM invoices WHERE id = $1
           RETURNING id"#,
    )
    .bind(final_invoice)
    .fetch_one(&pool)
    .await
    .unwrap();
    let (status, released) = json_request(
        &app,
        "POST",
        &format!("/api/v1/invoices/{second_final}/status"),
        &billing,
        Some(json!({ "status": "sent" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{released:?}");
    assert_eq!(money(&released["prepayment_applied_amount"]), dec("500"));
    let vat_rows: Value = sqlx::query_scalar(
        "SELECT vat_rows FROM invoice_prepayment_allocations WHERE target_invoice_id = $1",
    )
    .bind(second_final)
    .fetch_one(&pool)
    .await
    .unwrap();
    let taxed = vat_rows
        .as_array()
        .unwrap()
        .iter()
        .find(|row| row["kind"] == "taxed")
        .unwrap()
        .clone();
    assert_eq!(money(&taxed["gross"]), dec("227.53"));
    assert_eq!(money(&taxed["vat"]), dec("36.33"));

    // Credit-note path: a full credit note on the final releases all of its
    // deductions; the advance money is available again.
    let (status, credited) = json_request(
        &app,
        "POST",
        &format!("/api/v1/invoices/{second_final}/credit-notes"),
        &billing,
        Some(json!({
            "request_id": Uuid::new_v4(),
            "lines": [{"line_index": 0}, {"line_index": 1}],
            "reason": "Leistungen entfallen",
            "issued_on": gmed_server::app_time::today().to_string(),
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{credited:?}");
    let left: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM invoice_prepayment_allocations WHERE target_invoice_id = $1",
    )
    .bind(second_final)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(left, 0);
    assert_eq!(
        money(&credited["invoice"]["prepayment_applied_amount"]),
        dec("0")
    );
}

/// A payment recorded before splits were frozen keeps the former pro rata
/// reading: the next payment freezes it with exactly that split (QA
/// 2026-11-16 S1-1, historic results stay stable).
#[tokio::test]
async fn an_earlier_unsplit_payment_is_frozen_with_its_former_reading() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };
    let tag = unique_tag("legacy-split");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let billing_id = seed_user(&pool, &tag, "billing").await;
    seed_assignment(&pool, patient_id, billing_id, admin_id).await;
    let order_id = seed_order(&pool, patient_id, admin_id, &tag).await;
    let advance: Uuid = sqlx::query_scalar(
        r#"INSERT INTO invoices (
                order_id, patient_id, invoice_number, invoice_type, status, due_date,
                total_net, total_vat, total_gross, paid_amount, line_items, created_by
           ) VALUES ($1, $2, $3, 'advance', 'sent', CURRENT_DATE + 14, 724.41, 75.59, 800, 0,
                     $4, $5)
           RETURNING id"#,
    )
    .bind(order_id)
    .bind(patient_id)
    .bind(format!("INV-{tag}-adv"))
    .bind(json!([
        {"description": "Anzahlung – Anteil 19 % USt.", "quantity": "1", "unit_price": "397.83",
         "vat_rate": "19", "is_cost_passthrough": false, "line_net": "397.83", "line_vat": "75.59",
         "line_gross": "473.42", "source": "advance_prepayment"},
        {"description": "Anzahlung – Anteil 0 % USt.", "quantity": "1", "unit_price": "326.58",
         "vat_rate": "0", "is_cost_passthrough": false, "line_net": "326.58", "line_vat": "0",
         "line_gross": "326.58", "source": "advance_prepayment"}
    ]))
    .bind(admin_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    // As recorded before this change: a journal row without a split.
    let earlier: Uuid = sqlx::query_scalar(
        r#"INSERT INTO invoice_payment_transactions (
                invoice_id, transaction_type, request_id, amount_gross, payment_method,
                received_on, created_by
           ) VALUES ($1, 'payment', $2, 300, 'bank_transfer', CURRENT_DATE, $3)
           RETURNING id"#,
    )
    .bind(advance)
    .bind(Uuid::new_v4())
    .bind(billing_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    let billing = auth_header_for(billing_id, "billing");
    record_payment(&app, &billing, advance, Uuid::new_v4(), 100, "NEXT").await;
    let rows: Value = sqlx::query_scalar(
        "SELECT rows FROM invoice_payment_category_splits
         WHERE payment_transaction_id = $1 AND NOT manual",
    )
    .bind(earlier)
    .fetch_one(&pool)
    .await
    .unwrap();
    let taxed = rows
        .as_array()
        .unwrap()
        .iter()
        .find(|row| row["kind"] == "taxed")
        .unwrap()
        .clone();
    // Pro rata of 300 over 800: 177,53 incl. 28,35 VAT.
    assert_eq!(money(&taxed["gross"]), "177.53".parse::<Decimal>().unwrap());
    assert_eq!(money(&taxed["vat"]), "28.35".parse::<Decimal>().unwrap());
    let detail = invoice_detail(&app, &billing, advance).await;
    let paid_taxed = detail["advance_categories"]["categories"]
        .as_array()
        .unwrap()
        .iter()
        .find(|category| category["kind"] == "taxed")
        .unwrap()["paid_gross"]
        .clone();
    // 400 of 800 paid pro rata: 236,71 of 473,42.
    assert_eq!(money(&paid_taxed), "236.71".parse::<Decimal>().unwrap());
}

/// A paid advance of 800 (19 % 473,42 / VAT 75,59, 0 % 326,58) deducted in
/// full on a released final that bills 19 % 1.000 (VAT 159,66) and 0 %
/// 1.000. Returns the billing bearer, the advance and the final.
async fn final_with_a_paid_mixed_advance(
    app: &axum::Router,
    pool: &PgPool,
    admin_id: Uuid,
    tag: &str,
) -> (String, Uuid, Uuid) {
    let patient_id = seed_patient(pool, admin_id, tag).await;
    let billing_id = seed_user(pool, tag, "billing").await;
    seed_assignment(pool, patient_id, billing_id, admin_id).await;
    let order_id = seed_order(pool, patient_id, admin_id, tag).await;
    let advance: Uuid = sqlx::query_scalar(
        r#"INSERT INTO invoices (
                order_id, patient_id, invoice_number, invoice_type, status, due_date,
                total_net, total_vat, total_gross, paid_amount, line_items, created_by,
                issued_at
           ) VALUES ($1, $2, $3, 'advance', 'sent', CURRENT_DATE + 14, 724.41, 75.59, 800, 0,
                     $4, $5, now() - interval '1 day')
           RETURNING id"#,
    )
    .bind(order_id)
    .bind(patient_id)
    .bind(format!("INV-{tag}-adv"))
    .bind(json!([
        {"description": "Anzahlung – Anteil 19 % USt.", "quantity": "1", "unit_price": "397.83",
         "vat_rate": "19", "is_cost_passthrough": false, "line_net": "397.83", "line_vat": "75.59",
         "line_gross": "473.42", "source": "advance_prepayment"},
        {"description": "Anzahlung – Anteil 0 % USt.", "quantity": "1", "unit_price": "326.58",
         "vat_rate": "0", "is_cost_passthrough": false, "line_net": "326.58", "line_vat": "0",
         "line_gross": "326.58", "source": "advance_prepayment"}
    ]))
    .bind(admin_id)
    .fetch_one(pool)
    .await
    .unwrap();
    let billing = auth_header_for(billing_id, "billing");
    let (status, body) = json_request(
        app,
        "POST",
        &format!("/api/v1/invoices/{advance}/payments"),
        &billing,
        Some(json!({
            "request_id": Uuid::new_v4(),
            "amount_gross": "800",
            "payment_method": "bank_transfer",
            "received_on": gmed_server::app_time::today().to_string(),
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{body:?}");
    let final_invoice: Uuid = sqlx::query_scalar(
        r#"INSERT INTO invoices (
                order_id, patient_id, invoice_type, status, due_date,
                total_net, total_vat, total_gross, paid_amount, line_items, created_by
           ) VALUES ($1, $2, 'final', 'draft', CURRENT_DATE + 14, 1840.34, 159.66, 2000, 0, $3, $4)
           RETURNING id"#,
    )
    .bind(order_id)
    .bind(patient_id)
    .bind(json!([
        {"description": "Dolmetscher", "quantity": "1", "unit_price": "840.34",
         "vat_rate": "19", "is_cost_passthrough": false, "line_net": "840.34",
         "line_vat": "159.66", "line_gross": "1000"},
        {"description": "Organisation", "quantity": "1", "unit_price": "1000",
         "vat_rate": "0", "is_cost_passthrough": false, "line_net": "1000",
         "line_vat": "0", "line_gross": "1000"}
    ]))
    .bind(admin_id)
    .fetch_one(pool)
    .await
    .unwrap();
    let (status, released) = json_request(
        app,
        "POST",
        &format!("/api/v1/invoices/{final_invoice}/status"),
        &billing,
        Some(json!({ "status": "sent" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{released:?}");
    assert_eq!(money(&released["prepayment_applied_amount"]), dec("800"));
    assert_eq!(money(&released["balance_due"]), dec("1200"));
    (billing, advance, final_invoice)
}

fn dec(value: &str) -> Decimal {
    value.parse::<Decimal>().unwrap()
}

/// Issues a credit note of `lines` on `invoice_id`; returns the response.
async fn credit_lines(app: &axum::Router, bearer: &str, invoice_id: Uuid, lines: Value) -> Value {
    let (status, credit) = json_request(
        app,
        "POST",
        &format!("/api/v1/invoices/{invoice_id}/credit-notes"),
        bearer,
        Some(json!({
            "request_id": Uuid::new_v4(),
            "lines": lines,
            "reason": "Leistung entfällt",
            "issued_on": gmed_server::app_time::today().to_string(),
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{credit:?}");
    credit
}

/// The invariant of the final release, kept after credit notes: per VAT
/// category the allocations into the final deduct no more gross or VAT than
/// the final, net of its credit notes, bills there. Returns what they deduct
/// per category.
async fn assert_deductions_fit(
    pool: &PgPool,
    final_invoice: Uuid,
) -> std::collections::BTreeMap<String, (Decimal, Decimal)> {
    let key = |item: &Value| {
        let rate = dec(item["vat_rate"].as_str().unwrap_or("0"));
        if rate > Decimal::ZERO {
            format!("taxed {}", rate.normalize())
        } else {
            "zero_rated".to_string()
        }
    };
    let mut billed = std::collections::BTreeMap::<String, (Decimal, Decimal)>::new();
    let line_items: Value = sqlx::query_scalar("SELECT line_items FROM invoices WHERE id = $1")
        .bind(final_invoice)
        .fetch_one(pool)
        .await
        .unwrap();
    for item in line_items.as_array().unwrap() {
        let entry = billed.entry(key(item)).or_default();
        entry.0 += dec(item["line_gross"].as_str().unwrap());
        entry.1 += dec(item["line_vat"].as_str().unwrap());
    }
    let credits: Vec<Value> = sqlx::query_scalar(
        r#"SELECT credit.line_items FROM invoice_credit_note_transactions credit
           WHERE credit.invoice_id = $1 AND credit.transaction_type = 'credit_note'
             AND NOT EXISTS (SELECT 1 FROM invoice_credit_note_transactions reversal
                             WHERE reversal.reverses_transaction_id = credit.id)"#,
    )
    .bind(final_invoice)
    .fetch_all(pool)
    .await
    .unwrap();
    for credit in &credits {
        for item in credit.as_array().unwrap() {
            let entry = billed.entry(key(item)).or_default();
            entry.0 -= dec(item["line_gross"].as_str().unwrap());
            entry.1 -= dec(item["line_vat"].as_str().unwrap());
        }
    }
    let allocations: Vec<Value> = sqlx::query_scalar(
        "SELECT vat_rows FROM invoice_prepayment_allocations WHERE target_invoice_id = $1",
    )
    .bind(final_invoice)
    .fetch_all(pool)
    .await
    .unwrap();
    let mut deducted = std::collections::BTreeMap::<String, (Decimal, Decimal)>::new();
    for allocation in &allocations {
        for row in allocation.as_array().unwrap() {
            let key = if row["kind"] == "taxed" {
                format!("taxed {}", dec(row["rate"].as_str().unwrap()).normalize())
            } else {
                row["kind"].as_str().unwrap().to_string()
            };
            let entry = deducted.entry(key).or_default();
            entry.0 += dec(row["gross"].as_str().unwrap());
            entry.1 += dec(row["vat"].as_str().unwrap());
        }
    }
    for (key, (gross, vat)) in &deducted {
        let (billed_gross, billed_vat) = billed.get(key).copied().unwrap_or_default();
        assert!(
            *gross <= billed_gross && *vat <= billed_vat,
            "{key}: deducted {gross} / {vat}, billed {billed_gross} / {billed_vat}"
        );
    }
    deducted
}

async fn credit_note_pdf_text(
    app: &axum::Router,
    bearer: &str,
    invoice_id: Uuid,
    credit_note_id: &str,
) -> (Vec<u8>, String) {
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!(
                    "/api/v1/invoices/{invoice_id}/credit-notes/{credit_note_id}/pdf"
                ))
                .header("Authorization", bearer)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = axum::body::to_bytes(response.into_body(), 16 * 1024 * 1024)
        .await
        .unwrap()
        .to_vec();
    let text = pdf_extract::extract_text_from_mem(&bytes).unwrap();
    (bytes, text)
}

async fn stored_release(pool: &PgPool, credit_note_id: &str) -> Option<Value> {
    sqlx::query_scalar(
        "SELECT released_advances FROM invoice_credit_note_transactions WHERE id = $1::uuid",
    )
    .bind(credit_note_id)
    .fetch_one(pool)
    .await
    .unwrap()
}

/// fix-81 open item: a partial credit note removes the whole 19 % category
/// of a final while its total (1.000) stays above the deductions (800).
/// Before, the 19 % deduction stayed against a final that no longer bills
/// 19 %. Now it is released, the money is refundable again, and the credit
/// note states the release; its remaining amount is what the final no
/// longer asks.
#[tokio::test]
async fn a_partial_credit_note_removing_a_vat_category_releases_its_advance_deduction() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };
    let tag = unique_tag("credit-category");
    let (billing, advance, final_invoice) =
        final_with_a_paid_mixed_advance(&app, &pool, admin_id, &tag).await;

    let credit = credit_lines(&app, &billing, final_invoice, json!([{"line_index": 0}])).await;
    assert_eq!(money(&credit["released_prepayment_gross"]), dec("473.42"));
    assert_eq!(
        money(&credit["invoice"]["prepayment_applied_amount"]),
        dec("326.58")
    );
    // 2.000 − 1.000 credited − 326,58 deducted: 673,42 (was 1.200).
    assert_eq!(money(&credit["invoice"]["balance_due"]), dec("673.42"));
    let deducted = assert_deductions_fit(&pool, final_invoice).await;
    assert!(!deducted.contains_key("taxed 19"), "{deducted:?}");
    assert_eq!(deducted["zero_rated"].0, dec("326.58"));

    // The released 19 % money is closed on the advance and refundable.
    let detail = invoice_detail(&app, &billing, advance).await;
    assert_eq!(money(&detail["credited_amount"]), dec("473.42"), "{detail}");
    assert_eq!(
        money(&detail["refundable_cash_amount"]),
        dec("473.42"),
        "{detail}"
    );

    // Stored with the credit note, as printed.
    let credit_id = credit["credit_note_transaction_id"].as_str().unwrap();
    let stored = stored_release(&pool, credit_id).await.expect("stored");
    assert_eq!(stored[0]["invoice_number"], format!("INV-{tag}-adv"));
    let rows = stored[0]["rows"].as_array().unwrap();
    assert_eq!(rows.len(), 1, "{stored}");
    assert_eq!(rows[0]["kind"], "taxed");
    assert_eq!(dec(rows[0]["gross"].as_str().unwrap()), dec("473.42"));
    assert_eq!(dec(rows[0]["vat"].as_str().unwrap()), dec("75.59"));
    let audited: i64 = sqlx::query_scalar(
        r#"SELECT COUNT(*) FROM audit_log
           WHERE action = 'release_invoice_prepayment' AND entity_id = $1
             AND (context ->> 'by_vat_category')::boolean"#,
    )
    .bind(final_invoice)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(audited, 1);

    let (bytes, text) = credit_note_pdf_text(&app, &billing, final_invoice, credit_id).await;
    assert!(
        text.to_lowercase()
            .contains("zuzüglich freigegebener anzahlungen"),
        "{text}"
    );
    assert!(text.contains(&format!("INV-{tag}-adv")), "{text}");
    assert!(text.contains("473,42"), "{text}");
    // −1.000,00 + 473,42: the final asks 526,58 less (1.200 → 673,42);
    // VAT −159,66 + 75,59.
    assert!(text.contains("-526,58"), "{text}");
    assert!(text.contains("-84,07"), "{text}");
    let (again, _) = credit_note_pdf_text(&app, &billing, final_invoice, credit_id).await;
    assert_eq!(bytes, again, "the issued document never changes");
}

/// Within a category: a credit note on the 0 % line that leaves room
/// releases nothing and prints no release; one on part of the 19 % line
/// releases only what that category no longer bills.
#[tokio::test]
async fn a_partial_credit_note_within_a_category_releases_only_the_excess() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };
    let tag = unique_tag("credit-within");
    let (billing, advance, final_invoice) =
        final_with_a_paid_mixed_advance(&app, &pool, admin_id, &tag).await;

    // 0 % 1.000 → 500: still above its 326,58 deduction.
    let credit = credit_lines(
        &app,
        &billing,
        final_invoice,
        json!([{"line_index": 1, "amount_gross": "500"}]),
    )
    .await;
    assert_eq!(money(&credit["released_prepayment_gross"]), dec("0"));
    assert_eq!(
        money(&credit["invoice"]["prepayment_applied_amount"]),
        dec("800")
    );
    assert_eq!(money(&credit["invoice"]["balance_due"]), dec("700"));
    let credit_id = credit["credit_note_transaction_id"].as_str().unwrap();
    assert!(stored_release(&pool, credit_id).await.is_none());
    let (_, text) = credit_note_pdf_text(&app, &billing, final_invoice, credit_id).await;
    assert!(!text.contains("Anzahlungen"), "{text}");
    assert_deductions_fit(&pool, final_invoice).await;

    // 19 % 1.000 → 300 (VAT 47,90): the 473,42 deduction keeps 300,00.
    let credit = credit_lines(
        &app,
        &billing,
        final_invoice,
        json!([{"line_index": 0, "amount_gross": "700"}]),
    )
    .await;
    assert_eq!(money(&credit["released_prepayment_gross"]), dec("173.42"));
    assert_eq!(
        money(&credit["invoice"]["prepayment_applied_amount"]),
        dec("626.58")
    );
    // 2.000 − 1.200 credited − 626,58: 173,42 (was 700).
    assert_eq!(money(&credit["invoice"]["balance_due"]), dec("173.42"));
    let deducted = assert_deductions_fit(&pool, final_invoice).await;
    assert_eq!(deducted["taxed 19"], (dec("300"), dec("47.90")));
    assert_eq!(deducted["zero_rated"].0, dec("326.58"));
    let detail = invoice_detail(&app, &billing, advance).await;
    assert_eq!(
        money(&detail["refundable_cash_amount"]),
        dec("173.42"),
        "{detail}"
    );

    let credit_id = credit["credit_note_transaction_id"].as_str().unwrap();
    let (_, text) = credit_note_pdf_text(&app, &billing, final_invoice, credit_id).await;
    assert!(text.contains("173,42"), "{text}");
    // −700,00 + 173,42: the final asks 526,58 less (700 → 173,42).
    assert!(text.contains("-526,58"), "{text}");
}

/// A full credit note still releases every deduction and states them all.
#[tokio::test]
async fn a_full_credit_note_on_a_final_releases_and_states_every_deduction() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };
    let tag = unique_tag("credit-full");
    let (billing, advance, final_invoice) =
        final_with_a_paid_mixed_advance(&app, &pool, admin_id, &tag).await;
    let credit = credit_lines(
        &app,
        &billing,
        final_invoice,
        json!([{"line_index": 0}, {"line_index": 1}]),
    )
    .await;
    assert_eq!(money(&credit["released_prepayment_gross"]), dec("800"));
    assert_eq!(
        money(&credit["invoice"]["prepayment_applied_amount"]),
        dec("0")
    );
    let left: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM invoice_prepayment_allocations WHERE target_invoice_id = $1",
    )
    .bind(final_invoice)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(left, 0);
    let detail = invoice_detail(&app, &billing, advance).await;
    assert_eq!(
        money(&detail["refundable_cash_amount"]),
        dec("800"),
        "{detail}"
    );
    let credit_id = credit["credit_note_transaction_id"].as_str().unwrap();
    let stored = stored_release(&pool, credit_id).await.expect("stored");
    assert_eq!(stored[0]["rows"].as_array().unwrap().len(), 2, "{stored}");
    let (_, text) = credit_note_pdf_text(&app, &billing, final_invoice, credit_id).await;
    // −2.000,00 + 800,00: the 1.200,00 the final asked.
    assert!(text.contains("-1.200,00"), "{text}");
    assert!(text.contains("-84,07"), "{text}");
}
