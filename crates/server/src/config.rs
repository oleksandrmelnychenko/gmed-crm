use std::net::SocketAddr;

use secrecy::SecretString;

use crate::crypto::KeyRegistry;

pub struct Config {
    pub database_url: String,
    pub listen_addr: SocketAddr,
    pub jwt_secret: String,
    /// Comma-separated exact web/native origins allowed to call the API.
    pub cors_origin: String,
    pub message_key_registry: KeyRegistry,
    /// Salt used to pseudonymise peer IPs before they reach `audit_log`.
    /// Falls back to `JWT_SECRET` when `AUDIT_IP_SALT` is not set so a
    /// fresh deployment works out of the box, but operators rotating
    /// `JWT_SECRET` should set a dedicated `AUDIT_IP_SALT` beforehand
    /// to keep IP-hash stability across the rotation.
    pub audit_ip_salt: String,
    /// Address the Prometheus `/metrics` endpoint binds to. Defaults to
    /// `0.0.0.0:9091`. Set to an empty string to disable the metrics
    /// listener entirely (useful in unit tests; PROD always runs it).
    pub metrics_listen: Option<SocketAddr>,
    /// Permanent automated G-BA AIS download URL issued after accepting the
    /// official terms. It may contain an access token, so it is never used as
    /// public provenance or returned by an API.
    pub gba_ais_download_url: Option<SecretString>,
    /// Optional external AI used only to draft a privacy-minimised medication
    /// evidence summary. External calls are possible only when both explicit
    /// gates and a bounded environment governance-review identifier are present.
    pub medication_ai: MedicationAiConfig,
    /// Optional offline machine-translation drafts for the document
    /// translation workspace, served by the internal translation service.
    pub machine_translation: MachineTranslationConfig,
    /// Outgoing e-mail through Mittaro (transactional e-mail API hosted in
    /// Germany). Without an API key no e-mail is sent.
    pub mail: MailConfig,
}

/// Default send endpoint of the Mittaro API.
pub const MITTARO_DEFAULT_API_URL: &str = "https://api.mittaro.de/v1/emails";

#[derive(Clone, Default)]
pub struct MailConfig {
    /// `tx_live_…` key from the Mittaro dashboard.
    pub mittaro_api_key: Option<SecretString>,
    /// Send endpoint; [`MITTARO_DEFAULT_API_URL`] unless overridden.
    pub mittaro_api_url: Option<String>,
    /// Sender on a domain verified at Mittaro, e.g. `zugang@gmed-health.com`.
    pub from: Option<String>,
    pub reply_to: Option<String>,
    /// Origin of the staff/patient console the e-mails link to, e.g.
    /// `https://console.gmed-health.com`.
    pub console_url: Option<String>,
}

fn env_text(name: &str) -> Option<String> {
    std::env::var(name)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

/// The console origin for links in e-mails: `GMED_CONSOLE_URL`, otherwise the
/// first `https://` entry of `CORS_ORIGIN` (the console itself).
fn console_url_from(explicit: Option<String>, cors_origin: &str) -> Option<String> {
    explicit
        .or_else(|| {
            cors_origin
                .split(',')
                .map(str::trim)
                .find(|origin| origin.starts_with("https://"))
                .map(str::to_string)
        })
        .map(|url| url.trim_end_matches('/').to_string())
}

#[derive(Clone, Default)]
pub struct MachineTranslationConfig {
    /// Base URL of the internal service, e.g. `http://machine-translation:8092`.
    pub service_url: Option<String>,
}

#[derive(Clone, Default)]
pub struct MedicationAiConfig {
    pub enabled: bool,
    pub explicitly_configured: bool,
    pub patient_data_transfer_approved: bool,
    /// Opaque identifier of the environment-specific governance approval.
    /// Kept server-side and intentionally excluded from capability payloads.
    pub governance_review_id: Option<String>,
    pub openai_api_key: Option<SecretString>,
    pub openai_model: Option<String>,
}

fn env_flag(name: &str) -> (bool, bool) {
    match std::env::var(name) {
        Ok(value) => {
            let enabled = match value.trim().to_ascii_lowercase().as_str() {
                "1" | "true" | "yes" | "on" => true,
                "0" | "false" | "no" | "off" | "" => false,
                _ => panic!("{name} must be a boolean (true/false)"),
            };
            (enabled, true)
        }
        Err(_) => (false, false),
    }
}

impl Config {
    pub fn from_env() -> Self {
        let port: u16 = std::env::var("PORT")
            .ok()
            .and_then(|p| p.parse().ok())
            .unwrap_or(3000);

        let jwt_secret = std::env::var("JWT_SECRET")
            .expect("JWT_SECRET must be set. Generate with: openssl rand -base64 48");

        if jwt_secret.len() < 32 {
            panic!("JWT_SECRET must be at least 32 characters");
        }
        if jwt_secret == "dev-only-secret-minimum-32-characters-long!!"
            || jwt_secret == "change-me-in-production"
        {
            panic!("JWT_SECRET is set to a known placeholder value — rotate immediately");
        }

        let message_key_registry = KeyRegistry::from_env().unwrap_or_else(|e| {
            panic!(
                "Failed to load message encryption keys: {e}. Set MESSAGE_ENCRYPTION_KEYS=v1:<base64 32 bytes> (generate with: openssl rand -base64 32)."
            )
        });

        let audit_ip_salt = std::env::var("AUDIT_IP_SALT").unwrap_or_else(|_| {
            tracing::warn!(
                "AUDIT_IP_SALT is not set — reusing JWT_SECRET as the salt. Rotating JWT_SECRET will \
                 invalidate all historical audit-IP hash correlations. Set a dedicated AUDIT_IP_SALT \
                 (e.g. `openssl rand -base64 32`) to keep hash stability across rotations."
            );
            jwt_secret.clone()
        });

        // Empty METRICS_LISTEN disables the endpoint. Unset uses the
        // default (`0.0.0.0:9091`). Anything else must parse to a valid
        // socket address.
        let metrics_listen = match std::env::var("METRICS_LISTEN") {
            Ok(s) if s.trim().is_empty() => None,
            Ok(s) => Some(s.parse().unwrap_or_else(|e| {
                panic!("METRICS_LISTEN ({s}) is not a valid socket address: {e}")
            })),
            Err(_) => Some(SocketAddr::from(([0, 0, 0, 0], 9091))),
        };

        let gba_ais_download_url = std::env::var("GMED_GBA_AIS_DOWNLOAD_URL")
            .ok()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .map(SecretString::from);

        let (medication_ai_enabled, medication_ai_explicitly_configured) =
            env_flag("GMED_MEDICATION_AI_ENABLED");
        let (patient_data_transfer_approved, _) =
            env_flag("GMED_MEDICATION_AI_DATA_TRANSFER_APPROVED");
        let governance_review_id = std::env::var("GMED_MEDICATION_AI_GOVERNANCE_REVIEW_ID")
            .ok()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty());
        let openai_api_key = std::env::var("GMED_OPENAI_API_KEY")
            .ok()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .map(SecretString::from);
        let openai_model = std::env::var("GMED_OPENAI_MODEL")
            .ok()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty());
        let machine_translation_url = std::env::var("GMED_MACHINE_TRANSLATION_URL")
            .ok()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty());
        if let Some(url) = &machine_translation_url
            && !(url.starts_with("http://") || url.starts_with("https://"))
        {
            panic!("GMED_MACHINE_TRANSLATION_URL must be an http(s):// URL");
        }
        if let Some(model) = &openai_model
            && (model.len() > 96
                || !model
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.')))
        {
            panic!("GMED_OPENAI_MODEL contains unsupported characters");
        }

        let cors_origin =
            std::env::var("CORS_ORIGIN").unwrap_or_else(|_| "http://localhost:8080".into());
        let mittaro_api_url = env_text("GMED_MITTARO_API_URL");
        let console_url = console_url_from(env_text("GMED_CONSOLE_URL"), &cors_origin);
        for (name, url) in [
            ("GMED_MITTARO_API_URL", &mittaro_api_url),
            ("GMED_CONSOLE_URL", &console_url),
        ] {
            if let Some(url) = url
                && !url.starts_with("https://")
            {
                panic!("{name} must be an https:// URL");
            }
        }
        let mail = MailConfig {
            mittaro_api_key: env_text("GMED_MITTARO_API_KEY").map(SecretString::from),
            mittaro_api_url,
            from: env_text("GMED_MAIL_FROM"),
            reply_to: env_text("GMED_MAIL_REPLY_TO"),
            console_url,
        };

        Self {
            database_url: std::env::var("DATABASE_URL").expect("DATABASE_URL must be set"),
            listen_addr: SocketAddr::from(([0, 0, 0, 0], port)),
            jwt_secret,
            cors_origin,
            message_key_registry,
            audit_ip_salt,
            metrics_listen,
            gba_ais_download_url,
            medication_ai: MedicationAiConfig {
                enabled: medication_ai_enabled,
                explicitly_configured: medication_ai_explicitly_configured,
                patient_data_transfer_approved,
                governance_review_id,
                openai_api_key,
                openai_model,
            },
            machine_translation: MachineTranslationConfig {
                service_url: machine_translation_url,
            },
            mail,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn console_url_falls_back_to_the_first_https_cors_origin() {
        assert_eq!(
            console_url_from(
                None,
                "http://localhost:5173, https://console.gmed-health.com/"
            )
            .as_deref(),
            Some("https://console.gmed-health.com")
        );
        assert_eq!(
            console_url_from(
                Some("https://console-dev.gmed-health.com".into()),
                "https://other.example"
            )
            .as_deref(),
            Some("https://console-dev.gmed-health.com")
        );
        assert_eq!(console_url_from(None, "http://localhost:8080"), None);
    }
}
