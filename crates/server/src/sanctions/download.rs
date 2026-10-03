//! Daily download of the EU consolidated financial sanctions list.
//!
//! Source: Financial Sanctions Files (FSF) of the European Commission. The
//! public download link of the "full sanctions list", XML format 1.1, carries
//! a fixed token that the Commission publishes in its RSS feed
//! (`webgate.ec.europa.eu/fsd/fsf/public/rss`); no EU Login is needed for it.
//! The list includes the EU transposition of the UN sanctions.
//!
//! Environment:
//! * `SANCTIONS_LIST_URL` overrides the download link (HTTPS only);
//! * `SANCTIONS_LIST_DOWNLOAD=false` switches the download off (environments
//!   without internet); the CEO then uploads the file in the admin settings.

use std::time::Duration;

use reqwest::header::{ACCEPT, CONTENT_LENGTH, CONTENT_TYPE};
use reqwest::{Client, StatusCode, redirect};

use super::fsf::MAX_XML_BYTES;
use super::store::{self, ImportOutcome, ImportSource};
use crate::state::AppState;

pub const DEFAULT_SOURCE_URL: &str = "https://webgate.ec.europa.eu/fsd/fsf/public/files/xmlFullSanctionsList_1_1/content?token=dG9rZW4tMjAxNw";
/// A download is attempted when the last success is older than this.
const DOWNLOAD_INTERVAL_HOURS: i64 = 20;
const CHECK_EVERY: Duration = Duration::from_secs(60 * 60);
const FIRST_CHECK_AFTER: Duration = Duration::from_secs(120);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(300);
/// Advisory lock so that only one server instance downloads at a time.
const DOWNLOAD_LOCK_KEY: i64 = 0x5341_4e43_5449_4f4e;

pub fn source_url() -> String {
    std::env::var("SANCTIONS_LIST_URL")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| value.starts_with("https://"))
        .unwrap_or_else(|| DEFAULT_SOURCE_URL.to_string())
}

pub fn automatic_download_enabled() -> bool {
    !matches!(
        std::env::var("SANCTIONS_LIST_DOWNLOAD")
            .unwrap_or_default()
            .trim()
            .to_ascii_lowercase()
            .as_str(),
        "false" | "0" | "off" | "no"
    )
}

#[derive(Debug, thiserror::Error)]
pub enum DownloadError {
    #[error("client configuration failed: {0}")]
    Client(reqwest::Error),
    #[error("request failed: {0}")]
    Http(reqwest::Error),
    #[error("source answered HTTP {0}")]
    Status(u16),
    #[error("unexpected content type {0}")]
    ContentType(String),
    #[error("file larger than the allowed size")]
    TooLarge,
}

impl DownloadError {
    pub fn public_code(&self) -> &'static str {
        match self {
            Self::Client(_) => "download_client",
            Self::Http(error) if error.is_timeout() => "download_timeout",
            Self::Http(_) => "download_failed",
            Self::Status(_) => "download_http_status",
            Self::ContentType(_) => "download_content_type",
            Self::TooLarge => "download_too_large",
        }
    }
}

/// Fetches the list file with size and type checks.
pub async fn fetch_list(url: &str) -> Result<Vec<u8>, DownloadError> {
    let client = Client::builder()
        .https_only(true)
        .redirect(redirect::Policy::limited(3))
        .connect_timeout(CONNECT_TIMEOUT)
        .timeout(DOWNLOAD_TIMEOUT)
        .user_agent("GMED-Sanctions-Screening/1.0")
        .build()
        .map_err(DownloadError::Client)?;
    let mut response = client
        .get(url)
        .header(ACCEPT, "application/xml, text/xml;q=0.9")
        .send()
        .await
        .map_err(DownloadError::Http)?;
    if response.status() != StatusCode::OK {
        return Err(DownloadError::Status(response.status().as_u16()));
    }
    if response
        .headers()
        .get(CONTENT_LENGTH)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<usize>().ok())
        .is_some_and(|length| length > MAX_XML_BYTES)
    {
        return Err(DownloadError::TooLarge);
    }
    let content_type = response
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default()
        .to_ascii_lowercase();
    if !(content_type.is_empty()
        || content_type.contains("xml")
        || content_type.starts_with("application/octet-stream"))
    {
        return Err(DownloadError::ContentType(content_type));
    }
    let mut bytes = Vec::with_capacity(32 * 1024 * 1024);
    while let Some(chunk) = response.chunk().await.map_err(DownloadError::Http)? {
        if bytes.len().saturating_add(chunk.len()) > MAX_XML_BYTES {
            return Err(DownloadError::TooLarge);
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}

/// Result of one scheduled or manual run.
#[derive(Debug)]
pub enum RunOutcome {
    Skipped,
    Imported(ImportOutcome),
    Failed(&'static str),
}

/// Downloads, imports and re-screens when the last success is old enough
/// (or always with `force`). A failure keeps the active version.
pub async fn run_once(state: &AppState, force: bool) -> Result<RunOutcome, sqlx::Error> {
    let mut lock_conn = state.db.acquire().await?;
    let locked: bool = sqlx::query_scalar("SELECT pg_try_advisory_lock($1)")
        .bind(DOWNLOAD_LOCK_KEY)
        .fetch_one(&mut *lock_conn)
        .await?;
    if !locked {
        return Ok(RunOutcome::Skipped);
    }
    let outcome = run_locked(state, force).await;
    let _ = sqlx::query("SELECT pg_advisory_unlock($1)")
        .bind(DOWNLOAD_LOCK_KEY)
        .execute(&mut *lock_conn)
        .await;
    outcome
}

async fn run_locked(state: &AppState, force: bool) -> Result<RunOutcome, sqlx::Error> {
    if !force {
        let due: bool = sqlx::query_scalar(
            r#"SELECT last_success_at IS NULL
                      OR last_success_at < now() - make_interval(hours => $1)
               FROM sanctions_list_sync_state WHERE id"#,
        )
        .bind(DOWNLOAD_INTERVAL_HOURS as i32)
        .fetch_optional(&state.db)
        .await?
        .unwrap_or(true);
        if !due {
            return Ok(RunOutcome::Skipped);
        }
    }
    store::record_attempt(&state.db).await?;
    let bytes = match fetch_list(&source_url()).await {
        Ok(bytes) => bytes,
        Err(error) => {
            tracing::warn!(error = %error, "EU sanctions list download failed; the active version stays");
            store::record_failure(&state.db, error.public_code()).await?;
            return Ok(RunOutcome::Failed(error.public_code()));
        }
    };
    match store::import_list(state, bytes, ImportSource::Download, None).await {
        Ok(outcome @ ImportOutcome::Unchanged { .. }) => {
            store::record_unchanged(&state.db).await?;
            Ok(RunOutcome::Imported(outcome))
        }
        Ok(outcome @ ImportOutcome::Imported { .. }) => {
            match super::screening::rescreen_all(state).await {
                Ok(report) => tracing::info!(
                    leads = report.leads,
                    patients = report.patients,
                    new_hits = report.new_hits,
                    errors = report.errors,
                    "Re-screened open subjects against the new EU sanctions list"
                ),
                Err(error) => {
                    tracing::error!(error = %error, "Re-screening after a new EU sanctions list failed")
                }
            }
            Ok(RunOutcome::Imported(outcome))
        }
        Err(error) => {
            tracing::warn!(error = %error, "EU sanctions list import failed; the active version stays");
            store::record_failure(&state.db, error.public_code()).await?;
            Ok(RunOutcome::Failed(error.public_code()))
        }
    }
}

/// Hourly check, a download at most every [`DOWNLOAD_INTERVAL_HOURS`].
pub fn spawn_list_scheduler(state: AppState) {
    if !automatic_download_enabled() {
        tracing::info!("EU sanctions list download is switched off (SANCTIONS_LIST_DOWNLOAD)");
        return;
    }
    tokio::spawn(async move {
        tokio::time::sleep(FIRST_CHECK_AFTER).await;
        let mut ticker = tokio::time::interval(CHECK_EVERY);
        ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            ticker.tick().await;
            match run_once(&state, false).await {
                Ok(RunOutcome::Imported(ImportOutcome::Imported {
                    list_date, entries, ..
                })) => tracing::info!(%list_date, entries, "EU sanctions list updated"),
                Ok(_) => {}
                Err(error) => {
                    tracing::error!(error = %error, "EU sanctions list scheduler failed")
                }
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_default_source_is_the_public_fsf_xml_1_1_link() {
        assert!(
            DEFAULT_SOURCE_URL.starts_with("https://webgate.ec.europa.eu/fsd/fsf/public/files/")
        );
        assert!(DEFAULT_SOURCE_URL.contains("xmlFullSanctionsList_1_1"));
    }
}
