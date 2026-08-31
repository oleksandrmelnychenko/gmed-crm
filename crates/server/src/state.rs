use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use gmed_db::DbPool;
use secrecy::{ExposeSecret, SecretString};
use serde_json::Value;
use tokio::sync::broadcast;

use crate::audit::AuditSender;
use crate::config::MedicationAiConfig;
use crate::crypto::KeyRegistry;
use crate::realtime::RealtimeEvent;
use crate::services::medication_ai_provider::MedicationAiProvider;
use crate::settings::SettingsCache;

#[derive(Clone)]
pub struct AppState {
    pub db: DbPool,
    jwt_secret: SecretString,
    pub settings: SettingsCache,
    pub message_events: broadcast::Sender<Value>,
    pub realtime_events: broadcast::Sender<RealtimeEvent>,
    pub websocket_connections: Arc<WebSocketConnectionRegistry>,
    pub message_keys: Arc<KeyRegistry>,
    pub audit_sender: AuditSender,
    pub medication_ai: Arc<MedicationAiProvider>,
}

impl AppState {
    /// Test/legacy constructor — installs a single deterministic key and a
    /// no-op audit sender. Tests that do not exercise the audit pipeline
    /// continue to work without any changes.
    pub fn new(db: DbPool, jwt_secret: impl Into<String>, settings: SettingsCache) -> Self {
        let registry =
            KeyRegistry::from_pairs(vec![("test".to_string(), [0u8; 32])], "test".to_string())
                .expect("test key registry");
        Self::new_with_keys(db, jwt_secret, settings, registry)
    }

    pub fn new_with_keys(
        db: DbPool,
        jwt_secret: impl Into<String>,
        settings: SettingsCache,
        message_keys: KeyRegistry,
    ) -> Self {
        let (message_events, _) = broadcast::channel(512);
        let (realtime_events, _) = broadcast::channel(1024);
        Self {
            db,
            jwt_secret: SecretString::from(jwt_secret.into()),
            settings,
            message_events,
            realtime_events,
            websocket_connections: Arc::new(WebSocketConnectionRegistry::default()),
            message_keys: Arc::new(message_keys),
            audit_sender: AuditSender::noop(),
            medication_ai: Arc::new(MedicationAiProvider::new(MedicationAiConfig::default())),
        }
    }

    /// Install a live audit sender on an otherwise-constructed state.
    /// `main` calls this once after [`crate::audit::spawn_writer`].
    pub fn with_audit_sender(mut self, sender: AuditSender) -> Self {
        self.audit_sender = sender;
        self
    }

    pub fn with_medication_ai(mut self, config: MedicationAiConfig) -> Self {
        self.medication_ai = Arc::new(MedicationAiProvider::new(config));
        self
    }

    pub fn jwt_secret(&self) -> &str {
        self.jwt_secret.expose_secret()
    }
}

/// Bounds the number of long-lived WebSocket transports owned by one account.
///
/// Both chat and general realtime sockets share this registry so opening one
/// transport reduces the remaining allowance for the other. The permit is
/// RAII-backed and releases its slot even when a handler exits through an
/// authentication, expiry, lag, or network-error path.
#[derive(Debug, Default)]
pub struct WebSocketConnectionRegistry {
    state: Mutex<WebSocketConnectionCounts>,
}

pub const MAX_WEBSOCKET_CONNECTIONS_PER_USER: usize = 4;
pub const MAX_WEBSOCKET_CONNECTIONS_GLOBAL: usize = 512;

#[derive(Debug, Default)]
struct WebSocketConnectionCounts {
    by_user: HashMap<uuid::Uuid, usize>,
    total: usize,
}

impl WebSocketConnectionRegistry {
    /// Reserve one process-wide slot as soon as a WebSocket transport has
    /// upgraded, before it starts waiting for the first authentication frame.
    /// The returned permit can be bound to a user after authentication without
    /// incrementing the global count a second time.
    pub fn try_acquire_handshake(self: &Arc<Self>) -> Option<WebSocketConnectionPermit> {
        let mut state = self.state.lock().ok()?;
        if state.total >= MAX_WEBSOCKET_CONNECTIONS_GLOBAL {
            metrics::counter!(
                crate::business_metrics::CHAT_WEBSOCKET_REJECTIONS_TOTAL,
                "reason" => "global"
            )
            .increment(1);
            return None;
        }
        state.total += 1;
        metrics::gauge!(crate::business_metrics::CHAT_WEBSOCKET_CONNECTIONS)
            .set(state.total as f64);
        Some(WebSocketConnectionPermit {
            registry: Arc::clone(self),
            user_id: None,
        })
    }

    pub fn try_acquire(self: &Arc<Self>, user_id: uuid::Uuid) -> Option<WebSocketConnectionPermit> {
        let mut permit = self.try_acquire_handshake()?;
        permit.try_bind_user(user_id).then_some(permit)
    }

    #[cfg(test)]
    fn active_for(&self, user_id: uuid::Uuid) -> usize {
        self.state
            .lock()
            .ok()
            .and_then(|state| state.by_user.get(&user_id).copied())
            .unwrap_or_default()
    }

    #[cfg(test)]
    fn active_total(&self) -> usize {
        self.state
            .lock()
            .map(|state| state.total)
            .unwrap_or_default()
    }
}

pub struct WebSocketConnectionPermit {
    registry: Arc<WebSocketConnectionRegistry>,
    user_id: Option<uuid::Uuid>,
}

impl WebSocketConnectionPermit {
    /// Promote an already-counted handshake slot to an authenticated user.
    /// Failure leaves the permit unbound so dropping it still releases the
    /// process-wide slot.
    pub fn try_bind_user(&mut self, user_id: uuid::Uuid) -> bool {
        if self.user_id.is_some() {
            return false;
        }
        let Ok(mut state) = self.registry.state.lock() else {
            return false;
        };
        let current = state.by_user.get(&user_id).copied().unwrap_or_default();
        if current >= MAX_WEBSOCKET_CONNECTIONS_PER_USER {
            metrics::counter!(
                crate::business_metrics::CHAT_WEBSOCKET_REJECTIONS_TOTAL,
                "reason" => "per_user"
            )
            .increment(1);
            return false;
        }
        state.by_user.insert(user_id, current + 1);
        self.user_id = Some(user_id);
        true
    }
}

impl Drop for WebSocketConnectionPermit {
    fn drop(&mut self) {
        let Ok(mut state) = self.registry.state.lock() else {
            return;
        };
        state.total = state.total.saturating_sub(1);
        if let Some(user_id) = self.user_id {
            let remove_user = if let Some(current) = state.by_user.get_mut(&user_id) {
                *current = current.saturating_sub(1);
                *current == 0
            } else {
                false
            };
            if remove_user {
                state.by_user.remove(&user_id);
            }
        }
        metrics::gauge!(crate::business_metrics::CHAT_WEBSOCKET_CONNECTIONS)
            .set(state.total as f64);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn websocket_registry_enforces_and_releases_per_user_quota() {
        let registry = Arc::new(WebSocketConnectionRegistry::default());
        let user_id = uuid::Uuid::new_v4();
        let other_user_id = uuid::Uuid::new_v4();

        let permits = (0..MAX_WEBSOCKET_CONNECTIONS_PER_USER)
            .map(|_| registry.try_acquire(user_id).expect("permit within quota"))
            .collect::<Vec<_>>();
        assert!(registry.try_acquire(user_id).is_none());
        assert!(registry.try_acquire(other_user_id).is_some());

        drop(permits);
        assert_eq!(registry.active_for(user_id), 0);
        assert_eq!(registry.active_total(), 0);
        assert!(registry.try_acquire(user_id).is_some());
    }

    #[test]
    fn websocket_registry_enforces_global_quota() {
        let registry = Arc::new(WebSocketConnectionRegistry::default());
        let permits = (0..MAX_WEBSOCKET_CONNECTIONS_GLOBAL)
            .map(|idx| {
                let user_id = uuid::Uuid::from_u128(idx as u128 + 1);
                registry.try_acquire(user_id).expect("global quota permit")
            })
            .collect::<Vec<_>>();

        assert_eq!(registry.active_total(), MAX_WEBSOCKET_CONNECTIONS_GLOBAL);
        assert!(registry.try_acquire(uuid::Uuid::new_v4()).is_none());
        drop(permits);
        assert_eq!(registry.active_total(), 0);
    }

    #[test]
    fn websocket_registry_counts_and_releases_unauthenticated_handshakes() {
        let registry = Arc::new(WebSocketConnectionRegistry::default());
        let permits = (0..MAX_WEBSOCKET_CONNECTIONS_GLOBAL)
            .map(|_| {
                registry
                    .try_acquire_handshake()
                    .expect("handshake within global quota")
            })
            .collect::<Vec<_>>();

        assert_eq!(registry.active_total(), MAX_WEBSOCKET_CONNECTIONS_GLOBAL);
        assert!(registry.try_acquire_handshake().is_none());
        drop(permits);
        assert_eq!(registry.active_total(), 0);
    }

    #[test]
    fn websocket_handshake_promotion_does_not_double_count() {
        let registry = Arc::new(WebSocketConnectionRegistry::default());
        let user_id = uuid::Uuid::new_v4();
        let mut permit = registry.try_acquire_handshake().expect("handshake permit");

        assert_eq!(registry.active_total(), 1);
        assert!(permit.try_bind_user(user_id));
        assert_eq!(registry.active_total(), 1);
        assert_eq!(registry.active_for(user_id), 1);
        drop(permit);
        assert_eq!(registry.active_total(), 0);
        assert_eq!(registry.active_for(user_id), 0);
    }
}
