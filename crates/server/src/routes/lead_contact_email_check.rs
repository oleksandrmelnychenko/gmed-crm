//! `POST /leads/{lead_id}/contact-email-check` (DEV QA V-A6, owner 2026-10-26):
//! whether an e-mail address staff type for a parent, representative or
//! trusted contact in the lead wizard is already the LOGIN of another
//! person's account. The wizard shows a non-blocking warning next to the
//! field ("this address is the login of another patient (P-…, name), check
//! that it is the same person"); saving stays allowed.
//!
//! - Same access as editing the lead (`leads.edit`); 404 for an unknown lead.
//! - POST with a JSON body, so the address never appears in a URL or an
//!   access log; the handler logs no address either.
//! - Exact match on the normalised login address (`users.email`, trimmed and
//!   lower-cased as the login compares it), active accounts only.
//! - Not reported: the contact's own guardian login on this lead
//!   (`lead_portal_access.trusted_contact_id`), the login of the patient
//!   record the contact is linked to (`related_patient_id`, stored or sent),
//!   and the lead's own login when the address is the lead's own (no
//!   `contact_id`).
//! - A staff account is reported as `kind: "staff"` only, never by name.
//!   A patient's number and name only when the caller may read that patient
//!   ([`super::patients::has_patient_access`]); otherwise just the kind.

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

use crate::auth::middleware::AuthUser;
use crate::state::AppState;
use gmed_domain::access::capabilities::Capability;

pub fn router() -> Router<AppState> {
    Router::new().route(
        "/leads/{lead_id}/contact-email-check",
        post(check_contact_email),
    )
}

#[derive(Deserialize)]
struct ContactEmailCheckRequest {
    email: String,
    /// The trusted contact (`leads.trusted_contacts[].id`) the address is
    /// typed for; absent for the lead's own address.
    #[serde(default)]
    contact_id: Option<Uuid>,
    /// The patient record the editor links the contact to (picked from the
    /// guardian candidates, maybe not saved yet).
    #[serde(default)]
    related_patient_id: Option<Uuid>,
}

/// Who holds the login, as the wizard shows it.
#[derive(Default)]
struct LoginOwner {
    patient_id: Option<Uuid>,
    patient_number: Option<String>,
    lead_id: Option<Uuid>,
    display_name: Option<String>,
}

impl LoginOwner {
    fn into_value(self, kind: &str) -> Value {
        json!({
            "login_owner": {
                "kind": kind,
                "patient_id": self.patient_id,
                "patient_number": self.patient_number,
                "lead_id": self.lead_id,
                "display_name": self.display_name,
            }
        })
    }
}

fn failed() -> axum::response::Response {
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(json!({
            "error": "Internal Server Error",
            "message": "Failed to check the address",
        })),
    )
        .into_response()
}

async fn check_contact_email(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(lead_id): Path<Uuid>,
    Json(body): Json<ContactEmailCheckRequest>,
) -> Result<Json<Value>, axum::response::Response> {
    auth.require_capability(Capability::LeadsEdit)?;
    let lead_exists: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM leads WHERE id = $1)")
        .bind(lead_id)
        .fetch_one(&state.db)
        .await
        .map_err(|error| {
            tracing::error!(%error, %lead_id, "contact e-mail check: load lead");
            failed()
        })?;
    if !lead_exists {
        return Err((
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "Not Found", "message": "Lead not found" })),
        )
            .into_response());
    }
    let Some(email) = crate::email_address::normalize_stored_email(&body.email) else {
        return Ok(Json(json!({ "login_owner": Value::Null })));
    };

    let row = sqlx::query(
        r#"WITH contact AS (
               SELECT COALESCE(
                          $4::uuid,
                          (SELECT CASE WHEN entry->>'related_patient_id'
                                            ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                                       THEN (entry->>'related_patient_id')::uuid END
                           FROM leads l,
                                jsonb_array_elements(
                                    CASE WHEN jsonb_typeof(l.trusted_contacts) = 'array'
                                         THEN l.trusted_contacts ELSE '[]'::jsonb END
                                ) entry
                           WHERE l.id = $2 AND $3::uuid IS NOT NULL
                             AND entry->>'id' = $3::text
                           LIMIT 1)
                      ) AS related_patient_id
           )
           SELECT u.role,
                  NULLIF(btrim(u.name), '') AS user_name,
                  own_lead.id AS lead_id,
                  NULLIF(btrim(concat_ws(' ', own_lead.first_name, own_lead.last_name)), '')
                      AS lead_name,
                  patient.id AS patient_uuid,
                  patient.patient_id AS patient_number,
                  NULLIF(btrim(concat_ws(' ', patient.first_name, patient.last_name)), '')
                      AS patient_name
           FROM users u
           CROSS JOIN contact
           LEFT JOIN LATERAL (
               SELECT l.id, l.first_name, l.last_name
               FROM leads l
               WHERE l.portal_user_id = u.id AND u.role = 'patient'
               ORDER BY l.created_at DESC
               LIMIT 1
           ) own_lead ON true
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
             AND u.is_active
             -- The lead's own login, for the lead's own address.
             AND NOT ($3::uuid IS NULL
                      AND u.id IS NOT DISTINCT FROM (SELECT portal_user_id FROM leads WHERE id = $2))
             -- The contact's own guardian login on this lead.
             AND NOT ($3::uuid IS NOT NULL AND EXISTS (
                      SELECT 1 FROM lead_portal_access a
                      WHERE a.lead_id = $2 AND a.user_id = u.id
                        AND a.trusted_contact_id = $3))
             -- The login of the patient record the contact is linked to.
             AND NOT (contact.related_patient_id IS NOT NULL AND EXISTS (
                      SELECT 1 FROM patient_assignments pa
                      WHERE pa.user_id = u.id
                        AND pa.patient_id = contact.related_patient_id
                        AND pa.revoked_at IS NULL
                        AND pa.source <> 'lead_guardian'))
           LIMIT 1"#,
    )
    .bind(&email)
    .bind(lead_id)
    .bind(body.contact_id)
    .bind(body.related_patient_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|error| {
        tracing::error!(%error, %lead_id, "contact e-mail check: find login");
        failed()
    })?;
    let Some(row) = row else {
        return Ok(Json(json!({ "login_owner": Value::Null })));
    };

    let role: String = row.get("role");
    if role != "patient" {
        return Ok(Json(LoginOwner::default().into_value("staff")));
    }
    let user_name: Option<String> = row.get("user_name");
    if let Some(patient_id) = row.get::<Option<Uuid>, _>("patient_uuid") {
        if !super::patients::has_patient_access(&state, &auth, patient_id).await? {
            return Ok(Json(LoginOwner::default().into_value("patient")));
        }
        return Ok(Json(
            LoginOwner {
                patient_id: Some(patient_id),
                patient_number: row.get("patient_number"),
                lead_id: None,
                display_name: row.get::<Option<String>, _>("patient_name").or(user_name),
            }
            .into_value("patient"),
        ));
    }
    // A lead's own login, or a parent's login for another request: leads are
    // visible to every `leads.edit` role.
    Ok(Json(
        LoginOwner {
            patient_id: None,
            patient_number: None,
            lead_id: row.get("lead_id"),
            display_name: row.get::<Option<String>, _>("lead_name").or(user_name),
        }
        .into_value("lead"),
    ))
}
