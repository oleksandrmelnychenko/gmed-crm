use serde::{Deserialize, Serialize};
use serde_json::Value;
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
            access_token_minutes: 60,
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
        access_token_minutes: get_i64(pool, "access_token_minutes", 60).await,
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
    let json_value = match key {
        "agency_name" => validate_string_setting(value, 160, false, "Agency name")?,
        "agency_care_of" => validate_string_setting(value, 160, true, "Agency care-of")?,
        "agency_address" => validate_string_setting(value, 500, true, "Agency address")?,
        "agency_phone" => validate_string_setting(value, 64, true, "Agency phone")?,
        "agency_email" => validate_email_setting(value)?,
        "agency_principal_birth_date" => validate_optional_date_setting(value)?,
        "agency_privacy_email" => validate_email_setting(value)?,
        "agency_sign_place" => {
            validate_string_setting(value, 160, false, "Agency signature place")?
        }
        "agency_data_system_name" => {
            validate_string_setting(value, 160, false, "Agency data system name")?
        }
        "agency_data_processor_notice" => {
            validate_string_setting(value, 4_000, true, "Agency data processor notice")?
        }
        "agency_bank_holder" => {
            validate_string_setting(value, 160, true, "Agency bank account holder")?
        }
        "agency_bank_name" => validate_string_setting(value, 160, true, "Agency bank name")?,
        "agency_bank_swift" => validate_string_setting(value, 32, true, "Agency SWIFT/BIC")?,
        "agency_bank_iban" => validate_string_setting(value, 64, true, "Agency IBAN")?,
        "required_patient_documents" => validate_required_patient_documents_setting(value)?,
        _ => validate_positive_integer_setting(key, value)?,
    };

    let result = sqlx::query(
        "UPDATE system_settings SET value = $2, updated_by = $3, updated_at = now() WHERE key = $1",
    )
    .bind(key)
    .bind(json_value.clone())
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
        serde_json::json!({ "key": key, "value": json_value })
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

fn validate_positive_integer_setting(key: &str, value: &str) -> Result<Value, UpdateError> {
    let parsed: i64 = value
        .trim()
        .parse()
        .map_err(|_| UpdateError::InvalidValue("Must be a positive integer".into()))?;

    if parsed < 1 {
        return Err(UpdateError::InvalidValue("Value must be at least 1".into()));
    }

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
        "session_idle_days" if parsed > 365 => {
            return Err(UpdateError::InvalidValue(
                "Session idle timeout cannot exceed 365 days".into(),
            ));
        }
        _ => {}
    }

    Ok(Value::from(parsed))
}

fn validate_string_setting(
    value: &str,
    max_len: usize,
    allow_empty: bool,
    field_name: &str,
) -> Result<Value, UpdateError> {
    let trimmed = value.trim();

    if trimmed.is_empty() && !allow_empty {
        return Err(UpdateError::InvalidValue(format!(
            "{field_name} cannot be empty"
        )));
    }

    if trimmed.len() > max_len {
        return Err(UpdateError::InvalidValue(format!(
            "{field_name} cannot exceed {max_len} characters"
        )));
    }

    Ok(Value::String(trimmed.to_string()))
}

fn validate_email_setting(value: &str) -> Result<Value, UpdateError> {
    let trimmed = value.trim();

    if trimmed.is_empty() {
        return Ok(Value::String(String::new()));
    }

    if trimmed.len() > 320 || !trimmed.contains('@') {
        return Err(UpdateError::InvalidValue("Agency email is invalid".into()));
    }

    Ok(Value::String(trimmed.to_string()))
}

fn validate_optional_date_setting(value: &str) -> Result<Value, UpdateError> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Ok(Value::String(String::new()));
    }
    chrono::NaiveDate::parse_from_str(trimmed, "%Y-%m-%d")
        .map_err(|_| UpdateError::InvalidValue("Date must use YYYY-MM-DD".into()))?;
    Ok(Value::String(trimmed.to_string()))
}

fn validate_required_patient_documents_setting(value: &str) -> Result<Value, UpdateError> {
    let parsed: Value = serde_json::from_str(value.trim()).map_err(|_| {
        UpdateError::InvalidValue("Required patient documents must be a valid JSON array".into())
    })?;

    let items = parsed.as_array().ok_or_else(|| {
        UpdateError::InvalidValue("Required patient documents must be a JSON array".into())
    })?;

    let mut normalized = Vec::with_capacity(items.len());
    for item in items {
        let object = item.as_object().ok_or_else(|| {
            UpdateError::InvalidValue(
                "Each required patient document rule must be a JSON object".into(),
            )
        })?;

        let raw_key = object
            .get("key")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| {
                UpdateError::InvalidValue(
                    "Each required patient document rule must include a key".into(),
                )
            })?;
        let key = raw_key.to_lowercase().replace([' ', '-'], "_");
        if key.len() > 80
            || !key
                .chars()
                .all(|ch| ch.is_ascii_lowercase() || ch.is_ascii_digit() || ch == '_')
        {
            return Err(UpdateError::InvalidValue(
                "Required patient document keys must use letters, digits, spaces or hyphens".into(),
            ));
        }

        let label = object
            .get("label")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| {
                UpdateError::InvalidValue(
                    "Each required patient document rule must include a label".into(),
                )
            })?;
        if label.len() > 120 {
            return Err(UpdateError::InvalidValue(
                "Required patient document labels cannot exceed 120 characters".into(),
            ));
        }

        let normalize_matchers = |field_name: &str| -> Result<Vec<String>, UpdateError> {
            let Some(value) = object.get(field_name) else {
                return Ok(Vec::new());
            };
            let items = value.as_array().ok_or_else(|| {
                UpdateError::InvalidValue(format!(
                    "Required patient document field '{field_name}' must be an array"
                ))
            })?;

            let mut normalized_items = Vec::new();
            for item in items {
                let entry = item
                        .as_str()
                        .map(str::trim)
                        .filter(|value| !value.is_empty())
                        .ok_or_else(|| {
                            UpdateError::InvalidValue(format!(
                                "Required patient document field '{field_name}' must contain only strings"
                            ))
                        })?;
                let normalized_entry = entry.to_lowercase().replace([' ', '-'], "_");
                if !normalized_items.contains(&normalized_entry) {
                    normalized_items.push(normalized_entry);
                }
            }
            Ok(normalized_items)
        };

        let art = normalize_matchers("art")?;
        let category = normalize_matchers("category")?;
        if art.is_empty() && category.is_empty() {
            return Err(UpdateError::InvalidValue(
                "Each required patient document rule must define at least one art or category matcher"
                    .into(),
            ));
        }

        normalized.push(serde_json::json!({
            "key": key,
            "label": label,
            "art": art,
            "category": category,
        }));
    }

    Ok(Value::Array(normalized))
}
