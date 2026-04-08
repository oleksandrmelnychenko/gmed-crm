use axum::{
    Json, Router,
    extract::{Extension, State},
    http::StatusCode,
    response::IntoResponse,
    routing::get,
};

use crate::auth::middleware::AuthUser;
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new().route("/me", get(get_me))
}

async fn get_me(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
) -> impl IntoResponse {
    match sqlx::query!(
        "SELECT id, email, name, role, created_at FROM users WHERE id = $1 AND is_active = true",
        auth.user_id
    )
    .fetch_optional(&state.db)
    .await
    {
        Ok(Some(u)) => Json(serde_json::json!({
            "id": u.id,
            "email": u.email,
            "name": u.name,
            "role": u.role,
            "created_at": u.created_at,
        }))
        .into_response(),

        Ok(None) => {
            tracing::warn!(user_id = %auth.user_id, "JWT valid but user not found or deactivated");
            (
                StatusCode::UNAUTHORIZED,
                Json(
                    serde_json::json!({ "error": "unauthorized", "message": "Account not found" }),
                ),
            )
                .into_response()
        }

        Err(e) => {
            tracing::error!(error = %e, "DB error in /me");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": "internal", "message": "An internal error occurred" })),
            )
                .into_response()
        }
    }
}
