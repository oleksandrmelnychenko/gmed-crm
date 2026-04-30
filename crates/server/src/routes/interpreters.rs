use axum::{
    Json, Router,
    extract::{Extension, Path, State},
    http::StatusCode,
    response::IntoResponse,
    routing::get,
};
use serde::Deserialize;
use sqlx::Row;
use uuid::Uuid;

use crate::access;
use crate::auth::middleware::AuthUser;
use crate::services::interpreter_suggestions::load_appointment_interpreter_suggestions;
use crate::state::AppState;
use gmed_domain::role::Role;

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/appointments/{appointment_id}/interpreter-suggestions",
            get(get_interpreter_suggestions),
        )
        .route(
            "/interpreters/{interpreter_id}/languages",
            get(list_interpreter_languages).post(replace_interpreter_languages),
        )
}

#[derive(Deserialize)]
struct ReplaceInterpreterLanguages {
    languages: Vec<InterpreterLanguageInput>,
}

#[derive(Deserialize)]
struct InterpreterLanguageInput {
    language_code: String,
    language_label: Option<String>,
    proficiency: Option<String>,
}

async fn get_interpreter_suggestions(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(appointment_id): Path<Uuid>,
) -> axum::response::Response {
    if let Err(resp) = auth.require_any_role(&[Role::PatientManager, Role::TeamleadInterpreter, Role::Ceo]) {
        return resp;
    }

    let row = match sqlx::query(
        "SELECT patient_id, interpreter_id, owner_user_id FROM appointments WHERE id = $1",
    )
    .bind(appointment_id)
    .fetch_optional(&state.db)
    .await
    {
        Ok(value) => value,
        Err(error) => {
            tracing::error!(error = %error, appointment_id = %appointment_id, "load appointment for interpreter suggestions");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to load appointment",
            );
        }
    };

    let Some(row) = row else {
        return err(StatusCode::NOT_FOUND, "Appointment not found");
    };
    let patient_id = match row.try_get::<Uuid, _>("patient_id") {
        Ok(value) => value,
        Err(_) => {
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to decode appointment",
            );
        }
    };
    if let Err(resp) = ensure_patient_scope(&state, &auth, patient_id).await {
        return resp;
    }

    match load_appointment_interpreter_suggestions(&state.db, appointment_id).await {
        Ok(suggestions) => Json(suggestions).into_response(),
        Err(error) => {
            tracing::error!(error = %error, appointment_id = %appointment_id, "load interpreter suggestions");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to load interpreter suggestions",
            )
        }
    }
}

async fn list_interpreter_languages(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(interpreter_id): Path<Uuid>,
) -> axum::response::Response {
    if let Err(resp) = auth.require_any_role(&[Role::TeamleadInterpreter, Role::PatientManager, Role::Ceo]) {
        return resp;
    }

    match sqlx::query(
        r#"SELECT id, language_code, language_label, proficiency, is_active
           FROM interpreter_languages
           WHERE interpreter_id = $1
           ORDER BY is_active DESC, language_code"#,
    )
    .bind(interpreter_id)
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => Json(
            rows.into_iter()
                .map(|row| {
                    serde_json::json!({
                        "id": row.try_get::<Uuid, _>("id").unwrap_or_default(),
                        "language_code": row.try_get::<String, _>("language_code").unwrap_or_default(),
                        "language_label": row.try_get::<Option<String>, _>("language_label").unwrap_or_default(),
                        "proficiency": row.try_get::<String, _>("proficiency").unwrap_or_else(|_| "working".to_string()),
                        "is_active": row.try_get::<bool, _>("is_active").unwrap_or(true),
                    })
                })
                .collect::<Vec<_>>(),
        )
        .into_response(),
        Err(error) => {
            tracing::error!(error = %error, interpreter_id = %interpreter_id, "list interpreter languages");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to load interpreter languages",
            )
        }
    }
}

async fn replace_interpreter_languages(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(interpreter_id): Path<Uuid>,
    Json(body): Json<ReplaceInterpreterLanguages>,
) -> axum::response::Response {
    if let Err(resp) = auth.require_any_role(&[Role::TeamleadInterpreter]) {
        return resp;
    }
    if body.languages.len() > 20 {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Too many interpreter languages",
        );
    }

    let interpreter_exists = match sqlx::query_scalar::<_, bool>(
        r#"SELECT EXISTS(
                SELECT 1
                FROM users
                WHERE id = $1
                  AND is_active = true
                  AND role IN ('interpreter', 'teamlead_interpreter')
           )"#,
    )
    .bind(interpreter_id)
    .fetch_one(&state.db)
    .await
    {
        Ok(value) => value,
        Err(error) => {
            tracing::error!(error = %error, interpreter_id = %interpreter_id, "validate interpreter for languages");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to validate interpreter",
            );
        }
    };
    if !interpreter_exists {
        return err(StatusCode::NOT_FOUND, "Interpreter not found");
    }

    let mut tx = match state.db.begin().await {
        Ok(tx) => tx,
        Err(error) => {
            tracing::error!(error = %error, "begin interpreter language replace");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to save interpreter languages",
            );
        }
    };

    if let Err(error) = sqlx::query("DELETE FROM interpreter_languages WHERE interpreter_id = $1")
        .bind(interpreter_id)
        .execute(&mut *tx)
        .await
    {
        tracing::error!(error = %error, interpreter_id = %interpreter_id, "clear interpreter languages");
        return err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to save interpreter languages",
        );
    }

    for input in body.languages {
        let Some(language_code) = normalize_language_code(&input.language_code) else {
            return err(StatusCode::UNPROCESSABLE_ENTITY, "Invalid language code");
        };
        let proficiency = input
            .proficiency
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or("working");
        if !matches!(
            proficiency,
            "native" | "fluent" | "working" | "basic" | "unknown"
        ) {
            return err(StatusCode::UNPROCESSABLE_ENTITY, "Invalid proficiency");
        }

        if let Err(error) = sqlx::query(
            r#"INSERT INTO interpreter_languages (
                    interpreter_id, language_code, language_label, proficiency
               ) VALUES ($1, $2, $3, $4)"#,
        )
        .bind(interpreter_id)
        .bind(language_code)
        .bind(normalize_optional_text(input.language_label))
        .bind(proficiency)
        .execute(&mut *tx)
        .await
        {
            tracing::error!(error = %error, interpreter_id = %interpreter_id, "insert interpreter language");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to save interpreter languages",
            );
        }
    }

    if let Err(error) = tx.commit().await {
        tracing::error!(error = %error, interpreter_id = %interpreter_id, "commit interpreter languages");
        return err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to save interpreter languages",
        );
    }

    Json(serde_json::json!({"ok": true})).into_response()
}

async fn ensure_patient_scope(
    state: &AppState,
    auth: &AuthUser,
    patient_id: Uuid,
) -> Result<(), axum::response::Response> {
    if matches!(auth.role, Role::Ceo | Role::TeamleadInterpreter) {
        return Ok(());
    }

    let assigned = access::has_active_patient_assignment(&state.db, patient_id, auth.user_id)
        .await
        .map_err(|error| {
            tracing::error!(error = %error, patient_id = %patient_id, "validate patient scope");
            err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to validate access")
        })?;
    if assigned {
        Ok(())
    } else {
        Err(err(StatusCode::FORBIDDEN, "Insufficient permissions"))
    }
}

fn normalize_language_code(value: &str) -> Option<String> {
    let normalized = value.trim().to_lowercase();
    if normalized.is_empty()
        || normalized.len() > 16
        || !normalized
            .chars()
            .all(|ch| ch.is_ascii_alphabetic() || ch == '-' || ch == '_')
    {
        None
    } else {
        Some(normalized)
    }
}

fn normalize_optional_text(value: Option<String>) -> Option<String> {
    value
        .map(|raw| raw.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn err(status: StatusCode, message: &str) -> axum::response::Response {
    (
        status,
        Json(serde_json::json!({
            "error": status.canonical_reason().unwrap_or("error"),
            "message": message,
        })),
    )
        .into_response()
}
