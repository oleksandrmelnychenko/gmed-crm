//! Remarks on invoice positions: given at creation, changed on the draft,
//! printed on the PDF and fixed once the invoice is released.

mod support;

use axum::body::Body;
use axum::http::{Request, StatusCode};
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

/// An order cleared for billing with a quarterly service (two units) and a
/// one-off service.
async fn seed_order(pool: &PgPool, patient_id: Uuid, created_by: Uuid, tag: &str) -> Uuid {
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
           SET billing_release_status = 'granted',
               billing_release_note = 'test gate',
               billing_released_by = $2,
               billing_released_at = now(),
               package_coverage_status = 'not_covered',
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
    sqlx::query(
        r#"INSERT INTO order_leistungen (order_id, description, quantity, unit_price, vat_rate, status)
           VALUES ($1, 'Quartalsbetreuung', 2, 100, 19, 'approved'),
                  ($1, 'Terminorganisation', 1, 50, 19, 'approved')"#,
    )
    .bind(order_id)
    .execute(pool)
    .await
    .unwrap();
    order_id
}

struct Fixture {
    app: axum::Router,
    pool: PgPool,
    billing: String,
    concierge: String,
    quote_id: String,
}

async fn fixture(prefix: &str) -> Option<Fixture> {
    let ctx = support::suite_context(TEST_SECRET).await?;
    let tag = format!("{prefix}-{}", Uuid::new_v4().simple());
    let billing = bearer(seed_user(&ctx.pool, &tag, "billing").await, "billing");
    let manager = bearer(seed_user(&ctx.pool, &tag, "ceo").await, "ceo");
    let concierge = bearer(seed_user(&ctx.pool, &tag, "concierge").await, "concierge");
    let patient_id = seed_patient(&ctx.pool, ctx.admin_id, &tag).await;
    let order_id = seed_order(&ctx.pool, patient_id, ctx.admin_id, &tag).await;
    let (status, quote) = json_request(
        &ctx.app,
        "POST",
        &format!("/api/v1/orders/{order_id}/quotes"),
        &manager,
        Some(json!({ "notes": "line comment test" })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{quote}");
    Some(Fixture {
        app: ctx.app,
        pool: ctx.pool,
        billing,
        concierge,
        quote_id: quote["id"].as_str().unwrap().to_string(),
    })
}

async fn create_invoice(fixture: &Fixture, line_items: Value) -> (StatusCode, Value) {
    json_request(
        &fixture.app,
        "POST",
        &format!("/api/v1/quotes/{}/invoices", fixture.quote_id),
        &fixture.billing,
        Some(json!({ "invoice_type": "interim", "line_items": line_items })),
    )
    .await
}

async fn set_comments(
    fixture: &Fixture,
    auth: &str,
    invoice_id: &str,
    comments: Value,
) -> (StatusCode, Value) {
    json_request(
        &fixture.app,
        "POST",
        &format!("/api/v1/invoices/{invoice_id}/line-comments"),
        auth,
        Some(json!({ "comments": comments })),
    )
    .await
}

async fn audit_rows(pool: &PgPool, invoice_id: &str) -> Vec<(Value, Value)> {
    sqlx::query_as(
        r#"SELECT old_value, new_value FROM audit_log
           WHERE action = 'invoice_line_comments_changed' AND entity_id = $1::uuid
           ORDER BY created_at, id"#,
    )
    .bind(invoice_id)
    .fetch_all(pool)
    .await
    .unwrap()
}

#[tokio::test]
async fn a_position_carries_its_comment_from_creation_to_the_printed_invoice() {
    let Some(fixture) = fixture("line-comment").await else {
        return;
    };

    // A comment longer than the PDF column can carry is refused.
    let (status, body) = create_invoice(
        &fixture,
        json!([{ "line_index": 0, "quantity": 2, "comment": "x".repeat(301) }]),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
    assert_eq!(
        body["message"], "Invoice line comment is too long",
        "{body}"
    );

    // Two quarters of the same service on one position, named in the comment;
    // the second position stays without one.
    let (status, invoice) = create_invoice(
        &fixture,
        json!([
            { "line_index": 0, "quantity": 2, "comment": "  2. und 3.\nQuartal 2026 " },
            { "line_index": 1, "quantity": 1, "comment": "   " }
        ]),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{invoice}");
    let invoice_id = invoice["id"].as_str().unwrap().to_string();
    assert_eq!(
        invoice["line_items"][0]["comment"], "2. und 3. Quartal 2026",
        "{invoice}"
    );
    assert!(
        invoice["line_items"][1].get("comment").is_none(),
        "{invoice}"
    );
    assert_eq!(invoice["line_items"][0]["quantity"], "2", "{invoice}");

    // The draft: one comment is replaced, one is added.
    let (status, changed) = set_comments(
        &fixture,
        &fixture.billing,
        &invoice_id,
        json!([
            { "line_index": 0, "comment": "2. und 3. Quartal 2026 (Juli bis Dezember)" },
            { "line_index": 1, "comment": "Rechnung der Klinik Nr. 4711" }
        ]),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{changed}");
    assert_eq!(
        changed["line_items"][0]["comment"],
        "2. und 3. Quartal 2026 (Juli bis Dezember)"
    );
    assert_eq!(
        changed["line_items"][1]["comment"],
        "Rechnung der Klinik Nr. 4711"
    );
    // Amounts and the other fields of the positions are untouched.
    for key in ["description", "quantity", "unit_price", "line_gross"] {
        assert_eq!(
            changed["line_items"][0][key], invoice["line_items"][0][key],
            "{key}"
        );
    }
    assert_eq!(changed["total_gross"], invoice["total_gross"]);

    // Clearing a comment removes it; an unchanged comment writes no audit row.
    let (status, cleared) = set_comments(
        &fixture,
        &fixture.billing,
        &invoice_id,
        json!([{ "line_index": 1, "comment": null }]),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{cleared}");
    assert!(
        cleared["line_items"][1].get("comment").is_none(),
        "{cleared}"
    );
    let (status, _) = set_comments(
        &fixture,
        &fixture.billing,
        &invoice_id,
        json!([{ "line_index": 1, "comment": "" }]),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let audit = audit_rows(&fixture.pool, &invoice_id).await;
    assert_eq!(audit.len(), 2, "{audit:?}");
    assert_eq!(
        audit[0].0["comments"][0],
        json!({ "line_index": 0, "comment": "2. und 3. Quartal 2026" })
    );
    assert_eq!(
        audit[0].1["comments"][1],
        json!({ "line_index": 1, "comment": "Rechnung der Klinik Nr. 4711" })
    );
    assert_eq!(
        audit[1].1["comments"],
        json!([{ "line_index": 1, "comment": null }])
    );

    // Refused: unknown position, the same position twice, too long, no right.
    for (comments, message) in [
        (
            json!([{ "line_index": 5, "comment": "x" }]),
            "Invoice line does not exist",
        ),
        (
            json!([{ "line_index": 0, "comment": "a" }, { "line_index": 0, "comment": "b" }]),
            "Invoice line was given more than once",
        ),
        (
            json!([{ "line_index": 0, "comment": "x".repeat(301) }]),
            "Invoice line comment is too long",
        ),
    ] {
        let (status, body) = set_comments(&fixture, &fixture.billing, &invoice_id, comments).await;
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
        assert_eq!(body["message"], message, "{body}");
    }
    let (status, _) = set_comments(
        &fixture,
        &fixture.concierge,
        &invoice_id,
        json!([{ "line_index": 0, "comment": "x" }]),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    // The comment is printed under its position.
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
    assert!(text.contains("Quartalsbetreuung"), "{text}");
    assert!(
        text.contains("2. und 3. Quartal 2026 (Juli bis Dezember)"),
        "{text}"
    );

    // Released: the positions are part of the issued document.
    let (status, released) = json_request(
        &fixture.app,
        "POST",
        &format!("/api/v1/invoices/{invoice_id}/status"),
        &fixture.billing,
        Some(json!({ "status": "sent" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{released}");
    let (status, body) = set_comments(
        &fixture,
        &fixture.billing,
        &invoice_id,
        json!([{ "line_index": 0, "comment": "afterwards" }]),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{body}");
    let (status, stored) = json_request(
        &fixture.app,
        "GET",
        &format!("/api/v1/invoices/{invoice_id}"),
        &fixture.billing,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{stored}");
    assert_eq!(
        stored["line_items"][0]["comment"],
        "2. und 3. Quartal 2026 (Juli bis Dezember)"
    );
    assert_eq!(audit_rows(&fixture.pool, &invoice_id).await.len(), 2);
}
