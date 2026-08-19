mod support;

use axum::body::Body;
use axum::http::{Method, Request, StatusCode};
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

fn auth_header_for(user_id: Uuid, role: &str) -> String {
    let token = jwt::issue_access_token(TEST_SECRET, user_id, role, Uuid::new_v4()).unwrap();
    format!("Bearer {token}")
}

async fn request_json(
    app: &axum::Router,
    method: Method,
    path: &str,
    bearer: &str,
    body: Option<Value>,
) -> (StatusCode, Value) {
    let mut builder = Request::builder()
        .method(method)
        .uri(path)
        .header("Authorization", bearer);
    let body = if let Some(body) = body {
        builder = builder.header("Content-Type", "application/json");
        Body::from(serde_json::to_vec(&body).unwrap())
    } else {
        Body::empty()
    };
    let response = app.clone().oneshot(builder.body(body).unwrap()).await.unwrap();
    let status = response.status();
    let bytes = axum::body::to_bytes(response.into_body(), 1024 * 1024)
        .await
        .unwrap();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or_else(|_| json!(null)),
    )
}

async fn seed_user(pool: &PgPool, tag: &str, role: &str) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO users (email, password_hash, name, role)
           VALUES ($1, 'test-password-hash', $2, $3)
           RETURNING id"#,
    )
    .bind(format!("{tag}-{role}-{}@example.com", Uuid::new_v4().simple()))
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
           ) VALUES ($1, 'Balance', 'Patient', '1990-01-01', 'diverse', $2)
           RETURNING id"#,
    )
    .bind(format!("PT-{tag}-{}", Uuid::new_v4().simple()))
    .bind(created_by)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn assign(pool: &PgPool, patient_id: Uuid, user_id: Uuid, actor_id: Uuid) {
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

#[tokio::test]
async fn balance_adjustments_are_append_only_idempotent_and_portal_safe() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };
    let tag = format!("balance-adjustment-{}", Uuid::new_v4().simple());
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let patient_user_id = seed_user(&pool, &tag, "patient").await;
    let manager_id = seed_user(&pool, &tag, "patient_manager").await;
    assign(&pool, patient_id, patient_user_id, admin_id).await;
    assign(&pool, patient_id, manager_id, admin_id).await;

    let order_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO orders (
                order_number, patient_id, phase, status, currency, created_by
           ) VALUES ($1, $2, 'execution', 'active', 'EUR', $3)
           RETURNING id"#,
    )
    .bind(format!("ORD-{tag}"))
    .bind(patient_id)
    .bind(admin_id)
    .fetch_one(&pool)
    .await
    .unwrap();

    let admin = auth_header_for(admin_id, "ceo");
    let manager = auth_header_for(manager_id, "patient_manager");
    let patient = auth_header_for(patient_user_id, "patient");
    let today = chrono::Utc::now().date_naive().to_string();
    let request_id = Uuid::new_v4();
    let adjustment_body = json!({
        "request_id": request_id,
        "direction": "debit",
        "category": "opening_balance",
        "amount": "25.50",
        "currency": "eur",
        "effective_on": today,
        "order_id": order_id,
        "reason": "Imported opening balance",
        "note": "internal-only note",
        "portal_visible": false
    });

    let path = format!("/api/v1/patients/{patient_id}/balance-adjustments");
    let (forbidden_status, _) = request_json(
        &app,
        Method::POST,
        &path,
        &manager,
        Some(adjustment_body.clone()),
    )
    .await;
    assert_eq!(forbidden_status, StatusCode::FORBIDDEN);

    let (created_status, created) = request_json(
        &app,
        Method::POST,
        &path,
        &admin,
        Some(adjustment_body.clone()),
    )
    .await;
    assert_eq!(created_status, StatusCode::CREATED, "create: {created:?}");
    let adjustment_id = Uuid::parse_str(created["adjustment_id"].as_str().unwrap()).unwrap();

    let (replay_status, replay) = request_json(
        &app,
        Method::POST,
        &path,
        &admin,
        Some(adjustment_body.clone()),
    )
    .await;
    assert_eq!(replay_status, StatusCode::OK, "replay: {replay:?}");
    assert_eq!(replay["adjustment_id"], adjustment_id.to_string());
    assert_eq!(replay["idempotent_replay"], true);

    let mut drift = adjustment_body.clone();
    drift["amount"] = json!("26.00");
    let (drift_status, _) =
        request_json(&app, Method::POST, &path, &admin, Some(drift)).await;
    assert_eq!(drift_status, StatusCode::CONFLICT);

    let (list_status, list) = request_json(&app, Method::GET, &path, &manager, None).await;
    assert_eq!(list_status, StatusCode::OK, "list: {list:?}");
    assert_eq!(list["items"].as_array().unwrap().len(), 1);
    assert_eq!(list["items"][0]["note"], "internal-only note");

    let statement_path = format!(
        "/api/v1/patients/{patient_id}/account-statement?currency=EUR"
    );
    let (statement_status, statement) =
        request_json(&app, Method::GET, &statement_path, &manager, None).await;
    assert_eq!(statement_status, StatusCode::OK, "statement: {statement:?}");
    assert_eq!(statement["summary"]["closing_balance"], "25.5");
    assert_eq!(statement["movements"][0]["description"], "Imported opening balance");

    let (portal_status, portal_statement) = request_json(
        &app,
        Method::GET,
        "/api/v1/me/account-statement?currency=EUR",
        &patient,
        None,
    )
    .await;
    assert_eq!(portal_status, StatusCode::OK, "portal: {portal_statement:?}");
    assert_eq!(portal_statement["summary"]["closing_balance"], "25.5");
    assert_eq!(portal_statement["movements"][0]["description"], "Account adjustment");
    assert!(!portal_statement.to_string().contains("internal-only note"));
    assert!(!portal_statement.to_string().contains("Imported opening balance"));

    let reversal_request_id = Uuid::new_v4();
    let reversal_path = format!(
        "/api/v1/patients/{patient_id}/balance-adjustments/{adjustment_id}/reversal"
    );
    let reversal_body = json!({
        "request_id": reversal_request_id,
        "reason": "Opening balance entered in error"
    });
    let (reverse_status, reverse) = request_json(
        &app,
        Method::POST,
        &reversal_path,
        &admin,
        Some(reversal_body.clone()),
    )
    .await;
    assert_eq!(reverse_status, StatusCode::OK, "reverse: {reverse:?}");
    let reversal_id = reverse["reversal_id"].clone();

    let (reverse_replay_status, reverse_replay) = request_json(
        &app,
        Method::POST,
        &reversal_path,
        &admin,
        Some(reversal_body),
    )
    .await;
    assert_eq!(reverse_replay_status, StatusCode::OK);
    assert_eq!(reverse_replay["reversal_id"], reversal_id);
    assert_eq!(reverse_replay["idempotent_replay"], true);

    let (second_reverse_status, _) = request_json(
        &app,
        Method::POST,
        &reversal_path,
        &admin,
        Some(json!({
            "request_id": Uuid::new_v4(),
            "reason": "Second reversal attempt"
        })),
    )
    .await;
    assert_eq!(second_reverse_status, StatusCode::CONFLICT);

    let (_, reversed_statement) =
        request_json(&app, Method::GET, &statement_path, &manager, None).await;
    assert_eq!(reversed_statement["summary"]["closing_balance"], "0");
    assert_eq!(reversed_statement["movements"].as_array().unwrap().len(), 2);

    let update_result = sqlx::query(
        "UPDATE patient_balance_adjustments SET amount = 30 WHERE id = $1",
    )
    .bind(adjustment_id)
    .execute(&pool)
    .await;
    assert!(update_result.is_err(), "adjustment journal must be immutable");

    let delete_result = sqlx::query("DELETE FROM patient_balance_adjustments WHERE id = $1")
        .bind(adjustment_id)
        .execute(&pool)
        .await;
    assert!(delete_result.is_err(), "adjustment journal must be append-only");
}

