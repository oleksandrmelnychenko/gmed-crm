//! Who a minor's parent is for the request's invoices (owner 2026-11-02): the
//! staff dialog «Добавить родителя или законного представителя» asks whether
//! the parent receives the invoice, pays, both or neither.
//!
//! The answer is no field of its own: it writes the lead's one invoice
//! recipient (`lead_invoice_recipients`, the patient side with this parent
//! named) and its one payer (`lead_payer_declarations`, `payer_kind =
//! 'representative'` — a paying parent is never a third party, owner
//! 2026-10-19), through the same functions as step 3 of the cabinet, audited
//! in the same transaction. Every parent is screened against the sanctions
//! lists; the roles decide whether a confirmed hit also counts for the risk
//! triggers, on the payer's or the recipient's side (owner 2026-11-02,
//! `risk::inputs`).
//!
//! * receives: the patient side is the recipient with this parent named;
//!   "the recipient is the payer" follows `pays`. Dropping the role of the
//!   named parent clears the answer, and the cabinet asks again.
//! * pays: the parent becomes the payer, as the cabinet's "the recipient is
//!   the payer" records it. A parent who pays cannot simply stop: someone
//!   else has to be named as payer first (`payer_still_this_parent`).

use axum::{
    Json, Router,
    extract::{Extension, Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::put,
};
use serde::Deserialize;
use serde_json::json;
use sqlx::Row;
use uuid::Uuid;

use crate::auth::middleware::AuthUser;
use crate::routes::lead_invoice_recipient::{self, RECIPIENT_SELF, Recipient};
use crate::routes::{lead_payer, lead_representatives};
use crate::state::AppState;
use gmed_domain::access::capabilities::Capability;

pub fn router() -> Router<AppState> {
    Router::new().route(
        "/leads/{lead_id}/representatives/{representative_id}/billing-role",
        put(set_billing_role),
    )
}

#[derive(Debug, Deserialize)]
pub(crate) struct BillingRoleInput {
    receives_invoice: bool,
    pays: bool,
}

fn error(status: StatusCode, code: &str, message: &str) -> Response {
    (status, Json(json!({ "error": code, "message": message }))).into_response()
}

fn database_error(error: sqlx::Error, context: &'static str) -> Response {
    tracing::error!(%error, context, "parent billing role");
    error_internal()
}

fn error_internal() -> Response {
    error(
        StatusCode::INTERNAL_SERVER_ERROR,
        "internal_error",
        "Internal server error",
    )
}

/// The parent's roles as stored: receives the invoice (the patient side is
/// the recipient and names this parent, or names none and it is the only
/// parent) and pays.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct Roles {
    pub(crate) receives_invoice: bool,
    pub(crate) pays: bool,
}

pub(crate) fn roles_of(
    parent: Uuid,
    recipient: Option<&Recipient>,
    payer: Option<&lead_payer::Declaration>,
    representation: &lead_representatives::Representation,
) -> Roles {
    let receives_invoice = recipient.is_some_and(|stored| {
        let mut resolved = stored.clone();
        let _ = lead_invoice_recipient::resolve_parent(&mut resolved, representation);
        resolved.recipient.as_deref() == Some(RECIPIENT_SELF)
            && resolved.representative_contact_id == Some(parent)
    });
    let pays = lead_representatives::payer_same_person(representation, payer) == Some(parent);
    Roles {
        receives_invoice,
        pays,
    }
}

/// A minor's parents and guardians by their current roles: who pays, who
/// receives the invoices. `None` for an adult's lead. The risk triggers read
/// the roles from here, never from a sanctions hit's snapshot, which keeps
/// the role a decided hit was screened with (QA 2026-11-03, B-1).
pub(crate) struct CurrentRoles {
    pub(crate) paying: Vec<Uuid>,
    pub(crate) receiving: Vec<Uuid>,
}

impl CurrentRoles {
    pub(crate) fn holds_a_role(&self, person: Uuid) -> bool {
        self.paying.contains(&person) || self.receiving.contains(&person)
    }
}

pub(crate) async fn current_roles(
    conn: &mut sqlx::PgConnection,
    lead_id: Uuid,
) -> Result<Option<CurrentRoles>, sqlx::Error> {
    let active = lead_representatives::load(conn, lead_id)
        .await?
        .unwrap_or_default();
    if !active.representation.minor {
        return Ok(None);
    }
    let recipient = lead_invoice_recipient::load(conn, lead_id).await?;
    let payer = lead_payer::load_declaration(conn, lead_id).await?;
    let mut roles = CurrentRoles {
        paying: Vec::new(),
        receiving: Vec::new(),
    };
    for person in &active.representation.representatives {
        let held = roles_of(
            person.id,
            recipient.as_ref(),
            payer.as_ref(),
            &active.representation,
        );
        if held.pays {
            roles.paying.push(person.id);
        }
        if held.receives_invoice {
            roles.receiving.push(person.id);
        }
    }
    Ok(Some(roles))
}

async fn set_billing_role(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path((lead_id, representative_id)): Path<(Uuid, Uuid)>,
    Json(body): Json<BillingRoleInput>,
) -> Response {
    if let Err(response) = auth.require_capability(Capability::LeadsEdit) {
        return response;
    }
    let mut tx = match state.db.begin().await {
        Ok(tx) => tx,
        Err(error) => return database_error(error, "begin"),
    };
    let lead = match sqlx::query(
        "SELECT converted_patient_id, qualification_status FROM leads WHERE id = $1 FOR UPDATE",
    )
    .bind(lead_id)
    .fetch_optional(&mut *tx)
    .await
    {
        Ok(Some(row)) => row,
        Ok(None) => return error(StatusCode::NOT_FOUND, "not_found", "Lead not found"),
        Err(error) => return database_error(error, "lock lead"),
    };
    if lead
        .try_get::<Option<Uuid>, _>("converted_patient_id")
        .unwrap_or_default()
        .is_some()
    {
        return error(
            StatusCode::CONFLICT,
            "lead_converted",
            "The lead is converted; its payer belongs to the patient record",
        );
    }
    if lead
        .try_get::<String, _>("qualification_status")
        .unwrap_or_default()
        == "deleted"
    {
        return error(StatusCode::CONFLICT, "lead_deleted", "The lead is deleted");
    }
    let representation = match lead_representatives::load(&mut tx, lead_id).await {
        Ok(loaded) => loaded.unwrap_or_default().representation,
        Err(error) => return database_error(error, "load representatives"),
    };
    // A parent or legal guardian who acts for the child (a place in the form).
    let is_parent = representation.minor
        && representation
            .find(representative_id)
            .is_some_and(|person| matches!(person.slot, Some("rep1" | "rep2")));
    if !is_parent {
        return error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "billing_role_not_a_parent",
            "Only a current parent or legal guardian of a minor receives the invoice or pays as such",
        );
    }
    let stored = match lead_invoice_recipient::load(&mut tx, lead_id).await {
        Ok(stored) => stored,
        Err(error) => return database_error(error, "load invoice recipient"),
    };
    let payer = match lead_payer::load_declaration(&mut tx, lead_id).await {
        Ok(payer) => payer,
        Err(error) => return database_error(error, "load payer"),
    };
    let before = roles_of(
        representative_id,
        stored.as_ref(),
        payer.as_ref(),
        &representation,
    );
    let wanted = Roles {
        receives_invoice: body.receives_invoice,
        pays: body.pays,
    };
    if before == wanted {
        return Json(json!({ "receives_invoice": before.receives_invoice, "pays": before.pays }))
            .into_response();
    }
    if before.pays && !wanted.pays {
        return error(
            StatusCode::CONFLICT,
            "payer_still_this_parent",
            "This parent pays: name the other parent or a third party as payer first",
        );
    }

    // The payer first: the cabinet's own save of "the recipient pays" names
    // this parent (`payer_kind = 'representative'`, with its audit event).
    if wanted.pays && !before.pays {
        let as_payer = Recipient {
            recipient: Some(RECIPIENT_SELF.into()),
            is_payer: Some(true),
            representative_contact_id: Some(representative_id),
            ..Recipient::default()
        };
        if let Err(error) = lead_invoice_recipient::record_as_payer(
            &mut tx,
            lead_id,
            auth.user_id,
            "staff",
            &as_payer,
            &representation,
            payer.as_ref(),
        )
        .await
        {
            return database_error(error, "record parent as payer");
        }
        let now_pays = match lead_payer::load_declaration(&mut tx, lead_id).await {
            Ok(after) => {
                lead_representatives::payer_same_person(&representation, after.as_ref())
                    == Some(representative_id)
            }
            Err(error) => return database_error(error, "reload payer"),
        };
        if !now_pays {
            // The payer answered through its own link: only that payer's
            // dialog changes it.
            return error(
                StatusCode::CONFLICT,
                "payer_not_changed",
                "The payer could not be changed here; change it in the payer section",
            );
        }
    }

    // The invoice recipient: one per lead.
    let current = stored.clone().unwrap_or_default();
    let mut resolved_current = current.clone();
    let _ = lead_invoice_recipient::resolve_parent(&mut resolved_current, &representation);
    let change = if wanted.receives_invoice {
        let mut next = Recipient {
            recipient: Some(RECIPIENT_SELF.into()),
            is_payer: Some(wanted.pays),
            representative_contact_id: Some(representative_id),
            ..Recipient::default()
        };
        if lead_invoice_recipient::resolve_parent(&mut next, &representation).is_err() {
            return error(
                StatusCode::UNPROCESSABLE_ENTITY,
                "billing_role_not_a_parent",
                "Only a current parent or legal guardian of a minor receives the invoice",
            );
        }
        (stored.is_none() || next != resolved_current).then_some(Some(next))
    } else if before.receives_invoice {
        // Dropped: the step asks again who receives the invoice.
        Some(None)
    } else if wanted.pays && stored.is_some() && current.is_payer == Some(true) {
        // Another recipient stays; it no longer pays.
        Some(Some(Recipient {
            is_payer: Some(false),
            ..current.clone()
        }))
    } else {
        None
    };
    match change {
        None => {}
        Some(Some(next)) => {
            // This parent's row is written resolved: compared with the stored
            // row as resolved, the audit lists what changed, not the parent's
            // address read in (QA 2026-11-03, F5). Another recipient keeps its
            // row as stored.
            let base = if wanted.receives_invoice {
                &resolved_current
            } else {
                &current
            };
            let changed = lead_invoice_recipient::changed_keys(base, &next);
            if let Err(error) =
                lead_invoice_recipient::store(&mut tx, lead_id, &next, auth.user_id).await
            {
                return database_error(error, "store invoice recipient");
            }
            if let Err(error) = crate::audit::write_in_transaction(
                &mut tx,
                &crate::audit::domain_event(
                    "update_lead_invoice_recipient",
                    Some(auth.user_id),
                    "lead",
                    Some(lead_id),
                    json!({
                        "lead_id": lead_id,
                        "fields": changed,
                        "representative_id": representative_id,
                        "reason": "parent_billing_role",
                    }),
                ),
            )
            .await
            {
                return database_error(error, "audit invoice recipient");
            }
        }
        Some(None) => {
            if let Err(error) =
                sqlx::query("DELETE FROM lead_invoice_recipients WHERE lead_id = $1")
                    .bind(lead_id)
                    .execute(&mut *tx)
                    .await
            {
                return database_error(error, "clear invoice recipient");
            }
            if let Err(error) = crate::audit::write_in_transaction(
                &mut tx,
                &crate::audit::domain_event(
                    "update_lead_invoice_recipient",
                    Some(auth.user_id),
                    "lead",
                    Some(lead_id),
                    json!({
                        "lead_id": lead_id,
                        "fields": ["invoice_recipient"],
                        "representative_id": representative_id,
                        "reason": "parent_billing_role_removed",
                    }),
                ),
            )
            .await
            {
                return database_error(error, "audit cleared invoice recipient");
            }
        }
    }
    if let Err(error) = lead_invoice_recipient::audit_section_seven_change(
        &mut tx,
        lead_id,
        payer.as_ref(),
        auth.user_id,
        "staff",
    )
    .await
    {
        return database_error(error, "audit section seven");
    }
    // What is stored now, read back.
    let stored = match lead_invoice_recipient::load(&mut tx, lead_id).await {
        Ok(stored) => stored,
        Err(error) => return database_error(error, "reload invoice recipient"),
    };
    let payer = match lead_payer::load_declaration(&mut tx, lead_id).await {
        Ok(payer) => payer,
        Err(error) => return database_error(error, "reload payer"),
    };
    let after = roles_of(
        representative_id,
        stored.as_ref(),
        payer.as_ref(),
        &representation,
    );
    // The roles decide which parents count for the risk triggers.
    if after != before
        && let Err(error) = crate::risk::store::reassess(
            &mut tx,
            lead_id,
            crate::risk::store::Cause::Staff,
            Some(auth.user_id),
        )
        .await
    {
        return database_error(error, "reassess risk");
    }
    if let Err(error) = tx.commit().await {
        return database_error(error, "commit");
    }
    Json(json!({ "receives_invoice": after.receives_invoice, "pays": after.pays })).into_response()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_body_names_both_roles() {
        let input: BillingRoleInput =
            serde_json::from_value(json!({"receives_invoice": true, "pays": false})).unwrap();
        assert!(input.receives_invoice && !input.pays);
        assert!(
            serde_json::from_value::<BillingRoleInput>(json!({"receives_invoice": true})).is_err()
        );
    }
}
