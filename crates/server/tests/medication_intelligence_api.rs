mod support;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use chrono::{Duration, Utc};
use serde_json::{Value, json};
use sqlx::PgPool;
use tower::ServiceExt;
use uuid::Uuid;

use gmed_server::auth::jwt;
use gmed_server::services::bfarm_rote_hand::{
    BFARM_ROTE_HAND_RSS_URL, complete_bfarm_job_from_payload,
};
use gmed_server::services::medication_intelligence_sources::{
    SuccessfulSnapshotInput, claim_ingestion_job, claim_next_ingestion_job,
    enqueue_source_ingestion, load_source_statuses_at, record_ingestion_failure,
    record_ingestion_success,
};

const TEST_SECRET: &str = "test-secret-at-least-32-characters-long!!";

async fn json_request(app: &axum::Router, path: &str, bearer: &str) -> (StatusCode, Value) {
    let request = Request::builder()
        .method("GET")
        .uri(path)
        .header("Authorization", bearer)
        .header("Content-Type", "application/json")
        .body(Body::empty())
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
    .bind(format!(
        "medication-intelligence-{role}-{suffix}@example.com"
    ))
    .bind(format!("Medication intelligence {role}"))
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
           ) VALUES ($1, 'Medication', 'Intelligence', '1990-01-01', 'diverse', $2, ARRAY['de']::text[])
           RETURNING id"#,
    )
    .bind(format!("PT-MEDINT-{suffix}"))
    .bind(created_by)
    .fetch_one(pool)
    .await
    .unwrap()
}

#[tokio::test]
async fn ceo_receives_deterministic_open_source_review_and_non_clinical_role_is_denied() {
    let Some(ctx) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let patient_id = seed_patient(&ctx.pool, ctx.admin_id).await;
    let manager_id = seed_user(&ctx.pool, "patient_manager").await;

    let medication_ids: Vec<Uuid> = sqlx::query_scalar(
        r#"INSERT INTO patient_medications (
               patient_id, wirkstoff, handelsname, status, on_hold,
               source_identifiers, sort_order
           ) VALUES
               ($1, ' Ibuprofen ', 'Brand A', 'aktiv', false,
                '{"atc_code":"M01AE01"}'::jsonb, 0),
               ($1, 'IBUPROFEN', 'Brand B', 'aktiv', false,
                '{"pzn":"01234567"}'::jsonb, 1),
               ($1, 'ibuprofen', 'Brand C', 'aktiv', false,
                '{}'::jsonb, 2)
           RETURNING id"#,
    )
    .bind(patient_id)
    .fetch_all(&ctx.pool)
    .await
    .unwrap();

    let path = format!("/api/v1/patients/{patient_id}/medication-intelligence");
    let ceo_bearer = auth_header_for(ctx.admin_id, "ceo");
    let (status, payload) = json_request(&ctx.app, &path, &ceo_bearer).await;

    assert_eq!(status, StatusCode::OK, "response body: {payload}");
    assert_eq!(payload["mode"], "open_sources_only");
    assert!(payload["generated_at"].as_str().is_some());
    assert_eq!(payload["summary"]["active_medications"], 3);
    assert_eq!(payload["summary"]["identified_medications"], 2);
    assert_eq!(payload["summary"]["unresolved_medications"], 1);
    assert_eq!(payload["summary"]["missing_data_total"], 1);
    assert_eq!(
        payload["identity_permissions"]["can_search_candidates"],
        true
    );
    assert_eq!(
        payload["identity_permissions"]["can_confirm_identity"],
        true
    );

    let findings = payload["findings"].as_array().unwrap();
    let duplicate = findings
        .iter()
        .find(|finding| finding["category"] == "duplicate_active_ingredient")
        .expect("duplicate active ingredient finding");
    assert_eq!(duplicate["severity"], "warning");
    assert_eq!(duplicate["medication_ids"].as_array().unwrap().len(), 3);
    assert!(findings.iter().any(|finding| {
        finding["category"] == "unresolved_medication_identity"
            && finding["medication_ids"][0] == medication_ids[2].to_string()
    }));

    let medications = payload["medications"].as_array().unwrap();
    assert_eq!(medications[0]["identity_status"], "candidate");
    assert_eq!(medications[0]["atc_code"], "M01AE01");
    assert_eq!(medications[1]["identity_status"], "candidate");
    assert_eq!(medications[1]["pzn"], "01234567");
    assert_eq!(medications[2]["identity_status"], "unresolved");

    assert!(payload.get("safe").is_none());
    assert!(
        payload["disclaimer"]["ru"]
            .as_str()
            .is_some_and(|text| text.contains("не подтверждает безопасность"))
    );
    assert!(
        payload["sources"]
            .as_array()
            .unwrap()
            .iter()
            .all(|source| source["ingestion_status"] != "available"
                && source["health"] == "never"
                && source["last_successful_snapshot"].is_null())
    );

    let (source_status, source_payload) = json_request(
        &ctx.app,
        "/api/v1/medication-intelligence/sources",
        &ceo_bearer,
    )
    .await;
    assert_eq!(source_status, StatusCode::OK, "{source_payload}");
    assert_eq!(source_payload["mode"], "open_sources_only");
    assert_eq!(source_payload["sources"], payload["sources"]);

    let manager_bearer = auth_header_for(manager_id, "patient_manager");
    let (status, _) = json_request(&ctx.app, &path, &manager_bearer).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn source_jobs_are_idempotent_and_snapshots_drive_honest_health() {
    let Some(ctx) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    sqlx::query(
        r#"UPDATE medication_intelligence_sources
           SET connector_status = 'active'
           WHERE id IN ('ema_pms_public_api', 'bfarm_rote_hand')"#,
    )
    .execute(&ctx.pool)
    .await
    .unwrap();

    let first = enqueue_source_ingestion(
        &ctx.pool,
        "ema_pms_public_api",
        "ema-2026-08-26",
        Some(ctx.admin_id),
        json!({"trigger":"test"}),
    )
    .await
    .unwrap();
    assert!(!first.idempotent_replay);
    let replay = enqueue_source_ingestion(
        &ctx.pool,
        "ema_pms_public_api",
        "ema-2026-08-26",
        Some(ctx.admin_id),
        json!({"ignored_on_replay":true}),
    )
    .await
    .unwrap();
    assert!(replay.idempotent_replay);
    assert_eq!(replay.job_id, first.job_id);

    let claimed = claim_next_ingestion_job(&ctx.pool, "test-worker")
        .await
        .unwrap()
        .expect("queued source job");
    assert_eq!(claimed.id, first.job_id);
    assert_eq!(claimed.source_id, "ema_pms_public_api");
    let fetched_at = Utc::now();
    let completed = record_ingestion_success(
        &ctx.pool,
        claimed.id,
        SuccessfulSnapshotInput {
            fetched_at,
            published_at: Some(fetched_at - Duration::hours(2)),
            source_url: claimed.source_url,
            checksum_sha256: "a".repeat(64),
            version: Some("2026-08-26".to_string()),
            item_count: Some(42),
            content_type: Some("application/json".to_string()),
            byte_length: 8_192,
            payload_storage_key: Some("official-sources/ema/2026-08-26.json".to_string()),
            metadata: json!({"schema":"test-only"}),
        },
    )
    .await
    .unwrap();
    assert_eq!(completed.job_status, "succeeded");
    assert!(!completed.duplicate_snapshot);

    let statuses = load_source_statuses_at(&ctx.pool, fetched_at + Duration::hours(1))
        .await
        .unwrap();
    let ema = statuses
        .iter()
        .find(|source| source.id == "ema_pms_public_api")
        .unwrap();
    assert_eq!(ema.ingestion_status, "available");
    assert_eq!(ema.health, "fresh");
    let snapshot = ema.last_successful_snapshot.as_ref().unwrap();
    assert_eq!(snapshot.id, completed.snapshot_id);
    assert_eq!(snapshot.version.as_deref(), Some("2026-08-26"));
    assert_eq!(snapshot.checksum_sha256, "a".repeat(64));
    assert_eq!(snapshot.item_count, Some(42));
    let stale_statuses = load_source_statuses_at(&ctx.pool, fetched_at + Duration::hours(200))
        .await
        .unwrap();
    let stale_ema = stale_statuses
        .iter()
        .find(|source| source.id == "ema_pms_public_api")
        .unwrap();
    assert_eq!(stale_ema.ingestion_status, "available");
    assert_eq!(stale_ema.health, "stale");

    let duplicate_job = enqueue_source_ingestion(
        &ctx.pool,
        "ema_pms_public_api",
        "ema-duplicate-content",
        Some(ctx.admin_id),
        json!({}),
    )
    .await
    .unwrap();
    let claimed = claim_next_ingestion_job(&ctx.pool, "test-worker")
        .await
        .unwrap()
        .unwrap();
    assert_eq!(claimed.id, duplicate_job.job_id);
    let duplicate = record_ingestion_success(
        &ctx.pool,
        claimed.id,
        SuccessfulSnapshotInput {
            fetched_at: fetched_at + Duration::hours(1),
            published_at: None,
            source_url: claimed.source_url,
            checksum_sha256: "a".repeat(64),
            version: Some("same-content-new-attempt".to_string()),
            item_count: Some(42),
            content_type: Some("application/json".to_string()),
            byte_length: 8_192,
            payload_storage_key: None,
            metadata: json!({}),
        },
    )
    .await
    .unwrap();
    assert_eq!(duplicate.job_status, "skipped");
    assert!(duplicate.duplicate_snapshot);
    assert_eq!(duplicate.snapshot_id, completed.snapshot_id);
    let duplicate_replay = record_ingestion_success(
        &ctx.pool,
        claimed.id,
        SuccessfulSnapshotInput {
            fetched_at: fetched_at + Duration::hours(1),
            published_at: None,
            source_url: "https://api.pms.ema.europa.eu/public/v1/swagger".to_string(),
            checksum_sha256: "a".repeat(64),
            version: None,
            item_count: Some(42),
            content_type: Some("application/json".to_string()),
            byte_length: 8_192,
            payload_storage_key: None,
            metadata: json!({}),
        },
    )
    .await
    .unwrap();
    assert!(duplicate_replay.idempotent_replay);
    assert!(duplicate_replay.duplicate_snapshot);
    assert_eq!(duplicate_replay.snapshot_id, completed.snapshot_id);

    let successful_snapshot_count: i64 = sqlx::query_scalar(
        r#"SELECT count(*)
           FROM medication_intelligence_source_snapshots
           WHERE source_id = 'ema_pms_public_api'
             AND attempt_status = 'success'"#,
    )
    .fetch_one(&ctx.pool)
    .await
    .unwrap();
    assert_eq!(successful_snapshot_count, 1);

    let failed_job = enqueue_source_ingestion(
        &ctx.pool,
        "ema_pms_public_api",
        "ema-2026-08-27",
        Some(ctx.admin_id),
        json!({}),
    )
    .await
    .unwrap();
    let claimed = claim_next_ingestion_job(&ctx.pool, "test-worker")
        .await
        .unwrap()
        .unwrap();
    assert_eq!(claimed.id, failed_job.job_id);
    record_ingestion_failure(
        &ctx.pool,
        claimed.id,
        fetched_at + Duration::hours(2),
        Some("upstream_unavailable"),
        "https://official.example/feed?token=must-not-leak transport detail",
        json!({}),
    )
    .await
    .unwrap();

    let statuses = load_source_statuses_at(&ctx.pool, fetched_at + Duration::hours(3))
        .await
        .unwrap();
    let ema = statuses
        .iter()
        .find(|source| source.id == "ema_pms_public_api")
        .unwrap();
    assert_eq!(ema.ingestion_status, "available");
    assert_eq!(ema.health, "error");
    assert_eq!(ema.last_error.as_deref(), Some("upstream_unavailable"));
    let public_status = serde_json::to_string(ema).unwrap();
    assert!(!public_status.contains("must-not-leak"));
    assert_eq!(
        ema.last_successful_snapshot.as_ref().unwrap().id,
        completed.snapshot_id
    );

    let first_failure = enqueue_source_ingestion(
        &ctx.pool,
        "bfarm_rote_hand",
        "bfarm-first-attempt",
        Some(ctx.admin_id),
        json!({}),
    )
    .await
    .unwrap();
    let claimed = claim_next_ingestion_job(&ctx.pool, "test-worker")
        .await
        .unwrap()
        .unwrap();
    assert_eq!(claimed.id, first_failure.job_id);
    record_ingestion_failure(
        &ctx.pool,
        claimed.id,
        fetched_at,
        Some("feed_not_verified"),
        "No usable snapshot",
        json!({}),
    )
    .await
    .unwrap();
    let statuses = load_source_statuses_at(&ctx.pool, fetched_at + Duration::hours(1))
        .await
        .unwrap();
    let bfarm = statuses
        .iter()
        .find(|source| source.id == "bfarm_rote_hand")
        .unwrap();
    assert_eq!(bfarm.ingestion_status, "error");
    assert_eq!(bfarm.health, "error");
    assert!(bfarm.last_successful_snapshot.is_none());
}

fn bfarm_sample(item_link: &str) -> Vec<u8> {
    format!(
        r#"<?xml version="1.0"?>
<rss version="2.0"><channel>
<title>BfArM RSS-Feed: Rote-Hand- und Informationsbriefe</title>
<link>https://www.bfarm.de</link><description>Official feed</description>
<copyright>Copyright by BfArM</copyright>
<item><title>Rote-Hand-Brief zu Litfulo (Ritlecitinib): Offizieller Risikohinweis</title>
<link>{item_link}</link><pubDate>Mon, 10 Aug 2026 12:32:00 +0200</pubDate>
<description>This body must never be copied to the normalized patient response.</description></item>
</channel></rss>"#
    )
    .into_bytes()
}

#[tokio::test]
async fn bfarm_snapshot_is_atomic_idempotent_and_matches_only_exact_active_substance() {
    let Some(ctx) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let patient_id = seed_patient(&ctx.pool, ctx.admin_id).await;
    let medication_ids: Vec<Uuid> = sqlx::query_scalar(
        r#"INSERT INTO patient_medications (
               patient_id, wirkstoff, handelsname, status, on_hold,
               source_identifiers, sort_order
           ) VALUES
               ($1, 'Ritlecitinib', 'Exact active', 'aktiv', false,
                '{"atc_code":"L04AF08"}'::jsonb, 0),
               ($1, 'Ritlecitinibacetat', 'Near but not equal', 'aktiv', false,
                '{"atc_code":"L04AF08"}'::jsonb, 1),
               ($1, 'Ritlecitinib', 'Explicitly on hold', 'aktiv', true,
                '{"atc_code":"L04AF08"}'::jsonb, 2)
           RETURNING id"#,
    )
    .bind(patient_id)
    .fetch_all(&ctx.pool)
    .await
    .unwrap();

    let item_link = format!(
        "https://www.bfarm.de/SharedDocs/Risikoinformationen/Pharmakovigilanz/DE/RHB/2026/rhb-test-{}.html",
        Uuid::new_v4().simple()
    );
    let payload = bfarm_sample(&item_link);
    let old_fetched_at = Utc::now() - Duration::hours(10);
    let first = enqueue_source_ingestion(
        &ctx.pool,
        "bfarm_rote_hand",
        &format!("bfarm-live-{}", Uuid::new_v4()),
        None,
        json!({"trigger":"test"}),
    )
    .await
    .unwrap();
    let claimed = claim_ingestion_job(&ctx.pool, first.job_id, "bfarm-test-worker")
        .await
        .unwrap()
        .expect("targeted BfArM job claim");
    assert_eq!(claimed.source_url, BFARM_ROTE_HAND_RSS_URL);
    let completed = complete_bfarm_job_from_payload(
        &ctx.pool,
        claimed.id,
        old_fetched_at.to_owned(),
        "text/xml;charset=utf-8".to_string(),
        payload.clone(),
    )
    .await
    .unwrap();
    assert_eq!(completed.job_status, "succeeded");

    let stored_payload: Vec<u8> = sqlx::query_scalar(
        "SELECT payload FROM medication_intelligence_source_payloads WHERE snapshot_id = $1",
    )
    .bind(completed.snapshot_id)
    .fetch_one(&ctx.pool)
    .await
    .unwrap();
    assert_eq!(stored_payload, payload);
    let normalized: (String, Vec<String>, Vec<String>) = sqlx::query_as(
        r#"SELECT official_title, explicit_substance_labels, explicit_substance_keys
           FROM medication_intelligence_safety_alert_items
           WHERE snapshot_id = $1"#,
    )
    .bind(completed.snapshot_id)
    .fetch_one(&ctx.pool)
    .await
    .unwrap();
    assert_eq!(normalized.1, ["Ritlecitinib"]);
    assert_eq!(normalized.2, ["ritlecitinib"]);
    assert!(!normalized.0.contains("must never"));

    let path = format!("/api/v1/patients/{patient_id}/medication-intelligence");
    let (status, response) =
        json_request(&ctx.app, &path, &auth_header_for(ctx.admin_id, "ceo")).await;
    assert_eq!(status, StatusCode::OK, "{response}");
    let official = response["findings"]
        .as_array()
        .unwrap()
        .iter()
        .find(|finding| finding["category"] == "official_safety_alert")
        .expect("exact official safety alert finding");
    assert_eq!(official["source_id"], "bfarm_rote_hand");
    assert_eq!(official["source_url"], item_link);
    assert!(official["published_at"].as_str().is_some());
    assert_eq!(official["substances"], json!(["Ritlecitinib"]));
    assert_eq!(official["medication_ids"], json!([medication_ids[0]]));
    assert_eq!(official["evidence_refs"].as_array().unwrap().len(), 2);
    assert!(!response.to_string().contains("This body must never"));

    // An unchanged hourly fetch is skipped but is a fresh successful
    // verification. It must refresh health without mutating provenance time.
    let duplicate = enqueue_source_ingestion(
        &ctx.pool,
        "bfarm_rote_hand",
        &format!("bfarm-duplicate-{}", Uuid::new_v4()),
        None,
        json!({}),
    )
    .await
    .unwrap();
    let duplicate_claim = claim_ingestion_job(&ctx.pool, duplicate.job_id, "bfarm-test-worker")
        .await
        .unwrap()
        .unwrap();
    let duplicate_result = complete_bfarm_job_from_payload(
        &ctx.pool,
        duplicate_claim.id,
        Utc::now(),
        "text/xml;charset=utf-8".to_string(),
        payload,
    )
    .await
    .unwrap();
    assert_eq!(duplicate_result.job_status, "skipped");
    assert_eq!(duplicate_result.snapshot_id, completed.snapshot_id);

    let statuses = load_source_statuses_at(&ctx.pool, Utc::now() + Duration::hours(1))
        .await
        .unwrap();
    let bfarm = statuses
        .iter()
        .find(|source| source.id == "bfarm_rote_hand")
        .unwrap();
    assert_eq!(bfarm.health, "fresh");
    assert_eq!(bfarm.ingestion_status, "available");
    assert_eq!(
        bfarm.last_successful_snapshot.as_ref().unwrap().fetched_at,
        old_fetched_at.to_rfc3339()
    );
}

#[tokio::test]
async fn rejected_bfarm_normalization_leaves_no_partial_success_snapshot() {
    let Some(ctx) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let job = enqueue_source_ingestion(
        &ctx.pool,
        "bfarm_rote_hand",
        &format!("bfarm-rejected-{}", Uuid::new_v4()),
        None,
        json!({}),
    )
    .await
    .unwrap();
    let claimed = claim_ingestion_job(&ctx.pool, job.job_id, "bfarm-test-worker")
        .await
        .unwrap()
        .unwrap();
    let invalid_payload = bfarm_sample("https://attacker.invalid/not-official");
    assert!(
        complete_bfarm_job_from_payload(
            &ctx.pool,
            claimed.id,
            Utc::now(),
            "application/rss+xml".to_string(),
            invalid_payload,
        )
        .await
        .is_err()
    );

    let snapshot_count: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM medication_intelligence_source_snapshots WHERE ingestion_job_id = $1",
    )
    .bind(claimed.id)
    .fetch_one(&ctx.pool)
    .await
    .unwrap();
    let payload_count: i64 = sqlx::query_scalar(
        r#"SELECT count(*)
           FROM medication_intelligence_source_payloads payload
           JOIN medication_intelligence_source_snapshots snapshot
             ON snapshot.id = payload.snapshot_id
           WHERE snapshot.ingestion_job_id = $1"#,
    )
    .bind(claimed.id)
    .fetch_one(&ctx.pool)
    .await
    .unwrap();
    assert_eq!(snapshot_count, 0);
    assert_eq!(payload_count, 0);
}

#[tokio::test]
async fn stale_running_source_job_lease_can_be_reclaimed_after_worker_crash() {
    let Some(ctx) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let job = enqueue_source_ingestion(
        &ctx.pool,
        "bfarm_rote_hand",
        &format!("bfarm-stale-lease-{}", Uuid::new_v4()),
        None,
        json!({}),
    )
    .await
    .unwrap();
    let first = claim_ingestion_job(&ctx.pool, job.job_id, "crashed-worker")
        .await
        .unwrap()
        .expect("first claim");
    assert_eq!(first.id, job.job_id);
    assert!(
        claim_ingestion_job(&ctx.pool, job.job_id, "premature-worker")
            .await
            .unwrap()
            .is_none(),
        "an active lease must not be stolen"
    );

    sqlx::query(
        r#"UPDATE medication_intelligence_ingestion_jobs
           SET started_at = now() - interval '11 minutes'
           WHERE id = $1"#,
    )
    .bind(job.job_id)
    .execute(&ctx.pool)
    .await
    .unwrap();
    let reclaimed = claim_ingestion_job(&ctx.pool, job.job_id, "replacement-worker")
        .await
        .unwrap()
        .expect("expired claim is reclaimable");
    assert_eq!(reclaimed.id, job.job_id);
    let worker_id: String = sqlx::query_scalar(
        "SELECT worker_id FROM medication_intelligence_ingestion_jobs WHERE id = $1",
    )
    .bind(job.job_id)
    .fetch_one(&ctx.pool)
    .await
    .unwrap();
    assert_eq!(worker_id, "replacement-worker");
}
