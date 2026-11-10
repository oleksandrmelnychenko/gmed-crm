/// The effective extension: trailing dots and spaces do not hide it
/// (Windows drops them, so `x.hta.` opens as `x.hta`).
fn extension_from_name(file_name: Option<&str>) -> Option<String> {
    file_name
        .map(trim_name_tail)
        .and_then(|value| value.rsplit_once('.'))
        .map(|(_, ext)| ext.trim().to_ascii_lowercase())
        .filter(|ext| !ext.is_empty())
}

fn trim_name_tail(file_name: &str) -> &str {
    file_name.trim_end_matches(|c: char| c == '.' || c.is_whitespace() || c.is_control())
}

/// Executable, script, shortcut, installer, disk-image and macro-enabled
/// types: never stored, whatever the declared MIME type says.
const BLOCKED_EXTENSIONS: &[&str] = &[
    "exe", "dll", "com", "scr", "pif", "cpl", "msi", "msp", "msix", "appx", "bat", "cmd", "ps1",
    "psm1", "vbs", "vbe", "js", "jse", "mjs", "wsf", "wsh", "hta", "lnk", "url", "scf", "jar",
    "jnlp", "reg", "inf", "chm", "hlp", "iso", "img", "vhd", "vhdx", "apk", "app", "dmg", "pkg",
    "deb", "rpm", "sh", "py", "php", "pl", "rb", "docm", "dotm", "xlsm", "xltm", "xlam", "pptm",
    "potm", "ppsm", "sldm", "one",
];

/// Whether the effective extension is a blocked type: the last non-empty
/// dot-separated suffix, so `Befund.pdf.hta` and `x.HTA.` are caught (Windows
/// drops trailing dots and spaces) while `www.praxis.com.pdf` stays a PDF.
fn has_blocked_extension(file_name: Option<&str>) -> bool {
    let Some(file_name) = file_name else {
        return false;
    };
    // Only the last path component names the file.
    let base = file_name.rsplit(['/', '\\']).next().unwrap_or(file_name);
    base.split('.')
        .skip(1)
        .map(|suffix| {
            suffix
                .trim_matches(|c: char| c.is_whitespace() || c.is_control())
                .to_ascii_lowercase()
        })
        .filter(|suffix| !suffix.is_empty())
        .last()
        .is_some_and(|suffix| BLOCKED_EXTENSIONS.contains(&suffix.as_str()))
}

/// Windows PE (`MZ`), ELF, Mach-O (thin and universal) or a shell shebang.
fn is_executable_content(bytes: &[u8]) -> bool {
    if bytes.starts_with(b"MZ") || bytes.starts_with(b"\x7FELF") || bytes.starts_with(b"#!") {
        return true;
    }
    bytes.len() >= 4
        && matches!(
            [bytes[0], bytes[1], bytes[2], bytes[3]],
            [0xFE, 0xED, 0xFA, 0xCE]
                | [0xFE, 0xED, 0xFA, 0xCF]
                | [0xCE, 0xFA, 0xED, 0xFE]
                | [0xCF, 0xFA, 0xED, 0xFE]
                | [0xCA, 0xFE, 0xBA, 0xBE]
                | [0xCA, 0xFE, 0xBA, 0xBF]
                | [0xBE, 0xBA, 0xFE, 0xCA]
                | [0xBF, 0xBA, 0xFE, 0xCA]
        )
}

fn is_active_document_type(mime_type: Option<&str>, extension: Option<&str>, bytes: &[u8]) -> bool {
    let mime = mime_type.unwrap_or_default().trim().to_ascii_lowercase();
    if matches!(
        mime.split(';').next().unwrap_or_default(),
        "text/html"
            | "application/xhtml+xml"
            | "image/svg+xml"
            | "application/xml"
            | "text/xml"
            | "application/xslt+xml"
    ) || matches!(
        extension,
        Some("html" | "htm" | "xhtml" | "svg" | "xml" | "xsl" | "xslt")
    ) {
        return true;
    }

    let prefix = String::from_utf8_lossy(&bytes[..bytes.len().min(2048)]);
    let normalized = prefix
        .trim_start_matches('\u{feff}')
        .trim_start()
        .to_ascii_lowercase();
    normalized.starts_with("<!doctype html")
        || normalized.starts_with("<html")
        || normalized.starts_with("<svg")
        || normalized.starts_with("<?xml")
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
        // The stored type comes from the extension and a fixed list only: the
        // declared MIME type is the uploader's claim and is never echoed.
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

fn canonical_passive_mime(declared_mime: Option<&str>) -> Option<String> {
    let mime = declared_mime
        .unwrap_or_default()
        .split(';')
        .next()
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase();
    matches!(
        mime.as_str(),
        "text/plain" | "text/csv" | "application/json"
    )
    .then_some(mime)
}

/// Whether the content starts like a program: a Windows executable (`MZ`
/// header, which always carries zero bytes), an ELF binary or a script with
/// a shebang line.
fn looks_executable(bytes: &[u8]) -> bool {
    let head = &bytes[..bytes.len().min(64)];
    (head.starts_with(b"MZ") && head.contains(&0))
        || head.starts_with(b"\x7fELF")
        || head.starts_with(b"#!")
}

/// Whether a patient may send this file through the portal. The portal takes
/// documents only — the same types as a chat attachment
/// (`routes::messages::e2e_attachment_mime_type`,
/// `frontend/src/pages/chat/model/attachments.ts`) — and never a program,
/// whatever its name says.
pub fn is_portal_upload_type(file_name: Option<&str>, bytes: &[u8]) -> bool {
    matches!(
        extension_from_name(file_name).as_deref(),
        Some(
            "pdf"
                | "png"
                | "jpg"
                | "jpeg"
                | "gif"
                | "webp"
                | "heic"
                | "heif"
                | "txt"
                | "csv"
                | "doc"
                | "docx"
                | "xls"
                | "xlsx"
                | "dcm"
        )
    ) && !looks_executable(bytes)
}

pub fn validate_upload_magic_bytes(
    file_name: Option<&str>,
    declared_mime: Option<&str>,
    bytes: &[u8],
) -> Result<Option<String>, &'static str> {
    let extension = extension_from_name(file_name);
    if is_active_document_type(declared_mime, extension.as_deref(), bytes) {
        return Err("Active HTML, SVG, and XML document formats are not accepted");
    }
    if has_blocked_extension(file_name) || is_executable_content(bytes) {
        return Err(
            "Executable, script, installer, and macro-enabled file formats are not accepted",
        );
    }
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
        _ => Ok(Some(
            canonical_passive_mime(declared_mime)
                .unwrap_or_else(|| "application/octet-stream".to_string()),
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::{is_portal_upload_type, validate_upload_magic_bytes};

    #[test]
    fn portal_takes_documents_and_no_programs() {
        for name in [
            "befund.pdf",
            "Reisepass.JPG",
            "scan.heic",
            "labor.xlsx",
            "brief.docx",
            "notiz.txt",
            "mrt.dcm",
        ] {
            assert!(is_portal_upload_type(Some(name), b"content"), "{name}");
        }
        for name in [
            "qa-b-test.exe",
            "qa-b-second.bat.exe",
            "qa-b-script.sh",
            "setup.msi",
            "page.html",
            "archive.zip",
            "no-extension",
        ] {
            assert!(!is_portal_upload_type(Some(name), b"content"), "{name}");
        }
        assert!(!is_portal_upload_type(None, b"content"));
        // A program under a document name.
        assert!(!is_portal_upload_type(
            Some("befund.txt"),
            b"MZ\x90\x00\x03\x00\x00\x00"
        ));
        assert!(!is_portal_upload_type(
            Some("befund.txt"),
            b"\x7fELF\x02\x01"
        ));
        assert!(!is_portal_upload_type(
            Some("befund.txt"),
            b"#!/bin/sh\nrm -rf /"
        ));
        // A text that merely starts with the letters MZ stays a text.
        assert!(is_portal_upload_type(
            Some("befund.txt"),
            b"MZ-Befund vom 10.11.2026"
        ));
    }

    #[test]
    fn rejects_active_content_by_mime_extension_and_content() {
        for (name, mime, bytes) in [
            (Some("note.txt"), Some("text/html"), b"hello".as_slice()),
            (
                Some("image.svg"),
                Some("application/octet-stream"),
                b"data".as_slice(),
            ),
            (
                Some("note.txt"),
                Some("text/plain"),
                b"<svg onload='alert(1)'>".as_slice(),
            ),
            (
                Some("note.bin"),
                None,
                b"  <!doctype html><script>alert(1)</script>".as_slice(),
            ),
        ] {
            assert!(validate_upload_magic_bytes(name, mime, bytes).is_err());
        }
    }

    #[test]
    fn canonicalizes_unknown_content_as_binary() {
        assert_eq!(
            validate_upload_magic_bytes(
                Some("notes.unknown"),
                Some("application/x-unknown"),
                b"plain notes"
            ),
            Ok(Some("application/octet-stream".to_string()))
        );
    }

    #[test]
    fn preserves_passive_text_types() {
        assert_eq!(
            validate_upload_magic_bytes(Some("notes.txt"), Some("text/plain"), b"plain notes"),
            Ok(Some("text/plain".to_string()))
        );
    }

    #[test]
    fn preserves_supported_binary_preview_types() {
        assert_eq!(
            validate_upload_magic_bytes(Some("scan.pdf"), Some("application/pdf"), b"%PDF-1.7"),
            Ok(Some("application/pdf".to_string()))
        );
    }

    const BLOCKED: &str =
        "Executable, script, installer, and macro-enabled file formats are not accepted";

    #[test]
    fn rejects_blocked_effective_extensions() {
        for name in [
            "setup.exe",
            "Befund.pdf.hta",
            "Befund.HTA",
            "x.hta.",
            "x.hta. . ",
            "macro.docm",
            "sheet.XLSM",
            "run.ps1",
            "link.lnk",
            "disk.iso",
            "notes.one",
            ".sh",
            "dir/inner.pdf.js",
        ] {
            assert_eq!(
                validate_upload_magic_bytes(Some(name), Some("application/pdf"), b"%PDF-1.7"),
                Err(BLOCKED),
                "{name}"
            );
            assert_eq!(
                validate_upload_magic_bytes(Some(name), None, b"plain notes"),
                Err(BLOCKED),
                "{name}"
            );
        }
    }

    #[test]
    fn keeps_legitimate_names_that_only_resemble_blocked_types() {
        // A blocked word is refused as a suffix only, not inside a name.
        for name in [
            "exe",
            "shell notes.txt",
            "one-pager.txt",
            "app_report.txt",
            "www.praxis.com.txt",
            "script.py.txt",
        ] {
            assert_eq!(
                validate_upload_magic_bytes(Some(name), Some("text/plain"), b"plain notes"),
                Ok(Some("text/plain".to_string())),
                "{name}"
            );
        }
        // Types without a recognised signature stay accepted as binary.
        for name in [
            "scan.dcm",
            "photo.heic",
            "mail.eml",
            "mail.msg",
            "letter.rtf",
        ] {
            assert_eq!(
                validate_upload_magic_bytes(Some(name), None, b"\x00\x01 opaque bytes"),
                Ok(Some("application/octet-stream".to_string())),
                "{name}"
            );
        }
    }

    #[test]
    fn rejects_executable_content_whatever_the_name() {
        for bytes in [
            b"MZ\x90\x00\x03".as_slice(),
            b"\x7FELF\x02\x01".as_slice(),
            b"#!/bin/sh\nrm -rf /".as_slice(),
            b"\xFE\xED\xFA\xCE\x00".as_slice(),
            b"\xFE\xED\xFA\xCF\x00".as_slice(),
            b"\xCE\xFA\xED\xFE\x00".as_slice(),
            b"\xCF\xFA\xED\xFE\x00".as_slice(),
            b"\xCA\xFE\xBA\xBE\x00".as_slice(),
        ] {
            assert_eq!(
                validate_upload_magic_bytes(Some("report.bin"), None, bytes),
                Err(BLOCKED)
            );
            assert_eq!(
                validate_upload_magic_bytes(None, Some("text/plain"), bytes),
                Err(BLOCKED)
            );
        }
    }

    #[test]
    fn zip_content_gets_its_type_from_the_extension_only() {
        let zip = b"PK\x03\x04rest";
        for (name, mime) in [
            (
                "letter.docx",
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            ),
            (
                "table.xlsx",
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            ),
            (
                "slides.pptx",
                "application/vnd.openxmlformats-officedocument.presentationml.presentation",
            ),
            ("letter.odt", "application/vnd.oasis.opendocument.text"),
            (
                "table.ods",
                "application/vnd.oasis.opendocument.spreadsheet",
            ),
            (
                "slides.odp",
                "application/vnd.oasis.opendocument.presentation",
            ),
            ("scans.zip", "application/zip"),
            ("scans.ZIP.", "application/zip"),
        ] {
            // The declared type is never stored, whatever it claims.
            for declared in [
                None,
                Some("application/octet-stream"),
                Some("application/zip"),
                Some("application/x-msdownload"),
                Some("application/hta"),
            ] {
                assert_eq!(
                    validate_upload_magic_bytes(Some(name), declared, zip),
                    Ok(Some(mime.to_string())),
                    "{name} {declared:?}"
                );
            }
        }
        assert_eq!(
            validate_upload_magic_bytes(Some("archive.unknown"), Some("application/hta"), zip),
            Ok(Some("application/zip".to_string()))
        );
        assert_eq!(
            validate_upload_magic_bytes(None, Some("text/x-anything"), zip),
            Ok(Some("application/zip".to_string()))
        );
    }

    #[test]
    fn trailing_dots_do_not_hide_the_extension() {
        assert_eq!(
            validate_upload_magic_bytes(Some("scan.pdf."), None, b"%PDF-1.7"),
            Ok(Some("application/pdf".to_string()))
        );
        assert!(validate_upload_magic_bytes(Some("scan.pdf. "), None, b"not a pdf").is_err());
    }
}
