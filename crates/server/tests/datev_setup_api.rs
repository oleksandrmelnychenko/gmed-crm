use axum::{
    Extension,
    body::Body,
    http::{Request, StatusCode},
};
use serde_json::{Value, json};
use tower::ServiceExt;
use uuid::Uuid;

const SECRET: &str = "datev-setup-test-secret-at-least-32-characters";

async fn request(
    app: &axum::Router,
    method: &str,
    role: &str,
    user: Uuid,
    payload: Value,
) -> (StatusCode, Value) {
    let auth = gmed_server::auth::middleware::AuthUser {
        user_id: user,
        role: match role {
            "ceo" => gmed_domain::role::Role::Ceo,
            _ => gmed_domain::role::Role::Billing,
        },
        family_id: Uuid::new_v4(),
        access_token_jti: Uuid::new_v4(),
        access_token_expires_at: chrono::Utc::now() + chrono::Duration::hours(1),
    };
    let response = app
        .clone()
        .layer(Extension(auth))
        .oneshot(
            Request::builder()
                .method(method)
                .uri("/admin/datev/setup")
                .header("Content-Type", "application/json")
                .body(if method == "GET" {
                    Body::empty()
                } else {
                    Body::from(payload.to_string())
                })
                .unwrap(),
        )
        .await
        .unwrap();
    let status = response.status();
    let bytes = axum::body::to_bytes(response.into_body(), 32 * 1024)
        .await
        .unwrap();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}

// Exercise DATEV handlers against their real migration, independently of legacy
// data-repair migrations. Global authentication is covered by auth suites/live QA.
#[tokio::test]
async fn datev_setup_authorization_validation_persistence_and_conflicts() {
    let database = support::isolated_schema_database()
        .await
        .expect("DATEV API tests require a test database");
    let pool = database.pool.clone();
    sqlx::raw_sql("CREATE TABLE users (id UUID PRIMARY KEY)")
        .execute(&pool)
        .await
        .unwrap();
    sqlx::raw_sql(include_str!(
        "../../../migrations/20260905210000_datev_integration_setup.sql"
    ))
    .execute(&pool)
    .await
    .unwrap();
    let admin_id = Uuid::new_v4();
    sqlx::query("INSERT INTO users (id) VALUES ($1)")
        .bind(admin_id)
        .execute(&pool)
        .await
        .unwrap();
    let state = gmed_server::state::AppState::new(
        pool,
        SECRET,
        gmed_server::settings::SettingsCache::new(gmed_server::settings::TokenSettings::default()),
    );
    struct Context {
        app: axum::Router,
        admin_id: Uuid,
    }
    let ctx = Context {
        app: gmed_server::routes::datev::router().with_state(state),
        admin_id,
    };
    let (status, initial) = request(&ctx.app, "GET", "ceo", ctx.admin_id, Value::Null).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(initial["profile"]["modules"].as_array().unwrap().len(), 6);
    assert_eq!(initial["accounting_writes_enabled"], false);
    for method in ["GET", "PUT"] {
        assert_eq!(
            request(
                &ctx.app,
                method,
                "billing",
                ctx.admin_id,
                json!({"revision":null,"profile":initial["profile"]})
            )
            .await
            .0,
            StatusCode::FORBIDDEN
        );
    }
    let mut profile = initial["profile"].clone();
    profile["consultant_number"] = json!("0012345");
    assert_eq!(
        request(
            &ctx.app,
            "PUT",
            "ceo",
            ctx.admin_id,
            json!({"revision":null,"profile":profile})
        )
        .await
        .0,
        StatusCode::UNPROCESSABLE_ENTITY
    );
    profile["client_number"] = json!("00012");
    profile["export_service"] = json!("ordered");
    let payload = json!({"revision":null,"profile":profile});
    let (status, saved) = request(&ctx.app, "PUT", "ceo", ctx.admin_id, payload.clone()).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(saved["profile"]["client_number"], "00012");
    assert_eq!(saved["connection_status"], "not_configured");
    assert_eq!(
        request(&ctx.app, "PUT", "ceo", ctx.admin_id, payload)
            .await
            .0,
        StatusCode::CONFLICT
    );
    let (_, loaded) = request(&ctx.app, "GET", "ceo", ctx.admin_id, Value::Null).await;
    assert_eq!(loaded["revision"], saved["revision"]);
    profile["modules"] = json!(["belege", "bank"]);
    let valid_update = json!({"revision":saved["revision"],"profile":profile});
    let (status, updated) =
        request(&ctx.app, "PUT", "ceo", ctx.admin_id, valid_update.clone()).await;
    assert_eq!(status, StatusCode::OK);
    assert_ne!(updated["revision"], saved["revision"]);
    assert_eq!(
        request(&ctx.app, "PUT", "ceo", ctx.admin_id, valid_update)
            .await
            .0,
        StatusCode::CONFLICT
    );
    profile["accounting_writes_enabled"] = json!(true);
    assert_eq!(
        request(
            &ctx.app,
            "PUT",
            "ceo",
            ctx.admin_id,
            json!({"revision":updated["revision"],"profile":profile})
        )
        .await
        .0,
        StatusCode::UNPROCESSABLE_ENTITY
    );
}
#[allow(dead_code)]
mod support;
