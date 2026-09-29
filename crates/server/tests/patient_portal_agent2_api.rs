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

async fn seed_order(pool: &PgPool, patient_id: Uuid, created_by: Uuid, tag: &str) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO orders (order_number, patient_id, phase, status, created_by)
           VALUES ($1, $2, 'execution', 'active', $3)
           RETURNING id"#,
    )
    .bind(format!("ORD-{tag}"))
    .bind(patient_id)
    .bind(created_by)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn seed_document(
    pool: &PgPool,
    patient_id: Uuid,
    uploaded_by: Uuid,
    title: &str,
    visibility: &str,
) -> Uuid {
    let document_id = Uuid::new_v4();
    sqlx::query_scalar(
        r#"INSERT INTO documents (
                id, patient_id, auto_name, original_filename, art, category,
                status, visibility, is_medical, mime_type, uploaded_by,
                version_root_document_id
           ) VALUES (
                $1, $2, $3, $4, 'medical_report', 'medical_report',
                'active', $5, true, 'application/pdf', $6,
                $1
           )
           RETURNING id"#,
    )
    .bind(document_id)
    .bind(patient_id)
    .bind(title)
    .bind(format!("{title}.pdf"))
    .bind(visibility)
    .bind(uploaded_by)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn share_document_with_user(
    pool: &PgPool,
    document_id: Uuid,
    user_id: Uuid,
    shared_by: Uuid,
) {
    sqlx::query(
        r#"INSERT INTO document_shares (
                document_id, shared_with_user_id, shared_by, channel, requires_confirmation
           ) VALUES ($1, $2, $3, 'patient_portal', true)"#,
    )
    .bind(document_id)
    .bind(user_id)
    .bind(shared_by)
    .execute(pool)
    .await
    .unwrap();
}

#[tokio::test]
async fn patient_sees_only_portal_visible_recommendations_and_can_decide() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };
    let tag = unique_tag("agent2-rec");
    let pm_id = seed_user(&pool, &tag, "patient_manager").await;
    let patient_user_id = seed_user(&pool, &tag, "patient").await;
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    seed_patient_assignment(&pool, patient_id, pm_id, admin_id).await;
    seed_patient_assignment(&pool, patient_id, patient_user_id, admin_id).await;
    let order_id = seed_order(&pool, patient_id, admin_id, &tag).await;

    let pm_auth = auth_header_for(pm_id, "patient_manager");
    let patient_auth = auth_header_for(patient_user_id, "patient");

    let (status, visible) = json_request(
        &app,
        "POST",
        &format!("/api/v1/patients/{patient_id}/recommendations"),
        &pm_auth,
        Some(json!({
            "title": "Book cardiology follow-up",
            "recommendation_type": "follow_up",
            "source_order_id": order_id,
            "portal_visible": true
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{visible}");
    let recommendation_id = visible["id"].as_str().expect("recommendation id");

    let (status, hidden) = json_request(
        &app,
        "POST",
        &format!("/api/v1/patients/{patient_id}/recommendations"),
        &pm_auth,
        Some(json!({
            "title": "Internal staff-only note",
            "recommendation_type": "other",
            "portal_visible": false
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{hidden}");

    let (status, list) = json_request(
        &app,
        "GET",
        "/api/v1/me/recommendations",
        &patient_auth,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{list}");
    let rows = list.as_array().expect("recommendation list");
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0]["title"], "Book cardiology follow-up");
    assert_eq!(rows[0]["source_order_id"], json!(order_id));
    assert!(
        rows[0]["source_order_number"]
            .as_str()
            .is_some_and(|value| value.starts_with("ORD-agent2-rec-"))
    );

    let (status, actions) =
        json_request(&app, "GET", "/api/v1/me/next-actions", &patient_auth, None).await;
    assert_eq!(status, StatusCode::OK, "{actions}");
    let recommendation_titles: Vec<String> = actions["items"]
        .as_array()
        .expect("next action items")
        .iter()
        .filter(|item| item["kind"] == "recommendation")
        .filter_map(|item| item["title"].as_str().map(ToString::to_string))
        .collect();
    assert!(
        recommendation_titles
            .iter()
            .any(|title| title == "Book cardiology follow-up")
    );
    assert!(
        !recommendation_titles
            .iter()
            .any(|title| title == "Internal staff-only note")
    );

    let (status, decision) = json_request(
        &app,
        "POST",
        &format!("/api/v1/me/recommendations/{recommendation_id}/decision"),
        &patient_auth,
        Some(json!({ "decision": "already_done", "note": "Done outside GMED" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{decision}");
    assert_eq!(decision["patient_decision"], "already_done");
    assert_eq!(decision["status"], "completed");

    let decision_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM patient_recommendation_decisions WHERE recommendation_id = $1",
    )
    .bind(Uuid::parse_str(recommendation_id).unwrap())
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(decision_count, 1);
}

#[tokio::test]
async fn next_actions_uses_invoice_visibility_contract() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };
    let tag = unique_tag("agent2-next");
    let patient_user_id = seed_user(&pool, &tag, "patient").await;
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    seed_patient_assignment(&pool, patient_id, patient_user_id, admin_id).await;
    let order_id = seed_order(&pool, patient_id, admin_id, &tag).await;

    for (suffix, hide_amounts, pdf_visible) in [
        ("VISIBLE", false, true),
        ("HIDDEN", true, true),
        ("NOPDF", false, false),
    ] {
        sqlx::query(
            r#"INSERT INTO invoices (
                    order_id, patient_id, invoice_number, invoice_type, status,
                    due_date, total_net, total_vat, total_gross, paid_amount,
                    line_items, created_by, portal_visible, hide_amounts_from_patient,
                    pdf_visible_to_patient
               ) VALUES (
                    $1, $2, $3, 'final', 'sent',
                    current_date + 7, 100, 19, 119, 0,
                    '[]'::jsonb, $4, true, $5, $6
               )"#,
        )
        .bind(order_id)
        .bind(patient_id)
        .bind(format!("INV-{tag}-{suffix}"))
        .bind(admin_id)
        .bind(hide_amounts)
        .bind(pdf_visible)
        .execute(&pool)
        .await
        .unwrap();
    }

    let patient_auth = auth_header_for(patient_user_id, "patient");
    let (status, body) =
        json_request(&app, "GET", "/api/v1/me/next-actions", &patient_auth, None).await;
    assert_eq!(status, StatusCode::OK, "{body}");

    let titles: Vec<String> = body["items"]
        .as_array()
        .expect("items")
        .iter()
        .filter(|item| item["kind"] == "invoice_payment")
        .filter_map(|item| item["title"].as_str().map(ToString::to_string))
        .collect();

    assert!(titles.iter().any(|title| title.ends_with("VISIBLE")));
    assert!(titles.iter().any(|title| title.ends_with("NOPDF")));
    assert!(!titles.iter().any(|title| title.ends_with("HIDDEN")));

    let nopdf = body["items"]
        .as_array()
        .unwrap()
        .iter()
        .find(|item| {
            item["title"]
                .as_str()
                .is_some_and(|title| title.ends_with("NOPDF"))
        })
        .expect("nopdf invoice action");
    assert_eq!(nopdf["metadata"]["pdf_action_visible"], false);
}

#[tokio::test]
async fn next_actions_send_the_visit_time_as_a_berlin_instant() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };
    let tag = unique_tag("agent2-visit");
    let patient_user_id = seed_user(&pool, &tag, "patient").await;
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    seed_patient_assignment(&pool, patient_id, patient_user_id, admin_id).await;
    let visit_date = gmed_server::app_time::today() + chrono::Duration::days(1);
    sqlx::query(
        r#"INSERT INTO appointments (
                patient_id, appointment_type, title, date, time_start, time_end,
                status, created_by
           ) VALUES ($1, 'medical', 'Clinic follow-up', $2, '09:00', '10:00', 'planned', $3)"#,
    )
    .bind(patient_id)
    .bind(visit_date)
    .bind(admin_id)
    .execute(&pool)
    .await
    .unwrap();

    let patient_auth = auth_header_for(patient_user_id, "patient");
    let (status, body) =
        json_request(&app, "GET", "/api/v1/me/next-actions", &patient_auth, None).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let visit = body["items"]
        .as_array()
        .expect("items")
        .iter()
        .find(|item| item["kind"] == "upcoming_appointment")
        .expect("upcoming appointment action");

    // 09:00 German time as an instant with an offset: a browser in another
    // time zone shows 09:00, not its own reading of a naive 09:00.
    let expected = gmed_server::app_time::from_local(visit_date.and_hms_opt(9, 0, 0).unwrap());
    let due_at = visit["due_at"].as_str().expect("appointment due_at");
    assert_eq!(
        chrono::DateTime::parse_from_rfc3339(due_at).expect("RFC 3339 due_at"),
        expected
    );
    // The wall-clock values stay as they are.
    assert_eq!(visit["metadata"]["date"], json!(visit_date.to_string()));
    assert_eq!(visit["metadata"]["time_start"], "09:00");
    assert_eq!(visit["metadata"]["time_end"], "10:00");
}

#[tokio::test]
async fn patient_translation_request_requires_own_visible_document() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };
    let tag = unique_tag("agent2-doc");
    let patient_user_id = seed_user(&pool, &tag, "patient").await;
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let other_patient_id = seed_patient(&pool, admin_id, &format!("{tag}-other")).await;
    seed_patient_assignment(&pool, patient_id, patient_user_id, admin_id).await;

    let visible_doc = seed_document(
        &pool,
        patient_id,
        admin_id,
        &format!("Visible {tag}"),
        "patient_visible",
    )
    .await;
    share_document_with_user(&pool, visible_doc, patient_user_id, admin_id).await;
    let internal_doc = seed_document(
        &pool,
        patient_id,
        admin_id,
        &format!("Internal {tag}"),
        "internal",
    )
    .await;
    let other_doc = seed_document(
        &pool,
        other_patient_id,
        admin_id,
        &format!("Other {tag}"),
        "patient_visible",
    )
    .await;

    let patient_auth = auth_header_for(patient_user_id, "patient");
    let (status, created) = json_request(
        &app,
        "POST",
        &format!("/api/v1/me/documents/{visible_doc}/translation-requests"),
        &patient_auth,
        Some(json!({ "requested_language": "xx", "note": "Unknown language" })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{created}");
    assert_eq!(created["message"], "Unknown translation target language");

    let (status, created) = json_request(
        &app,
        "POST",
        &format!("/api/v1/me/documents/{visible_doc}/translation-requests"),
        &patient_auth,
        Some(json!({ "requested_language": "de", "note": "Need German copy" })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{created}");
    assert_eq!(created["requested_language"], "de");
    assert_eq!(created["request_source"], "patient_portal");

    for forbidden_doc in [internal_doc, other_doc] {
        let (status, body) = json_request(
            &app,
            "POST",
            &format!("/api/v1/me/documents/{forbidden_doc}/translation-requests"),
            &patient_auth,
            Some(json!({ "requested_language": "de" })),
        )
        .await;
        assert_eq!(status, StatusCode::NOT_FOUND, "{body}");
    }

    let (status, list) = json_request(
        &app,
        "GET",
        "/api/v1/me/translation-requests",
        &patient_auth,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{list}");
    assert_eq!(list.as_array().expect("translation request list").len(), 1);

    let row = sqlx::query(
        "SELECT request_source FROM document_translation_requests WHERE document_id = $1",
    )
    .bind(visible_doc)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        row.try_get::<String, _>("request_source").unwrap(),
        "patient_portal"
    );
}

/// The patient sees only what was published: the processing note a manager
/// keeps on the document card and the name of whoever released the document
/// stay internal (QA C-12).
#[tokio::test]
async fn portal_document_leaves_out_processing_notes_and_releasing_staff() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };
    let tag = unique_tag("agent2-doc-notes");
    let pm_id = seed_user(&pool, &tag, "patient_manager").await;
    let patient_user_id = seed_user(&pool, &tag, "patient").await;
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    seed_patient_assignment(&pool, patient_id, pm_id, admin_id).await;
    seed_patient_assignment(&pool, patient_id, patient_user_id, admin_id).await;

    let internal_note = "Qa: Enforcement-Test (medizinisch abgewaehlt)";
    let document_id = seed_document(
        &pool,
        patient_id,
        pm_id,
        &format!("Kardiologie-Befund {tag}"),
        "released_internal",
    )
    .await;
    sqlx::query("UPDATE documents SET notes = $2 WHERE id = $1")
        .bind(document_id)
        .bind(internal_note)
        .execute(&pool)
        .await
        .unwrap();

    let pm_auth = auth_header_for(pm_id, "patient_manager");
    let (status, released) = json_request(
        &app,
        "POST",
        &format!("/api/v1/documents/{document_id}/portal-release"),
        &pm_auth,
        Some(json!({ "channel": "patient_portal", "requires_confirmation": false })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{released}");

    let patient_auth = auth_header_for(patient_user_id, "patient");
    let (status, list) =
        json_request(&app, "GET", "/api/v1/me/documents", &patient_auth, None).await;
    assert_eq!(status, StatusCode::OK, "{list}");
    let rows = list.as_array().expect("released documents");
    assert_eq!(rows.len(), 1, "{list}");
    assert_eq!(rows[0]["id"], json!(document_id));
    assert!(rows[0].get("notes").is_none(), "{list}");
    assert!(rows[0].get("shared_by_name").is_none(), "{list}");
    let payload = list.to_string();
    assert!(!payload.contains(internal_note), "{payload}");
    assert!(
        !payload.contains(&format!("patient_manager {tag}")),
        "{payload}"
    );

    // The manager keeps the note on the document card.
    let (status, detail) = json_request(
        &app,
        "GET",
        &format!("/api/v1/documents/{document_id}"),
        &pm_auth,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{detail}");
    assert_eq!(detail["notes"], internal_note);
}

#[tokio::test]
async fn portal_recommendations_leave_out_staff_only_fields() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };
    let tag = unique_tag("agent2-rec-internal");
    let pm_id = seed_user(&pool, &tag, "patient_manager").await;
    let patient_user_id = seed_user(&pool, &tag, "patient").await;
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    seed_patient_assignment(&pool, patient_id, pm_id, admin_id).await;
    seed_patient_assignment(&pool, patient_id, patient_user_id, admin_id).await;
    let pm_auth = auth_header_for(pm_id, "patient_manager");
    let patient_auth = auth_header_for(patient_user_id, "patient");

    let (status, created) = json_request(
        &app,
        "POST",
        &format!("/api/v1/patients/{patient_id}/recommendations"),
        &pm_auth,
        Some(json!({
            "title": "Kardiologische Kontrolle",
            "recommendation_type": "follow_up",
            "portal_visible": true,
            "lifecycle_status": "aktiv",
            "outcome_note": "Intern: Ergebnis offen",
            "outcome_at": "2026-12-31",
            "note_intern": "Intern: Patient erinnern"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{created}");
    assert_eq!(created["note_intern"], "Intern: Patient erinnern");
    let recommendation_id = created["id"].as_str().expect("recommendation id");

    let staff_only = [
        "note_intern",
        "lifecycle_status",
        "outcome_note",
        "outcome_at",
        "created_by",
        "created_by_name",
        "updated_by",
        "updated_by_name",
    ];
    let (status, list) = json_request(
        &app,
        "GET",
        "/api/v1/me/recommendations",
        &patient_auth,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{list}");
    let rows = list.as_array().expect("recommendation list");
    assert_eq!(rows.len(), 1, "{list}");
    assert_eq!(rows[0]["title"], "Kardiologische Kontrolle");
    for key in staff_only {
        assert!(rows[0].get(key).is_none(), "{key} in {list}");
    }
    assert!(!list.to_string().contains("Intern:"), "{list}");

    let (status, decision) = json_request(
        &app,
        "POST",
        &format!("/api/v1/me/recommendations/{recommendation_id}/decision"),
        &patient_auth,
        Some(json!({ "decision": "need_consultation", "note": "Bitte anrufen" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{decision}");
    for key in staff_only {
        assert!(decision.get(key).is_none(), "{key} in {decision}");
    }

    // The manager keeps the internal fields.
    let (status, staff_list) = json_request(
        &app,
        "GET",
        &format!("/api/v1/patients/{patient_id}/recommendations"),
        &pm_auth,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{staff_list}");
    let staff_row = staff_list
        .as_array()
        .expect("staff recommendation list")
        .iter()
        .find(|row| row["id"] == recommendation_id)
        .expect("staff sees the recommendation");
    assert_eq!(staff_row["note_intern"], "Intern: Patient erinnern");
    assert_eq!(staff_row["outcome_note"], "Intern: Ergebnis offen");
}

#[tokio::test]
async fn portal_translation_requests_leave_out_staff_working_data() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };
    let tag = unique_tag("agent2-translation-internal");
    let patient_user_id = seed_user(&pool, &tag, "patient").await;
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    seed_patient_assignment(&pool, patient_id, patient_user_id, admin_id).await;
    let document_id = seed_document(
        &pool,
        patient_id,
        admin_id,
        &format!("Visible {tag}"),
        "patient_visible",
    )
    .await;
    share_document_with_user(&pool, document_id, patient_user_id, admin_id).await;

    let patient_auth = auth_header_for(patient_user_id, "patient");
    let (status, created) = json_request(
        &app,
        "POST",
        &format!("/api/v1/me/documents/{document_id}/translation-requests"),
        &patient_auth,
        Some(json!({ "requested_language": "de", "note": "Need German copy" })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{created}");
    let request_id = created["id"].as_str().expect("translation request id");

    let admin_auth = auth_header_for(admin_id, "ceo");
    let (status, updated) = json_request(
        &app,
        "POST",
        &format!("/api/v1/documents/translation-requests/{request_id}/update"),
        &admin_auth,
        Some(json!({
            "status": "in_progress",
            "note": "Intern: Glossar pruefen",
            "source_text": "OCR Rohtext",
            "translated_text": "Entwurf der Uebersetzung"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{updated}");

    let (status, list) = json_request(
        &app,
        "GET",
        "/api/v1/me/translation-requests",
        &patient_auth,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{list}");
    let rows = list.as_array().expect("translation request list");
    assert_eq!(rows.len(), 1, "{list}");
    assert_eq!(rows[0]["status"], "in_progress");
    for key in [
        "note",
        "source_text",
        "translated_text",
        "translated_by",
        "translated_by_name",
    ] {
        assert!(rows[0].get(key).is_none(), "{key} in {list}");
    }
    let payload = list.to_string();
    assert!(!payload.contains("Intern:"), "{payload}");
    assert!(!payload.contains("Entwurf"), "{payload}");

    // Staff keep the working note.
    let (status, staff_list) = json_request(
        &app,
        "GET",
        &format!("/api/v1/documents/{document_id}/translation-requests"),
        &admin_auth,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{staff_list}");
    let staff_row = staff_list
        .as_array()
        .expect("staff translation request list")
        .iter()
        .find(|row| row["id"] == request_id)
        .expect("staff sees the request");
    assert_eq!(staff_row["note"], "Intern: Glossar pruefen");
}
