use axum::{
    Json, Router,
    extract::{Extension, Path, Query, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
};
use chrono::Datelike;
use serde::{Deserialize, Deserializer, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use uuid::Uuid;

use crate::access;
use crate::audit;
use crate::auth::middleware::AuthUser;
use crate::routes::me::resolve_self_patient_id;
use crate::state::AppState;
use gmed_domain::role::Role;
use sqlx::Row;

const APPOINTMENT_SCHEDULE_CONSTRAINTS: &[&str] = &[
    "appointments_patient_timed_schedule_excl",
    "appointments_interpreter_timed_schedule_excl",
    "appointments_doctor_timed_schedule_excl",
    "appointments_patient_all_day_schedule_excl",
    "appointments_interpreter_all_day_schedule_excl",
    "appointments_doctor_all_day_schedule_excl",
];

const INTERPRETER_HOURS_SERVICE_KEY: &str = "interpreter_hours";
const MEDICAL_TREATMENT_ORGANIZATION_SERVICE_KEY: &str = "treatment_organization";
const INTERPRETER_REPORT_BILLING_SYNC_INTERVAL_SECS: u64 = 60 * 60;

#[derive(Default, Clone, Copy, Debug)]
pub struct InterpreterReportBillingSyncSummary {
    pub leistungen_created: u64,
    pub already_synced: u64,
    pub missing_order: u64,
    pub missing_catalog: u64,
}

struct InterpreterReportBillingCandidate {
    report_id: Uuid,
    appointment_id: Uuid,
    order_id: Option<Uuid>,
    patient_id: Uuid,
    appointment_title: String,
    appointment_date: chrono::NaiveDate,
    interpreter_name: String,
    hours: rust_decimal::Decimal,
    report_text: Option<String>,
    approved_by: Option<Uuid>,
    approved_at: Option<chrono::DateTime<chrono::Utc>>,
}

struct AgencyServiceBillingItem {
    id: Uuid,
    service_key: String,
    service_name: String,
    unit_price: rust_decimal::Decimal,
    currency: String,
    vat_rate: rust_decimal::Decimal,
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/me/appointments", get(list_my_appointments))
        .route(
            "/me/appointment-requests",
            get(list_my_appointment_requests).post(create_my_appointment_request),
        )
        .route("/appointments/meta/interpreters", get(list_interpreters))
        .route("/appointments/meta/staff", get(list_staff))
        .route("/appointments/meta/conflicts", get(get_conflicts))
        .route("/appointments/meta/attention", get(list_attention_items))
        .route("/appointments/requests", get(list_appointment_requests))
        .route(
            "/appointments/requests/{id}/review",
            post(review_appointment_request),
        )
        .route(
            "/appointments/requests/{id}/convert",
            post(convert_appointment_request),
        )
        .route(
            "/appointments",
            get(list_appointments).post(create_appointment),
        )
        .route("/appointments/{id}", get(get_appointment))
        .route("/appointments/{id}/update", post(update_appointment))
        .route("/appointments/{id}/status", post(update_status))
        .route(
            "/appointments/{id}/assign-interpreter",
            post(assign_interpreter),
        )
        .route(
            "/appointments/{id}/interpreter-response",
            post(interpreter_response),
        )
        .route(
            "/appointments/{id}/checklist",
            get(list_checklist).post(add_checklist_item),
        )
        .route(
            "/appointments/{id}/checklist/{item_id}/complete",
            post(complete_checklist),
        )
        .route(
            "/appointments/{id}/reminders",
            get(list_reminders).post(add_reminder),
        )
        .route(
            "/appointments/{id}/reminders/{reminder_id}/complete",
            post(complete_reminder),
        )
        .route(
            "/appointments/{id}/communications",
            get(list_communications).post(create_communication),
        )
        .route(
            "/appointments/{id}/communications/{communication_id}/status",
            post(update_communication_status),
        )
        .route(
            "/appointments/{id}/report",
            get(get_report).post(submit_report),
        )
        .route("/appointments/{id}/report/approve", post(approve_report))
        .route("/appointments/{id}/report/reject", post(reject_report))
}

#[derive(Deserialize)]
struct CreateAppointment {
    patient_id: Uuid,
    provider_id: Option<Uuid>,
    doctor_id: Option<Uuid>,
    owner_user_id: Option<Uuid>,
    interpreter_id: Option<Uuid>,
    order_id: Option<Uuid>,
    appointment_type: String,
    skip_medical_provider_binding: Option<bool>,
    care_path_kind: Option<String>,
    title: String,
    date: String,
    time_start: Option<String>,
    time_end: Option<String>,
    location: Option<String>,
    category: Option<String>,
    notes: Option<String>,
    recurrence_frequency: Option<String>,
    recurrence_interval: Option<i32>,
    recurrence_count: Option<i32>,
    recurrence_until: Option<String>,
}

#[derive(Deserialize)]
struct UpdateAppointment {
    provider_id: Option<Uuid>,
    doctor_id: Option<Uuid>,
    owner_user_id: Option<Uuid>,
    interpreter_id: Option<Uuid>,
    appointment_type: Option<String>,
    care_path_kind: Option<String>,
    checklist_phase: Option<String>,
    title: String,
    date: String,
    time_start: Option<String>,
    time_end: Option<String>,
    location: Option<String>,
    recurrence_frequency: Option<String>,
    recurrence_interval: Option<i32>,
    recurrence_count: Option<i32>,
    #[serde(default, deserialize_with = "deserialize_explicit_nullable_string")]
    recurrence_until: Option<Option<String>>,
    recurrence_scope: Option<String>,
}

fn deserialize_explicit_nullable_string<'de, D>(
    deserializer: D,
) -> Result<Option<Option<String>>, D::Error>
where
    D: Deserializer<'de>,
{
    Ok(Some(Option::<String>::deserialize(deserializer)?))
}

struct AppointmentRecurrence {
    frequency: String,
    interval: i32,
    count: Option<i32>,
    until: Option<chrono::NaiveDate>,
}

#[derive(Deserialize)]
struct StatusUpdate {
    status: String,
    recurrence_scope: Option<String>,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum AppointmentRecurrenceScope {
    Single,
    Following,
    Series,
}

struct AppointmentUpdateTarget {
    id: Uuid,
    patient_id: Uuid,
    provider_id: Option<Uuid>,
    doctor_id: Option<Uuid>,
    interpreter_id: Option<Uuid>,
    interpreter_response: Option<String>,
    date: chrono::NaiveDate,
    time_start: Option<chrono::NaiveTime>,
    time_end: Option<chrono::NaiveTime>,
    location: Option<String>,
}

#[derive(Deserialize)]
struct AssignInterpreter {
    interpreter_id: Uuid,
}

#[derive(Deserialize)]
struct InterpreterResponseReq {
    response: String,
}

#[derive(Deserialize)]
struct ChecklistItem {
    phase: String,
    item_text: String,
}

#[derive(Deserialize)]
struct SubmitReport {
    hours: f64,
    report_text: Option<String>,
}

#[derive(Deserialize)]
struct CreateReminder {
    user_id: Uuid,
    remind_at: String,
    title: String,
    description: Option<String>,
}

#[derive(Deserialize)]
struct CreateCommunication {
    target_type: String,
    direction: String,
    channel: String,
    status: String,
    subject: String,
    message: Option<String>,
    contact_name: Option<String>,
    due_at: Option<String>,
}

#[derive(Deserialize)]
struct UpdateCommunicationStatus {
    status: String,
}

#[derive(Deserialize)]
struct RejectReport {
    notes: Option<String>,
}

#[derive(Deserialize)]
struct ListAppointmentsQuery {
    search: Option<String>,
    appointment_type: Option<String>,
    care_path_kind: Option<String>,
    status: Option<String>,
    patient_id: Option<Uuid>,
    provider_id: Option<Uuid>,
    provider_taxonomy_node_id: Option<Uuid>,
    doctor_id: Option<Uuid>,
    owner_user_id: Option<Uuid>,
    interpreter_id: Option<Uuid>,
    date_from: Option<String>,
    date_to: Option<String>,
}

#[derive(Deserialize)]
struct ListAppointmentRequestsQuery {
    status: Option<String>,
    patient_id: Option<Uuid>,
}

#[derive(Deserialize)]
struct CreateMyAppointmentRequest {
    appointment_type: String,
    care_path_kind: Option<String>,
    order_id: Option<Uuid>,
    preferred_date_from: Option<String>,
    preferred_date_to: Option<String>,
    preferred_time_of_day: Option<String>,
    requested_provider_id: Option<Uuid>,
    requested_doctor_id: Option<Uuid>,
    specialty: Option<String>,
    location: Option<String>,
    reason: Option<String>,
    notes: Option<String>,
}

#[derive(Deserialize)]
struct ReviewAppointmentRequest {
    status: String,
    review_note: Option<String>,
}

#[derive(Deserialize)]
struct ConvertAppointmentRequest {
    provider_id: Option<Uuid>,
    doctor_id: Option<Uuid>,
    owner_user_id: Option<Uuid>,
    interpreter_id: Option<Uuid>,
    order_id: Option<Uuid>,
    title: String,
    date: String,
    time_start: Option<String>,
    time_end: Option<String>,
    location: Option<String>,
    category: Option<String>,
    notes: Option<String>,
}

#[derive(Deserialize)]
struct AppointmentConflictsQuery {
    patient_id: Uuid,
    interpreter_id: Option<Uuid>,
    appointment_id: Option<Uuid>,
    date: String,
    time_start: Option<String>,
    time_end: Option<String>,
}

#[derive(Serialize)]
struct InterpreterOptionResponse {
    id: Uuid,
    name: String,
    role: String,
}

#[derive(Serialize)]
struct StaffOptionResponse {
    id: Uuid,
    name: String,
    role: String,
}

struct AppointmentCommunicationContext {
    appointment_id: Uuid,
    patient_id: Uuid,
    provider_id: Option<Uuid>,
    doctor_id: Option<Uuid>,
    appointment_type: String,
    interpreter_id: Option<Uuid>,
    owner_user_id: Option<Uuid>,
}

fn is_valid_patient_request_time_of_day(value: &str) -> bool {
    matches!(
        value,
        "morning" | "midday" | "afternoon" | "evening" | "flexible"
    )
}

fn is_valid_appointment_request_status(value: &str) -> bool {
    matches!(
        value,
        "requested" | "approved" | "rejected" | "converted" | "cancelled"
    )
}

fn is_valid_review_status(value: &str) -> bool {
    matches!(value, "approved" | "rejected")
}

fn build_patient_appointment_json(row: &sqlx::postgres::PgRow) -> serde_json::Value {
    serde_json::json!({
        "id": row.try_get::<Uuid, _>("id").unwrap_or_else(|_| Uuid::nil()),
        "title": row.try_get::<String, _>("title").unwrap_or_default(),
        "date": row.try_get::<chrono::NaiveDate, _>("date").map(|value| value.to_string()).unwrap_or_default(),
        "time_start": row.try_get::<Option<chrono::NaiveTime>, _>("time_start").unwrap_or_default().map(|value| value.format("%H:%M").to_string()),
        "time_end": row.try_get::<Option<chrono::NaiveTime>, _>("time_end").unwrap_or_default().map(|value| value.format("%H:%M").to_string()),
        "appointment_type": row.try_get::<String, _>("appointment_type").unwrap_or_default(),
        "care_path_kind": row.try_get::<String, _>("care_path_kind").unwrap_or_else(|_| "regular".to_string()),
        "status": row.try_get::<String, _>("status").unwrap_or_default(),
        "location": row.try_get::<Option<String>, _>("location").unwrap_or_default(),
        "category": row.try_get::<Option<String>, _>("category").unwrap_or_default(),
        "provider_name": row.try_get::<Option<String>, _>("provider_name").unwrap_or_default(),
        "doctor_name": row.try_get::<Option<String>, _>("doctor_name").unwrap_or_default(),
        "created_at": row.try_get::<chrono::DateTime<chrono::Utc>, _>("created_at").map(|value| value.to_rfc3339()).unwrap_or_default(),
    })
}

fn build_appointment_request_json(row: &sqlx::postgres::PgRow) -> serde_json::Value {
    serde_json::json!({
        "id": row.try_get::<Uuid, _>("id").unwrap_or_else(|_| Uuid::nil()),
        "patient_id": row.try_get::<Uuid, _>("patient_id").unwrap_or_else(|_| Uuid::nil()),
        "patient_pid": row.try_get::<Option<String>, _>("patient_pid").unwrap_or_default(),
        "patient_name": row.try_get::<Option<String>, _>("patient_name").unwrap_or_default(),
        "order_id": row.try_get::<Option<Uuid>, _>("order_id").unwrap_or_default(),
        "order_number": row.try_get::<Option<String>, _>("order_number").unwrap_or_default(),
        "appointment_type": row.try_get::<String, _>("appointment_type").unwrap_or_default(),
        "care_path_kind": row.try_get::<String, _>("care_path_kind").unwrap_or_else(|_| "regular".to_string()),
        "preferred_date_from": row.try_get::<Option<chrono::NaiveDate>, _>("preferred_date_from").unwrap_or_default().map(|value| value.to_string()),
        "preferred_date_to": row.try_get::<Option<chrono::NaiveDate>, _>("preferred_date_to").unwrap_or_default().map(|value| value.to_string()),
        "preferred_time_of_day": row.try_get::<Option<String>, _>("preferred_time_of_day").unwrap_or_default(),
        "requested_provider_id": row.try_get::<Option<Uuid>, _>("requested_provider_id").unwrap_or_default(),
        "requested_provider_name": row.try_get::<Option<String>, _>("requested_provider_name").unwrap_or_default(),
        "requested_doctor_id": row.try_get::<Option<Uuid>, _>("requested_doctor_id").unwrap_or_default(),
        "requested_doctor_name": row.try_get::<Option<String>, _>("requested_doctor_name").unwrap_or_default(),
        "specialty": row.try_get::<Option<String>, _>("specialty").unwrap_or_default(),
        "location": row.try_get::<Option<String>, _>("location").unwrap_or_default(),
        "reason": row.try_get::<Option<String>, _>("reason").unwrap_or_default(),
        "notes": row.try_get::<Option<String>, _>("notes").unwrap_or_default(),
        "status": row.try_get::<String, _>("status").unwrap_or_default(),
        "review_note": row.try_get::<Option<String>, _>("review_note").unwrap_or_default(),
        "reviewed_by": row.try_get::<Option<Uuid>, _>("reviewed_by").unwrap_or_default(),
        "reviewed_by_name": row.try_get::<Option<String>, _>("reviewed_by_name").unwrap_or_default(),
        "reviewed_at": row.try_get::<Option<chrono::DateTime<chrono::Utc>>, _>("reviewed_at").unwrap_or_default().map(|value| value.to_rfc3339()),
        "requested_at": row.try_get::<chrono::DateTime<chrono::Utc>, _>("requested_at").map(|value| value.to_rfc3339()).unwrap_or_default(),
        "converted_appointment_id": row.try_get::<Option<Uuid>, _>("converted_appointment_id").unwrap_or_default(),
        "converted_appointment_title": row.try_get::<Option<String>, _>("converted_appointment_title").unwrap_or_default(),
        "converted_appointment_date": row.try_get::<Option<chrono::NaiveDate>, _>("converted_appointment_date").unwrap_or_default().map(|value| value.to_string()),
    })
}

async fn load_appointment_request_row(
    state: &AppState,
    request_id: Uuid,
) -> Result<Option<sqlx::postgres::PgRow>, axum::response::Response> {
    sqlx::query(
        r#"SELECT par.id, par.patient_id, par.requested_by, par.order_id, par.appointment_type,
                  par.care_path_kind,
                  par.preferred_date_from, par.preferred_date_to, par.preferred_time_of_day,
                  par.requested_provider_id, par.requested_doctor_id, par.specialty, par.location,
                  par.reason, par.notes, par.status, par.review_note, par.reviewed_by,
                  par.reviewed_at, par.requested_at, par.converted_appointment_id,
                  p.patient_id AS patient_pid,
                  trim(concat_ws(' ', p.first_name, p.last_name)) AS patient_name,
                  o.order_number,
                  provider.name AS requested_provider_name,
                  doctor.name AS requested_doctor_name,
                  reviewer.name AS reviewed_by_name,
                  converted.title AS converted_appointment_title,
                  converted.date AS converted_appointment_date
           FROM patient_appointment_requests par
           JOIN patients p ON p.id = par.patient_id
           LEFT JOIN orders o ON o.id = par.order_id
           LEFT JOIN providers provider ON provider.id = par.requested_provider_id
           LEFT JOIN provider_doctors doctor ON doctor.id = par.requested_doctor_id
           LEFT JOIN users reviewer ON reviewer.id = par.reviewed_by
           LEFT JOIN appointments converted ON converted.id = par.converted_appointment_id
           WHERE par.id = $1"#,
    )
    .bind(request_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, request_id = %request_id, "load appointment request");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to load appointment request",
        )
    })
}

async fn list_my_appointments(
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
        r#"SELECT a.id, a.title, a.date, a.time_start, a.time_end, a.appointment_type,
                  a.care_path_kind,
                  a.status, a.location, a.category, a.created_at,
                  provider.name AS provider_name,
                  doctor.name AS doctor_name
           FROM appointments a
           LEFT JOIN providers provider ON provider.id = a.provider_id
           LEFT JOIN provider_doctors doctor ON doctor.id = a.doctor_id
           WHERE a.patient_id = $1
             AND a.appointment_type <> 'internal'
           ORDER BY CASE WHEN a.date >= current_date THEN 0 ELSE 1 END,
                    CASE WHEN a.date >= current_date THEN a.date END ASC,
                    CASE WHEN a.date < current_date THEN a.date END DESC,
                    a.time_start"#,
    )
    .bind(patient_id)
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => Json(
            rows.iter()
                .map(build_patient_appointment_json)
                .collect::<Vec<_>>(),
        )
        .into_response(),
        Err(e) => {
            tracing::error!(error = %e, user_id = %auth.user_id, "list my appointments");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to load appointments",
            )
        }
    }
}

async fn list_my_appointment_requests(
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
        r#"SELECT par.id, par.patient_id, par.requested_by, par.order_id, par.appointment_type,
                  par.care_path_kind,
                  par.preferred_date_from, par.preferred_date_to, par.preferred_time_of_day,
                  par.requested_provider_id, par.requested_doctor_id, par.specialty, par.location,
                  par.reason, par.notes, par.status, par.review_note, par.reviewed_by,
                  par.reviewed_at, par.requested_at, par.converted_appointment_id,
                  p.patient_id AS patient_pid,
                  trim(concat_ws(' ', p.first_name, p.last_name)) AS patient_name,
                  o.order_number,
                  provider.name AS requested_provider_name,
                  doctor.name AS requested_doctor_name,
                  reviewer.name AS reviewed_by_name,
                  converted.title AS converted_appointment_title,
                  converted.date AS converted_appointment_date
           FROM patient_appointment_requests par
           JOIN patients p ON p.id = par.patient_id
           LEFT JOIN orders o ON o.id = par.order_id
           LEFT JOIN providers provider ON provider.id = par.requested_provider_id
           LEFT JOIN provider_doctors doctor ON doctor.id = par.requested_doctor_id
           LEFT JOIN users reviewer ON reviewer.id = par.reviewed_by
           LEFT JOIN appointments converted ON converted.id = par.converted_appointment_id
           WHERE par.patient_id = $1
             AND par.requested_by = $2
           ORDER BY par.requested_at DESC"#,
    )
    .bind(patient_id)
    .bind(auth.user_id)
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => Json(
            rows.iter()
                .map(build_appointment_request_json)
                .collect::<Vec<_>>(),
        )
        .into_response(),
        Err(e) => {
            tracing::error!(error = %e, user_id = %auth.user_id, "list my appointment requests");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to load appointment requests",
            )
        }
    }
}

async fn create_my_appointment_request(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Json(body): Json<CreateMyAppointmentRequest>,
) -> axum::response::Response {
    if let Err(resp) = auth.require_any_role(&[Role::Patient]) {
        return resp;
    }

    let patient_id = match resolve_self_patient_id(&state, auth.user_id).await {
        Ok(value) => value,
        Err(resp) => return resp,
    };

    if !matches!(body.appointment_type.as_str(), "medical" | "non_medical") {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Appointment request type must be medical or non_medical",
        );
    }
    let care_path_kind = normalize_care_path_kind_input(body.care_path_kind.clone());
    if let Err(message) =
        validate_care_path_kind_for_appointment_type(&body.appointment_type, &care_path_kind)
    {
        return err(StatusCode::UNPROCESSABLE_ENTITY, message);
    }

    let preferred_date_from = match parse_query_date(body.preferred_date_from.clone(), "date_from")
    {
        Ok(value) => value,
        Err(_) => {
            return err(
                StatusCode::UNPROCESSABLE_ENTITY,
                "Invalid preferred_date_from (YYYY-MM-DD)",
            );
        }
    };
    let preferred_date_to = match parse_query_date(body.preferred_date_to.clone(), "date_to") {
        Ok(value) => value,
        Err(_) => {
            return err(
                StatusCode::UNPROCESSABLE_ENTITY,
                "Invalid preferred_date_to (YYYY-MM-DD)",
            );
        }
    };

    if let (Some(from), Some(to)) = (preferred_date_from, preferred_date_to)
        && to < from
    {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "preferred_date_to must be on or after preferred_date_from",
        );
    }

    let preferred_time_of_day = normalize_optional_text(body.preferred_time_of_day);
    if let Some(ref value) = preferred_time_of_day
        && !is_valid_patient_request_time_of_day(value)
    {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "preferred_time_of_day must be morning, midday, afternoon, evening or flexible",
        );
    }

    if (body.requested_provider_id.is_some() || body.requested_doctor_id.is_some())
        && let Err(resp) = validate_provider_doctor_context(
            &state,
            body.requested_provider_id,
            body.requested_doctor_id,
        )
        .await
    {
        return resp;
    }

    if let Some(order_id) = body.order_id {
        let belongs_to_patient = sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS(SELECT 1 FROM orders WHERE id = $1 AND patient_id = $2)",
        )
        .bind(order_id)
        .bind(patient_id)
        .fetch_one(&state.db)
        .await
        .unwrap_or(false);
        if !belongs_to_patient {
            return err(
                StatusCode::UNPROCESSABLE_ENTITY,
                "Order does not belong to patient",
            );
        }
    }

    let reason = normalize_optional_text(body.reason);
    let notes = normalize_optional_text(body.notes);
    let specialty = normalize_optional_text(body.specialty);
    let location = normalize_optional_text(body.location);

    if preferred_date_from.is_none() && preferred_date_to.is_none() && reason.is_none() {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Appointment request must include a preferred date or a reason",
        );
    }

    let open_request_exists = sqlx::query_scalar::<_, bool>(
        r#"SELECT EXISTS(
               SELECT 1
               FROM patient_appointment_requests
               WHERE patient_id = $1
                 AND requested_by = $2
                 AND appointment_type = $3
                 AND care_path_kind = $4
                 AND status IN ('requested', 'approved')
           )"#,
    )
    .bind(patient_id)
    .bind(auth.user_id)
    .bind(&body.appointment_type)
    .bind(&care_path_kind)
    .fetch_one(&state.db)
    .await
    .unwrap_or(false);

    if open_request_exists {
        return err(
            StatusCode::CONFLICT,
            "An open appointment request of this type already exists",
        );
    }

    let request_id = match sqlx::query_scalar::<_, Uuid>(
        r#"INSERT INTO patient_appointment_requests (
                patient_id, requested_by, order_id, appointment_type, care_path_kind, preferred_date_from,
                preferred_date_to, preferred_time_of_day, requested_provider_id,
                requested_doctor_id, specialty, location, reason, notes
           ) VALUES (
                $1, $2, $3, $4, $5, $6,
                $7, $8, $9,
                $10, $11, $12, $13, $14
           )
           RETURNING id"#,
    )
    .bind(patient_id)
    .bind(auth.user_id)
    .bind(body.order_id)
    .bind(&body.appointment_type)
    .bind(&care_path_kind)
    .bind(preferred_date_from)
    .bind(preferred_date_to)
    .bind(preferred_time_of_day.clone())
    .bind(body.requested_provider_id)
    .bind(body.requested_doctor_id)
    .bind(specialty.clone())
    .bind(location.clone())
    .bind(reason.clone())
    .bind(notes.clone())
    .fetch_one(&state.db)
    .await
    {
        Ok(id) => id,
        Err(e) => {
            tracing::error!(error = %e, user_id = %auth.user_id, "create appointment request");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to create appointment request",
            );
        }
    };

    let appointment_type = body.appointment_type.clone();

    state.audit_sender.try_send(audit::domain_event(
        "create_appointment_request",
        Some(auth.user_id),
        "appointment_request",
        Some(request_id),
        serde_json::json!({
            "patient_id": patient_id,
            "appointment_type": appointment_type.clone(),
            "care_path_kind": care_path_kind.clone(),
            "preferred_date_from": preferred_date_from.map(|value| value.to_string()),
            "preferred_date_to": preferred_date_to.map(|value| value.to_string()),
            "preferred_time_of_day": preferred_time_of_day,
            "requested_provider_id": body.requested_provider_id,
            "requested_doctor_id": body.requested_doctor_id,
            "order_id": body.order_id,
        }),
    ));

    let patient_label = sqlx::query(
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
    .unwrap_or_else(|| "Patient".to_string());

    if let Ok(notification_rows) = sqlx::query(
        r#"INSERT INTO user_notifications (user_id, kind, title, body, entity_type, entity_id)
           SELECT pa.user_id, 'appointment_request', $2, $3, 'appointment_request', $1
           FROM patient_assignments pa
           JOIN users u ON u.id = pa.user_id
           WHERE pa.patient_id = $4
             AND pa.revoked_at IS NULL
             AND u.is_active = true
             AND u.role IN ('patient_manager', 'ceo')
           RETURNING id, user_id"#,
    )
    .bind(request_id)
    .bind(format!("New appointment request: {patient_label}"))
    .bind("A patient requested appointment planning through the portal.")
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
                        "entity_type": "appointment_request",
                        "entity_id": request_id,
                    }),
                )
                .await;
            }
        }
    }

    crate::realtime::publish_appointment_request_event(
        &state,
        Some(auth.user_id),
        "appointment_request.created",
        request_id,
        patient_id,
        Some(auth.user_id),
        serde_json::json!({
            "appointment_type": appointment_type,
            "care_path_kind": care_path_kind,
            "status": "requested",
        }),
    )
    .await;

    match load_appointment_request_row(&state, request_id).await {
        Ok(Some(row)) => (
            StatusCode::CREATED,
            Json(build_appointment_request_json(&row)),
        )
            .into_response(),
        Ok(None) => err(StatusCode::NOT_FOUND, "Appointment request not found"),
        Err(resp) => resp,
    }
}

async fn list_appointment_requests(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Query(query): Query<ListAppointmentRequestsQuery>,
) -> axum::response::Response {
    if let Err(resp) = auth.require_any_role(&[Role::Ceo, Role::PatientManager]) {
        return resp;
    }

    if let Some(ref status) = query.status
        && !is_valid_appointment_request_status(status)
    {
        return err(StatusCode::UNPROCESSABLE_ENTITY, "Invalid request status");
    }
    if let Some(patient_id) = query.patient_id
        && let Err(resp) = ensure_patient_access(&state, &auth, patient_id).await
        && auth.role != Role::Ceo
    {
        return resp;
    }

    let scope_user_id = if auth.role == Role::Ceo {
        None
    } else {
        Some(auth.user_id)
    };

    match sqlx::query(
        r#"SELECT par.id, par.patient_id, par.requested_by, par.order_id, par.appointment_type,
                  par.care_path_kind,
                  par.preferred_date_from, par.preferred_date_to, par.preferred_time_of_day,
                  par.requested_provider_id, par.requested_doctor_id, par.specialty, par.location,
                  par.reason, par.notes, par.status, par.review_note, par.reviewed_by,
                  par.reviewed_at, par.requested_at, par.converted_appointment_id,
                  p.patient_id AS patient_pid,
                  trim(concat_ws(' ', p.first_name, p.last_name)) AS patient_name,
                  o.order_number,
                  provider.name AS requested_provider_name,
                  doctor.name AS requested_doctor_name,
                  reviewer.name AS reviewed_by_name,
                  converted.title AS converted_appointment_title,
                  converted.date AS converted_appointment_date
           FROM patient_appointment_requests par
           JOIN patients p ON p.id = par.patient_id
           LEFT JOIN orders o ON o.id = par.order_id
           LEFT JOIN providers provider ON provider.id = par.requested_provider_id
           LEFT JOIN provider_doctors doctor ON doctor.id = par.requested_doctor_id
           LEFT JOIN users reviewer ON reviewer.id = par.reviewed_by
           LEFT JOIN appointments converted ON converted.id = par.converted_appointment_id
           WHERE ($1::text IS NULL OR par.status = $1)
             AND ($2::uuid IS NULL OR par.patient_id = $2)
             AND (
                $3::uuid IS NULL
                OR EXISTS(
                    SELECT 1
                    FROM patient_assignments pa
                    WHERE pa.patient_id = par.patient_id
                      AND pa.user_id = $3
                      AND pa.revoked_at IS NULL
                )
             )
           ORDER BY par.requested_at DESC"#,
    )
    .bind(query.status)
    .bind(query.patient_id)
    .bind(scope_user_id)
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => Json(
            rows.iter()
                .map(build_appointment_request_json)
                .collect::<Vec<_>>(),
        )
        .into_response(),
        Err(e) => {
            tracing::error!(error = %e, user_id = %auth.user_id, "list appointment requests");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to load appointment requests",
            )
        }
    }
}

async fn review_appointment_request(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(id): Path<Uuid>,
    Json(body): Json<ReviewAppointmentRequest>,
) -> axum::response::Response {
    if let Err(resp) = auth.require_any_role(&[Role::Ceo, Role::PatientManager]) {
        return resp;
    }
    if !is_valid_review_status(&body.status) {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Review status must be approved or rejected",
        );
    }

    let row = match load_appointment_request_row(&state, id).await {
        Ok(Some(row)) => row,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Appointment request not found"),
        Err(resp) => return resp,
    };
    let patient_id = row
        .try_get::<Uuid, _>("patient_id")
        .unwrap_or_else(|_| Uuid::nil());
    let requested_by = row
        .try_get::<Uuid, _>("requested_by")
        .unwrap_or_else(|_| Uuid::nil());
    let current_status = row.try_get::<String, _>("status").unwrap_or_default();

    if let Err(resp) = ensure_patient_access(&state, &auth, patient_id).await
        && auth.role != Role::Ceo
    {
        return resp;
    }
    if current_status != "requested" {
        return err(
            StatusCode::CONFLICT,
            "Only requested appointment requests can be reviewed",
        );
    }

    let next_status = body.status.clone();
    let review_note = normalize_optional_text(body.review_note);
    if let Err(e) = sqlx::query(
        r#"UPDATE patient_appointment_requests
           SET status = $2,
               review_note = $3,
               reviewed_by = $4,
               reviewed_at = now()
           WHERE id = $1"#,
    )
    .bind(id)
    .bind(&next_status)
    .bind(review_note.clone())
    .bind(auth.user_id)
    .execute(&state.db)
    .await
    {
        tracing::error!(error = %e, request_id = %id, "review appointment request");
        return err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to review appointment request",
        );
    }

    state.audit_sender.try_send(audit::domain_event(
        "review_appointment_request",
        Some(auth.user_id),
        "appointment_request",
        Some(id),
        serde_json::json!({
            "patient_id": patient_id,
            "status": next_status.clone(),
            "review_note": review_note.clone(),
        }),
    ));

    if requested_by != Uuid::nil()
        && let Ok(notification_id) = sqlx::query_scalar::<_, Uuid>(
            "INSERT INTO user_notifications (user_id, kind, title, body, entity_type, entity_id) VALUES ($1, 'appointment_request_update', $2, $3, 'appointment_request', $4) RETURNING id",
        )
        .bind(requested_by)
        .bind(format!("Appointment request {next_status}"))
        .bind(
            if next_status == "approved" {
                "Your appointment request was approved and is waiting for scheduling."
            } else {
                "Your appointment request was reviewed and rejected."
            },
        )
        .bind(id)
        .fetch_one(&state.db)
        .await
    {
        crate::realtime::publish_notification_event(
            &state,
            requested_by,
            "notification.created",
            Some(notification_id),
            serde_json::json!({
                "entity_type": "appointment_request",
                "entity_id": id,
            }),
        )
        .await;
    }

    crate::realtime::publish_appointment_request_event(
        &state,
        Some(auth.user_id),
        "appointment_request.reviewed",
        id,
        patient_id,
        (requested_by != Uuid::nil()).then_some(requested_by),
        serde_json::json!({
            "status": next_status,
            "review_note": review_note,
        }),
    )
    .await;

    match load_appointment_request_row(&state, id).await {
        Ok(Some(row)) => Json(build_appointment_request_json(&row)).into_response(),
        Ok(None) => err(StatusCode::NOT_FOUND, "Appointment request not found"),
        Err(resp) => resp,
    }
}

async fn convert_appointment_request(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(id): Path<Uuid>,
    Json(body): Json<ConvertAppointmentRequest>,
) -> axum::response::Response {
    if let Err(resp) = auth.require_any_role(&[Role::Ceo, Role::PatientManager]) {
        return resp;
    }

    let request_row = match load_appointment_request_row(&state, id).await {
        Ok(Some(row)) => row,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Appointment request not found"),
        Err(resp) => return resp,
    };
    let patient_id = request_row
        .try_get::<Uuid, _>("patient_id")
        .unwrap_or_else(|_| Uuid::nil());
    let requested_by = request_row
        .try_get::<Uuid, _>("requested_by")
        .unwrap_or_else(|_| Uuid::nil());
    let request_status = request_row
        .try_get::<String, _>("status")
        .unwrap_or_default();
    let request_type = request_row
        .try_get::<String, _>("appointment_type")
        .unwrap_or_default();
    let request_care_path_kind = request_row
        .try_get::<String, _>("care_path_kind")
        .unwrap_or_else(|_| "regular".to_string());
    let request_order_id = request_row
        .try_get::<Option<Uuid>, _>("order_id")
        .unwrap_or_default();

    if let Err(resp) = ensure_patient_access(&state, &auth, patient_id).await
        && auth.role != Role::Ceo
    {
        return resp;
    }
    if request_status != "approved" {
        return err(
            StatusCode::CONFLICT,
            "Only approved appointment requests can be converted",
        );
    }
    if let Err(resp) =
        validate_provider_doctor_context(&state, body.provider_id, body.doctor_id).await
    {
        return resp;
    }
    if let Some(interpreter_id) = body.interpreter_id {
        match load_active_interpreter_role(&state, interpreter_id).await {
            Ok(Some(_)) => {}
            Ok(None) => {
                return err(
                    StatusCode::UNPROCESSABLE_ENTITY,
                    "interpreter_id must reference an active interpreter or teamlead interpreter",
                );
            }
            Err(resp) => return resp,
        }
    }

    let owner_user_id = resolve_owner_user_id_for_write(&auth, body.owner_user_id);
    if let Some(owner_user_id) = owner_user_id {
        match load_active_appointment_owner_role(&state, owner_user_id).await {
            Ok(Some(owner_role)) => {
                if let Err(resp) =
                    validate_owner_assignment_rules(&auth, owner_user_id, &owner_role)
                {
                    return resp;
                }
            }
            Ok(None) => {
                return err(
                    StatusCode::UNPROCESSABLE_ENTITY,
                    "owner_user_id must reference an active PM/teamlead/interpreter/concierge",
                );
            }
            Err(resp) => return resp,
        }
    }

    let date = match chrono::NaiveDate::parse_from_str(&body.date, "%Y-%m-%d") {
        Ok(value) => value,
        Err(_) => {
            return err(
                StatusCode::UNPROCESSABLE_ENTITY,
                "Invalid date (YYYY-MM-DD)",
            );
        }
    };
    let time_start = match parse_optional_time(body.time_start.as_deref()) {
        Ok(value) => value,
        Err(message) => return err(StatusCode::UNPROCESSABLE_ENTITY, message),
    };
    let time_end = match parse_optional_time(body.time_end.as_deref()) {
        Ok(value) => value,
        Err(message) => return err(StatusCode::UNPROCESSABLE_ENTITY, message),
    };
    if let (Some(time_start), Some(time_end)) = (time_start, time_end)
        && time_end <= time_start
    {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "time_end must be later than time_start",
        );
    }

    let order_id = body.order_id.or(request_order_id);
    if let Some(order_id) = order_id {
        let belongs_to_patient = sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS(SELECT 1 FROM orders WHERE id = $1 AND patient_id = $2)",
        )
        .bind(order_id)
        .bind(patient_id)
        .fetch_one(&state.db)
        .await
        .unwrap_or(false);
        if !belongs_to_patient {
            return err(
                StatusCode::UNPROCESSABLE_ENTITY,
                "Order does not belong to patient",
            );
        }
    }

    let category = normalize_optional_text(body.category);
    let location = normalize_optional_text(body.location);
    let notes = normalize_optional_text(body.notes);

    let inserted = match sqlx::query(
        "INSERT INTO appointments (patient_id, provider_id, doctor_id, owner_user_id, interpreter_id, order_id, appointment_type, care_path_kind, title, date, time_start, time_end, location, category, notes, created_by, interpreter_response)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
         RETURNING id, created_at",
    )
    .bind(patient_id)
    .bind(body.provider_id)
    .bind(body.doctor_id)
    .bind(owner_user_id)
    .bind(body.interpreter_id)
    .bind(order_id)
    .bind(&request_type)
    .bind(&request_care_path_kind)
    .bind(body.title.trim())
    .bind(date)
    .bind(time_start)
    .bind(time_end)
    .bind(location.clone())
    .bind(category.clone())
    .bind(notes.clone())
    .bind(auth.user_id)
    .bind(body.interpreter_id.map(|_| "pending"))
    .fetch_one(&state.db)
    .await
    {
        Ok(row) => row,
        Err(e) => {
            tracing::error!(error = %e, request_id = %id, "convert appointment request");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to convert appointment request",
            );
        }
    };

    let appointment_id = inserted
        .try_get::<Uuid, _>("id")
        .unwrap_or_else(|_| Uuid::nil());

    if let Some(interpreter_id) = body.interpreter_id {
        let _ = sqlx::query!(
            "INSERT INTO patient_assignments (patient_id, user_id, assigned_by)
             VALUES ($1, $2, $3)
             ON CONFLICT (patient_id, user_id) DO UPDATE SET revoked_at = NULL, assigned_by = $3, assigned_at = now()",
            patient_id,
            interpreter_id,
            auth.user_id
        )
        .execute(&state.db)
        .await;

        let _ = create_reminder_record(
            &state,
            appointment_id,
            interpreter_id,
            chrono::Utc::now(),
            format!("New assignment: {}", body.title.trim()),
            Some(format!("Appointment on {}", date)),
        )
        .await;
    }

    if request_type == "non_medical"
        && let Err(resp) = bootstrap_concierge_workflow(
            &state,
            auth.user_id,
            appointment_id,
            patient_id,
            body.title.trim(),
            date,
            time_start,
        )
        .await
    {
        return resp;
    }
    if request_type == "non_medical"
        && let Err(resp) = crate::routes::concierge_services::bootstrap_default_service(
            &state,
            auth.user_id,
            appointment_id,
        )
        .await
    {
        return resp;
    }

    if let Err(e) = sqlx::query(
        r#"UPDATE patient_appointment_requests
           SET status = 'converted',
               reviewed_by = COALESCE(reviewed_by, $2),
               reviewed_at = COALESCE(reviewed_at, now()),
               converted_appointment_id = $3
           WHERE id = $1"#,
    )
    .bind(id)
    .bind(auth.user_id)
    .bind(appointment_id)
    .execute(&state.db)
    .await
    {
        tracing::error!(error = %e, request_id = %id, appointment_id = %appointment_id, "mark appointment request converted");
        return err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to finalize appointment conversion",
        );
    }

    state.audit_sender.try_send(audit::domain_event(
        "convert_appointment_request",
        Some(auth.user_id),
        "appointment_request",
        Some(id),
        serde_json::json!({
            "patient_id": patient_id,
            "appointment_id": appointment_id,
            "appointment_type": request_type.clone(),
            "provider_id": body.provider_id,
            "doctor_id": body.doctor_id,
            "owner_user_id": owner_user_id,
            "interpreter_id": body.interpreter_id,
            "order_id": order_id,
        }),
    ));

    if requested_by != Uuid::nil()
        && let Ok(notification_id) = sqlx::query_scalar::<_, Uuid>(
            "INSERT INTO user_notifications (user_id, kind, title, body, entity_type, entity_id) VALUES ($1, 'appointment_request_update', $2, $3, 'appointment_request', $4) RETURNING id",
        )
        .bind(requested_by)
        .bind("Appointment request scheduled")
        .bind("Your appointment request was converted into a scheduled appointment.")
        .bind(id)
        .fetch_one(&state.db)
        .await
    {
        crate::realtime::publish_notification_event(
            &state,
            requested_by,
            "notification.created",
            Some(notification_id),
            serde_json::json!({
                "entity_type": "appointment_request",
                "entity_id": id,
            }),
        )
        .await;
    }

    crate::realtime::publish_appointment_request_event(
        &state,
        Some(auth.user_id),
        "appointment_request.converted",
        id,
        patient_id,
        (requested_by != Uuid::nil()).then_some(requested_by),
        serde_json::json!({
            "appointment_id": appointment_id,
            "status": "converted",
        }),
    )
    .await;

    crate::realtime::publish_appointment_event(
        &state,
        Some(auth.user_id),
        "appointment.created",
        appointment_id,
        serde_json::json!({
            "source": "appointment_request",
            "request_id": id,
            "appointment_type": request_type,
            "care_path_kind": request_care_path_kind,
        }),
    )
    .await;

    Json(serde_json::json!({
        "ok": true,
        "request_id": id,
        "appointment_id": appointment_id,
        "status": "converted",
    }))
    .into_response()
}

async fn list_appointments(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Query(query): Query<ListAppointmentsQuery>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[
        Role::Ceo,
        Role::PatientManager,
        Role::TeamleadInterpreter,
        Role::Interpreter,
        Role::Concierge,
    ]) {
        return e;
    }

    if let Some(ref appointment_type) = query.appointment_type
        && !is_valid_appointment_type(appointment_type)
    {
        return err(StatusCode::UNPROCESSABLE_ENTITY, "Invalid type");
    }
    if let Some(ref care_path_kind) = query.care_path_kind
        && !is_valid_care_path_kind(care_path_kind)
    {
        return err(StatusCode::UNPROCESSABLE_ENTITY, "Invalid care_path_kind");
    }
    if let Some(ref status) = query.status
        && !is_valid_appointment_status(status)
    {
        return err(StatusCode::UNPROCESSABLE_ENTITY, "Invalid status");
    }

    let date_from = match parse_query_date(query.date_from, "date_from") {
        Ok(value) => value,
        Err(message) => return err(StatusCode::UNPROCESSABLE_ENTITY, message),
    };
    let date_to = match parse_query_date(query.date_to, "date_to") {
        Ok(value) => value,
        Err(message) => return err(StatusCode::UNPROCESSABLE_ENTITY, message),
    };
    let search_pattern = format!("%{}%", query.search.unwrap_or_default());
    let assignment_set = if access::requires_patient_assignment(auth.role) {
        match access::load_active_patient_assignment_set(&state.db, auth.user_id).await {
            Ok(value) => Some(value),
            Err(e) => {
                tracing::error!(error = %e, user_id = %auth.user_id, "load appointment assignment set");
                return err(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Failed to validate appointment access",
                );
            }
        }
    } else {
        None
    };

    match sqlx::query(
        r#"SELECT a.id, a.title, a.date, a.time_start, a.time_end, a.appointment_type, a.care_path_kind, a.status,
                  a.location, a.interpreter_response, a.checklist_phase, a.patient_id, a.interpreter_id,
                  a.provider_id, a.doctor_id, a.owner_user_id,
                  a.recurrence_series_id, a.recurrence_frequency, a.recurrence_interval,
                  a.recurrence_count, a.recurrence_until, a.recurrence_index,
                  CASE
                      WHEN a.recurrence_series_id IS NULL THEN 1
                      ELSE (
                          SELECT COUNT(*)
                          FROM appointments series
                          WHERE series.recurrence_series_id = a.recurrence_series_id
                      )
                  END AS recurrence_series_size,
                  p.first_name, p.last_name, p.patient_id AS patient_code,
                  pr.name AS provider_name,
                  d.name AS doctor_name,
                  u.name AS interpreter_name,
                  owner.name AS owner_name,
                  owner.role AS owner_role
           FROM appointments a
           JOIN patients p ON p.id = a.patient_id
           LEFT JOIN providers pr ON pr.id = a.provider_id
           LEFT JOIN provider_doctors d ON d.id = a.doctor_id
           LEFT JOIN users u ON u.id = a.interpreter_id
           LEFT JOIN users owner ON owner.id = a.owner_user_id
           WHERE ($1::text = '%%'
                  OR a.title ILIKE $1
                  OR COALESCE(a.location, '') ILIKE $1
                  OR p.first_name ILIKE $1
                  OR p.last_name ILIKE $1
                  OR p.patient_id ILIKE $1
                  OR COALESCE(pr.name, '') ILIKE $1
                  OR COALESCE(d.name, '') ILIKE $1
                  OR COALESCE(owner.name, '') ILIKE $1
           )
             AND ($2::text IS NULL OR a.appointment_type = $2)
             AND ($3::text IS NULL OR a.care_path_kind = $3)
             AND ($4::text IS NULL OR a.status = $4)
             AND ($5::uuid IS NULL OR a.patient_id = $5)
             AND ($6::uuid IS NULL OR a.provider_id = $6)
             AND ($7::uuid IS NULL OR a.doctor_id = $7)
             AND ($8::uuid IS NULL OR a.owner_user_id = $8)
             AND ($9::uuid IS NULL OR a.interpreter_id = $9)
             AND ($10::date IS NULL OR a.date >= $10)
             AND ($11::date IS NULL OR a.date <= $11)
             AND (
                $12::uuid IS NULL
                OR EXISTS (
                    WITH RECURSIVE selected_taxonomy AS (
                        SELECT n.id
                        FROM provider_taxonomy_nodes n
                        WHERE n.id = $12
                        UNION ALL
                        SELECT child.id
                        FROM provider_taxonomy_nodes child
                        JOIN selected_taxonomy parent
                          ON child.parent_id = parent.id
                    )
                    SELECT 1
                    FROM provider_taxonomy_assignments pta_filter
                    JOIN selected_taxonomy st
                      ON st.id = pta_filter.taxonomy_node_id
                    WHERE pta_filter.provider_id = a.provider_id
                )
             )
           ORDER BY a.date DESC, a.time_start
           LIMIT 200"#,
    )
    .bind(search_pattern)
    .bind(query.appointment_type)
    .bind(query.care_path_kind)
    .bind(query.status)
    .bind(query.patient_id)
    .bind(query.provider_id)
    .bind(query.doctor_id)
    .bind(query.owner_user_id)
    .bind(query.interpreter_id)
    .bind(date_from)
    .bind(date_to)
    .bind(query.provider_taxonomy_node_id)
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => {
            let mut items = Vec::with_capacity(rows.len());
            for r in rows {
                let appointment_id: Uuid = match r.try_get("id") {
                    Ok(value) => value,
                    Err(_) => return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed"),
                };
                let patient_id: Uuid = match r.try_get("patient_id") {
                    Ok(value) => value,
                    Err(_) => return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed"),
                };
                let interpreter_id: Option<Uuid> = match r.try_get("interpreter_id") {
                    Ok(value) => value,
                    Err(_) => return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed"),
                };
                let owner_user_id: Option<Uuid> = match r.try_get("owner_user_id") {
                    Ok(value) => value,
                    Err(_) => return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed"),
                };

                if !can_access_appointment_row(
                    &auth,
                    patient_id,
                    interpreter_id,
                    owner_user_id,
                    assignment_set.as_ref(),
                ) {
                    continue;
                }

                items.push(build_appointment_list_json(&auth, &r, appointment_id, patient_id));
            }
            Json(items).into_response()
        }
        Err(e) => { tracing::error!(error = %e, "list appointments"); err(StatusCode::INTERNAL_SERVER_ERROR, "Failed") }
    }
}

async fn list_attention_items(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Query(query): Query<ListAppointmentsQuery>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[
        Role::Ceo,
        Role::PatientManager,
        Role::TeamleadInterpreter,
        Role::Interpreter,
        Role::Concierge,
    ]) {
        return e;
    }

    if let Some(ref appointment_type) = query.appointment_type
        && !is_valid_appointment_type(appointment_type)
    {
        return err(StatusCode::UNPROCESSABLE_ENTITY, "Invalid type");
    }
    if let Some(ref care_path_kind) = query.care_path_kind
        && !is_valid_care_path_kind(care_path_kind)
    {
        return err(StatusCode::UNPROCESSABLE_ENTITY, "Invalid care_path_kind");
    }
    if let Some(ref status) = query.status
        && !is_valid_appointment_status(status)
    {
        return err(StatusCode::UNPROCESSABLE_ENTITY, "Invalid status");
    }

    let date_from = match parse_query_date(query.date_from, "date_from") {
        Ok(value) => value,
        Err(message) => return err(StatusCode::UNPROCESSABLE_ENTITY, message),
    };
    let date_to = match parse_query_date(query.date_to, "date_to") {
        Ok(value) => value,
        Err(message) => return err(StatusCode::UNPROCESSABLE_ENTITY, message),
    };
    let search_pattern = format!("%{}%", query.search.unwrap_or_default());
    let today = chrono::Utc::now().date_naive();
    let preparation_window_end = today + chrono::Days::new(2);
    let assignment_set = if access::requires_patient_assignment(auth.role) {
        match access::load_active_patient_assignment_set(&state.db, auth.user_id).await {
            Ok(value) => Some(value),
            Err(e) => {
                tracing::error!(error = %e, user_id = %auth.user_id, "load appointment attention assignment set");
                return err(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Failed to validate appointment access",
                );
            }
        }
    } else {
        None
    };

    match sqlx::query(
        r#"SELECT a.id, a.title, a.date, a.time_start, a.time_end, a.appointment_type, a.care_path_kind, a.status,
                  a.location, a.interpreter_response, a.checklist_phase, a.patient_id, a.interpreter_id,
                  a.provider_id, a.doctor_id, a.owner_user_id,
                  a.recurrence_series_id, a.recurrence_frequency, a.recurrence_interval,
                  a.recurrence_count, a.recurrence_until, a.recurrence_index,
                  CASE
                      WHEN a.recurrence_series_id IS NULL THEN 1
                      ELSE (
                          SELECT COUNT(*)
                          FROM appointments series
                          WHERE series.recurrence_series_id = a.recurrence_series_id
                      )
                  END AS recurrence_series_size,
                  p.first_name, p.last_name, p.patient_id AS patient_code,
                  pr.name AS provider_name,
                  d.name AS doctor_name,
                  u.name AS interpreter_name,
                  owner.name AS owner_name,
                  owner.role AS owner_role,
                  COALESCE(checklists.open_count, 0) AS open_checklist_count,
                  COALESCE(tasks.open_count, 0) AS open_task_count,
                  COALESCE(reminders.open_count, 0) AS open_reminder_count,
                  COALESCE(reminders.overdue_count, 0) AS overdue_reminder_count,
                  reminders.next_due_at AS next_reminder_due_at,
                  COALESCE(comms.open_count, 0) AS open_communication_count,
                  comms.next_due_at AS next_communication_due_at,
                  latest_report.approval_status AS latest_report_status
           FROM appointments a
           JOIN patients p ON p.id = a.patient_id
           LEFT JOIN providers pr ON pr.id = a.provider_id
           LEFT JOIN provider_doctors d ON d.id = a.doctor_id
           LEFT JOIN users u ON u.id = a.interpreter_id
           LEFT JOIN users owner ON owner.id = a.owner_user_id
           LEFT JOIN LATERAL (
             SELECT COUNT(*) FILTER (WHERE NOT c.is_completed) AS open_count
             FROM appointment_checklists c
             WHERE c.appointment_id = a.id
           ) checklists ON true
           LEFT JOIN LATERAL (
             SELECT COUNT(*) FILTER (WHERE t.status NOT IN ('completed', 'cancelled')) AS open_count
             FROM tasks t
             WHERE t.appointment_id = a.id
           ) tasks ON true
           LEFT JOIN LATERAL (
             SELECT COUNT(*) FILTER (WHERE NOT r.is_completed) AS open_count,
                    COUNT(*) FILTER (WHERE NOT r.is_completed AND r.remind_at <= now()) AS overdue_count,
                    MIN(r.remind_at) FILTER (WHERE NOT r.is_completed) AS next_due_at
             FROM reminders r
             WHERE r.appointment_id = a.id
           ) reminders ON true
           LEFT JOIN LATERAL (
             SELECT COUNT(*) FILTER (WHERE ac.status NOT IN ('closed', 'cancelled')) AS open_count,
                    MIN(ac.due_at) FILTER (WHERE ac.status NOT IN ('closed', 'cancelled') AND ac.due_at IS NOT NULL) AS next_due_at
             FROM appointment_communications ac
             WHERE ac.appointment_id = a.id
           ) comms ON true
           LEFT JOIN LATERAL (
             SELECT ir.approval_status
             FROM interpreter_reports ir
             WHERE ir.appointment_id = a.id
             ORDER BY ir.created_at DESC
             LIMIT 1
           ) latest_report ON true
           WHERE ($1::text = '%%'
                  OR a.title ILIKE $1
                  OR COALESCE(a.location, '') ILIKE $1
                  OR p.first_name ILIKE $1
                  OR p.last_name ILIKE $1
                  OR p.patient_id ILIKE $1
                  OR COALESCE(pr.name, '') ILIKE $1
                  OR COALESCE(d.name, '') ILIKE $1
                  OR COALESCE(owner.name, '') ILIKE $1)
             AND ($2::text IS NULL OR a.appointment_type = $2)
             AND ($3::text IS NULL OR a.care_path_kind = $3)
             AND ($4::text IS NULL OR a.status = $4)
             AND ($5::uuid IS NULL OR a.patient_id = $5)
             AND ($6::uuid IS NULL OR a.provider_id = $6)
             AND ($7::uuid IS NULL OR a.doctor_id = $7)
             AND ($8::uuid IS NULL OR a.owner_user_id = $8)
             AND ($9::uuid IS NULL OR a.interpreter_id = $9)
             AND ($10::date IS NULL OR a.date >= $10)
             AND ($11::date IS NULL OR a.date <= $11)
             AND (
                $12::uuid IS NULL
                OR EXISTS (
                    WITH RECURSIVE selected_taxonomy AS (
                        SELECT n.id
                        FROM provider_taxonomy_nodes n
                        WHERE n.id = $12
                        UNION ALL
                        SELECT child.id
                        FROM provider_taxonomy_nodes child
                        JOIN selected_taxonomy parent
                          ON child.parent_id = parent.id
                    )
                    SELECT 1
                    FROM provider_taxonomy_assignments pta_filter
                    JOIN selected_taxonomy st
                      ON st.id = pta_filter.taxonomy_node_id
                    WHERE pta_filter.provider_id = a.provider_id
                )
             )
           ORDER BY a.date DESC, a.time_start
           LIMIT 200"#,
    )
    .bind(search_pattern)
    .bind(query.appointment_type)
    .bind(query.care_path_kind)
    .bind(query.status)
    .bind(query.patient_id)
    .bind(query.provider_id)
    .bind(query.doctor_id)
    .bind(query.owner_user_id)
    .bind(query.interpreter_id)
    .bind(date_from)
    .bind(date_to)
    .bind(query.provider_taxonomy_node_id)
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => {
            let mut items = Vec::new();
            for row in rows {
                let appointment_id: Uuid = match row.try_get("id") {
                    Ok(value) => value,
                    Err(_) => return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed"),
                };
                let patient_id: Uuid = match row.try_get("patient_id") {
                    Ok(value) => value,
                    Err(_) => return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed"),
                };
                let interpreter_id: Option<Uuid> = match row.try_get("interpreter_id") {
                    Ok(value) => value,
                    Err(_) => return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed"),
                };
                let owner_user_id: Option<Uuid> = match row.try_get("owner_user_id") {
                    Ok(value) => value,
                    Err(_) => return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed"),
                };

                if !can_access_appointment_row(
                    &auth,
                    patient_id,
                    interpreter_id,
                    owner_user_id,
                    assignment_set.as_ref(),
                ) {
                    continue;
                }

                let appointment_date: chrono::NaiveDate = match row.try_get("date") {
                    Ok(value) => value,
                    Err(_) => return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed"),
                };
                let status: String = row.try_get("status").unwrap_or_default();
                let interpreter_response: Option<String> =
                    row.try_get("interpreter_response").unwrap_or_default();
                let open_checklist_count: i64 =
                    row.try_get("open_checklist_count").unwrap_or_default();
                let open_task_count: i64 = row.try_get("open_task_count").unwrap_or_default();
                let open_reminder_count: i64 =
                    row.try_get("open_reminder_count").unwrap_or_default();
                let overdue_reminder_count: i64 =
                    row.try_get("overdue_reminder_count").unwrap_or_default();
                let open_communication_count: i64 =
                    row.try_get("open_communication_count").unwrap_or_default();
                let latest_report_status: Option<String> =
                    row.try_get("latest_report_status").unwrap_or_default();
                let next_reminder_due_at: Option<chrono::DateTime<chrono::Utc>> =
                    row.try_get("next_reminder_due_at").unwrap_or_default();
                let next_communication_due_at: Option<chrono::DateTime<chrono::Utc>> =
                    row.try_get("next_communication_due_at").unwrap_or_default();

                let mut reasons = Vec::new();
                let mut reason_details = Vec::new();
                let mut push_reason = |
                    key: &str,
                    fallback: String,
                    values: serde_json::Value,
                | {
                    reasons.push(fallback.clone());
                    reason_details.push(serde_json::json!({
                        "key": key,
                        "fallback": fallback,
                        "values": values,
                    }));
                };
                if appointment_date < today && !matches!(status.as_str(), "completed" | "cancelled")
                {
                    push_reason(
                        "appointments_attention_reason_past_visit_still_not_closed",
                        "Past visit is still not closed".to_string(),
                        serde_json::json!({}),
                    );
                }
                if appointment_date >= today
                    && appointment_date <= preparation_window_end
                    && open_checklist_count > 0
                {
                    push_reason(
                        "appointments_attention_reason_preparation_checklist_open_count",
                        format!("{open_checklist_count} preparation or follow-up checklist item(s) remain open"),
                        serde_json::json!({ "count": open_checklist_count }),
                    );
                }
                if appointment_date >= today
                    && appointment_date <= preparation_window_end
                    && interpreter_id.is_some()
                    && interpreter_response.as_deref() != Some("accepted")
                {
                    push_reason(
                        "appointments_attention_reason_interpreter_confirmation_pending",
                        "Interpreter confirmation is still pending".to_string(),
                        serde_json::json!({}),
                    );
                }
                if overdue_reminder_count > 0 {
                    push_reason(
                        "appointments_attention_reason_overdue_reminders_count",
                        format!("{overdue_reminder_count} reminder(s) are overdue"),
                        serde_json::json!({ "count": overdue_reminder_count }),
                    );
                }
                if appointment_date < today && open_task_count > 0 {
                    push_reason(
                        "appointments_attention_reason_open_tasks_count",
                        format!("{open_task_count} operational task(s) remain open"),
                        serde_json::json!({ "count": open_task_count }),
                    );
                }
                if appointment_date < today && open_checklist_count > 0 {
                    push_reason(
                        "appointments_attention_reason_visit_processing_checklist_open_count",
                        format!("{open_checklist_count} visit-processing checklist item(s) remain open"),
                        serde_json::json!({ "count": open_checklist_count }),
                    );
                }
                if appointment_date < today && open_communication_count > 0 {
                    push_reason(
                        "appointments_attention_reason_open_communication_threads_count",
                        format!("{open_communication_count} external communication thread(s) remain open"),
                        serde_json::json!({ "count": open_communication_count }),
                    );
                }
                if interpreter_id.is_some()
                    && appointment_date <= today
                    && latest_report_status.as_deref() != Some("approved")
                {
                    push_reason(
                        "appointments_attention_reason_interpreter_report_pending",
                        "Interpreter report or approval is still pending".to_string(),
                        serde_json::json!({}),
                    );
                }
                if appointment_date < today && open_reminder_count > 0 && overdue_reminder_count == 0
                {
                    push_reason(
                        "appointments_attention_reason_active_reminders_count",
                        format!("{open_reminder_count} reminder(s) are still active"),
                        serde_json::json!({ "count": open_reminder_count }),
                    );
                }

                if reasons.is_empty() {
                    continue;
                }

                let next_due_at = match (next_reminder_due_at, next_communication_due_at) {
                    (Some(left), Some(right)) => Some(std::cmp::min(left, right).to_rfc3339()),
                    (Some(value), None) | (None, Some(value)) => Some(value.to_rfc3339()),
                    (None, None) => None,
                };

                let mut item = build_appointment_list_json(&auth, &row, appointment_id, patient_id);
                if let Some(object) = item.as_object_mut() {
                    object.insert("attention_score".to_string(), serde_json::json!(reasons.len()));
                    object.insert("reasons".to_string(), serde_json::json!(reasons));
                    object.insert("reason_details".to_string(), serde_json::json!(reason_details));
                    object.insert("next_due_at".to_string(), serde_json::json!(next_due_at));
                }
                items.push(item);
            }
            Json(items).into_response()
        }
        Err(e) => {
            tracing::error!(error = %e, "list appointment attention items");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to list appointment attention items",
            )
        }
    }
}

async fn list_interpreters(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
) -> impl IntoResponse {
    auth.require_any_role(&[
        Role::Ceo,
        Role::PatientManager,
        Role::TeamleadInterpreter,
        Role::Interpreter,
        Role::Concierge,
    ])?;

    match sqlx::query(
        r#"SELECT id, name, role
           FROM users
           WHERE is_active = true
             AND role IN ('interpreter', 'teamlead_interpreter')
           ORDER BY name"#,
    )
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => {
            let mut items = Vec::with_capacity(rows.len());
            for row in rows {
                items.push(InterpreterOptionResponse {
                    id: row.try_get("id").unwrap_or_else(|_| Uuid::nil()),
                    name: row.try_get("name").unwrap_or_default(),
                    role: row.try_get("role").unwrap_or_default(),
                });
            }
            Ok(Json(items))
        }
        Err(e) => {
            tracing::error!(error = %e, "list interpreters");
            Err(err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to load interpreters",
            ))
        }
    }
}

async fn list_staff(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
) -> impl IntoResponse {
    auth.require_any_role(&[
        Role::Ceo,
        Role::PatientManager,
        Role::TeamleadInterpreter,
        Role::Interpreter,
        Role::Concierge,
    ])?;

    match sqlx::query(
        r#"SELECT id, name, role
           FROM users
           WHERE is_active = true
             AND role IN (
                'ceo',
                'patient_manager',
                'teamlead_interpreter',
                'interpreter',
                'concierge'
             )
           ORDER BY role, name"#,
    )
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => {
            let mut items = Vec::with_capacity(rows.len());
            for row in rows {
                items.push(StaffOptionResponse {
                    id: row.try_get("id").unwrap_or_else(|_| Uuid::nil()),
                    name: row.try_get("name").unwrap_or_default(),
                    role: row.try_get("role").unwrap_or_default(),
                });
            }
            Ok(Json(items))
        }
        Err(e) => {
            tracing::error!(error = %e, "list staff");
            Err(err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to load staff",
            ))
        }
    }
}

async fn get_conflicts(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Query(query): Query<AppointmentConflictsQuery>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[
        Role::Ceo,
        Role::PatientManager,
        Role::TeamleadInterpreter,
        Role::Interpreter,
        Role::Concierge,
    ]) {
        return e;
    }

    if let Err(resp) = ensure_patient_access(&state, &auth, query.patient_id).await
        && auth.role != Role::Ceo
    {
        return resp;
    }

    let date = match chrono::NaiveDate::parse_from_str(&query.date, "%Y-%m-%d") {
        Ok(value) => value,
        Err(_) => {
            return err(
                StatusCode::UNPROCESSABLE_ENTITY,
                "Invalid date (YYYY-MM-DD)",
            );
        }
    };

    let time_start = match parse_optional_time(query.time_start.as_deref()) {
        Ok(value) => value,
        Err(message) => return err(StatusCode::UNPROCESSABLE_ENTITY, message),
    };
    let time_end = match parse_optional_time(query.time_end.as_deref()) {
        Ok(value) => value,
        Err(message) => return err(StatusCode::UNPROCESSABLE_ENTITY, message),
    };

    match build_conflicts_payload(
        &state,
        &auth,
        query.patient_id,
        query.interpreter_id,
        date,
        time_start,
        time_end,
        query.appointment_id,
    )
    .await
    {
        Ok(payload) => Json::<serde_json::Value>(payload).into_response(),
        Err(resp) => resp,
    }
}

async fn create_appointment(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Json(body): Json<CreateAppointment>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[
        Role::Ceo,
        Role::PatientManager,
        Role::TeamleadInterpreter,
        Role::Concierge,
    ]) {
        return e;
    }
    match ensure_patient_access(&state, &auth, body.patient_id).await {
        Ok(()) => {}
        Err(resp) => return resp,
    }
    if let Err(resp) =
        validate_provider_doctor_context(&state, body.provider_id, body.doctor_id).await
    {
        return resp;
    }
    if let Some(interpreter_id) = body.interpreter_id {
        match load_active_interpreter_role(&state, interpreter_id).await {
            Ok(Some(_)) => {}
            Ok(None) => {
                return err(
                    StatusCode::UNPROCESSABLE_ENTITY,
                    "interpreter_id must reference an active interpreter or teamlead interpreter",
                );
            }
            Err(resp) => return resp,
        }
    }
    if let Some(owner_user_id) = body.owner_user_id {
        match load_active_appointment_owner_role(&state, owner_user_id).await {
            Ok(Some(owner_role)) => {
                if let Err(resp) =
                    validate_owner_assignment_rules(&auth, owner_user_id, &owner_role)
                {
                    return resp;
                }
            }
            Ok(None) => {
                return err(
                    StatusCode::UNPROCESSABLE_ENTITY,
                    "owner_user_id must reference an active PM/teamlead/interpreter/concierge",
                );
            }
            Err(resp) => return resp,
        }
    }

    if !is_valid_appointment_type(&body.appointment_type) {
        return err(StatusCode::UNPROCESSABLE_ENTITY, "Invalid type");
    }
    if body.appointment_type == "medical"
        && body.provider_id.is_none()
        && !body.skip_medical_provider_binding.unwrap_or(false)
    {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Medical appointments require a provider or explicit provider binding opt-out",
        );
    }
    let care_path_kind = normalize_care_path_kind_input(body.care_path_kind.clone());
    if let Err(message) =
        validate_care_path_kind_for_appointment_type(&body.appointment_type, &care_path_kind)
    {
        return err(StatusCode::UNPROCESSABLE_ENTITY, message);
    }
    if auth.role == Role::Concierge
        && !matches!(body.appointment_type.as_str(), "non_medical" | "internal")
    {
        return err(
            StatusCode::FORBIDDEN,
            "Concierge can only create non-medical or internal appointments",
        );
    }

    let date = match chrono::NaiveDate::parse_from_str(&body.date, "%Y-%m-%d") {
        Ok(d) => d,
        Err(_) => {
            return err(
                StatusCode::UNPROCESSABLE_ENTITY,
                "Invalid date (YYYY-MM-DD)",
            );
        }
    };

    let time_start = match parse_optional_time(body.time_start.as_deref()) {
        Ok(value) => value,
        Err(message) => return err(StatusCode::UNPROCESSABLE_ENTITY, message),
    };
    let time_end = match parse_optional_time(body.time_end.as_deref()) {
        Ok(value) => value,
        Err(message) => return err(StatusCode::UNPROCESSABLE_ENTITY, message),
    };
    if let (Some(time_start), Some(time_end)) = (time_start, time_end)
        && time_end <= time_start
    {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "time_end must be later than time_start",
        );
    }

    let recurrence = match parse_appointment_recurrence(&body, date) {
        Ok(value) => value,
        Err(resp) => return resp,
    };
    let appointment_dates = match build_recurrence_dates(date, recurrence.as_ref()) {
        Ok(value) => value,
        Err(resp) => return resp,
    };

    let CreateAppointment {
        patient_id,
        provider_id,
        doctor_id,
        owner_user_id,
        interpreter_id,
        order_id,
        appointment_type,
        skip_medical_provider_binding: _,
        care_path_kind: _,
        title,
        date: _,
        time_start: _,
        time_end: _,
        location,
        category,
        notes,
        recurrence_frequency: _,
        recurrence_interval: _,
        recurrence_count: _,
        recurrence_until: _,
    } = body;
    let owner_user_id = resolve_owner_user_id_for_write(&auth, owner_user_id);
    let mut tx = match state.db.begin().await {
        Ok(value) => value,
        Err(e) => {
            tracing::error!(error = %e, "create appointment: begin tx");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };

    let root_appointment_id = Uuid::new_v4();
    let recurrence_series_id = recurrence.as_ref().map(|_| root_appointment_id);
    let materialized_recurrence_count = recurrence.as_ref().map(|_| appointment_dates.len() as i32);
    let materialized_recurrence_until = recurrence
        .as_ref()
        .and_then(|_| appointment_dates.last().copied());
    let mut created_at = String::new();
    let mut created_appointments = Vec::with_capacity(appointment_dates.len());

    for (index, occurrence_date) in appointment_dates.iter().copied().enumerate() {
        if let Err(resp) = acquire_appointment_schedule_locks(
            &mut tx,
            patient_id,
            interpreter_id,
            doctor_id,
            occurrence_date,
        )
        .await
        {
            return resp;
        }
        if let Err(resp) = ensure_no_overlapping_appointments_in_tx(
            &mut tx,
            patient_id,
            interpreter_id,
            doctor_id,
            occurrence_date,
            time_start,
            time_end,
            &[],
        )
        .await
        {
            return resp;
        }

        let appointment_id = if index == 0 {
            root_appointment_id
        } else {
            Uuid::new_v4()
        };

        let insert_result = sqlx::query(
            "INSERT INTO appointments (id, patient_id, provider_id, doctor_id, owner_user_id, interpreter_id, order_id, appointment_type, care_path_kind, title, date, time_start, time_end, location, category, notes, recurrence_series_id, recurrence_frequency, recurrence_interval, recurrence_count, recurrence_until, recurrence_index, created_by, interpreter_response)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)
             RETURNING created_at",
        )
        .bind(appointment_id)
        .bind(patient_id)
        .bind(provider_id)
        .bind(doctor_id)
        .bind(owner_user_id)
        .bind(interpreter_id)
        .bind(order_id)
        .bind(&appointment_type)
        .bind(&care_path_kind)
        .bind(&title)
        .bind(occurrence_date)
        .bind(time_start)
        .bind(time_end)
        .bind(location.as_deref())
        .bind(category.as_deref())
        .bind(notes.as_deref())
        .bind(recurrence_series_id)
        .bind(recurrence.as_ref().map(|value| value.frequency.as_str()))
        .bind(recurrence.as_ref().map(|value| value.interval))
        .bind(materialized_recurrence_count)
        .bind(materialized_recurrence_until)
        .bind(index as i32)
        .bind(auth.user_id)
        .bind(interpreter_id.map(|_| "pending"))
        .fetch_one(&mut *tx)
        .await;

        let row = match insert_result {
            Ok(value) => value,
            Err(e) => {
                if let Some(resp) = appointment_schedule_conflict_from_db_error(&e) {
                    return resp;
                }
                tracing::error!(error = %e, appointment_id = %appointment_id, "create appointment: insert");
                return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
            }
        };

        if index == 0 {
            created_at = row
                .try_get::<chrono::DateTime<chrono::Utc>, _>("created_at")
                .map(|value| value.to_rfc3339())
                .unwrap_or_default();
        }

        created_appointments.push((appointment_id, occurrence_date));
    }

    if let Err(e) = tx.commit().await {
        tracing::error!(error = %e, "create appointment: commit");
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
    }

    if let Some(interpreter_id) = interpreter_id {
        let _ = sqlx::query!(
            "INSERT INTO patient_assignments (patient_id, user_id, assigned_by)
             VALUES ($1, $2, $3)
             ON CONFLICT (patient_id, user_id) DO UPDATE SET revoked_at = NULL, assigned_by = $3, assigned_at = now()",
            patient_id,
            interpreter_id,
            auth.user_id
        )
        .execute(&state.db)
        .await;
    }

    for (appointment_id, occurrence_date) in &created_appointments {
        if let Some(interpreter_id) = interpreter_id {
            let _ = create_reminder_record(
                &state,
                *appointment_id,
                interpreter_id,
                chrono::Utc::now(),
                format!("New assignment: {title}"),
                Some(format!("Appointment on {}", occurrence_date)),
            )
            .await;
        }

        if appointment_type == "non_medical"
            && let Err(resp) = bootstrap_concierge_workflow(
                &state,
                auth.user_id,
                *appointment_id,
                patient_id,
                &title,
                *occurrence_date,
                time_start,
            )
            .await
        {
            return resp;
        }
        if appointment_type == "non_medical"
            && let Err(resp) = crate::routes::concierge_services::bootstrap_default_service(
                &state,
                auth.user_id,
                *appointment_id,
            )
            .await
        {
            return resp;
        }
    }

    let mut conflict_payloads = Vec::with_capacity(created_appointments.len());
    for (appointment_id, occurrence_date) in &created_appointments {
        let conflicts = match build_conflicts_payload(
            &state,
            &auth,
            patient_id,
            interpreter_id,
            *occurrence_date,
            time_start,
            time_end,
            Some(*appointment_id),
        )
        .await
        {
            Ok(value) => value,
            Err(resp) => return resp,
        };
        conflict_payloads.push(conflicts);
    }
    let conflicts = merge_conflicts_payload(&conflict_payloads);

    state.audit_sender.try_send(audit::domain_event(
        "create_appointment",
        Some(auth.user_id),
        "appointment",
        Some(root_appointment_id),
        serde_json::json!({
            "provider_id": provider_id,
            "doctor_id": doctor_id,
            "owner_user_id": owner_user_id,
            "interpreter_id": interpreter_id,
            "care_path_kind": care_path_kind,
            "series_created_count": created_appointments.len(),
            "recurrence_frequency": recurrence.as_ref().map(|value| value.frequency.as_str()),
            "recurrence_interval": recurrence.as_ref().map(|value| value.interval),
            "recurrence_count": materialized_recurrence_count,
            "recurrence_until": materialized_recurrence_until.map(|date| date.to_string()),
        }),
    ));
    tracing::info!(by = %auth.user_id, apt = %root_appointment_id, series_created_count = created_appointments.len(), "Appointment created");
    crate::realtime::publish_appointment_event(
        &state,
        Some(auth.user_id),
        "appointment.created",
        root_appointment_id,
        serde_json::json!({ "series_created_count": created_appointments.len() }),
    )
    .await;
    (
        StatusCode::CREATED,
        Json(serde_json::json!({
            "id": root_appointment_id,
            "created_at": created_at,
            "conflicts": conflicts,
            "series_created_count": created_appointments.len(),
        })),
    )
        .into_response()
}

fn is_valid_appointment_type(value: &str) -> bool {
    matches!(value, "medical" | "non_medical" | "internal")
}

fn is_valid_care_path_kind(value: &str) -> bool {
    matches!(value, "regular" | "preventive" | "control" | "followup")
}

fn normalize_care_path_kind_input(value: Option<String>) -> String {
    value
        .map(|raw| raw.trim().to_lowercase().replace('-', "_"))
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "regular".to_string())
}

fn validate_care_path_kind_for_appointment_type(
    appointment_type: &str,
    care_path_kind: &str,
) -> Result<(), &'static str> {
    if !is_valid_care_path_kind(care_path_kind) {
        return Err("care_path_kind must be regular, preventive, control or followup");
    }
    if appointment_type != "medical" && care_path_kind != "regular" {
        return Err("Only medical appointments can use preventive, control or followup care paths");
    }
    Ok(())
}

fn is_valid_appointment_status(value: &str) -> bool {
    matches!(
        value,
        "planned" | "confirmed" | "in_progress" | "completed" | "cancelled"
    )
}

fn is_valid_checklist_phase(value: &str) -> bool {
    matches!(value, "preparation" | "execution" | "followup" | "done")
}

fn is_valid_recurrence_frequency(value: &str) -> bool {
    matches!(value, "daily" | "weekly" | "monthly")
}

fn parse_appointment_recurrence_scope(
    value: Option<&str>,
    recurrence_series_id: Option<Uuid>,
) -> Result<AppointmentRecurrenceScope, &'static str> {
    match value.map(str::trim).filter(|value| !value.is_empty()) {
        None | Some("single") => Ok(AppointmentRecurrenceScope::Single),
        Some("following") => {
            if recurrence_series_id.is_some() {
                Ok(AppointmentRecurrenceScope::Following)
            } else {
                Err("Following scope is only available for recurring appointments")
            }
        }
        Some("series") => {
            if recurrence_series_id.is_some() {
                Ok(AppointmentRecurrenceScope::Series)
            } else {
                Err("Series scope is only available for recurring appointments")
            }
        }
        _ => Err("recurrence_scope must be single, following or series"),
    }
}

async fn recompute_appointment_series_metadata(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    series_id: Uuid,
) -> Result<(), axum::response::Response> {
    let rows = sqlx::query(
        r#"SELECT id, date
           FROM appointments
           WHERE recurrence_series_id = $1
           ORDER BY date, recurrence_index, created_at, id"#,
    )
    .bind(series_id)
    .fetch_all(&mut **tx)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, series_id = %series_id, "recompute appointment series metadata: load rows");
        err(StatusCode::INTERNAL_SERVER_ERROR, "Failed")
    })?;

    if rows.is_empty() {
        return Ok(());
    }

    let recurrence_count = rows.len() as i32;
    let recurrence_until = rows
        .last()
        .and_then(|row| row.try_get::<chrono::NaiveDate, _>("date").ok())
        .ok_or_else(|| err(StatusCode::INTERNAL_SERVER_ERROR, "Failed"))?;

    for (index, row) in rows.iter().enumerate() {
        let appointment_id: Uuid = row
            .try_get("id")
            .map_err(|_| err(StatusCode::INTERNAL_SERVER_ERROR, "Failed"))?;

        sqlx::query(
            r#"UPDATE appointments
               SET recurrence_index = $2,
                   recurrence_count = $3,
                   recurrence_until = $4
               WHERE id = $1"#,
        )
        .bind(appointment_id)
        .bind(index as i32)
        .bind(recurrence_count)
        .bind(recurrence_until)
        .execute(&mut **tx)
        .await
        .map_err(|e| {
            tracing::error!(error = %e, appointment_id = %appointment_id, series_id = %series_id, "recompute appointment series metadata: update row");
            err(StatusCode::INTERNAL_SERVER_ERROR, "Failed")
        })?;
    }

    Ok(())
}

async fn defer_appointment_schedule_constraints(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
) -> Result<(), axum::response::Response> {
    let statement = format!(
        "SET CONSTRAINTS {} DEFERRED",
        APPOINTMENT_SCHEDULE_CONSTRAINTS.join(", ")
    );
    sqlx::query(&statement)
        .execute(&mut **tx)
        .await
        .map_err(|e| {
            tracing::error!(error = %e, "defer appointment schedule constraints");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to validate appointment schedule",
            )
        })?;
    Ok(())
}

async fn load_active_recurring_scope_preview(
    state: &AppState,
    series_id: Uuid,
) -> Result<Vec<serde_json::Value>, axum::response::Response> {
    match sqlx::query(
        r#"SELECT a.id,
                  a.date,
                  a.status,
                  a.recurrence_index,
                  COALESCE(checklists.open_count, 0) AS open_checklist_count
           FROM appointments a
           LEFT JOIN LATERAL (
             SELECT COUNT(*) FILTER (WHERE NOT c.is_completed) AS open_count
             FROM appointment_checklists c
             WHERE c.appointment_id = a.id
           ) checklists ON true
           WHERE a.recurrence_series_id = $1
             AND a.status NOT IN ('completed', 'cancelled')
           ORDER BY a.date, a.recurrence_index, a.created_at, a.id"#,
    )
    .bind(series_id)
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => Ok(rows
            .into_iter()
            .map(|row| {
                serde_json::json!({
                    "id": row.try_get::<Uuid, _>("id").unwrap_or_default(),
                    "date": row
                        .try_get::<chrono::NaiveDate, _>("date")
                        .map(|value| value.to_string())
                        .unwrap_or_default(),
                    "status": row.try_get::<String, _>("status").unwrap_or_default(),
                    "recurrence_index": row.try_get::<i32, _>("recurrence_index").unwrap_or(0),
                    "open_checklist_count": row.try_get::<i64, _>("open_checklist_count").unwrap_or_default() as i32,
                })
            })
            .collect()),
        Err(e) => {
            tracing::error!(error = %e, series_id = %series_id, "load recurring scope preview");
            Err(err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to load recurring scope preview",
            ))
        }
    }
}

async fn load_recurring_series_lineage_history(
    state: &AppState,
    series_id: Uuid,
) -> Result<Vec<serde_json::Value>, axum::response::Response> {
    match sqlx::query(
        r#"WITH RECURSIVE series_stats AS (
               SELECT recurrence_series_id AS series_id,
                      MIN(recurrence_parent_series_id::text)::uuid AS parent_series_id,
                      MIN(recurrence_split_from_appointment_id::text)::uuid AS split_from_appointment_id,
                      MIN(recurrence_split_from_index) AS split_from_index,
                      MIN(date) AS first_date,
                      MAX(date) AS last_date,
                      COUNT(*)::int AS total_occurrences,
                      COUNT(*) FILTER (WHERE status NOT IN ('completed', 'cancelled'))::int AS active_occurrences,
                      COUNT(*) FILTER (WHERE status = 'completed')::int AS completed_occurrences,
                      COUNT(*) FILTER (WHERE status = 'cancelled')::int AS cancelled_occurrences
               FROM appointments
               WHERE recurrence_series_id IS NOT NULL
               GROUP BY recurrence_series_id
           ),
           ancestors AS (
               SELECT series_id, parent_series_id, 0 AS depth, ARRAY[series_id] AS path
               FROM series_stats
               WHERE series_id = $1
               UNION ALL
               SELECT parent.series_id,
                      parent.parent_series_id,
                      ancestors.depth - 1,
                      ancestors.path || parent.series_id
               FROM ancestors
               JOIN series_stats parent ON parent.series_id = ancestors.parent_series_id
               WHERE NOT parent.series_id = ANY(ancestors.path)
                 AND ancestors.depth > -32
           ),
           descendants AS (
               SELECT series_id, parent_series_id, 0 AS depth, ARRAY[series_id] AS path
               FROM series_stats
               WHERE series_id = $1
               UNION ALL
               SELECT child.series_id,
                      child.parent_series_id,
                      descendants.depth + 1,
                      descendants.path || child.series_id
               FROM descendants
               JOIN series_stats child ON child.parent_series_id = descendants.series_id
               WHERE NOT child.series_id = ANY(descendants.path)
                 AND descendants.depth < 32
           ),
           related AS (
               SELECT series_id, MIN(depth) AS depth
               FROM (
                   SELECT series_id, depth FROM ancestors
                   UNION ALL
                   SELECT series_id, depth FROM descendants
               ) combined
               GROUP BY series_id
           )
           SELECT related.series_id,
                  stats.parent_series_id,
                  stats.split_from_appointment_id,
                  stats.split_from_index,
                  stats.first_date,
                  stats.last_date,
                  stats.total_occurrences,
                  stats.active_occurrences,
                  stats.completed_occurrences,
                  stats.cancelled_occurrences,
                  CASE
                      WHEN related.depth < 0 THEN 'ancestor'
                      WHEN related.depth = 0 THEN 'current'
                      ELSE 'descendant'
                  END AS relation,
                  ABS(related.depth)::int AS depth
           FROM related
           JOIN series_stats stats ON stats.series_id = related.series_id
           ORDER BY related.depth, stats.first_date, stats.series_id"#,
    )
    .bind(series_id)
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => Ok(rows
            .into_iter()
            .map(|row| {
                serde_json::json!({
                    "series_id": row.try_get::<Uuid, _>("series_id").unwrap_or_default(),
                    "parent_series_id": row.try_get::<Option<Uuid>, _>("parent_series_id").unwrap_or_default(),
                    "split_from_appointment_id": row.try_get::<Option<Uuid>, _>("split_from_appointment_id").unwrap_or_default(),
                    "split_from_index": row.try_get::<Option<i32>, _>("split_from_index").unwrap_or_default(),
                    "first_date": row.try_get::<chrono::NaiveDate, _>("first_date").map(|value| value.to_string()).unwrap_or_default(),
                    "last_date": row.try_get::<chrono::NaiveDate, _>("last_date").map(|value| value.to_string()).unwrap_or_default(),
                    "total_occurrences": row.try_get::<i32, _>("total_occurrences").unwrap_or_default(),
                    "active_occurrences": row.try_get::<i32, _>("active_occurrences").unwrap_or_default(),
                    "completed_occurrences": row.try_get::<i32, _>("completed_occurrences").unwrap_or_default(),
                    "cancelled_occurrences": row.try_get::<i32, _>("cancelled_occurrences").unwrap_or_default(),
                    "relation": row.try_get::<String, _>("relation").unwrap_or_else(|_| "current".to_string()),
                    "depth": row.try_get::<i32, _>("depth").unwrap_or_default(),
                })
            })
            .collect()),
        Err(e) => {
            tracing::error!(error = %e, series_id = %series_id, "load recurring lineage history");
            Err(err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to load recurring lineage history",
            ))
        }
    }
}

fn appointment_schedule_conflict_message_from_constraint(constraint: Option<&str>) -> &'static str {
    match constraint {
        Some(name) if name.contains("_interpreter_") => {
            "Appointment conflicts with an existing interpreter booking"
        }
        Some(name) if name.contains("_doctor_") => {
            "Appointment conflicts with an existing doctor booking"
        }
        Some(name) if name.contains("_patient_") => {
            "Appointment conflicts with an existing patient booking"
        }
        _ => "Appointment conflicts with an existing booking",
    }
}

fn appointment_schedule_conflict_from_db_error(
    error: &sqlx::Error,
) -> Option<axum::response::Response> {
    match error {
        sqlx::Error::Database(db_error) if db_error.code().as_deref() == Some("23P01") => {
            Some(err(
                StatusCode::CONFLICT,
                appointment_schedule_conflict_message_from_constraint(db_error.constraint()),
            ))
        }
        _ => None,
    }
}

#[allow(clippy::too_many_arguments)]
async fn insert_appointment_occurrence(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    appointment_id: Uuid,
    patient_id: Uuid,
    provider_id: Option<Uuid>,
    doctor_id: Option<Uuid>,
    owner_user_id: Option<Uuid>,
    interpreter_id: Option<Uuid>,
    order_id: Option<Uuid>,
    appointment_type: &str,
    title: &str,
    date: chrono::NaiveDate,
    time_start: Option<chrono::NaiveTime>,
    time_end: Option<chrono::NaiveTime>,
    location: Option<&str>,
    category: Option<&str>,
    notes: Option<&str>,
    recurrence_series_id: Option<Uuid>,
    recurrence_frequency: Option<&str>,
    recurrence_interval: Option<i32>,
    recurrence_count: Option<i32>,
    recurrence_until: Option<chrono::NaiveDate>,
    recurrence_index: i32,
    created_by: Uuid,
    interpreter_response: Option<&str>,
) -> Result<(), axum::response::Response> {
    sqlx::query(
        "INSERT INTO appointments (id, patient_id, provider_id, doctor_id, owner_user_id, interpreter_id, order_id, appointment_type, title, date, time_start, time_end, location, category, notes, recurrence_series_id, recurrence_frequency, recurrence_interval, recurrence_count, recurrence_until, recurrence_index, created_by, interpreter_response)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)",
    )
    .bind(appointment_id)
    .bind(patient_id)
    .bind(provider_id)
    .bind(doctor_id)
    .bind(owner_user_id)
    .bind(interpreter_id)
    .bind(order_id)
    .bind(appointment_type)
    .bind(title)
    .bind(date)
    .bind(time_start)
    .bind(time_end)
    .bind(location)
    .bind(category)
    .bind(notes)
    .bind(recurrence_series_id)
    .bind(recurrence_frequency)
    .bind(recurrence_interval)
    .bind(recurrence_count)
    .bind(recurrence_until)
    .bind(recurrence_index)
    .bind(created_by)
    .bind(interpreter_response)
    .execute(&mut **tx)
    .await
    .map(|_| ())
    .map_err(|e| {
        if let Some(resp) = appointment_schedule_conflict_from_db_error(&e) {
            return resp;
        }
        tracing::error!(error = %e, appointment_id = %appointment_id, "insert appointment occurrence");
        err(StatusCode::INTERNAL_SERVER_ERROR, "Failed")
    })
}

async fn split_appointment_series_from_occurrence(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    source_series_id: Uuid,
    new_series_id: Uuid,
    split_from_index: i32,
) -> Result<Option<Uuid>, axum::response::Response> {
    if split_from_index <= 0 || source_series_id == new_series_id {
        return Ok(None);
    }

    let rows_affected = sqlx::query(
        r#"UPDATE appointments
           SET recurrence_series_id = $2,
               recurrence_parent_series_id = $1,
               recurrence_split_from_appointment_id = $2,
               recurrence_split_from_index = $3
           WHERE recurrence_series_id = $1
             AND recurrence_index >= $3"#,
    )
    .bind(source_series_id)
    .bind(new_series_id)
    .bind(split_from_index)
    .execute(&mut **tx)
    .await
    .map_err(|e| {
        tracing::error!(
            error = %e,
            source_series_id = %source_series_id,
            new_series_id = %new_series_id,
            split_from_index,
            "split appointment series"
        );
        err(StatusCode::INTERNAL_SERVER_ERROR, "Failed")
    })?
    .rows_affected();

    if rows_affected == 0 {
        return Err(err(
            StatusCode::CONFLICT,
            "No appointments remain to split from this occurrence",
        ));
    }

    recompute_appointment_series_metadata(tx, source_series_id).await?;
    recompute_appointment_series_metadata(tx, new_series_id).await?;

    Ok(Some(new_series_id))
}

#[allow(clippy::result_large_err)]
fn parse_recurrence_from_fields(
    recurrence_frequency: Option<&str>,
    recurrence_interval: Option<i32>,
    recurrence_count: Option<i32>,
    recurrence_until: Option<&str>,
    start_date: chrono::NaiveDate,
) -> Result<Option<AppointmentRecurrence>, axum::response::Response> {
    let has_frequency = recurrence_frequency
        .map(|value| !value.trim().is_empty())
        .unwrap_or(false);
    let has_other_fields = recurrence_interval.is_some()
        || recurrence_count.is_some()
        || recurrence_until
            .map(|value| !value.trim().is_empty())
            .unwrap_or(false);

    if !has_frequency {
        if has_other_fields {
            return Err(err(
                StatusCode::UNPROCESSABLE_ENTITY,
                "recurrence_frequency is required when recurrence fields are provided",
            ));
        }
        return Ok(None);
    }

    let frequency = recurrence_frequency
        .unwrap_or_default()
        .trim()
        .to_lowercase();
    if !is_valid_recurrence_frequency(&frequency) {
        return Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "recurrence_frequency must be daily, weekly or monthly",
        ));
    }

    let interval = recurrence_interval.unwrap_or(1);
    if interval <= 0 {
        return Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "recurrence_interval must be greater than 0",
        ));
    }

    let count = match recurrence_count {
        Some(value) if value < 2 => {
            return Err(err(
                StatusCode::UNPROCESSABLE_ENTITY,
                "recurrence_count must be at least 2 when recurrence is enabled",
            ));
        }
        Some(value) if value > 90 => {
            return Err(err(
                StatusCode::UNPROCESSABLE_ENTITY,
                "recurrence_count cannot exceed 90 appointments",
            ));
        }
        value => value,
    };

    let until = match recurrence_until {
        Some(raw) if !raw.trim().is_empty() => {
            match chrono::NaiveDate::parse_from_str(raw, "%Y-%m-%d") {
                Ok(value) => {
                    if value <= start_date {
                        return Err(err(
                            StatusCode::UNPROCESSABLE_ENTITY,
                            "recurrence_until must be later than the first appointment date",
                        ));
                    }
                    if value > start_date + chrono::Days::new(365) {
                        return Err(err(
                            StatusCode::UNPROCESSABLE_ENTITY,
                            "recurrence_until cannot be more than 365 days after the first appointment",
                        ));
                    }
                    Some(value)
                }
                Err(_) => {
                    return Err(err(
                        StatusCode::UNPROCESSABLE_ENTITY,
                        "Invalid recurrence_until (YYYY-MM-DD)",
                    ));
                }
            }
        }
        _ => None,
    };

    if count.is_none() && until.is_none() {
        return Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "recurrence_count or recurrence_until is required when recurrence is enabled",
        ));
    }

    Ok(Some(AppointmentRecurrence {
        frequency,
        interval,
        count,
        until,
    }))
}

#[allow(clippy::result_large_err)]
fn parse_appointment_recurrence(
    body: &CreateAppointment,
    start_date: chrono::NaiveDate,
) -> Result<Option<AppointmentRecurrence>, axum::response::Response> {
    parse_recurrence_from_fields(
        body.recurrence_frequency.as_deref(),
        body.recurrence_interval,
        body.recurrence_count,
        body.recurrence_until.as_deref(),
        start_date,
    )
}

fn advance_recurrence_date(
    value: chrono::NaiveDate,
    frequency: &str,
    interval: i32,
) -> Option<chrono::NaiveDate> {
    match frequency {
        "daily" => value.checked_add_days(chrono::Days::new(interval as u64)),
        "weekly" => value.checked_add_days(chrono::Days::new((interval as u64) * 7)),
        "monthly" => value.checked_add_months(chrono::Months::new(interval as u32)),
        _ => None,
    }
}

fn build_monthly_recurrence_date(
    start_date: chrono::NaiveDate,
    occurrence_index: i32,
    interval: i32,
) -> Option<chrono::NaiveDate> {
    let total_month_offset = occurrence_index.checked_mul(interval)?;
    let absolute_month = start_date.month0() as i32 + total_month_offset;
    let year = start_date.year() + absolute_month.div_euclid(12);
    let month0 = absolute_month.rem_euclid(12) as u32;
    let month = month0 + 1;
    let month_start = chrono::NaiveDate::from_ymd_opt(year, month, 1)?;
    let next_month_start = if month == 12 {
        chrono::NaiveDate::from_ymd_opt(year + 1, 1, 1)?
    } else {
        chrono::NaiveDate::from_ymd_opt(year, month + 1, 1)?
    };
    let last_day = (next_month_start - chrono::Days::new(1)).day();
    chrono::NaiveDate::from_ymd_opt(year, month, start_date.day().min(last_day))
        .or(Some(month_start))
}

#[allow(clippy::result_large_err)]
fn build_recurrence_dates(
    start_date: chrono::NaiveDate,
    recurrence: Option<&AppointmentRecurrence>,
) -> Result<Vec<chrono::NaiveDate>, axum::response::Response> {
    const MAX_RECURRING_APPOINTMENTS: usize = 90;

    let Some(recurrence) = recurrence else {
        return Ok(vec![start_date]);
    };

    let mut dates = vec![start_date];
    let mut current = start_date;

    loop {
        if let Some(count) = recurrence.count
            && dates.len() >= count as usize
        {
            break;
        }

        let occurrence_index = dates.len() as i32;
        let Some(next_date) = (if recurrence.frequency == "monthly" {
            build_monthly_recurrence_date(start_date, occurrence_index, recurrence.interval)
        } else {
            advance_recurrence_date(current, &recurrence.frequency, recurrence.interval)
        }) else {
            return Err(err(
                StatusCode::UNPROCESSABLE_ENTITY,
                "Failed to calculate recurring appointment dates",
            ));
        };

        if let Some(until) = recurrence.until
            && next_date > until
        {
            break;
        }

        dates.push(next_date);
        current = next_date;

        if dates.len() > MAX_RECURRING_APPOINTMENTS {
            return Err(err(
                StatusCode::UNPROCESSABLE_ENTITY,
                "Recurring appointment series cannot exceed 90 appointments",
            ));
        }
    }

    if dates.len() < 2 {
        return Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Recurring appointment settings did not create any additional occurrences",
        ));
    }

    Ok(dates)
}

fn merge_conflict_items(
    target: &mut Vec<serde_json::Value>,
    seen_ids: &mut HashSet<String>,
    payload: &serde_json::Value,
) {
    let Some(items) = payload.as_array() else {
        return;
    };

    for item in items {
        let dedupe_key = item
            .get("id")
            .and_then(serde_json::Value::as_str)
            .map(ToOwned::to_owned)
            .unwrap_or_else(|| item.to_string());
        if seen_ids.insert(dedupe_key) {
            target.push(item.clone());
        }
    }
}

fn merge_conflicts_payload(payloads: &[serde_json::Value]) -> serde_json::Value {
    let mut patient_conflicts = Vec::new();
    let mut interpreter_conflicts = Vec::new();
    let mut patient_seen = HashSet::new();
    let mut interpreter_seen = HashSet::new();

    for payload in payloads {
        merge_conflict_items(
            &mut patient_conflicts,
            &mut patient_seen,
            &payload["patient_conflicts"],
        );
        merge_conflict_items(
            &mut interpreter_conflicts,
            &mut interpreter_seen,
            &payload["interpreter_conflicts"],
        );
    }

    let patient_conflict_count = patient_conflicts.len();
    let interpreter_conflict_count = interpreter_conflicts.len();

    serde_json::json!({
        "patient_conflict_count": patient_conflict_count,
        "interpreter_conflict_count": interpreter_conflict_count,
        "has_conflicts": patient_conflict_count > 0 || interpreter_conflict_count > 0,
        "patient_conflicts": patient_conflicts,
        "interpreter_conflicts": interpreter_conflicts,
    })
}

fn is_valid_communication_target(value: &str) -> bool {
    matches!(value, "clinic" | "doctor" | "service_provider")
}

fn is_valid_communication_direction(value: &str) -> bool {
    matches!(value, "outbound" | "inbound")
}

fn is_valid_communication_channel(value: &str) -> bool {
    matches!(
        value,
        "phone" | "email" | "portal" | "fax" | "whatsapp" | "other"
    )
}

fn is_valid_communication_status(value: &str) -> bool {
    matches!(
        value,
        "planned" | "sent" | "answered" | "closed" | "cancelled"
    )
}

fn parse_query_date(
    value: Option<String>,
    field: &'static str,
) -> Result<Option<chrono::NaiveDate>, &'static str> {
    match value {
        Some(raw) if !raw.trim().is_empty() => chrono::NaiveDate::parse_from_str(&raw, "%Y-%m-%d")
            .map(Some)
            .map_err(|_| match field {
                "date_from" => "Invalid date_from (YYYY-MM-DD)",
                "date_to" => "Invalid date_to (YYYY-MM-DD)",
                _ => "Invalid date (YYYY-MM-DD)",
            }),
        _ => Ok(None),
    }
}

fn parse_optional_rfc3339(
    value: Option<&str>,
    field: &'static str,
) -> Result<Option<chrono::DateTime<chrono::Utc>>, &'static str> {
    match value {
        Some(raw) if !raw.trim().is_empty() => chrono::DateTime::parse_from_rfc3339(raw)
            .map(|value| Some(value.with_timezone(&chrono::Utc)))
            .map_err(|_| match field {
                "due_at" => "Invalid due_at (RFC3339)",
                _ => "Invalid datetime (RFC3339)",
            }),
        _ => Ok(None),
    }
}

async fn get_appointment(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(apt_id): Path<Uuid>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[
        Role::Ceo,
        Role::PatientManager,
        Role::TeamleadInterpreter,
        Role::Interpreter,
        Role::Concierge,
    ]) {
        return e;
    }

    match sqlx::query(
        r#"SELECT a.id, a.patient_id, a.provider_id, a.doctor_id, a.order_id, o.order_number, a.interpreter_id,
                  a.owner_user_id,
                  a.appointment_type, a.care_path_kind, a.title, a.date, a.time_start, a.time_end, a.location,
                  a.category, a.status, a.interpreter_response, a.checklist_phase,
                  a.preparation_notes, a.followup_notes, a.notes, a.created_at,
                  a.recurrence_series_id, a.recurrence_frequency, a.recurrence_interval,
                  a.recurrence_count, a.recurrence_until, a.recurrence_index,
                  a.recurrence_parent_series_id, a.recurrence_split_from_appointment_id,
                  a.recurrence_split_from_index,
                  CASE
                      WHEN a.recurrence_series_id IS NULL THEN 1
                      ELSE (
                          SELECT COUNT(*)
                          FROM appointments series
                          WHERE series.recurrence_series_id = a.recurrence_series_id
                      )
                  END AS recurrence_series_size,
                  p.first_name, p.last_name, p.patient_id AS patient_code,
                  pr.name AS provider_name,
                  d.name AS doctor_name,
                  u.name AS interpreter_name,
                  owner.name AS owner_name,
                  owner.role AS owner_role
           FROM appointments a
           JOIN patients p ON p.id = a.patient_id
           LEFT JOIN providers pr ON pr.id = a.provider_id
           LEFT JOIN provider_doctors d ON d.id = a.doctor_id
           LEFT JOIN orders o ON o.id = a.order_id
           LEFT JOIN users u ON u.id = a.interpreter_id
           LEFT JOIN users owner ON owner.id = a.owner_user_id
           WHERE a.id = $1"#,
    )
    .bind(apt_id)
    .fetch_optional(&state.db)
    .await
    {
        Ok(Some(a)) => {
            let appointment_id: Uuid = match a.try_get("id") {
                Ok(value) => value,
                Err(_) => return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed"),
            };
            let patient_id: Uuid = match a.try_get("patient_id") {
                Ok(value) => value,
                Err(_) => return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed"),
            };
            let interpreter_id: Option<Uuid> = match a.try_get("interpreter_id") {
                Ok(value) => value,
                Err(_) => return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed"),
            };
            let owner_user_id: Option<Uuid> = match a.try_get("owner_user_id") {
                Ok(value) => value,
                Err(_) => return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed"),
            };

            match can_access_appointment(
                &state,
                &auth,
                appointment_id,
                Some(patient_id),
                interpreter_id,
                owner_user_id,
            )
            .await
            {
                Ok(true) => {}
                Ok(false) => return err(StatusCode::FORBIDDEN, "Insufficient permissions"),
                Err(resp) => return resp,
            }

            let recurrence_series_id: Option<Uuid> = match a.try_get("recurrence_series_id") {
                Ok(value) => value,
                Err(_) => return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed"),
            };
            let recurring_scope_preview = match recurrence_series_id {
                Some(series_id) => {
                    match load_active_recurring_scope_preview(&state, series_id).await {
                        Ok(value) => value,
                        Err(resp) => return resp,
                    }
                }
                None => Vec::new(),
            };
            let recurring_lineage_history = match recurrence_series_id {
                Some(series_id) => {
                    match load_recurring_series_lineage_history(&state, series_id).await {
                        Ok(value) => value,
                        Err(resp) => return resp,
                    }
                }
                None => Vec::new(),
            };

            Json(build_appointment_detail_json(
                &auth,
                &a,
                appointment_id,
                patient_id,
                interpreter_id,
                recurring_scope_preview,
                recurring_lineage_history,
            ))
            .into_response()
        }
        Ok(None) => err(StatusCode::NOT_FOUND, "Appointment not found"),
        Err(e) => {
            tracing::error!(error = %e, "get appointment");
            err(StatusCode::INTERNAL_SERVER_ERROR, "Failed")
        }
    }
}

async fn update_appointment(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(apt_id): Path<Uuid>,
    Json(body): Json<UpdateAppointment>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[
        Role::Ceo,
        Role::PatientManager,
        Role::TeamleadInterpreter,
        Role::Concierge,
    ]) {
        return e;
    }

    let current = match sqlx::query(
        r#"SELECT patient_id, appointment_type, care_path_kind, status, checklist_phase, provider_id, doctor_id, owner_user_id,
                  interpreter_id, interpreter_response, title, date, time_start, time_end,
                  location, order_id, category, notes, recurrence_series_id, recurrence_index,
                  recurrence_frequency, recurrence_interval, recurrence_count, recurrence_until
           FROM appointments
           WHERE id = $1"#,
    )
    .bind(apt_id)
    .fetch_optional(&state.db)
    .await
    {
        Ok(Some(row)) => row,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Appointment not found"),
        Err(e) => {
            tracing::error!(error = %e, appointment_id = %apt_id, "load appointment for update");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };

    let patient_id: Uuid = match current.try_get("patient_id") {
        Ok(value) => value,
        Err(_) => return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed"),
    };
    let current_type: String = current
        .try_get("appointment_type")
        .unwrap_or_else(|_| String::new());
    let current_care_path_kind: String = current
        .try_get("care_path_kind")
        .unwrap_or_else(|_| "regular".to_string());
    let current_status: String = current.try_get("status").unwrap_or_else(|_| String::new());
    let current_checklist_phase: String = current
        .try_get("checklist_phase")
        .unwrap_or_else(|_| "preparation".to_string());
    let current_provider_id: Option<Uuid> = current.try_get("provider_id").unwrap_or_default();
    let current_doctor_id: Option<Uuid> = current.try_get("doctor_id").unwrap_or_default();
    let current_owner_user_id: Option<Uuid> = current.try_get("owner_user_id").unwrap_or_default();
    let current_interpreter_id: Option<Uuid> =
        current.try_get("interpreter_id").unwrap_or_default();
    let current_interpreter_response: Option<String> =
        current.try_get("interpreter_response").unwrap_or_default();
    let current_title: String = current.try_get("title").unwrap_or_else(|_| String::new());
    let current_date: chrono::NaiveDate = match current.try_get("date") {
        Ok(value) => value,
        Err(_) => return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed"),
    };
    let current_time_start: Option<chrono::NaiveTime> =
        current.try_get("time_start").unwrap_or_default();
    let current_time_end: Option<chrono::NaiveTime> =
        current.try_get("time_end").unwrap_or_default();
    let current_location: Option<String> = current.try_get("location").unwrap_or_default();
    let current_order_id: Option<Uuid> = current.try_get("order_id").unwrap_or_default();
    let current_category: Option<String> = current.try_get("category").unwrap_or_default();
    let current_notes: Option<String> = current.try_get("notes").unwrap_or_default();
    let current_recurrence_series_id: Option<Uuid> =
        current.try_get("recurrence_series_id").unwrap_or_default();
    let current_recurrence_index: i32 = current.try_get("recurrence_index").unwrap_or(0);
    let current_recurrence_frequency: Option<String> =
        current.try_get("recurrence_frequency").unwrap_or_default();
    let current_recurrence_interval: Option<i32> =
        current.try_get("recurrence_interval").unwrap_or_default();
    let current_recurrence_count: Option<i32> =
        current.try_get("recurrence_count").unwrap_or_default();
    let current_recurrence_until: Option<chrono::NaiveDate> =
        current.try_get("recurrence_until").unwrap_or_default();
    let recurrence_fields_supplied = body.recurrence_frequency.is_some()
        || body.recurrence_interval.is_some()
        || body.recurrence_count.is_some()
        || body.recurrence_until.is_some();
    let recurrence_scope = match parse_appointment_recurrence_scope(
        body.recurrence_scope.as_deref(),
        current_recurrence_series_id,
    ) {
        Ok(value) => value,
        Err(message) => return err(StatusCode::UNPROCESSABLE_ENTITY, message),
    };
    if recurrence_fields_supplied && current_recurrence_series_id.is_none() {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "recurrence fields can only be updated for recurring appointments",
        );
    }
    if recurrence_fields_supplied && recurrence_scope == AppointmentRecurrenceScope::Single {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "recurrence rule updates require following or series scope",
        );
    }

    match can_access_appointment(
        &state,
        &auth,
        apt_id,
        Some(patient_id),
        current_interpreter_id,
        current_owner_user_id,
    )
    .await
    {
        Ok(true) => {}
        Ok(false) => return err(StatusCode::FORBIDDEN, "Insufficient permissions"),
        Err(resp) => return resp,
    }

    let appointment_type = match body.appointment_type.clone() {
        Some(value) => value.trim().to_lowercase().replace('-', "_"),
        None => current_type.clone(),
    };
    if !is_valid_appointment_type(&appointment_type) {
        return err(StatusCode::UNPROCESSABLE_ENTITY, "Invalid appointment_type");
    }
    if appointment_type != current_type && !matches!(auth.role, Role::Ceo | Role::PatientManager) {
        return err(
            StatusCode::FORBIDDEN,
            "Only CEO or patient manager can change appointment type",
        );
    }

    let checklist_phase = match body.checklist_phase.clone() {
        Some(value) => value.trim().to_lowercase().replace('-', "_"),
        None => current_checklist_phase.clone(),
    };
    if !is_valid_checklist_phase(&checklist_phase) {
        return err(StatusCode::UNPROCESSABLE_ENTITY, "Invalid checklist_phase");
    }
    if checklist_phase != current_checklist_phase
        && !matches!(
            auth.role,
            Role::Ceo | Role::PatientManager | Role::Concierge
        )
    {
        return err(
            StatusCode::FORBIDDEN,
            "Only CEO, patient manager or concierge can change checklist phase",
        );
    }

    if auth.role == Role::Concierge
        && !matches!(appointment_type.as_str(), "non_medical" | "internal")
    {
        return err(
            StatusCode::FORBIDDEN,
            "Concierge can only reschedule non-medical or internal appointments",
        );
    }
    let care_path_kind = match body.care_path_kind.clone() {
        Some(value) => normalize_care_path_kind_input(Some(value)),
        None => current_care_path_kind.clone(),
    };
    if let Err(message) =
        validate_care_path_kind_for_appointment_type(&appointment_type, &care_path_kind)
    {
        return err(StatusCode::UNPROCESSABLE_ENTITY, message);
    }
    if matches!(current_status.as_str(), "completed" | "cancelled") {
        return err(
            StatusCode::CONFLICT,
            "Completed or cancelled appointments cannot be rescheduled",
        );
    }

    let title = body.title.trim().to_string();
    if title.is_empty() {
        return err(StatusCode::UNPROCESSABLE_ENTITY, "title is required");
    }

    if let Err(resp) =
        validate_provider_doctor_context(&state, body.provider_id, body.doctor_id).await
    {
        return resp;
    }

    if auth.role == Role::Concierge && body.interpreter_id.is_some() {
        return err(
            StatusCode::FORBIDDEN,
            "Concierge cannot assign interpreters during rescheduling",
        );
    }
    if let Some(interpreter_id) = body.interpreter_id {
        match load_active_interpreter_role(&state, interpreter_id).await {
            Ok(Some(_)) => {}
            Ok(None) => {
                return err(
                    StatusCode::UNPROCESSABLE_ENTITY,
                    "interpreter_id must reference an active interpreter or teamlead interpreter",
                );
            }
            Err(resp) => return resp,
        }
    }

    let owner_user_id = resolve_owner_user_id_for_write(&auth, body.owner_user_id);
    if let Some(owner_user_id) = owner_user_id {
        match load_active_appointment_owner_role(&state, owner_user_id).await {
            Ok(Some(owner_role)) => {
                if let Err(resp) =
                    validate_owner_assignment_rules(&auth, owner_user_id, &owner_role)
                {
                    return resp;
                }
            }
            Ok(None) => {
                return err(
                    StatusCode::UNPROCESSABLE_ENTITY,
                    "owner_user_id must reference an active PM/teamlead/interpreter/concierge",
                );
            }
            Err(resp) => return resp,
        }
    }

    let date = match chrono::NaiveDate::parse_from_str(&body.date, "%Y-%m-%d") {
        Ok(d) => d,
        Err(_) => {
            return err(
                StatusCode::UNPROCESSABLE_ENTITY,
                "Invalid date (YYYY-MM-DD)",
            );
        }
    };

    let time_start = match parse_optional_time(body.time_start.as_deref()) {
        Ok(value) => value,
        Err(message) => return err(StatusCode::UNPROCESSABLE_ENTITY, message),
    };
    let time_end = match parse_optional_time(body.time_end.as_deref()) {
        Ok(value) => value,
        Err(message) => return err(StatusCode::UNPROCESSABLE_ENTITY, message),
    };
    if let (Some(time_start), Some(time_end)) = (time_start, time_end)
        && time_end <= time_start
    {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "time_end must be later than time_start",
        );
    }

    let mut tx = match state.db.begin().await {
        Ok(value) => value,
        Err(e) => {
            tracing::error!(error = %e, appointment_id = %apt_id, "update appointment: begin tx");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };
    if recurrence_scope != AppointmentRecurrenceScope::Single
        && let Err(resp) = defer_appointment_schedule_constraints(&mut tx).await
    {
        return resp;
    }
    let location = normalize_optional_text(body.location);
    let shift_days = date.signed_duration_since(current_date).num_days();
    let mut effective_series_id = current_recurrence_series_id;
    let split_performed = if recurrence_scope == AppointmentRecurrenceScope::Following {
        match current_recurrence_series_id {
            Some(series_id) => match split_appointment_series_from_occurrence(
                &mut tx,
                series_id,
                apt_id,
                current_recurrence_index,
            )
            .await
            {
                Ok(Some(new_series_id)) => {
                    effective_series_id = Some(new_series_id);
                    true
                }
                Ok(None) => false,
                Err(resp) => return resp,
            },
            None => false,
        }
    } else {
        false
    };
    let targets = if recurrence_scope != AppointmentRecurrenceScope::Single {
        let series_id = match effective_series_id {
            Some(value) => value,
            None => {
                return err(
                    StatusCode::UNPROCESSABLE_ENTITY,
                    "Series scope is only available for recurring appointments",
                );
            }
        };
        let rows = match sqlx::query(
            r#"SELECT id, patient_id, recurrence_index, provider_id, doctor_id,
                      interpreter_id, interpreter_response, title, date, time_start, time_end,
                      location
               FROM appointments
               WHERE recurrence_series_id = $1
                 AND status NOT IN ('completed', 'cancelled')
               ORDER BY date, recurrence_index, created_at"#,
        )
        .bind(series_id)
        .fetch_all(&mut *tx)
        .await
        {
            Ok(value) => value,
            Err(e) => {
                tracing::error!(error = %e, series_id = %series_id, "load appointment series for update");
                return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
            }
        };
        if rows.is_empty() {
            return err(
                StatusCode::CONFLICT,
                "No active appointments remain in this series",
            );
        }
        let mut parsed = Vec::with_capacity(rows.len());
        for row in rows {
            let id: Uuid = match row.try_get("id") {
                Ok(value) => value,
                Err(_) => return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed"),
            };
            let target_patient_id: Uuid = match row.try_get("patient_id") {
                Ok(value) => value,
                Err(_) => return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed"),
            };
            let row_date: chrono::NaiveDate = match row.try_get("date") {
                Ok(value) => value,
                Err(_) => return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed"),
            };
            parsed.push(AppointmentUpdateTarget {
                id,
                patient_id: target_patient_id,
                provider_id: row.try_get("provider_id").unwrap_or_default(),
                doctor_id: row.try_get("doctor_id").unwrap_or_default(),
                interpreter_id: row.try_get("interpreter_id").unwrap_or_default(),
                interpreter_response: row.try_get("interpreter_response").unwrap_or_default(),
                date: row_date,
                time_start: row.try_get("time_start").unwrap_or_default(),
                time_end: row.try_get("time_end").unwrap_or_default(),
                location: row.try_get("location").unwrap_or_default(),
            });
        }
        parsed
    } else {
        vec![AppointmentUpdateTarget {
            id: apt_id,
            patient_id,
            provider_id: current_provider_id,
            doctor_id: current_doctor_id,
            interpreter_id: current_interpreter_id,
            interpreter_response: current_interpreter_response.clone(),
            date: current_date,
            time_start: current_time_start,
            time_end: current_time_end,
            location: current_location.clone(),
        }]
    };
    let recurrence_anchor_date = if recurrence_scope == AppointmentRecurrenceScope::Series {
        match targets.first().and_then(|target| {
            target
                .date
                .checked_add_signed(chrono::Duration::days(shift_days))
        }) {
            Some(value) => value,
            None => {
                return err(
                    StatusCode::UNPROCESSABLE_ENTITY,
                    "Failed to calculate recurring appointment dates",
                );
            }
        }
    } else {
        date
    };
    let resolved_recurrence_until = if let Some(value) = body.recurrence_until.as_ref() {
        value.clone()
    } else {
        current_recurrence_until.map(|value| value.to_string())
    };
    let recurrence_rule =
        if recurrence_scope != AppointmentRecurrenceScope::Single && recurrence_fields_supplied {
            match parse_recurrence_from_fields(
                body.recurrence_frequency
                    .as_deref()
                    .or(current_recurrence_frequency.as_deref()),
                body.recurrence_interval.or(current_recurrence_interval),
                if body.recurrence_count.is_some() {
                    body.recurrence_count
                } else {
                    current_recurrence_count
                },
                resolved_recurrence_until.as_deref(),
                recurrence_anchor_date,
            ) {
                Ok(Some(value)) => Some(value),
                Ok(None) => {
                    return err(
                        StatusCode::UNPROCESSABLE_ENTITY,
                        "recurrence rule updates require recurring settings",
                    );
                }
                Err(resp) => return resp,
            }
        } else {
            None
        };
    let recurrence_dates = if let Some(ref recurrence) = recurrence_rule {
        match build_recurrence_dates(recurrence_anchor_date, Some(recurrence)) {
            Ok(value) => value,
            Err(resp) => return resp,
        }
    } else {
        Vec::new()
    };
    let resolved_recurrence_frequency = recurrence_rule
        .as_ref()
        .map(|value| value.frequency.as_str())
        .or(current_recurrence_frequency.as_deref());
    let resolved_recurrence_interval = recurrence_rule
        .as_ref()
        .map(|value| value.interval)
        .or(current_recurrence_interval);
    let resolved_recurrence_count = recurrence_rule
        .as_ref()
        .and_then(|value| value.count)
        .or(current_recurrence_count);
    let resolved_recurrence_until_date = recurrence_rule
        .as_ref()
        .and_then(|value| value.until)
        .or(current_recurrence_until);

    let keep_count = if recurrence_dates.is_empty() {
        targets.len()
    } else {
        recurrence_dates.len().min(targets.len())
    };
    let mut reminder_targets = Vec::new();
    let mut updated_targets = Vec::new();
    let mut created_targets = Vec::new();
    let mut archived_series_id = None;
    let target_ids: Vec<Uuid> = targets.iter().map(|target| target.id).collect();
    for (index, target) in targets.iter().take(keep_count).enumerate() {
        let target_date = if let Some(value) = recurrence_dates.get(index).copied() {
            value
        } else if recurrence_scope != AppointmentRecurrenceScope::Single {
            match target
                .date
                .checked_add_signed(chrono::Duration::days(shift_days))
            {
                Some(value) => value,
                None => {
                    return err(
                        StatusCode::UNPROCESSABLE_ENTITY,
                        "Failed to calculate recurring appointment dates",
                    );
                }
            }
        } else {
            date
        };
        let schedule_changed = target.provider_id != body.provider_id
            || target.doctor_id != body.doctor_id
            || target.date != target_date
            || target.time_start != time_start
            || target.time_end != time_end
            || target.location != location
            || recurrence_rule.is_some();
        let interpreter_changed = target.interpreter_id != body.interpreter_id;
        let interpreter_response = match body.interpreter_id {
            Some(_) if interpreter_changed || schedule_changed => Some("pending"),
            Some(_) => target.interpreter_response.as_deref(),
            None => None,
        };

        if let Err(resp) = acquire_appointment_schedule_locks(
            &mut tx,
            target.patient_id,
            body.interpreter_id,
            body.doctor_id,
            target_date,
        )
        .await
        {
            return resp;
        }
        if let Err(resp) = ensure_no_overlapping_appointments_in_tx(
            &mut tx,
            target.patient_id,
            body.interpreter_id,
            body.doctor_id,
            target_date,
            time_start,
            time_end,
            &target_ids,
        )
        .await
        {
            return resp;
        }

        match sqlx::query(
            r#"UPDATE appointments
               SET provider_id = $2,
                   doctor_id = $3,
                   owner_user_id = $4,
                   interpreter_id = $5,
                   title = $6,
                   date = $7,
                   time_start = $8,
                   time_end = $9,
                   location = $10,
                   interpreter_response = $11,
                   care_path_kind = $12,
                   recurrence_frequency = $13,
                   recurrence_interval = $14,
                   recurrence_count = $15,
                   recurrence_until = $16,
                   appointment_type = $17,
                   checklist_phase = $18
               WHERE id = $1"#,
        )
        .bind(target.id)
        .bind(body.provider_id)
        .bind(body.doctor_id)
        .bind(owner_user_id)
        .bind(body.interpreter_id)
        .bind(&title)
        .bind(target_date)
        .bind(time_start)
        .bind(time_end)
        .bind(&location)
        .bind(interpreter_response)
        .bind(&care_path_kind)
        .bind(resolved_recurrence_frequency)
        .bind(resolved_recurrence_interval)
        .bind(resolved_recurrence_count)
        .bind(resolved_recurrence_until_date)
        .bind(&appointment_type)
        .bind(&checklist_phase)
        .execute(&mut *tx)
        .await
        {
            Ok(result) if result.rows_affected() > 0 => {}
            Ok(_) => return err(StatusCode::NOT_FOUND, "Appointment not found"),
            Err(e) => {
                if let Some(resp) = appointment_schedule_conflict_from_db_error(&e) {
                    return resp;
                }
                tracing::error!(error = %e, appointment_id = %target.id, "update appointment");
                return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
            }
        }

        if let Some(interpreter_id) = body.interpreter_id
            && (interpreter_changed || schedule_changed)
        {
            reminder_targets.push((target.id, target.patient_id, interpreter_id, target_date));
        }
        updated_targets.push((target.id, target.patient_id, target_date));
    }
    if !recurrence_dates.is_empty() && recurrence_dates.len() > targets.len() {
        let recurrence_series_id = match effective_series_id {
            Some(value) => value,
            None => {
                return err(
                    StatusCode::UNPROCESSABLE_ENTITY,
                    "Series scope is only available for recurring appointments",
                );
            }
        };
        for target_date in recurrence_dates.iter().skip(targets.len()).copied() {
            if let Err(resp) = acquire_appointment_schedule_locks(
                &mut tx,
                patient_id,
                body.interpreter_id,
                body.doctor_id,
                target_date,
            )
            .await
            {
                return resp;
            }
            if let Err(resp) = ensure_no_overlapping_appointments_in_tx(
                &mut tx,
                patient_id,
                body.interpreter_id,
                body.doctor_id,
                target_date,
                time_start,
                time_end,
                &[],
            )
            .await
            {
                return resp;
            }

            let appointment_id = Uuid::new_v4();
            if let Err(resp) = insert_appointment_occurrence(
                &mut tx,
                appointment_id,
                patient_id,
                body.provider_id,
                body.doctor_id,
                owner_user_id,
                body.interpreter_id,
                current_order_id,
                &appointment_type,
                &title,
                target_date,
                time_start,
                time_end,
                location.as_deref(),
                current_category.as_deref(),
                current_notes.as_deref(),
                Some(recurrence_series_id),
                resolved_recurrence_frequency,
                resolved_recurrence_interval,
                resolved_recurrence_count,
                resolved_recurrence_until_date,
                0,
                auth.user_id,
                body.interpreter_id.map(|_| "pending"),
            )
            .await
            {
                return resp;
            }
            if let Some(interpreter_id) = body.interpreter_id {
                reminder_targets.push((appointment_id, patient_id, interpreter_id, target_date));
            }
            updated_targets.push((appointment_id, patient_id, target_date));
            created_targets.push((appointment_id, patient_id, target_date));
        }
    }
    if !recurrence_dates.is_empty() && recurrence_dates.len() < targets.len() {
        let trimmed_targets = &targets[recurrence_dates.len()..];
        if let Some(root) = trimmed_targets.first() {
            let archive_root_id = root.id;
            archived_series_id = Some(archive_root_id);
            for target in trimmed_targets {
                match sqlx::query(
                    r#"UPDATE appointments
                       SET status = 'cancelled',
                           recurrence_series_id = $2,
                           recurrence_parent_series_id = $3,
                           recurrence_split_from_appointment_id = $4,
                           recurrence_split_from_index = $5,
                           recurrence_frequency = $6,
                           recurrence_interval = $7,
                           recurrence_count = $8,
                           recurrence_until = $9
                       WHERE id = $1"#,
                )
                .bind(target.id)
                .bind(archive_root_id)
                .bind(effective_series_id)
                .bind(archive_root_id)
                .bind(recurrence_dates.len() as i32)
                .bind(resolved_recurrence_frequency)
                .bind(resolved_recurrence_interval)
                .bind(resolved_recurrence_count)
                .bind(resolved_recurrence_until_date)
                .execute(&mut *tx)
                .await
                {
                    Ok(result) if result.rows_affected() > 0 => {}
                    Ok(_) => return err(StatusCode::NOT_FOUND, "Appointment not found"),
                    Err(e) => {
                        tracing::error!(error = %e, appointment_id = %target.id, "archive trimmed recurring appointment tail");
                        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
                    }
                }
            }
        }
    }
    let mut impacted_series_ids = Vec::new();
    if let Some(series_id) = effective_series_id {
        impacted_series_ids.push(series_id);
    }
    if let Some(series_id) = archived_series_id
        && !impacted_series_ids.contains(&series_id)
    {
        impacted_series_ids.push(series_id);
    }
    if split_performed
        && let Some(series_id) = current_recurrence_series_id
        && !impacted_series_ids.contains(&series_id)
    {
        impacted_series_ids.push(series_id);
    }
    for series_id in impacted_series_ids {
        if let Err(resp) = recompute_appointment_series_metadata(&mut tx, series_id).await {
            return resp;
        }
    }
    if let Err(e) = tx.commit().await {
        tracing::error!(error = %e, appointment_id = %apt_id, "update appointment: commit");
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
    }

    for (target_id, target_patient_id, interpreter_id, target_date) in reminder_targets {
        let _ = sqlx::query!(
            "INSERT INTO patient_assignments (patient_id, user_id, assigned_by)
             VALUES ($1, $2, $3)
             ON CONFLICT (patient_id, user_id) DO UPDATE SET revoked_at = NULL, assigned_by = $3, assigned_at = now()",
            target_patient_id,
            interpreter_id,
            auth.user_id
        )
        .execute(&state.db)
        .await;

        let reminder_title = format!("Appointment updated: {title}");
        let reminder_description = Some(build_schedule_summary(target_date, time_start, time_end));
        let _ = create_reminder_record(
            &state,
            target_id,
            interpreter_id,
            chrono::Utc::now(),
            reminder_title,
            reminder_description,
        )
        .await;
    }
    if appointment_type == "non_medical" {
        for (appointment_id, target_patient_id, target_date) in &created_targets {
            if let Err(resp) = bootstrap_concierge_workflow(
                &state,
                auth.user_id,
                *appointment_id,
                *target_patient_id,
                &title,
                *target_date,
                time_start,
            )
            .await
            {
                return resp;
            }
            if let Err(resp) = crate::routes::concierge_services::bootstrap_default_service(
                &state,
                auth.user_id,
                *appointment_id,
            )
            .await
            {
                return resp;
            }
        }
    }
    let mut conflict_payloads = Vec::with_capacity(updated_targets.len());
    for (target_id, target_patient_id, target_date) in &updated_targets {
        let conflicts = match build_conflicts_payload(
            &state,
            &auth,
            *target_patient_id,
            body.interpreter_id,
            *target_date,
            time_start,
            time_end,
            Some(*target_id),
        )
        .await
        {
            Ok(value) => value,
            Err(resp) => return resp,
        };
        conflict_payloads.push(conflicts);
    }
    let conflicts = merge_conflicts_payload(&conflict_payloads);

    state.audit_sender.try_send(audit::domain_event(
        "update_appointment",
        Some(auth.user_id),
        "appointment",
        Some(apt_id),
        serde_json::json!({
            "recurrence_scope": match recurrence_scope {
                AppointmentRecurrenceScope::Single => "single",
                AppointmentRecurrenceScope::Following => "following",
                AppointmentRecurrenceScope::Series => "series",
            },
            "split_performed": split_performed,
            "previous_series_id": current_recurrence_series_id,
            "effective_series_id": effective_series_id,
            "affected_count": updated_targets.len(),
            "created_occurrence_count": created_targets.len(),
            "archived_tail_series_id": archived_series_id,
            "starting_recurrence_index": if recurrence_scope == AppointmentRecurrenceScope::Single { None::<i32> } else { Some(current_recurrence_index) },
            "series_shift_days": if recurrence_scope == AppointmentRecurrenceScope::Single { None::<i64> } else { Some(shift_days) },
            "previous_provider_id": current_provider_id,
            "previous_doctor_id": current_doctor_id,
            "previous_owner_user_id": current_owner_user_id,
            "previous_interpreter_id": current_interpreter_id,
            "previous_date": current_date,
            "previous_time_start": current_time_start,
            "previous_time_end": current_time_end,
            "previous_location": current_location,
            "previous_title": current_title,
            "previous_appointment_type": current_type,
            "previous_care_path_kind": current_care_path_kind,
            "previous_checklist_phase": current_checklist_phase,
            "provider_id": body.provider_id,
            "doctor_id": body.doctor_id,
            "owner_user_id": owner_user_id,
            "interpreter_id": body.interpreter_id,
            "date": date,
            "time_start": time_start,
            "time_end": time_end,
            "location": location,
            "title": title,
            "appointment_type": appointment_type,
            "care_path_kind": care_path_kind,
            "checklist_phase": checklist_phase,
            "recurrence_frequency": resolved_recurrence_frequency,
            "recurrence_interval": resolved_recurrence_interval,
            "recurrence_count": resolved_recurrence_count,
            "recurrence_until": resolved_recurrence_until_date,
        }),
    ));

    for (target_id, _, _) in &updated_targets {
        crate::realtime::publish_appointment_event(
            &state,
            Some(auth.user_id),
            "appointment.updated",
            *target_id,
            serde_json::json!({
                "recurrence_scope": match recurrence_scope {
                    AppointmentRecurrenceScope::Single => "single",
                    AppointmentRecurrenceScope::Following => "following",
                    AppointmentRecurrenceScope::Series => "series",
                },
                "split_performed": split_performed,
                "affected_count": updated_targets.len(),
                "created_occurrence_count": created_targets.len(),
            }),
        )
        .await;
    }

    Json(serde_json::json!({
        "ok": true,
        "conflicts": conflicts,
        "recurrence_scope": match recurrence_scope {
            AppointmentRecurrenceScope::Single => "single",
            AppointmentRecurrenceScope::Following => "following",
            AppointmentRecurrenceScope::Series => "series",
        },
        "split_performed": split_performed,
        "affected_count": updated_targets.len(),
        "created_occurrence_count": created_targets.len(),
        "archived_tail_series_id": archived_series_id,
    }))
    .into_response()
}

async fn update_status(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(apt_id): Path<Uuid>,
    Json(body): Json<StatusUpdate>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::Ceo, Role::PatientManager]) {
        return e;
    }
    match can_access_appointment(&state, &auth, apt_id, None, None, None).await {
        Ok(true) => {}
        Ok(false) => return err(StatusCode::FORBIDDEN, "Insufficient permissions"),
        Err(resp) => return resp,
    }
    let appointment_ctx = match sqlx::query(
        "SELECT recurrence_series_id, recurrence_index FROM appointments WHERE id = $1",
    )
    .bind(apt_id)
    .fetch_optional(&state.db)
    .await
    {
        Ok(Some(row)) => row,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Not found"),
        Err(e) => {
            tracing::error!(error = %e, appointment_id = %apt_id, "load appointment for status update");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };
    let recurrence_series_id: Option<Uuid> = appointment_ctx
        .try_get("recurrence_series_id")
        .unwrap_or_default();
    let current_recurrence_index: i32 = appointment_ctx.try_get("recurrence_index").unwrap_or(0);
    let recurrence_scope = match parse_appointment_recurrence_scope(
        body.recurrence_scope.as_deref(),
        recurrence_series_id,
    ) {
        Ok(value) => value,
        Err(message) => return err(StatusCode::UNPROCESSABLE_ENTITY, message),
    };
    match body.status.as_str() {
        "planned" => {}
        "confirmed" => {}
        "in_progress" => {}
        "completed" => {}
        "cancelled" => {}
        _ => return err(StatusCode::UNPROCESSABLE_ENTITY, "Invalid status"),
    }
    let mut tx = match state.db.begin().await {
        Ok(value) => value,
        Err(e) => {
            tracing::error!(error = %e, appointment_id = %apt_id, "update appointment status: begin tx");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };
    let mut effective_series_id = recurrence_series_id;
    let split_performed = if recurrence_scope == AppointmentRecurrenceScope::Following {
        match recurrence_series_id {
            Some(series_id) => match split_appointment_series_from_occurrence(
                &mut tx,
                series_id,
                apt_id,
                current_recurrence_index,
            )
            .await
            {
                Ok(Some(new_series_id)) => {
                    effective_series_id = Some(new_series_id);
                    true
                }
                Ok(None) => false,
                Err(resp) => return resp,
            },
            None => false,
        }
    } else {
        false
    };

    let target_ids = if recurrence_scope == AppointmentRecurrenceScope::Single {
        vec![apt_id]
    } else {
        let series_id = match effective_series_id {
            Some(value) => value,
            None => {
                return err(
                    StatusCode::UNPROCESSABLE_ENTITY,
                    "Appointment is not recurring",
                );
            }
        };
        let rows = match sqlx::query(
            r#"SELECT id
               FROM appointments
               WHERE recurrence_series_id = $1
                 AND status NOT IN ('completed', 'cancelled')
               ORDER BY date, recurrence_index, created_at"#,
        )
        .bind(series_id)
        .fetch_all(&mut *tx)
        .await
        {
            Ok(value) => value,
            Err(e) => {
                tracing::error!(error = %e, series_id = %series_id, "load recurring appointment status targets");
                return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
            }
        };
        if rows.is_empty() {
            return err(
                StatusCode::CONFLICT,
                "No active appointments remain in this series",
            );
        }
        let mut ids = Vec::with_capacity(rows.len());
        for row in rows {
            let target_id: Uuid = match row.try_get("id") {
                Ok(value) => value,
                Err(_) => return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed"),
            };
            ids.push(target_id);
        }
        ids
    };

    if body.status == "completed" {
        let blocked = match sqlx::query(
            r#"SELECT appointment_id
               FROM appointment_checklists
               WHERE appointment_id = ANY($1)
                 AND NOT is_completed
               LIMIT 1"#,
        )
        .bind(&target_ids)
        .fetch_optional(&mut *tx)
        .await
        {
            Ok(value) => value,
            Err(e) => {
                tracing::error!(error = %e, appointment_id = %apt_id, "check open appointment checklist items");
                return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
            }
        };

        if blocked.is_some() {
            return err(
                StatusCode::UNPROCESSABLE_ENTITY,
                "At least one targeted appointment has open checklist items and cannot be completed",
            );
        }
    }

    let rows_affected = if recurrence_scope == AppointmentRecurrenceScope::Single {
        match sqlx::query!(
            "UPDATE appointments SET status = $2 WHERE id = $1",
            apt_id,
            body.status
        )
        .execute(&mut *tx)
        .await
        {
            Ok(result) => result.rows_affected(),
            Err(e) => {
                tracing::error!(error = %e, appointment_id = %apt_id, "update appointment status");
                return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
            }
        }
    } else {
        let series_id =
            effective_series_id.expect("effective series id is set for recurring scope");
        match sqlx::query(
            r#"UPDATE appointments
               SET status = $2
               WHERE recurrence_series_id = $1
                 AND status NOT IN ('completed', 'cancelled')"#,
        )
        .bind(series_id)
        .bind(&body.status)
        .execute(&mut *tx)
        .await
        {
            Ok(result) => result.rows_affected(),
            Err(e) => {
                tracing::error!(error = %e, series_id = %series_id, status = %body.status, "update recurring appointment status");
                return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
            }
        }
    };

    if rows_affected == 0 {
        return err(StatusCode::NOT_FOUND, "Not found");
    }

    if let Err(e) = tx.commit().await {
        tracing::error!(error = %e, appointment_id = %apt_id, "update appointment status: commit");
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
    }

    if body.status == "completed" {
        for appointment_id in &target_ids {
            if let Err(error) =
                sync_completed_medical_appointment_to_billing(&state, auth.user_id, *appointment_id)
                    .await
            {
                tracing::error!(
                    error = %error,
                    appointment_id = %appointment_id,
                    "sync completed medical appointment to billing"
                );
            }
            let _ = crate::routes::concierge_services::mark_services_ready_for_billing(
                &state,
                auth.user_id,
                *appointment_id,
            )
            .await;
            let _ = bootstrap_billing_handoff(&state, auth.user_id, *appointment_id).await;
        }
    }

    let mut auto_preparation_templates_matched = 0usize;
    let mut auto_preparation_documents_created = 0usize;
    let mut auto_preparation_documents_reused = 0usize;
    let mut auto_preparation_portal_shares_created = 0usize;
    let mut auto_preparation_marked_sent_count = 0usize;
    let mut auto_preparation_error_count = 0usize;
    if body.status == "confirmed" {
        for appointment_id in &target_ids {
            match crate::routes::documents::auto_send_provider_preparation_documents_for_confirmed_appointment(
                &state,
                auth.user_id,
                *appointment_id,
            )
            .await
            {
                Ok(result) => {
                    auto_preparation_templates_matched += result.template_count;
                    auto_preparation_documents_created += result.generated_document_count;
                    auto_preparation_documents_reused += result.reused_document_count;
                    auto_preparation_portal_shares_created += result.portal_release_count;
                    if result.marked_sent {
                        auto_preparation_marked_sent_count += 1;
                    }
                }
                Err(error_response) => {
                    auto_preparation_error_count += 1;
                    tracing::error!(
                        appointment_id = %appointment_id,
                        body = ?body.status,
                        status = ?error_response.status(),
                        "auto-send preparation documents after appointment confirmation failed"
                    );
                }
            }
        }
    }

    if recurrence_scope != AppointmentRecurrenceScope::Single {
        state.audit_sender.try_send(audit::domain_event(
            "update_appointment_series_status",
            Some(auth.user_id),
            "appointment",
            Some(apt_id),
            serde_json::json!({
                "status": body.status,
                "recurrence_scope": match recurrence_scope {
                    AppointmentRecurrenceScope::Single => "single",
                    AppointmentRecurrenceScope::Following => "following",
                    AppointmentRecurrenceScope::Series => "series",
                },
                "split_performed": split_performed,
                "previous_series_id": recurrence_series_id,
                "effective_series_id": effective_series_id,
                "starting_recurrence_index": if recurrence_scope == AppointmentRecurrenceScope::Following { Some(current_recurrence_index) } else { None::<i32> },
                "affected_count": rows_affected,
            }),
        ));
    }

    for appointment_id in &target_ids {
        crate::realtime::publish_appointment_event(
            &state,
            Some(auth.user_id),
            "appointment.status_changed",
            *appointment_id,
            serde_json::json!({
                "status": body.status,
                "recurrence_scope": match recurrence_scope {
                    AppointmentRecurrenceScope::Single => "single",
                    AppointmentRecurrenceScope::Following => "following",
                    AppointmentRecurrenceScope::Series => "series",
                },
                "affected_count": rows_affected,
            }),
        )
        .await;
    }

    Json(serde_json::json!({
        "ok": true,
        "status": body.status,
        "recurrence_scope": match recurrence_scope {
            AppointmentRecurrenceScope::Single => "single",
            AppointmentRecurrenceScope::Following => "following",
            AppointmentRecurrenceScope::Series => "series",
        },
        "split_performed": split_performed,
        "affected_count": rows_affected,
        "auto_preparation_documents": {
            "templates_matched": auto_preparation_templates_matched,
            "documents_created": auto_preparation_documents_created,
            "documents_reused": auto_preparation_documents_reused,
            "portal_shares_created": auto_preparation_portal_shares_created,
            "orders_marked_sent": auto_preparation_marked_sent_count,
            "error_count": auto_preparation_error_count,
        },
    }))
    .into_response()
}

async fn assign_interpreter(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(apt_id): Path<Uuid>,
    Json(body): Json<AssignInterpreter>,
) -> axum::response::Response {
    if let Err(e) =
        auth.require_any_role(&[Role::Ceo, Role::PatientManager, Role::TeamleadInterpreter])
    {
        return e;
    }
    match can_access_appointment(&state, &auth, apt_id, None, None, None).await {
        Ok(true) => {}
        Ok(false) => return err(StatusCode::FORBIDDEN, "Insufficient permissions"),
        Err(resp) => return resp,
    }

    let appointment_ctx = match sqlx::query(
        "SELECT patient_id, title, date, time_start FROM appointments WHERE id = $1",
    )
    .bind(apt_id)
    .fetch_optional(&state.db)
    .await
    {
        Ok(Some(row)) => row,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Not found"),
        Err(e) => {
            tracing::error!(error = %e, appointment_id = %apt_id, "Failed to load appointment for interpreter assignment");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };

    let interpreter_role = match load_active_user_role(&state, body.interpreter_id).await {
        Ok(Some(role)) => role,
        Ok(None) => {
            return err(
                StatusCode::UNPROCESSABLE_ENTITY,
                "Interpreter must be an active interpreter or teamlead interpreter",
            );
        }
        Err(resp) => return resp,
    };

    match sqlx::query!(
        "UPDATE appointments SET interpreter_id = $2, interpreter_response = 'pending' WHERE id = $1",
        apt_id,
        body.interpreter_id
    )
    .execute(&state.db)
    .await
    {
        Ok(r) if r.rows_affected() > 0 => {
            let patient_id: Uuid = match appointment_ctx.try_get("patient_id") {
                Ok(value) => value,
                Err(_) => return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed"),
            };
            let _ = sqlx::query!(
                "INSERT INTO patient_assignments (patient_id, user_id, assigned_by)
                 VALUES ($1, $2, $3)
                 ON CONFLICT (patient_id, user_id) DO UPDATE SET revoked_at = NULL, assigned_by = $3, assigned_at = now()",
                patient_id,
                body.interpreter_id,
                auth.user_id
            )
            .execute(&state.db)
            .await;

            let title = appointment_ctx
                .try_get::<String, _>("title")
                .unwrap_or_else(|_| "Appointment assignment".to_string());
            let date = appointment_ctx
                .try_get::<chrono::NaiveDate, _>("date")
                .map(|value| value.to_string())
                .unwrap_or_default();
            let time_start = appointment_ctx
                .try_get::<Option<chrono::NaiveTime>, _>("time_start")
                .unwrap_or_default()
                .map(|value| value.format("%H:%M").to_string())
                .unwrap_or_default();

            let reminder_title = format!("New assignment: {title}");
            let reminder_description = Some(format!(
                "Appointment on {date} {time_start}. Assigned as {interpreter_role}."
            ));
            let _ = create_reminder_record(
                &state,
                apt_id,
                body.interpreter_id,
                chrono::Utc::now(),
                reminder_title,
                reminder_description,
            )
            .await;

            state.audit_sender.try_send(audit::domain_event(
                "assign_interpreter",
                Some(auth.user_id),
                "appointment",
                Some(apt_id),
                serde_json::json!({ "interpreter_id": body.interpreter_id }),
            ));
            Json(serde_json::json!({"ok": true})).into_response()
        }
        Ok(_) => err(StatusCode::NOT_FOUND, "Not found"),
        Err(e) => { tracing::error!(error = %e, "assign interpreter"); err(StatusCode::INTERNAL_SERVER_ERROR, "Failed") }
    }
}

async fn interpreter_response(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(apt_id): Path<Uuid>,
    Json(body): Json<InterpreterResponseReq>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::Interpreter, Role::TeamleadInterpreter]) {
        return e;
    }
    match can_access_appointment(&state, &auth, apt_id, None, Some(auth.user_id), None).await {
        Ok(true) => {}
        Ok(false) => return err(StatusCode::FORBIDDEN, "Insufficient permissions"),
        Err(resp) => return resp,
    }
    match body.response.as_str() {
        "accepted" => {}
        "declined" => {}
        "discussion_requested" => {}
        _ => {
            return err(
                StatusCode::UNPROCESSABLE_ENTITY,
                "Use: accepted, declined, discussion_requested",
            );
        }
    }
    match sqlx::query!(
        "UPDATE appointments SET interpreter_response = $2 WHERE id = $1 AND interpreter_id = $3",
        apt_id,
        body.response,
        auth.user_id
    )
    .execute(&state.db)
    .await
    {
        Ok(r) if r.rows_affected() > 0 => Json(serde_json::json!({"ok": true})).into_response(),
        Ok(_) => err(StatusCode::NOT_FOUND, "Not assigned to you"),
        Err(e) => {
            tracing::error!(error = %e, "interpreter response");
            err(StatusCode::INTERNAL_SERVER_ERROR, "Failed")
        }
    }
}

async fn list_checklist(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(apt_id): Path<Uuid>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::Ceo, Role::PatientManager, Role::Concierge]) {
        return e;
    }
    if let Err(resp) = ensure_checklist_access(&state, &auth, apt_id).await {
        return resp;
    }
    match can_access_appointment(&state, &auth, apt_id, None, None, None).await {
        Ok(true) => {}
        Ok(false) => return err(StatusCode::FORBIDDEN, "Insufficient permissions"),
        Err(resp) => return resp,
    }
    match sqlx::query!("SELECT id, phase, item_text, is_completed, completed_at FROM appointment_checklists WHERE appointment_id = $1 ORDER BY phase, sort_order", apt_id)
        .fetch_all(&state.db).await {
        Ok(rows) => {
            let mut items = Vec::with_capacity(rows.len());
            for r in rows { items.push(serde_json::json!({"id": r.id, "phase": r.phase, "item_text": r.item_text, "is_completed": r.is_completed, "completed_at": r.completed_at})); }
            Json(items).into_response()
        }
        Err(e) => { tracing::error!(error = %e, "list checklist"); err(StatusCode::INTERNAL_SERVER_ERROR, "Failed") }
    }
}

async fn add_checklist_item(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(apt_id): Path<Uuid>,
    Json(body): Json<ChecklistItem>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::Ceo, Role::PatientManager, Role::Concierge]) {
        return e;
    }
    if let Err(resp) = ensure_checklist_access(&state, &auth, apt_id).await {
        return resp;
    }
    match can_access_appointment(&state, &auth, apt_id, None, None, None).await {
        Ok(true) => {}
        Ok(false) => return err(StatusCode::FORBIDDEN, "Insufficient permissions"),
        Err(resp) => return resp,
    }
    match body.phase.as_str() {
        "preparation" => {}
        "execution" => {}
        "followup" => {}
        _ => return err(StatusCode::UNPROCESSABLE_ENTITY, "Invalid phase"),
    }
    let order = sqlx::query_scalar!(r#"SELECT COALESCE(MAX(sort_order), 0) + 1 AS "v!" FROM appointment_checklists WHERE appointment_id = $1 AND phase = $2"#, apt_id, body.phase)
        .fetch_one(&state.db).await.unwrap_or(0);
    match sqlx::query!("INSERT INTO appointment_checklists (appointment_id, phase, item_text, sort_order) VALUES ($1, $2, $3, $4) RETURNING id",
        apt_id, body.phase, body.item_text, order).fetch_one(&state.db).await {
        Ok(r) => {
            crate::realtime::publish_appointment_checklist_event(
                &state,
                Some(auth.user_id),
                "appointment_checklist.created",
                r.id,
                serde_json::json!({
                    "appointment_id": apt_id,
                    "phase": body.phase,
                }),
            )
            .await;
            (StatusCode::CREATED, Json(serde_json::json!({"id": r.id}))).into_response()
        },
        Err(e) => { tracing::error!(error = %e, "add checklist"); err(StatusCode::INTERNAL_SERVER_ERROR, "Failed") }
    }
}

async fn complete_checklist(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path((apt_id, item_id)): Path<(Uuid, Uuid)>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::Ceo, Role::PatientManager, Role::Concierge]) {
        return e;
    }
    if let Err(resp) = ensure_checklist_access(&state, &auth, apt_id).await {
        return resp;
    }
    match can_access_appointment(&state, &auth, apt_id, None, None, None).await {
        Ok(true) => {}
        Ok(false) => return err(StatusCode::FORBIDDEN, "Insufficient permissions"),
        Err(resp) => return resp,
    }
    match sqlx::query!("UPDATE appointment_checklists SET is_completed = true, completed_by = $3, completed_at = now() WHERE id = $2 AND appointment_id = $1",
        apt_id, item_id, auth.user_id).execute(&state.db).await {
        Ok(r) if r.rows_affected() > 0 => {
            crate::realtime::publish_appointment_checklist_event(
                &state,
                Some(auth.user_id),
                "appointment_checklist.completed",
                item_id,
                serde_json::json!({
                    "appointment_id": apt_id,
                }),
            )
            .await;
            Json(serde_json::json!({"ok": true})).into_response()
        },
        Ok(_) => err(StatusCode::NOT_FOUND, "Not found"),
        Err(e) => { tracing::error!(error = %e, "complete checklist"); err(StatusCode::INTERNAL_SERVER_ERROR, "Failed") }
    }
}

async fn list_reminders(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(apt_id): Path<Uuid>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[
        Role::Ceo,
        Role::PatientManager,
        Role::TeamleadInterpreter,
        Role::Interpreter,
        Role::Concierge,
    ]) {
        return e;
    }
    match can_access_appointment(&state, &auth, apt_id, None, None, None).await {
        Ok(true) => {}
        Ok(false) => return err(StatusCode::FORBIDDEN, "Insufficient permissions"),
        Err(resp) => return resp,
    }

    match sqlx::query(
        r#"SELECT r.id, r.user_id, r.remind_at, r.title, r.description, r.is_completed,
                  r.completed_at, u.name AS user_name
           FROM reminders r
           JOIN users u ON u.id = r.user_id
           WHERE r.appointment_id = $1
           ORDER BY r.is_completed, r.remind_at, r.created_at"#,
    )
    .bind(apt_id)
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => {
            let mut items = Vec::with_capacity(rows.len());
            for row in rows {
                items.push(serde_json::json!({
                    "id": row.try_get::<Uuid, _>("id").unwrap_or_else(|_| Uuid::nil()),
                    "user_id": row.try_get::<Uuid, _>("user_id").unwrap_or_else(|_| Uuid::nil()),
                    "user_name": row.try_get::<String, _>("user_name").unwrap_or_default(),
                    "remind_at": row.try_get::<chrono::DateTime<chrono::Utc>, _>("remind_at").map(|value| value.to_rfc3339()).unwrap_or_default(),
                    "title": row.try_get::<String, _>("title").unwrap_or_default(),
                    "description": row.try_get::<Option<String>, _>("description").unwrap_or_default(),
                    "is_completed": row.try_get::<bool, _>("is_completed").unwrap_or(false),
                    "completed_at": row.try_get::<Option<chrono::DateTime<chrono::Utc>>, _>("completed_at").unwrap_or_default().map(|value| value.to_rfc3339()),
                }));
            }
            Json(items).into_response()
        }
        Err(e) => {
            tracing::error!(error = %e, appointment_id = %apt_id, "list reminders");
            err(StatusCode::INTERNAL_SERVER_ERROR, "Failed")
        }
    }
}

async fn add_reminder(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(apt_id): Path<Uuid>,
    Json(body): Json<CreateReminder>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::Ceo, Role::PatientManager]) {
        return e;
    }
    match can_access_appointment(&state, &auth, apt_id, None, None, None).await {
        Ok(true) => {}
        Ok(false) => return err(StatusCode::FORBIDDEN, "Insufficient permissions"),
        Err(resp) => return resp,
    }

    if body.title.trim().is_empty() || body.title.len() > 255 {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Reminder title is required (max 255)",
        );
    }

    let remind_at = match chrono::DateTime::parse_from_rfc3339(&body.remind_at) {
        Ok(value) => value.with_timezone(&chrono::Utc),
        Err(_) => {
            return err(
                StatusCode::UNPROCESSABLE_ENTITY,
                "Invalid remind_at (RFC3339)",
            );
        }
    };

    match load_active_user_role(&state, body.user_id).await {
        Ok(Some(_)) => {}
        Ok(None) => {
            return err(
                StatusCode::UNPROCESSABLE_ENTITY,
                "Reminder target must be an active user",
            );
        }
        Err(resp) => return resp,
    }

    match create_reminder_record(
        &state,
        apt_id,
        body.user_id,
        remind_at,
        body.title,
        body.description,
    )
    .await
    {
        Ok(reminder_id) => (
            {
                crate::realtime::publish_reminder_event(
                    &state,
                    Some(auth.user_id),
                    "reminder.created",
                    reminder_id,
                    serde_json::json!({
                        "appointment_id": apt_id,
                        "user_id": body.user_id,
                    }),
                )
                .await;
                StatusCode::CREATED
            },
            Json(serde_json::json!({ "id": reminder_id })),
        )
            .into_response(),
        Err(resp) => resp,
    }
}

async fn complete_reminder(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path((apt_id, reminder_id)): Path<(Uuid, Uuid)>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[
        Role::Ceo,
        Role::PatientManager,
        Role::TeamleadInterpreter,
        Role::Interpreter,
        Role::Concierge,
    ]) {
        return e;
    }
    match can_access_appointment(&state, &auth, apt_id, None, None, None).await {
        Ok(true) => {}
        Ok(false) => return err(StatusCode::FORBIDDEN, "Insufficient permissions"),
        Err(resp) => return resp,
    }

    let result = sqlx::query(
        r#"UPDATE reminders
           SET is_completed = true, completed_at = now()
           WHERE id = $1
             AND appointment_id = $2
             AND is_completed = false
             AND ($3::bool = true OR user_id = $4)"#,
    )
    .bind(reminder_id)
    .bind(apt_id)
    .bind(matches!(auth.role, Role::Ceo | Role::PatientManager))
    .bind(auth.user_id)
    .execute(&state.db)
    .await;

    match result {
        Ok(r) if r.rows_affected() > 0 => {
            crate::realtime::publish_reminder_event(
                &state,
                Some(auth.user_id),
                "reminder.completed",
                reminder_id,
                serde_json::json!({
                    "appointment_id": apt_id,
                }),
            )
            .await;
            Json(serde_json::json!({"ok": true})).into_response()
        }
        Ok(_) => err(StatusCode::NOT_FOUND, "Reminder not found"),
        Err(e) => {
            tracing::error!(error = %e, reminder_id = %reminder_id, appointment_id = %apt_id, "complete reminder");
            err(StatusCode::INTERNAL_SERVER_ERROR, "Failed")
        }
    }
}

async fn list_communications(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(apt_id): Path<Uuid>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[
        Role::Ceo,
        Role::PatientManager,
        Role::TeamleadInterpreter,
        Role::Interpreter,
        Role::Concierge,
    ]) {
        return e;
    }

    let context = match ensure_appointment_communication_access(&state, &auth, apt_id, false).await
    {
        Ok(value) => value,
        Err(resp) => return resp,
    };

    match sqlx::query(
        r#"SELECT ac.id, ac.target_type, ac.direction, ac.channel, ac.status, ac.subject,
                  ac.message, ac.contact_name, ac.due_at, ac.responded_at, ac.closed_at,
                  ac.created_at, ac.updated_at, ac.provider_id, ac.doctor_id,
                  p.name AS provider_name, d.name AS doctor_name,
                  u.name AS created_by_name, u.role AS created_by_role
           FROM appointment_communications ac
           LEFT JOIN providers p ON p.id = ac.provider_id
           LEFT JOIN provider_doctors d ON d.id = ac.doctor_id
           JOIN users u ON u.id = ac.created_by
           WHERE ac.appointment_id = $1
           ORDER BY ac.updated_at DESC, ac.created_at DESC"#,
    )
    .bind(apt_id)
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => Json(
            rows.into_iter()
                .map(|row| {
                    serde_json::json!({
                        "id": row.try_get::<Uuid, _>("id").unwrap_or_default(),
                        "appointment_id": context.appointment_id,
                        "patient_id": context.patient_id,
                        "provider_id": row.try_get::<Option<Uuid>, _>("provider_id").unwrap_or_default(),
                        "provider_name": row.try_get::<Option<String>, _>("provider_name").unwrap_or_default(),
                        "doctor_id": row.try_get::<Option<Uuid>, _>("doctor_id").unwrap_or_default(),
                        "doctor_name": row.try_get::<Option<String>, _>("doctor_name").unwrap_or_default(),
                        "target_type": row.try_get::<String, _>("target_type").unwrap_or_default(),
                        "direction": row.try_get::<String, _>("direction").unwrap_or_default(),
                        "channel": row.try_get::<String, _>("channel").unwrap_or_default(),
                        "status": row.try_get::<String, _>("status").unwrap_or_default(),
                        "subject": row.try_get::<String, _>("subject").unwrap_or_default(),
                        "message": row.try_get::<Option<String>, _>("message").unwrap_or_default(),
                        "contact_name": row.try_get::<Option<String>, _>("contact_name").unwrap_or_default(),
                        "due_at": row.try_get::<Option<chrono::DateTime<chrono::Utc>>, _>("due_at").unwrap_or_default().map(|value| value.to_rfc3339()),
                        "responded_at": row.try_get::<Option<chrono::DateTime<chrono::Utc>>, _>("responded_at").unwrap_or_default().map(|value| value.to_rfc3339()),
                        "closed_at": row.try_get::<Option<chrono::DateTime<chrono::Utc>>, _>("closed_at").unwrap_or_default().map(|value| value.to_rfc3339()),
                        "created_at": row.try_get::<chrono::DateTime<chrono::Utc>, _>("created_at").map(|value| value.to_rfc3339()).unwrap_or_default(),
                        "updated_at": row.try_get::<chrono::DateTime<chrono::Utc>, _>("updated_at").map(|value| value.to_rfc3339()).unwrap_or_default(),
                        "created_by_name": row.try_get::<String, _>("created_by_name").unwrap_or_default(),
                        "created_by_role": row.try_get::<String, _>("created_by_role").unwrap_or_default(),
                    })
                })
                .collect::<Vec<_>>(),
        )
        .into_response(),
        Err(e) => {
            tracing::error!(error = %e, appointment_id = %apt_id, "list communications");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to list appointment communications",
            )
        }
    }
}

async fn create_communication(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(apt_id): Path<Uuid>,
    Json(body): Json<CreateCommunication>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[
        Role::Ceo,
        Role::PatientManager,
        Role::TeamleadInterpreter,
        Role::Concierge,
    ]) {
        return e;
    }

    let context = match ensure_appointment_communication_access(&state, &auth, apt_id, true).await {
        Ok(value) => value,
        Err(resp) => return resp,
    };

    if !is_valid_communication_target(&body.target_type) {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Invalid communication target",
        );
    }
    if !is_valid_communication_direction(&body.direction) {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Invalid communication direction",
        );
    }
    if !is_valid_communication_channel(&body.channel) {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Invalid communication channel",
        );
    }
    if !is_valid_communication_status(&body.status) {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Invalid communication status",
        );
    }

    let subject = body.subject.trim();
    if subject.is_empty() || subject.len() > 255 {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Communication subject is required (max 255)",
        );
    }

    let due_at = match parse_optional_rfc3339(body.due_at.as_deref(), "due_at") {
        Ok(value) => value,
        Err(message) => return err(StatusCode::UNPROCESSABLE_ENTITY, message),
    };

    let (provider_id, doctor_id) = match body.target_type.as_str() {
        "doctor" => match context.doctor_id {
            Some(doctor_id) => (context.provider_id, Some(doctor_id)),
            None => {
                return err(
                    StatusCode::UNPROCESSABLE_ENTITY,
                    "Doctor communication requires an appointment doctor",
                );
            }
        },
        "clinic" | "service_provider" => match context.provider_id {
            Some(provider_id) => (Some(provider_id), None),
            None => {
                return err(
                    StatusCode::UNPROCESSABLE_ENTITY,
                    "Provider communication requires an appointment provider",
                );
            }
        },
        _ => {
            return err(
                StatusCode::UNPROCESSABLE_ENTITY,
                "Invalid communication target",
            );
        }
    };

    let responded_at = if body.status == "answered" {
        Some(chrono::Utc::now())
    } else {
        None
    };
    let closed_at = if matches!(body.status.as_str(), "closed" | "cancelled") {
        Some(chrono::Utc::now())
    } else {
        None
    };

    match sqlx::query(
        r#"INSERT INTO appointment_communications (
                appointment_id, patient_id, provider_id, doctor_id, target_type, direction,
                channel, status, subject, message, contact_name, due_at, responded_at, closed_at,
                created_by
           ) VALUES (
                $1, $2, $3, $4, $5, $6,
                $7, $8, $9, $10, $11, $12, $13, $14,
                $15
           ) RETURNING id"#,
    )
    .bind(apt_id)
    .bind(context.patient_id)
    .bind(provider_id)
    .bind(doctor_id)
    .bind(body.target_type.clone())
    .bind(body.direction.clone())
    .bind(body.channel.clone())
    .bind(body.status.clone())
    .bind(subject)
    .bind(normalize_optional_text(body.message))
    .bind(normalize_optional_text(body.contact_name))
    .bind(due_at)
    .bind(responded_at)
    .bind(closed_at)
    .bind(auth.user_id)
    .fetch_one(&state.db)
    .await
    {
        Ok(row) => {
            let communication_id = row.try_get::<Uuid, _>("id").unwrap_or_default();
            state.audit_sender.try_send(audit::domain_event(
                "create_appointment_communication",
                Some(auth.user_id),
                "appointment",
                Some(apt_id),
                serde_json::json!({
                    "communication_id": communication_id,
                    "target_type": body.target_type,
                    "direction": body.direction,
                    "channel": body.channel,
                    "status": body.status,
                    "provider_id": provider_id,
                    "doctor_id": doctor_id,
                }),
            ));

            (
                StatusCode::CREATED,
                Json(serde_json::json!({ "id": communication_id })),
            )
                .into_response()
        }
        Err(e) => {
            tracing::error!(error = %e, appointment_id = %apt_id, "create communication");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to create appointment communication",
            )
        }
    }
}

async fn update_communication_status(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path((apt_id, communication_id)): Path<(Uuid, Uuid)>,
    Json(body): Json<UpdateCommunicationStatus>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[
        Role::Ceo,
        Role::PatientManager,
        Role::TeamleadInterpreter,
        Role::Concierge,
    ]) {
        return e;
    }

    let _context = match ensure_appointment_communication_access(&state, &auth, apt_id, true).await
    {
        Ok(value) => value,
        Err(resp) => return resp,
    };

    if !is_valid_communication_status(&body.status) {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Invalid communication status",
        );
    }

    let responded_at = if body.status == "answered" {
        Some(chrono::Utc::now())
    } else {
        None
    };
    let closed_at = if matches!(body.status.as_str(), "closed" | "cancelled") {
        Some(chrono::Utc::now())
    } else {
        None
    };

    match sqlx::query(
        r#"UPDATE appointment_communications
           SET status = $3,
               responded_at = CASE
                   WHEN $4::timestamptz IS NULL THEN responded_at
                   ELSE COALESCE(responded_at, $4)
               END,
               closed_at = CASE
                   WHEN $5::timestamptz IS NULL THEN NULL
                   ELSE COALESCE(closed_at, $5)
               END,
               updated_at = now()
           WHERE id = $1
             AND appointment_id = $2"#,
    )
    .bind(communication_id)
    .bind(apt_id)
    .bind(body.status.clone())
    .bind(responded_at)
    .bind(closed_at)
    .execute(&state.db)
    .await
    {
        Ok(result) if result.rows_affected() > 0 => {
            state.audit_sender.try_send(audit::domain_event(
                "update_appointment_communication_status",
                Some(auth.user_id),
                "appointment",
                Some(apt_id),
                serde_json::json!({
                    "communication_id": communication_id,
                    "status": body.status,
                }),
            ));

            Json(serde_json::json!({ "ok": true })).into_response()
        }
        Ok(_) => err(StatusCode::NOT_FOUND, "Communication not found"),
        Err(e) => {
            tracing::error!(
                error = %e,
                appointment_id = %apt_id,
                communication_id = %communication_id,
                "update communication status"
            );
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to update appointment communication",
            )
        }
    }
}

async fn submit_report(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(apt_id): Path<Uuid>,
    Json(body): Json<SubmitReport>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::Interpreter]) {
        return e;
    }
    match can_access_appointment(&state, &auth, apt_id, None, Some(auth.user_id), None).await {
        Ok(true) => {}
        Ok(false) => return err(StatusCode::FORBIDDEN, "Insufficient permissions"),
        Err(resp) => return resp,
    }
    let hours = rust_decimal::Decimal::try_from(body.hours).unwrap_or(rust_decimal::Decimal::ZERO);
    match sqlx::query!("INSERT INTO interpreter_reports (appointment_id, interpreter_id, hours, report_text) VALUES ($1, $2, $3, $4) RETURNING id",
        apt_id, auth.user_id, hours, body.report_text).fetch_one(&state.db).await {
        Ok(r) => {
            tracing::info!(by = %auth.user_id, apt = %apt_id, hours = %body.hours, "Interpreter report submitted");
            (StatusCode::CREATED, Json(serde_json::json!({"id": r.id}))).into_response()
        }
        Err(e) => { tracing::error!(error = %e, "submit report"); err(StatusCode::INTERNAL_SERVER_ERROR, "Failed") }
    }
}

async fn load_interpreter_hours_catalog_item(
    state: &AppState,
    service_date: chrono::NaiveDate,
) -> Result<Option<AgencyServiceBillingItem>, sqlx::Error> {
    load_agency_service_catalog_item(state, INTERPRETER_HOURS_SERVICE_KEY, service_date).await
}

async fn load_medical_treatment_organization_catalog_item(
    state: &AppState,
    service_date: chrono::NaiveDate,
) -> Result<Option<AgencyServiceBillingItem>, sqlx::Error> {
    load_agency_service_catalog_item(
        state,
        MEDICAL_TREATMENT_ORGANIZATION_SERVICE_KEY,
        service_date,
    )
    .await
}

async fn load_agency_service_catalog_item(
    state: &AppState,
    service_key: &str,
    service_date: chrono::NaiveDate,
) -> Result<Option<AgencyServiceBillingItem>, sqlx::Error> {
    sqlx::query(
        r#"SELECT id, service_key, service_name, unit_price, currency, vat_rate
           FROM agency_service_catalog
           WHERE service_key = $1
             AND is_active = true
             AND valid_from <= $2
             AND (valid_to IS NULL OR valid_to >= $2)
           ORDER BY valid_from DESC, updated_at DESC
           LIMIT 1"#,
    )
    .bind(service_key)
    .bind(service_date)
    .fetch_optional(&state.db)
    .await
    .map(|row| {
        row.map(|row| AgencyServiceBillingItem {
            id: row.try_get::<Uuid, _>("id").unwrap_or_default(),
            service_key: row.try_get::<String, _>("service_key").unwrap_or_default(),
            service_name: row.try_get::<String, _>("service_name").unwrap_or_default(),
            unit_price: row
                .try_get::<rust_decimal::Decimal, _>("unit_price")
                .unwrap_or(rust_decimal::Decimal::ZERO),
            currency: row
                .try_get::<String, _>("currency")
                .unwrap_or_else(|_| "EUR".to_string()),
            vat_rate: row
                .try_get::<rust_decimal::Decimal, _>("vat_rate")
                .unwrap_or(rust_decimal::Decimal::ZERO),
        })
    })
}

async fn sync_completed_medical_appointment_to_billing(
    state: &AppState,
    created_by: Uuid,
    appointment_id: Uuid,
) -> Result<(), sqlx::Error> {
    let row = sqlx::query(
        r#"SELECT a.order_id, a.patient_id, a.provider_id, a.doctor_id, a.title, a.date, a.status,
                  a.appointment_type, pr.name AS provider_name, d.name AS doctor_name
           FROM appointments a
           LEFT JOIN providers pr ON pr.id = a.provider_id
           LEFT JOIN provider_doctors d ON d.id = a.doctor_id
           WHERE a.id = $1"#,
    )
    .bind(appointment_id)
    .fetch_optional(&state.db)
    .await?;

    let Some(row) = row else {
        return Ok(());
    };

    let appointment_type: String = row.try_get("appointment_type").unwrap_or_default();
    let appointment_status: String = row.try_get("status").unwrap_or_default();
    if appointment_type != "medical" || appointment_status != "completed" {
        return Ok(());
    }

    let Some(order_id) = row
        .try_get::<Option<Uuid>, _>("order_id")
        .unwrap_or_default()
    else {
        return Ok(());
    };

    let appointment_date = row
        .try_get::<chrono::NaiveDate, _>("date")
        .unwrap_or_else(|_| chrono::Utc::now().date_naive());
    let Some(catalog_item) =
        load_medical_treatment_organization_catalog_item(state, appointment_date).await?
    else {
        return Ok(());
    };

    let provider_id = row
        .try_get::<Option<Uuid>, _>("provider_id")
        .unwrap_or_default();
    let doctor_id = row
        .try_get::<Option<Uuid>, _>("doctor_id")
        .unwrap_or_default();
    let patient_id = row.try_get::<Uuid, _>("patient_id").unwrap_or_default();
    let appointment_title = row.try_get::<String, _>("title").unwrap_or_default();
    let provider_name = row
        .try_get::<Option<String>, _>("provider_name")
        .unwrap_or_default();
    let doctor_name = row
        .try_get::<Option<String>, _>("doctor_name")
        .unwrap_or_default();

    let mut notes = vec![
        format!("Auto-created from completed medical appointment {appointment_id}"),
        format!("Appointment: {appointment_title}"),
        format!("Date: {appointment_date}"),
        format!("Catalog key: {}", catalog_item.service_key),
    ];
    if let Some(provider_name) = provider_name.as_deref()
        && !provider_name.trim().is_empty()
    {
        notes.push(format!("Provider: {provider_name}"));
    }
    if let Some(doctor_name) = doctor_name.as_deref()
        && !doctor_name.trim().is_empty()
    {
        notes.push(format!("Doctor: {doctor_name}"));
    }

    let result = sqlx::query(
        r#"INSERT INTO order_leistungen (
                order_id, description, quantity, unit_price, currency, vat_rate,
                is_cost_passthrough, provider_id, doctor_id, status, delivered_at, notes,
                source_medical_appointment_id, agency_service_id
           ) VALUES (
                $1, $2, 1, $3, $4, $5,
                false, $6, $7, 'delivered', now(), $8,
                $9, $10
           )
           ON CONFLICT (source_medical_appointment_id)
               WHERE source_medical_appointment_id IS NOT NULL
           DO NOTHING"#,
    )
    .bind(order_id)
    .bind(catalog_item.service_name.clone())
    .bind(catalog_item.unit_price)
    .bind(catalog_item.currency.clone())
    .bind(catalog_item.vat_rate)
    .bind(provider_id)
    .bind(doctor_id)
    .bind(notes.join("\n"))
    .bind(appointment_id)
    .bind(catalog_item.id)
    .execute(&state.db)
    .await?;

    if result.rows_affected() > 0 {
        state.audit_sender.try_send(audit::domain_event(
            "auto_create_medical_order_leistung".to_string(),
            Some(created_by),
            "order",
            Some(order_id),
            serde_json::json!({
                "patient_id": patient_id,
                "appointment_id": appointment_id,
                "service_key": catalog_item.service_key,
                "provider_id": provider_id,
                "doctor_id": doctor_id,
            }),
        ));
    }

    Ok(())
}

async fn load_interpreter_report_billing_candidates(
    state: &AppState,
    appointment_id: Option<Uuid>,
) -> Result<Vec<InterpreterReportBillingCandidate>, sqlx::Error> {
    let rows = sqlx::query(
        r#"SELECT ir.id AS report_id,
                  ir.appointment_id,
                  a.order_id,
                  a.patient_id,
                  a.title AS appointment_title,
                  a.date AS appointment_date,
                  u.name AS interpreter_name,
                  ir.hours,
                  ir.report_text,
                  ir.approved_by,
                  ir.approved_at
           FROM interpreter_reports ir
           JOIN appointments a ON a.id = ir.appointment_id
           JOIN users u ON u.id = ir.interpreter_id
           LEFT JOIN order_leistungen ol
                  ON ol.source_interpreter_report_id = ir.id
           WHERE ir.approval_status = 'approved'
             AND ol.id IS NULL
             AND ($1::UUID IS NULL OR ir.appointment_id = $1)
           ORDER BY ir.approved_at NULLS LAST, ir.created_at, ir.id"#,
    )
    .bind(appointment_id)
    .fetch_all(&state.db)
    .await?;

    Ok(rows
        .into_iter()
        .map(|row| InterpreterReportBillingCandidate {
            report_id: row.try_get::<Uuid, _>("report_id").unwrap_or_default(),
            appointment_id: row.try_get::<Uuid, _>("appointment_id").unwrap_or_default(),
            order_id: row
                .try_get::<Option<Uuid>, _>("order_id")
                .unwrap_or_default(),
            patient_id: row.try_get::<Uuid, _>("patient_id").unwrap_or_default(),
            appointment_title: row
                .try_get::<String, _>("appointment_title")
                .unwrap_or_default(),
            appointment_date: row
                .try_get::<chrono::NaiveDate, _>("appointment_date")
                .unwrap_or_else(|_| chrono::Utc::now().date_naive()),
            interpreter_name: row
                .try_get::<String, _>("interpreter_name")
                .unwrap_or_default(),
            hours: row
                .try_get::<rust_decimal::Decimal, _>("hours")
                .unwrap_or(rust_decimal::Decimal::ZERO),
            report_text: row
                .try_get::<Option<String>, _>("report_text")
                .unwrap_or_default(),
            approved_by: row
                .try_get::<Option<Uuid>, _>("approved_by")
                .unwrap_or_default(),
            approved_at: row
                .try_get::<Option<chrono::DateTime<chrono::Utc>>, _>("approved_at")
                .unwrap_or_default(),
        })
        .collect())
}

async fn sync_interpreter_report_billing_candidates(
    state: &AppState,
    appointment_id: Option<Uuid>,
) -> Result<InterpreterReportBillingSyncSummary, sqlx::Error> {
    let candidates = load_interpreter_report_billing_candidates(state, appointment_id).await?;
    let mut summary = InterpreterReportBillingSyncSummary::default();

    for candidate in candidates {
        let Some(order_id) = candidate.order_id else {
            summary.missing_order += 1;
            continue;
        };

        let Some(catalog_item) =
            load_interpreter_hours_catalog_item(state, candidate.appointment_date).await?
        else {
            summary.missing_catalog += 1;
            continue;
        };

        let approved_at = candidate.approved_at.unwrap_or_else(chrono::Utc::now);
        let description = format!(
            "{} · {} · {}",
            catalog_item.service_name, candidate.appointment_title, candidate.appointment_date
        );

        let notes = {
            let mut parts = vec![
                format!(
                    "Auto-created from approved interpreter report {}",
                    candidate.report_id
                ),
                format!("Interpreter: {}", candidate.interpreter_name),
                format!("Hours: {}", candidate.hours.normalize()),
                format!("Appointment: {}", candidate.appointment_id),
                format!("Catalog key: {}", catalog_item.service_key),
            ];
            if let Some(text) = candidate.report_text.as_ref().map(|value| value.trim())
                && !text.is_empty()
            {
                parts.push(format!("Report: {text}"));
            }
            parts.join("\n")
        };

        let result = sqlx::query(
            r#"INSERT INTO order_leistungen (
                    order_id, description, quantity, unit_price, currency, vat_rate,
                    is_cost_passthrough, status, delivered_at, approved_by, approved_at,
                    notes, source_interpreter_report_id, agency_service_id
               ) VALUES (
                    $1, $2, $3, $4, $5, $6,
                    false, 'approved', $7, $8, $7,
                    $9, $10, $11
               )
               ON CONFLICT (source_interpreter_report_id)
                   WHERE source_interpreter_report_id IS NOT NULL
               DO NOTHING"#,
        )
        .bind(order_id)
        .bind(description)
        .bind(candidate.hours)
        .bind(catalog_item.unit_price)
        .bind(catalog_item.currency)
        .bind(catalog_item.vat_rate)
        .bind(approved_at)
        .bind(candidate.approved_by)
        .bind(notes)
        .bind(candidate.report_id)
        .bind(catalog_item.id)
        .execute(&state.db)
        .await?;

        if result.rows_affected() == 0 {
            summary.already_synced += 1;
            continue;
        }

        summary.leistungen_created += result.rows_affected();

        state.audit_sender.try_send(audit::domain_event(
            "auto_create_interpreter_order_leistung".to_string(),
            candidate.approved_by,
            "order",
            Some(order_id),
            serde_json::json!({
                "patient_id": candidate.patient_id,
                "appointment_id": candidate.appointment_id,
                "interpreter_report_id": candidate.report_id,
                "service_key": catalog_item.service_key,
                "hours": candidate.hours.normalize().to_string(),
            }),
        ));
    }

    Ok(summary)
}

async fn load_interpreter_report_billing_projection(
    state: &AppState,
    report_id: Uuid,
    order_id: Option<Uuid>,
    appointment_date: chrono::NaiveDate,
    approval_status: &str,
) -> Result<(Option<Uuid>, Option<String>, Option<String>), sqlx::Error> {
    if approval_status != "approved" {
        return Ok((None, None, None));
    }

    let existing = sqlx::query(
        r#"SELECT ol.id, catalog.service_key
           FROM order_leistungen ol
           LEFT JOIN agency_service_catalog catalog ON catalog.id = ol.agency_service_id
           WHERE ol.source_interpreter_report_id = $1"#,
    )
    .bind(report_id)
    .fetch_optional(&state.db)
    .await?;

    if let Some(row) = existing {
        return Ok((
            row.try_get::<Uuid, _>("id").ok(),
            Some("synced".to_string()),
            row.try_get::<Option<String>, _>("service_key")
                .unwrap_or_else(|_| Some(INTERPRETER_HOURS_SERVICE_KEY.to_string())),
        ));
    }

    let Some(_) = order_id else {
        return Ok((None, Some("missing_order".to_string()), None));
    };

    let catalog = load_interpreter_hours_catalog_item(state, appointment_date).await?;
    Ok((
        None,
        Some(if catalog.is_some() {
            "pending_sync".to_string()
        } else {
            "missing_catalog".to_string()
        }),
        catalog.map(|item| item.service_key),
    ))
}

pub async fn run_interpreter_report_billing_sync_once(
    state: &AppState,
) -> Result<InterpreterReportBillingSyncSummary, sqlx::Error> {
    sync_interpreter_report_billing_candidates(state, None).await
}

pub fn spawn_interpreter_report_billing_sync_scheduler(state: AppState) {
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(
            INTERPRETER_REPORT_BILLING_SYNC_INTERVAL_SECS,
        ));
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        interval.tick().await;

        loop {
            interval.tick().await;
            match run_interpreter_report_billing_sync_once(&state).await {
                Ok(summary) => {
                    if summary.leistungen_created > 0
                        || summary.missing_order > 0
                        || summary.missing_catalog > 0
                    {
                        tracing::info!(
                            leistungen_created = summary.leistungen_created,
                            already_synced = summary.already_synced,
                            missing_order = summary.missing_order,
                            missing_catalog = summary.missing_catalog,
                            "Interpreter report billing sync applied"
                        );
                    }
                }
                Err(error) => {
                    tracing::error!(error = %error, "Interpreter report billing sync failed");
                }
            }
        }
    });
}

async fn get_report(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(apt_id): Path<Uuid>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[
        Role::Ceo,
        Role::PatientManager,
        Role::TeamleadInterpreter,
        Role::Interpreter,
    ]) {
        return e;
    }
    match can_access_appointment(&state, &auth, apt_id, None, None, None).await {
        Ok(true) => {}
        Ok(false) => return err(StatusCode::FORBIDDEN, "Insufficient permissions"),
        Err(resp) => return resp,
    }

    match sqlx::query(
        r#"SELECT ir.id, ir.interpreter_id, ir.hours, ir.report_text, ir.approval_status,
                  ir.notes,
                  ir.approved_at, ir.created_at,
                  u.name AS interpreter_name,
                  approver.name AS approved_by_name
           FROM interpreter_reports ir
           JOIN users u ON u.id = ir.interpreter_id
           LEFT JOIN users approver ON approver.id = ir.approved_by
           WHERE ir.appointment_id = $1
           ORDER BY ir.created_at DESC
           LIMIT 1"#,
    )
    .bind(apt_id)
    .fetch_optional(&state.db)
    .await
    {
        Ok(Some(row)) => {
            let report_id = row.try_get::<Uuid, _>("id").unwrap_or(apt_id);
            let approval_status = row
                .try_get::<String, _>("approval_status")
                .unwrap_or_default();
            let appointment_meta = sqlx::query(
                r#"SELECT order_id, date
                   FROM appointments
                   WHERE id = $1"#,
            )
            .bind(apt_id)
            .fetch_optional(&state.db)
            .await;

            let (order_id, appointment_date) = match appointment_meta {
                Ok(Some(meta)) => (
                    meta.try_get::<Option<Uuid>, _>("order_id")
                        .unwrap_or_default(),
                    meta.try_get::<chrono::NaiveDate, _>("date")
                        .unwrap_or_else(|_| chrono::Utc::now().date_naive()),
                ),
                Ok(None) => (None, chrono::Utc::now().date_naive()),
                Err(error) => {
                    tracing::error!(error = %error, appointment_id = %apt_id, "load appointment billing projection");
                    return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
                }
            };

            let (billing_leistung_id, billing_sync_status, billing_service_key) =
                match load_interpreter_report_billing_projection(
                    &state,
                    report_id,
                    order_id,
                    appointment_date,
                    &approval_status,
                )
                .await
                {
                    Ok(result) => result,
                    Err(error) => {
                        tracing::error!(error = %error, appointment_id = %apt_id, report_id = %report_id, "load interpreter billing projection");
                        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
                    }
                };

            Json(serde_json::json!({
                "id": report_id,
                "interpreter_id": row.try_get::<Uuid, _>("interpreter_id").unwrap_or(auth.user_id),
                "interpreter_name": row.try_get::<String, _>("interpreter_name").unwrap_or_default(),
                "hours": row.try_get::<rust_decimal::Decimal, _>("hours").map(|value| value.to_string()).unwrap_or_default(),
                "report_text": row.try_get::<Option<String>, _>("report_text").unwrap_or_default(),
                "approval_status": approval_status,
                "notes": row.try_get::<Option<String>, _>("notes").unwrap_or_default(),
                "approved_by_name": row.try_get::<Option<String>, _>("approved_by_name").unwrap_or_default(),
                "approved_at": row.try_get::<Option<chrono::DateTime<chrono::Utc>>, _>("approved_at").unwrap_or_default().map(|value| value.to_rfc3339()),
                "created_at": row.try_get::<chrono::DateTime<chrono::Utc>, _>("created_at").map(|value| value.to_rfc3339()).unwrap_or_default(),
                "billing_leistung_id": billing_leistung_id.map(|value| value.to_string()),
                "billing_sync_status": billing_sync_status,
                "billing_service_key": billing_service_key,
            }))
            .into_response()
        }
        Ok(None) => Json(serde_json::Value::Null).into_response(),
        Err(e) => {
            tracing::error!(error = %e, "get report");
            err(StatusCode::INTERNAL_SERVER_ERROR, "Failed")
        }
    }
}

async fn approve_report(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(apt_id): Path<Uuid>,
) -> axum::response::Response {
    if let Err(e) =
        auth.require_any_role(&[Role::Ceo, Role::TeamleadInterpreter, Role::PatientManager])
    {
        return e;
    }
    match can_access_appointment(&state, &auth, apt_id, None, None, None).await {
        Ok(true) => {}
        Ok(false) => return err(StatusCode::FORBIDDEN, "Insufficient permissions"),
        Err(resp) => return resp,
    }
    match sqlx::query(
        r#"UPDATE interpreter_reports
           SET approval_status = 'approved', approved_by = $2, approved_at = now()
           WHERE appointment_id = $1
             AND approval_status = 'pending'"#,
    )
    .bind(apt_id)
    .bind(auth.user_id)
    .execute(&state.db)
    .await
    {
        Ok(r) if r.rows_affected() > 0 => {
            let sync_summary = match sync_interpreter_report_billing_candidates(
                &state,
                Some(apt_id),
            )
            .await
            {
                Ok(summary) => summary,
                Err(error) => {
                    tracing::error!(error = %error, appointment_id = %apt_id, "sync approved interpreter report to billing");
                    return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
                }
            };
            tracing::info!(
                by = %auth.user_id,
                apt = %apt_id,
                leistungen_created = sync_summary.leistungen_created,
                missing_order = sync_summary.missing_order,
                missing_catalog = sync_summary.missing_catalog,
                "Report approved"
            );
            Json(serde_json::json!({"ok": true})).into_response()
        }
        Ok(_) => err(StatusCode::NOT_FOUND, "No pending report"),
        Err(e) => {
            tracing::error!(error = %e, "approve report");
            err(StatusCode::INTERNAL_SERVER_ERROR, "Failed")
        }
    }
}

async fn reject_report(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(apt_id): Path<Uuid>,
    Json(body): Json<RejectReport>,
) -> axum::response::Response {
    if let Err(e) =
        auth.require_any_role(&[Role::Ceo, Role::TeamleadInterpreter, Role::PatientManager])
    {
        return e;
    }
    match can_access_appointment(&state, &auth, apt_id, None, None, None).await {
        Ok(true) => {}
        Ok(false) => return err(StatusCode::FORBIDDEN, "Insufficient permissions"),
        Err(resp) => return resp,
    }
    match sqlx::query!(
        "UPDATE interpreter_reports
         SET approval_status = 'rejected', approved_by = $2, approved_at = now(), notes = COALESCE($3, notes)
         WHERE appointment_id = $1 AND approval_status = 'pending'",
        apt_id,
        auth.user_id,
        body.notes
    )
    .execute(&state.db)
    .await
    {
        Ok(r) if r.rows_affected() > 0 => Json(serde_json::json!({"ok": true})).into_response(),
        Ok(_) => err(StatusCode::NOT_FOUND, "No pending report"),
        Err(e) => {
            tracing::error!(error = %e, appointment_id = %apt_id, "reject report");
            err(StatusCode::INTERNAL_SERVER_ERROR, "Failed")
        }
    }
}

async fn ensure_checklist_access(
    state: &AppState,
    auth: &AuthUser,
    appointment_id: Uuid,
) -> Result<(), axum::response::Response> {
    if matches!(auth.role, Role::Ceo | Role::PatientManager) {
        return Ok(());
    }

    if auth.role != Role::Concierge {
        return Err(err(StatusCode::FORBIDDEN, "Insufficient permissions"));
    }

    let row = sqlx::query("SELECT appointment_type FROM appointments WHERE id = $1")
        .bind(appointment_id)
        .fetch_optional(&state.db)
        .await
        .map_err(|e| {
            tracing::error!(error = %e, appointment_id = %appointment_id, "Failed to validate checklist access");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to validate checklist access",
            )
        })?;

    let Some(row) = row else {
        return Err(err(StatusCode::NOT_FOUND, "Appointment not found"));
    };

    let appointment_type: String = row.try_get("appointment_type").map_err(|_| {
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to validate checklist access",
        )
    })?;

    if appointment_type == "non_medical" {
        Ok(())
    } else {
        Err(err(
            StatusCode::FORBIDDEN,
            "Checklist is only available for non-medical concierge appointments",
        ))
    }
}

async fn load_appointment_communication_context(
    state: &AppState,
    appointment_id: Uuid,
) -> Result<Option<AppointmentCommunicationContext>, axum::response::Response> {
    let row = sqlx::query(
        r#"SELECT id, patient_id, provider_id, doctor_id, appointment_type, interpreter_id,
                  owner_user_id
           FROM appointments
           WHERE id = $1"#,
    )
    .bind(appointment_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, appointment_id = %appointment_id, "Failed to load appointment communication context");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to validate appointment communication access",
        )
    })?;

    let Some(row) = row else {
        return Ok(None);
    };

    Ok(Some(AppointmentCommunicationContext {
        appointment_id: row.try_get::<Uuid, _>("id").unwrap_or(appointment_id),
        patient_id: row.try_get::<Uuid, _>("patient_id").unwrap_or_default(),
        provider_id: row
            .try_get::<Option<Uuid>, _>("provider_id")
            .unwrap_or_default(),
        doctor_id: row
            .try_get::<Option<Uuid>, _>("doctor_id")
            .unwrap_or_default(),
        appointment_type: row
            .try_get::<String, _>("appointment_type")
            .unwrap_or_default(),
        interpreter_id: row
            .try_get::<Option<Uuid>, _>("interpreter_id")
            .unwrap_or_default(),
        owner_user_id: row
            .try_get::<Option<Uuid>, _>("owner_user_id")
            .unwrap_or_default(),
    }))
}

async fn ensure_appointment_communication_access(
    state: &AppState,
    auth: &AuthUser,
    appointment_id: Uuid,
    manage: bool,
) -> Result<AppointmentCommunicationContext, axum::response::Response> {
    let Some(context) = load_appointment_communication_context(state, appointment_id).await? else {
        return Err(err(StatusCode::NOT_FOUND, "Appointment not found"));
    };

    match can_access_appointment(
        state,
        auth,
        appointment_id,
        Some(context.patient_id),
        context.interpreter_id,
        context.owner_user_id,
    )
    .await
    {
        Ok(true) => {}
        Ok(false) => return Err(err(StatusCode::FORBIDDEN, "Insufficient permissions")),
        Err(resp) => return Err(resp),
    }

    if is_blocked_slot(auth, &context.appointment_type) {
        return Err(err(
            StatusCode::FORBIDDEN,
            "Blocked medical slots do not expose communication details",
        ));
    }

    if manage
        && !matches!(
            auth.role,
            Role::Ceo | Role::PatientManager | Role::TeamleadInterpreter | Role::Concierge
        )
    {
        return Err(err(StatusCode::FORBIDDEN, "Insufficient permissions"));
    }

    Ok(context)
}

async fn load_active_patient_role_users(
    state: &AppState,
    patient_id: Uuid,
    role: &str,
) -> Result<Vec<Uuid>, axum::response::Response> {
    sqlx::query(
        r#"SELECT u.id
           FROM patient_assignments pa
           JOIN users u ON u.id = pa.user_id
           WHERE pa.patient_id = $1
             AND pa.revoked_at IS NULL
             AND u.is_active = true
             AND u.role = $2
           ORDER BY u.name"#,
    )
    .bind(patient_id)
    .bind(role)
    .fetch_all(&state.db)
    .await
    .map(|rows| {
        rows.into_iter()
            .filter_map(|row| row.try_get::<Uuid, _>("id").ok())
            .collect::<Vec<_>>()
    })
    .map_err(|e| {
        tracing::error!(error = %e, patient_id = %patient_id, role = role, "Failed to load patient role users");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to load patient role users",
        )
    })
}

async fn insert_checklist_item(
    state: &AppState,
    appointment_id: Uuid,
    phase: &str,
    item_text: &str,
    sort_order: i32,
) -> Result<(), axum::response::Response> {
    sqlx::query(
        r#"INSERT INTO appointment_checklists (appointment_id, phase, item_text, sort_order)
           VALUES ($1, $2, $3, $4)"#,
    )
    .bind(appointment_id)
    .bind(phase)
    .bind(item_text)
    .bind(sort_order)
    .execute(&state.db)
    .await
    .map(|_| ())
    .map_err(|e| {
        tracing::error!(error = %e, appointment_id = %appointment_id, phase = phase, "Failed to create appointment checklist item");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to create appointment checklist item",
        )
    })
}

#[allow(clippy::too_many_arguments)]
async fn insert_task_record(
    state: &AppState,
    title: &str,
    description: Option<String>,
    assigned_to: Uuid,
    assigned_by: Uuid,
    patient_id: Uuid,
    appointment_id: Uuid,
    due_date: Option<chrono::DateTime<chrono::Utc>>,
    priority: &str,
) -> Result<(), axum::response::Response> {
    sqlx::query(
        r#"INSERT INTO tasks (
                title, description, assigned_to, assigned_by, patient_id, appointment_id,
                due_date, priority
           ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8
           )"#,
    )
    .bind(title)
    .bind(description)
    .bind(assigned_to)
    .bind(assigned_by)
    .bind(patient_id)
    .bind(appointment_id)
    .bind(due_date)
    .bind(priority)
    .execute(&state.db)
    .await
    .map(|_| ())
    .map_err(|e| {
        tracing::error!(error = %e, appointment_id = %appointment_id, assigned_to = %assigned_to, "Failed to create task record");
        err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to create task")
    })
}

fn appointment_due_at(
    date: chrono::NaiveDate,
    time_start: Option<chrono::NaiveTime>,
    fallback_hour: u32,
) -> chrono::DateTime<chrono::Utc> {
    let default_time = chrono::NaiveTime::from_hms_opt(fallback_hour, 0, 0)
        .unwrap_or_else(|| chrono::NaiveTime::from_hms_opt(9, 0, 0).expect("valid fallback"));
    chrono::DateTime::<chrono::Utc>::from_naive_utc_and_offset(
        date.and_time(time_start.unwrap_or(default_time)),
        chrono::Utc,
    )
}

async fn bootstrap_concierge_workflow(
    state: &AppState,
    assigned_by: Uuid,
    appointment_id: Uuid,
    patient_id: Uuid,
    title: &str,
    date: chrono::NaiveDate,
    time_start: Option<chrono::NaiveTime>,
) -> Result<(), axum::response::Response> {
    let concierges = load_active_patient_role_users(state, patient_id, "concierge").await?;
    if concierges.is_empty() {
        return Ok(());
    }

    let checklist_items = [
        ("preparation", "Confirm travel / service booking details"),
        (
            "preparation",
            "Coordinate provider, transfer, hotel or VIP service",
        ),
        (
            "execution",
            "Support patient during the concierge service window",
        ),
        (
            "followup",
            "Collect confirmations, receipts and handoff notes",
        ),
    ];

    for (index, (phase, item_text)) in checklist_items.into_iter().enumerate() {
        insert_checklist_item(state, appointment_id, phase, item_text, index as i32 + 1).await?;
    }

    let reminder_at = appointment_due_at(date, time_start, 9);
    let prep_due = appointment_due_at(date, time_start, 8);
    let followup_due = chrono::DateTime::<chrono::Utc>::from_naive_utc_and_offset(
        date.and_hms_opt(18, 0, 0)
            .unwrap_or(date.and_time(chrono::NaiveTime::MIN)),
        chrono::Utc,
    );

    for concierge_id in concierges {
        create_reminder_record(
            state,
            appointment_id,
            concierge_id,
            reminder_at,
            format!("Upcoming concierge service: {title}"),
            Some(format!(
                "Prepare non-medical support for appointment on {date}"
            )),
        )
        .await?;

        insert_task_record(
            state,
            &format!("Coordinate concierge service: {title}"),
            Some(
                "Confirm provider details, logistics and patient-facing service delivery"
                    .to_string(),
            ),
            concierge_id,
            assigned_by,
            patient_id,
            appointment_id,
            Some(prep_due),
            "high",
        )
        .await?;

        insert_task_record(
            state,
            &format!("Collect concierge receipts: {title}"),
            Some("Gather confirmations and receipts after the non-medical service".to_string()),
            concierge_id,
            assigned_by,
            patient_id,
            appointment_id,
            Some(followup_due),
            "normal",
        )
        .await?;
    }

    Ok(())
}

async fn bootstrap_billing_handoff(
    state: &AppState,
    assigned_by: Uuid,
    appointment_id: Uuid,
) -> Result<(), axum::response::Response> {
    let row = sqlx::query(
        r#"SELECT patient_id, appointment_type, title
           FROM appointments
           WHERE id = $1"#,
    )
    .bind(appointment_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, appointment_id = %appointment_id, "Failed to load appointment for billing handoff");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to load appointment for billing handoff",
        )
    })?;

    let Some(row) = row else {
        return Ok(());
    };

    let appointment_type: String = row.try_get("appointment_type").unwrap_or_default();
    if appointment_type != "non_medical" {
        return Ok(());
    }

    let patient_id: Uuid = row.try_get("patient_id").map_err(|_| {
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to decode billing handoff appointment",
        )
    })?;
    let title: String = row
        .try_get("title")
        .unwrap_or_else(|_| "Concierge service".to_string());

    let billing_user = sqlx::query(
        r#"SELECT id
           FROM users
           WHERE is_active = true
             AND role = 'billing'
           ORDER BY created_at
           LIMIT 1"#,
    )
    .fetch_optional(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, appointment_id = %appointment_id, "Failed to load billing user");
        err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to load billing user")
    })?;

    let Some(billing_user) = billing_user else {
        return Ok(());
    };

    let billing_user_id: Uuid = billing_user.try_get("id").map_err(|_| {
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to load billing user",
        )
    })?;

    let already_exists = sqlx::query(
        r#"SELECT 1
           FROM tasks
           WHERE appointment_id = $1
             AND assigned_to = $2
             AND title = $3
           LIMIT 1"#,
    )
    .bind(appointment_id)
    .bind(billing_user_id)
    .bind(format!("Billing handoff: {title}"))
    .fetch_optional(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, appointment_id = %appointment_id, "Failed to check billing handoff task");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to validate billing handoff task",
        )
    })?;

    if already_exists.is_some() {
        return Ok(());
    }

    insert_task_record(
        state,
        &format!("Billing handoff: {title}"),
        Some(
            "Review concierge costs, confirmations and receipts after service completion"
                .to_string(),
        ),
        billing_user_id,
        assigned_by,
        patient_id,
        appointment_id,
        Some(chrono::Utc::now()),
        "normal",
    )
    .await
}

fn is_blocked_slot(auth: &AuthUser, appointment_type: &str) -> bool {
    auth.role == Role::Concierge && appointment_type == "medical"
}

fn build_appointment_list_json(
    auth: &AuthUser,
    row: &sqlx::postgres::PgRow,
    appointment_id: Uuid,
    patient_id: Uuid,
) -> serde_json::Value {
    let appointment_type = row
        .try_get::<String, _>("appointment_type")
        .unwrap_or_default();
    let blocked = is_blocked_slot(auth, &appointment_type);
    let patient_name = format!(
        "{} {}",
        row.try_get::<String, _>("first_name").unwrap_or_default(),
        row.try_get::<String, _>("last_name").unwrap_or_default()
    );

    serde_json::json!({
        "id": appointment_id,
        "title": if blocked {
            "Blocked medical slot".to_string()
        } else {
            row.try_get::<String, _>("title").unwrap_or_default()
        },
        "date": row.try_get::<chrono::NaiveDate, _>("date").map(|v| v.to_string()).unwrap_or_default(),
        "time_start": row.try_get::<Option<chrono::NaiveTime>, _>("time_start").unwrap_or_default().map(|v| v.format("%H:%M").to_string()),
        "time_end": row.try_get::<Option<chrono::NaiveTime>, _>("time_end").unwrap_or_default().map(|v| v.format("%H:%M").to_string()),
        "type": appointment_type,
        "care_path_kind": if blocked { None::<String> } else { Some(row.try_get::<String, _>("care_path_kind").unwrap_or_else(|_| "regular".to_string())) },
        "status": row.try_get::<String, _>("status").unwrap_or_default(),
        "location": if blocked { None::<String> } else { row.try_get::<Option<String>, _>("location").unwrap_or_default() },
        "interpreter_response": if blocked { None::<String> } else { row.try_get::<Option<String>, _>("interpreter_response").unwrap_or_default() },
        "checklist_phase": if blocked { String::new() } else { row.try_get::<String, _>("checklist_phase").unwrap_or_default() },
        "patient_id": patient_id,
        "patient_name": patient_name,
        "patient_pid": row.try_get::<String, _>("patient_code").unwrap_or_default(),
        "provider_id": if blocked { None::<Uuid> } else { row.try_get::<Option<Uuid>, _>("provider_id").unwrap_or_default() },
        "provider_name": if blocked { None::<String> } else { row.try_get::<Option<String>, _>("provider_name").unwrap_or_default() },
        "doctor_id": if blocked { None::<Uuid> } else { row.try_get::<Option<Uuid>, _>("doctor_id").unwrap_or_default() },
        "doctor_name": if blocked { None::<String> } else { row.try_get::<Option<String>, _>("doctor_name").unwrap_or_default() },
        "owner_user_id": if blocked { None::<Uuid> } else { row.try_get::<Option<Uuid>, _>("owner_user_id").unwrap_or_default() },
        "owner_name": if blocked { None::<String> } else { row.try_get::<Option<String>, _>("owner_name").unwrap_or_default() },
        "owner_role": if blocked { None::<String> } else { row.try_get::<Option<String>, _>("owner_role").unwrap_or_default() },
        "interpreter_id": if blocked { None::<Uuid> } else { row.try_get::<Option<Uuid>, _>("interpreter_id").unwrap_or_default() },
        "interpreter_name": if blocked { None::<String> } else { row.try_get::<Option<String>, _>("interpreter_name").unwrap_or_default() },
        "recurrence_series_id": if blocked { None::<Uuid> } else { row.try_get::<Option<Uuid>, _>("recurrence_series_id").unwrap_or_default() },
        "recurrence_frequency": if blocked { None::<String> } else { row.try_get::<Option<String>, _>("recurrence_frequency").unwrap_or_default() },
        "recurrence_interval": if blocked { None::<i32> } else { row.try_get::<Option<i32>, _>("recurrence_interval").unwrap_or_default() },
        "recurrence_count": if blocked { None::<i32> } else { row.try_get::<Option<i32>, _>("recurrence_count").unwrap_or_default() },
        "recurrence_until": if blocked { None::<String> } else { row.try_get::<Option<chrono::NaiveDate>, _>("recurrence_until").unwrap_or_default().map(|v| v.to_string()) },
        "recurrence_index": if blocked { 0 } else { row.try_get::<i32, _>("recurrence_index").unwrap_or(0) },
        "recurrence_series_size": if blocked { 1 } else { row.try_get::<i64, _>("recurrence_series_size").map(|value| value as i32).unwrap_or(1) },
        "is_blocked": blocked,
        "visibility_mode": if blocked { "blocked" } else { "full" },
    })
}

fn build_appointment_detail_json(
    auth: &AuthUser,
    row: &sqlx::postgres::PgRow,
    appointment_id: Uuid,
    patient_id: Uuid,
    interpreter_id: Option<Uuid>,
    recurring_scope_preview: Vec<serde_json::Value>,
    recurring_lineage_history: Vec<serde_json::Value>,
) -> serde_json::Value {
    let appointment_type = row
        .try_get::<String, _>("appointment_type")
        .unwrap_or_default();
    let blocked = is_blocked_slot(auth, &appointment_type);
    let patient_name = format!(
        "{} {}",
        row.try_get::<String, _>("first_name").unwrap_or_default(),
        row.try_get::<String, _>("last_name").unwrap_or_default()
    );

    serde_json::json!({
        "id": appointment_id,
        "title": if blocked { "Blocked medical slot".to_string() } else { row.try_get::<String, _>("title").unwrap_or_default() },
        "date": row.try_get::<chrono::NaiveDate, _>("date").map(|v| v.to_string()).unwrap_or_default(),
        "time_start": row.try_get::<Option<chrono::NaiveTime>, _>("time_start").unwrap_or_default().map(|v| v.format("%H:%M").to_string()),
        "time_end": row.try_get::<Option<chrono::NaiveTime>, _>("time_end").unwrap_or_default().map(|v| v.format("%H:%M").to_string()),
        "type": appointment_type,
        "care_path_kind": if blocked { None::<String> } else { Some(row.try_get::<String, _>("care_path_kind").unwrap_or_else(|_| "regular".to_string())) },
        "status": row.try_get::<String, _>("status").unwrap_or_default(),
        "location": if blocked { None::<String> } else { row.try_get::<Option<String>, _>("location").unwrap_or_default() },
        "category": if blocked { None::<String> } else { row.try_get::<Option<String>, _>("category").unwrap_or_default() },
        "interpreter_id": if blocked { None::<Uuid> } else { interpreter_id },
        "interpreter_name": if blocked { None::<String> } else { row.try_get::<Option<String>, _>("interpreter_name").unwrap_or_default() },
        "interpreter_response": if blocked { None::<String> } else { row.try_get::<Option<String>, _>("interpreter_response").unwrap_or_default() },
        "checklist_phase": if blocked { String::new() } else { row.try_get::<String, _>("checklist_phase").unwrap_or_default() },
        "preparation_notes": if blocked { None::<String> } else { row.try_get::<Option<String>, _>("preparation_notes").unwrap_or_default() },
        "followup_notes": if blocked { None::<String> } else { row.try_get::<Option<String>, _>("followup_notes").unwrap_or_default() },
        "notes": if blocked { None::<String> } else { row.try_get::<Option<String>, _>("notes").unwrap_or_default() },
        "patient_id": patient_id,
        "patient_name": patient_name,
        "patient_pid": row.try_get::<String, _>("patient_code").unwrap_or_default(),
        "provider_id": if blocked { None::<Uuid> } else { row.try_get::<Option<Uuid>, _>("provider_id").unwrap_or_default() },
        "provider_name": if blocked { None::<String> } else { row.try_get::<Option<String>, _>("provider_name").unwrap_or_default() },
        "doctor_id": if blocked { None::<Uuid> } else { row.try_get::<Option<Uuid>, _>("doctor_id").unwrap_or_default() },
        "doctor_name": if blocked { None::<String> } else { row.try_get::<Option<String>, _>("doctor_name").unwrap_or_default() },
        "owner_user_id": if blocked { None::<Uuid> } else { row.try_get::<Option<Uuid>, _>("owner_user_id").unwrap_or_default() },
        "owner_name": if blocked { None::<String> } else { row.try_get::<Option<String>, _>("owner_name").unwrap_or_default() },
        "owner_role": if blocked { None::<String> } else { row.try_get::<Option<String>, _>("owner_role").unwrap_or_default() },
        "order_id": if blocked { None::<Uuid> } else { row.try_get::<Option<Uuid>, _>("order_id").unwrap_or_default() },
        "order_number": if blocked { None::<String> } else { row.try_get::<Option<String>, _>("order_number").unwrap_or_default() },
        "recurrence_series_id": if blocked { None::<Uuid> } else { row.try_get::<Option<Uuid>, _>("recurrence_series_id").unwrap_or_default() },
        "recurrence_frequency": if blocked { None::<String> } else { row.try_get::<Option<String>, _>("recurrence_frequency").unwrap_or_default() },
        "recurrence_interval": if blocked { None::<i32> } else { row.try_get::<Option<i32>, _>("recurrence_interval").unwrap_or_default() },
        "recurrence_count": if blocked { None::<i32> } else { row.try_get::<Option<i32>, _>("recurrence_count").unwrap_or_default() },
        "recurrence_until": if blocked { None::<String> } else { row.try_get::<Option<chrono::NaiveDate>, _>("recurrence_until").unwrap_or_default().map(|v| v.to_string()) },
        "recurrence_index": if blocked { 0 } else { row.try_get::<i32, _>("recurrence_index").unwrap_or(0) },
        "recurrence_series_size": if blocked { 1 } else { row.try_get::<i64, _>("recurrence_series_size").map(|value| value as i32).unwrap_or(1) },
        "recurrence_parent_series_id": if blocked { None::<Uuid> } else { row.try_get::<Option<Uuid>, _>("recurrence_parent_series_id").unwrap_or_default() },
        "recurrence_split_from_appointment_id": if blocked { None::<Uuid> } else { row.try_get::<Option<Uuid>, _>("recurrence_split_from_appointment_id").unwrap_or_default() },
        "recurrence_split_from_index": if blocked { None::<i32> } else { row.try_get::<Option<i32>, _>("recurrence_split_from_index").unwrap_or_default() },
        "recurring_scope_preview": if blocked { Vec::<serde_json::Value>::new() } else { recurring_scope_preview },
        "recurring_lineage_history": if blocked { Vec::<serde_json::Value>::new() } else { recurring_lineage_history },
        "created_at": row.try_get::<chrono::DateTime<chrono::Utc>, _>("created_at").map(|v| v.to_rfc3339()).unwrap_or_default(),
        "is_blocked": blocked,
        "visibility_mode": if blocked { "blocked" } else { "full" },
    })
}

async fn load_active_interpreter_role(
    state: &AppState,
    user_id: Uuid,
) -> Result<Option<String>, axum::response::Response> {
    match load_active_user_role(state, user_id).await? {
        Some(role) if matches!(role.as_str(), "interpreter" | "teamlead_interpreter") => {
            Ok(Some(role))
        }
        _ => Ok(None),
    }
}

async fn load_active_appointment_owner_role(
    state: &AppState,
    user_id: Uuid,
) -> Result<Option<String>, axum::response::Response> {
    match load_active_user_role(state, user_id).await? {
        Some(role)
            if matches!(
                role.as_str(),
                "patient_manager" | "teamlead_interpreter" | "interpreter" | "concierge"
            ) =>
        {
            Ok(Some(role))
        }
        _ => Ok(None),
    }
}

#[allow(clippy::result_large_err)]
fn validate_owner_assignment_rules(
    auth: &AuthUser,
    owner_user_id: Uuid,
    owner_role: &str,
) -> Result<(), axum::response::Response> {
    match auth.role {
        Role::Ceo | Role::PatientManager => Ok(()),
        Role::TeamleadInterpreter => {
            if owner_user_id == auth.user_id
                || matches!(owner_role, "interpreter" | "teamlead_interpreter")
            {
                Ok(())
            } else {
                Err(err(
                    StatusCode::FORBIDDEN,
                    "Teamlead can only assign ownership to self or interpreters",
                ))
            }
        }
        Role::Concierge => {
            if owner_user_id == auth.user_id && owner_role == "concierge" {
                Ok(())
            } else {
                Err(err(
                    StatusCode::FORBIDDEN,
                    "Concierge can only assign ownership to self",
                ))
            }
        }
        _ => Err(err(StatusCode::FORBIDDEN, "Insufficient permissions")),
    }
}

fn resolve_owner_user_id_for_write(auth: &AuthUser, owner_user_id: Option<Uuid>) -> Option<Uuid> {
    owner_user_id.or(match auth.role {
        Role::TeamleadInterpreter | Role::Concierge => Some(auth.user_id),
        _ => None,
    })
}

fn normalize_optional_text(value: Option<String>) -> Option<String> {
    match value {
        Some(raw) => {
            let trimmed = raw.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            }
        }
        None => None,
    }
}

fn parse_optional_time(value: Option<&str>) -> Result<Option<chrono::NaiveTime>, &'static str> {
    match value {
        Some(raw) if !raw.trim().is_empty() => chrono::NaiveTime::parse_from_str(raw, "%H:%M")
            .map(Some)
            .map_err(|_| "Invalid time (HH:MM)"),
        _ => Ok(None),
    }
}

fn build_schedule_summary(
    date: chrono::NaiveDate,
    time_start: Option<chrono::NaiveTime>,
    time_end: Option<chrono::NaiveTime>,
) -> String {
    match (time_start, time_end) {
        (Some(time_start), Some(time_end)) => format!(
            "Appointment on {} from {} to {}",
            date,
            time_start.format("%H:%M"),
            time_end.format("%H:%M")
        ),
        (Some(time_start), None) => {
            format!("Appointment on {} at {}", date, time_start.format("%H:%M"))
        }
        _ => format!("Appointment on {date}"),
    }
}

fn overlaps(
    target_start: Option<chrono::NaiveTime>,
    target_end: Option<chrono::NaiveTime>,
    other_start: Option<chrono::NaiveTime>,
    other_end: Option<chrono::NaiveTime>,
) -> bool {
    let target_all_day = target_start.is_none() && target_end.is_none();
    let other_all_day = other_start.is_none() && other_end.is_none();
    if target_all_day && other_all_day {
        return true;
    }

    match (target_start, target_end, other_start, other_end) {
        (Some(target_start), Some(target_end), Some(other_start), Some(other_end)) => {
            target_start < other_end && other_start < target_end
        }
        _ => false,
    }
}

fn appointment_lock_key(namespace: u8, resource_id: Uuid, date: chrono::NaiveDate) -> i64 {
    let mut hasher = Sha256::new();
    hasher.update([namespace]);
    hasher.update(resource_id.as_bytes());
    hasher.update(date.to_string().as_bytes());

    let digest = hasher.finalize();
    let mut bytes = [0u8; 8];
    bytes.copy_from_slice(&digest[..8]);
    i64::from_be_bytes(bytes)
}

async fn acquire_appointment_schedule_locks(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    patient_id: Uuid,
    interpreter_id: Option<Uuid>,
    doctor_id: Option<Uuid>,
    date: chrono::NaiveDate,
) -> Result<(), axum::response::Response> {
    let mut keys = vec![appointment_lock_key(1, patient_id, date)];
    if let Some(interpreter_id) = interpreter_id {
        keys.push(appointment_lock_key(2, interpreter_id, date));
    }
    if let Some(doctor_id) = doctor_id {
        keys.push(appointment_lock_key(3, doctor_id, date));
    }
    keys.sort_unstable();
    keys.dedup();

    for key in keys {
        sqlx::query("SELECT pg_advisory_xact_lock($1)")
            .bind(key)
            .execute(&mut **tx)
            .await
            .map_err(|e| {
                tracing::error!(error = %e, advisory_key = key, date = %date, "acquire appointment advisory lock");
                err(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Failed to validate appointment schedule",
                )
            })?;
    }

    Ok(())
}

#[allow(clippy::too_many_arguments)]
async fn ensure_no_overlapping_appointments_in_tx(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    patient_id: Uuid,
    interpreter_id: Option<Uuid>,
    doctor_id: Option<Uuid>,
    date: chrono::NaiveDate,
    time_start: Option<chrono::NaiveTime>,
    time_end: Option<chrono::NaiveTime>,
    exclude_appointment_ids: &[Uuid],
) -> Result<(), axum::response::Response> {
    let rows = sqlx::query(
        r#"SELECT id, patient_id, interpreter_id, doctor_id, time_start, time_end
           FROM appointments
           WHERE date = $1
             AND status <> 'cancelled'
              AND (
                 patient_id = $2
                 OR ($3::uuid IS NOT NULL AND interpreter_id = $3)
                 OR ($4::uuid IS NOT NULL AND doctor_id = $4)
              )
              AND NOT (id = ANY($5))
            FOR UPDATE"#,
    )
    .bind(date)
    .bind(patient_id)
    .bind(interpreter_id)
    .bind(doctor_id)
    .bind(exclude_appointment_ids)
    .fetch_all(&mut **tx)
    .await
    .map_err(|e| {
        tracing::error!(
            error = %e,
            patient_id = %patient_id,
            interpreter_id = ?interpreter_id,
            doctor_id = ?doctor_id,
            date = %date,
            "load blocking appointment conflicts"
        );
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to validate appointment schedule",
        )
    })?;

    for row in rows {
        let other_start = row
            .try_get::<Option<chrono::NaiveTime>, _>("time_start")
            .unwrap_or_default();
        let other_end = row
            .try_get::<Option<chrono::NaiveTime>, _>("time_end")
            .unwrap_or_default();
        if !overlaps(time_start, time_end, other_start, other_end) {
            continue;
        }

        let mut scopes = Vec::new();
        if row
            .try_get::<Uuid, _>("patient_id")
            .unwrap_or_else(|_| Uuid::nil())
            == patient_id
        {
            scopes.push("patient");
        }
        if interpreter_id.is_some()
            && row
                .try_get::<Option<Uuid>, _>("interpreter_id")
                .unwrap_or_default()
                == interpreter_id
        {
            scopes.push("interpreter");
        }
        if doctor_id.is_some()
            && row
                .try_get::<Option<Uuid>, _>("doctor_id")
                .unwrap_or_default()
                == doctor_id
        {
            scopes.push("doctor");
        }
        scopes.sort_unstable();
        scopes.dedup();

        let message = if scopes.is_empty() {
            "Appointment conflicts with an existing booking".to_string()
        } else {
            format!(
                "Appointment conflicts with an existing {} booking",
                scopes.join("/")
            )
        };
        return Err(err(StatusCode::CONFLICT, &message));
    }

    Ok(())
}

fn can_access_appointment_row(
    auth: &AuthUser,
    patient_id: Uuid,
    interpreter_id: Option<Uuid>,
    owner_user_id: Option<Uuid>,
    assignment_set: Option<&HashSet<Uuid>>,
) -> bool {
    if auth.role == Role::Ceo {
        return true;
    }
    if matches!(auth.role, Role::Interpreter | Role::TeamleadInterpreter)
        && interpreter_id == Some(auth.user_id)
    {
        return true;
    }
    if matches!(
        auth.role,
        Role::PatientManager | Role::TeamleadInterpreter | Role::Concierge
    ) && owner_user_id == Some(auth.user_id)
    {
        return true;
    }
    if access::requires_patient_assignment(auth.role) {
        return assignment_set
            .map(|value| value.contains(&patient_id))
            .unwrap_or(false);
    }

    true
}

#[allow(clippy::too_many_arguments)]
async fn load_conflicts_for_scope(
    state: &AppState,
    auth: &AuthUser,
    patient_id: Option<Uuid>,
    interpreter_id: Option<Uuid>,
    date: chrono::NaiveDate,
    time_start: Option<chrono::NaiveTime>,
    time_end: Option<chrono::NaiveTime>,
    exclude_appointment_id: Option<Uuid>,
) -> Result<Vec<serde_json::Value>, axum::response::Response> {
    if patient_id.is_none() && interpreter_id.is_none() {
        return Ok(Vec::new());
    }

    let rows = sqlx::query(
        r#"SELECT a.id, a.title, a.date, a.time_start, a.time_end, a.appointment_type, a.care_path_kind, a.status,
                  a.location, a.interpreter_response, a.checklist_phase, a.patient_id, a.interpreter_id,
                  a.provider_id, a.doctor_id, a.owner_user_id,
                  p.first_name, p.last_name, p.patient_id AS patient_code,
                  pr.name AS provider_name,
                  d.name AS doctor_name,
                  u.name AS interpreter_name,
                  owner.name AS owner_name,
                  owner.role AS owner_role
           FROM appointments a
           JOIN patients p ON p.id = a.patient_id
           LEFT JOIN providers pr ON pr.id = a.provider_id
           LEFT JOIN provider_doctors d ON d.id = a.doctor_id
           LEFT JOIN users u ON u.id = a.interpreter_id
           LEFT JOIN users owner ON owner.id = a.owner_user_id
           WHERE a.date = $1
             AND a.status <> 'cancelled'
             AND ($2::uuid IS NULL OR a.patient_id = $2)
             AND ($3::uuid IS NULL OR a.interpreter_id = $3)
             AND ($4::uuid IS NULL OR a.id <> $4)
           ORDER BY a.time_start NULLS FIRST, a.created_at"#,
    )
    .bind(date)
    .bind(patient_id)
    .bind(interpreter_id)
    .bind(exclude_appointment_id)
    .fetch_all(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(
            error = %e,
            patient_id = ?patient_id,
            interpreter_id = ?interpreter_id,
            date = %date,
            "Failed to load appointment conflicts"
        );
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to load appointment conflicts",
        )
    })?;

    let mut conflicts = Vec::with_capacity(rows.len());
    for row in rows {
        let other_start = row
            .try_get::<Option<chrono::NaiveTime>, _>("time_start")
            .unwrap_or_default();
        let other_end = row
            .try_get::<Option<chrono::NaiveTime>, _>("time_end")
            .unwrap_or_default();
        if !overlaps(time_start, time_end, other_start, other_end) {
            continue;
        }

        let appointment_id = row.try_get::<Uuid, _>("id").map_err(|_| {
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to decode conflict",
            )
        })?;
        let patient_id = row.try_get::<Uuid, _>("patient_id").map_err(|_| {
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to decode conflict patient",
            )
        })?;

        conflicts.push(build_appointment_list_json(
            auth,
            &row,
            appointment_id,
            patient_id,
        ));
    }

    Ok(conflicts)
}

#[allow(clippy::too_many_arguments)]
async fn build_conflicts_payload(
    state: &AppState,
    auth: &AuthUser,
    patient_id: Uuid,
    interpreter_id: Option<Uuid>,
    date: chrono::NaiveDate,
    time_start: Option<chrono::NaiveTime>,
    time_end: Option<chrono::NaiveTime>,
    exclude_appointment_id: Option<Uuid>,
) -> Result<serde_json::Value, axum::response::Response> {
    let patient_conflicts = load_conflicts_for_scope(
        state,
        auth,
        Some(patient_id),
        None,
        date,
        time_start,
        time_end,
        exclude_appointment_id,
    )
    .await?;

    let interpreter_conflicts = match interpreter_id {
        Some(interpreter_id) => {
            load_conflicts_for_scope(
                state,
                auth,
                None,
                Some(interpreter_id),
                date,
                time_start,
                time_end,
                exclude_appointment_id,
            )
            .await?
        }
        None => Vec::new(),
    };

    let patient_conflict_count = patient_conflicts.len();
    let interpreter_conflict_count = interpreter_conflicts.len();

    Ok(serde_json::json!({
        "patient_conflict_count": patient_conflict_count,
        "interpreter_conflict_count": interpreter_conflict_count,
        "has_conflicts": patient_conflict_count > 0 || interpreter_conflict_count > 0,
        "patient_conflicts": patient_conflicts,
        "interpreter_conflicts": interpreter_conflicts,
    }))
}

async fn load_active_user_role(
    state: &AppState,
    user_id: Uuid,
) -> Result<Option<String>, axum::response::Response> {
    let row = sqlx::query("SELECT role FROM users WHERE id = $1 AND is_active = true")
        .bind(user_id)
        .fetch_optional(&state.db)
        .await
        .map_err(|e| {
            tracing::error!(error = %e, user_id = %user_id, "Failed to load user role");
            err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to validate user")
        })?;

    let Some(row) = row else {
        return Ok(None);
    };

    let role: String = row
        .try_get("role")
        .map_err(|_| err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to validate user"))?;

    if matches!(
        role.as_str(),
        "interpreter" | "teamlead_interpreter" | "patient_manager" | "concierge" | "ceo"
    ) {
        Ok(Some(role))
    } else {
        Ok(None)
    }
}

async fn create_reminder_record(
    state: &AppState,
    appointment_id: Uuid,
    user_id: Uuid,
    remind_at: chrono::DateTime<chrono::Utc>,
    title: String,
    description: Option<String>,
) -> Result<Uuid, axum::response::Response> {
    sqlx::query(
        "INSERT INTO reminders (appointment_id, user_id, remind_at, title, description)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id",
    )
    .bind(appointment_id)
    .bind(user_id)
    .bind(remind_at)
    .bind(title)
    .bind(description)
    .fetch_one(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, appointment_id = %appointment_id, user_id = %user_id, "Failed to create reminder");
        err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to create reminder")
    })?
    .try_get("id")
    .map_err(|_| err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to create reminder"))
}

async fn validate_provider_doctor_context(
    state: &AppState,
    provider_id: Option<Uuid>,
    doctor_id: Option<Uuid>,
) -> Result<(), axum::response::Response> {
    match (provider_id, doctor_id) {
        (None, Some(_)) => Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "doctor_id requires provider_id",
        )),
        (Some(provider_id), Some(doctor_id)) => {
            let row = sqlx::query("SELECT id FROM provider_doctors WHERE provider_id = $1 AND id = $2")
                .bind(provider_id)
                .bind(doctor_id)
                .fetch_optional(&state.db)
                .await
                .map_err(|e| {
                    tracing::error!(error = %e, provider_id = %provider_id, doctor_id = %doctor_id, "Failed to validate provider doctor");
                    err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to validate provider doctor")
                })?;

            if row.is_some() {
                Ok(())
            } else {
                Err(err(
                    StatusCode::UNPROCESSABLE_ENTITY,
                    "Doctor does not belong to provider",
                ))
            }
        }
        (Some(provider_id), None) => {
            let row = sqlx::query("SELECT id FROM providers WHERE id = $1")
                .bind(provider_id)
                .fetch_optional(&state.db)
                .await
                .map_err(|e| {
                    tracing::error!(error = %e, provider_id = %provider_id, "Failed to validate provider");
                    err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to validate provider")
                })?;

            if row.is_some() {
                Ok(())
            } else {
                Err(err(StatusCode::UNPROCESSABLE_ENTITY, "Provider not found"))
            }
        }
        (None, None) => Ok(()),
    }
}

fn err(status: StatusCode, message: &str) -> axum::response::Response {
    (status, Json(serde_json::json!({ "error": status.canonical_reason().unwrap_or("error"), "message": message }))).into_response()
}

async fn ensure_patient_access(
    state: &AppState,
    auth: &AuthUser,
    patient_id: Uuid,
) -> Result<(), axum::response::Response> {
    if auth.role == Role::Ceo {
        return Ok(());
    }

    let assigned = access::has_active_patient_assignment(&state.db, patient_id, auth.user_id)
        .await
        .map_err(|e| {
            tracing::error!(error = %e, patient_id = %patient_id, "Failed to validate patient assignment");
            err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to validate appointment access")
        })?;

    if assigned {
        Ok(())
    } else {
        Err(err(StatusCode::FORBIDDEN, "Insufficient permissions"))
    }
}

async fn can_access_appointment(
    state: &AppState,
    auth: &AuthUser,
    appointment_id: Uuid,
    patient_id: Option<Uuid>,
    interpreter_id: Option<Uuid>,
    owner_user_id: Option<Uuid>,
) -> Result<bool, axum::response::Response> {
    if auth.role == Role::Ceo {
        return Ok(true);
    }

    let Some(patient_id) = patient_id else {
        let row = sqlx::query("SELECT patient_id, interpreter_id, owner_user_id FROM appointments WHERE id = $1")
            .bind(appointment_id)
            .fetch_optional(&state.db)
            .await
            .map_err(|e| {
                tracing::error!(error = %e, appointment_id = %appointment_id, "Failed to load appointment access context");
                err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to validate appointment access")
            })?;

        let Some(row) = row else {
            return Ok(false);
        };

        let row_interpreter_id: Option<Uuid> = row.try_get("interpreter_id").map_err(|_| {
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to decode appointment access context",
            )
        })?;
        if matches!(auth.role, Role::Interpreter | Role::TeamleadInterpreter)
            && row_interpreter_id == Some(auth.user_id)
        {
            return Ok(true);
        }
        let row_owner_user_id: Option<Uuid> = row.try_get("owner_user_id").map_err(|_| {
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to decode appointment access context",
            )
        })?;
        if matches!(
            auth.role,
            Role::PatientManager | Role::TeamleadInterpreter | Role::Concierge
        ) && row_owner_user_id == Some(auth.user_id)
        {
            return Ok(true);
        }

        let patient_id: Uuid = row.try_get("patient_id").map_err(|_| {
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to decode appointment access context",
            )
        })?;

        if access::requires_patient_assignment(auth.role) {
            return access::has_active_patient_assignment(&state.db, patient_id, auth.user_id)
                .await
                .map_err(|e| {
                    tracing::error!(error = %e, appointment_id = %appointment_id, "Failed to validate appointment assignment");
                    err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to validate appointment access")
                });
        }

        return Ok(true);
    };

    if matches!(auth.role, Role::Interpreter | Role::TeamleadInterpreter)
        && interpreter_id == Some(auth.user_id)
    {
        return Ok(true);
    }
    if matches!(
        auth.role,
        Role::PatientManager | Role::TeamleadInterpreter | Role::Concierge
    ) && owner_user_id == Some(auth.user_id)
    {
        return Ok(true);
    }

    if access::requires_patient_assignment(auth.role) {
        access::has_active_patient_assignment(&state.db, patient_id, auth.user_id)
            .await
            .map_err(|e| {
                tracing::error!(error = %e, patient_id = %patient_id, "Failed to validate appointment assignment");
                err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to validate appointment access")
            })
    } else {
        Ok(true)
    }
}
