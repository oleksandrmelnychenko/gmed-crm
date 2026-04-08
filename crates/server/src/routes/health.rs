use crate::state::AppState;
use axum::{Json, Router, routing::get};

pub fn router() -> Router<AppState> {
    Router::new().route("/health", get(health_check))
}

async fn health_check() -> Json<serde_json::Value> {
    Json(serde_json::json!({ "status": "ok" }))
}
