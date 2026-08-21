mod support;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use serde_json::{Value, json};
use sqlx::{PgPool, Row};
use tower::ServiceExt;
use uuid::Uuid;

use gmed_server::auth::jwt;

const TEST_SECRET: &str = "test-secret-at-least-32-characters-long!!";

fn auth_header_for(user_id: Uuid, role: &str) -> String {
    let token = jwt::issue_access_token(TEST_SECRET, user_id, role, Uuid::new_v4()).unwrap();
    format!("Bearer {token}")
}

async fn post(
    app: &axum::Router,
    path: &str,
    bearer: &str,
    request_id: Uuid,
) -> (StatusCode, Value) {
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(path)
                .header("Authorization", bearer)
                .header("Content-Type", "application/json")
                .body(Body::from(
                    serde_json::to_vec(&json!({ "request_id": request_id })).unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    let status = response.status();
    let bytes = axum::body::to_bytes(response.into_body(), 1024 * 1024)
        .await
        .unwrap();
    let payload = serde_json::from_slice(&bytes).unwrap_or(json!(null));
    (status, payload)
}

async fn seed_user(pool: &PgPool, role: &str, tag: &str) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO users (email, password_hash, name, role)
           VALUES ($1, 'test-hash', $2, $3)
           RETURNING id"#,
    )
    .bind(format!("repeat-{tag}@example.test"))
    .bind(format!("Repeat {tag}"))
    .bind(role)
    .fetch_one(pool)
    .await
    .unwrap()
}

#[tokio::test]
async fn repeat_intake_creates_a_distinct_prefilled_lead_and_case_for_the_same_patient() {
    let Some(ctx) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let tag = Uuid::new_v4().simple().to_string();
    let patient_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO patients (
               patient_id, first_name, last_name, birth_date, gender,
               residence_country, languages, phone_primary, email,
               address_street, address_city, address_zip,
               insurance_provider, insurance_number, insurance_type,
               emergency_contact_name, emergency_contact_phone,
               emergency_contact_relation, created_by
           ) VALUES (
               $1, 'Anna', 'Repeat', '1985-04-12', 'female',
               'Germany', ARRAY['de', 'en'], '+49 89 111', $2,
               'Testweg 2', 'München', '80331',
               'Test Versicherung', 'POL-7', 'private',
               'Max Repeat', '+49 89 222', 'spouse', $3
           )
           RETURNING id"#,
    )
    .bind(format!("REPEAT-{tag}"))
    .bind(format!("anna-{tag}@example.test"))
    .bind(ctx.admin_id)
    .fetch_one(&ctx.pool)
    .await
    .unwrap();
    let path = format!("/api/v1/patients/{patient_id}/repeat-intake");
    let bearer = auth_header_for(ctx.admin_id, "ceo");

    let first_request_id = Uuid::new_v4();
    let (first_status, first) = post(&ctx.app, &path, &bearer, first_request_id).await;
    assert_eq!(first_status, StatusCode::CREATED, "{first}");
    assert_eq!(first["request_id"], first_request_id.to_string());
    assert_eq!(first["idempotent_replay"], false);

    let (replay_status, replay) = post(&ctx.app, &path, &bearer, first_request_id).await;
    assert_eq!(replay_status, StatusCode::OK, "{replay}");
    assert_eq!(replay["id"], first["id"]);
    assert_eq!(replay["case_id"], first["case_id"]);
    assert_eq!(replay["idempotent_replay"], true);

    let second_request_id = Uuid::new_v4();
    let (second_status, second) = post(&ctx.app, &path, &bearer, second_request_id).await;
    assert_eq!(second_status, StatusCode::CREATED, "{second}");
    assert_ne!(first["id"], second["id"]);
    assert_ne!(first["case_id"], second["case_id"]);
    assert_eq!(first["patient_id"], patient_id.to_string());

    let lead_id = Uuid::parse_str(first["id"].as_str().expect("lead id")).unwrap();
    let lead = sqlx::query(
        r#"SELECT first_name, last_name, date_of_birth, legal_sex,
                  email, phone, country, street_address, city, zip_code,
                  primary_language, has_insurance, insurance_provider,
                  insurance_number, insurance_type, source, flow, intake_model,
                  prospect_patient_id, wizard_state, primary_concern_text, services
           FROM leads
           WHERE id = $1"#,
    )
    .bind(lead_id)
    .fetch_one(&ctx.pool)
    .await
    .unwrap();
    assert_eq!(lead.try_get::<String, _>("first_name").unwrap(), "Anna");
    assert_eq!(lead.try_get::<String, _>("last_name").unwrap(), "Repeat");
    assert_eq!(lead.try_get::<String, _>("legal_sex").unwrap(), "female");
    assert_eq!(lead.try_get::<String, _>("primary_language").unwrap(), "de");
    assert!(lead.try_get::<bool, _>("has_insurance").unwrap());
    assert_eq!(
        lead.try_get::<String, _>("source").unwrap(),
        "existing_patient"
    );
    assert_eq!(lead.try_get::<String, _>("flow").unwrap(), "repeat_patient");
    assert_eq!(
        lead.try_get::<String, _>("intake_model").unwrap(),
        "patient_first"
    );
    assert_eq!(
        lead.try_get::<Uuid, _>("prospect_patient_id").unwrap(),
        patient_id
    );
    assert_eq!(
        lead.try_get::<Value, _>("wizard_state").unwrap()["repeat_patient_id"],
        patient_id.to_string()
    );
    assert_eq!(
        lead.try_get::<Value, _>("wizard_state").unwrap()["repeat_intake_request_id"],
        first_request_id.to_string()
    );
    assert!(
        lead.try_get::<Option<String>, _>("primary_concern_text")
            .unwrap()
            .is_none(),
        "case-specific concern must not be copied from an old intake"
    );
    assert!(
        lead.try_get::<Vec<String>, _>("services")
            .unwrap()
            .is_empty()
    );

    let case_id = Uuid::parse_str(first["case_id"].as_str().expect("case id")).unwrap();
    let (case_patient_id, case_source_lead_id): (Uuid, Uuid) =
        sqlx::query_as("SELECT patient_id, source_lead_id FROM cases WHERE id = $1")
            .bind(case_id)
            .fetch_one(&ctx.pool)
            .await
            .unwrap();
    assert_eq!(case_patient_id, patient_id);
    assert_eq!(case_source_lead_id, lead_id);

    let manager_id = seed_user(&ctx.pool, "patient_manager", &format!("manager-{tag}")).await;
    let manager_bearer = auth_header_for(manager_id, "patient_manager");
    let (unassigned_status, unassigned) =
        post(&ctx.app, &path, &manager_bearer, Uuid::new_v4()).await;
    assert_eq!(unassigned_status, StatusCode::FORBIDDEN, "{unassigned}");
    sqlx::query(
        r#"INSERT INTO patient_assignments (patient_id, user_id, assigned_by)
           VALUES ($1, $2, $3)"#,
    )
    .bind(patient_id)
    .bind(manager_id)
    .bind(ctx.admin_id)
    .execute(&ctx.pool)
    .await
    .unwrap();
    let (assigned_status, assigned) = post(&ctx.app, &path, &manager_bearer, Uuid::new_v4()).await;
    assert_eq!(assigned_status, StatusCode::CREATED, "{assigned}");
    assert_eq!(assigned["patient_id"], patient_id.to_string());

    let doctor_id = seed_user(&ctx.pool, "doctor", &tag).await;
    let (forbidden_status, forbidden) = post(
        &ctx.app,
        &path,
        &auth_header_for(doctor_id, "doctor"),
        Uuid::new_v4(),
    )
    .await;
    assert_eq!(forbidden_status, StatusCode::FORBIDDEN, "{forbidden}");
}
