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
    // invoice, not "Payment received": no money came in.
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
            movement["kind"] == "payment"
                && movement["description"]
                    .as_str()
                    .is_some_and(|text| text.starts_with("Credit from invoice "))
        })
        .count();
    assert_eq!(credit_legs, 1, "{movements:?}");

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

    // Paid after the release: credited against the open final invoice.
    let late = record_payment(&app, &billing, late_advance, Uuid::new_v4(), 100, "ADV-3").await;
    assert_eq!(late["invoice"]["status"], "paid");
    let (_, final_detail) = json_request(
        &app,
        "GET",
        &format!("/api/v1/invoices/{final_invoice}"),
        &billing,
        None,
    )
    .await;
    assert_eq!(final_detail["prepayment_applied_amount"], "900");
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

    // Released manually: an advance still unapplied is netted, not demanded.
    let (status, released_allocation) = json_request(
        &app,
        "DELETE",
        &format!(
            "/api/v1/invoices/{final_invoice}/prepayment-allocations/{}",
            allocations[1]["id"].as_str().unwrap()
        ),
        &billing,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{released_allocation:?}");
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
