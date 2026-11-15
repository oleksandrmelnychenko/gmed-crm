//! Optional validity date of a document, «Действует до» / «Gültig bis»
//! (owner decision 2026-11-15): prefill, staff edit with audit, list filter,
//! status in the API and the once-per-stage notices of the daily job.

mod support;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use chrono::{Duration, NaiveDate};
use serde_json::{Value, json};
use sqlx::PgPool;
use tower::ServiceExt;
use uuid::Uuid;

use gmed_server::auth::jwt;

const TEST_SECRET: &str = "test-secret-at-least-32-characters-long!!";

fn bearer(user_id: Uuid, role: &str) -> String {
    let token = jwt::issue_access_token(TEST_SECRET, user_id, role, Uuid::new_v4()).unwrap();
    format!("Bearer {token}")
}

async fn json_request(
    app: &axum::Router,
    method: &str,
    path: &str,
    bearer: &str,
    body: Option<Value>,
) -> (StatusCode, Value) {
    let req = Request::builder()
        .method(method)
        .uri(path)
        .header("Authorization", bearer)
        .header("Content-Type", "application/json")
        .body(match body {
            Some(value) => Body::from(serde_json::to_vec(&value).unwrap()),
            None => Body::empty(),
        })
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();
    let status = resp.status();
    let bytes = axum::body::to_bytes(resp.into_body(), 4 * 1024 * 1024)
        .await
        .unwrap();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(json!(null)),
    )
}

async fn seed_user(pool: &PgPool, tag: &str, role: &str) -> Uuid {
    sqlx::query_scalar(
        "INSERT INTO users (email, password_hash, name, role) VALUES ($1, 'x', $2, $3) RETURNING id",
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
        r#"INSERT INTO patients (patient_id, first_name, last_name, birth_date, gender, created_by)
           VALUES ($1, 'Erika', 'Muster', '1990-01-01', 'diverse', $2) RETURNING id"#,
    )
    .bind(format!("PT-{tag}"))
    .bind(created_by)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn seed_document(pool: &PgPool, uploaded_by: Uuid, patient_id: Uuid, art: &str) -> Uuid {
    let id = Uuid::new_v4();
    sqlx::query(
        r#"INSERT INTO documents (
               id, patient_id, auto_name, original_filename, art, category, status,
               visibility, is_medical, mime_type, file_size, version_root_document_id,
               version_number, uploaded_by
           ) VALUES ($1, $2, 'Reisepass', 'scan.pdf', $3, 'identity', 'active',
                     'internal', false, 'application/pdf', 1234, $1, 1, $4)"#,
    )
    .bind(id)
    .bind(patient_id)
    .bind(art)
    .bind(uploaded_by)
    .execute(pool)
    .await
    .unwrap();
    id
}

async fn valid_until(pool: &PgPool, document_id: Uuid) -> Option<NaiveDate> {
    sqlx::query_scalar("SELECT valid_until FROM documents WHERE id = $1")
        .bind(document_id)
        .fetch_one(pool)
        .await
        .unwrap()
}

#[tokio::test]
async fn document_validity_prefill_edit_filter_and_notices() {
    let Some(ctx) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let pool = ctx.pool.clone();
    let tag = Uuid::new_v4().simple().to_string();
    let ceo = bearer(ctx.admin_id, "ceo");
    let manager = seed_user(&pool, &tag, "patient_manager").await;
    let patient_id = seed_patient(&pool, ctx.admin_id, &tag).await;
    sqlx::query(
        "INSERT INTO patient_assignments (patient_id, user_id, assigned_by) VALUES ($1, $2, $3)",
    )
    .bind(patient_id)
    .bind(manager)
    .bind(ctx.admin_id)
    .execute(&pool)
    .await
    .unwrap();
    let today = gmed_server::app_time::today();

    // Prefill: an identity document gets the recorded validity of the
    // patient's passport; any other document stays untracked.
    let passport_until = today + Duration::days(10);
    sqlx::query("UPDATE patients SET passport_expiry = $2 WHERE id = $1")
        .bind(patient_id)
        .bind(passport_until)
        .execute(&pool)
        .await
        .unwrap();
    let passport = seed_document(&pool, ctx.admin_id, patient_id, "passport_scan").await;
    let other = seed_document(&pool, ctx.admin_id, patient_id, "other").await;
    assert_eq!(valid_until(&pool, passport).await, Some(passport_until));
    assert_eq!(valid_until(&pool, other).await, None);

    // The API derives the status; an untracked document has none.
    let (status, detail) = json_request(
        &ctx.app,
        "GET",
        &format!("/api/v1/documents/{passport}"),
        &ceo,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{detail}");
    assert_eq!(detail["validity_status"], "expiring");
    assert_eq!(detail["validity_days_left"], 10);
    let (_, untracked) = json_request(
        &ctx.app,
        "GET",
        &format!("/api/v1/documents/{other}"),
        &ceo,
        None,
    )
    .await;
    assert!(untracked["valid_until"].is_null());
    assert!(untracked["validity_status"].is_null());

    // Staff set a passed date on the other document, audited with before/after.
    let expired_on = today - Duration::days(3);
    let (status, body) = json_request(
        &ctx.app,
        "POST",
        &format!("/api/v1/documents/{other}/update"),
        &ceo,
        Some(json!({ "valid_until": expired_on.to_string() })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(valid_until(&pool, other).await, Some(expired_on));
    support::wait_until("validity audit event", || {
        let pool = pool.clone();
        async move {
            sqlx::query_scalar::<_, bool>(
                r#"SELECT EXISTS (SELECT 1 FROM audit_log
                    WHERE action = 'update_document' AND entity_id = $1
                      AND context->>'valid_until' = $2
                      AND context ? 'valid_until_before')"#,
            )
            .bind(other)
            .bind(expired_on.to_string())
            .fetch_one(&pool)
            .await
            .unwrap_or(false)
        }
    })
    .await;

    // The list filter.
    let (status, expired) = json_request(
        &ctx.app,
        "GET",
        &format!("/api/v1/documents?patient_id={patient_id}&validity=expired"),
        &ceo,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{expired}");
    let ids: Vec<&str> = expired
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|item| item["id"].as_str())
        .collect();
    assert_eq!(ids, vec![other.to_string().as_str()]);
    let (_, attention) = json_request(
        &ctx.app,
        "GET",
        &format!("/api/v1/documents?patient_id={patient_id}&validity=attention"),
        &ceo,
        None,
    )
    .await;
    assert_eq!(attention.as_array().unwrap().len(), 2);
    let (status, _) = json_request(
        &ctx.app,
        "GET",
        "/api/v1/documents?validity=soon",
        &ceo,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);

    // The patient card list carries the status too.
    let (status, card) = json_request(
        &ctx.app,
        "GET",
        &format!("/api/v1/patients/{patient_id}/documents"),
        &ceo,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{card}");
    assert!(
        card.as_array()
            .unwrap()
            .iter()
            .any(|item| item["id"] == other.to_string() && item["validity_status"] == "expired")
    );

    // The daily job: the assigned manager hears once per document and stage.
    let report = gmed_server::services::document_validity::run_on(&ctx.state, today)
        .await
        .unwrap();
    assert_eq!(report.documents, 2);
    let notices: Vec<(Uuid, Value)> = sqlx::query_as(
        r#"SELECT entity_id, params FROM user_notifications
           WHERE user_id = $1 AND kind = 'document_validity' ORDER BY created_at"#,
    )
    .bind(manager)
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(notices.len(), 2);
    let stage_of = |document: Uuid| {
        notices
            .iter()
            .find(|(id, _)| *id == document)
            .map(|(_, params)| params["stage"].as_str().unwrap_or_default().to_string())
    };
    assert_eq!(stage_of(passport).as_deref(), Some("expiring"));
    assert_eq!(stage_of(other).as_deref(), Some("expired"));
    let again = gmed_server::services::document_validity::run_on(&ctx.state, today)
        .await
        .unwrap();
    assert_eq!(again.documents, 0, "a second run sends nothing");
    // On the last day the expiring document gets its second notice.
    let last_day = gmed_server::services::document_validity::run_on(&ctx.state, passport_until)
        .await
        .unwrap();
    assert_eq!(last_day.documents, 1);

    // Clearing the date stops the tracking.
    let (status, _) = json_request(
        &ctx.app,
        "POST",
        &format!("/api/v1/documents/{other}/update"),
        &ceo,
        Some(json!({ "valid_until": null })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(valid_until(&pool, other).await, None);
}
