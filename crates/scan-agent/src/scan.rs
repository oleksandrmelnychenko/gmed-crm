//! One scan run: pages from the scanner, one PDF, a note for the reviewer.

use std::fs;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use chrono::{DateTime, Local};

use crate::escl::{ColorMode, ScanRequest, Scanner, Source};
use crate::pdf;

pub struct ScannedDocument {
    pub pdf: Vec<u8>,
    pub pages: usize,
    pub model: Option<String>,
}

pub fn scan_document(
    scanner: &Scanner,
    request: &ScanRequest,
    on_page: impl FnMut(usize),
) -> Result<ScannedDocument> {
    let caps = scanner.capabilities()?;
    let pages = scanner.scan_pages(&caps, request, on_page)?;
    let pdf = pdf::jpeg_pages_to_pdf(&pages, request.dpi)?;
    Ok(ScannedDocument {
        pdf,
        pages: pages.len(),
        model: caps.make_and_model,
    })
}

pub fn scan_file_name(now: DateTime<Local>) -> String {
    format!("Scan_{}.pdf", now.format("%Y-%m-%d_%H-%M-%S"))
}

/// Technical provenance for the reviewer, stored in the document notes.
/// Carries no patient data.
pub fn scan_note(document: &ScannedDocument, request: &ScanRequest, extra: Option<&str>) -> String {
    let source = match (request.source, request.duplex) {
        (Source::Adf, true) => "feeder, duplex",
        (Source::Adf, false) => "feeder",
        (Source::Flatbed, _) => "flatbed",
    };
    let color = match request.color {
        ColorMode::Color => "color",
        ColorMode::Gray => "gray",
    };
    let mut note = format!(
        "gmed-scan: {} · {} page(s) · {} dpi · {color} · {source}",
        document.model.as_deref().unwrap_or("eSCL scanner"),
        document.pages,
        request.dpi,
    );
    if let Some(extra) = extra.map(str::trim).filter(|value| !value.is_empty()) {
        note = format!("{extra}\n{note}");
    }
    note
}

/// Write `bytes` into `dir` under `file_name`, adding ` (n)` instead of
/// overwriting an existing file.
pub fn save_unique(dir: &Path, file_name: &str, bytes: &[u8]) -> Result<PathBuf> {
    fs::create_dir_all(dir).with_context(|| format!("create {}", dir.display()))?;
    let path = unique_path(dir, file_name);
    fs::write(&path, bytes).with_context(|| format!("write {}", path.display()))?;
    Ok(path)
}

pub fn unique_path(dir: &Path, file_name: &str) -> PathBuf {
    let candidate = dir.join(file_name);
    if !candidate.exists() {
        return candidate;
    }
    let (stem, extension) = match file_name.rsplit_once('.') {
        Some((stem, extension)) if !stem.is_empty() => (stem, format!(".{extension}")),
        _ => (file_name, String::new()),
    };
    (1..)
        .map(|n| dir.join(format!("{stem} ({n}){extension}")))
        .find(|path| !path.exists())
        .expect("an unused file name exists")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::escl::Paper;
    use crate::escl::tests::EPSON_CAPS;
    use crate::pdf::tests::fake_jpeg;
    use crate::test_support::{MockReply, MockServer, temp_dir};
    use chrono::TimeZone;

    #[test]
    fn scans_feeder_pages_into_one_pdf() {
        let server = MockServer::start(move |request| match request.path.as_str() {
            "/eSCL/ScannerCapabilities" => MockReply::xml(EPSON_CAPS),
            "/eSCL/ScannerStatus" => MockReply::xml(
                "<scan:ScannerStatus xmlns:scan=\"s\" xmlns:pwg=\"p\"><pwg:State>Idle</pwg:State></scan:ScannerStatus>",
            ),
            // A host name this computer cannot resolve: the job must stay
            // on the address that answered.
            "/eSCL/ScanJobs" => MockReply::status(201).header(
                "Location",
                "http://EPSON-unresolvable.local:80/eSCL/ScanJobs/7",
            ),
            "/eSCL/ScanJobs/7/NextDocument" if request.seen < 3 => {
                MockReply::bytes("image/jpeg", fake_jpeg(2480, 3508, 3))
            }
            _ => MockReply::status(404),
        });
        let scanner = Scanner::new(&server.url()).unwrap();
        let request = ScanRequest {
            source: Source::Adf,
            duplex: true,
            color: ColorMode::Color,
            dpi: 300,
            paper: Paper::A4,
        };
        let document = scan_document(&scanner, &request, |_| {}).unwrap();
        assert_eq!(document.pages, 3);
        assert_eq!(document.model.as_deref(), Some("EPSON DS-790WN"));
        let parsed = lopdf::Document::load_mem(&document.pdf).unwrap();
        assert_eq!(parsed.get_pages().len(), 3);
        let note = scan_note(&document, &request, Some("Befunde Station 2"));
        assert_eq!(
            note,
            "Befunde Station 2\ngmed-scan: EPSON DS-790WN · 3 page(s) · 300 dpi · color · feeder, duplex"
        );
    }

    #[test]
    fn names_scans_by_local_time_and_never_overwrites() {
        let now = Local.with_ymd_and_hms(2026, 9, 27, 14, 5, 9).unwrap();
        assert_eq!(scan_file_name(now), "Scan_2026-09-27_14-05-09.pdf");
        let dir = temp_dir("save-unique");
        let first = save_unique(&dir, "Scan.pdf", b"1").unwrap();
        let second = save_unique(&dir, "Scan.pdf", b"2").unwrap();
        assert_eq!(first.file_name().unwrap(), "Scan.pdf");
        assert_eq!(second.file_name().unwrap(), "Scan (1).pdf");
        assert_eq!(fs::read(first).unwrap(), b"1");
    }
}
