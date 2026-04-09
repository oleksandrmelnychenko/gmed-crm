use axum::{
    Json, Router,
    extract::{Extension, Path, Query, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::access;
use crate::auth::middleware::AuthUser;
use crate::state::AppState;
use gmed_domain::role::Role;
use sqlx::Row;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/appointments/meta/interpreters", get(list_interpreters))
        .route("/appointments/meta/staff", get(list_staff))
        .route("/appointments/meta/conflicts", get(get_conflicts))
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
    title: String,
    date: String,
    time_start: Option<String>,
    time_end: Option<String>,
    location: Option<String>,
    category: Option<String>,
    notes: Option<String>,
}

#[derive(Deserialize)]
struct UpdateAppointment {
    provider_id: Option<Uuid>,
    doctor_id: Option<Uuid>,
    owner_user_id: Option<Uuid>,
    interpreter_id: Option<Uuid>,
    title: String,
    date: String,
    time_start: Option<String>,
    time_end: Option<String>,
    location: Option<String>,
}

#[derive(Deserialize)]
struct StatusUpdate {
    status: String,
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
struct RejectReport {
    notes: Option<String>,
}

#[derive(Deserialize)]
struct ListAppointmentsQuery {
    search: Option<String>,
    appointment_type: Option<String>,
    status: Option<String>,
    patient_id: Option<Uuid>,
    provider_id: Option<Uuid>,
    doctor_id: Option<Uuid>,
    owner_user_id: Option<Uuid>,
    interpreter_id: Option<Uuid>,
    date_from: Option<String>,
    date_to: Option<String>,
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

    match sqlx::query(
        r#"SELECT a.id, a.title, a.date, a.time_start, a.time_end, a.appointment_type, a.status,
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
             AND ($3::text IS NULL OR a.status = $3)
             AND ($4::uuid IS NULL OR a.patient_id = $4)
             AND ($5::uuid IS NULL OR a.provider_id = $5)
             AND ($6::uuid IS NULL OR a.doctor_id = $6)
             AND ($7::uuid IS NULL OR a.owner_user_id = $7)
             AND ($8::uuid IS NULL OR a.interpreter_id = $8)
             AND ($9::date IS NULL OR a.date >= $9)
             AND ($10::date IS NULL OR a.date <= $10)
           ORDER BY a.date DESC, a.time_start
           LIMIT 200"#,
    )
    .bind(search_pattern)
    .bind(query.appointment_type)
    .bind(query.status)
    .bind(query.patient_id)
    .bind(query.provider_id)
    .bind(query.doctor_id)
    .bind(query.owner_user_id)
    .bind(query.interpreter_id)
    .bind(date_from)
    .bind(date_to)
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
                    Ok(false) => continue,
                    Err(resp) => return resp,
                }

                items.push(build_appointment_list_json(&auth, &r, appointment_id, patient_id));
            }
            Json(items).into_response()
        }
        Err(e) => { tracing::error!(error = %e, "list appointments"); err(StatusCode::INTERNAL_SERVER_ERROR, "Failed") }
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

    let CreateAppointment {
        patient_id,
        provider_id,
        doctor_id,
        owner_user_id,
        interpreter_id,
        order_id,
        appointment_type,
        title,
        date: _,
        time_start: _,
        time_end: _,
        location,
        category,
        notes,
    } = body;
    let owner_user_id = resolve_owner_user_id_for_write(&auth, owner_user_id);

    match sqlx::query(
        "INSERT INTO appointments (patient_id, provider_id, doctor_id, owner_user_id, interpreter_id, order_id, appointment_type, title, date, time_start, time_end, location, category, notes, created_by, interpreter_response)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
         RETURNING id, created_at",
    )
    .bind(patient_id)
    .bind(provider_id)
    .bind(doctor_id)
    .bind(owner_user_id)
    .bind(interpreter_id)
    .bind(order_id)
    .bind(&appointment_type)
    .bind(&title)
    .bind(date)
    .bind(time_start)
    .bind(time_end)
    .bind(location)
    .bind(category)
    .bind(notes)
    .bind(auth.user_id)
    .bind(interpreter_id.map(|_| "pending"))
    .fetch_one(&state.db)
    .await
    {
        Ok(r) => {
            let appointment_id: Uuid = match r.try_get("id") {
                Ok(value) => value,
                Err(_) => return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed"),
            };
            let created_at = r
                .try_get::<chrono::DateTime<chrono::Utc>, _>("created_at")
                .map(|v| v.to_rfc3339())
                .unwrap_or_default();

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

                let _ = create_reminder_record(
                    &state,
                    appointment_id,
                    interpreter_id,
                    chrono::Utc::now(),
                    format!("New assignment: {title}"),
                    Some(format!("Appointment on {}", date)),
                )
                .await;
            }

            if appointment_type == "non_medical"
                && let Err(resp) = bootstrap_concierge_workflow(
                    &state,
                    auth.user_id,
                    appointment_id,
                    patient_id,
                    &title,
                    date,
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
                    appointment_id,
                )
                .await
            {
                return resp;
            }

            let conflicts = match build_conflicts_payload(
                &state,
                &auth,
                patient_id,
                interpreter_id,
                date,
                time_start,
                time_end,
                Some(appointment_id),
            )
            .await
            {
                Ok(value) => value,
                Err(resp) => return resp,
            };

            let _ = sqlx::query!("INSERT INTO audit_log (user_id, action, entity_type, entity_id, context) VALUES ($1, 'create_appointment', 'appointment', $2, $3)", auth.user_id, appointment_id, serde_json::json!({"provider_id": provider_id, "doctor_id": doctor_id, "owner_user_id": owner_user_id, "interpreter_id": interpreter_id})).execute(&state.db).await;
            tracing::info!(by = %auth.user_id, apt = %appointment_id, "Appointment created");
            (StatusCode::CREATED, Json(serde_json::json!({"id": appointment_id, "created_at": created_at, "conflicts": conflicts}))).into_response()
        }
        Err(e) => { tracing::error!(error = %e, "create appointment"); err(StatusCode::INTERNAL_SERVER_ERROR, "Failed") }
    }
}

fn is_valid_appointment_type(value: &str) -> bool {
    matches!(value, "medical" | "non_medical" | "internal")
}

fn is_valid_appointment_status(value: &str) -> bool {
    matches!(
        value,
        "planned" | "confirmed" | "in_progress" | "completed" | "cancelled"
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
        r#"SELECT a.id, a.patient_id, a.provider_id, a.doctor_id, a.order_id, a.interpreter_id,
                  a.owner_user_id,
                  a.appointment_type, a.title, a.date, a.time_start, a.time_end, a.location,
                  a.category, a.status, a.interpreter_response, a.checklist_phase,
                  a.preparation_notes, a.followup_notes, a.notes, a.created_at,
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

            Json(build_appointment_detail_json(
                &auth,
                &a,
                appointment_id,
                patient_id,
                interpreter_id,
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
        r#"SELECT patient_id, appointment_type, status, provider_id, doctor_id, owner_user_id,
                  interpreter_id, interpreter_response, title, date, time_start, time_end,
                  location
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
    let current_status: String = current.try_get("status").unwrap_or_else(|_| String::new());
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

    if auth.role == Role::Concierge && !matches!(current_type.as_str(), "non_medical" | "internal")
    {
        return err(
            StatusCode::FORBIDDEN,
            "Concierge can only reschedule non-medical or internal appointments",
        );
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

    let location = normalize_optional_text(body.location);
    let schedule_changed = current_provider_id != body.provider_id
        || current_doctor_id != body.doctor_id
        || current_date != date
        || current_time_start != time_start
        || current_time_end != time_end
        || current_location != location;
    let interpreter_changed = current_interpreter_id != body.interpreter_id;
    let interpreter_response = match body.interpreter_id {
        Some(_) if interpreter_changed || schedule_changed => Some("pending"),
        Some(_) => current_interpreter_response.as_deref(),
        None => None,
    };

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
               interpreter_response = $11
           WHERE id = $1"#,
    )
    .bind(apt_id)
    .bind(body.provider_id)
    .bind(body.doctor_id)
    .bind(owner_user_id)
    .bind(body.interpreter_id)
    .bind(&title)
    .bind(date)
    .bind(time_start)
    .bind(time_end)
    .bind(&location)
    .bind(interpreter_response)
    .execute(&state.db)
    .await
    {
        Ok(result) if result.rows_affected() > 0 => {}
        Ok(_) => return err(StatusCode::NOT_FOUND, "Appointment not found"),
        Err(e) => {
            tracing::error!(error = %e, appointment_id = %apt_id, "update appointment");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    }

    if let Some(interpreter_id) = body.interpreter_id
        && (interpreter_changed || schedule_changed)
    {
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

        let reminder_title = if interpreter_changed {
            format!("Assignment updated: {title}")
        } else {
            format!("Appointment updated: {title}")
        };
        let reminder_description = Some(build_schedule_summary(date, time_start, time_end));
        let _ = create_reminder_record(
            &state,
            apt_id,
            interpreter_id,
            chrono::Utc::now(),
            reminder_title,
            reminder_description,
        )
        .await;
    }

    let conflicts = match build_conflicts_payload(
        &state,
        &auth,
        patient_id,
        body.interpreter_id,
        date,
        time_start,
        time_end,
        Some(apt_id),
    )
    .await
    {
        Ok(value) => value,
        Err(resp) => return resp,
    };

    let _ = sqlx::query!(
        "INSERT INTO audit_log (user_id, action, entity_type, entity_id, context)
         VALUES ($1, 'update_appointment', 'appointment', $2, $3)",
        auth.user_id,
        apt_id,
        serde_json::json!({
            "previous_provider_id": current_provider_id,
            "previous_doctor_id": current_doctor_id,
            "previous_owner_user_id": current_owner_user_id,
            "previous_interpreter_id": current_interpreter_id,
            "previous_date": current_date,
            "previous_time_start": current_time_start,
            "previous_time_end": current_time_end,
            "previous_location": current_location,
            "previous_title": current_title,
            "provider_id": body.provider_id,
            "doctor_id": body.doctor_id,
            "owner_user_id": owner_user_id,
            "interpreter_id": body.interpreter_id,
            "date": date,
            "time_start": time_start,
            "time_end": time_end,
            "location": location,
            "title": title,
        })
    )
    .execute(&state.db)
    .await;

    Json(serde_json::json!({
        "ok": true,
        "conflicts": conflicts,
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
    match body.status.as_str() {
        "planned" => {}
        "confirmed" => {}
        "in_progress" => {}
        "completed" => {}
        "cancelled" => {}
        _ => return err(StatusCode::UNPROCESSABLE_ENTITY, "Invalid status"),
    }
    match sqlx::query!(
        "UPDATE appointments SET status = $2 WHERE id = $1",
        apt_id,
        body.status
    )
    .execute(&state.db)
    .await
    {
        Ok(r) if r.rows_affected() > 0 => {
            if body.status == "completed" {
                let _ = crate::routes::concierge_services::mark_services_ready_for_billing(
                    &state,
                    auth.user_id,
                    apt_id,
                )
                .await;
                let _ = bootstrap_billing_handoff(&state, auth.user_id, apt_id).await;
            }
            Json(serde_json::json!({"ok": true})).into_response()
        }
        Ok(_) => err(StatusCode::NOT_FOUND, "Not found"),
        Err(e) => {
            tracing::error!(error = %e, "update status");
            err(StatusCode::INTERNAL_SERVER_ERROR, "Failed")
        }
    }
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

            let _ = sqlx::query!("INSERT INTO audit_log (user_id, action, entity_type, entity_id, context) VALUES ($1, 'assign_interpreter', 'appointment', $2, $3)",
                auth.user_id, apt_id, serde_json::json!({"interpreter_id": body.interpreter_id})).execute(&state.db).await;
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
        Ok(r) => (StatusCode::CREATED, Json(serde_json::json!({"id": r.id}))).into_response(),
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
        Ok(r) if r.rows_affected() > 0 => Json(serde_json::json!({"ok": true})).into_response(),
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
            StatusCode::CREATED,
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
        Ok(r) if r.rows_affected() > 0 => Json(serde_json::json!({"ok": true})).into_response(),
        Ok(_) => err(StatusCode::NOT_FOUND, "Reminder not found"),
        Err(e) => {
            tracing::error!(error = %e, reminder_id = %reminder_id, appointment_id = %apt_id, "complete reminder");
            err(StatusCode::INTERNAL_SERVER_ERROR, "Failed")
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
        Ok(Some(row)) => Json(serde_json::json!({
            "id": row.try_get::<Uuid, _>("id").unwrap_or(apt_id),
            "interpreter_id": row.try_get::<Uuid, _>("interpreter_id").unwrap_or(auth.user_id),
            "interpreter_name": row.try_get::<String, _>("interpreter_name").unwrap_or_default(),
            "hours": row.try_get::<rust_decimal::Decimal, _>("hours").map(|value| value.to_string()).unwrap_or_default(),
            "report_text": row.try_get::<Option<String>, _>("report_text").unwrap_or_default(),
            "approval_status": row.try_get::<String, _>("approval_status").unwrap_or_default(),
            "notes": row.try_get::<Option<String>, _>("notes").unwrap_or_default(),
            "approved_by_name": row.try_get::<Option<String>, _>("approved_by_name").unwrap_or_default(),
            "approved_at": row.try_get::<Option<chrono::DateTime<chrono::Utc>>, _>("approved_at").unwrap_or_default().map(|value| value.to_rfc3339()),
            "created_at": row.try_get::<chrono::DateTime<chrono::Utc>, _>("created_at").map(|value| value.to_rfc3339()).unwrap_or_default(),
        }))
        .into_response(),
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
    match sqlx::query!("UPDATE interpreter_reports SET approval_status = 'approved', approved_by = $2, approved_at = now() WHERE appointment_id = $1 AND approval_status = 'pending'",
        apt_id, auth.user_id).execute(&state.db).await {
        Ok(r) if r.rows_affected() > 0 => {
            tracing::info!(by = %auth.user_id, apt = %apt_id, "Report approved");
            Json(serde_json::json!({"ok": true})).into_response()
        }
        Ok(_) => err(StatusCode::NOT_FOUND, "No pending report"),
        Err(e) => { tracing::error!(error = %e, "approve report"); err(StatusCode::INTERNAL_SERVER_ERROR, "Failed") }
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
    match (target_start, target_end, other_start, other_end) {
        (Some(target_start), Some(target_end), Some(other_start), Some(other_end)) => {
            target_start < other_end && other_start < target_end
        }
        _ => true,
    }
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
        r#"SELECT a.id, a.title, a.date, a.time_start, a.time_end, a.appointment_type, a.status,
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
