use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use sqlx::Row;
use std::sync::Arc;
use tokio::sync::RwLock;

/// Cached system settings loaded from the `system_settings` table.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TokenSettings {
    pub access_token_minutes: i64,
    pub refresh_token_days: i64,
    pub max_sessions_per_user: i64,
    pub session_idle_days: i64,
}

impl Default for TokenSettings {
    fn default() -> Self {
        Self {
            access_token_minutes: 15,
            refresh_token_days: 30,
            max_sessions_per_user: 10,
            session_idle_days: 7,
        }
    }
}

/// Thread-safe settings cache.
#[derive(Clone)]
pub struct SettingsCache {
    inner: Arc<RwLock<TokenSettings>>,
}

impl SettingsCache {
    pub fn new(settings: TokenSettings) -> Self {
        Self {
            inner: Arc::new(RwLock::new(settings)),
        }
    }

    pub async fn get(&self) -> TokenSettings {
        self.inner.read().await.clone()
    }

    pub async fn reload(&self, pool: &PgPool) {
        match load_from_db(pool).await {
            Ok(s) => {
                *self.inner.write().await = s;
                tracing::info!("Settings cache reloaded");
            }
            Err(e) => tracing::error!(error = %e, "Failed to reload settings"),
        }
    }
}

async fn get_i64(pool: &PgPool, key: &str, default: i64) -> i64 {
    match sqlx::query(r#"SELECT value::TEXT AS value_text FROM system_settings WHERE key = $1"#)
        .bind(key)
        .fetch_optional(pool)
        .await
    {
        Ok(Some(row)) => row
            .try_get::<String, _>("value_text")
            .ok()
            .and_then(|value| value.trim_matches('"').parse::<i64>().ok())
            .unwrap_or(default),
        _ => default,
    }
}

pub async fn load_from_db(pool: &PgPool) -> Result<TokenSettings, sqlx::Error> {
    Ok(TokenSettings {
        access_token_minutes: get_i64(pool, "access_token_minutes", 15).await,
        refresh_token_days: get_i64(pool, "refresh_token_days", 30).await,
        max_sessions_per_user: get_i64(pool, "max_sessions_per_user", 10).await,
        session_idle_days: get_i64(pool, "session_idle_days", 7).await,
    })
}

/// List all settings as key-value pairs (for admin UI).
pub async fn list_all(pool: &PgPool) -> Result<Vec<SettingRow>, sqlx::Error> {
    let rows = sqlx::query(
        r#"SELECT key, value::TEXT AS value_text, description, updated_at
           FROM system_settings ORDER BY key"#,
    )
    .fetch_all(pool)
    .await?;

    let mut settings = Vec::with_capacity(rows.len());
    for row in rows {
        settings.push(SettingRow {
            key: row.try_get("key")?,
            value: row.try_get("value_text")?,
            description: row.try_get("description")?,
            updated_at: row.try_get("updated_at")?,
        });
    }
    Ok(settings)
}

/// Update a single setting.
pub async fn update_setting(
    pool: &PgPool,
    key: &str,
    value: &str,
    user_id: uuid::Uuid,
) -> Result<(), UpdateError> {
    // Validate: must be a positive integer for token settings
    let parsed: i64 = value
        .trim()
        .parse()
        .map_err(|_| UpdateError::InvalidValue("Must be a positive integer".into()))?;

    if parsed < 1 {
        return Err(UpdateError::InvalidValue("Value must be at least 1".into()));
    }

    // Enforce sane bounds
    match key {
        "access_token_minutes" if parsed > 1440 => {
            return Err(UpdateError::InvalidValue(
                "Access token cannot exceed 24 hours (1440 min)".into(),
            ));
        }
        "refresh_token_days" if parsed > 365 => {
            return Err(UpdateError::InvalidValue(
                "Refresh token cannot exceed 365 days".into(),
            ));
        }
        "max_sessions_per_user" if parsed > 100 => {
            return Err(UpdateError::InvalidValue(
                "Max sessions cannot exceed 100".into(),
            ));
        }
        _ => {}
    }

    let json_value = serde_json::Value::from(parsed);

    let result = sqlx::query(
        "UPDATE system_settings SET value = $2, updated_by = $3, updated_at = now() WHERE key = $1",
    )
    .bind(key)
    .bind(json_value)
    .bind(user_id)
    .execute(pool)
    .await
    .map_err(|e| UpdateError::Db(e.to_string()))?;

    if result.rows_affected() == 0 {
        return Err(UpdateError::NotFound);
    }

    // Audit
    let _ = sqlx::query!(
        "INSERT INTO audit_log (user_id, action, entity_type, entity_id, context)
         VALUES ($1, 'update_setting', 'system_settings', NULL, $2)",
        user_id,
        serde_json::json!({ "key": key, "value": parsed })
    )
    .execute(pool)
    .await;

    Ok(())
}

#[derive(Debug, Serialize)]
pub struct SettingRow {
    pub key: String,
    pub value: String,
    pub description: Option<String>,
    pub updated_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug)]
pub enum UpdateError {
    InvalidValue(String),
    NotFound,
    Db(String),
}
