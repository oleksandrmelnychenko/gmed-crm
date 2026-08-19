mod support;

use axum::body::Body;
use axum::http::{Request, StatusCode};
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
    let bytes = axum::body::to_bytes(response.into_body(), 4 * 1024 * 1024)
        .await
        .unwrap();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(json!(null)),
    )
}

fn unique_tag(prefix: &str) -> String {
    format!("{prefix}-{}", Uuid::new_v4().simple())
}

fn auth_header_for(user_id: Uuid, role: &str) -> String {
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

async fn seed_patient(pool: &PgPool, created_by: Uuid, tag: &str) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO patients (
                patient_id, first_name, last_name, birth_date, gender, created_by
           ) VALUES ($1, 'Phase', 'Two', '1990-01-01', 'diverse', $2)
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
           VALUES ($1, $2, $3)
           ON CONFLICT (patient_id, user_id)
           DO UPDATE SET revoked_at = NULL, assigned_by = $3, assigned_at = now()"#,
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
        r#"INSERT INTO orders (
                order_number, patient_id, phase, status, created_by,
                billing_release_status, billing_released_by, billing_released_at,
                package_coverage_status, package_coverage_decided_by,
                package_coverage_decided_at
           ) VALUES (
                $1, $2, 'execution', 'active', $3,
                'granted', $3, now(), 'not_covered', $3, now()
           ) RETURNING id"#,
    )
    .bind(format!("ORD-{tag}"))
    .bind(patient_id)
    .bind(created_by)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn seed_order_line(
    pool: &PgPool,
    order_id: Uuid,
    description: &str,
    quantity: i32,
    unit_price: i32,
) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO order_leistungen (
                order_id, description, quantity, unit_price, vat_rate, status
           ) VALUES ($1, $2, $3, $4, 19, 'approved')
           RETURNING id"#,
    )
    .bind(order_id)
    .bind(description)
    .bind(quantity)
    .bind(unit_price)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn create_quote(app: &axum::Router, bearer: &str, order_id: Uuid) -> Value {
    let (status, body) = json_request(
        app,
        "POST",
        &format!("/api/v1/orders/{order_id}/quotes"),
        bearer,
        Some(json!({ "notes": "Phase 2 quote" })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "quote response: {body:?}");
    body
}

#[tokio::test]
async fn partial_interims_allocate_quantities_and_final_consumes_only_remaining() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };
    let tag = unique_tag("phase2-partial");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let manager_id = seed_user(&pool, &tag, "patient_manager").await;
    let billing_id = seed_user(&pool, &tag, "billing").await;
    seed_assignment(&pool, patient_id, manager_id, admin_id).await;
    let order_id = seed_order(&pool, patient_id, admin_id, &tag).await;
    let first_line = seed_order_line(&pool, order_id, "Interpreter", 3, 100).await;
    let second_line = seed_order_line(&pool, order_id, "Driver", 2, 50).await;
    let manager = auth_header_for(manager_id, "patient_manager");
    let billing = auth_header_for(billing_id, "billing");
    let quote = create_quote(&app, &manager, order_id).await;
    let quote_id = quote["id"].as_str().unwrap();

    for payload in [
        json!({
            "invoice_type": "interim",
            "line_items": [{ "line_index": 0, "quantity": 1 }]
        }),
        json!({
            "invoice_type": "interim",
            "line_items": [
                { "line_index": 0, "quantity": 1 },
                { "line_index": 1, "quantity": 1 }
            ]
        }),
    ] {
        let (status, body) = json_request(
            &app,
            "POST",
            &format!("/api/v1/quotes/{quote_id}/invoices"),
            &billing,
            Some(payload),
        )
        .await;
        assert_eq!(status, StatusCode::CREATED, "interim response: {body:?}");
    }

    let (status, partial_order) = json_request(
        &app,
        "GET",
        &format!("/api/v1/orders/{order_id}"),
        &manager,
        None,
    )
    .await;
    assert_eq!(
        status,
        StatusCode::OK,
        "partial order response: {partial_order:?}"
    );
    let partial_services = partial_order["leistungen"].as_array().unwrap();
    for service_id in [first_line, second_line] {
        let service_id = service_id.to_string();
        let service = partial_services
            .iter()
            .find(|item| item["id"].as_str() == Some(service_id.as_str()))
            .unwrap();
        assert_eq!(service["billing_status"], "partially_invoiced");
        assert!(!service["invoice_references"].as_array().unwrap().is_empty());
    }

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/quotes/{quote_id}/invoices"),
        &billing,
        Some(json!({
            "invoice_type": "interim",
            "line_items": [{ "line_index": 0, "quantity": 2 }]
        })),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::CONFLICT,
        "over-allocation response: {body:?}"
    );

    let (status, final_invoice) = json_request(
        &app,
        "POST",
        &format!("/api/v1/quotes/{quote_id}/invoices"),
        &billing,
        Some(json!({
            "invoice_type": "final",
            "line_items": [
                { "line_index": 0, "quantity": 1 },
                { "line_index": 1, "quantity": 1 }
            ]
        })),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::CREATED,
        "final response: {final_invoice:?}"
    );

    let allocated: Vec<(i32, rust_decimal::Decimal)> = sqlx::query(
        r#"SELECT quote_line_index, SUM(quantity) AS quantity
           FROM invoice_order_line_allocations
           WHERE quote_id = $1
           GROUP BY quote_line_index
           ORDER BY quote_line_index"#,
    )
    .bind(Uuid::parse_str(quote_id).unwrap())
    .fetch_all(&pool)
    .await
    .unwrap()
    .into_iter()
    .map(|row| (row.get("quote_line_index"), row.get("quantity")))
    .collect();
    assert_eq!(allocated[0].1, rust_decimal::Decimal::new(3, 0));
    assert_eq!(allocated[1].1, rust_decimal::Decimal::new(2, 0));
    let service_ids = vec![first_line, second_line];
    let statuses: Vec<String> =
        sqlx::query_scalar("SELECT status FROM order_leistungen WHERE id = ANY($1) ORDER BY id")
            .bind(&service_ids)
            .fetch_all(&pool)
            .await
            .unwrap();
    assert!(statuses.iter().all(|status| status == "invoiced"));

    let (status, awaiting_order) = json_request(
        &app,
        "GET",
        &format!("/api/v1/orders/{order_id}"),
        &manager,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(
        awaiting_order["leistungen"]
            .as_array()
            .unwrap()
            .iter()
            .all(|item| item["billing_status"] == "awaiting_payment")
    );

    sqlx::query(
        r#"UPDATE invoices
           SET paid_amount = total_gross, status = 'paid', paid_at = now()
           WHERE quote_id = $1 AND status <> 'cancelled'"#,
    )
    .bind(Uuid::parse_str(quote_id).unwrap())
    .execute(&pool)
    .await
    .unwrap();
    let (status, paid_order) = json_request(
        &app,
        "GET",
        &format!("/api/v1/orders/{order_id}"),
        &manager,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(
        paid_order["leistungen"]
            .as_array()
            .unwrap()
            .iter()
            .all(|item| item["billing_status"] == "paid")
    );
}

#[tokio::test]
async fn paid_advance_can_be_applied_in_parts_and_settlement_cancel_releases_it() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };
    let tag = unique_tag("phase2-advance");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let manager_id = seed_user(&pool, &tag, "patient_manager").await;
    let billing_id = seed_user(&pool, &tag, "billing").await;
    seed_assignment(&pool, patient_id, manager_id, admin_id).await;
    let order_id = seed_order(&pool, patient_id, admin_id, &tag).await;
    let order_line = seed_order_line(&pool, order_id, "Deposit-backed service", 1, 50).await;
    let manager = auth_header_for(manager_id, "patient_manager");
    let billing = auth_header_for(billing_id, "billing");
    let quote = create_quote(&app, &manager, order_id).await;
    let quote_id = quote["id"].as_str().unwrap();

    let (status, advance) = json_request(
        &app,
        "POST",
        &format!("/api/v1/quotes/{quote_id}/invoices"),
        &billing,
        Some(json!({
            "invoice_type": "advance",
            "line_items": [{ "line_index": 0, "quantity": 1 }]
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let advance_id = advance["id"].as_str().unwrap();
    let advance_gross = advance["total_gross"].as_str().unwrap();
    let (status, paid_advance) = json_request(
        &app,
        "POST",
        &format!("/api/v1/invoices/{advance_id}/status"),
        &billing,
        Some(json!({ "status": "paid", "paid_amount": advance_gross })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "advance payment: {paid_advance:?}");

    let (status, settlement) = json_request(
        &app,
        "POST",
        &format!("/api/v1/quotes/{quote_id}/invoices"),
        &billing,
        Some(json!({
            "invoice_type": "interim",
            "line_items": [{ "line_index": 0, "quantity": 1 }]
        })),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::CREATED,
        "settlement response: {settlement:?}"
    );
    let settlement_id = settlement["id"].as_str().unwrap();
    let (status, sent) = json_request(
        &app,
        "POST",
        &format!("/api/v1/invoices/{settlement_id}/status"),
        &billing,
        Some(json!({ "status": "sent", "paid_amount": 0 })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "send settlement: {sent:?}");

    for amount in ["20.00", "39.50"] {
        let (status, body) = json_request(
            &app,
            "POST",
            &format!("/api/v1/invoices/{settlement_id}/prepayment-allocations"),
            &billing,
            Some(json!({
                "advance_invoice_id": advance_id,
                "amount_gross": amount
            })),
        )
        .await;
        assert_eq!(
            status,
            StatusCode::OK,
            "prepayment apply response: {body:?}"
        );
    }

    let applied: rust_decimal::Decimal =
        sqlx::query_scalar("SELECT prepayment_applied_amount FROM invoices WHERE id = $1")
            .bind(Uuid::parse_str(settlement_id).unwrap())
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(applied, rust_decimal::Decimal::new(5950, 2));

    let (status, detail) = json_request(
        &app,
        "GET",
        &format!("/api/v1/invoices/{settlement_id}"),
        &billing,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(detail["status"], "paid");
    assert!(detail["paid_at"].as_str().is_some());
    let allocation_id = detail["prepayment_allocations"][0]["id"].as_str().unwrap();
    let (status, released) = json_request(
        &app,
        "DELETE",
        &format!("/api/v1/invoices/{settlement_id}/prepayment-allocations/{allocation_id}"),
        &billing,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "release response: {released:?}");
    assert_eq!(released["status"], "sent");
    assert!(released["paid_at"].is_null());
    assert_eq!(released["prepayment_applied_amount"], "0");

    let (status, reapplied) = json_request(
        &app,
        "POST",
        &format!("/api/v1/invoices/{settlement_id}/prepayment-allocations"),
        &billing,
        Some(json!({
            "advance_invoice_id": advance_id,
            "amount_gross": "59.50"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "reapply response: {reapplied:?}");
    assert_eq!(reapplied["status"], "paid");
    let service_status: String =
        sqlx::query_scalar("SELECT status FROM order_leistungen WHERE id = $1")
            .bind(order_line)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(service_status, "invoiced");

    let (status, cancelled) = json_request(
        &app,
        "POST",
        &format!("/api/v1/invoices/{settlement_id}/status"),
        &billing,
        Some(json!({ "status": "cancelled" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "cancel response: {cancelled:?}");
    let allocation_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM invoice_prepayment_allocations WHERE advance_invoice_id = $1",
    )
    .bind(Uuid::parse_str(advance_id).unwrap())
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(allocation_count, 0);
    let released_service_status: String =
        sqlx::query_scalar("SELECT status FROM order_leistungen WHERE id = $1")
            .bind(order_line)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(released_service_status, "approved");
}

#[tokio::test]
async fn clinic_expense_payer_controls_receivable_liability_and_cash_ledger() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };
    let tag = unique_tag("phase2-expense");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let manager_id = seed_user(&pool, &tag, "patient_manager").await;
    seed_assignment(&pool, patient_id, manager_id, admin_id).await;
    let order_id = seed_order(&pool, patient_id, admin_id, &tag).await;
    let manager = auth_header_for(manager_id, "patient_manager");

    let cases = [
        ("PATIENT-PAID", "paid", "patient", true, 100),
        ("AGENCY-PAID", "paid", "agency", true, 200),
        ("DELIVERED-UNPAID", "approved", "unpaid", true, 300),
    ];
    let mut ids = Vec::new();
    for (number, status_value, paid_by, delivered, amount) in cases {
        let (status, body) = json_request(
            &app,
            "POST",
            &format!("/api/v1/orders/{order_id}/external-invoices"),
            &manager,
            Some(json!({
                "external_invoice_number": format!("{tag}-{number}"),
                "amount_gross": amount,
                "status": status_value,
                "paid_by": paid_by,
                "service_delivered": delivered
            })),
        )
        .await;
        assert_eq!(status, StatusCode::CREATED, "expense response: {body:?}");
        ids.push(Uuid::parse_str(body["id"].as_str().unwrap()).unwrap());
    }

    let rows = sqlx::query(
        r#"SELECT paid_by, patient_receivable_gross, provider_liability_gross
           FROM external_invoices
           WHERE id = ANY($1)
           ORDER BY amount_gross"#,
    )
    .bind(&ids)
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(
        rows[0].get::<rust_decimal::Decimal, _>("patient_receivable_gross"),
        rust_decimal::Decimal::ZERO
    );
    assert_eq!(
        rows[0].get::<rust_decimal::Decimal, _>("provider_liability_gross"),
        rust_decimal::Decimal::ZERO
    );
    assert_eq!(
        rows[1].get::<rust_decimal::Decimal, _>("patient_receivable_gross"),
        rust_decimal::Decimal::new(200, 0)
    );
    assert_eq!(
        rows[1].get::<rust_decimal::Decimal, _>("provider_liability_gross"),
        rust_decimal::Decimal::ZERO
    );
    assert_eq!(
        rows[2].get::<rust_decimal::Decimal, _>("patient_receivable_gross"),
        rust_decimal::Decimal::new(300, 0)
    );
    assert_eq!(
        rows[2].get::<rust_decimal::Decimal, _>("provider_liability_gross"),
        rust_decimal::Decimal::new(300, 0)
    );

    let ledger_total: rust_decimal::Decimal = sqlx::query_scalar(
        r#"SELECT COALESCE(SUM(amount_gross), 0)
           FROM accounting_entries
           WHERE source_external_invoice_id = ANY($1)
             AND entry_kind = 'external_invoice_payment'"#,
    )
    .bind(&ids)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(ledger_total, rust_decimal::Decimal::new(200, 0));
    let ledger_count: i64 = sqlx::query_scalar(
        r#"SELECT COUNT(*)
           FROM accounting_entries
           WHERE source_external_invoice_id = ANY($1)
             AND entry_kind = 'external_invoice_payment'"#,
    )
    .bind(&ids)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        ledger_count, 1,
        "only the agency-paid expense enters GMED cash ledger"
    );

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/orders/{order_id}/external-invoices"),
        &manager,
        Some(json!({
            "external_invoice_number": format!("{tag}-INVALID"),
            "amount_gross": 10,
            "status": "received",
            "paid_by": "patient"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);

    let direct_invalid = sqlx::query(
        "UPDATE external_invoices SET status = 'received', paid_by = 'agency' WHERE id = $1",
    )
    .bind(ids[1])
    .execute(&pool)
    .await;
    assert!(direct_invalid.is_err());
}
