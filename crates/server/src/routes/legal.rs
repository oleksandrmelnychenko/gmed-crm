//! Public legal notices: who the controller is and how to reach the privacy
//! contact (Art. 13 DSGVO, § 5 TMG). Read from the agency settings the
//! documents already use, so the notice and the contracts never disagree.

use axum::{Json, Router, extract::State, http::StatusCode, response::IntoResponse, routing::get};
use serde_json::{Map, Value, json};
use sqlx::Row;

use crate::state::AppState;

const LEGAL_SETTING_KEYS: &[&str] = &[
    "agency_name",
    "agency_care_of",
    "agency_address",
    "agency_country_code",
    "agency_phone",
    "agency_email",
    "agency_website",
    "agency_vat_id",
    "agency_privacy_email",
    "agency_data_system_name",
    "agency_data_processor_notice",
    "agency_data_controller_statement",
];

pub fn public_router() -> Router<AppState> {
    Router::new().route("/public/legal", get(legal_notice))
}

async fn legal_notice(State(state): State<AppState>) -> axum::response::Response {
    let rows = sqlx::query("SELECT key, value FROM system_settings WHERE key = ANY($1)")
        .bind(LEGAL_SETTING_KEYS)
        .fetch_all(&state.db)
        .await;
    let rows = match rows {
        Ok(rows) => rows,
        Err(e) => {
            tracing::error!(error = %e, "load legal notice settings");
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": "Internal Server Error", "message": "Failed to load legal notice" })),
            )
                .into_response();
        }
    };

    let mut fields = Map::new();
    for row in rows {
        let key: String = row.try_get("key").unwrap_or_default();
        let value: Value = row.try_get("value").unwrap_or(Value::Null);
        // Settings are stored as JSON; a bare string is the common case.
        let text = match value {
            Value::String(text) => text,
            Value::Null => String::new(),
            other => other.to_string(),
        };
        fields.insert(key, Value::String(text.trim().to_string()));
    }
    Json(Value::Object(fields)).into_response()
}
