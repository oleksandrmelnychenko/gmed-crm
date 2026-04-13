use axum::body::Body;
use axum::http::{Request, StatusCode};
use serde_json::{Value, json};
use sqlx::PgPool;
use tower::ServiceExt;
use uuid::Uuid;

use gmed_server::auth::jwt;
use gmed_server::settings::{SettingsCache, TokenSettings};
use gmed_server::state::AppState;

const TEST_SECRET: &str = "test-secret-at-least-32-characters-long!!";
const TINY_TRANSPARENT_PNG: &[u8] = &[
    137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0,
    0, 0, 31, 21, 196, 137, 0, 0, 0, 13, 73, 68, 65, 84, 8, 29, 99, 248, 255, 255, 255, 127, 0, 9,
    251, 3, 253, 5, 67, 69, 202, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130,
];

async fn test_context() -> Option<(axum::Router, PgPool, Uuid, String)> {
    let db_url = std::env::var("DATABASE_URL").ok()?;
    let pool = gmed_db::create_pool(&db_url).await.ok()?;
    gmed_db::run_migrations(&pool).await.ok()?;

    let admin_id: Uuid = sqlx::query_scalar("SELECT id FROM users WHERE email = $1")
        .bind("admin@gmed.de")
        .fetch_one(&pool)
        .await
        .ok()?;

    let state = AppState::new(
        pool.clone(),
        TEST_SECRET,
        SettingsCache::new(TokenSettings::default()),
    );
    let app = gmed_server::build_app(state);
    let token = jwt::issue_access_token(TEST_SECRET, admin_id, "ceo", Uuid::new_v4()).ok()?;
    Some((app, pool, admin_id, format!("Bearer {token}")))
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
            ("auto_name", format!("Scan import {tag}")),
            ("ursprung", "scan_import".to_string()),
            ("status", "active".to_string()),
            ("visibility", "internal".to_string()),
        ],
        &format!("scan-import-{tag}.bin"),
        "application/octet-stream",
        b"raw-scan-import",
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
            "requested_language": "en",
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
    assert_eq!(status, StatusCode::OK);
    assert_eq!(create_body["requested_language"], "en");
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
            "translated_text": "Patient summary in English."
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
            "requested_language": "en",
            "note": "Prepare a patient-safe translation."
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let request_id = create_body["id"].as_str().unwrap().to_string();

    let (status, update_body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/documents/translation-requests/{request_id}/update"),
        &admin_bearer,
        Some(json!({
            "status": "completed",
            "source_language": "de",
            "source_text": "Hallo Welt",
            "translated_text": "Hello world",
            "note": "Ready for patient delivery."
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(update_body["status"], "completed");
    assert_eq!(update_body["source_language"], "de");
    assert_eq!(update_body["source_text"], "Hallo Welt");
    assert_eq!(update_body["translated_text"], "Hello world");
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
    assert_eq!(list_body[0]["translated_text"], "Hello world");
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
        "active",
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
        "active",
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
            .any(|item| item["role"] == "ceo_assistant")
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
    assert!(preview_html.contains("Untersuchungs-/Behandlungsplan"));
    assert!(preview_html.contains("Bitte beachten Sie die unten aufgeführten Termine."));
    assert!(preview_html.contains("Bitte nüchtern bleiben"));

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
}

#[tokio::test]
async fn document_templates_default_to_patient_language_when_omitted() {
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
    assert_eq!(body["language"], "uk");
    let preview_html = body["preview_html"].as_str().unwrap();
    assert!(preview_html.contains("План обстеження та лікування"));
    assert!(preview_html.contains("залишайтеся натще"));
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
        "Ramipril 5",
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
    assert!(preview_html.contains("Medikamentenplan"));
    assert!(preview_html.contains("Ramipril 5"));
    assert!(preview_html.contains("Metformin 500"));
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
            "text_block_keys": ["contract_scope_clause", "quote_reference_clause"]
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
    assert!(preview_html.contains("Payment model"));

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
}

#[tokio::test]
async fn document_templates_can_generate_patient_sticker_pdf_document() {
    let Some((app, pool, admin_id, admin_bearer)) = test_context().await else {
        return;
    };
    let tag = unique_tag("doc-sticker");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
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
            "language": "de"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let document_id = Uuid::parse_str(body["id"].as_str().unwrap()).unwrap();
    let preview_html = body["preview_html"].as_str().unwrap();
    assert!(preview_html.contains("Standard 105 x 74 mm"));
    assert!(preview_html.contains("AOK Rheinland"));
    assert!(preview_html.contains("Agency Street 1"));
    assert!(preview_html.contains("UA"));
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
    assert_eq!(detail_body["mime_type"], "application/pdf");
    assert_eq!(detail_body["visibility"], "internal");

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
