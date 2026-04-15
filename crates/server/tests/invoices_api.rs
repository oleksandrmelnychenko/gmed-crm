mod support;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use serde_json::{Value, json};
use sqlx::{PgPool, Row};
use tower::ServiceExt;
use uuid::Uuid;

use gmed_server::audit;
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
    let body = match body {
        Some(v) => Body::from(serde_json::to_vec(&v).unwrap()),
        None => Body::empty(),
    };

    let req = Request::builder()
        .method(method)
        .uri(path)
        .header("Authorization", bearer)
        .header("Content-Type", "application/json")
        .body(body)
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    let status = resp.status();
    let bytes = axum::body::to_bytes(resp.into_body(), 1024 * 1024)
        .await
        .unwrap();
    let value: Value = serde_json::from_slice(&bytes).unwrap_or(json!(null));
    (status, value)
}

async fn binary_request(
    app: &axum::Router,
    method: &str,
    path: &str,
    bearer: &str,
) -> (StatusCode, axum::http::HeaderMap, Vec<u8>) {
    let req = Request::builder()
        .method(method)
        .uri(path)
        .header("Authorization", bearer)
        .body(Body::empty())
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    let status = resp.status();
    let headers = resp.headers().clone();
    let bytes = axum::body::to_bytes(resp.into_body(), 10 * 1024 * 1024)
        .await
        .unwrap()
        .to_vec();
    (status, headers, bytes)
}

fn unique_tag(prefix: &str) -> String {
    format!("{prefix}-{}", Uuid::new_v4().simple())
}

fn auth_header_for(user_id: Uuid, role: &str) -> String {
    let token = jwt::issue_access_token(TEST_SECRET, user_id, role, Uuid::new_v4()).unwrap();
    format!("Bearer {token}")
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
    user_id: Uuid,
    assigned_by: Uuid,
) {
    sqlx::query(
        r#"INSERT INTO patient_assignments (patient_id, user_id, assigned_by)
           VALUES ($1, $2, $3)
           ON CONFLICT (patient_id, user_id)
           DO UPDATE SET revoked_at = NULL, assigned_by = $3, assigned_at = now()"#,
    )
    .bind(patient_id)
    .bind(user_id)
    .bind(assigned_by)
    .execute(pool)
    .await
    .unwrap();
}

async fn seed_order_with_process_gates(
    pool: &PgPool,
    patient_id: Uuid,
    created_by: Uuid,
    tag: &str,
    _billing_release_status: &str,
    _package_coverage_status: &str,
) -> Uuid {
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

async fn set_order_process_gates(
    pool: &PgPool,
    order_id: Uuid,
    actor_id: Uuid,
    billing_release_status: &str,
    package_coverage_status: &str,
) {
    sqlx::query(
        r#"UPDATE orders
           SET billing_release_status = $2,
               billing_release_note = 'test gate',
               billing_released_by = CASE WHEN $2 = 'granted' THEN $3 ELSE NULL END,
               billing_released_at = CASE WHEN $2 = 'granted' THEN now() ELSE NULL END,
               package_coverage_status = $4,
               package_coverage_note = 'test package gate',
               package_coverage_decided_by = $3,
               package_coverage_decided_at = now()
           WHERE id = $1"#,
    )
    .bind(order_id)
    .bind(billing_release_status)
    .bind(actor_id)
    .bind(package_coverage_status)
    .execute(pool)
    .await
    .unwrap();
}

async fn seed_order(pool: &PgPool, patient_id: Uuid, created_by: Uuid, tag: &str) -> Uuid {
    let order_id =
        seed_order_with_process_gates(pool, patient_id, created_by, tag, "granted", "not_covered")
            .await;
    set_order_process_gates(pool, order_id, created_by, "granted", "not_covered").await;
    order_id
}

async fn seed_order_leistung(
    pool: &PgPool,
    order_id: Uuid,
    description: &str,
    unit_price: f64,
    status: &str,
) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO order_leistungen (
                order_id, description, quantity, unit_price, vat_rate, status
           ) VALUES (
                $1, $2, 1, $3, 19, $4
           ) RETURNING id"#,
    )
    .bind(order_id)
    .bind(description)
    .bind(unit_price)
    .bind(status)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn seed_order_leistung_finance(
    pool: &PgPool,
    order_id: Uuid,
    description: &str,
    unit_price: f64,
    vat_rate: f64,
    is_cost_passthrough: bool,
    status: &str,
) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO order_leistungen (
                order_id, description, quantity, unit_price, vat_rate, is_cost_passthrough, status
           ) VALUES (
                $1, $2, 1, $3, $4, $5, $6
           ) RETURNING id"#,
    )
    .bind(order_id)
    .bind(description)
    .bind(unit_price)
    .bind(vat_rate)
    .bind(is_cost_passthrough)
    .bind(status)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn seed_supporting_document(
    pool: &PgPool,
    document_id: Uuid,
    patient_id: Uuid,
    order_id: Uuid,
    uploaded_by: Uuid,
    auto_name: &str,
    original_filename: &str,
) {
    sqlx::query(
        r#"INSERT INTO documents (
                id, patient_id, order_id, auto_name, original_filename, art, category,
                status, visibility, is_medical, version_root_document_id, version_number, uploaded_by
           ) VALUES (
                $1, $2, $3, $4, $5, 'receipt', 'payment',
                'active', 'released_internal', false, $1, 1, $6
           )"#,
    )
    .bind(document_id)
    .bind(patient_id)
    .bind(order_id)
    .bind(auto_name)
    .bind(original_filename)
    .bind(uploaded_by)
    .execute(pool)
    .await
    .unwrap();
}

async fn create_quote(app: &axum::Router, bearer: &str, order_id: Uuid) -> Value {
    let (status, body) = json_request(
        app,
        "POST",
        &format!("/api/v1/orders/{order_id}/quotes"),
        bearer,
        Some(json!({
            "notes": "Invoice-ready quote"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    body
}

async fn create_invoice(
    app: &axum::Router,
    bearer: &str,
    quote_id: &str,
    invoice_type: &str,
    due_date: &str,
) -> Value {
    let (status, body) = json_request(
        app,
        "POST",
        &format!("/api/v1/quotes/{quote_id}/invoices"),
        bearer,
        Some(json!({
            "invoice_type": invoice_type,
            "due_date": due_date
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    body
}

#[tokio::test]
async fn invoice_creation_from_quote_marks_order_services_invoiced() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("invoice-final");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let pm_id = seed_user(&pool, &tag, "patient_manager").await;
    let billing_id = seed_user(&pool, &tag, "billing").await;
    seed_patient_assignment(&pool, patient_id, pm_id, admin_id).await;

    let order_id = seed_order(&pool, patient_id, admin_id, &tag).await;
    let leistung_id = seed_order_leistung(
        &pool,
        order_id,
        "Approved diagnostic package",
        220.0,
        "approved",
    )
    .await;

    let pm_bearer = auth_header_for(pm_id, "patient_manager");
    let billing_bearer = auth_header_for(billing_id, "billing");
    let quote = create_quote(&app, &pm_bearer, order_id).await;
    let quote_id = quote["id"].as_str().unwrap();

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/quotes/{quote_id}/invoices"),
        &billing_bearer,
        Some(json!({
            "invoice_type": "final",
            "due_date": "2026-05-15",
            "notes": "Final settlement"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(body["invoice_type"], "final");
    assert_eq!(body["status"], "draft");
    assert!(body["invoice_number"].as_str().unwrap().starts_with("INV-"));
    assert_eq!(body["order_id"], order_id.to_string());
    assert_eq!(body["quote_id"], quote_id);
    assert_eq!(body["line_items"].as_array().unwrap().len(), 1);

    let current_status: String =
        sqlx::query_scalar("SELECT status FROM order_leistungen WHERE id = $1")
            .bind(leistung_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(current_status, "invoiced");

    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/invoices?patient_id={patient_id}&status=draft"),
        &billing_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["items"].as_array().unwrap().len(), 1);
}

#[tokio::test]
async fn invoice_list_returns_page_metadata_and_slices_results() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("invoice-pagination");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let pm_id = seed_user(&pool, &tag, "patient_manager").await;
    let billing_id = seed_user(&pool, &tag, "billing").await;
    seed_patient_assignment(&pool, patient_id, pm_id, admin_id).await;

    let billing_bearer = auth_header_for(billing_id, "billing");

    for index in 0..3 {
        let order_id = seed_order(&pool, patient_id, admin_id, &format!("{tag}-{index}")).await;
        seed_order_leistung(
            &pool,
            order_id,
            &format!("Paged line {index}"),
            100.0 + f64::from(index),
            "approved",
        )
        .await;
        let quote = create_quote(&app, &billing_bearer, order_id).await;
        let quote_id = quote["id"].as_str().unwrap();
        let _invoice = create_invoice(
            &app,
            &billing_bearer,
            quote_id,
            "final",
            &format!("2026-05-{}", 10 + index),
        )
        .await;
    }

    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/invoices?patient_id={patient_id}&page=2&per_page=2"),
        &billing_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["page"], 2);
    assert_eq!(body["per_page"], 2);
    assert_eq!(body["total"], 3);
    assert_eq!(body["total_pages"], 2);
    assert_eq!(body["items"].as_array().unwrap().len(), 1);
}

#[tokio::test]
async fn second_active_non_advance_invoice_for_same_quote_is_rejected() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("invoice-duplicate");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let pm_id = seed_user(&pool, &tag, "patient_manager").await;
    let billing_id = seed_user(&pool, &tag, "billing").await;
    seed_patient_assignment(&pool, patient_id, pm_id, admin_id).await;

    let order_id = seed_order(&pool, patient_id, admin_id, &tag).await;
    seed_order_leistung(&pool, order_id, "Approved cost block", 180.0, "approved").await;

    let pm_bearer = auth_header_for(pm_id, "patient_manager");
    let billing_bearer = auth_header_for(billing_id, "billing");
    let quote = create_quote(&app, &pm_bearer, order_id).await;
    let quote_id = quote["id"].as_str().unwrap();

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/quotes/{quote_id}/invoices"),
        &billing_bearer,
        Some(json!({ "invoice_type": "final" })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/quotes/{quote_id}/invoices"),
        &billing_bearer,
        Some(json!({ "invoice_type": "interim" })),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert!(
        body["message"]
            .as_str()
            .unwrap()
            .contains("active invoice already exists")
    );
}

#[tokio::test]
async fn advance_invoice_does_not_consume_order_services() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("invoice-advance");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let pm_id = seed_user(&pool, &tag, "patient_manager").await;
    let billing_id = seed_user(&pool, &tag, "billing").await;
    seed_patient_assignment(&pool, patient_id, pm_id, admin_id).await;

    let order_id = seed_order(&pool, patient_id, admin_id, &tag).await;
    let leistung_id =
        seed_order_leistung(&pool, order_id, "Advance-billed program", 500.0, "approved").await;

    let pm_bearer = auth_header_for(pm_id, "patient_manager");
    let billing_bearer = auth_header_for(billing_id, "billing");
    let quote = create_quote(&app, &pm_bearer, order_id).await;
    let quote_id = quote["id"].as_str().unwrap();

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/quotes/{quote_id}/invoices"),
        &billing_bearer,
        Some(json!({ "invoice_type": "advance" })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(body["invoice_type"], "advance");

    let current_status: String =
        sqlx::query_scalar("SELECT status FROM order_leistungen WHERE id = $1")
            .bind(leistung_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(current_status, "approved");
}

#[tokio::test]
async fn invoice_detail_includes_supporting_documents_for_cost_passthrough_line_items() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("invoice-supporting-doc");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let pm_id = seed_user(&pool, &tag, "patient_manager").await;
    let billing_id = seed_user(&pool, &tag, "billing").await;
    seed_patient_assignment(&pool, patient_id, pm_id, admin_id).await;

    let order_id = seed_order(&pool, patient_id, admin_id, &tag).await;
    let supporting_document_id = Uuid::new_v4();
    seed_supporting_document(
        &pool,
        supporting_document_id,
        patient_id,
        order_id,
        admin_id,
        "Clinic receipt",
        "receipt.pdf",
    )
    .await;

    let leistung_id = seed_order_leistung_finance(
        &pool,
        order_id,
        "Clinic passthrough",
        80.0,
        0.0,
        true,
        "approved",
    )
    .await;
    sqlx::query("UPDATE order_leistungen SET external_document_id = $2 WHERE id = $1")
        .bind(leistung_id)
        .bind(supporting_document_id)
        .execute(&pool)
        .await
        .unwrap();

    let pm_bearer = auth_header_for(pm_id, "patient_manager");
    let billing_bearer = auth_header_for(billing_id, "billing");
    let quote = create_quote(&app, &pm_bearer, order_id).await;
    let quote_id = quote["id"].as_str().unwrap();
    let invoice = create_invoice(&app, &billing_bearer, quote_id, "final", "2026-05-31").await;
    let invoice_id = invoice["id"].as_str().unwrap();

    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/invoices/{invoice_id}"),
        &billing_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let line_items = body["line_items"].as_array().expect("line items array");
    assert_eq!(line_items.len(), 1);
    assert_eq!(
        line_items[0]["external_document_id"],
        supporting_document_id.to_string()
    );

    let supporting_documents = body["supporting_documents"]
        .as_array()
        .expect("supporting documents array");
    assert_eq!(supporting_documents.len(), 1);
    assert_eq!(
        supporting_documents[0]["id"],
        supporting_document_id.to_string()
    );
    assert_eq!(supporting_documents[0]["auto_name"], "Clinic receipt");
    assert_eq!(supporting_documents[0]["original_filename"], "receipt.pdf");
    assert_eq!(supporting_documents[0]["art"], "receipt");
    assert_eq!(supporting_documents[0]["category"], "payment");
}

#[tokio::test]
async fn second_advance_invoice_for_same_quote_is_rejected() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("invoice-advance-duplicate");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let pm_id = seed_user(&pool, &tag, "patient_manager").await;
    let billing_id = seed_user(&pool, &tag, "billing").await;
    seed_patient_assignment(&pool, patient_id, pm_id, admin_id).await;

    let order_id = seed_order(&pool, patient_id, admin_id, &tag).await;
    seed_order_leistung(
        &pool,
        order_id,
        "Advance duplicate guard",
        350.0,
        "approved",
    )
    .await;

    let pm_bearer = auth_header_for(pm_id, "patient_manager");
    let billing_bearer = auth_header_for(billing_id, "billing");
    let quote = create_quote(&app, &pm_bearer, order_id).await;
    let quote_id = quote["id"].as_str().unwrap();

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/quotes/{quote_id}/invoices"),
        &billing_bearer,
        Some(json!({ "invoice_type": "advance" })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(body["invoice_type"], "advance");

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/quotes/{quote_id}/invoices"),
        &billing_bearer,
        Some(json!({ "invoice_type": "advance" })),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert!(
        body["message"]
            .as_str()
            .unwrap()
            .contains("active invoice already exists")
    );
}

#[tokio::test]
async fn invoice_creation_requires_billing_release_gate() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("invoice-billing-gate");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let pm_id = seed_user(&pool, &tag, "patient_manager").await;
    let billing_id = seed_user(&pool, &tag, "billing").await;
    seed_patient_assignment(&pool, patient_id, pm_id, admin_id).await;

    let order_id =
        seed_order_with_process_gates(&pool, patient_id, admin_id, &tag, "pending", "not_covered")
            .await;
    set_order_process_gates(&pool, order_id, billing_id, "pending", "not_covered").await;
    seed_order_leistung(&pool, order_id, "Approved gated block", 180.0, "approved").await;

    let pm_bearer = auth_header_for(pm_id, "patient_manager");
    let billing_bearer = auth_header_for(billing_id, "billing");
    let quote = create_quote(&app, &pm_bearer, order_id).await;
    let quote_id = quote["id"].as_str().unwrap();

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/quotes/{quote_id}/invoices"),
        &billing_bearer,
        Some(json!({ "invoice_type": "final" })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert!(
        body["message"]
            .as_str()
            .unwrap()
            .contains("billing release")
    );
}

#[tokio::test]
async fn billing_can_update_invoice_payment_state_and_interpreter_cannot_access_invoice() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("invoice-payment");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let pm_id = seed_user(&pool, &tag, "patient_manager").await;
    let billing_id = seed_user(&pool, &tag, "billing").await;
    let interpreter_id = seed_user(&pool, &tag, "interpreter").await;
    seed_patient_assignment(&pool, patient_id, pm_id, admin_id).await;

    let order_id = seed_order(&pool, patient_id, admin_id, &tag).await;
    seed_order_leistung(
        &pool,
        order_id,
        "Approved interpreter billing line",
        120.0,
        "approved",
    )
    .await;

    let pm_bearer = auth_header_for(pm_id, "patient_manager");
    let billing_bearer = auth_header_for(billing_id, "billing");
    let interpreter_bearer = auth_header_for(interpreter_id, "interpreter");
    let quote = create_quote(&app, &pm_bearer, order_id).await;
    let quote_id = quote["id"].as_str().unwrap();

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/quotes/{quote_id}/invoices"),
        &billing_bearer,
        Some(json!({ "invoice_type": "final" })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let invoice_id = body["id"].as_str().unwrap();
    let total_gross: f64 = body["total_gross"].as_str().unwrap().parse().unwrap();

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/invoices/{invoice_id}/status"),
        &billing_bearer,
        Some(json!({
            "status": "sent",
            "paid_amount": total_gross,
            "notes": "Paid in full"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["status"], "paid");
    assert_eq!(body["paid_amount"], total_gross.to_string());
    assert!(body["paid_at"].as_str().is_some());

    let (status, _) = json_request(
        &app,
        "GET",
        &format!("/api/v1/invoices/{invoice_id}"),
        &interpreter_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    let row = sqlx::query("SELECT paid_amount, status FROM invoices WHERE id = $1")
        .bind(Uuid::parse_str(invoice_id).unwrap())
        .fetch_one(&pool)
        .await
        .unwrap();
    let status_value: String = row.try_get("status").unwrap();
    assert_eq!(status_value, "paid");
}

#[tokio::test]
async fn paid_invoice_and_external_invoice_materialize_accounting_ledger_without_duplicates() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("accounting-ledger");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let pm_id = seed_user(&pool, &tag, "patient_manager").await;
    let billing_id = seed_user(&pool, &tag, "billing").await;
    let provider_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO providers (name, provider_type, address_city, fachbereich, address_country)
           VALUES ($1, 'medical', 'Berlin', 'Cardiology', 'DE')
           RETURNING id"#,
    )
    .bind(format!("Clinic {tag}"))
    .fetch_one(&pool)
    .await
    .unwrap();
    seed_patient_assignment(&pool, patient_id, pm_id, admin_id).await;

    let order_id = seed_order(&pool, patient_id, admin_id, &tag).await;
    seed_order_leistung_finance(
        &pool,
        order_id,
        "Medical service",
        100.0,
        19.0,
        false,
        "approved",
    )
    .await;
    seed_order_leistung_finance(
        &pool,
        order_id,
        "Clinic passthrough",
        50.0,
        0.0,
        true,
        "approved",
    )
    .await;

    let pm_bearer = auth_header_for(pm_id, "patient_manager");
    let billing_bearer = auth_header_for(billing_id, "billing");
    let quote = create_quote(&app, &pm_bearer, order_id).await;
    let quote_id = quote["id"].as_str().unwrap();

    let (status, invoice) = json_request(
        &app,
        "POST",
        &format!("/api/v1/quotes/{quote_id}/invoices"),
        &billing_bearer,
        Some(json!({ "invoice_type": "final", "due_date": "2026-05-20" })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let invoice_id = invoice["id"].as_str().unwrap();
    let total_gross: f64 = invoice["total_gross"].as_str().unwrap().parse().unwrap();

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/invoices/{invoice_id}/status"),
        &billing_bearer,
        Some(json!({
            "status": "paid",
            "paid_amount": total_gross,
            "notes": "Cash received"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "invoice update body: {:?}", body);

    let (status, external_invoice_body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/orders/{order_id}/external-invoices"),
        &billing_bearer,
        Some(json!({
            "provider_id": provider_id,
            "external_invoice_number": format!("EXT-{tag}"),
            "invoice_date": "2026-04-10",
            "due_date": "2026-04-25",
            "amount_net": 50.0,
            "amount_vat": 10.0,
            "amount_gross": 60.0,
            "currency": "EUR",
            "status": "received",
            "notes": "Clinic bill"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let external_invoice_id = external_invoice_body["id"].as_str().unwrap();

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/orders/{order_id}/external-invoices/{external_invoice_id}/update"),
        &billing_bearer,
        Some(json!({
            "status": "paid"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (status, ledger) = json_request(
        &app,
        "GET",
        "/api/v1/invoices/accounting-ledger?year=2026",
        &billing_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let entries = ledger["entries"].as_array().unwrap();
    assert_eq!(entries.len(), 3);
    let categories = entries
        .iter()
        .map(|entry| entry["category"].as_str().unwrap().to_string())
        .collect::<Vec<_>>();
    assert!(categories.contains(&"service_revenue".to_string()));
    assert!(categories.contains(&"cost_passthrough_revenue".to_string()));
    assert!(categories.contains(&"provider_expense".to_string()));
    assert_eq!(ledger["summary"]["income_gross"], invoice["total_gross"]);
    assert_eq!(ledger["summary"]["expense_gross"], "60");
    assert_eq!(ledger["summary"]["cost_passthrough_revenue_gross"], "50");
    assert_eq!(ledger["summary"]["provider_expense_gross"], "60");

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/invoices/{invoice_id}/status"),
        &billing_bearer,
        Some(json!({
            "status": "paid",
            "paid_amount": total_gross
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/orders/{order_id}/external-invoices/{external_invoice_id}/update"),
        &billing_bearer,
        Some(json!({
            "status": "paid"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (status, ledger) = json_request(
        &app,
        "GET",
        "/api/v1/invoices/accounting-ledger?year=2026",
        &billing_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(ledger["entries"].as_array().unwrap().len(), 3);
}

#[tokio::test]
async fn ceo_assistant_can_read_accounting_ledger_export_and_sales_cannot() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("accounting-ledger-rbac");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let pm_id = seed_user(&pool, &tag, "patient_manager").await;
    let billing_id = seed_user(&pool, &tag, "billing").await;
    let ceo_assistant_id = seed_user(&pool, &tag, "ceo_assistant").await;
    let sales_id = seed_user(&pool, &tag, "sales").await;
    seed_patient_assignment(&pool, patient_id, pm_id, admin_id).await;

    let order_id = seed_order(&pool, patient_id, admin_id, &tag).await;
    seed_order_leistung(&pool, order_id, "Accounting scope line", 120.0, "approved").await;

    let pm_bearer = auth_header_for(pm_id, "patient_manager");
    let billing_bearer = auth_header_for(billing_id, "billing");
    let assistant_bearer = auth_header_for(ceo_assistant_id, "ceo_assistant");
    let sales_bearer = auth_header_for(sales_id, "sales");
    let quote = create_quote(&app, &pm_bearer, order_id).await;
    let quote_id = quote["id"].as_str().unwrap();

    let invoice = create_invoice(&app, &billing_bearer, quote_id, "final", "2026-05-22").await;
    let invoice_id = invoice["id"].as_str().unwrap();
    let total_gross: f64 = invoice["total_gross"].as_str().unwrap().parse().unwrap();

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/invoices/{invoice_id}/status"),
        &billing_bearer,
        Some(json!({
            "status": "paid",
            "paid_amount": total_gross
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (status, body) = json_request(
        &app,
        "GET",
        "/api/v1/invoices/accounting-ledger?year=2026",
        &assistant_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["entries"].as_array().unwrap().len(), 1);

    let (status, headers, bytes) = binary_request(
        &app,
        "GET",
        "/api/v1/invoices/accounting-ledger/export?year=2026",
        &assistant_bearer,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        headers
            .get("content-type")
            .and_then(|value| value.to_str().ok()),
        Some("text/csv; charset=utf-8")
    );
    let csv = String::from_utf8(bytes).unwrap();
    assert!(csv.contains("entry_date,direction,category"));
    assert!(csv.contains(invoice["invoice_number"].as_str().unwrap()));

    let (status, _) = json_request(
        &app,
        "GET",
        "/api/v1/invoices/accounting-ledger?year=2026",
        &sales_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    let (status, _, _) = binary_request(
        &app,
        "GET",
        "/api/v1/invoices/accounting-ledger/export?year=2026",
        &sales_bearer,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn billing_can_run_first_and_second_dunning_then_collections() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("invoice-dunning");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let pm_id = seed_user(&pool, &tag, "patient_manager").await;
    let billing_id = seed_user(&pool, &tag, "billing").await;
    seed_patient_assignment(&pool, patient_id, pm_id, admin_id).await;

    let order_id = seed_order(&pool, patient_id, admin_id, &tag).await;
    seed_order_leistung(
        &pool,
        order_id,
        "Approved financial block",
        210.0,
        "approved",
    )
    .await;

    let pm_bearer = auth_header_for(pm_id, "patient_manager");
    let billing_bearer = auth_header_for(billing_id, "billing");
    let quote = create_quote(&app, &pm_bearer, order_id).await;
    let quote_id = quote["id"].as_str().unwrap();
    let invoice = create_invoice(&app, &billing_bearer, quote_id, "final", "2026-03-01").await;
    let invoice_id = invoice["id"].as_str().unwrap();

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/invoices/{invoice_id}/status"),
        &billing_bearer,
        Some(json!({ "status": "sent" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["status"], "sent");

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/invoices/{invoice_id}/dunning"),
        &billing_bearer,
        Some(json!({ "level": "first", "note": "First notice" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["level"], "first");

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/invoices/{invoice_id}/dunning"),
        &billing_bearer,
        Some(json!({ "level": "second", "note": "Second notice" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["level"], "second");

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/invoices/{invoice_id}/dunning"),
        &billing_bearer,
        Some(json!({ "level": "collections", "note": "Collections approved" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["level"], "collections");

    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/invoices/{invoice_id}/dunning"),
        &pm_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body.as_array().unwrap().len(), 3);

    let invoice_status: String = sqlx::query_scalar("SELECT status FROM invoices WHERE id = $1")
        .bind(Uuid::parse_str(invoice_id).unwrap())
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(invoice_status, "overdue");
}

#[tokio::test]
async fn dunning_sequence_requires_previous_step_and_billing_role() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("invoice-dunning-sequence");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let pm_id = seed_user(&pool, &tag, "patient_manager").await;
    let billing_id = seed_user(&pool, &tag, "billing").await;
    seed_patient_assignment(&pool, patient_id, pm_id, admin_id).await;

    let order_id = seed_order(&pool, patient_id, admin_id, &tag).await;
    seed_order_leistung(&pool, order_id, "Approved dunning block", 150.0, "approved").await;

    let pm_bearer = auth_header_for(pm_id, "patient_manager");
    let billing_bearer = auth_header_for(billing_id, "billing");
    let quote = create_quote(&app, &pm_bearer, order_id).await;
    let quote_id = quote["id"].as_str().unwrap();
    let invoice = create_invoice(&app, &billing_bearer, quote_id, "final", "2026-03-01").await;
    let invoice_id = invoice["id"].as_str().unwrap();

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/invoices/{invoice_id}/status"),
        &billing_bearer,
        Some(json!({ "status": "sent" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/invoices/{invoice_id}/dunning"),
        &billing_bearer,
        Some(json!({ "level": "second" })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert!(
        body["message"]
            .as_str()
            .unwrap()
            .contains("requires a first reminder")
    );

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/invoices/{invoice_id}/dunning"),
        &pm_bearer,
        Some(json!({ "level": "first" })),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn dunning_is_blocked_for_paid_invoice() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("invoice-dunning-paid");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let pm_id = seed_user(&pool, &tag, "patient_manager").await;
    let billing_id = seed_user(&pool, &tag, "billing").await;
    seed_patient_assignment(&pool, patient_id, pm_id, admin_id).await;

    let order_id = seed_order(&pool, patient_id, admin_id, &tag).await;
    seed_order_leistung(&pool, order_id, "Approved paid block", 95.0, "approved").await;

    let pm_bearer = auth_header_for(pm_id, "patient_manager");
    let billing_bearer = auth_header_for(billing_id, "billing");
    let quote = create_quote(&app, &pm_bearer, order_id).await;
    let quote_id = quote["id"].as_str().unwrap();
    let invoice = create_invoice(&app, &billing_bearer, quote_id, "final", "2026-03-01").await;
    let invoice_id = invoice["id"].as_str().unwrap();
    let total_gross = invoice["total_gross"]
        .as_str()
        .unwrap()
        .parse::<f64>()
        .unwrap();

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/invoices/{invoice_id}/status"),
        &billing_bearer,
        Some(json!({ "status": "sent", "paid_amount": total_gross })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/invoices/{invoice_id}/dunning"),
        &billing_bearer,
        Some(json!({ "level": "first" })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert!(
        body["message"]
            .as_str()
            .unwrap()
            .contains("not eligible for dunning")
    );
}

#[tokio::test]
async fn auto_dunning_scheduler_marks_overdue_and_advances_reminder_levels() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("invoice-auto-dunning");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let pm_id = seed_user(&pool, &tag, "patient_manager").await;
    let billing_id = seed_user(&pool, &tag, "billing").await;
    seed_patient_assignment(&pool, patient_id, pm_id, admin_id).await;

    let pm_bearer = auth_header_for(pm_id, "patient_manager");
    let billing_bearer = auth_header_for(billing_id, "billing");

    let order_first = seed_order(&pool, patient_id, admin_id, &format!("{tag}-first")).await;
    seed_order_leistung(&pool, order_first, "Auto first block", 110.0, "approved").await;
    let quote_first = create_quote(&app, &pm_bearer, order_first).await;
    let invoice_first = create_invoice(
        &app,
        &billing_bearer,
        quote_first["id"].as_str().unwrap(),
        "final",
        "2026-03-01",
    )
    .await;
    let invoice_first_id = Uuid::parse_str(invoice_first["id"].as_str().unwrap()).unwrap();
    sqlx::query("UPDATE invoices SET status = 'sent' WHERE id = $1")
        .bind(invoice_first_id)
        .execute(&pool)
        .await
        .unwrap();

    let order_second = seed_order(&pool, patient_id, admin_id, &format!("{tag}-second")).await;
    seed_order_leistung(&pool, order_second, "Auto second block", 120.0, "approved").await;
    let quote_second = create_quote(&app, &pm_bearer, order_second).await;
    let invoice_second = create_invoice(
        &app,
        &billing_bearer,
        quote_second["id"].as_str().unwrap(),
        "final",
        "2026-02-20",
    )
    .await;
    let invoice_second_id = Uuid::parse_str(invoice_second["id"].as_str().unwrap()).unwrap();
    sqlx::query("UPDATE invoices SET status = 'overdue' WHERE id = $1")
        .bind(invoice_second_id)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query(
        r#"INSERT INTO invoice_dunning_events (
                invoice_id, level, note, due_date_snapshot, balance_due, created_by, sent_at, created_at
           ) VALUES ($1, 'first', 'Seeded first reminder', $2, $3, $4, now() - interval '15 days', now() - interval '15 days')"#,
    )
    .bind(invoice_second_id)
    .bind(Some(chrono::NaiveDate::from_ymd_opt(2026, 2, 20).unwrap()))
    .bind(
        rust_decimal::Decimal::from_str_exact(invoice_second["total_gross"].as_str().unwrap())
            .unwrap(),
    )
    .bind(billing_id)
    .execute(&pool)
    .await
    .unwrap();

    let order_collections =
        seed_order(&pool, patient_id, admin_id, &format!("{tag}-collections")).await;
    seed_order_leistung(
        &pool,
        order_collections,
        "Auto collections block",
        130.0,
        "approved",
    )
    .await;
    let quote_collections = create_quote(&app, &pm_bearer, order_collections).await;
    let invoice_collections = create_invoice(
        &app,
        &billing_bearer,
        quote_collections["id"].as_str().unwrap(),
        "final",
        "2026-02-10",
    )
    .await;
    let invoice_collections_id =
        Uuid::parse_str(invoice_collections["id"].as_str().unwrap()).unwrap();
    sqlx::query("UPDATE invoices SET status = 'overdue' WHERE id = $1")
        .bind(invoice_collections_id)
        .execute(&pool)
        .await
        .unwrap();
    let collections_balance =
        rust_decimal::Decimal::from_str_exact(invoice_collections["total_gross"].as_str().unwrap())
            .unwrap();
    sqlx::query(
        r#"INSERT INTO invoice_dunning_events (
                invoice_id, level, note, due_date_snapshot, balance_due, created_by, sent_at, created_at
           ) VALUES
                ($1, 'first', 'Seeded first reminder', $2, $3, $4, now() - interval '45 days', now() - interval '45 days'),
                ($1, 'second', 'Seeded second reminder', $2, $3, $4, now() - interval '29 days', now() - interval '29 days')"#,
    )
    .bind(invoice_collections_id)
    .bind(Some(chrono::NaiveDate::from_ymd_opt(2026, 2, 10).unwrap()))
    .bind(collections_balance)
    .bind(billing_id)
    .execute(&pool)
    .await
    .unwrap();

    let state = AppState::new(
        pool.clone(),
        TEST_SECRET,
        SettingsCache::new(TokenSettings::default()),
    )
    .with_audit_sender(audit::spawn_writer(
        pool.clone(),
        "test-audit-ip-salt".to_string(),
    ));
    let summary = gmed_server::routes::invoices::run_auto_dunning_scheduler_once(&state)
        .await
        .unwrap();

    assert_eq!(summary.overdue_marked, 1);
    assert_eq!(summary.dunning_events_created, 3);

    let invoice_first_status: String =
        sqlx::query_scalar("SELECT status FROM invoices WHERE id = $1")
            .bind(invoice_first_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(invoice_first_status, "overdue");

    let first_levels: Vec<String> = sqlx::query_scalar(
        "SELECT level FROM invoice_dunning_events WHERE invoice_id = $1 ORDER BY sent_at, created_at",
    )
    .bind(invoice_first_id)
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(first_levels, vec!["first".to_string()]);

    let second_levels: Vec<String> = sqlx::query_scalar(
        "SELECT level FROM invoice_dunning_events WHERE invoice_id = $1 ORDER BY sent_at, created_at",
    )
    .bind(invoice_second_id)
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(
        second_levels,
        vec!["first".to_string(), "second".to_string()]
    );

    let collections_levels: Vec<String> = sqlx::query_scalar(
        "SELECT level FROM invoice_dunning_events WHERE invoice_id = $1 ORDER BY sent_at, created_at",
    )
    .bind(invoice_collections_id)
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(
        collections_levels,
        vec![
            "first".to_string(),
            "second".to_string(),
            "collections".to_string()
        ]
    );

    let auto_notes: Vec<String> = sqlx::query_scalar(
        "SELECT note FROM invoice_dunning_events
         WHERE invoice_id IN ($1, $2, $3)
           AND note LIKE '[system auto-dunning]%'",
    )
    .bind(invoice_first_id)
    .bind(invoice_second_id)
    .bind(invoice_collections_id)
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(auto_notes.len(), 3);

    support::wait_until("auto dunning audit rows", || async {
        let count: i64 = sqlx::query_scalar(
            "SELECT count(*)::bigint
             FROM audit_log
             WHERE action = 'auto_create_invoice_dunning_event'
               AND entity_type = 'invoice'
               AND entity_id IN ($1, $2, $3)",
        )
        .bind(invoice_first_id)
        .bind(invoice_second_id)
        .bind(invoice_collections_id)
        .fetch_one(&pool)
        .await
        .unwrap();
        count >= 3
    })
    .await;
    let auto_dunning_audit_count: i64 = sqlx::query_scalar(
        "SELECT count(*)::bigint
         FROM audit_log
         WHERE action = 'auto_create_invoice_dunning_event'
           AND entity_type = 'invoice'
           AND entity_id IN ($1, $2, $3)",
    )
    .bind(invoice_first_id)
    .bind(invoice_second_id)
    .bind(invoice_collections_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(auto_dunning_audit_count, 3);
}

#[tokio::test]
async fn staff_can_download_invoice_pdf_document() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("invoice-pdf-staff");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let pm_id = seed_user(&pool, &tag, "patient_manager").await;
    let billing_id = seed_user(&pool, &tag, "billing").await;
    seed_patient_assignment(&pool, patient_id, pm_id, admin_id).await;

    let order_id = seed_order(&pool, patient_id, admin_id, &tag).await;
    seed_order_leistung(&pool, order_id, "Approved PDF line", 145.0, "approved").await;

    let pm_bearer = auth_header_for(pm_id, "patient_manager");
    let billing_bearer = auth_header_for(billing_id, "billing");
    let quote = create_quote(&app, &pm_bearer, order_id).await;
    let quote_id = quote["id"].as_str().unwrap();
    let invoice = create_invoice(&app, &billing_bearer, quote_id, "final", "2026-05-30").await;
    let invoice_id = invoice["id"].as_str().unwrap();
    let invoice_number = invoice["invoice_number"].as_str().unwrap();

    let (status, headers, bytes) = binary_request(
        &app,
        "GET",
        &format!("/api/v1/invoices/{invoice_id}/pdf"),
        &billing_bearer,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        headers
            .get("content-type")
            .and_then(|value| value.to_str().ok()),
        Some("application/pdf")
    );
    assert!(
        headers
            .get("content-disposition")
            .and_then(|value| value.to_str().ok())
            .unwrap_or_default()
            .contains(invoice_number)
    );
    assert!(bytes.starts_with(b"%PDF-"));
    assert!(bytes.len() > 1_000);
}

#[tokio::test]
async fn patient_can_download_own_invoice_pdf() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("invoice-pdf-portal");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let pm_id = seed_user(&pool, &tag, "patient_manager").await;
    let billing_id = seed_user(&pool, &tag, "billing").await;
    let patient_user_id = seed_user(&pool, &tag, "patient").await;
    seed_patient_assignment(&pool, patient_id, pm_id, admin_id).await;
    seed_patient_assignment(&pool, patient_id, patient_user_id, admin_id).await;

    let order_id = seed_order(&pool, patient_id, admin_id, &tag).await;
    seed_order_leistung(
        &pool,
        order_id,
        "Portal-visible invoice line",
        210.0,
        "approved",
    )
    .await;

    let pm_bearer = auth_header_for(pm_id, "patient_manager");
    let billing_bearer = auth_header_for(billing_id, "billing");
    let patient_bearer = auth_header_for(patient_user_id, "patient");
    let quote = create_quote(&app, &pm_bearer, order_id).await;
    let quote_id = quote["id"].as_str().unwrap();
    let invoice = create_invoice(&app, &billing_bearer, quote_id, "final", "2026-05-30").await;
    let invoice_id = invoice["id"].as_str().unwrap();
    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/invoices/{invoice_id}/status"),
        &billing_bearer,
        Some(json!({ "status": "sent" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["status"], "sent");

    let (status, headers, bytes) = binary_request(
        &app,
        "GET",
        &format!("/api/v1/me/invoices/{invoice_id}/pdf"),
        &patient_bearer,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        headers
            .get("content-type")
            .and_then(|value| value.to_str().ok()),
        Some("application/pdf")
    );
    assert!(bytes.starts_with(b"%PDF-"));
    assert!(bytes.len() > 1_000);
}

#[tokio::test]
async fn ceo_assistant_can_read_but_cannot_mutate_invoice_workspace() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("invoice-assistant");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let pm_id = seed_user(&pool, &tag, "patient_manager").await;
    let billing_id = seed_user(&pool, &tag, "billing").await;
    let assistant_id = seed_user(&pool, &tag, "ceo_assistant").await;
    seed_patient_assignment(&pool, patient_id, pm_id, admin_id).await;

    let billing_bearer = auth_header_for(billing_id, "billing");
    let assistant_bearer = auth_header_for(assistant_id, "ceo_assistant");

    let order_id = seed_order(&pool, patient_id, pm_id, &tag).await;
    seed_order_leistung(
        &pool,
        order_id,
        "Assistant-visible invoice line",
        210.0,
        "approved",
    )
    .await;
    let quote = create_quote(&app, &billing_bearer, order_id).await;
    let quote_id = quote["id"].as_str().unwrap();
    let invoice = create_invoice(&app, &billing_bearer, quote_id, "final", "2026-05-30").await;
    let invoice_id = invoice["id"].as_str().unwrap().to_string();

    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/invoices?patient_id={patient_id}"),
        &assistant_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["items"].as_array().unwrap().len(), 1);

    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/invoices/{invoice_id}"),
        &assistant_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["patient_id"], patient_id.to_string());

    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/patients/{patient_id}/invoices"),
        &assistant_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body.as_array().unwrap().len(), 1);

    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/invoices/{invoice_id}/dunning"),
        &assistant_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(body.as_array().unwrap().is_empty());

    let (status, headers, bytes) = binary_request(
        &app,
        "GET",
        &format!("/api/v1/invoices/{invoice_id}/pdf"),
        &assistant_bearer,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        headers
            .get("content-type")
            .and_then(|value| value.to_str().ok()),
        Some("application/pdf")
    );
    assert!(bytes.starts_with(b"%PDF-"));
    assert!(bytes.len() > 1_000);

    for (method, path, payload) in [
        (
            "POST",
            format!("/api/v1/quotes/{quote_id}/invoices"),
            Some(json!({ "invoice_type": "interim" })),
        ),
        (
            "POST",
            format!("/api/v1/invoices/{invoice_id}/status"),
            Some(json!({ "status": "paid", "paid_amount": 249.90 })),
        ),
        (
            "POST",
            format!("/api/v1/invoices/{invoice_id}/dunning"),
            Some(json!({ "level": "first" })),
        ),
    ] {
        let (status, _) = json_request(&app, method, &path, &assistant_bearer, payload).await;
        assert_eq!(status, StatusCode::FORBIDDEN);
    }
}

#[tokio::test]
async fn sales_and_concierge_cannot_access_invoice_workspace() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("invoice-deny");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let sales_id = seed_user(&pool, &tag, "sales").await;
    let concierge_id = seed_user(&pool, &tag, "concierge").await;

    let sales_bearer = auth_header_for(sales_id, "sales");
    let concierge_bearer = auth_header_for(concierge_id, "concierge");

    for bearer in [&sales_bearer, &concierge_bearer] {
        let (status, _) = json_request(&app, "GET", "/api/v1/invoices", bearer, None).await;
        assert_eq!(status, StatusCode::FORBIDDEN);
    }

    let (status, _) = json_request(
        &app,
        "GET",
        &format!("/api/v1/patients/{patient_id}/invoices"),
        &concierge_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}
