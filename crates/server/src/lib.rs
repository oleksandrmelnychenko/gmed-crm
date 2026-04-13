pub mod access;
pub mod auth;
pub mod config;
pub mod crypto;
pub mod file_scan;
pub mod file_sniff;
pub mod routes;
pub mod security_headers;
pub mod settings;
pub mod state;

use axum::{Router, middleware};

/// Build the full application router (for tests and main).
pub fn build_app(app_state: state::AppState) -> Router {
    let protected = routes::protected_router().layer(middleware::from_fn_with_state(
        app_state.clone(),
        auth::middleware::require_auth,
    ));

    let router = Router::new()
        .merge(routes::health::router())
        .nest("/api/v1", routes::public_router().merge(protected))
        .with_state(app_state);

    security_headers::apply(router)
}
