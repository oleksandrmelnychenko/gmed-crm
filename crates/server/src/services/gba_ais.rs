use std::collections::{BTreeMap, BTreeSet, HashSet};
use std::time::Duration;

use chrono::{DateTime, NaiveDate, Timelike, Utc};
use quick_xml::Reader;
use quick_xml::escape::resolve_xml_entity;
use quick_xml::events::{BytesRef, BytesStart, Event};
use reqwest::header::{ACCEPT, CONTENT_LENGTH, CONTENT_TYPE};
use reqwest::{Client, StatusCode, Url, redirect};
use secrecy::{ExposeSecret, SecretString};
use serde_json::json;
use sha2::{Digest, Sha256};
use sqlx::PgPool;
use uuid::Uuid;

use crate::state::AppState;

use super::medication_intelligence_sources::{
    BenefitAssessmentItemInput, ClaimedIngestionJob, CompleteAttemptResult, SourceIngestionError,
    StoredSourcePayloadInput, SuccessfulSnapshotInput, claim_ingestion_job,
    enqueue_source_ingestion, record_gba_ais_ingestion_success, record_ingestion_failure,
};

pub const GBA_AIS_SOURCE_ID: &str = "gba_ais_xml";
pub const GBA_AIS_PUBLIC_URL: &str = "https://www.g-ba.de/themen/arzneimittel/arzneimittel-richtlinie-anlagen/nutzenbewertung-35a/ais/";

const GBA_AIS_DOWNLOAD_HOST: &str = "ais.g-ba.de";
const FETCH_TIMEOUT: Duration = Duration::from_secs(90);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
const MAX_XML_BYTES: usize = 64 * 1024 * 1024;
const MAX_XML_EVENTS: usize = 2_000_000;
const MAX_XML_DEPTH: usize = 64;
const MAX_ASSESSMENT_ITEMS: usize = 100_000;
const SCHEDULER_POLL_SECONDS: u64 = 300;

#[derive(Debug, Clone)]
pub struct ParsedGbaAisDelivery {
    pub items: Vec<BenefitAssessmentItemInput>,
    pub published_at: DateTime<Utc>,
    pub version: String,
}

#[derive(Debug, Clone)]
pub struct FetchedGbaAisDelivery {
    pub fetched_at: DateTime<Utc>,
    pub content_type: String,
    pub bytes: Vec<u8>,
}

#[derive(Debug, Clone)]
pub enum GbaAisRunOutcome {
    NotClaimed,
    Completed(CompleteAttemptResult),
    FailureRecorded {
        job_id: Uuid,
        error_code: &'static str,
    },
}

#[derive(Debug, thiserror::Error)]
pub enum GbaAisConnectorError {
    #[error(transparent)]
    Source(#[from] SourceIngestionError),
    #[error(transparent)]
    Database(#[from] sqlx::Error),
    #[error("G-BA AIS download URL configuration is invalid")]
    InvalidConfiguration,
    #[error("failed to construct bounded official-source client")]
    ClientBuild(#[source] reqwest::Error),
    #[error("official-source request failed")]
    Http(#[source] reqwest::Error),
    #[error("official source returned HTTP {0}")]
    UnexpectedStatus(u16),
    #[error("official source returned unsupported content type: {0}")]
    UnsupportedContentType(String),
    #[error("official-source payload exceeds 67108864 bytes")]
    PayloadTooLarge,
    #[error("official-source XML is invalid: {0}")]
    InvalidDelivery(String),
}

impl GbaAisConnectorError {
    fn public_code(&self) -> &'static str {
        match self {
            Self::InvalidConfiguration => "connector_configuration_invalid",
            Self::ClientBuild(_) => "client_configuration_failed",
            Self::Http(error) if error.is_timeout() => "upstream_timeout",
            Self::Http(_) => "upstream_request_failed",
            Self::UnexpectedStatus(_) => "upstream_http_status",
            Self::UnsupportedContentType(_) => "unexpected_content_type",
            Self::PayloadTooLarge => "payload_too_large",
            Self::InvalidDelivery(_) => "invalid_delivery",
            Self::Source(_) | Self::Database(_) => "snapshot_persistence_failed",
        }
    }

    /// Returns an operator-facing diagnostic that never formats reqwest's
    /// error value. Reqwest errors can contain the full request URL, including
    /// the issued G-BA access token in its path or query string.
    fn internal_diagnostic(&self) -> String {
        match self {
            Self::InvalidConfiguration => "connector configuration is invalid".to_string(),
            Self::ClientBuild(_) => {
                "failed to construct bounded official-source client".to_string()
            }
            Self::Http(error) if error.is_timeout() => {
                "official-source request timed out".to_string()
            }
            Self::Http(error) if error.is_connect() => {
                "official-source connection failed".to_string()
            }
            Self::Http(_) => "official-source request failed".to_string(),
            Self::UnexpectedStatus(status) => {
                format!("official source returned HTTP {status}")
            }
            Self::UnsupportedContentType(_) => {
                "official source returned an unsupported content type".to_string()
            }
            Self::PayloadTooLarge => "official-source payload exceeded 67108864 bytes".to_string(),
            Self::InvalidDelivery(message) => format!("official-source XML is invalid: {message}"),
            Self::Source(error) => error.to_string(),
            Self::Database(error) => error.to_string(),
        }
    }
}

/// Enables the connector only when an operator-provided permanent G-BA URL is
/// present and passes the strict host/scheme boundary. The secret URL itself is
/// never written to the database or logs.
pub async fn initialize_gba_ais_connector(state: &AppState, download_url: Option<SecretString>) {
    let validated = download_url.as_ref().map(validate_download_url).transpose();
    let configured = matches!(&validated, Ok(Some(_)));
    if let Err(error) = set_connector_configured(&state.db, configured).await {
        tracing::error!(error = %error, "failed to update G-BA AIS connector state");
        return;
    }
    let Some(download_url) = download_url else {
        tracing::info!(
            "G-BA AIS connector remains disabled: permanent download URL is not configured"
        );
        return;
    };
    if validated.is_err() {
        tracing::error!("G-BA AIS connector remains disabled: download URL failed the allowlist");
        return;
    }
    spawn_gba_ais_scheduler(state.clone(), download_url);
}

async fn set_connector_configured(pool: &PgPool, configured: bool) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"UPDATE medication_intelligence_sources
           SET connector_status = CASE WHEN $2 THEN 'active' ELSE 'planned' END,
               source_url = $3,
               metadata = jsonb_set(metadata, '{configured}', to_jsonb($2::boolean), true)
           WHERE id = $1"#,
    )
    .bind(GBA_AIS_SOURCE_ID)
    .bind(configured)
    .bind(GBA_AIS_PUBLIC_URL)
    .execute(pool)
    .await?;
    Ok(())
}

fn spawn_gba_ais_scheduler(state: AppState, download_url: SecretString) {
    let worker_id = format!("gba-ais-{}", Uuid::new_v4().simple());
    tokio::spawn(async move {
        let mut ticker = tokio::time::interval(Duration::from_secs(SCHEDULER_POLL_SECONDS));
        ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            ticker.tick().await;
            match run_gba_ais_once(&state, &worker_id, &download_url).await {
                Ok(GbaAisRunOutcome::NotClaimed) => {}
                Ok(GbaAisRunOutcome::Completed(result)) => tracing::info!(
                    snapshot_id = %result.snapshot_id,
                    job_status = %result.job_status,
                    duplicate_snapshot = result.duplicate_snapshot,
                    "G-BA AIS ingestion completed"
                ),
                Ok(GbaAisRunOutcome::FailureRecorded { job_id, error_code }) => tracing::warn!(
                    job_id = %job_id,
                    error_code,
                    "G-BA AIS ingestion failed; public error code recorded"
                ),
                Err(error) => tracing::error!(
                    error = %error,
                    "G-BA AIS scheduler could not record its attempt"
                ),
            }
        }
    });
}

pub async fn run_gba_ais_once(
    state: &AppState,
    worker_id: &str,
    download_url: &SecretString,
) -> Result<GbaAisRunOutcome, GbaAisConnectorError> {
    validate_download_url(download_url)?;
    let now = Utc::now();
    let half_day = now.hour() / 12;
    let idempotency_key = format!("gba-ais-{}-{half_day}", now.format("%Y%m%d"));
    let enqueued = enqueue_source_ingestion(
        &state.db,
        GBA_AIS_SOURCE_ID,
        &idempotency_key,
        None,
        json!({"trigger":"scheduled","schedule":"twice_daily"}),
    )
    .await?;
    let Some(job) = claim_ingestion_job(&state.db, enqueued.job_id, worker_id).await? else {
        return Ok(GbaAisRunOutcome::NotClaimed);
    };

    let attempted_at = Utc::now();
    let attempted = async {
        validate_claimed_job(&job)?;
        let fetched = fetch_gba_ais_delivery(download_url).await?;
        complete_gba_ais_job_from_payload(
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
        Ok(result) => Ok(GbaAisRunOutcome::Completed(result)),
        Err(error) => {
            let error_code = error.public_code();
            let internal_error = bounded_internal_error(&error.internal_diagnostic());
            record_ingestion_failure(
                &state.db,
                job.id,
                attempted_at,
                Some(error_code),
                &internal_error,
                json!({"connector":"gba_ais_xml"}),
            )
            .await?;
            Ok(GbaAisRunOutcome::FailureRecorded {
                job_id: job.id,
                error_code,
            })
        }
    }
}

fn validate_download_url(secret: &SecretString) -> Result<Url, GbaAisConnectorError> {
    let url = Url::parse(secret.expose_secret())
        .map_err(|_| GbaAisConnectorError::InvalidConfiguration)?;
    if url.scheme() != "https"
        || url.host_str() != Some(GBA_AIS_DOWNLOAD_HOST)
        || !url.username().is_empty()
        || url.password().is_some()
        || url.fragment().is_some()
        || url.path().is_empty()
        || url.path() == "/"
    {
        return Err(GbaAisConnectorError::InvalidConfiguration);
    }
    Ok(url)
}

fn validate_claimed_job(job: &ClaimedIngestionJob) -> Result<(), GbaAisConnectorError> {
    if job.source_id != GBA_AIS_SOURCE_ID || job.source_url != GBA_AIS_PUBLIC_URL {
        return Err(GbaAisConnectorError::InvalidDelivery(
            "claimed source does not match the compiled G-BA public provenance".to_string(),
        ));
    }
    Ok(())
}

async fn fetch_gba_ais_delivery(
    download_url: &SecretString,
) -> Result<FetchedGbaAisDelivery, GbaAisConnectorError> {
    let url = validate_download_url(download_url)?;
    let client = Client::builder()
        .https_only(true)
        .redirect(redirect::Policy::none())
        .connect_timeout(CONNECT_TIMEOUT)
        .timeout(FETCH_TIMEOUT)
        .user_agent("GMED-Medication-Intelligence/1.0")
        .build()
        .map_err(GbaAisConnectorError::ClientBuild)?;
    let mut response = client
        .get(url)
        .header(
            ACCEPT,
            "application/xml, text/xml;q=0.9, application/octet-stream;q=0.5",
        )
        .send()
        .await
        .map_err(GbaAisConnectorError::Http)?;

    if response.status() != StatusCode::OK {
        return Err(GbaAisConnectorError::UnexpectedStatus(
            response.status().as_u16(),
        ));
    }
    if response
        .headers()
        .get(CONTENT_LENGTH)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<usize>().ok())
        .is_some_and(|length| length > MAX_XML_BYTES)
    {
        return Err(GbaAisConnectorError::PayloadTooLarge);
    }
    let content_type = response
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default()
        .to_string();
    if !is_supported_xml_content_type(&content_type) {
        return Err(GbaAisConnectorError::UnsupportedContentType(content_type));
    }

    let mut bytes = Vec::with_capacity(1024 * 1024);
    while let Some(chunk) = response.chunk().await.map_err(GbaAisConnectorError::Http)? {
        if bytes.len().saturating_add(chunk.len()) > MAX_XML_BYTES {
            return Err(GbaAisConnectorError::PayloadTooLarge);
        }
        bytes.extend_from_slice(&chunk);
    }
    if bytes.is_empty() {
        return Err(GbaAisConnectorError::InvalidDelivery(
            "empty XML payload".to_string(),
        ));
    }

    Ok(FetchedGbaAisDelivery {
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
        "text/xml" | "application/xml" | "application/octet-stream"
    )
}

pub async fn complete_gba_ais_job_from_payload(
    pool: &PgPool,
    job_id: Uuid,
    fetched_at: DateTime<Utc>,
    content_type: String,
    bytes: Vec<u8>,
) -> Result<CompleteAttemptResult, GbaAisConnectorError> {
    if bytes.is_empty() || bytes.len() > MAX_XML_BYTES {
        return Err(if bytes.is_empty() {
            GbaAisConnectorError::InvalidDelivery("empty XML payload".to_string())
        } else {
            GbaAisConnectorError::PayloadTooLarge
        });
    }
    if !is_supported_xml_content_type(&content_type) {
        return Err(GbaAisConnectorError::UnsupportedContentType(content_type));
    }
    let parsed = parse_gba_ais_xml(&bytes)?;
    let checksum_sha256 = hex::encode(Sha256::digest(&bytes));
    let byte_length =
        i64::try_from(bytes.len()).map_err(|_| GbaAisConnectorError::PayloadTooLarge)?;
    let item_count = i64::try_from(parsed.items.len()).map_err(|_| {
        GbaAisConnectorError::InvalidDelivery("too many assessment items".to_string())
    })?;

    record_gba_ais_ingestion_success(
        pool,
        job_id,
        SuccessfulSnapshotInput {
            fetched_at,
            published_at: Some(parsed.published_at),
            source_url: GBA_AIS_PUBLIC_URL.to_string(),
            checksum_sha256,
            version: Some(parsed.version),
            item_count: Some(item_count),
            content_type: Some(content_type.clone()),
            byte_length,
            payload_storage_key: Some(
                "database:medication_intelligence_source_payloads".to_string(),
            ),
            metadata: json!({
                "format":"G-BA_Beschluss_Info",
                "schema_profile":"2023",
                "complete_delivery":true,
                "normalized_unit":"patient_group",
                "secret_download_url_retained":false
            }),
        },
        StoredSourcePayloadInput {
            content_type,
            bytes,
        },
        parsed.items,
    )
    .await
    .map_err(GbaAisConnectorError::Source)
}

#[derive(Default)]
struct ParseState {
    stack: Vec<String>,
    root_seen: bool,
    root_closed: bool,
    declaration_seen: bool,
    generated_at: Option<DateTime<Utc>>,
    decision: Option<DecisionBuilder>,
    patient_group: Option<PatientGroupBuilder>,
    patient_group_ids: HashSet<String>,
    items: Vec<BenefitAssessmentItemInput>,
}

#[derive(Default)]
struct DecisionBuilder {
    decision_id: Option<String>,
    dossier_reference: Option<String>,
    official_url: Option<String>,
    assessment_type: Option<String>,
    trade_names: Vec<String>,
    patient_group_count: usize,
}

#[derive(Default)]
struct PatientGroupBuilder {
    patient_group_id: String,
    assessed_substance_label: Option<String>,
    assessed_ask_labels: Vec<String>,
    atc_codes: Vec<String>,
    ask_numbers: Vec<String>,
    pzns: Vec<String>,
    decision_date: Option<NaiveDate>,
    valid_until: Option<NaiveDate>,
    indication_short: Option<String>,
    patient_group: String,
    benefit_extent: Option<String>,
    benefit_probability: Option<String>,
}

pub fn parse_gba_ais_xml(bytes: &[u8]) -> Result<ParsedGbaAisDelivery, GbaAisConnectorError> {
    if bytes.is_empty() || bytes.len() > MAX_XML_BYTES || bytes.starts_with(&[0xef, 0xbb, 0xbf]) {
        return Err(GbaAisConnectorError::InvalidDelivery(
            "XML is empty, too large, or contains a byte-order mark".to_string(),
        ));
    }
    let mut reader = Reader::from_reader(bytes);
    reader.config_mut().trim_text(false);
    reader.config_mut().check_end_names = true;
    let mut state = ParseState::default();
    let mut events = 0usize;

    loop {
        events += 1;
        if events > MAX_XML_EVENTS {
            return Err(invalid("XML has too many nodes"));
        }
        match reader.read_event() {
            Ok(Event::Start(event)) => handle_open(&reader, &mut state, &event, false)?,
            Ok(Event::Empty(event)) => handle_open(&reader, &mut state, &event, true)?,
            Ok(Event::End(event)) => {
                let name = xml_name(event.name().as_ref())?;
                let opened = state
                    .stack
                    .pop()
                    .ok_or_else(|| invalid("unexpected closing element"))?;
                if opened != name {
                    return Err(invalid("mismatched closing element"));
                }
                finalize_element(&mut state, &name)?;
            }
            Ok(Event::Text(text)) => {
                let decoded = text
                    .xml10_content()
                    .map_err(|error| invalid(&format!("invalid XML text: {error}")))?;
                handle_text(&mut state, decoded.as_ref())?;
            }
            Ok(Event::GeneralRef(reference)) => {
                handle_general_reference(&mut state, &reference)?;
            }
            Ok(Event::Decl(_)) if !state.declaration_seen && !state.root_seen => {
                state.declaration_seen = true;
            }
            Ok(Event::Decl(_)) => return Err(invalid("XML declaration is misplaced or repeated")),
            Ok(Event::Comment(_))
            | Ok(Event::PI(_))
            | Ok(Event::DocType(_))
            | Ok(Event::CData(_)) => {
                return Err(invalid(
                    "comments, processing instructions, DTD and CDATA are forbidden",
                ));
            }
            Ok(Event::Eof) => break,
            Err(error) => return Err(invalid(&error.to_string())),
        }
    }

    if !state.root_seen
        || !state.root_closed
        || !state.stack.is_empty()
        || state.decision.is_some()
        || state.patient_group.is_some()
        || state.items.is_empty()
    {
        return Err(invalid("XML does not contain one complete AIS delivery"));
    }
    let published_at = state
        .generated_at
        .ok_or_else(|| invalid("BE_COLLECTION.generated is missing"))?;
    Ok(ParsedGbaAisDelivery {
        version: published_at.to_rfc3339(),
        published_at,
        items: state.items,
    })
}

fn handle_open(
    reader: &Reader<&[u8]>,
    state: &mut ParseState,
    event: &BytesStart<'_>,
    empty: bool,
) -> Result<(), GbaAisConnectorError> {
    let name = xml_name(event.name().as_ref())?;
    if state.root_closed {
        return Err(invalid("content after BE_COLLECTION is not allowed"));
    }
    if !known_element(&name) {
        return Err(invalid(&format!("unsupported AIS element: {name}")));
    }
    if state.stack.len() >= MAX_XML_DEPTH {
        return Err(invalid("XML nesting is too deep"));
    }
    let attributes = xml_attributes(reader, event)?;
    validate_attributes(&name, &attributes)?;

    match name.as_str() {
        "BE_COLLECTION" => {
            if empty || state.root_seen || !state.stack.is_empty() {
                return Err(invalid("BE_COLLECTION must be the single non-empty root"));
            }
            let generated = attributes
                .get("generated")
                .ok_or_else(|| invalid("BE_COLLECTION.generated is required"))?;
            state.generated_at = Some(
                DateTime::parse_from_rfc3339(generated)
                    .map_err(|_| invalid("BE_COLLECTION.generated is not xs:dateTime"))?
                    .with_timezone(&Utc),
            );
            state.root_seen = true;
        }
        "BE" => {
            if empty
                || state.stack.len() != 1
                || state.stack[0] != "BE_COLLECTION"
                || state.decision.is_some()
            {
                return Err(invalid("BE is misplaced or empty"));
            }
            state.decision = Some(DecisionBuilder::default());
        }
        "ID_PAT_GR" => {
            if empty || state.decision.is_none() || state.patient_group.is_some() {
                return Err(invalid("ID_PAT_GR is misplaced or empty"));
            }
            let patient_group_id = required_value(&attributes, "ID_PAT_GR")?;
            if !numeric_id(&patient_group_id)
                || !state.patient_group_ids.insert(patient_group_id.clone())
            {
                return Err(invalid("ID_PAT_GR value is invalid or duplicated"));
            }
            state.patient_group = Some(PatientGroupBuilder {
                patient_group_id,
                ..PatientGroupBuilder::default()
            });
        }
        "ID_BE" if state.patient_group.is_none() => {
            set_once(
                &mut decision_mut(state)?.decision_id,
                required_value(&attributes, "ID_BE")?,
                "ID_BE",
            )?;
        }
        "ID_BE_AKZ" if state.patient_group.is_none() => {
            set_once(
                &mut decision_mut(state)?.dossier_reference,
                required_value(&attributes, "ID_BE_AKZ")?,
                "ID_BE_AKZ",
            )?;
        }
        "NAME_HN" if state.patient_group.is_none() => {
            decision_mut(state)?
                .trade_names
                .push(required_value(&attributes, "NAME_HN")?);
        }
        "URL"
            if state.patient_group.is_none()
                && state.stack.last().map(String::as_str) == Some("BE") =>
        {
            set_once(
                &mut decision_mut(state)?.official_url,
                required_value(&attributes, "URL")?,
                "URL",
            )?;
        }
        "REG_NB" if state.patient_group.is_none() => {
            set_once(
                &mut decision_mut(state)?.assessment_type,
                required_value(&attributes, "REG_NB")?,
                "REG_NB",
            )?;
        }
        _ if state.patient_group.is_some() => {
            handle_patient_group_field(state, &name, &attributes)?
        }
        _ => {}
    }

    if !empty {
        state.stack.push(name);
    }
    Ok(())
}

fn handle_patient_group_field(
    state: &mut ParseState,
    name: &str,
    attributes: &BTreeMap<String, String>,
) -> Result<(), GbaAisConnectorError> {
    let within_assessed_substance = state.stack.iter().any(|value| value == "WS_BEW");
    let group = state
        .patient_group
        .as_mut()
        .ok_or_else(|| invalid("patient group state is missing"))?;
    match name {
        "NAME_WS_BEW" => set_once(
            &mut group.assessed_substance_label,
            required_value(attributes, name)?,
            name,
        )?,
        "PZN" if within_assessed_substance => {
            if let Some(value) = optional_value(attributes) {
                group.pzns.push(value);
            }
        }
        "ATC_WS_FIX_KOMB" | "ATC_CODE" if within_assessed_substance => {
            if let Some(value) = optional_value(attributes) {
                group.atc_codes.push(value);
            }
        }
        "ASK_NR" if within_assessed_substance => {
            group.ask_numbers.push(required_value(attributes, name)?);
        }
        "NAME_ASK" if within_assessed_substance => {
            group
                .assessed_ask_labels
                .push(required_value(attributes, name)?);
        }
        "DATUM_BE_VOM" => {
            let value = required_value(attributes, name)?;
            group.decision_date = Some(
                NaiveDate::parse_from_str(&value, "%Y-%m-%d")
                    .map_err(|_| invalid("DATUM_BE_VOM is not xs:date"))?,
            );
        }
        "DATUM_BE_BIS" => {
            if let Some(value) = optional_value(attributes) {
                group.valid_until = Some(
                    NaiveDate::parse_from_str(&value, "%Y-%m-%d")
                        .map_err(|_| invalid("DATUM_BE_BIS is not xs:date"))?,
                );
            }
        }
        "AWG_KURZ" => set_once(
            &mut group.indication_short,
            required_value(attributes, name)?,
            name,
        )?,
        "ZN_A" => set_once(
            &mut group.benefit_extent,
            required_value(attributes, name)?,
            name,
        )?,
        "ZN_W" => {
            if let Some(value) = optional_value(attributes) {
                set_once(&mut group.benefit_probability, value, name)?;
            }
        }
        _ => {}
    }
    Ok(())
}

fn handle_text(state: &mut ParseState, value: &str) -> Result<(), GbaAisConnectorError> {
    if value.trim().is_empty() {
        return Ok(());
    }
    let current = state.stack.last().map(String::as_str).unwrap_or_default();
    if !text_element(current) {
        return Err(invalid(&format!("unexpected text in {current}")));
    }
    if value.len() > 20_000 {
        return Err(invalid("AIS text node exceeds 20000 bytes"));
    }
    if current == "NAME_PAT_GR" {
        let group = state
            .patient_group
            .as_mut()
            .ok_or_else(|| invalid("NAME_PAT_GR is outside ID_PAT_GR"))?;
        group.patient_group.push_str(value);
        if group.patient_group.len() > 1_500 {
            return Err(invalid("NAME_PAT_GR exceeds 1500 bytes"));
        }
    }
    Ok(())
}

fn handle_general_reference(
    state: &mut ParseState,
    reference: &BytesRef<'_>,
) -> Result<(), GbaAisConnectorError> {
    let decoded = reference
        .decode()
        .map_err(|error| invalid(&format!("invalid XML reference: {error}")))?;
    let resolved = if reference.is_char_ref() {
        let character = reference
            .resolve_char_ref()
            .map_err(|error| invalid(&format!("invalid XML character reference: {error}")))?
            .ok_or_else(|| invalid("invalid XML character reference"))?;
        if !legal_xml_character(character) {
            return Err(invalid("illegal XML character reference"));
        }
        character.to_string()
    } else {
        resolve_xml_entity(decoded.as_ref())
            .ok_or_else(|| invalid("custom XML entity references are forbidden"))?
            .to_string()
    };
    handle_text(state, &resolved)
}

fn legal_xml_character(value: char) -> bool {
    matches!(
        value,
        '\u{9}' | '\u{A}' | '\u{D}' | '\u{20}'..='\u{D7FF}' | '\u{E000}'..='\u{FFFD}' | '\u{10000}'..='\u{10FFFF}'
    )
}

fn finalize_element(state: &mut ParseState, name: &str) -> Result<(), GbaAisConnectorError> {
    match name {
        "ID_PAT_GR" => finalize_patient_group(state),
        "BE" => {
            let decision = state
                .decision
                .take()
                .ok_or_else(|| invalid("BE state is missing"))?;
            if decision.patient_group_count == 0 {
                return Err(invalid("BE has no patient groups"));
            }
            Ok(())
        }
        "BE_COLLECTION" => {
            if state.decision.is_some() || state.patient_group.is_some() {
                return Err(invalid("BE_COLLECTION closed with incomplete state"));
            }
            state.root_closed = true;
            Ok(())
        }
        _ => Ok(()),
    }
}

fn finalize_patient_group(state: &mut ParseState) -> Result<(), GbaAisConnectorError> {
    if state.items.len() >= MAX_ASSESSMENT_ITEMS {
        return Err(invalid("AIS delivery contains too many patient groups"));
    }
    let mut group = state
        .patient_group
        .take()
        .ok_or_else(|| invalid("ID_PAT_GR state is missing"))?;
    let decision = state
        .decision
        .as_mut()
        .ok_or_else(|| invalid("BE state is missing"))?;
    let decision_id = required(decision.decision_id.as_ref(), "ID_BE")?.clone();
    let dossier_reference = required(decision.dossier_reference.as_ref(), "ID_BE_AKZ")?.clone();
    let official_url = required(decision.official_url.as_ref(), "URL")?.clone();
    validate_official_url(&official_url)?;
    let assessment_type = required(decision.assessment_type.as_ref(), "REG_NB")?.clone();
    if !matches!(
        assessment_type.as_str(),
        "Beschluss_reg" | "Beschluss_orph" | "Beschluss_antib"
    ) {
        return Err(invalid("REG_NB contains an unsupported value"));
    }
    if !numeric_id(&decision_id) {
        return Err(invalid("ID_BE value is invalid"));
    }

    let mut assessed_substances = if group.assessed_ask_labels.is_empty() {
        vec![required(group.assessed_substance_label.as_ref(), "NAME_WS_BEW")?.clone()]
    } else {
        std::mem::take(&mut group.assessed_ask_labels)
    };
    normalize_set(&mut assessed_substances, 32, "assessed substances")?;
    normalize_set(&mut group.atc_codes, 64, "ATC codes")?;
    normalize_set(&mut group.ask_numbers, 64, "ASK numbers")?;
    normalize_set(&mut group.pzns, 4096, "PZNs")?;
    let mut trade_names = decision.trade_names.clone();
    normalize_set(&mut trade_names, 256, "trade names")?;

    let decision_date = group
        .decision_date
        .ok_or_else(|| invalid("DATUM_BE_VOM is missing"))?;
    if group.valid_until.is_some_and(|value| value < decision_date) {
        return Err(invalid("DATUM_BE_BIS precedes DATUM_BE_VOM"));
    }
    let indication_short = required(group.indication_short.as_ref(), "AWG_KURZ")?.clone();
    let patient_group = group.patient_group.trim().to_string();
    if patient_group.is_empty() {
        return Err(invalid("NAME_PAT_GR is missing"));
    }
    let benefit_extent = required(group.benefit_extent.as_ref(), "ZN_A")?.clone();

    let canonical_decision_date = decision_date.format("%Y-%m-%d").to_string();
    let canonical_valid_until = group
        .valid_until
        .map(|value| value.format("%Y-%m-%d").to_string());
    let canonical = json!({
        "patient_group_id":&group.patient_group_id,
        "decision_id":&decision_id,
        "dossier_reference":&dossier_reference,
        "official_url":&official_url,
        "assessment_type":&assessment_type,
        "assessed_substances":&assessed_substances,
        "atc_codes":&group.atc_codes,
        "ask_numbers":&group.ask_numbers,
        "pzns":&group.pzns,
        "trade_names":&trade_names,
        "decision_date":canonical_decision_date,
        "valid_until":canonical_valid_until,
        "indication_short":&indication_short,
        "patient_group":&patient_group,
        "benefit_extent":&benefit_extent,
        "benefit_probability":&group.benefit_probability,
    });
    let item_checksum_sha256 = hex::encode(Sha256::digest(
        serde_json::to_vec(&canonical)
            .map_err(|error| invalid(&format!("failed to canonicalize item: {error}")))?,
    ));

    state.items.push(BenefitAssessmentItemInput {
        patient_group_id: group.patient_group_id,
        decision_id,
        dossier_reference,
        official_url,
        assessment_type,
        assessed_substances,
        atc_codes: group.atc_codes,
        ask_numbers: group.ask_numbers,
        pzns: group.pzns,
        trade_names,
        decision_date,
        valid_until: group.valid_until,
        indication_short,
        patient_group,
        benefit_extent,
        benefit_probability: group.benefit_probability,
        item_checksum_sha256,
    });
    decision.patient_group_count += 1;
    Ok(())
}

fn decision_mut(state: &mut ParseState) -> Result<&mut DecisionBuilder, GbaAisConnectorError> {
    state
        .decision
        .as_mut()
        .ok_or_else(|| invalid("decision field is outside BE"))
}

fn required<'a, T>(value: Option<&'a T>, field: &str) -> Result<&'a T, GbaAisConnectorError> {
    value.ok_or_else(|| invalid(&format!("{field} is missing")))
}

fn set_once(
    target: &mut Option<String>,
    value: String,
    field: &str,
) -> Result<(), GbaAisConnectorError> {
    if target.is_some() {
        return Err(invalid(&format!("{field} is repeated")));
    }
    *target = Some(value);
    Ok(())
}

fn required_value(
    attributes: &BTreeMap<String, String>,
    field: &str,
) -> Result<String, GbaAisConnectorError> {
    optional_value(attributes)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| invalid(&format!("{field}.value is required")))
}

fn optional_value(attributes: &BTreeMap<String, String>) -> Option<String> {
    attributes
        .get("value")
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn normalize_set(
    values: &mut Vec<String>,
    maximum: usize,
    label: &str,
) -> Result<(), GbaAisConnectorError> {
    let normalized = values
        .drain(..)
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .collect::<BTreeSet<_>>();
    if normalized.len() > maximum {
        return Err(invalid(&format!("too many {label}")));
    }
    values.extend(normalized);
    Ok(())
}

fn validate_official_url(value: &str) -> Result<(), GbaAisConnectorError> {
    let url = Url::parse(value).map_err(|_| invalid("URL is invalid"))?;
    if url.scheme() != "https"
        || !matches!(url.host_str(), Some("www.g-ba.de") | Some("g-ba.de"))
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err(invalid("URL is not an official G-BA HTTPS URL"));
    }
    Ok(())
}

fn numeric_id(value: &str) -> bool {
    !value.is_empty() && value.len() <= 9 && value.bytes().all(|byte| byte.is_ascii_digit())
}

fn xml_attributes(
    reader: &Reader<&[u8]>,
    event: &BytesStart<'_>,
) -> Result<BTreeMap<String, String>, GbaAisConnectorError> {
    let mut attributes = BTreeMap::new();
    for attribute in event.attributes().with_checks(true) {
        let attribute = attribute.map_err(|error| invalid(&error.to_string()))?;
        let name = std::str::from_utf8(attribute.key.as_ref())
            .map_err(|_| invalid("attribute name is not UTF-8"))?
            .to_string();
        let value = attribute
            .decode_and_unescape_value(reader.decoder())
            .map_err(|error| invalid(&error.to_string()))?
            .into_owned();
        if value.len() > 20_000 {
            return Err(invalid("XML attribute exceeds 20000 bytes"));
        }
        if attributes.insert(name, value).is_some() {
            return Err(invalid("duplicate XML attribute"));
        }
    }
    if attributes.len() > 4 {
        return Err(invalid("element has too many attributes"));
    }
    Ok(attributes)
}

fn validate_attributes(
    element: &str,
    attributes: &BTreeMap<String, String>,
) -> Result<(), GbaAisConnectorError> {
    for (name, value) in attributes {
        let allowed = if element == "BE_COLLECTION" {
            match name.as_str() {
                "generated" => true,
                "xmlns:xsi" => value == "http://www.w3.org/2001/XMLSchema-instance",
                "xsi:noNamespaceSchemaLocation" => !value.trim().is_empty() && value.len() <= 255,
                _ => false,
            }
        } else {
            name == "value"
        };
        if !allowed {
            return Err(invalid(&format!(
                "unsupported attribute {name} on {element}"
            )));
        }
    }
    Ok(())
}

fn xml_name(bytes: &[u8]) -> Result<String, GbaAisConnectorError> {
    let value = std::str::from_utf8(bytes).map_err(|_| invalid("element name is not UTF-8"))?;
    if value.is_empty()
        || value.len() > 64
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_uppercase() || byte.is_ascii_digit() || byte == b'_')
    {
        return Err(invalid("element name is outside the AIS schema profile"));
    }
    Ok(value.to_string())
}

fn known_element(name: &str) -> bool {
    matches!(
        name,
        "ALPHA_ID"
            | "ALPHA_ID_CODE"
            | "ASK"
            | "ASK_NR"
            | "ATC"
            | "ATC_CODE"
            | "ATC_WS_FIX_KOMB"
            | "AWG"
            | "AWG_BESCHLUSS"
            | "AWG_KURZ"
            | "BE"
            | "BE_COLLECTION"
            | "BEGL_DAT_ERH"
            | "DATUM_BE_BIS"
            | "DATUM_BE_VOM"
            | "EP_LEBQ_BES"
            | "EP_LEBQ_GRAF"
            | "EP_MORB_BES"
            | "EP_MORB_GRAF"
            | "EP_MORT_BES"
            | "EP_MORT_GRAF"
            | "EP_UE_BES"
            | "EP_UE_GRAF"
            | "ICD"
            | "ID_BE"
            | "ID_BE_AKZ"
            | "ID_HN"
            | "ID_ICD"
            | "ID_PAT_GR"
            | "NAME_ALPHA_ID"
            | "NAME_ASK"
            | "NAME_HN"
            | "NAME_ICD"
            | "NAME_PAT_GR"
            | "NAME_WS_BEW"
            | "NAME_WS_KOMB"
            | "NAME_ZVT_BEST"
            | "NAME_ZVT_ZN"
            | "PAT_GR_INFO_COLLECTION"
            | "PZN"
            | "QGA"
            | "QS_ATMP"
            | "REG_NB"
            | "SOND_ZUL_ATMP"
            | "SOND_ZUL_AUSN"
            | "SOND_ZUL_BESOND"
            | "SOND_ZUL_ORPHAN"
            | "UES_BE"
            | "UES_EP_LEBQ"
            | "UES_EP_MORB"
            | "UES_EP_MORT"
            | "UES_EP_UE"
            | "UES_QGA"
            | "UES_ZN"
            | "UES_ZSF_EP"
            | "UES_ZSF_TRG"
            | "UES_ZVT"
            | "UES_ZVT_ZN"
            | "URL"
            | "URL_BEGL_DAT_ERH_VB"
            | "URL_BEGL_DAT_ERH_VB_TEXT"
            | "URL_QS_ATMP"
            | "URL_QS_ATMP_TEXT"
            | "URL_TEXT"
            | "WS_BEW"
            | "WS_INFO"
            | "WS_INFO_BEW"
            | "WS_KOMB"
            | "ZN_A"
            | "ZN_TEXT"
            | "ZN_W"
            | "ZSF_EP_LEBQ"
            | "ZSF_EP_LEG"
            | "ZSF_EP_MORB"
            | "ZSF_EP_MORT"
            | "ZSF_EP_UE"
            | "ZSF_TRG"
            | "ZUL"
            | "ZVT_BEST"
            | "ZVT_ZN"
    )
}

fn text_element(name: &str) -> bool {
    matches!(
        name,
        "AWG"
            | "AWG_BESCHLUSS"
            | "NAME_PAT_GR"
            | "ZN_TEXT"
            | "QGA"
            | "ZSF_TRG"
            | "EP_LEBQ_BES"
            | "EP_MORB_BES"
            | "EP_MORT_BES"
            | "EP_UE_BES"
    )
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

fn invalid(message: &str) -> GbaAisConnectorError {
    GbaAisConnectorError::InvalidDelivery(message.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    const VALID_XML: &str = r#"<?xml version="1.0" encoding="utf-8"?>
<BE_COLLECTION generated="2026-08-15T02:00:00Z">
  <BE>
    <ID_BE value="321"/>
    <ID_BE_AKZ value="2026-01-01-D-123"/>
    <ZUL><NAME_HN value="Beispielmed"/></ZUL>
    <URL value="https://www.g-ba.de/bewertungsverfahren/nutzenbewertung/321/"/>
    <REG_NB value="Beschluss_reg"/>
    <PAT_GR_INFO_COLLECTION>
      <ID_PAT_GR value="456">
        <WS_BEW>
          <NAME_WS_BEW value="Beispielwirkstoff"/>
          <PZN value="12345678"/>
          <WS_INFO_BEW>
            <ATC><ATC_CODE value="A01AA01"/></ATC>
            <ASK><ASK_NR value="12345"/><NAME_ASK value="Beispielwirkstoff"/></ASK>
          </WS_INFO_BEW>
        </WS_BEW>
        <DATUM_BE_VOM value="2026-08-01"/>
        <AWG_KURZ value="Beispielindikation"/>
        <NAME_PAT_GR>Erwachsene &amp; Jugendliche &#x2265; 12 Jahre</NAME_PAT_GR>
        <ZVT_ZN><ZN_A value="gering"/><ZN_W value="Hinweis"/></ZVT_ZN>
      </ID_PAT_GR>
    </PAT_GR_INFO_COLLECTION>
  </BE>
</BE_COLLECTION>"#;

    #[test]
    fn parses_minimal_profile_into_one_traceable_patient_group() {
        let parsed = parse_gba_ais_xml(VALID_XML.as_bytes()).expect("parse delivery");
        assert_eq!(parsed.version, "2026-08-15T02:00:00+00:00");
        assert_eq!(parsed.items.len(), 1);
        let item = &parsed.items[0];
        assert_eq!(item.patient_group_id, "456");
        assert_eq!(item.decision_id, "321");
        assert_eq!(item.atc_codes, ["A01AA01"]);
        assert_eq!(item.ask_numbers, ["12345"]);
        assert_eq!(item.pzns, ["12345678"]);
        assert_eq!(item.assessed_substances, ["Beispielwirkstoff"]);
        assert_eq!(item.patient_group, "Erwachsene & Jugendliche ≥ 12 Jahre");
        assert_eq!(item.benefit_extent, "gering");
        assert_eq!(item.benefit_probability.as_deref(), Some("Hinweis"));
        assert_eq!(item.item_checksum_sha256.len(), 64);
    }

    #[test]
    fn rejects_schema_drift_and_active_content() {
        let unknown = VALID_XML.replace("<ZVT_ZN>", "<NEW_FIELD>");
        assert!(matches!(
            parse_gba_ais_xml(unknown.as_bytes()),
            Err(GbaAisConnectorError::InvalidDelivery(_))
        ));
        let doctype = VALID_XML.replace(
            "<BE_COLLECTION",
            "<!DOCTYPE x [<!ENTITY y SYSTEM 'file:///etc/passwd'>]><BE_COLLECTION",
        );
        assert!(matches!(
            parse_gba_ais_xml(doctype.as_bytes()),
            Err(GbaAisConnectorError::InvalidDelivery(_))
        ));
        let custom_entity = VALID_XML.replace("&amp;", "&custom;");
        assert!(matches!(
            parse_gba_ais_xml(custom_entity.as_bytes()),
            Err(GbaAisConnectorError::InvalidDelivery(_))
        ));
    }

    #[test]
    fn permanent_download_url_is_strictly_allowlisted_and_never_public() {
        let valid = SecretString::from("https://ais.g-ba.de/download/token.xml?key=secret".into());
        assert!(validate_download_url(&valid).is_ok());
        let wrong_host = SecretString::from("https://example.com/token.xml".into());
        assert!(matches!(
            validate_download_url(&wrong_host),
            Err(GbaAisConnectorError::InvalidConfiguration)
        ));
        assert!(!GBA_AIS_PUBLIC_URL.contains("token"));
    }
}
