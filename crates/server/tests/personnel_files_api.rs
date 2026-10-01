//! Personnel files (Personalakte, § 8 BVV): archive names, immutability,
//! versions, the hash chain, the employee's own file, the scan intake,
//! retention and the audit export. Synthetic data only.

mod support;

use std::io::Cursor;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use serde_json::{Value, json};
use sqlx::{PgPool, Row};
use tower::ServiceExt;
use uuid::Uuid;

use gmed_server::auth::jwt;

const TEST_SECRET: &str = "test-secret-at-least-32-characters-long!!";
const PDF: &[u8] = b"%PDF-1.7\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n";
const GIF: &[u8] = b"GIF89a\x01\x00\x01\x00\x00\x00\x00;";

fn bearer(user_id: Uuid, role: &str) -> String {
    let token = jwt::issue_access_token(TEST_SECRET, user_id, role, Uuid::new_v4()).unwrap();
    format!("Bearer {token}")
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

async fn upload(
    app: &axum::Router,
    path: &str,
    auth: &str,
    fields: &[(&str, &str)],
    file_name: &str,
    mime: &str,
    bytes: &[u8],
) -> (StatusCode, Value) {
    let boundary = format!("----personnel-{}", Uuid::new_v4().simple());
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

async fn seed_user(pool: &PgPool, role: &str) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO users (email, password_hash, name, role)
           VALUES ($1, 'test-password-hash', $2, $3) RETURNING id"#,
    )
    .bind(format!("personnel-{}@example.com", Uuid::new_v4().simple()))
    .bind(format!("Personnel {role}"))
    .bind(role)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn create_employee(app: &axum::Router, ceo: &str, body: Value) -> Value {
    let (status, employee) =
        send(app, "POST", "/api/v1/personnel/employees", ceo, Some(body)).await;
    assert_eq!(status, StatusCode::CREATED, "{employee}");
    employee
}

fn id_of(value: &Value) -> String {
    value["id"].as_str().unwrap().to_string()
}

#[tokio::test]
async fn ceo_archives_documents_under_generated_names_and_nothing_can_change_them() {
    let Some(ctx) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let ceo = bearer(ctx.admin_id, "ceo");
    let employee = create_employee(
        &ctx.app,
        &ceo,
        json!({
            "salutation": "frau",
            "first_name": "Gabriele",
            "last_name": "Müller-Lüdenscheidt",
            "personnel_number": format!("P{}", &Uuid::new_v4().simple().to_string()[..6]),
            "employment_start": "2025-01-01",
        }),
    )
    .await;
    let employee_id = id_of(&employee);
    let documents_path = format!("/api/v1/personnel/employees/{employee_id}/documents");

    // Preview and archive a monthly timesheet scanned as "Scan100.pdf".
    let (status, preview) = send(
        &ctx.app,
        "GET",
        &format!(
            "/api/v1/personnel/employees/{employee_id}/file-name?category=stundenzettel&period=2026-05"
        ),
        &ceo,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{preview}");
    assert_eq!(
        preview["file_name"],
        "Stundenzettel_2026_05_MuellerLuedenscheidt_Gabriele.pdf"
    );
    let (status, timesheet) = upload(
        &ctx.app,
        &documents_path,
        &ceo,
        &[("category", "stundenzettel"), ("period", "2026-05")],
        "Scan100.pdf",
        "application/pdf",
        PDF,
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{timesheet}");
    assert_eq!(timesheet["archive_file_name"], preview["file_name"]);
    assert_eq!(timesheet["original_file_name"], "Scan100.pdf");
    assert_eq!(timesheet["version_number"], 1);
    assert_eq!(timesheet["chain_seq"], 1);
    assert_eq!(timesheet["period"], "2026-05");
    assert_eq!(timesheet["archived_late"], true);
    let timesheet_id = id_of(&timesheet);

    // A second file for the same month gets a distinct name.
    let (status, duplicate) = upload(
        &ctx.app,
        &documents_path,
        &ceo,
        &[("category", "stundenzettel"), ("period", "2026-05")],
        "Scan101.pdf",
        "application/pdf",
        PDF,
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{duplicate}");
    assert_eq!(
        duplicate["archive_file_name"],
        "Stundenzettel_2026_05_MuellerLuedenscheidt_Gabriele_2.pdf"
    );
    assert_eq!(duplicate["chain_seq"], 2);

    // Monthly categories need a month, dated ones a date; GIF is refused.
    let (status, _) = upload(
        &ctx.app,
        &documents_path,
        &ceo,
        &[("category", "stundenzettel")],
        "x.pdf",
        "application/pdf",
        PDF,
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    let (status, _) = upload(
        &ctx.app,
        &documents_path,
        &ceo,
        &[
            ("category", "arbeitsvertrag"),
            ("document_date", "2025-01-01"),
        ],
        "photo.gif",
        "image/gif",
        GIF,
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);

    // Download returns the archived bytes under the archive name.
    let (status, bytes) = send_raw(
        &ctx.app,
        "GET",
        &format!("/api/v1/personnel/documents/{timesheet_id}/file"),
        &ceo,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(bytes, PDF);

    // The database refuses any change to an archived document.
    let uuid = Uuid::parse_str(&timesheet_id).unwrap();
    for statement in [
        "UPDATE personnel_documents SET archive_file_name = 'Other_2026_05_X.pdf' WHERE id = $1",
        "UPDATE personnel_documents SET sha256 = repeat('a', 64) WHERE id = $1",
        "UPDATE personnel_documents SET archived_at = archived_at - interval '30 days' WHERE id = $1",
        "DELETE FROM personnel_documents WHERE id = $1",
    ] {
        let error = sqlx::query(statement)
            .bind(uuid)
            .execute(&ctx.pool)
            .await
            .unwrap_err();
        assert!(
            error
                .to_string()
                .to_lowercase()
                .contains("personnel document"),
            "{statement}: {error}"
        );
    }
    // Deletion is off by default, so a tombstone is refused too.
    let error = sqlx::query(
        "UPDATE personnel_documents SET deleted_at = now(), deleted_by = $2, delete_reason = 'x' WHERE id = $1",
    )
    .bind(uuid)
    .bind(ctx.admin_id)
    .execute(&ctx.pool)
    .await
    .unwrap_err();
    assert!(error.to_string().contains("disabled"), "{error}");
    // The employee cannot be deleted while the file has documents.
    let error = sqlx::query("DELETE FROM employees WHERE id = $1")
        .bind(Uuid::parse_str(&employee_id).unwrap())
        .execute(&ctx.pool)
        .await
        .unwrap_err();
    assert!(error.to_string().contains("cannot be deleted"), "{error}");
    // The journal is append-only.
    let error = sqlx::query("DELETE FROM personnel_document_events")
        .execute(&ctx.pool)
        .await
        .unwrap_err();
    assert!(error.to_string().contains("append-only"), "{error}");

    // A correction is a new version with a reason; the original stays.
    let (status, _) = upload(
        &ctx.app,
        &documents_path,
        &ceo,
        &[("supersedes_id", &timesheet_id)],
        "fixed.pdf",
        "application/pdf",
        PDF,
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "reason required");
    let (status, version) = upload(
        &ctx.app,
        &documents_path,
        &ceo,
        &[
            ("supersedes_id", &timesheet_id),
            ("correction_reason", "Hours of 14.05. corrected"),
        ],
        "fixed.pdf",
        "application/pdf",
        b"%PDF-1.7\ncorrected\n%%EOF\n",
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{version}");
    assert_eq!(version["version_number"], 2);
    assert_eq!(
        version["archive_file_name"],
        "Stundenzettel_2026_05_MuellerLuedenscheidt_Gabriele_V2.pdf"
    );
    assert_eq!(version["supersedes_id"], timesheet_id.as_str());
    let (status, _) = upload(
        &ctx.app,
        &documents_path,
        &ceo,
        &[
            ("supersedes_id", &timesheet_id),
            ("correction_reason", "again"),
        ],
        "fixed.pdf",
        "application/pdf",
        PDF,
    )
    .await;
    assert_eq!(
        status,
        StatusCode::CONFLICT,
        "only the newest version is corrected"
    );

    let (status, file) = send(
        &ctx.app,
        "GET",
        &format!("/api/v1/personnel/employees/{employee_id}"),
        &ceo,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let documents = file["documents"].as_array().unwrap();
    assert_eq!(documents.len(), 3);
    let original = documents
        .iter()
        .find(|document| document["id"] == timesheet_id.as_str())
        .unwrap();
    assert_eq!(original["is_current"], false);

    let (status, events) = send(
        &ctx.app,
        "GET",
        &format!("/api/v1/personnel/employees/{employee_id}/events"),
        &ceo,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let actions: Vec<&str> = events
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|event| event["action"].as_str())
        .collect();
    for action in [
        "employee_created",
        "document_archived",
        "document_version",
        "document_downloaded",
    ] {
        assert!(actions.contains(&action), "{action} in {actions:?}");
    }

    // The verifier recomputes the database's chain links and passes.
    let (status, run) = send(
        &ctx.app,
        "POST",
        "/api/v1/personnel/integrity/run",
        &ceo,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{run}");
    assert_eq!(run["status"], "passed", "{run}");
    assert!(run["documents_checked"].as_i64().unwrap() >= 3);

    // An anchor without a TSA is recorded as such.
    let (status, anchor) = send(
        &ctx.app,
        "POST",
        "/api/v1/personnel/integrity/anchor",
        &ceo,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{anchor}");
    assert_eq!(anchor["tsa_status"], "disabled");

    // Tampering behind the triggers is detected.
    sqlx::query("ALTER TABLE personnel_documents DISABLE TRIGGER personnel_documents_immutable")
        .execute(&ctx.pool)
        .await
        .unwrap();
    sqlx::query("UPDATE personnel_documents SET original_file_name = 'x', archive_file_name = 'Forged_2026_05_X.pdf' WHERE id = $1")
        .bind(uuid)
        .execute(&ctx.pool)
        .await
        .unwrap();
    sqlx::query("ALTER TABLE personnel_documents ENABLE TRIGGER personnel_documents_immutable")
        .execute(&ctx.pool)
        .await
        .unwrap();
    let (_, run) = send(
        &ctx.app,
        "POST",
        "/api/v1/personnel/integrity/run",
        &ceo,
        None,
    )
    .await;
    assert_eq!(run["status"], "failed", "{run}");
    let notified: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM user_notifications WHERE kind = 'personnel_integrity_failed' AND user_id = $1",
    )
    .bind(ctx.admin_id)
    .fetch_one(&ctx.pool)
    .await
    .unwrap();
    assert!(notified >= 1);
}

#[tokio::test]
async fn only_the_ceo_reaches_personnel_files_and_employees_see_only_their_own() {
    let Some(ctx) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let ceo = bearer(ctx.admin_id, "ceo");
    let interpreter_id = seed_user(&ctx.pool, "interpreter").await;
    let other_id = seed_user(&ctx.pool, "interpreter").await;
    let employee = create_employee(
        &ctx.app,
        &ceo,
        json!({
            "first_name": "Ivan",
            "last_name": "Petrenko",
            "user_id": interpreter_id.to_string(),
            "notes": "internal CEO note",
        }),
    )
    .await;
    let employee_id = id_of(&employee);
    let (status, sick_note) = upload(
        &ctx.app,
        &format!("/api/v1/personnel/employees/{employee_id}/documents"),
        &ceo,
        &[
            ("category", "arbeitsunfaehigkeit"),
            ("document_date", "2026-03-09"),
        ],
        "au.pdf",
        "application/pdf",
        PDF,
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{sick_note}");
    assert_eq!(
        sick_note["archive_file_name"],
        "Arbeitsunfaehigkeit_20260309_Petrenko_Ivan.pdf"
    );
    let sick_note_id = id_of(&sick_note);

    // A patient account cannot be linked.
    let patient_id = seed_user(&ctx.pool, "patient").await;
    let (status, _) = send(
        &ctx.app,
        "POST",
        "/api/v1/personnel/employees",
        &ceo,
        Some(json!({ "last_name": "Patient", "user_id": patient_id.to_string() })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);

    for role in [
        "ceo_assistant",
        "patient_manager",
        "billing",
        "sales",
        "it_admin",
        "concierge",
        "teamlead_interpreter",
    ] {
        let user = seed_user(&ctx.pool, role).await;
        let auth = bearer(user, role);
        for (method, path) in [
            ("GET", "/api/v1/personnel/employees".to_string()),
            ("GET", format!("/api/v1/personnel/employees/{employee_id}")),
            ("GET", "/api/v1/personnel/intake".to_string()),
            ("GET", "/api/v1/personnel/settings".to_string()),
            ("GET", "/api/v1/personnel/integrity".to_string()),
        ] {
            let (status, _) = send(&ctx.app, method, &path, &auth, None).await;
            assert_eq!(status, StatusCode::FORBIDDEN, "{role} {method} {path}");
        }
        let (status, _) = send_raw(
            &ctx.app,
            "GET",
            &format!("/api/v1/personnel/documents/{sick_note_id}/file"),
            &auth,
            None,
        )
        .await;
        assert_eq!(status, StatusCode::NOT_FOUND, "{role} download");
        let (status, _) = send(
            &ctx.app,
            "POST",
            "/api/v1/personnel/employees",
            &auth,
            Some(json!({ "last_name": "X" })),
        )
        .await;
        assert_eq!(status, StatusCode::FORBIDDEN, "{role} create");
    }

    // The IT admin cannot flip personnel settings through the admin page.
    let it_admin = bearer(seed_user(&ctx.pool, "it_admin").await, "it_admin");
    for value in ["true", "1"] {
        let (status, _) = send(
            &ctx.app,
            "POST",
            "/api/v1/admin/settings/personnel_retention_deletion_enabled",
            &it_admin,
            Some(json!({ "value": value })),
        )
        .await;
        assert_eq!(status, StatusCode::NOT_FOUND, "{value}");
    }
    let (status, listed) = send(&ctx.app, "GET", "/api/v1/admin/settings", &it_admin, None).await;
    assert_eq!(status, StatusCode::OK);
    assert!(
        !listed.to_string().contains("personnel_"),
        "personnel settings are not listed on the admin page"
    );
    let enabled: Value = sqlx::query_scalar(
        "SELECT value FROM system_settings WHERE key = 'personnel_retention_deletion_enabled'",
    )
    .fetch_one(&ctx.pool)
    .await
    .unwrap();
    assert_eq!(enabled, json!(false));

    // The linked employee sees their own file (sick notes included, no notes).
    let own = bearer(interpreter_id, "interpreter");
    let (status, me) = send(&ctx.app, "GET", "/api/v1/me", &own, None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(me["has_personnel_file"], true);
    let (status, file) = send(&ctx.app, "GET", "/api/v1/personnel/me", &own, None).await;
    assert_eq!(status, StatusCode::OK, "{file}");
    assert_eq!(file["documents"].as_array().unwrap().len(), 1);
    assert!(file["employee"].get("notes").is_none());
    let (status, bytes) = send_raw(
        &ctx.app,
        "GET",
        &format!("/api/v1/personnel/documents/{sick_note_id}/file"),
        &own,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(bytes, PDF);
    let (status, _) = send(&ctx.app, "GET", "/api/v1/personnel/categories", &own, None).await;
    assert_eq!(status, StatusCode::OK);
    let (status, _) = upload(
        &ctx.app,
        &format!("/api/v1/personnel/employees/{employee_id}/documents"),
        &own,
        &[("category", "urlaub"), ("document_date", "2026-03-09")],
        "u.pdf",
        "application/pdf",
        PDF,
    )
    .await;
    assert_eq!(
        status,
        StatusCode::FORBIDDEN,
        "employees cannot add to their file"
    );
    let viewed: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM personnel_document_events WHERE actor_id = $1 AND action IN ('own_file_viewed', 'own_document_downloaded')",
    )
    .bind(interpreter_id)
    .fetch_one(&ctx.pool)
    .await
    .unwrap();
    assert_eq!(viewed, 2);

    // Another employee neither has a file nor sees this one.
    let other = bearer(other_id, "interpreter");
    let (status, _) = send(&ctx.app, "GET", "/api/v1/personnel/me", &other, None).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (status, _) = send_raw(
        &ctx.app,
        "GET",
        &format!("/api/v1/personnel/documents/{sick_note_id}/file"),
        &other,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn scans_go_through_the_intake_and_keep_their_arrival_time() {
    let Some(ctx) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let ceo = bearer(ctx.admin_id, "ceo");
    let scan_account = seed_user(&ctx.pool, "patient_manager").await;
    let scanner = bearer(scan_account, "patient_manager");
    let employee = create_employee(
        &ctx.app,
        &ceo,
        json!({ "first_name": "Anna", "last_name": "Weiß", "employment_start": "2024-01-01" }),
    )
    .await;
    let employee_id = id_of(&employee);

    let (status, item) = upload(
        &ctx.app,
        "/api/v1/personnel/intake",
        &scanner,
        &[("source", "scan")],
        "Scan_2026-10-01_08-00-00.pdf",
        "application/pdf",
        PDF,
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{item}");
    let item_id = id_of(&item);
    // The scan account cannot read the queue back.
    let (status, _) = send(&ctx.app, "GET", "/api/v1/personnel/intake", &scanner, None).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, _) = send_raw(
        &ctx.app,
        "GET",
        &format!("/api/v1/personnel/intake/{item_id}/file"),
        &scanner,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    // Interpreters cannot drop files.
    let interpreter = bearer(seed_user(&ctx.pool, "interpreter").await, "interpreter");
    let (status, _) = upload(
        &ctx.app,
        "/api/v1/personnel/intake",
        &interpreter,
        &[],
        "a.pdf",
        "application/pdf",
        PDF,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    let (status, queue) = send(&ctx.app, "GET", "/api/v1/personnel/intake", &ceo, None).await;
    assert_eq!(status, StatusCode::OK);
    assert!(
        queue
            .as_array()
            .unwrap()
            .iter()
            .any(|entry| entry["id"] == item_id.as_str())
    );
    let notified: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM user_notifications WHERE kind = 'personnel_intake' AND user_id = $1",
    )
    .bind(ctx.admin_id)
    .fetch_one(&ctx.pool)
    .await
    .unwrap();
    assert!(notified >= 1);

    let (status, document) = send(
        &ctx.app,
        "POST",
        &format!("/api/v1/personnel/intake/{item_id}/archive"),
        &ceo,
        Some(json!({
            "employee_id": employee_id,
            "category": "entgeltabrechnung",
            "period": "2026-09",
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{document}");
    assert_eq!(
        document["archive_file_name"],
        "Entgeltabrechnung_2026_09_Weiss_Anna.pdf"
    );
    assert_eq!(document["source"], "scan");
    assert_eq!(
        document["original_file_name"],
        "Scan_2026-10-01_08-00-00.pdf"
    );
    assert!(document["received_at"].is_string());
    let (status, _) = send(
        &ctx.app,
        "POST",
        &format!("/api/v1/personnel/intake/{item_id}/archive"),
        &ceo,
        Some(json!({
            "employee_id": employee_id,
            "category": "entgeltabrechnung",
            "period": "2026-09",
        })),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND, "an item is archived once");

    // A wrong scan is discarded with a reason.
    let (_, wrong) = upload(
        &ctx.app,
        "/api/v1/personnel/intake",
        &scanner,
        &[],
        "blank.pdf",
        "application/pdf",
        PDF,
    )
    .await;
    let wrong_id = id_of(&wrong);
    let (status, _) = send(
        &ctx.app,
        "POST",
        &format!("/api/v1/personnel/intake/{wrong_id}/discard"),
        &ceo,
        Some(json!({ "reason": "" })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    let (status, _) = send(
        &ctx.app,
        "POST",
        &format!("/api/v1/personnel/intake/{wrong_id}/discard"),
        &ceo,
        Some(json!({ "reason": "blank page" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let row = sqlx::query("SELECT status FROM personnel_intake_items WHERE id = $1")
        .bind(Uuid::parse_str(&wrong_id).unwrap())
        .fetch_one(&ctx.pool)
        .await
        .unwrap();
    assert_eq!(row.get::<String, _>("status"), "discarded");
}

#[tokio::test]
async fn completeness_retention_and_export() {
    let Some(ctx) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let ceo = bearer(ctx.admin_id, "ceo");
    let employee = create_employee(
        &ctx.app,
        &ceo,
        json!({
            "first_name": "Jörg",
            "last_name": "Strauß",
            "personnel_number": format!("R{}", &Uuid::new_v4().simple().to_string()[..6]),
            "employment_start": "2015-01-01",
        }),
    )
    .await;
    let employee_id = id_of(&employee);
    let documents_path = format!("/api/v1/personnel/employees/{employee_id}/documents");
    let (status, january) = upload(
        &ctx.app,
        &documents_path,
        &ceo,
        &[("category", "stundenzettel"), ("period", "2026-01")],
        "jan.pdf",
        "application/pdf",
        PDF,
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{january}");
    let (status, old_warning) = upload(
        &ctx.app,
        &documents_path,
        &ceo,
        &[("category", "abmahnung"), ("document_date", "2016-02-01")],
        "warning.pdf",
        "application/pdf",
        PDF,
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{old_warning}");
    assert_eq!(old_warning["retention_until"], "2019-12-31");
    let warning_id = id_of(&old_warning);

    // January: the timesheet arrived late, the payslip is missing.
    let (status, matrix) = send(
        &ctx.app,
        "GET",
        "/api/v1/personnel/completeness?from=2026-01&to=2026-02",
        &ceo,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{matrix}");
    let row = matrix["employees"]
        .as_array()
        .unwrap()
        .iter()
        .find(|row| row["id"] == employee_id.as_str())
        .unwrap();
    assert_eq!(row["cells"]["2026-01"]["stundenzettel"], "late");
    assert_eq!(row["cells"]["2026-01"]["entgeltabrechnung"], "missing");
    assert_eq!(row["cells"]["2026-02"]["stundenzettel"], "missing");

    // Retention: listed as due, refused while deletion is disabled.
    let (status, due) = send(
        &ctx.app,
        "GET",
        "/api/v1/personnel/retention/due",
        &ceo,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(due["deletion_enabled"], false);
    assert!(
        due["documents"]
            .as_array()
            .unwrap()
            .iter()
            .any(|document| document["id"] == warning_id.as_str())
    );
    let delete_path = format!("/api/v1/personnel/documents/{warning_id}/delete");
    let (status, _) = send(
        &ctx.app,
        "POST",
        &delete_path,
        &ceo,
        Some(json!({ "reason": "retention ended" })),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    let (status, settings) = send(
        &ctx.app,
        "PATCH",
        "/api/v1/personnel/settings",
        &ceo,
        Some(json!({ "deletion_enabled": true, "late_days": 7 })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{settings}");
    assert_eq!(settings["deletion_enabled"], true);
    // A legal hold blocks deletion.
    let hold_path = format!("/api/v1/personnel/documents/{warning_id}/legal-hold");
    let (status, _) = send(
        &ctx.app,
        "POST",
        &hold_path,
        &ceo,
        Some(json!({ "legal_hold": true, "reason": "labour court case" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let (status, _) = send(
        &ctx.app,
        "POST",
        &delete_path,
        &ceo,
        Some(json!({ "reason": "retention ended" })),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    send(
        &ctx.app,
        "POST",
        &hold_path,
        &ceo,
        Some(json!({ "legal_hold": false })),
    )
    .await;
    // A document still inside its retention period is refused.
    let (status, body) = send(
        &ctx.app,
        "POST",
        &format!("/api/v1/personnel/documents/{}/delete", id_of(&january)),
        &ceo,
        Some(json!({ "reason": "too early" })),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{body}");
    let (status, _) = send(
        &ctx.app,
        "POST",
        &delete_path,
        &ceo,
        Some(json!({ "reason": "retention ended" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let (status, _) = send_raw(
        &ctx.app,
        "GET",
        &format!("/api/v1/personnel/documents/{warning_id}/file"),
        &ceo,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::GONE);
    // The tombstone keeps the chain verifiable.
    let (_, run) = send(
        &ctx.app,
        "POST",
        "/api/v1/personnel/integrity/run",
        &ceo,
        None,
    )
    .await;
    let failures = run["failures"].as_array().unwrap();
    assert!(
        !failures
            .iter()
            .any(|failure| failure["employee_id"] == employee_id.as_str()),
        "{run}"
    );
    sqlx::query(
        "UPDATE system_settings SET value = 'false' WHERE key = 'personnel_retention_deletion_enabled'",
    )
    .execute(&ctx.pool)
    .await
    .unwrap();

    // Export: archive names, index, manifest and report.
    let (status, zip_bytes) = send_raw(
        &ctx.app,
        "POST",
        "/api/v1/personnel/export",
        &ceo,
        Some(json!({ "employee_ids": [employee_id] })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let mut archive = zip::ZipArchive::new(Cursor::new(zip_bytes)).unwrap();
    let names: Vec<String> = archive.file_names().map(str::to_string).collect();
    let number = employee["personnel_number"].as_str().unwrap();
    assert!(
        names.contains(&format!(
            "Strauss_Joerg_{number}/Stundenzettel_2026_01_Strauss_Joerg.pdf"
        )),
        "{names:?}"
    );
    assert!(
        !names.iter().any(|name| name.contains("Abmahnung")),
        "deleted documents are not exported"
    );
    for required in [
        "Index.csv",
        "Manifest.sha256",
        "Pruefbericht.txt",
        "LIESMICH.txt",
    ] {
        assert!(
            names.contains(&required.to_string()),
            "{required} in {names:?}"
        );
    }
    let mut report = String::new();
    std::io::Read::read_to_string(
        &mut archive.by_name("Pruefbericht.txt").unwrap(),
        &mut report,
    )
    .unwrap();
    assert!(report.contains("unveraendert"), "{report}");
}

#[tokio::test]
async fn profile_documents_are_imported_once_as_copies() {
    let Some(ctx) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let ceo = bearer(ctx.admin_id, "ceo");
    let interpreter_id = seed_user(&ctx.pool, "interpreter").await;
    let (status, profile_document) = upload(
        &ctx.app,
        &format!("/api/v1/interpreters/{interpreter_id}/profile/documents"),
        &ceo,
        &[("document_kind", "avv")],
        "Arbeitsvertrag unterschrieben.pdf",
        "application/pdf",
        PDF,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{profile_document}");
    let employee = create_employee(
        &ctx.app,
        &ceo,
        json!({
            "first_name": "Olena",
            "last_name": "Koval",
            "user_id": interpreter_id.to_string(),
        }),
    )
    .await;
    let employee_id = id_of(&employee);
    let list_path = format!("/api/v1/personnel/employees/{employee_id}/profile-documents");
    let (status, importable) = send(&ctx.app, "GET", &list_path, &ceo, None).await;
    assert_eq!(status, StatusCode::OK, "{importable}");
    let entry = &importable.as_array().unwrap()[0];
    assert_eq!(entry["document_kind"], "avv");
    assert_eq!(entry["suggested_category"], "arbeitsvertrag");
    assert_eq!(entry["imported"], false);
    let source_id = entry["document_id"].as_str().unwrap().to_string();

    let import_path = format!("{list_path}/import");
    let body = json!({
        "document_id": source_id,
        "category": "arbeitsvertrag",
        "document_date": "2025-03-01",
    });
    let (status, document) = send(&ctx.app, "POST", &import_path, &ceo, Some(body.clone())).await;
    assert_eq!(status, StatusCode::CREATED, "{document}");
    assert_eq!(
        document["archive_file_name"],
        "Arbeitsvertrag_20250301_Koval_Olena.pdf"
    );
    assert_eq!(document["source"], "import");
    assert_eq!(document["source_document_id"], source_id.as_str());
    assert_eq!(
        document["original_file_name"],
        "Arbeitsvertrag unterschrieben.pdf"
    );
    let (status, _) = send(&ctx.app, "POST", &import_path, &ceo, Some(body)).await;
    assert_eq!(status, StatusCode::CONFLICT, "imported once");
    let (_, importable) = send(&ctx.app, "GET", &list_path, &ceo, None).await;
    assert_eq!(importable[0]["imported"], true);

    // The archive keeps its own copy.
    let (status, bytes) = send_raw(
        &ctx.app,
        "GET",
        &format!("/api/v1/personnel/documents/{}/file", id_of(&document)),
        &ceo,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(bytes, PDF);

    // Only the CEO imports.
    let manager = bearer(
        seed_user(&ctx.pool, "patient_manager").await,
        "patient_manager",
    );
    let (status, _) = send(&ctx.app, "GET", &list_path, &manager, None).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}
