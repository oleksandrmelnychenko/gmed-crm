use axum::{
    Json,
    extract::{
        Request, State,
        ws::{Message as WsMessage, WebSocket},
    },
    http::StatusCode,
    middleware::Next,
    response::{IntoResponse, Response},
};
use chrono::{DateTime, Utc};
use serde::Deserialize;
use serde_json::json;
use uuid::Uuid;

use super::{blacklist, jwt};
use crate::state::AppState;
use gmed_domain::role::Role;

#[derive(Debug, Clone)]
pub struct AuthUser {
    pub user_id: Uuid,
    pub role: Role,
    pub family_id: Uuid,
    pub access_token_jti: Uuid,
    pub access_token_expires_at: DateTime<Utc>,
}

impl AuthUser {
    /// The CEO always passes by design.
    #[allow(clippy::result_large_err)]
    pub fn require_any_role(&self, allowed: &[Role]) -> Result<(), Response> {
        if self.role.has_full_access() {
            return Ok(());
        }
        let mut found = false;
        for role in allowed {
            if *role == self.role {
                found = true;
                break;
            }
        }
        if found { Ok(()) } else { Err(forbidden()) }
    }

    /// Strict check — full-access roles do NOT auto-pass.
    #[allow(clippy::result_large_err)]
    pub fn require_exact_role(&self, allowed: &[Role]) -> Result<(), Response> {
        let mut found = false;
        for role in allowed {
            if *role == self.role {
                found = true;
                break;
            }
        }
        if found { Ok(()) } else { Err(forbidden()) }
    }
}

fn parse_role(role_str: &str) -> Option<Role> {
    match role_str {
        "ceo" => Some(Role::Ceo),
        "ceo_assistant" => Some(Role::CeoAssistant),
        "patient_manager" => Some(Role::PatientManager),
        "teamlead_interpreter" => Some(Role::TeamleadInterpreter),
        "interpreter" => Some(Role::Interpreter),
        "concierge" => Some(Role::Concierge),
        "billing" => Some(Role::Billing),
        "sales" => Some(Role::Sales),
        "it_admin" => Some(Role::ItAdmin),
        "patient" => Some(Role::Patient),
        _ => None,
    }
}

fn extract_bearer_token(req: &Request) -> Option<&str> {
    req.headers()
        .get("Authorization")?
        .to_str()
        .ok()?
        .strip_prefix("Bearer ")
}

pub async fn require_auth(State(state): State<AppState>, req: Request, next: Next) -> Response {
    require_auth_with_workspace_policy(state, req, next, true).await
}

/// Test-only router seam for exercising latent role-specific route contracts.
///
/// Production must always use [`require_auth`], which enforces the current
/// release workspace allowlist before dispatching business APIs.
#[doc(hidden)]
pub async fn require_auth_for_role_contract_tests(
    State(state): State<AppState>,
    req: Request,
    next: Next,
) -> Response {
    require_auth_with_workspace_policy(state, req, next, false).await
}

async fn require_auth_with_workspace_policy(
    state: AppState,
    mut req: Request,
    next: Next,
    enforce_release_workspace_roles: bool,
) -> Response {
    let Some(token) = extract_bearer_token(&req) else {
        return unauthorized();
    };

    let auth_user = match auth_user_from_access_token(&state, token).await {
        Ok(value) => value,
        Err(response) => return response,
    };

    if enforce_release_workspace_roles
        && is_empty_workspace_role(auth_user.role)
        && !is_empty_workspace_allowed_path(auth_user.role, req.uri().path())
    {
        tracing::warn!(
            role = %auth_user.role,
            user_id = %auth_user.user_id,
            path = %req.uri().path(),
            "Blocked business API access for an unconfigured staff role"
        );
        return forbidden();
    }

    req.extensions_mut().insert(auth_user);

    next.run(req).await
}

#[allow(clippy::result_large_err)]
pub async fn auth_user_from_access_token(
    state: &AppState,
    token: &str,
) -> Result<AuthUser, Response> {
    let Ok(data) = jwt::verify_access_token(state.jwt_secret(), token) else {
        return Err(unauthorized());
    };

    let Some(role) = parse_role(&data.claims.role) else {
        tracing::warn!(role = %data.claims.role, user_id = %data.claims.sub, "Unknown role in JWT");
        return Err(unauthorized());
    };

    let Some(access_token_expires_at) = DateTime::<Utc>::from_timestamp(data.claims.exp, 0) else {
        tracing::warn!(
            user_id = %data.claims.sub,
            jti = %data.claims.jti,
            exp = data.claims.exp,
            "Rejected token with unrepresentable exp claim"
        );
        return Err(unauthorized());
    };

    revalidate_auth_user(
        state,
        &AuthUser {
            user_id: data.claims.sub,
            role,
            family_id: data.claims.fam,
            access_token_jti: data.claims.jti,
            access_token_expires_at,
        },
    )
    .await
}

#[allow(clippy::result_large_err)]
pub async fn revalidate_auth_user(state: &AppState, auth: &AuthUser) -> Result<AuthUser, Response> {
    if auth.access_token_expires_at <= Utc::now() {
        return Err(unauthorized());
    }
    match blacklist::is_revoked(&state.db, auth.access_token_jti).await {
        Ok(false) => {}
        Ok(true) | Err(_) => return Err(unauthorized()),
    }
    match blacklist::is_family_revoked(&state.db, auth.family_id).await {
        Ok(false) => {}
        Ok(true) | Err(_) => return Err(unauthorized()),
    }

    let row = sqlx::query(
        "SELECT role, is_active, password_reset_required, password_changed_at
         FROM users WHERE id = $1",
    )
    .bind(auth.user_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|error| {
        tracing::error!(%error, user_id = %auth.user_id, "revalidate authenticated user");
        unauthorized()
    })?;
    let Some(row) = row else {
        return Err(unauthorized());
    };
    use sqlx::Row as _;
    if !row.try_get::<bool, _>("is_active").unwrap_or(false)
        || row
            .try_get::<bool, _>("password_reset_required")
            .unwrap_or(true)
    {
        return Err(unauthorized());
    }
    let settings = state.settings.get().await;
    let password_changed_at: Option<DateTime<Utc>> =
        row.try_get("password_changed_at").unwrap_or_default();
    if settings.password_expire_days > 0
        && password_changed_at.is_none_or(|changed_at| {
            changed_at + chrono::Duration::days(settings.password_expire_days) <= Utc::now()
        })
    {
        return Err(unauthorized());
    }
    let role_name: String = row.try_get("role").unwrap_or_default();
    let Some(role) = parse_role(&role_name) else {
        return Err(unauthorized());
    };
    if role != auth.role {
        return Err(unauthorized());
    }

    Ok(auth.clone())
}

#[derive(Deserialize)]
struct WebSocketAuthMessage {
    #[serde(rename = "type")]
    kind: String,
    token: String,
}

#[derive(Debug)]
pub(crate) struct WebSocketAuthError;

pub(crate) async fn authenticate_websocket(
    socket: &mut WebSocket,
    state: &AppState,
) -> Result<AuthUser, WebSocketAuthError> {
    let message = tokio::time::timeout(std::time::Duration::from_secs(5), socket.recv())
        .await
        .map_err(|_| WebSocketAuthError)?
        .ok_or(WebSocketAuthError)?
        .map_err(|_| WebSocketAuthError)?;
    let WsMessage::Text(text) = message else {
        return Err(WebSocketAuthError);
    };
    if text.len() > 8192 {
        return Err(WebSocketAuthError);
    }
    let payload: WebSocketAuthMessage =
        serde_json::from_str(&text).map_err(|_| WebSocketAuthError)?;
    let token = payload.token.trim();
    if payload.kind != "auth" || token.is_empty() || token.len() > 4096 {
        return Err(WebSocketAuthError);
    }
    auth_user_from_access_token(state, token)
        .await
        .map_err(|_| WebSocketAuthError)
}

fn is_empty_workspace_role(role: Role) -> bool {
    role != Role::Patient && !role.is_release_staff_role()
}

fn is_empty_workspace_allowed_path(role: Role, path: &str) -> bool {
    let path = path.strip_prefix("/api/v1").unwrap_or(path);
    let session_path = matches!(
        path,
        "/me" | "/auth/logout" | "/auth/logout-all" | "/auth/sessions" | "/stats/my-kpis"
    ) || path.starts_with("/auth/sessions/");
    if session_path {
        return true;
    }
    if !is_task_manager_workspace_role(role) {
        return false;
    }
    path == "/concierge-operational-items"
        || path.starts_with("/concierge-operational-items/")
        || path == "/concierge-operational-attachments"
        || path == "/notifications"
        || path.starts_with("/notifications/")
}

fn is_task_manager_workspace_role(role: Role) -> bool {
    matches!(
        role,
        Role::Ceo
            | Role::CeoAssistant
            | Role::Billing
            | Role::PatientManager
            | Role::Sales
            | Role::Concierge
            | Role::TeamleadInterpreter
            | Role::Interpreter
    )
}

fn unauthorized() -> Response {
    (
        StatusCode::UNAUTHORIZED,
        Json(json!({ "error": "unauthorized", "message": "Invalid or expired token" })),
    )
        .into_response()
}

fn forbidden() -> Response {
    (
        StatusCode::FORBIDDEN,
        Json(json!({ "error": "forbidden", "message": "Insufficient permissions" })),
    )
        .into_response()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn user(role: Role) -> AuthUser {
        AuthUser {
            user_id: Uuid::new_v4(),
            role,
            family_id: Uuid::new_v4(),
            access_token_jti: Uuid::new_v4(),
            access_token_expires_at: Utc::now(),
        }
    }

    #[test]
    fn only_ceo_auto_passes_any_role_check() {
        let u = user(Role::Ceo);
        assert!(u.require_any_role(&[Role::Sales]).is_ok());
        assert!(u.require_any_role(&[Role::PatientManager]).is_ok());
        assert!(u.require_any_role(&[Role::Billing]).is_ok());
        assert!(u.require_any_role(&[]).is_ok());

        let u = user(Role::ItAdmin);
        assert!(u.require_any_role(&[Role::Sales]).is_err());
        assert!(u.require_any_role(&[Role::PatientManager]).is_err());
        assert!(u.require_any_role(&[Role::Billing]).is_err());
        assert!(u.require_any_role(&[]).is_err());
    }

    #[test]
    fn full_access_roles_do_not_auto_pass_exact_role() {
        let u = user(Role::Ceo);
        assert!(u.require_exact_role(&[Role::Sales]).is_err());
        assert!(u.require_exact_role(&[Role::Ceo]).is_ok());

        let u = user(Role::ItAdmin);
        assert!(u.require_exact_role(&[Role::Sales]).is_err());
        assert!(u.require_exact_role(&[Role::ItAdmin]).is_ok());
    }

    #[test]
    fn sales_can_access_leads() {
        let u = user(Role::Sales);
        assert!(
            u.require_any_role(&[Role::PatientManager, Role::Sales])
                .is_ok()
        );
    }

    #[test]
    fn patient_manager_can_access_leads() {
        let u = user(Role::PatientManager);
        assert!(
            u.require_any_role(&[Role::PatientManager, Role::Sales])
                .is_ok()
        );
    }

    #[test]
    fn interpreter_cannot_access_leads() {
        let u = user(Role::Interpreter);
        assert!(
            u.require_any_role(&[Role::PatientManager, Role::Sales])
                .is_err()
        );
    }

    #[test]
    fn billing_cannot_access_leads() {
        let u = user(Role::Billing);
        assert!(
            u.require_any_role(&[Role::PatientManager, Role::Sales])
                .is_err()
        );
    }

    #[test]
    fn concierge_cannot_access_leads() {
        let u = user(Role::Concierge);
        assert!(
            u.require_any_role(&[Role::PatientManager, Role::Sales])
                .is_err()
        );
    }

    #[test]
    fn patient_cannot_access_leads() {
        let u = user(Role::Patient);
        assert!(
            u.require_any_role(&[Role::PatientManager, Role::Sales])
                .is_err()
        );
    }

    #[test]
    fn only_patient_manager_can_convert_leads() {
        assert!(
            user(Role::PatientManager)
                .require_any_role(&[Role::PatientManager])
                .is_ok()
        );
        assert!(
            user(Role::Sales)
                .require_any_role(&[Role::PatientManager])
                .is_err()
        );
        assert!(
            user(Role::Interpreter)
                .require_any_role(&[Role::PatientManager])
                .is_err()
        );
        // CEO auto-passes
        assert!(
            user(Role::Ceo)
                .require_any_role(&[Role::PatientManager])
                .is_ok()
        );
    }

    #[test]
    fn parse_role_covers_all_variants() {
        assert_eq!(parse_role("ceo"), Some(Role::Ceo));
        assert_eq!(parse_role("ceo_assistant"), Some(Role::CeoAssistant));
        assert_eq!(parse_role("patient_manager"), Some(Role::PatientManager));
        assert_eq!(
            parse_role("teamlead_interpreter"),
            Some(Role::TeamleadInterpreter)
        );
        assert_eq!(parse_role("interpreter"), Some(Role::Interpreter));
        assert_eq!(parse_role("concierge"), Some(Role::Concierge));
        assert_eq!(parse_role("billing"), Some(Role::Billing));
        assert_eq!(parse_role("sales"), Some(Role::Sales));
        assert_eq!(parse_role("it_admin"), Some(Role::ItAdmin));
        assert_eq!(parse_role("patient"), Some(Role::Patient));
        assert_eq!(parse_role("unknown"), None);
        assert_eq!(parse_role(""), None);
    }

    #[test]
    fn legacy_staff_sessions_only_reach_identity_and_session_endpoints() {
        assert!(is_empty_workspace_role(Role::ItAdmin));
        assert!(is_empty_workspace_role(Role::PatientManager));
        assert!(!is_empty_workspace_role(Role::Ceo));
        assert!(!is_empty_workspace_role(Role::Concierge));
        assert!(!is_empty_workspace_role(Role::Billing));
        assert!(!is_empty_workspace_role(Role::Patient));

        for path in [
            "/me",
            "/api/v1/me",
            "/auth/logout",
            "/api/v1/auth/logout-all",
            "/auth/sessions",
            "/api/v1/auth/sessions/family-id/revoke",
            "/api/v1/stats/my-kpis",
        ] {
            assert!(
                is_empty_workspace_allowed_path(Role::ItAdmin, path),
                "{path}"
            );
        }
        for path in ["/", "/patients", "/api/v1/leads", "/messages/unread-total"] {
            assert!(
                !is_empty_workspace_allowed_path(Role::ItAdmin, path),
                "{path}"
            );
        }

        for path in [
            "/api/v1/concierge-operational-items",
            "/api/v1/concierge-operational-items/assignees",
            "/api/v1/concierge-operational-items/task-id",
            "/api/v1/concierge-operational-attachments",
            "/api/v1/notifications",
            "/api/v1/notifications/unread-count",
        ] {
            assert!(
                is_empty_workspace_allowed_path(Role::PatientManager, path),
                "{path}"
            );
            assert!(
                !is_empty_workspace_allowed_path(Role::ItAdmin, path),
                "{path}"
            );
        }
        assert!(!is_empty_workspace_allowed_path(
            Role::PatientManager,
            "/api/v1/patients"
        ));
    }
}
