use tower_http::cors::CorsLayer;
use tower_http::trace::TraceLayer;
use tracing_subscriber::EnvFilter;

use gmed_server::{build_app, config, settings, state};

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()))
        .init();

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

    let app_state = state::AppState::new_with_keys(
        pool,
        cfg.jwt_secret,
        settings_cache,
        cfg.message_key_registry,
    );
    gmed_server::routes::invoices::spawn_auto_dunning_scheduler(app_state.clone());
    spawn_blacklist_purger(app_state.db.clone());
    spawn_message_rewrap_sweeper(app_state.clone());

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
    // config-time origin values) and HTTP tracing.
    let app = build_app(app_state).layer(cors).layer(TraceLayer::new_for_http());

    tracing::info!("Server starting on {}", cfg.listen_addr);

    let listener = match tokio::net::TcpListener::bind(cfg.listen_addr).await {
        Ok(l) => l,
        Err(e) => {
            tracing::error!("Failed to bind {}: {e}", cfg.listen_addr);
            std::process::exit(1);
        }
    };

    axum::serve(listener, app)
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
