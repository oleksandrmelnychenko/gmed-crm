use axum::{
    Json, Router,
    extract::{Extension, Path, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
};
use chrono::NaiveDate;
use rust_decimal::Decimal;
use serde::Deserialize;
use sqlx::Row;
use uuid::Uuid;

use crate::auth::middleware::AuthUser;
use crate::state::AppState;
use gmed_domain::role::Role;

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/tax-profiles",
            get(list_tax_profiles).post(create_tax_profile),
        )
        .route("/tax-profiles/{profile_id}", post(update_tax_profile))
        .route("/tax-profiles/catalog", get(list_catalog_tax_profiles))
}

#[derive(Deserialize)]
struct CreateTaxProfileRequest {
    profile_key: String,
    name: String,
    description: Option<String>,
    vat_rate: Option<Decimal>,
    vat_category: Option<String>,
    is_default: Option<bool>,
    is_active: Option<bool>,
    valid_from: Option<String>,
    valid_to: Option<String>,
}

fn err(status: StatusCode, message: &str) -> axum::response::Response {
    (
        status,
        Json(serde_json::json!({
            "error": status.canonical_reason().unwrap_or("error").to_lowercase(),
            "message": message,
        })),
    )
        .into_response()
}

fn can_read_tax_profiles(role: Role) -> bool {
    matches!(
        role,
        Role::Ceo | Role::CeoAssistant | Role::PatientManager | Role::Billing
    )
}

fn can_manage_tax_profiles(role: Role) -> bool {
    matches!(role, Role::Ceo | Role::Billing)
}

fn decimal_to_string(value: Decimal) -> String {
    value.round_dp(2).normalize().to_string()
}

fn normalize_required_key(
    value: &str,
    field: &'static str,
) -> Result<String, axum::response::Response> {
    let normalized = value.trim().to_lowercase().replace([' ', '-'], "_");
    if normalized.is_empty()
        || normalized.len() > 80
        || !normalized
            .chars()
            .all(|ch| ch.is_ascii_lowercase() || ch.is_ascii_digit() || ch == '_')
    {
        return Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            &format!("{field} must be a non-empty snake_case key"),
        ));
    }
    Ok(normalized)
}

fn normalize_required_text(
    value: &str,
    field: &'static str,
) -> Result<String, axum::response::Response> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            &format!("{field} is required"),
        ));
    }
    Ok(trimmed.to_string())
}

fn normalize_optional(value: Option<&str>) -> Option<String> {
    let trimmed = value?.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn parse_optional_date(
    value: Option<&str>,
    field: &'static str,
) -> Result<Option<NaiveDate>, String> {
    match value {
        Some(raw) if !raw.trim().is_empty() => NaiveDate::parse_from_str(raw.trim(), "%Y-%m-%d")
            .map(Some)
            .map_err(|_| format!("Invalid {field} (YYYY-MM-DD)")),
        _ => Ok(None),
    }
}

fn valid_vat_category(value: &str) -> bool {
    matches!(
        value,
        "standard" | "zero_rated" | "exempt" | "reverse_charge" | "custom"
    )
}

async fn list_tax_profiles(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
) -> axum::response::Response {
    if !can_read_tax_profiles(auth.role) {
        return err(StatusCode::FORBIDDEN, "Insufficient permissions");
    }

    match sqlx::query(
        r#"SELECT id, profile_key, name, description, vat_rate, vat_category,
                  is_default, is_active, valid_from, valid_to, created_at, updated_at
           FROM tax_profiles
           ORDER BY is_default DESC, is_active DESC, profile_key"#,
    )
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => Json(
            rows.into_iter()
                .map(|row| {
                    serde_json::json!({
                        "id": row.try_get::<Uuid, _>("id").unwrap_or_default(),
                        "profile_key": row.try_get::<String, _>("profile_key").unwrap_or_default(),
                        "name": row.try_get::<String, _>("name").unwrap_or_default(),
                        "description": row.try_get::<Option<String>, _>("description").unwrap_or_default(),
                        "vat_rate": decimal_to_string(row.try_get::<Decimal, _>("vat_rate").unwrap_or(Decimal::ZERO)),
                        "vat_category": row.try_get::<String, _>("vat_category").unwrap_or_default(),
                        "is_default": row.try_get::<bool, _>("is_default").unwrap_or(false),
                        "is_active": row.try_get::<bool, _>("is_active").unwrap_or(false),
                        "valid_from": row.try_get::<chrono::NaiveDate, _>("valid_from").map(|value| value.to_string()).unwrap_or_default(),
                        "valid_to": row.try_get::<Option<chrono::NaiveDate>, _>("valid_to").unwrap_or_default().map(|value| value.to_string()),
                        "created_at": row.try_get::<chrono::DateTime<chrono::Utc>, _>("created_at").map(|value| value.to_rfc3339()).unwrap_or_default(),
                        "updated_at": row.try_get::<chrono::DateTime<chrono::Utc>, _>("updated_at").map(|value| value.to_rfc3339()).unwrap_or_default(),
                    })
                })
                .collect::<Vec<_>>(),
        )
        .into_response(),
        Err(e) => {
            tracing::error!(error = %e, "list tax profiles");
            err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to load tax profiles")
        }
    }
}

async fn create_tax_profile(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Json(body): Json<CreateTaxProfileRequest>,
) -> axum::response::Response {
    if !can_manage_tax_profiles(auth.role) {
        return err(StatusCode::FORBIDDEN, "Insufficient permissions");
    }

    let profile_key = match normalize_required_key(&body.profile_key, "profile_key") {
        Ok(value) => value,
        Err(resp) => return resp,
    };
    let name = match normalize_required_text(&body.name, "name") {
        Ok(value) => value,
        Err(resp) => return resp,
    };
    let vat_rate = body.vat_rate.unwrap_or(Decimal::ZERO).round_dp(2);
    if vat_rate < Decimal::ZERO {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "vat_rate must be non-negative",
        );
    }
    let vat_category = body
        .vat_category
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("custom")
        .to_string();
    if !valid_vat_category(&vat_category) {
        return err(StatusCode::UNPROCESSABLE_ENTITY, "Invalid vat_category");
    }
    let valid_from = match parse_optional_date(body.valid_from.as_deref(), "valid_from") {
        Ok(value) => value,
        Err(message) => return err(StatusCode::UNPROCESSABLE_ENTITY, &message),
    };
    let valid_to = match parse_optional_date(body.valid_to.as_deref(), "valid_to") {
        Ok(value) => value,
        Err(message) => return err(StatusCode::UNPROCESSABLE_ENTITY, &message),
    };

    let mut tx = match state.db.begin().await {
        Ok(tx) => tx,
        Err(e) => {
            tracing::error!(error = %e, "begin create tax profile");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to create tax profile",
            );
        }
    };

    if body.is_default.unwrap_or(false)
        && let Err(e) =
            sqlx::query("UPDATE tax_profiles SET is_default = false WHERE is_default = true")
                .execute(&mut *tx)
                .await
    {
        tracing::error!(error = %e, "clear default tax profile");
        return err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to update tax profile defaults",
        );
    }

    let row = match sqlx::query(
        r#"INSERT INTO tax_profiles (
                profile_key, name, description, vat_rate, vat_category,
                is_default, is_active, valid_from, valid_to
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8, CURRENT_DATE), $9)
           RETURNING id"#,
    )
    .bind(profile_key)
    .bind(name)
    .bind(normalize_optional(body.description.as_deref()))
    .bind(vat_rate)
    .bind(vat_category)
    .bind(body.is_default.unwrap_or(false))
    .bind(body.is_active.unwrap_or(true))
    .bind(valid_from)
    .bind(valid_to)
    .fetch_one(&mut *tx)
    .await
    {
        Ok(row) => row,
        Err(sqlx::Error::Database(db_error)) if db_error.code().as_deref() == Some("23505") => {
            return err(StatusCode::CONFLICT, "Tax profile already exists");
        }
        Err(e) => {
            tracing::error!(error = %e, "create tax profile");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to create tax profile",
            );
        }
    };
    if let Err(e) = tx.commit().await {
        tracing::error!(error = %e, "commit create tax profile");
        return err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to create tax profile",
        );
    }

    (
        StatusCode::CREATED,
        Json(serde_json::json!({
            "id": row.try_get::<Uuid, _>("id").unwrap_or_default(),
        })),
    )
        .into_response()
}

async fn update_tax_profile(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(profile_id): Path<Uuid>,
    Json(body): Json<CreateTaxProfileRequest>,
) -> axum::response::Response {
    if !can_manage_tax_profiles(auth.role) {
        return err(StatusCode::FORBIDDEN, "Insufficient permissions");
    }

    let profile_key = match normalize_required_key(&body.profile_key, "profile_key") {
        Ok(value) => value,
        Err(resp) => return resp,
    };
    let name = match normalize_required_text(&body.name, "name") {
        Ok(value) => value,
        Err(resp) => return resp,
    };
    let vat_rate = body.vat_rate.unwrap_or(Decimal::ZERO).round_dp(2);
    if vat_rate < Decimal::ZERO {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "vat_rate must be non-negative",
        );
    }
    let vat_category = body
        .vat_category
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("custom")
        .to_string();
    if !valid_vat_category(&vat_category) {
        return err(StatusCode::UNPROCESSABLE_ENTITY, "Invalid vat_category");
    }
    let valid_from = match parse_optional_date(body.valid_from.as_deref(), "valid_from") {
        Ok(value) => value,
        Err(message) => return err(StatusCode::UNPROCESSABLE_ENTITY, &message),
    };
    let valid_to = match parse_optional_date(body.valid_to.as_deref(), "valid_to") {
        Ok(value) => value,
        Err(message) => return err(StatusCode::UNPROCESSABLE_ENTITY, &message),
    };

    let mut tx = match state.db.begin().await {
        Ok(tx) => tx,
        Err(e) => {
            tracing::error!(error = %e, profile_id = %profile_id, "begin update tax profile");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to update tax profile",
            );
        }
    };

    if body.is_default.unwrap_or(false) {
        if let Err(e) = sqlx::query("UPDATE tax_profiles SET is_default = false WHERE id <> $1")
            .bind(profile_id)
            .execute(&mut *tx)
            .await
        {
            tracing::error!(error = %e, profile_id = %profile_id, "clear default tax profiles");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to update tax profile defaults",
            );
        }
    }

    let result = match sqlx::query(
        r#"UPDATE tax_profiles
           SET profile_key = $2,
               name = $3,
               description = $4,
               vat_rate = $5,
               vat_category = $6,
               is_default = $7,
               is_active = $8,
               valid_from = COALESCE($9, valid_from),
               valid_to = $10
           WHERE id = $1"#,
    )
    .bind(profile_id)
    .bind(profile_key)
    .bind(name)
    .bind(normalize_optional(body.description.as_deref()))
    .bind(vat_rate)
    .bind(vat_category)
    .bind(body.is_default.unwrap_or(false))
    .bind(body.is_active.unwrap_or(true))
    .bind(valid_from)
    .bind(valid_to)
    .execute(&mut *tx)
    .await
    {
        Ok(result) => result,
        Err(sqlx::Error::Database(db_error)) if db_error.code().as_deref() == Some("23505") => {
            return err(StatusCode::CONFLICT, "Tax profile already exists");
        }
        Err(e) => {
            tracing::error!(error = %e, profile_id = %profile_id, "update tax profile");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to update tax profile",
            );
        }
    };
    if result.rows_affected() == 0 {
        return err(StatusCode::NOT_FOUND, "Tax profile not found");
    }
    if let Err(e) = tx.commit().await {
        tracing::error!(error = %e, profile_id = %profile_id, "commit update tax profile");
        return err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to update tax profile",
        );
    }

    Json(serde_json::json!({
        "id": profile_id,
    }))
    .into_response()
}

async fn list_catalog_tax_profiles(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
) -> axum::response::Response {
    if !can_read_tax_profiles(auth.role) {
        return err(StatusCode::FORBIDDEN, "Insufficient permissions");
    }

    match sqlx::query(
        r#"SELECT c.id, c.service_key, c.service_name, c.vat_rate, c.vat_source,
                  tp.id AS tax_profile_id, tp.profile_key, tp.name AS tax_profile_name,
                  tp.vat_rate AS tax_profile_vat_rate
           FROM agency_service_catalog c
           LEFT JOIN tax_profiles tp ON tp.id = c.tax_profile_id
           WHERE c.is_active = true
           ORDER BY c.service_key"#,
    )
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => Json(
            rows.into_iter()
                .map(|row| {
                    serde_json::json!({
                        "catalog_id": row.try_get::<Uuid, _>("id").unwrap_or_default(),
                        "service_key": row.try_get::<String, _>("service_key").unwrap_or_default(),
                        "service_name": row.try_get::<String, _>("service_name").unwrap_or_default(),
                        "vat_rate": decimal_to_string(row.try_get::<Decimal, _>("vat_rate").unwrap_or(Decimal::ZERO)),
                        "vat_source": row.try_get::<String, _>("vat_source").unwrap_or_else(|_| "catalog".to_string()),
                        "tax_profile_id": row.try_get::<Option<Uuid>, _>("tax_profile_id").unwrap_or_default(),
                        "tax_profile_key": row.try_get::<Option<String>, _>("profile_key").unwrap_or_default(),
                        "tax_profile_name": row.try_get::<Option<String>, _>("tax_profile_name").unwrap_or_default(),
                        "tax_profile_vat_rate": row.try_get::<Option<Decimal>, _>("tax_profile_vat_rate").unwrap_or_default().map(decimal_to_string),
                    })
                })
                .collect::<Vec<_>>(),
        )
        .into_response(),
        Err(e) => {
            tracing::error!(error = %e, "list catalog tax profiles");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to load catalog tax profiles",
            )
        }
    }
}
