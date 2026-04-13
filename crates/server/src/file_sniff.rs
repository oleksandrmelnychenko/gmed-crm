fn extension_from_name(file_name: Option<&str>) -> Option<String> {
    file_name
        .and_then(|value| value.rsplit_once('.'))
        .map(|(_, ext)| ext.trim().to_ascii_lowercase())
        .filter(|ext| !ext.is_empty())
}

fn sniff_magic_kind(bytes: &[u8]) -> Option<&'static str> {
    if bytes.len() >= 5 && &bytes[..5] == b"%PDF-" {
        return Some("pdf");
    }
    if bytes.len() >= 8 && bytes[..8] == [0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A] {
        return Some("png");
    }
    if bytes.len() >= 3 && bytes[..3] == [0xFF, 0xD8, 0xFF] {
        return Some("jpeg");
    }
    if bytes.len() >= 6 && (&bytes[..6] == b"GIF87a" || &bytes[..6] == b"GIF89a") {
        return Some("gif");
    }
    if bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        return Some("webp");
    }
    if bytes.len() >= 2 && &bytes[..2] == b"BM" {
        return Some("bmp");
    }
    if bytes.len() >= 4
        && (bytes[..4] == [b'I', b'I', 0x2A, 0x00] || bytes[..4] == [b'M', b'M', 0x00, 0x2A])
    {
        return Some("tiff");
    }
    if bytes.len() >= 4 && bytes[..4] == [b'P', b'K', 0x03, 0x04] {
        return Some("zip");
    }
    None
}

fn expected_binary_kind(mime_type: Option<&str>, extension: Option<&str>) -> Option<&'static str> {
    let mime = mime_type.unwrap_or_default().trim().to_ascii_lowercase();
    if mime == "application/pdf" || matches!(extension, Some("pdf")) {
        return Some("pdf");
    }
    if mime == "image/png" || matches!(extension, Some("png")) {
        return Some("png");
    }
    if mime == "image/jpeg" || matches!(extension, Some("jpg" | "jpeg")) {
        return Some("jpeg");
    }
    if mime == "image/gif" || matches!(extension, Some("gif")) {
        return Some("gif");
    }
    if mime == "image/webp" || matches!(extension, Some("webp")) {
        return Some("webp");
    }
    if mime == "image/bmp" || matches!(extension, Some("bmp")) {
        return Some("bmp");
    }
    if matches!(mime.as_str(), "image/tiff" | "image/tif")
        || matches!(extension, Some("tif" | "tiff"))
    {
        return Some("tiff");
    }
    if matches!(
        mime.as_str(),
        "application/zip"
            | "application/x-zip-compressed"
            | "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            | "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            | "application/vnd.openxmlformats-officedocument.presentationml.presentation"
            | "application/vnd.oasis.opendocument.text"
            | "application/vnd.oasis.opendocument.spreadsheet"
            | "application/vnd.oasis.opendocument.presentation"
    ) || matches!(
        extension,
        Some("zip" | "docx" | "xlsx" | "pptx" | "odt" | "ods" | "odp")
    ) {
        return Some("zip");
    }
    None
}

fn canonical_mime_for_kind(
    kind: &str,
    extension: Option<&str>,
    declared_mime: Option<&str>,
) -> String {
    if kind == "zip" {
        if let Some(mime) = declared_mime {
            let normalized = mime.trim().to_ascii_lowercase();
            if !normalized.is_empty() && normalized != "application/octet-stream" {
                return normalized;
            }
        }
        return match extension {
            Some("docx") => {
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                    .to_string()
            }
            Some("xlsx") => {
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet".to_string()
            }
            Some("pptx") => {
                "application/vnd.openxmlformats-officedocument.presentationml.presentation"
                    .to_string()
            }
            Some("odt") => "application/vnd.oasis.opendocument.text".to_string(),
            Some("ods") => "application/vnd.oasis.opendocument.spreadsheet".to_string(),
            Some("odp") => "application/vnd.oasis.opendocument.presentation".to_string(),
            _ => "application/zip".to_string(),
        };
    }

    match kind {
        "pdf" => "application/pdf",
        "png" => "image/png",
        "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        "tiff" => "image/tiff",
        _ => declared_mime.unwrap_or("application/octet-stream"),
    }
    .to_string()
}

pub fn validate_upload_magic_bytes(
    file_name: Option<&str>,
    declared_mime: Option<&str>,
    bytes: &[u8],
) -> Result<Option<String>, &'static str> {
    let extension = extension_from_name(file_name);
    let expected_kind = expected_binary_kind(declared_mime, extension.as_deref());
    let detected_kind = sniff_magic_kind(bytes);

    match (expected_kind, detected_kind) {
        (Some(expected), Some(detected)) if expected != detected => {
            Err("Uploaded file content does not match the declared MIME type or filename extension")
        }
        (Some(_), None) => {
            Err("Uploaded file content does not match the declared MIME type or filename extension")
        }
        (_, Some(detected)) => Ok(Some(canonical_mime_for_kind(
            detected,
            extension.as_deref(),
            declared_mime,
        ))),
        _ => Ok(None),
    }
}
