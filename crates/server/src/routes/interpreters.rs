use axum::{
    Json, Router,
    extract::{Extension, Path, Query, State},
    http::StatusCode,
    response::IntoResponse,
    routing::get,
};
use chrono::NaiveDate;
use rust_decimal::Decimal;
use serde::Deserialize;
use serde_json::{Map, Value};
use sqlx::{Postgres, Row, Transaction};
use std::str::FromStr;
use uuid::Uuid;

use crate::access;
use crate::auth::middleware::AuthUser;
use crate::services::interpreter_suggestions::load_appointment_interpreter_suggestions;
use crate::state::AppState;
use gmed_domain::role::Role;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/interpreters", get(list_interpreter_profiles))
        .route(
            "/interpreters/{interpreter_id}/profile",
            get(get_interpreter_profile).put(update_interpreter_profile),
        )
        .route(
            "/interpreters/{interpreter_id}/profile/operations",
            get(get_interpreter_profile_operations),
        )
        .route(
            "/appointments/{appointment_id}/interpreter-suggestions",
            get(get_interpreter_suggestions),
        )
        .route(
            "/interpreters/{interpreter_id}/languages",
            get(list_interpreter_languages).post(replace_interpreter_languages),
        )
}

#[derive(Deserialize)]
struct ListInterpreterProfilesQuery {
    status: Option<String>,
    contract_type: Option<String>,
    search: Option<String>,
}

#[derive(Deserialize)]
struct ReplaceInterpreterLanguages {
    languages: Vec<InterpreterLanguageInput>,
}

#[derive(Deserialize)]
struct InterpreterLanguageInput {
    language_code: String,
    language_label: Option<String>,
    proficiency: Option<String>,
}

async fn list_interpreter_profiles(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Query(query): Query<ListInterpreterProfilesQuery>,
) -> axum::response::Response {
    if let Err(resp) = auth.require_any_role(&[
        Role::Ceo,
        Role::PatientManager,
        Role::TeamleadInterpreter,
        Role::ItAdmin,
    ]) {
        return resp;
    }

    let status = match normalize_optional_query_enum(
        query.status,
        &[
            "active",
            "vacation",
            "sick",
            "training",
            "blocked",
            "terminated",
        ],
        "Invalid interpreter status",
    ) {
        Ok(value) => value,
        Err(resp) => return resp,
    };
    let contract_type = match normalize_optional_query_enum(
        query.contract_type,
        &["employee", "freelancer", "hourly"],
        "Invalid contract type",
    ) {
        Ok(value) => value,
        Err(resp) => return resp,
    };
    let search_pattern = format!(
        "%{}%",
        normalize_optional_text(query.search).unwrap_or_default()
    );

    match sqlx::query(
        r#"SELECT u.id, u.name, u.email, u.role, u.is_active,
                  COALESCE(p.profile, '{}'::jsonb) AS raw_profile,
                  p.updated_at AS profile_updated_at,
                  d.gender, d.birth_date, COALESCE(d.status, 'active') AS typed_status,
                  d.contract_type, d.contract_start_date, d.contract_end_date,
                  d.employment_kind, d.phone, d.email_secure, d.address, d.emergency_contact,
                  d.medical_knowledge, d.training_history, d.work_permit_valid_until AS detail_work_permit_valid_until,
                  d.internal_notes, d.retention_delete_at, d.erasure_request_status,
                  c.confidentiality_status, c.confidentiality_signed_at, c.confidentiality_document_url,
                  c.avv_status, c.avv_signed_at, c.avv_document_url, c.gdpr_training_at,
                  c.work_permit_valid_until AS compliance_work_permit_valid_until,
                  f.hourly_rate, f.salary_class, f.bank_details, f.tax_number, f.ust_idnr, f.billing_status,
                  a.access_level, a.auto_block_policy,
                  COALESCE((
                    SELECT jsonb_agg(w.value ORDER BY w.sort_order, w.value)
                    FROM interpreter_work_zones w
                    WHERE w.interpreter_id = u.id AND w.zone_type = 'country'
                  ), '[]'::jsonb) AS work_countries,
                  COALESCE((
                    SELECT jsonb_agg(w.value ORDER BY w.sort_order, w.value)
                    FROM interpreter_work_zones w
                    WHERE w.interpreter_id = u.id AND w.zone_type = 'location'
                  ), '[]'::jsonb) AS work_locations,
                  COALESCE((
                    SELECT jsonb_agg(e.label ORDER BY e.sort_order, e.label)
                    FROM interpreter_equipment e
                    WHERE e.interpreter_id = u.id
                  ), '[]'::jsonb) AS equipment
           FROM users u
           LEFT JOIN interpreter_profiles p ON p.user_id = u.id
           LEFT JOIN interpreter_profile_details d ON d.user_id = u.id
           LEFT JOIN interpreter_compliance_profiles c ON c.user_id = u.id
           LEFT JOIN interpreter_finance_profiles f ON f.user_id = u.id
           LEFT JOIN interpreter_access_profiles a ON a.user_id = u.id
           WHERE u.role IN ('interpreter', 'teamlead_interpreter')
             AND ($1::text IS NULL OR COALESCE(d.status, 'active') = $1)
             AND ($2::text IS NULL OR d.contract_type = $2)
             AND ($3::text = '%%' OR u.name ILIKE $3 OR u.email ILIKE $3)
           ORDER BY u.is_active DESC, u.name"#,
    )
    .bind(status)
    .bind(contract_type)
    .bind(search_pattern)
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => Json(
            rows.into_iter()
                .map(interpreter_profile_row_json)
                .collect::<Vec<_>>(),
        )
        .into_response(),
        Err(error) => {
            tracing::error!(error = %error, "list interpreter profiles");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to load interpreter profiles",
            )
        }
    }
}

async fn get_interpreter_profile(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(interpreter_id): Path<Uuid>,
) -> axum::response::Response {
    if let Err(resp) = ensure_interpreter_profile_access(&state, &auth, interpreter_id, false).await
    {
        return resp;
    }

    match sqlx::query(
        r#"SELECT u.id, u.name, u.email, u.role, u.is_active,
                  COALESCE(p.profile, '{}'::jsonb) AS raw_profile,
                  p.updated_at AS profile_updated_at,
                  d.gender, d.birth_date, COALESCE(d.status, 'active') AS typed_status,
                  d.contract_type, d.contract_start_date, d.contract_end_date,
                  d.employment_kind, d.phone, d.email_secure, d.address, d.emergency_contact,
                  d.medical_knowledge, d.training_history, d.work_permit_valid_until AS detail_work_permit_valid_until,
                  d.internal_notes, d.retention_delete_at, d.erasure_request_status,
                  c.confidentiality_status, c.confidentiality_signed_at, c.confidentiality_document_url,
                  c.avv_status, c.avv_signed_at, c.avv_document_url, c.gdpr_training_at,
                  c.work_permit_valid_until AS compliance_work_permit_valid_until,
                  f.hourly_rate, f.salary_class, f.bank_details, f.tax_number, f.ust_idnr, f.billing_status,
                  a.access_level, a.auto_block_policy,
                  COALESCE((
                    SELECT jsonb_agg(w.value ORDER BY w.sort_order, w.value)
                    FROM interpreter_work_zones w
                    WHERE w.interpreter_id = u.id AND w.zone_type = 'country'
                  ), '[]'::jsonb) AS work_countries,
                  COALESCE((
                    SELECT jsonb_agg(w.value ORDER BY w.sort_order, w.value)
                    FROM interpreter_work_zones w
                    WHERE w.interpreter_id = u.id AND w.zone_type = 'location'
                  ), '[]'::jsonb) AS work_locations,
                  COALESCE((
                    SELECT jsonb_agg(e.label ORDER BY e.sort_order, e.label)
                    FROM interpreter_equipment e
                    WHERE e.interpreter_id = u.id
                  ), '[]'::jsonb) AS equipment
           FROM users u
           LEFT JOIN interpreter_profiles p ON p.user_id = u.id
           LEFT JOIN interpreter_profile_details d ON d.user_id = u.id
           LEFT JOIN interpreter_compliance_profiles c ON c.user_id = u.id
           LEFT JOIN interpreter_finance_profiles f ON f.user_id = u.id
           LEFT JOIN interpreter_access_profiles a ON a.user_id = u.id
           WHERE u.id = $1
             AND u.role IN ('interpreter', 'teamlead_interpreter')"#,
    )
    .bind(interpreter_id)
    .fetch_optional(&state.db)
    .await
    {
        Ok(Some(row)) => Json(interpreter_profile_row_json(row)).into_response(),
        Ok(None) => err(StatusCode::NOT_FOUND, "Interpreter not found"),
        Err(error) => {
            tracing::error!(error = %error, interpreter_id = %interpreter_id, "get interpreter profile");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to load interpreter profile",
            )
        }
    }
}

async fn update_interpreter_profile(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(interpreter_id): Path<Uuid>,
    Json(body): Json<Value>,
) -> axum::response::Response {
    if let Err(resp) = ensure_interpreter_profile_access(&state, &auth, interpreter_id, true).await
    {
        return resp;
    }

    let profile = match normalize_profile_payload(body) {
        Ok(value) => value,
        Err(resp) => return resp,
    };

    let mut tx = match state.db.begin().await {
        Ok(tx) => tx,
        Err(error) => {
            tracing::error!(error = %error, "begin interpreter profile update");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to save interpreter profile",
            );
        }
    };

    if let Err(error) = sqlx::query(
        r#"INSERT INTO interpreter_profiles (user_id, profile, updated_by)
           VALUES ($1, $2, $3)
           ON CONFLICT (user_id)
           DO UPDATE SET profile = EXCLUDED.profile,
                         updated_by = EXCLUDED.updated_by,
                         updated_at = now()"#,
    )
    .bind(interpreter_id)
    .bind(&profile)
    .bind(auth.user_id)
    .execute(&mut *tx)
    .await
    {
        tracing::error!(error = %error, interpreter_id = %interpreter_id, "update raw interpreter profile");
        return err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to save interpreter profile",
        );
    }

    if let Err(resp) =
        save_structured_interpreter_profile(&mut tx, interpreter_id, auth.user_id, &profile).await
    {
        return resp;
    }

    if let Err(error) = tx.commit().await {
        tracing::error!(error = %error, interpreter_id = %interpreter_id, "commit interpreter profile");
        return err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to save interpreter profile",
        );
    }

    match load_interpreter_profile_payload(&state, interpreter_id).await {
        Ok(Some(payload)) => Json(payload).into_response(),
        Ok(None) => err(StatusCode::NOT_FOUND, "Interpreter not found"),
        Err(error) => {
            tracing::error!(error = %error, interpreter_id = %interpreter_id, "load saved interpreter profile");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to load interpreter profile",
            )
        }
    }
}

async fn get_interpreter_profile_operations(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(interpreter_id): Path<Uuid>,
) -> axum::response::Response {
    if let Err(resp) = ensure_interpreter_profile_access(&state, &auth, interpreter_id, false).await
    {
        return resp;
    }

    match load_interpreter_operations_payload(&state, interpreter_id).await {
        Ok(payload) => Json(payload).into_response(),
        Err(error) => {
            tracing::error!(error = %error, interpreter_id = %interpreter_id, "load interpreter operations profile");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to load interpreter operations",
            )
        }
    }
}

async fn get_interpreter_suggestions(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(appointment_id): Path<Uuid>,
) -> axum::response::Response {
    if let Err(resp) =
        auth.require_any_role(&[Role::PatientManager, Role::TeamleadInterpreter, Role::Ceo])
    {
        return resp;
    }

    let row = match sqlx::query(
        "SELECT patient_id, interpreter_id, owner_user_id FROM appointments WHERE id = $1",
    )
    .bind(appointment_id)
    .fetch_optional(&state.db)
    .await
    {
        Ok(value) => value,
        Err(error) => {
            tracing::error!(error = %error, appointment_id = %appointment_id, "load appointment for interpreter suggestions");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to load appointment",
            );
        }
    };

    let Some(row) = row else {
        return err(StatusCode::NOT_FOUND, "Appointment not found");
    };
    let patient_id = match row.try_get::<Uuid, _>("patient_id") {
        Ok(value) => value,
        Err(_) => {
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to decode appointment",
            );
        }
    };
    if let Err(resp) = ensure_patient_scope(&state, &auth, patient_id).await {
        return resp;
    }

    match load_appointment_interpreter_suggestions(&state.db, appointment_id).await {
        Ok(suggestions) => Json(suggestions).into_response(),
        Err(error) => {
            tracing::error!(error = %error, appointment_id = %appointment_id, "load interpreter suggestions");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to load interpreter suggestions",
            )
        }
    }
}

async fn list_interpreter_languages(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(interpreter_id): Path<Uuid>,
) -> axum::response::Response {
    if let Err(resp) =
        auth.require_any_role(&[Role::TeamleadInterpreter, Role::PatientManager, Role::Ceo])
    {
        return resp;
    }

    match sqlx::query(
        r#"SELECT id, language_code, language_label, proficiency, is_active
           FROM interpreter_languages
           WHERE interpreter_id = $1
           ORDER BY is_active DESC, language_code"#,
    )
    .bind(interpreter_id)
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => Json(
            rows.into_iter()
                .map(|row| {
                    serde_json::json!({
                        "id": row.try_get::<Uuid, _>("id").unwrap_or_default(),
                        "language_code": row.try_get::<String, _>("language_code").unwrap_or_default(),
                        "language_label": row.try_get::<Option<String>, _>("language_label").unwrap_or_default(),
                        "proficiency": row.try_get::<String, _>("proficiency").unwrap_or_else(|_| "working".to_string()),
                        "is_active": row.try_get::<bool, _>("is_active").unwrap_or(true),
                    })
                })
                .collect::<Vec<_>>(),
        )
        .into_response(),
        Err(error) => {
            tracing::error!(error = %error, interpreter_id = %interpreter_id, "list interpreter languages");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to load interpreter languages",
            )
        }
    }
}

async fn replace_interpreter_languages(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(interpreter_id): Path<Uuid>,
    Json(body): Json<ReplaceInterpreterLanguages>,
) -> axum::response::Response {
    if let Err(resp) = auth.require_any_role(&[Role::TeamleadInterpreter]) {
        return resp;
    }
    if body.languages.len() > 20 {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Too many interpreter languages",
        );
    }

    let interpreter_exists = match sqlx::query_scalar::<_, bool>(
        r#"SELECT EXISTS(
                SELECT 1
                FROM users
                WHERE id = $1
                  AND is_active = true
                  AND role IN ('interpreter', 'teamlead_interpreter')
           )"#,
    )
    .bind(interpreter_id)
    .fetch_one(&state.db)
    .await
    {
        Ok(value) => value,
        Err(error) => {
            tracing::error!(error = %error, interpreter_id = %interpreter_id, "validate interpreter for languages");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to validate interpreter",
            );
        }
    };
    if !interpreter_exists {
        return err(StatusCode::NOT_FOUND, "Interpreter not found");
    }

    let mut tx = match state.db.begin().await {
        Ok(tx) => tx,
        Err(error) => {
            tracing::error!(error = %error, "begin interpreter language replace");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to save interpreter languages",
            );
        }
    };

    if let Err(error) = sqlx::query("DELETE FROM interpreter_languages WHERE interpreter_id = $1")
        .bind(interpreter_id)
        .execute(&mut *tx)
        .await
    {
        tracing::error!(error = %error, interpreter_id = %interpreter_id, "clear interpreter languages");
        return err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to save interpreter languages",
        );
    }

    for input in body.languages {
        let Some(language_code) = normalize_language_code(&input.language_code) else {
            return err(StatusCode::UNPROCESSABLE_ENTITY, "Invalid language code");
        };
        let proficiency = input
            .proficiency
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or("working");
        if !matches!(
            proficiency,
            "native" | "fluent" | "working" | "basic" | "unknown"
        ) {
            return err(StatusCode::UNPROCESSABLE_ENTITY, "Invalid proficiency");
        }

        if let Err(error) = sqlx::query(
            r#"INSERT INTO interpreter_languages (
                    interpreter_id, language_code, language_label, proficiency
               ) VALUES ($1, $2, $3, $4)"#,
        )
        .bind(interpreter_id)
        .bind(language_code)
        .bind(normalize_optional_text(input.language_label))
        .bind(proficiency)
        .execute(&mut *tx)
        .await
        {
            tracing::error!(error = %error, interpreter_id = %interpreter_id, "insert interpreter language");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to save interpreter languages",
            );
        }
    }

    if let Err(error) = tx.commit().await {
        tracing::error!(error = %error, interpreter_id = %interpreter_id, "commit interpreter languages");
        return err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to save interpreter languages",
        );
    }

    Json(serde_json::json!({"ok": true})).into_response()
}

async fn load_interpreter_operations_payload(
    state: &AppState,
    interpreter_id: Uuid,
) -> Result<Value, sqlx::Error> {
    let summary_row = sqlx::query(
        r#"SELECT
                (SELECT COUNT(DISTINCT a.patient_id)
                   FROM appointments a
                  WHERE a.interpreter_id = $1) AS assigned_patients,
                (SELECT COUNT(DISTINCT a.patient_id)
                   FROM appointments a
                   JOIN patients p ON p.id = a.patient_id
                  WHERE a.interpreter_id = $1
                    AND p.is_active = true
                    AND a.status <> 'cancelled') AS active_patients,
                (SELECT COUNT(*)
                   FROM appointments a
                  WHERE a.interpreter_id = $1
                    AND a.date >= date_trunc('month', CURRENT_DATE)::date
                    AND a.date < (date_trunc('month', CURRENT_DATE) + interval '1 month')::date
                    AND a.status <> 'cancelled') AS appointments_this_month,
                (SELECT COUNT(*)
                   FROM appointments a
                  WHERE a.interpreter_id = $1
                    AND a.date >= CURRENT_DATE
                    AND a.date < CURRENT_DATE + interval '30 days'
                    AND a.status <> 'cancelled') AS appointments_next_30_days,
                (SELECT COUNT(*)
                   FROM appointments a
                  WHERE a.interpreter_id = $1
                    AND a.status = 'completed') AS completed_appointments,
                (SELECT ROUND(COALESCE(SUM(
                    CASE
                        WHEN a.time_start IS NOT NULL
                         AND a.time_end IS NOT NULL
                         AND a.time_end > a.time_start
                        THEN EXTRACT(EPOCH FROM (a.time_end - a.time_start)) / 3600.0
                        ELSE 0
                    END
                ), 0)::numeric, 2)
                   FROM appointments a
                  WHERE a.interpreter_id = $1
                    AND a.date >= date_trunc('week', CURRENT_DATE)::date
                    AND a.date < (date_trunc('week', CURRENT_DATE) + interval '7 days')::date
                    AND a.status <> 'cancelled') AS booked_hours_week,
                (SELECT ROUND(AVG(f.interpreter_score)::numeric, 2)
                   FROM patient_feedback_forms f
                  WHERE f.interpreter_id = $1
                    AND f.interpreter_score IS NOT NULL) AS average_feedback_score,
                (SELECT COUNT(*)
                   FROM patient_feedback_forms f
                  WHERE f.interpreter_id = $1
                    AND f.interpreter_score IS NOT NULL) AS feedback_count,
                (SELECT COUNT(*)
                   FROM interpreter_reports ir
                  WHERE ir.interpreter_id = $1
                    AND ir.approval_status = 'approved') AS approved_reports,
                (SELECT COUNT(*)
                   FROM interpreter_reports ir
                  WHERE ir.interpreter_id = $1
                    AND ir.approval_status = 'pending') AS pending_reports,
                (SELECT ROUND(COALESCE(SUM(ir.hours), 0)::numeric, 2)
                   FROM interpreter_reports ir
                  WHERE ir.interpreter_id = $1
                    AND ir.approval_status = 'approved') AS approved_report_hours,
                (SELECT COUNT(*)
                   FROM tasks t
                  WHERE t.assigned_to = $1
                    AND t.status IN ('open', 'in_progress')) AS active_tasks,
                (SELECT COUNT(*)
                   FROM tasks t
                  WHERE t.assigned_to = $1
                    AND t.status IN ('open', 'in_progress')
                    AND t.due_date IS NOT NULL
                    AND t.due_date < now()) AS overdue_tasks,
                (SELECT COUNT(*)
                   FROM order_leistungen ol
                   JOIN interpreter_reports ir ON ir.id = ol.source_interpreter_report_id
                  WHERE ir.interpreter_id = $1) AS synced_billing_lines,
                (SELECT ROUND(COALESCE(SUM(ol.quantity * ol.unit_price), 0)::numeric, 2)
                   FROM order_leistungen ol
                   JOIN interpreter_reports ir ON ir.id = ol.source_interpreter_report_id
                  WHERE ir.interpreter_id = $1) AS synced_billing_net,
                (SELECT p.profile
                   FROM interpreter_profiles p
                  WHERE p.user_id = $1) AS raw_profile"#,
    )
    .bind(interpreter_id)
    .fetch_one(&state.db)
    .await?;

    let raw_profile = summary_row
        .try_get::<Option<Value>, _>("raw_profile")
        .unwrap_or_default();
    let capacity_hours_week = raw_profile
        .as_ref()
        .and_then(|profile| f64_from_profile_number(profile, "weeklyCapacityHours"));
    let booked_hours_week = summary_row
        .try_get::<Option<Decimal>, _>("booked_hours_week")
        .unwrap_or_default()
        .and_then(decimal_to_f64)
        .unwrap_or(0.0);
    let utilization_percent = capacity_hours_week
        .filter(|capacity| *capacity > 0.0)
        .map(|capacity| ((booked_hours_week / capacity) * 100.0).round());

    let patient_rows = sqlx::query(
        r#"SELECT p.id AS patient_id, p.patient_id AS patient_code,
                  p.first_name, p.last_name,
                  COUNT(a.id) AS appointment_count,
                  MAX(a.date) FILTER (WHERE a.date <= CURRENT_DATE) AS last_appointment_date,
                  MIN(a.date) FILTER (
                    WHERE a.date >= CURRENT_DATE AND a.status <> 'cancelled'
                  ) AS next_appointment_date,
                  COALESCE(BOOL_OR(
                    a.date >= CURRENT_DATE AND a.status IN ('planned', 'confirmed', 'in_progress')
                  ), false) AS active_relation,
                  pref.preference
           FROM appointments a
           JOIN patients p ON p.id = a.patient_id
           LEFT JOIN interpreter_patient_preferences pref
                  ON pref.patient_id = p.id
                 AND pref.interpreter_id = $1
           WHERE a.interpreter_id = $1
           GROUP BY p.id, pref.preference
           ORDER BY active_relation DESC,
                    next_appointment_date ASC NULLS LAST,
                    last_appointment_date DESC NULLS LAST,
                    p.last_name, p.first_name
           LIMIT 12"#,
    )
    .bind(interpreter_id)
    .fetch_all(&state.db)
    .await?;

    let upcoming_rows = sqlx::query(
        r#"SELECT a.id, a.title, a.date, a.time_start, a.time_end,
                  a.status, a.interpreter_response, a.location,
                  p.id AS patient_id, p.patient_id AS patient_code,
                  p.first_name, p.last_name,
                  o.id AS order_id, o.order_number
           FROM appointments a
           JOIN patients p ON p.id = a.patient_id
           LEFT JOIN orders o ON o.id = a.order_id
           WHERE a.interpreter_id = $1
             AND a.date >= CURRENT_DATE
             AND a.status <> 'cancelled'
           ORDER BY a.date ASC, a.time_start ASC NULLS LAST
           LIMIT 8"#,
    )
    .bind(interpreter_id)
    .fetch_all(&state.db)
    .await?;

    let task_rows = sqlx::query(
        r#"SELECT t.id, t.title, t.status, t.priority, t.due_date,
                  p.id AS patient_id, p.patient_id AS patient_code,
                  p.first_name, p.last_name,
                  o.id AS order_id, o.order_number,
                  t.appointment_id
           FROM tasks t
           LEFT JOIN patients p ON p.id = t.patient_id
           LEFT JOIN orders o ON o.id = t.order_id
           WHERE t.assigned_to = $1
             AND t.status IN ('open', 'in_progress')
           ORDER BY CASE t.priority
                        WHEN 'urgent' THEN 0
                        WHEN 'high' THEN 1
                        WHEN 'normal' THEN 2
                        ELSE 3
                    END,
                    t.due_date ASC NULLS LAST,
                    t.created_at DESC
           LIMIT 8"#,
    )
    .bind(interpreter_id)
    .fetch_all(&state.db)
    .await?;

    let report_rows = sqlx::query(
        r#"SELECT ir.id, ir.appointment_id, ir.hours, ir.approval_status,
                  ir.created_at, a.title AS appointment_title, a.date,
                  p.id AS patient_id, p.patient_id AS patient_code,
                  p.first_name, p.last_name,
                  ol.id AS billing_line_id, ol.status AS billing_status
           FROM interpreter_reports ir
           JOIN appointments a ON a.id = ir.appointment_id
           JOIN patients p ON p.id = a.patient_id
           LEFT JOIN order_leistungen ol ON ol.source_interpreter_report_id = ir.id
           WHERE ir.interpreter_id = $1
           ORDER BY ir.created_at DESC
           LIMIT 8"#,
    )
    .bind(interpreter_id)
    .fetch_all(&state.db)
    .await?;

    let billing_rows = sqlx::query(
        r#"SELECT ol.id, ol.order_id, o.order_number, ol.description,
                  ol.quantity, ol.unit_price, ol.currency, ol.status,
                  ir.id AS report_id, ir.hours
           FROM order_leistungen ol
           JOIN interpreter_reports ir ON ir.id = ol.source_interpreter_report_id
           JOIN orders o ON o.id = ol.order_id
           WHERE ir.interpreter_id = $1
           ORDER BY ol.created_at DESC
           LIMIT 8"#,
    )
    .bind(interpreter_id)
    .fetch_all(&state.db)
    .await?;

    Ok(serde_json::json!({
        "summary": {
            "assigned_patients": row_i64(&summary_row, "assigned_patients"),
            "active_patients": row_i64(&summary_row, "active_patients"),
            "appointments_this_month": row_i64(&summary_row, "appointments_this_month"),
            "appointments_next_30_days": row_i64(&summary_row, "appointments_next_30_days"),
            "completed_appointments": row_i64(&summary_row, "completed_appointments"),
            "booked_hours_week": booked_hours_week,
            "capacity_hours_week": capacity_hours_week,
            "utilization_percent": utilization_percent,
            "average_feedback_score": optional_decimal_json(&summary_row, "average_feedback_score"),
            "feedback_count": row_i64(&summary_row, "feedback_count"),
            "approved_reports": row_i64(&summary_row, "approved_reports"),
            "pending_reports": row_i64(&summary_row, "pending_reports"),
            "approved_report_hours": decimal_json_or_zero(&summary_row, "approved_report_hours"),
            "active_tasks": row_i64(&summary_row, "active_tasks"),
            "overdue_tasks": row_i64(&summary_row, "overdue_tasks"),
            "synced_billing_lines": row_i64(&summary_row, "synced_billing_lines"),
            "synced_billing_net": decimal_json_or_zero(&summary_row, "synced_billing_net"),
        },
        "patients": patient_rows.into_iter().map(|row| serde_json::json!({
            "patient_id": row.try_get::<Uuid, _>("patient_id").unwrap_or_default(),
            "patient_code": row.try_get::<String, _>("patient_code").unwrap_or_default(),
            "patient_name": person_name_from_row(&row),
            "appointment_count": row_i64(&row, "appointment_count"),
            "last_appointment_date": row_date_string(&row, "last_appointment_date"),
            "next_appointment_date": row_date_string(&row, "next_appointment_date"),
            "active_relation": row.try_get::<bool, _>("active_relation").unwrap_or(false),
            "preference": row.try_get::<Option<String>, _>("preference").unwrap_or_default(),
        })).collect::<Vec<_>>(),
        "upcoming_appointments": upcoming_rows.into_iter().map(|row| serde_json::json!({
            "id": row.try_get::<Uuid, _>("id").unwrap_or_default(),
            "title": row.try_get::<String, _>("title").unwrap_or_default(),
            "date": row_date_string(&row, "date"),
            "time_start": row_time_string(&row, "time_start"),
            "time_end": row_time_string(&row, "time_end"),
            "status": row.try_get::<String, _>("status").unwrap_or_default(),
            "interpreter_response": row.try_get::<Option<String>, _>("interpreter_response").unwrap_or_default(),
            "location": row.try_get::<Option<String>, _>("location").unwrap_or_default(),
            "patient_id": row.try_get::<Uuid, _>("patient_id").unwrap_or_default(),
            "patient_code": row.try_get::<String, _>("patient_code").unwrap_or_default(),
            "patient_name": person_name_from_row(&row),
            "order_id": row.try_get::<Option<Uuid>, _>("order_id").unwrap_or_default(),
            "order_number": row.try_get::<Option<String>, _>("order_number").unwrap_or_default(),
        })).collect::<Vec<_>>(),
        "active_tasks": task_rows.into_iter().map(|row| serde_json::json!({
            "id": row.try_get::<Uuid, _>("id").unwrap_or_default(),
            "title": row.try_get::<String, _>("title").unwrap_or_default(),
            "status": row.try_get::<String, _>("status").unwrap_or_default(),
            "priority": row.try_get::<String, _>("priority").unwrap_or_default(),
            "due_date": row_datetime_string(&row, "due_date"),
            "patient_id": row.try_get::<Option<Uuid>, _>("patient_id").unwrap_or_default(),
            "patient_code": row.try_get::<Option<String>, _>("patient_code").unwrap_or_default(),
            "patient_name": optional_person_name_from_row(&row),
            "order_id": row.try_get::<Option<Uuid>, _>("order_id").unwrap_or_default(),
            "order_number": row.try_get::<Option<String>, _>("order_number").unwrap_or_default(),
            "appointment_id": row.try_get::<Option<Uuid>, _>("appointment_id").unwrap_or_default(),
        })).collect::<Vec<_>>(),
        "recent_reports": report_rows.into_iter().map(|row| serde_json::json!({
            "id": row.try_get::<Uuid, _>("id").unwrap_or_default(),
            "appointment_id": row.try_get::<Uuid, _>("appointment_id").unwrap_or_default(),
            "appointment_title": row.try_get::<String, _>("appointment_title").unwrap_or_default(),
            "appointment_date": row_date_string(&row, "date"),
            "hours": optional_decimal_json(&row, "hours"),
            "approval_status": row.try_get::<String, _>("approval_status").unwrap_or_default(),
            "created_at": row_datetime_string(&row, "created_at"),
            "patient_id": row.try_get::<Uuid, _>("patient_id").unwrap_or_default(),
            "patient_code": row.try_get::<String, _>("patient_code").unwrap_or_default(),
            "patient_name": person_name_from_row(&row),
            "billing_line_id": row.try_get::<Option<Uuid>, _>("billing_line_id").unwrap_or_default(),
            "billing_status": row.try_get::<Option<String>, _>("billing_status").unwrap_or_default(),
        })).collect::<Vec<_>>(),
        "billing_lines": billing_rows.into_iter().map(|row| serde_json::json!({
            "id": row.try_get::<Uuid, _>("id").unwrap_or_default(),
            "order_id": row.try_get::<Uuid, _>("order_id").unwrap_or_default(),
            "order_number": row.try_get::<String, _>("order_number").unwrap_or_default(),
            "description": row.try_get::<String, _>("description").unwrap_or_default(),
            "quantity": optional_decimal_json(&row, "quantity"),
            "unit_price": optional_decimal_json(&row, "unit_price"),
            "currency": row.try_get::<String, _>("currency").unwrap_or_else(|_| "EUR".to_string()),
            "status": row.try_get::<String, _>("status").unwrap_or_default(),
            "report_id": row.try_get::<Uuid, _>("report_id").unwrap_or_default(),
            "hours": optional_decimal_json(&row, "hours"),
        })).collect::<Vec<_>>(),
    }))
}

async fn ensure_interpreter_profile_access(
    state: &AppState,
    auth: &AuthUser,
    interpreter_id: Uuid,
    write: bool,
) -> Result<(), axum::response::Response> {
    let allowed = if write {
        matches!(
            auth.role,
            Role::Ceo | Role::PatientManager | Role::TeamleadInterpreter | Role::ItAdmin
        )
    } else {
        matches!(
            auth.role,
            Role::Ceo
                | Role::PatientManager
                | Role::TeamleadInterpreter
                | Role::ItAdmin
                | Role::Interpreter
        ) && (auth.role != Role::Interpreter || auth.user_id == interpreter_id)
    };

    if !allowed {
        return Err(err(StatusCode::FORBIDDEN, "Insufficient permissions"));
    }

    let exists = sqlx::query_scalar::<_, bool>(
        r#"SELECT EXISTS(
                SELECT 1
                FROM users
                WHERE id = $1
                  AND role IN ('interpreter', 'teamlead_interpreter')
           )"#,
    )
    .bind(interpreter_id)
    .fetch_one(&state.db)
    .await
    .map_err(|error| {
        tracing::error!(error = %error, interpreter_id = %interpreter_id, "validate interpreter profile access");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to validate interpreter",
        )
    })?;

    if exists {
        Ok(())
    } else {
        Err(err(StatusCode::NOT_FOUND, "Interpreter not found"))
    }
}

fn interpreter_profile_row_json(row: sqlx::postgres::PgRow) -> Value {
    let profile = build_structured_profile(&row);

    serde_json::json!({
        "id": row.try_get::<Uuid, _>("id").unwrap_or_default(),
        "name": row.try_get::<String, _>("name").unwrap_or_default(),
        "email": row.try_get::<String, _>("email").unwrap_or_default(),
        "role": row.try_get::<String, _>("role").unwrap_or_default(),
        "is_active": row.try_get::<bool, _>("is_active").unwrap_or(false),
        "profile": profile,
        "profile_updated_at": row
            .try_get::<Option<chrono::DateTime<chrono::Utc>>, _>("profile_updated_at")
            .unwrap_or_default()
            .map(|value| value.to_rfc3339()),
    })
}

async fn load_interpreter_profile_payload(
    state: &AppState,
    interpreter_id: Uuid,
) -> Result<Option<Value>, sqlx::Error> {
    sqlx::query(
        r#"SELECT u.id, u.name, u.email, u.role, u.is_active,
                  COALESCE(p.profile, '{}'::jsonb) AS raw_profile,
                  p.updated_at AS profile_updated_at,
                  d.gender, d.birth_date, COALESCE(d.status, 'active') AS typed_status,
                  d.contract_type, d.contract_start_date, d.contract_end_date,
                  d.employment_kind, d.phone, d.email_secure, d.address, d.emergency_contact,
                  d.medical_knowledge, d.training_history, d.work_permit_valid_until AS detail_work_permit_valid_until,
                  d.internal_notes, d.retention_delete_at, d.erasure_request_status,
                  c.confidentiality_status, c.confidentiality_signed_at, c.confidentiality_document_url,
                  c.avv_status, c.avv_signed_at, c.avv_document_url, c.gdpr_training_at,
                  c.work_permit_valid_until AS compliance_work_permit_valid_until,
                  f.hourly_rate, f.salary_class, f.bank_details, f.tax_number, f.ust_idnr, f.billing_status,
                  a.access_level, a.auto_block_policy,
                  COALESCE((
                    SELECT jsonb_agg(w.value ORDER BY w.sort_order, w.value)
                    FROM interpreter_work_zones w
                    WHERE w.interpreter_id = u.id AND w.zone_type = 'country'
                  ), '[]'::jsonb) AS work_countries,
                  COALESCE((
                    SELECT jsonb_agg(w.value ORDER BY w.sort_order, w.value)
                    FROM interpreter_work_zones w
                    WHERE w.interpreter_id = u.id AND w.zone_type = 'location'
                  ), '[]'::jsonb) AS work_locations,
                  COALESCE((
                    SELECT jsonb_agg(e.label ORDER BY e.sort_order, e.label)
                    FROM interpreter_equipment e
                    WHERE e.interpreter_id = u.id
                  ), '[]'::jsonb) AS equipment
           FROM users u
           LEFT JOIN interpreter_profiles p ON p.user_id = u.id
           LEFT JOIN interpreter_profile_details d ON d.user_id = u.id
           LEFT JOIN interpreter_compliance_profiles c ON c.user_id = u.id
           LEFT JOIN interpreter_finance_profiles f ON f.user_id = u.id
           LEFT JOIN interpreter_access_profiles a ON a.user_id = u.id
           WHERE u.id = $1
             AND u.role IN ('interpreter', 'teamlead_interpreter')"#,
    )
    .bind(interpreter_id)
    .fetch_optional(&state.db)
    .await
    .map(|row| row.map(interpreter_profile_row_json))
}

fn build_structured_profile(row: &sqlx::postgres::PgRow) -> Value {
    let raw_profile = row
        .try_get::<Value, _>("raw_profile")
        .unwrap_or_else(|_| serde_json::json!({}));
    let mut profile = value_object(raw_profile);

    insert_row_string(&mut profile, "gender", row, "gender");
    insert_row_date(&mut profile, "birthDate", row, "birth_date");
    insert_row_string(&mut profile, "status", row, "typed_status");
    insert_row_string(&mut profile, "contractType", row, "contract_type");
    insert_row_date(
        &mut profile,
        "contractStartDate",
        row,
        "contract_start_date",
    );
    insert_row_date(&mut profile, "contractEndDate", row, "contract_end_date");
    insert_row_string(&mut profile, "employmentKind", row, "employment_kind");
    insert_row_string(&mut profile, "phone", row, "phone");
    insert_row_bool(&mut profile, "emailSecure", row, "email_secure");
    insert_row_string(&mut profile, "address", row, "address");
    insert_row_string(&mut profile, "emergencyContact", row, "emergency_contact");
    insert_row_string(&mut profile, "medicalKnowledge", row, "medical_knowledge");
    insert_row_string(&mut profile, "trainingHistory", row, "training_history");
    insert_row_date(
        &mut profile,
        "workPermitValidUntil",
        row,
        "detail_work_permit_valid_until",
    );
    insert_row_string(&mut profile, "internalNotes", row, "internal_notes");
    insert_row_date(
        &mut profile,
        "retentionDeleteAt",
        row,
        "retention_delete_at",
    );
    insert_row_string(
        &mut profile,
        "erasureRequestStatus",
        row,
        "erasure_request_status",
    );
    insert_row_array(&mut profile, "workCountries", row, "work_countries");
    insert_row_array(&mut profile, "workLocations", row, "work_locations");
    insert_row_array(&mut profile, "equipment", row, "equipment");

    let mut compliance = nested_value_object(profile.remove("compliance"));
    insert_row_string(
        &mut compliance,
        "confidentialityStatus",
        row,
        "confidentiality_status",
    );
    insert_row_date(
        &mut compliance,
        "confidentialitySignedAt",
        row,
        "confidentiality_signed_at",
    );
    insert_row_string(
        &mut compliance,
        "confidentialityDocumentUrl",
        row,
        "confidentiality_document_url",
    );
    insert_row_string(&mut compliance, "avvStatus", row, "avv_status");
    insert_row_date(&mut compliance, "avvSignedAt", row, "avv_signed_at");
    insert_row_string(&mut compliance, "avvDocumentUrl", row, "avv_document_url");
    insert_row_date(&mut compliance, "gdprTrainingAt", row, "gdpr_training_at");
    if !compliance.is_empty() {
        profile.insert("compliance".to_string(), Value::Object(compliance));
    }

    if let Some(value) = row
        .try_get::<Option<NaiveDate>, _>("compliance_work_permit_valid_until")
        .unwrap_or_default()
    {
        profile.insert(
            "workPermitValidUntil".to_string(),
            Value::String(value.to_string()),
        );
    }

    let mut finance = nested_value_object(profile.remove("finance"));
    insert_row_decimal(&mut finance, "hourlyRate", row, "hourly_rate");
    insert_row_string(&mut finance, "salaryClass", row, "salary_class");
    insert_row_string(&mut finance, "bankDetails", row, "bank_details");
    insert_row_string(&mut finance, "taxNumber", row, "tax_number");
    insert_row_string(&mut finance, "ustIdnr", row, "ust_idnr");
    insert_row_string(&mut finance, "billingStatus", row, "billing_status");
    if !finance.is_empty() {
        profile.insert("finance".to_string(), Value::Object(finance));
    }

    let mut access = nested_value_object(profile.remove("access"));
    insert_row_string(&mut access, "level", row, "access_level");
    insert_row_string(&mut access, "autoBlockPolicy", row, "auto_block_policy");
    if !access.is_empty() {
        profile.insert("access".to_string(), Value::Object(access));
    }

    Value::Object(profile)
}

fn value_object(value: Value) -> Map<String, Value> {
    match value {
        Value::Object(map) => map,
        _ => Map::new(),
    }
}

fn nested_value_object(value: Option<Value>) -> Map<String, Value> {
    match value {
        Some(Value::Object(map)) => map,
        _ => Map::new(),
    }
}

fn insert_row_string(
    target: &mut Map<String, Value>,
    key: &str,
    row: &sqlx::postgres::PgRow,
    column: &str,
) {
    if let Some(value) = row
        .try_get::<Option<String>, _>(column)
        .unwrap_or_default()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
    {
        target.insert(key.to_string(), Value::String(value));
    }
}

fn insert_row_bool(
    target: &mut Map<String, Value>,
    key: &str,
    row: &sqlx::postgres::PgRow,
    column: &str,
) {
    if let Some(value) = row.try_get::<Option<bool>, _>(column).unwrap_or_default() {
        target.insert(key.to_string(), Value::Bool(value));
    }
}

fn insert_row_date(
    target: &mut Map<String, Value>,
    key: &str,
    row: &sqlx::postgres::PgRow,
    column: &str,
) {
    if let Some(value) = row
        .try_get::<Option<NaiveDate>, _>(column)
        .unwrap_or_default()
    {
        target.insert(key.to_string(), Value::String(value.to_string()));
    }
}

fn insert_row_decimal(
    target: &mut Map<String, Value>,
    key: &str,
    row: &sqlx::postgres::PgRow,
    column: &str,
) {
    let Some(value) = row
        .try_get::<Option<Decimal>, _>(column)
        .unwrap_or_default()
    else {
        return;
    };
    let number = value
        .to_string()
        .parse::<f64>()
        .ok()
        .and_then(serde_json::Number::from_f64);
    if let Some(number) = number {
        target.insert(key.to_string(), Value::Number(number));
    }
}

fn insert_row_array(
    target: &mut Map<String, Value>,
    key: &str,
    row: &sqlx::postgres::PgRow,
    column: &str,
) {
    let value = row
        .try_get::<Value, _>(column)
        .unwrap_or_else(|_| serde_json::json!([]));
    if matches!(&value, Value::Array(items) if !items.is_empty()) {
        target.insert(key.to_string(), value);
    }
}

fn row_i64(row: &sqlx::postgres::PgRow, column: &str) -> i64 {
    row.try_get::<i64, _>(column).unwrap_or_default()
}

fn row_date_string(row: &sqlx::postgres::PgRow, column: &str) -> Option<String> {
    row.try_get::<Option<NaiveDate>, _>(column)
        .unwrap_or_default()
        .map(|value| value.to_string())
}

fn row_time_string(row: &sqlx::postgres::PgRow, column: &str) -> Option<String> {
    row.try_get::<Option<chrono::NaiveTime>, _>(column)
        .unwrap_or_default()
        .map(|value| value.format("%H:%M").to_string())
}

fn row_datetime_string(row: &sqlx::postgres::PgRow, column: &str) -> Option<String> {
    row.try_get::<Option<chrono::DateTime<chrono::Utc>>, _>(column)
        .unwrap_or_default()
        .map(|value| value.to_rfc3339())
}

fn person_name_from_row(row: &sqlx::postgres::PgRow) -> String {
    let first_name = row.try_get::<String, _>("first_name").unwrap_or_default();
    let last_name = row.try_get::<String, _>("last_name").unwrap_or_default();
    format!("{first_name} {last_name}").trim().to_string()
}

fn optional_person_name_from_row(row: &sqlx::postgres::PgRow) -> Option<String> {
    let first_name = row.try_get::<Option<String>, _>("first_name").ok()??;
    let last_name = row.try_get::<Option<String>, _>("last_name").ok()??;
    let name = format!("{first_name} {last_name}").trim().to_string();
    (!name.is_empty()).then_some(name)
}

fn optional_decimal_json(row: &sqlx::postgres::PgRow, column: &str) -> Value {
    row.try_get::<Option<Decimal>, _>(column)
        .unwrap_or_default()
        .map(decimal_to_json)
        .unwrap_or(Value::Null)
}

fn decimal_json_or_zero(row: &sqlx::postgres::PgRow, column: &str) -> Value {
    row.try_get::<Option<Decimal>, _>(column)
        .unwrap_or_default()
        .map(decimal_to_json)
        .unwrap_or_else(|| decimal_to_json(Decimal::ZERO))
}

fn decimal_to_json(value: Decimal) -> Value {
    decimal_to_f64(value)
        .and_then(serde_json::Number::from_f64)
        .map(Value::Number)
        .unwrap_or_else(|| Value::String(value.to_string()))
}

fn decimal_to_f64(value: Decimal) -> Option<f64> {
    value.to_string().parse::<f64>().ok()
}

fn f64_from_profile_number(profile: &Value, key: &str) -> Option<f64> {
    match value_from_object(profile, key) {
        Some(Value::Number(value)) => value.as_f64(),
        Some(Value::String(value)) => value.trim().parse::<f64>().ok(),
        _ => None,
    }
    .filter(|value| value.is_finite() && *value >= 0.0)
}

#[allow(clippy::result_large_err)]
async fn save_structured_interpreter_profile(
    tx: &mut Transaction<'_, Postgres>,
    interpreter_id: Uuid,
    updated_by: Uuid,
    profile: &Value,
) -> Result<(), axum::response::Response> {
    let status = enum_from_profile(
        profile,
        "status",
        &[
            "active",
            "vacation",
            "sick",
            "training",
            "blocked",
            "terminated",
        ],
        "Invalid interpreter status",
    )?
    .unwrap_or_else(|| "active".to_string());
    let contract_type = enum_from_profile(
        profile,
        "contractType",
        &["employee", "freelancer", "hourly"],
        "Invalid contract type",
    )?;
    let employment_kind = enum_from_profile(
        profile,
        "employmentKind",
        &["internal", "external"],
        "Invalid employment kind",
    )?;
    let email_secure =
        bool_from_profile_or_nested(profile, "emailSecure", "contact", "emailSecure")
            .unwrap_or(false);
    let birth_date = date_from_profile(profile, "birthDate")?;
    let contract_start_date = date_from_profile(profile, "contractStartDate")?;
    let contract_end_date = date_from_profile(profile, "contractEndDate")?;
    let work_permit_valid_until = date_from_profile(profile, "workPermitValidUntil")?;
    let retention_delete_at = date_from_profile(profile, "retentionDeleteAt")?;

    sqlx::query(
        r#"INSERT INTO interpreter_profile_details (
                user_id, gender, birth_date, status, contract_type,
                contract_start_date, contract_end_date, employment_kind,
                phone, email_secure, address, emergency_contact,
                medical_knowledge, training_history, work_permit_valid_until,
                internal_notes, retention_delete_at, erasure_request_status,
                updated_by
           ) VALUES (
                $1, $2, $3, $4, $5,
                $6, $7, $8,
                $9, $10, $11, $12,
                $13, $14, $15,
                $16, $17, $18,
                $19
           )
           ON CONFLICT (user_id)
           DO UPDATE SET gender = EXCLUDED.gender,
                         birth_date = EXCLUDED.birth_date,
                         status = EXCLUDED.status,
                         contract_type = EXCLUDED.contract_type,
                         contract_start_date = EXCLUDED.contract_start_date,
                         contract_end_date = EXCLUDED.contract_end_date,
                         employment_kind = EXCLUDED.employment_kind,
                         phone = EXCLUDED.phone,
                         email_secure = EXCLUDED.email_secure,
                         address = EXCLUDED.address,
                         emergency_contact = EXCLUDED.emergency_contact,
                         medical_knowledge = EXCLUDED.medical_knowledge,
                         training_history = EXCLUDED.training_history,
                         work_permit_valid_until = EXCLUDED.work_permit_valid_until,
                         internal_notes = EXCLUDED.internal_notes,
                         retention_delete_at = EXCLUDED.retention_delete_at,
                         erasure_request_status = EXCLUDED.erasure_request_status,
                         updated_by = EXCLUDED.updated_by,
                         updated_at = now()"#,
    )
    .bind(interpreter_id)
    .bind(string_from_profile(profile, "gender"))
    .bind(birth_date)
    .bind(status)
    .bind(contract_type)
    .bind(contract_start_date)
    .bind(contract_end_date)
    .bind(employment_kind)
    .bind(string_from_profile_or_nested(profile, "phone", "contact", "phone"))
    .bind(email_secure)
    .bind(string_from_profile_or_nested(
        profile,
        "address",
        "contact",
        "address",
    ))
    .bind(string_from_profile_or_nested(
        profile,
        "emergencyContact",
        "contact",
        "emergencyContact",
    ))
    .bind(string_from_profile(profile, "medicalKnowledge"))
    .bind(string_from_profile(profile, "trainingHistory"))
    .bind(work_permit_valid_until)
    .bind(string_from_profile(profile, "internalNotes"))
    .bind(retention_delete_at)
    .bind(string_from_profile(profile, "erasureRequestStatus"))
    .bind(updated_by)
    .execute(&mut **tx)
    .await
    .map_err(|error| {
        tracing::error!(error = %error, interpreter_id = %interpreter_id, "save interpreter profile details");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to save interpreter profile",
        )
    })?;

    save_structured_compliance(tx, interpreter_id, updated_by, profile).await?;
    save_structured_finance(tx, interpreter_id, updated_by, profile).await?;
    save_structured_access(tx, interpreter_id, updated_by, profile).await?;
    replace_string_values(
        tx,
        "DELETE FROM interpreter_work_zones WHERE interpreter_id = $1",
        "INSERT INTO interpreter_work_zones (interpreter_id, zone_type, value, sort_order) VALUES ($1, $2, $3, $4)",
        interpreter_id,
        Some("country"),
        &string_list_from_profile(profile, "workCountries"),
    )
    .await?;
    replace_string_values(
        tx,
        "DELETE FROM interpreter_work_zones WHERE interpreter_id = $1 AND zone_type = 'location'",
        "INSERT INTO interpreter_work_zones (interpreter_id, zone_type, value, sort_order) VALUES ($1, $2, $3, $4)",
        interpreter_id,
        Some("location"),
        &string_list_from_profile(profile, "workLocations"),
    )
    .await?;
    replace_string_values(
        tx,
        "DELETE FROM interpreter_equipment WHERE interpreter_id = $1",
        "INSERT INTO interpreter_equipment (interpreter_id, label, sort_order) VALUES ($1, $2, $3)",
        interpreter_id,
        None,
        &string_list_from_profile(profile, "equipment"),
    )
    .await?;

    Ok(())
}

#[allow(clippy::result_large_err)]
async fn save_structured_compliance(
    tx: &mut Transaction<'_, Postgres>,
    interpreter_id: Uuid,
    updated_by: Uuid,
    profile: &Value,
) -> Result<(), axum::response::Response> {
    let confidentiality_status = enum_from_value(
        value_from_profile_or_nested(
            profile,
            "confidentialityStatus",
            "compliance",
            "confidentialityStatus",
        ),
        &["signed", "missing"],
        "Invalid confidentiality status",
    )?;
    let avv_status = enum_from_value(
        value_from_profile_or_nested(profile, "avvStatus", "compliance", "avvStatus"),
        &["signed", "pending"],
        "Invalid AVV status",
    )?;

    sqlx::query(
        r#"INSERT INTO interpreter_compliance_profiles (
                user_id, confidentiality_status, confidentiality_signed_at,
                confidentiality_document_url, avv_status, avv_signed_at,
                avv_document_url, gdpr_training_at, work_permit_valid_until,
                updated_by
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           ON CONFLICT (user_id)
           DO UPDATE SET confidentiality_status = EXCLUDED.confidentiality_status,
                         confidentiality_signed_at = EXCLUDED.confidentiality_signed_at,
                         confidentiality_document_url = EXCLUDED.confidentiality_document_url,
                         avv_status = EXCLUDED.avv_status,
                         avv_signed_at = EXCLUDED.avv_signed_at,
                         avv_document_url = EXCLUDED.avv_document_url,
                         gdpr_training_at = EXCLUDED.gdpr_training_at,
                         work_permit_valid_until = EXCLUDED.work_permit_valid_until,
                         updated_by = EXCLUDED.updated_by,
                         updated_at = now()"#,
    )
    .bind(interpreter_id)
    .bind(confidentiality_status)
    .bind(date_from_value(
        value_from_profile_or_nested(
            profile,
            "confidentialitySignedAt",
            "compliance",
            "confidentialitySignedAt",
        ),
        "confidentialitySignedAt",
    )?)
    .bind(string_from_profile_or_nested(
        profile,
        "confidentialityDocumentUrl",
        "compliance",
        "confidentialityDocumentUrl",
    ))
    .bind(avv_status)
    .bind(date_from_value(
        value_from_profile_or_nested(profile, "avvSignedAt", "compliance", "avvSignedAt"),
        "avvSignedAt",
    )?)
    .bind(string_from_profile_or_nested(
        profile,
        "avvDocumentUrl",
        "compliance",
        "avvDocumentUrl",
    ))
    .bind(date_from_value(
        value_from_profile_or_nested(profile, "gdprTrainingAt", "compliance", "gdprTrainingAt"),
        "gdprTrainingAt",
    )?)
    .bind(date_from_profile(profile, "workPermitValidUntil")?)
    .bind(updated_by)
    .execute(&mut **tx)
    .await
    .map_err(|error| {
        tracing::error!(error = %error, interpreter_id = %interpreter_id, "save interpreter compliance");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to save interpreter profile",
        )
    })?;

    Ok(())
}

#[allow(clippy::result_large_err)]
async fn save_structured_finance(
    tx: &mut Transaction<'_, Postgres>,
    interpreter_id: Uuid,
    updated_by: Uuid,
    profile: &Value,
) -> Result<(), axum::response::Response> {
    let billing_status = enum_from_value(
        value_from_profile_or_nested(profile, "billingStatus", "finance", "billingStatus"),
        &["unpaid", "paid", "overdue"],
        "Invalid billing status",
    )?;

    sqlx::query(
        r#"INSERT INTO interpreter_finance_profiles (
                user_id, hourly_rate, salary_class, bank_details,
                tax_number, ust_idnr, billing_status, updated_by
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (user_id)
           DO UPDATE SET hourly_rate = EXCLUDED.hourly_rate,
                         salary_class = EXCLUDED.salary_class,
                         bank_details = EXCLUDED.bank_details,
                         tax_number = EXCLUDED.tax_number,
                         ust_idnr = EXCLUDED.ust_idnr,
                         billing_status = EXCLUDED.billing_status,
                         updated_by = EXCLUDED.updated_by,
                         updated_at = now()"#,
    )
    .bind(interpreter_id)
    .bind(decimal_from_value(
        value_from_profile_or_nested(profile, "hourlyRate", "finance", "hourlyRate"),
        "hourlyRate",
    )?)
    .bind(string_from_profile_or_nested(
        profile,
        "salaryClass",
        "finance",
        "salaryClass",
    ))
    .bind(string_from_profile_or_nested(
        profile,
        "bankDetails",
        "finance",
        "bankDetails",
    ))
    .bind(string_from_profile_or_nested(
        profile,
        "taxNumber",
        "finance",
        "taxNumber",
    ))
    .bind(string_from_profile_or_nested(
        profile,
        "ustIdnr",
        "finance",
        "ustIdnr",
    ))
    .bind(billing_status)
    .bind(updated_by)
    .execute(&mut **tx)
    .await
    .map_err(|error| {
        tracing::error!(error = %error, interpreter_id = %interpreter_id, "save interpreter finance");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to save interpreter profile",
        )
    })?;

    Ok(())
}

#[allow(clippy::result_large_err)]
async fn save_structured_access(
    tx: &mut Transaction<'_, Postgres>,
    interpreter_id: Uuid,
    updated_by: Uuid,
    profile: &Value,
) -> Result<(), axum::response::Response> {
    let access_level = enum_from_value(
        value_from_profile_or_nested(profile, "accessLevel", "access", "level"),
        &["appointment_only", "medical_shared", "full"],
        "Invalid access level",
    )?;
    let auto_block_policy = enum_from_value(
        value_from_profile_or_nested(profile, "autoBlockPolicy", "access", "autoBlockPolicy"),
        &["immediate", "after_one_hour"],
        "Invalid auto-block policy",
    )?;

    sqlx::query(
        r#"INSERT INTO interpreter_access_profiles (
                user_id, access_level, auto_block_policy, updated_by
           ) VALUES ($1, $2, $3, $4)
           ON CONFLICT (user_id)
           DO UPDATE SET access_level = EXCLUDED.access_level,
                         auto_block_policy = EXCLUDED.auto_block_policy,
                         updated_by = EXCLUDED.updated_by,
                         updated_at = now()"#,
    )
    .bind(interpreter_id)
    .bind(access_level)
    .bind(auto_block_policy)
    .bind(updated_by)
    .execute(&mut **tx)
    .await
    .map_err(|error| {
        tracing::error!(error = %error, interpreter_id = %interpreter_id, "save interpreter access profile");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to save interpreter profile",
        )
    })?;

    Ok(())
}

#[allow(clippy::result_large_err)]
async fn replace_string_values(
    tx: &mut Transaction<'_, Postgres>,
    delete_sql: &str,
    insert_sql: &str,
    interpreter_id: Uuid,
    discriminator: Option<&str>,
    values: &[String],
) -> Result<(), axum::response::Response> {
    sqlx::query(delete_sql)
        .bind(interpreter_id)
        .execute(&mut **tx)
        .await
        .map_err(|error| {
            tracing::error!(error = %error, interpreter_id = %interpreter_id, "clear interpreter structured list");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to save interpreter profile",
            )
        })?;

    for (index, value) in values.iter().enumerate() {
        let mut query = sqlx::query(insert_sql).bind(interpreter_id);
        if let Some(discriminator) = discriminator {
            query = query.bind(discriminator).bind(value);
        } else {
            query = query.bind(value);
        }
        query
            .bind(index as i32)
            .execute(&mut **tx)
            .await
            .map_err(|error| {
                tracing::error!(error = %error, interpreter_id = %interpreter_id, "insert interpreter structured list item");
                err(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Failed to save interpreter profile",
                )
            })?;
    }

    Ok(())
}

fn value_from_object<'a>(object: &'a Value, key: &str) -> Option<&'a Value> {
    object.as_object().and_then(|map| map.get(key))
}

fn value_from_profile_or_nested<'a>(
    profile: &'a Value,
    top_key: &str,
    nested_key: &str,
    nested_field: &str,
) -> Option<&'a Value> {
    profile
        .as_object()
        .and_then(|map| map.get(top_key))
        .or_else(|| {
            profile
                .as_object()
                .and_then(|map| map.get(nested_key))
                .and_then(|value| value.as_object())
                .and_then(|map| map.get(nested_field))
        })
}

fn string_from_value(value: Option<&Value>) -> Option<String> {
    match value {
        Some(Value::String(raw)) => Some(raw.trim().to_string()),
        Some(Value::Number(number)) => Some(number.to_string()),
        _ => None,
    }
    .filter(|value| !value.is_empty())
}

fn string_from_profile(profile: &Value, key: &str) -> Option<String> {
    string_from_value(value_from_object(profile, key))
}

fn string_from_profile_or_nested(
    profile: &Value,
    top_key: &str,
    nested_key: &str,
    nested_field: &str,
) -> Option<String> {
    string_from_value(value_from_profile_or_nested(
        profile,
        top_key,
        nested_key,
        nested_field,
    ))
}

fn bool_from_profile_or_nested(
    profile: &Value,
    top_key: &str,
    nested_key: &str,
    nested_field: &str,
) -> Option<bool> {
    match value_from_profile_or_nested(profile, top_key, nested_key, nested_field) {
        Some(Value::Bool(value)) => Some(*value),
        Some(Value::String(value)) if value.eq_ignore_ascii_case("true") => Some(true),
        Some(Value::String(value)) if value.eq_ignore_ascii_case("false") => Some(false),
        _ => None,
    }
}

#[allow(clippy::result_large_err)]
fn enum_from_profile(
    profile: &Value,
    key: &str,
    allowed: &[&str],
    error_message: &str,
) -> Result<Option<String>, axum::response::Response> {
    enum_from_value(value_from_object(profile, key), allowed, error_message)
}

#[allow(clippy::result_large_err)]
fn enum_from_value(
    value: Option<&Value>,
    allowed: &[&str],
    error_message: &str,
) -> Result<Option<String>, axum::response::Response> {
    let Some(value) = string_from_value(value) else {
        return Ok(None);
    };
    if allowed.contains(&value.as_str()) {
        Ok(Some(value))
    } else {
        Err(err(StatusCode::UNPROCESSABLE_ENTITY, error_message))
    }
}

#[allow(clippy::result_large_err)]
fn date_from_profile(
    profile: &Value,
    key: &str,
) -> Result<Option<NaiveDate>, axum::response::Response> {
    date_from_value(value_from_object(profile, key), key)
}

#[allow(clippy::result_large_err)]
fn date_from_value(
    value: Option<&Value>,
    field_name: &str,
) -> Result<Option<NaiveDate>, axum::response::Response> {
    let Some(value) = string_from_value(value) else {
        return Ok(None);
    };
    NaiveDate::parse_from_str(&value, "%Y-%m-%d")
        .map(Some)
        .map_err(|_| {
            err(
                StatusCode::UNPROCESSABLE_ENTITY,
                &format!("Invalid {field_name} (YYYY-MM-DD)"),
            )
        })
}

#[allow(clippy::result_large_err)]
fn decimal_from_value(
    value: Option<&Value>,
    field_name: &str,
) -> Result<Option<Decimal>, axum::response::Response> {
    let Some(value) = string_from_value(value) else {
        return Ok(None);
    };
    Decimal::from_str(&value).map(Some).map_err(|_| {
        err(
            StatusCode::UNPROCESSABLE_ENTITY,
            &format!("Invalid {field_name}"),
        )
    })
}

fn string_list_from_profile(profile: &Value, key: &str) -> Vec<String> {
    match value_from_object(profile, key) {
        Some(Value::Array(items)) => items
            .iter()
            .filter_map(|item| string_from_value(Some(item)))
            .collect(),
        Some(Value::String(raw)) => raw
            .split(',')
            .map(|item| item.trim().to_string())
            .filter(|item| !item.is_empty())
            .collect(),
        _ => Vec::new(),
    }
}

#[allow(clippy::result_large_err)]
fn normalize_profile_payload(body: Value) -> Result<Value, axum::response::Response> {
    let profile = body.get("profile").cloned().unwrap_or(body);
    if !profile.is_object() {
        return Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Profile payload must be a JSON object",
        ));
    }

    if serde_json::to_vec(&profile)
        .map(|bytes| bytes.len() > 65_536)
        .unwrap_or(true)
    {
        return Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Profile payload is too large",
        ));
    }

    Ok(profile)
}

async fn ensure_patient_scope(
    state: &AppState,
    auth: &AuthUser,
    patient_id: Uuid,
) -> Result<(), axum::response::Response> {
    if matches!(auth.role, Role::Ceo | Role::TeamleadInterpreter) {
        return Ok(());
    }

    let assigned = access::has_active_patient_assignment(&state.db, patient_id, auth.user_id)
        .await
        .map_err(|error| {
            tracing::error!(error = %error, patient_id = %patient_id, "validate patient scope");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to validate access",
            )
        })?;
    if assigned {
        Ok(())
    } else {
        Err(err(StatusCode::FORBIDDEN, "Insufficient permissions"))
    }
}

fn normalize_language_code(value: &str) -> Option<String> {
    let normalized = value.trim().to_lowercase();
    if normalized.is_empty()
        || normalized.len() > 16
        || !normalized
            .chars()
            .all(|ch| ch.is_ascii_alphabetic() || ch == '-' || ch == '_')
    {
        None
    } else {
        Some(normalized)
    }
}

fn normalize_optional_text(value: Option<String>) -> Option<String> {
    value
        .map(|raw| raw.trim().to_string())
        .filter(|value| !value.is_empty())
}

#[allow(clippy::result_large_err)]
fn normalize_optional_query_enum(
    value: Option<String>,
    allowed: &[&str],
    error_message: &str,
) -> Result<Option<String>, axum::response::Response> {
    let Some(value) = normalize_optional_text(value) else {
        return Ok(None);
    };
    if allowed.contains(&value.as_str()) {
        Ok(Some(value))
    } else {
        Err(err(StatusCode::UNPROCESSABLE_ENTITY, error_message))
    }
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
