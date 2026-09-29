//! Owner decision 2026-09-28 (Q9): signature requests the provider cannot
//! resolve are closed after an age cap, staff can abandon them with a reason,
//! and `needs_review` can be resolved. Synthetic data only.

mod support;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use serde_json::{Value, json};
use sqlx::{PgPool, Row};
use tower::ServiceExt;
use uuid::Uuid;

use gmed_server::auth::jwt;

const TEST_SECRET: &str = "test-secret-at-least-32-characters-long!!";

fn bearer(user_id: Uuid, role: &str) -> String {
    let token = jwt::issue_access_token(TEST_SECRET, user_id, role, Uuid::new_v4()).unwrap();
    format!("Bearer {token}")
}

async fn post_json(app: &axum::Router, path: &str, auth: &str, body: Value) -> (StatusCode, Value) {
    let request = Request::builder()
        .method("POST")
        .uri(path)
        .header("Authorization", auth)
        .header("Content-Type", "application/json")
        .body(Body::from(serde_json::to_vec(&body).unwrap()))
        .unwrap();
    let response = app.clone().oneshot(request).await.unwrap();
    let status = response.status();
    let bytes = axum::body::to_bytes(response.into_body(), 1024 * 1024)
        .await
        .unwrap();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(json!(null)),
    )
}

async fn seed_user(pool: &PgPool, role: &str) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO users (email, password_hash, name, role)
           VALUES ($1, 'test-password-hash', $2, $3) RETURNING id"#,
    )
    .bind(format!("sig-{}@example.com", Uuid::new_v4().simple()))
    .bind(format!("Signature {role}"))
    .bind(role)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn seed_document(pool: &PgPool, uploaded_by: Uuid) -> Uuid {
    let id = Uuid::new_v4();
    sqlx::query(
        r#"INSERT INTO documents (
                id, auto_name, original_filename, art, category, status, visibility, is_medical,
                mime_type, file_size, version_root_document_id, version_number, uploaded_by
           ) VALUES ($1, 'Contract', 'contract.pdf', 'framework_contract', 'contract', 'active',
                     'internal', false, 'application/pdf', 100, $1, 1, $2)"#,
    )
    .bind(id)
    .bind(uploaded_by)
    .execute(pool)
    .await
    .unwrap();
    id
}

#[allow(clippy::too_many_arguments)]
async fn seed_request(
    pool: &PgPool,
    source: Uuid,
    requested_by: Uuid,
    status: &str,
    provider_request_id: Option<Uuid>,
    last_error: Option<&str>,
    age_days: i64,
    result_document_id: Option<Uuid>,
) -> Uuid {
    let id = Uuid::new_v4();
    let signed = result_document_id.map(|_| "abc");
    sqlx::query(
        r#"INSERT INTO document_signature_requests (
                id, source_document_id, requested_by, source_sha256, source_context, signers,
                provider_account, test_mode, provider_request_id, status, last_error,
                result_document_id, report_storage_key, report_sha256, signed_sha256,
                created_at
           ) VALUES ($1, $2, $3, 'hash', '{}', '[]', 'test-account', true, $4, $5, $6,
                     $7, $8, $8, $8, now() - ($9::bigint * interval '1 day'))"#,
    )
    .bind(id)
    .bind(source)
    .bind(requested_by)
    .bind(provider_request_id)
    .bind(status)
    .bind(last_error)
    .bind(result_document_id)
    .bind(signed)
    .bind(age_days)
    .execute(pool)
    .await
    .unwrap();
    id
}

async fn request_state(pool: &PgPool, id: Uuid) -> (String, Option<String>, Option<String>) {
    let row = sqlx::query(
        "SELECT status, closed_kind, close_reason FROM document_signature_requests WHERE id = $1",
    )
    .bind(id)
    .fetch_one(pool)
    .await
    .unwrap();
    (
        row.get("status"),
        row.get("closed_kind"),
        row.get("close_reason"),
    )
}

#[tokio::test]
async fn untrackable_requests_are_closed_after_the_age_cap_and_staff_is_notified() {
    let Some(ctx) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let manager = seed_user(&ctx.pool, "patient_manager").await;
    let old_unknown_doc = seed_document(&ctx.pool, manager).await;
    let fresh_unknown_doc = seed_document(&ctx.pool, manager).await;
    let gone_doc = seed_document(&ctx.pool, manager).await;
    let healthy_doc = seed_document(&ctx.pool, manager).await;

    let old_unknown = seed_request(
        &ctx.pool,
        old_unknown_doc,
        manager,
        "submission_unknown",
        None,
        Some("submission_unknown"),
        10,
        None,
    )
    .await;
    let fresh_unknown = seed_request(
        &ctx.pool,
        fresh_unknown_doc,
        manager,
        "submission_unknown",
        None,
        None,
        0,
        None,
    )
    .await;
    let gone = seed_request(
        &ctx.pool,
        gone_doc,
        manager,
        "pending",
        Some(Uuid::new_v4()),
        Some("provider_not_found"),
        10,
        None,
    )
    .await;
    let healthy = seed_request(
        &ctx.pool,
        healthy_doc,
        manager,
        "pending",
        Some(Uuid::new_v4()),
        None,
        60,
        None,
    )
    .await;

    let closed = gmed_server::document_signatures::closure::close_stuck_requests(&ctx.state)
        .await
        .expect("sweep");
    assert!(closed >= 2);

    let (status, kind, _) = request_state(&ctx.pool, old_unknown).await;
    assert_eq!(
        (status.as_str(), kind.as_deref()),
        ("error", Some("auto_expired"))
    );
    let (status, kind, reason) = request_state(&ctx.pool, gone).await;
    assert_eq!(
        (status.as_str(), kind.as_deref()),
        ("error", Some("auto_expired"))
    );
    assert_eq!(reason.as_deref(), Some("provider_not_found"));
    // Young unknown submissions and healthy pending requests stay active.
    assert_eq!(
        request_state(&ctx.pool, fresh_unknown).await.0,
        "submission_unknown"
    );
    assert_eq!(request_state(&ctx.pool, healthy).await.0, "pending");

    let notified: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM user_notifications WHERE user_id = $1 AND kind = 'signature_request_failed' AND entity_id = $2",
    )
    .bind(manager)
    .bind(old_unknown_doc)
    .fetch_one(&ctx.pool)
    .await
    .unwrap();
    assert_eq!(notified, 1);
    let ceo_notified: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM user_notifications WHERE user_id = $1 AND kind = 'signature_request_failed' AND entity_id = $2",
    )
    .bind(ctx.admin_id)
    .bind(old_unknown_doc)
    .fetch_one(&ctx.pool)
    .await
    .unwrap();
    assert_eq!(ceo_notified, 1);
    let audited: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM audit_log WHERE action = 'document_signature_closed_untrackable' AND entity_id = $1",
    )
    .bind(old_unknown_doc)
    .fetch_one(&ctx.pool)
    .await
    .unwrap();
    assert_eq!(audited, 1);
}

#[tokio::test]
async fn staff_can_abandon_an_untracked_request_with_a_reason() {
    let Some(ctx) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let ceo = bearer(ctx.admin_id, "ceo");
    let doc = seed_document(&ctx.pool, ctx.admin_id).await;
    let request = seed_request(
        &ctx.pool,
        doc,
        ctx.admin_id,
        "submission_unknown",
        None,
        None,
        0,
        None,
    )
    .await;
    let path = format!("/api/v1/document-signature-requests/{request}/abandon");

    let (status, _) = post_json(&ctx.app, &path, &ceo, json!({ "reason": "short" })).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    // Billing has no signature rights.
    let billing = bearer(seed_user(&ctx.pool, "billing").await, "billing");
    let (status, _) = post_json(
        &ctx.app,
        &path,
        &billing,
        json!({ "reason": "Invitation never arrived at Skribble" }),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    let (status, body) = post_json(
        &ctx.app,
        &path,
        &ceo,
        json!({ "reason": "Invitation never arrived at Skribble" }),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let (status, kind, reason) = request_state(&ctx.pool, request).await;
    assert_eq!(status, "error");
    assert_eq!(kind.as_deref(), Some("abandoned"));
    assert_eq!(
        reason.as_deref(),
        Some("Invitation never arrived at Skribble")
    );
    let audited: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM audit_log WHERE action = 'document_signature_abandoned' AND entity_id = $1 AND user_id = $2",
    )
    .bind(doc)
    .bind(ctx.admin_id)
    .fetch_one(&ctx.pool)
    .await
    .unwrap();
    assert_eq!(audited, 1);

    // The document is free for a new request; a second abandon is refused.
    let (status, _) = post_json(
        &ctx.app,
        &path,
        &ceo,
        json!({ "reason": "Invitation never arrived at Skribble" }),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);

    // A healthy pending request is withdrawn, not abandoned.
    let doc = seed_document(&ctx.pool, ctx.admin_id).await;
    let pending = seed_request(
        &ctx.pool,
        doc,
        ctx.admin_id,
        "pending",
        Some(Uuid::new_v4()),
        None,
        0,
        None,
    )
    .await;
    let (status, _) = post_json(
        &ctx.app,
        &format!("/api/v1/document-signature-requests/{pending}/abandon"),
        &ceo,
        json!({ "reason": "Invitation never arrived at Skribble" }),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
}

#[tokio::test]
async fn needs_review_is_resolved_by_accepting_or_rejecting() {
    let Some(ctx) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let ceo = bearer(ctx.admin_id, "ceo");
    let mut requests = Vec::new();
    for _ in 0..2 {
        let doc = seed_document(&ctx.pool, ctx.admin_id).await;
        let result = seed_document(&ctx.pool, ctx.admin_id).await;
        requests.push(
            seed_request(
                &ctx.pool,
                doc,
                ctx.admin_id,
                "needs_review",
                Some(Uuid::new_v4()),
                Some("document_changed"),
                0,
                Some(result),
            )
            .await,
        );
    }
    let path = |id: Uuid| format!("/api/v1/document-signature-requests/{id}/resolve-review");

    let (status, _) = post_json(
        &ctx.app,
        &path(requests[0]),
        &ceo,
        json!({ "decision": "maybe", "reason": "Checked against the source" }),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);

    let (status, body) = post_json(
        &ctx.app,
        &path(requests[0]),
        &ceo,
        json!({ "decision": "accept", "reason": "Only the file name changed" }),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let (status, kind, _) = request_state(&ctx.pool, requests[0]).await;
    assert_eq!(
        (status.as_str(), kind.as_deref()),
        ("completed", Some("review_accepted"))
    );

    let (status, body) = post_json(
        &ctx.app,
        &path(requests[1]),
        &ceo,
        json!({ "decision": "reject", "reason": "Fee changed after sending" }),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let (status, kind, _) = request_state(&ctx.pool, requests[1]).await;
    assert_eq!(
        (status.as_str(), kind.as_deref()),
        ("error", Some("review_rejected"))
    );

    // Resolved once only.
    let (status, _) = post_json(
        &ctx.app,
        &path(requests[1]),
        &ceo,
        json!({ "decision": "accept", "reason": "Second thoughts on it" }),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
}
