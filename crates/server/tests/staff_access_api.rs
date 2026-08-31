mod support;

use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use gmed_server::auth::jwt;
use serde_json::{Value, json};
use sqlx::PgPool;
use tower::ServiceExt;
use uuid::Uuid;

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
    body: Value,
) -> (StatusCode, Value) {
    let request = Request::builder()
        .method(method)
        .uri(path)
        .header("Authorization", bearer)
        .header("Content-Type", "application/json")
        .body(Body::from(serde_json::to_vec(&body).unwrap()))
        .unwrap();
    let response = app.clone().oneshot(request).await.unwrap();
    let status = response.status();
    let bytes = axum::body::to_bytes(response.into_body(), 1024 * 1024)
        .await
        .unwrap();
    let payload = serde_json::from_slice(&bytes).unwrap_or(json!(null));
    (status, payload)
}

async fn seed_user(pool: &PgPool, role: &str, active: bool) -> Uuid {
    let suffix = Uuid::new_v4().simple().to_string();
    sqlx::query_scalar(
        r#"INSERT INTO users (email, password_hash, name, role, is_active)
           VALUES ($1, 'test-password-hash', $2, $3, $4)
           RETURNING id"#,
    )
    .bind(format!("staff-access-{role}-{suffix}@example.com"))
    .bind(format!("Staff access {role}"))
    .bind(role)
    .bind(active)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn seed_provider(pool: &PgPool) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO providers (name, provider_type)
           VALUES ($1, 'medical')
           RETURNING id"#,
    )
    .bind(format!("Staff access provider {}", Uuid::new_v4().simple()))
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn seed_document(pool: &PgPool, uploaded_by: Uuid, is_medical: bool) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO documents (auto_name, art, is_medical, uploaded_by)
           VALUES ($1, 'staff_access_test', $2, $3)
           RETURNING id"#,
    )
    .bind(format!("staff-access-{}", Uuid::new_v4().simple()))
    .bind(is_medical)
    .bind(uploaded_by)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn seed_patient(pool: &PgPool, created_by: Uuid, active: bool) -> Uuid {
    let suffix = Uuid::new_v4().simple().to_string();
    sqlx::query_scalar(
        r#"INSERT INTO patients (
               patient_id, first_name, last_name, birth_date, gender,
               email, is_active, lifecycle_status, created_by
           ) VALUES ($1, 'Ivan', $2, '1990-01-01', 'diverse', $3, $4, $5, $6)
           RETURNING id"#,
    )
    .bind(format!("ACL-{suffix}"))
    .bind(format!("Catalog {suffix}"))
    .bind(format!("acl-catalog-{suffix}@example.com"))
    .bind(active)
    .bind(if active { "active" } else { "inactive" })
    .bind(created_by)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn create_profile(
    app: &axum::Router,
    bearer: &str,
    name: &str,
    role: &str,
    rules: Value,
) -> Value {
    let (status, body) = json_request(
        app,
        "POST",
        "/api/v1/staff-access/profiles",
        bearer,
        json!({
            "name": name,
            "description": "Reusable test profile",
            "roles": [role],
            "rules": rules,
        }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    body
}

#[tokio::test]
async fn staff_access_api_requires_exact_ceo_role() {
    let Some((app, pool, _admin_id)) = test_context().await else {
        return;
    };
    let concierge_id = seed_user(&pool, "concierge", true).await;
    let bearer = auth_header_for(concierge_id, "concierge");

    let (status, body) = json_request(
        &app,
        "GET",
        "/api/v1/staff-access/profiles",
        &bearer,
        json!(null),
    )
    .await;

    assert_eq!(status, StatusCode::FORBIDDEN, "{body}");

    let (status, body) = json_request(
        &app,
        "GET",
        "/api/v1/staff-access/resources/provider",
        &bearer,
        json!(null),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN, "{body}");
}

#[tokio::test]
async fn ceo_resource_catalog_includes_inactive_and_medical_records() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };
    let bearer = auth_header_for(admin_id, "ceo");
    let provider_id = seed_provider(&pool).await;
    sqlx::query(
        "UPDATE providers SET provider_type = 'non_medical', is_active = false WHERE id = $1",
    )
    .bind(provider_id)
    .execute(&pool)
    .await
    .unwrap();
    let patient_id = seed_patient(&pool, admin_id, false).await;
    let document_id = seed_document(&pool, admin_id, true).await;

    for (resource_type, expected_id, expected_status, expected_kind) in [
        ("provider", provider_id, "inactive", Some("non_medical")),
        ("patient", patient_id, "inactive", None),
        ("document", document_id, "active", Some("medical")),
    ] {
        let expected_id_text = expected_id.to_string();
        let (status, body) = json_request(
            &app,
            "GET",
            &format!("/api/v1/staff-access/resources/{resource_type}"),
            &bearer,
            json!(null),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{body}");
        let item = body
            .as_array()
            .and_then(|items| {
                items
                    .iter()
                    .find(|item| item["id"].as_str() == Some(expected_id_text.as_str()))
            })
            .unwrap_or_else(|| {
                panic!("resource {expected_id} missing from {resource_type} catalog")
            });
        assert_eq!(item["status"], expected_status);
        match expected_kind {
            Some(kind) => assert_eq!(item["medical_kind"], kind),
            None => assert!(item["medical_kind"].is_null()),
        }
    }

    let (status, body) = json_request(
        &app,
        "GET",
        "/api/v1/staff-access/resources/unsupported",
        &bearer,
        json!(null),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
}

#[tokio::test]
async fn ceo_is_read_only_full_access_and_patient_targets_are_forbidden() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };
    let bearer = auth_header_for(admin_id, "ceo");

    let (status, ceo_access) = json_request(
        &app,
        "GET",
        &format!("/api/v1/staff-access/users/{admin_id}"),
        &bearer,
        json!(null),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{ceo_access}");
    assert_eq!(ceo_access["ceo_full_access"], true);
    assert!(ceo_access["profile"].is_null());
    assert_eq!(ceo_access["direct_rules"], json!([]));

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/staff-access/users/{admin_id}/update"),
        &bearer,
        json!({
            "expected_access_revision": ceo_access["access_revision"],
            "profile_id": null,
            "direct_rules": []
        }),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN, "{body}");
    assert_eq!(body["message"], "CEO access cannot be modified");

    let patient_user_id = seed_user(&pool, "patient", true).await;
    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/staff-access/users/{patient_user_id}"),
        &bearer,
        json!(null),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN, "{body}");
    assert_eq!(
        body["message"],
        "Patient accounts cannot receive staff resource access"
    );
}

#[tokio::test]
async fn ceo_can_create_update_and_clone_reusable_profile() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };
    let bearer = auth_header_for(admin_id, "ceo");
    let provider_id = seed_provider(&pool).await;
    let profile_name = format!("Concierge providers {}", Uuid::new_v4().simple());
    let profile = create_profile(
        &app,
        &bearer,
        &profile_name,
        "concierge",
        json!([{
            "resource_type": "provider",
            "scope_type": "record",
            "resource_id": provider_id,
            "capability": "use",
            "effect": "allow"
        }]),
    )
    .await;
    let profile_id = Uuid::parse_str(profile["id"].as_str().unwrap()).unwrap();
    assert_eq!(profile["version"], 1);
    assert_eq!(profile["roles"], json!(["concierge"]));
    assert_eq!(profile["assigned_user_count"], 0);

    let (status, loaded) = json_request(
        &app,
        "GET",
        &format!("/api/v1/staff-access/profiles/{profile_id}"),
        &bearer,
        json!(null),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{loaded}");
    assert_eq!(loaded["rules"], profile["rules"]);

    let (status, updated) = json_request(
        &app,
        "POST",
        &format!("/api/v1/staff-access/profiles/{profile_id}/update"),
        &bearer,
        json!({
            "expected_version": 1,
            "name": profile_name,
            "description": "Updated description",
            "is_active": true,
            "roles": ["concierge", "billing"],
            "rules": profile["rules"]
        }),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{updated}");
    assert_eq!(updated["version"], 2);
    assert_eq!(updated["roles"], json!(["billing", "concierge"]));

    let (status, conflict) = json_request(
        &app,
        "POST",
        &format!("/api/v1/staff-access/profiles/{profile_id}/update"),
        &bearer,
        json!({
            "expected_version": 1,
            "name": profile_name,
            "description": "Stale writer",
            "is_active": true,
            "roles": ["concierge"],
            "rules": []
        }),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{conflict}");
    assert_eq!(
        conflict["message"],
        "Access profile was changed by another request"
    );

    let clone_name = format!("Concierge providers clone {}", Uuid::new_v4().simple());
    let (status, cloned) = json_request(
        &app,
        "POST",
        &format!("/api/v1/staff-access/profiles/{profile_id}/clone"),
        &bearer,
        json!({"name": clone_name, "description": "Independent clone"}),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{cloned}");
    assert_ne!(cloned["id"], profile["id"]);
    assert_eq!(cloned["version"], 1);
    assert_eq!(cloned["roles"], updated["roles"]);
    assert_eq!(cloned["rules"], updated["rules"]);
    let cloned_id = Uuid::parse_str(cloned["id"].as_str().unwrap()).unwrap();

    support::wait_until("staff access profile audit trail", || {
        let pool = pool.clone();
        async move {
            sqlx::query_scalar::<_, i64>(
                r#"SELECT count(*)
                   FROM audit_log
                   WHERE user_id = $1
                     AND (
                         (entity_id = $2 AND action IN (
                             'create_staff_access_profile',
                             'update_staff_access_profile'
                         ))
                         OR (entity_id = $3 AND action = 'clone_staff_access_profile')
                     )"#,
            )
            .bind(admin_id)
            .bind(profile_id)
            .bind(cloned_id)
            .fetch_one(&pool)
            .await
            .is_ok_and(|count| count == 3)
        }
    })
    .await;
}

#[tokio::test]
async fn user_access_replace_is_atomic_and_revision_guarded() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };
    let bearer = auth_header_for(admin_id, "ceo");
    let concierge_id = seed_user(&pool, "concierge", true).await;
    let provider_id = seed_provider(&pool).await;
    let profile = create_profile(
        &app,
        &bearer,
        &format!("Atomic concierge {}", Uuid::new_v4().simple()),
        "concierge",
        json!([{
            "resource_type": "provider",
            "scope_type": "record",
            "resource_id": provider_id,
            "capability": "view",
            "effect": "allow"
        }]),
    )
    .await;

    let (status, before) = json_request(
        &app,
        "GET",
        &format!("/api/v1/staff-access/users/{concierge_id}"),
        &bearer,
        json!(null),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{before}");
    assert_eq!(before["access_revision"], 0);
    assert!(before["profile"].is_null());

    let update_body = json!({
        "expected_access_revision": 0,
        "profile_id": profile["id"],
        "profile_valid_until": null,
        "direct_rules": [{
            "resource_type": "provider",
            "scope_type": "record",
            "resource_id": provider_id,
            "capability": "edit",
            "effect": "deny",
            "reason": "CEO exception"
        }]
    });
    let (status, updated) = json_request(
        &app,
        "POST",
        &format!("/api/v1/staff-access/users/{concierge_id}/update"),
        &bearer,
        update_body.clone(),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{updated}");
    assert_eq!(updated["access_revision"], 1);
    assert_eq!(updated["profile"]["id"], profile["id"]);
    assert_eq!(updated["direct_rules"].as_array().unwrap().len(), 1);

    let (status, conflict) = json_request(
        &app,
        "POST",
        &format!("/api/v1/staff-access/users/{concierge_id}/update"),
        &bearer,
        update_body,
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{conflict}");
    assert_eq!(
        conflict["message"],
        "User access was changed by another request"
    );

    let state: (i64, i64, i64) = sqlx::query_as(
        r#"SELECT users.access_revision,
                  (SELECT count(*) FROM staff_access_profile_assignments
                   WHERE user_id = users.id AND revoked_at IS NULL),
                  (SELECT count(*) FROM staff_user_access_rules
                   WHERE user_id = users.id AND revoked_at IS NULL)
           FROM users
           WHERE users.id = $1"#,
    )
    .bind(concierge_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(state, (1, 1, 1));
}

#[tokio::test]
async fn assignment_rejects_incompatible_or_inactive_targets() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };
    let bearer = auth_header_for(admin_id, "ceo");
    let concierge_id = seed_user(&pool, "concierge", true).await;
    let inactive_concierge_id = seed_user(&pool, "concierge", false).await;
    let profile = create_profile(
        &app,
        &bearer,
        &format!("Billing only {}", Uuid::new_v4().simple()),
        "billing",
        json!([]),
    )
    .await;

    for (target, expected_message) in [
        (
            concierge_id,
            "Access profile is incompatible with the user's role",
        ),
        (inactive_concierge_id, "User is inactive"),
    ] {
        let (status, body) = json_request(
            &app,
            "POST",
            &format!("/api/v1/staff-access/users/{target}/update"),
            &bearer,
            json!({
                "expected_access_revision": 0,
                "profile_id": profile["id"],
                "direct_rules": []
            }),
        )
        .await;
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
        assert_eq!(body["message"], expected_message);
    }
}

#[tokio::test]
async fn medical_document_allow_cannot_cross_concierge_boundary() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };
    let bearer = auth_header_for(admin_id, "ceo");
    let concierge_id = seed_user(&pool, "concierge", true).await;
    let provider_id = seed_provider(&pool).await;
    let document_id = seed_document(&pool, admin_id, true).await;

    let (status, invalid_capability) = json_request(
        &app,
        "POST",
        &format!("/api/v1/staff-access/users/{concierge_id}/update"),
        &bearer,
        json!({
            "expected_access_revision": 0,
            "profile_id": null,
            "direct_rules": [{
                "resource_type": "provider",
                "scope_type": "record",
                "resource_id": provider_id,
                "capability": "upload",
                "effect": "allow"
            }]
        }),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::UNPROCESSABLE_ENTITY,
        "{invalid_capability}"
    );
    assert_eq!(
        invalid_capability["message"],
        "Capability is not valid for this resource type"
    );

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/staff-access/users/{concierge_id}/update"),
        &bearer,
        json!({
            "expected_access_revision": 0,
            "profile_id": null,
            "direct_rules": [{
                "resource_type": "document",
                "scope_type": "record",
                "resource_id": document_id,
                "capability": "view",
                "effect": "allow",
                "reason": "must remain blocked"
            }]
        }),
    )
    .await;

    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
    assert_eq!(
        body["message"],
        "Allow rule crosses an absolute resource access boundary"
    );
    let revision: i64 = sqlx::query_scalar("SELECT access_revision FROM users WHERE id = $1")
        .bind(concierge_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(revision, 0);
}

#[tokio::test]
async fn profile_mutation_invalidates_current_assignees() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };
    let bearer = auth_header_for(admin_id, "ceo");
    let billing_id = seed_user(&pool, "billing", true).await;
    let profile_name = format!("Billing resources {}", Uuid::new_v4().simple());
    let profile = create_profile(&app, &bearer, &profile_name, "billing", json!([])).await;
    let profile_id = profile["id"].as_str().unwrap();

    let (status, assigned) = json_request(
        &app,
        "POST",
        &format!("/api/v1/staff-access/users/{billing_id}/update"),
        &bearer,
        json!({
            "expected_access_revision": 0,
            "profile_id": profile_id,
            "direct_rules": []
        }),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{assigned}");
    assert_eq!(assigned["access_revision"], 1);

    let (status, updated) = json_request(
        &app,
        "POST",
        &format!("/api/v1/staff-access/profiles/{profile_id}/update"),
        &bearer,
        json!({
            "expected_version": 1,
            "name": profile_name,
            "description": "Mutation invalidates effective access caches",
            "is_active": true,
            "roles": ["billing"],
            "rules": []
        }),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{updated}");
    assert_eq!(updated["version"], 2);

    let revision: i64 = sqlx::query_scalar("SELECT access_revision FROM users WHERE id = $1")
        .bind(billing_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(revision, 2);
}
