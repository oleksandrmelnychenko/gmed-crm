//! Patient status enables sign-in; an active package in the patient's order
//! enables the service modules. Basic records and account rights stay open.
use axum::{
    Json,
    extract::{Request, State},
    http::StatusCode,
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

pub(crate) async fn has_active_subscription(
    state: &AppState,
    patient_id: Uuid,
) -> Result<bool, Response> {
    sqlx::query_scalar::<_, bool>(&format!(
        "SELECT {ACTIVE_SUBSCRIPTION_SQL} FROM patients p WHERE p.id = $1"
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
    if has_active_subscription(state, patient_id).await? {
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

pub async fn middleware(State(state): State<AppState>, req: Request, next: Next) -> Response {
    if let Some(auth) = req.extensions().get::<AuthUser>()
        && auth.role == Role::Patient
        && !basic_path(req.uri().path())
        && let Err(response) = require_subscription(&state, auth).await
    {
        return response;
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
}
