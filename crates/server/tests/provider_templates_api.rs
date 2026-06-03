mod support;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use chrono::NaiveDate;
use serde_json::{Value, json};
use sqlx::PgPool;
use sqlx::Row;
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
    let request = Request::builder()
        .method(method)
        .uri(path)
        .header("Authorization", bearer)
        .header("Content-Type", "application/json")
        .body(match body {
            Some(value) => Body::from(serde_json::to_vec(&value).unwrap()),
            None => Body::empty(),
        })
        .unwrap();

    let response = app.clone().oneshot(request).await.unwrap();
    let status = response.status();
    let bytes = axum::body::to_bytes(response.into_body(), 4 * 1024 * 1024)
        .await
        .unwrap();
    let payload = serde_json::from_slice(&bytes).unwrap_or(json!(null));
    (status, payload)
}

async fn bytes_request(
    app: &axum::Router,
    method: &str,
    path: &str,
    bearer: &str,
) -> (StatusCode, Vec<u8>) {
    let request = Request::builder()
        .method(method)
        .uri(path)
        .header("Authorization", bearer)
        .body(Body::empty())
        .unwrap();

    let response = app.clone().oneshot(request).await.unwrap();
    let status = response.status();
    let bytes = axum::body::to_bytes(response.into_body(), 4 * 1024 * 1024)
        .await
        .unwrap()
        .to_vec();
    (status, bytes)
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
        r#"INSERT INTO patients (patient_id, first_name, last_name, birth_date, gender, created_by, languages)
           VALUES ($1, $2, $3, '1990-01-01', 'diverse', $4, ARRAY['de','en']::text[])
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

async fn seed_provider(pool: &PgPool, tag: &str) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO providers (name, provider_type, address_city, fachbereich, address_country)
           VALUES ($1, 'medical', $2, 'Gastroenterology', 'Germany')
           RETURNING id"#,
    )
    .bind(format!("Clinic {tag}"))
    .bind(format!("City {tag}"))
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn seed_doctor(pool: &PgPool, provider_id: Uuid, tag: &str) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO provider_doctors (provider_id, name, fachbereich)
           VALUES ($1, $2, 'Gastroenterology')
           RETURNING id"#,
    )
    .bind(provider_id)
    .bind(format!("Dr {tag}"))
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn seed_order(pool: &PgPool, patient_id: Uuid, created_by: Uuid, tag: &str) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO orders (
                order_number, patient_id, phase, status, needs_description, created_by
           ) VALUES (
                $1, $2, 'execution', 'active', 'provider-template test order', $3
           ) RETURNING id"#,
    )
    .bind(format!("ORD-{tag}"))
    .bind(patient_id)
    .bind(created_by)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn seed_appointment(
    pool: &PgPool,
    patient_id: Uuid,
    provider_id: Uuid,
    doctor_id: Uuid,
    order_id: Uuid,
    created_by: Uuid,
    tag: &str,
) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO appointments (
                patient_id, provider_id, doctor_id, order_id, appointment_type,
                title, date, time_start, time_end, location, status, created_by
           ) VALUES (
                $1, $2, $3, $4, 'medical',
                $5, $6, '09:00', '10:00', 'Provider clinic room 3', 'confirmed', $7
           ) RETURNING id"#,
    )
    .bind(patient_id)
    .bind(provider_id)
    .bind(doctor_id)
    .bind(order_id)
    .bind(format!("Clinic visit {tag}"))
    .bind(NaiveDate::from_ymd_opt(2026, 5, 10).unwrap())
    .bind(created_by)
    .fetch_one(pool)
    .await
    .unwrap()
}

#[tokio::test]
async fn patient_manager_can_store_and_update_provider_templates_via_provider_detail() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("provider-template-detail");
    let pm_id = seed_user(&pool, &format!("{tag}-pm"), "patient_manager").await;
    let bearer = auth_header_for(pm_id, "patient_manager");
    let provider_id = seed_provider(&pool, &tag).await;
    let doctor_id = seed_doctor(&pool, provider_id, &tag).await;

    let (create_status, create_body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/providers/{provider_id}/templates"),
        &bearer,
        Some(json!({
            "label": "Colonoscopy preparation",
            "description": "Default prep instructions for this clinic.",
            "doctor_id": doctor_id,
            "art": "prep_instruction",
            "category": "partner_clinic",
            "default_auto_name": "Colonoscopy prep",
            "default_status": "draft",
            "default_visibility": "patient_visible",
            "is_medical": true,
            "supported_languages": ["de"],
            "body_de": "Hallo {{patient_name}}, bitte erscheinen Sie am {{appointment_date}}.",
            "notes": "Internal clinic note"
        })),
    )
    .await;
    assert_eq!(
        create_status,
        StatusCode::CREATED,
        "create body: {create_body}"
    );
    let template_id = create_body["id"].as_str().unwrap().to_string();

    let (detail_status, detail_body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/providers/{provider_id}"),
        &bearer,
        None,
    )
    .await;
    assert_eq!(detail_status, StatusCode::OK, "detail body: {detail_body}");
    let templates = detail_body["templates"]
        .as_array()
        .expect("templates array");
    let template = templates
        .iter()
        .find(|item| item["id"] == template_id)
        .expect("created template visible in provider detail");
    assert_eq!(template["label"], "Colonoscopy preparation");
    assert_eq!(template["doctor_id"], doctor_id.to_string());
    assert_eq!(template["art"], "prep_instruction");
    assert_eq!(template["category"], "partner_clinic");
    assert_eq!(
        template["supported_languages"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|value| value.as_str())
            .collect::<Vec<_>>(),
        vec!["de"]
    );

    let (invalid_status, invalid_body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/providers/{provider_id}/templates/{template_id}/update"),
        &bearer,
        Some(json!({
            "label": "Colonoscopy preparation updated",
            "doctor_id": doctor_id,
            "art": "prep_instruction",
            "category": "partner_clinic",
            "default_auto_name": "Clinic prep updated",
            "default_status": "active",
            "default_visibility": "released_external",
            "is_medical": true,
            "supported_languages": ["de", "uk"],
            "body_de": "Hallo {{patient_name}}, neues Datum {{appointment_date}}.",
            "body_uk": "Вітаємо {{patient_name}}, нова дата {{appointment_date}}."
        })),
    )
    .await;
    assert_eq!(invalid_status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(
        invalid_body["message"],
        "Provider document templates currently support German only"
    );

    let (update_status, update_body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/providers/{provider_id}/templates/{template_id}/update"),
        &bearer,
        Some(json!({
            "label": "Colonoscopy preparation updated",
            "description": "Updated instructions",
            "doctor_id": doctor_id,
            "art": "prep_instruction",
            "category": "partner_clinic",
            "default_auto_name": "Clinic prep updated",
            "default_status": "active",
            "default_visibility": "released_external",
            "is_medical": true,
            "is_active": false,
            "supported_languages": ["de"],
            "body_de": "Hallo {{patient_name}}, neues Datum {{appointment_date}}.",
            "notes": "Updated note"
        })),
    )
    .await;
    assert_eq!(update_status, StatusCode::OK, "update body: {update_body}");

    let (list_status, list_body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/providers/{provider_id}/templates"),
        &bearer,
        None,
    )
    .await;
    assert_eq!(list_status, StatusCode::OK, "list body: {list_body}");
    let templates = list_body.as_array().expect("provider template list");
    let updated = templates
        .iter()
        .find(|item| item["id"] == template_id)
        .expect("updated template in list");
    assert_eq!(updated["label"], "Colonoscopy preparation updated");
    assert_eq!(updated["default_status"], "active");
    assert_eq!(updated["default_visibility"], "released_external");
    assert_eq!(updated["is_active"], false);
    assert_eq!(updated["supported_languages"], json!(["de"]));
    assert_eq!(updated["body_uk"], Value::Null);

    let _ = admin_id;
}

#[tokio::test]
async fn documents_catalog_includes_provider_templates_and_generation_uses_provider_context() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("provider-template-generate");
    let pm_id = seed_user(&pool, &format!("{tag}-pm"), "patient_manager").await;
    let bearer = auth_header_for(pm_id, "patient_manager");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let provider_id = seed_provider(&pool, &tag).await;
    let doctor_id = seed_doctor(&pool, provider_id, &tag).await;
    let order_id = seed_order(&pool, patient_id, admin_id, &tag).await;
    let appointment_id = seed_appointment(
        &pool,
        patient_id,
        provider_id,
        doctor_id,
        order_id,
        admin_id,
        &tag,
    )
    .await;

    let (create_status, create_body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/providers/{provider_id}/templates"),
        &bearer,
        Some(json!({
            "label": "Gastro prep",
            "description": "Partner clinic handoff",
            "doctor_id": doctor_id,
            "art": "prep_instruction",
            "category": "partner_clinic",
            "default_auto_name": "Gastro prep",
            "default_status": "draft",
            "default_visibility": "patient_visible",
            "is_medical": true,
            "supported_languages": ["de"],
            "body_de": "Hallo {{patient_name}}, bitte kommen Sie zu {{provider_name}} am {{appointment_date}} um {{appointment_time}}. Arzt: {{doctor_name}}. Auftrag: {{order_number}}."
        })),
    )
    .await;
    assert_eq!(
        create_status,
        StatusCode::CREATED,
        "create body: {create_body}"
    );
    let template_uuid = create_body["id"].as_str().unwrap().to_string();

    let (catalog_status, catalog_body) =
        json_request(&app, "GET", "/api/v1/documents/templates", &bearer, None).await;
    assert_eq!(
        catalog_status,
        StatusCode::OK,
        "catalog body: {catalog_body}"
    );
    let templates = catalog_body["templates"]
        .as_array()
        .expect("templates array");
    let template = templates
        .iter()
        .find(|item| item["provider_id"] == provider_id.to_string())
        .expect("provider template present in catalog");
    let public_template_id = template["id"].as_str().unwrap().to_string();
    assert!(
        public_template_id.starts_with("provider_template:"),
        "unexpected provider template id: {public_template_id}"
    );
    assert!(public_template_id.contains(&template_uuid));
    assert_eq!(template["template_kind"], "provider");
    assert_eq!(template["provider_name"], format!("Clinic {tag}"));
    assert_eq!(template["doctor_id"], doctor_id.to_string());

    let (unsupported_language_status, unsupported_language_body) = json_request(
        &app,
        "POST",
        "/api/v1/documents/generate",
        &bearer,
        Some(json!({
            "template_id": public_template_id,
            "patient_id": patient_id,
            "order_id": order_id,
            "appointment_id": appointment_id,
            "language": "uk",
            "auto_name": format!("Clinic prep unsupported language {tag}")
        })),
    )
    .await;
    assert_eq!(
        unsupported_language_status,
        StatusCode::UNPROCESSABLE_ENTITY,
        "unsupported language body: {unsupported_language_body}"
    );
    assert_eq!(
        unsupported_language_body["message"],
        "Language is not supported by the selected template"
    );

    let (generate_status, generate_body) = json_request(
        &app,
        "POST",
        "/api/v1/documents/generate",
        &bearer,
        Some(json!({
            "template_id": public_template_id,
            "patient_id": patient_id,
            "order_id": order_id,
            "appointment_id": appointment_id,
            "language": "de",
            "auto_name": format!("Clinic prep {tag}")
        })),
    )
    .await;
    assert_eq!(
        generate_status,
        StatusCode::OK,
        "generate body: {generate_body}"
    );
    let preview_html = generate_body["preview_html"]
        .as_str()
        .expect("preview html");
    assert!(preview_html.contains(&format!("Clinic {tag}")));
    assert!(preview_html.contains(&format!("Dr {tag}")));
    assert!(preview_html.contains("2026-05-10"));
    assert!(preview_html.contains("09:00"));
    assert!(preview_html.contains("ORD-"));
    assert_eq!(generate_body["language"], "de");
    assert_eq!(generate_body["generated_template_id"], public_template_id);
    assert_eq!(generate_body["version_number"], 1);

    let document_id = Uuid::parse_str(generate_body["id"].as_str().unwrap()).unwrap();
    let stored = sqlx::query(
        r#"SELECT klinik, art, category, ursprung, generated_template_id,
                  mime_type, status, version_root_document_id, replaces_document_id, version_number
           FROM documents
           WHERE id = $1"#,
    )
    .bind(document_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    let clinic_name = format!("Clinic {tag}");
    assert_eq!(
        stored
            .try_get::<Option<String>, _>("klinik")
            .unwrap()
            .as_deref(),
        Some(clinic_name.as_str())
    );
    assert_eq!(
        stored.try_get::<String, _>("art").unwrap(),
        "prep_instruction"
    );
    assert_eq!(
        stored
            .try_get::<Option<String>, _>("category")
            .unwrap()
            .as_deref(),
        Some("partner_clinic")
    );
    assert_eq!(
        stored.try_get::<String, _>("mime_type").unwrap(),
        "application/pdf"
    );
    assert_eq!(
        stored
            .try_get::<Option<String>, _>("generated_template_id")
            .unwrap()
            .as_deref(),
        Some(public_template_id.as_str())
    );
    assert_eq!(stored.try_get::<String, _>("status").unwrap(), "draft");
    assert_eq!(
        stored
            .try_get::<Uuid, _>("version_root_document_id")
            .unwrap(),
        document_id
    );
    assert_eq!(
        stored
            .try_get::<Option<Uuid>, _>("replaces_document_id")
            .unwrap(),
        None
    );
    assert_eq!(stored.try_get::<i32, _>("version_number").unwrap(), 1);
    assert!(
        stored
            .try_get::<Option<String>, _>("ursprung")
            .unwrap()
            .unwrap_or_default()
            .contains("provider_template:"),
        "expected provider template source marker"
    );

    let (download_status, pdf_bytes) = bytes_request(
        &app,
        "GET",
        &format!("/api/v1/documents/{document_id}/download"),
        &bearer,
    )
    .await;
    assert_eq!(download_status, StatusCode::OK);
    assert!(pdf_bytes.starts_with(b"%PDF-"));
    assert!(pdf_bytes.len() > 1_000);
    let pdf_text = pdf_extract::extract_text_from_mem(&pdf_bytes).unwrap();
    assert!(pdf_text.contains(&format!("Clinic {tag}")));
    assert!(pdf_text.contains(&format!("Dr {tag}")));
    assert!(pdf_text.contains("Hallo"));
    assert!(pdf_text.contains("ORD-"));

    let (second_create_status, second_create_body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/providers/{provider_id}/templates"),
        &bearer,
        Some(json!({
            "label": "Gastro prep alternate",
            "description": "Partner clinic handoff alternate",
            "doctor_id": doctor_id,
            "art": "prep_instruction",
            "category": "partner_clinic",
            "default_auto_name": "Gastro prep alternate",
            "default_status": "draft",
            "default_visibility": "patient_visible",
            "is_medical": true,
            "supported_languages": ["de"],
            "body_de": "Hallo {{patient_name}}, dies ist eine alternative Vorlage."
        })),
    )
    .await;
    assert_eq!(
        second_create_status,
        StatusCode::CREATED,
        "second create body: {second_create_body}"
    );
    let second_public_template_id = format!(
        "provider_template:{}",
        second_create_body["id"].as_str().unwrap()
    );

    let (wrong_replace_status, wrong_replace_body) = json_request(
        &app,
        "POST",
        "/api/v1/documents/generate",
        &bearer,
        Some(json!({
            "template_id": second_public_template_id,
            "patient_id": patient_id,
            "order_id": order_id,
            "appointment_id": appointment_id,
            "language": "de",
            "replace_document_id": document_id,
            "auto_name": format!("Clinic prep wrong replacement {tag}")
        })),
    )
    .await;
    assert_eq!(
        wrong_replace_status,
        StatusCode::UNPROCESSABLE_ENTITY,
        "wrong replacement body: {wrong_replace_body}"
    );
    assert_eq!(
        wrong_replace_body["message"],
        "Replacement document must be the same generated template type"
    );

    let (replace_status, replace_body) = json_request(
        &app,
        "POST",
        "/api/v1/documents/generate",
        &bearer,
        Some(json!({
            "template_id": public_template_id,
            "patient_id": patient_id,
            "order_id": order_id,
            "appointment_id": appointment_id,
            "language": "de",
            "replace_document_id": document_id,
            "auto_name": format!("Clinic prep replacement {tag}")
        })),
    )
    .await;
    assert_eq!(
        replace_status,
        StatusCode::OK,
        "replace body: {replace_body}"
    );
    assert_eq!(replace_body["generated_template_id"], public_template_id);
    assert_eq!(replace_body["version_number"], 2);
    assert_eq!(
        replace_body["version_root_document_id"],
        document_id.to_string()
    );
    assert_eq!(
        replace_body["replaces_document_id"],
        document_id.to_string()
    );

    let replacement_id = Uuid::parse_str(replace_body["id"].as_str().unwrap()).unwrap();
    let old_status: String = sqlx::query_scalar("SELECT status FROM documents WHERE id = $1")
        .bind(document_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(old_status, "archived");
    let replacement = sqlx::query(
        r#"SELECT generated_template_id, version_root_document_id, replaces_document_id, version_number
           FROM documents
           WHERE id = $1"#,
    )
    .bind(replacement_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        replacement
            .try_get::<Option<String>, _>("generated_template_id")
            .unwrap()
            .as_deref(),
        Some(public_template_id.as_str())
    );
    assert_eq!(
        replacement
            .try_get::<Uuid, _>("version_root_document_id")
            .unwrap(),
        document_id
    );
    assert_eq!(
        replacement
            .try_get::<Option<Uuid>, _>("replaces_document_id")
            .unwrap(),
        Some(document_id)
    );
    assert_eq!(replacement.try_get::<i32, _>("version_number").unwrap(), 2);
}
