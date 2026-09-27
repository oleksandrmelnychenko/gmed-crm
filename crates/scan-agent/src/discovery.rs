//! Find eSCL scanners on the local network through Bonjour / mDNS
//! (`_uscan._tcp` for HTTP, `_uscans._tcp` for HTTPS).

use std::collections::BTreeMap;
use std::time::{Duration, Instant};

use anyhow::{Context, Result};
use mdns_sd::{ServiceDaemon, ServiceEvent};

const SERVICE_TYPES: [(&str, &str); 2] = [
    ("_uscans._tcp.local.", "https"),
    ("_uscan._tcp.local.", "http"),
];

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FoundScanner {
    pub name: String,
    pub model: Option<String>,
    /// eSCL root URLs, HTTPS first, e.g. `https://192.168.1.20:443/eSCL/`.
    pub urls: Vec<String>,
}

/// Browse for `timeout` and return every scanner that answered, one entry
/// per device.
pub fn discover(timeout: Duration) -> Result<Vec<FoundScanner>> {
    let daemon = ServiceDaemon::new().context("start mDNS discovery")?;
    let receivers = SERVICE_TYPES
        .iter()
        .map(|(service, scheme)| -> Result<_> {
            Ok((
                daemon.browse(service).context("browse for scanners")?,
                *scheme,
            ))
        })
        .collect::<Result<Vec<_>>>()?;
    let deadline = Instant::now() + timeout;
    let mut found: BTreeMap<String, FoundScanner> = BTreeMap::new();
    while Instant::now() < deadline {
        for (receiver, scheme) in &receivers {
            while let Ok(event) = receiver.recv_timeout(Duration::from_millis(50)) {
                let ServiceEvent::ServiceResolved(service) = event else {
                    continue;
                };
                let host = service
                    .get_addresses_v4()
                    .into_iter()
                    .min()
                    .map(|address| address.to_string())
                    .unwrap_or_else(|| service.get_hostname().trim_end_matches('.').to_string());
                if host.is_empty() {
                    continue;
                }
                let resource = service
                    .get_property_val_str("rs")
                    .map(|value| value.trim_matches('/').to_string())
                    .filter(|value| !value.is_empty())
                    .unwrap_or_else(|| "eSCL".to_string());
                let name = service
                    .get_fullname()
                    .split("._uscan")
                    .next()
                    .unwrap_or_default()
                    .replace("\\032", " ");
                // One device announces both services; the UUID ties them.
                let key = service
                    .get_property_val_str("UUID")
                    .map(str::to_ascii_lowercase)
                    .unwrap_or_else(|| name.clone());
                let url = format!("{scheme}://{host}:{}/{resource}/", service.get_port());
                let entry = found.entry(key).or_insert_with(|| FoundScanner {
                    name,
                    model: None,
                    urls: Vec::new(),
                });
                if entry.model.is_none() {
                    entry.model = service.get_property_val_str("ty").map(str::to_string);
                }
                if !entry.urls.contains(&url) {
                    entry.urls.push(url);
                    entry.urls.sort_by_key(|url| !url.starts_with("https:"));
                }
            }
        }
    }
    let _ = daemon.shutdown();
    Ok(found.into_values().collect())
}
