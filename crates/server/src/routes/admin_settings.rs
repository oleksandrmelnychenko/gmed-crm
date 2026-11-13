use axum::{
    Json, Router,
    extract::{Extension, Path, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
};
use chrono::{DateTime, NaiveDate, Utc};
use serde::Deserialize;
use sqlx::Row;
use uuid::Uuid;

use crate::audit;
use crate::auth::middleware::AuthUser;
use crate::auth::tokens;
use crate::settings;
use crate::state::AppState;
use gmed_domain::access::capabilities::Capability;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/admin/settings", get(list_settings))
        .route("/admin/settings/{key}", post(update_setting))
        .route("/admin/sessions", get(list_all_sessions))
        .route(
            "/admin/sessions/user/{user_id}/revoke",
            post(revoke_user_sessions),
        )
        .route("/admin/sessions/revoke-all", post(revoke_all_sessions))
        .route("/admin/activity", get(list_activity))
        .route("/admin/activity/actions", get(list_activity_actions))
        .route("/admin/mfa/pending", get(list_pending_logins))
        .route(
            "/admin/mfa/pending/{pending_id}/approve",
            post(approve_pending),
        )
        .route(
            "/admin/mfa/pending/{pending_id}/reject",
            post(reject_pending),
        )
        .route("/admin/mfa/user/{user_id}/toggle", post(toggle_mfa))
}

// ── Settings ────────────────────────────────────────────────

async fn list_settings(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
) -> axum::response::Response {
    if let Err(e) = auth.require_capability(Capability::AdminSettings) {
        return e;
    }

    match settings::list_all(&state.db, can_change_business_settings(&auth)).await {
        Ok(rows) => Json(rows).into_response(),
        Err(e) => {
            tracing::error!(error = %e, "list settings");
            err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to list settings")
        }
    }
}

#[derive(Deserialize)]
struct UpdateSettingRequest {
    value: String,
}

/// Business and legal settings (agency profile and bank account, tax data,
/// retention and access periods, document rules) belong to the CEO; the IT
/// admin changes the technical ones (`settings::TECHNICAL_SETTING_KEYS`).
fn can_change_business_settings(auth: &AuthUser) -> bool {
    auth.role.has_full_access()
}

async fn update_setting(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(key): Path<String>,
    Json(body): Json<UpdateSettingRequest>,
) -> axum::response::Response {
    if let Err(e) = auth.require_capability(Capability::AdminSettings) {
        return e;
    }
    match settings::is_listed_setting(&state.db, &key).await {
        Ok(true) => {}
        Ok(false) => return err(StatusCode::NOT_FOUND, "Setting not found"),
        Err(e) => {
            tracing::error!(error = %e, "look up setting");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to update setting",
            );
        }
    }
    if !settings::is_technical_setting(&key) && !can_change_business_settings(&auth) {
        return (
            StatusCode::FORBIDDEN,
            Json(serde_json::json!({
                "error": "business_setting_ceo_only",
                "message": "Business and legal settings are changed by the CEO",
            })),
        )
            .into_response();
    }

    match settings::update_setting(&state.db, &key, &body.value, auth.user_id).await {
        Ok(()) => {
            // Reload cached settings
            state.settings.reload(&state.db).await;
            tracing::info!(by = %auth.user_id, key = %key, value = %body.value, "Setting updated");
            crate::realtime::publish_admin_event(
                &state,
                Some(auth.user_id),
                "system_setting.updated",
                "system_setting",
                auth.user_id,
                serde_json::json!({ "key": key }),
            )
            .await;
            Json(serde_json::json!({ "ok": true })).into_response()
        }
        Err(settings::UpdateError::InvalidValue(msg)) => {
            err(StatusCode::UNPROCESSABLE_ENTITY, &msg)
        }
        Err(settings::UpdateError::NotFound) => err(StatusCode::NOT_FOUND, "Setting not found"),
        Err(settings::UpdateError::Db(msg)) => {
            tracing::error!(error = %msg, "update setting");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to update setting",
            )
        }
    }
}

// ── Session management (admin force-logout) ─────────────────

/// What an "active session" is, the one definition behind /admin/health, the
/// sessions tab of /admin/settings and the IT admin dashboard (QA 2026-11-12
/// S3-4: they showed 500, 200 and 242): a sign-in (token family) that is not
/// revoked — the session sweeper revokes idle and expired ones. Portal logins
/// of patients and leads count only for a reader who sees patients, as in
/// the session list. `$1` is that permission.
const ACTIVE_SESSIONS_FROM_WHERE: &str = r#"FROM token_families tf
           JOIN users u ON u.id = tf.user_id
           WHERE NOT tf.is_revoked
             AND ($1::bool OR u.role <> 'patient')"#;

/// The number of active sessions (see `ACTIVE_SESSIONS_FROM_WHERE`).
pub(crate) async fn count_active_sessions(
    db: &gmed_db::DbPool,
    include_portal_accounts: bool,
) -> Result<i64, sqlx::Error> {
    sqlx::query_scalar::<_, i64>(&format!(
        "SELECT count(*)::bigint {ACTIVE_SESSIONS_FROM_WHERE}"
    ))
    .bind(include_portal_accounts)
    .fetch_one(db)
    .await
}

#[derive(Deserialize)]
struct SessionsQuery {
    offset: Option<i64>,
    limit: Option<i64>,
}

/// Rows of one page of the active sessions list when the caller names none.
const SESSIONS_PAGE_DEFAULT: i64 = 50;
/// The largest page of the active sessions list.
const SESSIONS_PAGE_MAX: i64 = 200;

/// `(offset, limit)` of a sessions page: offset at least 0, limit 1..=200
/// (50 when absent).
fn sessions_page(query: &SessionsQuery) -> (i64, i64) {
    (
        query.offset.unwrap_or(0).max(0),
        query
            .limit
            .unwrap_or(SESSIONS_PAGE_DEFAULT)
            .clamp(1, SESSIONS_PAGE_MAX),
    )
}

async fn list_all_sessions(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    axum::extract::Query(query): axum::extract::Query<SessionsQuery>,
) -> axum::response::Response {
    if let Err(e) = auth.require_capability(Capability::AdminSessions) {
        return e;
    }

    // Sessions of patient and lead portal logins are patient data: only a role
    // that sees patients lists them (QA E-05).
    let include_portal_accounts = super::users::can_see_portal_accounts(&auth);
    // One page with the total (security review 2026-11-13, final-D S3-4: the
    // whole list grew without bound with the portal logins). The total is
    // the number of /admin/health (QA 2026-11-12 S3-4).
    let (offset, limit) = sessions_page(&query);
    let total = match count_active_sessions(&state.db, include_portal_accounts).await {
        Ok(total) => total,
        Err(e) => {
            tracing::error!(error = %e, "count active sessions");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };
    match sqlx::query(&format!(
        r#"SELECT tf.id AS family_id, tf.user_id, u.name AS user_name, u.email AS user_email, u.role,
                  tf.device_fingerprint, tf.ip_address, tf.user_agent,
                  tf.created_at, tf.last_activity_at
           {ACTIVE_SESSIONS_FROM_WHERE}
           ORDER BY tf.last_activity_at DESC, tf.id
           LIMIT $2 OFFSET $3"#
    ))
    .bind(include_portal_accounts)
    .bind(limit)
    .bind(offset)
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => {
            let sessions: Vec<serde_json::Value> = rows
                .into_iter()
                .map(|r| {
                    serde_json::json!({
                        "family_id": r.try_get::<Uuid, _>("family_id").unwrap_or_default(),
                        "user_id": r.try_get::<Uuid, _>("user_id").unwrap_or_default(),
                        "user_name": r.try_get::<String, _>("user_name").unwrap_or_default(),
                        "user_email": r.try_get::<String, _>("user_email").unwrap_or_default(),
                        "role": r.try_get::<String, _>("role").unwrap_or_default(),
                        "device_fingerprint": r.try_get::<Option<String>, _>("device_fingerprint").unwrap_or_default(),
                        "ip_address": r.try_get::<Option<String>, _>("ip_address").unwrap_or_default(),
                        "user_agent": r.try_get::<Option<String>, _>("user_agent").unwrap_or_default(),
                        "created_at": r.try_get::<DateTime<Utc>, _>("created_at").ok(),
                        "last_activity_at": r.try_get::<DateTime<Utc>, _>("last_activity_at").ok(),
                    })
                })
                .collect();
            Json(serde_json::json!({
                "items": sessions,
                "total": total,
                "offset": offset,
                "limit": limit,
            }))
            .into_response()
        }
        Err(e) => {
            tracing::error!(error = %e, "list all sessions");
            err(StatusCode::INTERNAL_SERVER_ERROR, "Failed")
        }
    }
}

async fn revoke_user_sessions(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(user_id): Path<Uuid>,
) -> axum::response::Response {
    if let Err(e) = auth.require_capability(Capability::AdminSessions) {
        return e;
    }
    if let Err(e) = super::users::ensure_can_act_on_account(&state, &auth, user_id).await {
        return e;
    }

    tokens::revoke_all_families(
        &state.db,
        user_id,
        &format!("admin_force_logout_by_{}", auth.user_id),
    )
    .await;

    tracing::info!(admin = %auth.user_id, target = %user_id, "Admin force-logout user");

    state.audit_sender.try_send(audit::domain_event(
        "admin_force_logout_user",
        Some(auth.user_id),
        "user",
        Some(user_id),
        serde_json::json!({ "target_user_id": user_id }),
    ));
    crate::realtime::publish_admin_event(
        &state,
        Some(auth.user_id),
        "session.revoked",
        "session",
        user_id,
        serde_json::json!({ "target_user_id": user_id }),
    )
    .await;

    Json(serde_json::json!({ "ok": true, "user_id": user_id })).into_response()
}

async fn revoke_all_sessions(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
) -> axum::response::Response {
    if let Err(e) = auth.require_capability(Capability::AdminSessions) {
        return e;
    }

    // CEO sessions end only for a caller who may manage CEO accounts
    // (`users.manage_ceo`); the technical admin ends everyone else's.
    let include_ceo = auth.can(Capability::UsersManageCeo);
    tokens::revoke_all_users(
        &state.db,
        auth.user_id,
        &format!("admin_global_logout_by_{}", auth.user_id),
        include_ceo,
    )
    .await;

    tracing::warn!(admin = %auth.user_id, include_ceo, "Admin force-logout ALL users");
    crate::realtime::publish_admin_event(
        &state,
        Some(auth.user_id),
        "session.revoked_all",
        "session",
        auth.user_id,
        serde_json::json!({}),
    )
    .await;

    Json(serde_json::json!({ "ok": true, "ceo_sessions_kept": !include_ceo })).into_response()
}

// ── Activity / audit log ─────────────────────────────────────

#[derive(Deserialize)]
struct ActivityQuery {
    user_id: Option<Uuid>,
    action: Option<String>,
    view: Option<String>,
    /// `access`: only account, role and permission changes (see
    /// [`ACCESS_AUDIT_ACTIONS`]). Absent: no extra restriction.
    category: Option<String>,
    search: Option<String>,
    /// Comma-separated action codes whose translated label matches the
    /// search text (the UI knows the labels, QA E3-01): the search also
    /// finds these rows, not only the raw codes.
    search_actions: Option<String>,
    /// Comma-separated entity types whose translated label matches.
    search_entities: Option<String>,
    limit: Option<i64>,
    offset: Option<i64>,
    date_from: Option<String>,
    date_to: Option<String>,
}

/// Codes from a comma-separated list: trimmed, non-empty, plain code
/// characters only, at most 300 of them. `None` without any code.
/// The `action` filter: one stored code or several comma-separated ones.
/// Unlike [`activity_code_list`] nothing is dropped silently, so an unknown
/// code finds no rows instead of lifting the filter.
fn activity_action_filter(raw: Option<&str>) -> Option<Vec<String>> {
    let codes: Vec<String> = raw
        .unwrap_or_default()
        .split(',')
        .map(str::trim)
        .filter(|code| !code.is_empty())
        .take(300)
        .map(str::to_string)
        .collect();
    (!codes.is_empty()).then_some(codes)
}

fn activity_code_list(raw: Option<&str>) -> Option<Vec<String>> {
    let codes: Vec<String> = raw
        .unwrap_or_default()
        .split(',')
        .map(str::trim)
        .filter(|code| {
            !code.is_empty()
                && code.len() <= 120
                && code
                    .chars()
                    .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '_' | '.' | '-'))
        })
        .take(300)
        .map(str::to_string)
        .collect();
    (!codes.is_empty()).then_some(codes)
}

/// Audit actions that change who can sign in and what they may do: the
/// "access and roles" stream CEO and IT Admin review.
pub const ACCESS_AUDIT_ACTIONS: &[&str] = &[
    "create_user",
    "update_user",
    "revoke_user_resource_access_on_role_change",
    "deactivate_user",
    "activate_user",
    "unlock_user",
    "reset_password",
    "totp_reset",
    "toggle_mfa",
    "update_access_policy",
    "reset_access_policies",
    "create_staff_access_profile",
    "update_staff_access_profile",
    "clone_staff_access_profile",
    "update_staff_user_access",
];

/// Entity types whose audit context is technical (accounts, sessions,
/// settings, integrations, incidents). For a reader without full access (the
/// IT admin) every other context is redacted: it can carry patient, lead,
/// medical, financial or AML details — e-mails of leads, sanctions decisions
/// with their reasons (QA E-45, 2026-10-11). The CEO sees everything.
pub const TECHNICAL_AUDIT_ENTITY_TYPES: &[&str] = &[
    "http",
    "auth",
    "security",
    "session",
    "token_family",
    "user",
    "pending_login",
    "system",
    "system_settings",
    "ip_whitelist",
    "announcement",
    "custom_field",
    "notification_channel",
    "mail_connection",
    "signature_connection",
    "signature_settings",
    "datev_connection",
    "datev_setup",
    "field_access_policy",
    "access_policy",
    "staff_access_profile",
    "security_incident",
];

/// The audit context a reader gets: unchanged with full access, otherwise
/// only for technical entity types and never for a portal account.
pub(crate) fn visible_activity_context(
    full_access: bool,
    entity_type: Option<&str>,
    target_is_portal_account: bool,
    context: Option<serde_json::Value>,
) -> Option<serde_json::Value> {
    if full_access {
        return context;
    }
    let technical = entity_type.is_some_and(|value| TECHNICAL_AUDIT_ENTITY_TYPES.contains(&value));
    if technical && !target_is_portal_account {
        context
    } else {
        context.map(|_| serde_json::json!({ "redacted": true }))
    }
}

/// The record id a reader gets: unchanged with full access, otherwise only
/// for technical entity types and never for a portal account. A business
/// record (patient, lead, document, invoice, conversation) is named by no id:
/// the IT admin resolves patient ids in the DSGVO lookup, so the id would tie
/// anonymised portal activity to a named patient (QA final-C S2-C7
/// 2026-11-13, like /admin/audit-analytics).
pub(crate) fn visible_activity_entity_id(
    full_access: bool,
    entity_type: Option<&str>,
    target_is_portal_account: bool,
    entity_id: Option<Uuid>,
) -> Option<Uuid> {
    if full_access {
        return entity_id;
    }
    let technical = entity_type.is_some_and(|value| TECHNICAL_AUDIT_ENTITY_TYPES.contains(&value));
    if technical && !target_is_portal_account {
        entity_id
    } else {
        None
    }
}

fn normalize_activity_view(value: Option<String>) -> Result<String, &'static str> {
    let view = value.unwrap_or_else(|| "activity".to_string());
    match view.as_str() {
        "activity" | "security" | "technical" | "all" => Ok(view),
        _ => Err("Invalid activity view"),
    }
}

/// Maps the optional `category` parameter to the action allow-list it stands
/// for; `None` keeps the unrestricted behaviour.
fn activity_category_actions(value: Option<&str>) -> Result<Option<Vec<String>>, &'static str> {
    match value.map(str::trim).filter(|value| !value.is_empty()) {
        None => Ok(None),
        Some("access") => Ok(Some(
            ACCESS_AUDIT_ACTIONS
                .iter()
                .map(|action| action.to_string())
                .collect(),
        )),
        Some(_) => Err("Invalid activity category"),
    }
}

fn parse_activity_date_start(
    value: Option<String>,
    field_name: &'static str,
) -> Result<Option<DateTime<Utc>>, &'static str> {
    let Some(raw) = value else {
        return Ok(None);
    };
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }

    let date = NaiveDate::parse_from_str(trimmed, "%Y-%m-%d").map_err(|_| match field_name {
        "date_from" => "Invalid date_from (YYYY-MM-DD)",
        _ => "Invalid date_to (YYYY-MM-DD)",
    })?;
    let Some(naive) = date.and_hms_opt(0, 0, 0) else {
        return Err("Invalid activity date");
    };
    Ok(Some(crate::app_time::from_local(naive)))
}

fn parse_activity_date_to_exclusive(
    value: Option<String>,
) -> Result<Option<DateTime<Utc>>, &'static str> {
    let Some(raw) = value else {
        return Ok(None);
    };
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }

    let date = NaiveDate::parse_from_str(trimmed, "%Y-%m-%d")
        .map_err(|_| "Invalid date_to (YYYY-MM-DD)")?;
    let Some(next_day) = date.succ_opt() else {
        return Err("Invalid date_to (YYYY-MM-DD)");
    };
    let Some(naive) = next_day.and_hms_opt(0, 0, 0) else {
        return Err("Invalid activity date");
    };
    Ok(Some(crate::app_time::from_local(naive)))
}

/// The audit rows the activity page counts as data changes (KPI
/// "Datenänderungen 24 h", QA E-14): every meaningful row that writes. A row
/// upgraded from an HTTP request keeps its method; a domain event
/// (`update_lead`, `create_invoice`, ...) has none and counts unless it is a
/// read, a view, an export, a download or a sign-in/session event. A SQL
/// predicate over `action`, `entity_type` and `context` of `audit_log`.
pub const ACTIVITY_DATA_CHANGE_FILTER: &str = r#"(
    action NOT IN ('http_request', 'noop')
    AND entity_type NOT IN ('auth', 'security', 'session', 'token_family')
    AND CASE
            WHEN context ? 'method'
                THEN context->>'method' IN ('POST', 'PUT', 'PATCH', 'DELETE')
            ELSE action !~ '^(read|view|download|export|preview|render|login|refresh|revoke_all|admin_force_logout|token_theft|sessions_expired|datev_read)(_|$)'
        END
)"#;

/// The action codes the log really holds, for the «Действие» filter (screens
/// QA 2026-11-12, E F2: the list offered names nothing was stored under).
/// A loose index scan over `idx_audit_action`, so the large technical stream
/// is not read row by row.
async fn list_activity_actions(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
) -> axum::response::Response {
    if let Err(e) = auth.require_capability(Capability::AdminActivity) {
        return e;
    }
    let codes: Result<Vec<String>, sqlx::Error> = sqlx::query_scalar(
        r#"WITH RECURSIVE codes AS (
               SELECT MIN(action) AS action FROM audit_log
               UNION ALL
               SELECT (SELECT MIN(al.action) FROM audit_log al WHERE al.action > codes.action)
               FROM codes
               WHERE codes.action IS NOT NULL
           )
           SELECT action FROM codes WHERE action IS NOT NULL"#,
    )
    .fetch_all(&state.db)
    .await;
    match codes {
        Ok(codes) => Json(serde_json::json!({ "data": codes })).into_response(),
        Err(e) => {
            tracing::error!(error = %e, "list activity actions");
            err(StatusCode::INTERNAL_SERVER_ERROR, "Failed")
        }
    }
}

async fn list_activity(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    axum::extract::Query(q): axum::extract::Query<ActivityQuery>,
) -> axum::response::Response {
    if let Err(e) = auth.require_capability(Capability::AdminActivity) {
        return e;
    }

    let ActivityQuery {
        user_id,
        action,
        view,
        category,
        search,
        search_actions,
        search_entities,
        limit,
        offset,
        date_from,
        date_to,
    } = q;
    // One code, or several comma-separated codes that share one label in
    // the filter list (screens QA 2026-11-12, E F2/F11).
    let action = activity_action_filter(action.as_deref());
    let view = match normalize_activity_view(view) {
        Ok(value) => value,
        Err(message) => return err(StatusCode::UNPROCESSABLE_ENTITY, message),
    };
    let category_actions = match activity_category_actions(category.as_deref()) {
        Ok(value) => value,
        Err(message) => return err(StatusCode::UNPROCESSABLE_ENTITY, message),
    };
    let search = search
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let (search_actions, search_entities) = if search.is_some() {
        (
            activity_code_list(search_actions.as_deref()),
            activity_code_list(search_entities.as_deref()),
        )
    } else {
        (None, None)
    };
    let limit = limit.unwrap_or(50).clamp(1, 500);
    let offset = offset.unwrap_or(0).max(0);
    let date_from = match parse_activity_date_start(date_from, "date_from") {
        Ok(value) => value,
        Err(message) => return err(StatusCode::UNPROCESSABLE_ENTITY, message),
    };
    let date_to_exclusive = match parse_activity_date_to_exclusive(date_to) {
        Ok(value) => value,
        Err(message) => return err(StatusCode::UNPROCESSABLE_ENTITY, message),
    };
    if let (Some(from), Some(to_exclusive)) = (date_from.as_ref(), date_to_exclusive.as_ref())
        && to_exclusive <= from
    {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "date_to must be on or after date_from",
        );
    }

    // Without full access the search must not find what the reader cannot
    // see: redacted contexts and the names of patient and lead logins.
    let full_access = auth.role.has_full_access();
    let technical_entity_types: Vec<String> = TECHNICAL_AUDIT_ENTITY_TYPES
        .iter()
        .map(|value| value.to_string())
        .collect();

    let total = match sqlx::query(
        r#"SELECT COUNT(*) AS count
           FROM audit_log al
           LEFT JOIN users u ON u.id = al.user_id
           LEFT JOIN users target ON al.entity_type = 'user' AND target.id = al.entity_id
           WHERE ($1::UUID IS NULL OR al.user_id = $1)
             AND ($2::TEXT[] IS NULL OR al.action = ANY($2))
             AND ($3::TIMESTAMPTZ IS NULL OR al.created_at >= $3)
             AND ($4::TIMESTAMPTZ IS NULL OR al.created_at < $4)
             AND (
                 $5 = 'all'
                 OR ($5 = 'activity' AND al.action <> 'http_request')
                 OR ($5 = 'technical' AND al.action = 'http_request')
                 OR ($5 = 'security' AND (
                     al.entity_type IN ('auth', 'security', 'session')
                     OR al.action IN (
                         'login', 'login_success', 'login_failure', 'login_failed',
                         'login_blocked', 'login_mfa_requested',
                         'refresh_token_theft', 'refresh_family_revoked',
                         'token_theft_detected', 'session.revoked',
                         'session.revoked_all', 'admin_force_logout_user',
                         'revoke_all_sessions', 'revoke_all_users_sessions',
                         'pending_login.approved', 'pending_login.rejected',
                         'user.password_reset', 'user.unlocked',
                         'user.force_password_reset', 'user.mfa_toggled'
                     )
                 ))
             )
             AND (
                 $6::TEXT IS NULL
                 OR (
                     ($8::bool OR COALESCE(u.role, '') <> 'patient')
                     AND (u.name ILIKE '%' || $6 || '%' OR u.email ILIKE '%' || $6 || '%')
                 )
                 OR al.action ILIKE '%' || $6 || '%'
                 OR al.entity_type ILIKE '%' || $6 || '%'
                 OR al.action = ANY(COALESCE($10::TEXT[], '{}'::TEXT[]))
                 OR al.entity_type = ANY(COALESCE($11::TEXT[], '{}'::TEXT[]))
                 OR (
                     ($8::bool OR (al.entity_type = ANY($9) AND COALESCE(target.role, '') <> 'patient'))
                     AND COALESCE(al.entity_id::TEXT, '') ILIKE '%' || $6 || '%'
                 )
                 OR (
                     ($8::bool OR COALESCE(target.role, '') <> 'patient')
                     AND (target.name ILIKE '%' || $6 || '%' OR target.email ILIKE '%' || $6 || '%')
                 )
                 OR (
                     (
                         $8::bool
                         OR (al.entity_type = ANY($9) AND COALESCE(target.role, '') <> 'patient')
                     )
                     AND COALESCE(al.context::TEXT, '') ILIKE '%' || $6 || '%'
                 )
             )
             AND ($7::TEXT[] IS NULL OR al.action = ANY($7))"#,
    )
    .bind(user_id)
    .bind(&action)
    .bind(date_from)
    .bind(date_to_exclusive)
    .bind(&view)
    .bind(search)
    .bind(&category_actions)
    .bind(full_access)
    .bind(&technical_entity_types)
    .bind(&search_actions)
    .bind(&search_entities)
    .fetch_one(&state.db)
    .await
    {
        Ok(row) => row.try_get::<i64, _>("count").unwrap_or_default(),
        Err(e) => {
            tracing::error!(error = %e, "count activity");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };

    match sqlx::query(
        // The affected account by name, and the before/after values of an
        // account change (`domain_diff_event` keeps them outside `context`):
        // "user changed" without the changed field and with an id fragment
        // as the object told the reader nothing (QA 2026-11-10, E F-7).
        r#"SELECT al.id, al.user_id, u.name AS user_name, u.email AS user_email,
                  u.role AS actor_role, COALESCE(target.role = 'patient', false) AS target_is_portal,
                  target.name AS target_name, target.email AS target_email,
                  CASE WHEN al.entity_type = 'user' THEN al.old_value END AS old_value,
                  CASE WHEN al.entity_type = 'user' THEN al.new_value END AS new_value,
                  al.action, al.entity_type, al.entity_id, al.context, al.created_at
           FROM audit_log al
           LEFT JOIN users u ON u.id = al.user_id
           LEFT JOIN users target ON al.entity_type = 'user' AND target.id = al.entity_id
           WHERE ($1::UUID IS NULL OR al.user_id = $1)
             AND ($2::TEXT[] IS NULL OR al.action = ANY($2))
             AND ($3::TIMESTAMPTZ IS NULL OR al.created_at >= $3)
             AND ($4::TIMESTAMPTZ IS NULL OR al.created_at < $4)
             AND (
                 $5 = 'all'
                 OR ($5 = 'activity' AND al.action <> 'http_request')
                 OR ($5 = 'technical' AND al.action = 'http_request')
                 OR ($5 = 'security' AND (
                     al.entity_type IN ('auth', 'security', 'session')
                     OR al.action IN (
                         'login', 'login_success', 'login_failure', 'login_failed',
                         'login_blocked', 'login_mfa_requested',
                         'refresh_token_theft', 'refresh_family_revoked',
                         'token_theft_detected', 'session.revoked',
                         'session.revoked_all', 'admin_force_logout_user',
                         'revoke_all_sessions', 'revoke_all_users_sessions',
                         'pending_login.approved', 'pending_login.rejected',
                         'user.password_reset', 'user.unlocked',
                         'user.force_password_reset', 'user.mfa_toggled'
                     )
                 ))
             )
             AND (
                 $6::TEXT IS NULL
                 OR (
                     ($10::bool OR COALESCE(u.role, '') <> 'patient')
                     AND (u.name ILIKE '%' || $6 || '%' OR u.email ILIKE '%' || $6 || '%')
                 )
                 OR al.action ILIKE '%' || $6 || '%'
                 OR al.entity_type ILIKE '%' || $6 || '%'
                 OR al.action = ANY(COALESCE($12::TEXT[], '{}'::TEXT[]))
                 OR al.entity_type = ANY(COALESCE($13::TEXT[], '{}'::TEXT[]))
                 OR (
                     ($10::bool OR (al.entity_type = ANY($11) AND COALESCE(target.role, '') <> 'patient'))
                     AND COALESCE(al.entity_id::TEXT, '') ILIKE '%' || $6 || '%'
                 )
                 OR (
                     ($10::bool OR COALESCE(target.role, '') <> 'patient')
                     AND (target.name ILIKE '%' || $6 || '%' OR target.email ILIKE '%' || $6 || '%')
                 )
                 OR (
                     (
                         $10::bool
                         OR (al.entity_type = ANY($11) AND COALESCE(target.role, '') <> 'patient')
                     )
                     AND COALESCE(al.context::TEXT, '') ILIKE '%' || $6 || '%'
                 )
             )
             AND ($9::TEXT[] IS NULL OR al.action = ANY($9))
           ORDER BY al.created_at DESC LIMIT $7 OFFSET $8"#,
    )
    .bind(user_id)
    .bind(&action)
    .bind(date_from)
    .bind(date_to_exclusive)
    .bind(&view)
    .bind(search)
    .bind(limit)
    .bind(offset)
    .bind(&category_actions)
    .bind(full_access)
    .bind(&technical_entity_types)
    .bind(&search_actions)
    .bind(&search_entities)
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => {
            let summary_sql = format!(
                r#"SELECT
                       COUNT(*) FILTER (
                           WHERE created_at >= now() - interval '24 hours'
                             AND action <> 'http_request'
                       )::BIGINT AS activity_24h,
                       COUNT(DISTINCT user_id) FILTER (
                           WHERE created_at >= now() - interval '24 hours'
                             AND action <> 'http_request'
                       )::BIGINT AS active_users_24h,
                       COUNT(*) FILTER (
                           WHERE created_at >= now() - interval '24 hours'
                             AND {ACTIVITY_DATA_CHANGE_FILTER}
                       )::BIGINT AS changes_24h,
                       COUNT(*) FILTER (
                           WHERE created_at >= now() - interval '24 hours'
                             AND (
                                 entity_type IN ('auth', 'security', 'session')
                                 OR action IN (
                                     'login', 'login_success', 'login_failure', 'login_failed',
                                     'login_blocked', 'login_mfa_requested',
                                     'refresh_token_theft', 'refresh_family_revoked',
                                     'token_theft_detected', 'session.revoked',
                                     'session.revoked_all', 'admin_force_logout_user',
                                     'revoke_all_sessions', 'revoke_all_users_sessions'
                                 )
                             )
                       )::BIGINT AS security_24h,
                       COUNT(*) FILTER (
                           WHERE created_at >= now() - interval '24 hours'
                             AND action = 'http_request'
                       )::BIGINT AS technical_24h
                   FROM audit_log"#
            );
            let summary = match sqlx::query(&summary_sql).fetch_one(&state.db).await {
                Ok(row) => serde_json::json!({
                    "activity_24h": row.try_get::<i64, _>("activity_24h").unwrap_or_default(),
                    "active_users_24h": row.try_get::<i64, _>("active_users_24h").unwrap_or_default(),
                    "changes_24h": row.try_get::<i64, _>("changes_24h").unwrap_or_default(),
                    "security_24h": row.try_get::<i64, _>("security_24h").unwrap_or_default(),
                    "technical_24h": row.try_get::<i64, _>("technical_24h").unwrap_or_default(),
                }),
                Err(e) => {
                    tracing::error!(error = %e, "summarize activity");
                    return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
                }
            };
            let (technical_days, meaningful_days) =
                match audit::configured_retention_days(&state.db).await {
                    Ok(value) => value,
                    Err(e) => {
                        tracing::error!(error = %e, "load audit retention policy");
                        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
                    }
                };
            let data: Vec<serde_json::Value> = rows
                .into_iter()
                .map(|r| {
                    let entity_type: Option<String> =
                        r.try_get("entity_type").unwrap_or_default();
                    let actor_role: Option<String> = r.try_get("actor_role").unwrap_or_default();
                    // A patient or lead login acting in its portal stays
                    // anonymous for a reader without patient access.
                    let actor_hidden = !full_access && actor_role.as_deref() == Some("patient");
                    let target_is_portal =
                        r.try_get::<bool, _>("target_is_portal").unwrap_or(false);
                    let context = visible_activity_context(
                        full_access,
                        entity_type.as_deref(),
                        target_is_portal,
                        r.try_get::<Option<serde_json::Value>, _>("context")
                            .unwrap_or_default(),
                    );
                    // A patient or lead login stays unnamed for a reader
                    // without patient access, like its context.
                    let target_hidden = !full_access && target_is_portal;
                    let target_name: Option<String> = if target_hidden {
                        None
                    } else {
                        r.try_get("target_name").unwrap_or_default()
                    };
                    let target_email: Option<String> = if target_hidden {
                        None
                    } else {
                        r.try_get("target_email").unwrap_or_default()
                    };
                    let old_value = visible_activity_context(
                        full_access,
                        entity_type.as_deref(),
                        target_is_portal,
                        r.try_get::<Option<serde_json::Value>, _>("old_value")
                            .unwrap_or_default(),
                    );
                    let new_value = visible_activity_context(
                        full_access,
                        entity_type.as_deref(),
                        target_is_portal,
                        r.try_get::<Option<serde_json::Value>, _>("new_value")
                            .unwrap_or_default(),
                    );
                    serde_json::json!({
                        "id": r.try_get::<i64, _>("id").unwrap_or_default().to_string(),
                        "user_id": if actor_hidden { Uuid::nil() } else { r.try_get::<Uuid, _>("user_id").unwrap_or_default() },
                        "user_name": if actor_hidden { String::new() } else { r.try_get::<String, _>("user_name").unwrap_or_default() },
                        "user_email": if actor_hidden { String::new() } else { r.try_get::<String, _>("user_email").unwrap_or_default() },
                        "actor_role": actor_role,
                        "action": r.try_get::<String, _>("action").unwrap_or_default(),
                        "entity_type": entity_type,
                        "entity_id": visible_activity_entity_id(
                            full_access,
                            entity_type.as_deref(),
                            target_is_portal,
                            r.try_get::<Option<Uuid>, _>("entity_id").unwrap_or_default(),
                        ),
                        "entity_name": target_name,
                        "entity_email": target_email,
                        "context": context,
                        "old_value": old_value,
                        "new_value": new_value,
                        "created_at": r.try_get::<DateTime<Utc>, _>("created_at").map(|value| value.to_rfc3339()).unwrap_or_default(),
                    })
                })
                .collect();
            let count = data.len() as i64;
            Json(serde_json::json!({
                "items": data,
                "total": total,
                "limit": limit,
                "offset": offset,
                "has_more": offset + count < total,
                "view": view,
                "summary": summary,
                "retention": {
                    "technical_days": technical_days,
                    "meaningful_days": meaningful_days,
                },
            }))
            .into_response()
        }
        Err(e) => {
            tracing::error!(error = %e, "list activity");
            err(StatusCode::INTERNAL_SERVER_ERROR, "Failed")
        }
    }
}

async fn list_pending_logins(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
) -> axum::response::Response {
    if let Err(e) = auth.require_capability(Capability::AdminSecurity) {
        return e;
    }

    match sqlx::query(
        r#"SELECT pl.id, pl.user_id, u.name AS user_name, u.email AS user_email, u.role,
                  pl.ip_address, pl.user_agent, pl.device_info, pl.created_at
           FROM pending_logins pl
           JOIN users u ON u.id = pl.user_id
           WHERE pl.status = 'pending' AND pl.expires_at > now()
             AND ($1::bool OR u.role <> 'patient')
           ORDER BY pl.created_at DESC"#,
    )
    .bind(super::users::can_see_portal_accounts(&auth))
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => {
            let data: Vec<serde_json::Value> = rows
                .into_iter()
                .map(|r| {
                    serde_json::json!({
                        "id": r.try_get::<Uuid, _>("id").unwrap_or_default(),
                        "user_id": r.try_get::<Uuid, _>("user_id").unwrap_or_default(),
                        "user_name": r.try_get::<String, _>("user_name").unwrap_or_default(),
                        "user_email": r.try_get::<String, _>("user_email").unwrap_or_default(),
                        "role": r.try_get::<String, _>("role").unwrap_or_default(),
                        "ip_address": r.try_get::<Option<String>, _>("ip_address").unwrap_or_default(),
                        "user_agent": r.try_get::<Option<String>, _>("user_agent").unwrap_or_default(),
                        "device_info": r.try_get::<Option<serde_json::Value>, _>("device_info").unwrap_or_default(),
                        "created_at": r.try_get::<DateTime<Utc>, _>("created_at").ok(),
                    })
                })
                .collect();
            Json(data).into_response()
        }
        Err(e) => {
            tracing::error!(error = %e, "list pending logins");
            err(StatusCode::INTERNAL_SERVER_ERROR, "Failed")
        }
    }
}

async fn approve_pending(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(pending_id): Path<Uuid>,
) -> axum::response::Response {
    if let Err(e) = auth.require_capability(Capability::AdminSecurity) {
        return e;
    }
    if let Err(e) = ensure_can_resolve_pending_login(&state, &auth, pending_id).await {
        return e;
    }

    // A pending forced password change does not block the approval: the
    // session created on redemption is confined to the password-change
    // endpoints (`TokenPair::password_change_required`). Refusing it here left
    // an account with admin approval and a forced change unable to sign in at
    // all (owner decision 2026-09-28, Q12).
    match sqlx::query(
        "UPDATE pending_logins pl SET status = 'approved', approved_by = $2, resolved_at = now()
         FROM users u
         WHERE pl.id = $1 AND pl.user_id = u.id AND pl.status = 'pending'
           AND pl.expires_at > now() AND u.is_active",
    )
    .bind(pending_id)
    .bind(auth.user_id)
    .execute(&state.db)
    .await
    {
        Ok(r) if r.rows_affected() > 0 => {
            state.audit_sender.try_send(audit::domain_event(
                "mfa_approve",
                Some(auth.user_id),
                "pending_login",
                Some(pending_id),
                serde_json::json!({ "pending_id": pending_id }),
            ));
            tracing::info!(admin = %auth.user_id, pending = %pending_id, "MFA login approved");
            crate::realtime::publish_admin_event(
                &state,
                Some(auth.user_id),
                "pending_login.approved",
                "pending_login",
                pending_id,
                serde_json::json!({}),
            )
            .await;
            Json(serde_json::json!({"ok": true})).into_response()
        }
        Ok(_) => err(
            StatusCode::NOT_FOUND,
            "Pending login not found or already resolved",
        ),
        Err(e) => {
            tracing::error!(error = %e, "approve pending");
            err(StatusCode::INTERNAL_SERVER_ERROR, "Failed")
        }
    }
}

async fn reject_pending(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(pending_id): Path<Uuid>,
) -> axum::response::Response {
    if let Err(e) = auth.require_capability(Capability::AdminSecurity) {
        return e;
    }
    if let Err(e) = ensure_can_resolve_pending_login(&state, &auth, pending_id).await {
        return e;
    }

    match sqlx::query!(
        "UPDATE pending_logins SET status = 'rejected', approved_by = $2, resolved_at = now() WHERE id = $1 AND status = 'pending'",
        pending_id, auth.user_id
    ).execute(&state.db).await {
        Ok(r) if r.rows_affected() > 0 => {
            state.audit_sender.try_send(audit::domain_event(
                "mfa_reject",
                Some(auth.user_id),
                "pending_login",
                Some(pending_id),
                serde_json::json!({ "pending_id": pending_id }),
            ));
            tracing::info!(admin = %auth.user_id, pending = %pending_id, "MFA login rejected");
            crate::realtime::publish_admin_event(
                &state,
                Some(auth.user_id),
                "pending_login.rejected",
                "pending_login",
                pending_id,
                serde_json::json!({}),
            )
            .await;
            Json(serde_json::json!({"ok": true})).into_response()
        }
        Ok(_) => err(StatusCode::NOT_FOUND, "Pending login not found or already resolved"),
        Err(e) => {
            tracing::error!(error = %e, "reject pending");
            err(StatusCode::INTERNAL_SERVER_ERROR, "Failed")
        }
    }
}

/// A pending login is decided for its account: an existing CEO's sign-in is
/// approved or rejected only by a CEO (`users.manage_ceo`), like every other
/// change to the CEO account.
async fn ensure_can_resolve_pending_login(
    state: &AppState,
    auth: &AuthUser,
    pending_id: Uuid,
) -> Result<(), axum::response::Response> {
    let user_id: Option<Uuid> =
        sqlx::query_scalar("SELECT user_id FROM pending_logins WHERE id = $1")
            .bind(pending_id)
            .fetch_optional(&state.db)
            .await
            .map_err(|e| {
                tracing::error!(error = %e, pending = %pending_id, "load pending login account");
                err(StatusCode::INTERNAL_SERVER_ERROR, "Failed")
            })?;
    match user_id {
        Some(user_id) => super::users::ensure_can_act_on_account(state, auth, user_id).await,
        None => Err(err(
            StatusCode::NOT_FOUND,
            "Pending login not found or already resolved",
        )),
    }
}

#[derive(Deserialize)]
struct ToggleMfaReq {
    enabled: bool,
}

async fn toggle_mfa(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(user_id): Path<Uuid>,
    Json(body): Json<ToggleMfaReq>,
) -> axum::response::Response {
    if let Err(e) = auth.require_capability(Capability::AdminSecurity) {
        return e;
    }
    if let Err(e) = super::users::ensure_can_act_on_account(&state, &auth, user_id).await {
        return e;
    }

    match sqlx::query!(
        "UPDATE users SET mfa_required = $2 WHERE id = $1",
        user_id,
        body.enabled
    )
    .execute(&state.db)
    .await
    {
        Ok(r) if r.rows_affected() > 0 => {
            state.audit_sender.try_send(audit::domain_event(
                "toggle_mfa",
                Some(auth.user_id),
                "user",
                Some(user_id),
                serde_json::json!({ "enabled": body.enabled, "target_user": user_id }),
            ));
            tracing::info!(admin = %auth.user_id, target = %user_id, mfa = body.enabled, "MFA toggled");
            crate::realtime::publish_admin_event(
                &state,
                Some(auth.user_id),
                "user.mfa_toggled",
                "user",
                user_id,
                serde_json::json!({ "enabled": body.enabled }),
            )
            .await;
            Json(serde_json::json!({"ok": true, "mfa_required": body.enabled})).into_response()
        }
        Ok(_) => err(StatusCode::NOT_FOUND, "User not found"),
        Err(e) => {
            tracing::error!(error = %e, "toggle mfa");
            err(StatusCode::INTERNAL_SERVER_ERROR, "Failed")
        }
    }
}

fn err(status: StatusCode, message: &str) -> axum::response::Response {
    (
        status,
        Json(serde_json::json!({ "error": status.canonical_reason().unwrap_or("error"), "message": message })),
    )
        .into_response()
}

#[cfg(test)]
mod tests {
    use super::{
        SessionsQuery, activity_action_filter, activity_category_actions, normalize_activity_view,
        sessions_page, visible_activity_context,
    };
    use serde_json::json;

    /// final-D S3-4: the active sessions list is paged, never unbounded.
    #[test]
    fn sessions_pages_are_bounded() {
        let page = |offset: Option<i64>, limit: Option<i64>| {
            sessions_page(&SessionsQuery { offset, limit })
        };
        assert_eq!(page(None, None), (0, 50));
        assert_eq!(page(Some(100), Some(25)), (100, 25));
        assert_eq!(page(Some(-5), Some(0)), (0, 1));
        assert_eq!(page(None, Some(i64::MAX)), (0, 200));
    }

    #[test]
    fn activity_action_filter_keeps_every_given_code() {
        assert_eq!(activity_action_filter(None), None);
        assert_eq!(activity_action_filter(Some(" , ")), None);
        assert_eq!(
            activity_action_filter(Some("create_custom_field")),
            Some(vec!["create_custom_field".to_string()])
        );
        assert_eq!(
            activity_action_filter(Some("login_failure, login_failed")),
            Some(vec![
                "login_failure".to_string(),
                "login_failed".to_string()
            ])
        );
        // An unknown code stays a filter (no rows), it never lifts it.
        assert_eq!(
            activity_action_filter(Some("Bad code!")),
            Some(vec!["Bad code!".to_string()])
        );
    }

    #[test]
    fn activity_context_is_redacted_outside_technical_entities_without_full_access() {
        let reason = json!({ "decision": "false_positive", "reason": "anderer Geburtsort" });
        assert_eq!(
            visible_activity_context(true, Some("sanctions_hit"), false, Some(reason.clone())),
            Some(reason.clone())
        );
        for entity in ["sanctions_hit", "lead", "patient", "invoice", "document"] {
            assert_eq!(
                visible_activity_context(false, Some(entity), false, Some(reason.clone())),
                Some(json!({ "redacted": true })),
                "{entity}"
            );
        }
        let login = json!({ "reason": "wrong_password" });
        assert_eq!(
            visible_activity_context(false, Some("auth"), false, Some(login.clone())),
            Some(login.clone())
        );
        // An account event about a patient or lead login is patient data.
        assert_eq!(
            visible_activity_context(false, Some("user"), true, Some(login.clone())),
            Some(json!({ "redacted": true }))
        );
        assert_eq!(
            visible_activity_context(false, Some("lead"), false, None),
            None
        );
    }

    #[test]
    fn activity_view_defaults_to_meaningful_activity() {
        assert_eq!(normalize_activity_view(None).unwrap(), "activity");
    }

    #[test]
    fn activity_view_accepts_supported_streams_only() {
        for view in ["activity", "security", "technical", "all"] {
            assert_eq!(
                normalize_activity_view(Some(view.to_string())).unwrap(),
                view
            );
        }
        assert!(normalize_activity_view(Some("noise".to_string())).is_err());
    }

    #[test]
    fn access_category_maps_to_the_account_and_permission_actions_only() {
        assert_eq!(activity_category_actions(None).unwrap(), None);
        assert_eq!(activity_category_actions(Some("  ")).unwrap(), None);
        let actions = activity_category_actions(Some("access"))
            .unwrap()
            .expect("access allow-list");
        for expected in [
            "create_user",
            "update_user",
            "deactivate_user",
            "activate_user",
            "reset_password",
            "totp_reset",
            "update_access_policy",
            "update_staff_user_access",
        ] {
            assert!(actions.iter().any(|a| a == expected), "{expected}");
        }
        assert!(!actions.iter().any(|a| a == "login_success"));
        assert!(!actions.iter().any(|a| a == "http_request"));
        assert!(activity_category_actions(Some("billing")).is_err());
    }
}
