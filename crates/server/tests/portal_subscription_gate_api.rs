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

async fn post(
    app: &axum::Router,
    token: &str,
    path: &str,
    patient: Uuid,
    body: Value,
) -> (StatusCode, Value) {
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/api/v1{path}"))
                .header("Authorization", token)
                .header("X-Patient-Id", patient.to_string())
                .header("Content-Type", "application/json")
                .body(Body::from(serde_json::to_vec(&body).unwrap()))
                .unwrap(),
        )
        .await
        .unwrap();
    let status = response.status();
    let body = axum::body::to_bytes(response.into_body(), 4 * 1024 * 1024)
        .await
        .unwrap();
    (status, serde_json::from_slice(&body).unwrap_or(json!(null)))
}

fn concierge_request(title: &str) -> Value {
    json!({
        "service_kind": "transfer",
        "title": title,
        "starts_at": "2099-04-22T09:00:00Z"
    })
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

/// The team chat is the module that needs an active tariff (owner decision
/// 9, 2026-11-13); `/me` reports the tariff of the selected person.
async fn assert_access(app: &axum::Router, token: &str, patient_id: Uuid, allowed: bool) {
    let (status, body) = request(app, token, "/messages/conversations", Some(patient_id)).await;
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

async fn post_appointment_request(
    app: &axum::Router,
    token: &str,
    patient: Uuid,
) -> (StatusCode, Value) {
    post(
        app,
        token,
        "/me/appointment-requests",
        patient,
        json!({
            "appointment_type": "medical",
            "reason": "Synthetic request"
        }),
    )
    .await
}

#[tokio::test]
async fn the_chat_needs_a_current_released_subscription_in_an_order() {
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
    let (assigned, order) = subscription(pool, patient_id, ctx.admin_id).await;
    assert_access(&ctx.app, &token, patient_id, true).await;
    for status in ["draft", "paused", "completed", "cancelled"] {
        sqlx::query("UPDATE patient_service_packages SET status=$2 WHERE id=$1")
            .bind(assigned)
            .bind(status)
            .execute(pool)
            .await
            .unwrap();
        let (code, me) = request(&ctx.app, &token, "/me", Some(patient_id)).await;
        assert_eq!(code, StatusCode::OK, "{me}");
        assert_eq!(me["patients"][0]["has_active_subscription"], false, "{me}");
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

/// Owner decision 9 (2026-11-13): the order tariff is optional. Without one
/// the portal shows everything of the patient's own orders — visits,
/// documents, invoices, notifications, recommendations, the subscriptions
/// page and the concierge services already booked; only a new concierge
/// request and the team chat need a tariff. Staff routes stay refused by
/// their own role checks.
#[tokio::test]
async fn without_a_tariff_the_portal_shows_the_own_orders_and_locks_only_new_concierge_requests_and_the_chat()
 {
    let Some(ctx) = support::suite_context(SECRET).await else {
        return;
    };
    let pool = &ctx.pool;
    let patient_id = patient(pool, ctx.admin_id).await;
    let user_id = user(pool).await;
    assign(pool, patient_id, user_id, ctx.admin_id, "manual").await;
    let token = bearer(user_id, "patient");
    // A service staff booked for the patient (no tariff anywhere).
    let booked: Uuid = sqlx::query_scalar(
        "INSERT INTO concierge_services(patient_id, service_kind, title, starts_at, status, created_by)
         VALUES($1, 'transfer', 'Synthetic booked transfer', '2099-04-22T09:00:00Z', 'booked', $2)
         RETURNING id",
    )
    .bind(patient_id)
    .bind(ctx.admin_id)
    .fetch_one(pool)
    .await
    .unwrap();

    for path in [
        "/me/profile",
        "/me/privacy-requests",
        "/me/documents",
        "/me/invoices",
        "/me/account-statement",
        "/me/appointments",
        "/me/appointment-requests",
        "/me/followup-milestones",
        "/me/subscriptions",
        "/me/recommendations",
        "/me/next-actions",
        "/notifications",
        "/notifications/unread-count",
    ] {
        let (status, body) = request(&ctx.app, &token, path, Some(patient_id)).await;
        assert_eq!(status, StatusCode::OK, "{path}: {body}");
    }
    let (status, body) =
        request(&ctx.app, &token, "/me/concierge-services", Some(patient_id)).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert!(
        body.as_array()
            .expect("service list")
            .iter()
            .any(|service| service["id"] == booked.to_string()),
        "the booked service is listed: {body}"
    );

    // Locked: the team chat and a new concierge request.
    for path in ["/messages/conversations", "/messages/unread-total"] {
        let (status, body) = request(&ctx.app, &token, path, Some(patient_id)).await;
        assert_eq!(status, StatusCode::FORBIDDEN, "{path}: {body}");
        assert_eq!(body["error"], "subscription_required");
    }
    let (status, body) = post(
        &ctx.app,
        &token,
        "/me/concierge-services",
        patient_id,
        concierge_request("Synthetic request without a tariff"),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN, "{body}");
    assert_eq!(body["error"], "subscription_required");

    // An appointment request is no tariff module.
    let (status, body) = post_appointment_request(&ctx.app, &token, patient_id).await;
    assert_ne!(body["error"], "subscription_required", "{status}: {body}");

    // Staff routes keep their own refusal.
    let (status, body) = request(&ctx.app, &token, "/patients", Some(patient_id)).await;
    assert_eq!(status, StatusCode::FORBIDDEN, "{body}");

    // With the tariff the chat and a new request open.
    subscription(pool, patient_id, ctx.admin_id).await;
    let (status, body) = request(
        &ctx.app,
        &token,
        "/messages/conversations",
        Some(patient_id),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let (status, body) = post(
        &ctx.app,
        &token,
        "/me/concierge-services",
        patient_id,
        concierge_request("Synthetic request with a tariff"),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
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
    let (status, body) = request(&ctx.app, &token, "/messages/conversations", None).await;
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

/// Owner decision 2026-11-10: a paused subscription closes new actions but
/// neither hides what is agreed nor cuts the contact. The patient reads the
/// own visits and subscriptions and chats; a new request stays refused.
#[tokio::test]
async fn a_paused_subscription_keeps_agreed_visits_and_the_chat_open() {
    let Some(ctx) = support::suite_context(SECRET).await else {
        return;
    };
    let pool = &ctx.pool;
    let patient_id = patient(pool, ctx.admin_id).await;
    let user_id = user(pool).await;
    assign(pool, patient_id, user_id, ctx.admin_id, "manual").await;
    let token = bearer(user_id, "patient");
    let (assigned, _order) = subscription(pool, patient_id, ctx.admin_id).await;
    // Two concierge requests made while the subscription was active.
    let mut requested = Vec::new();
    for title in ["Synthetic airport pickup", "Synthetic hotel transfer"] {
        let (status, body) = post(
            &ctx.app,
            &token,
            "/me/concierge-services",
            patient_id,
            concierge_request(title),
        )
        .await;
        assert_eq!(status, StatusCode::CREATED, "{body}");
        requested.push(body["id"].as_str().expect("service id").to_string());
    }
    sqlx::query("UPDATE patient_service_packages SET status='paused' WHERE id=$1")
        .bind(assigned)
        .execute(pool)
        .await
        .unwrap();

    let (status, me) = request(&ctx.app, &token, "/me", Some(patient_id)).await;
    assert_eq!(status, StatusCode::OK, "{me}");
    let linked = &me["patients"][0];
    assert_eq!(linked["has_active_subscription"], false, "{me}");
    assert_eq!(linked["subscription_paused"], true, "{me}");

    for path in [
        "/me/appointments",
        "/me/appointment-requests",
        "/me/subscriptions",
        "/me/recommendations",
        "/messages/conversations",
        "/messages/allowed-peers",
        "/messages/unread-total",
        "/notifications",
    ] {
        let (status, body) = request(&ctx.app, &token, path, Some(patient_id)).await;
        assert_eq!(status, StatusCode::OK, "{path}: {body}");
    }

    // Owner decision 2026-11-12: the own concierge requests stay readable
    // and an open one can be cancelled; a new one is refused.
    let (status, body) =
        request(&ctx.app, &token, "/me/concierge-services", Some(patient_id)).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let listed: Vec<&str> = body
        .as_array()
        .expect("service list")
        .iter()
        .filter_map(|service| service["id"].as_str())
        .collect();
    for id in &requested {
        assert!(listed.contains(&id.as_str()), "{id} missing in {body}");
    }
    let (status, body) = post(
        &ctx.app,
        &token,
        &format!("/me/concierge-services/{}/cancel", requested[0]),
        patient_id,
        json!({}),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["status"], "cancelled", "{body}");
    let (status, body) = post(
        &ctx.app,
        &token,
        "/me/concierge-services",
        patient_id,
        concierge_request("Synthetic new request during the pause"),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN, "{body}");
    assert_eq!(body["error"], "subscription_required");
    let open_requests: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM concierge_services WHERE patient_id=$1 AND status <> 'cancelled'",
    )
    .bind(patient_id)
    .fetch_one(pool)
    .await
    .unwrap();
    assert_eq!(open_requests, 1);

    // A new appointment request is a new action: refused during the pause.
    let (status, body) = post_appointment_request(&ctx.app, &token, patient_id).await;
    assert_eq!(status, StatusCode::FORBIDDEN, "{body}");
    assert_eq!(body["error"], "subscription_required");

    // Without any tariff (cancelled) the own records stay open (owner
    // decision 9, 2026-11-13), the chat closes.
    sqlx::query("UPDATE patient_service_packages SET status='cancelled' WHERE id=$1")
        .bind(assigned)
        .execute(pool)
        .await
        .unwrap();
    for path in ["/me/appointments", "/me/concierge-services"] {
        let (status, body) = request(&ctx.app, &token, path, Some(patient_id)).await;
        assert_eq!(status, StatusCode::OK, "{path}: {body}");
    }
    let (status, body) = request(
        &ctx.app,
        &token,
        "/messages/conversations",
        Some(patient_id),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN, "{body}");
}
