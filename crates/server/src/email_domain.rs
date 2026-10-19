//! Whether the domain of an e-mail address accepts mail (owner request
//! 2026-10-19: a well-formed address can still be undeliverable).
//!
//! The domain is looked up in DNS: an MX record means it accepts mail; no MX
//! but an A/AAAA record also does (RFC 5321 implicit MX). A domain that does
//! not exist, has neither record, or publishes a "null MX" (RFC 7505, `.`)
//! does not. When DNS does not answer in time the result is `Unknown`, and
//! nothing is refused for it: the address is saved and checked again the next
//! time anyone looks at it (`GET /email-check`, sending a mail).
//!
//! Results are kept in memory per domain, so `gmail.com` is asked once a day.
//! The check is off until `enable()` runs at server start, which keeps the
//! test suites (reserved `example.test` domains) offline.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use hickory_resolver::TokioResolver;
use hickory_resolver::proto::rr::RData;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DomainStatus {
    AcceptsMail,
    NoMail,
    /// DNS did not answer (in time), or the check is off.
    Unknown,
}

impl DomainStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::AcceptsMail => "accepts_mail",
            Self::NoMail => "no_mail",
            Self::Unknown => "unknown",
        }
    }

    fn ttl(self) -> Duration {
        match self {
            Self::AcceptsMail => Duration::from_secs(24 * 3_600),
            Self::NoMail => Duration::from_secs(3_600),
            Self::Unknown => Duration::from_secs(120),
        }
    }
}

const LOOKUP_TIMEOUT: Duration = Duration::from_secs(3);
const MAX_CACHED_DOMAINS: usize = 50_000;

static ENABLED: AtomicBool = AtomicBool::new(false);
static RESOLVER: OnceLock<Option<TokioResolver>> = OnceLock::new();
static CACHE: OnceLock<Mutex<HashMap<String, (DomainStatus, Instant)>>> = OnceLock::new();

/// Turns the check on; called once at server start.
pub fn enable() {
    ENABLED.store(true, Ordering::Relaxed);
}

fn enabled() -> bool {
    ENABLED.load(Ordering::Relaxed)
}

fn cache() -> &'static Mutex<HashMap<String, (DomainStatus, Instant)>> {
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn resolver() -> Option<&'static TokioResolver> {
    RESOLVER
        .get_or_init(|| match TokioResolver::builder_tokio() {
            Ok(mut builder) => {
                let options = builder.options_mut();
                options.timeout = LOOKUP_TIMEOUT;
                options.attempts = 1;
                Some(builder.build())
            }
            Err(error) => {
                tracing::warn!(%error, "e-mail domain check: no system resolver configuration");
                None
            }
        })
        .as_ref()
}

/// Lower-cased domain of `email` (text after the last `@`).
pub fn domain_of(email: &str) -> Option<String> {
    let (_, domain) = email.trim().rsplit_once('@')?;
    (!domain.is_empty()).then(|| domain.trim_end_matches('.').to_ascii_lowercase())
}

fn cached(domain: &str) -> Option<DomainStatus> {
    let cache = cache().lock().ok()?;
    let (status, checked_at) = cache.get(domain)?;
    (checked_at.elapsed() < status.ttl()).then_some(*status)
}

fn remember(domain: &str, status: DomainStatus) {
    if let Ok(mut cache) = cache().lock() {
        if cache.len() >= MAX_CACHED_DOMAINS {
            cache.retain(|_, (status, checked_at)| checked_at.elapsed() < status.ttl());
            if cache.len() >= MAX_CACHED_DOMAINS {
                cache.clear();
            }
        }
        cache.insert(domain.to_string(), (status, Instant::now()));
    }
}

/// Whether a recent lookup found that `domain` accepts no mail. Never waits
/// for DNS; an unknown domain is looked up in the background so the next
/// question has the answer.
pub fn known_no_mail(domain: &str) -> bool {
    if !enabled() {
        return false;
    }
    match cached(domain) {
        Some(status) => status == DomainStatus::NoMail,
        None => {
            if let Ok(runtime) = tokio::runtime::Handle::try_current() {
                let domain = domain.to_string();
                runtime.spawn(async move {
                    check_domain(&domain).await;
                });
            }
            false
        }
    }
}

/// Status of the domain of `email`, asking DNS when no recent answer is known.
pub async fn check_email(email: &str) -> DomainStatus {
    match domain_of(email) {
        Some(domain) => check_domain(&domain).await,
        None => DomainStatus::NoMail,
    }
}

/// Status of `domain`, asking DNS when no recent answer is known.
pub async fn check_domain(domain: &str) -> DomainStatus {
    if !enabled() {
        return DomainStatus::Unknown;
    }
    if let Some(status) = cached(domain) {
        return status;
    }
    let status = lookup(domain).await;
    if status == DomainStatus::Unknown {
        tracing::info!(domain, "e-mail domain check: DNS gave no answer");
    }
    remember(domain, status);
    status
}

async fn lookup(domain: &str) -> DomainStatus {
    let Some(resolver) = resolver() else {
        return DomainStatus::Unknown;
    };
    // A fully qualified name, so the resolver's search domains are not tried.
    let name = format!("{domain}.");
    match tokio::time::timeout(LOOKUP_TIMEOUT * 2, resolver.mx_lookup(name.as_str())).await {
        Err(_) => DomainStatus::Unknown,
        Ok(Ok(mx)) => {
            let exchanges: Vec<String> = mx
                .as_lookup()
                .record_iter()
                .filter_map(|record| match record.data() {
                    RData::MX(mx) => Some(mx.exchange().to_ascii()),
                    _ => None,
                })
                .collect();
            mx_status(&exchanges)
        }
        Ok(Err(error)) if error.is_nx_domain() => DomainStatus::NoMail,
        Ok(Err(error)) if error.is_no_records_found() => {
            match tokio::time::timeout(LOOKUP_TIMEOUT * 2, resolver.lookup_ip(name.as_str())).await
            {
                Err(_) => DomainStatus::Unknown,
                Ok(Ok(ips)) if ips.iter().next().is_some() => DomainStatus::AcceptsMail,
                Ok(Ok(_)) => DomainStatus::NoMail,
                Ok(Err(error)) if error.is_nx_domain() || error.is_no_records_found() => {
                    DomainStatus::NoMail
                }
                Ok(Err(_)) => DomainStatus::Unknown,
            }
        }
        Ok(Err(_)) => DomainStatus::Unknown,
    }
}

/// MX answer → status: only a null MX (`.`, RFC 7505) means no mail.
fn mx_status(exchanges: &[String]) -> DomainStatus {
    if exchanges.is_empty() {
        return DomainStatus::Unknown;
    }
    if exchanges
        .iter()
        .all(|exchange| exchange.trim_end_matches('.').is_empty())
    {
        DomainStatus::NoMail
    } else {
        DomainStatus::AcceptsMail
    }
}

#[cfg(test)]
mod tests {
    use super::{DomainStatus, domain_of, known_no_mail, mx_status};

    #[test]
    fn domain_is_lower_cased_text_after_the_at() {
        assert_eq!(domain_of(" Max@Example.DE "), Some("example.de".into()));
        assert_eq!(domain_of("max@example.de."), Some("example.de".into()));
        assert_eq!(domain_of("max"), None);
        assert_eq!(domain_of("max@"), None);
    }

    #[test]
    fn null_mx_means_no_mail() {
        assert_eq!(mx_status(&[".".into()]), DomainStatus::NoMail);
        assert_eq!(
            mx_status(&["mx1.example.de.".into(), ".".into()]),
            DomainStatus::AcceptsMail
        );
        assert_eq!(mx_status(&[]), DomainStatus::Unknown);
    }

    #[test]
    fn nothing_is_refused_while_the_check_is_off() {
        assert!(!known_no_mail("example.test"));
    }

    /// Needs outside DNS: `cargo test -p gmed-server --lib live_dns -- --ignored`.
    #[tokio::test]
    #[ignore]
    async fn live_dns_answers() {
        super::enable();
        assert_eq!(
            super::check_domain("gmail.com").await,
            DomainStatus::AcceptsMail
        );
        // A typing mistake in the top-level domain.
        assert_eq!(super::check_domain("gmial.con").await, DomainStatus::NoMail);
        assert_eq!(
            super::check_domain("no-such-domain-gmed-4f1c2a.de").await,
            DomainStatus::NoMail
        );
        assert!(super::known_no_mail("no-such-domain-gmed-4f1c2a.de"));
    }
}
