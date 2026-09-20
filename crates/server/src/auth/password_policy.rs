//! Password policy and history shared by the administrator reset
//! (`POST /users/{id}/reset-password`) and the self-service change
//! (`PUT /me/password`). Both paths must apply exactly the same rules, so the
//! policy check, the recent-history check and the column update live here.

use sqlx::PgPool;
use uuid::Uuid;

use super::password;

/// How many previous hashes (including the current one) a new password is
/// compared against.
pub const PASSWORD_HISTORY_LIMIT: i64 = 5;

const PASSWORD_POLICY_MESSAGE: &str =
    "Password must contain uppercase and lowercase letters, a number, and a symbol";
const PASSWORD_REUSED_MESSAGE: &str = "Password was used recently; choose a new one";

#[derive(Debug)]
pub enum PasswordChangeError {
    /// The new password violates the policy or repeats a recent one. The
    /// message is safe to show to the caller.
    Rejected(&'static str),
    /// No user row was updated.
    NotFound,
    Internal,
}

impl PasswordChangeError {
    pub fn message(&self) -> &'static str {
        match self {
            PasswordChangeError::Rejected(message) => message,
            PasswordChangeError::NotFound => "User not found",
            PasswordChangeError::Internal => "Failed to change password",
        }
    }
}

pub fn validate_password_policy(password: &str) -> Result<(), &'static str> {
    if password.len() < 8 || password.len() > 256 {
        return Err("Password must be 8-256 characters");
    }

    let has_lowercase = password.chars().any(|ch| ch.is_ascii_lowercase());
    let has_uppercase = password.chars().any(|ch| ch.is_ascii_uppercase());
    let has_digit = password.chars().any(|ch| ch.is_ascii_digit());
    let has_symbol = password.chars().any(|ch| !ch.is_ascii_alphanumeric());

    if !(has_lowercase && has_uppercase && has_digit && has_symbol) {
        return Err(PASSWORD_POLICY_MESSAGE);
    }

    Ok(())
}

/// The current hash plus the most recent history entries, newest first.
async fn recent_password_hashes(db: &PgPool, user_id: Uuid) -> Result<Vec<String>, sqlx::Error> {
    sqlx::query_scalar(
        r#"SELECT hash FROM (
               SELECT password_hash AS hash, 2147483647 AS age FROM users WHERE id = $1
               UNION ALL
               SELECT entry.value #>> '{}', entry.ordinality::int
               FROM users u,
                    jsonb_array_elements(COALESCE(u.password_history, '[]'::jsonb))
                        WITH ORDINALITY AS entry(value, ordinality)
               WHERE u.id = $1
               ORDER BY age DESC
               LIMIT $2
           ) recent
           WHERE hash IS NOT NULL"#,
    )
    .bind(user_id)
    .bind(PASSWORD_HISTORY_LIMIT)
    .fetch_all(db)
    .await
}

/// Validate `new_password` against the policy and the user's recent history,
/// then store its hash. The previous hash is appended to `password_history`,
/// `password_changed_at` is refreshed, any forced reset flag is cleared and the
/// login lockout counters are reset. Session revocation and auditing are left
/// to the caller because they differ between an admin reset and a self-service
/// change.
pub async fn replace_password(
    db: &PgPool,
    user_id: Uuid,
    new_password: &str,
) -> Result<(), PasswordChangeError> {
    validate_password_policy(new_password).map_err(PasswordChangeError::Rejected)?;

    // The history was recorded on every reset but never consulted, so the 90-day
    // expiry could be satisfied by setting the same password again.
    let previous_hashes = recent_password_hashes(db, user_id).await.map_err(|error| {
        tracing::error!(%error, %user_id, "Failed to load password history");
        PasswordChangeError::Internal
    })?;
    if previous_hashes
        .iter()
        .any(|hash| password::verify_password(new_password, hash).unwrap_or(false))
    {
        return Err(PasswordChangeError::Rejected(PASSWORD_REUSED_MESSAGE));
    }

    let hash = password::hash_password(new_password).map_err(|error| {
        tracing::error!(%error, %user_id, "Failed to hash password");
        PasswordChangeError::Internal
    })?;

    let result = sqlx::query(
        r#"UPDATE users
           SET password_history = COALESCE(password_history, '[]'::jsonb)
                                  || jsonb_build_array(password_hash),
               password_hash = $2,
               password_changed_at = now(),
               password_reset_required = false,
               failed_login_attempts = 0,
               locked_until = NULL,
               updated_at = now()
           WHERE id = $1"#,
    )
    .bind(user_id)
    .bind(hash)
    .execute(db)
    .await
    .map_err(|error| {
        tracing::error!(%error, %user_id, "Failed to store new password");
        PasswordChangeError::Internal
    })?;

    if result.rows_affected() == 0 {
        return Err(PasswordChangeError::NotFound);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn policy_requires_all_character_classes() {
        assert!(validate_password_policy("Replacement-password-2!").is_ok());
        assert_eq!(
            validate_password_policy("short1!A"),
            Ok(()),
            "eight characters with every class pass"
        );
        assert_eq!(
            validate_password_policy("Ab1!"),
            Err("Password must be 8-256 characters")
        );
        assert_eq!(
            validate_password_policy("alllowercase1!"),
            Err(PASSWORD_POLICY_MESSAGE)
        );
        assert_eq!(
            validate_password_policy("NoSymbol123"),
            Err(PASSWORD_POLICY_MESSAGE)
        );
        assert_eq!(
            validate_password_policy("NoDigits!!"),
            Err(PASSWORD_POLICY_MESSAGE)
        );
    }
}
