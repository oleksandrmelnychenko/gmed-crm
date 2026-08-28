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

fn run_scan_command(path: &Path) -> Result<FileScanOutcome, String> {
    for scanner in ["clamdscan", "clamscan"] {
        match Command::new(scanner)
            .arg("--no-summary")
            .arg(path)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
        {
            Ok(mut child) => {
                let started = Instant::now();
                loop {
                    match child.try_wait() {
                        Ok(Some(status)) if status.success() => {
                            return Ok(FileScanOutcome::Clean);
                        }
                        Ok(Some(status)) if status.code() == Some(1) => {
                            return Err("File failed malware scan".to_string());
                        }
                        Ok(Some(_)) => return Err(format!("{scanner} failed to scan upload")),
                        Ok(None) if started.elapsed() < Duration::from_secs(30) => {
                            std::thread::sleep(Duration::from_millis(50));
                        }
                        Ok(None) => {
                            let _ = child.kill();
                            let _ = child.wait();
                            return Err(format!("{scanner} timed out while scanning upload"));
                        }
                        Err(error) => {
                            let _ = child.kill();
                            return Err(format!("Failed to wait for {scanner}: {error}"));
                        }
                    }
                }
            }
            Err(error) if error.kind() == io::ErrorKind::NotFound => continue,
            Err(error) => return Err(format!("Failed to launch {scanner}: {error}")),
        }
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
