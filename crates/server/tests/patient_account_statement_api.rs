mod support;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use serde_json::{Value, json};
use sqlx::PgPool;
use tower::ServiceExt;
use uuid::Uuid;

use gmed_server::auth::jwt;

const TEST_SECRET: &str = "test-secret-at-least-32-characters-long!!";

async fn test_context() -> Option<(axum::Router, PgPool, Uuid)> {
    let ctx = support::suite_context(TEST_SECRET).await?;
    Some((ctx.app, ctx.pool, ctx.admin_id))
}

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
        serde_json::from_slice(&bytes).unwrap_or(json!(null)),
    )
}

async fn seed_user(pool: &PgPool, tag: &str, role: &str) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO users (email, password_hash, name, role)
           VALUES ($1, 'test-password-hash', $2, $3)
           RETURNING id"#,
    )
    .bind(format!(
        "{tag}-{role}-{}@example.com",
        Uuid::new_v4().simple()
    ))
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
           ) VALUES ($1, 'Account', 'Statement', '1990-01-01', 'diverse', $2)
           RETURNING id"#,
    )
    .bind(format!("PT-{tag}-{}", Uuid::new_v4().simple()))
    .bind(created_by)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn assign(pool: &PgPool, patient_id: Uuid, user_id: Uuid, actor_id: Uuid) {
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
    hide_amounts: bool,
) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO invoices (
                order_id, patient_id, invoice_number, invoice_type, status,
                due_date, total_net, total_vat, total_gross, paid_amount,
                line_items, portal_visible, hide_amounts_from_patient, created_by
           ) VALUES (
                $1, $2, $3, $4, $5, CURRENT_DATE + 14,
                $6, 0, $6, $7, '[]', true, $8, $9
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
    .bind(hide_amounts)
    .bind(created_by)
    .fetch_one(pool)
    .await
    .unwrap()
}

#[tokio::test]
async fn staff_statement_explains_invoices_advances_services_and_external_payers() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };
    let tag = format!("account-statement-{}", Uuid::new_v4().simple());
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let manager_id = seed_user(&pool, &tag, "patient_manager").await;
    let sales_id = seed_user(&pool, &tag, "sales").await;
    assign(&pool, patient_id, manager_id, admin_id).await;

    let order_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO orders (order_number, patient_id, phase, status, created_by)
           VALUES ($1, $2, 'execution', 'active', $3)
           RETURNING id"#,
    )
    .bind(format!("ORD-{tag}"))
    .bind(patient_id)
    .bind(admin_id)
    .fetch_one(&pool)
    .await
    .unwrap();

    let advance_id = seed_invoice(
        &pool,
        order_id,
        patient_id,
        admin_id,
        &format!("ADV-{tag}"),
        "advance",
        50,
        50,
        false,
    )
    .await;
    let final_id = seed_invoice(
        &pool,
        order_id,
        patient_id,
        admin_id,
        &format!("FIN-{tag}"),
        "final",
        119,
        40,
        false,
    )
    .await;
    seed_invoice(
        &pool,
        order_id,
        patient_id,
        admin_id,
        &format!("HIDDEN-{tag}"),
        "interim",
        30,
        0,
        true,
    )
    .await;
    sqlx::query(
        r#"INSERT INTO invoice_prepayment_allocations (
                advance_invoice_id, target_invoice_id, amount_gross, created_by
           ) VALUES ($1, $2, 20, $3)"#,
    )
    .bind(advance_id)
    .bind(final_id)
    .bind(admin_id)
    .execute(&pool)
    .await
    .unwrap();

    let gbp_order_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO orders (
               order_number, patient_id, phase, status, currency, created_by
           ) VALUES ($1, $2, 'execution', 'active', 'GBP', $3)
           RETURNING id"#,
    )
    .bind(format!("GBP-{tag}"))
    .bind(patient_id)
    .bind(admin_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    seed_invoice(
        &pool,
        gbp_order_id,
        patient_id,
        admin_id,
        &format!("GBP-PAID-{tag}"),
        "final",
        60,
        60,
        false,
    )
    .await;
    sqlx::query(
        r#"INSERT INTO external_invoices (
               order_id, patient_id, external_invoice_number, amount_net,
               amount_vat, amount_gross, currency, status, paid_by,
               service_delivered, created_by
           ) VALUES ($1, $2, $3, 60, 0, 60, 'GBP', 'paid', 'agency', true, $4)"#,
    )
    .bind(gbp_order_id)
    .bind(patient_id)
    .bind(format!("GBP-EXT-{tag}"))
    .bind(admin_id)
    .execute(&pool)
    .await
    .unwrap();

    sqlx::query(
        r#"INSERT INTO order_leistungen (
                order_id, patient_id, description, quantity, unit_price,
                currency, vat_rate, status
           ) VALUES ($1, $2, 'Interpreter service', 2, 10, 'EUR', 19, 'delivered')"#,
    )
    .bind(order_id)
    .bind(patient_id)
    .execute(&pool)
    .await
    .unwrap();

    for (number, status, paid_by, delivered, total) in [
        ("PATIENT", "paid", "patient", true, 100_i64),
        ("GMED", "paid", "agency", true, 200_i64),
        ("UNPAID", "received", "unpaid", true, 300_i64),
    ] {
        sqlx::query(
            r#"INSERT INTO external_invoices (
                    order_id, patient_id, external_invoice_number, invoice_date,
                    amount_net, amount_vat, amount_gross, status, paid_by,
                    service_delivered, created_by
               ) VALUES ($1, $2, $3, CURRENT_DATE, $4, 0, $4, $5, $6, $7, $8)"#,
        )
        .bind(order_id)
        .bind(patient_id)
        .bind(format!("{number}-{tag}"))
        .bind(total)
        .bind(status)
        .bind(paid_by)
        .bind(delivered)
        .bind(admin_id)
        .execute(&pool)
        .await
        .unwrap();
    }

    let usd_order_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO orders (
               order_number, patient_id, phase, status, currency, created_by
           ) VALUES ($1, $2, 'execution', 'active', 'USD', $3)
           RETURNING id"#,
    )
    .bind(format!("USD-{tag}"))
    .bind(patient_id)
    .bind(admin_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    seed_invoice(
        &pool,
        usd_order_id,
        patient_id,
        admin_id,
        &format!("USD-FIN-{tag}"),
        "final",
        999,
        0,
        false,
    )
    .await;
    sqlx::query(
        r#"INSERT INTO external_invoices (
               order_id, patient_id, external_invoice_number, amount_net,
               amount_vat, amount_gross, currency, status, paid_by,
               service_delivered, created_by
           ) VALUES ($1, $2, $3, 888, 0, 888, 'USD', 'paid', 'agency', true, $4)"#,
    )
    .bind(usd_order_id)
    .bind(patient_id)
    .bind(format!("USD-EXT-{tag}"))
    .bind(admin_id)
    .execute(&pool)
    .await
    .unwrap();

    let manager = auth_header_for(manager_id, "patient_manager");
    let (status, statement) = request_json(
        &app,
        &format!("/api/v1/patients/{patient_id}/account-statement"),
        &manager,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "statement: {statement:?}");
    assert_eq!(statement["summary"]["cash_paid"], "90");
    assert_eq!(statement["summary"]["prepayment_applied"], "20");
    assert_eq!(statement["summary"]["available_prepayment"], "30");
    assert_eq!(statement["summary"]["invoice_due"], "89");
    assert_eq!(statement["summary"]["external_receivable"], "500");
    assert!(statement["summary"]["total_due"].is_null());
    assert_eq!(statement["summary"]["reconciliation_required"], true);
    assert_eq!(statement["summary"]["opening_balance"], "0");
    assert_eq!(statement["summary"]["debit_total"], "649");
    assert_eq!(statement["summary"]["credit_total"], "90");
    assert_eq!(statement["summary"]["calculated_balance"], "559");
    assert!(statement["summary"]["closing_balance"].is_null());
    assert_eq!(
        statement["summary"]["balance_side"],
        "reconciliation_required"
    );
    assert_eq!(statement["summary"]["unreconciled_external_debit"], "500");

    let movements = statement["movements"].as_array().unwrap();
    assert!(movements.iter().any(|movement| {
        movement["kind"] == "invoice"
            && movement["direction"] == "debit"
            && movement["debit"] == "119"
    }));
    assert!(movements.iter().any(|movement| {
        movement["kind"] == "payment"
            && movement["direction"] == "credit"
            && movement["credit"] == "50"
    }));
    assert!(movements.iter().any(|movement| {
        movement["kind"] == "external_receivable"
            && movement["direction"] == "debit"
            && movement["debit"] == "300"
    }));

    let items = statement["items"].as_array().unwrap();
    assert!(
        items
            .iter()
            .any(|item| item["kind"] == "service" && item["payment_state"] == "not_invoiced")
    );
    assert!(
        items
            .iter()
            .any(|item| item["kind"] == "prepayment" && item["prepayment_available"] == "30")
    );
    assert!(
        items.iter().any(
            |item| item["payment_state"] == "patient_paid" && item["patient_receivable"] == "0"
        )
    );
    assert!(
        items
            .iter()
            .any(|item| item["payment_state"] == "gmed_paid_patient_due"
                && item["patient_receivable"] == "200")
    );
    assert!(items.iter().any(
        |item| item["payment_state"] == "provider_unpaid_patient_due"
            && item["provider_liability"] == "300"
    ));
    assert!(
        !items
            .iter()
            .any(|item| item["order_id"] == usd_order_id.to_string())
    );

    let tomorrow = (chrono::Utc::now().date_naive() + chrono::Duration::days(1)).to_string();
    let (period_status, period_statement) = request_json(
        &app,
        &format!("/api/v1/patients/{patient_id}/account-statement?from={tomorrow}"),
        &manager,
    )
    .await;
    assert_eq!(
        period_status,
        StatusCode::OK,
        "period statement: {period_statement:?}"
    );
    assert_eq!(period_statement["summary"]["opening_balance"], "559");
    assert_eq!(period_statement["summary"]["debit_total"], "0");
    assert_eq!(period_statement["summary"]["credit_total"], "0");
    assert_eq!(period_statement["summary"]["calculated_balance"], "559");
    assert!(period_statement["summary"]["closing_balance"].is_null());
    assert!(period_statement["movements"].as_array().unwrap().is_empty());

    let (usd_status, usd_statement) = request_json(
        &app,
        &format!("/api/v1/patients/{patient_id}/account-statement?currency=usd"),
        &manager,
    )
    .await;
    assert_eq!(
        usd_status,
        StatusCode::OK,
        "USD statement: {usd_statement:?}"
    );
    assert_eq!(usd_statement["currency"], "USD");
    assert_eq!(usd_statement["summary"]["invoice_due"], "999");
    assert_eq!(usd_statement["summary"]["external_receivable"], "888");
    assert!(usd_statement["summary"]["total_due"].is_null());
    assert_eq!(usd_statement["summary"]["reconciliation_required"], true);

    let (eur_summary_status, eur_summary) = request_json(
        &app,
        &format!("/api/v1/patients/{patient_id}/financial-summary"),
        &manager,
    )
    .await;
    assert_eq!(
        eur_summary_status,
        StatusCode::OK,
        "EUR summary: {eur_summary:?}"
    );
    assert_eq!(eur_summary["currency"], "EUR");
    assert_eq!(eur_summary["revenue_gross"], "199");
    assert_eq!(eur_summary["open_balance"], "89");
    assert_eq!(eur_summary["external_receivable_gross"], "500");
    assert_eq!(eur_summary["reconciliation_required"], true);

    let (usd_summary_status, usd_summary) = request_json(
        &app,
        &format!("/api/v1/patients/{patient_id}/financial-summary?currency=usd"),
        &manager,
    )
    .await;
    assert_eq!(
        usd_summary_status,
        StatusCode::OK,
        "USD summary: {usd_summary:?}"
    );
    assert_eq!(usd_summary["currency"], "USD");
    assert_eq!(usd_summary["revenue_gross"], "999");
    assert_eq!(usd_summary["open_balance"], "999");
    assert_eq!(usd_summary["external_receivable_gross"], "888");
    assert_eq!(usd_summary["reconciliation_required"], true);

    let (gbp_status, gbp_statement) = request_json(
        &app,
        &format!("/api/v1/patients/{patient_id}/account-statement?currency=gbp"),
        &manager,
    )
    .await;
    assert_eq!(
        gbp_status,
        StatusCode::OK,
        "GBP statement: {gbp_statement:?}"
    );
    assert_eq!(gbp_statement["summary"]["invoice_due"], "0");
    assert_eq!(gbp_statement["summary"]["external_receivable"], "60");
    assert!(gbp_statement["summary"]["total_due"].is_null());
    assert_eq!(gbp_statement["summary"]["reconciliation_required"], true);

    let (gbp_summary_status, gbp_summary) = request_json(
        &app,
        &format!("/api/v1/patients/{patient_id}/financial-summary?currency=gbp"),
        &manager,
    )
    .await;
    assert_eq!(
        gbp_summary_status,
        StatusCode::OK,
        "GBP summary: {gbp_summary:?}"
    );
    assert_eq!(gbp_summary["open_balance"], "0");
    assert_eq!(gbp_summary["external_receivable_gross"], "60");
    assert_eq!(gbp_summary["reconciliation_required"], true);

    let sales = auth_header_for(sales_id, "sales");
    let (status, _) = request_json(
        &app,
        &format!("/api/v1/patients/{patient_id}/account-statement"),
        &sales,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn portal_statement_is_self_only_and_redacts_hidden_and_internal_items() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };
    let tag = format!("portal-statement-{}", Uuid::new_v4().simple());
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let patient_user_id = seed_user(&pool, &tag, "patient").await;
    let billing_id = seed_user(&pool, &tag, "billing").await;
    assign(&pool, patient_id, patient_user_id, admin_id).await;

    let order_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO orders (order_number, patient_id, phase, status, created_by)
           VALUES ($1, $2, 'execution', 'active', $3)
           RETURNING id"#,
    )
    .bind(format!("ORD-{tag}"))
    .bind(patient_id)
    .bind(admin_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    seed_invoice(
        &pool,
        order_id,
        patient_id,
        admin_id,
        &format!("VISIBLE-{tag}"),
        "final",
        100,
        40,
        false,
    )
    .await;
    seed_invoice(
        &pool,
        order_id,
        patient_id,
        admin_id,
        &format!("HIDDEN-{tag}"),
        "interim",
        50,
        0,
        true,
    )
    .await;
    let usd_order_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO orders (
                order_number, patient_id, phase, status, currency, created_by
           ) VALUES ($1, $2, 'execution', 'active', 'USD', $3)
           RETURNING id"#,
    )
    .bind(format!("USD-ORD-{tag}"))
    .bind(patient_id)
    .bind(admin_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    seed_invoice(
        &pool,
        usd_order_id,
        patient_id,
        admin_id,
        &format!("USD-VISIBLE-{tag}"),
        "final",
        70,
        0,
        false,
    )
    .await;
    sqlx::query(
        r#"INSERT INTO external_invoices (
                order_id, patient_id, external_invoice_number, amount_net,
                amount_vat, amount_gross, status, paid_by, service_delivered, created_by
           ) VALUES ($1, $2, $3, 75, 0, 75, 'paid', 'agency', true, $4)"#,
    )
    .bind(order_id)
    .bind(patient_id)
    .bind(format!("EXT-{tag}"))
    .bind(admin_id)
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        r#"INSERT INTO order_leistungen (
                order_id, patient_id, description, quantity, unit_price,
                currency, vat_rate, status
           ) VALUES ($1, $2, 'Internal service', 1, 75, 'EUR', 19, 'delivered')"#,
    )
    .bind(order_id)
    .bind(patient_id)
    .execute(&pool)
    .await
    .unwrap();

    let patient = auth_header_for(patient_user_id, "patient");
    let (status, statement) = request_json(&app, "/api/v1/me/account-statement", &patient).await;
    assert_eq!(status, StatusCode::OK, "portal statement: {statement:?}");
    assert_eq!(statement["patient_id"], patient_id.to_string());
    assert_eq!(statement["currency"], "EUR");
    assert_eq!(statement["available_currencies"], json!(["EUR", "USD"]));
    assert_eq!(statement["amounts_complete"], false);
    assert_eq!(statement["summary"]["cash_paid"], "40");
    assert_eq!(statement["summary"]["invoice_due"], "60");
    assert!(statement["summary"]["external_receivable"].is_null());
    assert!(statement["summary"]["total_due"].is_null());
    assert_eq!(statement["redaction"]["hidden_invoice_amount_count"], 1);
    assert_eq!(statement["redaction"]["external_expense_count"], 1);
    assert_eq!(statement["redaction"]["services_hidden"], true);
    let items = statement["items"].as_array().unwrap();
    assert_eq!(items.len(), 2);
    assert!(
        !items
            .iter()
            .any(|item| item["kind"] == "external_expense" || item["kind"] == "service")
    );
    let hidden = items
        .iter()
        .find(|item| item["payment_state"] == "amount_hidden")
        .unwrap();
    assert!(hidden["amount_gross"].is_null());
    assert!(hidden["amount_due"].is_null());

    let (usd_status, usd_statement) =
        request_json(&app, "/api/v1/me/account-statement?currency=usd", &patient).await;
    assert_eq!(
        usd_status,
        StatusCode::OK,
        "USD portal statement: {usd_statement:?}"
    );
    assert_eq!(usd_statement["currency"], "USD");
    assert_eq!(usd_statement["summary"]["invoice_due"], "70");
    assert_eq!(usd_statement["items"].as_array().unwrap().len(), 1);

    let (invalid_status, _) =
        request_json(&app, "/api/v1/me/account-statement?currency=EURO", &patient).await;
    assert_eq!(invalid_status, StatusCode::UNPROCESSABLE_ENTITY);

    let billing = auth_header_for(billing_id, "billing");
    let (status, _) = request_json(&app, "/api/v1/me/account-statement", &billing).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}
