mod support;

use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use gmed_server::auth::jwt;
use serde_json::{Value, json};
use tower::ServiceExt;
use uuid::Uuid;

const SECRET: &str = "medication-names-test-secret-at-least-32-characters";

fn reviewed_pair(handelsname: &str, wirkstoff: &str) -> Value {
    json!({ "handelsname": handelsname, "wirkstoff": wirkstoff,
        "name_pair_confirmation": { "handelsname": handelsname, "wirkstoff": wirkstoff } })
}

async fn context() -> Option<(support::TestSuiteContext, Uuid, String)> {
    let suite = support::suite_context(SECRET).await?;
    // Each suite owns a disposable database. Dictionary behavior is tested
    // independently of medication pairs backfilled by demo-data migrations.
    sqlx::query("DELETE FROM medication_name_pairs")
        .execute(&suite.pool)
        .await
        .unwrap();
    let user_id: Uuid = sqlx::query_scalar(
        "INSERT INTO users (email, password_hash, name, role)
         VALUES ($1, 'test-hash', 'Name dictionary test', 'ceo') RETURNING id",
    )
    .bind(format!("names-{}@example.com", Uuid::new_v4()))
    .fetch_one(&suite.pool)
    .await
    .unwrap();
    let patient_id: Uuid = sqlx::query_scalar(
        "INSERT INTO patients (patient_id, first_name, last_name, birth_date, gender, created_by)
         VALUES ($1, 'Name', 'Test', '1980-01-01', 'female', $2) RETURNING id",
    )
    .bind(format!("NAME-{}", Uuid::new_v4()))
    .bind(user_id)
    .fetch_one(&suite.pool)
    .await
    .unwrap();
    let token = jwt::issue_access_token(SECRET, user_id, "ceo", Uuid::new_v4()).unwrap();
    Some((suite, patient_id, format!("Bearer {token}")))
}

async fn request(
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
        .body(body.map_or(Body::empty(), |value| Body::from(value.to_string())))
        .unwrap();
    let response = app.clone().oneshot(request).await.unwrap();
    let status = response.status();
    let bytes = axum::body::to_bytes(response.into_body(), 1024 * 1024)
        .await
        .unwrap();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}

fn search(field: &str, q: &str, related: &str) -> String {
    let mut url = reqwest::Url::parse("http://test/api/v1/medication-names").unwrap();
    url.query_pairs_mut()
        .append_pair("field", field)
        .append_pair("q", q)
        .append_pair("related", related);
    format!("{}?{}", url.path(), url.query().unwrap())
}

#[tokio::test]
async fn unreviewed_names_and_stale_confirmations_do_not_pollute_the_catalog() {
    let Some((suite, patient_id, bearer)) = context().await else {
        return;
    };
    let (status, _) = request(&suite.app, "POST", &format!("/api/v1/patients/{patient_id}/medications"), &bearer,
        Some(json!({ "items": [
            { "handelsname": "Unreviewed Brand", "wirkstoff": "Unreviewed Substance" },
            { "handelsname": "Changed Brand", "wirkstoff": "Substance", "name_pair_confirmation": { "handelsname": "Original Brand", "wirkstoff": "Substance" } },
            reviewed_pair("Reviewed Brand", "Reviewed Substance")
        ] }))).await;
    assert_eq!(status, StatusCode::OK);
    let patient_count: i64 =
        sqlx::query_scalar("SELECT count(*) FROM patient_medications WHERE patient_id = $1")
            .bind(patient_id)
            .fetch_one(&suite.pool)
            .await
            .unwrap();
    assert_eq!(patient_count, 3);
    let (_, catalog) = request(
        &suite.app,
        "GET",
        "/api/v1/medication-name-pairs",
        &bearer,
        None,
    )
    .await;
    assert_eq!(catalog["total"], 1);
    assert_eq!(catalog["items"][0]["handelsname"], "Reviewed Brand");
}

#[tokio::test]
async fn name_review_suggests_spelling_matches_without_inserting_or_replacing_names() {
    let Some((suite, _, bearer)) = context().await else {
        return;
    };
    sqlx::query("INSERT INTO medication_name_pairs (handelsname, wirkstoff) VALUES ('Metohexal', 'Metoprolol'), ('Other Brand', 'Metronidazol')")
        .execute(&suite.pool).await.unwrap();
    let endpoint = "/api/v1/medication-name-pairs/check";
    let (status, check) = request(
        &suite.app,
        "GET",
        &format!("{endpoint}?handelsname=Metohexla&wirkstoff=Metoprolo"),
        &bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{check}");
    assert_eq!(check["known_pair"], false);
    assert_eq!(check["handelsname"]["similar"], json!(["Metohexal"]));
    assert_eq!(check["wirkstoff"]["similar"], json!(["Metoprolol"]));
    let (_, known) = request(
        &suite.app,
        "GET",
        &format!("{endpoint}?handelsname=METOHEXAL&wirkstoff=metoprolol"),
        &bearer,
        None,
    )
    .await;
    assert_eq!(known["known_pair"], true);
    assert_eq!(known["handelsname"]["exact"], "Metohexal");
    assert_eq!(known["handelsname"]["similar"], json!([]));
    assert_eq!(
        request(
            &suite.app,
            "GET",
            &format!("{endpoint}?handelsname=Metohexal&wirkstoff=Metoprolol"),
            "",
            None
        )
        .await
        .0,
        StatusCode::UNAUTHORIZED
    );
    let (_, catalog) = request(
        &suite.app,
        "GET",
        "/api/v1/medication-name-pairs",
        &bearer,
        None,
    )
    .await;
    assert_eq!(catalog["total"], 2);
}

#[tokio::test]
async fn catalog_edits_update_suggestions_without_rewriting_patient_medications() {
    let Some((suite, patient_id, bearer)) = context().await else {
        return;
    };
    let path = format!("/api/v1/patients/{patient_id}/medications");
    let (status, _) = request(
        &suite.app,
        "POST",
        &path,
        &bearer,
        Some(json!({ "items": [
        reviewed_pair("Original Brand", "Original Substance")
    ] })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let (status, list) = request(
        &suite.app,
        "GET",
        "/api/v1/medication-name-pairs",
        &bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(list["total"], 1);
    let item = &list["items"][0];
    let path = format!(
        "/api/v1/medication-name-pairs/{}",
        item["id"].as_str().unwrap()
    );
    let (status, edited) = request(&suite.app, "PATCH", &path, &bearer, Some(json!({
        "handelsname": "  Corrected   Brand ", "wirkstoff": "Corrected Substance", "version": item["version"]
    }))).await;
    assert_eq!(status, StatusCode::OK, "{edited}");
    assert_eq!(edited["handelsname"], "Corrected Brand");
    assert_eq!(edited["version"], 1);
    let (_, suggestions) = request(
        &suite.app,
        "GET",
        &search("handelsname", "", "Corrected Substance"),
        &bearer,
        None,
    )
    .await;
    assert_eq!(suggestions["items"], json!(["Corrected Brand"]));
    let (_, suggestions) = request(
        &suite.app,
        "GET",
        &search("wirkstoff", "", "Original Brand"),
        &bearer,
        None,
    )
    .await;
    assert_eq!(suggestions["items"], json!([]));
    let medication: (String, String) = sqlx::query_as(
        "SELECT handelsname, wirkstoff FROM patient_medications WHERE patient_id = $1",
    )
    .bind(patient_id)
    .fetch_one(&suite.pool)
    .await
    .unwrap();
    assert_eq!(
        medication,
        ("Original Brand".into(), "Original Substance".into())
    );
    let (status, error) = request(
        &suite.app,
        "PATCH",
        &path,
        &bearer,
        Some(json!({
            "handelsname": "Stale", "wirkstoff": "Stale", "version": 0
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(error["code"], "medication_pair_changed");
}

#[tokio::test]
async fn catalog_validates_pairs_and_rejects_duplicates_without_overwriting() {
    let Some((suite, _, bearer)) = context().await else {
        return;
    };
    let endpoint = "/api/v1/medication-name-pairs";
    let (status, first) = request(
        &suite.app,
        "POST",
        endpoint,
        &bearer,
        Some(json!({ "handelsname": "Brand", "wirkstoff": "Substance" })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{first}");
    let (status, duplicate) = request(
        &suite.app,
        "POST",
        endpoint,
        &bearer,
        Some(json!({ "handelsname": " BRAND ", "wirkstoff": " substance " })),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(duplicate["code"], "medication_pair_exists");
    for body in [
        json!({ "handelsname": "Brand", "wirkstoff": " \t " }),
        json!({ "handelsname": "x".repeat(501), "wirkstoff": "Substance" }),
        json!({ "handelsname": "Brand", "wirkstoff": "я".repeat(501) }),
    ] {
        assert_eq!(
            request(&suite.app, "POST", endpoint, &bearer, Some(body))
                .await
                .0,
            StatusCode::UNPROCESSABLE_ENTITY
        );
    }
    let (status, second) = request(
        &suite.app,
        "POST",
        endpoint,
        &bearer,
        Some(json!({ "handelsname": "", "wirkstoff": "Other Substance" })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let path = format!("{endpoint}/{}", second["id"].as_str().unwrap());
    let (status, _) = request(
        &suite.app,
        "PATCH",
        &path,
        &bearer,
        Some(json!({ "handelsname": "Brand", "wirkstoff": "Substance", "version": 0 })),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    let (_, list) = request(&suite.app, "GET", endpoint, &bearer, None).await;
    assert_eq!(list["total"], 2);
    assert!(
        list["items"]
            .as_array()
            .unwrap()
            .iter()
            .any(|item| item["wirkstoff"] == "Other Substance" && item["version"] == 0)
    );
    assert_eq!(
        request(
            &suite.app,
            "PATCH",
            &format!("{endpoint}/{}", Uuid::new_v4()),
            &bearer,
            Some(json!({ "handelsname": "Gone", "wirkstoff": "Gone", "version": 0 }))
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
}

#[tokio::test]
async fn catalog_delete_checks_version_and_keeps_patient_prescriptions() {
    let Some((suite, patient_id, bearer)) = context().await else {
        return;
    };
    let (status, _) = request(
        &suite.app,
        "POST",
        &format!("/api/v1/patients/{patient_id}/medications"),
        &bearer,
        Some(json!({ "items": [reviewed_pair("Delete Brand", "Delete Substance")] })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let (_, catalog) = request(
        &suite.app,
        "GET",
        "/api/v1/medication-name-pairs",
        &bearer,
        None,
    )
    .await;
    let item = &catalog["items"][0];
    let path = format!(
        "/api/v1/medication-name-pairs/{}",
        item["id"].as_str().unwrap()
    );
    let version = item["version"].as_i64().unwrap();
    let (status, error) = request(
        &suite.app,
        "DELETE",
        &path,
        &bearer,
        Some(json!({ "version": version + 1 })),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(error["code"], "medication_pair_changed");
    let (_, catalog) = request(
        &suite.app,
        "GET",
        "/api/v1/medication-name-pairs",
        &bearer,
        None,
    )
    .await;
    assert_eq!(catalog["total"], 1);
    let (status, _) = request(
        &suite.app,
        "DELETE",
        &path,
        &bearer,
        Some(json!({ "version": version })),
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    let (_, catalog) = request(
        &suite.app,
        "GET",
        "/api/v1/medication-name-pairs",
        &bearer,
        None,
    )
    .await;
    assert_eq!(catalog["total"], 0);
    let (_, suggestions) = request(
        &suite.app,
        "GET",
        &search("handelsname", "", "Delete Substance"),
        &bearer,
        None,
    )
    .await;
    assert_eq!(suggestions["items"], json!([]));
    let medication: (String, String) = sqlx::query_as(
        "SELECT handelsname, wirkstoff FROM patient_medications WHERE patient_id = $1",
    )
    .bind(patient_id)
    .fetch_one(&suite.pool)
    .await
    .unwrap();
    assert_eq!(
        medication,
        ("Delete Brand".into(), "Delete Substance".into())
    );
    let (status, error) = request(
        &suite.app,
        "DELETE",
        &path,
        &bearer,
        Some(json!({ "version": version })),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(error["code"], "medication_pair_not_found");
}

#[tokio::test]
async fn catalog_lists_all_pages_and_searches_literal_names_and_substances() {
    let Some((suite, _, bearer)) = context().await else {
        return;
    };
    sqlx::query("INSERT INTO medication_name_pairs (handelsname, wirkstoff) SELECT 'Brand ' || lpad(n::text, 3, '0'), 'Substance' FROM generate_series(1, 65) n")
        .execute(&suite.pool).await.unwrap();
    sqlx::query(
        "INSERT INTO medication_name_pairs (handelsname, wirkstoff) VALUES ('Percent 5%', 'A_B')",
    )
    .execute(&suite.pool)
    .await
    .unwrap();
    let (_, first) = request(
        &suite.app,
        "GET",
        "/api/v1/medication-name-pairs",
        &bearer,
        None,
    )
    .await;
    let (_, second) = request(
        &suite.app,
        "GET",
        "/api/v1/medication-name-pairs?page=2",
        &bearer,
        None,
    )
    .await;
    assert_eq!(first["total"], 66);
    assert_eq!(first["items"].as_array().unwrap().len(), 50);
    assert_eq!(second["items"].as_array().unwrap().len(), 16);
    assert_eq!(first["items"][49]["handelsname"], "Brand 050");
    assert_eq!(second["items"][0]["handelsname"], "Brand 051");
    for term in ["%25", "_"] {
        let (_, list) = request(
            &suite.app,
            "GET",
            &format!("/api/v1/medication-name-pairs?q={term}"),
            &bearer,
            None,
        )
        .await;
        assert_eq!(list["total"], 1);
        assert_eq!(list["items"][0]["handelsname"], "Percent 5%");
    }
}

#[tokio::test]
async fn catalog_rejects_unauthenticated_and_non_clinical_staff_reads_and_writes() {
    let Some((suite, _, _)) = context().await else {
        return;
    };
    let denied_user: Uuid = sqlx::query_scalar("INSERT INTO users (email, password_hash, name, role) VALUES ('catalog-denied@example.com', 'hash', 'Denied', 'billing') RETURNING id")
        .fetch_one(&suite.pool).await.unwrap();
    let token = jwt::issue_access_token(SECRET, denied_user, "billing", Uuid::new_v4()).unwrap();
    for (bearer, expected) in [
        ("".to_string(), StatusCode::UNAUTHORIZED),
        (format!("Bearer {token}"), StatusCode::FORBIDDEN),
    ] {
        for (method, path, body) in [
            ("GET", "/api/v1/medication-name-pairs".into(), None),
            (
                "POST",
                "/api/v1/medication-name-pairs".into(),
                Some(json!({ "handelsname": "Brand", "wirkstoff": "Substance" })),
            ),
            (
                "PATCH",
                format!("/api/v1/medication-name-pairs/{}", Uuid::new_v4()),
                Some(json!({ "handelsname": "Brand", "wirkstoff": "Substance", "version": 0 })),
            ),
            (
                "DELETE",
                format!("/api/v1/medication-name-pairs/{}", Uuid::new_v4()),
                Some(json!({ "version": 0 })),
            ),
        ] {
            assert_eq!(
                request(&suite.app, method, &path, &bearer, body).await.0,
                expected
            );
        }
    }
}

#[tokio::test]
async fn successful_medication_save_remembers_normalized_pairs_in_both_directions() {
    let Some((suite, patient_id, bearer)) = context().await else {
        return;
    };
    let path = format!("/api/v1/patients/{patient_id}/medications");
    let (status, body) = request(
        &suite.app,
        "POST",
        &path,
        &bearer,
        Some(json!({ "items": [
        reviewed_pair("  Test  Brand ", "Test Substance"),
        reviewed_pair("test brand", " test  substance "),
        reviewed_pair("Second Brand", "Test Substance"),
        reviewed_pair("Test Brand", "Another Substance"),
        reviewed_pair("", "Unnamed Brand Substance")
    ] })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM medication_name_pairs")
        .fetch_one(&suite.pool)
        .await
        .unwrap();
    assert_eq!(count, 4);

    let (status, body) = request(
        &suite.app,
        "GET",
        &search("handelsname", "", " TEST  SUBSTANCE "),
        &bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["items"], json!(["Second Brand", "Test Brand"]));
    assert_eq!(body["has_more"], false);
    let (_, body) = request(
        &suite.app,
        "GET",
        &search("wirkstoff", "", "test brand"),
        &bearer,
        None,
    )
    .await;
    assert_eq!(
        body["items"],
        json!(["Another Substance", "Test Substance"])
    );
    let (_, body) = request(
        &suite.app,
        "GET",
        &search("wirkstoff", "Unnamed", ""),
        &bearer,
        None,
    )
    .await;
    assert_eq!(body["items"], json!(["Unnamed Brand Substance"]));
    let (_, body) = request(
        &suite.app,
        "GET",
        &search("handelsname", "", "Unnamed Brand Substance"),
        &bearer,
        None,
    )
    .await;
    assert_eq!(body["items"], json!([]));

    // Removing a patient medication does not erase the learned vocabulary.
    assert_eq!(
        request(
            &suite.app,
            "POST",
            &path,
            &bearer,
            Some(json!({ "items": [] }))
        )
        .await
        .0,
        StatusCode::OK
    );
    let (_, body) = request(
        &suite.app,
        "GET",
        &search("handelsname", "Second", ""),
        &bearer,
        None,
    )
    .await;
    assert_eq!(body["items"], json!(["Second Brand"]));
}

#[tokio::test]
async fn failed_medication_save_rolls_back_dictionary_changes() {
    let Some((suite, patient_id, bearer)) = context().await else {
        return;
    };
    let (status, _) = request(&suite.app, "POST", &format!("/api/v1/patients/{patient_id}/medications"), &bearer, Some(json!({ "items": [
        reviewed_pair("Not Saved", "Not Saved Substance"),
        { "handelsname": "Invalid Range", "wirkstoff": "Range Substance", "einnahme_von": "2026-09-10", "einnahme_bis": "2026-09-01" }
    ] }))).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM medication_name_pairs")
        .fetch_one(&suite.pool)
        .await
        .unwrap();
    assert_eq!(count, 0);
}

#[tokio::test]
async fn medication_name_search_reports_truncation_escapes_wildcards_and_enforces_access() {
    let Some((suite, _, bearer)) = context().await else {
        return;
    };
    sqlx::query(
        "INSERT INTO medication_name_pairs (handelsname, wirkstoff)
        SELECT 'Brand ' || n, 'Common' FROM generate_series(1, 51) AS n",
    )
    .execute(&suite.pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO medication_name_pairs (handelsname, wirkstoff) VALUES ('Brand 5%', 'Percent')",
    )
    .execute(&suite.pool)
    .await
    .unwrap();
    let (_, body) = request(
        &suite.app,
        "GET",
        &search("handelsname", "", "Common"),
        &bearer,
        None,
    )
    .await;
    assert_eq!(body["items"].as_array().unwrap().len(), 50);
    assert_eq!(body["has_more"], true);
    let (_, body) = request(
        &suite.app,
        "GET",
        &search("handelsname", "%", ""),
        &bearer,
        None,
    )
    .await;
    assert_eq!(body["items"], json!(["Brand 5%"]));
    assert_eq!(
        request(&suite.app, "GET", &search("invalid", "", ""), &bearer, None)
            .await
            .0,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        request(&suite.app, "GET", &search("handelsname", "", ""), "", None)
            .await
            .0,
        StatusCode::UNAUTHORIZED
    );

    let denied_user: Uuid = sqlx::query_scalar(
        "INSERT INTO users (email, password_hash, name, role)
        VALUES ('denied-names@example.com', 'hash', 'Denied', 'billing') RETURNING id",
    )
    .fetch_one(&suite.pool)
    .await
    .unwrap();
    let token = jwt::issue_access_token(SECRET, denied_user, "billing", Uuid::new_v4()).unwrap();
    assert_eq!(
        request(
            &suite.app,
            "GET",
            &search("handelsname", "", ""),
            &format!("Bearer {token}"),
            None
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
}
