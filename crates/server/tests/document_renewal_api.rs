//! Renewing expiring documents (QA 2026-11-16 S2-1, S2-2): a Kostenvoranschlag
//! whose validity is its quote's is renewed through the quote («Продлить срок
//! до …»), an identical new version is refused, and «Загрузить новый» uploads
//! the next version of an expired scan.

mod support;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use chrono::NaiveDate;
use rust_decimal::Decimal;
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

async fn multipart_upload(
    app: &axum::Router,
    bearer: &str,
    text_fields: &[(&str, String)],
) -> (StatusCode, Value) {
    let boundary = format!("----gmed-boundary-{}", Uuid::new_v4().simple());
    let mut body = Vec::new();
    for (name, value) in text_fields {
        body.extend_from_slice(format!("--{boundary}\r\n").as_bytes());
        body.extend_from_slice(
            format!("Content-Disposition: form-data; name=\"{name}\"\r\n\r\n").as_bytes(),
        );
        body.extend_from_slice(value.as_bytes());
        body.extend_from_slice(b"\r\n");
    }
    body.extend_from_slice(format!("--{boundary}\r\n").as_bytes());
    body.extend_from_slice(
        b"Content-Disposition: form-data; name=\"file\"; filename=\"passport.pdf\"\r\nContent-Type: application/pdf\r\n\r\n",
    );
    body.extend_from_slice(b"%PDF-1.4 synthetic");
    body.extend_from_slice(b"\r\n");
    body.extend_from_slice(format!("--{boundary}--\r\n").as_bytes());
    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/documents/upload")
        .header("Authorization", bearer)
        .header(
            "Content-Type",
            format!("multipart/form-data; boundary={boundary}"),
        )
        .body(Body::from(body))
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

/// A patient with a signed framework contract, an order and its open quote
/// valid until `valid_until`.
async fn seed_order_with_quote(
    pool: &PgPool,
    patient_id: Uuid,
    created_by: Uuid,
    tag: &str,
    valid_until: NaiveDate,
) -> (Uuid, Uuid) {
    let contract_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO framework_contracts (
                patient_id, contract_number, signed_at, valid_from, valid_to,
                conditions, status, created_by
           ) VALUES ($1, $2, '2026-04-01T09:15:00Z', '2026-04-01', '2026-12-31',
                     '{}'::jsonb, 'signed', $3)
           RETURNING id"#,
    )
    .bind(patient_id)
    .bind(format!("FC-{tag}"))
    .bind(created_by)
    .fetch_one(pool)
    .await
    .unwrap();
    let order_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO orders (
                order_number, patient_id, contract_id, phase, status, needs_description, created_by
           ) VALUES ($1, $2, $3, 'execution', 'active', 'Renewal test', $4)
           RETURNING id"#,
    )
    .bind(format!("AUF-{tag}"))
    .bind(patient_id)
    .bind(contract_id)
    .bind(created_by)
    .fetch_one(pool)
    .await
    .unwrap();
    let quote_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO quotes (
                order_id, quote_number, total_net, total_vat, total_gross,
                status, valid_until, line_items, notes, created_by
           ) VALUES ($1, $2, 750, 142.50, 892.50, 'sent', $3, $4::jsonb, NULL, $5)
           RETURNING id"#,
    )
    .bind(order_id)
    .bind(format!("KV-{tag}"))
    .bind(valid_until)
    .bind(json!([{
        "description": "Koordination vor stationärer Aufnahme",
        "quantity": "1",
        "unit_price": "750",
        "vat_rate": "19",
        "line_gross": "892.50"
    }]))
    .bind(created_by)
    .fetch_one(pool)
    .await
    .unwrap();
    (order_id, quote_id)
}

async fn document_valid_until(pool: &PgPool, id: &str) -> Option<NaiveDate> {
    sqlx::query_scalar("SELECT valid_until FROM documents WHERE id = $1::uuid")
        .bind(id)
        .fetch_one(pool)
        .await
        .unwrap()
}

async fn document_status(pool: &PgPool, id: &str) -> String {
    sqlx::query_scalar("SELECT status FROM documents WHERE id = $1::uuid")
        .bind(id)
        .fetch_one(pool)
        .await
        .unwrap()
}

#[tokio::test]
async fn an_estimate_is_renewed_through_its_quote_and_identical_versions_are_refused() {
    let Some(ctx) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let pool = ctx.pool.clone();
    let app = ctx.app.clone();
    let ceo = bearer(ctx.admin_id, "ceo");
    let tag = Uuid::new_v4().simple().to_string();
    let today = gmed_server::app_time::today();
    let soon = today + chrono::Days::new(5);
    let patient_id = seed_patient(&pool, ctx.admin_id, &tag).await;
    let (order_id, quote_id) =
        seed_order_with_quote(&pool, patient_id, ctx.admin_id, &tag, soon).await;

    let generate = |replace: Option<&str>| {
        let mut body = json!({
            "template_id": "order_cost_estimate",
            "patient_id": patient_id,
            "order_id": order_id,
            "language": "de",
            "bindings": { "party_sign_place": "Paris" }
        });
        if let Some(replace) = replace {
            body["replace_document_id"] = json!(replace);
        }
        let app = app.clone();
        let ceo = ceo.clone();
        async move { json_request(&app, "POST", "/api/v1/documents/generate", &ceo, Some(body)).await }
    };
    let extend = |id: &str, date: NaiveDate| {
        let app = app.clone();
        let ceo = ceo.clone();
        let path = format!("/api/v1/documents/{id}/extend-quote-validity");
        async move {
            json_request(
                &app,
                "POST",
                &path,
                &ceo,
                Some(json!({ "valid_until": date.to_string() })),
            )
            .await
        }
    };

    let (status, first) = generate(None).await;
    assert_eq!(status, StatusCode::OK, "{first}");
    let first_id = first["id"].as_str().unwrap().to_string();
    assert_eq!(document_valid_until(&pool, &first_id).await, Some(soon));

    // Nothing changed: no identical second version.
    let (status, refused) = generate(Some(&first_id)).await;
    assert_eq!(status, StatusCode::CONFLICT, "{refused}");
    assert_eq!(refused["error"], "no_changes");
    let versions: i64 =
        sqlx::query_scalar("SELECT count(*) FROM documents WHERE replaces_document_id = $1::uuid")
            .bind(&first_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(versions, 0);

    // A past date is refused; the new date goes onto the quote, audited.
    let (status, past) = extend(&first_id, today - chrono::Days::new(1)).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{past}");
    assert_eq!(past["error"], "quote_valid_until_past");
    let later = today + chrono::Days::new(40);
    let (status, quote) = extend(&first_id, later).await;
    assert_eq!(status, StatusCode::OK, "{quote}");
    assert_eq!(quote["valid_until"], later.to_string());
    // The same date again changes nothing (a retry after a failed second step).
    let (status, _) = extend(&first_id, later).await;
    assert_eq!(status, StatusCode::OK);
    let snapshots: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM quote_versions WHERE quote_id = $1 AND change_reason = 'valid_until_extended'",
    )
    .bind(quote_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(snapshots, 1);
    let audited: i64 = sqlx::query_scalar(
        r#"SELECT count(*) FROM audit_log
           WHERE action = 'update_quote_valid_until' AND entity_id = $1
             AND old_value->>'valid_until' = $2 AND new_value->>'valid_until' = $3"#,
    )
    .bind(quote_id)
    .bind(soon.to_string())
    .bind(later.to_string())
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(audited, 1);

    // The estimate's new version takes the quote's new date.
    let (status, second) = generate(Some(&first_id)).await;
    assert_eq!(status, StatusCode::OK, "{second}");
    let second_id = second["id"].as_str().unwrap().to_string();
    assert_eq!(second["version_number"], 2);
    assert_eq!(document_valid_until(&pool, &second_id).await, Some(later));
    assert_eq!(document_status(&pool, &first_id).await, "archived");
    let (status, refused) = generate(Some(&second_id)).await;
    assert_eq!(status, StatusCode::CONFLICT, "{refused}");

    // The superseded version is not extended any more.
    let (status, old) = extend(&first_id, later + chrono::Days::new(1)).await;
    assert_eq!(status, StatusCode::CONFLICT, "{old}");
    assert_eq!(old["error"], "document_not_current");

    // An expired quote is open again with the status it had.
    sqlx::query("UPDATE quotes SET status = 'expired' WHERE id = $1")
        .bind(quote_id)
        .execute(&pool)
        .await
        .unwrap();
    let (status, reopened) = extend(&second_id, later + chrono::Days::new(10)).await;
    assert_eq!(status, StatusCode::OK, "{reopened}");
    assert_eq!(reopened["status"], "sent");

    // A newer quote of the order: the estimate printed the earlier one, which
    // is not redated (its new version takes the current quote).
    sqlx::query(
        r#"INSERT INTO quotes (order_id, quote_number, total_net, total_vat, total_gross,
                               status, valid_until, line_items, created_by)
           SELECT order_id, quote_number || '-N', total_net, total_vat, total_gross,
                  'sent', $2, line_items, created_by
           FROM quotes WHERE id = $1"#,
    )
    .bind(quote_id)
    .bind(later)
    .execute(&pool)
    .await
    .unwrap();
    let before: Option<NaiveDate> =
        sqlx::query_scalar("SELECT valid_until FROM quotes WHERE id = $1")
            .bind(quote_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    let (status, stale) = extend(&second_id, later + chrono::Days::new(20)).await;
    assert_eq!(status, StatusCode::CONFLICT, "{stale}");
    assert_eq!(stale["error"], "estimate_quote_not_current");
    let after: Option<NaiveDate> =
        sqlx::query_scalar("SELECT valid_until FROM quotes WHERE id = $1")
            .bind(quote_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(before, after);

    // Only roles that manage quotes extend one.
    let interpreter = seed_user(&pool, &tag, "interpreter").await;
    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/documents/{second_id}/extend-quote-validity"),
        &bearer(interpreter, "interpreter"),
        Some(json!({ "valid_until": later.to_string() })),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn an_upload_replaces_an_expired_scan_as_its_next_version() {
    let Some(ctx) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let pool = ctx.pool.clone();
    let app = ctx.app.clone();
    let ceo = bearer(ctx.admin_id, "ceo");
    let tag = Uuid::new_v4().simple().to_string();
    let today = gmed_server::app_time::today();
    let expired = today - chrono::Days::new(3);
    let patient_id = seed_patient(&pool, ctx.admin_id, &tag).await;
    sqlx::query("UPDATE patients SET passport_expiry = $2 WHERE id = $1")
        .bind(patient_id)
        .bind(expired)
        .execute(&pool)
        .await
        .unwrap();
    let scan_fields = || {
        vec![
            ("patient_id", patient_id.to_string()),
            ("auto_name", "Reisepass".to_string()),
            ("art", "passport_scan".to_string()),
            ("category", "identity".to_string()),
        ]
    };
    let version_row = |id: String| {
        let pool = pool.clone();
        async move {
            sqlx::query_as::<_, (Option<Uuid>, Option<Uuid>, i32, String)>(
                r#"SELECT replaces_document_id, version_root_document_id, version_number, art
                   FROM documents WHERE id = $1::uuid"#,
            )
            .bind(id)
            .fetch_one(&pool)
            .await
            .unwrap()
        }
    };

    let (status, first) = multipart_upload(&app, &ceo, &scan_fields()).await;
    assert_eq!(status, StatusCode::OK, "{first}");
    let first_id = first["id"].as_str().unwrap().to_string();
    assert_eq!(document_valid_until(&pool, &first_id).await, Some(expired));

    // Another type is refused: the chain keeps the type.
    let (status, body) = multipart_upload(
        &app,
        &ceo,
        &[
            ("replaces_document_id", first_id.clone()),
            ("art", "medical_report".to_string()),
        ],
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");

    let renewed_until = today + chrono::Days::new(400);
    let (status, second) = multipart_upload(
        &app,
        &ceo,
        &[
            ("replaces_document_id", first_id.clone()),
            ("valid_until", renewed_until.to_string()),
        ],
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{second}");
    let second_id = second["id"].as_str().unwrap().to_string();
    let first_uuid = Uuid::parse_str(&first_id).unwrap();
    assert_eq!(
        version_row(second_id.clone()).await,
        (
            Some(first_uuid),
            Some(first_uuid),
            2,
            "passport_scan".to_string()
        )
    );
    assert_eq!(
        document_valid_until(&pool, &second_id).await,
        Some(renewed_until)
    );
    assert_eq!(document_status(&pool, &second_id).await, "active");
    assert_eq!(document_status(&pool, &first_id).await, "archived");
    let patient_of_new: Option<Uuid> =
        sqlx::query_scalar("SELECT patient_id FROM documents WHERE id = $1::uuid")
            .bind(&second_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(patient_of_new, Some(patient_id));

    // The expired one leaves the validity filter.
    let (status, attention) = json_request(
        &app,
        "GET",
        &format!("/api/v1/documents?patient_id={patient_id}&validity=attention"),
        &ceo,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{attention}");
    assert_eq!(attention.as_array().map(Vec::len), Some(0), "{attention}");

    // The old version is history: it is not replaced a second time.
    let (status, body) =
        multipart_upload(&app, &ceo, &[("replaces_document_id", first_id.clone())]).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");

    // A new version uploaded without a date does not inherit the old one's
    // from the same (stale) record.
    let (status, third) = multipart_upload(&app, &ceo, &scan_fields()).await;
    assert_eq!(status, StatusCode::OK, "{third}");
    let third_id = third["id"].as_str().unwrap().to_string();
    assert_eq!(document_valid_until(&pool, &third_id).await, Some(expired));
    let (status, fourth) =
        multipart_upload(&app, &ceo, &[("replaces_document_id", third_id.clone())]).await;
    assert_eq!(status, StatusCode::OK, "{fourth}");
    let fourth_id = fourth["id"].as_str().unwrap().to_string();
    assert_eq!(document_valid_until(&pool, &fourth_id).await, None);

    // Only CEO and patient managers upload a new version.
    let interpreter = seed_user(&pool, &tag, "interpreter").await;
    let (status, _) = multipart_upload(
        &app,
        &bearer(interpreter, "interpreter"),
        &[("replaces_document_id", second_id)],
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

async fn pdf_text(app: &axum::Router, bearer: &str, id: &str) -> String {
    let req = Request::builder()
        .method("GET")
        .uri(format!("/api/v1/documents/{id}/download"))
        .header("Authorization", bearer)
        .body(Body::empty())
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let bytes = axum::body::to_bytes(resp.into_body(), 16 * 1024 * 1024)
        .await
        .unwrap();
    let raw = pdf_extract::extract_text_from_mem(&bytes).unwrap();
    raw.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// `1234.5` as the documents print it: `1.234,50`.
fn money_de(value: Decimal) -> String {
    let fixed = format!("{:.2}", value.round_dp(2));
    let (whole, cents) = fixed.split_once('.').unwrap();
    let mut grouped = String::new();
    for (index, digit) in whole.chars().enumerate() {
        if index > 0 && (whole.len() - index) % 3 == 0 {
            grouped.push('.');
        }
        grouped.push(digit);
    }
    format!("{grouped},{cents}")
}

async fn add_service(
    pool: &PgPool,
    order_id: Uuid,
    patient_id: Uuid,
    description: &str,
    quantity: &str,
    unit_price: &str,
    discount: &str,
) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO order_leistungen (
               order_id, patient_id, description, quantity, unit_price, currency, vat_rate,
               discount_percent
           ) VALUES ($1, $2, $3, $4::numeric, $5::numeric, 'EUR', 19, $6::numeric)
           RETURNING id"#,
    )
    .bind(order_id)
    .bind(patient_id)
    .bind(description)
    .bind(quantity)
    .bind(unit_price)
    .bind(discount)
    .fetch_one(pool)
    .await
    .unwrap()
}

/// QA 2026-11-19 S1: the new version of an outdated Kostenvoranschlag and
/// Einzelauftrag re-printed the quote of the old version (V02 954,25 € for an
/// order of 1.044,69 €, new discount lines missing) and the «Устарел» mark
/// went away. The new version prints the order of now, through a new quote.
#[tokio::test]
async fn a_new_version_of_an_outdated_estimate_prints_the_current_order() {
    let Some(ctx) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let pool = ctx.pool.clone();
    let app = ctx.app.clone();
    let ceo = bearer(ctx.admin_id, "ceo");
    let tag = Uuid::new_v4().simple().to_string();
    let today = gmed_server::app_time::today();
    let valid_until = today + chrono::Days::new(30);
    let patient_id = seed_patient(&pool, ctx.admin_id, &tag).await;
    let (order_id, _) =
        seed_order_with_quote(&pool, patient_id, ctx.admin_id, &tag, valid_until).await;
    let coordination = add_service(
        &pool,
        order_id,
        patient_id,
        "Koordination",
        "1.5",
        "100",
        "0",
    )
    .await;
    add_service(
        &pool,
        order_id,
        patient_id,
        "Dolmetscherbetreuung",
        "2",
        "80",
        "0",
    )
    .await;
    let (status, quote) = json_request(
        &app,
        "POST",
        &format!("/api/v1/orders/{order_id}/quotes"),
        &ceo,
        Some(json!({ "valid_until": valid_until.to_string(), "notes": "Angebot" })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{quote}");
    let first_quote = quote["quote_number"].as_str().unwrap().to_string();

    let generate = |template: &'static str, replace: Option<String>| {
        let mut body = json!({
            "template_id": template,
            "patient_id": patient_id,
            "order_id": order_id,
            "language": "de",
            "bindings": { "party_sign_place": "Paris" }
        });
        if let Some(replace) = replace {
            body["replace_document_id"] = json!(replace);
        }
        let app = app.clone();
        let ceo = ceo.clone();
        async move { json_request(&app, "POST", "/api/v1/documents/generate", &ceo, Some(body)).await }
    };
    let order_gross = || {
        let pool = pool.clone();
        async move {
            sqlx::query_scalar::<_, Decimal>("SELECT order_service_total_gross($1)")
                .bind(order_id)
                .fetch_one(&pool)
                .await
                .unwrap()
        }
    };
    let terms_current = |id: String| {
        let pool = pool.clone();
        async move {
            sqlx::query_scalar::<_, Option<bool>>("SELECT document_terms_current($1::uuid)")
                .bind(id)
                .fetch_one(&pool)
                .await
                .unwrap()
        }
    };
    let printed_quote = |id: String| {
        let pool = pool.clone();
        async move {
            sqlx::query_scalar::<_, Option<String>>(
                "SELECT generated_bindings->>'_quote_number' FROM documents WHERE id = $1::uuid",
            )
            .bind(id)
            .fetch_one(&pool)
            .await
            .unwrap()
        }
    };

    let (status, estimate) = generate("order_cost_estimate", None).await;
    assert_eq!(status, StatusCode::OK, "{estimate}");
    let estimate_id = estimate["id"].as_str().unwrap().to_string();
    let (status, single) = generate("single_order", None).await;
    assert_eq!(status, StatusCode::OK, "{single}");
    let single_id = single["id"].as_str().unwrap().to_string();
    let before = order_gross().await;
    let estimate_text = pdf_text(&app, &ceo, &estimate_id).await;
    assert!(estimate_text.contains(&money_de(before)), "{estimate_text}");
    // An unchanged order keeps its quote.
    let open_quotes: Vec<String> = sqlx::query_scalar(
        "SELECT quote_number FROM quotes WHERE order_id = $1 AND status <> 'superseded'",
    )
    .bind(order_id)
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(open_quotes, vec![first_quote.clone()]);

    // The order changes after the estimate: a discount and a new discounted line.
    sqlx::query("UPDATE order_leistungen SET discount_percent = 20 WHERE id = $1")
        .bind(coordination)
        .execute(&pool)
        .await
        .unwrap();
    add_service(
        &pool,
        order_id,
        patient_id,
        "Begleitung",
        "1",
        "300",
        "33.33",
    )
    .await;
    sqlx::query("UPDATE orders SET client_terms_changed_at = now() WHERE id = $1")
        .bind(order_id)
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(terms_current(estimate_id.clone()).await, Some(false));
    let after = order_gross().await;
    assert_ne!(before, after);

    let (status, renewed) = generate("order_cost_estimate", Some(estimate_id.clone())).await;
    assert_eq!(status, StatusCode::OK, "{renewed}");
    let renewed_id = renewed["id"].as_str().unwrap().to_string();
    assert_eq!(renewed["version_number"], 2, "{renewed}");
    let (current_quote, current_gross, current_valid_until, current_notes): (
        String,
        Decimal,
        Option<NaiveDate>,
        Option<String>,
    ) = sqlx::query_as(
        r#"SELECT quote_number, total_gross, valid_until, notes FROM quotes
           WHERE order_id = $1 AND status <> 'superseded'"#,
    )
    .bind(order_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_ne!(current_quote, first_quote);
    assert_eq!(current_gross, after);
    // The new quote keeps the validity and the remark of the one it replaces.
    assert_eq!(current_valid_until, Some(valid_until));
    assert_eq!(current_notes.as_deref(), Some("Angebot"));
    assert_eq!(
        printed_quote(renewed_id.clone()).await.as_deref(),
        Some(current_quote.as_str())
    );
    let renewed_text = pdf_text(&app, &ceo, &renewed_id).await;
    assert!(renewed_text.contains(&money_de(after)), "{renewed_text}");
    assert!(renewed_text.contains("Begleitung"), "{renewed_text}");
    assert!(!renewed_text.contains(&money_de(before)), "{renewed_text}");
    assert_eq!(terms_current(renewed_id).await, Some(true));

    // The Einzelauftrag's new version names the same, current quote.
    let (status, renewed_single) = generate("single_order", Some(single_id)).await;
    assert_eq!(status, StatusCode::OK, "{renewed_single}");
    let renewed_single_id = renewed_single["id"].as_str().unwrap().to_string();
    let single_text = pdf_text(&app, &ceo, &renewed_single_id).await;
    assert!(single_text.contains(&current_quote), "{single_text}");
    let quotes: i64 = sqlx::query_scalar("SELECT count(*) FROM quotes WHERE order_id = $1")
        .bind(order_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    // The seeded quote, the first API quote and the one the change needed.
    assert_eq!(quotes, 3);
}
