use axum::{
    Extension,
    body::Body,
    http::{Request, StatusCode},
};
use gmed_server::{
    auth::middleware::AuthUser,
    settings::{SettingsCache, TokenSettings},
    state::AppState,
};
use serde_json::{Value, json};
use tower::ServiceExt;
use uuid::Uuid;
#[allow(dead_code)]
mod support;

async fn call(
    app: &axum::Router,
    auth: Option<AuthUser>,
    method: &str,
    path: &str,
    payload: Value,
    cookie: Option<&str>,
) -> (StatusCode, axum::http::HeaderMap, Value) {
    let app = if let Some(auth) = auth {
        app.clone().layer(Extension(auth))
    } else {
        app.clone()
    };
    let mut req = Request::builder()
        .method(method)
        .uri(path)
        .header("Content-Type", "application/json");
    if let Some(cookie) = cookie {
        req = req.header("Cookie", cookie);
    }
    let response = app
        .oneshot(
            req.body(if payload.is_null() {
                Body::empty()
            } else {
                Body::from(payload.to_string())
            })
            .unwrap(),
        )
        .await
        .unwrap();
    let status = response.status();
    let headers = response.headers().clone();
    let bytes = axum::body::to_bytes(response.into_body(), 1024 * 1024)
        .await
        .unwrap();
    (
        status,
        headers,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}

#[tokio::test]
async fn credentials_are_encrypted_callbacks_bound_and_accounting_writes_unavailable() {
    let database = support::isolated_schema_database()
        .await
        .expect("isolated DATEV database required");
    let pool = database.pool.clone();
    sqlx::raw_sql("CREATE TABLE users(id uuid PRIMARY KEY, role text NOT NULL DEFAULT 'ceo', is_active boolean NOT NULL DEFAULT true, password_reset_required boolean NOT NULL DEFAULT false)").execute(&pool).await.unwrap();
    sqlx::raw_sql(include_str!(
        "../../../migrations/20260905210000_datev_integration_setup.sql"
    ))
    .execute(&pool)
    .await
    .unwrap();
    sqlx::raw_sql(include_str!(
        "../../../migrations/20260914120000_datev_read_connection.sql"
    ))
    .execute(&pool)
    .await
    .unwrap();
    sqlx::raw_sql(include_str!(
        "../../../migrations/20260917210000_datev_long_term_access.sql"
    ))
    .execute(&pool)
    .await
    .unwrap();
    let id = Uuid::new_v4();
    sqlx::query("INSERT INTO users(id) VALUES ($1)")
        .bind(id)
        .execute(&pool)
        .await
        .unwrap();
    let auth = AuthUser {
        user_id: id,
        role: gmed_domain::role::Role::Ceo,
        family_id: Uuid::new_v4(),
        access_token_jti: Uuid::new_v4(),
        access_token_expires_at: chrono::Utc::now() + chrono::Duration::hours(1),
    };
    let state = AppState::new(
        pool.clone(),
        "datev-test-secret-more-than-thirty-two-characters",
        SettingsCache::new(TokenSettings::default()),
    );
    let app = gmed_server::datev::router()
        .merge(gmed_server::datev::public_router())
        .with_state(state.clone());
    let mut denied = auth.clone();
    denied.role = gmed_domain::role::Role::Billing;
    for (method, path) in [
        ("GET", "connection"),
        ("PUT", "connection"),
        ("POST", "authorize"),
        ("POST", "disconnect"),
        ("POST", "check"),
        ("POST", "read"),
        ("GET", "events"),
    ] {
        let payload = if method == "PUT" {
            json!({"revision":null,"credentials":{"client_id":"test-id","client_secret":"test-secret","mode":"sandbox","redirect_uri":"http://localhost:5173/api/v1/datev/oauth/callback","exchange_enabled":true}})
        } else if path == "read" {
            json!({"kind":"fiscal-years"})
        } else {
            Value::Null
        };
        assert_eq!(
            call(
                &app,
                Some(denied.clone()),
                method,
                &format!("/admin/datev/{path}"),
                payload,
                None
            )
            .await
            .0,
            StatusCode::FORBIDDEN
        );
    }
    denied.role = gmed_domain::role::Role::ItAdmin;
    assert_eq!(
        call(
            &app,
            Some(denied),
            "POST",
            "/admin/datev/read",
            json!({"kind":"fiscal-years"}),
            None
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    let (_, _, initial) = call(
        &app,
        Some(auth.clone()),
        "GET",
        "/admin/datev/connection",
        Value::Null,
        None,
    )
    .await;
    assert_eq!(initial["configured"], false);
    let config = json!({"revision":null,"credentials":{"client_id":"test-app-id","client_secret":"synthetic-secret-never-return","mode":"sandbox","redirect_uri":"http://localhost:5173/api/v1/datev/oauth/callback","exchange_enabled":true}});
    let (status, headers, saved) = call(
        &app,
        Some(auth.clone()),
        "PUT",
        "/admin/datev/connection",
        config.clone(),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(headers["cache-control"], "no-store");
    assert!(!saved.to_string().contains("synthetic-secret"));
    assert_eq!(saved["status"], "disconnected");
    let mut connection_expected =
        json!({"revision":saved["revision"],"generation":saved["generation"],"mode":"sandbox"});
    let profile_revision = Uuid::new_v4();
    sqlx::query("INSERT INTO datev_integration_setup (revision,profile) VALUES ($1,$2)")
        .bind(profile_revision)
        .bind(json!({"company_name":"Synthetic company","consultant_number":"29098","client_number":"55003"}))
        .execute(&pool).await.unwrap();
    let expected = json!({"revision":saved["revision"],"generation":saved["generation"],"mode":"sandbox","profile_revision":profile_revision,"consultant_number":29098,"client_number":55003});
    // Deliberately unreadable tokens prove a stale confirmation is rejected
    // before decrypting credentials or contacting any external endpoint.
    sqlx::query("UPDATE datev_read_connection SET status='connected', token_ciphertext=decode('00','hex'), token_nonce=nonce, token_key_id=key_id")
        .execute(&pool).await.unwrap();
    for path in ["check", "read"] {
        for field in [
            "revision",
            "generation",
            "mode",
            "profile_revision",
            "consultant_number",
            "client_number",
        ] {
            let mut stale = expected.clone();
            stale[field] = match field {
                "mode" => json!("production"),
                "consultant_number" | "client_number" => json!(42),
                _ => json!(Uuid::new_v4()),
            };
            let mut request = json!({"expected":stale});
            if path == "read" {
                request["kind"] = json!("fiscal-years");
            }
            let (status, _, body) = call(
                &app,
                Some(auth.clone()),
                "POST",
                &format!("/admin/datev/{path}"),
                request,
                None,
            )
            .await;
            assert_eq!(status, StatusCode::CONFLICT, "{path}: {field}");
            assert_eq!(body["error"], "datev_connection_changed");
        }
        let mut request = json!({"expected":expected});
        if path == "read" {
            request["kind"] = json!("fiscal-years");
        }
        let (status, _, body) = call(
            &app,
            Some(auth.clone()),
            "POST",
            &format!("/admin/datev/{path}"),
            request.clone(),
            None,
        )
        .await;
        assert_eq!(status, StatusCode::BAD_GATEWAY);
        assert_eq!(body["error"], "datev_decryption_failed");
        // A server-side profile edit invalidates the open popup even when the
        // company numbers did not change (including an A -> B -> A edit).
        sqlx::query("UPDATE datev_integration_setup SET revision=$1")
            .bind(Uuid::new_v4())
            .execute(&pool)
            .await
            .unwrap();
        let (_, _, body) = call(
            &app,
            Some(auth.clone()),
            "POST",
            &format!("/admin/datev/{path}"),
            request,
            None,
        )
        .await;
        assert_eq!(body["error"], "datev_connection_changed");
        sqlx::query("UPDATE datev_integration_setup SET revision=$1")
            .bind(profile_revision)
            .execute(&pool)
            .await
            .unwrap();
        let (status, _, body) = call(
            &app,
            Some(auth.clone()),
            "POST",
            &format!("/admin/datev/{path}"),
            json!({"kind":"fiscal-years"}),
            None,
        )
        .await;
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
        assert_eq!(body["error"], "datev_confirmation_required");
    }
    sqlx::query("UPDATE datev_read_connection SET status='disconnected', token_ciphertext=NULL, token_nonce=NULL, token_key_id=NULL")
        .execute(&pool).await.unwrap();
    for path in ["authorize", "disconnect"] {
        for field in ["revision", "generation", "mode"] {
            let mut stale = connection_expected.clone();
            stale[field] = if field == "mode" {
                json!("production")
            } else {
                json!(Uuid::new_v4())
            };
            let (status, _, body) = call(
                &app,
                Some(auth.clone()),
                "POST",
                &format!("/admin/datev/{path}"),
                json!({"expected":stale}),
                None,
            )
            .await;
            assert_eq!(status, StatusCode::CONFLICT);
            assert_eq!(body["error"], "datev_connection_changed");
            let (_, _, unchanged) = call(
                &app,
                Some(auth.clone()),
                "GET",
                "/admin/datev/connection",
                Value::Null,
                None,
            )
            .await;
            assert_eq!(unchanged["generation"], saved["generation"]);
            assert_eq!(unchanged["status"], "disconnected");
        }
        let (status, _, body) = call(
            &app,
            Some(auth.clone()),
            "POST",
            &format!("/admin/datev/{path}"),
            Value::Null,
            None,
        )
        .await;
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
        assert_eq!(body["error"], "datev_confirmation_required");
    }
    let pending: i64 = sqlx::query_scalar("SELECT count(*) FROM datev_oauth_pending")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(pending, 0);
    let mut update = config.clone();
    update["revision"] = saved["revision"].clone();
    let (status, _, body) = call(
        &app,
        Some(auth.clone()),
        "PUT",
        "/admin/datev/connection",
        update.clone(),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(body["error"], "datev_confirmation_required");
    update["generation"] = json!(Uuid::new_v4());
    assert_eq!(
        call(
            &app,
            Some(auth.clone()),
            "PUT",
            "/admin/datev/connection",
            update.clone(),
            None
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    // Revocation must be resolved before credentials or authorization change,
    // even when no tokens are left. Disconnect does not require a company profile.
    sqlx::query("UPDATE datev_read_connection SET status='revocation_pending'")
        .execute(&pool)
        .await
        .unwrap();
    update["generation"] = saved["generation"].clone();
    assert_eq!(
        call(
            &app,
            Some(auth.clone()),
            "PUT",
            "/admin/datev/connection",
            update,
            None
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    let (_, _, body) = call(
        &app,
        Some(auth.clone()),
        "POST",
        "/admin/datev/authorize",
        json!({"expected":connection_expected}),
        None,
    )
    .await;
    assert_eq!(body["error"], "datev_disconnect_first");
    sqlx::query("UPDATE datev_integration_setup SET profile='{}'::jsonb")
        .execute(&pool)
        .await
        .unwrap();
    let (status, _, disconnected) = call(
        &app,
        Some(auth.clone()),
        "POST",
        "/admin/datev/disconnect",
        json!({"expected":connection_expected}),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(disconnected["status"], "disconnected");
    connection_expected["generation"] = disconnected["generation"].clone();
    let ct: Vec<u8> = sqlx::query_scalar("SELECT ciphertext FROM datev_read_connection")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert!(!String::from_utf8_lossy(&ct).contains("synthetic-secret"));
    assert_eq!(
        call(
            &app,
            Some(auth.clone()),
            "PUT",
            "/admin/datev/connection",
            config,
            None
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    assert_eq!(
        call(
            &app,
            Some(auth.clone()),
            "POST",
            "/admin/datev/read",
            json!({"kind":"documents","expected":expected}),
            None
        )
        .await
        .0,
        StatusCode::UNPROCESSABLE_ENTITY
    );
    let (status, headers, started) = call(
        &app,
        Some(auth.clone()),
        "POST",
        "/admin/datev/authorize",
        json!({"expected":connection_expected}),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let cookie = headers["set-cookie"]
        .to_str()
        .unwrap()
        .split(';')
        .next()
        .unwrap()
        .to_string();
    assert!(headers["set-cookie"].to_str().unwrap().contains("HttpOnly"));
    let url = reqwest::Url::parse(started["authorization_url"].as_str().unwrap()).unwrap();
    let state_value = url
        .query_pairs()
        .find(|(k, _)| k == "state")
        .unwrap()
        .1
        .into_owned();
    let callback = format!("/datev/oauth/callback?state={state_value}&error=access_denied");
    // Missing browser cookie cannot consume another browser's pending authorization.
    let (_, headers, _) = call(&app, None, "GET", &callback, Value::Null, None).await;
    assert_eq!(headers["location"], "/admin/datev?datev_result=failed");
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM datev_oauth_pending")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(count, 1);
    let (_, headers, _) = call(&app, None, "GET", &callback, Value::Null, Some(&cookie)).await;
    assert_eq!(headers["referrer-policy"], "no-referrer");
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM datev_oauth_pending")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(count, 0);
    let (_, headers, _) = call(&app, None, "GET", &callback, Value::Null, Some(&cookie)).await;
    assert_eq!(headers["location"], "/admin/datev?datev_result=failed");
    // A pending callback cannot resurrect a deliberately disconnected connection.
    let (_, headers, started) = call(
        &app,
        Some(auth.clone()),
        "POST",
        "/admin/datev/authorize",
        json!({"expected":connection_expected}),
        None,
    )
    .await;
    let cookie = headers["set-cookie"]
        .to_str()
        .unwrap()
        .split(';')
        .next()
        .unwrap()
        .to_string();
    let url = reqwest::Url::parse(started["authorization_url"].as_str().unwrap()).unwrap();
    let state_value = url
        .query_pairs()
        .find(|(k, _)| k == "state")
        .unwrap()
        .1
        .into_owned();
    assert_eq!(
        call(
            &app,
            Some(auth.clone()),
            "POST",
            "/admin/datev/disconnect",
            json!({"expected":connection_expected}),
            None
        )
        .await
        .0,
        StatusCode::OK
    );
    let (_, headers, _) = call(
        &app,
        None,
        "GET",
        &format!("/datev/oauth/callback?state={state_value}&code=not-redeemed"),
        Value::Null,
        Some(&cookie),
    )
    .await;
    assert_eq!(headers["location"], "/admin/datev?datev_result=failed");
    // The latest disconnected session can replace credentials successfully.
    // This uses the same revision as the pending OAuth but its new generation.
    let (_, _, current) = call(
        &app,
        Some(auth.clone()),
        "GET",
        "/admin/datev/connection",
        Value::Null,
        None,
    )
    .await;
    let replacement = json!({"revision":current["revision"],"generation":current["generation"],"credentials":{"client_id":"replacement-app","client_secret":"replacement-synthetic-secret","mode":"sandbox","redirect_uri":"http://localhost:5173/api/v1/datev/oauth/callback","exchange_enabled":true}});
    let (status, _, replaced) = call(
        &app,
        Some(auth.clone()),
        "PUT",
        "/admin/datev/connection",
        replacement,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_ne!(replaced["revision"], current["revision"]);
    assert_eq!(replaced["status"], "disconnected");
    assert!(
        !replaced
            .to_string()
            .contains("replacement-synthetic-secret")
    );
    let (_, _, events) = call(
        &app,
        Some(auth),
        "GET",
        "/admin/datev/events",
        Value::Null,
        None,
    )
    .await;
    assert!(!events.to_string().contains("synthetic-secret"));
    assert!(!events.to_string().contains("not-redeemed"));
    assert!(
        events
            .as_array()
            .unwrap()
            .iter()
            .any(|e| e["outcome"] == "datev_connection_changed")
    );
    assert!(
        events
            .as_array()
            .unwrap()
            .iter()
            .any(|e| e["outcome"] == "datev_decryption_failed")
    );
    assert!(
        events
            .as_array()
            .unwrap()
            .iter()
            .any(|e| e["outcome"] == "datev_access_denied")
    );
    let tokens: Option<Vec<u8>> =
        sqlx::query_scalar("SELECT token_ciphertext FROM datev_read_connection")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert!(tokens.is_none());
}

#[tokio::test]
async fn long_term_access_is_company_bound_and_failed_revocation_is_not_a_dead_end() {
    let database = support::isolated_schema_database()
        .await
        .expect("isolated DATEV database required");
    let pool = database.pool.clone();
    sqlx::raw_sql("CREATE TABLE users(id uuid PRIMARY KEY, role text NOT NULL DEFAULT 'ceo', is_active boolean NOT NULL DEFAULT true, password_reset_required boolean NOT NULL DEFAULT false)").execute(&pool).await.unwrap();
    for migration in [
        include_str!("../../../migrations/20260905210000_datev_integration_setup.sql"),
        include_str!("../../../migrations/20260914120000_datev_read_connection.sql"),
        include_str!("../../../migrations/20260917210000_datev_long_term_access.sql"),
    ] {
        sqlx::raw_sql(migration).execute(&pool).await.unwrap();
    }
    let id = Uuid::new_v4();
    sqlx::query("INSERT INTO users(id) VALUES ($1)")
        .bind(id)
        .execute(&pool)
        .await
        .unwrap();
    let auth = AuthUser {
        user_id: id,
        role: gmed_domain::role::Role::Ceo,
        family_id: Uuid::new_v4(),
        access_token_jti: Uuid::new_v4(),
        access_token_expires_at: chrono::Utc::now() + chrono::Duration::hours(1),
    };
    let state = AppState::new(
        pool.clone(),
        "datev-test-secret-more-than-thirty-two-characters",
        SettingsCache::new(TokenSettings::default()),
    );
    let app = gmed_server::datev::router().with_state(state);
    let post = |path: &'static str, payload: Value| {
        let (app, auth) = (app.clone(), auth.clone());
        async move {
            let (status, _, body) = call(
                &app,
                Some(auth),
                "POST",
                &format!("/admin/datev/{path}"),
                payload,
                None,
            )
            .await;
            (status, body)
        }
    };
    let (_, _, saved) = call(
        &app,
        Some(auth.clone()),
        "PUT",
        "/admin/datev/connection",
        json!({"revision":null,"credentials":{"client_id":"test-app-id","client_secret":"synthetic-secret","mode":"sandbox","redirect_uri":"http://localhost:5173/api/v1/datev/oauth/callback","exchange_enabled":false}}),
        None,
    )
    .await;
    assert_eq!(saved["long_term"], false);
    let profile_revision = Uuid::new_v4();
    sqlx::query("INSERT INTO datev_integration_setup (revision,profile) VALUES ($1,$2)")
        .bind(profile_revision)
        .bind(json!({"company_name":"Synthetic company","consultant_number":"29098","client_number":"55003"}))
        .execute(&pool).await.unwrap();
    let target =
        json!({"revision":saved["revision"],"generation":saved["generation"],"mode":"sandbox"});

    // DATEV requires a verified company before the two-year token is requested.
    let (status, body) = post("authorize", json!({"expected":target,"long_term":true})).await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(body["error"], "datev_check_required");
    sqlx::query("UPDATE datev_read_connection SET checked_consultant=29098, checked_client=55003")
        .execute(&pool)
        .await
        .unwrap();
    let (status, body) = post("authorize", json!({"expected":target,"long_term":true})).await;
    assert_eq!(status, StatusCode::OK);
    let url = body["authorization_url"].as_str().unwrap();
    assert!(url.contains("offline_access+datev%3Aiam%3Aclient%3A29098-55003"));
    let (_, body) = post("authorize", json!({"expected":target})).await;
    assert!(
        !body["authorization_url"]
            .as_str()
            .unwrap()
            .contains("offline_access")
    );

    // A long-term token never follows the profile to another company.
    sqlx::query("UPDATE datev_read_connection SET status='connected', long_term=true, bound_consultant=29098, bound_client=1, token_ciphertext=decode('00','hex'), token_nonce=nonce, token_key_id=key_id")
        .execute(&pool).await.unwrap();
    let confirmed = json!({"revision":saved["revision"],"generation":saved["generation"],"mode":"sandbox","profile_revision":profile_revision,"consultant_number":29098,"client_number":55003});
    let (status, body) = post("check", json!({"expected":confirmed})).await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(body["error"], "datev_company_bound");

    // Unreadable tokens cannot be revoked. The first attempt must fail even
    // when forced; only a repeated, forced attempt discards them locally.
    let (status, body) = post("disconnect", json!({"expected":target,"force":true})).await;
    assert_eq!(status, StatusCode::BAD_GATEWAY);
    assert_eq!(body["error"], "datev_decryption_failed");
    let (_, _, pending) = call(
        &app,
        Some(auth.clone()),
        "GET",
        "/admin/datev/connection",
        Value::Null,
        None,
    )
    .await;
    assert_eq!(pending["status"], "revocation_pending");
    assert_eq!(pending["has_tokens"], true);
    let target =
        json!({"revision":pending["revision"],"generation":pending["generation"],"mode":"sandbox"});
    let (status, _) = post("disconnect", json!({"expected":target})).await;
    assert_eq!(status, StatusCode::BAD_GATEWAY);
    let (_, _, pending) = call(
        &app,
        Some(auth.clone()),
        "GET",
        "/admin/datev/connection",
        Value::Null,
        None,
    )
    .await;
    let target =
        json!({"revision":pending["revision"],"generation":pending["generation"],"mode":"sandbox"});
    let (status, body) = post("disconnect", json!({"expected":target,"force":true})).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["status"], "disconnected");
    assert_eq!(body["has_tokens"], false);
    assert_eq!(body["long_term"], false);
    assert_eq!(body["revocation_confirmed"], false);
    let (_, _, events) = call(
        &app,
        Some(auth.clone()),
        "GET",
        "/admin/datev/events",
        Value::Null,
        None,
    )
    .await;
    assert!(
        events
            .as_array()
            .unwrap()
            .iter()
            .any(|e| e["outcome"] == "disconnected_unconfirmed")
    );
}
