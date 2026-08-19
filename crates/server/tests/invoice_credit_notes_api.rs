mod support;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use rust_decimal::Decimal;
use serde_json::{Value, json};
use sqlx::{PgPool, Row};
use tower::ServiceExt;
use uuid::Uuid;

use gmed_server::auth::jwt;

const TEST_SECRET: &str = "test-secret-at-least-32-characters-long!!";

fn auth_header(user_id: Uuid, role: &str) -> String {
    let token = jwt::issue_access_token(TEST_SECRET, user_id, role, Uuid::new_v4()).unwrap();
    format!("Bearer {token}")
}

async fn request_json(
    app: &axum::Router,
    method: &str,
    path: &str,
    bearer: &str,
    body: Option<Value>,
) -> (StatusCode, Value) {
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(method)
                .uri(path)
                .header("Authorization", bearer)
                .header("Content-Type", "application/json")
                .body(body.map_or_else(Body::empty, |value| {
                    Body::from(serde_json::to_vec(&value).unwrap())
                }))
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
    .bind(format!("{tag}-{role}@example.com"))
    .bind(format!("{role} {tag}"))
    .bind(role)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn seed_finance_case(pool: &PgPool, admin_id: Uuid, tag: &str) -> (Uuid, Uuid) {
    let patient_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO patients (
                patient_id, first_name, last_name, birth_date, gender, created_by
           ) VALUES ($1, 'Credit', 'Note', '1990-01-01', 'diverse', $2)
           RETURNING id"#,
    )
    .bind(format!("PT-{tag}"))
    .bind(admin_id)
    .fetch_one(pool)
    .await
    .unwrap();
    let order_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO orders (
                order_number, patient_id, phase, status, currency, created_by
           ) VALUES ($1, $2, 'execution', 'active', 'USD', $3)
           RETURNING id"#,
    )
    .bind(format!("ORD-{tag}"))
    .bind(patient_id)
    .bind(admin_id)
    .fetch_one(pool)
    .await
    .unwrap();
    let invoice_id = sqlx::query_scalar(
        r#"INSERT INTO invoices (
                order_id, patient_id, invoice_number, invoice_type, status,
                issued_at, due_date, total_net, total_vat, total_gross,
                paid_amount, line_items, portal_visible,
                hide_amounts_from_patient, created_by
           ) VALUES (
                $1, $2, $3, 'final', 'sent', now() - interval '5 days',
                CURRENT_DATE - 1, 84.03, 15.97, 100, 0,
                '[{"description":"Care","quantity":"1","line_net":"84.03","line_vat":"15.97","line_gross":"100"}]',
                true, false, $4
           ) RETURNING id"#,
    )
    .bind(order_id)
    .bind(patient_id)
    .bind(format!("INV-{tag}"))
    .bind(admin_id)
    .fetch_one(pool)
    .await
    .unwrap();
    (patient_id, invoice_id)
}

#[tokio::test]
async fn credit_note_is_idempotent_append_only_currency_safe_and_updates_balances() {
    let Some(ctx) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let tag = format!("credit-note-{}", Uuid::new_v4().simple());
    let (patient_id, invoice_id) = seed_finance_case(&ctx.pool, ctx.admin_id, &tag).await;
    let patient_user_id = seed_user(&ctx.pool, &tag, "patient").await;
    let manager_id = seed_user(&ctx.pool, &format!("{tag}-manager"), "patient_manager").await;
    for user_id in [patient_user_id, manager_id] {
        sqlx::query(
            "INSERT INTO patient_assignments (patient_id, user_id, assigned_by) VALUES ($1, $2, $3)",
        )
        .bind(patient_id)
        .bind(user_id)
        .bind(ctx.admin_id)
        .execute(&ctx.pool)
        .await
        .unwrap();
    }
    let ceo = auth_header(ctx.admin_id, "ceo");
    let patient = auth_header(patient_user_id, "patient");
    let manager = auth_header(manager_id, "patient_manager");
    let request_id = Uuid::new_v4();
    let payload = json!({
        "request_id": request_id,
        "amount_gross": 40,
        "reason": "Contracted service was not required",
        "issued_on": chrono::Utc::now().date_naive().to_string(),
        "portal_visible": true
    });

    let (status, created) = request_json(
        &ctx.app,
        "POST",
        &format!("/api/v1/invoices/{invoice_id}/credit-notes"),
        &ceo,
        Some(payload.clone()),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{created:?}");
    assert_eq!(created["invoice"]["credited_amount"], "40");
    assert_eq!(created["invoice"]["adjusted_total_gross"], "60");
    assert_eq!(created["invoice"]["balance_due"], "60");
    let credit_id = Uuid::parse_str(created["credit_note_transaction_id"].as_str().unwrap()).unwrap();

    let (status, replay) = request_json(
        &ctx.app,
        "POST",
        &format!("/api/v1/invoices/{invoice_id}/credit-notes"),
        &ceo,
        Some(payload.clone()),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{replay:?}");
    assert_eq!(replay["idempotent_replay"], true);
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM invoice_credit_note_transactions WHERE invoice_id = $1",
        )
        .bind(invoice_id)
        .fetch_one(&ctx.pool)
        .await
        .unwrap(),
        1
    );

    let mut changed = payload.clone();
    changed["amount_gross"] = json!(41);
    let (status, _) = request_json(
        &ctx.app,
        "POST",
        &format!("/api/v1/invoices/{invoice_id}/credit-notes"),
        &ceo,
        Some(changed),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);

    let (status, _) = request_json(
        &ctx.app,
        "POST",
        &format!("/api/v1/invoices/{invoice_id}/credit-notes"),
        &manager,
        Some(json!({
            "request_id": Uuid::new_v4(),
            "amount_gross": 1,
            "reason": "Forbidden",
            "issued_on": chrono::Utc::now().date_naive().to_string()
        })),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    let (status, portal_history) = request_json(
        &ctx.app,
        "GET",
        &format!("/api/v1/me/invoices/{invoice_id}/credit-notes"),
        &patient,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{portal_history:?}");
    assert_eq!(portal_history["items"][0]["currency"], "USD");
    assert_eq!(portal_history["items"][0]["amount_gross"], "40");

    let accounting_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM accounting_entries WHERE source_invoice_id = $1",
    )
    .bind(invoice_id)
    .fetch_one(&ctx.pool)
    .await
    .unwrap();
    assert_eq!(accounting_count, 0, "unpaid credit notes are not cash-basis income");

    let (status, statement) = request_json(
        &ctx.app,
        "GET",
        &format!("/api/v1/patients/{patient_id}/account-statement?currency=USD"),
        &ceo,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{statement:?}");
    assert_eq!(statement["summary"]["invoice_due"], "60");
    assert_eq!(statement["settlement"]["closing_balance"], "60");
    let (status, summary) = request_json(
        &ctx.app,
        "GET",
        &format!("/api/v1/patients/{patient_id}/financial-summary?currency=USD"),
        &ceo,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{summary:?}");
    assert_eq!(summary["revenue_gross"], "60");
    assert_eq!(summary["breakdown_by_service_type"][0]["revenue_gross"], "60");
    let cutoff = chrono::Utc::now().date_naive() - chrono::Duration::days(1);
    let (status, before_credit) = request_json(
        &ctx.app,
        "GET",
        &format!(
            "/api/v1/patients/{patient_id}/account-statement?currency=USD&to={cutoff}"
        ),
        &ceo,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{before_credit:?}");
    assert_eq!(before_credit["summary"]["invoice_due"], "100");
    assert_eq!(before_credit["settlement"]["closing_balance"], "100");

    let (status, reversed) = request_json(
        &ctx.app,
        "POST",
        &format!("/api/v1/invoices/{invoice_id}/credit-notes/{credit_id}/reversal"),
        &ceo,
        Some(json!({ "reason": "Correction entered in error" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{reversed:?}");
    assert_eq!(reversed["invoice"]["credited_amount"], "0");
    assert_eq!(reversed["invoice"]["balance_due"], "100");

    let (status, payment) = request_json(
        &ctx.app,
        "POST",
        &format!("/api/v1/invoices/{invoice_id}/payments"),
        &ceo,
        Some(json!({
            "request_id": Uuid::new_v4(),
            "amount_gross": 40,
            "payment_method": "bank_transfer",
            "payment_reference": format!("PAY-{tag}"),
            "received_on": chrono::Utc::now().date_naive().to_string()
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{payment:?}");
    let (status, before_payment) = request_json(
        &ctx.app,
        "GET",
        &format!(
            "/api/v1/patients/{patient_id}/account-statement?currency=USD&to={cutoff}"
        ),
        &ceo,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{before_payment:?}");
    assert_eq!(before_payment["summary"]["invoice_due"], "100");
    assert_eq!(before_payment["settlement"]["closing_balance"], "100");

    let update_error = sqlx::query(
        "UPDATE invoice_credit_note_transactions SET reason = 'mutated' WHERE id = $1",
    )
    .bind(credit_id)
    .execute(&ctx.pool)
    .await
    .unwrap_err();
    assert!(update_error.to_string().contains("append-only"));
}

#[tokio::test]
async fn credit_note_guards_dates_allocations_and_cancelled_reactivation() {
    let Some(ctx) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let tag = format!("credit-guards-{}", Uuid::new_v4().simple());
    let (_patient_id, invoice_id) = seed_finance_case(&ctx.pool, ctx.admin_id, &tag).await;
    let ceo = auth_header(ctx.admin_id, "ceo");

    let (status, _) = request_json(
        &ctx.app,
        "POST",
        &format!("/api/v1/invoices/{invoice_id}/credit-notes"),
        &ceo,
        Some(json!({
            "request_id": Uuid::new_v4(),
            "amount_gross": 1,
            "reason": "Impossible chronology",
            "issued_on": (chrono::Utc::now().date_naive() - chrono::Duration::days(10)).to_string()
        })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);

    sqlx::query("UPDATE invoices SET status = 'cancelled' WHERE id = $1")
        .bind(invoice_id)
        .execute(&ctx.pool)
        .await
        .unwrap();
    let reactivation = sqlx::query("UPDATE invoices SET status = 'sent' WHERE id = $1")
        .bind(invoice_id)
        .execute(&ctx.pool)
        .await
        .unwrap_err();
    assert!(reactivation.to_string().contains("cannot be reactivated"));

    let row = sqlx::query("SELECT credited_amount FROM invoices WHERE id = $1")
        .bind(invoice_id)
        .fetch_one(&ctx.pool)
        .await
        .unwrap();
    assert_eq!(
        row.try_get::<Decimal, _>("credited_amount").unwrap(),
        Decimal::ZERO
    );
}

#[tokio::test]
async fn credit_note_and_allocation_caps_preserve_adjusted_receivables() {
    let Some(ctx) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let tag = format!("credit-caps-{}", Uuid::new_v4().simple());
    let (patient_id, invoice_id) = seed_finance_case(&ctx.pool, ctx.admin_id, &tag).await;
    let ceo = auth_header(ctx.admin_id, "ceo");
    let order_id: Uuid = sqlx::query_scalar("SELECT order_id FROM invoices WHERE id = $1")
        .bind(invoice_id)
        .fetch_one(&ctx.pool)
        .await
        .unwrap();

    let (status, _) = request_json(
        &ctx.app,
        "POST",
        &format!("/api/v1/invoices/{invoice_id}/credit-notes"),
        &ceo,
        Some(json!({
            "request_id": Uuid::new_v4(),
            "amount_gross": 80,
            "reason": "Reduced scope",
            "issued_on": chrono::Utc::now().date_naive().to_string()
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);

    let external_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO external_invoices (
                order_id, patient_id, external_invoice_number, amount_net,
                amount_vat, amount_gross, currency, status, paid_by,
                service_delivered, created_by
           ) VALUES ($1, $2, $3, 100, 0, 100, 'USD', 'expected',
                     'unpaid', true, $4)
           RETURNING id"#,
    )
    .bind(order_id)
    .bind(patient_id)
    .bind(format!("EXT-{tag}"))
    .bind(ctx.admin_id)
    .fetch_one(&ctx.pool)
    .await
    .unwrap();

    let too_much = sqlx::query(
        r#"INSERT INTO external_invoice_patient_invoice_allocations (
                external_invoice_id, patient_invoice_id, amount_gross, created_by
           ) VALUES ($1, $2, 21, $3)"#,
    )
    .bind(external_id)
    .bind(invoice_id)
    .bind(ctx.admin_id)
    .execute(&ctx.pool)
    .await
    .unwrap_err();
    assert!(too_much.to_string().contains("adjusted patient invoice total"));

    sqlx::query(
        r#"INSERT INTO external_invoice_patient_invoice_allocations (
                external_invoice_id, patient_invoice_id, amount_gross, created_by
           ) VALUES ($1, $2, 20, $3)"#,
    )
    .bind(external_id)
    .bind(invoice_id)
    .bind(ctx.admin_id)
    .execute(&ctx.pool)
    .await
    .unwrap();

    let (status, _) = request_json(
        &ctx.app,
        "POST",
        &format!("/api/v1/invoices/{invoice_id}/credit-notes"),
        &ceo,
        Some(json!({
            "request_id": Uuid::new_v4(),
            "amount_gross": 1,
            "reason": "Would undercut reconciliation",
            "issued_on": chrono::Utc::now().date_naive().to_string()
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);

    let payer_change = sqlx::query(
        "UPDATE external_invoices SET status = 'paid', paid_by = 'patient' WHERE id = $1",
    )
    .bind(external_id)
    .execute(&ctx.pool)
    .await
    .unwrap_err();
    assert!(payer_change
        .to_string()
        .contains("cannot be lower than active allocations"));
}

#[tokio::test]
async fn credit_note_requires_prepayment_allocations_to_be_released_first() {
    let Some(ctx) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let tag = format!("credit-prepay-{}", Uuid::new_v4().simple());
    let (patient_id, target_invoice_id) =
        seed_finance_case(&ctx.pool, ctx.admin_id, &tag).await;
    let order_id: Uuid = sqlx::query_scalar("SELECT order_id FROM invoices WHERE id = $1")
        .bind(target_invoice_id)
        .fetch_one(&ctx.pool)
        .await
        .unwrap();
    let advance_invoice_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO invoices (
                order_id, patient_id, invoice_number, invoice_type, status,
                issued_at, total_net, total_vat, total_gross, paid_amount,
                line_items, portal_visible, hide_amounts_from_patient, created_by
           ) VALUES ($1, $2, $3, 'advance', 'paid', now() - interval '5 days',
                     100, 0, 100, 100, '[]', true, false, $4)
           RETURNING id"#,
    )
    .bind(order_id)
    .bind(patient_id)
    .bind(format!("ADV-{tag}"))
    .bind(ctx.admin_id)
    .fetch_one(&ctx.pool)
    .await
    .unwrap();
    sqlx::query(
        r#"INSERT INTO invoice_prepayment_allocations (
                advance_invoice_id, target_invoice_id, amount_gross, created_by
           ) VALUES ($1, $2, 60, $3)"#,
    )
    .bind(advance_invoice_id)
    .bind(target_invoice_id)
    .bind(ctx.admin_id)
    .execute(&ctx.pool)
    .await
    .unwrap();
    let ceo = auth_header(ctx.admin_id, "ceo");

    for invoice_id in [advance_invoice_id, target_invoice_id] {
        let (status, _) = request_json(
            &ctx.app,
            "POST",
            &format!("/api/v1/invoices/{invoice_id}/credit-notes"),
            &ceo,
            Some(json!({
                "request_id": Uuid::new_v4(),
                "amount_gross": 50,
                "reason": "Would undercut applied prepayment",
                "issued_on": chrono::Utc::now().date_naive().to_string()
            })),
        )
        .await;
        assert_eq!(status, StatusCode::CONFLICT);
    }
}

#[tokio::test]
async fn cash_refund_is_idempotent_append_only_and_keeps_settlement_balanced() {
    let Some(ctx) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let tag = format!("invoice-refund-{}", Uuid::new_v4().simple());
    let (patient_id, invoice_id) = seed_finance_case(&ctx.pool, ctx.admin_id, &tag).await;
    let patient_user_id = seed_user(&ctx.pool, &tag, "patient").await;
    sqlx::query(
        "INSERT INTO patient_assignments (patient_id, user_id, assigned_by) VALUES ($1, $2, $3)",
    )
    .bind(patient_id)
    .bind(patient_user_id)
    .bind(ctx.admin_id)
    .execute(&ctx.pool)
    .await
    .unwrap();

    let ceo = auth_header(ctx.admin_id, "ceo");
    let patient = auth_header(patient_user_id, "patient");
    let today = chrono::Utc::now().date_naive().to_string();

    let (status, payment) = request_json(
        &ctx.app,
        "POST",
        &format!("/api/v1/invoices/{invoice_id}/payments"),
        &ceo,
        Some(json!({
            "request_id": Uuid::new_v4(),
            "amount_gross": 100,
            "payment_method": "bank_transfer",
            "payment_reference": format!("PAY-REFUND-{tag}"),
            "received_on": today
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{payment:?}");
    let payment_id =
        Uuid::parse_str(payment["payment_transaction_id"].as_str().unwrap()).unwrap();

    let (status, credit) = request_json(
        &ctx.app,
        "POST",
        &format!("/api/v1/invoices/{invoice_id}/credit-notes"),
        &ceo,
        Some(json!({
            "request_id": Uuid::new_v4(),
            "amount_gross": 40,
            "reason": "Service scope reduced after settlement",
            "issued_on": today,
            "portal_visible": true
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{credit:?}");
    assert_eq!(credit["invoice"]["paid_amount"], "100");
    assert_eq!(credit["invoice"]["credit_balance"], "40");
    assert_eq!(credit["invoice"]["refundable_cash_amount"], "40");

    let request_id = Uuid::new_v4();
    let refund_payload = json!({
        "request_id": request_id,
        "amount_gross": 40,
        "payment_method": "bank_transfer",
        "payment_reference": format!("REFUND-{tag}"),
        "refunded_on": today,
        "reason": "Return patient credit",
        "note": "Internal refund note"
    });
    let (status, refunded) = request_json(
        &ctx.app,
        "POST",
        &format!("/api/v1/invoices/{invoice_id}/refunds"),
        &ceo,
        Some(refund_payload.clone()),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{refunded:?}");
    let refund_id =
        Uuid::parse_str(refunded["refund_transaction_id"].as_str().unwrap()).unwrap();
    assert_eq!(refunded["invoice"]["paid_amount"], "60");
    assert_eq!(refunded["invoice"]["balance_due"], "0");
    assert_eq!(refunded["invoice"]["credit_balance"], "0");
    assert_eq!(refunded["invoice"]["refundable_cash_amount"], "0");

    let (status, replay) = request_json(
        &ctx.app,
        "POST",
        &format!("/api/v1/invoices/{invoice_id}/refunds"),
        &ceo,
        Some(refund_payload.clone()),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{replay:?}");
    assert_eq!(replay["idempotent_replay"], true);
    assert_eq!(replay["refund_transaction_id"], refund_id.to_string());

    let mut drifted_refund = refund_payload;
    drifted_refund["amount_gross"] = json!(39);
    let (status, _) = request_json(
        &ctx.app,
        "POST",
        &format!("/api/v1/invoices/{invoice_id}/refunds"),
        &ceo,
        Some(drifted_refund),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);

    let (status, _) = request_json(
        &ctx.app,
        "POST",
        &format!("/api/v1/invoices/{invoice_id}/refunds"),
        &ceo,
        Some(json!({
            "request_id": Uuid::new_v4(),
            "amount_gross": 1,
            "payment_method": "bank_transfer",
            "refunded_on": today,
            "reason": "Would over-refund"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);

    let (status, _) = request_json(
        &ctx.app,
        "POST",
        &format!("/api/v1/invoices/{invoice_id}/payments/{payment_id}/reversal"),
        &ceo,
        Some(json!({ "note": "Cannot reverse cash already refunded" })),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);

    let (status, portal_history) = request_json(
        &ctx.app,
        "GET",
        &format!("/api/v1/me/invoices/{invoice_id}/refunds"),
        &patient,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{portal_history:?}");
    assert_eq!(portal_history["items"].as_array().unwrap().len(), 1);
    assert_eq!(portal_history["items"][0]["amount_gross"], "40");
    assert_eq!(portal_history["items"][0]["effective_amount_gross"], "-40");
    assert!(portal_history["items"][0].get("note").is_none());
    assert!(portal_history["items"][0].get("created_by").is_none());

    sqlx::query("UPDATE invoices SET hide_amounts_from_patient = true WHERE id = $1")
        .bind(invoice_id)
        .execute(&ctx.pool)
        .await
        .unwrap();
    let (status, hidden_invoice) = request_json(
        &ctx.app,
        "GET",
        &format!("/api/v1/me/invoices/{invoice_id}"),
        &patient,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{hidden_invoice:?}");
    assert!(hidden_invoice["refundable_cash_amount"].is_null());
    let (status, _) = request_json(
        &ctx.app,
        "GET",
        &format!("/api/v1/me/invoices/{invoice_id}/refunds"),
        &patient,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    let (status, statement) = request_json(
        &ctx.app,
        "GET",
        &format!("/api/v1/patients/{patient_id}/account-statement?currency=USD"),
        &ceo,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{statement:?}");
    assert_eq!(statement["summary"]["invoice_due"], "0");
    assert_eq!(statement["settlement"]["closing_balance"], "0");
    assert!(statement["items"]
        .as_array()
        .unwrap()
        .iter()
        .any(|item| item["movement_type"] == "refund" && item["debit"] == "40"));

    let accounting = sqlx::query(
        r#"SELECT COALESCE(SUM(amount), 0) AS amount,
                  COUNT(*)::BIGINT AS entry_count,
                  COUNT(source_invoice_refund_transaction_id)::BIGINT AS refund_entry_count
           FROM accounting_entries
           WHERE source_invoice_id = $1"#,
    )
    .bind(invoice_id)
    .fetch_one(&ctx.pool)
    .await
    .unwrap();
    assert_eq!(accounting.get::<Decimal, _>("amount"), Decimal::new(60, 0));
    assert_eq!(accounting.get::<i64, _>("entry_count"), 2);
    assert_eq!(accounting.get::<i64, _>("refund_entry_count"), 1);

    let (status, reversed) = request_json(
        &ctx.app,
        "POST",
        &format!("/api/v1/invoices/{invoice_id}/refunds/{refund_id}/reversal"),
        &ceo,
        Some(json!({ "reason": "Refund transfer was rejected" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{reversed:?}");
    assert_eq!(reversed["invoice"]["paid_amount"], "100");
    assert_eq!(reversed["invoice"]["credit_balance"], "40");
    assert_eq!(reversed["invoice"]["refundable_cash_amount"], "40");

    let (status, _) = request_json(
        &ctx.app,
        "POST",
        &format!("/api/v1/invoices/{invoice_id}/refunds/{refund_id}/reversal"),
        &ceo,
        Some(json!({ "reason": "Second reversal" })),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);

    let immutable_error = sqlx::query(
        "UPDATE invoice_refund_transactions SET reason = 'mutated' WHERE id = $1",
    )
    .bind(refund_id)
    .execute(&ctx.pool)
    .await
    .unwrap_err();
    assert!(immutable_error.to_string().contains("append-only"));
}
