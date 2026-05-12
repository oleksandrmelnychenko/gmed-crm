#![allow(clippy::result_large_err)]

use axum::{
    Json, Router,
    extract::{Extension, Path, Query, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
};
use rust_decimal::Decimal;
use serde::Deserialize;
use sqlx::Row;
use std::collections::HashSet;
use uuid::Uuid;

use crate::access;
use crate::audit;
use crate::auth::middleware::AuthUser;
use crate::services::order_service_groups::{
    generate_order_service_group_lines, preview_order_service_group_lines,
};
use crate::state::AppState;
use gmed_domain::role::Role;

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/orders/{order_id}/service-groups",
            get(list_order_service_groups).post(create_order_service_group),
        )
        .route(
            "/order-service-groups/{service_group_id}",
            get(get_order_service_group),
        )
        .route(
            "/order-service-groups/{service_group_id}/participants",
            post(replace_order_service_group_participants),
        )
        .route(
            "/order-service-groups/{service_group_id}/generate-lines",
            post(generate_service_group_lines),
        )
        .route(
            "/order-service-groups/{service_group_id}/line-preview",
            get(preview_service_group_lines),
        )
        .route(
            "/appointments/{appointment_id}/doctor-participants",
            get(list_appointment_doctor_participants).post(replace_appointment_doctor_participants),
        )
}

#[derive(Deserialize)]
struct CreateOrderServiceGroup {
    appointment_id: Option<Uuid>,
    group_title: String,
    service_key: Option<String>,
    agency_service_id: Option<Uuid>,
    description: Option<String>,
    service_date: Option<String>,
    quantity: Option<f64>,
    unit_price: Option<f64>,
    currency: Option<String>,
    vat_rate: Option<f64>,
    participants: Option<Vec<ServiceGroupParticipantInput>>,
}

#[derive(Deserialize)]
struct ReplaceParticipants {
    participants: Vec<ServiceGroupParticipantInput>,
}

#[derive(Deserialize)]
struct ReplaceAppointmentDoctorParticipants {
    participants: Vec<AppointmentDoctorParticipantInput>,
}

#[derive(Deserialize)]
struct ServiceGroupParticipantInput {
    provider_id: Uuid,
    doctor_id: Uuid,
    role_label: Option<String>,
    quantity_override: Option<f64>,
    unit_price_override: Option<f64>,
    description_override: Option<String>,
    external_invoice_id: Option<Uuid>,
    notes: Option<String>,
}

#[derive(Deserialize)]
struct AppointmentDoctorParticipantInput {
    provider_id: Uuid,
    doctor_id: Uuid,
    role_label: Option<String>,
    notes: Option<String>,
}

#[derive(Deserialize)]
struct GenerateLinesRequest {
    override_duplicates: Option<bool>,
}

#[derive(Deserialize)]
struct PreviewLinesQuery {
    override_duplicates: Option<bool>,
}

async fn list_order_service_groups(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(order_id): Path<Uuid>,
) -> axum::response::Response {
    if let Err(resp) = auth.require_any_role(&[Role::PatientManager, Role::Ceo]) {
        return resp;
    }
    if let Err(resp) = ensure_order_access(&state, &auth, order_id).await {
        return resp;
    }

    match sqlx::query(
        r#"SELECT group_row.id,
                  group_row.order_id,
                  group_row.appointment_id,
                  appointment.title AS appointment_title,
                  group_row.group_title,
                  group_row.service_key,
                  group_row.description,
                  group_row.service_date,
                  group_row.quantity,
                  group_row.unit_price,
                  group_row.currency,
                  group_row.vat_rate,
                  group_row.status,
                  COUNT(participant.id)::bigint AS participant_count,
                  COUNT(leistung.id)::bigint AS generated_line_count
           FROM order_service_groups group_row
           LEFT JOIN appointments appointment ON appointment.id = group_row.appointment_id
           LEFT JOIN order_service_group_participants participant
                  ON participant.service_group_id = group_row.id
                 AND participant.is_active = true
           LEFT JOIN order_leistungen leistung
                  ON leistung.source_service_group_participant_id = participant.id
           WHERE group_row.order_id = $1
           GROUP BY group_row.id, appointment.title
           ORDER BY group_row.created_at DESC"#,
    )
    .bind(order_id)
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => Json(
            rows.into_iter()
                .map(service_group_list_json)
                .collect::<Vec<_>>(),
        )
        .into_response(),
        Err(error) => {
            tracing::error!(error = %error, order_id = %order_id, "list order service groups");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to load service groups",
            )
        }
    }
}

async fn get_order_service_group(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(service_group_id): Path<Uuid>,
) -> axum::response::Response {
    if let Err(resp) = auth.require_any_role(&[Role::PatientManager, Role::Ceo]) {
        return resp;
    }
    let order_id = match load_service_group_order_id(&state, service_group_id).await {
        Ok(Some(value)) => value,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Service group not found"),
        Err(resp) => return resp,
    };
    if let Err(resp) = ensure_order_access(&state, &auth, order_id).await {
        return resp;
    }

    match load_service_group_payload(&state, service_group_id).await {
        Ok(Some(payload)) => Json(payload).into_response(),
        Ok(None) => err(StatusCode::NOT_FOUND, "Service group not found"),
        Err(resp) => resp,
    }
}

async fn create_order_service_group(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(order_id): Path<Uuid>,
    Json(body): Json<CreateOrderServiceGroup>,
) -> axum::response::Response {
    if let Err(resp) = auth.require_any_role(&[Role::PatientManager, Role::Ceo]) {
        return resp;
    }
    if let Err(resp) = ensure_order_access(&state, &auth, order_id).await {
        return resp;
    }

    let Some(group_title) = normalize_required_text(&body.group_title) else {
        return err(StatusCode::UNPROCESSABLE_ENTITY, "Group title is required");
    };
    let service_date = match parse_optional_date(body.service_date.as_deref()) {
        Ok(value) => value,
        Err(resp) => return resp,
    };
    let quantity = decimal_from_optional(body.quantity, Decimal::ONE);
    let unit_price = decimal_from_optional(body.unit_price, Decimal::ZERO);
    let vat_rate = decimal_from_optional(body.vat_rate, Decimal::new(19, 0));
    let currency = body
        .currency
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("EUR")
        .to_uppercase();

    if let Err(resp) = validate_appointment_order_link(&state, order_id, body.appointment_id).await
    {
        return resp;
    }

    let mut tx = match state.db.begin().await {
        Ok(tx) => tx,
        Err(error) => {
            tracing::error!(error = %error, "begin service group create");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to create service group",
            );
        }
    };

    let service_group_id = match sqlx::query_scalar::<_, Uuid>(
        r#"INSERT INTO order_service_groups (
                order_id, appointment_id, group_title, service_key, agency_service_id,
                description, service_date, quantity, unit_price, currency, vat_rate,
                status, created_by, updated_by
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'draft', $12, $12)
           RETURNING id"#,
    )
    .bind(order_id)
    .bind(body.appointment_id)
    .bind(group_title)
    .bind(normalize_optional_text(body.service_key))
    .bind(body.agency_service_id)
    .bind(normalize_optional_text(body.description))
    .bind(service_date)
    .bind(quantity)
    .bind(unit_price)
    .bind(currency)
    .bind(vat_rate)
    .bind(auth.user_id)
    .fetch_one(&mut *tx)
    .await
    {
        Ok(value) => value,
        Err(error) => {
            tracing::error!(error = %error, order_id = %order_id, "insert service group");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to create service group",
            );
        }
    };

    if let Some(participants) = body.participants
        && let Err(resp) =
            replace_participants_in_tx(&state, &mut tx, order_id, service_group_id, participants)
                .await
    {
        return resp;
    }

    if let Err(error) = tx.commit().await {
        tracing::error!(error = %error, service_group_id = %service_group_id, "commit service group");
        return err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to create service group",
        );
    }

    state.audit_sender.try_send(audit::domain_event(
        "service_group_created".to_string(),
        Some(auth.user_id),
        "order",
        Some(order_id),
        serde_json::json!({
            "service_group_id": service_group_id,
        }),
    ));

    (
        StatusCode::CREATED,
        Json(serde_json::json!({ "id": service_group_id })),
    )
        .into_response()
}

async fn replace_order_service_group_participants(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(service_group_id): Path<Uuid>,
    Json(body): Json<ReplaceParticipants>,
) -> axum::response::Response {
    if let Err(resp) = auth.require_any_role(&[Role::PatientManager, Role::Ceo]) {
        return resp;
    }
    let order_id = match load_service_group_order_id(&state, service_group_id).await {
        Ok(Some(value)) => value,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Service group not found"),
        Err(resp) => return resp,
    };
    if let Err(resp) = ensure_order_access(&state, &auth, order_id).await {
        return resp;
    }

    let mut tx = match state.db.begin().await {
        Ok(tx) => tx,
        Err(error) => {
            tracing::error!(error = %error, service_group_id = %service_group_id, "begin replace service group participants");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to save participants",
            );
        }
    };

    if let Err(resp) = replace_participants_in_tx(
        &state,
        &mut tx,
        order_id,
        service_group_id,
        body.participants,
    )
    .await
    {
        return resp;
    }
    if let Err(error) = tx.commit().await {
        tracing::error!(error = %error, service_group_id = %service_group_id, "commit replace participants");
        return err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to save participants",
        );
    }

    Json(serde_json::json!({ "ok": true })).into_response()
}

async fn generate_service_group_lines(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(service_group_id): Path<Uuid>,
    Json(body): Json<GenerateLinesRequest>,
) -> axum::response::Response {
    if let Err(resp) = auth.require_any_role(&[Role::PatientManager, Role::Ceo]) {
        return resp;
    }
    let order_id = match load_service_group_order_id(&state, service_group_id).await {
        Ok(Some(value)) => value,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Service group not found"),
        Err(resp) => return resp,
    };
    if let Err(resp) = ensure_order_access(&state, &auth, order_id).await {
        return resp;
    }

    match generate_order_service_group_lines(
        &state.db,
        service_group_id,
        body.override_duplicates.unwrap_or(false),
    )
    .await
    {
        Ok(summary) => {
            state.audit_sender.try_send(audit::domain_event(
                "service_group_lines_generated".to_string(),
                Some(auth.user_id),
                "order",
                Some(order_id),
                serde_json::json!({
                    "service_group_id": service_group_id,
                    "generated_count": summary.generated_count,
                    "updated_count": summary.updated_count,
                    "skipped_duplicate_count": summary.skipped_duplicate_count,
                }),
            ));
            Json(summary).into_response()
        }
        Err(error) => {
            tracing::error!(error = %error, service_group_id = %service_group_id, "generate service group lines");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to generate service group lines",
            )
        }
    }
}

async fn preview_service_group_lines(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(service_group_id): Path<Uuid>,
    Query(query): Query<PreviewLinesQuery>,
) -> axum::response::Response {
    if let Err(resp) = auth.require_any_role(&[Role::PatientManager, Role::Ceo]) {
        return resp;
    }
    let order_id = match load_service_group_order_id(&state, service_group_id).await {
        Ok(Some(value)) => value,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Service group not found"),
        Err(resp) => return resp,
    };
    if let Err(resp) = ensure_order_access(&state, &auth, order_id).await {
        return resp;
    }

    match preview_order_service_group_lines(
        &state.db,
        service_group_id,
        query.override_duplicates.unwrap_or(false),
    )
    .await
    {
        Ok(summary) => Json(summary).into_response(),
        Err(error) => {
            tracing::error!(error = %error, service_group_id = %service_group_id, "preview service group lines");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to preview service group lines",
            )
        }
    }
}

async fn list_appointment_doctor_participants(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(appointment_id): Path<Uuid>,
) -> axum::response::Response {
    if let Err(resp) = auth.require_any_role(&[Role::PatientManager, Role::Ceo]) {
        return resp;
    }
    if let Err(resp) = ensure_appointment_access(&state, &auth, appointment_id).await {
        return resp;
    }

    match sqlx::query(
        r#"SELECT participant.id,
                  participant.provider_id,
                  provider.name AS provider_name,
                  participant.doctor_id,
                  doctor.name AS doctor_name,
                  participant.role_label,
                  participant.notes
           FROM appointment_doctor_participants participant
           JOIN providers provider ON provider.id = participant.provider_id
           JOIN provider_doctors doctor ON doctor.id = participant.doctor_id
           WHERE participant.appointment_id = $1
           ORDER BY doctor.name"#,
    )
    .bind(appointment_id)
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => Json(
            rows.into_iter()
                .map(|row| {
                    serde_json::json!({
                        "id": row.try_get::<Uuid, _>("id").unwrap_or_default(),
                        "appointment_id": appointment_id,
                        "provider_id": row.try_get::<Uuid, _>("provider_id").unwrap_or_default(),
                        "provider_name": row.try_get::<String, _>("provider_name").unwrap_or_default(),
                        "doctor_id": row.try_get::<Uuid, _>("doctor_id").unwrap_or_default(),
                        "doctor_name": row.try_get::<String, _>("doctor_name").unwrap_or_default(),
                        "role_label": row.try_get::<Option<String>, _>("role_label").unwrap_or_default(),
                        "notes": row.try_get::<Option<String>, _>("notes").unwrap_or_default(),
                    })
                })
                .collect::<Vec<_>>(),
        )
        .into_response(),
        Err(error) => {
            tracing::error!(error = %error, appointment_id = %appointment_id, "list appointment doctor participants");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to load doctor participants",
            )
        }
    }
}

async fn replace_appointment_doctor_participants(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(appointment_id): Path<Uuid>,
    Json(body): Json<ReplaceAppointmentDoctorParticipants>,
) -> axum::response::Response {
    if let Err(resp) = auth.require_any_role(&[Role::PatientManager, Role::Ceo]) {
        return resp;
    }
    if let Err(resp) = ensure_appointment_access(&state, &auth, appointment_id).await {
        return resp;
    }
    if body.participants.len() > 20 {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Too many doctor participants",
        );
    }

    let mut tx = match state.db.begin().await {
        Ok(tx) => tx,
        Err(error) => {
            tracing::error!(error = %error, appointment_id = %appointment_id, "begin replace appointment participants");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to save doctor participants",
            );
        }
    };

    if let Err(error) =
        sqlx::query("DELETE FROM appointment_doctor_participants WHERE appointment_id = $1")
            .bind(appointment_id)
            .execute(&mut *tx)
            .await
    {
        tracing::error!(error = %error, appointment_id = %appointment_id, "delete appointment participants");
        return err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to save doctor participants",
        );
    }

    for participant in body.participants {
        if let Err(resp) =
            validate_provider_doctor_in_tx(&mut tx, participant.provider_id, participant.doctor_id)
                .await
        {
            return resp;
        }
        if let Err(error) = sqlx::query(
            r#"INSERT INTO appointment_doctor_participants (
                    appointment_id, provider_id, doctor_id, role_label, notes, created_by
               ) VALUES ($1, $2, $3, $4, $5, $6)"#,
        )
        .bind(appointment_id)
        .bind(participant.provider_id)
        .bind(participant.doctor_id)
        .bind(normalize_optional_text(participant.role_label))
        .bind(normalize_optional_text(participant.notes))
        .bind(auth.user_id)
        .execute(&mut *tx)
        .await
        {
            tracing::error!(error = %error, appointment_id = %appointment_id, "insert appointment participant");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to save doctor participants",
            );
        }
    }

    if let Err(error) = tx.commit().await {
        tracing::error!(error = %error, appointment_id = %appointment_id, "commit appointment participants");
        return err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to save doctor participants",
        );
    }

    Json(serde_json::json!({ "ok": true })).into_response()
}

async fn replace_participants_in_tx(
    _state: &AppState,
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    order_id: Uuid,
    service_group_id: Uuid,
    participants: Vec<ServiceGroupParticipantInput>,
) -> Result<(), axum::response::Response> {
    if participants.is_empty() {
        return Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "At least one doctor participant is required",
        ));
    }
    if participants.len() > 20 {
        return Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Too many doctor participants",
        ));
    }

    let requested_doctor_ids = unique_participant_doctor_ids(&participants)?;

    for participant in participants {
        validate_provider_doctor_in_tx(tx, participant.provider_id, participant.doctor_id).await?;
        validate_external_invoice_in_tx(tx, order_id, participant.external_invoice_id).await?;
        let role_label = normalize_optional_text(participant.role_label);
        let quantity_override = optional_decimal(participant.quantity_override);
        let unit_price_override = optional_decimal(participant.unit_price_override);
        let description_override = normalize_optional_text(participant.description_override);
        let notes = normalize_optional_text(participant.notes);

        let update_result = sqlx::query(
            r#"WITH chosen AS (
                   SELECT id
                   FROM order_service_group_participants
                   WHERE service_group_id = $1
                     AND doctor_id = $3
                   ORDER BY is_active DESC, created_at DESC
                   LIMIT 1
               )
               UPDATE order_service_group_participants
               SET provider_id = $2,
                   role_label = $4,
                   quantity_override = $5,
                   unit_price_override = $6,
                   description_override = $7,
                   external_invoice_id = $8,
                   notes = $9,
                   is_active = true
               WHERE id = (SELECT id FROM chosen)"#,
        )
        .bind(service_group_id)
        .bind(participant.provider_id)
        .bind(participant.doctor_id)
        .bind(role_label.clone())
        .bind(quantity_override)
        .bind(unit_price_override)
        .bind(description_override.clone())
        .bind(participant.external_invoice_id)
        .bind(notes.clone())
        .execute(&mut **tx)
        .await
        .map_err(|error| {
            tracing::error!(error = %error, service_group_id = %service_group_id, "update service group participant");
            err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to save participants")
        })?;

        if update_result.rows_affected() == 0 {
            sqlx::query(
                r#"INSERT INTO order_service_group_participants (
                        service_group_id, provider_id, doctor_id, role_label,
                        quantity_override, unit_price_override, description_override,
                        external_invoice_id, notes, is_active
                   ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, true)"#,
            )
            .bind(service_group_id)
            .bind(participant.provider_id)
            .bind(participant.doctor_id)
            .bind(role_label)
            .bind(quantity_override)
            .bind(unit_price_override)
            .bind(description_override)
            .bind(participant.external_invoice_id)
            .bind(notes)
            .execute(&mut **tx)
            .await
            .map_err(|error| {
                tracing::error!(error = %error, service_group_id = %service_group_id, "insert service group participant");
                err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to save participants")
            })?;
        }
    }

    sqlx::query(
        r#"UPDATE order_service_group_participants
           SET is_active = false
           WHERE service_group_id = $1
             AND NOT (doctor_id = ANY($2))"#,
    )
    .bind(service_group_id)
    .bind(&requested_doctor_ids)
    .execute(&mut **tx)
    .await
    .map_err(|error| {
        tracing::error!(error = %error, service_group_id = %service_group_id, "deactivate removed service group participants");
        err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to save participants")
    })?;

    Ok(())
}

fn unique_participant_doctor_ids(
    participants: &[ServiceGroupParticipantInput],
) -> Result<Vec<Uuid>, axum::response::Response> {
    let mut seen = HashSet::with_capacity(participants.len());
    let mut ids = Vec::with_capacity(participants.len());
    for participant in participants {
        if !seen.insert(participant.doctor_id) {
            return Err(err(
                StatusCode::UNPROCESSABLE_ENTITY,
                "Doctor can only appear once in a service group",
            ));
        }
        ids.push(participant.doctor_id);
    }
    Ok(ids)
}

async fn validate_provider_doctor_in_tx(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    provider_id: Uuid,
    doctor_id: Uuid,
) -> Result<(), axum::response::Response> {
    let exists = sqlx::query_scalar::<_, bool>(
        r#"SELECT EXISTS(
                SELECT 1
                FROM provider_doctors
                WHERE provider_id = $1
                  AND id = $2
           )"#,
    )
    .bind(provider_id)
    .bind(doctor_id)
    .fetch_one(&mut **tx)
    .await
    .map_err(|error| {
        tracing::error!(error = %error, provider_id = %provider_id, doctor_id = %doctor_id, "validate service group doctor");
        err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to validate doctor")
    })?;

    if exists {
        Ok(())
    } else {
        Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Doctor does not belong to provider",
        ))
    }
}

async fn validate_external_invoice_in_tx(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    order_id: Uuid,
    external_invoice_id: Option<Uuid>,
) -> Result<(), axum::response::Response> {
    let Some(external_invoice_id) = external_invoice_id else {
        return Ok(());
    };
    let exists = sqlx::query_scalar::<_, bool>(
        r#"SELECT EXISTS(
                SELECT 1
                FROM external_invoices
                WHERE id = $1
                  AND order_id = $2
           )"#,
    )
    .bind(external_invoice_id)
    .bind(order_id)
    .fetch_one(&mut **tx)
    .await
    .map_err(|error| {
        tracing::error!(error = %error, external_invoice_id = %external_invoice_id, "validate service group external invoice");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to validate external invoice",
        )
    })?;

    if exists {
        Ok(())
    } else {
        Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "External invoice must belong to the same order",
        ))
    }
}

async fn load_service_group_order_id(
    state: &AppState,
    service_group_id: Uuid,
) -> Result<Option<Uuid>, axum::response::Response> {
    sqlx::query_scalar("SELECT order_id FROM order_service_groups WHERE id = $1")
        .bind(service_group_id)
        .fetch_optional(&state.db)
        .await
        .map_err(|error| {
            tracing::error!(error = %error, service_group_id = %service_group_id, "load service group order id");
            err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to load service group")
        })
}

async fn load_service_group_payload(
    state: &AppState,
    service_group_id: Uuid,
) -> Result<Option<serde_json::Value>, axum::response::Response> {
    let row = sqlx::query(
        r#"SELECT group_row.id,
                  group_row.order_id,
                  group_row.appointment_id,
                  appointment.title AS appointment_title,
                  group_row.group_title,
                  group_row.service_key,
                  group_row.description,
                  group_row.service_date,
                  group_row.quantity,
                  group_row.unit_price,
                  group_row.currency,
                  group_row.vat_rate,
                  group_row.status
           FROM order_service_groups group_row
           LEFT JOIN appointments appointment ON appointment.id = group_row.appointment_id
           WHERE group_row.id = $1"#,
    )
    .bind(service_group_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|error| {
        tracing::error!(error = %error, service_group_id = %service_group_id, "load service group");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to load service group",
        )
    })?;

    let Some(row) = row else {
        return Ok(None);
    };

    let participants = sqlx::query(
        r#"SELECT participant.id,
                  participant.provider_id,
                  provider.name AS provider_name,
                  participant.doctor_id,
                  doctor.name AS doctor_name,
                  participant.role_label,
                  participant.quantity_override,
                  participant.unit_price_override,
                  participant.description_override,
                  participant.external_invoice_id,
                  participant.notes,
                  participant.generated_leistung_id,
                  leistung.description AS generated_leistung_description
           FROM order_service_group_participants participant
           JOIN providers provider ON provider.id = participant.provider_id
           JOIN provider_doctors doctor ON doctor.id = participant.doctor_id
           LEFT JOIN order_leistungen leistung ON leistung.id = participant.generated_leistung_id
           WHERE participant.service_group_id = $1
             AND participant.is_active = true
           ORDER BY doctor.name"#,
    )
    .bind(service_group_id)
    .fetch_all(&state.db)
    .await
    .map_err(|error| {
        tracing::error!(error = %error, service_group_id = %service_group_id, "load service group participants");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to load service group participants",
        )
    })?;

    Ok(Some(serde_json::json!({
        "id": row.try_get::<Uuid, _>("id").unwrap_or_default(),
        "order_id": row.try_get::<Uuid, _>("order_id").unwrap_or_default(),
        "appointment_id": row.try_get::<Option<Uuid>, _>("appointment_id").unwrap_or_default(),
        "appointment_title": row.try_get::<Option<String>, _>("appointment_title").unwrap_or_default(),
        "group_title": row.try_get::<String, _>("group_title").unwrap_or_default(),
        "service_key": row.try_get::<Option<String>, _>("service_key").unwrap_or_default(),
        "description": row.try_get::<Option<String>, _>("description").unwrap_or_default(),
        "service_date": row.try_get::<Option<chrono::NaiveDate>, _>("service_date").unwrap_or_default().map(|value| value.to_string()),
        "quantity": decimal_json(&row, "quantity"),
        "unit_price": decimal_json(&row, "unit_price"),
        "currency": row.try_get::<String, _>("currency").unwrap_or_else(|_| "EUR".to_string()),
        "vat_rate": decimal_json(&row, "vat_rate"),
        "status": row.try_get::<String, _>("status").unwrap_or_default(),
        "participants": participants.into_iter().map(participant_json).collect::<Vec<_>>(),
    })))
}

fn service_group_list_json(row: sqlx::postgres::PgRow) -> serde_json::Value {
    serde_json::json!({
        "id": row.try_get::<Uuid, _>("id").unwrap_or_default(),
        "order_id": row.try_get::<Uuid, _>("order_id").unwrap_or_default(),
        "appointment_id": row.try_get::<Option<Uuid>, _>("appointment_id").unwrap_or_default(),
        "appointment_title": row.try_get::<Option<String>, _>("appointment_title").unwrap_or_default(),
        "group_title": row.try_get::<String, _>("group_title").unwrap_or_default(),
        "service_key": row.try_get::<Option<String>, _>("service_key").unwrap_or_default(),
        "description": row.try_get::<Option<String>, _>("description").unwrap_or_default(),
        "service_date": row.try_get::<Option<chrono::NaiveDate>, _>("service_date").unwrap_or_default().map(|value| value.to_string()),
        "quantity": decimal_json(&row, "quantity"),
        "unit_price": decimal_json(&row, "unit_price"),
        "currency": row.try_get::<String, _>("currency").unwrap_or_else(|_| "EUR".to_string()),
        "vat_rate": decimal_json(&row, "vat_rate"),
        "status": row.try_get::<String, _>("status").unwrap_or_default(),
        "participant_count": row.try_get::<i64, _>("participant_count").unwrap_or_default(),
        "generated_line_count": row.try_get::<i64, _>("generated_line_count").unwrap_or_default(),
    })
}

fn participant_json(row: sqlx::postgres::PgRow) -> serde_json::Value {
    serde_json::json!({
        "id": row.try_get::<Uuid, _>("id").unwrap_or_default(),
        "provider_id": row.try_get::<Uuid, _>("provider_id").unwrap_or_default(),
        "provider_name": row.try_get::<String, _>("provider_name").unwrap_or_default(),
        "doctor_id": row.try_get::<Uuid, _>("doctor_id").unwrap_or_default(),
        "doctor_name": row.try_get::<String, _>("doctor_name").unwrap_or_default(),
        "role_label": row.try_get::<Option<String>, _>("role_label").unwrap_or_default(),
        "quantity_override": row.try_get::<Option<Decimal>, _>("quantity_override").unwrap_or_default().map(|value| value.round_dp(2).normalize().to_string()),
        "unit_price_override": row.try_get::<Option<Decimal>, _>("unit_price_override").unwrap_or_default().map(|value| value.round_dp(2).normalize().to_string()),
        "description_override": row.try_get::<Option<String>, _>("description_override").unwrap_or_default(),
        "external_invoice_id": row.try_get::<Option<Uuid>, _>("external_invoice_id").unwrap_or_default(),
        "notes": row.try_get::<Option<String>, _>("notes").unwrap_or_default(),
        "generated_leistung_id": row.try_get::<Option<Uuid>, _>("generated_leistung_id").unwrap_or_default(),
        "generated_leistung_description": row.try_get::<Option<String>, _>("generated_leistung_description").unwrap_or_default(),
    })
}

async fn ensure_order_access(
    state: &AppState,
    auth: &AuthUser,
    order_id: Uuid,
) -> Result<(), axum::response::Response> {
    if auth.role == Role::Ceo {
        return Ok(());
    }
    let row = sqlx::query("SELECT patient_id FROM orders WHERE id = $1")
        .bind(order_id)
        .fetch_optional(&state.db)
        .await
        .map_err(|error| {
            tracing::error!(error = %error, order_id = %order_id, "load order access");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to validate order access",
            )
        })?;
    let Some(row) = row else {
        return Err(err(StatusCode::NOT_FOUND, "Order not found"));
    };
    let patient_id = row.try_get::<Uuid, _>("patient_id").map_err(|_| {
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to decode order access",
        )
    })?;
    let assigned = access::has_active_patient_assignment(&state.db, patient_id, auth.user_id)
        .await
        .map_err(|error| {
            tracing::error!(error = %error, patient_id = %patient_id, "validate order assignment");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to validate order access",
            )
        })?;
    if assigned {
        Ok(())
    } else {
        Err(err(StatusCode::FORBIDDEN, "Insufficient permissions"))
    }
}

async fn ensure_appointment_access(
    state: &AppState,
    auth: &AuthUser,
    appointment_id: Uuid,
) -> Result<(), axum::response::Response> {
    if auth.role == Role::Ceo {
        return Ok(());
    }
    let row = sqlx::query("SELECT patient_id FROM appointments WHERE id = $1")
        .bind(appointment_id)
        .fetch_optional(&state.db)
        .await
        .map_err(|error| {
            tracing::error!(error = %error, appointment_id = %appointment_id, "load appointment access");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to validate appointment access",
            )
        })?;
    let Some(row) = row else {
        return Err(err(StatusCode::NOT_FOUND, "Appointment not found"));
    };
    let patient_id = row.try_get::<Uuid, _>("patient_id").map_err(|_| {
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to decode appointment access",
        )
    })?;
    let assigned = access::has_active_patient_assignment(&state.db, patient_id, auth.user_id)
        .await
        .map_err(|error| {
            tracing::error!(error = %error, patient_id = %patient_id, "validate appointment assignment");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to validate appointment access",
            )
        })?;
    if assigned {
        Ok(())
    } else {
        Err(err(StatusCode::FORBIDDEN, "Insufficient permissions"))
    }
}

async fn validate_appointment_order_link(
    state: &AppState,
    order_id: Uuid,
    appointment_id: Option<Uuid>,
) -> Result<(), axum::response::Response> {
    let Some(appointment_id) = appointment_id else {
        return Ok(());
    };
    let exists = sqlx::query_scalar::<_, bool>(
        r#"SELECT EXISTS(
                SELECT 1
                FROM appointments
                WHERE id = $1
                  AND order_id = $2
           )"#,
    )
    .bind(appointment_id)
    .bind(order_id)
    .fetch_one(&state.db)
    .await
    .map_err(|error| {
        tracing::error!(error = %error, appointment_id = %appointment_id, order_id = %order_id, "validate appointment order link");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to validate appointment",
        )
    })?;
    if exists {
        Ok(())
    } else {
        Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Appointment must belong to the same order",
        ))
    }
}

fn normalize_required_text(value: &str) -> Option<String> {
    let normalized = value.trim();
    (!normalized.is_empty()).then(|| normalized.to_string())
}

fn normalize_optional_text(value: Option<String>) -> Option<String> {
    value
        .map(|raw| raw.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn parse_optional_date(
    value: Option<&str>,
) -> Result<Option<chrono::NaiveDate>, axum::response::Response> {
    match value.map(str::trim).filter(|value| !value.is_empty()) {
        Some(raw) => chrono::NaiveDate::parse_from_str(raw, "%Y-%m-%d")
            .map(Some)
            .map_err(|_| err(StatusCode::UNPROCESSABLE_ENTITY, "Invalid date")),
        None => Ok(None),
    }
}

fn decimal_from_optional(value: Option<f64>, default: Decimal) -> Decimal {
    value
        .and_then(|raw| Decimal::try_from(raw).ok())
        .unwrap_or(default)
}

fn optional_decimal(value: Option<f64>) -> Option<Decimal> {
    value.and_then(|raw| Decimal::try_from(raw).ok())
}

fn decimal_json(row: &sqlx::postgres::PgRow, column: &str) -> String {
    row.try_get::<Decimal, _>(column)
        .unwrap_or(Decimal::ZERO)
        .round_dp(2)
        .normalize()
        .to_string()
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

#[cfg(test)]
mod tests {
    use super::*;

    fn participant(doctor_id: Uuid) -> ServiceGroupParticipantInput {
        ServiceGroupParticipantInput {
            provider_id: Uuid::new_v4(),
            doctor_id,
            role_label: None,
            quantity_override: None,
            unit_price_override: None,
            description_override: None,
            external_invoice_id: None,
            notes: None,
        }
    }

    #[test]
    fn unique_participant_doctor_ids_rejects_duplicate_doctors() {
        let doctor_id = Uuid::new_v4();
        let result =
            unique_participant_doctor_ids(&[participant(doctor_id), participant(doctor_id)]);

        assert!(result.is_err());
    }

    #[test]
    fn unique_participant_doctor_ids_preserves_distinct_doctors() {
        let first = Uuid::new_v4();
        let second = Uuid::new_v4();
        let result = unique_participant_doctor_ids(&[participant(first), participant(second)])
            .expect("distinct doctors should be accepted");

        assert_eq!(result, vec![first, second]);
    }
}
