mod support;

use axum::body::Body;
use axum::http::{Method, Request, StatusCode};
use serde_json::{Value, json};
use sqlx::{PgPool, Row};
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
    .bind(format!("medication-identity-{role}-{suffix}@example.com"))
    .bind(format!("Medication identity {role}"))
    .bind(role)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn seed_patient(pool: &PgPool, created_by: Uuid) -> Uuid {
    let suffix = Uuid::new_v4().simple().to_string();
    sqlx::query_scalar(
        r#"INSERT INTO patients (
               patient_id, first_name, last_name, birth_date, gender, created_by, languages
           ) VALUES ($1, 'Medication', 'Identity', '1990-01-01', 'diverse', $2, ARRAY['de']::text[])
           RETURNING id"#,
    )
    .bind(format!("PT-MEDID-{suffix}"))
    .bind(created_by)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn seed_medication(
    pool: &PgPool,
    patient_id: Uuid,
    brand_name: &str,
    substance: &str,
    strength: &str,
) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO patient_medications (
               patient_id, wirkstoff, handelsname, staerke, form, status,
               on_hold, source_country, source_identifiers, sort_order
           ) VALUES ($1, $2, $3, $4, 'Filmtablette', 'aktiv', false, 'DE', '{}'::jsonb, 0)
           RETURNING id"#,
    )
    .bind(patient_id)
    .bind(substance)
    .bind(brand_name)
    .bind(strength)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn seed_product(pool: &PgPool, brand_name: &str, substance: &str, strength: &str) -> Uuid {
    let normalized_substance = substance.trim().to_lowercase();
    let substance_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO drug_substances (name, normalized_name)
           VALUES ($1, $2)
           ON CONFLICT (normalized_name) DO UPDATE SET name = EXCLUDED.name
           RETURNING id"#,
    )
    .bind(substance)
    .bind(normalized_substance)
    .fetch_one(pool)
    .await
    .unwrap();
    let product_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO drug_products (
               brand_name, normalized_brand_name, country_code, atc_code,
               form, strength, verification_status, source_kind, is_active
           ) VALUES ($1, $2, 'DE', 'B01AF02', 'Filmtablette', $3,
                     'curated', 'manual_curated', true)
           RETURNING id"#,
    )
    .bind(brand_name)
    .bind(brand_name.trim().to_lowercase())
    .bind(strength)
    .fetch_one(pool)
    .await
    .unwrap();
    sqlx::query(
        r#"INSERT INTO drug_product_substances (product_id, substance_id, strength_text)
           VALUES ($1, $2, $3)"#,
    )
    .bind(product_id)
    .bind(substance_id)
    .bind(strength)
    .execute(pool)
    .await
    .unwrap();
    product_id
}

#[tokio::test]
async fn ceo_generates_reuses_and_confirms_internal_candidate_without_confidence() {
    let Some(ctx) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let patient_id = seed_patient(&ctx.pool, ctx.admin_id).await;
    let suffix = Uuid::new_v4().simple().to_string();
    let brand = format!("Eliquis Test {suffix}");
    let substance = format!("Apixaban-{suffix}");
    let medication_id = seed_medication(&ctx.pool, patient_id, &brand, &substance, "5 mg").await;
    let product_id = seed_product(&ctx.pool, &brand, &substance, "5 mg").await;
    let manager_id = seed_user(&ctx.pool, "patient_manager").await;

    let path =
        format!("/api/v1/patients/{patient_id}/medications/{medication_id}/identity-candidates");
    let ceo = auth_header_for(ctx.admin_id, "ceo");
    let manager = auth_header_for(manager_id, "patient_manager");

    let (denied_status, _) = json_request(&ctx.app, Method::POST, &path, &manager, None).await;
    assert_eq!(denied_status, StatusCode::FORBIDDEN);

    let (status, generated) = json_request(&ctx.app, Method::POST, &path, &ceo, None).await;
    assert_eq!(status, StatusCode::OK, "{generated}");
    assert_eq!(generated["medication"]["id"], medication_id.to_string());
    assert_eq!(generated["permissions"]["can_search_candidates"], true);
    assert_eq!(generated["permissions"]["can_confirm_identity"], true);
    assert!(generated["candidate_set"]["expires_at"].is_null());
    assert_eq!(generated["candidates"].as_array().unwrap().len(), 1);
    let candidate = &generated["candidates"][0];
    assert_eq!(candidate["product"]["id"], product_id.to_string());
    assert_eq!(candidate["provenance"]["source_state"], "internal_curated");
    assert!(candidate["provenance"]["snapshot_id"].is_null());
    assert_eq!(candidate["confirmable"], true);
    assert!(candidate.get("confidence").is_none());

    let legacy_match_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO medication_drug_matches (
               patient_medication_id, drug_product_id, match_kind, confidence,
               verification_status, created_by
           ) VALUES ($1, $2, 'staff_candidate', 0.7, 'candidate', $3)
           RETURNING id"#,
    )
    .bind(medication_id)
    .bind(product_id)
    .bind(ctx.admin_id)
    .fetch_one(&ctx.pool)
    .await
    .unwrap();
    let legacy_verify_path = format!(
        "/api/v1/patients/{patient_id}/medications/{medication_id}/drug-matches/{legacy_match_id}/verify"
    );
    let (legacy_status, legacy_payload) = json_request(
        &ctx.app,
        Method::POST,
        &legacy_verify_path,
        &ceo,
        Some(json!({ "verification_status": "verified" })),
    )
    .await;
    assert_eq!(legacy_status, StatusCode::CONFLICT, "{legacy_payload}");

    let (_, replay) = json_request(&ctx.app, Method::POST, &path, &ceo, None).await;
    assert_eq!(
        replay["candidate_set"]["id"],
        generated["candidate_set"]["id"]
    );
    assert_eq!(replay["candidates"][0]["id"], candidate["id"]);
    let (_, latest) = json_request(&ctx.app, Method::GET, &path, &ceo, None).await;
    assert_eq!(
        latest["candidate_set"]["id"],
        generated["candidate_set"]["id"]
    );

    let confirm_path =
        format!("/api/v1/patients/{patient_id}/medications/{medication_id}/identity-confirmations");
    let confirmation_body = json!({
        "candidate_set_id": generated["candidate_set"]["id"],
        "candidate_id": candidate["id"],
        "medication_version": generated["medication"]["version"],
        "source_snapshot_id": null,
        "staff_acknowledged": true,
        "idempotency_key": format!("confirm-{suffix}"),
    });
    let mut unacknowledged = confirmation_body.clone();
    unacknowledged["staff_acknowledged"] = json!(false);
    let (unacknowledged_status, _) = json_request(
        &ctx.app,
        Method::POST,
        &confirm_path,
        &ceo,
        Some(unacknowledged),
    )
    .await;
    assert_eq!(unacknowledged_status, StatusCode::UNPROCESSABLE_ENTITY);

    let (confirm_status, confirmed) = json_request(
        &ctx.app,
        Method::POST,
        &confirm_path,
        &ceo,
        Some(confirmation_body.clone()),
    )
    .await;
    assert_eq!(confirm_status, StatusCode::OK, "{confirmed}");
    assert_eq!(confirmed["medication_id"], medication_id.to_string());
    assert_eq!(confirmed["identity_status"], "verified");
    assert_eq!(
        confirmed["medication_version"],
        generated["medication"]["version"]
    );
    assert!(confirmed.get("confidence").is_none());

    let (replay_status, replay_confirmation) = json_request(
        &ctx.app,
        Method::POST,
        &confirm_path,
        &ceo,
        Some(confirmation_body),
    )
    .await;
    assert_eq!(replay_status, StatusCode::OK, "{replay_confirmation}");
    assert_eq!(
        replay_confirmation["refresh_token"],
        confirmed["refresh_token"]
    );

    let projection = sqlx::query(
        r#"SELECT drug_product_id, match_kind, verification_status
           FROM medication_drug_matches
           WHERE patient_medication_id = $1"#,
    )
    .bind(medication_id)
    .fetch_one(&ctx.pool)
    .await
    .unwrap();
    assert_eq!(projection.get::<Uuid, _>("drug_product_id"), product_id);
    assert_eq!(projection.get::<String, _>("match_kind"), "staff_verified");
    assert_eq!(
        projection.get::<String, _>("verification_status"),
        "verified"
    );

    let decision_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM medication_identity_decisions WHERE patient_medication_id = $1",
    )
    .bind(medication_id)
    .fetch_one(&ctx.pool)
    .await
    .unwrap();
    assert_eq!(decision_count, 1);
}

#[tokio::test]
async fn confirmation_rejects_stale_nonconfirmable_and_client_snapshot_evidence() {
    let Some(ctx) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let patient_id = seed_patient(&ctx.pool, ctx.admin_id).await;
    let suffix = Uuid::new_v4().simple().to_string();
    let substance = format!("Substance-{suffix}");
    let medication_id = seed_medication(
        &ctx.pool,
        patient_id,
        &format!("Patient Brand {suffix}"),
        &substance,
        "10 mg",
    )
    .await;
    seed_product(
        &ctx.pool,
        &format!("Different Brand {suffix}"),
        &substance,
        "10 mg",
    )
    .await;
    let manual_candidate_id = seed_product(
        &ctx.pool,
        &format!("Patient Brand {suffix}"),
        &format!("Manual Candidate {suffix}"),
        "10 mg",
    )
    .await;
    sqlx::query(
        "UPDATE drug_products SET source_kind = 'manual_candidate', verification_status = 'verified' WHERE id = $1",
    )
    .bind(manual_candidate_id)
    .execute(&ctx.pool)
    .await
    .unwrap();
    let ceo = auth_header_for(ctx.admin_id, "ceo");
    let candidates_path =
        format!("/api/v1/patients/{patient_id}/medications/{medication_id}/identity-candidates");
    let (_, generated) = json_request(&ctx.app, Method::POST, &candidates_path, &ceo, None).await;
    let candidate = &generated["candidates"][0];
    assert!(
        generated["candidates"]
            .as_array()
            .unwrap()
            .iter()
            .all(|value| value["product"]["id"] != manual_candidate_id.to_string())
    );
    assert_eq!(candidate["confirmable"], false);
    assert!(
        candidate["blocking_reasons"]
            .as_array()
            .unwrap()
            .iter()
            .any(|value| value == "substance_only_not_identity")
    );

    let confirm_path =
        format!("/api/v1/patients/{patient_id}/medications/{medication_id}/identity-confirmations");
    let base = json!({
        "candidate_set_id": generated["candidate_set"]["id"],
        "candidate_id": candidate["id"],
        "medication_version": generated["medication"]["version"],
        "source_snapshot_id": null,
        "staff_acknowledged": true,
    });
    let (nonconfirmable_status, _) = json_request(
        &ctx.app,
        Method::POST,
        &confirm_path,
        &ceo,
        Some(base.clone()),
    )
    .await;
    assert_eq!(nonconfirmable_status, StatusCode::UNPROCESSABLE_ENTITY);

    let mut snapshot_body = base.clone();
    snapshot_body["source_snapshot_id"] = json!(Uuid::new_v4());
    let (snapshot_status, _) = json_request(
        &ctx.app,
        Method::POST,
        &confirm_path,
        &ceo,
        Some(snapshot_body),
    )
    .await;
    assert_eq!(snapshot_status, StatusCode::UNPROCESSABLE_ENTITY);

    sqlx::query("UPDATE patient_medications SET staerke = '20 mg' WHERE id = $1")
        .bind(medication_id)
        .execute(&ctx.pool)
        .await
        .unwrap();
    let (stale_status, _) =
        json_request(&ctx.app, Method::POST, &confirm_path, &ceo, Some(base)).await;
    assert_eq!(stale_status, StatusCode::CONFLICT);
}

#[tokio::test]
async fn confirmation_rejects_catalog_substance_mutation_without_product_timestamp_change() {
    let Some(ctx) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let patient_id = seed_patient(&ctx.pool, ctx.admin_id).await;
    let suffix = Uuid::new_v4().simple().to_string();
    let brand = format!("Catalog Snapshot {suffix}");
    let substance = format!("Snapshot Substance {suffix}");
    let medication_id = seed_medication(&ctx.pool, patient_id, &brand, &substance, "5 mg").await;
    let product_id = seed_product(&ctx.pool, &brand, &substance, "5 mg").await;
    let ceo = auth_header_for(ctx.admin_id, "ceo");
    let candidates_path =
        format!("/api/v1/patients/{patient_id}/medications/{medication_id}/identity-candidates");
    let (status, generated) =
        json_request(&ctx.app, Method::POST, &candidates_path, &ceo, None).await;
    assert_eq!(status, StatusCode::OK, "{generated}");
    assert_eq!(generated["candidates"][0]["confirmable"], true);

    let product_updated_at: chrono::DateTime<chrono::Utc> =
        sqlx::query_scalar("SELECT updated_at FROM drug_products WHERE id = $1")
            .bind(product_id)
            .fetch_one(&ctx.pool)
            .await
            .unwrap();
    let added_substance_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO drug_substances (name, normalized_name)
           VALUES ($1, $2)
           RETURNING id"#,
    )
    .bind(format!("Added Substance {suffix}"))
    .bind(format!("added substance {suffix}").to_lowercase())
    .fetch_one(&ctx.pool)
    .await
    .unwrap();
    sqlx::query("INSERT INTO drug_product_substances (product_id, substance_id) VALUES ($1, $2)")
        .bind(product_id)
        .bind(added_substance_id)
        .execute(&ctx.pool)
        .await
        .unwrap();
    let unchanged_updated_at: chrono::DateTime<chrono::Utc> =
        sqlx::query_scalar("SELECT updated_at FROM drug_products WHERE id = $1")
            .bind(product_id)
            .fetch_one(&ctx.pool)
            .await
            .unwrap();
    assert_eq!(unchanged_updated_at, product_updated_at);

    let confirm_path =
        format!("/api/v1/patients/{patient_id}/medications/{medication_id}/identity-confirmations");
    let (confirm_status, payload) = json_request(
        &ctx.app,
        Method::POST,
        &confirm_path,
        &ceo,
        Some(json!({
            "candidate_set_id": generated["candidate_set"]["id"],
            "candidate_id": generated["candidates"][0]["id"],
            "medication_version": generated["medication"]["version"],
            "source_snapshot_id": null,
            "staff_acknowledged": true,
        })),
    )
    .await;
    assert_eq!(confirm_status, StatusCode::CONFLICT, "{payload}");
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM medication_identity_decisions WHERE patient_medication_id = $1"
        )
        .bind(medication_id)
        .fetch_one(&ctx.pool)
        .await
        .unwrap(),
        0
    );
}
