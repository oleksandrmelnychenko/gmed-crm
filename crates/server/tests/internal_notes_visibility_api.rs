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
