use axum::{
    Json, Router,
    extract::{Extension, Path, Query, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
};
use serde::Deserialize;
use sqlx::Row;
use uuid::Uuid;

use crate::access;
use crate::audit;
use crate::auth::middleware::AuthUser;
use crate::routes::me::resolve_self_patient_id;
use crate::state::AppState;
use gmed_domain::role::Role;

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/me/concierge-services",
            get(list_my_concierge_services).post(create_my_concierge_service),
        )
        .route(
            "/me/concierge-services/{service_id}/cancel",
            post(cancel_my_concierge_service),
        )
        .route(
            "/concierge-services",
            get(list_concierge_services).post(create_concierge_service),
        )
        .route(
            "/concierge-services/{service_id}",
            get(get_concierge_service),
        )
        .route(
            "/concierge-services/{service_id}/update",
            post(update_concierge_service),
        )
}

#[derive(Deserialize)]
struct ListConciergeServicesQuery {
    search: Option<String>,
    patient_id: Option<Uuid>,
    appointment_id: Option<Uuid>,
    provider_id: Option<Uuid>,
    assigned_concierge_id: Option<Uuid>,
    service_kind: Option<String>,
    taxonomy_node_id: Option<Uuid>,
    status: Option<String>,
    billing_status: Option<String>,
    mine_only: Option<bool>,
}

#[derive(Deserialize)]
struct CreateConciergeServiceRequest {
    patient_id: Uuid,
    appointment_id: Option<Uuid>,
    provider_id: Option<Uuid>,
    provider_service_id: Option<Uuid>,
    assigned_concierge_id: Option<Uuid>,
    service_kind: Option<String>,
    taxonomy_node_id: Option<Uuid>,
    title: String,
    booking_reference: Option<String>,
    vendor_name: Option<String>,
    vendor_contact: Option<String>,
    starts_at: Option<String>,
    ends_at: Option<String>,
    cost_estimate: Option<f64>,
    actual_cost: Option<f64>,
    quantity: Option<f64>,
    unit_price: Option<f64>,
    currency: Option<String>,
    service_notes: Option<String>,
    billing_notes: Option<String>,
}

#[derive(Default)]
enum NullablePatchValue {
    #[default]
    Missing,
    Null,
    Value(serde_json::Value),
}

impl NullablePatchValue {
    fn is_present(&self) -> bool {
        !matches!(self, Self::Missing)
    }
}

impl<'de> Deserialize<'de> for NullablePatchValue {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let value = serde_json::Value::deserialize(deserializer)?;
        if value.is_null() {
            Ok(Self::Null)
        } else {
            Ok(Self::Value(value))
        }
    }
}

#[derive(Default, Deserialize)]
#[serde(default)]
struct UpdateConciergeServiceRequest {
    provider_id: Option<Uuid>,
    provider_service_id: Option<Uuid>,
    assigned_concierge_id: Option<Uuid>,
    service_kind: Option<String>,
    taxonomy_node_id: Option<Uuid>,
    title: Option<String>,
    status: Option<String>,
    billing_status: Option<String>,
    booking_reference: NullablePatchValue,
    vendor_name: NullablePatchValue,
    vendor_contact: NullablePatchValue,
    starts_at: NullablePatchValue,
    ends_at: NullablePatchValue,
    cost_estimate: NullablePatchValue,
    actual_cost: NullablePatchValue,
    quantity: Option<f64>,
    unit_price: Option<f64>,
    currency: Option<String>,
    service_notes: NullablePatchValue,
    billing_notes: NullablePatchValue,
}

#[derive(Deserialize)]
struct CreateMyConciergeServiceRequest {
    service_kind: String,
    taxonomy_node_id: Option<Uuid>,
    title: String,
    vendor_name: Option<String>,
    vendor_contact: Option<String>,
    starts_at: Option<String>,
    ends_at: Option<String>,
    cost_estimate: Option<f64>,
    currency: Option<String>,
    service_notes: Option<String>,
}

struct NonMedicalAppointmentContext {
    patient_id: Uuid,
    provider_id: Option<Uuid>,
    title: String,
    category: Option<String>,
    starts_at: Option<chrono::DateTime<chrono::Utc>>,
    ends_at: Option<chrono::DateTime<chrono::Utc>>,
}

struct ProviderServicePricing {
    provider_id: Uuid,
    taxonomy_node_id: Option<Uuid>,
    unit_price: Option<f64>,
    currency: String,
}

pub(crate) async fn bootstrap_default_service(
    state: &AppState,
    created_by: Uuid,
    appointment_id: Uuid,
) -> Result<(), axum::response::Response> {
    let Some(ctx) = load_non_medical_appointment_context(state, appointment_id).await? else {
        return Ok(());
    };

    let existing = sqlx::query("SELECT id FROM concierge_services WHERE appointment_id = $1 LIMIT 1")
        .bind(appointment_id)
        .fetch_optional(&state.db)
        .await
        .map_err(|e| {
            tracing::error!(error = %e, appointment_id = %appointment_id, "Failed to check concierge service bootstrap");
            err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to create concierge service")
        })?;

    if existing.is_some() {
        return Ok(());
    }

    let assigned_concierge_id = load_first_assigned_concierge_id(state, ctx.patient_id).await?;
    let title = ctx.title.clone();
    let service_kind = derive_service_kind(ctx.category.as_deref(), &title);
    let taxonomy_node_id = load_primary_provider_taxonomy_node_id(state, ctx.provider_id).await?;

    let service_id = sqlx::query_scalar::<_, Uuid>(
        r#"INSERT INTO concierge_services (
                patient_id, appointment_id, provider_id, assigned_concierge_id, service_kind, taxonomy_node_id,
                title, status, starts_at, ends_at, billing_status, service_notes, request_source,
                created_by
           ) VALUES (
                $1, $2, $3, $4, $5, $6,
                $7, 'planned', $8, $9, 'draft', $10, 'appointment_bootstrap', $11
           )
           RETURNING id"#,
    )
    .bind(ctx.patient_id)
    .bind(appointment_id)
    .bind(ctx.provider_id)
    .bind(assigned_concierge_id)
    .bind(service_kind.clone())
    .bind(taxonomy_node_id)
    .bind(title.clone())
    .bind(ctx.starts_at)
    .bind(ctx.ends_at)
    .bind(Some("Auto-created from non-medical appointment".to_string()))
    .bind(created_by)
    .fetch_one(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, appointment_id = %appointment_id, "Failed to bootstrap concierge service");
        err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to create concierge service")
    })?;

    crate::realtime::publish_concierge_service_event(
        state,
        Some(created_by),
        "concierge_service.created",
        service_id,
        serde_json::json!({
            "appointment_id": appointment_id,
            "request_source": "appointment_bootstrap",
            "service_kind": service_kind,
            "status": "planned",
        }),
    )
    .await;

    Ok(())
}

pub(crate) async fn mark_services_ready_for_billing(
    state: &AppState,
    created_by: Uuid,
    appointment_id: Uuid,
) -> Result<(), axum::response::Response> {
    let Some(ctx) = load_non_medical_appointment_context(state, appointment_id).await? else {
        return Ok(());
    };

    let existing_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM concierge_services WHERE appointment_id = $1")
            .bind(appointment_id)
            .fetch_one(&state.db)
            .await
            .map_err(|e| {
                tracing::error!(error = %e, appointment_id = %appointment_id, "Failed to count concierge services for billing handoff");
                err(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Failed to update concierge services",
                )
            })?;

    if existing_count == 0 {
        let assigned_concierge_id = load_first_assigned_concierge_id(state, ctx.patient_id).await?;
        let service_kind = derive_service_kind(ctx.category.as_deref(), &ctx.title);
        let taxonomy_node_id =
            load_primary_provider_taxonomy_node_id(state, ctx.provider_id).await?;
        let service_id = sqlx::query_scalar::<_, Uuid>(
            r#"INSERT INTO concierge_services (
                    patient_id, appointment_id, provider_id, assigned_concierge_id, service_kind, taxonomy_node_id,
                    title, status, starts_at, ends_at, billing_status, service_notes, completed_at,
                    request_source, created_by
               ) VALUES (
                    $1, $2, $3, $4, $5, $6,
                    $7, 'completed', $8, $9, 'ready', $10, now(), 'appointment_bootstrap', $11
               )
               RETURNING id"#,
        )
        .bind(ctx.patient_id)
        .bind(appointment_id)
        .bind(ctx.provider_id)
        .bind(assigned_concierge_id)
        .bind(service_kind.clone())
        .bind(taxonomy_node_id)
        .bind(ctx.title.clone())
        .bind(ctx.starts_at)
        .bind(ctx.ends_at)
        .bind(Some("Auto-created during appointment completion for billing handoff".to_string()))
        .bind(created_by)
        .fetch_one(&state.db)
        .await
        .map_err(|e| {
            tracing::error!(error = %e, appointment_id = %appointment_id, "Failed to create billing-ready concierge service");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to update concierge services",
            )
        })?;

        crate::realtime::publish_concierge_service_event(
            state,
            Some(created_by),
            "concierge_service.created",
            service_id,
            serde_json::json!({
                "appointment_id": appointment_id,
                "request_source": "appointment_bootstrap",
                "service_kind": service_kind,
                "status": "completed",
                "billing_status": "ready",
            }),
        )
        .await;
        return Ok(());
    }

    let rows = sqlx::query(
        r#"UPDATE concierge_services
           SET status = CASE
                   WHEN status IN ('planned', 'booked', 'confirmed', 'in_service')
                       THEN 'completed'
                   ELSE status
               END,
               completed_at = COALESCE(completed_at, now()),
               billing_status = CASE
                   WHEN billing_status = 'draft' THEN 'ready'
                   ELSE billing_status
               END
           WHERE appointment_id = $1
           RETURNING id"#,
    )
    .bind(appointment_id)
    .fetch_all(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, appointment_id = %appointment_id, "Failed to mark concierge services ready for billing");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to update concierge services",
        )
    })?;

    for row in rows {
        if let Ok(service_id) = row.try_get::<Uuid, _>("id") {
            crate::realtime::publish_concierge_service_event(
                state,
                Some(created_by),
                "concierge_service.billing_ready",
                service_id,
                serde_json::json!({
                    "appointment_id": appointment_id,
                    "billing_status": "ready",
                }),
            )
            .await;
        }
    }

    Ok(())
}

fn err(status: StatusCode, message: &str) -> axum::response::Response {
    (
        status,
        Json(serde_json::json!({
            "error": status.canonical_reason().unwrap_or("error"),
            "message": message
        })),
    )
        .into_response()
}

async fn list_my_concierge_services(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
) -> axum::response::Response {
    if let Err(resp) = auth.require_any_role(&[Role::Patient]) {
        return resp;
    }

    let patient_id = match resolve_self_patient_id(&state, auth.user_id).await {
        Ok(value) => value,
        Err(resp) => return resp,
    };

    match sqlx::query(
        r#"SELECT cs.id, cs.patient_id, cs.appointment_id, cs.provider_id, cs.provider_service_id, cs.assigned_concierge_id,
                  cs.service_kind, cs.taxonomy_node_id, cs.title, cs.status, cs.booking_reference, cs.vendor_name,
                  cs.vendor_contact, cs.starts_at, cs.ends_at, cs.cost_estimate, cs.actual_cost,
                  cs.quantity, cs.unit_price, cs.currency, cs.billing_status, cs.service_notes, cs.billing_notes,
                  cs.completed_at, cs.billed_at, cs.created_at, cs.updated_at, cs.request_source,
                  p.patient_id AS patient_code, p.first_name, p.last_name,
                  pr.name AS provider_name,
                  sc.service_name AS provider_service_name,
                  ptn.code AS taxonomy_node_code, ptn.name_de AS taxonomy_node_name_de,
                  ptn.name_ru AS taxonomy_node_name_ru,
                  u.name AS assigned_concierge_name,
                  a.title AS appointment_title
           FROM concierge_services cs
           JOIN patients p ON p.id = cs.patient_id
           LEFT JOIN providers pr ON pr.id = cs.provider_id
           LEFT JOIN service_catalog sc ON sc.id = cs.provider_service_id
           LEFT JOIN provider_taxonomy_nodes ptn ON ptn.id = cs.taxonomy_node_id
           LEFT JOIN users u ON u.id = cs.assigned_concierge_id
           LEFT JOIN appointments a ON a.id = cs.appointment_id
           WHERE cs.patient_id = $1
           ORDER BY COALESCE(cs.starts_at, cs.created_at) DESC, cs.created_at DESC"#,
    )
    .bind(patient_id)
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => Json(
            rows.into_iter()
                .map(|row| build_portal_service_json(&row))
                .collect::<Vec<_>>(),
        )
        .into_response(),
        Err(e) => {
            tracing::error!(error = %e, user_id = %auth.user_id, patient_id = %patient_id, "list my concierge services");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to load concierge services",
            )
        }
    }
}

async fn create_my_concierge_service(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Json(body): Json<CreateMyConciergeServiceRequest>,
) -> axum::response::Response {
    if let Err(resp) = auth.require_any_role(&[Role::Patient]) {
        return resp;
    }

    if body.title.trim().is_empty() || body.title.len() > 255 {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Service title is required (max 255)",
        );
    }
    let service_kind = body.service_kind.trim().to_string();
    if !is_valid_service_kind(&service_kind) {
        return err(StatusCode::UNPROCESSABLE_ENTITY, "Invalid service_kind");
    }

    let patient_id = match resolve_self_patient_id(&state, auth.user_id).await {
        Ok(value) => value,
        Err(resp) => return resp,
    };

    let starts_at = match parse_optional_datetime(body.starts_at.as_deref()) {
        Ok(value) => value,
        Err(message) => return err(StatusCode::UNPROCESSABLE_ENTITY, message),
    };
    let ends_at = match parse_optional_datetime(body.ends_at.as_deref()) {
        Ok(value) => value,
        Err(message) => return err(StatusCode::UNPROCESSABLE_ENTITY, message),
    };

    if let (Some(starts_at), Some(ends_at)) = (starts_at.as_ref(), ends_at.as_ref())
        && ends_at <= starts_at
    {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "ends_at must be later than starts_at",
        );
    }

    let currency = body.currency.unwrap_or_else(|| "EUR".to_string());
    if currency.trim().len() != 3 {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "currency must be 3 letters",
        );
    }

    let assigned_concierge_id = match load_first_assigned_concierge_id(&state, patient_id).await {
        Ok(value) => value,
        Err(resp) => return resp,
    };
    let normalized_vendor_name = normalize_optional_text(body.vendor_name.as_deref());
    let normalized_vendor_contact = normalize_optional_text(body.vendor_contact.as_deref());
    let normalized_notes = normalize_optional_text(body.service_notes.as_deref());
    if let Some(taxonomy_node_id) = body.taxonomy_node_id
        && let Err(resp) = validate_non_medical_taxonomy_node(&state, taxonomy_node_id).await
    {
        return resp;
    }

    let service_id = match sqlx::query_scalar::<_, Uuid>(
        r#"INSERT INTO concierge_services (
                patient_id, appointment_id, provider_id, assigned_concierge_id, service_kind, taxonomy_node_id,
                title, status, booking_reference, vendor_name, vendor_contact,
                starts_at, ends_at, cost_estimate, actual_cost, currency,
                billing_status, service_notes, billing_notes, request_source, created_by
           ) VALUES (
                $1, NULL, NULL, $2, $3, $4,
                $5, 'planned', NULL, $6, $7,
                $8, $9, $10, NULL, $11,
                'draft', $12, NULL, 'patient_portal', $13
           )
           RETURNING id"#,
    )
    .bind(patient_id)
    .bind(assigned_concierge_id)
    .bind(service_kind.as_str())
    .bind(body.taxonomy_node_id)
    .bind(body.title.trim())
    .bind(normalized_vendor_name.clone())
    .bind(normalized_vendor_contact.clone())
    .bind(starts_at)
    .bind(ends_at)
    .bind(body.cost_estimate)
    .bind(currency.to_uppercase())
    .bind(normalized_notes.clone())
    .bind(auth.user_id)
    .fetch_one(&state.db)
    .await
    {
        Ok(id) => id,
        Err(e) => {
            tracing::error!(error = %e, user_id = %auth.user_id, patient_id = %patient_id, "create patient portal concierge service");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to create concierge service request",
            );
        }
    };

    state.audit_sender.try_send(audit::domain_event(
        "create_patient_portal_concierge_service",
        Some(auth.user_id),
        "concierge_service",
        Some(service_id),
        serde_json::json!({
            "patient_id": patient_id,
            "service_kind": service_kind.clone(),
            "taxonomy_node_id": body.taxonomy_node_id,
            "assigned_concierge_id": assigned_concierge_id,
            "request_source": "patient_portal",
            "created_via": "patient_self_service",
        }),
    ));

    let patient_label = load_patient_label(&state, patient_id)
        .await
        .unwrap_or_else(|| "Patient".to_string());
    let timing_hint = starts_at
        .map(|value| value.format("%Y-%m-%d %H:%M UTC").to_string())
        .unwrap_or_else(|| "No preferred slot".to_string());
    if let Ok(notification_rows) = sqlx::query(
        r#"INSERT INTO user_notifications (user_id, kind, title, body, entity_type, entity_id)
           SELECT DISTINCT pa.user_id, 'concierge_service_request', $2, $3, 'concierge_service', $1
           FROM patient_assignments pa
           JOIN users u ON u.id = pa.user_id
           WHERE pa.patient_id = $4
             AND pa.revoked_at IS NULL
             AND u.is_active = true
             AND u.role IN ('patient_manager', 'concierge')
           RETURNING id, user_id"#,
    )
    .bind(service_id)
    .bind(format!("Patient service request: {patient_label}"))
    .bind(format!(
        "Requested {} support for '{}'. Preferred slot: {}.",
        service_kind_label(&service_kind),
        body.title.trim(),
        timing_hint
    ))
    .bind(patient_id)
    .fetch_all(&state.db)
    .await
    {
        for notification_row in notification_rows {
            let notification_id = notification_row
                .try_get::<Uuid, _>("id")
                .unwrap_or_else(|_| Uuid::nil());
            let user_id = notification_row
                .try_get::<Uuid, _>("user_id")
                .unwrap_or_else(|_| Uuid::nil());
            if notification_id != Uuid::nil() && user_id != Uuid::nil() {
                crate::realtime::publish_notification_event(
                    &state,
                    user_id,
                    "notification.created",
                    Some(notification_id),
                    serde_json::json!({
                        "entity_type": "concierge_service",
                        "entity_id": service_id,
                    }),
                )
                .await;
            }
        }
    }

    crate::realtime::publish_concierge_service_event(
        &state,
        Some(auth.user_id),
        "concierge_service.created",
        service_id,
        serde_json::json!({
            "request_source": "patient_portal",
            "service_kind": service_kind,
            "status": "planned",
        }),
    )
    .await;

    match load_service_row(&state, service_id).await {
        Ok(Some(service)) => (
            StatusCode::CREATED,
            Json(build_portal_service_json(&service)),
        )
            .into_response(),
        Ok(None) => err(StatusCode::NOT_FOUND, "Concierge service not found"),
        Err(resp) => resp,
    }
}

async fn cancel_my_concierge_service(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(service_id): Path<Uuid>,
) -> axum::response::Response {
    if let Err(resp) = auth.require_any_role(&[Role::Patient]) {
        return resp;
    }

    let patient_id = match resolve_self_patient_id(&state, auth.user_id).await {
        Ok(value) => value,
        Err(resp) => return resp,
    };

    let existing = match load_service_row(&state, service_id).await {
        Ok(Some(row)) => row,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Concierge service not found"),
        Err(resp) => return resp,
    };

    let row_patient_id = match existing.try_get::<Uuid, _>("patient_id") {
        Ok(value) => value,
        Err(_) => {
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to validate concierge service",
            );
        }
    };
    if row_patient_id != patient_id {
        return err(StatusCode::FORBIDDEN, "Insufficient permissions");
    }

    let request_source = existing
        .try_get::<String, _>("request_source")
        .unwrap_or_else(|_| "staff".to_string());
    let status = existing
        .try_get::<String, _>("status")
        .unwrap_or_else(|_| "planned".to_string());
    let booking_reference = existing
        .try_get::<Option<String>, _>("booking_reference")
        .unwrap_or_default();

    if request_source != "patient_portal" {
        return err(
            StatusCode::CONFLICT,
            "Only patient-portal requests can be cancelled here",
        );
    }
    if status != "planned" || booking_reference.is_some() {
        return err(
            StatusCode::CONFLICT,
            "Service request is already being processed and can no longer be cancelled",
        );
    }

    match sqlx::query(
        r#"UPDATE concierge_services
           SET status = 'cancelled'
           WHERE id = $1"#,
    )
    .bind(service_id)
    .execute(&state.db)
    .await
    {
        Ok(_) => {
            state.audit_sender.try_send(audit::domain_event(
                "cancel_patient_portal_concierge_service",
                Some(auth.user_id),
                "concierge_service",
                Some(service_id),
                serde_json::json!({
                    "patient_id": patient_id,
                    "request_source": "patient_portal",
                }),
            ));

            crate::realtime::publish_concierge_service_event(
                &state,
                Some(auth.user_id),
                "concierge_service.cancelled",
                service_id,
                serde_json::json!({
                    "request_source": "patient_portal",
                    "status": "cancelled",
                }),
            )
            .await;

            match load_service_row(&state, service_id).await {
                Ok(Some(service)) => Json(build_portal_service_json(&service)).into_response(),
                Ok(None) => err(StatusCode::NOT_FOUND, "Concierge service not found"),
                Err(resp) => resp,
            }
        }
        Err(e) => {
            tracing::error!(error = %e, user_id = %auth.user_id, service_id = %service_id, "cancel patient concierge service");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to cancel concierge service request",
            )
        }
    }
}

async fn list_concierge_services(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Query(query): Query<ListConciergeServicesQuery>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[
        Role::Ceo,
        Role::PatientManager,
        Role::Concierge,
        Role::Billing,
    ]) {
        return e;
    }

    if let Some(ref value) = query.service_kind
        && !is_valid_service_kind(value)
    {
        return err(StatusCode::UNPROCESSABLE_ENTITY, "Invalid service_kind");
    }
    if let Some(ref value) = query.status
        && !is_valid_service_status(value)
    {
        return err(StatusCode::UNPROCESSABLE_ENTITY, "Invalid status");
    }
    if let Some(ref value) = query.billing_status
        && !is_valid_billing_status(value)
    {
        return err(StatusCode::UNPROCESSABLE_ENTITY, "Invalid billing_status");
    }

    let mine_only = query.mine_only.unwrap_or(false);
    let search_pattern = format!("%{}%", query.search.unwrap_or_default());
    let effective_assignee = if mine_only && matches!(auth.role, Role::Concierge | Role::Billing) {
        Some(auth.user_id)
    } else {
        query.assigned_concierge_id
    };

    let rows = match sqlx::query(
        r#"SELECT cs.id, cs.patient_id, cs.appointment_id, cs.provider_id, cs.provider_service_id, cs.assigned_concierge_id,
                  cs.service_kind, cs.taxonomy_node_id, cs.title, cs.status, cs.booking_reference, cs.vendor_name,
                  cs.vendor_contact, cs.starts_at, cs.ends_at, cs.cost_estimate, cs.actual_cost,
                  cs.quantity, cs.unit_price, cs.currency, cs.billing_status, cs.service_notes, cs.billing_notes, cs.request_source,
                  cs.completed_at, cs.billed_at, cs.created_at, cs.updated_at,
                  p.patient_id AS patient_code, p.first_name, p.last_name,
                  pr.name AS provider_name,
                  sc.service_name AS provider_service_name,
                  ptn.code AS taxonomy_node_code, ptn.name_de AS taxonomy_node_name_de,
                  ptn.name_ru AS taxonomy_node_name_ru,
                  u.name AS assigned_concierge_name,
                  a.title AS appointment_title
           FROM concierge_services cs
           JOIN patients p ON p.id = cs.patient_id
           LEFT JOIN providers pr ON pr.id = cs.provider_id
           LEFT JOIN service_catalog sc ON sc.id = cs.provider_service_id
           LEFT JOIN provider_taxonomy_nodes ptn ON ptn.id = cs.taxonomy_node_id
           LEFT JOIN users u ON u.id = cs.assigned_concierge_id
           LEFT JOIN appointments a ON a.id = cs.appointment_id
           WHERE ($1::text = '%%'
                  OR cs.title ILIKE $1
                  OR COALESCE(cs.booking_reference, '') ILIKE $1
                  OR COALESCE(cs.vendor_name, '') ILIKE $1
                  OR COALESCE(cs.vendor_contact, '') ILIKE $1
                  OR COALESCE(pr.name, '') ILIKE $1
                  OR COALESCE(sc.service_name, '') ILIKE $1
                  OR COALESCE(ptn.code, '') ILIKE $1
                  OR COALESCE(ptn.name_de, '') ILIKE $1
                  OR COALESCE(ptn.name_ru, '') ILIKE $1
                  OR COALESCE(a.title, '') ILIKE $1
                  OR p.first_name ILIKE $1
                  OR p.last_name ILIKE $1
                  OR p.patient_id ILIKE $1)
             AND ($2::uuid IS NULL OR cs.patient_id = $2)
             AND ($3::uuid IS NULL OR cs.appointment_id = $3)
             AND ($4::uuid IS NULL OR cs.provider_id = $4)
             AND ($5::uuid IS NULL OR cs.assigned_concierge_id = $5)
             AND ($6::text IS NULL OR cs.service_kind = $6)
             AND ($7::text IS NULL OR cs.status = $7)
             AND ($8::text IS NULL OR cs.billing_status = $8)
             AND (
                $9::uuid IS NULL
                OR EXISTS (
                    WITH RECURSIVE selected_taxonomy AS (
                        SELECT n.id
                        FROM provider_taxonomy_nodes n
                        WHERE n.id = $9

                        UNION ALL

                        SELECT child.id
                        FROM provider_taxonomy_nodes child
                        JOIN selected_taxonomy parent
                          ON child.parent_id = parent.id
                    )
                    SELECT 1
                    FROM selected_taxonomy st
                    WHERE st.id = cs.taxonomy_node_id
                )
             )
           ORDER BY COALESCE(cs.starts_at, cs.created_at) DESC, cs.created_at DESC
           LIMIT 200"#,
    )
    .bind(search_pattern)
    .bind(query.patient_id)
    .bind(query.appointment_id)
    .bind(query.provider_id)
    .bind(effective_assignee)
    .bind(query.service_kind)
    .bind(query.status)
    .bind(query.billing_status)
    .bind(query.taxonomy_node_id)
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => rows,
        Err(e) => {
            tracing::error!(error = %e, "list concierge services");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };

    let mut items = Vec::with_capacity(rows.len());
    for row in rows {
        let patient_id: Uuid = match row.try_get("patient_id") {
            Ok(value) => value,
            Err(_) => return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed"),
        };
        let assigned_concierge_id = row
            .try_get::<Option<Uuid>, _>("assigned_concierge_id")
            .unwrap_or_default();
        match can_access_service(&state, &auth, patient_id, assigned_concierge_id).await {
            Ok(true) => items.push(build_service_json(&row)),
            Ok(false) => {}
            Err(resp) => return resp,
        }
    }

    Json(items).into_response()
}

async fn get_concierge_service(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(service_id): Path<Uuid>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[
        Role::Ceo,
        Role::PatientManager,
        Role::Concierge,
        Role::Billing,
    ]) {
        return e;
    }

    match load_service_row(&state, service_id).await {
        Ok(Some(row)) => {
            let patient_id: Uuid = match row.try_get("patient_id") {
                Ok(value) => value,
                Err(_) => return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed"),
            };
            let assigned_concierge_id = row
                .try_get::<Option<Uuid>, _>("assigned_concierge_id")
                .unwrap_or_default();
            match can_access_service(&state, &auth, patient_id, assigned_concierge_id).await {
                Ok(true) => Json(build_service_json(&row)).into_response(),
                Ok(false) => err(StatusCode::FORBIDDEN, "Insufficient permissions"),
                Err(resp) => resp,
            }
        }
        Ok(None) => err(StatusCode::NOT_FOUND, "Concierge service not found"),
        Err(resp) => resp,
    }
}

async fn create_concierge_service(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Json(body): Json<CreateConciergeServiceRequest>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::Ceo, Role::PatientManager, Role::Concierge]) {
        return e;
    }

    if body.title.trim().is_empty() || body.title.len() > 255 {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Service title is required (max 255)",
        );
    }

    let appointment_ctx = match body.appointment_id {
        Some(appointment_id) => {
            match load_non_medical_appointment_context(&state, appointment_id).await {
                Ok(Some(ctx)) => Some(ctx),
                Ok(None) => {
                    return err(
                        StatusCode::UNPROCESSABLE_ENTITY,
                        "appointment_id must reference a non-medical appointment",
                    );
                }
                Err(resp) => return resp,
            }
        }
        None => None,
    };

    if let Some(ctx) = appointment_ctx.as_ref()
        && ctx.patient_id != body.patient_id
    {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "patient_id must match the selected appointment",
        );
    }

    if let Err(resp) = ensure_patient_access(&state, &auth, body.patient_id).await {
        return resp;
    }

    let provider_service_pricing = match body.provider_service_id {
        Some(provider_service_id) => {
            match load_provider_service_pricing(&state, provider_service_id).await {
                Ok(Some(value)) => Some(value),
                Ok(None) => {
                    return err(
                        StatusCode::UNPROCESSABLE_ENTITY,
                        "provider_service_id must reference an active non-medical provider service",
                    );
                }
                Err(resp) => return resp,
            }
        }
        None => None,
    };

    let provider_id = match (
        body.provider_id,
        provider_service_pricing
            .as_ref()
            .map(|service| service.provider_id),
        appointment_ctx.as_ref().and_then(|ctx| ctx.provider_id),
    ) {
        (Some(provider_id), Some(service_provider_id), _) if provider_id != service_provider_id => {
            return err(
                StatusCode::UNPROCESSABLE_ENTITY,
                "provider_service_id must belong to provider_id",
            );
        }
        (Some(provider_id), _, _) => {
            if let Err(resp) = validate_non_medical_provider(&state, provider_id).await {
                return resp;
            }
            Some(provider_id)
        }
        (None, Some(service_provider_id), _) => Some(service_provider_id),
        (None, None, some_provider) => some_provider,
    };
    let taxonomy_node_id = match body.taxonomy_node_id {
        Some(taxonomy_node_id) => {
            if let Err(resp) = validate_non_medical_taxonomy_node(&state, taxonomy_node_id).await {
                return resp;
            }
            Some(taxonomy_node_id)
        }
        None => provider_service_pricing
            .as_ref()
            .and_then(|service| service.taxonomy_node_id)
            .or(
                match load_primary_provider_taxonomy_node_id(&state, provider_id).await {
                    Ok(value) => value,
                    Err(resp) => return resp,
                },
            ),
    };

    let assigned_concierge_id = match body.assigned_concierge_id {
        Some(user_id) => match load_active_concierge_role(&state, user_id).await {
            Ok(Some(_)) => Some(user_id),
            Ok(None) => {
                return err(
                    StatusCode::UNPROCESSABLE_ENTITY,
                    "assigned_concierge_id must reference an active concierge",
                );
            }
            Err(resp) => return resp,
        },
        None if auth.role == Role::Concierge => Some(auth.user_id),
        None => None,
    };

    let service_kind = match body.service_kind {
        Some(value) => {
            if !is_valid_service_kind(&value) {
                return err(StatusCode::UNPROCESSABLE_ENTITY, "Invalid service_kind");
            }
            value
        }
        None => derive_service_kind(
            appointment_ctx
                .as_ref()
                .and_then(|ctx| ctx.category.as_deref()),
            &body.title,
        ),
    };

    let starts_at = match parse_optional_datetime(body.starts_at.as_deref()) {
        Ok(Some(value)) => Some(value),
        Ok(None) => appointment_ctx.as_ref().and_then(|ctx| ctx.starts_at),
        Err(message) => return err(StatusCode::UNPROCESSABLE_ENTITY, message),
    };
    let ends_at = match parse_optional_datetime(body.ends_at.as_deref()) {
        Ok(Some(value)) => Some(value),
        Ok(None) => appointment_ctx.as_ref().and_then(|ctx| ctx.ends_at),
        Err(message) => return err(StatusCode::UNPROCESSABLE_ENTITY, message),
    };

    if let (Some(starts_at), Some(ends_at)) = (starts_at, ends_at)
        && ends_at <= starts_at
    {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "ends_at must be later than starts_at",
        );
    }

    let quantity = match normalize_positive_number(body.quantity, 1.0, "quantity") {
        Ok(value) => value,
        Err(message) => return err(StatusCode::UNPROCESSABLE_ENTITY, message),
    };
    let unit_price = match provider_service_pricing.as_ref() {
        Some(service) => match service.unit_price {
            Some(value) => Some(value),
            None => match normalize_optional_non_negative(body.unit_price, "unit_price") {
                Ok(value) => value,
                Err(message) => return err(StatusCode::UNPROCESSABLE_ENTITY, message),
            },
        },
        None => match normalize_optional_non_negative(body.unit_price, "unit_price") {
            Ok(value) => value,
            Err(message) => return err(StatusCode::UNPROCESSABLE_ENTITY, message),
        },
    };
    let cost_estimate = match unit_price {
        Some(value) if provider_service_pricing.is_some() => Some(round_money(quantity * value)),
        _ => body.cost_estimate,
    };

    let currency = body
        .currency
        .or_else(|| {
            provider_service_pricing
                .as_ref()
                .map(|service| service.currency.clone())
        })
        .unwrap_or_else(|| "EUR".to_string());
    if currency.trim().len() != 3 {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "currency must be 3 letters",
        );
    }

    match sqlx::query(
        r#"INSERT INTO concierge_services (
                patient_id, appointment_id, provider_id, provider_service_id, assigned_concierge_id, service_kind, taxonomy_node_id,
                title, status, booking_reference, vendor_name, vendor_contact,
                starts_at, ends_at, cost_estimate, actual_cost, quantity, unit_price, currency,
                billing_status, service_notes, billing_notes, request_source, created_by
           ) VALUES (
                $1, $2, $3, $4, $5, $6, $7,
                $8, 'planned', $9, $10, $11,
                $12, $13, $14, $15, $16, $17, $18,
                'draft', $19, $20, 'staff', $21
           ) RETURNING id"#,
    )
    .bind(body.patient_id)
    .bind(body.appointment_id)
    .bind(provider_id)
    .bind(body.provider_service_id)
    .bind(assigned_concierge_id)
    .bind(service_kind.clone())
    .bind(taxonomy_node_id)
    .bind(body.title.trim())
    .bind(body.booking_reference)
    .bind(body.vendor_name)
    .bind(body.vendor_contact)
    .bind(starts_at)
    .bind(ends_at)
    .bind(cost_estimate)
    .bind(body.actual_cost)
    .bind(quantity)
    .bind(unit_price)
    .bind(currency.to_uppercase())
    .bind(body.service_notes)
    .bind(body.billing_notes)
    .bind(auth.user_id)
    .fetch_one(&state.db)
    .await
    {
        Ok(row) => {
            let service_id: Uuid = match row.try_get("id") {
                Ok(value) => value,
                Err(_) => return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed"),
            };
            state.audit_sender.try_send(audit::domain_event(
                "create_concierge_service",
                Some(auth.user_id),
                "concierge_service",
                Some(service_id),
                serde_json::json!({
                    "appointment_id": body.appointment_id,
                    "patient_id": body.patient_id,
                    "provider_id": provider_id,
                    "provider_service_id": body.provider_service_id,
                    "assigned_concierge_id": assigned_concierge_id,
                }),
            ));

            crate::realtime::publish_concierge_service_event(
                &state,
                Some(auth.user_id),
                "concierge_service.created",
                service_id,
                serde_json::json!({
                    "appointment_id": body.appointment_id,
                    "request_source": "staff",
                    "service_kind": service_kind,
                    "status": "planned",
                }),
            )
            .await;

            match load_service_row(&state, service_id).await {
                Ok(Some(service)) => {
                    (StatusCode::CREATED, Json(build_service_json(&service))).into_response()
                }
                Ok(None) => err(StatusCode::NOT_FOUND, "Concierge service not found"),
                Err(resp) => resp,
            }
        }
        Err(e) => {
            tracing::error!(error = %e, "create concierge service");
            err(StatusCode::INTERNAL_SERVER_ERROR, "Failed")
        }
    }
}

async fn update_concierge_service(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(service_id): Path<Uuid>,
    Json(body): Json<UpdateConciergeServiceRequest>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[
        Role::Ceo,
        Role::PatientManager,
        Role::Concierge,
        Role::Billing,
    ]) {
        return e;
    }

    let existing = match load_service_row(&state, service_id).await {
        Ok(Some(row)) => row,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Concierge service not found"),
        Err(resp) => return resp,
    };

    let patient_id: Uuid = match existing.try_get("patient_id") {
        Ok(value) => value,
        Err(_) => return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed"),
    };
    let existing_assignee = existing
        .try_get::<Option<Uuid>, _>("assigned_concierge_id")
        .unwrap_or_default();
    match can_access_service(&state, &auth, patient_id, existing_assignee).await {
        Ok(true) => {}
        Ok(false) => return err(StatusCode::FORBIDDEN, "Insufficient permissions"),
        Err(resp) => return resp,
    }

    if let Err(resp) = validate_update_fields_for_role(&auth, &body) {
        return resp;
    }

    if let Some(ref value) = body.service_kind
        && !is_valid_service_kind(value)
    {
        return err(StatusCode::UNPROCESSABLE_ENTITY, "Invalid service_kind");
    }
    if let Some(ref value) = body.status
        && !is_valid_service_status(value)
    {
        return err(StatusCode::UNPROCESSABLE_ENTITY, "Invalid status");
    }
    if let Some(ref value) = body.billing_status
        && !is_valid_billing_status(value)
    {
        return err(StatusCode::UNPROCESSABLE_ENTITY, "Invalid billing_status");
    }
    if let Some(ref value) = body.title
        && (value.trim().is_empty() || value.len() > 255)
    {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Service title is required (max 255)",
        );
    }
    let provider_service_pricing = match body.provider_service_id {
        Some(provider_service_id) => {
            match load_provider_service_pricing(&state, provider_service_id).await {
                Ok(Some(value)) => Some(value),
                Ok(None) => {
                    return err(
                        StatusCode::UNPROCESSABLE_ENTITY,
                        "provider_service_id must reference an active non-medical provider service",
                    );
                }
                Err(resp) => return resp,
            }
        }
        None => None,
    };
    let provider_id_update = match (
        body.provider_id,
        provider_service_pricing
            .as_ref()
            .map(|service| service.provider_id),
    ) {
        (Some(provider_id), Some(service_provider_id)) if provider_id != service_provider_id => {
            return err(
                StatusCode::UNPROCESSABLE_ENTITY,
                "provider_service_id must belong to provider_id",
            );
        }
        (Some(provider_id), _) => Some(provider_id),
        (None, Some(service_provider_id)) => Some(service_provider_id),
        (None, None) => None,
    };

    if let Some(provider_id) = provider_id_update
        && let Err(resp) = validate_non_medical_provider(&state, provider_id).await
    {
        return resp;
    }
    if let Some(taxonomy_node_id) = body.taxonomy_node_id
        && let Err(resp) = validate_non_medical_taxonomy_node(&state, taxonomy_node_id).await
    {
        return resp;
    }
    if let Some(assignee_id) = body.assigned_concierge_id {
        match load_active_concierge_role(&state, assignee_id).await {
            Ok(Some(_)) => {}
            Ok(None) => {
                return err(
                    StatusCode::UNPROCESSABLE_ENTITY,
                    "assigned_concierge_id must reference an active concierge",
                );
            }
            Err(resp) => return resp,
        }
    }

    let booking_reference = match parse_optional_text_patch(
        &body.booking_reference,
        existing
            .try_get::<Option<String>, _>("booking_reference")
            .unwrap_or_default(),
        "booking_reference",
    ) {
        Ok(value) => value,
        Err(message) => return err(StatusCode::UNPROCESSABLE_ENTITY, message),
    };
    let vendor_name = match parse_optional_text_patch(
        &body.vendor_name,
        existing
            .try_get::<Option<String>, _>("vendor_name")
            .unwrap_or_default(),
        "vendor_name",
    ) {
        Ok(value) => value,
        Err(message) => return err(StatusCode::UNPROCESSABLE_ENTITY, message),
    };
    let vendor_contact = match parse_optional_text_patch(
        &body.vendor_contact,
        existing
            .try_get::<Option<String>, _>("vendor_contact")
            .unwrap_or_default(),
        "vendor_contact",
    ) {
        Ok(value) => value,
        Err(message) => return err(StatusCode::UNPROCESSABLE_ENTITY, message),
    };
    let starts_at = match parse_optional_datetime_patch(
        &body.starts_at,
        existing
            .try_get::<Option<chrono::DateTime<chrono::Utc>>, _>("starts_at")
            .unwrap_or_default(),
    ) {
        Ok(value) => value,
        Err(message) => return err(StatusCode::UNPROCESSABLE_ENTITY, message),
    };
    let ends_at = match parse_optional_datetime_patch(
        &body.ends_at,
        existing
            .try_get::<Option<chrono::DateTime<chrono::Utc>>, _>("ends_at")
            .unwrap_or_default(),
    ) {
        Ok(value) => value,
        Err(message) => return err(StatusCode::UNPROCESSABLE_ENTITY, message),
    };
    let service_notes = match parse_optional_text_patch(
        &body.service_notes,
        existing
            .try_get::<Option<String>, _>("service_notes")
            .unwrap_or_default(),
        "service_notes",
    ) {
        Ok(value) => value,
        Err(message) => return err(StatusCode::UNPROCESSABLE_ENTITY, message),
    };
    let billing_notes = match parse_optional_text_patch(
        &body.billing_notes,
        existing
            .try_get::<Option<String>, _>("billing_notes")
            .unwrap_or_default(),
        "billing_notes",
    ) {
        Ok(value) => value,
        Err(message) => return err(StatusCode::UNPROCESSABLE_ENTITY, message),
    };

    if let (Some(starts_at), Some(ends_at)) = (starts_at, ends_at)
        && ends_at <= starts_at
    {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "ends_at must be later than starts_at",
        );
    }

    if let Some(ref currency) = body.currency
        && currency.trim().len() != 3
    {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "currency must be 3 letters",
        );
    }

    let quantity = match body.quantity {
        Some(value) => match normalize_positive_number(Some(value), 1.0, "quantity") {
            Ok(value) => Some(value),
            Err(message) => return err(StatusCode::UNPROCESSABLE_ENTITY, message),
        },
        None => None,
    };
    let unit_price = match provider_service_pricing.as_ref() {
        Some(service) => match service.unit_price {
            Some(value) => Some(value),
            None => match normalize_optional_non_negative(body.unit_price, "unit_price") {
                Ok(value) => value,
                Err(message) => return err(StatusCode::UNPROCESSABLE_ENTITY, message),
            },
        },
        None => match normalize_optional_non_negative(body.unit_price, "unit_price") {
            Ok(value) => value,
            Err(message) => return err(StatusCode::UNPROCESSABLE_ENTITY, message),
        },
    };
    let existing_quantity = existing
        .try_get::<rust_decimal::Decimal, _>("quantity")
        .ok()
        .and_then(|value| value.to_string().parse::<f64>().ok())
        .unwrap_or(1.0);
    let existing_unit_price = existing
        .try_get::<Option<rust_decimal::Decimal>, _>("unit_price")
        .ok()
        .flatten()
        .and_then(|value| value.to_string().parse::<f64>().ok());
    let existing_cost_estimate = existing
        .try_get::<Option<rust_decimal::Decimal>, _>("cost_estimate")
        .ok()
        .flatten()
        .and_then(|value| value.to_string().parse::<f64>().ok());
    let existing_actual_cost = existing
        .try_get::<Option<rust_decimal::Decimal>, _>("actual_cost")
        .ok()
        .flatten()
        .and_then(|value| value.to_string().parse::<f64>().ok());
    let requested_cost_estimate = match parse_optional_non_negative_patch(
        &body.cost_estimate,
        existing_cost_estimate,
        "cost_estimate",
    ) {
        Ok(value) => value,
        Err(message) => return err(StatusCode::UNPROCESSABLE_ENTITY, message),
    };
    let actual_cost = match parse_optional_non_negative_patch(
        &body.actual_cost,
        existing_actual_cost,
        "actual_cost",
    ) {
        Ok(value) => value,
        Err(message) => return err(StatusCode::UNPROCESSABLE_ENTITY, message),
    };
    let cost_estimate = match unit_price.or(existing_unit_price) {
        Some(value)
            if body.provider_service_id.is_some()
                || body.quantity.is_some()
                || body.unit_price.is_some() =>
        {
            Some(round_money(quantity.unwrap_or(existing_quantity) * value))
        }
        _ => requested_cost_estimate,
    };
    let currency = body.currency.or_else(|| {
        provider_service_pricing
            .as_ref()
            .map(|service| service.currency.clone())
    });

    let completed_at = match body.status.as_deref() {
        Some("completed") => Some(chrono::Utc::now()),
        _ => None,
    };
    let billed_at = match body.billing_status.as_deref() {
        Some("billed") | Some("settled") => Some(chrono::Utc::now()),
        _ => None,
    };
    let audit_status = body.status.clone();
    let audit_billing_status = body.billing_status.clone();
    let audit_assigned_concierge_id = body.assigned_concierge_id;

    match sqlx::query(
        r#"UPDATE concierge_services
           SET provider_id = COALESCE($2, provider_id),
               assigned_concierge_id = COALESCE($3, assigned_concierge_id),
               service_kind = COALESCE($4, service_kind),
               title = COALESCE($5, title),
               status = COALESCE($6, status),
               billing_status = COALESCE($7, billing_status),
               booking_reference = $8,
               vendor_name = $9,
               vendor_contact = $10,
               starts_at = $11,
               ends_at = $12,
               cost_estimate = $13,
               actual_cost = $14,
               currency = COALESCE($15, currency),
               service_notes = $16,
               billing_notes = $17,
               completed_at = COALESCE($18, completed_at),
               billed_at = COALESCE($19, billed_at),
               taxonomy_node_id = COALESCE($20, taxonomy_node_id),
               provider_service_id = COALESCE($21, provider_service_id),
               quantity = COALESCE($22, quantity),
               unit_price = COALESCE($23, unit_price)
           WHERE id = $1"#,
    )
    .bind(service_id)
    .bind(provider_id_update)
    .bind(body.assigned_concierge_id)
    .bind(body.service_kind)
    .bind(body.title.map(|value| value.trim().to_string()))
    .bind(body.status)
    .bind(body.billing_status)
    .bind(booking_reference)
    .bind(vendor_name)
    .bind(vendor_contact)
    .bind(starts_at)
    .bind(ends_at)
    .bind(cost_estimate)
    .bind(actual_cost)
    .bind(currency.map(|value| value.to_uppercase()))
    .bind(service_notes)
    .bind(billing_notes)
    .bind(completed_at)
    .bind(billed_at)
    .bind(body.taxonomy_node_id)
    .bind(body.provider_service_id)
    .bind(quantity)
    .bind(unit_price)
    .execute(&state.db)
    .await
    {
        Ok(result) if result.rows_affected() > 0 => {
            state.audit_sender.try_send(audit::domain_event(
                "update_concierge_service",
                Some(auth.user_id),
                "concierge_service",
                Some(service_id),
                serde_json::json!({
                    "status": audit_status.clone(),
                    "billing_status": audit_billing_status.clone(),
                    "assigned_concierge_id": audit_assigned_concierge_id,
                }),
            ));

            let realtime_event_type = if audit_status.as_deref() == Some("cancelled") {
                "concierge_service.cancelled"
            } else {
                "concierge_service.updated"
            };
            crate::realtime::publish_concierge_service_event(
                &state,
                Some(auth.user_id),
                realtime_event_type,
                service_id,
                serde_json::json!({
                    "status": audit_status,
                    "billing_status": audit_billing_status,
                    "assigned_concierge_id": audit_assigned_concierge_id,
                }),
            )
            .await;

            match load_service_row(&state, service_id).await {
                Ok(Some(service)) => Json(build_service_json(&service)).into_response(),
                Ok(None) => err(StatusCode::NOT_FOUND, "Concierge service not found"),
                Err(resp) => resp,
            }
        }
        Ok(_) => err(StatusCode::NOT_FOUND, "Concierge service not found"),
        Err(e) => {
            tracing::error!(error = %e, service_id = %service_id, "update concierge service");
            err(StatusCode::INTERNAL_SERVER_ERROR, "Failed")
        }
    }
}

async fn load_service_row(
    state: &AppState,
    service_id: Uuid,
) -> Result<Option<sqlx::postgres::PgRow>, axum::response::Response> {
    sqlx::query(
        r#"SELECT cs.id, cs.patient_id, cs.appointment_id, cs.provider_id, cs.provider_service_id, cs.assigned_concierge_id,
                  cs.service_kind, cs.taxonomy_node_id, cs.title, cs.status, cs.booking_reference, cs.vendor_name,
                  cs.vendor_contact, cs.starts_at, cs.ends_at, cs.cost_estimate, cs.actual_cost,
                  cs.quantity, cs.unit_price, cs.currency, cs.billing_status, cs.service_notes, cs.billing_notes, cs.request_source,
                  cs.completed_at, cs.billed_at, cs.created_at, cs.updated_at,
                  p.patient_id AS patient_code, p.first_name, p.last_name,
                  pr.name AS provider_name,
                  sc.service_name AS provider_service_name,
                  ptn.code AS taxonomy_node_code, ptn.name_de AS taxonomy_node_name_de,
                  ptn.name_ru AS taxonomy_node_name_ru,
                  u.name AS assigned_concierge_name,
                  a.title AS appointment_title
           FROM concierge_services cs
           JOIN patients p ON p.id = cs.patient_id
           LEFT JOIN providers pr ON pr.id = cs.provider_id
           LEFT JOIN service_catalog sc ON sc.id = cs.provider_service_id
           LEFT JOIN provider_taxonomy_nodes ptn ON ptn.id = cs.taxonomy_node_id
           LEFT JOIN users u ON u.id = cs.assigned_concierge_id
           LEFT JOIN appointments a ON a.id = cs.appointment_id
           WHERE cs.id = $1"#,
    )
    .bind(service_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, service_id = %service_id, "Failed to load concierge service");
        err(StatusCode::INTERNAL_SERVER_ERROR, "Failed")
    })
}

async fn load_non_medical_appointment_context(
    state: &AppState,
    appointment_id: Uuid,
) -> Result<Option<NonMedicalAppointmentContext>, axum::response::Response> {
    let row = sqlx::query(
        r#"SELECT patient_id, provider_id, title, category,
                  appointment_type,
                  CASE
                      WHEN time_start IS NULL THEN NULL
                      ELSE (date::timestamp + time_start) AT TIME ZONE 'UTC'
                  END AS starts_at,
                  CASE
                      WHEN time_end IS NULL THEN NULL
                      ELSE (date::timestamp + time_end) AT TIME ZONE 'UTC'
                  END AS ends_at
           FROM appointments
           WHERE id = $1"#,
    )
    .bind(appointment_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, appointment_id = %appointment_id, "Failed to load appointment context");
        err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to validate appointment")
    })?;

    let Some(row) = row else {
        return Ok(None);
    };

    let appointment_type: String = row.try_get("appointment_type").unwrap_or_default();
    if appointment_type != "non_medical" {
        return Ok(None);
    }

    let patient_id: Uuid = row.try_get("patient_id").map_err(|_| {
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to validate appointment",
        )
    })?;

    Ok(Some(NonMedicalAppointmentContext {
        patient_id,
        provider_id: row
            .try_get::<Option<Uuid>, _>("provider_id")
            .unwrap_or_default(),
        title: row.try_get::<String, _>("title").unwrap_or_default(),
        category: row
            .try_get::<Option<String>, _>("category")
            .unwrap_or_default(),
        starts_at: row
            .try_get::<Option<chrono::DateTime<chrono::Utc>>, _>("starts_at")
            .unwrap_or_default(),
        ends_at: row
            .try_get::<Option<chrono::DateTime<chrono::Utc>>, _>("ends_at")
            .unwrap_or_default(),
    }))
}

async fn load_first_assigned_concierge_id(
    state: &AppState,
    patient_id: Uuid,
) -> Result<Option<Uuid>, axum::response::Response> {
    sqlx::query(
        r#"SELECT u.id
           FROM patient_assignments pa
           JOIN users u ON u.id = pa.user_id
           WHERE pa.patient_id = $1
             AND pa.revoked_at IS NULL
             AND u.is_active = true
             AND u.role = 'concierge'
           ORDER BY pa.assigned_at, u.name
           LIMIT 1"#,
    )
    .bind(patient_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, patient_id = %patient_id, "Failed to load concierge assignment");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to validate concierge assignment",
        )
    })
    .map(|row| row.and_then(|value| value.try_get::<Uuid, _>("id").ok()))
}

async fn load_active_concierge_role(
    state: &AppState,
    user_id: Uuid,
) -> Result<Option<String>, axum::response::Response> {
    let row = sqlx::query("SELECT role FROM users WHERE id = $1 AND is_active = true")
        .bind(user_id)
        .fetch_optional(&state.db)
        .await
        .map_err(|e| {
            tracing::error!(error = %e, user_id = %user_id, "Failed to validate concierge user");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to validate concierge user",
            )
        })?;

    let Some(row) = row else {
        return Ok(None);
    };

    let role: String = row.try_get("role").map_err(|_| {
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to validate concierge user",
        )
    })?;

    if role == "concierge" {
        Ok(Some(role))
    } else {
        Ok(None)
    }
}

async fn validate_non_medical_provider(
    state: &AppState,
    provider_id: Uuid,
) -> Result<(), axum::response::Response> {
    let row = sqlx::query("SELECT provider_type FROM providers WHERE id = $1")
        .bind(provider_id)
        .fetch_optional(&state.db)
        .await
        .map_err(|e| {
            tracing::error!(error = %e, provider_id = %provider_id, "Failed to validate provider");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to validate provider",
            )
        })?;

    let Some(row) = row else {
        return Err(err(StatusCode::UNPROCESSABLE_ENTITY, "Provider not found"));
    };

    let provider_type: String = row.try_get("provider_type").unwrap_or_default();
    if provider_type != "non_medical" {
        return Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Provider must be non_medical for concierge services",
        ));
    }

    Ok(())
}

async fn load_provider_service_pricing(
    state: &AppState,
    provider_service_id: Uuid,
) -> Result<Option<ProviderServicePricing>, axum::response::Response> {
    let row = sqlx::query(
        r#"SELECT s.provider_id,
                  s.taxonomy_node_id,
                  CASE
                      WHEN s.price_type = 'on_request' THEN NULL
                      WHEN s.price_type = 'range' THEN COALESCE(s.price_from, s.price)
                      ELSE s.price
                  END::float8 AS unit_price,
                  s.currency
           FROM service_catalog s
           JOIN providers p ON p.id = s.provider_id
           WHERE s.id = $1
             AND p.provider_type = 'non_medical'
             AND p.is_active = true
             AND (s.valid_to IS NULL OR s.valid_to >= CURRENT_DATE)"#,
    )
    .bind(provider_service_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, provider_service_id = %provider_service_id, "Failed to load provider service pricing");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to validate provider service",
        )
    })?;

    let Some(row) = row else {
        return Ok(None);
    };

    Ok(Some(ProviderServicePricing {
        provider_id: row.try_get::<Uuid, _>("provider_id").unwrap_or_default(),
        taxonomy_node_id: row
            .try_get::<Option<Uuid>, _>("taxonomy_node_id")
            .unwrap_or_default(),
        unit_price: row
            .try_get::<Option<f64>, _>("unit_price")
            .unwrap_or_default(),
        currency: row
            .try_get::<String, _>("currency")
            .unwrap_or_else(|_| "EUR".to_string()),
    }))
}

async fn validate_non_medical_taxonomy_node(
    state: &AppState,
    taxonomy_node_id: Uuid,
) -> Result<(), axum::response::Response> {
    let exists = sqlx::query_scalar::<_, bool>(
        r#"SELECT EXISTS (
               SELECT 1
               FROM provider_taxonomy_nodes
               WHERE id = $1
                 AND provider_kind = 'non_medical'
                 AND level = 'type'
                 AND is_active = true
           )"#,
    )
    .bind(taxonomy_node_id)
    .fetch_one(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, taxonomy_node_id = %taxonomy_node_id, "Failed to validate taxonomy node");
        err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to validate taxonomy")
    })?;

    if exists {
        Ok(())
    } else {
        Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "taxonomy_node_id must reference an active non-medical taxonomy leaf",
        ))
    }
}

async fn load_primary_provider_taxonomy_node_id(
    state: &AppState,
    provider_id: Option<Uuid>,
) -> Result<Option<Uuid>, axum::response::Response> {
    let Some(provider_id) = provider_id else {
        return Ok(None);
    };

    sqlx::query_scalar::<_, Option<Uuid>>(
        r#"SELECT pta.taxonomy_node_id
           FROM provider_taxonomy_assignments pta
           JOIN provider_taxonomy_nodes ptn ON ptn.id = pta.taxonomy_node_id
           WHERE pta.provider_id = $1
             AND ptn.provider_kind = 'non_medical'
             AND ptn.level = 'type'
             AND ptn.is_active = true
           ORDER BY pta.is_primary DESC, ptn.sort_order
           LIMIT 1"#,
    )
    .bind(provider_id)
    .fetch_optional(&state.db)
    .await
    .map(|value| value.flatten())
    .map_err(|e| {
        tracing::error!(error = %e, provider_id = %provider_id, "Failed to load provider taxonomy node");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to load provider taxonomy",
        )
    })
}

#[allow(clippy::result_large_err)]
fn validate_update_fields_for_role(
    auth: &AuthUser,
    body: &UpdateConciergeServiceRequest,
) -> Result<(), axum::response::Response> {
    if auth.role.has_full_access() || auth.role == Role::PatientManager {
        return Ok(());
    }

    if auth.role == Role::Concierge {
        if body.provider_id.is_some()
            || body.provider_service_id.is_some()
            || body.assigned_concierge_id.is_some()
            || body.service_kind.is_some()
            || body.taxonomy_node_id.is_some()
            || body.title.is_some()
            || body.cost_estimate.is_present()
            || body.quantity.is_some()
            || body.unit_price.is_some()
            || body.billing_status.is_some()
            || body.billing_notes.is_present()
            || body.currency.is_some()
        {
            return Err(err(
                StatusCode::FORBIDDEN,
                "Concierge can only update operational service fields",
            ));
        }
        return Ok(());
    }

    if auth.role == Role::Billing {
        if body.provider_id.is_some()
            || body.provider_service_id.is_some()
            || body.assigned_concierge_id.is_some()
            || body.service_kind.is_some()
            || body.taxonomy_node_id.is_some()
            || body.title.is_some()
            || body.status.is_some()
            || body.booking_reference.is_present()
            || body.vendor_name.is_present()
            || body.vendor_contact.is_present()
            || body.starts_at.is_present()
            || body.ends_at.is_present()
            || body.cost_estimate.is_present()
            || body.quantity.is_some()
            || body.unit_price.is_some()
            || body.service_notes.is_present()
            || body.currency.is_some()
        {
            return Err(err(
                StatusCode::FORBIDDEN,
                "Billing can only update cost handoff and billing fields",
            ));
        }
        return Ok(());
    }

    Err(err(StatusCode::FORBIDDEN, "Insufficient permissions"))
}

async fn ensure_patient_access(
    state: &AppState,
    auth: &AuthUser,
    patient_id: Uuid,
) -> Result<(), axum::response::Response> {
    match can_access_service(state, auth, patient_id, None).await {
        Ok(true) => Ok(()),
        Ok(false) => Err(err(StatusCode::FORBIDDEN, "Insufficient permissions")),
        Err(resp) => Err(resp),
    }
}

async fn can_access_service(
    state: &AppState,
    auth: &AuthUser,
    patient_id: Uuid,
    assigned_concierge_id: Option<Uuid>,
) -> Result<bool, axum::response::Response> {
    if auth.role.has_full_access() || auth.role == Role::Billing {
        return Ok(true);
    }

    if auth.role == Role::Concierge && assigned_concierge_id == Some(auth.user_id) {
        return Ok(true);
    }

    if !access::requires_patient_assignment(auth.role) {
        return Ok(false);
    }

    access::has_active_patient_assignment(&state.db, patient_id, auth.user_id)
        .await
        .map_err(|e| {
            tracing::error!(error = %e, patient_id = %patient_id, "Failed to validate concierge service access");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to validate concierge service access",
            )
        })
}

fn parse_optional_datetime(
    value: Option<&str>,
) -> Result<Option<chrono::DateTime<chrono::Utc>>, &'static str> {
    match value {
        Some(raw) if !raw.trim().is_empty() => chrono::DateTime::parse_from_rfc3339(raw)
            .map(|value| Some(value.with_timezone(&chrono::Utc)))
            .map_err(|_| "Invalid datetime (RFC3339)"),
        _ => Ok(None),
    }
}

fn parse_optional_text_patch(
    value: &NullablePatchValue,
    existing: Option<String>,
    field: &'static str,
) -> Result<Option<String>, &'static str> {
    match value {
        NullablePatchValue::Missing => Ok(existing),
        NullablePatchValue::Null => Ok(None),
        NullablePatchValue::Value(serde_json::Value::String(value)) => {
            Ok(normalize_optional_text(Some(value)))
        }
        NullablePatchValue::Value(_) => match field {
            "booking_reference" => Err("booking_reference must be text or null"),
            "vendor_name" => Err("vendor_name must be text or null"),
            "vendor_contact" => Err("vendor_contact must be text or null"),
            "service_notes" => Err("service_notes must be text or null"),
            "billing_notes" => Err("billing_notes must be text or null"),
            _ => Err("field must be text or null"),
        },
    }
}

fn parse_optional_datetime_patch(
    value: &NullablePatchValue,
    existing: Option<chrono::DateTime<chrono::Utc>>,
) -> Result<Option<chrono::DateTime<chrono::Utc>>, &'static str> {
    match value {
        NullablePatchValue::Missing => Ok(existing),
        NullablePatchValue::Null => Ok(None),
        NullablePatchValue::Value(serde_json::Value::String(value)) => {
            parse_optional_datetime(Some(value))
        }
        NullablePatchValue::Value(_) => Err("datetime field must be RFC3339 text or null"),
    }
}

fn normalize_positive_number(
    value: Option<f64>,
    default_value: f64,
    field: &'static str,
) -> Result<f64, &'static str> {
    let value = value.unwrap_or(default_value);
    if !value.is_finite() || value <= 0.0 {
        return match field {
            "quantity" => Err("quantity must be greater than zero"),
            _ => Err("value must be greater than zero"),
        };
    }
    if field == "quantity" && value.fract().abs() > f64::EPSILON {
        return Err("quantity must be a whole number");
    }
    Ok(value)
}

fn normalize_optional_non_negative(
    value: Option<f64>,
    field: &'static str,
) -> Result<Option<f64>, &'static str> {
    let Some(value) = value else {
        return Ok(None);
    };
    if !value.is_finite() || value < 0.0 {
        return match field {
            "unit_price" => Err("unit_price must be non-negative"),
            _ => Err("value must be non-negative"),
        };
    }
    Ok(Some(value))
}

fn parse_optional_non_negative_patch(
    value: &NullablePatchValue,
    existing: Option<f64>,
    field: &'static str,
) -> Result<Option<f64>, &'static str> {
    match value {
        NullablePatchValue::Missing => Ok(existing),
        NullablePatchValue::Null => Ok(None),
        NullablePatchValue::Value(serde_json::Value::Number(value)) => match value.as_f64() {
            Some(value) => normalize_optional_non_negative(Some(value), field),
            None => Err("value must be numeric or null"),
        },
        NullablePatchValue::Value(_) => Err("value must be numeric or null"),
    }
}

fn round_money(value: f64) -> f64 {
    (value * 100.0).round() / 100.0
}

fn is_valid_service_kind(value: &str) -> bool {
    matches!(
        value,
        "hotel"
            | "transfer"
            | "vip_terminal"
            | "flight"
            | "chauffeur"
            | "translation_support"
            | "other"
    )
}

fn is_valid_service_status(value: &str) -> bool {
    matches!(
        value,
        "planned" | "booked" | "confirmed" | "in_service" | "completed" | "cancelled"
    )
}

fn is_valid_billing_status(value: &str) -> bool {
    matches!(value, "draft" | "ready" | "billed" | "settled" | "waived")
}

fn derive_service_kind(category: Option<&str>, title: &str) -> String {
    let normalized = format!(
        "{} {}",
        category.unwrap_or_default().to_lowercase(),
        title.to_lowercase()
    );

    if normalized.contains("hotel") {
        "hotel".to_string()
    } else if normalized.contains("vip") && normalized.contains("terminal") {
        "vip_terminal".to_string()
    } else if normalized.contains("flight") || normalized.contains("ticket") {
        "flight".to_string()
    } else if normalized.contains("chauffeur") || normalized.contains("driver") {
        "chauffeur".to_string()
    } else if normalized.contains("transfer") || normalized.contains("airport") {
        "transfer".to_string()
    } else if normalized.contains("translation") {
        "translation_support".to_string()
    } else {
        "other".to_string()
    }
}

fn service_kind_label(value: &str) -> &'static str {
    match value {
        "hotel" => "hotel",
        "transfer" => "transfer",
        "vip_terminal" => "VIP terminal",
        "flight" => "flight",
        "chauffeur" => "chauffeur",
        "translation_support" => "translation support",
        _ => "additional",
    }
}

fn normalize_optional_text(value: Option<&str>) -> Option<String> {
    let trimmed = value?.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn can_patient_cancel_service(row: &sqlx::postgres::PgRow) -> bool {
    row.try_get::<String, _>("request_source")
        .map(|value| value == "patient_portal")
        .unwrap_or(false)
        && row
            .try_get::<String, _>("status")
            .map(|value| value == "planned")
            .unwrap_or(false)
        && row
            .try_get::<Option<String>, _>("booking_reference")
            .unwrap_or_default()
            .is_none()
}

fn build_portal_service_json(row: &sqlx::postgres::PgRow) -> serde_json::Value {
    serde_json::json!({
        "id": row.try_get::<Uuid, _>("id").unwrap_or_default(),
        "appointment_id": row.try_get::<Option<Uuid>, _>("appointment_id").unwrap_or_default(),
        "appointment_title": row.try_get::<Option<String>, _>("appointment_title").unwrap_or_default(),
        "provider_id": row.try_get::<Option<Uuid>, _>("provider_id").unwrap_or_default(),
        "provider_name": row.try_get::<Option<String>, _>("provider_name").unwrap_or_default(),
        "provider_service_id": row.try_get::<Option<Uuid>, _>("provider_service_id").unwrap_or_default(),
        "provider_service_name": row.try_get::<Option<String>, _>("provider_service_name").unwrap_or_default(),
        "assigned_concierge_name": row.try_get::<Option<String>, _>("assigned_concierge_name").unwrap_or_default(),
        "service_kind": row.try_get::<String, _>("service_kind").unwrap_or_default(),
        "taxonomy_node_id": row.try_get::<Option<Uuid>, _>("taxonomy_node_id").unwrap_or_default(),
        "taxonomy_node_code": row.try_get::<Option<String>, _>("taxonomy_node_code").unwrap_or_default(),
        "taxonomy_node_name_de": row.try_get::<Option<String>, _>("taxonomy_node_name_de").unwrap_or_default(),
        "taxonomy_node_name_ru": row.try_get::<Option<String>, _>("taxonomy_node_name_ru").unwrap_or_default(),
        "title": row.try_get::<String, _>("title").unwrap_or_default(),
        "status": row.try_get::<String, _>("status").unwrap_or_default(),
        "booking_reference": row.try_get::<Option<String>, _>("booking_reference").unwrap_or_default(),
        "vendor_name": row.try_get::<Option<String>, _>("vendor_name").unwrap_or_default(),
        "vendor_contact": row.try_get::<Option<String>, _>("vendor_contact").unwrap_or_default(),
        "starts_at": row.try_get::<Option<chrono::DateTime<chrono::Utc>>, _>("starts_at").unwrap_or_default().map(|value| value.to_rfc3339()),
        "ends_at": row.try_get::<Option<chrono::DateTime<chrono::Utc>>, _>("ends_at").unwrap_or_default().map(|value| value.to_rfc3339()),
        "cost_estimate": row.try_get::<Option<rust_decimal::Decimal>, _>("cost_estimate").unwrap_or_default().map(|value| value.round_dp(2).to_string()),
        "quantity": row.try_get::<rust_decimal::Decimal, _>("quantity").map(|value| value.round_dp(2).normalize().to_string()).unwrap_or_else(|_| "1".to_string()),
        "unit_price": row.try_get::<Option<rust_decimal::Decimal>, _>("unit_price").unwrap_or_default().map(|value| value.round_dp(2).to_string()),
        "currency": row.try_get::<String, _>("currency").unwrap_or_else(|_| "EUR".to_string()),
        "service_notes": row.try_get::<Option<String>, _>("service_notes").unwrap_or_default(),
        "request_source": row.try_get::<String, _>("request_source").unwrap_or_else(|_| "staff".to_string()),
        "completed_at": row.try_get::<Option<chrono::DateTime<chrono::Utc>>, _>("completed_at").unwrap_or_default().map(|value| value.to_rfc3339()),
        "created_at": row.try_get::<chrono::DateTime<chrono::Utc>, _>("created_at").map(|value| value.to_rfc3339()).unwrap_or_default(),
        "updated_at": row.try_get::<chrono::DateTime<chrono::Utc>, _>("updated_at").map(|value| value.to_rfc3339()).unwrap_or_default(),
        "can_cancel": can_patient_cancel_service(row),
    })
}

fn build_service_json(row: &sqlx::postgres::PgRow) -> serde_json::Value {
    let patient_name = format!(
        "{} {}",
        row.try_get::<String, _>("first_name").unwrap_or_default(),
        row.try_get::<String, _>("last_name").unwrap_or_default()
    );

    serde_json::json!({
        "id": row.try_get::<Uuid, _>("id").unwrap_or_default(),
        "patient_id": row.try_get::<Uuid, _>("patient_id").unwrap_or_default(),
        "patient_name": patient_name,
        "patient_pid": row.try_get::<String, _>("patient_code").unwrap_or_default(),
        "appointment_id": row.try_get::<Option<Uuid>, _>("appointment_id").unwrap_or_default(),
        "appointment_title": row.try_get::<Option<String>, _>("appointment_title").unwrap_or_default(),
        "provider_id": row.try_get::<Option<Uuid>, _>("provider_id").unwrap_or_default(),
        "provider_name": row.try_get::<Option<String>, _>("provider_name").unwrap_or_default(),
        "provider_service_id": row.try_get::<Option<Uuid>, _>("provider_service_id").unwrap_or_default(),
        "provider_service_name": row.try_get::<Option<String>, _>("provider_service_name").unwrap_or_default(),
        "assigned_concierge_id": row.try_get::<Option<Uuid>, _>("assigned_concierge_id").unwrap_or_default(),
        "assigned_concierge_name": row.try_get::<Option<String>, _>("assigned_concierge_name").unwrap_or_default(),
        "service_kind": row.try_get::<String, _>("service_kind").unwrap_or_default(),
        "taxonomy_node_id": row.try_get::<Option<Uuid>, _>("taxonomy_node_id").unwrap_or_default(),
        "taxonomy_node_code": row.try_get::<Option<String>, _>("taxonomy_node_code").unwrap_or_default(),
        "taxonomy_node_name_de": row.try_get::<Option<String>, _>("taxonomy_node_name_de").unwrap_or_default(),
        "taxonomy_node_name_ru": row.try_get::<Option<String>, _>("taxonomy_node_name_ru").unwrap_or_default(),
        "title": row.try_get::<String, _>("title").unwrap_or_default(),
        "status": row.try_get::<String, _>("status").unwrap_or_default(),
        "booking_reference": row.try_get::<Option<String>, _>("booking_reference").unwrap_or_default(),
        "vendor_name": row.try_get::<Option<String>, _>("vendor_name").unwrap_or_default(),
        "vendor_contact": row.try_get::<Option<String>, _>("vendor_contact").unwrap_or_default(),
        "starts_at": row.try_get::<Option<chrono::DateTime<chrono::Utc>>, _>("starts_at").unwrap_or_default().map(|value| value.to_rfc3339()),
        "ends_at": row.try_get::<Option<chrono::DateTime<chrono::Utc>>, _>("ends_at").unwrap_or_default().map(|value| value.to_rfc3339()),
        "cost_estimate": row.try_get::<Option<rust_decimal::Decimal>, _>("cost_estimate").unwrap_or_default().map(|value| value.round_dp(2).to_string()),
        "actual_cost": row.try_get::<Option<rust_decimal::Decimal>, _>("actual_cost").unwrap_or_default().map(|value| value.round_dp(2).to_string()),
        "quantity": row.try_get::<rust_decimal::Decimal, _>("quantity").map(|value| value.round_dp(2).normalize().to_string()).unwrap_or_else(|_| "1".to_string()),
        "unit_price": row.try_get::<Option<rust_decimal::Decimal>, _>("unit_price").unwrap_or_default().map(|value| value.round_dp(2).to_string()),
        "currency": row.try_get::<String, _>("currency").unwrap_or_else(|_| "EUR".to_string()),
        "billing_status": row.try_get::<String, _>("billing_status").unwrap_or_default(),
        "service_notes": row.try_get::<Option<String>, _>("service_notes").unwrap_or_default(),
        "billing_notes": row.try_get::<Option<String>, _>("billing_notes").unwrap_or_default(),
        "request_source": row.try_get::<String, _>("request_source").unwrap_or_else(|_| "staff".to_string()),
        "completed_at": row.try_get::<Option<chrono::DateTime<chrono::Utc>>, _>("completed_at").unwrap_or_default().map(|value| value.to_rfc3339()),
        "billed_at": row.try_get::<Option<chrono::DateTime<chrono::Utc>>, _>("billed_at").unwrap_or_default().map(|value| value.to_rfc3339()),
        "created_at": row.try_get::<chrono::DateTime<chrono::Utc>, _>("created_at").map(|value| value.to_rfc3339()).unwrap_or_default(),
        "updated_at": row.try_get::<chrono::DateTime<chrono::Utc>, _>("updated_at").map(|value| value.to_rfc3339()).unwrap_or_default(),
    })
}

async fn load_patient_label(state: &AppState, patient_id: Uuid) -> Option<String> {
    sqlx::query(
        r#"SELECT patient_id, trim(concat_ws(' ', first_name, last_name)) AS patient_name
           FROM patients
           WHERE id = $1"#,
    )
    .bind(patient_id)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten()
    .map(|row| {
        let pid = row.try_get::<String, _>("patient_id").unwrap_or_default();
        let name = row.try_get::<String, _>("patient_name").unwrap_or_default();
        if pid.is_empty() {
            name
        } else if name.is_empty() {
            pid
        } else {
            format!("{pid} · {name}")
        }
    })
}
