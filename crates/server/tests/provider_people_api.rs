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
           VALUES ($1, $2, $3, '1990-01-01', 'diverse', $4, ARRAY['de']::text[])
           RETURNING id"#,
    )
    .bind(format!("PT-{tag}"))
    .bind("Provider")
    .bind(format!("People {tag}"))
    .bind(created_by)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn add_provider_specialization(
    pool: &PgPool,
    provider_id: Uuid,
    code: &str,
    is_primary: bool,
) {
    sqlx::query(
        r#"INSERT INTO provider_specializations (provider_id, specialization_id, is_primary)
           SELECT $1, id, $3
           FROM medical_specializations
           WHERE code = $2
           ON CONFLICT DO NOTHING"#,
    )
    .bind(provider_id)
    .bind(code)
    .bind(is_primary)
    .execute(pool)
    .await
    .unwrap();
}

#[tokio::test]
async fn provider_people_returns_doctors_staff_counts_and_patient_filter() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("provider-people");
    let pm_id = seed_user(&pool, &tag, "patient_manager").await;
    let bearer = auth_header_for(pm_id, "patient_manager");

    let provider_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO providers (name, provider_type, address_city, address_country, fachbereich)
           VALUES ($1, 'medical', 'Berlin', 'Germany', 'Cardiology')
           RETURNING id"#,
    )
    .bind(format!("People Clinic {tag}"))
    .fetch_one(&pool)
    .await
    .unwrap();

    let doctor_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO provider_doctors (
                provider_id, name, first_name, last_name, display_name,
                title, role_code, role_label, gender, fachbereich, email
           ) VALUES (
                $1, $2, 'Ada', $3, $2,
                'Dr.', 'chefarzt', 'Chief physician', 'female', 'Cardiology', $4
           )
           RETURNING id"#,
    )
    .bind(provider_id)
    .bind(format!("Dr People {tag}"))
    .bind(format!("Doctor {tag}"))
    .bind(format!("doctor-{tag}@clinic.example"))
    .fetch_one(&pool)
    .await
    .unwrap();

    sqlx::query(
        r#"INSERT INTO provider_doctor_specializations (doctor_id, specialization_id, is_primary)
           SELECT $1, id, TRUE
           FROM medical_specializations
           WHERE code = 'cardiology'
           ON CONFLICT DO NOTHING"#,
    )
    .bind(doctor_id)
    .execute(&pool)
    .await
    .unwrap();

    sqlx::query(
        r#"INSERT INTO provider_person_contacts (
                provider_id, doctor_id, contact_kind, contact_type, value, is_primary
           ) VALUES ($1, $2, 'email', 'work', $3, TRUE)"#,
    )
    .bind(provider_id)
    .bind(doctor_id)
    .bind(format!("doctor-contact-{tag}@clinic.example"))
    .execute(&pool)
    .await
    .unwrap();

    let staff_role = format!("staff_role_{}", Uuid::new_v4().simple());
    sqlx::query(
        r#"INSERT INTO provider_staff_roles (code, name_en, name_de, name_ru)
           VALUES ($1, 'English desk role', 'Empfang', 'Registratura')"#,
    )
    .bind(&staff_role)
    .execute(&pool)
    .await
    .unwrap();

    let staff_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO provider_staff (
                provider_id, first_name, last_name, display_name,
                role, department, gender, status, is_active
           ) VALUES (
                $1, 'Marta', $2, $3,
                $4, 'front desk', 'female', 'active', TRUE
           )
           RETURNING id"#,
    )
    .bind(provider_id)
    .bind(format!("Staff {tag}"))
    .bind(format!("Marta Staff {tag}"))
    .bind(&staff_role)
    .fetch_one(&pool)
    .await
    .unwrap();

    sqlx::query(
        r#"INSERT INTO provider_person_contacts (
                provider_id, staff_id, contact_kind, contact_type, value, is_primary
           ) VALUES ($1, $2, 'phone', 'work', '+49 30 123456', TRUE)"#,
    )
    .bind(provider_id)
    .bind(staff_id)
    .execute(&pool)
    .await
    .unwrap();

    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    sqlx::query(
        r#"INSERT INTO appointments (
                patient_id, provider_id, doctor_id, appointment_type, title, date, status, created_by
           ) VALUES (
                $1, $2, $3, 'medical', 'Provider people appointment', CURRENT_DATE, 'planned', $4
           )"#,
    )
    .bind(patient_id)
    .bind(provider_id)
    .bind(doctor_id)
    .bind(pm_id)
    .execute(&pool)
    .await
    .unwrap();

    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/provider-people?provider_id={provider_id}&person_type=all&search={tag}"),
        &bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let items = body.as_array().expect("provider people array");
    let doctor = items
        .iter()
        .find(|item| item["person_type"] == "doctor" && item["doctor_id"] == doctor_id.to_string())
        .expect("doctor read model");
    assert_eq!(doctor["provider"]["id"], provider_id.to_string());
    assert_eq!(doctor["title"], "Dr.");
    assert_eq!(doctor["role_code"], "chefarzt");
    assert_eq!(doctor["role_label"], "Chief physician");
    assert_eq!(doctor["gender"], "female");
    assert_eq!(doctor["patient_count"], 1);
    assert_eq!(doctor["appointment_count"], 1);
    assert_eq!(doctor["specializations"][0]["code"], "cardiology");
    assert_eq!(
        doctor["contacts"][0]["value"],
        format!("doctor-contact-{tag}@clinic.example")
    );

    let staff = items
        .iter()
        .find(|item| item["person_type"] == "staff" && item["staff_id"] == staff_id.to_string())
        .expect("staff read model");
    assert_eq!(staff["provider"]["id"], provider_id.to_string());
    assert_eq!(staff["role"], staff_role);
    assert_eq!(staff["role_code"], staff_role);
    assert_eq!(staff["role_label"], "Empfang");
    assert_eq!(
        staff["role_label_key"],
        format!("provider_staff_role.{staff_role}")
    );
    assert_eq!(staff["role_name_de"], "Empfang");
    assert_eq!(staff["gender"], "female");
    assert_eq!(staff["patient_count"], 0);
    assert_eq!(staff["appointment_count"], 0);
    assert_eq!(staff["contacts"][0]["value"], "+49 30 123456");

    let (status, fachbereich_body) = json_request(
        &app,
        "GET",
        &format!(
            "/api/v1/provider-people?provider_id={provider_id}&person_type=doctor&fachbereich=Cardiology&gender=female"
        ),
        &bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let fachbereich_items = fachbereich_body
        .as_array()
        .expect("fachbereich filtered array");
    assert_eq!(fachbereich_items.len(), 1);
    assert_eq!(fachbereich_items[0]["doctor_id"], doctor_id.to_string());

    let (status, no_match_body) = json_request(
        &app,
        "GET",
        &format!(
            "/api/v1/provider-people?provider_id={provider_id}&person_type=doctor&fachbereich=Neurology"
        ),
        &bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(no_match_body.as_array().expect("no-match array").len(), 0);

    let (status, staff_role_body) = json_request(
        &app,
        "GET",
        &format!(
            "/api/v1/provider-people?provider_id={provider_id}&person_type=staff&role={staff_role}"
        ),
        &bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let staff_role_items = staff_role_body.as_array().expect("staff role array");
    assert_eq!(staff_role_items.len(), 1);
    assert_eq!(staff_role_items[0]["staff_id"], staff_id.to_string());

    let (status, patient_body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/provider-people?person_type=all&patient_id={patient_id}"),
        &bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let patient_items = patient_body.as_array().expect("patient filtered array");
    assert_eq!(patient_items.len(), 1);
    assert_eq!(patient_items[0]["person_type"], "doctor");
    assert_eq!(patient_items[0]["doctor_id"], doctor_id.to_string());
}

#[tokio::test]
async fn provider_doctor_accepts_academic_title_combinations_and_keeps_salutation_in_gender() {
    let Some((app, pool, _admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("provider-doctor-title");
    let pm_id = seed_user(&pool, &tag, "patient_manager").await;
    let bearer = auth_header_for(pm_id, "patient_manager");

    let provider_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO providers (name, provider_type, address_city, address_country, fachbereich)
           VALUES ($1, 'medical', 'Berlin', 'Germany', 'Cardiology')
           RETURNING id"#,
    )
    .bind(format!("Title Clinic {tag}"))
    .fetch_one(&pool)
    .await
    .unwrap();

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/providers/{provider_id}/doctors"),
        &bearer,
        Some(json!({
            "first_name": "Anna",
            "last_name": format!("Title {tag}"),
            "title": "Priv.-Doz. Dr. med.",
            "gender": "female",
            "specializations": ["Cardiology"],
            "contacts": [],
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let doctor_id = Uuid::parse_str(body["id"].as_str().unwrap()).unwrap();

    let (saved_title, saved_gender): (Option<String>, String) =
        sqlx::query_as("SELECT title, gender FROM provider_doctors WHERE id = $1")
            .bind(doctor_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(saved_title.as_deref(), Some("Priv.-Doz. Dr. med."));
    assert_eq!(saved_gender, "female");

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/providers/{provider_id}/doctors/{doctor_id}/update"),
        &bearer,
        Some(json!({
            "first_name": "Max",
            "last_name": format!("Title {tag}"),
            "title": "Prof., Dr.",
            "gender": "male",
            "specializations": ["Cardiology"],
            "contacts": [],
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (updated_title, updated_gender): (Option<String>, String) =
        sqlx::query_as("SELECT title, gender FROM provider_doctors WHERE id = $1")
            .bind(doctor_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(updated_title.as_deref(), Some("Prof. Dr."));
    assert_eq!(updated_gender, "male");

    let (status, invalid_body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/providers/{provider_id}/doctors"),
        &bearer,
        Some(json!({
            "first_name": "Frau",
            "last_name": format!("WrongField {tag}"),
            "title": "Frau Dr. med.",
            "gender": "female",
            "contacts": [],
        })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    let message = invalid_body["message"].as_str().unwrap_or_default();
    assert!(message.contains("academic titles"));
    assert!(message.contains("Herr/Frau"));
}

#[tokio::test]
async fn provider_specializations_filter_matches_any_selected_specialization() {
    let Some((app, pool, _admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("provider-specializations-filter");
    let pm_id = seed_user(&pool, &tag, "patient_manager").await;
    let bearer = auth_header_for(pm_id, "patient_manager");

    let provider_both: Uuid = sqlx::query_scalar(
        r#"INSERT INTO providers (name, provider_type, address_city, address_country)
           VALUES ($1, 'medical', 'Berlin', 'Germany')
           RETURNING id"#,
    )
    .bind(format!("Specialization Both {tag}"))
    .fetch_one(&pool)
    .await
    .unwrap();
    add_provider_specialization(&pool, provider_both, "kardiologie", true).await;
    add_provider_specialization(&pool, provider_both, "neurologie", false).await;

    let provider_kardiologie_only: Uuid = sqlx::query_scalar(
        r#"INSERT INTO providers (name, provider_type, address_city, address_country)
           VALUES ($1, 'medical', 'Berlin', 'Germany')
           RETURNING id"#,
    )
    .bind(format!("Specialization Kardiologie Only {tag}"))
    .fetch_one(&pool)
    .await
    .unwrap();
    add_provider_specialization(&pool, provider_kardiologie_only, "kardiologie", true).await;

    let provider_radiologie_only: Uuid = sqlx::query_scalar(
        r#"INSERT INTO providers (name, provider_type, address_city, address_country)
           VALUES ($1, 'medical', 'Berlin', 'Germany')
           RETURNING id"#,
    )
    .bind(format!("Specialization Radiologie Only {tag}"))
    .fetch_one(&pool)
    .await
    .unwrap();
    add_provider_specialization(&pool, provider_radiologie_only, "radiologie", true).await;

    let (status, body) = json_request(
        &app,
        "GET",
        &format!(
            "/api/v1/providers?search={tag}&provider_type=medical&specializations=kardiologie,neurologie"
        ),
        &bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let items = body.as_array().expect("providers array");
    assert!(
        items
            .iter()
            .any(|item| item["id"] == provider_both.to_string())
    );
    assert!(
        items
            .iter()
            .any(|item| item["id"] == provider_kardiologie_only.to_string())
    );
    assert!(
        !items
            .iter()
            .any(|item| item["id"] == provider_radiologie_only.to_string())
    );
}

#[tokio::test]
async fn provider_people_rejects_patient_role() {
    let Some((app, pool, _admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("provider-people-auth");
    let patient_user_id = seed_user(&pool, &tag, "patient").await;
    let bearer = auth_header_for(patient_user_id, "patient");

    let (status, body) = json_request(&app, "GET", "/api/v1/provider-people", &bearer, None).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(body["message"], "Insufficient permissions");
}
