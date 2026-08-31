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

fn auth_header_for(user_id: Uuid, role: &str) -> String {
    let token = jwt::issue_access_token(TEST_SECRET, user_id, role, Uuid::new_v4()).unwrap();
    format!("Bearer {token}")
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

fn unique_tag(prefix: &str) -> String {
    format!("{prefix}-{}", Uuid::new_v4().simple())
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

async fn seed_patient(pool: &PgPool, created_by: Uuid, tag: &str) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO patients (
                patient_id, first_name, last_name, birth_date, gender,
                clinical_warnings, notes, created_by
           ) VALUES ($1, $2, $3, '1990-01-01', 'diverse', $4, $5, $6)
           RETURNING id"#,
    )
    .bind(format!("PT-{tag}"))
    .bind(format!("First {tag}"))
    .bind(format!("Last {tag}"))
    .bind(format!("Clinical {tag}"))
    .bind(format!("Private {tag}"))
    .bind(created_by)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn seed_patient_assignment(
    pool: &PgPool,
    patient_id: Uuid,
    user_id: Uuid,
    assigned_by: Uuid,
) {
    sqlx::query(
        r#"INSERT INTO patient_assignments (patient_id, user_id, assigned_by)
           VALUES ($1, $2, $3)"#,
    )
    .bind(patient_id)
    .bind(user_id)
    .bind(assigned_by)
    .execute(pool)
    .await
    .unwrap();
}

async fn seed_direct_patient_rule(
    pool: &PgPool,
    user_id: Uuid,
    role: &str,
    granted_by: Uuid,
    patient_id: Uuid,
    capability: &str,
    effect: &str,
) {
    sqlx::query(
        r#"INSERT INTO staff_user_access_rules (
                user_id, granted_for_role, resource_type, scope_type,
                resource_id, capability, effect, granted_by
           ) VALUES ($1, $2, 'patient', 'record', $3, $4, $5, $6)"#,
    )
    .bind(user_id)
    .bind(role)
    .bind(patient_id)
    .bind(capability)
    .bind(effect)
    .bind(granted_by)
    .execute(pool)
    .await
    .unwrap();
}

async fn seed_document(
    pool: &PgPool,
    patient_id: Uuid,
    uploaded_by: Uuid,
    tag: &str,
    is_medical: bool,
) -> Uuid {
    let document_id = Uuid::new_v4();
    sqlx::query_scalar(
        r#"INSERT INTO documents (
                id, patient_id, auto_name, original_filename, art, category,
                status, visibility, is_medical, mime_type, file_size,
                version_root_document_id, version_number, uploaded_by
           ) VALUES (
                $1, $2, $3, $4, 'other', 'general',
                'active', 'released_internal', $5, 'application/pdf', 128,
                $1, 1, $6
           )
           RETURNING id"#,
    )
    .bind(document_id)
    .bind(patient_id)
    .bind(format!("Document {tag}"))
    .bind(format!("{tag}.pdf"))
    .bind(is_medical)
    .bind(uploaded_by)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn seed_direct_document_rule(
    pool: &PgPool,
    user_id: Uuid,
    role: &str,
    granted_by: Uuid,
    document_id: Uuid,
    effect: &str,
) {
    sqlx::query(
        r#"INSERT INTO staff_user_access_rules (
                user_id, granted_for_role, resource_type, scope_type,
                resource_id, capability, effect, granted_by
           ) VALUES ($1, $2, 'document', 'record', $3, 'view', $4, $5)"#,
    )
    .bind(user_id)
    .bind(role)
    .bind(document_id)
    .bind(effect)
    .bind(granted_by)
    .execute(pool)
    .await
    .unwrap();
}

async fn assign_patient_profile(
    pool: &PgPool,
    user_id: Uuid,
    admin_id: Uuid,
    patient_id: Uuid,
    tag: &str,
) {
    let profile_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO staff_access_profiles (name, created_by)
           VALUES ($1, $2)
           RETURNING id"#,
    )
    .bind(format!("Patient ACL {tag}"))
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
    sqlx::query(
        r#"INSERT INTO staff_access_profile_rules (
                profile_id, resource_type, scope_type, resource_id,
                capability, effect, created_by
           ) VALUES ($1, 'patient', 'record', $2, 'view', 'allow', $3)"#,
    )
    .bind(profile_id)
    .bind(patient_id)
    .bind(admin_id)
    .execute(pool)
    .await
    .unwrap();
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

fn response_contains_patient(body: &Value, patient_id: Uuid) -> bool {
    body.as_array()
        .is_some_and(|rows| rows.iter().any(|row| row["id"] == patient_id.to_string()))
}

fn response_contains_resource(body: &Value, resource_id: Uuid) -> bool {
    body.as_array()
        .is_some_and(|rows| rows.iter().any(|row| row["id"] == resource_id.to_string()))
}

#[tokio::test]
async fn concierge_reads_only_explicitly_selected_patient_with_field_policies_intact() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };
    let tag = unique_tag("patient-acl-view");
    let concierge_id = seed_staff_user(&pool, &tag, "concierge").await;
    let allowed_id = seed_patient(&pool, admin_id, &format!("{tag}-allowed")).await;
    let hidden_id = seed_patient(&pool, admin_id, &format!("{tag}-hidden")).await;
    seed_direct_patient_rule(
        &pool,
        concierge_id,
        "concierge",
        admin_id,
        allowed_id,
        "view",
        "allow",
    )
    .await;
    sqlx::query(
        r#"INSERT INTO patient_relations (
                patient_id, related_patient_id, related_name, relation_type
           ) VALUES ($1, $2, 'Stored relation', 'relative')"#,
    )
    .bind(allowed_id)
    .bind(hidden_id)
    .execute(&pool)
    .await
    .unwrap();
    let bearer = auth_header_for(concierge_id, "concierge");

    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/patients?search={tag}"),
        &bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert!(response_contains_patient(&body, allowed_id));
    assert!(!response_contains_patient(&body, hidden_id));

    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/patients/{allowed_id}"),
        &bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["id"], allowed_id.to_string());
    assert!(body.get("clinical_warnings").is_none());
    assert!(body.get("notes").is_none());

    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/patients/{allowed_id}/relations"),
        &bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body[0]["related_patient_id"], Value::Null);
    assert_eq!(body[0]["related_patient_pid"], Value::Null);
    assert_eq!(body[0]["related_display_name"], "Stored relation");

    let (status, _) = json_request(
        &app,
        "GET",
        &format!("/api/v1/patients/{hidden_id}"),
        &bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn direct_view_deny_overrides_assignment_and_profile_allow() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };
    let tag = unique_tag("patient-acl-deny");
    let concierge_id = seed_staff_user(&pool, &tag, "concierge").await;
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    assign_patient_profile(&pool, concierge_id, admin_id, patient_id, &tag).await;
    let bearer = auth_header_for(concierge_id, "concierge");

    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/patients/{patient_id}"),
        &bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");

    seed_patient_assignment(&pool, patient_id, concierge_id, admin_id).await;
    seed_direct_patient_rule(
        &pool,
        concierge_id,
        "concierge",
        admin_id,
        patient_id,
        "view",
        "deny",
    )
    .await;

    let (status, _) = json_request(
        &app,
        "GET",
        &format!("/api/v1/patients/{patient_id}"),
        &bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    let (status, _) = json_request(
        &app,
        "GET",
        &format!("/api/v1/patients/{patient_id}/relations"),
        &bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/patients?search={tag}"),
        &bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert!(!response_contains_patient(&body, patient_id));
}

#[tokio::test]
async fn view_does_not_grant_edit_but_view_and_edit_allow_existing_patient_update() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };
    let tag = unique_tag("patient-acl-edit");
    let manager_id = seed_staff_user(&pool, &tag, "patient_manager").await;
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    seed_direct_patient_rule(
        &pool,
        manager_id,
        "patient_manager",
        admin_id,
        patient_id,
        "view",
        "allow",
    )
    .await;
    let bearer = auth_header_for(manager_id, "patient_manager");

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/patients/{patient_id}/update"),
        &bearer,
        Some(json!({ "first_name": "Blocked" })),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN, "{body}");

    seed_direct_patient_rule(
        &pool,
        manager_id,
        "patient_manager",
        admin_id,
        patient_id,
        "edit",
        "allow",
    )
    .await;
    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/patients/{patient_id}/update"),
        &bearer,
        Some(json!({ "first_name": "Allowed" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");

    let first_name: String = sqlx::query_scalar("SELECT first_name FROM patients WHERE id = $1")
        .bind(patient_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(first_name, "Allowed");

    let related_id = seed_patient(&pool, admin_id, &format!("{tag}-related")).await;
    seed_direct_patient_rule(
        &pool,
        manager_id,
        "patient_manager",
        admin_id,
        related_id,
        "view",
        "allow",
    )
    .await;
    let relation = json!({
        "related_patient_id": related_id,
        "related_name": "Related patient",
        "relation_type": "relative"
    });
    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/patients/{patient_id}/relations"),
        &bearer,
        Some(relation.clone()),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN, "{body}");

    seed_direct_patient_rule(
        &pool,
        manager_id,
        "patient_manager",
        admin_id,
        related_id,
        "use",
        "allow",
    )
    .await;
    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/patients/{patient_id}/relations"),
        &bearer,
        Some(relation),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{body}");

    sqlx::query(
        r#"UPDATE staff_user_access_rules
           SET revoked_at = now(), revoked_by = $1
           WHERE user_id = $2
             AND resource_type = 'patient'
             AND resource_id = $3
             AND capability = 'edit'
             AND revoked_at IS NULL"#,
    )
    .bind(admin_id)
    .bind(manager_id)
    .bind(patient_id)
    .execute(&pool)
    .await
    .unwrap();
    seed_direct_patient_rule(
        &pool,
        manager_id,
        "patient_manager",
        admin_id,
        patient_id,
        "edit",
        "deny",
    )
    .await;
    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/patients/{patient_id}/update"),
        &bearer,
        Some(json!({ "first_name": "Denied again" })),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN, "{body}");
}

#[tokio::test]
async fn nested_patient_documents_respect_document_deny_and_medical_boundary() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };
    let tag = unique_tag("patient-doc-acl");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let visible_document_id = seed_document(
        &pool,
        patient_id,
        admin_id,
        &format!("{tag}-visible"),
        false,
    )
    .await;
    let medical_document_id =
        seed_document(&pool, patient_id, admin_id, &format!("{tag}-medical"), true).await;

    let concierge_id = seed_staff_user(&pool, &tag, "concierge").await;
    seed_direct_patient_rule(
        &pool,
        concierge_id,
        "concierge",
        admin_id,
        patient_id,
        "view",
        "allow",
    )
    .await;
    let concierge_bearer = auth_header_for(concierge_id, "concierge");

    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/patients/{patient_id}/documents"),
        &concierge_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert!(!response_contains_resource(&body, visible_document_id));
    assert!(!response_contains_resource(&body, medical_document_id));

    seed_direct_document_rule(
        &pool,
        concierge_id,
        "concierge",
        admin_id,
        visible_document_id,
        "allow",
    )
    .await;
    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/patients/{patient_id}/documents"),
        &concierge_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert!(response_contains_resource(&body, visible_document_id));

    sqlx::query(
        r#"UPDATE staff_user_access_rules
           SET revoked_at = now(), revoked_by = $1
           WHERE user_id = $2
             AND resource_type = 'document'
             AND resource_id = $3
             AND capability = 'view'
             AND revoked_at IS NULL"#,
    )
    .bind(admin_id)
    .bind(concierge_id)
    .bind(visible_document_id)
    .execute(&pool)
    .await
    .unwrap();
    seed_direct_document_rule(
        &pool,
        concierge_id,
        "concierge",
        admin_id,
        visible_document_id,
        "deny",
    )
    .await;
    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/patients/{patient_id}/documents"),
        &concierge_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert!(!response_contains_resource(&body, visible_document_id));

    let billing_id = seed_staff_user(&pool, &tag, "billing").await;
    let billing_bearer = auth_header_for(billing_id, "billing");
    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/patients/{patient_id}/documents"),
        &billing_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert!(response_contains_resource(&body, visible_document_id));
    assert!(!response_contains_resource(&body, medical_document_id));
}
