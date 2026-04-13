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
//!
//! # Migration policy for handler-side inserts
//!
//! The repository currently contains a population of direct
//! `INSERT INTO audit_log` statements inside handler bodies. These were
//! the only way to audit before this module existed, and they are being
//! ratcheted down to zero — see `scripts/check_repo_hygiene.py`, which
//! fails CI if the count ever increases.
//!
//! **New code must not add manual inserts.** Use [`AuditContext`] via an
//! `Extension<AuditContext>` extractor and call the `set_*` helpers;
//! [`middleware`] will pick up the enrichment and submit a single row.
//!
//! ## Correctness rules for migrating existing inserts
//!
//! Not every existing insert can be mechanically translated — the
//! middleware writes the event *after* the HTTP response is produced,
//! outside any handler-owned transaction. That changes delivery
//! semantics in two ways:
//!
//! 1. **Transactional coupling.** If a handler wraps business-logic
//!    mutations and an `INSERT INTO audit_log` in a single SQL
//!    transaction and the transaction rolls back, today's code drops
//!    the audit row with it. Migrating that call to [`AuditContext`]
//!    breaks the coupling: the middleware fires even on rollback, so
//!    the audit row claims the mutation happened when it did not.
//!    **Leave such inserts alone and mark them with a
//!    `TODO(audit-migrate)` comment.**
//!
//! 2. **Before/after diff snapshots.** Diff-style audits load a snapshot
//!    before the mutation, apply the mutation, load a second snapshot,
//!    and insert both as `old_value` / `new_value`. These translate to
//!    [`AuditContext::set_old_value`] + [`AuditContext::set_new_value`]
//!    — **only if** the handler's success path is the only one that
//!    should surface an audit row. If an error after the first snapshot
//!    must still be audited, leave the manual insert.
//!
//! 3. **Coverage by middleware is already guaranteed.** A handler that
//!    does nothing still produces an `action = "http_request"` row —
//!    enrichment is optional. Migration is about replacing the
//!    semantically-rich manual row with a semantically-rich enriched
//!    row, not about adding coverage.

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
    pub old_value: Option<Value>,
    pub new_value: Option<Value>,
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
    context: Option<Value>,
    old_value: Option<Value>,
    new_value: Option<Value>,
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

    /// Provide a handler-specific context JSON blob. The middleware
    /// merges this object on top of the base `{method, route, status,
    /// latency_ms}` that it always writes, so handler keys win on
    /// collision but never displace the infrastructure fields unless
    /// the handler intentionally overrides them.
    pub fn set_context(&self, context: Value) {
        self.0
            .lock()
            .expect("audit annotation mutex poisoned")
            .context = Some(context);
    }

    /// Attach an `old_value` snapshot for a diff-style audit. Pair with
    /// [`Self::set_new_value`]. See the module docs for the correctness
    /// rules that apply to this pattern.
    pub fn set_old_value(&self, value: Value) {
        self.0
            .lock()
            .expect("audit annotation mutex poisoned")
            .old_value = Some(value);
    }

    /// Attach a `new_value` snapshot for a diff-style audit.
    pub fn set_new_value(&self, value: Value) {
        self.0
            .lock()
            .expect("audit annotation mutex poisoned")
            .new_value = Some(value);
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
        old_value: None,
        new_value: None,
        ip_hash,
    }
}

/// Build a domain audit event — the non-HTTP, non-auth case. Use this
/// inside handlers or helpers that need to emit an extra audit row
/// *beyond* the one the [`middleware`] will already produce. Multi-step
/// compliance workflows (privacy-request execution, anonymisation,
/// consent revocation) typically emit one of these per logical action.
///
/// `ip_hash` is always `None` — helpers do not see request extensions
/// and the IP is already on the middleware-written `http_request` row
/// for the same request.
pub fn domain_event(
    action: impl Into<String>,
    user_id: Option<Uuid>,
    entity_type: impl Into<String>,
    entity_id: Option<Uuid>,
    context: Value,
) -> AuditEvent {
    AuditEvent {
        user_id,
        action: action.into(),
        entity_type: entity_type.into(),
        entity_id,
        context,
        old_value: None,
        new_value: None,
        ip_hash: None,
    }
}

/// Build a domain audit event that records a before/after diff on a
/// mutated entity. See the module-level migration policy for when it
/// is safe to replace a handler-side diff insert with this helper.
pub fn domain_diff_event(
    action: impl Into<String>,
    user_id: Option<Uuid>,
    entity_type: impl Into<String>,
    entity_id: Option<Uuid>,
    old_value: Value,
    new_value: Value,
) -> AuditEvent {
    AuditEvent {
        user_id,
        action: action.into(),
        entity_type: entity_type.into(),
        entity_id,
        context: json!({}),
        old_value: Some(old_value),
        new_value: Some(new_value),
        ip_hash: None,
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
    // NOTE: this is the one intentional `INSERT INTO audit_log` allowed
    // by the hygiene ratchet — it is the single writer for the module.
    // Every handler-side insert that still exists is subject to the
    // migration policy documented at the top of this module.
    sqlx::query(
        r#"
        INSERT INTO audit_log
            (user_id, action, entity_type, entity_id, old_value, new_value, context, ip_address)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        "#,
    )
    .bind(event.user_id)
    .bind(&event.action)
    .bind(&event.entity_type)
    .bind(event.entity_id)
    .bind(event.old_value.as_ref())
    .bind(event.new_value.as_ref())
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
    let base_context = build_context_json(&method, &route, response.status().as_u16(), latency_ms);
    let merged_context = match annotation.context {
        Some(overlay) => merge_json_objects(base_context, overlay),
        None => base_context,
    };
    let event = AuditEvent {
        user_id,
        action: annotation.action.unwrap_or_else(|| HTTP_ACTION.to_string()),
        entity_type: annotation
            .entity_type
            .unwrap_or_else(|| HTTP_ENTITY_TYPE.to_string()),
        entity_id: annotation.entity_id,
        context: merged_context,
        old_value: annotation.old_value,
        new_value: annotation.new_value,
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

/// Shallow object merge: `overlay` keys win over `base` keys. If either
/// side is not an object the overlay wins wholesale, which matches the
/// behaviour a caller who provided a non-object handler context would
/// intuitively expect.
fn merge_json_objects(base: Value, overlay: Value) -> Value {
    match (base, overlay) {
        (Value::Object(mut base_map), Value::Object(overlay_map)) => {
            for (k, v) in overlay_map {
                base_map.insert(k, v);
            }
            Value::Object(base_map)
        }
        (_, overlay) => overlay,
    }
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
                old_value: None,
                new_value: None,
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

    #[test]
    fn audit_context_stores_context_old_and_new_value() {
        let ctx = AuditContext::new();
        ctx.set_context(json!({ "viewed_sections": ["diagnosis", "notes"] }));
        ctx.set_old_value(json!({ "status": "draft" }));
        ctx.set_new_value(json!({ "status": "signed" }));
        let taken = ctx.take();
        assert_eq!(
            taken.context,
            Some(json!({ "viewed_sections": ["diagnosis", "notes"] }))
        );
        assert_eq!(taken.old_value, Some(json!({ "status": "draft" })));
        assert_eq!(taken.new_value, Some(json!({ "status": "signed" })));
    }

    #[test]
    fn merge_json_objects_overlays_handler_keys_on_base() {
        let base = json!({ "method": "GET", "route": "/x", "status": 200 });
        let overlay = json!({ "status": 418, "handler_field": "value" });
        let merged = merge_json_objects(base, overlay);
        assert_eq!(merged["method"], "GET");
        assert_eq!(merged["route"], "/x");
        // Handler intentionally overrode the status field.
        assert_eq!(merged["status"], 418);
        assert_eq!(merged["handler_field"], "value");
    }

    #[test]
    fn merge_json_objects_with_non_object_overlay_keeps_overlay() {
        let merged = merge_json_objects(json!({ "a": 1 }), json!("not an object"));
        assert_eq!(merged, json!("not an object"));
    }

    #[test]
    fn merge_json_objects_with_non_object_base_keeps_overlay() {
        let merged = merge_json_objects(json!(42), json!({ "a": 1 }));
        // Base is a scalar — the overlay wins wholesale because there is
        // nothing sensible to merge the object into.
        assert_eq!(merged, json!({ "a": 1 }));
    }

    #[test]
    fn auth_event_sets_old_and_new_value_to_none() {
        let event = auth_event("login_success", Some(Uuid::new_v4()), None, json!({}));
        assert!(event.old_value.is_none());
        assert!(event.new_value.is_none());
    }

    #[test]
    fn domain_event_carries_supplied_entity_and_no_ip() {
        let actor = Uuid::new_v4();
        let target = Uuid::new_v4();
        let event = domain_event(
            "anonymize_patient",
            Some(actor),
            "patient",
            Some(target),
            json!({ "article": "Art. 17" }),
        );
        assert_eq!(event.action, "anonymize_patient");
        assert_eq!(event.entity_type, "patient");
        assert_eq!(event.entity_id, Some(target));
        assert_eq!(event.user_id, Some(actor));
        assert!(event.ip_hash.is_none());
        assert!(event.old_value.is_none());
        assert!(event.new_value.is_none());
    }

    #[test]
    fn domain_diff_event_populates_old_and_new() {
        let actor = Uuid::new_v4();
        let target = Uuid::new_v4();
        let event = domain_diff_event(
            "update_case",
            Some(actor),
            "case",
            Some(target),
            json!({ "status": "draft" }),
            json!({ "status": "signed" }),
        );
        assert_eq!(event.old_value, Some(json!({ "status": "draft" })));
        assert_eq!(event.new_value, Some(json!({ "status": "signed" })));
        assert_eq!(event.action, "update_case");
    }
}
