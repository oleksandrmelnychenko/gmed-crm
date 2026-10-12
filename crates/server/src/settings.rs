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
    pub password_expire_days: i64,
}

impl Default for TokenSettings {
    fn default() -> Self {
        Self {
            access_token_minutes: 60,
            refresh_token_days: 30,
            max_sessions_per_user: 10,
            session_idle_days: 7,
            password_expire_days: 90,
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
        password_expire_days: get_i64(pool, "password_expire_days", 90).await,
    })
}

/// Settings owned by the personnel file module.
pub const PERSONNEL_SETTING_PREFIX: &str = "personnel_";

/// Technical settings the IT admin (`admin.settings`) changes: sessions,
/// passwords, lockout, maintenance and technical housekeeping. Every other
/// key is a business or legal decision — the agency profile with the bank
/// account printed on invoices, VAT and tax numbers, retention periods,
/// access periods, document rules, dunning and service lead times — and is
/// changed by the CEO only (QA E-31, 2026-10-11). New keys are CEO-only until
/// they are listed here.
pub const TECHNICAL_SETTING_KEYS: &[&str] = &[
    "access_token_minutes",
    "refresh_token_days",
    "max_sessions_per_user",
    "session_idle_days",
    "password_expire_days",
    "password_min_length",
    "password_require_number",
    "password_require_uppercase",
    "max_failed_login_attempts",
    "lockout_duration_minutes",
    "ip_whitelist_enabled",
    "maintenance_mode",
    "maintenance_message",
    "mfa_totp_required_roles",
    "cleanup_expired_tokens_days",
    "cleanup_audit_http_days",
    crate::document_signatures::closure::STUCK_DAYS_SETTING,
];

/// Whether the IT admin may change `key` (see [`TECHNICAL_SETTING_KEYS`]).
pub fn is_technical_setting(key: &str) -> bool {
    TECHNICAL_SETTING_KEYS.contains(&key)
}

/// Whether `key` exists for the settings page: personnel settings and the
/// blocked countries have their own CEO pages and are not part of it.
pub async fn is_listed_setting(pool: &PgPool, key: &str) -> Result<bool, sqlx::Error> {
    if key.starts_with(PERSONNEL_SETTING_PREFIX)
        || key == crate::sanctions::policy::BLOCKED_COUNTRIES_SETTING
    {
        return Ok(false);
    }
    sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM system_settings WHERE key = $1)")
        .bind(key)
        .fetch_one(pool)
        .await
}

/// List all settings as key-value pairs (for admin UI). `business_editable`:
/// the caller may change business and legal settings too (the CEO); every
/// row says whether this caller may change it.
pub async fn list_all(
    pool: &PgPool,
    business_editable: bool,
) -> Result<Vec<SettingRow>, sqlx::Error> {
    let rows = sqlx::query(
        r#"SELECT key, value::TEXT AS value_text, description, updated_at
           FROM system_settings
           WHERE key NOT LIKE 'personnel\_%'
           ORDER BY key"#,
    )
    .fetch_all(pool)
    .await?;

    let mut settings = Vec::with_capacity(rows.len());
    for row in rows {
        let key: String = row.try_get("key")?;
        let editable = business_editable || is_technical_setting(&key);
        settings.push(SettingRow {
            key,
            value: row.try_get("value_text")?,
            description: row.try_get("description")?,
            updated_at: row.try_get("updated_at")?,
            editable,
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
    // Personnel file settings (deletion switch, TSA) belong to the CEO and are
    // changed through `/personnel/settings`, not the IT admin settings page.
    if key.starts_with(PERSONNEL_SETTING_PREFIX) {
        return Err(UpdateError::NotFound);
    }
    // The blocked countries belong to the CEO (`PUT /sanctions/settings/
    // blocked-countries`), not to the IT admin settings page.
    if key == crate::sanctions::policy::BLOCKED_COUNTRIES_SETTING {
        return Err(UpdateError::NotFound);
    }
    let json_value = match key {
        "agency_name" => validate_string_setting(value, 160, false, "Agency name")?,
        "agency_care_of" => validate_string_setting(value, 160, true, "Agency care-of")?,
        "agency_address" => validate_string_setting(value, 500, true, "Agency address")?,
        "agency_phone" => validate_string_setting(value, 64, true, "Agency phone")?,
        "agency_email" => validate_email_setting(value)?,
        "agency_website" => validate_optional_website_setting(value)?,
        "agency_principal_birth_date" => validate_optional_date_setting(value)?,
        "agency_privacy_email" => validate_email_setting(value)?,
        "agency_sign_place" => {
            validate_string_setting(value, 160, false, "Agency signature place")?
        }
        "agency_data_system_name" => {
            validate_string_setting(value, 160, false, "Agency data system name")?
        }
        "agency_data_controller_statement" => {
            validate_string_setting(value, 1_000, false, "Agency data controller statement")?
        }
        "agency_data_processor_notice" => {
            validate_string_setting(value, 4_000, true, "Agency data processor notice")?
        }
        "agency_bank_holder" => {
            validate_string_setting(value, 160, true, "Agency bank account holder")?
        }
        "agency_bank_name" => validate_string_setting(value, 160, true, "Agency bank name")?,
        "agency_bank_swift" => validate_bic_setting(value)?,
        "agency_bank_iban" => validate_iban_setting(value)?,
        "agency_vat_id" => validate_string_setting(value, 32, true, "Agency VAT ID")?,
        "agency_tax_number" => validate_string_setting(value, 32, true, "Agency tax number")?,
        "agency_country_code" => validate_string_setting(value, 2, false, "Agency country code")?,
        "required_patient_documents" => validate_required_patient_documents_setting(value)?,
        crate::document_signatures::retention::DELETION_ENABLED_SETTING => match value.trim() {
            "true" => Value::Bool(true),
            "false" => Value::Bool(false),
            _ => {
                return Err(UpdateError::InvalidValue("Must be true or false".into()));
            }
        },
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
    /// The signed-in administrator may change this setting.
    pub editable: bool,
}

/// Length of an IBAN per country (ISO 13616 registry, SEPA countries and the
/// usual non-SEPA partners). An unknown country falls back to the generic
/// 15–34 character rule; the checksum is always verified.
const IBAN_LENGTHS: &[(&str, usize)] = &[
    ("AD", 24),
    ("AE", 23),
    ("AT", 20),
    ("BE", 16),
    ("BG", 22),
    ("CH", 21),
    ("CY", 28),
    ("CZ", 24),
    ("DE", 22),
    ("DK", 18),
    ("EE", 20),
    ("ES", 24),
    ("FI", 18),
    ("FR", 27),
    ("GB", 22),
    ("GI", 23),
    ("GR", 27),
    ("HR", 21),
    ("HU", 28),
    ("IE", 22),
    ("IS", 26),
    ("IT", 27),
    ("LI", 21),
    ("LT", 20),
    ("LU", 20),
    ("LV", 21),
    ("MC", 27),
    ("MT", 31),
    ("NL", 18),
    ("NO", 15),
    ("PL", 28),
    ("PT", 25),
    ("RO", 24),
    ("SA", 24),
    ("SE", 24),
    ("SI", 19),
    ("SK", 24),
    ("SM", 27),
    ("TR", 26),
    ("UA", 29),
    ("VA", 22),
];

/// Validates an IBAN (country code, length, ISO 7064 mod 97-10 checksum).
/// Spaces are allowed for readability; the value is stored in the usual
/// printed form: upper case, groups of four.
pub fn normalize_iban(value: &str) -> Result<String, &'static str> {
    let compact: String = value
        .chars()
        .filter(|ch| !ch.is_whitespace())
        .map(|ch| ch.to_ascii_uppercase())
        .collect();
    if compact.len() < 15 || compact.len() > 34 {
        return Err("IBAN must have 15 to 34 characters");
    }
    if !compact.chars().all(|ch| ch.is_ascii_alphanumeric()) {
        return Err("IBAN may contain only letters and digits");
    }
    let bytes = compact.as_bytes();
    if !bytes[0].is_ascii_uppercase()
        || !bytes[1].is_ascii_uppercase()
        || !bytes[2].is_ascii_digit()
        || !bytes[3].is_ascii_digit()
    {
        return Err("IBAN must start with a country code and two check digits");
    }
    let country = &compact[..2];
    if let Some((_, expected)) = IBAN_LENGTHS.iter().find(|(code, _)| *code == country)
        && compact.len() != *expected
    {
        return Err("IBAN has the wrong length for its country");
    }
    let rearranged = format!("{}{}", &compact[4..], &compact[..4]);
    let mut remainder: u32 = 0;
    for ch in rearranged.chars() {
        let digits = match ch.to_digit(36) {
            Some(value) => value,
            None => return Err("IBAN may contain only letters and digits"),
        };
        remainder = if digits >= 10 {
            (remainder * 100 + digits) % 97
        } else {
            (remainder * 10 + digits) % 97
        };
    }
    if remainder != 1 {
        return Err("IBAN check digits are wrong");
    }
    let grouped = compact
        .as_bytes()
        .chunks(4)
        .map(|chunk| String::from_utf8_lossy(chunk).into_owned())
        .collect::<Vec<_>>()
        .join(" ");
    Ok(grouped)
}

/// The BIC has neither 8 nor 11 characters.
pub const BIC_LENGTH_ERROR: &str =
    "BIC must have 8 or 11 characters: bank code, country, location and optional branch";
/// Characters 1–4 (bank code) are not all letters.
pub const BIC_BANK_CODE_ERROR: &str = "BIC bank code (characters 1-4) must be letters";
/// Characters 5–6 (country) are not letters.
pub const BIC_COUNTRY_ERROR: &str = "BIC country code (characters 5-6) must be letters";
/// Location or branch hold other characters than letters and digits.
pub const BIC_LOCATION_ERROR: &str =
    "BIC location and branch (characters 7-11) may contain only letters and digits";

/// Validates a BIC (ISO 9362): 4 letters bank code, 2 letters country,
/// 2 letters or digits location, optionally 3 letters or digits branch.
/// Each failure has its own message, so the form names the wrong part
/// instead of always blaming the length (QA R3-04).
pub fn normalize_bic(value: &str) -> Result<String, &'static str> {
    let compact: String = value
        .chars()
        .filter(|ch| !ch.is_whitespace())
        .map(|ch| ch.to_ascii_uppercase())
        .collect();
    let chars: Vec<char> = compact.chars().collect();
    if !(chars.len() == 8 || chars.len() == 11) {
        return Err(BIC_LENGTH_ERROR);
    }
    if !chars[..4].iter().all(char::is_ascii_uppercase) {
        return Err(BIC_BANK_CODE_ERROR);
    }
    if !chars[4..6].iter().all(char::is_ascii_uppercase) {
        return Err(BIC_COUNTRY_ERROR);
    }
    if !chars[6..].iter().all(char::is_ascii_alphanumeric) {
        return Err(BIC_LOCATION_ERROR);
    }
    Ok(compact)
}

fn validate_iban_setting(value: &str) -> Result<Value, UpdateError> {
    if value.trim().is_empty() {
        return Ok(Value::String(String::new()));
    }
    normalize_iban(value)
        .map(Value::String)
        .map_err(|message| UpdateError::InvalidValue(message.into()))
}

fn validate_bic_setting(value: &str) -> Result<Value, UpdateError> {
    if value.trim().is_empty() {
        return Ok(Value::String(String::new()));
    }
    normalize_bic(value)
        .map(Value::String)
        .map_err(|message| UpdateError::InvalidValue(message.into()))
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

    if key == "password_expire_days" && parsed == 0 {
        return Ok(Value::from(0));
    }
    // 0 sends the first automatic reminder the day after the due date.
    if key == "auto_dunning_grace_days" {
        if !(0..=90).contains(&parsed) {
            return Err(UpdateError::InvalidValue(
                "The dunning grace period must be between 0 and 90 days".into(),
            ));
        }
        return Ok(Value::from(parsed));
    }
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
        "password_expire_days" if parsed > 3650 => {
            return Err(UpdateError::InvalidValue(
                "Password expiration cannot exceed 3650 days".into(),
            ));
        }
        "concierge_reminder_lead_hours" | "concierge_prep_lead_hours" if parsed > 336 => {
            return Err(UpdateError::InvalidValue(
                "Concierge lead time cannot exceed 336 hours (14 days)".into(),
            ));
        }
        crate::document_signatures::retention::DELETION_DAYS_SETTING
            if parsed > crate::document_signatures::retention::MAX_DELETION_DAYS =>
        {
            return Err(UpdateError::InvalidValue(
                "Signature requests are deleted at the provider at most 365 days after archiving"
                    .into(),
            ));
        }
        crate::document_signatures::closure::STUCK_DAYS_SETTING
            if parsed > crate::document_signatures::closure::MAX_STUCK_DAYS =>
        {
            return Err(UpdateError::InvalidValue(
                "Signature requests can stay untrackable for at most 90 days".into(),
            ));
        }
        crate::services::interpreter_booking_links::ACCESS_DAYS_SETTING
            if parsed > crate::services::interpreter_booking_links::MAX_ACCESS_DAYS =>
        {
            return Err(UpdateError::InvalidValue(
                "Interpreter patient access cannot exceed 365 days after the last booking".into(),
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

fn validate_optional_website_setting(value: &str) -> Result<Value, UpdateError> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Ok(Value::String(String::new()));
    }
    if trimmed.chars().count() > 300 || trimmed.chars().any(char::is_whitespace) {
        return Err(UpdateError::InvalidValue(
            "Agency website must be a valid URL up to 300 characters".into(),
        ));
    }
    if trimmed.contains("://")
        && !trimmed.starts_with("http://")
        && !trimmed.starts_with("https://")
    {
        return Err(UpdateError::InvalidValue(
            "Agency website must be a valid HTTP(S) URL".into(),
        ));
    }

    let candidate = if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        trimmed.to_string()
    } else {
        format!("https://{trimmed}")
    };
    let uri = candidate.parse::<http::Uri>().map_err(|_| {
        UpdateError::InvalidValue("Agency website must be a valid HTTP(S) URL".into())
    })?;
    let scheme_is_supported = matches!(uri.scheme_str(), Some("http" | "https"));
    let host_is_present = uri
        .authority()
        .map(|authority| !authority.host().trim().is_empty())
        .unwrap_or(false);
    if !scheme_is_supported || !host_is_present {
        return Err(UpdateError::InvalidValue(
            "Agency website must be a valid HTTP(S) URL".into(),
        ));
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
        // `signed`: only a signed document fulfils the rule (the consent form).
        let signed = match object.get("signed") {
            None | Some(Value::Null) => false,
            Some(Value::Bool(value)) => *value,
            Some(_) => {
                return Err(UpdateError::InvalidValue(
                    "Required patient document field 'signed' must be true or false".into(),
                ));
            }
        };

        let mut rule = serde_json::json!({
            "key": key,
            "label": label,
            "art": art,
            "category": category,
        });
        if signed {
            rule["signed"] = Value::Bool(true);
        }
        normalized.push(rule);
    }

    Ok(Value::Array(normalized))
}

#[cfg(test)]
mod tests {
    use super::{
        UpdateError, is_technical_setting, normalize_bic, normalize_iban,
        validate_optional_website_setting, validate_positive_integer_setting,
        validate_required_patient_documents_setting,
    };
    use serde_json::{Value, json};

    /// The consent form asks for a signed document (QA 2026-10-11 B-06); the
    /// flag survives an administrator's save and must be a boolean.
    #[test]
    fn required_patient_documents_keep_the_signed_flag() {
        let saved = validate_required_patient_documents_setting(
            r#"[
              {"key":"passport","label":"Reisepass","art":["Passport-Scan"],"category":["personal_passport"]},
              {"key":"consent_form","label":"Einverständniserklärung","art":["privacy_consents"],"signed":true}
            ]"#,
        )
        .unwrap();
        assert_eq!(
            saved,
            json!([
                {"key":"passport","label":"Reisepass","art":["passport_scan"],"category":["personal_passport"]},
                {"key":"consent_form","label":"Einverständniserklärung","art":["privacy_consents"],"category":[],"signed":true}
            ])
        );
        assert!(matches!(
            validate_required_patient_documents_setting(
                r#"[{"key":"consent_form","label":"Consent","art":["consent"],"signed":"yes"}]"#
            ),
            Err(UpdateError::InvalidValue(_))
        ));
    }

    #[test]
    fn iban_needs_a_valid_country_length_and_checksum() {
        assert_eq!(
            normalize_iban("de89370400440532013000").unwrap(),
            "DE89 3704 0044 0532 0130 00"
        );
        assert_eq!(
            normalize_iban("DE02 1203 0000 0000 2020 51").unwrap(),
            "DE02 1203 0000 0000 2020 51"
        );
        assert_eq!(
            normalize_iban("AT61 1904 3002 3457 3201").unwrap(),
            "AT61 1904 3002 3457 3201"
        );
        for invalid in [
            "DE00 0000 0000 0000 0000 00",
            "DE89 3704 0044 0532 0130 01",
            "DE89 3704 0044 0532 0130",
            "8937 0400 4405 3201 3000",
            "DE89-3704-0044-0532-0130-00",
        ] {
            assert!(normalize_iban(invalid).is_err(), "{invalid}");
        }
    }

    #[test]
    fn bic_has_eight_or_eleven_characters_in_the_iso_layout() {
        assert_eq!(normalize_bic("cobadeffxxx").unwrap(), "COBADEFFXXX");
        assert_eq!(normalize_bic("MARK DE F1 100").unwrap(), "MARKDEF1100");
        assert_eq!(normalize_bic("BYLADEM1").unwrap(), "BYLADEM1");
        for invalid in [
            "MUSTERBIC",
            "COBA1EFF",
            "COBADEF",
            "COBADEFFXX",
            "COBADE-FXXX",
        ] {
            assert!(normalize_bic(invalid).is_err(), "{invalid}");
        }
    }

    #[test]
    fn bic_errors_name_the_wrong_part() {
        assert_eq!(normalize_bic("MUSTERBIC"), Err(super::BIC_LENGTH_ERROR));
        assert_eq!(normalize_bic("COBADEFF1"), Err(super::BIC_LENGTH_ERROR));
        assert_eq!(normalize_bic("COBADÉFFXXX"), Err(super::BIC_COUNTRY_ERROR));
        assert_eq!(
            normalize_bic("C0BADEFFXXX"),
            Err(super::BIC_BANK_CODE_ERROR)
        );
        // QA R3-04: eleven characters, but a digit in the country part.
        assert_eq!(normalize_bic("COBA1EFFXXX"), Err(super::BIC_COUNTRY_ERROR));
        assert_eq!(normalize_bic("COBADE-FXXX"), Err(super::BIC_LOCATION_ERROR));
    }

    #[test]
    fn only_technical_settings_are_left_to_the_it_admin() {
        for key in [
            "access_token_minutes",
            "max_failed_login_attempts",
            "lockout_duration_minutes",
            "signature_stuck_request_days",
        ] {
            assert!(is_technical_setting(key), "{key}");
        }
        for key in [
            "agency_bank_iban",
            "agency_bank_swift",
            "agency_vat_id",
            "agency_tax_number",
            "agency_name",
            "clinical_case_retention_years",
            "patient_file_retention_days",
            "unqualified_lead_retention_days",
            "interpreter_booking_access_days",
            "required_patient_documents",
            "auto_dunning_grace_days",
            "signature_provider_deletion_days",
            "cleanup_audit_log_days",
            "some_future_setting",
        ] {
            assert!(!is_technical_setting(key), "{key}");
        }
    }

    #[test]
    fn agency_website_accepts_optional_http_urls_and_rejects_invalid_values() {
        assert_eq!(
            validate_optional_website_setting("").unwrap(),
            Value::String(String::new())
        );
        assert_eq!(
            validate_optional_website_setting("gmed-health.com").unwrap(),
            Value::String("gmed-health.com".to_string())
        );
        assert_eq!(
            validate_optional_website_setting("https://gmed-health.com/kontakt").unwrap(),
            Value::String("https://gmed-health.com/kontakt".to_string())
        );

        let overlong_url = format!("https://{}.com", "a".repeat(300));
        for invalid in [
            "ftp://gmed-health.com",
            "https://gmed health.com",
            overlong_url.as_str(),
        ] {
            assert!(matches!(
                validate_optional_website_setting(invalid),
                Err(UpdateError::InvalidValue(_))
            ));
        }
    }

    #[test]
    fn password_expiration_accepts_documented_zero_and_rejects_out_of_range_values() {
        assert_eq!(
            validate_positive_integer_setting("password_expire_days", "0").unwrap(),
            Value::from(0)
        );
        assert!(matches!(
            validate_positive_integer_setting("password_expire_days", "3651"),
            Err(UpdateError::InvalidValue(_))
        ));
        assert!(matches!(
            validate_positive_integer_setting("refresh_token_days", "0"),
            Err(UpdateError::InvalidValue(_))
        ));
    }

    #[test]
    fn interpreter_booking_access_days_stay_between_one_day_and_a_year() {
        let key = crate::services::interpreter_booking_links::ACCESS_DAYS_SETTING;
        assert_eq!(
            validate_positive_integer_setting(key, "14").unwrap(),
            Value::from(14)
        );
        assert_eq!(
            validate_positive_integer_setting(key, "365").unwrap(),
            Value::from(365)
        );
        for invalid in ["0", "366", "two weeks"] {
            assert!(matches!(
                validate_positive_integer_setting(key, invalid),
                Err(UpdateError::InvalidValue(_))
            ));
        }
    }

    #[test]
    fn dunning_grace_days_allow_zero_up_to_ninety() {
        for (raw, value) in [("0", 0), ("7", 7), ("90", 90)] {
            assert_eq!(
                validate_positive_integer_setting("auto_dunning_grace_days", raw).unwrap(),
                Value::from(value)
            );
        }
        for invalid in ["-1", "91", "a week"] {
            assert!(matches!(
                validate_positive_integer_setting("auto_dunning_grace_days", invalid),
                Err(UpdateError::InvalidValue(_))
            ));
        }
    }
}
