use std::net::SocketAddr;

use tower_http::cors::CorsLayer;

use gmed_server::{audit, build_app, config, settings, state, telemetry};

#[tokio::main]
async fn main() {
    telemetry::init_subscriber();

    dotenvy::dotenv().ok();

    let cfg = config::Config::from_env();

    let pool = match gmed_db::create_pool(&cfg.database_url).await {
        Ok(p) => p,
        Err(e) => {
            tracing::error!("Failed to connect to database: {e}");
            std::process::exit(1);
        }
    };

    if let Err(e) = gmed_db::run_migrations(&pool).await {
        tracing::error!("Failed to run migrations: {e}");
        std::process::exit(1);
    }
    tracing::info!("Migrations applied");

    let token_settings = settings::load_from_db(&pool).await.unwrap_or_default();
    tracing::info!(
        access_token_min = token_settings.access_token_minutes,
        refresh_token_days = token_settings.refresh_token_days,
        max_sessions = token_settings.max_sessions_per_user,
        "Token settings loaded"
    );
    let settings_cache = settings::SettingsCache::new(token_settings);

    let audit_sender = audit::spawn_writer(pool.clone(), cfg.audit_ip_salt);
    let app_state = state::AppState::new_with_keys(
        pool,
        cfg.jwt_secret,
        settings_cache,
        cfg.message_key_registry,
    )
    .with_audit_sender(audit_sender);
    gmed_server::routes::invoices::spawn_auto_dunning_scheduler(app_state.clone());
    spawn_blacklist_purger(app_state.db.clone());
    spawn_message_rewrap_sweeper(app_state.clone());
    spawn_lead_purger(app_state.clone());

    let cors = CorsLayer::new()
        .allow_origin(
            cfg.cors_origin
                .parse::<http::HeaderValue>()
                .expect("Invalid CORS_ORIGIN"),
        )
        .allow_methods([
            http::Method::GET,
            http::Method::POST,
            http::Method::PUT,
            http::Method::PATCH,
            http::Method::DELETE,
        ])
        .allow_headers([
            http::header::AUTHORIZATION,
            http::header::CONTENT_TYPE,
            http::header::ACCEPT,
        ])
        .allow_credentials(true);

    // Security-header baseline is applied inside `build_app` so integration
    // tests exercise it too; here we only add the CORS layer (which needs
    // config-time origin values) and the PII-safe HTTP tracing layer.
    let app = build_app(app_state)
        .layer(cors)
        .layer(telemetry::http_trace_layer());

    tracing::info!("Server starting on {}", cfg.listen_addr);

    let listener = match tokio::net::TcpListener::bind(cfg.listen_addr).await {
        Ok(l) => l,
        Err(e) => {
            tracing::error!("Failed to bind {}: {e}", cfg.listen_addr);
            std::process::exit(1);
        }
    };

    // `into_make_service_with_connect_info` injects ConnectInfo<SocketAddr>
    // into every request's extensions. The audit middleware reads this to
    // hash the peer IP, and `tower_governor::PeerIpKeyExtractor` reads it
    // for per-IP rate limiting. Without this the rate limiter silently
    // collapses into a single global bucket.
    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .with_graceful_shutdown(shutdown_signal())
    .await
    .unwrap_or_else(|e| {
        tracing::error!("Server error: {e}");
        std::process::exit(1);
    });

    tracing::info!("Server shut down gracefully");
}

fn spawn_message_rewrap_sweeper(state: state::AppState) {
    // Re-encrypts up to 200 rows every 10 minutes onto the active key.
    // Designed to be fail-safe — errors are logged but never crash the loop.
    tokio::spawn(async move {
        let mut ticker = tokio::time::interval(std::time::Duration::from_secs(600));
        ticker.tick().await; // skip initial fire
        loop {
            ticker.tick().await;
            match gmed_server::routes::key_rotation::rewrap_messages(
                &state.db,
                &state.message_keys,
                200,
            )
            .await
            {
                Ok(report) if report.messages_rewrapped > 0 => {
                    tracing::info!(
                        rewrapped = report.messages_rewrapped,
                        attachments = report.attachments_rewrapped,
                        remaining = report.remaining_old_rows,
                        active_key = %report.active_key_id,
                        "Periodic message key rewrap"
                    );
                }
                Ok(_) => {}
                Err(e) => tracing::warn!(error = ?e, "Periodic rewrap failed"),
            }
        }
    });
}

/// Enforces GDPR Art. 5(1)(e) Storage Limitation on the lead table.
/// Once per day the sweeper calls `leads::auto_purge_stale_archived`,
/// which anonymises every lead that has been sitting in an archived or
/// failed state past the retention window configured in
/// `system_settings.cleanup_archived_leads_days` (default 180 days).
///
/// The sweeper is fail-safe: a DB error logs a warning and the loop
/// continues, so one bad day never leaves the next day unattended.
fn spawn_lead_purger(state: state::AppState) {
    tokio::spawn(async move {
        // Once per 24 hours — the window the retention policy operates
        // on is days, so sub-day cadence adds noise without benefit.
        let mut ticker = tokio::time::interval(std::time::Duration::from_secs(86_400));
        ticker.tick().await; // skip initial fire so startup is not noisy
        loop {
            ticker.tick().await;
            match gmed_server::routes::leads::auto_purge_stale_archived(&state).await {
                Ok(report) if report.scanned > 0 => {
                    tracing::info!(
                        retention_days = report.retention_days,
                        scanned = report.scanned,
                        anonymized = report.anonymized,
                        errors = report.errors,
                        "Lead auto-purge sweep complete"
                    );
                }
                Ok(_) => {}
                Err(e) => {
                    tracing::error!(error = %e, "Lead auto-purge sweep failed");
                }
            }
        }
    });
}

fn spawn_blacklist_purger(pool: gmed_db::DbPool) {
    tokio::spawn(async move {
        let mut ticker = tokio::time::interval(std::time::Duration::from_secs(3600));
        ticker.tick().await;
        loop {
            ticker.tick().await;
            match gmed_server::auth::blacklist::purge_expired(&pool).await {
                Ok(0) => {}
                Ok(n) => tracing::info!(rows = n, "Purged expired access-token blacklist rows"),
                Err(e) => tracing::warn!(error = %e, "Blacklist purge failed"),
            }
        }
    });
}

async fn shutdown_signal() {
    let ctrl_c = async {
        tokio::signal::ctrl_c()
            .await
            .expect("Failed to install Ctrl+C handler");
    };

    #[cfg(unix)]
    let terminate = async {
        tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            .expect("Failed to install SIGTERM handler")
            .recv()
            .await;
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        () = ctrl_c => tracing::info!("Received Ctrl+C"),
        () = terminate => tracing::info!("Received SIGTERM"),
    }
}
