//! Issued invoice documents are rendered once and kept (GoBD: the archive
//! holds the document as it was issued, unchanged).
//!
//! * An invoice PDF is rendered and stored inside the release transaction;
//!   every later download serves that stored copy.
//! * Invoices released before stored documents existed get their copy on the
//!   first download (`generation_trigger = 'first_download'`); it shows the
//!   invoice as recorded at that moment and is kept unchanged from then on.
//! * Dunning letters are stored with their dunning event the same way.
//! * Drafts are never stored: they render live and are marked as drafts.
//!
//! Blobs are sealed with the document key registry and live next to the other
//! uploaded documents, so the key-rotation sweep covers them. The table row
//! carries the SHA-256 of the plaintext; a blob that no longer matches is not
//! served.

use axum::http::StatusCode;
use chrono::{DateTime, Utc};
use sha2::{Digest, Sha256};
use sqlx::{PgConnection, Row};
use uuid::Uuid;

use super::err;
use crate::routes::documents::{
    read_document_storage_bytes, remove_document_blob, store_document_blob,
};

pub(super) const KIND_INVOICE: &str = "invoice";
pub(super) const KIND_DUNNING_LETTER: &str = "dunning_letter";

pub(super) const TRIGGER_RELEASE: &str = "release";
pub(super) const TRIGGER_FIRST_DOWNLOAD: &str = "first_download";
pub(super) const TRIGGER_DUNNING: &str = "dunning";

/// A stored document row.
#[derive(Clone, Debug)]
pub(super) struct StoredInvoiceDocument {
    pub id: Uuid,
    pub storage_key: String,
    pub file_name: String,
    pub sha256: String,
    pub generation_trigger: String,
    pub generated_at: DateTime<Utc>,
}

/// What is being stored.
pub(super) struct NewInvoiceDocument<'a> {
    pub invoice_id: Uuid,
    pub kind: &'static str,
    pub dunning_event_id: Option<Uuid>,
    pub file_name: &'a str,
    pub language: &'a str,
    pub trigger: &'static str,
    pub generated_by: Option<Uuid>,
}

/// A sealed blob written to disk whose row is not committed yet. Call
/// [`PendingBlob::discard`] when the transaction does not commit.
pub(super) struct PendingBlob {
    pub storage_key: String,
    pub file_size: i64,
    pub sha256: String,
}

impl PendingBlob {
    pub async fn discard(self) {
        remove_document_blob(&self.storage_key).await;
    }
}

pub(super) fn sha256_hex(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

/// Seals and writes the PDF next to the uploaded documents.
pub(super) async fn write_blob(
    bytes: &[u8],
    file_name: &str,
) -> Result<PendingBlob, axum::response::Response> {
    let (file_size, storage_key, _) = store_document_blob(bytes, file_name).await?;
    Ok(PendingBlob {
        storage_key,
        file_size,
        sha256: sha256_hex(bytes),
    })
}

/// Records a written blob. Returns `None` when a document of the same kind
/// already exists for the invoice or dunning event (a concurrent first
/// download won); the caller then discards its blob.
pub(super) async fn insert_row(
    conn: &mut PgConnection,
    document: &NewInvoiceDocument<'_>,
    blob: &PendingBlob,
) -> Result<Option<Uuid>, sqlx::Error> {
    sqlx::query_scalar::<_, Uuid>(
        r#"INSERT INTO invoice_documents (
                invoice_id, document_kind, dunning_event_id, storage_key, file_name,
                file_size, sha256, document_language, generation_trigger, generated_by
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           ON CONFLICT DO NOTHING
           RETURNING id"#,
    )
    .bind(document.invoice_id)
    .bind(document.kind)
    .bind(document.dunning_event_id)
    .bind(&blob.storage_key)
    .bind(document.file_name)
    .bind(blob.file_size)
    .bind(&blob.sha256)
    .bind(document.language)
    .bind(document.trigger)
    .bind(document.generated_by)
    .fetch_optional(conn)
    .await
}

/// The stored invoice PDF, or the stored letter of one dunning event.
pub(super) async fn load(
    conn: &mut PgConnection,
    invoice_id: Uuid,
    dunning_event_id: Option<Uuid>,
) -> Result<Option<StoredInvoiceDocument>, sqlx::Error> {
    let row = sqlx::query(
        r#"SELECT id, storage_key, file_name, sha256, generation_trigger, generated_at
           FROM invoice_documents
           WHERE invoice_id = $1
             AND (
                   ($2::uuid IS NULL AND document_kind = 'invoice')
                   OR dunning_event_id = $2
             )"#,
    )
    .bind(invoice_id)
    .bind(dunning_event_id)
    .fetch_optional(conn)
    .await?;
    Ok(row.map(|row| StoredInvoiceDocument {
        id: row.try_get("id").unwrap_or_default(),
        storage_key: row.try_get("storage_key").unwrap_or_default(),
        file_name: row.try_get("file_name").unwrap_or_default(),
        sha256: row.try_get("sha256").unwrap_or_default(),
        generation_trigger: row.try_get("generation_trigger").unwrap_or_default(),
        generated_at: row.try_get("generated_at").unwrap_or_else(|_| Utc::now()),
    }))
}

/// Reads and verifies a stored document.
pub(super) async fn read_bytes(
    document: &StoredInvoiceDocument,
) -> Result<Vec<u8>, axum::response::Response> {
    let bytes = read_document_storage_bytes(
        document.id,
        &document.storage_key,
        Some("application/pdf"),
        Some(&document.file_name),
        None,
    )
    .await
    .map_err(|error| {
        tracing::error!(%error, document_id = %document.id, "read stored invoice document");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Stored invoice document is not available",
        )
    })?;
    if sha256_hex(&bytes) != document.sha256 {
        tracing::error!(document_id = %document.id, "stored invoice document fails its checksum");
        return Err(err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Stored invoice document fails its integrity check",
        ));
    }
    Ok(bytes)
}

/// Renders the issued invoice and writes its blob and row through the
/// caller's connection (the release transaction, or a pool connection on a
/// first download). Returns the PDF, and the blob when this call stored it;
/// `None` means another request stored the document first.
pub(super) async fn store_invoice_pdf(
    conn: &mut PgConnection,
    invoice_id: Uuid,
    trigger: &'static str,
    generated_by: Option<Uuid>,
) -> Result<(Vec<u8>, String, Option<PendingBlob>), axum::response::Response> {
    let failed = |error: sqlx::Error| {
        tracing::error!(%error, %invoice_id, "store invoice document");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to store the invoice document",
        )
    };
    let Some(context) = super::load_invoice_pdf_context_on(conn, invoice_id)
        .await
        .map_err(failed)?
    else {
        return Err(err(StatusCode::NOT_FOUND, "Invoice not found"));
    };
    if !context.released {
        return Err(err(
            StatusCode::CONFLICT,
            "Only released invoices are stored",
        ));
    }
    let bytes = super::render_invoice_pdf_on(conn, &context)
        .await
        .map_err(|message| err(StatusCode::INTERNAL_SERVER_ERROR, message))?;
    let file_name = super::invoice_pdf_filename(&context);
    let blob = write_blob(&bytes, &file_name).await?;
    let inserted = insert_row(
        conn,
        &NewInvoiceDocument {
            invoice_id,
            kind: KIND_INVOICE,
            dunning_event_id: None,
            file_name: &file_name,
            language: &context.language,
            trigger,
            generated_by,
        },
        &blob,
    )
    .await;
    match inserted {
        Ok(Some(_)) => Ok((bytes, file_name, Some(blob))),
        Ok(None) => {
            blob.discard().await;
            Ok((bytes, file_name, None))
        }
        Err(error) => {
            blob.discard().await;
            Err(failed(error))
        }
    }
}

/// Where a served invoice PDF came from.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum InvoicePdfSource {
    /// The document stored at release (or at its first download).
    Stored,
    /// Stored just now: the invoice was released before documents were kept.
    StoredOnFirstDownload,
}

impl InvoicePdfSource {
    pub fn header_value(self) -> &'static str {
        match self {
            Self::Stored => "stored",
            Self::StoredOnFirstDownload => "stored-on-first-download",
        }
    }
}

/// The archived PDF of a released invoice. An invoice released before
/// documents were stored gets its copy now; a concurrent first download
/// that stored first wins and is served.
pub(super) async fn released_invoice_pdf(
    conn: &mut PgConnection,
    invoice_id: Uuid,
    actor: Uuid,
) -> Result<(Vec<u8>, String, InvoicePdfSource), axum::response::Response> {
    let failed = |error: sqlx::Error| {
        tracing::error!(%error, %invoice_id, "load stored invoice document");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to load the invoice document",
        )
    };
    if let Some(document) = load(conn, invoice_id, None).await.map_err(failed)? {
        let bytes = read_bytes(&document).await?;
        return Ok((bytes, document.file_name, InvoicePdfSource::Stored));
    }
    let (bytes, file_name, blob) =
        store_invoice_pdf(conn, invoice_id, TRIGGER_FIRST_DOWNLOAD, Some(actor)).await?;
    if blob.is_some() {
        return Ok((bytes, file_name, InvoicePdfSource::StoredOnFirstDownload));
    }
    let document = load(conn, invoice_id, None)
        .await
        .map_err(failed)?
        .ok_or_else(|| {
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to load the invoice document",
            )
        })?;
    let bytes = read_bytes(&document).await?;
    Ok((bytes, document.file_name, InvoicePdfSource::Stored))
}

#[cfg(test)]
mod tests {
    use super::sha256_hex;

    #[test]
    fn checksum_is_lowercase_hex_sha256() {
        assert_eq!(
            sha256_hex(b""),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
        assert_ne!(sha256_hex(b"%PDF-1.7"), sha256_hex(b"%PDF-1.6"));
    }
}
