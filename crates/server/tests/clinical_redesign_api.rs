mod support;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use serde_json::{Value, json};
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

/// Seed a patient assigned to a fresh patient_manager and return the pieces a
/// clinical round-trip needs: the patient id and that manager's bearer token.
async fn seed_clinical_patient(
    pool: &PgPool,
    admin_id: Uuid,
    tag: &str,
) -> (Uuid, String) {
    let patient_id = seed_patient(pool, admin_id, tag).await;
    let pm_id = seed_user(pool, &format!("{tag}-pm"), "patient_manager").await;
    seed_patient_assignment(pool, patient_id, pm_id, admin_id).await;
    let pm_bearer = auth_header_for(pm_id, "patient_manager");
    (patient_id, pm_bearer)
}

// ---------------------------------------------------------------------------
// Diagnoses tree (POST /patients/:id/diagnoses { items: [...] } -> GET clinical)
// ---------------------------------------------------------------------------

#[tokio::test]
async fn patient_diagnoses_tree_round_trips_with_nesting_and_certainty() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("diagnoses-tree");
    let (patient_id, pm_bearer) = seed_clinical_patient(&pool, admin_id, &tag).await;

    // A Haupt (main) with a Neben (secondary) child and a Prozedur child.
    // Items are ordered parent-before-child; cid/parent_cid stitch the tree.
    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/patients/{patient_id}/diagnoses"),
        &pm_bearer,
        Some(json!({
            "items": [
                {
                    "cid": "h1",
                    "kind": "main",
                    "label": "Ambulant erworbene Pneumonie",
                    "icd_code": "J15.9",
                    "certainty": "bestaetigt",
                    "chronifizierung": "akut",
                    "diagnosed_on": "ED 03/2017",
                    "source_mode": "intern",
                },
                {
                    "cid": "n1",
                    "parent_cid": "h1",
                    "kind": "secondary",
                    "label": "Arterielle Hypertonie",
                    "icd_code": "I10.0",
                    "certainty": "zustand_nach",
                    "chronifizierung": "chronisch",
                },
                {
                    "cid": "p1",
                    "parent_cid": "h1",
                    "kind": "prozedur",
                    "label": "Bronchoskopie",
                    "ops_code": "1-620.00",
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
        &pm_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let diagnoses = body["diagnoses"].as_array().expect("diagnoses array");
    assert_eq!(diagnoses.len(), 3);

    // Insertion order is preserved (sort_order), so [0] is the Haupt parent.
    let parent = &diagnoses[0];
    assert_eq!(parent["kind"], "main");
    assert_eq!(parent["label"], "Ambulant erworbene Pneumonie");
    assert_eq!(parent["icd_code"], "J15.9");
    assert_eq!(parent["certainty"], "bestaetigt");
    assert_eq!(parent["chronifizierung"], "akut");
    assert!(parent["parent_id"].is_null());
    let parent_id = parent["id"].as_str().expect("parent id");

    let secondary = &diagnoses[1];
    assert_eq!(secondary["kind"], "secondary");
    assert_eq!(secondary["label"], "Arterielle Hypertonie");
    assert_eq!(secondary["certainty"], "zustand_nach");
    assert_eq!(secondary["chronifizierung"], "chronisch");
    assert_eq!(secondary["parent_id"], parent_id);

    let prozedur = &diagnoses[2];
    assert_eq!(prozedur["kind"], "prozedur");
    assert_eq!(prozedur["label"], "Bronchoskopie");
    assert_eq!(prozedur["ops_code"], "1-620.00");
    assert_eq!(prozedur["parent_id"], parent_id);
}

#[tokio::test]
async fn patient_diagnoses_reject_diagnosis_nested_under_procedure() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("diagnoses-nesting");
    let (patient_id, pm_bearer) = seed_clinical_patient(&pool, admin_id, &tag).await;

    // A "main"/"secondary" diagnosis whose parent is a "prozedur" is rejected.
    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/patients/{patient_id}/diagnoses"),
        &pm_bearer,
        Some(json!({
            "items": [
                {
                    "cid": "p1",
                    "kind": "prozedur",
                    "label": "Appendektomie",
                    "ops_code": "5-470.10",
                },
                {
                    "cid": "n1",
                    "parent_cid": "p1",
                    "kind": "secondary",
                    "label": "Diagnose darf nicht unter Prozedur hängen",
                },
            ],
        })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);

    // The rejected save is rolled back: nothing is persisted.
    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/patients/{patient_id}/clinical"),
        &pm_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["diagnoses"].as_array().expect("diagnoses").len(), 0);
}

// ---------------------------------------------------------------------------
// Medication (new Medikationsplan fields + on-hold) round-trip.
// ---------------------------------------------------------------------------

#[tokio::test]
async fn patient_medication_new_fields_and_hold_round_trip() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("medication-fields");
    let (patient_id, pm_bearer) = seed_clinical_patient(&pool, admin_id, &tag).await;

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/patients/{patient_id}/medications"),
        &pm_bearer,
        Some(json!({
            "items": [
                {
                    "category": "dauer",
                    "handelsname": "Bisoprolol-ratiopharm",
                    "wirkstoff": "Bisoprolol",
                    "staerke": "5 mg",
                    "form": "Filmtabl.",
                    "einnahmeform": "oral",
                    "verordnet_am": "2026-01-10",
                    "einnahme_von": "2026-01-11",
                    "einnahme_bis": "2026-06-30",
                    "status": "pausiert",
                    "apothekenpflichtig": true,
                    "rezeptpflichtig": true,
                    "btm": false,
                    "aut_idem_sperre": true,
                    "abgabebeschraenkung": false,
                    "sonstige_vermerke": "Mit Wasser einnehmen",
                    "on_hold": true,
                    "hold_until": "2026-03-01",
                    "hold_note": "Pause bis Kontrolle",
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
        &pm_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let medications = body["medications"].as_array().expect("medications array");
    assert_eq!(medications.len(), 1);
    let med = &medications[0];
    assert_eq!(med["handelsname"], "Bisoprolol-ratiopharm");
    assert_eq!(med["form"], "Filmtabl.");
    assert_eq!(med["einnahmeform"], "oral");
    assert_eq!(med["verordnet_am"], "2026-01-10");
    assert_eq!(med["einnahme_von"], "2026-01-11");
    assert_eq!(med["einnahme_bis"], "2026-06-30");
    assert_eq!(med["status"], "pausiert");
    assert_eq!(med["apothekenpflichtig"], true);
    assert_eq!(med["rezeptpflichtig"], true);
    assert_eq!(med["btm"], false);
    assert_eq!(med["aut_idem_sperre"], true);
    assert_eq!(med["abgabebeschraenkung"], false);
    assert_eq!(med["sonstige_vermerke"], "Mit Wasser einnehmen");
    assert_eq!(med["on_hold"], true);
    assert_eq!(med["hold_until"], "2026-03-01");
    assert_eq!(med["hold_note"], "Pause bis Kontrolle");
}

// ---------------------------------------------------------------------------
// Allergien / CAVE (POST /patients/:id/clinical-warnings, kind-scoped replace).
// ---------------------------------------------------------------------------

#[tokio::test]
async fn patient_clinical_warnings_allergie_and_cave_round_trip_kind_scoped() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("clinical-warnings");
    let (patient_id, pm_bearer) = seed_clinical_patient(&pool, admin_id, &tag).await;

    // Save an Allergie list.
    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/patients/{patient_id}/clinical-warnings"),
        &pm_bearer,
        Some(json!({
            "kind": "allergie",
            "items": [
                {
                    "label": "Penicillin",
                    "reaction": "Exanthem",
                    "severity": "mittel",
                    "note": "Dokumentiert 2019",
                },
            ],
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    // Save a CAVE list.
    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/patients/{patient_id}/clinical-warnings"),
        &pm_bearer,
        Some(json!({
            "kind": "cave",
            "items": [
                {
                    "label": "Niereninsuffizienz",
                    "note": "Dosisanpassung beachten",
                },
            ],
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    // Both lists appear, split by kind.
    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/patients/{patient_id}/clinical"),
        &pm_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let allergien = body["allergien"].as_array().expect("allergien array");
    assert_eq!(allergien.len(), 1);
    assert_eq!(allergien[0]["label"], "Penicillin");
    assert_eq!(allergien[0]["reaction"], "Exanthem");
    assert_eq!(allergien[0]["severity"], "mittel");
    let cave = body["cave"].as_array().expect("cave array");
    assert_eq!(cave.len(), 1);
    assert_eq!(cave[0]["label"], "Niereninsuffizienz");

    // Re-saving the Allergie list (replace-all) does NOT wipe the CAVE list.
    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/patients/{patient_id}/clinical-warnings"),
        &pm_bearer,
        Some(json!({
            "kind": "allergie",
            "items": [
                { "label": "Latex" },
            ],
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/patients/{patient_id}/clinical"),
        &pm_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let allergien = body["allergien"].as_array().expect("allergien array");
    assert_eq!(allergien.len(), 1);
    assert_eq!(allergien[0]["label"], "Latex");
    // CAVE list survives the kind-scoped allergie replace-all.
    let cave = body["cave"].as_array().expect("cave array");
    assert_eq!(cave.len(), 1);
    assert_eq!(cave[0]["label"], "Niereninsuffizienz");
}

// ---------------------------------------------------------------------------
// Recommendations lifecycle (create / list / validation / delete).
// ---------------------------------------------------------------------------

#[tokio::test]
async fn patient_recommendation_lifecycle_create_list_and_delete() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("recommendation-lifecycle");
    let (patient_id, pm_bearer) = seed_clinical_patient(&pool, admin_id, &tag).await;

    // Create with the lifecycle/reminder/outcome fields populated.
    let (status, created) = json_request(
        &app,
        "POST",
        &format!("/api/v1/patients/{patient_id}/recommendations"),
        &pm_bearer,
        Some(json!({
            "title": "Kardiologische Kontrolle",
            "lifecycle_status": "aktiv",
            "recommended_on": "2026-06-01",
            "valid_from": "2026-06-01",
            "valid_to": "2026-12-31",
            "reminder_lead_days": 14,
            "reminder_at": "2026-12-17",
            "outcome_note": "Noch offen",
            "outcome_at": "2026-12-31",
            "note_intern": "Intern: Patient erinnern",
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(created["title"], "Kardiologische Kontrolle");
    assert_eq!(created["lifecycle_status"], "aktiv");
    assert_eq!(created["recommended_on"], "2026-06-01");
    assert_eq!(created["valid_from"], "2026-06-01");
    assert_eq!(created["valid_to"], "2026-12-31");
    assert_eq!(created["reminder_lead_days"], 14);
    assert_eq!(created["reminder_at"], "2026-12-17");
    assert_eq!(created["outcome_note"], "Noch offen");
    assert_eq!(created["outcome_at"], "2026-12-31");
    assert_eq!(created["note_intern"], "Intern: Patient erinnern");
    let recommendation_id = created["id"].as_str().expect("recommendation id");

    // GET lists the new recommendation.
    let (status, list) = json_request(
        &app,
        "GET",
        &format!("/api/v1/patients/{patient_id}/recommendations"),
        &pm_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let items = list.as_array().expect("recommendations array");
    assert_eq!(items.len(), 1);
    assert_eq!(items[0]["id"], recommendation_id);
    assert_eq!(items[0]["lifecycle_status"], "aktiv");

    // Delete removes it.
    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/patients/{patient_id}/recommendations/{recommendation_id}/delete"),
        &pm_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);

    let (status, list) = json_request(
        &app,
        "GET",
        &format!("/api/v1/patients/{patient_id}/recommendations"),
        &pm_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(list.as_array().expect("recommendations array").len(), 0);
}

#[tokio::test]
async fn patient_recommendation_rejects_invalid_date_and_lead_days() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("recommendation-validation");
    let (patient_id, pm_bearer) = seed_clinical_patient(&pool, admin_id, &tag).await;

    // A malformed date in a validate_optional_date field is rejected with 422.
    // (The validator enforces the YYYY-MM-DD shape; this value is the wrong length.)
    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/patients/{patient_id}/recommendations"),
        &pm_bearer,
        Some(json!({
            "title": "Ungültiges Datum",
            "valid_to": "2025-13-99",
        })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);

    // reminder_lead_days outside the 0..=365 window is rejected with 422.
    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/patients/{patient_id}/recommendations"),
        &pm_bearer,
        Some(json!({
            "title": "Zu lange Vorlaufzeit",
            "reminder_lead_days": 999,
        })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);

    // Neither rejected create persisted anything.
    let (status, list) = json_request(
        &app,
        "GET",
        &format!("/api/v1/patients/{patient_id}/recommendations"),
        &pm_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(list.as_array().expect("recommendations array").len(), 0);
}
