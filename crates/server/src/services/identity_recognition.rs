//! Reads the machine readable zone of an uploaded identity document (image
//! or PDF) with the OCR tools of this server: `tesseract`, and `pdftoppm`
//! for a PDF. The file never leaves the host; it lives in a private
//! temporary directory for the run and is removed after it.
//!
//! Nothing read is logged or stored here: the caller offers it to staff as a
//! proposal (see [`crate::services::mrz`]).

use std::path::{Path, PathBuf};
use std::time::Duration;

use chrono::NaiveDate;
use uuid::Uuid;

use crate::routes::documents::{create_private_ocr_temp_file, document_ocr_semaphore};
use crate::services::mrz::{self, MrzData};

/// The pages of a PDF that are looked at: the data page is the first or second.
const MAX_PDF_PAGES: u32 = 3;
/// The whole run of one file, all pages and passes.
const RUN_TIMEOUT: Duration = Duration::from_secs(75);
/// The zone's alphabet; nothing else is on those lines.
const MRZ_ALPHABET: &str = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<";
/// The passes tried in turn until every check digit holds: a page
/// segmentation mode (6: one block of text, 1: automatic with orientation
/// detection for a scan lying on its side or upside down, 11: sparse text)
/// and a thresholding method (0: global, 2: local — a tinted document on a
/// white sheet reads only with the local one). A pass takes well under a
/// second per page.
const PASSES: [(&str, &str); 6] = [
    ("6", "0"),
    ("6", "2"),
    ("1", "2"),
    ("1", "0"),
    ("11", "2"),
    ("11", "0"),
];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum RecognitionError {
    /// Neither a PDF nor an image this server reads.
    UnsupportedFile,
    /// The OCR tools are not installed on this host.
    Unavailable,
    /// The tools ran out of time or failed.
    Failed,
}

/// The file type by its first bytes; the extension for the temporary file.
fn file_extension(bytes: &[u8]) -> Option<&'static str> {
    match bytes {
        [b'%', b'P', b'D', b'F', ..] => Some("pdf"),
        [0x89, b'P', b'N', b'G', ..] => Some("png"),
        [0xFF, 0xD8, 0xFF, ..] => Some("jpg"),
        [b'I', b'I', 0x2A, 0x00, ..] | [b'M', b'M', 0x00, 0x2A, ..] => Some("tiff"),
        [b'B', b'M', ..] => Some("bmp"),
        [
            b'R',
            b'I',
            b'F',
            b'F',
            _,
            _,
            _,
            _,
            b'W',
            b'E',
            b'B',
            b'P',
            ..,
        ] => Some("webp"),
        _ => None,
    }
}

async fn run(
    mut command: tokio::process::Command,
    deadline: tokio::time::Instant,
    tool: &'static str,
) -> Result<Option<Vec<u8>>, RecognitionError> {
    let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
    if remaining.is_zero() {
        return Err(RecognitionError::Failed);
    }
    command.kill_on_drop(true);
    match tokio::time::timeout(remaining, command.output()).await {
        Ok(Ok(output)) if output.status.success() => Ok(Some(output.stdout)),
        // The tool refused this input or this mode: the next pass may do.
        Ok(Ok(_)) => Ok(None),
        Ok(Err(error)) if error.kind() == std::io::ErrorKind::NotFound => {
            Err(RecognitionError::Unavailable)
        }
        Ok(Err(error)) => {
            tracing::warn!(error = %error, tool, "identity recognition tool failed to start");
            Err(RecognitionError::Failed)
        }
        Err(_) => {
            tracing::warn!(tool, "identity recognition timed out");
            Err(RecognitionError::Failed)
        }
    }
}

/// The pages of a PDF as images, in page order.
async fn pdf_pages(
    pdf: &Path,
    work_dir: &Path,
    deadline: tokio::time::Instant,
) -> Result<Vec<PathBuf>, RecognitionError> {
    let mut command = tokio::process::Command::new("pdftoppm");
    command
        .arg("-r")
        .arg("300")
        .arg("-gray")
        .arg("-png")
        .arg("-f")
        .arg("1")
        .arg("-l")
        .arg(MAX_PDF_PAGES.to_string())
        .arg(pdf)
        .arg(work_dir.join("page"));
    if run(command, deadline, "pdftoppm").await?.is_none() {
        return Err(RecognitionError::Failed);
    }
    let mut pages = Vec::new();
    let mut entries = tokio::fs::read_dir(work_dir)
        .await
        .map_err(|_| RecognitionError::Failed)?;
    while let Some(entry) = entries
        .next_entry()
        .await
        .map_err(|_| RecognitionError::Failed)?
    {
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with("page") && name.ends_with(".png") {
            pages.push(entry.path());
        }
    }
    // pdftoppm zero-pads page numbers, so the name order is the page order.
    pages.sort();
    Ok(pages)
}

/// The text of one image in one pass, limited to the zone's alphabet;
/// `None` when the pass does not run on this host or image.
async fn ocr(
    image: &Path,
    mode: &str,
    thresholding: &str,
    deadline: tokio::time::Instant,
) -> Result<Option<String>, RecognitionError> {
    let mut command = tokio::process::Command::new("tesseract");
    command
        .env("OMP_THREAD_LIMIT", "1")
        .arg(image)
        .arg("stdout")
        .arg("--oem")
        .arg("1")
        .arg("--psm")
        .arg(mode)
        .arg("-l")
        .arg("eng")
        .arg("-c")
        .arg(format!("tessedit_char_whitelist={MRZ_ALPHABET}"))
        .arg("-c")
        .arg("load_system_dawg=0")
        .arg("-c")
        .arg("load_freq_dawg=0")
        .arg("-c")
        .arg(format!("thresholding_method={thresholding}"));
    Ok(run(command, deadline, "tesseract")
        .await?
        .map(|stdout| String::from_utf8_lossy(&stdout).into_owned()))
}

async fn read_images(
    images: &[PathBuf],
    today: NaiveDate,
    deadline: tokio::time::Instant,
) -> Result<Option<MrzData>, RecognitionError> {
    let mut best: Option<MrzData> = None;
    for image in images {
        for (mode, thresholding) in PASSES {
            let Some(text) = ocr(image, mode, thresholding, deadline).await? else {
                continue;
            };
            let Some(found) = mrz::read(&text, today) else {
                continue;
            };
            if found.checks.all() {
                return Ok(Some(found));
            }
            if best
                .as_ref()
                .is_none_or(|current| found.checks.passed() > current.checks.passed())
            {
                best = Some(found);
            }
        }
    }
    Ok(best)
}

fn create_private_dir(path: &Path) -> std::io::Result<()> {
    #[cfg_attr(not(unix), allow(unused_mut))]
    let mut builder = std::fs::DirBuilder::new();
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        builder.mode(0o700);
    }
    builder.create(path)
}

/// The zone of the document in `bytes`: `Ok(None)` when no zone is found.
/// A zone whose check digits do not all hold is returned as read, with the
/// checks that failed; the caller warns and leaves the entry to staff.
pub(crate) async fn recognize(
    bytes: &[u8],
    today: NaiveDate,
) -> Result<Option<MrzData>, RecognitionError> {
    let extension = file_extension(bytes).ok_or(RecognitionError::UnsupportedFile)?;
    let deadline = tokio::time::Instant::now() + RUN_TIMEOUT;
    let _permit = tokio::time::timeout(RUN_TIMEOUT, document_ocr_semaphore().acquire())
        .await
        .map_err(|_| RecognitionError::Failed)?
        .map_err(|_| RecognitionError::Unavailable)?;

    let work_dir = std::env::temp_dir().join(format!("gmed-id-ocr-{}", Uuid::new_v4()));
    create_private_dir(&work_dir).map_err(|_| RecognitionError::Failed)?;
    let result = async {
        let source = work_dir.join(format!("source.{extension}"));
        create_private_ocr_temp_file(&source).map_err(|_| RecognitionError::Failed)?;
        tokio::fs::write(&source, bytes)
            .await
            .map_err(|_| RecognitionError::Failed)?;
        let images = if extension == "pdf" {
            pdf_pages(&source, &work_dir, deadline).await?
        } else {
            vec![source]
        };
        read_images(&images, today, deadline).await
    }
    .await;
    let _ = tokio::fs::remove_dir_all(&work_dir).await;
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn file_types_are_told_by_their_first_bytes() {
        assert_eq!(file_extension(b"%PDF-1.7 ..."), Some("pdf"));
        assert_eq!(file_extension(&[0x89, b'P', b'N', b'G', 0x0D]), Some("png"));
        assert_eq!(file_extension(&[0xFF, 0xD8, 0xFF, 0xE0]), Some("jpg"));
        assert_eq!(file_extension(b"RIFF\0\0\0\0WEBPVP8 "), Some("webp"));
        assert_eq!(file_extension(b"PK\x03\x04"), None);
        assert_eq!(file_extension(b""), None);
    }

    #[tokio::test]
    async fn a_file_that_is_no_scan_is_refused_before_any_tool_runs() {
        let today = NaiveDate::from_ymd_opt(2026, 11, 10).unwrap();
        assert_eq!(
            recognize(b"plain text", today).await,
            Err(RecognitionError::UnsupportedFile)
        );
    }
}
