use axum::{
    Extension, Json, Router,
    extract::{DefaultBodyLimit, State},
    http::StatusCode,
    response::Response,
    routing::get,
};
use gmed_domain::role::Role;
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::{Row, postgres::PgRow};
use uuid::Uuid;

use super::{
    db_error, error,
    provider::{Signer, normalize_signers},
};
use crate::{audit, auth::middleware::AuthUser, routes::patients, state::AppState};

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/document-signatures/signer-defaults",
            get(get_defaults).put(save_defaults),
        )
        .layer(DefaultBodyLimit::max(16 * 1024))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Defaults {
    signers: Vec<Signer>,
}

fn normalize_defaults(signers: Vec<Signer>) -> Result<Vec<Signer>, &'static str> {
    if signers.len() > 5 || signers.iter().any(|s| s.role != "agency") {
        return Err("agency_signers_required");
    }
    if signers.is_empty() {
        return Ok(signers);
    }
    normalize_signers(signers)
}

async fn load(state: &AppState) -> Result<Vec<Signer>, Response> {
    let value: Option<Value> =
        sqlx::query_scalar("SELECT signers FROM signature_signer_defaults WHERE singleton=true")
            .fetch_optional(&state.db)
            .await
            .map_err(db_error)?;
    serde_json::from_value(value.unwrap_or_else(|| json!([]))).map_err(|_| {
        error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "signature_defaults_invalid",
        )
    })
}

async fn get_defaults(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
) -> Result<Json<Value>, Response> {
    auth.require_exact_role(&[Role::Ceo, Role::ItAdmin])?;
    Ok(Json(json!({"signers":load(&state).await?})))
}

async fn save_defaults(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Json(body): Json<Defaults>,
) -> Result<Json<Value>, Response> {
    auth.require_exact_role(&[Role::Ceo, Role::ItAdmin])?;
    let signers = normalize_defaults(body.signers)
        .map_err(|code| error(StatusCode::UNPROCESSABLE_ENTITY, code))?;
    sqlx::query("INSERT INTO signature_signer_defaults(singleton,signers,updated_by) VALUES(true,$1,$2) ON CONFLICT(singleton) DO UPDATE SET signers=EXCLUDED.signers,updated_by=EXCLUDED.updated_by,updated_at=now()")
        .bind(json!(signers)).bind(auth.user_id).execute(&state.db).await.map_err(db_error)?;
    state.audit_sender.try_send(audit::domain_event(
        "signature_signer_defaults_saved",
        Some(auth.user_id),
        "signature_settings",
        None,
        json!({"representatives":signers.len()}),
    ));
    Ok(Json(json!({"signers":signers})))
}

fn empty(role: &str) -> Signer {
    Signer {
        first_name: String::new(),
        last_name: String::new(),
        email: String::new(),
        role: role.into(),
    }
}

// Called only after checking this document's send permissions. Document access
// alone does not grant access to the linked patient's contact details.
pub(super) async fn suggested(
    state: &AppState,
    auth: &AuthUser,
    source: &PgRow,
) -> Result<Vec<Signer>, Response> {
    let mut client = empty("client");
    let patient_id: Option<Uuid> = source.get("patient_id");
    let lead_id: Option<Uuid> = source.get("lead_id");
    let row = match (patient_id, lead_id) {
        // These roles can read unmasked profile fields. IT administrators can
        // configure signatures, but profile field policies may hide contacts.
        (Some(id), None)
            if matches!(auth.role, Role::Ceo | Role::PatientManager)
                && patients::has_patient_access(state, auth, id).await? => {
            sqlx::query("SELECT first_name,last_name,email FROM patients WHERE id=$1 AND is_active=true")
                .bind(id).fetch_optional(&state.db).await.map_err(db_error)?
        }
        (None, Some(id)) if auth.require_any_role(&[Role::PatientManager, Role::Sales, Role::Concierge]).is_ok() => {
            sqlx::query("SELECT first_name,last_name,email FROM leads WHERE id=$1 AND qualification_status<>'archived'")
                .bind(id).fetch_optional(&state.db).await.map_err(db_error)?
        }
        _ => None,
    };
    if let Some(row) = row {
        client.first_name = row.get("first_name");
        client.last_name = row.get("last_name");
        client.email = row.get::<Option<String>, _>("email").unwrap_or_default();
    }
    let mut signers = vec![client];
    let agency = load(state).await?;
    if agency.is_empty() {
        signers.push(empty("agency"));
    } else {
        signers.extend(agency);
    }
    Ok(signers)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn defaults_allow_clearing_but_never_a_global_client_or_duplicate_recipient() {
        assert!(normalize_defaults(vec![]).unwrap().is_empty());
        let agency = Signer {
            first_name: " Max ".into(),
            last_name: " Muster ".into(),
            email: " MAX@EXAMPLE.ORG ".into(),
            role: "agency".into(),
        };
        assert_eq!(
            normalize_defaults(vec![agency.clone()]).unwrap()[0].email,
            "max@example.org"
        );
        assert!(normalize_defaults(vec![agency.clone(), agency.clone()]).is_err());
        assert!(normalize_defaults(vec![agency.clone(); 6]).is_err());
        assert!(
            normalize_defaults(vec![Signer {
                role: "client".into(),
                ..agency
            }])
            .is_err()
        );
    }
}
