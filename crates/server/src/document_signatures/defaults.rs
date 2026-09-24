use axum::{
    Extension, Json, Router,
    extract::{DefaultBodyLimit, State},
    http::StatusCode,
    response::Response,
    routing::get,
};
use chrono::{Datelike, NaiveDate};
use gmed_domain::access::capabilities::Capability;
use gmed_domain::role::Role;
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::{Row, postgres::PgRow};
use uuid::Uuid;

use super::{
    SignerPolicy, db_error, error,
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
    auth.require_capability(Capability::AdminSignatures)?;
    Ok(Json(json!({"signers":load(&state).await?})))
}

async fn save_defaults(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Json(body): Json<Defaults>,
) -> Result<Json<Value>, Response> {
    auth.require_capability(Capability::AdminSignatures)?;
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
        positions: Vec::new(),
    }
}

fn is_minor(date_of_birth: Option<NaiveDate>) -> bool {
    let Some(date_of_birth) = date_of_birth else {
        return false;
    };
    let today = chrono::Utc::now().date_naive();
    let mut age = today.year() - date_of_birth.year();
    if (today.month(), today.day()) < (date_of_birth.month(), date_of_birth.day()) {
        age -= 1;
    }
    age < 18
}

fn is_guardian_relation(value: Option<&str>) -> bool {
    let value = value.unwrap_or_default().trim().to_lowercase();
    [
        "parent",
        "mother",
        "father",
        "guardian",
        "mutter",
        "vater",
        "vormund",
        "мам",
        "пап",
        "родител",
        "опек",
        "бать",
    ]
    .iter()
    .any(|candidate| value.contains(candidate))
}

fn signer_name(name: &str) -> (String, String) {
    let mut parts = name.split_whitespace().collect::<Vec<_>>();
    if parts.len() <= 1 {
        return (
            parts.first().copied().unwrap_or_default().to_string(),
            String::new(),
        );
    }
    let last_name = parts.pop().unwrap_or_default().to_string();
    (parts.join(" "), last_name)
}

fn guardian_signer(contacts: &Value) -> Option<Signer> {
    contacts.as_array()?.iter().find_map(|contact| {
        if !is_guardian_relation(contact.get("relation").and_then(Value::as_str)) {
            return None;
        }
        let email = contact.get("email").and_then(Value::as_str)?.trim();
        let name = contact.get("name").and_then(Value::as_str)?.trim();
        if email.is_empty() || name.is_empty() {
            return None;
        }
        let (first_name, last_name) = signer_name(name);
        Some(Signer {
            first_name,
            last_name,
            email: email.to_lowercase(),
            role: "client".into(),
            positions: Vec::new(),
        })
    })
}

// Called only after checking this document's send permissions. Document access
// alone does not grant access to the linked patient's contact details.
pub(super) async fn suggested(
    state: &AppState,
    auth: &AuthUser,
    source: &PgRow,
    policy: SignerPolicy,
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
            sqlx::query(r#"SELECT p.first_name, p.last_name, p.email, p.birth_date,
                        COALESCE(
                          CASE WHEN jsonb_typeof(p.intake_profile->'trusted_contacts') = 'array'
                            THEN p.intake_profile->'trusted_contacts' ELSE '[]'::jsonb END,
                          '[]'::jsonb
                        ) || COALESCE((
                          SELECT jsonb_agg(jsonb_build_object(
                            'name', COALESCE(NULLIF(btrim(concat_ws(' ', rp.first_name, rp.last_name)), ''), pr.related_name),
                            'email', rp.email,
                            'relation', pr.relation_type
                          ))
                          FROM patient_relations pr
                          LEFT JOIN patients rp ON rp.id = pr.related_patient_id
                          WHERE pr.patient_id = p.id AND pr.relation_type IN ('parent', 'guardian')
                        ), '[]'::jsonb) AS guardian_contacts
                      FROM patients p WHERE p.id=$1 AND p.is_active=true"#)
                .bind(id).fetch_optional(&state.db).await.map_err(db_error)?
        }
        (None, Some(id)) if auth.require_any_role(&[Role::PatientManager, Role::Sales, Role::Concierge]).is_ok() => {
            sqlx::query("SELECT first_name,last_name,email,date_of_birth AS birth_date,COALESCE(trusted_contacts,'[]'::jsonb) AS guardian_contacts FROM leads WHERE id=$1 AND qualification_status<>'archived'")
                .bind(id).fetch_optional(&state.db).await.map_err(db_error)?
        }
        _ => None,
    };
    if let Some(row) = row {
        let birth_date = row.get::<Option<NaiveDate>, _>("birth_date");
        if is_minor(birth_date) {
            let contacts = row.get::<Value, _>("guardian_contacts");
            if let Some(guardian) = guardian_signer(&contacts) {
                client = guardian;
            }
        } else {
            client.first_name = row.get("first_name");
            client.last_name = row.get("last_name");
            client.email = row.get::<Option<String>, _>("email").unwrap_or_default();
        }
    }
    let mut signers = if policy == SignerPolicy::AgencyOnly {
        Vec::new()
    } else {
        vec![client]
    };
    if policy == SignerPolicy::ClientOnly {
        return Ok(signers);
    }
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
            positions: Vec::new(),
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
                positions: Vec::new(),
                ..agency
            }])
            .is_err()
        );
    }

    #[test]
    fn guardian_is_used_as_the_minor_document_signer() {
        let signer = guardian_signer(&json!([{
            "name": "Anna Beispiel",
            "email": "ANNA@example.org",
            "relation": "parent"
        }]))
        .unwrap();
        assert_eq!(signer.first_name, "Anna");
        assert_eq!(signer.last_name, "Beispiel");
        assert_eq!(signer.email, "anna@example.org");
        assert_eq!(signer.role, "client");
    }
}
