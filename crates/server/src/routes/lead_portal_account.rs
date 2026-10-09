//! Patient login of a manually created lead (owner decision 2026-10-03).
//!
//! The wizard creates the lead and, in the same transaction, a `patient`
//! account with a one-time password. The prospective patient completes the
//! personal data of step 1 and uploads documents; staff continue from step 2.
//! The account lives as long as the lead: the retention purge deactivates and
//! anonymises it ([`disable_for_lead_in_tx`]), conversion links it to the new
//! patient record ([`link_to_patient_in_tx`]).
//!
//! E-mail addresses are unique across all accounts. A conflict is reported
//! with the owner of the address instead of being merged.
//!
//! Only the CEO and patient managers see the one-time password or issue a new
//! one; other roles that create leads get the account without the password.

use axum::{
    Json, Router,
    extract::{Extension, Path, State},
    http::StatusCode,
    response::IntoResponse,
    routing::get,
};
use serde_json::{Value, json};
use sqlx::Row;
use uuid::Uuid;

use crate::audit;
use crate::auth::middleware::AuthUser;
use crate::auth::{password, password_policy};
use crate::state::AppState;
use gmed_domain::access::capabilities::Capability;
use gmed_domain::role::Role;

pub fn router() -> Router<AppState> {
    Router::new().route(
        "/leads/{lead_id}/portal-account",
        get(get_lead_portal_account).post(issue_lead_portal_access),
    )
}

/// Whether `role` may see a one-time password or issue a new one.
pub(crate) fn may_issue_portal_password(role: Role) -> bool {
    matches!(role, Role::Ceo | Role::PatientManager)
}

/// Lower-cased, trimmed e-mail when it looks like an address.
pub(crate) fn normalize_portal_email(raw: Option<&str>) -> Option<String> {
    let email = raw?.trim().to_lowercase();
    let (local, domain) = email.split_once('@')?;
    if local.is_empty()
        || !domain.contains('.')
        || domain.starts_with('.')
        || domain.ends_with('.')
        || email.len() > 320
        || email.chars().any(char::is_whitespace)
    {
        return None;
    }
    Some(email)
}

/// The account that already uses `email`, described for the conflict message:
/// who it is and which lead or patient it is linked to.
pub(crate) async fn email_owner<'e, E>(
    executor: E,
    email: &str,
    except_user: Option<Uuid>,
) -> Result<Option<Value>, sqlx::Error>
where
    E: sqlx::Executor<'e, Database = sqlx::Postgres>,
{
    let row = sqlx::query(
        r#"SELECT u.id, u.name, u.role, u.is_active,
                  lead.id AS lead_id,
                  NULLIF(btrim(concat_ws(' ', lead.first_name, lead.last_name)), '') AS lead_name,
                  patient.id AS patient_uuid,
                  patient.patient_id AS patient_code,
                  NULLIF(btrim(concat_ws(' ', patient.first_name, patient.last_name)), '') AS patient_name
           FROM users u
           LEFT JOIN leads lead ON lead.portal_user_id = u.id
           LEFT JOIN LATERAL (
               SELECT p.id, p.patient_id, p.first_name, p.last_name
               FROM patient_assignments pa
               JOIN patients p ON p.id = pa.patient_id
               WHERE pa.user_id = u.id
                 AND pa.revoked_at IS NULL
                 AND u.role = 'patient'
               ORDER BY pa.assigned_at DESC
               LIMIT 1
           ) patient ON true
           WHERE lower(btrim(u.email)) = $1
             AND ($2::uuid IS NULL OR u.id <> $2)
           LIMIT 1"#,
    )
    .bind(email)
    .bind(except_user)
    .fetch_optional(executor)
    .await?;
    Ok(row.map(|row| {
        json!({
            "user_id": row.try_get::<Uuid, _>("id").ok(),
            "name": row.try_get::<String, _>("name").ok(),
            "role": row.try_get::<String, _>("role").ok(),
            "is_active": row.try_get::<bool, _>("is_active").ok(),
            "lead_id": row.try_get::<Option<Uuid>, _>("lead_id").ok().flatten(),
            "lead_name": row.try_get::<Option<String>, _>("lead_name").ok().flatten(),
            "patient_id": row.try_get::<Option<Uuid>, _>("patient_uuid").ok().flatten(),
            "patient_code": row.try_get::<Option<String>, _>("patient_code").ok().flatten(),
            "patient_name": row.try_get::<Option<String>, _>("patient_name").ok().flatten(),
        })
    }))
}

/// 409 naming the account that already holds the address.
pub(crate) fn email_taken_response(owner: Value) -> axum::response::Response {
    (
        StatusCode::CONFLICT,
        Json(json!({
            "error": "Conflict",
            "code": "portal_email_taken",
            "message": "Email already belongs to an account",
            "owner": owner,
        })),
    )
        .into_response()
}

/// A freshly created login and its one-time password.
pub(crate) struct NewPortalAccount {
    pub user_id: Uuid,
    pub email: String,
    pub one_time_password: String,
}

/// Creates the `patient` account of `lead_id` and links it to the lead. The
/// caller has checked that `email` is free; a concurrent insert still fails on
/// the unique e-mail index.
pub(crate) async fn create_for_lead_in_tx(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    lead_id: Uuid,
    email: &str,
    name: &str,
    created_by: Uuid,
) -> Result<NewPortalAccount, sqlx::Error> {
    let one_time_password = password_policy::generate_one_time_password();
    let hash = password::hash_password(&one_time_password)
        .map_err(|error| sqlx::Error::Protocol(format!("hash portal password: {error}")))?;
    let user_id: Uuid = sqlx::query_scalar(
        // No forced change at the first sign-in: the lead keeps the issued
        // password (owner decision 2026-10-05).
        r#"INSERT INTO users (email, password_hash, name, role, is_active, password_reset_required)
           VALUES ($1, $2, $3, 'patient', true, false)
           RETURNING id"#,
    )
    .bind(email)
    .bind(&hash)
    .bind(name)
    .fetch_one(&mut **tx)
    .await?;
    sqlx::query("UPDATE leads SET portal_user_id = $2 WHERE id = $1")
        .bind(lead_id)
        .bind(user_id)
        .execute(&mut **tx)
        .await?;
    audit::write_in_transaction(
        tx,
        &audit::domain_event(
            "create_lead_portal_account",
            Some(created_by),
            "lead",
            Some(lead_id),
            json!({ "portal_user_id": user_id, "email": email }),
        ),
    )
    .await?;
    Ok(NewPortalAccount {
        user_id,
        email: email.to_string(),
        one_time_password,
    })
}

/// Response fragment for a newly created account; the password only for the
/// roles that may hand it over.
pub(crate) fn new_account_payload(account: &NewPortalAccount, viewer: Role) -> Value {
    json!({
        "user_id": account.user_id,
        "email": account.email,
        "created": true,
        "one_time_password": may_issue_portal_password(viewer)
            .then(|| account.one_time_password.clone()),
    })
}

/// Keeps the login address in step with a corrected lead e-mail. The caller
/// has checked that the new address is free.
pub(crate) async fn sync_email_in_tx(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    lead_id: Uuid,
    email: &str,
) -> Result<Option<Uuid>, sqlx::Error> {
    sqlx::query_scalar(
        r#"UPDATE users u
           SET email = $2, updated_at = now()
           FROM leads l
           WHERE l.id = $1
             AND u.id = l.portal_user_id
             AND lower(btrim(u.email)) <> $2
           RETURNING u.id"#,
    )
    .bind(lead_id)
    .bind(email)
    .fetch_optional(&mut **tx)
    .await
}

/// Keeps the login's name in step with the lead's name: first and last name,
/// as the login was issued with (owner request 2026-10-09). The cabinet's
/// account page and Users & Roles read the login's name, so a renamed lead is
/// renamed there too. It reads the lead row, so the caller runs it after the
/// name was written, in the same transaction. Returns the login when its name
/// changed.
///
/// A converted lead is left alone: its login is the patient's account now and
/// the patient record owns the name. A deleted lead holds placeholders only.
pub(crate) async fn sync_name_in_tx(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    lead_id: Uuid,
) -> Result<Option<Uuid>, sqlx::Error> {
    sqlx::query_scalar(
        r#"WITH lead_name AS (
               SELECT portal_user_id AS user_id,
                      NULLIF(btrim(concat_ws(' ', btrim(first_name), btrim(last_name))), '')
                          AS name
               FROM leads
               WHERE id = $1
                 AND converted_patient_id IS NULL
                 AND qualification_status <> 'deleted'
           )
           UPDATE users u
           SET name = lead_name.name, updated_at = now()
           FROM lead_name
           WHERE u.id = lead_name.user_id
             AND u.role = 'patient'
             AND lead_name.name IS NOT NULL
             AND u.name IS DISTINCT FROM lead_name.name
           RETURNING u.id"#,
    )
    .bind(lead_id)
    .fetch_optional(&mut **tx)
    .await
}

/// The portal account of `lead_id`, if any.
pub(crate) async fn portal_user_of_lead<'e, E>(
    executor: E,
    lead_id: Uuid,
) -> Result<Option<Uuid>, sqlx::Error>
where
    E: sqlx::Executor<'e, Database = sqlx::Postgres>,
{
    sqlx::query_scalar::<_, Option<Uuid>>("SELECT portal_user_id FROM leads WHERE id = $1")
        .bind(lead_id)
        .fetch_optional(executor)
        .await
        .map(Option::flatten)
}

/// Deactivates and anonymises the account of a purged lead, in the purge
/// transaction. An account that still reaches something else — a patient
/// record (a converted or repeat patient) or, as a parent, another request —
/// stays untouched; only the lead link goes. The portal intake data of the
/// lead and its parents' logins go too
/// ([`crate::routes::lead_portal_guardians::revoke_for_purged_lead_in_tx`]).
/// Returns the deactivated account so the caller can revoke its sessions after
/// the commit — the request middleware already rejects an inactive account.
pub(crate) async fn disable_for_lead_in_tx(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    lead_id: Uuid,
    processed_by: Option<Uuid>,
) -> Result<Option<Uuid>, sqlx::Error> {
    // The log of sign-in e-mails names the recipients' addresses.
    sqlx::query("DELETE FROM portal_login_emails WHERE lead_id = $1")
        .bind(lead_id)
        .execute(&mut **tx)
        .await?;
    crate::routes::lead_portal_intake::purge_portal_intake_in_tx(tx, lead_id).await?;
    crate::routes::lead_portal_guardians::revoke_for_purged_lead_in_tx(tx, lead_id, processed_by)
        .await?;
    let Some(user_id) = portal_user_of_lead(&mut **tx, lead_id).await? else {
        return Ok(None);
    };
    let keeps_access =
        crate::routes::lead_portal_guardians::has_other_active_links(tx, user_id, lead_id).await?;
    sqlx::query("UPDATE leads SET portal_user_id = NULL WHERE id = $1")
        .bind(lead_id)
        .execute(&mut **tx)
        .await?;
    if keeps_access {
        return Ok(None);
    }
    anonymize_and_disable_in_tx(tx, user_id, lead_id, processed_by).await?;
    Ok(Some(user_id))
}

/// Switches a lead's login off for good: no identifying data, an unusable
/// password, revoked sessions and pending sign-ins, audit row in the same
/// transaction. The row stays because audit rows and documents refer to it.
pub(crate) async fn anonymize_and_disable_in_tx(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    user_id: Uuid,
    lead_id: Uuid,
    processed_by: Option<Uuid>,
) -> Result<(), sqlx::Error> {
    // The row stays (audit rows and documents refer to it) without anything
    // that identifies the person; the random hash makes the login unusable.
    let unusable_hash = password::hash_password(&password_policy::generate_one_time_password())
        .map_err(|error| sqlx::Error::Protocol(format!("hash portal password: {error}")))?;
    sqlx::query(
        r#"UPDATE users
           SET email = 'deleted-lead-' || id::text || '@invalid',
               name = 'Deleted lead',
               phone = NULL,
               password_hash = $2,
               password_history = '[]'::jsonb,
               mfa_backup_codes = NULL,
               is_active = false,
               updated_at = now()
           WHERE id = $1"#,
    )
    .bind(user_id)
    .bind(&unusable_hash)
    .execute(&mut **tx)
    .await?;
    sqlx::query(
        "UPDATE token_families SET is_revoked = true, revoked_reason = 'lead_purged'
         WHERE user_id = $1 AND NOT is_revoked",
    )
    .bind(user_id)
    .execute(&mut **tx)
    .await?;
    sqlx::query(
        "UPDATE pending_logins SET status = 'rejected', resolved_at = now()
         WHERE user_id = $1 AND status IN ('pending', 'approved')",
    )
    .bind(user_id)
    .execute(&mut **tx)
    .await?;
    audit::write_in_transaction(
        tx,
        &audit::domain_event(
            "disable_lead_portal_account",
            processed_by,
            "user",
            Some(user_id),
            json!({
                "source_lead_id": lead_id,
                "reason": "lead_purged",
                "gdpr_article": "5(1)(e)",
            }),
        ),
    )
    .await?;
    Ok(())
}

/// Gives the converted patient record the lead's login, so the person keeps
/// one account from the first contact on, and the consents given in the
/// portal for the lead (Art. 9 consent to process uploaded health data).
pub(crate) async fn link_to_patient_in_tx(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    lead_id: Uuid,
    patient_id: Uuid,
    assigned_by: Uuid,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"INSERT INTO patient_assignments (patient_id, user_id, assigned_by)
           SELECT $2, l.portal_user_id, $3
           FROM leads l
           JOIN users u ON u.id = l.portal_user_id AND u.role = 'patient' AND u.is_active
           WHERE l.id = $1
           ON CONFLICT (patient_id, user_id)
           DO UPDATE SET revoked_at = NULL"#,
    )
    .bind(lead_id)
    .bind(patient_id)
    .bind(assigned_by)
    .execute(&mut **tx)
    .await?;
    sqlx::query(
        "UPDATE consent_records SET patient_id = $2 WHERE lead_id = $1 AND patient_id IS NULL",
    )
    .bind(lead_id)
    .bind(patient_id)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

fn err(status: StatusCode, message: &str) -> axum::response::Response {
    (
        status,
        Json(json!({
            "error": status.canonical_reason().unwrap_or("error"),
            "message": message,
        })),
    )
        .into_response()
}

fn internal(error: sqlx::Error, lead_id: Uuid, what: &str) -> axum::response::Response {
    tracing::error!(%error, %lead_id, what, "lead portal account");
    err(StatusCode::INTERNAL_SERVER_ERROR, "Failed")
}

/// `GET /leads/{id}/portal-account`: the login state shown in step 1.
async fn get_lead_portal_account(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(lead_id): Path<Uuid>,
) -> axum::response::Response {
    if let Err(response) = auth.require_capability(Capability::LeadsView) {
        return response;
    }
    let row = match sqlx::query(
        r#"SELECT l.id, u.id AS user_id, u.email, u.is_active, u.password_reset_required,
                  u.created_at,
                  (SELECT max(tf.created_at) FROM token_families tf WHERE tf.user_id = u.id)
                      AS last_login_at
           FROM leads l
           LEFT JOIN users u ON u.id = l.portal_user_id
           WHERE l.id = $1"#,
    )
    .bind(lead_id)
    .fetch_optional(&state.db)
    .await
    {
        Ok(Some(row)) => row,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Lead not found"),
        Err(error) => return internal(error, lead_id, "load"),
    };
    let account = row
        .try_get::<Option<Uuid>, _>("user_id")
        .ok()
        .flatten()
        .map(|user_id| {
            json!({
                "user_id": user_id,
                "email": row.try_get::<String, _>("email").ok(),
                "is_active": row.try_get::<bool, _>("is_active").unwrap_or(false),
                "password_change_pending": row
                    .try_get::<bool, _>("password_reset_required")
                    .unwrap_or(false),
                "created_at": row
                    .try_get::<chrono::DateTime<chrono::Utc>, _>("created_at")
                    .ok(),
                "last_login_at": row
                    .try_get::<Option<chrono::DateTime<chrono::Utc>>, _>("last_login_at")
                    .ok()
                    .flatten(),
            })
        });
    Json(json!({
        "account": account,
        "can_issue_password": may_issue_portal_password(auth.role),
    }))
    .into_response()
}

/// `POST /leads/{id}/portal-account`: creates the login of a lead that has
/// none yet (leads from before 2026-10-03 or created without e-mail), or
/// issues a new one-time password. CEO and patient managers only.
async fn issue_lead_portal_access(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(lead_id): Path<Uuid>,
) -> axum::response::Response {
    if !may_issue_portal_password(auth.role) {
        return err(
            StatusCode::FORBIDDEN,
            "Only the CEO or a patient manager can issue patient access",
        );
    }
    let mut tx = match state.db.begin().await {
        Ok(tx) => tx,
        Err(error) => return internal(error, lead_id, "begin"),
    };
    let lead = match sqlx::query(
        r#"SELECT l.email, l.first_name, l.last_name, l.qualification_status,
                  l.converted_patient_id, l.portal_user_id, l.date_of_birth,
                  u.is_active AS portal_active
           FROM leads l
           LEFT JOIN users u ON u.id = l.portal_user_id
           WHERE l.id = $1
           FOR UPDATE OF l"#,
    )
    .bind(lead_id)
    .fetch_optional(&mut *tx)
    .await
    {
        Ok(Some(row)) => row,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Lead not found"),
        Err(error) => return internal(error, lead_id, "load"),
    };
    if lead
        .try_get::<String, _>("qualification_status")
        .is_ok_and(|status| status == "deleted")
    {
        return err(StatusCode::CONFLICT, "A deleted lead has no patient access");
    }

    let portal_user: Option<Uuid> = lead.try_get("portal_user_id").ok().flatten();
    if let Some(user_id) = portal_user {
        if !lead
            .try_get::<Option<bool>, _>("portal_active")
            .ok()
            .flatten()
            .unwrap_or(false)
        {
            return err(StatusCode::CONFLICT, "The patient account is deactivated");
        }
        if let Err(error) = tx.commit().await {
            return internal(error, lead_id, "commit lookup");
        }
        let one_time_password = password_policy::generate_one_time_password();
        match password_policy::replace_password(&state.db, user_id, &one_time_password, false).await
        {
            Ok(()) => {}
            Err(password_policy::PasswordChangeError::Rejected(message)) => {
                return err(StatusCode::UNPROCESSABLE_ENTITY, message);
            }
            Err(password_policy::PasswordChangeError::NotFound) => {
                return err(StatusCode::NOT_FOUND, "Patient account not found");
            }
            Err(password_policy::PasswordChangeError::Internal) => {
                return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
            }
        }
        let _ = sqlx::query(
            "UPDATE pending_logins SET status = 'rejected', resolved_at = now()
             WHERE user_id = $1 AND status IN ('pending', 'approved')",
        )
        .bind(user_id)
        .execute(&state.db)
        .await;
        crate::auth::tokens::revoke_all_families(&state.db, user_id, "password_reset").await;
        state.audit_sender.try_send(audit::domain_event(
            "reset_lead_portal_password",
            Some(auth.user_id),
            "lead",
            Some(lead_id),
            json!({ "portal_user_id": user_id, "sessions_revoked": true }),
        ));
        let email: Option<String> = sqlx::query_scalar("SELECT email FROM users WHERE id = $1")
            .bind(user_id)
            .fetch_optional(&state.db)
            .await
            .ok()
            .flatten();
        return Json(json!({
            "user_id": user_id,
            "email": email,
            "created": false,
            "one_time_password": one_time_password,
        }))
        .into_response();
    }

    if crate::routes::leads::is_minor_on(
        lead.try_get::<Option<chrono::NaiveDate>, _>("date_of_birth")
            .ok()
            .flatten(),
        crate::app_time::today(),
    ) {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "A minor gets no own login; the parents use their account",
        );
    }
    let Some(email) = normalize_portal_email(
        lead.try_get::<Option<String>, _>("email")
            .ok()
            .flatten()
            .as_deref(),
    ) else {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "The lead needs a valid email before patient access can be issued",
        );
    };
    match email_owner(&mut *tx, &email, None).await {
        Ok(None) => {}
        Ok(Some(owner)) => return email_taken_response(owner),
        Err(error) => return internal(error, lead_id, "email owner"),
    }
    let name = format!(
        "{} {}",
        lead.try_get::<String, _>("first_name").unwrap_or_default(),
        lead.try_get::<String, _>("last_name").unwrap_or_default()
    )
    .trim()
    .to_string();
    let account = match create_for_lead_in_tx(&mut tx, lead_id, &email, &name, auth.user_id).await {
        Ok(account) => account,
        Err(error) if is_unique_violation(&error) => {
            return match email_owner(&state.db, &email, None).await {
                Ok(Some(owner)) => email_taken_response(owner),
                _ => err(StatusCode::CONFLICT, "Email already belongs to an account"),
            };
        }
        Err(error) => return internal(error, lead_id, "create"),
    };
    if let Some(patient_id) = lead
        .try_get::<Option<Uuid>, _>("converted_patient_id")
        .ok()
        .flatten()
        && let Err(error) = link_to_patient_in_tx(&mut tx, lead_id, patient_id, auth.user_id).await
    {
        return internal(error, lead_id, "link converted patient");
    }
    if let Err(error) = tx.commit().await {
        return internal(error, lead_id, "commit create");
    }
    (
        StatusCode::CREATED,
        Json(new_account_payload(&account, auth.role)),
    )
        .into_response()
}

pub(crate) fn is_unique_violation(error: &sqlx::Error) -> bool {
    matches!(error, sqlx::Error::Database(db) if db.code().as_deref() == Some("23505"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_ceo_and_patient_managers_get_the_password() {
        assert!(may_issue_portal_password(Role::Ceo));
        assert!(may_issue_portal_password(Role::PatientManager));
        for role in [
            Role::CeoAssistant,
            Role::Sales,
            Role::Billing,
            Role::Concierge,
            Role::Interpreter,
            Role::TeamleadInterpreter,
            Role::ItAdmin,
            Role::Patient,
        ] {
            assert!(!may_issue_portal_password(role), "{role:?}");
        }
    }

    #[test]
    fn portal_email_is_normalised_and_validated() {
        assert_eq!(
            normalize_portal_email(Some("  Anna.Muster@Example.DE ")).as_deref(),
            Some("anna.muster@example.de")
        );
        for invalid in [
            "",
            "anna",
            "anna@",
            "@example.de",
            "anna@example",
            "a b@example.de",
            "anna@.de",
        ] {
            assert_eq!(normalize_portal_email(Some(invalid)), None, "{invalid}");
        }
        assert_eq!(normalize_portal_email(None), None);
    }

    #[test]
    fn sales_gets_the_account_without_the_password() {
        let account = NewPortalAccount {
            user_id: Uuid::nil(),
            email: "anna@example.de".into(),
            one_time_password: "secret".into(),
        };
        assert!(new_account_payload(&account, Role::Sales)["one_time_password"].is_null());
        assert_eq!(
            new_account_payload(&account, Role::PatientManager)["one_time_password"],
            "secret"
        );
    }
}
