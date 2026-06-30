use axum::{
    Json, Router,
    extract::{Extension, Path, Query, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::audit;
use crate::auth::{middleware::AuthUser, password};
use crate::state::AppState;
use gmed_domain::role::Role;
use sqlx::Row;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/users", get(list_users).post(create_user))
        .route("/users/{user_id}", get(get_user))
        .route("/users/{user_id}/update", post(update_user))
        .route("/users/{user_id}/deactivate", post(deactivate_user))
        .route("/users/{user_id}/activate", post(activate_user))
        .route("/users/{user_id}/reset-password", post(reset_password))
}

#[derive(Serialize)]
struct UserResponse {
    id: Uuid,
    email: String,
    name: String,
    role: String,
    is_active: bool,
    created_at: chrono::DateTime<chrono::Utc>,
    updated_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Deserialize)]
struct CreateUserRequest {
    email: String,
    name: String,
    password: String,
    role: String,
}

#[derive(Deserialize)]
struct UpdateUserRequest {
    name: Option<String>,
    role: Option<String>,
    email: Option<String>,
}

#[derive(Deserialize)]
struct ResetPasswordRequest {
    new_password: String,
}

#[derive(Deserialize)]
struct ListUsersQuery {
    search: Option<String>,
    role: Option<String>,
    active_only: Option<bool>,
    assignable_only: Option<bool>,
}

const VALID_ROLES: &[&str] = &[
    "ceo",
    "ceo_assistant",
    "patient_manager",
    "teamlead_interpreter",
    "interpreter",
    "concierge",
    "billing",
    "sales",
    "it_admin",
    "patient",
];

const PASSWORD_POLICY_MESSAGE: &str =
    "Password must contain uppercase and lowercase letters, a number, and a symbol";

fn validate_password_policy(password: &str) -> Result<(), &'static str> {
    if password.len() < 8 || password.len() > 256 {
        return Err("Password must be 8-256 characters");
    }

    let has_lowercase = password.chars().any(|ch| ch.is_ascii_lowercase());
    let has_uppercase = password.chars().any(|ch| ch.is_ascii_uppercase());
    let has_digit = password.chars().any(|ch| ch.is_ascii_digit());
    let has_symbol = password.chars().any(|ch| !ch.is_ascii_alphanumeric());

    if !(has_lowercase && has_uppercase && has_digit && has_symbol) {
        return Err(PASSWORD_POLICY_MESSAGE);
    }

    Ok(())
}

fn validate_create(req: &CreateUserRequest) -> Result<(), &'static str> {
    if req.email.is_empty() || req.email.len() > 320 || !req.email.contains('@') {
        return Err("Invalid email");
    }
    if req.name.is_empty() || req.name.len() > 200 {
        return Err("Name must be 1-200 characters");
    }
    validate_password_policy(&req.password)?;
    if !VALID_ROLES.contains(&req.role.as_str()) {
        return Err("Invalid role");
    }
    Ok(())
}

async fn list_users(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Query(query): Query<ListUsersQuery>,
) -> impl IntoResponse {
    auth.require_any_role(&[Role::Ceo, Role::ItAdmin])?;

    if let Some(ref role) = query.role
        && !VALID_ROLES.contains(&role.as_str())
    {
        return Err(err(StatusCode::UNPROCESSABLE_ENTITY, "Invalid role"));
    }

    let search_pattern = format!("%{}%", query.search.unwrap_or_default());
    let active_only = query.active_only.unwrap_or(false);
    let assignable_only = query.assignable_only.unwrap_or(false);

    match sqlx::query(
        r#"SELECT id, email, name, role, is_active, created_at, updated_at
           FROM users
           WHERE ($1::text = '%%'
                  OR email ILIKE $1
                  OR name ILIKE $1)
             AND ($2::text IS NULL OR role = $2)
             AND ($3::bool = false OR is_active = true)
             AND (
                $4::bool = false
                OR role IN (
                    'patient_manager',
                    'teamlead_interpreter',
                    'interpreter',
                    'concierge'
                )
             )
             -- Hide external/unspecified provider staff (Внешний / не указано):
             -- they must not appear in the Users & Roles table. External
             -- interpreter profiles follow the same rule.
             AND NOT (
                (
                    EXISTS (
                        SELECT 1
                        FROM provider_person_contacts pc
                        JOIN provider_staff s ON s.id = pc.staff_id
                        WHERE pc.contact_kind = 'email'
                          AND lower(btrim(pc.value)) = lower(btrim(users.email))
                          AND s.status IN ('external', 'unknown')
                    )
                    AND NOT EXISTS (
                        SELECT 1
                        FROM provider_person_contacts pc
                        JOIN provider_staff s ON s.id = pc.staff_id
                        WHERE pc.contact_kind = 'email'
                          AND lower(btrim(pc.value)) = lower(btrim(users.email))
                          AND s.status IN ('active', 'inactive')
                    )
                )
                OR EXISTS (
                    SELECT 1
                    FROM interpreter_profile_details d
                    WHERE d.user_id = users.id
                      AND d.employment_kind = 'external'
                )
                OR EXISTS (
                    SELECT 1
                    FROM interpreter_profiles p
                    WHERE p.user_id = users.id
                      AND p.profile->>'employmentKind' = 'external'
                )
                OR EXISTS (
                    SELECT 1
                    FROM interpreter_standalone_profiles sp
                    WHERE sp.email IS NOT NULL
                      AND lower(btrim(sp.email)) = lower(btrim(users.email))
                      AND COALESCE(sp.profile->>'employmentKind', 'external') = 'external'
                )
             )
           ORDER BY is_active DESC, created_at DESC"#,
    )
    .bind(search_pattern)
    .bind(query.role)
    .bind(active_only)
    .bind(assignable_only)
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => {
            let mut users = Vec::with_capacity(rows.len());
            for r in rows {
                users.push(UserResponse {
                    id: r.try_get("id").unwrap_or_else(|_| Uuid::nil()),
                    email: r.try_get("email").unwrap_or_default(),
                    name: r.try_get("name").unwrap_or_default(),
                    role: r.try_get("role").unwrap_or_default(),
                    is_active: r.try_get("is_active").unwrap_or(false),
                    created_at: r
                        .try_get("created_at")
                        .unwrap_or_else(|_| chrono::Utc::now()),
                    updated_at: r
                        .try_get("updated_at")
                        .unwrap_or_else(|_| chrono::Utc::now()),
                });
            }
            Ok(Json(users))
        }
        Err(e) => {
            tracing::error!(error = %e, "Failed to list users");
            Err(err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to list users",
            ))
        }
    }
}

async fn get_user(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(user_id): Path<Uuid>,
) -> impl IntoResponse {
    auth.require_any_role(&[Role::Ceo, Role::ItAdmin])?;

    match sqlx::query!(
        "SELECT id, email, name, role, is_active, created_at, updated_at FROM users WHERE id = $1",
        user_id
    )
    .fetch_optional(&state.db)
    .await
    {
        Ok(Some(r)) => Ok(Json(UserResponse {
            id: r.id,
            email: r.email,
            name: r.name,
            role: r.role,
            is_active: r.is_active,
            created_at: r.created_at,
            updated_at: r.updated_at,
        })),
        Ok(None) => Err(err(StatusCode::NOT_FOUND, "User not found")),
        Err(e) => {
            tracing::error!(error = %e, "Failed to get user");
            Err(err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to get user"))
        }
    }
}

async fn create_user(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Json(body): Json<CreateUserRequest>,
) -> impl IntoResponse {
    auth.require_exact_role(&[Role::Ceo, Role::ItAdmin])?;

    if let Err(msg) = validate_create(&body) {
        return Err(err(StatusCode::UNPROCESSABLE_ENTITY, msg));
    }

    if email_is_blocked_external_staff(&state.db, &body.email).await {
        return Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "External contractors cannot be created as user accounts",
        ));
    }

    let hash = match password::hash_password(&body.password) {
        Ok(h) => h,
        Err(e) => {
            tracing::error!(error = %e, "Failed to hash password");
            return Err(err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to create user",
            ));
        }
    };

    match sqlx::query!(
        "INSERT INTO users (email, password_hash, name, role)
         VALUES ($1, $2, $3, $4)
         RETURNING id, email, name, role, is_active, created_at, updated_at",
        body.email,
        hash,
        body.name,
        body.role
    )
    .fetch_one(&state.db)
    .await
    {
        Ok(r) => {
            tracing::info!(created_by = %auth.user_id, new_user = %r.id, role = %body.role, "User created");

            state.audit_sender.try_send(audit::domain_event(
                "create_user",
                Some(auth.user_id),
                "user",
                Some(r.id),
                serde_json::json!({ "role": body.role, "email": body.email }),
            ));
            crate::realtime::publish_admin_event(
                &state,
                Some(auth.user_id),
                "user.created",
                "user",
                r.id,
                serde_json::json!({
                    "role": r.role.clone(),
                    "email": r.email.clone(),
                }),
            )
            .await;

            Ok((
                StatusCode::CREATED,
                Json(UserResponse {
                    id: r.id,
                    email: r.email,
                    name: r.name,
                    role: r.role,
                    is_active: r.is_active,
                    created_at: r.created_at,
                    updated_at: r.updated_at,
                }),
            ))
        }
        Err(e) if e.to_string().contains("unique") => {
            Err(err(StatusCode::CONFLICT, "Email already exists"))
        }
        Err(e) => {
            tracing::error!(error = %e, "Failed to create user");
            Err(err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to create user",
            ))
        }
    }
}

async fn update_user(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(user_id): Path<Uuid>,
    Json(body): Json<UpdateUserRequest>,
) -> impl IntoResponse {
    auth.require_exact_role(&[Role::Ceo, Role::ItAdmin])?;

    if let Some(ref role) = body.role
        && !VALID_ROLES.contains(&role.as_str())
    {
        return Err(err(StatusCode::UNPROCESSABLE_ENTITY, "Invalid role"));
    }
    if let Some(ref email) = body.email
        && (email.is_empty() || email.len() > 320 || !email.contains('@'))
    {
        return Err(err(StatusCode::UNPROCESSABLE_ENTITY, "Invalid email"));
    }

    let current = sqlx::query!("SELECT name, role, email FROM users WHERE id = $1", user_id)
        .fetch_optional(&state.db)
        .await
        .map_err(|e| {
            tracing::error!(error = %e, "DB error");
            err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to update user")
        })?
        .ok_or_else(|| err(StatusCode::NOT_FOUND, "User not found"))?;

    let new_name = body.name.as_deref().unwrap_or(&current.name);
    let new_role = body.role.as_deref().unwrap_or(&current.role);
    let new_email = body.email.as_deref().unwrap_or(&current.email);

    match sqlx::query!(
        "UPDATE users SET name = $2, role = $3, email = $4 WHERE id = $1
         RETURNING id, email, name, role, is_active, created_at, updated_at",
        user_id,
        new_name,
        new_role,
        new_email
    )
    .fetch_one(&state.db)
    .await
    {
        Ok(r) => {
            state.audit_sender.try_send(audit::domain_diff_event(
                "update_user",
                Some(auth.user_id),
                "user",
                Some(user_id),
                serde_json::json!({
                    "name": current.name,
                    "role": current.role,
                    "email": current.email,
                }),
                serde_json::json!({
                    "name": new_name,
                    "role": new_role,
                    "email": new_email,
                }),
            ));
            crate::realtime::publish_admin_event(
                &state,
                Some(auth.user_id),
                "user.updated",
                "user",
                user_id,
                serde_json::json!({
                    "role": r.role.clone(),
                    "email": r.email.clone(),
                }),
            )
            .await;

            Ok(Json(UserResponse {
                id: r.id,
                email: r.email,
                name: r.name,
                role: r.role,
                is_active: r.is_active,
                created_at: r.created_at,
                updated_at: r.updated_at,
            }))
        }
        Err(e) => {
            tracing::error!(error = %e, "Failed to update user");
            Err(err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to update user",
            ))
        }
    }
}

async fn deactivate_user(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(user_id): Path<Uuid>,
) -> impl IntoResponse {
    auth.require_exact_role(&[Role::Ceo, Role::ItAdmin])?;

    if user_id == auth.user_id {
        return Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Cannot deactivate yourself",
        ));
    }

    let result = sqlx::query!(
        "UPDATE users SET is_active = false WHERE id = $1 AND is_active = true",
        user_id
    )
    .execute(&state.db)
    .await;

    match result {
        Ok(r) if r.rows_affected() > 0 => {
            crate::auth::tokens::revoke_all_families(&state.db, user_id, "user_deactivated").await;
            tracing::info!(by = %auth.user_id, target = %user_id, "User deactivated");
            crate::realtime::publish_admin_event(
                &state,
                Some(auth.user_id),
                "user.deactivated",
                "user",
                user_id,
                serde_json::json!({ "user_id": user_id }),
            )
            .await;
            Ok(StatusCode::NO_CONTENT)
        }
        Ok(_) => Err(err(
            StatusCode::NOT_FOUND,
            "User not found or already deactivated",
        )),
        Err(e) => {
            tracing::error!(error = %e, "Failed to deactivate user");
            Err(err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to deactivate user",
            ))
        }
    }
}

async fn activate_user(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(user_id): Path<Uuid>,
) -> impl IntoResponse {
    auth.require_exact_role(&[Role::Ceo, Role::ItAdmin])?;

    let result = sqlx::query!(
        "UPDATE users SET is_active = true WHERE id = $1 AND is_active = false",
        user_id
    )
    .execute(&state.db)
    .await;

    match result {
        Ok(r) if r.rows_affected() > 0 => {
            tracing::info!(by = %auth.user_id, target = %user_id, "User activated");
            crate::realtime::publish_admin_event(
                &state,
                Some(auth.user_id),
                "user.activated",
                "user",
                user_id,
                serde_json::json!({ "user_id": user_id }),
            )
            .await;
            Ok(StatusCode::NO_CONTENT)
        }
        Ok(_) => Err(err(
            StatusCode::NOT_FOUND,
            "User not found or already active",
        )),
        Err(e) => {
            tracing::error!(error = %e, "Failed to activate user");
            Err(err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to activate user",
            ))
        }
    }
}

async fn reset_password(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(user_id): Path<Uuid>,
    Json(body): Json<ResetPasswordRequest>,
) -> impl IntoResponse {
    auth.require_exact_role(&[Role::Ceo, Role::ItAdmin])?;

    if let Err(msg) = validate_password_policy(&body.new_password) {
        return Err(err(StatusCode::UNPROCESSABLE_ENTITY, msg));
    }

    let hash = match password::hash_password(&body.new_password) {
        Ok(h) => h,
        Err(e) => {
            tracing::error!(error = %e, "Failed to hash password");
            return Err(err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to reset password",
            ));
        }
    };

    let result = sqlx::query!(
        "UPDATE users SET password_hash = $2 WHERE id = $1",
        user_id,
        hash
    )
    .execute(&state.db)
    .await;

    match result {
        Ok(r) if r.rows_affected() > 0 => {
            crate::auth::tokens::revoke_all_families(&state.db, user_id, "password_reset").await;
            tracing::info!(by = %auth.user_id, target = %user_id, "Password reset");
            crate::realtime::publish_admin_event(
                &state,
                Some(auth.user_id),
                "user.password_reset",
                "user",
                user_id,
                serde_json::json!({ "user_id": user_id }),
            )
            .await;
            Ok(StatusCode::NO_CONTENT)
        }
        Ok(_) => Err(err(StatusCode::NOT_FOUND, "User not found")),
        Err(e) => {
            tracing::error!(error = %e, "Failed to reset password");
            Err(err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to reset password",
            ))
        }
    }
}

/// Returns true when `email` belongs to a provider-directory staff person whose
/// employment status is external (`Внешний`) or unspecified (`unknown` / не указано),
/// and who is not also recorded as internal staff (`active`/`inactive`) anywhere.
///
/// External contractors must never hold a usable login account: they cannot be
/// created ([`create_user`]), are hidden from the Users & Roles list
/// ([`list_users`]), and are refused at login (`auth::login`) — even if a `users`
/// row already exists. People with no entry in the provider staff directory
/// or interpreter external directory (e.g. CEO, IT admin) are never matched and
/// are unaffected.
///
/// Fails open (returns `false`) on a DB error so a transient failure cannot lock
/// out every account; the broader query failure is logged.
pub(crate) async fn email_is_blocked_external_staff(db: &sqlx::PgPool, email: &str) -> bool {
    match sqlx::query_scalar::<_, bool>(
        r#"
        SELECT (
            (
                EXISTS (
                    SELECT 1
                    FROM provider_person_contacts pc
                    JOIN provider_staff s ON s.id = pc.staff_id
                    WHERE pc.contact_kind = 'email'
                      AND lower(btrim(pc.value)) = lower(btrim($1))
                      AND s.status IN ('external', 'unknown')
                )
                AND NOT EXISTS (
                    SELECT 1
                    FROM provider_person_contacts pc
                    JOIN provider_staff s ON s.id = pc.staff_id
                    WHERE pc.contact_kind = 'email'
                      AND lower(btrim(pc.value)) = lower(btrim($1))
                      AND s.status IN ('active', 'inactive')
                )
            )
            OR EXISTS (
                SELECT 1
                FROM users u
                JOIN interpreter_profile_details d ON d.user_id = u.id
                WHERE lower(btrim(u.email)) = lower(btrim($1))
                  AND u.role IN ('interpreter', 'teamlead_interpreter')
                  AND d.employment_kind = 'external'
            )
            OR EXISTS (
                SELECT 1
                FROM users u
                JOIN interpreter_profiles p ON p.user_id = u.id
                WHERE lower(btrim(u.email)) = lower(btrim($1))
                  AND u.role IN ('interpreter', 'teamlead_interpreter')
                  AND p.profile->>'employmentKind' = 'external'
            )
            OR EXISTS (
                SELECT 1
                FROM interpreter_standalone_profiles sp
                WHERE sp.email IS NOT NULL
                  AND lower(btrim(sp.email)) = lower(btrim($1))
                  AND COALESCE(sp.profile->>'employmentKind', 'external') = 'external'
            )
        )
        "#,
    )
    .bind(email)
    .fetch_one(db)
    .await
    {
        Ok(blocked) => blocked,
        Err(e) => {
            tracing::error!(error = %e, "external-staff login gate query failed");
            false
        }
    }
}

fn err(status: StatusCode, message: &str) -> axum::response::Response {
    (status, Json(serde_json::json!({ "error": status.canonical_reason().unwrap_or("error"), "message": message }))).into_response()
}
