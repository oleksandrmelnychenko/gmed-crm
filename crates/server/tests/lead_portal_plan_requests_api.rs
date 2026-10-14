//! Catalog interest must create actionable staff work, never a paid subscription.
mod support;

use axum::{
    Router,
    body::Body,
    http::{Request, StatusCode},
};
use serde_json::{Value, json};
use sqlx::{PgPool, Row};
use tower::ServiceExt;
use uuid::Uuid;

const SECRET: &str = "test-secret-at-least-32-characters-long!!";
fn bearer(id: Uuid, role: &str) -> String {
    format!(
        "Bearer {}",
        gmed_server::auth::jwt::issue_access_token(SECRET, id, role, Uuid::new_v4()).unwrap()
    )
}
async fn call(
    app: &Router,
    method: &str,
    lead: Uuid,
    token: &str,
    body: Value,
) -> (StatusCode, Value) {
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(method)
                .uri(format!("/api/v1/me/lead-requests/{lead}/plan-requests"))
                .header("Authorization", token)
                .header("Content-Type", "application/json")
                .body(if method == "GET" {
                    Body::empty()
                } else {
                    Body::from(body.to_string())
                })
                .unwrap(),
        )
        .await
        .unwrap();
    let status = response.status();
    let bytes = axum::body::to_bytes(response.into_body(), 1024 * 1024)
        .await
        .unwrap();
    (
        status,
        serde_json::from_slice(&bytes)
            .unwrap_or_else(|_| json!({"raw":String::from_utf8_lossy(&bytes)})),
    )
}
async fn user(pool: &PgPool) -> Uuid {
    sqlx::query_scalar("INSERT INTO users(email,name,password_hash,role) VALUES($1,'Synthetic portal user','synthetic','patient') RETURNING id")
        .bind(format!("plan-{}@example.test",Uuid::new_v4())).fetch_one(pool).await.unwrap()
}
async fn lead(pool: &PgPool, owner: Uuid, login: Uuid, minor: bool) -> Uuid {
    sqlx::query_scalar("INSERT INTO leads(first_name,last_name,date_of_birth,created_by,portal_user_id,selected_program)
        VALUES('Synthetic','Interest',CASE WHEN $3 THEN CURRENT_DATE - INTERVAL '10 years' ELSE CURRENT_DATE - INTERVAL '30 years' END,$1,$2,'unchanged') RETURNING id")
        .bind(owner).bind(login).bind(minor).fetch_one(pool).await.unwrap()
}
async fn package(pool: &PgPool, key: &str, name: &str) -> Uuid {
    sqlx::query_scalar("INSERT INTO service_packages(package_key,name,description,valid_from) VALUES($1,$2,'Catalog description',CURRENT_DATE-1) RETURNING id")
        .bind(format!("{key}_{}",Uuid::new_v4())).bind(name).fetch_one(pool).await.unwrap()
}

#[tokio::test]
async fn catalog_variants_and_concurrent_interest_create_one_task_without_activation() {
    let Some(suite) = support::suite_context(SECRET).await else {
        return;
    };
    let login = user(&suite.pool).await;
    let lead = lead(&suite.pool, suite.admin_id, login, false).await;
    let one = package(&suite.pool, "gmed_one", "One catalog label").await;
    let reserve1 = package(&suite.pool, "gmed_reserve", "Reserve age variant A").await;
    let reserve2 = package(&suite.pool, "gmed_reserve", "Reserve age variant B").await;
    let treatment = package(&suite.pool, "treatment", "Treatment catalog label").await;
    let other = package(&suite.pool, "unrelated", "Not a portal tariff").await;
    let token = bearer(login, "patient");
    let (status, list) = call(&suite.app, "GET", lead, &token, Value::Null).await;
    assert_eq!(status, StatusCode::OK, "{list}");
    let choices = list["packages"].as_array().unwrap();
    for (id, name, kind) in [
        (one, "One catalog label", "gmed_one"),
        (reserve1, "Reserve age variant A", "gmed_reserve"),
        (reserve2, "Reserve age variant B", "gmed_reserve"),
        (treatment, "Treatment catalog label", "treatment"),
    ] {
        let item = choices
            .iter()
            .find(|item| item["id"] == id.to_string())
            .unwrap();
        assert_eq!(item["name"], name);
        assert_eq!(item["kind"], kind);
        assert!(item.get("price").is_none());
    }
    assert!(!choices.iter().any(|item| item["id"] == other.to_string()));
    let body = json!({"package_id":reserve2,"module_id":"invoices"});
    let (first, second) = tokio::join!(
        call(&suite.app, "POST", lead, &token, body.clone()),
        call(&suite.app, "POST", lead, &token, body)
    );
    assert!(
        (first.0 == StatusCode::CREATED && second.0 == StatusCode::OK)
            || (first.0 == StatusCode::OK && second.0 == StatusCode::CREATED),
        "{first:?} {second:?}"
    );
    assert_eq!(first.1["request"]["id"], second.1["request"]["id"]);
    assert_eq!(first.1["request"]["package_name"], "Reserve age variant B");
    assert_eq!(first.1["request"]["subscription_kind"], "gmed_reserve");
    let rows=sqlx::query("SELECT r.id,r.task_id,t.assigned_to,t.assigned_by,t.description FROM lead_portal_plan_requests r JOIN tasks t ON t.id=r.task_id WHERE r.lead_id=$1")
        .bind(lead).fetch_all(&suite.pool).await.unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].get::<Uuid, _>("assigned_to"), suite.admin_id);
    assert_eq!(rows[0].get::<Uuid, _>("assigned_by"), suite.admin_id);
    assert!(
        rows[0]
            .get::<String, _>("description")
            .contains(&format!("/leads?lead={lead}&view=wizard"))
    );
    let notifications:i64=sqlx::query_scalar("SELECT count(*) FROM user_notifications WHERE entity_id=$1 AND kind='lead_portal_plan_request'")
        .bind(lead).fetch_one(&suite.pool).await.unwrap();
    let expected_recipients: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM users WHERE is_active AND (id=$1 OR role='patient_manager')",
    )
    .bind(suite.admin_id)
    .fetch_one(&suite.pool)
    .await
    .unwrap();
    assert_eq!(notifications, expected_recipients);
    let audits: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM audit_log WHERE entity_id=$1 AND action='lead_portal_plan_requested'",
    )
    .bind(lead)
    .fetch_one(&suite.pool)
    .await
    .unwrap();
    assert_eq!(audits, 1);
    let selected: String = sqlx::query_scalar("SELECT selected_program FROM leads WHERE id=$1")
        .bind(lead)
        .fetch_one(&suite.pool)
        .await
        .unwrap();
    assert_eq!(selected, "unchanged");
    let assignments: i64 =
        sqlx::query_scalar("SELECT count(*) FROM patient_service_packages WHERE package_id=$1")
            .bind(reserve2)
            .fetch_one(&suite.pool)
            .await
            .unwrap();
    assert_eq!(assignments, 0);
    // Closing the staff task closes the receipt and permits a new intentional request.
    sqlx::query("UPDATE tasks SET status='completed',completed_at=clock_timestamp() WHERE id=$1")
        .bind(rows[0].get::<Uuid, _>("task_id"))
        .execute(&suite.pool)
        .await
        .unwrap();
    let (_, list) = call(&suite.app, "GET", lead, &token, Value::Null).await;
    assert_eq!(list["requests"][0]["status"], "closed");
    let (status, new) = call(
        &suite.app,
        "POST",
        lead,
        &token,
        json!({"package_id":reserve2,"module_id":"invoices"}),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{new}");
    assert_ne!(new["request"]["id"], first.1["request"]["id"]);
}

#[tokio::test]
async fn requests_require_current_self_or_guardian_access_and_hide_other_users_receipts() {
    let Some(suite) = support::suite_context(SECRET).await else {
        return;
    };
    let child_user = user(&suite.pool).await;
    let parent = user(&suite.pool).await;
    let stranger = user(&suite.pool).await;
    let child = lead(&suite.pool, suite.admin_id, child_user, true).await;
    let contact = Uuid::new_v4();
    sqlx::query("UPDATE leads SET trusted_contacts=$2 WHERE id=$1")
        .bind(child)
        .bind(json!([{"id":contact,"name":"Synthetic Parent","relation":"parent"}]))
        .execute(&suite.pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO lead_portal_access(lead_id,user_id,kind,trusted_contact_id,created_by) VALUES($1,$2,'guardian',$3,$4)")
        .bind(child).bind(parent).bind(contact).bind(suite.admin_id).execute(&suite.pool).await.unwrap();
    let plan = package(&suite.pool, "gmed_one", "One").await;
    let body = json!({"package_id":plan,"module_id":"documents"});
    for method in ["GET", "POST"] {
        assert_eq!(
            call(
                &suite.app,
                method,
                child,
                &bearer(child_user, "patient"),
                body.clone()
            )
            .await
            .0,
            StatusCode::FORBIDDEN
        );
        assert_eq!(
            call(
                &suite.app,
                method,
                child,
                &bearer(stranger, "patient"),
                body.clone()
            )
            .await
            .0,
            StatusCode::NOT_FOUND
        );
        assert_eq!(
            call(
                &suite.app,
                method,
                child,
                &bearer(suite.admin_id, "ceo"),
                body.clone()
            )
            .await
            .0,
            StatusCode::FORBIDDEN
        );
    }
    let token = bearer(parent, "patient");
    let (status, created) = call(&suite.app, "POST", child, &token, body.clone()).await;
    assert_eq!(status, StatusCode::CREATED, "{created}");
    let audit: Value = sqlx::query_scalar(
        "SELECT context FROM audit_log WHERE entity_id=$1 AND action='lead_portal_plan_requested'",
    )
    .bind(child)
    .fetch_one(&suite.pool)
    .await
    .unwrap();
    assert_eq!(audit["access_kind"], "guardian");
    let second_contact = Uuid::new_v4();
    sqlx::query("INSERT INTO lead_portal_access(lead_id,user_id,kind,trusted_contact_id,created_by) VALUES($1,$2,'guardian',$3,$4)")
        .bind(child).bind(stranger).bind(second_contact).bind(suite.admin_id).execute(&suite.pool).await.unwrap();
    let (status, list) = call(
        &suite.app,
        "GET",
        child,
        &bearer(stranger, "patient"),
        Value::Null,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{list}");
    assert_eq!(list["requests"], json!([]));
    sqlx::query("UPDATE lead_portal_access SET revoked_at=clock_timestamp() WHERE lead_id=$1 AND user_id=$2")
        .bind(child).bind(parent).execute(&suite.pool).await.unwrap();
    assert_eq!(
        call(&suite.app, "POST", child, &token, body.clone())
            .await
            .0,
        StatusCode::NOT_FOUND
    );
    sqlx::query("UPDATE leads SET qualification_status='deleted' WHERE id=$1")
        .bind(child)
        .execute(&suite.pool)
        .await
        .unwrap();
    assert_eq!(
        call(
            &suite.app,
            "GET",
            child,
            &bearer(stranger, "patient"),
            Value::Null
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
}

#[tokio::test]
async fn unavailable_catalog_and_unroutable_interest_never_create_acknowledgements() {
    let Some(suite) = support::suite_context(SECRET).await else {
        return;
    };
    let login = user(&suite.pool).await;
    let lead = lead(&suite.pool, suite.admin_id, login, false).await;
    let active = package(&suite.pool, "gmed_one", "Active").await;
    let inactive = package(&suite.pool, "gmed_reserve", "Inactive").await;
    let future = package(&suite.pool, "treatment", "Future").await;
    let expired = package(&suite.pool, "gmed_one", "Expired history").await;
    let other = package(&suite.pool, "other", "Other").await;
    sqlx::query("UPDATE service_packages SET is_active=false WHERE id=$1")
        .bind(inactive)
        .execute(&suite.pool)
        .await
        .unwrap();
    sqlx::query("UPDATE service_packages SET valid_from=CURRENT_DATE+2 WHERE id=$1")
        .bind(future)
        .execute(&suite.pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO service_package_price_versions(package_id,name,base_price_net,valid_from,valid_to) SELECT id,name,10,CURRENT_DATE-10,CURRENT_DATE-1 FROM service_packages WHERE id=$1")
        .bind(expired).execute(&suite.pool).await.unwrap();
    let token = bearer(login, "patient");
    let (status, list) = call(&suite.app, "GET", lead, &token, Value::Null).await;
    assert_eq!(status, StatusCode::OK, "{list}");
    for id in [inactive, future, expired, other, Uuid::new_v4()] {
        assert!(
            !list["packages"]
                .as_array()
                .unwrap()
                .iter()
                .any(|item| item["id"] == id.to_string())
        );
        assert_eq!(
            call(
                &suite.app,
                "POST",
                lead,
                &token,
                json!({"package_id":id,"module_id":"services"})
            )
            .await
            .0,
            StatusCode::UNPROCESSABLE_ENTITY
        );
    }
    assert_eq!(
        call(
            &suite.app,
            "POST",
            lead,
            &token,
            json!({"package_id":active,"module_id":"arbitrary-admin-action"})
        )
        .await
        .0,
        StatusCode::UNPROCESSABLE_ENTITY
    );
    // No internal recipient means no fake success/receipt/task. Patient stays active.
    sqlx::query("UPDATE users SET is_active=false WHERE role<>'patient'")
        .execute(&suite.pool)
        .await
        .unwrap();
    let (status, payload) = call(
        &suite.app,
        "POST",
        lead,
        &token,
        json!({"package_id":active,"module_id":"services"}),
    )
    .await;
    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE, "{payload}");
    let count: i64 =
        sqlx::query_scalar("SELECT count(*) FROM lead_portal_plan_requests WHERE lead_id=$1")
            .bind(lead)
            .fetch_one(&suite.pool)
            .await
            .unwrap();
    assert_eq!(count, 0);
}

#[tokio::test]
async fn deleting_a_lead_erases_plan_preferences_and_cancels_only_outstanding_work() {
    let Some(suite) = support::suite_context(SECRET).await else {
        return;
    };
    let login = user(&suite.pool).await;
    let target = lead(&suite.pool, suite.admin_id, login, false).await;
    let other_login = user(&suite.pool).await;
    let other = lead(&suite.pool, suite.admin_id, other_login, false).await;
    let plan = package(
        &suite.pool,
        "gmed_reserve",
        "Private package preference marker",
    )
    .await;
    for (id, actor, module) in [
        (target, login, "invoices"),
        (target, login, "services"),
        (other, other_login, "invoices"),
    ] {
        let (status, body) = call(
            &suite.app,
            "POST",
            id,
            &bearer(actor, "patient"),
            json!({"package_id":plan,"module_id":module}),
        )
        .await;
        assert_eq!(status, StatusCode::CREATED, "{body}");
    }
    let completed: Uuid = sqlx::query_scalar(
        "SELECT task_id FROM lead_portal_plan_requests WHERE lead_id=$1 AND module_id='invoices'",
    )
    .bind(target)
    .fetch_one(&suite.pool)
    .await
    .unwrap();
    let pending: Uuid = sqlx::query_scalar(
        "SELECT task_id FROM lead_portal_plan_requests WHERE lead_id=$1 AND module_id='services'",
    )
    .bind(target)
    .fetch_one(&suite.pool)
    .await
    .unwrap();
    sqlx::query("UPDATE tasks SET status='completed',completed_at=clock_timestamp() WHERE id=$1")
        .bind(completed)
        .execute(&suite.pool)
        .await
        .unwrap();
    let response = suite
        .app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/api/v1/leads/{target}/failed-flow"))
                .header("Authorization", bearer(suite.admin_id, "ceo"))
                .header("Content-Type", "application/json")
                .body(Body::from(
                    json!({"resolution":"delete","reason":"patient_declined"}).to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    let status = response.status();
    let bytes = axum::body::to_bytes(response.into_body(), 1024 * 1024)
        .await
        .unwrap();
    assert_eq!(
        status,
        StatusCode::OK,
        "{}",
        String::from_utf8_lossy(&bytes)
    );
    for (task, expected_status) in [(completed, "completed"), (pending, "cancelled")] {
        let row = sqlx::query("SELECT title,description,status FROM tasks WHERE id=$1")
            .bind(task)
            .fetch_one(&suite.pool)
            .await
            .unwrap();
        assert_eq!(row.get::<String, _>("status"), expected_status);
        assert_eq!(row.get::<String, _>("title"), "Anonymisierte Portalanfrage");
        assert!(row.get::<Option<String>, _>("description").is_none());
    }
    let remaining: i64 =
        sqlx::query_scalar("SELECT count(*) FROM lead_portal_plan_requests WHERE lead_id=$1")
            .bind(target)
            .fetch_one(&suite.pool)
            .await
            .unwrap();
    assert_eq!(remaining, 0);
    let notices:i64=sqlx::query_scalar("SELECT count(*) FROM user_notifications WHERE entity_type='lead' AND entity_id=$1 AND kind='lead_portal_plan_request'")
        .bind(target).fetch_one(&suite.pool).await.unwrap();
    assert_eq!(notices, 0);
    let other_status:String=sqlx::query_scalar("SELECT t.status FROM lead_portal_plan_requests r JOIN tasks t ON t.id=r.task_id WHERE r.lead_id=$1")
        .bind(other).fetch_one(&suite.pool).await.unwrap();
    assert_eq!(other_status, "open");
    let audit: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM audit_log WHERE action='lead_portal_plan_requested' AND entity_id=$1",
    )
    .bind(target)
    .fetch_one(&suite.pool)
    .await
    .unwrap();
    assert_eq!(audit, 2, "Actor/action history remains append-only");
}
