use std::{
    io,
    path::{Path, PathBuf},
    process::Command,
};

use uuid::Uuid;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FileScanOutcome {
    Clean,
    Skipped,
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
        match Command::new(scanner).arg("--no-summary").arg(path).output() {
            Ok(output) => {
                if output.status.success() {
                    return Ok(FileScanOutcome::Clean);
                }

                if output.status.code() == Some(1) {
                    return Err("File failed malware scan".to_string());
                }

                let stderr = String::from_utf8_lossy(&output.stderr);
                let stdout = String::from_utf8_lossy(&output.stdout);
                let details = if !stderr.trim().is_empty() {
                    stderr.trim()
                } else {
                    stdout.trim()
                };
                if details.is_empty() {
                    return Err(format!("{scanner} failed to scan upload"));
                }
                return Err(format!("{scanner} failed to scan upload: {details}"));
            }
            Err(error) if error.kind() == io::ErrorKind::NotFound => continue,
            Err(error) => return Err(format!("Failed to launch {scanner}: {error}")),
        }
    }

    Ok(FileScanOutcome::Skipped)
}
