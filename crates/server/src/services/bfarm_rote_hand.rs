use std::collections::HashSet;
use std::io::Cursor;
use std::time::Duration;

use chrono::{DateTime, Utc};
use reqwest::header::{ACCEPT, CONTENT_LENGTH, CONTENT_TYPE};
use reqwest::{Client, StatusCode, Url, redirect};
use rss::Channel;
use serde_json::json;
use sha2::{Digest, Sha256};
use unicode_normalization::UnicodeNormalization;
use uuid::Uuid;

use crate::state::AppState;

use super::medication_intelligence_sources::{
    ClaimedIngestionJob, CompleteAttemptResult, SafetyAlertItemInput, SourceIngestionError,
    StoredSourcePayloadInput, SuccessfulSnapshotInput, claim_ingestion_job,
    enqueue_source_ingestion, record_bfarm_ingestion_success, record_ingestion_failure,
};

pub const BFARM_ROTE_HAND_SOURCE_ID: &str = "bfarm_rote_hand";
pub const BFARM_ROTE_HAND_RSS_URL: &str = "https://www.bfarm.de/SiteGlobals/Functions/RSSFeed/DE/Pharmakovigilanz/Rote-Hand-Briefe/RSSNewsfeed.xml?nn=591002";

const BFARM_ITEM_URL_PREFIX: &str =
    "https://www.bfarm.de/SharedDocs/Risikoinformationen/Pharmakovigilanz/DE/RHB/";
const FETCH_TIMEOUT: Duration = Duration::from_secs(15);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(5);
const MAX_RSS_BYTES: usize = 256 * 1024;
const SCHEDULER_POLL_SECONDS: u64 = 60;

#[derive(Debug, Clone)]
pub struct ParsedBfarmFeed {
    pub alerts: Vec<SafetyAlertItemInput>,
    pub published_at: Option<DateTime<Utc>>,
    pub version: Option<String>,
    pub copyright_present: bool,
}

#[derive(Debug, Clone)]
pub struct FetchedBfarmFeed {
    pub fetched_at: DateTime<Utc>,
    pub content_type: String,
    pub bytes: Vec<u8>,
}

#[derive(Debug, Clone)]
pub enum BfarmRunOutcome {
    NotClaimed,
    Completed(CompleteAttemptResult),
    FailureRecorded {
        job_id: Uuid,
        error_code: &'static str,
    },
}

#[derive(Debug, thiserror::Error)]
pub enum BfarmConnectorError {
    #[error(transparent)]
    Source(#[from] SourceIngestionError),
    #[error("failed to construct bounded official-source client: {0}")]
    ClientBuild(reqwest::Error),
    #[error("official-source request failed: {0}")]
    Http(reqwest::Error),
    #[error("official source returned HTTP {0}")]
    UnexpectedStatus(u16),
    #[error("official source returned unsupported content type: {0}")]
    UnsupportedContentType(String),
    #[error("official-source payload exceeds 262144 bytes")]
    PayloadTooLarge,
    #[error("official-source RSS is invalid: {0}")]
    InvalidFeed(String),
}

impl BfarmConnectorError {
    fn public_code(&self) -> &'static str {
        match self {
            Self::ClientBuild(_) => "client_configuration_failed",
            Self::Http(error) if error.is_timeout() => "upstream_timeout",
            Self::Http(_) => "upstream_request_failed",
            Self::UnexpectedStatus(_) => "upstream_http_status",
            Self::UnsupportedContentType(_) => "unexpected_content_type",
            Self::PayloadTooLarge => "payload_too_large",
            Self::InvalidFeed(_) => "invalid_feed",
            Self::Source(_) => "snapshot_persistence_failed",
        }
    }
}

/// Starts the fixed BfArM connector outside all request paths. The first tick
/// is immediate; subsequent worker polls are one minute, while an hourly
/// database idempotency key limits successful upstream fetches to one per
/// hour. The shorter poll lets a new process reclaim an expired ten-minute
/// lease after a crash. A targeted claim ensures only one instance performs
/// I/O.
pub fn spawn_bfarm_rote_hand_scheduler(state: AppState) {
    let worker_id = format!("bfarm-rote-hand-{}", Uuid::new_v4().simple());
    tokio::spawn(async move {
        let mut ticker = tokio::time::interval(Duration::from_secs(SCHEDULER_POLL_SECONDS));
        ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

        loop {
            ticker.tick().await;
            match run_bfarm_rote_hand_once(&state, &worker_id).await {
                Ok(BfarmRunOutcome::NotClaimed) => {}
                Ok(BfarmRunOutcome::Completed(result)) => tracing::info!(
                    snapshot_id = %result.snapshot_id,
                    job_status = %result.job_status,
                    duplicate_snapshot = result.duplicate_snapshot,
                    "BfArM Rote-Hand RSS ingestion completed"
                ),
                Ok(BfarmRunOutcome::FailureRecorded { job_id, error_code }) => tracing::warn!(
                    job_id = %job_id,
                    error_code,
                    "BfArM Rote-Hand RSS ingestion failed; public error code recorded"
                ),
                Err(error) => tracing::error!(
                    error = %error,
                    "BfArM Rote-Hand RSS scheduler could not record its attempt"
                ),
            }
        }
    });
}

pub async fn run_bfarm_rote_hand_once(
    state: &AppState,
    worker_id: &str,
) -> Result<BfarmRunOutcome, BfarmConnectorError> {
    let now = Utc::now();
    let idempotency_key = format!("bfarm-rss-hour-{}", now.format("%Y%m%d%H"));
    let enqueued = enqueue_source_ingestion(
        &state.db,
        BFARM_ROTE_HAND_SOURCE_ID,
        &idempotency_key,
        None,
        json!({"trigger":"scheduled","schedule":"hourly"}),
    )
    .await?;
    let Some(job) = claim_ingestion_job(&state.db, enqueued.job_id, worker_id).await? else {
        return Ok(BfarmRunOutcome::NotClaimed);
    };

    let attempted_at = Utc::now();
    let attempted = async {
        validate_claimed_job(&job)?;
        let fetched = fetch_bfarm_feed().await?;
        complete_bfarm_job_from_payload(
            &state.db,
            job.id,
            fetched.fetched_at,
            fetched.content_type,
            fetched.bytes,
        )
        .await
    }
    .await;

    match attempted {
        Ok(result) => Ok(BfarmRunOutcome::Completed(result)),
        Err(error) => {
            let error_code = error.public_code();
            let internal_error = bounded_internal_error(&error.to_string());
            record_ingestion_failure(
                &state.db,
                job.id,
                attempted_at,
                Some(error_code),
                &internal_error,
                json!({"connector":"bfarm_rote_hand_rss"}),
            )
            .await?;
            Ok(BfarmRunOutcome::FailureRecorded {
                job_id: job.id,
                error_code,
            })
        }
    }
}

fn bounded_internal_error(value: &str) -> String {
    const MAX_ERROR_BYTES: usize = 4_000;
    if value.len() <= MAX_ERROR_BYTES {
        return value.to_string();
    }
    let mut boundary = MAX_ERROR_BYTES;
    while !value.is_char_boundary(boundary) {
        boundary -= 1;
    }
    value[..boundary].to_string()
}

fn validate_claimed_job(job: &ClaimedIngestionJob) -> Result<(), BfarmConnectorError> {
    if job.source_id != BFARM_ROTE_HAND_SOURCE_ID || job.source_url != BFARM_ROTE_HAND_RSS_URL {
        return Err(BfarmConnectorError::InvalidFeed(
            "claimed source does not match the compiled BfArM allowlist".to_string(),
        ));
    }
    Ok(())
}

async fn fetch_bfarm_feed() -> Result<FetchedBfarmFeed, BfarmConnectorError> {
    let client = Client::builder()
        .https_only(true)
        .redirect(redirect::Policy::none())
        .connect_timeout(CONNECT_TIMEOUT)
        .timeout(FETCH_TIMEOUT)
        .user_agent("GMED-Medication-Intelligence/1.0")
        .build()
        .map_err(BfarmConnectorError::ClientBuild)?;
    let mut response = client
        .get(BFARM_ROTE_HAND_RSS_URL)
        .header(
            ACCEPT,
            "application/rss+xml, application/xml;q=0.9, text/xml;q=0.8",
        )
        .send()
        .await
        .map_err(BfarmConnectorError::Http)?;

    if response.status() != StatusCode::OK {
        return Err(BfarmConnectorError::UnexpectedStatus(
            response.status().as_u16(),
        ));
    }
    if response
        .headers()
        .get(CONTENT_LENGTH)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<usize>().ok())
        .is_some_and(|length| length > MAX_RSS_BYTES)
    {
        return Err(BfarmConnectorError::PayloadTooLarge);
    }
    let content_type = response
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default()
        .to_string();
    if !is_supported_xml_content_type(&content_type) {
        return Err(BfarmConnectorError::UnsupportedContentType(content_type));
    }

    let mut bytes = Vec::with_capacity(16 * 1024);
    while let Some(chunk) = response.chunk().await.map_err(BfarmConnectorError::Http)? {
        if bytes.len().saturating_add(chunk.len()) > MAX_RSS_BYTES {
            return Err(BfarmConnectorError::PayloadTooLarge);
        }
        bytes.extend_from_slice(&chunk);
    }
    if bytes.is_empty() {
        return Err(BfarmConnectorError::InvalidFeed(
            "empty RSS payload".to_string(),
        ));
    }

    Ok(FetchedBfarmFeed {
        fetched_at: Utc::now(),
        content_type,
        bytes,
    })
}

fn is_supported_xml_content_type(value: &str) -> bool {
    matches!(
        value
            .split(';')
            .next()
            .unwrap_or_default()
            .trim()
            .to_ascii_lowercase()
            .as_str(),
        "text/xml" | "application/xml" | "application/rss+xml"
    )
}

pub async fn complete_bfarm_job_from_payload(
    pool: &sqlx::PgPool,
    job_id: Uuid,
    fetched_at: DateTime<Utc>,
    content_type: String,
    bytes: Vec<u8>,
) -> Result<CompleteAttemptResult, BfarmConnectorError> {
    if bytes.is_empty() || bytes.len() > MAX_RSS_BYTES {
        return Err(if bytes.is_empty() {
            BfarmConnectorError::InvalidFeed("empty RSS payload".to_string())
        } else {
            BfarmConnectorError::PayloadTooLarge
        });
    }
    if !is_supported_xml_content_type(&content_type) {
        return Err(BfarmConnectorError::UnsupportedContentType(content_type));
    }
    let parsed = parse_bfarm_rss(&bytes)?;
    let checksum_sha256 = hex::encode(Sha256::digest(&bytes));
    let byte_length =
        i64::try_from(bytes.len()).map_err(|_| BfarmConnectorError::PayloadTooLarge)?;
    let item_count = i64::try_from(parsed.alerts.len())
        .map_err(|_| BfarmConnectorError::InvalidFeed("too many RSS items".to_string()))?;

    record_bfarm_ingestion_success(
        pool,
        job_id,
        SuccessfulSnapshotInput {
            fetched_at,
            published_at: parsed.published_at,
            source_url: BFARM_ROTE_HAND_RSS_URL.to_string(),
            checksum_sha256,
            version: parsed.version,
            item_count: Some(item_count),
            content_type: Some(content_type.clone()),
            byte_length,
            payload_storage_key: Some(
                "database:medication_intelligence_source_payloads".to_string(),
            ),
            metadata: json!({
                "format":"rss_2_0",
                "copyright_notice_present":parsed.copyright_present,
                "normalized_fields":["title","publication_date","official_link","explicit_substances"]
            }),
        },
        StoredSourcePayloadInput {
            content_type,
            bytes,
        },
        parsed.alerts,
    )
    .await
    .map_err(BfarmConnectorError::Source)
}

pub fn parse_bfarm_rss(bytes: &[u8]) -> Result<ParsedBfarmFeed, BfarmConnectorError> {
    let channel = Channel::read_from(Cursor::new(bytes))
        .map_err(|error| BfarmConnectorError::InvalidFeed(error.to_string()))?;
    let channel_is_official = Url::parse(channel.link().trim())
        .ok()
        .is_some_and(|url| url.scheme() == "https" && url.host_str() == Some("www.bfarm.de"));
    let channel_title = channel.title().trim();
    if !channel_title.contains("BfArM")
        || !channel_title.contains("Rote-Hand")
        || !channel_is_official
    {
        return Err(BfarmConnectorError::InvalidFeed(
            "channel identity is not BfArM".to_string(),
        ));
    }

    let mut alerts = Vec::with_capacity(channel.items().len());
    let mut ids = HashSet::with_capacity(channel.items().len());
    let mut latest_publication = None;
    for item in channel.items() {
        let title = item
            .title()
            .map(str::trim)
            .filter(|value| !value.is_empty() && value.len() <= 1_000)
            .ok_or_else(|| {
                BfarmConnectorError::InvalidFeed("RSS item has no usable title".to_string())
            })?
            .to_string();
        let official_url = canonical_bfarm_item_url(item.link().unwrap_or_default())?;
        let alert_id = stable_alert_id(&official_url);
        if !ids.insert(alert_id.clone()) {
            return Err(BfarmConnectorError::InvalidFeed(
                "RSS contains a duplicate official item link".to_string(),
            ));
        }
        let published_at = item
            .pub_date()
            .map(|value| {
                DateTime::parse_from_rfc2822(value)
                    .map(|value| value.with_timezone(&Utc))
                    .map_err(|_| {
                        BfarmConnectorError::InvalidFeed(
                            "RSS item has an invalid pubDate".to_string(),
                        )
                    })
            })
            .transpose()?;
        if published_at.as_ref() > latest_publication.as_ref() {
            latest_publication = published_at.to_owned();
        }
        let (explicit_substance_labels, explicit_substance_keys) =
            extract_explicit_substances(&title);
        let item_checksum_sha256 = stable_item_checksum(
            &title,
            &official_url,
            published_at.as_ref(),
            &explicit_substance_keys,
        );
        alerts.push(SafetyAlertItemInput {
            alert_id,
            official_title: title,
            official_url,
            published_at,
            explicit_substance_labels,
            explicit_substance_keys,
            item_checksum_sha256,
        });
    }
    if alerts.is_empty() {
        return Err(BfarmConnectorError::InvalidFeed(
            "RSS contains no items".to_string(),
        ));
    }
    let version = latest_publication
        .as_ref()
        .map(|value| format!("rss-{}", value.to_rfc3339()));

    Ok(ParsedBfarmFeed {
        alerts,
        published_at: latest_publication,
        version,
        copyright_present: channel
            .copyright()
            .is_some_and(|value| !value.trim().is_empty()),
    })
}

fn canonical_bfarm_item_url(value: &str) -> Result<String, BfarmConnectorError> {
    let mut url = Url::parse(value.trim()).map_err(|_| {
        BfarmConnectorError::InvalidFeed("RSS item link is not a valid URL".to_string())
    })?;
    if url.scheme() != "https"
        || url.host_str() != Some("www.bfarm.de")
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port().is_some()
        || !url.as_str().starts_with(BFARM_ITEM_URL_PREFIX)
    {
        return Err(BfarmConnectorError::InvalidFeed(
            "RSS item link is outside the BfArM allowlist".to_string(),
        ));
    }
    url.set_fragment(None);
    Ok(url.to_string())
}

fn stable_alert_id(official_url: &str) -> String {
    let digest = hex::encode(Sha256::digest(official_url.as_bytes()));
    format!("bfarm-rhb-{}", &digest[..24])
}

fn stable_item_checksum(
    title: &str,
    official_url: &str,
    published_at: Option<&DateTime<Utc>>,
    substance_keys: &[String],
) -> String {
    let mut digest = Sha256::new();
    digest.update(title.as_bytes());
    digest.update([0]);
    digest.update(official_url.as_bytes());
    digest.update([0]);
    if let Some(value) = published_at {
        digest.update(value.to_rfc3339().as_bytes());
    }
    for key in substance_keys {
        digest.update([0]);
        digest.update(key.as_bytes());
    }
    hex::encode(digest.finalize())
}

/// Extracts only two syntactically explicit forms present in official BfArM
/// titles: a parenthetical Wirkstoff after the product name, or an
/// "…haltigen Arzneimitteln" ingredient list. Product-name inference,
/// descriptions and fuzzy matching are deliberately excluded.
fn extract_explicit_substances(title: &str) -> (Vec<String>, Vec<String>) {
    let Some(subject) = title
        .strip_prefix("Rote-Hand-Brief zu ")
        .or_else(|| title.strip_prefix("Informationsbrief zu "))
        .or_else(|| title.strip_prefix("Aktualisierung des Rote-Hand-Brief zu "))
        .and_then(|value| value.split(':').next())
        .map(str::trim)
    else {
        return (Vec::new(), Vec::new());
    };

    let explicit = parenthetical_value(subject).or_else(|| ingredient_suffix_value(subject));
    let Some(explicit) = explicit else {
        return (Vec::new(), Vec::new());
    };
    let mut labels = Vec::new();
    let mut keys = Vec::new();
    let mut seen = HashSet::new();
    let split_ready = explicit
        .replace("- und ", ",")
        .replace(" und ", ",")
        .replace(" sowie ", ",")
        .replace('/', ",");
    for raw in split_ready.split(',') {
        let label = raw
            .trim()
            .trim_matches(|character: char| {
                character.is_whitespace() || matches!(character, '-' | ';' | '.')
            })
            .to_string();
        let Some(key) = normalize_substance_key(&label) else {
            continue;
        };
        if label.len() > 120
            || key.split_whitespace().count() > 8
            || contains_dosage_unit(&key)
            || !seen.insert(key.clone())
        {
            continue;
        }
        labels.push(label);
        keys.push(key);
    }
    (labels, keys)
}

fn parenthetical_value(subject: &str) -> Option<&str> {
    let start = subject.rfind('(')?;
    let end = subject[start + 1..].find(')')? + start + 1;
    (end == subject.len() - 1).then(|| subject[start + 1..end].trim())
}

fn ingredient_suffix_value(subject: &str) -> Option<&str> {
    let lower = subject.to_lowercase();
    let marker = "haltigen arzneimitteln";
    let marker_start = lower.find(marker)?;
    let before = subject[..marker_start].trim();
    (!before.is_empty()).then_some(before)
}

fn contains_dosage_unit(key: &str) -> bool {
    key.split_whitespace().any(|part| {
        matches!(
            part,
            "mg" | "ml" | "mikrogramm" | "gramm" | "prozent" | "injektion" | "infusion"
        )
    })
}

pub fn normalize_substance_key(value: &str) -> Option<String> {
    let normalized = value
        .nfkc()
        .flat_map(char::to_lowercase)
        .map(|character| {
            if character.is_alphanumeric() {
                character
            } else {
                ' '
            }
        })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    (!normalized.is_empty()).then_some(normalized)
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = r#"<?xml version="1.0"?>
<rss version="2.0"><channel>
<title>BfArM RSS-Feed: Rote-Hand- und Informationsbriefe</title>
<link>https://www.bfarm.de</link><description>Official feed</description>
<copyright>Copyright by BfArM</copyright>
<item><title>Rote-Hand-Brief zu Litfulo (Ritlecitinib): Risikohinweis</title>
<link>https://www.bfarm.de/SharedDocs/Risikoinformationen/Pharmakovigilanz/DE/RHB/2026/rhb-litfulo.html</link>
<pubDate>Mon, 10 Aug 2026 12:32:00 +0200</pubDate><description>Not persisted</description></item>
<item><title>Rote-Hand-Brief zu desogestrel- und etonogestrelhaltigen Arzneimitteln: Risikohinweis</title>
<link>https://www.bfarm.de/SharedDocs/Risikoinformationen/Pharmakovigilanz/DE/RHB/2026/rhb-two.html</link>
<pubDate>Thu, 6 Aug 2026 14:50:00 +0200</pubDate><description>Not persisted either</description></item>
<item><title>Rote-Hand-Brief zu Keppra: Kein expliziter Wirkstoff im Titel</title>
<link>https://www.bfarm.de/SharedDocs/Risikoinformationen/Pharmakovigilanz/DE/RHB/2026/rhb-no-substance.html</link>
<pubDate>Wed, 5 Aug 2026 10:00:00 +0200</pubDate></item>
</channel></rss>"#;

    #[test]
    fn parses_minimal_provenance_and_only_explicit_substances() {
        let parsed = parse_bfarm_rss(SAMPLE.as_bytes()).expect("valid sample");
        assert_eq!(parsed.alerts.len(), 3);
        assert!(parsed.copyright_present);
        assert_eq!(parsed.alerts[0].explicit_substance_keys, ["ritlecitinib"]);
        assert_eq!(
            parsed.alerts[1].explicit_substance_keys,
            ["desogestrel", "etonogestrel"]
        );
        assert!(parsed.alerts[2].explicit_substance_keys.is_empty());
        assert!(parsed.alerts.iter().all(|item| {
            !item.official_title.contains("Not persisted")
                && item.alert_id.starts_with("bfarm-rhb-")
        }));
    }

    #[test]
    fn stable_ids_ignore_snapshot_time_and_off_allowlist_links_fail_closed() {
        let first = parse_bfarm_rss(SAMPLE.as_bytes()).unwrap();
        let second = parse_bfarm_rss(SAMPLE.as_bytes()).unwrap();
        assert_eq!(first.alerts[0].alert_id, second.alerts[0].alert_id);

        let malicious = SAMPLE.replace(
            "https://www.bfarm.de/SharedDocs/Risikoinformationen/Pharmakovigilanz/DE/RHB/2026/rhb-litfulo.html",
            "https://attacker.invalid/feed",
        );
        assert!(parse_bfarm_rss(malicious.as_bytes()).is_err());
    }

    #[test]
    fn content_type_and_payload_bounds_are_strict() {
        assert!(is_supported_xml_content_type("text/xml;charset=utf-8"));
        assert!(is_supported_xml_content_type("application/rss+xml"));
        assert!(!is_supported_xml_content_type("text/html"));
        assert!(!is_supported_xml_content_type("application/json"));
    }

    #[test]
    fn matching_key_normalization_is_exact_and_unicode_aware() {
        assert_eq!(
            normalize_substance_key(" Levothyroxin-Natrium ").as_deref(),
            Some("levothyroxin natrium")
        );
        assert_ne!(
            normalize_substance_key("Levothyroxin-Natrium"),
            normalize_substance_key("Levothyroxin")
        );
        let (_, combination) = extract_explicit_substances(
            "Rote-Hand-Brief zu Mysimba (Naltrexon/Bupropion): Risikohinweis",
        );
        assert_eq!(combination, ["naltrexon", "bupropion"]);
    }
}
