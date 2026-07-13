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

async fn taxonomy_node_id(pool: &PgPool, code: &str) -> Uuid {
    sqlx::query_scalar("SELECT id FROM provider_taxonomy_nodes WHERE code = $1")
        .bind(code)
        .fetch_one(pool)
        .await
        .unwrap()
}

async fn seed_insurance_provider(pool: &PgPool, name: &str) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO insurance_providers (name)
           VALUES ($1)
           ON CONFLICT (normalized_name)
           DO UPDATE SET name = EXCLUDED.name
           RETURNING id"#,
    )
    .bind(name)
    .fetch_one(pool)
    .await
    .unwrap()
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
    let clinic_taxonomy_id =
        taxonomy_node_id(&pool, "medical_clinics_practices_specialized_centers").await;
    let clinic_parent_taxonomy_id: Uuid =
        sqlx::query_scalar("SELECT parent_id FROM provider_taxonomy_nodes WHERE id = $1")
            .bind(clinic_taxonomy_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    let pharmacy_taxonomy_id = taxonomy_node_id(&pool, "medical_pharmacies").await;
    sqlx::query(
        r#"INSERT INTO provider_taxonomy_assignments (provider_id, taxonomy_node_id, is_primary)
           VALUES ($1, $2, TRUE)
           ON CONFLICT (provider_id, taxonomy_node_id)
           DO UPDATE SET is_primary = EXCLUDED.is_primary"#,
    )
    .bind(provider_id)
    .bind(clinic_taxonomy_id)
    .execute(&pool)
    .await
    .unwrap();

    let doctor_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO provider_doctors (
                provider_id, name, first_name, last_name, display_name,
                title, role_code, role_label, website, schwerpunkt, gender, fachbereich, email
           ) VALUES (
                $1, $2, 'Ada', $3, $2,
                'Dr.', 'chefarzt', 'Chief physician', $4, $5, 'female', 'Cardiology', $6
           )
           RETURNING id"#,
    )
    .bind(provider_id)
    .bind(format!("Dr People {tag}"))
    .bind(format!("Doctor {tag}"))
    .bind("https://people-doctor.example")
    .bind("Interventionelle Kardiologie")
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
    let diagnosis_patient_id = seed_patient(&pool, admin_id, &format!("{tag}-diagnosis")).await;
    sqlx::query(
        r#"INSERT INTO patient_diagnoses (
                patient_id, provider_id, treating_doctor_id,
                kind, label, certainty, status, source_mode
           ) VALUES (
                $1, $2, $3, 'main', $4, 'bestaetigt', 'active', 'intern'
           )"#,
    )
    .bind(diagnosis_patient_id)
    .bind(provider_id)
    .bind(doctor_id)
    .bind(format!("Provider people diagnosis {tag}"))
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
    assert_eq!(doctor["website"], "https://people-doctor.example");
    assert_eq!(doctor["schwerpunkt"], "Interventionelle Kardiologie");
    assert_eq!(doctor["gender"], "female");
    assert_eq!(doctor["patient_count"], 2);
    assert_eq!(doctor["appointment_count"], 1);
    let linked_patients = doctor["linked_patients"]
        .as_array()
        .expect("doctor linked patients");
    assert_eq!(linked_patients.len(), 2);
    assert!(
        linked_patients
            .iter()
            .any(|item| item["id"] == patient_id.to_string())
    );
    assert!(
        linked_patients
            .iter()
            .any(|item| item["id"] == diagnosis_patient_id.to_string())
    );
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

    let (status, taxonomy_body) = json_request(
        &app,
        "GET",
        &format!(
            "/api/v1/provider-people?person_type=all&search={tag}&provider_taxonomy_node_id={clinic_parent_taxonomy_id}"
        ),
        &bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let taxonomy_items = taxonomy_body.as_array().expect("taxonomy filtered array");
    assert!(
        taxonomy_items
            .iter()
            .any(|item| item["doctor_id"] == doctor_id.to_string()),
        "doctor must be listed through parent taxonomy filter"
    );
    assert!(
        taxonomy_items
            .iter()
            .any(|item| item["staff_id"] == staff_id.to_string()),
        "staff must be listed through parent taxonomy filter"
    );

    let (status, wrong_taxonomy_body) = json_request(
        &app,
        "GET",
        &format!(
            "/api/v1/provider-people?person_type=all&search={tag}&provider_taxonomy_node_id={pharmacy_taxonomy_id}"
        ),
        &bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        wrong_taxonomy_body
            .as_array()
            .expect("wrong taxonomy filtered array")
            .len(),
        0
    );

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
async fn concierge_provider_people_is_scoped_to_non_medical_providers() {
    let Some((app, pool, _admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("provider-people-concierge");
    let concierge_id = seed_user(&pool, &tag, "concierge").await;
    let bearer = auth_header_for(concierge_id, "concierge");

    let medical_provider_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO providers (name, provider_type, address_city, address_country)
           VALUES ($1, 'medical', 'Berlin', 'Germany')
           RETURNING id"#,
    )
    .bind(format!("Medical People {tag}"))
    .fetch_one(&pool)
    .await
    .unwrap();
    let non_medical_provider_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO providers (name, provider_type, address_city, address_country)
           VALUES ($1, 'non_medical', 'Munich', 'Germany')
           RETURNING id"#,
    )
    .bind(format!("Service People {tag}"))
    .fetch_one(&pool)
    .await
    .unwrap();

    sqlx::query(
        r#"INSERT INTO provider_doctors (provider_id, name, first_name, last_name, display_name, gender)
           VALUES ($1, $2, 'Medi', $3, $2, 'unknown')"#,
    )
    .bind(medical_provider_id)
    .bind(format!("Medical Contact {tag}"))
    .bind(format!("Doctor {tag}"))
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        r#"INSERT INTO provider_doctors (provider_id, name, first_name, last_name, display_name, gender)
           VALUES ($1, $2, 'Ops', $3, $2, 'unknown')"#,
    )
    .bind(non_medical_provider_id)
    .bind(format!("Service Contact {tag}"))
    .bind(format!("Contact {tag}"))
    .execute(&pool)
    .await
    .unwrap();

    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/provider-people?person_type=all&provider_type=medical&search={tag}"),
        &bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let items = body.as_array().expect("provider people array");
    assert!(!items.is_empty());
    assert!(
        items
            .iter()
            .all(|item| item["provider_type"] == "non_medical"),
        "concierge must not see medical provider people: {items:?}"
    );
    assert!(
        items
            .iter()
            .any(|item| item["provider_id"] == non_medical_provider_id.to_string())
    );
    assert!(
        items
            .iter()
            .all(|item| item["provider_id"] != medical_provider_id.to_string())
    );

    let (status, providers_body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/providers?provider_type=medical&search={tag}"),
        &bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let providers = providers_body.as_array().expect("providers array");
    assert!(!providers.is_empty());
    assert!(
        providers
            .iter()
            .all(|item| item["provider_type"] == "non_medical"),
        "concierge provider list must stay non-medical: {providers:?}"
    );

    let (status, _) = json_request(
        &app,
        "GET",
        &format!("/api/v1/providers/{medical_provider_id}"),
        &bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    let (status, non_medical_detail) = json_request(
        &app,
        "GET",
        &format!("/api/v1/providers/{non_medical_provider_id}"),
        &bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(non_medical_detail["provider_type"], "non_medical");
}

#[tokio::test]
async fn provider_people_filters_doctors_by_insurance_provider() {
    let Some((app, pool, _admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("provider-people-insurance");
    let pm_id = seed_user(&pool, &tag, "patient_manager").await;
    let bearer = auth_header_for(pm_id, "patient_manager");

    let provider_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO providers (name, provider_type, address_city, address_country, fachbereich)
           VALUES ($1, 'medical', 'Berlin', 'Germany', 'Cardiology')
           RETURNING id"#,
    )
    .bind(format!("Insurance People Clinic {tag}"))
    .fetch_one(&pool)
    .await
    .unwrap();

    let matching_doctor_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO provider_doctors (provider_id, name, display_name)
           VALUES ($1, $2, $2)
           RETURNING id"#,
    )
    .bind(provider_id)
    .bind(format!("Insurance Match Doctor {tag}"))
    .fetch_one(&pool)
    .await
    .unwrap();
    let decoy_doctor_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO provider_doctors (provider_id, name, display_name)
           VALUES ($1, $2, $2)
           RETURNING id"#,
    )
    .bind(provider_id)
    .bind(format!("Insurance Decoy Doctor {tag}"))
    .fetch_one(&pool)
    .await
    .unwrap();
    let second_matching_doctor_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO provider_doctors (provider_id, name, display_name)
           VALUES ($1, $2, $2)
           RETURNING id"#,
    )
    .bind(provider_id)
    .bind(format!("Insurance Second Match Doctor {tag}"))
    .fetch_one(&pool)
    .await
    .unwrap();

    let insurance_id = seed_insurance_provider(&pool, &format!("People Insurance {tag}")).await;
    let second_insurance_id =
        seed_insurance_provider(&pool, &format!("Second People Insurance {tag}")).await;
    sqlx::query(
        r#"INSERT INTO provider_doctor_insurances (doctor_id, insurance_provider_id)
           VALUES ($1, $2)"#,
    )
    .bind(matching_doctor_id)
    .bind(insurance_id)
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        r#"INSERT INTO provider_doctor_insurances (doctor_id, insurance_provider_id)
           VALUES ($1, $2)"#,
    )
    .bind(second_matching_doctor_id)
    .bind(second_insurance_id)
    .execute(&pool)
    .await
    .unwrap();

    let (status, body) = json_request(
        &app,
        "GET",
        &format!(
            "/api/v1/provider-people?search={tag}&person_type=doctor&insurance_provider=People%20Insurance"
        ),
        &bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let items = body.as_array().expect("provider people array");
    assert!(
        items
            .iter()
            .any(|row| row["person_id"] == matching_doctor_id.to_string())
    );
    assert!(
        !items
            .iter()
            .any(|row| row["person_id"] == decoy_doctor_id.to_string())
    );
    let row = items
        .iter()
        .find(|row| row["person_id"] == matching_doctor_id.to_string())
        .expect("matching doctor row must be present");
    assert_eq!(
        row["insurance_providers"][0]["name"],
        format!("People Insurance {tag}")
    );

    let (status, body) = json_request(
        &app,
        "GET",
        &format!(
            "/api/v1/provider-people?search={tag}&person_type=doctor&insurance_provider=People%20Insurance%2C%20Second%20People%20Insurance"
        ),
        &bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let items = body.as_array().expect("provider people array");
    assert!(
        items
            .iter()
            .any(|row| row["person_id"] == matching_doctor_id.to_string())
    );
    assert!(
        items
            .iter()
            .any(|row| row["person_id"] == second_matching_doctor_id.to_string())
    );
    assert!(
        !items
            .iter()
            .any(|row| row["person_id"] == decoy_doctor_id.to_string())
    );
}

#[tokio::test]
async fn existing_doctor_can_be_linked_to_another_provider_with_shared_identity() {
    let Some((app, pool, _admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("provider-doctor-identity");
    let pm_id = seed_user(&pool, &tag, "patient_manager").await;
    let bearer = auth_header_for(pm_id, "patient_manager");

    let source_provider_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO providers (name, provider_type, address_city, address_country, fachbereich)
           VALUES ($1, 'medical', 'Berlin', 'Germany', 'Cardiology')
           RETURNING id"#,
    )
    .bind(format!("Source Clinic {tag}"))
    .fetch_one(&pool)
    .await
    .unwrap();
    let target_provider_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO providers (name, provider_type, address_city, address_country, fachbereich)
           VALUES ($1, 'medical', 'Munich', 'Germany', 'Cardiology')
           RETURNING id"#,
    )
    .bind(format!("Target Clinic {tag}"))
    .fetch_one(&pool)
    .await
    .unwrap();

    let (status, source_body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/providers/{source_provider_id}/doctors"),
        &bearer,
        Some(json!({
            "name": format!("Dr Shared {tag}"),
            "first_name": "Shared",
            "last_name": tag,
            "display_name": format!("Dr Shared {tag}"),
            "title": "Dr.",
            "gender": "female",
            "fachbereich": "Cardiology"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let source_doctor_id = source_body["id"].as_str().expect("source doctor id");
    let shared_identity_id = source_body["shared_identity_id"]
        .as_str()
        .expect("source shared identity id");

    let (status, people_body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/provider-people?provider_id={source_provider_id}&person_type=doctor&search={tag}"),
        &bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let source_people = people_body.as_array().expect("provider people array");
    assert!(source_people.iter().any(|row| {
        row["doctor_id"] == source_doctor_id && row["shared_identity_id"] == shared_identity_id
    }));

    let (status, linked_body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/providers/{target_provider_id}/doctors"),
        &bearer,
        Some(json!({
            "shared_identity_id": shared_identity_id,
            "name": format!("Dr Shared {tag}"),
            "first_name": "Shared",
            "last_name": tag,
            "display_name": format!("Dr Shared {tag}"),
            "title": "Dr.",
            "gender": "female",
            "fachbereich": "Cardiology"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(linked_body["id"], source_doctor_id);
    assert_eq!(linked_body["shared_identity_id"], shared_identity_id);

    let linked_doctor_id = linked_body["id"].as_str().expect("linked doctor id");
    let linked_identity_id: Uuid =
        sqlx::query_scalar("SELECT shared_identity_id FROM provider_doctors WHERE id = $1")
            .bind(Uuid::parse_str(linked_doctor_id).unwrap())
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(linked_identity_id.to_string(), shared_identity_id);
    let doctor_row_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM provider_doctors WHERE shared_identity_id = $1")
            .bind(Uuid::parse_str(shared_identity_id).unwrap())
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(doctor_row_count, 1);
    let link_row_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM provider_doctor_links WHERE doctor_id = $1")
            .bind(Uuid::parse_str(source_doctor_id).unwrap())
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(link_row_count, 2);

    let (status, target_people_body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/provider-people?provider_id={target_provider_id}&person_type=doctor&search={tag}"),
        &bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let target_people = target_people_body
        .as_array()
        .expect("target provider people array");
    let target_provider_id_text = target_provider_id.to_string();
    assert!(
        target_people
            .iter()
            .any(|row| row["doctor_id"] == source_doctor_id
                && row["provider_id"].as_str() == Some(target_provider_id_text.as_str()))
    );

    let (status, duplicate_body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/providers/{target_provider_id}/doctors"),
        &bearer,
        Some(json!({
            "shared_identity_id": shared_identity_id,
            "name": format!("Dr Shared Duplicate {tag}"),
            "title": "Dr.",
            "gender": "female"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(
        duplicate_body["message"],
        "Doctor is already linked to this provider"
    );
}

#[tokio::test]
async fn doctor_relationship_creation_adds_reciprocal_link() {
    let Some((app, pool, _admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("provider-doctor-reciprocal");
    let pm_id = seed_user(&pool, &tag, "patient_manager").await;
    let bearer = auth_header_for(pm_id, "patient_manager");

    let provider_a_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO providers (name, provider_type, address_city, address_country)
           VALUES ($1, 'medical', 'Berlin', 'Germany')
           RETURNING id"#,
    )
    .bind(format!("Relationship Source Clinic {tag}"))
    .fetch_one(&pool)
    .await
    .unwrap();
    let provider_b_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO providers (name, provider_type, address_city, address_country)
           VALUES ($1, 'medical', 'Munich', 'Germany')
           RETURNING id"#,
    )
    .bind(format!("Relationship Target Clinic {tag}"))
    .fetch_one(&pool)
    .await
    .unwrap();

    let doctor_a_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO provider_doctors (provider_id, name, display_name, title)
           VALUES ($1, $2, $2, 'Dr.')
           RETURNING id"#,
    )
    .bind(provider_a_id)
    .bind(format!("Doctor A {tag}"))
    .fetch_one(&pool)
    .await
    .unwrap();
    let doctor_b_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO provider_doctors (provider_id, name, display_name, title)
           VALUES ($1, $2, $2, 'Dr.')
           RETURNING id"#,
    )
    .bind(provider_b_id)
    .bind(format!("Doctor B {tag}"))
    .fetch_one(&pool)
    .await
    .unwrap();

    let (status, created) = json_request(
        &app,
        "POST",
        &format!("/api/v1/providers/{provider_a_id}/doctors/{doctor_a_id}/relationships"),
        &bearer,
        Some(json!({
            "target_doctor_id": doctor_b_id,
            "target_provider_id": provider_b_id,
            "relationship_type": "referral",
            "description": "works together",
            "notes": "mirror expected"
        })),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::CREATED,
        "create relationship: {created:?}"
    );
    let relationship_id = created["id"].as_str().expect("relationship id");

    let (status, source_relationships) = json_request(
        &app,
        "GET",
        &format!("/api/v1/providers/{provider_a_id}/doctors/{doctor_a_id}/relationships"),
        &bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let source_items = source_relationships
        .as_array()
        .expect("source relationships array");
    assert!(source_items.iter().any(|relationship| {
        relationship["id"] == relationship_id
            && relationship["source_doctor_id"] == doctor_a_id.to_string()
            && relationship["target_doctor_id"] == doctor_b_id.to_string()
            && relationship["relationship_type"] == "referral"
    }));

    let (status, reciprocal_relationships) = json_request(
        &app,
        "GET",
        &format!("/api/v1/providers/{provider_b_id}/doctors/{doctor_b_id}/relationships"),
        &bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let reciprocal_items = reciprocal_relationships
        .as_array()
        .expect("reciprocal relationships array");
    assert!(reciprocal_items.iter().any(|relationship| {
        relationship["source_doctor_id"] == doctor_b_id.to_string()
            && relationship["target_doctor_id"] == doctor_a_id.to_string()
            && relationship["target_provider_id"] == provider_a_id.to_string()
            && relationship["relationship_type"] == "referral"
            && relationship["description"] == "works together"
            && relationship["notes"] == "mirror expected"
    }));

    let (status, body) = json_request(
        &app,
        "POST",
        &format!(
            "/api/v1/providers/{provider_a_id}/doctors/{doctor_a_id}/relationships/{relationship_id}/update"
        ),
        &bearer,
        Some(json!({
            "target_doctor_id": doctor_b_id,
            "target_provider_id": provider_b_id,
            "relationship_type": "approach_via",
            "description": "updated route",
            "notes": "updated mirror"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "update relationship: {body:?}");

    let (status, reciprocal_relationships) = json_request(
        &app,
        "GET",
        &format!("/api/v1/providers/{provider_b_id}/doctors/{doctor_b_id}/relationships"),
        &bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let reciprocal_items = reciprocal_relationships
        .as_array()
        .expect("reciprocal relationships array");
    assert!(!reciprocal_items.iter().any(|relationship| {
        relationship["target_doctor_id"] == doctor_a_id.to_string()
            && relationship["relationship_type"] == "referral"
    }));
    assert!(reciprocal_items.iter().any(|relationship| {
        relationship["source_doctor_id"] == doctor_b_id.to_string()
            && relationship["target_doctor_id"] == doctor_a_id.to_string()
            && relationship["relationship_type"] == "approach_via"
            && relationship["description"] == "updated route"
            && relationship["notes"] == "updated mirror"
    }));

    let (status, body) = json_request(
        &app,
        "POST",
        &format!(
            "/api/v1/providers/{provider_a_id}/doctors/{doctor_a_id}/relationships/{relationship_id}/delete"
        ),
        &bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "delete relationship: {body:?}");

    let (status, source_relationships) = json_request(
        &app,
        "GET",
        &format!("/api/v1/providers/{provider_a_id}/doctors/{doctor_a_id}/relationships"),
        &bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(
        source_relationships
            .as_array()
            .expect("source relationships array")
            .is_empty()
    );

    let (status, reciprocal_relationships) = json_request(
        &app,
        "GET",
        &format!("/api/v1/providers/{provider_b_id}/doctors/{doctor_b_id}/relationships"),
        &bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(
        reciprocal_relationships
            .as_array()
            .expect("reciprocal relationships array")
            .is_empty()
    );
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
            "website": "https://title-doctor.example",
            "schwerpunkt": "Rhythmologie",
            "specializations": ["Cardiology"],
            "contacts": [],
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let doctor_id = Uuid::parse_str(body["id"].as_str().unwrap()).unwrap();

    let (saved_title, saved_gender, saved_website, saved_schwerpunkt): (
        Option<String>,
        String,
        Option<String>,
        Option<String>,
    ) = sqlx::query_as(
        "SELECT title, gender, website, schwerpunkt FROM provider_doctors WHERE id = $1",
    )
    .bind(doctor_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(saved_title.as_deref(), Some("Priv.-Doz. Dr. med."));
    assert_eq!(saved_gender, "female");
    assert_eq!(
        saved_website.as_deref(),
        Some("https://title-doctor.example")
    );
    assert_eq!(saved_schwerpunkt.as_deref(), Some("Rhythmologie"));

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
            "website": "https://updated-title-doctor.example",
            "schwerpunkt": "Interventionelle Kardiologie",
            "specializations": ["Cardiology"],
            "contacts": [],
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (updated_title, updated_gender, updated_website, updated_schwerpunkt): (
        Option<String>,
        String,
        Option<String>,
        Option<String>,
    ) = sqlx::query_as(
        "SELECT title, gender, website, schwerpunkt FROM provider_doctors WHERE id = $1",
    )
    .bind(doctor_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(updated_title.as_deref(), Some("Prof. Dr."));
    assert_eq!(updated_gender, "male");
    assert_eq!(
        updated_website.as_deref(),
        Some("https://updated-title-doctor.example")
    );
    assert_eq!(
        updated_schwerpunkt.as_deref(),
        Some("Interventionelle Kardiologie")
    );

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
    assert!(message.contains("akademische Titel"), "{invalid_body}");
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
