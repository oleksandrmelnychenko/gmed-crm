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
async fn a_stale_draft_is_not_released_and_hours_above_the_quote_go_on_the_final() {
    let Some(ctx) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let ceo = bearer(ctx.admin_id, "ceo");
    let (_, _, service_id, quote_id) =
        seed_quoted_order(&ctx.app, &ctx.pool, ctx.admin_id, &ceo).await;

    // The draft was made before the report came in; the service still
    // planned proposes nothing (QA 2026-11-19, S1-2), staff typed 4 h.
    let (status, draft) = call(
        &ctx.app,
        "POST",
        &format!("/api/v1/quotes/{quote_id}/invoices"),
        &ceo,
        Some(json!({
            "invoice_type": "final",
            "line_items": [{ "line_index": 0, "quantity": "4" }],
        })),
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
    // More hours than quoted: the final invoice bills them (owner
    // 2026-11-17), no new quote needed.
    set_actual_hours(&ctx.pool, service_id, Decimal::new(5, 0)).await;
    let (status, invoice) = call(
        &ctx.app,
        "POST",
        &format!("/api/v1/quotes/{quote_id}/invoices"),
        &ceo,
        Some(json!({ "invoice_type": "final" })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{invoice:?}");
    // 5 h × 95 € = 475 € net, 565,25 € gross.
    assert_eq!(
        invoice["total_gross"]
            .as_str()
            .unwrap()
            .parse::<Decimal>()
            .unwrap(),
        Decimal::new(56525, 2)
    );
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
            // The 4 h still planned are billed as typed (QA 2026-11-19, S1-2).
            Some(json!({
                "invoice_type": "final",
                "line_items": [{ "line_index": 0, "quantity": 4 }],
            })),
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
    // The clock stepped back between the credit note and the new invoice
    // (QA 2026-11-16: this made the reversal pass the check and fail with a
    // 500): which document is newer does not decide it.
    sqlx::query("UPDATE invoices SET created_at = created_at - interval '1 hour' WHERE id = $1")
        .bind(Uuid::parse_str(second["id"].as_str().unwrap()).unwrap())
        .execute(&ctx.pool)
        .await
        .unwrap();

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
        Some(json!({
            "invoice_type": "final",
            "line_items": [{ "line_index": 0, "quantity": 4 }],
        })),
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

// ---------------------------------------------------------------------------
// Owner 2026-11-17: the final invoice bills what was actually delivered, not
// the estimate 1:1. Interpreter hours go through the real report approval.
// ---------------------------------------------------------------------------

fn money(value: &Value) -> Decimal {
    match value {
        Value::String(text) => text.parse().unwrap(),
        Value::Number(number) => number.to_string().parse().unwrap(),
        other => panic!("not a decimal: {other}"),
    }
}

fn gross_of(quantity: Decimal, unit_price: Decimal) -> Decimal {
    gmed_server::money::line_amounts(quantity, unit_price, Decimal::from(19), Decimal::ZERO).gross
}

struct InterpreterCase {
    order_id: Uuid,
    patient_id: Uuid,
    service_id: Uuid,
    quote_id: String,
    interpreter_id: Uuid,
    catalog_id: Uuid,
    unit_price: Decimal,
}

/// A patient order planning `planned` interpreter hours from the catalogue,
/// quoted, and an interpreter booked for the patient.
async fn interpreter_case(
    ctx: &support::TestSuiteContext,
    token: &str,
    planned: i64,
) -> InterpreterCase {
    interpreter_case_with_tariff(ctx, token, planned, None, Decimal::ZERO).await
}

/// [`interpreter_case`] with the order's own tariff: a unit price other than
/// the catalogue's (`None`: the catalogue's) and a discount in percent.
async fn interpreter_case_with_tariff(
    ctx: &support::TestSuiteContext,
    token: &str,
    planned: i64,
    tariff_price: Option<Decimal>,
    discount_percent: Decimal,
) -> InterpreterCase {
    interpreter_case_with_outlays(ctx, token, planned, tariff_price, discount_percent, None).await
}

/// [`interpreter_case_with_tariff`] whose quote also names estimated
/// outlays: a planned pass-through line «Voraussichtliche Auslagen».
async fn interpreter_case_with_outlays(
    ctx: &support::TestSuiteContext,
    token: &str,
    planned: i64,
    tariff_price: Option<Decimal>,
    discount_percent: Decimal,
    outlays: Option<Decimal>,
) -> InterpreterCase {
    seed_issuer(&ctx.pool, ctx.admin_id).await;
    let (catalog_id, catalog_price): (Uuid, Decimal) = sqlx::query_as(
        r#"SELECT id, unit_price FROM agency_service_catalog
           WHERE service_key = 'interpreter_hours' ORDER BY created_at LIMIT 1"#,
    )
    .fetch_one(&ctx.pool)
    .await
    .unwrap();
    let unit_price = tariff_price.unwrap_or(catalog_price);
    let patient_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO patients (patient_id, first_name, last_name, birth_date, gender, email, created_by,
                                 address_street, address_zip, address_city, address_country)
           VALUES ($1, 'Berta', 'Beispiel', '1980-03-01', 'female', $2, $3,
                   'Hauptstraße 2', '80331', 'München', 'DE')
           RETURNING id"#,
    )
    .bind(format!("P-ACT-{}", Uuid::new_v4().simple()))
    .bind(format!("berta-{}@example.com", Uuid::new_v4().simple()))
    .bind(ctx.admin_id)
    .fetch_one(&ctx.pool)
    .await
    .unwrap();
    let (status, order) = call(
        &ctx.app,
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
               order_id, patient_id, description, quantity, unit_price, currency, vat_rate,
               agency_service_id, discount_percent
           ) VALUES ($1, $2, 'Dolmetscherbetreuung', $3, $4, 'EUR', 19, $5, $6)
           RETURNING id"#,
    )
    .bind(order_id)
    .bind(patient_id)
    .bind(Decimal::from(planned))
    .bind(unit_price)
    .bind(catalog_id)
    .bind(discount_percent)
    .fetch_one(&ctx.pool)
    .await
    .unwrap();
    if let Some(outlays) = outlays {
        sqlx::query(
            r#"INSERT INTO order_leistungen (
                   order_id, patient_id, description, quantity, unit_price, currency, vat_rate,
                   is_cost_passthrough
               ) VALUES ($1, $2, 'Voraussichtliche Auslagen', 1, $3, 'EUR', 0, TRUE)"#,
        )
        .bind(order_id)
        .bind(patient_id)
        .bind(outlays)
        .execute(&ctx.pool)
        .await
        .unwrap();
    }
    let (status, quote) = call(
        &ctx.app,
        "POST",
        &format!("/api/v1/orders/{order_id}/quotes"),
        token,
        Some(json!({ "notes": "Angebot" })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{quote:?}");
    let interpreter_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO users (email, password_hash, name, role)
           VALUES ($1, 'test-password-hash', 'Dolmetscher Test', 'interpreter')
           RETURNING id"#,
    )
    .bind(format!("interp-{}@example.com", Uuid::new_v4().simple()))
    .fetch_one(&ctx.pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO patient_assignments (patient_id, user_id, assigned_by) VALUES ($1, $2, $3)",
    )
    .bind(patient_id)
    .bind(interpreter_id)
    .bind(ctx.admin_id)
    .execute(&ctx.pool)
    .await
    .unwrap();
    InterpreterCase {
        order_id,
        patient_id,
        service_id,
        quote_id: quote["id"].as_str().unwrap().to_string(),
        interpreter_id,
        catalog_id,
        unit_price,
    }
}

/// A visit of yesterday with the booked interpreter, reported with `hours`
/// and approved by the CEO (which bills the report on the order).
async fn report_hours(
    ctx: &support::TestSuiteContext,
    token: &str,
    case: &InterpreterCase,
    hours: f64,
    days_ago: i64,
) {
    let appointment_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO appointments (
                patient_id, appointment_type, title, date, time_start, time_end, status,
                created_by, order_id, interpreter_id, interpreter_response
           ) VALUES ($1, 'internal', 'Visite', $2, '08:00'::time, '09:00'::time, 'confirmed',
                     $3, $4, $5, 'accepted')
           RETURNING id"#,
    )
    .bind(case.patient_id)
    .bind(gmed_server::app_time::today() - chrono::Duration::days(days_ago))
    .bind(ctx.admin_id)
    .bind(case.order_id)
    .bind(case.interpreter_id)
    .fetch_one(&ctx.pool)
    .await
    .unwrap();
    let (status, body) = call(
        &ctx.app,
        "POST",
        &format!("/api/v1/appointments/{appointment_id}/report"),
        &bearer(case.interpreter_id, "interpreter"),
        Some(json!({ "hours": hours, "report_text": "Synthetischer Bericht" })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{body:?}");
    let (status, body) = call(
        &ctx.app,
        "POST",
        &format!("/api/v1/appointments/{appointment_id}/report/approve"),
        token,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body:?}");
}

async fn get_quote(ctx: &support::TestSuiteContext, token: &str, quote_id: &str) -> Value {
    let (status, quote) = call(
        &ctx.app,
        "GET",
        &format!("/api/v1/quotes/{quote_id}"),
        token,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{quote:?}");
    quote
}

async fn release_invoice(ctx: &support::TestSuiteContext, token: &str, invoice_id: &str) -> Value {
    let (status, released) = call(
        &ctx.app,
        "POST",
        &format!("/api/v1/invoices/{invoice_id}/status"),
        token,
        Some(json!({ "status": "sent" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{released:?}");
    released
}

async fn service_status(pool: &PgPool, service_id: Uuid) -> String {
    sqlx::query_scalar("SELECT status FROM order_leistungen WHERE id = $1")
        .bind(service_id)
        .fetch_one(pool)
        .await
        .unwrap()
}

#[tokio::test]
async fn a_final_invoice_bills_five_reported_hours_of_three_planned() {
    let Some(ctx) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let ceo = bearer(ctx.admin_id, "ceo");
    let case = interpreter_case(&ctx, &ceo, 3).await;
    report_hours(&ctx, &ceo, &case, 5.0, 1).await;

    let quote = get_quote(&ctx, &ceo, &case.quote_id).await;
    let line = &quote["line_items"][0];
    assert_eq!(money(&line["quantity"]), Decimal::from(3), "{line:?}");
    assert_eq!(line["delivery_basis"], "actual");
    assert_eq!(money(&line["final_quantity"]), Decimal::from(5));
    // An interim invoice still stops at the quote.
    assert_eq!(money(&line["remaining_quantity"]), Decimal::from(3));
    let (status, refused) = call(
        &ctx.app,
        "POST",
        &format!("/api/v1/quotes/{}/invoices", case.quote_id),
        &ceo,
        Some(json!({ "invoice_type": "interim", "line_items": [{ "line_index": 0, "quantity": 5 }] })),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{refused:?}");

    let (status, invoice) = call(
        &ctx.app,
        "POST",
        &format!("/api/v1/quotes/{}/invoices", case.quote_id),
        &ceo,
        Some(
            json!({ "invoice_type": "final", "line_items": [{ "line_index": 0, "quantity": 5 }] }),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{invoice:?}");
    assert_eq!(
        money(&invoice["line_items"][0]["quantity"]),
        Decimal::from(5)
    );
    assert_eq!(
        money(&invoice["line_items"][0]["quoted_quantity"]),
        Decimal::from(3)
    );
    assert_eq!(
        money(&invoice["total_gross"]),
        gross_of(Decimal::from(5), case.unit_price)
    );
    let allocated: Decimal = sqlx::query_scalar(
        "SELECT SUM(quantity) FROM invoice_order_line_allocations WHERE invoice_id = $1",
    )
    .bind(Uuid::parse_str(invoice["id"].as_str().unwrap()).unwrap())
    .fetch_one(&ctx.pool)
    .await
    .unwrap();
    assert_eq!(allocated, Decimal::from(5));

    release_invoice(&ctx, &ceo, invoice["id"].as_str().unwrap()).await;
    assert_eq!(service_status(&ctx.pool, case.service_id).await, "invoiced");
    // Nothing is left to bill of the quote, no negative remainder.
    let quote = get_quote(&ctx, &ceo, &case.quote_id).await;
    assert_eq!(
        money(&quote["line_items"][0]["remaining_quantity"]),
        Decimal::ZERO
    );
}

#[tokio::test]
async fn a_final_invoice_bills_two_reported_hours_of_three_planned_and_closes_the_line() {
    let Some(ctx) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let ceo = bearer(ctx.admin_id, "ceo");
    let case = interpreter_case(&ctx, &ceo, 3).await;
    report_hours(&ctx, &ceo, &case, 2.0, 1).await;

    let quote = get_quote(&ctx, &ceo, &case.quote_id).await;
    assert_eq!(
        money(&quote["line_items"][0]["final_quantity"]),
        Decimal::from(2)
    );
    // Without a selection the final invoice takes the proposal.
    let (status, invoice) = call(
        &ctx.app,
        "POST",
        &format!("/api/v1/quotes/{}/invoices", case.quote_id),
        &ceo,
        Some(json!({ "invoice_type": "final" })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{invoice:?}");
    assert_eq!(
        money(&invoice["line_items"][0]["quantity"]),
        Decimal::from(2)
    );
    assert_eq!(
        money(&invoice["total_gross"]),
        gross_of(Decimal::from(2), case.unit_price)
    );
    release_invoice(&ctx, &ceo, invoice["id"].as_str().unwrap()).await;
    assert_eq!(service_status(&ctx.pool, case.service_id).await, "invoiced");

    // The final settles the line: the hour not delivered is not billed by
    // an interim invoice afterwards.
    let quote = get_quote(&ctx, &ceo, &case.quote_id).await;
    assert_eq!(
        money(&quote["line_items"][0]["remaining_quantity"]),
        Decimal::ZERO
    );
    let (status, refused) = call(
        &ctx.app,
        "POST",
        &format!("/api/v1/quotes/{}/invoices", case.quote_id),
        &ceo,
        Some(json!({ "invoice_type": "interim", "line_items": [{ "line_index": 0, "quantity": 1 }] })),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{refused:?}");
}

#[tokio::test]
async fn a_final_invoice_bills_delivered_services_outside_the_quote() {
    let Some(ctx) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let ceo = bearer(ctx.admin_id, "ceo");
    let case = interpreter_case(&ctx, &ceo, 3).await;
    // Two visits: the first report takes the planned line, the second adds
    // a line of its own; a transfer was booked without the quote.
    report_hours(&ctx, &ceo, &case, 3.0, 2).await;
    report_hours(&ctx, &ceo, &case, 1.5, 1).await;
    let transfer_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO order_leistungen (
               order_id, patient_id, description, quantity, unit_price, currency, vat_rate,
               status, delivered_at, approved_at
           ) VALUES ($1, $2, 'Zusatztransfer Klinik', 1, 80, 'EUR', 19, 'approved', now(), now())
           RETURNING id"#,
    )
    .bind(case.order_id)
    .bind(case.patient_id)
    .fetch_one(&ctx.pool)
    .await
    .unwrap();
    let second_report_line: Uuid = sqlx::query_scalar(
        r#"SELECT id FROM order_leistungen
           WHERE order_id = $1 AND agency_service_id = $2 AND id <> $3"#,
    )
    .bind(case.order_id)
    .bind(case.catalog_id)
    .bind(case.service_id)
    .fetch_one(&ctx.pool)
    .await
    .unwrap();

    let quote = get_quote(&ctx, &ceo, &case.quote_id).await;
    let extras = quote["delivered_services_outside_quote"]
        .as_array()
        .unwrap()
        .clone();
    assert_eq!(extras.len(), 2, "{extras:?}");
    let sibling = extras
        .iter()
        .find(|extra| extra["order_leistung_id"] == second_report_line.to_string())
        .unwrap();
    assert_eq!(sibling["quote_line_index"], 0);
    let transfer = extras
        .iter()
        .find(|extra| extra["order_leistung_id"] == transfer_id.to_string())
        .unwrap();
    assert!(transfer["quote_line_index"].is_null());

    let (status, invoice) = call(
        &ctx.app,
        "POST",
        &format!("/api/v1/quotes/{}/invoices", case.quote_id),
        &ceo,
        Some(json!({
            "invoice_type": "final",
            "line_items": [{ "line_index": 0, "quantity": 3 }],
            "order_services": [
                { "order_leistung_id": second_report_line, "quantity": 1.5 },
                { "order_leistung_id": transfer_id, "quantity": 1 },
            ],
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{invoice:?}");
    let lines = invoice["line_items"].as_array().unwrap();
    assert_eq!(lines.len(), 3, "{lines:?}");
    assert_eq!(lines[2]["source"], "final_order_service");
    let expected = gross_of(Decimal::from(3), case.unit_price)
        + gross_of(Decimal::new(15, 1), case.unit_price)
        + gross_of(Decimal::ONE, Decimal::from(80));
    assert_eq!(money(&invoice["total_gross"]), expected);
    let invoice_id = invoice["id"].as_str().unwrap().to_string();

    // The same service cannot go on a second invoice meanwhile.
    let (status, refused) = call(
        &ctx.app,
        "POST",
        &format!("/api/v1/patients/{}/billing-invoices", case.patient_id),
        &ceo,
        Some(json!({
            "request_id": Uuid::new_v4(),
            "order_id": case.order_id,
            "quote_id": case.quote_id,
            "invoice_type": "final",
            "line_items": [],
            "external_invoice_ids": [],
            "order_services": [{ "order_leistung_id": transfer_id, "quantity": 1 }],
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{refused:?}");

    // An interim invoice takes no services outside the quote.
    let (status, refused) = call(
        &ctx.app,
        "POST",
        &format!("/api/v1/quotes/{}/invoices", case.quote_id),
        &ceo,
        Some(json!({
            "invoice_type": "interim",
            "line_items": [{ "line_index": 0, "quantity": 1 }],
            "order_services": [{ "order_leistung_id": transfer_id, "quantity": 1 }],
        })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{refused:?}");

    // The draft editor keeps the services when only the quote lines change.
    let (status, edited) = call(
        &ctx.app,
        "PUT",
        &format!("/api/v1/invoices/{invoice_id}/draft"),
        &ceo,
        Some(json!({
            "due_date": null,
            "notes": null,
            "line_items": [{ "line_index": 0, "quantity": 2.5 }],
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{edited:?}");
    assert_eq!(
        edited["line_items"].as_array().unwrap().len(),
        3,
        "{edited:?}"
    );

    release_invoice(&ctx, &ceo, &invoice_id).await;
    for service in [case.service_id, second_report_line, transfer_id] {
        assert_eq!(service_status(&ctx.pool, service).await, "invoiced");
    }
    let quote = get_quote(&ctx, &ceo, &case.quote_id).await;
    assert!(
        quote["delivered_services_outside_quote"]
            .as_array()
            .unwrap()
            .is_empty(),
        "{quote:?}"
    );

    // A Storno gives the services back.
    let (status, cancelled) = call(
        &ctx.app,
        "POST",
        &format!("/api/v1/invoices/{invoice_id}/status"),
        &ceo,
        Some(json!({ "status": "cancelled", "reason": "Neu ausstellen" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{cancelled:?}");
    assert_eq!(service_status(&ctx.pool, transfer_id).await, "approved");
}

#[tokio::test]
async fn advances_above_a_smaller_final_invoice_are_previewed_and_the_rest_stays_credit() {
    let Some(ctx) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let ceo = bearer(ctx.admin_id, "ceo");
    let case = interpreter_case(&ctx, &ceo, 3).await;
    sqlx::query(
        "UPDATE orders SET prepayment_required = true, prepayment_amount = 300 WHERE id = $1",
    )
    .bind(case.order_id)
    .execute(&ctx.pool)
    .await
    .unwrap();
    let (status, advance) = call(
        &ctx.app,
        "POST",
        &format!("/api/v1/quotes/{}/invoices", case.quote_id),
        &ceo,
        Some(json!({ "invoice_type": "advance", "advance_basis": "prepayment" })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{advance:?}");
    let advance_id = advance["id"].as_str().unwrap().to_string();
    release_invoice(&ctx, &ceo, &advance_id).await;
    let (status, paid) = call(
        &ctx.app,
        "POST",
        &format!("/api/v1/invoices/{advance_id}/payments"),
        &ceo,
        Some(json!({
            "request_id": Uuid::new_v4(),
            "amount_gross": "300",
            "payment_method": "bank_transfer",
            "received_on": gmed_server::app_time::today().to_string(),
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{paid:?}");

    // Much less was delivered: one hour.
    report_hours(&ctx, &ceo, &case, 1.0, 1).await;
    let final_gross = gross_of(Decimal::ONE, case.unit_price);
    let (status, preview) = call(
        &ctx.app,
        "POST",
        &format!("/api/v1/quotes/{}/final-preview", case.quote_id),
        &ceo,
        Some(json!({ "line_items": [{ "line_index": 0, "quantity": 1 }] })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{preview:?}");
    assert_eq!(money(&preview["total_gross"]), final_gross);
    assert_eq!(money(&preview["deducted_gross"]), final_gross);
    assert_eq!(money(&preview["due_gross"]), Decimal::ZERO);
    let previewed = &preview["advances"][0];
    assert_eq!(money(&previewed["paid_gross"]), Decimal::from(300));
    assert_eq!(money(&previewed["deduction_gross"]), final_gross);
    assert_eq!(previewed["deduction_rows"][0]["kind"], "taxed");

    let (status, invoice) = call(
        &ctx.app,
        "POST",
        &format!("/api/v1/quotes/{}/invoices", case.quote_id),
        &ceo,
        Some(
            json!({ "invoice_type": "final", "line_items": [{ "line_index": 0, "quantity": 1 }] }),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{invoice:?}");
    let released = release_invoice(&ctx, &ceo, invoice["id"].as_str().unwrap()).await;
    // The release deducts what the preview said.
    assert_eq!(money(&released["prepayment_applied_amount"]), final_gross);
    assert_eq!(money(&released["balance_due"]), Decimal::ZERO);

    // The rest of the advance stays the patient's money: the existing
    // close-rest path credits it and makes it refundable.
    let rest = Decimal::from(300) - final_gross;
    let (status, advance) = call(
        &ctx.app,
        "GET",
        &format!("/api/v1/invoices/{advance_id}"),
        &ceo,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{advance:?}");
    assert_eq!(
        money(&advance["advance_settlement"]["open_rest"]),
        rest,
        "{advance:?}"
    );
    let (status, closed) = call(
        &ctx.app,
        "POST",
        &format!("/api/v1/invoices/{advance_id}/advance-rest"),
        &ceo,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{closed:?}");
    assert_eq!(money(&closed["amount_gross"]), rest);
    assert_eq!(
        money(&closed["invoice"]["refundable_cash_amount"]),
        rest,
        "{closed:?}"
    );
}

#[tokio::test]
async fn a_credited_final_above_the_quote_gives_back_its_lines_and_services() {
    let Some(ctx) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let ceo = bearer(ctx.admin_id, "ceo");
    let case = interpreter_case(&ctx, &ceo, 3).await;
    report_hours(&ctx, &ceo, &case, 5.0, 1).await;
    let transfer_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO order_leistungen (
               order_id, patient_id, description, quantity, unit_price, currency, vat_rate,
               status, delivered_at, approved_at
           ) VALUES ($1, $2, 'Zusatztransfer Klinik', 1, 80, 'EUR', 19, 'approved', now(), now())
           RETURNING id"#,
    )
    .bind(case.order_id)
    .bind(case.patient_id)
    .fetch_one(&ctx.pool)
    .await
    .unwrap();
    let body = json!({
        "invoice_type": "final",
        "line_items": [{ "line_index": 0, "quantity": 5 }],
        "order_services": [{ "order_leistung_id": transfer_id, "quantity": 1 }],
    });
    let (status, first) = call(
        &ctx.app,
        "POST",
        &format!("/api/v1/quotes/{}/invoices", case.quote_id),
        &ceo,
        Some(body.clone()),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{first:?}");
    let first_id = first["id"].as_str().unwrap().to_string();
    release_invoice(&ctx, &ceo, &first_id).await;
    assert_eq!(service_status(&ctx.pool, transfer_id).await, "invoiced");

    let (status, credit) = call(
        &ctx.app,
        "POST",
        &format!("/api/v1/invoices/{first_id}/credit-notes"),
        &ceo,
        Some(json!({
            "request_id": Uuid::new_v4(),
            "amount_gross": money(&first["total_gross"]),
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

    // The quote and the service outside it are open again.
    let quote = get_quote(&ctx, &ceo, &case.quote_id).await;
    assert_eq!(
        money(&quote["line_items"][0]["final_quantity"]),
        Decimal::from(5)
    );
    assert_eq!(
        quote["delivered_services_outside_quote"][0]["order_leistung_id"],
        transfer_id.to_string(),
        "{quote:?}"
    );
    let (status, second) = call(
        &ctx.app,
        "POST",
        &format!("/api/v1/quotes/{}/invoices", case.quote_id),
        &ceo,
        Some(body),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{second:?}");
    assert_eq!(money(&second["total_gross"]), money(&first["total_gross"]));

    // Reversing the credit note now would bill the hours twice.
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

/// Owner decision 2026-11-17: the release of the final invoice cancels the
/// planned estimate lines it leaves out and waives the delivered services it
/// bills at 0, so the order can close; its Storno gives both back.
#[tokio::test]
async fn a_released_final_cancels_lines_left_out_and_waives_services_billed_at_zero() {
    let Some(ctx) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let ceo = bearer(ctx.admin_id, "ceo");
    let mut case = interpreter_case(&ctx, &ceo, 3).await;
    let transfer_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO order_leistungen (
               order_id, patient_id, description, quantity, unit_price, currency, vat_rate
           ) VALUES ($1, $2, 'Flughafentransfer', 2, 50, 'EUR', 19)
           RETURNING id"#,
    )
    .bind(case.order_id)
    .bind(case.patient_id)
    .fetch_one(&ctx.pool)
    .await
    .unwrap();
    // The estimate now names both services.
    let (status, quote) = call(
        &ctx.app,
        "POST",
        &format!("/api/v1/orders/{}/quotes", case.order_id),
        &ceo,
        Some(json!({ "notes": "Angebot 2" })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{quote:?}");
    case.quote_id = quote["id"].as_str().unwrap().to_string();
    let transfer_line = quote["line_items"]
        .as_array()
        .unwrap()
        .iter()
        .position(|line| line["source_order_leistung_id"] == transfer_id.to_string())
        .unwrap();
    let hours_line = 1 - transfer_line;
    report_hours(&ctx, &ceo, &case, 2.0, 1).await;
    // Delivered beyond the estimate, given for free.
    let goodwill_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO order_leistungen (
               order_id, patient_id, description, quantity, unit_price, currency, vat_rate,
               status, delivered_at, approved_at
           ) VALUES ($1, $2, 'Zusätzliche Begleitung', 1, 40, 'EUR', 19, 'approved', now(), now())
           RETURNING id"#,
    )
    .bind(case.order_id)
    .bind(case.patient_id)
    .fetch_one(&ctx.pool)
    .await
    .unwrap();

    let (status, invoice) = call(
        &ctx.app,
        "POST",
        &format!("/api/v1/quotes/{}/invoices", case.quote_id),
        &ceo,
        Some(json!({
            "invoice_type": "final",
            "line_items": [
                { "line_index": hours_line, "quantity": 2 },
                { "line_index": transfer_line, "quantity": 0 },
            ],
            "order_services": [{ "order_leistung_id": goodwill_id, "quantity": 0 }],
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{invoice:?}");
    assert_eq!(
        invoice["line_items"].as_array().unwrap().len(),
        1,
        "{invoice:?}"
    );
    let invoice_id = invoice["id"].as_str().unwrap().to_string();
    release_invoice(&ctx, &ceo, &invoice_id).await;

    let (status, reason, settled_by): (String, Option<String>, Option<Uuid>) = sqlx::query_as(
        "SELECT status, cancellation_reason, final_settlement_invoice_id FROM order_leistungen WHERE id = $1",
    )
    .bind(transfer_id)
    .fetch_one(&ctx.pool)
    .await
    .unwrap();
    assert_eq!(status, "cancelled");
    assert!(reason.is_some_and(|reason| reason.contains("Schlussrechnung")));
    assert_eq!(settled_by, Uuid::parse_str(&invoice_id).ok());
    let (status, waived): (String, bool) = sqlx::query_as(
        "SELECT status, billing_waived_at IS NOT NULL FROM order_leistungen WHERE id = $1",
    )
    .bind(goodwill_id)
    .fetch_one(&ctx.pool)
    .await
    .unwrap();
    assert_eq!((status.as_str(), waived), ("approved", true));
    // Nothing approved is left unbilled: the order can close.
    let open: i64 = sqlx::query_scalar(
        r#"SELECT COUNT(*) FROM order_leistungen
           WHERE order_id = $1 AND status = 'approved' AND billing_waived_at IS NULL"#,
    )
    .bind(case.order_id)
    .fetch_one(&ctx.pool)
    .await
    .unwrap();
    assert_eq!(open, 0);
    let audited: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM audit_log WHERE action = 'settle_final_invoice_leftovers' AND entity_id = $1",
    )
    .bind(Uuid::parse_str(&invoice_id).unwrap())
    .fetch_one(&ctx.pool)
    .await
    .unwrap();
    assert_eq!(audited, 1);

    // The Storno gives both back.
    let (status, cancelled) = call(
        &ctx.app,
        "POST",
        &format!("/api/v1/invoices/{invoice_id}/status"),
        &ceo,
        Some(json!({ "status": "cancelled", "reason": "Neu ausstellen" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{cancelled:?}");
    assert_eq!(service_status(&ctx.pool, transfer_id).await, "planned");
    let waived: bool = sqlx::query_scalar(
        "SELECT billing_waived_at IS NOT NULL FROM order_leistungen WHERE id = $1",
    )
    .bind(goodwill_id)
    .fetch_one(&ctx.pool)
    .await
    .unwrap();
    assert!(!waived);
}

async fn raw_get(app: &axum::Router, path: &str, token: &str) -> (StatusCode, Vec<u8>) {
    let request = Request::builder()
        .method("GET")
        .uri(path)
        .header("Authorization", token)
        .body(Body::empty())
        .unwrap();
    let response = app.clone().oneshot(request).await.unwrap();
    let status = response.status();
    let bytes = axum::body::to_bytes(response.into_body(), 16 * 1024 * 1024)
        .await
        .unwrap();
    (status, bytes.to_vec())
}

async fn seed_agency(pool: &PgPool, admin_id: Uuid) {
    for (key, value) in [
        ("agency_name", "GMED Test Agentur"),
        (
            "agency_address",
            "Albert-Schweitzer-Straße 56\n81735 München",
        ),
        ("agency_country_code", "DE"),
    ] {
        sqlx::query(
            r#"INSERT INTO system_settings (key, value, description, updated_by)
               VALUES ($1, to_jsonb($2::text), $1, $3)
               ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value"#,
        )
        .bind(key)
        .bind(value)
        .bind(admin_id)
        .execute(pool)
        .await
        .unwrap();
    }
}

async fn invoice_detail(ctx: &support::TestSuiteContext, token: &str, invoice_id: &str) -> Value {
    let (status, invoice) = call(
        &ctx.app,
        "GET",
        &format!("/api/v1/invoices/{invoice_id}"),
        token,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{invoice:?}");
    invoice
}

/// A released prepayment advance of `amount` with `paid` received.
async fn paid_prepayment_advance(
    ctx: &support::TestSuiteContext,
    token: &str,
    case: &InterpreterCase,
    amount: Decimal,
    paid: Decimal,
) -> String {
    sqlx::query(
        "UPDATE orders SET prepayment_required = true, prepayment_amount = $2 WHERE id = $1",
    )
    .bind(case.order_id)
    .bind(amount)
    .execute(&ctx.pool)
    .await
    .unwrap();
    let (status, advance) = call(
        &ctx.app,
        "POST",
        &format!("/api/v1/quotes/{}/invoices", case.quote_id),
        token,
        Some(json!({ "invoice_type": "advance", "advance_basis": "prepayment" })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{advance:?}");
    let advance_id = advance["id"].as_str().unwrap().to_string();
    release_invoice(ctx, token, &advance_id).await;
    let (status, body) = call(
        &ctx.app,
        "POST",
        &format!("/api/v1/invoices/{advance_id}/payments"),
        token,
        Some(json!({
            "request_id": Uuid::new_v4(),
            "amount_gross": paid.to_string(),
            "payment_method": "bank_transfer",
            "received_on": gmed_server::app_time::today().to_string(),
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{body:?}");
    advance_id
}

/// "1.234,56" as the printed invoice writes money.
fn de_money(value: Decimal) -> String {
    let text = format!("{value:.2}");
    let (whole, cents) = text.split_once('.').unwrap();
    let mut grouped = String::new();
    for (index, digit) in whole.chars().enumerate() {
        if index > 0 && (whole.len() - index) % 3 == 0 {
            grouped.push('.');
        }
        grouped.push(digit);
    }
    format!("{grouped},{cents}")
}

async fn cancel_invoice(ctx: &support::TestSuiteContext, token: &str, invoice_id: &str) -> Value {
    let (status, cancelled) = call(
        &ctx.app,
        "POST",
        &format!("/api/v1/invoices/{invoice_id}/status"),
        token,
        Some(json!({ "status": "cancelled", "reason": "Neu ausstellen" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{cancelled:?}");
    cancelled
}

/// Owner decision 2026-11-17 (verify2-A S2-1/S2-3, V2A-1-like data): the
/// advance paid own services (19 %) in full; the final bills one hour of
/// them and a pass-through cost. The 19 % share no service takes is corrected
/// by a credit note on the advance and its money is set off against the
/// pass-through cost as a payment: one amount to pay, in preview, release,
/// PDF and XML alike. The Storno gives all of it back; a new final repeats it.
#[tokio::test]
async fn the_paid_advance_rest_no_category_takes_is_set_off_and_the_storno_gives_it_back() {
    let Some(ctx) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let ceo = bearer(ctx.admin_id, "ceo");
    let case = interpreter_case(&ctx, &ceo, 3).await;
    seed_agency(&ctx.pool, ctx.admin_id).await;
    let own = gross_of(Decimal::from(3), case.unit_price);
    let advance_id = paid_prepayment_advance(&ctx, &ceo, &case, own, own).await;
    report_hours(&ctx, &ceo, &case, 1.0, 1).await;
    let clinic_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO order_leistungen (
               order_id, patient_id, description, quantity, unit_price, currency, vat_rate,
               is_cost_passthrough, status, delivered_at, approved_at
           ) VALUES ($1, $2, 'Klinik MRT', 1, 1000, 'EUR', 0, true, 'approved', now(), now())
           RETURNING id"#,
    )
    .bind(case.order_id)
    .bind(case.patient_id)
    .fetch_one(&ctx.pool)
    .await
    .unwrap();
    let one = gross_of(Decimal::ONE, case.unit_price);
    let rest = own - one;
    let total = one + Decimal::from(1000);
    let due = total - one - rest;
    let selection = json!({
        "line_items": [{ "line_index": 0, "quantity": 1 }],
        "order_services": [{ "order_leistung_id": clinic_id, "quantity": 1 }],
    });

    let (status, preview) = call(
        &ctx.app,
        "POST",
        &format!("/api/v1/quotes/{}/final-preview", case.quote_id),
        &ceo,
        Some(selection.clone()),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{preview:?}");
    assert_eq!(money(&preview["total_gross"]), total);
    assert_eq!(money(&preview["deducted_gross"]), one);
    assert_eq!(money(&preview["rest_applied_gross"]), rest);
    assert_eq!(money(&preview["advances"][0]["rest_applied_gross"]), rest);
    assert_eq!(money(&preview["due_gross"]), due);

    let mut body = selection.clone();
    body["invoice_type"] = json!("final");
    let (status, invoice) = call(
        &ctx.app,
        "POST",
        &format!("/api/v1/quotes/{}/invoices", case.quote_id),
        &ceo,
        Some(body.clone()),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{invoice:?}");
    let final_id = invoice["id"].as_str().unwrap().to_string();
    // The draft asks what the release will ask.
    let draft = invoice_detail(&ctx, &ceo, &final_id).await;
    assert_eq!(money(&draft["expected_prepayment_gross"]), one + rest);
    let released = release_invoice(&ctx, &ceo, &final_id).await;
    assert_eq!(money(&released["prepayment_applied_amount"]), one);
    assert_eq!(money(&released["balance_due"]), due, "{released:?}");
    let detail = invoice_detail(&ctx, &ceo, &final_id).await;
    assert_eq!(money(&detail["release_advance_rest_gross"]), rest);
    assert_eq!(money(&detail["paid_amount"]), rest);
    // No second figure, no dead offer.
    assert_eq!(money(&detail["advance_credit_available"]), Decimal::ZERO);
    assert_eq!(detail["available_prepayments"], json!([]), "{detail:?}");

    // The advance: its unused 19 % share corrected, its money moved on.
    let advance = invoice_detail(&ctx, &ceo, &advance_id).await;
    assert_eq!(money(&advance["credited_amount"]), rest);
    assert_eq!(money(&advance["refundable_cash_amount"]), Decimal::ZERO);
    let final_uuid = Uuid::parse_str(&final_id).unwrap();
    let (credits, credit_vat): (i64, Decimal) = sqlx::query_as(
        r#"SELECT COUNT(*), COALESCE(SUM(amount_vat), 0) FROM invoice_credit_note_transactions
           WHERE final_release_invoice_id = $1 AND transaction_type = 'credit_note'"#,
    )
    .bind(final_uuid)
    .fetch_one(&ctx.pool)
    .await
    .unwrap();
    assert_eq!(credits, 1);
    assert!(credit_vat > Decimal::ZERO, "the 19 % share is corrected");
    let moved: Decimal = sqlx::query_scalar(
        "SELECT COALESCE(SUM(amount_gross), 0) FROM invoice_credit_transfers WHERE final_release_invoice_id = $1",
    )
    .bind(final_uuid)
    .fetch_one(&ctx.pool)
    .await
    .unwrap();
    assert_eq!(moved, rest);
    let audited: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM audit_log WHERE action = 'credit_transferred_in' AND entity_id = $1",
    )
    .bind(final_uuid)
    .fetch_one(&ctx.pool)
    .await
    .unwrap();
    assert_eq!(audited, 1);

    // The issued invoice states one amount to pay.
    let (status, pdf) = raw_get(&ctx.app, &format!("/api/v1/invoices/{final_id}/pdf"), &ceo).await;
    assert_eq!(status, StatusCode::OK);
    let text = pdf_extract::extract_text_from_mem(&pdf).unwrap();
    assert!(text.contains("Restbetrag Anzahlung"), "{text}");
    assert!(text.contains(&de_money(due)), "{text}");
    let (status, xml) = raw_get(
        &ctx.app,
        &format!("/api/v1/invoices/{final_id}/zugferd.xml"),
        &ceo,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{}", String::from_utf8_lossy(&xml));
    let xml = String::from_utf8(xml).unwrap();
    assert!(
        xml.contains(&format!(
            "<ram:TotalPrepaidAmount>{:.2}</ram:TotalPrepaidAmount>",
            one + rest
        )),
        "{xml}"
    );
    assert!(
        xml.contains(&format!(
            "<ram:DuePayableAmount>{due:.2}</ram:DuePayableAmount>"
        )),
        "{xml}"
    );

    // Storno: the money goes back to the advance, the credit note is
    // reversed, the advance asks what it asked before the final.
    cancel_invoice(&ctx, &ceo, &final_id).await;
    let advance = invoice_detail(&ctx, &ceo, &advance_id).await;
    assert_eq!(
        money(&advance["credited_amount"]),
        Decimal::ZERO,
        "{advance:?}"
    );
    assert_eq!(money(&advance["paid_amount"]), own);
    assert_eq!(advance["status"], "paid");
    let reversed: i64 = sqlx::query_scalar(
        r#"SELECT COUNT(*) FROM invoice_credit_note_transactions reversal
           JOIN invoice_credit_note_transactions credit ON credit.id = reversal.reverses_transaction_id
           WHERE credit.final_release_invoice_id = $1 AND reversal.transaction_type = 'reversal'"#,
    )
    .bind(final_uuid)
    .fetch_one(&ctx.pool)
    .await
    .unwrap();
    assert_eq!(reversed, 1);
    let cancelled = invoice_detail(&ctx, &ceo, &final_id).await;
    assert_eq!(cancelled["status"], "cancelled");
    assert_eq!(
        money(&cancelled["release_advance_rest_gross"]),
        Decimal::ZERO
    );

    // A new final sets off the same; «Оплата уже поступила» without an
    // amount takes what is left after the deduction AND the rest (fix-102
    // B-2 with fix-103).
    body["payment_received"] = json!({
        "received_on": gmed_server::app_time::today().to_string(),
        "payment_method": "bank_transfer",
    });
    let (status, again) = call(
        &ctx.app,
        "POST",
        &format!("/api/v1/quotes/{}/invoices", case.quote_id),
        &ceo,
        Some(body),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{again:?}");
    let again_id = again["id"].as_str().unwrap().to_string();
    let released = release_invoice(&ctx, &ceo, &again_id).await;
    assert_eq!(money(&released["prepayment_applied_amount"]), one);
    assert_eq!(
        money(&released["balance_due"]),
        Decimal::ZERO,
        "{released:?}"
    );
    assert_eq!(released["status"], "paid");
    let noted: Option<Decimal> =
        sqlx::query_scalar("SELECT payment_received_amount FROM invoices WHERE id = $1")
            .bind(Uuid::parse_str(&again_id).unwrap())
            .fetch_one(&ctx.pool)
            .await
            .unwrap();
    assert_eq!(noted, Some(due));
}

/// verify2-A S2-3 (V2A-2/V2A-4-like): the release closes the unpaid part of
/// a partly paid advance by credit note; the Storno of the final reverses it
/// and the advance asks for its open rest again.
#[tokio::test]
async fn the_storno_of_a_final_reopens_the_unpaid_rest_of_its_advance() {
    let Some(ctx) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let ceo = bearer(ctx.admin_id, "ceo");
    let case = interpreter_case(&ctx, &ceo, 3).await;
    let advance_id =
        paid_prepayment_advance(&ctx, &ceo, &case, Decimal::from(300), Decimal::from(100)).await;
    report_hours(&ctx, &ceo, &case, 1.0, 1).await;
    let (status, invoice) = call(
        &ctx.app,
        "POST",
        &format!("/api/v1/quotes/{}/invoices", case.quote_id),
        &ceo,
        Some(
            json!({ "invoice_type": "final", "line_items": [{ "line_index": 0, "quantity": 1 }] }),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{invoice:?}");
    let final_id = invoice["id"].as_str().unwrap().to_string();
    release_invoice(&ctx, &ceo, &final_id).await;
    let advance = invoice_detail(&ctx, &ceo, &advance_id).await;
    assert_eq!(money(&advance["credited_amount"]), Decimal::from(200));

    cancel_invoice(&ctx, &ceo, &final_id).await;
    let advance = invoice_detail(&ctx, &ceo, &advance_id).await;
    assert_eq!(
        money(&advance["credited_amount"]),
        Decimal::ZERO,
        "{advance:?}"
    );
    assert_eq!(money(&advance["balance_due"]), Decimal::from(200));
    assert_eq!(advance["status"], "partially_paid");
    let (credit_reversed, credit_number): (bool, String) = sqlx::query_as(
        r#"SELECT EXISTS (
                  SELECT 1 FROM invoice_credit_note_transactions reversal
                  WHERE reversal.reverses_transaction_id = credit.id
                    AND reversal.transaction_type = 'reversal'),
                  credit.document_number
           FROM invoice_credit_note_transactions credit
           WHERE credit.final_release_invoice_id = $1"#,
    )
    .bind(Uuid::parse_str(&final_id).unwrap())
    .fetch_one(&ctx.pool)
    .await
    .unwrap();
    assert!(credit_reversed, "{credit_number} reversed with the Storno");
}

/// verify2-A S2-4: the Leistungsdatum of interpreter hours is the day of the
/// visit, not the day the report was approved; the dialog proposes the
/// period the issued invoice prints.
#[tokio::test]
async fn interpreter_hours_are_dated_by_the_visit_not_by_the_approval() {
    let Some(ctx) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let ceo = bearer(ctx.admin_id, "ceo");
    let case = interpreter_case(&ctx, &ceo, 3).await;
    seed_agency(&ctx.pool, ctx.admin_id).await;
    report_hours(&ctx, &ceo, &case, 2.0, 3).await;
    let visit = gmed_server::app_time::today() - chrono::Duration::days(3);
    let selection = json!({ "line_items": [{ "line_index": 0, "quantity": 2 }] });
    let (status, preview) = call(
        &ctx.app,
        "POST",
        &format!("/api/v1/quotes/{}/final-preview", case.quote_id),
        &ceo,
        Some(selection.clone()),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{preview:?}");
    assert_eq!(
        preview["service_period"],
        json!({ "from": visit.to_string(), "to": visit.to_string() })
    );
    let mut body = selection;
    body["invoice_type"] = json!("final");
    let (status, invoice) = call(
        &ctx.app,
        "POST",
        &format!("/api/v1/quotes/{}/invoices", case.quote_id),
        &ceo,
        Some(body),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{invoice:?}");
    let final_id = invoice["id"].as_str().unwrap().to_string();
    let (status, draft) = call(
        &ctx.app,
        "GET",
        &format!("/api/v1/invoices/{final_id}/draft"),
        &ceo,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{draft:?}");
    assert_eq!(draft["service_period_default"], preview["service_period"]);
    release_invoice(&ctx, &ceo, &final_id).await;
    let (status, pdf) = raw_get(&ctx.app, &format!("/api/v1/invoices/{final_id}/pdf"), &ceo).await;
    assert_eq!(status, StatusCode::OK);
    let text = pdf_extract::extract_text_from_mem(&pdf).unwrap();
    assert!(
        text.contains(&visit.format("%d.%m.%Y").to_string()),
        "{text}"
    );
    let (status, xml) = raw_get(
        &ctx.app,
        &format!("/api/v1/invoices/{final_id}/zugferd.xml"),
        &ceo,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{}", String::from_utf8_lossy(&xml));
    let xml = String::from_utf8(xml).unwrap();
    let delivery = xml
        .split("<ram:ApplicableHeaderTradeDelivery>")
        .nth(1)
        .and_then(|part| part.split("</ram:ApplicableHeaderTradeDelivery>").next())
        .unwrap_or_default();
    assert!(
        delivery.contains(&visit.format("%Y%m%d").to_string()),
        "{delivery}"
    );
}

fn discounted(
    quantity: Decimal,
    unit_price: Decimal,
    discount: Decimal,
) -> gmed_server::money::LineAmounts {
    gmed_server::money::line_amounts(quantity, unit_price, Decimal::from(19), discount)
}

/// Owner 2026-11-18: the order's tariff for a service is its price and its
/// discount. The quote, an hour reported later on a line of its own and the
/// final invoice from the actual quantities all bill 60,00 € less 10 %, not
/// the catalogue price; the final prints the discount per line and its
/// Storno reverses exactly what it billed.
#[tokio::test]
async fn a_discounted_tariff_is_kept_by_later_lines_and_the_final_invoice() {
    let Some(ctx) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let ceo = bearer(ctx.admin_id, "ceo");
    let price = Decimal::from(60);
    let discount = Decimal::from(10);
    let case = interpreter_case_with_tariff(&ctx, &ceo, 3, Some(price), discount).await;
    // The order's tariff is not the catalogue's price.
    let catalog_price: Decimal =
        sqlx::query_scalar("SELECT unit_price FROM agency_service_catalog WHERE id = $1")
            .bind(case.catalog_id)
            .fetch_one(&ctx.pool)
            .await
            .unwrap();
    assert_ne!(catalog_price, price);
    let outdated = || async {
        let (status, order) = call(
            &ctx.app,
            "GET",
            &format!("/api/v1/orders/{}", case.order_id),
            &ceo,
            None,
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{order:?}");
        order["process_gates"]["estimate_outdated"].clone()
    };
    // The stale-estimate rule reads an accepted estimate.
    sqlx::query("UPDATE quotes SET status = 'accepted' WHERE id = $1::uuid")
        .bind(&case.quote_id)
        .execute(&ctx.pool)
        .await
        .unwrap();
    assert!(outdated().await.is_null());
    // A changed discount makes the estimate outdated like a changed price.
    sqlx::query("UPDATE order_leistungen SET discount_percent = 15 WHERE id = $1")
        .bind(case.service_id)
        .execute(&ctx.pool)
        .await
        .unwrap();
    assert!(!outdated().await.is_null());
    sqlx::query("UPDATE order_leistungen SET discount_percent = 10 WHERE id = $1")
        .bind(case.service_id)
        .execute(&ctx.pool)
        .await
        .unwrap();
    assert!(outdated().await.is_null());

    // The quote: 3 × 60,00 = 180,00 − 18,00 = 162,00 net, 30,78 VAT.
    let quote = get_quote(&ctx, &ceo, &case.quote_id).await;
    let line = &quote["line_items"][0];
    assert_eq!(line["discount_percent"], "10", "{line:?}");
    assert_eq!(line["discount_amount"], "18", "{line:?}");
    assert_eq!(money(&line["line_net"]), Decimal::from(162));
    assert_eq!(money(&quote["total_gross"]), Decimal::new(19278, 2));
    let order_total: Decimal = sqlx::query_scalar("SELECT order_service_total_gross($1)")
        .bind(case.order_id)
        .fetch_one(&ctx.pool)
        .await
        .unwrap();
    assert_eq!(order_total, Decimal::new(19278, 2));

    // 3 h take the planned line; 1,5 h more come as a line of their own,
    // priced with the order's tariff, not the catalogue's.
    report_hours(&ctx, &ceo, &case, 3.0, 2).await;
    report_hours(&ctx, &ceo, &case, 1.5, 1).await;
    let (extra_id, extra_price, extra_discount): (Uuid, Decimal, Decimal) = sqlx::query_as(
        r#"SELECT id, unit_price_snapshot, discount_percent FROM order_leistungen
           WHERE order_id = $1 AND agency_service_id = $2 AND id <> $3"#,
    )
    .bind(case.order_id)
    .bind(case.catalog_id)
    .bind(case.service_id)
    .fetch_one(&ctx.pool)
    .await
    .unwrap();
    assert_eq!((extra_price, extra_discount), (price, discount));

    let (status, invoice) = call(
        &ctx.app,
        "POST",
        &format!("/api/v1/quotes/{}/invoices", case.quote_id),
        &ceo,
        Some(json!({
            "invoice_type": "final",
            "line_items": [{ "line_index": 0, "quantity": 3 }],
            "order_services": [{ "order_leistung_id": extra_id, "quantity": 1.5 }],
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{invoice:?}");
    let lines = invoice["line_items"].as_array().unwrap();
    assert_eq!(lines.len(), 2, "{lines:?}");
    // 1,5 × 60,00 = 90,00 − 9,00 = 81,00 net, 15,39 VAT.
    assert_eq!(lines[1]["discount_percent"], "10", "{lines:?}");
    assert_eq!(lines[1]["discount_amount"], "9", "{lines:?}");
    assert_eq!(money(&lines[1]["line_net"]), Decimal::from(81));
    let first = discounted(Decimal::from(3), price, discount);
    let second = discounted(Decimal::new(15, 1), price, discount);
    assert_eq!(money(&invoice["total_net"]), first.net + second.net);
    assert_eq!(money(&invoice["total_vat"]), first.vat + second.vat);
    assert_eq!(money(&invoice["total_gross"]), first.gross + second.gross);
    assert_eq!(first.gross + second.gross, Decimal::new(28917, 2));
    let invoice_id = invoice["id"].as_str().unwrap().to_string();
    release_invoice(&ctx, &ceo, &invoice_id).await;
    let allocated: Decimal = sqlx::query_scalar(
        "SELECT discount_percent_snapshot FROM invoice_order_line_allocations WHERE invoice_id = $1::uuid",
    )
    .bind(&invoice_id)
    .fetch_one(&ctx.pool)
    .await
    .unwrap();
    assert_eq!(allocated, discount);

    // The PDF prints the discount under each discounted position.
    let (status, pdf) = raw_get(
        &ctx.app,
        &format!("/api/v1/invoices/{invoice_id}/pdf"),
        &ceo,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let text = pdf_extract::extract_text_from_mem(&pdf).unwrap();
    assert!(text.contains("Rabatt 10 %: -18,00 € netto"), "{text}");
    assert!(text.contains("Rabatt 10 %: -9,00 € netto"), "{text}");

    // The Storno reverses exactly the discounted amounts.
    let cancelled = cancel_invoice(&ctx, &ceo, &invoice_id).await;
    assert_eq!(cancelled["status"], "cancelled", "{cancelled:?}");
    let storno_gross: Decimal = sqlx::query_scalar(
        "SELECT amount_gross FROM invoice_storno_documents WHERE invoice_id = $1::uuid",
    )
    .bind(&invoice_id)
    .fetch_one(&ctx.pool)
    .await
    .unwrap();
    assert_eq!(storno_gross.abs(), Decimal::new(28917, 2));
}

/// An advance of the whole discounted quote, then the final: the final bills
/// the discounted amount and the advance covers it to the cent; a credit note
/// on the discounted line takes back its discounted gross.
#[tokio::test]
async fn an_advance_and_the_final_of_a_discounted_order_settle_to_the_cent() {
    let Some(ctx) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let ceo = bearer(ctx.admin_id, "ceo");
    let price = Decimal::new(3333, 2);
    let discount = Decimal::new(3333, 2);
    let case = interpreter_case_with_tariff(&ctx, &ceo, 3, Some(price), discount).await;
    // 3 × 33,33 = 99,99 − 33,33 = 66,66 net, 12,67 VAT, 79,33 gross.
    let whole = discounted(Decimal::from(3), price, discount);
    assert_eq!(whole.gross, Decimal::new(7933, 2));
    let quote = get_quote(&ctx, &ceo, &case.quote_id).await;
    assert_eq!(money(&quote["total_gross"]), whole.gross);

    let advance_id = paid_prepayment_advance(&ctx, &ceo, &case, whole.gross, whole.gross).await;
    report_hours(&ctx, &ceo, &case, 3.0, 1).await;
    let (status, invoice) = call(
        &ctx.app,
        "POST",
        &format!("/api/v1/quotes/{}/invoices", case.quote_id),
        &ceo,
        Some(
            json!({ "invoice_type": "final", "line_items": [{ "line_index": 0, "quantity": 3 }] }),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{invoice:?}");
    assert_eq!(money(&invoice["total_net"]), whole.net);
    assert_eq!(money(&invoice["total_gross"]), whole.gross);
    let invoice_id = invoice["id"].as_str().unwrap().to_string();
    let released = release_invoice(&ctx, &ceo, &invoice_id).await;
    assert_eq!(money(&released["prepayment_applied_amount"]), whole.gross);
    assert_eq!(money(&released["balance_due"]), Decimal::ZERO);
    let (status, advance) = call(
        &ctx.app,
        "GET",
        &format!("/api/v1/invoices/{advance_id}"),
        &ceo,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{advance:?}");
    assert_eq!(
        money(&advance["advance_settlement"]["open_rest"]),
        Decimal::ZERO,
        "{advance:?}"
    );

    // A credit note of the whole discounted line credits its gross.
    let (status, credit) = call(
        &ctx.app,
        "POST",
        &format!("/api/v1/invoices/{invoice_id}/credit-notes"),
        &ceo,
        Some(json!({
            "request_id": Uuid::new_v4(),
            "lines": [{ "line_index": 0 }],
            "reason": "Leistung nicht erbracht",
            "issued_on": gmed_server::app_time::today().to_string(),
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{credit:?}");
    assert_eq!(money(&credit["amount_gross"]), whole.gross, "{credit:?}");
}

/// A discount is 0–100 % with two decimals, never on a pass-through cost, and
/// a changed discount is a change of the order's services.
#[tokio::test]
async fn order_line_discounts_are_validated_and_change_the_order_terms() {
    let Some(ctx) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let ceo = bearer(ctx.admin_id, "ceo");
    let (_, order_id, _, _) = seed_quoted_order(&ctx.app, &ctx.pool, ctx.admin_id, &ceo).await;
    let path = format!("/api/v1/orders/{order_id}/leistungen");
    for (discount, passthrough) in [
        (json!(100.5), false),
        (json!(-1), false),
        (json!("33.333"), false),
        (json!(10), true),
    ] {
        let (status, body) = call(
            &ctx.app,
            "POST",
            &path,
            &ceo,
            Some(json!({
                "description": "Beratung",
                "quantity": 2,
                "unit_price": 180,
                "vat_rate": 19,
                "discount_percent": discount,
                "is_cost_passthrough": passthrough,
            })),
        )
        .await;
        assert_eq!(
            status,
            StatusCode::UNPROCESSABLE_ENTITY,
            "{discount} {body:?}"
        );
    }
    let reference = format!("discount-{}", Uuid::new_v4().simple());
    let add = |discount: Value| {
        json!({
            "description": "Beratung",
            "quantity": 2,
            "unit_price": 180,
            "vat_rate": 19,
            "discount_percent": discount,
            "client_reference": reference,
        })
    };
    let (status, created) = call(&ctx.app, "POST", &path, &ceo, Some(add(json!("10")))).await;
    assert_eq!(status, StatusCode::CREATED, "{created:?}");
    let total = || async {
        sqlx::query_scalar::<_, Decimal>("SELECT order_service_total_gross($1)")
            .bind(order_id)
            .fetch_one(&ctx.pool)
            .await
            .unwrap()
    };
    // 4 h × 95,00 (452,20) + 2 × 180,00 − 10 % (385,56).
    assert_eq!(total().await, Decimal::new(83776, 2));

    // The same line again with another discount is a change (upsert):
    // 2 × 180,00 − 25 % = 270,00 net, 321,30 gross.
    let (status, changed) = call(&ctx.app, "POST", &path, &ceo, Some(add(json!(25)))).await;
    assert!(status.is_success(), "{changed:?}");
    assert_eq!(total().await, Decimal::new(77350, 2));
    let terms: Value = sqlx::query_scalar("SELECT order_client_terms($1)")
        .bind(order_id)
        .fetch_one(&ctx.pool)
        .await
        .unwrap();
    let lines = terms["lines"].as_array().unwrap();
    assert!(
        lines
            .iter()
            .any(|line| line.get("discount_percent").is_some())
    );
    // A line without a discount keeps the shape it was signed with.
    assert!(
        lines
            .iter()
            .any(|line| line.get("discount_percent").is_none())
    );
}

/// Owner 2026-11-18 (interim invoices offered again): an advance, then an
/// interim invoice for part of a discounted line, then the final for the
/// rest. The interim and the final bill the discounted line to the cent and
/// the paid advance is set off exactly once across them.
#[tokio::test]
async fn advance_interim_and_final_of_a_discounted_line_settle_to_the_cent() {
    let Some(ctx) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let ceo = bearer(ctx.admin_id, "ceo");
    let price = Decimal::from(60);
    let discount = Decimal::from(10);
    let case = interpreter_case_with_tariff(&ctx, &ceo, 3, Some(price), discount).await;
    // 3 × 60,00 − 10 % = 162,00 net, 192,78 gross.
    let whole = discounted(Decimal::from(3), price, discount);
    assert_eq!(whole.gross, Decimal::new(19278, 2));
    let advance_paid = Decimal::from(100);
    paid_prepayment_advance(&ctx, &ceo, &case, advance_paid, advance_paid).await;
    report_hours(&ctx, &ceo, &case, 3.0, 1).await;

    let (status, interim) = call(
        &ctx.app,
        "POST",
        &format!("/api/v1/quotes/{}/invoices", case.quote_id),
        &ceo,
        Some(json!({ "invoice_type": "interim", "line_items": [{ "line_index": 0, "quantity": 1 }] })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{interim:?}");
    let one_hour = discounted(Decimal::ONE, price, discount);
    assert_eq!(money(&interim["total_gross"]), one_hour.gross);
    assert_eq!(interim["line_items"][0]["discount_percent"], "10");
    let interim = release_invoice(&ctx, &ceo, interim["id"].as_str().unwrap()).await;

    let (status, preview) = call(
        &ctx.app,
        "POST",
        &format!("/api/v1/quotes/{}/final-preview", case.quote_id),
        &ceo,
        Some(json!({ "line_items": [{ "line_index": 0, "quantity": 2 }] })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{preview:?}");
    let rest_gross = whole.gross - one_hour.gross;
    assert_eq!(money(&preview["total_gross"]), rest_gross, "{preview:?}");
    assert_eq!(
        preview["interim_invoices"].as_array().map(Vec::len),
        Some(1),
        "{preview:?}"
    );

    let (status, final_invoice) = call(
        &ctx.app,
        "POST",
        &format!("/api/v1/quotes/{}/invoices", case.quote_id),
        &ceo,
        Some(
            json!({ "invoice_type": "final", "line_items": [{ "line_index": 0, "quantity": 2 }] }),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{final_invoice:?}");
    assert_eq!(money(&final_invoice["total_gross"]), rest_gross);
    let released = release_invoice(&ctx, &ceo, final_invoice["id"].as_str().unwrap()).await;
    assert_eq!(
        money(&released["balance_due"]),
        money(&preview["due_gross"]),
        "{released:?}"
    );
    // Interim + final bill the whole discounted line; the advance is set off
    // once: what stays open on both is the line less the advance.
    assert_eq!(
        money(&interim["total_gross"]) + money(&released["total_gross"]),
        whole.gross
    );
    assert_eq!(
        money(&interim["prepayment_applied_amount"])
            + money(&released["prepayment_applied_amount"]),
        advance_paid,
        "{interim:?} {released:?}"
    );
    assert_eq!(
        money(&interim["balance_due"]) + money(&released["balance_due"]),
        whole.gross - advance_paid
    );
}

fn line_by_description<'a>(invoice: &'a Value, description: &str) -> &'a Value {
    invoice["line_items"]
        .as_array()
        .unwrap()
        .iter()
        .find(|line| line["description"] == description)
        .unwrap_or_else(|| panic!("no line {description}: {invoice:?}"))
}

/// QA 2026-11-19, S1-1 / S1-2: a clinic cost added during the order as a
/// pass-through bills 0 % (its 19 % is the purchase VAT), and the estimated
/// outlays never delivered are not proposed on the final invoice.
#[tokio::test]
async fn a_final_bills_a_pass_through_added_later_at_zero_and_skips_undelivered_outlays() {
    let Some(ctx) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let ceo = bearer(ctx.admin_id, "ceo");
    let case = interpreter_case_with_outlays(
        &ctx,
        &ceo,
        3,
        Some(Decimal::from(95)),
        Decimal::ZERO,
        Some(Decimal::from(3000)),
    )
    .await;
    report_hours(&ctx, &ceo, &case, 3.0, 1).await;
    let clinic_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO order_leistungen (
               order_id, patient_id, description, quantity, unit_price, currency, vat_rate,
               is_cost_passthrough, vat_source, status, delivered_at
           ) VALUES ($1, $2, 'Klinik MRT Zusatz', 1, 1200, 'EUR', 19, TRUE, 'manual',
                     'delivered', now())
           RETURNING id"#,
    )
    .bind(case.order_id)
    .bind(case.patient_id)
    .fetch_one(&ctx.pool)
    .await
    .unwrap();

    let quote = get_quote(&ctx, &ceo, &case.quote_id).await;
    let outlays = line_by_description(&quote, "Voraussichtliche Auslagen").clone();
    assert_eq!(
        money(&outlays["final_quantity"]),
        Decimal::ZERO,
        "{outlays:?}"
    );
    let outlays_index = quote["line_items"]
        .as_array()
        .unwrap()
        .iter()
        .position(|line| line["description"] == "Voraussichtliche Auslagen")
        .unwrap();
    let hours_index = 1 - outlays_index;
    let extra = quote["delivered_services_outside_quote"]
        .as_array()
        .unwrap()
        .iter()
        .find(|extra| extra["order_leistung_id"] == clinic_id.to_string())
        .unwrap()
        .clone();
    assert_eq!(money(&extra["vat_rate"]), Decimal::ZERO, "{extra:?}");

    // Without a selection: the delivered hours only, no outlays.
    let (status, proposal) = call(
        &ctx.app,
        "POST",
        &format!("/api/v1/quotes/{}/invoices", case.quote_id),
        &ceo,
        Some(json!({ "invoice_type": "final" })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{proposal:?}");
    assert_eq!(
        proposal["line_items"].as_array().unwrap().len(),
        1,
        "{proposal:?}"
    );
    assert_eq!(
        money(&proposal["total_gross"]),
        gross_of(Decimal::from(3), Decimal::from(95))
    );
    let (status, cancelled) = call(
        &ctx.app,
        "POST",
        &format!(
            "/api/v1/invoices/{}/status",
            proposal["id"].as_str().unwrap()
        ),
        &ceo,
        Some(json!({ "status": "cancelled" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{cancelled:?}");

    let (status, invoice) = call(
        &ctx.app,
        "POST",
        &format!("/api/v1/quotes/{}/invoices", case.quote_id),
        &ceo,
        Some(json!({
            "invoice_type": "final",
            "line_items": [
                { "line_index": hours_index, "quantity": 3 },
                { "line_index": outlays_index, "quantity": 0 },
            ],
            "order_services": [{ "order_leistung_id": clinic_id, "quantity": 1 }],
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{invoice:?}");
    let clinic = line_by_description(&invoice, "Klinik MRT Zusatz");
    assert_eq!(clinic["is_cost_passthrough"], true);
    assert_eq!(money(&clinic["vat_rate"]), Decimal::ZERO, "{clinic:?}");
    assert_eq!(money(&clinic["line_vat"]), Decimal::ZERO);
    assert_eq!(money(&clinic["line_gross"]), Decimal::from(1200));
    assert_eq!(
        money(&invoice["total_gross"]),
        gross_of(Decimal::from(3), Decimal::from(95)) + Decimal::from(1200)
    );
    let released = release_invoice(&ctx, &ceo, invoice["id"].as_str().unwrap()).await;
    // VAT only on the 3 h: 285,00 × 19 % = 54,15.
    assert_eq!(
        money(&released["total_vat"]),
        Decimal::new(5415, 2),
        "{released:?}"
    );
}

/// QA 2026-11-19, S1-4: 6 h × 95,00 at 10 %; the interim bills 3 h, the
/// final the other 3 h. Both are 256,50 + 48,74 = 305,24 (VAT per line),
/// not the quote's rest 305,23.
#[tokio::test]
async fn the_rest_of_a_line_on_the_final_rounds_its_vat_per_line() {
    let Some(ctx) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let ceo = bearer(ctx.admin_id, "ceo");
    let case =
        interpreter_case_with_tariff(&ctx, &ceo, 6, Some(Decimal::from(95)), Decimal::from(10))
            .await;
    let (status, interim) = call(
        &ctx.app,
        "POST",
        &format!("/api/v1/quotes/{}/invoices", case.quote_id),
        &ceo,
        Some(json!({ "invoice_type": "interim", "line_items": [{ "line_index": 0, "quantity": 3 }] })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{interim:?}");
    assert_eq!(money(&interim["total_gross"]), Decimal::new(30524, 2));
    release_invoice(&ctx, &ceo, interim["id"].as_str().unwrap()).await;
    report_hours(&ctx, &ceo, &case, 6.0, 1).await;

    let quote = get_quote(&ctx, &ceo, &case.quote_id).await;
    assert_eq!(
        money(&quote["line_items"][0]["final_quantity"]),
        Decimal::from(3)
    );
    let (status, invoice) = call(
        &ctx.app,
        "POST",
        &format!("/api/v1/quotes/{}/invoices", case.quote_id),
        &ceo,
        Some(json!({ "invoice_type": "final" })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{invoice:?}");
    let line = &invoice["line_items"][0];
    assert_eq!(money(&line["line_net"]), Decimal::new(25650, 2), "{line:?}");
    assert_eq!(money(&line["line_vat"]), Decimal::new(4874, 2), "{line:?}");
    assert_eq!(
        money(&line["line_gross"]),
        Decimal::new(30524, 2),
        "{line:?}"
    );
    assert_eq!(money(&invoice["total_vat"]), Decimal::new(4874, 2));
    assert_eq!(money(&invoice["total_gross"]), Decimal::new(30524, 2));
    release_invoice(&ctx, &ceo, invoice["id"].as_str().unwrap()).await;
}

/// QA 2026-11-19, B S2-1: 1,5 h delivered, staff bill 2 h on the final. The
/// dialog allows it, so the release does too (owner 2026-11-17).
#[tokio::test]
async fn a_final_above_the_recorded_delivery_is_released() {
    let Some(ctx) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let ceo = bearer(ctx.admin_id, "ceo");
    let case = interpreter_case(&ctx, &ceo, 3).await;
    report_hours(&ctx, &ceo, &case, 1.5, 1).await;
    let (status, invoice) = call(
        &ctx.app,
        "POST",
        &format!("/api/v1/quotes/{}/invoices", case.quote_id),
        &ceo,
        Some(
            json!({ "invoice_type": "final", "line_items": [{ "line_index": 0, "quantity": 2 }] }),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{invoice:?}");
    assert_eq!(
        money(&invoice["total_gross"]),
        gross_of(Decimal::from(2), case.unit_price)
    );
    release_invoice(&ctx, &ceo, invoice["id"].as_str().unwrap()).await;
}

async fn tax_profile_id(pool: &PgPool, key: &str) -> Uuid {
    sqlx::query_scalar("SELECT id FROM tax_profiles WHERE profile_key = $1")
        .bind(key)
        .fetch_one(pool)
        .await
        .unwrap()
}

/// Owner 2026-11-19: every order position carries an explicit tax profile;
/// a pass-through cost carries «Durchlaufender Posten 0 %» and bills 0 %.
#[tokio::test]
async fn order_positions_carry_their_tax_profile() {
    let Some(ctx) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let ceo = bearer(ctx.admin_id, "ceo");
    let (_, order_id, _, _) = seed_quoted_order(&ctx.app, &ctx.pool, ctx.admin_id, &ceo).await;
    let path = format!("/api/v1/orders/{order_id}/leistungen");
    let standard = tax_profile_id(&ctx.pool, "standard_vat").await;
    let pass_through = tax_profile_id(&ctx.pool, "pass_through_0").await;
    let add = |body: Value| {
        let app = ctx.app.clone();
        let path = path.clone();
        let ceo = ceo.clone();
        async move { call(&app, "POST", &path, &ceo, Some(body)).await }
    };
    let stored = |id: Uuid| {
        let pool = ctx.pool.clone();
        async move {
            sqlx::query_as::<_, (Option<Uuid>, Decimal, String)>(
                "SELECT tax_profile_id, vat_rate, vat_source FROM order_leistungen WHERE id = $1",
            )
            .bind(id)
            .fetch_one(&pool)
            .await
            .unwrap()
        }
    };

    // «Индивидуальная услуга», ticked transit, 19 % typed: the profile and 0 %.
    let (status, clinic) = add(json!({
        "description": "Klinik MRT Zusatz",
        "quantity": 1,
        "unit_price": 1200,
        "vat_rate": 19,
        "is_cost_passthrough": true,
    }))
    .await;
    assert_eq!(status, StatusCode::CREATED, "{clinic:?}");
    let clinic_id = Uuid::parse_str(clinic["id"].as_str().unwrap()).unwrap();
    let (profile, vat, source) = stored(clinic_id).await;
    assert_eq!(profile, Some(pass_through));
    assert_eq!(vat, Decimal::ZERO);
    assert_eq!(source, "tax_profile");

    // A manual 19 % service takes the one 19 % profile.
    let (status, own) = add(json!({
        "description": "Beratung",
        "quantity": 1,
        "unit_price": 100,
        "vat_rate": 19,
    }))
    .await;
    assert_eq!(status, StatusCode::CREATED, "{own:?}");
    let own_id = Uuid::parse_str(own["id"].as_str().unwrap()).unwrap();
    assert_eq!(stored(own_id).await.0, Some(standard));

    // A profile that does not fit the position is refused.
    for (passthrough, profile) in [(true, standard), (false, pass_through)] {
        let (status, body) = add(json!({
            "description": "Falsches Profil",
            "quantity": 1,
            "unit_price": 50,
            "vat_rate": 19,
            "is_cost_passthrough": passthrough,
            "tax_profile_id": profile,
        }))
        .await;
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body:?}");
    }

    // A chosen profile sets the rate: 7 % typed, the standard profile bills 19 %.
    let (status, chosen) = add(json!({
        "description": "Beratung 2",
        "quantity": 1,
        "unit_price": 100,
        "vat_rate": 7,
        "tax_profile_id": standard,
    }))
    .await;
    assert_eq!(status, StatusCode::CREATED, "{chosen:?}");
    let chosen_id = Uuid::parse_str(chosen["id"].as_str().unwrap()).unwrap();
    assert_eq!(stored(chosen_id).await.1, Decimal::from(19));
}

async fn line_profile(pool: &PgPool, id: Uuid) -> (Option<Uuid>, Decimal) {
    sqlx::query_as::<_, (Option<Uuid>, Decimal)>(
        "SELECT tax_profile_id, vat_rate FROM order_leistungen WHERE id = $1",
    )
    .bind(id)
    .fetch_one(pool)
    .await
    .unwrap()
}

/// qa-fix-113: every path that creates an order position stores its tax
/// profile — an order line written without one (repeat orders, service
/// groups, amendments), the line an interpreter report adds, the line a
/// completed appointment adds from a legacy price version without a profile
/// («Organisation der Behandlung», QA2 tester C), and a pass-through cost.
#[tokio::test]
async fn every_line_creation_path_stores_its_tax_profile() {
    let Some(ctx) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let ceo = bearer(ctx.admin_id, "ceo");
    let standard = tax_profile_id(&ctx.pool, "standard_vat").await;
    let pass_through = tax_profile_id(&ctx.pool, "pass_through_0").await;
    let case = interpreter_case(&ctx, &ceo, 3).await;
    // A line written without a profile takes the catalogue item's.
    assert_eq!(
        line_profile(&ctx.pool, case.service_id).await.0,
        Some(standard)
    );

    // Reported hours beyond the planned ones add a line of their own.
    report_hours(&ctx, &ceo, &case, 3.0, 2).await;
    report_hours(&ctx, &ceo, &case, 2.0, 1).await;
    let report_lines: Vec<(Option<Uuid>, Decimal)> = sqlx::query_as(
        r#"SELECT tax_profile_id, vat_rate FROM order_leistungen
           WHERE order_id = $1 AND source_interpreter_report_id IS NOT NULL"#,
    )
    .bind(case.order_id)
    .fetch_all(&ctx.pool)
    .await
    .unwrap();
    assert!(!report_lines.is_empty());
    for (profile, vat) in report_lines {
        assert_eq!(profile, Some(standard));
        assert_eq!(vat, Decimal::from(19));
    }

    // A line from a legacy price version, written without a profile: the
    // catalogue item's profile.
    let (organisation_id, organisation_profile): (Uuid, Option<Uuid>) = sqlx::query_as(
        r#"SELECT id, tax_profile_id FROM agency_service_catalog
           WHERE service_key = 'treatment_organization' ORDER BY created_at LIMIT 1"#,
    )
    .fetch_one(&ctx.pool)
    .await
    .unwrap();
    assert!(organisation_profile.is_some());
    let legacy_version: Uuid = sqlx::query_scalar(
        r#"INSERT INTO agency_service_price_versions (
               agency_service_id, name, unit_price, vat_rate, currency, valid_from, valid_to,
               created_by
           ) VALUES ($1, 'Legacy', 550, 0, 'EUR', '2020-01-01', '2020-12-31', $2)
           RETURNING id"#,
    )
    .bind(organisation_id)
    .bind(ctx.admin_id)
    .fetch_one(&ctx.pool)
    .await
    .unwrap();
    let appointment_line: Uuid = sqlx::query_scalar(
        r#"INSERT INTO order_leistungen (
               order_id, patient_id, description, quantity, unit_price, currency, vat_rate,
               status, delivered_at, agency_service_id, agency_service_price_version_id
           ) VALUES ($1, $2, 'Organisation der Behandlung', 1, 550, 'EUR', 0,
                     'delivered', now(), $3, $4)
           RETURNING id"#,
    )
    .bind(case.order_id)
    .bind(case.patient_id)
    .bind(organisation_id)
    .bind(legacy_version)
    .fetch_one(&ctx.pool)
    .await
    .unwrap();
    assert_eq!(
        line_profile(&ctx.pool, appointment_line).await,
        (organisation_profile, Decimal::ZERO)
    );

    // A pass-through cost written with its purchase VAT: «Durchlaufender
    // Posten 0 %» at 0 %.
    let clinic: Uuid = sqlx::query_scalar(
        r#"INSERT INTO order_leistungen (
               order_id, patient_id, description, quantity, unit_price, currency, vat_rate,
               is_cost_passthrough
           ) VALUES ($1, $2, 'Klinikrechnung', 1, 1000, 'EUR', 19, TRUE)
           RETURNING id"#,
    )
    .bind(case.order_id)
    .bind(case.patient_id)
    .fetch_one(&ctx.pool)
    .await
    .unwrap();
    assert_eq!(
        line_profile(&ctx.pool, clinic).await,
        (Some(pass_through), Decimal::ZERO)
    );

    // The order screen reads the profile of each position.
    let (status, order) = call(
        &ctx.app,
        "GET",
        &format!("/api/v1/orders/{}", case.order_id),
        &ceo,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{order:?}");
    let lines = order["leistungen"].as_array().unwrap();
    let clinic_line = lines
        .iter()
        .find(|line| line["id"] == clinic.to_string())
        .unwrap();
    assert_eq!(clinic_line["tax_profile_key"], "pass_through_0");
    assert_eq!(clinic_line["tax_profile_category"], "pass_through");
}

/// qa-fix-113: quote, interim, final, credit note and XML bill the rate and
/// category of the position's profile; a pass-through with the 19 % profile
/// is refused.
#[tokio::test]
async fn invoices_bill_the_rate_and_category_of_the_line_profile() {
    let Some(ctx) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let ceo = bearer(ctx.admin_id, "ceo");
    let standard = tax_profile_id(&ctx.pool, "standard_vat").await;
    let pass_through = tax_profile_id(&ctx.pool, "pass_through_0").await;
    let case = interpreter_case(&ctx, &ceo, 2).await;
    let path = format!("/api/v1/orders/{}/leistungen", case.order_id);
    let (status, refused) = call(
        &ctx.app,
        "POST",
        &path,
        &ceo,
        Some(json!({
            "description": "Klinik",
            "quantity": 1,
            "unit_price": 500,
            "vat_rate": 19,
            "is_cost_passthrough": true,
            "tax_profile_id": standard,
        })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{refused:?}");
    let (status, clinic) = call(
        &ctx.app,
        "POST",
        &path,
        &ceo,
        Some(json!({
            "description": "Klinik",
            "quantity": 1,
            "unit_price": 500,
            "vat_rate": 19,
            "is_cost_passthrough": true,
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{clinic:?}");
    let clinic_id = Uuid::parse_str(clinic["id"].as_str().unwrap()).unwrap();
    assert_eq!(
        line_profile(&ctx.pool, clinic_id).await.0,
        Some(pass_through)
    );
    sqlx::query(
        "UPDATE order_leistungen SET status = 'approved', delivered_at = now(), approved_at = now() WHERE order_id = $1",
    )
    .bind(case.order_id)
    .execute(&ctx.pool)
    .await
    .unwrap();
    let (status, quote) = call(
        &ctx.app,
        "POST",
        &format!("/api/v1/orders/{}/quotes", case.order_id),
        &ceo,
        Some(json!({ "notes": "Angebot 2" })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{quote:?}");
    let quote_id = quote["id"].as_str().unwrap().to_string();
    let quote_lines = quote["line_items"].as_array().unwrap();
    let quoted_clinic = quote_lines
        .iter()
        .find(|line| line["description"] == "Klinik")
        .unwrap();
    assert_eq!(quoted_clinic["vat_category"], "pass_through");
    assert_eq!(quoted_clinic["vat_rate"], "0");
    let interpreter_index = quote_lines
        .iter()
        .position(|line| line["description"] == "Dolmetscherbetreuung")
        .unwrap();
    let clinic_index = quote_lines
        .iter()
        .position(|line| line["description"] == "Klinik")
        .unwrap();
    assert_eq!(quote_lines[interpreter_index]["vat_category"], "standard");

    let (status, interim) = call(
        &ctx.app,
        "POST",
        &format!("/api/v1/quotes/{quote_id}/invoices"),
        &ceo,
        Some(json!({
            "invoice_type": "interim",
            "line_items": [{ "line_index": interpreter_index, "quantity": 1 }],
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{interim:?}");
    assert_eq!(interim["line_items"][0]["vat_category"], "standard");
    release_invoice(&ctx, &ceo, interim["id"].as_str().unwrap()).await;

    let (status, final_invoice) = call(
        &ctx.app,
        "POST",
        &format!("/api/v1/quotes/{quote_id}/invoices"),
        &ceo,
        Some(json!({
            "invoice_type": "final",
            "line_items": [
                { "line_index": interpreter_index, "quantity": 1 },
                { "line_index": clinic_index, "quantity": 1 },
            ],
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{final_invoice:?}");
    let billed_clinic = line_by_description(&final_invoice, "Klinik");
    assert_eq!(billed_clinic["vat_rate"], "0");
    assert_eq!(billed_clinic["vat_category"], "pass_through");
    let final_id = final_invoice["id"].as_str().unwrap().to_string();
    release_invoice(&ctx, &ceo, &final_id).await;
    let (status, xml) = raw_get(
        &ctx.app,
        &format!("/api/v1/invoices/{final_id}/zugferd.xml"),
        &ceo,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{}", String::from_utf8_lossy(&xml));
    let xml = String::from_utf8(xml).unwrap();
    assert!(
        xml.contains("<ram:CategoryCode>E</ram:CategoryCode>"),
        "{xml}"
    );
    assert!(
        xml.contains("<ram:CategoryCode>S</ram:CategoryCode>"),
        "{xml}"
    );

    // A credit note of the pass-through line credits it at 0 %.
    let lines = final_invoice["line_items"].as_array().unwrap();
    let clinic_line_index = lines
        .iter()
        .position(|line| line["description"] == "Klinik")
        .unwrap();
    let (status, credit) = call(
        &ctx.app,
        "POST",
        &format!("/api/v1/invoices/{final_id}/credit-notes"),
        &ceo,
        Some(json!({
            "request_id": Uuid::new_v4(),
            "reason": "Klinik storniert",
            "issued_on": gmed_server::app_time::today().to_string(),
            "lines": [{ "line_index": clinic_line_index }],
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{credit:?}");
    let stored: Value = sqlx::query_scalar(
        "SELECT line_items FROM invoice_credit_note_transactions WHERE invoice_id = $1::uuid",
    )
    .bind(&final_id)
    .fetch_one(&ctx.pool)
    .await
    .unwrap();
    assert_eq!(stored[0]["is_cost_passthrough"], true, "{stored:?}");
    assert_eq!(stored[0]["vat_rate"], "0", "{stored:?}");
}

/// QA2 D S2-2: after interim invoices billed every estimate line a final
/// invoice still closes the order — one line at 0,00 € naming the interims,
/// payable 0, a valid e-invoice.
#[tokio::test]
async fn a_closing_final_after_interims_bills_nothing_and_names_them() {
    let Some(ctx) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let ceo = bearer(ctx.admin_id, "ceo");
    let case = interpreter_case(&ctx, &ceo, 2).await;
    report_hours(&ctx, &ceo, &case, 2.0, 1).await;
    let mut numbers = Vec::new();
    for _ in 0..2 {
        let (status, interim) = call(
            &ctx.app,
            "POST",
            &format!("/api/v1/quotes/{}/invoices", case.quote_id),
            &ceo,
            Some(json!({ "invoice_type": "interim", "line_items": [{ "line_index": 0, "quantity": 1 }] })),
        )
        .await;
        assert_eq!(status, StatusCode::CREATED, "{interim:?}");
        let released = release_invoice(&ctx, &ceo, interim["id"].as_str().unwrap()).await;
        numbers.push(released["invoice_number"].as_str().unwrap().to_string());
    }
    let (status, final_invoice) = call(
        &ctx.app,
        "POST",
        &format!("/api/v1/quotes/{}/invoices", case.quote_id),
        &ceo,
        Some(json!({ "invoice_type": "final" })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{final_invoice:?}");
    assert_eq!(money(&final_invoice["total_gross"]), Decimal::ZERO);
    let lines = final_invoice["line_items"].as_array().unwrap();
    assert_eq!(lines.len(), 1, "{lines:?}");
    let description = lines[0]["description"].as_str().unwrap();
    for number in &numbers {
        assert!(description.contains(number), "{description}");
    }
    assert_eq!(lines[0]["vat_rate"], "19");
    let final_id = final_invoice["id"].as_str().unwrap().to_string();
    let released = release_invoice(&ctx, &ceo, &final_id).await;
    assert_eq!(
        money(&released["balance_due"]),
        Decimal::ZERO,
        "{released:?}"
    );
    let (status, xml) = raw_get(
        &ctx.app,
        &format!("/api/v1/invoices/{final_id}/zugferd.xml"),
        &ceo,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{}", String::from_utf8_lossy(&xml));
    let xml = String::from_utf8(xml).unwrap();
    assert!(
        xml.contains("<ram:DuePayableAmount>0.00</ram:DuePayableAmount>"),
        "{xml}"
    );
    assert!(
        xml.contains("<ram:CategoryCode>S</ram:CategoryCode>"),
        "{xml}"
    );
    // A second final is refused: the order's billing is closed.
    let (status, again) = call(
        &ctx.app,
        "POST",
        &format!("/api/v1/quotes/{}/invoices", case.quote_id),
        &ceo,
        Some(json!({ "invoice_type": "final" })),
    )
    .await;
    assert!(status.is_client_error(), "{again:?}");
}

/// QA2 B S2-4: the statement counts a service a final billed outside the
/// estimate as billed, and lists no cancelled service.
#[tokio::test]
async fn the_statement_counts_a_billed_extra_line_and_skips_cancelled_ones() {
    let Some(ctx) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let ceo = bearer(ctx.admin_id, "ceo");
    let case = interpreter_case(&ctx, &ceo, 1).await;
    report_hours(&ctx, &ceo, &case, 1.0, 1).await;
    let transfer_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO order_leistungen (
               order_id, patient_id, description, quantity, unit_price, currency, vat_rate,
               status, delivered_at, approved_at, discount_percent
           ) VALUES ($1, $2, 'Zusatztransfer', 1, 180, 'EUR', 19, 'approved', now(), now(), 15)
           RETURNING id"#,
    )
    .bind(case.order_id)
    .bind(case.patient_id)
    .fetch_one(&ctx.pool)
    .await
    .unwrap();
    let cancelled_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO order_leistungen (
               order_id, patient_id, description, quantity, unit_price, currency, vat_rate,
               status, cancelled_at, cancelled_by, cancellation_reason
           ) VALUES ($1, $2, 'Storniert', 1, 10, 'EUR', 19, 'cancelled', now(), $3, 'Test')
           RETURNING id"#,
    )
    .bind(case.order_id)
    .bind(case.patient_id)
    .bind(ctx.admin_id)
    .fetch_one(&ctx.pool)
    .await
    .unwrap();
    let (status, invoice) = call(
        &ctx.app,
        "POST",
        &format!("/api/v1/quotes/{}/invoices", case.quote_id),
        &ceo,
        Some(json!({
            "invoice_type": "final",
            "line_items": [{ "line_index": 0, "quantity": 1 }],
            "order_services": [{ "order_leistung_id": transfer_id, "quantity": 1 }],
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{invoice:?}");
    release_invoice(&ctx, &ceo, invoice["id"].as_str().unwrap()).await;
    let (status, statement) = call(
        &ctx.app,
        "GET",
        &format!("/api/v1/patients/{}/account-statement", case.patient_id),
        &ceo,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{statement:?}");
    let items = statement["items"].as_array().unwrap();
    let transfer = items
        .iter()
        .find(|item| item["id"] == transfer_id.to_string())
        .unwrap();
    assert_eq!(transfer["payment_state"], "invoiced", "{transfer:?}");
    assert!(
        !items
            .iter()
            .any(|item| item["id"] == cancelled_id.to_string()),
        "{items:?}"
    );
}
