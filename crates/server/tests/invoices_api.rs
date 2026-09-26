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

async fn create_sent_invoice(
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
    let invoice_id = body["id"].as_str().unwrap();
    release_invoice(app, bearer, invoice_id).await
}

async fn release_invoice(app: &axum::Router, bearer: &str, invoice_id: &str) -> Value {
    let (status, released) = json_request(
        app,
        "POST",
        &format!("/api/v1/invoices/{invoice_id}/status"),
        bearer,
        Some(json!({ "status": "sent" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "release invoice: {released:?}");
    released
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
    let invoiceable_quotes_path =
        format!("/api/v1/quotes?patient_id={patient_id}&invoiceable=true");

    let (status, body) =
        json_request(&app, "GET", &invoiceable_quotes_path, &billing_bearer, None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body.as_array().unwrap().len(), 1);
    assert_eq!(body[0]["id"], quote_id);

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

    // A quote with an active final invoice leaves the invoiceable list but
    // stays in the plain one.
    let (status, invoiceable) =
        json_request(&app, "GET", &invoiceable_quotes_path, &billing_bearer, None).await;
    assert_eq!(status, StatusCode::OK);
    assert!(invoiceable.as_array().unwrap().is_empty());
    let (status, all_quotes) = json_request(
        &app,
        "GET",
        &format!("/api/v1/quotes?patient_id={patient_id}"),
        &billing_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(all_quotes.as_array().unwrap().len(), 1);
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
    let sub_invoice = create_sent_invoice(
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
    let head_invoice = create_sent_invoice(
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
    let invoice = create_sent_invoice(
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
async fn service_package_pinned_catalog_price_is_validated_persisted_and_snapshotted() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("package-pinned-price");
    let billing_id = seed_user(&pool, &tag, "billing").await;
    let billing_bearer = auth_header_for(billing_id, "billing");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    seed_patient_assignment(&pool, patient_id, billing_id, admin_id).await;
    let order_id = seed_order(&pool, patient_id, admin_id, &tag).await;

    let (status, first_service) = json_request(
        &app,
        "POST",
        "/api/v1/agency-services",
        &billing_bearer,
        Some(json!({
            "service_key": format!("package_pinned_{tag}"),
            "service_name": "Pinned package service",
            "unit_label": "hour",
            "unit_price": 90,
            "currency": "EUR",
            "vat_rate": 19,
            "is_active": true,
            "valid_from": "2026-01-01"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "response: {first_service}");
    let first_service_id = first_service["id"].as_str().expect("first service id");

    // This version is deliberately outside the current period. Selecting it
    // explicitly must still freeze its own amount and VAT at consumption time.
    let (status, pinned_price) = json_request(
        &app,
        "POST",
        &format!("/api/v1/agency-services/{first_service_id}/price-versions"),
        &billing_bearer,
        Some(json!({
            "name": "Contracted future package price",
            "unit_price": 150,
            "currency": "EUR",
            "vat_rate": 7,
            "valid_from": "2027-01-01"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "response: {pinned_price}");
    let pinned_price_id = pinned_price["id"].as_str().expect("pinned price id");

    let (status, second_service) = json_request(
        &app,
        "POST",
        "/api/v1/agency-services",
        &billing_bearer,
        Some(json!({
            "service_key": format!("package_wrong_owner_{tag}"),
            "service_name": "Other package service",
            "unit_label": "hour",
            "unit_price": 70,
            "currency": "EUR",
            "vat_rate": 19,
            "is_active": true,
            "valid_from": "2026-01-01"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "response: {second_service}");
    let second_service_id = second_service["id"].as_str().expect("second service id");

    let (status, wrong_owner) = json_request(
        &app,
        "POST",
        "/api/v1/service-packages",
        &billing_bearer,
        Some(json!({
            "package_key": format!("pkg_wrong_price_{tag}"),
            "name": "Wrong pinned price owner",
            "currency": "EUR",
            "base_price_net": 100,
            "items": [{
                "agency_service_id": second_service_id,
                "agency_service_price_version_id": pinned_price_id,
                "description": "Wrong service version",
                "included_quantity": 0,
                "unit_label": "hour"
            }]
        })),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::UNPROCESSABLE_ENTITY,
        "response: {wrong_owner}"
    );

    let (status, conflicting_mode) = json_request(
        &app,
        "POST",
        "/api/v1/service-packages",
        &billing_bearer,
        Some(json!({
            "package_key": format!("pkg_conflicting_price_{tag}"),
            "name": "Conflicting package price mode",
            "currency": "EUR",
            "base_price_net": 100,
            "items": [{
                "agency_service_id": first_service_id,
                "agency_service_price_version_id": pinned_price_id,
                "description": "Two price modes",
                "included_quantity": 0,
                "unit_label": "hour",
                "overage_unit_price_net": 20
            }]
        })),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::UNPROCESSABLE_ENTITY,
        "response: {conflicting_mode}"
    );

    let (status, package) = json_request(
        &app,
        "POST",
        "/api/v1/service-packages",
        &billing_bearer,
        Some(json!({
            "package_key": format!("pkg_pinned_price_{tag}"),
            "name": "Pinned price package",
            "currency": "EUR",
            "base_price_net": 100,
            "items": [{
                "agency_service_id": first_service_id,
                "agency_service_price_version_id": pinned_price_id,
                "description": "Pinned future-priced hour",
                "included_quantity": 0,
                "unit_label": "hour"
            }]
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "response: {package}");
    assert_eq!(
        package["items"][0]["agency_service_price_version_id"],
        pinned_price_id
    );
    let package_id = package["id"].as_str().expect("package id");
    let package_item_id = package["items"][0]["id"].as_str().expect("package item id");
    let persisted_price_id: Option<Uuid> = sqlx::query_scalar(
        "SELECT agency_service_price_version_id FROM service_package_items WHERE id = $1",
    )
    .bind(Uuid::parse_str(package_item_id).unwrap())
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        persisted_price_id,
        Some(Uuid::parse_str(pinned_price_id).unwrap())
    );

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
    assert_eq!(status, StatusCode::OK, "response: {assigned}");
    let patient_package_id = assigned["id"].as_str().expect("patient package id");

    let (status, consumption) = json_request(
        &app,
        "POST",
        &format!("/api/v1/patients/{patient_id}/service-packages/{patient_package_id}/consume"),
        &billing_bearer,
        Some(json!({
            "package_item_id": package_item_id,
            "order_id": order_id,
            "quantity": 1
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "response: {consumption}");

    let snapshot = sqlx::query(
        r#"SELECT agency_service_price_version_id, unit_price_net_snapshot,
                  vat_rate_snapshot, currency_snapshot
           FROM service_package_consumptions
           WHERE patient_service_package_id = $1 AND package_item_id = $2
           ORDER BY created_at DESC
           LIMIT 1"#,
    )
    .bind(Uuid::parse_str(patient_package_id).unwrap())
    .bind(Uuid::parse_str(package_item_id).unwrap())
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        snapshot
            .try_get::<Option<Uuid>, _>("agency_service_price_version_id")
            .unwrap(),
        Some(Uuid::parse_str(pinned_price_id).unwrap())
    );
    assert_eq!(
        snapshot
            .try_get::<rust_decimal::Decimal, _>("unit_price_net_snapshot")
            .unwrap()
            .normalize()
            .to_string(),
        "150"
    );
    assert_eq!(
        snapshot
            .try_get::<rust_decimal::Decimal, _>("vat_rate_snapshot")
            .unwrap()
            .normalize()
            .to_string(),
        "7"
    );
    assert_eq!(
        snapshot.try_get::<String, _>("currency_snapshot").unwrap(),
        "EUR"
    );
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
    let invoice = create_sent_invoice(
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
        let _invoice = create_sent_invoice(
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
            .contains("no remaining quantities to invoice")
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

/// A new quote for an order closes the order's older open quotes: nothing more
/// can be invoiced from them, while an advance invoiced from the old quote stays
/// creditable against the new quote's final invoice (prepayments are
/// order-scoped). A quote settled by an active final invoice is left alone.
#[tokio::test]
async fn new_quote_supersedes_older_open_quotes_and_keeps_their_advance_creditable() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("quote-supersede");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let pm_id = seed_user(&pool, &tag, "patient_manager").await;
    let billing_id = seed_user(&pool, &tag, "billing").await;
    seed_patient_assignment(&pool, patient_id, pm_id, admin_id).await;
    seed_patient_assignment(&pool, patient_id, billing_id, admin_id).await;
    let pm_bearer = auth_header_for(pm_id, "patient_manager");
    let billing_bearer = auth_header_for(billing_id, "billing");

    let order_id = seed_order(&pool, patient_id, admin_id, &tag).await;
    // 2.5 h interpreter planned (178.50 gross) and the organisation fee (119).
    let interpreter_line: Uuid = sqlx::query_scalar(
        r#"INSERT INTO order_leistungen (order_id, description, quantity, unit_price, vat_rate, status)
           VALUES ($1, 'Dolmetscherleistung', 2.5, 60, 19, 'planned')
           RETURNING id"#,
    )
    .bind(order_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    seed_order_leistung(
        &pool,
        order_id,
        "Organisation der Behandlung",
        100.0,
        "approved",
    )
    .await;

    let first_quote = create_quote(&app, &pm_bearer, order_id).await;
    let first_quote_id = first_quote["id"].as_str().unwrap().to_string();
    assert_eq!(first_quote["superseded_quotes"], json!([]));

    // An advance from the first quote, 100 of it paid.
    let advance = create_sent_invoice(
        &app,
        &billing_bearer,
        &first_quote_id,
        "advance",
        "2026-10-15",
    )
    .await;
    let advance_id = advance["id"].as_str().unwrap().to_string();
    let (status, payment) = json_request(
        &app,
        "POST",
        &format!("/api/v1/invoices/{advance_id}/payments"),
        &billing_bearer,
        Some(json!({
            "request_id": Uuid::new_v4(),
            "amount_gross": "100",
            "payment_method": "bank_transfer",
            "payment_reference": "ADVANCE-SUPERSEDE",
            "received_on": chrono::Utc::now().date_naive().to_string(),
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "advance payment: {payment}");

    // The approved interpreter report replaced the planned 2.5 h by 1.5 h and a
    // completed appointment added a treatment-organisation service.
    sqlx::query("UPDATE order_leistungen SET quantity = 1.5, status = 'approved' WHERE id = $1")
        .bind(interpreter_line)
        .execute(&pool)
        .await
        .unwrap();
    seed_order_leistung(
        &pool,
        order_id,
        "Organisation der Behandlung (je 1 Arzt)",
        50.0,
        "approved",
    )
    .await;

    let second_quote = create_quote(&app, &pm_bearer, order_id).await;
    let second_quote_id = second_quote["id"].as_str().unwrap().to_string();
    assert_eq!(
        second_quote["superseded_quotes"],
        json!([{ "id": first_quote_id, "quote_number": first_quote["quote_number"] }])
    );

    let (status, first) = json_request(
        &app,
        "GET",
        &format!("/api/v1/quotes/{first_quote_id}"),
        &billing_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "first quote: {first}");
    assert_eq!(first["status"], "superseded");
    assert_eq!(first["superseded_by_quote_id"], second_quote_id);
    assert_eq!(
        first["superseded_by_quote_number"],
        second_quote["quote_number"]
    );
    assert!(first["superseded_at"].is_string(), "first quote: {first}");
    // The advance issued from it stays on record.
    assert_eq!(first["active_invoice_types"], json!(["advance"]));

    // History is kept: the closed quote gets a superseded version snapshot.
    let (status, versions) = json_request(
        &app,
        "GET",
        &format!("/api/v1/quotes/{first_quote_id}/versions"),
        &billing_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "versions: {versions}");
    let versions = versions.as_array().unwrap();
    assert_eq!(versions.len(), 2, "versions: {versions:?}");
    assert_eq!(versions[0]["status"], "superseded");
    assert_eq!(versions[0]["change_reason"], "superseded");
    assert_eq!(versions[1]["status"], "draft");

    // Audited in the quote creation transaction.
    let (old_value, new_value, context): (Value, Value, Value) = sqlx::query_as(
        r#"SELECT old_value, new_value, context FROM audit_log
           WHERE action = 'supersede_quote' AND entity_id = $1"#,
    )
    .bind(Uuid::parse_str(&first_quote_id).unwrap())
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(old_value["status"], "draft");
    assert_eq!(new_value["status"], "superseded");
    assert_eq!(new_value["superseded_by_quote_id"], second_quote_id);
    assert_eq!(context["order_id"], order_id.to_string());
    let creation_context: Value = sqlx::query_scalar(
        "SELECT context FROM audit_log WHERE action = 'create_quote' AND entity_id = $1",
    )
    .bind(Uuid::parse_str(&second_quote_id).unwrap())
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        creation_context["superseded_quote_ids"],
        json!([first_quote_id])
    );

    // Nothing more can be invoiced from the superseded quote, on either path.
    for invoice_type in ["final", "interim", "advance"] {
        let (status, body) = json_request(
            &app,
            "POST",
            &format!("/api/v1/quotes/{first_quote_id}/invoices"),
            &billing_bearer,
            Some(json!({ "invoice_type": invoice_type })),
        )
        .await;
        assert_eq!(
            status,
            StatusCode::UNPROCESSABLE_ENTITY,
            "{invoice_type}: {body}"
        );
        assert!(
            body["message"].as_str().unwrap().contains("superseded"),
            "{invoice_type}: {body}"
        );
    }
    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/patients/{patient_id}/billing-invoices"),
        &billing_bearer,
        Some(json!({
            "request_id": Uuid::new_v4(),
            "order_id": order_id,
            "quote_id": first_quote_id,
            "invoice_type": "interim",
            "external_invoice_ids": [],
        })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");

    // Only the new quote is offered for invoicing.
    let (status, invoiceable) = json_request(
        &app,
        "GET",
        &format!("/api/v1/quotes?order_id={order_id}&invoiceable=true"),
        &billing_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{invoiceable}");
    let invoiceable_ids = invoiceable
        .as_array()
        .unwrap()
        .iter()
        .map(|quote| quote["id"].as_str().unwrap().to_string())
        .collect::<Vec<_>>();
    assert_eq!(invoiceable_ids, vec![second_quote_id.clone()]);
    let (status, superseded_list) = json_request(
        &app,
        "GET",
        &format!("/api/v1/quotes?order_id={order_id}&status=superseded"),
        &billing_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{superseded_list}");
    assert_eq!(superseded_list.as_array().unwrap().len(), 1);
    assert_eq!(superseded_list[0]["id"], first_quote_id);

    // 'superseded' is terminal and set only by the system.
    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/quotes/{first_quote_id}/status"),
        &pm_bearer,
        Some(json!({ "status": "accepted" })),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{body}");
    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/quotes/{second_quote_id}/status"),
        &pm_bearer,
        Some(json!({ "status": "superseded" })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");

    // Final invoice from the new quote (1.5 h 107.10 + 119 + 59.50), and the
    // advance paid against the old quote is credited to it.
    let final_invoice = create_sent_invoice(
        &app,
        &billing_bearer,
        &second_quote_id,
        "final",
        "2026-10-31",
    )
    .await;
    let final_invoice_id = final_invoice["id"].as_str().unwrap().to_string();
    assert_money_close(
        final_invoice["total_gross"]
            .as_str()
            .unwrap()
            .parse()
            .unwrap(),
        285.60,
    );
    let (status, applied) = json_request(
        &app,
        "POST",
        &format!("/api/v1/invoices/{final_invoice_id}/prepayment-allocations"),
        &billing_bearer,
        Some(json!({
            "request_id": Uuid::new_v4(),
            "advance_invoice_id": advance_id,
            "amount_gross": "100",
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "apply advance: {applied}");
    assert_money_close(
        applied["prepayment_applied_amount"]
            .as_str()
            .unwrap()
            .parse()
            .unwrap(),
        100.0,
    );
    assert_money_close(
        applied["balance_due"].as_str().unwrap().parse().unwrap(),
        185.60,
    );

    // Pricing the order again leaves the quote settled by its final invoice
    // (and the already superseded one) as they are.
    seed_order_leistung(&pool, order_id, "Nachbetreuung", 40.0, "approved").await;
    let third_quote = create_quote(&app, &pm_bearer, order_id).await;
    assert_eq!(third_quote["superseded_quotes"], json!([]));
    let statuses: Vec<(Uuid, String)> =
        sqlx::query_as("SELECT id, status FROM quotes WHERE order_id = $1 ORDER BY created_at, id")
            .bind(order_id)
            .fetch_all(&pool)
            .await
            .unwrap();
    let status_of = |id: &str| {
        statuses
            .iter()
            .find(|(quote_id, _)| quote_id.to_string() == id)
            .map(|(_, status)| status.clone())
            .unwrap()
    };
    assert_eq!(status_of(&first_quote_id), "superseded");
    assert_eq!(status_of(&second_quote_id), "draft");
    assert_eq!(status_of(third_quote["id"].as_str().unwrap()), "draft");
}

/// Advances are credited only against released invoices. A draft offers no
/// advance and refuses one with a message saying why, instead of a balance
/// conflict. Releasing the draft dates the invoice.
#[tokio::test]
async fn draft_invoice_offers_no_advance_and_is_dated_on_release() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("advance-draft-target");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let pm_id = seed_user(&pool, &tag, "patient_manager").await;
    let billing_id = seed_user(&pool, &tag, "billing").await;
    seed_patient_assignment(&pool, patient_id, pm_id, admin_id).await;
    seed_patient_assignment(&pool, patient_id, billing_id, admin_id).await;
    let pm_bearer = auth_header_for(pm_id, "patient_manager");
    let billing_bearer = auth_header_for(billing_id, "billing");

    let order_id = seed_order(&pool, patient_id, admin_id, &tag).await;
    seed_order_leistung(&pool, order_id, "Organisation", 100.0, "approved").await;
    let quote = create_quote(&app, &pm_bearer, order_id).await;
    let quote_id = quote["id"].as_str().unwrap().to_string();

    let advance =
        create_sent_invoice(&app, &billing_bearer, &quote_id, "advance", "2026-10-15").await;
    let advance_id = advance["id"].as_str().unwrap().to_string();
    let (status, payment) = json_request(
        &app,
        "POST",
        &format!("/api/v1/invoices/{advance_id}/payments"),
        &billing_bearer,
        Some(json!({
            "request_id": Uuid::new_v4(),
            "amount_gross": "50",
            "payment_method": "bank_transfer",
            "received_on": chrono::Utc::now().date_naive().to_string(),
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "advance payment: {payment}");

    let (status, draft) = json_request(
        &app,
        "POST",
        &format!("/api/v1/quotes/{quote_id}/invoices"),
        &billing_bearer,
        Some(json!({ "invoice_type": "final" })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "final draft: {draft}");
    let draft_id = draft["id"].as_str().unwrap().to_string();
    assert_eq!(draft["status"], "draft");
    assert_eq!(draft["available_prepayments"], json!([]));

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/invoices/{draft_id}/prepayment-allocations"),
        &billing_bearer,
        Some(json!({
            "request_id": Uuid::new_v4(),
            "advance_invoice_id": advance_id,
            "amount_gross": "50",
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{body}");
    assert!(
        body["message"].as_str().unwrap().contains("released"),
        "{body}"
    );

    // The draft was prepared ten days ago; the invoice is dated when released.
    sqlx::query("UPDATE invoices SET issued_at = now() - interval '10 days' WHERE id = $1::uuid")
        .bind(&draft_id)
        .execute(&pool)
        .await
        .unwrap();
    let released = release_invoice(&app, &billing_bearer, &draft_id).await;
    assert_eq!(
        released["available_prepayments"][0]["invoice_id"],
        advance_id
    );
    let issued_recently: bool = sqlx::query_scalar(
        "SELECT issued_at > now() - interval '1 hour' FROM invoices WHERE id = $1::uuid",
    )
    .bind(&draft_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(issued_recently, "release must date the invoice");
}

/// A service partly invoiced from a quote stays on the order's next quote with
/// its full quantity (only fully invoiced services leave the quotable lines).
/// The replacing quote may bill only what was not invoiced yet: 10 h
/// delivered, 4 h invoiced from the first quote, 6 h left on the second.
#[tokio::test]
async fn replacing_quote_does_not_bill_hours_already_invoiced_from_the_superseded_quote() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("quote-supersede-partial");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let pm_id = seed_user(&pool, &tag, "patient_manager").await;
    let billing_id = seed_user(&pool, &tag, "billing").await;
    seed_patient_assignment(&pool, patient_id, pm_id, admin_id).await;
    seed_patient_assignment(&pool, patient_id, billing_id, admin_id).await;
    let pm_bearer = auth_header_for(pm_id, "patient_manager");
    let billing_bearer = auth_header_for(billing_id, "billing");

    let order_id = seed_order(&pool, patient_id, admin_id, &tag).await;
    let hours_line: Uuid = sqlx::query_scalar(
        r#"INSERT INTO order_leistungen (order_id, description, quantity, unit_price, vat_rate, status)
           VALUES ($1, 'Patientenbetreuung (Stunden)', 10, 95, 19, 'approved')
           RETURNING id"#,
    )
    .bind(order_id)
    .fetch_one(&pool)
    .await
    .unwrap();

    let first_quote = create_quote(&app, &pm_bearer, order_id).await;
    let first_quote_id = first_quote["id"].as_str().unwrap().to_string();
    let (status, interim) = json_request(
        &app,
        "POST",
        &format!("/api/v1/quotes/{first_quote_id}/invoices"),
        &billing_bearer,
        Some(json!({
            "invoice_type": "interim",
            "line_items": [{ "line_index": 0, "quantity": "4" }],
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "interim: {interim}");
    release_invoice(&app, &billing_bearer, interim["id"].as_str().unwrap()).await;

    // Partly invoiced, so the service is still quotable and the new quote
    // lists all 10 h again.
    let second_quote = create_quote(&app, &pm_bearer, order_id).await;
    let second_quote_id = second_quote["id"].as_str().unwrap().to_string();
    assert_eq!(
        second_quote["superseded_quotes"][0]["id"], first_quote_id,
        "{second_quote}"
    );
    let (status, detail) = json_request(
        &app,
        "GET",
        &format!("/api/v1/quotes/{second_quote_id}"),
        &billing_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{detail}");
    let line = &detail["line_items"][0];
    assert_eq!(line["source_order_leistung_id"], hours_line.to_string());
    assert_money_close(line["quantity"].as_str().unwrap().parse().unwrap(), 10.0);
    assert_money_close(
        line["invoiced_quantity"].as_str().unwrap().parse().unwrap(),
        4.0,
    );
    assert_money_close(
        line["remaining_quantity"]
            .as_str()
            .unwrap()
            .parse()
            .unwrap(),
        6.0,
    );

    // Billing the 4 invoiced hours a second time is refused.
    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/quotes/{second_quote_id}/invoices"),
        &billing_bearer,
        Some(json!({
            "invoice_type": "interim",
            "line_items": [{ "line_index": 0, "quantity": "10" }],
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{body}");

    // The final invoice settles the remaining 6 h: 570.00 + 108.30 VAT.
    let final_invoice = create_sent_invoice(
        &app,
        &billing_bearer,
        &second_quote_id,
        "final",
        "2026-10-31",
    )
    .await;
    assert_money_close(
        final_invoice["total_gross"]
            .as_str()
            .unwrap()
            .parse()
            .unwrap(),
        678.30,
    );
    let service_status: String =
        sqlx::query_scalar("SELECT status FROM order_leistungen WHERE id = $1")
            .bind(hours_line)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(service_status, "invoiced");

    // The database enforces the same limit for any allocation of the service.
    let extra_invoice_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO invoices (
               quote_id, order_id, patient_id, invoice_number, invoice_type, status,
               total_net, total_vat, total_gross, line_items, created_by
           ) VALUES ($1::uuid, $2, $3, $4, 'interim', 'draft', 95, 18.05, 113.05, '[]'::jsonb, $5)
           RETURNING id"#,
    )
    .bind(&second_quote_id)
    .bind(order_id)
    .bind(patient_id)
    .bind(format!("INV-{tag}-EXTRA"))
    .bind(admin_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    let over_allocation = sqlx::query(
        r#"INSERT INTO invoice_order_line_allocations (
               invoice_id, quote_id, quote_line_index, order_leistung_id, quantity,
               description_snapshot, unit_price_net_snapshot, vat_rate_snapshot,
               amount_net_snapshot, amount_vat_snapshot, amount_gross_snapshot
           ) VALUES ($1, $2::uuid, 0, $3, 1, 'Patientenbetreuung (Stunden)', 95, 19, 95, 18.05, 113.05)"#,
    )
    .bind(extra_invoice_id)
    .bind(&second_quote_id)
    .bind(hours_line)
    .execute(&pool)
    .await;
    assert!(
        over_allocation.is_err(),
        "an allocation beyond the delivered hours must be refused"
    );
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
    let invoice = create_sent_invoice(&app, &billing_bearer, quote_id, "final", "2026-05-31").await;
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
    let invoice = create_sent_invoice(&app, &billing_bearer, quote_id, "final", "2026-05-31").await;
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
// Invoices are issued without a separate accounting release: the order gate
// only steers other order operations.
async fn invoice_creation_does_not_wait_for_billing_release() {
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
    assert_eq!(status, StatusCode::CREATED, "{body}");
    assert_eq!(body["invoice_type"], "final");
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

    let (unreleased_status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/invoices/{invoice_id}/status"),
        &billing_bearer,
        Some(json!({ "status": "paid", "paid_amount": total_gross })),
    )
    .await;
    assert_eq!(unreleased_status, StatusCode::CONFLICT);
    release_invoice(&app, &billing_bearer, invoice_id).await;

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

    release_invoice(&app, &billing_bearer, invoice_id).await;
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
        Some(json!({ "status": "approved" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let provider_payment_account_id: Uuid = sqlx::query_scalar(
        "SELECT id FROM company_financial_accounts WHERE currency = 'EUR' AND is_default",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/company-provider-liabilities/{external_invoice_id}/settlements"),
        &billing_bearer,
        Some(json!({
            "request_id": Uuid::new_v4(),
            "financial_account_id": provider_payment_account_id,
            "amount_gross": "60.00",
            "paid_on": chrono::Utc::now().date_naive().to_string(),
            "payment_method": "bank_transfer",
            "reference": "Clinic bill settlement"
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

    let invoice =
        create_sent_invoice(&app, &billing_bearer, quote_id, "final", &invoice_due_date).await;
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
    let invoice = create_sent_invoice(&app, &billing_bearer, quote_id, "final", "2026-03-01").await;
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
    let invoice = create_sent_invoice(&app, &billing_bearer, quote_id, "final", "2026-03-01").await;
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
    let invoice = create_sent_invoice(&app, &billing_bearer, quote_id, "final", "2026-03-01").await;
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
    let invoice_first = create_sent_invoice(
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
    let invoice_second = create_sent_invoice(
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
    let invoice_collections = create_sent_invoice(
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
    let invoice = create_sent_invoice(&app, &billing_bearer, quote_id, "final", "2026-05-30").await;
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
    let disposition = headers
        .get("content-disposition")
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default();
    assert!(disposition.contains("RECHNUNG-"));
    assert!(disposition.contains(invoice_number));
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
    let invoice = create_sent_invoice(&app, &billing_bearer, quote_id, "final", "2026-05-30").await;
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
    let invoice = create_sent_invoice(&app, &billing_bearer, quote_id, "final", "2026-05-30").await;
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
