//! Work pipeline of an order: medical record → providers and doctors →
//! appointments → execution → closure. Every stage state is derived from
//! system facts (case, services, appointments, invoices), never typed in.

use crate::{auth::middleware::AuthUser, state::AppState};
use axum::{
    Json, Router,
    extract::{Extension, Path, State},
    http::StatusCode,
    response::IntoResponse,
    routing::get,
};
use gmed_domain::role::Role;
use serde::Serialize;
use serde_json::{Value, json};
use sqlx::Row;
use uuid::Uuid;

pub(super) fn router() -> Router<AppState> {
    Router::new().route("/orders/{order_id}/pipeline", get(get_order_pipeline))
}

/// Clinical facts stay with the roles that may open the case itself.
fn can_view_order_medical(role: Role) -> bool {
    matches!(role, Role::Ceo | Role::PatientManager | Role::ItAdmin)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
enum StageState {
    NotRequired,
    Pending,
    Active,
    Done,
}

#[derive(Debug, Default, Clone)]
struct PipelineFacts {
    medical_required: bool,
    case_linked: bool,
    anamnesis_recorded: bool,
    treatment_plan_finalized: bool,
    providers: i64,
    doctors: i64,
    appointments_open: i64,
    appointments_confirmed: i64,
    appointments_completed: i64,
    services_total: i64,
    services_planned: i64,
    services_uninvoiced: i64,
    invoices_open: i64,
    order_completed: bool,
}

#[derive(Debug, Serialize)]
struct Stage {
    key: &'static str,
    state: StageState,
    /// Machine-readable reasons the stage is not done yet.
    missing: Vec<&'static str>,
}

fn stage(key: &'static str, started: bool, missing: Vec<&'static str>) -> Stage {
    let state = match (missing.is_empty(), started) {
        (true, _) => StageState::Done,
        (false, true) => StageState::Active,
        (false, false) => StageState::Pending,
    };
    Stage {
        key,
        state,
        missing,
    }
}

fn derive_stages(facts: &PipelineFacts) -> Vec<Stage> {
    let medical = if facts.medical_required {
        let mut missing = Vec::new();
        if !facts.case_linked {
            missing.push("case_not_linked");
        }
        if !facts.anamnesis_recorded {
            missing.push("anamnesis_missing");
        }
        if !facts.treatment_plan_finalized {
            missing.push("treatment_plan_not_finalized");
        }
        stage(
            "medical",
            facts.case_linked || facts.anamnesis_recorded,
            missing,
        )
    } else {
        Stage {
            key: "medical",
            state: StageState::NotRequired,
            missing: Vec::new(),
        }
    };

    let mut care_team_missing = Vec::new();
    if facts.providers == 0 {
        care_team_missing.push("provider_missing");
    }
    if facts.medical_required && facts.doctors == 0 {
        care_team_missing.push("doctor_missing");
    }
    let care_team = stage(
        "care_team",
        facts.providers > 0 || facts.doctors > 0,
        care_team_missing,
    );

    let appointments_total =
        facts.appointments_open + facts.appointments_confirmed + facts.appointments_completed;
    let mut appointment_missing = Vec::new();
    if appointments_total == 0 {
        appointment_missing.push("appointment_missing");
    } else if facts.appointments_open > 0 {
        appointment_missing.push("appointment_unconfirmed");
    }
    let appointments = stage("appointments", appointments_total > 0, appointment_missing);

    let mut execution_missing = Vec::new();
    if appointments_total == 0 && facts.services_total == 0 {
        execution_missing.push("nothing_to_execute");
    }
    if facts.appointments_open + facts.appointments_confirmed > 0 {
        execution_missing.push("appointment_not_completed");
    }
    if facts.services_planned > 0 {
        execution_missing.push("service_not_delivered");
    }
    let execution = stage(
        "execution",
        facts.appointments_completed > 0 || facts.services_total > facts.services_planned,
        execution_missing,
    );

    let mut closure_missing = Vec::new();
    if facts.services_uninvoiced > 0 {
        closure_missing.push("service_not_invoiced");
    }
    if facts.invoices_open > 0 {
        closure_missing.push("invoice_unpaid");
    }
    if !facts.order_completed {
        closure_missing.push("order_not_completed");
    }
    let closure = stage(
        "closure",
        facts.services_total > 0 && facts.services_uninvoiced < facts.services_total,
        closure_missing,
    );

    vec![medical, care_team, appointments, execution, closure]
}

fn fail(error: sqlx::Error, order_id: Uuid, step: &'static str) -> axum::response::Response {
    tracing::error!(error = %error, order_id = %order_id, step, "load order pipeline");
    super::err(
        StatusCode::INTERNAL_SERVER_ERROR,
        "Failed to load order pipeline",
    )
}

async fn get_order_pipeline(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(order_id): Path<Uuid>,
) -> axum::response::Response {
    if let Err(response) =
        super::ensure_order_access(&state, &auth, order_id, "Order not found").await
    {
        return response;
    }

    let order = match sqlx::query(
        r#"SELECT o.phase, o.status, o.patient_id, o.case_id,
                  c.case_id AS case_code, c.status AS case_status,
                  (NULLIF(btrim(COALESCE(n.anamnese_aktuelle, '')), '') IS NOT NULL
                   OR NULLIF(btrim(COALESCE(c.hauptanfragegrund, '')), '') IS NOT NULL)
                      AS anamnesis_recorded,
                  COALESCE(p.medical_required, true) AS medical_required,
                  COALESCE(p.treatment_plan_status, 'draft') AS treatment_plan_status,
                  -- Clinical data lives on the patient since the case tables were retired.
                  (SELECT COUNT(*) FROM patient_diagnoses d WHERE d.patient_id = o.patient_id) AS conditions,
                  (SELECT COUNT(*) FROM patient_clinical_warnings w
                    WHERE w.patient_id = o.patient_id AND w.kind = 'allergie') AS allergies,
                  (SELECT COUNT(*) FROM patient_medications m WHERE m.patient_id = o.patient_id) AS medications,
                  (SELECT COUNT(*) FROM patient_procedures pr WHERE pr.patient_id = o.patient_id) AS operations
           FROM orders o
           LEFT JOIN cases c ON c.id = o.case_id
           LEFT JOIN patient_clinical_narrative n ON n.patient_id = o.patient_id
           LEFT JOIN order_planning_preparation p ON p.order_id = o.id
           WHERE o.id = $1"#,
    )
    .bind(order_id)
    .fetch_optional(&state.db)
    .await
    {
        Ok(Some(row)) => row,
        Ok(None) => return super::err(StatusCode::NOT_FOUND, "Order not found"),
        Err(e) => return fail(e, order_id, "order"),
    };

    let work_types = match sqlx::query(
        r#"SELECT requested.id, requested.status, work_type.name_de, work_type.name_ru,
                  COALESCE(specialization.name_de, specialization.name_en) AS specialization_de,
                  COALESCE(specialization.name_ru, specialization.name_en) AS specialization_ru
           FROM patient_requested_work_types requested
           JOIN medical_specialization_work_types work_type ON work_type.id = requested.work_type_id
           JOIN medical_specializations specialization
             ON specialization.id = work_type.specialization_id
           WHERE requested.order_id = $1
           ORDER BY requested.requested_at, requested.id"#,
    )
    .bind(order_id)
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => rows,
        Err(e) => return fail(e, order_id, "work types"),
    };

    // A provider or doctor belongs to the order once a service line, a
    // service-group participant or an appointment names them.
    let care_team = match sqlx::query(
        r#"WITH links AS (
               SELECT service.provider_id, service.doctor_id, 1 AS services, 0 AS appointments
               FROM order_leistungen service
               WHERE service.order_id = $1 AND service.provider_id IS NOT NULL
               UNION ALL
               SELECT participant.provider_id, participant.doctor_id, 0, 0
               FROM order_service_group_participants participant
               JOIN order_service_groups service_group
                 ON service_group.id = participant.service_group_id
               WHERE service_group.order_id = $1
                 AND participant.is_active
                 AND service_group.status <> 'cancelled'
               UNION ALL
               SELECT appointment.provider_id, appointment.doctor_id, 0, 1
               FROM appointments appointment
               WHERE appointment.order_id = $1
                 AND appointment.provider_id IS NOT NULL
                 AND appointment.status <> 'cancelled'
               UNION ALL
               SELECT participant.provider_id, participant.doctor_id, 0, 0
               FROM appointment_doctor_participants participant
               JOIN appointments appointment ON appointment.id = participant.appointment_id
               WHERE appointment.order_id = $1 AND appointment.status <> 'cancelled'
           )
           SELECT links.provider_id, provider.name AS provider_name, provider.provider_type,
                  links.doctor_id, doctor.name AS doctor_name, doctor.title AS doctor_title,
                  doctor.fachbereich AS doctor_specialty,
                  SUM(links.services)::BIGINT AS services,
                  SUM(links.appointments)::BIGINT AS appointments
           FROM links
           JOIN providers provider ON provider.id = links.provider_id
           LEFT JOIN provider_doctors doctor ON doctor.id = links.doctor_id
           GROUP BY links.provider_id, provider.name, provider.provider_type,
                    links.doctor_id, doctor.name, doctor.title, doctor.fachbereich
           ORDER BY provider.name, doctor.name NULLS FIRST"#,
    )
    .bind(order_id)
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => rows,
        Err(e) => return fail(e, order_id, "care team"),
    };

    let appointments = match sqlx::query(
        r#"SELECT appointment.id, appointment.title, appointment.appointment_type,
                  appointment.date, appointment.time_start, appointment.time_end,
                  appointment.status, appointment.location, appointment.interpreter_response,
                  provider.name AS provider_name, doctor.name AS doctor_name,
                  interpreter.name AS interpreter_name
           FROM appointments appointment
           LEFT JOIN providers provider ON provider.id = appointment.provider_id
           LEFT JOIN provider_doctors doctor ON doctor.id = appointment.doctor_id
           LEFT JOIN users interpreter ON interpreter.id = appointment.interpreter_id
           WHERE appointment.order_id = $1
           ORDER BY appointment.date, appointment.time_start NULLS LAST, appointment.id"#,
    )
    .bind(order_id)
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => rows,
        Err(e) => return fail(e, order_id, "appointments"),
    };

    let totals = match sqlx::query(
        r#"SELECT
               (SELECT COUNT(*) FROM order_leistungen WHERE order_id = $1) AS services_total,
               (SELECT COUNT(*) FROM order_leistungen
                 WHERE order_id = $1 AND status = 'planned') AS services_planned,
               (SELECT COUNT(*) FROM order_leistungen
                 WHERE order_id = $1 AND status = 'delivered') AS services_delivered,
               (SELECT COUNT(*) FROM order_leistungen
                 WHERE order_id = $1 AND status = 'approved') AS services_approved,
               (SELECT COUNT(*) FROM order_leistungen
                 WHERE order_id = $1 AND status = 'invoiced') AS services_invoiced,
               (SELECT COUNT(*) FROM invoices
                 WHERE order_id = $1 AND status <> 'cancelled') AS invoices_total,
               (SELECT COUNT(*) FROM invoices
                 WHERE order_id = $1
                   AND status IN ('draft', 'sent', 'partially_paid', 'overdue')) AS invoices_open"#,
    )
    .bind(order_id)
    .fetch_one(&state.db)
    .await
    {
        Ok(row) => row,
        Err(e) => return fail(e, order_id, "totals"),
    };

    let count = |row: &sqlx::postgres::PgRow, column: &str| -> i64 {
        row.try_get::<i64, _>(column).unwrap_or(0)
    };
    let appointment_status = |row: &sqlx::postgres::PgRow| -> String {
        row.try_get::<String, _>("status").unwrap_or_default()
    };
    let case_id = order.try_get::<Option<Uuid>, _>("case_id").unwrap_or(None);
    let treatment_plan_status = order
        .try_get::<String, _>("treatment_plan_status")
        .unwrap_or_else(|_| "draft".to_string());
    let services_total = count(&totals, "services_total");
    let services_invoiced = count(&totals, "services_invoiced");
    let distinct = |column: &str| -> i64 {
        let mut ids: Vec<Uuid> = care_team
            .iter()
            .filter_map(|row| row.try_get::<Option<Uuid>, _>(column).unwrap_or(None))
            .collect();
        ids.sort_unstable();
        ids.dedup();
        ids.len() as i64
    };
    let facts = PipelineFacts {
        medical_required: order.try_get("medical_required").unwrap_or(true),
        case_linked: case_id.is_some(),
        anamnesis_recorded: order
            .try_get::<Option<bool>, _>("anamnesis_recorded")
            .unwrap_or(None)
            .unwrap_or(false),
        treatment_plan_finalized: treatment_plan_status == "finalized",
        providers: distinct("provider_id"),
        doctors: distinct("doctor_id"),
        appointments_open: appointments
            .iter()
            .filter(|row| appointment_status(row) == "planned")
            .count() as i64,
        appointments_confirmed: appointments
            .iter()
            .filter(|row| {
                matches!(
                    appointment_status(row).as_str(),
                    "confirmed" | "in_progress"
                )
            })
            .count() as i64,
        appointments_completed: appointments
            .iter()
            .filter(|row| appointment_status(row) == "completed")
            .count() as i64,
        services_total,
        services_planned: count(&totals, "services_planned"),
        services_uninvoiced: services_total - services_invoiced,
        invoices_open: count(&totals, "invoices_open"),
        order_completed: order
            .try_get::<String, _>("status")
            .is_ok_and(|status| status == "completed"),
    };

    let medical = if can_view_order_medical(auth.role) {
        json!({
            "visible": true,
            "required": facts.medical_required,
            "patient_id": order.try_get::<Option<Uuid>, _>("patient_id").unwrap_or(None),
            "case_id": case_id,
            "case_code": order.try_get::<Option<String>, _>("case_code").unwrap_or(None),
            "case_status": order.try_get::<Option<String>, _>("case_status").unwrap_or(None),
            "anamnesis_recorded": facts.anamnesis_recorded,
            "treatment_plan_status": treatment_plan_status,
            "conditions": count(&order, "conditions"),
            "allergies": count(&order, "allergies"),
            "medications": count(&order, "medications"),
            "operations": count(&order, "operations"),
            "work_types": work_types.iter().map(|row| json!({
                "id": row.try_get::<Uuid, _>("id").unwrap_or_default(),
                "status": row.try_get::<String, _>("status").unwrap_or_default(),
                "name_de": row.try_get::<String, _>("name_de").unwrap_or_default(),
                "name_ru": row.try_get::<String, _>("name_ru").unwrap_or_default(),
                "specialization_de": row.try_get::<String, _>("specialization_de").unwrap_or_default(),
                "specialization_ru": row.try_get::<String, _>("specialization_ru").unwrap_or_default(),
            })).collect::<Vec<Value>>(),
        })
    } else {
        json!({ "visible": false, "required": facts.medical_required })
    };

    Json(json!({
        "order_id": order_id,
        "phase": order.try_get::<String, _>("phase").unwrap_or_default(),
        "status": order.try_get::<String, _>("status").unwrap_or_default(),
        "stages": derive_stages(&facts),
        "medical": medical,
        "care_team": care_team.iter().map(|row| json!({
            "provider_id": row.try_get::<Uuid, _>("provider_id").unwrap_or_default(),
            "provider_name": row.try_get::<String, _>("provider_name").unwrap_or_default(),
            "provider_type": row.try_get::<String, _>("provider_type").unwrap_or_default(),
            "doctor_id": row.try_get::<Option<Uuid>, _>("doctor_id").unwrap_or(None),
            "doctor_name": row.try_get::<Option<String>, _>("doctor_name").unwrap_or(None),
            "doctor_title": row.try_get::<Option<String>, _>("doctor_title").unwrap_or(None),
            "doctor_specialty": row.try_get::<Option<String>, _>("doctor_specialty").unwrap_or(None),
            "services": count(row, "services"),
            "appointments": count(row, "appointments"),
        })).collect::<Vec<Value>>(),
        "appointments": appointments.iter().map(|row| json!({
            "id": row.try_get::<Uuid, _>("id").unwrap_or_default(),
            "title": row.try_get::<String, _>("title").unwrap_or_default(),
            "appointment_type": row.try_get::<String, _>("appointment_type").unwrap_or_default(),
            "date": row.try_get::<chrono::NaiveDate, _>("date").map(|value| value.to_string()).unwrap_or_default(),
            "time_start": row.try_get::<Option<chrono::NaiveTime>, _>("time_start").unwrap_or(None).map(|value| value.format("%H:%M").to_string()),
            "time_end": row.try_get::<Option<chrono::NaiveTime>, _>("time_end").unwrap_or(None).map(|value| value.format("%H:%M").to_string()),
            "status": appointment_status(row),
            "location": row.try_get::<Option<String>, _>("location").unwrap_or(None),
            "provider_name": row.try_get::<Option<String>, _>("provider_name").unwrap_or(None),
            "doctor_name": row.try_get::<Option<String>, _>("doctor_name").unwrap_or(None),
            "interpreter_name": row.try_get::<Option<String>, _>("interpreter_name").unwrap_or(None),
            "interpreter_response": row.try_get::<Option<String>, _>("interpreter_response").unwrap_or(None),
        })).collect::<Vec<Value>>(),
        "services": {
            "total": services_total,
            "planned": facts.services_planned,
            "delivered": count(&totals, "services_delivered"),
            "approved": count(&totals, "services_approved"),
            "invoiced": services_invoiced,
        },
        "invoices": {
            "total": count(&totals, "invoices_total"),
            "open": facts.invoices_open,
        },
    }))
    .into_response()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn states(facts: &PipelineFacts) -> Vec<StageState> {
        derive_stages(facts)
            .into_iter()
            .map(|stage| stage.state)
            .collect()
    }

    #[test]
    fn empty_medical_order_waits_on_every_stage() {
        let facts = PipelineFacts {
            medical_required: true,
            ..PipelineFacts::default()
        };
        assert_eq!(states(&facts), vec![StageState::Pending; 5]);
    }

    #[test]
    fn non_medical_order_skips_the_medical_stage_and_needs_no_doctor() {
        let facts = PipelineFacts {
            providers: 1,
            ..PipelineFacts::default()
        };
        let stages = derive_stages(&facts);
        assert_eq!(stages[0].state, StageState::NotRequired);
        assert_eq!(stages[1].state, StageState::Done);
    }

    #[test]
    fn stages_follow_system_facts() {
        let facts = PipelineFacts {
            medical_required: true,
            case_linked: true,
            anamnesis_recorded: true,
            treatment_plan_finalized: false,
            providers: 1,
            doctors: 1,
            appointments_confirmed: 1,
            appointments_completed: 1,
            services_total: 2,
            services_planned: 1,
            services_uninvoiced: 2,
            ..PipelineFacts::default()
        };
        let stages = derive_stages(&facts);
        assert_eq!(stages[0].state, StageState::Active);
        assert_eq!(stages[0].missing, vec!["treatment_plan_not_finalized"]);
        assert_eq!(stages[1].state, StageState::Done);
        assert_eq!(stages[2].state, StageState::Done);
        assert_eq!(stages[3].state, StageState::Active);
        assert_eq!(
            stages[3].missing,
            vec!["appointment_not_completed", "service_not_delivered"]
        );
        assert_eq!(stages[4].state, StageState::Pending);
    }

    #[test]
    fn completed_and_settled_order_is_done_end_to_end() {
        let facts = PipelineFacts {
            medical_required: true,
            case_linked: true,
            anamnesis_recorded: true,
            treatment_plan_finalized: true,
            providers: 1,
            doctors: 1,
            appointments_completed: 2,
            services_total: 2,
            order_completed: true,
            ..PipelineFacts::default()
        };
        assert_eq!(states(&facts), vec![StageState::Done; 5]);
    }
}
