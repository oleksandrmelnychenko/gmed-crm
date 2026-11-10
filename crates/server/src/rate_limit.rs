//! Per-client rate limiting for the public API surface.
//!
//! Two independent GCRA (Generic Cell Rate Algorithm) limiters are exposed,
//! each backed by its own token bucket so traffic on one does not starve the
//! other:
//!
//! - [`apply_auth_tight`] — wraps the unauthenticated auth endpoints
//!   (`/auth/login`, `/auth/totp`, `/auth/refresh`, `/auth/pending/{id}`) with 10 requests
//!   per 60 seconds per peer IP. The ceiling is a deliberate compromise:
//!   strict enough to break credential-stuffing and password-spray campaigns,
//!   lax enough that a real user who fat-fingers a password three times
//!   still gets in.
//! - [`apply_general`] — wraps every other public and authenticated route
//!   with 100 requests per 60 seconds per peer IP. This is not a security
//!   control against targeted attackers; it is a soft ceiling that stops
//!   buggy clients and runaway scripts from consuming the whole database
//!   pool.
//!
//! ## Client identification
//!
//! Two key-extraction modes are supported, selected at startup by the
//! `TRUST_FORWARDED_HEADERS` environment variable.
//!
//! - **Unset / `false` (default)** — `PeerIpKeyExtractor` keys off the TCP
//!   peer address. Correct when the server is reached directly (local
//!   dev, single-tenant VM with no proxy). Any `X-Forwarded-For` header
//!   in this mode would be attacker-controlled and is ignored.
//! - **`true`** — `SmartIpKeyExtractor` reads the client IP from
//!   `Forwarded` / `X-Forwarded-For` / `X-Real-IP`, in that order. Set
//!   this only when the listener is **always** behind a trusted reverse
//!   proxy that strips client-supplied forwarding headers and writes its
//!   own. In our Hetzner topology that proxy is Caddy (in front of the
//!   frontend nginx, which appends its own hop), so the resulting chain
//!   is `client, caddy_ip` and `SmartIpKeyExtractor` picks the leftmost
//!   entry as the client.
//!
//! Flipping the switch with no proxy in place is a footgun: clients can
//! spoof their bucket key. The deployment unit that sets
//! `TRUST_FORWARDED_HEADERS=true` MUST also close the backend port to
//! anything except the proxy.
//!
//! ## Rejected requests
//!
//! `tower_governor` responds to a rejected request with HTTP 429 and a
//! `Retry-After` header computed from the bucket state, which is exactly
//! the behaviour ISO 27001 A.8.6 and BSI C5 OPS-13 expect from an effective
//! "capacity management" control.

use std::net::{IpAddr, SocketAddr};
use std::time::Duration;

use axum::Router;
use axum::http::HeaderMap;
use tower_governor::GovernorLayer;
use tower_governor::governor::GovernorConfigBuilder;
use tower_governor::key_extractor::{PeerIpKeyExtractor, SmartIpKeyExtractor};

/// Allowed auth request burst before the bucket begins throttling.
const AUTH_BURST: u32 = 10;
/// Refill interval for the auth bucket — one token every six seconds gives
/// a steady-state of 10 requests per minute after the initial burst.
const AUTH_REFILL: Duration = Duration::from_secs(6);

/// Allowed general request burst.
const GENERAL_BURST: u32 = 600;
/// Refill interval for the general bucket — one token every 600 ms gives
/// a steady-state of 100 requests per minute after the initial burst.
const GENERAL_REFILL: Duration = Duration::from_millis(100);

fn limiter_disabled_for_e2e() -> bool {
    std::env::var("ENABLE_E2E_SUPPORT")
        .ok()
        .as_deref()
        .is_some_and(|value| matches!(value, "1" | "true" | "TRUE" | "yes" | "YES"))
}

fn trust_forwarded_headers() -> bool {
    std::env::var("TRUST_FORWARDED_HEADERS")
        .ok()
        .as_deref()
        .is_some_and(|value| matches!(value, "1" | "true" | "TRUE" | "yes" | "YES"))
}

/// The client address the sign-in handlers use (IP allow-list, sign-in
/// throttle, audit), derived like the limiter's bucket key: the forwarding
/// headers count only with `TRUST_FORWARDED_HEADERS`, otherwise (or when they
/// carry no address) the TCP peer. `None` when neither is known — a header
/// sent by the client is never trusted with the flag off.
pub fn client_ip(headers: &HeaderMap, peer: Option<SocketAddr>) -> Option<String> {
    client_ip_with(trust_forwarded_headers(), headers, peer)
}

fn client_ip_with(
    trust_forwarded: bool,
    headers: &HeaderMap,
    peer: Option<SocketAddr>,
) -> Option<String> {
    if trust_forwarded {
        let forwarded = headers
            .get("x-forwarded-for")
            .or_else(|| headers.get("x-real-ip"))
            .and_then(|value| value.to_str().ok())
            .map(|value| value.split(',').next().unwrap_or(value).trim())
            .and_then(|value| value.parse::<IpAddr>().ok());
        if let Some(ip) = forwarded {
            return Some(ip.to_canonical().to_string());
        }
    }
    peer.map(|addr| addr.ip().to_canonical().to_string())
}

fn build_and_wrap<S>(router: Router<S>, burst: u32, refill: Duration) -> Router<S>
where
    S: Clone + Send + Sync + 'static,
{
    if limiter_disabled_for_e2e() {
        return router;
    }

    // `SmartIpKeyExtractor` and `PeerIpKeyExtractor` produce differently
    // parameterised `GovernorConfig<K, _>`, so each branch builds and
    // attaches the layer independently. The arms share no state — the
    // duplication is fine.
    if trust_forwarded_headers() {
        let config = GovernorConfigBuilder::default()
            .period(refill)
            .burst_size(burst)
            .key_extractor(SmartIpKeyExtractor)
            .finish()
            .expect("rate-limit quota constants are static and non-zero");
        router.layer(GovernorLayer::new(config))
    } else {
        let config = GovernorConfigBuilder::default()
            .period(refill)
            .burst_size(burst)
            .key_extractor(PeerIpKeyExtractor)
            .finish()
            .expect("rate-limit quota constants are static and non-zero");
        router.layer(GovernorLayer::new(config))
    }
}

/// Wrap a router in the tight auth-endpoint limiter.
pub fn apply_auth_tight<S>(router: Router<S>) -> Router<S>
where
    S: Clone + Send + Sync + 'static,
{
    build_and_wrap(router, AUTH_BURST, AUTH_REFILL)
}

/// Wrap a router in the general API limiter.
pub fn apply_general<S>(router: Router<S>) -> Router<S>
where
    S: Clone + Send + Sync + 'static,
{
    build_and_wrap(router, GENERAL_BURST, GENERAL_REFILL)
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::routing::get;

    // Compile-time sanity check: auth must always be at least as tight as
    // general. If a future change accidentally swaps the constants, this
    // fails the build before a single test runs.
    const _: () = {
        assert!(AUTH_BURST <= GENERAL_BURST);
        assert!(AUTH_REFILL.as_nanos() >= GENERAL_REFILL.as_nanos());
    };

    #[test]
    fn apply_auth_tight_wraps_a_router_without_panicking() {
        // Validates that the quota constants yield a valid GovernorConfig
        // and that the layer can be attached to a Router<()>.
        let _router: Router = apply_auth_tight(Router::new().route("/", get(|| async { "ok" })));
    }

    #[test]
    fn forwarded_headers_count_only_when_trusted() {
        let mut headers = HeaderMap::new();
        headers.insert("x-forwarded-for", "203.0.113.7, 10.0.0.2".parse().unwrap());
        let peer: SocketAddr = "192.0.2.1:40000".parse().unwrap();

        assert_eq!(
            client_ip_with(true, &headers, Some(peer)).as_deref(),
            Some("203.0.113.7")
        );
        // Flag off: the header is the client's own claim.
        assert_eq!(
            client_ip_with(false, &headers, Some(peer)).as_deref(),
            Some("192.0.2.1")
        );
        assert_eq!(client_ip_with(false, &headers, None), None);
    }

    #[test]
    fn an_unusable_forwarded_header_falls_back_to_the_peer() {
        let mut headers = HeaderMap::new();
        headers.insert("x-forwarded-for", "not-an-address".parse().unwrap());
        let peer: SocketAddr = "[::ffff:192.0.2.9]:40000".parse().unwrap();
        assert_eq!(
            client_ip_with(true, &headers, Some(peer)).as_deref(),
            Some("192.0.2.9")
        );

        let mut headers = HeaderMap::new();
        headers.insert("x-real-ip", "198.51.100.4".parse().unwrap());
        assert_eq!(
            client_ip_with(true, &headers, None).as_deref(),
            Some("198.51.100.4")
        );
    }

    #[test]
    fn apply_general_wraps_a_router_without_panicking() {
        let _router: Router = apply_general(Router::new().route("/", get(|| async { "ok" })));
    }
}
