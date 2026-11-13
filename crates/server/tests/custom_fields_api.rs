mod support;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use serde_json::{Value, json};
use sqlx::PgPool;
use tower::ServiceExt;
use uuid::Uuid;

use gmed_server::auth::jwt;

const TEST_SECRET: &str = "test-secret-at-least-32-characters-long!!";

fn auth_header_for(user_id: Uuid, role: &str) -> String {
    let token = jwt::issue_access_token(TEST_SECRET, user_id, role, Uuid::new_v4()).unwrap();
    format!("Bearer {token}")
}

fn unique_tag(prefix: &str) -> String {
    format!("{prefix}-{}", Uuid::new_v4().simple())
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
        r#"INSERT INTO patients (patient_id, first_name, last_name, birth_date, gender, created_by)
           VALUES ($1, $2, $3, '1990-01-01', 'diverse', $4)
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

async fn seed_lead(pool: &PgPool, created_by: Uuid, tag: &str) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO leads (first_name, last_name, email, created_by)
           VALUES ($1, $2, $3, $4)
           RETURNING id"#,
    )
    .bind(format!("First {tag}"))
    .bind(format!("Last {tag}"))
    .bind(format!("{tag}@example.com"))
    .bind(created_by)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn seed_patient_assignment(pool: &PgPool, patient_id: Uuid, user_id: Uuid, by: Uuid) {
    sqlx::query(
        r#"INSERT INTO patient_assignments (patient_id, user_id, assigned_by)
           VALUES ($1, $2, $3)
           ON CONFLICT (patient_id, user_id)
           DO UPDATE SET revoked_at = NULL, assigned_by = $3, assigned_at = now()"#,
    )
    .bind(patient_id)
    .bind(user_id)
    .bind(by)
    .execute(pool)
    .await
    .unwrap();
}

/// Creates a field as the CEO and returns its id.
async fn create_field(
    app: &axum::Router,
    ceo: &str,
    entity_type: &str,
    key: &str,
    is_medical: bool,
) -> Uuid {
    let (status, body) = json_request(
        app,
        "POST",
        "/api/v1/admin/custom-fields",
        ceo,
        Some(json!({
            "entity_type": entity_type,
            "field_key": key,
            "field_label": key,
            "field_type": "text",
            "is_medical": is_medical,
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    body["id"].as_str().unwrap().parse().unwrap()
}

/// The values the caller gets: field id → value, and `medical_fields_hidden`.
async fn read_values(
    app: &axum::Router,
    bearer: &str,
    entity_id: Uuid,
) -> (Vec<(Uuid, Value)>, Value) {
    let (status, body) = json_request(
        app,
        "GET",
        &format!("/api/v1/custom-fields/values/{entity_id}"),
        bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let fields = body["fields"]
        .as_array()
        .unwrap()
        .iter()
        .map(|field| {
            (
                field["field_id"].as_str().unwrap().parse().unwrap(),
                field["value"].clone(),
            )
        })
        .collect();
    (fields, body["medical_fields_hidden"].clone())
}

async fn write_value(
    app: &axum::Router,
    bearer: &str,
    entity_id: Uuid,
    field_id: Uuid,
    value: &str,
) -> (StatusCode, Value) {
    json_request(
        app,
        "POST",
        &format!("/api/v1/custom-fields/values/{entity_id}"),
        bearer,
        Some(json!({ "values": [{ "field_id": field_id, "value": value }] })),
    )
    .await
}

/// Security review 2026-11-13 (final-D S3-1): the values of a medical custom
/// field reach only the roles that read medical data of the lead or patient,
/// and only roles with medical edit rights write them. Ordinary fields keep
/// the rights of the card.
#[tokio::test]
async fn medical_custom_fields_follow_the_medical_access() {
    let Some(ctx) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let app = &ctx.app;
    let pool = &ctx.pool;
    let tag = unique_tag("cf-medical");
    let key_tag = Uuid::new_v4().simple().to_string()[..12].to_string();
    let ceo = auth_header_for(ctx.admin_id, "ceo");

    let lead_id = seed_lead(pool, ctx.admin_id, &tag).await;
    let patient_id = seed_patient(pool, ctx.admin_id, &tag).await;
    let lead_medical = create_field(app, &ceo, "lead", &format!("d{key_tag}_lm"), true).await;
    let lead_plain = create_field(app, &ceo, "lead", &format!("d{key_tag}_lp"), false).await;
    let patient_medical = create_field(app, &ceo, "patient", &format!("d{key_tag}_pm"), true).await;
    let patient_plain = create_field(app, &ceo, "patient", &format!("d{key_tag}_pp"), false).await;

    // The CEO writes both kinds.
    for (entity, field, value) in [
        (lead_id, lead_medical, "synthetic diagnosis"),
        (lead_id, lead_plain, "synthetic clinic"),
        (patient_id, patient_medical, "synthetic finding"),
        (patient_id, patient_plain, "synthetic hotel"),
    ] {
        let (status, body) = write_value(app, &ceo, entity, field, value).await;
        assert_eq!(status, StatusCode::OK, "{body}");
    }

    let admin_id = ctx.admin_id;
    // Assigned to the patient, so the patient card itself is open to them.
    let user = |role: &'static str| {
        let tag = tag.clone();
        async move {
            let id = seed_user(pool, &tag, role).await;
            seed_patient_assignment(pool, patient_id, id, admin_id).await;
            (id, auth_header_for(id, role))
        }
    };
    let (_, pm) = user("patient_manager").await;
    let (_, sales) = user("sales").await;
    let (_, concierge) = user("concierge").await;
    let (_, billing) = user("billing").await;
    let (_, interpreter) = user("interpreter").await;

    // Lead: CEO and PM see the medical field, Sales and Concierge do not.
    for bearer in [&ceo, &pm] {
        let (fields, hidden) = read_values(app, bearer, lead_id).await;
        assert_eq!(hidden, json!(false));
        assert!(fields.contains(&(lead_medical, json!("synthetic diagnosis"))));
        assert!(fields.contains(&(lead_plain, json!("synthetic clinic"))));
    }
    for bearer in [&sales, &concierge] {
        let (fields, hidden) = read_values(app, bearer, lead_id).await;
        assert_eq!(hidden, json!(true));
        assert!(
            fields.iter().all(|(id, _)| *id != lead_medical),
            "{fields:?}"
        );
        assert!(fields.contains(&(lead_plain, json!("synthetic clinic"))));
    }

    // Patient: CEO and PM see it, Billing, Concierge and the interpreter not.
    for bearer in [&ceo, &pm] {
        let (fields, hidden) = read_values(app, bearer, patient_id).await;
        assert_eq!(hidden, json!(false));
        assert!(fields.contains(&(patient_medical, json!("synthetic finding"))));
    }
    for bearer in [&billing, &concierge, &interpreter] {
        let (fields, hidden) = read_values(app, bearer, patient_id).await;
        assert_eq!(hidden, json!(true));
        assert!(
            fields.iter().all(|(id, _)| *id != patient_medical),
            "{fields:?}"
        );
        assert!(fields.contains(&(patient_plain, json!("synthetic hotel"))));
    }

    // Writes: Sales keeps the ordinary lead field, never the medical one.
    let (status, body) = write_value(app, &sales, lead_id, lead_plain, "sales clinic").await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let (status, body) = write_value(app, &sales, lead_id, lead_medical, "sales text").await;
    assert_eq!(status, StatusCode::FORBIDDEN, "{body}");
    assert_eq!(body["error"], "custom_field_medical_forbidden");
    // PM writes the medical fields of lead and patient.
    let (status, body) = write_value(app, &pm, lead_id, lead_medical, "pm diagnosis").await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let (status, body) = write_value(app, &pm, patient_id, patient_medical, "pm finding").await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let stored: Option<String> = sqlx::query_scalar(
        "SELECT value FROM custom_field_values WHERE field_id = $1 AND entity_id = $2",
    )
    .bind(lead_medical)
    .bind(lead_id)
    .fetch_one(pool)
    .await
    .unwrap();
    assert_eq!(stored.as_deref(), Some("pm diagnosis"));

    // The definition list reports the flag; IT admin may not make a medical
    // field ordinary again, the CEO may.
    let (status, list) = json_request(
        app,
        "GET",
        "/api/v1/admin/custom-fields?entity_type=lead",
        &ceo,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{list}");
    let listed = list
        .as_array()
        .unwrap()
        .iter()
        .find(|field| field["id"] == json!(lead_medical))
        .cloned()
        .unwrap();
    assert_eq!(listed["is_medical"], true);
    let it_admin_id = seed_user(pool, &tag, "it_admin").await;
    let it_admin = auth_header_for(it_admin_id, "it_admin");
    let update = |is_medical: bool| {
        json!({
            "entity_type": "lead",
            "field_key": "ignored",
            "field_label": "Diagnose",
            "field_type": "text",
            "is_medical": is_medical,
        })
    };
    let (status, body) = json_request(
        app,
        "POST",
        &format!("/api/v1/admin/custom-fields/{lead_medical}/update"),
        &it_admin,
        Some(update(false)),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN, "{body}");
    assert_eq!(body["error"], "custom_field_medical_unset_forbidden");
    let (status, body) = json_request(
        app,
        "POST",
        &format!("/api/v1/admin/custom-fields/{lead_plain}/update"),
        &it_admin,
        Some(update(true)),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let (status, body) = json_request(
        app,
        "POST",
        &format!("/api/v1/admin/custom-fields/{lead_medical}/update"),
        &ceo,
        Some(update(false)),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let (fields, _) = read_values(app, &sales, lead_id).await;
    assert!(fields.contains(&(lead_medical, json!("pm diagnosis"))));
    assert!(fields.iter().all(|(id, _)| *id != lead_plain), "{fields:?}");
}
