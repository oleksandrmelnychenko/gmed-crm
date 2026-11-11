//! Patient status enables sign-in; an active package in the patient's order
//! enables the service modules. Basic records and account rights stay open.
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

pub(crate) async fn require_subscription(
    state: &AppState,
    auth: &AuthUser,
) -> Result<(), Response> {
    require_subscription_state(state, auth, false).await
}

/// As [`require_subscription`], but a paused subscription is enough: for the
/// read routes of what is already agreed and for the chat.
pub(crate) async fn require_subscription_or_pause(
    state: &AppState,
    auth: &AuthUser,
) -> Result<(), Response> {
    require_subscription_state(state, auth, true).await
}

async fn require_subscription_state(
    state: &AppState,
    auth: &AuthUser,
    paused_is_enough: bool,
) -> Result<(), Response> {
    if auth.role != Role::Patient {
        return Ok(());
    }
    let patient_id = match super::me::resolve_self_patient_id(state, auth).await {
        Ok(id) => id,
        Err(response) if response.status() == StatusCode::NOT_FOUND => {
            return Err(subscription_required());
        }
        Err(response) => return Err(response),
    };
    if has_active_subscription(state, patient_id).await?
        || (paused_is_enough
            && subscription_matches(state, patient_id, PAUSED_SUBSCRIPTION_SQL).await?)
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

/// What a patient with a paused subscription still reaches besides the basic
/// paths: the visits already booked and the own requests (read only), the
/// own concierge service requests (read, and cancelling an open one: owner
/// decision 2026-11-12), the subscriptions page, the chat with the team and
/// the notifications. Creating a request or a service, withdrawing an
/// appointment request and recommendations stay closed.
fn paused_path(method: &Method, path: &str) -> bool {
    let path = path.strip_prefix("/api/v1").unwrap_or(path);
    let read = method == Method::GET || method == Method::HEAD;
    (read
        && [
            "/me/appointments",
            "/me/appointment-requests",
            "/me/concierge-services",
            "/me/followup-milestones",
            "/me/subscriptions",
        ]
        .contains(&path))
        || (method == Method::POST && concierge_service_cancel_path(path))
        || within(path, "/messages")
        || within(path, "/notifications")
}

/// `/me/concierge-services/{service_id}/cancel`, with exactly one id segment.
fn concierge_service_cancel_path(path: &str) -> bool {
    path.strip_prefix("/me/concierge-services/")
        .and_then(|tail| tail.strip_suffix("/cancel"))
        .is_some_and(|id| !id.is_empty() && !id.contains('/'))
}

pub async fn middleware(State(state): State<AppState>, req: Request, next: Next) -> Response {
    if let Some(auth) = req.extensions().get::<AuthUser>()
        && auth.role == Role::Patient
        && !basic_path(req.uri().path())
    {
        let checked = if paused_path(req.method(), req.uri().path()) {
            require_subscription_or_pause(&state, auth).await
        } else {
            require_subscription(&state, auth).await
        };
        if let Err(response) = checked {
            return response;
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
    fn a_pause_keeps_agreed_visits_and_the_chat_but_no_new_requests() {
        for path in [
            "/me/appointments",
            "/api/v1/me/appointment-requests",
            "/me/followup-milestones",
            "/me/subscriptions",
            "/messages/conversations",
            "/notifications/unread-count",
        ] {
            assert!(paused_path(&Method::GET, path), "{path}");
        }
        // Writing to the chat and marking a notice read stay possible.
        assert!(paused_path(&Method::POST, "/messages/a/upload"));
        assert!(paused_path(&Method::POST, "/notifications/a/read"));
        // The own concierge requests stay readable and an open one can be
        // cancelled (owner decision 2026-11-12); a new one stays refused.
        assert!(paused_path(&Method::GET, "/me/concierge-services"));
        assert!(paused_path(
            &Method::POST,
            "/api/v1/me/concierge-services/a/cancel"
        ));
        for (method, path) in [
            (Method::POST, "/me/appointment-requests"),
            (Method::POST, "/me/appointment-requests/a/withdraw"),
            (Method::GET, "/me/recommendations"),
            (Method::POST, "/me/concierge-services"),
            (Method::POST, "/me/concierge-services//cancel"),
            (Method::POST, "/me/concierge-services/a/b/cancel"),
            (Method::GET, "/me/concierge-services/a/cancel"),
            (Method::GET, "/me/next-actions"),
            (Method::GET, "/messagesX"),
        ] {
            assert!(!paused_path(&method, path), "{method} {path}");
        }
    }
}
