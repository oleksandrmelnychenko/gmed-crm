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
use crate::auth::{middleware::AuthUser, password, password_policy};
use crate::state::AppState;
use gmed_domain::access::capabilities::Capability;
use gmed_domain::role::Role;
use sqlx::Row;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/staff-directory", get(list_staff_directory))
        .route("/users", get(list_users).post(create_user))
        .route("/users/{user_id}", get(get_user))
        .route("/users/{user_id}/update", post(update_user))
        .route("/users/{user_id}/deactivate", post(deactivate_user))
        .route("/users/{user_id}/activate", post(activate_user))
        .route("/users/{user_id}/unlock", post(unlock_user))
        .route("/users/{user_id}/reset-password", post(reset_password))
}

#[derive(Serialize)]
struct UserResponse {
    id: Uuid,
    email: String,
    name: String,
    role: String,
    is_active: bool,
    failed_login_attempts: i32,
    locked_until: Option<chrono::DateTime<chrono::Utc>>,
    password_changed_at: Option<chrono::DateTime<chrono::Utc>>,
    /// The person must replace the password at the next login (onboarding
    /// with a one-time password or an administrator reset).
    password_reset_required: bool,
    /// An authenticator app is enrolled and confirmed.
    totp_enrolled: bool,
    /// Sessions (token families) that are not revoked.
    active_sessions: i64,
    /// Start of the most recent session; `None` when the person never signed in.
    last_login_at: Option<chrono::DateTime<chrono::Utc>>,
    created_at: chrono::DateTime<chrono::Utc>,
    updated_at: chrono::DateTime<chrono::Utc>,
    /// Returned exactly once, in the response that generated it. Never
    /// stored, logged or audited.
    #[serde(skip_serializing_if = "Option::is_none")]
    one_time_password: Option<String>,
}

/// Columns shared by every `users` projection: the account row plus the
/// second-factor and session summary the administration screen shows.
const USER_SELECT_COLUMNS: &str = r#"users.id, users.email, users.name, users.role, users.is_active,
    users.failed_login_attempts, users.locked_until, users.password_changed_at,
    users.password_reset_required, users.created_at, users.updated_at,
    EXISTS (
        SELECT 1 FROM user_totp t
        WHERE t.user_id = users.id AND t.confirmed_at IS NOT NULL
    ) AS totp_enrolled,
    (
        SELECT count(*) FROM token_families tf
        WHERE tf.user_id = users.id AND NOT tf.is_revoked
    ) AS active_sessions,
    (
        SELECT max(tf.created_at) FROM token_families tf
        WHERE tf.user_id = users.id
    ) AS last_login_at"#;

fn user_response_from_row(r: &sqlx::postgres::PgRow) -> UserResponse {
    UserResponse {
        id: r.try_get("id").unwrap_or_else(|_| Uuid::nil()),
        email: r.try_get("email").unwrap_or_default(),
        name: r.try_get("name").unwrap_or_default(),
        role: r.try_get("role").unwrap_or_default(),
        is_active: r.try_get("is_active").unwrap_or(false),
        failed_login_attempts: r.try_get("failed_login_attempts").unwrap_or(0),
        locked_until: r.try_get("locked_until").unwrap_or(None),
        password_changed_at: r.try_get("password_changed_at").unwrap_or(None),
        password_reset_required: r.try_get("password_reset_required").unwrap_or(false),
        totp_enrolled: r.try_get("totp_enrolled").unwrap_or(false),
        active_sessions: r.try_get("active_sessions").unwrap_or(0),
        last_login_at: r.try_get("last_login_at").unwrap_or(None),
        created_at: r
            .try_get("created_at")
            .unwrap_or_else(|_| chrono::Utc::now()),
        updated_at: r
            .try_get("updated_at")
            .unwrap_or_else(|_| chrono::Utc::now()),
        one_time_password: None,
    }
}

#[derive(Serialize)]
struct StaffDirectoryEntry {
    id: Uuid,
    email: String,
    name: String,
    role: String,
}

#[derive(Deserialize)]
struct CreateUserRequest {
    email: String,
    name: String,
    /// Omitted: the server generates a one-time password, returns it once and
    /// forces a change at the first login.
    password: Option<String>,
    role: String,
}

#[derive(Deserialize)]
struct UpdateUserRequest {
    name: Option<String>,
    role: Option<String>,
    email: Option<String>,
}

#[derive(Deserialize, Default)]
struct ResetPasswordRequest {
    /// Omitted (or `generate: true`): the server generates a one-time
    /// password and returns it once. Either way the person must change the
    /// password at the next login.
    new_password: Option<String>,
    generate: Option<bool>,
}

#[derive(Serialize)]
struct ResetPasswordResponse {
    password_reset_required: bool,
    sessions_revoked: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    one_time_password: Option<String>,
}

/// Chooses between the administrator-supplied password and a generated one.
/// Returns the password and whether it was generated.
fn resolve_reset_password(req: ResetPasswordRequest) -> (String, bool) {
    let generate = req.generate.unwrap_or(false);
    match req.new_password {
        Some(password) if !generate && !password.is_empty() => (password, false),
        _ => (password_policy::generate_one_time_password(), true),
    }
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

/// Whether changing `target` (deactivating it or moving it off the `ceo`
/// role) would leave the company without any active CEO account.
pub(crate) fn would_remove_last_ceo(
    target_role: &str,
    target_is_active: bool,
    other_active_ceos: i64,
) -> bool {
    target_role == "ceo" && target_is_active && other_active_ceos == 0
}

async fn count_other_active_ceos<'e, E>(executor: E, target: Uuid) -> Result<i64, sqlx::Error>
where
    E: sqlx::Executor<'e, Database = sqlx::Postgres>,
{
    sqlx::query_scalar("SELECT count(*) FROM users WHERE role = 'ceo' AND is_active AND id <> $1")
        .bind(target)
        .fetch_one(executor)
        .await
}

fn last_ceo_protected() -> axum::response::Response {
    (
        StatusCode::CONFLICT,
        Json(serde_json::json!({
            "error": "last_ceo_protected",
            "message": "The last active CEO account cannot be deactivated or demoted",
        })),
    )
        .into_response()
}

/// Assigning the `ceo` role is reserved to the CEO (`users.manage_ceo`); a
/// technical admin manages every other role.
#[allow(clippy::result_large_err)]
pub(crate) fn ensure_can_assign_role(
    auth: &AuthUser,
    role: &str,
) -> Result<(), axum::response::Response> {
    if role == "ceo" {
        auth.require_capability(Capability::UsersManageCeo)
    } else {
        Ok(())
    }
}

/// Any operation that targets an existing CEO account needs
/// `users.manage_ceo`; other accounts need only `users.manage`.
#[allow(clippy::result_large_err)]
pub(crate) async fn ensure_can_manage_target(
    state: &AppState,
    auth: &AuthUser,
    user_id: Uuid,
) -> Result<(), axum::response::Response> {
    auth.require_capability(Capability::UsersManage)?;
    let target_role: Option<String> = sqlx::query_scalar("SELECT role FROM users WHERE id = $1")
        .bind(user_id)
        .fetch_optional(&state.db)
        .await
        .map_err(|e| {
            tracing::error!(error = %e, target = %user_id, "Failed to load target user role");
            err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to load user")
        })?;
    match target_role {
        None => Err(err(StatusCode::NOT_FOUND, "User not found")),
        Some(role) => ensure_can_assign_role(auth, &role),
    }
}

fn validate_create(req: &CreateUserRequest) -> Result<(), &'static str> {
    if req.email.is_empty() || req.email.len() > 320 || !req.email.contains('@') {
        return Err("Invalid email");
    }
    if req.name.is_empty() || req.name.len() > 200 {
        return Err("Name must be 1-200 characters");
    }
    if let Some(password) = req.password.as_deref() {
        password_policy::validate_password_policy(password)?;
    }
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
    auth.require_capability(Capability::UsersView)?;

    if let Some(ref role) = query.role
        && !VALID_ROLES.contains(&role.as_str())
    {
        return Err(err(StatusCode::UNPROCESSABLE_ENTITY, "Invalid role"));
    }

    let search_pattern = format!("%{}%", query.search.unwrap_or_default());
    let active_only = query.active_only.unwrap_or(false);
    let assignable_only = query.assignable_only.unwrap_or(false);

    let list_sql = format!(
        r#"SELECT {USER_SELECT_COLUMNS}
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
           ORDER BY is_active DESC, created_at DESC"#
    );
    match sqlx::query(&list_sql)
        .bind(search_pattern)
        .bind(query.role)
        .bind(active_only)
        .bind(assignable_only)
        .fetch_all(&state.db)
        .await
    {
        Ok(rows) => {
            let users: Vec<UserResponse> = rows.iter().map(user_response_from_row).collect();
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

async fn list_staff_directory(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Query(query): Query<ListUsersQuery>,
) -> Result<Json<Vec<StaffDirectoryEntry>>, axum::response::Response> {
    auth.require_any_role(&[Role::Ceo, Role::Concierge])?;

    let search_pattern = format!("%{}%", query.search.unwrap_or_default());
    let rows = sqlx::query(
        r#"SELECT id, email, name, role
           FROM users
           WHERE is_active = true
             AND role IN ('ceo', 'concierge', 'billing')
             AND ($1::text = '%%' OR name ILIKE $1 OR email ILIKE $1)
           ORDER BY name ASC"#,
    )
    .bind(search_pattern)
    .fetch_all(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, "Failed to list staff directory");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to list staff directory",
        )
    })?;

    let entries = rows
        .into_iter()
        .map(|row| StaffDirectoryEntry {
            id: row.try_get("id").unwrap_or_else(|_| Uuid::nil()),
            email: row.try_get("email").unwrap_or_default(),
            name: row.try_get("name").unwrap_or_default(),
            role: row.try_get("role").unwrap_or_default(),
        })
        .collect::<Vec<_>>();

    Ok(Json(entries))
}

async fn get_user(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(user_id): Path<Uuid>,
) -> impl IntoResponse {
    auth.require_capability(Capability::UsersView)?;

    let detail_sql = format!("SELECT {USER_SELECT_COLUMNS} FROM users WHERE users.id = $1");
    match sqlx::query(&detail_sql)
        .bind(user_id)
        .fetch_optional(&state.db)
        .await
    {
        Ok(Some(r)) => Ok(Json(user_response_from_row(&r))),
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
    auth.require_capability(Capability::UsersManage)?;
    ensure_can_assign_role(&auth, &body.role)?;

    if let Err(msg) = validate_create(&body) {
        return Err(err(StatusCode::UNPROCESSABLE_ENTITY, msg));
    }

    if email_is_blocked_external_staff(&state.db, &body.email).await {
        return Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "External contractors cannot be created as user accounts",
        ));
    }

    // Without a password the account is onboarded with a one-time password:
    // it is returned once to the administrator, who hands it over out of
    // band (no SMTP), and the person replaces it at the first login.
    let (password, one_time) = match body.password {
        Some(password) => (password, false),
        None => (password_policy::generate_one_time_password(), true),
    };
    let hash = match password::hash_password(&password) {
        Ok(h) => h,
        Err(e) => {
            tracing::error!(error = %e, "Failed to hash password");
            return Err(err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to create user",
            ));
        }
    };

    let insert_sql = format!(
        r#"WITH inserted AS (
               INSERT INTO users (email, password_hash, name, role, password_reset_required)
               VALUES ($1, $2, $3, $4, $5)
               RETURNING *
           )
           SELECT {USER_SELECT_COLUMNS} FROM inserted AS users"#
    );
    match sqlx::query(&insert_sql)
        .bind(&body.email)
        .bind(hash)
        .bind(&body.name)
        .bind(&body.role)
        .bind(one_time)
        .fetch_one(&state.db)
        .await
    {
        Ok(row) => {
            let mut created = user_response_from_row(&row);
            tracing::info!(
                created_by = %auth.user_id,
                new_user = %created.id,
                role = %body.role,
                one_time_password = one_time,
                "User created"
            );

            state.audit_sender.try_send(audit::domain_event(
                "create_user",
                Some(auth.user_id),
                "user",
                Some(created.id),
                serde_json::json!({
                    "role": body.role,
                    "email": body.email,
                    "one_time_password": one_time,
                    "password_reset_required": created.password_reset_required,
                }),
            ));
            crate::realtime::publish_admin_event(
                &state,
                Some(auth.user_id),
                "user.created",
                "user",
                created.id,
                serde_json::json!({
                    "role": created.role.clone(),
                    "email": created.email.clone(),
                }),
            )
            .await;

            if one_time {
                created.one_time_password = Some(password);
            }
            Ok((StatusCode::CREATED, Json(created)))
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
    ensure_can_manage_target(&state, &auth, user_id).await?;
    if let Some(ref role) = body.role {
        ensure_can_assign_role(&auth, role)?;
    }

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

    let mut tx = state.db.begin().await.map_err(|e| {
        tracing::error!(error = %e, user_id = %user_id, "Failed to start user update transaction");
        err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to update user")
    })?;

    let current =
        sqlx::query("SELECT name, role, email, is_active FROM users WHERE id = $1 FOR UPDATE")
            .bind(user_id)
            .fetch_optional(&mut *tx)
            .await
            .map_err(|e| {
                tracing::error!(error = %e, "DB error");
                err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to update user")
            })?
            .ok_or_else(|| err(StatusCode::NOT_FOUND, "User not found"))?;

    let current_name: String = current
        .try_get("name")
        .map_err(|_| err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to update user"))?;
    let current_role: String = current
        .try_get("role")
        .map_err(|_| err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to update user"))?;
    let current_email: String = current
        .try_get("email")
        .map_err(|_| err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to update user"))?;
    let new_name = body.name.as_deref().unwrap_or(&current_name);
    let new_role = body.role.as_deref().unwrap_or(&current_role);
    let new_email = body.email.as_deref().unwrap_or(&current_email);
    let role_changed = new_role != current_role.as_str();

    if role_changed && current_role == "ceo" {
        let current_is_active: bool = current.try_get("is_active").unwrap_or(false);
        let other_active_ceos = count_other_active_ceos(&mut *tx, user_id)
            .await
            .map_err(|e| {
                tracing::error!(error = %e, user_id = %user_id, "Failed to count active CEO accounts");
                err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to update user")
            })?;
        if would_remove_last_ceo(&current_role, current_is_active, other_active_ceos) {
            return Err(last_ceo_protected());
        }
    }

    let row = sqlx::query(
        r#"UPDATE users
           SET name = $2,
               role = $3,
               email = $4,
               access_revision = access_revision + CASE WHEN $5 THEN 1 ELSE 0 END
           WHERE id = $1
           RETURNING id, email, name, role, is_active, failed_login_attempts, locked_until,
                     password_changed_at, password_reset_required, created_at, updated_at"#,
    )
    .bind(user_id)
    .bind(new_name)
    .bind(new_role)
    .bind(new_email)
    .bind(role_changed)
    .fetch_one(&mut *tx)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, user_id = %user_id, "Failed to update user");
        if e.to_string().contains("unique") {
            err(StatusCode::CONFLICT, "Email already exists")
        } else {
            err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to update user")
        }
    })?;

    let mut revoked_profile_assignments = 0_u64;
    let mut revoked_direct_rules = 0_u64;
    if role_changed {
        sqlx::query(
            "UPDATE pending_logins SET status = 'rejected', resolved_at = now()
             WHERE user_id = $1 AND status IN ('pending', 'approved')",
        )
        .bind(user_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| {
            tracing::error!(error = %e, user_id = %user_id, "Failed to reject pending logins after role change");
            err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to update user")
        })?;

        revoked_profile_assignments = sqlx::query(
            r#"UPDATE staff_access_profile_assignments
               SET revoked_at = now(), revoked_by = $2
               WHERE user_id = $1 AND revoked_at IS NULL"#,
        )
        .bind(user_id)
        .bind(auth.user_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| {
            tracing::error!(error = %e, user_id = %user_id, "Failed to revoke access profile after role change");
            err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to update user")
        })?
        .rows_affected();

        revoked_direct_rules = sqlx::query(
            r#"UPDATE staff_user_access_rules
               SET revoked_at = now(), revoked_by = $2
               WHERE user_id = $1 AND revoked_at IS NULL"#,
        )
        .bind(user_id)
        .bind(auth.user_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| {
            tracing::error!(error = %e, user_id = %user_id, "Failed to revoke direct access after role change");
            err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to update user")
        })?
        .rows_affected();
    }

    // The session and second-factor summary is not part of the RETURNING row;
    // the list endpoint refreshes it.
    let response = user_response_from_row(&row);

    tx.commit().await.map_err(|e| {
        tracing::error!(error = %e, user_id = %user_id, "Failed to commit user update");
        err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to update user")
    })?;

    if role_changed {
        crate::auth::tokens::revoke_all_families(&state.db, user_id, "user_role_changed").await;
    }
    let audit_action = if role_changed {
        "revoke_user_resource_access_on_role_change"
    } else {
        "update_user"
    };
    state.audit_sender.try_send(audit::domain_diff_event(
        audit_action,
        Some(auth.user_id),
        "user",
        Some(user_id),
        serde_json::json!({
            "name": current_name,
            "role": current_role,
            "email": current_email,
        }),
        serde_json::json!({
            "name": response.name,
            "role": response.role,
            "email": response.email,
            "revoked_profile_assignments": revoked_profile_assignments,
            "revoked_direct_rules": revoked_direct_rules,
        }),
    ));
    crate::realtime::publish_admin_event(
        &state,
        Some(auth.user_id),
        "user.updated",
        "user",
        user_id,
        serde_json::json!({
            "role": response.role.clone(),
            "email": response.email.clone(),
        }),
    )
    .await;

    Ok(Json(response))
}

async fn deactivate_user(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(user_id): Path<Uuid>,
) -> impl IntoResponse {
    ensure_can_manage_target(&state, &auth, user_id).await?;

    if user_id == auth.user_id {
        return Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Cannot deactivate yourself",
        ));
    }

    let target = sqlx::query("SELECT role, is_active FROM users WHERE id = $1")
        .bind(user_id)
        .fetch_optional(&state.db)
        .await
        .map_err(|e| {
            tracing::error!(error = %e, "Failed to load user before deactivation");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to deactivate user",
            )
        })?;
    if let Some(target) = target {
        let target_role: String = target.try_get("role").unwrap_or_default();
        let target_is_active: bool = target.try_get("is_active").unwrap_or(false);
        let other_active_ceos = count_other_active_ceos(&state.db, user_id)
            .await
            .map_err(|e| {
                tracing::error!(error = %e, "Failed to count active CEO accounts");
                err(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Failed to deactivate user",
                )
            })?;
        if would_remove_last_ceo(&target_role, target_is_active, other_active_ceos) {
            return Err(last_ceo_protected());
        }
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
            state.audit_sender.try_send(audit::domain_event(
                "deactivate_user",
                Some(auth.user_id),
                "user",
                Some(user_id),
                serde_json::json!({ "sessions_revoked": true }),
            ));
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
    ensure_can_manage_target(&state, &auth, user_id).await?;

    let result = sqlx::query!(
        "UPDATE users SET is_active = true WHERE id = $1 AND is_active = false",
        user_id
    )
    .execute(&state.db)
    .await;

    match result {
        Ok(r) if r.rows_affected() > 0 => {
            tracing::info!(by = %auth.user_id, target = %user_id, "User activated");
            state.audit_sender.try_send(audit::domain_event(
                "activate_user",
                Some(auth.user_id),
                "user",
                Some(user_id),
                serde_json::json!({}),
            ));
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

async fn unlock_user(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(user_id): Path<Uuid>,
) -> impl IntoResponse {
    ensure_can_manage_target(&state, &auth, user_id).await?;

    let result = sqlx::query(
        r#"UPDATE users
           SET failed_login_attempts = 0,
               locked_until = NULL,
               updated_at = now()
           WHERE id = $1
             AND (failed_login_attempts > 0 OR locked_until IS NOT NULL)"#,
    )
    .bind(user_id)
    .execute(&state.db)
    .await;

    match result {
        Ok(row) if row.rows_affected() > 0 => {
            state.audit_sender.try_send(audit::domain_event(
                "unlock_user",
                Some(auth.user_id),
                "user",
                Some(user_id),
                serde_json::json!({ "source": "users_workspace" }),
            ));
            crate::realtime::publish_admin_event(
                &state,
                Some(auth.user_id),
                "user.unlocked",
                "user",
                user_id,
                serde_json::json!({ "user_id": user_id }),
            )
            .await;
            Ok(StatusCode::NO_CONTENT)
        }
        Ok(_) => {
            let exists =
                sqlx::query_scalar::<_, bool>("SELECT EXISTS(SELECT 1 FROM users WHERE id = $1)")
                    .bind(user_id)
                    .fetch_one(&state.db)
                    .await
                    .unwrap_or(false);
            if exists {
                Ok(StatusCode::NO_CONTENT)
            } else {
                Err(err(StatusCode::NOT_FOUND, "User not found"))
            }
        }
        Err(error) => {
            tracing::error!(%error, target = %user_id, "Failed to unlock user");
            Err(err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to unlock user",
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
    ensure_can_manage_target(&state, &auth, user_id).await?;

    // An administrator reset always hands over a temporary password: the
    // person must replace it at the next login (Stage 1's forced change).
    let (new_password, generated) = resolve_reset_password(body);
    match password_policy::replace_password(&state.db, user_id, &new_password, true).await {
        Ok(()) => {}
        Err(password_policy::PasswordChangeError::Rejected(message)) => {
            return Err(err(StatusCode::UNPROCESSABLE_ENTITY, message));
        }
        Err(password_policy::PasswordChangeError::NotFound) => {
            return Err(err(StatusCode::NOT_FOUND, "User not found"));
        }
        Err(password_policy::PasswordChangeError::Internal) => {
            return Err(err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to reset password",
            ));
        }
    }

    let _ = sqlx::query(
        "UPDATE pending_logins SET status = 'rejected', resolved_at = now()
         WHERE user_id = $1 AND status IN ('pending', 'approved')",
    )
    .bind(user_id)
    .execute(&state.db)
    .await;
    crate::auth::tokens::revoke_all_families(&state.db, user_id, "password_reset").await;
    state.audit_sender.try_send(audit::domain_event(
        "reset_password",
        Some(auth.user_id),
        "user",
        Some(user_id),
        serde_json::json!({
            "sessions_revoked": true,
            "account_unlocked": true,
            "one_time_password": generated,
            "password_reset_required": true,
        }),
    ));
    tracing::info!(by = %auth.user_id, target = %user_id, one_time_password = generated, "Password reset");
    crate::realtime::publish_admin_event(
        &state,
        Some(auth.user_id),
        "user.password_reset",
        "user",
        user_id,
        serde_json::json!({ "user_id": user_id }),
    )
    .await;
    Ok(Json(ResetPasswordResponse {
        password_reset_required: true,
        sessions_revoked: true,
        one_time_password: generated.then_some(new_password),
    }))
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

#[cfg(test)]
mod tests {
    use super::{ResetPasswordRequest, resolve_reset_password, would_remove_last_ceo};
    use crate::auth::password_policy::validate_password_policy;

    #[test]
    fn last_ceo_guard_only_fires_for_the_only_active_ceo() {
        assert!(would_remove_last_ceo("ceo", true, 0));
        assert!(!would_remove_last_ceo("ceo", true, 1));
        assert!(!would_remove_last_ceo("ceo", false, 0));
        assert!(!would_remove_last_ceo("billing", true, 0));
    }

    #[test]
    fn reset_uses_the_supplied_password_unless_generation_is_requested() {
        let (password, generated) = resolve_reset_password(ResetPasswordRequest {
            new_password: Some("Supplied-1!".into()),
            generate: None,
        });
        assert_eq!(password, "Supplied-1!");
        assert!(!generated);

        for request in [
            ResetPasswordRequest {
                new_password: Some("Supplied-1!".into()),
                generate: Some(true),
            },
            ResetPasswordRequest {
                new_password: Some(String::new()),
                generate: None,
            },
            ResetPasswordRequest::default(),
        ] {
            let (password, generated) = resolve_reset_password(request);
            assert!(generated);
            assert_eq!(validate_password_policy(&password), Ok(()));
        }
    }
}
