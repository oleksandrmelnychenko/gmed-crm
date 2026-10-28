//! «Нова заявка для цієї особи» (owner decision 2026-10-25): a relation of a
//! patient or a trusted contact of an open request becomes a lead of their own
//! with the identity data GMED already holds pre-filled (`POST /leads` with
//! `source_person`). Synthetic data only, in disposable databases.
mod support;

use axum::{
    Router,
    body::Body,
    http::{Request, StatusCode},
};
use chrono::{Months, NaiveDate};
use serde_json::{Value, json};
use sqlx::PgPool;
use tower::ServiceExt;
use uuid::Uuid;

const SECRET: &str = "test-secret-at-least-32-characters-long!!";
const CODE: &str = "existing_parent_patient_use_repeat_intake";

fn bearer(id: Uuid, role: &str) -> String {
    format!(
        "Bearer {}",
        gmed_server::auth::jwt::issue_access_token(SECRET, id, role, Uuid::new_v4()).unwrap()
    )
}

async fn post(app: &Router, path: &str, token: &str, body: Value) -> (StatusCode, Value) {
    let request = Request::builder()
        .method("POST")
        .uri(path)
        .header("Authorization", token)
        .header("Content-Type", "application/json")
        .body(Body::from(serde_json::to_vec(&body).unwrap()))
        .unwrap();
    let response = app.clone().oneshot(request).await.unwrap();
    let status = response.status();
    let bytes = axum::body::to_bytes(response.into_body(), 4 * 1024 * 1024)
        .await
        .unwrap();
    (
        status,
        serde_json::from_slice(&bytes)
            .unwrap_or_else(|_| json!({ "raw": String::from_utf8_lossy(&bytes) })),
    )
}

async fn get(app: &Router, path: &str, token: &str) -> (StatusCode, Value) {
    let request = Request::builder()
        .method("GET")
        .uri(path)
        .header("Authorization", token)
        .body(Body::empty())
        .unwrap();
    let response = app.clone().oneshot(request).await.unwrap();
    let status = response.status();
    let bytes = axum::body::to_bytes(response.into_body(), 4 * 1024 * 1024)
        .await
        .unwrap();
    (
        status,
        serde_json::from_slice(&bytes)
            .unwrap_or_else(|_| json!({ "raw": String::from_utf8_lossy(&bytes) })),
    )
}

fn years_before(today: NaiveDate, years: u32) -> NaiveDate {
    today.checked_sub_months(Months::new(years * 12)).unwrap()
}

fn unique(prefix: &str) -> String {
    format!("{prefix}-{}@example.test", Uuid::new_v4().simple())
}

async fn user(pool: &PgPool, name: &str, role: &str, email: &str, active: bool) -> Uuid {
    sqlx::query_scalar(
        "INSERT INTO users (email, name, password_hash, role, is_active)
         VALUES ($1, $2, 'test-password-hash', $3, $4) RETURNING id",
    )
    .bind(email)
    .bind(name)
    .bind(role)
    .bind(active)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn patient(
    pool: &PgPool,
    actor: Uuid,
    first: &str,
    birth: NaiveDate,
    email: Option<&str>,
    phone: Option<&str>,
) -> Uuid {
    sqlx::query_scalar(
        "INSERT INTO patients (patient_id, first_name, last_name, birth_date, gender, email,
                               phone_primary, created_by)
         VALUES ($1, $2, 'Muster', $3, 'female', $4, $5, $6) RETURNING id",
    )
    .bind(format!("P-{}", Uuid::new_v4()))
    .bind(first)
    .bind(birth)
    .bind(email)
    .bind(phone)
    .bind(actor)
    .fetch_one(pool)
    .await
    .unwrap()
}

/// A request of the child with one trusted contact; converted to `child`
/// when given.
async fn child_request(
    pool: &PgPool,
    actor: Uuid,
    birth: NaiveDate,
    email: &str,
    login: Option<Uuid>,
    converted_to: Option<Uuid>,
    contact: &Value,
) -> Uuid {
    sqlx::query_scalar(
        "INSERT INTO leads (first_name, last_name, date_of_birth, email, created_by,
                            portal_user_id, converted_patient_id, qualification_status,
                            trusted_contacts)
         VALUES ('Mia', 'Muster', $1, $2, $3, $4, $5,
                 CASE WHEN $5::uuid IS NULL THEN 'new' ELSE 'converted' END,
                 jsonb_build_array($6::jsonb))
         RETURNING id",
    )
    .bind(birth)
    .bind(email)
    .bind(actor)
    .bind(login)
    .bind(converted_to)
    .bind(contact)
    .fetch_one(pool)
    .await
    .unwrap()
}

/// The representative row of the contact on the child's request: where the
/// identity document, the birth place and the child's PEP answers live.
async fn representative_row(pool: &PgPool, lead: Uuid, contact: Uuid, actor: Uuid) {
    sqlx::query(
        r#"INSERT INTO lead_representatives (
               lead_id, contact_id, role, contact_origin, first_name, last_name,
               birth_place, birth_country, citizenships, street, zip, city, country,
               id_document_type, id_document_number, id_issuing_authority, id_issuing_country,
               id_issued_on, id_valid_until, country_questions, updated_by)
           VALUES ($1, $2, 'legal_representative', 'staff', 'Anna', 'Muster',
                   'Kyiv', 'UA', '{UA}', 'Musterstr. 1', '10115', 'Berlin', 'DE',
                   'passport', 'FX123456', 'Kyiv 1234', 'UA', '2020-01-01', '2030-01-01',
                   '{"pep_self": true, "sanctions_links": false}'::jsonb, $3)"#,
    )
    .bind(lead)
    .bind(contact)
    .bind(actor)
    .execute(pool)
    .await
    .unwrap();
}

#[allow(clippy::too_many_arguments)]
async fn relation(
    pool: &PgPool,
    child: Uuid,
    name: &str,
    email: Option<&str>,
    phone: Option<&str>,
    birth: Option<NaiveDate>,
    source_contact: Option<Uuid>,
    related_patient: Option<Uuid>,
) -> Uuid {
    sqlx::query_scalar(
        "INSERT INTO patient_relations (patient_id, related_name, relation_type, email, phone,
             address_street, address_zip, address_city, address_country, birth_date,
             citizenships, source_contact_id, related_patient_id)
         VALUES ($1, $2, 'mother', $3, $4, 'Musterstr. 1', '10115', 'Berlin', 'DE', $5,
                 '{UA}', $6, $7)
         RETURNING id",
    )
    .bind(child)
    .bind(name)
    .bind(email)
    .bind(phone)
    .bind(birth)
    .bind(source_contact)
    .bind(related_patient)
    .fetch_one(pool)
    .await
    .unwrap()
}

type LeadRow = (
    String,
    String,
    Option<NaiveDate>,
    Option<String>,
    Option<String>,
    Option<String>,
    Option<String>,
    Option<String>,
    Option<String>,
    Vec<String>,
    Option<Uuid>,
    Option<Uuid>,
    Option<Uuid>,
);

async fn lead_row(pool: &PgPool, lead: Uuid) -> LeadRow {
    sqlx::query_as(
        "SELECT first_name, last_name, date_of_birth, phone, email, street_address, zip_code,
                city, country, citizenships, source_relation_id, source_contact_lead_id,
                source_contact_id
         FROM leads WHERE id = $1",
    )
    .bind(lead)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn audit_context(pool: &PgPool, action: &str, entity: Uuid) -> Option<Value> {
    sqlx::query_scalar(
        "SELECT context FROM audit_log WHERE action = $1 AND entity_id = $2
         ORDER BY created_at DESC LIMIT 1",
    )
    .bind(action)
    .bind(entity)
    .fetch_optional(pool)
    .await
    .unwrap()
}

fn fields(body: &Value) -> Vec<String> {
    body["prefilled_from_source"]["fields"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .map(str::to_string)
        .collect()
}

#[tokio::test]
async fn relation_of_a_converted_minor_prefills_the_parents_own_request() {
    let Some(suite) = support::suite_context(SECRET).await else {
        return;
    };
    let pool = &suite.pool;
    let today = gmed_server::app_time::today();
    let ceo = user(pool, "Chef", "ceo", &unique("ceo"), true).await;
    let child_email = unique("mia");
    let child_login_email = unique("mia-login");
    let child_login = user(pool, "Mia Muster", "patient", &child_login_email, true).await;
    let child = patient(
        pool,
        ceo,
        "Mia",
        years_before(today, 10),
        Some(&child_email),
        None,
    )
    .await;
    let contact_id = Uuid::new_v4();
    let mother_email = unique("anna");
    let contact = json!({
        "id": contact_id, "name": "Anna Muster", "relation": "mother",
        "email": mother_email, "phone": "+49 170 2222222", "birth_date": "1985-03-04",
    });
    let child_lead = child_request(
        pool,
        ceo,
        years_before(today, 10),
        &child_email,
        Some(child_login),
        Some(child),
        &contact,
    )
    .await;
    representative_row(pool, child_lead, contact_id, ceo).await;
    let relation_id = relation(
        pool,
        child,
        "Anna Muster",
        Some(&mother_email),
        Some("+49 170 2222222"),
        NaiveDate::from_ymd_opt(1985, 3, 4),
        Some(contact_id),
        None,
    )
    .await;

    // No name, no e-mail in the body; the phone given in the body wins.
    let (status, body) = post(
        &suite.app,
        "/api/v1/leads",
        &bearer(ceo, "ceo"),
        json!({
            "phone": "+49 30 9999999",
            "source_person": { "patient_id": child, "relation_id": relation_id },
        }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    let lead_id: Uuid = body["id"].as_str().unwrap().parse().unwrap();
    let row = lead_row(pool, lead_id).await;
    assert_eq!((row.0.as_str(), row.1.as_str()), ("Anna", "Muster"));
    assert_eq!(row.2, NaiveDate::from_ymd_opt(1985, 3, 4));
    assert_eq!(row.3.as_deref(), Some("+49 30 9999999"), "the body wins");
    assert_eq!(row.4.as_deref(), Some(mother_email.as_str()));
    assert_eq!(
        (
            row.5.as_deref(),
            row.6.as_deref(),
            row.7.as_deref(),
            row.8.as_deref()
        ),
        (
            Some("Musterstr. 1"),
            Some("10115"),
            Some("Berlin"),
            Some("DE")
        )
    );
    assert_eq!(row.9, vec!["UA".to_string()]);
    assert_eq!(row.10, Some(relation_id), "the source is remembered");
    assert_eq!((row.11, row.12), (None, None));
    assert_eq!(body["portal_account"]["created"], json!(true), "{body}");

    let declaration: (String, Option<Uuid>, Option<bool>) = sqlx::query_as(
        "SELECT concat_ws('|', birth_place, birth_country, id_document_type, id_document_number,
                          id_issuing_country, id_valid_until::text),
                id_data_entered_by, pep_self
         FROM lead_gwg_declarations WHERE lead_id = $1",
    )
    .bind(lead_id)
    .fetch_one(pool)
    .await
    .unwrap();
    assert_eq!(declaration.0, "Kyiv|UA|passport|FX123456|UA|2030-01-01");
    assert_eq!(declaration.1, Some(ceo), "staff entered the data");
    assert_eq!(
        declaration.2, None,
        "the child's PEP answer is never written"
    );
    let representatives: i64 =
        sqlx::query_scalar("SELECT count(*) FROM lead_representatives WHERE lead_id = $1")
            .bind(lead_id)
            .fetch_one(pool)
            .await
            .unwrap();
    assert_eq!(representatives, 0, "no representative is copied");

    let filled = fields(&body);
    for field in [
        "first_name",
        "last_name",
        "date_of_birth",
        "email",
        "country",
        "citizenships",
        "street_address",
        "zip_code",
        "city",
        "birth_place",
        "birth_country",
        "id_document_type",
        "id_document_number",
        "id_issuing_authority",
        "id_issuing_country",
        "id_issued_on",
        "id_valid_until",
    ] {
        assert!(
            filled.iter().any(|f| f == field),
            "{field} missing in {filled:?}"
        );
    }
    assert!(!filled.iter().any(|f| f == "phone"), "{filled:?}");
    assert_eq!(
        body["prefilled_from_source"]["hints"]["pep_self"],
        json!("yes")
    );
    assert_eq!(
        body["prefilled_from_source"]["hints"]["sanctions_links"],
        json!("no")
    );
    assert_eq!(
        body["prefilled_from_source"]["hints"]["identity_document_id"],
        Value::Null
    );

    // The lead remembers its source and reads the PEP hint again from it.
    let (status, lead) = get(
        &suite.app,
        &format!("/api/v1/leads/{lead_id}"),
        &bearer(ceo, "ceo"),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{lead}");
    assert_eq!(lead["source_relation_id"], json!(relation_id), "{lead}");
    assert_eq!(lead["source_contact_lead_id"], Value::Null, "{lead}");
    assert_eq!(lead["source_contact_id"], Value::Null, "{lead}");
    assert_eq!(lead["source_pep_hint"], json!("yes"), "{lead}");
    // The relation row on the child's card carries the date of birth and
    // the citizenships.
    let (status, relations) = get(
        &suite.app,
        &format!("/api/v1/patients/{child}/relations"),
        &bearer(ceo, "ceo"),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{relations}");
    let row = relations
        .as_array()
        .unwrap()
        .iter()
        .find(|row| row["id"] == json!(relation_id))
        .expect("relation row");
    assert_eq!(row["birth_date"], json!("1985-03-04"), "{row}");
    assert_eq!(row["citizenships"], json!(["UA"]), "{row}");

    let audit = audit_context(pool, "lead_prefilled_from_relation", lead_id)
        .await
        .expect("audit row");
    let audit_text = audit.to_string();
    assert!(
        audit["fields"]
            .as_array()
            .is_some_and(|f| f.len() == filled.len())
    );
    assert_eq!(audit["source"]["relation_id"], json!(relation_id));
    assert_eq!(audit["source"]["patient_id"], json!(child));
    for value in [
        "Anna",
        "Muster",
        "FX123456",
        "Kyiv",
        "1985-03-04",
        &mother_email,
    ] {
        assert!(
            !audit_text.contains(value),
            "audit carries values: {audit_text}"
        );
    }
}

#[tokio::test]
async fn the_childs_own_email_is_never_the_parents() {
    let Some(suite) = support::suite_context(SECRET).await else {
        return;
    };
    let pool = &suite.pool;
    let today = gmed_server::app_time::today();
    let ceo = user(pool, "Chef", "ceo", &unique("ceo"), true).await;
    let child_email = unique("mia");
    let child_login = user(pool, "Mia Muster", "patient", &child_email, true).await;
    let child = patient(
        pool,
        ceo,
        "Mia",
        years_before(today, 10),
        Some(&child_email),
        None,
    )
    .await;
    let contact_id = Uuid::new_v4();
    let contact = json!({
        "id": contact_id, "name": "Anna Muster", "relation": "mother", "email": child_email,
    });
    child_request(
        pool,
        ceo,
        years_before(today, 10),
        &child_email,
        Some(child_login),
        Some(child),
        &contact,
    )
    .await;
    // The relation carries the child's login address (staff typed it there).
    let relation_id = relation(
        pool,
        child,
        "Anna Muster",
        Some(&child_email),
        None,
        NaiveDate::from_ymd_opt(1985, 3, 4),
        Some(contact_id),
        None,
    )
    .await;
    let (status, body) = post(
        &suite.app,
        "/api/v1/leads",
        &bearer(ceo, "ceo"),
        json!({ "source_person": { "patient_id": child, "relation_id": relation_id } }),
    )
    .await;
    // Skipped, so the adult's request has no address: staff must type one.
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
    assert_eq!(body["field"], json!("email"), "{body}");
}

#[tokio::test]
async fn a_relation_with_an_own_record_is_refused_with_409() {
    let Some(suite) = support::suite_context(SECRET).await else {
        return;
    };
    let pool = &suite.pool;
    let today = gmed_server::app_time::today();
    let ceo = user(pool, "Chef", "ceo", &unique("ceo"), true).await;
    let child = patient(pool, ceo, "Mia", years_before(today, 10), None, None).await;
    let mother = patient(
        pool,
        ceo,
        "Anna",
        NaiveDate::from_ymd_opt(1985, 3, 4).unwrap(),
        Some(&unique("anna")),
        None,
    )
    .await;
    let relation_id = relation(
        pool,
        child,
        "Anna Muster",
        None,
        None,
        None,
        None,
        Some(mother),
    )
    .await;
    let (status, body) = post(
        &suite.app,
        "/api/v1/leads",
        &bearer(ceo, "ceo"),
        json!({ "source_person": { "patient_id": child, "relation_id": relation_id } }),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{body}");
    assert_eq!(body["code"], json!(CODE));
    assert_eq!(body["existing_patient_id"], json!(mother));
    assert_eq!(body["patient_id"], json!(mother));
    let leads: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM leads WHERE first_name = 'Anna' AND source_relation_id = $1",
    )
    .bind(relation_id)
    .fetch_one(pool)
    .await
    .unwrap();
    assert_eq!(leads, 0, "no lead is created");
}

#[tokio::test]
async fn a_trusted_contact_of_an_open_lead_prefills_the_request() {
    let Some(suite) = support::suite_context(SECRET).await else {
        return;
    };
    let pool = &suite.pool;
    let today = gmed_server::app_time::today();
    let ceo = user(pool, "Chef", "ceo", &unique("ceo"), true).await;
    let contact_id = Uuid::new_v4();
    let father_email = unique("ben");
    let contact = json!({
        "id": contact_id, "name": "Ben Muster", "relation": "father",
        "email": father_email, "phone": "+49 170 3333333", "birth_date": "1983-07-08",
        "address": "Hauptstr. 5, 20095 Hamburg, DE",
    });
    let child_lead = child_request(
        pool,
        ceo,
        years_before(today, 12),
        &unique("mia"),
        None,
        None,
        &contact,
    )
    .await;
    // The identity document on the child's request; no address there.
    sqlx::query(
        r#"INSERT INTO lead_representatives (
               lead_id, contact_id, role, contact_origin, id_document_type, id_document_number,
               id_valid_until, updated_by)
           VALUES ($1, $2, 'legal_representative', 'staff', 'id_card', 'ID7777', '2031-05-06', $3)"#,
    )
    .bind(child_lead)
    .bind(contact_id)
    .bind(ceo)
    .execute(pool)
    .await
    .unwrap();

    let (status, body) = post(
        &suite.app,
        "/api/v1/leads",
        &bearer(ceo, "ceo"),
        json!({ "source_person": { "lead_id": child_lead, "contact_id": contact_id } }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    let lead_id: Uuid = body["id"].as_str().unwrap().parse().unwrap();
    let row = lead_row(pool, lead_id).await;
    assert_eq!((row.0.as_str(), row.1.as_str()), ("Ben", "Muster"));
    assert_eq!(row.2, NaiveDate::from_ymd_opt(1983, 7, 8));
    assert_eq!(row.3.as_deref(), Some("+49 170 3333333"));
    assert_eq!(row.4.as_deref(), Some(father_email.as_str()));
    assert_eq!(
        (
            row.5.as_deref(),
            row.6.as_deref(),
            row.7.as_deref(),
            row.8.as_deref()
        ),
        (
            Some("Hauptstr. 5"),
            Some("20095"),
            Some("Hamburg"),
            Some("DE")
        )
    );
    assert_eq!(row.10, None);
    assert_eq!((row.11, row.12), (Some(child_lead), Some(contact_id)));
    let document: (Option<String>, Option<String>) = sqlx::query_as(
        "SELECT id_document_type, id_document_number FROM lead_gwg_declarations WHERE lead_id = $1",
    )
    .bind(lead_id)
    .fetch_one(pool)
    .await
    .unwrap();
    assert_eq!(
        (document.0.as_deref(), document.1.as_deref()),
        (Some("id_card"), Some("ID7777"))
    );
    assert_eq!(
        body["prefilled_from_source"]["hints"]["pep_self"],
        Value::Null
    );
    let filled = fields(&body);
    assert!(filled.iter().any(|f| f == "phone"), "{filled:?}");
    assert!(filled.iter().any(|f| f == "street_address"), "{filled:?}");
    let lead_path = format!("/api/v1/leads/{lead_id}");
    let (status, lead) = get(&suite.app, &lead_path, &bearer(ceo, "ceo")).await;
    assert_eq!(status, StatusCode::OK, "{lead}");
    assert_eq!(lead["source_relation_id"], Value::Null, "{lead}");
    assert_eq!(lead["source_contact_lead_id"], json!(child_lead), "{lead}");
    assert_eq!(lead["source_contact_id"], json!(contact_id), "{lead}");
    assert_eq!(lead["source_pep_hint"], Value::Null, "{lead}");
    // The hint is read again: the child's answer given later shows up.
    sqlx::query(
        r#"UPDATE lead_representatives
           SET country_questions = '{"pep_self": false}'::jsonb
           WHERE lead_id = $1 AND contact_id = $2"#,
    )
    .bind(child_lead)
    .bind(contact_id)
    .execute(pool)
    .await
    .unwrap();
    let (_, lead) = get(&suite.app, &lead_path, &bearer(ceo, "ceo")).await;
    assert_eq!(lead["source_pep_hint"], json!("no"), "{lead}");
    // The child's request itself has no source.
    let (_, child) = get(
        &suite.app,
        &format!("/api/v1/leads/{child_lead}"),
        &bearer(ceo, "ceo"),
    )
    .await;
    assert_eq!(child["source_pep_hint"], Value::Null, "{child}");
    assert_eq!(child["source_relation_id"], Value::Null, "{child}");

    // The same contact again: a lead cannot be pre-filled from a contact
    // that is not on the lead.
    let (status, body) = post(
        &suite.app,
        "/api/v1/leads",
        &bearer(ceo, "ceo"),
        json!({ "source_person": { "lead_id": child_lead, "contact_id": Uuid::new_v4() } }),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND, "{body}");
    let (status, body) = post(
        &suite.app,
        "/api/v1/leads",
        &bearer(ceo, "ceo"),
        json!({ "source_person": { "lead_id": child_lead } }),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
    assert_eq!(body["field"], json!("source_person"));
}

#[tokio::test]
async fn the_parents_phone_on_the_childs_record_passes_the_identity_check() {
    let Some(suite) = support::suite_context(SECRET).await else {
        return;
    };
    let pool = &suite.pool;
    let today = gmed_server::app_time::today();
    let ceo = user(pool, "Chef", "ceo", &unique("ceo"), true).await;
    // The mother's phone is the child's record phone; the relation has none.
    let child = patient(
        pool,
        ceo,
        "Mia",
        years_before(today, 9),
        Some(&unique("mia")),
        Some("+49 170 7777777"),
    )
    .await;
    let relation_id = relation(
        pool,
        child,
        "Anna Muster",
        None,
        None,
        NaiveDate::from_ymd_opt(1985, 3, 4),
        None,
        None,
    )
    .await;
    let mother_email = unique("anna");
    let body_without_source = json!({
        "first_name": "Anna", "last_name": "Muster", "email": mother_email,
        "phone": "+49 170 7777777",
    });
    let (status, body) = post(
        &suite.app,
        "/api/v1/leads",
        &bearer(ceo, "ceo"),
        body_without_source.clone(),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
    assert_eq!(body["field"], json!("phone"), "{body}");

    let mut with_source = body_without_source;
    with_source["source_person"] = json!({ "patient_id": child, "relation_id": relation_id });
    let (status, body) = post(
        &suite.app,
        "/api/v1/leads",
        &bearer(ceo, "ceo"),
        with_source,
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    let row = lead_row(pool, body["id"].as_str().unwrap().parse().unwrap()).await;
    assert_eq!(row.3.as_deref(), Some("+49 170 7777777"));
    assert_eq!(row.10, Some(relation_id));
}

/// The same person on a sibling's card (owner decision 2026-10-28): an
/// unlinked relation with a patient's full name and date of birth is
/// suggested, never linked by itself; staff link it and the other record
/// names the child back.
#[tokio::test]
async fn a_relation_naming_a_patient_is_suggested_and_linked_by_staff() {
    let Some(suite) = support::suite_context(SECRET).await else {
        return;
    };
    let pool = &suite.pool;
    let today = gmed_server::app_time::today();
    let ceo = user(pool, "Chef", "ceo", &unique("ceo"), true).await;
    let auth = bearer(ceo, "ceo");
    let born = NaiveDate::from_ymd_opt(1985, 3, 4).unwrap();
    let anna = patient(pool, ceo, "Anna", born, None, None).await;
    let mia = patient(pool, ceo, "Mia", years_before(today, 10), None, None).await;
    let ben = patient(pool, ceo, "Ben", years_before(today, 8), None, None).await;
    let mias_mother = relation(
        pool,
        mia,
        " anna   MUSTER ",
        None,
        None,
        Some(born),
        None,
        None,
    )
    .await;
    // Another date of birth is another person: no suggestion.
    let bens_mother = relation(
        pool,
        ben,
        "Anna Muster",
        None,
        None,
        born.succ_opt(),
        None,
        None,
    )
    .await;

    let (status, list) = get(
        &suite.app,
        &format!("/api/v1/patients/{mia}/relations"),
        &auth,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{list}");
    let row = list
        .as_array()
        .unwrap()
        .iter()
        .find(|row| row["id"] == json!(mias_mother))
        .cloned()
        .unwrap_or_else(|| panic!("{list}"));
    assert_eq!(row["link_suggestion"]["patient_id"], json!(anna), "{row}");
    assert_eq!(row["link_suggestion"]["name"], "Anna Muster", "{row}");
    assert!(
        row["related_patient_id"].is_null(),
        "nothing links by itself: {row}"
    );
    let (_, list) = get(
        &suite.app,
        &format!("/api/v1/patients/{ben}/relations"),
        &auth,
    )
    .await;
    let row = list
        .as_array()
        .unwrap()
        .iter()
        .find(|row| row["id"] == json!(bens_mother))
        .cloned()
        .unwrap_or_else(|| panic!("{list}"));
    assert!(row.get("link_suggestion").is_none(), "{row}");

    // Only the suggested record is linked.
    let link = format!("/api/v1/patients/{mia}/relations/{mias_mother}/link");
    let (status, _) = post(
        &suite.app,
        &link,
        &auth,
        json!({ "related_patient_id": ben }),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    let (status, linked) = post(
        &suite.app,
        &link,
        &auth,
        json!({ "related_patient_id": anna }),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{linked}");
    assert_eq!(linked["related_patient_id"], json!(anna), "{linked}");
    let reverse: Vec<String> = sqlx::query_scalar(
        "SELECT relation_type FROM patient_relations WHERE patient_id = $1 AND related_patient_id = $2",
    )
    .bind(anna)
    .bind(mia)
    .fetch_all(pool)
    .await
    .unwrap();
    assert_eq!(reverse, vec!["child".to_string()]);
    assert!(
        audit_context(pool, "link_patient_relation", mia)
            .await
            .is_some()
    );
    // Linked once: no suggestion, a second link is refused.
    let (status, _) = post(
        &suite.app,
        &link,
        &auth,
        json!({ "related_patient_id": anna }),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
}

/// A guardian's own record names the child as ward, not as child (owner
/// decision 2026-10-28).
#[tokio::test]
async fn a_guardians_record_names_the_child_as_ward() {
    let Some(suite) = support::suite_context(SECRET).await else {
        return;
    };
    let pool = &suite.pool;
    let today = gmed_server::app_time::today();
    let ceo = user(pool, "Chef", "ceo", &unique("ceo"), true).await;
    let born = NaiveDate::from_ymd_opt(1968, 3, 3).unwrap();
    let vera = patient(pool, ceo, "Vera", born, None, None).await;
    let emil = patient(pool, ceo, "Emil", years_before(today, 12), None, None).await;
    let guardian = relation(
        pool,
        emil,
        "Vera Muster",
        None,
        None,
        Some(born),
        None,
        None,
    )
    .await;
    sqlx::query("UPDATE patient_relations SET relation_type = 'guardian' WHERE id = $1")
        .bind(guardian)
        .execute(pool)
        .await
        .unwrap();
    let (status, body) = post(
        &suite.app,
        &format!("/api/v1/patients/{emil}/relations/{guardian}/link"),
        &bearer(ceo, "ceo"),
        json!({ "related_patient_id": vera }),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let reverse: Vec<String> = sqlx::query_scalar(
        "SELECT relation_type FROM patient_relations WHERE patient_id = $1 AND related_patient_id = $2",
    )
    .bind(vera)
    .bind(emil)
    .fetch_all(pool)
    .await
    .unwrap();
    assert_eq!(reverse, vec!["ward".to_string()]);
}

#[tokio::test]
async fn the_conversion_links_the_relation_to_the_new_patient() {
    let Some(suite) = support::suite_context(SECRET).await else {
        return;
    };
    let pool = &suite.pool;
    let today = gmed_server::app_time::today();
    let ceo = user(pool, "Chef", "ceo", &unique("ceo"), true).await;
    let child_email = unique("mia");
    let child = patient(
        pool,
        ceo,
        "Mia",
        years_before(today, 10),
        Some(&child_email),
        None,
    )
    .await;
    let contact_id = Uuid::new_v4();
    let mother_email = unique("anna");
    let contact = json!({
        "id": contact_id, "name": "Anna Muster", "relation": "mother", "email": mother_email,
    });
    let child_lead = child_request(
        pool,
        ceo,
        years_before(today, 10),
        &child_email,
        None,
        Some(child),
        &contact,
    )
    .await;
    let relation_id = relation(
        pool,
        child,
        "Anna Muster",
        Some(&mother_email),
        None,
        NaiveDate::from_ymd_opt(1985, 3, 4),
        Some(contact_id),
        None,
    )
    .await;
    let (status, body) = post(
        &suite.app,
        "/api/v1/leads",
        &bearer(ceo, "ceo"),
        json!({ "source_person": { "patient_id": child, "relation_id": relation_id } }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    let lead_id: Uuid = body["id"].as_str().unwrap().parse().unwrap();

    // The conversion step that links the login and the relations. The new
    // patient record carries the e-mail the child's relation names, so the
    // match by e-mail could link it too: the link by the source runs first
    // and is audited as such (QA 2026-10-25).
    let mother = patient(
        pool,
        ceo,
        "Anna",
        NaiveDate::from_ymd_opt(1985, 3, 4).unwrap(),
        Some(&mother_email),
        None,
    )
    .await;
    sqlx::query(
        "UPDATE leads SET converted_patient_id = $2, qualification_status = 'converted' WHERE id = $1",
    )
    .bind(lead_id)
    .bind(mother)
    .execute(pool)
    .await
    .unwrap();
    let mut tx = pool.begin().await.unwrap();
    gmed_server::routes::lead_portal_account::link_to_patient_in_tx(&mut tx, lead_id, mother, ceo)
        .await
        .unwrap();
    tx.commit().await.unwrap();

    let linked: Option<Uuid> =
        sqlx::query_scalar("SELECT related_patient_id FROM patient_relations WHERE id = $1")
            .bind(relation_id)
            .fetch_one(pool)
            .await
            .unwrap();
    assert_eq!(
        linked,
        Some(mother),
        "the relation points to the new record"
    );
    let contact_link: Option<String> = sqlx::query_scalar(
        "SELECT c ->> 'related_patient_id' FROM leads l,
                jsonb_array_elements(l.trusted_contacts) c
         WHERE l.id = $1 AND c ->> 'id' = $2::text",
    )
    .bind(child_lead)
    .bind(contact_id)
    .fetch_one(pool)
    .await
    .unwrap();
    assert_eq!(contact_link.as_deref(), Some(mother.to_string().as_str()));
    let audit = audit_context(pool, "link_source_relation_to_patient", child)
        .await
        .expect("audit row on the child");
    assert_eq!(audit["relation_id"], json!(relation_id));
    assert_eq!(audit["related_patient_id"], json!(mother));
    assert!(
        audit_context(pool, "link_parent_relation_by_email", child)
            .await
            .is_none(),
        "the e-mail matcher finds the relation linked already"
    );

    // The mother's own record names the child (the reverse relation).
    let reverse: Vec<(Uuid, String, String)> = sqlx::query_as(
        "SELECT id, relation_type, related_name FROM patient_relations
         WHERE patient_id = $1 AND related_patient_id = $2",
    )
    .bind(mother)
    .bind(child)
    .fetch_all(pool)
    .await
    .unwrap();
    assert_eq!(reverse.len(), 1, "{reverse:?}");
    assert_eq!(reverse[0].1, "child");
    assert_eq!(reverse[0].2, "Mia Muster");
    let audit = audit_context(pool, "add_reverse_relation_from_source_person", mother)
        .await
        .expect("reverse relation audited on the parent");
    assert_eq!(audit["relation_id"], json!(reverse[0].0));
    assert_eq!(audit["reverse_of_relation_id"], json!(relation_id));
    assert_eq!(audit["related_patient_id"], json!(child));

    // A second run finds nothing to do and adds no second reverse row.
    let mut tx = pool.begin().await.unwrap();
    let again = gmed_server::routes::lead_portal_account::link_source_person_in_tx(
        &mut tx, lead_id, mother, ceo,
    )
    .await
    .unwrap();
    tx.commit().await.unwrap();
    assert!(!again);
    let reverse_rows: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM patient_relations WHERE patient_id = $1 AND related_patient_id = $2",
    )
    .bind(mother)
    .bind(child)
    .fetch_one(pool)
    .await
    .unwrap();
    assert_eq!(reverse_rows, 1);
}

#[tokio::test]
async fn a_guardian_login_ended_by_coming_of_age_is_reactivated_for_the_own_request() {
    let Some(suite) = support::suite_context(SECRET).await else {
        return;
    };
    let pool = &suite.pool;
    let today = gmed_server::app_time::today();
    let ceo = user(pool, "Chef", "ceo", &unique("ceo"), true).await;
    let reason = gmed_server::services::coming_of_age::REVOKE_REASON;
    // The child is of age; the mother's guardian login was switched off by
    // the job because it reached nothing else.
    let birth = years_before(today, 18).pred_opt().unwrap();
    let child = patient(pool, ceo, "Mia", birth, Some(&unique("mia")), None).await;
    let mother_email = unique("anna");
    let mother = user(pool, "Anna Muster", "patient", &mother_email, false).await;
    let contact_id = Uuid::new_v4();
    let contact = json!({
        "id": contact_id, "name": "Anna Muster", "relation": "mother",
        "email": mother_email, "birth_date": "1985-03-04",
    });
    let child_lead = child_request(
        pool,
        ceo,
        birth,
        &unique("mia-request"),
        None,
        Some(child),
        &contact,
    )
    .await;
    sqlx::query(
        "INSERT INTO lead_portal_access (lead_id, user_id, kind, trusted_contact_id, created_by,
                                         revoked_at, revoked_reason)
         VALUES ($1, $2, 'guardian', $3, $4, now(), $5)",
    )
    .bind(child_lead)
    .bind(mother)
    .bind(contact_id)
    .bind(ceo)
    .bind(reason)
    .execute(pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO patient_assignments (patient_id, user_id, assigned_by, source, revoked_at,
                                          revoked_reason)
         VALUES ($1, $2, $3, 'lead_guardian', now(), $4)",
    )
    .bind(child)
    .bind(mother)
    .bind(ceo)
    .bind(reason)
    .execute(pool)
    .await
    .unwrap();
    let relation_id = relation(
        pool,
        child,
        "Anna Muster",
        Some(&mother_email),
        None,
        NaiveDate::from_ymd_opt(1985, 3, 4),
        Some(contact_id),
        None,
    )
    .await;

    let (status, body) = post(
        &suite.app,
        "/api/v1/leads",
        &bearer(ceo, "ceo"),
        json!({ "source_person": { "patient_id": child, "relation_id": relation_id } }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    let lead_id: Uuid = body["id"].as_str().unwrap().parse().unwrap();
    assert_eq!(body["portal_account"]["reused"], json!(true), "{body}");
    assert_eq!(body["portal_account"]["user_id"], json!(mother), "{body}");
    let (active, login): (bool, Option<Uuid>) = sqlx::query_as(
        "SELECT u.is_active, l.portal_user_id FROM users u, leads l WHERE u.id = $1 AND l.id = $2",
    )
    .bind(mother)
    .bind(lead_id)
    .fetch_one(pool)
    .await
    .unwrap();
    assert!(active, "the login is switched on again");
    assert_eq!(login, Some(mother));
    let audit = audit_context(pool, "reactivate_guardian_for_own_lead", lead_id)
        .await
        .expect("reactivation audited");
    assert_eq!(audit["portal_user_id"], json!(mother));
    assert_eq!(audit["deactivated_reason"], json!(reason));

    // A login staff switched off for another reason is not taken that way:
    // the address belongs to an account, so the request names the owner.
    let other_email = unique("ben");
    let other = user(pool, "Ben Muster", "patient", &other_email, false).await;
    let other_contact = Uuid::new_v4();
    let other_lead = child_request(
        pool,
        ceo,
        birth,
        &unique("mia-other"),
        None,
        Some(child),
        &json!({
            "id": other_contact, "name": "Ben Muster", "relation": "father",
            "email": other_email, "birth_date": "1983-07-08",
        }),
    )
    .await;
    sqlx::query(
        "INSERT INTO lead_portal_access (lead_id, user_id, kind, trusted_contact_id, created_by,
                                         revoked_at, revoked_by, revoked_reason)
         VALUES ($1, $2, 'guardian', $3, $4, now(), $4, 'manual')",
    )
    .bind(other_lead)
    .bind(other)
    .bind(other_contact)
    .bind(ceo)
    .execute(pool)
    .await
    .unwrap();
    let (status, body) = post(
        &suite.app,
        "/api/v1/leads",
        &bearer(ceo, "ceo"),
        json!({
            "first_name": "Ben", "last_name": "Muster", "email": other_email,
            "date_of_birth": "1983-07-08",
        }),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{body}");
    assert_eq!(body["code"], json!("portal_email_taken"), "{body}");
    let still_off: bool = sqlx::query_scalar("SELECT is_active FROM users WHERE id = $1")
        .bind(other)
        .fetch_one(pool)
        .await
        .unwrap();
    assert!(!still_off);
}
