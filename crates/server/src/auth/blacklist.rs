use chrono::{DateTime, Utc};
use sqlx::PgPool;
use uuid::Uuid;

/// Checks whether an access token's `jti` has been explicitly revoked.
///
/// Called on every authenticated request from the `require_auth` middleware.
/// The lookup is a single indexed primary-key query — cost is negligible.
pub async fn is_revoked(pool: &PgPool, jti: Uuid) -> Result<bool, sqlx::Error> {
    let row = sqlx::query("SELECT 1 AS one FROM revoked_access_tokens WHERE jti = $1 LIMIT 1")
        .bind(jti)
        .fetch_optional(pool)
        .await?;
    Ok(row.is_some())
}

/// Inserts a token into the revocation list.
///
/// `expires_at` should be the original JWT `exp` — once that passes, the
/// entry stops serving any purpose and will be swept by `purge_expired`.
pub async fn revoke_token(
    pool: &PgPool,
    jti: Uuid,
    user_id: Uuid,
    family_id: Uuid,
    expires_at: DateTime<Utc>,
    reason: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO revoked_access_tokens (jti, user_id, family_id, expires_at, reason)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (jti) DO NOTHING",
    )
    .bind(jti)
    .bind(user_id)
    .bind(family_id)
    .bind(expires_at)
    .bind(reason)
    .execute(pool)
    .await?;
    Ok(())
}

/// Revokes every outstanding access token attached to a refresh-token family.
///
/// We do NOT know the individual access-token jtis here — we record a family
/// marker by inserting a sentinel row keyed on the family. The middleware
/// additionally checks `family_revoked` for the token's family id.
pub async fn blacklist_family(
    pool: &PgPool,
    family_id: Uuid,
    reason: &str,
) -> Result<(), sqlx::Error> {
    // Sentinel row: jti = family_id so the PK stays unique per family marker.
    // expires_at set to now() + 30 days; swept when that passes.
    let expires_at = Utc::now() + chrono::Duration::days(30);
    let sentinel_user = Uuid::nil();
    sqlx::query(
        "INSERT INTO revoked_access_tokens (jti, user_id, family_id, expires_at, reason)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (jti) DO NOTHING",
    )
    .bind(family_id)
    .bind(sentinel_user)
    .bind(family_id)
    .bind(expires_at)
    .bind(reason)
    .execute(pool)
    .await?;
    Ok(())
}

/// Returns true if the token's family has been revoked wholesale.
pub async fn is_family_revoked(pool: &PgPool, family_id: Uuid) -> Result<bool, sqlx::Error> {
    let row =
        sqlx::query("SELECT 1 AS one FROM revoked_access_tokens WHERE family_id = $1 LIMIT 1")
            .bind(family_id)
            .fetch_optional(pool)
            .await?;
    Ok(row.is_some())
}

/// Drops rows whose `expires_at` has passed. Returns number of removed rows.
pub async fn purge_expired(pool: &PgPool) -> Result<u64, sqlx::Error> {
    let result = sqlx::query("DELETE FROM revoked_access_tokens WHERE expires_at < NOW()")
        .execute(pool)
        .await?;
    Ok(result.rows_affected())
}
