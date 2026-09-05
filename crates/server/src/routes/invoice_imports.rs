use axum::{
    Json, Router,
    body::to_bytes,
    extract::{Extension, Request},
    http::{StatusCode, header},
    response::{IntoResponse, Response},
    routing::post,
};
use gmed_domain::role::Role;
use serde_json::{Value, json};
use std::{sync::OnceLock, time::Duration};
use tokio::sync::Semaphore;

use crate::{auth::middleware::AuthUser, state::AppState};

const MAX_FILE_BYTES: usize = 25 * 1024 * 1024;
const MAX_RESPONSE_BYTES: usize = 4 * 1024 * 1024;
static PARSE_SLOTS: OnceLock<Semaphore> = OnceLock::new();

pub fn router() -> Router<AppState> {
    Router::new().route("/invoices/import-preview", post(parse_invoice))
}

fn error(status: StatusCode, code: &str) -> Response {
    (status, Json(json!({"error": code, "message": code}))).into_response()
}

fn supported_signature(mime: &str, bytes: &[u8]) -> bool {
    match mime {
        "application/pdf" => bytes.starts_with(b"%PDF-"),
        "image/png" => bytes.starts_with(b"\x89PNG\r\n\x1a\n"),
        "image/jpeg" => bytes.starts_with(b"\xff\xd8\xff"),
        "application/xml" | "text/xml" => std::str::from_utf8(bytes).is_ok_and(|text| {
            text.trim_start_matches('\u{feff}')
                .trim_start()
                .starts_with('<')
        }),
        _ => false,
    }
}

async fn parse_invoice(Extension(auth): Extension<AuthUser>, request: Request) -> Response {
    if let Err(response) = auth.require_any_role(&[Role::PatientManager, Role::Billing, Role::Ceo])
    {
        return response;
    }
    let Ok(_permit) = PARSE_SLOTS.get_or_init(|| Semaphore::new(2)).try_acquire() else {
        return error(StatusCode::TOO_MANY_REQUESTS, "invoice_parser_busy");
    };
    let Ok(url) = std::env::var("INVOICE_PARSER_URL") else {
        return error(
            StatusCode::SERVICE_UNAVAILABLE,
            "invoice_parser_unavailable",
        );
    };
    let key = std::env::var("INVOICE_PARSER_API_KEY").unwrap_or_default();
    if key.len() < 32 {
        return error(
            StatusCode::SERVICE_UNAVAILABLE,
            "invoice_parser_unavailable",
        );
    }
    let mime = request
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default()
        .split(';')
        .next()
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase();
    if !matches!(
        mime.as_str(),
        "application/pdf" | "image/png" | "image/jpeg" | "application/xml" | "text/xml"
    ) {
        return error(
            StatusCode::UNSUPPORTED_MEDIA_TYPE,
            "invoice_file_type_unsupported",
        );
    }
    let maximum = if matches!(mime.as_str(), "application/xml" | "text/xml") {
        5 * 1024 * 1024
    } else {
        MAX_FILE_BYTES
    };
    let data = match tokio::time::timeout(
        Duration::from_secs(30),
        to_bytes(request.into_body(), maximum),
    )
    .await
    {
        Ok(Ok(data)) => data,
        Ok(Err(_)) => return error(StatusCode::PAYLOAD_TOO_LARGE, "invoice_file_too_large"),
        Err(_) => return error(StatusCode::REQUEST_TIMEOUT, "invoice_upload_timeout"),
    };
    if !supported_signature(&mime, &data) {
        return error(
            StatusCode::UNSUPPORTED_MEDIA_TYPE,
            "invoice_file_type_unsupported",
        );
    }
    match proxy_invoice(&url, &key, &mime, data.to_vec()).await {
        Ok(payload) => ([(header::CACHE_CONTROL, "no-store")], Json(payload)).into_response(),
        Err(response) => response,
    }
}

// Invoice XML is the only exception to the shared active-document upload ban.
// Re-validate the exact bytes server-side before storing them as a binary
// download. Preview state supplied by the browser is never trusted here.
pub(crate) async fn validate_xml_invoice_source(data: &[u8]) -> Result<(), Response> {
    if data.len() > 5 * 1024 * 1024 || !supported_signature("application/xml", data) {
        return Err(error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "invalid_invoice_xml",
        ));
    }
    let Ok(_permit) = PARSE_SLOTS.get_or_init(|| Semaphore::new(2)).try_acquire() else {
        return Err(error(StatusCode::TOO_MANY_REQUESTS, "invoice_parser_busy"));
    };
    let url = std::env::var("INVOICE_PARSER_URL").unwrap_or_default();
    let key = std::env::var("INVOICE_PARSER_API_KEY").unwrap_or_default();
    if url.is_empty() || key.len() < 32 {
        return Err(error(
            StatusCode::SERVICE_UNAVAILABLE,
            "invoice_parser_unavailable",
        ));
    }
    let result = proxy_invoice(&url, &key, "application/xml", data.to_vec()).await?;
    if result["source_format"] != "xml" || result["structured"]["import_allowed"] != true {
        return Err(error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "unsupported_invoice_xml",
        ));
    }
    Ok(())
}

async fn proxy_invoice(url: &str, key: &str, mime: &str, data: Vec<u8>) -> Result<Value, Response> {
    // Configuration is server-owned; the browser never receives this credential
    // and cannot choose an OCR destination. Redirects must not forward the key.
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(5))
        .timeout(Duration::from_secs(190))
        .build()
        .map_err(|_| {
            error(
                StatusCode::SERVICE_UNAVAILABLE,
                "invoice_parser_unavailable",
            )
        })?;
    let mut response = client
        .post(format!("{}/v1/parse", url.trim_end_matches('/')))
        .bearer_auth(key)
        .header(header::CONTENT_TYPE, mime)
        .body(data)
        .send()
        .await
        .map_err(|_| {
            error(
                StatusCode::SERVICE_UNAVAILABLE,
                "invoice_parser_unavailable",
            )
        })?;
    if !response.status().is_success() {
        let (status, code) = match response.status().as_u16() {
            429 => (StatusCode::TOO_MANY_REQUESTS, "invoice_parser_busy"),
            504 => (StatusCode::GATEWAY_TIMEOUT, "invoice_parser_timeout"),
            413 => (StatusCode::PAYLOAD_TOO_LARGE, "invoice_file_too_large"),
            400 | 415 | 422 => (StatusCode::UNPROCESSABLE_ENTITY, "invoice_parse_failed"),
            _ => (
                StatusCode::SERVICE_UNAVAILABLE,
                "invoice_parser_unavailable",
            ),
        };
        return Err(error(status, code));
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| error(StatusCode::BAD_GATEWAY, "invoice_parse_failed"))?
    {
        if bytes.len() + chunk.len() > MAX_RESPONSE_BYTES {
            return Err(error(StatusCode::BAD_GATEWAY, "invoice_parse_failed"));
        }
        bytes.extend_from_slice(&chunk);
    }
    let payload: Value = serde_json::from_slice(&bytes)
        .map_err(|_| error(StatusCode::BAD_GATEWAY, "invoice_parse_failed"))?;
    if payload["schema_version"] != "1.0"
        || payload["requires_review"] != true
        || !payload["fields"].is_object()
        || !payload["warnings"].is_array()
    {
        return Err(error(StatusCode::BAD_GATEWAY, "invoice_parse_failed"));
    }
    Ok(payload)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn invoice_upload_requires_matching_binary_signature() {
        assert!(supported_signature("application/pdf", b"%PDF-1.4"));
        assert!(supported_signature("image/png", b"\x89PNG\r\n\x1a\n"));
        assert!(!supported_signature(
            "application/pdf",
            b"<html>invoice</html>"
        ));
        assert!(!supported_signature("image/svg+xml", b"<svg/>"));
        assert!(supported_signature(
            "application/xml",
            b"\xef\xbb\xbf  <?xml version='1.0'?><Invoice/>"
        ));
        assert!(!supported_signature("application/xml", b"\xff\xfe<\0"));
    }

    #[tokio::test]
    async fn service_errors_never_expose_document_or_credentials() {
        let app = Router::new().route(
            "/v1/parse",
            post(|| async { (StatusCode::UNAUTHORIZED, "private invoice and service key") }),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        let result = proxy_invoice(
            &format!("http://{address}"),
            "private-key",
            "application/pdf",
            b"%PDF-test".to_vec(),
        )
        .await;
        server.abort();
        let response = result.unwrap_err();
        assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
        let bytes = to_bytes(response.into_body(), 1024).await.unwrap();
        assert!(!String::from_utf8_lossy(&bytes).contains("private"));
    }
}
