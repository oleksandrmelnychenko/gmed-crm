//! Draft invoices are changed and deleted before their release (owner
//! 2026-11-14): lines rebuilt from the quote within the open quantities,
//! due date and remark, a manual split of a prepayment advance, and the
//! deletion that frees what the draft reserved. An advance smaller than the
//! quote covers GMED's own services first, then the pass-through costs.

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

async fn raw_request(
    app: &axum::Router,
    method: &str,
    path: &str,
    bearer: &str,
    body: Option<Value>,
) -> (StatusCode, Vec<u8>) {
    let body = match body {
        Some(value) => Body::from(serde_json::to_vec(&value).unwrap()),
        None => Body::empty(),
    };
    let request = Request::builder()
        .method(method)
        .uri(path)
        .header("Authorization", bearer)
        .header("Content-Type", "application/json")
        .body(body)
        .unwrap();
    let response = app.clone().oneshot(request).await.unwrap();
    let status = response.status();
    let bytes = axum::body::to_bytes(response.into_body(), 16 * 1024 * 1024)
        .await
        .unwrap();
    (status, bytes.to_vec())
}

async fn json_request(
    app: &axum::Router,
    method: &str,
    path: &str,
    bearer: &str,
    body: Option<Value>,
) -> (StatusCode, Value) {
    let (status, bytes) = raw_request(app, method, path, bearer, body).await;
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(json!(null)),
    )
}

fn bearer(user_id: Uuid, role: &str) -> String {
    let token = jwt::issue_access_token(TEST_SECRET, user_id, role, Uuid::new_v4()).unwrap();
    format!("Bearer {token}")
}

fn dec(value: &Value) -> Decimal {
    match value {
        Value::String(text) => text.parse().unwrap(),
        Value::Number(number) => number.to_string().parse().unwrap(),
        other => panic!("not a decimal: {other}"),
    }
}

async fn seed_user(pool: &PgPool, tag: &str, role: &str) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO users (email, password_hash, name, role)
           VALUES ($1, 'test-password-hash', $2, $3) RETURNING id"#,
    )
    .bind(format!("{tag}-{role}@example.com"))
    .bind(format!("{role} {tag}"))
    .bind(role)
    .fetch_one(pool)
    .await
    .unwrap()
}

/// A synthetic adult patient with a full postal address, so a release passes
/// the recipient check.
async fn seed_patient(pool: &PgPool, created_by: Uuid, tag: &str) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO patients (
                patient_id, first_name, last_name, birth_date, gender, created_by,
                address_street, address_zip, address_city, address_country
           ) VALUES ($1, $2, 'Muster', '1980-01-01', 'diverse', $3,
                     'Hauptstraße 1', '80331', 'München', 'Deutschland')
           RETURNING id"#,
    )
    .bind(format!("PT-{tag}"))
    .bind(format!("Test {tag}"))
    .bind(created_by)
    .fetch_one(pool)
    .await
    .unwrap()
}

/// An order cleared for billing with the given services
/// (description, quantity, unit price, VAT rate, pass-through).
async fn seed_order(
    pool: &PgPool,
    patient_id: Uuid,
    created_by: Uuid,
    tag: &str,
    services: &[(&str, i32, f64, f64, bool)],
) -> Uuid {
    let order_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO orders (order_number, patient_id, phase, status, created_by)
           VALUES ($1, $2, 'execution', 'active', $3)
           RETURNING id"#,
    )
    .bind(format!("ORD-{tag}"))
    .bind(patient_id)
    .bind(created_by)
    .fetch_one(pool)
    .await
    .unwrap();
    sqlx::query(
        r#"UPDATE orders
           SET package_coverage_status = 'not_covered',
               package_coverage_note = 'test package gate',
               package_coverage_decided_by = $2,
               package_coverage_decided_at = now()
           WHERE id = $1"#,
    )
    .bind(order_id)
    .bind(created_by)
    .execute(pool)
    .await
    .unwrap();
    // Quote lines follow the creation time of the services.
    for (position, (description, quantity, price, vat_rate, passthrough)) in
        services.iter().enumerate()
    {
        sqlx::query(
            r#"INSERT INTO order_leistungen (
                    order_id, description, quantity, unit_price, vat_rate,
                    is_cost_passthrough, status, created_at
               ) VALUES ($1, $2, $3, $4, $5, $6, 'approved',
                         now() - make_interval(mins => $7))"#,
        )
        .bind(order_id)
        .bind(*description)
        .bind(*quantity)
        .bind(*price)
        .bind(*vat_rate)
        .bind(*passthrough)
        .bind(i32::try_from(services.len() - position).unwrap())
        .execute(pool)
        .await
        .unwrap();
    }
    order_id
}

struct Fixture {
    app: axum::Router,
    pool: PgPool,
    billing: String,
    concierge: String,
    order_id: Uuid,
    quote_id: String,
}

async fn fixture(prefix: &str, services: &[(&str, i32, f64, f64, bool)]) -> Option<Fixture> {
    let ctx = support::suite_context(TEST_SECRET).await?;
    let tag = format!("{prefix}-{}", Uuid::new_v4().simple());
    let billing = bearer(seed_user(&ctx.pool, &tag, "billing").await, "billing");
    let manager = bearer(seed_user(&ctx.pool, &tag, "ceo").await, "ceo");
    let concierge = bearer(seed_user(&ctx.pool, &tag, "concierge").await, "concierge");
    let patient_id = seed_patient(&ctx.pool, ctx.admin_id, &tag).await;
    let order_id = seed_order(&ctx.pool, patient_id, ctx.admin_id, &tag, services).await;
    let (status, quote) = json_request(
        &ctx.app,
        "POST",
        &format!("/api/v1/orders/{order_id}/quotes"),
        &manager,
        Some(json!({ "notes": "draft test" })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{quote}");
    Some(Fixture {
        app: ctx.app,
        pool: ctx.pool,
        billing,
        concierge,
        order_id,
        quote_id: quote["id"].as_str().unwrap().to_string(),
    })
}

const SERVICES: &[(&str, i32, f64, f64, bool)] = &[
    ("Quartalsbetreuung", 2, 100.0, 19.0, false),
    ("Terminorganisation", 1, 50.0, 19.0, false),
];

async fn create_interim(fixture: &Fixture, line_items: Value) -> (StatusCode, Value) {
    json_request(
        &fixture.app,
        "POST",
        &format!("/api/v1/quotes/{}/invoices", fixture.quote_id),
        &fixture.billing,
        Some(json!({ "invoice_type": "interim", "line_items": line_items })),
    )
    .await
}

async fn put_draft(
    fixture: &Fixture,
    auth: &str,
    invoice_id: &str,
    body: Value,
) -> (StatusCode, Value) {
    json_request(
        &fixture.app,
        "PUT",
        &format!("/api/v1/invoices/{invoice_id}/draft"),
        auth,
        Some(body),
    )
    .await
}

async fn audit_count(pool: &PgPool, action: &str, invoice_id: &str) -> i64 {
    sqlx::query_scalar("SELECT COUNT(*) FROM audit_log WHERE action = $1 AND entity_id = $2::uuid")
        .bind(action)
        .bind(invoice_id)
        .fetch_one(pool)
        .await
        .unwrap()
}

#[tokio::test]
async fn a_draft_gets_new_lines_dates_and_remark_within_the_open_quote() {
    let Some(fixture) = fixture("draft-edit", SERVICES).await else {
        return;
    };
    let (status, invoice) =
        create_interim(&fixture, json!([{ "line_index": 0, "quantity": 1 }])).await;
    assert_eq!(status, StatusCode::CREATED, "{invoice}");
    let invoice_id = invoice["id"].as_str().unwrap().to_string();
    assert_eq!(dec(&invoice["total_gross"]), Decimal::new(119, 0));

    // The editor counts the draft's own quantity as open.
    let (status, editor) = json_request(
        &fixture.app,
        "GET",
        &format!("/api/v1/invoices/{invoice_id}/draft"),
        &fixture.billing,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{editor}");
    assert_eq!(editor["lines_mode"], "quote_positions", "{editor}");
    let lines = editor["quote_lines"].as_array().unwrap();
    assert_eq!(lines.len(), 2, "{editor}");
    assert_eq!(dec(&lines[0]["open_quantity"]), Decimal::new(2, 0));
    assert_eq!(dec(&lines[0]["selected_quantity"]), Decimal::ONE);
    assert_eq!(dec(&lines[1]["open_quantity"]), Decimal::ONE);
    assert!(lines[1]["selected_quantity"].is_null(), "{editor}");

    // Both quarters and the second service, a due date and a remark.
    let due_date = (gmed_server::app_time::today() + chrono::Days::new(21)).to_string();
    let (status, changed) = put_draft(
        &fixture,
        &fixture.billing,
        &invoice_id,
        json!({
            "due_date": due_date,
            "notes": "Bitte bis zum Fälligkeitstag überweisen",
            "line_items": [
                { "line_index": 0, "quantity": 2, "comment": "3. und 4. Quartal" },
                { "line_index": 1, "quantity": 1 }
            ]
        }),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{changed}");
    assert_eq!(changed["status"], "draft");
    assert!(changed["invoice_number"].is_null(), "{changed}");
    assert_eq!(dec(&changed["total_net"]), Decimal::new(250, 0));
    assert_eq!(dec(&changed["total_gross"]), Decimal::new(2975, 1));
    assert_eq!(changed["due_date"], due_date.as_str(), "{changed}");
    assert_eq!(changed["notes"], "Bitte bis zum Fälligkeitstag überweisen");
    assert_eq!(changed["line_items"][0]["comment"], "3. und 4. Quartal");
    let reserved: Decimal = sqlx::query_scalar(
        "SELECT COALESCE(SUM(quantity), 0) FROM invoice_order_line_allocations WHERE invoice_id = $1::uuid",
    )
    .bind(&invoice_id)
    .fetch_one(&fixture.pool)
    .await
    .unwrap();
    assert_eq!(reserved, Decimal::new(3, 0));
    assert_eq!(
        audit_count(&fixture.pool, "update_invoice_draft", &invoice_id).await,
        1
    );

    // The preview shows the new lines and the remark.
    let (status, pdf) = raw_request(
        &fixture.app,
        "GET",
        &format!("/api/v1/invoices/{invoice_id}/pdf"),
        &fixture.billing,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let text = pdf_extract::extract_text_from_mem(&pdf)
        .unwrap()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    assert!(text.contains("Terminorganisation"), "{text}");
    assert!(
        text.contains("Bitte bis zum Fälligkeitstag überweisen"),
        "{text}"
    );

    // Refused: more than is open, a due date in the past, no right.
    let (status, body) = put_draft(
        &fixture,
        &fixture.billing,
        &invoice_id,
        json!({ "line_items": [{ "line_index": 0, "quantity": 3 }] }),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{body}");
    let (status, body) = put_draft(
        &fixture,
        &fixture.billing,
        &invoice_id,
        json!({ "due_date": "2020-01-01" }),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
    let (status, _) = put_draft(&fixture, &fixture.concierge, &invoice_id, json!({})).await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    // Released, the invoice is no draft any more.
    let (status, released) = json_request(
        &fixture.app,
        "POST",
        &format!("/api/v1/invoices/{invoice_id}/status"),
        &fixture.billing,
        Some(json!({ "status": "sent" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{released}");
    let (status, body) = put_draft(&fixture, &fixture.billing, &invoice_id, json!({})).await;
    assert_eq!(status, StatusCode::CONFLICT, "{body}");
    assert_eq!(body["error"], "invoice_not_a_draft", "{body}");
}

#[tokio::test]
async fn deleting_a_draft_frees_its_quantities_and_never_touches_an_issued_invoice() {
    let Some(fixture) = fixture("draft-delete", SERVICES).await else {
        return;
    };
    let all_lines = json!([
        { "line_index": 0, "quantity": 2 },
        { "line_index": 1, "quantity": 1 }
    ]);
    let (status, draft) = create_interim(&fixture, all_lines.clone()).await;
    assert_eq!(status, StatusCode::CREATED, "{draft}");
    let draft_id = draft["id"].as_str().unwrap().to_string();

    // Concierge staff do not create invoices and do not delete them.
    let (status, _) = json_request(
        &fixture.app,
        "DELETE",
        &format!("/api/v1/invoices/{draft_id}"),
        &fixture.concierge,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    let (status, body) = json_request(
        &fixture.app,
        "DELETE",
        &format!("/api/v1/invoices/{draft_id}"),
        &fixture.billing,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["deleted"], true);
    let (stored_status, number): (String, Option<String>) =
        sqlx::query_as("SELECT status, invoice_number FROM invoices WHERE id = $1::uuid")
            .bind(&draft_id)
            .fetch_one(&fixture.pool)
            .await
            .unwrap();
    assert_eq!(stored_status, "cancelled");
    assert_eq!(number, None);
    assert_eq!(
        audit_count(&fixture.pool, "discard_invoice_draft", &draft_id).await,
        1
    );
    let storno: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM invoice_storno_documents WHERE invoice_id = $1::uuid",
    )
    .bind(&draft_id)
    .fetch_one(&fixture.pool)
    .await
    .unwrap();
    assert_eq!(storno, 0);

    // Out of the list, unless cancelled invoices are asked for.
    let (status, list) = json_request(
        &fixture.app,
        "GET",
        &format!("/api/v1/invoices?order_id={}", fixture.order_id),
        &fixture.billing,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{list}");
    assert!(
        list["items"]
            .as_array()
            .unwrap()
            .iter()
            .all(|row| row["id"] != draft_id.as_str()),
        "{list}"
    );
    let (status, list) = json_request(
        &fixture.app,
        "GET",
        &format!(
            "/api/v1/invoices?order_id={}&status=cancelled",
            fixture.order_id
        ),
        &fixture.billing,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{list}");
    assert!(
        list["items"]
            .as_array()
            .unwrap()
            .iter()
            .any(|row| row["id"] == draft_id.as_str()),
        "{list}"
    );

    // The quantities are free: the same lines go on a new invoice.
    let (status, again) = create_interim(&fixture, all_lines).await;
    assert_eq!(status, StatusCode::CREATED, "{again}");
    let again_id = again["id"].as_str().unwrap().to_string();

    // A deleted draft is not deleted twice; an issued invoice never.
    let (status, body) = json_request(
        &fixture.app,
        "DELETE",
        &format!("/api/v1/invoices/{draft_id}"),
        &fixture.billing,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{body}");
    let (status, released) = json_request(
        &fixture.app,
        "POST",
        &format!("/api/v1/invoices/{again_id}/status"),
        &fixture.billing,
        Some(json!({ "status": "sent" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{released}");
    let (status, body) = json_request(
        &fixture.app,
        "DELETE",
        &format!("/api/v1/invoices/{again_id}"),
        &fixture.billing,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{body}");
    assert_eq!(body["error"], "invoice_not_a_draft", "{body}");
    let still: String = sqlx::query_scalar("SELECT status FROM invoices WHERE id = $1::uuid")
        .bind(&again_id)
        .fetch_one(&fixture.pool)
        .await
        .unwrap();
    assert_eq!(still, "sent");
}

fn advance_line(invoice: &Value, passthrough: bool) -> Option<Value> {
    invoice["line_items"]
        .as_array()
        .unwrap()
        .iter()
        .find(|line| line["is_cost_passthrough"] == passthrough)
        .cloned()
}

#[tokio::test]
async fn an_advance_covers_own_services_first_and_can_be_split_by_hand() {
    // 100 + 19 % VAT of own service (119 gross) and 300 of clinic costs
    // passed through; the order asks for a prepayment of 200.
    let services: &[(&str, i32, f64, f64, bool)] = &[
        ("Dolmetscher", 1, 100.0, 19.0, false),
        ("Klinikrechnung", 1, 300.0, 0.0, true),
    ];
    let Some(fixture) = fixture("draft-advance", services).await else {
        return;
    };
    sqlx::query(
        "UPDATE orders SET prepayment_required = true, prepayment_amount = 200 WHERE id = $1",
    )
    .bind(fixture.order_id)
    .execute(&fixture.pool)
    .await
    .unwrap();
    let (status, advance) = json_request(
        &fixture.app,
        "POST",
        &format!("/api/v1/quotes/{}/invoices", fixture.quote_id),
        &fixture.billing,
        Some(json!({ "invoice_type": "advance", "advance_basis": "prepayment" })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{advance}");
    let advance_id = advance["id"].as_str().unwrap().to_string();

    // Default: the own service in full with its VAT, the rest to the costs.
    assert_eq!(dec(&advance["total_gross"]), Decimal::new(200, 0));
    let own = advance_line(&advance, false).expect("own service line");
    assert_eq!(dec(&own["line_gross"]), Decimal::new(119, 0), "{advance}");
    assert_eq!(dec(&own["line_vat"]), Decimal::new(19, 0), "{advance}");
    let costs = advance_line(&advance, true).expect("pass-through line");
    assert_eq!(dec(&costs["line_gross"]), Decimal::new(81, 0), "{advance}");
    assert_eq!(dec(&costs["line_vat"]), Decimal::ZERO, "{advance}");

    let (status, editor) = json_request(
        &fixture.app,
        "GET",
        &format!("/api/v1/invoices/{advance_id}/draft"),
        &fixture.billing,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{editor}");
    assert_eq!(editor["lines_mode"], "advance_split", "{editor}");
    assert_eq!(
        editor["advance"]["groups"].as_array().unwrap().len(),
        2,
        "{editor}"
    );

    // By hand: 50 to the own service, 150 to the costs.
    let (status, split) = put_draft(
        &fixture,
        &fixture.billing,
        &advance_id,
        json!({
            "advance_split": [
                { "is_cost_passthrough": false, "vat_rate": "19", "amount_gross": "50" },
                { "is_cost_passthrough": true, "vat_rate": "0", "amount_gross": "150" }
            ]
        }),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{split}");
    assert_eq!(dec(&split["total_gross"]), Decimal::new(200, 0));
    assert_eq!(dec(&split["total_vat"]), Decimal::new(798, 2), "{split}");
    let own = advance_line(&split, false).unwrap();
    assert_eq!(dec(&own["line_net"]), Decimal::new(4202, 2), "{split}");
    assert_eq!(own["advance_allocation"], "manual", "{split}");
    assert_eq!(
        dec(&advance_line(&split, true).unwrap()["line_gross"]),
        Decimal::new(150, 0)
    );

    // Refused: shares not adding up, more than the group has open, quote lines.
    for split in [
        json!([
            { "is_cost_passthrough": false, "vat_rate": "19", "amount_gross": "49" },
            { "is_cost_passthrough": true, "vat_rate": "0", "amount_gross": "150" }
        ]),
        json!([
            { "is_cost_passthrough": false, "vat_rate": "19", "amount_gross": "150" },
            { "is_cost_passthrough": true, "vat_rate": "0", "amount_gross": "50" }
        ]),
    ] {
        let (status, body) = put_draft(
            &fixture,
            &fixture.billing,
            &advance_id,
            json!({ "advance_split": split }),
        )
        .await;
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
    }
    let (status, body) = put_draft(
        &fixture,
        &fixture.billing,
        &advance_id,
        json!({ "line_items": [{ "line_index": 0, "quantity": 1 }] }),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{body}");
    assert_eq!(body["error"], "invoice_draft_lines_locked", "{body}");
}

/// QA 2026-11-15 A-1: 3 x 33,33 EUR (99,99 net / 118,99 gross) billed as
/// 2,5 h and 0,5 h was 83,33 + 16,67 = 100,00 net. The part completing the
/// line takes exactly its rest, so the parts add up to the quote line.
#[tokio::test]
async fn parts_of_a_quote_line_add_up_to_the_line_to_the_cent() {
    let Some(fixture) = fixture(
        "draft-parts",
        &[("Dolmetscher Stunde", 3, 33.33, 19.0, false)],
    )
    .await
    else {
        return;
    };
    let (status, first) =
        create_interim(&fixture, json!([{ "line_index": 0, "quantity": "2.5" }])).await;
    assert_eq!(status, StatusCode::CREATED, "{first}");
    assert_eq!(
        dec(&first["total_net"]),
        "83.33".parse::<Decimal>().unwrap()
    );
    assert_eq!(
        dec(&first["total_gross"]),
        "99.16".parse::<Decimal>().unwrap()
    );
    let first_id = first["id"].as_str().unwrap().to_string();

    let (status, last) =
        create_interim(&fixture, json!([{ "line_index": 0, "quantity": "0.5" }])).await;
    assert_eq!(status, StatusCode::CREATED, "{last}");
    assert_eq!(dec(&last["total_net"]), "16.66".parse::<Decimal>().unwrap());
    assert_eq!(dec(&last["total_vat"]), "3.17".parse::<Decimal>().unwrap());
    assert_eq!(
        dec(&last["total_gross"]),
        "19.83".parse::<Decimal>().unwrap()
    );
    let last_id = last["id"].as_str().unwrap().to_string();

    // The editor of the last part offers what the server bills.
    let (status, editor) = json_request(
        &fixture.app,
        "GET",
        &format!("/api/v1/invoices/{last_id}/draft"),
        &fixture.billing,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{editor}");
    let line = &editor["quote_lines"][0];
    assert_eq!(
        dec(&line["billed_quantity"]),
        "2.5".parse::<Decimal>().unwrap()
    );
    assert_eq!(
        dec(&line["billed_net"]),
        "83.33".parse::<Decimal>().unwrap()
    );
    assert_eq!(
        dec(&line["line_gross"]),
        "118.99".parse::<Decimal>().unwrap()
    );

    // Rebuilding the first part with the whole line is refused while the
    // last part holds its quantity; rebuilt to 2,5 it stays 83,33.
    let (status, rebuilt) = put_draft(
        &fixture,
        &fixture.billing,
        &first_id,
        json!({ "due_date": null, "notes": null, "line_items": [{ "line_index": 0, "quantity": "2.5" }] }),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{rebuilt}");
    assert_eq!(
        dec(&rebuilt["total_net"]),
        "83.33".parse::<Decimal>().unwrap()
    );

    let (billed_net, billed_gross): (Decimal, Decimal) = sqlx::query_as(
        r#"SELECT SUM(amount_net_snapshot), SUM(amount_gross_snapshot)
           FROM invoice_order_line_allocations
           WHERE invoice_id IN ($1::uuid, $2::uuid)"#,
    )
    .bind(&first_id)
    .bind(&last_id)
    .fetch_one(&fixture.pool)
    .await
    .unwrap();
    assert_eq!(billed_net, "99.99".parse::<Decimal>().unwrap());
    assert_eq!(billed_gross, "118.99".parse::<Decimal>().unwrap());
}

/// QA 2026-11-15 A-6: a second issue request (double click, parallel calls)
/// changes nothing and writes no second audit row; lines sent to the status
/// endpoint are refused instead of ignored.
#[tokio::test]
async fn a_repeated_issue_request_writes_one_audit_row_and_lines_are_refused() {
    let Some(fixture) = fixture("draft-issue-twice", SERVICES).await else {
        return;
    };
    let (status, draft) =
        create_interim(&fixture, json!([{ "line_index": 0, "quantity": 1 }])).await;
    assert_eq!(status, StatusCode::CREATED, "{draft}");
    let invoice_id = draft["id"].as_str().unwrap().to_string();
    let path = format!("/api/v1/invoices/{invoice_id}/status");

    let (status, body) = json_request(
        &fixture.app,
        "POST",
        &path,
        &fixture.billing,
        Some(json!({ "status": "sent", "line_items": [{ "line_index": 0, "quantity": 2 }] })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");

    let issue = || {
        json_request(
            &fixture.app,
            "POST",
            &path,
            &fixture.billing,
            Some(json!({ "status": "sent" })),
        )
    };
    let ((first_status, first), (second_status, second), (third_status, _)) =
        tokio::join!(issue(), issue(), issue());
    assert_eq!(first_status, StatusCode::OK, "{first}");
    assert_eq!(second_status, StatusCode::OK, "{second}");
    assert_eq!(third_status, StatusCode::OK);
    assert_eq!(first["invoice_number"], second["invoice_number"]);
    assert_eq!(
        audit_count(&fixture.pool, "update_invoice_status", &invoice_id).await,
        1
    );

    let updated_at: chrono::DateTime<chrono::Utc> =
        sqlx::query_scalar("SELECT updated_at FROM invoices WHERE id = $1::uuid")
            .bind(&invoice_id)
            .fetch_one(&fixture.pool)
            .await
            .unwrap();
    let (status, body) = json_request(
        &fixture.app,
        "POST",
        &path,
        &fixture.billing,
        Some(json!({ "status": "sent", "line_items": [{ "line_index": 0, "quantity": 2 }] })),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{body}");
    let after: chrono::DateTime<chrono::Utc> =
        sqlx::query_scalar("SELECT updated_at FROM invoices WHERE id = $1::uuid")
            .bind(&invoice_id)
            .fetch_one(&fixture.pool)
            .await
            .unwrap();
    assert_eq!(after, updated_at);
    assert_eq!(
        audit_count(&fixture.pool, "update_invoice_status", &invoice_id).await,
        1
    );
}

// Money received before the invoice and the service period (owner 2026-11-17).

fn berlin_today() -> chrono::NaiveDate {
    gmed_server::app_time::today()
}

fn day_text(day: chrono::NaiveDate) -> String {
    day.format("%d.%m.%Y").to_string()
}

async fn set_order_period(fixture: &Fixture, from: &str, to: &str) {
    sqlx::query("UPDATE orders SET date_from = $2::date, date_to = $3::date WHERE id = $1")
        .bind(fixture.order_id)
        .bind(from)
        .bind(to)
        .execute(&fixture.pool)
        .await
        .unwrap();
}

async fn create_invoice(fixture: &Fixture, auth: &str, body: Value) -> (StatusCode, Value) {
    json_request(
        &fixture.app,
        "POST",
        &format!("/api/v1/quotes/{}/invoices", fixture.quote_id),
        auth,
        Some(body),
    )
    .await
}

async fn issue(
    fixture: &Fixture,
    auth: &str,
    invoice_id: &str,
    extra: Value,
) -> (StatusCode, Value) {
    let mut body = json!({ "status": "sent" });
    if let (Some(body), Some(extra)) = (body.as_object_mut(), extra.as_object()) {
        for (key, value) in extra {
            body.insert(key.clone(), value.clone());
        }
    }
    json_request(
        &fixture.app,
        "POST",
        &format!("/api/v1/invoices/{invoice_id}/status"),
        auth,
        Some(body),
    )
    .await
}

async fn pdf_text(fixture: &Fixture, invoice_id: &str) -> String {
    let (status, bytes) = raw_request(
        &fixture.app,
        "GET",
        &format!("/api/v1/invoices/{invoice_id}/pdf"),
        &fixture.billing,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    pdf_extract::extract_text_from_mem(&bytes).unwrap()
}

async fn payments(fixture: &Fixture, invoice_id: &str) -> Vec<Value> {
    let (status, body) = json_request(
        &fixture.app,
        "GET",
        &format!("/api/v1/invoices/{invoice_id}/payments"),
        &fixture.billing,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    body["items"].as_array().cloned().unwrap_or_default()
}

#[tokio::test]
async fn money_received_before_the_invoice_is_recorded_with_its_day_on_issue() {
    let Some(fixture) = fixture("received-full", SERVICES).await else {
        return;
    };
    set_order_period(&fixture, "2026-11-20", "2026-11-25").await;
    let received_on = berlin_today() - chrono::Days::new(2);
    let (status, draft) = create_invoice(
        &fixture,
        &fixture.billing,
        json!({
            "invoice_type": "advance",
            "advance_basis": "positions",
            "line_items": [{ "line_index": 0, "quantity": 2 }],
            "payment_received": {
                "received_on": received_on.to_string(),
                "payment_method": "bank_transfer"
            }
        }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{draft}");
    let invoice_id = draft["id"].as_str().unwrap().to_string();
    // Without an amount: left open, the release takes what is due then.
    assert!(
        draft["payment_received"]["amount_gross"].is_null(),
        "{draft}"
    );
    assert_eq!(draft["status"], "draft");
    assert!(payments(&fixture, &invoice_id).await.is_empty());

    let (status, issued) = issue(&fixture, &fixture.billing, &invoice_id, json!({})).await;
    assert_eq!(status, StatusCode::OK, "{issued}");
    assert_eq!(issued["status"], "paid", "{issued}");
    let recorded = payments(&fixture, &invoice_id).await;
    assert_eq!(recorded.len(), 1, "{recorded:?}");
    assert_eq!(recorded[0]["received_on"], received_on.to_string());
    assert_eq!(
        dec(&recorded[0]["amount_gross"]),
        dec(&draft["total_gross"])
    );
    let linked: Option<Uuid> = sqlx::query_scalar(
        "SELECT payment_received_transaction_id FROM invoices WHERE id = $1::uuid",
    )
    .bind(&invoice_id)
    .fetch_one(&fixture.pool)
    .await
    .unwrap();
    assert!(linked.is_some());
    assert_eq!(
        audit_count(&fixture.pool, "payment_recorded", &invoice_id).await,
        1
    );

    let text = pdf_text(&fixture, &invoice_id).await;
    assert!(text.contains("Zahlung erhalten am"), "{text}");
    assert!(text.contains(&day_text(received_on)), "{text}");
    assert!(text.contains("Bereits bezahlt"), "{text}");
    let due = day_text(berlin_today() + chrono::Days::new(14));
    assert!(!text.contains(&due), "{text}");
    assert!(text.contains("Voraussichtlicher"), "{text}");
    assert!(
        text.contains("20.11.2026") && text.contains("25.11.2026"),
        "{text}"
    );

    // The issued terms never change (GoBD).
    let changed = sqlx::query(
        "UPDATE invoices SET payment_received_on = payment_received_on - 1 WHERE id = $1::uuid",
    )
    .bind(&invoice_id)
    .execute(&fixture.pool)
    .await;
    assert!(changed.is_err());
}

#[tokio::test]
async fn a_part_payment_before_the_invoice_leaves_it_partly_paid() {
    let Some(fixture) = fixture("received-part", SERVICES).await else {
        return;
    };
    let received_on = berlin_today();
    let (status, draft) =
        create_interim(&fixture, json!([{ "line_index": 0, "quantity": 2 }])).await;
    assert_eq!(status, StatusCode::CREATED, "{draft}");
    let invoice_id = draft["id"].as_str().unwrap().to_string();
    let (status, body) = put_draft(
        &fixture,
        &fixture.billing,
        &invoice_id,
        json!({
            "payment_received": {
                "received_on": received_on.to_string(),
                "amount_gross": "100.00",
                "payment_method": "cash"
            }
        }),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let (status, issued) = issue(&fixture, &fixture.billing, &invoice_id, json!({})).await;
    assert_eq!(status, StatusCode::OK, "{issued}");
    assert_eq!(issued["status"], "partially_paid", "{issued}");
    let text = pdf_text(&fixture, &invoice_id).await;
    assert!(text.contains("Zahlung erhalten am"), "{text}");
    assert!(text.contains("100,00"), "{text}");
    assert!(
        text.contains(&day_text(berlin_today() + chrono::Days::new(14))),
        "{text}"
    );
    assert!(!text.contains("Bereits bezahlt"), "{text}");
}

#[tokio::test]
async fn without_a_received_payment_the_release_records_none_and_sets_the_term() {
    let Some(fixture) = fixture("received-none", SERVICES).await else {
        return;
    };
    let (status, draft) =
        create_interim(&fixture, json!([{ "line_index": 0, "quantity": 1 }])).await;
    assert_eq!(status, StatusCode::CREATED, "{draft}");
    assert!(draft["due_date"].is_null(), "{draft}");
    let invoice_id = draft["id"].as_str().unwrap().to_string();
    let (status, issued) = issue(&fixture, &fixture.billing, &invoice_id, json!({})).await;
    assert_eq!(status, StatusCode::OK, "{issued}");
    assert_eq!(issued["status"], "sent");
    assert!(issued["payment_received"].is_null());
    assert!(payments(&fixture, &invoice_id).await.is_empty());
    // No due date on the draft: invoice date + 14 days at the release.
    assert_eq!(
        issued["due_date"],
        (berlin_today() + chrono::Days::new(14)).to_string()
    );
    let text = pdf_text(&fixture, &invoice_id).await;
    assert!(!text.contains("Zahlung erhalten am"), "{text}");

    // A typed due date stays as typed.
    let typed = berlin_today() + chrono::Days::new(3);
    let (status, draft) =
        create_interim(&fixture, json!([{ "line_index": 1, "quantity": 1 }])).await;
    assert_eq!(status, StatusCode::CREATED, "{draft}");
    let invoice_id = draft["id"].as_str().unwrap().to_string();
    let (status, body) = put_draft(
        &fixture,
        &fixture.billing,
        &invoice_id,
        json!({ "due_date": typed.to_string() }),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let (status, issued) = issue(&fixture, &fixture.billing, &invoice_id, json!({})).await;
    assert_eq!(status, StatusCode::OK, "{issued}");
    assert_eq!(issued["due_date"], typed.to_string());
}

#[tokio::test]
async fn only_billing_notes_a_received_payment_and_issues_the_draft() {
    let Some(fixture) = fixture("received-roles", SERVICES).await else {
        return;
    };
    let manager_id = seed_user(
        &fixture.pool,
        &format!("pm-{}", Uuid::new_v4().simple()),
        "patient_manager",
    )
    .await;
    let manager = bearer(manager_id, "patient_manager");
    sqlx::query(
        r#"INSERT INTO patient_assignments (patient_id, user_id, assigned_by)
           SELECT patient_id, $2, $2 FROM orders WHERE id = $1"#,
    )
    .bind(fixture.order_id)
    .bind(manager_id)
    .execute(&fixture.pool)
    .await
    .unwrap();
    let received = json!({
        "received_on": berlin_today().to_string(),
        "payment_method": "bank_transfer"
    });

    let (status, body) = create_invoice(
        &fixture,
        &manager,
        json!({
            "invoice_type": "interim",
            "line_items": [{ "line_index": 0, "quantity": 1 }],
            "payment_received": received
        }),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN, "{body}");

    let (status, draft) = create_invoice(
        &fixture,
        &manager,
        json!({ "invoice_type": "interim", "line_items": [{ "line_index": 0, "quantity": 1 }] }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{draft}");
    let invoice_id = draft["id"].as_str().unwrap().to_string();
    let (status, body) = put_draft(
        &fixture,
        &manager,
        &invoice_id,
        json!({ "payment_received": received }),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN, "{body}");
    let (status, body) = put_draft(
        &fixture,
        &fixture.billing,
        &invoice_id,
        json!({ "payment_received": received }),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    // The manager's draft keeps what billing noted.
    let (status, body) = put_draft(
        &fixture,
        &manager,
        &invoice_id,
        json!({ "notes": "Bitte überweisen" }),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert!(!body["payment_received"].is_null(), "{body}");
    let (status, body) = put_draft(
        &fixture,
        &manager,
        &invoice_id,
        json!({ "payment_received": null }),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN, "{body}");

    let (status, body) = issue(&fixture, &manager, &invoice_id, json!({})).await;
    assert_eq!(status, StatusCode::FORBIDDEN, "{body}");
    let (status, issued) = issue(&fixture, &fixture.billing, &invoice_id, json!({})).await;
    assert_eq!(status, StatusCode::OK, "{issued}");
    assert_eq!(issued["status"], "paid", "{issued}");
}

#[tokio::test]
async fn a_future_payment_day_is_refused_and_an_excess_needs_confirmation() {
    let Some(fixture) = fixture("received-checks", SERVICES).await else {
        return;
    };
    let tomorrow = berlin_today() + chrono::Days::new(1);
    let (status, body) = create_invoice(
        &fixture,
        &fixture.billing,
        json!({
            "invoice_type": "interim",
            "line_items": [{ "line_index": 0, "quantity": 1 }],
            "payment_received": { "received_on": tomorrow.to_string(), "payment_method": "cash" }
        }),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
    let (status, draft) =
        create_interim(&fixture, json!([{ "line_index": 0, "quantity": 1 }])).await;
    assert_eq!(status, StatusCode::CREATED, "{draft}");
    let invoice_id = draft["id"].as_str().unwrap().to_string();
    for method in ["crypto", "legacy_import"] {
        let (status, body) = put_draft(
            &fixture,
            &fixture.billing,
            &invoice_id,
            json!({ "payment_received": {
                "received_on": berlin_today().to_string(),
                "payment_method": method
            } }),
        )
        .await;
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
    }
    let (status, body) = put_draft(
        &fixture,
        &fixture.billing,
        &invoice_id,
        json!({ "payment_received": { "received_on": tomorrow.to_string(), "payment_method": "cash" } }),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");

    // More than the invoice asks: the release asks to confirm the excess.
    let (status, body) = put_draft(
        &fixture,
        &fixture.billing,
        &invoice_id,
        json!({ "payment_received": {
            "received_on": berlin_today().to_string(),
            "amount_gross": "1000.00",
            "payment_method": "bank_transfer"
        } }),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let (status, body) = issue(&fixture, &fixture.billing, &invoice_id, json!({})).await;
    assert_eq!(status, StatusCode::CONFLICT, "{body}");
    assert_eq!(body["error"], "payment_exceeds_balance");
    assert_eq!(body["confirm_field"], "confirm_overpayment");
    let released: bool =
        sqlx::query_scalar("SELECT released_at IS NOT NULL FROM invoices WHERE id = $1::uuid")
            .bind(&invoice_id)
            .fetch_one(&fixture.pool)
            .await
            .unwrap();
    assert!(!released, "a refused release issues nothing");
    let (status, issued) = issue(
        &fixture,
        &fixture.billing,
        &invoice_id,
        json!({ "confirm_overpayment": true }),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{issued}");
    assert_eq!(issued["status"], "paid", "{issued}");

    // The issued document adds up (QA verify2 B-1): the invoice takes its
    // amount, the excess is printed as credit; the XML states the same.
    let total = dec(&issued["total_gross"]);
    let excess = Decimal::new(1000, 0) - total;
    let text = pdf_text(&fixture, &invoice_id).await;
    assert!(text.contains("Überzahlung (Guthaben)"), "{text}");
    assert!(text.contains(&german_money(excess)), "{text}");
    assert!(text.contains("1.000,00 €"), "{text}");
    assert!(text.contains("Bereits bezahlt"), "{text}");
    let xml = zugferd_xml(&fixture, &invoice_id).await;
    assert!(
        xml.contains(&format!(
            "<ram:TotalPrepaidAmount>{total:.2}</ram:TotalPrepaidAmount><ram:DuePayableAmount>0.00</ram:DuePayableAmount>"
        )),
        "{xml}"
    );
    assert!(
        xml.contains(&format!(
            "Zahlung erhalten am {}: 1.000,00 €; auf die Rechnung angerechnet {}; Überzahlung (Guthaben) {}",
            day_text(berlin_today()),
            german_money(total),
            german_money(excess)
        )),
        "{xml}"
    );

    // QA verify2 B-3: the patient list shows the balance of the card header
    // (the account statement nets the overpayment credit).
    let (patient_id, pid): (Uuid, String) = sqlx::query_as(
        r#"SELECT p.id, p.patient_id FROM orders o JOIN patients p ON p.id = o.patient_id
           WHERE o.id = $1"#,
    )
    .bind(fixture.order_id)
    .fetch_one(&fixture.pool)
    .await
    .unwrap();
    let (status, statement) = json_request(
        &fixture.app,
        "GET",
        &format!("/api/v1/patients/{patient_id}/account-statement"),
        &fixture.billing,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{statement}");
    let closing = dec(&statement["summary"]["closing_balance"]);
    assert_eq!(closing, -excess, "{statement}");
    let (status, list) = json_request(
        &fixture.app,
        "GET",
        &format!("/api/v1/patients?search={pid}&active_only=false"),
        &fixture.billing,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{list}");
    let row = list
        .as_array()
        .unwrap()
        .iter()
        .find(|row| row["id"] == patient_id.to_string())
        .unwrap_or_else(|| panic!("patient not listed: {list}"));
    assert_eq!(dec(&row["account_balance"]), closing, "{row}");
    assert_eq!(row["account_balance_side"], "credit", "{row}");
    assert_eq!(
        row["account_balance_summary"]["closing_balance"],
        statement["summary"]["closing_balance"]
    );
}

/// «1.234,50 €»
fn german_money(value: Decimal) -> String {
    let text = format!("{:.2}", gmed_server::money::round_cents(value));
    let (whole, cents) = text.split_once('.').unwrap();
    let mut grouped = String::new();
    for (index, digit) in whole.chars().enumerate() {
        if index > 0 && (whole.len() - index) % 3 == 0 {
            grouped.push('.');
        }
        grouped.push(digit);
    }
    format!("{grouped},{cents} €")
}

async fn zugferd_xml(fixture: &Fixture, invoice_id: &str) -> String {
    let (status, bytes) = raw_request(
        &fixture.app,
        "GET",
        &format!("/api/v1/invoices/{invoice_id}/zugferd.xml"),
        &fixture.billing,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    String::from_utf8(bytes.to_vec()).unwrap()
}

/// QA verify2 B-2: «Оплата уже поступила» without an amount on a final that
/// deducts an advance records what is left to pay after the advance, not the
/// gross total — no overpayment question, no credit that was never paid.
#[tokio::test]
async fn an_open_received_amount_is_what_the_final_leaves_after_its_advance() {
    let Some(fixture) = fixture("received-default", SERVICES).await else {
        return;
    };
    let (status, advance) = create_invoice(
        &fixture,
        &fixture.billing,
        json!({
            "invoice_type": "advance",
            "advance_basis": "positions",
            "line_items": [{ "line_index": 0, "quantity": 1 }]
        }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{advance}");
    let advance_id = advance["id"].as_str().unwrap().to_string();
    let (status, body) = issue(&fixture, &fixture.billing, &advance_id, json!({})).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let advance_gross = dec(&advance["total_gross"]);
    let (status, body) = json_request(
        &fixture.app,
        "POST",
        &format!("/api/v1/invoices/{advance_id}/payments"),
        &fixture.billing,
        Some(json!({
            "request_id": Uuid::new_v4(),
            "amount_gross": advance_gross.to_string(),
            "payment_method": "bank_transfer",
            "received_on": berlin_today().to_string()
        })),
    )
    .await;
    assert!(status.is_success(), "{body}");

    let (status, draft) = create_invoice(
        &fixture,
        &fixture.billing,
        json!({
            "invoice_type": "final",
            "payment_received": {
                "received_on": berlin_today().to_string(),
                "payment_method": "cash"
            }
        }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{draft}");
    // Left open on the draft: resolved by the release.
    assert!(
        draft["payment_received"]["amount_gross"].is_null(),
        "{draft}"
    );
    let invoice_id = draft["id"].as_str().unwrap().to_string();
    let total = dec(&draft["total_gross"]);

    // No confirmation needed: nothing is overpaid.
    let (status, issued) = issue(&fixture, &fixture.billing, &invoice_id, json!({})).await;
    assert_eq!(status, StatusCode::OK, "{issued}");
    assert_eq!(issued["status"], "paid", "{issued}");
    let recorded = payments(&fixture, &invoice_id).await;
    assert_eq!(recorded.len(), 1, "{recorded:?}");
    assert_eq!(dec(&recorded[0]["amount_gross"]), total - advance_gross);
    let stored: Option<Decimal> =
        sqlx::query_scalar("SELECT payment_received_amount FROM invoices WHERE id = $1::uuid")
            .bind(&invoice_id)
            .fetch_one(&fixture.pool)
            .await
            .unwrap();
    assert_eq!(stored, Some(total - advance_gross));
    let text = pdf_text(&fixture, &invoice_id).await;
    assert!(!text.contains("Überzahlung"), "{text}");
    assert!(
        text.contains(&german_money(total - advance_gross)),
        "{text}"
    );
    // The amount is fixed now (GoBD).
    let changed = sqlx::query(
        "UPDATE invoices SET payment_received_amount = payment_received_amount + 1 WHERE id = $1::uuid",
    )
    .bind(&invoice_id)
    .execute(&fixture.pool)
    .await;
    assert!(changed.is_err());
}

/// An advance that covers the whole final: nothing is due, so the release of
/// a final noting an open received amount records no payment and the
/// invoice states none.
#[tokio::test]
async fn an_open_received_amount_with_nothing_due_records_no_payment() {
    let Some(fixture) = fixture(
        "received-nothing-due",
        &[("Quartalsbetreuung", 1, 100.0, 19.0, false)],
    )
    .await
    else {
        return;
    };
    let (status, advance) = create_invoice(
        &fixture,
        &fixture.billing,
        json!({
            "invoice_type": "advance",
            "advance_basis": "positions",
            "line_items": [{ "line_index": 0, "quantity": 1 }]
        }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{advance}");
    let advance_id = advance["id"].as_str().unwrap().to_string();
    let (status, body) = issue(&fixture, &fixture.billing, &advance_id, json!({})).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let (status, body) = json_request(
        &fixture.app,
        "POST",
        &format!("/api/v1/invoices/{advance_id}/payments"),
        &fixture.billing,
        Some(json!({
            "request_id": Uuid::new_v4(),
            "amount_gross": dec(&advance["total_gross"]).to_string(),
            "payment_method": "bank_transfer",
            "received_on": berlin_today().to_string()
        })),
    )
    .await;
    assert!(status.is_success(), "{body}");
    let (status, draft) = create_invoice(
        &fixture,
        &fixture.billing,
        json!({
            "invoice_type": "final",
            "payment_received": {
                "received_on": berlin_today().to_string(),
                "payment_method": "cash"
            }
        }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{draft}");
    let invoice_id = draft["id"].as_str().unwrap().to_string();
    let (status, issued) = issue(&fixture, &fixture.billing, &invoice_id, json!({})).await;
    assert_eq!(status, StatusCode::OK, "{issued}");
    assert!(payments(&fixture, &invoice_id).await.is_empty());
    assert!(issued["payment_received"].is_null(), "{issued}");
    let text = pdf_text(&fixture, &invoice_id).await;
    assert!(!text.contains("Zahlung erhalten am"), "{text}");
}

#[tokio::test]
async fn the_service_period_comes_from_the_order_and_can_be_set_on_the_draft() {
    let Some(fixture) = fixture("service-period", SERVICES).await else {
        return;
    };
    set_order_period(&fixture, "2026-11-20", "2026-11-25").await;
    let (status, draft) = create_invoice(
        &fixture,
        &fixture.billing,
        json!({
            "invoice_type": "advance",
            "advance_basis": "positions",
            "line_items": [{ "line_index": 1, "quantity": 1 }]
        }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{draft}");
    let invoice_id = draft["id"].as_str().unwrap().to_string();
    let (status, editor) = json_request(
        &fixture.app,
        "GET",
        &format!("/api/v1/invoices/{invoice_id}/draft"),
        &fixture.billing,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{editor}");
    assert_eq!(editor["service_period_default"]["from"], "2026-11-20");
    assert_eq!(editor["service_period_default"]["to"], "2026-11-25");
    assert!(editor["service_period"].is_null());
    assert_eq!(editor["payment_term_days"], 14);
    let text = pdf_text(&fixture, &invoice_id).await;
    assert!(
        text.contains("20.11.2026") && text.contains("25.11.2026"),
        "{text}"
    );

    let (status, body) = put_draft(
        &fixture,
        &fixture.billing,
        &invoice_id,
        json!({ "service_period": { "from": null, "to": "2026-12-31" } }),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["service_period"]["to"], "2026-12-31");
    let (status, body) = put_draft(
        &fixture,
        &fixture.billing,
        &invoice_id,
        json!({ "service_period": { "from": "2026-12-31", "to": "2026-12-01" } }),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
    let (status, issued) = issue(&fixture, &fixture.billing, &invoice_id, json!({})).await;
    assert_eq!(status, StatusCode::OK, "{issued}");
    let text = pdf_text(&fixture, &invoice_id).await;
    assert!(text.contains("bis 12.2026"), "{text}");
    assert!(!text.contains("20.11.2026"), "{text}");
}

/// QA 2026-11-19: an interim keeps the period chosen in «Новый счёт» (S2),
/// and a draft left without one states the order's programme, not the day
/// its services were marked delivered (S3).
#[tokio::test]
async fn an_interim_keeps_its_chosen_period_and_an_empty_one_is_the_programme() {
    let Some(fixture) = fixture("interim-period", SERVICES).await else {
        return;
    };
    set_order_period(&fixture, "2026-11-23", "2026-12-04").await;
    sqlx::query("UPDATE order_leistungen SET delivered_at = now() WHERE order_id = $1")
        .bind(fixture.order_id)
        .execute(&fixture.pool)
        .await
        .unwrap();

    let (status, chosen) = create_invoice(
        &fixture,
        &fixture.billing,
        json!({
            "invoice_type": "interim",
            "line_items": [{ "line_index": 0, "quantity": 1 }],
            "service_period": { "from": "2026-11-23", "to": "2026-12-04" }
        }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{chosen}");
    let chosen_id = chosen["id"].as_str().unwrap().to_string();
    let stored: (Option<chrono::NaiveDate>, Option<chrono::NaiveDate>) = sqlx::query_as(
        "SELECT service_period_from, service_period_to FROM invoices WHERE id = $1::uuid",
    )
    .bind(&chosen_id)
    .fetch_one(&fixture.pool)
    .await
    .unwrap();
    assert_eq!(
        stored,
        (
            chrono::NaiveDate::from_ymd_opt(2026, 11, 23),
            chrono::NaiveDate::from_ymd_opt(2026, 12, 4)
        )
    );
    let (status, editor) = json_request(
        &fixture.app,
        "GET",
        &format!("/api/v1/invoices/{chosen_id}/draft"),
        &fixture.billing,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{editor}");
    assert_eq!(editor["service_period"]["from"], "2026-11-23", "{editor}");
    assert_eq!(editor["service_period"]["to"], "2026-12-04", "{editor}");

    let (status, empty) = create_invoice(
        &fixture,
        &fixture.billing,
        json!({
            "invoice_type": "interim",
            "line_items": [{ "line_index": 1, "quantity": 1 }]
        }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{empty}");
    let empty_id = empty["id"].as_str().unwrap().to_string();
    let (status, editor) = json_request(
        &fixture.app,
        "GET",
        &format!("/api/v1/invoices/{empty_id}/draft"),
        &fixture.billing,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{editor}");
    assert!(editor["service_period"].is_null(), "{editor}");
    assert_eq!(
        editor["service_period_default"]["from"], "2026-11-23",
        "{editor}"
    );
    assert_eq!(
        editor["service_period_default"]["to"], "2026-12-04",
        "{editor}"
    );
    let text = pdf_text(&fixture, &empty_id).await;
    assert!(
        text.contains("23.11.2026") && text.contains("04.12.2026"),
        "{text}"
    );
}

#[tokio::test]
async fn an_invoice_before_the_services_states_the_order_period_as_expected() {
    let Some(fixture) = fixture("expected-period", SERVICES).await else {
        return;
    };
    // The owner's flow: the order runs 20.11.–25.11., nothing is rendered yet.
    set_order_period(&fixture, "2026-11-20", "2026-11-25").await;
    sqlx::query("UPDATE order_leistungen SET status = 'planned' WHERE order_id = $1")
        .bind(fixture.order_id)
        .execute(&fixture.pool)
        .await
        .unwrap();
    let (status, draft) = create_invoice(
        &fixture,
        &fixture.billing,
        json!({ "invoice_type": "final" }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{draft}");
    let invoice_id = draft["id"].as_str().unwrap().to_string();
    let (status, issued) = issue(&fixture, &fixture.billing, &invoice_id, json!({})).await;
    assert_eq!(status, StatusCode::OK, "{issued}");
    let text = pdf_text(&fixture, &invoice_id).await;
    assert!(text.contains("Leistung noch nicht erbracht"), "{text}");
    assert!(text.contains("Voraussichtlicher"), "{text}");
    assert!(
        text.contains("20.11.2026") && text.contains("25.11.2026"),
        "{text}"
    );
}
