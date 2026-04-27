use std::sync::Arc;

use gmed_db::DbPool;
use secrecy::{ExposeSecret, SecretString};
use serde_json::Value;
use tokio::sync::broadcast;

use crate::audit::AuditSender;
use crate::crypto::KeyRegistry;
use crate::realtime::RealtimeEvent;
use crate::settings::SettingsCache;

#[derive(Clone)]
pub struct AppState {
    pub db: DbPool,
    jwt_secret: SecretString,
    pub settings: SettingsCache,
    pub message_events: broadcast::Sender<Value>,
    pub realtime_events: broadcast::Sender<RealtimeEvent>,
    pub message_keys: Arc<KeyRegistry>,
    pub audit_sender: AuditSender,
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
            message_keys: Arc::new(message_keys),
            audit_sender: AuditSender::noop(),
        }
    }

    /// Install a live audit sender on an otherwise-constructed state.
    /// `main` calls this once after [`crate::audit::spawn_writer`].
    pub fn with_audit_sender(mut self, sender: AuditSender) -> Self {
        self.audit_sender = sender;
        self
    }

    pub fn jwt_secret(&self) -> &str {
        self.jwt_secret.expose_secret()
    }
}
