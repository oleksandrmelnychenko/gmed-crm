//! Mandatory second factor (owner decision 2026-10-11, QA E-17/E-28; TOM
//! `docs/compliance/01_tom.md`, «Zweiter Faktor»).
//!
//! The CEO, the IT admin and the Patient Manager must sign in with an
//! authenticator app. A session of such an account without a confirmed factor
//! is created with the `mfa_enrol` claim (`auth::jwt::Claims`); the middleware
//! then admits only the two-factor setup, identity and sign-out
//! ([`is_totp_enrolment_allowed_path`]). After the enrolment the next token
//! refresh drops the claim. `system_settings.mfa_totp_required_roles` can add
//! roles; it cannot remove the three mandatory ones.
//!
//! Accounts seeded by the end-to-end bootstrap (`/e2e/bootstrap`, e-mail
//! `*.e2e-<tag>@example.com`) are exempt only while `ENABLE_E2E_SUPPORT` is set,
//! which no production deployment sets; production never skips the factor.

use sqlx::{Postgres, Row};
use uuid::Uuid;

/// Roles that always need a second factor, whatever the settings say.
pub const MANDATORY_TOTP_ROLES: &[&str] = &["ceo", "it_admin", "patient_manager"];

/// Whether the role must use a second factor: the mandatory roles plus the
/// roles listed in `mfa_totp_required_roles`.
pub fn role_requires_totp(role: &str, configured_roles: &[String]) -> bool {
    MANDATORY_TOTP_ROLES.contains(&role) || configured_roles.iter().any(|value| value == role)
}

/// Endpoints an enrolment-only session may call: identity, the two-factor
/// setup itself, the own sessions and leaving.
pub fn is_totp_enrolment_allowed_path(path: &str) -> bool {
    let path = path.strip_prefix("/api/v1").unwrap_or(path);
    matches!(
        path,
        "/me"
            | "/me/totp"
            | "/me/totp/setup"
            | "/me/totp/confirm"
            | "/me/password"
            | "/auth/logout"
            | "/auth/logout-all"
            | "/auth/sessions"
    ) || path.starts_with("/auth/sessions/")
}

fn e2e_support_enabled() -> bool {
    std::env::var("ENABLE_E2E_SUPPORT")
        .ok()
        .as_deref()
        .is_some_and(|value| matches!(value, "1" | "true" | "TRUE" | "yes" | "YES"))
}

/// An account created by the end-to-end bootstrap (`routes::e2e_support`).
fn is_e2e_seeded_email(email: &str) -> bool {
    let email = email.trim().to_ascii_lowercase();
    email.ends_with("@example.com") && email.contains(".e2e-")
}

/// Whether a session of `user_id` (signed in with `role`) must stay confined
/// to the two-factor setup: the role requires a factor and none is confirmed.
pub async fn totp_enrolment_pending<'e, E>(
    executor: E,
    user_id: Uuid,
    role: &str,
) -> Result<bool, sqlx::Error>
where
    E: sqlx::Executor<'e, Database = Postgres>,
{
    let row = sqlx::query(
        r#"SELECT u.email,
                  EXISTS (
                      SELECT 1 FROM user_totp t
                      WHERE t.user_id = u.id AND t.confirmed_at IS NOT NULL
                  ) AS enrolled,
                  COALESCE(
                      (SELECT s.value FROM system_settings s
                       WHERE s.key = 'mfa_totp_required_roles'),
                      '[]'::jsonb
                  ) AS configured_roles
           FROM users u
           WHERE u.id = $1"#,
    )
    .bind(user_id)
    .fetch_optional(executor)
    .await?;
    let Some(row) = row else {
        return Ok(false);
    };
    if row.try_get::<bool, _>("enrolled").unwrap_or(false) {
        return Ok(false);
    }
    let configured: Vec<String> = row
        .try_get::<serde_json::Value, _>("configured_roles")
        .ok()
        .and_then(|value| serde_json::from_value(value).ok())
        .unwrap_or_default();
    if !role_requires_totp(role, &configured) {
        return Ok(false);
    }
    let email: String = row.try_get("email").unwrap_or_default();
    Ok(!(e2e_support_enabled() && is_e2e_seeded_email(&email)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ceo_it_admin_and_patient_manager_always_need_a_second_factor() {
        for role in ["ceo", "it_admin", "patient_manager"] {
            assert!(role_requires_totp(role, &[]), "{role}");
        }
        for role in ["billing", "sales", "interpreter", "patient"] {
            assert!(!role_requires_totp(role, &[]), "{role}");
        }
        assert!(role_requires_totp("billing", &["billing".to_string()]));
    }

    #[test]
    fn enrolment_only_sessions_reach_the_setup_identity_and_sign_out() {
        for path in [
            "/api/v1/me",
            "/api/v1/me/totp",
            "/api/v1/me/totp/setup",
            "/api/v1/me/totp/confirm",
            "/api/v1/auth/logout",
            "/api/v1/auth/sessions/abc/revoke",
        ] {
            assert!(is_totp_enrolment_allowed_path(path), "{path}");
        }
        for path in [
            "/api/v1/me/totp/disable",
            "/api/v1/patients",
            "/api/v1/users",
            "/api/v1/admin/settings",
            "/api/v1/messages/ws",
            "/api/v1/me/profile",
        ] {
            assert!(!is_totp_enrolment_allowed_path(path), "{path}");
        }
    }

    #[test]
    fn only_bootstrap_accounts_look_like_e2e_accounts() {
        assert!(is_e2e_seeded_email(
            "ceo.e2e-2613072a295e405e8579b7ab8bffad5a@example.com"
        ));
        assert!(!is_e2e_seeded_email("ceo@gmed-health.com"));
        assert!(!is_e2e_seeded_email("ceo.e2e-1@gmed-health.com"));
        assert!(!is_e2e_seeded_email("anna.muster@example.com"));
    }
}
