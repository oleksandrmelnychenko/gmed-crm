//! List versions: import, activation, the in-memory index of the active
//! version, download bookkeeping.
//!
//! Every successful import is a new version row. Exactly one version is
//! active; a failed or suspicious import never replaces it ("keep the last
//! good version"). Entries of all but the newest [`KEEP_ENTRY_VERSIONS`]
//! versions are pruned; the version rows stay, because hits refer to them.

use std::sync::{Arc, Mutex};

use chrono::{DateTime, NaiveDate, Utc};
use serde::Serialize;
use serde_json::json;
use sha2::{Digest, Sha256};
use sqlx::Row;
use uuid::Uuid;

use super::fsf::{self, FsfParseError, ListEntry, SubjectType};
use super::matching::SanctionsIndex;
use crate::audit;
use crate::state::AppState;

/// Versions whose entries stay in the database.
pub const KEEP_ENTRY_VERSIONS: i64 = 3;
/// A new file with less than this share of the active version's entries is
/// treated as truncated or wrong and not activated.
pub const MIN_ENTRY_RATIO: f64 = 0.5;
/// The UI warns when the last successful update is older than this.
pub const STALE_AFTER_DAYS: i64 = 7;
const ENTRY_INSERT_CHUNK: usize = 500;
/// The active version and, right after an import, the previous one.
const INDEX_CACHE_SIZE: usize = 2;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ImportSource {
    Download,
    Upload,
}

impl ImportSource {
    fn as_str(self) -> &'static str {
        match self {
            Self::Download => "download",
            Self::Upload => "upload",
        }
    }
}

/// The active version prepared for matching.
#[derive(Clone)]
pub struct ActiveIndex {
    pub version_id: Uuid,
    pub list_date: NaiveDate,
    pub index: Arc<SanctionsIndex>,
}

static INDEX_CACHE: Mutex<Vec<ActiveIndex>> = Mutex::new(Vec::new());

/// Id and date of the active version.
pub async fn active_version(
    db: &gmed_db::DbPool,
) -> Result<Option<(Uuid, NaiveDate)>, sqlx::Error> {
    let row =
        sqlx::query("SELECT id, list_date FROM sanctions_list_versions WHERE is_active LIMIT 1")
            .fetch_optional(db)
            .await?;
    Ok(match row {
        Some(row) => Some((row.try_get("id")?, row.try_get("list_date")?)),
        None => None,
    })
}

/// The matching index of the active version, built once per version and
/// process. `None` while no list has been imported.
pub async fn active_index(db: &gmed_db::DbPool) -> Result<Option<ActiveIndex>, sqlx::Error> {
    let Some((version_id, list_date)) = active_version(db).await? else {
        return Ok(None);
    };
    if let Some(cached) = INDEX_CACHE
        .lock()
        .map_err(|_| sqlx::Error::Protocol("sanctions index cache poisoned".into()))?
        .iter()
        .find(|cached| cached.version_id == version_id)
        .cloned()
    {
        return Ok(Some(cached));
    }
    let rows: Vec<serde_json::Value> = sqlx::query_scalar(
        "SELECT data FROM sanctions_list_entries WHERE version_id = $1 ORDER BY logical_id",
    )
    .bind(version_id)
    .fetch_all(db)
    .await?;
    let entries: Vec<ListEntry> = rows
        .into_iter()
        .filter_map(|value| serde_json::from_value(value).ok())
        .collect();
    let index = tokio::task::spawn_blocking(move || SanctionsIndex::build(entries))
        .await
        .map_err(|error| sqlx::Error::Protocol(format!("sanctions index build: {error}")))?;
    let active = ActiveIndex {
        version_id,
        list_date,
        index: Arc::new(index),
    };
    if let Ok(mut cache) = INDEX_CACHE.lock() {
        cache.retain(|cached| cached.version_id != version_id);
        cache.insert(0, active.clone());
        cache.truncate(INDEX_CACHE_SIZE);
    }
    Ok(Some(active))
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "result", rename_all = "snake_case")]
pub enum ImportOutcome {
    Imported {
        version_id: Uuid,
        list_date: NaiveDate,
        entries: usize,
        persons: usize,
    },
    /// The file is the active version byte for byte.
    Unchanged { version_id: Uuid },
}

#[derive(Debug, thiserror::Error)]
pub enum ImportError {
    #[error(transparent)]
    Parse(#[from] FsfParseError),
    #[error(
        "the file has {entries} entries, the active list {active_entries}; it looks truncated and was not activated"
    )]
    Suspicious { entries: usize, active_entries: i64 },
    #[error("database error: {0}")]
    Db(#[from] sqlx::Error),
}

impl ImportError {
    pub fn public_code(&self) -> &'static str {
        match self {
            Self::Parse(FsfParseError::Size) => "list_size",
            Self::Parse(FsfParseError::Format(_)) => "list_format",
            Self::Parse(FsfParseError::Empty) => "list_empty",
            Self::Suspicious { .. } => "list_suspicious",
            Self::Db(_) => "list_storage",
        }
    }
}

fn sha256_hex(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

/// Parses, stores and activates a list file. The previous version stays
/// active when anything fails.
pub async fn import_list(
    state: &AppState,
    bytes: Vec<u8>,
    source: ImportSource,
    imported_by: Option<Uuid>,
) -> Result<ImportOutcome, ImportError> {
    let digest = sha256_hex(&bytes);
    let byte_size = bytes.len() as i64;
    let active = sqlx::query(
        "SELECT id, sha256, entry_count FROM sanctions_list_versions WHERE is_active LIMIT 1",
    )
    .fetch_optional(&state.db)
    .await?;
    if let Some(row) = &active
        && row.try_get::<String, _>("sha256")? == digest
    {
        return Ok(ImportOutcome::Unchanged {
            version_id: row.try_get("id")?,
        });
    }

    let parsed = tokio::task::spawn_blocking(move || fsf::parse_fsf_xml(&bytes))
        .await
        .map_err(|error| ImportError::Db(sqlx::Error::Protocol(error.to_string())))??;
    if let Some(row) = &active {
        let active_entries: i32 = row.try_get("entry_count")?;
        if (parsed.entries.len() as f64) < f64::from(active_entries) * MIN_ENTRY_RATIO {
            return Err(ImportError::Suspicious {
                entries: parsed.entries.len(),
                active_entries: i64::from(active_entries),
            });
        }
    }

    let list_date = parsed
        .generated_at
        .map(crate::app_time::date_of)
        .unwrap_or_else(crate::app_time::today);
    let entries = parsed.entries.len();
    let persons = parsed.person_count();

    let mut tx = state.db.begin().await?;
    let version_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO sanctions_list_versions
               (source, generated_at, list_date, global_file_id, sha256, byte_size,
                entry_count, person_count, imported_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           RETURNING id"#,
    )
    .bind(source.as_str())
    .bind(parsed.generated_at)
    .bind(list_date)
    .bind(&parsed.global_file_id)
    .bind(&digest)
    .bind(byte_size)
    .bind(entries as i32)
    .bind(persons as i32)
    .bind(imported_by)
    .fetch_one(&mut *tx)
    .await?;

    for chunk in parsed.entries.chunks(ENTRY_INSERT_CHUNK) {
        let mut logical_ids = Vec::with_capacity(chunk.len());
        let mut subject_types = Vec::with_capacity(chunk.len());
        let mut references = Vec::with_capacity(chunk.len());
        let mut data = Vec::with_capacity(chunk.len());
        for entry in chunk {
            logical_ids.push(entry.logical_id.clone());
            subject_types.push(match entry.subject_type {
                SubjectType::Person => "person".to_string(),
                SubjectType::Entity => "entity".to_string(),
            });
            references.push(entry.eu_reference.clone());
            data.push(serde_json::to_value(entry).map_err(|error| {
                ImportError::Db(sqlx::Error::Protocol(format!("serialize entry: {error}")))
            })?);
        }
        sqlx::query(
            r#"INSERT INTO sanctions_list_entries
                   (version_id, logical_id, subject_type, eu_reference, data)
               SELECT $1, t.logical_id, t.subject_type, t.eu_reference, t.data
               FROM UNNEST($2::text[], $3::text[], $4::text[], $5::jsonb[])
                    AS t(logical_id, subject_type, eu_reference, data)
               ON CONFLICT (version_id, logical_id) DO NOTHING"#,
        )
        .bind(version_id)
        .bind(&logical_ids)
        .bind(&subject_types)
        .bind(&references)
        .bind(&data)
        .execute(&mut *tx)
        .await?;
    }

    sqlx::query("UPDATE sanctions_list_versions SET is_active = false WHERE is_active")
        .execute(&mut *tx)
        .await?;
    sqlx::query(
        "UPDATE sanctions_list_versions SET is_active = true, activated_at = now() WHERE id = $1",
    )
    .bind(version_id)
    .execute(&mut *tx)
    .await?;
    sqlx::query(
        r#"UPDATE sanctions_list_sync_state
           SET last_success_at = now(), consecutive_failures = 0
           WHERE id"#,
    )
    .execute(&mut *tx)
    .await?;
    audit::write_in_transaction(
        &mut tx,
        &audit::domain_event(
            "sanctions_list_imported",
            imported_by,
            "sanctions_list_version",
            Some(version_id),
            json!({
                "source": source.as_str(),
                "list_date": list_date,
                "generated_at": parsed.generated_at,
                "global_file_id": parsed.global_file_id,
                "sha256": digest,
                "entries": entries,
                "persons": persons,
            }),
        ),
    )
    .await?;
    tx.commit().await?;

    if let Err(error) = prune_old_entries(&state.db).await {
        tracing::warn!(error = %error, "Pruning old sanctions list entries failed");
    }
    Ok(ImportOutcome::Imported {
        version_id,
        list_date,
        entries,
        persons,
    })
}

async fn prune_old_entries(db: &gmed_db::DbPool) -> Result<(), sqlx::Error> {
    let mut tx = db.begin().await?;
    let pruned: Vec<Uuid> = sqlx::query_scalar(
        r#"UPDATE sanctions_list_versions
           SET entries_pruned_at = now()
           WHERE entries_pruned_at IS NULL
             AND NOT is_active
             AND id NOT IN (
                 SELECT id FROM sanctions_list_versions
                 ORDER BY created_at DESC
                 LIMIT $1
             )
           RETURNING id"#,
    )
    .bind(KEEP_ENTRY_VERSIONS)
    .fetch_all(&mut *tx)
    .await?;
    if !pruned.is_empty() {
        sqlx::query("DELETE FROM sanctions_list_entries WHERE version_id = ANY($1)")
            .bind(&pruned)
            .execute(&mut *tx)
            .await?;
    }
    tx.commit().await
}

/// Records a failed download or upload; the active version stays.
pub async fn record_failure(db: &gmed_db::DbPool, code: &str) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"UPDATE sanctions_list_sync_state
           SET last_error_code = $1,
               last_error_at = now(),
               consecutive_failures = consecutive_failures + 1
           WHERE id"#,
    )
    .bind(code)
    .execute(db)
    .await
    .map(|_| ())
}

/// Records the start of a download attempt.
pub async fn record_attempt(db: &gmed_db::DbPool) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE sanctions_list_sync_state SET last_attempt_at = now() WHERE id")
        .execute(db)
        .await
        .map(|_| ())
}

/// A successful check that found the active version unchanged.
pub async fn record_unchanged(db: &gmed_db::DbPool) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"UPDATE sanctions_list_sync_state
           SET last_success_at = now(), consecutive_failures = 0
           WHERE id"#,
    )
    .execute(db)
    .await
    .map(|_| ())
}

#[derive(Debug, Clone, Serialize)]
pub struct VersionView {
    pub id: Uuid,
    pub source: String,
    pub list_date: NaiveDate,
    pub generated_at: Option<DateTime<Utc>>,
    pub global_file_id: Option<String>,
    pub sha256: String,
    pub byte_size: i64,
    pub entry_count: i32,
    pub person_count: i32,
    pub is_active: bool,
    pub imported_by_name: Option<String>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SyncView {
    pub last_attempt_at: Option<DateTime<Utc>>,
    pub last_success_at: Option<DateTime<Utc>>,
    pub last_error_code: Option<String>,
    pub last_error_at: Option<DateTime<Utc>>,
    pub consecutive_failures: i32,
}

#[derive(Debug, Clone, Serialize)]
pub struct ListStatus {
    pub active: Option<VersionView>,
    pub versions: Vec<VersionView>,
    pub sync: SyncView,
    /// No list, or no successful update for [`STALE_AFTER_DAYS`].
    pub stale: bool,
    pub source_url: String,
    pub automatic_download: bool,
}

pub async fn list_status(db: &gmed_db::DbPool) -> Result<ListStatus, sqlx::Error> {
    let rows = sqlx::query(
        r#"SELECT v.id, v.source, v.list_date, v.generated_at, v.global_file_id, v.sha256,
                  v.byte_size, v.entry_count, v.person_count, v.is_active, v.created_at,
                  u.name AS imported_by_name
           FROM sanctions_list_versions v
           LEFT JOIN users u ON u.id = v.imported_by
           ORDER BY v.created_at DESC
           LIMIT 10"#,
    )
    .fetch_all(db)
    .await?;
    let mut versions = Vec::with_capacity(rows.len());
    for row in rows {
        versions.push(VersionView {
            id: row.try_get("id")?,
            source: row.try_get("source")?,
            list_date: row.try_get("list_date")?,
            generated_at: row.try_get("generated_at")?,
            global_file_id: row.try_get("global_file_id")?,
            sha256: row.try_get("sha256")?,
            byte_size: row.try_get("byte_size")?,
            entry_count: row.try_get("entry_count")?,
            person_count: row.try_get("person_count")?,
            is_active: row.try_get("is_active")?,
            imported_by_name: row.try_get("imported_by_name")?,
            created_at: row.try_get("created_at")?,
        });
    }
    // A version row is written only by a successful import, which activates
    // it in the same transaction: the active version is always the newest.
    let active = versions.iter().find(|version| version.is_active).cloned();
    let sync = sqlx::query(
        r#"SELECT last_attempt_at, last_success_at, last_error_code, last_error_at,
                  consecutive_failures
           FROM sanctions_list_sync_state WHERE id"#,
    )
    .fetch_optional(db)
    .await?;
    let sync = match sync {
        Some(row) => SyncView {
            last_attempt_at: row.try_get("last_attempt_at")?,
            last_success_at: row.try_get("last_success_at")?,
            last_error_code: row.try_get("last_error_code")?,
            last_error_at: row.try_get("last_error_at")?,
            consecutive_failures: row.try_get("consecutive_failures")?,
        },
        None => SyncView {
            last_attempt_at: None,
            last_success_at: None,
            last_error_code: None,
            last_error_at: None,
            consecutive_failures: 0,
        },
    };
    let stale = match (&active, sync.last_success_at) {
        (None, _) => true,
        (Some(_), Some(success)) => Utc::now() - success > chrono::Duration::days(STALE_AFTER_DAYS),
        (Some(version), None) => {
            Utc::now() - version.created_at > chrono::Duration::days(STALE_AFTER_DAYS)
        }
    };
    Ok(ListStatus {
        active,
        versions,
        sync,
        stale,
        source_url: super::download::source_url(),
        automatic_download: super::download::automatic_download_enabled(),
    })
}

/// One entry of a stored version, for the review page.
pub async fn entry_of_version(
    db: &gmed_db::DbPool,
    version_id: Uuid,
    logical_id: &str,
) -> Result<Option<ListEntry>, sqlx::Error> {
    let value: Option<serde_json::Value> = sqlx::query_scalar(
        "SELECT data FROM sanctions_list_entries WHERE version_id = $1 AND logical_id = $2",
    )
    .bind(version_id)
    .bind(logical_id)
    .fetch_optional(db)
    .await?;
    Ok(value.and_then(|value| serde_json::from_value(value).ok()))
}
