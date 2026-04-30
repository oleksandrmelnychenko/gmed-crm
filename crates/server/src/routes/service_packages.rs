use axum::{
    Json, Router,
    extract::{Extension, Path, State},
    http::StatusCode,
    response::IntoResponse,
    routing::get,
};
use rust_decimal::Decimal;
use sqlx::Row;
use uuid::Uuid;

use crate::access;
use crate::auth::middleware::AuthUser;
use crate::state::AppState;
use gmed_domain::role::Role;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/service-packages", get(list_service_packages))
        .route(
            "/patients/{patient_id}/service-packages",
            get(list_patient_service_packages),
        )
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

fn can_read_packages(role: Role) -> bool {
    matches!(
        role,
        Role::Ceo | Role::CeoAssistant | Role::PatientManager | Role::Billing
    )
}

async fn ensure_patient_access(
    state: &AppState,
    auth: &AuthUser,
    patient_id: Uuid,
) -> Result<(), axum::response::Response> {
    if matches!(auth.role, Role::Ceo | Role::CeoAssistant | Role::Billing) {
        return Ok(());
    }

    match access::has_active_patient_assignment(&state.db, patient_id, auth.user_id).await {
        Ok(true) => Ok(()),
        Ok(false) => Err(err(StatusCode::FORBIDDEN, "Insufficient permissions")),
        Err(e) => {
            tracing::error!(error = %e, patient_id = %patient_id, "validate package access");
            Err(err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to validate patient access",
            ))
        }
    }
}

fn decimal_to_string(value: Decimal) -> String {
    value.round_dp(2).normalize().to_string()
}

async fn list_service_packages(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
) -> axum::response::Response {
    if !can_read_packages(auth.role) {
        return err(StatusCode::FORBIDDEN, "Insufficient permissions");
    }

    match sqlx::query(
        r#"SELECT sp.id, sp.package_key, sp.name, sp.description, sp.currency,
                  sp.base_price_net, sp.base_price_vat, sp.base_price_gross,
                  sp.is_active, sp.valid_from, sp.valid_to,
                  tp.profile_key AS tax_profile_key
           FROM service_packages sp
           LEFT JOIN tax_profiles tp ON tp.id = sp.tax_profile_id
           ORDER BY sp.is_active DESC, sp.package_key"#,
    )
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => Json(
            rows.into_iter()
                .map(|row| {
                    serde_json::json!({
                        "id": row.try_get::<Uuid, _>("id").unwrap_or_default(),
                        "package_key": row.try_get::<String, _>("package_key").unwrap_or_default(),
                        "name": row.try_get::<String, _>("name").unwrap_or_default(),
                        "description": row.try_get::<Option<String>, _>("description").unwrap_or_default(),
                        "currency": row.try_get::<String, _>("currency").unwrap_or_else(|_| "EUR".to_string()),
                        "base_price_net": decimal_to_string(row.try_get::<Decimal, _>("base_price_net").unwrap_or(Decimal::ZERO)),
                        "base_price_vat": decimal_to_string(row.try_get::<Decimal, _>("base_price_vat").unwrap_or(Decimal::ZERO)),
                        "base_price_gross": decimal_to_string(row.try_get::<Decimal, _>("base_price_gross").unwrap_or(Decimal::ZERO)),
                        "tax_profile_key": row.try_get::<Option<String>, _>("tax_profile_key").unwrap_or_default(),
                        "is_active": row.try_get::<bool, _>("is_active").unwrap_or(false),
                        "valid_from": row.try_get::<chrono::NaiveDate, _>("valid_from").map(|value| value.to_string()).unwrap_or_default(),
                        "valid_to": row.try_get::<Option<chrono::NaiveDate>, _>("valid_to").unwrap_or_default().map(|value| value.to_string()),
                    })
                })
                .collect::<Vec<_>>(),
        )
        .into_response(),
        Err(e) => {
            tracing::error!(error = %e, "list service packages");
            err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to load service packages")
        }
    }
}

async fn list_patient_service_packages(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(patient_id): Path<Uuid>,
) -> axum::response::Response {
    if !can_read_packages(auth.role) {
        return err(StatusCode::FORBIDDEN, "Insufficient permissions");
    }
    if let Err(resp) = ensure_patient_access(&state, &auth, patient_id).await {
        return resp;
    }

    match sqlx::query(
        r#"SELECT psp.id, psp.package_id, sp.name AS package_name, psp.status,
                  spi.id AS package_item_id, spi.description, spi.included_quantity,
                  spi.requires_patient_approval,
                  COALESCE(SUM(spc.quantity), 0) AS used_quantity,
                  COALESCE(SUM(spc.overage_quantity), 0) AS overage_quantity
           FROM patient_service_packages psp
           JOIN service_packages sp ON sp.id = psp.package_id
           LEFT JOIN service_package_items spi ON spi.package_id = sp.id
           LEFT JOIN service_package_consumptions spc
                  ON spc.patient_service_package_id = psp.id
                 AND (spc.package_item_id = spi.id OR (spc.package_item_id IS NULL AND spi.id IS NULL))
           WHERE psp.patient_id = $1
           GROUP BY psp.id, psp.package_id, sp.name, psp.status,
                    spi.id, spi.description, spi.included_quantity, spi.requires_patient_approval
           ORDER BY psp.assigned_at DESC, spi.sort_order"#,
    )
    .bind(patient_id)
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => {
            let items = rows
                .into_iter()
                .map(|row| {
                    let included = row
                        .try_get::<Decimal, _>("included_quantity")
                        .unwrap_or(Decimal::ZERO);
                    let used = row
                        .try_get::<Decimal, _>("used_quantity")
                        .unwrap_or(Decimal::ZERO);
                    let remaining = (included - used).max(Decimal::ZERO);
                    serde_json::json!({
                        "patient_service_package_id": row.try_get::<Uuid, _>("id").unwrap_or_default(),
                        "package_id": row.try_get::<Uuid, _>("package_id").unwrap_or_default(),
                        "package_name": row.try_get::<String, _>("package_name").unwrap_or_default(),
                        "status": row.try_get::<String, _>("status").unwrap_or_default(),
                        "package_item_id": row.try_get::<Option<Uuid>, _>("package_item_id").unwrap_or_default(),
                        "description": row.try_get::<Option<String>, _>("description").unwrap_or_default(),
                        "included_quantity": decimal_to_string(included),
                        "used_quantity": decimal_to_string(used),
                        "remaining_quantity": decimal_to_string(remaining),
                        "overage_quantity": decimal_to_string(row.try_get::<Decimal, _>("overage_quantity").unwrap_or(Decimal::ZERO)),
                        "requires_patient_approval": row.try_get::<bool, _>("requires_patient_approval").unwrap_or(false),
                    })
                })
                .collect::<Vec<_>>();
            Json(items).into_response()
        }
        Err(e) => {
            tracing::error!(error = %e, patient_id = %patient_id, "list patient packages");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to load patient service packages",
            )
        }
    }
}
