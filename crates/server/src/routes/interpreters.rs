use axum::{
    Json, Router,
    extract::{Extension, Path, State},
    http::StatusCode,
    response::IntoResponse,
    routing::get,
};
use serde::Deserialize;
use serde_json::Value;
use sqlx::Row;
use uuid::Uuid;

use crate::access;
use crate::auth::middleware::AuthUser;
use crate::services::interpreter_suggestions::load_appointment_interpreter_suggestions;
use crate::state::AppState;
use gmed_domain::role::Role;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/interpreters", get(list_interpreter_profiles))
        .route(
            "/interpreters/{interpreter_id}/profile",
            get(get_interpreter_profile).put(update_interpreter_profile),
        )
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

async fn list_interpreter_profiles(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
) -> axum::response::Response {
    if let Err(resp) = auth.require_any_role(&[
        Role::Ceo,
        Role::PatientManager,
        Role::TeamleadInterpreter,
        Role::ItAdmin,
    ]) {
        return resp;
    }

    match sqlx::query(
        r#"SELECT u.id, u.name, u.email, u.role, u.is_active,
                  COALESCE(p.profile, '{}'::jsonb) AS profile,
                  p.updated_at AS profile_updated_at
           FROM users u
           LEFT JOIN interpreter_profiles p ON p.user_id = u.id
           WHERE u.role IN ('interpreter', 'teamlead_interpreter')
           ORDER BY u.is_active DESC, u.name"#,
    )
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => Json(
            rows.into_iter()
                .map(interpreter_profile_row_json)
                .collect::<Vec<_>>(),
        )
        .into_response(),
        Err(error) => {
            tracing::error!(error = %error, "list interpreter profiles");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to load interpreter profiles",
            )
        }
    }
}

async fn get_interpreter_profile(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(interpreter_id): Path<Uuid>,
) -> axum::response::Response {
    if let Err(resp) = ensure_interpreter_profile_access(&state, &auth, interpreter_id, false).await
    {
        return resp;
    }

    match sqlx::query(
        r#"SELECT u.id, u.name, u.email, u.role, u.is_active,
                  COALESCE(p.profile, '{}'::jsonb) AS profile,
                  p.updated_at AS profile_updated_at
           FROM users u
           LEFT JOIN interpreter_profiles p ON p.user_id = u.id
           WHERE u.id = $1
             AND u.role IN ('interpreter', 'teamlead_interpreter')"#,
    )
    .bind(interpreter_id)
    .fetch_optional(&state.db)
    .await
    {
        Ok(Some(row)) => Json(interpreter_profile_row_json(row)).into_response(),
        Ok(None) => err(StatusCode::NOT_FOUND, "Interpreter not found"),
        Err(error) => {
            tracing::error!(error = %error, interpreter_id = %interpreter_id, "get interpreter profile");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to load interpreter profile",
            )
        }
    }
}

async fn update_interpreter_profile(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(interpreter_id): Path<Uuid>,
    Json(body): Json<Value>,
) -> axum::response::Response {
    if let Err(resp) = ensure_interpreter_profile_access(&state, &auth, interpreter_id, true).await
    {
        return resp;
    }

    let profile = match normalize_profile_payload(body) {
        Ok(value) => value,
        Err(resp) => return resp,
    };

    match sqlx::query(
        r#"INSERT INTO interpreter_profiles (user_id, profile, updated_by)
           VALUES ($1, $2, $3)
           ON CONFLICT (user_id)
           DO UPDATE SET profile = EXCLUDED.profile,
                         updated_by = EXCLUDED.updated_by,
                         updated_at = now()
           RETURNING profile, updated_at"#,
    )
    .bind(interpreter_id)
    .bind(profile)
    .bind(auth.user_id)
    .fetch_one(&state.db)
    .await
    {
        Ok(row) => Json(serde_json::json!({
            "user_id": interpreter_id,
            "profile": row.try_get::<Value, _>("profile").unwrap_or_else(|_| serde_json::json!({})),
            "updated_at": row
                .try_get::<chrono::DateTime<chrono::Utc>, _>("updated_at")
                .map(|value| value.to_rfc3339())
                .unwrap_or_default(),
        }))
        .into_response(),
        Err(error) => {
            tracing::error!(error = %error, interpreter_id = %interpreter_id, "update interpreter profile");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to save interpreter profile",
            )
        }
    }
}

async fn get_interpreter_suggestions(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(appointment_id): Path<Uuid>,
) -> axum::response::Response {
    if let Err(resp) =
        auth.require_any_role(&[Role::PatientManager, Role::TeamleadInterpreter, Role::Ceo])
    {
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
    if let Err(resp) =
        auth.require_any_role(&[Role::TeamleadInterpreter, Role::PatientManager, Role::Ceo])
    {
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

async fn ensure_interpreter_profile_access(
    state: &AppState,
    auth: &AuthUser,
    interpreter_id: Uuid,
    write: bool,
) -> Result<(), axum::response::Response> {
    let allowed = if write {
        matches!(
            auth.role,
            Role::Ceo | Role::PatientManager | Role::TeamleadInterpreter | Role::ItAdmin
        )
    } else {
        matches!(
            auth.role,
            Role::Ceo
                | Role::PatientManager
                | Role::TeamleadInterpreter
                | Role::ItAdmin
                | Role::Interpreter
        ) && (auth.role != Role::Interpreter || auth.user_id == interpreter_id)
    };

    if !allowed {
        return Err(err(StatusCode::FORBIDDEN, "Insufficient permissions"));
    }

    let exists = sqlx::query_scalar::<_, bool>(
        r#"SELECT EXISTS(
                SELECT 1
                FROM users
                WHERE id = $1
                  AND role IN ('interpreter', 'teamlead_interpreter')
           )"#,
    )
    .bind(interpreter_id)
    .fetch_one(&state.db)
    .await
    .map_err(|error| {
        tracing::error!(error = %error, interpreter_id = %interpreter_id, "validate interpreter profile access");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to validate interpreter",
        )
    })?;

    if exists {
        Ok(())
    } else {
        Err(err(StatusCode::NOT_FOUND, "Interpreter not found"))
    }
}

fn interpreter_profile_row_json(row: sqlx::postgres::PgRow) -> Value {
    serde_json::json!({
        "id": row.try_get::<Uuid, _>("id").unwrap_or_default(),
        "name": row.try_get::<String, _>("name").unwrap_or_default(),
        "email": row.try_get::<String, _>("email").unwrap_or_default(),
        "role": row.try_get::<String, _>("role").unwrap_or_default(),
        "is_active": row.try_get::<bool, _>("is_active").unwrap_or(false),
        "profile": row.try_get::<Value, _>("profile").unwrap_or_else(|_| serde_json::json!({})),
        "profile_updated_at": row
            .try_get::<Option<chrono::DateTime<chrono::Utc>>, _>("profile_updated_at")
            .unwrap_or_default()
            .map(|value| value.to_rfc3339()),
    })
}

#[allow(clippy::result_large_err)]
fn normalize_profile_payload(body: Value) -> Result<Value, axum::response::Response> {
    let profile = body.get("profile").cloned().unwrap_or(body);
    if !profile.is_object() {
        return Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Profile payload must be a JSON object",
        ));
    }

    if serde_json::to_vec(&profile)
        .map(|bytes| bytes.len() > 65_536)
        .unwrap_or(true)
    {
        return Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Profile payload is too large",
        ));
    }

    Ok(profile)
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
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to validate access",
            )
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
