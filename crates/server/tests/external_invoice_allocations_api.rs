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

fn auth_header_for(user_id: Uuid, role: &str) -> String {
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
    let request = Request::builder()
        .method(method)
        .uri(path)
        .header("Authorization", bearer)
        .header("Content-Type", "application/json")
        .body(match body {
            Some(value) => Body::from(serde_json::to_vec(&value).unwrap()),
            None => Body::empty(),
        })
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

async fn seed_user(pool: &PgPool, role: &str, tag: &str) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO users (email, password_hash, name, role)
           VALUES ($1, 'test-password-hash', $2, $3)
           RETURNING id"#,
    )
    .bind(format!("allocation-{tag}-{role}@example.test"))
    .bind(format!("Allocation {role} {tag}"))
    .bind(role)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn seed_order(pool: &PgPool, patient_id: Uuid, created_by: Uuid, tag: &str) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO orders (
               order_number, patient_id, phase, status, currency, created_by
           ) VALUES ($1, $2, 'execution', 'active', 'EUR', $3)
           RETURNING id"#,
    )
    .bind(format!("ALLOC-{tag}"))
    .bind(patient_id)
    .bind(created_by)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn seed_patient_invoice(
    pool: &PgPool,
    order_id: Uuid,
    patient_id: Uuid,
    created_by: Uuid,
    number: &str,
    total_gross: i64,
) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO invoices (
               order_id, patient_id, invoice_number, invoice_type, status,
               total_net, total_vat, total_gross, paid_amount,
               line_items, portal_visible, created_by
           ) VALUES ($1, $2, $3, 'interim', 'sent', $4, 0, $4, 0, '[]', true, $5)
           RETURNING id"#,
    )
    .bind(order_id)
    .bind(patient_id)
    .bind(number)
    .bind(total_gross)
    .bind(created_by)
    .fetch_one(pool)
    .await
    .unwrap()
}

#[tokio::test]
async fn external_receivable_allocations_are_explicit_reversible_and_balance_safe() {
    let Some(ctx) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let tag = Uuid::new_v4().simple().to_string();
    let manager_id = seed_user(&ctx.pool, "patient_manager", &tag).await;
    let sales_id = seed_user(&ctx.pool, "sales", &tag).await;
    let patient_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO patients (
               patient_id, first_name, last_name, birth_date, gender, created_by
           ) VALUES ($1, 'Allocation', 'Patient', '1990-01-01', 'diverse', $2)
           RETURNING id"#,
    )
    .bind(format!("ALLOC-PT-{tag}"))
    .bind(ctx.admin_id)
    .fetch_one(&ctx.pool)
    .await
    .unwrap();
    sqlx::query(
        r#"INSERT INTO patient_assignments (patient_id, user_id, assigned_by)
           VALUES ($1, $2, $3)"#,
    )
    .bind(patient_id)
    .bind(manager_id)
    .bind(ctx.admin_id)
    .execute(&ctx.pool)
    .await
    .unwrap();

    let order_id = seed_order(&ctx.pool, patient_id, ctx.admin_id, &tag).await;
    let invoice_id = seed_patient_invoice(
        &ctx.pool,
        order_id,
        patient_id,
        ctx.admin_id,
        &format!("PAT-{tag}"),
        150,
    )
    .await;
    let external_invoice_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO external_invoices (
               order_id, patient_id, external_invoice_number,
               amount_net, amount_vat, amount_gross, currency,
               status, paid_by, service_delivered, created_by
           ) VALUES ($1, $2, $3, 100, 0, 100, 'EUR', 'paid', 'agency', true, $4)
           RETURNING id"#,
    )
    .bind(order_id)
    .bind(patient_id)
    .bind(format!("EXT-{tag}"))
    .bind(ctx.admin_id)
    .fetch_one(&ctx.pool)
    .await
    .unwrap();

    let other_order_id =
        seed_order(&ctx.pool, patient_id, ctx.admin_id, &format!("other-{tag}")).await;
    let other_invoice_id = seed_patient_invoice(
        &ctx.pool,
        other_order_id,
        patient_id,
        ctx.admin_id,
        &format!("OTHER-{tag}"),
        100,
    )
    .await;

    let bearer = auth_header_for(manager_id, "patient_manager");
    let base =
        format!("/api/v1/orders/{order_id}/external-invoices/{external_invoice_id}/allocations");
    let (initial_status, initial) = request_json(&ctx.app, "GET", &base, &bearer, None).await;
    assert_eq!(initial_status, StatusCode::OK, "{initial}");
    assert_eq!(
        initial["remaining_receivable_gross"]
            .as_str()
            .unwrap()
            .parse::<Decimal>()
            .unwrap(),
        Decimal::new(100, 0)
    );
    assert!(
        initial["candidate_invoices"]
            .as_array()
            .unwrap()
            .iter()
            .any(|candidate| candidate["id"] == invoice_id.to_string())
    );

    let (cross_status, cross) = request_json(
        &ctx.app,
        "POST",
        &base,
        &bearer,
        Some(json!({
            "request_id": Uuid::new_v4(),
            "patient_invoice_id": other_invoice_id,
            "amount_gross": "10"
        })),
    )
    .await;
    assert_eq!(cross_status, StatusCode::UNPROCESSABLE_ENTITY, "{cross}");

    let first_request_id = Uuid::new_v4();
    let (first_status, first) = request_json(
        &ctx.app,
        "POST",
        &base,
        &bearer,
        Some(json!({
            "request_id": first_request_id,
            "patient_invoice_id": invoice_id,
            "amount_gross": "60"
        })),
    )
    .await;
    assert_eq!(first_status, StatusCode::CREATED, "{first}");
    let first_allocation_id = first["id"].as_str().unwrap();

    let (replay_status, replay) = request_json(
        &ctx.app,
        "POST",
        &base,
        &bearer,
        Some(json!({
            "request_id": first_request_id,
            "patient_invoice_id": invoice_id,
            "amount_gross": "60"
        })),
    )
    .await;
    assert_eq!(replay_status, StatusCode::OK, "{replay}");
    assert_eq!(replay["id"], first_allocation_id);
    assert_eq!(replay["idempotent_replay"], true);
    let (drift_status, drift) = request_json(
        &ctx.app,
        "POST",
        &base,
        &bearer,
        Some(json!({
            "request_id": first_request_id,
            "patient_invoice_id": invoice_id,
            "amount_gross": "61"
        })),
    )
    .await;
    assert_eq!(drift_status, StatusCode::CONFLICT, "{drift}");

    let (partial_status, partial) = request_json(&ctx.app, "GET", &base, &bearer, None).await;
    assert_eq!(partial_status, StatusCode::OK, "{partial}");
    assert_eq!(
        partial["allocated_receivable_gross"]
            .as_str()
            .unwrap()
            .parse::<Decimal>()
            .unwrap(),
        Decimal::new(60, 0)
    );
    assert_eq!(
        partial["remaining_receivable_gross"]
            .as_str()
            .unwrap()
            .parse::<Decimal>()
            .unwrap(),
        Decimal::new(40, 0)
    );

    let update_path =
        format!("/api/v1/orders/{order_id}/external-invoices/{external_invoice_id}/update");
    let (shrink_status, shrink) = request_json(
        &ctx.app,
        "POST",
        &update_path,
        &bearer,
        Some(json!({ "amount_net": 50, "amount_vat": 0, "amount_gross": 50 })),
    )
    .await;
    assert_eq!(shrink_status, StatusCode::CONFLICT, "{shrink}");

    let (second_status, second) = request_json(
        &ctx.app,
        "POST",
        &base,
        &bearer,
        Some(json!({
            "request_id": Uuid::new_v4(),
            "patient_invoice_id": invoice_id,
            "amount_gross": "40"
        })),
    )
    .await;
    assert_eq!(second_status, StatusCode::CREATED, "{second}");

    let (over_status, over) = request_json(
        &ctx.app,
        "POST",
        &base,
        &bearer,
        Some(json!({
            "request_id": Uuid::new_v4(),
            "patient_invoice_id": invoice_id,
            "amount_gross": "0.01"
        })),
    )
    .await;
    assert_eq!(over_status, StatusCode::CONFLICT, "{over}");

    let (all_status, all_orders) = request_json(
        &ctx.app,
        "GET",
        &format!("/api/v1/patients/{patient_id}/account-statement?currency=EUR"),
        &bearer,
        None,
    )
    .await;
    assert_eq!(all_status, StatusCode::OK, "{all_orders}");
    assert_eq!(all_orders["summary"]["total_due"], "250");
    let statement_path =
        format!("/api/v1/patients/{patient_id}/account-statement?currency=EUR&order_id={order_id}");
    let (statement_status, statement) =
        request_json(&ctx.app, "GET", &statement_path, &bearer, None).await;
    assert_eq!(statement_status, StatusCode::OK, "{statement}");
    assert_eq!(statement["summary"]["external_receivable"], "0");
    assert_eq!(statement["summary"]["total_due"], "150");
    assert_eq!(statement["summary"]["reconciliation_required"], false);
    assert_eq!(statement["summary"]["debit_total"], "250");
    assert_eq!(statement["summary"]["credit_total"], "100");
    assert_eq!(statement["summary"]["calculated_balance"], "150");
    assert_eq!(statement["summary"]["closing_balance"], "150");
    assert_eq!(statement["summary"]["balance_side"], "debit");
    assert_eq!(
        statement["movements"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|movement| movement["kind"] == "external_allocation")
            .count(),
        2
    );
    let external_item = statement["items"]
        .as_array()
        .unwrap()
        .iter()
        .find(|item| item["id"] == external_invoice_id.to_string())
        .unwrap();
    assert_eq!(external_item["allocated_receivable"], "100");
    assert_eq!(external_item["remaining_receivable"], "0");
    assert_eq!(
        external_item["payment_state"],
        "reconciled_to_patient_invoice"
    );

    let reverse_path = format!("{base}/{first_allocation_id}/reverse");
    let (reverse_status, reverse) = request_json(
        &ctx.app,
        "POST",
        &reverse_path,
        &bearer,
        Some(json!({ "note": "Wrong patient invoice mapping" })),
    )
    .await;
    assert_eq!(reverse_status, StatusCode::OK, "{reverse}");
    let (reopened_status, reopened) = request_json(&ctx.app, "GET", &base, &bearer, None).await;
    assert_eq!(reopened_status, StatusCode::OK, "{reopened}");
    assert_eq!(
        reopened["allocated_receivable_gross"]
            .as_str()
            .unwrap()
            .parse::<Decimal>()
            .unwrap(),
        Decimal::new(40, 0)
    );
    assert_eq!(
        reopened["remaining_receivable_gross"]
            .as_str()
            .unwrap()
            .parse::<Decimal>()
            .unwrap(),
        Decimal::new(60, 0)
    );

    let (reopened_statement_status, reopened_statement) =
        request_json(&ctx.app, "GET", &statement_path, &bearer, None).await;
    assert_eq!(
        reopened_statement_status,
        StatusCode::OK,
        "{reopened_statement}"
    );
    assert_eq!(reopened_statement["summary"]["calculated_balance"], "210");
    assert_eq!(
        reopened_statement["summary"]["reconciliation_required"],
        true
    );
    assert!(reopened_statement["summary"]["closing_balance"].is_null());
    assert!(
        reopened_statement["movements"]
            .as_array()
            .unwrap()
            .iter()
            .any(|movement| {
                movement["kind"] == "external_allocation_reversal"
                    && movement["direction"] == "debit"
                    && movement["debit"] == "60"
            })
    );

    let sales = auth_header_for(sales_id, "sales");
    let (forbidden_status, _) = request_json(&ctx.app, "GET", &base, &sales, None).await;
    assert_eq!(forbidden_status, StatusCode::FORBIDDEN);
}

fn money(value: &Value) -> Decimal {
    value.as_str().unwrap().parse::<Decimal>().unwrap()
}

/// A re-billed supplier cost that is not (or no longer) on a patient invoice
/// can be dropped from re-billing: GMED bears it, with a reason, audited and
/// reversible; it leaves the patient's debt everywhere (owner 2026-10-12).
#[tokio::test]
async fn unbilled_supplier_cost_can_be_absorbed_by_gmed_and_put_back() {
    let Some(ctx) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let tag = Uuid::new_v4().simple().to_string();
    let manager_id = seed_user(&ctx.pool, "patient_manager", &tag).await;
    let billing_id = seed_user(&ctx.pool, "billing", &tag).await;
    let patient_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO patients (
               patient_id, first_name, last_name, birth_date, gender, created_by
           ) VALUES ($1, 'Mia', 'Muster', '1990-01-01', 'diverse', $2)
           RETURNING id"#,
    )
    .bind(format!("WAIVE-PT-{tag}"))
    .bind(ctx.admin_id)
    .fetch_one(&ctx.pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO patient_assignments (patient_id, user_id, assigned_by) VALUES ($1, $2, $3)",
    )
    .bind(patient_id)
    .bind(manager_id)
    .bind(ctx.admin_id)
    .execute(&ctx.pool)
    .await
    .unwrap();
    let order_id = seed_order(&ctx.pool, patient_id, ctx.admin_id, &format!("w-{tag}")).await;
    let invoice_id = seed_patient_invoice(
        &ctx.pool,
        order_id,
        patient_id,
        ctx.admin_id,
        &format!("PAT-W-{tag}"),
        150,
    )
    .await;
    let external_invoice_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO external_invoices (
               order_id, patient_id, external_invoice_number,
               amount_net, amount_vat, amount_gross, currency,
               status, paid_by, service_delivered, created_by
           ) VALUES ($1, $2, $3, 100, 0, 100, 'EUR', 'paid', 'agency', true, $4)
           RETURNING id"#,
    )
    .bind(order_id)
    .bind(patient_id)
    .bind(format!("EXT-W-{tag}"))
    .bind(ctx.admin_id)
    .fetch_one(&ctx.pool)
    .await
    .unwrap();

    let manager = auth_header_for(manager_id, "patient_manager");
    let billing = auth_header_for(billing_id, "billing");
    let allocations =
        format!("/api/v1/orders/{order_id}/external-invoices/{external_invoice_id}/allocations");
    // 40 of the 100 stay re-billed (e.g. after a credit note reversed the
    // rest of the allocation, QA D-64); 60 are patient debt again.
    let (status, allocation) = request_json(
        &ctx.app,
        "POST",
        &allocations,
        &manager,
        Some(json!({
            "request_id": Uuid::new_v4(),
            "patient_invoice_id": invoice_id,
            "amount_gross": "40"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{allocation}");
    let statement_path =
        format!("/api/v1/patients/{patient_id}/account-statement?currency=EUR&order_id={order_id}");
    let (status, before) = request_json(&ctx.app, "GET", &statement_path, &billing, None).await;
    assert_eq!(status, StatusCode::OK, "{before}");
    assert_eq!(
        money(&before["summary"]["external_receivable"]),
        Decimal::new(60, 0)
    );

    let waivers = format!("/api/v1/external-invoices/{external_invoice_id}/rebilling-waivers");
    let (status, _) = request_json(
        &ctx.app,
        "POST",
        &waivers,
        &manager,
        Some(json!({ "request_id": Uuid::new_v4(), "reason": "Kulanz" })),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, missing_reason) = request_json(
        &ctx.app,
        "POST",
        &waivers,
        &billing,
        Some(json!({ "request_id": Uuid::new_v4(), "reason": " " })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{missing_reason}");
    assert_eq!(missing_reason["error"], "rebilling_waiver_reason_required");

    let request_id = Uuid::new_v4();
    let reason = "Kulanz: GMED trägt den Rest der Hotelrechnung";
    let (status, waiver) = request_json(
        &ctx.app,
        "POST",
        &waivers,
        &billing,
        Some(json!({ "request_id": request_id, "reason": reason })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{waiver}");
    assert_eq!(money(&waiver["amount_gross"]), Decimal::new(60, 0));
    assert_eq!(waiver["reason"], reason);
    let waiver_id = waiver["id"].as_str().unwrap().to_string();
    let (status, replay) = request_json(
        &ctx.app,
        "POST",
        &waivers,
        &billing,
        Some(json!({ "request_id": request_id, "reason": reason })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{replay}");
    assert_eq!(replay["id"], waiver_id);
    assert_eq!(replay["idempotent_replay"], true);
    let (status, nothing) = request_json(
        &ctx.app,
        "POST",
        &waivers,
        &billing,
        Some(json!({ "request_id": Uuid::new_v4(), "reason": reason })),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{nothing}");
    assert_eq!(nothing["error"], "rebilling_waiver_nothing_to_waive");

    // The cost is no patient debt any more: statement, re-billing list and
    // the manual allocation bound agree.
    let (status, after) = request_json(&ctx.app, "GET", &statement_path, &billing, None).await;
    assert_eq!(status, StatusCode::OK, "{after}");
    assert_eq!(
        money(&after["summary"]["external_receivable"]),
        Decimal::ZERO
    );
    assert_eq!(after["summary"]["reconciliation_required"], false);
    assert_eq!(money(&after["summary"]["total_due"]), Decimal::new(150, 0));
    assert_eq!(
        money(&after["summary"]["closing_balance"]),
        Decimal::new(150, 0)
    );
    let waived_movement = after["movements"]
        .as_array()
        .unwrap()
        .iter()
        .find(|movement| movement["kind"] == "external_rebilling_waived")
        .expect("waiver movement");
    assert_eq!(waived_movement["direction"], "credit");
    assert_eq!(money(&waived_movement["credit"]), Decimal::new(60, 0));
    assert_eq!(waived_movement["description"], reason);
    let external_item = after["items"]
        .as_array()
        .unwrap()
        .iter()
        .find(|item| item["id"] == external_invoice_id.to_string())
        .unwrap();
    assert_eq!(
        money(&external_item["waived_receivable"]),
        Decimal::new(60, 0)
    );
    assert_eq!(money(&external_item["remaining_receivable"]), Decimal::ZERO);
    assert_eq!(
        external_item["payment_state"],
        "reconciled_to_patient_invoice"
    );

    let (status, workspace) = request_json(
        &ctx.app,
        "GET",
        &format!("/api/v1/patients/{patient_id}/billing-workspace"),
        &billing,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{workspace}");
    let expense = workspace["expenses"]
        .as_array()
        .unwrap()
        .iter()
        .find(|expense| expense["id"] == external_invoice_id.to_string())
        .unwrap();
    assert_eq!(money(&expense["remaining_receivable_gross"]), Decimal::ZERO);
    assert_eq!(
        money(&expense["waived_receivable_gross"]),
        Decimal::new(60, 0)
    );
    assert_eq!(expense["billable"], false);
    assert_eq!(expense["rebilling_waivers"][0]["reason"], reason);

    let (status, over) = request_json(
        &ctx.app,
        "POST",
        &allocations,
        &manager,
        Some(json!({
            "request_id": Uuid::new_v4(),
            "patient_invoice_id": invoice_id,
            "amount_gross": "0.01"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{over}");

    let audited: i64 = sqlx::query_scalar(
        r#"SELECT COUNT(*) FROM audit_log
           WHERE action = 'waive_external_invoice_rebilling'
             AND entity_id = $1 AND context->>'reason' = $2"#,
    )
    .bind(external_invoice_id)
    .bind(reason)
    .fetch_one(&ctx.pool)
    .await
    .unwrap();
    assert_eq!(audited, 1);
    // Append-only: a waiver is reversed, never edited or deleted.
    let waiver_uuid = Uuid::parse_str(&waiver_id).unwrap();
    assert!(
        sqlx::query("DELETE FROM external_invoice_rebilling_waivers WHERE id = $1")
            .bind(waiver_uuid)
            .execute(&ctx.pool)
            .await
            .is_err()
    );
    assert!(
        sqlx::query("UPDATE external_invoice_rebilling_waivers SET amount_gross = 1 WHERE id = $1")
            .bind(waiver_uuid)
            .execute(&ctx.pool)
            .await
            .is_err()
    );

    // Reversed with a reason, the 60 are patient debt again.
    let reversal = format!("{waivers}/{waiver_id}/reversal");
    let (status, reversed) = request_json(
        &ctx.app,
        "POST",
        &reversal,
        &billing,
        Some(json!({ "reason": "Patient zahlt doch selbst" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{reversed}");
    assert!(reversed["reversed_at"].is_string(), "{reversed}");
    let (status, again) = request_json(
        &ctx.app,
        "POST",
        &reversal,
        &billing,
        Some(json!({ "reason": "Patient zahlt doch selbst" })),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{again}");
    assert_eq!(again["error"], "rebilling_waiver_already_reversed");
    let (status, reopened) = request_json(&ctx.app, "GET", &statement_path, &billing, None).await;
    assert_eq!(status, StatusCode::OK, "{reopened}");
    assert_eq!(
        money(&reopened["summary"]["external_receivable"]),
        Decimal::new(60, 0)
    );
    assert!(
        reopened["movements"]
            .as_array()
            .unwrap()
            .iter()
            .any(|movement| movement["kind"] == "external_rebilling_waived")
    );
    assert!(
        reopened["movements"]
            .as_array()
            .unwrap()
            .iter()
            .any(|movement| movement["kind"] == "external_rebilling_waiver_reversal")
    );
}

#[tokio::test]
async fn supplier_invoice_with_active_allocations_cannot_be_cancelled() {
    let Some(ctx) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let tag = Uuid::new_v4().simple().to_string();
    let manager_id = seed_user(&ctx.pool, "patient_manager", &tag).await;
    let patient_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO patients (
               patient_id, first_name, last_name, birth_date, gender, created_by
           ) VALUES ($1, 'Cancel', 'Allocation', '1990-01-01', 'diverse', $2)
           RETURNING id"#,
    )
    .bind(format!("CANCEL-PT-{tag}"))
    .bind(ctx.admin_id)
    .fetch_one(&ctx.pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO patient_assignments (patient_id, user_id, assigned_by) VALUES ($1, $2, $3)",
    )
    .bind(patient_id)
    .bind(manager_id)
    .bind(ctx.admin_id)
    .execute(&ctx.pool)
    .await
    .unwrap();
    let order_id = seed_order(&ctx.pool, patient_id, ctx.admin_id, &format!("c-{tag}")).await;
    let invoice_id = seed_patient_invoice(
        &ctx.pool,
        order_id,
        patient_id,
        ctx.admin_id,
        &format!("PAT-C-{tag}"),
        150,
    )
    .await;
    let external_invoice_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO external_invoices (
               order_id, patient_id, external_invoice_number,
               amount_net, amount_vat, amount_gross, currency,
               status, paid_by, service_delivered, created_by
           ) VALUES ($1, $2, $3, 100, 0, 100, 'EUR', 'received', 'unpaid', true, $4)
           RETURNING id"#,
    )
    .bind(order_id)
    .bind(patient_id)
    .bind(format!("EXT-C-{tag}"))
    .bind(ctx.admin_id)
    .fetch_one(&ctx.pool)
    .await
    .unwrap();

    let bearer = auth_header_for(manager_id, "patient_manager");
    let base =
        format!("/api/v1/orders/{order_id}/external-invoices/{external_invoice_id}/allocations");
    let (status, allocation) = request_json(
        &ctx.app,
        "POST",
        &base,
        &bearer,
        Some(json!({
            "request_id": Uuid::new_v4(),
            "patient_invoice_id": invoice_id,
            "amount_gross": "100"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{allocation}");
    let allocation_id = allocation["id"].as_str().unwrap().to_string();

    let update_path =
        format!("/api/v1/orders/{order_id}/external-invoices/{external_invoice_id}/update");
    let (status, refused) = request_json(
        &ctx.app,
        "POST",
        &update_path,
        &bearer,
        Some(json!({ "status": "cancelled" })),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{refused}");
    assert_eq!(
        refused["message"],
        "Reverse the patient-invoice allocations of this supplier invoice before cancelling it"
    );

    // The database refuses it as well, whatever the caller.
    let direct = sqlx::query("UPDATE external_invoices SET status = 'cancelled' WHERE id = $1")
        .bind(external_invoice_id)
        .execute(&ctx.pool)
        .await;
    assert!(direct.is_err());

    let (status, reversed) = request_json(
        &ctx.app,
        "POST",
        &format!("{base}/{allocation_id}/reverse"),
        &bearer,
        Some(json!({ "note": "Supplier invoice was issued in error" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{reversed}");
    let (status, cancelled) = request_json(
        &ctx.app,
        "POST",
        &update_path,
        &bearer,
        Some(json!({ "status": "cancelled" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{cancelled}");
    let audited: i64 = sqlx::query_scalar(
        r#"SELECT COUNT(*) FROM audit_log
           WHERE action = 'update_external_invoice'
             AND context->>'external_invoice_id' = $1
             AND context->>'new_status' = 'cancelled'"#,
    )
    .bind(external_invoice_id.to_string())
    .fetch_one(&ctx.pool)
    .await
    .unwrap();
    assert_eq!(audited, 1);
}
