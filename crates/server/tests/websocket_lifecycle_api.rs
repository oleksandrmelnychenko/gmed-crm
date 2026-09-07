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
        let (mut client, _) = connect_async(format!("ws://{}{path}", self.address))
            .await
            .unwrap();
        client
            .send(Message::Text(
                json!({"type": "auth", "token": self.token})
                    .to_string()
                    .into(),
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
