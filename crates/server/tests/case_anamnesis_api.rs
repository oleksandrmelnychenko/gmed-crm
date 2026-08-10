// EPIC 2 — Cases / Medical Anamnesis backend integration tests.
//
// Source mapping (Excel `1 (Update 2) User Story Salesforce.xlsx`,
// `User Stories` sheet, mirrored to
// `docs/backlog/04_implementation-tasks_ua.md` section 1.3 "Анамнез"):
//
// - T-015 Генерація `Case ID` та відкриття anamnesis mask
//   route: `crates/server/src/routes/cases.rs:351` (create_case)
//   format: `crates/server/src/routes/cases.rs:253` (gen_case_id → C-YYYYMMDD-NNNN)
//
// - T-016 Erste Anamneseerhebung: case overview plus patient-owned narrative
//   routes: `POST /cases/{id}/anamnesis`, `POST /patients/{id}/narrative`
//
// - T-017 Pain block із NRS, локалізацією, динамікою та причиною
//   route: `crates/server/src/routes/cases.rs:1284` (save_pain_records)
//
// - T-018 Symptome: опис скарги + вибір фахового напрямку
//   route: `crates/server/src/routes/cases.rs:1644` (save_symptome)
//
// - T-019 Попередні захворювання: patient-owned diagnosis + date + note
//   route: `POST /patients/{id}/diagnoses`
//
// - T-021 Алергії: patient-owned clinical warning + reaction
//   route: `POST /patients/{id}/clinical-warnings`
//
// - T-022 Вакцинація як вільний текст
//   route: `POST /patients/{id}/impfstatus`
//
// - T-023 Медикаменти: patient-owned Medikationsplan fields and dose schedule
//   route: `POST /patients/{id}/medications`
//
// Gaps closed (per `docs/testing/full-docs-backlog-reconciliation_ua.md`
// EPIC 1 row 2 / EPIC 2):
//   - vorerkrankungen / allergien / impfstatus / pain had no integration tests
//   - case creation Case ID format was untested
//   - update_anamnesis overview round-trip was untested
//   - medikamente full repeat-block round-trip was only partially covered
//     (existing case_doctor_registry_metadata test focuses on doctor FK)

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

async fn create_patient(app: &axum::Router, bearer: &str, tag: &str) -> Uuid {
    let (status, body) = json_request(
        app,
        "POST",
        "/api/v1/patients",
        bearer,
        Some(json!({
            "first_name": format!("First {tag}"),
            "last_name": format!("Last {tag}"),
            "birth_date": "1990-01-01",
            "gender": "diverse"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    Uuid::parse_str(body["id"].as_str().unwrap()).unwrap()
}

async fn create_case(app: &axum::Router, bearer: &str, patient_id: Uuid) -> Uuid {
    let (status, body) = json_request(
        app,
        "POST",
        "/api/v1/cases",
        bearer,
        Some(json!({
            "patient_id": patient_id,
            "hauptanfragegrund": "EPIC 2 fixture case",
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "create case body: {body}");
    Uuid::parse_str(body["id"].as_str().unwrap()).unwrap()
}

async fn fetch_case(app: &axum::Router, bearer: &str, case_uuid: Uuid) -> Value {
    let (status, body) = json_request(
        app,
        "GET",
        &format!("/api/v1/cases/{case_uuid}"),
        bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "get case body: {body}");
    body
}

async fn fetch_patient_clinical(app: &axum::Router, bearer: &str, patient_id: Uuid) -> Value {
    let (status, body) = json_request(
        app,
        "GET",
        &format!("/api/v1/patients/{patient_id}/clinical"),
        bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "get patient clinical body: {body}");
    body
}

fn matches_case_id_format(case_code: &str) -> bool {
    // C-YYYYMMDD-NNNN — fixed length 15
    if case_code.len() != 15 {
        return false;
    }
    let bytes = case_code.as_bytes();
    if &bytes[..2] != b"C-" || bytes[10] != b'-' {
        return false;
    }
    bytes[2..10].iter().all(u8::is_ascii_digit) && bytes[11..15].iter().all(u8::is_ascii_digit)
}

// ============================================================================
// EPIC 2 T-015 — create_case auto Case ID format and uniqueness
// ============================================================================

#[tokio::test]
async fn create_case_assigns_format_c_yyyymmdd_nnnn_and_is_unique() {
    let Some((app, _pool, admin_id)) = test_context().await else {
        return;
    };
    let bearer = auth_header_for(admin_id, "ceo");

    let tag1 = unique_tag("case-id-a");
    let patient1 = create_patient(&app, &bearer, &tag1).await;
    let (status1, body1) = json_request(
        &app,
        "POST",
        "/api/v1/cases",
        &bearer,
        Some(json!({
            "patient_id": patient1,
            "hauptanfragegrund": "first case",
        })),
    )
    .await;
    assert_eq!(status1, StatusCode::CREATED, "create body: {body1}");
    let case_code1 = body1["case_id"].as_str().unwrap().to_string();
    assert!(
        matches_case_id_format(&case_code1),
        "case_id {case_code1} does not match C-YYYYMMDD-NNNN"
    );

    let tag2 = unique_tag("case-id-b");
    let patient2 = create_patient(&app, &bearer, &tag2).await;
    let (status2, body2) = json_request(
        &app,
        "POST",
        "/api/v1/cases",
        &bearer,
        Some(json!({
            "patient_id": patient2,
            "hauptanfragegrund": "second case",
        })),
    )
    .await;
    assert_eq!(status2, StatusCode::CREATED);
    let case_code2 = body2["case_id"].as_str().unwrap().to_string();
    assert!(matches_case_id_format(&case_code2));
    assert_ne!(
        case_code1, case_code2,
        "case_id must be unique across creates"
    );
}

#[tokio::test]
async fn lead_case_completes_intake_without_creating_patient() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };
    let bearer = auth_header_for(admin_id, "ceo");
    let tag = unique_tag("lead-case");
    let lead_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO leads (first_name, last_name, email, created_by)
           VALUES ($1, $2, $3, $4)
           RETURNING id"#,
    )
    .bind(format!("First {tag}"))
    .bind(format!("Last {tag}"))
    .bind(format!("{tag}@example.com"))
    .bind(admin_id)
    .fetch_one(&pool)
    .await
    .unwrap();

    let patient_count_before: i64 = sqlx::query_scalar("SELECT count(*) FROM patients")
        .fetch_one(&pool)
        .await
        .unwrap();
    let (create_status, created) = json_request(
        &app,
        "POST",
        "/api/v1/cases",
        &bearer,
        Some(json!({ "lead_id": lead_id })),
    )
    .await;
    assert_eq!(create_status, StatusCode::CREATED, "create body: {created}");
    assert_eq!(created["lead_id"], lead_id.to_string());
    assert!(created["patient_id"].is_null());
    let case_uuid = Uuid::parse_str(created["id"].as_str().unwrap()).unwrap();

    let (repeat_status, repeated) = json_request(
        &app,
        "POST",
        "/api/v1/cases",
        &bearer,
        Some(json!({ "lead_id": lead_id })),
    )
    .await;
    assert_eq!(repeat_status, StatusCode::OK, "repeat body: {repeated}");
    assert_eq!(repeated["id"], created["id"]);
    assert_eq!(repeated["already_exists"], true);

    let (blocked_status, blocked) = json_request(
        &app,
        "POST",
        &format!("/api/v1/cases/{case_uuid}/intake-completion"),
        &bearer,
        Some(json!({ "completed": true })),
    )
    .await;
    assert_eq!(blocked_status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(blocked["blocking_fields"], json!(["hauptanfragegrund"]));

    let (complete_status, completed) = json_request(
        &app,
        "POST",
        &format!("/api/v1/cases/{case_uuid}/intake-completion"),
        &bearer,
        Some(json!({
            "completed": true,
            "hauptanfragegrund": "Pain for six months after a sports injury.",
        })),
    )
    .await;
    assert_eq!(
        complete_status,
        StatusCode::OK,
        "complete body: {completed}"
    );
    assert_eq!(completed["completed"], true);
    assert!(completed["intake_completed_at"].is_string());

    let detail = fetch_case(&app, &bearer, case_uuid).await;
    assert_eq!(detail["lead_id"], lead_id.to_string());
    assert!(detail["patient_id"].is_null());
    assert_eq!(
        detail["hauptanfragegrund"],
        "Pain for six months after a sports injury."
    );
    assert!(detail["intake_completed_at"].is_string());

    let patient_count_after: i64 = sqlx::query_scalar("SELECT count(*) FROM patients")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(patient_count_after, patient_count_before);
}

// ============================================================================
// EPIC 2 T-016 — case overview and patient narrative round-trip
// ============================================================================

#[tokio::test]
async fn update_case_overview_and_patient_narrative_round_trip() {
    let Some((app, _pool, admin_id)) = test_context().await else {
        return;
    };
    let bearer = auth_header_for(admin_id, "ceo");

    let tag = unique_tag("case-overview");
    let patient_id = create_patient(&app, &bearer, &tag).await;
    let case_uuid = create_case(&app, &bearer, patient_id).await;

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/cases/{case_uuid}/anamnesis"),
        &bearer,
        Some(json!({
            "hauptanfragegrund": "Severe chest pain radiating to left arm",
            "zuweiser": "Hausarzt Praxis Müller",
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let case = fetch_case(&app, &bearer, case_uuid).await;
    assert_eq!(
        case["hauptanfragegrund"].as_str(),
        Some("Severe chest pain radiating to left arm")
    );
    assert_eq!(case["zuweiser"].as_str(), Some("Hausarzt Praxis Müller"));

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/patients/{patient_id}/narrative"),
        &bearer,
        Some(json!({
            "case_id": case_uuid,
            "anamnese_aktuelle": "Onset 2 weeks ago, exertional dyspnea added recently.",
        })),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::OK,
        "save patient narrative body: {body}"
    );

    let clinical = fetch_patient_clinical(&app, &bearer, patient_id).await;
    assert_eq!(
        clinical["narrative"]["anamnese_aktuelle"].as_str(),
        Some("Onset 2 weeks ago, exertional dyspnea added recently.")
    );
    assert_eq!(clinical["narrative"]["case_id"], case_uuid.to_string());
}

// ============================================================================
// EPIC 2 T-019 — patient diagnoses repeat block (diagnosis + date + note)
// ============================================================================

#[tokio::test]
async fn save_patient_diagnoses_replaces_full_block_with_three_items() {
    let Some((app, _pool, admin_id)) = test_context().await else {
        return;
    };
    let bearer = auth_header_for(admin_id, "ceo");

    let tag = unique_tag("case-vorerkr");
    let patient_id = create_patient(&app, &bearer, &tag).await;

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/patients/{patient_id}/diagnoses"),
        &bearer,
        Some(json!({
            "items": [
                {
                    "kind": "secondary",
                    "label": "Arterielle Hypertonie",
                    "diagnosed_on": "2018-03-12",
                    "note": "Stage 2, well-controlled on ACE inhibitor"
                },
                {
                    "kind": "secondary",
                    "label": "Type 2 Diabetes mellitus",
                    "diagnosed_on": "2020-09-04",
                    "note": "HbA1c 7.1%"
                },
                {
                    "kind": "secondary",
                    "label": "Asthma bronchiale",
                    "diagnosed_on": null,
                    "note": null
                }
            ]
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "save body: {body}");
    assert_eq!(body["count"].as_u64(), Some(3));

    let clinical = fetch_patient_clinical(&app, &bearer, patient_id).await;
    let diagnoses = clinical["diagnoses"].as_array().unwrap();
    assert_eq!(diagnoses.len(), 3);
    assert_eq!(
        diagnoses[0]["label"].as_str(),
        Some("Arterielle Hypertonie")
    );
    assert_eq!(diagnoses[0]["diagnosed_on"].as_str(), Some("2018-03-12"));
    assert_eq!(
        diagnoses[0]["note"].as_str(),
        Some("Stage 2, well-controlled on ACE inhibitor")
    );
    assert_eq!(
        diagnoses[1]["label"].as_str(),
        Some("Type 2 Diabetes mellitus")
    );
    assert_eq!(diagnoses[2]["label"].as_str(), Some("Asthma bronchiale"));

    // Save again with only one item — verify replace semantics, not append.
    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/patients/{patient_id}/diagnoses"),
        &bearer,
        Some(json!({
            "items": [
                { "kind": "secondary", "label": "Only diagnosis after replace" }
            ]
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let clinical_after = fetch_patient_clinical(&app, &bearer, patient_id).await;
    let diagnoses_after = clinical_after["diagnoses"].as_array().unwrap();
    assert_eq!(
        diagnoses_after.len(),
        1,
        "patient diagnoses save must REPLACE, not append"
    );
    assert_eq!(
        diagnoses_after[0]["label"].as_str(),
        Some("Only diagnosis after replace")
    );
}

// ============================================================================
// EPIC 2 T-021 — patient allergies round-trip (allergen + reaction)
// ============================================================================

#[tokio::test]
async fn save_patient_allergies_round_trip_allergen_and_reaction() {
    let Some((app, _pool, admin_id)) = test_context().await else {
        return;
    };
    let bearer = auth_header_for(admin_id, "ceo");

    let tag = unique_tag("case-allerg");
    let patient_id = create_patient(&app, &bearer, &tag).await;

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/patients/{patient_id}/clinical-warnings"),
        &bearer,
        Some(json!({
            "kind": "allergie",
            "items": [
                { "label": "Penicillin", "reaction": "Generalised urticaria" },
                { "label": "Latex", "reaction": "Contact dermatitis" },
                { "label": "Erdnüsse", "reaction": null }
            ]
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let clinical = fetch_patient_clinical(&app, &bearer, patient_id).await;
    let allergien = clinical["allergien"].as_array().unwrap();
    assert_eq!(allergien.len(), 3);
    assert_eq!(allergien[0]["label"].as_str(), Some("Penicillin"));
    assert_eq!(
        allergien[0]["reaction"].as_str(),
        Some("Generalised urticaria")
    );
    assert_eq!(allergien[1]["label"].as_str(), Some("Latex"));
    assert_eq!(
        allergien[1]["reaction"].as_str(),
        Some("Contact dermatitis")
    );
    assert_eq!(allergien[2]["label"].as_str(), Some("Erdnüsse"));
    assert!(allergien[2]["reaction"].is_null());
}

// ============================================================================
// EPIC 2 T-017 — pain block with NRS, localization, dynamics, cause
// ============================================================================

#[tokio::test]
async fn save_pain_records_round_trips_nrs_and_localization() {
    let Some((app, _pool, admin_id)) = test_context().await else {
        return;
    };
    let bearer = auth_header_for(admin_id, "ceo");

    let tag = unique_tag("case-pain");
    let patient_id = create_patient(&app, &bearer, &tag).await;
    let case_uuid = create_case(&app, &bearer, patient_id).await;

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/cases/{case_uuid}/pain"),
        &bearer,
        Some(json!({
            "items": [
                {
                    "lokalisierung": "lower back, right side",
                    "seit_wann": "6 weeks",
                    "ursache": "lifting heavy load",
                    "qualitaet": "stechend",
                    "kontinuitaet": "intermittent",
                    "entwicklung": "progressively worse with sitting",
                    "nrs_aktuell": 7,
                    "nrs_anfang": 4,
                    "dauer_anfang": "kurze Episoden",
                    "dauer_aktuell": "stundenlang",
                    "ausstrahlung": "right thigh down to knee",
                    "auftreten": "morning, after activity"
                }
            ]
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let case = fetch_case(&app, &bearer, case_uuid).await;
    let pain = case["pain_records"].as_array().unwrap();
    assert_eq!(pain.len(), 1);
    let item = &pain[0];
    assert_eq!(
        item["lokalisierung"].as_str(),
        Some("lower back, right side")
    );
    assert_eq!(item["seit_wann"].as_str(), Some("6 weeks"));
    assert_eq!(item["ursache"].as_str(), Some("lifting heavy load"));
    assert_eq!(item["qualitaet"].as_str(), Some("stechend"));
    assert_eq!(item["kontinuitaet"].as_str(), Some("intermittent"));
    assert_eq!(
        item["entwicklung"].as_str(),
        Some("progressively worse with sitting")
    );
    assert_eq!(item["nrs_aktuell"].as_i64(), Some(7));
    assert_eq!(item["nrs_anfang"].as_i64(), Some(4));
    assert_eq!(item["dauer_anfang"].as_str(), Some("kurze Episoden"));
    assert_eq!(item["dauer_aktuell"].as_str(), Some("stundenlang"));
    assert_eq!(
        item["ausstrahlung"].as_str(),
        Some("right thigh down to knee")
    );
    assert_eq!(item["auftreten"].as_str(), Some("morning, after activity"));
}

#[tokio::test]
async fn save_pain_records_rejects_nrs_values_outside_scale() {
    let Some((app, _pool, admin_id)) = test_context().await else {
        return;
    };
    let bearer = auth_header_for(admin_id, "ceo");

    let tag = unique_tag("case-pain-validation");
    let patient_id = create_patient(&app, &bearer, &tag).await;
    let case_uuid = create_case(&app, &bearer, patient_id).await;

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/cases/{case_uuid}/pain"),
        &bearer,
        Some(json!({
            "items": [
                {
                    "lokalisierung": "shoulder",
                    "nrs_aktuell": 45,
                    "nrs_anfang": 54
                }
            ]
        })),
    )
    .await;

    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(
        body["message"].as_str(),
        Some("NRS values must be whole numbers from 0 to 10")
    );
}

// ============================================================================
// EPIC 2 T-018 — symptome repeat block (description + fachrichtung)
// ============================================================================

#[tokio::test]
async fn save_symptome_round_trips_description_and_fachrichtung() {
    let Some((app, _pool, admin_id)) = test_context().await else {
        return;
    };
    let bearer = auth_header_for(admin_id, "ceo");

    let tag = unique_tag("case-symptoms");
    let patient_id = create_patient(&app, &bearer, &tag).await;
    let case_uuid = create_case(&app, &bearer, patient_id).await;

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/cases/{case_uuid}/symptome"),
        &bearer,
        Some(json!({
            "items": [
                {
                    "beschreibung": "Belastungsdyspnoe seit zwei Wochen",
                    "fachrichtung": "Kardiologie"
                },
                {
                    "beschreibung": "Intermittierende Oberbauchbeschwerden",
                    "fachrichtung": "Gastroenterologie"
                }
            ]
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "save body: {body}");
    assert_eq!(body["count"].as_u64(), Some(2));

    let case = fetch_case(&app, &bearer, case_uuid).await;
    let symptoms = case["symptome"].as_array().unwrap();
    assert_eq!(symptoms.len(), 2);
    assert_eq!(
        symptoms[0]["beschreibung"].as_str(),
        Some("Belastungsdyspnoe seit zwei Wochen")
    );
    assert_eq!(symptoms[0]["fachrichtung"].as_str(), Some("Kardiologie"));
    assert_eq!(
        symptoms[1]["beschreibung"].as_str(),
        Some("Intermittierende Oberbauchbeschwerden")
    );
    assert_eq!(
        symptoms[1]["fachrichtung"].as_str(),
        Some("Gastroenterologie")
    );

    let (replace_status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/cases/{case_uuid}/symptome"),
        &bearer,
        Some(json!({
            "items": [
                {
                    "beschreibung": "Persisted single symptom after replace",
                    "fachrichtung": null
                }
            ]
        })),
    )
    .await;
    assert_eq!(replace_status, StatusCode::OK);

    let case_after = fetch_case(&app, &bearer, case_uuid).await;
    let symptoms_after = case_after["symptome"].as_array().unwrap();
    assert_eq!(
        symptoms_after.len(),
        1,
        "symptome save must REPLACE, not append"
    );
    assert_eq!(
        symptoms_after[0]["beschreibung"].as_str(),
        Some("Persisted single symptom after replace")
    );
    assert!(symptoms_after[0]["fachrichtung"].is_null());
}

// ============================================================================
// EPIC 2 T-022 — patient impfstatus free-text round-trip
// ============================================================================

#[tokio::test]
async fn save_patient_impfstatus_round_trips_free_text() {
    let Some((app, _pool, admin_id)) = test_context().await else {
        return;
    };
    let bearer = auth_header_for(admin_id, "ceo");

    let tag = unique_tag("case-impf");
    let patient_id = create_patient(&app, &bearer, &tag).await;

    let body_text = "Tetanus 2022, MMR 2018, FSME 2024 (3 doses), COVID-19 4x bis 2023.";
    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/patients/{patient_id}/impfstatus"),
        &bearer,
        Some(json!({ "status_text": body_text })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/patients/{patient_id}/impfstatus"),
        &bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "get impfstatus body: {body}");
    assert_eq!(body["impfstatus"]["status_text"].as_str(), Some(body_text));
}

// ============================================================================
// EPIC 2 T-023 — patient medications repeat block (current Medikationsplan schema)
// ============================================================================

#[tokio::test]
async fn save_patient_medications_round_trip_full_repeat_block_fields() {
    let Some((app, _pool, admin_id)) = test_context().await else {
        return;
    };
    let bearer = auth_header_for(admin_id, "ceo");

    let tag = unique_tag("case-meds");
    let patient_id = create_patient(&app, &bearer, &tag).await;

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/patients/{patient_id}/medications"),
        &bearer,
        Some(json!({
            "items": [
                {
                    "handelsname": "Ramipril",
                    "wirkstoff": "Ramipril",
                    "staerke": "5 mg",
                    "dose_morgens": "1",
                    "dose_mittags": "0",
                    "dose_abends": "0",
                    "form": "AMP",
                    "einheit": "Ampulle",
                    "hinweis": "morgens nüchtern",
                    "grund": "arterielle Hypertonie",
                    "einnahme_von": "2018-04-01",
                    "category": "dauer"
                },
                {
                    "handelsname": "Metformin",
                    "wirkstoff": "Metformin",
                    "staerke": "1000 mg",
                    "dose_morgens": "1",
                    "dose_mittags": "0",
                    "dose_abends": "1",
                    "form": "TABL",
                    "category": "dauer"
                }
            ]
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let clinical = fetch_patient_clinical(&app, &bearer, patient_id).await;
    let meds = clinical["medications"].as_array().unwrap();
    assert_eq!(meds.len(), 2);

    let first = &meds[0];
    assert_eq!(first["handelsname"].as_str(), Some("Ramipril"));
    assert_eq!(first["wirkstoff"].as_str(), Some("Ramipril"));
    assert_eq!(first["staerke"].as_str(), Some("5 mg"));
    assert_eq!(first["dose_morgens"].as_str(), Some("1"));
    assert_eq!(first["dose_mittags"].as_str(), Some("0"));
    assert_eq!(first["dose_abends"].as_str(), Some("0"));
    assert_eq!(first["form"].as_str(), Some("AMP"));
    assert_eq!(first["einheit"].as_str(), Some("Ampulle"));
    assert_eq!(first["hinweis"].as_str(), Some("morgens nüchtern"));
    assert_eq!(first["grund"].as_str(), Some("arterielle Hypertonie"));
    assert_eq!(first["einnahme_von"].as_str(), Some("2018-04-01"));
    assert_eq!(first["category"].as_str(), Some("dauer"));

    let second = &meds[1];
    assert_eq!(second["handelsname"].as_str(), Some("Metformin"));
    assert_eq!(second["staerke"].as_str(), Some("1000 mg"));
    assert_eq!(second["dose_morgens"].as_str(), Some("1"));
    assert_eq!(second["dose_abends"].as_str(), Some("1"));
    assert_eq!(second["form"].as_str(), Some("TABL"));
}

#[tokio::test]
async fn medication_requires_active_ingredient_but_not_trade_name() {
    let Some((app, _pool, admin_id)) = test_context().await else {
        return;
    };
    let bearer = auth_header_for(admin_id, "ceo");
    let tag = unique_tag("case-meds-required-ingredient");
    let patient_id = create_patient(&app, &bearer, &tag).await;

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/patients/{patient_id}/medications"),
        &bearer,
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
    let clinical = fetch_patient_clinical(&app, &bearer, patient_id).await;
    assert_eq!(clinical["medications"][0]["wirkstoff"], "Ibuprofen");
    assert_eq!(clinical["medications"][0]["handelsname"], "");

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/patients/{patient_id}/medications"),
        &bearer,
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

    let clinical = fetch_patient_clinical(&app, &bearer, patient_id).await;
    assert_eq!(clinical["medications"].as_array().unwrap().len(), 1);
    assert_eq!(clinical["medications"][0]["wirkstoff"], "Ibuprofen");
}

// ============================================================================
// EPIC 2 RBAC — interpreter cannot create a case or update patient clinical data
// ============================================================================

#[tokio::test]
async fn interpreter_cannot_create_case_or_save_patient_diagnoses() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };
    let pm_bearer = auth_header_for(admin_id, "ceo");

    let tag = unique_tag("case-rbac");
    let patient_id = create_patient(&app, &pm_bearer, &tag).await;

    let interpreter_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO users (email, password_hash, name, role)
           VALUES ($1, $2, $3, $4)
           RETURNING id"#,
    )
    .bind(format!("{tag}-interpreter@example.com"))
    .bind("test-password-hash")
    .bind(format!("Interpreter {tag}"))
    .bind("interpreter")
    .fetch_one(&pool)
    .await
    .unwrap();
    let interpreter_bearer = auth_header_for(interpreter_id, "interpreter");

    let (create_status, _) = json_request(
        &app,
        "POST",
        "/api/v1/cases",
        &interpreter_bearer,
        Some(json!({
            "patient_id": patient_id,
            "hauptanfragegrund": "interpreter should not create"
        })),
    )
    .await;
    assert_eq!(create_status, StatusCode::FORBIDDEN);

    let (save_status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/patients/{patient_id}/diagnoses"),
        &interpreter_bearer,
        Some(json!({
            "items": [{ "kind": "secondary", "label": "Should not save" }]
        })),
    )
    .await;
    assert_eq!(save_status, StatusCode::FORBIDDEN);
}

// ============================================================================
// EPIC 2 T-020 — patient procedures round-trip (date + label + note)
// ============================================================================

#[tokio::test]
async fn save_patient_procedures_round_trip_date_label_and_note() {
    let Some((app, _pool, admin_id)) = test_context().await else {
        return;
    };
    let bearer = auth_header_for(admin_id, "ceo");

    let tag = unique_tag("case-ops");
    let patient_id = create_patient(&app, &bearer, &tag).await;

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/patients/{patient_id}/procedures"),
        &bearer,
        Some(json!({
            "items": [
                {
                    "performed_on": "2019-06-15",
                    "label": "Cholezystektomie laparoskopisch",
                    "note": "Komplikationslos, 2 Tage stationär"
                },
                {
                    "performed_on": null,
                    "label": "Appendektomie (Kindheit)",
                    "note": null
                }
            ]
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "save body: {body}");
    assert_eq!(body["count"].as_u64(), Some(2));

    let clinical = fetch_patient_clinical(&app, &bearer, patient_id).await;
    let ops = clinical["procedures"].as_array().unwrap();
    assert_eq!(ops.len(), 2);

    assert_eq!(ops[0]["performed_on"].as_str(), Some("2019-06-15"));
    assert_eq!(
        ops[0]["label"].as_str(),
        Some("Cholezystektomie laparoskopisch")
    );
    assert_eq!(
        ops[0]["note"].as_str(),
        Some("Komplikationslos, 2 Tage stationär")
    );

    assert!(ops[1]["performed_on"].is_null());
    assert_eq!(ops[1]["label"].as_str(), Some("Appendektomie (Kindheit)"));

    // Replace semantics: save just one item — list shrinks.
    let (status_replace, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/patients/{patient_id}/procedures"),
        &bearer,
        Some(json!({
            "items": [{ "label": "Replaced single procedure" }]
        })),
    )
    .await;
    assert_eq!(status_replace, StatusCode::OK);
    let clinical_after = fetch_patient_clinical(&app, &bearer, patient_id).await;
    let ops_after = clinical_after["procedures"].as_array().unwrap();
    assert_eq!(ops_after.len(), 1);
    assert_eq!(
        ops_after[0]["label"].as_str(),
        Some("Replaced single procedure")
    );
}

// ============================================================================
// EPIC 2 T-024 — patient-owned vegetative narrative round-trip
// ============================================================================

#[tokio::test]
async fn save_patient_vegetative_narrative_round_trips_full_text() {
    let Some((app, _pool, admin_id)) = test_context().await else {
        return;
    };
    let bearer = auth_header_for(admin_id, "ceo");

    let tag = unique_tag("case-veg");
    let patient_id = create_patient(&app, &bearer, &tag).await;

    let vegetative = "Appetit reduziert seit 3 Wochen, Durst normal. Körpergröße 175 cm, Gewicht 78,5 kg; Gewichtsveränderung: abgenommen. Grund: Appetitlosigkeit nach Anstrengung.";

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/patients/{patient_id}/narrative"),
        &bearer,
        Some(json!({ "anamnese_vegetative": vegetative })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let clinical = fetch_patient_clinical(&app, &bearer, patient_id).await;
    assert_eq!(
        clinical["narrative"]["anamnese_vegetative"].as_str(),
        Some(vegetative)
    );
}

// ============================================================================
// EPIC 2 T-025 — Specialty sub-flow round-trips (cardiology, gastroenterology,
// orthopedics, neurology, pulmonology, urology). Each save handler is upsert.
// Source: cases.rs:1442/1530/1632/1716/1802/1888 save_<specialty>.
// Schema: migrations/20260412160000_case_cardiology_subflow.sql,
//         migrations/20260413150000_case_gastroenterology_subflow.sql,
//         migrations/20260413160000_case_orthopedics_neurology_subflows.sql,
//         migrations/20260413200000_case_pulmonology_urology_subflows.sql.
// ============================================================================

#[tokio::test]
async fn save_cardiology_assessment_round_trips_red_flags_and_risk_factors() {
    let Some((app, _pool, admin_id)) = test_context().await else {
        return;
    };
    let bearer = auth_header_for(admin_id, "ceo");

    let tag = unique_tag("case-cardio");
    let patient_id = create_patient(&app, &bearer, &tag).await;
    let case_uuid = create_case(&app, &bearer, patient_id).await;

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/cases/{case_uuid}/cardiology"),
        &bearer,
        Some(json!({
            "is_relevant": true,
            "chest_pain": true,
            "dyspnea": true,
            "palpitations": false,
            "syncope": false,
            "edema": true,
            "known_diagnosis": "Arterielle Hypertonie, KHK 1-Gefäß",
            "prior_cardiac_workup": "Echo 2024-02 normal LV EF 55%",
            "cardiovascular_risk_factors": "Hypertonie, Hypercholesterinämie, Nikotinabusus 20 PY",
            "anticoagulation": "ASS 100 mg",
            "family_history": "Vater MI mit 60",
            "red_flags": "Belastungsangina seit 2 Wochen — sofortige Abklärung",
            "notes": "Konsultation Kardiologie vereinbart"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let case = fetch_case(&app, &bearer, case_uuid).await;
    let cardio = &case["cardiology"];
    assert!(!cardio.is_null());
    assert_eq!(cardio["is_relevant"].as_bool(), Some(true));
    assert_eq!(cardio["chest_pain"].as_bool(), Some(true));
    assert_eq!(cardio["dyspnea"].as_bool(), Some(true));
    assert_eq!(cardio["palpitations"].as_bool(), Some(false));
    assert_eq!(cardio["edema"].as_bool(), Some(true));
    assert_eq!(
        cardio["known_diagnosis"].as_str(),
        Some("Arterielle Hypertonie, KHK 1-Gefäß")
    );
    assert_eq!(
        cardio["cardiovascular_risk_factors"].as_str(),
        Some("Hypertonie, Hypercholesterinämie, Nikotinabusus 20 PY")
    );
    assert_eq!(cardio["anticoagulation"].as_str(), Some("ASS 100 mg"));
    assert_eq!(cardio["family_history"].as_str(), Some("Vater MI mit 60"));
    assert_eq!(
        cardio["red_flags"].as_str(),
        Some("Belastungsangina seit 2 Wochen — sofortige Abklärung")
    );
}

#[tokio::test]
async fn save_gastroenterology_assessment_round_trips_full_payload() {
    let Some((app, _pool, admin_id)) = test_context().await else {
        return;
    };
    let bearer = auth_header_for(admin_id, "ceo");

    let tag = unique_tag("case-gastro");
    let patient_id = create_patient(&app, &bearer, &tag).await;
    let case_uuid = create_case(&app, &bearer, patient_id).await;

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/cases/{case_uuid}/gastroenterology"),
        &bearer,
        Some(json!({
            "is_relevant": true,
            "abdominal_pain": true,
            "reflux": true,
            "nausea": false,
            "diarrhea": false,
            "constipation": true,
            "gi_bleeding": false,
            "prior_endoscopy": "ÖGD 2023-09 unauffällig, Koloskopie 2022 leichte Sigmadivertikulose",
            "bowel_habits": "1×/Tag morgens, gelegentlich Obstipation",
            "liver_history": "Sonografie Leber 2023 normal",
            "food_intolerance": "Laktose-Intoleranz seit Kindheit",
            "red_flags": "Keine — Blut/Anämie/Gewichtsverlust ausgeschlossen",
            "notes": "Reflux unter PPI deutlich besser"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let case = fetch_case(&app, &bearer, case_uuid).await;
    let gastro = &case["gastroenterology"];
    assert!(!gastro.is_null());
    assert_eq!(gastro["is_relevant"].as_bool(), Some(true));
    assert_eq!(gastro["abdominal_pain"].as_bool(), Some(true));
    assert_eq!(gastro["reflux"].as_bool(), Some(true));
    assert_eq!(gastro["constipation"].as_bool(), Some(true));
    assert_eq!(gastro["gi_bleeding"].as_bool(), Some(false));
    assert_eq!(
        gastro["prior_endoscopy"].as_str(),
        Some("ÖGD 2023-09 unauffällig, Koloskopie 2022 leichte Sigmadivertikulose")
    );
    assert_eq!(
        gastro["food_intolerance"].as_str(),
        Some("Laktose-Intoleranz seit Kindheit")
    );
    assert_eq!(
        gastro["red_flags"].as_str(),
        Some("Keine — Blut/Anämie/Gewichtsverlust ausgeschlossen")
    );
}

#[tokio::test]
async fn save_orthopedics_assessment_round_trips_full_payload() {
    let Some((app, _pool, admin_id)) = test_context().await else {
        return;
    };
    let bearer = auth_header_for(admin_id, "ceo");

    let tag = unique_tag("case-ortho");
    let patient_id = create_patient(&app, &bearer, &tag).await;
    let case_uuid = create_case(&app, &bearer, patient_id).await;

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/cases/{case_uuid}/orthopedics"),
        &bearer,
        Some(json!({
            "is_relevant": true,
            "joint_pain": true,
            "back_pain": true,
            "mobility_limitation": true,
            "trauma_history": false,
            "prior_imaging": "MRT LWS 2024-01 — L4/L5 Bandscheibenvorfall",
            "assistive_devices": "Gehstock seit 3 Monaten",
            "physiotherapy_history": "20 Sitzungen 2023, leichte Besserung",
            "pain_triggers": "Längeres Sitzen, Treppensteigen",
            "red_flags": "Keine Blasen-/Darmstörungen, keine Reithose-Anästhesie",
            "notes": "OP nur bei progredienten Defiziten geplant"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let case = fetch_case(&app, &bearer, case_uuid).await;
    let ortho = &case["orthopedics"];
    assert!(!ortho.is_null());
    assert_eq!(ortho["is_relevant"].as_bool(), Some(true));
    assert_eq!(ortho["joint_pain"].as_bool(), Some(true));
    assert_eq!(ortho["back_pain"].as_bool(), Some(true));
    assert_eq!(ortho["mobility_limitation"].as_bool(), Some(true));
    assert_eq!(ortho["trauma_history"].as_bool(), Some(false));
    assert_eq!(
        ortho["prior_imaging"].as_str(),
        Some("MRT LWS 2024-01 — L4/L5 Bandscheibenvorfall")
    );
    assert_eq!(
        ortho["assistive_devices"].as_str(),
        Some("Gehstock seit 3 Monaten")
    );
    assert_eq!(
        ortho["pain_triggers"].as_str(),
        Some("Längeres Sitzen, Treppensteigen")
    );
}

#[tokio::test]
async fn save_neurology_assessment_round_trips_full_payload() {
    let Some((app, _pool, admin_id)) = test_context().await else {
        return;
    };
    let bearer = auth_header_for(admin_id, "ceo");

    let tag = unique_tag("case-neuro");
    let patient_id = create_patient(&app, &bearer, &tag).await;
    let case_uuid = create_case(&app, &bearer, patient_id).await;

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/cases/{case_uuid}/neurology"),
        &bearer,
        Some(json!({
            "is_relevant": true,
            "headache": true,
            "dizziness": true,
            "sensory_changes": false,
            "weakness": false,
            "seizure_history": false,
            "gait_balance_issues": false,
            "prior_neuro_imaging": "MRT Schädel 2023 unauffällig",
            "prior_neurology_workup": "EEG 2023, Doppler Halsgefäße 2024",
            "cognitive_changes": "Gelegentliche Wortfindungsstörung",
            "red_flags": "Keine fokalen Defizite, keine plötzliche neue Cephalgie",
            "notes": "Migräne ohne Aura, prophylaktisch Topiramat"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let case = fetch_case(&app, &bearer, case_uuid).await;
    let neuro = &case["neurology"];
    assert!(!neuro.is_null());
    assert_eq!(neuro["headache"].as_bool(), Some(true));
    assert_eq!(neuro["dizziness"].as_bool(), Some(true));
    assert_eq!(neuro["seizure_history"].as_bool(), Some(false));
    assert_eq!(
        neuro["prior_neuro_imaging"].as_str(),
        Some("MRT Schädel 2023 unauffällig")
    );
    assert_eq!(
        neuro["cognitive_changes"].as_str(),
        Some("Gelegentliche Wortfindungsstörung")
    );
}

#[tokio::test]
async fn save_pulmonology_assessment_round_trips_full_payload() {
    let Some((app, _pool, admin_id)) = test_context().await else {
        return;
    };
    let bearer = auth_header_for(admin_id, "ceo");

    let tag = unique_tag("case-pulmo");
    let patient_id = create_patient(&app, &bearer, &tag).await;
    let case_uuid = create_case(&app, &bearer, patient_id).await;

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/cases/{case_uuid}/pulmonology"),
        &bearer,
        Some(json!({
            "is_relevant": true,
            "chronic_cough": true,
            "dyspnea": true,
            "wheezing": false,
            "chest_tightness": true,
            "hemoptysis": false,
            "smoking_history": "20 PY ex-Raucher seit 2 Jahren",
            "prior_chest_imaging": "Röntgen-Thorax 2024-01 unauffällig",
            "inhaler_therapy": "Salbutamol bei Bedarf",
            "sleep_apnea_history": "Polysomnografie 2023 — leichte OSAS, kein CPAP",
            "red_flags": "Keine Hämoptyse, kein Gewichtsverlust",
            "notes": "Spirometrie geplant"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let case = fetch_case(&app, &bearer, case_uuid).await;
    let pulmo = &case["pulmonology"];
    assert!(!pulmo.is_null());
    assert_eq!(pulmo["chronic_cough"].as_bool(), Some(true));
    assert_eq!(pulmo["chest_tightness"].as_bool(), Some(true));
    assert_eq!(pulmo["hemoptysis"].as_bool(), Some(false));
    assert_eq!(
        pulmo["smoking_history"].as_str(),
        Some("20 PY ex-Raucher seit 2 Jahren")
    );
    assert_eq!(
        pulmo["sleep_apnea_history"].as_str(),
        Some("Polysomnografie 2023 — leichte OSAS, kein CPAP")
    );
}

#[tokio::test]
async fn save_urology_assessment_round_trips_full_payload() {
    let Some((app, _pool, admin_id)) = test_context().await else {
        return;
    };
    let bearer = auth_header_for(admin_id, "ceo");

    let tag = unique_tag("case-uro");
    let patient_id = create_patient(&app, &bearer, &tag).await;
    let case_uuid = create_case(&app, &bearer, patient_id).await;

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/cases/{case_uuid}/urology"),
        &bearer,
        Some(json!({
            "is_relevant": true,
            "dysuria": true,
            "hematuria": false,
            "flank_pain": true,
            "urinary_frequency": true,
            "urinary_retention": false,
            "incontinence": false,
            "prior_urology_workup": "Sonografie Nieren 2024 — kleines linksseitiges Konkrement",
            "catheter_history": "Keiner",
            "stone_history": "1 Episode 2020 spontaner Abgang",
            "red_flags": "Keine, Hämaturie aktuell ausgeschlossen",
            "notes": "Hydratationsempfehlung"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let case = fetch_case(&app, &bearer, case_uuid).await;
    let uro = &case["urology"];
    assert!(!uro.is_null());
    assert_eq!(uro["dysuria"].as_bool(), Some(true));
    assert_eq!(uro["hematuria"].as_bool(), Some(false));
    assert_eq!(uro["flank_pain"].as_bool(), Some(true));
    assert_eq!(
        uro["prior_urology_workup"].as_str(),
        Some("Sonografie Nieren 2024 — kleines linksseitiges Konkrement")
    );
    assert_eq!(
        uro["stone_history"].as_str(),
        Some("1 Episode 2020 spontaner Abgang")
    );
}
