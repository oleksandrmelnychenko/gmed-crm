//! Exercise real transports: idle close must release shared account quotas.
mod support;

use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use gmed_server::{auth::jwt, routes, state::MAX_WEBSOCKET_CONNECTIONS_PER_USER};
use serde_json::{Value, json};
use tokio::{net::TcpStream, task::JoinHandle};
use tokio_tungstenite::{MaybeTlsStream, WebSocketStream, connect_async, tungstenite::Message};
use uuid::Uuid;

const SECRET: &str = "websocket-lifecycle-test-secret-at-least-32-chars";
type Client = WebSocketStream<MaybeTlsStream<TcpStream>>;

struct TestServer {
    suite: support::TestSuiteContext,
    task: JoinHandle<()>,
    address: std::net::SocketAddr,
    user_id: Uuid,
    token: String,
}

impl Drop for TestServer {
    fn drop(&mut self) {
        self.task.abort();
    }
}

impl TestServer {
    async fn start() -> Option<Self> {
        let suite = support::suite_context(SECRET).await?;
        let user_id: Uuid = sqlx::query_scalar(
            "INSERT INTO users (email, password_hash, name, role)
             VALUES ($1, 'test-hash', 'Websocket test', 'ceo') RETURNING id",
        )
        .bind(format!("websocket-{}@example.com", Uuid::new_v4()))
        .fetch_one(&suite.pool)
        .await
        .unwrap();
        let token = jwt::issue_access_token(SECRET, user_id, "ceo", Uuid::new_v4()).unwrap();
        // Exercise the real handlers without unrelated per-IP HTTP rate limits.
        let app = axum::Router::new()
            .merge(routes::messages::public_router())
            .merge(routes::realtime::public_router())
            .with_state(suite.state.clone());
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let task = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        Some(Self {
            suite,
            task,
            address,
            user_id,
            token,
        })
    }

    async fn connect(&self, path: &str) -> Client {
        self.connect_with(path, &self.token).await
    }

    async fn connect_with(&self, path: &str, token: &str) -> Client {
        let (mut client, _) = connect_async(format!("ws://{}{path}", self.address))
            .await
            .unwrap();
        client
            .send(Message::Text(
                json!({"type": "auth", "token": token}).to_string().into(),
            ))
            .await
            .unwrap();
        client
    }

    async fn connected(&self, path: &str) -> Client {
        let mut client = self.connect(path).await;
        let frame = tokio::time::timeout(Duration::from_secs(5), client.next())
            .await
            .expect("authentication acknowledgement")
            .unwrap()
            .unwrap();
        let value: Value = serde_json::from_str(frame.to_text().unwrap()).unwrap();
        let expected = if path == "/messages/ws" {
            "messages.connected"
        } else {
            "realtime.connected"
        };
        assert_eq!(value["type"], expected);
        client
    }
}

#[tokio::test]
async fn closing_idle_chat_and_realtime_releases_the_shared_quota() {
    let Some(server) = TestServer::start().await else {
        return;
    };
    let registry = &server.suite.state.websocket_connections;
    let _held = (1..MAX_WEBSOCKET_CONNECTIONS_PER_USER)
        .map(|_| registry.try_acquire(server.user_id).unwrap())
        .collect::<Vec<_>>();

    for path in ["/messages/ws", "/events/ws"] {
        for graceful in [true, false] {
            let mut client = server.connected(path).await;
            assert!(registry.try_acquire(server.user_id).is_none());
            if graceful {
                client.close(None).await.unwrap();
            }
            drop(client);
            support::wait_until("closed idle socket releases its account slot", || async {
                registry.try_acquire(server.user_id).is_some()
            })
            .await;
        }
    }
}

#[tokio::test]
async fn quota_rejection_never_sends_a_connected_acknowledgement() {
    let Some(server) = TestServer::start().await else {
        return;
    };
    let _held = (0..MAX_WEBSOCKET_CONNECTIONS_PER_USER)
        .map(|_| {
            server
                .suite
                .state
                .websocket_connections
                .try_acquire(server.user_id)
                .unwrap()
        })
        .collect::<Vec<_>>();
    for path in ["/messages/ws", "/events/ws"] {
        let mut client = server.connect(path).await;
        let frame = tokio::time::timeout(Duration::from_secs(5), client.next())
            .await
            .unwrap();
        assert!(
            !matches!(frame, Some(Ok(Message::Text(_)))),
            "rejected transport advertised readiness"
        );
    }
}

#[tokio::test]
async fn idle_chat_and_realtime_send_periodic_pings() {
    let Some(server) = TestServer::start().await else {
        return;
    };
    let check = async |path| {
        let mut client = server.connected(path).await;
        // The authorization interval ticks immediately, then every 15 seconds.
        for _ in 0..2 {
            let frame = tokio::time::timeout(Duration::from_secs(20), client.next())
                .await
                .expect("idle connection heartbeat")
                .unwrap()
                .unwrap();
            assert!(matches!(frame, Message::Ping(_)));
            client.flush().await.unwrap(); // Flush the automatic pong response.
        }
        client.close(None).await.unwrap();
    };
    tokio::join!(check("/messages/ws"), check("/events/ws"));
}

async fn seed_user(pool: &sqlx::PgPool, role: &str) -> Uuid {
    sqlx::query_scalar(
        "INSERT INTO users (email, password_hash, name, role)
         VALUES ($1, 'test-hash', $2, $3) RETURNING id",
    )
    .bind(format!("websocket-{role}-{}@example.com", Uuid::new_v4()))
    .bind(format!("Websocket {role}"))
    .bind(role)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn seed_patient(pool: &sqlx::PgPool, created_by: Uuid) -> Uuid {
    sqlx::query_scalar(
        "INSERT INTO patients (patient_id, first_name, last_name, birth_date, gender, created_by)
         VALUES ($1, 'Synthetic', 'Websocket', '1990-01-01', 'diverse', $2) RETURNING id",
    )
    .bind(format!("PT-WS-{}", Uuid::new_v4().simple()))
    .bind(created_by)
    .fetch_one(pool)
    .await
    .unwrap()
}

/// An internal, non-medical patient document filed on no appointment.
async fn seed_internal_document(pool: &sqlx::PgPool, patient_id: Uuid, uploaded_by: Uuid) -> Uuid {
    let document_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO documents (
             id, patient_id, auto_name, original_filename, art, category, status, visibility,
             is_medical, mime_type, file_size, version_root_document_id, version_number, uploaded_by
         ) VALUES (
             $1, $2, 'Hotelbestaetigung', 'hotel.pdf', 'administrative_appointment_confirmation',
             'general', 'active', 'internal', false, 'application/pdf', 1234, $1, 1, $3
         )",
    )
    .bind(document_id)
    .bind(patient_id)
    .bind(uploaded_by)
    .execute(pool)
    .await
    .unwrap();
    document_id
}

/// Owner decision 2026-09-28: an interpreter hears only about the documents
/// opened to him, not about every document of a patient he is linked to — and
/// a document shared to him reaches him without a patient link.
#[tokio::test]
async fn interpreter_realtime_carries_only_documents_opened_to_him() {
    let Some(server) = TestServer::start().await else {
        return;
    };
    let pool = &server.suite.pool;
    let state = &server.suite.state;
    let pm_id = seed_user(pool, "patient_manager").await;
    let interpreter_id = seed_user(pool, "interpreter").await;
    let linked_patient_id = seed_patient(pool, pm_id).await;
    let unlinked_patient_id = seed_patient(pool, pm_id).await;
    sqlx::query(
        "INSERT INTO patient_assignments (patient_id, user_id, assigned_by) VALUES ($1, $2, $3)",
    )
    .bind(linked_patient_id)
    .bind(interpreter_id)
    .bind(pm_id)
    .execute(pool)
    .await
    .unwrap();
    let closed_id = seed_internal_document(pool, linked_patient_id, pm_id).await;
    let shared_id = seed_internal_document(pool, unlinked_patient_id, pm_id).await;
    sqlx::query(
        "INSERT INTO document_shares (document_id, shared_with_user_id, shared_by, channel)
         VALUES ($1, $2, $3, 'portal')",
    )
    .bind(shared_id)
    .bind(interpreter_id)
    .bind(pm_id)
    .execute(pool)
    .await
    .unwrap();

    let after_seq: i64 = sqlx::query_scalar("SELECT COALESCE(MAX(seq), 0) FROM realtime_events")
        .fetch_one(pool)
        .await
        .unwrap();
    for document_id in [closed_id, shared_id] {
        gmed_server::realtime::publish_document_event(
            state,
            Some(pm_id),
            "document.updated",
            document_id,
            json!({}),
        )
        .await;
    }
    gmed_server::realtime::publish_patient_event(
        state,
        Some(pm_id),
        "translation_request.created",
        linked_patient_id,
        json!({ "request_id": Uuid::new_v4(), "document_id": closed_id }),
    )
    .await;
    // A patient event he does hear marks the end of the replay.
    gmed_server::realtime::publish_patient_event(
        state,
        Some(pm_id),
        "patient.updated",
        linked_patient_id,
        json!({}),
    )
    .await;

    let token =
        jwt::issue_access_token(SECRET, interpreter_id, "interpreter", Uuid::new_v4()).unwrap();
    let mut client = server
        .connect_with(&format!("/events/ws?last_seq={after_seq}"), &token)
        .await;
    let mut received = Vec::new();
    loop {
        let frame = tokio::time::timeout(Duration::from_secs(10), client.next())
            .await
            .expect("replayed realtime events")
            .unwrap()
            .unwrap();
        let Message::Text(text) = frame else {
            continue;
        };
        let event: Value = serde_json::from_str(text.as_str()).unwrap();
        if event["type"] == "patient.updated" && event["entity_id"] == linked_patient_id.to_string()
        {
            break;
        }
        received.push(event);
    }
    let mentions = |document_id: Uuid| {
        let document_id = document_id.to_string();
        received.iter().any(|event| {
            event["entity_id"] == document_id.as_str()
                || event["payload"]["document_id"] == document_id.as_str()
        })
    };
    assert!(
        mentions(shared_id),
        "shared document event missing: {received:?}"
    );
    assert!(!mentions(closed_id), "closed document leaked: {received:?}");
    client.close(None).await.unwrap();
}
