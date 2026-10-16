//! Synthetic fixtures against a disposable database only.
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

const SECRET: &str = "test-secret-at-least-32-characters-long!!";

async fn request(
    app: &axum::Router,
    token: &str,
    path: &str,
    patient: Option<Uuid>,
) -> (StatusCode, Value) {
    let mut req = Request::builder()
        .uri(format!("/api/v1{path}"))
        .header("Authorization", token);
    if let Some(id) = patient {
        req = req.header("X-Patient-Id", id.to_string());
    }
    let response = app
        .clone()
        .oneshot(req.body(Body::empty()).unwrap())
        .await
        .unwrap();
    let status = response.status();
    let body = axum::body::to_bytes(response.into_body(), 4 * 1024 * 1024)
        .await
        .unwrap();
    (status, serde_json::from_slice(&body).unwrap_or(json!(null)))
}

fn bearer(user: Uuid, role: &str) -> String {
    format!(
        "Bearer {}",
        jwt::issue_access_token(SECRET, user, role, Uuid::new_v4()).unwrap()
    )
}

async fn patient(pool: &PgPool, actor: Uuid) -> Uuid {
    sqlx::query_scalar(
        "INSERT INTO patients(patient_id,first_name,last_name,birth_date,gender,created_by)
        VALUES($1,'Synthetic','Subscriber','1990-01-01','diverse',$2) RETURNING id",
    )
    .bind(format!("P-{}", Uuid::new_v4()))
    .bind(actor)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn assign(pool: &PgPool, patient: Uuid, user: Uuid, actor: Uuid, source: &str) {
    sqlx::query("INSERT INTO patient_assignments(patient_id,user_id,assigned_by,source) VALUES($1,$2,$3,$4)")
        .bind(patient).bind(user).bind(actor).bind(source).execute(pool).await.unwrap();
}

async fn user(pool: &PgPool) -> Uuid {
    sqlx::query_scalar("INSERT INTO users(email,password_hash,name,role) VALUES($1,'test-hash','Synthetic Parent','patient') RETURNING id")
        .bind(format!("{}@example.test", Uuid::new_v4())).fetch_one(pool).await.unwrap()
}

async fn subscription(pool: &PgPool, patient: Uuid, actor: Uuid) -> (Uuid, Uuid) {
    let order: Uuid = sqlx::query_scalar(
        "INSERT INTO orders(order_number,patient_id,phase,status,created_by)
        VALUES($1,$2,'execution','active',$3) RETURNING id",
    )
    .bind(format!("ORD-{}", Uuid::new_v4()))
    .bind(patient)
    .bind(actor)
    .fetch_one(pool)
    .await
    .unwrap();
    let package: Uuid = sqlx::query_scalar("INSERT INTO service_packages(package_key,name) VALUES($1,'Synthetic Subscription') RETURNING id")
        .bind(format!("sub-{}", Uuid::new_v4())).fetch_one(pool).await.unwrap();
    let assigned = sqlx::query_scalar(
        "INSERT INTO patient_service_packages(patient_id,order_id,package_id,status,portal_visible)
        VALUES($1,$2,$3,'active',true) RETURNING id",
    )
    .bind(patient)
    .bind(order)
    .bind(package)
    .fetch_one(pool)
    .await
    .unwrap();
    (assigned, order)
}

async fn assert_access(app: &axum::Router, token: &str, patient_id: Uuid, allowed: bool) {
    let (status, body) = request(app, token, "/me/recommendations", Some(patient_id)).await;
    assert_eq!(
        status,
        if allowed {
            StatusCode::OK
        } else {
            StatusCode::FORBIDDEN
        },
        "{body}"
    );
    if !allowed {
        assert_eq!(body["error"], "subscription_required");
    }
    let (status, me) = request(app, token, "/me", Some(patient_id)).await;
    assert_eq!(status, StatusCode::OK, "{me}");
    let linked = me["patients"]
        .as_array()
        .unwrap()
        .iter()
        .find(|p| p["id"] == patient_id.to_string())
        .unwrap();
    assert_eq!(linked["has_active_subscription"], allowed);
}

#[tokio::test]
async fn portal_service_access_requires_a_current_released_subscription_in_an_order() {
    let Some(ctx) = support::suite_context(SECRET).await else {
        return;
    };
    let pool = &ctx.pool;
    let unlinked = user(pool).await;
    let (status, body) = request(
        &ctx.app,
        &bearer(unlinked, "patient"),
        "/internal-notes",
        None,
    )
    .await;
    assert_eq!(
        status,
        StatusCode::FORBIDDEN,
        "Unlinked logins remain forbidden: {body}"
    );
    assert_eq!(body["error"], "subscription_required");
    let patient_id = patient(pool, ctx.admin_id).await;
    let user_id = user(pool).await;
    assign(pool, patient_id, user_id, ctx.admin_id, "manual").await;
    let token = bearer(user_id, "patient");
    assert_access(&ctx.app, &token, patient_id, false).await;
    for path in [
        "/me/profile",
        "/me/privacy-requests",
        "/me/documents",
        "/me/invoices",
        "/me/account-statement",
    ] {
        let (status, body) = request(&ctx.app, &token, path, Some(patient_id)).await;
        assert_eq!(status, StatusCode::OK, "{path}: {body}");
    }
    for path in [
        "/me/appointments",
        "/me/subscriptions",
        "/messages/conversations",
        "/notifications",
        "/patients",
    ] {
        let (status, body) = request(&ctx.app, &token, path, Some(patient_id)).await;
        assert_eq!(status, StatusCode::FORBIDDEN, "{path}: {body}");
        assert_eq!(body["error"], "subscription_required");
    }
    let (assigned, order) = subscription(pool, patient_id, ctx.admin_id).await;
    assert_access(&ctx.app, &token, patient_id, true).await;
    for status in ["draft", "paused", "completed", "cancelled"] {
        sqlx::query("UPDATE patient_service_packages SET status=$2 WHERE id=$1")
            .bind(assigned)
            .bind(status)
            .execute(pool)
            .await
            .unwrap();
        assert_access(&ctx.app, &token, patient_id, false).await;
    }
    sqlx::query(
        "UPDATE patient_service_packages SET status='active',portal_visible=false WHERE id=$1",
    )
    .bind(assigned)
    .execute(pool)
    .await
    .unwrap();
    assert_access(&ctx.app, &token, patient_id, false).await;
    for (start, end, allowed) in [
        (1, 10, false),
        (-10, -1, false),
        (0, 0, true),
        (-1, 1, true),
    ] {
        sqlx::query(
            "UPDATE patient_service_packages SET portal_visible=true,
            starts_on=(now() AT TIME ZONE 'Europe/Berlin')::date+$2::int,
            ends_on=(now() AT TIME ZONE 'Europe/Berlin')::date+$3::int WHERE id=$1",
        )
        .bind(assigned)
        .bind(start)
        .bind(end)
        .execute(pool)
        .await
        .unwrap();
        assert_access(&ctx.app, &token, patient_id, allowed).await;
    }
    sqlx::query("UPDATE patient_service_packages SET order_id=NULL WHERE id=$1")
        .bind(assigned)
        .execute(pool)
        .await
        .unwrap();
    assert_access(&ctx.app, &token, patient_id, false).await;
    sqlx::query("UPDATE patient_service_packages SET order_id=$2 WHERE id=$1")
        .bind(assigned)
        .bind(order)
        .execute(pool)
        .await
        .unwrap();
    sqlx::query("UPDATE orders SET status='cancelled' WHERE id=$1")
        .bind(order)
        .execute(pool)
        .await
        .unwrap();
    assert_access(&ctx.app, &token, patient_id, false).await;
    let (status, body) = request(&ctx.app, &bearer(ctx.admin_id, "ceo"), "/patients", None).await;
    assert_eq!(
        status,
        StatusCode::OK,
        "Staff must remain unaffected: {body}"
    );
}

#[tokio::test]
async fn a_family_login_cannot_share_a_subscription_between_patient_contexts() {
    let Some(ctx) = support::suite_context(SECRET).await else {
        return;
    };
    let parent = patient(&ctx.pool, ctx.admin_id).await;
    let child = patient(&ctx.pool, ctx.admin_id).await;
    let user_id = user(&ctx.pool).await;
    assign(&ctx.pool, parent, user_id, ctx.admin_id, "manual").await;
    assign(&ctx.pool, child, user_id, ctx.admin_id, "lead_guardian").await;
    let token = bearer(user_id, "patient");
    subscription(&ctx.pool, child, ctx.admin_id).await;
    assert_access(&ctx.app, &token, parent, false).await;
    assert_access(&ctx.app, &token, child, true).await;
    let (status, body) = request(&ctx.app, &token, "/me/recommendations", None).await;
    assert_eq!(
        status,
        StatusCode::FORBIDDEN,
        "Default own context is unsubscribed: {body}"
    );
    let (status, _) = request(
        &ctx.app,
        &token,
        "/me/recommendations",
        Some(Uuid::new_v4()),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}
