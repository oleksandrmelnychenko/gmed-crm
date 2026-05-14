use std::net::SocketAddr;

use crate::crypto::KeyRegistry;

pub struct Config {
    pub database_url: String,
    pub listen_addr: SocketAddr,
    pub jwt_secret: String,
    pub cors_origin: String,
    pub message_key_registry: KeyRegistry,
    /// Salt used to pseudonymise peer IPs before they reach `audit_log`.
    /// Falls back to `JWT_SECRET` when `AUDIT_IP_SALT` is not set so a
    /// fresh deployment works out of the box, but operators rotating
    /// `JWT_SECRET` should set a dedicated `AUDIT_IP_SALT` beforehand
    /// to keep IP-hash stability across the rotation.
    pub audit_ip_salt: String,
    /// Address the Prometheus `/metrics` endpoint binds to. Defaults to
    /// `0.0.0.0:9091`. Set to an empty string to disable the metrics
    /// listener entirely (useful in unit tests; PROD always runs it).
    pub metrics_listen: Option<SocketAddr>,
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

        let audit_ip_salt = std::env::var("AUDIT_IP_SALT").unwrap_or_else(|_| {
            tracing::warn!(
                "AUDIT_IP_SALT is not set — reusing JWT_SECRET as the salt. Rotating JWT_SECRET will \
                 invalidate all historical audit-IP hash correlations. Set a dedicated AUDIT_IP_SALT \
                 (e.g. `openssl rand -base64 32`) to keep hash stability across rotations."
            );
            jwt_secret.clone()
        });

        // Empty METRICS_LISTEN disables the endpoint. Unset uses the
        // default (`0.0.0.0:9091`). Anything else must parse to a valid
        // socket address.
        let metrics_listen = match std::env::var("METRICS_LISTEN") {
            Ok(s) if s.trim().is_empty() => None,
            Ok(s) => Some(s.parse().unwrap_or_else(|e| {
                panic!("METRICS_LISTEN ({s}) is not a valid socket address: {e}")
            })),
            Err(_) => Some(SocketAddr::from(([0, 0, 0, 0], 9091))),
        };

        Self {
            database_url: std::env::var("DATABASE_URL").expect("DATABASE_URL must be set"),
            listen_addr: SocketAddr::from(([0, 0, 0, 0], port)),
            jwt_secret,
            cors_origin: std::env::var("CORS_ORIGIN")
                .unwrap_or_else(|_| "http://localhost:8080".into()),
            message_key_registry,
            audit_ip_salt,
            metrics_listen,
        }
    }
}
