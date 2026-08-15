mod support;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use serde_json::{Map, Value, json};
use sqlx::PgPool;
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

async fn seed_minor_patient_without_guardian(pool: &PgPool, created_by: Uuid, tag: &str) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO patients (patient_id, first_name, last_name, birth_date, gender, created_by, languages)
           VALUES ($1, $2, $3, '2020-01-01', 'female', $4, ARRAY['de']::text[])
           RETURNING id"#,
    )
    .bind(format!("PT-MINOR-{tag}"))
    .bind(format!("Minor {tag}"))
    .bind(format!("Patient {tag}"))
    .bind(created_by)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn seed_patient_assignment(
    pool: &PgPool,
    patient_id: Uuid,
    assigned_user_id: Uuid,
    assigned_by: Uuid,
) {
    sqlx::query(
        r#"INSERT INTO patient_assignments (patient_id, user_id, assigned_by)
           VALUES ($1, $2, $3)"#,
    )
    .bind(patient_id)
    .bind(assigned_user_id)
    .bind(assigned_by)
    .execute(pool)
    .await
    .unwrap();
}

async fn seed_medication_review_import(
    pool: &PgPool,
    patient_id: Uuid,
    requested_by: Uuid,
    candidate_id: &str,
    tag: &str,
) -> Uuid {
    let document_id = Uuid::new_v4();
    sqlx::query(
        r#"INSERT INTO documents (
                id, patient_id, auto_name, original_filename, art, category,
                status, visibility, is_medical, mime_type, file_size,
                version_root_document_id, version_number, uploaded_by
           ) VALUES (
                $1, $2, $3, $4, 'medical_report', 'report',
                'active', 'internal', true, 'application/pdf', 128,
                $1, 1, $5
           )"#,
    )
    .bind(document_id)
    .bind(patient_id)
    .bind(format!("Medication review {tag}"))
    .bind(format!("medication-{tag}.pdf"))
    .bind(requested_by)
    .execute(pool)
    .await
    .unwrap();

    sqlx::query_scalar(
        r#"INSERT INTO clinical_document_imports (
                patient_id, document_id, status, draft, requested_by, completed_at
           ) VALUES ($1, $2, 'review_required', $3, $4, now())
           RETURNING id"#,
    )
    .bind(patient_id)
    .bind(document_id)
    .bind(json!({
        "candidates": [{
            "id": candidate_id,
            "target": "medication",
            "value": "Reviewed medication candidate",
            "selected": true,
        }],
        "warnings": [],
    }))
    .bind(requested_by)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn prepare_medication_review_import(
    app: &axum::Router,
    bearer: &str,
    patient_id: Uuid,
    import_id: Uuid,
    candidate_id: &str,
    source_country: &str,
    candidate_payload: Value,
) -> Value {
    let reviewed_draft = json!({
        "candidates": [{
            "id": candidate_id,
            "target": "medication",
            "value": "Reviewed medication candidate",
            "selected": true,
        }],
        "warnings": [],
    });
    let mut candidate_payloads = Map::new();
    candidate_payloads.insert(candidate_id.to_string(), candidate_payload);
    let (status, body) = json_request(
        app,
        "POST",
        &format!("/api/v1/patients/{patient_id}/clinical-document-imports/{import_id}/prepare"),
        bearer,
        Some(json!({
            "reviewed_draft": reviewed_draft,
            "source_country": source_country,
            "patient_identity_confirmed": true,
            "candidate_payloads": candidate_payloads,
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body:?}");
    reviewed_draft
}

#[allow(clippy::too_many_arguments)]
async fn persist_reviewed_medication(
    app: &axum::Router,
    pool: &PgPool,
    bearer: &str,
    patient_id: Uuid,
    user_id: Uuid,
    candidate_id: &str,
    source_country: &str,
    payload: Value,
) -> (StatusCode, Value) {
    let import_id =
        seed_medication_review_import(pool, patient_id, user_id, candidate_id, candidate_id).await;
    prepare_medication_review_import(
        app,
        bearer,
        patient_id,
        import_id,
        candidate_id,
        source_country,
        payload.clone(),
    )
    .await;
    json_request(
        app,
        "POST",
        &format!("/api/v1/patients/{patient_id}/clinical-document-imports/{import_id}/medications"),
        bearer,
        Some(payload),
    )
    .await
}

#[tokio::test]
async fn patient_notes_update_does_not_require_unrelated_minor_guardian_fix() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("minor-notes-update");
    let patient_id = seed_minor_patient_without_guardian(&pool, admin_id, &tag).await;
    let ceo_id = seed_user(&pool, &format!("{tag}-ceo"), "ceo").await;
    seed_patient_assignment(&pool, patient_id, ceo_id, admin_id).await;
    let ceo_bearer = auth_header_for(ceo_id, "ceo");

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/patients/{patient_id}/update"),
        &ceo_bearer,
        Some(json!({
            "notes": "Metadata note can be edited without changing guardian fields",
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (status, detail) = json_request(
        &app,
        "GET",
        &format!("/api/v1/patients/{patient_id}"),
        &ceo_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        detail["notes"],
        "Metadata note can be edited without changing guardian fields",
    );
}

#[tokio::test]
async fn patient_medication_requires_active_ingredient_but_allows_no_trade_name() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };
    let tag = unique_tag("patient-med-required-ingredient");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let ceo_id = seed_user(&pool, &format!("{tag}-ceo"), "ceo").await;
    seed_patient_assignment(&pool, patient_id, ceo_id, admin_id).await;
    let ceo_bearer = auth_header_for(ceo_id, "ceo");

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/patients/{patient_id}/medications"),
        &ceo_bearer,
        Some(json!({
            "items": [{
                "wirkstoff": "Ibuprofen",
                "handelsname": "",
                "category": "dauer"
            }]
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body:?}");

    let (status, clinical) = json_request(
        &app,
        "GET",
        &format!("/api/v1/patients/{patient_id}/clinical"),
        &ceo_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(clinical["medications"][0]["wirkstoff"], "Ibuprofen");
    assert_eq!(clinical["medications"][0]["handelsname"], "");

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/patients/{patient_id}/medications"),
        &ceo_bearer,
        Some(json!({
            "items": [{ "handelsname": "Optional brand only" }]
        })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(
        body["message"],
        "wirkstoff is required for every medication"
    );

    let (status, clinical) = json_request(
        &app,
        "GET",
        &format!("/api/v1/patients/{patient_id}/clinical"),
        &ceo_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(clinical["medications"].as_array().unwrap().len(), 1);
}

#[tokio::test]
async fn clinical_import_prepare_freezes_selection_country_and_blocks_live_writes_before_it() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };
    let tag = unique_tag("clinical-import-prepare");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let ceo_id = admin_id;
    let bearer = auth_header_for(admin_id, "ceo");
    let import_id =
        seed_medication_review_import(&pool, patient_id, ceo_id, "prepare-med", &tag).await;
    let medication_path =
        format!("/api/v1/patients/{patient_id}/clinical-document-imports/{import_id}/medications");
    let medication = json!({
        "candidate_id": "prepare-med",
        "wirkstoff": "Metformin",
        "source_country": "DE",
        "source_date": "2026-08-10",
    });
    let (status, _) = json_request(
        &app,
        "POST",
        &medication_path,
        &bearer,
        Some(medication.clone()),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);

    let reviewed_draft = json!({
        "candidates": [{
            "id": "prepare-med",
            "target": "medication",
            "value": "Reviewed medication candidate",
            "selected": true,
        }],
        "warnings": [],
    });
    let prepare_path =
        format!("/api/v1/patients/{patient_id}/clinical-document-imports/{import_id}/prepare");
    let (status, invalid_country) = json_request(
        &app,
        "POST",
        &prepare_path,
        &bearer,
        Some(json!({
            "reviewed_draft": reviewed_draft,
            "source_country": "ZZ",
        })),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::UNPROCESSABLE_ENTITY,
        "{invalid_country:?}"
    );
    let (status, missing_country) = json_request(
        &app,
        "POST",
        &prepare_path,
        &bearer,
        Some(json!({ "reviewed_draft": reviewed_draft })),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::UNPROCESSABLE_ENTITY,
        "{missing_country:?}"
    );

    let prepared_payload = json!({
        "reviewed_draft": reviewed_draft,
        "source_country": "DE",
        "patient_identity_confirmed": true,
        "candidate_payloads": {
            "prepare-med": medication,
        },
    });
    let (status, prepared) = json_request(
        &app,
        "POST",
        &prepare_path,
        &bearer,
        Some(prepared_payload.clone()),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{prepared:?}");
    assert_eq!(prepared["status"], "applying");
    assert_eq!(prepared["idempotent"], false);

    let (status, retry) =
        json_request(&app, "POST", &prepare_path, &bearer, Some(prepared_payload)).await;
    assert_eq!(status, StatusCode::OK, "{retry:?}");
    assert_eq!(retry["idempotent"], true);

    let mut changed_prepared_medication = medication.clone();
    changed_prepared_medication["dose_morgens"] = json!("3");
    let (status, changed_map) = json_request(
        &app,
        "POST",
        &prepare_path,
        &bearer,
        Some(json!({
            "reviewed_draft": reviewed_draft,
            "source_country": "DE",
            "patient_identity_confirmed": true,
            "candidate_payloads": {
                "prepare-med": changed_prepared_medication,
            },
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{changed_map:?}");

    let (status, _) = json_request(
        &app,
        "POST",
        &prepare_path,
        &bearer,
        Some(json!({
            "reviewed_draft": {
                "candidates": [{
                    "id": "prepare-med",
                    "target": "medication",
                    "value": "Changed after prepare",
                    "selected": true,
                }],
                "warnings": [],
            },
            "source_country": "DE",
            "patient_identity_confirmed": true,
            "candidate_payloads": {
                "prepare-med": medication,
            },
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);

    let (status, _) = json_request(
        &app,
        "DELETE",
        &format!("/api/v1/patients/{patient_id}/clinical-document-imports/{import_id}"),
        &bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);

    let mut mismatched_medication = medication.clone();
    mismatched_medication["dose_morgens"] = json!("2");
    let (status, mismatch) = json_request(
        &app,
        "POST",
        &medication_path,
        &bearer,
        Some(mismatched_medication),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{mismatch:?}");

    let mut semantically_equivalent_medication = medication.clone();
    semantically_equivalent_medication["wirkstoff"] = json!(" metformin ");
    let (status, semantically_equivalent_medication) = json_request(
        &app,
        "POST",
        &medication_path,
        &bearer,
        Some(semantically_equivalent_medication),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::CONFLICT,
        "{semantically_equivalent_medication:?}"
    );

    let (status, created) = json_request(
        &app,
        "POST",
        &medication_path,
        &bearer,
        Some(medication.clone()),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{created:?}");
    let (status, exact_retry) = json_request(
        &app,
        "POST",
        &medication_path,
        &bearer,
        Some(medication.clone()),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{exact_retry:?}");
    assert_eq!(exact_retry["idempotent"], true);
    let mut omitted_to_null = medication.clone();
    omitted_to_null["dose_morgens"] = Value::Null;
    let (status, omitted_to_null) = json_request(
        &app,
        "POST",
        &medication_path,
        &bearer,
        Some(omitted_to_null),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{omitted_to_null:?}");
    let (status, mismatched_complete) = json_request(
        &app,
        "POST",
        &format!("/api/v1/patients/{patient_id}/clinical-document-imports/{import_id}/complete"),
        &bearer,
        Some(json!({
            "reviewed_draft": {
                "candidates": [{
                    "id": "prepare-med",
                    "target": "medication",
                    "value": "Changed during completion",
                    "selected": true,
                }],
                "warnings": [],
            }
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{mismatched_complete:?}");

    let null_import = seed_medication_review_import(
        &pool,
        patient_id,
        ceo_id,
        "null-retry-med",
        &format!("{tag}-null-retry"),
    )
    .await;
    let null_payload = json!({
        "candidate_id": "null-retry-med",
        "wirkstoff": "Lisinopril",
        "dose_morgens": null,
        "source_country": "DE",
        "source_date": "2026-08-10",
    });
    prepare_medication_review_import(
        &app,
        &bearer,
        patient_id,
        null_import,
        "null-retry-med",
        "DE",
        null_payload.clone(),
    )
    .await;
    let null_path = format!(
        "/api/v1/patients/{patient_id}/clinical-document-imports/{null_import}/medications"
    );
    let (status, first_null) = json_request(
        &app,
        "POST",
        &null_path,
        &bearer,
        Some(null_payload.clone()),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{first_null:?}");
    let (status, retry_null) =
        json_request(&app, "POST", &null_path, &bearer, Some(null_payload)).await;
    assert_eq!(status, StatusCode::OK, "{retry_null:?}");
    assert_eq!(retry_null["idempotent"], true);

    let deselected_import = seed_medication_review_import(
        &pool,
        patient_id,
        ceo_id,
        "deselected-med",
        &format!("{tag}-deselected"),
    )
    .await;
    let (status, prepared) = json_request(
        &app,
        "POST",
        &format!(
            "/api/v1/patients/{patient_id}/clinical-document-imports/{deselected_import}/prepare"
        ),
        &bearer,
        Some(json!({
            "reviewed_draft": {
                "candidates": [
                    {
                        "id": "deselected-med",
                        "target": "medication",
                        "value": "Reviewed medication candidate",
                        "selected": false,
                        "normalized": {
                            "medication_review_decision": "exclude",
                        },
                    },
                    {
                        "id": format!("manual:{}", Uuid::new_v4()),
                        "target": "recommendation",
                        "value": "Keep monitoring",
                        "selected": true,
                    }
                ],
                "warnings": [],
            },
            "source_country": "DE",
            "patient_identity_confirmed": true,
            "candidate_payloads": {},
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{prepared:?}");
    let (status, deselected) = json_request(
        &app,
        "POST",
        &format!(
            "/api/v1/patients/{patient_id}/clinical-document-imports/{deselected_import}/medications"
        ),
        &bearer,
        Some(json!({
            "candidate_id": "deselected-med",
            "wirkstoff": "Ramipril",
            "source_country": "DE",
            "source_date": "2026-08-10",
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{deselected:?}");
}

#[tokio::test]
async fn clinical_import_prepare_requires_explicit_exclusion_for_unselected_medications() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };
    let tag = unique_tag("clinical-import-medication-review-decision");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let bearer = auth_header_for(admin_id, "ceo");
    let import_id =
        seed_medication_review_import(&pool, patient_id, admin_id, "decision-med", &tag).await;
    let prepare_path =
        format!("/api/v1/patients/{patient_id}/clinical-document-imports/{import_id}/prepare");
    let manual_recommendation_id = format!("manual:{}", Uuid::new_v4());
    let reviewed_draft = |decision: Option<&str>| {
        let mut medication = json!({
            "id": "decision-med",
            "target": "medication",
            "value": "Reviewed medication candidate",
            "selected": false,
            "normalized": { "wirkstoff": "Metformin" },
        });
        if let Some(decision) = decision {
            medication["normalized"]["medication_review_decision"] = json!(decision);
        }
        json!({
            "candidates": [
                medication,
                {
                    "id": manual_recommendation_id,
                    "target": "recommendation",
                    "value": "Reviewed recommendation",
                    "selected": true,
                    "normalized": { "description": "Reviewed recommendation" },
                }
            ],
            "warnings": [],
        })
    };

    let (status, unresolved) = json_request(
        &app,
        "POST",
        &prepare_path,
        &bearer,
        Some(json!({
            "reviewed_draft": reviewed_draft(None),
            "patient_identity_confirmed": true,
            "candidate_payloads": {},
        })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{unresolved:?}");
    let import_status: String =
        sqlx::query_scalar("SELECT status FROM clinical_document_imports WHERE id = $1")
            .bind(import_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(import_status, "review_required");

    let (status, prepared) = json_request(
        &app,
        "POST",
        &prepare_path,
        &bearer,
        Some(json!({
            "reviewed_draft": reviewed_draft(Some("exclude")),
            "patient_identity_confirmed": true,
            "candidate_payloads": {},
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{prepared:?}");
    assert_eq!(prepared["status"], "applying");
}

#[tokio::test]
async fn reviewed_medication_import_is_idempotent_and_keeps_regimen_history() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };
    let tag = unique_tag("ocr-medication-history");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let ceo_id = admin_id;
    let bearer = auth_header_for(admin_id, "ceo");

    let first_import =
        seed_medication_review_import(&pool, patient_id, ceo_id, "med-1", &format!("{tag}-1"))
            .await;
    let first_payload = json!({
        "candidate_id": "med-1",
        "wirkstoff": "Atorvastatin",
        "handelsname": "Atoris",
        "staerke": "20 mg",
        "form": "tablet",
        "dose_abends": "1",
        "einheit": "tablet",
        "status": "active",
        "einnahme_von": "2026-08-01",
        "source_country": "UA",
        "source_date": "2026-08-01",
        "source_page": 1,
        "raw_text": "Atoris 20 mg 0-0-1-0",
        "identifiers": { "atc_code": "C10AA05" },
        "field_confidence": { "wirkstoff": 0.99, "staerke": 0.96 },
    });
    prepare_medication_review_import(
        &app,
        &bearer,
        patient_id,
        first_import,
        "med-1",
        "UA",
        first_payload.clone(),
    )
    .await;
    let path = format!(
        "/api/v1/patients/{patient_id}/clinical-document-imports/{first_import}/medications"
    );
    let (status, first) =
        json_request(&app, "POST", &path, &bearer, Some(first_payload.clone())).await;
    assert_eq!(status, StatusCode::OK, "{first:?}");
    assert_eq!(first["action"], "created");
    assert_eq!(first["idempotent"], false);
    let first_id = Uuid::parse_str(first["id"].as_str().unwrap()).unwrap();
    let first_series_id = first["medication_series_id"].as_str().unwrap().to_owned();

    let (status, retry) = json_request(&app, "POST", &path, &bearer, Some(first_payload)).await;
    assert_eq!(status, StatusCode::OK, "{retry:?}");
    assert_eq!(retry["id"], first_id.to_string());
    assert_eq!(retry["action"], "created");
    assert_eq!(retry["idempotent"], true);
    assert_eq!(retry["medication_series_id"], first["medication_series_id"]);
    let first_event_count: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM patient_medication_import_history WHERE source_import_id = $1",
    )
    .bind(first_import)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(first_event_count, 1);

    let duplicate_import =
        seed_medication_review_import(&pool, patient_id, ceo_id, "med-2", &format!("{tag}-2"))
            .await;
    let duplicate_payload = json!({
        "candidate_id": "med-2",
        "wirkstoff": "atorvastatin",
        "handelsname": "Atoris",
        "staerke": "20 mg",
        "form": "tablet",
        "dose_abends": "1",
        "einheit": "tablet",
        "status": "aktiv",
        "einnahme_von": "2026-08-01",
        "source_country": "UA",
    });
    prepare_medication_review_import(
        &app,
        &bearer,
        patient_id,
        duplicate_import,
        "med-2",
        "UA",
        duplicate_payload.clone(),
    )
    .await;
    let (status, duplicate) = json_request(
        &app,
        "POST",
        &format!(
            "/api/v1/patients/{patient_id}/clinical-document-imports/{duplicate_import}/medications"
        ),
        &bearer,
        Some(duplicate_payload),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{duplicate:?}");
    assert_eq!(duplicate["action"], "deduplicated");
    assert_eq!(duplicate["id"], first_id.to_string());

    let changed_import =
        seed_medication_review_import(&pool, patient_id, ceo_id, "med-3", &format!("{tag}-3"))
            .await;
    let changed_payload = json!({
        "candidate_id": "med-3",
        "wirkstoff": "Atorvastatin",
        "handelsname": "Atoris",
        "staerke": "40 mg",
        "form": "tablet",
        "dose_abends": "1",
        "einheit": "tablet",
        "status": "active",
        "einnahme_von": "2026-08-10",
        "source_country": "UA",
        "source_date": "2026-08-10",
        "medication_series_id": first_series_id,
    });
    prepare_medication_review_import(
        &app,
        &bearer,
        patient_id,
        changed_import,
        "med-3",
        "UA",
        changed_payload.clone(),
    )
    .await;
    let (status, changed) = json_request(
        &app,
        "POST",
        &format!(
            "/api/v1/patients/{patient_id}/clinical-document-imports/{changed_import}/medications"
        ),
        &bearer,
        Some(changed_payload),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{changed:?}");
    assert_eq!(changed["action"], "regimen_changed");
    assert_eq!(changed["supersedes_medication_id"], first_id.to_string());
    let changed_id = Uuid::parse_str(changed["id"].as_str().unwrap()).unwrap();
    assert_ne!(changed_id, first_id);
    let first_superseded: bool = sqlx::query_scalar(
        "SELECT superseded_at IS NOT NULL FROM patient_medications WHERE id = $1",
    )
    .bind(first_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(first_superseded);

    let stop_import =
        seed_medication_review_import(&pool, patient_id, ceo_id, "med-4", &format!("{tag}-4"))
            .await;
    let stop_payload = json!({
        "candidate_id": "med-4",
        "wirkstoff": "Atorvastatin",
        "handelsname": "Atoris",
        "status": "stopped",
        "einnahme_bis": "2026-08-10",
        "source_country": "UA",
        "source_date": "2026-08-11",
    });
    let stop_reviewed_draft = prepare_medication_review_import(
        &app,
        &bearer,
        patient_id,
        stop_import,
        "med-4",
        "UA",
        stop_payload.clone(),
    )
    .await;
    let (status, stopped) = json_request(
        &app,
        "POST",
        &format!(
            "/api/v1/patients/{patient_id}/clinical-document-imports/{stop_import}/medications"
        ),
        &bearer,
        Some(stop_payload),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{stopped:?}");
    assert_eq!(stopped["action"], "status_transition");
    assert_eq!(stopped["id"], changed_id.to_string());
    let current_status: String =
        sqlx::query_scalar("SELECT status FROM patient_medications WHERE id = $1")
            .bind(changed_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(current_status, "abgesetzt");

    let (status, completed) = json_request(
        &app,
        "POST",
        &format!("/api/v1/patients/{patient_id}/clinical-document-imports/{stop_import}/complete"),
        &bearer,
        Some(json!({
            "reviewed_draft": stop_reviewed_draft,
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{completed:?}");
    assert_eq!(completed["status"], "applied");
    assert_eq!(completed["applied_counts"]["medications"], 1);

    let combined_import =
        seed_medication_review_import(&pool, patient_id, ceo_id, "med-5", &format!("{tag}-5"))
            .await;
    let combined_payload = json!({
        "candidate_id": "med-5",
        "wirkstoff": "Atorvastatin",
        "handelsname": "Atoris",
        "dose_abends": "2",
        "status": "stopped",
        "einnahme_bis": "2026-08-12",
        "source_country": "UA",
        "effective_date": "2026-08-12",
    });
    prepare_medication_review_import(
        &app,
        &bearer,
        patient_id,
        combined_import,
        "med-5",
        "UA",
        combined_payload.clone(),
    )
    .await;
    let (status, combined) = json_request(
        &app,
        "POST",
        &format!(
            "/api/v1/patients/{patient_id}/clinical-document-imports/{combined_import}/medications"
        ),
        &bearer,
        Some(combined_payload),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{combined:?}");
    assert_eq!(combined["action"], "regimen_changed");
    assert_eq!(combined["supersedes_medication_id"], changed_id.to_string());
    let combined_id = Uuid::parse_str(combined["id"].as_str().unwrap()).unwrap();
    assert_ne!(combined_id, changed_id);
    let combined_row = sqlx::query_as::<_, (String, Option<String>, Option<String>, String)>(
        r#"SELECT staerke, dose_abends, form, status
           FROM patient_medications WHERE id = $1"#,
    )
    .bind(combined_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(combined_row.0, "40 mg");
    assert_eq!(combined_row.1.as_deref(), Some("2"));
    assert_eq!(combined_row.2.as_deref(), Some("tablet"));
    assert_eq!(combined_row.3, "abgesetzt");

    let (status, history) = json_request(
        &app,
        "GET",
        &format!("/api/v1/patients/{patient_id}/medication-import-history"),
        &bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{history:?}");
    assert_eq!(history["items"].as_array().unwrap().len(), 5);
    assert_eq!(history["items"][0]["source_date"], "2026-08-12");
}

#[tokio::test]
async fn older_medication_documents_are_historical_and_never_replace_current_state() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };
    let tag = unique_tag("medication-chronology");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let ceo_id = admin_id;
    let bearer = auth_header_for(admin_id, "ceo");

    let (status, current) = persist_reviewed_medication(
        &app,
        &pool,
        &bearer,
        patient_id,
        ceo_id,
        "chronology-current",
        "UA",
        json!({
            "candidate_id": "chronology-current",
            "wirkstoff": "Bisoprolol",
            "handelsname": "Concor",
            "staerke": "5 mg",
            "form": "tablet",
            "dose_morgens": "1",
            "status": "active",
            "source_country": "UA",
            "source_date": "2026-08-10",
        }),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{current:?}");
    let current_id = Uuid::parse_str(current["id"].as_str().unwrap()).unwrap();
    let series_id = current["medication_series_id"].as_str().unwrap();

    let (status, old_regimen) = persist_reviewed_medication(
        &app,
        &pool,
        &bearer,
        patient_id,
        ceo_id,
        "chronology-old-regimen",
        "UA",
        json!({
            "candidate_id": "chronology-old-regimen",
            "medication_series_id": series_id,
            "wirkstoff": "Bisoprolol",
            "staerke": "2.5 mg",
            "source_country": "UA",
            "source_date": "2026-08-01",
        }),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{old_regimen:?}");
    assert_eq!(old_regimen["action"], "historical_observation");
    assert_ne!(old_regimen["id"], current_id.to_string());

    let (status, old_stop) = persist_reviewed_medication(
        &app,
        &pool,
        &bearer,
        patient_id,
        ceo_id,
        "chronology-old-stop",
        "UA",
        json!({
            "candidate_id": "chronology-old-stop",
            "medication_series_id": series_id,
            "wirkstoff": "Bisoprolol",
            "status": "stopped",
            "source_country": "UA",
            "source_date": "2026-08-02",
        }),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{old_stop:?}");
    assert_eq!(old_stop["action"], "historical_observation");

    let current_row = sqlx::query_as::<_, (Uuid, String, String, chrono::NaiveDate)>(
        r#"SELECT id, staerke, status, source_date
           FROM patient_medications
           WHERE patient_id = $1 AND medication_series_id = $2 AND superseded_at IS NULL"#,
    )
    .bind(patient_id)
    .bind(Uuid::parse_str(series_id).unwrap())
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(current_row.0, current_id);
    assert_eq!(current_row.1, "5 mg");
    assert_eq!(current_row.2, "aktiv");
    assert_eq!(current_row.3.to_string(), "2026-08-10");

    let (status, undated_change) = persist_reviewed_medication(
        &app,
        &pool,
        &bearer,
        patient_id,
        ceo_id,
        "chronology-undated",
        "UA",
        json!({
            "candidate_id": "chronology-undated",
            "medication_series_id": series_id,
            "wirkstoff": "Bisoprolol",
            "dose_morgens": "2",
            "source_country": "UA",
        }),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{undated_change:?}");

    let (status, history) = json_request(
        &app,
        "GET",
        &format!("/api/v1/patients/{patient_id}/medication-import-history?limit=2&offset=0"),
        &bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{history:?}");
    assert_eq!(history["total"], 3);
    assert_eq!(history["limit"], 2);
    assert_eq!(history["items"][0]["source_date"], "2026-08-10");
    assert_eq!(history["items"][1]["source_date"], "2026-08-02");
    assert_eq!(history["items"][1]["event_type"], "historical_observation");
    assert_eq!(history["items"][0]["medication_series_id"], series_id);
}

#[tokio::test]
async fn same_ingredient_siblings_in_one_prepare_require_explicit_series_choices() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };
    let tag = unique_tag("medication-batch-series-identity");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let ceo_id = admin_id;
    let bearer = auth_header_for(admin_id, "ceo");
    let import_id = seed_medication_review_import(&pool, patient_id, ceo_id, "batch-a", &tag).await;
    let reviewed_draft = json!({
        "candidates": [
            {
                "id": "batch-a",
                "target": "medication",
                "value": "First reviewed medication candidate",
                "selected": true,
            },
            {
                "id": "batch-b",
                "target": "medication",
                "value": "Second reviewed medication candidate",
                "selected": true,
            }
        ],
        "warnings": [],
    });
    sqlx::query("UPDATE clinical_document_imports SET draft = $2 WHERE id = $1")
        .bind(import_id)
        .bind(&reviewed_draft)
        .execute(&pool)
        .await
        .unwrap();

    let mut first_payload = json!({
        "candidate_id": "batch-a",
        "wirkstoff": "Levothyroxin",
        "handelsname": "L-Thyroxin A",
        "staerke": "50 mcg",
        "form": "tablet",
        "source_country": "DE",
        "source_date": "2026-08-10",
    });
    let mut second_payload = json!({
        "candidate_id": "batch-b",
        "wirkstoff": "Levothyroxin",
        "handelsname": "L-Thyroxin B",
        "staerke": "100 mcg",
        "form": "capsule",
        "source_country": "DE",
        "source_date": "2026-08-10",
    });
    let prepare_path =
        format!("/api/v1/patients/{patient_id}/clinical-document-imports/{import_id}/prepare");
    let (status, unresolved) = json_request(
        &app,
        "POST",
        &prepare_path,
        &bearer,
        Some(json!({
            "reviewed_draft": reviewed_draft,
            "source_country": "DE",
            "patient_identity_confirmed": true,
            "candidate_payloads": {
                "batch-a": first_payload,
                "batch-b": second_payload,
            },
        })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{unresolved:?}");

    first_payload["create_new_series"] = json!(true);
    second_payload["create_new_series"] = json!(true);
    let (status, prepared) = json_request(
        &app,
        "POST",
        &prepare_path,
        &bearer,
        Some(json!({
            "reviewed_draft": reviewed_draft,
            "source_country": "DE",
            "patient_identity_confirmed": true,
            "candidate_payloads": {
                "batch-a": first_payload,
                "batch-b": second_payload,
            },
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{prepared:?}");

    let medication_path =
        format!("/api/v1/patients/{patient_id}/clinical-document-imports/{import_id}/medications");
    let (status, first) =
        json_request(&app, "POST", &medication_path, &bearer, Some(first_payload)).await;
    assert_eq!(status, StatusCode::OK, "{first:?}");
    let (status, second) = json_request(
        &app,
        "POST",
        &medication_path,
        &bearer,
        Some(second_payload),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{second:?}");
    assert_ne!(
        first["medication_series_id"],
        second["medication_series_id"]
    );

    let current_series_count: i64 = sqlx::query_scalar(
        r#"SELECT count(DISTINCT medication_series_id)
           FROM patient_medications
           WHERE patient_id = $1 AND superseded_at IS NULL"#,
    )
    .bind(patient_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(current_series_count, 2);
}

#[tokio::test]
async fn sole_same_ingredient_series_rejects_mismatched_strong_selector() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };
    let tag = unique_tag("medication-sole-series-selector");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let ceo_id = admin_id;
    let bearer = auth_header_for(admin_id, "ceo");

    let (status, first) = persist_reviewed_medication(
        &app,
        &pool,
        &bearer,
        patient_id,
        ceo_id,
        "sole-series-first",
        "DE",
        json!({
            "candidate_id": "sole-series-first",
            "wirkstoff": "Atorvastatin",
            "handelsname": "Sortis",
            "staerke": "10 mg",
            "form": "tablet",
            "create_new_series": true,
            "source_country": "DE",
            "source_date": "2026-08-01",
        }),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{first:?}");

    let (status, mismatch) = persist_reviewed_medication(
        &app,
        &pool,
        &bearer,
        patient_id,
        ceo_id,
        "sole-series-mismatch",
        "DE",
        json!({
            "candidate_id": "sole-series-mismatch",
            "wirkstoff": "Atorvastatin",
            "staerke": "20 mg",
            "status": "stopped",
            "source_country": "DE",
            "source_date": "2026-08-02",
        }),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{mismatch:?}");

    let current: (String, String) = sqlx::query_as(
        r#"SELECT staerke, status
           FROM patient_medications
           WHERE patient_id = $1 AND superseded_at IS NULL"#,
    )
    .bind(patient_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(current, ("10 mg".to_string(), "aktiv".to_string()));
}

#[tokio::test]
async fn same_ingredient_series_require_unambiguous_review_or_explicit_new_series() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };
    let tag = unique_tag("medication-series-identity");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let ceo_id = admin_id;
    let bearer = auth_header_for(admin_id, "ceo");

    let (status, first) = persist_reviewed_medication(
        &app,
        &pool,
        &bearer,
        patient_id,
        ceo_id,
        "identity-first",
        "DE",
        json!({
            "candidate_id": "identity-first",
            "wirkstoff": "Levothyroxin",
            "handelsname": "L-Thyroxin A",
            "staerke": "50 mcg",
            "form": "tablet",
            "create_new_series": true,
            "source_country": "DE",
            "source_date": "2026-08-01",
        }),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{first:?}");
    let first_series = first["medication_series_id"].as_str().unwrap();

    let (status, second) = persist_reviewed_medication(
        &app,
        &pool,
        &bearer,
        patient_id,
        ceo_id,
        "identity-second",
        "DE",
        json!({
            "candidate_id": "identity-second",
            "wirkstoff": "Levothyroxin",
            "handelsname": "L-Thyroxin B",
            "staerke": "100 mcg",
            "form": "capsule",
            "create_new_series": true,
            "source_country": "DE",
            "source_date": "2026-08-01",
        }),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{second:?}");
    let second_series = second["medication_series_id"].as_str().unwrap();
    assert_ne!(first_series, second_series);

    let (status, auto_selected) = persist_reviewed_medication(
        &app,
        &pool,
        &bearer,
        patient_id,
        ceo_id,
        "identity-strong-match",
        "DE",
        json!({
            "candidate_id": "identity-strong-match",
            "wirkstoff": "Levothyroxin",
            "handelsname": "L-Thyroxin B",
            "staerke": "100 mcg",
            "form": "capsule",
            "status": "paused",
            "source_country": "DE",
            "source_date": "2026-08-02",
        }),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{auto_selected:?}");
    assert_eq!(auto_selected["action"], "status_transition");
    assert_eq!(auto_selected["medication_series_id"], second_series);

    let (status, ambiguous) = persist_reviewed_medication(
        &app,
        &pool,
        &bearer,
        patient_id,
        ceo_id,
        "identity-ambiguous-stop",
        "DE",
        json!({
            "candidate_id": "identity-ambiguous-stop",
            "wirkstoff": "Levothyroxin",
            "status": "stopped",
            "source_country": "DE",
            "source_date": "2026-08-02",
        }),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{ambiguous:?}");

    let (status, selected) = persist_reviewed_medication(
        &app,
        &pool,
        &bearer,
        patient_id,
        ceo_id,
        "identity-explicit-stop",
        "DE",
        json!({
            "candidate_id": "identity-explicit-stop",
            "medication_series_id": first_series,
            "wirkstoff": "Levothyroxin",
            "status": "stopped",
            "source_country": "DE",
            "source_date": "2026-08-02",
        }),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{selected:?}");
    assert_eq!(selected["action"], "status_transition");
    assert_eq!(selected["medication_series_id"], first_series);

    let (status, third) = persist_reviewed_medication(
        &app,
        &pool,
        &bearer,
        patient_id,
        ceo_id,
        "identity-third-new",
        "DE",
        json!({
            "candidate_id": "identity-third-new",
            "wirkstoff": "Levothyroxin",
            "handelsname": "L-Thyroxin C",
            "staerke": "75 mcg",
            "form": "drops",
            "create_new_series": true,
            "source_country": "DE",
            "source_date": "2026-08-03",
        }),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{third:?}");
    assert_eq!(third["action"], "created");
    let current_count: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM patient_medications WHERE patient_id = $1 AND superseded_at IS NULL",
    )
    .bind(patient_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(current_count, 3);
}

#[tokio::test]
async fn explicit_null_clears_nullable_regimen_fields_instead_of_inheriting_them() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };
    let tag = unique_tag("medication-explicit-clear");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let ceo_id = admin_id;
    let bearer = auth_header_for(admin_id, "ceo");

    let (status, first) = persist_reviewed_medication(
        &app,
        &pool,
        &bearer,
        patient_id,
        ceo_id,
        "clear-first",
        "DE",
        json!({
            "candidate_id": "clear-first",
            "wirkstoff": "Ramipril",
            "handelsname": "Delix",
            "staerke": "5 mg",
            "form": "tablet",
            "dose_morgens": "1",
            "hinweis": "with breakfast",
            "source_country": "DE",
            "source_date": "2026-08-01",
        }),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{first:?}");
    let series_id = first["medication_series_id"].as_str().unwrap();

    let (status, cleared) = persist_reviewed_medication(
        &app,
        &pool,
        &bearer,
        patient_id,
        ceo_id,
        "clear-second",
        "DE",
        json!({
            "candidate_id": "clear-second",
            "medication_series_id": series_id,
            "wirkstoff": "Ramipril",
            "dose_morgens": null,
            "form": null,
            "hinweis": null,
            "source_country": "DE",
            "source_date": "2026-08-02",
        }),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{cleared:?}");
    assert_eq!(cleared["action"], "regimen_changed");
    let row = sqlx::query_as::<_, (Option<String>, Option<String>, Option<String>, String)>(
        r#"SELECT dose_morgens, form, hinweis, staerke
           FROM patient_medications
           WHERE patient_id = $1 AND medication_series_id = $2 AND superseded_at IS NULL"#,
    )
    .bind(patient_id)
    .bind(Uuid::parse_str(series_id).unwrap())
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(row.0, None);
    assert_eq!(row.1, None);
    assert_eq!(row.2, None);
    assert_eq!(row.3, "5 mg");
}

#[tokio::test]
async fn reviewed_medication_import_scopes_drug_candidates_to_source_country() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };
    let tag = unique_tag("ocr-medication-country");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let ceo_id = admin_id;
    let bearer = auth_header_for(admin_id, "ceo");
    let german_product_id: Uuid = sqlx::query_scalar(
        "SELECT id FROM drug_products WHERE normalized_brand_name = 'sortis' AND country_code = 'DE' LIMIT 1",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    let rejected_payload = json!({
        "candidate_id": "country-1",
        "wirkstoff": "Atorvastatin",
        "handelsname": "Atoris",
        "staerke": "20 mg",
        "source_country": "UA",
        "drug_product_id": german_product_id,
    });
    let import_id =
        seed_medication_review_import(&pool, patient_id, ceo_id, "country-1", &tag).await;
    prepare_medication_review_import(
        &app,
        &bearer,
        patient_id,
        import_id,
        "country-1",
        "UA",
        rejected_payload.clone(),
    )
    .await;
    let path =
        format!("/api/v1/patients/{patient_id}/clinical-document-imports/{import_id}/medications");

    let (status, rejected) =
        json_request(&app, "POST", &path, &bearer, Some(rejected_payload)).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{rejected:?}");

    let successful_payload = json!({
        "candidate_id": "country-2",
        "wirkstoff": "Atorvastatin",
        "handelsname": "Atoris",
        "staerke": "20 mg",
        "source_country": "UA",
        "identifiers": { "atc_code": "C10AA05" },
    });
    let successful_import = seed_medication_review_import(
        &pool,
        patient_id,
        ceo_id,
        "country-2",
        &format!("{tag}-success"),
    )
    .await;
    prepare_medication_review_import(
        &app,
        &bearer,
        patient_id,
        successful_import,
        "country-2",
        "UA",
        successful_payload.clone(),
    )
    .await;
    let (status, imported) = json_request(
        &app,
        "POST",
        &format!(
            "/api/v1/patients/{patient_id}/clinical-document-imports/{successful_import}/medications"
        ),
        &bearer,
        Some(successful_payload),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{imported:?}");
    let medication_id = Uuid::parse_str(imported["id"].as_str().unwrap()).unwrap();
    let matches = sqlx::query_as::<_, (String, String, String)>(
        r#"SELECT p.country_code, m.verification_status, m.match_kind
           FROM medication_drug_matches m
           JOIN drug_products p ON p.id = m.drug_product_id
           WHERE m.patient_medication_id = $1"#,
    )
    .bind(medication_id)
    .fetch_all(&pool)
    .await
    .unwrap();
    assert!(!matches.is_empty());
    assert!(matches.iter().all(|(country, status, kind)| {
        country == "UA" && status == "candidate" && kind == "auto_candidate"
    }));
}

#[tokio::test]
async fn ceo_can_persist_and_read_lab_results_during_clinical_import_review() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };
    let tag = unique_tag("ceo-lab-import");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let bearer = auth_header_for(admin_id, "ceo");

    let import_id =
        seed_medication_review_import(&pool, patient_id, admin_id, "mixed-med-1", &tag).await;
    let medication_payload = json!({
        "candidate_id": "mixed-med-1",
        "wirkstoff": "Metformin",
        "staerke": "500 mg",
        "source_country": "DE",
        "source_date": "2026-08-12",
    });
    prepare_medication_review_import(
        &app,
        &bearer,
        patient_id,
        import_id,
        "mixed-med-1",
        "DE",
        medication_payload.clone(),
    )
    .await;
    let (status, medication) = json_request(
        &app,
        "POST",
        &format!("/api/v1/patients/{patient_id}/clinical-document-imports/{import_id}/medications"),
        &bearer,
        Some(medication_payload),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{medication:?}");
    assert_eq!(medication["action"], "created");

    let (status, created) = json_request(
        &app,
        "POST",
        &format!("/api/v1/patients/{patient_id}/lab-results"),
        &bearer,
        Some(json!({
            "measured_at": "2026-08-12T09:00:00Z",
            "panel": "Blood count",
            "analyte_name": "Leukocytes",
            "result_text": "6.1",
            "numeric_result": 6.1,
            "unit": "10^9/L",
            "abnormal_flag": "normal",
            "source_country": "DE",
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{created:?}");

    let (status, listed) = json_request(
        &app,
        "GET",
        &format!("/api/v1/patients/{patient_id}/lab-results"),
        &bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{listed:?}");
    assert_eq!(listed["count"], 1);
    assert_eq!(listed["items"][0]["analyte_name"], "Leukocytes");
    assert_eq!(listed["items"][0]["measured_at_precision"], "datetime");
}

#[tokio::test]
async fn ceo_can_correct_imported_lab_result_without_mutating_provenance() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };
    let tag = unique_tag("correct-imported-lab");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let other_patient_id = seed_patient(&pool, admin_id, &format!("{tag}-other")).await;
    let bearer = auth_header_for(admin_id, "ceo");
    let import_id =
        seed_medication_review_import(&pool, patient_id, admin_id, "lab-correction-1", &tag).await;
    let document_id: Uuid =
        sqlx::query_scalar("SELECT document_id FROM clinical_document_imports WHERE id = $1")
            .bind(import_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    let lab_result_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO patient_lab_results (
                patient_id, measured_at, measured_at_precision, panel, analyte_name,
                result_text, numeric_result, comparator, unit, reference_text,
                reference_low, reference_high, abnormal_flag, source_country,
                source_document_id, source_import_id, source_candidate_id, source_page,
                recorded_by
           ) VALUES (
                $1, '2026-08-12T00:00:00Z', 'date', 'Blood count', 'Hemoglobin',
                '13.2', 13.2, '=', 'g/dL', '12.0 - 16.0',
                12.0, 16.0, 'normal', 'DE', $2, $3, 'lab-correction-1', 2, $4
           )
           RETURNING id"#,
    )
    .bind(patient_id)
    .bind(document_id)
    .bind(import_id)
    .bind(admin_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    let correction_path = format!("/api/v1/patients/{patient_id}/lab-results/{lab_result_id}");
    let valid_correction = json!({
        "measured_at": "2026-08-12",
        "panel": "Blood count",
        "analyte_name": "Leukozyten",
        "result_text": "14.000",
        "numeric_result": 14000.0,
        "comparator": "=",
        "unit": "/μL",
        "reference_text": "4.000 - 10.000 /μL",
        "reference_low": 4000.0,
        "reference_high": 10000.0,
        "abnormal_flag": "high",
        "correction_note": "OCR digit checked against source document",
    });

    for import_status in ["review_required", "applying"] {
        sqlx::query("UPDATE clinical_document_imports SET status = $2 WHERE id = $1")
            .bind(import_id)
            .bind(import_status)
            .execute(&pool)
            .await
            .unwrap();
        let (status, blocked) = json_request(
            &app,
            "PATCH",
            &correction_path,
            &bearer,
            Some(valid_correction.clone()),
        )
        .await;
        assert_eq!(status, StatusCode::CONFLICT, "{import_status}: {blocked:?}");
        let (status, blocked_delete) = json_request(
            &app,
            "DELETE",
            &correction_path,
            &bearer,
            Some(json!({ "deletion_note": "Must wait for applied import" })),
        )
        .await;
        assert_eq!(
            status,
            StatusCode::CONFLICT,
            "{import_status}: {blocked_delete:?}"
        );
        let unchanged = sqlx::query_as::<_, (String, Option<chrono::DateTime<chrono::Utc>>)>(
            "SELECT result_text, corrected_at FROM patient_lab_results WHERE id = $1",
        )
        .bind(lab_result_id)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(unchanged.0, "13.2");
        assert!(unchanged.1.is_none());
    }
    sqlx::query("UPDATE clinical_document_imports SET status = 'applied' WHERE id = $1")
        .bind(import_id)
        .execute(&pool)
        .await
        .unwrap();

    let mut stale_numeric = valid_correction.clone();
    stale_numeric["result_text"] = json!("13,4 g/dL");
    stale_numeric["numeric_result"] = json!(134.0);
    stale_numeric["unit"] = json!("g/dL");
    let (status, invalid) = json_request(
        &app,
        "PATCH",
        &correction_path,
        &bearer,
        Some(stale_numeric),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{invalid:?}");

    let mut stale_flag = valid_correction.clone();
    stale_flag["result_text"] = json!("18.0");
    stale_flag["numeric_result"] = json!(18.0);
    stale_flag["reference_low"] = json!(12.0);
    stale_flag["reference_high"] = json!(16.0);
    stale_flag["abnormal_flag"] = json!("normal");
    let (status, invalid) =
        json_request(&app, "PATCH", &correction_path, &bearer, Some(stale_flag)).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{invalid:?}");
    let unchanged: (String, Option<chrono::DateTime<chrono::Utc>>) =
        sqlx::query_as("SELECT result_text, corrected_at FROM patient_lab_results WHERE id = $1")
            .bind(lab_result_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(unchanged.0, "13.2");
    assert!(unchanged.1.is_none());
    let correction_audit_count: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM audit_log WHERE action = 'correct_patient_lab_result' AND entity_id = $1",
    )
    .bind(lab_result_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(correction_audit_count, 0);
    sqlx::query("UPDATE clinical_document_imports SET deleted_at = now() WHERE id = $1")
        .bind(import_id)
        .execute(&pool)
        .await
        .unwrap();

    let (status, corrected) = json_request(
        &app,
        "PATCH",
        &correction_path,
        &bearer,
        Some(valid_correction.clone()),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{corrected:?}");
    assert_eq!(corrected["item"]["result_text"], "14.000");
    assert_eq!(corrected["item"]["numeric_result"], 14000.0);
    assert_eq!(corrected["item"]["measured_at_precision"], "date");
    assert_eq!(corrected["item"]["source_country"], "DE");
    assert_eq!(
        corrected["item"]["source_document_id"],
        document_id.to_string()
    );
    assert_eq!(corrected["item"]["source_import_id"], import_id.to_string());
    assert_eq!(corrected["item"]["source_candidate_id"], "lab-correction-1");
    assert_eq!(corrected["item"]["source_page"], 2);
    assert_eq!(corrected["item"]["corrected_by"], admin_id.to_string());
    assert!(corrected["item"]["corrected_by_name"].is_string());
    assert!(corrected["item"]["corrected_at"].is_string());
    assert_eq!(
        corrected["item"]["correction_note"],
        "OCR digit checked against source document"
    );

    let persisted = sqlx::query_as::<
        _,
        (
            String,
            Option<f64>,
            Option<String>,
            Option<Uuid>,
            Option<Uuid>,
            Option<String>,
            Option<i32>,
            Option<Uuid>,
            Option<String>,
        ),
    >(
        r#"SELECT result_text, numeric_result, source_country, source_document_id,
                  source_import_id, source_candidate_id, source_page, corrected_by,
                  correction_note
           FROM patient_lab_results
           WHERE id = $1"#,
    )
    .bind(lab_result_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(persisted.0, "14.000");
    assert_eq!(persisted.1, Some(14000.0));
    assert_eq!(persisted.2.as_deref(), Some("DE"));
    assert_eq!(persisted.3, Some(document_id));
    assert_eq!(persisted.4, Some(import_id));
    assert_eq!(persisted.5.as_deref(), Some("lab-correction-1"));
    assert_eq!(persisted.6, Some(2));
    assert_eq!(persisted.7, Some(admin_id));
    assert_eq!(
        persisted.8.as_deref(),
        Some("OCR digit checked against source document")
    );

    support::wait_until("lab result correction audit entry", || async {
        sqlx::query_scalar::<_, bool>(
            r#"SELECT EXISTS(
                   SELECT 1 FROM audit_log
                   WHERE action = 'correct_patient_lab_result'
                     AND entity_type = 'patient_lab_result' AND entity_id = $1
               )"#,
        )
        .bind(lab_result_id)
        .fetch_one(&pool)
        .await
        .unwrap_or(false)
    })
    .await;
    let audit = sqlx::query_as::<_, (Value, Value, Value)>(
        r#"SELECT old_value, new_value, context
           FROM audit_log
           WHERE action = 'correct_patient_lab_result'
             AND entity_type = 'patient_lab_result' AND entity_id = $1
           ORDER BY created_at DESC
           LIMIT 1"#,
    )
    .bind(lab_result_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(audit.0["result_text"], "13.2");
    assert_eq!(audit.1["result_text"], "14.000");
    assert_eq!(
        audit.2["reason"],
        "OCR digit checked against source document"
    );
    assert_eq!(
        audit.2["provenance"]["source_document_id"],
        document_id.to_string()
    );
    assert_eq!(
        audit.2["provenance"]["source_import_id"],
        import_id.to_string()
    );

    let (status, listed) = json_request(
        &app,
        "GET",
        &format!("/api/v1/patients/{patient_id}/lab-results"),
        &bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{listed:?}");
    assert_eq!(listed["items"][0]["corrected_by"], admin_id.to_string());
    assert!(listed["items"][0]["corrected_by_name"].is_string());
    assert!(listed["items"][0]["corrected_at"].is_string());
    assert_eq!(
        listed["items"][0]["correction_note"],
        "OCR digit checked against source document"
    );

    let mut missing_note = valid_correction.clone();
    missing_note
        .as_object_mut()
        .unwrap()
        .remove("correction_note");
    missing_note["result_text"] = json!("11.0");
    let (status, invalid) =
        json_request(&app, "PATCH", &correction_path, &bearer, Some(missing_note)).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{invalid:?}");

    let mut invalid_range = valid_correction.clone();
    invalid_range["reference_low"] = json!(20.0);
    invalid_range["reference_high"] = json!(10.0);
    let (status, invalid) = json_request(
        &app,
        "PATCH",
        &correction_path,
        &bearer,
        Some(invalid_range),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{invalid:?}");

    let mut provenance_mutation = valid_correction;
    provenance_mutation["source_page"] = json!(7);
    let (status, invalid) = json_request(
        &app,
        "PATCH",
        &correction_path,
        &bearer,
        Some(provenance_mutation),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{invalid:?}");

    let (status, wrong_patient) = json_request(
        &app,
        "PATCH",
        &format!("/api/v1/patients/{other_patient_id}/lab-results/{lab_result_id}"),
        &bearer,
        Some(json!({
            "measured_at": "2026-08-12",
            "panel": "Blood count",
            "analyte_name": "Hemoglobin",
            "result_text": "11.0",
            "numeric_result": 11.0,
            "comparator": "=",
            "unit": "g/dL",
            "reference_text": "12.0 - 16.0",
            "reference_low": 12.0,
            "reference_high": 16.0,
            "abnormal_flag": "low",
            "correction_note": "Must not update a different patient",
        })),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND, "{wrong_patient:?}");

    let result_after_rejections: String =
        sqlx::query_scalar("SELECT result_text FROM patient_lab_results WHERE id = $1")
            .bind(lab_result_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(result_after_rejections, "14.000");

    let (status, invalid_delete) = json_request(
        &app,
        "DELETE",
        &correction_path,
        &bearer,
        Some(json!({ "deletion_note": "" })),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::UNPROCESSABLE_ENTITY,
        "{invalid_delete:?}"
    );

    let (status, deleted) = json_request(
        &app,
        "DELETE",
        &correction_path,
        &bearer,
        Some(json!({
            "deletion_note": "Duplicate result confirmed against the source document"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{deleted:?}");
    assert_eq!(deleted["id"], lab_result_id.to_string());

    let deletion = sqlx::query_as::<
        _,
        (
            Option<chrono::DateTime<chrono::Utc>>,
            Option<Uuid>,
            Option<String>,
            Option<Uuid>,
            Option<Uuid>,
            Option<String>,
        ),
    >(
        r#"SELECT deleted_at, deleted_by, deletion_note, source_document_id,
                  source_import_id, source_candidate_id
           FROM patient_lab_results WHERE id = $1"#,
    )
    .bind(lab_result_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(deletion.0.is_some());
    assert_eq!(deletion.1, Some(admin_id));
    assert_eq!(
        deletion.2.as_deref(),
        Some("Duplicate result confirmed against the source document")
    );
    assert_eq!(deletion.3, Some(document_id));
    assert_eq!(deletion.4, Some(import_id));
    assert_eq!(deletion.5.as_deref(), Some("lab-correction-1"));

    let (status, listed_after_delete) = json_request(
        &app,
        "GET",
        &format!("/api/v1/patients/{patient_id}/lab-results"),
        &bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{listed_after_delete:?}");
    assert_eq!(listed_after_delete["count"], 0);

    support::wait_until("lab result deletion audit entry", || async {
        sqlx::query_scalar::<_, bool>(
            r#"SELECT EXISTS(
                   SELECT 1 FROM audit_log
                   WHERE action = 'delete_patient_lab_result'
                     AND entity_type = 'patient_lab_result' AND entity_id = $1
               )"#,
        )
        .bind(lab_result_id)
        .fetch_one(&pool)
        .await
        .unwrap_or(false)
    })
    .await;
    let deletion_audit = sqlx::query_as::<_, (Value, Value, Value)>(
        r#"SELECT old_value, new_value, context
           FROM audit_log
           WHERE action = 'delete_patient_lab_result'
             AND entity_type = 'patient_lab_result' AND entity_id = $1
           ORDER BY created_at DESC LIMIT 1"#,
    )
    .bind(lab_result_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(deletion_audit.0["result_text"], "14.000");
    assert_eq!(
        deletion_audit.1["deletion_note"],
        "Duplicate result confirmed against the source document"
    );
    assert_eq!(
        deletion_audit.2["provenance"]["source_import_id"],
        import_id.to_string()
    );
}

#[tokio::test]
async fn imported_lab_requires_prepared_selection_and_matching_frozen_country() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };
    let tag = unique_tag("staged-lab-country");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let bearer = auth_header_for(admin_id, "ceo");
    let import_id =
        seed_medication_review_import(&pool, patient_id, admin_id, "lab-stage-1", &tag).await;
    let reviewed_draft = json!({
        "candidates": [{
            "id": "lab-stage-1",
            "target": "lab_result",
            "value": "Leukocytes 6.1 G/L",
            "selected": true,
        }],
        "warnings": [],
    });
    sqlx::query("UPDATE clinical_document_imports SET draft = $2 WHERE id = $1")
        .bind(import_id)
        .bind(&reviewed_draft)
        .execute(&pool)
        .await
        .unwrap();
    let lab_payload = |country: &str| {
        json!({
            "measured_at": "2026-08-12T09:00:00Z",
            "panel": "Blood count",
            "analyte_name": "Leukocytes",
            "result_text": "6.1",
            "numeric_result": 6.1,
            "unit": "G/L",
            "abnormal_flag": "normal",
            "source_country": country,
            "source_import_id": import_id,
            "source_candidate_id": "lab-stage-1",
        })
    };
    let lab_path = format!("/api/v1/patients/{patient_id}/lab-results");
    let (status, _) = json_request(&app, "POST", &lab_path, &bearer, Some(lab_payload("DE"))).await;
    assert_eq!(status, StatusCode::CONFLICT);

    let prepare_path =
        format!("/api/v1/patients/{patient_id}/clinical-document-imports/{import_id}/prepare");
    let mut bad_date = lab_payload("DE");
    bad_date["measured_at"] = json!("12.08.2026");
    let mut empty_required_text = lab_payload("DE");
    empty_required_text["analyte_name"] = json!("   ");
    empty_required_text["result_text"] = json!("");
    let mut invalid_comparator = lab_payload("DE");
    invalid_comparator["comparator"] = json!("approximately");
    let mut invalid_range = lab_payload("DE");
    invalid_range["reference_low"] = json!(10.0);
    invalid_range["reference_high"] = json!(1.0);
    let mut invalid_numeric_type = lab_payload("DE");
    invalid_numeric_type["numeric_result"] = json!("6.1");
    let mut invalid_abnormal_flag = lab_payload("DE");
    invalid_abnormal_flag["abnormal_flag"] = json!("critical");
    for (case, malformed_payload) in [
        ("bad date", bad_date),
        ("empty analyte/result", empty_required_text),
        ("invalid comparator", invalid_comparator),
        ("invalid range", invalid_range),
        ("invalid numeric type", invalid_numeric_type),
        ("invalid abnormal flag", invalid_abnormal_flag),
    ] {
        let (status, malformed) = json_request(
            &app,
            "POST",
            &prepare_path,
            &bearer,
            Some(json!({
                "reviewed_draft": reviewed_draft,
                "source_country": "DE",
                "patient_identity_confirmed": true,
                "candidate_payloads": {
                    "lab-stage-1": malformed_payload,
                },
            })),
        )
        .await;
        assert_eq!(
            status,
            StatusCode::UNPROCESSABLE_ENTITY,
            "{case}: {malformed:?}"
        );
        let import_status: String =
            sqlx::query_scalar("SELECT status FROM clinical_document_imports WHERE id = $1")
                .bind(import_id)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(import_status, "review_required", "{case}");
    }

    let (status, prepared) = json_request(
        &app,
        "POST",
        &prepare_path,
        &bearer,
        Some(json!({
            "reviewed_draft": reviewed_draft,
            "source_country": "DE",
            "patient_identity_confirmed": true,
            "candidate_payloads": {
                "lab-stage-1": lab_payload("DE"),
            },
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{prepared:?}");

    sqlx::query(
        "UPDATE clinical_document_imports SET prepared_identity_gate_version = 0 WHERE id = $1",
    )
    .bind(import_id)
    .execute(&pool)
    .await
    .unwrap();
    let (status, gate_blocked) =
        json_request(&app, "POST", &lab_path, &bearer, Some(lab_payload("DE"))).await;
    assert_eq!(status, StatusCode::CONFLICT, "{gate_blocked:?}");
    sqlx::query(
        "UPDATE clinical_document_imports SET prepared_identity_gate_version = 1 WHERE id = $1",
    )
    .bind(import_id)
    .execute(&pool)
    .await
    .unwrap();

    let (status, wrong_country) =
        json_request(&app, "POST", &lab_path, &bearer, Some(lab_payload("UA"))).await;
    assert_eq!(status, StatusCode::CONFLICT, "{wrong_country:?}");

    let (status, created) =
        json_request(&app, "POST", &lab_path, &bearer, Some(lab_payload("DE"))).await;
    assert_eq!(status, StatusCode::OK, "{created:?}");

    let (status, retry) =
        json_request(&app, "POST", &lab_path, &bearer, Some(lab_payload("DE"))).await;
    assert_eq!(status, StatusCode::OK, "{retry:?}");

    let mut changed_lab = lab_payload("DE");
    changed_lab["result_text"] = json!("6.2");
    changed_lab["numeric_result"] = json!(6.2);
    let (status, changed) = json_request(&app, "POST", &lab_path, &bearer, Some(changed_lab)).await;
    assert_eq!(status, StatusCode::CONFLICT, "{changed:?}");
}

#[tokio::test]
async fn imported_vital_is_prevalidated_idempotent_and_keeps_immutable_provenance() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };
    let tag = unique_tag("staged-vital");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let import_id =
        seed_medication_review_import(&pool, patient_id, admin_id, "vital-stage-1", &tag).await;
    let bearer = auth_header_for(admin_id, "ceo");
    let reviewed_draft = json!({
        "candidates": [{
            "id": "vital-stage-1",
            "target": "vital",
            "value": "RR 128/76, Puls 68, SpO2 98%, Temperatur 36.7 C",
            "selected": true,
        }],
        "warnings": [],
    });
    sqlx::query("UPDATE clinical_document_imports SET draft = $2 WHERE id = $1")
        .bind(import_id)
        .bind(&reviewed_draft)
        .execute(&pool)
        .await
        .unwrap();
    let payload = json!({
        "measured_at": "2026-08-11T09:00:00Z",
        "bp_systolic": 128.0,
        "bp_diastolic": 76.0,
        "heart_rate": 68,
        "temperature_c": 36.7,
        "oxygen_saturation": 98.0,
        "respiratory_rate": 14,
        "weight_kg": 72.0,
        "height_cm": 175.0,
        "bmi": 23.5,
        "notes": "OCR reviewed baseline",
        "source_country": "DE",
        "source_import_id": import_id,
        "source_candidate_id": "vital-stage-1",
        "source_page": 2,
    });
    let vital_path = format!("/api/v1/patients/{patient_id}/vitals");
    let prepare_path =
        format!("/api/v1/patients/{patient_id}/clinical-document-imports/{import_id}/prepare");

    let (status, before_prepare) =
        json_request(&app, "POST", &vital_path, &bearer, Some(payload.clone())).await;
    assert_eq!(status, StatusCode::CONFLICT, "{before_prepare:?}");

    let mut invalid_saturation = payload.clone();
    invalid_saturation["oxygen_saturation"] = json!(10.0);
    let mut conflicting_bmi = payload.clone();
    conflicting_bmi["bmi"] = json!(40.0);
    let mut invalid_page = payload.clone();
    invalid_page["source_page"] = json!(0);
    let mut unknown_field = payload.clone();
    unknown_field["unreviewed_value"] = json!(true);
    for (case, invalid_payload) in [
        ("saturation range", invalid_saturation),
        ("conflicting bmi", conflicting_bmi),
        ("source page", invalid_page),
        ("unknown field", unknown_field),
    ] {
        let (status, body) = json_request(
            &app,
            "POST",
            &prepare_path,
            &bearer,
            Some(json!({
                "reviewed_draft": reviewed_draft,
                "source_country": "DE",
                "patient_identity_confirmed": true,
                "candidate_payloads": { "vital-stage-1": invalid_payload },
            })),
        )
        .await;
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{case}: {body:?}");
        let status: String =
            sqlx::query_scalar("SELECT status FROM clinical_document_imports WHERE id = $1")
                .bind(import_id)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(status, "review_required", "{case}");
        let count: i64 = sqlx::query_scalar(
            "SELECT count(*) FROM patient_vital_measurements WHERE source_import_id = $1",
        )
        .bind(import_id)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(count, 0, "{case} must not create an orphan vital");
    }

    let (status, identity_confirmation_required) = json_request(
        &app,
        "POST",
        &prepare_path,
        &bearer,
        Some(json!({
            "reviewed_draft": reviewed_draft,
            "source_country": "DE",
            "patient_identity_confirmed": false,
            "candidate_payloads": { "vital-stage-1": payload },
        })),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::CONFLICT,
        "{identity_confirmation_required:?}"
    );
    let import_status: String =
        sqlx::query_scalar("SELECT status FROM clinical_document_imports WHERE id = $1")
            .bind(import_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(import_status, "review_required");

    let (status, prepared) = json_request(
        &app,
        "POST",
        &prepare_path,
        &bearer,
        Some(json!({
            "reviewed_draft": reviewed_draft,
            "source_country": "DE",
            "patient_identity_confirmed": true,
            "candidate_payloads": { "vital-stage-1": payload },
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{prepared:?}");

    sqlx::query(
        "UPDATE clinical_document_imports SET prepared_identity_gate_version = 0 WHERE id = $1",
    )
    .bind(import_id)
    .execute(&pool)
    .await
    .unwrap();
    let (status, gate_blocked) =
        json_request(&app, "POST", &vital_path, &bearer, Some(payload.clone())).await;
    assert_eq!(status, StatusCode::CONFLICT, "{gate_blocked:?}");
    sqlx::query(
        "UPDATE clinical_document_imports SET prepared_identity_gate_version = 1 WHERE id = $1",
    )
    .bind(import_id)
    .execute(&pool)
    .await
    .unwrap();

    let mut changed = payload.clone();
    changed["heart_rate"] = json!(69);
    let (status, changed_body) =
        json_request(&app, "POST", &vital_path, &bearer, Some(changed)).await;
    assert_eq!(status, StatusCode::CONFLICT, "{changed_body:?}");

    let (status, created) =
        json_request(&app, "POST", &vital_path, &bearer, Some(payload.clone())).await;
    assert_eq!(status, StatusCode::OK, "{created:?}");
    assert_eq!(created["idempotent"], false);
    let measurement_id = created["id"].as_str().expect("created vital id");

    let (status, retry) =
        json_request(&app, "POST", &vital_path, &bearer, Some(payload.clone())).await;
    assert_eq!(status, StatusCode::OK, "{retry:?}");
    assert_eq!(retry["id"], measurement_id);
    assert_eq!(retry["idempotent"], true);

    let (status, listed) = json_request(&app, "GET", &vital_path, &bearer, None).await;
    assert_eq!(status, StatusCode::OK, "{listed:?}");
    assert_eq!(listed["count"], 1);
    assert_eq!(listed["items"][0]["temperature_c"], 36.7);
    assert_eq!(listed["items"][0]["oxygen_saturation"], 98.0);
    assert_eq!(listed["items"][0]["respiratory_rate"], 14);
    assert_eq!(listed["items"][0]["source_country"], "DE");
    assert_eq!(
        listed["items"][0]["source_import_id"],
        import_id.to_string()
    );
    assert_eq!(listed["items"][0]["source_candidate_id"], "vital-stage-1");
    assert_eq!(listed["items"][0]["source_page"], 2);
    assert_eq!(listed["items"][0]["measured_at_precision"], "datetime");
    assert!(listed["items"][0]["source_document_id"].is_string());
    assert!(listed["items"][0]["source_document_name"].is_string());

    let complete_path =
        format!("/api/v1/patients/{patient_id}/clinical-document-imports/{import_id}/complete");
    sqlx::query(
        "UPDATE clinical_document_imports SET prepared_identity_gate_version = 0 WHERE id = $1",
    )
    .bind(import_id)
    .execute(&pool)
    .await
    .unwrap();
    let (status, gate_blocked) = json_request(
        &app,
        "POST",
        &complete_path,
        &bearer,
        Some(json!({ "reviewed_draft": reviewed_draft })),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{gate_blocked:?}");
    sqlx::query(
        "UPDATE clinical_document_imports SET prepared_identity_gate_version = 1 WHERE id = $1",
    )
    .bind(import_id)
    .execute(&pool)
    .await
    .unwrap();
    let (status, completed) = json_request(
        &app,
        "POST",
        &complete_path,
        &bearer,
        Some(json!({ "reviewed_draft": reviewed_draft })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{completed:?}");
    assert_eq!(completed["status"], "applied");
    assert_eq!(completed["applied_counts"]["vitals"], 1);

    let (status, applied_retry) =
        json_request(&app, "POST", &vital_path, &bearer, Some(payload.clone())).await;
    assert_eq!(status, StatusCode::OK, "{applied_retry:?}");
    assert_eq!(applied_retry["id"], measurement_id);
    assert_eq!(applied_retry["idempotent"], true);

    let ceo_bearer = bearer.clone();
    let update_path = format!("/api/v1/patients/{patient_id}/vitals/{measurement_id}/update");
    let (status, update_body) = json_request(
        &app,
        "POST",
        &update_path,
        &ceo_bearer,
        Some(json!({
            "measured_at": "2026-08-11T09:00:00Z",
            "heart_rate": 70,
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{update_body:?}");
    let delete_path = format!("/api/v1/patients/{patient_id}/vitals/{measurement_id}/delete");
    let (status, delete_body) =
        json_request(&app, "POST", &delete_path, &ceo_bearer, Some(json!({}))).await;
    assert_eq!(status, StatusCode::CONFLICT, "{delete_body:?}");

    let persisted_count: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM patient_vital_measurements WHERE source_import_id = $1 AND source_candidate_id = $2",
    )
    .bind(import_id)
    .bind("vital-stage-1")
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(persisted_count, 1);
}

#[tokio::test]
async fn clinical_import_prepare_uses_authoritative_subject_and_freezes_name_confirmation() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };
    let tag = unique_tag("import-subject-gate");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let bearer = auth_header_for(admin_id, "ceo");
    let import_id =
        seed_medication_review_import(&pool, patient_id, admin_id, "subject-med-1", &tag).await;
    let reviewed_draft = json!({
        "subject": {
            "status": "extracted",
            "conflict": false,
            "first_name": format!("First {tag}"),
            "last_name": format!("Last {tag}"),
            "birth_date": "1990-01-01",
            "patient_identifier": format!("PT-{tag}"),
        },
        "candidates": [{
            "id": "subject-med-1",
            "target": "medication",
            "value": "Metformin 500 mg",
            "selected": true,
        }],
        "warnings": [],
    });
    let medication_payload = json!({
        "candidate_id": "subject-med-1",
        "wirkstoff": "Metformin",
        "staerke": "500 mg",
        "source_country": "DE",
        "source_date": "2026-08-11",
    });
    let prepare_path =
        format!("/api/v1/patients/{patient_id}/clinical-document-imports/{import_id}/prepare");
    let prepare_body = |patient_identity_confirmed: bool| {
        json!({
            "reviewed_draft": reviewed_draft.clone(),
            "source_country": "DE",
            "patient_identity_confirmed": patient_identity_confirmed,
            "candidate_payloads": { "subject-med-1": medication_payload.clone() },
        })
    };

    let hard_conflict_draft = json!({
        "subject": {
            "status": "conflict",
            "conflict": true,
            "first_name": null,
            "last_name": format!("Last {tag}"),
            "birth_date": "1991-01-01",
            "patient_identifier": format!("PT-{tag}"),
            "field_confidence": {},
            "source": { "page": 1, "text": "conflicting subject" },
            "review_reasons": ["conflicting_subject_identity"],
        },
        "candidates": reviewed_draft["candidates"].clone(),
        "warnings": [],
    });
    sqlx::query("UPDATE clinical_document_imports SET draft = $2 WHERE id = $1")
        .bind(import_id)
        .bind(hard_conflict_draft)
        .execute(&pool)
        .await
        .unwrap();
    let (status, hard_conflict) = json_request(
        &app,
        "POST",
        &prepare_path,
        &bearer,
        Some(prepare_body(true)),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{hard_conflict:?}");
    let import_status: String =
        sqlx::query_scalar("SELECT status FROM clinical_document_imports WHERE id = $1")
            .bind(import_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(import_status, "review_required");

    let name_mismatch_draft = json!({
        "subject": {
            "status": "extracted",
            "conflict": false,
            "first_name": format!("First {tag}"),
            "last_name": "Different",
            "birth_date": "1990-01-01",
            "patient_identifier": format!("PT-{tag}"),
            "field_confidence": {},
            "source": { "page": 1, "text": "name-only mismatch" },
            "review_reasons": [],
        },
        "candidates": reviewed_draft["candidates"].clone(),
        "warnings": [],
    });
    sqlx::query("UPDATE clinical_document_imports SET draft = $2 WHERE id = $1")
        .bind(import_id)
        .bind(name_mismatch_draft)
        .execute(&pool)
        .await
        .unwrap();
    let (status, confirmation_required) = json_request(
        &app,
        "POST",
        &prepare_path,
        &bearer,
        Some(prepare_body(false)),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{confirmation_required:?}");
    let import_status: String =
        sqlx::query_scalar("SELECT status FROM clinical_document_imports WHERE id = $1")
            .bind(import_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(import_status, "review_required");

    let (status, prepared) = json_request(
        &app,
        "POST",
        &prepare_path,
        &bearer,
        Some(prepare_body(true)),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{prepared:?}");
    assert_eq!(prepared["idempotent"], false);
    assert_eq!(prepared["patient_identity_confirmed"], true);

    let (status, different_retry) = json_request(
        &app,
        "POST",
        &prepare_path,
        &bearer,
        Some(prepare_body(false)),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{different_retry:?}");
    let (status, idempotent_retry) = json_request(
        &app,
        "POST",
        &prepare_path,
        &bearer,
        Some(prepare_body(true)),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{idempotent_retry:?}");
    assert_eq!(idempotent_retry["idempotent"], true);
    assert_eq!(idempotent_retry["patient_identity_confirmed"], true);

    let (status, fetched) = json_request(
        &app,
        "GET",
        &format!("/api/v1/patients/{patient_id}/clinical-document-imports/{import_id}"),
        &bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{fetched:?}");
    assert_eq!(fetched["prepared_patient_identity_confirmed"], true);
    assert_eq!(fetched["prepared_identity_gate_version"], 1);
}

#[tokio::test]
async fn patient_passport_round_trips_and_flags_expiry() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("passport");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let ceo_id = seed_user(&pool, &format!("{tag}-ceo"), "ceo").await;
    seed_patient_assignment(&pool, patient_id, ceo_id, admin_id).await;
    let ceo_bearer = auth_header_for(ceo_id, "ceo");

    // Record a passport that expired in the past.
    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/patients/{patient_id}/update"),
        &ceo_bearer,
        Some(json!({ "passport_number": "X1234567", "passport_expiry": "2020-01-01" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (status, detail) = json_request(
        &app,
        "GET",
        &format!("/api/v1/patients/{patient_id}"),
        &ceo_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(detail["passport_number"], "X1234567");
    assert_eq!(detail["passport_expiry"], "2020-01-01");
    assert_eq!(
        detail["passport_expired"], true,
        "past expiry must flag expired"
    );
    assert_eq!(detail["passport_status"], "expired");

    // Renew to a future date -> no longer expired; number preserved when omitted.
    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/patients/{patient_id}/update"),
        &ceo_bearer,
        Some(json!({ "passport_expiry": "2999-12-31" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (status, detail) = json_request(
        &app,
        "GET",
        &format!("/api/v1/patients/{patient_id}"),
        &ceo_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        detail["passport_number"], "X1234567",
        "number preserved when only expiry is patched"
    );
    assert_eq!(detail["passport_expiry"], "2999-12-31");
    assert_eq!(detail["passport_expired"], false);
    assert_eq!(detail["passport_status"], "valid");

    // A malformed date is rejected.
    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/patients/{patient_id}/update"),
        &ceo_bearer,
        Some(json!({ "passport_expiry": "31.12.2030" })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
}

#[tokio::test]
async fn patient_passport_expiring_soon_is_a_non_blocking_compliance_warning() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("passport-expiring");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let ceo_id = seed_user(&pool, &format!("{tag}-ceo"), "ceo").await;
    seed_patient_assignment(&pool, patient_id, ceo_id, admin_id).await;
    let ceo_bearer = auth_header_for(ceo_id, "ceo");

    // A passport expiring inside the 90-day warning window (30 days out).
    let soon = (chrono::Utc::now().date_naive() + chrono::Duration::days(30)).to_string();
    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/patients/{patient_id}/update"),
        &ceo_bearer,
        Some(json!({ "passport_number": "Y7654321", "passport_expiry": soon })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    // Patient detail flags it as expiring, not expired.
    let (status, detail) = json_request(
        &app,
        "GET",
        &format!("/api/v1/patients/{patient_id}"),
        &ceo_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(detail["passport_status"], "expiring");
    assert_eq!(detail["passport_expired"], false);
    assert_eq!(detail["passport_expiring"], true);
    assert!(detail["passport_days_until_expiry"].as_i64().unwrap() <= 30);

    // The compliance re-check surfaces the same status without blocking orders.
    let (status, recheck) = json_request(
        &app,
        "GET",
        &format!("/api/v1/patients/{patient_id}/recheck"),
        &ceo_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{recheck}");
    assert_eq!(recheck["passport_status"], "expiring");
    assert_eq!(recheck["passport_expiring"], true);
    assert_eq!(
        recheck["can_create_order"], true,
        "an expiring passport must never block order creation"
    );
    let blocking = recheck["blocking_reasons"].as_array().unwrap();
    assert!(
        blocking.iter().all(|reason| !reason
            .as_str()
            .unwrap_or_default()
            .to_lowercase()
            .contains("passport")),
        "expiring passport must not be a blocking reason"
    );
}

#[tokio::test]
async fn patient_vitals_round_trip_and_clinical_warnings_flow_through_profile() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("patient-vitals");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let ceo_id = seed_user(&pool, &format!("{tag}-ceo"), "ceo").await;
    seed_patient_assignment(&pool, patient_id, ceo_id, admin_id).await;
    let ceo_bearer = auth_header_for(ceo_id, "ceo");

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/patients/{patient_id}/update"),
        &ceo_bearer,
        Some(json!({
            "clinical_warnings": "Latex allergy\nMonitor blood pressure before sedation",
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/patients/{patient_id}/vitals"),
        &ceo_bearer,
        Some(json!({
            "measured_at": "2026-04-14T09:45:00Z",
            "bp_systolic": 125.0,
            "bp_diastolic": 82.0,
            "heart_rate": 71,
            "temperature_c": 36.6,
            "oxygen_saturation": 99.0,
            "respiratory_rate": 13,
            "weight_kg": 72.0,
            "height_cm": 175.0,
            "notes": "Pre-op baseline",
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/patients/{patient_id}/vitals"),
        &ceo_bearer,
        Some(json!({
            "measured_at": "2026-04-13T08:15:00Z",
            "weight_kg": 71.2,
            "heart_rate": 69,
            "notes": "Day-before intake",
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (status, detail) = json_request(
        &app,
        "GET",
        &format!("/api/v1/patients/{patient_id}"),
        &ceo_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        detail["clinical_warnings"],
        "Latex allergy\nMonitor blood pressure before sedation"
    );

    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/patients/{patient_id}/vitals"),
        &ceo_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["count"], 2);
    let items = body["items"].as_array().expect("vitals array");
    assert_eq!(items.len(), 2);
    assert_eq!(items[0]["measured_at"], "2026-04-14T09:45:00+00:00");
    assert_eq!(items[0]["bp_systolic"], 125.0);
    assert_eq!(items[0]["bp_diastolic"], 82.0);
    assert_eq!(items[0]["heart_rate"], 71);
    assert_eq!(items[0]["temperature_c"], 36.6);
    assert_eq!(items[0]["oxygen_saturation"], 99.0);
    assert_eq!(items[0]["respiratory_rate"], 13);
    assert_eq!(items[0]["weight_kg"], 72.0);
    assert_eq!(items[0]["height_cm"], 175.0);
    let bmi = items[0]["bmi"].as_f64().expect("bmi");
    assert!(
        (bmi - 23.5).abs() < 0.05,
        "expected auto-computed bmi close to 23.5, got {bmi}"
    );
    assert_eq!(items[0]["notes"], "Pre-op baseline");
    assert!(items[0]["source_import_id"].is_null());
    assert!(items[0]["source_candidate_id"].is_null());
    assert_eq!(items[1]["measured_at"], "2026-04-13T08:15:00+00:00");

    // Laboratory observations form an append-only, unit-preserving history:
    // a repeated analyte adds a new dated point and new analytes need no schema change.
    for payload in [
        json!({
            "measured_at": "2026-04-12",
            "panel": "Blood count",
            "analyte_name": "Leukocytes",
            "result_text": "6.4",
            "numeric_result": 6.4,
            "unit": "G/L",
            "reference_text": "3.7 - 9.9",
            "reference_low": 3.7,
            "reference_high": 9.9,
            "abnormal_flag": "normal",
            "source_country": "DE"
        }),
        json!({
            "measured_at": "2026-04-14",
            "panel": "Blood count",
            "analyte_name": "Leukocytes",
            "result_text": "6400",
            "numeric_result": 6400.0,
            "unit": "cells/µL",
            "reference_text": "3700 - 9900",
            "reference_low": 3700.0,
            "reference_high": 9900.0,
            "abnormal_flag": "normal",
            "source_country": "US"
        }),
        json!({
            "measured_at": "2026-04-14",
            "panel": "Inflammation",
            "analyte_name": "CRP",
            "result_text": "< 0.5",
            "numeric_result": 0.5,
            "comparator": "<",
            "unit": "mg/L",
            "reference_text": "< 5",
            "reference_high": 5.0,
            "abnormal_flag": "unknown"
        }),
    ] {
        let (status, body) = json_request(
            &app,
            "POST",
            &format!("/api/v1/patients/{patient_id}/lab-results"),
            &ceo_bearer,
            Some(payload),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{body}");
    }

    let (status, labs) = json_request(
        &app,
        "GET",
        &format!("/api/v1/patients/{patient_id}/lab-results"),
        &ceo_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{labs}");
    assert_eq!(labs["count"], 3);
    let lab_items = labs["items"].as_array().expect("lab result array");
    assert_eq!(lab_items[0]["measured_at"], "2026-04-14T00:00:00+00:00");
    assert_eq!(
        lab_items
            .iter()
            .filter(|row| row["analyte_name"] == "Leukocytes")
            .count(),
        2
    );
    assert!(lab_items.iter().any(|row| row["unit"] == "cells/µL"));
    assert!(lab_items.iter().any(|row| row["source_country"] == "US"));
    assert!(lab_items.iter().any(|row| row["analyte_name"] == "CRP"));

    let (status, timeline) = json_request(
        &app,
        "GET",
        &format!("/api/v1/patients/{patient_id}/timeline?entity_type=vital"),
        &ceo_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{timeline:?}");
    let timeline_items = timeline["items"].as_array().expect("vital timeline items");
    assert_eq!(timeline_items.len(), 2);
    let latest_title = timeline_items[0]["title"]
        .as_str()
        .expect("latest vital timeline title");
    assert!(latest_title.contains("72 kg"), "{latest_title}");
    assert!(latest_title.contains("175 cm"), "{latest_title}");
}

#[tokio::test]
async fn billing_cannot_access_patient_vitals_routes() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("patient-vitals-deny");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let billing_id = seed_user(&pool, &format!("{tag}-billing"), "billing").await;
    let billing_bearer = auth_header_for(billing_id, "billing");

    let (status, _) = json_request(
        &app,
        "GET",
        &format!("/api/v1/patients/{patient_id}/vitals"),
        &billing_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/patients/{patient_id}/vitals"),
        &billing_bearer,
        Some(json!({
            "measured_at": "2026-04-14T09:45:00Z",
            "heart_rate": 70,
        })),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn patient_card_entries_round_trip_and_appear_in_timeline() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("patient-card-entry");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let ceo_id = seed_user(&pool, &format!("{tag}-ceo"), "ceo").await;
    seed_patient_assignment(&pool, patient_id, ceo_id, admin_id).await;
    let ceo_bearer = auth_header_for(ceo_id, "ceo");

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/patients/{patient_id}/card-entries"),
        &ceo_bearer,
        Some(json!({
            "entry_date": "2026-04-14T11:30:00Z",
            "category": "medical_update",
            "source": "Clinic intake call",
            "content": "Patient reports increased dizziness after morning medication adjustment.",
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/patients/{patient_id}/card-entries"),
        &ceo_bearer,
        Some(json!({
            "entry_date": "2026-04-13T16:10:00Z",
            "category": "followup_note",
            "source": "Patient",
            "content": "Symptoms improved by the evening after hydration.",
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/patients/{patient_id}/card-entries"),
        &ceo_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["count"], 2);
    let items = body["items"].as_array().expect("card entries array");
    assert_eq!(items.len(), 2);
    assert_eq!(items[0]["category"], "medical_update");
    assert_eq!(items[0]["source"], "Clinic intake call");
    assert_eq!(
        items[0]["content"],
        "Patient reports increased dizziness after morning medication adjustment."
    );
    assert_eq!(items[1]["category"], "followup_note");

    let (status, timeline) = json_request(
        &app,
        "GET",
        &format!("/api/v1/patients/{patient_id}/timeline?entity_type=card_entry"),
        &ceo_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let timeline_items = timeline["items"].as_array().expect("timeline items");
    assert_eq!(timeline_items.len(), 2);
    assert_eq!(timeline_items[0]["entity_type"], "card_entry");
    assert_eq!(timeline_items[0]["category"], "medical_update");
    assert_eq!(timeline_items[0]["status"], "logged");
    let source_label = timeline_items[0]["source_label"]
        .as_str()
        .expect("source label");
    assert!(source_label.contains("Clinic intake call"));
    assert!(source_label.contains(&format!("ceo {tag}-ceo")));
}

#[tokio::test]
async fn billing_cannot_access_patient_card_entries_routes() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("patient-card-entry-deny");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let billing_id = seed_user(&pool, &format!("{tag}-billing"), "billing").await;
    let billing_bearer = auth_header_for(billing_id, "billing");

    let (status, _) = json_request(
        &app,
        "GET",
        &format!("/api/v1/patients/{patient_id}/card-entries"),
        &billing_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/patients/{patient_id}/card-entries"),
        &billing_bearer,
        Some(json!({
            "entry_date": "2026-04-14T11:30:00Z",
            "category": "warning",
            "content": "Finance role should not create clinical entries.",
        })),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn patient_medical_orders_round_trip_status_update_and_timeline() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("patient-medical-order");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let ceo_id = seed_user(&pool, &format!("{tag}-ceo"), "ceo").await;
    seed_patient_assignment(&pool, patient_id, ceo_id, admin_id).await;
    let ceo_bearer = auth_header_for(ceo_id, "ceo");

    let (status, create_body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/patients/{patient_id}/medical-orders"),
        &ceo_bearer,
        Some(json!({
            "order_date": "2026-04-14T12:00:00Z",
            "order_type": "physiotherapy",
            "title": "Physiotherapy 2x weekly",
            "instructions": "Start with lumbar stabilization and gait assessment for six weeks.",
            "due_date": "2026-05-26",
            "source": "Discharge note",
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let medical_order_id = create_body["id"].as_str().expect("medical order id");

    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/patients/{patient_id}/medical-orders"),
        &ceo_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["count"], 1);
    let items = body["items"].as_array().expect("medical orders array");
    assert_eq!(items[0]["order_type"], "physiotherapy");
    assert_eq!(items[0]["status"], "active");
    assert_eq!(items[0]["due_date"], "2026-05-26");
    assert_eq!(items[0]["source"], "Discharge note");

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/patients/{patient_id}/medical-orders/{medical_order_id}/update"),
        &ceo_bearer,
        Some(json!({
            "status": "completed",
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/patients/{patient_id}/medical-orders"),
        &ceo_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let items = body["items"].as_array().expect("medical orders array");
    assert_eq!(items[0]["status"], "completed");

    let (status, timeline) = json_request(
        &app,
        "GET",
        &format!("/api/v1/patients/{patient_id}/timeline?entity_type=medical_order"),
        &ceo_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let timeline_items = timeline["items"].as_array().expect("timeline items");
    assert_eq!(timeline_items.len(), 1);
    assert_eq!(timeline_items[0]["entity_type"], "medical_order");
    assert_eq!(timeline_items[0]["category"], "physiotherapy");
    assert_eq!(timeline_items[0]["status"], "completed");
    assert_eq!(timeline_items[0]["title"], "Physiotherapy 2x weekly");
}

#[tokio::test]
async fn billing_cannot_access_patient_medical_orders_routes() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("patient-medical-order-deny");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let billing_id = seed_user(&pool, &format!("{tag}-billing"), "billing").await;
    let billing_bearer = auth_header_for(billing_id, "billing");

    let (status, _) = json_request(
        &app,
        "GET",
        &format!("/api/v1/patients/{patient_id}/medical-orders"),
        &billing_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/patients/{patient_id}/medical-orders"),
        &billing_bearer,
        Some(json!({
            "order_date": "2026-04-14T12:00:00Z",
            "order_type": "other",
            "title": "Forbidden finance mutation",
            "instructions": "Should not be allowed.",
        })),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn patient_risk_scores_round_trip_and_timeline() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("patient-risk-score");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let ceo_id = seed_user(&pool, &format!("{tag}-ceo"), "ceo").await;
    seed_patient_assignment(&pool, patient_id, ceo_id, admin_id).await;
    let ceo_bearer = auth_header_for(ceo_id, "ceo");

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/patients/{patient_id}/risk-scores"),
        &ceo_bearer,
        Some(json!({
            "computed_at": "2026-04-14T14:15:00Z",
            "score_type": "cha2ds2_vasc",
            "score_value": 4.0,
            "scale_max": 9.0,
            "interpretation": "Moderate-to-high stroke risk. Anticoagulation review required.",
            "source": "Cardiology review",
            "inputs": {
                "age_65_74": true,
                "hypertension": true,
                "diabetes": false,
                "prior_stroke_tia": true
            }
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/patients/{patient_id}/risk-scores"),
        &ceo_bearer,
        Some(json!({
            "computed_at": "2026-04-13T09:00:00Z",
            "score_type": "fall_risk",
            "score_value": 2.0,
            "scale_max": 5.0,
            "interpretation": "Needs escort support during transfers.",
            "source": "Nursing intake"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/patients/{patient_id}/risk-scores"),
        &ceo_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["count"], 2);
    let items = body["items"].as_array().expect("risk scores array");
    assert_eq!(items[0]["score_type"], "cha2ds2_vasc");
    assert_eq!(items[0]["score_value"], 4.0);
    assert_eq!(items[0]["scale_max"], 9.0);
    assert_eq!(items[0]["source"], "Cardiology review");
    assert_eq!(items[0]["inputs"]["hypertension"], true);
    assert_eq!(items[1]["score_type"], "fall_risk");

    let (status, timeline) = json_request(
        &app,
        "GET",
        &format!("/api/v1/patients/{patient_id}/timeline?entity_type=risk_score"),
        &ceo_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let timeline_items = timeline["items"].as_array().expect("timeline items");
    assert_eq!(timeline_items.len(), 2);
    assert_eq!(timeline_items[0]["entity_type"], "risk_score");
    assert_eq!(timeline_items[0]["category"], "cha2ds2_vasc");
    assert_eq!(timeline_items[0]["status"], "recorded");
    let source_label = timeline_items[0]["source_label"]
        .as_str()
        .expect("source label");
    assert!(source_label.contains("Cardiology review"));
    assert!(source_label.contains(&format!("ceo {tag}-ceo")));
}

#[tokio::test]
async fn billing_cannot_access_patient_risk_scores_routes() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("patient-risk-score-deny");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let billing_id = seed_user(&pool, &format!("{tag}-billing"), "billing").await;
    let billing_bearer = auth_header_for(billing_id, "billing");

    let (status, _) = json_request(
        &app,
        "GET",
        &format!("/api/v1/patients/{patient_id}/risk-scores"),
        &billing_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/patients/{patient_id}/risk-scores"),
        &billing_bearer,
        Some(json!({
            "computed_at": "2026-04-14T14:15:00Z",
            "score_type": "other",
            "score_value": 1.0
        })),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

async fn seed_provider(pool: &PgPool, tag: &str) -> Uuid {
    seed_provider_with_type(pool, tag, "medical").await
}

async fn seed_provider_with_type(pool: &PgPool, tag: &str, provider_type: &str) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO providers (name, provider_type)
           VALUES ($1, $2)
           RETURNING id"#,
    )
    .bind(format!("Provider {tag}"))
    .bind(provider_type)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn seed_provider_doctor(pool: &PgPool, provider_id: Uuid, tag: &str) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO provider_doctors (provider_id, name, title)
           VALUES ($1, $2, 'Dr. med.')
           RETURNING id"#,
    )
    .bind(provider_id)
    .bind(format!("Doctor {tag}"))
    .fetch_one(pool)
    .await
    .unwrap()
}

#[tokio::test]
async fn all_doctors_list_excludes_non_medical_contact_people() {
    let Some((app, pool, _admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("clinical-doctors-medical-only");
    let medical_provider_id = seed_provider(&pool, &format!("{tag}-clinic")).await;
    let medical_doctor_id =
        seed_provider_doctor(&pool, medical_provider_id, &format!("{tag}-clinic")).await;
    let non_medical_provider_id =
        seed_provider_with_type(&pool, &format!("{tag}-restaurant"), "non_medical").await;
    let non_medical_contact_id =
        seed_provider_doctor(&pool, non_medical_provider_id, &format!("{tag}-restaurant")).await;
    let ceo_id = seed_user(&pool, &format!("{tag}-ceo"), "ceo").await;
    let ceo_bearer = auth_header_for(ceo_id, "ceo");

    let (status, body) = json_request(&app, "GET", "/api/v1/doctors", &ceo_bearer, None).await;
    assert_eq!(status, StatusCode::OK);

    let rows = body.as_array().expect("doctors array");
    assert!(
        rows.iter()
            .any(|row| row["id"] == medical_doctor_id.to_string()),
        "medical provider doctor must be available for clinical attribution"
    );
    assert!(
        !rows
            .iter()
            .any(|row| row["id"] == non_medical_contact_id.to_string()),
        "non-medical provider contacts must not be available for clinical attribution"
    );
}

#[tokio::test]
async fn patient_clinical_master_round_trip_with_provider_doctor() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("patient-clinical");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let ceo_id = seed_user(&pool, &format!("{tag}-ceo"), "ceo").await;
    seed_patient_assignment(&pool, patient_id, ceo_id, admin_id).await;
    let ceo_bearer = auth_header_for(ceo_id, "ceo");

    let provider_id = seed_provider(&pool, &tag).await;
    let doctor_id = seed_provider_doctor(&pool, provider_id, &tag).await;
    let diagnosis_specializations = sqlx::query_as::<_, (Uuid, String)>(
        "SELECT id, code FROM medical_specializations
         WHERE deleted_at IS NULL AND is_active = TRUE
         ORDER BY sort_order, code
         LIMIT 2",
    )
    .fetch_all(&pool)
    .await
    .expect("load diagnosis specializations");
    assert_eq!(diagnosis_specializations.len(), 2);
    let diagnosis_specialization_ids = diagnosis_specializations
        .iter()
        .map(|(id, _)| id.to_string())
        .collect::<Vec<_>>();

    // ---- Diagnoses (main with ICD + provider/doctor, plus a secondary) ----
    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/patients/{patient_id}/diagnoses"),
        &ceo_bearer,
        Some(json!({
            "items": [
                {
                    "kind": "main",
                    "label": "Ambulant erworbene Pneumonie",
                    "icd_code": "J15.9",
                    "status": "active",
                    "diagnosed_on": "ED 03/2017",
                    "provider_id": provider_id.to_string(),
                    "doctor_id": doctor_id.to_string(),
                    "specialization_ids": diagnosis_specialization_ids,
                    "red_flags": "Dyspnoe in Ruhe",
                },
                {
                    "kind": "secondary",
                    "label": "Arterielle Hypertonie",
                    "icd_code": "I10.0",
                    "grade": "Grad 1",
                    "status": "chronic",
                },
            ],
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    // ---- Medications (Medikationsplan) ----
    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/patients/{patient_id}/medications"),
        &ceo_bearer,
        Some(json!({
            "items": [
                {
                    "category": "dauer",
                    "handelsname": "Bisoprolol-ratiopharm",
                    "wirkstoff": "Bisoprolol",
                    "staerke": "5 mg",
                    "form": "Filmtabl.",
                    "dose_morgens": "1",
                    "dose_mittags": "0",
                    "dose_abends": "1",
                    "dose_nachts": "0",
                    "einheit": "Stück",
                    "grund": "Bluthochdruck",
                    "on_hold": true,
                    "hold_until": "2026-07-15",
                    "hold_note": "Patient pausiert wegen Nebenwirkungen",
                    "provider_id": provider_id.to_string(),
                    "doctor_id": doctor_id.to_string(),
                },
            ],
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    // ---- Examinations / Befunde ----
    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/patients/{patient_id}/examinations"),
        &ceo_bearer,
        Some(json!({
            "items": [
                {
                    "kind": "radiology",
                    "title": "Röntgen-Thorax",
                    "performed_on": "01.03.2017",
                    "status": "pending",
                    "result": "Befund ausstehend",
                    "provider_id": provider_id.to_string(),
                    "specialization_ids": diagnosis_specialization_ids,
                    "red_flags": "Akute Entsättigung",
                },
            ],
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    // ---- GET aggregated clinical profile ----
    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/patients/{patient_id}/clinical"),
        &ceo_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let diagnoses = body["diagnoses"].as_array().expect("diagnoses array");
    assert_eq!(diagnoses.len(), 2);
    assert_eq!(diagnoses[0]["kind"], "main");
    assert_eq!(diagnoses[0]["label"], "Ambulant erworbene Pneumonie");
    assert_eq!(diagnoses[0]["icd_code"], "J15.9");
    assert_eq!(diagnoses[0]["provider_id"], provider_id.to_string());
    assert_eq!(diagnoses[0]["provider_name"], format!("Provider {tag}"));
    assert_eq!(diagnoses[0]["doctor_name"], format!("Doctor {tag}"));
    assert_eq!(diagnoses[0]["red_flags"], "Dyspnoe in Ruhe");
    assert_eq!(
        diagnoses[0]["specialization_ids"],
        json!(diagnosis_specialization_ids)
    );
    assert_eq!(
        diagnoses[0]["specializations"][0]["code"],
        diagnosis_specializations[0].1
    );
    assert_eq!(
        diagnoses[0]["specializations"][1]["code"],
        diagnosis_specializations[1].1
    );
    assert_eq!(diagnoses[1]["kind"], "secondary");
    assert_eq!(diagnoses[1]["grade"], "Grad 1");

    let medications = body["medications"].as_array().expect("medications array");
    assert_eq!(medications.len(), 1);
    assert_eq!(medications[0]["handelsname"], "Bisoprolol-ratiopharm");
    assert_eq!(medications[0]["category"], "dauer");
    assert_eq!(medications[0]["dose_morgens"], "1");
    assert_eq!(medications[0]["dose_abends"], "1");
    assert_eq!(medications[0]["einheit"], "Stück");
    assert_eq!(medications[0]["on_hold"], true);
    assert_eq!(medications[0]["hold_until"], "2026-07-15");
    assert_eq!(
        medications[0]["hold_note"],
        "Patient pausiert wegen Nebenwirkungen"
    );
    assert_eq!(medications[0]["doctor_name"], format!("Doctor {tag}"));

    let examinations = body["examinations"].as_array().expect("examinations array");
    assert_eq!(examinations.len(), 1);
    assert_eq!(examinations[0]["title"], "Röntgen-Thorax");
    assert_eq!(examinations[0]["status"], "pending");
    assert_eq!(examinations[0]["kind"], "radiology");
    assert_eq!(examinations[0]["provider_name"], format!("Provider {tag}"));
    assert_eq!(
        examinations[0]["specialization_ids"],
        json!(diagnosis_specialization_ids)
    );
    assert_eq!(
        examinations[0]["specializations"][0]["code"],
        diagnosis_specializations[0].1
    );
    assert_eq!(examinations[0]["red_flags"], "Akute Entsättigung");

    // ---- Replace-all clears the diagnoses section without touching the others ----
    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/patients/{patient_id}/diagnoses"),
        &ceo_bearer,
        Some(json!({ "items": [] })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/patients/{patient_id}/clinical"),
        &ceo_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["diagnoses"].as_array().expect("diagnoses").len(), 0);
    assert_eq!(
        body["medications"].as_array().expect("medications").len(),
        1
    );
    assert_eq!(
        body["examinations"].as_array().expect("examinations").len(),
        1
    );
}

#[tokio::test]
async fn clinical_edits_preserve_ocr_document_provenance() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };
    let tag = unique_tag("clinical-provenance-edit");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let ceo_id = seed_user(&pool, &format!("{tag}-ceo"), "ceo").await;
    seed_patient_assignment(&pool, patient_id, ceo_id, admin_id).await;
    let bearer = auth_header_for(ceo_id, "ceo");

    let document_id = Uuid::new_v4();
    let document_name = format!("arztbrief-{tag}.pdf");
    sqlx::query(
        r#"INSERT INTO documents (
                id, patient_id, auto_name, original_filename, art, category,
                status, visibility, is_medical, mime_type, file_size,
                version_root_document_id, version_number, uploaded_by
           ) VALUES (
                $1, $2, $3, $3, 'medical_report', 'report',
                'active', 'internal', true, 'application/pdf', 128,
                $1, 1, $4
           )"#,
    )
    .bind(document_id)
    .bind(patient_id)
    .bind(&document_name)
    .bind(ceo_id)
    .execute(&pool)
    .await
    .expect("seed source document");

    let diagnosis_id = sqlx::query_scalar::<_, Uuid>(
        r#"INSERT INTO patient_diagnoses (patient_id, kind, label, source_document_id)
           VALUES ($1, 'main', 'OCR diagnosis', $2)
           RETURNING id"#,
    )
    .bind(patient_id)
    .bind(document_id)
    .fetch_one(&pool)
    .await
    .expect("seed imported diagnosis");
    let examination_id = sqlx::query_scalar::<_, Uuid>(
        r#"INSERT INTO patient_examinations (patient_id, kind, title, source_document_id)
           VALUES ($1, 'lab', 'OCR examination', $2)
           RETURNING id"#,
    )
    .bind(patient_id)
    .bind(document_id)
    .fetch_one(&pool)
    .await
    .expect("seed imported examination");
    let verlauf_id = sqlx::query_scalar::<_, Uuid>(
        r#"INSERT INTO patient_clinical_verlauf (patient_id, occurred_on, note, source_document_id, source_page)
           VALUES ($1, '2026-08-14', 'OCR course entry', $2, 2)
           RETURNING id"#,
    )
    .bind(patient_id)
    .bind(document_id)
    .fetch_one(&pool)
    .await
    .expect("seed imported Verlauf entry");

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/patients/{patient_id}/diagnoses"),
        &bearer,
        Some(json!({
            "items": [{
                "id": diagnosis_id.to_string(),
                "kind": "main",
                "label": "Edited diagnosis",
                "status": "active"
            }]
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body:?}");

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/patients/{patient_id}/verlauf"),
        &bearer,
        Some(json!({
            "items": [{
                "id": verlauf_id.to_string(),
                "occurred_on": "2026-08-14",
                "note": "Edited course entry"
            }]
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body:?}");

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/patients/{patient_id}/examinations"),
        &bearer,
        Some(json!({
            "items": [{
                "id": examination_id.to_string(),
                "kind": "lab",
                "title": "Edited examination",
                "status": "final"
            }]
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body:?}");

    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/patients/{patient_id}/clinical"),
        &bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body:?}");

    for section in ["diagnoses", "examinations", "verlauf"] {
        let item = &body[section][0];
        assert_eq!(item["source_document_id"], document_id.to_string());
        assert_eq!(item["source_document_name"], document_name);
    }
    assert_eq!(body["verlauf"][0]["source_page"], 2);
}

#[tokio::test]
async fn patient_clinical_merge_preserves_rows_omitted_by_returning_patient_intake() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };
    let tag = unique_tag("patient-clinical-merge");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let ceo_id = seed_user(&pool, &format!("{tag}-ceo"), "ceo").await;
    seed_patient_assignment(&pool, patient_id, ceo_id, admin_id).await;
    let bearer = auth_header_for(ceo_id, "ceo");

    for (path, body) in [
        (
            "diagnoses",
            json!({ "items": [{ "kind": "main", "label": "Existing diagnosis" }] }),
        ),
        (
            "medications",
            json!({ "items": [{
                "category": "dauer",
                "wirkstoff": "Existing ingredient",
                "handelsname": "Existing medication"
            }] }),
        ),
        (
            "clinical-warnings",
            json!({ "kind": "allergie", "items": [{ "label": "Existing allergy" }] }),
        ),
    ] {
        let (status, payload) = json_request(
            &app,
            "POST",
            &format!("/api/v1/patients/{patient_id}/{path}"),
            &bearer,
            Some(body),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{path}: {payload:?}");
    }

    for (path, body) in [
        (
            "diagnoses",
            json!({ "items": [{ "kind": "secondary", "label": "Intake diagnosis" }] }),
        ),
        (
            "medications",
            json!({ "items": [{
                "category": "dauer",
                "wirkstoff": "Intake ingredient",
                "handelsname": "Intake medication"
            }] }),
        ),
        (
            "clinical-warnings",
            json!({ "kind": "allergie", "items": [{ "label": "Intake allergy" }] }),
        ),
    ] {
        let (status, payload) = json_request(
            &app,
            "POST",
            &format!("/api/v1/patients/{patient_id}/{path}?mode=merge"),
            &bearer,
            Some(body),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{path}: {payload:?}");
    }

    let (status, clinical) = json_request(
        &app,
        "GET",
        &format!("/api/v1/patients/{patient_id}/clinical"),
        &bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{clinical:?}");
    assert_eq!(clinical["diagnoses"].as_array().unwrap().len(), 2);
    assert_eq!(clinical["medications"].as_array().unwrap().len(), 2);
    assert_eq!(clinical["allergien"].as_array().unwrap().len(), 2);
    assert!(
        clinical["diagnoses"]
            .as_array()
            .unwrap()
            .iter()
            .any(|row| { row["label"] == "Existing diagnosis" })
    );
    assert!(
        clinical["medications"]
            .as_array()
            .unwrap()
            .iter()
            .any(|row| { row["wirkstoff"] == "Existing ingredient" })
    );
    assert!(
        clinical["allergien"]
            .as_array()
            .unwrap()
            .iter()
            .any(|row| { row["label"] == "Existing allergy" })
    );

    let (status, timeline) = json_request(
        &app,
        "GET",
        &format!("/api/v1/patients/{patient_id}/timeline?entity_type=assignment"),
        &bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{timeline:?}");
    assert!(
        timeline["items"]
            .as_array()
            .unwrap()
            .iter()
            .any(|row| { row["entity_type"] == "assignment" && row["status"] == "active" })
    );
}

#[tokio::test]
async fn patient_clinical_rejects_invalid_provider_doctor_attribution() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("patient-clinical-attr");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let ceo_id = seed_user(&pool, &format!("{tag}-ceo"), "ceo").await;
    seed_patient_assignment(&pool, patient_id, ceo_id, admin_id).await;
    let ceo_bearer = auth_header_for(ceo_id, "ceo");

    let provider_id = seed_provider(&pool, &tag).await;
    let other_provider_id = seed_provider(&pool, &format!("{tag}-other")).await;
    // Doctor that belongs to `other_provider_id`, not `provider_id`.
    let foreign_doctor_id = seed_provider_doctor(&pool, other_provider_id, &tag).await;

    let post_diagnosis = |attribution: serde_json::Value| {
        let app = app.clone();
        let bearer = ceo_bearer.clone();
        async move {
            let mut item = json!({ "kind": "main", "label": "Test" });
            item.as_object_mut()
                .unwrap()
                .extend(attribution.as_object().unwrap().clone());
            json_request(
                &app,
                "POST",
                &format!("/api/v1/patients/{patient_id}/diagnoses"),
                &bearer,
                Some(json!({ "items": [item] })),
            )
            .await
            .0
        }
    };

    // Unknown provider id (well-formed UUID, no matching row) -> 422.
    let status = post_diagnosis(json!({ "provider_id": Uuid::new_v4().to_string() })).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);

    // Unknown doctor id -> 422.
    let status = post_diagnosis(json!({ "doctor_id": Uuid::new_v4().to_string() })).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);

    // Doctor that belongs to a different provider -> 422.
    let status = post_diagnosis(json!({
        "provider_id": provider_id.to_string(),
        "doctor_id": foreign_doctor_id.to_string(),
    }))
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);

    // Malformed (non-empty, non-UUID) id -> 422 rather than a silent NULL.
    let status = post_diagnosis(json!({ "provider_id": "not-a-uuid" })).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);

    // Nothing was persisted by any of the rejected saves.
    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/patients/{patient_id}/clinical"),
        &ceo_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["diagnoses"].as_array().expect("diagnoses").len(), 0);
}

#[tokio::test]
async fn patient_medications_reject_non_medical_provider_attribution() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("patient-med-non-med-provider");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let ceo_id = seed_user(&pool, &format!("{tag}-ceo"), "ceo").await;
    seed_patient_assignment(&pool, patient_id, ceo_id, admin_id).await;
    let ceo_bearer = auth_header_for(ceo_id, "ceo");

    let non_medical_provider_id =
        seed_provider_with_type(&pool, &format!("{tag}-travel"), "non_medical").await;
    let non_medical_doctor_id =
        seed_provider_doctor(&pool, non_medical_provider_id, &format!("{tag}-guide")).await;

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/patients/{patient_id}/medications"),
        &ceo_bearer,
        Some(json!({
            "items": [
                {
                    "category": "dauer",
                    "handelsname": "Ibuprofen",
                    "wirkstoff": "Ibuprofen",
                    "provider_id": non_medical_provider_id.to_string(),
                },
            ],
        })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/patients/{patient_id}/medications"),
        &ceo_bearer,
        Some(json!({
            "items": [
                {
                    "category": "dauer",
                    "handelsname": "Paracetamol",
                    "wirkstoff": "Paracetamol",
                    "doctor_id": non_medical_doctor_id.to_string(),
                },
            ],
        })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);

    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/patients/{patient_id}/clinical"),
        &ceo_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        body["medications"].as_array().expect("medications").len(),
        0
    );
}

#[tokio::test]
async fn billing_cannot_access_patient_clinical_routes() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("patient-clinical-billing");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let billing_id = seed_user(&pool, &format!("{tag}-billing"), "billing").await;
    let billing_bearer = auth_header_for(billing_id, "billing");

    let (status, _) = json_request(
        &app,
        "GET",
        &format!("/api/v1/patients/{patient_id}/clinical"),
        &billing_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/patients/{patient_id}/diagnoses"),
        &billing_bearer,
        Some(json!({ "items": [] })),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn patient_clinical_narrative_upserts() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("patient-narrative");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let ceo_id = seed_user(&pool, &format!("{tag}-ceo"), "ceo").await;
    seed_patient_assignment(&pool, patient_id, ceo_id, admin_id).await;
    let ceo_bearer = auth_header_for(ceo_id, "ceo");
    let narrative_specializations = sqlx::query_as::<_, (Uuid, String)>(
        "SELECT id, code FROM medical_specializations
         WHERE deleted_at IS NULL AND is_active = TRUE
         ORDER BY sort_order, code
         LIMIT 2",
    )
    .fetch_all(&pool)
    .await
    .expect("load narrative specializations");
    assert_eq!(narrative_specializations.len(), 2);
    let narrative_specialization_ids = narrative_specializations
        .iter()
        .map(|(id, _)| id.to_string())
        .collect::<Vec<_>>();

    // Before any save the narrative is absent.
    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/patients/{patient_id}/clinical"),
        &ceo_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(body["narrative"].is_null());
    assert!(
        body["verlauf"]
            .as_array()
            .is_some_and(|items| items.is_empty())
    );

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/patients/{patient_id}/narrative"),
        &ceo_bearer,
        Some(json!({
            "anamnese_aktuelle": "Fieber und Husten seit zwei Tagen.",
            "anamnese_sozial": "Lebt allein, mobil mit Gehstock.",
            "beurteilung": "Verdacht auf ambulant erworbene Pneumonie.",
            "red_flags": "Nächtliche Dyspnoe",
            "specializations": [
                {
                    "specialization_id": narrative_specialization_ids[0],
                    "narrative_text": "Belastungsdyspnoe seit drei Tagen.",
                    "assessment_text": "Zeitnahe kardiologische Abklärung."
                },
                {
                    "specialization_id": narrative_specialization_ids[1],
                    "narrative_text": "Persistierender produktiver Husten.",
                    "assessment_text": "Pulmonologische Verlaufskontrolle."
                }
            ],
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/patients/{patient_id}/clinical"),
        &ceo_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        body["narrative"]["anamnese_aktuelle"],
        "Fieber und Husten seit zwei Tagen."
    );
    assert_eq!(
        body["narrative"]["anamnese_sozial"],
        "Lebt allein, mobil mit Gehstock."
    );
    assert_eq!(
        body["narrative"]["beurteilung"],
        "Verdacht auf ambulant erworbene Pneumonie."
    );
    assert_eq!(body["narrative"]["red_flags"], "Nächtliche Dyspnoe");
    assert_eq!(
        body["narrative"]["specialization_ids"],
        json!(narrative_specialization_ids)
    );
    assert_eq!(
        body["narrative"]["specializations"][1]["code"],
        narrative_specializations[1].1
    );
    assert_eq!(
        body["narrative"]["specializations"][0]["narrative_text"],
        "Belastungsdyspnoe seit drei Tagen."
    );
    assert_eq!(
        body["narrative"]["specializations"][0]["assessment_text"],
        "Zeitnahe kardiologische Abklärung."
    );
    assert!(
        !body["narrative"]
            .as_object()
            .expect("narrative object")
            .contains_key("verlauf")
    );

    // Second narrative save creates a new Anamnese version; Verlauf is a
    // separate dated entity and is no longer accepted as an Anamnese field.
    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/patients/{patient_id}/narrative"),
        &ceo_bearer,
        Some(json!({
            "anamnese_aktuelle": "Beschwerden gebessert.",
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/patients/{patient_id}/clinical"),
        &ceo_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        body["narrative"]["anamnese_aktuelle"],
        "Beschwerden gebessert."
    );
    assert!(
        !body["narrative"]
            .as_object()
            .expect("narrative object")
            .contains_key("verlauf")
    );
    // Fields omitted from the second payload are cleared by the upsert.
    assert!(body["narrative"]["beurteilung"].is_null());

    let provider_id = seed_provider(&pool, &tag).await;
    let doctor_id = seed_provider_doctor(&pool, provider_id, &format!("{tag}-verlauf")).await;
    sqlx::query("UPDATE provider_doctors SET fachbereich = $1 WHERE id = $2")
        .bind("Orthopaedie und Unfallchirurgie")
        .bind(doctor_id)
        .execute(&pool)
        .await
        .unwrap();
    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/patients/{patient_id}/verlauf"),
        &ceo_bearer,
        Some(json!({
            "items": [{
                "occurred_on": "2026-06-24",
                "provider_id": provider_id,
                "doctor_id": doctor_id,
                "note": "Komplikationsloser Verlauf."
            }]
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/patients/{patient_id}/clinical"),
        &ceo_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["verlauf"][0]["occurred_on"], "2026-06-24");
    let provider_id_text = provider_id.to_string();
    assert_eq!(
        body["verlauf"][0]["provider_id"].as_str(),
        Some(provider_id_text.as_str())
    );
    let doctor_id_text = doctor_id.to_string();
    assert_eq!(
        body["verlauf"][0]["doctor_id"].as_str(),
        Some(doctor_id_text.as_str())
    );
    let expected_doctor_name = format!("Doctor {tag}-verlauf");
    assert_eq!(
        body["verlauf"][0]["doctor_name"].as_str(),
        Some(expected_doctor_name.as_str())
    );
    assert_eq!(
        body["verlauf"][0]["doctor_title"].as_str(),
        Some("Dr. med.")
    );
    assert_eq!(
        body["verlauf"][0]["doctor_fachbereich"].as_str(),
        Some("Orthopaedie und Unfallchirurgie")
    );
    assert_eq!(body["verlauf"][0]["note"], "Komplikationsloser Verlauf.");

    let count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM patient_clinical_narrative WHERE patient_id = $1")
            .bind(patient_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    // Anamnese is now versioned: the second save keeps the old (inactive) row
    // and adds a new active one, so two rows remain (not one upsert).
    assert_eq!(count, 2);

    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/patients/{patient_id}/narrative/history"),
        &ceo_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let versions = body.as_array().expect("narrative history array");
    assert_eq!(versions.len(), 2);
    let historical = versions
        .iter()
        .find(|version| version["anamnese_aktuelle"] == "Fieber und Husten seit zwei Tagen.")
        .expect("historical narrative");
    assert_eq!(historical["red_flags"], "Nächtliche Dyspnoe");
    assert_eq!(
        historical["specialization_ids"],
        json!(narrative_specialization_ids)
    );
    assert_eq!(
        historical["specializations"][1]["narrative_text"],
        "Persistierender produktiver Husten."
    );
    assert_eq!(
        historical["specializations"][1]["assessment_text"],
        "Pulmonologische Verlaufskontrolle."
    );
    let active_id = versions
        .iter()
        .find(|version| version["is_active"].as_bool() == Some(true))
        .and_then(|version| version["id"].as_str())
        .expect("active narrative id")
        .to_string();
    let inactive_id = versions
        .iter()
        .find(|version| version["is_active"].as_bool() == Some(false))
        .and_then(|version| version["id"].as_str())
        .expect("inactive narrative id")
        .to_string();

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/patients/{patient_id}/narrative/{active_id}/delete"),
        &ceo_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["id"].as_str(), Some(inactive_id.as_str()));
    assert_eq!(body["is_active"], true);
    assert_eq!(
        body["anamnese_aktuelle"],
        "Fieber und Husten seit zwei Tagen."
    );
    assert_eq!(body["red_flags"], "Nächtliche Dyspnoe");
    assert_eq!(
        body["specialization_ids"],
        json!(narrative_specialization_ids)
    );

    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/patients/{patient_id}/clinical"),
        &ceo_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["narrative"]["id"].as_str(), Some(inactive_id.as_str()));
    assert_eq!(body["narrative"]["is_active"], true);

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/patients/{patient_id}/narrative/{inactive_id}/delete"),
        &ceo_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(body.is_null());

    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/patients/{patient_id}/clinical"),
        &ceo_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(body["narrative"].is_null());
}

#[tokio::test]
async fn patient_procedures_round_trip_with_ops_code() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("patient-procedures");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let ceo_id = seed_user(&pool, &format!("{tag}-ceo"), "ceo").await;
    seed_patient_assignment(&pool, patient_id, ceo_id, admin_id).await;
    let ceo_bearer = auth_header_for(ceo_id, "ceo");

    let provider_id = seed_provider(&pool, &tag).await;
    let doctor_id = seed_provider_doctor(&pool, provider_id, &tag).await;

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/patients/{patient_id}/procedures"),
        &ceo_bearer,
        Some(json!({
            "items": [
                {
                    "label": "Appendektomie, laparoskopisch",
                    "ops_code": "5-470.10",
                    "performed_on": "31.07.2016",
                    "provider_id": provider_id.to_string(),
                    "doctor_id": doctor_id.to_string(),
                },
            ],
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/patients/{patient_id}/clinical"),
        &ceo_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let procedures = body["procedures"].as_array().expect("procedures array");
    assert_eq!(procedures.len(), 1);
    assert_eq!(procedures[0]["label"], "Appendektomie, laparoskopisch");
    assert_eq!(procedures[0]["ops_code"], "5-470.10");
    assert_eq!(procedures[0]["performed_on"], "31.07.2016");
    assert_eq!(procedures[0]["provider_name"], format!("Provider {tag}"));
    assert_eq!(procedures[0]["doctor_name"], format!("Doctor {tag}"));

    // Replace-all clears the section.
    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/patients/{patient_id}/procedures"),
        &ceo_bearer,
        Some(json!({ "items": [] })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/patients/{patient_id}/clinical"),
        &ceo_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["procedures"].as_array().expect("procedures").len(), 0);
}

#[tokio::test]
async fn patient_clinical_pdf_export_returns_pdf() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("patient-clinical-pdf");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let ceo_id = seed_user(&pool, &format!("{tag}-ceo"), "ceo").await;
    seed_patient_assignment(&pool, patient_id, ceo_id, admin_id).await;
    let ceo_bearer = auth_header_for(ceo_id, "ceo");

    // Seed some content so the Arztbrief is non-empty.
    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/patients/{patient_id}/diagnoses"),
        &ceo_bearer,
        Some(json!({ "items": [{ "kind": "main", "label": "Ambulant erworbene Pneumonie", "icd_code": "J15.9" }] })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/patients/{patient_id}/narrative"),
        &ceo_bearer,
        Some(json!({ "beurteilung": "Verdacht auf Pneumonie." })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let request = Request::builder()
        .method("GET")
        .uri(format!("/api/v1/patients/{patient_id}/clinical.pdf"))
        .header("Authorization", &ceo_bearer)
        .body(Body::empty())
        .unwrap();
    let response = app.clone().oneshot(request).await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let content_type = response
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();
    assert_eq!(content_type, "application/pdf");
    let bytes = axum::body::to_bytes(response.into_body(), 4 * 1024 * 1024)
        .await
        .unwrap();
    assert!(bytes.starts_with(b"%PDF"), "expected PDF magic bytes");
    assert!(
        bytes.len() > 500,
        "expected a non-trivial PDF, got {} bytes",
        bytes.len()
    );
}

#[tokio::test]
async fn patient_medikationsplan_pdf_excludes_on_hold_medications() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("patient-medikationsplan-hold");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let ceo_id = seed_user(&pool, &format!("{tag}-ceo"), "ceo").await;
    seed_patient_assignment(&pool, patient_id, ceo_id, admin_id).await;
    let ceo_bearer = auth_header_for(ceo_id, "ceo");

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/patients/{patient_id}/medications"),
        &ceo_bearer,
        Some(json!({
            "items": [
                {
                    "category": "dauer",
                    "handelsname": "Metoprolol Active",
                    "wirkstoff": "Metoprolol",
                    "form": "TABL",
                    "dose_morgens": "1",
                    "einheit": "Stück"
                },
                {
                    "category": "dauer",
                    "handelsname": "Held Medication",
                    "wirkstoff": "Heldstoff",
                    "form": "TABL",
                    "dose_morgens": "1",
                    "einheit": "Stück",
                    "on_hold": true,
                    "hold_until": "2026-07-15",
                    "hold_note": "Patient nimmt es nicht"
                }
            ]
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let request = Request::builder()
        .method("GET")
        .uri(format!("/api/v1/patients/{patient_id}/medikationsplan.pdf"))
        .header("Authorization", &ceo_bearer)
        .body(Body::empty())
        .unwrap();
    let response = app.clone().oneshot(request).await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = axum::body::to_bytes(response.into_body(), 4 * 1024 * 1024)
        .await
        .unwrap();
    assert!(bytes.starts_with(b"%PDF"), "expected PDF magic bytes");

    let pdf_text = pdf_extract::extract_text_from_mem(&bytes).unwrap();
    assert!(pdf_text.contains("Metoprolol Active"));
    assert!(
        !pdf_text.contains("Held Medication"),
        "on-hold medications must not be printed as active intake plan: {pdf_text:?}"
    );
}
