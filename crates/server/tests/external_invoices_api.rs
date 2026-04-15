mod support;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use serde_json::{Value, json};
use sqlx::{PgPool, Row};
use tower::ServiceExt;
use uuid::Uuid;

use gmed_server::auth::jwt;
use gmed_server::settings::{SettingsCache, TokenSettings};
use gmed_server::state::AppState;

const TEST_SECRET: &str = "test-secret-at-least-32-characters-long!!";

async fn test_context() -> Option<(axum::Router, PgPool, Uuid)> {
    let ctx = support::suite_context(TEST_SECRET).await?;
    Some((ctx.app, ctx.pool, ctx.admin_id))
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
        .body(match body {
            Some(value) => Body::from(serde_json::to_vec(&value).unwrap()),
            None => Body::empty(),
        })
        .unwrap();

    let response = app.clone().oneshot(request).await.unwrap();
    let status = response.status();
    let bytes = axum::body::to_bytes(response.into_body(), 4 * 1024 * 1024)
        .await
        .unwrap();
    let payload = serde_json::from_slice(&bytes).unwrap_or(json!(null));
    (status, payload)
}

fn auth_header_for(user_id: Uuid, role: &str) -> String {
    let token = jwt::issue_access_token(TEST_SECRET, user_id, role, Uuid::new_v4()).unwrap();
    format!("Bearer {token}")
}

fn unique_tag(prefix: &str) -> String {
    format!("{prefix}-{}", Uuid::new_v4().simple())
}

async fn seed_user(pool: &PgPool, tag: &str, role: &str) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO users (email, password_hash, name, role)
           VALUES ($1, $2, $3, $4)
           RETURNING id"#,
    )
    .bind(format!("{tag}-{role}@example.com"))
    .bind("test-password-hash")
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
           ) VALUES (
                $1, $2, $3, '1990-01-01', 'diverse', $4
           ) RETURNING id"#,
    )
    .bind(format!("PT-{tag}"))
    .bind(format!("First {tag}"))
    .bind(format!("Last {tag}"))
    .bind(created_by)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn seed_patient_assignment(
    pool: &PgPool,
    patient_id: Uuid,
    assigned_user_id: Uuid,
    assigned_by: Uuid,
) {
    sqlx::query(
        r#"INSERT INTO patient_assignments (patient_id, user_id, assigned_by)
           VALUES ($1, $2, $3)
           ON CONFLICT (patient_id, user_id)
           DO UPDATE SET revoked_at = NULL, assigned_by = $3, assigned_at = now()"#,
    )
    .bind(patient_id)
    .bind(assigned_user_id)
    .bind(assigned_by)
    .execute(pool)
    .await
    .unwrap();
}

async fn seed_provider(pool: &PgPool, tag: &str) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO providers (name, provider_type, address_city, fachbereich, address_country)
           VALUES ($1, 'medical', $2, 'Cardiology', 'Germany')
           RETURNING id"#,
    )
    .bind(format!("Clinic {tag}"))
    .bind(format!("City {tag}"))
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn seed_order(pool: &PgPool, patient_id: Uuid, created_by: Uuid, tag: &str) -> Uuid {
    let order_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO orders (
                order_number, patient_id, phase, status, needs_description, created_by
           ) VALUES (
                $1, $2, 'execution', 'active', 'External invoice order', $3
           ) RETURNING id"#,
    )
    .bind(format!("O-{tag}"))
    .bind(patient_id)
    .bind(created_by)
    .fetch_one(pool)
    .await
    .unwrap();

    sqlx::query(
        r#"UPDATE orders
           SET billing_release_status = 'granted',
               billing_release_note = 'test gate',
               billing_released_by = $2,
               billing_released_at = now(),
               package_coverage_status = 'not_covered',
               package_coverage_note = 'test package gate',
               package_coverage_decided_by = $2,
               package_coverage_decided_at = now()
           WHERE id = $1"#,
    )
    .bind(order_id)
    .bind(created_by)
    .execute(pool)
    .await
    .unwrap();

    order_id
}

#[tokio::test]
async fn external_invoices_round_trip_through_order_detail_and_status_update() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("external-invoice-order");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let provider_id = seed_provider(&pool, &tag).await;
    let pm_id = seed_user(&pool, &tag, "patient_manager").await;
    let billing_id = seed_user(&pool, &format!("{tag}-billing"), "billing").await;
    seed_patient_assignment(&pool, patient_id, pm_id, admin_id).await;

    let order_id = seed_order(&pool, patient_id, admin_id, &tag).await;

    let pm_bearer = auth_header_for(pm_id, "patient_manager");
    let billing_bearer = auth_header_for(billing_id, "billing");

    let (status, created_body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/orders/{order_id}/external-invoices"),
        &pm_bearer,
        Some(json!({
            "provider_id": provider_id,
            "external_invoice_number": format!("EXT-{tag}"),
            "invoice_date": "2026-04-10",
            "due_date": "2026-04-20",
            "amount_net": 100.0,
            "amount_vat": 19.0,
            "amount_gross": 119.0,
            "status": "received",
            "notes": "Inbound clinic invoice"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let external_invoice_id =
        Uuid::parse_str(created_body["id"].as_str().expect("external invoice id")).unwrap();

    let (status, order_detail) = json_request(
        &app,
        "GET",
        &format!("/api/v1/orders/{order_id}"),
        &billing_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let items = order_detail["external_invoices"]
        .as_array()
        .expect("external invoice array");
    assert_eq!(items.len(), 1);
    assert_eq!(items[0]["id"], external_invoice_id.to_string());
    assert_eq!(items[0]["provider_id"], provider_id.to_string());
    assert_eq!(items[0]["status"], "received");
    assert_eq!(items[0]["amount_gross"].as_str(), Some("119"));

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/orders/{order_id}/external-invoices/{external_invoice_id}/update"),
        &billing_bearer,
        Some(json!({ "status": "paid" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["ok"], true);

    let row = sqlx::query(
        r#"SELECT status, paid_at
           FROM external_invoices
           WHERE id = $1"#,
    )
    .bind(external_invoice_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(row.try_get::<String, _>("status").unwrap(), "paid");
    assert!(
        row.try_get::<Option<chrono::DateTime<chrono::Utc>>, _>("paid_at")
            .unwrap()
            .is_some()
    );
}

#[tokio::test]
async fn external_invoice_deadline_scheduler_marks_overdue_and_notifies_billing() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("external-invoice-scheduler");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let provider_id = seed_provider(&pool, &tag).await;
    let pm_id = seed_user(&pool, &tag, "patient_manager").await;
    let billing_id = seed_user(&pool, &format!("{tag}-billing"), "billing").await;
    seed_patient_assignment(&pool, patient_id, pm_id, admin_id).await;

    let order_id = seed_order(&pool, patient_id, admin_id, &tag).await;

    let pm_bearer = auth_header_for(pm_id, "patient_manager");
    let due_date = (chrono::Utc::now().date_naive() - chrono::Duration::days(3)).to_string();

    let (status, created_body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/orders/{order_id}/external-invoices"),
        &pm_bearer,
        Some(json!({
            "provider_id": provider_id,
            "external_invoice_number": format!("EXT-DUE-{tag}"),
            "due_date": due_date,
            "amount_gross": 480.0,
            "status": "approved"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let external_invoice_id =
        Uuid::parse_str(created_body["id"].as_str().expect("external invoice id")).unwrap();

    let state = AppState::new(
        pool.clone(),
        TEST_SECRET,
        SettingsCache::new(TokenSettings::default()),
    );
    let first_summary =
        gmed_server::routes::orders::run_external_invoice_deadline_scheduler_once(&state)
            .await
            .expect("first external invoice run");
    assert_eq!(first_summary.overdue_marked, 1);
    assert!(first_summary.notifications_created >= 1);

    let second_summary =
        gmed_server::routes::orders::run_external_invoice_deadline_scheduler_once(&state)
            .await
            .expect("second external invoice run");
    assert_eq!(second_summary.overdue_marked, 0);
    assert_eq!(second_summary.notifications_created, 0);

    let row = sqlx::query(
        r#"SELECT status
           FROM external_invoices
           WHERE id = $1"#,
    )
    .bind(external_invoice_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(row.try_get::<String, _>("status").unwrap(), "overdue");

    let notifications: i64 = sqlx::query_scalar(
        r#"SELECT count(*)
           FROM user_notifications
           WHERE user_id = $1
             AND kind = 'external_invoice_overdue'
             AND entity_type = 'order'
             AND entity_id = $2"#,
    )
    .bind(billing_id)
    .bind(order_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(notifications, 1);
}
