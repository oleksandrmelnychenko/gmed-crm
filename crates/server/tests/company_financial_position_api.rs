mod support;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use serde_json::{Value, json};
use sqlx::PgPool;
use tower::ServiceExt;
use uuid::Uuid;

use gmed_server::auth::jwt;

const TEST_SECRET: &str = "test-secret-at-least-32-characters-long!!";

fn auth_header_for(user_id: Uuid, role: &str) -> String {
    let token = jwt::issue_access_token(TEST_SECRET, user_id, role, Uuid::new_v4()).unwrap();
    format!("Bearer {token}")
}

async fn request_json(app: &axum::Router, path: &str, bearer: &str) -> (StatusCode, Value) {
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri(path)
                .header("Authorization", bearer)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let status = response.status();
    let bytes = axum::body::to_bytes(response.into_body(), 1024 * 1024)
        .await
        .unwrap();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or_else(|_| json!(null)),
    )
}

async fn seed_user(pool: &PgPool, tag: &str, role: &str) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO users (email, password_hash, name, role)
           VALUES ($1, 'test-password-hash', $2, $3)
           RETURNING id"#,
    )
    .bind(format!(
        "company-position-{tag}-{role}-{}@example.test",
        Uuid::new_v4().simple()
    ))
    .bind(format!("Company position {role} {tag}"))
    .bind(role)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn seed_patient(pool: &PgPool, created_by: Uuid, tag: &str, suffix: &str) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO patients (
               patient_id, first_name, last_name, birth_date, gender, created_by
           ) VALUES ($1, 'Company', $2, '1990-01-01', 'diverse', $3)
           RETURNING id"#,
    )
    .bind(format!("CP-{tag}-{suffix}"))
    .bind(format!("Patient {suffix}"))
    .bind(created_by)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn seed_order(
    pool: &PgPool,
    patient_id: Uuid,
    created_by: Uuid,
    tag: &str,
    currency: &str,
) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO orders (
               order_number, patient_id, phase, status, currency, created_by
           ) VALUES ($1, $2, 'execution', 'active', $3, $4)
           RETURNING id"#,
    )
    .bind(format!("CP-{currency}-{tag}"))
    .bind(patient_id)
    .bind(currency)
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
    number: &str,
    invoice_type: &str,
    total: i64,
    paid: i64,
) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO invoices (
               order_id, patient_id, invoice_number, invoice_type, status,
               issued_at, due_date, total_net, total_vat, total_gross,
               paid_amount, line_items, portal_visible, created_by
           ) VALUES (
               $1, $2, $3, $4, $5, now(), CURRENT_DATE + 14,
               $6, 0, $6, $7, '[]', true, $8
           ) RETURNING id"#,
    )
    .bind(order_id)
    .bind(patient_id)
    .bind(number)
    .bind(invoice_type)
    .bind(if paid >= total {
        "paid"
    } else if paid > 0 {
        "partially_paid"
    } else {
        "sent"
    })
    .bind(total)
    .bind(paid)
    .bind(created_by)
    .fetch_one(pool)
    .await
    .unwrap()
}

#[tokio::test]
async fn company_position_separates_receivables_payables_expected_costs_and_cash() {
    let Some(ctx) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let tag = Uuid::new_v4().simple().to_string();
    let billing_id = seed_user(&ctx.pool, &tag, "billing").await;
    let sales_id = seed_user(&ctx.pool, &tag, "sales").await;
    let patient_a = seed_patient(&ctx.pool, ctx.admin_id, &tag, "A").await;
    let patient_b = seed_patient(&ctx.pool, ctx.admin_id, &tag, "B").await;
    let order_id = seed_order(&ctx.pool, patient_a, ctx.admin_id, &tag, "EUR").await;

    let invoice_id = seed_invoice(
        &ctx.pool,
        order_id,
        patient_a,
        ctx.admin_id,
        &format!("FIN-{tag}"),
        "final",
        100,
        20,
    )
    .await;
    let advance_id = seed_invoice(
        &ctx.pool,
        order_id,
        patient_a,
        ctx.admin_id,
        &format!("ADV-{tag}"),
        "advance",
        50,
        50,
    )
    .await;
    sqlx::query(
        r#"INSERT INTO invoice_prepayment_allocations (
               advance_invoice_id, target_invoice_id, amount_gross,
               created_by, request_id
           ) VALUES ($1, $2, 10, $3, $4)"#,
    )
    .bind(advance_id)
    .bind(invoice_id)
    .bind(ctx.admin_id)
    .bind(Uuid::new_v4())
    .execute(&ctx.pool)
    .await
    .unwrap();

    let external_receivable_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO external_invoices (
               order_id, patient_id, external_invoice_number, invoice_date,
               amount_net, amount_vat, amount_gross, currency, status,
               paid_by, service_delivered, created_by
           ) VALUES (
               $1, $2, $3, CURRENT_DATE, 30, 0, 30, 'EUR', 'paid',
               'agency', true, $4
           ) RETURNING id"#,
    )
    .bind(order_id)
    .bind(patient_a)
    .bind(format!("EXT-AR-{tag}"))
    .bind(ctx.admin_id)
    .fetch_one(&ctx.pool)
    .await
    .unwrap();
    sqlx::query(
        r#"INSERT INTO external_invoice_patient_invoice_allocations (
               external_invoice_id, patient_invoice_id, amount_gross,
               created_by, request_id
           ) VALUES ($1, $2, 20, $3, $4)"#,
    )
    .bind(external_receivable_id)
    .bind(invoice_id)
    .bind(ctx.admin_id)
    .bind(Uuid::new_v4())
    .execute(&ctx.pool)
    .await
    .unwrap();

    for (patient_id, direction, amount, suffix) in [
        (patient_a, "debit", 5_i64, "DEBIT"),
        (patient_b, "credit", 12_i64, "CREDIT"),
    ] {
        sqlx::query(
            r#"INSERT INTO patient_balance_adjustments (
                   patient_id, transaction_type, request_id, direction,
                   category, amount, currency, effective_on, reason,
                   created_by
               ) VALUES (
                   $1, 'adjustment', $2, $3, 'correction', $4,
                   'EUR', CURRENT_DATE, $5, $6
               )"#,
        )
        .bind(patient_id)
        .bind(Uuid::new_v4())
        .bind(direction)
        .bind(amount)
        .bind(format!("Company position {suffix} {tag}"))
        .bind(ctx.admin_id)
        .execute(&ctx.pool)
        .await
        .unwrap();
    }

    for (number, status, gross) in [("PAYABLE", "received", 25_i64), ("EXPECTED", "expected", 15_i64)] {
        sqlx::query(
            r#"INSERT INTO external_invoices (
                   order_id, patient_id, external_invoice_number, invoice_date,
                   due_date, amount_net, amount_vat, amount_gross, currency,
                   status, paid_by, service_delivered, created_by
               ) VALUES (
                   $1, $2, $3, CURRENT_DATE, CURRENT_DATE + 7,
                   $4, 0, $4, 'EUR', $5, 'unpaid', false, $6
               )"#,
        )
        .bind(order_id)
        .bind(patient_a)
        .bind(format!("EXT-{number}-{tag}"))
        .bind(gross)
        .bind(status)
        .bind(ctx.admin_id)
        .execute(&ctx.pool)
        .await
        .unwrap();
    }

    for (entry_kind, direction, category, gross, currency, description) in [
        (
            "invoice_payment",
            "income",
            "service_revenue",
            100_i64,
            "EUR",
            "Company position receipt",
        ),
        (
            "external_invoice_payment",
            "expense",
            "provider_expense",
            40_i64,
            "EUR",
            "Company position provider payment",
        ),
        (
            "invoice_refund",
            "income",
            "service_revenue",
            -10_i64,
            "EUR",
            "Company position refund",
        ),
        (
            "invoice_payment",
            "income",
            "service_revenue",
            999_i64,
            "USD",
            "Currency isolation",
        ),
    ] {
        sqlx::query(
            r#"INSERT INTO accounting_entries (
                   entry_kind, direction, category, order_id, patient_id,
                   entry_date, description, amount_net, amount_vat,
                   amount_gross, currency, created_by
               ) VALUES (
                   $1, $2, $3, $4, $5, CURRENT_DATE, $6,
                   $7, 0, $7, $8, $9
               )"#,
        )
        .bind(entry_kind)
        .bind(direction)
        .bind(category)
        .bind(order_id)
        .bind(patient_a)
        .bind(description)
        .bind(gross)
        .bind(currency)
        .bind(ctx.admin_id)
        .execute(&ctx.pool)
        .await
        .unwrap();
    }

    let billing = auth_header_for(billing_id, "billing");
    let (status, result) = request_json(
        &ctx.app,
        "/api/v1/company-financial-position?currency=EUR&from=2020-01-01&to=2099-12-31",
        &billing,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "position: {result:?}");
    assert_eq!(result["summary"]["patient_receivables_calculated"], "45");
    assert_eq!(result["summary"]["patient_credits"], "12");
    assert_eq!(result["summary"]["provider_payables"], "25");
    assert_eq!(result["summary"]["expected_provider_costs"], "15");
    assert_eq!(result["summary"]["calculated_net_position"], "8");
    assert!(result["summary"]["confirmed_net_position"].is_null());
    assert_eq!(result["summary"]["reconciliation_required"], true);
    assert_eq!(result["summary"]["unreconciled_external_receivables"], "10");
    assert_eq!(result["summary"]["cash_inflow"], "100");
    assert_eq!(result["summary"]["cash_outflow"], "50");
    assert_eq!(result["summary"]["net_cash_flow"], "50");
    assert_eq!(result["patient_positions"].as_array().unwrap().len(), 2);
    assert_eq!(result["provider_liabilities"].as_array().unwrap().len(), 2);
    assert!(result["available_currencies"]
        .as_array()
        .unwrap()
        .iter()
        .any(|value| value == "USD"));

    let (outflow_status, outflows) = request_json(
        &ctx.app,
        "/api/v1/company-financial-position?currency=EUR&from=2020-01-01&to=2099-12-31&movement=outflow",
        &billing,
    )
    .await;
    assert_eq!(outflow_status, StatusCode::OK, "outflows: {outflows:?}");
    assert_eq!(outflows["cash_movements"].as_array().unwrap().len(), 2);
    assert!(outflows["cash_movements"]
        .as_array()
        .unwrap()
        .iter()
        .all(|movement| movement["movement"] == "outflow"));

    let (search_status, search) = request_json(
        &ctx.app,
        "/api/v1/company-financial-position?currency=EUR&from=2020-01-01&to=2099-12-31&search=refund",
        &billing,
    )
    .await;
    assert_eq!(search_status, StatusCode::OK, "search: {search:?}");
    assert_eq!(search["cash_movements"].as_array().unwrap().len(), 1);

    let sales = auth_header_for(sales_id, "sales");
    let (forbidden, _) = request_json(
        &ctx.app,
        "/api/v1/company-financial-position?currency=EUR",
        &sales,
    )
    .await;
    assert_eq!(forbidden, StatusCode::FORBIDDEN);

    for path in [
        "/api/v1/company-financial-position?from=2026-02-02&to=2026-01-01",
        "/api/v1/company-financial-position?currency=EURO",
        "/api/v1/company-financial-position?movement=debit",
    ] {
        let (invalid, _) = request_json(&ctx.app, path, &billing).await;
        assert_eq!(invalid, StatusCode::UNPROCESSABLE_ENTITY, "path: {path}");
    }
}
