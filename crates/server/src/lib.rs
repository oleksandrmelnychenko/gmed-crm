#![recursion_limit = "256"]

pub mod access;
pub mod audit;
pub mod auth;
pub mod config;
pub mod crypto;
pub mod file_scan;
pub mod file_sniff;
pub mod rate_limit;
pub mod realtime;
pub mod routes;
pub mod security_headers;
pub mod settings;
pub mod state;
pub mod telemetry;

use axum::{Router, middleware};

/// Build the full application router (for tests and main).
///
/// The layer stack is built bottom-up:
///
/// 1. Health endpoints carry no rate limit and no auth.
/// 2. Unauthenticated auth endpoints (`/auth/login`, `/auth/refresh`,
///    `/auth/pending/{id}`) sit behind the tight per-IP limiter from
///    [`rate_limit::apply_auth_tight`].
/// 3. Other public endpoints (public `leads` and `messages` surfaces) sit
///    behind the general per-IP limiter.
/// 4. Authenticated routes sit behind the require-auth middleware *and*
///    the general per-IP limiter.
/// 5. The whole tree is wrapped in [`security_headers::apply`] so every
///    response — including 429 responses from the limiters — carries the
///    hardened header baseline.
pub fn build_app(app_state: state::AppState) -> Router {
    let auth_public = rate_limit::apply_auth_tight(routes::auth::public_router());

    let misc_public = rate_limit::apply_general(
        Router::new()
            .merge(routes::leads::public_router())
            .merge(routes::messages::public_router())
            .merge(routes::realtime::public_router())
            .merge(routes::e2e_support::public_router()),
    );

    // Protected routes get three concentric middlewares, applied in
    // `.layer()` order (outermost first runtime-wise):
    //   1. require_auth — attaches AuthUser to the request extensions
    //   2. audit::middleware — records one audit_log row per request,
    //      using the AuthUser left behind by require_auth
    //   3. rate_limit::apply_general — per-IP token bucket
    let protected = rate_limit::apply_general(
        routes::protected_router()
            .layer(middleware::from_fn_with_state(
                app_state.clone(),
                audit::middleware,
            ))
            .layer(middleware::from_fn_with_state(
                app_state.clone(),
                auth::middleware::require_auth,
            )),
    );

    let router = Router::new()
        .merge(routes::health::router())
        .nest("/api/v1", auth_public.merge(misc_public).merge(protected))
        .with_state(app_state);

    security_headers::apply(router)
}
