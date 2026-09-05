//! Local DATEV onboarding. No outbound DATEV client or accounting write routes.
use axum::{
    Extension, Json, Router,
    extract::{DefaultBodyLimit, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::get,
};
use gmed_domain::role::Role;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sqlx::Row;
use uuid::Uuid;

use crate::{audit, auth::middleware::AuthUser, state::AppState};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/admin/datev/setup", get(load).put(save))
        .layer(DefaultBodyLimit::max(8 * 1024))
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum Module {
    Belege,
    Belegfreigabe,
    Bank,
    Kassenbuch,
    Auswertungspakete,
    Liquiditaetsmonitor,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
enum ExportService {
    #[default]
    Unknown,
    NotOrdered,
    Ordered,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Profile {
    company_name: String,
    consultant_number: String,
    client_number: String,
    belege_version: String,
    modules: Vec<Module>,
    export_service: ExportService,
}

impl Default for Profile {
    fn default() -> Self {
        Self {
            company_name: String::new(),
            consultant_number: String::new(),
            client_number: String::new(),
            belege_version: String::new(),
            modules: vec![
                Module::Belege,
                Module::Belegfreigabe,
                Module::Bank,
                Module::Kassenbuch,
                Module::Auswertungspakete,
                Module::Liquiditaetsmonitor,
            ],
            export_service: ExportService::Unknown,
        }
    }
}

impl Profile {
    fn validate(&mut self) -> Result<(), &'static str> {
        for (value, max) in [
            (&mut self.company_name, 160),
            (&mut self.belege_version, 80),
        ] {
            *value = value.trim().to_string();
            if value.chars().count() > max || value.chars().any(char::is_control) {
                return Err("datev_profile_invalid");
            }
        }
        for (value, max) in [
            (&mut self.consultant_number, 7),
            (&mut self.client_number, 5),
        ] {
            *value = value.trim().to_string();
            if value.len() > max || !value.bytes().all(|c| c.is_ascii_digit()) {
                return Err("datev_numbers_invalid");
            }
        }
        if self.consultant_number.is_empty() != self.client_number.is_empty() {
            return Err("datev_numbers_incomplete");
        }
        if self.modules.len() > 6
            || self
                .modules
                .iter()
                .enumerate()
                .any(|(i, m)| self.modules[..i].contains(m))
        {
            return Err("datev_modules_invalid");
        }
        Ok(())
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct SaveRequest {
    revision: Option<Uuid>,
    profile: Profile,
}

fn error(status: StatusCode, code: &str) -> Response {
    (status, Json(json!({ "error": code }))).into_response()
}

fn db_error(e: sqlx::Error) -> Response {
    tracing::error!(error = %e, "DATEV setup database operation failed");
    error(StatusCode::INTERNAL_SERVER_ERROR, "datev_setup_unavailable")
}

fn response(
    profile: Value,
    revision: Option<Uuid>,
    updated_at: Option<chrono::DateTime<chrono::Utc>>,
) -> Value {
    json!({ "profile": profile, "revision": revision, "updated_at": updated_at,
        "connection_status": "not_configured", "read_only": true,
        "accounting_writes_enabled": false, "last_sync_at": null })
}

async fn load(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
) -> Result<Json<Value>, Response> {
    auth.require_exact_role(&[Role::Ceo, Role::ItAdmin])?;
    let row = sqlx::query(
        "SELECT profile, revision, updated_at FROM datev_integration_setup WHERE singleton",
    )
    .fetch_optional(&state.db)
    .await
    .map_err(db_error)?;
    Ok(Json(match row {
        Some(row) => response(
            row.get("profile"),
            Some(row.get("revision")),
            Some(row.get("updated_at")),
        ),
        None => response(json!(Profile::default()), None, None),
    }))
}

async fn save(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Json(mut body): Json<SaveRequest>,
) -> Result<Json<Value>, Response> {
    auth.require_exact_role(&[Role::Ceo, Role::ItAdmin])?;
    body.profile
        .validate()
        .map_err(|e| error(StatusCode::UNPROCESSABLE_ENTITY, e))?;
    let revision = Uuid::new_v4();
    let profile = json!(body.profile);
    // Optimistic concurrency prevents stale tabs from overwriting the accountant's setup.
    let row = if let Some(expected) = body.revision {
        sqlx::query("UPDATE datev_integration_setup SET profile=$1, revision=$2, updated_by=$3, updated_at=now() WHERE singleton AND revision=$4 RETURNING updated_at")
            .bind(&profile).bind(revision).bind(auth.user_id).bind(expected)
            .fetch_optional(&state.db).await.map_err(db_error)?
    } else {
        sqlx::query("INSERT INTO datev_integration_setup (profile, revision, updated_by) VALUES ($1,$2,$3) ON CONFLICT (singleton) DO NOTHING RETURNING updated_at")
            .bind(&profile).bind(revision).bind(auth.user_id)
            .fetch_optional(&state.db).await.map_err(db_error)?
    };
    let Some(row) = row else {
        return Err(error(StatusCode::CONFLICT, "datev_setup_changed"));
    };
    state.audit_sender.try_send(audit::domain_event(
        "datev_setup_updated",
        Some(auth.user_id),
        "datev_setup",
        Some(revision),
        json!({"modules":body.profile.modules,"export_service":body.profile.export_service}),
    ));
    Ok(Json(response(
        profile,
        Some(revision),
        Some(row.get("updated_at")),
    )))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn setup_preserves_identifiers_and_rejects_partial_or_invalid_numbers() {
        let mut profile = Profile {
            consultant_number: " 0012345 ".into(),
            client_number: "00012".into(),
            ..Profile::default()
        };
        profile.validate().unwrap();
        assert_eq!(profile.consultant_number, "0012345");
        profile.client_number.clear();
        assert!(profile.validate().is_err());
        profile.client_number = "123456".into();
        assert!(profile.validate().is_err());
        profile.client_number = "1e3".into();
        assert!(profile.validate().is_err());
    }

    #[test]
    fn user_configuration_cannot_grant_access_or_enable_writes() {
        let mut profile = json!(Profile::default());
        profile["connected"] = json!(true);
        assert!(serde_json::from_value::<Profile>(profile).is_err());
        let mut profile = Profile::default();
        profile.modules.push(Module::Bank);
        assert!(profile.validate().is_err());
        let result = response(json!(Profile::default()), None, None);
        assert_eq!(result["connection_status"], "not_configured");
        assert_eq!(result["accounting_writes_enabled"], false);
    }
}
