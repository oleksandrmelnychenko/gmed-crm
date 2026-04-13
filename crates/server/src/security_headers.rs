//! HTTP security response headers applied to every route.
//!
//! The set is chosen for a JSON API that is called cross-origin by a trusted
//! single-page frontend:
//!
//! - `Strict-Transport-Security` pins HTTPS for two years with subdomains.
//!   Preload is intentionally omitted — submission to the browser preload
//!   list is an operational decision, not a code decision.
//! - `X-Content-Type-Options: nosniff` blocks MIME sniffing.
//! - `X-Frame-Options: DENY` blocks framing of API responses.
//! - `Referrer-Policy: no-referrer` prevents URL leakage to third parties.
//! - `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'`
//!   is a lock-down CSP suitable for a JSON API — the API never ships HTML,
//!   so no sources need to be allowed.
//! - `Permissions-Policy` denies every sensitive browser feature we do not
//!   use.
//!
//! `Cross-Origin-Resource-Policy` is intentionally **not** set: it would
//! conflict with cross-origin SPA fetches that the CORS middleware in
//! `main.rs` already authorizes. `Cross-Origin-Opener-Policy` is skipped
//! for the same reason — an API does not open popups and the setting only
//! confuses cross-origin requests.
//!
//! All headers are applied with `overriding` semantics so that individual
//! handlers cannot weaken the baseline by accident. This gives a single
//! auditable point for the ISO 27001 A.8.23 / BSI C5 OPS-17 baseline.

use axum::Router;
use http::{HeaderName, HeaderValue, header};
use tower_http::set_header::SetResponseHeaderLayer;

const HSTS_VALUE: &str = "max-age=63072000; includeSubDomains";
const X_FRAME_OPTIONS_VALUE: &str = "DENY";
const REFERRER_POLICY_VALUE: &str = "no-referrer";
const CSP_VALUE: &str = "default-src 'none'; frame-ancestors 'none'";
const PERMISSIONS_POLICY_VALUE: &str =
    "accelerometer=(), camera=(), geolocation=(), gyroscope=(), microphone=(), payment=(), usb=()";

/// Permissions-Policy is not a standard constant in the `http` crate.
fn permissions_policy_name() -> HeaderName {
    HeaderName::from_static("permissions-policy")
}

/// Wrap the router with the security-header baseline.
pub fn apply<S>(router: Router<S>) -> Router<S>
where
    S: Clone + Send + Sync + 'static,
{
    router
        .layer(SetResponseHeaderLayer::overriding(
            header::STRICT_TRANSPORT_SECURITY,
            HeaderValue::from_static(HSTS_VALUE),
        ))
        .layer(SetResponseHeaderLayer::overriding(
            header::X_CONTENT_TYPE_OPTIONS,
            HeaderValue::from_static("nosniff"),
        ))
        .layer(SetResponseHeaderLayer::overriding(
            header::X_FRAME_OPTIONS,
            HeaderValue::from_static(X_FRAME_OPTIONS_VALUE),
        ))
        .layer(SetResponseHeaderLayer::overriding(
            header::REFERRER_POLICY,
            HeaderValue::from_static(REFERRER_POLICY_VALUE),
        ))
        .layer(SetResponseHeaderLayer::overriding(
            header::CONTENT_SECURITY_POLICY,
            HeaderValue::from_static(CSP_VALUE),
        ))
        .layer(SetResponseHeaderLayer::overriding(
            permissions_policy_name(),
            HeaderValue::from_static(PERMISSIONS_POLICY_VALUE),
        ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{Router, body::Body, routing::get};
    use http::{Request, StatusCode};
    use tower::ServiceExt;

    fn test_app() -> Router {
        apply(Router::new().route("/", get(|| async { "ok" })))
    }

    #[tokio::test]
    async fn every_baseline_header_is_present_on_a_response() {
        let response = test_app()
            .oneshot(Request::builder().uri("/").body(Body::empty()).unwrap())
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        let headers = response.headers();

        assert_eq!(
            headers
                .get(header::STRICT_TRANSPORT_SECURITY)
                .and_then(|v| v.to_str().ok()),
            Some(HSTS_VALUE)
        );
        assert_eq!(
            headers
                .get(header::X_CONTENT_TYPE_OPTIONS)
                .and_then(|v| v.to_str().ok()),
            Some("nosniff")
        );
        assert_eq!(
            headers
                .get(header::X_FRAME_OPTIONS)
                .and_then(|v| v.to_str().ok()),
            Some(X_FRAME_OPTIONS_VALUE)
        );
        assert_eq!(
            headers
                .get(header::REFERRER_POLICY)
                .and_then(|v| v.to_str().ok()),
            Some(REFERRER_POLICY_VALUE)
        );
        assert_eq!(
            headers
                .get(header::CONTENT_SECURITY_POLICY)
                .and_then(|v| v.to_str().ok()),
            Some(CSP_VALUE)
        );
        assert_eq!(
            headers
                .get(permissions_policy_name())
                .and_then(|v| v.to_str().ok()),
            Some(PERMISSIONS_POLICY_VALUE)
        );
    }

    #[tokio::test]
    async fn overriding_beats_handler_set_header() {
        // A handler that tries to set a weaker policy must lose.
        async fn bad_handler() -> impl axum::response::IntoResponse {
            (
                [(header::X_FRAME_OPTIONS, "ALLOWALL")],
                "weakening attempt",
            )
        }
        let app = apply(Router::new().route("/", get(bad_handler)));

        let response = app
            .oneshot(Request::builder().uri("/").body(Body::empty()).unwrap())
            .await
            .unwrap();

        assert_eq!(
            response
                .headers()
                .get(header::X_FRAME_OPTIONS)
                .and_then(|v| v.to_str().ok()),
            Some(X_FRAME_OPTIONS_VALUE)
        );
    }
}
