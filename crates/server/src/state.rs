use std::sync::Arc;

use gmed_db::DbPool;
use secrecy::{ExposeSecret, SecretString};
use serde_json::Value;
use tokio::sync::broadcast;

use crate::crypto::KeyRegistry;
use crate::settings::SettingsCache;

#[derive(Clone)]
pub struct AppState {
    pub db: DbPool,
    jwt_secret: SecretString,
    pub settings: SettingsCache,
    pub message_events: broadcast::Sender<Value>,
    pub message_keys: Arc<KeyRegistry>,
}

impl AppState {
    /// Test/legacy constructor — installs a single deterministic key.
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
        Self {
            db,
            jwt_secret: SecretString::from(jwt_secret.into()),
            settings,
            message_events,
            message_keys: Arc::new(message_keys),
        }
    }

    pub fn jwt_secret(&self) -> &str {
        self.jwt_secret.expose_secret()
    }
}
