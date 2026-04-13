//! HTTP request tracing that never puts PII into logs.
//!
//! Two things are exported from this module:
//!
//! 1. [`init_subscriber`] — installs the global `tracing` subscriber from
//!    the environment. `RUST_LOG` controls the level filter (default
//!    `info`) and `LOG_FORMAT` controls the output format: unset or any
//!    non-`json` value produces the human-friendly text format suitable
//!    for local development, while `LOG_FORMAT=json` produces newline-
//!    delimited JSON suitable for CloudWatch / Loki ingestion.
//!
//! 2. [`http_trace_layer`] — returns a [`TraceLayer`] configured with a
//!    PII-safe [`MakeSpan`] implementation. The span's `route` field is
//!    drawn from axum's [`MatchedPath`] extension (the literal route
//!    pattern, e.g. `/api/v1/patients/{id}`), **not** from the raw URI.
//!    Routes like `/api/v1/patients/<uuid>/cases/<uuid>` would otherwise
//!    leak patient and case identifiers into CloudWatch retention, which
//!    is a GDPR Art. 4(1) / ISO 27001 A.8.12 concern for health data.
//!
//! The positive path — a matched route rendering as `/api/v1/patients/{id}`
//! — is tested through the integration-test harness that builds the real
//! router. This module unit-tests the unmatched fallback and confirms that
//! the extraction helper does not observe the raw URI.

use axum::extract::MatchedPath;
use axum::http::Request;
use tower_http::trace::{MakeSpan, TraceLayer};
use tracing::Span;
use tracing_subscriber::EnvFilter;

const LOG_FORMAT_ENV: &str = "LOG_FORMAT";
const LOG_FORMAT_JSON: &str = "json";
const ROUTE_UNMATCHED: &str = "<unmatched>";

/// Install the global tracing subscriber. Must be called exactly once from
/// `main` before any other tracing happens.
pub fn init_subscriber() {
    let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"));

    if wants_json_format() {
        tracing_subscriber::fmt()
            .with_env_filter(filter)
            .json()
            .flatten_event(true)
            .with_current_span(true)
            .with_span_list(false)
            .init();
    } else {
        tracing_subscriber::fmt().with_env_filter(filter).init();
    }
}

fn wants_json_format() -> bool {
    std::env::var(LOG_FORMAT_ENV)
        .map(|v| v.eq_ignore_ascii_case(LOG_FORMAT_JSON))
        .unwrap_or(false)
}

/// Extract the log-safe route label for a request: the matched route
/// pattern when axum has resolved one, otherwise a literal fallback.
///
/// The raw URI path and query string are never observed. This is the only
/// logic path that decides what ends up in the `route` span field, so
/// auditing PII posture reduces to auditing this function.
fn route_label_for<B>(request: &Request<B>) -> &str {
    request
        .extensions()
        .get::<MatchedPath>()
        .map(MatchedPath::as_str)
        .unwrap_or(ROUTE_UNMATCHED)
}

/// Custom [`MakeSpan`] that records only the HTTP method and the matched
/// route pattern.
#[derive(Debug, Clone, Copy, Default)]
pub struct PiiSafeMakeSpan;

impl<B> MakeSpan<B> for PiiSafeMakeSpan {
    fn make_span(&mut self, request: &Request<B>) -> Span {
        tracing::info_span!(
            "http.request",
            method = %request.method(),
            route = %route_label_for(request),
        )
    }
}

/// Build the HTTP trace layer used by the server. The default
/// `OnRequest` / `OnResponse` implementations from `tower_http` log
/// only the method, status and latency — no request or response bodies,
/// no headers — so wiring them through here is safe by construction.
pub fn http_trace_layer() -> TraceLayer<
    tower_http::classify::SharedClassifier<tower_http::classify::ServerErrorsAsFailures>,
    PiiSafeMakeSpan,
> {
    TraceLayer::new_for_http().make_span_with(PiiSafeMakeSpan)
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::Body;
    use axum::http::{Method, Request};

    #[test]
    fn unmatched_request_uses_the_literal_fallback() {
        // A request that never passed through axum's router has no
        // MatchedPath extension. The helper must not fall back to the raw
        // URI — that would defeat the whole point of this module.
        let request = Request::builder()
            .method(Method::GET)
            .uri("/api/v1/patients/11111111-2222-3333-4444-555555555555")
            .body(Body::empty())
            .unwrap();

        assert_eq!(route_label_for(&request), ROUTE_UNMATCHED);
    }

    #[test]
    fn wants_json_format_reads_env_var_case_insensitively() {
        // SAFETY: tests run single-threaded within this test harness entry
        // because they mutate the process environment. If any other test
        // in this crate touches LOG_FORMAT concurrently, add a Mutex.
        // Safe wrappers (`unsafe` is required on edition 2024 for env).
        unsafe {
            std::env::remove_var(LOG_FORMAT_ENV);
        }
        assert!(!wants_json_format());

        unsafe {
            std::env::set_var(LOG_FORMAT_ENV, "text");
        }
        assert!(!wants_json_format());

        unsafe {
            std::env::set_var(LOG_FORMAT_ENV, "json");
        }
        assert!(wants_json_format());

        unsafe {
            std::env::set_var(LOG_FORMAT_ENV, "JSON");
        }
        assert!(wants_json_format());

        unsafe {
            std::env::remove_var(LOG_FORMAT_ENV);
        }
    }

    #[test]
    fn make_span_does_not_panic_on_unmatched_request() {
        let request = Request::builder()
            .method(Method::POST)
            .uri("/whatever")
            .body(Body::empty())
            .unwrap();

        let mut make_span = PiiSafeMakeSpan;
        let _span = MakeSpan::make_span(&mut make_span, &request);
    }
}
