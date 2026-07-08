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

async fn seed_payment_proof_document(
    pool: &PgPool,
    document_id: Uuid,
    patient_id: Uuid,
    order_id: Uuid,
    uploaded_by: Uuid,
    auto_name: &str,
    notes: Option<&str>,
) {
    sqlx::query(
        r#"INSERT INTO documents (
                id, patient_id, order_id, auto_name, original_filename, art, category,
                status, visibility, is_medical, version_root_document_id, version_number,
                uploaded_by, ursprung, notes
           ) VALUES (
                $1, $2, $3, $4, 'proof.pdf', 'payment_proof', 'finance',
                'active', 'patient_visible', false, $1, 1,
                $5, 'patient_portal', $6
           )"#,
    )
    .bind(document_id)
    .bind(patient_id)
    .bind(order_id)
    .bind(auto_name)
    .bind(uploaded_by)
    .bind(notes)
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

async fn seed_sent_invoice_direct(
    pool: &PgPool,
    order_id: Uuid,
    patient_id: Uuid,
    created_by: Uuid,
    tag: &str,
) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO invoices (
                order_id, patient_id, invoice_number, invoice_type, status,
                total_net, total_vat, total_gross, paid_amount, line_items, created_by
           ) VALUES (
                $1, $2, $3, 'final', 'sent',
                100, 19, 119, 0,
                '[{"description":"Consultation","quantity":"1","unit_price":"100","vat_rate":"19","line_net":"100","line_vat":"19","line_gross":"119"}]'::jsonb,
                $4
           ) RETURNING id"#,
    )
    .bind(order_id)
    .bind(patient_id)
    .bind(format!("INV-{tag}"))
    .bind(created_by)
    .fetch_one(pool)
    .await
    .unwrap()
}

fn current_ledger_year() -> String {
    chrono::Utc::now().format("%Y").to_string()
}

fn accounting_entries_for_invoice_or_external<'a>(
    entries: &'a [Value],
    invoice_number: &str,
    external_invoice_number: &str,
) -> Vec<&'a Value> {
    entries
        .iter()
        .filter(|entry| {
            entry
                .get("invoice_number")
                .and_then(Value::as_str)
                .is_some_and(|value| value == invoice_number)
                || entry
                    .get("external_invoice_number")
                    .and_then(Value::as_str)
                    .is_some_and(|value| value == external_invoice_number)
        })
        .collect()
}

fn accounting_entries_for_invoice<'a>(
    entries: &'a [Value],
    invoice_number: &str,
) -> Vec<&'a Value> {
    entries
        .iter()
        .filter(|entry| {
            entry
                .get("invoice_number")
                .and_then(Value::as_str)
                .is_some_and(|value| value == invoice_number)
        })
        .collect()
}

fn accounting_amount_gross(entry: &Value) -> f64 {
    entry["amount_gross"].as_str().unwrap().parse().unwrap()
}

fn assert_money_close(actual: f64, expected: f64) {
    assert!(
        (actual - expected).abs() < 0.01,
        "expected {expected}, got {actual}"
    );
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
async fn invoice_inherits_head_order_payer_with_patient_scoped_relation() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("payer-inherit");
    let father = seed_patient(&pool, admin_id, &format!("{tag}-f")).await;
    let child = seed_patient(&pool, admin_id, &format!("{tag}-c")).await;
    let pm_id = seed_user(&pool, &tag, "patient_manager").await;
    let billing_id = seed_user(&pool, &tag, "billing").await;
    seed_patient_assignment(&pool, father, pm_id, admin_id).await;
    seed_patient_assignment(&pool, child, pm_id, admin_id).await;

    let head = seed_order(&pool, father, admin_id, &format!("{tag}-head")).await;
    let sub = seed_order(&pool, child, admin_id, &format!("{tag}-sub")).await;
    seed_order_leistung(&pool, head, "Head service", 100.0, "approved").await;
    seed_order_leistung(&pool, sub, "Sub service", 80.0, "approved").await;

    // The father, as a relation of his own patient record, is the designated payer.
    let father_relation: Uuid = sqlx::query_scalar(
        r#"INSERT INTO patient_relations (patient_id, related_name, relation_type)
           VALUES ($1, 'Familienoberhaupt', 'parent') RETURNING id"#,
    )
    .bind(father)
    .fetch_one(&pool)
    .await
    .unwrap();

    // Group the child's order under the father's, and set the head's payer.
    sqlx::query("UPDATE orders SET order_role = 'sub', head_order_id = $2 WHERE id = $1")
        .bind(sub)
        .bind(head)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query(
        r#"UPDATE orders SET order_role = 'main',
               payer_patient_relation_id = $2,
               payer_contact_name = 'Vater zahlt für die Familie',
               payer_contact_relationship = 'Vater',
               payer_contact_email = 'vater@example.com'
           WHERE id = $1"#,
    )
    .bind(head)
    .bind(father_relation)
    .execute(&pool)
    .await
    .unwrap();

    let pm_bearer = auth_header_for(pm_id, "patient_manager");
    let billing_bearer = auth_header_for(billing_id, "billing");

    // Invoice off the SUB order: the free-text payer flows through, but the
    // head's relation belongs to the father, not the child, so it is not carried.
    let sub_quote = create_quote(&app, &pm_bearer, sub).await;
    let sub_invoice = create_invoice(
        &app,
        &billing_bearer,
        sub_quote["id"].as_str().unwrap(),
        "final",
        "2026-05-15",
    )
    .await;
    let sub_invoice_id = Uuid::parse_str(sub_invoice["id"].as_str().unwrap()).unwrap();
    let (name, relationship, rel): (Option<String>, Option<String>, Option<Uuid>) = sqlx::query_as(
        "SELECT payer_contact_name, payer_contact_relationship, payer_patient_relation_id
         FROM invoices WHERE id = $1",
    )
    .bind(sub_invoice_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(name.as_deref(), Some("Vater zahlt für die Familie"));
    assert_eq!(relationship.as_deref(), Some("Vater"));
    assert_eq!(rel, None, "cross-patient relation must not be inherited");

    // Invoice off the HEAD order itself: now the relation belongs to the invoice
    // patient (the father), so it is carried through.
    let head_quote = create_quote(&app, &pm_bearer, head).await;
    let head_invoice = create_invoice(
        &app,
        &billing_bearer,
        head_quote["id"].as_str().unwrap(),
        "final",
        "2026-05-15",
    )
    .await;
    let head_invoice_id = Uuid::parse_str(head_invoice["id"].as_str().unwrap()).unwrap();
    let (name, rel): (Option<String>, Option<Uuid>) = sqlx::query_as(
        "SELECT payer_contact_name, payer_patient_relation_id FROM invoices WHERE id = $1",
    )
    .bind(head_invoice_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(name.as_deref(), Some("Vater zahlt für die Familie"));
    assert_eq!(rel, Some(father_relation));
}

#[tokio::test]
async fn patient_invoice_amount_redaction_hides_api_amounts_and_blocks_pdf() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("invoice-redaction");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let patient_user_id = seed_user(&pool, &tag, "patient").await;
    let billing_id = seed_user(&pool, &tag, "billing").await;
    seed_patient_assignment(&pool, patient_id, patient_user_id, admin_id).await;

    let order_id = seed_order(&pool, patient_id, admin_id, &tag).await;
    let invoice_id = seed_sent_invoice_direct(&pool, order_id, patient_id, billing_id, &tag).await;

    let billing_bearer = auth_header_for(billing_id, "billing");
    let patient_bearer = auth_header_for(patient_user_id, "patient");

    let (status, updated) = json_request(
        &app,
        "POST",
        &format!("/api/v1/invoices/{invoice_id}/visibility"),
        &billing_bearer,
        Some(json!({
            "portal_visible": true,
            "hide_amounts_from_patient": true,
            "visibility_note": "paid by family"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(updated["hide_amounts_from_patient"], true);
    assert_eq!(
        updated["portal_visibility"]["amounts_visible_to_patient"],
        false
    );
    assert_eq!(
        updated["portal_visibility"]["pdf_visible_to_patient"],
        false
    );

    let (status, invoices) =
        json_request(&app, "GET", "/api/v1/me/invoices", &patient_bearer, None).await;
    assert_eq!(status, StatusCode::OK);
    let item = invoices
        .as_array()
        .unwrap()
        .iter()
        .find(|item| item["id"].as_str() == Some(&invoice_id.to_string()))
        .expect("redacted invoice visible in portal list");
    assert!(item["total_gross"].is_null());
    assert!(item["balance_due"].is_null());
    assert_eq!(
        item["portal_visibility"]["redaction_reason"].as_str(),
        Some("amounts_hidden_from_patient")
    );

    let (status, detail) = json_request(
        &app,
        "GET",
        &format!("/api/v1/me/invoices/{invoice_id}"),
        &patient_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(detail["total_net"].is_null());
    assert_eq!(detail["line_items"].as_array().unwrap().len(), 0);

    let (status, _, _) = binary_request(
        &app,
        "GET",
        &format!("/api/v1/me/invoices/{invoice_id}/pdf"),
        &patient_bearer,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn patient_portal_payment_proofs_are_scoped_to_invoice_number() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("invoice-proof-scope");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let patient_user_id = seed_user(&pool, &tag, "patient").await;
    let billing_id = seed_user(&pool, &tag, "billing").await;
    seed_patient_assignment(&pool, patient_id, patient_user_id, admin_id).await;

    let order_id = seed_order(&pool, patient_id, admin_id, &tag).await;
    let invoice_one_id = seed_sent_invoice_direct(
        &pool,
        order_id,
        patient_id,
        billing_id,
        &format!("{tag}-one"),
    )
    .await;
    let invoice_two_id = seed_sent_invoice_direct(
        &pool,
        order_id,
        patient_id,
        billing_id,
        &format!("{tag}-two"),
    )
    .await;
    let invoice_one_number: String =
        sqlx::query_scalar("SELECT invoice_number FROM invoices WHERE id = $1")
            .bind(invoice_one_id)
            .fetch_one(&pool)
            .await
            .unwrap();

    let proof_name = format!("Payment proof {invoice_one_number}");
    let proof_notes = format!("invoice:{invoice_one_id}");
    seed_payment_proof_document(
        &pool,
        Uuid::new_v4(),
        patient_id,
        order_id,
        patient_user_id,
        &proof_name,
        Some(&proof_notes),
    )
    .await;

    let patient_bearer = auth_header_for(patient_user_id, "patient");
    let (status, invoices) =
        json_request(&app, "GET", "/api/v1/me/invoices", &patient_bearer, None).await;
    assert_eq!(status, StatusCode::OK);
    let invoice_items = invoices.as_array().unwrap();
    let invoice_one = invoice_items
        .iter()
        .find(|item| item["id"].as_str() == Some(&invoice_one_id.to_string()))
        .expect("first invoice in portal list");
    let invoice_two = invoice_items
        .iter()
        .find(|item| item["id"].as_str() == Some(&invoice_two_id.to_string()))
        .expect("second invoice in portal list");
    assert_eq!(invoice_one["payment_proof_count"], 1);
    assert_eq!(invoice_two["payment_proof_count"], 0);

    let (status, detail_one) = json_request(
        &app,
        "GET",
        &format!("/api/v1/me/invoices/{invoice_one_id}"),
        &patient_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(detail_one["payment_proof_count"], 1);

    let (status, detail_two) = json_request(
        &app,
        "GET",
        &format!("/api/v1/me/invoices/{invoice_two_id}"),
        &patient_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(detail_two["payment_proof_count"], 0);
}

#[tokio::test]
async fn package_consumption_tracks_overage_approval_and_invoice_linkage() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("package-consumption");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let billing_id = seed_user(&pool, &tag, "billing").await;
    let billing_bearer = auth_header_for(billing_id, "billing");
    seed_patient_assignment(&pool, patient_id, billing_id, admin_id).await;

    let order_id = seed_order(&pool, patient_id, admin_id, &tag).await;
    seed_order_leistung(
        &pool,
        order_id,
        "Package eligible service",
        100.0,
        "approved",
    )
    .await;

    let standard_profile_id: Uuid =
        sqlx::query_scalar("SELECT id FROM tax_profiles WHERE profile_key = 'standard_vat'")
            .fetch_one(&pool)
            .await
            .unwrap();

    let (status, package) = json_request(
        &app,
        "POST",
        "/api/v1/service-packages",
        &billing_bearer,
        Some(json!({
            "package_key": format!("pkg_{tag}"),
            "name": "Package consumption test",
            "base_price_net": 100,
            "items": [{
                "description": "Included interpreter hour",
                "included_quantity": 1,
                "unit_label": "hour",
                "overage_unit_price_net": 50,
                "tax_profile_id": standard_profile_id,
                "requires_patient_approval": false
            }]
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let package_id = package["id"].as_str().unwrap();
    let package_item_id = package["items"][0]["id"].as_str().unwrap();

    let (status, assigned) = json_request(
        &app,
        "POST",
        &format!("/api/v1/patients/{patient_id}/service-packages"),
        &billing_bearer,
        Some(json!({
            "package_id": package_id,
            "order_id": order_id
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let patient_service_package_id = assigned["id"].as_str().unwrap();

    let (status, consumption) = json_request(
        &app,
        "POST",
        &format!(
            "/api/v1/patients/{patient_id}/service-packages/{patient_service_package_id}/consume"
        ),
        &billing_bearer,
        Some(json!({
            "package_item_id": package_item_id,
            "order_id": order_id,
            "quantity": 2,
            "notes": "second hour is overage"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(consumption["overage_quantity"], "1");
    assert_eq!(consumption["approval_status"], "pending");

    let (status, packages) = json_request(
        &app,
        "GET",
        &format!("/api/v1/patients/{patient_id}/service-packages"),
        &billing_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let package_line = packages
        .as_array()
        .unwrap()
        .iter()
        .find(|item| item["package_item_id"].as_str() == Some(package_item_id))
        .unwrap();
    assert_eq!(package_line["used_quantity"], "2");
    assert_eq!(package_line["pending_overage_quantity"], "1");

    let (status, decision) = json_request(
        &app,
        "POST",
        &format!(
            "/api/v1/patients/{patient_id}/service-packages/{patient_service_package_id}/overage-approval"
        ),
        &billing_bearer,
        Some(json!({
            "package_item_id": package_item_id,
            "approval_status": "approved"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(decision["updated_count"], 1);

    let (status, pending_consumption) = json_request(
        &app,
        "POST",
        &format!(
            "/api/v1/patients/{patient_id}/service-packages/{patient_service_package_id}/consume"
        ),
        &billing_bearer,
        Some(json!({
            "package_item_id": package_item_id,
            "order_id": order_id,
            "quantity": 1,
            "notes": "third hour still pending approval"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(pending_consumption["overage_quantity"], "1");
    assert_eq!(pending_consumption["approval_status"], "pending");

    let quote = create_quote(&app, &billing_bearer, order_id).await;
    let invoice = create_invoice(
        &app,
        &billing_bearer,
        quote["id"].as_str().unwrap(),
        "final",
        "2026-05-15",
    )
    .await;
    let invoice_id = Uuid::parse_str(invoice["id"].as_str().unwrap()).unwrap();
    assert_eq!(invoice["total_net"], "150");
    assert_eq!(invoice["total_vat"], "28.5");
    assert_eq!(invoice["total_gross"], "178.5");
    let lines = invoice["line_items"].as_array().unwrap();
    assert_eq!(lines.len(), 2);
    let overage_line = lines
        .iter()
        .find(|line| line["source"].as_str() == Some("service_package_overage"))
        .expect("approved overage invoice line");
    assert_eq!(overage_line["quantity"], "1");
    assert_eq!(overage_line["unit_price"], "50");
    assert_eq!(overage_line["vat_rate"], "19");
    assert_eq!(overage_line["line_net"], "50");
    assert_eq!(overage_line["line_vat"], "9.5");
    assert_eq!(overage_line["line_gross"], "59.5");

    let links = sqlx::query(
        "SELECT approval_status, invoice_id FROM service_package_consumptions WHERE patient_service_package_id = $1 ORDER BY created_at",
    )
    .bind(Uuid::parse_str(patient_service_package_id).unwrap())
    .fetch_all(&pool)
    .await
    .unwrap();
    let approved_link = links
        .iter()
        .find(|row| row.try_get::<String, _>("approval_status").unwrap() == "approved")
        .expect("approved consumption");
    assert_eq!(
        approved_link
            .try_get::<Option<Uuid>, _>("invoice_id")
            .unwrap(),
        Some(invoice_id)
    );
    let pending_link = links
        .iter()
        .find(|row| row.try_get::<String, _>("approval_status").unwrap() == "pending")
        .expect("pending consumption");
    assert_eq!(
        pending_link
            .try_get::<Option<Uuid>, _>("invoice_id")
            .unwrap(),
        None
    );
}

#[tokio::test]
async fn service_package_update_preserves_consumed_item_references() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("package-item-history");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let billing_id = seed_user(&pool, &tag, "billing").await;
    let billing_bearer = auth_header_for(billing_id, "billing");
    seed_patient_assignment(&pool, patient_id, billing_id, admin_id).await;

    let order_id = seed_order(&pool, patient_id, admin_id, &tag).await;
    let (status, package) = json_request(
        &app,
        "POST",
        "/api/v1/service-packages",
        &billing_bearer,
        Some(json!({
            "package_key": format!("pkg_history_{tag}"),
            "name": "Package item history",
            "base_price_net": 100,
            "items": [{
                "description": "Historical interpreter hour",
                "included_quantity": 2,
                "unit_label": "hour",
                "requires_patient_approval": false
            }]
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let package_id = package["id"].as_str().unwrap();
    let package_item_id = package["items"][0]["id"].as_str().unwrap();

    let (status, assigned) = json_request(
        &app,
        "POST",
        &format!("/api/v1/patients/{patient_id}/service-packages"),
        &billing_bearer,
        Some(json!({
            "package_id": package_id,
            "order_id": order_id
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let patient_service_package_id = assigned["id"].as_str().unwrap();

    let (status, _) = json_request(
        &app,
        "POST",
        &format!(
            "/api/v1/patients/{patient_id}/service-packages/{patient_service_package_id}/consume"
        ),
        &billing_bearer,
        Some(json!({
            "package_item_id": package_item_id,
            "order_id": order_id,
            "quantity": 1
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (status, updated) = json_request(
        &app,
        "POST",
        &format!("/api/v1/service-packages/{package_id}"),
        &billing_bearer,
        Some(json!({
            "package_key": format!("pkg_history_{tag}"),
            "name": "Package item history updated",
            "base_price_net": 120,
            "items": [{
                "id": package_item_id,
                "description": "Historical interpreter hour edited",
                "included_quantity": 3,
                "unit_label": "hour",
                "requires_patient_approval": false
            }]
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(updated["items"][0]["id"], package_item_id);
    assert_eq!(
        updated["items"][0]["description"],
        "Historical interpreter hour edited"
    );

    let linked_item_id: Option<Uuid> = sqlx::query_scalar(
        "SELECT package_item_id FROM service_package_consumptions WHERE patient_service_package_id = $1",
    )
    .bind(Uuid::parse_str(patient_service_package_id).unwrap())
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        linked_item_id,
        Some(Uuid::parse_str(package_item_id).unwrap())
    );

    let (status, packages) = json_request(
        &app,
        "GET",
        &format!("/api/v1/patients/{patient_id}/service-packages"),
        &billing_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let package_line = packages
        .as_array()
        .unwrap()
        .iter()
        .find(|item| item["package_item_id"].as_str() == Some(package_item_id))
        .expect("consumed package item remains visible");
    assert_eq!(package_line["used_quantity"], "1");
}

#[tokio::test]
async fn service_package_rejects_unknown_item_references() {
    let Some((app, pool, _admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("package-item-references");
    let billing_id = seed_user(&pool, &tag, "billing").await;
    let billing_bearer = auth_header_for(billing_id, "billing");

    let (status, body) = json_request(
        &app,
        "POST",
        "/api/v1/service-packages",
        &billing_bearer,
        Some(json!({
            "package_key": format!("pkg_tax_{tag}"),
            "name": "Package with missing item tax profile",
            "items": [{
                "description": "Custom item",
                "included_quantity": 1,
                "tax_profile_id": Uuid::new_v4()
            }]
        })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(body["message"], "Package item tax profile not found");

    let (status, body) = json_request(
        &app,
        "POST",
        "/api/v1/service-packages",
        &billing_bearer,
        Some(json!({
            "package_key": format!("pkg_service_{tag}"),
            "name": "Package with missing agency service",
            "items": [{
                "description": "Catalog-backed item",
                "included_quantity": 1,
                "agency_service_id": Uuid::new_v4()
            }]
        })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(body["message"], "Package item agency service not found");
}

#[tokio::test]
async fn invoice_detail_explains_mixed_vat_sources() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("vat-mixed");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let billing_id = seed_user(&pool, &tag, "billing").await;
    let billing_bearer = auth_header_for(billing_id, "billing");
    seed_patient_assignment(&pool, patient_id, billing_id, admin_id).await;
    let order_id = seed_order(&pool, patient_id, admin_id, &tag).await;

    let termin_profile_id: Uuid =
        sqlx::query_scalar("SELECT id FROM tax_profiles WHERE profile_key = 'termin_fee_0'")
            .fetch_one(&pool)
            .await
            .unwrap();
    let standard_profile_id: Uuid =
        sqlx::query_scalar("SELECT id FROM tax_profiles WHERE profile_key = 'standard_vat'")
            .fetch_one(&pool)
            .await
            .unwrap();

    sqlx::query(
        r#"INSERT INTO order_leistungen (
                order_id, description, quantity, unit_price, vat_rate, status,
                tax_profile_id, vat_source
           ) VALUES
                ($1, 'Termin organization', 1, 100, 0, 'approved', $2, 'tax_profile'),
                ($1, 'Interpreter support', 1, 100, 19, 'approved', $3, 'tax_profile')"#,
    )
    .bind(order_id)
    .bind(termin_profile_id)
    .bind(standard_profile_id)
    .execute(&pool)
    .await
    .unwrap();

    let quote = create_quote(&app, &billing_bearer, order_id).await;
    let invoice = create_invoice(
        &app,
        &billing_bearer,
        quote["id"].as_str().unwrap(),
        "final",
        "2026-05-15",
    )
    .await;
    assert_eq!(invoice["total_vat"], "19");

    let (status, detail) = json_request(
        &app,
        "GET",
        &format!("/api/v1/invoices/{}", invoice["id"].as_str().unwrap()),
        &billing_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let lines = detail["line_items"].as_array().unwrap();
    assert_eq!(lines.len(), 2);
    assert!(lines.iter().any(|line| {
        line["vat_rate"] == "0"
            && line["vat_source"] == "tax_profile"
            && line["vat_source_explanation"]
                .as_str()
                .unwrap()
                .contains("Termin fee 0% VAT")
    }));
    assert!(lines.iter().any(|line| {
        line["vat_rate"] == "19"
            && line["vat_source"] == "tax_profile"
            && line["vat_source_explanation"]
                .as_str()
                .unwrap()
                .contains("Standard VAT")
    }));
}

#[tokio::test]
async fn patient_financial_summary_hides_margin_from_patient_manager() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("margin-hidden");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let pm_id = seed_user(&pool, &tag, "patient_manager").await;
    let billing_id = seed_user(&pool, &tag, "billing").await;
    seed_patient_assignment(&pool, patient_id, pm_id, admin_id).await;
    let order_id = seed_order(&pool, patient_id, admin_id, &tag).await;
    let invoice_id = seed_sent_invoice_direct(&pool, order_id, patient_id, billing_id, &tag).await;

    sqlx::query(
        r#"INSERT INTO accounting_entries (
                entry_kind, direction, category, source_invoice_id, order_id, patient_id,
                entry_date, description, amount_net, amount_vat, amount_gross, currency,
                metadata, created_by
           ) VALUES (
                'external_invoice_payment', 'expense', 'provider_expense', $1, $2, $3,
                CURRENT_DATE, 'Provider expense', 40, 7.6, 47.6, 'EUR',
                '{}'::jsonb, $4
           )"#,
    )
    .bind(invoice_id)
    .bind(order_id)
    .bind(patient_id)
    .bind(billing_id)
    .execute(&pool)
    .await
    .unwrap();

    let pm_bearer = auth_header_for(pm_id, "patient_manager");
    let (status, summary) = json_request(
        &app,
        "GET",
        &format!("/api/v1/patients/{patient_id}/financial-summary"),
        &pm_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(summary["margin_visible"], false);
    assert!(summary["expenses_gross"].is_null());
    assert!(summary["margin_net"].is_null());
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
async fn paid_invoice_marks_linked_financial_supporting_documents_reimbursed() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("invoice-doc-reimbursed");
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
        "Clinic paid receipt",
        "paid-receipt.pdf",
    )
    .await;

    let leistung_id = seed_order_leistung_finance(
        &pool,
        order_id,
        "Clinic passthrough with receipt",
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
    let total_gross: f64 = invoice["total_gross"].as_str().unwrap().parse().unwrap();

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/invoices/{invoice_id}/status"),
        &billing_bearer,
        Some(json!({
            "status": "paid",
            "paid_amount": total_gross,
            "notes": "Patient invoice settled"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "invoice status body: {:?}", body);
    assert_eq!(body["status"], "paid");

    let row = sqlx::query(
        "SELECT financial_status, access_category, payment_date, payment_method
         FROM documents
         WHERE id = $1",
    )
    .bind(supporting_document_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    let financial_status: Option<String> = row.try_get("financial_status").unwrap();
    let access_category: Option<String> = row.try_get("access_category").unwrap();
    let payment_date: Option<chrono::NaiveDate> = row.try_get("payment_date").unwrap();
    let payment_method: Option<String> = row.try_get("payment_method").unwrap();

    assert_eq!(financial_status.as_deref(), Some("reimbursed"));
    assert_eq!(access_category.as_deref(), Some("financial"));
    assert!(payment_date.is_some());
    assert_eq!(payment_method.as_deref(), Some("bank_transfer"));
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
    let ledger_year = current_ledger_year();
    let invoice_due_date = format!("{ledger_year}-05-20");
    let external_invoice_number = format!("EXT-{tag}");
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
        Some(json!({ "invoice_type": "final", "due_date": invoice_due_date })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let invoice_id = invoice["id"].as_str().unwrap();
    let invoice_number = invoice["invoice_number"].as_str().unwrap();
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
            "external_invoice_number": external_invoice_number.clone(),
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
        &format!("/api/v1/invoices/accounting-ledger?year={ledger_year}"),
        &billing_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let entries = ledger["entries"].as_array().unwrap();
    let scoped_entries = accounting_entries_for_invoice_or_external(
        entries,
        invoice_number,
        &external_invoice_number,
    );
    assert_eq!(scoped_entries.len(), 3);
    let categories = scoped_entries
        .iter()
        .map(|entry| entry["category"].as_str().unwrap().to_string())
        .collect::<Vec<_>>();
    assert!(categories.contains(&"service_revenue".to_string()));
    assert!(categories.contains(&"cost_passthrough_revenue".to_string()));
    assert!(categories.contains(&"provider_expense".to_string()));

    let invoice_entries = accounting_entries_for_invoice(entries, invoice_number);
    assert_eq!(invoice_entries.len(), 2);
    let invoice_income_gross = invoice_entries
        .iter()
        .map(|entry| accounting_amount_gross(entry))
        .sum::<f64>();
    assert_money_close(invoice_income_gross, total_gross);
    let cost_passthrough_entry = scoped_entries
        .iter()
        .find(|entry| entry["category"] == "cost_passthrough_revenue")
        .unwrap();
    assert_money_close(accounting_amount_gross(cost_passthrough_entry), 50.0);
    let provider_expense_entry = scoped_entries
        .iter()
        .find(|entry| entry["category"] == "provider_expense")
        .unwrap();
    assert_money_close(accounting_amount_gross(provider_expense_entry), 60.0);

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
        &format!("/api/v1/invoices/accounting-ledger?year={ledger_year}"),
        &billing_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let entries = ledger["entries"].as_array().unwrap();
    let scoped_entries = accounting_entries_for_invoice_or_external(
        entries,
        invoice_number,
        &external_invoice_number,
    );
    assert_eq!(scoped_entries.len(), 3);
}

#[tokio::test]
async fn ceo_assistant_can_read_accounting_ledger_export_and_sales_cannot() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("accounting-ledger-rbac");
    let ledger_year = current_ledger_year();
    let invoice_due_date = format!("{ledger_year}-05-22");
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

    let invoice = create_invoice(&app, &billing_bearer, quote_id, "final", &invoice_due_date).await;
    let invoice_id = invoice["id"].as_str().unwrap();
    let invoice_number = invoice["invoice_number"].as_str().unwrap();
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
        &format!("/api/v1/invoices/accounting-ledger?year={ledger_year}"),
        &assistant_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let entries = body["entries"].as_array().unwrap();
    let invoice_entries = accounting_entries_for_invoice(entries, invoice_number);
    assert_eq!(invoice_entries.len(), 1);

    let (status, headers, bytes) = binary_request(
        &app,
        "GET",
        &format!("/api/v1/invoices/accounting-ledger/export?year={ledger_year}"),
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
        &format!("/api/v1/invoices/accounting-ledger?year={ledger_year}"),
        &sales_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    let (status, _, _) = binary_request(
        &app,
        "GET",
        &format!("/api/v1/invoices/accounting-ledger/export?year={ledger_year}"),
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
    let pdf_text = pdf_extract::extract_text_from_mem(&bytes).unwrap();
    assert!(pdf_text.contains(invoice_number));
    assert!(pdf_text.contains("Approved PDF line"));
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
    let pdf_text = pdf_extract::extract_text_from_mem(&bytes).unwrap();
    assert!(pdf_text.contains("Portal-visible invoice line"));
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
