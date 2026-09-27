//! Hot folder: upload the scans that other tools (Epson Scan 2, the
//! scanner's own "Scan to Network Folder") drop into a directory.
//!
//! A file is uploaded once two polls saw the same size and modification time
//! and it has not changed for the settle time, so half-written files are
//! left alone. Uploaded files move to `gmed-uploaded/` (or are deleted),
//! files GMED refuses move to `gmed-failed/` with the reason next to them,
//! and transient failures are retried with backoff.

use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::thread::sleep;
use std::time::{Duration, Instant, SystemTime};

use anyhow::{Context, Result, anyhow, bail};

use crate::api::{ApiError, Gmed, IntakeUpload, MAX_UPLOAD_BYTES, UploadedDocument, too_large};
use crate::scan::unique_path;

pub const UPLOADED_DIR: &str = "gmed-uploaded";
pub const FAILED_DIR: &str = "gmed-failed";
const MAX_BACKOFF: Duration = Duration::from_secs(300);

#[derive(Clone, Copy, Debug, PartialEq, Eq, clap::ValueEnum)]
pub enum AfterUpload {
    /// Move the file into `gmed-uploaded/` inside the watched folder.
    Move,
    /// Delete the file once GMED has confirmed the upload.
    Delete,
}

pub struct WatchOptions {
    pub dir: PathBuf,
    pub interval: Duration,
    /// How long a file must stay unchanged before it is uploaded.
    pub settle: Duration,
    pub after_upload: AfterUpload,
    /// Handle the files that are there and return instead of watching.
    pub once: bool,
    pub notes: Option<String>,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct WatchSummary {
    pub uploaded: usize,
    pub rejected: usize,
    /// Files left in place after a transient failure (`once` mode).
    pub pending: usize,
}

/// The content type GMED expects for a scan file, `None` for other files.
pub fn mime_for(path: &Path) -> Option<&'static str> {
    let extension = path.extension()?.to_str()?.to_ascii_lowercase();
    Some(match extension.as_str() {
        "pdf" => "application/pdf",
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "tif" | "tiff" => "image/tiff",
        _ => return None,
    })
}

fn is_candidate(path: &Path) -> bool {
    let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
        return false;
    };
    !name.starts_with('.') && !name.starts_with("~$") && mime_for(path).is_some()
}

/// Upload one file into the intake queue.
pub fn upload_file(
    gmed: &Gmed,
    path: &Path,
    title: Option<String>,
    notes: Option<String>,
) -> Result<UploadedDocument> {
    let mime = mime_for(path)
        .ok_or_else(|| anyhow!("{} is not a PDF, JPEG, PNG or TIFF file", path.display()))?;
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| anyhow!("{} has no usable file name", path.display()))?
        .to_string();
    // Refuse an oversized file before reading it into memory; watch mode
    // treats this refusal as final and sets the file aside.
    let size = fs::metadata(path)
        .with_context(|| format!("read {}", path.display()))?
        .len();
    if size > MAX_UPLOAD_BYTES as u64 {
        return Err(too_large(&file_name, size).into());
    }
    let bytes = fs::read(path).with_context(|| format!("read {}", path.display()))?;
    gmed.upload_intake(IntakeUpload {
        file_name,
        mime: mime.to_string(),
        bytes,
        title,
        notes,
    })
}

struct Tracked {
    size: u64,
    modified: Option<SystemTime>,
    unchanged_since: Instant,
    observations: u32,
    attempts: u32,
    next_attempt: Instant,
}

pub fn run(gmed: &Gmed, options: &WatchOptions, mut log: impl FnMut(&str)) -> Result<WatchSummary> {
    if !options.dir.is_dir() {
        bail!("{} is not a folder", options.dir.display());
    }
    let notes = options
        .notes
        .clone()
        .unwrap_or_else(|| "gmed-scan: folder import".to_string());
    let mut tracked: HashMap<PathBuf, Tracked> = HashMap::new();
    let mut summary = WatchSummary::default();
    loop {
        let now = Instant::now();
        let mut present = HashSet::new();
        for entry in
            fs::read_dir(&options.dir).with_context(|| format!("read {}", options.dir.display()))?
        {
            let Ok(entry) = entry else { continue };
            let path = entry.path();
            let Ok(metadata) = entry.metadata() else {
                continue;
            };
            if !metadata.is_file() || !is_candidate(&path) {
                continue;
            }
            present.insert(path.clone());
            let modified = metadata.modified().ok();
            let state = tracked.entry(path.clone()).or_insert(Tracked {
                size: metadata.len(),
                modified,
                unchanged_since: now,
                observations: 0,
                attempts: 0,
                next_attempt: now,
            });
            if state.size != metadata.len() || state.modified != modified {
                state.size = metadata.len();
                state.modified = modified;
                state.unchanged_since = now;
                state.observations = 1;
                continue;
            }
            state.observations += 1;
            let file_age = modified
                .and_then(|time| SystemTime::now().duration_since(time).ok())
                .unwrap_or_default();
            let settled = now.duration_since(state.unchanged_since) >= options.settle
                || file_age >= options.settle;
            if state.size == 0 || state.observations < 2 || !settled || now < state.next_attempt {
                continue;
            }
            if options.once && state.attempts > 0 {
                continue;
            }
            state.attempts += 1;
            let name = path
                .file_name()
                .map(|name| name.to_string_lossy().into_owned())
                .unwrap_or_default();
            match upload_file(gmed, &path, None, Some(notes.clone())) {
                Ok(document) => {
                    match options.after_upload {
                        AfterUpload::Move => {
                            let target = move_into(&options.dir, UPLOADED_DIR, &path)
                                .with_context(|| format!("{name} was uploaded as document {} but could not be moved; stopping so it is not uploaded twice", document.id))?;
                            log(&format!(
                                "uploaded {name} -> intake document {} (moved to {})",
                                document.id,
                                target.display()
                            ));
                        }
                        AfterUpload::Delete => {
                            fs::remove_file(&path)
                                .with_context(|| format!("{name} was uploaded as document {} but could not be deleted; stopping so it is not uploaded twice", document.id))?;
                            log(&format!(
                                "uploaded {name} -> intake document {} (local file deleted)",
                                document.id
                            ));
                        }
                    }
                    tracked.remove(&path);
                    summary.uploaded += 1;
                }
                Err(error)
                    if error
                        .downcast_ref::<ApiError>()
                        .is_some_and(ApiError::rejects_file) =>
                {
                    let target = move_into(&options.dir, FAILED_DIR, &path).with_context(|| {
                        format!("GMED refused {name} but it could not be moved aside")
                    })?;
                    let reason = format!("{error:#}");
                    let _ = fs::write(
                        target.with_extension(format!("{}.error.txt", extension_of(&target))),
                        format!("{reason}\n"),
                    );
                    log(&format!(
                        "GMED refused {name}: {reason} (moved to {})",
                        target.display()
                    ));
                    tracked.remove(&path);
                    summary.rejected += 1;
                }
                Err(error) => {
                    let delay = backoff(options.interval, state.attempts);
                    state.next_attempt = Instant::now() + delay;
                    if options.once {
                        log(&format!("could not upload {name}: {error:#}"));
                    } else {
                        log(&format!(
                            "could not upload {name}: {error:#}; retrying in {}s",
                            delay.as_secs()
                        ));
                    }
                }
            }
        }
        tracked.retain(|path, _| present.contains(path));

        if options.once {
            let waiting = tracked.values().filter(|state| state.attempts == 0).count();
            if waiting == 0 {
                summary.pending = tracked.len();
                return Ok(summary);
            }
        }
        sleep(options.interval);
    }
}

fn extension_of(path: &Path) -> String {
    path.extension()
        .map(|extension| extension.to_string_lossy().into_owned())
        .unwrap_or_default()
}

fn backoff(interval: Duration, attempts: u32) -> Duration {
    let factor = 2u32.saturating_pow(attempts.min(16));
    interval.saturating_mul(factor).min(MAX_BACKOFF)
}

fn move_into(root: &Path, subdir: &str, path: &Path) -> Result<PathBuf> {
    let dir = root.join(subdir);
    fs::create_dir_all(&dir).with_context(|| format!("create {}", dir.display()))?;
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| anyhow!("{} has no usable file name", path.display()))?;
    let target = unique_path(&dir, name);
    fs::rename(path, &target)
        .with_context(|| format!("move {} to {}", path.display(), target.display()))?;
    Ok(target)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{Paths, Session};
    use crate::test_support::{MockReply, MockServer, temp_dir};
    use serde_json::json;

    fn signed_in(server: &MockServer, label: &str) -> Gmed {
        let paths = Paths::at(temp_dir(label));
        paths
            .save_session(&Session {
                server: server.url(),
                email: "pm@example.test".into(),
                access_token: "access".into(),
                refresh_token: "refresh".into(),
                access_expires_at: chrono::Utc::now().timestamp() + 3600,
            })
            .unwrap();
        Gmed::new(paths).unwrap()
    }

    fn options(dir: &Path, after_upload: AfterUpload) -> WatchOptions {
        WatchOptions {
            dir: dir.to_path_buf(),
            interval: Duration::from_millis(20),
            settle: Duration::from_millis(0),
            after_upload,
            once: true,
            notes: None,
        }
    }

    #[test]
    fn uploads_scans_moves_them_and_sets_refused_files_aside() {
        let server = MockServer::start(|request| {
            let body = String::from_utf8_lossy(&request.body);
            if body.contains("filename=\"broken.pdf\"") {
                MockReply::json(json!({ "error": "unprocessable", "message": "Uploaded file content does not match" }))
                    .with_status(422)
            } else {
                assert!(body.contains("name=\"manual_intake\"\r\n\r\ntrue"));
                assert!(body.contains("gmed-scan: folder import"));
                MockReply::json(json!({ "ok": true, "id": format!("doc-{}", request.seen) }))
            }
        });
        let gmed = signed_in(&server, "watch-gmed");
        let dir = temp_dir("watch");
        fs::write(dir.join("img20260831_19351529.pdf"), b"%PDF-1.7 scan").unwrap();
        fs::write(dir.join("broken.pdf"), b"not a pdf").unwrap();
        fs::write(dir.join("notes.txt"), b"ignored").unwrap();
        fs::write(dir.join(".hidden.pdf"), b"%PDF-1.7 ignored").unwrap();

        let mut lines = Vec::new();
        let summary = run(&gmed, &options(&dir, AfterUpload::Move), |line| {
            lines.push(line.to_string())
        })
        .unwrap();
        assert_eq!(
            summary,
            WatchSummary {
                uploaded: 1,
                rejected: 1,
                pending: 0
            }
        );
        assert!(
            dir.join(UPLOADED_DIR)
                .join("img20260831_19351529.pdf")
                .exists()
        );
        assert!(dir.join(FAILED_DIR).join("broken.pdf").exists());
        let reason = fs::read_to_string(dir.join(FAILED_DIR).join("broken.pdf.error.txt")).unwrap();
        assert!(reason.contains("does not match"), "{reason}");
        assert!(dir.join("notes.txt").exists());
        assert!(dir.join(".hidden.pdf").exists());
        assert_eq!(server.requests().len(), 2);
        assert_eq!(lines.len(), 2, "{lines:?}");
    }

    #[test]
    fn deletes_after_upload_and_keeps_files_on_transient_errors() {
        let server = MockServer::start(|request| {
            let body = String::from_utf8_lossy(&request.body);
            if body.contains("filename=\"later.pdf\"") {
                MockReply::status(502)
            } else {
                MockReply::json(json!({ "ok": true, "id": "doc-1" }))
            }
        });
        let gmed = signed_in(&server, "watch-delete-gmed");
        let dir = temp_dir("watch-delete");
        fs::write(dir.join("now.pdf"), b"%PDF-1.7 a").unwrap();
        fs::write(dir.join("later.pdf"), b"%PDF-1.7 b").unwrap();
        let summary = run(&gmed, &options(&dir, AfterUpload::Delete), |_| {}).unwrap();
        assert_eq!(
            summary,
            WatchSummary {
                uploaded: 1,
                rejected: 0,
                pending: 1
            }
        );
        assert!(!dir.join("now.pdf").exists());
        assert!(dir.join("later.pdf").exists(), "kept for the next attempt");
        assert!(!dir.join(UPLOADED_DIR).exists());
    }

    #[test]
    fn oversized_files_are_refused_before_reading() {
        let server = MockServer::start(|_| MockReply::status(500));
        let gmed = signed_in(&server, "watch-oversized-gmed");
        let path = temp_dir("watch-oversized").join("huge.pdf");
        fs::File::create(&path)
            .unwrap()
            .set_len(MAX_UPLOAD_BYTES as u64 + 1)
            .unwrap();
        let error = upload_file(&gmed, &path, None, None).unwrap_err();
        assert!(
            error
                .downcast_ref::<ApiError>()
                .is_some_and(ApiError::rejects_file),
            "{error}"
        );
        assert!(server.requests().is_empty());
    }

    #[test]
    fn backoff_grows_and_is_capped() {
        let interval = Duration::from_secs(3);
        assert_eq!(backoff(interval, 1), Duration::from_secs(6));
        assert_eq!(backoff(interval, 3), Duration::from_secs(24));
        assert_eq!(backoff(interval, 30), MAX_BACKOFF);
    }
}
