//! Systematic append-only audit log for every authenticated HTTP request.
//!
//! Three things live here:
//!
//! 1. [`spawn_writer`] starts a background task that owns an mpsc receiver
//!    and drains it into the `audit_log` Postgres table. Called once from
//!    `main`. Returns an [`AuditSender`] — a cheap-to-clone handle that
//!    goes into [`crate::state::AppState`] and is reachable from handlers
//!    and middleware.
//!
//! 2. [`middleware`] is the axum `middleware::from_fn_with_state` that
//!    wraps the protected route tree. It records one event per request
//!    after the response status is known, using the `AuthUser` that
//!    `require_auth` inserted into the request extensions, and submits
//!    the event over the mpsc channel.
//!
//! 3. [`AuditContext`] is a per-request enrichment handle. Handlers can
//!    optionally extract it with `Extension<AuditContext>` and call
//!    `set_entity` / `set_action` to upgrade the coarse middleware event
//!    (`action = "http_request"`, `entity_type = "http"`) into a
//!    semantically meaningful one (`action = "read_patient"`,
//!    `entity_type = "patient"`, `entity_id = <uuid>`). Handlers that do
//!    nothing still get the base event — coverage is guaranteed at the
//!    middleware layer and the auditor can prove it.
//!
//! ## Immutability
//!
//! The `audit_log` table is already protected by a
//! `BEFORE UPDATE OR DELETE` trigger (`audit_log_immutable`) defined in
//! `migrations/20260407000001_initial_schema.sql`. Any UPDATE or DELETE
//! against the table raises an exception, which gives us ISO 27001 A.8.15
//! tamper-evidence at the database layer without hash chaining in app
//! code. This module does not need to re-prove that property; it only
//! has to add rows.
//!
//! ## Delivery guarantee
//!
//! The channel is bounded at [`CHANNEL_CAPACITY`] pending events. On
//! overflow, [`AuditSender::try_send`] drops the event on the floor and
//! logs a warning. This is an intentional trade under our GDPR Art. 32
//! DPIA: the alternative — synchronous DB writes on every request —
//! adds 1–2 ms per request and couples HTTP liveness to the audit
//! pipeline. The documented worst case is that a sudden crash between
//! "queued" and "persisted" can lose a handful of in-flight events.
//!
//! ## IP pseudonymisation
//!
//! Peer IPs never reach `audit_log` in plaintext. [`hash_client_ip`]
//! derives `sha256:<hex>` from `ip || "::" || salt`, where the salt is
//! supplied by [`crate::config::Config::audit_ip_salt`]. Same IP yields
//! the same hash within a deployment (useful for pattern detection),
//! but the raw IP — which is PII under GDPR Art. 4 — never crosses the
//! process boundary.

use std::net::{IpAddr, SocketAddr};
use std::sync::{Arc, Mutex};

use axum::body::Body;
use axum::extract::{ConnectInfo, Extension, MatchedPath, Request, State};
use axum::http::Method;
use axum::middleware::Next;
use axum::response::Response;
use gmed_db::DbPool;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use tokio::sync::mpsc;
use uuid::Uuid;

use crate::auth::middleware::AuthUser;
use crate::state::AppState;

/// Bounded channel depth between the middleware and the writer task.
pub const CHANNEL_CAPACITY: usize = 10_000;

const HTTP_ACTION: &str = "http_request";
const HTTP_ENTITY_TYPE: &str = "http";
const UNMATCHED_ROUTE: &str = "<unmatched>";

/// One row destined for `audit_log`.
#[derive(Debug, Clone)]
pub struct AuditEvent {
    pub user_id: Option<Uuid>,
    pub action: String,
    pub entity_type: String,
    pub entity_id: Option<Uuid>,
    pub context: Value,
    pub ip_hash: Option<String>,
}

/// Per-request mutable enrichment slot. Handlers obtain one via
/// `Extension<AuditContext>` and call `set_entity` / `set_action` to add
/// semantics to the event the middleware will submit.
#[derive(Debug, Clone, Default)]
pub struct AuditContext(Arc<Mutex<AuditAnnotation>>);

#[derive(Debug, Clone, Default)]
struct AuditAnnotation {
    entity_type: Option<String>,
    entity_id: Option<Uuid>,
    action: Option<String>,
}

impl AuditContext {
    pub fn new() -> Self {
        Self::default()
    }

    /// Attach a domain entity to the event. Typical handler call:
    /// `audit.set_entity("patient", patient_id)`.
    pub fn set_entity(&self, entity_type: impl Into<String>, entity_id: Uuid) {
        let mut slot = self.0.lock().expect("audit annotation mutex poisoned");
        slot.entity_type = Some(entity_type.into());
        slot.entity_id = Some(entity_id);
    }

    /// Override the action string — e.g. `"read_patient"`, `"create_case"`.
    pub fn set_action(&self, action: impl Into<String>) {
        self.0
            .lock()
            .expect("audit annotation mutex poisoned")
            .action = Some(action.into());
    }

    fn take(&self) -> AuditAnnotation {
        self.0
            .lock()
            .expect("audit annotation mutex poisoned")
            .clone()
    }
}

#[derive(Clone)]
enum SenderInner {
    Real {
        tx: mpsc::Sender<AuditEvent>,
        ip_salt: Arc<String>,
    },
    NoOp,
}

/// Cheap-to-clone handle stored in [`AppState`]. Writing happens on a
/// background task so HTTP latency is not coupled to the audit pipeline.
#[derive(Clone)]
pub struct AuditSender {
    inner: SenderInner,
}

impl AuditSender {
    /// A sender that drops every event on the floor. Used by unit tests
    /// and by the legacy `AppState::new` constructor so tests never need
    /// a running writer.
    pub fn noop() -> Self {
        Self {
            inner: SenderInner::NoOp,
        }
    }

    /// Queue an event. Never blocks. On channel saturation the event is
    /// dropped and a warning is logged.
    pub fn try_send(&self, event: AuditEvent) {
        match &self.inner {
            SenderInner::Real { tx, .. } => {
                if let Err(e) = tx.try_send(event) {
                    tracing::warn!(error = %e, "audit_log channel saturated, event dropped");
                }
            }
            SenderInner::NoOp => {}
        }
    }

    /// Hash a peer IP with the configured salt. Tests that use the noop
    /// sender get a deterministic but meaningless salt — the resulting
    /// hash still round-trips under equality checks.
    pub fn hash_ip(&self, ip: IpAddr) -> String {
        let salt = match &self.inner {
            SenderInner::Real { ip_salt, .. } => ip_salt.as_str(),
            SenderInner::NoOp => "noop-salt",
        };
        hash_client_ip(ip, salt)
    }

    /// Parse a string-form IP (for example from `X-Forwarded-For`) and
    /// hash it with the configured salt. Returns `None` when the string
    /// is not a valid IP — useful for handlers that already extracted
    /// an IP from a header and do not want to parse twice.
    pub fn hash_ip_from_str(&self, raw: &str) -> Option<String> {
        raw.parse::<IpAddr>().ok().map(|ip| self.hash_ip(ip))
    }
}

/// Build an authentication-flow audit event. All login, refresh and
/// logout rows share `entity_type = "auth"` so compliance queries can
/// group them cleanly, and the `entity_id` is the user id when known.
pub fn auth_event(
    action: impl Into<String>,
    user_id: Option<Uuid>,
    ip_hash: Option<String>,
    context: Value,
) -> AuditEvent {
    AuditEvent {
        user_id,
        action: action.into(),
        entity_type: "auth".to_string(),
        entity_id: user_id,
        context,
        ip_hash,
    }
}

/// Start the background writer task and return a sender handle.
pub fn spawn_writer(pool: DbPool, ip_salt: String) -> AuditSender {
    let (tx, mut rx) = mpsc::channel::<AuditEvent>(CHANNEL_CAPACITY);

    tokio::spawn(async move {
        while let Some(event) = rx.recv().await {
            if let Err(e) = write_event(&pool, &event).await {
                // Never panic on a failed audit write — log and continue
                // so the writer task stays up. The DB error will surface
                // in the log backend and alerting.
                tracing::error!(error = %e, action = %event.action, "failed to persist audit_log row");
            }
        }
    });

    AuditSender {
        inner: SenderInner::Real {
            tx,
            ip_salt: Arc::new(ip_salt),
        },
    }
}

async fn write_event(pool: &DbPool, event: &AuditEvent) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"
        INSERT INTO audit_log
            (user_id, action, entity_type, entity_id, context, ip_address)
        VALUES ($1, $2, $3, $4, $5, $6)
        "#,
    )
    .bind(event.user_id)
    .bind(&event.action)
    .bind(&event.entity_type)
    .bind(event.entity_id)
    .bind(&event.context)
    .bind(event.ip_hash.as_deref())
    .execute(pool)
    .await
    .map(|_| ())
}

/// Deterministic SHA-256 of `ip || "::" || salt`. The delimiter prevents
/// a trivial IP/salt collision and the `sha256:` prefix makes the storage
/// format self-describing for future algorithm upgrades.
pub fn hash_client_ip(ip: IpAddr, salt: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(ip.to_string().as_bytes());
    hasher.update(b"::");
    hasher.update(salt.as_bytes());
    format!("sha256:{:x}", hasher.finalize())
}

/// axum middleware that records one `audit_log` row per authenticated
/// request. Install it on the protected route tree *after* `require_auth`
/// so the request extensions already carry [`AuthUser`].
pub async fn middleware(
    State(state): State<AppState>,
    mut request: Request<Body>,
    next: Next,
) -> Response {
    let context = AuditContext::new();
    request.extensions_mut().insert(context.clone());

    let method = request.method().clone();
    let route = request
        .extensions()
        .get::<MatchedPath>()
        .map(|m| m.as_str().to_string())
        .unwrap_or_else(|| UNMATCHED_ROUTE.to_string());
    let user_id = request.extensions().get::<AuthUser>().map(|u| u.user_id);
    let peer_ip = request
        .extensions()
        .get::<ConnectInfo<SocketAddr>>()
        .map(|c| c.0.ip());

    let started = std::time::Instant::now();
    let response = next.run(request).await;
    let latency_ms = u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX);

    let annotation = context.take();
    let event = AuditEvent {
        user_id,
        action: annotation.action.unwrap_or_else(|| HTTP_ACTION.to_string()),
        entity_type: annotation
            .entity_type
            .unwrap_or_else(|| HTTP_ENTITY_TYPE.to_string()),
        entity_id: annotation.entity_id,
        context: build_context_json(&method, &route, response.status().as_u16(), latency_ms),
        ip_hash: peer_ip.map(|ip| state.audit_sender.hash_ip(ip)),
    };
    state.audit_sender.try_send(event);

    response
}

fn build_context_json(method: &Method, route: &str, status: u16, latency_ms: u64) -> Value {
    json!({
        "method": method.as_str(),
        "route": route,
        "status": status,
        "latency_ms": latency_ms,
    })
}

/// Re-export as an extractor-friendly alias so handlers can write
/// `Extension(audit): Extension<AuditContext>` without pulling in this
/// module's namespace.
pub type AuditExtension = Extension<AuditContext>;

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::Ipv4Addr;

    #[test]
    fn hash_client_ip_is_deterministic_per_salt() {
        let ip = IpAddr::V4(Ipv4Addr::new(203, 0, 113, 42));
        let a = hash_client_ip(ip, "salt-a");
        let b = hash_client_ip(ip, "salt-a");
        assert_eq!(a, b);
        assert!(a.starts_with("sha256:"));
    }

    #[test]
    fn different_salts_produce_different_hashes() {
        let ip = IpAddr::V4(Ipv4Addr::new(203, 0, 113, 42));
        let a = hash_client_ip(ip, "salt-a");
        let b = hash_client_ip(ip, "salt-b");
        assert_ne!(a, b);
    }

    #[test]
    fn different_ips_produce_different_hashes() {
        let a = hash_client_ip(IpAddr::V4(Ipv4Addr::new(1, 2, 3, 4)), "s");
        let b = hash_client_ip(IpAddr::V4(Ipv4Addr::new(1, 2, 3, 5)), "s");
        assert_ne!(a, b);
    }

    #[test]
    fn hash_does_not_contain_the_raw_ip() {
        let ip = IpAddr::V4(Ipv4Addr::new(203, 0, 113, 99));
        let hash = hash_client_ip(ip, "salt");
        assert!(!hash.contains("203"));
        assert!(!hash.contains("113"));
    }

    #[test]
    fn audit_context_stores_entity_and_action() {
        let ctx = AuditContext::new();
        let id = Uuid::new_v4();
        ctx.set_entity("patient", id);
        ctx.set_action("read_patient");
        let taken = ctx.take();
        assert_eq!(taken.entity_type.as_deref(), Some("patient"));
        assert_eq!(taken.entity_id, Some(id));
        assert_eq!(taken.action.as_deref(), Some("read_patient"));
    }

    #[test]
    fn audit_context_default_is_empty() {
        let taken = AuditContext::new().take();
        assert_eq!(taken.entity_type, None);
        assert_eq!(taken.entity_id, None);
        assert_eq!(taken.action, None);
    }

    #[test]
    fn noop_sender_does_not_panic_when_draining_events() {
        let sender = AuditSender::noop();
        for i in 0..1000 {
            sender.try_send(AuditEvent {
                user_id: None,
                action: "noop".into(),
                entity_type: "t".into(),
                entity_id: None,
                context: json!({ "i": i }),
                ip_hash: None,
            });
        }
    }

    #[test]
    fn noop_sender_hashes_ips_deterministically() {
        let sender = AuditSender::noop();
        let ip = IpAddr::V4(Ipv4Addr::new(10, 0, 0, 1));
        assert_eq!(sender.hash_ip(ip), sender.hash_ip(ip));
    }

    #[test]
    fn build_context_json_has_the_expected_shape() {
        let v = build_context_json(&Method::GET, "/api/v1/patients/{id}", 200, 42);
        assert_eq!(v["method"], "GET");
        assert_eq!(v["route"], "/api/v1/patients/{id}");
        assert_eq!(v["status"], 200);
        assert_eq!(v["latency_ms"], 42);
    }

    #[test]
    fn hash_ip_from_str_parses_valid_ipv4() {
        let sender = AuditSender::noop();
        let hash = sender.hash_ip_from_str("203.0.113.1");
        assert!(hash.is_some());
        assert!(hash.unwrap().starts_with("sha256:"));
    }

    #[test]
    fn hash_ip_from_str_parses_valid_ipv6() {
        let sender = AuditSender::noop();
        assert!(sender.hash_ip_from_str("2001:db8::1").is_some());
    }

    #[test]
    fn hash_ip_from_str_returns_none_on_garbage() {
        let sender = AuditSender::noop();
        assert!(sender.hash_ip_from_str("not-an-ip").is_none());
        assert!(sender.hash_ip_from_str("").is_none());
    }

    #[test]
    fn auth_event_has_stable_entity_type_and_copies_user_id_to_entity_id() {
        let uid = Uuid::new_v4();
        let event = auth_event("login_success", Some(uid), None, json!({ "k": "v" }));
        assert_eq!(event.action, "login_success");
        assert_eq!(event.entity_type, "auth");
        assert_eq!(event.entity_id, Some(uid));
        assert_eq!(event.user_id, Some(uid));
    }

    #[test]
    fn auth_event_with_no_user_leaves_entity_id_none() {
        let event = auth_event("login_failure", None, None, json!({}));
        assert_eq!(event.user_id, None);
        assert_eq!(event.entity_id, None);
    }
}
