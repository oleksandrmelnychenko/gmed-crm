use std::collections::HashMap;

use axum::{
    Json, Router,
    extract::{Extension, Path, Query, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
};
use chrono::{DateTime, Utc};
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::Row;
use uuid::Uuid;

use crate::access::has_active_patient_assignment;
use crate::audit;
use crate::auth::middleware::AuthUser;
use crate::routes::me::resolve_self_patient_id;
use crate::state::AppState;
use gmed_domain::role::Role;

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/me/feedback",
            get(list_my_feedback).post(create_my_feedback),
        )
        .route("/feedback", get(list_feedback).post(create_staff_feedback))
        .route("/feedback/summary", get(get_feedback_summary))
        .route("/feedback/{feedback_id}/review", post(review_feedback))
}

#[derive(Deserialize)]
struct CreateFeedbackRequest {
    patient_id: Option<Uuid>,
    appointment_id: Option<Uuid>,
    provider_id: Option<Uuid>,
    doctor_id: Option<Uuid>,
    overall_score: i32,
    patient_manager_score: Option<i32>,
    interpreter_score: Option<i32>,
    concierge_score: Option<i32>,
    treatment_score: Option<i32>,
    doctor_score: Option<i32>,
    organization_score: Option<i32>,
    service_score: Option<i32>,
    infrastructure_score: Option<i32>,
    price_value_score: Option<i32>,
    treatment_success: Option<String>,
    complication_reported: Option<bool>,
    nps_score: i32,
    comments: Option<String>,
    improvement_notes: Option<String>,
    internal_note: Option<String>,
}

#[derive(Deserialize)]
struct FeedbackListQuery {
    search: Option<String>,
    patient_id: Option<Uuid>,
    provider_id: Option<Uuid>,
    interpreter_id: Option<Uuid>,
    status: Option<String>,
    source: Option<String>,
}

#[derive(Deserialize)]
struct ReviewFeedbackRequest {
    status: String,
    review_note: Option<String>,
}

struct ResolvedFeedbackContext {
    appointment_id: Option<Uuid>,
    provider_id: Option<Uuid>,
    doctor_id: Option<Uuid>,
    patient_manager_id: Option<Uuid>,
    interpreter_id: Option<Uuid>,
    concierge_id: Option<Uuid>,
}

struct SummaryAccumulator {
    sum: i64,
    count: i64,
}

impl SummaryAccumulator {
    fn push(&mut self, value: Option<i32>) {
        if let Some(value) = value {
            self.sum += i64::from(value);
            self.count += 1;
        }
    }

    fn average(&self) -> Option<f64> {
        if self.count == 0 {
            None
        } else {
            Some(self.sum as f64 / self.count as f64)
        }
    }
}

fn percentage(value: i64, total: i64) -> Option<f64> {
    if total <= 0 {
        None
    } else {
        Some((value as f64 / total as f64) * 100.0)
    }
}

#[derive(Clone)]
struct PromoterSummary {
    patient_id: Uuid,
    patient_pid: Option<String>,
    patient_name: String,
    sum: i64,
    count: i64,
    last_submitted_at: Option<DateTime<Utc>>,
}

#[derive(Clone)]
struct StaffRankingSummary {
    user_id: Uuid,
    name: String,
    sum: i64,
    count: i64,
}

#[derive(Clone)]
struct ProviderRankingSummary {
    provider_id: Uuid,
    name: String,
    sum: i64,
    count: i64,
}

async fn list_my_feedback(
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

    let rows = match sqlx::query(
        r#"SELECT f.id, f.patient_id, f.appointment_id, f.provider_id, f.doctor_id, f.source,
                  f.status, f.overall_score, f.patient_manager_score, f.interpreter_score,
                  f.concierge_score, f.treatment_score, f.doctor_score, f.organization_score,
                  f.service_score, f.infrastructure_score, f.price_value_score,
                  f.treatment_success, f.complication_reported, f.nps_score,
                  f.comments, f.improvement_notes, f.review_note, f.submitted_at, f.reviewed_at,
                  a.title AS appointment_title, a.date AS appointment_date,
                  p.name AS provider_name, d.name AS doctor_name,
                  pm.name AS patient_manager_name, i.name AS interpreter_name,
                  c.name AS concierge_name, reviewed_by_user.name AS reviewed_by_name
           FROM patient_feedback_forms f
           LEFT JOIN appointments a ON a.id = f.appointment_id
           LEFT JOIN providers p ON p.id = f.provider_id
           LEFT JOIN provider_doctors d ON d.id = f.doctor_id
           LEFT JOIN users pm ON pm.id = f.patient_manager_id
           LEFT JOIN users i ON i.id = f.interpreter_id
           LEFT JOIN users c ON c.id = f.concierge_id
           LEFT JOIN users reviewed_by_user ON reviewed_by_user.id = f.reviewed_by
           WHERE f.patient_id = $1
           ORDER BY f.submitted_at DESC, f.created_at DESC"#,
    )
    .bind(patient_id)
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => rows,
        Err(e) => {
            tracing::error!(error = %e, user_id = %auth.user_id, "list my feedback");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to load feedback history",
            );
        }
    };

    Json(
        rows.into_iter()
            .map(|row| feedback_row_json(row, false))
            .collect::<Vec<_>>(),
    )
    .into_response()
}

async fn create_my_feedback(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Json(body): Json<CreateFeedbackRequest>,
) -> axum::response::Response {
    if let Err(resp) = auth.require_any_role(&[Role::Patient]) {
        return resp;
    }

    let patient_id = match resolve_self_patient_id(&state, auth.user_id).await {
        Ok(value) => value,
        Err(resp) => return resp,
    };

    match create_feedback_record(&state, &auth, patient_id, body, "patient_portal", false).await {
        Ok(response) => response,
        Err(resp) => resp,
    }
}

async fn list_feedback(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Query(query): Query<FeedbackListQuery>,
) -> axum::response::Response {
    if let Err(resp) = auth.require_any_role(&[
        Role::Ceo,
        Role::CeoAssistant,
        Role::PatientManager,
        Role::TeamleadInterpreter,
        Role::Concierge,
    ]) {
        return resp;
    }

    let rows = match load_feedback_rows(&state, &auth, &query, Some(250)).await {
        Ok(rows) => rows,
        Err(resp) => return resp,
    };

    Json(
        rows.into_iter()
            .filter(|row| role_can_see_feedback_row(&auth, row))
            .map(|row| feedback_row_json(row, true))
            .collect::<Vec<_>>(),
    )
    .into_response()
}

async fn create_staff_feedback(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Json(body): Json<CreateFeedbackRequest>,
) -> axum::response::Response {
    if let Err(resp) = auth.require_any_role(&[Role::Ceo, Role::PatientManager]) {
        return resp;
    }

    let patient_id = match body.patient_id {
        Some(value) => value,
        None => {
            return err(
                StatusCode::UNPROCESSABLE_ENTITY,
                "Patient is required for staff feedback capture",
            );
        }
    };

    if auth.role != Role::Ceo {
        let assigned = match has_active_patient_assignment(&state.db, patient_id, auth.user_id)
            .await
        {
            Ok(value) => value,
            Err(e) => {
                tracing::error!(error = %e, user_id = %auth.user_id, patient_id = %patient_id, "validate staff feedback assignment");
                return err(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Failed to validate patient assignment",
                );
            }
        };
        if !assigned {
            return err(StatusCode::FORBIDDEN, "Insufficient permissions");
        }
    }

    match create_feedback_record(&state, &auth, patient_id, body, "staff_capture", true).await {
        Ok(response) => response,
        Err(resp) => resp,
    }
}

async fn get_feedback_summary(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Query(query): Query<FeedbackListQuery>,
) -> axum::response::Response {
    if let Err(resp) = auth.require_any_role(&[
        Role::Ceo,
        Role::CeoAssistant,
        Role::PatientManager,
        Role::TeamleadInterpreter,
        Role::Concierge,
    ]) {
        return resp;
    }

    let rows = match load_feedback_rows(&state, &auth, &query, None).await {
        Ok(rows) => rows,
        Err(resp) => return resp,
    };
    let scoped_rows = rows
        .into_iter()
        .filter(|row| role_can_see_feedback_row(&auth, row))
        .collect::<Vec<_>>();

    let mut overall = SummaryAccumulator { sum: 0, count: 0 };
    let mut patient_manager = SummaryAccumulator { sum: 0, count: 0 };
    let mut interpreter = SummaryAccumulator { sum: 0, count: 0 };
    let mut concierge = SummaryAccumulator { sum: 0, count: 0 };
    let mut treatment = SummaryAccumulator { sum: 0, count: 0 };
    let mut doctor = SummaryAccumulator { sum: 0, count: 0 };
    let mut organization = SummaryAccumulator { sum: 0, count: 0 };
    let mut service = SummaryAccumulator { sum: 0, count: 0 };
    let mut infrastructure = SummaryAccumulator { sum: 0, count: 0 };
    let mut price_value = SummaryAccumulator { sum: 0, count: 0 };

    let mut total_feedback = 0_i64;
    let mut reviewed_feedback = 0_i64;
    let mut patient_portal_count = 0_i64;
    let mut staff_capture_count = 0_i64;
    let mut promoters = 0_i64;
    let mut passives = 0_i64;
    let mut detractors = 0_i64;
    let mut treatment_success_yes = 0_i64;
    let mut treatment_success_partial = 0_i64;
    let mut treatment_success_samples = 0_i64;
    let mut complication_count = 0_i64;

    let mut promoter_map: HashMap<Uuid, PromoterSummary> = HashMap::new();
    let mut interpreter_map: HashMap<Uuid, StaffRankingSummary> = HashMap::new();
    let mut provider_map: HashMap<Uuid, ProviderRankingSummary> = HashMap::new();

    for row in &scoped_rows {
        total_feedback += 1;
        let status = row.try_get::<String, _>("status").unwrap_or_default();
        if status == "reviewed" {
            reviewed_feedback += 1;
        }

        let source = row.try_get::<String, _>("source").unwrap_or_default();
        if source == "patient_portal" {
            patient_portal_count += 1;
        } else if source == "staff_capture" {
            staff_capture_count += 1;
        }

        let overall_score = row.try_get::<i32, _>("overall_score").ok();
        let patient_manager_score = row
            .try_get::<Option<i32>, _>("patient_manager_score")
            .unwrap_or_default();
        let interpreter_score = row
            .try_get::<Option<i32>, _>("interpreter_score")
            .unwrap_or_default();
        let concierge_score = row
            .try_get::<Option<i32>, _>("concierge_score")
            .unwrap_or_default();
        let treatment_score = row
            .try_get::<Option<i32>, _>("treatment_score")
            .unwrap_or_default();
        let doctor_score = row
            .try_get::<Option<i32>, _>("doctor_score")
            .unwrap_or_default();
        let organization_score = row
            .try_get::<Option<i32>, _>("organization_score")
            .unwrap_or_default();
        let service_score = row
            .try_get::<Option<i32>, _>("service_score")
            .unwrap_or_default();
        let infrastructure_score = row
            .try_get::<Option<i32>, _>("infrastructure_score")
            .unwrap_or_default();
        let price_value_score = row
            .try_get::<Option<i32>, _>("price_value_score")
            .unwrap_or_default();
        let treatment_success = row
            .try_get::<Option<String>, _>("treatment_success")
            .unwrap_or_default();
        let complication_reported = row
            .try_get::<bool, _>("complication_reported")
            .unwrap_or(false);
        let nps_score = row.try_get::<i32, _>("nps_score").unwrap_or(0);

        overall.push(overall_score);
        patient_manager.push(patient_manager_score);
        interpreter.push(interpreter_score);
        concierge.push(concierge_score);
        treatment.push(treatment_score);
        doctor.push(doctor_score);
        organization.push(organization_score);
        service.push(service_score);
        infrastructure.push(infrastructure_score);
        price_value.push(price_value_score);

        if let Some(value) = treatment_success {
            treatment_success_samples += 1;
            match value.as_str() {
                "yes" => treatment_success_yes += 1,
                "partial" => treatment_success_partial += 1,
                _ => {}
            }
        }
        if complication_reported {
            complication_count += 1;
        }

        if nps_score >= 9 {
            promoters += 1;
        } else if nps_score >= 7 {
            passives += 1;
        } else {
            detractors += 1;
        }

        let patient_id = row
            .try_get::<Uuid, _>("patient_id")
            .unwrap_or_else(|_| Uuid::nil());
        let patient_pid = row
            .try_get::<Option<String>, _>("patient_pid")
            .unwrap_or_default();
        let patient_name = row.try_get::<String, _>("patient_name").unwrap_or_default();
        let submitted_at = row.try_get::<DateTime<Utc>, _>("submitted_at").ok();

        promoter_map
            .entry(patient_id)
            .and_modify(|entry| {
                entry.sum += i64::from(nps_score);
                entry.count += 1;
                if submitted_at > entry.last_submitted_at {
                    entry.last_submitted_at = submitted_at;
                }
            })
            .or_insert(PromoterSummary {
                patient_id,
                patient_pid,
                patient_name,
                sum: i64::from(nps_score),
                count: 1,
                last_submitted_at: submitted_at,
            });

        if let (Some(interpreter_id), Some(score)) = (
            row.try_get::<Option<Uuid>, _>("interpreter_id")
                .unwrap_or_default(),
            interpreter_score,
        ) {
            let interpreter_name = row
                .try_get::<Option<String>, _>("interpreter_name")
                .unwrap_or_default()
                .unwrap_or_else(|| "Interpreter".to_string());
            interpreter_map
                .entry(interpreter_id)
                .and_modify(|entry| {
                    entry.sum += i64::from(score);
                    entry.count += 1;
                })
                .or_insert(StaffRankingSummary {
                    user_id: interpreter_id,
                    name: interpreter_name,
                    sum: i64::from(score),
                    count: 1,
                });
        }

        if let Some(provider_id) = row
            .try_get::<Option<Uuid>, _>("provider_id")
            .unwrap_or_default()
        {
            let provider_name = row
                .try_get::<Option<String>, _>("provider_name")
                .unwrap_or_default()
                .unwrap_or_else(|| "Clinic".to_string());
            let rating = treatment_score.or(overall_score).unwrap_or(0);
            provider_map
                .entry(provider_id)
                .and_modify(|entry| {
                    entry.sum += i64::from(rating);
                    entry.count += 1;
                })
                .or_insert(ProviderRankingSummary {
                    provider_id,
                    name: provider_name,
                    sum: i64::from(rating),
                    count: 1,
                });
        }
    }

    let nps_score = if total_feedback == 0 {
        0
    } else {
        (((promoters - detractors) as f64 / total_feedback as f64) * 100.0).round() as i64
    };

    let mut top_promoters = promoter_map.into_values().collect::<Vec<_>>();
    top_promoters.sort_by(|left, right| {
        let left_avg = left.sum as f64 / left.count as f64;
        let right_avg = right.sum as f64 / right.count as f64;
        right_avg
            .partial_cmp(&left_avg)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| right.last_submitted_at.cmp(&left.last_submitted_at))
    });

    let mut interpreter_ranking = interpreter_map.into_values().collect::<Vec<_>>();
    interpreter_ranking.sort_by(|left, right| {
        let left_avg = left.sum as f64 / left.count as f64;
        let right_avg = right.sum as f64 / right.count as f64;
        right_avg
            .partial_cmp(&left_avg)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| right.count.cmp(&left.count))
    });

    let mut clinic_ranking = provider_map.into_values().collect::<Vec<_>>();
    clinic_ranking.sort_by(|left, right| {
        let left_avg = left.sum as f64 / left.count as f64;
        let right_avg = right.sum as f64 / right.count as f64;
        right_avg
            .partial_cmp(&left_avg)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| right.count.cmp(&left.count))
    });

    Json(json!({
        "total_feedback": total_feedback,
        "reviewed_feedback": reviewed_feedback,
        "patient_portal_count": patient_portal_count,
        "staff_capture_count": staff_capture_count,
        "nps_score": nps_score,
        "promoters": promoters,
        "passives": passives,
        "detractors": detractors,
        "average_scores": {
            "overall": overall.average(),
            "patient_manager": patient_manager.average(),
            "interpreter": interpreter.average(),
            "concierge": concierge.average(),
            "treatment": treatment.average(),
            "doctor": doctor.average(),
            "organization": organization.average(),
            "service": service.average(),
            "infrastructure": infrastructure.average(),
            "price_value": price_value.average(),
        },
        "treatment_success_yes_rate": percentage(
            treatment_success_yes,
            treatment_success_samples,
        ),
        "treatment_success_partial_rate": percentage(
            treatment_success_partial,
            treatment_success_samples,
        ),
        "complication_rate": percentage(complication_count, total_feedback),
        "top_promoters": top_promoters.into_iter().take(10).map(|item| {
            json!({
                "patient_id": item.patient_id,
                "patient_pid": item.patient_pid,
                "patient_name": item.patient_name,
                "average_nps": item.sum as f64 / item.count as f64,
                "feedback_count": item.count,
                "last_submitted_at": item.last_submitted_at.map(|value| value.to_rfc3339()),
            })
        }).collect::<Vec<_>>(),
        "interpreter_ranking": interpreter_ranking.into_iter().take(10).map(|item| {
            json!({
                "user_id": item.user_id,
                "name": item.name,
                "average_score": item.sum as f64 / item.count as f64,
                "feedback_count": item.count,
            })
        }).collect::<Vec<_>>(),
        "clinic_ranking": clinic_ranking.into_iter().take(10).map(|item| {
            json!({
                "provider_id": item.provider_id,
                "name": item.name,
                "average_score": item.sum as f64 / item.count as f64,
                "feedback_count": item.count,
            })
        }).collect::<Vec<_>>(),
    }))
    .into_response()
}

async fn review_feedback(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(feedback_id): Path<Uuid>,
    Json(body): Json<ReviewFeedbackRequest>,
) -> axum::response::Response {
    if let Err(resp) = auth.require_any_role(&[
        Role::Ceo,
        Role::CeoAssistant,
        Role::PatientManager,
        Role::TeamleadInterpreter,
        Role::Concierge,
    ]) {
        return resp;
    }

    let status = match body.status.trim() {
        "reviewed" => "reviewed",
        "archived" => "archived",
        _ => {
            return err(StatusCode::UNPROCESSABLE_ENTITY, "Invalid review status");
        }
    };

    let feedback_row = match sqlx::query(
        r#"SELECT f.id, f.patient_id, f.interpreter_score, f.concierge_score
           FROM patient_feedback_forms f
           WHERE f.id = $1"#,
    )
    .bind(feedback_id)
    .fetch_optional(&state.db)
    .await
    {
        Ok(Some(row)) => row,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Feedback record not found"),
        Err(e) => {
            tracing::error!(error = %e, feedback_id = %feedback_id, "load feedback review target");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to review feedback",
            );
        }
    };

    let patient_id = feedback_row
        .try_get::<Uuid, _>("patient_id")
        .unwrap_or_else(|_| Uuid::nil());
    if let Err(resp) = ensure_feedback_access(
        &state,
        &auth,
        patient_id,
        feedback_row
            .try_get::<Option<i32>, _>("interpreter_score")
            .unwrap_or_default(),
        feedback_row
            .try_get::<Option<i32>, _>("concierge_score")
            .unwrap_or_default(),
    )
    .await
    {
        return resp;
    }

    let review_note = normalize_optional(body.review_note.as_deref());
    let reviewed_at = Utc::now();

    if let Err(e) = sqlx::query(
        r#"UPDATE patient_feedback_forms
           SET status = $2,
               review_note = $3,
               reviewed_by = $4,
               reviewed_at = $5,
               updated_at = now()
           WHERE id = $1"#,
    )
    .bind(feedback_id)
    .bind(status)
    .bind(review_note.clone())
    .bind(auth.user_id)
    .bind(reviewed_at)
    .execute(&state.db)
    .await
    {
        tracing::error!(error = %e, feedback_id = %feedback_id, "update feedback review");
        return err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to review feedback",
        );
    }

    state.audit_sender.try_send(audit::domain_event(
        "feedback_reviewed",
        Some(auth.user_id),
        "patient",
        Some(patient_id),
        json!({
            "feedback_id": feedback_id,
            "status": status,
            "review_note": review_note,
        }),
    ));

    crate::realtime::publish_feedback_event(
        &state,
        Some(auth.user_id),
        "feedback.reviewed",
        feedback_id,
        json!({
            "patient_id": patient_id,
            "status": status,
            "review_note": review_note.clone(),
            "reviewed_at": reviewed_at.to_rfc3339(),
        }),
    )
    .await;

    Json(json!({
        "ok": true,
        "status": status,
        "review_note": review_note,
        "reviewed_at": reviewed_at.to_rfc3339(),
    }))
    .into_response()
}

async fn create_feedback_record(
    state: &AppState,
    auth: &AuthUser,
    patient_id: Uuid,
    body: CreateFeedbackRequest,
    source: &str,
    allow_internal_note: bool,
) -> Result<axum::response::Response, axum::response::Response> {
    validate_feedback_scores(&body)?;

    let context = resolve_feedback_context(
        state,
        patient_id,
        body.appointment_id,
        body.provider_id,
        body.doctor_id,
    )
    .await?;

    if source == "patient_portal"
        && let Some(appointment_id) = context.appointment_id
    {
        let duplicate_exists = sqlx::query_scalar::<_, bool>(
            r#"SELECT EXISTS(
                   SELECT 1
                   FROM patient_feedback_forms
                   WHERE patient_id = $1
                     AND appointment_id = $2
                     AND source = 'patient_portal'
               )"#,
        )
        .bind(patient_id)
        .bind(appointment_id)
        .fetch_one(&state.db)
        .await
        .unwrap_or(false);
        if duplicate_exists {
            return Err(err(
                StatusCode::CONFLICT,
                "Feedback for this appointment was already submitted",
            ));
        }
    }

    let comments = normalize_optional(body.comments.as_deref());
    let improvement_notes = normalize_optional(body.improvement_notes.as_deref());
    let internal_note = if allow_internal_note {
        normalize_optional(body.internal_note.as_deref())
    } else {
        None
    };
    let submitted_at = Utc::now();

    let inserted = sqlx::query(
        r#"INSERT INTO patient_feedback_forms (
                patient_id, appointment_id, provider_id, doctor_id,
                patient_manager_id, interpreter_id, concierge_id,
                submitted_by, source, status,
                overall_score, patient_manager_score, interpreter_score,
                concierge_score, treatment_score, doctor_score, organization_score,
                service_score, infrastructure_score, price_value_score,
                treatment_success, complication_reported, nps_score,
                comments, improvement_notes, internal_note, submitted_at
           ) VALUES (
                $1, $2, $3, $4,
                $5, $6, $7,
                $8, $9, 'submitted',
                $10, $11, $12,
                $13, $14, $15, $16,
                $17, $18, $19, $20, $21,
                $22, $23, $24, $25, $26
           )
           RETURNING id"#,
    )
    .bind(patient_id)
    .bind(context.appointment_id)
    .bind(context.provider_id)
    .bind(context.doctor_id)
    .bind(context.patient_manager_id)
    .bind(context.interpreter_id)
    .bind(context.concierge_id)
    .bind(auth.user_id)
    .bind(source)
    .bind(body.overall_score)
    .bind(body.patient_manager_score)
    .bind(body.interpreter_score)
    .bind(body.concierge_score)
    .bind(body.treatment_score)
    .bind(body.doctor_score)
    .bind(body.organization_score)
    .bind(body.service_score)
    .bind(body.infrastructure_score)
    .bind(body.price_value_score)
    .bind(normalize_feedback_treatment_success(
        body.treatment_success.as_deref(),
    ))
    .bind(body.complication_reported.unwrap_or(false))
    .bind(body.nps_score)
    .bind(comments.clone())
    .bind(improvement_notes.clone())
    .bind(internal_note.clone())
    .bind(submitted_at)
    .fetch_one(&state.db)
    .await;

    let feedback_id = match inserted {
        Ok(row) => row.try_get::<Uuid, _>("id").unwrap_or_else(|_| Uuid::nil()),
        Err(e) => {
            tracing::error!(error = %e, user_id = %auth.user_id, patient_id = %patient_id, "insert feedback");
            return Err(err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to save feedback",
            ));
        }
    };

    state.audit_sender.try_send(audit::domain_event(
        "feedback_submitted",
        Some(auth.user_id),
        "patient",
        Some(patient_id),
        json!({
            "feedback_id": feedback_id,
            "source": source,
            "appointment_id": context.appointment_id,
            "provider_id": context.provider_id,
            "doctor_id": context.doctor_id,
            "overall_score": body.overall_score,
            "nps_score": body.nps_score,
        }),
    ));

    if source == "patient_portal" {
        let patient_label = load_patient_label(state, patient_id)
            .await
            .unwrap_or_else(|| "Patient".to_string());
        if let Ok(notification_rows) = sqlx::query(
            r#"INSERT INTO user_notifications (user_id, kind, title, body, entity_type, entity_id)
               SELECT DISTINCT u.id, 'feedback', $2, $3, 'feedback', $1
               FROM users u
               LEFT JOIN patient_assignments pa
                 ON pa.user_id = u.id
                AND pa.patient_id = $4
                AND pa.revoked_at IS NULL
               WHERE u.is_active = true
                 AND (
                    u.role = 'ceo'
                    OR (pa.user_id IS NOT NULL AND u.role IN ('patient_manager', 'teamlead_interpreter', 'concierge'))
                 )
               RETURNING id, user_id"#,
        )
        .bind(feedback_id)
        .bind(format!("New patient feedback: {patient_label}"))
        .bind("A patient submitted a satisfaction survey in the portal.")
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
                        state,
                        user_id,
                        "notification.created",
                        Some(notification_id),
                        json!({
                            "entity_type": "feedback",
                            "entity_id": feedback_id,
                        }),
                    )
                    .await;
                }
            }
        }
    }

    crate::realtime::publish_feedback_event(
        state,
        Some(auth.user_id),
        "feedback.submitted",
        feedback_id,
        json!({
            "patient_id": patient_id,
            "source": source,
            "appointment_id": context.appointment_id,
            "provider_id": context.provider_id,
            "doctor_id": context.doctor_id,
            "overall_score": body.overall_score,
            "nps_score": body.nps_score,
            "status": "submitted",
        }),
    )
    .await;

    Ok((
        StatusCode::CREATED,
        Json(json!({
            "id": feedback_id,
            "status": "submitted",
            "source": source,
            "submitted_at": submitted_at.to_rfc3339(),
        })),
    )
        .into_response())
}

async fn resolve_feedback_context(
    state: &AppState,
    patient_id: Uuid,
    appointment_id: Option<Uuid>,
    requested_provider_id: Option<Uuid>,
    requested_doctor_id: Option<Uuid>,
) -> Result<ResolvedFeedbackContext, axum::response::Response> {
    let mut provider_id = requested_provider_id;
    let mut doctor_id = requested_doctor_id;
    let mut interpreter_id = None;

    if let Some(value) = appointment_id {
        let row = sqlx::query(
            r#"SELECT patient_id, provider_id, doctor_id, interpreter_id
               FROM appointments
               WHERE id = $1"#,
        )
        .bind(value)
        .fetch_optional(&state.db)
        .await
        .map_err(|e| {
            tracing::error!(error = %e, appointment_id = %value, "load feedback appointment");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to validate appointment feedback context",
            )
        })?
        .ok_or_else(|| err(StatusCode::NOT_FOUND, "Appointment not found"))?;

        let appointment_patient_id = row
            .try_get::<Uuid, _>("patient_id")
            .unwrap_or_else(|_| Uuid::nil());
        if appointment_patient_id != patient_id {
            return Err(err(
                StatusCode::UNPROCESSABLE_ENTITY,
                "Appointment does not belong to the selected patient",
            ));
        }

        let appointment_provider_id = row
            .try_get::<Option<Uuid>, _>("provider_id")
            .unwrap_or_default();
        let appointment_doctor_id = row
            .try_get::<Option<Uuid>, _>("doctor_id")
            .unwrap_or_default();
        if let Some(requested) = requested_provider_id
            && appointment_provider_id.is_some()
            && appointment_provider_id != Some(requested)
        {
            return Err(err(
                StatusCode::UNPROCESSABLE_ENTITY,
                "Provider does not match appointment context",
            ));
        }
        if let Some(requested) = requested_doctor_id
            && appointment_doctor_id.is_some()
            && appointment_doctor_id != Some(requested)
        {
            return Err(err(
                StatusCode::UNPROCESSABLE_ENTITY,
                "Doctor does not match appointment context",
            ));
        }

        provider_id = appointment_provider_id.or(provider_id);
        doctor_id = appointment_doctor_id.or(doctor_id);
        interpreter_id = row
            .try_get::<Option<Uuid>, _>("interpreter_id")
            .unwrap_or_default();
    }

    if let Some(value) = doctor_id {
        let doctor_row = sqlx::query(
            r#"SELECT provider_id
               FROM provider_doctors
               WHERE id = $1"#,
        )
        .bind(value)
        .fetch_optional(&state.db)
        .await
        .map_err(|e| {
            tracing::error!(error = %e, doctor_id = %value, "validate feedback doctor");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to validate doctor feedback context",
            )
        })?
        .ok_or_else(|| err(StatusCode::NOT_FOUND, "Doctor not found"))?;

        let doctor_provider_id = doctor_row
            .try_get::<Uuid, _>("provider_id")
            .map(Some)
            .unwrap_or_default();
        if let Some(existing_provider_id) = provider_id {
            if doctor_provider_id != Some(existing_provider_id) {
                return Err(err(
                    StatusCode::UNPROCESSABLE_ENTITY,
                    "Doctor does not belong to the selected provider",
                ));
            }
        } else {
            provider_id = doctor_provider_id;
        }
    }

    if let Some(value) = provider_id {
        let provider_exists =
            sqlx::query_scalar::<_, bool>("SELECT EXISTS(SELECT 1 FROM providers WHERE id = $1)")
                .bind(value)
                .fetch_one(&state.db)
                .await
                .unwrap_or(false);
        if !provider_exists {
            return Err(err(StatusCode::NOT_FOUND, "Provider not found"));
        }
    }

    let assignment_rows = sqlx::query(
        r#"SELECT pa.user_id, u.role
           FROM patient_assignments pa
           JOIN users u ON u.id = pa.user_id
           WHERE pa.patient_id = $1
             AND pa.revoked_at IS NULL
             AND u.is_active = true
             AND u.role IN ('patient_manager', 'concierge')
           ORDER BY pa.assigned_at DESC"#,
    )
    .bind(patient_id)
    .fetch_all(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, patient_id = %patient_id, "load feedback assignment context");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to resolve feedback context",
        )
    })?;

    let mut patient_manager_id = None;
    let mut concierge_id = None;
    for row in assignment_rows {
        let role = row.try_get::<String, _>("role").unwrap_or_default();
        let user_id = row.try_get::<Uuid, _>("user_id").ok();
        if role == "patient_manager" && patient_manager_id.is_none() {
            patient_manager_id = user_id;
        }
        if role == "concierge" && concierge_id.is_none() {
            concierge_id = user_id;
        }
    }

    Ok(ResolvedFeedbackContext {
        appointment_id,
        provider_id,
        doctor_id,
        patient_manager_id,
        interpreter_id,
        concierge_id,
    })
}

async fn load_feedback_rows(
    state: &AppState,
    auth: &AuthUser,
    query: &FeedbackListQuery,
    limit: Option<i64>,
) -> Result<Vec<sqlx::postgres::PgRow>, axum::response::Response> {
    let role_name = match auth.role {
        Role::Ceo => "ceo",
        Role::CeoAssistant => "ceo_assistant",
        Role::PatientManager => "patient_manager",
        Role::TeamleadInterpreter => "teamlead_interpreter",
        Role::Concierge => "concierge",
        _ => {
            return Err(err(StatusCode::FORBIDDEN, "Insufficient permissions"));
        }
    };
    let search_pattern = format!("%{}%", query.search.clone().unwrap_or_default().trim());
    let status_filter = query.status.clone().unwrap_or_default();
    let source_filter = query.source.clone().unwrap_or_default();
    let scope_by_assignment = matches!(
        auth.role,
        Role::PatientManager | Role::TeamleadInterpreter | Role::Concierge
    );

    sqlx::query(
        r#"SELECT f.id, f.patient_id, f.appointment_id, f.provider_id, f.doctor_id,
                  f.patient_manager_id, f.interpreter_id, f.concierge_id,
                  f.submitted_by, f.reviewed_by, f.source, f.status,
                  f.overall_score, f.patient_manager_score, f.interpreter_score,
                  f.concierge_score, f.treatment_score, f.doctor_score,
                  f.organization_score, f.service_score, f.infrastructure_score,
                  f.price_value_score, f.treatment_success, f.complication_reported,
                  f.nps_score,
                  f.comments, f.improvement_notes, f.internal_note, f.review_note,
                  f.submitted_at, f.reviewed_at, f.created_at, f.updated_at,
                  p.patient_id AS patient_pid,
                  concat_ws(' ', p.first_name, p.last_name) AS patient_name,
                  a.title AS appointment_title,
                  a.date AS appointment_date,
                  provider.name AS provider_name,
                  doctor.name AS doctor_name,
                  pm.name AS patient_manager_name,
                  interpreter_user.name AS interpreter_name,
                  concierge_user.name AS concierge_name,
                  submitted_by_user.name AS submitted_by_name,
                  reviewed_by_user.name AS reviewed_by_name
           FROM patient_feedback_forms f
           JOIN patients p ON p.id = f.patient_id
           LEFT JOIN appointments a ON a.id = f.appointment_id
           LEFT JOIN providers provider ON provider.id = f.provider_id
           LEFT JOIN provider_doctors doctor ON doctor.id = f.doctor_id
           LEFT JOIN users pm ON pm.id = f.patient_manager_id
           LEFT JOIN users interpreter_user ON interpreter_user.id = f.interpreter_id
           LEFT JOIN users concierge_user ON concierge_user.id = f.concierge_id
           LEFT JOIN users submitted_by_user ON submitted_by_user.id = f.submitted_by
           LEFT JOIN users reviewed_by_user ON reviewed_by_user.id = f.reviewed_by
           WHERE ($1::uuid IS NULL OR f.patient_id = $1)
             AND ($2::uuid IS NULL OR f.provider_id = $2)
             AND ($3::uuid IS NULL OR f.interpreter_id = $3)
             AND ($4 = '' OR f.status = $4)
             AND ($5 = '' OR f.source = $5)
             AND (
                    $6 = '%%'
                    OR concat_ws(
                        ' ',
                        p.patient_id,
                        p.first_name,
                        p.last_name,
                        COALESCE(a.title, ''),
                        COALESCE(provider.name, ''),
                        COALESCE(doctor.name, ''),
                        COALESCE(interpreter_user.name, ''),
                        COALESCE(concierge_user.name, ''),
                        COALESCE(f.comments, ''),
                        COALESCE(f.improvement_notes, '')
                    ) ILIKE $6
                 )
             AND (
                    $7 = false
                    OR EXISTS(
                        SELECT 1
                        FROM patient_assignments pa
                        WHERE pa.patient_id = f.patient_id
                          AND pa.user_id = $8
                          AND pa.revoked_at IS NULL
                    )
                 )
           ORDER BY f.submitted_at DESC, f.created_at DESC
           LIMIT COALESCE($9, 1000000)"#,
    )
    .bind(query.patient_id)
    .bind(query.provider_id)
    .bind(query.interpreter_id)
    .bind(status_filter)
    .bind(source_filter)
    .bind(search_pattern)
    .bind(scope_by_assignment)
    .bind(auth.user_id)
    .bind(limit)
    .fetch_all(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, user_id = %auth.user_id, role = role_name, "load feedback rows");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to load feedback workspace",
        )
    })
}

fn role_can_see_feedback_row(auth: &AuthUser, row: &sqlx::postgres::PgRow) -> bool {
    match auth.role {
        Role::Ceo | Role::CeoAssistant | Role::PatientManager => true,
        Role::TeamleadInterpreter => row
            .try_get::<Option<i32>, _>("interpreter_score")
            .unwrap_or_default()
            .is_some(),
        Role::Concierge => row
            .try_get::<Option<i32>, _>("concierge_score")
            .unwrap_or_default()
            .is_some(),
        _ => false,
    }
}

async fn ensure_feedback_access(
    state: &AppState,
    auth: &AuthUser,
    patient_id: Uuid,
    interpreter_score: Option<i32>,
    concierge_score: Option<i32>,
) -> Result<(), axum::response::Response> {
    match auth.role {
        Role::Ceo | Role::CeoAssistant => Ok(()),
        Role::PatientManager | Role::TeamleadInterpreter | Role::Concierge => {
            let assigned = has_active_patient_assignment(&state.db, patient_id, auth.user_id)
                .await
                .map_err(|e| {
                    tracing::error!(error = %e, user_id = %auth.user_id, patient_id = %patient_id, "validate feedback access");
                    err(
                        StatusCode::INTERNAL_SERVER_ERROR,
                        "Failed to validate feedback access",
                    )
                })?;
            if !assigned {
                return Err(err(StatusCode::FORBIDDEN, "Insufficient permissions"));
            }
            if auth.role == Role::TeamleadInterpreter && interpreter_score.is_none() {
                return Err(err(StatusCode::FORBIDDEN, "Insufficient permissions"));
            }
            if auth.role == Role::Concierge && concierge_score.is_none() {
                return Err(err(StatusCode::FORBIDDEN, "Insufficient permissions"));
            }
            Ok(())
        }
        _ => Err(err(StatusCode::FORBIDDEN, "Insufficient permissions")),
    }
}

fn feedback_row_json(row: sqlx::postgres::PgRow, include_internal: bool) -> Value {
    let mut object = serde_json::Map::from_iter([
        (
            "id".to_string(),
            json!(row.try_get::<Uuid, _>("id").unwrap_or_else(|_| Uuid::nil())),
        ),
        (
            "patient_id".to_string(),
            json!(
                row.try_get::<Uuid, _>("patient_id")
                    .unwrap_or_else(|_| Uuid::nil())
            ),
        ),
        (
            "patient_pid".to_string(),
            json!(
                row.try_get::<Option<String>, _>("patient_pid")
                    .unwrap_or_default()
            ),
        ),
        (
            "patient_name".to_string(),
            json!(row.try_get::<String, _>("patient_name").unwrap_or_default()),
        ),
        (
            "appointment_id".to_string(),
            json!(
                row.try_get::<Option<Uuid>, _>("appointment_id")
                    .unwrap_or_default()
            ),
        ),
        (
            "appointment_title".to_string(),
            json!(
                row.try_get::<Option<String>, _>("appointment_title")
                    .unwrap_or_default()
            ),
        ),
        (
            "appointment_date".to_string(),
            json!(
                row.try_get::<Option<chrono::NaiveDate>, _>("appointment_date")
                    .unwrap_or_default()
                    .map(|value| value.to_string())
            ),
        ),
        (
            "provider_id".to_string(),
            json!(
                row.try_get::<Option<Uuid>, _>("provider_id")
                    .unwrap_or_default()
            ),
        ),
        (
            "provider_name".to_string(),
            json!(
                row.try_get::<Option<String>, _>("provider_name")
                    .unwrap_or_default()
            ),
        ),
        (
            "doctor_id".to_string(),
            json!(
                row.try_get::<Option<Uuid>, _>("doctor_id")
                    .unwrap_or_default()
            ),
        ),
        (
            "doctor_name".to_string(),
            json!(
                row.try_get::<Option<String>, _>("doctor_name")
                    .unwrap_or_default()
            ),
        ),
        (
            "patient_manager_id".to_string(),
            json!(
                row.try_get::<Option<Uuid>, _>("patient_manager_id")
                    .unwrap_or_default()
            ),
        ),
        (
            "patient_manager_name".to_string(),
            json!(
                row.try_get::<Option<String>, _>("patient_manager_name")
                    .unwrap_or_default()
            ),
        ),
        (
            "interpreter_id".to_string(),
            json!(
                row.try_get::<Option<Uuid>, _>("interpreter_id")
                    .unwrap_or_default()
            ),
        ),
        (
            "interpreter_name".to_string(),
            json!(
                row.try_get::<Option<String>, _>("interpreter_name")
                    .unwrap_or_default()
            ),
        ),
        (
            "concierge_id".to_string(),
            json!(
                row.try_get::<Option<Uuid>, _>("concierge_id")
                    .unwrap_or_default()
            ),
        ),
        (
            "concierge_name".to_string(),
            json!(
                row.try_get::<Option<String>, _>("concierge_name")
                    .unwrap_or_default()
            ),
        ),
        (
            "source".to_string(),
            json!(row.try_get::<String, _>("source").unwrap_or_default()),
        ),
        (
            "status".to_string(),
            json!(row.try_get::<String, _>("status").unwrap_or_default()),
        ),
        (
            "overall_score".to_string(),
            json!(row.try_get::<i32, _>("overall_score").unwrap_or(0)),
        ),
        (
            "patient_manager_score".to_string(),
            json!(
                row.try_get::<Option<i32>, _>("patient_manager_score")
                    .unwrap_or_default()
            ),
        ),
        (
            "interpreter_score".to_string(),
            json!(
                row.try_get::<Option<i32>, _>("interpreter_score")
                    .unwrap_or_default()
            ),
        ),
        (
            "concierge_score".to_string(),
            json!(
                row.try_get::<Option<i32>, _>("concierge_score")
                    .unwrap_or_default()
            ),
        ),
        (
            "treatment_score".to_string(),
            json!(
                row.try_get::<Option<i32>, _>("treatment_score")
                    .unwrap_or_default()
            ),
        ),
        (
            "doctor_score".to_string(),
            json!(
                row.try_get::<Option<i32>, _>("doctor_score")
                    .unwrap_or_default()
            ),
        ),
        (
            "organization_score".to_string(),
            json!(
                row.try_get::<Option<i32>, _>("organization_score")
                    .unwrap_or_default()
            ),
        ),
        (
            "service_score".to_string(),
            json!(
                row.try_get::<Option<i32>, _>("service_score")
                    .unwrap_or_default()
            ),
        ),
        (
            "infrastructure_score".to_string(),
            json!(
                row.try_get::<Option<i32>, _>("infrastructure_score")
                    .unwrap_or_default()
            ),
        ),
        (
            "price_value_score".to_string(),
            json!(
                row.try_get::<Option<i32>, _>("price_value_score")
                    .unwrap_or_default()
            ),
        ),
        (
            "treatment_success".to_string(),
            json!(
                row.try_get::<Option<String>, _>("treatment_success")
                    .unwrap_or_default()
            ),
        ),
        (
            "complication_reported".to_string(),
            json!(
                row.try_get::<bool, _>("complication_reported")
                    .unwrap_or(false)
            ),
        ),
        (
            "nps_score".to_string(),
            json!(row.try_get::<i32, _>("nps_score").unwrap_or(0)),
        ),
        (
            "comments".to_string(),
            json!(
                row.try_get::<Option<String>, _>("comments")
                    .unwrap_or_default()
            ),
        ),
        (
            "improvement_notes".to_string(),
            json!(
                row.try_get::<Option<String>, _>("improvement_notes")
                    .unwrap_or_default()
            ),
        ),
        (
            "review_note".to_string(),
            json!(
                row.try_get::<Option<String>, _>("review_note")
                    .unwrap_or_default()
            ),
        ),
        (
            "submitted_by_name".to_string(),
            json!(
                row.try_get::<Option<String>, _>("submitted_by_name")
                    .unwrap_or_default()
            ),
        ),
        (
            "reviewed_by_name".to_string(),
            json!(
                row.try_get::<Option<String>, _>("reviewed_by_name")
                    .unwrap_or_default()
            ),
        ),
        (
            "submitted_at".to_string(),
            json!(
                row.try_get::<DateTime<Utc>, _>("submitted_at")
                    .map(|value| value.to_rfc3339())
                    .unwrap_or_default()
            ),
        ),
        (
            "reviewed_at".to_string(),
            json!(
                row.try_get::<Option<DateTime<Utc>>, _>("reviewed_at")
                    .unwrap_or_default()
                    .map(|value| value.to_rfc3339())
            ),
        ),
    ]);

    if include_internal {
        object.insert(
            "internal_note".to_string(),
            json!(
                row.try_get::<Option<String>, _>("internal_note")
                    .unwrap_or_default()
            ),
        );
    }

    Value::Object(object)
}

#[allow(clippy::result_large_err)]
fn validate_feedback_scores(body: &CreateFeedbackRequest) -> Result<(), axum::response::Response> {
    validate_score_1_5(body.overall_score, "Overall score")?;
    validate_optional_score_1_5(body.patient_manager_score, "Patient manager score")?;
    validate_optional_score_1_5(body.interpreter_score, "Interpreter score")?;
    validate_optional_score_1_5(body.concierge_score, "Concierge score")?;
    validate_optional_score_1_5(body.treatment_score, "Treatment score")?;
    validate_optional_score_1_5(body.doctor_score, "Doctor score")?;
    validate_optional_score_1_5(body.organization_score, "Organization score")?;
    validate_optional_score_1_5(body.service_score, "Service score")?;
    validate_optional_score_1_5(body.infrastructure_score, "Infrastructure score")?;
    validate_optional_score_1_5(body.price_value_score, "Price/value score")?;
    validate_treatment_success(body.treatment_success.as_deref())?;

    if !(0..=10).contains(&body.nps_score) {
        return Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "NPS score must be between 0 and 10",
        ));
    }

    Ok(())
}

#[allow(clippy::result_large_err)]
fn validate_score_1_5(value: i32, label: &str) -> Result<(), axum::response::Response> {
    if (1..=5).contains(&value) {
        Ok(())
    } else {
        Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            &format!("{label} must be between 1 and 5"),
        ))
    }
}

#[allow(clippy::result_large_err)]
fn validate_optional_score_1_5(
    value: Option<i32>,
    label: &str,
) -> Result<(), axum::response::Response> {
    if let Some(value) = value {
        validate_score_1_5(value, label)?;
    }
    Ok(())
}

fn normalize_optional(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

#[allow(clippy::result_large_err)]
fn validate_treatment_success(value: Option<&str>) -> Result<(), axum::response::Response> {
    match normalize_feedback_treatment_success(value) {
        Some(normalized) if matches!(normalized.as_str(), "no" | "partial" | "yes") => Ok(()),
        Some(_) => Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Treatment success must be one of: no, partial, yes",
        )),
        None => Ok(()),
    }
}

fn normalize_feedback_treatment_success(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.to_ascii_lowercase())
}

async fn load_patient_label(state: &AppState, patient_id: Uuid) -> Option<String> {
    sqlx::query(
        r#"SELECT trim(concat_ws(' ', first_name, last_name)) AS patient_name
           FROM patients
           WHERE id = $1"#,
    )
    .bind(patient_id)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten()
    .and_then(|row| row.try_get::<String, _>("patient_name").ok())
    .filter(|value| !value.trim().is_empty())
}

fn err(status: StatusCode, message: &str) -> axum::response::Response {
    (
        status,
        Json(json!({
            "error": status.canonical_reason().unwrap_or("error"),
            "message": message,
        })),
    )
        .into_response()
}
