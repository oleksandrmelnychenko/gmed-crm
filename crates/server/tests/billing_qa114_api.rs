//! QA3 billing fixes (qa-fix-114): billed = signed estimate terms, quote
//! refresh for orders billed in part, estimated outlays credited on the
//! final, extra lines billed everywhere. Synthetic data only.
#![allow(dead_code)]

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

fn line_by_description<'a>(invoice: &'a Value, description: &str) -> &'a Value {
    invoice["line_items"]
        .as_array()
        .unwrap()
        .iter()
        .find(|line| line["description"] == description)
        .unwrap_or_else(|| panic!("no line {description}: {invoice:?}"))
}

fn line_index_of(quote: &Value, description: &str) -> usize {
    quote["line_items"]
        .as_array()
        .unwrap()
        .iter()
        .position(|line| line["description"] == description)
        .unwrap_or_else(|| panic!("no line {description}: {quote:?}"))
}

async fn create_invoice(
    ctx: &support::TestSuiteContext,
    token: &str,
    quote_id: &str,
    body: Value,
) -> (StatusCode, Value) {
    call(
        &ctx.app,
        "POST",
        &format!("/api/v1/quotes/{quote_id}/invoices"),
        token,
        Some(body),
    )
    .await
}

/// QA3 C S1-1: the estimated outlays cannot go on an interim; an interim
/// that billed them before (legacy data) is credited back by the final,
/// which settles the delivered work against everything billed before.
#[tokio::test]
async fn estimated_outlays_billed_on_an_interim_are_credited_on_the_final() {
    let Some(ctx) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let ceo = bearer(ctx.admin_id, "ceo");
    let case = interpreter_case_with_outlays(
        &ctx,
        &ceo,
        2,
        Some(Decimal::from(95)),
        Decimal::ZERO,
        Some(Decimal::from(1500)),
    )
    .await;
    let quote = get_quote(&ctx, &ceo, &case.quote_id).await;
    let outlays_index = line_index_of(&quote, "Voraussichtliche Auslagen");
    let hours_index = 1 - outlays_index;
    assert_eq!(
        quote["line_items"][outlays_index]["interim_blocked"], "estimated_outlays",
        "{quote:?}"
    );
    let (status, refused) = create_invoice(
        &ctx,
        &ceo,
        &case.quote_id,
        json!({
            "invoice_type": "interim",
            "line_items": [{ "line_index": outlays_index, "quantity": 1 }],
        }),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{refused:?}");
    assert_eq!(refused["error"], "interim_undelivered_pass_through");

    // Data of before the guard: an interim billed the outlays.
    let outlays_id: Uuid = sqlx::query_scalar(
        r#"UPDATE order_leistungen
           SET description = 'Auslagen Vorschuss', status = 'delivered', delivered_at = now()
           WHERE order_id = $1 AND description = 'Voraussichtliche Auslagen'
           RETURNING id"#,
    )
    .bind(case.order_id)
    .fetch_one(&ctx.pool)
    .await
    .unwrap();
    let path = vec![outlays_index.to_string(), "description".to_string()];
    sqlx::query(
        "UPDATE quotes SET line_items = jsonb_set(line_items, $2, to_jsonb($3::text)) WHERE id = $1::uuid",
    )
    .bind(&case.quote_id)
    .bind(&path)
    .bind("Auslagen Vorschuss")
    .execute(&ctx.pool)
    .await
    .unwrap();
    let (status, interim) = create_invoice(
        &ctx,
        &ceo,
        &case.quote_id,
        json!({
            "invoice_type": "interim",
            "line_items": [{ "line_index": outlays_index, "quantity": 1 }],
        }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{interim:?}");
    release_invoice(&ctx, &ceo, interim["id"].as_str().unwrap()).await;
    assert_eq!(service_status(&ctx.pool, outlays_id).await, "invoiced");
    sqlx::query(
        "UPDATE order_leistungen SET description = 'Voraussichtliche Auslagen', delivered_at = NULL WHERE id = $1",
    )
    .bind(outlays_id)
    .execute(&ctx.pool)
    .await
    .unwrap();
    sqlx::query(
        "UPDATE quotes SET line_items = jsonb_set(line_items, $2, to_jsonb($3::text)) WHERE id = $1::uuid",
    )
    .bind(&case.quote_id)
    .bind(&path)
    .bind("Voraussichtliche Auslagen")
    .execute(&ctx.pool)
    .await
    .unwrap();

    report_hours(&ctx, &ceo, &case, 2.0, 1).await;
    let clinic_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO order_leistungen (
               order_id, patient_id, description, quantity, unit_price, currency, vat_rate,
               is_cost_passthrough, status, delivered_at
           ) VALUES ($1, $2, 'Klinik MRT', 1, 2000, 'EUR', 0, TRUE, 'delivered', now())
           RETURNING id"#,
    )
    .bind(case.order_id)
    .bind(case.patient_id)
    .fetch_one(&ctx.pool)
    .await
    .unwrap();

    let body = json!({
        "invoice_type": "final",
        "line_items": [{ "line_index": hours_index, "quantity": 2 }],
        "order_services": [{ "order_leistung_id": clinic_id, "quantity": 1 }],
    });
    let expected = gross_of(Decimal::from(2), Decimal::from(95)) + Decimal::from(500);
    let (status, preview) = call(
        &ctx.app,
        "POST",
        &format!("/api/v1/quotes/{}/final-preview", case.quote_id),
        &ceo,
        Some(body.clone()),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{preview:?}");
    let (status, final_invoice) = create_invoice(&ctx, &ceo, &case.quote_id, body).await;
    assert_eq!(status, StatusCode::CREATED, "{final_invoice:?}");
    let credit = final_invoice["line_items"]
        .as_array()
        .unwrap()
        .iter()
        .find(|line| line["source"] == "final_not_delivered_credit")
        .unwrap_or_else(|| panic!("no credit line: {final_invoice:?}"))
        .clone();
    assert_eq!(
        money(&credit["line_gross"]),
        Decimal::from(-1500),
        "{credit:?}"
    );
    assert_eq!(money(&credit["line_vat"]), Decimal::ZERO);
    assert_eq!(money(&final_invoice["total_gross"]), expected);
    let final_id = final_invoice["id"].as_str().unwrap().to_string();
    let released = release_invoice(&ctx, &ceo, &final_id).await;
    assert_eq!(money(&released["balance_due"]), expected, "{released:?}");
    let (status, xml) = raw_get(
        &ctx.app,
        &format!("/api/v1/invoices/{final_id}/zugferd.xml"),
        &ceo,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{}", String::from_utf8_lossy(&xml));
    let (status, pdf) = raw_get(&ctx.app, &format!("/api/v1/invoices/{final_id}/pdf"), &ceo).await;
    assert_eq!(status, StatusCode::OK, "{}", String::from_utf8_lossy(&pdf));
}

/// `POST /documents/{id}/paper-signature` with the scan of the signed copy.
async fn sign_on_paper(app: &axum::Router, document_id: &str, bearer: &str) -> (StatusCode, Value) {
    let boundary = format!("----gmed-boundary-{}", Uuid::new_v4().simple());
    let mut body = Vec::new();
    body.extend_from_slice(format!("--{boundary}\r\n").as_bytes());
    body.extend_from_slice(
        b"Content-Disposition: form-data; name=\"file\"; filename=\"kv-signed.pdf\"\r\nContent-Type: application/pdf\r\n\r\n",
    );
    body.extend_from_slice(b"%PDF-1.4 signed estimate scan");
    body.extend_from_slice(b"\r\n");
    body.extend_from_slice(format!("--{boundary}--\r\n").as_bytes());
    let request = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/documents/{document_id}/paper-signature"))
        .header("Authorization", bearer)
        .header(
            "Content-Type",
            format!("multipart/form-data; boundary={boundary}"),
        )
        .body(Body::from(body))
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

async fn generate_estimate(
    ctx: &support::TestSuiteContext,
    token: &str,
    case: &InterpreterCase,
    replace: Option<&str>,
) -> String {
    let mut body = json!({
        "template_id": "order_cost_estimate",
        "patient_id": case.patient_id,
        "order_id": case.order_id,
        "language": "de",
        "bindings": { "party_sign_place": "München" }
    });
    if let Some(replace) = replace {
        body["replace_document_id"] = json!(replace);
    }
    let (status, document) = call(
        &ctx.app,
        "POST",
        "/api/v1/documents/generate",
        token,
        Some(body),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{document:?}");
    document["id"].as_str().unwrap().to_string()
}

async fn open_quote(pool: &PgPool, order_id: Uuid) -> (String, String, Value) {
    let (id, status, lines): (Uuid, String, Value) = sqlx::query_as(
        r#"SELECT id, status, line_items FROM quotes
           WHERE order_id = $1 AND status <> 'superseded'
           ORDER BY created_at DESC, id DESC LIMIT 1"#,
    )
    .bind(order_id)
    .fetch_one(pool)
    .await
    .unwrap();
    (id.to_string(), status, lines)
}

async fn get_order(ctx: &support::TestSuiteContext, token: &str, order_id: Uuid) -> Value {
    let (status, order) = call(
        &ctx.app,
        "GET",
        &format!("/api/v1/orders/{order_id}"),
        token,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{order:?}");
    order
}

/// QA3 D S2-2 and A S2-1 / B S1-1: what is billed of an estimate line is
/// the signed estimate. A changed discount of a line not billed yet makes
/// the estimate outdated: no invoice bills the line (409) until a new KV
/// version is made, also for an order billed in part; the new version's
/// quote lists the whole order, supersedes the old one, is accepted by the
/// signature, clears the outdated state, and the final bills the new terms
/// without billing the interim's hours again. An invoice line never names
/// a tax profile with another rate.
#[tokio::test]
async fn a_changed_line_waits_for_a_new_estimate_version_which_refreshes_a_part_billed_quote() {
    let Some(ctx) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    seed_agency(&ctx.pool, ctx.admin_id).await;
    let ceo = bearer(ctx.admin_id, "ceo");
    let case =
        interpreter_case_with_tariff(&ctx, &ceo, 2, Some(Decimal::from(95)), Decimal::ZERO).await;
    let transfer_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO order_leistungen (
               order_id, patient_id, description, quantity, unit_price, currency, vat_rate
           ) VALUES ($1, $2, 'Transfer Flughafen', 1, 200, 'EUR', 19)
           RETURNING id"#,
    )
    .bind(case.order_id)
    .bind(case.patient_id)
    .fetch_one(&ctx.pool)
    .await
    .unwrap();
    let (status, quote) = call(
        &ctx.app,
        "POST",
        &format!("/api/v1/orders/{}/quotes", case.order_id),
        &ceo,
        Some(json!({ "notes": "Angebot" })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{quote:?}");
    let first_quote = quote["id"].as_str().unwrap().to_string();
    let estimate = generate_estimate(&ctx, &ceo, &case, None).await;
    let (status, signed) = sign_on_paper(&ctx.app, &estimate, &ceo).await;
    assert!(status.is_success(), "{signed:?}");
    assert_eq!(open_quote(&ctx.pool, case.order_id).await.1, "accepted");

    // The hours are billed on an interim.
    report_hours(&ctx, &ceo, &case, 2.0, 1).await;
    let quote = get_quote(&ctx, &ceo, &first_quote).await;
    let hours_index = line_index_of(&quote, "Dolmetscherbetreuung");
    let transfer_index = line_index_of(&quote, "Transfer Flughafen");
    let (status, interim) = create_invoice(
        &ctx,
        &ceo,
        &first_quote,
        json!({
            "invoice_type": "interim",
            "line_items": [{ "line_index": hours_index, "quantity": 2 }],
        }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{interim:?}");
    let interim_id = interim["id"].as_str().unwrap().to_string();
    release_invoice(&ctx, &ceo, &interim_id).await;
    let interim_gross = money(&interim["total_gross"]);

    // The transfer gets 10 % discount and is delivered.
    let (status, changed) = call(
        &ctx.app,
        "POST",
        &format!(
            "/api/v1/orders/{}/leistungen/{transfer_id}/terms",
            case.order_id
        ),
        &ceo,
        Some(json!({ "discount_percent": 10, "confirm_signature_reset": true })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{changed:?}");
    sqlx::query(
        "UPDATE order_leistungen SET status = 'delivered', delivered_at = now() WHERE id = $1",
    )
    .bind(transfer_id)
    .execute(&ctx.pool)
    .await
    .unwrap();
    let quote = get_quote(&ctx, &ceo, &first_quote).await;
    assert_eq!(
        quote["line_items"][transfer_index]["terms_outdated"], true,
        "{quote:?}"
    );
    let (status, refused) = create_invoice(
        &ctx,
        &ceo,
        &first_quote,
        json!({
            "invoice_type": "interim",
            "line_items": [{ "line_index": transfer_index, "quantity": 1 }],
        }),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{refused:?}");
    assert_eq!(refused["error"], "estimate_terms_outdated");
    let (status, refused) =
        create_invoice(&ctx, &ceo, &first_quote, json!({ "invoice_type": "final" })).await;
    assert_eq!(status, StatusCode::CONFLICT, "{refused:?}");
    assert_eq!(refused["error"], "estimate_terms_outdated");

    // A new version of the estimate refreshes the quote of the order billed in part.
    // The signed copy is the newest version of the estimate.
    let newest: Uuid = sqlx::query_scalar(
        r#"SELECT id FROM documents
           WHERE order_id = $1 AND (id = $2::uuid OR replaces_document_id = $2::uuid)
           ORDER BY created_at DESC, id DESC LIMIT 1"#,
    )
    .bind(case.order_id)
    .bind(&estimate)
    .fetch_one(&ctx.pool)
    .await
    .unwrap();
    assert!(!estimate.is_empty());
    let renewed = generate_estimate(&ctx, &ceo, &case, Some(&newest.to_string())).await;
    let (new_quote, new_status, new_lines) = open_quote(&ctx.pool, case.order_id).await;
    assert_ne!(new_quote, first_quote);
    assert_eq!(new_status, "draft");
    assert_eq!(new_lines.as_array().unwrap().len(), 2, "{new_lines:?}");
    let old_status: String = sqlx::query_scalar("SELECT status FROM quotes WHERE id = $1::uuid")
        .bind(&first_quote)
        .fetch_one(&ctx.pool)
        .await
        .unwrap();
    assert_eq!(old_status, "superseded");
    let (status, signed) = sign_on_paper(&ctx.app, &renewed, &ceo).await;
    assert!(status.is_success(), "{signed:?}");
    assert_eq!(open_quote(&ctx.pool, case.order_id).await.1, "accepted");
    let order = get_order(&ctx, &ceo, case.order_id).await;
    assert!(
        order["process_gates"]["estimate_outdated"].is_null(),
        "{:?}",
        order["process_gates"]
    );

    // The new quote counts the interim's hours; the final bills the transfer
    // with its discount only.
    let quote = get_quote(&ctx, &ceo, &new_quote).await;
    let hours_index = line_index_of(&quote, "Dolmetscherbetreuung");
    assert_eq!(
        money(&quote["line_items"][hours_index]["invoiced_quantity"]),
        Decimal::from(2),
        "{quote:?}"
    );
    let (status, final_invoice) =
        create_invoice(&ctx, &ceo, &new_quote, json!({ "invoice_type": "final" })).await;
    assert_eq!(status, StatusCode::CREATED, "{final_invoice:?}");
    let expected = gmed_server::money::line_amounts(
        Decimal::ONE,
        Decimal::from(200),
        Decimal::from(19),
        Decimal::from(10),
    )
    .gross;
    assert_eq!(
        money(&final_invoice["total_gross"]),
        expected,
        "{final_invoice:?}"
    );
    let final_id = final_invoice["id"].as_str().unwrap().to_string();
    // Guard: an invoice line never names a profile with another rate.
    let exempt: Uuid = sqlx::query_scalar(
        "SELECT id FROM tax_profiles WHERE vat_category <> 'pass_through' AND vat_rate = 0 AND is_active LIMIT 1",
    )
    .fetch_one(&ctx.pool)
    .await
    .unwrap();
    let result = sqlx::query(
        r#"UPDATE invoices
           SET line_items = jsonb_set(line_items, '{0,tax_profile_id}', to_jsonb($2::text))
           WHERE id = $1::uuid"#,
    )
    .bind(&final_id)
    .bind(exempt.to_string())
    .execute(&ctx.pool)
    .await;
    let error = result.expect_err("inconsistent profile was stored");
    assert!(
        error.to_string().contains("contradicts its tax profile"),
        "{error}"
    );
    let released = release_invoice(&ctx, &ceo, &final_id).await;
    assert_eq!(money(&released["balance_due"]), expected);
    assert!(interim_gross > Decimal::ZERO);
    let (status, xml) = raw_get(
        &ctx.app,
        &format!("/api/v1/invoices/{final_id}/zugferd.xml"),
        &ceo,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let interim_number: String =
        sqlx::query_scalar("SELECT invoice_number FROM invoices WHERE id = $1::uuid")
            .bind(&interim_id)
            .fetch_one(&ctx.pool)
            .await
            .unwrap();
    // The final names the interim issued from the superseded quote.
    assert!(
        String::from_utf8_lossy(&xml).contains(&interim_number),
        "{}",
        String::from_utf8_lossy(&xml)
    );
}

/// QA3 A S2-2 / D S2-1 and C S3-13: a delivered service outside the
/// estimate goes on an interim; the order line shows it billed, the
/// economics count its revenue (no «unassigned» warning), the final no
/// longer offers it and closes the order at 0 when nothing else is open;
/// the Storno of the interim gives the service back.
#[tokio::test]
async fn an_extra_line_billed_on_an_interim_is_billed_everywhere_and_the_final_closes() {
    let Some(ctx) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let ceo = bearer(ctx.admin_id, "ceo");
    let case =
        interpreter_case_with_tariff(&ctx, &ceo, 1, Some(Decimal::from(95)), Decimal::ZERO).await;
    report_hours(&ctx, &ceo, &case, 1.0, 1).await;
    let extra_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO order_leistungen (
               order_id, patient_id, description, quantity, unit_price, currency, vat_rate,
               status, delivered_at, approved_at
           ) VALUES ($1, $2, 'Zusatzbegleitung', 2, 80, 'EUR', 19, 'approved', now(), now())
           RETURNING id"#,
    )
    .bind(case.order_id)
    .bind(case.patient_id)
    .fetch_one(&ctx.pool)
    .await
    .unwrap();
    let (status, interim) = create_invoice(
        &ctx,
        &ceo,
        &case.quote_id,
        json!({
            "invoice_type": "interim",
            "line_items": [],
            "order_services": [{ "order_leistung_id": extra_id, "quantity": 2 }],
        }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{interim:?}");
    let interim_id = interim["id"].as_str().unwrap().to_string();
    release_invoice(&ctx, &ceo, &interim_id).await;
    assert_eq!(service_status(&ctx.pool, extra_id).await, "invoiced");

    let order = get_order(&ctx, &ceo, case.order_id).await;
    let line = order["leistungen"]
        .as_array()
        .unwrap()
        .iter()
        .find(|line| line["id"] == extra_id.to_string())
        .unwrap()
        .clone();
    assert_ne!(line["billing_status"], "not_invoiced", "{line:?}");
    assert_eq!(
        money(&line["invoiced_quantity"]),
        Decimal::from(2),
        "{line:?}"
    );
    assert_eq!(line["invoice_references"].as_array().unwrap().len(), 1);

    let (status, economics) = call(
        &ctx.app,
        "GET",
        &format!("/api/v1/orders/{}/economics", case.order_id),
        &ceo,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{economics:?}");
    let warnings = economics["warnings"]
        .as_array()
        .cloned()
        .unwrap_or_default();
    assert!(
        !warnings
            .iter()
            .any(|warning| warning == "unassigned_invoice_revenue"),
        "{economics:?}"
    );
    let service = economics["services"]
        .as_array()
        .unwrap()
        .iter()
        .find(|service| service["order_leistung_id"] == extra_id.to_string())
        .unwrap()
        .clone();
    assert_eq!(
        money(&service["actual_revenue_net"]),
        Decimal::from(160),
        "{service:?}"
    );

    // The hours go on a second interim; the final closes at 0.
    let (status, second) = create_invoice(
        &ctx,
        &ceo,
        &case.quote_id,
        json!({ "invoice_type": "interim", "line_items": [{ "line_index": 0, "quantity": 1 }] }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{second:?}");
    release_invoice(&ctx, &ceo, second["id"].as_str().unwrap()).await;
    let quote = get_quote(&ctx, &ceo, &case.quote_id).await;
    assert!(
        quote["delivered_services_outside_quote"]
            .as_array()
            .is_none_or(|extras| extras.is_empty()),
        "{quote:?}"
    );
    let (status, final_invoice) = create_invoice(
        &ctx,
        &ceo,
        &case.quote_id,
        json!({ "invoice_type": "final" }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{final_invoice:?}");
    assert_eq!(
        money(&final_invoice["total_gross"]),
        Decimal::ZERO,
        "{final_invoice:?}"
    );
    let (status, cancelled) = call(
        &ctx.app,
        "POST",
        &format!(
            "/api/v1/invoices/{}/status",
            final_invoice["id"].as_str().unwrap()
        ),
        &ceo,
        Some(json!({ "status": "cancelled" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{cancelled:?}");

    // The Storno of the first interim gives the service back.
    cancel_invoice(&ctx, &ceo, &interim_id).await;
    assert_ne!(service_status(&ctx.pool, extra_id).await, "invoiced");
    let order = get_order(&ctx, &ceo, case.order_id).await;
    let line = order["leistungen"]
        .as_array()
        .unwrap()
        .iter()
        .find(|line| line["id"] == extra_id.to_string())
        .unwrap()
        .clone();
    assert_eq!(line["billing_status"], "not_invoiced", "{line:?}");
}

/// QA3 B S1-2 / S1-3: a credit note that empties the 19 % category of a
/// final releases the paid advance share deducted there; the money is set
/// off against what the same final still asks (the pass-through cost), not
/// left refundable while the final is open. Its reversal restores the
/// set-off exactly.
#[tokio::test]
async fn a_credit_note_on_a_final_sets_released_advance_money_off_and_its_reversal_restores_it() {
    let Some(ctx) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let ceo = bearer(ctx.admin_id, "ceo");
    seed_agency(&ctx.pool, ctx.admin_id).await;
    let case =
        interpreter_case_with_tariff(&ctx, &ceo, 3, Some(Decimal::from(95)), Decimal::ZERO).await;
    let own = gross_of(Decimal::from(3), Decimal::from(95));
    let advance_id = paid_prepayment_advance(&ctx, &ceo, &case, own, own).await;
    report_hours(&ctx, &ceo, &case, 3.0, 1).await;
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
    let (status, invoice) = create_invoice(
        &ctx,
        &ceo,
        &case.quote_id,
        json!({
            "invoice_type": "final",
            "line_items": [{ "line_index": 0, "quantity": 3 }],
            "order_services": [{ "order_leistung_id": clinic_id, "quantity": 1 }],
        }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{invoice:?}");
    let final_id = invoice["id"].as_str().unwrap().to_string();
    let released = release_invoice(&ctx, &ceo, &final_id).await;
    assert_eq!(money(&released["prepayment_applied_amount"]), own);
    assert_eq!(money(&released["balance_due"]), Decimal::from(1000));
    let hours_line = invoice["line_items"]
        .as_array()
        .unwrap()
        .iter()
        .position(|line| line["description"] != "Klinik MRT")
        .unwrap();

    let (status, credit) = call(
        &ctx.app,
        "POST",
        &format!("/api/v1/invoices/{final_id}/credit-notes"),
        &ceo,
        Some(json!({
            "request_id": Uuid::new_v4(),
            "lines": [{ "line_index": hours_line }],
            "reason": "Stunden nicht erbracht",
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
    let after = invoice_detail(&ctx, &ceo, &final_id).await;
    assert_eq!(
        money(&after["balance_due"]),
        Decimal::from(1000) - own,
        "{after:?}"
    );
    let advance = invoice_detail(&ctx, &ceo, &advance_id).await;
    assert_eq!(
        money(&advance["refundable_cash_amount"]),
        Decimal::ZERO,
        "{advance:?}"
    );

    let (status, reversal) = call(
        &ctx.app,
        "POST",
        &format!("/api/v1/invoices/{final_id}/credit-notes/{credit_id}/reversal"),
        &ceo,
        Some(json!({ "reason": "Gutschrift irrtümlich" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{reversal:?}");
    let restored = invoice_detail(&ctx, &ceo, &final_id).await;
    assert_eq!(
        money(&restored["balance_due"]),
        Decimal::from(1000),
        "{restored:?}"
    );
    assert_eq!(money(&restored["prepayment_applied_amount"]), own);
    let advance = invoice_detail(&ctx, &ceo, &advance_id).await;
    assert_eq!(
        money(&advance["credited_amount"]),
        Decimal::ZERO,
        "{advance:?}"
    );
    assert_eq!(money(&advance["refundable_cash_amount"]), Decimal::ZERO);
}

/// QA3 B S2-1: the statement's «К оплате с учётом авансов и переплат»
/// subtracts the overpayment of the patient's own invoices.
#[tokio::test]
async fn the_statement_amount_to_pay_counts_overpayments() {
    let Some(ctx) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let ceo = bearer(ctx.admin_id, "ceo");
    seed_agency(&ctx.pool, ctx.admin_id).await;
    let case =
        interpreter_case_with_tariff(&ctx, &ceo, 3, Some(Decimal::from(95)), Decimal::ZERO).await;
    report_hours(&ctx, &ceo, &case, 3.0, 1).await;
    let (status, first) = create_invoice(
        &ctx,
        &ceo,
        &case.quote_id,
        json!({ "invoice_type": "interim", "line_items": [{ "line_index": 0, "quantity": 1 }] }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{first:?}");
    let first_id = first["id"].as_str().unwrap().to_string();
    release_invoice(&ctx, &ceo, &first_id).await;
    let one = money(&first["total_gross"]);
    let (status, paid) = call(
        &ctx.app,
        "POST",
        &format!("/api/v1/invoices/{first_id}/payments"),
        &ceo,
        Some(json!({
            "request_id": Uuid::new_v4(),
            "amount_gross": one.to_string(),
            "payment_method": "bank_transfer",
            "received_on": gmed_server::app_time::today().to_string(),
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{paid:?}");
    let (status, credit) = call(
        &ctx.app,
        "POST",
        &format!("/api/v1/invoices/{first_id}/credit-notes"),
        &ceo,
        Some(json!({
            "request_id": Uuid::new_v4(),
            "lines": [{ "line_index": 0 }],
            "reason": "Doppelt",
            "issued_on": gmed_server::app_time::today().to_string(),
            "portal_visible": true,
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{credit:?}");
    let (status, second) = create_invoice(
        &ctx,
        &ceo,
        &case.quote_id,
        json!({ "invoice_type": "interim", "line_items": [{ "line_index": 0, "quantity": 2 }] }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{second:?}");
    release_invoice(&ctx, &ceo, second["id"].as_str().unwrap()).await;
    let two = money(&second["total_gross"]);
    let (status, statement) = call(
        &ctx.app,
        "GET",
        &format!("/api/v1/patients/{}/account-statement", case.patient_id),
        &ceo,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{statement:?}");
    let summary = &statement["summary"];
    assert_eq!(money(&summary["credit_balance"]), one, "{summary:?}");
    assert_eq!(money(&summary["invoice_due"]), two, "{summary:?}");
    assert_eq!(money(&summary["amount_to_pay"]), two - one, "{summary:?}");
}
