//! Sends a portal login's sign-in data by e-mail (owner decision 2026-10-05).
//!
//! The CEO or a patient manager clicks "send by e-mail" in the dialog that
//! shows a freshly issued password — for a lead's own login, a parent's login
//! for a minor's request, or a patient's login (the patients table has the
//! same login row as the leads table). The password is stored only as a hash,
//! so the dialog hands it back; the server sends it only while it is still
//! the login's current password. The e-mail goes through Mittaro
//! ([`crate::mail`]); `portal_login_emails` keeps who sent what to whom and
//! when, never the content, and goes with the lead or the patient.

use axum::{
    Json, Router,
    extract::{Extension, Path, State},
    http::StatusCode,
    response::IntoResponse,
    routing::get,
};
use chrono::NaiveDate;
use serde::Deserialize;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use sqlx::Row;
use uuid::Uuid;

use crate::audit;
use crate::auth::middleware::AuthUser;
use crate::auth::password;
use crate::mail::connection::current_mailer;
use crate::mail::templates::{self, LoginAudience, MailLanguage, PortalLoginEmail};
use crate::mail::{MailError, OutgoingEmail, coded, error_response};
use crate::routes::lead_portal_account::{may_issue_portal_password, normalize_portal_email};
use crate::state::AppState;
use gmed_domain::access::capabilities::Capability;

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/leads/{lead_id}/portal-login-email",
            get(get_login_emails).post(send_login_email),
        )
        .route(
            "/patients/{patient_id}/portal-login-email",
            get(get_patient_login_emails).post(send_patient_login_email),
        )
}

/// Whose login the e-mail is about; the log row belongs to it.
#[derive(Clone, Copy)]
enum Subject {
    Lead(Uuid),
    Patient(Uuid),
}

impl Subject {
    fn id(self) -> Uuid {
        match self {
            Self::Lead(id) | Self::Patient(id) => id,
        }
    }

    fn entity(self) -> &'static str {
        match self {
            Self::Lead(_) => "lead",
            Self::Patient(_) => "patient",
        }
    }
}

fn internal(
    error: impl std::fmt::Display,
    subject_id: Uuid,
    what: &str,
) -> axum::response::Response {
    tracing::error!(%error, %subject_id, what, "portal login e-mail");
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

/// Sign-in e-mails sent for a lead or a patient, newest first.
async fn login_email_history(
    db: &gmed_db::DbPool,
    subject: Subject,
) -> Result<Vec<Value>, sqlx::Error> {
    let rows = sqlx::query(
        r#"SELECT e.user_id, e.recipient, e.language, e.status, e.error_code, e.created_at,
                  u.name AS sent_by_name
           FROM portal_login_emails e
           LEFT JOIN users u ON u.id = e.sent_by
           WHERE ($1::uuid IS NOT NULL AND e.lead_id = $1)
              OR ($2::uuid IS NOT NULL AND e.patient_id = $2)
           ORDER BY e.created_at DESC
           LIMIT 20"#,
    )
    .bind(matches!(subject, Subject::Lead(_)).then(|| subject.id()))
    .bind(matches!(subject, Subject::Patient(_)).then(|| subject.id()))
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

/// Whether e-mail can be sent, the person's language and the log.
async fn login_email_info(
    state: &AppState,
    auth: &AuthUser,
    subject: Subject,
    default_language: Option<String>,
) -> axum::response::Response {
    let history = match login_email_history(&state.db, subject).await {
        Ok(history) => history,
        Err(error) => return internal(error, subject.id(), "history"),
    };
    let capability = match current_mailer(state).await {
        Ok(mailer) => mailer.capability(),
        Err(code) => crate::mail::MailCapability {
            provider: crate::mail::PROVIDER_ID,
            available: false,
            reason_code: code,
        },
    };
    let language = default_language
        .as_deref()
        .map(|code| MailLanguage::from_code(Some(code)).code());
    Json(json!({
        "available": capability.available,
        "reason_code": capability.reason_code,
        "can_send": may_issue_portal_password(auth.role),
        // The language the e-mail uses unless the dialog picks another one.
        "default_language": language,
        "lead_language": language,
        "sent": history,
    }))
    .into_response()
}

/// `GET /leads/{id}/portal-login-email`.
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
    login_email_info(&state, &auth, Subject::Lead(lead_id), primary_language).await
}

/// The first language of a patient that has an e-mail template.
fn patient_language(languages: &[String]) -> Option<String> {
    languages
        .iter()
        .find(|code| {
            let base = code.trim().to_ascii_lowercase();
            ["de", "en", "ru", "uk", "ua"]
                .iter()
                .any(|known| base == *known || base.starts_with(&format!("{known}-")))
        })
        .or_else(|| languages.first())
        .cloned()
}

/// `GET /patients/{id}/portal-login-email`.
async fn get_patient_login_emails(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(patient_id): Path<Uuid>,
) -> axum::response::Response {
    if let Err(response) = auth.require_capability(Capability::PatientsView) {
        return response;
    }
    match crate::routes::patients::has_patient_access(&state, &auth, patient_id).await {
        Ok(true) => {}
        Ok(false) => {
            return coded(
                StatusCode::FORBIDDEN,
                "forbidden",
                "Insufficient permissions",
            );
        }
        Err(response) => return response,
    }
    let languages =
        match sqlx::query_scalar::<_, Vec<String>>("SELECT languages FROM patients WHERE id = $1")
            .bind(patient_id)
            .fetch_optional(&state.db)
            .await
        {
            Ok(Some(languages)) => languages,
            Ok(None) => {
                return coded(
                    StatusCode::NOT_FOUND,
                    "patient_not_found",
                    "Patient not found",
                );
            }
            Err(error) => return internal(error, patient_id, "patient language"),
        };
    login_email_info(
        &state,
        &auth,
        Subject::Patient(patient_id),
        patient_language(&languages),
    )
    .await
}

#[derive(Deserialize)]
struct SendLoginEmailBody {
    user_id: Uuid,
    password: String,
    #[serde(default)]
    language: Option<String>,
}

/// The login an e-mail is about, as loaded for its lead or patient.
struct LoginTarget {
    subject: Subject,
    audience: LoginAudience,
    email: Option<String>,
    is_active: bool,
    password_hash: String,
    recipient_name: String,
    default_language: Option<String>,
    complete_by: Option<NaiveDate>,
}

fn require_sender(
    auth: &AuthUser,
    body: &SendLoginEmailBody,
) -> Result<(), axum::response::Response> {
    if !may_issue_portal_password(auth.role) {
        return Err(coded(
            StatusCode::FORBIDDEN,
            "forbidden",
            "Only the CEO or a patient manager can send patient access",
        ));
    }
    if body.password.is_empty() || body.password.len() > 128 {
        return Err(coded(
            StatusCode::UNPROCESSABLE_ENTITY,
            "password_required",
            "The issued password is required",
        ));
    }
    Ok(())
}

fn login_not_found() -> axum::response::Response {
    coded(
        StatusCode::NOT_FOUND,
        "login_not_found",
        "This login does not belong to the lead or patient",
    )
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
    if let Err(response) = require_sender(&auth, &body) {
        return response;
    }
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
        Ok(None) => return login_not_found(),
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
    let own_login = row.try_get::<bool, _>("own_login").unwrap_or(false);
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
    let password_hash = match row.try_get::<String, _>("password_hash") {
        Ok(hash) => hash,
        Err(error) => return internal(error, lead_id, "read hash"),
    };
    deliver(
        &state,
        &auth,
        &body,
        LoginTarget {
            subject: Subject::Lead(lead_id),
            audience: if own_login {
                LoginAudience::Lead
            } else {
                LoginAudience::Guardian
            },
            email: row.try_get("email").ok(),
            is_active: row.try_get::<bool, _>("is_active").unwrap_or(false),
            password_hash,
            recipient_name,
            default_language: row.try_get("primary_language").ok().flatten(),
            complete_by,
        },
    )
    .await
}

/// `POST /patients/{id}/portal-login-email`: e-mails the sign-in data of the
/// patient's login. CEO and patient managers with edit access to the patient.
async fn send_patient_login_email(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(patient_id): Path<Uuid>,
    Json(body): Json<SendLoginEmailBody>,
) -> axum::response::Response {
    if let Err(response) = require_sender(&auth, &body) {
        return response;
    }
    match crate::routes::patients::has_patient_edit_access(&state, &auth, patient_id).await {
        Ok(true) => {}
        Ok(false) => {
            return coded(
                StatusCode::FORBIDDEN,
                "forbidden",
                "Insufficient permissions",
            );
        }
        Err(response) => return response,
    }
    let row = match sqlx::query(
        r#"SELECT u.email, u.name, u.is_active, u.password_hash,
                  p.first_name, p.last_name, p.languages, p.lifecycle_status
           FROM patients p
           JOIN patient_assignments pa
             ON pa.patient_id = p.id AND pa.user_id = $2 AND pa.revoked_at IS NULL
           JOIN users u ON u.id = pa.user_id AND u.role = 'patient'
           WHERE p.id = $1"#,
    )
    .bind(patient_id)
    .bind(body.user_id)
    .fetch_optional(&state.db)
    .await
    {
        Ok(Some(row)) => row,
        Ok(None) => return login_not_found(),
        Err(error) => return internal(error, patient_id, "load login"),
    };
    if row
        .try_get::<String, _>("lifecycle_status")
        .is_ok_and(|status| status == "deleted")
    {
        return coded(
            StatusCode::CONFLICT,
            "patient_deleted",
            "A deleted patient record has no portal access",
        );
    }
    let patient_name = format!(
        "{} {}",
        row.try_get::<String, _>("first_name").unwrap_or_default(),
        row.try_get::<String, _>("last_name").unwrap_or_default()
    );
    let recipient_name = if patient_name.trim().is_empty() {
        row.try_get::<String, _>("name").unwrap_or_default()
    } else {
        patient_name
    };
    let password_hash = match row.try_get::<String, _>("password_hash") {
        Ok(hash) => hash,
        Err(error) => return internal(error, patient_id, "read hash"),
    };
    let languages: Vec<String> = row.try_get("languages").unwrap_or_default();
    deliver(
        &state,
        &auth,
        &body,
        LoginTarget {
            subject: Subject::Patient(patient_id),
            audience: LoginAudience::Patient,
            email: row.try_get("email").ok(),
            is_active: row.try_get::<bool, _>("is_active").unwrap_or(false),
            password_hash,
            recipient_name,
            default_language: patient_language(&languages),
            complete_by: None,
        },
    )
    .await
}

/// Checks the password, renders and sends the e-mail, logs and audits it.
async fn deliver(
    state: &AppState,
    auth: &AuthUser,
    body: &SendLoginEmailBody,
    target: LoginTarget,
) -> axum::response::Response {
    let subject_id = target.subject.id();
    let mailer = match current_mailer(state).await {
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
    if !target.is_active {
        return coded(
            StatusCode::CONFLICT,
            "login_inactive",
            "The login is deactivated",
        );
    }
    // Only the password the login has right now: an outdated one from an old
    // dialog would lock the patient out.
    if !password::verify_password(&body.password, &target.password_hash).unwrap_or(false) {
        return coded(
            StatusCode::CONFLICT,
            "portal_password_outdated",
            "The password is no longer the login's current password",
        );
    }
    let Some(recipient) = normalize_portal_email(target.email.as_deref()) else {
        return coded(
            StatusCode::UNPROCESSABLE_ENTITY,
            "login_email_invalid",
            "The login has no valid e-mail address",
        );
    };
    let language = MailLanguage::from_code(
        body.language
            .as_deref()
            .or(target.default_language.as_deref()),
    );
    let agency = crate::mail::agency_identity(&state.db).await;
    let login_url = format!("{console_url}/login");
    let logo_url = templates::logo_url(&console_url);
    let rendered = templates::portal_login(&PortalLoginEmail {
        language,
        recipient_name: target.recipient_name.trim(),
        login: &recipient,
        password: &body.password,
        login_url: &login_url,
        complete_by: target.complete_by,
        audience: target.audience,
        agency: &agency,
        logo_url: Some(&logo_url),
    });
    let outgoing = OutgoingEmail {
        to: recipient.clone(),
        subject: rendered.subject,
        text: rendered.text,
        html: rendered.html,
        idempotency_key: idempotency_key(body.user_id, &target.password_hash, language, &recipient),
    };

    let result = mailer.send(&outgoing).await;
    let (status_text, message_id, error_code) = match &result {
        Ok(sent) => ("sent", Some(sent.message_id.clone()), None),
        Err(error) => ("failed", None, Some(error.code())),
    };
    let replayed = result.as_ref().is_ok_and(|sent| sent.replayed);
    let (lead_id, patient_id) = match target.subject {
        Subject::Lead(id) => (Some(id), None),
        Subject::Patient(id) => (None, Some(id)),
    };
    // A repeat of an already accepted message is not logged twice.
    let logged = if replayed {
        Ok(None)
    } else {
        sqlx::query_scalar::<_, chrono::DateTime<chrono::Utc>>(
            r#"INSERT INTO portal_login_emails
                   (lead_id, patient_id, user_id, recipient, language, status,
                    provider_message_id, error_code, sent_by)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
               RETURNING created_at"#,
        )
        .bind(lead_id)
        .bind(patient_id)
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
            tracing::error!(%error, %subject_id, "log portal login e-mail");
            None
        }
    };
    let entity = target.subject.entity();
    state.audit_sender.try_send(audit::domain_event(
        match (entity, result.is_ok()) {
            ("lead", true) => "send_lead_portal_login_email",
            ("lead", false) => "send_lead_portal_login_email_failed",
            (_, true) => "send_patient_portal_login_email",
            (_, false) => "send_patient_portal_login_email_failed",
        },
        Some(auth.user_id),
        entity,
        Some(subject_id),
        json!({
            "portal_user_id": body.user_id,
            "login": match target.audience {
                LoginAudience::Lead => "lead",
                LoginAudience::Guardian => "guardian",
                LoginAudience::Patient => "patient",
            },
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
    fn a_patient_e_mail_uses_the_first_language_with_a_template() {
        let languages = |codes: &[&str]| {
            codes
                .iter()
                .map(|code| code.to_string())
                .collect::<Vec<_>>()
        };
        assert_eq!(
            patient_language(&languages(&["tr", "ru"])).as_deref(),
            Some("ru")
        );
        assert_eq!(
            patient_language(&languages(&["uk-UA"])).as_deref(),
            Some("uk-UA")
        );
        assert_eq!(patient_language(&languages(&["tr"])).as_deref(), Some("tr"));
        assert_eq!(patient_language(&[]), None);
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
