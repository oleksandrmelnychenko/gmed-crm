use chrono::{Duration, Utc};
use rand::Rng;
use sha2::{Digest, Sha256};
use sqlx::PgPool;
use uuid::Uuid;

use super::{blacklist, jwt};
use crate::settings::TokenSettings;

const REFRESH_TOKEN_BYTES: usize = 48;

fn generate_refresh_token() -> (String, String) {
    let mut bytes = [0u8; REFRESH_TOKEN_BYTES];
    rand::rng().fill(&mut bytes);
    let raw = hex::encode(bytes);
    let hash = hex::encode(Sha256::digest(raw.as_bytes()));
    (raw, hash)
}

pub fn hash_token(raw: &str) -> String {
    hex::encode(Sha256::digest(raw.as_bytes()))
}

pub struct TokenPair {
    pub access_token: String,
    pub refresh_token: String,
    pub expires_in: i64,
}

#[allow(clippy::too_many_arguments)]
pub async fn create_session(
    pool: &PgPool,
    jwt_secret: &str,
    user_id: Uuid,
    role: &str,
    device_fingerprint: Option<&str>,
    ip_address: Option<&str>,
    user_agent: Option<&str>,
    settings: &TokenSettings,
) -> Result<TokenPair, TokenError> {
    let family = sqlx::query!(
        "INSERT INTO token_families (user_id, device_fingerprint, ip_address, user_agent)
         VALUES ($1, $2, $3, $4) RETURNING id",
        user_id,
        device_fingerprint,
        ip_address,
        user_agent
    )
    .fetch_one(pool)
    .await
    .map_err(|e| {
        tracing::error!(user_id = %user_id, error = %e, "Failed to create token family");
        TokenError::Internal
    })?;

    let (raw_refresh, refresh_hash) = generate_refresh_token();
    let expires_at = Utc::now() + Duration::days(settings.refresh_token_days);

    sqlx::query!(
        "INSERT INTO refresh_tokens (family_id, token_hash, expires_at) VALUES ($1, $2, $3)",
        family.id,
        refresh_hash,
        expires_at
    )
    .execute(pool)
    .await
    .map_err(|e| {
        tracing::error!(family_id = %family.id, error = %e, "Failed to create refresh token");
        TokenError::Internal
    })?;

    let access_token = jwt::issue_access_token_with_duration(
        jwt_secret,
        user_id,
        role,
        family.id,
        settings.access_token_minutes,
    )
    .map_err(|e| {
        tracing::error!(error = %e, "Failed to issue access token");
        TokenError::Internal
    })?;

    if let Err(e) = sqlx::query!(
        "INSERT INTO audit_log (user_id, action, entity_type, entity_id, context)
         VALUES ($1, 'login', 'token_family', $2, $3)",
        user_id,
        family.id,
        serde_json::json!({ "ip": ip_address, "device": device_fingerprint })
    )
    .execute(pool)
    .await
    {
        tracing::warn!(error = %e, "Failed to write login audit log");
    }

    Ok(TokenPair {
        access_token,
        refresh_token: raw_refresh,
        expires_in: settings.access_token_minutes * 60,
    })
}

pub async fn rotate_refresh_token(
    pool: &PgPool,
    jwt_secret: &str,
    raw_refresh_token: &str,
    settings: &TokenSettings,
) -> Result<TokenPair, TokenError> {
    let token_hash = hash_token(raw_refresh_token);

    let row = sqlx::query!(
        r#"SELECT rt.id AS rt_id, rt.family_id, rt.is_used, rt.expires_at,
                  tf.user_id, tf.is_revoked,
                  u.role
           FROM refresh_tokens rt
           JOIN token_families tf ON tf.id = rt.family_id
           JOIN users u ON u.id = tf.user_id
           WHERE rt.token_hash = $1"#,
        token_hash
    )
    .fetch_optional(pool)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, "DB error during token rotation");
        TokenError::Internal
    })?
    .ok_or(TokenError::InvalidToken)?;

    if row.is_revoked {
        return Err(TokenError::FamilyRevoked);
    }

    if row.expires_at < Utc::now() {
        return Err(TokenError::Expired);
    }

    // THEFT DETECTION
    if row.is_used {
        tracing::warn!(
            family_id = %row.family_id,
            user_id = %row.user_id,
            "Refresh token reuse detected — revoking entire family"
        );
        revoke_family(pool, row.family_id, "refresh_token_reuse_detected").await;

        if let Err(e) = sqlx::query!(
            "INSERT INTO audit_log (user_id, action, entity_type, entity_id, context)
             VALUES ($1, 'token_theft_detected', 'token_family', $2, $3)",
            row.user_id,
            row.family_id,
            serde_json::json!({ "detail": "Refresh token reuse — family revoked" })
        )
        .execute(pool)
        .await
        {
            tracing::error!(error = %e, "Failed to write theft audit log");
        }

        return Err(TokenError::TheftDetected);
    }

    sqlx::query!(
        "UPDATE refresh_tokens SET is_used = true, used_at = now() WHERE id = $1",
        row.rt_id
    )
    .execute(pool)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, "Failed to mark token as used");
        TokenError::Internal
    })?;

    let (new_raw, new_hash) = generate_refresh_token();
    let new_expires = Utc::now() + Duration::days(settings.refresh_token_days);

    sqlx::query!(
        "INSERT INTO refresh_tokens (family_id, token_hash, expires_at) VALUES ($1, $2, $3)",
        row.family_id,
        new_hash,
        new_expires
    )
    .execute(pool)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, "Failed to create new refresh token");
        TokenError::Internal
    })?;

    sqlx::query!(
        "UPDATE token_families SET last_activity_at = now() WHERE id = $1",
        row.family_id
    )
    .execute(pool)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, "Failed to update family activity");
        TokenError::Internal
    })?;

    let access_token = jwt::issue_access_token_with_duration(
        jwt_secret,
        row.user_id,
        &row.role,
        row.family_id,
        settings.access_token_minutes,
    )
    .map_err(|e| {
        tracing::error!(error = %e, "Failed to issue access token on refresh");
        TokenError::Internal
    })?;

    Ok(TokenPair {
        access_token,
        refresh_token: new_raw,
        expires_in: settings.access_token_minutes * 60,
    })
}

pub async fn revoke_family(pool: &PgPool, family_id: Uuid, reason: &str) {
    if let Err(e) = sqlx::query!(
        "UPDATE token_families SET is_revoked = true, revoked_reason = $2 WHERE id = $1",
        family_id,
        reason
    )
    .execute(pool)
    .await
    {
        tracing::error!(family_id = %family_id, error = %e, "Failed to revoke token family");
    }
    if let Err(e) = blacklist::blacklist_family(pool, family_id, reason).await {
        tracing::error!(family_id = %family_id, error = %e, "Failed to add family to access-token blacklist");
    }
}

pub async fn revoke_all_families(pool: &PgPool, user_id: Uuid, reason: &str) {
    let families: Vec<Uuid> = sqlx::query_scalar::<_, Uuid>(
        "SELECT id FROM token_families WHERE user_id = $1 AND NOT is_revoked",
    )
    .bind(user_id)
    .fetch_all(pool)
    .await
    .unwrap_or_default();

    if let Err(e) = sqlx::query!(
        "UPDATE token_families SET is_revoked = true, revoked_reason = $2
         WHERE user_id = $1 AND NOT is_revoked",
        user_id,
        reason
    )
    .execute(pool)
    .await
    {
        tracing::error!(user_id = %user_id, error = %e, "Failed to revoke all families");
    }

    for family_id in families {
        if let Err(e) = blacklist::blacklist_family(pool, family_id, reason).await {
            tracing::error!(family_id = %family_id, error = %e, "Failed to add family to access-token blacklist");
        }
    }

    if let Err(e) = sqlx::query!(
        "INSERT INTO audit_log (user_id, action, entity_type, context)
         VALUES ($1, 'revoke_all_sessions', 'token_family', $2)",
        user_id,
        serde_json::json!({ "reason": reason })
    )
    .execute(pool)
    .await
    {
        tracing::warn!(error = %e, "Failed to write revoke-all audit log");
    }
}

/// Revoke all sessions for ALL users (admin force-logout-all).
pub async fn revoke_all_users(pool: &PgPool, admin_id: Uuid, reason: &str) {
    let families: Vec<Uuid> =
        sqlx::query_scalar::<_, Uuid>("SELECT id FROM token_families WHERE NOT is_revoked")
            .fetch_all(pool)
            .await
            .unwrap_or_default();

    if let Err(e) = sqlx::query!(
        "UPDATE token_families SET is_revoked = true, revoked_reason = $1 WHERE NOT is_revoked",
        reason
    )
    .execute(pool)
    .await
    {
        tracing::error!(error = %e, "Failed to revoke all user sessions");
    }

    for family_id in families {
        if let Err(e) = blacklist::blacklist_family(pool, family_id, reason).await {
            tracing::error!(family_id = %family_id, error = %e, "Failed to add family to access-token blacklist");
        }
    }

    if let Err(e) = sqlx::query!(
        "INSERT INTO audit_log (user_id, action, entity_type, context)
         VALUES ($1, 'revoke_all_users_sessions', 'token_family', $2)",
        admin_id,
        serde_json::json!({ "reason": reason })
    )
    .execute(pool)
    .await
    {
        tracing::warn!(error = %e, "Failed to write revoke-all-users audit log");
    }
}

// --- Types ---

#[derive(Debug)]
pub enum TokenError {
    InvalidToken,
    Expired,
    FamilyRevoked,
    TheftDetected,
    Internal,
}

impl std::fmt::Display for TokenError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            TokenError::InvalidToken => write!(f, "Invalid refresh token"),
            TokenError::Expired => write!(f, "Refresh token expired"),
            TokenError::FamilyRevoked => write!(f, "Session revoked"),
            TokenError::TheftDetected => write!(f, "Token reuse detected — all sessions revoked"),
            TokenError::Internal => write!(f, "Internal error"),
        }
    }
}
