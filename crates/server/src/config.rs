use std::net::SocketAddr;

pub struct Config {
    pub database_url: String,
    pub listen_addr: SocketAddr,
    pub jwt_secret: String,
    pub cors_origin: String,
}

impl Config {
    pub fn from_env() -> Self {
        let port: u16 = std::env::var("PORT")
            .ok()
            .and_then(|p| p.parse().ok())
            .unwrap_or(3000);

        let jwt_secret = std::env::var("JWT_SECRET").unwrap_or_else(|_| {
            if cfg!(debug_assertions) {
                tracing::warn!("JWT_SECRET not set — using dev fallback (NEVER in production)");
                "dev-only-secret-minimum-32-characters-long!!".to_string()
            } else {
                panic!("JWT_SECRET must be set in production");
            }
        });

        if jwt_secret.len() < 32 {
            panic!("JWT_SECRET must be at least 32 characters");
        }

        Self {
            database_url: std::env::var("DATABASE_URL").expect("DATABASE_URL must be set"),
            listen_addr: SocketAddr::from(([0, 0, 0, 0], port)),
            jwt_secret,
            cors_origin: std::env::var("CORS_ORIGIN")
                .unwrap_or_else(|_| "http://localhost:8080".into()),
        }
    }
}
