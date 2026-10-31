//! Who reaches what of an order, and what a closed order still takes (QA
//! 2026-10-31): service groups, the order tariff, the discard of an order
//! wizard draft and the orders list. Synthetic data only.

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

fn bearer(user_id: Uuid, role: &str) -> String {
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
    let body = match body {
        Some(value) => Body::from(serde_json::to_vec(&value).unwrap()),
        None => Body::empty(),
    };
    let request = Request::builder()
        .method(method)
        .uri(path)
        .header("Authorization", bearer)
        .header("Content-Type", "application/json")
        .body(body)
        .unwrap();
    let response = app.clone().oneshot(request).await.unwrap();
    let status = response.status();
    let bytes = axum::body::to_bytes(response.into_body(), 16 * 1024 * 1024)
        .await
        .unwrap();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(json!(null)),
    )
}

async fn seed_user(pool: &PgPool, role: &str) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO users (email, password_hash, name, role)
           VALUES ($1, 'test-hash', $2, $3)
           RETURNING id"#,
    )
    .bind(format!(
        "access-{role}-{}@example.test",
        Uuid::new_v4().simple()
    ))
    .bind(format!("Access {role}"))
    .bind(role)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn seed_patient(pool: &PgPool, created_by: Uuid) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO patients (patient_id, first_name, last_name, birth_date, gender, created_by)
           VALUES ($1, 'Anna', 'Muster', '1985-05-15', 'female', $2)
           RETURNING id"#,
    )
    .bind(format!("P-ACCESS-{}", Uuid::new_v4().simple()))
    .bind(created_by)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn seed_order(pool: &PgPool, patient_id: Uuid, created_by: Uuid) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO orders (order_number, patient_id, phase, status, needs_description, created_by)
           VALUES ($1, $2, 'execution', 'active', 'Synthetic needs', $3)
           RETURNING id"#,
    )
    .bind(format!("ORD-ACCESS-{}", Uuid::new_v4().simple()))
    .bind(patient_id)
    .bind(created_by)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn assign(pool: &PgPool, patient_id: Uuid, user_id: Uuid, assigned_by: Uuid) {
    sqlx::query(
        "INSERT INTO patient_assignments (patient_id, user_id, assigned_by) VALUES ($1, $2, $3)",
    )
    .bind(patient_id)
    .bind(user_id)
    .bind(assigned_by)
    .execute(pool)
    .await
    .unwrap();
}

async fn close_order(pool: &PgPool, order_id: Uuid, status: &str) {
    sqlx::query("UPDATE orders SET status = $2 WHERE id = $1")
        .bind(order_id)
        .bind(status)
        .execute(pool)
        .await
        .unwrap();
}

#[tokio::test]
async fn service_groups_refuse_closed_orders_and_follow_the_rules_of_a_service_line() {
    let Some(ctx) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let ceo = bearer(ctx.admin_id, "ceo");
    let patient_id = seed_patient(&ctx.pool, ctx.admin_id).await;
    let order_id = seed_order(&ctx.pool, patient_id, ctx.admin_id).await;
    let groups = format!("/api/v1/orders/{order_id}/service-groups");

    for invalid in [
        json!({ "group_title": "Board", "quantity": 0.0, "unit_price": 100.0 }),
        json!({ "group_title": "Board", "quantity": 1.0, "unit_price": -1.0 }),
        json!({ "group_title": "Board", "quantity": 1.0, "unit_price": 100.0, "vat_rate": 101.0 }),
    ] {
        let (status, body) = json_request(&ctx.app, "POST", &groups, &ceo, Some(invalid)).await;
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
    }

    let (status, created) = json_request(
        &ctx.app,
        "POST",
        &groups,
        &ceo,
        Some(json!({ "group_title": "Board", "quantity": 1.0, "unit_price": 100.005 })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{created}");
    let group_id = Uuid::parse_str(created["id"].as_str().unwrap()).unwrap();
    let unit_price: Decimal =
        sqlx::query_scalar("SELECT unit_price FROM order_service_groups WHERE id = $1")
            .bind(group_id)
            .fetch_one(&ctx.pool)
            .await
            .unwrap();
    assert_eq!(unit_price, Decimal::new(10001, 2));

    for closed in ["cancelled", "completed"] {
        close_order(&ctx.pool, order_id, closed).await;
        let (status, body) = json_request(
            &ctx.app,
            "POST",
            &format!("/api/v1/order-service-groups/{group_id}/generate-lines"),
            &ceo,
            Some(json!({})),
        )
        .await;
        assert_eq!(status, StatusCode::CONFLICT, "{body}");
        assert_eq!(body["error"], "order_closed_for_new_services");
        let (status, body) = json_request(
            &ctx.app,
            "POST",
            &groups,
            &ceo,
            Some(json!({ "group_title": "Late board" })),
        )
        .await;
        assert_eq!(status, StatusCode::CONFLICT, "{body}");
        assert_eq!(body["error"], "order_closed_for_new_services");
    }
}

#[tokio::test]
async fn generated_group_lines_update_the_stored_order_total() {
    let Some(ctx) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let ceo = bearer(ctx.admin_id, "ceo");
    let patient_id = seed_patient(&ctx.pool, ctx.admin_id).await;
    let order_id = seed_order(&ctx.pool, patient_id, ctx.admin_id).await;
    let provider_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO providers (name, provider_type, address_city, fachbereich, address_country)
           VALUES ($1, 'medical', 'Berlin', 'Cardiology', 'Germany')
           RETURNING id"#,
    )
    .bind(format!("Clinic {}", Uuid::new_v4().simple()))
    .fetch_one(&ctx.pool)
    .await
    .unwrap();
    let doctor_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO provider_doctors (provider_id, name, fachbereich)
           VALUES ($1, 'Dr. Muster', 'Cardiology')
           RETURNING id"#,
    )
    .bind(provider_id)
    .fetch_one(&ctx.pool)
    .await
    .unwrap();
    let group_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO order_service_groups (
                order_id, group_title, quantity, unit_price, vat_rate, currency, status, created_by
           ) VALUES ($1, 'Board', 1, 100, 19, 'EUR', 'ready', $2)
           RETURNING id"#,
    )
    .bind(order_id)
    .bind(ctx.admin_id)
    .fetch_one(&ctx.pool)
    .await
    .unwrap();
    sqlx::query(
        r#"INSERT INTO order_service_group_participants (service_group_id, provider_id, doctor_id)
           VALUES ($1, $2, $3)"#,
    )
    .bind(group_id)
    .bind(provider_id)
    .bind(doctor_id)
    .execute(&ctx.pool)
    .await
    .unwrap();

    let (status, body) = json_request(
        &ctx.app,
        "POST",
        &format!("/api/v1/order-service-groups/{group_id}/generate-lines"),
        &ceo,
        Some(json!({})),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["generated_count"], 1);
    let stored: Option<Decimal> =
        sqlx::query_scalar("SELECT total_estimated FROM orders WHERE id = $1")
            .bind(order_id)
            .fetch_one(&ctx.pool)
            .await
            .unwrap();
    assert_eq!(stored, Some(Decimal::new(119, 0)));
}

#[tokio::test]
async fn every_full_order_reader_reads_service_groups_and_writes_stay_with_the_owner() {
    let Some(ctx) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let ceo = bearer(ctx.admin_id, "ceo");
    let patient_id = seed_patient(&ctx.pool, ctx.admin_id).await;
    let order_id = seed_order(&ctx.pool, patient_id, ctx.admin_id).await;
    let groups = format!("/api/v1/orders/{order_id}/service-groups");
    let (status, created) = json_request(
        &ctx.app,
        "POST",
        &groups,
        &ceo,
        Some(json!({ "group_title": "Board", "quantity": 1.0, "unit_price": 100.0 })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{created}");
    let group_id = created["id"].as_str().unwrap();

    for role in ["billing", "ceo_assistant"] {
        let reader = bearer(seed_user(&ctx.pool, role).await, role);
        for path in [
            groups.clone(),
            format!("/api/v1/order-service-groups/{group_id}"),
            format!("/api/v1/order-service-groups/{group_id}/line-preview"),
        ] {
            let (status, body) = json_request(&ctx.app, "GET", &path, &reader, None).await;
            assert_eq!(status, StatusCode::OK, "{role} {path}: {body}");
        }
        let (status, body) = json_request(
            &ctx.app,
            "POST",
            &groups,
            &reader,
            Some(json!({ "group_title": "Not theirs" })),
        )
        .await;
        assert_eq!(status, StatusCode::FORBIDDEN, "{role}: {body}");
    }

    // The concierge's part of the order has no commercial side, even when
    // assigned; an unassigned manager reaches nothing.
    let concierge_id = seed_user(&ctx.pool, "concierge").await;
    assign(&ctx.pool, patient_id, concierge_id, ctx.admin_id).await;
    let (status, body) = json_request(
        &ctx.app,
        "GET",
        &groups,
        &bearer(concierge_id, "concierge"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN, "{body}");
    let manager = bearer(
        seed_user(&ctx.pool, "patient_manager").await,
        "patient_manager",
    );
    let (status, body) = json_request(&ctx.app, "GET", &groups, &manager, None).await;
    assert_eq!(status, StatusCode::FORBIDDEN, "{body}");
}

#[tokio::test]
async fn the_order_tariff_is_commercial_and_stays_as_it_is_on_a_closed_order() {
    let Some(ctx) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let ceo = bearer(ctx.admin_id, "ceo");
    let patient_id = seed_patient(&ctx.pool, ctx.admin_id).await;
    let order_id = seed_order(&ctx.pool, patient_id, ctx.admin_id).await;
    let path = format!("/api/v1/orders/{order_id}/subscription");

    let concierge_id = seed_user(&ctx.pool, "concierge").await;
    assign(&ctx.pool, patient_id, concierge_id, ctx.admin_id).await;
    let (status, body) = json_request(
        &ctx.app,
        "GET",
        &path,
        &bearer(concierge_id, "concierge"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN, "{body}");

    let (status, open) = json_request(&ctx.app, "GET", &path, &ceo, None).await;
    assert_eq!(status, StatusCode::OK, "{open}");
    assert_eq!(open["can_edit"], true);

    close_order(&ctx.pool, order_id, "cancelled").await;
    let (status, closed) = json_request(&ctx.app, "GET", &path, &ceo, None).await;
    assert_eq!(status, StatusCode::OK, "{closed}");
    assert_eq!(closed["can_edit"], false);
    let (status, body) = json_request(
        &ctx.app,
        "POST",
        &path,
        &ceo,
        Some(json!({ "package_id": null })),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{body}");
    assert_eq!(body["error"], "order_closed_for_new_services");
}

#[tokio::test]
async fn an_order_wizard_draft_is_discarded_by_who_may_prepare_it() {
    let Some(ctx) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let ceo = bearer(ctx.admin_id, "ceo");
    let patient_id = seed_patient(&ctx.pool, ctx.admin_id).await;
    let (status, workspace) = json_request(
        &ctx.app,
        "POST",
        &format!("/api/v1/patients/{patient_id}/order-intakes"),
        &ceo,
        Some(json!({ "request_id": Uuid::new_v4() })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{workspace}");
    let order_id = workspace["order_id"].as_str().unwrap();
    let path = format!("/api/v1/orders/{order_id}/status");
    let discard = json!({ "status": "cancelled", "note": "draft_discarded" });

    let stranger = bearer(
        seed_user(&ctx.pool, "patient_manager").await,
        "patient_manager",
    );
    let (status, body) =
        json_request(&ctx.app, "POST", &path, &stranger, Some(discard.clone())).await;
    assert_eq!(status, StatusCode::FORBIDDEN, "{body}");
    // Only the discard opens the status route for a draft.
    let (status, body) = json_request(
        &ctx.app,
        "POST",
        &path,
        &ceo,
        Some(json!({ "status": "paused" })),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN, "{body}");

    let (status, body) = json_request(&ctx.app, "POST", &path, &ceo, Some(discard)).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let status_after: String = sqlx::query_scalar("SELECT status FROM orders WHERE id = $1::uuid")
        .bind(order_id)
        .fetch_one(&ctx.pool)
        .await
        .unwrap();
    assert_eq!(status_after, "cancelled");

    // A discarded draft cannot be finished afterwards.
    let (status, body) = json_request(
        &ctx.app,
        "POST",
        &format!("/api/v1/orders/{order_id}/intake"),
        &ceo,
        Some(json!({
            "revision": workspace["revision"],
            "data": workspace["data"],
            "action": "save",
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{body}");
}

#[tokio::test]
async fn the_orders_list_counts_only_orders_the_reader_reaches() {
    let Some(ctx) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let manager_id = seed_user(&ctx.pool, "patient_manager").await;
    let own_patient = seed_patient(&ctx.pool, ctx.admin_id).await;
    assign(&ctx.pool, own_patient, manager_id, ctx.admin_id).await;
    let own_order = seed_order(&ctx.pool, own_patient, ctx.admin_id).await;
    sqlx::query("UPDATE orders SET created_at = now() - interval '30 days' WHERE id = $1")
        .bind(own_order)
        .execute(&ctx.pool)
        .await
        .unwrap();
    // 200 newer orders of someone else's patient used to fill the page.
    let other_patient = seed_patient(&ctx.pool, ctx.admin_id).await;
    sqlx::query(
        r#"INSERT INTO orders (order_number, patient_id, phase, status, created_by)
           SELECT 'ORD-LIST-' || gen_random_uuid()::text, $1, 'execution', 'active', $2
           FROM generate_series(1, 200)"#,
    )
    .bind(other_patient)
    .bind(ctx.admin_id)
    .execute(&ctx.pool)
    .await
    .unwrap();

    let (status, orders) = json_request(
        &ctx.app,
        "GET",
        "/api/v1/orders",
        &bearer(manager_id, "patient_manager"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{orders}");
    let ids = orders
        .as_array()
        .unwrap()
        .iter()
        .map(|order| order["id"].as_str().unwrap().to_string())
        .collect::<Vec<_>>();
    assert_eq!(ids, vec![own_order.to_string()]);
}
