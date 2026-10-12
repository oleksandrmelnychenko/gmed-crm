//! Internal notes are read by whom the author chose (owner decision
//! 2026-10-12, QA E-23): "only me", "my role" or "all staff"; the CEO reads
//! every note. Every read path — list, search, detail, attachments, edits —
//! applies the choice on the server.

mod support;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use serde_json::{Value, json};
use sqlx::PgPool;
use tower::ServiceExt;
use uuid::Uuid;

use gmed_server::auth::jwt;

const TEST_SECRET: &str = "test-secret-at-least-32-characters-long!!";
const TINY_TRANSPARENT_PNG: &[u8] = &[
    137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0,
    0, 0, 31, 21, 196, 137, 0, 0, 0, 13, 73, 68, 65, 84, 8, 29, 99, 248, 255, 255, 255, 127, 0, 9,
    251, 3, 253, 5, 67, 69, 202, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130,
];

struct Staff {
    bearer: String,
}

async fn staff(pool: &PgPool, role: &str, tag: &str, name: &str) -> Staff {
    let id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO users (email, password_hash, name, role)
           VALUES ($1, 'test-hash', $2, $3)
           RETURNING id"#,
    )
    .bind(format!(
        "{}-{role}-{tag}@example.com",
        name.to_lowercase().replace(' ', ".")
    ))
    .bind(name)
    .bind(role)
    .fetch_one(pool)
    .await
    .unwrap();
    let token = jwt::issue_access_token(TEST_SECRET, id, role, Uuid::new_v4()).unwrap();
    Staff {
        bearer: format!("Bearer {token}"),
    }
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
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(json!(null)),
    )
}

async fn upload_png(app: &axum::Router, path: &str, bearer: &str) -> (StatusCode, Value) {
    let boundary = format!("----gmed-notes-{}", Uuid::new_v4().simple());
    let mut body = Vec::new();
    body.extend_from_slice(format!("--{boundary}\r\n").as_bytes());
    body.extend_from_slice(
        b"Content-Disposition: form-data; name=\"file\"; filename=\"note.png\"\r\nContent-Type: image/png\r\n\r\n",
    );
    body.extend_from_slice(TINY_TRANSPARENT_PNG);
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

async fn listed_titles(app: &axum::Router, bearer: &str, query: &str) -> Vec<String> {
    let (status, body) = json_request(
        app,
        "GET",
        &format!("/api/v1/internal-notes{query}"),
        bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let mut titles: Vec<String> = body
        .as_array()
        .expect("note list")
        .iter()
        .filter_map(|row| row["title"].as_str().map(str::to_string))
        .collect();
    titles.sort();
    titles
}

async fn create_note(
    app: &axum::Router,
    author: &Staff,
    title: &str,
    visibility: Option<&str>,
) -> Value {
    let mut body = json!({ "title": title, "body": "Synthetische Übergabe" });
    if let Some(visibility) = visibility {
        body["visibility"] = json!(visibility);
    }
    let (status, created) = json_request(
        app,
        "POST",
        "/api/v1/internal-notes",
        &author.bearer,
        Some(body),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{created}");
    created
}

#[tokio::test]
async fn internal_notes_are_read_only_by_the_audience_the_author_chose() {
    let Some(ctx) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let tag = Uuid::new_v4().simple().to_string();
    let pool = &ctx.pool;
    let author = staff(pool, "patient_manager", &tag, "Mia Muster").await;
    let colleague = staff(pool, "patient_manager", &tag, "Ben Muster").await;
    let interpreter = staff(pool, "interpreter", &tag, "Anna Muster").await;
    let it_admin = staff(pool, "it_admin", &tag, "Viktor Zahler").await;
    let ceo = staff(pool, "ceo", &tag, "Beispiel Chef").await;

    let private_title = format!("A private {tag}");
    let role_title = format!("B role {tag}");
    let staff_title = format!("C staff {tag}");
    // Without a choice a new note stays with its author.
    let private = create_note(&ctx.app, &author, &private_title, None).await;
    assert_eq!(private["visibility"], "private");
    assert_eq!(private["visible_role"], Value::Null);
    let role = create_note(&ctx.app, &author, &role_title, Some("role")).await;
    assert_eq!(role["visibility"], "role");
    assert_eq!(role["visible_role"], "patient_manager");
    let shared = create_note(&ctx.app, &author, &staff_title, Some("staff")).await;
    assert_eq!(shared["visibility"], "staff");
    let private_id = private["id"].as_str().unwrap().to_string();
    let role_id = role["id"].as_str().unwrap().to_string();
    let shared_id = shared["id"].as_str().unwrap().to_string();

    let (status, refused) = json_request(
        &ctx.app,
        "POST",
        "/api/v1/internal-notes",
        &author.bearer,
        Some(json!({ "title": format!("X {tag}"), "visibility": "everyone" })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{refused}");
    assert_eq!(refused["error"], "note_visibility_invalid");

    // List per reader.
    let all = vec![
        private_title.clone(),
        role_title.clone(),
        staff_title.clone(),
    ];
    assert_eq!(listed_titles(&ctx.app, &author.bearer, "").await, all);
    assert_eq!(listed_titles(&ctx.app, &ceo.bearer, "").await, all);
    assert_eq!(
        listed_titles(&ctx.app, &colleague.bearer, "").await,
        vec![role_title.clone(), staff_title.clone()]
    );
    assert_eq!(
        listed_titles(&ctx.app, &interpreter.bearer, "").await,
        vec![staff_title.clone()]
    );
    assert_eq!(
        listed_titles(&ctx.app, &it_admin.bearer, "").await,
        vec![staff_title.clone()]
    );
    // The search never finds a hidden note.
    let search = format!("?q={tag}");
    assert_eq!(
        listed_titles(&ctx.app, &interpreter.bearer, &search).await,
        vec![staff_title.clone()]
    );
    assert_eq!(
        listed_titles(&ctx.app, &colleague.bearer, "?q=private").await,
        Vec::<String>::new()
    );

    // Detail.
    for (reader, id, expected) in [
        (&colleague, &private_id, StatusCode::NOT_FOUND),
        (&interpreter, &role_id, StatusCode::NOT_FOUND),
        (&it_admin, &private_id, StatusCode::NOT_FOUND),
        (&colleague, &role_id, StatusCode::OK),
        (&interpreter, &shared_id, StatusCode::OK),
        (&ceo, &private_id, StatusCode::OK),
        (&author, &private_id, StatusCode::OK),
    ] {
        let (status, body) = json_request(
            &ctx.app,
            "GET",
            &format!("/api/v1/internal-notes/{id}"),
            &reader.bearer,
            None,
        )
        .await;
        assert_eq!(status, expected, "{id}: {body}");
    }

    // Attachments follow the note.
    let (status, with_file) = upload_png(
        &ctx.app,
        &format!("/api/v1/internal-notes/{private_id}/attachments"),
        &author.bearer,
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{with_file}");
    let attachment_id = with_file["attachments"][0]["id"].as_str().unwrap();
    let download =
        format!("/api/v1/internal-notes/{private_id}/attachments/{attachment_id}/download");
    let (status, _) = json_request(&ctx.app, "GET", &download, &colleague.bearer, None).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (status, _) = json_request(&ctx.app, "GET", &download, &ceo.bearer, None).await;
    assert_eq!(status, StatusCode::OK);
    let (status, _) = upload_png(
        &ctx.app,
        &format!("/api/v1/internal-notes/{private_id}/attachments"),
        &colleague.bearer,
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (status, _) = json_request(
        &ctx.app,
        "POST",
        &format!("/api/v1/internal-notes/{private_id}/attachments/{attachment_id}/delete"),
        &colleague.bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    // Edits and archiving need read access too.
    let (status, _) = json_request(
        &ctx.app,
        "POST",
        &format!("/api/v1/internal-notes/{private_id}/update"),
        &colleague.bearer,
        Some(json!({
            "title": "Übernommen",
            "body": null,
            "expected_updated_at": private["updated_at"],
        })),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (status, _) = json_request(
        &ctx.app,
        "POST",
        &format!("/api/v1/internal-notes/{private_id}/archive"),
        &interpreter.bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    // Only the author (or the CEO) changes who reads a note …
    let (status, refused) = json_request(
        &ctx.app,
        "POST",
        &format!("/api/v1/internal-notes/{shared_id}/update"),
        &interpreter.bearer,
        Some(json!({
            "title": staff_title,
            "body": "Ergänzt",
            "expected_updated_at": shared["updated_at"],
            "visibility": "private",
        })),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN, "{refused}");
    assert_eq!(refused["error"], "note_visibility_author_only");
    // … while a reader may still edit the text; the visibility stays.
    let (status, edited) = json_request(
        &ctx.app,
        "POST",
        &format!("/api/v1/internal-notes/{shared_id}/update"),
        &interpreter.bearer,
        Some(json!({
            "title": staff_title,
            "body": "Ergänzt",
            "expected_updated_at": shared["updated_at"],
            "visibility": "staff",
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{edited}");
    assert_eq!(edited["visibility"], "staff");

    // The author narrows the note to the role: the interpreter loses it.
    let (status, narrowed) = json_request(
        &ctx.app,
        "POST",
        &format!("/api/v1/internal-notes/{shared_id}/update"),
        &author.bearer,
        Some(json!({
            "title": staff_title,
            "body": "Ergänzt",
            "expected_updated_at": edited["updated_at"],
            "visibility": "role",
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{narrowed}");
    assert_eq!(narrowed["visibility"], "role");
    assert_eq!(narrowed["visible_role"], "patient_manager");
    assert_eq!(
        listed_titles(&ctx.app, &interpreter.bearer, "").await,
        Vec::<String>::new()
    );
    assert_eq!(
        listed_titles(&ctx.app, &colleague.bearer, "").await,
        vec![role_title.clone(), staff_title.clone()]
    );

    // The CEO may open a private note to everyone; the role snapshot is the
    // author's role, not the CEO's.
    let (status, ceo_shared) = json_request(
        &ctx.app,
        "POST",
        &format!("/api/v1/internal-notes/{private_id}/update"),
        &ceo.bearer,
        Some(json!({
            "title": private_title,
            "body": null,
            "expected_updated_at": with_file["updated_at"],
            "visibility": "role",
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{ceo_shared}");
    assert_eq!(ceo_shared["visible_role"], "patient_manager");
    assert_eq!(
        listed_titles(&ctx.app, &colleague.bearer, "").await,
        vec![private_title, role_title, staff_title]
    );
}

async fn audit_count(pool: &PgPool, action: &str, note_id: &str) -> i64 {
    sqlx::query_scalar(
        "SELECT COUNT(*) FROM audit_log WHERE action = $1 AND entity_type = 'internal_note' AND entity_id = $2::uuid",
    )
    .bind(action)
    .bind(note_id)
    .fetch_one(pool)
    .await
    .unwrap()
}

/// QA E3-02: the visibility is always relative to the author. The CEO saving
/// "role" on a Sales note opens it to Sales (the author's role), never to the
/// CEO's role, and "private" gives it back to the author alone. The API names
/// the author's role so the UI can label the choices from the author's view.
#[tokio::test]
async fn ceo_visibility_choices_apply_to_the_author() {
    let Some(ctx) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let tag = Uuid::new_v4().simple().to_string();
    let pool = &ctx.pool;
    let author = staff(pool, "sales", &tag, "Ben Muster").await;
    let colleague = staff(pool, "sales", &tag, "Mia Muster").await;
    let billing = staff(pool, "billing", &tag, "Viktor Zahler").await;
    let ceo = staff(pool, "ceo", &tag, "Beispiel Chef").await;

    let title = format!("Sales private {tag}");
    let note = create_note(&ctx.app, &author, &title, None).await;
    assert_eq!(note["created_by_role"], "sales");
    let id = note["id"].as_str().unwrap().to_string();

    // The CEO reads the note with the author's role.
    let (status, read) = json_request(
        &ctx.app,
        "GET",
        &format!("/api/v1/internal-notes/{id}"),
        &ceo.bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{read}");
    assert_eq!(read["created_by_role"], "sales");
    assert_eq!(read["visibility"], "private");

    // "Role" chosen by the CEO = the author's role (Sales), not "ceo".
    let (status, shared) = json_request(
        &ctx.app,
        "POST",
        &format!("/api/v1/internal-notes/{id}/update"),
        &ceo.bearer,
        Some(json!({
            "title": title,
            "body": "Ergänzt vom CEO",
            "expected_updated_at": read["updated_at"],
            "visibility": "role",
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{shared}");
    assert_eq!(shared["visibility"], "role");
    assert_eq!(shared["visible_role"], "sales");
    assert_eq!(
        listed_titles(&ctx.app, &colleague.bearer, &format!("?q={tag}")).await,
        vec![title.clone()]
    );
    assert_eq!(
        listed_titles(&ctx.app, &billing.bearer, &format!("?q={tag}")).await,
        Vec::<String>::new()
    );

    // "Private" chosen by the CEO = the author alone again.
    let (status, narrowed) = json_request(
        &ctx.app,
        "POST",
        &format!("/api/v1/internal-notes/{id}/update"),
        &ceo.bearer,
        Some(json!({
            "title": title,
            "body": "Ergänzt vom CEO",
            "expected_updated_at": shared["updated_at"],
            "visibility": "private",
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{narrowed}");
    assert_eq!(narrowed["visibility"], "private");
    assert_eq!(narrowed["visible_role"], Value::Null);
    assert_eq!(
        listed_titles(&ctx.app, &colleague.bearer, &format!("?q={tag}")).await,
        Vec::<String>::new()
    );
    assert_eq!(
        listed_titles(&ctx.app, &author.bearer, &format!("?q={tag}")).await,
        vec![title.clone()]
    );
    // The visibility changes go through the audit channel: wait for them.
    let mut changes = 0;
    for _ in 0..50 {
        changes = audit_count(pool, "update_internal_note_visibility", &id).await;
        if changes >= 2 {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    }
    assert_eq!(changes, 2);
}

/// QA E3-03: the CEO Assistant only reads notes; a shared note is archived
/// only by its author or the CEO; archived notes come back through a
/// restore by the author or the CEO; both steps are audited.
#[tokio::test]
async fn note_writes_follow_role_and_authorship() {
    let Some(ctx) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let tag = Uuid::new_v4().simple().to_string();
    let pool = &ctx.pool;
    let author = staff(pool, "patient_manager", &tag, "Mia Muster").await;
    let colleague = staff(pool, "billing", &tag, "Ben Muster").await;
    let assistant = staff(pool, "ceo_assistant", &tag, "Anna Muster").await;
    let ceo = staff(pool, "ceo", &tag, "Beispiel Chef").await;

    let title = format!("Shared handover {tag}");
    let note = create_note(&ctx.app, &author, &title, Some("staff")).await;
    let id = note["id"].as_str().unwrap().to_string();
    let (status, with_file) = upload_png(
        &ctx.app,
        &format!("/api/v1/internal-notes/{id}/attachments"),
        &author.bearer,
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{with_file}");
    let attachment_id = with_file["attachments"][0]["id"].as_str().unwrap();

    // The assistant reads the shared note and its file …
    assert_eq!(
        listed_titles(&ctx.app, &assistant.bearer, &format!("?q={tag}")).await,
        vec![title.clone()]
    );
    let (status, _) = json_request(
        &ctx.app,
        "GET",
        &format!("/api/v1/internal-notes/{id}/attachments/{attachment_id}/download"),
        &assistant.bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    // … but writes nothing.
    let (status, refused) = json_request(
        &ctx.app,
        "POST",
        "/api/v1/internal-notes",
        &assistant.bearer,
        Some(json!({ "title": format!("Assistent {tag}") })),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN, "{refused}");
    assert_eq!(refused["error"], "note_read_only_role");
    for path in [
        format!("/api/v1/internal-notes/{id}/update"),
        format!("/api/v1/internal-notes/{id}/archive"),
        format!("/api/v1/internal-notes/{id}/restore"),
        format!("/api/v1/internal-notes/{id}/attachments/{attachment_id}/delete"),
    ] {
        let (status, refused) = json_request(
            &ctx.app,
            "POST",
            &path,
            &assistant.bearer,
            Some(json!({
                "title": "Übernommen",
                "body": "Vom Assistenten",
                "expected_updated_at": with_file["updated_at"],
            })),
        )
        .await;
        assert_eq!(status, StatusCode::FORBIDDEN, "{path}: {refused}");
        assert_eq!(refused["error"], "note_read_only_role", "{path}");
    }
    let (status, _) = upload_png(
        &ctx.app,
        &format!("/api/v1/internal-notes/{id}/attachments"),
        &assistant.bearer,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, unchanged) = json_request(
        &ctx.app,
        "GET",
        &format!("/api/v1/internal-notes/{id}"),
        &author.bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(unchanged["body"], "Synthetische Übergabe");
    assert_eq!(unchanged["attachments"].as_array().unwrap().len(), 1);

    // A colleague who reads the shared note may not archive it.
    let (status, refused) = json_request(
        &ctx.app,
        "POST",
        &format!("/api/v1/internal-notes/{id}/archive"),
        &colleague.bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN, "{refused}");
    assert_eq!(refused["error"], "note_archive_author_only");

    // The author archives it: gone from every live list, audited.
    let (status, _) = json_request(
        &ctx.app,
        "POST",
        &format!("/api/v1/internal-notes/{id}/archive"),
        &author.bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    assert_eq!(audit_count(pool, "archive_internal_note", &id).await, 1);
    for reader in [&author, &colleague, &ceo] {
        assert_eq!(
            listed_titles(&ctx.app, &reader.bearer, &format!("?q={tag}")).await,
            Vec::<String>::new()
        );
    }
    let (status, _) = json_request(
        &ctx.app,
        "GET",
        &format!("/api/v1/internal-notes/{id}"),
        &author.bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    // The archive lists what the reader may restore: own notes, the CEO all.
    let archive = format!("?archived=true&q={tag}");
    assert_eq!(
        listed_titles(&ctx.app, &author.bearer, &archive).await,
        vec![title.clone()]
    );
    assert_eq!(
        listed_titles(&ctx.app, &ceo.bearer, &archive).await,
        vec![title.clone()]
    );
    assert_eq!(
        listed_titles(&ctx.app, &colleague.bearer, &archive).await,
        Vec::<String>::new()
    );
    let (status, archived_rows) = json_request(
        &ctx.app,
        "GET",
        &format!("/api/v1/internal-notes{archive}"),
        &author.bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(
        archived_rows[0]["archived_at"].is_string(),
        "{archived_rows}"
    );

    // Only the author or the CEO restores; for others it does not exist.
    let (status, _) = json_request(
        &ctx.app,
        "POST",
        &format!("/api/v1/internal-notes/{id}/restore"),
        &colleague.bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (status, restored) = json_request(
        &ctx.app,
        "POST",
        &format!("/api/v1/internal-notes/{id}/restore"),
        &ceo.bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{restored}");
    assert_eq!(restored["title"], title);
    assert_eq!(restored["visibility"], "staff");
    assert_eq!(restored["attachments"].as_array().unwrap().len(), 1);
    assert_eq!(audit_count(pool, "restore_internal_note", &id).await, 1);
    assert_eq!(
        listed_titles(&ctx.app, &colleague.bearer, &format!("?q={tag}")).await,
        vec![title.clone()]
    );
    // A live note is not restored again.
    let (status, _) = json_request(
        &ctx.app,
        "POST",
        &format!("/api/v1/internal-notes/{id}/restore"),
        &author.bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    // The CEO archives someone else's note as well.
    let (status, _) = json_request(
        &ctx.app,
        "POST",
        &format!("/api/v1/internal-notes/{id}/archive"),
        &ceo.bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    assert_eq!(audit_count(pool, "archive_internal_note", &id).await, 2);
}
