use std::{
    io,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    time::{Duration, Instant},
};

use uuid::Uuid;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FileScanOutcome {
    Clean,
    Skipped,
}

fn scanner_required() -> bool {
    std::env::var("GMED_UPLOAD_SCANNER_REQUIRED")
        .ok()
        .is_some_and(|value| {
            matches!(
                value.trim().to_ascii_lowercase().as_str(),
                "1" | "true" | "yes" | "on"
            )
        })
}

pub fn ensure_upload_scanner_ready() -> Result<(), String> {
    if !scanner_required() {
        return Ok(());
    }
    let probe_path = std::env::temp_dir()
        .join("gmed-upload-scan")
        .join(format!("{}_readiness.txt", Uuid::new_v4()));
    if let Some(parent) = probe_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|error| format!("Failed to prepare scanner readiness probe: {error}"))?;
    }
    std::fs::write(&probe_path, b"GMED malware scanner readiness probe")
        .map_err(|error| format!("Failed to write scanner readiness probe: {error}"))?;
    let result = run_scan_command(&probe_path);
    let _ = std::fs::remove_file(&probe_path);
    match result {
        Ok(FileScanOutcome::Clean) => Ok(()),
        Ok(FileScanOutcome::Skipped) => Err("Malware scanner readiness probe was skipped".into()),
        Err(error) => Err(format!("Malware scanner readiness probe failed: {error}")),
    }
}

pub async fn scan_upload_bytes(
    original_filename: Option<&str>,
    bytes: &[u8],
) -> Result<FileScanOutcome, String> {
    let temp_path = build_temp_scan_path(original_filename);
    if let Some(parent) = temp_path.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| format!("Failed to prepare virus scan directory: {e}"))?;
    }

    tokio::fs::write(&temp_path, bytes)
        .await
        .map_err(|e| format!("Failed to stage upload for virus scan: {e}"))?;

    let temp_path_for_scan = temp_path.clone();
    let scan_result = tokio::task::spawn_blocking(move || run_scan_command(&temp_path_for_scan))
        .await
        .map_err(|e| format!("Virus scan task failed: {e}"))?;

    let _ = tokio::fs::remove_file(&temp_path).await;

    scan_result
}

fn build_temp_scan_path(original_filename: Option<&str>) -> PathBuf {
    let safe_name = original_filename
        .map(sanitize_filename)
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "upload.bin".to_string());

    std::env::temp_dir()
        .join("gmed-upload-scan")
        .join(format!("{}_{}", Uuid::new_v4(), safe_name))
}

fn sanitize_filename(value: &str) -> String {
    value
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_') {
                c
            } else {
                '_'
            }
        })
        .collect()
}

/// What one scanner run established. A verdict is final; `Unavailable` means the
/// scanner could not judge the file at all, so another scanner may still try.
enum ScanAttempt {
    Verdict(Result<FileScanOutcome, String>),
    Unavailable(String),
    Missing,
}

fn run_scanner(scanner: &str, arguments: &[&str], path: &Path) -> ScanAttempt {
    let mut child = match Command::new(scanner)
        .args(arguments)
        .arg(path)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
    {
        Ok(child) => child,
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            return ScanAttempt::Missing;
        }
        Err(error) => {
            return ScanAttempt::Verdict(Err(format!("Failed to launch {scanner}: {error}")));
        }
    };
    let started = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(status)) if status.success() => {
                return ScanAttempt::Verdict(Ok(FileScanOutcome::Clean));
            }
            Ok(Some(status)) if status.code() == Some(1) => {
                return ScanAttempt::Verdict(Err("File failed malware scan".to_string()));
            }
            // Exit code 2 and above: the scanner itself failed, e.g. the daemon is down.
            Ok(Some(_)) => {
                return ScanAttempt::Unavailable(format!("{scanner} failed to scan upload"));
            }
            Ok(None) if started.elapsed() < Duration::from_secs(30) => {
                std::thread::sleep(Duration::from_millis(50));
            }
            Ok(None) => {
                let _ = child.kill();
                let _ = child.wait();
                return ScanAttempt::Unavailable(format!(
                    "{scanner} timed out while scanning upload"
                ));
            }
            Err(error) => {
                let _ = child.kill();
                return ScanAttempt::Verdict(Err(format!("Failed to wait for {scanner}: {error}")));
            }
        }
    }
}

/// `host:port` of a clamd daemon, from `GMED_CLAMD_ADDRESS`. The daemon keeps the
/// signature database in memory, so a scan takes milliseconds; a standalone
/// clamscan loads about a gigabyte of signatures on every single run.
fn clamd_address() -> Option<(String, u16)> {
    let value = std::env::var("GMED_CLAMD_ADDRESS").ok()?;
    let (host, port) = value.trim().rsplit_once(':')?;
    let port = port.parse::<u16>().ok()?;
    // The value ends up in a clamd configuration file: accept a plain host name only.
    let plain_host = !host.is_empty()
        && host
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-'));
    plain_host.then(|| (host.to_string(), port))
}

/// clamdscan takes the daemon's address from a configuration file only.
fn clamd_config_path() -> Option<PathBuf> {
    static CONFIG: std::sync::OnceLock<Option<PathBuf>> = std::sync::OnceLock::new();
    CONFIG
        .get_or_init(|| {
            let (host, port) = clamd_address()?;
            let directory = std::env::temp_dir().join("gmed-upload-scan");
            std::fs::create_dir_all(&directory).ok()?;
            let path = directory.join("clamd-client.conf");
            std::fs::write(&path, format!("TCPSocket {port}\nTCPAddr {host}\n")).ok()?;
            Some(path)
        })
        .clone()
}

fn run_scan_command(path: &Path) -> Result<FileScanOutcome, String> {
    if let Some(config) = clamd_config_path() {
        // The daemon runs elsewhere and cannot read this file: stream it.
        let config_argument = format!("--config-file={}", config.display());
        match run_scanner(
            "clamdscan",
            &["--no-summary", "--stream", &config_argument],
            path,
        ) {
            ScanAttempt::Verdict(verdict) => return verdict,
            ScanAttempt::Unavailable(reason) => {
                tracing::warn!(reason = %reason, "clamd is unavailable; falling back to clamscan");
            }
            ScanAttempt::Missing => {
                tracing::warn!("clamdscan is not installed; falling back to clamscan");
            }
        }
    }

    match run_scanner("clamscan", &["--no-summary"], path) {
        ScanAttempt::Verdict(verdict) => return verdict,
        ScanAttempt::Missing => {}
        ScanAttempt::Unavailable(reason) => return Err(reason),
    }

    if scanner_required() {
        Err(
            "Malware scanner is required but neither clamdscan nor clamscan is available"
                .to_string(),
        )
    } else {
        Ok(FileScanOutcome::Skipped)
    }
}
