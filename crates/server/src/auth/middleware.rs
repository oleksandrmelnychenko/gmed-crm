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

    let (auth_user, password_change_required) =
        match auth_user_status_from_access_token(&state, token).await {
            Ok(value) => value,
            Err(response) => return response,
        };

    // Forced password change (Stage 1 of the role cabinets plan): the session
    // is valid but confined to the self-service password endpoints until the
    // password is replaced. Checked before the workspace policy so the answer
    // is the same for every role. Kept separate from the capability model.
    if password_change_required && !is_password_change_allowed_path(req.uri().path()) {
        return password_change_required_response();
    }

    if enforce_release_workspace_roles
        && !release_workspace_allows_path(auth_user.role, req.uri().path())
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
    let (auth, password_change_required) = auth_user_status_from_access_token(state, token).await?;
    if password_change_required {
        return Err(unauthorized());
    }
    Ok(auth)
}

/// Like [`auth_user_from_access_token`], but a pending forced password change
/// is reported as a flag instead of rejecting the token. Only the HTTP
/// middleware uses this; WebSocket transports keep rejecting such sessions.
#[allow(clippy::result_large_err)]
async fn auth_user_status_from_access_token(
    state: &AppState,
    token: &str,
) -> Result<(AuthUser, bool), Response> {
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

    revalidate_auth_user_status(
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

/// Whether the account must replace its password before using the workspace:
/// an administrator forced a reset, or the password is older than the expiry
/// configured in the system settings (0 disables expiry).
pub fn password_change_required(
    password_reset_required: bool,
    password_changed_at: Option<DateTime<Utc>>,
    password_expire_days: i64,
) -> bool {
    let password_expired = password_expire_days > 0
        && password_changed_at.is_some_and(|changed_at| {
            changed_at + chrono::Duration::days(password_expire_days) <= Utc::now()
        });
    password_reset_required || password_expired
}

/// Endpoints a session may still call while a password change is pending:
/// identity, the change itself, and leaving.
pub(crate) fn is_password_change_allowed_path(path: &str) -> bool {
    let path = path.strip_prefix("/api/v1").unwrap_or(path);
    matches!(
        path,
        "/me" | "/me/password" | "/auth/logout" | "/auth/logout-all" | "/auth/sessions"
    ) || path.starts_with("/auth/sessions/")
}

fn password_change_required_response() -> Response {
    (
        StatusCode::FORBIDDEN,
        Json(json!({
            "error": "password_change_required",
            "message": "Password must be changed before continuing"
        })),
    )
        .into_response()
}

#[allow(clippy::result_large_err)]
pub async fn revalidate_auth_user(state: &AppState, auth: &AuthUser) -> Result<AuthUser, Response> {
    let (auth, password_change_required) = revalidate_auth_user_status(state, auth).await?;
    if password_change_required {
        return Err(unauthorized());
    }
    Ok(auth)
}

/// Revalidate the token against the database and report whether a password
/// change is pending instead of treating it as an invalid session.
#[allow(clippy::result_large_err)]
async fn revalidate_auth_user_status(
    state: &AppState,
    auth: &AuthUser,
) -> Result<(AuthUser, bool), Response> {
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
    if !row.try_get::<bool, _>("is_active").unwrap_or(false) {
        return Err(unauthorized());
    }
    let settings = state.settings.get().await;
    let password_changed_at: Option<DateTime<Utc>> =
        row.try_get("password_changed_at").unwrap_or_default();
    let change_required = password_change_required(
        row.try_get::<bool, _>("password_reset_required")
            .unwrap_or(true),
        password_changed_at,
        settings.password_expire_days,
    );
    let role_name: String = row.try_get("role").unwrap_or_default();
    let Some(role) = parse_role(&role_name) else {
        return Err(unauthorized());
    };
    if role != auth.role {
        return Err(unauthorized());
    }

    Ok((auth.clone(), change_required))
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

/// Shared production workspace decision used by HTTP and WebSocket transports.
/// Public WebSocket routes authenticate after upgrade, so their handlers must
/// call this after authentication and after periodic revalidation.
pub(crate) fn release_workspace_allows_path(role: Role, path: &str) -> bool {
    !is_empty_workspace_role(role) || is_empty_workspace_allowed_path(role, path)
}

/// Empty-workspace task roles retain only the realtime event classes matching
/// their narrow operational HTTP surface. Direct user/role targeting must not
/// grant them unrelated patient, finance, chat, or administrative events.
pub(crate) fn release_workspace_allows_realtime_event(role: Role, event_type: &str) -> bool {
    if !is_empty_workspace_role(role) {
        return true;
    }
    is_task_manager_workspace_role(role)
        && (event_type.starts_with("notification.")
            || event_type.starts_with("concierge_operational_item."))
}

fn is_empty_workspace_allowed_path(role: Role, path: &str) -> bool {
    let path = path.strip_prefix("/api/v1").unwrap_or(path);
    // Account self-service (/account page) is available to every role.
    let session_path = matches!(
        path,
        "/me"
            | "/me/password"
            | "/me/profile"
            | "/auth/logout"
            | "/auth/logout-all"
            | "/auth/sessions"
            | "/stats/my-kpis"
    ) || path.starts_with("/auth/sessions/")
        || path == "/me/totp"
        || path.starts_with("/me/totp/");
    if session_path {
        return true;
    }
    if !is_task_manager_workspace_role(role) {
        return false;
    }
    path == "/events/ws"
        || path == "/concierge-operational-items"
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
        assert!(!is_empty_workspace_role(Role::PatientManager));
        assert!(!is_empty_workspace_role(Role::Interpreter));
        assert!(!is_empty_workspace_role(Role::TeamleadInterpreter));
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

    #[test]
    fn forced_password_change_only_reaches_identity_password_and_logout() {
        for path in [
            "/me",
            "/api/v1/me",
            "/api/v1/me/password",
            "/auth/logout",
            "/api/v1/auth/logout-all",
            "/api/v1/auth/sessions",
            "/api/v1/auth/sessions/family-id/revoke",
        ] {
            assert!(is_password_change_allowed_path(path), "{path}");
        }
        for path in [
            "/",
            "/api/v1/me/profile",
            "/api/v1/me/totp",
            "/api/v1/patients",
            "/api/v1/stats/my-kpis",
            "/api/v1/messages/ws",
        ] {
            assert!(!is_password_change_allowed_path(path), "{path}");
        }
    }

    #[test]
    fn password_change_required_combines_forced_reset_and_expiry() {
        let fresh = Some(Utc::now() - chrono::Duration::days(10));
        let stale = Some(Utc::now() - chrono::Duration::days(91));
        assert!(password_change_required(true, fresh, 90));
        assert!(!password_change_required(false, fresh, 90));
        assert!(password_change_required(false, stale, 90));
        assert!(!password_change_required(false, stale, 0));
        assert!(!password_change_required(false, None, 90));
    }

    #[test]
    fn account_self_service_paths_stay_open_for_empty_workspace_roles() {
        for path in [
            "/api/v1/me/password",
            "/api/v1/me/profile",
            "/api/v1/me/totp",
            "/api/v1/me/totp/setup",
        ] {
            assert!(
                is_empty_workspace_allowed_path(Role::ItAdmin, path),
                "{path}"
            );
        }
        assert!(!is_empty_workspace_allowed_path(
            Role::ItAdmin,
            "/api/v1/me/documents"
        ));
    }

    #[test]
    fn release_workspace_transport_policy_matches_http_boundaries() {
        for role in [
            Role::Ceo,
            Role::Concierge,
            Role::Billing,
            Role::PatientManager,
            Role::TeamleadInterpreter,
            Role::Interpreter,
            Role::Patient,
        ] {
            assert!(release_workspace_allows_path(role, "/messages/ws"));
            assert!(release_workspace_allows_path(role, "/events/ws"));
            assert!(release_workspace_allows_realtime_event(
                role,
                "patient.updated"
            ));
        }

        for role in [Role::CeoAssistant, Role::Sales] {
            assert!(!release_workspace_allows_path(role, "/messages/ws"));
            assert!(release_workspace_allows_path(role, "/events/ws"));
            assert!(!release_workspace_allows_realtime_event(
                role,
                "patient.updated"
            ));
            assert!(release_workspace_allows_realtime_event(
                role,
                "notification.created"
            ));
            assert!(release_workspace_allows_realtime_event(
                role,
                "concierge_operational_item.updated"
            ));
        }

        assert!(!release_workspace_allows_path(
            Role::ItAdmin,
            "/messages/ws"
        ));
        assert!(!release_workspace_allows_path(Role::ItAdmin, "/events/ws"));
        assert!(!release_workspace_allows_realtime_event(
            Role::ItAdmin,
            "admin_security.updated"
        ));
    }
}
