//! Several visits of one order planned on the day-and-hour grid (planning
//! stage 6, owner request 2026-11-13): the planner lays the order's doctors
//! out on the grid and creates every visit in one action.
//!
//! `POST /orders/{id}/appointments/batch` runs the checks of
//! `POST /appointments` for every item plus the overlaps inside the batch,
//! all in one transaction: either every visit is created or none is. With
//! `dry_run` nothing is written and the answer lists what would be refused,
//! so the grid shows the conflicts before saving. Each created visit gets its
//! own audit row in the transaction; an interpreter gets one notification for
//! the batch.
//!
//! `GET /orders/{id}/appointments/busy` lists the time the grid shows as
//! taken: the patient's other visits, the chosen doctors' and the chosen
//! interpreters' bookings. A booking of another patient carries no title.

use std::collections::{HashMap, HashSet};

use axum::{
    Json,
    extract::{Extension, Path, Query, State},
    http::StatusCode,
    response::IntoResponse,
};
use serde::Deserialize;
use sqlx::Row;
use uuid::Uuid;

use super::{
    BookingNoticeTarget, InterpreterBookingNotice, acquire_appointment_schedule_locks,
    appointment_write_error_response, ensure_appointment_order_link_allowed,
    ensure_no_overlapping_appointments_in_tx, ensure_patient_access, ensure_patient_change_access,
    ensure_provider_accepts_new_work, err, err_with_details,
    insert_interpreter_booking_notifications, load_active_interpreter_role, overlaps,
    parse_optional_time, publish_appointment_notifications, validate_appointment_time_range,
    validate_provider_doctor_context,
};
use crate::audit;
use crate::auth::middleware::AuthUser;
use crate::services::interpreter_booking_links as booking_links;
use crate::state::AppState;
use gmed_domain::role::Role;

/// A planning grid holds a visit day or a short trip; the cap keeps one
/// request (and its locks) bounded.
const MAX_BATCH_ITEMS: usize = 60;
/// The grid shows a few days at a time; a month is the most one call reads.
const MAX_BUSY_RANGE_DAYS: i64 = 31;

const PLANNER_ROLES: &[Role] = &[Role::Ceo, Role::PatientManager];

#[derive(Deserialize)]
pub(super) struct BatchVisit {
    provider_id: Uuid,
    doctor_id: Option<Uuid>,
    title: String,
    date: String,
    time_start: String,
    time_end: String,
    /// The visit's own mark; a chosen interpreter implies it.
    interpreter_needed: Option<bool>,
    interpreter_id: Option<Uuid>,
    location: Option<String>,
    notes: Option<String>,
}

#[derive(Deserialize)]
pub(super) struct CreateOrderAppointments {
    #[serde(default)]
    dry_run: bool,
    items: Vec<BatchVisit>,
}

/// One visit after its own checks: what the overlap checks and the insert use.
#[derive(Clone, Debug, PartialEq)]
pub(super) struct PlannedSlot {
    pub(super) date: chrono::NaiveDate,
    pub(super) time_start: chrono::NaiveTime,
    pub(super) time_end: chrono::NaiveTime,
    pub(super) doctor_id: Option<Uuid>,
    pub(super) interpreter_id: Option<Uuid>,
}

/// Two visits of the batch that overlap, and who would be in two places:
/// always the patient (every visit is the order patient's), and the doctor
/// or the interpreter when both visits name the same one.
#[derive(Debug, PartialEq)]
pub(super) struct BatchOverlap {
    pub(super) first: usize,
    pub(super) second: usize,
    pub(super) scopes: Vec<&'static str>,
}

pub(super) fn batch_overlaps(slots: &[PlannedSlot]) -> Vec<BatchOverlap> {
    let mut found = Vec::new();
    for (first, a) in slots.iter().enumerate() {
        for (offset, b) in slots[first + 1..].iter().enumerate() {
            if a.date != b.date
                || !overlaps(
                    Some(a.time_start),
                    Some(a.time_end),
                    Some(b.time_start),
                    Some(b.time_end),
                )
            {
                continue;
            }
            let mut scopes = vec!["patient"];
            if a.doctor_id.is_some() && a.doctor_id == b.doctor_id {
                scopes.push("doctor");
            }
            if a.interpreter_id.is_some() && a.interpreter_id == b.interpreter_id {
                scopes.push("interpreter");
            }
            found.push(BatchOverlap {
                first,
                second: first + 1 + offset,
                scopes,
            });
        }
    }
    found
}

/// One notification per interpreter for the whole batch.
fn interpreter_notice_targets(created: &[(Uuid, PlannedSlot)]) -> Vec<BookingNoticeTarget> {
    super::order_interpreters::one_notice_per_interpreter_for_batch(
        created
            .iter()
            .filter_map(|(id, slot)| {
                slot.interpreter_id.map(|interpreter_id| {
                    (BookingNoticeTarget::new(*id, interpreter_id), slot.date)
                })
            })
            .collect(),
    )
}

fn failure(index: usize, code: &str, message: &str) -> serde_json::Value {
    serde_json::json!({ "index": index, "code": code, "message": message })
}

/// The refusal of a shared check as one entry of the failure list, keeping
/// its message and details (e.g. the conflicting booking).
async fn failure_from_response(
    index: usize,
    code: &str,
    response: axum::response::Response,
) -> serde_json::Value {
    let bytes = axum::body::to_bytes(response.into_body(), 256 * 1024)
        .await
        .unwrap_or_default();
    let mut body: serde_json::Value =
        serde_json::from_slice(&bytes).unwrap_or_else(|_| serde_json::json!({}));
    if let Some(object) = body.as_object_mut() {
        object.remove("error");
        object
            .entry("message")
            .or_insert_with(|| serde_json::json!("Refused"));
        object.insert("index".to_string(), serde_json::json!(index));
        object.insert("code".to_string(), serde_json::json!(code));
    }
    body
}

/// The answer when something is refused: a dry run reports it as a plan that
/// cannot be saved yet, a real run refuses with nothing written.
fn refused(
    dry_run: bool,
    status: StatusCode,
    failures: Vec<serde_json::Value>,
) -> axum::response::Response {
    if dry_run {
        return (
            StatusCode::OK,
            Json(serde_json::json!({ "ok": false, "failures": failures })),
        )
            .into_response();
    }
    err_with_details(
        status,
        "Some visits cannot be created; nothing was created",
        serde_json::json!({ "failures": failures }),
    )
}

/// The order's patient, or the refusal: an unknown order is 404, an order of
/// a lead (no patient yet) cannot hold visits.
async fn load_order_patient(
    state: &AppState,
    order_id: Uuid,
) -> Result<Uuid, axum::response::Response> {
    let row = sqlx::query("SELECT patient_id FROM orders WHERE id = $1")
        .bind(order_id)
        .fetch_optional(&state.db)
        .await
        .map_err(|e| {
            tracing::error!(error = %e, %order_id, "batch visits: load order");
            err(StatusCode::INTERNAL_SERVER_ERROR, "Failed")
        })?
        .ok_or_else(|| err(StatusCode::NOT_FOUND, "Order not found"))?;
    let patient_id: Option<Uuid> = row.try_get("patient_id").unwrap_or_default();
    patient_id.ok_or_else(|| {
        err_with_details(
            StatusCode::CONFLICT,
            "The order has no patient yet; visits are planned once the patient exists",
            serde_json::json!({ "code": "order_without_patient" }),
        )
    })
}

/// `POST /orders/{id}/appointments/batch`
/// `{ "dry_run": bool, "items": [{ provider_id, doctor_id?, title, date,
///    time_start, time_end, interpreter_needed?, interpreter_id?, location?, notes? }] }`
///
/// 201 `{ created: [{ index, id }] }`; a dry run answers 200 `{ ok, failures }`.
/// Otherwise all or nothing: 422 lists invalid items, 409 lists conflicts
/// (inside the batch or with existing bookings), each by its `index`.
pub(super) async fn create_order_appointments(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(order_id): Path<Uuid>,
    Json(body): Json<CreateOrderAppointments>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(PLANNER_ROLES) {
        return e;
    }
    let dry_run = body.dry_run;
    if body.items.is_empty() {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "items must list at least one visit",
        );
    }
    if body.items.len() > MAX_BATCH_ITEMS {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Too many visits in one request",
        );
    }

    let patient_id = match load_order_patient(&state, order_id).await {
        Ok(value) => value,
        Err(resp) => return resp,
    };
    if let Err(resp) = ensure_patient_change_access(&state, &auth, patient_id).await {
        return resp;
    }
    // Art. 18 DSGVO: a restricted patient gets no new appointments.
    if let Err(resp) = crate::routes::patients::ensure_patient_processing_allows(
        &state,
        patient_id,
        "creating an appointment",
    )
    .await
    {
        return resp;
    }
    if let Err(resp) =
        ensure_appointment_order_link_allowed(&state, &auth, patient_id, order_id).await
    {
        return resp;
    }

    // The checks of a single visit, item by item.
    let mut failures = Vec::new();
    let mut slots = Vec::with_capacity(body.items.len());
    let mut interpreters_ok: HashMap<Uuid, bool> = HashMap::new();
    let mut providers_checked: HashSet<(Uuid, Option<Uuid>)> = HashSet::new();
    for (index, item) in body.items.iter().enumerate() {
        if item.title.trim().is_empty() {
            failures.push(failure(index, "invalid", "title is required"));
            continue;
        }
        let Ok(date) = chrono::NaiveDate::parse_from_str(&item.date, "%Y-%m-%d") else {
            failures.push(failure(index, "invalid", "Invalid date (YYYY-MM-DD)"));
            continue;
        };
        let times = parse_optional_time(Some(&item.time_start))
            .and_then(|start| parse_optional_time(Some(&item.time_end)).map(|end| (start, end)));
        let (time_start, time_end) = match times {
            Ok((Some(start), Some(end))) => (start, end),
            Ok(_) => {
                failures.push(failure(
                    index,
                    "invalid",
                    "time_start and time_end are required",
                ));
                continue;
            }
            Err(message) => {
                failures.push(failure(index, "invalid", message));
                continue;
            }
        };
        if let Err(message) = validate_appointment_time_range(Some(time_start), Some(time_end)) {
            failures.push(failure(index, "invalid", message));
            continue;
        }
        if providers_checked.insert((item.provider_id, item.doctor_id)) {
            if let Err(resp) = validate_provider_doctor_context(
                &state,
                Some(item.provider_id),
                item.doctor_id,
                "medical",
            )
            .await
            {
                failures.push(failure_from_response(index, "invalid", resp).await);
                continue;
            }
            if let Err(resp) =
                ensure_provider_accepts_new_work(&state, Some(item.provider_id)).await
            {
                failures.push(failure_from_response(index, "invalid", resp).await);
                continue;
            }
        }
        if let Some(interpreter_id) = item.interpreter_id {
            let active = match interpreters_ok.get(&interpreter_id) {
                Some(value) => *value,
                None => {
                    let value = match load_active_interpreter_role(&state, interpreter_id).await {
                        Ok(role) => role.is_some(),
                        Err(resp) => return resp,
                    };
                    interpreters_ok.insert(interpreter_id, value);
                    value
                }
            };
            if !active {
                failures.push(failure(
                    index,
                    "invalid",
                    "interpreter_id must reference an active interpreter or teamlead interpreter",
                ));
                continue;
            }
        }
        slots.push((
            index,
            PlannedSlot {
                date,
                time_start,
                time_end,
                doctor_id: item.doctor_id,
                interpreter_id: item.interpreter_id,
            },
        ));
    }
    // A provider refused for one item is refused for its twins too.
    let refused_providers: HashSet<(Uuid, Option<Uuid>)> = failures
        .iter()
        .filter_map(|entry| entry["index"].as_u64())
        .map(|index| &body.items[index as usize])
        .map(|item| (item.provider_id, item.doctor_id))
        .collect();
    let mut seen_failed: HashSet<usize> = failures
        .iter()
        .filter_map(|entry| entry["index"].as_u64().map(|value| value as usize))
        .collect();
    slots.retain(|(index, _)| {
        let item = &body.items[*index];
        let twin = refused_providers.contains(&(item.provider_id, item.doctor_id));
        if twin && seen_failed.insert(*index) {
            failures.push(failure(
                *index,
                "invalid",
                "The provider or doctor was refused",
            ));
        }
        !twin
    });
    if !failures.is_empty() {
        return refused(dry_run, StatusCode::UNPROCESSABLE_ENTITY, failures);
    }

    let only_slots: Vec<PlannedSlot> = slots.iter().map(|(_, slot)| slot.clone()).collect();
    for overlap in batch_overlaps(&only_slots) {
        let first = slots[overlap.first].0;
        let second = slots[overlap.second].0;
        for (index, other) in [(first, second), (second, first)] {
            failures.push(serde_json::json!({
                "index": index,
                "code": "batch_overlap",
                "other_index": other,
                "scopes": overlap.scopes,
                "message": "The visit overlaps with another visit of this plan",
            }));
        }
    }
    if !failures.is_empty() {
        return refused(dry_run, StatusCode::CONFLICT, failures);
    }

    let mut tx = match state.db.begin().await {
        Ok(value) => value,
        Err(e) => {
            tracing::error!(error = %e, %order_id, "batch visits: begin tx");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };
    for (index, slot) in &slots {
        if let Err(resp) = acquire_appointment_schedule_locks(
            &mut tx,
            patient_id,
            slot.interpreter_id,
            slot.doctor_id,
            slot.date,
        )
        .await
        {
            if resp.status() == StatusCode::CONFLICT {
                failures.push(failure_from_response(*index, "busy_retry", resp).await);
                continue;
            }
            return resp;
        }
        if let Err(resp) = ensure_no_overlapping_appointments_in_tx(
            &mut tx,
            &auth,
            patient_id,
            slot.interpreter_id,
            slot.doctor_id,
            slot.date,
            Some(slot.time_start),
            Some(slot.time_end),
            &[],
        )
        .await
        {
            if resp.status() == StatusCode::CONFLICT {
                failures.push(failure_from_response(*index, "conflict", resp).await);
                continue;
            }
            return resp;
        }
    }
    if !failures.is_empty() {
        return refused(dry_run, StatusCode::CONFLICT, failures);
    }
    if dry_run {
        return (
            StatusCode::OK,
            Json(serde_json::json!({ "ok": true, "failures": [] })),
        )
            .into_response();
    }

    let batch_size = slots.len();
    let mut created: Vec<(Uuid, PlannedSlot)> = Vec::with_capacity(batch_size);
    let mut created_json = Vec::with_capacity(batch_size);
    for (index, slot) in &slots {
        let item = &body.items[*index];
        let appointment_id = Uuid::new_v4();
        let interpreter_needed = item
            .interpreter_needed
            .or(item.interpreter_id.map(|_| true));
        // A visit of an order waits for the plan's release to the portal
        // (owner decision 2026-11-02), as in `POST /appointments`.
        let inserted = sqlx::query(
            "INSERT INTO appointments (id, patient_id, provider_id, doctor_id, owner_user_id, interpreter_id, order_id, appointment_type, title, date, time_start, time_end, location, notes, created_by, interpreter_response, interpreter_needed, portal_released_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,'medical',$8,$9,$10,$11,$12,$13,$14,$15,$16,NULL)",
        )
        .bind(appointment_id)
        .bind(patient_id)
        .bind(item.provider_id)
        .bind(item.doctor_id)
        // As in `POST /appointments`: a planner (CEO, PM) sets no owner.
        .bind(Option::<Uuid>::None)
        .bind(slot.interpreter_id)
        .bind(order_id)
        .bind(item.title.trim())
        .bind(slot.date)
        .bind(slot.time_start)
        .bind(slot.time_end)
        .bind(item.location.as_deref().map(str::trim).filter(|value| !value.is_empty()))
        .bind(item.notes.as_deref().map(str::trim).filter(|value| !value.is_empty()))
        .bind(auth.user_id)
        .bind(slot.interpreter_id.map(|_| "pending"))
        .bind(interpreter_needed)
        .execute(&mut *tx)
        .await;
        if let Err(e) = inserted {
            if let Some(resp) = appointment_write_error_response(&e) {
                return refused(
                    false,
                    StatusCode::CONFLICT,
                    vec![failure_from_response(*index, "conflict", resp).await],
                );
            }
            tracing::error!(error = %e, %order_id, index, "batch visits: insert");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
        if let Err(e) = audit::write_in_transaction(
            &mut tx,
            &audit::domain_event(
                "create_appointment",
                Some(auth.user_id),
                "appointment",
                Some(appointment_id),
                serde_json::json!({
                    "order_id": order_id,
                    "provider_id": item.provider_id,
                    "doctor_id": item.doctor_id,
                    "interpreter_id": slot.interpreter_id,
                    "interpreter_needed": interpreter_needed,
                    "batch": true,
                    "batch_size": batch_size,
                }),
            ),
        )
        .await
        {
            tracing::error!(error = %e, %appointment_id, "batch visits: audit");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
        created_json.push(serde_json::json!({ "index": index, "id": appointment_id }));
        created.push((appointment_id, slot.clone()));
    }

    let pairs: Vec<(Uuid, Uuid)> = created
        .iter()
        .filter_map(|(_, slot)| {
            slot.interpreter_id
                .map(|interpreter_id| (patient_id, interpreter_id))
        })
        .collect();
    if !pairs.is_empty()
        && let Err(e) =
            booking_links::grant_in_tx(&mut tx, &pairs, auth.user_id, "create_order_appointments")
                .await
    {
        tracing::error!(error = %e, %order_id, "batch visits: link interpreters");
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
    }
    let notifications = match insert_interpreter_booking_notifications(
        &mut tx,
        InterpreterBookingNotice::Booked,
        &interpreter_notice_targets(&created),
        auth.user_id,
    )
    .await
    {
        Ok(value) => value,
        Err(e) => {
            tracing::error!(error = %e, %order_id, "batch visits: notify interpreters");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };
    if let Err(e) = tx.commit().await {
        tracing::error!(error = %e, %order_id, "batch visits: commit");
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
    }
    publish_appointment_notifications(&state, &notifications).await;
    for (appointment_id, _) in &created {
        crate::realtime::publish_appointment_event(
            &state,
            Some(auth.user_id),
            "appointment.created",
            *appointment_id,
            serde_json::json!({ "batch": true }),
        )
        .await;
    }
    tracing::info!(by = %auth.user_id, %order_id, created = created.len(), "Order visits created in one batch");
    (
        StatusCode::CREATED,
        Json(serde_json::json!({ "created": created_json })),
    )
        .into_response()
}

#[derive(Deserialize)]
pub(super) struct BusyQuery {
    from: String,
    to: String,
    /// Comma-separated ids.
    doctor_ids: Option<String>,
    interpreter_ids: Option<String>,
}

fn parse_id_list(raw: Option<&str>) -> Result<Vec<Uuid>, &'static str> {
    raw.unwrap_or_default()
        .split(',')
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| Uuid::parse_str(value).map_err(|_| "Invalid id list"))
        .collect()
}

/// `GET /orders/{id}/appointments/busy?from=YYYY-MM-DD&to=YYYY-MM-DD&doctor_ids=..&interpreter_ids=..`
pub(super) async fn list_order_busy_time(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(order_id): Path<Uuid>,
    Query(query): Query<BusyQuery>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(PLANNER_ROLES) {
        return e;
    }
    let (Ok(from), Ok(to)) = (
        chrono::NaiveDate::parse_from_str(&query.from, "%Y-%m-%d"),
        chrono::NaiveDate::parse_from_str(&query.to, "%Y-%m-%d"),
    ) else {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Invalid date (YYYY-MM-DD)",
        );
    };
    if to < from || (to - from).num_days() > MAX_BUSY_RANGE_DAYS {
        return err(StatusCode::UNPROCESSABLE_ENTITY, "Invalid date range");
    }
    let (doctor_ids, interpreter_ids) = match (
        parse_id_list(query.doctor_ids.as_deref()),
        parse_id_list(query.interpreter_ids.as_deref()),
    ) {
        (Ok(doctors), Ok(interpreters)) => (doctors, interpreters),
        _ => return err(StatusCode::UNPROCESSABLE_ENTITY, "Invalid id list"),
    };
    let patient_id = match load_order_patient(&state, order_id).await {
        Ok(value) => value,
        Err(resp) => return resp,
    };
    if let Err(resp) = ensure_patient_access(&state, &auth, patient_id).await {
        return resp;
    }

    let rows = match sqlx::query(
        r#"SELECT a.id, a.date, a.time_start, a.time_end, a.patient_id, a.doctor_id,
                  a.interpreter_id, a.interpreter_response, a.title, a.order_id
           FROM appointments a
           WHERE a.date BETWEEN $1 AND $2
             AND a.status <> 'cancelled'
             AND (
                 a.patient_id = $3
                 OR a.doctor_id = ANY($4)
                 OR (a.interpreter_id = ANY($5)
                     AND a.interpreter_response IS DISTINCT FROM 'declined')
             )
           ORDER BY a.date, a.time_start NULLS FIRST, a.id"#,
    )
    .bind(from)
    .bind(to)
    .bind(patient_id)
    .bind(&doctor_ids)
    .bind(&interpreter_ids)
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => rows,
        Err(e) => {
            tracing::error!(error = %e, %order_id, "busy time: load");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };

    let items: Vec<serde_json::Value> = rows
        .iter()
        .map(|row| {
            let own = row.try_get::<Uuid, _>("patient_id").ok() == Some(patient_id);
            let doctor_id: Option<Uuid> = row.try_get("doctor_id").unwrap_or_default();
            let interpreter_id: Option<Uuid> = row.try_get("interpreter_id").unwrap_or_default();
            let declined = row
                .try_get::<Option<String>, _>("interpreter_response")
                .unwrap_or_default()
                .as_deref()
                == Some("declined");
            let mut scopes = Vec::new();
            if own {
                scopes.push("patient");
            }
            if doctor_id.is_some_and(|id| doctor_ids.contains(&id)) {
                scopes.push("doctor");
            }
            if !declined && interpreter_id.is_some_and(|id| interpreter_ids.contains(&id)) {
                scopes.push("interpreter");
            }
            let time = |name: &str| {
                row.try_get::<Option<chrono::NaiveTime>, _>(name)
                    .unwrap_or_default()
                    .map(|value| value.format("%H:%M").to_string())
            };
            serde_json::json!({
                "id": if own { row.try_get::<Uuid, _>("id").ok() } else { None },
                "date": row.try_get::<chrono::NaiveDate, _>("date").ok(),
                "time_start": time("time_start"),
                "time_end": time("time_end"),
                "scopes": scopes,
                "doctor_id": if scopes.contains(&"doctor") { doctor_id } else { None },
                "interpreter_id": if scopes.contains(&"interpreter") { interpreter_id } else { None },
                // Another patient's booking shows as taken time only.
                "title": if own { row.try_get::<String, _>("title").ok() } else { None },
                "same_order": own
                    && row.try_get::<Option<Uuid>, _>("order_id").unwrap_or_default() == Some(order_id),
            })
        })
        .collect();
    (StatusCode::OK, Json(serde_json::json!({ "items": items }))).into_response()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn slot(
        day: u32,
        start: &str,
        end: &str,
        doctor: Option<Uuid>,
        interpreter: Option<Uuid>,
    ) -> PlannedSlot {
        PlannedSlot {
            date: chrono::NaiveDate::from_ymd_opt(2026, 11, day).unwrap(),
            time_start: chrono::NaiveTime::parse_from_str(start, "%H:%M").unwrap(),
            time_end: chrono::NaiveTime::parse_from_str(end, "%H:%M").unwrap(),
            doctor_id: doctor,
            interpreter_id: interpreter,
        }
    }

    #[test]
    fn touching_visits_and_other_days_do_not_overlap() {
        let doctor = Some(Uuid::new_v4());
        let found = batch_overlaps(&[
            slot(16, "09:00", "10:00", doctor, None),
            slot(16, "10:00", "11:00", doctor, None),
            slot(17, "09:30", "10:30", doctor, None),
        ]);
        assert!(found.is_empty());
    }

    #[test]
    fn overlap_names_patient_and_the_shared_doctor_and_interpreter() {
        let doctor = Some(Uuid::new_v4());
        let anna = Some(Uuid::new_v4());
        let found = batch_overlaps(&[
            slot(16, "09:00", "10:00", doctor, anna),
            slot(16, "11:00", "12:00", None, None),
            slot(16, "09:30", "10:30", doctor, anna),
            slot(
                16,
                "11:30",
                "12:30",
                Some(Uuid::new_v4()),
                Some(Uuid::new_v4()),
            ),
        ]);
        assert_eq!(
            found,
            vec![
                BatchOverlap {
                    first: 0,
                    second: 2,
                    scopes: vec!["patient", "doctor", "interpreter"]
                },
                BatchOverlap {
                    first: 1,
                    second: 3,
                    scopes: vec!["patient"]
                },
            ]
        );
    }

    #[test]
    fn interpreter_notice_is_one_per_interpreter() {
        let anna = Uuid::new_v4();
        let created = vec![
            (Uuid::new_v4(), slot(16, "09:00", "10:00", None, Some(anna))),
            (Uuid::new_v4(), slot(17, "09:00", "10:00", None, Some(anna))),
            (Uuid::new_v4(), slot(17, "11:00", "12:00", None, None)),
        ];
        let targets = interpreter_notice_targets(&created);
        assert_eq!(targets.len(), 1);
        assert_eq!(targets[0].extra["batch_count"], 2);
    }

    #[test]
    fn id_list_skips_blanks_and_refuses_garbage() {
        let id = Uuid::new_v4();
        assert_eq!(parse_id_list(Some(&format!(" {id},, "))).unwrap(), vec![id]);
        assert!(parse_id_list(Some("nope")).is_err());
        assert!(parse_id_list(None).unwrap().is_empty());
    }
}
