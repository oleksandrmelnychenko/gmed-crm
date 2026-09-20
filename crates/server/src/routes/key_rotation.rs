//! Message encryption key rotation: status + rewrap.
//!
//! Operator workflow:
//!   1. Generate a new key, add it to MESSAGE_ENCRYPTION_KEYS, set
//!      MESSAGE_ENCRYPTION_KEY_ACTIVE to the new id, restart.
//!   2. New writes are sealed with the new id automatically.
//!   3. Call POST /admin/security/key-rotation/rewrap repeatedly (or wait for
//!      the periodic background sweep) until status reports 100% on the
//!      active id and 0 on every other id.
//!   4. Remove the old key from MESSAGE_ENCRYPTION_KEYS, restart again.

use axum::{
    Json, Router,
    extract::{Extension, Query, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
};
use serde::Deserialize;
use sqlx::{PgPool, Row};

use crate::auth::middleware::AuthUser;
use crate::crypto::{KeyRegistry, LEGACY_KEY_ID};
use crate::state::AppState;
use gmed_domain::access::capabilities::Capability;

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/admin/security/key-rotation/status",
            get(key_rotation_status),
        )
        .route(
            "/admin/security/key-rotation/rewrap",
            post(rewrap_messages_handler),
        )
}

#[derive(Deserialize)]
struct RewrapQuery {
    /// How many rows to process in a single call (default 500, max 5000).
    #[serde(default)]
    batch_size: Option<i64>,
}

async fn key_rotation_status(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
) -> axum::response::Response {
    if let Err(e) = auth.require_capability(Capability::AdminSecurity) {
        return e;
    }

    match collect_key_distribution(&state.db, &state.message_keys).await {
        Ok(payload) => Json(payload).into_response(),
        Err(e) => {
            tracing::error!(error = %e, "key rotation status");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to load key rotation status",
            )
        }
    }
}

async fn rewrap_messages_handler(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Query(q): Query<RewrapQuery>,
) -> axum::response::Response {
    if let Err(e) = auth.require_capability(Capability::AdminSecurity) {
        return e;
    }

    let batch = q.batch_size.unwrap_or(500).clamp(1, 5_000);
    match rewrap_messages(&state.db, &state.message_keys, batch).await {
        Ok(report) => Json(report).into_response(),
        Err(RewrapError::Sql(e)) => {
            tracing::error!(error = %e, "rewrap sql");
            err(StatusCode::INTERNAL_SERVER_ERROR, "Database error")
        }
        Err(RewrapError::Decrypt(id)) => {
            tracing::error!(message_id = %id, "rewrap decrypt failed");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to decrypt a row during rewrap",
            )
        }
        Err(RewrapError::Encrypt) => {
            tracing::error!("rewrap encrypt failed");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to encrypt during rewrap",
            )
        }
    }
}

#[derive(Debug)]
pub enum RewrapError {
    Sql(sqlx::Error),
    Decrypt(uuid::Uuid),
    Encrypt,
}

impl From<sqlx::Error> for RewrapError {
    fn from(e: sqlx::Error) -> Self {
        RewrapError::Sql(e)
    }
}

#[derive(serde::Serialize)]
pub struct RewrapReport {
    pub active_key_id: String,
    pub batch_size: i64,
    pub messages_rewrapped: u64,
    pub attachments_rewrapped: u64,
    pub remaining_old_rows: i64,
}

/// Re-encrypts up to `batch_size` rows that are sealed with a non-active key.
///
/// The sweep is idempotent: at-most-batch_size rows per call, deterministic
/// `ORDER BY created_at`. A crash mid-batch leaves a mix of old and new rows
/// — the next call picks up from where it left off because it filters by
/// `encryption_key_id <> active`.
pub async fn rewrap_messages(
    pool: &PgPool,
    registry: &KeyRegistry,
    batch_size: i64,
) -> Result<RewrapReport, RewrapError> {
    let active = registry.active_id().to_string();

    // Pick rows that have any encrypted payload but are not on the active key.
    let rows = sqlx::query(
        r#"SELECT id, message_ciphertext, message_nonce,
                  attachment_key, attachment_nonce, encryption_key_id
           FROM direct_messages
           WHERE encryption_key_id IS NOT NULL
             AND encryption_key_id <> $1
             AND (message_ciphertext IS NOT NULL OR attachment_nonce IS NOT NULL)
             AND redacted_at IS NULL
           ORDER BY created_at
           LIMIT $2
           FOR UPDATE SKIP LOCKED"#,
    )
    .bind(&active)
    .bind(batch_size)
    .fetch_all(pool)
    .await?;

    let mut messages_rewrapped: u64 = 0;
    let mut attachments_rewrapped: u64 = 0;

    for row in rows {
        let id: uuid::Uuid = row.try_get("id").unwrap_or_else(|_| uuid::Uuid::nil());
        let old_key_id: String = row
            .try_get::<Option<String>, _>("encryption_key_id")
            .ok()
            .flatten()
            .unwrap_or_else(|| LEGACY_KEY_ID.to_string());

        // Re-encrypt the optional message body.
        let old_ct: Option<Vec<u8>> = row.try_get("message_ciphertext").ok();
        let old_nonce: Option<Vec<u8>> = row.try_get("message_nonce").ok();
        let new_msg = match (old_ct.as_deref(), old_nonce.as_deref()) {
            (Some(ct), Some(nonce)) if !ct.is_empty() => {
                let pt = registry
                    .decrypt(&old_key_id, ct, nonce)
                    .map_err(|_| RewrapError::Decrypt(id))?;
                let (new_ct, new_nonce, _) =
                    registry.encrypt(&pt).map_err(|_| RewrapError::Encrypt)?;
                Some((new_ct, new_nonce))
            }
            _ => None,
        };

        // Re-encrypt the attachment file body, if any.
        let attachment_key: Option<String> = row.try_get("attachment_key").ok().flatten();
        let attachment_nonce: Option<Vec<u8>> = row.try_get("attachment_nonce").ok().flatten();
        let new_attachment_nonce: Option<Vec<u8>> = match (&attachment_key, &attachment_nonce) {
            (Some(file_key), Some(old_n)) => {
                let path = std::path::Path::new(super::messages::CHAT_UPLOAD_DIR).join(file_key);
                match tokio::fs::read(&path).await {
                    Ok(old_bytes) => {
                        let pt = registry
                            .decrypt(&old_key_id, &old_bytes, old_n)
                            .map_err(|_| RewrapError::Decrypt(id))?;
                        let (new_bytes, new_n, _) =
                            registry.encrypt(&pt).map_err(|_| RewrapError::Encrypt)?;
                        if let Err(e) = tokio::fs::write(&path, &new_bytes).await {
                            tracing::error!(error = %e, file_key = %file_key, "rewrap write file");
                            return Err(RewrapError::Sql(sqlx::Error::Protocol(format!(
                                "fs write failed during rewrap: {e}"
                            ))));
                        }
                        attachments_rewrapped += 1;
                        Some(new_n)
                    }
                    Err(e) => {
                        // File missing — skip but log; row stays on old key id.
                        tracing::warn!(
                            error = %e,
                            file_key = %file_key,
                            message_id = %id,
                            "rewrap: attachment file missing, skipping"
                        );
                        continue;
                    }
                }
            }
            _ => None,
        };

        // Persist the new ciphertexts under the new key id in a single UPDATE.
        let (new_msg_ct, new_msg_nonce) = match new_msg {
            Some((ct, nonce)) => (Some(ct), Some(nonce)),
            None => (None, None),
        };

        sqlx::query(
            r#"UPDATE direct_messages
               SET message_ciphertext = COALESCE($1, message_ciphertext),
                   message_nonce = COALESCE($2, message_nonce),
                   attachment_nonce = COALESCE($3, attachment_nonce),
                   encryption_key_id = $4
               WHERE id = $5"#,
        )
        .bind(new_msg_ct.as_deref())
        .bind(new_msg_nonce.as_deref())
        .bind(new_attachment_nonce.as_deref())
        .bind(&active)
        .bind(id)
        .execute(pool)
        .await?;

        messages_rewrapped += 1;
    }

    let remaining_old_rows: i64 = sqlx::query_scalar::<_, i64>(
        r#"SELECT COUNT(*) FROM direct_messages
           WHERE encryption_key_id IS NOT NULL
             AND encryption_key_id <> $1
             AND (message_ciphertext IS NOT NULL OR attachment_nonce IS NOT NULL)
             AND redacted_at IS NULL"#,
    )
    .bind(&active)
    .fetch_one(pool)
    .await?;

    Ok(RewrapReport {
        active_key_id: active,
        batch_size,
        messages_rewrapped,
        attachments_rewrapped,
        remaining_old_rows,
    })
}

/// Returns per-key-id counts so an operator can monitor rotation progress.
pub async fn collect_key_distribution(
    pool: &PgPool,
    registry: &KeyRegistry,
) -> Result<serde_json::Value, sqlx::Error> {
    let rows = sqlx::query(
        r#"SELECT encryption_key_id AS key_id, COUNT(*)::BIGINT AS row_count
           FROM direct_messages
           WHERE encryption_key_id IS NOT NULL AND redacted_at IS NULL
           GROUP BY encryption_key_id
           ORDER BY encryption_key_id"#,
    )
    .fetch_all(pool)
    .await?;

    let mut buckets = serde_json::Map::new();
    for r in rows {
        let key_id: String = r
            .try_get::<Option<String>, _>("key_id")
            .ok()
            .flatten()
            .unwrap_or_else(|| "unknown".to_string());
        let count: i64 = r.try_get::<i64, _>("row_count").unwrap_or(0);
        buckets.insert(key_id, serde_json::Value::from(count));
    }

    Ok(serde_json::json!({
        "active_key_id": registry.active_id(),
        "known_key_ids": registry.known_ids(),
        "row_counts": buckets,
    }))
}

fn err(code: StatusCode, message: &str) -> axum::response::Response {
    (code, Json(serde_json::json!({ "error": message }))).into_response()
}

#[derive(Debug, Default)]
pub struct DocumentRewrapReport {
    pub sealed_plaintext: u64,
    pub rewrapped: u64,
    pub failed: u64,
    pub scanned: u64,
}

/// Walks the document store and seals up to `limit` files that are still
/// plaintext or sit on a retired key. Each file is rewritten through a
/// temporary sibling and renamed, so a crash leaves either the old or the new
/// file, never a torn one.
pub async fn rewrap_document_files(
    registry: &KeyRegistry,
    dir: &std::path::Path,
    limit: usize,
) -> Result<DocumentRewrapReport, std::io::Error> {
    use crate::crypto::BlobState;
    use tokio::io::AsyncReadExt;

    let mut report = DocumentRewrapReport::default();
    let mut entries = match tokio::fs::read_dir(dir).await {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(report),
        Err(error) => return Err(error),
    };
    let mut touched = 0usize;
    while let Some(entry) = entries.next_entry().await? {
        if touched >= limit {
            break;
        }
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.ends_with(".rewrap.tmp") || !entry.file_type().await?.is_file() {
            continue;
        }
        report.scanned += 1;

        // Only the header is needed to decide; whole files are read on demand.
        let mut head = [0u8; 64];
        let head_len = {
            let mut file = tokio::fs::File::open(&path).await?;
            let mut read = 0usize;
            loop {
                let n = file.read(&mut head[read..]).await?;
                if n == 0 || read + n == head.len() {
                    read += n;
                    break;
                }
                read += n;
            }
            read
        };
        let state = registry.blob_state(&head[..head_len]);
        if state == (BlobState::Sealed { active_key: true }) {
            continue;
        }

        touched += 1;
        let result: Result<(), String> = async {
            let bytes = tokio::fs::read(&path).await.map_err(|e| e.to_string())?;
            let plaintext = registry.open_blob(&bytes).map_err(|e| e.to_string())?;
            let sealed = registry.seal_blob(&plaintext).map_err(|e| e.to_string())?;
            let tmp = path.with_file_name(format!("{name}.rewrap.tmp"));
            tokio::fs::write(&tmp, &sealed)
                .await
                .map_err(|e| e.to_string())?;
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                tokio::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o600))
                    .await
                    .map_err(|e| e.to_string())?;
            }
            tokio::fs::rename(&tmp, &path)
                .await
                .map_err(|e| e.to_string())
        }
        .await;

        match result {
            Ok(()) => {
                if state == BlobState::Plaintext {
                    report.sealed_plaintext += 1;
                } else {
                    report.rewrapped += 1;
                }
            }
            Err(error) => {
                report.failed += 1;
                tracing::warn!(error = %error, file = %name, "document blob rewrap");
            }
        }
    }
    Ok(report)
}
