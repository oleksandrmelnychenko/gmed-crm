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
        "issued_on": gmed_server::app_time::today().to_string(),
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
    let credit_id =
        Uuid::parse_str(created["credit_note_transaction_id"].as_str().unwrap()).unwrap();

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
            "issued_on": gmed_server::app_time::today().to_string()
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

    let accounting_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM accounting_entries WHERE source_invoice_id = $1")
            .bind(invoice_id)
            .fetch_one(&ctx.pool)
            .await
            .unwrap();
    assert_eq!(
        accounting_count, 0,
        "unpaid credit notes are not cash-basis income"
    );

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
    assert_eq!(statement["summary"]["closing_balance"], "60");
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
    assert_eq!(
        summary["breakdown_by_service_type"][0]["revenue_gross"],
        "60"
    );
    let cutoff = gmed_server::app_time::today() - chrono::Duration::days(1);
    let (status, before_credit) = request_json(
        &ctx.app,
        "GET",
        &format!("/api/v1/patients/{patient_id}/account-statement?currency=USD&to={cutoff}"),
        &ceo,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{before_credit:?}");
    assert_eq!(before_credit["summary"]["invoice_due"], "100");
    assert_eq!(before_credit["summary"]["closing_balance"], "100");

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
            "received_on": gmed_server::app_time::today().to_string()
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{payment:?}");
    let (status, before_payment) = request_json(
        &ctx.app,
        "GET",
        &format!("/api/v1/patients/{patient_id}/account-statement?currency=USD&to={cutoff}"),
        &ceo,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{before_payment:?}");
    assert_eq!(before_payment["summary"]["invoice_due"], "100");
    assert_eq!(before_payment["summary"]["closing_balance"], "100");

    let update_error =
        sqlx::query("UPDATE invoice_credit_note_transactions SET reason = 'mutated' WHERE id = $1")
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
            "issued_on": (gmed_server::app_time::today() - chrono::Duration::days(10)).to_string()
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
            "issued_on": gmed_server::app_time::today().to_string()
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
    assert!(
        too_much
            .to_string()
            .contains("adjusted patient invoice total")
    );

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
            "issued_on": gmed_server::app_time::today().to_string()
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
    assert!(
        payer_change
            .to_string()
            .contains("cannot be lower than active allocations")
    );
}

#[tokio::test]
async fn credit_note_requires_prepayment_allocations_to_be_released_first() {
    let Some(ctx) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let tag = format!("credit-prepay-{}", Uuid::new_v4().simple());
    let (patient_id, target_invoice_id) = seed_finance_case(&ctx.pool, ctx.admin_id, &tag).await;
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
                "issued_on": gmed_server::app_time::today().to_string()
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
    let today = gmed_server::app_time::today().to_string();

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
    let payment_id = Uuid::parse_str(payment["payment_transaction_id"].as_str().unwrap()).unwrap();

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
    let refund_id = Uuid::parse_str(refunded["refund_transaction_id"].as_str().unwrap()).unwrap();
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
    assert_eq!(statement["summary"]["closing_balance"], "0");
    assert!(
        statement["movements"]
            .as_array()
            .unwrap()
            .iter()
            .any(|item| item["kind"] == "refund" && item["debit"] == "40")
    );

    let accounting = sqlx::query(
        r#"SELECT COALESCE(SUM(amount_gross), 0) AS amount,
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

    let immutable_error =
        sqlx::query("UPDATE invoice_refund_transactions SET reason = 'mutated' WHERE id = $1")
            .bind(refund_id)
            .execute(&ctx.pool)
            .await
            .unwrap_err();
    assert!(immutable_error.to_string().contains("append-only"));
}

/// A 19 % service (500 net, 95 VAT) and a 0 % pass-through hotel (481.50) on
/// one EUR invoice, released five days ago and visible in the portal.
async fn seed_mixed_rate_invoice(pool: &PgPool, admin_id: Uuid, tag: &str) -> (Uuid, Uuid, Uuid) {
    let patient_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO patients (
                patient_id, first_name, last_name, birth_date, gender, created_by, languages
           ) VALUES ($1, 'Mixed', 'Rates', '1985-03-04', 'diverse', $2, ARRAY['de'])
           RETURNING id"#,
    )
    .bind(format!("PT-{tag}"))
    .bind(admin_id)
    .fetch_one(pool)
    .await
    .unwrap();
    let order_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO orders (order_number, patient_id, phase, status, currency, created_by)
           VALUES ($1, $2, 'execution', 'active', 'EUR', $3)
           RETURNING id"#,
    )
    .bind(format!("ORD-{tag}"))
    .bind(patient_id)
    .bind(admin_id)
    .fetch_one(pool)
    .await
    .unwrap();
    let invoice_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO invoices (
                order_id, patient_id, invoice_number, invoice_type, status,
                issued_at, due_date, total_net, total_vat, total_gross,
                paid_amount, line_items, portal_visible,
                hide_amounts_from_patient, created_by
           ) VALUES (
                $1, $2, $3, 'final', 'sent', now() - interval '5 days',
                CURRENT_DATE + 10, 981.50, 95, 1076.50, 0,
                '[{"description":"Behandlungsorganisation","quantity":"1","unit_price":"500","vat_rate":"19","is_cost_passthrough":false,"line_net":"500","line_vat":"95","line_gross":"595"},
                  {"description":"Hotel","quantity":"3","unit_price":"160.5","vat_rate":"0","is_cost_passthrough":true,"line_net":"481.50","line_vat":"0","line_gross":"481.50"}]',
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
    (patient_id, order_id, invoice_id)
}

async fn category_totals(pool: &PgPool, invoice_id: Uuid) -> Vec<(String, Decimal, Decimal)> {
    sqlx::query(
        r#"SELECT category, SUM(amount_gross) AS gross, SUM(amount_vat) AS vat
           FROM accounting_entries
           WHERE source_invoice_id = $1
           GROUP BY category
           HAVING SUM(amount_gross) <> 0 OR SUM(amount_vat) <> 0
           ORDER BY category"#,
    )
    .bind(invoice_id)
    .fetch_all(pool)
    .await
    .unwrap()
    .into_iter()
    .map(|row| (row.get("category"), row.get("gross"), row.get("vat")))
    .collect()
}

async fn request_status_and_type(
    app: &axum::Router,
    path: &str,
    bearer: &str,
) -> (StatusCode, String, usize) {
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(path)
                .header("Authorization", bearer)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let status = response.status();
    let content_type = response
        .headers()
        .get("content-type")
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default()
        .to_string();
    let bytes = axum::body::to_bytes(response.into_body(), 4 * 1024 * 1024)
        .await
        .unwrap();
    assert!(
        content_type != "application/pdf" || bytes.starts_with(b"%PDF"),
        "PDF body expected"
    );
    (status, content_type, bytes.len())
}

#[tokio::test]
async fn line_credit_notes_follow_line_vat_split_cash_accounting_and_print_a_document() {
    let Some(ctx) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let tag = format!("credit-lines-{}", Uuid::new_v4().simple());
    let (patient_id, order_id, invoice_id) =
        seed_mixed_rate_invoice(&ctx.pool, ctx.admin_id, &tag).await;
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
    let today = gmed_server::app_time::today().to_string();

    let (status, detail) = request_json(
        &ctx.app,
        "GET",
        &format!("/api/v1/invoices/{invoice_id}"),
        &ceo,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{detail:?}");
    assert_eq!(detail["creditable_lines"][1]["remaining_gross"], "481.5");
    assert_eq!(detail["creditable_lines"][1]["vat_rate"], "0");

    let (status, payment) = request_json(
        &ctx.app,
        "POST",
        &format!("/api/v1/invoices/{invoice_id}/payments"),
        &ceo,
        Some(json!({
            "request_id": Uuid::new_v4(),
            "amount_gross": "1076.50",
            "payment_method": "bank_transfer",
            "received_on": today
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{payment:?}");
    assert_eq!(
        category_totals(&ctx.pool, invoice_id).await,
        vec![
            (
                "cost_passthrough_revenue".to_string(),
                Decimal::new(48150, 2),
                Decimal::ZERO
            ),
            (
                "service_revenue".to_string(),
                Decimal::new(595, 0),
                Decimal::new(95, 0)
            ),
        ]
    );

    // A bare amount is ambiguous on an invoice with two VAT rates.
    let (status, ambiguous) = request_json(
        &ctx.app,
        "POST",
        &format!("/api/v1/invoices/{invoice_id}/credit-notes"),
        &ceo,
        Some(json!({
            "request_id": Uuid::new_v4(),
            "amount_gross": "481.50",
            "reason": "Hotel not used",
            "issued_on": today
        })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{ambiguous:?}");

    let hotel_request = json!({
        "request_id": Uuid::new_v4(),
        "lines": [{ "line_index": 1 }],
        "reason": "Hotel not used",
        "issued_on": today,
        "portal_visible": true
    });
    let (status, hotel) = request_json(
        &ctx.app,
        "POST",
        &format!("/api/v1/invoices/{invoice_id}/credit-notes"),
        &ceo,
        Some(hotel_request.clone()),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{hotel:?}");
    assert_eq!(hotel["credit_mode"], "lines");
    assert_eq!(hotel["amount_gross"], "481.5");
    assert_eq!(hotel["amount_vat"], "0", "a 0 % line credits no VAT");
    assert_eq!(hotel["invoice"]["credit_balance"], "481.5");
    assert_eq!(hotel["invoice"]["refundable_cash_amount"], "481.5");
    assert_eq!(
        hotel["invoice"]["creditable_lines"][1]["remaining_gross"],
        "0"
    );
    let hotel_id = hotel["credit_note_transaction_id"]
        .as_str()
        .unwrap()
        .to_string();

    let (status, replay) = request_json(
        &ctx.app,
        "POST",
        &format!("/api/v1/invoices/{invoice_id}/credit-notes"),
        &ceo,
        Some(hotel_request),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{replay:?}");
    assert_eq!(replay["idempotent_replay"], true);

    let (status, _) = request_json(
        &ctx.app,
        "POST",
        &format!("/api/v1/invoices/{invoice_id}/credit-notes"),
        &ceo,
        Some(json!({
            "request_id": Uuid::new_v4(),
            "lines": [{ "line_index": 1, "amount_gross": "0.01" }],
            "reason": "Hotel line is already credited",
            "issued_on": today
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);

    // An amount within the 19 % rate credits 19 % VAT.
    let (status, service) = request_json(
        &ctx.app,
        "POST",
        &format!("/api/v1/invoices/{invoice_id}/credit-notes"),
        &ceo,
        Some(json!({
            "request_id": Uuid::new_v4(),
            "vat_rate": "19",
            "amount_gross": "119",
            "reason": "Goodwill on organisation",
            "issued_on": today,
            "portal_visible": false
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{service:?}");
    assert_eq!(service["credit_mode"], "vat_rate");
    assert_eq!(service["amount_vat"], "19");
    assert_eq!(service["amount_net"], "100");
    assert_eq!(service["invoice"]["credited_amount"], "600.5");
    let service_id = service["credit_note_transaction_id"]
        .as_str()
        .unwrap()
        .to_string();

    let (status, history) = request_json(
        &ctx.app,
        "GET",
        &format!("/api/v1/invoices/{invoice_id}/credit-notes"),
        &ceo,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{history:?}");
    let hotel_entry = history["items"]
        .as_array()
        .unwrap()
        .iter()
        .find(|item| item["id"] == hotel_id.as_str())
        .unwrap();
    assert_eq!(hotel_entry["line_items"][0]["invoice_line_index"], 1);
    assert_eq!(hotel_entry["line_items"][0]["is_cost_passthrough"], true);
    assert_eq!(hotel_entry["vat_breakdown"][0]["vat_rate"], "0");
    assert_eq!(hotel_entry["pdf_available"], true);

    // Output VAT of the order is reduced only by the credited 19 % amount.
    let (status, economics) = request_json(
        &ctx.app,
        "GET",
        &format!("/api/v1/orders/{order_id}/economics"),
        &ceo,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{economics:?}");
    assert_eq!(economics["actual"]["credited_vat"], "19");
    assert_eq!(economics["actual"]["recognized_revenue_vat"], "76");

    // Refunding the credit reverses cash exactly where it was credited.
    let (status, refund) = request_json(
        &ctx.app,
        "POST",
        &format!("/api/v1/invoices/{invoice_id}/refunds"),
        &ceo,
        Some(json!({
            "request_id": Uuid::new_v4(),
            "amount_gross": "600.50",
            "payment_method": "bank_transfer",
            "refunded_on": today,
            "reason": "Return credited amounts"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{refund:?}");
    assert_eq!(
        category_totals(&ctx.pool, invoice_id).await,
        vec![(
            "service_revenue".to_string(),
            Decimal::new(476, 0),
            Decimal::new(76, 0)
        )],
        "the hotel credit reverses pass-through revenue without VAT, the service credit 19 % VAT"
    );

    let (status, content_type, _) = request_status_and_type(
        &ctx.app,
        &format!("/api/v1/invoices/{invoice_id}/credit-notes/{hotel_id}/pdf"),
        &ceo,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(content_type, "application/pdf");
    let (status, content_type, _) = request_status_and_type(
        &ctx.app,
        &format!("/api/v1/me/invoices/{invoice_id}/credit-notes/{hotel_id}/pdf"),
        &patient,
    )
    .await;
    assert_eq!(
        status,
        StatusCode::OK,
        "visible credit note PDF in the portal"
    );
    assert_eq!(content_type, "application/pdf");
    let (status, _, _) = request_status_and_type(
        &ctx.app,
        &format!("/api/v1/me/invoices/{invoice_id}/credit-notes/{service_id}/pdf"),
        &patient,
    )
    .await;
    assert_eq!(
        status,
        StatusCode::NOT_FOUND,
        "internal credit note stays hidden"
    );

    let (status, portal) = request_json(
        &ctx.app,
        "GET",
        &format!("/api/v1/me/invoices/{invoice_id}/credit-notes"),
        &patient,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{portal:?}");
    assert_eq!(portal["items"].as_array().unwrap().len(), 1);
    assert_eq!(portal["items"][0]["pdf_available"], true);
    assert_eq!(portal["items"][0]["line_items"][0]["description"], "Hotel");

    // A legacy pro-rata credit note (stored before line credits) still reads.
    sqlx::query(
        r#"INSERT INTO invoice_credit_note_transactions (
                invoice_id, transaction_type, request_id, document_number, reason,
                amount_net, amount_vat, amount_gross, currency, issued_on,
                portal_visible, created_by
           ) VALUES ($1, 'credit_note', $2, $3, 'Legacy pro-rata', 0.84, 0.16, 1, 'EUR',
                     CURRENT_DATE, true, $4)"#,
    )
    .bind(invoice_id)
    .bind(Uuid::new_v4())
    .bind(format!("CN-LEGACY-{tag}"))
    .bind(ctx.admin_id)
    .execute(&ctx.pool)
    .await
    .unwrap();
    let (status, history) = request_json(
        &ctx.app,
        "GET",
        &format!("/api/v1/invoices/{invoice_id}/credit-notes"),
        &ceo,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{history:?}");
    let legacy = history["items"]
        .as_array()
        .unwrap()
        .iter()
        .find(|item| item["credit_mode"] == "legacy_pro_rata")
        .unwrap();
    assert!(legacy["line_items"].is_null());
    let legacy_id = legacy["id"].as_str().unwrap();
    let (status, content_type, _) = request_status_and_type(
        &ctx.app,
        &format!("/api/v1/invoices/{invoice_id}/credit-notes/{legacy_id}/pdf"),
        &ceo,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(content_type, "application/pdf");

    // The reversal mirrors the credited lines, so VAT per rate reverses too.
    let (status, reversed) = request_json(
        &ctx.app,
        "POST",
        &format!("/api/v1/invoices/{invoice_id}/credit-notes/{service_id}/reversal"),
        &ceo,
        Some(json!({ "reason": "Goodwill withdrawn" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{reversed:?}");
    let reversal_id = reversed["reversal_transaction_id"].as_str().unwrap();
    let reversal = sqlx::query(
        "SELECT credit_mode, line_items, amount_vat FROM invoice_credit_note_transactions WHERE id = $1",
    )
    .bind(Uuid::parse_str(reversal_id).unwrap())
    .fetch_one(&ctx.pool)
    .await
    .unwrap();
    assert_eq!(reversal.get::<String, _>("credit_mode"), "vat_rate");
    assert_eq!(
        reversal.get::<Decimal, _>("amount_vat"),
        Decimal::new(19, 0)
    );
    assert!(reversal.get::<Option<Value>, _>("line_items").is_some());
    let (status, content_type, _) = request_status_and_type(
        &ctx.app,
        &format!("/api/v1/invoices/{invoice_id}/credit-notes/{reversal_id}/pdf"),
        &ceo,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(content_type, "application/pdf");

    // The database refuses credited lines that do not add up.
    let inconsistent = sqlx::query(
        r#"INSERT INTO invoice_credit_note_transactions (
                invoice_id, transaction_type, request_id, document_number, reason,
                amount_net, amount_vat, amount_gross, currency, issued_on,
                portal_visible, created_by, credit_mode, line_items
           ) VALUES ($1, 'credit_note', $2, $3, 'Tampered', 10, 0, 10, 'EUR',
                     CURRENT_DATE, true, $4, 'lines',
                     '[{"invoice_line_index":0,"line_net":"5","line_vat":"0","line_gross":"5"}]')"#,
    )
    .bind(invoice_id)
    .bind(Uuid::new_v4())
    .bind(format!("CN-BAD-{tag}"))
    .bind(ctx.admin_id)
    .execute(&ctx.pool)
    .await
    .unwrap_err();
    assert!(
        inconsistent
            .to_string()
            .contains("sum of its credited lines")
    );
}
