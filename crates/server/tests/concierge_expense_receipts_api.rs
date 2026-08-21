mod support;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use chrono::{Duration, Utc};
use rust_decimal::Decimal;
use serde_json::{Value, json};
use sqlx::{PgPool, Row};
use tower::ServiceExt;
use uuid::Uuid;

use gmed_server::auth::jwt;

const TEST_SECRET: &str = "test-secret-at-least-32-characters-long!!";

fn auth_header(user_id: Uuid, role: &str) -> String {
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
    let request = Request::builder()
        .method(method)
        .uri(path)
        .header("Authorization", bearer)
        .header("Content-Type", "application/json")
        .body(body.map_or_else(Body::empty, |value| {
            Body::from(serde_json::to_vec(&value).unwrap())
        }))
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

async fn multipart_request(
    app: &axum::Router,
    path: &str,
    bearer: &str,
    fields: &[(String, String)],
    filename: &str,
    mime_type: &str,
    file: &[u8],
) -> (StatusCode, Value) {
    let boundary = format!("----gmed-expense-{}", Uuid::new_v4().simple());
    let mut body = Vec::new();
    for (name, value) in fields {
        body.extend_from_slice(format!("--{boundary}\r\n").as_bytes());
        body.extend_from_slice(
            format!("Content-Disposition: form-data; name=\"{name}\"\r\n\r\n").as_bytes(),
        );
        body.extend_from_slice(value.as_bytes());
        body.extend_from_slice(b"\r\n");
    }
    body.extend_from_slice(format!("--{boundary}\r\n").as_bytes());
    body.extend_from_slice(
        format!(
            "Content-Disposition: form-data; name=\"file\"; filename=\"{filename}\"\r\nContent-Type: {mime_type}\r\n\r\n"
        )
        .as_bytes(),
    );
    body.extend_from_slice(file);
    body.extend_from_slice(b"\r\n");
    body.extend_from_slice(format!("--{boundary}--\r\n").as_bytes());
    let request = Request::builder()
        .method("POST")
        .uri(path)
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

async fn seed_user(pool: &PgPool, role: &str, tag: &str) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO users (email, password_hash, name, role)
           VALUES ($1, 'test-hash', $2, $3) RETURNING id"#,
    )
    .bind(format!("expense-{tag}-{role}@example.test"))
    .bind(format!("Expense {role} {tag}"))
    .bind(role)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn seed_financial_fixture(
    pool: &PgPool,
    admin_id: Uuid,
    concierge_id: Uuid,
    tag: &str,
) -> (Uuid, Uuid, Uuid, Uuid, Uuid) {
    let patient_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO patients (
               patient_id, first_name, last_name, birth_date, gender, created_by
           ) VALUES ($1, 'Concierge', 'Receipt', '1990-01-01', 'diverse', $2)
           RETURNING id"#,
    )
    .bind(format!("CRE-{tag}"))
    .bind(admin_id)
    .fetch_one(pool)
    .await
    .unwrap();
    let provider_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO providers (
               name, provider_type, address_city, address_country, is_active
           ) VALUES ($1, 'non_medical', 'Berlin', 'Germany', true)
           RETURNING id"#,
    )
    .bind(format!("Concierge Partner {tag}"))
    .fetch_one(pool)
    .await
    .unwrap();
    let service_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO concierge_services (
               patient_id, provider_id, assigned_concierge_id, service_kind,
               title, currency, created_by
           ) VALUES ($1, $2, $3, 'transport', 'Airport transfer', 'EUR', $4)
           RETURNING id"#,
    )
    .bind(patient_id)
    .bind(provider_id)
    .bind(concierge_id)
    .bind(admin_id)
    .fetch_one(pool)
    .await
    .unwrap();
    let order_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO orders (
               order_number, patient_id, phase, status, currency, created_by
           ) VALUES ($1, $2, 'execution', 'active', 'EUR', $3)
           RETURNING id"#,
    )
    .bind(format!("CRE-ORD-{tag}"))
    .bind(patient_id)
    .bind(admin_id)
    .fetch_one(pool)
    .await
    .unwrap();
    let order_leistung_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO order_leistungen (
               order_id, patient_id, description, quantity, unit_price,
               currency, vat_rate, provider_id, status,
               agency_service_name_snapshot, agency_service_description_snapshot
           ) VALUES (
               $1, $2, 'Airport transfer snapshot', 1, 100,
               'EUR', 19, $3, 'approved',
               'Airport transfer', 'Private driver and pickup'
           ) RETURNING id"#,
    )
    .bind(order_id)
    .bind(patient_id)
    .bind(provider_id)
    .fetch_one(pool)
    .await
    .unwrap();
    (patient_id, provider_id, service_id, order_id, order_leistung_id)
}

fn submission_fields(
    request_id: Uuid,
    paid_by: &str,
    service_delivered: bool,
    expense_date: chrono::NaiveDate,
) -> Vec<(String, String)> {
    vec![
        ("request_id".to_string(), request_id.to_string()),
        ("vendor".to_string(), "Berlin Driver GmbH".to_string()),
        ("expense_date".to_string(), expense_date.to_string()),
        ("amount_net".to_string(), "100.00".to_string()),
        ("amount_vat".to_string(), "19.00".to_string()),
        ("amount_gross".to_string(), "119.00".to_string()),
        ("currency".to_string(), "EUR".to_string()),
        ("paid_by".to_string(), paid_by.to_string()),
        (
            "service_delivered".to_string(),
            service_delivered.to_string(),
        ),
        ("note".to_string(), "Airport receipt".to_string()),
    ]
}

fn pdf_receipt(tag: &str) -> Vec<u8> {
    format!("%PDF-1.4\n% GMED receipt {tag}\n%%EOF\n").into_bytes()
}

async fn submit_fixture_expense(
    app: &axum::Router,
    bearer: &str,
    service_id: Uuid,
    request_id: Uuid,
    paid_by: &str,
    delivered: bool,
    expense_date: chrono::NaiveDate,
    receipt_tag: &str,
) -> (StatusCode, Value) {
    multipart_request(
        app,
        &format!("/api/v1/concierge-services/{service_id}/expenses"),
        bearer,
        &submission_fields(request_id, paid_by, delivered, expense_date),
        &format!("receipt-{receipt_tag}.pdf"),
        "application/pdf",
        &pdf_receipt(receipt_tag),
    )
    .await
}

#[tokio::test]
async fn assigned_concierge_submits_private_idempotent_pending_receipt() {
    let Some(context) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let tag = Uuid::new_v4().simple().to_string();
    let concierge_id = seed_user(&context.pool, "concierge", &format!("owner-{tag}")).await;
    let other_concierge_id =
        seed_user(&context.pool, "concierge", &format!("other-{tag}")).await;
    let billing_id = seed_user(&context.pool, "billing", &format!("review-{tag}")).await;
    let (patient_id, provider_id, service_id, order_id, _order_leistung_id) =
        seed_financial_fixture(&context.pool, context.admin_id, concierge_id, &tag).await;
    let owner = auth_header(concierge_id, "concierge");
    let other = auth_header(other_concierge_id, "concierge");
    let request_id = Uuid::new_v4();
    let expense_date = Utc::now().date_naive() - Duration::days(2);

    let unrelated_external_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO external_invoices (
               order_id, patient_id, provider_id, external_invoice_number,
               invoice_date, amount_net, amount_vat, amount_gross, currency,
               status, paid_by, service_delivered, created_by
           ) VALUES ($1, $2, $3, $4, $5, 10, 1.90, 11.90, 'EUR',
                     'received', 'unpaid', false, $6)
           RETURNING id"#,
    )
    .bind(order_id)
    .bind(patient_id)
    .bind(provider_id)
    .bind(format!("UNRELATED-{tag}"))
    .bind(expense_date)
    .bind(context.admin_id)
    .fetch_one(&context.pool)
    .await
    .unwrap();
    let deleted = sqlx::query("DELETE FROM external_invoices WHERE id = $1")
        .bind(unrelated_external_id)
        .execute(&context.pool)
        .await
        .unwrap();
    assert_eq!(deleted.rows_affected(), 1, "unlinked invoice delete must not be suppressed");

    let (status, private_context) = json_request(
        &context.app,
        "GET",
        &format!("/api/v1/concierge-services/{service_id}/expense-context"),
        &owner,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{private_context}");
    assert_eq!(private_context["service"]["id"], service_id.to_string());
    assert!(private_context["mapped_order"].is_null());
    assert_eq!(private_context["eligible_orders"].as_array().unwrap().len(), 0);

    let mut oversized_money_fields =
        submission_fields(Uuid::new_v4(), "patient", true, expense_date);
    for (name, value) in &mut oversized_money_fields {
        if name == "amount_net" || name == "amount_gross" {
            *value = "10000000000.00".to_string();
        } else if name == "amount_vat" {
            *value = "0.00".to_string();
        }
    }
    let (status, oversized_money) = multipart_request(
        &context.app,
        &format!("/api/v1/concierge-services/{service_id}/expenses"),
        &owner,
        &oversized_money_fields,
        "oversized.pdf",
        "application/pdf",
        &pdf_receipt(&format!("oversized-{tag}")),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{oversized_money}");

    let (status, created) = submit_fixture_expense(
        &context.app,
        &owner,
        service_id,
        request_id,
        "agency",
        true,
        expense_date,
        &tag,
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{created}");
    assert_eq!(created["item"]["status"], "pending_review");
    assert!(created["item"]["order_id"].is_null());
    assert_eq!(created["item"]["balance_consequence"]["patient_receivable_gross"], "0");
    assert_eq!(created["item"]["balance_consequence"]["intended_patient_receivable_gross"], "119.00");
    let expense_id = Uuid::parse_str(created["item"]["id"].as_str().unwrap()).unwrap();
    for user_id in [context.admin_id, billing_id] {
        let notification_count: i64 = sqlx::query_scalar(
            r#"SELECT count(*) FROM user_notifications
               WHERE user_id = $1
                 AND kind = 'concierge_expense_submitted'
                 AND entity_type = 'concierge_expense'
                 AND entity_id = $2"#,
        )
        .bind(user_id)
        .bind(expense_id)
        .fetch_one(&context.pool)
        .await
        .unwrap();
        assert_eq!(notification_count, 1, "finance must receive one review notification");
    }
    for user_id in [concierge_id, other_concierge_id] {
        let notification_count: i64 = sqlx::query_scalar(
            r#"SELECT count(*) FROM user_notifications
               WHERE user_id = $1
                 AND entity_type = 'concierge_expense'
                 AND entity_id = $2"#,
        )
        .bind(user_id)
        .bind(expense_id)
        .fetch_one(&context.pool)
        .await
        .unwrap();
        assert_eq!(notification_count, 0, "submission notification must stay finance-only");
    }
    let receipt_document_id = Uuid::parse_str(
        created["item"]["receipt"]["document_id"]
            .as_str()
            .unwrap(),
    )
    .unwrap();
    sqlx::query(
        r#"INSERT INTO patient_assignments (patient_id, user_id, assigned_by)
           VALUES ($1, $2, $3)"#,
    )
    .bind(patient_id)
    .bind(other_concierge_id)
    .bind(context.admin_id)
    .execute(&context.pool)
    .await
    .unwrap();
    let (status, _) = json_request(
        &context.app,
        "GET",
        &format!("/api/v1/documents/{receipt_document_id}/download"),
        &other,
        None,
    )
    .await;
    assert_eq!(
        status,
        StatusCode::FORBIDDEN,
        "patient assignment must not bypass receipt-specific access"
    );

    let external_count: i64 = sqlx::query_scalar(
        r#"SELECT count(*) FROM concierge_expense_review_events
           WHERE expense_id = $1 AND action = 'posted'"#,
    )
    .bind(expense_id)
    .fetch_one(&context.pool)
    .await
    .unwrap();
    assert_eq!(external_count, 0, "pending review must not create financial state");

    let (status, replay) = submit_fixture_expense(
        &context.app,
        &owner,
        service_id,
        request_id,
        "agency",
        true,
        expense_date,
        &tag,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{replay}");
    assert_eq!(replay["idempotent_replay"], true);
    assert_eq!(replay["item"]["id"], expense_id.to_string());
    let replay_notification_count: i64 = sqlx::query_scalar(
        r#"SELECT count(*) FROM user_notifications
           WHERE user_id = $1
             AND kind = 'concierge_expense_submitted'
             AND entity_id = $2"#,
    )
    .bind(billing_id)
    .bind(expense_id)
    .fetch_one(&context.pool)
    .await
    .unwrap();
    assert_eq!(replay_notification_count, 1, "idempotent replay must not notify twice");

    let (status, duplicate_receipt) = submit_fixture_expense(
        &context.app,
        &owner,
        service_id,
        Uuid::new_v4(),
        "agency",
        true,
        expense_date,
        &tag,
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{duplicate_receipt}");

    let (status, forbidden) = submit_fixture_expense(
        &context.app,
        &other,
        service_id,
        Uuid::new_v4(),
        "patient",
        true,
        expense_date,
        &format!("forbidden-{tag}"),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN, "{forbidden}");

    let submission_count: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM concierge_expense_submissions WHERE concierge_service_id = $1",
    )
    .bind(service_id)
    .fetch_one(&context.pool)
    .await
    .unwrap();
    let document_count: i64 = sqlx::query_scalar(
        r#"SELECT count(*) FROM documents
           WHERE ursprung = 'concierge_expense_receipt'
             AND id IN (SELECT receipt_document_id FROM concierge_expense_submissions WHERE concierge_service_id = $1)"#,
    )
    .bind(service_id)
    .fetch_one(&context.pool)
    .await
    .unwrap();
    assert_eq!(submission_count, 1);
    assert_eq!(document_count, 1);

    for (index, (submitted_delivered, external_delivered)) in
        [(false, true), (true, false)].into_iter().enumerate()
    {
        let mismatch_tag = format!("delivery-mismatch-{tag}-{index}");
        let (status, mismatch_submission) = submit_fixture_expense(
            &context.app,
            &owner,
            service_id,
            Uuid::new_v4(),
            "patient",
            submitted_delivered,
            expense_date,
            &mismatch_tag,
        )
        .await;
        assert_eq!(status, StatusCode::CREATED, "{mismatch_submission}");
        let mismatch_expense_id = Uuid::parse_str(
            mismatch_submission["item"]["id"].as_str().unwrap(),
        )
        .unwrap();
        let mismatch_external_id: Uuid = sqlx::query_scalar(
            r#"INSERT INTO external_invoices (
                   order_id, patient_id, provider_id, external_invoice_number,
                   invoice_date, amount_net, amount_vat, amount_gross, currency,
                   status, paid_by, service_delivered, paid_at, created_by
               ) VALUES ($1, $2, $3, $4, $5, 100, 19, 119, 'EUR',
                         'paid', 'patient', $6, now(), $7)
               RETURNING id"#,
        )
        .bind(order_id)
        .bind(patient_id)
        .bind(provider_id)
        .bind(format!("MISMATCH-{tag}-{index}"))
        .bind(expense_date)
        .bind(external_delivered)
        .bind(context.admin_id)
        .fetch_one(&context.pool)
        .await
        .unwrap();
        let result = sqlx::query(
            r#"INSERT INTO concierge_expense_review_events (
                   expense_id, request_id, action, external_invoice_id,
                   payload_hash, decided_by
               ) VALUES ($1, $2, 'posted', $3, $4, $5)"#,
        )
        .bind(mismatch_expense_id)
        .bind(Uuid::new_v4())
        .bind(mismatch_external_id)
        .bind("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
        .bind(context.admin_id)
        .execute(&context.pool)
        .await;
        assert!(
            result.is_err(),
            "review trigger must reject delivery snapshot mismatch in either direction"
        );
    }
}

#[tokio::test]
async fn finance_posting_preserves_all_payer_and_delivery_balance_semantics() {
    let Some(context) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let tag = Uuid::new_v4().simple().to_string();
    let concierge_id = seed_user(&context.pool, "concierge", &format!("payer-{tag}")).await;
    let (_patient_id, _provider_id, service_id, order_id, order_leistung_id) =
        seed_financial_fixture(&context.pool, context.admin_id, concierge_id, &tag).await;
    let account_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO company_financial_accounts (
               name, account_type, currency, opening_balance, opening_balance_on,
               is_default, is_active, created_by
           ) VALUES ($1, 'bank', 'EUR', 0, '2020-01-01', false, true, $2)
           RETURNING id"#,
    )
    .bind(format!("Concierge receipts {tag}"))
    .bind(context.admin_id)
    .fetch_one(&context.pool)
    .await
    .unwrap();
    let concierge = auth_header(concierge_id, "concierge");
    let finance = auth_header(context.admin_id, "ceo");
    let expense_date = Utc::now().date_naive() - Duration::days(3);
    let paid_on = expense_date + Duration::days(2);

    for (index, (paid_by, delivered, expected_receivable, expected_liability)) in [
        ("patient", false, Decimal::ZERO, Decimal::ZERO),
        ("patient", true, Decimal::ZERO, Decimal::ZERO),
        ("agency", false, Decimal::new(119, 0), Decimal::ZERO),
        ("agency", true, Decimal::new(119, 0), Decimal::ZERO),
        ("unpaid", false, Decimal::ZERO, Decimal::new(119, 0)),
        ("unpaid", true, Decimal::new(119, 0), Decimal::new(119, 0)),
    ]
    .into_iter()
    .enumerate()
    {
        let receipt_tag = format!("{tag}-{index}-{paid_by}-{delivered}");
        let (status, created) = submit_fixture_expense(
            &context.app,
            &concierge,
            service_id,
            Uuid::new_v4(),
            paid_by,
            delivered,
            expense_date,
            &receipt_tag,
        )
        .await;
        assert_eq!(status, StatusCode::CREATED, "{created}");
        let expense_id = Uuid::parse_str(created["item"]["id"].as_str().unwrap()).unwrap();
        let post_request_id = Uuid::new_v4();
        let (status, posted) = json_request(
            &context.app,
            "POST",
            &format!(
                "/api/v1/concierge-services/{service_id}/expenses/{expense_id}/post"
            ),
            &finance,
            Some(json!({
                "request_id": post_request_id,
                "order_id": order_id,
                "order_leistung_id": order_leistung_id,
                "financial_account_id": if paid_by == "agency" { Some(account_id) } else { None },
                "paid_on": if paid_by == "agency" { Some(paid_on) } else { None },
                "payment_method": "bank_transfer",
                "payment_reference": format!("BANK-{index}"),
            })),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{posted}");
        assert_eq!(posted["item"]["status"], "posted");
        assert_eq!(posted["item"]["service_delivered"], delivered);
        assert_eq!(
            posted["item"]["balance_consequence"]["patient_receivable_gross"],
            if expected_receivable == Decimal::ZERO { "0" } else { "119.00" }
        );
        assert_eq!(
            posted["item"]["balance_consequence"]["provider_liability_gross"],
            if expected_liability == Decimal::ZERO { "0" } else { "119.00" }
        );

        let external_invoice_id = Uuid::parse_str(
            posted["item"]["external_invoice"]["id"]
                .as_str()
                .unwrap(),
        )
        .unwrap();
        let external = sqlx::query(
            r#"SELECT invoice_date, paid_at::date AS paid_on, paid_by,
                      service_delivered, patient_receivable_gross,
                      provider_liability_gross
               FROM external_invoices WHERE id = $1"#,
        )
        .bind(external_invoice_id)
        .fetch_one(&context.pool)
        .await
        .unwrap();
        assert_eq!(external.try_get::<chrono::NaiveDate, _>("invoice_date").unwrap(), expense_date);
        assert_eq!(external.try_get::<String, _>("paid_by").unwrap(), paid_by);
        assert_eq!(external.try_get::<bool, _>("service_delivered").unwrap(), delivered);
        assert_eq!(external.try_get::<Decimal, _>("patient_receivable_gross").unwrap(), expected_receivable);
        assert_eq!(external.try_get::<Decimal, _>("provider_liability_gross").unwrap(), expected_liability);

        let payment_count: i64 = sqlx::query_scalar(
            r#"SELECT count(*) FROM external_invoice_provider_payment_transactions
               WHERE external_invoice_id = $1 AND transaction_type = 'payment'"#,
        )
        .bind(external_invoice_id)
        .fetch_one(&context.pool)
        .await
        .unwrap();
        let accounting_gross: Decimal = sqlx::query_scalar(
            r#"SELECT COALESCE(sum(amount_gross), 0)
               FROM accounting_entries
               WHERE source_external_invoice_id = $1
                 AND entry_kind = 'external_invoice_payment'"#,
        )
        .bind(external_invoice_id)
        .fetch_one(&context.pool)
        .await
        .unwrap();
        if paid_by == "agency" {
            assert_eq!(payment_count, 1);
            assert_eq!(accounting_gross, Decimal::new(119, 0));
            assert_eq!(external.try_get::<Option<chrono::NaiveDate>, _>("paid_on").unwrap(), Some(paid_on));
            let journal_paid_on: chrono::NaiveDate = sqlx::query_scalar(
                r#"SELECT paid_on FROM external_invoice_provider_payment_transactions
                   WHERE external_invoice_id = $1 AND transaction_type = 'payment'"#,
            )
            .bind(external_invoice_id)
            .fetch_one(&context.pool)
            .await
            .unwrap();
            let accounting_on: chrono::NaiveDate = sqlx::query_scalar(
                r#"SELECT entry_date FROM accounting_entries
                   WHERE source_external_invoice_id = $1
                     AND entry_kind = 'external_invoice_payment'"#,
            )
            .bind(external_invoice_id)
            .fetch_one(&context.pool)
            .await
            .unwrap();
            assert_eq!(journal_paid_on, paid_on);
            assert_eq!(accounting_on, paid_on);
        } else {
            assert_eq!(payment_count, 0);
            assert_eq!(accounting_gross, Decimal::ZERO);
        }

        let (status, replay) = json_request(
            &context.app,
            "POST",
            &format!(
                "/api/v1/concierge-services/{service_id}/expenses/{expense_id}/post"
            ),
            &finance,
            Some(json!({
                "request_id": post_request_id,
                "order_id": order_id,
                "order_leistung_id": order_leistung_id,
                "financial_account_id": if paid_by == "agency" { Some(account_id) } else { None },
                "paid_on": if paid_by == "agency" { Some(paid_on) } else { None },
                "payment_method": "bank_transfer",
                "payment_reference": format!("BANK-{index}"),
            })),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{replay}");
        assert_eq!(replay["idempotent_replay"], true);

        if paid_by == "unpaid" && !delivered {
            let (status, delivered_later) = json_request(
                &context.app,
                "POST",
                &format!(
                    "/api/v1/orders/{order_id}/external-invoices/{external_invoice_id}/update"
                ),
                &finance,
                Some(json!({ "service_delivered": true })),
            )
            .await;
            assert_eq!(status, StatusCode::OK, "{delivered_later}");
            let receivable: Decimal = sqlx::query_scalar(
                "SELECT patient_receivable_gross FROM external_invoices WHERE id = $1",
            )
            .bind(external_invoice_id)
            .fetch_one(&context.pool)
            .await
            .unwrap();
            assert_eq!(receivable, Decimal::new(119, 0));
            let (status, refreshed) = json_request(
                &context.app,
                "GET",
                &format!("/api/v1/concierge-services/{service_id}/expenses"),
                &finance,
                None,
            )
            .await;
            assert_eq!(status, StatusCode::OK, "{refreshed}");
            let updated = refreshed["items"]
                .as_array()
                .unwrap()
                .iter()
                .find(|item| item["id"] == expense_id.to_string())
                .unwrap();
            assert_eq!(updated["external_invoice"]["service_delivered"], true);
            assert_eq!(
                updated["balance_consequence"]["patient_receivable_gross"],
                "119.00"
            );
            assert!(
                sqlx::query(
                    "UPDATE external_invoices SET service_delivered = false WHERE id = $1"
                )
                .bind(external_invoice_id)
                .execute(&context.pool)
                .await
                .is_err(),
                "posted delivery state must not move backwards"
            );
        }

        if paid_by == "unpaid" && delivered {
            let provider_payment_request_id = Uuid::new_v4();
            let (status, provider_payment) = json_request(
                &context.app,
                "POST",
                &format!(
                    "/api/v1/company-provider-liabilities/{external_invoice_id}/settlements"
                ),
                &finance,
                Some(json!({
                    "request_id": provider_payment_request_id,
                    "financial_account_id": account_id,
                    "amount_gross": "119.00",
                    "paid_on": paid_on,
                    "payment_method": "bank_transfer",
                    "reference": "LATER-SETTLEMENT"
                })),
            )
            .await;
            assert_eq!(status, StatusCode::OK, "{provider_payment}");
            let payment_id = Uuid::parse_str(
                provider_payment["transaction"]["id"].as_str().unwrap(),
            )
            .unwrap();

            let (status, blocked_reverse) = json_request(
                &context.app,
                "POST",
                &format!(
                    "/api/v1/concierge-services/{service_id}/expenses/{expense_id}/reverse"
                ),
                &finance,
                Some(json!({
                    "request_id": Uuid::new_v4(),
                    "reason": "Must reverse later provider payment first",
                    "reversed_on": Utc::now().date_naive()
                })),
            )
            .await;
            assert_eq!(status, StatusCode::CONFLICT, "{blocked_reverse}");

            let (status, provider_reversal) = json_request(
                &context.app,
                "POST",
                &format!(
                    "/api/v1/company-provider-liabilities/{external_invoice_id}/settlements/{payment_id}/reversal"
                ),
                &finance,
                Some(json!({
                    "request_id": Uuid::new_v4(),
                    "paid_on": Utc::now().date_naive(),
                    "note": "Settlement corrected before expense reversal"
                })),
            )
            .await;
            assert_eq!(status, StatusCode::OK, "{provider_reversal}");
            let restored = sqlx::query(
                "SELECT status, paid_by, patient_receivable_gross FROM external_invoices WHERE id = $1",
            )
            .bind(external_invoice_id)
            .fetch_one(&context.pool)
            .await
            .unwrap();
            assert_eq!(restored.try_get::<String, _>("status").unwrap(), "approved");
            assert_eq!(restored.try_get::<String, _>("paid_by").unwrap(), "unpaid");
            assert_eq!(
                restored
                    .try_get::<Decimal, _>("patient_receivable_gross")
                    .unwrap(),
                Decimal::new(119, 0)
            );
        }

        if paid_by == "agency" && !delivered {
            let payment_id: Uuid = sqlx::query_scalar(
                r#"SELECT id FROM external_invoice_provider_payment_transactions
                   WHERE external_invoice_id = $1 AND transaction_type = 'payment'"#,
            )
            .bind(external_invoice_id)
            .fetch_one(&context.pool)
            .await
            .unwrap();
            let (status, canonical_reversal) = json_request(
                &context.app,
                "POST",
                &format!(
                    "/api/v1/company-provider-liabilities/{external_invoice_id}/settlements/{payment_id}/reversal"
                ),
                &finance,
                Some(json!({
                    "request_id": Uuid::new_v4(),
                    "paid_on": Utc::now().date_naive(),
                    "note": "Canonical reversal before expense reversal"
                })),
            )
            .await;
            assert_eq!(status, StatusCode::OK, "{canonical_reversal}");
            let (status, expense_reversal) = json_request(
                &context.app,
                "POST",
                &format!(
                    "/api/v1/concierge-services/{service_id}/expenses/{expense_id}/reverse"
                ),
                &finance,
                Some(json!({
                    "request_id": Uuid::new_v4(),
                    "reason": "Expense is no longer valid",
                    "reversed_on": Utc::now().date_naive()
                })),
            )
            .await;
            assert_eq!(status, StatusCode::OK, "{expense_reversal}");
            assert_eq!(expense_reversal["item"]["status"], "reversed");
            let status: String =
                sqlx::query_scalar("SELECT status FROM external_invoices WHERE id = $1")
                    .bind(external_invoice_id)
                    .fetch_one(&context.pool)
                    .await
                    .unwrap();
            assert_eq!(status, "cancelled");
        }
    }
}

#[tokio::test]
async fn finance_rejects_or_reverses_without_losing_receipt_or_duplicating_ledgers() {
    let Some(context) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let tag = Uuid::new_v4().simple().to_string();
    let concierge_id = seed_user(&context.pool, "concierge", &format!("review-{tag}")).await;
    let billing_id = seed_user(&context.pool, "billing", &format!("review-{tag}")).await;
    let (patient_id, _provider_id, service_id, order_id, order_leistung_id) =
        seed_financial_fixture(&context.pool, context.admin_id, concierge_id, &tag).await;
    let account_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO company_financial_accounts (
               name, account_type, currency, opening_balance, opening_balance_on,
               is_default, is_active, created_by
           ) VALUES ($1, 'bank', 'EUR', 0, '2020-01-01', false, true, $2)
           RETURNING id"#,
    )
    .bind(format!("Concierge review {tag}"))
    .bind(context.admin_id)
    .fetch_one(&context.pool)
    .await
    .unwrap();
    let concierge = auth_header(concierge_id, "concierge");
    let billing = auth_header(billing_id, "billing");
    let expense_date = Utc::now().date_naive() - Duration::days(2);
    let paid_on = expense_date + Duration::days(1);

    let (status, rejected_submission) = submit_fixture_expense(
        &context.app,
        &concierge,
        service_id,
        Uuid::new_v4(),
        "patient",
        true,
        expense_date,
        &format!("reject-{tag}"),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{rejected_submission}");
    let rejected_id = Uuid::parse_str(rejected_submission["item"]["id"].as_str().unwrap()).unwrap();
    let reject_request_id = Uuid::new_v4();
    let reject_path = format!(
        "/api/v1/concierge-services/{service_id}/expenses/{rejected_id}/reject"
    );
    let (status, rejected) = json_request(
        &context.app,
        "POST",
        &reject_path,
        &billing,
        Some(json!({ "request_id": reject_request_id, "reason": "Duplicate vendor receipt" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{rejected}");
    assert_eq!(rejected["item"]["status"], "rejected");
    let (status, reject_replay) = json_request(
        &context.app,
        "POST",
        &reject_path,
        &billing,
        Some(json!({ "request_id": reject_request_id, "reason": "Duplicate vendor receipt" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{reject_replay}");
    assert_eq!(reject_replay["idempotent_replay"], true);
    let rejection_notification_count: i64 = sqlx::query_scalar(
        r#"SELECT count(*) FROM user_notifications
           WHERE user_id = $1
             AND kind = 'concierge_expense_rejected'
             AND entity_type = 'concierge_expense'
             AND entity_id = $2"#,
    )
    .bind(concierge_id)
    .bind(rejected_id)
    .fetch_one(&context.pool)
    .await
    .unwrap();
    assert_eq!(
        rejection_notification_count, 1,
        "Concierge must receive one durable decision notification",
    );
    let (status, cannot_post_rejected) = json_request(
        &context.app,
        "POST",
        &format!(
            "/api/v1/concierge-services/{service_id}/expenses/{rejected_id}/post"
        ),
        &billing,
        Some(json!({
            "request_id": Uuid::new_v4(),
            "order_id": order_id,
            "order_leistung_id": order_leistung_id,
            "payment_method": "other"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{cannot_post_rejected}");

    let (status, agency_submission) = submit_fixture_expense(
        &context.app,
        &concierge,
        service_id,
        Uuid::new_v4(),
        "agency",
        true,
        expense_date,
        &format!("reverse-{tag}"),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{agency_submission}");
    let agency_id = Uuid::parse_str(agency_submission["item"]["id"].as_str().unwrap()).unwrap();
    let (status, posted) = json_request(
        &context.app,
        "POST",
        &format!("/api/v1/concierge-services/{service_id}/expenses/{agency_id}/post"),
        &billing,
        Some(json!({
            "request_id": Uuid::new_v4(),
            "order_id": order_id,
            "order_leistung_id": order_leistung_id,
            "financial_account_id": account_id,
            "paid_on": paid_on,
            "payment_method": "card",
            "payment_reference": "CARD-REVERSAL"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{posted}");
    let external_id = Uuid::parse_str(posted["item"]["external_invoice"]["id"].as_str().unwrap()).unwrap();
    assert!(
        sqlx::query("DELETE FROM external_invoices WHERE id = $1")
            .bind(external_id)
            .execute(&context.pool)
            .await
            .is_err(),
        "active posted expense must protect its canonical external invoice"
    );
    let patient_invoice_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO invoices (
               order_id, patient_id, invoice_number, invoice_type, status,
               total_net, total_vat, total_gross, line_items, created_by
           ) SELECT order_id, patient_id, $2, 'final', 'sent',
                    100, 19, 119, '[]'::jsonb, $3
             FROM external_invoices WHERE id = $1
           RETURNING id"#,
    )
    .bind(external_id)
    .bind(format!("CRE-PATIENT-{tag}"))
    .bind(context.admin_id)
    .fetch_one(&context.pool)
    .await
    .unwrap();
    let allocation_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO external_invoice_patient_invoice_allocations (
               external_invoice_id, patient_invoice_id, amount_gross, created_by
           ) VALUES ($1, $2, 119, $3) RETURNING id"#,
    )
    .bind(external_id)
    .bind(patient_invoice_id)
    .bind(billing_id)
    .fetch_one(&context.pool)
    .await
    .unwrap();
    let reversal_request_id = Uuid::new_v4();
    let reverse_path =
        format!("/api/v1/concierge-services/{service_id}/expenses/{agency_id}/reverse");
    let (status, allocated_block) = json_request(
        &context.app,
        "POST",
        &reverse_path,
        &billing,
        Some(json!({
            "request_id": Uuid::new_v4(),
            "reason": "Patient invoice still uses this receipt",
            "reversed_on": Utc::now().date_naive()
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{allocated_block}");
    sqlx::query(
        r#"UPDATE external_invoice_patient_invoice_allocations
           SET reversed_at = now(), reversed_by = $2,
               reversal_note = 'Release before Concierge expense reversal'
           WHERE id = $1"#,
    )
    .bind(allocation_id)
    .bind(billing_id)
    .execute(&context.pool)
    .await
    .unwrap();
    let (status, uncredited_invoice_block) = json_request(
        &context.app,
        "POST",
        &reverse_path,
        &billing,
        Some(json!({
            "request_id": Uuid::new_v4(),
            "reason": "Allocation was released but patient invoice still charges it",
            "reversed_on": Utc::now().date_naive()
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{uncredited_invoice_block}");
    sqlx::query("UPDATE invoices SET status = 'cancelled' WHERE id = $1")
        .bind(patient_invoice_id)
        .execute(&context.pool)
        .await
        .unwrap();
    sqlx::query("UPDATE company_financial_accounts SET is_active = false WHERE id = $1")
        .bind(account_id)
        .execute(&context.pool)
        .await
        .unwrap();
    let (status, reversed) = json_request(
        &context.app,
        "POST",
        &reverse_path,
        &billing,
        Some(json!({
            "request_id": reversal_request_id,
            "reason": "Card payment was voided",
            "reversed_on": Utc::now().date_naive()
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{reversed}");
    assert_eq!(reversed["item"]["status"], "reversed");
    assert_eq!(reversed["item"]["balance_consequence"]["patient_receivable_gross"], "0");
    let external_status: String =
        sqlx::query_scalar("SELECT status FROM external_invoices WHERE id = $1")
            .bind(external_id)
            .fetch_one(&context.pool)
            .await
            .unwrap();
    let net_accounting: Decimal = sqlx::query_scalar(
        r#"SELECT COALESCE(sum(amount_gross), 0) FROM accounting_entries
           WHERE source_external_invoice_id = $1"#,
    )
    .bind(external_id)
    .fetch_one(&context.pool)
    .await
    .unwrap();
    let provider_journal_count: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM external_invoice_provider_payment_transactions WHERE external_invoice_id = $1",
    )
    .bind(external_id)
    .fetch_one(&context.pool)
    .await
    .unwrap();
    assert_eq!(external_status, "cancelled");
    assert_eq!(net_accounting, Decimal::ZERO);
    assert_eq!(provider_journal_count, 2);
    let (status, statement) = json_request(
        &context.app,
        "GET",
        &format!(
            "/api/v1/patients/{patient_id}/account-statement?currency=EUR&order_id={order_id}"
        ),
        &billing,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{statement}");
    assert_eq!(statement["settlement"]["closing_balance"], "0");

    let (status, reversal_replay) = json_request(
        &context.app,
        "POST",
        &reverse_path,
        &billing,
        Some(json!({
            "request_id": reversal_request_id,
            "reason": "Card payment was voided",
            "reversed_on": Utc::now().date_naive()
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{reversal_replay}");
    assert_eq!(reversal_replay["idempotent_replay"], true);

    let receipt_document_id = Uuid::parse_str(
        agency_submission["item"]["receipt"]["document_id"]
            .as_str()
            .unwrap(),
    )
    .unwrap();
    assert!(
        sqlx::query("UPDATE documents SET notes = 'tampered' WHERE id = $1")
            .bind(receipt_document_id)
            .execute(&context.pool)
            .await
            .is_err(),
        "receipt provenance must be immutable"
    );
    let (status, receipt_bytes) = {
        let request = Request::builder()
            .method("GET")
            .uri(format!(
                "/api/v1/concierge-services/{service_id}/expenses/{agency_id}/receipt"
            ))
            .header("Authorization", &billing)
            .body(Body::empty())
            .unwrap();
        let response = context.app.clone().oneshot(request).await.unwrap();
        let status = response.status();
        let bytes = axum::body::to_bytes(response.into_body(), 1024 * 1024)
            .await
            .unwrap();
        (status, bytes)
    };
    assert_eq!(status, StatusCode::OK);
    assert!(receipt_bytes.starts_with(b"%PDF-"));
}

#[tokio::test]
async fn receipt_upload_limit_accepts_camera_size_and_rejects_above_twenty_five_megabytes() {
    let Some(context) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let tag = Uuid::new_v4().simple().to_string();
    let concierge_id = seed_user(&context.pool, "concierge", &format!("upload-{tag}")).await;
    let (_patient_id, _provider_id, service_id, _order_id, _order_leistung_id) =
        seed_financial_fixture(&context.pool, context.admin_id, concierge_id, &tag).await;
    let bearer = auth_header(concierge_id, "concierge");
    let expense_date = Utc::now().date_naive() - Duration::days(1);
    let fields = submission_fields(Uuid::new_v4(), "patient", true, expense_date);
    let mut camera_jpeg = vec![0_u8; 3 * 1024 * 1024];
    camera_jpeg[..3].copy_from_slice(&[0xff, 0xd8, 0xff]);
    let (status, created) = multipart_request(
        &context.app,
        &format!("/api/v1/concierge-services/{service_id}/expenses"),
        &bearer,
        &fields,
        "camera.jpg",
        "image/jpeg",
        &camera_jpeg,
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{created}");

    let too_large_fields = submission_fields(Uuid::new_v4(), "patient", true, expense_date);
    let mut too_large = vec![0_u8; 26 * 1024 * 1024];
    too_large[..3].copy_from_slice(&[0xff, 0xd8, 0xff]);
    let (status, _) = multipart_request(
        &context.app,
        &format!("/api/v1/concierge-services/{service_id}/expenses"),
        &bearer,
        &too_large_fields,
        "too-large.jpg",
        "image/jpeg",
        &too_large,
    )
    .await;
    assert_eq!(status, StatusCode::PAYLOAD_TOO_LARGE);
}

#[tokio::test]
async fn finance_review_queue_is_global_paginated_and_finance_only() {
    let Some(context) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let tag = Uuid::new_v4().simple().to_string();
    let concierge_id = seed_user(&context.pool, "concierge", &format!("queue-{tag}")).await;
    let billing_id = seed_user(&context.pool, "billing", &format!("queue-{tag}")).await;
    let concierge = auth_header(concierge_id, "concierge");
    let billing = auth_header(billing_id, "billing");
    let expense_date = Utc::now().date_naive() - Duration::days(1);

    for index in 0..2 {
        let fixture_tag = format!("{tag}-{index}");
        let (_patient_id, _provider_id, service_id, _order_id, _order_leistung_id) =
            seed_financial_fixture(
                &context.pool,
                context.admin_id,
                concierge_id,
                &fixture_tag,
            )
            .await;
        let (status, submitted) = submit_fixture_expense(
            &context.app,
            &concierge,
            service_id,
            Uuid::new_v4(),
            "unpaid",
            true,
            expense_date,
            &format!("queue-{index}"),
        )
        .await;
        assert_eq!(status, StatusCode::CREATED, "{submitted}");
    }

    let (status, first_page) = json_request(
        &context.app,
        "GET",
        "/api/v1/concierge-expenses?page=1&page_size=1",
        &billing,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{first_page}");
    assert_eq!(first_page["page"], 1);
    assert_eq!(first_page["page_size"], 1);
    assert_eq!(first_page["total"], 2);
    assert_eq!(first_page["has_more"], true);
    assert_eq!(first_page["items"].as_array().map(Vec::len), Some(1));
    assert!(first_page["items"][0]["service"]["patient_name"].is_string());
    assert!(first_page["items"][0]["service"]["patient_pid"].is_string());
    assert!(first_page["items"][0]["service"]["title"].is_string());

    let (status, second_page) = json_request(
        &context.app,
        "GET",
        "/api/v1/concierge-expenses?page=2&page_size=1",
        &billing,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{second_page}");
    assert_eq!(second_page["total"], 2);
    assert_eq!(second_page["has_more"], false);
    assert_eq!(second_page["items"].as_array().map(Vec::len), Some(1));
    assert_ne!(first_page["items"][0]["id"], second_page["items"][0]["id"]);

    let (status, forbidden) = json_request(
        &context.app,
        "GET",
        "/api/v1/concierge-expenses?page=1&page_size=100",
        &concierge,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN, "{forbidden}");

    let (status, invalid_page) = json_request(
        &context.app,
        "GET",
        "/api/v1/concierge-expenses?page=0&page_size=101",
        &billing,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{invalid_page}");
}
