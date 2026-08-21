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

fn auth_header(user_id: Uuid, role: &str) -> String {
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
           ) VALUES ($1, 'Order', 'Economics', '1990-01-01', 'diverse', $2)
           RETURNING id"#,
    )
    .bind(format!("PT-{tag}"))
    .bind(created_by)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn seed_provider(pool: &PgPool, tag: &str, suffix: &str) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO providers (name, provider_type, address_city, address_country)
           VALUES ($1, 'medical', 'Berlin', 'Germany')
           RETURNING id"#,
    )
    .bind(format!("Clinic {tag} {suffix}"))
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
    suffix: &str,
    invoice_type: &str,
    status: &str,
    net: Decimal,
    vat: Decimal,
    gross: Decimal,
) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO invoices (
               order_id, patient_id, invoice_number, invoice_type, status,
               total_net, total_vat, total_gross, line_items, created_by
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, '[]', $9)
           RETURNING id"#,
    )
    .bind(order_id)
    .bind(patient_id)
    .bind(format!("INV-{tag}-{suffix}"))
    .bind(invoice_type)
    .bind(status)
    .bind(net)
    .bind(vat)
    .bind(gross)
    .bind(created_by)
    .fetch_one(pool)
    .await
    .unwrap()
}

#[tokio::test]
async fn economics_uses_recognized_revenue_cash_journals_and_incurred_partner_cost() {
    let Some(context) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let app = context.app;
    let pool = context.pool;
    let admin_id = context.admin_id;
    let tag = Uuid::new_v4().simple().to_string();
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let manager_id = seed_user(&pool, &tag, "patient_manager").await;
    sqlx::query(
        "INSERT INTO patient_assignments (patient_id, user_id, assigned_by) VALUES ($1, $2, $3)",
    )
    .bind(patient_id)
    .bind(manager_id)
    .bind(admin_id)
    .execute(&pool)
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
    .fetch_one(&pool)
    .await
    .unwrap();
    let provider_id = seed_provider(&pool, &tag, "A").await;
    let service_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO order_leistungen (
               order_id, patient_id, description, quantity, unit_price, currency,
               vat_rate, provider_id, status,
               planned_partner_cost_net, planned_partner_cost_vat,
               planned_partner_cost_gross
           ) VALUES ($1, $2, 'Treatment coordination', 1, 100, 'EUR', 19, $3,
                     'approved', 50, 9.50, 59.50)
           RETURNING id"#,
    )
    .bind(order_id)
    .bind(patient_id)
    .bind(provider_id)
    .fetch_one(&pool)
    .await
    .unwrap();

    let _draft = seed_invoice(
        &pool,
        order_id,
        patient_id,
        admin_id,
        &tag,
        "draft",
        "final",
        "draft",
        Decimal::new(500, 0),
        Decimal::new(95, 0),
        Decimal::new(595, 0),
    )
    .await;
    let advance_id = seed_invoice(
        &pool,
        order_id,
        patient_id,
        admin_id,
        &tag,
        "advance",
        "advance",
        "sent",
        Decimal::new(50, 0),
        Decimal::ZERO,
        Decimal::new(50, 0),
    )
    .await;
    let final_id = seed_invoice(
        &pool,
        order_id,
        patient_id,
        admin_id,
        &tag,
        "final",
        "final",
        "sent",
        Decimal::new(100, 0),
        Decimal::new(19, 0),
        Decimal::new(119, 0),
    )
    .await;

    for (invoice_id, amount, suffix) in [
        (advance_id, Decimal::new(50, 0), "advance"),
        (final_id, Decimal::new(20, 0), "final"),
    ] {
        sqlx::query(
            r#"INSERT INTO invoice_payment_transactions (
                   invoice_id, transaction_type, request_id, amount_gross,
                   payment_method, received_on, created_by
               ) VALUES ($1, 'payment', $2, $3, 'bank_transfer', CURRENT_DATE, $4)"#,
        )
        .bind(invoice_id)
        .bind(Uuid::new_v4())
        .bind(amount)
        .bind(admin_id)
        .execute(&pool)
        .await
        .unwrap_or_else(|error| panic!("insert {suffix} payment: {error}"));
    }

    sqlx::query(
        r#"INSERT INTO invoice_credit_note_transactions (
               invoice_id, transaction_type, request_id, document_number, reason,
               amount_net, amount_vat, amount_gross, currency, issued_on, created_by
           ) VALUES ($1, 'credit_note', $2, $3, 'Scope correction',
                     20, 3.80, 23.80, 'EUR', CURRENT_DATE, $4)"#,
    )
    .bind(final_id)
    .bind(Uuid::new_v4())
    .bind(format!("CN-{tag}"))
    .bind(admin_id)
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        r#"INSERT INTO invoice_credit_note_transactions (
               invoice_id, transaction_type, request_id, document_number, reason,
               amount_net, amount_vat, amount_gross, currency, issued_on, created_by
           ) VALUES ($1, 'credit_note', $2, $3, 'Advance correction',
                     10, 0, 10, 'EUR', CURRENT_DATE, $4)"#,
    )
    .bind(advance_id)
    .bind(Uuid::new_v4())
    .bind(format!("CN-{tag}-advance"))
    .bind(admin_id)
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        r#"INSERT INTO invoice_refund_transactions (
               invoice_id, transaction_type, request_id, amount_gross,
               payment_method, refunded_on, reason, created_by
           ) VALUES ($1, 'refund', $2, 5, 'bank_transfer', CURRENT_DATE,
                     'Return excess advance', $3)"#,
    )
    .bind(advance_id)
    .bind(Uuid::new_v4())
    .bind(admin_id)
    .execute(&pool)
    .await
    .unwrap();

    sqlx::query(
        r#"INSERT INTO external_invoices (
               order_id, patient_id, provider_id, order_leistung_id,
               external_invoice_number, amount_net, amount_vat, amount_gross,
               currency, status, paid_by, service_delivered, created_by
           ) VALUES ($1, $2, $3, $4, $5, 40, 7.60, 47.60,
                     'EUR', 'approved', 'unpaid', true, $6)"#,
    )
    .bind(order_id)
    .bind(patient_id)
    .bind(provider_id)
    .bind(service_id)
    .bind(format!("EXT-{tag}-agency"))
    .bind(admin_id)
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        r#"INSERT INTO external_invoices (
               order_id, patient_id, provider_id, external_invoice_number,
               amount_net, amount_vat, amount_gross, currency, status,
               paid_by, service_delivered, created_by
           ) VALUES ($1, $2, $3, $4, 10, 1.90, 11.90, 'EUR', 'paid',
                     'patient', true, $5)"#,
    )
    .bind(order_id)
    .bind(patient_id)
    .bind(provider_id)
    .bind(format!("EXT-{tag}-patient"))
    .bind(admin_id)
    .execute(&pool)
    .await
    .unwrap();

    let ceo = auth_header(admin_id, "ceo");
    let (status, economics) = json_request(
        &app,
        "GET",
        &format!("/api/v1/orders/{order_id}/economics"),
        &ceo,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "economics response: {economics:?}");
    assert_eq!(economics["planned"]["revenue_net"], "100");
    assert_eq!(economics["planned"]["partner_cost_net"], "50");
    assert_eq!(economics["actual"]["recognized_revenue_net"], "80");
    assert_eq!(economics["actual"]["recognized_revenue_gross"], "95.2");
    assert_eq!(economics["actual"]["patient_cash_refunded_gross"], "5");
    assert_eq!(economics["actual"]["patient_cash_collected_gross"], "65");
    assert_eq!(economics["actual"]["partner_cost_net"], "40");
    assert_eq!(economics["actual"]["paid_to_partner_gross"], "0");
    assert_eq!(economics["actual"]["unpaid_to_partner_gross"], "47.6");
    assert_eq!(
        economics["actual"]["paid_directly_by_patient_gross"],
        "11.9"
    );
    assert_eq!(economics["actual"]["margin_net"], "40");

    let manager = auth_header(manager_id, "patient_manager");
    let (manager_status, manager_economics) = json_request(
        &app,
        "GET",
        &format!("/api/v1/orders/{order_id}/economics"),
        &manager,
        None,
    )
    .await;
    assert_eq!(manager_status, StatusCode::OK);
    assert_eq!(manager_economics["margin_visible"], false);
    assert!(manager_economics["actual"]["partner_cost_net"].is_null());
    assert!(manager_economics["actual"]["margin_net"].is_null());

    let (summary_status, summary) = json_request(
        &app,
        "GET",
        &format!("/api/v1/patients/{patient_id}/financial-summary?order_id={order_id}"),
        &ceo,
        None,
    )
    .await;
    assert_eq!(summary_status, StatusCode::OK, "summary: {summary:?}");
    assert_eq!(summary["revenue_net"], "80");
    assert_eq!(summary["expenses_net"], "40");
    assert_eq!(summary["margin_net"], "40");

    let external_id: Uuid =
        sqlx::query_scalar("SELECT id FROM external_invoices WHERE external_invoice_number = $1")
            .bind(format!("EXT-{tag}-agency"))
            .fetch_one(&pool)
            .await
            .unwrap();
    let account_id: Uuid = sqlx::query_scalar(
        "SELECT id FROM company_financial_accounts WHERE currency = 'EUR' AND is_default LIMIT 1",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    sqlx::query(
        r#"INSERT INTO external_invoice_provider_payment_transactions (
               external_invoice_id, financial_account_id, transaction_type,
               request_id, amount_gross, currency, paid_on, payment_method, created_by
           ) VALUES ($1, $2, 'payment', $3, 47.60, 'EUR', CURRENT_DATE,
                     'bank_transfer', $4)"#,
    )
    .bind(external_id)
    .bind(account_id)
    .bind(Uuid::new_v4())
    .bind(admin_id)
    .execute(&pool)
    .await
    .unwrap();
    let (paid_summary_status, paid_summary) = json_request(
        &app,
        "GET",
        &format!("/api/v1/patients/{patient_id}/financial-summary?order_id={order_id}"),
        &ceo,
        None,
    )
    .await;
    assert_eq!(paid_summary_status, StatusCode::OK);
    assert_eq!(paid_summary["expenses_net"], "40");
    assert_eq!(paid_summary["margin_net"], "40");

    sqlx::query(
        "ALTER TABLE external_invoices DROP CONSTRAINT external_invoices_amount_arithmetic",
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        r#"INSERT INTO external_invoices (
               order_id, patient_id, provider_id, external_invoice_number,
               amount_net, amount_vat, amount_gross, currency, status,
               paid_by, service_delivered, created_by
           ) VALUES ($1, $2, $3, $4, 1, 1, 3, 'EUR', 'approved',
                     'unpaid', true, $5)"#,
    )
    .bind(order_id)
    .bind(patient_id)
    .bind(provider_id)
    .bind(format!("EXT-{tag}-legacy-invalid"))
    .bind(admin_id)
    .execute(&pool)
    .await
    .unwrap();
    let (invalid_summary_status, invalid_summary) = json_request(
        &app,
        "GET",
        &format!("/api/v1/patients/{patient_id}/financial-summary?order_id={order_id}"),
        &ceo,
        None,
    )
    .await;
    assert_eq!(invalid_summary_status, StatusCode::OK);
    assert_eq!(invalid_summary["economics_valid"], false);
    assert!(invalid_summary["expenses_net"].is_null());
    assert!(invalid_summary["margin_net"].is_null());

    sqlx::query(
        "ALTER TABLE external_invoices DISABLE TRIGGER validate_external_invoice_service_economics_trigger",
    )
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query(
        r#"INSERT INTO external_invoices (
               order_id, patient_id, provider_id, external_invoice_number,
               amount_net, amount_vat, amount_gross, currency, status,
               paid_by, service_delivered, created_by
           ) VALUES ($1, $2, $3, $4, 10, 2, 12, 'USD', 'approved',
                     'unpaid', true, $5)"#,
    )
    .bind(order_id)
    .bind(patient_id)
    .bind(provider_id)
    .bind(format!("EXT-{tag}-legacy-usd"))
    .bind(admin_id)
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        r#"INSERT INTO external_invoices (
               order_id, patient_id, provider_id, external_invoice_number,
               amount_net, amount_vat, amount_gross, currency, status,
               paid_by, service_delivered, created_by
           ) VALUES ($1, $2, $3, $4, 5, 1, 6, 'USD', 'expected',
                     'unpaid', false, $5)"#,
    )
    .bind(order_id)
    .bind(patient_id)
    .bind(provider_id)
    .bind(format!("EXT-{tag}-legacy-usd-expected"))
    .bind(admin_id)
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        "ALTER TABLE external_invoices ENABLE TRIGGER validate_external_invoice_service_economics_trigger",
    )
        .execute(&pool)
        .await
        .unwrap();
    let (invalid_economics_status, invalid_economics) = json_request(
        &app,
        "GET",
        &format!("/api/v1/orders/{order_id}/economics"),
        &ceo,
        None,
    )
    .await;
    assert_eq!(invalid_economics_status, StatusCode::OK);
    assert_eq!(invalid_economics["economics_valid"], false);
    assert!(invalid_economics["actual"]["partner_cost_net"].is_null());
    assert!(invalid_economics["actual"]["margin_net"].is_null());
    for summary_currency in ["EUR", "USD"] {
        let (status, summary) = json_request(
            &app,
            "GET",
            &format!(
                "/api/v1/patients/{patient_id}/financial-summary?order_id={order_id}&currency={summary_currency}"
            ),
            &ceo,
            None,
        )
        .await;
        assert_eq!(status, StatusCode::OK, "currency summary: {summary:?}");
        assert_eq!(summary["economics_valid"], false);
        assert!(summary["expenses_net"].is_null());
        assert!(summary["margin_net"].is_null());
        assert!(summary["issues"]
            .as_array()
            .is_some_and(|issues| issues.contains(&json!("external_invoice_currency_mismatch"))));
    }

    let (pass_through_status, _) = json_request(
        &app,
        "GET",
        &format!("/api/v1/patients/{patient_id}/financial-summary?include_pass_through=false"),
        &ceo,
        None,
    )
    .await;
    assert_eq!(pass_through_status, StatusCode::UNPROCESSABLE_ENTITY);
}

#[tokio::test]
async fn planned_cost_is_idempotent_and_service_links_enforce_financial_context() {
    let Some(context) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let app = context.app;
    let pool = context.pool;
    let admin_id = context.admin_id;
    let tag = Uuid::new_v4().simple().to_string();
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let order_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO orders (order_number, patient_id, currency, created_by)
           VALUES ($1, $2, 'EUR', $3) RETURNING id"#,
    )
    .bind(format!("ORD-{tag}"))
    .bind(patient_id)
    .bind(admin_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    let provider_a = seed_provider(&pool, &tag, "A").await;
    let provider_b = seed_provider(&pool, &tag, "B").await;
    let billing_id = seed_user(&pool, &tag, "billing").await;
    let service_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO order_leistungen (
               order_id, patient_id, description, quantity, unit_price,
               currency, vat_rate, provider_id
           ) VALUES ($1, $2, 'Clinic service', 1, 100, 'EUR', 19, $3)
           RETURNING id"#,
    )
    .bind(order_id)
    .bind(patient_id)
    .bind(provider_a)
    .fetch_one(&pool)
    .await
    .unwrap();
    let ceo = auth_header(admin_id, "ceo");
    let billing = auth_header(billing_id, "billing");
    let request_id = Uuid::new_v4();
    let cost_payload = json!({
        "request_id": request_id,
        "amount_net": "60.00",
        "amount_vat": "11.40",
        "amount_gross": "71.40",
        "reason": "Updated provider estimate"
    });
    for expected_status in [StatusCode::OK, StatusCode::OK] {
        let (status, body) = json_request(
            &app,
            "POST",
            &format!("/api/v1/orders/{order_id}/leistungen/{service_id}/planned-cost"),
            &billing,
            Some(cost_payload.clone()),
        )
        .await;
        assert_eq!(status, expected_status, "planned cost response: {body:?}");
    }
    let (drift_status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/orders/{order_id}/leistungen/{service_id}/planned-cost"),
        &ceo,
        Some(json!({
            "request_id": request_id,
            "amount_net": "61.00",
            "amount_vat": "11.59",
            "amount_gross": "72.59",
            "reason": "Updated provider estimate"
        })),
    )
    .await;
    assert_eq!(drift_status, StatusCode::CONFLICT);
    let (oversized_cost_status, oversized_cost_body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/orders/{order_id}/leistungen/{service_id}/planned-cost"),
        &billing,
        Some(json!({
            "request_id": Uuid::new_v4(),
            "amount_net": "10000000000.00",
            "amount_vat": "0.00",
            "amount_gross": "10000000000.00",
            "reason": "Unsupported value"
        })),
    )
    .await;
    assert_eq!(
        oversized_cost_status,
        StatusCode::UNPROCESSABLE_ENTITY,
        "oversized cost response: {oversized_cost_body:?}"
    );
    let history_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM order_leistung_planned_cost_changes WHERE order_leistung_id = $1",
    )
    .bind(service_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(history_count, 1);
    let unjournaled_cost_change = sqlx::query(
        r#"UPDATE order_leistungen
           SET planned_partner_cost_net = 99,
               planned_partner_cost_vat = 18.81,
               planned_partner_cost_gross = 117.81
           WHERE id = $1"#,
    )
    .bind(service_id)
    .execute(&pool)
    .await;
    assert!(unjournaled_cost_change.is_err());

    for (payload, expected) in [
        (
            json!({
                "provider_id": provider_a,
                "order_leistung_id": service_id,
                "external_invoice_number": format!("EXT-{tag}-currency"),
                "amount_net": 10,
                "amount_vat": 1.9,
                "amount_gross": 11.9,
                "currency": "USD",
                "status": "approved",
                "paid_by": "unpaid",
                "service_delivered": true
            }),
            StatusCode::UNPROCESSABLE_ENTITY,
        ),
        (
            json!({
                "provider_id": provider_a,
                "order_leistung_id": service_id,
                "external_invoice_number": format!("EXT-{tag}-amount"),
                "amount_net": 10,
                "amount_vat": 1,
                "amount_gross": 12,
                "currency": "EUR",
                "status": "approved",
                "paid_by": "unpaid",
                "service_delivered": true
            }),
            StatusCode::UNPROCESSABLE_ENTITY,
        ),
        (
            json!({
                "provider_id": provider_b,
                "order_leistung_id": service_id,
                "external_invoice_number": format!("EXT-{tag}-provider"),
                "amount_net": 10,
                "amount_vat": 1.9,
                "amount_gross": 11.9,
                "currency": "EUR",
                "status": "approved",
                "paid_by": "unpaid",
                "service_delivered": true
            }),
            StatusCode::UNPROCESSABLE_ENTITY,
        ),
        (
            json!({
                "provider_id": provider_a,
                "order_leistung_id": service_id,
                "external_invoice_number": format!("EXT-{tag}-oversized"),
                "amount_net": 1e100,
                "amount_vat": 0,
                "amount_gross": 1e100,
                "currency": "EUR",
                "status": "approved",
                "paid_by": "unpaid",
                "service_delivered": true
            }),
            StatusCode::UNPROCESSABLE_ENTITY,
        ),
    ] {
        let (status, body) = json_request(
            &app,
            "POST",
            &format!("/api/v1/orders/{order_id}/external-invoices"),
            &billing,
            Some(payload),
        )
        .await;
        assert_eq!(status, expected, "external invoice guard: {body:?}");
    }

    let mut service_change = pool.begin().await.unwrap();
    sqlx::query("UPDATE order_leistungen SET provider_id = $2 WHERE id = $1")
        .bind(service_id)
        .bind(provider_b)
        .execute(&mut *service_change)
        .await
        .unwrap();
    let racing_create = tokio::spawn({
        let app = app.clone();
        let billing = billing.clone();
        let racing_tag = tag.clone();
        async move {
            json_request(
                &app,
                "POST",
                &format!("/api/v1/orders/{order_id}/external-invoices"),
                &billing,
                Some(json!({
                    "provider_id": provider_a,
                    "order_leistung_id": service_id,
                    "external_invoice_number": format!("EXT-{racing_tag}-racing-link"),
                    "amount_net": 10,
                    "amount_vat": 1.9,
                    "amount_gross": 11.9,
                    "currency": "EUR",
                    "status": "approved",
                    "paid_by": "unpaid",
                    "service_delivered": true
                })),
            )
            .await
        }
    });
    tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
    service_change.commit().await.unwrap();
    let (racing_status, racing_body) = racing_create.await.unwrap();
    assert_eq!(
        racing_status,
        StatusCode::UNPROCESSABLE_ENTITY,
        "racing link response: {racing_body:?}"
    );
    sqlx::query("UPDATE order_leistungen SET provider_id = $2 WHERE id = $1")
        .bind(service_id)
        .bind(provider_a)
        .execute(&pool)
        .await
        .unwrap();

    let external_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO external_invoices (
               order_id, patient_id, provider_id, order_leistung_id,
               external_invoice_number, amount_net, amount_vat, amount_gross,
               currency, status, paid_by, service_delivered, created_by
           ) VALUES ($1, $2, $3, $4, $5, 10, 1.90, 11.90, 'EUR',
                     'approved', 'unpaid', true, $6)
           RETURNING id"#,
    )
    .bind(order_id)
    .bind(patient_id)
    .bind(provider_a)
    .bind(service_id)
    .bind(format!("EXT-{tag}-valid"))
    .bind(admin_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    let mut blocker = pool.begin().await.unwrap();
    sqlx::query("SELECT id FROM external_invoices WHERE id = $1 FOR UPDATE")
        .bind(external_id)
        .fetch_one(&mut *blocker)
        .await
        .unwrap();
    let update_path = format!("/api/v1/orders/{order_id}/external-invoices/{external_id}/update");
    let first_update = tokio::spawn({
        let app = app.clone();
        let billing = billing.clone();
        let path = update_path.clone();
        async move {
            json_request(
                &app,
                "POST",
                &path,
                &billing,
                Some(json!({
                    "amount_net": 20,
                    "amount_vat": 3.8,
                    "amount_gross": 23.8
                })),
            )
            .await
        }
    });
    let second_update = tokio::spawn({
        let app = app.clone();
        let billing = billing.clone();
        let path = update_path.clone();
        async move {
            json_request(
                &app,
                "POST",
                &path,
                &billing,
                Some(json!({
                    "amount_net": 30,
                    "amount_vat": 5.7,
                    "amount_gross": 35.7
                })),
            )
            .await
        }
    });
    tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
    blocker.commit().await.unwrap();
    let first_status = first_update.await.unwrap().0;
    let second_status = second_update.await.unwrap().0;
    assert!(
        (first_status == StatusCode::OK && second_status == StatusCode::CONFLICT)
            || (first_status == StatusCode::CONFLICT && second_status == StatusCode::OK),
        "concurrent statuses: {first_status}, {second_status}"
    );

    let provider_change = sqlx::query("UPDATE order_leistungen SET provider_id = $2 WHERE id = $1")
        .bind(service_id)
        .bind(provider_b)
        .execute(&pool)
        .await;
    assert!(provider_change.is_err());
    let linked_service: Uuid =
        sqlx::query("SELECT order_leistung_id FROM external_invoices WHERE id = $1")
            .bind(external_id)
            .fetch_one(&pool)
            .await
            .unwrap()
            .try_get("order_leistung_id")
            .unwrap();
    assert_eq!(linked_service, service_id);

    let lead_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO leads (
               first_name, last_name, qualification_status,
               converted_patient_id, created_by
           ) VALUES ('Lead', 'Economics', 'converted', $1, $2)
           RETURNING id"#,
    )
    .bind(patient_id)
    .bind(admin_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    sqlx::query("UPDATE orders SET source_lead_id = $2 WHERE id = $1")
        .bind(order_id)
        .bind(lead_id)
        .execute(&pool)
        .await
        .unwrap();
    let client_reference = format!("lead-wizard:{lead_id}:service");
    sqlx::query("UPDATE order_leistungen SET client_reference = $2 WHERE id = $1")
        .bind(service_id)
        .bind(&client_reference)
        .execute(&pool)
        .await
        .unwrap();
    let manager_id = seed_user(&pool, &format!("{tag}-sync"), "patient_manager").await;
    sqlx::query(
        "INSERT INTO patient_assignments (patient_id, user_id, assigned_by) VALUES ($1, $2, $3)",
    )
    .bind(patient_id)
    .bind(manager_id)
    .bind(admin_id)
    .execute(&pool)
    .await
    .unwrap();
    let manager = auth_header(manager_id, "patient_manager");
    let usd_catalog_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO agency_service_catalog (
               service_key, service_name, unit_label, unit_price, currency,
               vat_rate, is_active, valid_from, created_by
           ) VALUES ($1, 'USD catalog service', 'case', 100, 'USD', 0,
                     true, CURRENT_DATE, $2)
           RETURNING id"#,
    )
    .bind(format!("economics-usd-{tag}"))
    .bind(manager_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    let (catalog_currency_status, catalog_currency_body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/orders/{order_id}/leistungen"),
        &manager,
        Some(json!({
            "agency_service_id": usd_catalog_id,
            "description": "Wrong currency service",
            "quantity": 1,
            "unit_price": 100,
            "vat_rate": 0
        })),
    )
    .await;
    assert_eq!(
        catalog_currency_status,
        StatusCode::UNPROCESSABLE_ENTITY,
        "catalog currency response: {catalog_currency_body:?}"
    );
    let usd_order_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO orders (order_number, patient_id, currency, created_by)
           VALUES ($1, $2, 'USD', $3) RETURNING id"#,
    )
    .bind(format!("ORD-USD-{tag}"))
    .bind(patient_id)
    .bind(admin_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    let (usd_service_status, usd_service_body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/orders/{usd_order_id}/leistungen"),
        &manager,
        Some(json!({
            "description": "Uncatalogued USD service",
            "quantity": 1,
            "unit_price": 100,
            "vat_rate": 0
        })),
    )
    .await;
    assert_eq!(
        usd_service_status,
        StatusCode::CREATED,
        "USD service: {usd_service_body:?}"
    );
    let usd_service_currency: String =
        sqlx::query_scalar("SELECT currency FROM order_leistungen WHERE id = $1")
            .bind(
                usd_service_body["id"]
                    .as_str()
                    .unwrap()
                    .parse::<Uuid>()
                    .unwrap(),
            )
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(usd_service_currency, "USD");
    let (oversized_service_status, oversized_service_body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/orders/{usd_order_id}/leistungen"),
        &manager,
        Some(json!({
            "description": "Unsupported service amount",
            "quantity": 1e20,
            "unit_price": 1,
            "vat_rate": 0
        })),
    )
    .await;
    assert_eq!(
        oversized_service_status,
        StatusCode::UNPROCESSABLE_ENTITY,
        "oversized service response: {oversized_service_body:?}"
    );
    let (sync_status, sync_body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/orders/{order_id}/leistungen/sync-lead-wizard"),
        &manager,
        Some(json!({
            "lead_id": lead_id,
            "client_references": []
        })),
    )
    .await;
    assert_eq!(
        sync_status,
        StatusCode::CONFLICT,
        "sync response: {sync_body:?}"
    );
    let service_still_exists: bool =
        sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM order_leistungen WHERE id = $1)")
            .bind(service_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert!(service_still_exists);

    sqlx::query(
        "ALTER TABLE order_leistungen DISABLE TRIGGER validate_order_service_currency_trigger",
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        r#"INSERT INTO order_leistungen (
               order_id, patient_id, description, quantity, unit_price,
               currency, vat_rate
           ) VALUES ($1, $2, 'Legacy foreign service', 1, 1000, 'USD', 0)"#,
    )
    .bind(order_id)
    .bind(patient_id)
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        "ALTER TABLE order_leistungen ENABLE TRIGGER validate_order_service_currency_trigger",
    )
    .execute(&pool)
    .await
    .unwrap();
    let (legacy_service_status, legacy_service_economics) = json_request(
        &app,
        "GET",
        &format!("/api/v1/orders/{order_id}/economics"),
        &ceo,
        None,
    )
    .await;
    assert_eq!(legacy_service_status, StatusCode::OK);
    assert_eq!(legacy_service_economics["economics_valid"], false);
    assert_eq!(legacy_service_economics["planned"]["revenue_net"], "100");
    assert!(legacy_service_economics["planned"]["margin_net"].is_null());
    assert!(
        legacy_service_economics["warnings"]
            .as_array()
            .is_some_and(|warnings| warnings.contains(&json!("order_service_currency_mismatch")))
    );
}
