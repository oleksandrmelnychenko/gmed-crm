//! Sends a lead's sign-in data by e-mail (owner decision 2026-10-05).
//!
//! The CEO or a patient manager clicks "send by e-mail" in the dialog that
//! shows a freshly issued password — for the lead's own login or a parent's
//! login for a minor's request. The password is stored only as a hash, so the
//! dialog hands it back; the server sends it only while it is still the
//! login's current password. The e-mail goes through Mittaro
//! ([`crate::mail`]); `portal_login_emails` keeps who sent what to whom and
//! when, never the content, and goes with the lead.

use axum::{
    Json, Router,
    extract::{Extension, Path, State},
    http::StatusCode,
    response::IntoResponse,
    routing::get,
};
use serde::Deserialize;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use sqlx::Row;
use uuid::Uuid;

use crate::audit;
use crate::auth::middleware::AuthUser;
use crate::auth::password;
use crate::mail::connection::current_mailer;
use crate::mail::templates::{self, MailLanguage, PortalLoginEmail};
use crate::mail::{MailError, OutgoingEmail, coded, error_response};
use crate::routes::lead_portal_account::{may_issue_portal_password, normalize_portal_email};
use crate::state::AppState;
use gmed_domain::access::capabilities::Capability;

pub fn router() -> Router<AppState> {
    Router::new().route(
        "/leads/{lead_id}/portal-login-email",
        get(get_login_emails).post(send_login_email),
    )
}

fn internal(error: impl std::fmt::Display, lead_id: Uuid, what: &str) -> axum::response::Response {
    tracing::error!(%error, %lead_id, what, "lead portal login e-mail");
    coded(StatusCode::INTERNAL_SERVER_ERROR, "internal", "Failed")
}

/// The same password, language and address never go out twice: a repeat
/// click returns the first message (Mittaro idempotency).
fn idempotency_key(user_id: Uuid, password_hash: &str, language: MailLanguage, to: &str) -> String {
    let digest = Sha256::digest(
        format!(
            "portal-login:{user_id}:{password_hash}:{}:{to}",
            language.code()
        )
        .as_bytes(),
    );
    format!("gmed-portal-login-{}", hex::encode(digest))
}

/// Last sign-in e-mail per login of `lead_id`, newest first.
pub(crate) async fn login_email_history(
    db: &gmed_db::DbPool,
    lead_id: Uuid,
) -> Result<Vec<Value>, sqlx::Error> {
    let rows = sqlx::query(
        r#"SELECT e.user_id, e.recipient, e.language, e.status, e.error_code, e.created_at,
                  u.name AS sent_by_name
           FROM portal_login_emails e
           LEFT JOIN users u ON u.id = e.sent_by
           WHERE e.lead_id = $1
           ORDER BY e.created_at DESC
           LIMIT 20"#,
    )
    .bind(lead_id)
    .fetch_all(db)
    .await?;
    Ok(rows
        .iter()
        .map(|row| {
            json!({
                "user_id": row.try_get::<Uuid, _>("user_id").ok(),
                "recipient": row.try_get::<String, _>("recipient").ok(),
                "language": row.try_get::<String, _>("language").ok(),
                "status": row.try_get::<String, _>("status").ok(),
                "error_code": row.try_get::<Option<String>, _>("error_code").ok().flatten(),
                "sent_at": row.try_get::<chrono::DateTime<chrono::Utc>, _>("created_at").ok(),
                "sent_by_name": row.try_get::<Option<String>, _>("sent_by_name").ok().flatten(),
            })
        })
        .collect())
}

/// `GET /leads/{id}/portal-login-email`: whether e-mail can be sent and the
/// sign-in e-mails sent so far for this lead.
async fn get_login_emails(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(lead_id): Path<Uuid>,
) -> axum::response::Response {
    if let Err(response) = auth.require_capability(Capability::LeadsView) {
        return response;
    }
    let primary_language = match sqlx::query_scalar::<_, Option<String>>(
        "SELECT primary_language FROM leads WHERE id = $1",
    )
    .bind(lead_id)
    .fetch_optional(&state.db)
    .await
    {
        Ok(Some(language)) => language,
        Ok(None) => return coded(StatusCode::NOT_FOUND, "lead_not_found", "Lead not found"),
        Err(error) => return internal(error, lead_id, "lead language"),
    };
    let history = match login_email_history(&state.db, lead_id).await {
        Ok(history) => history,
        Err(error) => return internal(error, lead_id, "history"),
    };
    let capability = match current_mailer(&state).await {
        Ok(mailer) => mailer.capability(),
        Err(code) => crate::mail::MailCapability {
            provider: crate::mail::PROVIDER_ID,
            available: false,
            reason_code: code,
        },
    };
    Json(json!({
        "available": capability.available,
        "reason_code": capability.reason_code,
        "can_send": may_issue_portal_password(auth.role),
        // The language the e-mail uses unless the dialog picks another one.
        "lead_language": primary_language
            .as_deref()
            .map(|code| MailLanguage::from_code(Some(code)).code()),
        "sent": history,
    }))
    .into_response()
}

#[derive(Deserialize)]
struct SendLoginEmailBody {
    user_id: Uuid,
    password: String,
    #[serde(default)]
    language: Option<String>,
}

/// `POST /leads/{id}/portal-login-email`: e-mails the sign-in data of the
/// lead's login or of a parent's login for this request. CEO and patient
/// managers only — the roles that see the password.
async fn send_login_email(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(lead_id): Path<Uuid>,
    Json(body): Json<SendLoginEmailBody>,
) -> axum::response::Response {
    if !may_issue_portal_password(auth.role) {
        return coded(
            StatusCode::FORBIDDEN,
            "forbidden",
            "Only the CEO or a patient manager can send patient access",
        );
    }
    if body.password.is_empty() || body.password.len() > 128 {
        return coded(
            StatusCode::UNPROCESSABLE_ENTITY,
            "password_required",
            "The issued password is required",
        );
    }
    let mailer = match current_mailer(&state).await {
        Ok(mailer) => mailer,
        Err(code) => {
            return coded(
                StatusCode::SERVICE_UNAVAILABLE,
                code,
                "Mail connection unavailable",
            );
        }
    };
    let Some(console_url) = mailer.console_url().map(str::to_string) else {
        return error_response(&MailError::NotConfigured);
    };

    let row = match sqlx::query(
        r#"SELECT u.email, u.name, u.is_active, u.password_hash,
                  l.qualification_status, l.compliance_status, l.created_at,
                  l.converted_patient_id, l.primary_language, l.first_name, l.last_name,
                  (l.portal_user_id IS NOT DISTINCT FROM u.id) AS own_login
           FROM leads l
           JOIN users u ON u.id = $2
           WHERE l.id = $1
             AND (
                 l.portal_user_id = u.id
                 OR EXISTS (
                     SELECT 1 FROM lead_portal_access a
                     WHERE a.lead_id = l.id AND a.user_id = u.id
                       AND a.kind = 'guardian' AND a.revoked_at IS NULL
                 )
             )"#,
    )
    .bind(lead_id)
    .bind(body.user_id)
    .fetch_optional(&state.db)
    .await
    {
        Ok(Some(row)) => row,
        Ok(None) => {
            return coded(
                StatusCode::NOT_FOUND,
                "login_not_found",
                "This login does not belong to the lead",
            );
        }
        Err(error) => return internal(error, lead_id, "load login"),
    };
    let status: String = row.try_get("qualification_status").unwrap_or_default();
    if status == "deleted" {
        return coded(
            StatusCode::CONFLICT,
            "lead_deleted",
            "A deleted lead has no patient access",
        );
    }
    if !row.try_get::<bool, _>("is_active").unwrap_or(false) {
        return coded(
            StatusCode::CONFLICT,
            "login_inactive",
            "The login is deactivated",
        );
    }
    let password_hash: String = match row.try_get("password_hash") {
        Ok(hash) => hash,
        Err(error) => return internal(error, lead_id, "read hash"),
    };
    // Only the password the login has right now: an outdated one from an old
    // dialog would lock the patient out.
    if !password::verify_password(&body.password, &password_hash).unwrap_or(false) {
        return coded(
            StatusCode::CONFLICT,
            "portal_password_outdated",
            "The password is no longer the login's current password",
        );
    }
    let Some(recipient) = normalize_portal_email(row.try_get::<String, _>("email").ok().as_deref())
    else {
        return coded(
            StatusCode::UNPROCESSABLE_ENTITY,
            "login_email_invalid",
            "The login has no valid e-mail address",
        );
    };

    let own_login = row.try_get::<bool, _>("own_login").unwrap_or(false);
    let language = MailLanguage::from_code(
        body.language.as_deref().or(row
            .try_get::<Option<String>, _>("primary_language")
            .ok()
            .flatten()
            .as_deref()),
    );
    let recipient_name = if own_login {
        let lead_name = format!(
            "{} {}",
            row.try_get::<String, _>("first_name").unwrap_or_default(),
            row.try_get::<String, _>("last_name").unwrap_or_default()
        );
        if lead_name.trim().is_empty() {
            row.try_get::<String, _>("name").unwrap_or_default()
        } else {
            lead_name
        }
    } else {
        row.try_get::<String, _>("name").unwrap_or_default()
    };
    // The day the retention rule deletes an unqualified request, if it applies.
    let converted = row
        .try_get::<Option<Uuid>, _>("converted_patient_id")
        .ok()
        .flatten()
        .is_some();
    let complete_by = match (
        converted,
        row.try_get::<String, _>("compliance_status").ok(),
        row.try_get::<chrono::DateTime<chrono::Utc>, _>("created_at")
            .ok(),
    ) {
        (false, Some(compliance_status), Some(created_at)) => {
            crate::routes::leads::load_unqualified_lead_retention(&state.db)
                .await
                .and_then(|policy| policy.deadline(&status, &compliance_status, created_at))
                .map(crate::app_time::date_of)
        }
        _ => None,
    };
    let agency = crate::mail::agency_identity(&state.db).await;
    let login_url = format!("{console_url}/login");
    let logo_url = templates::logo_url(&console_url);
    let rendered = templates::portal_login(&PortalLoginEmail {
        language,
        recipient_name: recipient_name.trim(),
        login: &recipient,
        password: &body.password,
        login_url: &login_url,
        complete_by,
        for_guardian: !own_login,
        agency: &agency,
        logo_url: Some(&logo_url),
    });
    let outgoing = OutgoingEmail {
        to: recipient.clone(),
        subject: rendered.subject,
        text: rendered.text,
        html: rendered.html,
        idempotency_key: idempotency_key(body.user_id, &password_hash, language, &recipient),
    };

    let result = mailer.send(&outgoing).await;
    let (status_text, message_id, error_code) = match &result {
        Ok(sent) => ("sent", Some(sent.message_id.clone()), None),
        Err(error) => ("failed", None, Some(error.code())),
    };
    let replayed = result.as_ref().is_ok_and(|sent| sent.replayed);
    // A repeat of an already accepted message is not logged twice.
    let logged = if replayed {
        Ok(None)
    } else {
        sqlx::query_scalar::<_, chrono::DateTime<chrono::Utc>>(
            r#"INSERT INTO portal_login_emails
                   (lead_id, user_id, recipient, language, status,
                    provider_message_id, error_code, sent_by)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
               RETURNING created_at"#,
        )
        .bind(lead_id)
        .bind(body.user_id)
        .bind(&recipient)
        .bind(language.code())
        .bind(status_text)
        .bind(&message_id)
        .bind(error_code)
        .bind(auth.user_id)
        .fetch_one(&state.db)
        .await
        .map(Some)
    };
    let sent_at = match logged {
        Ok(sent_at) => sent_at,
        Err(error) => {
            // The e-mail may already be on its way; the log row is what failed.
            tracing::error!(%error, %lead_id, "log portal login e-mail");
            None
        }
    };
    state.audit_sender.try_send(audit::domain_event(
        if result.is_ok() {
            "send_lead_portal_login_email"
        } else {
            "send_lead_portal_login_email_failed"
        },
        Some(auth.user_id),
        "lead",
        Some(lead_id),
        json!({
            "portal_user_id": body.user_id,
            "login": if own_login { "lead" } else { "guardian" },
            "language": language.code(),
            "provider": crate::mail::PROVIDER_ID,
            "provider_message_id": message_id,
            "replayed": replayed,
            "error_code": error_code,
        }),
    ));

    match result {
        Ok(sent) => Json(json!({
            "sent_to": recipient,
            "sent_at": sent_at.unwrap_or_else(chrono::Utc::now),
            "language": language.code(),
            "message_id": sent.message_id,
            "replayed": sent.replayed,
        }))
        .into_response(),
        Err(error) => error_response(&error),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_idempotency_key_changes_with_password_language_and_address() {
        let user = Uuid::nil();
        let base = idempotency_key(user, "hash-1", MailLanguage::De, "anna@example.test");
        assert_eq!(
            base,
            idempotency_key(user, "hash-1", MailLanguage::De, "anna@example.test")
        );
        assert!(base.starts_with("gmed-portal-login-"));
        assert!(!base.contains("anna"));
        for other in [
            idempotency_key(user, "hash-2", MailLanguage::De, "anna@example.test"),
            idempotency_key(user, "hash-1", MailLanguage::Ru, "anna@example.test"),
            idempotency_key(user, "hash-1", MailLanguage::De, "ben@example.test"),
        ] {
            assert_ne!(base, other);
        }
    }

    #[test]
    fn delivery_failures_map_to_translatable_codes() {
        for (error, status, code) in [
            (
                MailError::NotConfigured,
                StatusCode::SERVICE_UNAVAILABLE,
                "mail_not_configured",
            ),
            (
                MailError::QuotaReached,
                StatusCode::TOO_MANY_REQUESTS,
                "mail_quota_reached",
            ),
            (
                MailError::Rejected(403),
                StatusCode::BAD_GATEWAY,
                "mail_rejected",
            ),
            (
                MailError::Unavailable(503),
                StatusCode::SERVICE_UNAVAILABLE,
                "mail_unavailable",
            ),
        ] {
            let response = error_response(&error);
            assert_eq!(response.status(), status);
            assert_eq!(error.code(), code);
        }
    }
}
