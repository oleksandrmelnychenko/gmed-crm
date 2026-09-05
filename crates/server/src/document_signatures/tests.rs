use super::*;
use axum::{
    body::to_bytes,
    extract::Request as AxumRequest,
    http::{Method, Request},
};
use gmed_domain::role::Role;
use sqlx::postgres::{PgConnectOptions, PgPoolOptions};
use std::sync::{
    Arc, Mutex,
    atomic::{AtomicBool, AtomicUsize, Ordering},
};
use tower::ServiceExt;

fn signers() -> Vec<Signer> {
    normalize_signers(vec![
        Signer {
            first_name: "Erika".into(),
            last_name: "Mustermann".into(),
            email: "erika@example.org".into(),
            role: "client".into(),
        },
        Signer {
            first_name: "Max".into(),
            last_name: "Muster".into(),
            email: "max@example.org".into(),
            role: "agency".into(),
        },
    ])
    .unwrap()
}
fn provider(demo: bool) -> provider::Provider {
    provider::Provider::new(
        if demo {
            "api_demo_test"
        } else {
            "api_prod_test"
        }
        .into(),
        "test-only".into(),
        if demo { "demo" } else { "live" },
    )
    .unwrap()
}
fn response(id: Uuid, hash: &str, demo: bool) -> Value {
    json!({"id":Uuid::new_v4(),"document_id":Uuid::new_v4(),"owner":if demo {"api_demo_test"}else{"api_prod_test"},"custom":provider::custom(id,hash),"quality":if demo {"DEMO"}else{"QES"},"legislation":"EIDAS","status_overall":"SIGNED","signatures":signers().iter().map(|s|json!({"sid":Uuid::new_v4(),"account_email":s.email,"status_code":"SIGNED","signed_quality":if demo {"DEMO"}else{"QES"},"signed_legislation":"EIDAS","signed_at":"2026-01-23T10:00:00Z","signing_url":"https://example.invalid/secret-signer-token"})).collect::<Vec<_>>()})
}

#[test]
fn validates_all_signers_eidas_qes_and_request_identity() {
    let p = provider(false);
    let id = Uuid::new_v4();
    let hash = sha256(b"original");
    let valid = response(id, &hash, false);
    let verified = p.validate(&valid, id, &hash, None, &signers()).unwrap();
    assert!(
        !verified
            .evidence
            .to_string()
            .contains("secret-signer-token")
    );
    for (pointer, replacement) in [
        ("/custom", json!("another-document")),
        ("/owner", json!("another-owner")),
        ("/quality", json!("SES")),
        ("/legislation", json!("ZERTES")),
        ("/signatures/1/status_code", json!("OPEN")),
        ("/signatures/1/signed_quality", json!("AES")),
        ("/signatures/1/signed_legislation", json!("ZERTES")),
        ("/signatures/1/signed_at", json!(null)),
        ("/signatures/1/account_email", json!("erika@example.org")),
        ("/signatures/1/account_email", json!("intruder@example.org")),
    ] {
        let mut wrong = valid.clone();
        *wrong.pointer_mut(pointer).unwrap() = replacement;
        assert!(
            p.validate(&wrong, id, &hash, None, &signers()).is_err(),
            "accepted invalid {pointer}"
        );
    }
    assert!(
        p.validate(&valid, id, &hash, Some(Uuid::new_v4()), &signers())
            .is_err()
    );
}

#[test]
fn mode_credentials_and_recipients_are_strict() {
    assert!(provider::Provider::new("api_demo_test".into(), "key".into(), "live").is_err());
    assert!(provider::Provider::new("api_prod_test".into(), "key".into(), "demo").is_err());
    let mut duplicate = signers();
    duplicate[1].email = " ERIKA@EXAMPLE.ORG ".into();
    assert!(normalize_signers(duplicate).is_err());
    let mut missing = signers();
    missing[0].first_name = " ".into();
    assert!(normalize_signers(missing).is_err());
    let id = Uuid::new_v4();
    let hash = sha256(b"x");
    assert!(
        provider(true)
            .validate(&response(id, &hash, true), id, &hash, None, &signers())
            .is_ok()
    );
    assert!(
        provider(false)
            .validate(&response(id, &hash, true), id, &hash, None, &signers())
            .is_err()
    );
}

#[derive(Clone, Default)]
struct MockProvider {
    value: Arc<Mutex<Value>>,
    creates: Arc<AtomicUsize>,
    fail_report: Arc<AtomicBool>,
    reject: Arc<AtomicBool>,
    auth_status: Arc<AtomicUsize>,
    logins: Arc<AtomicUsize>,
    requests: Arc<AtomicUsize>,
}
async fn mock(State(mock): State<MockProvider>, request: AxumRequest) -> Response {
    let path = request.uri().path().to_string();
    let method = request.method().clone();
    if path == "/v2/access/login" {
        mock.logins.fetch_add(1, Ordering::SeqCst);
        let body = to_bytes(request.into_body(), 10000).await.unwrap();
        let parsed: Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(parsed["api-key"], "test-only");
        return "fixture-jwt".into_response();
    }
    assert_eq!(
        request.headers().get(header::AUTHORIZATION).unwrap(),
        "Bearer fixture-jwt"
    );
    mock.requests.fetch_add(1, Ordering::SeqCst);
    let auth_status = mock.auth_status.load(Ordering::SeqCst);
    if auth_status != 0 {
        return StatusCode::from_u16(auth_status as u16)
            .unwrap()
            .into_response();
    }
    if path == "/v2/signature-requests" && method == Method::POST {
        mock.creates.fetch_add(1, Ordering::SeqCst);
        if mock.reject.load(Ordering::SeqCst) {
            return StatusCode::UNPROCESSABLE_ENTITY.into_response();
        }
        let body = to_bytes(request.into_body(), 1024 * 1024).await.unwrap();
        let parsed: Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(parsed["legislation"], "EIDAS");
        assert_eq!(parsed["attach_on_success"], json!([]));
        assert!(parsed.get("callback_success_url").is_none());
        let custom = parsed["custom"]
            .as_str()
            .unwrap()
            .split(':')
            .collect::<Vec<_>>();
        let mut value = response(
            Uuid::parse_str(custom[1]).unwrap(),
            custom[2],
            parsed["quality"] == "DEMO",
        );
        value["status_overall"] = json!("OPEN");
        for recipient in value["signatures"].as_array_mut().unwrap() {
            recipient["status_code"] = json!("OPEN");
        }
        *mock.value.lock().unwrap() = value.clone();
        return Json(value).into_response();
    }
    if path == "/v2/signature-requests" {
        return Json(json!([mock.value.lock().unwrap().clone()])).into_response();
    }
    if path.ends_with("/withdraw") {
        mock.value.lock().unwrap()["status_overall"] = json!("WITHDRAWN");
        return StatusCode::NO_CONTENT.into_response();
    }
    if path.ends_with("/report") {
        if mock.fail_report.load(Ordering::SeqCst) {
            return StatusCode::SERVICE_UNAVAILABLE.into_response();
        }
        return (
            [(header::CONTENT_TYPE, "application/pdf")],
            "%PDF-1.7\nfixture signature report\n%%EOF",
        )
            .into_response();
    }
    if path.ends_with("/content") {
        return (
            [(header::CONTENT_TYPE, "application/pdf")],
            "%PDF-1.7\nfixture signed bytes\n%%EOF",
        )
            .into_response();
    }
    Json(mock.value.lock().unwrap().clone()).into_response()
}
async fn mock_server() -> (MockProvider, String, tokio::task::JoinHandle<()>) {
    let mock_state = MockProvider::default();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let endpoint = format!("http://{}/v2", listener.local_addr().unwrap());
    let app = Router::new().fallback(mock).with_state(mock_state.clone());
    let handle = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    (mock_state, endpoint, handle)
}

#[tokio::test]
async fn provider_uses_german_protocol_and_classifies_definite_rejection() {
    let (mock, endpoint, handle) = mock_server().await;
    let p = provider(false).with_test_endpoint(endpoint);
    let id = Uuid::new_v4();
    let hash = sha256(b"%PDF-1.7 test");
    let created = p
        .create(id, &hash, b"%PDF-1.7 test", &signers())
        .await
        .unwrap();
    assert!(p.validate(&created, id, &hash, None, &signers()).is_ok());
    assert_eq!(p.find(id).await.unwrap().len(), 1);
    mock.reject.store(true, Ordering::SeqCst);
    assert_eq!(
        p.create(id, &hash, b"pdf", &signers()).await.unwrap_err(),
        "provider_request_rejected"
    );
    assert_eq!(mock.creates.load(Ordering::SeqCst), 2);
    handle.abort();
}

#[tokio::test]
async fn rejected_authentication_refreshes_the_token_without_replaying_creation() {
    for status in [401, 403] {
        let (mock, endpoint, handle) = mock_server().await;
        let p = provider(false).with_test_endpoint(endpoint);
        p.check_connection().await.unwrap();
        mock.auth_status.store(status, Ordering::SeqCst);
        let id = Uuid::new_v4();
        assert_eq!(
            p.create(id, "hash", b"pdf", &signers()).await.unwrap_err(),
            "provider_request_rejected"
        );
        assert_eq!(mock.requests.load(Ordering::SeqCst), 1);
        assert_eq!(mock.logins.load(Ordering::SeqCst), 1);
        mock.auth_status.store(0, Ordering::SeqCst);
        p.find(id).await.unwrap();
        assert_eq!(mock.logins.load(Ordering::SeqCst), 2);
        assert_eq!(mock.creates.load(Ordering::SeqCst), 0);
        handle.abort();
    }
}

// Opt in explicitly; unlike legacy suites, this never silently passes without PostgreSQL.
#[tokio::test]
#[ignore = "requires TEST_DATABASE_ADMIN_URL pointing to an isolated test PostgreSQL server"]
async fn postgres_end_to_end_archival_retry_acl_versions_and_demo() {
    let url = std::env::var("TEST_DATABASE_ADMIN_URL").expect("TEST_DATABASE_ADMIN_URL required");
    let options: PgConnectOptions = url.parse().unwrap();
    let admin = PgPoolOptions::new()
        .max_connections(2)
        .connect_with(options.clone())
        .await
        .unwrap();
    let database = format!("signature_test_{}", Uuid::new_v4().simple());
    sqlx::query(&format!("CREATE DATABASE {database}"))
        .execute(&admin)
        .await
        .unwrap();
    let pool = PgPoolOptions::new()
        .max_connections(5)
        .connect_with(options.database(&database))
        .await
        .unwrap();
    // Old seeded invoices have lines absent from their seeded quotes. The
    // 20260819113000 billing backfill rejects that unrelated demo history.
    // Build the full schema, but detach these fixture-only quote links before
    // that migration. No migration SQL or application database is changed.
    let mut before_billing = sqlx::migrate!("../../migrations");
    before_billing.migrations = std::borrow::Cow::Owned(
        before_billing
            .iter()
            .filter(|m| m.version < 20260819113000)
            .cloned()
            .collect(),
    );
    before_billing.run(&pool).await.unwrap();
    sqlx::query("UPDATE invoices SET quote_id=NULL WHERE quote_id IS NOT NULL")
        .execute(&pool)
        .await
        .unwrap();
    gmed_db::run_migrations(&pool).await.unwrap();
    let actor: Uuid = sqlx::query_scalar("SELECT id FROM users WHERE email='admin@gmed.de'")
        .fetch_one(&pool)
        .await
        .unwrap();
    let linked_provider: Uuid = sqlx::query_scalar("SELECT id FROM providers ORDER BY id LIMIT 1")
        .fetch_one(&pool)
        .await
        .unwrap();
    let auth = AuthUser {
        user_id: actor,
        role: Role::Ceo,
        family_id: Uuid::new_v4(),
        access_token_jti: Uuid::new_v4(),
        access_token_expires_at: Utc::now() + chrono::Duration::hours(1),
    };
    let (mock, endpoint, handle) = mock_server().await;
    let mut created_keys = Vec::new();
    for scenario in ["live", "demo", "stale", "declined", "withdrawn", "unknown"] {
        let demo = scenario == "demo";
        let state = AppState::new(
            pool.clone(),
            "test",
            crate::settings::SettingsCache::new(crate::settings::TokenSettings::default()),
        )
        .with_document_signatures(Some(provider(demo).with_test_endpoint(endpoint.clone())));
        let source_id = Uuid::new_v4();
        let bytes = b"%PDF-1.7\nfixture original bytes\n%%EOF";
        let (_, source_key, _) = documents::store_document_blob(bytes, "fixture.pdf")
            .await
            .unwrap();
        created_keys.push(source_key.clone());
        sqlx::query("INSERT INTO documents(id,auto_name,art,mime_type,storage_key,file_size,version_root_document_id,uploaded_by) VALUES ($1,'Fixture','other','application/pdf',$2,$3,$1,$4)")
            .bind(source_id).bind(&source_key).bind(bytes.len() as i64).bind(actor).execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO provider_document_links(provider_id,document_id,linked_by) VALUES ($1,$2,$3)")
            .bind(linked_provider).bind(source_id).bind(actor).execute(&pool).await.unwrap();
        let app = router()
            .with_state(state.clone())
            .layer(Extension(auth.clone()));
        let payload = json!({"signers":signers()}).to_string();
        let http = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri(format!("/documents/{source_id}/signature-requests"))
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(payload.clone()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(http.status(), StatusCode::ACCEPTED, "{scenario}");
        let created: Value =
            serde_json::from_slice(&to_bytes(http.into_body(), 10000).await.unwrap()).unwrap();
        let request_id = Uuid::parse_str(created["id"].as_str().unwrap()).unwrap();
        for _ in 0..100 {
            let status: String =
                sqlx::query_scalar("SELECT status FROM document_signature_requests WHERE id=$1")
                    .bind(request_id)
                    .fetch_one(&pool)
                    .await
                    .unwrap();
            if status == "pending" {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        }
        let duplicate = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri(format!("/documents/{source_id}/signature-requests"))
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(payload))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(duplicate.status(), StatusCode::CONFLICT);
        let before_count = mock.creates.load(Ordering::SeqCst);
        if scenario == "unknown" {
            sqlx::query("UPDATE document_signature_requests SET status='submission_unknown',provider_request_id=NULL WHERE id=$1").bind(request_id).execute(&pool).await.unwrap();
        }
        if scenario == "stale" {
            let replacement = Uuid::new_v4();
            sqlx::query("INSERT INTO documents(id,auto_name,art,mime_type,storage_key,version_root_document_id,replaces_document_id,version_number,uploaded_by) VALUES ($1,'Replacement','other','application/pdf',$2,$3,$3,2,$4)")
                .bind(replacement).bind(&source_key).bind(source_id).bind(actor).execute(&pool).await.unwrap();
        }
        {
            let mut remote = mock.value.lock().unwrap();
            remote["status_overall"] = json!(match scenario {
                "declined" => "DECLINED",
                "withdrawn" => "WITHDRAWN",
                _ => "SIGNED",
            });
            for recipient in remote["signatures"].as_array_mut().unwrap() {
                recipient["status_code"] = json!("SIGNED");
            }
            remote["document_id"] = json!(Uuid::new_v4());
        }
        if scenario == "live" {
            mock.fail_report.store(true, Ordering::SeqCst);
            assert!(poll_one(&state, Some(request_id)).await.unwrap());
            let pending = sqlx::query(
                "SELECT status,result_document_id FROM document_signature_requests WHERE id=$1",
            )
            .bind(request_id)
            .fetch_one(&pool)
            .await
            .unwrap();
            assert_eq!(pending.get::<String, _>("status"), "pending");
            assert!(
                pending
                    .get::<Option<Uuid>, _>("result_document_id")
                    .is_none()
            );
            mock.fail_report.store(false, Ordering::SeqCst);
            sqlx::query("UPDATE document_signature_requests SET next_poll_at=now() WHERE id=$1")
                .bind(request_id)
                .execute(&pool)
                .await
                .unwrap();
        }
        assert!(poll_one(&state, Some(request_id)).await.unwrap());
        let result = sqlx::query("SELECT * FROM document_signature_requests WHERE id=$1")
            .bind(request_id)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(
            mock.creates.load(Ordering::SeqCst),
            before_count,
            "recovery must not send new invitations"
        );
        if matches!(scenario, "declined" | "withdrawn") {
            assert_eq!(result.get::<String, _>("status"), scenario);
            assert!(
                result
                    .get::<Option<Uuid>, _>("result_document_id")
                    .is_none()
            );
            continue;
        }
        assert_eq!(
            result.get::<String, _>("status"),
            if scenario == "stale" {
                "needs_review"
            } else {
                "completed"
            },
            "{scenario}: {:?}",
            result.get::<Option<String>, _>("last_error")
        );
        let document_id: Uuid = result.get("result_document_id");
        let document = sqlx::query("SELECT * FROM documents WHERE id=$1")
            .bind(document_id)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(
            document
                .get::<Option<DateTime<Utc>>, _>("signed_at")
                .is_some(),
            !demo && scenario != "stale"
        );
        assert!(document.get::<Option<Uuid>, _>("signed_by").is_none());
        let provider_linked: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM provider_document_links WHERE provider_id=$1 AND document_id=$2 AND linked_by=$3)")
            .bind(linked_provider).bind(document_id).bind(actor).fetch_one(&pool).await.unwrap();
        assert_eq!(
            provider_linked,
            !demo && scenario != "stale",
            "{scenario}: preserve provider context only for live current versions"
        );
        assert_eq!(
            document.get::<Option<Uuid>, _>("replaces_document_id"),
            if !demo && scenario != "stale" {
                Some(source_id)
            } else {
                None
            }
        );
        created_keys.push(document.get("storage_key"));
        created_keys.push(result.get("report_storage_key"));
        assert!(
            !poll_one(&state, Some(request_id)).await.unwrap(),
            "completion must be idempotent"
        );
        let report_response = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri(format!("/document-signature-requests/{request_id}/report"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(report_response.status(), StatusCode::OK);
        let forbidden_auth = AuthUser {
            role: Role::Concierge,
            ..auth.clone()
        };
        let forbidden = router()
            .with_state(state)
            .layer(Extension(forbidden_auth))
            .oneshot(
                Request::builder()
                    .uri(format!("/document-signature-requests/{request_id}/report"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(forbidden.status(), StatusCode::FORBIDDEN);
    }
    // Connection configuration is encrypted, admin-only, and cannot strand active requests.
    let connection_state = AppState::new(
        pool.clone(),
        "test",
        crate::settings::SettingsCache::new(crate::settings::TokenSettings::default()),
    )
    .with_document_signatures(Some(provider(false).with_test_endpoint(endpoint.clone())));
    connection::test_save(
        &connection_state,
        &auth,
        provider(false).with_test_endpoint(endpoint.clone()),
    )
    .await
    .unwrap();
    let encrypted: Vec<u8> =
        sqlx::query_scalar("SELECT ciphertext FROM signature_provider_connection")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert!(!String::from_utf8_lossy(&encrypted).contains("test-only"));
    *connection_state.document_signature_cache.lock().unwrap() = None;
    let restored = connection::current_provider(&connection_state)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(restored.username(), "api_prod_test");
    let config_app = router()
        .with_state(connection_state.clone())
        .layer(Extension(auth.clone()));
    let config_response = config_app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/document-signatures/connection")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let public = String::from_utf8(
        to_bytes(config_response.into_body(), 10000)
            .await
            .unwrap()
            .to_vec(),
    )
    .unwrap();
    assert!(!public.contains("api_key"));
    assert!(!public.contains("test-only"));
    assert!(public.contains("api_prod_test"));
    let denied = router()
        .with_state(connection_state.clone())
        .layer(Extension(AuthUser {
            role: Role::PatientManager,
            ..auth.clone()
        }))
        .oneshot(
            Request::builder()
                .uri("/document-signatures/connection")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(denied.status(), StatusCode::FORBIDDEN);
    let active_id = Uuid::new_v4();
    sqlx::query("INSERT INTO document_signature_requests(id,source_document_id,requested_by,source_sha256,source_context,signers,provider_account,test_mode,status) SELECT $1,source_document_id,requested_by,source_sha256,source_context,signers,$2,false,'pending' FROM document_signature_requests LIMIT 1")
        .bind(active_id).bind(&restored.account).execute(&pool).await.unwrap();
    let conflict = connection::test_save(
        &connection_state,
        &auth,
        provider(true).with_test_endpoint(endpoint.clone()),
    )
    .await
    .unwrap_err();
    assert_eq!(conflict.status(), StatusCode::CONFLICT);
    let disconnect_request = || {
        Request::builder()
            .method("POST")
            .uri("/document-signatures/connection/disconnect")
            .body(Body::empty())
            .unwrap()
    };
    assert_eq!(
        config_app
            .clone()
            .oneshot(disconnect_request())
            .await
            .unwrap()
            .status(),
        StatusCode::CONFLICT
    );
    sqlx::query("UPDATE document_signature_requests SET status='withdrawn' WHERE id=$1")
        .bind(active_id)
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(
        config_app
            .clone()
            .oneshot(disconnect_request())
            .await
            .unwrap()
            .status(),
        StatusCode::OK
    );
    assert!(
        connection::current_provider(&connection_state)
            .await
            .unwrap()
            .is_none(),
        "disabled DB config must override environment credentials"
    );
    assert!(
        sqlx::query_scalar::<_, Option<Vec<u8>>>(
            "SELECT ciphertext FROM signature_provider_connection"
        )
        .fetch_one(&pool)
        .await
        .unwrap()
        .is_none()
    );
    handle.abort();
    for key in created_keys {
        documents::remove_document_blob(&key).await;
    }
    pool.close().await;
    sqlx::query(&format!("DROP DATABASE {database} WITH (FORCE)"))
        .execute(&admin)
        .await
        .unwrap();
    admin.close().await;
}
