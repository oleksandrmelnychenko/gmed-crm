mod support;

use axum::body::Body;
use axum::http::{Method, Request, StatusCode};
use serde_json::{Value, json};
use sqlx::PgPool;
use tower::ServiceExt;
use uuid::Uuid;

use gmed_server::auth::jwt;

const TEST_SECRET: &str = "test-secret-at-least-32-characters-long!!";

async fn json_request(
    app: &axum::Router,
    method: Method,
    path: &str,
    bearer: &str,
    body: Option<Value>,
) -> (StatusCode, Value) {
    let request = Request::builder()
        .method(method)
        .uri(path)
        .header("Authorization", bearer)
        .header("Content-Type", "application/json")
        .body(Body::from(
            body.map(|value| value.to_string()).unwrap_or_default(),
        ))
        .unwrap();
    let response = app.clone().oneshot(request).await.unwrap();
    let status = response.status();
    let bytes = axum::body::to_bytes(response.into_body(), 2 * 1024 * 1024)
        .await
        .unwrap();
    let payload = serde_json::from_slice(&bytes).unwrap_or(json!(null));
    (status, payload)
}

fn auth_header_for(user_id: Uuid, role: &str) -> String {
    let token = jwt::issue_access_token(TEST_SECRET, user_id, role, Uuid::new_v4()).unwrap();
    format!("Bearer {token}")
}

async fn seed_user(pool: &PgPool, role: &str) -> Uuid {
    let suffix = Uuid::new_v4().simple().to_string();
    sqlx::query_scalar(
        r#"INSERT INTO users (email, password_hash, name, role)
           VALUES ($1, 'test-password-hash', $2, $3)
           RETURNING id"#,
    )
    .bind(format!("medication-evidence-{role}-{suffix}@example.com"))
    .bind(format!("Medication evidence {role}"))
    .bind(role)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn seed_patient(pool: &PgPool, created_by: Uuid, label: &str) -> Uuid {
    let suffix = Uuid::new_v4().simple().to_string();
    sqlx::query_scalar(
        r#"INSERT INTO patients (
               patient_id, first_name, last_name, birth_date, gender, created_by, languages
           ) VALUES ($1, $2, 'PrivateSurname', '1990-01-01', 'diverse', $3, ARRAY['de']::text[])
           RETURNING id"#,
    )
    .bind(format!("PT-EVIDENCE-{suffix}"))
    .bind(label)
    .bind(created_by)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn seed_duplicate_medications(pool: &PgPool, patient_id: Uuid, substance: &str) {
    sqlx::query(
        r#"INSERT INTO patient_medications (
               patient_id, wirkstoff, handelsname, status, on_hold,
               source_identifiers, sort_order
           ) VALUES
               ($1, $2, 'Private Brand Alpha', 'aktiv', false,
                '{"atc_code":"M01AE01"}'::jsonb, 0),
               ($1, $2, 'Private Brand Beta', 'aktiv', false,
                '{"pzn":"01234567"}'::jsonb, 1)"#,
    )
    .bind(patient_id)
    .bind(substance)
    .execute(pool)
    .await
    .unwrap();
}

#[tokio::test]
async fn ceo_creates_privacy_minimized_local_review_with_bound_citations() {
    let Some(ctx) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let patient_id = seed_patient(&ctx.pool, ctx.admin_id, "PrivateGivenName").await;
    let substance = format!("EvidenceSubstance-{}", Uuid::new_v4().simple());
    seed_duplicate_medications(&ctx.pool, patient_id, &substance).await;
    sqlx::query(
        r#"INSERT INTO patient_medications (
               patient_id, wirkstoff, handelsname, status, on_hold,
               source_identifiers, sort_order
           ) VALUES
               ($1, 'Unresolved Evidence One', 'Private Brand Gamma',
                'aktiv', false, '{}'::jsonb, 2),
               ($1, 'Unresolved Evidence Two', 'Private Brand Delta',
                'aktiv', false, '{}'::jsonb, 3)"#,
    )
    .bind(patient_id)
    .execute(&ctx.pool)
    .await
    .unwrap();
    let manager_id = seed_user(&ctx.pool, "patient_manager").await;
    let ceo = auth_header_for(ctx.admin_id, "ceo");
    let manager = auth_header_for(manager_id, "patient_manager");
    let preview_path = format!("/api/v1/patients/{patient_id}/medication-evidence-reviews/preview");

    let (denied, _) = json_request(&ctx.app, Method::GET, &preview_path, &manager, None).await;
    assert_eq!(denied, StatusCode::FORBIDDEN);

    let (preview_status, preview) =
        json_request(&ctx.app, Method::GET, &preview_path, &ceo, None).await;
    assert_eq!(preview_status, StatusCode::OK, "{preview}");
    assert_eq!(preview["mode"], "local_evidence_only");
    assert_eq!(preview["provider"]["kind"], "none");
    assert_eq!(preview["provider"]["status"], "not_configured");
    assert_eq!(preview["provider"]["external_calls_enabled"], false);
    assert_eq!(preview["clinical_review"]["status"], "not_configured");
    assert_eq!(preview["clinical_review"]["can_approve"], false);
    assert_eq!(preview["permissions"]["can_create_review"], true);
    assert_eq!(preview["permissions"]["can_read_review"], true);
    assert_eq!(preview["medication_ids"].as_array().unwrap().len(), 4);
    assert_eq!(preview["summary"]["missing_data_total"], 2);

    let collection_path = format!("/api/v1/patients/{patient_id}/medication-evidence-reviews");
    let body = json!({
        "intelligence_fingerprint": preview["intelligence_fingerprint"],
        "idempotency_key": format!("evidence-review-{patient_id}"),
    });
    let (created_status, created) = json_request(
        &ctx.app,
        Method::POST,
        &collection_path,
        &ceo,
        Some(body.clone()),
    )
    .await;
    assert_eq!(created_status, StatusCode::CREATED, "{created}");
    assert_eq!(created["review"]["status"], "draft_ready");
    assert_eq!(created["bundle"]["version"], "medication-evidence-v1");
    assert_eq!(created["clinical_review"]["can_approve"], false);
    assert!(created.get("approve").is_none());
    assert!(created.get("model").is_none());
    assert_eq!(
        created["bundle"]["missing_data"].as_array().unwrap().len(),
        1
    );

    let duplicate = created["bundle"]["findings"]
        .as_array()
        .unwrap()
        .iter()
        .find(|finding| finding["category"] == "duplicate_active_ingredient")
        .expect("duplicate finding projected into evidence bundle");
    assert_eq!(duplicate["substances"][0], substance);
    let duplicate_citation = duplicate["citation_ref"].as_str().unwrap();
    assert!(
        created["bundle"]["citations"]
            .as_array()
            .unwrap()
            .iter()
            .any(|citation| citation["id"] == duplicate_citation)
    );
    assert!(
        created["draft"]["verification_questions"]
            .as_array()
            .unwrap()
            .iter()
            .any(|question| question["citation_refs"]
                .as_array()
                .unwrap()
                .iter()
                .any(|reference| reference.as_str() == Some(duplicate_citation)))
    );

    let allowed = created["bundle"]["citations"]
        .as_array()
        .unwrap()
        .iter()
        .map(|citation| citation["id"].as_str().unwrap())
        .collect::<std::collections::HashSet<_>>();
    for reference in created["draft"]["citation_refs"].as_array().unwrap() {
        assert!(allowed.contains(reference.as_str().unwrap()));
    }

    let serialized = created.to_string();
    assert!(!serialized.contains("PrivateGivenName"));
    assert!(!serialized.contains("PrivateSurname"));
    assert!(!serialized.contains("1990-01-01"));
    assert!(!serialized.contains("Private Brand Alpha"));
    assert!(!serialized.contains("Private Brand Beta"));
    assert!(!serialized.contains("Private Brand Gamma"));
    assert!(!serialized.contains("Private Brand Delta"));
    assert!(!serialized.contains("dosage_change"));
    assert!(!serialized.contains("treatment_change"));

    let (replay_status, replay) =
        json_request(&ctx.app, Method::POST, &collection_path, &ceo, Some(body)).await;
    assert_eq!(replay_status, StatusCode::OK, "{replay}");
    assert_eq!(replay["review"]["id"], created["review"]["id"]);

    let review_path = format!(
        "/api/v1/patients/{patient_id}/medication-evidence-reviews/{}",
        created["review"]["id"].as_str().unwrap()
    );
    let (get_status, loaded) = json_request(&ctx.app, Method::GET, &review_path, &ceo, None).await;
    assert_eq!(get_status, StatusCode::OK, "{loaded}");
    assert_eq!(loaded, created);
}

#[tokio::test]
async fn fingerprint_and_idempotency_are_stale_safe_and_bundle_reuse_is_immutable() {
    let Some(ctx) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let first_patient = seed_patient(&ctx.pool, ctx.admin_id, "FirstPrivate").await;
    let second_patient = seed_patient(&ctx.pool, ctx.admin_id, "SecondPrivate").await;
    let substance = format!("StableSubstance-{}", Uuid::new_v4().simple());
    seed_duplicate_medications(&ctx.pool, first_patient, &substance).await;
    seed_duplicate_medications(&ctx.pool, second_patient, &substance).await;
    let ceo = auth_header_for(ctx.admin_id, "ceo");

    let first_preview_path =
        format!("/api/v1/patients/{first_patient}/medication-evidence-reviews/preview");
    let (_, first_preview) =
        json_request(&ctx.app, Method::GET, &first_preview_path, &ceo, None).await;
    let first_collection = format!("/api/v1/patients/{first_patient}/medication-evidence-reviews");
    let shared_key = format!("shared-evidence-key-{}", Uuid::new_v4());
    let first_body = json!({
        "intelligence_fingerprint": first_preview["intelligence_fingerprint"],
        "idempotency_key": shared_key,
    });
    let (first_status, first) = json_request(
        &ctx.app,
        Method::POST,
        &first_collection,
        &ceo,
        Some(first_body),
    )
    .await;
    assert_eq!(first_status, StatusCode::CREATED, "{first}");

    let second_body_same_fingerprint = json!({
        "intelligence_fingerprint": first_preview["intelligence_fingerprint"],
        "idempotency_key": format!("new-key-{}", Uuid::new_v4()),
    });
    let (second_status, second) = json_request(
        &ctx.app,
        Method::POST,
        &first_collection,
        &ceo,
        Some(second_body_same_fingerprint),
    )
    .await;
    assert_eq!(second_status, StatusCode::CREATED, "{second}");
    assert_ne!(second["review"]["id"], first["review"]["id"]);
    assert_eq!(second["review"]["bundle_id"], first["review"]["bundle_id"]);

    let second_collection =
        format!("/api/v1/patients/{second_patient}/medication-evidence-reviews");
    let (_, second_preview) = json_request(
        &ctx.app,
        Method::GET,
        &format!("/api/v1/patients/{second_patient}/medication-evidence-reviews/preview"),
        &ceo,
        None,
    )
    .await;
    let (cross_patient_status, cross_patient_body) = json_request(
        &ctx.app,
        Method::POST,
        &second_collection,
        &ceo,
        Some(json!({
            "intelligence_fingerprint": second_preview["intelligence_fingerprint"],
            "idempotency_key": shared_key,
        })),
    )
    .await;
    assert_eq!(
        cross_patient_status,
        StatusCode::CONFLICT,
        "{cross_patient_body}"
    );
    assert!(
        !cross_patient_body
            .to_string()
            .contains(&first["review"]["id"].to_string())
    );

    sqlx::query(
        r#"UPDATE patient_medications
           SET wirkstoff = wirkstoff || '-changed'
           WHERE patient_id = $1
             AND id = (SELECT id FROM patient_medications WHERE patient_id = $1 LIMIT 1)"#,
    )
    .bind(first_patient)
    .execute(&ctx.pool)
    .await
    .unwrap();
    let (stale_status, stale_body) = json_request(
        &ctx.app,
        Method::POST,
        &first_collection,
        &ceo,
        Some(json!({
            "intelligence_fingerprint": first_preview["intelligence_fingerprint"],
            "idempotency_key": format!("stale-{}", Uuid::new_v4()),
        })),
    )
    .await;
    assert_eq!(stale_status, StatusCode::CONFLICT, "{stale_body}");
}

#[tokio::test]
async fn patient_privacy_erasure_cascades_review_graph() {
    let Some(ctx) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let patient_id = seed_patient(&ctx.pool, ctx.admin_id, "ErasePrivate").await;
    seed_duplicate_medications(&ctx.pool, patient_id, "EraseEvidenceSubstance").await;
    let ceo = auth_header_for(ctx.admin_id, "ceo");
    let preview_path = format!("/api/v1/patients/{patient_id}/medication-evidence-reviews/preview");
    let (_, preview) = json_request(&ctx.app, Method::GET, &preview_path, &ceo, None).await;
    let collection = format!("/api/v1/patients/{patient_id}/medication-evidence-reviews");
    let (status, created) = json_request(
        &ctx.app,
        Method::POST,
        &collection,
        &ceo,
        Some(json!({
            "intelligence_fingerprint": preview["intelligence_fingerprint"],
            "idempotency_key": format!("erase-{}", Uuid::new_v4()),
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{created}");
    let review_id = Uuid::parse_str(created["review"]["id"].as_str().unwrap()).unwrap();
    let bundle_id = Uuid::parse_str(created["review"]["bundle_id"].as_str().unwrap()).unwrap();

    sqlx::query("DELETE FROM patients WHERE id = $1")
        .bind(patient_id)
        .execute(&ctx.pool)
        .await
        .unwrap();
    let request_count: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM medication_evidence_review_requests WHERE id = $1",
    )
    .bind(review_id)
    .fetch_one(&ctx.pool)
    .await
    .unwrap();
    let bundle_count: i64 =
        sqlx::query_scalar("SELECT count(*) FROM medication_evidence_bundles WHERE id = $1")
            .bind(bundle_id)
            .fetch_one(&ctx.pool)
            .await
            .unwrap();
    assert_eq!(request_count, 0);
    assert_eq!(bundle_count, 0);
}
