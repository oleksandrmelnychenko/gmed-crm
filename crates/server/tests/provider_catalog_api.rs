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
