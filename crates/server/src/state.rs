use gmed_db::DbPool;
use secrecy::{ExposeSecret, SecretString};

use crate::settings::SettingsCache;

#[derive(Clone)]
pub struct AppState {
    pub db: DbPool,
    jwt_secret: SecretString,
    pub settings: SettingsCache,
}

impl AppState {
    pub fn new(db: DbPool, jwt_secret: impl Into<String>, settings: SettingsCache) -> Self {
        Self {
            db,
            jwt_secret: SecretString::from(jwt_secret.into()),
            settings,
        }
    }

    pub fn jwt_secret(&self) -> &str {
        self.jwt_secret.expose_secret()
    }
}
