mod support;
use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use gmed_server::auth::jwt;
use serde_json::{Value, json};
use tower::ServiceExt;
use uuid::Uuid;

const SECRET: &str = "order-intake-test-secret-at-least-32-characters";
async fn request(
    app: &axum::Router,
    token: &str,
    method: &str,
    path: &str,
    body: Value,
) -> (StatusCode, Value) {
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(method)
                .uri(path)
                .header("Authorization", format!("Bearer {token}"))
                .header("Content-Type", "application/json")
                .body(if method == "GET" {
                    Body::empty()
                } else {
                    Body::from(body.to_string())
                })
                .unwrap(),
        )
        .await
        .unwrap();
    let status = response.status();
    let bytes = axum::body::to_bytes(response.into_body(), 10 * 1024 * 1024)
        .await
        .unwrap();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}
async fn save(
    app: &axum::Router,
    token: &str,
    ws: &Value,
    data: &Value,
    action: &str,
) -> (StatusCode, Value) {
    request(
        app,
        token,
        "POST",
        &format!("/api/v1/orders/{}/intake", ws["order_id"].as_str().unwrap()),
        json!({"revision":ws["revision"],"data":data,"action":action}),
    )
    .await
}

#[tokio::test]
async fn returning_patient_intake_preserves_history_and_guards_every_transition() {
    let ctx = support::suite_context(SECRET)
        .await
        .expect("integration database is required");
    let token = jwt::issue_access_token(SECRET, ctx.admin_id, "ceo", Uuid::new_v4()).unwrap();
    let patient:Uuid=sqlx::query_scalar("INSERT INTO patients(patient_id,first_name,last_name,birth_date,gender,languages,phone_primary,address_country,
        insurance_type,insurance_provider,insurance_number,legal_status,created_by)
        VALUES($1,'Intake','Patient','1980-01-01','diverse',ARRAY['de'],'+49123456789','DE','private','Old insurer','OLD',
        '{\"dsgvo_signed\":true,\"confidentiality_release_signed\":true,\"identity_verified\":true,\"compliance_completed\":true,\"document_pack_complete\":true,\"contract_status\":\"signed\"}', $2) RETURNING id")
        .bind(format!("INTAKE-{}",Uuid::new_v4())).bind(ctx.admin_id).fetch_one(&ctx.pool).await.unwrap();
    let id = Uuid::new_v4();
    let initial_path = format!("/api/v1/patients/{patient}/order-intakes");
    let (status, initial) = request(&ctx.app, &token, "GET", &initial_path, Value::Null).await;
    assert_eq!(status, StatusCode::OK, "{initial}");
    assert!(
        initial["facts"]["pep_contract_partner"].is_null(),
        "Unknown must not become No"
    );
    let before: i64 = sqlx::query_scalar("SELECT count(*) FROM orders WHERE patient_id=$1")
        .bind(patient)
        .fetch_one(&ctx.pool)
        .await
        .unwrap();
    assert_eq!(before, 0, "Opening context must not create an order");
    let (status, mut ws) = request(
        &ctx.app,
        &token,
        "POST",
        &initial_path,
        json!({"request_id":id,"baseline_facts":initial["facts"]}),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{ws}");
    let (status, replay) = request(
        &ctx.app,
        &token,
        "POST",
        &initial_path,
        json!({"request_id":id}),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{replay}");
    assert_eq!(replay["order_id"], ws["order_id"]);
    let tracked: i64 =
        sqlx::query_scalar("SELECT count(*) FROM order_payment_tracking WHERE order_id=$1")
            .bind(id)
            .fetch_one(&ctx.pool)
            .await
            .unwrap();
    assert_eq!(tracked, 0);
    let mut draft = ws["data"].clone();
    draft["facts"]["insurance_provider"] = json!("New insurer");
    draft["facts"]["insurance_number"] = json!("NEW");
    let (status, next) = save(&ctx.app, &token, &ws, &draft, "save").await;
    assert_eq!(status, StatusCode::OK, "{next}");
    ws = next;
    let insurance: String =
        sqlx::query_scalar("SELECT insurance_provider FROM patients WHERE id=$1")
            .bind(patient)
            .fetch_one(&ctx.pool)
            .await
            .unwrap();
    assert_eq!(
        insurance, "Old insurer",
        "Autosave must not edit the live patient"
    );
    let (status, _) = save(&ctx.app, &token, &ws, &draft, "confirm_facts").await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    draft["facts"]["pep_contract_partner"] = json!(false);
    draft["facts"]["pep_beneficial_owner"] = json!(false);
    let stale = ws.clone();
    let (status, next) = save(&ctx.app, &token, &ws, &draft, "confirm_facts").await;
    assert_eq!(status, StatusCode::OK, "{next}");
    ws = next;
    let (status, _) = save(&ctx.app, &token, &stale, &draft, "save").await;
    assert_eq!(status, StatusCode::CONFLICT);
    let insurance: String =
        sqlx::query_scalar("SELECT insurance_provider FROM patients WHERE id=$1")
            .bind(patient)
            .fetch_one(&ctx.pool)
            .await
            .unwrap();
    assert_eq!(insurance, "New insurer");
    let contract:Uuid=sqlx::query_scalar("INSERT INTO framework_contracts(patient_id,contract_number,status,signed_at,valid_from,valid_to,created_by)
        VALUES($1,$2,'signed',now(),'2026-01-01','2026-12-31',$3) RETURNING id")
        .bind(patient).bind(format!("FC-{}",Uuid::new_v4())).bind(ctx.admin_id).fetch_one(&ctx.pool).await.unwrap();
    draft["needs_description"] = json!("Follow-up treatment");
    draft["date_from"] = json!("2026-12-20");
    draft["date_to"] = json!("2027-01-15");
    draft["contract_id"] = json!(contract);
    draft["lines"] = json!([{"id":Uuid::new_v4(),"description":"Coordination","quantity":"1","unit_price":"100","vat_rate":"19","agency_service_id":null,"agency_service_price_version_id":null}]);
    let (status, next) = save(&ctx.app, &token, &ws, &draft, "prepare").await;
    assert_eq!(status, StatusCode::OK, "{next}");
    ws = next;
    assert!(
        ws["checks"]
            .as_array()
            .unwrap()
            .iter()
            .any(|c| c["key"] == "contract" && c["status"] == "blocked"),
        "Cached signed flag must not mask an uncovered period"
    );
    let (status, _) = request(
        &ctx.app,
        &token,
        "POST",
        &format!("/api/v1/orders/{id}/phase"),
        json!({"phase":"execution"}),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::FORBIDDEN,
        "Preparation cannot bypass execution guards"
    );
    draft["date_to"] = json!("2026-12-30");
    let (status, next) = save(&ctx.app, &token, &ws, &draft, "prepare").await;
    assert_eq!(status, StatusCode::OK, "{next}");
    ws = next;
    let quote_path = format!("/api/v1/orders/{id}/quotes");
    let (status, q) = request(&ctx.app, &token, "POST", &quote_path, json!({})).await;
    assert_eq!(status, StatusCode::CREATED, "{q}");
    let (status, q2) = request(&ctx.app, &token, "POST", &quote_path, json!({})).await;
    assert_eq!(status, StatusCode::OK, "{q2}");
    assert_eq!(q["id"], q2["id"]);
    let doc_payload =
        json!({"patient_id":patient,"order_id":id,"template_id":"single_order","language":"de"});
    let (status, doc) = request(
        &ctx.app,
        &token,
        "POST",
        "/api/v1/documents/generate",
        doc_payload.clone(),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{doc}");
    let (retry_a, retry_b) = tokio::join!(
        request(
            &ctx.app,
            &token,
            "POST",
            "/api/v1/documents/generate",
            doc_payload.clone()
        ),
        request(
            &ctx.app,
            &token,
            "POST",
            "/api/v1/documents/generate",
            doc_payload.clone()
        )
    );
    assert_eq!(retry_a.0, StatusCode::OK, "{}", retry_a.1);
    assert_eq!(retry_b.0, StatusCode::OK, "{}", retry_b.1);
    assert_eq!(retry_a.1["id"], doc["id"]);
    assert_eq!(retry_b.1["id"], doc["id"]);
    let document_id = doc["id"]
        .as_str()
        .or_else(|| doc["document_id"].as_str())
        .expect("generated document ID");
    let stored: Value =
        sqlx::query_scalar("SELECT order_intake_context FROM documents WHERE id=$1")
            .bind(Uuid::parse_str(document_id).unwrap())
            .fetch_one(&ctx.pool)
            .await
            .unwrap();
    assert_eq!(stored["data"]["facts"]["insurance_provider"], "New insurer");
    let mut changed = draft.clone();
    changed["needs_description"] = json!("Changed treatment purpose");
    let (status, next) = save(&ctx.app, &token, &ws, &changed, "prepare").await;
    assert_eq!(status, StatusCode::OK, "{next}");
    ws = next;
    assert!(
        ws["current_document_ids"].as_array().unwrap().is_empty(),
        "PDF becomes stale when the order changes"
    );
    let (status, blocked) = save(&ctx.app, &token, &ws, &changed, "confirm").await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{blocked}");
    let (status, next) = save(&ctx.app, &token, &ws, &draft, "prepare").await;
    assert_eq!(status, StatusCode::OK, "{next}");
    let (status, signed) = request(
        &ctx.app,
        &token,
        "POST",
        &format!("/api/v1/documents/{document_id}/mark-signed"),
        json!({"compliance_kind":"other"}),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{signed}");
    let (status, next) = request(
        &ctx.app,
        &token,
        "GET",
        &format!("/api/v1/orders/{id}/intake"),
        Value::Null,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{next}");
    ws = next;
    let (status, done) = save(&ctx.app, &token, &ws, &draft, "confirm").await;
    assert_eq!(status, StatusCode::OK, "{done}");
    assert_eq!(done["intake_state"], "confirmed");
    let case: Option<Uuid> = sqlx::query_scalar("SELECT case_id FROM orders WHERE id=$1")
        .bind(id)
        .fetch_one(&ctx.pool)
        .await
        .unwrap();
    assert!(case.is_some());
    let (status, done2) = save(&ctx.app, &token, &ws, &draft, "confirm").await;
    assert_eq!(status, StatusCode::OK, "{done2}");
    assert_eq!(
        sqlx::query_scalar::<_, Option<Uuid>>("SELECT case_id FROM orders WHERE id=$1")
            .bind(id)
            .fetch_one(&ctx.pool)
            .await
            .unwrap(),
        case
    );
    sqlx::query("UPDATE patients SET insurance_provider='Later insurer' WHERE id=$1")
        .bind(patient)
        .execute(&ctx.pool)
        .await
        .unwrap();
    let snapshot: Value =
        sqlx::query_scalar("SELECT confirmation_snapshot FROM order_intakes WHERE order_id=$1")
            .bind(id)
            .fetch_one(&ctx.pool)
            .await
            .unwrap();
    assert_eq!(
        snapshot["context"]["facts"]["insurance_provider"],
        "New insurer"
    );
    let stored_after: Value =
        sqlx::query_scalar("SELECT order_intake_context FROM documents WHERE id=$1")
            .bind(Uuid::parse_str(document_id).unwrap())
            .fetch_one(&ctx.pool)
            .await
            .unwrap();
    assert_eq!(stored_after, stored);
}
