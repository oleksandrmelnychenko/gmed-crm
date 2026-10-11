mod support;

use axum::body::Body;
use axum::http::{Method, Request, StatusCode};
use rust_decimal::Decimal;
use serde_json::{Value, json};
use sqlx::PgPool;
use std::str::FromStr;
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
    let response = app
        .clone()
        .oneshot(builder.body(body).unwrap())
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
    .bind(format!("account-transfer-{tag}-{role}@example.test"))
    .bind(format!("Account transfer {role} {tag}"))
    .bind(role)
    .fetch_one(pool)
    .await
    .unwrap()
}

fn account_balance(payload: &Value, account_id: Uuid) -> Decimal {
    let value = payload["items"]
        .as_array()
        .unwrap()
        .iter()
        .find(|account| account["id"] == account_id.to_string())
        .unwrap()["current_balance"]
        .as_str()
        .unwrap();
    Decimal::from_str(value).unwrap()
}

fn total_balance(payload: &Value) -> Decimal {
    payload["items"]
        .as_array()
        .unwrap()
        .iter()
        .map(|account| Decimal::from_str(account["current_balance"].as_str().unwrap()).unwrap())
        .sum()
}

#[tokio::test]
async fn internal_transfers_preserve_company_cash_and_are_reversible() {
    let Some(ctx) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let tag = Uuid::new_v4().simple().to_string();
    let billing_id = seed_user(&ctx.pool, &tag, "billing").await;
    let sales_id = seed_user(&ctx.pool, &tag, "sales").await;
    let billing = auth_header_for(billing_id, "billing");
    let sales = auth_header_for(sales_id, "sales");
    let list_path = "/api/v1/company-financial-accounts?currency=EUR&include_inactive=true";

    let (initial_status, initial) =
        request_json(&ctx.app, Method::GET, list_path, &billing, None).await;
    assert_eq!(
        initial_status,
        StatusCode::OK,
        "initial accounts: {initial:?}"
    );
    let source_account_id = Uuid::parse_str(
        initial["items"]
            .as_array()
            .unwrap()
            .iter()
            .find(|account| account["is_default"] == true)
            .unwrap()["id"]
            .as_str()
            .unwrap(),
    )
    .unwrap();

    let (cash_status, cash) = request_json(
        &ctx.app,
        Method::POST,
        "/api/v1/company-financial-accounts",
        &billing,
        Some(json!({
            "name": format!("Transfer cash {tag}"),
            "account_type": "cash",
            "currency": "EUR",
            "opening_balance": "100.00",
            "opening_balance_on": "2020-01-01",
            "is_default": false
        })),
    )
    .await;
    assert_eq!(cash_status, StatusCode::CREATED, "cash account: {cash:?}");
    let target_account_id = Uuid::parse_str(cash["id"].as_str().unwrap()).unwrap();

    let (usd_status, usd) = request_json(
        &ctx.app,
        Method::POST,
        "/api/v1/company-financial-accounts",
        &billing,
        Some(json!({
            "name": format!("Transfer USD {tag}"),
            "account_type": "bank",
            "currency": "USD",
            "opening_balance": "50.00",
            "opening_balance_on": "2020-01-01",
            "is_default": false
        })),
    )
    .await;
    assert_eq!(usd_status, StatusCode::CREATED, "USD account: {usd:?}");
    let usd_account_id = Uuid::parse_str(usd["id"].as_str().unwrap()).unwrap();

    let (_, before) = request_json(&ctx.app, Method::GET, list_path, &billing, None).await;
    let total_before = total_balance(&before);
    let source_before = account_balance(&before, source_account_id);
    let target_before = account_balance(&before, target_account_id);
    let request_id = Uuid::new_v4();
    let transfer_body = json!({
        "request_id": request_id,
        "source_account_id": source_account_id,
        "target_account_id": target_account_id,
        "amount": "30.00",
        "effective_on": gmed_server::app_time::today().to_string(),
        "reference": "Cash replenishment",
        "note": "Internal transfer test",
        // The bank account's balance in a fresh database may be below 30.
        "confirm_negative_balance": true
    });

    let (forbidden_status, _) = request_json(
        &ctx.app,
        Method::POST,
        "/api/v1/company-financial-account-transfers",
        &sales,
        Some(transfer_body.clone()),
    )
    .await;
    assert_eq!(forbidden_status, StatusCode::FORBIDDEN);

    let (wrong_currency_status, _) = request_json(
        &ctx.app,
        Method::POST,
        "/api/v1/company-financial-account-transfers",
        &billing,
        Some(json!({
            "request_id": Uuid::new_v4(),
            "source_account_id": source_account_id,
            "target_account_id": usd_account_id,
            "amount": "30.00",
            "effective_on": gmed_server::app_time::today().to_string()
        })),
    )
    .await;
    assert_eq!(wrong_currency_status, StatusCode::UNPROCESSABLE_ENTITY);

    let (transfer_status, transfer) = request_json(
        &ctx.app,
        Method::POST,
        "/api/v1/company-financial-account-transfers",
        &billing,
        Some(transfer_body.clone()),
    )
    .await;
    assert_eq!(
        transfer_status,
        StatusCode::CREATED,
        "transfer: {transfer:?}"
    );
    let transfer_id = Uuid::parse_str(transfer["id"].as_str().unwrap()).unwrap();

    let (replay_status, replay) = request_json(
        &ctx.app,
        Method::POST,
        "/api/v1/company-financial-account-transfers",
        &billing,
        Some(transfer_body.clone()),
    )
    .await;
    assert_eq!(replay_status, StatusCode::OK);
    assert_eq!(replay["id"], transfer_id.to_string());
    assert_eq!(replay["idempotent_replay"], true);

    let mut drift = transfer_body;
    drift["amount"] = json!("31.00");
    let (drift_status, _) = request_json(
        &ctx.app,
        Method::POST,
        "/api/v1/company-financial-account-transfers",
        &billing,
        Some(drift),
    )
    .await;
    assert_eq!(drift_status, StatusCode::CONFLICT);

    let (_, after) = request_json(&ctx.app, Method::GET, list_path, &billing, None).await;
    assert_eq!(total_balance(&after), total_before);
    assert_eq!(
        account_balance(&after, source_account_id),
        source_before - Decimal::from(30)
    );
    assert_eq!(
        account_balance(&after, target_account_id),
        target_before + Decimal::from(30)
    );
    assert_eq!(
        after["transfers"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|row| row["id"] == transfer_id.to_string())
            .count(),
        1
    );

    let reversal_path =
        format!("/api/v1/company-financial-account-transfers/{transfer_id}/reversal");
    let reversal_body = json!({
        "request_id": Uuid::new_v4(),
        "effective_on": gmed_server::app_time::today().to_string(),
        "reference": "Transfer correction"
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

    let (_, final_accounts) = request_json(&ctx.app, Method::GET, list_path, &billing, None).await;
    assert_eq!(total_balance(&final_accounts), total_before);
    assert_eq!(
        account_balance(&final_accounts, source_account_id),
        source_before
    );
    assert_eq!(
        account_balance(&final_accounts, target_account_id),
        target_before
    );

    let immutable =
        sqlx::query("UPDATE company_financial_account_transfers SET amount = 31 WHERE id = $1")
            .bind(transfer_id)
            .execute(&ctx.pool)
            .await;
    assert!(immutable.is_err(), "internal transfers must be append-only");
}

async fn create_account(
    app: &axum::Router,
    bearer: &str,
    name: String,
    account_type: &str,
    opening_balance: &str,
) -> Uuid {
    let (status, body) = request_json(
        app,
        Method::POST,
        "/api/v1/company-financial-accounts",
        bearer,
        Some(json!({
            "name": name,
            "account_type": account_type,
            "currency": "EUR",
            "opening_balance": opening_balance,
            "opening_balance_on": "2020-01-01",
            "is_default": false
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "create account: {body:?}");
    Uuid::parse_str(body["id"].as_str().unwrap()).unwrap()
}

/// A cash box never goes below zero (transfer, its reversal and a
/// reconciliation outflow are refused); a bank account may, but only when the
/// transfer is confirmed.
#[tokio::test]
async fn transfers_respect_the_source_balance() {
    let Some(ctx) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let tag = Uuid::new_v4().simple().to_string();
    let billing_id = seed_user(&ctx.pool, &tag, "billing").await;
    let billing = auth_header_for(billing_id, "billing");
    let list_path = "/api/v1/company-financial-accounts?currency=EUR&include_inactive=true";
    let today = gmed_server::app_time::today().to_string();
    let transfers = "/api/v1/company-financial-account-transfers";

    // A role without the right gets 403 even for a malformed body.
    let sales = auth_header_for(seed_user(&ctx.pool, &tag, "sales").await, "sales");
    let (status, _) =
        request_json(&ctx.app, Method::POST, transfers, &sales, Some(json!({}))).await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    let cash = create_account(&ctx.app, &billing, format!("Kasse {tag}"), "cash", "50.00").await;
    let bank = create_account(&ctx.app, &billing, format!("Bank {tag}"), "bank", "100.00").await;
    let other_bank =
        create_account(&ctx.app, &billing, format!("Bank 2 {tag}"), "bank", "0.00").await;

    // Cash 50 -> 100 out: refused with the available balance.
    let (status, body) = request_json(
        &ctx.app,
        Method::POST,
        transfers,
        &billing,
        Some(json!({
            "request_id": Uuid::new_v4(),
            "source_account_id": cash,
            "target_account_id": bank,
            "amount": "100.00",
            "effective_on": today,
            "confirm_negative_balance": true
        })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body:?}");
    assert_eq!(body["error"], "cash_account_insufficient_balance");
    assert_eq!(body["available_balance"], "50");

    // The whole cash balance may leave.
    let (status, body) = request_json(
        &ctx.app,
        Method::POST,
        transfers,
        &billing,
        Some(json!({
            "request_id": Uuid::new_v4(),
            "source_account_id": cash,
            "target_account_id": bank,
            "amount": "50.00",
            "effective_on": today
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{body:?}");

    // Bank 150 -> 200 out: needs the confirmation, then goes through.
    let overdraft = json!({
        "request_id": Uuid::new_v4(),
        "source_account_id": bank,
        "target_account_id": other_bank,
        "amount": "200.00",
        "effective_on": today
    });
    let (status, body) = request_json(
        &ctx.app,
        Method::POST,
        transfers,
        &billing,
        Some(overdraft.clone()),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{body:?}");
    assert_eq!(
        body["error"],
        "account_negative_balance_confirmation_required"
    );
    assert_eq!(body["confirm_field"], "confirm_negative_balance");
    assert_eq!(body["available_balance"], "150");
    assert_eq!(body["balance_after"], "-50");
    let mut confirmed = overdraft;
    confirmed["confirm_negative_balance"] = json!(true);
    let (status, body) =
        request_json(&ctx.app, Method::POST, transfers, &billing, Some(confirmed)).await;
    assert_eq!(status, StatusCode::CREATED, "{body:?}");

    let (_, accounts) = request_json(&ctx.app, Method::GET, list_path, &billing, None).await;
    assert_eq!(account_balance(&accounts, cash), Decimal::ZERO);
    assert_eq!(account_balance(&accounts, bank), Decimal::from(-50));
    assert_eq!(account_balance(&accounts, other_bank), Decimal::from(200));

    // Bank 2 -> cash 20, then the cash spends it: the reversal of the first
    // transfer would take the cash box below zero.
    let (status, body) = request_json(
        &ctx.app,
        Method::POST,
        transfers,
        &billing,
        Some(json!({
            "request_id": Uuid::new_v4(),
            "source_account_id": other_bank,
            "target_account_id": cash,
            "amount": "20.00",
            "effective_on": today
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{body:?}");
    let refill_id = body["id"].as_str().unwrap().to_string();
    let (status, body) = request_json(
        &ctx.app,
        Method::POST,
        &format!("/api/v1/company-financial-accounts/{cash}/adjustments"),
        &billing,
        Some(json!({
            "request_id": Uuid::new_v4(),
            "direction": "outflow",
            "amount": "25.00",
            "effective_on": today,
            "reason": "Kassensturz"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body:?}");
    assert_eq!(body["error"], "cash_account_insufficient_balance");
    let (status, body) = request_json(
        &ctx.app,
        Method::POST,
        &format!("/api/v1/company-financial-accounts/{cash}/adjustments"),
        &billing,
        Some(json!({
            "request_id": Uuid::new_v4(),
            "direction": "outflow",
            "amount": "15.00",
            "effective_on": today,
            "reason": "Kassensturz"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{body:?}");
    let (status, body) = request_json(
        &ctx.app,
        Method::POST,
        &format!("{transfers}/{refill_id}/reversal"),
        &billing,
        Some(json!({
            "request_id": Uuid::new_v4(),
            "effective_on": today,
            "reference": "Falsch gebucht"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body:?}");
    assert_eq!(body["error"], "cash_account_insufficient_balance");
    assert_eq!(body["available_balance"], "5");
}
