mod support;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use serde_json::{Value, json};
use sqlx::PgPool;
use tower::ServiceExt;
use uuid::Uuid;

use gmed_server::auth::jwt;

const TEST_SECRET: &str = "test-secret-at-least-32-characters-long!!";

async fn test_context() -> Option<(axum::Router, PgPool, Uuid)> {
    let ctx = support::suite_context(TEST_SECRET).await?;
    Some((ctx.app, ctx.pool, ctx.admin_id))
}

fn unique_tag(prefix: &str) -> String {
    format!("{prefix}-{}", Uuid::new_v4().simple())
}

fn auth_header_for(user_id: Uuid, role: &str) -> String {
    let token = jwt::issue_access_token(TEST_SECRET, user_id, role, Uuid::new_v4()).unwrap();
    format!("Bearer {token}")
}

async fn get_json(app: &axum::Router, path: &str, bearer: &str) -> (StatusCode, Value) {
    let request = Request::builder()
        .method("GET")
        .uri(path)
        .header("Authorization", bearer)
        .body(Body::empty())
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
           ) VALUES ($1, 'Portal', 'Subscriber', '1990-01-01', 'diverse', $2)
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

async fn seed_package(pool: &PgPool, created_by: Uuid, tag: &str) -> (Uuid, Uuid) {
    let package_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO service_packages (
                package_key, name, description, currency, created_by
           ) VALUES ($1, 'Care subscription', 'Client-facing package description', 'EUR', $2)
           RETURNING id"#,
    )
    .bind(format!("PKG-{tag}"))
    .bind(created_by)
    .fetch_one(pool)
    .await
    .unwrap();
    let package_item_id = sqlx::query_scalar(
        r#"INSERT INTO service_package_items (
                package_id, service_key, description, included_quantity,
                unit_label, requires_patient_approval, sort_order
           ) VALUES ($1, 'transport', 'Patient transport', 5, 'trips', true, 1)
           RETURNING id"#,
    )
    .bind(package_id)
    .fetch_one(pool)
    .await
    .unwrap();
    (package_id, package_item_id)
}

#[allow(clippy::too_many_arguments)]
async fn seed_subscription(
    pool: &PgPool,
    patient_id: Uuid,
    order_id: Option<Uuid>,
    package_id: Uuid,
    status: &str,
    starts_on_offset_days: i32,
    ends_on_offset_days: i32,
    portal_visible: bool,
    assigned_by: Uuid,
) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO patient_service_packages (
                patient_id, order_id, package_id, status, starts_on, ends_on,
                portal_visible, assigned_by
           ) VALUES ($1, $2, $3, $4, CURRENT_DATE + $5::INTEGER,
                     CURRENT_DATE + $6::INTEGER, $7, $8)
           RETURNING id"#,
    )
    .bind(patient_id)
    .bind(order_id)
    .bind(package_id)
    .bind(status)
    .bind(starts_on_offset_days)
    .bind(ends_on_offset_days)
    .bind(portal_visible)
    .bind(assigned_by)
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
    status: &str,
    paid_amount: &str,
    portal_visible: bool,
    hide_amounts: bool,
) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO invoices (
                order_id, patient_id, invoice_number, invoice_type, status, due_date,
                total_net, total_vat, total_gross, paid_amount, line_items, notes,
                portal_visible, hide_amounts_from_patient, created_by
           ) VALUES (
                $1, $2, $3, 'final', $4, CURRENT_DATE + 14,
                100, 19, 119, $5::NUMERIC, '[]'::JSONB, 'Portal subscription test',
                $6, $7, $8
           ) RETURNING id"#,
    )
    .bind(order_id)
    .bind(patient_id)
    .bind(format!("INV-{tag}"))
    .bind(status)
    .bind(paid_amount)
    .bind(portal_visible)
    .bind(hide_amounts)
    .bind(created_by)
    .fetch_one(pool)
    .await
    .unwrap()
}

fn find_subscription(items: &[Value], subscription_id: Uuid) -> &Value {
    items
        .iter()
        .find(|item| item["id"] == subscription_id.to_string())
        .unwrap_or_else(|| panic!("subscription {subscription_id} missing from {items:?}"))
}

#[tokio::test]
async fn portal_subscriptions_are_self_scoped_visible_and_client_safe() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("portal-subscriptions");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let other_patient_id = seed_patient(&pool, admin_id, &format!("{tag}-other")).await;
    let patient_user_id = seed_user(&pool, &tag, "patient").await;
    let other_patient_user_id = seed_user(&pool, &format!("{tag}-other"), "patient").await;
    let manager_id = seed_user(&pool, &tag, "patient_manager").await;
    seed_assignment(&pool, patient_id, patient_user_id, admin_id).await;
    seed_assignment(&pool, other_patient_id, other_patient_user_id, admin_id).await;

    let (package_id, package_item_id) = seed_package(&pool, admin_id, &tag).await;

    let active_order = seed_order(&pool, patient_id, admin_id, &format!("{tag}-active")).await;
    let active_id = seed_subscription(
        &pool,
        patient_id,
        Some(active_order),
        package_id,
        "active",
        -10,
        20,
        true,
        admin_id,
    )
    .await;
    sqlx::query(
        r#"INSERT INTO service_package_consumptions (
                patient_service_package_id, package_item_id, quantity,
                overage_quantity, requires_patient_approval, approval_status, created_by
           ) VALUES
                ($1, $2, 2, 0, true, 'approved', $3),
                ($1, $2, 4, 1, true, 'declined', $3)"#,
    )
    .bind(active_id)
    .bind(package_item_id)
    .bind(admin_id)
    .execute(&pool)
    .await
    .unwrap();
    seed_invoice(
        &pool,
        active_order,
        patient_id,
        admin_id,
        &format!("{tag}-active"),
        "partially_paid",
        "20",
        true,
        false,
    )
    .await;
    seed_invoice(
        &pool,
        active_order,
        patient_id,
        admin_id,
        &format!("{tag}-staff-only"),
        "sent",
        "0",
        false,
        false,
    )
    .await;

    let shared_order = seed_order(&pool, patient_id, admin_id, &format!("{tag}-shared")).await;
    let shared_first_id = seed_subscription(
        &pool,
        patient_id,
        Some(shared_order),
        package_id,
        "active",
        -2,
        30,
        true,
        admin_id,
    )
    .await;
    let shared_second_id = seed_subscription(
        &pool,
        patient_id,
        Some(shared_order),
        package_id,
        "active",
        -2,
        30,
        true,
        admin_id,
    )
    .await;
    seed_invoice(
        &pool,
        shared_order,
        patient_id,
        admin_id,
        &format!("{tag}-shared"),
        "sent",
        "0",
        true,
        false,
    )
    .await;

    let upcoming_order = seed_order(&pool, patient_id, admin_id, &format!("{tag}-future")).await;
    let upcoming_id = seed_subscription(
        &pool,
        patient_id,
        Some(upcoming_order),
        package_id,
        "paused",
        10,
        40,
        true,
        admin_id,
    )
    .await;
    seed_invoice(
        &pool,
        upcoming_order,
        patient_id,
        admin_id,
        &format!("{tag}-future"),
        "sent",
        "0",
        true,
        true,
    )
    .await;

    let completed_id = seed_subscription(
        &pool,
        patient_id,
        None,
        package_id,
        "completed",
        -50,
        -1,
        true,
        admin_id,
    )
    .await;
    let hidden_id = seed_subscription(
        &pool, patient_id, None, package_id, "active", -1, 30, false, admin_id,
    )
    .await;
    let other_id = seed_subscription(
        &pool,
        other_patient_id,
        None,
        package_id,
        "active",
        -1,
        30,
        true,
        admin_id,
    )
    .await;

    let patient_bearer = auth_header_for(patient_user_id, "patient");
    let (status, body) = get_json(&app, "/api/v1/me/subscriptions", &patient_bearer).await;
    assert_eq!(status, StatusCode::OK, "patient response: {body:?}");
    let items = body["items"].as_array().unwrap();
    assert_eq!(body["total"], 5);
    assert!(!items.iter().any(|item| item["id"] == hidden_id.to_string()));
    assert!(!items.iter().any(|item| item["id"] == other_id.to_string()));

    let active = find_subscription(items, active_id);
    assert_eq!(active["lifecycle"], "active");
    assert_eq!(active["financial"]["scope"], "linked_order");
    assert_eq!(active["financial"]["status"], "partially_paid");
    assert_eq!(active["financial"]["visible_invoice_count"], 1);
    assert_eq!(active["financial"]["balance_disclosure"], "visible");
    assert_eq!(active["financial"]["amounts_visible"], true);
    assert_eq!(active["financial"]["balance_due"], "99");
    assert_eq!(active["services"][0]["included_quantity"], "5");
    assert_eq!(active["services"][0]["used_quantity"], "2");
    assert_eq!(active["services"][0]["remaining_quantity"], "3");
    assert_eq!(active["services"][0]["overage_quantity"], "0");

    for shared_id in [shared_first_id, shared_second_id] {
        let shared = find_subscription(items, shared_id);
        assert_eq!(shared["financial"]["linked_subscription_count"], 2);
        assert_eq!(shared["financial"]["balance_disclosure"], "shared_order");
        assert_eq!(shared["financial"]["amounts_visible"], false);
        assert!(shared["financial"]["balance_due"].is_null());
    }

    let upcoming = find_subscription(items, upcoming_id);
    assert_eq!(upcoming["status"], "paused");
    assert_eq!(upcoming["lifecycle"], "upcoming");
    assert_eq!(upcoming["financial"]["status"], "open");
    assert_eq!(
        upcoming["financial"]["balance_disclosure"],
        "hidden_by_invoice"
    );
    assert_eq!(upcoming["financial"]["amounts_visible"], false);
    assert!(upcoming["financial"]["balance_due"].is_null());

    let completed = find_subscription(items, completed_id);
    assert_eq!(completed["lifecycle"], "completed");
    assert_eq!(completed["financial"]["status"], "not_invoiced");

    let other_bearer = auth_header_for(other_patient_user_id, "patient");
    let (status, other_body) = get_json(&app, "/api/v1/me/subscriptions", &other_bearer).await;
    assert_eq!(
        status,
        StatusCode::OK,
        "other patient response: {other_body:?}"
    );
    let other_items = other_body["items"].as_array().unwrap();
    assert_eq!(other_items.len(), 1);
    assert_eq!(other_items[0]["id"], other_id.to_string());
    assert!(
        !other_items
            .iter()
            .any(|item| item["id"] == active_id.to_string())
    );

    let manager_bearer = auth_header_for(manager_id, "patient_manager");
    let (status, body) = get_json(&app, "/api/v1/me/subscriptions", &manager_bearer).await;
    assert_eq!(status, StatusCode::FORBIDDEN, "manager response: {body:?}");
}
