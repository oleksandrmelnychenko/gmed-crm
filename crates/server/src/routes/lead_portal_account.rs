//! Patient login of a manually created lead (owner decision 2026-10-03).
//!
//! The wizard creates the lead and, in the same transaction, a `patient`
//! account with a one-time password. The prospective patient completes the
//! personal data of step 1 and uploads documents; staff continue from step 2.
//! The account lives as long as the lead: the retention purge deactivates and
//! anonymises it ([`disable_for_lead_in_tx`]), conversion links it to the new
//! patient record ([`link_to_patient_in_tx`]).
//!
//! E-mail addresses are unique across all accounts. An active guardian can
//! use the same login for their own request after an explicit identity check.
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
use crate::routes::lead_portal_intake::OWN_LOGIN_CLOSED_SQL;
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

/// Lower-cased, trimmed e-mail when it is a well-formed address
/// (`crate::email_address`). Its callers read an address already on file
/// (a trusted contact, a login, a lead) to link, issue or send to it: such an
/// address is never judged by its domain's current rating (QA 2026-10-24:
/// a domain rated `no_mail` for an hour hid a parent's e-mail from the access
/// panel and blocked re-issuing the access). A new or changed address is
/// judged where it is entered.
pub(crate) fn normalize_portal_email(raw: Option<&str>) -> Option<String> {
    crate::email_address::normalize_stored_email(raw?)
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
                 AND pa.source <> 'lead_guardian'
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
    pub one_time_password: Option<String>,
    pub reused: bool,
}

/// Locks an existing account before deciding whether it is this adult's
/// guardian login. A guardian assignment is not an own patient record.
/// Matching an e-mail alone never establishes identity or account ownership:
/// the names must name the same person, a middle name or patronymic on one
/// side only ([`super::lead_portal_guardians::compatible_person_name`], owner
/// decision 2026-10-19), and known birth dates must agree.
pub(crate) async fn reusable_guardian_in_tx(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    email: &str,
    name: &str,
    birth_date: Option<chrono::NaiveDate>,
    except_lead: Option<Uuid>,
    except_patient: Option<Uuid>,
) -> Result<Option<Uuid>, sqlx::Error> {
    Ok(reusable_guardian_scoped_in_tx(
        tx,
        email,
        name,
        birth_date,
        except_lead,
        except_patient,
        false,
    )
    .await?
    .map(|guardian| guardian.user_id))
}

/// A guardian login that may become this adult's own login.
pub(crate) struct ReusableGuardian {
    pub user_id: Uuid,
    /// The login was switched off by [`crate::services::coming_of_age`]
    /// (every guardian link ended with `patient_came_of_age`, the parent
    /// reached nothing else): it is reactivated for the own request.
    pub deactivated_by_coming_of_age: bool,
}

/// [`reusable_guardian_in_tx`]; with `accept_came_of_age` also a login that
/// [`crate::services::coming_of_age`] switched off because the child came of
/// age and the parent reached nothing else (owner decision 2026-10-25, «Neue
/// Anfrage für diese Person»): every guardian link of the login is revoked
/// and the last one ended with `patient_came_of_age`. The same name and
/// birth-date rules apply, read from those ended grants. A login switched
/// off for any other reason, or with a guardian link still active, is never
/// taken that way.
pub(crate) async fn reusable_guardian_scoped_in_tx(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    email: &str,
    name: &str,
    birth_date: Option<chrono::NaiveDate>,
    except_lead: Option<Uuid>,
    except_patient: Option<Uuid>,
    accept_came_of_age: bool,
) -> Result<Option<ReusableGuardian>, sqlx::Error> {
    let Some(user) = sqlx::query(
        "SELECT id, name, role, is_active FROM users WHERE lower(btrim(email)) = $1 FOR UPDATE",
    )
    .bind(email)
    .fetch_optional(&mut **tx)
    .await?
    else {
        return Ok(None);
    };
    let active: bool = user.try_get("is_active")?;
    if user.try_get::<String, _>("role")? != "patient"
        || (!active && !accept_came_of_age)
        || !super::lead_portal_guardians::compatible_person_name(
            &user.try_get::<String, _>("name")?,
            name,
        )
        || super::leads::is_minor_on(birth_date, crate::app_time::today())
    {
        return Ok(None);
    }
    let user_id: Uuid = user.try_get("id")?;
    let (guardian, own_record): (bool, bool) = sqlx::query_as(
        r#"SELECT
           EXISTS(SELECT 1 FROM lead_portal_access a JOIN leads l ON l.id=a.lead_id
                  WHERE a.user_id=$1 AND a.kind='guardian' AND a.revoked_at IS NULL
                    AND l.qualification_status <> 'deleted')
           OR EXISTS(SELECT 1 FROM patient_assignments pa
                     WHERE pa.user_id=$1 AND pa.source='lead_guardian' AND pa.revoked_at IS NULL),
           EXISTS(SELECT 1 FROM leads l WHERE l.portal_user_id=$1 AND l.qualification_status <> 'deleted'
                  AND ($2::uuid IS NULL OR l.id<>$2)
                  AND ($3::uuid IS NULL OR l.converted_patient_id IS DISTINCT FROM $3))
           OR EXISTS(SELECT 1 FROM patient_assignments pa JOIN patients p ON p.id=pa.patient_id
                     WHERE pa.user_id=$1 AND pa.source <> 'lead_guardian'
                       AND p.lifecycle_status <> 'deleted' AND ($3::uuid IS NULL OR p.id<>$3))"#,
    ).bind(user_id).bind(except_lead).bind(except_patient).fetch_one(&mut **tx).await?;
    if own_record {
        return Ok(None);
    }
    let deactivated_by_coming_of_age = if active {
        if !guardian {
            return Ok(None);
        }
        false
    } else {
        // Switched off: only by the coming-of-age job — every guardian link
        // ended, the last of them with its reason.
        if guardian || !ended_by_coming_of_age_in_tx(tx, user_id).await? {
            return Ok(None);
        }
        true
    };
    // Known birth dates must agree too; a different adult with the same name
    // cannot acquire a guardian login by entering its address.
    let profiles = guardian_profiles_in_tx(tx, user_id, deactivated_by_coming_of_age).await?;
    let mut previous_birth_date = None;
    for profile in profiles {
        if !super::lead_portal_guardians::compatible_person_name(&profile.name, name) {
            return Ok(None);
        }
        if let Some(known) = profile
            .contact
            .get("birth_date")
            .and_then(Value::as_str)
            .and_then(|date| chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d").ok())
        {
            if super::leads::is_minor_on(Some(known), crate::app_time::today())
                || birth_date.is_some_and(|date| date != known)
                || previous_birth_date.is_some_and(|date| date != known)
            {
                return Ok(None);
            }
            previous_birth_date = Some(known);
        }
    }
    Ok(Some(ReusableGuardian {
        user_id,
        deactivated_by_coming_of_age,
    }))
}

/// Whether a switched-off guardian login was ended by the coming-of-age job
/// and by nothing else: it has guardian links, every one of them is revoked,
/// and the one revoked last carries
/// [`crate::services::coming_of_age::REVOKE_REASON`]. A login the purge
/// anonymised, or one staff ended, does not qualify.
async fn ended_by_coming_of_age_in_tx(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    user_id: Uuid,
) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar(
        r#"WITH links AS (
               SELECT a.revoked_at, a.revoked_reason
               FROM lead_portal_access a
               WHERE a.user_id = $1 AND a.kind = 'guardian'
               UNION ALL
               SELECT pa.revoked_at, pa.revoked_reason
               FROM patient_assignments pa
               WHERE pa.user_id = $1 AND pa.source = 'lead_guardian'
           )
           SELECT COALESCE(
               EXISTS (SELECT 1 FROM links)
               AND NOT EXISTS (SELECT 1 FROM links WHERE revoked_at IS NULL)
               AND (SELECT revoked_reason FROM links
                    ORDER BY revoked_at DESC LIMIT 1) = $2,
               false)"#,
    )
    .bind(user_id)
    .bind(crate::services::coming_of_age::REVOKE_REASON)
    .fetch_one(&mut **tx)
    .await
}

/// Only active guardian grants prove which contact belongs to this account
/// (with `ended_by_coming_of_age`: also the grants the coming-of-age job
/// ended, for a login it switched off). The shared canonical loader fills that
/// contact's missing basic identity from its explicit patient link; unrelated
/// contacts and e-mail matches are ignored.
async fn guardian_profiles_in_tx(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    user_id: Uuid,
    ended_by_coming_of_age: bool,
) -> Result<Vec<crate::services::lead_guardian_identity::CanonicalGuardianIdentity>, sqlx::Error> {
    let grants: Vec<(Uuid, Uuid)> = sqlx::query_as(
        "SELECT a.lead_id,a.trusted_contact_id FROM lead_portal_access a
         JOIN leads child ON child.id=a.lead_id
         LEFT JOIN lead_representatives r ON r.lead_id=a.lead_id AND r.contact_id=a.trusted_contact_id
         WHERE a.user_id=$1 AND a.kind='guardian'
           AND (a.revoked_at IS NULL OR ($2 AND a.revoked_reason = $3))
           AND a.trusted_contact_id IS NOT NULL AND child.qualification_status <> 'deleted'
         ORDER BY r.updated_at DESC NULLS LAST,a.created_at DESC,a.id",
    )
    .bind(user_id)
    .bind(ended_by_coming_of_age)
    .bind(crate::services::coming_of_age::REVOKE_REASON)
    .fetch_all(&mut **tx)
    .await?;
    let leads = grants.iter().map(|(lead, _)| *lead).collect::<Vec<_>>();
    let profiles = crate::services::lead_guardian_identity::load_many(tx, &leads).await?;
    Ok(grants
        .into_iter()
        .filter_map(|(lead, contact)| {
            profiles
                .get(&lead)
                .and_then(|people| {
                    people
                        .iter()
                        .find(|person| person.contact_id == Some(contact))
                })
                .cloned()
        })
        .collect())
}

/// A proven parent already represented by an explicit patient record must use
/// that record's activation/repeat workflow, not create another patient via a lead.
pub(crate) async fn existing_parent_patients_in_tx(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    email: &str,
    name: &str,
    birth_date: Option<chrono::NaiveDate>,
) -> Result<Vec<Uuid>, sqlx::Error> {
    let Some(user_id) = reusable_guardian_in_tx(tx, email, name, birth_date, None, None).await?
    else {
        return Ok(Vec::new());
    };
    let ids = guardian_profiles_in_tx(tx, user_id, false)
        .await?
        .into_iter()
        .filter_map(|person| person.related_patient_id)
        .collect::<Vec<_>>();
    sqlx::query_scalar("SELECT id FROM patients WHERE id=ANY($1) AND lifecycle_status <> 'deleted' AND legal_status->>'anonymized_at' IS NULL ORDER BY id")
        .bind(ids).fetch_all(&mut **tx).await
}

/// Copies only missing basic profile values from an explicitly linked guardian
/// contact. Representative documents, answers and consents remain on the child.
async fn fill_guardian_profile_in_tx(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    lead_id: Uuid,
    user_id: Uuid,
    ended_by_coming_of_age: bool,
) -> Result<(), sqlx::Error> {
    if let Some(profile) = guardian_profiles_in_tx(tx, user_id, ended_by_coming_of_age)
        .await?
        .first()
    {
        let contact = &profile.contact;
        let extras = &profile.extras;
        let text = |key: &str| extras.get(key).and_then(Value::as_str);
        let birth_date = contact
            .get("birth_date")
            .and_then(Value::as_str)
            .and_then(|date| chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d").ok());
        sqlx::query(
            r#"UPDATE leads SET date_of_birth=COALESCE(date_of_birth,$2),
               phone=COALESCE(NULLIF(btrim(phone),''),$3),
               street_address=COALESCE(NULLIF(btrim(street_address),''),$4),
               zip_code=COALESCE(NULLIF(btrim(zip_code),''),$5),
               city=COALESCE(NULLIF(btrim(city),''),$6), country=COALESCE(NULLIF(btrim(country),''),$7),
               citizenships=CASE WHEN cardinality(citizenships)=0 THEN $8 ELSE citizenships END
               WHERE id=$1"#,
        ).bind(lead_id).bind(birth_date).bind(contact.get("phone").and_then(Value::as_str))
            .bind(text("street")).bind(text("zip")).bind(text("city"))
            .bind(text("country")).bind(&profile.citizenships).execute(&mut **tx).await?;
    }
    Ok(())
}

/// Creates the `patient` account of `lead_id` and links it to the lead. The
/// caller has authorized creation; an existing account is reusable only through
/// the guardian identity check. Other collisions fail on the unique e-mail index.
pub(crate) async fn create_for_lead_in_tx(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    lead_id: Uuid,
    email: &str,
    name: &str,
    created_by: Uuid,
) -> Result<NewPortalAccount, sqlx::Error> {
    let (birth_date, converted_patient): (Option<chrono::NaiveDate>, Option<Uuid>) =
        sqlx::query_as("SELECT date_of_birth, converted_patient_id FROM leads WHERE id=$1")
            .bind(lead_id)
            .fetch_one(&mut **tx)
            .await?;
    if let Some(guardian) = reusable_guardian_scoped_in_tx(
        tx,
        email,
        name,
        birth_date,
        Some(lead_id),
        converted_patient,
        true,
    )
    .await?
    {
        let user_id = guardian.user_id;
        if guardian.deactivated_by_coming_of_age {
            // The child came of age and the parent reached nothing else, so
            // the job switched the login off; the parent's own request
            // switches it on again (owner decision 2026-10-25). Sessions and
            // pending sign-ins the job ended stay ended: the parent signs in
            // afresh with the password they have.
            sqlx::query(
                "UPDATE users SET is_active = true, updated_at = now()
                 WHERE id = $1 AND role = 'patient' AND NOT is_active",
            )
            .bind(user_id)
            .execute(&mut **tx)
            .await?;
            audit::write_in_transaction(
                tx,
                &audit::domain_event(
                    "reactivate_guardian_for_own_lead",
                    Some(created_by),
                    "lead",
                    Some(lead_id),
                    json!({
                        "portal_user_id": user_id,
                        "deactivated_reason": crate::services::coming_of_age::REVOKE_REASON,
                        "password_changed": false,
                    }),
                ),
            )
            .await?;
        }
        sqlx::query("UPDATE leads SET portal_user_id=$2 WHERE id=$1")
            .bind(lead_id)
            .bind(user_id)
            .execute(&mut **tx)
            .await?;
        fill_guardian_profile_in_tx(tx, lead_id, user_id, guardian.deactivated_by_coming_of_age)
            .await?;
        audit::write_in_transaction(tx, &audit::domain_event("reuse_guardian_for_own_lead",
            Some(created_by), "lead", Some(lead_id),
            json!({"portal_user_id":user_id,"password_changed":false,"child_access_preserved":true}))).await?;
        return Ok(NewPortalAccount {
            user_id,
            email: email.to_string(),
            one_time_password: None,
            reused: true,
        });
    }
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
        one_time_password: Some(one_time_password),
        reused: false,
    })
}

/// Response fragment for a newly created account; the password only for the
/// roles that may hand it over.
pub(crate) fn new_account_payload(account: &NewPortalAccount, viewer: Role) -> Value {
    json!({
        "user_id": account.user_id,
        "email": account.email,
        "created": !account.reused,
        "reused": account.reused,
        "password_changed": !account.reused,
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
    // So does the log of the deletion reminders (owner decision 2026-10-24).
    sqlx::query("DELETE FROM lead_retention_reminder_emails WHERE lead_id = $1")
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
pub async fn link_to_patient_in_tx(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    lead_id: Uuid,
    patient_id: Uuid,
    assigned_by: Uuid,
) -> Result<(), sqlx::Error> {
    sqlx::query(&format!(
        r#"INSERT INTO patient_assignments (patient_id, user_id, assigned_by)
           SELECT $2, l.portal_user_id, $3
           FROM leads l
           JOIN users u ON u.id = l.portal_user_id AND u.role = 'patient' AND u.is_active
           WHERE l.id = $1 AND NOT {OWN_LOGIN_CLOSED_SQL}
           ON CONFLICT (patient_id, user_id)
           DO UPDATE SET revoked_at = NULL, source = 'manual'"#,
    ))
    .bind(lead_id)
    .bind(patient_id)
    .bind(assigned_by)
    .execute(&mut **tx)
    .await?;
    let guardian_ids: Vec<Uuid> = sqlx::query_scalar(&format!(
        r#"INSERT INTO patient_assignments (patient_id, user_id, assigned_by, source)
           SELECT DISTINCT $2, a.user_id, $3, 'lead_guardian'
           FROM leads l
           JOIN lead_portal_access a ON a.lead_id = l.id
           JOIN users u ON u.id = a.user_id AND u.role = 'patient' AND u.is_active
           WHERE l.id = $1 AND {OWN_LOGIN_CLOSED_SQL}
             AND a.kind = 'guardian' AND a.revoked_at IS NULL
           ON CONFLICT (patient_id, user_id) DO UPDATE SET revoked_at = NULL, source = 'lead_guardian'
           RETURNING user_id"#,
    ))
    .bind(lead_id)
    .bind(patient_id)
    .bind(assigned_by)
    .fetch_all(&mut **tx)
    .await?;
    for guardian_id in guardian_ids {
        let own_patients: Vec<Uuid> = sqlx::query_scalar(
            "SELECT patient_id FROM patient_assignments WHERE user_id=$1 AND revoked_at IS NULL AND source <> 'lead_guardian'",
        ).bind(guardian_id).fetch_all(&mut **tx).await?;
        if let [own_patient] = own_patients.as_slice() {
            link_guardian_relationships_in_tx(tx, guardian_id, *own_patient, assigned_by).await?;
        }
        audit::write_in_transaction(
            tx,
            &audit::domain_event(
                "link_lead_guardian_to_patient",
                Some(assigned_by),
                "patient",
                Some(patient_id),
                json!({ "reason": "guardian_of_converted_minor", "lead_id": lead_id, "user_id": guardian_id }),
            ),
        )
        .await?;
    }
    // The relation or contact this lead was made from is linked first, by
    // its id, with its own audit (`link_source_relation_to_patient`); the
    // matchers by login and by e-mail below then find it linked already
    // (QA 2026-10-25: the e-mail matcher took it first and the link was
    // audited as `link_parent_relation_by_email`).
    link_source_person_in_tx(tx, lead_id, patient_id, assigned_by).await?;
    if let Some(user_id) =
        sqlx::query_scalar::<_, Option<Uuid>>("SELECT portal_user_id FROM leads WHERE id=$1")
            .bind(lead_id)
            .fetch_one(&mut **tx)
            .await?
    {
        link_guardian_relationships_in_tx(tx, user_id, patient_id, assigned_by).await?;
    }
    link_parent_relations_by_email_in_tx(tx, patient_id, assigned_by).await?;
    sqlx::query(
        "UPDATE consent_records SET patient_id = $2 WHERE lead_id = $1 AND patient_id IS NULL",
    )
    .bind(lead_id)
    .bind(patient_id)
    .execute(&mut **tx)
    .await?;
    share_released_documents_in_tx(tx, patient_id, assigned_by).await?;
    Ok(())
}

/// A lead pre-filled from a relation or a trusted contact («Neue Anfrage für
/// diese Person», owner decision 2026-10-25; `leads.source_relation_id` /
/// `source_contact_lead_id` + `source_contact_id`) becomes that person's own
/// patient record at the conversion: the relation on the child's record and
/// the child's trusted contact point to the new patient directly, without
/// matching by e-mail. Nothing already linked to another record changes; no
/// access is granted. Returns whether a link was made.
pub async fn link_source_person_in_tx(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    lead_id: Uuid,
    patient_id: Uuid,
    actor: Uuid,
) -> Result<bool, sqlx::Error> {
    let Some(source) = sqlx::query(
        "SELECT source_relation_id, source_contact_lead_id, source_contact_id FROM leads WHERE id = $1",
    )
    .bind(lead_id)
    .fetch_optional(&mut **tx)
    .await?
    else {
        return Ok(false);
    };
    let relation_id: Option<Uuid> = source.try_get("source_relation_id")?;
    let contact_lead_id: Option<Uuid> = source.try_get("source_contact_lead_id")?;
    let contact_id: Option<Uuid> = source.try_get("source_contact_id")?;
    let mut linked = false;

    if let Some(relation_id) = relation_id {
        // The relation on the child's record, and the entry on the child's
        // requests it came from.
        let relation: Option<(Uuid, Option<Uuid>)> = sqlx::query_as(
            r#"UPDATE patient_relations
               SET related_patient_id = $2
               WHERE id = $1 AND patient_id <> $2 AND related_patient_id IS NULL
               RETURNING patient_id, source_contact_id"#,
        )
        .bind(relation_id)
        .bind(patient_id)
        .fetch_optional(&mut **tx)
        .await?;
        if let Some((child, source_contact_id)) = relation {
            if let Some(source_contact_id) = source_contact_id {
                mark_contact_linked_in_tx(tx, None, Some(child), source_contact_id, patient_id)
                    .await?;
            }
            audit::write_in_transaction(
                tx,
                &audit::domain_event(
                    "link_source_relation_to_patient",
                    Some(actor),
                    "patient",
                    Some(child),
                    json!({
                        "relation_id": relation_id,
                        "related_patient_id": patient_id,
                        "lead_id": lead_id,
                    }),
                ),
            )
            .await?;
            add_reverse_relation_in_tx(tx, relation_id, lead_id, actor).await?;
            linked = true;
        }
    }

    if let (Some(contact_lead_id), Some(contact_id)) = (contact_lead_id, contact_id) {
        let marked =
            mark_contact_linked_in_tx(tx, Some(contact_lead_id), None, contact_id, patient_id)
                .await?;
        // The source lead may have been converted meanwhile: its relation
        // row remembers the entry (`patient_relations.source_contact_id`).
        let relations: Vec<Uuid> = sqlx::query_scalar(
            r#"UPDATE patient_relations r
               SET related_patient_id = $3
               FROM leads l
               WHERE l.id = $1 AND r.patient_id = l.converted_patient_id
                 AND r.source_contact_id = $2 AND r.patient_id <> $3
                 AND (r.related_patient_id IS NULL OR r.related_patient_id = $3)
               RETURNING r.id"#,
        )
        .bind(contact_lead_id)
        .bind(contact_id)
        .bind(patient_id)
        .fetch_all(&mut **tx)
        .await?;
        if marked || !relations.is_empty() {
            audit::write_in_transaction(
                tx,
                &audit::domain_event(
                    "link_source_contact_to_patient",
                    Some(actor),
                    "lead",
                    Some(contact_lead_id),
                    json!({
                        "contact_id": contact_id,
                        "related_patient_id": patient_id,
                        "relation_ids": relations,
                        "lead_id": lead_id,
                    }),
                ),
            )
            .await?;
            for relation_id in &relations {
                add_reverse_relation_in_tx(tx, *relation_id, lead_id, actor).await?;
            }
            linked = true;
        }
    }
    Ok(linked)
}

/// The relation seen from the other side (QA 2026-10-25): once a child's
/// relation `relation_id` points to the parent's own record, the parent's
/// record names the child (`child`; a spouse or sibling the same kind), unless
/// the parent's record already has a relation to that child. Audited on the
/// parent's record; a relation of another kind gets no reverse row.
async fn add_reverse_relation_in_tx(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    relation_id: Uuid,
    lead_id: Uuid,
    actor: Uuid,
) -> Result<(), sqlx::Error> {
    let reverse: Option<(Uuid, Uuid, Uuid, String)> = sqlx::query_as(
        r#"INSERT INTO patient_relations (patient_id, related_patient_id, related_name, relation_type)
           SELECT r.related_patient_id, r.patient_id,
                  COALESCE(NULLIF(btrim(concat_ws(' ', NULLIF(btrim(other.first_name), ''),
                                                   NULLIF(btrim(other.last_name), ''))), ''),
                           other.patient_id),
                  reverse.relation_type
           FROM patient_relations r
           JOIN patients other ON other.id = r.patient_id
           CROSS JOIN LATERAL (
               SELECT CASE
                   WHEN r.relation_type IN ('parent', 'mother', 'father', 'guardian') THEN 'child'
                   WHEN r.relation_type IN ('spouse', 'sibling') THEN r.relation_type
               END AS relation_type
           ) reverse
           WHERE r.id = $1
             AND r.related_patient_id IS NOT NULL
             AND r.related_patient_id <> r.patient_id
             AND reverse.relation_type IS NOT NULL
             AND NOT EXISTS (
                 SELECT 1 FROM patient_relations existing
                 WHERE existing.patient_id = r.related_patient_id
                   AND existing.related_patient_id = r.patient_id
             )
           RETURNING id, patient_id, related_patient_id, relation_type"#,
    )
    .bind(relation_id)
    .fetch_optional(&mut **tx)
    .await?;
    if let Some((reverse_id, parent, child, relation_type)) = reverse {
        audit::write_in_transaction(
            tx,
            &audit::domain_event(
                "add_reverse_relation_from_source_person",
                Some(actor),
                "patient",
                Some(parent),
                json!({
                    "relation_id": reverse_id,
                    "reverse_of_relation_id": relation_id,
                    "related_patient_id": child,
                    "relation_type": relation_type,
                    "lead_id": lead_id,
                }),
            ),
        )
        .await?;
    }
    Ok(())
}

/// Sets `trusted_contacts[].related_patient_id` of the entry `contact_id` on
/// `lead_id`, or on every request converted to `child`, where the entry has no
/// link yet. Returns whether any lead changed.
async fn mark_contact_linked_in_tx(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    lead_id: Option<Uuid>,
    child: Option<Uuid>,
    contact_id: Uuid,
    patient_id: Uuid,
) -> Result<bool, sqlx::Error> {
    let changed = sqlx::query(
        r#"UPDATE leads l
           SET trusted_contacts = (
               SELECT jsonb_agg(
                   CASE WHEN c ->> 'id' = $3::text
                             AND NULLIF(btrim(COALESCE(c ->> 'related_patient_id', '')), '') IS NULL
                        THEN c || jsonb_build_object('related_patient_id', $4::uuid)
                        ELSE c END
                   ORDER BY n)
               FROM jsonb_array_elements(l.trusted_contacts) WITH ORDINALITY AS entries(c, n)
           )
           WHERE ($1::uuid IS NULL OR l.id = $1)
             AND ($2::uuid IS NULL OR l.converted_patient_id = $2)
             AND ($1::uuid IS NOT NULL OR $2::uuid IS NOT NULL)
             AND l.converted_patient_id IS DISTINCT FROM $4
             AND jsonb_typeof(l.trusted_contacts) = 'array'
             AND EXISTS (
                 SELECT 1 FROM jsonb_array_elements(l.trusted_contacts) c
                 WHERE c ->> 'id' = $3::text
                   AND NULLIF(btrim(COALESCE(c ->> 'related_patient_id', '')), '') IS NULL
             )"#,
    )
    .bind(lead_id)
    .bind(child)
    .bind(contact_id)
    .bind(patient_id)
    .execute(&mut **tx)
    .await?
    .rows_affected();
    Ok(changed > 0)
}

/// Releases the patient's `patient_visible` documents to the patient's
/// portal logins (QA 2026-10-25): the signed consents, the contract, the
/// order and the estimate moved from the lead carry the visibility, but the
/// portal (`GET /me/documents`) lists `document_shares` only, so the cabinet
/// stayed empty after the conversion. Same recipients and share as the
/// staff's "release to the portal" (`documents.rs`): every active patient
/// login assigned to the patient — the lead's own login, or the parents'
/// of a minor — on the channel `patient_portal`, without a confirmation; an
/// archived version, a deleted file and a document already shared with the
/// login are left out. Returns the ids of the shares made.
pub(crate) async fn share_released_documents_in_tx(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    patient_id: Uuid,
    shared_by: Uuid,
) -> Result<Vec<Uuid>, sqlx::Error> {
    sqlx::query_scalar(
        r#"INSERT INTO document_shares (
               document_id, shared_with_user_id, shared_by, channel, requires_confirmation
           )
           SELECT d.id, u.id, $2, 'patient_portal', false
           FROM documents d
           JOIN patient_assignments pa ON pa.patient_id = d.patient_id AND pa.revoked_at IS NULL
           JOIN users u ON u.id = pa.user_id AND u.role = 'patient' AND u.is_active
           WHERE d.patient_id = $1
             AND d.visibility = 'patient_visible'
             AND d.status <> 'archived'
             AND d.file_deleted_at IS NULL
             AND NOT EXISTS (
                 SELECT 1 FROM document_shares existing
                 WHERE existing.document_id = d.id
                   AND existing.shared_with_user_id = u.id
                   AND existing.revoked_at IS NULL
             )
           RETURNING id"#,
    )
    .bind(patient_id)
    .bind(shared_by)
    .fetch_all(&mut **tx)
    .await
}

/// A parent's or representative's login carries the contact's name
/// (`users.name`): when staff rename the trusted contact — in the wizard or
/// through the representative details — the login follows in the same
/// transaction (QA 2026-10-25). `renames` are `(contact id, name before,
/// name after)`. Only a login issued for that contact
/// (`lead_portal_access.trusted_contact_id`, active or ended) whose name is
/// still the old contact name is renamed; a login with a name of its own — a
/// patient account matched by e-mail, a login renamed elsewhere — stays.
/// Returns the renamed logins.
pub(crate) async fn sync_guardian_names_in_tx(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    lead_id: Uuid,
    renames: &[(Uuid, String, String)],
) -> Result<Vec<Uuid>, sqlx::Error> {
    let mut renamed = Vec::new();
    for (contact_id, before, after) in renames {
        let before = crate::services::person_fields::one_line(before);
        let after = crate::services::person_fields::one_line(after);
        if after.is_empty() || before == after {
            continue;
        }
        let users: Vec<Uuid> = sqlx::query_scalar(
            r#"UPDATE users u
               SET name = $4, updated_at = now()
               FROM lead_portal_access a
               WHERE a.lead_id = $1
                 AND a.trusted_contact_id = $2
                 AND a.kind = 'guardian'
                 AND u.id = a.user_id
                 AND u.role = 'patient'
                 AND lower(regexp_replace(btrim(u.name), '\s+', ' ', 'g')) = lower($3)
               RETURNING u.id"#,
        )
        .bind(lead_id)
        .bind(contact_id)
        .bind(&before)
        .bind(&after)
        .fetch_all(&mut **tx)
        .await?;
        renamed.extend(users);
    }
    renamed.sort_unstable();
    renamed.dedup();
    Ok(renamed)
}

/// The own login of a converted request whose patient is of age now and was
/// not linked at the conversion, because a minor's own login is closed
/// ([`OWN_LOGIN_CLOSED_SQL`], owner decision 2026-10-20): linked to the
/// patient record as [`link_to_patient_in_tx`] links an adult's login. A
/// login that is a parent's or guardian's login is never linked. Returns
/// whether a link was made.
pub(crate) async fn link_own_login_of_age_in_tx(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    lead_id: Uuid,
    patient_id: Uuid,
    assigned_by: Uuid,
) -> Result<bool, sqlx::Error> {
    let linked: Option<Uuid> = sqlx::query_scalar(&format!(
        r#"INSERT INTO patient_assignments (patient_id, user_id, assigned_by)
           SELECT $2, l.portal_user_id, $3
           FROM leads l
           JOIN users u ON u.id = l.portal_user_id AND u.role = 'patient' AND u.is_active
           WHERE l.id = $1 AND l.converted_patient_id = $2 AND NOT {OWN_LOGIN_CLOSED_SQL}
             AND NOT EXISTS (
                 SELECT 1 FROM lead_portal_access a
                 WHERE a.user_id = u.id AND a.kind = 'guardian'
             )
           ON CONFLICT (patient_id, user_id)
           DO UPDATE SET revoked_at = NULL, revoked_by = NULL, manually_revoked_at = NULL,
                         revoked_reason = NULL, source = 'manual'
           WHERE patient_assignments.revoked_at IS NOT NULL
              OR patient_assignments.source = 'lead_guardian'
           RETURNING user_id"#,
    ))
    .bind(lead_id)
    .bind(patient_id)
    .bind(assigned_by)
    .fetch_optional(&mut **tx)
    .await?;
    let Some(user_id) = linked else {
        return Ok(false);
    };
    sqlx::query(
        "UPDATE consent_records SET patient_id = $2 WHERE lead_id = $1 AND patient_id IS NULL",
    )
    .bind(lead_id)
    .bind(patient_id)
    .execute(&mut **tx)
    .await?;
    audit::write_in_transaction(
        tx,
        &audit::domain_event(
            "link_request_login_to_patient",
            Some(assigned_by),
            "patient",
            Some(patient_id),
            json!({ "portal_user_id": user_id, "lead_id": lead_id, "reason": "patient_of_age" }),
        ),
    )
    .await?;
    Ok(true)
}

/// A parent who becomes a patient is linked to the children whose records
/// name them as parent or guardian (owner decision 2026-10-19), also when the
/// parent never had a guardian login on the child's request: the child's
/// relation without a linked record carries the parent's e-mail and a name
/// of the same person ([`super::lead_portal_guardians::compatible_person_name`]),
/// and a birth date the child's converted request knows for that contact
/// agrees with the parent's. The relation and that contact then point to the
/// parent's record; nothing already linked changes, and no access is granted.
pub(crate) async fn link_parent_relations_by_email_in_tx(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    parent_patient: Uuid,
    actor: Uuid,
) -> Result<(), sqlx::Error> {
    let Some(parent) = sqlx::query(
        r#"SELECT lower(btrim(email)) AS email, birth_date,
                  concat_ws(' ', NULLIF(btrim(first_name), ''), NULLIF(btrim(last_name), '')) AS name
           FROM patients
           WHERE id = $1 AND lifecycle_status <> 'deleted'
             AND legal_status->>'anonymized_at' IS NULL
             AND NULLIF(btrim(email), '') IS NOT NULL"#,
    )
    .bind(parent_patient)
    .fetch_optional(&mut **tx)
    .await?
    else {
        return Ok(());
    };
    let email: String = parent.try_get("email")?;
    let name: String = parent.try_get("name")?;
    let birth_date: Option<chrono::NaiveDate> = parent.try_get("birth_date")?;
    if super::leads::is_minor_on(birth_date, crate::app_time::today()) {
        return Ok(());
    }
    let relations = sqlx::query(
        r#"SELECT r.id, r.patient_id, r.related_name,
                  (SELECT array_agg(DISTINCT btrim(c ->> 'birth_date'))
                   FROM leads l
                   CROSS JOIN LATERAL jsonb_array_elements(
                       CASE WHEN jsonb_typeof(l.trusted_contacts) = 'array'
                            THEN l.trusted_contacts ELSE '[]'::jsonb END) c
                   WHERE l.converted_patient_id = r.patient_id
                     AND lower(btrim(c ->> 'email')) = $2
                     AND NULLIF(btrim(c ->> 'birth_date'), '') IS NOT NULL) AS known_birth_dates
           FROM patient_relations r
           JOIN patients child ON child.id = r.patient_id
           WHERE r.related_patient_id IS NULL
             AND r.patient_id <> $1
             AND r.relation_type IN ('parent', 'mother', 'father', 'guardian')
             AND lower(btrim(r.email)) = $2
             AND child.lifecycle_status <> 'deleted'
           ORDER BY r.created_at, r.id"#,
    )
    .bind(parent_patient)
    .bind(&email)
    .fetch_all(&mut **tx)
    .await?;
    for relation in relations {
        let related_name: String = relation.try_get("related_name")?;
        if !super::lead_portal_guardians::compatible_person_name(&related_name, &name) {
            continue;
        }
        let known: Vec<String> = relation
            .try_get::<Option<Vec<String>>, _>("known_birth_dates")?
            .unwrap_or_default();
        if birth_date.is_some_and(|date| {
            known
                .iter()
                .any(|known| known != &date.format("%Y-%m-%d").to_string())
        }) {
            continue;
        }
        let relation_id: Uuid = relation.try_get("id")?;
        let child: Uuid = relation.try_get("patient_id")?;
        sqlx::query(
            "UPDATE patient_relations SET related_patient_id = $2 WHERE id = $1 AND related_patient_id IS NULL",
        )
        .bind(relation_id)
        .bind(parent_patient)
        .execute(&mut **tx)
        .await?;
        sqlx::query(
            r#"UPDATE leads l
               SET trusted_contacts = (
                   SELECT jsonb_agg(
                       CASE WHEN lower(btrim(c ->> 'email')) = $2
                                 AND NULLIF(btrim(COALESCE(c ->> 'related_patient_id', '')), '') IS NULL
                                 AND btrim(c ->> 'name') = btrim($4)
                            THEN c || jsonb_build_object('related_patient_id', $3::uuid)
                            ELSE c END
                       ORDER BY n)
                   FROM jsonb_array_elements(l.trusted_contacts) WITH ORDINALITY AS entries(c, n)
               )
               WHERE l.converted_patient_id = $1
                 AND jsonb_typeof(l.trusted_contacts) = 'array'
                 AND EXISTS (
                     SELECT 1 FROM jsonb_array_elements(l.trusted_contacts) c
                     WHERE lower(btrim(c ->> 'email')) = $2
                       AND NULLIF(btrim(COALESCE(c ->> 'related_patient_id', '')), '') IS NULL
                       AND btrim(c ->> 'name') = btrim($4)
                 )"#,
        )
        .bind(child)
        .bind(&email)
        .bind(parent_patient)
        .bind(&related_name)
        .execute(&mut **tx)
        .await?;
        audit::write_in_transaction(
            tx,
            &audit::domain_event(
                "link_parent_relation_by_email",
                Some(actor),
                "patient",
                Some(child),
                json!({
                    "relation_id": relation_id,
                    "related_patient_id": parent_patient,
                }),
            ),
        )
        .await?;
    }
    Ok(())
}

/// The guardian grant points to a particular trusted-contact UUID, so this
/// creates an explicit relationship without inferring ownership from e-mail.
/// It also works when the child is converted later than their parent.
pub(crate) async fn link_guardian_relationships_in_tx(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    user_id: Uuid,
    own_patient: Uuid,
    actor: Uuid,
) -> Result<(), sqlx::Error> {
    let rows = sqlx::query(
        r#"SELECT l.id, l.converted_patient_id, a.trusted_contact_id, c AS contact, u.name AS account_name
           FROM lead_portal_access a JOIN leads l ON l.id=a.lead_id
           JOIN users u ON u.id=a.user_id AND u.role='patient' AND u.is_active
           CROSS JOIN LATERAL jsonb_array_elements(l.trusted_contacts) c
           WHERE a.user_id=$1 AND a.kind='guardian' AND a.revoked_at IS NULL
             AND l.qualification_status <> 'deleted' AND c->>'id'=a.trusted_contact_id::text
             AND (c->>'related_patient_id' IS NULL OR c->>'related_patient_id'=$2::text)"#,
    )
    .bind(user_id)
    .bind(own_patient)
    .fetch_all(&mut **tx)
    .await?;
    for row in rows {
        let lead_id: Uuid = row.try_get("id")?;
        let contact_id: Uuid = row.try_get("trusted_contact_id")?;
        let contact: Value = row.try_get("contact")?;
        let name = contact
            .get("name")
            .and_then(Value::as_str)
            .unwrap_or_default();
        if !super::lead_portal_guardians::compatible_person_name(
            name,
            &row.try_get::<String, _>("account_name")?,
        ) {
            continue;
        }
        sqlx::query(
            r#"UPDATE leads SET trusted_contacts=(SELECT jsonb_agg(
               CASE WHEN c->>'id'=$2::text THEN c || jsonb_build_object('related_patient_id',$3::uuid) ELSE c END ORDER BY n)
               FROM jsonb_array_elements(trusted_contacts) WITH ORDINALITY AS entries(c,n)) WHERE id=$1"#,
        ).bind(lead_id).bind(contact_id).bind(own_patient).execute(&mut **tx).await?;
        if let Some(child) = row.try_get::<Option<Uuid>, _>("converted_patient_id")?
            && child != own_patient
        {
            let relation = super::leads::normalized_patient_relation_type(
                contact.get("relation").and_then(Value::as_str),
            );
            sqlx::query(
                "UPDATE patient_relations SET related_patient_id=$2, relation_type=$4 WHERE patient_id=$1 AND (related_patient_id IS NULL OR related_patient_id=$2) AND related_name=$3 AND (relation_type=$4 OR (relation_type='parent' AND $4 IN ('mother','father')))",
            ).bind(child).bind(own_patient).bind(name).bind(relation).execute(&mut **tx).await?;
            sqlx::query(
                r#"INSERT INTO patient_relations(patient_id,related_patient_id,related_name,relation_type,phone,email)
                   SELECT $1,$2,$3,$4,$5,$6 WHERE NOT EXISTS(SELECT 1 FROM patient_relations WHERE patient_id=$1 AND related_patient_id=$2 AND relation_type=$4)"#,
            ).bind(child).bind(own_patient).bind(name).bind(relation)
                .bind(contact.get("phone").and_then(Value::as_str))
                .bind(contact.get("email").and_then(Value::as_str)).execute(&mut **tx).await?;
        }
        audit::write_in_transaction(
            tx,
            &audit::domain_event(
                "link_guardian_own_patient",
                Some(actor),
                "lead",
                Some(lead_id),
                json!({"user_id":user_id,"contact_id":contact_id,"related_patient_id":own_patient}),
            ),
        )
        .await?;
    }
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

/// 409 `minor_own_login_closed`: a minor's own login gets no new password
/// and no sign-in e-mail, regardless of whether parents already have access (QA
/// 2026-10-12, A3-01). The code is also the `error`, which the UI translates.
pub(crate) fn minor_own_login_closed() -> axum::response::Response {
    (
        StatusCode::CONFLICT,
        Json(json!({
            "error": "minor_own_login_closed",
            "code": "minor_own_login_closed",
            "message": "A minor's request must be completed by a parent or legal representative",
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
    let row = match sqlx::query(&format!(
        r#"SELECT l.id, u.id AS user_id, u.email, u.is_active, u.password_reset_required,
                  u.created_at,
                  (SELECT max(tf.created_at) FROM token_families tf WHERE tf.user_id = u.id)
                      AS last_login_at,
                  {OWN_LOGIN_CLOSED_SQL} AS own_login_closed
           FROM leads l
           LEFT JOIN users u ON u.id = l.portal_user_id
           WHERE l.id = $1"#
    ))
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
                // A minor's own login while the parents have access (QA
                // 2026-10-12, A3-01): it reaches nothing, no password is issued.
                "own_login_closed": row.try_get::<bool, _>("own_login_closed").unwrap_or(false),
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
    let lead = match sqlx::query(&format!(
        r#"SELECT l.email, l.first_name, l.last_name, l.qualification_status,
                  l.converted_patient_id, l.portal_user_id, l.date_of_birth,
                  u.is_active AS portal_active,
                  {OWN_LOGIN_CLOSED_SQL} AS own_login_closed
           FROM leads l
           LEFT JOIN users u ON u.id = l.portal_user_id
           WHERE l.id = $1
           FOR UPDATE OF l"#
    ))
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
        // A minor's own login while the parents have access gets no password
        // (QA 2026-10-12, A3-01): the parents use theirs.
        if lead.try_get::<bool, _>("own_login_closed").unwrap_or(false) {
            return minor_own_login_closed();
        }
        if !lead
            .try_get::<Option<bool>, _>("portal_active")
            .ok()
            .flatten()
            .unwrap_or(false)
        {
            return err(StatusCode::CONFLICT, "The patient account is deactivated");
        }
        // A converted minor who is of age now: the own login the conversion
        // left closed becomes the patient's login (owner decision 2026-10-20).
        if let Some(patient_id) = lead
            .try_get::<Option<Uuid>, _>("converted_patient_id")
            .ok()
            .flatten()
            && let Err(error) =
                link_own_login_of_age_in_tx(&mut tx, lead_id, patient_id, auth.user_id).await
        {
            return internal(error, lead_id, "link own login to patient");
        }
        if let Err(error) = tx.commit().await {
            return internal(error, lead_id, "commit lookup");
        }
        let one_time_password = password_policy::generate_one_time_password();
        // The rejection of open sign-ins, the audit row, the new password and
        // the end of the old sessions are one transaction: a refused or failed
        // reset leaves no audit row, and a failed audit row leaves the old
        // password.
        let mut reset_tx = match state.db.begin().await {
            Ok(tx) => tx,
            Err(error) => return internal(error, lead_id, "begin password reset"),
        };
        if let Err(error) = sqlx::query(
            "UPDATE pending_logins SET status = 'rejected', resolved_at = now()
             WHERE user_id = $1 AND status IN ('pending', 'approved')",
        )
        .bind(user_id)
        .execute(&mut *reset_tx)
        .await
        {
            return internal(error, lead_id, "reject open sign-ins");
        }
        let audit_event = audit::domain_event(
            "reset_lead_portal_password",
            Some(auth.user_id),
            "lead",
            Some(lead_id),
            json!({ "portal_user_id": user_id, "sessions_revoked": true }),
        );
        if let Err(error) = audit::write_in_transaction(&mut reset_tx, &audit_event).await {
            return internal(error, lead_id, "audit password reset");
        }
        match password_policy::replace_password_in_tx(
            &mut reset_tx,
            user_id,
            &one_time_password,
            false,
        )
        .await
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
        if let Err(error) =
            crate::auth::tokens::revoke_all_families_in_tx(&mut reset_tx, user_id, "password_reset")
                .await
        {
            return internal(error, lead_id, "revoke sessions");
        }
        if let Err(error) = reset_tx.commit().await {
            return internal(error, lead_id, "commit password reset");
        }
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
            one_time_password: Some("secret".into()),
            reused: false,
        };
        assert!(new_account_payload(&account, Role::Sales)["one_time_password"].is_null());
        assert_eq!(
            new_account_payload(&account, Role::PatientManager)["one_time_password"],
            "secret"
        );
    }
}
