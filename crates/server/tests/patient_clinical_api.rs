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

#[tokio::test]
async fn patient_notes_update_does_not_require_unrelated_minor_guardian_fix() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("minor-notes-update");
    let patient_id = seed_minor_patient_without_guardian(&pool, admin_id, &tag).await;
    let pm_id = seed_user(&pool, &format!("{tag}-pm"), "patient_manager").await;
    seed_patient_assignment(&pool, patient_id, pm_id, admin_id).await;
    let pm_bearer = auth_header_for(pm_id, "patient_manager");

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/patients/{patient_id}/update"),
        &pm_bearer,
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
        &pm_bearer,
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
async fn patient_passport_round_trips_and_flags_expiry() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("passport");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let pm_id = seed_user(&pool, &format!("{tag}-pm"), "patient_manager").await;
    seed_patient_assignment(&pool, patient_id, pm_id, admin_id).await;
    let pm_bearer = auth_header_for(pm_id, "patient_manager");

    // Record a passport that expired in the past.
    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/patients/{patient_id}/update"),
        &pm_bearer,
        Some(json!({ "passport_number": "X1234567", "passport_expiry": "2020-01-01" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (status, detail) = json_request(
        &app,
        "GET",
        &format!("/api/v1/patients/{patient_id}"),
        &pm_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(detail["passport_number"], "X1234567");
    assert_eq!(detail["passport_expiry"], "2020-01-01");
    assert_eq!(detail["passport_expired"], true, "past expiry must flag expired");

    // Renew to a future date -> no longer expired; number preserved when omitted.
    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/patients/{patient_id}/update"),
        &pm_bearer,
        Some(json!({ "passport_expiry": "2999-12-31" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (status, detail) = json_request(
        &app,
        "GET",
        &format!("/api/v1/patients/{patient_id}"),
        &pm_bearer,
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

    // A malformed date is rejected.
    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/patients/{patient_id}/update"),
        &pm_bearer,
        Some(json!({ "passport_expiry": "31.12.2030" })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
}

#[tokio::test]
async fn patient_vitals_round_trip_and_clinical_warnings_flow_through_profile() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("patient-vitals");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let pm_id = seed_user(&pool, &format!("{tag}-pm"), "patient_manager").await;
    seed_patient_assignment(&pool, patient_id, pm_id, admin_id).await;
    let pm_bearer = auth_header_for(pm_id, "patient_manager");

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/patients/{patient_id}/update"),
        &pm_bearer,
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
        &pm_bearer,
        Some(json!({
            "measured_at": "2026-04-14T09:45:00Z",
            "bp_systolic": 125.0,
            "bp_diastolic": 82.0,
            "heart_rate": 71,
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
        &pm_bearer,
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
        &pm_bearer,
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
        &pm_bearer,
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
    assert_eq!(items[0]["weight_kg"], 72.0);
    assert_eq!(items[0]["height_cm"], 175.0);
    let bmi = items[0]["bmi"].as_f64().expect("bmi");
    assert!(
        (bmi - 23.5).abs() < 0.05,
        "expected auto-computed bmi close to 23.5, got {bmi}"
    );
    assert_eq!(items[0]["notes"], "Pre-op baseline");
    assert_eq!(items[1]["measured_at"], "2026-04-13T08:15:00+00:00");
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
    let pm_id = seed_user(&pool, &format!("{tag}-pm"), "patient_manager").await;
    seed_patient_assignment(&pool, patient_id, pm_id, admin_id).await;
    let pm_bearer = auth_header_for(pm_id, "patient_manager");

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/patients/{patient_id}/card-entries"),
        &pm_bearer,
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
        &pm_bearer,
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
        &pm_bearer,
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
        &pm_bearer,
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
    assert!(source_label.contains(&format!("patient_manager {tag}-pm")));
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
    let pm_id = seed_user(&pool, &format!("{tag}-pm"), "patient_manager").await;
    seed_patient_assignment(&pool, patient_id, pm_id, admin_id).await;
    let pm_bearer = auth_header_for(pm_id, "patient_manager");

    let (status, create_body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/patients/{patient_id}/medical-orders"),
        &pm_bearer,
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
        &pm_bearer,
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
        &pm_bearer,
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
        &pm_bearer,
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
        &pm_bearer,
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
    let pm_id = seed_user(&pool, &format!("{tag}-pm"), "patient_manager").await;
    seed_patient_assignment(&pool, patient_id, pm_id, admin_id).await;
    let pm_bearer = auth_header_for(pm_id, "patient_manager");

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/patients/{patient_id}/risk-scores"),
        &pm_bearer,
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
        &pm_bearer,
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
        &pm_bearer,
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
        &pm_bearer,
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
    assert!(source_label.contains(&format!("patient_manager {tag}-pm")));
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
    let pm_id = seed_user(&pool, &format!("{tag}-pm"), "patient_manager").await;
    let pm_bearer = auth_header_for(pm_id, "patient_manager");

    let (status, body) = json_request(&app, "GET", "/api/v1/doctors", &pm_bearer, None).await;
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
    let pm_id = seed_user(&pool, &format!("{tag}-pm"), "patient_manager").await;
    seed_patient_assignment(&pool, patient_id, pm_id, admin_id).await;
    let pm_bearer = auth_header_for(pm_id, "patient_manager");

    let provider_id = seed_provider(&pool, &tag).await;
    let doctor_id = seed_provider_doctor(&pool, provider_id, &tag).await;

    // ---- Diagnoses (main with ICD + provider/doctor, plus a secondary) ----
    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/patients/{patient_id}/diagnoses"),
        &pm_bearer,
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
        &pm_bearer,
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
        &pm_bearer,
        Some(json!({
            "items": [
                {
                    "kind": "radiology",
                    "title": "Röntgen-Thorax",
                    "performed_on": "01.03.2017",
                    "status": "pending",
                    "result": "Befund ausstehend",
                    "provider_id": provider_id.to_string(),
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
        &pm_bearer,
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

    // ---- Replace-all clears the diagnoses section without touching the others ----
    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/patients/{patient_id}/diagnoses"),
        &pm_bearer,
        Some(json!({ "items": [] })),
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
async fn patient_clinical_rejects_invalid_provider_doctor_attribution() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("patient-clinical-attr");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let pm_id = seed_user(&pool, &format!("{tag}-pm"), "patient_manager").await;
    seed_patient_assignment(&pool, patient_id, pm_id, admin_id).await;
    let pm_bearer = auth_header_for(pm_id, "patient_manager");

    let provider_id = seed_provider(&pool, &tag).await;
    let other_provider_id = seed_provider(&pool, &format!("{tag}-other")).await;
    // Doctor that belongs to `other_provider_id`, not `provider_id`.
    let foreign_doctor_id = seed_provider_doctor(&pool, other_provider_id, &tag).await;

    let post_diagnosis = |attribution: serde_json::Value| {
        let app = app.clone();
        let bearer = pm_bearer.clone();
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
        &pm_bearer,
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
    let pm_id = seed_user(&pool, &format!("{tag}-pm"), "patient_manager").await;
    seed_patient_assignment(&pool, patient_id, pm_id, admin_id).await;
    let pm_bearer = auth_header_for(pm_id, "patient_manager");

    let non_medical_provider_id =
        seed_provider_with_type(&pool, &format!("{tag}-travel"), "non_medical").await;
    let non_medical_doctor_id =
        seed_provider_doctor(&pool, non_medical_provider_id, &format!("{tag}-guide")).await;

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/patients/{patient_id}/medications"),
        &pm_bearer,
        Some(json!({
            "items": [
                {
                    "category": "dauer",
                    "handelsname": "Ibuprofen",
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
        &pm_bearer,
        Some(json!({
            "items": [
                {
                    "category": "dauer",
                    "handelsname": "Paracetamol",
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
        &pm_bearer,
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
    let pm_id = seed_user(&pool, &format!("{tag}-pm"), "patient_manager").await;
    seed_patient_assignment(&pool, patient_id, pm_id, admin_id).await;
    let pm_bearer = auth_header_for(pm_id, "patient_manager");

    // Before any save the narrative is absent.
    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/patients/{patient_id}/clinical"),
        &pm_bearer,
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
        &pm_bearer,
        Some(json!({
            "anamnese_aktuelle": "Fieber und Husten seit zwei Tagen.",
            "anamnese_sozial": "Lebt allein, mobil mit Gehstock.",
            "beurteilung": "Verdacht auf ambulant erworbene Pneumonie.",
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
        &pm_bearer,
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
        &pm_bearer,
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
        &pm_bearer,
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
        &pm_bearer,
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
        &pm_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let versions = body.as_array().expect("narrative history array");
    assert_eq!(versions.len(), 2);
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
        &pm_bearer,
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

    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/patients/{patient_id}/clinical"),
        &pm_bearer,
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
        &pm_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(body.is_null());

    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/patients/{patient_id}/clinical"),
        &pm_bearer,
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
    let pm_id = seed_user(&pool, &format!("{tag}-pm"), "patient_manager").await;
    seed_patient_assignment(&pool, patient_id, pm_id, admin_id).await;
    let pm_bearer = auth_header_for(pm_id, "patient_manager");

    let provider_id = seed_provider(&pool, &tag).await;
    let doctor_id = seed_provider_doctor(&pool, provider_id, &tag).await;

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/patients/{patient_id}/procedures"),
        &pm_bearer,
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
        &pm_bearer,
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
        &pm_bearer,
        Some(json!({ "items": [] })),
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
    assert_eq!(body["procedures"].as_array().expect("procedures").len(), 0);
}

#[tokio::test]
async fn patient_clinical_pdf_export_returns_pdf() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("patient-clinical-pdf");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let pm_id = seed_user(&pool, &format!("{tag}-pm"), "patient_manager").await;
    seed_patient_assignment(&pool, patient_id, pm_id, admin_id).await;
    let pm_bearer = auth_header_for(pm_id, "patient_manager");

    // Seed some content so the Arztbrief is non-empty.
    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/patients/{patient_id}/diagnoses"),
        &pm_bearer,
        Some(json!({ "items": [{ "kind": "main", "label": "Ambulant erworbene Pneumonie", "icd_code": "J15.9" }] })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/patients/{patient_id}/narrative"),
        &pm_bearer,
        Some(json!({ "beurteilung": "Verdacht auf Pneumonie." })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let request = Request::builder()
        .method("GET")
        .uri(format!("/api/v1/patients/{patient_id}/clinical.pdf"))
        .header("Authorization", &pm_bearer)
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
    let pm_id = seed_user(&pool, &format!("{tag}-pm"), "patient_manager").await;
    seed_patient_assignment(&pool, patient_id, pm_id, admin_id).await;
    let pm_bearer = auth_header_for(pm_id, "patient_manager");

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/patients/{patient_id}/medications"),
        &pm_bearer,
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
        .header("Authorization", &pm_bearer)
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
