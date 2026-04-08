use axum::{
    Json,
    extract::{Request, State},
    http::StatusCode,
    middleware::Next,
    response::{IntoResponse, Response},
};
use serde_json::json;
use uuid::Uuid;

use super::jwt;
use crate::state::AppState;
use gmed_domain::role::Role;

#[derive(Debug, Clone)]
pub struct AuthUser {
    pub user_id: Uuid,
    pub role: Role,
    pub family_id: Uuid,
}

impl AuthUser {
    /// CEO always passes — by design (CEO = full access).
    #[allow(clippy::result_large_err)]
    pub fn require_any_role(&self, allowed: &[Role]) -> Result<(), Response> {
        if self.role == Role::Ceo {
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

    /// Strict check — CEO does NOT auto-pass.
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

pub async fn require_auth(State(state): State<AppState>, mut req: Request, next: Next) -> Response {
    let Some(token) = extract_bearer_token(&req) else {
        return unauthorized();
    };

    let Ok(data) = jwt::verify_access_token(state.jwt_secret(), token) else {
        return unauthorized();
    };

    let Some(role) = parse_role(&data.claims.role) else {
        tracing::warn!(role = %data.claims.role, user_id = %data.claims.sub, "Unknown role in JWT");
        return unauthorized();
    };

    req.extensions_mut().insert(AuthUser {
        user_id: data.claims.sub,
        role,
        family_id: data.claims.fam,
    });

    next.run(req).await
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
        }
    }

    #[test]
    fn ceo_passes_any_role_check() {
        let u = user(Role::Ceo);
        assert!(u.require_any_role(&[Role::Sales]).is_ok());
        assert!(u.require_any_role(&[Role::PatientManager]).is_ok());
        assert!(u.require_any_role(&[Role::Billing]).is_ok());
        assert!(u.require_any_role(&[]).is_ok());
    }

    #[test]
    fn ceo_does_not_auto_pass_exact_role() {
        let u = user(Role::Ceo);
        assert!(u.require_exact_role(&[Role::Sales]).is_err());
        assert!(u.require_exact_role(&[Role::Ceo]).is_ok());
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
}
