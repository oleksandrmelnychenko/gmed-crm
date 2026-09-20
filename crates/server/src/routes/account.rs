//! Self-service account endpoints for every authenticated user (staff and
//! patients): own password, own profile. Sessions stay on `/auth/sessions`.

use axum::{
    Json, Router,
    extract::{Extension, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{get, put},
};
use serde::Deserialize;
use serde_json::json;
use sqlx::Row;

use crate::audit;
use crate::auth::{middleware::AuthUser, password, password_policy, tokens};
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/me/password", put(change_own_password))
        .route("/me/profile", get(get_own_profile).put(update_own_profile))
}

pub const PROFILE_NAME_MAX: usize = 200;
pub const PROFILE_PHONE_MAX: usize = 40;
pub const SUPPORTED_LANGUAGES: &[&str] = &["ru", "de"];

#[derive(Deserialize)]
struct ChangePasswordRequest {
    current_password: String,
    new_password: String,
}

#[derive(Deserialize)]
struct UpdateProfileRequest {
    name: Option<String>,
    phone: Option<String>,
    preferred_language: Option<String>,
}

/// Normalised profile input, ready to store.
#[derive(Debug, PartialEq, Eq)]
pub struct ProfileInput {
    pub name: Option<String>,
    pub phone: Option<Option<String>>,
    pub preferred_language: Option<Option<String>>,
}

/// Validate the profile body. `None` fields are left untouched; an empty phone
/// or language clears the column.
pub fn validate_profile(
    name: Option<&str>,
    phone: Option<&str>,
    preferred_language: Option<&str>,
) -> Result<ProfileInput, &'static str> {
    let name = match name {
        None => None,
        Some(raw) => {
            let trimmed = raw.trim();
            if trimmed.is_empty() || trimmed.chars().count() > PROFILE_NAME_MAX {
                return Err("Name must be 1-200 characters");
            }
            Some(trimmed.to_string())
        }
    };
    let phone = match phone {
        None => None,
        Some(raw) => {
            let trimmed = raw.trim();
            if trimmed.is_empty() {
                Some(None)
            } else if trimmed.chars().count() > PROFILE_PHONE_MAX
                || !trimmed.chars().all(|ch| {
                    ch.is_ascii_digit() || matches!(ch, '+' | ' ' | '-' | '(' | ')' | '/')
                })
            {
                return Err("Phone must be up to 40 characters: digits, +, spaces, -, ( )");
            } else {
                Some(Some(trimmed.to_string()))
            }
        }
    };
    let preferred_language = match preferred_language {
        None => None,
        Some(raw) => {
            let trimmed = raw.trim().to_ascii_lowercase();
            if trimmed.is_empty() {
                Some(None)
            } else if SUPPORTED_LANGUAGES.contains(&trimmed.as_str()) {
                Some(Some(trimmed))
            } else {
                return Err("Language must be ru or de");
            }
        }
    };
    Ok(ProfileInput {
        name,
        phone,
        preferred_language,
    })
}

async fn change_own_password(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Json(body): Json<ChangePasswordRequest>,
) -> axum::response::Response {
    if body.current_password.is_empty() || body.current_password.len() > 256 {
        return err(
            StatusCode::BAD_REQUEST,
            "invalid_current_password",
            "The current password is incorrect",
        );
    }

    let row = match sqlx::query("SELECT password_hash FROM users WHERE id = $1 AND is_active")
        .bind(auth.user_id)
        .fetch_optional(&state.db)
        .await
    {
        Ok(Some(row)) => row,
        Ok(None) => {
            return err(
                StatusCode::UNAUTHORIZED,
                "unauthorized",
                "Account not found",
            );
        }
        Err(error) => {
            tracing::error!(%error, user_id = %auth.user_id, "load password hash for own change");
            return internal();
        }
    };
    let stored_hash: String = row.try_get("password_hash").unwrap_or_default();
    let current_valid = if stored_hash.starts_with("$argon2") {
        password::verify_password(&body.current_password, &stored_hash).unwrap_or(false)
    } else {
        // Legacy pgcrypto hashes from before the Argon2 migration.
        sqlx::query_scalar::<_, bool>("SELECT ($1::text = crypt($2::text, $1::text))")
            .bind(&stored_hash)
            .bind(&body.current_password)
            .fetch_one(&state.db)
            .await
            .unwrap_or(false)
    };
    if !current_valid {
        state.audit_sender.try_send(audit::domain_event(
            "change_own_password_rejected",
            Some(auth.user_id),
            "user",
            Some(auth.user_id),
            json!({ "reason": "invalid_current_password" }),
        ));
        return err(
            StatusCode::BAD_REQUEST,
            "invalid_current_password",
            "The current password is incorrect",
        );
    }

    match password_policy::replace_password(&state.db, auth.user_id, &body.new_password).await {
        Ok(()) => {}
        Err(password_policy::PasswordChangeError::Rejected(message)) => {
            return err(StatusCode::UNPROCESSABLE_ENTITY, "password_policy", message);
        }
        Err(password_policy::PasswordChangeError::NotFound) => {
            return err(
                StatusCode::UNAUTHORIZED,
                "unauthorized",
                "Account not found",
            );
        }
        Err(password_policy::PasswordChangeError::Internal) => return internal(),
    }

    let _ = sqlx::query(
        "UPDATE pending_logins SET status = 'rejected', resolved_at = now()
         WHERE user_id = $1 AND status IN ('pending', 'approved')",
    )
    .bind(auth.user_id)
    .execute(&state.db)
    .await;
    let revoked =
        tokens::revoke_other_families(&state.db, auth.user_id, auth.family_id, "password_change")
            .await;

    state.audit_sender.try_send(audit::domain_event(
        "change_own_password",
        Some(auth.user_id),
        "user",
        Some(auth.user_id),
        json!({ "other_sessions_revoked": revoked }),
    ));
    tracing::info!(user_id = %auth.user_id, other_sessions_revoked = revoked, "Password changed by owner");

    Json(json!({ "status": "ok", "other_sessions_revoked": revoked })).into_response()
}

async fn get_own_profile(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
) -> axum::response::Response {
    match load_profile(&state, &auth).await {
        Ok(Some(profile)) => Json(profile).into_response(),
        Ok(None) => err(
            StatusCode::UNAUTHORIZED,
            "unauthorized",
            "Account not found",
        ),
        Err(()) => internal(),
    }
}

async fn update_own_profile(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Json(body): Json<UpdateProfileRequest>,
) -> axum::response::Response {
    let input = match validate_profile(
        body.name.as_deref(),
        body.phone.as_deref(),
        body.preferred_language.as_deref(),
    ) {
        Ok(input) => input,
        Err(message) => {
            return err(
                StatusCode::UNPROCESSABLE_ENTITY,
                "validation_error",
                message,
            );
        }
    };

    let before = match load_profile(&state, &auth).await {
        Ok(Some(profile)) => profile,
        Ok(None) => {
            return err(
                StatusCode::UNAUTHORIZED,
                "unauthorized",
                "Account not found",
            );
        }
        Err(()) => return internal(),
    };

    // `$n_set` flags distinguish "leave as is" from "clear".
    let result = sqlx::query(
        r#"UPDATE users
           SET name = CASE WHEN $2 THEN $3 ELSE name END,
               phone = CASE WHEN $4 THEN $5 ELSE phone END,
               preferred_language = CASE WHEN $6 THEN $7 ELSE preferred_language END,
               updated_at = now()
           WHERE id = $1 AND is_active"#,
    )
    .bind(auth.user_id)
    .bind(input.name.is_some())
    .bind(input.name.as_deref())
    .bind(input.phone.is_some())
    .bind(input.phone.clone().flatten())
    .bind(input.preferred_language.is_some())
    .bind(input.preferred_language.clone().flatten())
    .execute(&state.db)
    .await;
    match result {
        Ok(done) if done.rows_affected() == 1 => {}
        Ok(_) => {
            return err(
                StatusCode::UNAUTHORIZED,
                "unauthorized",
                "Account not found",
            );
        }
        Err(error) => {
            tracing::error!(%error, user_id = %auth.user_id, "update own profile");
            return internal();
        }
    }

    let after = match load_profile(&state, &auth).await {
        Ok(Some(profile)) => profile,
        Ok(None) => {
            return err(
                StatusCode::UNAUTHORIZED,
                "unauthorized",
                "Account not found",
            );
        }
        Err(()) => return internal(),
    };
    state.audit_sender.try_send(audit::domain_diff_event(
        "update_own_profile",
        Some(auth.user_id),
        "user",
        Some(auth.user_id),
        json!({
            "name": before["name"],
            "phone": before["phone"],
            "preferred_language": before["preferred_language"],
        }),
        json!({
            "name": after["name"],
            "phone": after["phone"],
            "preferred_language": after["preferred_language"],
        }),
    ));
    Json(after).into_response()
}

async fn load_profile(state: &AppState, auth: &AuthUser) -> Result<Option<serde_json::Value>, ()> {
    let row = sqlx::query(
        "SELECT id, email, name, role, phone, preferred_language, password_changed_at
         FROM users WHERE id = $1 AND is_active",
    )
    .bind(auth.user_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|error| {
        tracing::error!(%error, user_id = %auth.user_id, "load own profile");
    })?;
    Ok(row.map(|row| {
        json!({
            "id": row.try_get::<uuid::Uuid, _>("id").ok(),
            "email": row.try_get::<String, _>("email").ok(),
            "name": row.try_get::<String, _>("name").ok(),
            "role": row.try_get::<String, _>("role").ok(),
            "phone": row.try_get::<Option<String>, _>("phone").ok().flatten(),
            "preferred_language": row
                .try_get::<Option<String>, _>("preferred_language")
                .ok()
                .flatten(),
            "password_changed_at": row
                .try_get::<Option<chrono::DateTime<chrono::Utc>>, _>("password_changed_at")
                .ok()
                .flatten(),
        })
    }))
}

fn internal() -> axum::response::Response {
    err(
        StatusCode::INTERNAL_SERVER_ERROR,
        "internal",
        "An internal error occurred",
    )
}

fn err(status: StatusCode, code: &str, message: &str) -> axum::response::Response {
    (status, Json(json!({ "error": code, "message": message }))).into_response()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn profile_validation_trims_and_normalises() {
        let input = validate_profile(
            Some("  Anna Schmidt "),
            Some(" +49 30 1234-567 "),
            Some("DE"),
        )
        .unwrap();
        assert_eq!(
            input,
            ProfileInput {
                name: Some("Anna Schmidt".into()),
                phone: Some(Some("+49 30 1234-567".into())),
                preferred_language: Some(Some("de".into())),
            }
        );
    }

    #[test]
    fn profile_validation_clears_optional_fields_and_keeps_missing_ones() {
        let input = validate_profile(None, Some("   "), Some("")).unwrap();
        assert_eq!(
            input,
            ProfileInput {
                name: None,
                phone: Some(None),
                preferred_language: Some(None),
            }
        );
    }

    #[test]
    fn profile_validation_rejects_bad_values() {
        assert!(validate_profile(Some("   "), None, None).is_err());
        assert!(validate_profile(Some(&"x".repeat(PROFILE_NAME_MAX + 1)), None, None).is_err());
        assert!(validate_profile(None, Some("call me maybe"), None).is_err());
        assert!(validate_profile(None, Some(&"1".repeat(PROFILE_PHONE_MAX + 1)), None).is_err());
        assert!(validate_profile(None, None, Some("en")).is_err());
    }
}
