use std::net::SocketAddr;

use crate::crypto::KeyRegistry;

pub struct Config {
    pub database_url: String,
    pub listen_addr: SocketAddr,
    pub jwt_secret: String,
    pub cors_origin: String,
    pub message_key_registry: KeyRegistry,
}

impl Config {
    pub fn from_env() -> Self {
        let port: u16 = std::env::var("PORT")
            .ok()
            .and_then(|p| p.parse().ok())
            .unwrap_or(3000);

        let jwt_secret = std::env::var("JWT_SECRET")
            .expect("JWT_SECRET must be set. Generate with: openssl rand -base64 48");

        if jwt_secret.len() < 32 {
            panic!("JWT_SECRET must be at least 32 characters");
        }
        if jwt_secret == "dev-only-secret-minimum-32-characters-long!!"
            || jwt_secret == "change-me-in-production"
        {
            panic!("JWT_SECRET is set to a known placeholder value — rotate immediately");
        }

        let message_key_registry = KeyRegistry::from_env().unwrap_or_else(|e| {
            panic!(
                "Failed to load message encryption keys: {e}. Set MESSAGE_ENCRYPTION_KEYS=v1:<base64 32 bytes> (generate with: openssl rand -base64 32)."
            )
        });

        Self {
            database_url: std::env::var("DATABASE_URL").expect("DATABASE_URL must be set"),
            listen_addr: SocketAddr::from(([0, 0, 0, 0], port)),
            jwt_secret,
            cors_origin: std::env::var("CORS_ORIGIN")
                .unwrap_or_else(|_| "http://localhost:8080".into()),
            message_key_registry,
        }
    }
}
