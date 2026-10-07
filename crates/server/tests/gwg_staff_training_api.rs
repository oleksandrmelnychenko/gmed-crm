//! GwG instruction and reliability of the staff (§ 6 Abs. 2 GwG) in "SOP und
//! Lernen": records, the generated sheet in the personnel file, the signed
//! scan, the employee's own view and who may do what. Synthetic data only.

mod support;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use serde_json::{Value, json};
use sqlx::PgPool;
use tower::ServiceExt;
use uuid::Uuid;

use gmed_server::auth::jwt;

const TEST_SECRET: &str = "test-secret-at-least-32-characters-long!!";
const PDF: &[u8] = b"%PDF-1.7\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n";

fn bearer(user_id: Uuid, role: &str) -> String {
    let token = jwt::issue_access_token(TEST_SECRET, user_id, role, Uuid::new_v4()).unwrap();
    format!("Bearer {token}")
}

async fn send_raw(
    app: &axum::Router,
    method: &str,
    path: &str,
    auth: &str,
    body: Option<Value>,
) -> (StatusCode, Vec<u8>) {
    let request = Request::builder()
        .method(method)
        .uri(path)
        .header("Authorization", auth)
        .header("Content-Type", "application/json")
        .body(match body {
            Some(value) => Body::from(serde_json::to_vec(&value).unwrap()),
            None => Body::empty(),
        })
        .unwrap();
    let response = app.clone().oneshot(request).await.unwrap();
    let status = response.status();
    let bytes = axum::body::to_bytes(response.into_body(), 64 * 1024 * 1024)
        .await
        .unwrap()
        .to_vec();
    (status, bytes)
}

async fn send(
    app: &axum::Router,
    method: &str,
    path: &str,
    auth: &str,
    body: Option<Value>,
) -> (StatusCode, Value) {
    let (status, bytes) = send_raw(app, method, path, auth, body).await;
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(json!(null)),
    )
}

async fn upload(
    app: &axum::Router,
    path: &str,
    auth: &str,
    file_name: &str,
    mime: &str,
    bytes: &[u8],
) -> (StatusCode, Value) {
    let boundary = format!("----gwg-{}", Uuid::new_v4().simple());
    let mut body = Vec::new();
    body.extend_from_slice(format!("--{boundary}\r\n").as_bytes());
    body.extend_from_slice(
        format!(
            "Content-Disposition: form-data; name=\"file\"; filename=\"{file_name}\"\r\nContent-Type: {mime}\r\n\r\n"
        )
        .as_bytes(),
    );
    body.extend_from_slice(bytes);
    body.extend_from_slice(b"\r\n");
    body.extend_from_slice(format!("--{boundary}--\r\n").as_bytes());
    let request = Request::builder()
        .method("POST")
        .uri(path)
        .header("Authorization", auth)
        .header(
            "Content-Type",
            format!("multipart/form-data; boundary={boundary}"),
        )
        .body(Body::from(body))
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

async fn seed_user(pool: &PgPool, role: &str, name: &str) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO users (email, password_hash, name, role)
           VALUES ($1, 'test-password-hash', $2, $3) RETURNING id"#,
    )
    .bind(format!("gwg-{}@example.com", Uuid::new_v4().simple()))
    .bind(name)
    .bind(role)
    .fetch_one(pool)
    .await
    .unwrap()
}

fn str_of<'a>(value: &'a Value, key: &str) -> &'a str {
    value[key]
        .as_str()
        .unwrap_or_else(|| panic!("{key} in {value}"))
}

fn employee_row<'a>(overview: &'a Value, employee_id: &str) -> &'a Value {
    overview["employees"]
        .as_array()
        .unwrap()
        .iter()
        .find(|row| row["employee_id"] == employee_id)
        .unwrap_or_else(|| panic!("employee {employee_id} in {overview}"))
}

#[tokio::test]
async fn the_ceo_documents_an_instruction_and_files_the_signed_sheet_in_the_personnel_file() {
    let Some(ctx) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let ceo_id = seed_user(&ctx.pool, "ceo", "Ben Beispiel").await;
    let ceo = bearer(ceo_id, "ceo");
    let interpreter_id = seed_user(&ctx.pool, "interpreter", "Anna Muster").await;
    let pm_id = seed_user(&ctx.pool, "patient_manager", "Mia Muster").await;

    let (status, employee) = send(
        &ctx.app,
        "POST",
        "/api/v1/personnel/employees",
        &ceo,
        Some(json!({
            "salutation": "frau",
            "first_name": "Anna",
            "last_name": "Muster",
            "employment_start": "2019-03-01",
            "user_id": interpreter_id.to_string(),
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{employee}");
    let employee_id = str_of(&employee, "id").to_string();
    // A former employee is not listed.
    let (status, former) = send(
        &ctx.app,
        "POST",
        "/api/v1/personnel/employees",
        &ceo,
        Some(json!({
            "first_name": "Ben",
            "last_name": "Ehemalig",
            "employment_start": "2015-01-01",
            "employment_end": "2020-12-31",
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{former}");

    // Never instructed: listed, due, prefilled from the role.
    let (status, overview) = send(&ctx.app, "GET", "/api/v1/sops/gwg-training", &ceo, None).await;
    assert_eq!(status, StatusCode::OK, "{overview}");
    assert_eq!(overview["management_name"], "Ben Beispiel");
    assert_eq!(overview["due_after_months"], 12);
    assert_eq!(overview["instructions"].as_array().unwrap().len(), 6);
    let row = employee_row(&overview, &employee_id);
    assert_eq!(row["status"], "none");
    assert_eq!(row["due"], true);
    assert_eq!(row["default_position"], "Dolmetscher/in");
    assert_eq!(row["default_department"], "Dolmetscherdienst");
    assert!(
        !overview["employees"]
            .as_array()
            .unwrap()
            .iter()
            .any(|row| row["employee_id"] == former["id"]),
        "former employees are not listed"
    );

    // Other roles neither see nor create records.
    for (user_id, role) in [(pm_id, "patient_manager"), (interpreter_id, "interpreter")] {
        let token = bearer(user_id, role);
        let (status, _) = send(&ctx.app, "GET", "/api/v1/sops/gwg-training", &token, None).await;
        assert_eq!(status, StatusCode::FORBIDDEN, "{role} lists");
        let (status, _) = send(
            &ctx.app,
            "POST",
            "/api/v1/sops/gwg-training",
            &token,
            Some(json!({ "employee_id": employee_id })),
        )
        .await;
        assert_eq!(status, StatusCode::FORBIDDEN, "{role} creates");
    }

    // Invalid records are refused before anything is archived.
    let today = chrono::Utc::now().date_naive();
    let valid = json!({
        "employee_id": employee_id,
        "instructed_on": today.format("%Y-%m-%d").to_string(),
        "position": "Dolmetscher/in",
        "department": "Dolmetscherdienst",
        "delivered_by": "internal",
        "form_oral": true,
        "form_material": true,
        "reliability": "long_standing",
    });
    for (patch, case) in [
        (json!({ "delivered_by": "other" }), "other without a name"),
        (
            json!({ "form_oral": false, "form_material": false }),
            "no form",
        ),
        (
            json!({ "instructions": ["cash_limit"] }),
            "unknown instruction",
        ),
        (
            json!({ "reliability": "new_employee" }),
            "new employee without a check",
        ),
        (json!({ "instructed_on": "2099-01-01" }), "future date"),
    ] {
        let mut body = valid.clone();
        for (key, value) in patch.as_object().unwrap() {
            body[key] = value.clone();
        }
        let (status, value) = send(
            &ctx.app,
            "POST",
            "/api/v1/sops/gwg-training",
            &ceo,
            Some(body),
        )
        .await;
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{case}: {value}");
    }
    let mut unknown = valid.clone();
    unknown["employee_id"] = json!(Uuid::new_v4());
    let (status, _) = send(
        &ctx.app,
        "POST",
        "/api/v1/sops/gwg-training",
        &ceo,
        Some(unknown),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let archived: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM personnel_documents WHERE category = 'gwg_unterweisung'",
    )
    .fetch_one(&ctx.pool)
    .await
    .unwrap();
    assert_eq!(archived, 0);

    // Saving creates the record with all six instructions and archives the sheet.
    let (status, record) = send(
        &ctx.app,
        "POST",
        "/api/v1/sops/gwg-training",
        &ceo,
        Some(valid.clone()),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{record}");
    let record_id = str_of(&record, "id").to_string();
    assert_eq!(record["status"], "unsigned");
    assert_eq!(record["template_id"], "gwg_staff_training");
    assert_eq!(record["instructions"].as_array().unwrap().len(), 6);
    assert_eq!(record["management_name"], "Ben Beispiel");
    let document_id = str_of(&record, "document_id").to_string();
    assert_eq!(
        record["document_file_name"],
        format!("GwGUnterweisung_{}_Muster_Anna.pdf", today.format("%Y%m%d"))
    );

    let (status, file) = send(
        &ctx.app,
        "GET",
        &format!("/api/v1/personnel/employees/{employee_id}"),
        &ceo,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{file}");
    let documents = file["documents"].as_array().unwrap();
    let sheet = documents
        .iter()
        .find(|document| document["id"] == document_id.as_str())
        .expect("the sheet is in the personnel file");
    assert_eq!(sheet["category"], "gwg_unterweisung");
    assert_eq!(sheet["source"], "generated");
    assert_eq!(sheet["mime_type"], "application/pdf");
    assert_eq!(
        sheet["title"],
        "GwG-Unterweisung und Zuverlässigkeit (§ 6 Abs. 2 GwG)"
    );

    let (status, bytes) = send_raw(
        &ctx.app,
        "GET",
        &format!("/api/v1/personnel/documents/{document_id}/file"),
        &ceo,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let text = pdf_extract::extract_text_from_mem(&bytes)
        .unwrap()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    assert!(text.contains("Dokumentation interner Sicherungsmaßnahmen"));
    assert!(text.contains("Muster, Anna"));
    assert!(text.contains("01.03.2019"));
    assert!(text.contains("Dolmetscherdienst"));
    assert!(text.contains("Ben Beispiel"));
    assert!(text.contains("GWU-"));
    assert!(!text.contains("Güterhändler"));

    // The audit row names the fields, never their values.
    let context: Value = sqlx::query_scalar(
        "SELECT context FROM audit_log WHERE action = 'gwg_staff_training_created' AND entity_id = $1",
    )
    .bind(Uuid::parse_str(&record_id).unwrap())
    .fetch_one(&ctx.pool)
    .await
    .unwrap();
    assert!(
        context["fields"]
            .as_array()
            .unwrap()
            .contains(&json!("instructed_on"))
    );
    assert!(!context.to_string().contains("Dolmetscherdienst"));
    assert!(!context.to_string().contains("Ben Beispiel"));

    // Instructed today: not due, signature outstanding.
    let (_, overview) = send(&ctx.app, "GET", "/api/v1/sops/gwg-training", &ceo, None).await;
    let row = employee_row(&overview, &employee_id);
    assert_eq!(row["status"], "unsigned");
    assert_eq!(row["due"], false);
    assert_eq!(
        row["last_instructed_on"],
        today.format("%Y-%m-%d").to_string()
    );
    assert_eq!(row["records"].as_array().unwrap().len(), 1);

    // The employee reads the own record and opens the sheet, but cannot sign for the CEO.
    let own = bearer(interpreter_id, "interpreter");
    let (status, mine) = send(
        &ctx.app,
        "GET",
        "/api/v1/sops/gwg-training/mine",
        &own,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{mine}");
    assert_eq!(mine["employee_id"], employee_id.as_str());
    assert_eq!(mine["status"], "unsigned");
    assert_eq!(mine["records"][0]["id"], record_id.as_str());
    let (status, _) = send_raw(
        &ctx.app,
        "GET",
        &format!("/api/v1/personnel/documents/{document_id}/file"),
        &own,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let (status, _) = upload(
        &ctx.app,
        &format!("/api/v1/sops/gwg-training/{record_id}/signed-copy"),
        &own,
        "signed.pdf",
        "application/pdf",
        PDF,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    // Someone without a personnel file has no records.
    let (status, none) = send(
        &ctx.app,
        "GET",
        "/api/v1/sops/gwg-training/mine",
        &bearer(pm_id, "patient_manager"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(none["records"], json!([]));

    // The signed scan becomes version 2 of the sheet and marks the record signed.
    let (status, signed) = upload(
        &ctx.app,
        &format!("/api/v1/sops/gwg-training/{record_id}/signed-copy"),
        &ceo,
        "Scan 7.pdf",
        "application/pdf",
        PDF,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{signed}");
    assert_eq!(signed["status"], "signed");
    assert_eq!(signed["signed_by_name"], "Ben Beispiel");
    let signed_id = str_of(&signed, "signed_document_id").to_string();
    assert_eq!(
        signed["signed_file_name"],
        format!(
            "GwGUnterweisung_{}_Muster_Anna_V2.pdf",
            today.format("%Y%m%d")
        )
    );
    let (_, file) = send(
        &ctx.app,
        "GET",
        &format!("/api/v1/personnel/employees/{employee_id}"),
        &ceo,
        None,
    )
    .await;
    let scan = file["documents"]
        .as_array()
        .unwrap()
        .iter()
        .find(|document| document["id"] == signed_id.as_str())
        .expect("the signed scan is in the personnel file");
    assert_eq!(scan["supersedes_id"], document_id.as_str());
    assert_eq!(scan["version_number"], 2);
    assert_eq!(scan["correction_reason"], "Unterschriebene Fassung");
    assert_eq!(scan["source"], "upload");
    let (_, overview) = send(&ctx.app, "GET", "/api/v1/sops/gwg-training", &ceo, None).await;
    assert_eq!(employee_row(&overview, &employee_id)["status"], "signed");
    let audited: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM audit_log WHERE action = 'gwg_staff_training_signed' AND entity_id = $1",
    )
    .bind(Uuid::parse_str(&record_id).unwrap())
    .fetch_one(&ctx.pool)
    .await
    .unwrap();
    assert_eq!(audited, 1);

    // A record is evidence: its content cannot be changed or deleted.
    let changed = sqlx::query("UPDATE gwg_staff_trainings SET position = 'x' WHERE id = $1")
        .bind(Uuid::parse_str(&record_id).unwrap())
        .execute(&ctx.pool)
        .await;
    assert!(changed.is_err());
    let deleted = sqlx::query("DELETE FROM gwg_staff_trainings WHERE id = $1")
        .bind(Uuid::parse_str(&record_id).unwrap())
        .execute(&ctx.pool)
        .await;
    assert!(deleted.is_err());

    // A second instruction a year later keeps the history; the newest decides the status.
    let mut later = valid.clone();
    later["instructions"] = json!(["identify_partner", "suspicious_activity_report"]);
    later["reliability"] = json!("new_employee");
    later["reliability_certificate"] = json!(true);
    later["delivered_by"] = json!("other");
    later["delivered_by_other"] = json!("Kanzlei Beispiel GmbH");
    let (status, second) = send(
        &ctx.app,
        "POST",
        "/api/v1/sops/gwg-training",
        &ceo,
        Some(later),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{second}");
    assert_eq!(
        second["instructions"],
        json!(["identify_partner", "suspicious_activity_report"])
    );
    assert_eq!(second["delivered_by"], "other");
    assert_eq!(second["reliability_certificate"], true);
    assert_eq!(
        second["document_file_name"],
        format!(
            "GwGUnterweisung_{}_Muster_Anna_2.pdf",
            today.format("%Y%m%d")
        )
    );
    let (_, overview) = send(&ctx.app, "GET", "/api/v1/sops/gwg-training", &ceo, None).await;
    let row = employee_row(&overview, &employee_id);
    assert_eq!(row["records"].as_array().unwrap().len(), 2);
    assert_eq!(row["status"], "unsigned");
}

#[tokio::test]
async fn an_instruction_older_than_twelve_months_is_due_again() {
    let Some(ctx) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let ceo_id = seed_user(&ctx.pool, "ceo", "Ben Beispiel").await;
    let ceo = bearer(ceo_id, "ceo");
    let (status, employee) = send(
        &ctx.app,
        "POST",
        "/api/v1/personnel/employees",
        &ceo,
        Some(
            json!({ "first_name": "Mia", "last_name": "Muster", "employment_start": "2018-01-01" }),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{employee}");
    let employee_id = str_of(&employee, "id").to_string();
    let old = (chrono::Utc::now().date_naive() - chrono::Duration::days(400))
        .format("%Y-%m-%d")
        .to_string();
    let (status, record) = send(
        &ctx.app,
        "POST",
        "/api/v1/sops/gwg-training",
        &ceo,
        Some(json!({
            "employee_id": employee_id,
            "instructed_on": old,
            "delivered_by": "internal",
            "form_oral": true,
            "reliability": "long_standing",
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{record}");
    // No linked account: position and department stay empty.
    assert_eq!(record["position"], "");
    let (_, overview) = send(&ctx.app, "GET", "/api/v1/sops/gwg-training", &ceo, None).await;
    let row = employee_row(&overview, &employee_id);
    assert_eq!(row["status"], "unsigned");
    assert_eq!(row["last_instructed_on"], old.as_str());
    assert_eq!(row["due"], true);
    assert_eq!(row["default_position"], "");
}
