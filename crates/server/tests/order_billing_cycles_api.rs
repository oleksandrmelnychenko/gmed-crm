//! Findings of the full order cycles (QA 2026-10-31): a settlement invoice
//! bills the actual quantities, a cancelled order has a settlement, a credited
//! final invoice leaves the quote open again. Synthetic data only.

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

fn bearer(user_id: Uuid, role: &str) -> String {
    format!(
        "Bearer {}",
        jwt::issue_access_token(TEST_SECRET, user_id, role, Uuid::new_v4()).unwrap()
    )
}

async fn call(
    app: &axum::Router,
    method: &str,
    path: &str,
    token: &str,
    body: Option<Value>,
) -> (StatusCode, Value) {
    let request = Request::builder()
        .method(method)
        .uri(path)
        .header("Authorization", token)
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

async fn seed_issuer(pool: &PgPool, admin_id: Uuid) {
    sqlx::query(
        r#"INSERT INTO system_settings (key, value, description, updated_by)
           VALUES ('agency_tax_number', to_jsonb('143/999/00001'::text), 'tax', $1)
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value"#,
    )
    .bind(admin_id)
    .execute(pool)
    .await
    .unwrap();
}

/// A patient with an order and one line of 4 hours at 95 € + 19 %, quoted.
async fn seed_quoted_order(
    app: &axum::Router,
    pool: &PgPool,
    admin_id: Uuid,
    token: &str,
) -> (Uuid, Uuid, Uuid, String) {
    seed_issuer(pool, admin_id).await;
    let patient_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO patients (patient_id, first_name, last_name, birth_date, gender, email, created_by,
                                 address_street, address_zip, address_city, address_country)
           VALUES ($1, 'Anna', 'Muster', '1985-05-15', 'female', $2, $3,
                   'Hauptstraße 1', '80331', 'München', 'DE')
           RETURNING id"#,
    )
    .bind(format!("P-CYC-{}", Uuid::new_v4().simple()))
    .bind(format!("anna-{}@example.com", Uuid::new_v4().simple()))
    .bind(admin_id)
    .fetch_one(pool)
    .await
    .unwrap();
    let (status, order) = call(
        app,
        "POST",
        "/api/v1/orders",
        token,
        Some(json!({
            "patient_id": patient_id,
            "needs_description": "Begleitung",
            "date_from": "2026-10-25",
            "date_to": "2026-10-30",
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{order:?}");
    let order_id = Uuid::parse_str(order["id"].as_str().unwrap()).unwrap();
    let service_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO order_leistungen (
               order_id, patient_id, description, quantity, unit_price, currency, vat_rate
           ) VALUES ($1, $2, 'Dolmetscher', 4, 95, 'EUR', 19)
           RETURNING id"#,
    )
    .bind(order_id)
    .bind(patient_id)
    .fetch_one(pool)
    .await
    .unwrap();
    let (status, quote) = call(
        app,
        "POST",
        &format!("/api/v1/orders/{order_id}/quotes"),
        token,
        Some(json!({ "notes": "Angebot" })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{quote:?}");
    (
        patient_id,
        order_id,
        service_id,
        quote["id"].as_str().unwrap().to_string(),
    )
}

async fn set_actual_hours(pool: &PgPool, service_id: Uuid, hours: Decimal) {
    sqlx::query(
        r#"UPDATE order_leistungen
           SET quantity = $2, status = 'approved', delivered_at = now(), approved_at = now()
           WHERE id = $1"#,
    )
    .bind(service_id)
    .bind(hours)
    .execute(pool)
    .await
    .unwrap();
}

#[tokio::test]
async fn a_final_invoice_bills_the_approved_hours_not_the_quoted_ones() {
    let Some(ctx) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let ceo = bearer(ctx.admin_id, "ceo");
    let (_, _, service_id, quote_id) =
        seed_quoted_order(&ctx.app, &ctx.pool, ctx.admin_id, &ceo).await;
    set_actual_hours(&ctx.pool, service_id, Decimal::new(35, 1)).await;

    let (status, quote) = call(
        &ctx.app,
        "GET",
        &format!("/api/v1/quotes/{quote_id}"),
        &ceo,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{quote:?}");
    assert_eq!(quote["line_items"][0]["remaining_quantity"], "3.5");

    let (status, invoice) = call(
        &ctx.app,
        "POST",
        &format!("/api/v1/quotes/{quote_id}/invoices"),
        &ceo,
        Some(json!({ "invoice_type": "final" })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{invoice:?}");
    // 3,5 h × 95 € = 332,50 € net, 395,68 € gross; the quote said 452,20 €.
    let gross: Decimal = invoice["total_gross"].as_str().unwrap().parse().unwrap();
    assert_eq!(gross, Decimal::new(39568, 2));

    // The draft bills what the order now holds and can be released.
    let invoice_id = invoice["id"].as_str().unwrap();
    let (status, released) = call(
        &ctx.app,
        "POST",
        &format!("/api/v1/invoices/{invoice_id}/status"),
        &ceo,
        Some(json!({ "status": "sent" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{released:?}");
}

#[tokio::test]
async fn hours_above_the_quote_ask_for_a_new_quote_and_a_stale_draft_is_not_released() {
    let Some(ctx) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let ceo = bearer(ctx.admin_id, "ceo");
    let (_, _, service_id, quote_id) =
        seed_quoted_order(&ctx.app, &ctx.pool, ctx.admin_id, &ceo).await;

    // The draft was made before the report came in.
    let (status, draft) = call(
        &ctx.app,
        "POST",
        &format!("/api/v1/quotes/{quote_id}/invoices"),
        &ceo,
        Some(json!({ "invoice_type": "final" })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{draft:?}");
    set_actual_hours(&ctx.pool, service_id, Decimal::new(35, 1)).await;
    let draft_id = draft["id"].as_str().unwrap();
    let (status, refused) = call(
        &ctx.app,
        "POST",
        &format!("/api/v1/invoices/{draft_id}/status"),
        &ceo,
        Some(json!({ "status": "sent" })),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{refused:?}");
    assert_eq!(refused["error"], "invoice_bills_above_actual_services");

    let (status, cancelled) = call(
        &ctx.app,
        "POST",
        &format!("/api/v1/invoices/{draft_id}/status"),
        &ceo,
        Some(json!({ "status": "cancelled" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{cancelled:?}");
    set_actual_hours(&ctx.pool, service_id, Decimal::new(5, 0)).await;
    let (status, refused) = call(
        &ctx.app,
        "POST",
        &format!("/api/v1/quotes/{quote_id}/invoices"),
        &ceo,
        Some(json!({ "invoice_type": "final" })),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{refused:?}");
    assert_eq!(refused["error"], "quote_behind_actual_services");
}

#[tokio::test]
async fn a_cancelled_order_gets_a_settlement_and_its_delivered_work_can_be_billed() {
    let Some(ctx) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let ceo = bearer(ctx.admin_id, "ceo");
    let (_, order_id, service_id, _) =
        seed_quoted_order(&ctx.app, &ctx.pool, ctx.admin_id, &ceo).await;
    set_actual_hours(&ctx.pool, service_id, Decimal::new(2, 0)).await;

    let (status, cancelled) = call(
        &ctx.app,
        "POST",
        &format!("/api/v1/orders/{order_id}/status"),
        &ceo,
        Some(json!({ "status": "cancelled", "reason": "Patient reist nicht an" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{cancelled:?}");

    let (status, settlement) = call(
        &ctx.app,
        "GET",
        &format!("/api/v1/orders/{order_id}/termination-settlement"),
        &ceo,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{settlement:?}");
    assert_eq!(settlement["status"], "open");
    assert_eq!(settlement["contract_id"], Value::Null);

    let (status, invoice) = call(
        &ctx.app,
        "POST",
        &format!("/api/v1/orders/{order_id}/termination-settlement/final-invoice"),
        &ceo,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{invoice:?}");
    // 2 h × 95 € + 19 %.
    let gross: Decimal = invoice["total_gross"].as_str().unwrap().parse().unwrap();
    assert_eq!(gross, Decimal::new(22610, 2));
    assert!(
        invoice["notes"]
            .as_str()
            .unwrap()
            .contains("Stornierung des Auftrags"),
        "{invoice:?}"
    );

    let audited: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM audit_log WHERE action = 'open_cancelled_order_settlement' AND entity_id = $1",
    )
    .bind(order_id)
    .fetch_one(&ctx.pool)
    .await
    .unwrap();
    assert_eq!(audited, 1);
}

#[tokio::test]
async fn a_fully_credited_final_invoice_leaves_the_quote_open_for_a_new_invoice() {
    let Some(ctx) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let ceo = bearer(ctx.admin_id, "ceo");
    let (_, _, _, quote_id) = seed_quoted_order(&ctx.app, &ctx.pool, ctx.admin_id, &ceo).await;
    let create = |token: String, quote_id: String, app: axum::Router| async move {
        call(
            &app,
            "POST",
            &format!("/api/v1/quotes/{quote_id}/invoices"),
            &token,
            Some(json!({ "invoice_type": "final" })),
        )
        .await
    };
    let (status, first) = create(ceo.clone(), quote_id.clone(), ctx.app.clone()).await;
    assert_eq!(status, StatusCode::CREATED, "{first:?}");
    let first_id = first["id"].as_str().unwrap().to_string();
    let (status, released) = call(
        &ctx.app,
        "POST",
        &format!("/api/v1/invoices/{first_id}/status"),
        &ceo,
        Some(json!({ "status": "sent" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{released:?}");

    let (status, refused) = create(ceo.clone(), quote_id.clone(), ctx.app.clone()).await;
    assert_eq!(status, StatusCode::CONFLICT, "{refused:?}");

    let (status, credit) = call(
        &ctx.app,
        "POST",
        &format!("/api/v1/invoices/{first_id}/credit-notes"),
        &ceo,
        Some(json!({
            "request_id": Uuid::new_v4(),
            "amount_gross": 452.2,
            "reason": "Falsche Rechnung",
            "issued_on": gmed_server::app_time::today().to_string(),
            "portal_visible": true,
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{credit:?}");
    let credit_id = credit["credit_note_transaction_id"]
        .as_str()
        .unwrap()
        .to_string();

    let (status, second) = create(ceo.clone(), quote_id.clone(), ctx.app.clone()).await;
    assert_eq!(status, StatusCode::CREATED, "{second:?}");
    let second_gross: Decimal = second["total_gross"].as_str().unwrap().parse().unwrap();
    assert_eq!(second_gross, Decimal::new(45220, 2));

    // Reversing the credit note now would bill the service twice.
    let (status, refused) = call(
        &ctx.app,
        "POST",
        &format!("/api/v1/invoices/{first_id}/credit-notes/{credit_id}/reversal"),
        &ceo,
        Some(json!({
            "request_id": Uuid::new_v4(),
            "reason": "Irrtum",
            "issued_on": gmed_server::app_time::today().to_string(),
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{refused:?}");
    assert_eq!(refused["error"], "credit_note_rebilled");
}

/// QA 2026-11-01 (R3 BUG-2): a line credited in full gives its quantity back
/// while the final invoice stays active, so it is billed on an interim invoice.
#[tokio::test]
async fn a_line_credited_in_full_is_billed_again_on_an_interim_invoice() {
    let Some(ctx) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let ceo = bearer(ctx.admin_id, "ceo");
    let (patient_id, order_id, _, _) =
        seed_quoted_order(&ctx.app, &ctx.pool, ctx.admin_id, &ceo).await;
    sqlx::query(
        r#"INSERT INTO order_leistungen (
               order_id, patient_id, description, quantity, unit_price, currency, vat_rate
           ) VALUES ($1, $2, 'Koordination', 1, 100, 'EUR', 19)"#,
    )
    .bind(order_id)
    .bind(patient_id)
    .execute(&ctx.pool)
    .await
    .unwrap();
    let (status, quote) = call(
        &ctx.app,
        "POST",
        &format!("/api/v1/orders/{order_id}/quotes"),
        &ceo,
        Some(json!({ "notes": "Angebot" })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{quote:?}");
    let quote_id = quote["id"].as_str().unwrap().to_string();
    let selected = json!([
        { "line_index": 0, "quantity": "4" },
        { "line_index": 1, "quantity": "1" },
    ]);
    let invoices = format!("/api/v1/quotes/{quote_id}/invoices");
    let (status, invoice) = call(
        &ctx.app,
        "POST",
        &invoices,
        &ceo,
        Some(json!({ "invoice_type": "final", "line_items": selected })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{invoice:?}");
    let invoice_id = invoice["id"].as_str().unwrap().to_string();
    let (status, released) = call(
        &ctx.app,
        "POST",
        &format!("/api/v1/invoices/{invoice_id}/status"),
        &ceo,
        Some(json!({ "status": "sent" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{released:?}");

    let (status, credit) = call(
        &ctx.app,
        "POST",
        &format!("/api/v1/invoices/{invoice_id}/credit-notes"),
        &ceo,
        Some(json!({
            "request_id": Uuid::new_v4(),
            "lines": [{ "line_index": 1 }],
            "reason": "Leistung falsch",
            "issued_on": gmed_server::app_time::today().to_string(),
            "portal_visible": true,
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{credit:?}");

    let (status, reopened) = call(
        &ctx.app,
        "GET",
        &format!("/api/v1/quotes/{quote_id}"),
        &ceo,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{reopened:?}");
    assert_eq!(reopened["line_items"][0]["remaining_quantity"], "0");
    assert_eq!(reopened["line_items"][1]["remaining_quantity"], "1");
    assert_eq!(reopened["active_invoice_types"], json!(["final"]));

    let (status, interim) = call(
        &ctx.app,
        "POST",
        &invoices,
        &ceo,
        Some(json!({
            "invoice_type": "interim",
            "line_items": [{ "line_index": 1, "quantity": "1" }],
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{interim:?}");
    let gross: Decimal = interim["total_gross"].as_str().unwrap().parse().unwrap();
    assert_eq!(gross, Decimal::new(119, 0));
}

/// QA 2026-11-01 (R4-2): the draft final invoice re-bills a supplier cost the
/// statement still shows as a receivable; the balance counts it once and equals
/// the settlement (138 against 19).
#[tokio::test]
async fn the_statement_counts_a_cost_on_the_settlement_draft_once() {
    let Some(ctx) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let ceo = bearer(ctx.admin_id, "ceo");
    let (patient_id, order_id, service_id, _) =
        seed_quoted_order(&ctx.app, &ctx.pool, ctx.admin_id, &ceo).await;
    set_actual_hours(&ctx.pool, service_id, Decimal::new(2, 0)).await;
    sqlx::query(
        r#"INSERT INTO external_invoices (
               order_id, patient_id, external_invoice_number,
               amount_net, amount_vat, amount_gross, currency,
               status, paid_by, service_delivered, created_by
           ) VALUES ($1, $2, $3, 100, 0, 100, 'EUR', 'paid', 'agency', true, $4)"#,
    )
    .bind(order_id)
    .bind(patient_id)
    .bind(format!("EXT-DRAFT-{}", Uuid::new_v4().simple()))
    .bind(ctx.admin_id)
    .execute(&ctx.pool)
    .await
    .unwrap();
    let (status, cancelled) = call(
        &ctx.app,
        "POST",
        &format!("/api/v1/orders/{order_id}/status"),
        &ceo,
        Some(json!({ "status": "cancelled", "reason": "Patient reist nicht an" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{cancelled:?}");
    let (status, invoice) = call(
        &ctx.app,
        "POST",
        &format!("/api/v1/orders/{order_id}/termination-settlement/final-invoice"),
        &ceo,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{invoice:?}");
    // 226,10 € services and the 100 € cost.
    let gross: Decimal = invoice["total_gross"].as_str().unwrap().parse().unwrap();
    assert_eq!(gross, Decimal::new(32610, 2));

    let (status, settlement) = call(
        &ctx.app,
        "GET",
        &format!("/api/v1/orders/{order_id}/termination-settlement"),
        &ceo,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{settlement:?}");
    let (status, statement) = call(
        &ctx.app,
        "GET",
        &format!(
            "/api/v1/patients/{patient_id}/account-statement?currency=EUR&order_id={order_id}"
        ),
        &ceo,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{statement:?}");
    let balance: Decimal = statement["summary"]["calculated_balance"]
        .as_str()
        .unwrap()
        .parse()
        .unwrap();
    assert_eq!(balance, Decimal::new(32610, 2), "{statement:?}");
    let settled: Decimal = settlement["current"]["balance_gross"]
        .as_str()
        .unwrap()
        .parse()
        .unwrap();
    assert_eq!(balance, settled);
}

#[tokio::test]
async fn a_payment_below_a_cent_is_refused() {
    let Some(ctx) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let ceo = bearer(ctx.admin_id, "ceo");
    let (_, _, _, quote_id) = seed_quoted_order(&ctx.app, &ctx.pool, ctx.admin_id, &ceo).await;
    let (status, invoice) = call(
        &ctx.app,
        "POST",
        &format!("/api/v1/quotes/{quote_id}/invoices"),
        &ceo,
        Some(json!({ "invoice_type": "final" })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{invoice:?}");
    let invoice_id = invoice["id"].as_str().unwrap();
    let (status, released) = call(
        &ctx.app,
        "POST",
        &format!("/api/v1/invoices/{invoice_id}/status"),
        &ceo,
        Some(json!({ "status": "sent" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{released:?}");
    let (status, refused) = call(
        &ctx.app,
        "POST",
        &format!("/api/v1/invoices/{invoice_id}/payments"),
        &ceo,
        Some(json!({
            "request_id": Uuid::new_v4(),
            "amount_gross": "0.005",
            "payment_method": "bank_transfer",
            "received_on": gmed_server::app_time::today().to_string(),
        })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{refused:?}");
}
