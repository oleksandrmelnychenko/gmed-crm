use std::collections::HashSet;

use axum::{
    Json, Router,
    extract::{Extension, Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{get, post},
};
use chrono::{DateTime, Utc};
use gmed_domain::{
    access::resource_access::{
        AccessCapability, AccessEffect, ResourceAccessRequest, ResourceType,
        passes_absolute_resource_boundary,
    },
    role::Role,
};
use serde::{Deserialize, Serialize};
use sqlx::{PgPool, Row};
use uuid::Uuid;

use crate::{access::role_db_name, auth::middleware::AuthUser, state::AppState};

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/staff-access/profiles",
            get(list_profiles).post(create_profile),
        )
        .route("/staff-access/profiles/{profile_id}", get(get_profile))
        .route(
            "/staff-access/profiles/{profile_id}/update",
            post(update_profile),
        )
        .route(
            "/staff-access/profiles/{profile_id}/clone",
            post(clone_profile),
        )
        .route("/staff-access/users/{user_id}", get(get_user_access))
        .route(
            "/staff-access/users/{user_id}/update",
            post(update_user_access),
        )
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum ScopeType {
    All,
    Record,
}

impl ScopeType {
    const fn as_str(self) -> &'static str {
        match self {
            Self::All => "all",
            Self::Record => "record",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct RuleInput {
    resource_type: ResourceType,
    scope_type: ScopeType,
    resource_id: Option<Uuid>,
    capability: AccessCapability,
    effect: AccessEffect,
}

#[derive(Debug, Serialize)]
struct RuleResponse {
    resource_type: String,
    scope_type: String,
    resource_id: Option<Uuid>,
    capability: String,
    effect: String,
}

#[derive(Debug, Serialize)]
struct ProfileResponse {
    id: Uuid,
    name: String,
    description: Option<String>,
    is_active: bool,
    version: i64,
    roles: Vec<String>,
    rules: Vec<RuleResponse>,
    assigned_user_count: i64,
}

#[derive(Debug, Deserialize)]
struct CreateProfileRequest {
    name: String,
    #[serde(default)]
    description: Option<String>,
    #[serde(default = "default_true")]
    is_active: bool,
    roles: Vec<Role>,
    rules: Vec<RuleInput>,
}

#[derive(Debug, Deserialize)]
struct UpdateProfileRequest {
    expected_version: i64,
    name: String,
    #[serde(default)]
    description: Option<String>,
    is_active: bool,
    roles: Vec<Role>,
    rules: Vec<RuleInput>,
}

#[derive(Debug, Deserialize)]
struct CloneProfileRequest {
    name: String,
    #[serde(default)]
    description: Option<String>,
}

#[derive(Debug, Serialize)]
struct UserBasicResponse {
    id: Uuid,
    email: String,
    name: String,
    role: String,
    is_active: bool,
}

#[derive(Debug, Serialize)]
struct DirectRuleResponse {
    resource_type: String,
    scope_type: String,
    resource_id: Option<Uuid>,
    capability: String,
    effect: String,
    reason: Option<String>,
    valid_from: DateTime<Utc>,
    valid_until: Option<DateTime<Utc>>,
}

#[derive(Debug, Serialize)]
struct UserAccessResponse {
    user: UserBasicResponse,
    access_revision: i64,
    ceo_full_access: bool,
    profile: Option<ProfileResponse>,
    profile_valid_until: Option<DateTime<Utc>>,
    direct_rules: Vec<DirectRuleResponse>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
struct DirectRuleInput {
    resource_type: ResourceType,
    scope_type: ScopeType,
    resource_id: Option<Uuid>,
    capability: AccessCapability,
    effect: AccessEffect,
    #[serde(default)]
    reason: Option<String>,
    #[serde(default)]
    valid_from: Option<DateTime<Utc>>,
    #[serde(default)]
    valid_until: Option<DateTime<Utc>>,
}

#[derive(Debug, Deserialize)]
struct UpdateUserAccessRequest {
    expected_access_revision: i64,
    profile_id: Option<Uuid>,
    #[serde(default)]
    profile_valid_until: Option<DateTime<Utc>>,
    #[serde(default)]
    direct_rules: Vec<DirectRuleInput>,
}

#[derive(Debug)]
struct PreparedDirectRule {
    resource_type: ResourceType,
    scope_type: ScopeType,
    resource_id: Option<Uuid>,
    capability: AccessCapability,
    effect: AccessEffect,
    reason: Option<String>,
    valid_from: DateTime<Utc>,
    valid_until: Option<DateTime<Utc>>,
}

#[derive(Debug)]
struct UserRow {
    id: Uuid,
    email: String,
    name: String,
    role: String,
    is_active: bool,
    access_revision: i64,
}

async fn list_profiles(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
) -> Response {
    if let Err(response) = auth.require_exact_role(&[Role::Ceo]) {
        return response;
    }

    let ids = match sqlx::query("SELECT id FROM staff_access_profiles ORDER BY lower(name), id")
        .fetch_all(&state.db)
        .await
    {
        Ok(rows) => rows
            .into_iter()
            .filter_map(|row| row.try_get::<Uuid, _>("id").ok())
            .collect::<Vec<_>>(),
        Err(error) => return database_error("Failed to list staff access profiles", error),
    };

    let mut profiles = Vec::with_capacity(ids.len());
    for id in ids {
        match load_profile(&state.db, id).await {
            Ok(Some(profile)) => profiles.push(profile),
            Ok(None) => {}
            Err(error) => return database_error("Failed to load staff access profile", error),
        }
    }

    Json(profiles).into_response()
}

async fn get_profile(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(profile_id): Path<Uuid>,
) -> Response {
    if let Err(response) = auth.require_exact_role(&[Role::Ceo]) {
        return response;
    }

    match load_profile(&state.db, profile_id).await {
        Ok(Some(profile)) => Json(profile).into_response(),
        Ok(None) => err(StatusCode::NOT_FOUND, "Access profile not found"),
        Err(error) => database_error("Failed to load staff access profile", error),
    }
}

async fn create_profile(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Json(body): Json<CreateProfileRequest>,
) -> Response {
    if let Err(response) = auth.require_exact_role(&[Role::Ceo]) {
        return response;
    }

    let (name, description) = match validate_profile_payload(
        &state.db,
        &body.name,
        body.description.as_deref(),
        &body.roles,
        &body.rules,
    )
    .await
    {
        Ok(value) => value,
        Err(response) => return response,
    };

    let mut tx = match state.db.begin().await {
        Ok(tx) => tx,
        Err(error) => return database_error("Failed to start access profile transaction", error),
    };

    let profile_id = match sqlx::query(
        r#"INSERT INTO staff_access_profiles
               (name, description, is_active, created_by, updated_by)
           VALUES ($1, $2, $3, $4, $4)
           RETURNING id"#,
    )
    .bind(&name)
    .bind(&description)
    .bind(body.is_active)
    .bind(auth.user_id)
    .fetch_one(&mut *tx)
    .await
    {
        Ok(row) => match row.try_get::<Uuid, _>("id") {
            Ok(id) => id,
            Err(error) => return database_error("Failed to decode access profile", error.into()),
        },
        Err(error) if is_unique_violation(&error) => {
            return err(
                StatusCode::CONFLICT,
                "An access profile with this name already exists",
            );
        }
        Err(error) => return database_error("Failed to create access profile", error),
    };

    if let Err(error) =
        insert_profile_members(&mut tx, profile_id, auth.user_id, &body.roles, &body.rules).await
    {
        return database_error("Failed to create access profile rules", error);
    }

    let audit_value = serde_json::json!({
        "name": name,
        "description": description,
        "is_active": body.is_active,
        "roles": body.roles,
        "rules": body.rules,
        "version": 1,
    });
    if let Err(error) = insert_audit(
        &mut tx,
        auth.user_id,
        "create_staff_access_profile",
        "staff_access_profile",
        profile_id,
        None,
        Some(audit_value),
    )
    .await
    {
        return database_error("Failed to audit access profile creation", error);
    }

    if let Err(error) = tx.commit().await {
        return database_error("Failed to commit access profile creation", error);
    }

    match load_profile(&state.db, profile_id).await {
        Ok(Some(profile)) => (StatusCode::CREATED, Json(profile)).into_response(),
        Ok(None) => err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Created profile was not found",
        ),
        Err(error) => database_error("Failed to load created access profile", error),
    }
}

async fn update_profile(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(profile_id): Path<Uuid>,
    Json(body): Json<UpdateProfileRequest>,
) -> Response {
    if let Err(response) = auth.require_exact_role(&[Role::Ceo]) {
        return response;
    }
    if body.expected_version < 1 {
        return err(StatusCode::UNPROCESSABLE_ENTITY, "Invalid expected_version");
    }

    let (name, description) = match validate_profile_payload(
        &state.db,
        &body.name,
        body.description.as_deref(),
        &body.roles,
        &body.rules,
    )
    .await
    {
        Ok(value) => value,
        Err(response) => return response,
    };

    let mut tx = match state.db.begin().await {
        Ok(tx) => tx,
        Err(error) => return database_error("Failed to start access profile transaction", error),
    };

    let current = match sqlx::query(
        "SELECT version, name, description, is_active FROM staff_access_profiles WHERE id = $1 FOR UPDATE",
    )
    .bind(profile_id)
    .fetch_optional(&mut *tx)
    .await
    {
        Ok(Some(row)) => row,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Access profile not found"),
        Err(error) => return database_error("Failed to lock access profile", error),
    };
    let current_version = match current.try_get::<i64, _>("version") {
        Ok(version) => version,
        Err(error) => return database_error("Failed to decode access profile", error.into()),
    };
    if current_version != body.expected_version {
        return err(
            StatusCode::CONFLICT,
            "Access profile was changed by another request",
        );
    }
    let compatible_role_names = body
        .roles
        .iter()
        .filter_map(|role| configurable_staff_role_name(*role))
        .map(str::to_owned)
        .collect::<Vec<_>>();
    let has_incompatible_assignment = match sqlx::query_scalar::<_, bool>(
        r#"SELECT EXISTS(
               SELECT 1
               FROM staff_access_profile_assignments assignment
               WHERE assignment.profile_id = $1
                 AND assignment.revoked_at IS NULL
                 AND assignment.valid_from <= now()
                 AND (assignment.valid_until IS NULL OR assignment.valid_until > now())
                 AND NOT (assignment.assigned_for_role = ANY($2::text[]))
           )"#,
    )
    .bind(profile_id)
    .bind(&compatible_role_names)
    .fetch_one(&mut *tx)
    .await
    {
        Ok(value) => value,
        Err(error) => {
            return database_error("Failed to validate assigned profile roles", error);
        }
    };
    if has_incompatible_assignment {
        return err(
            StatusCode::CONFLICT,
            "Access profile is assigned to a user whose role would become incompatible",
        );
    }
    let old_value = serde_json::json!({
        "name": current.try_get::<String, _>("name").ok(),
        "description": current.try_get::<Option<String>, _>("description").ok().flatten(),
        "is_active": current.try_get::<bool, _>("is_active").ok(),
        "version": current_version,
    });

    let new_version = current_version + 1;
    let update_result = sqlx::query(
        r#"UPDATE staff_access_profiles
           SET name = $2,
               description = $3,
               is_active = $4,
               version = $5,
               updated_by = $6
           WHERE id = $1"#,
    )
    .bind(profile_id)
    .bind(&name)
    .bind(&description)
    .bind(body.is_active)
    .bind(new_version)
    .bind(auth.user_id)
    .execute(&mut *tx)
    .await;
    match update_result {
        Ok(_) => {}
        Err(error) if is_unique_violation(&error) => {
            return err(
                StatusCode::CONFLICT,
                "An access profile with this name already exists",
            );
        }
        Err(error) => return database_error("Failed to update access profile", error),
    }

    if let Err(error) = sqlx::query("DELETE FROM staff_access_profile_roles WHERE profile_id = $1")
        .bind(profile_id)
        .execute(&mut *tx)
        .await
    {
        return database_error("Failed to replace access profile roles", error);
    }
    if let Err(error) = sqlx::query("DELETE FROM staff_access_profile_rules WHERE profile_id = $1")
        .bind(profile_id)
        .execute(&mut *tx)
        .await
    {
        return database_error("Failed to replace access profile rules", error);
    }
    if let Err(error) =
        insert_profile_members(&mut tx, profile_id, auth.user_id, &body.roles, &body.rules).await
    {
        return database_error("Failed to replace access profile rules", error);
    }

    if let Err(error) = sqlx::query(
        r#"UPDATE users
           SET access_revision = access_revision + 1
           WHERE id IN (
               SELECT assignment.user_id
               FROM staff_access_profile_assignments assignment
               WHERE assignment.profile_id = $1
                 AND assignment.revoked_at IS NULL
                 AND assignment.valid_from <= now()
                 AND (assignment.valid_until IS NULL OR assignment.valid_until > now())
           )"#,
    )
    .bind(profile_id)
    .execute(&mut *tx)
    .await
    {
        return database_error("Failed to invalidate assigned user access", error);
    }

    let new_value = serde_json::json!({
        "name": name,
        "description": description,
        "is_active": body.is_active,
        "roles": body.roles,
        "rules": body.rules,
        "version": new_version,
    });
    if let Err(error) = insert_audit(
        &mut tx,
        auth.user_id,
        "update_staff_access_profile",
        "staff_access_profile",
        profile_id,
        Some(old_value),
        Some(new_value),
    )
    .await
    {
        return database_error("Failed to audit access profile update", error);
    }

    if let Err(error) = tx.commit().await {
        return database_error("Failed to commit access profile update", error);
    }

    match load_profile(&state.db, profile_id).await {
        Ok(Some(profile)) => Json(profile).into_response(),
        Ok(None) => err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Updated profile was not found",
        ),
        Err(error) => database_error("Failed to load updated access profile", error),
    }
}

async fn clone_profile(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(profile_id): Path<Uuid>,
    Json(body): Json<CloneProfileRequest>,
) -> Response {
    if let Err(response) = auth.require_exact_role(&[Role::Ceo]) {
        return response;
    }
    let name = match normalize_name(&body.name) {
        Ok(name) => name,
        Err(message) => return err(StatusCode::UNPROCESSABLE_ENTITY, message),
    };
    let description = match normalize_description(body.description.as_deref()) {
        Ok(description) => description,
        Err(message) => return err(StatusCode::UNPROCESSABLE_ENTITY, message),
    };

    let mut tx = match state.db.begin().await {
        Ok(tx) => tx,
        Err(error) => return database_error("Failed to start access profile transaction", error),
    };
    let source_active =
        match sqlx::query("SELECT is_active FROM staff_access_profiles WHERE id = $1 FOR SHARE")
            .bind(profile_id)
            .fetch_optional(&mut *tx)
            .await
        {
            Ok(Some(row)) => row.try_get::<bool, _>("is_active").unwrap_or(false),
            Ok(None) => return err(StatusCode::NOT_FOUND, "Access profile not found"),
            Err(error) => return database_error("Failed to load source access profile", error),
        };
    if !source_active {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Inactive access profiles cannot be cloned",
        );
    }

    let cloned_id = match sqlx::query(
        r#"INSERT INTO staff_access_profiles
               (name, description, is_active, created_by, updated_by)
           VALUES ($1, $2, true, $3, $3)
           RETURNING id"#,
    )
    .bind(&name)
    .bind(&description)
    .bind(auth.user_id)
    .fetch_one(&mut *tx)
    .await
    {
        Ok(row) => match row.try_get::<Uuid, _>("id") {
            Ok(id) => id,
            Err(error) => return database_error("Failed to decode cloned profile", error.into()),
        },
        Err(error) if is_unique_violation(&error) => {
            return err(
                StatusCode::CONFLICT,
                "An access profile with this name already exists",
            );
        }
        Err(error) => return database_error("Failed to clone access profile", error),
    };

    if let Err(error) = sqlx::query(
        r#"INSERT INTO staff_access_profile_roles (profile_id, role)
           SELECT $2, role
           FROM staff_access_profile_roles
           WHERE profile_id = $1"#,
    )
    .bind(profile_id)
    .bind(cloned_id)
    .execute(&mut *tx)
    .await
    {
        return database_error("Failed to clone access profile roles", error);
    }
    if let Err(error) = sqlx::query(
        r#"INSERT INTO staff_access_profile_rules
               (profile_id, resource_type, scope_type, resource_id, capability, effect, created_by)
           SELECT $2, resource_type, scope_type, resource_id, capability, effect, $3
           FROM staff_access_profile_rules
           WHERE profile_id = $1"#,
    )
    .bind(profile_id)
    .bind(cloned_id)
    .bind(auth.user_id)
    .execute(&mut *tx)
    .await
    {
        return database_error("Failed to clone access profile rules", error);
    }

    if let Err(error) = insert_audit(
        &mut tx,
        auth.user_id,
        "clone_staff_access_profile",
        "staff_access_profile",
        cloned_id,
        None,
        Some(serde_json::json!({
            "source_profile_id": profile_id,
            "name": name,
            "description": description,
        })),
    )
    .await
    {
        return database_error("Failed to audit access profile clone", error);
    }
    if let Err(error) = tx.commit().await {
        return database_error("Failed to commit access profile clone", error);
    }

    match load_profile(&state.db, cloned_id).await {
        Ok(Some(profile)) => (StatusCode::CREATED, Json(profile)).into_response(),
        Ok(None) => err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Cloned profile was not found",
        ),
        Err(error) => database_error("Failed to load cloned access profile", error),
    }
}

async fn get_user_access(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(user_id): Path<Uuid>,
) -> Response {
    if let Err(response) = auth.require_exact_role(&[Role::Ceo]) {
        return response;
    }

    let user = match load_user_row(&state.db, user_id).await {
        Ok(Some(user)) => user,
        Ok(None) => return err(StatusCode::NOT_FOUND, "User not found"),
        Err(error) => return database_error("Failed to load access target", error),
    };
    if user.role == "patient" {
        return err(
            StatusCode::FORBIDDEN,
            "Patient accounts cannot receive staff resource access",
        );
    }

    match load_user_access(&state.db, user).await {
        Ok(response) => Json(response).into_response(),
        Err(error) => database_error("Failed to load user resource access", error),
    }
}

async fn update_user_access(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(user_id): Path<Uuid>,
    Json(body): Json<UpdateUserAccessRequest>,
) -> Response {
    if let Err(response) = auth.require_exact_role(&[Role::Ceo]) {
        return response;
    }
    if body.expected_access_revision < 0 {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Invalid expected_access_revision",
        );
    }
    if body
        .profile_valid_until
        .is_some_and(|valid_until| valid_until <= Utc::now())
    {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Profile valid_until must be in the future",
        );
    }
    if body.profile_id.is_none() && body.profile_valid_until.is_some() {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "profile_valid_until requires profile_id",
        );
    }

    let initial_user = match load_user_row(&state.db, user_id).await {
        Ok(Some(user)) => user,
        Ok(None) => return err(StatusCode::NOT_FOUND, "User not found"),
        Err(error) => return database_error("Failed to load access target", error),
    };
    let target_role = match validate_mutable_target(&initial_user) {
        Ok(role) => role,
        Err(response) => return response,
    };
    let prepared_rules =
        match prepare_direct_rules(&state.db, target_role, &body.direct_rules).await {
            Ok(rules) => rules,
            Err(response) => return response,
        };

    let mut tx = match state.db.begin().await {
        Ok(tx) => tx,
        Err(error) => return database_error("Failed to start user access transaction", error),
    };
    let locked_user = match sqlx::query(
        r#"SELECT id, email, name, role, is_active, access_revision
           FROM users
           WHERE id = $1
           FOR UPDATE"#,
    )
    .bind(user_id)
    .fetch_optional(&mut *tx)
    .await
    {
        Ok(Some(row)) => match user_from_row(row) {
            Ok(user) => user,
            Err(error) => return database_error("Failed to decode access target", error),
        },
        Ok(None) => return err(StatusCode::NOT_FOUND, "User not found"),
        Err(error) => return database_error("Failed to lock access target", error),
    };
    let locked_role = match validate_mutable_target(&locked_user) {
        Ok(role) => role,
        Err(response) => return response,
    };
    if locked_role != target_role {
        return err(
            StatusCode::CONFLICT,
            "User role changed while access was being edited",
        );
    }
    if locked_user.access_revision != body.expected_access_revision {
        return err(
            StatusCode::CONFLICT,
            "User access was changed by another request",
        );
    }

    let target_role_name = role_db_name(target_role).expect("validated staff role");
    if let Some(profile_id) = body.profile_id {
        let compatibility = match sqlx::query(
            r#"SELECT profile.is_active,
                      EXISTS (
                          SELECT 1
                          FROM staff_access_profile_roles profile_role
                          WHERE profile_role.profile_id = profile.id
                            AND profile_role.role = $2
                      ) AS is_compatible
               FROM staff_access_profiles profile
               WHERE profile.id = $1"#,
        )
        .bind(profile_id)
        .bind(target_role_name)
        .fetch_optional(&mut *tx)
        .await
        {
            Ok(Some(row)) => (
                row.try_get::<bool, _>("is_active").unwrap_or(false),
                row.try_get::<bool, _>("is_compatible").unwrap_or(false),
            ),
            Ok(None) => return err(StatusCode::NOT_FOUND, "Access profile not found"),
            Err(error) => return database_error("Failed to validate access profile", error),
        };
        if !compatibility.0 {
            return err(
                StatusCode::UNPROCESSABLE_ENTITY,
                "Access profile is inactive",
            );
        }
        if !compatibility.1 {
            return err(
                StatusCode::UNPROCESSABLE_ENTITY,
                "Access profile is incompatible with the user's role",
            );
        }
    }

    if let Err(error) = sqlx::query(
        r#"UPDATE staff_access_profile_assignments
           SET revoked_at = now(), revoked_by = $2
           WHERE user_id = $1 AND revoked_at IS NULL"#,
    )
    .bind(user_id)
    .bind(auth.user_id)
    .execute(&mut *tx)
    .await
    {
        return database_error("Failed to replace profile assignment", error);
    }
    if let Some(profile_id) = body.profile_id
        && let Err(error) = sqlx::query(
            r#"INSERT INTO staff_access_profile_assignments
                   (user_id, profile_id, assigned_for_role, assigned_by, valid_until)
               VALUES ($1, $2, $3, $4, $5)"#,
        )
        .bind(user_id)
        .bind(profile_id)
        .bind(target_role_name)
        .bind(auth.user_id)
        .bind(body.profile_valid_until)
        .execute(&mut *tx)
        .await
    {
        return database_error("Failed to assign access profile", error);
    }

    if let Err(error) = sqlx::query(
        r#"UPDATE staff_user_access_rules
           SET revoked_at = now(), revoked_by = $2
           WHERE user_id = $1 AND revoked_at IS NULL"#,
    )
    .bind(user_id)
    .bind(auth.user_id)
    .execute(&mut *tx)
    .await
    {
        return database_error("Failed to replace direct access rules", error);
    }
    for rule in &prepared_rules {
        if let Err(error) = sqlx::query(
            r#"INSERT INTO staff_user_access_rules
                   (user_id, granted_for_role, resource_type, scope_type, resource_id,
                    capability, effect, reason, granted_by, valid_from, valid_until)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)"#,
        )
        .bind(user_id)
        .bind(target_role_name)
        .bind(rule.resource_type.as_str())
        .bind(rule.scope_type.as_str())
        .bind(rule.resource_id)
        .bind(rule.capability.as_str())
        .bind(effect_str(rule.effect))
        .bind(&rule.reason)
        .bind(auth.user_id)
        .bind(rule.valid_from)
        .bind(rule.valid_until)
        .execute(&mut *tx)
        .await
        {
            return database_error("Failed to insert direct access rule", error);
        }
    }

    let new_revision = match sqlx::query(
        r#"UPDATE users
           SET access_revision = access_revision + 1
           WHERE id = $1 AND access_revision = $2
           RETURNING access_revision"#,
    )
    .bind(user_id)
    .bind(body.expected_access_revision)
    .fetch_optional(&mut *tx)
    .await
    {
        Ok(Some(row)) => match row.try_get::<i64, _>("access_revision") {
            Ok(revision) => revision,
            Err(error) => return database_error("Failed to decode access revision", error.into()),
        },
        Ok(None) => {
            return err(
                StatusCode::CONFLICT,
                "User access was changed by another request",
            );
        }
        Err(error) => return database_error("Failed to update access revision", error),
    };

    if let Err(error) = insert_audit(
        &mut tx,
        auth.user_id,
        "update_staff_user_access",
        "user",
        user_id,
        Some(serde_json::json!({
            "access_revision": locked_user.access_revision,
        })),
        Some(serde_json::json!({
            "access_revision": new_revision,
            "profile_id": body.profile_id,
            "profile_valid_until": body.profile_valid_until,
            "direct_rules": body.direct_rules,
        })),
    )
    .await
    {
        return database_error("Failed to audit user access update", error);
    }

    if let Err(error) = tx.commit().await {
        return database_error("Failed to commit user access update", error);
    }

    match load_user_row(&state.db, user_id).await {
        Ok(Some(user)) => match load_user_access(&state.db, user).await {
            Ok(response) => Json(response).into_response(),
            Err(error) => database_error("Failed to load updated user access", error),
        },
        Ok(None) => err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Updated user was not found",
        ),
        Err(error) => database_error("Failed to load updated access target", error),
    }
}

async fn validate_profile_payload(
    pool: &PgPool,
    raw_name: &str,
    raw_description: Option<&str>,
    roles: &[Role],
    rules: &[RuleInput],
) -> Result<(String, Option<String>), Response> {
    let name = normalize_name(raw_name)
        .map_err(|message| err(StatusCode::UNPROCESSABLE_ENTITY, message))?;
    let description = normalize_description(raw_description)
        .map_err(|message| err(StatusCode::UNPROCESSABLE_ENTITY, message))?;
    if roles.is_empty() {
        return Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Access profile must support at least one staff role",
        ));
    }

    let mut role_names = HashSet::new();
    for role in roles {
        let Some(role_name) = configurable_staff_role_name(*role) else {
            return Err(err(
                StatusCode::UNPROCESSABLE_ENTITY,
                "Access profiles can only target configurable staff roles",
            ));
        };
        if !role_names.insert(role_name) {
            return Err(err(
                StatusCode::UNPROCESSABLE_ENTITY,
                "Access profile contains duplicate roles",
            ));
        }
    }

    validate_rule_set(pool, rules, roles).await?;
    Ok((name, description))
}

async fn validate_rule_set(
    pool: &PgPool,
    rules: &[RuleInput],
    roles: &[Role],
) -> Result<(), Response> {
    let mut keys = HashSet::new();
    for rule in rules {
        validate_scope(rule.scope_type, rule.resource_id)?;
        validate_capability(rule.resource_type, rule.capability)?;
        let key = (
            rule.resource_type,
            rule.scope_type,
            rule.resource_id,
            rule.capability,
        );
        if !keys.insert(key) {
            return Err(err(
                StatusCode::UNPROCESSABLE_ENTITY,
                "Access rules contain duplicate resource capabilities",
            ));
        }
        let is_medical = validate_resource_reference(pool, rule).await?;
        if rule.effect == AccessEffect::Allow {
            for role in roles {
                let request = ResourceAccessRequest {
                    resource_type: rule.resource_type,
                    resource_id: rule.resource_id.unwrap_or_else(Uuid::nil),
                    capability: rule.capability,
                    // An all-documents allow must be safe for the most sensitive
                    // matching document. Runtime resolution repeats this check.
                    is_medical: is_medical
                        || (rule.resource_type == ResourceType::Document
                            && rule.scope_type == ScopeType::All),
                };
                if !passes_absolute_resource_boundary(*role, &request) {
                    return Err(err(
                        StatusCode::UNPROCESSABLE_ENTITY,
                        "Allow rule crosses an absolute resource access boundary",
                    ));
                }
            }
        }
    }
    Ok(())
}

async fn prepare_direct_rules(
    pool: &PgPool,
    role: Role,
    rules: &[DirectRuleInput],
) -> Result<Vec<PreparedDirectRule>, Response> {
    let now = Utc::now();
    let mut keys = HashSet::new();
    let mut prepared = Vec::with_capacity(rules.len());
    for rule in rules {
        validate_scope(rule.scope_type, rule.resource_id)?;
        validate_capability(rule.resource_type, rule.capability)?;
        let key = (
            rule.resource_type,
            rule.scope_type,
            rule.resource_id,
            rule.capability,
        );
        if !keys.insert(key) {
            return Err(err(
                StatusCode::UNPROCESSABLE_ENTITY,
                "Direct access rules contain duplicate resource capabilities",
            ));
        }
        let reason = normalize_description(rule.reason.as_deref())
            .map_err(|message| err(StatusCode::UNPROCESSABLE_ENTITY, message))?;
        let valid_from = rule.valid_from.unwrap_or(now);
        if rule
            .valid_until
            .is_some_and(|valid_until| valid_until <= valid_from)
        {
            return Err(err(
                StatusCode::UNPROCESSABLE_ENTITY,
                "Rule valid_until must be later than valid_from",
            ));
        }
        if rule
            .valid_until
            .is_some_and(|valid_until| valid_until <= now)
        {
            return Err(err(
                StatusCode::UNPROCESSABLE_ENTITY,
                "Rule valid_until must be in the future",
            ));
        }

        let base = RuleInput {
            resource_type: rule.resource_type,
            scope_type: rule.scope_type,
            resource_id: rule.resource_id,
            capability: rule.capability,
            effect: rule.effect,
        };
        let is_medical = validate_resource_reference(pool, &base).await?;
        if rule.effect == AccessEffect::Allow {
            let request = ResourceAccessRequest {
                resource_type: rule.resource_type,
                resource_id: rule.resource_id.unwrap_or_else(Uuid::nil),
                capability: rule.capability,
                is_medical: is_medical
                    || (rule.resource_type == ResourceType::Document
                        && rule.scope_type == ScopeType::All),
            };
            if !passes_absolute_resource_boundary(role, &request) {
                return Err(err(
                    StatusCode::UNPROCESSABLE_ENTITY,
                    "Allow rule crosses an absolute resource access boundary",
                ));
            }
        }

        prepared.push(PreparedDirectRule {
            resource_type: rule.resource_type,
            scope_type: rule.scope_type,
            resource_id: rule.resource_id,
            capability: rule.capability,
            effect: rule.effect,
            reason,
            valid_from,
            valid_until: rule.valid_until,
        });
    }
    Ok(prepared)
}

fn validate_scope(scope_type: ScopeType, resource_id: Option<Uuid>) -> Result<(), Response> {
    match (scope_type, resource_id) {
        (ScopeType::All, None) | (ScopeType::Record, Some(_)) => Ok(()),
        (ScopeType::All, Some(_)) => Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "all scope must not include resource_id",
        )),
        (ScopeType::Record, None) => Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "record scope requires resource_id",
        )),
    }
}

fn validate_capability(
    resource_type: ResourceType,
    capability: AccessCapability,
) -> Result<(), Response> {
    let allowed = match resource_type {
        ResourceType::Provider | ResourceType::Patient => matches!(
            capability,
            AccessCapability::View | AccessCapability::Use | AccessCapability::Edit
        ),
        ResourceType::Document => matches!(
            capability,
            AccessCapability::View
                | AccessCapability::Use
                | AccessCapability::Edit
                | AccessCapability::Upload
                | AccessCapability::Download
        ),
    };
    if allowed {
        Ok(())
    } else {
        Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Capability is not valid for this resource type",
        ))
    }
}

async fn validate_resource_reference(pool: &PgPool, rule: &RuleInput) -> Result<bool, Response> {
    let Some(resource_id) = rule.resource_id else {
        return Ok(false);
    };

    match rule.resource_type {
        ResourceType::Provider => {
            let exists = sqlx::query_scalar::<_, bool>(
                "SELECT EXISTS(SELECT 1 FROM providers WHERE id = $1)",
            )
            .bind(resource_id)
            .fetch_one(pool)
            .await
            .map_err(|error| database_error("Failed to validate provider resource", error))?;
            if !exists {
                return Err(err(StatusCode::UNPROCESSABLE_ENTITY, "Provider not found"));
            }
            Ok(false)
        }
        ResourceType::Patient => {
            let exists = sqlx::query_scalar::<_, bool>(
                "SELECT EXISTS(SELECT 1 FROM patients WHERE id = $1)",
            )
            .bind(resource_id)
            .fetch_one(pool)
            .await
            .map_err(|error| database_error("Failed to validate patient resource", error))?;
            if !exists {
                return Err(err(StatusCode::UNPROCESSABLE_ENTITY, "Patient not found"));
            }
            Ok(false)
        }
        ResourceType::Document => {
            let medical =
                sqlx::query_scalar::<_, bool>("SELECT is_medical FROM documents WHERE id = $1")
                    .bind(resource_id)
                    .fetch_optional(pool)
                    .await
                    .map_err(|error| {
                        database_error("Failed to validate document resource", error)
                    })?;
            medical.ok_or_else(|| err(StatusCode::UNPROCESSABLE_ENTITY, "Document not found"))
        }
    }
}

async fn insert_profile_members(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    profile_id: Uuid,
    actor_id: Uuid,
    roles: &[Role],
    rules: &[RuleInput],
) -> Result<(), sqlx::Error> {
    for role in roles {
        sqlx::query("INSERT INTO staff_access_profile_roles (profile_id, role) VALUES ($1, $2)")
            .bind(profile_id)
            .bind(configurable_staff_role_name(*role).expect("validated profile role"))
            .execute(&mut **tx)
            .await?;
    }
    for rule in rules {
        sqlx::query(
            r#"INSERT INTO staff_access_profile_rules
                   (profile_id, resource_type, scope_type, resource_id, capability, effect, created_by)
               VALUES ($1, $2, $3, $4, $5, $6, $7)"#,
        )
        .bind(profile_id)
        .bind(rule.resource_type.as_str())
        .bind(rule.scope_type.as_str())
        .bind(rule.resource_id)
        .bind(rule.capability.as_str())
        .bind(effect_str(rule.effect))
        .bind(actor_id)
        .execute(&mut **tx)
        .await?;
    }
    Ok(())
}

async fn load_profile(
    pool: &PgPool,
    profile_id: Uuid,
) -> Result<Option<ProfileResponse>, sqlx::Error> {
    let Some(profile) = sqlx::query(
        r#"SELECT id, name, description, is_active, version,
                  (
                      SELECT count(*)
                      FROM staff_access_profile_assignments assignment
                      WHERE assignment.profile_id = staff_access_profiles.id
                        AND assignment.revoked_at IS NULL
                        AND assignment.valid_from <= now()
                        AND (assignment.valid_until IS NULL OR assignment.valid_until > now())
                  ) AS assigned_user_count
           FROM staff_access_profiles
           WHERE id = $1"#,
    )
    .bind(profile_id)
    .fetch_optional(pool)
    .await?
    else {
        return Ok(None);
    };

    let roles = sqlx::query(
        "SELECT role FROM staff_access_profile_roles WHERE profile_id = $1 ORDER BY role",
    )
    .bind(profile_id)
    .fetch_all(pool)
    .await?
    .into_iter()
    .filter_map(|row| row.try_get::<String, _>("role").ok())
    .collect();

    let rules = sqlx::query(
        r#"SELECT resource_type, scope_type, resource_id, capability, effect
           FROM staff_access_profile_rules
           WHERE profile_id = $1
           ORDER BY resource_type, scope_type, resource_id NULLS FIRST, capability"#,
    )
    .bind(profile_id)
    .fetch_all(pool)
    .await?
    .into_iter()
    .map(|row| {
        Ok(RuleResponse {
            resource_type: row.try_get("resource_type")?,
            scope_type: row.try_get("scope_type")?,
            resource_id: row.try_get("resource_id")?,
            capability: row.try_get("capability")?,
            effect: row.try_get("effect")?,
        })
    })
    .collect::<Result<Vec<_>, sqlx::Error>>()?;

    Ok(Some(ProfileResponse {
        id: profile.try_get("id")?,
        name: profile.try_get("name")?,
        description: profile.try_get("description")?,
        is_active: profile.try_get("is_active")?,
        version: profile.try_get("version")?,
        roles,
        rules,
        assigned_user_count: profile.try_get("assigned_user_count")?,
    }))
}

async fn load_user_row(pool: &PgPool, user_id: Uuid) -> Result<Option<UserRow>, sqlx::Error> {
    let row = sqlx::query(
        r#"SELECT id, email, name, role, is_active, access_revision
           FROM users
           WHERE id = $1"#,
    )
    .bind(user_id)
    .fetch_optional(pool)
    .await?;
    row.map(user_from_row).transpose()
}

fn user_from_row(row: sqlx::postgres::PgRow) -> Result<UserRow, sqlx::Error> {
    Ok(UserRow {
        id: row.try_get("id")?,
        email: row.try_get("email")?,
        name: row.try_get("name")?,
        role: row.try_get("role")?,
        is_active: row.try_get("is_active")?,
        access_revision: row.try_get("access_revision")?,
    })
}

async fn load_user_access(pool: &PgPool, user: UserRow) -> Result<UserAccessResponse, sqlx::Error> {
    let is_ceo = user.role == "ceo";
    let (profile, profile_valid_until) = if is_ceo {
        (None, None)
    } else {
        let assignment = sqlx::query(
            r#"SELECT assignment.profile_id, assignment.valid_until
               FROM staff_access_profile_assignments assignment
               JOIN staff_access_profiles profile
                 ON profile.id = assignment.profile_id
                AND profile.is_active = true
               WHERE assignment.user_id = $1
                 AND assignment.assigned_for_role = $2
                 AND assignment.revoked_at IS NULL
                 AND assignment.valid_from <= now()
                 AND (assignment.valid_until IS NULL OR assignment.valid_until > now())
               LIMIT 1"#,
        )
        .bind(user.id)
        .bind(&user.role)
        .fetch_optional(pool)
        .await?;
        match assignment {
            Some(row) => {
                let profile_id: Uuid = row.try_get("profile_id")?;
                let valid_until: Option<DateTime<Utc>> = row.try_get("valid_until")?;
                (load_profile(pool, profile_id).await?, valid_until)
            }
            None => (None, None),
        }
    };

    let direct_rules = if is_ceo {
        Vec::new()
    } else {
        sqlx::query(
            r#"SELECT resource_type, scope_type, resource_id, capability, effect,
                      reason, valid_from, valid_until
               FROM staff_user_access_rules
               WHERE user_id = $1
                 AND granted_for_role = $2
                 AND revoked_at IS NULL
                 AND valid_from <= now()
                 AND (valid_until IS NULL OR valid_until > now())
               ORDER BY resource_type, scope_type, resource_id NULLS FIRST, capability"#,
        )
        .bind(user.id)
        .bind(&user.role)
        .fetch_all(pool)
        .await?
        .into_iter()
        .map(|row| {
            Ok(DirectRuleResponse {
                resource_type: row.try_get("resource_type")?,
                scope_type: row.try_get("scope_type")?,
                resource_id: row.try_get("resource_id")?,
                capability: row.try_get("capability")?,
                effect: row.try_get("effect")?,
                reason: row.try_get("reason")?,
                valid_from: row.try_get("valid_from")?,
                valid_until: row.try_get("valid_until")?,
            })
        })
        .collect::<Result<Vec<_>, sqlx::Error>>()?
    };

    Ok(UserAccessResponse {
        user: UserBasicResponse {
            id: user.id,
            email: user.email,
            name: user.name,
            role: user.role,
            is_active: user.is_active,
        },
        access_revision: user.access_revision,
        ceo_full_access: is_ceo,
        profile,
        profile_valid_until,
        direct_rules,
    })
}

fn validate_mutable_target(user: &UserRow) -> Result<Role, Response> {
    if !user.is_active {
        return Err(err(StatusCode::UNPROCESSABLE_ENTITY, "User is inactive"));
    }
    let role = role_from_db(&user.role).ok_or_else(|| {
        err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "User has an unsupported role",
        )
    })?;
    match role {
        Role::Ceo => Err(err(StatusCode::FORBIDDEN, "CEO access cannot be modified")),
        Role::Patient => Err(err(
            StatusCode::FORBIDDEN,
            "Patient accounts cannot receive staff resource access",
        )),
        role if configurable_staff_role_name(role).is_some() => Ok(role),
        _ => Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "User has an unsupported role",
        )),
    }
}

async fn insert_audit(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    actor_id: Uuid,
    action: &str,
    entity_type: &str,
    entity_id: Uuid,
    old_value: Option<serde_json::Value>,
    new_value: Option<serde_json::Value>,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"INSERT INTO audit_log
               (user_id, action, entity_type, entity_id, old_value, new_value, context)
           VALUES ($1, $2, $3, $4, $5, $6, $7)"#,
    )
    .bind(actor_id)
    .bind(action)
    .bind(entity_type)
    .bind(entity_id)
    .bind(old_value)
    .bind(new_value)
    .bind(serde_json::json!({"source": "staff_access_api"}))
    .execute(&mut **tx)
    .await?;
    Ok(())
}

fn normalize_name(value: &str) -> Result<String, &'static str> {
    let value = value.trim();
    if value.is_empty() || value.chars().count() > 160 {
        return Err("Profile name must be 1-160 characters");
    }
    Ok(value.to_string())
}

fn normalize_description(value: Option<&str>) -> Result<Option<String>, &'static str> {
    let value = value.map(str::trim).filter(|value| !value.is_empty());
    if value.is_some_and(|value| value.chars().count() > 2000) {
        return Err("Description must not exceed 2000 characters");
    }
    Ok(value.map(str::to_string))
}

fn configurable_staff_role_name(role: Role) -> Option<&'static str> {
    match role {
        Role::Ceo | Role::Patient => None,
        role => role_db_name(role),
    }
}

fn role_from_db(value: &str) -> Option<Role> {
    match value {
        "ceo" => Some(Role::Ceo),
        "ceo_assistant" => Some(Role::CeoAssistant),
        "patient_manager" => Some(Role::PatientManager),
        "teamlead_interpreter" => Some(Role::TeamleadInterpreter),
        "interpreter" => Some(Role::Interpreter),
        "concierge" => Some(Role::Concierge),
        "billing" => Some(Role::Billing),
        "sales" => Some(Role::Sales),
        "it_admin" => Some(Role::ItAdmin),
        "patient" => Some(Role::Patient),
        _ => None,
    }
}

const fn effect_str(effect: AccessEffect) -> &'static str {
    match effect {
        AccessEffect::Allow => "allow",
        AccessEffect::Deny => "deny",
    }
}

const fn default_true() -> bool {
    true
}

fn is_unique_violation(error: &sqlx::Error) -> bool {
    matches!(
        error,
        sqlx::Error::Database(database) if database.code().as_deref() == Some("23505")
    )
}

fn database_error(context: &str, error: sqlx::Error) -> Response {
    tracing::error!(error = %error, "{context}");
    err(StatusCode::INTERNAL_SERVER_ERROR, "Database error")
}

fn err(status: StatusCode, message: &str) -> Response {
    (
        status,
        Json(serde_json::json!({
            "error": status.canonical_reason().unwrap_or("error"),
            "message": message,
        })),
    )
        .into_response()
}
