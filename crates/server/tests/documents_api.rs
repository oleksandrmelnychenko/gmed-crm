mod support;

use std::path::Path as FsPath;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use serde_json::{Value, json};
use sqlx::{PgPool, Row};
use tower::ServiceExt;
use uuid::Uuid;

use gmed_server::auth::jwt;
const TEST_SECRET: &str = "test-secret-at-least-32-characters-long!!";
const TINY_TRANSPARENT_PNG: &[u8] = &[
    137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0,
    0, 0, 31, 21, 196, 137, 0, 0, 0, 13, 73, 68, 65, 84, 8, 29, 99, 248, 255, 255, 255, 127, 0, 9,
    251, 3, 253, 5, 67, 69, 202, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130,
];

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
    let req = Request::builder()
        .method(method)
        .uri(path)
        .header("Authorization", bearer)
        .header("Content-Type", "application/json")
        .body(match body {
            Some(v) => Body::from(serde_json::to_vec(&v).unwrap()),
            None => Body::empty(),
        })
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();
    let status = resp.status();
    let bytes = axum::body::to_bytes(resp.into_body(), 4 * 1024 * 1024)
        .await
        .unwrap();
    let value = serde_json::from_slice(&bytes).unwrap_or(json!(null));
    (status, value)
}

async fn bytes_request(
    app: &axum::Router,
    method: &str,
    path: &str,
    bearer: &str,
) -> (StatusCode, Vec<u8>) {
    let req = Request::builder()
        .method(method)
        .uri(path)
        .header("Authorization", bearer)
        .body(Body::empty())
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();
    let status = resp.status();
    let bytes = axum::body::to_bytes(resp.into_body(), 4 * 1024 * 1024)
        .await
        .unwrap()
        .to_vec();
    (status, bytes)
}

/// Extract text from a generated PDF for content assertions. PDF word-wrapping
/// inserts line breaks mid-phrase (so e.g. a label and its value land on
/// separate lines), which `pdf_extract` surfaces as newlines. We collapse every
/// run of whitespace to a single space so `contains(...)` checks assert on
/// content rather than on where the layout happens to wrap.
fn extract_pdf_text(bytes: &[u8]) -> String {
    let raw = pdf_extract::extract_text_from_mem(bytes).unwrap();
    raw.split_whitespace().collect::<Vec<_>>().join(" ")
}

async fn multipart_upload(
    app: &axum::Router,
    path: &str,
    bearer: &str,
    text_fields: &[(&str, String)],
    file_name: &str,
    mime_type: &str,
    file_bytes: &[u8],
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
        format!(
            "Content-Disposition: form-data; name=\"file\"; filename=\"{file_name}\"\r\nContent-Type: {mime_type}\r\n\r\n"
        )
        .as_bytes(),
    );
    body.extend_from_slice(file_bytes);
    body.extend_from_slice(b"\r\n");
    body.extend_from_slice(format!("--{boundary}--\r\n").as_bytes());

    let req = Request::builder()
        .method("POST")
        .uri(path)
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
    let value = serde_json::from_slice(&bytes).unwrap_or(json!(null));
    (status, value)
}

fn auth_header_for(user_id: Uuid, role: &str) -> String {
    let token = jwt::issue_access_token(TEST_SECRET, user_id, role, Uuid::new_v4()).unwrap();
    format!("Bearer {token}")
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

async fn seed_patient(pool: &PgPool, created_by: Uuid, tag: &str) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO patients (patient_id, first_name, last_name, birth_date, gender, created_by)
           VALUES ($1, $2, $3, '1990-01-01', 'diverse', $4)
           RETURNING id"#,
    )
    .bind(format!("PT-{tag}"))
    .bind(format!("First {tag}"))
    .bind(format!("Last {tag}"))
    .bind(created_by)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn configure_patient_label_profile(pool: &PgPool, patient_id: Uuid) {
    sqlx::query(
        r#"UPDATE patients
           SET title = 'Dr.',
               nationality = 'Ukraine',
               residence_country = 'Germany',
               insurance_provider = 'AOK Rheinland'
           WHERE id = $1"#,
    )
    .bind(patient_id)
    .execute(pool)
    .await
    .unwrap();

    sqlx::query(
        r#"UPDATE system_settings
           SET value = $2::jsonb, updated_at = now()
           WHERE key = $1"#,
    )
    .bind("agency_address")
    .bind(json!("Agency Street 1, 50667 Cologne"))
    .execute(pool)
    .await
    .unwrap();
    sqlx::query(
        r#"UPDATE system_settings
           SET value = $2::jsonb, updated_at = now()
           WHERE key = $1"#,
    )
    .bind("agency_phone")
    .bind(json!("+49 221 555000"))
    .execute(pool)
    .await
    .unwrap();
    sqlx::query(
        r#"UPDATE system_settings
           SET value = $2::jsonb, updated_at = now()
           WHERE key = $1"#,
    )
    .bind("agency_email")
    .bind(json!("care@gmed.de"))
    .execute(pool)
    .await
    .unwrap();
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
    seed_provider_with_type(pool, tag, "medical").await
}

async fn seed_provider_with_type(pool: &PgPool, tag: &str, provider_type: &str) -> Uuid {
    seed_provider_with_type_and_specialty(pool, tag, provider_type, &format!("Fach {tag}")).await
}

async fn seed_provider_with_type_and_specialty(
    pool: &PgPool,
    tag: &str,
    provider_type: &str,
    specialty: &str,
) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO providers (
                name, provider_type, address_street, address_city, fachbereich, address_country, phone, email
           )
           VALUES ($1, $2, 'Clinic Street 1', $3, $4, 'Germany', $5, $6)
           RETURNING id"#,
    )
    .bind(format!("Clinic {tag}"))
    .bind(provider_type)
    .bind(format!("City {tag}"))
    .bind(specialty)
    .bind(format!("+49-221-{tag}"))
    .bind(format!("{tag}@clinic.example"))
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn seed_doctor(pool: &PgPool, provider_id: Uuid, tag: &str) -> Uuid {
    seed_doctor_with_specialty(pool, provider_id, tag, &format!("Fach {tag}")).await
}

async fn seed_doctor_with_specialty(
    pool: &PgPool,
    provider_id: Uuid,
    tag: &str,
    specialty: &str,
) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO provider_doctors (provider_id, name, fachbereich)
           VALUES ($1, $2, $3)
           RETURNING id"#,
    )
    .bind(provider_id)
    .bind(format!("Doctor {tag}"))
    .bind(specialty)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn seed_appointment(
    pool: &PgPool,
    patient_id: Uuid,
    provider_id: Uuid,
    doctor_id: Uuid,
    created_by: Uuid,
    tag: &str,
) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO appointments (
                patient_id, provider_id, doctor_id, appointment_type, title, date, status, created_by
           ) VALUES (
                $1, $2, $3, 'medical', $4, '2026-04-15', 'planned', $5
           ) RETURNING id"#,
    )
    .bind(patient_id)
    .bind(provider_id)
    .bind(doctor_id)
    .bind(format!("Visit {tag}"))
    .bind(created_by)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn seed_case(
    pool: &PgPool,
    patient_id: Uuid,
    manager_id: Uuid,
    case_code: &str,
    status: &str,
    reason: &str,
) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO cases (
                case_id, patient_id, manager_id, status, hauptanfragegrund
           ) VALUES (
                $1, $2, $3, $4, $5
           ) RETURNING id"#,
    )
    .bind(case_code)
    .bind(patient_id)
    .bind(manager_id)
    .bind(status)
    .bind(reason)
    .fetch_one(pool)
    .await
    .unwrap()
}

#[allow(clippy::too_many_arguments)]
async fn seed_case_medication(
    pool: &PgPool,
    case_id: Uuid,
    trade_name: &str,
    ingredient: &str,
    dose: &str,
    dose_unit: &str,
    schedule: &str,
    prescribing_doctor: &str,
    medication_type: &str,
    reason: &str,
) {
    sqlx::query(
        r#"INSERT INTO medikamente (
                case_id, handelsname, wirkstoff, dosis, dosis_einheit, einnahmeschema,
                verordnender_arzt, med_typ, grund
           ) VALUES (
                $1, $2, $3, $4, $5, $6,
                $7, $8, $9
           )"#,
    )
    .bind(case_id)
    .bind(trade_name)
    .bind(ingredient)
    .bind(dose)
    .bind(dose_unit)
    .bind(schedule)
    .bind(prescribing_doctor)
    .bind(medication_type)
    .bind(reason)
    .execute(pool)
    .await
    .unwrap();
}

async fn seed_framework_contract(
    pool: &PgPool,
    patient_id: Uuid,
    created_by: Uuid,
    tag: &str,
) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO framework_contracts (
                patient_id, contract_number, signed_at, valid_from, valid_to,
                conditions, status, created_by
           ) VALUES (
                $1, $2, '2026-04-01T09:15:00Z', '2026-04-01', '2026-12-31',
                $3::jsonb, 'signed', $4
           ) RETURNING id"#,
    )
    .bind(patient_id)
    .bind(format!("FC-{tag}"))
    .bind(json!({
        "payment_model": "Advance payment before treatment",
        "language_support": ["Interpreter coordination", "Written follow-up"],
        "termination_notice_days": 14
    }))
    .bind(created_by)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn seed_order_with_contract(
    pool: &PgPool,
    patient_id: Uuid,
    contract_id: Uuid,
    created_by: Uuid,
    tag: &str,
) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO orders (
                order_number, patient_id, contract_id, phase, status, needs_description, created_by
           ) VALUES (
                $1, $2, $3, 'execution', 'active', $4, $5
           ) RETURNING id"#,
    )
    .bind(format!("AUF-{tag}"))
    .bind(patient_id)
    .bind(contract_id)
    .bind(format!("Framework contract scope {tag}"))
    .bind(created_by)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn seed_quote_for_order(pool: &PgPool, order_id: Uuid, created_by: Uuid, tag: &str) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO quotes (
                order_id, quote_number, total_net, total_vat, total_gross,
                status, valid_until, line_items, notes, created_by
           ) VALUES (
                $1, $2, 1200, 228, 1428,
                'sent', '2026-05-20', $3::jsonb, $4, $5
           ) RETURNING id"#,
    )
    .bind(order_id)
    .bind(format!("KV-{tag}"))
    .bind(json!([
        {
            "description": "Koordination vor stationärer Aufnahme",
            "quantity": "1",
            "unit_price": "750",
            "vat_rate": "19",
            "line_gross": "892.50",
            "notes": "inkl. Vorprüfung der Unterlagen"
        },
        {
            "description": "Dolmetscher- und Begleitservice",
            "quantity": "2",
            "unit_price": "225",
            "vat_rate": "19",
            "line_gross": "535.50"
        }
    ]))
    .bind(format!("Framework contract quote {tag}"))
    .bind(created_by)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn seed_patient_share_consent(
    pool: &PgPool,
    patient_id: Uuid,
    patient_user_id: Uuid,
    consent_type: &str,
) {
    sqlx::query(
        r#"INSERT INTO consent_records (
                patient_id, user_id, consent_type, granted, granted_at, context
           ) VALUES (
                $1, $2, $3, true, now(), '{}'::jsonb
           )"#,
    )
    .bind(patient_id)
    .bind(patient_user_id)
    .bind(consent_type)
    .execute(pool)
    .await
    .unwrap();
}

async fn configure_required_patient_documents(pool: &PgPool, value: Value) {
    sqlx::query(
        r#"UPDATE system_settings
           SET value = $2::jsonb, updated_at = now()
           WHERE key = $1"#,
    )
    .bind("required_patient_documents")
    .bind(value)
    .execute(pool)
    .await
    .unwrap();
}

#[allow(clippy::too_many_arguments)]
async fn seed_document(
    pool: &PgPool,
    uploaded_by: Uuid,
    patient_id: Uuid,
    appointment_id: Uuid,
    visibility: &str,
    is_medical: bool,
    art: &str,
    tag: &str,
) -> Uuid {
    let document_id = Uuid::new_v4();
    sqlx::query_scalar(
        r#"INSERT INTO documents (
                id, patient_id, appointment_id, auto_name, original_filename, art, category,
                status, visibility, is_medical, mime_type, file_size, version_root_document_id,
                version_number, uploaded_by
           ) VALUES (
                $1, $2, $3, $4, $5, $6, $7,
                'active', $8, $9, 'application/pdf', 1234, $1,
                1, $10
           ) RETURNING id"#,
    )
    .bind(document_id)
    .bind(patient_id)
    .bind(appointment_id)
    .bind(format!("Document {tag}"))
    .bind(format!("{tag}.pdf"))
    .bind(art)
    .bind("general")
    .bind(visibility)
    .bind(is_medical)
    .bind(uploaded_by)
    .fetch_one(pool)
    .await
    .unwrap()
}

#[tokio::test]
async fn document_upload_list_get_and_download_work() {
    let Some((app, pool, admin_id, admin_bearer)) = test_context().await else {
        return;
    };
    let tag = unique_tag("doc-upload");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let provider_id = seed_provider(&pool, &tag).await;
    let doctor_id = seed_doctor(&pool, provider_id, &tag).await;
    let appointment_id =
        seed_appointment(&pool, patient_id, provider_id, doctor_id, admin_id, &tag).await;

    let (status, body) = multipart_upload(
        &app,
        "/api/v1/documents/upload",
        &admin_bearer,
        &[
            ("patient_id", patient_id.to_string()),
            ("appointment_id", appointment_id.to_string()),
            ("auto_name", format!("Arztbrief {tag}")),
            ("art", "arztbrief".to_string()),
            ("category", "medical".to_string()),
            ("status", "active".to_string()),
            ("visibility", "released_internal".to_string()),
            ("is_medical", "true".to_string()),
        ],
        "arztbrief.pdf",
        "application/pdf",
        b"%PDF-test-binary%",
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let document_id = Uuid::parse_str(body["id"].as_str().unwrap()).unwrap();

    let (status, list_body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/documents?patient_id={patient_id}"),
        &admin_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let items = list_body.as_array().unwrap();
    assert!(
        items
            .iter()
            .any(|item| item["id"] == document_id.to_string())
    );

    let (status, detail_body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/documents/{document_id}"),
        &admin_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(detail_body["appointment_id"], appointment_id.to_string());
    assert_eq!(detail_body["art"], "arztbrief");

    let (status, bytes) = bytes_request(
        &app,
        "GET",
        &format!("/api/v1/documents/{document_id}/download"),
        &admin_bearer,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(String::from_utf8_lossy(&bytes).contains("%PDF-test-binary%"));
}

#[tokio::test]
async fn document_list_supports_date_clinic_and_origin_filters() {
    let Some((app, pool, admin_id, admin_bearer)) = test_context().await else {
        return;
    };
    let tag = unique_tag("doc-filters");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let provider_id = seed_provider(&pool, &tag).await;
    let doctor_id = seed_doctor(&pool, provider_id, &tag).await;
    let appointment_id =
        seed_appointment(&pool, patient_id, provider_id, doctor_id, admin_id, &tag).await;

    let matching_id = seed_document(
        &pool,
        admin_id,
        patient_id,
        appointment_id,
        "internal",
        true,
        "arztbrief",
        &format!("{tag}-matching"),
    )
    .await;
    let wrong_date_id = seed_document(
        &pool,
        admin_id,
        patient_id,
        appointment_id,
        "internal",
        true,
        "arztbrief",
        &format!("{tag}-wrong-date"),
    )
    .await;
    let wrong_context_id = seed_document(
        &pool,
        admin_id,
        patient_id,
        appointment_id,
        "internal",
        true,
        "arztbrief",
        &format!("{tag}-wrong-context"),
    )
    .await;

    sqlx::query(
        r#"UPDATE documents
           SET klinik = $2,
               ursprung = $3,
               created_at = $4::timestamptz
           WHERE id = $1"#,
    )
    .bind(matching_id)
    .bind("Berlin Mitte")
    .bind("patient_portal")
    .bind("2026-04-02T10:00:00Z")
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        r#"UPDATE documents
           SET klinik = $2,
               ursprung = $3,
               created_at = $4::timestamptz
           WHERE id = $1"#,
    )
    .bind(wrong_date_id)
    .bind("Berlin Mitte")
    .bind("patient_portal")
    .bind("2026-03-28T10:00:00Z")
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        r#"UPDATE documents
           SET klinik = $2,
               ursprung = $3,
               created_at = $4::timestamptz
           WHERE id = $1"#,
    )
    .bind(wrong_context_id)
    .bind("Cologne West")
    .bind("interpreter_upload")
    .bind("2026-04-02T10:00:00Z")
    .execute(&pool)
    .await
    .unwrap();

    let (status, body) = json_request(
        &app,
        "GET",
        &format!(
            "/api/v1/documents?patient_id={patient_id}&date_from=2026-04-02&date_to=2026-04-02&klinik=Berlin&ursprung=patient_portal"
        ),
        &admin_bearer,
        None,
    )
    .await;

    assert_eq!(status, StatusCode::OK);
    let items = body.as_array().unwrap();
    assert_eq!(items.len(), 1);
    assert_eq!(items[0]["id"], json!(matching_id));
    assert_eq!(items[0]["klinik"], "Berlin Mitte");
    assert_eq!(items[0]["ursprung"], "patient_portal");
}

#[tokio::test]
async fn document_upload_without_explicit_art_is_auto_classified_from_filename() {
    let Some((app, pool, admin_id, admin_bearer)) = test_context().await else {
        return;
    };
    let tag = unique_tag("doc-autoclassify");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let provider_id = seed_provider(&pool, &tag).await;
    let doctor_id = seed_doctor(&pool, provider_id, &tag).await;
    let appointment_id =
        seed_appointment(&pool, patient_id, provider_id, doctor_id, admin_id, &tag).await;

    let (status, upload_body) = multipart_upload(
        &app,
        "/api/v1/documents/upload",
        &admin_bearer,
        &[
            ("patient_id", patient_id.to_string()),
            ("appointment_id", appointment_id.to_string()),
            ("status", "active".to_string()),
            ("visibility", "internal".to_string()),
        ],
        &format!("passport-copy-{tag}.pdf"),
        "application/pdf",
        b"%PDF-passport%",
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(upload_body["art"], "passport_scan");
    assert_eq!(upload_body["category"], "identity");
    assert_eq!(upload_body["is_medical"], false);
    assert_eq!(upload_body["needs_categorization"], false);

    let document_id = Uuid::parse_str(upload_body["id"].as_str().unwrap()).unwrap();
    let (status, detail_body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/documents/{document_id}"),
        &admin_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(detail_body["art"], "passport_scan");
    assert_eq!(detail_body["category"], "identity");
    assert_eq!(detail_body["is_medical"], false);
    assert_eq!(detail_body["needs_categorization"], false);

    let (status, queue_body) = json_request(
        &app,
        "GET",
        "/api/v1/documents/intake-queue",
        &admin_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(
        !queue_body
            .as_array()
            .unwrap()
            .iter()
            .any(|item| item["id"] == document_id.to_string())
    );
}

/// Regression: axum's `Multipart` defaults to a 2 MB request-body limit, so an
/// upload larger than 2 MB was rejected with 413 *before* the handler's own
/// `MAX_FILE_SIZE` (25 MB) check could run. The `/documents/upload` route now
/// raises that limit, so a multi-megabyte file uploaded *without* an explicit
/// name still succeeds and is auto-named from its filename.
#[tokio::test]
async fn large_document_upload_without_name_succeeds_and_is_auto_named() {
    let Some((app, pool, admin_id, admin_bearer)) = test_context().await else {
        return;
    };
    let tag = unique_tag("doc-large");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let provider_id = seed_provider(&pool, &tag).await;
    let doctor_id = seed_doctor(&pool, provider_id, &tag).await;
    let appointment_id =
        seed_appointment(&pool, patient_id, provider_id, doctor_id, admin_id, &tag).await;

    // 3 MB: larger than axum's 2 MB multipart default, smaller than MAX_FILE_SIZE.
    let mut big_pdf = b"%PDF-1.4\n".to_vec();
    big_pdf.resize(3 * 1024 * 1024, b' ');
    let file_name = format!("grosser-scan-{tag}.pdf");

    // Deliberately omit `auto_name`: the name must be formed automatically.
    let (status, upload_body) = multipart_upload(
        &app,
        "/api/v1/documents/upload",
        &admin_bearer,
        &[
            ("patient_id", patient_id.to_string()),
            ("appointment_id", appointment_id.to_string()),
            ("status", "active".to_string()),
            ("visibility", "internal".to_string()),
        ],
        &file_name,
        "application/pdf",
        &big_pdf,
    )
    .await;
    assert_eq!(
        status,
        StatusCode::OK,
        "upload above the 2 MB default must not 413"
    );
    assert_eq!(
        upload_body["file_size"].as_i64(),
        Some(big_pdf.len() as i64)
    );

    let document_id = Uuid::parse_str(upload_body["id"].as_str().unwrap()).unwrap();
    let (status, detail_body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/documents/{document_id}"),
        &admin_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(detail_body["auto_name"], file_name);
}

#[tokio::test]
async fn uncategorized_uploads_land_in_document_intake_queue() {
    let Some((app, pool, admin_id, admin_bearer)) = test_context().await else {
        return;
    };
    let tag = unique_tag("doc-intake");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let provider_id = seed_provider(&pool, &tag).await;
    let doctor_id = seed_doctor(&pool, provider_id, &tag).await;
    let appointment_id =
        seed_appointment(&pool, patient_id, provider_id, doctor_id, admin_id, &tag).await;

    let (status, upload_body) = multipart_upload(
        &app,
        "/api/v1/documents/upload",
        &admin_bearer,
        &[
            ("patient_id", patient_id.to_string()),
            ("appointment_id", appointment_id.to_string()),
            ("auto_name", format!("Misc import {tag}")),
            ("status", "active".to_string()),
            ("visibility", "internal".to_string()),
        ],
        &format!("misc-upload-{tag}.pdf"),
        "application/pdf",
        b"%PDF-misc-upload%",
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(upload_body["art"], "uploaded_document");
    assert_eq!(upload_body["needs_categorization"], true);
    assert!(upload_body["classification_suggestion"].is_null());

    let document_id = Uuid::parse_str(upload_body["id"].as_str().unwrap()).unwrap();
    let (status, queue_body) = json_request(
        &app,
        "GET",
        "/api/v1/documents/intake-queue",
        &admin_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let queue_items = queue_body.as_array().unwrap();
    let queued_item = queue_items
        .iter()
        .find(|item| item["id"] == document_id.to_string())
        .expect("upload should be visible in intake queue");
    assert_eq!(queued_item["art"], "uploaded_document");
    assert_eq!(queued_item["needs_categorization"], true);
}

#[tokio::test]
async fn interpreter_uploads_land_in_teamlead_review_queue_and_teamlead_can_release_them() {
    let Some((app, pool, admin_id, admin_bearer)) = test_context().await else {
        return;
    };
    let tag = unique_tag("interpreter-doc-review");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let provider_id = seed_provider(&pool, &tag).await;
    let doctor_id = seed_doctor(&pool, provider_id, &tag).await;
    let appointment_id =
        seed_appointment(&pool, patient_id, provider_id, doctor_id, admin_id, &tag).await;
    let teamlead_id = seed_user(&pool, &tag, "teamlead_interpreter").await;
    let interpreter_id = seed_user(&pool, &format!("{tag}-int"), "interpreter").await;

    seed_patient_assignment(&pool, patient_id, teamlead_id, admin_id).await;
    seed_patient_assignment(&pool, patient_id, interpreter_id, admin_id).await;

    let interpreter_bearer = auth_header_for(interpreter_id, "interpreter");
    let teamlead_bearer = auth_header_for(teamlead_id, "teamlead_interpreter");

    let (status, upload_body) = multipart_upload(
        &app,
        "/api/v1/documents/upload",
        &interpreter_bearer,
        &[
            ("patient_id", patient_id.to_string()),
            ("appointment_id", appointment_id.to_string()),
            ("auto_name", format!("Interpreter findings {tag}")),
            ("notes", "Interpreter uploaded visit findings".to_string()),
        ],
        &format!("befund-{tag}.pdf"),
        "application/pdf",
        b"%PDF-interpreter-findings%",
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let document_id = Uuid::parse_str(upload_body["id"].as_str().unwrap()).unwrap();
    assert_eq!(
        upload_body["classification_suggestion"]["art"],
        "medical_report"
    );

    let (status, queue_body) = json_request(
        &app,
        "GET",
        "/api/v1/documents/intake-queue",
        &teamlead_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let queued_item = queue_body
        .as_array()
        .unwrap()
        .iter()
        .find(|item| item["id"] == document_id.to_string())
        .expect("interpreter upload should be visible in teamlead review queue");
    assert_eq!(queued_item["status"], "draft");
    assert_eq!(queued_item["ursprung"], "interpreter_upload");

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/documents/{document_id}/update"),
        &teamlead_bearer,
        Some(json!({
            "visibility": "released_external"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(
        body["message"],
        "Teamlead review may update only document classification fields"
    );

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/documents/{document_id}/update"),
        &teamlead_bearer,
        Some(json!({
            "art": "medical_report",
            "category": "medical",
            "is_medical": true,
            "status": "active",
            "notes": "Reviewed by teamlead"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (status, detail_body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/documents/{document_id}"),
        &admin_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(detail_body["art"], "medical_report");
    assert_eq!(detail_body["category"], "medical");
    assert_eq!(detail_body["status"], "active");
    assert_eq!(detail_body["is_medical"], true);
    assert_eq!(detail_body["notes"], "Reviewed by teamlead");

    let (status, queue_body) = json_request(
        &app,
        "GET",
        "/api/v1/documents/intake-queue",
        &teamlead_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(
        !queue_body
            .as_array()
            .unwrap()
            .iter()
            .any(|item| item["id"] == document_id.to_string())
    );
}

#[tokio::test]
async fn teamlead_cannot_release_interpreter_upload_without_classification() {
    let Some((app, pool, admin_id, _admin_bearer)) = test_context().await else {
        return;
    };
    let tag = unique_tag("interpreter-doc-release-guard");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let provider_id = seed_provider(&pool, &tag).await;
    let doctor_id = seed_doctor(&pool, provider_id, &tag).await;
    let appointment_id =
        seed_appointment(&pool, patient_id, provider_id, doctor_id, admin_id, &tag).await;
    let teamlead_id = seed_user(&pool, &tag, "teamlead_interpreter").await;
    let interpreter_id = seed_user(&pool, &format!("{tag}-int"), "interpreter").await;

    seed_patient_assignment(&pool, patient_id, teamlead_id, admin_id).await;
    seed_patient_assignment(&pool, patient_id, interpreter_id, admin_id).await;

    let interpreter_bearer = auth_header_for(interpreter_id, "interpreter");
    let teamlead_bearer = auth_header_for(teamlead_id, "teamlead_interpreter");

    let (status, upload_body) = multipart_upload(
        &app,
        "/api/v1/documents/upload",
        &interpreter_bearer,
        &[
            ("patient_id", patient_id.to_string()),
            ("appointment_id", appointment_id.to_string()),
            ("auto_name", format!("Interpreter scan {tag}")),
        ],
        &format!("scan-{tag}.pdf"),
        "application/pdf",
        b"%PDF-generic-scan%",
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let document_id = Uuid::parse_str(upload_body["id"].as_str().unwrap()).unwrap();
    assert_eq!(upload_body["needs_categorization"], true);

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/documents/{document_id}/update"),
        &teamlead_bearer,
        Some(json!({
            "status": "active"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(
        body["message"],
        "Teamlead release requires document classification fields"
    );
}

#[tokio::test]
async fn document_text_extraction_can_prefill_translation_request_workspace() {
    let Some((app, pool, admin_id, admin_bearer)) = test_context().await else {
        return;
    };
    let tag = unique_tag("doc-extraction");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let provider_id = seed_provider(&pool, &tag).await;
    let doctor_id = seed_doctor(&pool, provider_id, &tag).await;
    let appointment_id =
        seed_appointment(&pool, patient_id, provider_id, doctor_id, admin_id, &tag).await;

    let (status, upload_body) = multipart_upload(
        &app,
        "/api/v1/documents/upload",
        &admin_bearer,
        &[
            ("patient_id", patient_id.to_string()),
            ("appointment_id", appointment_id.to_string()),
            ("auto_name", format!("Visit summary {tag}")),
            ("art", "medical_report".to_string()),
            ("category", "medical".to_string()),
            ("status", "active".to_string()),
            ("visibility", "released_internal".to_string()),
            ("is_medical", "true".to_string()),
        ],
        &format!("visit-summary-{tag}.txt"),
        "text/plain",
        b"Hallo Befund\nZweite Zeile",
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let document_id = Uuid::parse_str(upload_body["id"].as_str().unwrap()).unwrap();

    let (status, extraction_body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/documents/{document_id}/text-extraction"),
        &admin_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(extraction_body["status"], "completed");
    assert_eq!(extraction_body["method"], "text_utf8");
    assert_eq!(extraction_body["has_text"], true);
    assert!(
        extraction_body["extracted_text"]
            .as_str()
            .unwrap_or_default()
            .contains("Hallo Befund")
    );

    let (status, rerun_body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/documents/{document_id}/text-extraction/run"),
        &admin_bearer,
        Some(json!({})),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(rerun_body["status"], "completed");

    let (status, create_body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/documents/{document_id}/translation-requests"),
        &admin_bearer,
        Some(json!({
            "requested_language": "de",
            "note": "Translate the uploaded findings."
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(
        create_body["source_text"]
            .as_str()
            .unwrap_or_default()
            .contains("Hallo Befund")
    );
}

#[tokio::test]
async fn image_document_text_extraction_uses_ocr_or_reports_runtime_unavailable() {
    let Some((app, pool, admin_id, admin_bearer)) = test_context().await else {
        return;
    };
    let tag = unique_tag("doc-image-ocr");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let provider_id = seed_provider(&pool, &tag).await;
    let doctor_id = seed_doctor(&pool, provider_id, &tag).await;
    let appointment_id =
        seed_appointment(&pool, patient_id, provider_id, doctor_id, admin_id, &tag).await;

    let (status, upload_body) = multipart_upload(
        &app,
        "/api/v1/documents/upload",
        &admin_bearer,
        &[
            ("patient_id", patient_id.to_string()),
            ("appointment_id", appointment_id.to_string()),
            ("auto_name", format!("Image scan {tag}")),
            ("art", "medical_report".to_string()),
            ("category", "medical".to_string()),
            ("status", "active".to_string()),
            ("visibility", "released_internal".to_string()),
            ("is_medical", "true".to_string()),
        ],
        &format!("image-scan-{tag}.png"),
        "image/png",
        TINY_TRANSPARENT_PNG,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let document_id = Uuid::parse_str(upload_body["id"].as_str().unwrap()).unwrap();

    let (status, extraction_body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/documents/{document_id}/text-extraction"),
        &admin_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let method = extraction_body["method"].as_str().unwrap_or_default();
    let extraction_status = extraction_body["status"].as_str().unwrap_or_default();
    assert!(
        matches!(method, "windows_ocr" | "tesseract_cli" | "ocr_unavailable"),
        "unexpected extraction method: {method}"
    );
    assert!(
        matches!(extraction_status, "completed" | "unsupported" | "failed"),
        "unexpected extraction status: {extraction_status}"
    );

    let (status, rerun_body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/documents/{document_id}/text-extraction/run"),
        &admin_bearer,
        Some(json!({})),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let rerun_method = rerun_body["method"].as_str().unwrap_or_default();
    let rerun_status = rerun_body["status"].as_str().unwrap_or_default();
    assert!(
        matches!(
            rerun_method,
            "windows_ocr" | "tesseract_cli" | "ocr_unavailable"
        ),
        "unexpected rerun method: {rerun_method}"
    );
    assert!(
        matches!(rerun_status, "completed" | "unsupported" | "failed"),
        "unexpected rerun status: {rerun_status}"
    );

    if rerun_method == "ocr_unavailable" {
        assert_eq!(rerun_status, "unsupported");
    }
}

#[tokio::test]
async fn interpreter_sees_only_released_medical_documents_for_assigned_patient() {
    let Some((app, pool, admin_id, _admin_bearer)) = test_context().await else {
        return;
    };
    let tag = unique_tag("doc-interpreter");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let provider_id = seed_provider(&pool, &tag).await;
    let doctor_id = seed_doctor(&pool, provider_id, &tag).await;
    let appointment_id =
        seed_appointment(&pool, patient_id, provider_id, doctor_id, admin_id, &tag).await;
    let interpreter_id = seed_user(&pool, &tag, "interpreter").await;
    seed_patient_assignment(&pool, patient_id, interpreter_id, admin_id).await;
    let interpreter_bearer = auth_header_for(interpreter_id, "interpreter");

    let internal_id = seed_document(
        &pool,
        admin_id,
        patient_id,
        appointment_id,
        "internal",
        true,
        "arztbrief",
        &format!("{tag}-internal"),
    )
    .await;
    let released_id = seed_document(
        &pool,
        admin_id,
        patient_id,
        appointment_id,
        "released_internal",
        true,
        "arztbrief",
        &format!("{tag}-released"),
    )
    .await;

    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/documents?patient_id={patient_id}"),
        &interpreter_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let ids: Vec<_> = body
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|item| item["id"].as_str())
        .collect();
    assert!(ids.contains(&released_id.to_string().as_str()));
    assert!(!ids.contains(&internal_id.to_string().as_str()));

    let (status, _) = json_request(
        &app,
        "GET",
        &format!("/api/v1/documents/{internal_id}"),
        &interpreter_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn billing_can_access_financial_documents_but_not_medical_ones() {
    let Some((app, pool, admin_id, _)) = test_context().await else {
        return;
    };
    let tag = unique_tag("doc-billing");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let provider_id = seed_provider(&pool, &tag).await;
    let doctor_id = seed_doctor(&pool, provider_id, &tag).await;
    let appointment_id =
        seed_appointment(&pool, patient_id, provider_id, doctor_id, admin_id, &tag).await;
    let billing_id = seed_user(&pool, &tag, "billing").await;
    let billing_bearer = auth_header_for(billing_id, "billing");

    let invoice_id = seed_document(
        &pool,
        admin_id,
        patient_id,
        appointment_id,
        "internal",
        false,
        "invoice",
        &format!("{tag}-invoice"),
    )
    .await;
    let medical_id = seed_document(
        &pool,
        admin_id,
        patient_id,
        appointment_id,
        "released_internal",
        true,
        "arztbrief",
        &format!("{tag}-medical"),
    )
    .await;

    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/documents?patient_id={patient_id}"),
        &billing_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let ids: Vec<_> = body
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|item| item["id"].as_str())
        .collect();
    assert!(ids.contains(&invoice_id.to_string().as_str()));
    assert!(!ids.contains(&medical_id.to_string().as_str()));

    let (status, _) = json_request(
        &app,
        "GET",
        &format!("/api/v1/documents/{medical_id}"),
        &billing_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn sales_cannot_access_documents_workspace_or_meta_routes_but_it_admin_can() {
    let Some((app, pool, admin_id, _admin_bearer)) = test_context().await else {
        return;
    };
    let tag = unique_tag("doc-deny-surface");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let provider_id = seed_provider(&pool, &tag).await;
    let doctor_id = seed_doctor(&pool, provider_id, &tag).await;
    let appointment_id =
        seed_appointment(&pool, patient_id, provider_id, doctor_id, admin_id, &tag).await;
    let document_id = seed_document(
        &pool,
        admin_id,
        patient_id,
        appointment_id,
        "released_internal",
        false,
        "general",
        &format!("{tag}-general"),
    )
    .await;

    for role in ["sales"] {
        let user_id = seed_user(&pool, &format!("{tag}-{role}"), role).await;
        let bearer = auth_header_for(user_id, role);

        for path in [
            "/api/v1/documents",
            "/api/v1/documents/meta/staff",
            "/api/v1/documents/meta/categories",
            "/api/v1/documents/templates",
            &format!("/api/v1/documents/{document_id}"),
        ] {
            let (status, body) = json_request(&app, "GET", path, &bearer, None).await;
            assert_eq!(
                status,
                StatusCode::FORBIDDEN,
                "role {role} must be denied on {path}"
            );
            assert_eq!(body["message"], "Insufficient permissions");
        }
    }

    let it_admin_id = seed_user(&pool, &format!("{tag}-it-admin"), "it_admin").await;
    let it_admin_bearer = auth_header_for(it_admin_id, "it_admin");
    for path in [
        "/api/v1/documents",
        "/api/v1/documents/meta/staff",
        "/api/v1/documents/meta/categories",
        "/api/v1/documents/templates",
        &format!("/api/v1/documents/{document_id}"),
    ] {
        let (status, _) = json_request(&app, "GET", path, &it_admin_bearer, None).await;
        assert_eq!(
            status,
            StatusCode::OK,
            "IT admin should be allowed on {path}"
        );
    }
}

#[tokio::test]
async fn document_user_share_can_be_confirmed_and_revoked() {
    let Some((app, pool, admin_id, admin_bearer)) = test_context().await else {
        return;
    };
    let tag = unique_tag("doc-share");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let provider_id = seed_provider(&pool, &tag).await;
    let doctor_id = seed_doctor(&pool, provider_id, &tag).await;
    let appointment_id =
        seed_appointment(&pool, patient_id, provider_id, doctor_id, admin_id, &tag).await;
    let billing_id = seed_user(&pool, &tag, "billing").await;
    let billing_bearer = auth_header_for(billing_id, "billing");

    let document_id = seed_document(
        &pool,
        admin_id,
        patient_id,
        appointment_id,
        "released_internal",
        false,
        "invoice",
        &format!("{tag}-invoice"),
    )
    .await;

    let (status, create_body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/documents/{document_id}/shares"),
        &admin_bearer,
        Some(json!({
            "shared_with_user_id": billing_id,
            "channel": "email",
            "requires_confirmation": true
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let share_id = create_body["id"].as_str().unwrap().to_string();

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/documents/{document_id}/shares/{share_id}/confirm"),
        &billing_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (status, list_body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/documents/{document_id}/shares"),
        &admin_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(list_body.as_array().unwrap().len(), 1);
    assert_eq!(list_body[0]["confirmed"], true);

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/documents/{document_id}/shares/{share_id}/revoke"),
        &admin_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (status, list_body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/documents/{document_id}/shares"),
        &admin_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(list_body[0]["revoked_at"].is_string());
}

#[tokio::test]
async fn provider_document_share_requires_and_persists_cover_message() {
    let Some((app, pool, admin_id, admin_bearer)) = test_context().await else {
        return;
    };
    let tag = unique_tag("doc-provider-message");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let provider_id = seed_provider(&pool, &tag).await;
    let doctor_id = seed_doctor(&pool, provider_id, &tag).await;
    let appointment_id =
        seed_appointment(&pool, patient_id, provider_id, doctor_id, admin_id, &tag).await;

    let document_id = seed_document(
        &pool,
        admin_id,
        patient_id,
        appointment_id,
        "released_external",
        false,
        "invoice",
        &format!("{tag}-invoice"),
    )
    .await;

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/documents/{document_id}/shares"),
        &admin_bearer,
        Some(json!({
            "shared_with_provider_id": provider_id,
            "channel": "email",
            "requires_confirmation": true
        })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(body["message"], "Provider shares require a cover message");

    let cover_message = "Bitte diese Unterlagen vor dem Termin medizinisch vorpruefen.";
    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/documents/{document_id}/shares"),
        &admin_bearer,
        Some(json!({
            "shared_with_provider_id": provider_id,
            "channel": "email",
            "message": cover_message,
            "requires_confirmation": true
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (status, list_body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/documents/{document_id}/shares"),
        &admin_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let items = list_body.as_array().unwrap();
    assert_eq!(items.len(), 1);
    assert_eq!(
        items[0]["provider_name"].as_str().unwrap(),
        format!("Clinic {tag}")
    );
    assert_eq!(items[0]["message"].as_str().unwrap(), cover_message);
    assert_eq!(items[0]["channel"].as_str().unwrap(), "email");
}

#[tokio::test]
async fn medical_document_share_requires_involved_medical_provider() {
    let Some((app, pool, admin_id, admin_bearer)) = test_context().await else {
        return;
    };
    let tag = unique_tag("doc-provider-share");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let involved_provider_id =
        seed_provider_with_type(&pool, &format!("{tag}-med"), "medical").await;
    let doctor_id = seed_doctor(&pool, involved_provider_id, &tag).await;
    let appointment_id = seed_appointment(
        &pool,
        patient_id,
        involved_provider_id,
        doctor_id,
        admin_id,
        &tag,
    )
    .await;
    let unrelated_provider_id =
        seed_provider_with_type(&pool, &format!("{tag}-other"), "medical").await;

    let document_id = seed_document(
        &pool,
        admin_id,
        patient_id,
        appointment_id,
        "released_external",
        true,
        "arztbrief",
        &format!("{tag}-arztbrief"),
    )
    .await;

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/documents/{document_id}/shares"),
        &admin_bearer,
        Some(json!({
            "shared_with_provider_id": involved_provider_id,
            "channel": "email",
            "message": "Please review this medical document before treatment.",
            "requires_confirmation": true
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/documents/{document_id}/shares"),
        &admin_bearer,
        Some(json!({
            "shared_with_provider_id": unrelated_provider_id,
            "channel": "email",
            "message": "This share should fail for an unrelated provider.",
            "requires_confirmation": true
        })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert!(
        body["message"]
            .as_str()
            .unwrap_or_default()
            .contains("Provider is not involved")
    );
}

#[tokio::test]
async fn provider_share_requires_allowed_official_channel() {
    let Some((app, pool, admin_id, admin_bearer)) = test_context().await else {
        return;
    };
    let tag = unique_tag("doc-provider-channel");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let provider_id = seed_provider_with_type(&pool, &format!("{tag}-med"), "medical").await;
    let doctor_id = seed_doctor(&pool, provider_id, &tag).await;
    let appointment_id =
        seed_appointment(&pool, patient_id, provider_id, doctor_id, admin_id, &tag).await;

    let document_id = seed_document(
        &pool,
        admin_id,
        patient_id,
        appointment_id,
        "released_external",
        true,
        "arztbrief",
        &format!("{tag}-arztbrief"),
    )
    .await;

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/documents/{document_id}/shares"),
        &admin_bearer,
        Some(json!({
            "shared_with_provider_id": provider_id,
            "channel": "whatsapp",
            "message": "This share should fail because the channel is not allowed.",
            "requires_confirmation": true
        })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert!(
        body["message"]
            .as_str()
            .unwrap_or_default()
            .contains("official registered channel")
    );
}

#[tokio::test]
async fn medical_document_share_requires_matching_provider_specialty() {
    let Some((app, pool, admin_id, admin_bearer)) = test_context().await else {
        return;
    };
    let tag = unique_tag("doc-provider-specialty");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let order_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO orders (
                order_number, patient_id, phase, status, created_by
           ) VALUES (
                $1, $2, 'execution', 'active', $3
           ) RETURNING id"#,
    )
    .bind(format!("AUF-{tag}"))
    .bind(patient_id)
    .bind(admin_id)
    .fetch_one(&pool)
    .await
    .unwrap();

    let cardiology_provider = seed_provider_with_type_and_specialty(
        &pool,
        &format!("{tag}-cardio"),
        "medical",
        "cardiology",
    )
    .await;
    let cardiology_doctor =
        seed_doctor_with_specialty(&pool, cardiology_provider, &tag, "cardiology").await;
    let orthopedics_provider = seed_provider_with_type_and_specialty(
        &pool,
        &format!("{tag}-ortho"),
        "medical",
        "orthopedics",
    )
    .await;
    let orthopedics_doctor =
        seed_doctor_with_specialty(&pool, orthopedics_provider, &tag, "orthopedics").await;

    let appointment_id = seed_appointment(
        &pool,
        patient_id,
        cardiology_provider,
        cardiology_doctor,
        admin_id,
        &tag,
    )
    .await;

    sqlx::query("UPDATE appointments SET order_id = $2 WHERE id = $1")
        .bind(appointment_id)
        .bind(order_id)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query(
        r#"INSERT INTO order_leistungen (
                order_id, description, quantity, unit_price, provider_id, doctor_id
           ) VALUES
                ($1, 'Cardiology treatment', 1, 1000, $2, $3),
                ($1, 'Orthopedics consult', 1, 900, $4, $5)"#,
    )
    .bind(order_id)
    .bind(cardiology_provider)
    .bind(cardiology_doctor)
    .bind(orthopedics_provider)
    .bind(orthopedics_doctor)
    .execute(&pool)
    .await
    .unwrap();

    let document_id = Uuid::new_v4();
    sqlx::query(
        r#"INSERT INTO documents (
                id, patient_id, order_id, appointment_id, auto_name, original_filename,
                art, category, status, visibility, is_medical, mime_type, file_size,
                version_root_document_id, version_number, uploaded_by
           ) VALUES (
                $1, $2, $3, $4, $5, $6,
                'arztbrief', 'medical', 'active', 'released_external', true, 'application/pdf', 1234,
                $1, 1, $7
           )"#,
    )
    .bind(document_id)
    .bind(patient_id)
    .bind(order_id)
    .bind(appointment_id)
    .bind(format!("Doctor letter {tag}"))
    .bind(format!("{tag}-doctor-letter.pdf"))
    .bind(admin_id)
    .execute(&pool)
    .await
    .unwrap();

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/documents/{document_id}/shares"),
        &admin_bearer,
        Some(json!({
            "shared_with_provider_id": cardiology_provider,
            "channel": "email",
            "message": "Cardiology provider should be allowed.",
            "requires_confirmation": true
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/documents/{document_id}/shares"),
        &admin_bearer,
        Some(json!({
            "shared_with_provider_id": orthopedics_provider,
            "channel": "email",
            "message": "Orthopedics provider should be blocked on specialty mismatch.",
            "requires_confirmation": true
        })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert!(
        body["message"]
            .as_str()
            .unwrap_or_default()
            .contains("specialty does not match")
            || body["message"]
                .as_str()
                .unwrap_or_default()
                .contains("Provider is not involved")
    );
}

#[tokio::test]
async fn appointment_linked_document_share_prefers_appointment_provider_over_order_context() {
    let Some((app, pool, admin_id, admin_bearer)) = test_context().await else {
        return;
    };
    let tag = unique_tag("doc-provider-precedence");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let order_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO orders (
                order_number, patient_id, phase, status, created_by
           ) VALUES (
                $1, $2, 'execution', 'active', $3
           ) RETURNING id"#,
    )
    .bind(format!("AUF-{tag}"))
    .bind(patient_id)
    .bind(admin_id)
    .fetch_one(&pool)
    .await
    .unwrap();

    let appointment_provider = seed_provider_with_type_and_specialty(
        &pool,
        &format!("{tag}-apt"),
        "medical",
        "cardiology",
    )
    .await;
    let appointment_doctor =
        seed_doctor_with_specialty(&pool, appointment_provider, &tag, "cardiology").await;
    let other_order_provider = seed_provider_with_type_and_specialty(
        &pool,
        &format!("{tag}-order"),
        "medical",
        "cardiology",
    )
    .await;
    let other_order_doctor =
        seed_doctor_with_specialty(&pool, other_order_provider, &tag, "cardiology").await;

    let appointment_id = seed_appointment(
        &pool,
        patient_id,
        appointment_provider,
        appointment_doctor,
        admin_id,
        &tag,
    )
    .await;

    sqlx::query("UPDATE appointments SET order_id = $2 WHERE id = $1")
        .bind(appointment_id)
        .bind(order_id)
        .execute(&pool)
        .await
        .unwrap();

    sqlx::query(
        r#"INSERT INTO order_leistungen (
                order_id, description, quantity, unit_price, provider_id, doctor_id
           ) VALUES
                ($1, 'Appointment provider treatment', 1, 1000, $2, $3),
                ($1, 'Other order cardiology treatment', 1, 900, $4, $5)"#,
    )
    .bind(order_id)
    .bind(appointment_provider)
    .bind(appointment_doctor)
    .bind(other_order_provider)
    .bind(other_order_doctor)
    .execute(&pool)
    .await
    .unwrap();

    let document_id = Uuid::new_v4();
    sqlx::query(
        r#"INSERT INTO documents (
                id, patient_id, order_id, appointment_id, auto_name, original_filename,
                art, category, status, visibility, is_medical, mime_type, file_size,
                version_root_document_id, version_number, uploaded_by
           ) VALUES (
                $1, $2, $3, $4, $5, $6,
                'arztbrief', 'medical', 'active', 'released_external', true, 'application/pdf', 1234,
                $1, 1, $7
           )"#,
    )
    .bind(document_id)
    .bind(patient_id)
    .bind(order_id)
    .bind(appointment_id)
    .bind(format!("Doctor letter {tag}"))
    .bind(format!("{tag}-doctor-letter.pdf"))
    .bind(admin_id)
    .execute(&pool)
    .await
    .unwrap();

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/documents/{document_id}/shares"),
        &admin_bearer,
        Some(json!({
            "shared_with_provider_id": appointment_provider,
            "channel": "email",
            "message": "Appointment provider should be allowed.",
            "requires_confirmation": true
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/documents/{document_id}/shares"),
        &admin_bearer,
        Some(json!({
            "shared_with_provider_id": other_order_provider,
            "channel": "email",
            "message": "Order-only provider should be blocked when appointment context exists.",
            "requires_confirmation": true
        })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert!(
        body["message"]
            .as_str()
            .unwrap_or_default()
            .contains("Provider is not involved")
    );
}

#[tokio::test]
async fn patient_email_share_requires_active_channel_consent() {
    let Some((app, pool, admin_id, admin_bearer)) = test_context().await else {
        return;
    };
    let tag = unique_tag("doc-patient-channel");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let patient_user_id = seed_user(&pool, &tag, "patient").await;
    seed_patient_assignment(&pool, patient_id, patient_user_id, admin_id).await;

    let provider_id = seed_provider(&pool, &tag).await;
    let doctor_id = seed_doctor(&pool, provider_id, &tag).await;
    let appointment_id =
        seed_appointment(&pool, patient_id, provider_id, doctor_id, admin_id, &tag).await;

    let document_id = seed_document(
        &pool,
        admin_id,
        patient_id,
        appointment_id,
        "patient_visible",
        false,
        "invoice",
        &format!("{tag}-invoice"),
    )
    .await;

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/documents/{document_id}/shares"),
        &admin_bearer,
        Some(json!({
            "shared_with_user_id": patient_user_id,
            "channel": "email",
            "requires_confirmation": true
        })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert!(
        body["message"]
            .as_str()
            .unwrap_or_default()
            .contains("active consent record")
    );

    seed_patient_share_consent(&pool, patient_id, patient_user_id, "document_share_email").await;

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/documents/{document_id}/shares"),
        &admin_bearer,
        Some(json!({
            "shared_with_user_id": patient_user_id,
            "channel": "email",
            "requires_confirmation": true
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(body["id"].is_string());
}

#[tokio::test]
async fn bulk_document_share_creates_entries_for_multiple_documents() {
    let Some((app, pool, admin_id, admin_bearer)) = test_context().await else {
        return;
    };
    let tag = unique_tag("doc-bulk-share");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let provider_id = seed_provider(&pool, &tag).await;
    let doctor_id = seed_doctor(&pool, provider_id, &tag).await;
    let appointment_id =
        seed_appointment(&pool, patient_id, provider_id, doctor_id, admin_id, &tag).await;
    let billing_id = seed_user(&pool, &tag, "billing").await;

    let first_document_id = seed_document(
        &pool,
        admin_id,
        patient_id,
        appointment_id,
        "released_internal",
        false,
        "invoice",
        &format!("{tag}-invoice-a"),
    )
    .await;
    let second_document_id = seed_document(
        &pool,
        admin_id,
        patient_id,
        appointment_id,
        "released_internal",
        false,
        "invoice",
        &format!("{tag}-invoice-b"),
    )
    .await;

    let (status, body) = json_request(
        &app,
        "POST",
        "/api/v1/documents/shares/bulk",
        &admin_bearer,
        Some(json!({
            "document_ids": [first_document_id, second_document_id],
            "shared_with_user_id": billing_id,
            "channel": "email",
            "requires_confirmation": true
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["document_count"], 2);
    assert_eq!(body["share_count"], 2);

    let (status, first_shares) = json_request(
        &app,
        "GET",
        &format!("/api/v1/documents/{first_document_id}/shares"),
        &admin_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(first_shares.as_array().unwrap().len(), 1);

    let (status, second_shares) = json_request(
        &app,
        "GET",
        &format!("/api/v1/documents/{second_document_id}/shares"),
        &admin_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(second_shares.as_array().unwrap().len(), 1);
}

#[tokio::test]
async fn document_translation_requests_can_be_created_and_completed() {
    let Some((app, pool, admin_id, admin_bearer)) = test_context().await else {
        return;
    };

    let tag = unique_tag("doc-translation");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let provider_id = seed_provider(&pool, &tag).await;
    let doctor_id = seed_doctor(&pool, provider_id, &tag).await;
    let appointment_id =
        seed_appointment(&pool, patient_id, provider_id, doctor_id, admin_id, &tag).await;
    let document_id = seed_document(
        &pool,
        admin_id,
        patient_id,
        appointment_id,
        "released_internal",
        true,
        "arztbrief",
        &tag,
    )
    .await;

    let (status, create_body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/documents/{document_id}/translation-requests"),
        &admin_bearer,
        Some(json!({
            "requested_language": "en",
            "note": "Prepare a patient-facing English summary."
        })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(
        create_body["message"],
        "Only German translation target language is supported"
    );

    let (status, create_body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/documents/{document_id}/translation-requests"),
        &admin_bearer,
        Some(json!({
            "requested_language": "de",
            "note": "Prepare a patient-facing German summary."
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(create_body["requested_language"], "de");
    assert_eq!(create_body["status"], "pending");
    let request_id = create_body["id"].as_str().unwrap().to_string();

    let (status, list_body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/documents/{document_id}/translation-requests"),
        &admin_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let items = list_body.as_array().unwrap();
    assert_eq!(items.len(), 1);
    assert_eq!(items[0]["id"], request_id);

    let (status, update_body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/documents/translation-requests/{request_id}/update"),
        &admin_bearer,
        Some(json!({
            "status": "completed",
            "translated_text": "Patient summary in German."
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(update_body["status"], "completed");
    assert!(update_body["completed_at"].as_str().is_some());
}

#[tokio::test]
async fn translation_workspace_can_store_source_and_translated_text() {
    let Some((app, pool, admin_id, admin_bearer)) = test_context().await else {
        return;
    };

    let tag = unique_tag("doc-translation-workspace");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let provider_id = seed_provider(&pool, &tag).await;
    let doctor_id = seed_doctor(&pool, provider_id, &tag).await;
    let appointment_id =
        seed_appointment(&pool, patient_id, provider_id, doctor_id, admin_id, &tag).await;
    let document_id = seed_document(
        &pool,
        admin_id,
        patient_id,
        appointment_id,
        "released_internal",
        true,
        "arztbrief",
        &tag,
    )
    .await;

    let (status, create_body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/documents/{document_id}/translation-requests"),
        &admin_bearer,
        Some(json!({
            "requested_language": "de",
            "note": "Prepare a patient-safe translation."
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let request_id = create_body["id"].as_str().unwrap().to_string();

    let (status, auto_assigned_body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/documents/translation-requests/{request_id}/update"),
        &admin_bearer,
        Some(json!({
            "status": "in_progress"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(auto_assigned_body["status"], "in_progress");
    assert_eq!(auto_assigned_body["assigned_to"], admin_id.to_string());
    assert!(auto_assigned_body["assigned_at"].as_str().is_some());

    let (status, preserved_assignee_body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/documents/translation-requests/{request_id}/update"),
        &admin_bearer,
        Some(json!({
            "status": "in_progress",
            "source_text": "Hallo Welt"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(preserved_assignee_body["assigned_to"], admin_id.to_string());
    assert_eq!(preserved_assignee_body["source_text"], "Hallo Welt");

    let (status, draft_body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/documents/translation-requests/{request_id}/update"),
        &admin_bearer,
        Some(json!({
            "status": "in_progress",
            "assigned_to": admin_id,
            "source_language": "de",
            "source_text": "Hallo Welt",
            "translated_text": "Hallo Welt auf Deutsch",
            "note": "Draft saved before completion."
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(draft_body["status"], "in_progress");
    assert_eq!(draft_body["source_language"], "de");
    assert_eq!(draft_body["source_text"], "Hallo Welt");
    assert_eq!(draft_body["translated_text"], "Hallo Welt auf Deutsch");
    assert_eq!(draft_body["note"], "Draft saved before completion.");
    assert_eq!(draft_body["assigned_to"], admin_id.to_string());
    assert!(draft_body["translated_at"].as_str().is_some());
    assert!(draft_body["completed_at"].is_null());

    let (status, list_body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/documents/{document_id}/translation-requests"),
        &admin_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(list_body[0]["status"], "in_progress");
    assert_eq!(list_body[0]["source_text"], "Hallo Welt");
    assert_eq!(list_body[0]["translated_text"], "Hallo Welt auf Deutsch");
    assert_eq!(list_body[0]["note"], "Draft saved before completion.");
    assert_eq!(list_body[0]["assigned_to"], admin_id.to_string());

    let (status, cleared_body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/documents/translation-requests/{request_id}/update"),
        &admin_bearer,
        Some(json!({
            "status": "in_progress",
            "assigned_to": null
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(cleared_body["assigned_to"].is_null());
    assert!(cleared_body["assigned_at"].is_null());
    assert_eq!(cleared_body["source_text"], "Hallo Welt");
    assert_eq!(cleared_body["translated_text"], "Hallo Welt auf Deutsch");

    let (status, cleared_workspace_body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/documents/translation-requests/{request_id}/update"),
        &admin_bearer,
        Some(json!({
            "status": "in_progress",
            "note": null,
            "source_language": null,
            "source_text": null,
            "translated_text": null
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(cleared_workspace_body["note"].is_null());
    assert!(cleared_workspace_body["source_language"].is_null());
    assert!(cleared_workspace_body["source_text"].is_null());
    assert!(cleared_workspace_body["translated_text"].is_null());

    let (status, update_body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/documents/translation-requests/{request_id}/update"),
        &admin_bearer,
        Some(json!({
            "status": "completed",
            "source_language": "de",
            "source_text": "Hallo Welt",
            "translated_text": "Hallo Welt auf Deutsch",
            "note": "Ready for patient delivery."
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(update_body["status"], "completed");
    assert_eq!(update_body["source_language"], "de");
    assert_eq!(update_body["source_text"], "Hallo Welt");
    assert_eq!(update_body["translated_text"], "Hallo Welt auf Deutsch");
    assert!(update_body["translated_at"].as_str().is_some());
    assert!(update_body["completed_at"].as_str().is_some());

    let (status, list_body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/documents/{document_id}/translation-requests"),
        &admin_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(list_body[0]["translated_text"], "Hallo Welt auf Deutsch");
}

#[tokio::test]
async fn ceo_assistant_can_review_translation_requests_but_cannot_mutate_them() {
    let Some((app, pool, admin_id, admin_bearer)) = test_context().await else {
        return;
    };

    let tag = unique_tag("doc-translation-assistant");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let provider_id = seed_provider(&pool, &tag).await;
    let doctor_id = seed_doctor(&pool, provider_id, &tag).await;
    let appointment_id =
        seed_appointment(&pool, patient_id, provider_id, doctor_id, admin_id, &tag).await;
    let document_id = seed_document(
        &pool,
        admin_id,
        patient_id,
        appointment_id,
        "released_internal",
        true,
        "arztbrief",
        &tag,
    )
    .await;
    let assistant_id = seed_user(&pool, &tag, "ceo_assistant").await;
    let assistant_bearer = auth_header_for(assistant_id, "ceo_assistant");

    let (status, create_body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/documents/{document_id}/translation-requests"),
        &admin_bearer,
        Some(json!({
            "requested_language": "de",
            "note": "Prepare a patient-facing German summary."
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let request_id = create_body["id"].as_str().unwrap().to_string();

    let (status, list_body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/documents/{document_id}/translation-requests"),
        &assistant_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(list_body.as_array().unwrap().len(), 1);
    assert_eq!(list_body[0]["id"], request_id);

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/documents/{document_id}/translation-requests"),
        &assistant_bearer,
        Some(json!({
            "requested_language": "uk",
            "note": "Assistant should stay read-only."
        })),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(body["message"], "Insufficient permissions");

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/documents/translation-requests/{request_id}/update"),
        &assistant_bearer,
        Some(json!({
            "status": "completed",
            "translated_text": "Assistant cannot complete translations."
        })),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(body["message"], "Insufficient permissions");
}

#[tokio::test]
async fn ceo_assistant_can_view_provider_share_trail_but_cannot_mutate_provider_shares() {
    let Some((app, pool, admin_id, admin_bearer)) = test_context().await else {
        return;
    };
    let tag = unique_tag("doc-share-assistant");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let provider_id = seed_provider_with_type(&pool, &format!("{tag}-med"), "medical").await;
    let doctor_id = seed_doctor(&pool, provider_id, &tag).await;
    let appointment_id =
        seed_appointment(&pool, patient_id, provider_id, doctor_id, admin_id, &tag).await;
    let document_id = seed_document(
        &pool,
        admin_id,
        patient_id,
        appointment_id,
        "released_external",
        true,
        "arztbrief",
        &format!("{tag}-arztbrief"),
    )
    .await;
    let assistant_id = seed_user(&pool, &tag, "ceo_assistant").await;
    let assistant_bearer = auth_header_for(assistant_id, "ceo_assistant");

    let cover_message = "Please review the attached summary for the upcoming visit.";
    let (status, create_body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/documents/{document_id}/shares"),
        &admin_bearer,
        Some(json!({
            "shared_with_provider_id": provider_id,
            "channel": "email",
            "message": cover_message,
            "requires_confirmation": true
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let share_id = create_body["id"].as_str().unwrap().to_string();

    let (status, list_body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/documents/{document_id}/shares"),
        &assistant_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(list_body.as_array().unwrap().len(), 1);
    assert_eq!(list_body[0]["id"], share_id);
    assert_eq!(list_body[0]["provider_name"], format!("Clinic {tag}-med"));
    assert_eq!(list_body[0]["message"], cover_message);

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/documents/{document_id}/shares"),
        &assistant_bearer,
        Some(json!({
            "shared_with_provider_id": provider_id,
            "channel": "email",
            "message": "Assistant mutation should stay blocked.",
            "requires_confirmation": true
        })),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(body["message"], "Insufficient permissions");

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/documents/{document_id}/shares/{share_id}/revoke"),
        &assistant_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(body["message"], "Insufficient permissions");
}

#[tokio::test]
async fn patient_manager_cannot_manage_provider_shares_for_unassigned_documents() {
    let Some((app, pool, admin_id, admin_bearer)) = test_context().await else {
        return;
    };
    let tag = unique_tag("doc-share-assignment");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let provider_id = seed_provider_with_type(&pool, &format!("{tag}-med"), "medical").await;
    let doctor_id = seed_doctor(&pool, provider_id, &tag).await;
    let appointment_id =
        seed_appointment(&pool, patient_id, provider_id, doctor_id, admin_id, &tag).await;
    let document_id = seed_document(
        &pool,
        admin_id,
        patient_id,
        appointment_id,
        "released_external",
        true,
        "arztbrief",
        &format!("{tag}-arztbrief"),
    )
    .await;
    let pm_id = seed_user(&pool, &tag, "patient_manager").await;
    let pm_bearer = auth_header_for(pm_id, "patient_manager");

    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/documents/{document_id}/shares"),
        &pm_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(body["message"], "Insufficient permissions");

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/documents/{document_id}/shares"),
        &pm_bearer,
        Some(json!({
            "shared_with_provider_id": provider_id,
            "channel": "email",
            "message": "Patient manager is not assigned to this patient.",
            "requires_confirmation": true
        })),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(body["message"], "Insufficient permissions");

    let (status, body) = json_request(
        &app,
        "POST",
        "/api/v1/documents/shares/bulk",
        &pm_bearer,
        Some(json!({
            "document_ids": [document_id],
            "shared_with_provider_id": provider_id,
            "channel": "email",
            "message": "Bulk sharing should stay assignment-bound.",
            "requires_confirmation": true
        })),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(body["message"], "Insufficient permissions");

    let (status, create_body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/documents/{document_id}/shares"),
        &admin_bearer,
        Some(json!({
            "shared_with_provider_id": provider_id,
            "channel": "email",
            "message": "CEO share for revoke regression.",
            "requires_confirmation": true
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let share_id = create_body["id"].as_str().unwrap().to_string();

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/documents/{document_id}/shares/{share_id}/revoke"),
        &pm_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(body["message"], "Insufficient permissions");
}

#[tokio::test]
async fn patient_document_alerts_report_missing_required_documents() {
    let Some((app, pool, admin_id, admin_bearer)) = test_context().await else {
        return;
    };
    let tag = unique_tag("doc-alerts");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let provider_id = seed_provider(&pool, &tag).await;
    let doctor_id = seed_doctor(&pool, provider_id, &tag).await;
    let appointment_id =
        seed_appointment(&pool, patient_id, provider_id, doctor_id, admin_id, &tag).await;

    configure_required_patient_documents(
        &pool,
        json!([
            {
                "key": "passport",
                "label": "Reisepass",
                "art": ["passport_scan"],
                "category": ["identity"]
            },
            {
                "key": "consent_form",
                "label": "Einverständniserklärung",
                "art": ["consent_form"],
                "category": ["consent"]
            }
        ]),
    )
    .await;

    let _passport_document = seed_document(
        &pool,
        admin_id,
        patient_id,
        appointment_id,
        "internal",
        false,
        "passport_scan",
        &format!("{tag}-passport"),
    )
    .await;

    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/patients/{patient_id}/document-alerts"),
        &admin_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["configured_rule_count"], 2);
    assert_eq!(body["document_pack_complete"], false);
    assert_eq!(body["missing_count"], 1);
    assert_eq!(
        body["missing_documents"][0]["label"],
        "Einverständniserklärung"
    );
    assert_eq!(body["required_documents"][0]["fulfilled"], true);
    assert_eq!(body["required_documents"][1]["fulfilled"], false);

    let _consent_document = seed_document(
        &pool,
        admin_id,
        patient_id,
        appointment_id,
        "internal",
        false,
        "consent_form",
        &format!("{tag}-consent"),
    )
    .await;

    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/patients/{patient_id}/document-alerts"),
        &admin_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["document_pack_complete"], true);
    assert_eq!(body["missing_count"], 0);
    assert!(body["missing_documents"].as_array().unwrap().is_empty());
}

#[tokio::test]
async fn ceo_assistant_only_sees_released_medical_documents() {
    let Some((app, pool, admin_id, _admin_bearer)) = test_context().await else {
        return;
    };
    let tag = unique_tag("doc-ceo-assistant");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let provider_id = seed_provider(&pool, &tag).await;
    let doctor_id = seed_doctor(&pool, provider_id, &tag).await;
    let appointment_id =
        seed_appointment(&pool, patient_id, provider_id, doctor_id, admin_id, &tag).await;
    let assistant_id = seed_user(&pool, &tag, "ceo_assistant").await;
    let assistant_bearer = auth_header_for(assistant_id, "ceo_assistant");

    let internal_id = seed_document(
        &pool,
        admin_id,
        patient_id,
        appointment_id,
        "internal",
        true,
        "arztbrief",
        &format!("{tag}-internal"),
    )
    .await;
    let released_id = seed_document(
        &pool,
        admin_id,
        patient_id,
        appointment_id,
        "released_internal",
        true,
        "arztbrief",
        &format!("{tag}-released"),
    )
    .await;

    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/documents?patient_id={patient_id}"),
        &assistant_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let ids: Vec<_> = body
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|item| item["id"].as_str())
        .collect();
    assert!(ids.contains(&released_id.to_string().as_str()));
    assert!(!ids.contains(&internal_id.to_string().as_str()));
}

#[tokio::test]
async fn document_meta_endpoints_return_seeded_categories_and_staff() {
    let Some((app, pool, admin_id, _admin_bearer)) = test_context().await else {
        return;
    };
    let tag = unique_tag("doc-meta");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let provider_id = seed_provider(&pool, &tag).await;
    let doctor_id = seed_doctor(&pool, provider_id, &tag).await;
    let appointment_id =
        seed_appointment(&pool, patient_id, provider_id, doctor_id, admin_id, &tag).await;
    let assistant_id = seed_user(&pool, &tag, "ceo_assistant").await;
    let assistant_bearer = auth_header_for(assistant_id, "ceo_assistant");

    sqlx::query(
        r#"INSERT INTO ref_document_categories (id, name_de, name_en, is_medical)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (id) DO UPDATE SET name_en = EXCLUDED.name_en"#,
    )
    .bind(format!("cat-{tag}"))
    .bind("Arztbrief")
    .bind("Doctor Letter")
    .bind(true)
    .execute(&pool)
    .await
    .unwrap();

    let _ = seed_document(
        &pool,
        admin_id,
        patient_id,
        appointment_id,
        "released_internal",
        true,
        "arztbrief",
        &format!("{tag}-doc"),
    )
    .await;

    let (status, staff_body) = json_request(
        &app,
        "GET",
        "/api/v1/documents/meta/staff",
        &assistant_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(
        staff_body
            .as_array()
            .unwrap()
            .iter()
            .any(|item| item["role"] == "ceo")
    );

    let (status, categories_body) = json_request(
        &app,
        "GET",
        "/api/v1/documents/meta/categories",
        &assistant_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(
        categories_body["categories"]
            .as_array()
            .unwrap()
            .iter()
            .any(|item| item["label"] == "Doctor Letter")
    );
    assert!(
        categories_body["arts"]
            .as_array()
            .unwrap()
            .iter()
            .any(|item| item == "arztbrief")
    );
}

#[tokio::test]
async fn document_templates_can_generate_treatment_plan_pdf_document() {
    let Some((app, pool, admin_id, admin_bearer)) = test_context().await else {
        return;
    };
    let tag = unique_tag("doc-template");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let provider_id = seed_provider(&pool, &tag).await;
    let doctor_id = seed_doctor(&pool, provider_id, &tag).await;
    let appointment_id =
        seed_appointment(&pool, patient_id, provider_id, doctor_id, admin_id, &tag).await;
    let order_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO orders (order_number, patient_id, phase, status, created_by)
           VALUES ($1, $2, 'execution', 'active', $3)
           RETURNING id"#,
    )
    .bind(format!("AUF-{tag}"))
    .bind(patient_id)
    .bind(admin_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    sqlx::query("UPDATE appointments SET order_id = $2 WHERE id = $1")
        .bind(appointment_id)
        .bind(order_id)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query(
        r#"INSERT INTO order_planning_preparation (order_id, treatment_plan_note)
           VALUES ($1, $2)"#,
    )
    .bind(order_id)
    .bind("Patient benötigt Dolmetscherkoordination vor Aufnahme.")
    .execute(&pool)
    .await
    .unwrap();

    let (status, catalog_body) = json_request(
        &app,
        "GET",
        "/api/v1/documents/templates",
        &admin_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(
        catalog_body["templates"]
            .as_array()
            .unwrap()
            .iter()
            .any(|item| item["id"] == "treatment_plan")
    );

    let (status, body) = json_request(
        &app,
        "POST",
        "/api/v1/documents/generate",
        &admin_bearer,
        Some(json!({
            "template_id": "treatment_plan",
            "patient_id": patient_id,
            "order_id": order_id,
            "appointment_id": appointment_id,
            "language": "de",
            "introduction": "Bitte beachten Sie die unten aufgeführten Termine.",
            "closing_note": "Unser Team meldet sich bei Änderungen umgehend.",
            "text_block_keys": ["fasting", "bring_documents"]
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let document_id = Uuid::parse_str(body["id"].as_str().unwrap()).unwrap();
    let preview_html = body["preview_html"].as_str().unwrap();
    assert!(preview_html.contains("Behandlungsplan"));
    assert!(preview_html.contains("Bitte beachten Sie die unten aufgeführten Termine."));
    assert!(preview_html.contains("Bitte nüchtern bleiben"));
    assert!(preview_html.contains("Patient benötigt Dolmetscherkoordination"));

    let (status, detail_body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/documents/{document_id}"),
        &admin_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(detail_body["art"], "treatment_plan");
    assert_eq!(detail_body["mime_type"], "application/pdf");
    assert_eq!(detail_body["visibility"], "patient_visible");

    let (status, bytes) = bytes_request(
        &app,
        "GET",
        &format!("/api/v1/documents/{document_id}/download"),
        &admin_bearer,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(bytes.starts_with(b"%PDF-"));
    assert!(bytes.len() > 1000);
    let pdf_text = extract_pdf_text(&bytes);
    assert!(pdf_text.contains("Planungsnotiz"));
    assert!(pdf_text.contains("Patient benötigt Dolmetscherkoordination"));
}

#[tokio::test]
async fn ceo_can_generate_admin_document_templates_as_pdf() {
    let Some((app, pool, admin_id, admin_bearer)) = test_context().await else {
        return;
    };
    let tag = unique_tag("admin-docs");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;

    let cases: [(&str, &str, serde_json::Value); 6] = [
        (
            "single_order",
            "administrative_single_order",
            json!({
                "order_number": "EA-2026-1",
                "order_date": "2025-11-11",
                "contract_date": "2025-11-11",
                "specialties": "Gastroenterologie, Dermatologie",
                "period_from": "2025-11-17",
                "period_to": "2025-11-19",
                "payer_name": "Justus Geldgeber",
                "payer_birth_date": "2000-01-01"
            }),
        ),
        (
            "cost_coverage_declaration",
            "finance_cost_coverage",
            json!({
                "order_date": "2025-11-11",
                "contract_date": "2025-11-11",
                "payer_name": "Justus Geldgeber",
                "bank_iban": "DE00 0000 0000 0000 0000 00",
                "service_lines": [
                    {"description": "Organisation der Behandlung", "fee": "999,00 EUR"}
                ]
            }),
        ),
        (
            "cost_estimate",
            "finance_cost_estimate",
            json!({
                "order_date": "2025-11-11",
                "estimate_total": "200,00 - 2000,00 €",
                "service_lines": [
                    {"description": "Dermatologische Untersuchung", "line_total": "100,00 - 1000,00 €"}
                ]
            }),
        ),
        (
            "appointment_confirmation",
            "administrative_appointment_confirmation",
            json!({
                "doc_id": "1251119",
                "passport_number": "MA1234567",
                "passport_valid_until": "2050-01-01",
                "period_from": "2025-11-17",
                "clinics": [
                    {"name": "Klinik München", "address": "Musterstr. 1, München"}
                ],
                "contact_phones": "0176 9999999"
            }),
        ),
        (
            "consent_data_release_child",
            "consent",
            json!({
                "child_name": "Max Musterman",
                "child_birth_date": "2015-01-01",
                "guardian_name": "Erika Musterman",
                "guardian2_name": "Hans Musterman"
            }),
        ),
        (
            "consent_data_release_single",
            "consent",
            json!({
                "child_name": "Max Musterman",
                "child_birth_date": "2015-01-01",
                "guardian_name": "Erika Musterman"
            }),
        ),
    ];

    for (template_id, expected_category, bindings) in cases {
        let expected_bindings = bindings.clone();
        let (status, body) = json_request(
            &app,
            "POST",
            "/api/v1/documents/generate",
            &admin_bearer,
            Some(json!({
                "template_id": template_id,
                "patient_id": patient_id,
                "language": "de",
                "bindings": bindings,
            })),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "generate {template_id}: {body:?}");
        assert_eq!(body["language"], "de", "{template_id}");
        assert_eq!(body["generated_template_id"], template_id, "{template_id}");
        let document_id = Uuid::parse_str(body["id"].as_str().unwrap()).unwrap();

        let (status, detail_body) = json_request(
            &app,
            "GET",
            &format!("/api/v1/documents/{document_id}"),
            &admin_bearer,
            None,
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(detail_body["mime_type"], "application/pdf", "{template_id}");
        assert_eq!(detail_body["category"], expected_category, "{template_id}");
        assert_eq!(
            detail_body["generated_template_id"], template_id,
            "{template_id}"
        );
        assert_eq!(
            detail_body["generated_bindings"], expected_bindings,
            "{template_id} must persist its exact binding snapshot"
        );
        let expected_sensitivity = if matches!(
            template_id,
            "single_order" | "cost_coverage_declaration" | "cost_estimate"
        ) {
            "Financial"
        } else {
            "Patient Identity"
        };
        assert_eq!(
            detail_body["data_sensitivity"], expected_sensitivity,
            "{template_id}"
        );

        let (status, bytes) = bytes_request(
            &app,
            "GET",
            &format!("/api/v1/documents/{document_id}/download"),
            &admin_bearer,
        )
        .await;
        assert_eq!(status, StatusCode::OK, "download {template_id}");
        assert!(bytes.starts_with(b"%PDF-"), "{template_id} is not a PDF");
        assert!(bytes.len() > 800, "{template_id} PDF too small");
    }
}

#[tokio::test]
async fn appointment_confirmation_auto_generates_doc_id() {
    let Some((app, pool, admin_id, admin_bearer)) = test_context().await else {
        return;
    };
    let tag = unique_tag("appointment-doc-id");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;

    let (status, body) = json_request(
        &app,
        "POST",
        "/api/v1/documents/generate",
        &admin_bearer,
        Some(json!({
            "template_id": "appointment_confirmation",
            "patient_id": patient_id,
            "language": "de",
            "bindings": {
                "period_from": "2025-11-17",
                "clinics": [
                    {"name": "Klinik München", "address": "Musterstr. 1, München"}
                ],
                "contact_phones": "0176 9999999"
            }
        })),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::OK,
        "generate appointment confirmation: {body:?}"
    );
    assert_eq!(body["generated_template_id"], "appointment_confirmation");
    let document_id = Uuid::parse_str(body["id"].as_str().unwrap()).unwrap();
    let mut expected_suffix = document_id.simple().to_string();
    expected_suffix.truncate(8);
    let expected_doc_id = format!("DOC-{}", expected_suffix.to_ascii_uppercase());

    let (status, bytes) = bytes_request(
        &app,
        "GET",
        &format!("/api/v1/documents/{document_id}/download"),
        &admin_bearer,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(bytes.starts_with(b"%PDF-"));

    let pdf_text = extract_pdf_text(&bytes);
    assert!(
        pdf_text.contains(&expected_doc_id),
        "generated appointment confirmation must include auto Doc.-ID {expected_doc_id}; got: {pdf_text:?}"
    );
    assert!(
        pdf_text.contains("Reisepass Nr.: ____________"),
        "generated appointment confirmation must keep the passport-number socket when no binding is provided; got: {pdf_text:?}"
    );
    assert!(
        pdf_text.contains("gültig bis ____________"),
        "generated appointment confirmation must keep the passport-validity socket when no binding is provided; got: {pdf_text:?}"
    );
    assert!(
        !pdf_text.contains("Doc.-ID: ____________"),
        "generated appointment confirmation must not leave Doc.-ID blank; got: {pdf_text:?}"
    );

    let (status, extraction_body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/documents/{document_id}/text-extraction"),
        &admin_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(extraction_body["status"], "completed");
    assert_eq!(extraction_body["method"], "pdf_text");
    assert!(
        extraction_body["extracted_text"]
            .as_str()
            .unwrap_or_default()
            .contains(&expected_doc_id),
        "generated PDFs should persist extracted text for edit prefill"
    );
}

#[tokio::test]
async fn appointment_confirmation_extracts_passport_bindings_for_edit_prefill() {
    let Some((app, pool, admin_id, admin_bearer)) = test_context().await else {
        return;
    };
    let tag = unique_tag("appointment-passport-prefill");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;

    let (status, body) = json_request(
        &app,
        "POST",
        "/api/v1/documents/generate",
        &admin_bearer,
        Some(json!({
            "template_id": "appointment_confirmation",
            "patient_id": patient_id,
            "language": "de",
            "bindings": {
                "passport_number": "MA1234567",
                "passport_valid_until": "2050-01-01",
                "period_from": "2025-11-17",
                "clinics": [
                    {"name": "Klinik München", "address": "Musterstr. 1, München"}
                ],
                "contact_phones": "0176 9999999"
            }
        })),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::OK,
        "generate appointment confirmation with passport: {body:?}"
    );
    let document_id = Uuid::parse_str(body["id"].as_str().unwrap()).unwrap();

    let (status, extraction_body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/documents/{document_id}/text-extraction"),
        &admin_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(extraction_body["status"], "completed");
    assert_eq!(extraction_body["method"], "pdf_text");
    let extracted_text = extraction_body["extracted_text"]
        .as_str()
        .unwrap_or_default();
    assert!(
        extracted_text.contains("MA1234567"),
        "passport number must be available for edit prefill; got: {extracted_text:?}"
    );
    assert!(
        extracted_text.contains("01.01.2050"),
        "passport validity must be available for edit prefill; got: {extracted_text:?}"
    );
}

#[tokio::test]
async fn consent_child_autofills_guardians_from_patient_relations() {
    let Some((app, pool, admin_id, admin_bearer)) = test_context().await else {
        return;
    };
    let tag = unique_tag("consent-guardian-autofill");
    let child_id = seed_patient(&pool, admin_id, &tag).await;

    // The child has two unlinked guardians recorded as relations. Their roles must
    // remain neutral because no related patient gender is available.
    // Short single-token names so they don't wrap in the generated PDF.
    let guardian_one = "Erikaautofillmother";
    let guardian_two = "Hansautofillfather";
    sqlx::query(
        r#"INSERT INTO patient_relations (patient_id, related_name, relation_type, created_at)
           VALUES ($1, $2, 'parent', now() - interval '1 minute'),
                  ($1, $3, 'guardian', now())"#,
    )
    .bind(child_id)
    .bind(guardian_one)
    .bind(guardian_two)
    .execute(&pool)
    .await
    .unwrap();

    // Generate WITHOUT manual guardian bindings — they must be auto-filled from relations.
    let (status, body) = json_request(
        &app,
        "POST",
        "/api/v1/documents/generate",
        &admin_bearer,
        Some(json!({
            "template_id": "consent_data_release_child",
            "patient_id": child_id,
            "language": "de",
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "generate consent: {body:?}");
    let document_id = Uuid::parse_str(body["id"].as_str().unwrap()).unwrap();

    let (status, bytes) = bytes_request(
        &app,
        "GET",
        &format!("/api/v1/documents/{document_id}/download"),
        &admin_bearer,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let pdf_text = extract_pdf_text(&bytes);
    assert!(
        pdf_text.contains(guardian_one),
        "first guardian must be auto-filled from relations; got: {pdf_text:?}"
    );
    assert!(pdf_text.contains("Sorgeberechtigte/r 1"), "{pdf_text:?}");
    assert!(pdf_text.contains("Sorgeberechtigte/r 2"), "{pdf_text:?}");
    assert!(
        pdf_text.contains(guardian_two),
        "second guardian must be auto-filled from relations; got: {pdf_text:?}"
    );
}

#[tokio::test]
async fn consent_child_labels_linked_parents_by_gender_not_relation_order() {
    let Some((app, pool, admin_id, admin_bearer)) = test_context().await else {
        return;
    };
    let tag = unique_tag("consent-guardian-gender");
    let child_id = seed_patient(&pool, admin_id, &format!("{tag}-child")).await;
    let father_id = seed_patient(&pool, admin_id, &format!("{tag}-father")).await;
    let mother_id = seed_patient(&pool, admin_id, &format!("{tag}-mother")).await;
    sqlx::query("UPDATE patients SET gender = 'male' WHERE id = $1")
        .bind(father_id)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("UPDATE patients SET gender = 'female' WHERE id = $1")
        .bind(mother_id)
        .execute(&pool)
        .await
        .unwrap();

    let father_name = "Fathergenderbinding";
    let mother_name = "Mothergenderbinding";
    sqlx::query(
        r#"INSERT INTO patient_relations (
                patient_id, related_patient_id, related_name, relation_type, created_at
           ) VALUES
                ($1, $2, $3, 'parent', now() - interval '1 minute'),
                ($1, $4, $5, 'parent', now())"#,
    )
    .bind(child_id)
    .bind(father_id)
    .bind(father_name)
    .bind(mother_id)
    .bind(mother_name)
    .execute(&pool)
    .await
    .unwrap();

    let (status, body) = json_request(
        &app,
        "POST",
        "/api/v1/documents/generate",
        &admin_bearer,
        Some(json!({
            "template_id": "consent_data_release_child",
            "patient_id": child_id,
            "language": "de"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "generate consent: {body:?}");
    let document_id = Uuid::parse_str(body["id"].as_str().unwrap()).unwrap();
    let (status, bytes) = bytes_request(
        &app,
        "GET",
        &format!("/api/v1/documents/{document_id}/download"),
        &admin_bearer,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let pdf_text = extract_pdf_text(&bytes);
    assert!(
        pdf_text.contains(&format!("{father_name}, geb. am 01.01.1990 (Vater)")),
        "{pdf_text:?}"
    );
    assert!(
        pdf_text.contains(&format!("{mother_name}, geb. am 01.01.1990 (Mutter)")),
        "{pdf_text:?}"
    );
}

#[tokio::test]
async fn ceo_can_generate_every_builtin_document_template_as_pdf() {
    let Some((app, pool, admin_id, admin_bearer)) = test_context().await else {
        return;
    };
    let tag = unique_tag("all-doc-templates");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    // Patient stickers render "ID: <patient_id>" as a single line; the default ~40-char
    // test id wraps to "ID:\n<id>" and only breaks the PDF text assertion (not generation).
    // Use a realistically short MRN so the label and value stay on one line.
    sqlx::query("UPDATE patients SET patient_id = $2 WHERE id = $1")
        .bind(patient_id)
        .bind(format!("PT-{}", &tag[tag.len().saturating_sub(6)..]))
        .execute(&pool)
        .await
        .unwrap();
    configure_patient_label_profile(&pool, patient_id).await;

    let provider_id = seed_provider(&pool, &tag).await;
    let doctor_id = seed_doctor(&pool, provider_id, &tag).await;
    let appointment_id =
        seed_appointment(&pool, patient_id, provider_id, doctor_id, admin_id, &tag).await;
    let contract_id = seed_framework_contract(&pool, patient_id, admin_id, &tag).await;
    let order_id = seed_order_with_contract(&pool, patient_id, contract_id, admin_id, &tag).await;
    let _quote_id = seed_quote_for_order(&pool, order_id, admin_id, &tag).await;
    let case_id = seed_case(
        &pool,
        patient_id,
        admin_id,
        &format!("C-{tag}-ACTIVE"),
        "open",
        "Template coverage medication case",
    )
    .await;
    seed_case_medication(
        &pool,
        case_id,
        "Bisoprolol 2.5",
        "Bisoprolol",
        "2.5",
        "mg",
        "1x morgens",
        "Dr. Template",
        "permanent",
        "Template coverage",
    )
    .await;

    let expected_template_ids = [
        "treatment_plan",
        "medication_summary",
        "framework_contract",
        "visa_invitation_letter",
        "patient_sticker_compact",
        "patient_sticker_standard",
        "patient_sticker_sheet",
        "single_order",
        "cost_coverage_declaration",
        "cost_estimate",
        "appointment_confirmation",
        "consent_data_release_child",
        "consent_data_release_single",
    ];

    let (status, catalog_body) = json_request(
        &app,
        "GET",
        "/api/v1/documents/templates",
        &admin_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let catalog_templates = catalog_body["templates"].as_array().unwrap();
    for template_id in expected_template_ids {
        assert!(
            catalog_templates
                .iter()
                .any(|item| item["id"] == template_id),
            "template catalog is missing {template_id}"
        );
    }

    struct TemplateCase {
        template_id: &'static str,
        expected_art: &'static str,
        expected_category: &'static str,
        order_id: Option<Uuid>,
        appointment_id: Option<Uuid>,
        bindings: Value,
        text_block_keys: Vec<&'static str>,
        min_pdf_size: usize,
        expected_pdf_text: &'static str,
    }

    let cases = vec![
        TemplateCase {
            template_id: "treatment_plan",
            expected_art: "treatment_plan",
            expected_category: "treatment_plan",
            order_id: None,
            appointment_id: Some(appointment_id),
            bindings: json!({}),
            text_block_keys: vec!["fasting"],
            min_pdf_size: 1000,
            expected_pdf_text: "Intro for treatment_plan",
        },
        TemplateCase {
            template_id: "medication_summary",
            expected_art: "medication_summary",
            expected_category: "medication_summary",
            order_id: None,
            appointment_id: None,
            bindings: json!({}),
            text_block_keys: vec!["doctor_changes_only"],
            min_pdf_size: 1000,
            expected_pdf_text: "Intro for medication_summary",
        },
        TemplateCase {
            template_id: "framework_contract",
            expected_art: "framework_contract",
            expected_category: "contract",
            order_id: Some(order_id),
            appointment_id: None,
            bindings: json!({}),
            text_block_keys: vec!["contract_scope_clause"],
            min_pdf_size: 1000,
            expected_pdf_text: "Rahmendienstleistungsvertrag",
        },
        TemplateCase {
            template_id: "visa_invitation_letter",
            expected_art: "visa_invitation",
            expected_category: "visa_invitation_letter",
            order_id: Some(order_id),
            appointment_id: Some(appointment_id),
            bindings: json!({}),
            text_block_keys: vec![],
            min_pdf_size: 1000,
            expected_pdf_text: "Intro for visa_invitation_letter",
        },
        TemplateCase {
            template_id: "patient_sticker_compact",
            expected_art: "patient_sticker",
            expected_category: "administrative",
            order_id: None,
            appointment_id: None,
            bindings: json!({}),
            text_block_keys: vec![],
            min_pdf_size: 500,
            expected_pdf_text: "ID: PT-",
        },
        TemplateCase {
            template_id: "patient_sticker_standard",
            expected_art: "patient_sticker",
            expected_category: "administrative",
            order_id: None,
            appointment_id: None,
            bindings: json!({}),
            text_block_keys: vec![],
            min_pdf_size: 500,
            expected_pdf_text: "ID: PT-",
        },
        TemplateCase {
            template_id: "patient_sticker_sheet",
            expected_art: "patient_sticker",
            expected_category: "administrative",
            order_id: None,
            appointment_id: None,
            bindings: json!({}),
            text_block_keys: vec![],
            min_pdf_size: 500,
            expected_pdf_text: "ID: PT-",
        },
        TemplateCase {
            template_id: "single_order",
            expected_art: "single_order",
            expected_category: "administrative_single_order",
            order_id: Some(order_id),
            appointment_id: None,
            bindings: json!({
                "order_sequence": 2,
                "order_number": "EA-ALL-1",
                "order_date": "2026-05-01",
                "contract_date": "2026-04-01",
                "specialties": "Kardiologie",
                "examination_purpose": "kardiologischen Abklärung",
                "treatment_purpose": "eine interventionelle Behandlung",
                "period_from": "2026-06-01",
                "period_to": "2026-06-05",
                "payer_salutation": "Frau",
                "payer_name": "Template Payer",
                "payer_birth_date": "1980-01-01",
                "order_components": "Anlage A: Vorbefunde und Medikationsliste"
            }),
            text_block_keys: vec![],
            min_pdf_size: 800,
            expected_pdf_text: "Anlage A: Vorbefunde",
        },
        TemplateCase {
            template_id: "cost_coverage_declaration",
            expected_art: "cost_coverage_declaration",
            expected_category: "finance_cost_coverage",
            order_id: Some(order_id),
            appointment_id: None,
            bindings: json!({
                "order_date": "2026-05-01",
                "contract_date": "2026-04-01",
                "payer_name": "Template Payer",
                "bank_iban": "DE00 0000 0000 0000 0000 00",
                "service_lines": [
                    {"description": "Organisation der Behandlung", "fee": "999,00 EUR"}
                ]
            }),
            text_block_keys: vec![],
            min_pdf_size: 800,
            expected_pdf_text: "Template Payer",
        },
        TemplateCase {
            template_id: "cost_estimate",
            expected_art: "cost_estimate",
            expected_category: "finance_cost_estimate",
            order_id: Some(order_id),
            appointment_id: None,
            bindings: json!({
                "order_date": "2026-05-01"
            }),
            text_block_keys: vec![],
            min_pdf_size: 800,
            expected_pdf_text: "Koordination vor stationärer Aufnahme",
        },
        TemplateCase {
            template_id: "appointment_confirmation",
            expected_art: "appointment_confirmation",
            expected_category: "administrative_appointment_confirmation",
            order_id: Some(order_id),
            appointment_id: Some(appointment_id),
            bindings: json!({
                "doc_id": "ALL-1251119",
                "passport_number": "MA1234567",
                "passport_valid_until": "2050-01-01",
                "period_from": "2026-06-01",
                "clinics": [
                    {"name": "Klinik München", "address": "Musterstr. 1, München"}
                ],
                "contact_phones": "0176 9999999"
            }),
            text_block_keys: vec![],
            min_pdf_size: 800,
            expected_pdf_text: "ALL-1251119",
        },
        TemplateCase {
            template_id: "consent_data_release_child",
            expected_art: "consent_data_release",
            expected_category: "consent",
            order_id: None,
            appointment_id: None,
            bindings: json!({
                "child_name": "Max Mustermann",
                "child_birth_date": "2015-01-01",
                "guardian_name": "Erika Mustermann",
                "guardian2_name": "Hans Mustermann"
            }),
            text_block_keys: vec![],
            min_pdf_size: 800,
            expected_pdf_text: "Max Mustermann",
        },
        TemplateCase {
            template_id: "consent_data_release_single",
            expected_art: "consent_data_release",
            expected_category: "consent",
            order_id: None,
            appointment_id: None,
            bindings: json!({
                "child_name": "Max Mustermann",
                "child_birth_date": "2015-01-01",
                "guardian_name": "Erika Mustermann"
            }),
            text_block_keys: vec![],
            min_pdf_size: 800,
            expected_pdf_text: "Max Mustermann",
        },
    ];

    assert_eq!(cases.len(), expected_template_ids.len());

    for case in cases {
        let mut payload = json!({
            "template_id": case.template_id,
            "patient_id": patient_id,
            "language": "de",
            "introduction": format!("Intro for {}", case.template_id),
            "closing_note": format!("Closing for {}", case.template_id),
            "bindings": case.bindings,
            "text_block_keys": case.text_block_keys,
        });
        if let Some(order_id) = case.order_id {
            payload["order_id"] = json!(order_id);
        }
        if let Some(appointment_id) = case.appointment_id {
            payload["appointment_id"] = json!(appointment_id);
        }

        let (status, body) = json_request(
            &app,
            "POST",
            "/api/v1/documents/generate",
            &admin_bearer,
            Some(payload),
        )
        .await;
        assert_eq!(
            status,
            StatusCode::OK,
            "generate {}: {body:?}",
            case.template_id
        );
        assert_eq!(body["language"], "de", "{}", case.template_id);
        assert_eq!(
            body["generated_template_id"], case.template_id,
            "{}",
            case.template_id
        );

        let document_id = Uuid::parse_str(body["id"].as_str().unwrap()).unwrap();
        let preview_html = body["preview_html"].as_str().unwrap();
        assert!(
            !preview_html.trim().is_empty(),
            "{} preview should not be empty",
            case.template_id
        );

        let (status, detail_body) = json_request(
            &app,
            "GET",
            &format!("/api/v1/documents/{document_id}"),
            &admin_bearer,
            None,
        )
        .await;
        assert_eq!(status, StatusCode::OK, "detail {}", case.template_id);
        assert_eq!(
            detail_body["art"], case.expected_art,
            "{}",
            case.template_id
        );
        assert_eq!(
            detail_body["category"], case.expected_category,
            "{}",
            case.template_id
        );
        assert_eq!(
            detail_body["generated_template_id"], case.template_id,
            "{}",
            case.template_id
        );
        assert_eq!(
            detail_body["mime_type"], "application/pdf",
            "{}",
            case.template_id
        );

        let (status, bytes) = bytes_request(
            &app,
            "GET",
            &format!("/api/v1/documents/{document_id}/download"),
            &admin_bearer,
        )
        .await;
        assert_eq!(status, StatusCode::OK, "download {}", case.template_id);
        assert!(
            bytes.starts_with(b"%PDF-"),
            "{} is not a PDF",
            case.template_id
        );
        assert!(
            bytes.len() > case.min_pdf_size,
            "{} PDF too small: {}",
            case.template_id,
            bytes.len()
        );
        let pdf_text = pdf_extract::extract_text_from_mem(&bytes).unwrap_or_else(|error| {
            panic!("{} PDF text extraction failed: {error}", case.template_id)
        });
        assert!(
            pdf_text.contains(case.expected_pdf_text),
            "{} PDF text did not contain expected text {:?}. Extracted text: {:?}",
            case.template_id,
            case.expected_pdf_text,
            pdf_text
        );
    }
}

#[tokio::test]
async fn framework_contract_document_requires_existing_contract() {
    let Some((app, pool, admin_id, admin_bearer)) = test_context().await else {
        return;
    };
    let tag = unique_tag("doc-framework-contract-missing");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;

    let (status, body) = json_request(
        &app,
        "POST",
        "/api/v1/documents/generate",
        &admin_bearer,
        Some(json!({
            "template_id": "framework_contract",
            "patient_id": patient_id,
            "language": "de"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(
        body["message"],
        "Framework contract template requires an existing framework contract in scope"
    );
}

#[tokio::test]
async fn cost_coverage_declaration_includes_contract_obligations_and_annexes() {
    let Some((app, pool, admin_id, admin_bearer)) = test_context().await else {
        return;
    };
    let tag = unique_tag("doc-cost-coverage-obligations");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let contract_id = seed_framework_contract(&pool, patient_id, admin_id, &tag).await;
    let order_id = seed_order_with_contract(&pool, patient_id, contract_id, admin_id, &tag).await;
    let _quote_id = seed_quote_for_order(&pool, order_id, admin_id, &tag).await;

    let (status, body) = json_request(
        &app,
        "POST",
        "/api/v1/documents/generate",
        &admin_bearer,
        Some(json!({
            "template_id": "cost_coverage_declaration",
            "patient_id": patient_id,
            "order_id": order_id,
            "language": "de",
            "bindings": {
                "order_sequence": 3,
                "order_date": "2025-11-11",
                "contract_date": "2025-11-11",
                "quote_number": "KV77777777",
                "payer_salutation": "Herr",
                "payer_name": "Justus Geldgeber",
                "payer_birth_date": "2000-01-01",
                "bank_iban": "DE00 0000 0000 0000 0000 00"
            }
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "generate cost coverage: {body:?}");
    let document_id = Uuid::parse_str(body["id"].as_str().unwrap()).unwrap();
    let (status, bytes) = bytes_request(
        &app,
        "GET",
        &format!("/api/v1/documents/{document_id}/download"),
        &admin_bearer,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(bytes.starts_with(b"%PDF-"));
    let pdf_text = extract_pdf_text(&bytes);
    assert!(pdf_text.contains("Übernahme der Vertragspflichten"));
    assert!(pdf_text.contains("sämtliche Pflichten des Auftraggebers"));
    assert!(pdf_text.contains("Herr Justus Geldgeber"));
    assert!(pdf_text.contains("Bestandteile der Kostenübernahmeerklärung"));
    assert!(pdf_text.contains("3. Einzelauftrag"));
    assert!(pdf_text.contains("Anlage 1"));
    assert!(pdf_text.contains("KV77777777"));
}

#[tokio::test]
async fn single_order_without_payer_includes_quote_annex_and_separate_signatures() {
    let Some((app, pool, admin_id, admin_bearer)) = test_context().await else {
        return;
    };
    let tag = unique_tag("doc-single-order-annex");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let contract_id = seed_framework_contract(&pool, patient_id, admin_id, &tag).await;
    let order_id = seed_order_with_contract(&pool, patient_id, contract_id, admin_id, &tag).await;
    let _quote_id = seed_quote_for_order(&pool, order_id, admin_id, &tag).await;

    let bindings = json!({
        "party_sign_place": "Paris-signature",
        "party_sign_date": "2026-04-03",
        "agency_sign_place": "Munich-signature",
        "agency_sign_date": "2026-04-02",
        "bank_holder": "Configured account holder",
        "bank_iban": "DE00 0000 0000 0000 0000 00"
    });
    let (status, body) = json_request(
        &app,
        "POST",
        "/api/v1/documents/generate",
        &admin_bearer,
        Some(json!({
            "template_id": "single_order",
            "patient_id": patient_id,
            "order_id": order_id,
            "language": "de",
            "bindings": bindings
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "generate single order: {body:?}");
    let document_id = Uuid::parse_str(body["id"].as_str().unwrap()).unwrap();

    let (status, detail) = json_request(
        &app,
        "GET",
        &format!("/api/v1/documents/{document_id}"),
        &admin_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(detail["generated_bindings"], bindings);

    let (status, bytes) = bytes_request(
        &app,
        "GET",
        &format!("/api/v1/documents/{document_id}/download"),
        &admin_bearer,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let pdf_text = extract_pdf_text(&bytes);
    assert!(
        pdf_text.contains("Anlage 1 zum 1. Einzelauftrag"),
        "{pdf_text:?}"
    );
    assert!(pdf_text.contains(&format!("KV-{tag}")), "{pdf_text:?}");
    assert!(
        pdf_text.contains("Koordination vor stationärer Aufnahme"),
        "{pdf_text:?}"
    );
    assert!(
        pdf_text.contains("Configured account holder"),
        "{pdf_text:?}"
    );
    assert!(pdf_text.contains("Paris-signature"), "{pdf_text:?}");
    assert!(pdf_text.contains("Munich-signature"), "{pdf_text:?}");
}

#[tokio::test]
async fn appointment_confirmation_autofills_clinic_and_date_from_appointment() {
    let Some((app, pool, admin_id, admin_bearer)) = test_context().await else {
        return;
    };
    let tag = unique_tag("doc-appointment-autofill");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let provider_id =
        seed_provider_with_type_and_specialty(&pool, &tag, "medical", "Dermatologie").await;
    let doctor_id = seed_doctor_with_specialty(&pool, provider_id, &tag, "Endokrinologie").await;
    let appointment_id =
        seed_appointment(&pool, patient_id, provider_id, doctor_id, admin_id, &tag).await;

    let (status, body) = json_request(
        &app,
        "POST",
        "/api/v1/documents/generate",
        &admin_bearer,
        Some(json!({
            "template_id": "appointment_confirmation",
            "patient_id": patient_id,
            "appointment_id": appointment_id,
            "language": "de"
        })),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::OK,
        "generate appointment confirmation: {body:?}"
    );
    let document_id = Uuid::parse_str(body["id"].as_str().unwrap()).unwrap();
    let (status, bytes) = bytes_request(
        &app,
        "GET",
        &format!("/api/v1/documents/{document_id}/download"),
        &admin_bearer,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let pdf_text = extract_pdf_text(&bytes);
    assert!(pdf_text.contains(&format!("Clinic {tag}")), "{pdf_text:?}");
    assert!(pdf_text.contains("Clinic Street 1"), "{pdf_text:?}");
    assert!(pdf_text.contains("15.04.2026"), "{pdf_text:?}");
    assert!(
        pdf_text.contains("Die Behandlung wurde in Deutschland begonnen"),
        "{pdf_text:?}"
    );
}

#[tokio::test]
async fn cost_estimate_uses_order_quote_when_manual_lines_are_omitted() {
    let Some((app, pool, admin_id, admin_bearer)) = test_context().await else {
        return;
    };
    let tag = unique_tag("doc-cost-estimate-quote");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let contract_id = seed_framework_contract(&pool, patient_id, admin_id, &tag).await;
    let order_id = seed_order_with_contract(&pool, patient_id, contract_id, admin_id, &tag).await;
    let _quote_id = seed_quote_for_order(&pool, order_id, admin_id, &tag).await;

    let (status, body) = json_request(
        &app,
        "POST",
        "/api/v1/documents/generate",
        &admin_bearer,
        Some(json!({
            "template_id": "cost_estimate",
            "patient_id": patient_id,
            "order_id": order_id,
            "language": "de",
            "bindings": {
                "order_date": "2026-05-18"
            }
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "generate cost estimate: {body:?}");
    assert_eq!(body["language"], "de");
    let preview_html = body["preview_html"].as_str().unwrap();
    assert!(preview_html.contains("Koordination vor stationärer Aufnahme"));
    assert!(preview_html.contains("Ориентировочный расчёт стоимости"));
    // Quote total is now rendered in German currency format ("1.428,00 EUR").
    assert!(preview_html.contains("1.428,00"));

    let document_id = Uuid::parse_str(body["id"].as_str().unwrap()).unwrap();
    let (status, bytes) = bytes_request(
        &app,
        "GET",
        &format!("/api/v1/documents/{document_id}/download"),
        &admin_bearer,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(bytes.starts_with(b"%PDF-"));
    assert!(bytes.len() > 800);
    let pdf_text = extract_pdf_text(&bytes);
    assert!(pdf_text.contains("Medizinische Leistungen"));
    // The PDF embeds the Cyrillic content correctly, but pdf_extract decodes
    // those glyphs non-deterministically (it depends on font-cache state primed
    // by earlier tests in the run), which makes asserting Russian text via the
    // extracted PDF flaky. The Russian content is verified deterministically on
    // `preview_html` above; the German line here keeps the PDF render covered.
}

#[tokio::test]
async fn cost_estimate_manual_lines_do_not_reuse_quote_total() {
    let Some((app, pool, admin_id, admin_bearer)) = test_context().await else {
        return;
    };
    let tag = unique_tag("doc-cost-estimate-manual");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let contract_id = seed_framework_contract(&pool, patient_id, admin_id, &tag).await;
    let order_id = seed_order_with_contract(&pool, patient_id, contract_id, admin_id, &tag).await;
    let _quote_id = seed_quote_for_order(&pool, order_id, admin_id, &tag).await;

    let (status, body) = json_request(
        &app,
        "POST",
        "/api/v1/documents/generate",
        &admin_bearer,
        Some(json!({
            "template_id": "cost_estimate",
            "patient_id": patient_id,
            "order_id": order_id,
            "language": "de",
            "bindings": {
                "service_lines": [
                    {"description": "Manuelle Zusatzleistung", "line_total": "99,00 EUR"}
                ]
            }
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "generate cost estimate: {body:?}");
    let preview_html = body["preview_html"].as_str().unwrap();
    assert!(preview_html.contains("Manuelle Zusatzleistung"));
    assert!(!preview_html.contains("1428"));
}

#[tokio::test]
async fn patient_manager_cannot_resolve_an_unassigned_patient_through_order_context() {
    let Some((app, pool, admin_id, _admin_bearer)) = test_context().await else {
        return;
    };
    let tag = unique_tag("doc-generate-resolved-assignment");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let contract_id = seed_framework_contract(&pool, patient_id, admin_id, &tag).await;
    let order_id = seed_order_with_contract(&pool, patient_id, contract_id, admin_id, &tag).await;
    let pm_id = seed_user(&pool, &tag, "patient_manager").await;
    let pm_bearer = auth_header_for(pm_id, "patient_manager");

    let (status, body) = json_request(
        &app,
        "POST",
        "/api/v1/documents/generate",
        &pm_bearer,
        Some(json!({
            "template_id": "cost_estimate",
            "order_id": order_id,
            "language": "de"
        })),
    )
    .await;

    assert_eq!(status, StatusCode::FORBIDDEN, "{body:?}");
    assert_eq!(body["message"], "You are not assigned to this patient");
}

#[tokio::test]
async fn ceo_assistant_can_list_document_templates_but_cannot_generate_documents() {
    let Some((app, pool, admin_id, _admin_bearer)) = test_context().await else {
        return;
    };
    let tag = unique_tag("doc-template-assistant");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let provider_id = seed_provider(&pool, &tag).await;
    let doctor_id = seed_doctor(&pool, provider_id, &tag).await;
    let appointment_id =
        seed_appointment(&pool, patient_id, provider_id, doctor_id, admin_id, &tag).await;
    let assistant_id = seed_user(&pool, &tag, "ceo_assistant").await;
    let assistant_bearer = auth_header_for(assistant_id, "ceo_assistant");

    let (status, catalog_body) = json_request(
        &app,
        "GET",
        "/api/v1/documents/templates",
        &assistant_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(
        catalog_body["templates"]
            .as_array()
            .unwrap()
            .iter()
            .any(|item| item["id"] == "treatment_plan")
    );

    let (status, body) = json_request(
        &app,
        "POST",
        "/api/v1/documents/generate",
        &assistant_bearer,
        Some(json!({
            "template_id": "treatment_plan",
            "patient_id": patient_id,
            "appointment_id": appointment_id,
            "language": "de"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(body["message"], "Insufficient permissions");
}

#[tokio::test]
async fn document_templates_are_german_only_even_when_patient_prefers_another_language() {
    let Some((app, pool, admin_id, admin_bearer)) = test_context().await else {
        return;
    };
    let tag = unique_tag("doc-template-lang");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let provider_id = seed_provider(&pool, &tag).await;
    let doctor_id = seed_doctor(&pool, provider_id, &tag).await;
    let appointment_id =
        seed_appointment(&pool, patient_id, provider_id, doctor_id, admin_id, &tag).await;

    sqlx::query("UPDATE patients SET languages = $2 WHERE id = $1")
        .bind(patient_id)
        .bind(vec!["uk".to_string(), "de".to_string()])
        .execute(&pool)
        .await
        .unwrap();

    let (status, body) = json_request(
        &app,
        "POST",
        "/api/v1/documents/generate",
        &admin_bearer,
        Some(json!({
            "template_id": "treatment_plan",
            "patient_id": patient_id,
            "appointment_id": appointment_id,
            "text_block_keys": ["fasting"]
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["language"], "de");
    let preview_html = body["preview_html"].as_str().unwrap();
    assert!(preview_html.contains("Behandlungsplan"));
    assert!(preview_html.contains("Bitte nüchtern bleiben"));

    let (status, catalog_body) = json_request(
        &app,
        "GET",
        "/api/v1/documents/templates",
        &admin_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    for template in catalog_body["templates"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|item| item["template_kind"].as_str().unwrap_or("builtin") == "builtin")
    {
        assert_eq!(template["supported_languages"], json!(["de"]));
    }

    let (status, body) = json_request(
        &app,
        "POST",
        "/api/v1/documents/generate",
        &admin_bearer,
        Some(json!({
            "template_id": "treatment_plan",
            "patient_id": patient_id,
            "appointment_id": appointment_id,
            "language": "uk"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(
        body["message"],
        "Language is not supported by the selected template"
    );
}

#[tokio::test]
async fn document_templates_can_replace_previous_generated_version() {
    let Some((app, pool, admin_id, admin_bearer)) = test_context().await else {
        return;
    };
    let tag = unique_tag("doc-template-version");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let provider_id = seed_provider(&pool, &tag).await;
    let doctor_id = seed_doctor(&pool, provider_id, &tag).await;
    let appointment_id =
        seed_appointment(&pool, patient_id, provider_id, doctor_id, admin_id, &tag).await;

    let (status, first_body) = json_request(
        &app,
        "POST",
        "/api/v1/documents/generate",
        &admin_bearer,
        Some(json!({
            "template_id": "treatment_plan",
            "patient_id": patient_id,
            "appointment_id": appointment_id,
            "language": "de",
            "introduction": "Version eins."
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let first_document_id = Uuid::parse_str(first_body["id"].as_str().unwrap()).unwrap();
    assert_eq!(first_body["version_number"], 1);

    let (status, second_body) = json_request(
        &app,
        "POST",
        "/api/v1/documents/generate",
        &admin_bearer,
        Some(json!({
            "template_id": "treatment_plan",
            "patient_id": patient_id,
            "appointment_id": appointment_id,
            "language": "de",
            "replace_document_id": first_document_id,
            "introduction": "Version zwei."
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let second_document_id = Uuid::parse_str(second_body["id"].as_str().unwrap()).unwrap();
    assert_eq!(second_body["version_number"], 2);
    assert_eq!(
        second_body["replaces_document_id"],
        first_document_id.to_string()
    );

    let (status, first_detail_body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/documents/{first_document_id}"),
        &admin_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(first_detail_body["status"], "archived");
    assert_eq!(
        first_detail_body["superseded_by_document_id"],
        second_document_id.to_string()
    );
    assert_eq!(first_detail_body["is_latest_version"], false);

    let (status, second_detail_body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/documents/{second_document_id}"),
        &admin_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(second_detail_body["version_number"], 2);
    assert_eq!(
        second_detail_body["replaces_document_id"],
        first_document_id.to_string()
    );
    assert_eq!(second_detail_body["version_count"], 2);
    assert_eq!(second_detail_body["is_latest_version"], true);

    let (status, versions_body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/documents/{second_document_id}/versions"),
        &admin_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let versions = versions_body.as_array().unwrap();
    assert_eq!(versions.len(), 2);
    assert_eq!(versions[0]["id"], second_document_id.to_string());
    assert_eq!(versions[1]["id"], first_document_id.to_string());
}

#[tokio::test]
async fn generated_document_replacement_requires_exact_template_id() {
    let Some((app, pool, admin_id, admin_bearer)) = test_context().await else {
        return;
    };
    let tag = unique_tag("doc-template-exact-version");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;

    let (status, first_body) = json_request(
        &app,
        "POST",
        "/api/v1/documents/generate",
        &admin_bearer,
        Some(json!({
            "template_id": "consent_data_release_single",
            "patient_id": patient_id,
            "language": "de",
            "bindings": {
                "child_name": "Max Mustermann",
                "child_birth_date": "2015-01-01",
                "guardian_name": "Erika Mustermann"
            }
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let first_document_id = Uuid::parse_str(first_body["id"].as_str().unwrap()).unwrap();
    assert_eq!(
        first_body["generated_template_id"],
        "consent_data_release_single"
    );

    let (status, body) = json_request(
        &app,
        "POST",
        "/api/v1/documents/generate",
        &admin_bearer,
        Some(json!({
            "template_id": "consent_data_release_child",
            "patient_id": patient_id,
            "language": "de",
            "replace_document_id": first_document_id,
            "bindings": {
                "child_name": "Max Mustermann",
                "child_birth_date": "2015-01-01",
                "guardian_name": "Erika Mustermann",
                "guardian2_name": "Hans Mustermann"
            }
        })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(
        body["message"],
        "Replacement document must be the same generated template type"
    );

    let (status, second_body) = json_request(
        &app,
        "POST",
        "/api/v1/documents/generate",
        &admin_bearer,
        Some(json!({
            "template_id": "consent_data_release_single",
            "patient_id": patient_id,
            "language": "de",
            "replace_document_id": first_document_id,
            "bindings": {
                "child_name": "Max Mustermann",
                "child_birth_date": "2015-01-01",
                "guardian_name": "Erika Mustermann"
            }
        })),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::OK,
        "replace exact template: {second_body:?}"
    );
    assert_eq!(second_body["version_number"], 2);
    assert_eq!(
        second_body["replaces_document_id"],
        first_document_id.to_string()
    );
}

#[tokio::test]
async fn document_templates_can_generate_medication_summary_pdf_document() {
    let Some((app, pool, admin_id, admin_bearer)) = test_context().await else {
        return;
    };
    let tag = unique_tag("doc-med-summary");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let active_case = seed_case(
        &pool,
        patient_id,
        admin_id,
        &format!("C-{tag}-ACTIVE"),
        "open",
        "Cardiology follow-up",
    )
    .await;
    let active_case_two = seed_case(
        &pool,
        patient_id,
        admin_id,
        &format!("C-{tag}-ACTIVE-2"),
        "in_progress",
        "Endocrinology review",
    )
    .await;
    let closed_case = seed_case(
        &pool,
        patient_id,
        admin_id,
        &format!("C-{tag}-CLOSED"),
        "closed",
        "Legacy discharge",
    )
    .await;

    seed_case_medication(
        &pool,
        active_case,
        "",
        "Ramipril",
        "5",
        "mg",
        "1x morgens",
        "Dr. Active",
        "permanent",
        "Blood pressure",
    )
    .await;
    seed_case_medication(
        &pool,
        active_case_two,
        "Metformin 500",
        "Metformin",
        "500",
        "mg",
        "2x täglich",
        "Dr. Review",
        "temporary",
        "Glucose control",
    )
    .await;
    let update_result = sqlx::query(
        r#"UPDATE medikamente
           SET expiry_date = '2026-07-31'
           WHERE case_id = $1 AND handelsname = $2"#,
    )
    .bind(active_case_two)
    .bind("Metformin 500")
    .execute(&pool)
    .await
    .unwrap();
    assert_eq!(update_result.rows_affected(), 1);
    seed_case_medication(
        &pool,
        closed_case,
        "Legacy Closed Med",
        "Ibuprofen",
        "400",
        "mg",
        "3x täglich",
        "Dr. Closed",
        "temporary",
        "Old pain episode",
    )
    .await;

    let (status, catalog_body) = json_request(
        &app,
        "GET",
        "/api/v1/documents/templates",
        &admin_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(
        catalog_body["templates"]
            .as_array()
            .unwrap()
            .iter()
            .any(|item| item["id"] == "medication_summary")
    );

    let (status, body) = json_request(
        &app,
        "POST",
        "/api/v1/documents/generate",
        &admin_bearer,
        Some(json!({
            "template_id": "medication_summary",
            "patient_id": patient_id,
            "language": "de",
            "introduction": "Bitte nutzen Sie diese Liste als aktuelle Arbeitsversion.",
            "closing_note": "Bei Unklarheiten melden Sie sich bitte vor jeder Änderung.",
            "text_block_keys": ["doctor_changes_only", "carry_updated_list"]
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let document_id = Uuid::parse_str(body["id"].as_str().unwrap()).unwrap();
    let preview_html = body["preview_html"].as_str().unwrap();
    assert!(preview_html.contains("Medikamentenübersicht"));
    assert!(preview_html.contains("Ramipril"));
    assert!(preview_html.contains("Metformin 500"));
    assert!(preview_html.contains("Bis: 31.07.2026"));
    assert!(preview_html.contains("Dr. Active"));
    assert!(preview_html.contains("Alle aktiven Patientencases"));
    assert!(!preview_html.contains("Legacy Closed Med"));

    let (status, detail_body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/documents/{document_id}"),
        &admin_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(detail_body["art"], "medication_summary");
    assert_eq!(detail_body["mime_type"], "application/pdf");
    assert_eq!(detail_body["visibility"], "patient_visible");

    let (status, bytes) = bytes_request(
        &app,
        "GET",
        &format!("/api/v1/documents/{document_id}/download"),
        &admin_bearer,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(bytes.starts_with(b"%PDF-"));
    assert!(bytes.len() > 1000);
    let pdf_text = extract_pdf_text(&bytes);
    assert!(pdf_text.contains("Medikamentenübersicht"));
    assert!(pdf_text.contains("Bis: 31.07.2026"));
}

#[tokio::test]
async fn document_templates_can_generate_framework_contract_pdf_document() {
    let Some((app, pool, admin_id, admin_bearer)) = test_context().await else {
        return;
    };
    let tag = unique_tag("doc-framework-contract");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let contract_id = seed_framework_contract(&pool, patient_id, admin_id, &tag).await;
    let order_id = seed_order_with_contract(&pool, patient_id, contract_id, admin_id, &tag).await;
    let _quote_id = seed_quote_for_order(&pool, order_id, admin_id, &tag).await;

    let (status, catalog_body) = json_request(
        &app,
        "GET",
        "/api/v1/documents/templates",
        &admin_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(
        catalog_body["templates"]
            .as_array()
            .unwrap()
            .iter()
            .any(|item| item["id"] == "framework_contract")
    );

    let (status, body) = json_request(
        &app,
        "POST",
        "/api/v1/documents/generate",
        &admin_bearer,
        Some(json!({
            "template_id": "framework_contract",
            "patient_id": patient_id,
            "order_id": order_id,
            "language": "de",
            "introduction": "Dieser Rahmenvertrag bündelt den aktuellen Leistungs- und Abwicklungsstand.",
            "closing_note": "Bitte prüfen Sie alle Positionen vor finaler Freigabe.",
            "text_block_keys": ["contract_scope_clause", "quote_reference_clause"],
            "bindings": {
                "contract_date": "2025-11-11",
                "party_street": "Override Str. 9",
                "party_zip": "80331",
                "party_city": "Muenchen",
                "party_country": "Deutschland",
                "party_email": "override.patient@example.test",
                "party_phone": "+49 89 123456",
                "order_sequence": 4,
                "cost_threshold": "2500",
                "extra_release_recipients": "Klinik Datenschutzstelle",
                "sign_place": "München",
                "sign_date": "2025-11-11"
            }
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let document_id = Uuid::parse_str(body["id"].as_str().unwrap()).unwrap();
    let preview_html = body["preview_html"].as_str().unwrap();
    assert!(preview_html.contains("Rahmenvertrag"));
    assert!(preview_html.contains(&format!("FC-{tag}")));
    assert!(preview_html.contains(&format!("KV-{tag}")));
    assert!(preview_html.contains("Koordination vor stationärer Aufnahme"));
    assert!(preview_html.contains("Die Agentur koordiniert Organisation"));
    assert!(preview_html.contains("Advance payment before treatment"));

    let (status, detail_body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/documents/{document_id}"),
        &admin_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(detail_body["art"], "framework_contract");
    assert_eq!(detail_body["mime_type"], "application/pdf");
    assert_eq!(detail_body["visibility"], "patient_visible");

    let (status, bytes) = bytes_request(
        &app,
        "GET",
        &format!("/api/v1/documents/{document_id}/download"),
        &admin_bearer,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(bytes.starts_with(b"%PDF-"));
    assert!(bytes.len() > 1000);
    let pdf_text = extract_pdf_text(&bytes);
    assert!(pdf_text.contains("Informationsblatt zum Datenschutz"));
    assert!(pdf_text.contains("Beschwerderecht"));
    assert!(pdf_text.contains("Datenschutzkontakt"));
    assert!(!pdf_text.contains("Salesforce"));
    assert!(!pdf_text.contains("Heorhii Hudiiev"));
    assert!(pdf_text.contains("Override Str. 9 | 80331 Muenchen | Deutschland"));
    assert!(pdf_text.contains("override.patient@example.test"));
    assert!(pdf_text.contains("+49 89 123456"));
    assert!(pdf_text.contains("4. EINZELAUFTRAG"));
    assert!(pdf_text.contains("2.500,00 EUR"));
    assert!(pdf_text.contains("Klinik Datenschutzstelle"));
    assert!(!pdf_text.contains("(E-Mail-Adresse"));
}

#[tokio::test]
async fn document_templates_can_generate_patient_sticker_pdf_document() {
    let Some((app, pool, admin_id, admin_bearer)) = test_context().await else {
        return;
    };
    let tag = unique_tag("doc-sticker");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    // Stickers render the patient id on a single line; the default ~40-char test id wraps
    // in the PDF, so the id/tag is not contiguous when extracted. Use a short, realistic
    // MRN and assert on it instead of the full tag.
    let short_pid = format!("PT-{}", &tag[tag.len().saturating_sub(6)..]);
    sqlx::query("UPDATE patients SET patient_id = $2 WHERE id = $1")
        .bind(patient_id)
        .bind(&short_pid)
        .execute(&pool)
        .await
        .unwrap();
    configure_patient_label_profile(&pool, patient_id).await;

    let (status, catalog_body) = json_request(
        &app,
        "GET",
        "/api/v1/documents/templates",
        &admin_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(
        catalog_body["templates"]
            .as_array()
            .unwrap()
            .iter()
            .any(|item| item["id"] == "patient_sticker_standard")
    );

    let (status, body) = json_request(
        &app,
        "POST",
        "/api/v1/documents/generate",
        &admin_bearer,
        Some(json!({
            "template_id": "patient_sticker_standard",
            "patient_id": patient_id,
            "language": "de",
            "bindings": {
                "kt1": "SZ",
                "kt2": "BG",
                "cost_code": "FRA"
            }
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let document_id = Uuid::parse_str(body["id"].as_str().unwrap()).unwrap();
    let preview_html = body["preview_html"].as_str().unwrap();
    // The sticker now mirrors the reference label: ID line, "Lastname, Firstname",
    // "geb. am", KT1/KT2 cost-bearer labels and the agency block — the non-reference
    // format eyebrow, Versicherer (insurance) and Land (country) lines were removed.
    assert!(preview_html.contains("ID:"));
    assert!(preview_html.contains("geb. am"));
    assert!(preview_html.contains("KT1: SZ"));
    assert!(preview_html.contains("KT2: BG"));
    assert!(preview_html.contains("FRA"));
    assert!(preview_html.contains("Agency Street 1"));
    assert!(preview_html.contains("PT-"));

    let (status, detail_body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/documents/{document_id}"),
        &admin_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(detail_body["art"], "patient_sticker");
    assert_eq!(detail_body["category"], "administrative");
    assert_eq!(detail_body["mime_type"], "application/pdf");
    assert_eq!(detail_body["visibility"], "internal");
    assert_eq!(detail_body["data_sensitivity"], "Patient Identity");

    let (status, bytes) = bytes_request(
        &app,
        "GET",
        &format!("/api/v1/documents/{document_id}/download"),
        &admin_bearer,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(bytes.starts_with(b"%PDF-"));
    assert!(bytes.len() > 500);
    let pdf_text = extract_pdf_text(&bytes);
    assert!(pdf_text.contains("ID:"));
    assert!(pdf_text.contains("PT-"));
    assert!(pdf_text.contains(&short_pid));
    assert!(pdf_text.contains("KT1: SZ"));
    assert!(pdf_text.contains("KT2: BG"));
    assert!(pdf_text.contains("FRA"));
    assert!(pdf_text.contains("Agency Street 1"));
}

#[tokio::test]
async fn document_templates_can_generate_visa_invitation_pdf_document() {
    let Some((app, pool, admin_id, admin_bearer)) = test_context().await else {
        return;
    };
    let tag = unique_tag("doc-visa");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let provider_id = seed_provider(&pool, &tag).await;
    let doctor_id = seed_doctor(&pool, provider_id, &tag).await;
    let appointment_id =
        seed_appointment(&pool, patient_id, provider_id, doctor_id, admin_id, &tag).await;

    sqlx::query(
        r#"UPDATE patients
           SET nationality = 'Ukraine',
               residence_country = 'Germany'
           WHERE id = $1"#,
    )
    .bind(patient_id)
    .execute(&pool)
    .await
    .unwrap();

    let (status, catalog_body) = json_request(
        &app,
        "GET",
        "/api/v1/documents/templates",
        &admin_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(
        catalog_body["templates"]
            .as_array()
            .unwrap()
            .iter()
            .any(|item| item["id"] == "visa_invitation_letter")
    );

    let (status, body) = json_request(
        &app,
        "POST",
        "/api/v1/documents/generate",
        &admin_bearer,
        Some(json!({
            "template_id": "visa_invitation_letter",
            "patient_id": patient_id,
            "appointment_id": appointment_id,
            "language": "de",
            "introduction": "Dieses Einladungsschreiben wird für den Konsulatstermin benötigt.",
            "closing_note": "Bitte dem Visumantrag als ergänzende medizinische Unterlage beilegen.",
            "bindings": {
                "passport_number": "MA1234567",
                "passport_valid_until": "2050-01-01",
                "recipient_block": "An das Generalkonsulat\nVisastelle",
                "clinics": [
                    {"name": "Klinik München", "address": "Musterstr. 1, München"}
                ],
                "contact_phones": "0176 9999999",
                "sign_place": "München",
                "sign_date": "2025-11-19"
            }
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let document_id = Uuid::parse_str(body["id"].as_str().unwrap()).unwrap();
    let preview_html = body["preview_html"].as_str().unwrap();
    assert!(preview_html.contains("Einladungsschreiben (Visum)"));
    assert!(preview_html.contains("Ukraine"));
    assert!(preview_html.contains("Germany"));
    assert!(preview_html.contains("Reisepass Nr.: MA1234567"));
    assert!(preview_html.contains("Klinik München"));
    assert!(preview_html.contains("0176 9999999"));
    assert!(
        preview_html.contains("Dieses Schreiben dient zur Vorlage bei Botschaft oder Konsulat")
    );

    let (status, detail_body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/documents/{document_id}"),
        &admin_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(detail_body["art"], "visa_invitation");
    assert_eq!(detail_body["mime_type"], "application/pdf");
    assert_eq!(detail_body["visibility"], "patient_visible");

    let (status, bytes) = bytes_request(
        &app,
        "GET",
        &format!("/api/v1/documents/{document_id}/download"),
        &admin_bearer,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(bytes.starts_with(b"%PDF-"));
    assert!(bytes.len() > 1000);
    let pdf_text = extract_pdf_text(&bytes);
    assert!(pdf_text.contains("An das Generalkonsulat"));
    assert!(pdf_text.contains("Visastelle"));
    assert!(pdf_text.contains("München, 19.11.2025"));
    assert!(pdf_text.contains("Reisepass Nr.: MA1234567"));
    assert!(pdf_text.contains("gültig bis 01.01.2050"));
    assert!(pdf_text.contains("Klinik München"));
    assert!(pdf_text.contains("0176 9999999"));

    let (status, extraction_body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/documents/{document_id}/text-extraction"),
        &admin_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(extraction_body["status"], "completed");
    assert_eq!(extraction_body["method"], "pdf_text");
    let extracted_text = extraction_body["extracted_text"]
        .as_str()
        .unwrap_or_default();
    assert!(
        extracted_text.contains("MA1234567"),
        "visa passport number must be available for edit prefill; got: {extracted_text:?}"
    );
    assert!(
        extracted_text.contains("01.01.2050"),
        "visa passport validity must be available for edit prefill; got: {extracted_text:?}"
    );
}

#[tokio::test]
async fn confirmed_appointment_auto_sends_only_flagged_provider_template_once_to_patient_portal() {
    let Some((app, pool, admin_id, admin_bearer)) = test_context().await else {
        return;
    };

    let tag = unique_tag("provider-template-auto-send");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let patient_user_id = seed_user(&pool, &tag, "patient").await;
    seed_patient_assignment(&pool, patient_id, patient_user_id, admin_id).await;

    let provider_id = seed_provider(&pool, &tag).await;
    let doctor_id = seed_doctor(&pool, provider_id, &tag).await;
    let appointment_id =
        seed_appointment(&pool, patient_id, provider_id, doctor_id, admin_id, &tag).await;
    let order_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO orders (order_number, patient_id, phase, status, created_by)
           VALUES ($1, $2, 'execution', 'active', $3)
           RETURNING id"#,
    )
    .bind(format!("ORD-{tag}"))
    .bind(patient_id)
    .bind(admin_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    sqlx::query("UPDATE appointments SET order_id = $2 WHERE id = $1")
        .bind(appointment_id)
        .bind(order_id)
        .execute(&pool)
        .await
        .unwrap();
    let appointment_ctx = sqlx::query(
        r#"SELECT order_id, provider_id, doctor_id, appointment_type, status
           FROM appointments
           WHERE id = $1"#,
    )
    .bind(appointment_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        appointment_ctx
            .try_get::<Option<Uuid>, _>("order_id")
            .unwrap(),
        Some(order_id)
    );
    assert_eq!(
        appointment_ctx
            .try_get::<Option<Uuid>, _>("provider_id")
            .unwrap(),
        Some(provider_id)
    );
    assert_eq!(
        appointment_ctx
            .try_get::<Option<Uuid>, _>("doctor_id")
            .unwrap(),
        Some(doctor_id)
    );
    assert_eq!(
        appointment_ctx
            .try_get::<String, _>("appointment_type")
            .unwrap(),
        "medical"
    );

    for (label, auto_send) in [("Auto prep enabled", true), ("Auto prep disabled", false)] {
        let (status, body) = json_request(
            &app,
            "POST",
            &format!("/api/v1/providers/{provider_id}/templates"),
            &admin_bearer,
            Some(json!({
                "label": format!("{label} {tag}"),
                "description": "Preparation instructions",
                "doctor_id": doctor_id,
                "art": "prep_instruction",
                "category": "partner_clinic",
                "default_auto_name": format!("{label} {tag}"),
                "default_status": "active",
                "default_visibility": "patient_visible",
                "is_medical": true,
                "is_active": true,
                "auto_send_on_confirmed_appointment": auto_send,
                "supported_languages": ["de"],
                "body_de": format!("Hallo {{patient_name}}, bitte erscheinen Sie zu {{appointment_title}} am {{appointment_date}}.")
            })),
        )
        .await;
        assert_eq!(status, StatusCode::CREATED, "template create body: {body}");
    }

    let auto_send_templates: i64 = sqlx::query_scalar(
        r#"SELECT count(*)::bigint
           FROM provider_templates
           WHERE provider_id = $1
             AND auto_send_on_confirmed_appointment = true"#,
    )
    .bind(provider_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(auto_send_templates, 1);
    let matching_auto_send_templates: i64 = sqlx::query_scalar(
        r#"SELECT count(*)::bigint
           FROM provider_templates
           WHERE provider_id = $1
             AND is_active = true
             AND auto_send_on_confirmed_appointment = true
             AND (doctor_id IS NULL OR doctor_id = $2)"#,
    )
    .bind(provider_id)
    .bind(doctor_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(matching_auto_send_templates, 1);

    let confirm_path = format!("/api/v1/appointments/{appointment_id}/status");
    let ((first_status, first_body), (second_status, second_body)) = tokio::join!(
        json_request(
            &app,
            "POST",
            &confirm_path,
            &admin_bearer,
            Some(json!({ "status": "confirmed" })),
        ),
        json_request(
            &app,
            "POST",
            &confirm_path,
            &admin_bearer,
            Some(json!({ "status": "confirmed" })),
        ),
    );
    for (status, body) in [
        (first_status, first_body.clone()),
        (second_status, second_body.clone()),
    ] {
        assert_eq!(status, StatusCode::OK, "status body: {body}");
        assert_eq!(
            body["auto_preparation_documents"]["templates_matched"], 1,
            "status body: {body}"
        );
        assert_eq!(
            body["auto_preparation_documents"]["error_count"], 0,
            "status body: {body}"
        );
    }

    let auto_documents = sqlx::query(
        r#"SELECT id, visibility, ursprung
           FROM documents
           WHERE appointment_id = $1
             AND ursprung LIKE 'auto_preparation:%'
           ORDER BY created_at"#,
    )
    .bind(appointment_id)
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(
        auto_documents.len(),
        1,
        "expected exactly one flagged template delivery"
    );
    let document_id = auto_documents[0].try_get::<Uuid, _>("id").unwrap();
    assert_eq!(
        auto_documents[0]
            .try_get::<String, _>("visibility")
            .unwrap(),
        "patient_visible"
    );

    let share_count: i64 = sqlx::query_scalar(
        r#"SELECT count(*)::bigint
           FROM document_shares
           WHERE document_id = $1
             AND revoked_at IS NULL"#,
    )
    .bind(document_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(share_count, 1);

    let delivery_count: i64 = sqlx::query_scalar(
        r#"SELECT count(*)::bigint
           FROM appointment_provider_template_deliveries
           WHERE appointment_id = $1
             AND delivery_status = 'delivered'"#,
    )
    .bind(appointment_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(delivery_count, 1);

    let patient_bearer = auth_header_for(patient_user_id, "patient");
    let (status, portal_body) =
        json_request(&app, "GET", "/api/v1/me/documents", &patient_bearer, None).await;
    assert_eq!(status, StatusCode::OK);
    let items = portal_body.as_array().unwrap();
    assert_eq!(items.len(), 1);
    assert_eq!(items[0]["id"], document_id.to_string());

    let (status, body) = json_request(
        &app,
        "POST",
        &confirm_path,
        &admin_bearer,
        Some(json!({ "status": "confirmed" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "repeat confirm body: {body}");

    let document_count_after_repeat: i64 = sqlx::query_scalar(
        r#"SELECT count(*)::bigint
           FROM documents
           WHERE appointment_id = $1
             AND ursprung LIKE 'auto_preparation:%'
             AND status <> 'archived'"#,
    )
    .bind(appointment_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(document_count_after_repeat, 1);

    let share_count_after_repeat: i64 = sqlx::query_scalar(
        r#"SELECT count(*)::bigint
           FROM document_shares
           WHERE document_id = $1
             AND revoked_at IS NULL"#,
    )
    .bind(document_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(share_count_after_repeat, 1);
}

#[tokio::test]
async fn document_json_reports_no_active_patient_portal_user_and_release_conflicts() {
    let Some((app, pool, admin_id, admin_bearer)) = test_context().await else {
        return;
    };

    let tag = unique_tag("doc-portal-no-user");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let provider_id = seed_provider(&pool, &tag).await;
    let doctor_id = seed_doctor(&pool, provider_id, &tag).await;
    let appointment_id =
        seed_appointment(&pool, patient_id, provider_id, doctor_id, admin_id, &tag).await;
    let document_id = seed_document(
        &pool,
        admin_id,
        patient_id,
        appointment_id,
        "released_internal",
        true,
        "arztbrief",
        &tag,
    )
    .await;
    let document_id = document_id.to_string();

    let (status, list_body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/documents?patient_id={patient_id}"),
        &admin_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let list_item = list_body
        .as_array()
        .unwrap()
        .iter()
        .find(|item| item["id"].as_str() == Some(document_id.as_str()))
        .unwrap();
    assert_eq!(list_item["has_active_patient_portal_user"], false);

    let (status, detail_body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/documents/{document_id}"),
        &admin_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(detail_body["has_active_patient_portal_user"], false);

    let (status, release_body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/documents/{document_id}/portal-release"),
        &admin_bearer,
        Some(json!({
            "channel": "patient_portal",
            "requires_confirmation": true
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(
        release_body["message"],
        "No active patient portal user is linked to this patient"
    );

    let (status, refreshed_detail_body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/documents/{document_id}"),
        &admin_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(refreshed_detail_body["visibility"], "released_internal");
    assert_eq!(
        refreshed_detail_body["has_active_patient_portal_user"],
        false
    );
}

#[tokio::test]
async fn document_can_be_released_to_patient_portal_and_confirmed_from_me_workspace() {
    let Some((app, pool, admin_id, admin_bearer)) = test_context().await else {
        return;
    };

    let tag = unique_tag("doc-portal");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let patient_user_id = seed_user(&pool, &tag, "patient").await;
    seed_patient_assignment(&pool, patient_id, patient_user_id, admin_id).await;

    let provider_id = seed_provider(&pool, &tag).await;
    let doctor_id = seed_doctor(&pool, provider_id, &tag).await;
    let appointment_id =
        seed_appointment(&pool, patient_id, provider_id, doctor_id, admin_id, &tag).await;

    let (status, upload_body) = multipart_upload(
        &app,
        "/api/v1/documents/upload",
        &admin_bearer,
        &[
            ("patient_id", patient_id.to_string()),
            ("appointment_id", appointment_id.to_string()),
            ("auto_name", format!("Portal packet {tag}")),
            ("art", "arztbrief".to_string()),
            ("category", "medical".to_string()),
            ("status", "active".to_string()),
            ("visibility", "released_internal".to_string()),
            ("is_medical", "true".to_string()),
        ],
        "portal-packet.pdf",
        "application/pdf",
        b"%PDF-patient-portal%",
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let document_id = upload_body["id"].as_str().unwrap().to_string();

    let (status, staff_list_body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/documents?patient_id={patient_id}"),
        &admin_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let staff_list_item = staff_list_body
        .as_array()
        .unwrap()
        .iter()
        .find(|item| item["id"].as_str() == Some(document_id.as_str()))
        .unwrap();
    assert_eq!(staff_list_item["has_active_patient_portal_user"], true);

    let (status, detail_body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/documents/{document_id}"),
        &admin_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(detail_body["has_active_patient_portal_user"], true);

    let (status, release_body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/documents/{document_id}/portal-release"),
        &admin_bearer,
        Some(json!({
            "channel": "patient_portal",
            "requires_confirmation": true
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(release_body["visibility"], "patient_visible");
    assert_eq!(release_body["created_share_count"], 1);

    let patient_bearer = auth_header_for(patient_user_id, "patient");

    let (status, list_body) =
        json_request(&app, "GET", "/api/v1/me/documents", &patient_bearer, None).await;
    assert_eq!(status, StatusCode::OK);
    let items = list_body.as_array().unwrap();
    assert_eq!(items.len(), 1);
    assert_eq!(items[0]["id"], document_id);
    assert_eq!(items[0]["requires_confirmation"], true);
    assert_eq!(items[0]["confirmed"], false);

    let (status, confirm_body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/me/documents/{document_id}/confirm"),
        &patient_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(confirm_body["confirmed"], true);

    let (status, refreshed_body) =
        json_request(&app, "GET", "/api/v1/me/documents", &patient_bearer, None).await;
    assert_eq!(status, StatusCode::OK);
    let items = refreshed_body.as_array().unwrap();
    assert_eq!(items.len(), 1);
    assert_eq!(items[0]["confirmed"], true);

    let (status, bytes) = bytes_request(
        &app,
        "GET",
        &format!("/api/v1/me/documents/{document_id}/download"),
        &patient_bearer,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(String::from_utf8_lossy(&bytes).contains("%PDF-patient-portal%"));
}

#[tokio::test]
async fn revoking_patient_portal_release_hides_document_from_me_workspace() {
    let Some((app, pool, admin_id, admin_bearer)) = test_context().await else {
        return;
    };

    let tag = unique_tag("doc-portal-revoke");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let patient_user_id = seed_user(&pool, &tag, "patient").await;
    seed_patient_assignment(&pool, patient_id, patient_user_id, admin_id).await;

    let provider_id = seed_provider(&pool, &tag).await;
    let doctor_id = seed_doctor(&pool, provider_id, &tag).await;
    let appointment_id =
        seed_appointment(&pool, patient_id, provider_id, doctor_id, admin_id, &tag).await;

    let (status, upload_body) = multipart_upload(
        &app,
        "/api/v1/documents/upload",
        &admin_bearer,
        &[
            ("patient_id", patient_id.to_string()),
            ("appointment_id", appointment_id.to_string()),
            ("auto_name", format!("Portal revoke {tag}")),
            ("art", "arztbrief".to_string()),
            ("category", "medical".to_string()),
            ("status", "active".to_string()),
            ("visibility", "released_internal".to_string()),
            ("is_medical", "true".to_string()),
        ],
        "portal-revoke.pdf",
        "application/pdf",
        b"%PDF-patient-revoke%",
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let document_id = upload_body["id"].as_str().unwrap().to_string();

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/documents/{document_id}/portal-release"),
        &admin_bearer,
        Some(json!({
            "channel": "patient_portal",
            "requires_confirmation": false
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let patient_bearer = auth_header_for(patient_user_id, "patient");
    let (status, list_body) =
        json_request(&app, "GET", "/api/v1/me/documents", &patient_bearer, None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(list_body.as_array().unwrap().len(), 1);

    let (status, revoke_body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/documents/{document_id}/portal-release/revoke"),
        &admin_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(revoke_body["revoked_share_count"], 1);

    let (status, refreshed_body) =
        json_request(&app, "GET", "/api/v1/me/documents", &patient_bearer, None).await;
    assert_eq!(status, StatusCode::OK);
    assert!(refreshed_body.as_array().unwrap().is_empty());

    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/me/documents/{document_id}/download"),
        &patient_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(body["message"], "Document not found");
}

#[tokio::test]
async fn deleting_document_file_revokes_shares_and_removes_stored_file() {
    let Some((app, pool, admin_id, admin_bearer)) = test_context().await else {
        return;
    };

    let tag = unique_tag("doc-delete-file");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let patient_user_id = seed_user(&pool, &tag, "patient").await;
    let patient_manager_user_id = seed_user(&pool, &tag, "patient_manager").await;
    seed_patient_assignment(&pool, patient_id, patient_user_id, admin_id).await;

    let provider_id = seed_provider(&pool, &tag).await;
    let doctor_id = seed_doctor(&pool, provider_id, &tag).await;
    let appointment_id =
        seed_appointment(&pool, patient_id, provider_id, doctor_id, admin_id, &tag).await;

    let (status, upload_body) = multipart_upload(
        &app,
        "/api/v1/documents/upload",
        &admin_bearer,
        &[
            ("patient_id", patient_id.to_string()),
            ("appointment_id", appointment_id.to_string()),
            ("auto_name", format!("Delete file {tag}")),
            ("art", "arztbrief".to_string()),
            ("category", "medical".to_string()),
            ("status", "active".to_string()),
            ("visibility", "released_internal".to_string()),
            ("is_medical", "true".to_string()),
        ],
        "delete-file.pdf",
        "application/pdf",
        b"%PDF-delete-file%",
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let document_id = Uuid::parse_str(upload_body["id"].as_str().unwrap()).unwrap();

    let storage_key: String = sqlx::query_scalar("SELECT storage_key FROM documents WHERE id = $1")
        .bind(document_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    let stored_path = FsPath::new("uploads/documents").join(&storage_key);
    assert!(stored_path.exists());

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/documents/{document_id}/shares"),
        &admin_bearer,
        Some(json!({
            "shared_with_user_id": patient_manager_user_id,
            "channel": "email",
            "requires_confirmation": true
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/documents/{document_id}/portal-release"),
        &admin_bearer,
        Some(json!({
            "channel": "patient_portal",
            "requires_confirmation": false
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let patient_bearer = auth_header_for(patient_user_id, "patient");
    let (status, patient_list_body) =
        json_request(&app, "GET", "/api/v1/me/documents", &patient_bearer, None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(patient_list_body.as_array().unwrap().len(), 1);

    let delete_reason = "Uploaded wrong binary";
    let (status, delete_body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/documents/{document_id}/delete"),
        &admin_bearer,
        Some(json!({
            "reason": delete_reason
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(delete_body["revoked_share_count"], 2);
    assert_eq!(delete_body["file_removed_from_disk"], true);
    assert_eq!(delete_body["document"]["status"], "archived");
    assert_eq!(delete_body["document"]["visibility"], "internal");
    assert_eq!(delete_body["document"]["has_stored_file"], false);
    assert_eq!(delete_body["document"]["file_delete_reason"], delete_reason);
    assert!(delete_body["document"]["file_deleted_at"].is_string());

    let deleted_row = sqlx::query(
        r#"SELECT storage_key, status, visibility, file_deleted_at, file_delete_reason
           FROM documents
           WHERE id = $1"#,
    )
    .bind(document_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        deleted_row
            .try_get::<Option<String>, _>("storage_key")
            .unwrap_or_default(),
        None
    );
    assert_eq!(
        deleted_row.try_get::<String, _>("status").unwrap(),
        "archived"
    );
    assert_eq!(
        deleted_row.try_get::<String, _>("visibility").unwrap(),
        "internal"
    );
    assert!(
        deleted_row
            .try_get::<Option<chrono::DateTime<chrono::Utc>>, _>("file_deleted_at")
            .unwrap()
            .is_some()
    );
    assert_eq!(
        deleted_row
            .try_get::<Option<String>, _>("file_delete_reason")
            .unwrap()
            .unwrap(),
        delete_reason
    );
    assert!(!stored_path.exists());

    let (status, shares_body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/documents/{document_id}/shares"),
        &admin_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let shares = shares_body.as_array().unwrap();
    assert_eq!(shares.len(), 2);
    assert!(shares.iter().all(|item| item["revoked_at"].is_string()));

    let (status, download_body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/documents/{document_id}/download"),
        &admin_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::GONE);
    assert_eq!(download_body["message"], "Document file was deleted");

    let (status, refreshed_patient_list) =
        json_request(&app, "GET", "/api/v1/me/documents", &patient_bearer, None).await;
    assert_eq!(status, StatusCode::OK);
    assert!(refreshed_patient_list.as_array().unwrap().is_empty());
}

#[tokio::test]
async fn mark_document_signed_records_evidence_and_satisfies_compliance() {
    let Some((app, pool, admin_id, admin_bearer)) = test_context().await else {
        return;
    };
    let tag = unique_tag("doc-sign");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;

    // Upload a consent document for the patient.
    let (status, upload) = multipart_upload(
        &app,
        "/api/v1/documents/upload",
        &admin_bearer,
        &[
            ("patient_id", patient_id.to_string()),
            ("status", "active".to_string()),
            ("visibility", "internal".to_string()),
            ("auto_name", format!("DSGVO {tag}")),
            ("art", "consent".to_string()),
        ],
        &format!("dsgvo-{tag}.pdf"),
        "application/pdf",
        b"%PDF-consent%",
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{upload}");
    let document_id = upload["id"].as_str().unwrap().to_string();

    // Record it as the signed DSGVO evidence.
    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/documents/{document_id}/mark-signed"),
        &admin_bearer,
        Some(json!({ "compliance_kind": "dsgvo" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["compliance_updated"], true);
    assert_eq!(body["compliance_kind"], "dsgvo");

    // Signature evidence is recorded on the document.
    let doc_uuid = Uuid::parse_str(&document_id).unwrap();
    let (kind, signed_by): (Option<String>, Option<Uuid>) = sqlx::query_as(
        "SELECT compliance_kind, signed_by FROM documents WHERE id = $1 AND signed_at IS NOT NULL",
    )
    .bind(doc_uuid)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(kind.as_deref(), Some("dsgvo"));
    assert_eq!(signed_by, Some(admin_id));

    // The compliance flag was flipped atomically on the patient.
    let dsgvo_signed: Option<bool> = sqlx::query_scalar(
        "SELECT (legal_status->>'dsgvo_signed')::bool FROM patients WHERE id = $1",
    )
    .bind(patient_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(dsgvo_signed, Some(true));

    // An unknown compliance kind is rejected.
    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/documents/{document_id}/mark-signed"),
        &admin_bearer,
        Some(json!({ "compliance_kind": "nonsense" })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
}

#[tokio::test]
async fn lead_document_upload_and_signature_do_not_create_patient() {
    let Some((app, pool, admin_id, _admin_bearer)) = test_context().await else {
        return;
    };
    let tag = unique_tag("lead-document");
    let pm_id = seed_user(&pool, &tag, "patient_manager").await;
    let pm_bearer = auth_header_for(pm_id, "patient_manager");
    let lead_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO leads (first_name, last_name, email, created_by)
           VALUES ($1, $2, $3, $4)
           RETURNING id"#,
    )
    .bind(format!("First {tag}"))
    .bind(format!("Last {tag}"))
    .bind(format!("{tag}@example.com"))
    .bind(admin_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    let patient_count_before: i64 = sqlx::query_scalar("SELECT count(*) FROM patients")
        .fetch_one(&pool)
        .await
        .unwrap();

    let file_bytes = b"%PDF-lead-consent%";
    let (upload_status, upload) = multipart_upload(
        &app,
        "/api/v1/documents/upload",
        &pm_bearer,
        &[
            ("lead_id", lead_id.to_string()),
            ("status", "active".to_string()),
            ("visibility", "internal".to_string()),
            ("auto_name", format!("DSGVO {tag}")),
            ("art", "consent".to_string()),
            ("category", "compliance".to_string()),
        ],
        &format!("dsgvo-{tag}.pdf"),
        "application/pdf",
        file_bytes,
    )
    .await;
    assert_eq!(upload_status, StatusCode::OK, "upload body: {upload}");
    assert_eq!(upload["lead_id"], lead_id.to_string());
    assert!(upload["patient_id"].is_null());
    let document_id = Uuid::parse_str(upload["id"].as_str().unwrap()).unwrap();

    let (list_status, list) = json_request(
        &app,
        "GET",
        &format!("/api/v1/documents?lead_id={lead_id}"),
        &pm_bearer,
        None,
    )
    .await;
    assert_eq!(list_status, StatusCode::OK, "list body: {list}");
    let item = list
        .as_array()
        .unwrap()
        .iter()
        .find(|item| item["id"] == document_id.to_string())
        .expect("lead document in filtered list");
    assert_eq!(item["lead_id"], lead_id.to_string());
    assert!(item["patient_id"].is_null());
    assert!(item["lead_name"].as_str().unwrap().contains(&tag));

    let (download_status, downloaded) = bytes_request(
        &app,
        "GET",
        &format!("/api/v1/documents/{document_id}/download"),
        &pm_bearer,
    )
    .await;
    assert_eq!(download_status, StatusCode::OK);
    assert_eq!(downloaded, file_bytes);

    let (signed_status, signed) = json_request(
        &app,
        "POST",
        &format!("/api/v1/documents/{document_id}/mark-signed"),
        &pm_bearer,
        Some(json!({ "compliance_kind": "dsgvo" })),
    )
    .await;
    assert_eq!(signed_status, StatusCode::OK, "signed body: {signed}");
    assert_eq!(signed["lead_id"], lead_id.to_string());
    assert_eq!(signed["compliance_updated"], true);

    let compliance_status: String =
        sqlx::query_scalar("SELECT compliance_status FROM leads WHERE id = $1")
            .bind(lead_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(compliance_status, "signed");
    let patient_count_after: i64 = sqlx::query_scalar("SELECT count(*) FROM patients")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(patient_count_after, patient_count_before);
}

#[tokio::test]
async fn patient_manager_cannot_mark_unassigned_document_signed() {
    let Some((app, pool, admin_id, admin_bearer)) = test_context().await else {
        return;
    };
    let tag = unique_tag("doc-sign-access");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let pm_id = seed_user(&pool, &tag, "patient_manager").await;
    let pm_bearer = auth_header_for(pm_id, "patient_manager");

    let (status, upload) = multipart_upload(
        &app,
        "/api/v1/documents/upload",
        &admin_bearer,
        &[
            ("patient_id", patient_id.to_string()),
            ("status", "active".to_string()),
            ("visibility", "internal".to_string()),
            ("auto_name", format!("DSGVO {tag}")),
            ("art", "consent".to_string()),
        ],
        &format!("dsgvo-{tag}.pdf"),
        "application/pdf",
        b"%PDF-consent%",
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{upload}");
    let document_id = upload["id"].as_str().unwrap().to_string();

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/documents/{document_id}/mark-signed"),
        &pm_bearer,
        Some(json!({ "compliance_kind": "dsgvo" })),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN, "{body}");

    let doc_uuid = Uuid::parse_str(&document_id).unwrap();
    let signed_by: Option<Uuid> =
        sqlx::query_scalar("SELECT signed_by FROM documents WHERE id = $1")
            .bind(doc_uuid)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(signed_by, None);

    let dsgvo_signed: Option<bool> = sqlx::query_scalar(
        "SELECT (legal_status->>'dsgvo_signed')::bool FROM patients WHERE id = $1",
    )
    .bind(patient_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(dsgvo_signed, None);
}
