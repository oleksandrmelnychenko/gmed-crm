mod support;

use axum::body::Body;
use axum::http::{Method, Request, StatusCode};
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
    .bind(format!("financial-account-{tag}-{role}@example.test"))
    .bind(format!("Financial account {role} {tag}"))
    .bind(role)
    .fetch_one(pool)
    .await
    .unwrap()
}

#[tokio::test]
async fn company_accounts_track_real_cash_and_keep_adjustments_auditable() {
    let Some(ctx) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let tag = Uuid::new_v4().simple().to_string();
    let billing_id = seed_user(&ctx.pool, &tag, "billing").await;
    let sales_id = seed_user(&ctx.pool, &tag, "sales").await;
    let patient_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO patients (
               patient_id, first_name, last_name, birth_date, gender, created_by
           ) VALUES ($1, 'Account', 'Patient', '1990-01-01', 'diverse', $2)
           RETURNING id"#,
    )
    .bind(format!("FA-{tag}"))
    .bind(ctx.admin_id)
    .fetch_one(&ctx.pool)
    .await
    .unwrap();
    let order_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO orders (
               order_number, patient_id, phase, status, currency, created_by
           ) VALUES ($1, $2, 'execution', 'active', 'EUR', $3)
           RETURNING id"#,
    )
    .bind(format!("FA-{tag}"))
    .bind(patient_id)
    .bind(ctx.admin_id)
    .fetch_one(&ctx.pool)
    .await
    .unwrap();
    let invoice_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO invoices (
               order_id, patient_id, invoice_number, invoice_type, status,
               total_net, total_vat, total_gross, line_items,
               portal_visible, created_by
           ) VALUES ($1, $2, $3, 'final', 'sent', 30, 0, 30, '[]', true, $4)
           RETURNING id"#,
    )
    .bind(order_id)
    .bind(patient_id)
    .bind(format!("FA-{tag}"))
    .bind(ctx.admin_id)
    .fetch_one(&ctx.pool)
    .await
    .unwrap();
    let payment_transaction_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO invoice_payment_transactions (
               invoice_id, transaction_type, request_id, amount_gross,
               payment_method, received_on, created_by
           ) VALUES ($1, 'payment', $2, 30, 'bank_transfer', CURRENT_DATE, $3)
           RETURNING id"#,
    )
    .bind(invoice_id)
    .bind(Uuid::new_v4())
    .bind(ctx.admin_id)
    .fetch_one(&ctx.pool)
    .await
    .unwrap();

    let mut entry_ids = Vec::new();
    for (category, amount) in [("service_revenue", 20_i64), ("cost_passthrough_revenue", 10_i64)] {
        let entry_id: Uuid = sqlx::query_scalar(
            r#"INSERT INTO accounting_entries (
                   entry_kind, direction, category, source_invoice_id,
                   source_invoice_payment_transaction_id, order_id, patient_id,
                   entry_date, description, amount_net, amount_vat,
                   amount_gross, currency, created_by
               ) VALUES (
                   'invoice_payment', 'income', $1, $2, $3, $4, $5,
                   CURRENT_DATE, $6, $7, 0, $7, 'EUR', $8
               ) RETURNING id"#,
        )
        .bind(category)
        .bind(invoice_id)
        .bind(payment_transaction_id)
        .bind(order_id)
        .bind(patient_id)
        .bind(format!("Financial account movement {category}"))
        .bind(amount)
        .bind(ctx.admin_id)
        .fetch_one(&ctx.pool)
        .await
        .unwrap();
        entry_ids.push(entry_id);
    }

    let billing = auth_header_for(billing_id, "billing");
    let sales = auth_header_for(sales_id, "sales");
    let list_path = "/api/v1/company-financial-accounts?currency=EUR&include_inactive=true";
    let (initial_status, initial) =
        request_json(&ctx.app, Method::GET, list_path, &billing, None).await;
    assert_eq!(initial_status, StatusCode::OK, "initial accounts: {initial:?}");
    let default_account = initial["items"]
        .as_array()
        .unwrap()
        .iter()
        .find(|account| account["is_default"] == true)
        .unwrap();
    assert_eq!(default_account["movement_balance"], "30");

    let (forbidden_status, _) =
        request_json(&ctx.app, Method::GET, list_path, &sales, None).await;
    assert_eq!(forbidden_status, StatusCode::FORBIDDEN);

    let (create_status, created) = request_json(
        &ctx.app,
        Method::POST,
        "/api/v1/company-financial-accounts",
        &billing,
        Some(json!({
            "name": format!("GMED Cash {tag}"),
            "account_type": "cash",
            "currency": "eur",
            "opening_balance": "100.00",
            "opening_balance_on": "2020-01-01",
            "is_default": false
        })),
    )
    .await;
    assert_eq!(create_status, StatusCode::CREATED, "create account: {created:?}");
    let cash_account_id = Uuid::parse_str(created["id"].as_str().unwrap()).unwrap();

    let (usd_status, usd) = request_json(
        &ctx.app,
        Method::POST,
        "/api/v1/company-financial-accounts",
        &billing,
        Some(json!({
            "name": format!("GMED USD {tag}"),
            "account_type": "bank",
            "currency": "USD",
            "opening_balance": "0",
            "opening_balance_on": "2020-01-01",
            "is_default": true
        })),
    )
    .await;
    assert_eq!(usd_status, StatusCode::CREATED, "create USD: {usd:?}");
    let usd_account_id = Uuid::parse_str(usd["id"].as_str().unwrap()).unwrap();

    let assignment_path = format!(
        "/api/v1/accounting-entries/{}/financial-account",
        entry_ids[0]
    );
    let (wrong_currency_status, _) = request_json(
        &ctx.app,
        Method::POST,
        &assignment_path,
        &billing,
        Some(json!({ "financial_account_id": usd_account_id })),
    )
    .await;
    assert_eq!(wrong_currency_status, StatusCode::UNPROCESSABLE_ENTITY);

    let (assign_status, assigned) = request_json(
        &ctx.app,
        Method::POST,
        &assignment_path,
        &billing,
        Some(json!({ "financial_account_id": cash_account_id })),
    )
    .await;
    assert_eq!(assign_status, StatusCode::OK, "assign: {assigned:?}");
    assert_eq!(assigned["updated_count"], 2);

    let request_id = Uuid::new_v4();
    let adjustment_path = format!(
        "/api/v1/company-financial-accounts/{cash_account_id}/adjustments"
    );
    let adjustment_body = json!({
        "request_id": request_id,
        "direction": "outflow",
        "amount": "5.00",
        "effective_on": chrono::Utc::now().date_naive().to_string(),
        "reason": "Cash count correction",
        "note": "Internal reconciliation"
    });
    let (adjust_status, adjusted) = request_json(
        &ctx.app,
        Method::POST,
        &adjustment_path,
        &billing,
        Some(adjustment_body.clone()),
    )
    .await;
    assert_eq!(adjust_status, StatusCode::CREATED, "adjust: {adjusted:?}");
    let adjustment_id = Uuid::parse_str(adjusted["id"].as_str().unwrap()).unwrap();

    let (replay_status, replay) = request_json(
        &ctx.app,
        Method::POST,
        &adjustment_path,
        &billing,
        Some(adjustment_body.clone()),
    )
    .await;
    assert_eq!(replay_status, StatusCode::OK);
    assert_eq!(replay["id"], adjustment_id.to_string());
    assert_eq!(replay["idempotent_replay"], true);

    let mut drift = adjustment_body;
    drift["amount"] = json!("6.00");
    let (drift_status, _) = request_json(
        &ctx.app,
        Method::POST,
        &adjustment_path,
        &billing,
        Some(drift),
    )
    .await;
    assert_eq!(drift_status, StatusCode::CONFLICT);

    let (_, after_adjustment) =
        request_json(&ctx.app, Method::GET, list_path, &billing, None).await;
    let cash_after_adjustment = after_adjustment["items"]
        .as_array()
        .unwrap()
        .iter()
        .find(|account| account["id"] == cash_account_id.to_string())
        .unwrap();
    assert_eq!(cash_after_adjustment["opening_balance"], "100");
    assert_eq!(cash_after_adjustment["movement_balance"], "30");
    assert_eq!(cash_after_adjustment["adjustment_balance"], "-5");
    assert_eq!(cash_after_adjustment["current_balance"], "125");

    let reversal_path = format!(
        "/api/v1/company-financial-accounts/{cash_account_id}/adjustments/{adjustment_id}/reversal"
    );
    let reversal_body = json!({
        "request_id": Uuid::new_v4(),
        "effective_on": chrono::Utc::now().date_naive().to_string(),
        "reason": "Correction was entered by mistake"
    });
    let (reverse_status, reversed) = request_json(
        &ctx.app,
        Method::POST,
        &reversal_path,
        &billing,
        Some(reversal_body.clone()),
    )
    .await;
    assert_eq!(reverse_status, StatusCode::OK, "reverse: {reversed:?}");

    let (reverse_replay_status, reverse_replay) = request_json(
        &ctx.app,
        Method::POST,
        &reversal_path,
        &billing,
        Some(reversal_body),
    )
    .await;
    assert_eq!(reverse_replay_status, StatusCode::OK);
    assert_eq!(reverse_replay["idempotent_replay"], true);

    let (_, final_accounts) =
        request_json(&ctx.app, Method::GET, list_path, &billing, None).await;
    let cash_final = final_accounts["items"]
        .as_array()
        .unwrap()
        .iter()
        .find(|account| account["id"] == cash_account_id.to_string())
        .unwrap();
    assert_eq!(cash_final["current_balance"], "130");

    let update_result = sqlx::query(
        "UPDATE company_financial_account_adjustments SET amount = 6 WHERE id = $1",
    )
    .bind(adjustment_id)
    .execute(&ctx.pool)
    .await;
    assert!(update_result.is_err(), "account adjustments must be immutable");
}
