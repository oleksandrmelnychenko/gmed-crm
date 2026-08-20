mod support;

use axum::body::Body;
use axum::http::{Method, Request, StatusCode};
use rust_decimal::Decimal;
use serde_json::{Value, json};
use sqlx::{PgPool, Row};
use tower::ServiceExt;
use uuid::Uuid;

use gmed_server::auth::jwt;

const TEST_SECRET: &str = "test-secret-at-least-32-characters-long!!";

fn auth_header_for(user_id: Uuid, role: &str) -> String {
    let token = jwt::issue_access_token(TEST_SECRET, user_id, role, Uuid::new_v4()).unwrap();
    format!("Bearer {token}")
}

async fn request_json(
    app: &axum::Router,
    method: Method,
    path: &str,
    bearer: &str,
    body: Option<Value>,
) -> (StatusCode, Value) {
    let mut builder = Request::builder()
        .method(method)
        .uri(path)
        .header("Authorization", bearer);
    let body = if let Some(body) = body {
        builder = builder.header("Content-Type", "application/json");
        Body::from(serde_json::to_vec(&body).unwrap())
    } else {
        Body::empty()
    };
    let response = app.clone().oneshot(builder.body(body).unwrap()).await.unwrap();
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
    .bind(format!("provider-settlement-{tag}-{role}@example.test"))
    .bind(format!("Provider settlement {role} {tag}"))
    .bind(role)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn seed_external_invoice(
    pool: &PgPool,
    admin_id: Uuid,
    tag: &str,
    suffix: &str,
) -> Uuid {
    let patient_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO patients (
               patient_id, first_name, last_name, birth_date, gender, created_by
           ) VALUES ($1, 'Settlement', 'Patient', '1990-01-01', 'diverse', $2)
           RETURNING id"#,
    )
    .bind(format!("PS-{tag}-{suffix}"))
    .bind(admin_id)
    .fetch_one(pool)
    .await
    .unwrap();
    let order_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO orders (
               order_number, patient_id, phase, status, currency, created_by
           ) VALUES ($1, $2, 'execution', 'active', 'EUR', $3)
           RETURNING id"#,
    )
    .bind(format!("PS-{tag}-{suffix}"))
    .bind(patient_id)
    .bind(admin_id)
    .fetch_one(pool)
    .await
    .unwrap();
    let provider_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO providers (
               name, provider_type, address_city, fachbereich, address_country
           ) VALUES ($1, 'medical', 'Berlin', 'Clinic', 'Germany')
           RETURNING id"#,
    )
    .bind(format!("Settlement provider {tag} {suffix}"))
    .fetch_one(pool)
    .await
    .unwrap();
    sqlx::query_scalar(
        r#"INSERT INTO external_invoices (
               order_id, patient_id, provider_id, external_invoice_number,
               invoice_date, due_date, amount_net, amount_vat, amount_gross,
               currency, status, paid_by, created_by
           ) VALUES (
               $1, $2, $3, $4, CURRENT_DATE, CURRENT_DATE,
               84.03, 15.97, 100, 'EUR', 'approved', 'unpaid', $5
           ) RETURNING id"#,
    )
    .bind(order_id)
    .bind(patient_id)
    .bind(provider_id)
    .bind(format!("EXT-{tag}-{suffix}"))
    .bind(admin_id)
    .fetch_one(pool)
    .await
    .unwrap()
}

#[tokio::test]
async fn provider_settlements_are_partial_retry_safe_reversible_and_account_bound() {
    let Some(ctx) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let tag = Uuid::new_v4().simple().to_string();
    let billing_id = seed_user(&ctx.pool, &tag, "billing").await;
    let sales_id = seed_user(&ctx.pool, &tag, "sales").await;
    let billing = auth_header_for(billing_id, "billing");
    let sales = auth_header_for(sales_id, "sales");
    let account_id: Uuid = sqlx::query_scalar(
        "SELECT id FROM company_financial_accounts WHERE currency = 'EUR' AND is_default",
    )
    .fetch_one(&ctx.pool)
    .await
    .unwrap();
    let external_invoice_id =
        seed_external_invoice(&ctx.pool, ctx.admin_id, &tag, "main").await;
    let path = format!(
        "/api/v1/company-provider-liabilities/{external_invoice_id}/settlements"
    );

    let (forbidden, _) = request_json(&ctx.app, Method::GET, &path, &sales, None).await;
    assert_eq!(forbidden, StatusCode::FORBIDDEN);

    let first_request_id = Uuid::new_v4();
    let first_body = json!({
        "request_id": first_request_id,
        "financial_account_id": account_id,
        "amount_gross": "40.00",
        "paid_on": chrono::Utc::now().date_naive().to_string(),
        "payment_method": "bank_transfer",
        "reference": "First installment",
        "note": "Provider confirmed receipt"
    });
    let (first_status, first) = request_json(
        &ctx.app,
        Method::POST,
        &path,
        &billing,
        Some(first_body.clone()),
    )
    .await;
    assert_eq!(first_status, StatusCode::OK, "first payment: {first:?}");
    let first_payment_id = first["transaction"]["id"].as_str().unwrap();

    let (replay_status, replay) = request_json(
        &ctx.app,
        Method::POST,
        &path,
        &billing,
        Some(first_body.clone()),
    )
    .await;
    assert_eq!(replay_status, StatusCode::OK);
    assert_eq!(replay["idempotent_replay"], true);
    assert_eq!(replay["transaction"]["id"], first_payment_id);

    let mut drift = first_body;
    drift["amount_gross"] = json!("41.00");
    let (drift_status, _) =
        request_json(&ctx.app, Method::POST, &path, &billing, Some(drift)).await;
    assert_eq!(drift_status, StatusCode::CONFLICT);

    let second_request_id = Uuid::new_v4();
    let (second_status, second) = request_json(
        &ctx.app,
        Method::POST,
        &path,
        &billing,
        Some(json!({
            "request_id": second_request_id,
            "financial_account_id": account_id,
            "amount_gross": "60.00",
            "paid_on": chrono::Utc::now().date_naive().to_string(),
            "payment_method": "bank_transfer",
            "reference": "Final installment"
        })),
    )
    .await;
    assert_eq!(second_status, StatusCode::OK, "second payment: {second:?}");
    let second_payment_id = second["transaction"]["id"].as_str().unwrap();

    let (summary_status, summary) =
        request_json(&ctx.app, Method::GET, &path, &billing, None).await;
    assert_eq!(summary_status, StatusCode::OK);
    assert_eq!(summary["company_paid_gross"], "100");
    assert_eq!(summary["remaining_provider_liability_gross"], "0");
    assert_eq!(summary["settlement_status"], "paid");
    assert_eq!(summary["transactions"].as_array().unwrap().len(), 2);

    let external = sqlx::query("SELECT status, paid_by FROM external_invoices WHERE id = $1")
        .bind(external_invoice_id)
        .fetch_one(&ctx.pool)
        .await
        .unwrap();
    assert_eq!(external.try_get::<String, _>("status").unwrap(), "paid");
    assert_eq!(external.try_get::<String, _>("paid_by").unwrap(), "agency");
    let accounting_total: Decimal = sqlx::query_scalar(
        r#"SELECT COALESCE(SUM(amount_gross), 0)
           FROM accounting_entries
           WHERE source_external_invoice_id = $1
             AND source_external_provider_payment_transaction_id IS NOT NULL"#,
    )
    .bind(external_invoice_id)
    .fetch_one(&ctx.pool)
    .await
    .unwrap();
    assert_eq!(accounting_total, Decimal::new(100, 0));

    let reversal_path = format!("{path}/{second_payment_id}/reversal");
    let reversal_body = json!({
        "request_id": Uuid::new_v4(),
        "paid_on": chrono::Utc::now().date_naive().to_string(),
        "note": "Bank transfer was rejected"
    });
    let (reversal_status, reversal) = request_json(
        &ctx.app,
        Method::POST,
        &reversal_path,
        &billing,
        Some(reversal_body.clone()),
    )
    .await;
    assert_eq!(reversal_status, StatusCode::OK, "reversal: {reversal:?}");
    let (reversal_replay_status, reversal_replay) = request_json(
        &ctx.app,
        Method::POST,
        &reversal_path,
        &billing,
        Some(reversal_body),
    )
    .await;
    assert_eq!(reversal_replay_status, StatusCode::OK);
    assert_eq!(reversal_replay["idempotent_replay"], true);

    let (_, after_reversal) =
        request_json(&ctx.app, Method::GET, &path, &billing, None).await;
    assert_eq!(after_reversal["company_paid_gross"], "40");
    assert_eq!(after_reversal["remaining_provider_liability_gross"], "60");
    assert_eq!(after_reversal["settlement_status"], "partial");
    assert_eq!(after_reversal["transactions"].as_array().unwrap().len(), 3);

    let provider_id: Uuid = sqlx::query_scalar(
        "SELECT provider_id FROM external_invoices WHERE id = $1",
    )
    .bind(external_invoice_id)
    .fetch_one(&ctx.pool)
    .await
    .unwrap();
    let statement_path = format!(
        "/api/v1/company-provider-statements/{provider_id}?currency=EUR&from=2020-01-01&to=2099-12-31"
    );
    let (statement_status, statement) =
        request_json(&ctx.app, Method::GET, &statement_path, &billing, None).await;
    assert_eq!(statement_status, StatusCode::OK, "statement: {statement:?}");
    assert_eq!(statement["summary"]["opening_balance"], "0");
    assert_eq!(statement["summary"]["charged_gross"], "100");
    assert_eq!(statement["summary"]["paid_gross"], "100");
    assert_eq!(statement["summary"]["reversed_gross"], "60");
    assert_eq!(statement["summary"]["expected_gross"], "0");
    assert_eq!(statement["summary"]["closing_balance"], "60");
    let statement_movements = statement["movements"].as_array().unwrap();
    assert_eq!(statement_movements.len(), 4);
    assert_eq!(statement_movements[0]["movement_type"], "invoice");
    assert_eq!(statement_movements[3]["movement_type"], "reversal");
    assert_eq!(statement_movements[3]["running_balance"], "60");

    let tomorrow = chrono::Utc::now()
        .date_naive()
        .succ_opt()
        .expect("tomorrow");
    let opening_path = format!(
        "/api/v1/company-provider-statements/{provider_id}?currency=EUR&from={tomorrow}&to=2099-12-31"
    );
    let (opening_status, opening_statement) =
        request_json(&ctx.app, Method::GET, &opening_path, &billing, None).await;
    assert_eq!(opening_status, StatusCode::OK);
    assert_eq!(opening_statement["summary"]["opening_balance"], "60");
    assert_eq!(opening_statement["summary"]["charged_gross"], "0");
    assert_eq!(opening_statement["summary"]["paid_gross"], "0");
    assert_eq!(opening_statement["summary"]["closing_balance"], "60");
    assert!(opening_statement["movements"].as_array().unwrap().is_empty());

    let (statement_forbidden, _) =
        request_json(&ctx.app, Method::GET, &statement_path, &sales, None).await;
    assert_eq!(statement_forbidden, StatusCode::FORBIDDEN);

    let external = sqlx::query("SELECT status, paid_by FROM external_invoices WHERE id = $1")
        .bind(external_invoice_id)
        .fetch_one(&ctx.pool)
        .await
        .unwrap();
    assert_eq!(external.try_get::<String, _>("status").unwrap(), "approved");
    assert_eq!(external.try_get::<String, _>("paid_by").unwrap(), "unpaid");

    let concurrent_invoice_id =
        seed_external_invoice(&ctx.pool, ctx.admin_id, &tag, "concurrent").await;
    let concurrent_path = format!(
        "/api/v1/company-provider-liabilities/{concurrent_invoice_id}/settlements"
    );
    let payment_body = |request_id| {
        json!({
            "request_id": request_id,
            "financial_account_id": account_id,
            "amount_gross": "70.00",
            "paid_on": chrono::Utc::now().date_naive().to_string(),
            "payment_method": "bank_transfer"
        })
    };
    let (left, right) = tokio::join!(
        request_json(
            &ctx.app,
            Method::POST,
            &concurrent_path,
            &billing,
            Some(payment_body(Uuid::new_v4())),
        ),
        request_json(
            &ctx.app,
            Method::POST,
            &concurrent_path,
            &billing,
            Some(payment_body(Uuid::new_v4())),
        ),
    );
    let statuses = [left.0, right.0];
    assert_eq!(statuses.iter().filter(|status| **status == StatusCode::OK).count(), 1);
    assert_eq!(
        statuses
            .iter()
            .filter(|status| **status == StatusCode::CONFLICT)
            .count(),
        1
    );
}
