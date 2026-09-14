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

#[tokio::test]
async fn patient_import_without_order_is_listed_approved_and_paid_through_the_journal() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };
    let tag = unique_tag("unassigned-invoice");
    let patient = seed_patient(&pool, admin_id, &tag).await;
    let other_patient = seed_patient(&pool, admin_id, &unique_tag("other")).await;
    let billing_id = seed_user(&pool, &tag, "billing").await;
    let manager_id = seed_user(&pool, &tag, "patient_manager").await;
    let billing = auth_header_for(billing_id, "billing");
    let manager = auth_header_for(manager_id, "patient_manager");
    let document_id = Uuid::new_v4();
    sqlx::query("INSERT INTO documents (id, version_root_document_id, auto_name, art, category, uploaded_by, patient_id) VALUES ($1, $1, $2, 'invoice_document', 'finance', $3, $4)")
        .bind(document_id).bind(format!("Invoice {tag}" )).bind(admin_id).bind(patient).execute(&pool).await.unwrap();
    let payload = json!({ "patient_id": patient, "source_document_id": document_id, "supplier_name": "Synthetic Clinic", "external_invoice_number": tag, "amount_net": 100, "amount_vat": 19, "amount_gross": 119, "currency": "EUR" });
    let path = format!("/api/v1/patients/{patient}/external-invoices");
    let (status, _) = json_request(&app, "POST", &path, &manager, Some(payload.clone())).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let mut foreign_payload = payload.clone();
    foreign_payload["patient_id"] = json!(other_patient);
    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/patients/{other_patient}/external-invoices"),
        &billing,
        Some(foreign_payload),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    let (status, created) =
        json_request(&app, "POST", &path, &billing, Some(payload.clone())).await;
    assert_eq!(status, StatusCode::CREATED, "{created}");
    let id = created["id"].as_str().unwrap();
    let invoice_id = Uuid::parse_str(id).unwrap();
    let (status, _) = json_request(&app, "POST", &path, &billing, Some(payload)).await;
    assert_eq!(status, StatusCode::CONFLICT);

    let list_path =
        format!("/api/v1/external-invoices?patient_id={patient}&search={tag}&per_page=1");
    let (status, list) = json_request(&app, "GET", &list_path, &billing, None).await;
    assert_eq!(status, StatusCode::OK, "{list}");
    assert_eq!(list["total"], 1);
    let item = &list["items"][0];
    assert_eq!(item["id"], id);
    assert_eq!(item["source_document_id"], document_id.to_string());
    assert_eq!(item["patient_id"], patient.to_string());
    assert!(item["order_id"].is_null());
    assert_eq!(item["status"], "received");
    assert_eq!(item["provider_name"], "Synthetic Clinic");
    let (status, list) = json_request(&app, "GET", &list_path, &manager, None).await;
    assert_eq!(status, StatusCode::OK, "{list}");
    assert_eq!(list["total"], 0);
    seed_patient_assignment(&pool, patient, manager_id, admin_id).await;
    let (_, list) = json_request(&app, "GET", &list_path, &manager, None).await;
    assert_eq!(list["total"], 1);

    let account_id: Uuid = sqlx::query_scalar(
        "SELECT id FROM company_financial_accounts WHERE currency = 'EUR' AND is_default",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    let settlement_path = format!("/api/v1/company-provider-liabilities/{id}/settlements");
    let payment = |amount: &str| json!({ "request_id": Uuid::new_v4(), "financial_account_id": account_id, "amount_gross": amount, "paid_on": chrono::Utc::now().date_naive().to_string(), "payment_method": "bank_transfer" });
    let (status, _) = json_request(
        &app,
        "POST",
        &settlement_path,
        &billing,
        Some(payment("40")),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    let approve_path = format!("/api/v1/external-invoices/{id}/approve");
    let (status, _) = json_request(&app, "POST", &approve_path, &manager, Some(json!({}))).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, approved) =
        json_request(&app, "POST", &approve_path, &billing, Some(json!({}))).await;
    assert_eq!(status, StatusCode::OK, "{approved}");
    let (status, _) = json_request(&app, "POST", &approve_path, &billing, Some(json!({}))).await;
    assert_eq!(status, StatusCode::OK);
    let count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM accounting_entries WHERE source_external_invoice_id = $1",
    )
    .bind(invoice_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(count, 0, "Approval must not create a cash movement");

    let first_payment = payment("40");
    let (status, first) = json_request(
        &app,
        "POST",
        &settlement_path,
        &billing,
        Some(first_payment.clone()),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{first}");
    let (status, replay) = json_request(
        &app,
        "POST",
        &settlement_path,
        &billing,
        Some(first_payment),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{replay}");
    assert_eq!(replay["idempotent_replay"], true);
    let (_, summary) = json_request(&app, "GET", &settlement_path, &billing, None).await;
    assert_eq!(
        summary["remaining_provider_liability_gross"]
            .as_str()
            .unwrap()
            .parse::<f64>()
            .unwrap(),
        79.0
    );
    assert_eq!(summary["settlement_status"], "partial");
    let (status, paid) = json_request(
        &app,
        "POST",
        &settlement_path,
        &billing,
        Some(payment("79")),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{paid}");
    let (_, list) = json_request(&app, "GET", &list_path, &billing, None).await;
    assert_eq!(list["items"][0]["status"], "paid");
    assert_eq!(list["items"][0]["settlement_status"], "paid");
    let cash: String = sqlx::query_scalar("SELECT SUM(amount_gross)::text FROM accounting_entries WHERE source_external_invoice_id = $1 AND direction = 'expense'").bind(invoice_id).fetch_one(&pool).await.unwrap();
    assert_eq!(cash.parse::<f64>().unwrap(), 119.0);
    let contextual: bool = sqlx::query_scalar("SELECT BOOL_AND(patient_id = $2 AND order_id IS NULL) FROM accounting_entries WHERE source_external_invoice_id = $1").bind(invoice_id).bind(patient).fetch_one(&pool).await.unwrap();
    assert!(contextual);
    let (status, position) = json_request(
        &app,
        "GET",
        "/api/v1/company-financial-position?currency=EUR",
        &billing,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{position}");
    let liability = position["provider_liabilities"]
        .as_array()
        .unwrap()
        .iter()
        .find(|row| row["id"] == id)
        .unwrap();
    assert_eq!(
        liability["remaining_gross"]
            .as_str()
            .unwrap()
            .parse::<f64>()
            .unwrap(),
        0.0
    );
}

#[tokio::test]
async fn patient_paid_state_is_auditable_idempotent_and_creates_no_company_cash_movement() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };
    let tag = unique_tag("patient-paid-journal");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let provider_id = seed_provider(&pool, &tag).await;
    let order_id = seed_order(&pool, patient_id, admin_id, &tag).await;
    let bearer = auth_header_for(admin_id, "ceo");
    let (status, created) = json_request(
        &app,
        "POST",
        &format!("/api/v1/orders/{order_id}/external-invoices"),
        &bearer,
        Some(json!({
            "provider_id": provider_id,
            "external_invoice_number": format!("PAT-{tag}"),
            "amount_net": 100,
            "amount_vat": 19,
            "amount_gross": 119,
            "currency": "EUR",
            "status": "received"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{created}");
    let external_id = Uuid::parse_str(created["id"].as_str().unwrap()).unwrap();
    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/external-invoices/{external_id}/approve"),
        &bearer,
        Some(json!({})),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let request_id = Uuid::new_v4();
    let payment_payload = json!({
        "request_id": request_id,
        "paid": true,
        "paid_on": chrono::Utc::now().date_naive().to_string()
    });
    let payment_path = format!("/api/v1/external-invoices/{external_id}/patient-payment");
    let (status, paid) = json_request(
        &app,
        "POST",
        &payment_path,
        &bearer,
        Some(payment_payload.clone()),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{paid}");
    assert_eq!(paid["paid_by"], "patient");
    let (status, replay) =
        json_request(&app, "POST", &payment_path, &bearer, Some(payment_payload)).await;
    assert_eq!(status, StatusCode::OK, "{replay}");

    let row = sqlx::query("SELECT status, paid_by FROM external_invoices WHERE id = $1")
        .bind(external_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(row.try_get::<String, _>("status").unwrap(), "paid");
    assert_eq!(row.try_get::<String, _>("paid_by").unwrap(), "patient");
    let event_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM external_invoice_patient_payment_events WHERE external_invoice_id = $1",
    )
    .bind(external_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(event_count, 1);
    let cash_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM accounting_entries WHERE source_external_invoice_id = $1",
    )
    .bind(external_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(cash_count, 0);

    let (status, reopened) = json_request(
        &app,
        "POST",
        &payment_path,
        &bearer,
        Some(json!({
            "request_id": Uuid::new_v4(),
            "paid": false,
            "paid_on": chrono::Utc::now().date_naive().to_string()
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{reopened}");
    assert_eq!(reopened["paid_by"], "unpaid");
}

#[tokio::test]
async fn patient_billing_constructor_uses_closed_anchor_and_reserves_late_invoice_once() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };
    let tag = unique_tag("patient-billing-constructor");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let provider_id = seed_provider(&pool, &tag).await;
    let source_order = seed_order(&pool, patient_id, admin_id, &format!("{tag}-source")).await;
    let anchor_order = seed_order(&pool, patient_id, admin_id, &format!("{tag}-anchor")).await;
    sqlx::query("UPDATE orders SET status = 'completed', phase = 'closure' WHERE id = $1")
        .bind(anchor_order)
        .execute(&pool)
        .await
        .unwrap();
    let bearer = auth_header_for(admin_id, "ceo");
    let (status, created) = json_request(
        &app,
        "POST",
        &format!("/api/v1/orders/{source_order}/external-invoices"),
        &bearer,
        Some(json!({
            "provider_id": provider_id,
            "external_invoice_number": format!("LATE-{tag}"),
            "amount_net": 250,
            "amount_vat": 0,
            "amount_gross": 250,
            "currency": "EUR",
            "status": "approved"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{created}");
    let external_id = Uuid::parse_str(created["id"].as_str().unwrap()).unwrap();
    let account_id: Uuid = sqlx::query_scalar(
        "SELECT id FROM company_financial_accounts WHERE currency = 'EUR' AND is_default",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    let (status, payment) = json_request(
        &app,
        "POST",
        &format!("/api/v1/company-provider-liabilities/{external_id}/settlements"),
        &bearer,
        Some(json!({
            "request_id": Uuid::new_v4(),
            "financial_account_id": account_id,
            "amount_gross": "250",
            "paid_on": chrono::Utc::now().date_naive().to_string(),
            "payment_method": "bank_transfer"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{payment}");

    let workspace_path = format!("/api/v1/patients/{patient_id}/billing-workspace");
    let (status, workspace) = json_request(&app, "GET", &workspace_path, &bearer, None).await;
    assert_eq!(status, StatusCode::OK, "{workspace}");
    assert!(
        workspace["orders"]
            .as_array()
            .unwrap()
            .iter()
            .any(|row| { row["id"] == anchor_order.to_string() && row["status"] == "completed" })
    );
    let expense = workspace["expenses"]
        .as_array()
        .unwrap()
        .iter()
        .find(|row| row["id"] == external_id.to_string())
        .unwrap();
    assert_eq!(expense["billable"], true);

    let request_id = Uuid::new_v4();
    let payload = json!({
        "request_id": request_id,
        "order_id": anchor_order,
        "invoice_type": "interim",
        "external_invoice_ids": [external_id]
    });
    let create_path = format!("/api/v1/patients/{patient_id}/billing-invoices");
    let (status, invoice) =
        json_request(&app, "POST", &create_path, &bearer, Some(payload.clone())).await;
    assert_eq!(status, StatusCode::CREATED, "{invoice}");
    let invoice_id = Uuid::parse_str(invoice["id"].as_str().unwrap()).unwrap();
    assert_eq!(invoice["status"], "draft");
    assert_eq!(invoice["order_id"], anchor_order.to_string());
    assert_eq!(
        invoice["line_items"][0]["source_external_invoice_id"],
        external_id.to_string()
    );
    assert_eq!(invoice["line_items"][0]["is_cost_passthrough"], true);

    let (status, replay) = json_request(&app, "POST", &create_path, &bearer, Some(payload)).await;
    assert_eq!(status, StatusCode::OK, "{replay}");
    assert_eq!(replay["id"], invoice_id.to_string());
    let (status, duplicate) = json_request(
        &app,
        "POST",
        &create_path,
        &bearer,
        Some(json!({
            "request_id": Uuid::new_v4(),
            "order_id": anchor_order,
            "external_invoice_ids": [external_id]
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{duplicate}");

    let (_, workspace) = json_request(&app, "GET", &workspace_path, &bearer, None).await;
    let reserved = workspace["expenses"]
        .as_array()
        .unwrap()
        .iter()
        .find(|row| row["id"] == external_id.to_string())
        .unwrap();
    assert_eq!(reserved["billable"], false);
    assert_eq!(
        reserved["latest_patient_invoice_id"],
        invoice_id.to_string()
    );

    sqlx::query("UPDATE invoices SET status = 'cancelled' WHERE id = $1")
        .bind(invoice_id)
        .execute(&pool)
        .await
        .unwrap();
    let (_, workspace) = json_request(&app, "GET", &workspace_path, &bearer, None).await;
    let released = workspace["expenses"]
        .as_array()
        .unwrap()
        .iter()
        .find(|row| row["id"] == external_id.to_string())
        .unwrap();
    assert_eq!(released["billable"], true);

    let (status, invoice_without_order) = json_request(
        &app,
        "POST",
        &create_path,
        &bearer,
        Some(json!({
            "request_id": Uuid::new_v4(),
            "order_id": null,
            "currency": "EUR",
            "invoice_type": "interim",
            "external_invoice_ids": [external_id]
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{invoice_without_order}");
    assert_eq!(invoice_without_order["order_id"], Value::Null);
    assert_eq!(invoice_without_order["order_number"], Value::Null);
    assert_eq!(invoice_without_order["currency"], "EUR");
    let invoice_without_order_id =
        Uuid::parse_str(invoice_without_order["id"].as_str().unwrap()).unwrap();

    let (status, invoice_list) = json_request(
        &app,
        "GET",
        &format!("/api/v1/invoices?patient_id={patient_id}"),
        &bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{invoice_list}");
    assert!(invoice_list["items"].as_array().unwrap().iter().any(|row| {
        row["id"] == invoice_without_order_id.to_string() && row["order_id"].is_null()
    }));

    sqlx::query("UPDATE invoices SET status = 'sent' WHERE id = $1")
        .bind(invoice_without_order_id)
        .execute(&pool)
        .await
        .unwrap();
    let (status, paid_invoice) = json_request(
        &app,
        "POST",
        &format!("/api/v1/invoices/{invoice_without_order_id}/payments"),
        &bearer,
        Some(json!({
            "request_id": Uuid::new_v4(),
            "amount_gross": "250.00",
            "payment_method": "bank_transfer",
            "payment_reference": format!("PATIENT-{tag}"),
            "received_on": chrono::Utc::now().date_naive().to_string()
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{paid_invoice}");
    assert_eq!(paid_invoice["invoice"]["status"], "paid");
    assert_eq!(paid_invoice["invoice"]["order_id"], Value::Null);

    let unlinked_accounting_entries: i64 = sqlx::query_scalar(
        r#"SELECT COUNT(*)
           FROM accounting_entries
           WHERE source_invoice_id = $1
             AND order_id IS NULL
             AND currency = 'EUR'"#,
    )
    .bind(invoice_without_order_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(unlinked_accounting_entries > 0);
}

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
async fn imported_invoice_source_must_match_patient_and_order_and_cannot_be_reused() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };
    let tag = unique_tag("invoice-source");
    let patient = seed_patient(&pool, admin_id, &tag).await;
    let other_patient = seed_patient(&pool, admin_id, &format!("{tag}-other")).await;
    let order = seed_order(&pool, patient, admin_id, &tag).await;
    let document: Uuid = sqlx::query_scalar(
        r#"INSERT INTO documents (patient_id, order_id, auto_name, art, category, uploaded_by, id, version_root_document_id)
           VALUES ($1, $2, 'Invoice original', 'invoice_document', 'finance', $3, $4, $4) RETURNING id"#,
    ).bind(patient).bind(order).bind(admin_id).bind(Uuid::new_v4()).fetch_one(&pool).await.unwrap();
    let bearer = auth_header_for(admin_id, "ceo");
    let path = format!("/api/v1/orders/{order}/external-invoices");
    let mut payload = json!({ "patient_id": other_patient, "source_document_id": document,
        "supplier_name": "  REWE Markt  ",
        "external_invoice_number": format!("EXT-{tag}"), "invoice_date": "2026-09-01",
        "amount_net": 100, "amount_vat": 19, "amount_gross": 119, "currency": "EUR", "status": "received" });
    let (status, _) = json_request(&app, "POST", &path, &bearer, Some(payload.clone())).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    payload["patient_id"] = json!(patient);
    payload["source_document_id"] = json!(Uuid::new_v4());
    let (status, _) = json_request(&app, "POST", &path, &bearer, Some(payload.clone())).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    payload["source_document_id"] = json!(document);
    let (status, created) = json_request(&app, "POST", &path, &bearer, Some(payload.clone())).await;
    assert_eq!(status, StatusCode::CREATED, "{created}");
    let (status, detail) = json_request(
        &app,
        "GET",
        &format!("/api/v1/orders/{order}"),
        &bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        detail["external_invoices"][0]["source_document_id"],
        json!(document)
    );
    assert_eq!(
        detail["external_invoices"][0]["provider_name"],
        "REWE Markt"
    );
    assert!(detail["external_invoices"][0]["provider_id"].is_null());
    let (status, listed) = json_request(&app, "GET", &path, &bearer, None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(listed[0]["provider_name"], "REWE Markt");
    payload["external_invoice_number"] = json!(format!("EXT-{tag}-duplicate"));
    let (status, _) = json_request(&app, "POST", &path, &bearer, Some(payload)).await;
    assert_eq!(status, StatusCode::CONFLICT);
    let moved = sqlx::query("UPDATE documents SET patient_id = $2 WHERE id = $1")
        .bind(document)
        .bind(other_patient)
        .execute(&pool)
        .await;
    assert!(
        moved.is_err(),
        "Imported original must not move to another patient"
    );
}

#[tokio::test]
async fn company_invoice_import_does_not_require_patient_or_order() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };
    let tag = unique_tag("company-invoice");
    let document_id = Uuid::new_v4();
    sqlx::query(
        r#"INSERT INTO documents (
               auto_name, art, category, uploaded_by, id, version_root_document_id
           ) VALUES (
               $1, 'invoice_document', 'finance', $2, $3, $3
           )"#,
    )
    .bind(format!("FIN-Rechnung {tag}.pdf"))
    .bind(admin_id)
    .bind(document_id)
    .execute(&pool)
    .await
    .unwrap();

    let bearer = auth_header_for(admin_id, "ceo");
    let payload = json!({
        "source_document_id": document_id,
        "supplier_name": "K.B.M. GmbH",
        "external_invoice_number": format!("RE-{tag}"),
        "invoice_date": "2026-05-10",
        "due_date": "2026-05-24",
        "amount_net": 655.0,
        "amount_vat": 124.45,
        "amount_gross": 779.45,
        "currency": "EUR",
        "notes": "Incoming supplier invoice addressed to GMED"
    });
    let (status, created) = json_request(
        &app,
        "POST",
        "/api/v1/external-invoices/company",
        &bearer,
        Some(payload.clone()),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{created}");
    let invoice_id = Uuid::parse_str(created["id"].as_str().expect("company invoice id")).unwrap();

    let saved = sqlx::query(
        r#"SELECT invoice_scope, patient_id, order_id, supplier_name, provider_id,
                  amount_net, amount_vat, amount_gross, status, paid_by
           FROM external_invoices
           WHERE id = $1"#,
    )
    .bind(invoice_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        saved.try_get::<String, _>("invoice_scope").unwrap(),
        "company"
    );
    assert_eq!(
        saved.try_get::<Option<Uuid>, _>("patient_id").unwrap(),
        None
    );
    assert_eq!(saved.try_get::<Option<Uuid>, _>("order_id").unwrap(), None);
    assert_eq!(
        saved.try_get::<Option<Uuid>, _>("provider_id").unwrap(),
        None
    );
    assert_eq!(
        saved.try_get::<String, _>("supplier_name").unwrap(),
        "K.B.M. GmbH"
    );
    assert_eq!(saved.try_get::<String, _>("status").unwrap(), "approved");
    assert_eq!(saved.try_get::<String, _>("paid_by").unwrap(), "unpaid");

    sqlx::query(
        r#"INSERT INTO accounting_entries (
               entry_kind, direction, category, source_external_invoice_id,
               entry_date, description, amount_net, amount_vat, amount_gross,
               currency, created_by
           ) VALUES (
               'external_invoice_payment', 'expense', 'provider_expense', $1,
               '2026-05-10', $2, 655.00, 124.45, 779.45,
               'EUR', $3
           )"#,
    )
    .bind(invoice_id)
    .bind(format!("Company invoice payment RE-{tag}"))
    .bind(admin_id)
    .execute(&pool)
    .await
    .unwrap();

    let (status, ledger) = json_request(
        &app,
        "GET",
        "/api/v1/invoices/accounting-ledger?year=2026",
        &bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{ledger}");
    let ledger_entry = ledger["entries"]
        .as_array()
        .and_then(|entries| {
            entries
                .iter()
                .find(|entry| entry["external_invoice_id"] == invoice_id.to_string())
        })
        .expect("company invoice payment in accounting ledger");
    assert_eq!(ledger_entry["source_document_id"], document_id.to_string());
    assert_eq!(
        ledger_entry["source_document_name"],
        format!("FIN-Rechnung {tag}.pdf")
    );
    assert!(ledger_entry["invoice_id"].is_null());
    assert!(ledger_entry["order_id"].is_null());
    assert!(ledger_entry["patient_id"].is_null());

    let (status, position) = json_request(
        &app,
        "GET",
        "/api/v1/company-financial-position?currency=EUR",
        &bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{position}");
    let liability = position["provider_liabilities"]
        .as_array()
        .and_then(|items| {
            items
                .iter()
                .find(|item| item["id"] == invoice_id.to_string())
        })
        .expect("company invoice in provider liabilities");
    assert_eq!(liability["provider_name"], "K.B.M. GmbH");
    assert!(liability["patient_id"].is_null());
    assert!(liability["order_id"].is_null());
    assert_eq!(liability["remaining_gross"], "779.45");

    let (status, _) = json_request(
        &app,
        "POST",
        "/api/v1/external-invoices/company",
        &bearer,
        Some(payload),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/documents/{document_id}/delete"),
        &bearer,
        Some(json!({ "reason": "Must remain attached to imported invoice" })),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);

    let patient_id = seed_patient(&pool, admin_id, &format!("{tag}-patient")).await;
    let moved = sqlx::query("UPDATE documents SET patient_id = $2 WHERE id = $1")
        .bind(document_id)
        .bind(patient_id)
        .execute(&pool)
        .await;
    assert!(
        moved.is_err(),
        "Company invoice original must remain outside patient context"
    );
}

#[tokio::test]
async fn company_invoice_import_validates_and_preserves_the_selected_provider() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };
    let tag = unique_tag("company-invoice-provider");
    let provider_id = seed_provider(&pool, &tag).await;
    let document_id = Uuid::new_v4();
    sqlx::query(
        r#"INSERT INTO documents (auto_name, art, category, uploaded_by, id, version_root_document_id)
           VALUES ($1, 'invoice_document', 'finance', $2, $3, $3)"#,
    )
    .bind(format!("Supplier invoice {tag}.pdf"))
    .bind(admin_id)
    .bind(document_id)
    .execute(&pool)
    .await
    .unwrap();
    let bearer = auth_header_for(admin_id, "ceo");
    let path = "/api/v1/external-invoices/company";
    let mut payload = json!({
        "source_document_id": document_id,
        "supplier_name": format!("Clinic {tag}"),
        "provider_id": Uuid::new_v4(),
        "external_invoice_number": format!("EXT-{tag}"),
        "invoice_date": "2026-09-01",
        "amount_net": 100, "amount_vat": 19, "amount_gross": 119, "currency": "EUR"
    });
    let (status, _) = json_request(&app, "POST", path, &bearer, Some(payload.clone())).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    payload["provider_id"] = json!(provider_id);
    let (status, created) = json_request(&app, "POST", path, &bearer, Some(payload)).await;
    assert_eq!(status, StatusCode::CREATED, "{created}");
    let invoice_id = Uuid::parse_str(created["id"].as_str().unwrap()).unwrap();
    let saved: Option<Uuid> =
        sqlx::query_scalar("SELECT provider_id FROM external_invoices WHERE id = $1")
            .bind(invoice_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(saved, Some(provider_id));
    let (status, position) = json_request(
        &app,
        "GET",
        "/api/v1/company-financial-position?currency=EUR",
        &bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let liability = position["provider_liabilities"]
        .as_array()
        .unwrap()
        .iter()
        .find(|item| item["id"] == invoice_id.to_string())
        .unwrap();
    assert_eq!(liability["provider_id"], provider_id.to_string());
    assert_eq!(liability["provider_name"], format!("Clinic {tag}"));

    let account_id: Uuid = sqlx::query_scalar(
        "SELECT id FROM company_financial_accounts WHERE currency = 'EUR' AND is_default",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    let (status, payment) = json_request(&app, "POST", &format!("/api/v1/company-provider-liabilities/{invoice_id}/settlements"), &bearer, Some(json!({
        "request_id": Uuid::new_v4(), "financial_account_id": account_id,
        "amount_gross": "119", "paid_on": chrono::Utc::now().date_naive().to_string(), "payment_method": "bank_transfer"
    }))).await;
    assert_eq!(status, StatusCode::OK, "{payment}");
    let (status, ledger) = json_request(
        &app,
        "GET",
        &format!(
            "/api/v1/invoices/accounting-ledger?year={}",
            chrono::Utc::now().format("%Y")
        ),
        &bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{ledger}");
    let entry = ledger["entries"]
        .as_array()
        .unwrap()
        .iter()
        .find(|row| row["external_invoice_id"] == invoice_id.to_string())
        .expect("company payment in ledger");
    assert_eq!(entry["direction"], "expense");
    assert_eq!(entry["source_document_id"], document_id.to_string());
    assert!(entry["patient_id"].is_null());
    assert!(entry["order_id"].is_null());
}

#[tokio::test]
async fn billing_can_discard_only_its_own_unfinished_invoice_original() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };
    let tag = unique_tag("replace-invoice-source");
    let billing_id = seed_user(&pool, &tag, "billing").await;
    let document_id = Uuid::new_v4();
    sqlx::query(
        r#"INSERT INTO documents (
               auto_name, art, category, ursprung, uploaded_by, id,
               version_root_document_id
           ) VALUES (
               $1, 'invoice_document', 'finance', 'invoice_import', $2, $3, $3
           )"#,
    )
    .bind(format!("Unfinished invoice {tag}"))
    .bind(billing_id)
    .bind(document_id)
    .execute(&pool)
    .await
    .unwrap();

    let billing_bearer = auth_header_for(billing_id, "billing");
    let (status, response) = json_request(
        &app,
        "POST",
        &format!("/api/v1/documents/{document_id}/delete"),
        &billing_bearer,
        Some(json!({ "reason": "Replaced before invoice import completion" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{response}");
    let deleted = sqlx::query_scalar::<_, bool>(
        "SELECT file_deleted_at IS NOT NULL FROM documents WHERE id = $1",
    )
    .bind(document_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(deleted);

    let unrelated_id = Uuid::new_v4();
    sqlx::query(
        r#"INSERT INTO documents (
               auto_name, art, category, uploaded_by, id, version_root_document_id
           ) VALUES (
               $1, 'invoice_document', 'finance', $2, $3, $3
           )"#,
    )
    .bind(format!("Unrelated invoice {tag}"))
    .bind(admin_id)
    .bind(unrelated_id)
    .execute(&pool)
    .await
    .unwrap();
    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/documents/{unrelated_id}/delete"),
        &billing_bearer,
        Some(json!({ "reason": "Not owned by billing user" })),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
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

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/orders/{order_id}/external-invoices/{external_invoice_id}/update"),
        &billing_bearer,
        Some(json!({ "status": "paid", "paid_by": "patient" })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/orders/{order_id}/external-invoices/{external_invoice_id}/update"),
        &billing_bearer,
        Some(json!({ "status": "approved" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/orders/{order_id}/external-invoices/{external_invoice_id}/update"),
        &billing_bearer,
        Some(json!({ "status": "paid", "paid_by": "patient" })),
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
            "amount_net": 480.0,
            "amount_vat": 0,
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
