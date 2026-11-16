//! Contract budget of an order (owner decision 2026-11-17): the signed sum of
//! GMED's own services against what is planned and invoiced. Pass-through
//! costs never count, cancelled services drop out, approved amendments and
//! follow-up quotes add to the contract. Synthetic data only.

mod support;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use rust_decimal::Decimal;
use serde_json::{Value, json};
use sqlx::PgPool;
use tower::ServiceExt;
use uuid::Uuid;

use gmed_server::auth::jwt;

const TEST_SECRET: &str = "test-secret-at-least-32-characters-long!!";

async fn get_budget(app: &axum::Router, order_id: Uuid, bearer: &str) -> (StatusCode, Value) {
    let request = Request::builder()
        .method("GET")
        .uri(format!("/api/v1/orders/{order_id}/budget"))
        .header("Authorization", bearer)
        .body(Body::empty())
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

fn money(value: &Value) -> Decimal {
    value
        .as_str()
        .unwrap_or_else(|| panic!("money string expected, got {value:?}"))
        .parse()
        .unwrap()
}

async fn seed_order(pool: &PgPool, admin_id: Uuid, tag: &str) -> (Uuid, Uuid) {
    let patient_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO patients (patient_id, first_name, last_name, birth_date, gender, created_by)
           VALUES ($1, 'Anna', 'Muster', '1990-01-01', 'diverse', $2)
           RETURNING id"#,
    )
    .bind(format!("PT-B-{tag}"))
    .bind(admin_id)
    .fetch_one(pool)
    .await
    .unwrap();
    let order_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO orders (order_number, patient_id, phase, status, currency, created_by)
           VALUES ($1, $2, 'execution', 'active', 'EUR', $3)
           RETURNING id"#,
    )
    .bind(format!("ORD-B-{tag}"))
    .bind(patient_id)
    .bind(admin_id)
    .fetch_one(pool)
    .await
    .unwrap();
    (order_id, patient_id)
}

#[allow(clippy::too_many_arguments)]
async fn seed_line(
    pool: &PgPool,
    order_id: Uuid,
    patient_id: Uuid,
    description: &str,
    quantity: i64,
    unit_price: i64,
    vat_rate: i64,
    passthrough: bool,
) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO order_leistungen (
               order_id, patient_id, description, quantity, unit_price, currency,
               vat_rate, is_cost_passthrough, status
           ) VALUES ($1, $2, $3, $4, $5, 'EUR', $6, $7, 'planned')
           RETURNING id"#,
    )
    .bind(order_id)
    .bind(patient_id)
    .bind(description)
    .bind(Decimal::from(quantity))
    .bind(Decimal::from(unit_price))
    .bind(Decimal::from(vat_rate))
    .bind(passthrough)
    .fetch_one(pool)
    .await
    .unwrap()
}

/// The client signs the order as it is now (as the signature effect does).
async fn sign_order(pool: &PgPool, order_id: Uuid, signed_at_sql: &str) {
    sqlx::query(sqlx::AssertSqlSafe(format!(
        r#"UPDATE orders
           SET signed_patient = true,
               client_signed_terms = order_client_terms(id)
                   || jsonb_build_object('signed_at', {signed_at_sql})
           WHERE id = $1"#
    )))
    .bind(order_id)
    .execute(pool)
    .await
    .unwrap();
}

#[tokio::test]
async fn budget_counts_own_services_against_the_signed_contract() {
    let Some(context) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let (app, pool, admin_id) = (context.app, context.pool, context.admin_id);
    let ceo = auth_header(admin_id, "ceo");
    let tag = Uuid::new_v4().simple().to_string();
    let (order_id, patient_id) = seed_order(&pool, admin_id, &tag).await;

    // 1.000 + 19 % own service, 500 pass-through clinic cost.
    let own = seed_line(
        &pool,
        order_id,
        patient_id,
        "Organisation",
        1,
        1000,
        19,
        false,
    )
    .await;
    seed_line(&pool, order_id, patient_id, "Klinik", 1, 500, 0, true).await;

    // Not signed yet: no contract sum, the plan counts own services only.
    let (status, budget) = get_budget(&app, order_id, &ceo).await;
    assert_eq!(status, StatusCode::OK, "{budget:?}");
    assert_eq!(budget["contract"], Value::Null);
    assert_eq!(budget["contract_own_services_gross"], Value::Null);
    assert_eq!(budget["remaining_gross"], Value::Null);
    assert_eq!(
        money(&budget["planned_own_services_gross"]),
        Decimal::from(1190)
    );
    assert_eq!(
        money(&budget["planned_own_services_net"]),
        Decimal::from(1000)
    );

    sign_order(&pool, order_id, "to_jsonb(now() - interval '2 hours')").await;
    let (_, budget) = get_budget(&app, order_id, &ceo).await;
    assert_eq!(budget["contract"]["source"], "order_signature");
    assert_eq!(
        money(&budget["contract_own_services_gross"]),
        Decimal::from(1190)
    );
    assert_eq!(
        money(&budget["contract_own_services_net"]),
        Decimal::from(1000)
    );
    assert_eq!(money(&budget["remaining_gross"]), Decimal::ZERO);
    assert_eq!(budget["over_by_gross"], Value::Null);

    // Staff add another own service and more pass-through cost after signing:
    // only the own service runs over the contract.
    let extra = seed_line(
        &pool,
        order_id,
        patient_id,
        "Dolmetscher",
        2,
        100,
        19,
        false,
    )
    .await;
    seed_line(&pool, order_id, patient_id, "Labor", 1, 300, 0, true).await;
    let (_, budget) = get_budget(&app, order_id, &ceo).await;
    assert_eq!(
        money(&budget["planned_own_services_gross"]),
        Decimal::from(1428)
    );
    assert_eq!(money(&budget["remaining_gross"]), Decimal::from(-238));
    assert_eq!(money(&budget["over_by_gross"]), Decimal::from(238));
    assert_eq!(money(&budget["over_by_net"]), Decimal::from(200));

    // Cancelling the extra service brings the plan back to the contract.
    sqlx::query("UPDATE order_leistungen SET status = 'cancelled' WHERE id = $1")
        .bind(extra)
        .execute(&pool)
        .await
        .unwrap();
    let (_, budget) = get_budget(&app, order_id, &ceo).await;
    assert_eq!(
        money(&budget["planned_own_services_gross"]),
        Decimal::from(1190)
    );
    assert_eq!(budget["over_by_gross"], Value::Null);

    // An approved amendment (agreed with the patient) raises the contract by
    // its own-service line; a pass-through amendment does not.
    let amendment: Uuid = sqlx::query_scalar(
        r#"INSERT INTO order_amendments (
               order_id, delta_amount, agreed_note, requested_by, status,
               decided_by, decided_at, vat_treatment, vat_rate
           ) VALUES ($1, 119, 'Extra hour', $2, 'approved', $2, now(), 'standard_vat', 19)
           RETURNING id"#,
    )
    .bind(order_id)
    .bind(admin_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    sqlx::query(
        r#"INSERT INTO order_leistungen (
               order_id, patient_id, description, quantity, unit_price, currency,
               vat_rate, is_cost_passthrough, status, source_order_amendment_id
           ) VALUES ($1, $2, 'Anpassung', 1, 100, 'EUR', 19, false, 'approved', $3)"#,
    )
    .bind(order_id)
    .bind(patient_id)
    .bind(amendment)
    .execute(&pool)
    .await
    .unwrap();
    let passthrough_amendment: Uuid = sqlx::query_scalar(
        r#"INSERT INTO order_amendments (
               order_id, delta_amount, agreed_note, requested_by, status,
               decided_by, decided_at, vat_treatment, vat_rate, is_cost_passthrough
           ) VALUES ($1, 400, 'Clinic invoice higher', $2, 'approved', $2, now(),
                     'cost_passthrough', 0, true)
           RETURNING id"#,
    )
    .bind(order_id)
    .bind(admin_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    sqlx::query(
        r#"INSERT INTO order_leistungen (
               order_id, patient_id, description, quantity, unit_price, currency,
               vat_rate, is_cost_passthrough, status, source_order_amendment_id
           ) VALUES ($1, $2, 'Anpassung Klinik', 1, 400, 'EUR', 0, true, 'approved', $3)"#,
    )
    .bind(order_id)
    .bind(patient_id)
    .bind(passthrough_amendment)
    .execute(&pool)
    .await
    .unwrap();
    let (_, budget) = get_budget(&app, order_id, &ceo).await;
    assert_eq!(
        money(&budget["contract_own_services_gross"]),
        Decimal::from(1309)
    );
    assert_eq!(budget["contract"]["amendments"], 1);
    assert_eq!(
        money(&budget["planned_own_services_gross"]),
        Decimal::from(1309)
    );
    assert_eq!(money(&budget["remaining_gross"]), Decimal::ZERO);

    // A follow-up quote accepted later adds its lines to the contract; lines
    // signed before stay.
    let follow_up = seed_line(&pool, order_id, patient_id, "Transfer", 1, 200, 19, false).await;
    sqlx::query(
        r#"INSERT INTO quotes (order_id, quote_number, total_net, total_vat, total_gross,
                               status, line_items, created_by)
           VALUES ($1, $2, 200, 38, 238, 'accepted', $3, $4)"#,
    )
    .bind(order_id)
    .bind(format!("KV-B-{tag}"))
    .bind(json!([{
        "description": "Transfer", "quantity": "1", "unit_price": "200", "vat_rate": "19",
        "is_cost_passthrough": false, "line_net": "200", "line_vat": "38", "line_gross": "238",
        "source_order_leistung_id": follow_up,
    }]))
    .bind(admin_id)
    .execute(&pool)
    .await
    .unwrap();
    let (_, budget) = get_budget(&app, order_id, &ceo).await;
    assert_eq!(budget["contract"]["source"], "quote");
    assert_eq!(budget["contract"]["quote_number"], format!("KV-B-{tag}"));
    assert_eq!(
        money(&budget["contract_own_services_gross"]),
        Decimal::from(1547)
    );
    assert_eq!(
        money(&budget["planned_own_services_gross"]),
        Decimal::from(1547)
    );

    // Concierge sale prices are own services (VAT of the default profile).
    sqlx::query(
        r#"INSERT INTO concierge_services (
               patient_id, order_id, service_kind, title, status, billing_status,
               currency, quantity, unit_price, starts_at, completed_at, created_by
           ) VALUES ($1, $2, 'transfer', 'Airport', 'completed', 'ready',
                     'EUR', 1, 100, now(), now(), $3),
                    ($1, $2, 'transfer', 'Waived', 'completed', 'waived',
                     'EUR', 1, 900, now(), now(), $3)"#,
    )
    .bind(patient_id)
    .bind(order_id)
    .bind(admin_id)
    .execute(&pool)
    .await
    .unwrap();
    let (_, budget) = get_budget(&app, order_id, &ceo).await;
    let concierge_rate = money(&budget["concierge_vat_rate"]);
    let concierge_gross = (Decimal::from(100) * (Decimal::ONE_HUNDRED + concierge_rate)
        / Decimal::ONE_HUNDRED)
        .round_dp(2);
    assert_eq!(
        money(&budget["planned_parts"]["concierge_gross"]),
        concierge_gross
    );
    assert_eq!(
        money(&budget["planned_own_services_gross"]),
        Decimal::from(1547) + concierge_gross
    );
    assert_eq!(money(&budget["over_by_gross"]), concierge_gross);

    // Issued invoices: own lines count, pass-through and re-billed lines and
    // advances do not; drafts do not.
    for (number, invoice_type, status, lines) in [
        (
            "final",
            "interim",
            "sent",
            json!([
                {"description": "Organisation", "line_net": "1000", "line_vat": "190",
                 "line_gross": "1190", "is_cost_passthrough": false,
                 "source_order_leistung_id": own},
                {"description": "Klinik", "line_net": "500", "line_vat": "0",
                 "line_gross": "500", "is_cost_passthrough": true},
                {"description": "Beleg", "line_net": "50", "line_vat": "0",
                 "line_gross": "50", "source": "external_invoice"},
            ]),
        ),
        (
            "advance",
            "advance",
            "sent",
            json!([{"description": "Anzahlung", "line_net": "300", "line_gross": "300"}]),
        ),
        (
            "draft",
            "final",
            "draft",
            json!([{"description": "Entwurf", "line_net": "100", "line_gross": "119"}]),
        ),
    ] {
        sqlx::query(
            r#"INSERT INTO invoices (
                   order_id, patient_id, invoice_number, invoice_type, status,
                   total_net, total_vat, total_gross, line_items, created_by
               ) VALUES ($1, $2, $3, $4, $5, 0, 0, 0, $6, $7)"#,
        )
        .bind(order_id)
        .bind(patient_id)
        .bind(format!("INV-B-{tag}-{number}"))
        .bind(invoice_type)
        .bind(status)
        .bind(lines)
        .bind(admin_id)
        .execute(&pool)
        .await
        .unwrap_or_else(|error| panic!("insert {number} invoice: {error}"));
    }
    let (_, budget) = get_budget(&app, order_id, &ceo).await;
    assert_eq!(
        money(&budget["invoiced_own_services_gross"]),
        Decimal::from(1190)
    );
    assert_eq!(
        money(&budget["invoiced_own_services_net"]),
        Decimal::from(1000)
    );
}

#[tokio::test]
async fn budget_is_closed_to_partial_order_readers() {
    let Some(context) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let (app, pool, admin_id) = (context.app, context.pool, context.admin_id);
    let tag = Uuid::new_v4().simple().to_string();
    let (order_id, _) = seed_order(&pool, admin_id, &tag).await;
    let concierge: Uuid = sqlx::query_scalar(
        r#"INSERT INTO users (email, password_hash, name, role)
           VALUES ($1, 'test-password-hash', 'Concierge', 'concierge')
           RETURNING id"#,
    )
    .bind(format!("{tag}-concierge@example.com"))
    .fetch_one(&pool)
    .await
    .unwrap();
    let (status, _) = get_budget(&app, order_id, &auth_header(concierge, "concierge")).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}
