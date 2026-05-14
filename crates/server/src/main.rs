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

    let token_settings = match settings::load_from_db(&pool).await {
        Ok(s) => s,
        Err(e) => {
            tracing::error!(
                error = %e,
                "Failed to load token settings from system_settings — falling back to defaults"
            );
            settings::TokenSettings::default()
        }
    };
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
    gmed_server::routes::cases::spawn_medication_expiry_scheduler(app_state.clone());
    gmed_server::routes::orders::spawn_external_invoice_deadline_scheduler(app_state.clone());
    gmed_server::routes::appointments::spawn_interpreter_report_billing_sync_scheduler(
        app_state.clone(),
    );
    spawn_blacklist_purger(app_state.db.clone());
    spawn_message_rewrap_sweeper(app_state.clone());
    spawn_lead_purger(app_state.clone());

    let cors_origin = match cfg.cors_origin.parse::<http::HeaderValue>() {
        Ok(v) => v,
        Err(e) => {
            tracing::error!(
                error = %e,
                value = %cfg.cors_origin,
                "CORS_ORIGIN is not a valid HTTP header value"
            );
            std::process::exit(1);
        }
    };
    let cors = CorsLayer::new()
        .allow_origin(cors_origin)
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

    // Prometheus instrumentation. The pair is built BEFORE the app so
    // the layer can wrap every request and the handle can be moved into
    // the dedicated metrics-only HTTP listener (spawned below). The
    // layer goes outside rate_limit so 429s are still counted as
    // requests — otherwise rate-limit storms become invisible in
    // metrics, which defeats the whole alerting setup.
    let (prometheus_layer, metric_handle) = axum_prometheus::PrometheusMetricLayerBuilder::new()
        .with_default_metrics()
        .build_pair();

    // Register `# HELP` text for every business counter declared in
    // `business_metrics`. Must run AFTER the recorder is installed by
    // the builder above; a describe before recorder install is a
    // silent no-op.
    gmed_server::business_metrics::describe_all();

    if let Some(metrics_addr) = cfg.metrics_listen {
        let handle_for_route = metric_handle.clone();
        tokio::spawn(async move {
            let metrics_app: axum::Router = axum::Router::new().route(
                "/metrics",
                axum::routing::get(move || {
                    let handle = handle_for_route.clone();
                    async move { handle.render() }
                }),
            );
            match tokio::net::TcpListener::bind(metrics_addr).await {
                Ok(listener) => {
                    tracing::info!(addr = %metrics_addr, "Metrics endpoint listening");
                    if let Err(e) = axum::serve(listener, metrics_app).await {
                        tracing::error!(error = %e, "Metrics server exited");
                    }
                }
                Err(e) => {
                    // A failed bind on the metrics port is not fatal to
                    // the application — log and carry on. Observability
                    // should never take down the service it observes.
                    tracing::error!(
                        addr = %metrics_addr,
                        error = %e,
                        "Failed to bind metrics endpoint — continuing without /metrics"
                    );
                }
            }
        });
    }

    // Security-header baseline is applied inside `build_app` so integration
    // tests exercise it too; here we only add the CORS layer (which needs
    // config-time origin values), the PII-safe HTTP tracing layer, and
    // the Prometheus instrumentation.
    let app = build_app(app_state)
        .layer(cors)
        .layer(telemetry::http_trace_layer())
        .layer(prometheus_layer);

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
        if let Err(e) = tokio::signal::ctrl_c().await {
            tracing::warn!(error = %e, "Ctrl+C handler failed; graceful shutdown via SIGINT disabled");
            std::future::pending::<()>().await;
        }
    };

    #[cfg(unix)]
    let terminate = async {
        match tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()) {
            Ok(mut signal) => {
                signal.recv().await;
            }
            Err(e) => {
                tracing::warn!(error = %e, "SIGTERM handler install failed; graceful shutdown via SIGTERM disabled");
                std::future::pending::<()>().await;
            }
        }
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        () = ctrl_c => tracing::info!("Received Ctrl+C"),
        () = terminate => tracing::info!("Received SIGTERM"),
    }
}
