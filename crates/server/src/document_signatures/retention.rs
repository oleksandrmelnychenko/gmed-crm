//! Data minimisation at the provider (Art. 5 Abs. 1 lit. c, Art. 28 DSGVO):
//! once the signed PDF and the report are archived in GMED, the request can be
//! deleted at the provider. Off by default: the provider's delete endpoint and
//! its effect on the signers' copies must first be verified on the demo
//! account. GMED keeps its own archive (evidence, report, signed PDF).
use sqlx::Row;
use uuid::Uuid;

use super::connection;
use crate::{audit, state::AppState};

pub const DELETION_ENABLED_SETTING: &str = "signature_provider_deletion_enabled";
pub const DELETION_DAYS_SETTING: &str = "signature_provider_deletion_days";
pub const DEFAULT_DELETION_DAYS: i64 = 30;
pub const MAX_DELETION_DAYS: i64 = 365;

async fn setting(state: &AppState, key: &str) -> Option<String> {
    sqlx::query_scalar::<_, Option<String>>(
        "SELECT value #>> '{}' FROM system_settings WHERE key = $1",
    )
    .bind(key)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten()
    .flatten()
}

/// Deletes up to ten finished, archived requests at the provider. Returns how
/// many were deleted; nothing happens while the setting is off.
pub async fn delete_archived_at_provider(state: &AppState) -> Result<u64, &'static str> {
    if setting(state, DELETION_ENABLED_SETTING).await.as_deref() != Some("true") {
        return Ok(0);
    }
    let days = setting(state, DELETION_DAYS_SETTING)
        .await
        .and_then(|value| value.trim().parse::<i64>().ok())
        .unwrap_or(DEFAULT_DELETION_DAYS)
        .clamp(1, MAX_DELETION_DAYS);
    let Some(provider) = connection::current_provider(state).await? else {
        return Ok(0);
    };
    let rows = sqlx::query(
        r#"SELECT id, provider_request_id, source_document_id
           FROM document_signature_requests
           WHERE provider_request_id IS NOT NULL AND provider_deleted_at IS NULL
             AND provider_account = $1
             AND (status IN ('completed', 'declined', 'withdrawn', 'expired')
                  OR (status = 'error' AND closed_kind IS NOT NULL))
             AND updated_at < now() - ($2::bigint * interval '1 day')
             AND (lease_until IS NULL OR lease_until < now())
           ORDER BY updated_at
           LIMIT 10"#,
    )
    .bind(&provider.account)
    .bind(days)
    .fetch_all(&state.db)
    .await
    .map_err(|_| "signature_database_error")?;
    let mut deleted = 0;
    for row in rows {
        let id: Uuid = row.get("id");
        let remote: Uuid = row.get("provider_request_id");
        match provider.delete(remote).await {
            Ok(()) | Err("provider_not_found") => {}
            Err(code) => return Err(code),
        }
        let mut tx = state
            .db
            .begin()
            .await
            .map_err(|_| "signature_database_error")?;
        sqlx::query(
            "UPDATE document_signature_requests SET provider_deleted_at = now() WHERE id = $1",
        )
        .bind(id)
        .execute(&mut *tx)
        .await
        .map_err(|_| "signature_database_error")?;
        audit::write_in_transaction(
            &mut tx,
            &audit::domain_event(
                "document_signature_deleted_at_provider",
                None,
                "document",
                Some(row.get::<Uuid, _>("source_document_id")),
                serde_json::json!({ "request_id": id, "retention_days": days }),
            ),
        )
        .await
        .map_err(|_| "signature_database_error")?;
        tx.commit().await.map_err(|_| "signature_database_error")?;
        deleted += 1;
    }
    Ok(deleted)
}
