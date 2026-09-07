// Audit regressions: run explicitly with --ignored against a disposable database.
// Assertions describe the expected correct behavior; failures reproduce defects.

use axum::body::Body;
use axum::http::{Request, StatusCode};
use rust_decimal::Decimal;
use serde_json::{Value, json};
use sqlx::PgPool;
use tower::ServiceExt;
use uuid::Uuid;

use gmed_server::auth::jwt;
#[allow(dead_code)]
mod support;

const TEST_SECRET: &str = "test-secret-at-least-32-characters-long!!";

async fn test_context() -> Option<(axum::Router, PgPool, Uuid)> {
    // No application data is cloned. This DB contains schema only and synthetic
    // records; using it separates route defects from the broken fresh migration.
    let url = std::env::var("AUDIT_TEST_DATABASE_URL")
        .expect("Set AUDIT_TEST_DATABASE_URL to the isolated schema-only audit DB");
    assert!(
        url.contains("@127.0.0.1:55497/accounting_audit_20260907")
            || url.contains("@gmed-accounting-integrity-pg/accounting_audit_20260907")
    );
    let pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(4)
        .connect(&url)
        .await
        .expect("Audit database must be available");
    let admin = seed_user(&pool, &unique_tag("audit-ceo"), "ceo").await;
    sqlx::query("INSERT INTO company_financial_accounts(name,account_type,currency,opening_balance,opening_balance_on,is_default,created_by) SELECT 'Audit default bank','bank','EUR',0,'2020-01-01',true,$1 WHERE NOT EXISTS(SELECT 1 FROM company_financial_accounts WHERE currency='EUR' AND is_default)")
        .bind(admin).execute(&pool).await.unwrap();
    let state = gmed_server::state::AppState::new(
        pool.clone(),
        TEST_SECRET,
        gmed_server::settings::SettingsCache::new(gmed_server::settings::TokenSettings::default()),
    )
    .with_audit_sender(gmed_server::audit::spawn_writer(
        pool.clone(),
        "audit-test-only".to_string(),
    ));
    let app = gmed_server::build_app_for_role_contract_tests(state).layer(axum::Extension(
        axum::extract::ConnectInfo("127.0.0.1:40123".parse::<std::net::SocketAddr>().unwrap()),
    ));
    Some((app, pool, admin))
}

fn unique_tag(prefix: &str) -> String {
    format!("{prefix}-{}", Uuid::new_v4().simple())
}

fn auth_header_for(user_id: Uuid, role: &str) -> String {
    let token = jwt::issue_access_token(TEST_SECRET, user_id, role, Uuid::new_v4()).unwrap();
    format!("Bearer {token}")
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
           ) VALUES ($1, 'Payment', 'Journal', '1990-01-01', 'diverse', $2)
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
           VALUES ($1, $2, $3)"#,
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
        r#"INSERT INTO orders (order_number, patient_id, phase, status, created_by)
           VALUES ($1, $2, 'execution', 'active', $3)
           RETURNING id"#,
    )
    .bind(format!("ORD-{tag}"))
    .bind(patient_id)
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
    tag: &str,
    invoice_type: &str,
    gross: i64,
    hide_amounts: bool,
) -> Uuid {
    let net = Decimal::new(gross, 0) * Decimal::new(100, 0) / Decimal::new(119, 0);
    let net = net.round_dp(2);
    let gross = Decimal::new(gross, 0);
    sqlx::query_scalar(
        r#"INSERT INTO invoices (
                order_id, patient_id, invoice_number, invoice_type, status,
                due_date, total_net, total_vat, total_gross, paid_amount,
                line_items, notes, portal_visible, hide_amounts_from_patient, created_by
           ) VALUES (
                $1, $2, $3, $4, 'sent', CURRENT_DATE + 14,
                $5, $6, $7, 0, $8, 'Payment journal test', true, $9, $10
           ) RETURNING id"#,
    )
    .bind(order_id)
    .bind(patient_id)
    .bind(format!("INV-{tag}"))
    .bind(invoice_type)
    .bind(net)
    .bind(gross - net)
    .bind(gross)
    .bind(json!([{
        "description": "Care service",
        "quantity": "1",
        "unit_price": net.to_string(),
        "vat_rate": "19",
        "is_cost_passthrough": false,
        "line_net": net.to_string(),
        "line_vat": (gross - net).to_string(),
        "line_gross": gross.to_string()
    }]))
    .bind(hide_amounts)
    .bind(created_by)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn record_payment(
    app: &axum::Router,
    bearer: &str,
    invoice_id: Uuid,
    request_id: Uuid,
    amount: i64,
    reference: &str,
) -> Value {
    let (status, body) = json_request(
        app,
        "POST",
        &format!("/api/v1/invoices/{invoice_id}/payments"),
        bearer,
        Some(json!({
            "request_id": request_id,
            "amount_gross": amount,
            "payment_method": "bank_transfer",
            "payment_reference": reference,
            "received_on": chrono::Utc::now().date_naive().to_string(),
            "note": format!("Internal {reference}")
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "payment response: {body:?}");
    body
}

async fn audit_case() -> (axum::Router, PgPool, Uuid, Uuid, Uuid, String) {
    let (app, pool, admin) = test_context()
        .await
        .expect("Audit requires an isolated test database; must not skip");
    let tag = unique_tag("accounting-audit");
    let patient = seed_patient(&pool, admin, &tag).await;
    let billing = seed_user(&pool, &tag, "billing").await;
    seed_assignment(&pool, patient, billing, admin).await;
    let order = seed_order(&pool, patient, admin, &tag).await;
    (
        app,
        pool,
        admin,
        patient,
        order,
        auth_header_for(admin, "ceo"),
    )
}

async fn credit(app: &axum::Router, bearer: &str, invoice: Uuid) -> Value {
    let (status, body) = json_request(app, "POST", &format!("/api/v1/invoices/{invoice}/credit-notes"), bearer,
        Some(json!({"request_id":Uuid::new_v4(),"amount_gross":40,"reason":"Audit credit","issued_on":chrono::Utc::now().date_naive().to_string()}))).await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    body
}

#[tokio::test]
#[ignore = "Audit: paid status survives credit reversal after a cash refund"]
async fn audit_refunded_invoice_must_reopen_after_credit_reversal() {
    let (app, pool, admin, patient, order, bearer) = audit_case().await;
    let invoice = seed_invoice(
        &pool,
        order,
        patient,
        admin,
        &unique_tag("refund"),
        "final",
        100,
        false,
    )
    .await;
    record_payment(&app, &bearer, invoice, Uuid::new_v4(), 100, "paid").await;
    let credit = credit(&app, &bearer, invoice).await;
    let (status, refund) = json_request(&app,"POST",&format!("/api/v1/invoices/{invoice}/refunds"),&bearer,
        Some(json!({"request_id":Uuid::new_v4(),"amount_gross":40,"payment_method":"bank_transfer","refunded_on":chrono::Utc::now().date_naive().to_string(),"reason":"Audit refund"}))).await;
    assert_eq!(status, StatusCode::CREATED, "{refund}");
    let credit_id = credit["credit_note_transaction_id"].as_str().unwrap();
    let (status, result) = json_request(
        &app,
        "POST",
        &format!("/api/v1/invoices/{invoice}/credit-notes/{credit_id}/reversal"),
        &bearer,
        Some(json!({"reason":"Credit withdrawn"})),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{result}");
    assert_eq!(result["invoice"]["balance_due"], "40");
    assert_eq!(
        result["invoice"]["status"], "partially_paid",
        "40 remains payable after refund and credit reversal"
    );
}

#[tokio::test]
#[ignore = "Audit: allocated advance receipt can be reversed without releasing its allocation"]
async fn audit_allocated_advance_payment_reversal_must_be_blocked() {
    let (app, pool, admin, patient, order, bearer) = audit_case().await;
    let advance = seed_invoice(
        &pool,
        order,
        patient,
        admin,
        &unique_tag("advance"),
        "advance",
        100,
        false,
    )
    .await;
    let target = seed_invoice(
        &pool,
        order,
        patient,
        admin,
        &unique_tag("target"),
        "final",
        100,
        false,
    )
    .await;
    let payment = record_payment(&app, &bearer, advance, Uuid::new_v4(), 100, "advance").await;
    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/invoices/{target}/prepayment-allocations"),
        &bearer,
        Some(json!({"request_id":Uuid::new_v4(),"advance_invoice_id":advance,"amount_gross":100})),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let payment_id = payment["payment_transaction_id"].as_str().unwrap();
    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/invoices/{advance}/payments/{payment_id}/reversal"),
        &bearer,
        Some(json!({"note":"Reverse advance"})),
    )
    .await;
    let allocated: Decimal = sqlx::query_scalar("SELECT COALESCE(sum(amount_gross),0) FROM invoice_prepayment_allocations WHERE advance_invoice_id=$1").bind(advance).fetch_one(&pool).await.unwrap();
    let cash: Decimal = sqlx::query_scalar("SELECT paid_amount FROM invoices WHERE id=$1")
        .bind(advance)
        .fetch_one(&pool)
        .await
        .unwrap();
    eprintln!("allocated={allocated}, retained_cash={cash}, reversal_http={status}");
    assert_eq!(
        status,
        StatusCode::CONFLICT,
        "Must release the 100 allocation first: {body}"
    );
    let db_error = sqlx::query("INSERT INTO invoice_payment_transactions(invoice_id,transaction_type,amount_gross,payment_method,received_on,created_by,reverses_transaction_id) VALUES($1,'reversal',100,'bank_transfer',CURRENT_DATE,$2,$3)")
        .bind(advance).bind(admin).bind(Uuid::parse_str(payment_id).unwrap()).execute(&pool).await.unwrap_err();
    assert!(
        db_error
            .to_string()
            .contains("applied advances without cash"),
        "{db_error}"
    );
}

#[tokio::test]
#[ignore = "Audit: company position omits refundable cash credits on settlement invoices"]
async fn audit_company_position_must_include_invoice_cash_credit() {
    let (app, pool, admin, patient, order, bearer) = audit_case().await;
    let invoice = seed_invoice(
        &pool,
        order,
        patient,
        admin,
        &unique_tag("credit"),
        "final",
        100,
        false,
    )
    .await;
    record_payment(&app, &bearer, invoice, Uuid::new_v4(), 100, "paid").await;
    credit(&app, &bearer, invoice).await;
    let (status, statement) = json_request(
        &app,
        "GET",
        &format!("/api/v1/patients/{patient}/account-statement?currency=EUR"),
        &bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{statement}");
    assert_eq!(statement["summary"]["closing_balance"], "-40");
    let (status, company) = json_request(
        &app,
        "GET",
        "/api/v1/company-financial-position?currency=EUR",
        &bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{company}");
    let position = company["patient_positions"]
        .as_array()
        .unwrap()
        .iter()
        .find(|p| p["patient_id"] == patient.to_string());
    assert_eq!(
        position.map(|p| p["calculated_balance"].clone()),
        Some(json!("-40")),
        "Company position must agree with patient statement"
    );
}

#[tokio::test]
#[ignore = "Audit: reversal date can precede the receipt date"]
async fn audit_payment_reversal_must_not_precede_receipt() {
    let (app, pool, admin, patient, order, bearer) = audit_case().await;
    let invoice = seed_invoice(
        &pool,
        order,
        patient,
        admin,
        &unique_tag("dates"),
        "final",
        100,
        false,
    )
    .await;
    let payment = record_payment(&app, &bearer, invoice, Uuid::new_v4(), 100, "today").await;
    let payment_id = payment["payment_transaction_id"].as_str().unwrap();
    let yesterday = (chrono::Utc::now().date_naive() - chrono::Duration::days(1)).to_string();
    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/invoices/{invoice}/payments/{payment_id}/reversal"),
        &bearer,
        Some(json!({"note":"Audit date","reversed_on":yesterday})),
    )
    .await;
    assert!(
        status == StatusCode::CONFLICT || status == StatusCode::UNPROCESSABLE_ENTITY,
        "Expected rejection of reversal before original receipt; got {status}: {body}"
    );
}

#[tokio::test]
#[ignore = "Audit: reversal posts to current default account instead of the receipt account"]
async fn audit_payment_reversal_must_use_original_financial_account() {
    let (app, pool, admin, patient, order, bearer) = audit_case().await;
    let invoice = seed_invoice(
        &pool,
        order,
        patient,
        admin,
        &unique_tag("accounts"),
        "final",
        100,
        false,
    )
    .await;
    let payment = record_payment(&app, &bearer, invoice, Uuid::new_v4(), 100, "old-account").await;
    let payment_id = Uuid::parse_str(payment["payment_transaction_id"].as_str().unwrap()).unwrap();
    let original_account:Uuid = sqlx::query_scalar("SELECT financial_account_id FROM accounting_entries WHERE source_invoice_payment_transaction_id=$1 LIMIT 1").bind(payment_id).fetch_one(&pool).await.unwrap();
    let (status,account) = json_request(&app,"POST","/api/v1/company-financial-accounts",&bearer,
        Some(json!({"name":unique_tag("New bank"),"account_type":"bank","currency":"EUR","opening_balance":"0","opening_balance_on":chrono::Utc::now().date_naive().to_string(),"is_default":true}))).await;
    assert_eq!(status, StatusCode::CREATED, "{account}");
    let (status, reversal) = json_request(
        &app,
        "POST",
        &format!("/api/v1/invoices/{invoice}/payments/{payment_id}/reversal"),
        &bearer,
        Some(json!({"note":"Wrong invoice"})),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{reversal}");
    let reversal_id =
        Uuid::parse_str(reversal["reversal_transaction_id"].as_str().unwrap()).unwrap();
    let reversal_account:Uuid = sqlx::query_scalar("SELECT financial_account_id FROM accounting_entries WHERE source_invoice_payment_transaction_id=$1 LIMIT 1").bind(reversal_id).fetch_one(&pool).await.unwrap();
    assert_eq!(
        reversal_account, original_account,
        "Reversal must remove cash from the original account"
    );
}

#[tokio::test]
#[ignore = "Audit: draft invoices incorrectly contribute to order outstanding balance"]
async fn audit_draft_invoice_must_not_be_patient_debt() {
    let (app, pool, admin, patient, order, bearer) = audit_case().await;
    let invoice = seed_invoice(
        &pool,
        order,
        patient,
        admin,
        &unique_tag("draft"),
        "final",
        100,
        false,
    )
    .await;
    sqlx::query("UPDATE invoices SET status='draft' WHERE id=$1")
        .bind(invoice)
        .execute(&pool)
        .await
        .unwrap();
    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/orders/{order}"),
        &bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(
        body["process_gates"]["outstanding_balance"], "0",
        "An unpublished draft must not create patient debt"
    );
}

#[tokio::test]
#[ignore = "Audit: non-EUR invoice response omits its currency"]
async fn audit_invoice_must_expose_its_order_currency() {
    let (app, pool, admin, patient, order, bearer) = audit_case().await;
    sqlx::query("UPDATE orders SET currency='USD' WHERE id=$1")
        .bind(order)
        .execute(&pool)
        .await
        .unwrap();
    let invoice = seed_invoice(
        &pool,
        order,
        patient,
        admin,
        &unique_tag("usd"),
        "final",
        100,
        false,
    )
    .await;
    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/invoices/{invoice}"),
        &bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(
        body["currency"], "USD",
        "Invoice UI must receive the actual order currency"
    );
}

#[tokio::test]
#[ignore = "Positive control; requires the disposable audit database"]
async fn audit_control_partial_payment_replay_and_overpayment() {
    let (app, pool, admin, patient, order, bearer) = audit_case().await;
    let invoice = seed_invoice(
        &pool,
        order,
        patient,
        admin,
        &unique_tag("control"),
        "final",
        100,
        false,
    )
    .await;
    let request_id = Uuid::new_v4();
    let payment = record_payment(&app, &bearer, invoice, request_id, 40, "control").await;
    assert_eq!(payment["invoice"]["status"], "partially_paid");
    assert_eq!(payment["invoice"]["balance_due"], "60");
    let (status,replay)=json_request(&app,"POST",&format!("/api/v1/invoices/{invoice}/payments"),&bearer,
        Some(json!({"request_id":request_id,"amount_gross":40,"payment_method":"bank_transfer","payment_reference":"control","received_on":chrono::Utc::now().date_naive().to_string(),"note":"Internal control"}))).await;
    assert_eq!(status, StatusCode::OK, "{replay}");
    assert_eq!(replay["idempotent_replay"], true);
    let (status,_)=json_request(&app,"POST",&format!("/api/v1/invoices/{invoice}/payments"),&bearer,
        Some(json!({"request_id":Uuid::new_v4(),"amount_gross":61,"payment_method":"cash","received_on":chrono::Utc::now().date_naive().to_string()}))).await;
    assert_eq!(status, StatusCode::CONFLICT);
    let final_payment = record_payment(&app, &bearer, invoice, Uuid::new_v4(), 60, "balance").await;
    assert_eq!(final_payment["invoice"]["status"], "paid");
    assert_eq!(final_payment["invoice"]["balance_due"], "0");
    let count: i64 =
        sqlx::query_scalar("SELECT count(*) FROM invoice_payment_transactions WHERE invoice_id=$1")
            .bind(invoice)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(count, 2);
    let cash: Decimal = sqlx::query_scalar(
        "SELECT sum(amount_gross) FROM accounting_entries WHERE source_invoice_id=$1",
    )
    .bind(invoice)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(cash, Decimal::new(100, 0));
}

#[tokio::test]
#[ignore = "Audit: independently rounded partial receipts do not preserve total VAT"]
async fn audit_partial_payments_must_preserve_invoice_vat_total() {
    let (app, pool, admin, patient, order, bearer) = audit_case().await;
    let invoice = seed_invoice(
        &pool,
        order,
        patient,
        admin,
        &unique_tag("vat"),
        "final",
        100,
        false,
    )
    .await;
    for amount in ["33.33", "33.33", "33.34"] {
        let (status,body)=json_request(&app,"POST",&format!("/api/v1/invoices/{invoice}/payments"),&bearer,
            Some(json!({"request_id":Uuid::new_v4(),"amount_gross":amount,"payment_method":"bank_transfer","received_on":chrono::Utc::now().date_naive().to_string()}))).await;
        assert_eq!(status, StatusCode::CREATED, "{body}");
    }
    let expected: Decimal = sqlx::query_scalar("SELECT total_vat FROM invoices WHERE id=$1")
        .bind(invoice)
        .fetch_one(&pool)
        .await
        .unwrap();
    let booked: Decimal = sqlx::query_scalar(
        "SELECT sum(amount_vat) FROM accounting_entries WHERE source_invoice_id=$1",
    )
    .bind(invoice)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        booked, expected,
        "Fully paid invoice must retain its exact VAT in the cash ledger"
    );
}

#[tokio::test]
async fn accounting_migrations_must_bootstrap_from_empty_database() {
    let database = support::isolated_schema_database()
        .await
        .expect("Disposable PostgreSQL is required");
    gmed_db::run_migrations(&database.pool)
        .await
        .expect("Every migration must succeed from empty schema");
    // Running again also checks SQLx checksums and idempotent startup.
    gmed_db::run_migrations(&database.pool).await.unwrap();
}

#[tokio::test]
#[ignore = "Requires explicit disposable audit database"]
async fn audit_reversal_preserves_exact_vat_and_inactive_account() {
    let (app, pool, admin, patient, order, bearer) = audit_case().await;
    let invoice = seed_invoice(
        &pool,
        order,
        patient,
        admin,
        &unique_tag("exact-reverse"),
        "final",
        100,
        false,
    )
    .await;
    let mut last = Value::Null;
    for amount in ["33.33", "33.33", "33.34"] {
        let (status, body) = json_request(&app, "POST", &format!("/api/v1/invoices/{invoice}/payments"), &bearer,
            Some(json!({"request_id":Uuid::new_v4(),"amount_gross":amount,"payment_method":"bank_transfer","received_on":chrono::Utc::now().date_naive().to_string()}))).await;
        assert_eq!(status, StatusCode::CREATED, "{body}");
        last = body;
    }
    let payment_id = Uuid::parse_str(last["payment_transaction_id"].as_str().unwrap()).unwrap();
    let account: Uuid = sqlx::query_scalar("SELECT financial_account_id FROM accounting_entries WHERE source_invoice_payment_transaction_id=$1 LIMIT 1").bind(payment_id).fetch_one(&pool).await.unwrap();
    let (status, new_bank) = json_request(&app, "POST", "/api/v1/company-financial-accounts", &bearer,
        Some(json!({"name":unique_tag("bank"),"account_type":"bank","currency":"EUR","opening_balance":"0","opening_balance_on":"2020-01-01","is_default":true}))).await;
    assert_eq!(status, StatusCode::CREATED, "{new_bank}");
    sqlx::query("UPDATE company_financial_accounts SET is_active=false WHERE id=$1")
        .bind(account)
        .execute(&pool)
        .await
        .unwrap();
    let (status, reversed) = json_request(
        &app,
        "POST",
        &format!("/api/v1/invoices/{invoice}/payments/{payment_id}/reversal"),
        &bearer,
        Some(json!({"note":"Correct last installment"})),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{reversed}");
    let reversal = Uuid::parse_str(reversed["reversal_transaction_id"].as_str().unwrap()).unwrap();
    let exact: bool = sqlx::query_scalar("SELECT original.amount_net + reversal.amount_net = 0 AND original.amount_vat + reversal.amount_vat = 0 AND original.amount_gross + reversal.amount_gross = 0 AND original.financial_account_id = reversal.financial_account_id FROM accounting_entries original JOIN accounting_entries reversal ON reversal.category=original.category WHERE original.source_invoice_payment_transaction_id=$1 AND reversal.source_invoice_payment_transaction_id=$2")
        .bind(payment_id).bind(reversal).fetch_one(&pool).await.unwrap();
    assert!(exact);
    let entry: Uuid = sqlx::query_scalar(
        "SELECT id FROM accounting_entries WHERE source_invoice_payment_transaction_id=$1 LIMIT 1",
    )
    .bind(payment_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/accounting-entries/{entry}/financial-account"),
        &bearer,
        Some(json!({"financial_account_id":new_bank["id"]})),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{body}");
}

#[tokio::test]
#[ignore = "Requires explicit disposable audit database"]
async fn audit_refund_reversal_preserves_original_account() {
    let (app, pool, admin, patient, order, bearer) = audit_case().await;
    let invoice = seed_invoice(
        &pool,
        order,
        patient,
        admin,
        &unique_tag("refund-account"),
        "final",
        100,
        false,
    )
    .await;
    record_payment(&app, &bearer, invoice, Uuid::new_v4(), 100, "paid").await;
    credit(&app, &bearer, invoice).await;
    let (status,refund)=json_request(&app,"POST",&format!("/api/v1/invoices/{invoice}/refunds"),&bearer,Some(json!({"request_id":Uuid::new_v4(),"amount_gross":40,"payment_method":"bank_transfer","refunded_on":chrono::Utc::now().date_naive().to_string(),"reason":"Refund"}))).await;
    assert_eq!(status, StatusCode::CREATED, "{refund}");
    let refund_id = Uuid::parse_str(refund["refund_transaction_id"].as_str().unwrap()).unwrap();
    let old:Uuid=sqlx::query_scalar("SELECT financial_account_id FROM accounting_entries WHERE source_invoice_refund_transaction_id=$1 LIMIT 1").bind(refund_id).fetch_one(&pool).await.unwrap();
    let (status, bank)=json_request(&app,"POST","/api/v1/company-financial-accounts",&bearer,Some(json!({"name":unique_tag("refund-bank"),"account_type":"bank","currency":"EUR","opening_balance":"0","opening_balance_on":"2020-01-01","is_default":true}))).await;
    assert_eq!(status, StatusCode::CREATED, "{bank}");
    sqlx::query("UPDATE company_financial_accounts SET is_active=false WHERE id=$1")
        .bind(old)
        .execute(&pool)
        .await
        .unwrap();
    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/invoices/{invoice}/refunds/{refund_id}/reversal"),
        &bearer,
        Some(json!({"reason":"Returned by bank"})),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let reversal = Uuid::parse_str(body["reversal_transaction_id"].as_str().unwrap()).unwrap();
    let actual:Uuid=sqlx::query_scalar("SELECT financial_account_id FROM accounting_entries WHERE source_invoice_refund_transaction_id=$1 LIMIT 1").bind(reversal).fetch_one(&pool).await.unwrap();
    assert_eq!(actual, old);
}

#[tokio::test]
#[ignore = "Requires explicit disposable audit database"]
async fn audit_ledger_keeps_currencies_separate() {
    let (app, pool, admin, patient, order, bearer) = audit_case().await;
    let eur = seed_invoice(
        &pool,
        order,
        patient,
        admin,
        &unique_tag("eur"),
        "final",
        100,
        false,
    )
    .await;
    record_payment(&app, &bearer, eur, Uuid::new_v4(), 100, "eur").await;
    let usd_order = seed_order(&pool, patient, admin, &unique_tag("usd-order")).await;
    sqlx::query("UPDATE orders SET currency='USD' WHERE id=$1")
        .bind(usd_order)
        .execute(&pool)
        .await
        .unwrap();
    let usd = seed_invoice(
        &pool,
        usd_order,
        patient,
        admin,
        &unique_tag("usd"),
        "final",
        200,
        false,
    )
    .await;
    record_payment(&app, &bearer, usd, Uuid::new_v4(), 200, "usd").await;
    for (currency, expected) in [("EUR", "100"), ("USD", "200")] {
        let (status, body) = json_request(
            &app,
            "GET",
            &format!("/api/v1/invoices/accounting-ledger?patient_id={patient}&currency={currency}"),
            &bearer,
            None,
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{body}");
        assert_eq!(body["currency"], currency);
        assert_eq!(body["summary"]["income_gross"], expected);
        assert_eq!(body["available_currencies"], json!(["EUR", "USD"]));
        assert!(
            body["entries"]
                .as_array()
                .unwrap()
                .iter()
                .all(|entry| entry["currency"] == currency)
        );
    }
}

#[tokio::test]
#[ignore = "Requires explicit disposable audit database"]
async fn audit_released_advance_remains_in_historical_statement() {
    let (app, pool, admin, patient, order, bearer) = audit_case().await;
    let source = seed_invoice(
        &pool,
        order,
        patient,
        admin,
        &unique_tag("history-source"),
        "advance",
        100,
        false,
    )
    .await;
    let target = seed_invoice(
        &pool,
        order,
        patient,
        admin,
        &unique_tag("history-target"),
        "final",
        100,
        false,
    )
    .await;
    sqlx::query("UPDATE invoices SET issued_at=now()-interval '3 days' WHERE id IN ($1,$2)")
        .bind(source)
        .bind(target)
        .execute(&pool)
        .await
        .unwrap();
    let payment_date = (chrono::Utc::now().date_naive() - chrono::Duration::days(2)).to_string();
    let (status,body)=json_request(&app,"POST",&format!("/api/v1/invoices/{source}/payments"),&bearer,Some(json!({"request_id":Uuid::new_v4(),"amount_gross":100,"payment_method":"bank_transfer","received_on":payment_date}))).await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    let allocation:Uuid=sqlx::query_scalar("INSERT INTO invoice_prepayment_allocations(advance_invoice_id,target_invoice_id,amount_gross,created_by,created_at) VALUES($1,$2,100,$3,now()-interval '1 day') RETURNING id").bind(source).bind(target).bind(admin).fetch_one(&pool).await.unwrap();
    let date = (chrono::Utc::now().date_naive() - chrono::Duration::days(1)).to_string();
    let path = format!("/api/v1/patients/{patient}/account-statement?currency=EUR&to={date}");
    let (status, before) = json_request(&app, "GET", &path, &bearer, None).await;
    assert_eq!(status, StatusCode::OK, "{before}");
    assert_eq!(before["summary"]["prepayment_applied"], "100");
    let (status, body) = json_request(
        &app,
        "DELETE",
        &format!("/api/v1/invoices/{target}/prepayment-allocations/{allocation}"),
        &bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let (status, after) = json_request(&app, "GET", &path, &bearer, None).await;
    assert_eq!(status, StatusCode::OK, "{after}");
    assert_eq!(after["summary"], before["summary"]);
    let actor: Uuid = sqlx::query_scalar(
        "SELECT released_by FROM invoice_prepayment_allocation_releases WHERE id=$1",
    )
    .bind(allocation)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(actor, admin);
    let (status, current) = json_request(
        &app,
        "GET",
        &format!("/api/v1/patients/{patient}/account-statement?currency=EUR"),
        &bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{current}");
    assert_eq!(current["summary"]["prepayment_applied"], "0");
    assert_eq!(current["summary"]["available_prepayment"], "100");
}

#[tokio::test]
#[ignore = "Requires explicit disposable audit database"]
async fn audit_orderless_expense_appears_in_patient_statement_and_summary() {
    let (app, pool, admin, patient, _order, bearer) = audit_case().await;
    let provider: Uuid = sqlx::query_scalar(
        "INSERT INTO providers(name,provider_type) VALUES($1,'non_medical') RETURNING id",
    )
    .bind(unique_tag("vendor"))
    .fetch_one(&pool)
    .await
    .unwrap();
    let task:Uuid=sqlx::query_scalar("INSERT INTO tasks(title,assigned_to,assigned_by,patient_id,currency) VALUES('Audit expense',$1,$1,$2,'EUR') RETURNING id").bind(admin).bind(patient).fetch_one(&pool).await.unwrap();
    let expense:Uuid=sqlx::query_scalar("INSERT INTO concierge_expense_submissions(task_id,request_id,patient_id,vendor_name,expense_date,amount_net,amount_vat,amount_gross,currency,paid_by,service_delivered,payload_hash,submitted_by) VALUES($1,$2,$3,'Audit vendor',CURRENT_DATE,100,19,119,'EUR','unpaid',true,repeat('a',64),$4) RETURNING id").bind(task).bind(Uuid::new_v4()).bind(patient).bind(admin).fetch_one(&pool).await.unwrap();
    sqlx::query("INSERT INTO external_invoices(patient_id,provider_id,external_invoice_number,invoice_date,amount_net,amount_vat,amount_gross,currency,status,paid_by,service_delivered,source_concierge_expense_id,created_by) VALUES($1,$2,$3,CURRENT_DATE,100,19,119,'EUR','approved','unpaid',true,$4,$5)")
        .bind(patient).bind(provider).bind(unique_tag("external")).bind(expense).bind(admin).execute(&pool).await.unwrap();
    let (status, statement) = json_request(
        &app,
        "GET",
        &format!("/api/v1/patients/{patient}/account-statement?currency=EUR"),
        &bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{statement}");
    assert_eq!(statement["summary"]["external_receivable"], "119");
    assert_eq!(statement["summary"]["closing_balance"], "119");
    let (status, summary) = json_request(
        &app,
        "GET",
        &format!("/api/v1/patients/{patient}/financial-summary?currency=EUR"),
        &bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{summary}");
    assert_eq!(summary["external_receivable_gross"], "119", "{summary}");
}

#[tokio::test]
#[ignore = "Requires explicit disposable audit database"]
async fn audit_draft_invoice_cannot_consume_an_advance() {
    let (app, pool, admin, patient, order, bearer) = audit_case().await;
    let source = seed_invoice(
        &pool,
        order,
        patient,
        admin,
        &unique_tag("released"),
        "advance",
        100,
        false,
    )
    .await;
    let target = seed_invoice(
        &pool,
        order,
        patient,
        admin,
        &unique_tag("draft-target"),
        "final",
        100,
        false,
    )
    .await;
    sqlx::query("UPDATE invoices SET status='draft' WHERE id=$1")
        .bind(target)
        .execute(&pool)
        .await
        .unwrap();
    record_payment(&app, &bearer, source, Uuid::new_v4(), 100, "available").await;
    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/invoices/{target}/prepayment-allocations"),
        &bearer,
        Some(json!({"request_id":Uuid::new_v4(),"advance_invoice_id":source,"amount_gross":100})),
    )
    .await;
    assert!(
        status == StatusCode::CONFLICT || status == StatusCode::UNPROCESSABLE_ENTITY,
        "{status}: {body}"
    );
    let allocated:Decimal=sqlx::query_scalar("SELECT COALESCE(SUM(amount_gross),0) FROM invoice_prepayment_allocations WHERE advance_invoice_id=$1").bind(source).fetch_one(&pool).await.unwrap();
    assert_eq!(allocated, Decimal::ZERO);
}

#[tokio::test]
#[ignore = "Requires explicit disposable audit database"]
async fn audit_payment_deadline_notifies_once_without_blocking_work() {
    let (app, pool, admin, patient, order, bearer) = audit_case().await;
    sqlx::query("UPDATE orders SET signed_patient=true,signed_agency=true,billing_release_status='granted',total_estimated=100 WHERE id=$1").bind(order).execute(&pool).await.unwrap();
    let due = chrono::Utc::now() + chrono::Duration::hours(2);
    let (status,body)=json_request(&app,"POST",&format!("/api/v1/orders/{order}/commercial-basis"),&bearer,Some(json!({"prepayment_required":true,"prepayment_amount":"100","prepayment_due_at":due.to_rfc3339()}))).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert!(body["prepayment_due_at"].as_str().is_some());
    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/orders/{order}"),
        &bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["process_gates"]["execution_ready"], true, "{body}");
    assert_eq!(
        body["process_gates"]["payment_tracking"]["status"],
        "due_soon"
    );
    let state = gmed_server::state::AppState::new(
        pool.clone(),
        TEST_SECRET,
        gmed_server::settings::SettingsCache::new(gmed_server::settings::TokenSettings::default()),
    );
    assert_eq!(
        gmed_server::services::order_payment_tracking::sync_notifications(&state, Some(order))
            .await
            .unwrap(),
        0
    );
    let count:i64=sqlx::query_scalar("SELECT COUNT(*) FROM user_notifications WHERE user_id=$1 AND entity_id=$2 AND kind='order_payment_status'").bind(admin).bind(order).fetch_one(&pool).await.unwrap();
    assert_eq!(count, 1);
    let invoice = seed_invoice(
        &pool,
        order,
        patient,
        admin,
        &unique_tag("deadline"),
        "advance",
        100,
        false,
    )
    .await;
    record_payment(&app, &bearer, invoice, Uuid::new_v4(), 40, "partial").await;
    let payload:String=sqlx::query_scalar("SELECT body FROM user_notifications WHERE user_id=$1 AND entity_id=$2 ORDER BY created_at DESC LIMIT 1").bind(admin).bind(order).fetch_one(&pool).await.unwrap();
    assert_eq!(
        serde_json::from_str::<Value>(&payload).unwrap()["received_amount"],
        "40"
    );
    sqlx::query("UPDATE orders SET prepayment_due_at=now()-interval '1 minute' WHERE id=$1")
        .bind(order)
        .execute(&pool)
        .await
        .unwrap();
    assert!(
        gmed_server::services::order_payment_tracking::sync_notifications(&state, Some(order))
            .await
            .unwrap()
            > 0
    );
    assert_eq!(
        gmed_server::services::order_payment_tracking::sync_notifications(&state, Some(order))
            .await
            .unwrap(),
        0
    );
    sqlx::query("UPDATE invoices SET status='overdue',due_date=CURRENT_DATE-1 WHERE id=$1")
        .bind(invoice)
        .execute(&pool)
        .await
        .unwrap();
    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/orders/{order}"),
        &bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["process_gates"]["execution_ready"], true, "{body}");
    assert_eq!(body["process_gates"]["debt_hold"], false);
    assert_eq!(
        body["process_gates"]["payment_tracking"]["status"],
        "overdue"
    );
    record_payment(&app, &bearer, invoice, Uuid::new_v4(), 60, "paid").await;
    let payload:String=sqlx::query_scalar("SELECT body FROM user_notifications WHERE user_id=$1 AND entity_id=$2 ORDER BY created_at DESC LIMIT 1").bind(admin).bind(order).fetch_one(&pool).await.unwrap();
    assert_eq!(
        serde_json::from_str::<Value>(&payload).unwrap()["payment_status"],
        "paid"
    );
    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/orders/{order}/commercial-basis"),
        &bearer,
        Some(json!({"prepayment_due_at":"not-a-date"})),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/orders/{order}/commercial-basis"),
        &bearer,
        Some(json!({"prepayment_due_at":"2027-01-10T12:00:00+02:00"})),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let saved =
        chrono::DateTime::parse_from_rfc3339(body["prepayment_due_at"].as_str().unwrap()).unwrap();
    assert_eq!(
        saved.with_timezone(&chrono::Utc).to_rfc3339(),
        "2027-01-10T10:00:00+00:00"
    );
    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/orders/{order}/commercial-basis"),
        &bearer,
        Some(json!({"prepayment_due_at":""})),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert!(body["prepayment_due_at"].is_null());
    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/orders/{order}/commercial-basis"),
        &bearer,
        Some(json!({"prepayment_required":false,"prepayment_due_at":"2027-01-10T12:00:00+02:00"})),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert!(body["prepayment_due_at"].is_null());
    let status: String =
        sqlx::query_scalar("SELECT payment_status FROM order_payment_tracking WHERE order_id=$1")
            .bind(order)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(status, "not_required");
}

#[tokio::test]
#[ignore = "Requires explicit disposable audit database"]
async fn audit_quote_manual_flag_is_not_a_payment() {
    let (app, pool, admin, patient, order, bearer) = audit_case().await;
    let quote:Uuid=sqlx::query_scalar("INSERT INTO quotes(order_id,quote_number,total_net,total_vat,total_gross,status,paid_amount,line_items,created_by) VALUES($1,$2,84.03,15.97,100,'draft',100,'[]',$3) RETURNING id").bind(order).bind(unique_tag("legacy-quote")).bind(admin).fetch_one(&pool).await.unwrap();
    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/quotes/{quote}"),
        &bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["paid_amount"], "0");
    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/quotes/{quote}/status"),
        &bearer,
        Some(json!({"status":"sent","paid_amount":100})),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
    let invoice = seed_invoice(
        &pool,
        order,
        patient,
        admin,
        &unique_tag("quote-cash"),
        "advance",
        100,
        false,
    )
    .await;
    record_payment(&app, &bearer, invoice, Uuid::new_v4(), 40, "received").await;
    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/quotes/{quote}"),
        &bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["paid_amount"], "40");
    assert!(body["paid_at"].as_str().is_some());
}

#[tokio::test]
#[ignore = "Requires explicit disposable audit database"]
async fn audit_reversal_to_zero_still_notifies_for_an_unsigned_order() {
    let (app, pool, admin, patient, order, bearer) = audit_case().await;
    sqlx::query("UPDATE orders SET prepayment_required=true,prepayment_amount=100,total_estimated=100 WHERE id=$1")
        .bind(order).execute(&pool).await.unwrap();
    let invoice = seed_invoice(
        &pool,
        order,
        patient,
        admin,
        &unique_tag("reversed-notice"),
        "advance",
        100,
        false,
    )
    .await;
    let paid = record_payment(
        &app,
        &bearer,
        invoice,
        Uuid::new_v4(),
        100,
        "notified-payment",
    )
    .await;
    let payment = paid["payment_transaction_id"].as_str().unwrap();
    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/invoices/{invoice}/payments/{payment}/reversal"),
        &bearer,
        Some(json!({"note":"Incorrect receipt"})),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let payload: String = sqlx::query_scalar("SELECT body FROM user_notifications WHERE user_id=$1 AND entity_id=$2 AND kind='order_payment_status' ORDER BY created_at DESC LIMIT 1")
        .bind(admin).bind(order).fetch_one(&pool).await.unwrap();
    let payload: Value = serde_json::from_str(&payload).unwrap();
    assert_eq!(payload["received_amount"], "0");
    assert_eq!(payload["payment_status"], "awaiting_payment");
}
