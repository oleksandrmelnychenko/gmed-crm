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
use gmed_domain::access::capabilities::Capability;
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

    /// Whether the signed-in role holds `capability` (see
    /// `gmed_domain::access::capabilities`). The CEO holds every capability.
    pub fn can(&self, capability: Capability) -> bool {
        self.role.can(capability)
    }

    /// Whether the signed-in role holds at least one of `capabilities`.
    pub fn can_any(&self, capabilities: &[Capability]) -> bool {
        self.role.can_any(capabilities)
    }

    /// 403 unless the role holds `capability`.
    #[allow(clippy::result_large_err)]
    pub fn require_capability(&self, capability: Capability) -> Result<(), Response> {
        if self.can(capability) {
            Ok(())
        } else {
            Err(forbidden())
        }
    }

    /// 403 unless the role holds at least one of `capabilities`.
    #[allow(clippy::result_large_err)]
    pub fn require_any_capability(&self, capabilities: &[Capability]) -> Result<(), Response> {
        if self.can_any(capabilities) {
            Ok(())
        } else {
            Err(forbidden())
        }
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

/// Authenticates the request and leaves an [`AuthUser`] in the extensions.
///
/// Authorization is decided per route through [`AuthUser::require_capability`]
/// and the row-level policies; there is no role-wide "empty workspace" gate
/// any more, every staff role reaches exactly the endpoints its capabilities
/// allow.
pub async fn require_auth(State(state): State<AppState>, mut req: Request, next: Next) -> Response {
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

/// Shared transport decision used by the public WebSocket routes, which
/// authenticate after the upgrade and must call this after authentication and
/// after periodic revalidation. The event stream is open to every signed-in
/// account (events are filtered per class below); the chat socket needs the
/// chat workspace.
pub(crate) fn release_workspace_allows_path(role: Role, path: &str) -> bool {
    let path = path.strip_prefix("/api/v1").unwrap_or(path);
    match path {
        "/messages/ws" => role == Role::Patient || role.can(Capability::ChatUse),
        _ => true,
    }
}

/// Coarse realtime filter: an event class is delivered only to roles holding
/// a capability for its module, so a technical admin never receives task,
/// patient, finance or chat events even when it is targeted directly. Event
/// classes without a mapping fall through to the per-event authorization.
pub(crate) fn release_workspace_allows_realtime_event(role: Role, event_type: &str) -> bool {
    if role == Role::Patient {
        return true;
    }
    match realtime_event_capabilities(event_type) {
        Some(required) => role.can_any(required),
        None => true,
    }
}

fn realtime_event_capabilities(event_type: &str) -> Option<&'static [Capability]> {
    use Capability as C;
    let module = event_type.split('.').next().unwrap_or_default();
    let required: &'static [Capability] = match module {
        "concierge_operational_item" | "task" | "crm_project" | "concierge_expense" => {
            &[C::TasksUse]
        }
        "patient"
        | "recommendation"
        | "reminder"
        | "workflow_checklist_item"
        | "case"
        | "consent"
        | "appointment_checklist"
        | "scan"
        | "report" => &[C::PatientsView],
        "lead" => &[C::LeadsView],
        "order" | "order_intake_documents" | "order_intake_catalog" => &[C::OrdersView],
        "invoice"
        | "provider_invoice"
        | "provider_payment"
        | "accounting_entry"
        | "company_financial_account"
        | "framework_contract" => &[C::InvoicesView, C::AccountingView, C::CompanyFinanceView],
        "quote" => &[C::ContractsView],
        "document" | "translation_request" => &[C::DocumentsView],
        "appointment" | "appointment_request" => &[C::AppointmentsView],
        "provider" => &[C::ProvidersView],
        "concierge_service" | "service_package" => &[C::ServicesView],
        "feedback" => &[C::FeedbackView],
        "messages" => &[C::ChatUse],
        "privacy_request" => &[C::AdminCompliance, C::PatientsView],
        "user" => &[C::UsersView],
        "security"
        | "access_policy"
        | "system_setting"
        | "notification_channel"
        | "custom_field" => &[C::AdminSettings, C::AdminSecurity],
        _ => return None,
    };
    Some(required)
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
    fn capability_checks_follow_the_registry() {
        let u = user(Role::ItAdmin);
        assert!(u.can(Capability::UsersManage));
        assert!(!u.can(Capability::UsersManageCeo));
        assert!(!u.can(Capability::PatientsView));
        assert!(u.require_capability(Capability::AdminSecurity).is_ok());
        assert!(u.require_capability(Capability::ChatUse).is_err());
        assert!(
            u.require_any_capability(&[Capability::PatientsView, Capability::AdminSettings])
                .is_ok()
        );
        assert!(
            u.require_any_capability(&[Capability::PatientsView, Capability::ChatUse])
                .is_err()
        );

        let ceo = user(Role::Ceo);
        assert!(ceo.can(Capability::UsersManageCeo));
        assert!(ceo.require_capability(Capability::IncidentsManage).is_ok());

        let assistant = user(Role::CeoAssistant);
        assert!(assistant.can(Capability::PatientsView));
        assert!(!assistant.can(Capability::PatientsEdit));
        assert!(
            assistant
                .require_capability(Capability::InvoicesCreate)
                .is_err()
        );
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
    fn websocket_transport_policy_follows_capabilities() {
        for role in [
            Role::Ceo,
            Role::CeoAssistant,
            Role::Concierge,
            Role::Billing,
            Role::PatientManager,
            Role::TeamleadInterpreter,
            Role::Interpreter,
            Role::Sales,
            Role::Patient,
        ] {
            assert!(
                release_workspace_allows_path(role, "/messages/ws"),
                "{role:?}"
            );
            assert!(release_workspace_allows_path(role, "/api/v1/messages/ws"));
            assert!(release_workspace_allows_path(role, "/events/ws"));
        }
        assert!(!release_workspace_allows_path(
            Role::ItAdmin,
            "/messages/ws"
        ));
        assert!(release_workspace_allows_path(Role::ItAdmin, "/events/ws"));
    }

    #[test]
    fn realtime_event_classes_follow_capabilities() {
        for role in [
            Role::Ceo,
            Role::Concierge,
            Role::Billing,
            Role::PatientManager,
            Role::TeamleadInterpreter,
            Role::Interpreter,
            Role::CeoAssistant,
            Role::Patient,
        ] {
            assert!(
                release_workspace_allows_realtime_event(role, "patient.updated"),
                "{role:?}"
            );
            assert!(release_workspace_allows_realtime_event(
                role,
                "notification.created"
            ));
            assert!(release_workspace_allows_realtime_event(
                role,
                "concierge_operational_item.updated"
            ));
        }

        assert!(!release_workspace_allows_realtime_event(
            Role::Sales,
            "patient.updated"
        ));
        assert!(release_workspace_allows_realtime_event(
            Role::Sales,
            "lead.created"
        ));
        assert!(release_workspace_allows_realtime_event(
            Role::Sales,
            "notification.created"
        ));
        assert!(release_workspace_allows_realtime_event(
            Role::Sales,
            "concierge_operational_item.updated"
        ));
        assert!(!release_workspace_allows_realtime_event(
            Role::Sales,
            "invoice.created"
        ));

        assert!(!release_workspace_allows_realtime_event(
            Role::Interpreter,
            "invoice.created"
        ));
        assert!(!release_workspace_allows_realtime_event(
            Role::Interpreter,
            "user.created"
        ));

        for event in [
            "patient.updated",
            "concierge_operational_item.updated",
            "task.created",
            "invoice.created",
            "lead.created",
            "document.updated",
            "appointment.created",
            "messages.new",
        ] {
            assert!(
                !release_workspace_allows_realtime_event(Role::ItAdmin, event),
                "{event}"
            );
        }
        assert!(release_workspace_allows_realtime_event(
            Role::ItAdmin,
            "user.created"
        ));
        assert!(release_workspace_allows_realtime_event(
            Role::ItAdmin,
            "system_setting.updated"
        ));
        assert!(release_workspace_allows_realtime_event(
            Role::ItAdmin,
            "notification.created"
        ));
        assert!(release_workspace_allows_realtime_event(
            Role::ItAdmin,
            "announcement.created"
        ));
    }
}
