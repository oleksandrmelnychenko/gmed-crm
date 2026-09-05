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

fn auth_header_for(user_id: Uuid, role: &str) -> String {
    let token = jwt::issue_access_token(TEST_SECRET, user_id, role, Uuid::new_v4()).unwrap();
    format!("Bearer {token}")
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

async fn seed_lead(pool: &PgPool, created_by: Uuid, tag: &str) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO leads (
                first_name, last_name, email, phone, qualification_status,
                compliance_status, intake_source, created_by
           ) VALUES (
                $1, $2, $3, '+4915112345678', 'qualified', 'signed', 'console', $4
           ) RETURNING id"#,
    )
    .bind(format!("Lead {tag}"))
    .bind("Onboarding")
    .bind(format!("lead-{tag}@example.com"))
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

async fn seed_provider(pool: &PgPool, tag: &str) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO providers (name, provider_type, address_city, fachbereich, address_country)
           VALUES ($1, 'medical', 'Berlin', 'Cardiology', 'Germany')
           RETURNING id"#,
    )
    .bind(format!("Clinic {tag}"))
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn seed_doctor(pool: &PgPool, provider_id: Uuid, tag: &str) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO provider_doctors (provider_id, name, fachbereich)
           VALUES ($1, $2, 'Cardiology')
           RETURNING id"#,
    )
    .bind(provider_id)
    .bind(format!("Doctor {tag}"))
    .fetch_one(pool)
    .await
    .unwrap()
}

#[tokio::test]
async fn framework_contract_create_list_and_sign_flow_work() {
    let Some((app, pool, admin_id, _)) = test_context().await else {
        return;
    };

    let tag = unique_tag("framework-contract");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let pm_id = seed_user(&pool, &tag, "patient_manager").await;
    let billing_id = seed_user(&pool, &tag, "billing").await;

    seed_patient_assignment(&pool, patient_id, pm_id, admin_id).await;

    let pm_bearer = auth_header_for(pm_id, "patient_manager");
    let billing_bearer = auth_header_for(billing_id, "billing");

    let (status, body) = json_request(
        &app,
        "POST",
        "/api/v1/framework-contracts",
        &pm_bearer,
        Some(json!({
            "patient_id": patient_id,
            "status": "sent",
            "valid_from": "2026-04-01",
            "valid_to": "2026-12-31",
            "conditions": {
                "language": "de",
                "jurisdiction": "DE"
            }
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let contract_id = body["id"].as_str().unwrap().to_string();
    assert!(body["contract_number"].as_str().unwrap().starts_with("FC-"));

    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/framework-contracts?patient_id={patient_id}&status=sent"),
        &billing_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let items = body.as_array().unwrap();
    assert_eq!(items.len(), 1);
    assert_eq!(items[0]["id"], contract_id);

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/framework-contracts/{contract_id}/status"),
        &billing_bearer,
        Some(json!({
            "status": "signed"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["status"], "signed");
    assert!(body["signed_at"].as_str().is_some());

    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/framework-contracts/{contract_id}"),
        &pm_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["patient_id"], patient_id.to_string());
    assert_eq!(body["status"], "signed");
}

#[tokio::test]
async fn framework_contract_can_be_completed_for_lead_without_creating_patient() {
    let Some((app, pool, admin_id, _)) = test_context().await else {
        return;
    };

    let tag = unique_tag("lead-framework-contract");
    let lead_id = seed_lead(&pool, admin_id, &tag).await;
    let pm_id = seed_user(&pool, &tag, "patient_manager").await;
    let pm_bearer = auth_header_for(pm_id, "patient_manager");
    let client_reference = format!("lead-onboarding:{lead_id}:framework");

    let (status, created) = json_request(
        &app,
        "POST",
        "/api/v1/framework-contracts",
        &pm_bearer,
        Some(json!({
            "lead_id": lead_id,
            "status": "sent",
            "client_reference": client_reference,
            "valid_from": "2026-07-10"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "response: {created}");
    let contract_id = created["id"].as_str().expect("contract id");
    assert_eq!(created["lead_id"], lead_id.to_string());
    assert!(created["patient_id"].is_null());

    let (status, replayed) = json_request(
        &app,
        "POST",
        "/api/v1/framework-contracts",
        &pm_bearer,
        Some(json!({
            "lead_id": lead_id,
            "status": "sent",
            "client_reference": client_reference
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "response: {replayed}");
    assert_eq!(replayed["id"], contract_id);
    assert_eq!(replayed["idempotent_replay"], true);

    let (status, listed) = json_request(
        &app,
        "GET",
        &format!("/api/v1/framework-contracts?lead_id={lead_id}"),
        &pm_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "response: {listed}");
    assert_eq!(listed.as_array().expect("contracts").len(), 1);
    assert_eq!(listed[0]["lead_id"], lead_id.to_string());

    let (status, signed) = json_request(
        &app,
        "POST",
        &format!("/api/v1/framework-contracts/{contract_id}/status"),
        &pm_bearer,
        Some(json!({ "status": "signed" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "response: {signed}");
    assert_eq!(signed["status"], "signed");
    assert_eq!(signed["lead_id"], lead_id.to_string());

    let patient_count: i64 = sqlx::query_scalar("SELECT count(*) FROM patients WHERE email = $1")
        .bind(format!("lead-{tag}@example.com"))
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(patient_count, 0);
}

#[tokio::test]
async fn lead_order_and_service_are_idempotent_without_creating_patient() {
    let Some((app, pool, admin_id, _)) = test_context().await else {
        return;
    };

    let tag = unique_tag("lead-order");
    let lead_id = seed_lead(&pool, admin_id, &tag).await;
    let pm_id = seed_user(&pool, &tag, "patient_manager").await;
    let pm_bearer = auth_header_for(pm_id, "patient_manager");

    let (status, contract) = json_request(
        &app,
        "POST",
        "/api/v1/framework-contracts",
        &pm_bearer,
        Some(json!({
            "lead_id": lead_id,
            "status": "signed",
            "client_reference": format!("lead-onboarding:{lead_id}:framework")
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "response: {contract}");
    let contract_id = contract["id"].as_str().expect("contract id");

    let order_payload = json!({
        "source_lead_id": lead_id,
        "contract_id": contract_id,
        "needs_description": "Coordinate orthopedic assessment"
    });
    let (status, created) = json_request(
        &app,
        "POST",
        "/api/v1/orders",
        &pm_bearer,
        Some(order_payload.clone()),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "response: {created}");
    let order_id = created["id"].as_str().expect("order id");
    assert_eq!(created["lead_id"], lead_id.to_string());
    assert!(created["patient_id"].is_null());

    let (status, replayed) = json_request(
        &app,
        "POST",
        "/api/v1/orders",
        &pm_bearer,
        Some(order_payload),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "response: {replayed}");
    assert_eq!(replayed["id"], order_id);
    assert_eq!(replayed["idempotent_replay"], true);

    let (status, service) = json_request(
        &app,
        "POST",
        &format!("/api/v1/orders/{order_id}/leistungen"),
        &pm_bearer,
        Some(json!({
            "description": "Organisation der Behandlung",
            "quantity": 1.0,
            "unit_price": 250.0,
            "client_reference": format!("lead-onboarding:{lead_id}:service:1")
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "response: {service}");

    let (status, order_detail) = json_request(
        &app,
        "GET",
        &format!("/api/v1/orders/{order_id}"),
        &pm_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "response: {order_detail}");
    assert_eq!(order_detail["lead_id"], lead_id.to_string());
    assert_eq!(order_detail["source_lead_id"], lead_id.to_string());
    assert_eq!(order_detail["contract_id"], contract_id);
    assert!(order_detail["patient_id"].is_null());
    assert_eq!(
        order_detail["patient_name"],
        format!("Lead {tag} Onboarding")
    );
    assert_eq!(
        order_detail["leistungen"]
            .as_array()
            .expect("order services")
            .len(),
        1
    );
    assert_eq!(
        order_detail["leistungen"][0]["description"],
        "Organisation der Behandlung"
    );

    let (status, workflow) = json_request(
        &app,
        "GET",
        &format!("/api/v1/orders/{order_id}/workflow-checklist"),
        &pm_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "response: {workflow}");
    assert_eq!(workflow["blocked_reason"], "patient_required");
    assert_eq!(workflow["open_count"], 0);
    assert_eq!(workflow["items"], json!([]));

    let (status, group) = json_request(
        &app,
        "GET",
        &format!("/api/v1/orders/{order_id}/group"),
        &pm_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "response: {group}");
    assert!(group["head"]["patient_id"].is_null());
    assert_eq!(group["covered_patient_ids"], json!([]));

    let (status, amendments) = json_request(
        &app,
        "GET",
        &format!("/api/v1/orders/{order_id}/amendments"),
        &pm_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "response: {amendments}");
    assert_eq!(amendments, json!([]));

    let (status, service_groups) = json_request(
        &app,
        "GET",
        &format!("/api/v1/orders/{order_id}/service-groups"),
        &pm_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "response: {service_groups}");
    assert_eq!(service_groups, json!([]));

    let (status, phase_error) = json_request(
        &app,
        "POST",
        &format!("/api/v1/orders/{order_id}/phase"),
        &pm_bearer,
        Some(json!({ "phase": "planning" })),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::UNPROCESSABLE_ENTITY,
        "response: {phase_error}"
    );

    let (status, quote) = json_request(
        &app,
        "POST",
        &format!("/api/v1/orders/{order_id}/quotes"),
        &pm_bearer,
        Some(json!({ "valid_until": "2026-12-31" })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "response: {quote}");
    let quote_id = quote["id"].as_str().expect("quote id");
    assert_eq!(quote["lead_id"], lead_id.to_string());
    assert!(quote["patient_id"].is_null());
    assert_eq!(quote["total_gross"], "297.5");

    let (status, accepted) = json_request(
        &app,
        "POST",
        &format!("/api/v1/quotes/{quote_id}/status"),
        &pm_bearer,
        Some(json!({
            "status": "accepted",
            "paid_amount": 297.5
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "response: {accepted}");
    assert_eq!(accepted["status"], "accepted");

    let (status, quote_detail) = json_request(
        &app,
        "GET",
        &format!("/api/v1/quotes/{quote_id}"),
        &pm_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "response: {quote_detail}");
    assert_eq!(quote_detail["lead_id"], lead_id.to_string());
    assert!(quote_detail["patient_id"].is_null());

    let (status, quotes) = json_request(
        &app,
        "GET",
        &format!("/api/v1/quotes?lead_id={lead_id}"),
        &pm_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "response: {quotes}");
    assert_eq!(quotes.as_array().expect("quotes").len(), 1);
    assert_eq!(quotes[0]["lead_id"], lead_id.to_string());

    let (status, commercial) = json_request(
        &app,
        "POST",
        &format!("/api/v1/orders/{order_id}/commercial-basis"),
        &pm_bearer,
        Some(json!({
            "contract_id": contract_id,
            "signed_patient": true,
            "signed_agency": true,
            "prepayment_required": true,
            "needs_description": "Driver: airport pickup at 14:30"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "response: {commercial}");
    assert_eq!(commercial["lead_id"], lead_id.to_string());
    assert_eq!(commercial["signed_patient"], true);
    assert_eq!(commercial["signed_agency"], true);
    assert_eq!(commercial["prepayment_required"], true);
    assert!(commercial["signed_patient_at"].as_str().is_some());
    assert!(commercial["signed_agency_at"].as_str().is_some());
    assert!(commercial["signed_at"].as_str().is_some());

    let needs_description: Option<String> =
        sqlx::query_scalar("SELECT needs_description FROM orders WHERE id = $1")
            .bind(Uuid::parse_str(order_id).unwrap())
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(
        needs_description.as_deref(),
        Some("Driver: airport pickup at 14:30")
    );

    let (status, orders) = json_request(
        &app,
        "GET",
        &format!("/api/v1/orders?lead_id={lead_id}"),
        &pm_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "response: {orders}");
    assert_eq!(orders.as_array().expect("orders").len(), 1);
    assert_eq!(orders[0]["lead_id"], lead_id.to_string());
    assert!(orders[0]["patient_id"].is_null());

    let (order_patient_id, service_patient_id): (Option<Uuid>, Option<Uuid>) = sqlx::query_as(
        r#"SELECT o.patient_id, ol.patient_id
           FROM orders o
           JOIN order_leistungen ol ON ol.order_id = o.id
           WHERE o.id = $1"#,
    )
    .bind(Uuid::parse_str(order_id).unwrap())
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(order_patient_id.is_none());
    assert!(service_patient_id.is_none());

    let patient_count: i64 = sqlx::query_scalar("SELECT count(*) FROM patients WHERE email = $1")
        .bind(format!("lead-{tag}@example.com"))
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(patient_count, 0);
}

#[tokio::test]
async fn framework_contract_create_returns_user_facing_patient_validation_errors() {
    let Some((app, _pool, _admin_id, admin_bearer)) = test_context().await else {
        return;
    };

    let (status, body) = json_request(
        &app,
        "POST",
        "/api/v1/framework-contracts",
        &admin_bearer,
        Some(json!({
            "status": "sent",
            "valid_from": "2026-04-01"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(body["message"], "Patient or lead is required");

    let (status, body) = json_request(
        &app,
        "POST",
        "/api/v1/framework-contracts",
        &admin_bearer,
        Some(json!({
            "patient_id": "",
            "status": "sent",
            "valid_from": "2026-04-01"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(body["message"], "Patient or lead is required");

    let (status, body) = json_request(
        &app,
        "POST",
        "/api/v1/framework-contracts",
        &admin_bearer,
        Some(json!({
            "patient_id": "not-a-uuid",
            "status": "sent",
            "valid_from": "2026-04-01"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(body["message"], "Invalid patient");
}

#[tokio::test]
async fn create_order_rejects_contract_from_other_patient() {
    let Some((app, pool, admin_id, _)) = test_context().await else {
        return;
    };

    let tag = unique_tag("order-contract-mismatch");
    let patient_id = seed_patient(&pool, admin_id, &format!("{tag}-target")).await;
    let other_patient_id = seed_patient(&pool, admin_id, &format!("{tag}-other")).await;
    let pm_id = seed_user(&pool, &tag, "patient_manager").await;
    seed_patient_assignment(&pool, patient_id, pm_id, admin_id).await;
    seed_patient_assignment(&pool, other_patient_id, pm_id, admin_id).await;

    let contract_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO framework_contracts (
                patient_id, contract_number, status, created_by
           ) VALUES (
                $1, $2, 'signed', $3
           ) RETURNING id"#,
    )
    .bind(other_patient_id)
    .bind(format!("FC-MISMATCH-{tag}"))
    .bind(admin_id)
    .fetch_one(&pool)
    .await
    .unwrap();

    let pm_bearer = auth_header_for(pm_id, "patient_manager");

    let (status, body) = json_request(
        &app,
        "POST",
        "/api/v1/orders",
        &pm_bearer,
        Some(json!({
            "patient_id": patient_id,
            "contract_id": contract_id,
            "needs_description": "Mismatch should fail"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(
        body["message"],
        "Framework contract does not belong to patient"
    );
}

#[tokio::test]
async fn quote_creation_from_order_services_computes_totals_and_updates_order() {
    let Some((app, pool, admin_id, _)) = test_context().await else {
        return;
    };

    let tag = unique_tag("quote-create");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let pm_id = seed_user(&pool, &tag, "patient_manager").await;
    let billing_id = seed_user(&pool, &tag, "billing").await;
    let provider_id = seed_provider(&pool, &tag).await;
    let doctor_id = seed_doctor(&pool, provider_id, &tag).await;

    seed_patient_assignment(&pool, patient_id, pm_id, admin_id).await;

    let pm_bearer = auth_header_for(pm_id, "patient_manager");
    let billing_bearer = auth_header_for(billing_id, "billing");

    let (status, body) = json_request(
        &app,
        "POST",
        "/api/v1/orders",
        &pm_bearer,
        Some(json!({
            "patient_id": patient_id,
            "needs_description": "Structured quote creation"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let order_id = body["id"].as_str().unwrap().to_string();

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/orders/{order_id}/leistungen"),
        &pm_bearer,
        Some(json!({
            "description": "Organisation der Behandlung",
            "quantity": 2.0,
            "unit_price": 150.0,
            "provider_id": provider_id,
            "doctor_id": doctor_id
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/orders/{order_id}/leistungen"),
        &pm_bearer,
        Some(json!({
            "description": "Clinic invoice passthrough",
            "quantity": 1.0,
            "unit_price": 480.0,
            "vat_rate": 0.0,
            "is_cost_passthrough": true,
            "provider_id": provider_id,
            "doctor_id": doctor_id
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/orders/{order_id}/quotes"),
        &billing_bearer,
        Some(json!({
            "valid_until": "2026-05-15",
            "notes": "Source-derived quote"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let quote_id = body["id"].as_str().unwrap().to_string();
    assert!(body["quote_number"].as_str().unwrap().starts_with("KV-"));
    assert_eq!(body["total_net"], "780");
    assert_eq!(body["total_vat"], "57");
    assert_eq!(body["total_gross"], "837");
    assert_eq!(body["line_items"].as_array().unwrap().len(), 2);

    let order_total: String =
        sqlx::query_scalar("SELECT total_estimated::text FROM orders WHERE id = $1")
            .bind(Uuid::parse_str(&order_id).unwrap())
            .fetch_one(&pool)
            .await
            .unwrap();
    assert!(order_total == "837" || order_total == "837.0" || order_total == "837.00");

    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/quotes?patient_id={patient_id}&status=draft"),
        &billing_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let items = body.as_array().unwrap();
    assert_eq!(items.len(), 1);
    assert_eq!(items[0]["id"], quote_id);

    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/quotes/{quote_id}"),
        &pm_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["order_id"], order_id);
    assert_eq!(body["patient_id"], patient_id.to_string());
}

#[tokio::test]
async fn billing_can_update_quote_status_and_payment_but_interpreter_cannot_access_quote() {
    let Some((app, pool, admin_id, _)) = test_context().await else {
        return;
    };

    let tag = unique_tag("quote-payment");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let pm_id = seed_user(&pool, &tag, "patient_manager").await;
    let billing_id = seed_user(&pool, &tag, "billing").await;
    let interpreter_id = seed_user(&pool, &tag, "interpreter").await;
    let provider_id = seed_provider(&pool, &tag).await;
    let doctor_id = seed_doctor(&pool, provider_id, &tag).await;

    seed_patient_assignment(&pool, patient_id, pm_id, admin_id).await;

    let pm_bearer = auth_header_for(pm_id, "patient_manager");
    let billing_bearer = auth_header_for(billing_id, "billing");
    let interpreter_bearer = auth_header_for(interpreter_id, "interpreter");

    let (status, body) = json_request(
        &app,
        "POST",
        "/api/v1/orders",
        &pm_bearer,
        Some(json!({
            "patient_id": patient_id,
            "needs_description": "Quote payment state"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let order_id = body["id"].as_str().unwrap().to_string();

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/orders/{order_id}/leistungen"),
        &pm_bearer,
        Some(json!({
            "description": "Single service",
            "quantity": 1.0,
            "unit_price": 100.0,
            "provider_id": provider_id,
            "doctor_id": doctor_id
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/orders/{order_id}/quotes"),
        &pm_bearer,
        Some(json!({})),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let quote_id = body["id"].as_str().unwrap().to_string();

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/quotes/{quote_id}/status"),
        &billing_bearer,
        Some(json!({
            "status": "accepted",
            "paid_amount": 119.0,
            "notes": "Advance payment received"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["status"], "accepted");
    assert_eq!(body["paid_amount"], "119");
    assert!(body["paid_at"].as_str().is_some());

    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/quotes/{quote_id}"),
        &interpreter_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert!(body["message"].as_str().is_some());
}

#[tokio::test]
async fn quote_commercial_invariants_use_persisted_order_lines() {
    let Some((app, pool, admin_id, _)) = test_context().await else {
        return;
    };

    let tag = unique_tag("quote-invariants");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let pm_id = seed_user(&pool, &tag, "patient_manager").await;
    seed_patient_assignment(&pool, patient_id, pm_id, admin_id).await;
    let pm_bearer = auth_header_for(pm_id, "patient_manager");

    let (status, order) = json_request(
        &app,
        "POST",
        "/api/v1/orders",
        &pm_bearer,
        Some(json!({
            "patient_id": patient_id,
            "needs_description": "Persisted quote invariant"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "response: {order}");
    let order_id = order["id"].as_str().unwrap();
    let client_reference = format!("lead-wizard:{tag}:service:1");

    let (status, service) = json_request(
        &app,
        "POST",
        &format!("/api/v1/orders/{order_id}/leistungen"),
        &pm_bearer,
        Some(json!({
            "description": "Persisted service",
            "quantity": 1.0,
            "unit_price": 100.0,
            "vat_rate": 19.0,
            "client_reference": client_reference
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "response: {service}");
    let service_id = service["id"].as_str().unwrap();

    let (status, order_detail) = json_request(
        &app,
        "GET",
        &format!("/api/v1/orders/{order_id}"),
        &pm_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "response: {order_detail}");
    assert_eq!(
        order_detail["leistungen"][0]["client_reference"],
        client_reference
    );

    let (status, stale_custom_quote) = json_request(
        &app,
        "POST",
        &format!("/api/v1/orders/{order_id}/quotes"),
        &pm_bearer,
        Some(json!({
            "line_items": [{
                "description": "Persisted service",
                "quantity": 1.0,
                "unit_price": 99.0,
                "vat_rate": 19.0
            }]
        })),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::CONFLICT,
        "response: {stale_custom_quote}"
    );

    let (status, quote) = json_request(
        &app,
        "POST",
        &format!("/api/v1/orders/{order_id}/quotes"),
        &pm_bearer,
        Some(json!({})),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "response: {quote}");
    assert_eq!(quote["total_gross"], "119");
    let quote_id = quote["id"].as_str().unwrap();

    let (status, excessive_prepayment) = json_request(
        &app,
        "POST",
        &format!("/api/v1/orders/{order_id}/commercial-basis"),
        &pm_bearer,
        Some(json!({
            "prepayment_required": true,
            "prepayment_amount": "120"
        })),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::UNPROCESSABLE_ENTITY,
        "response: {excessive_prepayment}"
    );

    let (status, excessive_payment) = json_request(
        &app,
        "POST",
        &format!("/api/v1/quotes/{quote_id}/status"),
        &pm_bearer,
        Some(json!({
            "status": "accepted",
            "paid_amount": 120.0
        })),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::UNPROCESSABLE_ENTITY,
        "response: {excessive_payment}"
    );

    sqlx::query("UPDATE order_leistungen SET unit_price = 110 WHERE id = $1")
        .bind(Uuid::parse_str(service_id).unwrap())
        .execute(&pool)
        .await
        .unwrap();

    let (status, stale_acceptance) = json_request(
        &app,
        "POST",
        &format!("/api/v1/quotes/{quote_id}/status"),
        &pm_bearer,
        Some(json!({
            "status": "accepted",
            "paid_amount": 100.0
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "response: {stale_acceptance}");
}

#[tokio::test]
async fn quote_versions_capture_initial_and_status_update_snapshots() {
    let Some((app, pool, admin_id, _)) = test_context().await else {
        return;
    };

    let tag = unique_tag("quote-versions");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let pm_id = seed_user(&pool, &tag, "patient_manager").await;
    let billing_id = seed_user(&pool, &tag, "billing").await;
    let provider_id = seed_provider(&pool, &tag).await;
    let doctor_id = seed_doctor(&pool, provider_id, &tag).await;

    seed_patient_assignment(&pool, patient_id, pm_id, admin_id).await;

    let pm_bearer = auth_header_for(pm_id, "patient_manager");
    let billing_bearer = auth_header_for(billing_id, "billing");

    let (status, body) = json_request(
        &app,
        "POST",
        "/api/v1/orders",
        &pm_bearer,
        Some(json!({
            "patient_id": patient_id,
            "needs_description": "Quote version trail"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let order_id = body["id"].as_str().unwrap().to_string();

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/orders/{order_id}/leistungen"),
        &pm_bearer,
        Some(json!({
            "description": "Versioned service",
            "quantity": 1.0,
            "unit_price": 100.0,
            "provider_id": provider_id,
            "doctor_id": doctor_id
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/orders/{order_id}/quotes"),
        &billing_bearer,
        Some(json!({
            "valid_until": "2026-05-15",
            "notes": "Initial commercial snapshot"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let quote_id = body["id"].as_str().unwrap().to_string();
    assert_eq!(body["version_count"], 1);
    assert_eq!(body["current_version_number"], 1);

    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/quotes/{quote_id}/versions"),
        &billing_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let versions = body.as_array().unwrap();
    assert_eq!(versions.len(), 1);
    assert_eq!(versions[0]["version_number"], 1);
    assert_eq!(versions[0]["change_reason"], "initial_snapshot");
    assert_eq!(versions[0]["status"], "draft");

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/quotes/{quote_id}/status"),
        &billing_bearer,
        Some(json!({
            "status": "accepted",
            "paid_amount": 119.0,
            "notes": "Snapshot moved to accepted"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["current_version_number"], 2);
    assert_eq!(body["version_count"], 2);

    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/quotes/{quote_id}/versions"),
        &pm_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let versions = body.as_array().unwrap();
    assert_eq!(versions.len(), 2);
    assert_eq!(versions[0]["version_number"], 2);
    assert_eq!(versions[0]["change_reason"], "status_update");
    assert_eq!(versions[0]["status"], "accepted");
    assert_eq!(versions[0]["paid_amount"], "119");
    assert_eq!(versions[1]["version_number"], 1);

    let stored_version_count: i64 =
        sqlx::query_scalar("SELECT count(*)::bigint FROM quote_versions WHERE quote_id = $1")
            .bind(Uuid::parse_str(&quote_id).unwrap())
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(stored_version_count, 2);
}

#[tokio::test]
async fn ceo_can_manage_contracts_and_quotes_without_patient_assignment() {
    let Some((app, pool, admin_id, _)) = test_context().await else {
        return;
    };

    let tag = unique_tag("ceo-contracts");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let pm_id = seed_user(&pool, &tag, "patient_manager").await;
    let provider_id = seed_provider(&pool, &tag).await;
    let doctor_id = seed_doctor(&pool, provider_id, &tag).await;

    seed_patient_assignment(&pool, patient_id, pm_id, admin_id).await;

    let ceo_bearer = auth_header_for(admin_id, "ceo");
    let pm_bearer = auth_header_for(pm_id, "patient_manager");

    let (status, body) = json_request(
        &app,
        "POST",
        "/api/v1/orders",
        &pm_bearer,
        Some(json!({
            "patient_id": patient_id,
            "needs_description": "CEO quote workspace"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let order_id = body["id"].as_str().unwrap().to_string();

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/orders/{order_id}/leistungen"),
        &pm_bearer,
        Some(json!({
            "description": "CEO-managed service",
            "quantity": 1.0,
            "unit_price": 210.0,
            "provider_id": provider_id,
            "doctor_id": doctor_id
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);

    let (status, body) = json_request(
        &app,
        "POST",
        "/api/v1/framework-contracts",
        &ceo_bearer,
        Some(json!({
            "patient_id": patient_id,
            "status": "sent",
            "valid_from": "2026-05-01",
            "valid_to": "2026-12-31"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let contract_id = body["id"].as_str().unwrap().to_string();

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/framework-contracts/{contract_id}/status"),
        &ceo_bearer,
        Some(json!({
            "status": "signed"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["status"], "signed");

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/orders/{order_id}/quotes"),
        &ceo_bearer,
        Some(json!({
            "valid_until": "2026-05-31",
            "notes": "CEO-created quote"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let quote_id = body["id"].as_str().unwrap().to_string();

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/quotes/{quote_id}/status"),
        &ceo_bearer,
        Some(json!({
            "status": "sent",
            "notes": "CEO approved for sending"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["status"], "sent");

    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/quotes/{quote_id}/versions"),
        &ceo_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body.as_array().unwrap().len(), 2);
}

#[tokio::test]
async fn ceo_assistant_can_read_but_cannot_mutate_contracts_and_quotes() {
    let Some((app, pool, admin_id, _)) = test_context().await else {
        return;
    };

    let tag = unique_tag("assistant-contracts");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let pm_id = seed_user(&pool, &tag, "patient_manager").await;
    let billing_id = seed_user(&pool, &tag, "billing").await;
    let assistant_id = seed_user(&pool, &tag, "ceo_assistant").await;
    let provider_id = seed_provider(&pool, &tag).await;
    let doctor_id = seed_doctor(&pool, provider_id, &tag).await;

    seed_patient_assignment(&pool, patient_id, pm_id, admin_id).await;

    let pm_bearer = auth_header_for(pm_id, "patient_manager");
    let billing_bearer = auth_header_for(billing_id, "billing");
    let assistant_bearer = auth_header_for(assistant_id, "ceo_assistant");

    let (status, body) = json_request(
        &app,
        "POST",
        "/api/v1/orders",
        &pm_bearer,
        Some(json!({
            "patient_id": patient_id,
            "needs_description": "Assistant read-only visibility"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let order_id = body["id"].as_str().unwrap().to_string();

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/orders/{order_id}/leistungen"),
        &pm_bearer,
        Some(json!({
            "description": "Assistant quote line",
            "quantity": 1.0,
            "unit_price": 180.0,
            "provider_id": provider_id,
            "doctor_id": doctor_id
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/orders/{order_id}/quotes"),
        &billing_bearer,
        Some(json!({
            "valid_until": "2026-06-15",
            "notes": "Read-only quote"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let quote_id = body["id"].as_str().unwrap().to_string();

    let (status, body) = json_request(
        &app,
        "POST",
        "/api/v1/framework-contracts",
        &pm_bearer,
        Some(json!({
            "patient_id": patient_id,
            "status": "sent",
            "valid_from": "2026-05-01"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let contract_id = body["id"].as_str().unwrap().to_string();

    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/framework-contracts?patient_id={patient_id}"),
        &assistant_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body.as_array().unwrap().len(), 1);

    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/framework-contracts/{contract_id}"),
        &assistant_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["patient_id"], patient_id.to_string());

    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/patients/{patient_id}/framework-contracts"),
        &assistant_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body.as_array().unwrap().len(), 1);

    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/quotes?patient_id={patient_id}"),
        &assistant_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body.as_array().unwrap().len(), 1);

    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/quotes/{quote_id}"),
        &assistant_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["patient_id"], patient_id.to_string());

    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/quotes/{quote_id}/versions"),
        &assistant_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body.as_array().unwrap().len(), 1);

    for (method, path, payload) in [
        (
            "POST",
            "/api/v1/framework-contracts".to_string(),
            Some(json!({
                "patient_id": patient_id,
                "status": "draft"
            })),
        ),
        (
            "POST",
            format!("/api/v1/framework-contracts/{contract_id}/status"),
            Some(json!({ "status": "signed" })),
        ),
        (
            "POST",
            format!("/api/v1/orders/{order_id}/quotes"),
            Some(json!({})),
        ),
        (
            "POST",
            format!("/api/v1/quotes/{quote_id}/status"),
            Some(json!({ "status": "accepted" })),
        ),
    ] {
        let (status, _) = json_request(&app, method, &path, &assistant_bearer, payload).await;
        assert_eq!(status, StatusCode::FORBIDDEN);
    }
}

#[tokio::test]
async fn sales_and_concierge_cannot_access_contracts_or_quotes_workspaces() {
    let Some((app, pool, admin_id, _)) = test_context().await else {
        return;
    };

    let tag = unique_tag("deny-contracts");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let sales_id = seed_user(&pool, &tag, "sales").await;
    let concierge_id = seed_user(&pool, &tag, "concierge").await;

    let sales_bearer = auth_header_for(sales_id, "sales");
    let concierge_bearer = auth_header_for(concierge_id, "concierge");

    for bearer in [&sales_bearer, &concierge_bearer] {
        let (status, _) =
            json_request(&app, "GET", "/api/v1/framework-contracts", bearer, None).await;
        assert_eq!(status, StatusCode::FORBIDDEN);

        let (status, _) = json_request(&app, "GET", "/api/v1/quotes", bearer, None).await;
        assert_eq!(status, StatusCode::FORBIDDEN);
    }

    let (status, _) = json_request(
        &app,
        "GET",
        &format!("/api/v1/patients/{patient_id}/framework-contracts"),
        &concierge_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn agency_service_catalog_supports_create_read_only_visibility_and_update() {
    let Some((app, pool, _admin_id, bearer)) = test_context().await else {
        return;
    };

    let tag = unique_tag("agency-catalog");
    let billing_id = seed_user(&pool, &tag, "billing").await;
    let assistant_id = seed_user(&pool, &tag, "ceo_assistant").await;
    let billing_bearer = auth_header_for(billing_id, "billing");
    let assistant_bearer = auth_header_for(assistant_id, "ceo_assistant");

    let (status, body) = json_request(
        &app,
        "POST",
        "/api/v1/agency-services",
        &bearer,
        Some(json!({
            "service_name": format!("Interpreter hours {tag}"),
            "description": "Approved interpreter work billed per hour",
            "unit_label": "hour",
            "unit_price": 89.5,
            "currency": "EUR",
            "vat_rate": 19.0,
            "is_active": true,
            "valid_from": "2026-04-01"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let service_id = body["id"].as_str().unwrap().to_string();

    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/agency-services?search={tag}"),
        &assistant_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let items = body.as_array().unwrap();
    assert_eq!(items.len(), 1);
    assert_eq!(items[0]["id"], service_id);
    assert!(
        items[0]["service_key"]
            .as_str()
            .unwrap_or_default()
            .starts_with("interpreter_hours_")
    );
    assert_eq!(items[0]["unit_label"], "hour");
    assert_eq!(items[0]["unit_price"].as_str(), Some("89.5"));
    assert_eq!(items[0]["is_active"], true);

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/agency-services/{service_id}/update"),
        &assistant_bearer,
        Some(json!({
            "service_key": format!("interpreter_hours_{tag}"),
            "service_name": "Should not update",
            "unit_price": 91.0,
            "valid_from": "2026-04-01"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/agency-services/{service_id}/update"),
        &billing_bearer,
        Some(json!({
            "service_name": format!("Interpreter hours {tag}"),
            "description": "Approved interpreter work billed per hour",
            "unit_label": "hour",
            "unit_price": 95.0,
            "currency": "EUR",
            "vat_rate": 7.0,
            "is_active": false,
            "valid_from": "2026-04-01",
            "valid_to": "2026-12-31"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/agency-services?search={tag}"),
        &billing_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let items = body.as_array().unwrap();
    assert_eq!(items.len(), 1);
    assert_eq!(items[0]["unit_price"].as_str(), Some("95"));
    assert_eq!(items[0]["vat_rate"].as_str(), Some("7"));
    assert_eq!(items[0]["is_active"], false);
    assert_eq!(items[0]["valid_to"], "2026-12-31");
}

#[tokio::test]
async fn order_service_keeps_catalog_snapshot_and_used_catalog_item_is_archived() {
    let Some((app, pool, admin_id, _)) = test_context().await else {
        return;
    };

    let tag = unique_tag("agency-snapshot");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let pm_id = seed_user(&pool, &tag, "patient_manager").await;
    let billing_id = seed_user(&pool, &tag, "billing").await;
    seed_patient_assignment(&pool, patient_id, pm_id, admin_id).await;
    let pm_bearer = auth_header_for(pm_id, "patient_manager");
    let billing_bearer = auth_header_for(billing_id, "billing");

    let original_name = format!("Concierge transfer {tag}");
    let original_description = "Airport pickup with driver and waiting time";
    let (status, service) = json_request(
        &app,
        "POST",
        "/api/v1/agency-services",
        &billing_bearer,
        Some(json!({
            "service_key": format!("concierge_transfer_{tag}"),
            "service_name": original_name.clone(),
            "description": original_description,
            "unit_label": "transfer",
            "unit_price": 90.0,
            "currency": "EUR",
            "vat_rate": 19.0,
            "is_active": true,
            "valid_from": "2026-08-01"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "response: {service}");
    let service_id = service["id"].as_str().expect("service id");

    let (status, order) = json_request(
        &app,
        "POST",
        "/api/v1/orders",
        &pm_bearer,
        Some(json!({
            "patient_id": patient_id,
            "needs_description": "Concierge transfer"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "response: {order}");
    let order_id = order["id"].as_str().expect("order id");

    let (status, line) = json_request(
        &app,
        "POST",
        &format!("/api/v1/orders/{order_id}/leistungen"),
        &pm_bearer,
        Some(json!({
            "agency_service_id": service_id,
            "description": original_name.clone(),
            "quantity": 2.0,
            "unit_price": 88.0,
            "vat_rate": 19.0
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "response: {line}");

    let (status, updated) = json_request(
        &app,
        "POST",
        &format!("/api/v1/agency-services/{service_id}/update"),
        &billing_bearer,
        Some(json!({
            "service_key": format!("concierge_transfer_{tag}"),
            "service_name": format!("Changed transfer {tag}"),
            "description": "Changed catalog wording",
            "unit_label": "ride",
            "unit_price": 120.0,
            "currency": "EUR",
            "vat_rate": 7.0,
            "is_active": true,
            "valid_from": "2026-08-01"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "response: {updated}");

    let (status, detail) = json_request(
        &app,
        "GET",
        &format!("/api/v1/orders/{order_id}"),
        &pm_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "response: {detail}");
    let saved_line = &detail["leistungen"][0];
    assert_eq!(saved_line["agency_service_name"], original_name);
    assert_eq!(
        saved_line["agency_service_description"],
        original_description
    );
    assert_eq!(saved_line["agency_service_unit_label"], "transfer");
    assert_eq!(saved_line["unit_price"], "90");
    assert_eq!(saved_line["unit_price_snapshot"], "90");
    assert_eq!(saved_line["vat_rate_snapshot"], "19");

    let (status, quote) = json_request(
        &app,
        "POST",
        &format!("/api/v1/orders/{order_id}/quotes"),
        &pm_bearer,
        Some(json!({})),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "response: {quote}");
    assert_eq!(quote["line_items"][0]["notes"], original_description);

    let (status, removed) = json_request(
        &app,
        "DELETE",
        &format!("/api/v1/agency-services/{service_id}"),
        &billing_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "response: {removed}");
    assert_eq!(removed["action"], "archived");
    assert!(removed["usage_count"].as_i64().unwrap_or_default() > 0);
    let is_active: bool =
        sqlx::query_scalar("SELECT is_active FROM agency_service_catalog WHERE id = $1")
            .bind(Uuid::parse_str(service_id).unwrap())
            .fetch_one(&pool)
            .await
            .unwrap();
    assert!(!is_active);
}

#[tokio::test]
async fn order_service_can_select_an_explicit_catalog_price_version() {
    let Some((app, pool, admin_id, _)) = test_context().await else {
        return;
    };

    let tag = unique_tag("explicit-agency-price");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let pm_id = seed_user(&pool, &tag, "patient_manager").await;
    let billing_id = seed_user(&pool, &tag, "billing").await;
    seed_patient_assignment(&pool, patient_id, pm_id, admin_id).await;
    let pm_bearer = auth_header_for(pm_id, "patient_manager");
    let billing_bearer = auth_header_for(billing_id, "billing");

    let (status, first_service) = json_request(
        &app,
        "POST",
        "/api/v1/agency-services",
        &billing_bearer,
        Some(json!({
            "service_key": format!("explicit_price_{tag}"),
            "service_name": format!("Explicit price {tag}"),
            "unit_label": "unit",
            "unit_price": 90.0,
            "currency": "EUR",
            "vat_rate": 19.0,
            "is_active": true,
            "valid_from": "2026-01-01"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "response: {first_service}");
    let first_service_id = first_service["id"].as_str().expect("service id");

    let (status, future_price) = json_request(
        &app,
        "POST",
        &format!("/api/v1/agency-services/{first_service_id}/price-versions"),
        &billing_bearer,
        Some(json!({
            "name": "Contracted future price",
            "unit_price": 150,
            "currency": "EUR",
            "vat_rate": 7,
            "valid_from": "2027-01-01"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "response: {future_price}");
    let future_price_id = future_price["id"].as_str().expect("price version id");

    let (status, second_service) = json_request(
        &app,
        "POST",
        "/api/v1/agency-services",
        &billing_bearer,
        Some(json!({
            "service_key": format!("wrong_price_owner_{tag}"),
            "service_name": format!("Wrong price owner {tag}"),
            "unit_label": "unit",
            "unit_price": 70.0,
            "currency": "EUR",
            "vat_rate": 19.0,
            "is_active": true,
            "valid_from": "2026-01-01"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "response: {second_service}");
    let second_service_id = second_service["id"].as_str().expect("service id");

    let (status, order) = json_request(
        &app,
        "POST",
        "/api/v1/orders",
        &pm_bearer,
        Some(json!({
            "patient_id": patient_id,
            "needs_description": "Explicit catalog price selection",
            "date_from": "2026-09-04"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "response: {order}");
    let order_id = order["id"].as_str().expect("order id");

    let (status, version_without_service) = json_request(
        &app,
        "POST",
        &format!("/api/v1/orders/{order_id}/leistungen"),
        &pm_bearer,
        Some(json!({
            "agency_service_price_version_id": future_price_id,
            "description": "Missing service",
            "quantity": 1,
            "unit_price": 1
        })),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::UNPROCESSABLE_ENTITY,
        "response: {version_without_service}"
    );

    let (status, wrong_service) = json_request(
        &app,
        "POST",
        &format!("/api/v1/orders/{order_id}/leistungen"),
        &pm_bearer,
        Some(json!({
            "agency_service_id": second_service_id,
            "agency_service_price_version_id": future_price_id,
            "description": "Wrong service version",
            "quantity": 1,
            "unit_price": 1
        })),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::UNPROCESSABLE_ENTITY,
        "response: {wrong_service}"
    );

    let (status, line) = json_request(
        &app,
        "POST",
        &format!("/api/v1/orders/{order_id}/leistungen"),
        &pm_bearer,
        Some(json!({
            "agency_service_id": first_service_id,
            "agency_service_price_version_id": future_price_id,
            "description": "Explicit future price",
            "quantity": 2,
            "unit_price": 1,
            "vat_rate": 19
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "response: {line}");

    let (status, detail) = json_request(
        &app,
        "GET",
        &format!("/api/v1/orders/{order_id}"),
        &pm_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "response: {detail}");
    let saved_line = &detail["leistungen"][0];
    assert_eq!(saved_line["agency_service_id"], first_service_id);
    assert_eq!(
        saved_line["agency_service_price_version_id"],
        future_price_id
    );
    assert_eq!(saved_line["unit_price"], "150");
    assert_eq!(saved_line["unit_price_snapshot"], "150");
    assert_eq!(saved_line["vat_rate"], "7");
    assert_eq!(saved_line["vat_rate_snapshot"], "7");
}

#[tokio::test]
async fn service_group_can_select_an_explicit_catalog_price_version() {
    let Some((app, pool, admin_id, _)) = test_context().await else {
        return;
    };

    let tag = unique_tag("group-explicit-price");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let provider_id = seed_provider(&pool, &tag).await;
    let doctor_id = seed_doctor(&pool, provider_id, &tag).await;
    let pm_id = seed_user(&pool, &tag, "patient_manager").await;
    let billing_id = seed_user(&pool, &tag, "billing").await;
    seed_patient_assignment(&pool, patient_id, pm_id, admin_id).await;
    let pm_bearer = auth_header_for(pm_id, "patient_manager");
    let billing_bearer = auth_header_for(billing_id, "billing");

    let (status, first_service) = json_request(
        &app,
        "POST",
        "/api/v1/agency-services",
        &billing_bearer,
        Some(json!({
            "service_key": format!("group_explicit_{tag}"),
            "service_name": format!("Group explicit {tag}"),
            "unit_label": "doctor",
            "unit_price": 90,
            "currency": "EUR",
            "vat_rate": 19,
            "is_active": true,
            "valid_from": "2026-01-01"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "response: {first_service}");
    let first_service_id = first_service["id"].as_str().expect("service id");

    let (status, future_price) = json_request(
        &app,
        "POST",
        &format!("/api/v1/agency-services/{first_service_id}/price-versions"),
        &billing_bearer,
        Some(json!({
            "name": "Contracted group price",
            "unit_price": 175,
            "currency": "EUR",
            "vat_rate": 7,
            "valid_from": "2027-01-01"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "response: {future_price}");
    let future_price_id = future_price["id"].as_str().expect("price version id");

    let (status, second_service) = json_request(
        &app,
        "POST",
        "/api/v1/agency-services",
        &billing_bearer,
        Some(json!({
            "service_key": format!("group_wrong_owner_{tag}"),
            "service_name": format!("Group wrong owner {tag}"),
            "unit_label": "doctor",
            "unit_price": 70,
            "currency": "EUR",
            "vat_rate": 19,
            "is_active": true,
            "valid_from": "2026-01-01"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "response: {second_service}");
    let second_service_id = second_service["id"].as_str().expect("service id");

    let (status, order) = json_request(
        &app,
        "POST",
        "/api/v1/orders",
        &pm_bearer,
        Some(json!({
            "patient_id": patient_id,
            "needs_description": "Explicit group price selection",
            "date_from": "2026-09-04"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "response: {order}");
    let order_id = order["id"].as_str().expect("order id");

    let (status, version_without_service) = json_request(
        &app,
        "POST",
        &format!("/api/v1/orders/{order_id}/service-groups"),
        &pm_bearer,
        Some(json!({
            "group_title": "Missing service",
            "agency_service_price_version_id": future_price_id
        })),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::UNPROCESSABLE_ENTITY,
        "response: {version_without_service}"
    );

    let (status, wrong_service) = json_request(
        &app,
        "POST",
        &format!("/api/v1/orders/{order_id}/service-groups"),
        &pm_bearer,
        Some(json!({
            "group_title": "Wrong service",
            "agency_service_id": second_service_id,
            "agency_service_price_version_id": future_price_id
        })),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::UNPROCESSABLE_ENTITY,
        "response: {wrong_service}"
    );

    let (status, group) = json_request(
        &app,
        "POST",
        &format!("/api/v1/orders/{order_id}/service-groups"),
        &pm_bearer,
        Some(json!({
            "group_title": "Explicit future group price",
            "agency_service_id": first_service_id,
            "agency_service_price_version_id": future_price_id,
            "service_date": "2026-09-04",
            "quantity": 2,
            "unit_price": 1,
            "vat_rate": 19,
            "participants": [{
                "provider_id": provider_id,
                "doctor_id": doctor_id
            }]
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "response: {group}");
    let group_id = group["id"].as_str().expect("service group id");

    let (status, group_detail) = json_request(
        &app,
        "GET",
        &format!("/api/v1/order-service-groups/{group_id}"),
        &pm_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "response: {group_detail}");
    assert_eq!(group_detail["agency_service_id"], first_service_id);
    assert_eq!(
        group_detail["agency_service_price_version_id"],
        future_price_id
    );
    assert_eq!(group_detail["unit_price"], "175");
    assert_eq!(group_detail["vat_rate"], "7");

    let (status, generated) = json_request(
        &app,
        "POST",
        &format!("/api/v1/order-service-groups/{group_id}/generate-lines"),
        &pm_bearer,
        Some(json!({})),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "response: {generated}");
    assert_eq!(generated["generated_count"], 1);

    let (status, order_detail) = json_request(
        &app,
        "GET",
        &format!("/api/v1/orders/{order_id}"),
        &pm_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "response: {order_detail}");
    let generated_line = &order_detail["leistungen"][0];
    assert_eq!(generated_line["agency_service_id"], first_service_id);
    assert_eq!(
        generated_line["agency_service_price_version_id"],
        future_price_id
    );
    assert_eq!(generated_line["unit_price"], "175");
    assert_eq!(generated_line["unit_price_snapshot"], "175");
    assert_eq!(generated_line["vat_rate"], "7");
    assert_eq!(generated_line["vat_rate_snapshot"], "7");
}

#[tokio::test]
async fn unused_agency_service_can_be_deleted() {
    let Some((app, pool, _admin_id, _)) = test_context().await else {
        return;
    };

    let tag = unique_tag("unused-agency-service");
    let billing_id = seed_user(&pool, &tag, "billing").await;
    let billing_bearer = auth_header_for(billing_id, "billing");
    let (status, service) = json_request(
        &app,
        "POST",
        "/api/v1/agency-services",
        &billing_bearer,
        Some(json!({
            "service_key": format!("unused_{tag}"),
            "service_name": format!("Unused {tag}"),
            "unit_label": "unit",
            "unit_price": 10.0,
            "currency": "EUR",
            "vat_rate": 19.0,
            "is_active": true,
            "valid_from": "2026-08-01"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "response: {service}");
    let service_id = service["id"].as_str().expect("service id");

    let (status, removed) = json_request(
        &app,
        "DELETE",
        &format!("/api/v1/agency-services/{service_id}"),
        &billing_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "response: {removed}");
    assert_eq!(removed["action"], "deleted");
    assert_eq!(removed["usage_count"], 0);

    let count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM agency_service_catalog WHERE id = $1")
            .bind(Uuid::parse_str(service_id).unwrap())
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(count, 0);
}

#[tokio::test]
async fn sales_and_concierge_cannot_access_agency_service_catalog() {
    let Some((app, pool, _admin_id, _)) = test_context().await else {
        return;
    };

    let tag = unique_tag("agency-catalog-deny");
    let sales_id = seed_user(&pool, &tag, "sales").await;
    let concierge_id = seed_user(&pool, &tag, "concierge").await;
    let sales_bearer = auth_header_for(sales_id, "sales");
    let concierge_bearer = auth_header_for(concierge_id, "concierge");

    for bearer in [&sales_bearer, &concierge_bearer] {
        let (status, _) = json_request(&app, "GET", "/api/v1/agency-services", bearer, None).await;
        assert_eq!(status, StatusCode::FORBIDDEN);

        let (status, _) = json_request(
            &app,
            "POST",
            "/api/v1/agency-services",
            bearer,
            Some(json!({
                "service_key": "test_service",
                "service_name": "Test service",
                "unit_price": 10.0,
                "valid_from": "2026-04-01"
            })),
        )
        .await;
        assert_eq!(status, StatusCode::FORBIDDEN);

        let (status, _) = json_request(
            &app,
            "DELETE",
            &format!("/api/v1/agency-services/{}", Uuid::new_v4()),
            bearer,
            None,
        )
        .await;
        assert_eq!(status, StatusCode::FORBIDDEN);
    }
}
