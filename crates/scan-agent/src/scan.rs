//! One scan run: pages from the scanner, PDFs within GMED's upload limit and
//! a note for the reviewer.

use std::fs;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use chrono::{DateTime, Local};

use crate::api::MAX_UPLOAD_BYTES;
use crate::escl::{ColorMode, ScanRequest, Scanner, Source};
use crate::pdf::{self, PdfPart};

pub struct ScannedDocument {
    /// One PDF, or several when the scan is above GMED's upload limit.
    pub parts: Vec<PdfPart>,
    pub pages: usize,
    pub model: Option<String>,
}

impl ScannedDocument {
    pub fn size(&self) -> usize {
        self.parts.iter().map(|part| part.pdf.len()).sum()
    }
}

pub fn scan_document(
    scanner: &Scanner,
    request: &ScanRequest,
    on_page: impl FnMut(usize),
) -> Result<ScannedDocument> {
    let caps = scanner.capabilities()?;
    let pages = scanner.scan_pages(&caps, request, on_page)?;
    let parts = pdf::jpeg_pages_to_pdf_parts(&pages, request.dpi, MAX_UPLOAD_BYTES)?;
    Ok(ScannedDocument {
        parts,
        pages: pages.len(),
        model: caps.make_and_model,
    })
}

pub fn scan_file_name(now: DateTime<Local>) -> String {
    format!("Scan_{}.pdf", now.format("%Y-%m-%d_%H-%M-%S"))
}

/// `Scan_….pdf` for a single PDF, `Scan_…_part-2-of-3.pdf` for a split scan.
pub fn part_file_name(file_name: &str, index: usize, count: usize) -> String {
    if count <= 1 {
        return file_name.to_string();
    }
    let stem = file_name.strip_suffix(".pdf").unwrap_or(file_name);
    format!("{stem}_part-{}-of-{count}.pdf", index + 1)
}

/// Technical provenance for the reviewer, stored in the document notes.
/// Carries no patient data.
pub fn scan_note(
    document: &ScannedDocument,
    part: usize,
    request: &ScanRequest,
    extra: Option<&str>,
) -> String {
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
    if document.parts.len() > 1
        && let Some(current) = document.parts.get(part)
    {
        note.push_str(&format!(
            " · part {}/{} (pages {}-{})",
            part + 1,
            document.parts.len(),
            current.first_page,
            current.last_page
        ));
    }
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

/// Save every part of a scan into `dir`, in page order. Nothing is uploaded
/// before all of them are on disk.
pub fn save_parts(dir: &Path, file_name: &str, document: &ScannedDocument) -> Result<Vec<PathBuf>> {
    let count = document.parts.len();
    document
        .parts
        .iter()
        .enumerate()
        .map(|(index, part)| save_unique(dir, &part_file_name(file_name, index, count), &part.pdf))
        .collect()
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

    fn duplex_request() -> ScanRequest {
        ScanRequest {
            source: Source::Adf,
            duplex: true,
            color: ColorMode::Color,
            dpi: 300,
            paper: Paper::A4,
        }
    }

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
        let request = duplex_request();
        let document = scan_document(&scanner, &request, |_| {}).unwrap();
        assert_eq!(document.pages, 3);
        assert_eq!(document.parts.len(), 1);
        assert_eq!(document.model.as_deref(), Some("EPSON DS-790WN"));
        let parsed = lopdf::Document::load_mem(&document.parts[0].pdf).unwrap();
        assert_eq!(parsed.get_pages().len(), 3);
        let note = scan_note(&document, 0, &request, Some("Befunde Station 2"));
        assert_eq!(
            note,
            "Befunde Station 2\ngmed-scan: EPSON DS-790WN · 3 page(s) · 300 dpi · color · feeder, duplex"
        );
    }

    #[test]
    fn a_split_scan_is_saved_and_described_part_by_part() {
        let part = |first_page, last_page| PdfPart {
            pdf: b"%PDF-1.7 part".to_vec(),
            first_page,
            last_page,
        };
        let document = ScannedDocument {
            parts: vec![part(1, 20), part(21, 38), part(39, 40)],
            pages: 40,
            model: Some("EPSON DS-790WN".into()),
        };
        let dir = temp_dir("save-parts");
        let saved = save_parts(&dir, "Scan_2026-09-28_09-15-00.pdf", &document).unwrap();
        let names: Vec<String> = saved
            .iter()
            .map(|path| path.file_name().unwrap().to_string_lossy().into_owned())
            .collect();
        assert_eq!(
            names,
            vec![
                "Scan_2026-09-28_09-15-00_part-1-of-3.pdf",
                "Scan_2026-09-28_09-15-00_part-2-of-3.pdf",
                "Scan_2026-09-28_09-15-00_part-3-of-3.pdf",
            ]
        );
        assert_eq!(
            scan_note(&document, 1, &duplex_request(), None),
            "gmed-scan: EPSON DS-790WN · 40 page(s) · 300 dpi · color · feeder, duplex · part 2/3 (pages 21-38)"
        );
        assert_eq!(document.size(), 3 * b"%PDF-1.7 part".len());
    }

    #[test]
    fn names_scans_by_local_time_and_never_overwrites() {
        let now = Local.with_ymd_and_hms(2026, 9, 27, 14, 5, 9).unwrap();
        assert_eq!(scan_file_name(now), "Scan_2026-09-27_14-05-09.pdf");
        assert_eq!(part_file_name("Scan.pdf", 0, 1), "Scan.pdf");
        let dir = temp_dir("save-unique");
        let first = save_unique(&dir, "Scan.pdf", b"1").unwrap();
        let second = save_unique(&dir, "Scan.pdf", b"2").unwrap();
        assert_eq!(first.file_name().unwrap(), "Scan.pdf");
        assert_eq!(second.file_name().unwrap(), "Scan (1).pdf");
        assert_eq!(fs::read(first).unwrap(), b"1");
    }
}
