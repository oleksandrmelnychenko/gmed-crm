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
    seed_issuer(&ctx.pool, ctx.admin_id).await;
    let (catalog_id, unit_price): (Uuid, Decimal) = sqlx::query_as(
        r#"SELECT id, unit_price FROM agency_service_catalog
           WHERE service_key = 'interpreter_hours' ORDER BY created_at LIMIT 1"#,
    )
    .fetch_one(&ctx.pool)
    .await
    .unwrap();
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
               agency_service_id
           ) VALUES ($1, $2, 'Dolmetscherbetreuung', $3, $4, 'EUR', 19, $5)
           RETURNING id"#,
    )
    .bind(order_id)
    .bind(patient_id)
    .bind(Decimal::from(planned))
    .bind(unit_price)
    .bind(catalog_id)
    .fetch_one(&ctx.pool)
    .await
    .unwrap();
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
