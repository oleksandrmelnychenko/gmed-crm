//! The Mittaro connection entered on the API connections page (owner decision
//! 2026-10-05: every external key on one page, `/admin/api-connections`).
//!
//! The API key is stored encrypted with the server key registry, like the
//! Skribble connection, and never returned. A saved connection takes
//! precedence over the `GMED_MITTARO_*` environment; "disconnect" stores a
//! disabled row, which switches e-mail off even when the environment still
//! has a key. API and console URL always come from the environment.

use std::sync::{Arc, Mutex};

use axum::{
    Extension, Json, Router,
    extract::{DefaultBodyLimit, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{get, post},
};
use gmed_domain::access::capabilities::Capability;
use secrecy::{ExposeSecret, SecretString};
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::Row;
use uuid::Uuid;

use super::templates::{self, ConnectionTestEmail, MailLanguage};
use super::{Mailer, OutgoingEmail, coded, error_response};
use crate::config::MailConfig;
use crate::routes::lead_portal_account::normalize_portal_email;
use crate::{audit, auth::middleware::AuthUser, state::AppState};

pub type Cache = Mutex<Option<(Uuid, Arc<Mailer>)>>;

const SERVICE: &str = "mail-mittaro-v1";
const MAX_KEY_LENGTH: usize = 512;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/mail/connection", get(status).post(save))
        .route("/mail/connection/test", post(send_test))
        .route("/mail/connection/disconnect", post(disconnect))
        .layer(DefaultBodyLimit::max(16 * 1024))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct StoredCredentials {
    service: String,
    api_key: SecretString,
}

enum Source {
    Database,
    Disconnected,
    Environment,
}

/// The mailer every sender uses: the saved connection, otherwise the
/// environment.
pub async fn current_mailer(state: &AppState) -> Result<Arc<Mailer>, &'static str> {
    Ok(resolve(state).await?.0)
}

async fn resolve(state: &AppState) -> Result<(Arc<Mailer>, Source), &'static str> {
    let row = sqlx::query(
        "SELECT revision, enabled, sender, reply_to, ciphertext, nonce, key_id
         FROM mail_provider_connection WHERE singleton",
    )
    .fetch_optional(&state.db)
    .await
    .map_err(|_| "mail_connection_database_error")?;
    let Some(row) = row else {
        return Ok((state.mailer.clone(), Source::Environment));
    };
    if !row.get::<bool, _>("enabled") {
        return Ok((
            Arc::new(Mailer::off("mail_disconnected")),
            Source::Disconnected,
        ));
    }
    let revision: Uuid = row.get("revision");
    let mut cached = state
        .mail_connection_cache
        .lock()
        .map_err(|_| "mail_connection_unavailable")?;
    if let Some((cached_revision, mailer)) = cached.as_ref()
        && *cached_revision == revision
    {
        return Ok((mailer.clone(), Source::Database));
    }
    let plaintext = state
        .message_keys
        .decrypt_to_string(
            &row.get::<String, _>("key_id"),
            &row.get::<Vec<u8>, _>("ciphertext"),
            &row.get::<Vec<u8>, _>("nonce"),
        )
        .map_err(|_| "mail_connection_decryption_failed")?;
    let credentials: StoredCredentials =
        serde_json::from_str(&plaintext).map_err(|_| "mail_connection_invalid")?;
    if credentials.service != SERVICE {
        return Err("mail_connection_invalid");
    }
    let mailer = Arc::new(Mailer::new(MailConfig {
        mittaro_api_key: Some(credentials.api_key),
        mittaro_api_url: state.mail_config.mittaro_api_url.clone(),
        from: row.get("sender"),
        reply_to: row.get("reply_to"),
        console_url: state.mail_config.console_url.clone(),
    }));
    *cached = Some((revision, mailer.clone()));
    Ok((mailer, Source::Database))
}

fn require_admin(auth: &AuthUser) -> Result<(), Response> {
    // The same roles as the API connections page (CEO, IT admin).
    auth.require_capability(Capability::AdminSignatures)
}

fn connection_error(code: &'static str) -> Response {
    coded(
        StatusCode::SERVICE_UNAVAILABLE,
        code,
        "Mail connection unavailable",
    )
}

fn db_error(error: sqlx::Error) -> Response {
    tracing::error!(%error, "mail connection");
    coded(StatusCode::INTERNAL_SERVER_ERROR, "internal", "Failed")
}

async fn info(state: &AppState) -> Result<Value, Response> {
    let (mailer, source) = resolve(state).await.map_err(connection_error)?;
    let capability = mailer.capability();
    let summary = mailer.summary();
    Ok(json!({
        "provider": super::PROVIDER_ID,
        "configured": capability.available,
        "reason_code": capability.reason_code,
        "source": match source {
            Source::Database => "database",
            Source::Disconnected => "disconnected",
            Source::Environment if summary.is_some() => "environment",
            Source::Environment => "none",
        },
        "sender": summary.as_ref().map(|summary| summary.sender.clone()),
        "reply_to": summary.as_ref().and_then(|summary| summary.reply_to.clone()),
        "key_hint": summary.as_ref().map(|summary| summary.key_hint.clone()),
        // Links in e-mails point here; it comes from the server configuration.
        "console_url": state.mail_config.console_url,
    }))
}

/// `GET /mail/connection`: what is set up, without the key.
async fn status(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
) -> Result<Json<Value>, Response> {
    require_admin(&auth)?;
    Ok(Json(info(&state).await?))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct SaveBody {
    /// Empty or missing keeps the saved key (changing only the sender).
    #[serde(default)]
    api_key: Option<SecretString>,
    sender: String,
    #[serde(default)]
    reply_to: Option<String>,
}

/// Mittaro keys look like `tx_live_…` / `tx_test_…`.
fn valid_key(key: &str) -> bool {
    key.starts_with("tx_")
        && key.len() <= MAX_KEY_LENGTH
        && key.len() > 8
        && key
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-' | b'.'))
}

/// `POST /mail/connection`: saves key, sender and reply-to. Mittaro has no
/// endpoint that checks a key without sending, so the page offers a test
/// letter right after saving.
async fn save(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Json(body): Json<SaveBody>,
) -> Result<Json<Value>, Response> {
    require_admin(&auth)?;
    let Some(sender) = normalize_portal_email(Some(&body.sender)) else {
        return Err(coded(
            StatusCode::UNPROCESSABLE_ENTITY,
            "mail_sender_invalid",
            "The sender must be an e-mail address",
        ));
    };
    let reply_to = match body
        .reply_to
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        None => None,
        Some(value) => Some(normalize_portal_email(Some(value)).ok_or_else(|| {
            coded(
                StatusCode::UNPROCESSABLE_ENTITY,
                "mail_reply_to_invalid",
                "The reply-to address is not an e-mail address",
            )
        })?),
    };
    let new_key = body
        .api_key
        .as_ref()
        .map(|key| key.expose_secret().trim().to_string())
        .filter(|key| !key.is_empty());
    if let Some(key) = &new_key
        && !valid_key(key)
    {
        return Err(coded(
            StatusCode::UNPROCESSABLE_ENTITY,
            "mail_api_key_invalid",
            "A Mittaro API key starts with tx_",
        ));
    }

    let mut tx = state.db.begin().await.map_err(db_error)?;
    let existing = sqlx::query(
        "SELECT enabled, ciphertext, nonce, key_id FROM mail_provider_connection
         WHERE singleton FOR UPDATE",
    )
    .fetch_optional(&mut *tx)
    .await
    .map_err(db_error)?;
    let key_changed = new_key.is_some();
    let api_key = match new_key {
        Some(key) => key,
        None => {
            // Keep the saved key; there is none after a disconnect.
            let saved = existing
                .as_ref()
                .filter(|row| row.get::<bool, _>("enabled"))
                .ok_or_else(|| {
                    coded(
                        StatusCode::UNPROCESSABLE_ENTITY,
                        "mail_api_key_required",
                        "Enter the Mittaro API key",
                    )
                })?;
            let plaintext = state
                .message_keys
                .decrypt_to_string(
                    &saved.get::<String, _>("key_id"),
                    &saved.get::<Vec<u8>, _>("ciphertext"),
                    &saved.get::<Vec<u8>, _>("nonce"),
                )
                .map_err(|_| connection_error("mail_connection_decryption_failed"))?;
            let stored: StoredCredentials = serde_json::from_str(&plaintext)
                .map_err(|_| connection_error("mail_connection_invalid"))?;
            stored.api_key.expose_secret().to_string()
        }
    };
    let plaintext = json!({ "service": SERVICE, "api_key": api_key }).to_string();
    let (ciphertext, nonce, key_id) = state.message_keys.encrypt_str(&plaintext).map_err(|_| {
        coded(
            StatusCode::INTERNAL_SERVER_ERROR,
            "mail_encryption_failed",
            "Failed",
        )
    })?;
    sqlx::query(
        r#"INSERT INTO mail_provider_connection
               (singleton, revision, enabled, sender, reply_to, ciphertext, nonce, key_id, updated_by)
           VALUES (true, $1, true, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (singleton) DO UPDATE
           SET revision = EXCLUDED.revision, enabled = true, sender = EXCLUDED.sender,
               reply_to = EXCLUDED.reply_to, ciphertext = EXCLUDED.ciphertext,
               nonce = EXCLUDED.nonce, key_id = EXCLUDED.key_id,
               updated_by = EXCLUDED.updated_by, updated_at = now()"#,
    )
    .bind(Uuid::new_v4())
    .bind(&sender)
    .bind(&reply_to)
    .bind(ciphertext)
    .bind(nonce)
    .bind(key_id)
    .bind(auth.user_id)
    .execute(&mut *tx)
    .await
    .map_err(db_error)?;
    tx.commit().await.map_err(db_error)?;
    if let Ok(mut cached) = state.mail_connection_cache.lock() {
        *cached = None;
    }
    state.audit_sender.try_send(audit::domain_event(
        "mail_connection_saved",
        Some(auth.user_id),
        "mail_connection",
        None,
        json!({
            "provider": super::PROVIDER_ID,
            "sender_domain": sender.split_once('@').map(|(_, domain)| domain),
            "key_changed": key_changed,
        }),
    ));
    Ok(Json(info(&state).await?))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct TestBody {
    /// Defaults to the address of the signed-in user.
    #[serde(default)]
    to: Option<String>,
    #[serde(default)]
    language: Option<String>,
}

/// `POST /mail/connection/test`: a branded test letter through the current
/// connection, without patient data.
async fn send_test(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Json(body): Json<TestBody>,
) -> Response {
    if let Err(response) = require_admin(&auth) {
        return response;
    }
    let mailer = match current_mailer(&state).await {
        Ok(mailer) => mailer,
        Err(code) => return connection_error(code),
    };
    let Some(console_url) = mailer.console_url().map(str::to_string) else {
        return error_response(&super::MailError::NotConfigured);
    };
    let Some(summary) = mailer.summary() else {
        return error_response(&super::MailError::NotConfigured);
    };
    let me = sqlx::query("SELECT email, name FROM users WHERE id = $1")
        .bind(auth.user_id)
        .fetch_optional(&state.db)
        .await;
    let (own_email, own_name) = match me {
        Ok(Some(row)) => (
            row.try_get::<String, _>("email").unwrap_or_default(),
            row.try_get::<String, _>("name").unwrap_or_default(),
        ),
        Ok(None) => (String::new(), String::new()),
        Err(error) => return db_error(error),
    };
    let target = body
        .to
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(&own_email)
        .to_string();
    let Some(to) = normalize_portal_email(Some(&target)) else {
        return coded(
            StatusCode::UNPROCESSABLE_ENTITY,
            "mail_test_recipient_invalid",
            "Enter the address that receives the test letter",
        );
    };
    let agency = super::agency_identity(&state.db).await;
    let logo_url = templates::logo_url(&console_url);
    let requested_at = crate::app_time::local(chrono::Utc::now())
        .format("%d.%m.%Y %H:%M")
        .to_string();
    let rendered = templates::connection_test(&ConnectionTestEmail {
        language: MailLanguage::from_code(body.language.as_deref()),
        requested_by: &own_name,
        requested_at: &requested_at,
        sender: &summary.sender,
        agency: &agency,
        logo_url: Some(&logo_url),
    });
    let result = mailer
        .send(&OutgoingEmail {
            to: to.clone(),
            subject: rendered.subject,
            text: rendered.text,
            html: rendered.html,
            idempotency_key: format!("gmed-connection-test-{}", Uuid::new_v4()),
        })
        .await;
    state.audit_sender.try_send(audit::domain_event(
        "mail_connection_test_sent",
        Some(auth.user_id),
        "mail_connection",
        None,
        json!({
            "provider": super::PROVIDER_ID,
            "recipient_domain": to.split_once('@').map(|(_, domain)| domain),
            "ok": result.is_ok(),
            "error_code": result.as_ref().err().map(super::MailError::code),
        }),
    ));
    match result {
        Ok(sent) => Json(json!({ "sent_to": to, "message_id": sent.message_id })).into_response(),
        Err(error) => error_response(&error),
    }
}

/// `POST /mail/connection/disconnect`: switches e-mail off, also over a key
/// in the environment, and forgets the saved key.
async fn disconnect(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
) -> Result<Json<Value>, Response> {
    require_admin(&auth)?;
    sqlx::query(
        r#"INSERT INTO mail_provider_connection (singleton, revision, enabled, updated_by)
           VALUES (true, $1, false, $2)
           ON CONFLICT (singleton) DO UPDATE
           SET revision = EXCLUDED.revision, enabled = false, sender = NULL, reply_to = NULL,
               ciphertext = NULL, nonce = NULL, key_id = NULL,
               updated_by = EXCLUDED.updated_by, updated_at = now()"#,
    )
    .bind(Uuid::new_v4())
    .bind(auth.user_id)
    .execute(&state.db)
    .await
    .map_err(db_error)?;
    if let Ok(mut cached) = state.mail_connection_cache.lock() {
        *cached = None;
    }
    state.audit_sender.try_send(audit::domain_event(
        "mail_connection_disconnected",
        Some(auth.user_id),
        "mail_connection",
        None,
        json!({ "provider": super::PROVIDER_ID }),
    ));
    Ok(Json(info(&state).await?))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_mittaro_shaped_keys_are_accepted() {
        assert!(valid_key("tx_live_AbC123xyz"));
        assert!(valid_key("tx_test_abc-123.def"));
        for invalid in [
            "",
            "tx_",
            "live_abc123456",
            "tx_live abc",
            "tx_live_ä123456",
        ] {
            assert!(!valid_key(invalid), "{invalid}");
        }
        assert!(!valid_key(&format!("tx_live_{}", "a".repeat(600))));
    }

    #[test]
    fn the_key_hint_shows_only_the_last_four_characters() {
        assert_eq!(super::super::key_hint("tx_live_secretABCD"), "…ABCD");
        assert_eq!(super::super::key_hint("abc"), "…abc");
    }
}
