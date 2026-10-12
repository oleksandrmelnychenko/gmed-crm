//! The client's signature of an order covers the terms it was given for (QA
//! C3-01, 2026-10-12): staff changes of the services or the programme period
//! of a signed order need an explicit confirmation that resets the signature,
//! the order keeps the signed version, and an order document made before the
//! last change of the terms no longer records a signature. Synthetic data only
//! (Anna Muster, example.com).

mod support;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use serde_json::{Value, json};
use sqlx::PgPool;
use tower::ServiceExt;
use uuid::Uuid;

use gmed_server::auth::jwt;

const TEST_SECRET: &str = "test-secret-at-least-32-characters-long!!";

async fn test_context() -> Option<(axum::Router, PgPool, Uuid, String)> {
    let ctx = support::suite_context(TEST_SECRET).await?;
    let token = jwt::issue_access_token(TEST_SECRET, ctx.admin_id, "ceo", Uuid::new_v4()).ok()?;
    Some((ctx.app, ctx.pool, ctx.admin_id, format!("Bearer {token}")))
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
    let bytes = axum::body::to_bytes(response.into_body(), 4 * 1024 * 1024)
        .await
        .unwrap();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(json!(null)),
    )
}

/// `POST /documents/{id}/paper-signature` with the scan of the signed copy.
async fn sign_on_paper(app: &axum::Router, document_id: Uuid, bearer: &str) -> (StatusCode, Value) {
    let boundary = format!("----gmed-boundary-{}", Uuid::new_v4().simple());
    let mut body = Vec::new();
    body.extend_from_slice(format!("--{boundary}\r\n").as_bytes());
    body.extend_from_slice(
        b"Content-Disposition: form-data; name=\"file\"; filename=\"einzelauftrag-signed.pdf\"\r\nContent-Type: application/pdf\r\n\r\n",
    );
    body.extend_from_slice(b"%PDF-1.4 signed order scan");
    body.extend_from_slice(b"\r\n");
    body.extend_from_slice(format!("--{boundary}--\r\n").as_bytes());
    let request = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/documents/{document_id}/paper-signature"))
        .header("Authorization", bearer)
        .header(
            "Content-Type",
            format!("multipart/form-data; boundary={boundary}"),
        )
        .body(Body::from(body))
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

async fn seed_patient(pool: &PgPool, created_by: Uuid) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO patients (patient_id, first_name, last_name, birth_date, gender, email, created_by)
           VALUES ($1, 'Anna', 'Muster', '1985-05-15', 'female', $2, $3)
           RETURNING id"#,
    )
    .bind(format!("P-TERMS-{}", Uuid::new_v4().simple()))
    .bind(format!("anna-{}@example.com", Uuid::new_v4().simple()))
    .bind(created_by)
    .fetch_one(pool)
    .await
    .unwrap()
}

/// An Einzelauftrag GMED generated for the order, not signed yet.
async fn seed_order_document(pool: &PgPool, patient_id: Uuid, order_id: Uuid, by: Uuid) -> Uuid {
    let document_id = Uuid::new_v4();
    sqlx::query(
        r#"INSERT INTO documents (
               id, patient_id, order_id, auto_name, original_filename, art, category, status,
               visibility, is_medical, mime_type, generated_template_id, ursprung,
               version_root_document_id, version_number, uploaded_by
           ) VALUES (
               $1, $2, $3, 'Einzelauftrag', 'einzelauftrag.pdf', 'single_order',
               'administrative_single_order', 'draft', 'patient_visible', false,
               'application/pdf', 'single_order', 'template:single_order', $1, 1, $4
           )"#,
    )
    .bind(document_id)
    .bind(patient_id)
    .bind(order_id)
    .bind(by)
    .execute(pool)
    .await
    .unwrap();
    document_id
}

async fn order_signatures(pool: &PgPool, order_id: Uuid) -> (bool, bool) {
    sqlx::query_as("SELECT signed_patient, signed_agency FROM orders WHERE id = $1")
        .bind(order_id)
        .fetch_one(pool)
        .await
        .unwrap()
}

async fn create_order_with_interpreter_hours(
    app: &axum::Router,
    bearer: &str,
    patient_id: Uuid,
) -> Uuid {
    let (status, order) = json_request(
        app,
        "POST",
        "/api/v1/orders",
        bearer,
        Some(json!({
            "patient_id": patient_id,
            "needs_description": "Kardiologische Abklärung",
            "date_from": "2026-10-25",
            "date_to": "2026-10-30",
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{order}");
    let order_id = Uuid::parse_str(order["id"].as_str().unwrap()).unwrap();
    let (status, line) = add_interpreter_hours(app, bearer, order_id, 3.0, false).await;
    assert_eq!(status, StatusCode::CREATED, "{line}");
    order_id
}

/// 95,00 € per hour at 19 % VAT, upserted by its client reference.
async fn add_interpreter_hours(
    app: &axum::Router,
    bearer: &str,
    order_id: Uuid,
    hours: f64,
    confirm: bool,
) -> (StatusCode, Value) {
    json_request(
        app,
        "POST",
        &format!("/api/v1/orders/{order_id}/leistungen"),
        bearer,
        Some(json!({
            "description": "Dolmetscherbetreuung",
            "quantity": hours,
            "unit_price": 95.0,
            "vat_rate": 19.0,
            "client_reference": "terms-test:interpreter",
            "confirm_signature_reset": confirm,
        })),
    )
    .await
}

#[tokio::test]
async fn changing_the_services_of_a_signed_order_needs_a_confirmed_signature_reset() {
    let Some((app, pool, admin_id, ceo)) = test_context().await else {
        return;
    };
    let patient_id = seed_patient(&pool, admin_id).await;
    let order_id = create_order_with_interpreter_hours(&app, &ceo, patient_id).await;

    // A version generated before the client signed and one signed on paper.
    let stale_unsigned = seed_order_document(&pool, patient_id, order_id, admin_id).await;
    let signed_version = seed_order_document(&pool, patient_id, order_id, admin_id).await;
    let (status, signed) = sign_on_paper(&app, signed_version, &ceo).await;
    assert_eq!(status, StatusCode::OK, "{signed}");
    assert_eq!(order_signatures(&pool, order_id).await, (true, true));

    let (status, order) = json_request(
        &app,
        "GET",
        &format!("/api/v1/orders/{order_id}"),
        &ceo,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{order}");
    assert_eq!(order["client_signature"]["signed_total"], "339.15");
    assert_eq!(order["client_signature"]["changes_await_signature"], false);

    // Re-sending the signed terms changes nothing and keeps the signature.
    let (status, replay) = add_interpreter_hours(&app, &ceo, order_id, 3.0, false).await;
    assert_eq!(status, StatusCode::OK, "{replay}");
    assert_eq!(replay["signature_reset"], false);
    assert_eq!(order_signatures(&pool, order_id).await, (true, true));

    // 3 h → 4 h without the confirmation: refused, nothing written.
    let (status, refused) = add_interpreter_hours(&app, &ceo, order_id, 4.0, false).await;
    assert_eq!(status, StatusCode::CONFLICT, "{refused}");
    assert_eq!(refused["error"], "order_signed_terms_change");
    assert_eq!(refused["signed_total_label"], "339,15 €");
    assert_eq!(refused["new_total_label"], "452,20 €");
    let quantity: rust_decimal::Decimal = sqlx::query_scalar(
        "SELECT quantity FROM order_leistungen WHERE order_id = $1 AND client_reference = 'terms-test:interpreter'",
    )
    .bind(order_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(quantity, rust_decimal::Decimal::from(3));
    assert_eq!(order_signatures(&pool, order_id).await, (true, true));

    // A new service is refused the same way.
    let (status, refused) = json_request(
        &app,
        "POST",
        &format!("/api/v1/orders/{order_id}/leistungen"),
        &ceo,
        Some(json!({
            "description": "Flughafentransfer",
            "quantity": 1.0,
            "unit_price": 120.0,
            "vat_rate": 19.0,
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{refused}");
    assert_eq!(refused["error"], "order_signed_terms_change");

    // Confirmed: the change is saved and the order signatures are reset.
    let (status, changed) = add_interpreter_hours(&app, &ceo, order_id, 4.0, true).await;
    assert_eq!(status, StatusCode::OK, "{changed}");
    assert_eq!(changed["signature_reset"], true);
    assert_eq!(order_signatures(&pool, order_id).await, (false, false));
    let resets: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM audit_log WHERE action = 'reset_order_client_signature' AND entity_id = $1",
    )
    .bind(order_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(resets, 1);

    let (status, order) = json_request(
        &app,
        "GET",
        &format!("/api/v1/orders/{order_id}"),
        &ceo,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{order}");
    assert_eq!(order["signed_patient"], false);
    assert_eq!(order["client_signature"]["signed_total"], "339.15");
    assert_eq!(order["client_signature"]["changes_await_signature"], true);
    assert!(order["client_signature"]["terms_changed_at"].is_string());

    // A further change of an unsigned order needs no confirmation.
    let (status, unsigned_change) = add_interpreter_hours(&app, &ceo, order_id, 5.0, false).await;
    assert_eq!(status, StatusCode::OK, "{unsigned_change}");
    assert_eq!(unsigned_change["signature_reset"], false);
    let (status, _) = add_interpreter_hours(&app, &ceo, order_id, 4.0, false).await;
    assert_eq!(status, StatusCode::OK);

    // The version made before the change shows the old terms: it cannot be
    // signed any more; a version made now can.
    let (status, outdated) = sign_on_paper(&app, stale_unsigned, &ceo).await;
    assert_eq!(status, StatusCode::CONFLICT, "{outdated}");
    assert_eq!(outdated["error"], "order_document_outdated");
    assert_eq!(order_signatures(&pool, order_id).await, (false, false));

    let current = seed_order_document(&pool, patient_id, order_id, admin_id).await;
    let (status, signed_again) = sign_on_paper(&app, current, &ceo).await;
    assert_eq!(status, StatusCode::OK, "{signed_again}");
    assert_eq!(order_signatures(&pool, order_id).await, (true, true));
    let (status, order) = json_request(
        &app,
        "GET",
        &format!("/api/v1/orders/{order_id}"),
        &ceo,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{order}");
    assert_eq!(order["client_signature"]["signed_total"], "452.2");
    assert_eq!(order["client_signature"]["changes_await_signature"], false);
}

#[tokio::test]
async fn moving_the_period_of_a_signed_order_needs_a_confirmed_signature_reset() {
    let Some((app, pool, admin_id, ceo)) = test_context().await else {
        return;
    };
    let patient_id = seed_patient(&pool, admin_id).await;
    let order_id = create_order_with_interpreter_hours(&app, &ceo, patient_id).await;
    let document = seed_order_document(&pool, patient_id, order_id, admin_id).await;
    let (status, signed) = sign_on_paper(&app, document, &ceo).await;
    assert_eq!(status, StatusCode::OK, "{signed}");

    // Other commercial fields (the needs text) keep the signature.
    let (status, unchanged) = json_request(
        &app,
        "POST",
        &format!("/api/v1/orders/{order_id}/commercial-basis"),
        &ceo,
        Some(json!({ "needs_description": "Kardiologische Abklärung, Rückfragen per E-Mail" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{unchanged}");
    assert_eq!(unchanged["signed_patient"], true);
    assert_eq!(unchanged["signature_reset"], false);

    let (status, refused) = json_request(
        &app,
        "POST",
        &format!("/api/v1/orders/{order_id}/commercial-basis"),
        &ceo,
        Some(json!({ "date_from": "2026-10-21", "date_to": "2026-10-25" })),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{refused}");
    assert_eq!(refused["error"], "order_signed_terms_change");
    let period: (Option<chrono::NaiveDate>, Option<chrono::NaiveDate>) =
        sqlx::query_as("SELECT date_from, date_to FROM orders WHERE id = $1")
            .bind(order_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(
        period,
        (
            chrono::NaiveDate::from_ymd_opt(2026, 10, 25),
            chrono::NaiveDate::from_ymd_opt(2026, 10, 30)
        )
    );

    let (status, moved) = json_request(
        &app,
        "POST",
        &format!("/api/v1/orders/{order_id}/commercial-basis"),
        &ceo,
        Some(json!({
            "date_from": "2026-10-21",
            "date_to": "2026-10-25",
            "confirm_signature_reset": true,
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{moved}");
    assert_eq!(moved["signature_reset"], true);
    assert_eq!(moved["signed_patient"], false);
    assert_eq!(moved["date_from"], "2026-10-21");
    assert_eq!(order_signatures(&pool, order_id).await, (false, false));
}
