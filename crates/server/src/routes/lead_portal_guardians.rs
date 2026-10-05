//! Parents' and legal guardians' access to a minor's lead (owner decision
//! 2026-10-03: a minor gets no own login, the parents fill in the request).
//!
//! The CEO or a patient manager issues the access from the lead's access row
//! for a trusted contact with the relation parent / guardian and an e-mail
//! address. The login is a `patient` account linked through
//! `lead_portal_access` (kind `guardian`); the lead's own login stays in
//! `leads.portal_user_id`.
//!
//! E-mail addresses are unique across accounts. The only reuse allowed is an
//! existing `patient` account of the same person (same address and name), so
//! a parent with two children has one login that sees both requests; any
//! other owner of the address gives 409 `portal_email_taken`. A login is
//! never disabled while it still has another active link (another request, a
//! patient record or its own lead).

use axum::{
    Json, Router,
    extract::{Extension, Path, State},
    http::StatusCode,
    response::IntoResponse,
    routing::post,
};
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::Row;
use uuid::Uuid;

use crate::audit;
use crate::auth::middleware::AuthUser;
use crate::auth::{password, password_policy};
use crate::routes::lead_portal_account::{
    anonymize_and_disable_in_tx, email_owner, email_taken_response, is_unique_violation,
    may_issue_portal_password, normalize_portal_email,
};
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/leads/{lead_id}/portal-guardians",
            post(issue_guardian_access),
        )
        .route(
            "/leads/{lead_id}/portal-guardians/{access_id}/password",
            post(reset_guardian_password),
        )
        .route(
            "/leads/{lead_id}/portal-guardians/{access_id}/revoke",
            post(revoke_guardian_access),
        )
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

fn coded(status: StatusCode, code: &str, message: &str) -> axum::response::Response {
    (
        status,
        Json(json!({
            "error": status.canonical_reason().unwrap_or("error"),
            "code": code,
            "message": message,
        })),
    )
        .into_response()
}

fn internal(error: impl std::fmt::Display, what: &str) -> axum::response::Response {
    tracing::error!(%error, what, "lead guardian access");
    err(StatusCode::INTERNAL_SERVER_ERROR, "Failed")
}

/// Names compared for "the same person": case and spacing do not matter.
pub(crate) fn same_person_name(left: &str, right: &str) -> bool {
    let normalize = |value: &str| {
        value
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ")
            .to_lowercase()
    };
    let left = normalize(left);
    !left.is_empty() && left == normalize(right)
}

/// Whether `user_id` still reaches anything besides `lead_id`: a patient
/// record, an own lead or another request as a parent.
pub(crate) async fn has_other_active_links(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    user_id: Uuid,
    lead_id: Uuid,
) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar(
        r#"SELECT EXISTS(
                   SELECT 1 FROM patient_assignments
                   WHERE user_id = $1 AND revoked_at IS NULL
               )
               OR EXISTS(
                   SELECT 1 FROM leads
                   WHERE portal_user_id = $1 AND id <> $2
                     AND qualification_status <> 'deleted'
               )
               OR EXISTS(
                   SELECT 1 FROM lead_portal_access
                   WHERE user_id = $1 AND lead_id <> $2 AND revoked_at IS NULL
               )"#,
    )
    .bind(user_id)
    .bind(lead_id)
    .fetch_one(&mut **tx)
    .await
}

/// Revokes the guardian logins of a purged lead, in the purge transaction.
/// A login without any other link is deactivated and anonymised like the
/// lead's own login.
pub(crate) async fn revoke_for_purged_lead_in_tx(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    lead_id: Uuid,
    processed_by: Option<Uuid>,
) -> Result<Vec<Uuid>, sqlx::Error> {
    let users: Vec<Uuid> = sqlx::query_scalar(
        r#"UPDATE lead_portal_access
           SET revoked_at = now(), revoked_by = $2, revoked_reason = 'lead_purged'
           WHERE lead_id = $1 AND revoked_at IS NULL
           RETURNING user_id"#,
    )
    .bind(lead_id)
    .bind(processed_by)
    .fetch_all(&mut **tx)
    .await?;
    let mut disabled = Vec::new();
    for user_id in users {
        if has_other_active_links(tx, user_id, lead_id).await? {
            continue;
        }
        anonymize_and_disable_in_tx(tx, user_id, lead_id, processed_by).await?;
        disabled.push(user_id);
    }
    Ok(disabled)
}

/// Guardian logins of a lead and the trusted contacts that could get one,
/// for the staff access row.
pub(crate) async fn guardian_access_summary(
    db: &gmed_db::DbPool,
    lead_id: Uuid,
) -> Result<Value, sqlx::Error> {
    let contacts: Value = sqlx::query_scalar("SELECT trusted_contacts FROM leads WHERE id = $1")
        .bind(lead_id)
        .fetch_optional(db)
        .await?
        .unwrap_or_else(|| json!([]));
    let links = sqlx::query(
        r#"SELECT a.id, a.user_id, a.trusted_contact_id, a.created_at, a.revoked_at,
                  a.revoked_reason, u.email, u.name, u.is_active, u.password_reset_required,
                  (SELECT max(tf.created_at) FROM token_families tf WHERE tf.user_id = a.user_id)
                      AS last_login_at
           FROM lead_portal_access a
           JOIN users u ON u.id = a.user_id
           WHERE a.lead_id = $1 AND a.kind = 'guardian'
           ORDER BY a.created_at"#,
    )
    .bind(lead_id)
    .fetch_all(db)
    .await?;
    let time = |row: &sqlx::postgres::PgRow, column: &str| {
        row.try_get::<Option<chrono::DateTime<chrono::Utc>>, _>(column)
            .ok()
            .flatten()
    };
    let link_items: Vec<Value> = links
        .iter()
        .map(|row| {
            json!({
                "access_id": row.try_get::<Uuid, _>("id").ok(),
                "user_id": row.try_get::<Uuid, _>("user_id").ok(),
                "trusted_contact_id": row.try_get::<Option<Uuid>, _>("trusted_contact_id").ok().flatten(),
                "name": row.try_get::<String, _>("name").ok(),
                "email": row.try_get::<String, _>("email").ok(),
                "is_active": row.try_get::<bool, _>("is_active").unwrap_or(false),
                "password_change_pending": row.try_get::<bool, _>("password_reset_required").unwrap_or(false),
                "last_login_at": time(row, "last_login_at"),
                "created_at": time(row, "created_at"),
                "revoked_at": time(row, "revoked_at"),
                "revoked_reason": row.try_get::<Option<String>, _>("revoked_reason").ok().flatten(),
            })
        })
        .collect();
    let candidates: Vec<Value> = contacts
        .as_array()
        .into_iter()
        .flatten()
        .filter(|contact| {
            crate::routes::leads::is_parent_or_guardian_relation(
                contact.get("relation").and_then(Value::as_str),
            )
        })
        .map(|contact| {
            let id = contact
                .get("id")
                .and_then(Value::as_str)
                .and_then(|id| Uuid::parse_str(id).ok());
            let active = links.iter().find(|row| {
                row.try_get::<Option<Uuid>, _>("trusted_contact_id")
                    .ok()
                    .flatten()
                    == id
                    && id.is_some()
                    && time(row, "revoked_at").is_none()
            });
            json!({
                "trusted_contact_id": id,
                "name": contact.get("name").and_then(Value::as_str),
                "relation": contact.get("relation").and_then(Value::as_str),
                "email": normalize_portal_email(contact.get("email").and_then(Value::as_str)),
                "access_id": active.and_then(|row| row.try_get::<Uuid, _>("id").ok()),
            })
        })
        .collect();
    Ok(json!({ "links": link_items, "candidates": candidates }))
}

#[derive(Deserialize)]
struct IssueGuardianRequest {
    trusted_contact_id: Uuid,
}

/// `POST /leads/{lead_id}/portal-guardians`: access for a parent or legal
/// guardian of a minor lead. Creates a login (one-time password, shown once)
/// or links the parent's existing patient login.
async fn issue_guardian_access(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(lead_id): Path<Uuid>,
    Json(body): Json<IssueGuardianRequest>,
) -> axum::response::Response {
    if !may_issue_portal_password(auth.role) {
        return err(
            StatusCode::FORBIDDEN,
            "Only the CEO or a patient manager can issue patient access",
        );
    }
    let mut tx = match state.db.begin().await {
        Ok(tx) => tx,
        Err(error) => return internal(error, "begin"),
    };
    let lead = match sqlx::query(
        r#"SELECT qualification_status, converted_patient_id, date_of_birth,
                  trusted_contacts, portal_user_id
           FROM leads WHERE id = $1
           FOR UPDATE"#,
    )
    .bind(lead_id)
    .fetch_optional(&mut *tx)
    .await
    {
        Ok(Some(row)) => row,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Lead not found"),
        Err(error) => return internal(error, "load lead"),
    };
    if lead
        .try_get::<String, _>("qualification_status")
        .is_ok_and(|status| status == "deleted")
    {
        return err(StatusCode::CONFLICT, "A deleted lead has no patient access");
    }
    if lead
        .try_get::<Option<Uuid>, _>("converted_patient_id")
        .ok()
        .flatten()
        .is_some()
    {
        return err(
            StatusCode::CONFLICT,
            "The lead is converted; manage the access on the patient record",
        );
    }
    if !crate::routes::leads::is_minor_on(
        lead.try_get::<Option<chrono::NaiveDate>, _>("date_of_birth")
            .ok()
            .flatten(),
        crate::app_time::today(),
    ) {
        return coded(
            StatusCode::UNPROCESSABLE_ENTITY,
            "guardian_access_minors_only",
            "Parents' access is for minors: the date of birth must show an age under 18",
        );
    }
    let contacts: Value = lead
        .try_get("trusted_contacts")
        .unwrap_or_else(|_| json!([]));
    let contact_id = body.trusted_contact_id.to_string();
    let Some(contact) = contacts
        .as_array()
        .into_iter()
        .flatten()
        .find(|contact| contact.get("id").and_then(Value::as_str) == Some(contact_id.as_str()))
        .cloned()
    else {
        return err(StatusCode::NOT_FOUND, "Trusted contact not found");
    };
    if !crate::routes::leads::is_parent_or_guardian_relation(
        contact.get("relation").and_then(Value::as_str),
    ) {
        return coded(
            StatusCode::UNPROCESSABLE_ENTITY,
            "not_a_guardian",
            "Only a parent or legal guardian gets access to a minor's request",
        );
    }
    let Some(email) = normalize_portal_email(contact.get("email").and_then(Value::as_str)) else {
        return coded(
            StatusCode::UNPROCESSABLE_ENTITY,
            "guardian_email_required",
            "The contact needs a valid e-mail address: it is the login",
        );
    };
    let name = contact
        .get("name")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim()
        .to_string();
    match sqlx::query_scalar::<_, bool>(
        r#"SELECT EXISTS(
               SELECT 1 FROM lead_portal_access
               WHERE lead_id = $1 AND trusted_contact_id = $2 AND revoked_at IS NULL
           )"#,
    )
    .bind(lead_id)
    .bind(body.trusted_contact_id)
    .fetch_one(&mut *tx)
    .await
    {
        Ok(false) => {}
        Ok(true) => {
            return coded(
                StatusCode::CONFLICT,
                "guardian_access_exists",
                "This contact already has access; issue a new password instead",
            );
        }
        Err(error) => return internal(error, "check existing access"),
    }

    let existing = match sqlx::query(
        r#"SELECT id, role, is_active, name,
                  EXISTS(SELECT 1 FROM patient_assignments pa
                         WHERE pa.user_id = users.id AND pa.revoked_at IS NULL) AS has_patient,
                  EXISTS(SELECT 1 FROM lead_portal_access a WHERE a.user_id = users.id)
                      AS was_guardian
           FROM users
           WHERE lower(btrim(email)) = $1
           FOR UPDATE"#,
    )
    .bind(&email)
    .fetch_optional(&mut *tx)
    .await
    {
        Ok(row) => row,
        Err(error) => return internal(error, "load account"),
    };
    let lead_login: Option<Uuid> = lead.try_get("portal_user_id").ok().flatten();

    // (login, one-time password, created, reactivated)
    let (user_id, one_time_password, created, reactivated) = match existing {
        None => {
            let one_time_password = password_policy::generate_one_time_password();
            let hash = match password::hash_password(&one_time_password) {
                Ok(hash) => hash,
                Err(error) => return internal(error, "hash password"),
            };
            let inserted: Result<Uuid, sqlx::Error> = sqlx::query_scalar(
                // Like the lead's own login: no forced change at the first sign-in.
                r#"INSERT INTO users (email, password_hash, name, role, is_active, password_reset_required)
                   VALUES ($1, $2, $3, 'patient', true, false)
                   RETURNING id"#,
            )
            .bind(&email)
            .bind(&hash)
            .bind(if name.is_empty() { email.as_str() } else { name.as_str() })
            .fetch_one(&mut *tx)
            .await;
            match inserted {
                Ok(user_id) => (user_id, Some(one_time_password), true, false),
                Err(error) if is_unique_violation(&error) => {
                    drop(tx);
                    return match email_owner(&state.db, &email, None).await {
                        Ok(Some(owner)) => email_taken_response(owner),
                        _ => err(StatusCode::CONFLICT, "Email already belongs to an account"),
                    };
                }
                Err(error) => return internal(error, "create account"),
            }
        }
        Some(account) => {
            let user_id: Uuid = match account.try_get("id") {
                Ok(id) => id,
                Err(error) => return internal(error, "read account"),
            };
            let same_patient = account
                .try_get::<String, _>("role")
                .is_ok_and(|role| role == "patient")
                && same_person_name(
                    &account.try_get::<String, _>("name").unwrap_or_default(),
                    &name,
                )
                && Some(user_id) != lead_login;
            if !same_patient {
                return match email_owner(&mut *tx, &email, None).await {
                    Ok(Some(owner)) => email_taken_response(owner),
                    Ok(None) => err(StatusCode::CONFLICT, "Email already belongs to an account"),
                    Err(error) => internal(error, "email owner"),
                };
            }
            if account.try_get::<bool, _>("is_active").unwrap_or(false) {
                (user_id, None, false, false)
            } else if account.try_get::<bool, _>("was_guardian").unwrap_or(false)
                && !account.try_get::<bool, _>("has_patient").unwrap_or(true)
            {
                // A parent's login switched off when its last access was
                // revoked: it comes back with a new one-time password.
                let one_time_password = password_policy::generate_one_time_password();
                let hash = match password::hash_password(&one_time_password) {
                    Ok(hash) => hash,
                    Err(error) => return internal(error, "hash password"),
                };
                if let Err(error) = sqlx::query(
                    r#"UPDATE users
                       SET is_active = true, password_hash = $2,
                           password_reset_required = false, updated_at = now()
                       WHERE id = $1"#,
                )
                .bind(user_id)
                .bind(&hash)
                .execute(&mut *tx)
                .await
                {
                    return internal(error, "reactivate account");
                }
                (user_id, Some(one_time_password), false, true)
            } else {
                return coded(
                    StatusCode::CONFLICT,
                    "portal_account_inactive",
                    "The account with this e-mail is deactivated; IT administration must reactivate it",
                );
            }
        }
    };

    let access_id: Uuid = match sqlx::query_scalar(
        r#"INSERT INTO lead_portal_access (lead_id, user_id, kind, trusted_contact_id, created_by)
           VALUES ($1, $2, 'guardian', $3, $4)
           RETURNING id"#,
    )
    .bind(lead_id)
    .bind(user_id)
    .bind(body.trusted_contact_id)
    .bind(auth.user_id)
    .fetch_one(&mut *tx)
    .await
    {
        Ok(id) => id,
        Err(error) if is_unique_violation(&error) => {
            return coded(
                StatusCode::CONFLICT,
                "guardian_access_exists",
                "This login already has access to the request",
            );
        }
        Err(error) => return internal(error, "link guardian"),
    };
    let reused = !created && !reactivated;
    if let Err(error) = audit::write_in_transaction(
        &mut tx,
        &audit::domain_event(
            "issue_lead_guardian_access",
            Some(auth.user_id),
            "lead",
            Some(lead_id),
            json!({
                "access_id": access_id,
                "portal_user_id": user_id,
                "trusted_contact_id": body.trusted_contact_id,
                "email": email,
                "created": created,
                "reused_existing_login": reused,
                "reactivated": reactivated,
            }),
        ),
    )
    .await
    {
        return internal(error, "audit guardian access");
    }
    if let Err(error) = tx.commit().await {
        return internal(error, "commit guardian access");
    }
    crate::realtime::publish_lead_event(
        &state,
        Some(auth.user_id),
        "lead.portal_updated",
        lead_id,
        json!({ "change": "guardian_access", "access_id": access_id }),
    )
    .await;
    (
        StatusCode::CREATED,
        Json(json!({
            "access_id": access_id,
            "user_id": user_id,
            "email": email,
            "created": created,
            "reused": reused,
            "one_time_password": one_time_password,
        })),
    )
        .into_response()
}

/// The active guardian link `access_id` of `lead_id` and its login.
async fn active_guardian_link(
    state: &AppState,
    lead_id: Uuid,
    access_id: Uuid,
) -> Result<Option<sqlx::postgres::PgRow>, sqlx::Error> {
    sqlx::query(
        r#"SELECT a.user_id, u.email, u.is_active,
                  EXISTS(SELECT 1 FROM patient_assignments pa
                         WHERE pa.user_id = a.user_id AND pa.revoked_at IS NULL)
                  OR EXISTS(SELECT 1 FROM leads l WHERE l.portal_user_id = a.user_id)
                      AS own_patient_login
           FROM lead_portal_access a
           JOIN users u ON u.id = a.user_id
           WHERE a.id = $1 AND a.lead_id = $2 AND a.kind = 'guardian' AND a.revoked_at IS NULL"#,
    )
    .bind(access_id)
    .bind(lead_id)
    .fetch_optional(&state.db)
    .await
}

/// `POST /leads/{lead_id}/portal-guardians/{access_id}/password`: a new
/// one-time password for a parent's login. A login that is also a patient's
/// own login is reset where that patient's access is managed.
async fn reset_guardian_password(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path((lead_id, access_id)): Path<(Uuid, Uuid)>,
) -> axum::response::Response {
    if !may_issue_portal_password(auth.role) {
        return err(
            StatusCode::FORBIDDEN,
            "Only the CEO or a patient manager can issue patient access",
        );
    }
    let link = match active_guardian_link(&state, lead_id, access_id).await {
        Ok(Some(link)) => link,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Access not found"),
        Err(error) => return internal(error, "load access"),
    };
    let user_id: Uuid = match link.try_get("user_id") {
        Ok(id) => id,
        Err(error) => return internal(error, "read access"),
    };
    if link.try_get::<bool, _>("own_patient_login").unwrap_or(true) {
        return coded(
            StatusCode::CONFLICT,
            "use_patient_access",
            "This login is also the parent's own patient login; reset it there",
        );
    }
    if !link.try_get::<bool, _>("is_active").unwrap_or(false) {
        return err(StatusCode::CONFLICT, "The login is deactivated");
    }
    let one_time_password = password_policy::generate_one_time_password();
    match password_policy::replace_password(&state.db, user_id, &one_time_password, false).await {
        Ok(()) => {}
        Err(password_policy::PasswordChangeError::Rejected(message)) => {
            return err(StatusCode::UNPROCESSABLE_ENTITY, message);
        }
        Err(password_policy::PasswordChangeError::NotFound) => {
            return err(StatusCode::NOT_FOUND, "Account not found");
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
        "reset_lead_guardian_password",
        Some(auth.user_id),
        "lead",
        Some(lead_id),
        json!({ "access_id": access_id, "portal_user_id": user_id, "sessions_revoked": true }),
    ));
    Json(json!({
        "access_id": access_id,
        "user_id": user_id,
        "email": link.try_get::<String, _>("email").ok(),
        "created": false,
        "reused": false,
        "one_time_password": one_time_password,
    }))
    .into_response()
}

/// `POST /leads/{lead_id}/portal-guardians/{access_id}/revoke`: ends a
/// parent's access to this request. A login without any other link is
/// switched off (not anonymised: it can be issued again).
async fn revoke_guardian_access(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path((lead_id, access_id)): Path<(Uuid, Uuid)>,
) -> axum::response::Response {
    if !may_issue_portal_password(auth.role) {
        return err(
            StatusCode::FORBIDDEN,
            "Only the CEO or a patient manager can issue patient access",
        );
    }
    let mut tx = match state.db.begin().await {
        Ok(tx) => tx,
        Err(error) => return internal(error, "begin"),
    };
    let user_id: Uuid = match sqlx::query_scalar(
        r#"UPDATE lead_portal_access
           SET revoked_at = now(), revoked_by = $3, revoked_reason = 'revoked_by_staff'
           WHERE id = $1 AND lead_id = $2 AND kind = 'guardian' AND revoked_at IS NULL
           RETURNING user_id"#,
    )
    .bind(access_id)
    .bind(lead_id)
    .bind(auth.user_id)
    .fetch_optional(&mut *tx)
    .await
    {
        Ok(Some(user_id)) => user_id,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Access not found"),
        Err(error) => return internal(error, "revoke access"),
    };
    let keeps_access = match has_other_active_links(&mut tx, user_id, lead_id).await {
        Ok(value) => value,
        Err(error) => return internal(error, "check other links"),
    };
    if !keeps_access {
        let switched_off = async {
            sqlx::query("UPDATE users SET is_active = false, updated_at = now() WHERE id = $1")
                .bind(user_id)
                .execute(&mut *tx)
                .await?;
            sqlx::query(
                "UPDATE token_families SET is_revoked = true, revoked_reason = 'guardian_access_revoked'
                 WHERE user_id = $1 AND NOT is_revoked",
            )
            .bind(user_id)
            .execute(&mut *tx)
            .await?;
            sqlx::query(
                "UPDATE pending_logins SET status = 'rejected', resolved_at = now()
                 WHERE user_id = $1 AND status IN ('pending', 'approved')",
            )
            .bind(user_id)
            .execute(&mut *tx)
            .await
        }
        .await;
        if let Err(error) = switched_off {
            return internal(error, "switch off login");
        }
    }
    if let Err(error) = audit::write_in_transaction(
        &mut tx,
        &audit::domain_event(
            "revoke_lead_guardian_access",
            Some(auth.user_id),
            "lead",
            Some(lead_id),
            json!({
                "access_id": access_id,
                "portal_user_id": user_id,
                "login_deactivated": !keeps_access,
            }),
        ),
    )
    .await
    {
        return internal(error, "audit revocation");
    }
    if let Err(error) = tx.commit().await {
        return internal(error, "commit revocation");
    }
    crate::realtime::publish_lead_event(
        &state,
        Some(auth.user_id),
        "lead.portal_updated",
        lead_id,
        json!({ "change": "guardian_access_revoked", "access_id": access_id }),
    )
    .await;
    Json(json!({ "access_id": access_id, "login_deactivated": !keeps_access })).into_response()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn same_person_ignores_case_and_spacing() {
        assert!(same_person_name("Olga  Petrenko", " olga petrenko "));
        assert!(!same_person_name("Olga Petrenko", "Oleg Petrenko"));
        assert!(!same_person_name("", ""));
    }
}
