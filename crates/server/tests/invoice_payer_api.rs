//! Invoice to the payer instead of the patient: the recipient is frozen at
//! release, release checks (address, minor, contracting party, advances),
//! payer inheritance, relation guards, audit and the recipient statement.

mod support;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use serde_json::{Value, json};
use sqlx::{PgPool, Row};
use tower::ServiceExt;
use uuid::Uuid;

use gmed_server::auth::jwt;

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

fn unique_tag(prefix: &str) -> String {
    format!("{prefix}-{}", Uuid::new_v4().simple())
}

fn bearer(user_id: Uuid, role: &str) -> String {
    let token = jwt::issue_access_token(TEST_SECRET, user_id, role, Uuid::new_v4()).unwrap();
    format!("Bearer {token}")
}

async fn seed_user(pool: &PgPool, tag: &str, role: &str) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO users (email, password_hash, name, role)
           VALUES ($1, 'test-password-hash', $2, $3) RETURNING id"#,
    )
    .bind(format!("{tag}-{role}@example.com"))
    .bind(format!("{role} {tag}"))
    .bind(role)
    .fetch_one(pool)
    .await
    .unwrap()
}

/// A synthetic patient; `address` gives a full German postal address.
async fn seed_patient(
    pool: &PgPool,
    created_by: Uuid,
    tag: &str,
    birth_date: &str,
    address: bool,
) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO patients (
                patient_id, first_name, last_name, birth_date, gender, created_by,
                address_street, address_zip, address_city, address_country
           ) VALUES ($1, $2, 'Muster', $3::date, 'diverse', $4, $5, $6, $7, $8)
           RETURNING id"#,
    )
    .bind(format!("PT-{tag}"))
    .bind(format!("Kind {tag}"))
    .bind(birth_date)
    .bind(created_by)
    .bind(address.then_some("Hauptstraße 1"))
    .bind(address.then_some("80331"))
    .bind(address.then_some("München"))
    .bind(address.then_some("Deutschland"))
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn seed_relation(
    pool: &PgPool,
    patient_id: Uuid,
    name: &str,
    relation_type: &str,
    related_patient_id: Option<Uuid>,
    address: bool,
) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO patient_relations (
                patient_id, related_patient_id, related_name, relation_type, email,
                address_street, address_zip, address_city, address_country
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id"#,
    )
    .bind(patient_id)
    .bind(related_patient_id)
    .bind(name)
    .bind(relation_type)
    .bind(format!(
        "{}@example.test",
        name.to_lowercase().replace(' ', ".")
    ))
    .bind(address.then_some("Nebenweg 2"))
    .bind(address.then_some("10115"))
    .bind(address.then_some("Berlin"))
    .bind(address.then_some("Deutschland"))
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn seed_order(pool: &PgPool, patient_id: Uuid, created_by: Uuid, tag: &str) -> Uuid {
    let order_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO orders (order_number, patient_id, phase, status, created_by)
           VALUES ($1, $2, 'execution', 'active', $3)
           RETURNING id"#,
    )
    .bind(format!("ORD-{tag}"))
    .bind(patient_id)
    .bind(created_by)
    .fetch_one(pool)
    .await
    .unwrap();
    sqlx::query(
        r#"UPDATE orders
           SET package_coverage_status = 'not_covered',
               package_coverage_note = 'test package gate',
               package_coverage_decided_by = $2,
               package_coverage_decided_at = now()
           WHERE id = $1"#,
    )
    .bind(order_id)
    .bind(created_by)
    .execute(pool)
    .await
    .unwrap();
    sqlx::query(
        r#"INSERT INTO order_leistungen (order_id, description, quantity, unit_price, vat_rate, status)
           VALUES ($1, 'Begleitung', 1, 100, 19, 'approved')"#,
    )
    .bind(order_id)
    .execute(pool)
    .await
    .unwrap();
    order_id
}

async fn create_quote(app: &axum::Router, auth: &str, order_id: Uuid) -> String {
    let (status, body) = json_request(
        app,
        "POST",
        &format!("/api/v1/orders/{order_id}/quotes"),
        auth,
        Some(json!({ "notes": "payer test" })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    body["id"].as_str().unwrap().to_string()
}

async fn create_draft(app: &axum::Router, auth: &str, quote_id: &str, invoice_type: &str) -> Value {
    let (status, body) = json_request(
        app,
        "POST",
        &format!("/api/v1/quotes/{quote_id}/invoices"),
        auth,
        Some(json!({ "invoice_type": invoice_type })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    body
}

async fn release(
    app: &axum::Router,
    auth: &str,
    invoice_id: &str,
    extra: Value,
) -> (StatusCode, Value) {
    let mut payload = json!({ "status": "sent" });
    if let (Some(payload), Some(extra)) = (payload.as_object_mut(), extra.as_object()) {
        for (key, value) in extra {
            payload.insert(key.clone(), value.clone());
        }
    }
    json_request(
        app,
        "POST",
        &format!("/api/v1/invoices/{invoice_id}/status"),
        auth,
        Some(payload),
    )
    .await
}

async fn set_invoice_payer(
    app: &axum::Router,
    auth: &str,
    invoice_id: &str,
    payer: Value,
) -> (StatusCode, Value) {
    json_request(
        app,
        "POST",
        &format!("/api/v1/invoices/{invoice_id}/payer"),
        auth,
        Some(payer),
    )
    .await
}

/// The patient's lead, converted, with its payer declaration linked to the
/// patient: Viktor Zahler pays as a third party (`third_party`), or the
/// patient pays (`self`).
async fn seed_converted_declaration(pool: &PgPool, patient_id: Uuid, payer_kind: &str) -> Uuid {
    let lead_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO leads (first_name, last_name, email, date_of_birth, legal_sex,
                              qualification_status, compliance_status, intake_source,
                              converted_patient_id, status_changed_at)
           VALUES ('Kind', 'Muster', $1, DATE '1980-05-05', 'diverse', 'converted', 'signed',
                   'staff_wizard', $2, now() - interval '1 hour')
           RETURNING id"#,
    )
    .bind(format!("lead-{}@example.com", Uuid::new_v4().simple()))
    .bind(patient_id)
    .fetch_one(pool)
    .await
    .unwrap();
    let third_party = payer_kind == "third_party";
    sqlx::query(
        r#"INSERT INTO lead_payer_declarations (
               lead_id, patient_id, payer_kind, payer_type, first_name, last_name, date_of_birth,
               street, zip, city, country, citizenships, relationship_kind, email,
               source_of_funds, payer_informed_at)
           VALUES ($1, $2, $3,
                   CASE WHEN $4 THEN 'person' END, CASE WHEN $4 THEN 'Viktor' END,
                   CASE WHEN $4 THEN 'Zahler' END, CASE WHEN $4 THEN DATE '1970-05-01' END,
                   CASE WHEN $4 THEN 'Ringstr. 9' END, CASE WHEN $4 THEN '1010' END,
                   CASE WHEN $4 THEN 'Wien' END, CASE WHEN $4 THEN 'AT' END,
                   CASE WHEN $4 THEN '{AT}'::text[] ELSE '{}'::text[] END,
                   CASE WHEN $4 THEN 'relative' END,
                   CASE WHEN $4 THEN 'viktor.zahler@example.com' END,
                   'employment', CASE WHEN $4 THEN now() END)"#,
    )
    .bind(lead_id)
    .bind(patient_id)
    .bind(payer_kind)
    .bind(third_party)
    .execute(pool)
    .await
    .unwrap();
    lead_id
}

struct Fixture {
    app: axum::Router,
    pool: PgPool,
    admin_id: Uuid,
    billing: String,
    manager: String,
    tag: String,
}

async fn fixture(prefix: &str) -> Option<Fixture> {
    let (app, pool, admin_id) = test_context().await?;
    let tag = unique_tag(prefix);
    let billing_id = seed_user(&pool, &tag, "billing").await;
    let manager_id = seed_user(&pool, &tag, "ceo").await;
    Some(Fixture {
        app,
        pool,
        admin_id,
        billing: bearer(billing_id, "billing"),
        manager: bearer(manager_id, "ceo"),
        tag,
    })
}

#[tokio::test]
async fn released_recipient_is_frozen_and_survives_relation_changes() {
    let Some(fx) = fixture("payer-frozen").await else {
        return;
    };
    let patient = seed_patient(&fx.pool, fx.admin_id, &fx.tag, "1980-05-05", true).await;
    let relation = seed_relation(&fx.pool, patient, "Olga Zahler", "sibling", None, true).await;
    let order = seed_order(&fx.pool, patient, fx.admin_id, &fx.tag).await;
    let quote = create_quote(&fx.app, &fx.manager, order).await;
    let draft = create_draft(&fx.app, &fx.billing, &quote, "final").await;
    let invoice_id = draft["id"].as_str().unwrap().to_string();

    let (status, body) = set_invoice_payer(
        &fx.app,
        &fx.billing,
        &invoice_id,
        json!({ "payer_patient_relation_id": relation, "payer_role": "cost_bearer" }),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["recipient"]["name"], "Olga Zahler");
    assert_eq!(body["recipient"]["street"], "Nebenweg 2");
    // Kostenübernehmer: the adult patient stays the Leistungsempfänger.
    assert_eq!(
        body["recipient"]["service_recipient_name"],
        format!("Kind {} Muster", fx.tag)
    );

    let (status, released) = release(&fx.app, &fx.billing, &invoice_id, json!({})).await;
    assert_eq!(status, StatusCode::OK, "{released}");
    let snapshot: Value =
        sqlx::query_scalar("SELECT recipient_snapshot FROM invoices WHERE id = $1::uuid")
            .bind(&invoice_id)
            .fetch_one(&fx.pool)
            .await
            .unwrap();
    assert_eq!(snapshot["name"], "Olga Zahler");
    assert_eq!(snapshot["captured"], "release");
    assert_eq!(snapshot["payer_role"], "cost_bearer");

    // API: the payer of a released invoice cannot change.
    let (status, _) = set_invoice_payer(
        &fx.app,
        &fx.billing,
        &invoice_id,
        json!({ "payer_contact_name": "Someone Else" }),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    // Database: a raw UPDATE is rejected by the trigger as well.
    let raw = sqlx::query("UPDATE invoices SET payer_contact_name = 'Direct' WHERE id = $1::uuid")
        .bind(&invoice_id)
        .execute(&fx.pool)
        .await;
    assert!(
        raw.is_err(),
        "payer columns of a released invoice are frozen"
    );
    let raw = sqlx::query(
        "UPDATE invoices SET recipient_snapshot = '{\"name\":\"x\"}'::jsonb WHERE id = $1::uuid",
    )
    .bind(&invoice_id)
    .execute(&fx.pool)
    .await;
    assert!(raw.is_err(), "the recipient snapshot is frozen");

    // The relation can be renamed (later documents keep the frozen name) but
    // not deleted or repointed.
    sqlx::query("UPDATE patient_relations SET related_name = 'Renamed', address_city = 'Hamburg' WHERE id = $1")
        .bind(relation)
        .execute(&fx.pool)
        .await
        .unwrap();
    let (status, detail) = json_request(
        &fx.app,
        "GET",
        &format!("/api/v1/invoices/{invoice_id}"),
        &fx.billing,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(detail["recipient"]["name"], "Olga Zahler");
    assert_eq!(detail["recipient"]["city"], "Berlin");
    assert_eq!(detail["recipient"]["frozen"], true);

    let (status, body) = json_request(
        &fx.app,
        "POST",
        &format!("/api/v1/patients/{patient}/relations/{relation}/delete"),
        &fx.manager,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{body}");
    assert_eq!(body["error"], "relation_used_by_released_invoice");
    let other = seed_patient(
        &fx.pool,
        fx.admin_id,
        &format!("{}-o", fx.tag),
        "1970-01-01",
        true,
    )
    .await;
    let (status, body) = json_request(
        &fx.app,
        "POST",
        &format!("/api/v1/patients/{patient}/relations/{relation}/update"),
        &fx.manager,
        Some(json!({
            "related_patient_id": other,
            "related_name": "Renamed",
            "relation_type": "sibling"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{body}");

    // A credit note keeps the original recipient (snapshot).
    let (status, body) = json_request(
        &fx.app,
        "POST",
        &format!("/api/v1/invoices/{invoice_id}/credit-notes"),
        &fx.billing,
        Some(json!({
            "request_id": Uuid::new_v4(),
            "amount_gross": 10,
            "reason": "Kulanz",
            "issued_on": gmed_server::app_time::today().to_string(),
            "portal_visible": true
        })),
    )
    .await;
    assert!(status.is_success(), "credit note: {status} {body}");
    let (status, detail) = json_request(
        &fx.app,
        "GET",
        &format!("/api/v1/invoices/{invoice_id}"),
        &fx.billing,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(detail["recipient"]["name"], "Olga Zahler");
}

#[tokio::test]
async fn release_requires_a_full_recipient_address() {
    let Some(fx) = fixture("payer-address").await else {
        return;
    };
    let patient = seed_patient(&fx.pool, fx.admin_id, &fx.tag, "1980-05-05", false).await;
    let order = seed_order(&fx.pool, patient, fx.admin_id, &fx.tag).await;
    let quote = create_quote(&fx.app, &fx.manager, order).await;
    let draft = create_draft(&fx.app, &fx.billing, &quote, "final").await;
    let invoice_id = draft["id"].as_str().unwrap().to_string();
    assert_eq!(
        draft["release_checks"]["warnings"][0]["code"],
        "recipient_address_incomplete"
    );

    let (status, body) = release(&fx.app, &fx.billing, &invoice_id, json!({})).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
    assert_eq!(body["error"], "recipient_address_incomplete");
    assert_eq!(body["missing"], json!(["street", "zip", "city", "country"]));

    // A payer without country is not enough either (no Kleinbetragsrechnung).
    let (status, _) = set_invoice_payer(
        &fx.app,
        &fx.billing,
        &invoice_id,
        json!({
            "payer_contact_name": "Ivan Zahler",
            "payer_address_street": "Kyivska 5",
            "payer_address_zip": "01001",
            "payer_address_city": "Kyiv",
            "payer_role": "cost_bearer"
        }),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let (status, body) = release(&fx.app, &fx.billing, &invoice_id, json!({})).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
    assert_eq!(body["missing"], json!(["country"]));

    let (status, _) = set_invoice_payer(
        &fx.app,
        &fx.billing,
        &invoice_id,
        json!({
            "payer_contact_name": "Ivan Zahler",
            "payer_contact_email": "ivan@example",
        }),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::UNPROCESSABLE_ENTITY,
        "invalid e-mail is refused"
    );
}

#[tokio::test]
async fn minor_patient_invoices_go_to_the_parents_by_default() {
    let Some(fx) = fixture("payer-minor").await else {
        return;
    };
    let child = seed_patient(&fx.pool, fx.admin_id, &fx.tag, "2016-03-04", true).await;
    let mother = seed_relation(&fx.pool, child, "Erika Muster", "parent", None, true).await;
    let _father = seed_relation(&fx.pool, child, "Max Muster", "parent", None, true).await;
    let order = seed_order(&fx.pool, child, fx.admin_id, &fx.tag).await;

    // The contracting party of a minor defaults to the legal representatives.
    let (status, party) = json_request(
        &fx.app,
        "GET",
        &format!("/api/v1/orders/{order}/contracting-party"),
        &fx.manager,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{party}");
    assert_eq!(party["contracting_party"]["kind"], "legal_representatives");
    assert_eq!(
        party["contracting_party"]["debtor_name"],
        "Erika Muster und Max Muster"
    );

    let quote = create_quote(&fx.app, &fx.manager, order).await;
    let draft = create_draft(&fx.app, &fx.billing, &quote, "final").await;
    assert_eq!(draft["payer"]["patient_relation_id"], mother.to_string());
    assert_eq!(draft["payer"]["role"], "contracting_party");
    assert_eq!(draft["recipient"]["name"], "Erika Muster");
    // Hidden from the child's portal by default.
    assert_eq!(draft["portal_visible"], false);
    assert_eq!(draft["pdf_visible_to_patient"], false);
    let invoice_id = draft["id"].as_str().unwrap().to_string();
    let (status, body) = release(&fx.app, &fx.billing, &invoice_id, json!({})).await;
    assert_eq!(status, StatusCode::OK, "{body}");

    // Without a payer the minor would receive the invoice: confirm first.
    let order = seed_order(&fx.pool, child, fx.admin_id, &format!("{}-2", fx.tag)).await;
    let quote = create_quote(&fx.app, &fx.manager, order).await;
    let draft = create_draft(&fx.app, &fx.billing, &quote, "final").await;
    let invoice_id = draft["id"].as_str().unwrap().to_string();
    let (status, _) = set_invoice_payer(&fx.app, &fx.billing, &invoice_id, json!({})).await;
    assert_eq!(status, StatusCode::OK);
    let (status, body) = release(&fx.app, &fx.billing, &invoice_id, json!({})).await;
    assert_eq!(status, StatusCode::CONFLICT, "{body}");
    assert_eq!(body["error"], "minor_patient_recipient");
    assert_eq!(body["confirm_field"], "confirm_minor_recipient");
    let (status, body) = release(
        &fx.app,
        &fx.billing,
        &invoice_id,
        json!({ "confirm_minor_recipient": true }),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let snapshot: Value =
        sqlx::query_scalar("SELECT recipient_snapshot FROM invoices WHERE id = $1::uuid")
            .bind(&invoice_id)
            .fetch_one(&fx.pool)
            .await
            .unwrap();
    assert!(snapshot["confirmations"]["minor_patient_recipient"]["by"].is_string());

    // An invoice without an order inherits the same default.
    let mut conn = fx.pool.acquire().await.unwrap();
    let inherited =
        gmed_server::routes::invoices::payer::inherited_invoice_payer(&mut conn, None, child)
            .await
            .unwrap();
    assert_eq!(inherited.source, "contracting_party");
    assert_eq!(inherited.record.payer_patient_relation_id, Some(mother));

    // An explicit default payer wins; a minor without any guardian has none.
    let grandma = seed_relation(&fx.pool, child, "Oma Muster", "relative", None, true).await;
    sqlx::query("UPDATE patient_relations SET is_default_payer = true WHERE id = $1")
        .bind(grandma)
        .execute(&fx.pool)
        .await
        .unwrap();
    let inherited =
        gmed_server::routes::invoices::payer::inherited_invoice_payer(&mut conn, None, child)
            .await
            .unwrap();
    assert_eq!(inherited.source, "default_payer");
    assert_eq!(inherited.record.payer_patient_relation_id, Some(grandma));
    assert_eq!(
        inherited.record.payer_role, None,
        "not the contracting party"
    );
    let orphan = seed_patient(
        &fx.pool,
        fx.admin_id,
        &format!("{}-o", fx.tag),
        "2015-01-01",
        true,
    )
    .await;
    let inherited =
        gmed_server::routes::invoices::payer::inherited_invoice_payer(&mut conn, None, orphan)
            .await
            .unwrap();
    assert!(inherited.minor_without_payer);
}

#[tokio::test]
async fn the_declared_third_party_pays_the_invoice_after_the_default_payer_and_before_the_parents()
{
    let Some(fx) = fixture("payer-declared").await else {
        return;
    };

    // An adult whose lead declared Viktor Zahler: the draft of an order
    // without a payer goes to him as cost bearer, with the declared address.
    let patient = seed_patient(&fx.pool, fx.admin_id, &fx.tag, "1980-05-05", true).await;
    seed_converted_declaration(&fx.pool, patient, "third_party").await;
    let order = seed_order(&fx.pool, patient, fx.admin_id, &fx.tag).await;
    let quote = create_quote(&fx.app, &fx.manager, order).await;
    let draft = create_draft(&fx.app, &fx.billing, &quote, "final").await;
    let invoice_id = draft["id"].as_str().unwrap().to_string();
    assert_eq!(draft["payer"]["contact_name"], "Viktor Zahler", "{draft}");
    assert_eq!(draft["payer"]["role"], "cost_bearer");
    assert_eq!(draft["payer"]["patient_relation_id"], Value::Null);
    assert_eq!(draft["recipient"]["kind"], "contact");
    assert_eq!(draft["recipient"]["name"], "Viktor Zahler");
    assert_eq!(draft["recipient"]["city"], "Wien");
    assert_eq!(draft["recipient"]["email"], "viktor.zahler@example.com");
    assert_eq!(
        draft["recipient"]["service_recipient_name"],
        format!("Kind {} Muster", fx.tag),
        "the adult patient stays the Leistungsempfänger"
    );

    // Billing may still clear the payer of the draft: an empty body means
    // "the patient receives the invoice", as before.
    let (status, cleared) = set_invoice_payer(&fx.app, &fx.billing, &invoice_id, json!({})).await;
    assert_eq!(status, StatusCode::OK, "{cleared}");
    assert_eq!(cleared["payer"]["contact_name"], Value::Null, "{cleared}");
    assert_eq!(cleared["recipient"]["kind"], "patient");

    // A second draft starts with the declared payer again and releases to
    // him: the frozen recipient names the declared third party.
    let second = create_draft(&fx.app, &fx.billing, &quote, "advance").await;
    let second_id = second["id"].as_str().unwrap().to_string();
    assert_eq!(second["payer"]["contact_name"], "Viktor Zahler", "{second}");
    let (status, released) = release(&fx.app, &fx.billing, &second_id, json!({})).await;
    assert_eq!(status, StatusCode::OK, "{released}");
    let snapshot: Value =
        sqlx::query_scalar("SELECT recipient_snapshot FROM invoices WHERE id = $1::uuid")
            .bind(&second_id)
            .fetch_one(&fx.pool)
            .await
            .unwrap();
    assert_eq!(snapshot["name"], "Viktor Zahler");
    assert_eq!(snapshot["kind"], "contact");
    assert_eq!(snapshot["payer_role"], "cost_bearer");
    assert_eq!(snapshot["city"], "Wien");

    // A minor whose parents are recorded: the declaration beats the parents
    // as contracting party; a default payer set by staff beats the
    // declaration.
    let child = seed_patient(
        &fx.pool,
        fx.admin_id,
        &format!("{}-c", fx.tag),
        "2016-03-04",
        true,
    )
    .await;
    let mother = seed_relation(&fx.pool, child, "Erika Muster", "parent", None, true).await;
    seed_converted_declaration(&fx.pool, child, "third_party").await;
    let mut conn = fx.pool.acquire().await.unwrap();
    let inherited =
        gmed_server::routes::invoices::payer::inherited_invoice_payer(&mut conn, None, child)
            .await
            .unwrap();
    assert_eq!(inherited.source, "payer_declaration");
    assert_eq!(
        inherited.record.contact_name.as_deref(),
        Some("Viktor Zahler")
    );
    assert_eq!(inherited.record.payer_role.as_deref(), Some("cost_bearer"));
    assert!(!inherited.minor_without_payer);
    let child_order = seed_order(&fx.pool, child, fx.admin_id, &format!("{}-c", fx.tag)).await;
    let child_quote = create_quote(&fx.app, &fx.manager, child_order).await;
    let child_draft = create_draft(&fx.app, &fx.billing, &child_quote, "final").await;
    assert_eq!(
        child_draft["payer"]["contact_name"], "Viktor Zahler",
        "{child_draft}"
    );
    assert_eq!(
        child_draft["recipient"]["service_recipient_name"],
        "Erika Muster"
    );
    sqlx::query("UPDATE patient_relations SET is_default_payer = true WHERE id = $1")
        .bind(mother)
        .execute(&fx.pool)
        .await
        .unwrap();
    let inherited =
        gmed_server::routes::invoices::payer::inherited_invoice_payer(&mut conn, None, child)
            .await
            .unwrap();
    assert_eq!(inherited.source, "default_payer");
    assert_eq!(inherited.record.payer_patient_relation_id, Some(mother));
    assert_eq!(
        inherited.record.payer_role.as_deref(),
        Some("contracting_party")
    );

    // A self-payer declaration sets nothing: the parents as before.
    let own = seed_patient(
        &fx.pool,
        fx.admin_id,
        &format!("{}-s", fx.tag),
        "2016-03-04",
        true,
    )
    .await;
    let own_mother = seed_relation(&fx.pool, own, "Erika Muster", "parent", None, true).await;
    seed_converted_declaration(&fx.pool, own, "self").await;
    let inherited =
        gmed_server::routes::invoices::payer::inherited_invoice_payer(&mut conn, None, own)
            .await
            .unwrap();
    assert_eq!(inherited.source, "contracting_party");
    assert_eq!(inherited.record.payer_patient_relation_id, Some(own_mother));
}

#[tokio::test]
async fn framework_contract_party_choice_is_followed_by_its_orders() {
    let Some(fx) = fixture("payer-contract").await else {
        return;
    };
    let child = seed_patient(&fx.pool, fx.admin_id, &fx.tag, "2015-06-06", true).await;
    let mother = seed_relation(&fx.pool, child, "Erika Muster", "parent", None, true).await;
    let contract_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO framework_contracts (patient_id, contract_number, status, created_by)
           VALUES ($1, $2, 'draft', $3) RETURNING id"#,
    )
    .bind(child)
    .bind(format!("FC-{}", fx.tag))
    .bind(fx.admin_id)
    .fetch_one(&fx.pool)
    .await
    .unwrap();
    let order = seed_order(&fx.pool, child, fx.admin_id, &fx.tag).await;
    sqlx::query("UPDATE orders SET contract_id = $2 WHERE id = $1")
        .bind(order)
        .bind(contract_id)
        .execute(&fx.pool)
        .await
        .unwrap();

    // A relation of another patient cannot represent this child.
    let stranger = seed_patient(
        &fx.pool,
        fx.admin_id,
        &format!("{}-x", fx.tag),
        "1970-01-01",
        true,
    )
    .await;
    let foreign = seed_relation(&fx.pool, stranger, "Fremd", "parent", None, true).await;
    let (status, _) = json_request(
        &fx.app,
        "POST",
        &format!("/api/v1/framework-contracts/{contract_id}/contracting-party"),
        &fx.manager,
        Some(json!({ "contracting_party": "patient_represented", "contracting_relation_ids": [foreign] })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);

    let (status, body) = json_request(
        &fx.app,
        "POST",
        &format!("/api/v1/framework-contracts/{contract_id}/contracting-party"),
        &fx.manager,
        Some(json!({ "contracting_party": "patient_represented", "contracting_relation_ids": [mother] })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["contracting_party"]["kind"], "patient_represented");
    let (status, party) = json_request(
        &fx.app,
        "GET",
        &format!("/api/v1/orders/{order}/contracting-party"),
        &fx.manager,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(party["contracting_party"]["kind"], "patient_represented");
    assert_eq!(party["contracting_party"]["explicit"], true);
    // The child is the party: the invoice goes to the child (confirmed) and
    // names no other Leistungsempfänger.
    let quote = create_quote(&fx.app, &fx.manager, order).await;
    let draft = create_draft(&fx.app, &fx.billing, &quote, "final").await;
    assert_eq!(draft["recipient"]["kind"], "patient");
    let audited: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM audit_log WHERE action = 'set_framework_contract_party' AND entity_id = $1",
    )
    .bind(contract_id)
    .fetch_one(&fx.pool)
    .await
    .unwrap();
    assert_eq!(audited, 1);
}

#[tokio::test]
async fn head_order_payer_of_another_patient_reaches_the_child_invoice_whole() {
    let Some(fx) = fixture("payer-head").await else {
        return;
    };
    let father = seed_patient(
        &fx.pool,
        fx.admin_id,
        &format!("{}-f", fx.tag),
        "1975-02-02",
        true,
    )
    .await;
    let child = seed_patient(
        &fx.pool,
        fx.admin_id,
        &format!("{}-c", fx.tag),
        "1990-01-01",
        true,
    )
    .await;
    let mother_patient = seed_patient(
        &fx.pool,
        fx.admin_id,
        &format!("{}-m", fx.tag),
        "1976-03-03",
        true,
    )
    .await;
    // The payer is a relation of the father's record pointing to the mother's.
    let relation = seed_relation(
        &fx.pool,
        father,
        "Mutter",
        "spouse",
        Some(mother_patient),
        false,
    )
    .await;
    let head = seed_order(&fx.pool, father, fx.admin_id, &format!("{}-h", fx.tag)).await;
    let sub = seed_order(&fx.pool, child, fx.admin_id, &format!("{}-s", fx.tag)).await;
    sqlx::query("UPDATE orders SET order_role = 'main', payer_patient_relation_id = $2, payer_role = 'cost_bearer' WHERE id = $1")
        .bind(head)
        .bind(relation)
        .execute(&fx.pool)
        .await
        .unwrap();
    sqlx::query("UPDATE orders SET order_role = 'sub', head_order_id = $2, payer_contact_name = 'Sub contact' WHERE id = $1")
        .bind(sub)
        .bind(head)
        .execute(&fx.pool)
        .await
        .unwrap();

    let quote = create_quote(&fx.app, &fx.manager, sub).await;
    let draft = create_draft(&fx.app, &fx.billing, &quote, "final").await;
    // The head's payer as a whole: the mother's patient record, not mixed
    // with the sub-order's contact name.
    assert_eq!(draft["payer"]["patient_id"], mother_patient.to_string());
    assert_eq!(draft["payer"]["patient_relation_id"], Value::Null);
    assert_eq!(draft["payer"]["contact_name"], Value::Null);
    assert_eq!(draft["payer"]["role"], "cost_bearer");
    assert_eq!(
        draft["recipient"]["name"],
        format!("Kind {}-m Muster", fx.tag)
    );
    assert_eq!(draft["recipient"]["street"], "Hauptstraße 1");
}

#[tokio::test]
async fn recipient_other_than_the_party_and_advance_mismatch_need_confirmation() {
    let Some(fx) = fixture("payer-party").await else {
        return;
    };
    let patient = seed_patient(&fx.pool, fx.admin_id, &fx.tag, "1980-05-05", true).await;
    let order = seed_order(&fx.pool, patient, fx.admin_id, &fx.tag).await;
    let quote = create_quote(&fx.app, &fx.manager, order).await;

    // The advance goes to the patient.
    let advance = create_draft(&fx.app, &fx.billing, &quote, "advance").await;
    let (status, body) = release(
        &fx.app,
        &fx.billing,
        advance["id"].as_str().unwrap(),
        json!({}),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");

    // The final invoice goes to a contact who is not the contracting party.
    let final_invoice = create_draft(&fx.app, &fx.billing, &quote, "final").await;
    let invoice_id = final_invoice["id"].as_str().unwrap().to_string();
    let payer = json!({
        "payer_contact_name": "Firma Zahlt GmbH",
        "payer_address_street": "Industriestraße 9",
        "payer_address_zip": "50667",
        "payer_address_city": "Köln",
        "payer_address_country": "Deutschland"
    });
    let (status, _) = set_invoice_payer(&fx.app, &fx.billing, &invoice_id, payer.clone()).await;
    assert_eq!(status, StatusCode::OK);
    let (status, body) = release(&fx.app, &fx.billing, &invoice_id, json!({})).await;
    assert_eq!(status, StatusCode::CONFLICT, "{body}");
    assert_eq!(body["error"], "recipient_not_contracting_party");

    // Marked as Kostenübernehmer, the advance of another recipient remains.
    let mut cost_bearer = payer.clone();
    cost_bearer["payer_role"] = json!("cost_bearer");
    let (status, _) = set_invoice_payer(&fx.app, &fx.billing, &invoice_id, cost_bearer).await;
    assert_eq!(status, StatusCode::OK);
    let (status, body) = release(&fx.app, &fx.billing, &invoice_id, json!({})).await;
    assert_eq!(status, StatusCode::CONFLICT, "{body}");
    assert_eq!(body["error"], "advance_recipient_mismatch");
    let (status, body) = release(
        &fx.app,
        &fx.billing,
        &invoice_id,
        json!({ "confirm_advance_recipient_mismatch": true }),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let snapshot: Value =
        sqlx::query_scalar("SELECT recipient_snapshot FROM invoices WHERE id = $1::uuid")
            .bind(&invoice_id)
            .fetch_one(&fx.pool)
            .await
            .unwrap();
    assert_eq!(snapshot["name"], "Firma Zahlt GmbH");
    assert!(snapshot["service_recipient_name"].is_string());
    assert!(
        snapshot["confirmations"]["advance_recipient_mismatch"]["advance_invoice_numbers"]
            .is_array()
    );

    // The statement can be narrowed to the paying company.
    let (status, statement) = json_request(
        &fx.app,
        "GET",
        &format!("/api/v1/patients/{patient}/account-statement"),
        &fx.billing,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{statement}");
    let identity = statement["available_recipients"]
        .as_array()
        .unwrap()
        .iter()
        .find(|recipient| recipient["name"] == "Firma Zahlt GmbH")
        .and_then(|recipient| recipient["identity"].as_str())
        .unwrap()
        .to_string();
    let (status, narrowed) = json_request(
        &fx.app,
        "GET",
        &format!(
            "/api/v1/patients/{patient}/account-statement?payer={}",
            identity.replace(' ', "%20").replace(':', "%3A")
        ),
        &fx.billing,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{narrowed}");
    let invoice_items = narrowed["items"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|item| item["kind"] == "invoice" || item["kind"] == "prepayment")
        .collect::<Vec<_>>();
    assert_eq!(invoice_items.len(), 1, "{narrowed}");
    assert_eq!(invoice_items[0]["recipient_name"], "Firma Zahlt GmbH");
}

#[tokio::test]
async fn payer_changes_are_audited_with_old_and_new_values_in_the_transaction() {
    let Some(fx) = fixture("payer-audit").await else {
        return;
    };
    let patient = seed_patient(&fx.pool, fx.admin_id, &fx.tag, "1980-05-05", true).await;
    let order = seed_order(&fx.pool, patient, fx.admin_id, &fx.tag).await;
    let quote = create_quote(&fx.app, &fx.manager, order).await;
    let draft = create_draft(&fx.app, &fx.billing, &quote, "final").await;
    let invoice_id = draft["id"].as_str().unwrap().to_string();
    let (status, _) = set_invoice_payer(
        &fx.app,
        &fx.billing,
        &invoice_id,
        json!({ "payer_contact_name": "Erste Zahlerin" }),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let (status, _) = set_invoice_payer(
        &fx.app,
        &fx.billing,
        &invoice_id,
        json!({ "payer_contact_name": "Zweiter Zahler" }),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let row = sqlx::query(
        r#"SELECT old_value, new_value FROM audit_log
           WHERE entity_type = 'invoice' AND entity_id = $1::uuid AND action = 'payer_assigned'
           ORDER BY created_at DESC LIMIT 1"#,
    )
    .bind(&invoice_id)
    .fetch_one(&fx.pool)
    .await
    .unwrap();
    let old: Value = row.try_get("old_value").unwrap();
    let new: Value = row.try_get("new_value").unwrap();
    assert_eq!(old["payer_contact_name"], "Erste Zahlerin");
    assert_eq!(new["payer_contact_name"], "Zweiter Zahler");

    // Order payer: capability-gated (interpreters may not) and audited too.
    let interpreter_id = seed_user(&fx.pool, &fx.tag, "interpreter").await;
    let (status, _) = json_request(
        &fx.app,
        "POST",
        &format!("/api/v1/orders/{order}/payer"),
        &bearer(interpreter_id, "interpreter"),
        Some(json!({ "payer_contact_name": "Nope" })),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, body) = json_request(
        &fx.app,
        "POST",
        &format!("/api/v1/orders/{order}/payer"),
        &fx.billing,
        Some(json!({
            "payer_contact_name": "Zahler",
            "payer_address_street": "Weg 1",
            "payer_address_zip": "12345",
            "payer_address_city": "Bonn",
            "payer_address_country": "Deutschland",
            "payer_role": "cost_bearer"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let audited: i64 = sqlx::query_scalar(
        r#"SELECT COUNT(*) FROM audit_log
           WHERE entity_type = 'order' AND entity_id = $1 AND action = 'set_order_payer'
             AND new_value ->> 'payer_address_city' = 'Bonn'"#,
    )
    .bind(order)
    .fetch_one(&fx.pool)
    .await
    .unwrap();
    assert_eq!(audited, 1);
}
