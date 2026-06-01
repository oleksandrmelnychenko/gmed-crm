mod support;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use serde_json::{Value, json};
use sqlx::PgPool;
use tower::ServiceExt;
use uuid::Uuid;

use gmed_server::auth::jwt;

const TEST_SECRET: &str = "test-secret-at-least-32-characters-long!!";
const CLINIC_LEAF_CODE: &str = "medical_clinics_practices_specialized_centers";
const PHARMACY_LEAF_CODE: &str = "medical_pharmacies";
const CHAUFFEUR_LEAF_CODE: &str = "nonmedical_chauffeur";

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

fn provider_payload(tag: &str, taxonomy_node_id: &str, internal_rating: i32) -> Value {
    json!({
        "name": format!("Taxonomy Clinic {tag}"),
        "provider_type": "medical",
        "address_city": "Berlin",
        "address_country": "Germany",
        "fachbereich": "Cardiology",
        "taxonomy_node_id": taxonomy_node_id,
        "taxonomy_attributes": {
            "region": tag
        },
        "internal_rating": internal_rating
    })
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

async fn create_provider(
    app: &axum::Router,
    bearer: &str,
    tag: &str,
    taxonomy_node_id: &str,
    internal_rating: i32,
) -> Uuid {
    let (status, body) = json_request(
        app,
        "POST",
        "/api/v1/providers",
        bearer,
        Some(provider_payload(tag, taxonomy_node_id, internal_rating)),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    body["id"].as_str().unwrap().parse().unwrap()
}

async fn taxonomy_leaf_id(app: &axum::Router, bearer: &str, code: &str) -> String {
    let (status, body) = json_request(app, "GET", "/api/v1/providers/taxonomy", bearer, None).await;
    assert_eq!(status, StatusCode::OK, "{body}");

    taxonomy_leaves(&body)
        .iter()
        .find(|leaf| leaf["code"] == code)
        .and_then(|leaf| leaf["id"].as_str())
        .unwrap_or_else(|| panic!("taxonomy leaf {code} must be seeded"))
        .to_string()
}

fn taxonomy_leaves(body: &Value) -> &Vec<Value> {
    body["leaves"]
        .as_array()
        .or_else(|| body.as_array())
        .expect("taxonomy response leaves array")
}

fn assert_provider_present(items: &[Value], provider_id: Uuid, message: &str) {
    assert!(
        items
            .iter()
            .any(|item| item["id"] == provider_id.to_string()),
        "{message}"
    );
}

fn assert_provider_absent(items: &[Value], provider_id: Uuid, message: &str) {
    assert!(
        !items
            .iter()
            .any(|item| item["id"] == provider_id.to_string()),
        "{message}"
    );
}

#[tokio::test]
async fn provider_taxonomy_endpoint_returns_seeded_leaves() {
    let Some((app, _pool, _admin_id, bearer)) = test_context().await else {
        return;
    };

    let (status, body) =
        json_request(&app, "GET", "/api/v1/providers/taxonomy", &bearer, None).await;
    assert_eq!(status, StatusCode::OK, "{body}");

    let leaves = taxonomy_leaves(&body);
    assert!(
        leaves.iter().any(|leaf| leaf["code"] == CLINIC_LEAF_CODE),
        "seeded clinic/practice leaf must be exposed by taxonomy endpoint"
    );
    assert!(
        leaves.iter().any(|leaf| leaf["code"] == PHARMACY_LEAF_CODE),
        "seeded pharmacy leaf must be exposed by taxonomy endpoint"
    );
    assert!(
        leaves.iter().all(|leaf| {
            let is_leaf_marker_ok = leaf
                .get("is_leaf")
                .is_none_or(|value| value.as_bool() == Some(true));
            let level_marker_ok = leaf
                .get("level")
                .is_none_or(|value| value.as_str() == Some("type"));
            is_leaf_marker_ok && level_marker_ok
        }),
        "leaves collection must contain only assignable taxonomy leaves"
    );
}

#[tokio::test]
async fn provider_create_and_update_can_assign_taxonomy_leaf_and_internal_rating() {
    let Some((app, _pool, _admin_id, bearer)) = test_context().await else {
        return;
    };

    let tag = unique_tag("provider-taxonomy-upsert");
    let clinic_leaf_id = taxonomy_leaf_id(&app, &bearer, CLINIC_LEAF_CODE).await;
    let pharmacy_leaf_id = taxonomy_leaf_id(&app, &bearer, PHARMACY_LEAF_CODE).await;
    let provider_id = create_provider(&app, &bearer, &tag, &clinic_leaf_id, 4).await;

    let (status, created) = json_request(
        &app,
        "GET",
        &format!("/api/v1/providers/{provider_id}"),
        &bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{created}");
    assert_eq!(created["taxonomy_node_id"], clinic_leaf_id);
    assert_eq!(created["internal_rating"], 4);

    let update_body = provider_payload(&tag, &pharmacy_leaf_id, 5);
    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/providers/{provider_id}/update"),
        &bearer,
        Some(update_body),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");

    let (status, updated) = json_request(
        &app,
        "GET",
        &format!("/api/v1/providers/{provider_id}"),
        &bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{updated}");
    assert_eq!(updated["taxonomy_node_id"], pharmacy_leaf_id);
    assert_eq!(updated["internal_rating"], 5);
}

#[tokio::test]
async fn providers_list_filters_by_taxonomy_internal_rating_and_linked_patient() {
    let Some((app, pool, admin_id, bearer)) = test_context().await else {
        return;
    };

    let tag = unique_tag("provider-taxonomy-filters");
    let clinic_leaf_id = taxonomy_leaf_id(&app, &bearer, CLINIC_LEAF_CODE).await;
    let pharmacy_leaf_id = taxonomy_leaf_id(&app, &bearer, PHARMACY_LEAF_CODE).await;
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let clinic_id =
        create_provider(&app, &bearer, &format!("{tag}-clinic"), &clinic_leaf_id, 5).await;
    let pharmacy_id = create_provider(
        &app,
        &bearer,
        &format!("{tag}-pharmacy"),
        &pharmacy_leaf_id,
        3,
    )
    .await;
    let unlinked_clinic_id = create_provider(
        &app,
        &bearer,
        &format!("{tag}-unlinked"),
        &clinic_leaf_id,
        5,
    )
    .await;

    sqlx::query(
        r#"INSERT INTO appointments (
                patient_id, provider_id, appointment_type, title, date, status, created_by
           ) VALUES (
                $1, $2, 'medical', 'Taxonomy filter appointment', CURRENT_DATE, 'planned', $3
           )"#,
    )
    .bind(patient_id)
    .bind(clinic_id)
    .bind(admin_id)
    .execute(&pool)
    .await
    .unwrap();

    let (status, body) = json_request(
        &app,
        "GET",
        &format!(
            "/api/v1/providers?search={tag}&taxonomy_node_id={clinic_leaf_id}&internal_rating_gte=4"
        ),
        &bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let items = body.as_array().expect("providers array");
    assert_provider_present(
        items,
        clinic_id,
        "clinic provider with sufficient internal rating must match",
    );
    assert_provider_present(
        items,
        unlinked_clinic_id,
        "unlinked clinic provider still matches taxonomy and rating filters",
    );
    assert_provider_absent(
        items,
        pharmacy_id,
        "pharmacy provider must not match clinic taxonomy filter",
    );

    let (status, body) = json_request(
        &app,
        "GET",
        &format!(
            "/api/v1/providers?search={tag}&taxonomy_node_id={clinic_leaf_id}&internal_rating_gte=4&linked_patient_id={patient_id}"
        ),
        &bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let items = body.as_array().expect("providers array");
    assert_provider_present(
        items,
        clinic_id,
        "linked patient filter must include providers connected to the patient",
    );
    assert_provider_absent(
        items,
        unlinked_clinic_id,
        "linked patient filter must exclude matching providers without patient activity",
    );
    assert_provider_absent(
        items,
        pharmacy_id,
        "combined filters must still exclude the wrong taxonomy leaf",
    );

    let (status, body) = json_request(
        &app,
        "GET",
        &format!(
            "/api/v1/providers?taxonomy_attribute_key=region&taxonomy_attribute_value={tag}-unlinked"
        ),
        &bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let items = body.as_array().expect("providers array");
    assert_provider_present(
        items,
        unlinked_clinic_id,
        "taxonomy attribute filter must include matching provider attributes",
    );
    assert_provider_absent(
        items,
        clinic_id,
        "taxonomy attribute filter must exclude non-matching provider attributes",
    );
    assert_provider_absent(
        items,
        pharmacy_id,
        "taxonomy attribute filter must exclude other provider attributes",
    );
}

#[tokio::test]
async fn provider_services_support_taxonomy_on_create_update_get_and_list() {
    let Some((app, _pool, _admin_id, bearer)) = test_context().await else {
        return;
    };

    let tag = unique_tag("provider-service-taxonomy");
    let clinic_leaf_id = taxonomy_leaf_id(&app, &bearer, CLINIC_LEAF_CODE).await;
    let pharmacy_leaf_id = taxonomy_leaf_id(&app, &bearer, PHARMACY_LEAF_CODE).await;
    let chauffeur_leaf_id = taxonomy_leaf_id(&app, &bearer, CHAUFFEUR_LEAF_CODE).await;
    let provider_id = create_provider(&app, &bearer, &tag, &clinic_leaf_id, 4).await;

    let service_body = json!({
        "service_name": format!("Taxonomy service {tag}"),
        "description": "Initial taxonomy service",
        "price_type": "range",
        "price_from": 100,
        "price_to": 250,
        "currency": "EUR",
        "taxonomy_node_id": clinic_leaf_id,
        "taxonomy_attributes": {
            "setting": "outpatient"
        }
    });
    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/providers/{provider_id}/services"),
        &bearer,
        Some(service_body),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    let service_id: Uuid = body["id"].as_str().unwrap().parse().unwrap();

    let (status, service) = json_request(
        &app,
        "GET",
        &format!("/api/v1/providers/{provider_id}/services/{service_id}"),
        &bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{service}");
    assert_eq!(service["taxonomy_node_id"], clinic_leaf_id);
    assert_eq!(service["taxonomy_node_code"], CLINIC_LEAF_CODE);
    assert_eq!(service["taxonomy_attributes"]["setting"], "outpatient");

    let update_body = json!({
        "service_name": format!("Updated taxonomy service {tag}"),
        "price_type": "range",
        "price_from": 150,
        "price_to": 300,
        "currency": "EUR",
        "taxonomy_node_id": pharmacy_leaf_id,
        "taxonomy_attributes": {
            "setting": "pharmacy"
        }
    });
    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/providers/{provider_id}/services/{service_id}/update"),
        &bearer,
        Some(update_body),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");

    let (status, services) = json_request(
        &app,
        "GET",
        &format!("/api/v1/providers/{provider_id}/services"),
        &bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{services}");
    let listed = services
        .as_array()
        .unwrap()
        .iter()
        .find(|service| service["id"] == service_id.to_string())
        .expect("updated service must be listed");
    assert_eq!(listed["taxonomy_node_id"], pharmacy_leaf_id);
    assert_eq!(listed["taxonomy_node_code"], PHARMACY_LEAF_CODE);
    assert_eq!(listed["taxonomy_attributes"]["setting"], "pharmacy");

    let mismatched_body = json!({
        "service_name": format!("Mismatched taxonomy service {tag}"),
        "price_type": "range",
        "price_from": 50,
        "price_to": 80,
        "currency": "EUR",
        "taxonomy_node_id": chauffeur_leaf_id
    });
    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/providers/{provider_id}/services"),
        &bearer,
        Some(mismatched_body),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
}

#[tokio::test]
async fn provider_taxonomy_filter_ids_include_ancestors_of_all_assignments() {
    let Some((app, pool, _admin_id, bearer)) = test_context().await else {
        return;
    };

    let tag = unique_tag("filter-ids");
    let clinic_leaf = taxonomy_leaf_id(&app, &bearer, CLINIC_LEAF_CODE).await;
    let pharmacy_leaf = taxonomy_leaf_id(&app, &bearer, PHARMACY_LEAF_CODE).await;

    // Provider assigned to two leaves under DIFFERENT parents; clinic is primary,
    // pharmacy is a non-primary assignment.
    let (status, body) = json_request(
        &app,
        "POST",
        "/api/v1/providers",
        &bearer,
        Some(json!({
            "name": format!("Multi-assignment provider {tag}"),
            "provider_type": "medical",
            "address_city": "Berlin",
            "address_country": "Germany",
            "fachbereich": "General",
            "taxonomy_node_ids": [clinic_leaf, pharmacy_leaf],
            "primary_taxonomy_node_id": clinic_leaf,
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    let provider_id = body["id"].as_str().unwrap().to_string();

    // Parent (category) of the NON-primary pharmacy leaf. Before the fix, taxonomy
    // ancestors were emitted for the PRIMARY assignment only, so this id was missing
    // and filtering by the pharmacy category dropped the provider from the list.
    let pharmacy_parent: Uuid =
        sqlx::query_scalar("SELECT parent_id FROM provider_taxonomy_nodes WHERE id = $1")
            .bind(Uuid::parse_str(&pharmacy_leaf).unwrap())
            .fetch_one(&pool)
            .await
            .unwrap();

    let (status, detail) = json_request(
        &app,
        "GET",
        &format!("/api/v1/providers/{provider_id}"),
        &bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{detail}");

    let filter_ids: Vec<String> = detail["taxonomy_filter_ids"]
        .as_array()
        .expect("taxonomy_filter_ids array")
        .iter()
        .filter_map(|value| value.as_str().map(str::to_string))
        .collect();

    assert!(
        filter_ids.contains(&clinic_leaf),
        "directly-assigned clinic leaf must be in taxonomy_filter_ids: {filter_ids:?}"
    );
    assert!(
        filter_ids.contains(&pharmacy_leaf),
        "directly-assigned pharmacy leaf must be in taxonomy_filter_ids: {filter_ids:?}"
    );
    assert!(
        filter_ids.contains(&pharmacy_parent.to_string()),
        "ancestor {pharmacy_parent} of the NON-primary pharmacy assignment must be in taxonomy_filter_ids: {filter_ids:?}"
    );

    // Invariant: the directly-assigned set (used for create/update round-trips) must
    // stay exactly the two leaves — ancestors live only in taxonomy_filter_ids, so the
    // provider edit form cannot accidentally persist ancestor categories as assignments.
    let assigned_ids: Vec<String> = detail["taxonomy_node_ids"]
        .as_array()
        .expect("taxonomy_node_ids array")
        .iter()
        .filter_map(|value| value.as_str().map(str::to_string))
        .collect();
    assert_eq!(
        assigned_ids.len(),
        2,
        "taxonomy_node_ids must contain only the two assigned leaves: {assigned_ids:?}"
    );
    assert!(assigned_ids.contains(&clinic_leaf) && assigned_ids.contains(&pharmacy_leaf));
    assert!(
        !assigned_ids.contains(&pharmacy_parent.to_string()),
        "ancestors must NOT leak into taxonomy_node_ids: {assigned_ids:?}"
    );
}
