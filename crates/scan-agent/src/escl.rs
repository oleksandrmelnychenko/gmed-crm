//! Minimal eSCL (AirScan / "AirPrint scan") client.
//!
//! eSCL is HTTP + XML: `ScannerCapabilities` and `ScannerStatus` describe the
//! device, `POST ScanJobs` starts a job and answers with the job URL in
//! `Location`, and every `GET <job>/NextDocument` returns one page until the
//! scanner answers 404 (no more pages).

use std::thread::sleep;
use std::time::{Duration, Instant};

use anyhow::{Context, Result, anyhow, bail};
use quick_xml::Reader;
use quick_xml::escape::resolve_xml_entity;
use quick_xml::events::Event;
use reqwest::blocking::Client;
use reqwest::header::{CONTENT_TYPE, LOCATION};
use reqwest::{StatusCode, Url};

pub const JPEG: &str = "image/jpeg";

/// How long a busy scanner (HTTP 503) is waited for before giving up.
const BUSY_TIMEOUT: Duration = Duration::from_secs(120);

#[derive(Clone, Copy, Debug, PartialEq, Eq, clap::ValueEnum)]
pub enum Source {
    /// Automatic document feeder.
    Adf,
    /// Flatbed glass.
    Flatbed,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, clap::ValueEnum)]
pub enum ColorMode {
    Color,
    Gray,
}

impl ColorMode {
    pub fn escl(self) -> &'static str {
        match self {
            Self::Color => "RGB24",
            Self::Gray => "Grayscale8",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, clap::ValueEnum)]
pub enum Paper {
    A4,
    A5,
    Letter,
    Legal,
    /// The largest area the input source reports.
    Max,
}

impl Paper {
    /// Width and height in eSCL units (1/300 inch), `None` for [`Paper::Max`].
    pub fn size(self) -> Option<(u32, u32)> {
        match self {
            Self::A4 => Some((2480, 3508)),
            Self::A5 => Some((1748, 2480)),
            Self::Letter => Some((2550, 3300)),
            Self::Legal => Some((2550, 4200)),
            Self::Max => None,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ScanRequest {
    pub source: Source,
    pub duplex: bool,
    pub color: ColorMode,
    pub dpi: u32,
    pub paper: Paper,
}

/// What one input source (flatbed, feeder simplex, feeder duplex) offers.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct InputCaps {
    /// Maximum scan width in 1/300 inch.
    pub max_width: Option<u32>,
    /// Maximum scan height in 1/300 inch.
    pub max_height: Option<u32>,
    pub color_modes: Vec<String>,
    pub formats: Vec<String>,
    /// Discrete resolutions; empty when the device reports a range instead.
    pub resolutions: Vec<u32>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Capabilities {
    pub version: Option<String>,
    pub make_and_model: Option<String>,
    pub platen: Option<InputCaps>,
    pub adf_simplex: Option<InputCaps>,
    pub adf_duplex: Option<InputCaps>,
    pub adf_options: Vec<String>,
}

impl Capabilities {
    pub fn supports_duplex(&self) -> bool {
        self.adf_duplex.is_some() || self.adf_options.iter().any(|option| option == "Duplex")
    }

    /// The caps for a source; duplex falls back to the simplex feeder caps
    /// for devices that only announce duplex through `AdfOptions`.
    pub fn input(&self, source: Source, duplex: bool) -> Option<&InputCaps> {
        match source {
            Source::Flatbed => self.platen.as_ref(),
            Source::Adf if duplex => self.adf_duplex.as_ref().or(self.adf_simplex.as_ref()),
            Source::Adf => self.adf_simplex.as_ref(),
        }
    }

    fn escl_version(&self) -> f32 {
        self.version
            .as_deref()
            .and_then(|value| value.trim().parse().ok())
            .unwrap_or(2.0)
    }

    /// Check a request against the device and return the scan region
    /// (width, height in 1/300 inch).
    pub fn validate(&self, request: &ScanRequest) -> Result<(u32, u32)> {
        if request.source == Source::Adf && request.duplex && !self.supports_duplex() {
            bail!("the scanner does not offer duplex scanning");
        }
        let Some(caps) = self.input(request.source, request.duplex) else {
            bail!(
                "the scanner has no {} input",
                match request.source {
                    Source::Adf => "document feeder",
                    Source::Flatbed => "flatbed",
                }
            );
        };
        let mode = request.color.escl();
        if !caps.color_modes.is_empty() && !caps.color_modes.iter().any(|m| m == mode) {
            bail!(
                "color mode {mode} is not supported (the scanner offers: {})",
                caps.color_modes.join(", ")
            );
        }
        if !caps.formats.is_empty() && !caps.formats.iter().any(|f| f == JPEG) {
            bail!(
                "the scanner does not deliver JPEG pages (it offers: {})",
                caps.formats.join(", ")
            );
        }
        if !caps.resolutions.is_empty() && !caps.resolutions.contains(&request.dpi) {
            let offered: Vec<String> = caps.resolutions.iter().map(u32::to_string).collect();
            bail!(
                "{} dpi is not supported (the scanner offers: {})",
                request.dpi,
                offered.join(", ")
            );
        }
        let (width, height) = match request.paper.size() {
            Some(size) => size,
            None => match (caps.max_width, caps.max_height) {
                (Some(width), Some(height)) => (width, height),
                _ => {
                    bail!("the scanner does not report its maximum scan area; choose a paper size")
                }
            },
        };
        Ok((
            caps.max_width.map_or(width, |max| width.min(max)),
            caps.max_height.map_or(height, |max| height.min(max)),
        ))
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Status {
    pub state: Option<String>,
    pub adf_state: Option<String>,
}

/// Normalise what the operator typed (`192.168.1.20`, `scanner.local`,
/// `http://host:8080`, `https://host/eSCL`) into the eSCL root URL with a
/// trailing slash.
pub fn normalize_scanner_url(target: &str) -> Result<Url> {
    let target = target.trim();
    if target.is_empty() {
        bail!("no scanner given");
    }
    let with_scheme = if target.contains("://") {
        target.to_string()
    } else {
        format!("http://{target}")
    };
    let mut url =
        Url::parse(&with_scheme).with_context(|| format!("invalid scanner address {target:?}"))?;
    if !matches!(url.scheme(), "http" | "https") {
        bail!("the scanner address must use http or https");
    }
    if url.path().trim_matches('/').is_empty() {
        url.set_path("/eSCL/");
    } else if !url.path().ends_with('/') {
        let path = format!("{}/", url.path());
        url.set_path(&path);
    }
    url.set_query(None);
    url.set_fragment(None);
    Ok(url)
}

/// The scan settings document for `POST ScanJobs`. Only fixed tokens and
/// numbers are interpolated.
pub fn scan_settings_xml(caps: &Capabilities, request: &ScanRequest, region: (u32, u32)) -> String {
    let version = caps.version.as_deref().unwrap_or("2.0").trim();
    let version = if version.chars().all(|c| c.is_ascii_digit() || c == '.') && !version.is_empty()
    {
        version
    } else {
        "2.0"
    };
    let (input_source, duplex) = match request.source {
        Source::Adf => (
            "Feeder",
            format!("\n  <scan:Duplex>{}</scan:Duplex>", request.duplex),
        ),
        Source::Flatbed => ("Platen", String::new()),
    };
    let format_ext = if caps.escl_version() >= 2.1 {
        format!("\n  <scan:DocumentFormatExt>{JPEG}</scan:DocumentFormatExt>")
    } else {
        String::new()
    };
    format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<scan:ScanSettings xmlns:scan="http://schemas.hp.com/imaging/escl/2011/05/03" xmlns:pwg="http://www.pwg.org/schemas/2010/12/sm">
  <pwg:Version>{version}</pwg:Version>
  <pwg:ScanRegions>
    <pwg:ScanRegion>
      <pwg:ContentRegionUnits>escl:ThreeHundredthsOfInches</pwg:ContentRegionUnits>
      <pwg:XOffset>0</pwg:XOffset>
      <pwg:YOffset>0</pwg:YOffset>
      <pwg:Width>{width}</pwg:Width>
      <pwg:Height>{height}</pwg:Height>
    </pwg:ScanRegion>
  </pwg:ScanRegions>
  <pwg:InputSource>{input_source}</pwg:InputSource>{duplex}
  <scan:ColorMode>{mode}</scan:ColorMode>
  <scan:XResolution>{dpi}</scan:XResolution>
  <scan:YResolution>{dpi}</scan:YResolution>
  <pwg:DocumentFormat>{JPEG}</pwg:DocumentFormat>{format_ext}
</scan:ScanSettings>
"#,
        width = region.0,
        height = region.1,
        mode = request.color.escl(),
        dpi = request.dpi,
    )
}

/// Walk an XML document and hand every element's text to `visit` together
/// with the local names of its ancestors (namespace prefixes dropped).
fn walk_xml(xml: &str, mut visit: impl FnMut(&[String], &str)) -> Result<()> {
    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(true);
    let mut stack: Vec<String> = Vec::new();
    let mut text = String::new();
    loop {
        match reader
            .read_event()
            .context("malformed XML from the scanner")?
        {
            Event::Start(element) => {
                stack.push(String::from_utf8_lossy(element.local_name().as_ref()).into_owned());
                text.clear();
            }
            Event::Text(chunk) => text.push_str(&chunk.decode().context("malformed XML text")?),
            Event::CData(chunk) => text.push_str(&String::from_utf8_lossy(&chunk)),
            Event::GeneralRef(reference) => {
                if let Ok(Some(character)) = reference.resolve_char_ref() {
                    text.push(character);
                } else if let Ok(name) = reference.decode()
                    && let Some(resolved) = resolve_xml_entity(&name)
                {
                    text.push_str(resolved);
                }
            }
            Event::End(_) => {
                visit(&stack, text.trim());
                text.clear();
                stack.pop();
            }
            Event::Eof => break,
            _ => {}
        }
    }
    Ok(())
}

pub fn parse_capabilities(xml: &str) -> Result<Capabilities> {
    let mut caps = Capabilities::default();
    walk_xml(xml, |path, text| {
        let Some(leaf) = path.last().map(String::as_str) else {
            return;
        };
        match (path.len(), leaf) {
            (2, "Version") => caps.version = Some(text.to_string()),
            (_, "MakeAndModel") if caps.make_and_model.is_none() => {
                caps.make_and_model = Some(text.to_string())
            }
            (_, "AdfOption") => caps.adf_options.push(text.to_string()),
            _ => {}
        }
        let has = |name: &str| path.iter().any(|segment| segment == name);
        let slot = if has("PlatenInputCaps") {
            &mut caps.platen
        } else if has("AdfSimplexInputCaps") {
            &mut caps.adf_simplex
        } else if has("AdfDuplexInputCaps") {
            &mut caps.adf_duplex
        } else {
            return;
        };
        let input = slot.get_or_insert_with(InputCaps::default);
        match leaf {
            "MaxWidth" => input.max_width = text.parse().ok(),
            "MaxHeight" => input.max_height = text.parse().ok(),
            "ColorMode" if !input.color_modes.iter().any(|m| m == text) => {
                input.color_modes.push(text.to_string())
            }
            "DocumentFormat" | "DocumentFormatExt" if !input.formats.iter().any(|f| f == text) => {
                input.formats.push(text.to_string())
            }
            "XResolution" if has("DiscreteResolution") => {
                if let Ok(dpi) = text.parse::<u32>()
                    && !input.resolutions.contains(&dpi)
                {
                    input.resolutions.push(dpi);
                }
            }
            _ => {}
        }
    })?;
    for input in [
        &mut caps.platen,
        &mut caps.adf_simplex,
        &mut caps.adf_duplex,
    ]
    .into_iter()
    .flatten()
    {
        input.resolutions.sort_unstable();
    }
    Ok(caps)
}

pub fn parse_status(xml: &str) -> Result<Status> {
    let mut status = Status::default();
    walk_xml(xml, |path, text| match path.last().map(String::as_str) {
        // Only the scanner-level state; jobs inside `Jobs` carry their own.
        Some("State") if path.len() == 2 => status.state = Some(text.to_string()),
        Some("AdfState") => status.adf_state = Some(text.to_string()),
        _ => {}
    })?;
    Ok(status)
}

/// Context for a failed connection. On macOS a missing Local Network
/// permission for Terminal looks exactly like an unreachable scanner.
fn cannot_reach(url: &Url) -> String {
    if cfg!(target_os = "macos") {
        format!(
            "cannot reach the scanner at {url} (is Terminal allowed under System Settings > Privacy & Security > Local Network?)"
        )
    } else {
        format!("cannot reach the scanner at {url}")
    }
}

pub struct Scanner {
    http: Client,
    base: Url,
}

impl Scanner {
    pub fn new(target: &str) -> Result<Self> {
        let base = normalize_scanner_url(target)?;
        // Scanners serve eSCL over plain HTTP or HTTPS with a self-signed
        // certificate that cannot be verified; TLS here only adds encryption.
        let http = Client::builder()
            .user_agent(concat!("gmed-scan/", env!("CARGO_PKG_VERSION")))
            // The scanner is on the local network: never route it through
            // an HTTP(S)_PROXY meant for the internet.
            .no_proxy()
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(300))
            .danger_accept_invalid_certs(true)
            .build()
            .context("create the scanner HTTP client")?;
        Ok(Self { http, base })
    }

    pub fn base(&self) -> &Url {
        &self.base
    }

    fn get_text(&self, path: &str) -> Result<String> {
        let url = self.base.join(path)?;
        let response = self
            .http
            .get(url.clone())
            .send()
            .with_context(|| cannot_reach(&url))?;
        if !response.status().is_success() {
            bail!("the scanner answered {} for {url}", response.status());
        }
        response.text().context("read the scanner response")
    }

    pub fn capabilities(&self) -> Result<Capabilities> {
        parse_capabilities(&self.get_text("ScannerCapabilities")?)
    }

    pub fn status(&self) -> Result<Status> {
        parse_status(&self.get_text("ScannerStatus")?)
    }

    /// Fail early with an operator-friendly message instead of a job error.
    pub fn wait_until_ready(&self, source: Source) -> Result<()> {
        let deadline = Instant::now() + Duration::from_secs(30);
        loop {
            let status = self.status()?;
            if source == Source::Adf {
                match status.adf_state.as_deref() {
                    Some("ScannerAdfEmpty") => {
                        bail!("the document feeder is empty; load the pages and try again")
                    }
                    Some(
                        state @ ("ScannerAdfJam"
                        | "ScannerAdfDoorOpen"
                        | "ScannerAdfHatchOpen"
                        | "ScannerAdfMispick"
                        | "ScannerAdfMultipickDetected"),
                    ) => {
                        bail!("the document feeder reports {state}; check the scanner")
                    }
                    _ => {}
                }
            }
            match status.state.as_deref() {
                Some("Processing") if Instant::now() < deadline => sleep(Duration::from_secs(2)),
                Some("Processing") => bail!("the scanner stays busy with another job"),
                Some("Stopped") => bail!("the scanner reports Stopped; check its display"),
                _ => return Ok(()),
            }
        }
    }

    pub fn start_job(&self, settings_xml: String) -> Result<Url> {
        let url = self.base.join("ScanJobs")?;
        let deadline = Instant::now() + BUSY_TIMEOUT;
        loop {
            let response = self
                .http
                .post(url.clone())
                .header(CONTENT_TYPE, "text/xml")
                .body(settings_xml.clone())
                .send()
                .with_context(|| cannot_reach(&url))?;
            match response.status() {
                StatusCode::CREATED | StatusCode::OK => {
                    let location = response
                        .headers()
                        .get(LOCATION)
                        .and_then(|value| value.to_str().ok())
                        .ok_or_else(|| anyhow!("the scanner accepted the job without a job URL"))?;
                    // Keep talking to the address that answered: devices may
                    // put a host name or another interface into `Location`
                    // that this computer cannot resolve.
                    let job_path = match Url::parse(location) {
                        Ok(absolute) => absolute.path().to_string(),
                        Err(_) => location.to_string(),
                    };
                    let job = self
                        .base
                        .join(&job_path)
                        .context("invalid job URL from the scanner")?;
                    return Ok(job);
                }
                StatusCode::SERVICE_UNAVAILABLE if Instant::now() < deadline => {
                    sleep(Duration::from_secs(2))
                }
                StatusCode::CONFLICT => {
                    bail!("the scanner refused the job (409): busy or no paper loaded")
                }
                status => {
                    let body = response.text().unwrap_or_default();
                    bail!("the scanner refused the job ({status}): {}", body.trim())
                }
            }
        }
    }

    /// The next page of a job, `None` once the scanner has no more pages.
    pub fn next_document(&self, job: &Url) -> Result<Option<Vec<u8>>> {
        let url = Url::parse(&format!(
            "{}/NextDocument",
            job.as_str().trim_end_matches('/')
        ))?;
        let deadline = Instant::now() + BUSY_TIMEOUT;
        loop {
            let response = self
                .http
                .get(url.clone())
                .send()
                .with_context(|| cannot_reach(&url))?;
            match response.status() {
                StatusCode::OK => return Ok(Some(response.bytes()?.to_vec())),
                StatusCode::NOT_FOUND | StatusCode::GONE => return Ok(None),
                StatusCode::SERVICE_UNAVAILABLE if Instant::now() < deadline => {
                    sleep(Duration::from_secs(1))
                }
                status => bail!("the scanner failed while delivering a page ({status})"),
            }
        }
    }

    /// Best-effort job cancellation; errors are irrelevant once we give up.
    pub fn cancel(&self, job: &Url) {
        let _ = self.http.delete(job.clone()).send();
    }

    /// Run a whole job and return the JPEG pages in scan order.
    pub fn scan_pages(
        &self,
        caps: &Capabilities,
        request: &ScanRequest,
        mut on_page: impl FnMut(usize),
    ) -> Result<Vec<Vec<u8>>> {
        let region = caps.validate(request)?;
        self.wait_until_ready(request.source)?;
        let job = self.start_job(scan_settings_xml(caps, request, region))?;
        let mut pages = Vec::new();
        loop {
            match self.next_document(&job) {
                Ok(Some(page)) => {
                    pages.push(page);
                    on_page(pages.len());
                }
                Ok(None) => break,
                Err(error) => {
                    self.cancel(&job);
                    return Err(error);
                }
            }
        }
        if pages.is_empty() {
            bail!("the scanner returned no pages (is the document loaded?)");
        }
        Ok(pages)
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::test_support::{MockReply, MockServer};

    pub(crate) const EPSON_CAPS: &str = include_str!("../tests/fixtures/escl-capabilities.xml");

    const STATUS_READY: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
<scan:ScannerStatus xmlns:scan="http://schemas.hp.com/imaging/escl/2011/05/03" xmlns:pwg="http://www.pwg.org/schemas/2010/12/sm">
  <pwg:Version>2.63</pwg:Version>
  <pwg:State>Idle</pwg:State>
  <scan:AdfState>ScannerAdfLoaded</scan:AdfState>
  <scan:Jobs><scan:JobInfo><pwg:JobState>Completed</pwg:JobState><pwg:State>Completed</pwg:State></scan:JobInfo></scan:Jobs>
</scan:ScannerStatus>"#;

    fn adf_request() -> ScanRequest {
        ScanRequest {
            source: Source::Adf,
            duplex: false,
            color: ColorMode::Color,
            dpi: 300,
            paper: Paper::A4,
        }
    }

    #[test]
    fn parses_epson_style_capabilities() {
        let caps = parse_capabilities(EPSON_CAPS).unwrap();
        assert_eq!(caps.version.as_deref(), Some("2.63"));
        assert_eq!(caps.make_and_model.as_deref(), Some("EPSON DS-790WN"));
        let adf = caps.adf_simplex.as_ref().unwrap();
        assert_eq!(adf.max_width, Some(2550));
        assert_eq!(adf.max_height, Some(4200));
        assert_eq!(adf.resolutions, vec![200, 300, 600]);
        assert_eq!(adf.formats, vec![JPEG.to_string()]);
        assert!(adf.color_modes.contains(&"Grayscale8".to_string()));
        assert_eq!(caps.platen.as_ref().unwrap().resolutions, vec![150, 300]);
        assert!(caps.adf_duplex.is_none());
        assert!(
            caps.supports_duplex(),
            "duplex announced through AdfOptions"
        );
    }

    #[test]
    fn status_ignores_job_states() {
        let status = parse_status(STATUS_READY).unwrap();
        assert_eq!(status.state.as_deref(), Some("Idle"));
        assert_eq!(status.adf_state.as_deref(), Some("ScannerAdfLoaded"));
    }

    #[test]
    fn validates_requests_against_capabilities() {
        let caps = parse_capabilities(EPSON_CAPS).unwrap();
        assert_eq!(caps.validate(&adf_request()).unwrap(), (2480, 3508));
        let max = ScanRequest {
            paper: Paper::Max,
            ..adf_request()
        };
        assert_eq!(caps.validate(&max).unwrap(), (2550, 4200));
        let legal_on_glass = ScanRequest {
            source: Source::Flatbed,
            paper: Paper::Legal,
            ..adf_request()
        };
        assert_eq!(
            caps.validate(&legal_on_glass).unwrap(),
            (2550, 3508),
            "clamped to the glass"
        );
        let bad_dpi = ScanRequest {
            dpi: 250,
            ..adf_request()
        };
        let message = caps.validate(&bad_dpi).unwrap_err().to_string();
        assert!(message.contains("200, 300, 600"), "{message}");
        let duplex = ScanRequest {
            duplex: true,
            ..adf_request()
        };
        assert!(caps.validate(&duplex).is_ok());
    }

    #[test]
    fn scan_settings_follow_the_request() {
        let caps = parse_capabilities(EPSON_CAPS).unwrap();
        let request = ScanRequest {
            duplex: true,
            color: ColorMode::Gray,
            dpi: 200,
            ..adf_request()
        };
        let xml = scan_settings_xml(&caps, &request, (2480, 3508));
        for expected in [
            "<pwg:Version>2.63</pwg:Version>",
            "<pwg:InputSource>Feeder</pwg:InputSource>",
            "<scan:Duplex>true</scan:Duplex>",
            "<scan:ColorMode>Grayscale8</scan:ColorMode>",
            "<scan:XResolution>200</scan:XResolution>",
            "<pwg:Width>2480</pwg:Width>",
            "<pwg:Height>3508</pwg:Height>",
            "<scan:DocumentFormatExt>image/jpeg</scan:DocumentFormatExt>",
        ] {
            assert!(xml.contains(expected), "missing {expected} in\n{xml}");
        }
        let flatbed = ScanRequest {
            source: Source::Flatbed,
            ..adf_request()
        };
        let xml = scan_settings_xml(&caps, &flatbed, (2480, 3508));
        assert!(xml.contains("<pwg:InputSource>Platen</pwg:InputSource>"));
        assert!(!xml.contains("Duplex"));
        // The written document must be well-formed.
        walk_xml(&xml, |_, _| {}).unwrap();
    }

    #[test]
    fn normalizes_scanner_addresses() {
        for (input, expected) in [
            ("192.168.1.20", "http://192.168.1.20/eSCL/"),
            ("EPSON123.local", "http://epson123.local/eSCL/"),
            ("https://10.0.0.5:443/eSCL", "https://10.0.0.5/eSCL/"),
            ("http://10.0.0.5:8080/", "http://10.0.0.5:8080/eSCL/"),
            (
                "http://10.0.0.5/custom/escl/",
                "http://10.0.0.5/custom/escl/",
            ),
        ] {
            assert_eq!(normalize_scanner_url(input).unwrap().as_str(), expected);
        }
        assert!(normalize_scanner_url("ftp://10.0.0.5").is_err());
    }

    #[test]
    fn runs_a_feeder_job_until_the_scanner_has_no_more_pages() {
        let server =
            MockServer::start(
                |request| match (request.method.as_str(), request.path.as_str()) {
                    ("GET", "/eSCL/ScannerCapabilities") => MockReply::xml(EPSON_CAPS),
                    ("GET", "/eSCL/ScannerStatus") => MockReply::xml(STATUS_READY),
                    ("POST", "/eSCL/ScanJobs") => {
                        let body = String::from_utf8_lossy(&request.body);
                        assert!(body.contains("<pwg:InputSource>Feeder</pwg:InputSource>"));
                        MockReply::status(201).header("Location", "/eSCL/ScanJobs/job-1")
                    }
                    ("GET", "/eSCL/ScanJobs/job-1/NextDocument") => match request.seen {
                        // The first poll arrives while the scanner is still warming up.
                        0 => MockReply::status(503),
                        1 => MockReply::bytes("image/jpeg", b"page-1".to_vec()),
                        2 => MockReply::bytes("image/jpeg", b"page-2".to_vec()),
                        _ => MockReply::status(404),
                    },
                    _ => MockReply::status(500),
                },
            );
        let scanner = Scanner::new(&server.url()).unwrap();
        let caps = scanner.capabilities().unwrap();
        let mut progress = Vec::new();
        let pages = scanner
            .scan_pages(&caps, &adf_request(), |count| progress.push(count))
            .unwrap();
        assert_eq!(pages, vec![b"page-1".to_vec(), b"page-2".to_vec()]);
        assert_eq!(progress, vec![1, 2]);
    }

    #[test]
    fn empty_feeder_is_reported_before_a_job_starts() {
        let server = MockServer::start(|request| match request.path.as_str() {
            "/eSCL/ScannerStatus" => {
                MockReply::xml(&STATUS_READY.replace("ScannerAdfLoaded", "ScannerAdfEmpty"))
            }
            "/eSCL/ScanJobs" => MockReply::status(500),
            _ => MockReply::xml(EPSON_CAPS),
        });
        let scanner = Scanner::new(&server.url()).unwrap();
        let caps = scanner.capabilities().unwrap();
        let error = scanner
            .scan_pages(&caps, &adf_request(), |_| {})
            .unwrap_err();
        assert!(error.to_string().contains("feeder is empty"), "{error}");
    }
}
