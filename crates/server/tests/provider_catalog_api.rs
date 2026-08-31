mod support;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use serde_json::{Value, json};
use sqlx::PgPool;
use tower::ServiceExt;
use uuid::Uuid;

use gmed_server::auth::jwt;

const TEST_SECRET: &str = "test-secret-at-least-32-characters-long!!";

async fn test_context() -> Option<(axum::Router, PgPool, Uuid, String)> {
    let ctx = support::suite_context(TEST_SECRET).await?;
    let bearer = auth_header_for(ctx.admin_id, "ceo");
    Some((ctx.app, ctx.pool, ctx.admin_id, bearer))
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

async fn seed_provider_with_type(
    pool: &PgPool,
    tag: &str,
    provider_type: &str,
    country: &str,
) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO providers (name, provider_type, address_city, fachbereich, address_country)
           VALUES ($1, $2, $3, 'General', $4)
           RETURNING id"#,
    )
    .bind(format!("Clinic {tag}"))
    .bind(provider_type)
    .bind(format!("City {tag}"))
    .bind(country)
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

async fn seed_patient(pool: &PgPool, created_by: Uuid, tag: &str) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO patients (
                patient_id, first_name, last_name, birth_date, gender, created_by
           ) VALUES (
                $1, $2, $3, '1990-01-01', 'diverse', $4
           ) RETURNING id"#,
    )
    .bind(format!("PT-{tag}"))
    .bind(format!("First {tag}"))
    .bind(format!("Last {tag}"))
    .bind(created_by)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn seed_staff_user(pool: &PgPool, tag: &str, role: &str) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO users (email, password_hash, name, role)
           VALUES ($1, 'test-password-hash', $2, $3)
           RETURNING id"#,
    )
    .bind(format!("{tag}-{}@example.com", Uuid::new_v4().simple()))
    .bind(format!("{role} {tag}"))
    .bind(role)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn seed_direct_provider_rule(
    pool: &PgPool,
    user_id: Uuid,
    granted_by: Uuid,
    provider_id: Uuid,
    capability: &str,
    effect: &str,
) {
    sqlx::query(
        r#"INSERT INTO staff_user_access_rules (
                user_id, granted_for_role, resource_type, scope_type,
                resource_id, capability, effect, granted_by
           ) VALUES ($1, 'concierge', 'provider', 'record', $2, $3, $4, $5)"#,
    )
    .bind(user_id)
    .bind(provider_id)
    .bind(capability)
    .bind(effect)
    .bind(granted_by)
    .execute(pool)
    .await
    .unwrap();
}

async fn assign_provider_profile(
    pool: &PgPool,
    user_id: Uuid,
    admin_id: Uuid,
    tag: &str,
    rules: &[(Uuid, &str, &str)],
) {
    let profile_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO staff_access_profiles (name, created_by)
           VALUES ($1, $2)
           RETURNING id"#,
    )
    .bind(format!("Provider ACL {tag}"))
    .bind(admin_id)
    .fetch_one(pool)
    .await
    .unwrap();
    sqlx::query(
        r#"INSERT INTO staff_access_profile_roles (profile_id, role)
           VALUES ($1, 'concierge')"#,
    )
    .bind(profile_id)
    .execute(pool)
    .await
    .unwrap();
    for (provider_id, capability, effect) in rules {
        sqlx::query(
            r#"INSERT INTO staff_access_profile_rules (
                    profile_id, resource_type, scope_type, resource_id,
                    capability, effect, created_by
               ) VALUES ($1, 'provider', 'record', $2, $3, $4, $5)"#,
        )
        .bind(profile_id)
        .bind(provider_id)
        .bind(capability)
        .bind(effect)
        .bind(admin_id)
        .execute(pool)
        .await
        .unwrap();
    }
    sqlx::query(
        r#"INSERT INTO staff_access_profile_assignments (
                user_id, profile_id, assigned_for_role, assigned_by
           ) VALUES ($1, $2, 'concierge', $3)"#,
    )
    .bind(user_id)
    .bind(profile_id)
    .bind(admin_id)
    .execute(pool)
    .await
    .unwrap();
}

fn provider_update_payload(name: &str, provider_type: &str) -> Value {
    json!({
        "name": name,
        "provider_type": provider_type,
    })
}

fn response_contains_provider(body: &Value, provider_id: Uuid) -> bool {
    body.as_array()
        .is_some_and(|rows| rows.iter().any(|row| row["id"] == provider_id.to_string()))
}

#[tokio::test]
async fn concierge_only_sees_medical_providers_with_explicit_view_access() {
    let Some((app, pool, admin_id, _)) = test_context().await else {
        return;
    };
    let tag = unique_tag("provider-acl-view");
    let concierge_id = seed_staff_user(&pool, &tag, "concierge").await;
    let bearer = auth_header_for(concierge_id, "concierge");
    let allowed_id =
        seed_provider_with_type(&pool, &format!("{tag}-allowed"), "medical", "Germany").await;
    let hidden_id =
        seed_provider_with_type(&pool, &format!("{tag}-hidden"), "medical", "Germany").await;

    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/providers?search={tag}"),
        &bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(!response_contains_provider(&body, allowed_id));
    assert!(!response_contains_provider(&body, hidden_id));

    let (status, _) = json_request(
        &app,
        "GET",
        &format!("/api/v1/providers/{allowed_id}"),
        &bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    seed_direct_provider_rule(&pool, concierge_id, admin_id, allowed_id, "view", "allow").await;

    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/providers?search={tag}"),
        &bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(response_contains_provider(&body, allowed_id));
    assert!(!response_contains_provider(&body, hidden_id));

    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/providers/{allowed_id}"),
        &bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["id"], allowed_id.to_string());
    let (status, _) = json_request(
        &app,
        "GET",
        &format!("/api/v1/providers/{hidden_id}"),
        &bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn concierge_medical_provider_edit_requires_separate_edit_access() {
    let Some((app, pool, admin_id, _)) = test_context().await else {
        return;
    };
    let tag = unique_tag("provider-acl-edit");
    let concierge_id = seed_staff_user(&pool, &tag, "concierge").await;
    let bearer = auth_header_for(concierge_id, "concierge");
    let provider_id = seed_provider_with_type(&pool, &tag, "medical", "Germany").await;
    seed_direct_provider_rule(&pool, concierge_id, admin_id, provider_id, "view", "allow").await;

    let denied_name = format!("Denied edit {tag}");
    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/providers/{provider_id}/update"),
        &bearer,
        Some(provider_update_payload(&denied_name, "medical")),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    seed_direct_provider_rule(&pool, concierge_id, admin_id, provider_id, "edit", "allow").await;
    let updated_name = format!("Allowed edit {tag}");
    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/providers/{provider_id}/update"),
        &bearer,
        Some(provider_update_payload(&updated_name, "medical")),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let stored_name: String = sqlx::query_scalar("SELECT name FROM providers WHERE id = $1")
        .bind(provider_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(stored_name, updated_name);
}

#[tokio::test]
async fn concierge_direct_view_deny_overrides_profile_and_non_medical_baseline() {
    let Some((app, pool, admin_id, _)) = test_context().await else {
        return;
    };
    let tag = unique_tag("provider-acl-deny");
    let concierge_id = seed_staff_user(&pool, &tag, "concierge").await;
    let bearer = auth_header_for(concierge_id, "concierge");
    let medical_id =
        seed_provider_with_type(&pool, &format!("{tag}-medical"), "medical", "Germany").await;
    let non_medical_id = seed_provider_with_type(
        &pool,
        &format!("{tag}-non-medical"),
        "non_medical",
        "Germany",
    )
    .await;
    assign_provider_profile(
        &pool,
        concierge_id,
        admin_id,
        &tag,
        &[
            (medical_id, "view", "allow"),
            (non_medical_id, "view", "allow"),
        ],
    )
    .await;
    seed_direct_provider_rule(&pool, concierge_id, admin_id, medical_id, "view", "deny").await;
    seed_direct_provider_rule(
        &pool,
        concierge_id,
        admin_id,
        non_medical_id,
        "view",
        "deny",
    )
    .await;

    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/providers?search={tag}"),
        &bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(!response_contains_provider(&body, medical_id));
    assert!(!response_contains_provider(&body, non_medical_id));
    for provider_id in [medical_id, non_medical_id] {
        let (status, _) = json_request(
            &app,
            "GET",
            &format!("/api/v1/providers/{provider_id}"),
            &bearer,
            None,
        )
        .await;
        assert_eq!(status, StatusCode::FORBIDDEN);
    }
}

#[tokio::test]
async fn concierge_cannot_convert_provider_type_in_either_direction() {
    let Some((app, pool, admin_id, _)) = test_context().await else {
        return;
    };
    let tag = unique_tag("provider-acl-type");
    let concierge_id = seed_staff_user(&pool, &tag, "concierge").await;
    let bearer = auth_header_for(concierge_id, "concierge");
    let medical_id =
        seed_provider_with_type(&pool, &format!("{tag}-medical"), "medical", "Germany").await;
    let non_medical_id = seed_provider_with_type(
        &pool,
        &format!("{tag}-non-medical"),
        "non_medical",
        "Germany",
    )
    .await;
    for capability in ["view", "edit"] {
        seed_direct_provider_rule(
            &pool,
            concierge_id,
            admin_id,
            medical_id,
            capability,
            "allow",
        )
        .await;
    }

    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/providers/{medical_id}/update"),
        &bearer,
        Some(provider_update_payload("Converted medical", "non_medical")),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/providers/{non_medical_id}/update"),
        &bearer,
        Some(provider_update_payload("Converted non-medical", "medical")),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    let types: Vec<String> = sqlx::query_scalar(
        "SELECT provider_type FROM providers WHERE id = ANY($1) ORDER BY provider_type",
    )
    .bind(vec![medical_id, non_medical_id])
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(types, vec!["medical", "non_medical"]);
}

#[tokio::test]
async fn insurance_provider_options_include_patient_insurance_names() {
    let Some((app, pool, admin_id, bearer)) = test_context().await else {
        return;
    };

    let tag = unique_tag("provider-insurance-options");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let insurance_name = format!("Patient Insurance {tag}");
    sqlx::query("UPDATE patients SET insurance_provider = $2 WHERE id = $1")
        .bind(patient_id)
        .bind(&insurance_name)
        .execute(&pool)
        .await
        .unwrap();

    let (status, body) = json_request(
        &app,
        "GET",
        "/api/v1/providers/insurance-providers?include_inactive=true",
        &bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let items = body.as_array().expect("insurance providers array");
    assert!(
        items.iter().any(|row| row["name"] == insurance_name),
        "patient insurance provider should be available as a provider/doctor option"
    );
}

#[tokio::test]
async fn providers_list_supports_provider_and_doctor_insurance_filters() {
    let Some((app, pool, _admin_id, bearer)) = test_context().await else {
        return;
    };

    let tag = unique_tag("provider-insurance-filter");
    let provider_id =
        seed_provider_with_type(&pool, &format!("{tag}-provider"), "medical", "Germany").await;
    let doctor_provider_id = seed_provider_with_type(
        &pool,
        &format!("{tag}-doctor-provider"),
        "medical",
        "Germany",
    )
    .await;
    let decoy_id =
        seed_provider_with_type(&pool, &format!("{tag}-decoy"), "medical", "Germany").await;
    let provider_insurance =
        seed_insurance_provider(&pool, &format!("Provider Insurance {tag}")).await;
    let doctor_insurance = seed_insurance_provider(&pool, &format!("Doctor Insurance {tag}")).await;

    sqlx::query(
        r#"INSERT INTO provider_insurances (provider_id, insurance_provider_id)
           VALUES ($1, $2)"#,
    )
    .bind(provider_id)
    .bind(provider_insurance)
    .execute(&pool)
    .await
    .unwrap();

    let doctor_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO provider_doctors (provider_id, name)
           VALUES ($1, $2)
           RETURNING id"#,
    )
    .bind(doctor_provider_id)
    .bind(format!("Insurance Doctor {tag}"))
    .fetch_one(&pool)
    .await
    .unwrap();
    sqlx::query(
        r#"INSERT INTO provider_doctor_insurances (doctor_id, insurance_provider_id)
           VALUES ($1, $2)"#,
    )
    .bind(doctor_id)
    .bind(doctor_insurance)
    .execute(&pool)
    .await
    .unwrap();

    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/providers?search={tag}&insurance_provider=Provider%20Insurance"),
        &bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let items = body.as_array().expect("providers array");
    assert!(items.iter().any(|row| row["id"] == provider_id.to_string()));
    assert!(!items.iter().any(|row| row["id"] == decoy_id.to_string()));
    let row = items
        .iter()
        .find(|row| row["id"] == provider_id.to_string())
        .expect("provider row must be present");
    assert_eq!(
        row["insurance_providers"][0]["name"],
        format!("Provider Insurance {tag}")
    );

    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/providers?search={tag}&insurance_provider=Doctor%20Insurance"),
        &bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let items = body.as_array().expect("providers array");
    assert!(
        items
            .iter()
            .any(|row| row["id"] == doctor_provider_id.to_string())
    );
    assert!(!items.iter().any(|row| row["id"] == provider_id.to_string()));
    assert!(!items.iter().any(|row| row["id"] == decoy_id.to_string()));
    let row = items
        .iter()
        .find(|row| row["id"] == doctor_provider_id.to_string())
        .expect("doctor-insured provider row must be present");
    assert_eq!(
        row["doctor_insurance_providers"][0]["name"],
        format!("Doctor Insurance {tag}")
    );
    assert_eq!(
        row["insurance_providers"]
            .as_array()
            .expect("direct provider insurances")
            .len(),
        0,
        "doctor coverage should not be flattened into direct provider insurance"
    );

    let (status, body) = json_request(
        &app,
        "GET",
        &format!(
            "/api/v1/providers?search={tag}&insurance_provider=Provider%20Insurance%2C%20Doctor%20Insurance"
        ),
        &bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let items = body.as_array().expect("providers array");
    assert!(items.iter().any(|row| row["id"] == provider_id.to_string()));
    assert!(
        items
            .iter()
            .any(|row| row["id"] == doctor_provider_id.to_string())
    );
    assert!(!items.iter().any(|row| row["id"] == decoy_id.to_string()));
}

#[tokio::test]
async fn providers_list_supports_provider_level_fachbereich_city_and_contract_filters() {
    let Some((app, pool, _admin_id, bearer)) = test_context().await else {
        return;
    };

    let tag = unique_tag("provider-extra-filters");

    let cardio_id =
        seed_provider_with_type(&pool, &format!("{tag}-cardio"), "medical", "Germany").await;
    let neuro_id =
        seed_provider_with_type(&pool, &format!("{tag}-neuro"), "medical", "Germany").await;
    let _decoy_non_medical =
        seed_provider_with_type(&pool, &format!("{tag}-decoy"), "non_medical", "Germany").await;

    sqlx::query(
        r#"UPDATE providers
           SET fachbereich = $2,
               address_city = $3,
               kooperationsvertrag = $4
           WHERE id = $1"#,
    )
    .bind(cardio_id)
    .bind("Cardiology")
    .bind("Berlin")
    .bind(json!({"valid_from": "2026-01-01"}))
    .execute(&pool)
    .await
    .unwrap();

    sqlx::query(
        r#"UPDATE providers
           SET fachbereich = $2,
               address_city = $3,
               kooperationsvertrag = NULL
           WHERE id = $1"#,
    )
    .bind(neuro_id)
    .bind("Neurology")
    .bind("Munich")
    .execute(&pool)
    .await
    .unwrap();

    let (status, body) = json_request(
        &app,
        "GET",
        "/api/v1/providers?fachbereich=Cardiology",
        &bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let items = body.as_array().unwrap();
    assert!(
        items.iter().any(|row| row["id"] == cardio_id.to_string()),
        "Cardiology fachbereich filter must include cardio provider"
    );
    assert!(
        !items.iter().any(|row| row["id"] == neuro_id.to_string()),
        "Cardiology fachbereich filter must exclude neuro provider"
    );

    let (status, body) =
        json_request(&app, "GET", "/api/v1/providers?city=Munich", &bearer, None).await;
    assert_eq!(status, StatusCode::OK);
    let items = body.as_array().unwrap();
    assert!(items.iter().any(|row| row["id"] == neuro_id.to_string()));
    assert!(!items.iter().any(|row| row["id"] == cardio_id.to_string()));

    let (status, body) = json_request(
        &app,
        "GET",
        "/api/v1/providers?has_contract=true",
        &bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let items = body.as_array().unwrap();
    assert!(items.iter().any(|row| row["id"] == cardio_id.to_string()));
    assert!(!items.iter().any(|row| row["id"] == neuro_id.to_string()));

    let (status, body) = json_request(
        &app,
        "GET",
        "/api/v1/providers?has_contract=false",
        &bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let items = body.as_array().unwrap();
    assert!(items.iter().any(|row| row["id"] == neuro_id.to_string()));
    assert!(!items.iter().any(|row| row["id"] == cardio_id.to_string()));
}

#[tokio::test]
async fn providers_list_supports_minimum_rating_filter() {
    let Some((app, pool, admin_id, bearer)) = test_context().await else {
        return;
    };

    let tag = unique_tag("provider-rating-filter");
    let high_rated_id =
        seed_provider_with_type(&pool, &format!("{tag}-high"), "medical", "Germany").await;
    let low_rated_id =
        seed_provider_with_type(&pool, &format!("{tag}-low"), "medical", "Germany").await;
    let patient_a = seed_patient(&pool, admin_id, &format!("{tag}-patient-a")).await;
    let patient_b = seed_patient(&pool, admin_id, &format!("{tag}-patient-b")).await;
    let patient_c = seed_patient(&pool, admin_id, &format!("{tag}-patient-c")).await;

    sqlx::query(
        r#"INSERT INTO patient_feedback_forms (
                patient_id, provider_id, submitted_by, source, overall_score, nps_score
           ) VALUES
                ($1, $2, $3, 'staff_capture', 5, 10),
                ($4, $2, $3, 'staff_capture', 4, 9),
                ($5, $6, $3, 'staff_capture', 3, 6)"#,
    )
    .bind(patient_a)
    .bind(high_rated_id)
    .bind(admin_id)
    .bind(patient_b)
    .bind(patient_c)
    .bind(low_rated_id)
    .execute(&pool)
    .await
    .unwrap();

    let (status, body) =
        json_request(&app, "GET", "/api/v1/providers?rating_gte=4", &bearer, None).await;
    assert_eq!(status, StatusCode::OK);
    let items = body.as_array().unwrap();
    assert!(
        items
            .iter()
            .any(|row| row["id"] == high_rated_id.to_string())
    );
    assert!(
        !items
            .iter()
            .any(|row| row["id"] == low_rated_id.to_string())
    );

    let high_rated = items
        .iter()
        .find(|row| row["id"] == high_rated_id.to_string())
        .expect("high-rated provider must stay visible");
    assert_eq!(high_rated["rating_count"], 2);
    let avg_rating = high_rated["avg_rating"]
        .as_f64()
        .expect("avg_rating must be numeric");
    assert!(
        (avg_rating - 4.5).abs() < 0.01,
        "expected avg_rating 4.5, got {avg_rating}"
    );
}
