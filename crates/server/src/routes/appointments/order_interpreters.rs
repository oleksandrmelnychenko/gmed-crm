//! Interpreter for several appointments of one order at once (planning stage 5,
//! "Переводчики по дням"). The same checks as the single assignment run for
//! every appointment, all of them in one transaction: either every appointment
//! gets the interpreter or none does. The interpreter gets one notification
//! for the batch instead of one per appointment; the audit keeps a row per
//! appointment that actually changed (an appointment already booked with the
//! same interpreter is neither written nor audited again).

use std::collections::HashSet;

use axum::{
    Json,
    extract::{Extension, Path, State},
    http::StatusCode,
    response::IntoResponse,
};
use serde::Deserialize;
use sqlx::Row;
use uuid::Uuid;

use super::{
    BookingNoticeTarget, InterpreterBookingNotice, ReportAutoRejection,
    acquire_appointment_schedule_locks, appointment_write_error_response, can_change_appointment,
    close_unbooked_interpreter_reminders_in_tx, ensure_no_overlapping_appointments_in_tx, err,
    err_with_details, insert_interpreter_booking_notifications, load_active_interpreter_role,
    publish_appointment_notifications, reject_pending_reports_in_tx,
};
use crate::audit;
use crate::auth::middleware::AuthUser;
use crate::services::interpreter_booking_links as booking_links;
use crate::state::AppState;
use gmed_domain::role::Role;

/// A planning day rarely holds more than a handful of visits; the cap keeps
/// one request (and its locks) bounded.
const MAX_BATCH_APPOINTMENTS: usize = 200;

#[derive(Deserialize)]
pub(super) struct AssignOrderInterpreter {
    /// The interpreter to book; `null` takes the booked interpreter off.
    interpreter_id: Option<Uuid>,
    appointment_ids: Vec<Uuid>,
}

struct BatchAppointment {
    id: Uuid,
    order_id: Option<Uuid>,
    patient_id: Uuid,
    doctor_id: Option<Uuid>,
    owner_user_id: Option<Uuid>,
    date: chrono::NaiveDate,
    time_start: Option<chrono::NaiveTime>,
    time_end: Option<chrono::NaiveTime>,
    interpreter_id: Option<Uuid>,
    interpreter_response: Option<String>,
    status: String,
}

fn decode_batch_appointment(row: &sqlx::postgres::PgRow) -> Result<BatchAppointment, sqlx::Error> {
    Ok(BatchAppointment {
        id: row.try_get("id")?,
        order_id: row.try_get("order_id")?,
        patient_id: row.try_get("patient_id")?,
        doctor_id: row.try_get("doctor_id")?,
        owner_user_id: row.try_get("owner_user_id")?,
        date: row.try_get("date")?,
        time_start: row.try_get("time_start")?,
        time_end: row.try_get("time_end")?,
        interpreter_id: row.try_get("interpreter_id")?,
        interpreter_response: row.try_get("interpreter_response")?,
        status: row.try_get("status")?,
    })
}

fn failure(appointment_id: Uuid, code: &str, message: &str) -> serde_json::Value {
    serde_json::json!({
        "appointment_id": appointment_id,
        "code": code,
        "message": message,
    })
}

/// The refusal of a shared check (e.g. a schedule conflict) as one entry of
/// the failure list, keeping its message and details.
async fn failure_from_response(
    appointment_id: Uuid,
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
        object.insert(
            "appointment_id".to_string(),
            serde_json::json!(appointment_id),
        );
        object.insert("code".to_string(), serde_json::json!(code));
    }
    body
}

fn refused(
    status: StatusCode,
    message: &str,
    failures: Vec<serde_json::Value>,
) -> axum::response::Response {
    err_with_details(status, message, serde_json::json!({ "failures": failures }))
}

/// One notification per interpreter for the whole batch: the earliest
/// appointment, with the number of appointments and the last day.
fn one_notice_per_interpreter_for_batch(
    targets: Vec<(BookingNoticeTarget, chrono::NaiveDate)>,
) -> Vec<BookingNoticeTarget> {
    let mut grouped: Vec<(BookingNoticeTarget, usize, chrono::NaiveDate)> = Vec::new();
    for (target, date) in targets {
        match grouped
            .iter_mut()
            .find(|(existing, _, _)| existing.interpreter_id == target.interpreter_id)
        {
            Some((_, count, last_date)) => {
                *count += 1;
                if date > *last_date {
                    *last_date = date;
                }
            }
            None => grouped.push((target, 1, date)),
        }
    }
    grouped
        .into_iter()
        .map(|(mut target, count, last_date)| {
            if count > 1
                && let Some(extra) = target.extra.as_object_mut()
            {
                extra.insert("batch_count".to_string(), serde_json::json!(count));
                extra.insert("batch_last_date".to_string(), serde_json::json!(last_date));
            }
            target
        })
        .collect()
}

/// `POST /orders/{id}/appointments/assign-interpreter`
/// `{ "interpreter_id": uuid | null, "appointment_ids": [uuid, ...] }`
///
/// All or nothing: 404 for an unknown order, 403 when the caller may not
/// change one of the appointments, 409 when an appointment is foreign to the
/// order, closed, has a schedule conflict, or (when taking the interpreter
/// off) has a report; each refusal lists `failures` with the appointment id.
pub(super) async fn assign_order_interpreter(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(order_id): Path<Uuid>,
    Json(body): Json<AssignOrderInterpreter>,
) -> axum::response::Response {
    // The same roles as the single assignment.
    if let Err(e) =
        auth.require_any_role(&[Role::Ceo, Role::PatientManager, Role::TeamleadInterpreter])
    {
        return e;
    }

    let mut seen = HashSet::new();
    let appointment_ids: Vec<Uuid> = body
        .appointment_ids
        .iter()
        .copied()
        .filter(|id| seen.insert(*id))
        .collect();
    if appointment_ids.is_empty() {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "appointment_ids must list at least one appointment",
        );
    }
    if appointment_ids.len() > MAX_BATCH_APPOINTMENTS {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Too many appointments in one request",
        );
    }

    if let Some(interpreter_id) = body.interpreter_id {
        match load_active_interpreter_role(&state, interpreter_id).await {
            Ok(Some(_)) => {}
            Ok(None) => {
                return err(
                    StatusCode::UNPROCESSABLE_ENTITY,
                    "Interpreter must be an active interpreter or teamlead interpreter",
                );
            }
            Err(resp) => return resp,
        }
    }

    match sqlx::query_scalar::<_, Uuid>("SELECT id FROM orders WHERE id = $1")
        .bind(order_id)
        .fetch_optional(&state.db)
        .await
    {
        Ok(Some(_)) => {}
        Ok(None) => return err(StatusCode::NOT_FOUND, "Order not found"),
        Err(e) => {
            tracing::error!(error = %e, %order_id, "batch interpreter: load order");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    }

    let mut tx = match state.db.begin().await {
        Ok(value) => value,
        Err(e) => {
            tracing::error!(error = %e, %order_id, "batch interpreter: begin tx");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };
    let rows = match sqlx::query(
        r#"SELECT id, order_id, patient_id, doctor_id, owner_user_id, date, time_start,
                  time_end, interpreter_id, interpreter_response, status
           FROM appointments
           WHERE id = ANY($1)
           ORDER BY date, time_start NULLS FIRST, id
           FOR UPDATE"#,
    )
    .bind(&appointment_ids)
    .fetch_all(&mut *tx)
    .await
    {
        Ok(rows) => rows,
        Err(e) => {
            tracing::error!(error = %e, %order_id, "batch interpreter: lock appointments");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };
    let mut appointments = Vec::with_capacity(rows.len());
    for row in rows {
        match decode_batch_appointment(&row) {
            Ok(value) => appointments.push(value),
            Err(e) => {
                tracing::error!(error = %e, %order_id, "batch interpreter: decode appointment");
                return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
            }
        }
    }

    // An unknown appointment and one of another order are refused alike, so
    // the answer tells nothing about appointments outside the order.
    let found: HashSet<Uuid> = appointments.iter().map(|a| a.id).collect();
    let mut failures: Vec<serde_json::Value> = appointment_ids
        .iter()
        .filter(|id| !found.contains(id))
        .map(|id| {
            failure(
                *id,
                "not_in_order",
                "The appointment does not belong to this order",
            )
        })
        .collect();
    let mut forbidden = Vec::new();
    for appointment in &appointments {
        if appointment.order_id != Some(order_id) {
            failures.push(failure(
                appointment.id,
                "not_in_order",
                "The appointment does not belong to this order",
            ));
            continue;
        }
        match can_change_appointment(
            &state,
            &auth,
            appointment.id,
            Some(appointment.patient_id),
            appointment.interpreter_id,
            appointment.owner_user_id,
        )
        .await
        {
            Ok(true) => {}
            Ok(false) => {
                forbidden.push(failure(
                    appointment.id,
                    "forbidden",
                    "Insufficient permissions",
                ));
                continue;
            }
            Err(resp) => return resp,
        }
        if matches!(appointment.status.as_str(), "completed" | "cancelled") {
            failures.push(failure(
                appointment.id,
                "appointment_closed",
                "Interpreter cannot be assigned to a completed or cancelled appointment",
            ));
        }
    }
    if !forbidden.is_empty() {
        return refused(StatusCode::FORBIDDEN, "Insufficient permissions", forbidden);
    }
    if !failures.is_empty() {
        return refused(
            StatusCode::CONFLICT,
            "Some appointments cannot take the interpreter; nothing was changed",
            failures,
        );
    }

    let outcome = match body.interpreter_id {
        Some(interpreter_id) => {
            book_interpreter_in_tx(&mut tx, &auth, order_id, interpreter_id, &appointments).await
        }
        None => unbook_interpreters_in_tx(&mut tx, &auth, order_id, &appointments).await,
    };
    let (notifications, changed) = match outcome {
        Ok(value) => value,
        Err(resp) => return resp,
    };

    if let Err(e) = tx.commit().await {
        tracing::error!(error = %e, %order_id, "batch interpreter: commit");
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
    }
    publish_appointment_notifications(&state, &notifications).await;

    Json(serde_json::json!({
        "ok": true,
        "interpreter_id": body.interpreter_id,
        "appointments": appointments
            .iter()
            .map(|appointment| serde_json::json!({
                "appointment_id": appointment.id,
                "previous_interpreter_id": appointment.interpreter_id,
                "changed": changed.contains(&appointment.id),
            }))
            .collect::<Vec<_>>(),
    }))
    .into_response()
}

type BatchOutcome = (Vec<super::PendingAppointmentNotification>, HashSet<Uuid>);

async fn book_interpreter_in_tx(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    auth: &AuthUser,
    order_id: Uuid,
    interpreter_id: Uuid,
    appointments: &[BatchAppointment],
) -> Result<BatchOutcome, axum::response::Response> {
    for appointment in appointments {
        acquire_appointment_schedule_locks(
            tx,
            appointment.patient_id,
            Some(interpreter_id),
            appointment.doctor_id,
            appointment.date,
        )
        .await?;
    }

    // Checked in date order, each after the earlier ones were booked, so two
    // overlapping appointments of the batch are caught as well.
    let mut failures = Vec::new();
    let mut changed = HashSet::new();
    let mut notifications = Vec::new();
    let mut booked_notices = Vec::new();
    let mut unbooked_notices = Vec::new();
    let mut booked_pairs = Vec::new();
    let mut unbooked_pairs = Vec::new();
    for appointment in appointments {
        if let Err(resp) = ensure_no_overlapping_appointments_in_tx(
            tx,
            auth,
            appointment.patient_id,
            Some(interpreter_id),
            appointment.doctor_id,
            appointment.date,
            appointment.time_start,
            appointment.time_end,
            &[appointment.id],
        )
        .await
        {
            if resp.status() == StatusCode::CONFLICT {
                failures
                    .push(failure_from_response(appointment.id, "schedule_conflict", resp).await);
                continue;
            }
            return Err(resp);
        }
        if !failures.is_empty() {
            // The batch is refused anyway; keep checking without writing.
            continue;
        }

        let previous = appointment.interpreter_id;
        let previous_response = appointment.interpreter_response.as_deref();
        let newly_booked = previous != Some(interpreter_id)
            || matches!(previous_response, None | Some("declined"));
        if !newly_booked {
            // Already booked with a standing answer (a repeated click, or a
            // day where only some visits are new): no write, no audit row.
            booked_pairs.push((appointment.patient_id, interpreter_id));
            continue;
        }

        // Same rule as the single assignment: a new interpreter, or the one
        // who declined, is asked again; a standing answer is kept.
        if let Err(e) = sqlx::query(
            "UPDATE appointments
                SET interpreter_id = $2,
                    interpreter_response = CASE
                        WHEN interpreter_id IS DISTINCT FROM $2
                          OR interpreter_response IS NULL
                          OR interpreter_response = 'declined' THEN 'pending'
                        ELSE interpreter_response
                    END,
                    interpreter_response_comment = CASE
                        WHEN interpreter_id IS DISTINCT FROM $2
                          OR interpreter_response = 'declined' THEN NULL
                        ELSE interpreter_response_comment
                    END,
                    updated_at = now()
              WHERE id = $1",
        )
        .bind(appointment.id)
        .bind(interpreter_id)
        .execute(&mut **tx)
        .await
        {
            // The transaction is aborted after a database refusal.
            if let Some(resp) = appointment_write_error_response(&e) {
                let entry = failure_from_response(appointment.id, "schedule_conflict", resp).await;
                return Err(refused(
                    StatusCode::CONFLICT,
                    "Some appointments cannot take the interpreter; nothing was changed",
                    vec![entry],
                ));
            }
            tracing::error!(error = %e, appointment_id = %appointment.id, "batch interpreter: assign");
            return Err(err(StatusCode::INTERNAL_SERVER_ERROR, "Failed"));
        }

        if let Some(previous_id) = previous
            && previous_id != interpreter_id
        {
            notifications.extend(
                reject_pending_reports_in_tx(
                    tx,
                    &[appointment.id],
                    auth.user_id,
                    ReportAutoRejection::InterpreterChanged,
                )
                .await?,
            );
            close_unbooked_interpreter_reminders_in_tx(tx, appointment.id, previous_id).await?;
            if previous_response != Some("declined") {
                unbooked_notices.push((
                    BookingNoticeTarget::new(appointment.id, previous_id),
                    appointment.date,
                ));
            }
            unbooked_pairs.push((appointment.patient_id, previous_id));
        }
        booked_notices.push((
            BookingNoticeTarget::new(appointment.id, interpreter_id),
            appointment.date,
        ));
        changed.insert(appointment.id);
        booked_pairs.push((appointment.patient_id, interpreter_id));

        if let Err(e) = audit::write_in_transaction(
            tx,
            &audit::domain_event(
                "assign_interpreter",
                Some(auth.user_id),
                "appointment",
                Some(appointment.id),
                serde_json::json!({
                    "interpreter_id": interpreter_id,
                    "previous_interpreter_id": previous,
                    "order_id": order_id,
                    "batch": true,
                    "batch_size": appointments.len(),
                }),
            ),
        )
        .await
        {
            tracing::error!(error = %e, appointment_id = %appointment.id, "batch interpreter: audit");
            return Err(err(StatusCode::INTERNAL_SERVER_ERROR, "Failed"));
        }
    }
    if !failures.is_empty() {
        return Err(refused(
            StatusCode::CONFLICT,
            "Some appointments cannot take the interpreter; nothing was changed",
            failures,
        ));
    }

    let failed = |e: sqlx::Error, what: &str| {
        tracing::error!(error = %e, %order_id, step = what, "batch interpreter");
        err(StatusCode::INTERNAL_SERVER_ERROR, "Failed")
    };
    notifications.extend(
        insert_interpreter_booking_notifications(
            tx,
            InterpreterBookingNotice::Unbooked,
            &one_notice_per_interpreter_for_batch(unbooked_notices),
            auth.user_id,
        )
        .await
        .map_err(|e| failed(e, "notify unbooked"))?,
    );
    notifications.extend(
        insert_interpreter_booking_notifications(
            tx,
            InterpreterBookingNotice::Booked,
            &one_notice_per_interpreter_for_batch(booked_notices),
            auth.user_id,
        )
        .await
        .map_err(|e| failed(e, "notify booked"))?,
    );
    booking_links::grant_in_tx(tx, &booked_pairs, auth.user_id, "assign_interpreter")
        .await
        .map_err(|e| failed(e, "link interpreter to patient"))?;
    booking_links::end_unbooked_in_tx(
        tx,
        &unbooked_pairs,
        Some(auth.user_id),
        "assign_interpreter",
    )
    .await
    .map_err(|e| failed(e, "end previous interpreter link"))?;
    Ok((notifications, changed))
}

/// Takes the booked interpreter off the appointments. An appointment with a
/// submitted or approved report keeps its interpreter: that report is billed
/// or waits for review, so it is handled in the appointment itself.
async fn unbook_interpreters_in_tx(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    auth: &AuthUser,
    order_id: Uuid,
    appointments: &[BatchAppointment],
) -> Result<BatchOutcome, axum::response::Response> {
    let ids: Vec<Uuid> = appointments.iter().map(|a| a.id).collect();
    let reported: HashSet<Uuid> = match sqlx::query_scalar::<_, Uuid>(
        r#"SELECT DISTINCT report.appointment_id
           FROM interpreter_reports report
           JOIN appointments a ON a.id = report.appointment_id
           WHERE report.appointment_id = ANY($1)
             AND report.interpreter_id = a.interpreter_id
             AND report.approval_status IN ('pending', 'approved')"#,
    )
    .bind(&ids)
    .fetch_all(&mut **tx)
    .await
    {
        Ok(rows) => rows.into_iter().collect(),
        Err(e) => {
            tracing::error!(error = %e, %order_id, "batch interpreter: load reports");
            return Err(err(StatusCode::INTERNAL_SERVER_ERROR, "Failed"));
        }
    };
    if !reported.is_empty() {
        let failures = appointments
            .iter()
            .filter(|a| reported.contains(&a.id))
            .map(|a| {
                failure(
                    a.id,
                    "interpreter_report_exists",
                    "The interpreter already reported this appointment; change it in the appointment",
                )
            })
            .collect();
        return Err(refused(
            StatusCode::CONFLICT,
            "Some appointments cannot lose the interpreter; nothing was changed",
            failures,
        ));
    }

    let mut changed = HashSet::new();
    let mut notifications = Vec::new();
    let mut unbooked_notices = Vec::new();
    let mut unbooked_pairs = Vec::new();
    for appointment in appointments {
        let Some(previous_id) = appointment.interpreter_id else {
            continue;
        };
        if let Err(e) = sqlx::query(
            "UPDATE appointments
                SET interpreter_id = NULL,
                    interpreter_response = NULL,
                    interpreter_response_comment = NULL,
                    updated_at = now()
              WHERE id = $1",
        )
        .bind(appointment.id)
        .execute(&mut **tx)
        .await
        {
            tracing::error!(error = %e, appointment_id = %appointment.id, "batch interpreter: unassign");
            return Err(err(StatusCode::INTERNAL_SERVER_ERROR, "Failed"));
        }
        close_unbooked_interpreter_reminders_in_tx(tx, appointment.id, previous_id).await?;
        if appointment.interpreter_response.as_deref() != Some("declined") {
            unbooked_notices.push((
                BookingNoticeTarget::new(appointment.id, previous_id),
                appointment.date,
            ));
        }
        unbooked_pairs.push((appointment.patient_id, previous_id));
        changed.insert(appointment.id);
        if let Err(e) = audit::write_in_transaction(
            tx,
            &audit::domain_event(
                "unassign_interpreter",
                Some(auth.user_id),
                "appointment",
                Some(appointment.id),
                serde_json::json!({
                    "interpreter_id": serde_json::Value::Null,
                    "previous_interpreter_id": previous_id,
                    "order_id": order_id,
                    "batch": true,
                    "batch_size": appointments.len(),
                }),
            ),
        )
        .await
        {
            tracing::error!(error = %e, appointment_id = %appointment.id, "batch interpreter: audit");
            return Err(err(StatusCode::INTERNAL_SERVER_ERROR, "Failed"));
        }
    }

    let failed = |e: sqlx::Error, what: &str| {
        tracing::error!(error = %e, %order_id, step = what, "batch interpreter");
        err(StatusCode::INTERNAL_SERVER_ERROR, "Failed")
    };
    notifications.extend(
        insert_interpreter_booking_notifications(
            tx,
            InterpreterBookingNotice::Unbooked,
            &one_notice_per_interpreter_for_batch(unbooked_notices),
            auth.user_id,
        )
        .await
        .map_err(|e| failed(e, "notify unbooked"))?,
    );
    booking_links::end_unbooked_in_tx(
        tx,
        &unbooked_pairs,
        Some(auth.user_id),
        "unassign_interpreter",
    )
    .await
    .map_err(|e| failed(e, "end interpreter link"))?;
    Ok((notifications, changed))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn batch_notice_groups_per_interpreter_with_count_and_last_day() {
        let anna = Uuid::new_v4();
        let boris = Uuid::new_v4();
        let day = |d: u32| chrono::NaiveDate::from_ymd_opt(2026, 11, d).unwrap();
        let first = Uuid::new_v4();
        let notices = one_notice_per_interpreter_for_batch(vec![
            (BookingNoticeTarget::new(first, anna), day(3)),
            (BookingNoticeTarget::new(Uuid::new_v4(), anna), day(5)),
            (BookingNoticeTarget::new(Uuid::new_v4(), boris), day(4)),
            (BookingNoticeTarget::new(Uuid::new_v4(), anna), day(4)),
        ]);
        assert_eq!(notices.len(), 2);
        assert_eq!(notices[0].appointment_id, first);
        assert_eq!(notices[0].extra["batch_count"], 3);
        assert_eq!(notices[0].extra["batch_last_date"], "2026-11-05");
        assert!(notices[1].extra.get("batch_count").is_none());
    }
}
