//! GoBD correction documents and dunning rules (status audit 2026-09-28,
//! Q2, Q3/Q4, Q9/Q10, Q14): cancellation documents of released invoices,
//! gapless archived credit notes, the "credited" display status, dunning
//! blocks, the grace period and debt states that stop automatic dunning.

mod support;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use serde_json::{Value, json};
use sqlx::PgPool;
use tower::ServiceExt;
use uuid::Uuid;

use gmed_server::auth::jwt;

const TEST_SECRET: &str = "test-secret-at-least-32-characters-long!!";

fn auth_header(user_id: Uuid, role: &str) -> String {
    let token = jwt::issue_access_token(TEST_SECRET, user_id, role, Uuid::new_v4()).unwrap();
    format!("Bearer {token}")
}

async fn request_json(
    app: &axum::Router,
    method: &str,
    path: &str,
    bearer: &str,
    body: Option<Value>,
) -> (StatusCode, Value) {
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(method)
                .uri(path)
                .header("Authorization", bearer)
                .header("Content-Type", "application/json")
                .body(body.map_or_else(Body::empty, |value| {
                    Body::from(serde_json::to_vec(&value).unwrap())
                }))
                .unwrap(),
        )
        .await
        .unwrap();
    let status = response.status();
    let bytes = axum::body::to_bytes(response.into_body(), 1024 * 1024)
        .await
        .unwrap();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(json!(null)),
    )
}

/// Status, `x-gmed-invoice-document` header and PDF body of a download.
async fn download(app: &axum::Router, path: &str, bearer: &str) -> (StatusCode, String, Vec<u8>) {
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(path)
                .header("Authorization", bearer)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let status = response.status();
    let source = response
        .headers()
        .get("x-gmed-invoice-document")
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default()
        .to_string();
    let bytes = axum::body::to_bytes(response.into_body(), 8 * 1024 * 1024)
        .await
        .unwrap()
        .to_vec();
    (status, source, bytes)
}

/// A released EUR invoice with a 19 % service and a 0 % pass-through hotel.
async fn seed_released_invoice(
    pool: &PgPool,
    admin_id: Uuid,
    tag: &str,
    due_in_days: i32,
) -> (Uuid, Uuid, Uuid) {
    let patient_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO patients (
                patient_id, first_name, last_name, birth_date, gender, created_by, languages
           ) VALUES ($1, 'Storno', 'Test', '1985-03-04', 'diverse', $2, ARRAY['de'])
           RETURNING id"#,
    )
    .bind(format!("PT-{tag}"))
    .bind(admin_id)
    .fetch_one(pool)
    .await
    .unwrap();
    let order_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO orders (order_number, patient_id, phase, status, currency, created_by)
           VALUES ($1, $2, 'execution', 'active', 'EUR', $3)
           RETURNING id"#,
    )
    .bind(format!("ORD-{tag}"))
    .bind(patient_id)
    .bind(admin_id)
    .fetch_one(pool)
    .await
    .unwrap();
    let invoice_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO invoices (
                order_id, patient_id, invoice_number, invoice_type, status,
                issued_at, due_date, total_net, total_vat, total_gross,
                paid_amount, line_items, portal_visible,
                hide_amounts_from_patient, created_by
           ) VALUES (
                $1, $2, $3, 'final', 'sent', now() - interval '20 days',
                CURRENT_DATE + $5, 981.50, 95, 1076.50, 0,
                '[{"description":"Behandlungsorganisation","quantity":"1","unit_price":"500","vat_rate":"19","is_cost_passthrough":false,"line_net":"500","line_vat":"95","line_gross":"595"},
                  {"description":"Hotel","quantity":"3","unit_price":"160.5","vat_rate":"0","is_cost_passthrough":true,"line_net":"481.50","line_vat":"0","line_gross":"481.50"}]',
                true, false, $4
           ) RETURNING id"#,
    )
    .bind(order_id)
    .bind(patient_id)
    .bind(format!("INV-{tag}"))
    .bind(admin_id)
    .bind(due_in_days)
    .fetch_one(pool)
    .await
    .unwrap();
    (patient_id, order_id, invoice_id)
}

async fn audit_count(pool: &PgPool, action: &str, invoice_id: Uuid) -> i64 {
    sqlx::query_scalar(
        "SELECT count(*) FROM audit_log WHERE action = $1 AND entity_type = 'invoice' AND entity_id = $2",
    )
    .bind(action)
    .bind(invoice_id)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn counter(pool: &PgPool, series: &str) -> i64 {
    sqlx::query_scalar("SELECT last_value FROM invoice_document_number_counters WHERE series = $1")
        .bind(series)
        .fetch_one(pool)
        .await
        .unwrap()
}

#[tokio::test]
async fn cancelling_a_released_invoice_issues_an_archived_cancellation_document() {
    let Some(ctx) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let tag = format!("storno-{}", Uuid::new_v4().simple());
    let (_, _, invoice_id) = seed_released_invoice(&ctx.pool, ctx.admin_id, &tag, 10).await;
    let (_, _, second_id) =
        seed_released_invoice(&ctx.pool, ctx.admin_id, &format!("{tag}-2"), 10).await;
    let ceo = auth_header(ctx.admin_id, "ceo");

    let (status, cancelled) = request_json(
        &ctx.app,
        "POST",
        &format!("/api/v1/invoices/{invoice_id}/status"),
        &ceo,
        Some(json!({ "status": "cancelled", "reason": "Behandlung abgesagt" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{cancelled:?}");
    assert_eq!(cancelled["status"], "cancelled");
    let storno = &cancelled["storno_document"];
    let number = storno["document_number"].as_str().unwrap().to_string();
    assert!(number.starts_with("STORNO-"), "{storno:?}");
    assert_eq!(storno["original_invoice_number"], format!("INV-{tag}"));
    assert_eq!(storno["reason"], "Behandlung abgesagt");
    assert_eq!(storno["amount_gross"], "-1076.5");
    assert_eq!(storno["amount_vat"], "-95");
    let breakdown = storno["vat_breakdown"].as_array().unwrap();
    assert_eq!(breakdown.len(), 2, "{breakdown:?}");
    assert_eq!(breakdown[0]["gross"], "-481.5");
    assert_eq!(breakdown[1]["vat"], "-95");
    assert_eq!(storno["stored_document"]["generation_trigger"], "issue");
    // The audit row is written in the cancelling transaction.
    assert_eq!(
        audit_count(&ctx.pool, "update_invoice_status", invoice_id).await,
        1
    );

    let (status, source, bytes) = download(
        &ctx.app,
        &format!("/api/v1/invoices/{invoice_id}/storno/pdf"),
        &ceo,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(source, "stored");
    assert!(bytes.starts_with(b"%PDF"));

    // The next cancellation takes the next number of the range.
    let before = counter(&ctx.pool, "invoice_storno").await;
    let (status, second) = request_json(
        &ctx.app,
        "POST",
        &format!("/api/v1/invoices/{second_id}/status"),
        &ceo,
        Some(json!({ "status": "cancelled" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{second:?}");
    assert_eq!(counter(&ctx.pool, "invoice_storno").await, before + 1);
    assert!(
        second["storno_document"]["reason"]
            .as_str()
            .unwrap()
            .contains(&format!("INV-{tag}-2"))
    );

    // The document is final.
    let changed =
        sqlx::query("UPDATE invoice_storno_documents SET reason = 'x' WHERE invoice_id = $1")
            .bind(invoice_id)
            .execute(&ctx.pool)
            .await;
    assert!(changed.is_err());
}

#[tokio::test]
async fn cancelling_a_draft_issues_no_cancellation_document() {
    let Some(ctx) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let tag = format!("storno-draft-{}", Uuid::new_v4().simple());
    let (_, _, invoice_id) = seed_released_invoice(&ctx.pool, ctx.admin_id, &tag, 10).await;
    // A second invoice of the same order as an unnumbered draft.
    let draft_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO invoices (order_id, patient_id, invoice_type, status, total_net, total_vat,
                                 total_gross, line_items, created_by)
           SELECT order_id, patient_id, 'interim', 'draft', 10, 0, 10, '[]', created_by
           FROM invoices WHERE id = $1
           RETURNING id"#,
    )
    .bind(invoice_id)
    .fetch_one(&ctx.pool)
    .await
    .unwrap();
    let ceo = auth_header(ctx.admin_id, "ceo");
    let (status, cancelled) = request_json(
        &ctx.app,
        "POST",
        &format!("/api/v1/invoices/{draft_id}/status"),
        &ceo,
        Some(json!({ "status": "cancelled" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{cancelled:?}");
    assert!(cancelled["storno_document"].is_null());
}

#[tokio::test]
async fn credit_notes_are_numbered_without_gaps_archived_and_fully_credited_shows_credited() {
    let Some(ctx) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let tag = format!("cn-gapless-{}", Uuid::new_v4().simple());
    let (patient_id, _, invoice_id) =
        seed_released_invoice(&ctx.pool, ctx.admin_id, &tag, 10).await;
    let ceo = auth_header(ctx.admin_id, "ceo");
    let today = gmed_server::app_time::today().to_string();

    // A refused credit note (more than the line) takes no number.
    let before = counter(&ctx.pool, "credit_note").await;
    let (status, _) = request_json(
        &ctx.app,
        "POST",
        &format!("/api/v1/invoices/{invoice_id}/credit-notes"),
        &ceo,
        Some(json!({
            "request_id": Uuid::new_v4(),
            "lines": [{ "line_index": 1, "amount_gross": "999" }],
            "reason": "Zu viel",
            "issued_on": today,
        })),
    )
    .await;
    assert!(status.is_client_error());
    assert_eq!(counter(&ctx.pool, "credit_note").await, before);

    // Crediting every line: one number, a stored document, credited status.
    let (status, created) = request_json(
        &ctx.app,
        "POST",
        &format!("/api/v1/invoices/{invoice_id}/credit-notes"),
        &ceo,
        Some(json!({
            "request_id": Uuid::new_v4(),
            "lines": [{ "line_index": 0 }, { "line_index": 1 }],
            "reason": "Leistung entfallen",
            "issued_on": today,
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{created:?}");
    let sequence = counter(&ctx.pool, "credit_note").await;
    assert_eq!(sequence, before + 1);
    assert!(
        created["document_number"]
            .as_str()
            .unwrap()
            .ends_with(&format!("{sequence:06}"))
    );
    assert_eq!(
        audit_count(&ctx.pool, "credit_note_created", invoice_id).await,
        1
    );
    let credit_id = created["credit_note_transaction_id"]
        .as_str()
        .unwrap()
        .to_string();
    let stored: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM invoice_documents WHERE credit_note_transaction_id = $1::uuid AND generation_trigger = 'issue'",
    )
    .bind(&credit_id)
    .fetch_one(&ctx.pool)
    .await
    .unwrap();
    assert_eq!(stored, 1);
    let (status, source, first) = download(
        &ctx.app,
        &format!("/api/v1/invoices/{invoice_id}/credit-notes/{credit_id}/pdf"),
        &ceo,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(source, "stored");
    // A changed agency profile does not change the archived document.
    sqlx::query(
        "UPDATE system_settings SET value = '\"GMED Test Renamed\"' WHERE key = 'agency_name'",
    )
    .execute(&ctx.pool)
    .await
    .ok();
    let (_, _, second) = download(
        &ctx.app,
        &format!("/api/v1/invoices/{invoice_id}/credit-notes/{credit_id}/pdf"),
        &ceo,
    )
    .await;
    assert_eq!(first, second);

    assert_eq!(created["invoice"]["status"], "paid");
    assert_eq!(created["invoice"]["display_status"], "credited");
    let (status, list) = request_json(
        &ctx.app,
        "GET",
        &format!("/api/v1/invoices?patient_id={patient_id}&status=credited"),
        &ceo,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{list:?}");
    assert_eq!(list["items"].as_array().unwrap().len(), 1);
    assert_eq!(list["items"][0]["display_status"], "credited");
    let (_, paid) = request_json(
        &ctx.app,
        "GET",
        &format!("/api/v1/invoices?patient_id={patient_id}&status=paid"),
        &ceo,
        None,
    )
    .await;
    assert!(paid["items"].as_array().unwrap().is_empty(), "{paid:?}");

    // The reversal is numbered from the same range and archived as well.
    let (status, reversed) = request_json(
        &ctx.app,
        "POST",
        &format!("/api/v1/invoices/{invoice_id}/credit-notes/{credit_id}/reversal"),
        &ceo,
        Some(json!({ "reason": "Irrtum" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{reversed:?}");
    assert_eq!(counter(&ctx.pool, "credit_note").await, sequence + 1);
    assert_ne!(reversed["invoice"]["display_status"], "credited");
    let reversal_id = reversed["reversal_transaction_id"].as_str().unwrap();
    let stored: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM invoice_documents WHERE credit_note_transaction_id = $1::uuid",
    )
    .bind(reversal_id)
    .fetch_one(&ctx.pool)
    .await
    .unwrap();
    assert_eq!(stored, 1);
}

async fn run_scheduler(ctx: &support::TestSuiteContext) {
    gmed_server::routes::invoices::run_auto_dunning_scheduler_once(&ctx.state)
        .await
        .unwrap();
}

async fn dunning_levels(pool: &PgPool, invoice_id: Uuid) -> Vec<String> {
    sqlx::query_scalar(
        "SELECT level FROM invoice_dunning_events WHERE invoice_id = $1 ORDER BY sent_at, created_at",
    )
    .bind(invoice_id)
    .fetch_all(pool)
    .await
    .unwrap()
}

async fn invoice_status(pool: &PgPool, invoice_id: Uuid) -> String {
    sqlx::query_scalar("SELECT status FROM invoices WHERE id = $1")
        .bind(invoice_id)
        .fetch_one(pool)
        .await
        .unwrap()
}

#[tokio::test]
async fn dunning_respects_blocks_grace_period_and_debt_states() {
    let Some(ctx) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let tag = format!("dunning-rules-{}", Uuid::new_v4().simple());
    let ceo = auth_header(ctx.admin_id, "ceo");
    // Due 3 days ago: overdue, but still inside the 7-day grace period.
    let (_, _, in_grace) =
        seed_released_invoice(&ctx.pool, ctx.admin_id, &format!("{tag}-grace"), -3).await;
    // Due 20 days ago: first reminder is due.
    let (_, _, late) =
        seed_released_invoice(&ctx.pool, ctx.admin_id, &format!("{tag}-late"), -20).await;
    // Due 20 days ago, but a payment plan runs for the order.
    let (_, plan_order, on_plan) =
        seed_released_invoice(&ctx.pool, ctx.admin_id, &format!("{tag}-plan"), -20).await;
    sqlx::query("INSERT INTO order_debt_management (order_id, status) VALUES ($1, 'payment_plan')")
        .bind(plan_order)
        .execute(&ctx.pool)
        .await
        .unwrap();
    // Due 20 days ago, blocked for dunning.
    let (_, _, blocked) =
        seed_released_invoice(&ctx.pool, ctx.admin_id, &format!("{tag}-blocked"), -20).await;
    let (status, detail) = request_json(
        &ctx.app,
        "POST",
        &format!("/api/v1/invoices/{blocked}/dunning-block"),
        &ceo,
        Some(json!({ "reason": "Reklamation offen" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{detail:?}");
    assert_eq!(
        detail["dunning_block"]["active"]["reason"],
        "Reklamation offen"
    );
    assert_eq!(
        audit_count(&ctx.pool, "set_invoice_dunning_block", blocked).await,
        1
    );

    run_scheduler(&ctx).await;

    assert_eq!(invoice_status(&ctx.pool, in_grace).await, "overdue");
    assert!(dunning_levels(&ctx.pool, in_grace).await.is_empty());
    assert_eq!(
        dunning_levels(&ctx.pool, late).await,
        vec!["first".to_string()]
    );
    assert_eq!(
        audit_count(&ctx.pool, "auto_create_invoice_dunning_event", late).await,
        1
    );
    assert_eq!(invoice_status(&ctx.pool, on_plan).await, "overdue");
    assert!(dunning_levels(&ctx.pool, on_plan).await.is_empty());
    assert_eq!(invoice_status(&ctx.pool, blocked).await, "sent");
    assert!(dunning_levels(&ctx.pool, blocked).await.is_empty());

    // Manual dunning is refused while the block is active.
    let (status, _) = request_json(
        &ctx.app,
        "POST",
        &format!("/api/v1/invoices/{blocked}/dunning"),
        &ceo,
        Some(json!({ "level": "first" })),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);

    // Overdue back to sent needs a reason and sets a block the scheduler keeps.
    let (status, _) = request_json(
        &ctx.app,
        "POST",
        &format!("/api/v1/invoices/{in_grace}/status"),
        &ceo,
        Some(json!({ "status": "sent" })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    let (status, back) = request_json(
        &ctx.app,
        "POST",
        &format!("/api/v1/invoices/{in_grace}/status"),
        &ceo,
        Some(json!({ "status": "sent", "reason": "Zahlung zugesagt bis Monatsende" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{back:?}");
    assert_eq!(back["status"], "sent");
    assert_eq!(
        back["dunning_block"]["active"]["reason"],
        "Zahlung zugesagt bis Monatsende"
    );
    run_scheduler(&ctx).await;
    assert_eq!(invoice_status(&ctx.pool, in_grace).await, "sent");

    // Clearing the block (with a reason) lets the scheduler escalate again.
    let (status, cleared) = request_json(
        &ctx.app,
        "POST",
        &format!("/api/v1/invoices/{blocked}/dunning-block/clear"),
        &ceo,
        Some(json!({ "reason": "Reklamation erledigt" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{cleared:?}");
    assert!(cleared["dunning_block"]["active"].is_null());
    assert_eq!(
        cleared["dunning_block"]["history"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    run_scheduler(&ctx).await;
    assert_eq!(invoice_status(&ctx.pool, blocked).await, "overdue");
    assert_eq!(
        dunning_levels(&ctx.pool, blocked).await,
        vec!["first".to_string()]
    );

    // Billing's read-only colleagues cannot block.
    let assistant_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO users (email, password_hash, name, role)
           VALUES ($1, 'test-password-hash', 'Assistant', 'ceo_assistant')
           RETURNING id"#,
    )
    .bind(format!("{tag}-assistant@example.com"))
    .fetch_one(&ctx.pool)
    .await
    .unwrap();
    let assistant = auth_header(assistant_id, "ceo_assistant");
    let (status, _) = request_json(
        &ctx.app,
        "POST",
        &format!("/api/v1/invoices/{late}/dunning-block"),
        &assistant,
        Some(json!({ "reason": "Nicht erlaubt" })),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}
