//! Import of agency document templates on the documents page (owner request
//! 2026-11-10): import → variable check → preview → activation → generation,
//! with the role, file-type and audit rules.

mod support;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use serde_json::{Value, json};
use sqlx::PgPool;
use tower::ServiceExt;
use uuid::Uuid;

use gmed_server::auth::jwt;

const TEST_SECRET: &str = "test-secret-at-least-32-characters-long!!";
const BASE: &str = "/api/v1/documents/template-imports";

async fn request(
    app: &axum::Router,
    method: &str,
    path: &str,
    bearer: &str,
    body: Option<Value>,
) -> (StatusCode, Vec<u8>) {
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
    let bytes = axum::body::to_bytes(response.into_body(), 8 * 1024 * 1024)
        .await
        .unwrap()
        .to_vec();
    (status, bytes)
}

async fn json_request(
    app: &axum::Router,
    method: &str,
    path: &str,
    bearer: &str,
    body: Option<Value>,
) -> (StatusCode, Value) {
    let (status, bytes) = request(app, method, path, bearer, body).await;
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(json!(null)),
    )
}

async fn import(
    app: &axum::Router,
    bearer: &str,
    text_fields: &[(&str, &str)],
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

    let request = Request::builder()
        .method("POST")
        .uri(BASE)
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

fn auth_header_for(user_id: Uuid, role: &str) -> String {
    let token = jwt::issue_access_token(TEST_SECRET, user_id, role, Uuid::new_v4()).unwrap();
    format!("Bearer {token}")
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
           VALUES ($1, $2, $3, '1990-03-07', 'diverse', $4, ARRAY['de','en']::text[])
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

async fn audit_actions(pool: &PgPool, template_id: &str) -> Vec<String> {
    sqlx::query_scalar(
        r#"SELECT action FROM audit_log
           WHERE entity_type = 'agency_document_template' AND entity_id = $1
           ORDER BY id"#,
    )
    .bind(Uuid::parse_str(template_id).unwrap())
    .fetch_all(pool)
    .await
    .unwrap()
}

#[tokio::test]
async fn imported_template_is_checked_previewed_activated_and_generated() {
    let Some(ctx) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let (app, pool) = (ctx.app, ctx.pool);
    let tag = format!("tpl-{}", Uuid::new_v4().simple());
    let pm_id = seed_user(&pool, &tag, "patient_manager").await;
    let pm = auth_header_for(pm_id, "patient_manager");
    // Only the CEO manages templates (owner decision 2026-11-10); the patient
    // manager generates from the active ones.
    let ceo = auth_header_for(seed_user(&pool, &tag, "ceo").await, "ceo");
    let patient_id = seed_patient(&pool, pm_id, &tag).await;
    sqlx::query(
        "INSERT INTO patient_assignments (patient_id, user_id, assigned_by) VALUES ($1, $2, $2)",
    )
    .bind(patient_id)
    .bind(pm_id)
    .execute(&pool)
    .await
    .unwrap();

    // Import: a draft with the variable check.
    let label = format!("Bescheinigung {tag}");
    let (status, body) = import(
        &app,
        &ceo,
        &[("label", label.as_str()), ("language", "de")],
        "bescheinigung.txt",
        "text/plain",
        "Bescheinigung für {{patient_name}}, geboren am {{birth_date}}.\n\nNummer: {{patient_nr}}\n"
            .as_bytes(),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "import body: {body}");
    let template = &body["template"];
    let template_id = template["id"].as_str().unwrap().to_string();
    let public_id = template["public_id"].as_str().unwrap().to_string();
    assert_eq!(public_id, format!("agency_template:{template_id}"));
    assert_eq!(template["status"], "draft");
    assert_eq!(template["version_number"], 1);
    assert_eq!(template["unknown_variables"], json!(["{{patient_nr}}"]));
    assert_eq!(
        template["used_variables"],
        json!(["patient_name", "birth_date"])
    );
    assert_eq!(template["can_activate"], false);
    assert!(
        template["preview_text"]
            .as_str()
            .unwrap()
            .contains("Max Mustermann, geboren am 01.02.1980")
    );

    // A draft is not offered for generation, and one with an unknown
    // variable cannot be activated.
    let (_, catalog) = json_request(&app, "GET", "/api/v1/documents/templates", &pm, None).await;
    assert!(
        !catalog["templates"]
            .as_array()
            .unwrap()
            .iter()
            .any(|entry| entry["id"] == public_id.as_str())
    );
    let (status, body) = json_request(
        &app,
        "POST",
        &format!("{BASE}/{template_id}/activate"),
        &ceo,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "activate body: {body}");
    assert_eq!(body["error"], "template_variables_invalid");
    let (status, _) = json_request(
        &app,
        "POST",
        "/api/v1/documents/generate",
        &pm,
        Some(json!({ "template_id": public_id, "patient_id": patient_id })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);

    // The draft is corrected in place.
    let (status, body) = json_request(
        &app,
        "POST",
        &format!("{BASE}/{template_id}/update"),
        &ceo,
        Some(json!({
            "body": "Bescheinigung für {{patient_name}}, geboren am {{birth_date}}.\n\nNummer: {{patient_id}}"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "update body: {body}");
    assert_eq!(body["template"]["can_activate"], true);
    assert_eq!(body["template"]["unknown_variables"], json!([]));

    // Preview: a PDF with sample data.
    let (status, pdf) = request(
        &app,
        "GET",
        &format!("{BASE}/{template_id}/preview"),
        &ceo,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(pdf.starts_with(b"%PDF"));

    // Activation offers it in "generate from template".
    let (status, body) = json_request(
        &app,
        "POST",
        &format!("{BASE}/{template_id}/activate"),
        &ceo,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "activate body: {body}");
    assert_eq!(body["template"]["status"], "active");
    let (_, catalog) = json_request(&app, "GET", "/api/v1/documents/templates", &pm, None).await;
    let entry = catalog["templates"]
        .as_array()
        .unwrap()
        .iter()
        .find(|entry| entry["id"] == public_id.as_str())
        .expect("active template in the catalog")
        .clone();
    assert_eq!(entry["template_kind"], "agency");
    assert_eq!(entry["label"], label.as_str());

    // An active version is never edited.
    let (status, _) = json_request(
        &app,
        "POST",
        &format!("{BASE}/{template_id}/update"),
        &ceo,
        Some(json!({ "body": "Anderer Text" })),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);

    // Generation fills the patient's data and names the template version.
    let (status, generated) = json_request(
        &app,
        "POST",
        "/api/v1/documents/generate",
        &pm,
        Some(json!({ "template_id": public_id, "patient_id": patient_id })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "generate body: {generated}");
    let document_id = Uuid::parse_str(generated["id"].as_str().unwrap()).unwrap();
    let (ursprung, manual_text, auto_name): (String, String, String) = sqlx::query_as(
        "SELECT ursprung, generated_manual_text, auto_name FROM documents WHERE id = $1",
    )
    .bind(document_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(ursprung, format!("template:{public_id}"));
    assert_eq!(
        manual_text,
        format!(
            "Bescheinigung für First {tag} Last {tag}, geboren am 07.03.1990.\n\nNummer: PT-{tag}"
        )
    );
    assert!(auto_name.starts_with(&label), "auto name: {auto_name}");

    // A re-import is a new version; activating it retires the old one, and
    // the generated document keeps its text.
    let family_id = body["template"]["family_id"].as_str().unwrap().to_string();
    let (status, body) = import(
        &app,
        &ceo,
        &[("language", "de"), ("family_id", family_id.as_str())],
        "bescheinigung-v2.txt",
        "text/plain",
        b"Neue Fassung f\xC3\xBCr {{patient_name}}.",
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "re-import body: {body}");
    let second_id = body["template"]["id"].as_str().unwrap().to_string();
    assert_eq!(body["template"]["version_number"], 2);
    assert_eq!(body["template"]["label"], label.as_str());
    let (status, body) = json_request(
        &app,
        "POST",
        &format!("{BASE}/{second_id}/activate"),
        &ceo,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "activate v2 body: {body}");
    assert_eq!(body["replaced_template_ids"], json!([template_id]));
    let first_status: String =
        sqlx::query_scalar("SELECT status FROM agency_document_templates WHERE id = $1")
            .bind(Uuid::parse_str(&template_id).unwrap())
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(first_status, "disabled");
    let unchanged: String =
        sqlx::query_scalar("SELECT generated_manual_text FROM documents WHERE id = $1")
            .bind(document_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(unchanged, manual_text);

    // Disabling takes it out of the catalog.
    let (status, _) = json_request(
        &app,
        "POST",
        &format!("{BASE}/{second_id}/disable"),
        &ceo,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let (_, catalog) = json_request(&app, "GET", "/api/v1/documents/templates", &pm, None).await;
    assert!(
        !catalog["templates"]
            .as_array()
            .unwrap()
            .iter()
            .any(|entry| entry["template_kind"] == "agency" && entry["label"] == label.as_str())
    );

    // Every step is in the audit log.
    assert_eq!(
        audit_actions(&pool, &template_id).await,
        vec![
            "document_template_imported",
            "document_template_updated",
            "document_template_activated",
        ]
    );
    assert_eq!(
        audit_actions(&pool, &second_id).await,
        vec![
            "document_template_imported",
            "document_template_activated",
            "document_template_disabled",
        ]
    );
}

#[tokio::test]
async fn template_import_checks_roles_and_file_types() {
    let Some(ctx) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let (app, pool) = (ctx.app, ctx.pool);
    let tag = format!("tpl-acl-{}", Uuid::new_v4().simple());
    let ceo_id = seed_user(&pool, &tag, "ceo").await;
    let ceo = auth_header_for(ceo_id, "ceo");

    // Only the CEO manages templates (owner decision 2026-11-10).
    for role in [
        "patient_manager",
        "concierge",
        "billing",
        "sales",
        "ceo_assistant",
        "interpreter",
    ] {
        let user_id = seed_user(&pool, &tag, role).await;
        let bearer = auth_header_for(user_id, role);
        let (status, _) = json_request(&app, "GET", BASE, &bearer, None).await;
        assert_eq!(status, StatusCode::FORBIDDEN, "list as {role}");
        let (status, _) = import(
            &app,
            &bearer,
            &[("language", "de")],
            "vorlage.txt",
            "text/plain",
            b"Text {{today}}",
        )
        .await;
        assert_eq!(status, StatusCode::FORBIDDEN, "import as {role}");
    }

    // The content has to be a Word or a text file.
    for (name, mime, bytes) in [
        ("vorlage.pdf", "application/pdf", &b"%PDF-1.7 x"[..]),
        (
            "vorlage.docx",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            &b"%PDF-1.7 renamed"[..],
        ),
        ("vorlage.txt", "text/plain", &b"%PDF-1.7 renamed"[..]),
        ("vorlage.html", "text/html", &b"<html></html>"[..]),
    ] {
        let (status, body) = import(&app, &ceo, &[("language", "de")], name, mime, bytes).await;
        assert_eq!(
            status,
            StatusCode::UNSUPPORTED_MEDIA_TYPE,
            "{name} body: {body}"
        );
    }
    let (status, _) = import(
        &app,
        &ceo,
        &[("language", "fr")],
        "vorlage.txt",
        "text/plain",
        b"Text",
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);

    // Nothing of the refused imports was stored.
    let stored: i64 =
        sqlx::query_scalar("SELECT count(*) FROM agency_document_templates WHERE created_by = $1")
            .bind(ceo_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(stored, 0);
}

fn word_file(document_xml: &str) -> Vec<u8> {
    use std::io::Write;
    let mut archive = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);
    archive.start_file("[Content_Types].xml", options).unwrap();
    archive.write_all(b"<Types/>").unwrap();
    archive.start_file("word/document.xml", options).unwrap();
    archive.write_all(document_xml.as_bytes()).unwrap();
    archive.finish().unwrap().into_inner()
}

/// A Word template keeps its file: the document is printed from it (owner
/// decision 2026-11-10), so its text is changed in Word, not in the CRM.
#[tokio::test]
async fn word_template_keeps_its_file_and_is_generated_from_it() {
    let Some(ctx) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let (app, pool) = (ctx.app, ctx.pool);
    let tag = format!("tpl-word-{}", Uuid::new_v4().simple());
    let ceo_id = seed_user(&pool, &tag, "ceo").await;
    let ceo = auth_header_for(ceo_id, "ceo");
    let patient_id = seed_patient(&pool, ceo_id, &tag).await;

    let file = word_file(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="36"/></w:rPr><w:t>Bescheinigung</w:t></w:r></w:p>
    <w:p><w:r><w:t xml:space="preserve">für {{patient_</w:t></w:r><w:r><w:t>name}}</w:t></w:r></w:p>
    <w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>
  </w:body>
</w:document>"#,
    );
    let label = format!("Bescheinigung {tag}");
    let (status, body) = import(
        &app,
        &ceo,
        &[("label", label.as_str()), ("language", "de")],
        "bescheinigung.docx",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        &file,
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "import body: {body}");
    let template = &body["template"];
    let template_id = template["id"].as_str().unwrap().to_string();
    let public_id = template["public_id"].as_str().unwrap().to_string();
    assert_eq!(template["exact_layout"], true);
    assert_eq!(template["can_activate"], true);
    assert_eq!(template["used_variables"], json!(["patient_name"]));
    let stored: Vec<u8> =
        sqlx::query_scalar("SELECT source_docx FROM agency_document_templates WHERE id = $1")
            .bind(Uuid::parse_str(&template_id).unwrap())
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(stored, file);

    // Its name may change; its text is the file.
    let (status, _) = json_request(
        &app,
        "POST",
        &format!("{BASE}/{template_id}/update"),
        &ceo,
        Some(json!({ "label": format!("{label} neu") })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let (status, _) = json_request(
        &app,
        "POST",
        &format!("{BASE}/{template_id}/update"),
        &ceo,
        Some(json!({ "body": "Getippter Text" })),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);

    let (status, pdf) = request(
        &app,
        "GET",
        &format!("{BASE}/{template_id}/preview"),
        &ceo,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(pdf.starts_with(b"%PDF"));

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("{BASE}/{template_id}/activate"),
        &ceo,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "activate body: {body}");
    let (status, generated) = json_request(
        &app,
        "POST",
        "/api/v1/documents/generate",
        &ceo,
        // A text typed into the dialog never replaces a Word template.
        Some(json!({
            "template_id": public_id,
            "patient_id": patient_id,
            "manual_text": "Text of another template"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "generate body: {generated}");
    let (ursprung, manual_text): (String, String) =
        sqlx::query_as("SELECT ursprung, generated_manual_text FROM documents WHERE id = $1")
            .bind(Uuid::parse_str(generated["id"].as_str().unwrap()).unwrap())
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(ursprung, format!("template:{public_id}"));
    assert_eq!(
        manual_text,
        format!("# Bescheinigung\nfür First {tag} Last {tag}")
    );

    // A file that is not a Word document is refused, whatever its name.
    let (status, _) = import(
        &app,
        &ceo,
        &[("language", "de")],
        "kaputt.docx",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        &word_file("<w:document><w:body><w:p>").as_slice()[..40],
    )
    .await;
    assert_ne!(status, StatusCode::CREATED);
}

/// An imported template is generated for a lead that is not a patient yet
/// (owner request 2026-11-11), with the lead's own data; a typed free
/// document stays for patients.
#[tokio::test]
async fn imported_template_is_generated_for_a_lead() {
    let Some(ctx) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let (app, pool) = (ctx.app, ctx.pool);
    let tag = format!("tpl-lead-{}", Uuid::new_v4().simple());
    let ceo_id = seed_user(&pool, &tag, "ceo").await;
    let ceo = auth_header_for(ceo_id, "ceo");
    let lead_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO leads (first_name, last_name, date_of_birth, email, city, created_by)
           VALUES ($1, $2, '1985-12-24', $3, 'Wien', $4)
           RETURNING id"#,
    )
    .bind(format!("Lead {tag}"))
    .bind("Beispiel")
    .bind(format!("{tag}@example.com"))
    .bind(ceo_id)
    .fetch_one(&pool)
    .await
    .unwrap();

    let (status, body) = import(
        &app,
        &ceo,
        &[("label", "Anschreiben"), ("language", "de")],
        "anschreiben.txt",
        "text/plain",
        "Guten Tag {{patient_name}}, geboren am {{birth_date}}, aus {{patient_city}} ({{lead_number}}/{{patient_id}})."
            .as_bytes(),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "import body: {body}");
    let template_id = body["template"]["id"].as_str().unwrap().to_string();
    let public_id = body["template"]["public_id"].as_str().unwrap().to_string();
    let (status, _) = json_request(
        &app,
        "POST",
        &format!("{BASE}/{template_id}/activate"),
        &ceo,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (status, generated) = json_request(
        &app,
        "POST",
        "/api/v1/documents/generate",
        &ceo,
        Some(json!({ "template_id": public_id, "lead_id": lead_id })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "generate body: {generated}");
    let (document_lead, patient, manual_text): (Option<Uuid>, Option<Uuid>, String) =
        sqlx::query_as(
            "SELECT lead_id, patient_id, generated_manual_text FROM documents WHERE id = $1",
        )
        .bind(Uuid::parse_str(generated["id"].as_str().unwrap()).unwrap())
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(document_lead, Some(lead_id));
    assert_eq!(patient, None);
    let lead_number = format!("LEAD-{}", lead_id.simple().to_string()[..8].to_uppercase());
    assert_eq!(
        manual_text,
        // The request number has its own field; a lead has no patient number.
        format!("Guten Tag Lead {tag} Beispiel, geboren am 24.12.1985, aus Wien ({lead_number}/).")
    );

    // Typing a free document for a lead is still refused, also when the
    // request names an imported template as its source.
    let (status, _) = json_request(
        &app,
        "POST",
        "/api/v1/documents/generate",
        &ceo,
        Some(json!({
            "template_id": "free_text_document",
            "lead_id": lead_id,
            "manual_text": "Freier Text",
            "ursprung": format!("template:{public_id}")
        })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
}
