//! Patient status enables sign-in. The order tariff (GMED One / Reserve /
//! Behandlung) is optional (owner decision 9, 2026-11-13): without one the
//! portal shows everything of the patient's own orders — visits, documents,
//! invoices, notifications, the concierge services already booked — and only
//! a new concierge request and the team chat need an active tariff.
use axum::{
    Json,
    extract::{Request, State},
    http::{Method, StatusCode},
    middleware::Next,
    response::{IntoResponse, Response},
};
use gmed_domain::role::Role;
use uuid::Uuid;

use crate::{auth::middleware::AuthUser, state::AppState};

/// `p` is the patient alias, shared by /me and the request-time check.
pub(crate) const ACTIVE_SUBSCRIPTION_SQL: &str = "EXISTS(
    SELECT 1 FROM patient_service_packages subscription
    JOIN orders subscription_order ON subscription_order.id = subscription.order_id
      AND subscription_order.patient_id = subscription.patient_id
    WHERE subscription.patient_id = p.id AND subscription.status = 'active'
      AND subscription.portal_visible = true AND subscription_order.status <> 'cancelled'
      AND (subscription.starts_on IS NULL OR subscription.starts_on <= (now() AT TIME ZONE 'Europe/Berlin')::date)
      AND (subscription.ends_on IS NULL OR subscription.ends_on >= (now() AT TIME ZONE 'Europe/Berlin')::date)
)";

/// A subscription staff paused (owner decision 2026-11-10): new actions are
/// closed, but what is already agreed stays readable and the chat with the
/// manager stays open. `p` is the patient alias, as above.
pub(crate) const PAUSED_SUBSCRIPTION_SQL: &str = "EXISTS(
    SELECT 1 FROM patient_service_packages subscription
    JOIN orders subscription_order ON subscription_order.id = subscription.order_id
      AND subscription_order.patient_id = subscription.patient_id
    WHERE subscription.patient_id = p.id AND subscription.status = 'paused'
      AND subscription.portal_visible = true AND subscription_order.status <> 'cancelled'
)";

pub(crate) async fn has_active_subscription(
    state: &AppState,
    patient_id: Uuid,
) -> Result<bool, Response> {
    subscription_matches(state, patient_id, ACTIVE_SUBSCRIPTION_SQL).await
}

async fn has_paused_subscription(state: &AppState, patient_id: Uuid) -> Result<bool, Response> {
    subscription_matches(state, patient_id, PAUSED_SUBSCRIPTION_SQL).await
}

async fn subscription_matches(
    state: &AppState,
    patient_id: Uuid,
    condition: &str,
) -> Result<bool, Response> {
    sqlx::query_scalar::<_, bool>(&format!(
        "SELECT {condition} FROM patients p WHERE p.id = $1"
    ))
    .bind(patient_id)
    .fetch_optional(&state.db)
    .await
    .map(|value| value.unwrap_or(false))
    .map_err(|error| {
        tracing::error!(%error, %patient_id, "check portal subscription");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({
                "error": "internal", "message": "Failed to validate portal subscription"
            })),
        )
            .into_response()
    })
}

/// The patient record of a portal login; a login without one gets the
/// subscription refusal, as before.
async fn portal_patient_id(state: &AppState, auth: &AuthUser) -> Result<Uuid, Response> {
    match super::me::resolve_self_patient_id(state, auth).await {
        Ok(id) => Ok(id),
        Err(response) if response.status() == StatusCode::NOT_FOUND => Err(subscription_required()),
        Err(response) => Err(response),
    }
}

/// The team chat: an active tariff, or a paused one (the chat with the
/// manager stays open during a pause, owner decision 2026-11-10).
pub(crate) async fn require_subscription_or_pause(
    state: &AppState,
    auth: &AuthUser,
) -> Result<(), Response> {
    if auth.role != Role::Patient {
        return Ok(());
    }
    let patient_id = portal_patient_id(state, auth).await?;
    if has_active_subscription(state, patient_id).await?
        || has_paused_subscription(state, patient_id).await?
    {
        Ok(())
    } else {
        Err(subscription_required())
    }
}

fn subscription_required() -> Response {
    (
        StatusCode::FORBIDDEN,
        Json(serde_json::json!({
            "error": "subscription_required",
            "message": "An active subscription in the patient's order is required"
        })),
    )
        .into_response()
}

fn within(path: &str, root: &str) -> bool {
    path == root
        || path
            .strip_prefix(root)
            .is_some_and(|tail| tail.starts_with('/'))
}

fn basic_path(path: &str) -> bool {
    let path = path.strip_prefix("/api/v1").unwrap_or(path);
    [
        "/me",
        "/me/profile",
        "/me/appearance",
        "/me/password",
        "/me/export",
        "/me/account-statement",
        "/me/document-alerts",
        "/me/translation-requests",
        // The address check of the forms (a lead's payer, a contact): no paid
        // module, any signed-in user may ask (`email_check.rs`).
        "/me/email-check",
    ]
    .contains(&path)
        || [
            "/auth",
            "/me/totp",
            "/me/privacy-requests",
            "/me/documents",
            "/me/invoices",
            "/me/lead-requests",
            "/legal",
        ]
        .iter()
        .any(|root| within(path, root))
}

/// What needs a tariff (owner decision 9, 2026-11-13): a new concierge
/// request and the team chat. Cancelling an own open request, the booked
/// services, visits, notifications and the rest of the own orders do not.
fn tariff_path(method: &Method, path: &str) -> bool {
    let path = path.strip_prefix("/api/v1").unwrap_or(path);
    (method == Method::POST && path == "/me/concierge-services") || chat_path(path)
}

fn chat_path(path: &str) -> bool {
    let path = path.strip_prefix("/api/v1").unwrap_or(path);
    within(path, "/messages")
}

/// What a subscription staff paused closes besides a new concierge request
/// (owner decision 2026-11-10, new actions closed): a new appointment
/// request and withdrawing one. Without any tariff they stay open — only the
/// staff pause closes them.
fn pause_closed_path(method: &Method, path: &str) -> bool {
    let path = path.strip_prefix("/api/v1").unwrap_or(path);
    method == Method::POST && within(path, "/me/appointment-requests")
}

pub async fn middleware(State(state): State<AppState>, req: Request, next: Next) -> Response {
    if let Some(auth) = req.extensions().get::<AuthUser>()
        && auth.role == Role::Patient
        && !basic_path(req.uri().path())
    {
        let path = req.uri().path();
        let patient_id = match portal_patient_id(&state, auth).await {
            Ok(id) => id,
            Err(response) => return response,
        };
        let needs_tariff = tariff_path(req.method(), path);
        if needs_tariff || pause_closed_path(req.method(), path) {
            let active = match has_active_subscription(&state, patient_id).await {
                Ok(value) => value,
                Err(response) => return response,
            };
            if !active {
                let paused = match has_paused_subscription(&state, patient_id).await {
                    Ok(value) => value,
                    Err(response) => return response,
                };
                let allowed = if needs_tariff {
                    paused && chat_path(path)
                } else {
                    !paused
                };
                if !allowed {
                    return subscription_required();
                }
            }
        }
    }
    next.run(req).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base_access_does_not_include_paid_modules_or_similar_prefixes() {
        for path in [
            "/me",
            "/me/profile",
            "/me/appearance",
            "/auth/sessions",
            "/me/totp/setup",
            "/me/privacy-requests",
            "/me/documents/a/download",
            "/me/invoices/a/payments",
            "/me/lead-requests/a",
            "/me/account-statement",
            "/me/email-check",
        ] {
            assert!(basic_path(path), "{path}");
            assert!(basic_path(&format!("/api/v1{path}")), "{path}");
        }
        for path in [
            "/me/appointments",
            "/me/subscriptions",
            "/messages/conversations",
            "/me/recommendations",
            "/notifications",
            "/me/documents-extra",
            "/patients/a/clinical",
        ] {
            assert!(!basic_path(path), "{path}");
        }
    }

    #[test]
    fn only_a_new_concierge_request_and_the_chat_need_a_tariff() {
        for (method, path) in [
            (Method::POST, "/me/concierge-services"),
            (Method::POST, "/api/v1/me/concierge-services"),
            (Method::GET, "/messages/conversations"),
            (Method::POST, "/messages/a/upload"),
            (Method::GET, "/api/v1/messages/unread-total"),
        ] {
            assert!(tariff_path(&method, path), "{method} {path}");
        }
        for (method, path) in [
            (Method::GET, "/me/concierge-services"),
            (Method::POST, "/me/concierge-services/a/cancel"),
            (Method::GET, "/me/appointments"),
            (Method::GET, "/me/appointment-requests"),
            (Method::POST, "/me/appointment-requests"),
            (Method::GET, "/me/followup-milestones"),
            (Method::GET, "/me/subscriptions"),
            (Method::GET, "/me/recommendations"),
            (Method::GET, "/me/next-actions"),
            (Method::GET, "/notifications"),
            (Method::POST, "/notifications/a/read"),
            (Method::GET, "/messagesX"),
        ] {
            assert!(!tariff_path(&method, path), "{method} {path}");
        }
    }

    #[test]
    fn a_pause_closes_new_appointment_requests_only() {
        assert!(pause_closed_path(&Method::POST, "/me/appointment-requests"));
        assert!(pause_closed_path(
            &Method::POST,
            "/api/v1/me/appointment-requests/a/withdraw"
        ));
        assert!(!pause_closed_path(&Method::GET, "/me/appointment-requests"));
        assert!(!pause_closed_path(&Method::GET, "/me/appointments"));
        assert!(!pause_closed_path(
            &Method::POST,
            "/me/appointment-requestsX"
        ));
    }
}
