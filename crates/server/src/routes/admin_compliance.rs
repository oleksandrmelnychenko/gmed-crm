use axum::{
    Json, Router,
    extract::{Extension, Path, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
};
use chrono::{Duration, Utc};
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::Row;
use sqlx::postgres::PgRow;
use uuid::Uuid;

use crate::access;
use crate::auth::middleware::AuthUser;
use crate::state::AppState;
use gmed_domain::role::Role;

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/admin/compliance/patient/{patient_id}/export",
            get(export_patient_data),
        )
        .route(
            "/admin/compliance/patient/{patient_id}/anonymize",
            post(anonymize_patient),
        )
        .route(
            "/admin/compliance/patient/{patient_id}/consents",
            get(list_patient_consents).post(upsert_patient_consent),
        )
        .route(
            "/admin/compliance/patient/{patient_id}/privacy-requests",
            get(list_patient_privacy_requests).post(create_patient_privacy_request),
        )
        .route("/admin/compliance/consents", get(consent_dashboard))
        .route("/admin/compliance/consents/expired", get(expired_consents))
        .route(
            "/admin/compliance/privacy-requests",
            get(list_privacy_requests),
        )
        .route(
            "/admin/compliance/privacy-requests/{request_id}/review",
            post(review_privacy_request),
        )
        .route(
            "/admin/compliance/privacy-requests/{request_id}/execute",
            post(execute_privacy_request),
        )
}

#[derive(Deserialize)]
struct UpsertPatientConsentRequest {
    consent_type: String,
    action: String,
    note: Option<String>,
}

#[derive(Deserialize)]
struct CreatePrivacyRequestRequest {
    request_type: String,
    source: Option<String>,
    reason: Option<String>,
}

#[derive(Deserialize)]
struct ReviewPrivacyRequestRequest {
    action: String,
    note: Option<String>,
    retention_days: Option<i64>,
}

struct PrivacyRequestMeta {
    id: Uuid,
    patient_id: Uuid,
    request_type: String,
    source: String,
    status: String,
    reason: Option<String>,
}

async fn export_patient_data(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(patient_id): Path<Uuid>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::Ceo, Role::PatientManager]) {
        return e;
    }

    if let Err(e) = ensure_patient_visible(&state, &auth, patient_id).await {
        return e;
    }

    let patient = sqlx::query!(
        r#"SELECT id, patient_id, first_name, last_name, birth_date, gender, email,
                  phone_primary, phone_secondary, nationality, languages,
                  insurance_type, insurance_provider, insurance_number,
                  notes, is_active, created_at, updated_at
           FROM patients WHERE id = $1"#,
        patient_id
    )
    .fetch_optional(&state.db)
    .await;

    let patient = match patient {
        Ok(Some(p)) => p,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Patient not found"),
        Err(e) => {
            tracing::error!(error = %e, "export patient");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };

    let appointments = sqlx::query!(
        "SELECT id, title, date, time_start, time_end, appointment_type, status, location, notes FROM appointments WHERE patient_id = $1 ORDER BY date DESC",
        patient_id
    ).fetch_all(&state.db).await.unwrap_or_default();

    let cases = sqlx::query!(
        "SELECT id, case_id, status, hauptanfragegrund, notes, created_at FROM cases WHERE patient_id = $1 ORDER BY created_at DESC",
        patient_id
    ).fetch_all(&state.db).await.unwrap_or_default();

    let orders = sqlx::query!(
        "SELECT id, order_number, phase, status, notes, created_at FROM orders WHERE patient_id = $1 ORDER BY created_at DESC",
        patient_id
    ).fetch_all(&state.db).await.unwrap_or_default();

    let assignments = sqlx::query!(
        r#"SELECT pa.user_id, u.name AS "user_name!", u.role AS "role!", pa.assigned_at
           FROM patient_assignments pa JOIN users u ON u.id = pa.user_id WHERE pa.patient_id = $1 AND pa.revoked_at IS NULL"#,
        patient_id
    ).fetch_all(&state.db).await.unwrap_or_default();

    let consents = sqlx::query(
        r#"SELECT cr.id, cr.consent_type, cr.granted, cr.granted_at, cr.revoked_at,
                  cr.context, cr.created_at, u.name AS managed_by_name
           FROM consent_records cr
           JOIN users u ON u.id = cr.user_id
           WHERE cr.patient_id = $1
           ORDER BY cr.created_at DESC"#,
    )
    .bind(patient_id)
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();

    let export = serde_json::json!({
        "export_type": "DSGVO Art. 15 - Right of Access",
        "exported_at": chrono::Utc::now(),
        "exported_by": auth.user_id,
        "patient": {
            "id": patient.id, "patient_id": patient.patient_id,
            "first_name": patient.first_name, "last_name": patient.last_name,
            "birth_date": patient.birth_date, "gender": patient.gender,
            "email": patient.email, "phone_primary": patient.phone_primary,
            "phone_secondary": patient.phone_secondary,
            "nationality": patient.nationality, "languages": patient.languages,
            "insurance_type": patient.insurance_type,
            "insurance_provider": patient.insurance_provider,
            "insurance_number": patient.insurance_number,
            "notes": patient.notes, "is_active": patient.is_active,
            "created_at": patient.created_at, "updated_at": patient.updated_at,
        },
        "appointments": appointments.into_iter().map(|a| serde_json::json!({
            "id": a.id, "title": a.title, "date": a.date,
            "time_start": a.time_start, "time_end": a.time_end,
            "type": a.appointment_type, "status": a.status,
            "location": a.location, "notes": a.notes,
        })).collect::<Vec<_>>(),
        "cases": cases.into_iter().map(|c| serde_json::json!({
            "id": c.id, "case_id": c.case_id, "status": c.status,
            "hauptanfragegrund": c.hauptanfragegrund,
            "notes": c.notes, "created_at": c.created_at,
        })).collect::<Vec<_>>(),
        "orders": orders.into_iter().map(|o| serde_json::json!({
            "id": o.id, "order_number": o.order_number, "phase": o.phase,
            "status": o.status, "notes": o.notes, "created_at": o.created_at,
        })).collect::<Vec<_>>(),
        "assignments": assignments.into_iter().map(|a| serde_json::json!({
            "user_id": a.user_id, "user_name": a.user_name,
            "role": a.role, "assigned_at": a.assigned_at,
        })).collect::<Vec<_>>(),
        "consents": consents.into_iter().map(|row| serde_json::json!({
            "id": row.try_get::<Uuid, _>("id").unwrap_or_else(|_| Uuid::nil()),
            "consent_type": row.try_get::<String, _>("consent_type").unwrap_or_default(),
            "granted": row.try_get::<bool, _>("granted").unwrap_or(false),
            "granted_at": row.try_get::<Option<chrono::DateTime<chrono::Utc>>, _>("granted_at").unwrap_or_default().map(|value| value.to_rfc3339()),
            "revoked_at": row.try_get::<Option<chrono::DateTime<chrono::Utc>>, _>("revoked_at").unwrap_or_default().map(|value| value.to_rfc3339()),
            "managed_by_name": row.try_get::<String, _>("managed_by_name").unwrap_or_default(),
            "context": row.try_get::<Option<serde_json::Value>, _>("context").unwrap_or_default(),
            "created_at": row.try_get::<chrono::DateTime<chrono::Utc>, _>("created_at").map(|value| value.to_rfc3339()).unwrap_or_default(),
        })).collect::<Vec<_>>(),
    });

    let _ = sqlx::query!(
        "INSERT INTO audit_log (user_id, action, entity_type, entity_id, context) VALUES ($1, 'dsgvo_data_export', 'patient', $2, $3)",
        auth.user_id, patient_id, serde_json::json!({"article": "Art. 15"})
    ).execute(&state.db).await;

    Json(export).into_response()
}

async fn anonymize_patient(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(patient_id): Path<Uuid>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::Ceo, Role::ItAdmin]) {
        return e;
    }

    if let Err(response) = ensure_patient_visible(&state, &auth, patient_id).await {
        return response;
    }

    let manual_request_id =
        match create_manual_erasure_request(&state, patient_id, auth.user_id).await {
            Ok(request_id) => request_id,
            Err(response) => return response,
        };

    match complete_privacy_request_execution(
        &state,
        patient_id,
        manual_request_id,
        "erasure",
        auth.user_id,
        true,
    )
    .await
    {
        Ok(payload) => Json(payload).into_response(),
        Err(response) => response,
    }
}

async fn list_patient_consents(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(patient_id): Path<Uuid>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::Ceo, Role::PatientManager]) {
        return e;
    }

    if let Err(e) = ensure_patient_visible(&state, &auth, patient_id).await {
        return e;
    }

    match sqlx::query(
        r#"SELECT cr.id, cr.patient_id, p.patient_id AS patient_pid,
                  concat_ws(' ', p.first_name, p.last_name) AS patient_name,
                  u.name AS managed_by_name,
                  cr.consent_type, cr.granted, cr.granted_at, cr.revoked_at,
                  cr.context, cr.created_at
           FROM consent_records cr
           JOIN patients p ON p.id = cr.patient_id
           JOIN users u ON u.id = cr.user_id
           WHERE cr.patient_id = $1
           ORDER BY cr.created_at DESC"#,
    )
    .bind(patient_id)
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => {
            let data = rows
                .into_iter()
                .map(|row| {
                    json!({
                        "id": row.try_get::<Uuid, _>("id").unwrap_or_else(|_| Uuid::nil()),
                        "patient_id": row.try_get::<Uuid, _>("patient_id").unwrap_or_else(|_| Uuid::nil()),
                        "patient_pid": row.try_get::<String, _>("patient_pid").unwrap_or_default(),
                        "patient_name": row.try_get::<String, _>("patient_name").unwrap_or_default(),
                        "managed_by_name": row.try_get::<String, _>("managed_by_name").unwrap_or_default(),
                        "consent_type": row.try_get::<String, _>("consent_type").unwrap_or_default(),
                        "granted": row.try_get::<bool, _>("granted").unwrap_or(false),
                        "granted_at": row.try_get::<Option<chrono::DateTime<chrono::Utc>>, _>("granted_at").unwrap_or_default().map(|value| value.to_rfc3339()),
                        "revoked_at": row.try_get::<Option<chrono::DateTime<chrono::Utc>>, _>("revoked_at").unwrap_or_default().map(|value| value.to_rfc3339()),
                        "note": row.try_get::<Option<serde_json::Value>, _>("context").unwrap_or_default().and_then(|value| value.get("note").cloned()),
                        "created_at": row.try_get::<chrono::DateTime<chrono::Utc>, _>("created_at").map(|value| value.to_rfc3339()).unwrap_or_default(),
                    })
                })
                .collect::<Vec<_>>();
            Json(data).into_response()
        }
        Err(e) => {
            tracing::error!(error = %e, patient_id = %patient_id, "list patient consents");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to load patient consents",
            )
        }
    }
}

async fn upsert_patient_consent(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(patient_id): Path<Uuid>,
    Json(body): Json<UpsertPatientConsentRequest>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::Ceo, Role::PatientManager]) {
        return e;
    }

    if let Err(e) = ensure_patient_visible(&state, &auth, patient_id).await {
        return e;
    }

    let consent_type = match normalize_consent_type(&body.consent_type) {
        Ok(value) => value,
        Err(response) => return response,
    };
    let action = body.action.trim().to_lowercase();
    if !matches!(action.as_str(), "grant" | "revoke") {
        return err(StatusCode::UNPROCESSABLE_ENTITY, "Invalid consent action");
    }
    let note = normalize_optional(body.note.as_deref());
    let happened_at = chrono::Utc::now();

    let closed_active_rows = sqlx::query(
        "UPDATE consent_records SET revoked_at = $3 WHERE patient_id = $1 AND consent_type = $2 AND granted = true AND revoked_at IS NULL",
    )
    .bind(patient_id)
    .bind(&consent_type)
    .bind(happened_at)
    .execute(&state.db)
    .await;

    let closed_active_rows = match closed_active_rows {
        Ok(result) => result.rows_affected(),
        Err(e) => {
            tracing::error!(error = %e, patient_id = %patient_id, "close active patient consents");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to update patient consent state",
            );
        }
    };

    let created = sqlx::query(
        r#"INSERT INTO consent_records (
                patient_id, user_id, consent_type, granted, granted_at, revoked_at, context
           ) VALUES (
                $1, $2, $3, $4, $5, $6, $7
           )
           RETURNING id, patient_id, consent_type, granted, granted_at, revoked_at, context, created_at"#,
    )
    .bind(patient_id)
    .bind(auth.user_id)
    .bind(&consent_type)
    .bind(action == "grant")
    .bind(if action == "grant" {
        Some(happened_at)
    } else {
        None
    })
    .bind(if action == "revoke" {
        Some(happened_at)
    } else {
        None
    })
    .bind(json!({
        "note": note,
        "action": action,
        "closed_active_rows": closed_active_rows,
    }))
    .fetch_one(&state.db)
    .await;

    let created = match created {
        Ok(row) => row,
        Err(e) => {
            tracing::error!(error = %e, patient_id = %patient_id, "insert patient consent");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to save patient consent",
            );
        }
    };

    let audit_action = if action == "grant" {
        "consent_granted"
    } else {
        "consent_revoked"
    };
    let _ = sqlx::query(
        "INSERT INTO audit_log (user_id, action, entity_type, entity_id, context) VALUES ($1, $2, 'patient', $3, $4)",
    )
    .bind(auth.user_id)
    .bind(audit_action)
    .bind(patient_id)
    .bind(json!({
        "consent_type": consent_type,
        "note": note,
        "closed_active_rows": closed_active_rows,
    }))
    .execute(&state.db)
    .await;

    (
        StatusCode::CREATED,
        Json(json!({
            "id": created.try_get::<Uuid, _>("id").unwrap_or_else(|_| Uuid::nil()),
            "patient_id": created.try_get::<Uuid, _>("patient_id").unwrap_or_else(|_| Uuid::nil()),
            "consent_type": created.try_get::<String, _>("consent_type").unwrap_or_default(),
            "granted": created.try_get::<bool, _>("granted").unwrap_or(false),
            "granted_at": created.try_get::<Option<chrono::DateTime<chrono::Utc>>, _>("granted_at").unwrap_or_default().map(|value| value.to_rfc3339()),
            "revoked_at": created.try_get::<Option<chrono::DateTime<chrono::Utc>>, _>("revoked_at").unwrap_or_default().map(|value| value.to_rfc3339()),
            "note": created.try_get::<Option<serde_json::Value>, _>("context").unwrap_or_default().and_then(|value| value.get("note").cloned()),
            "created_at": created.try_get::<chrono::DateTime<chrono::Utc>, _>("created_at").map(|value| value.to_rfc3339()).unwrap_or_default(),
        })),
    )
        .into_response()
}

async fn create_patient_privacy_request(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(patient_id): Path<Uuid>,
    Json(body): Json<CreatePrivacyRequestRequest>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::Ceo, Role::ItAdmin, Role::PatientManager]) {
        return e;
    }

    if let Err(e) = ensure_patient_visible(&state, &auth, patient_id).await {
        return e;
    }

    let request_type = match normalize_privacy_request_type(&body.request_type) {
        Ok(value) => value,
        Err(response) => return response,
    };
    let source = match normalize_privacy_request_source(body.source.as_deref()) {
        Ok(value) => value,
        Err(response) => return response,
    };
    let reason = normalize_optional(body.reason.as_deref());
    let due_days = load_numeric_setting(&state, "patient_erasure_due_days", 30).await;
    let due_at = Utc::now() + Duration::days(due_days.max(1));
    let record_summary = match load_patient_record_summary(&state, patient_id).await {
        Ok(summary) => summary,
        Err(response) => return response,
    };

    let request_id = match sqlx::query_scalar::<_, Uuid>(
        r#"INSERT INTO patient_privacy_requests (
                patient_id, requested_by, request_type, source, status, reason, due_at, context
           ) VALUES (
                $1, $2, $3, $4, 'requested', $5, $6, $7
           )
           RETURNING id"#,
    )
    .bind(patient_id)
    .bind(auth.user_id)
    .bind(&request_type)
    .bind(&source)
    .bind(reason.clone())
    .bind(due_at)
    .bind(json!({
        "record_summary": record_summary,
        "created_via": "admin_compliance_workspace",
    }))
    .fetch_one(&state.db)
    .await
    {
        Ok(request_id) => request_id,
        Err(e) => {
            tracing::error!(error = %e, patient_id = %patient_id, "create privacy request");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to create privacy request",
            );
        }
    };

    let _ = sqlx::query(
        "INSERT INTO audit_log (user_id, action, entity_type, entity_id, context) VALUES ($1, 'privacy_request_created', 'patient', $2, $3)",
    )
    .bind(auth.user_id)
    .bind(patient_id)
    .bind(json!({
        "request_id": request_id,
        "request_type": request_type,
        "source": source,
        "reason": reason,
        "due_at": due_at.to_rfc3339(),
    }))
    .execute(&state.db)
    .await;

    match fetch_privacy_request_payload(&state, request_id).await {
        Ok(payload) => (StatusCode::CREATED, Json(payload)).into_response(),
        Err(response) => response,
    }
}

async fn list_patient_privacy_requests(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(patient_id): Path<Uuid>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::Ceo, Role::ItAdmin, Role::PatientManager]) {
        return e;
    }

    if let Err(e) = ensure_patient_visible(&state, &auth, patient_id).await {
        return e;
    }

    match sqlx::query(
        r#"SELECT pr.id, pr.patient_id, p.patient_id AS patient_pid,
                  concat_ws(' ', p.first_name, p.last_name) AS patient_name,
                  rq.name AS requested_by_name,
                  rv.name AS reviewed_by_name,
                  ex.name AS executed_by_name,
                  pr.request_type, pr.source, pr.status, pr.reason, pr.due_at,
                  pr.retention_until, pr.review_note, pr.requested_at,
                  pr.reviewed_at, pr.executed_at, pr.context
           FROM patient_privacy_requests pr
           JOIN patients p ON p.id = pr.patient_id
           JOIN users rq ON rq.id = pr.requested_by
           LEFT JOIN users rv ON rv.id = pr.reviewed_by
           LEFT JOIN users ex ON ex.id = pr.executed_by
           WHERE pr.patient_id = $1
           ORDER BY pr.created_at DESC"#,
    )
    .bind(patient_id)
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => Json(
            rows.into_iter()
                .map(|row| map_privacy_request_row(&row))
                .collect::<Vec<_>>(),
        )
        .into_response(),
        Err(e) => {
            tracing::error!(error = %e, patient_id = %patient_id, "list patient privacy requests");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to load privacy requests",
            )
        }
    }
}

async fn list_privacy_requests(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::Ceo, Role::ItAdmin, Role::PatientManager]) {
        return e;
    }

    let requires_assignment = access::requires_patient_assignment(auth.role);
    let rows = if requires_assignment {
        sqlx::query(
            r#"SELECT pr.id, pr.patient_id, p.patient_id AS patient_pid,
                      concat_ws(' ', p.first_name, p.last_name) AS patient_name,
                      rq.name AS requested_by_name,
                      rv.name AS reviewed_by_name,
                      ex.name AS executed_by_name,
                      pr.request_type, pr.source, pr.status, pr.reason, pr.due_at,
                      pr.retention_until, pr.review_note, pr.requested_at,
                      pr.reviewed_at, pr.executed_at, pr.context
               FROM patient_privacy_requests pr
               JOIN patients p ON p.id = pr.patient_id
               JOIN users rq ON rq.id = pr.requested_by
               LEFT JOIN users rv ON rv.id = pr.reviewed_by
               LEFT JOIN users ex ON ex.id = pr.executed_by
               WHERE EXISTS (
                     SELECT 1
                     FROM patient_assignments pa
                     WHERE pa.patient_id = pr.patient_id
                       AND pa.user_id = $1
                       AND pa.revoked_at IS NULL
               )
               ORDER BY pr.created_at DESC
               LIMIT 100"#,
        )
        .bind(auth.user_id)
        .fetch_all(&state.db)
        .await
    } else {
        sqlx::query(
            r#"SELECT pr.id, pr.patient_id, p.patient_id AS patient_pid,
                      concat_ws(' ', p.first_name, p.last_name) AS patient_name,
                      rq.name AS requested_by_name,
                      rv.name AS reviewed_by_name,
                      ex.name AS executed_by_name,
                      pr.request_type, pr.source, pr.status, pr.reason, pr.due_at,
                      pr.retention_until, pr.review_note, pr.requested_at,
                      pr.reviewed_at, pr.executed_at, pr.context
               FROM patient_privacy_requests pr
               JOIN patients p ON p.id = pr.patient_id
               JOIN users rq ON rq.id = pr.requested_by
               LEFT JOIN users rv ON rv.id = pr.reviewed_by
               LEFT JOIN users ex ON ex.id = pr.executed_by
               ORDER BY pr.created_at DESC
               LIMIT 100"#,
        )
        .fetch_all(&state.db)
        .await
    };

    match rows {
        Ok(rows) => Json(
            rows.into_iter()
                .map(|row| map_privacy_request_row(&row))
                .collect::<Vec<_>>(),
        )
        .into_response(),
        Err(e) => {
            tracing::error!(error = %e, user_id = %auth.user_id, "list privacy requests");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to load privacy requests",
            )
        }
    }
}

async fn review_privacy_request(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(request_id): Path<Uuid>,
    Json(body): Json<ReviewPrivacyRequestRequest>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::Ceo, Role::ItAdmin, Role::PatientManager]) {
        return e;
    }

    let request = match fetch_privacy_request_meta(&state, request_id).await {
        Ok(request) => request,
        Err(response) => return response,
    };

    if let Err(e) = ensure_patient_visible(&state, &auth, request.patient_id).await {
        return e;
    }

    if matches!(request.status.as_str(), "completed" | "rejected") {
        return err(
            StatusCode::CONFLICT,
            "Privacy request can no longer be reviewed",
        );
    }

    if request.status == "approved" {
        return err(StatusCode::CONFLICT, "Privacy request is already approved");
    }

    let action = match normalize_privacy_review_action(&body.action) {
        Ok(value) => value,
        Err(response) => return response,
    };
    let reviewed_at = Utc::now();
    let review_note = normalize_optional(body.note.as_deref());
    let (next_status, retention_until) = match action.as_str() {
        "approve" => ("approved", None),
        "reject" => ("rejected", None),
        "hold" => {
            let retention_days = body
                .retention_days
                .unwrap_or(load_numeric_setting(&state, "patient_retention_hold_days", 3650).await);
            (
                "retention_hold",
                Some(reviewed_at + Duration::days(retention_days.max(1))),
            )
        }
        _ => unreachable!(),
    };

    let review_context = json!({
        "review_action": action,
        "reviewed_at": reviewed_at.to_rfc3339(),
        "retention_until": retention_until.map(|value| value.to_rfc3339()),
    });

    let updated = sqlx::query(
        r#"UPDATE patient_privacy_requests
           SET status = $2,
               retention_until = $3,
               review_note = $4,
               reviewed_by = $5,
               reviewed_at = $6,
               updated_at = now(),
               context = COALESCE(context, '{}'::jsonb) || $7
           WHERE id = $1"#,
    )
    .bind(request_id)
    .bind(next_status)
    .bind(retention_until)
    .bind(review_note.clone())
    .bind(auth.user_id)
    .bind(reviewed_at)
    .bind(review_context)
    .execute(&state.db)
    .await;

    if let Err(e) = updated {
        tracing::error!(error = %e, request_id = %request_id, "review privacy request");
        return err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to review privacy request",
        );
    }

    let _ = sqlx::query(
        "INSERT INTO audit_log (user_id, action, entity_type, entity_id, context) VALUES ($1, 'privacy_request_reviewed', 'patient', $2, $3)",
    )
    .bind(auth.user_id)
    .bind(request.patient_id)
    .bind(json!({
        "request_id": request.id,
        "request_type": request.request_type,
        "source": request.source,
        "reason": request.reason,
        "review_action": action,
        "status": next_status,
        "retention_until": retention_until.map(|value| value.to_rfc3339()),
        "review_note": review_note,
    }))
    .execute(&state.db)
    .await;

    match fetch_privacy_request_payload(&state, request_id).await {
        Ok(payload) => Json(payload).into_response(),
        Err(response) => response,
    }
}

async fn execute_privacy_request(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(request_id): Path<Uuid>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::Ceo, Role::ItAdmin, Role::PatientManager]) {
        return e;
    }

    let request = match fetch_privacy_request_meta(&state, request_id).await {
        Ok(request) => request,
        Err(response) => return response,
    };

    if let Err(e) = ensure_patient_visible(&state, &auth, request.patient_id).await {
        return e;
    }

    if request.status != "approved" {
        return err(
            StatusCode::CONFLICT,
            "Privacy request must be approved before execution",
        );
    }

    if auth.role == Role::PatientManager && request.request_type != "third_party_revoke" {
        return err(
            StatusCode::FORBIDDEN,
            "Only CEO or IT admin can execute this privacy request type",
        );
    }

    match complete_privacy_request_execution(
        &state,
        request.patient_id,
        request.id,
        &request.request_type,
        auth.user_id,
        false,
    )
    .await
    {
        Ok(payload) => Json(payload).into_response(),
        Err(response) => response,
    }
}

async fn consent_dashboard(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::Ceo, Role::PatientManager]) {
        return e;
    }

    let requires_assignment = access::requires_patient_assignment(auth.role);

    let total_query = if requires_assignment {
        sqlx::query_scalar::<_, i64>(
            r#"SELECT count(*)
               FROM consent_records cr
               WHERE cr.patient_id IS NOT NULL
                 AND EXISTS (
                     SELECT 1
                     FROM patient_assignments pa
                     WHERE pa.patient_id = cr.patient_id
                       AND pa.user_id = $1
                       AND pa.revoked_at IS NULL
               )"#,
        )
        .bind(auth.user_id)
        .fetch_one(&state.db)
        .await
    } else {
        sqlx::query_scalar::<_, i64>(
            r#"SELECT count(*)
               FROM consent_records
               WHERE patient_id IS NOT NULL"#,
        )
        .fetch_one(&state.db)
        .await
    };
    let total = total_query.unwrap_or(0);

    let granted_query = if requires_assignment {
        sqlx::query_scalar::<_, i64>(
            r#"SELECT count(*)
               FROM consent_records cr
               WHERE cr.patient_id IS NOT NULL
                 AND cr.granted = true
                 AND cr.revoked_at IS NULL
                 AND EXISTS (
                     SELECT 1
                     FROM patient_assignments pa
                     WHERE pa.patient_id = cr.patient_id
                       AND pa.user_id = $1
                       AND pa.revoked_at IS NULL
               )"#,
        )
        .bind(auth.user_id)
        .fetch_one(&state.db)
        .await
    } else {
        sqlx::query_scalar::<_, i64>(
            r#"SELECT count(*)
               FROM consent_records
               WHERE patient_id IS NOT NULL
                 AND granted = true
                 AND revoked_at IS NULL"#,
        )
        .fetch_one(&state.db)
        .await
    };
    let granted = granted_query.unwrap_or(0);

    let revoked_query = if requires_assignment {
        sqlx::query_scalar::<_, i64>(
            r#"SELECT count(*)
               FROM consent_records cr
               WHERE cr.patient_id IS NOT NULL
                 AND cr.revoked_at IS NOT NULL
                 AND EXISTS (
                     SELECT 1
                     FROM patient_assignments pa
                     WHERE pa.patient_id = cr.patient_id
                       AND pa.user_id = $1
                       AND pa.revoked_at IS NULL
               )"#,
        )
        .bind(auth.user_id)
        .fetch_one(&state.db)
        .await
    } else {
        sqlx::query_scalar::<_, i64>(
            r#"SELECT count(*)
               FROM consent_records
               WHERE patient_id IS NOT NULL
                 AND revoked_at IS NOT NULL"#,
        )
        .fetch_one(&state.db)
        .await
    };
    let revoked = revoked_query.unwrap_or(0);

    let by_type = if requires_assignment {
        sqlx::query(
            r#"SELECT cr.consent_type,
                      count(*) AS total_count,
                      count(*) FILTER (WHERE cr.granted = true AND cr.revoked_at IS NULL) AS active_count
               FROM consent_records cr
               WHERE cr.patient_id IS NOT NULL
                 AND EXISTS (
                     SELECT 1
                     FROM patient_assignments pa
                     WHERE pa.patient_id = cr.patient_id
                       AND pa.user_id = $1
                       AND pa.revoked_at IS NULL
               )
               GROUP BY cr.consent_type
               ORDER BY cr.consent_type"#,
        )
        .bind(auth.user_id)
        .fetch_all(&state.db)
        .await
        .unwrap_or_default()
    } else {
        sqlx::query(
            r#"SELECT cr.consent_type,
                      count(*) AS total_count,
                      count(*) FILTER (WHERE cr.granted = true AND cr.revoked_at IS NULL) AS active_count
               FROM consent_records cr
               WHERE cr.patient_id IS NOT NULL
               GROUP BY cr.consent_type
               ORDER BY cr.consent_type"#,
        )
        .fetch_all(&state.db)
        .await
        .unwrap_or_default()
    };

    let recent_changes = if requires_assignment {
        sqlx::query(
            r#"SELECT cr.id, cr.patient_id, p.patient_id AS patient_pid,
                      concat_ws(' ', p.first_name, p.last_name) AS patient_name,
                      u.name AS user_name, cr.consent_type, cr.granted, cr.granted_at, cr.revoked_at
               FROM consent_records cr
               JOIN users u ON u.id = cr.user_id
               JOIN patients p ON p.id = cr.patient_id
               WHERE cr.patient_id IS NOT NULL
                 AND EXISTS (
                     SELECT 1
                     FROM patient_assignments pa
                     WHERE pa.patient_id = cr.patient_id
                       AND pa.user_id = $1
                       AND pa.revoked_at IS NULL
               )
               ORDER BY cr.created_at DESC
               LIMIT 20"#,
        )
        .bind(auth.user_id)
        .fetch_all(&state.db)
        .await
        .unwrap_or_default()
    } else {
        sqlx::query(
            r#"SELECT cr.id, cr.patient_id, p.patient_id AS patient_pid,
                      concat_ws(' ', p.first_name, p.last_name) AS patient_name,
                      u.name AS user_name, cr.consent_type, cr.granted, cr.granted_at, cr.revoked_at
               FROM consent_records cr
               JOIN users u ON u.id = cr.user_id
               JOIN patients p ON p.id = cr.patient_id
               WHERE cr.patient_id IS NOT NULL
               ORDER BY cr.created_at DESC
               LIMIT 20"#,
        )
        .fetch_all(&state.db)
        .await
        .unwrap_or_default()
    };

    Json(serde_json::json!({
        "total": total,
        "granted_active": granted,
        "revoked": revoked,
        "by_type": by_type.into_iter().map(|row| serde_json::json!({
            "consent_type": row.try_get::<String, _>("consent_type").unwrap_or_default(),
            "total": row.try_get::<i64, _>("total_count").unwrap_or_default(),
            "active": row.try_get::<i64, _>("active_count").unwrap_or_default(),
        })).collect::<Vec<_>>(),
        "recent_changes": recent_changes.into_iter().map(|row| serde_json::json!({
            "id": row.try_get::<Uuid, _>("id").unwrap_or_else(|_| Uuid::nil()),
            "patient_id": row.try_get::<Uuid, _>("patient_id").unwrap_or_else(|_| Uuid::nil()),
            "patient_pid": row.try_get::<String, _>("patient_pid").unwrap_or_default(),
            "patient_name": row.try_get::<String, _>("patient_name").unwrap_or_default(),
            "user_name": row.try_get::<String, _>("user_name").unwrap_or_default(),
            "consent_type": row.try_get::<String, _>("consent_type").unwrap_or_default(),
            "granted": row.try_get::<bool, _>("granted").unwrap_or(false),
            "granted_at": row.try_get::<Option<chrono::DateTime<chrono::Utc>>, _>("granted_at").unwrap_or_default().map(|value| value.to_rfc3339()),
            "revoked_at": row.try_get::<Option<chrono::DateTime<chrono::Utc>>, _>("revoked_at").unwrap_or_default().map(|value| value.to_rfc3339()),
        })).collect::<Vec<_>>(),
    }))
    .into_response()
}

async fn expired_consents(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::Ceo, Role::PatientManager]) {
        return e;
    }

    let requires_assignment = access::requires_patient_assignment(auth.role);
    let rows = if requires_assignment {
        sqlx::query(
            r#"SELECT cr.id, cr.patient_id, p.patient_id AS patient_pid,
                      concat_ws(' ', p.first_name, p.last_name) AS patient_name,
                      u.name AS user_name, cr.consent_type, cr.granted_at
               FROM consent_records cr
               JOIN users u ON u.id = cr.user_id
               JOIN patients p ON p.id = cr.patient_id
               WHERE cr.patient_id IS NOT NULL
                 AND cr.granted = true
                 AND cr.revoked_at IS NULL
                 AND cr.granted_at < now() - interval '1 year'
                 AND EXISTS (
                     SELECT 1
                     FROM patient_assignments pa
                     WHERE pa.patient_id = cr.patient_id
                       AND pa.user_id = $1
                       AND pa.revoked_at IS NULL
               )
               ORDER BY cr.granted_at ASC
               LIMIT 100"#,
        )
        .bind(auth.user_id)
        .fetch_all(&state.db)
        .await
    } else {
        sqlx::query(
            r#"SELECT cr.id, cr.patient_id, p.patient_id AS patient_pid,
                      concat_ws(' ', p.first_name, p.last_name) AS patient_name,
                      u.name AS user_name, cr.consent_type, cr.granted_at
               FROM consent_records cr
               JOIN users u ON u.id = cr.user_id
               JOIN patients p ON p.id = cr.patient_id
               WHERE cr.patient_id IS NOT NULL
                 AND cr.granted = true
                 AND cr.revoked_at IS NULL
                 AND cr.granted_at < now() - interval '1 year'
               ORDER BY cr.granted_at ASC
               LIMIT 100"#,
        )
        .fetch_all(&state.db)
        .await
    };

    match rows {
        Ok(rows) => {
            let data: Vec<serde_json::Value> = rows
                .into_iter()
                .map(|row| {
                    serde_json::json!({
                        "id": row.try_get::<Uuid, _>("id").unwrap_or_else(|_| Uuid::nil()),
                        "patient_id": row.try_get::<Uuid, _>("patient_id").unwrap_or_else(|_| Uuid::nil()),
                        "patient_pid": row.try_get::<String, _>("patient_pid").unwrap_or_default(),
                        "patient_name": row.try_get::<String, _>("patient_name").unwrap_or_default(),
                        "user_name": row.try_get::<String, _>("user_name").unwrap_or_default(),
                        "consent_type": row.try_get::<String, _>("consent_type").unwrap_or_default(),
                        "granted_at": row.try_get::<Option<chrono::DateTime<chrono::Utc>>, _>("granted_at").unwrap_or_default().map(|value| value.to_rfc3339()),
                    })
                })
                .collect();
            Json(data).into_response()
        }
        Err(e) => {
            tracing::error!(error = %e, "expired consents");
            err(StatusCode::INTERNAL_SERVER_ERROR, "Failed")
        }
    }
}

async fn ensure_patient_visible(
    state: &AppState,
    auth: &AuthUser,
    patient_id: Uuid,
) -> Result<(), axum::response::Response> {
    let exists =
        sqlx::query_scalar::<_, bool>("SELECT EXISTS(SELECT 1 FROM patients WHERE id = $1)")
            .bind(patient_id)
            .fetch_one(&state.db)
            .await
            .map_err(|e| {
                tracing::error!(error = %e, patient_id = %patient_id, "check patient existence");
                err(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Failed to validate patient",
                )
            })?;

    if !exists {
        return Err(err(StatusCode::NOT_FOUND, "Patient not found"));
    }

    if auth.role == Role::Ceo || !access::requires_patient_assignment(auth.role) {
        return Ok(());
    }

    let assigned = access::has_active_patient_assignment(&state.db, patient_id, auth.user_id)
        .await
        .map_err(|e| {
            tracing::error!(error = %e, patient_id = %patient_id, "check patient assignment");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to validate patient access",
            )
        })?;

    if assigned {
        Ok(())
    } else {
        Err(err(StatusCode::FORBIDDEN, "Insufficient permissions"))
    }
}

async fn fetch_privacy_request_meta(
    state: &AppState,
    request_id: Uuid,
) -> Result<PrivacyRequestMeta, axum::response::Response> {
    match sqlx::query(
        r#"SELECT id, patient_id, request_type, source, status, reason
           FROM patient_privacy_requests
           WHERE id = $1"#,
    )
    .bind(request_id)
    .fetch_optional(&state.db)
    .await
    {
        Ok(Some(row)) => Ok(PrivacyRequestMeta {
            id: row.try_get::<Uuid, _>("id").unwrap_or_else(|_| Uuid::nil()),
            patient_id: row
                .try_get::<Uuid, _>("patient_id")
                .unwrap_or_else(|_| Uuid::nil()),
            request_type: row.try_get::<String, _>("request_type").unwrap_or_default(),
            source: row.try_get::<String, _>("source").unwrap_or_default(),
            status: row.try_get::<String, _>("status").unwrap_or_default(),
            reason: row
                .try_get::<Option<String>, _>("reason")
                .unwrap_or_default(),
        }),
        Ok(None) => Err(err(StatusCode::NOT_FOUND, "Privacy request not found")),
        Err(e) => {
            tracing::error!(error = %e, request_id = %request_id, "load privacy request");
            Err(err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to load privacy request",
            ))
        }
    }
}

async fn fetch_privacy_request_payload(
    state: &AppState,
    request_id: Uuid,
) -> Result<Value, axum::response::Response> {
    match sqlx::query(
        r#"SELECT pr.id, pr.patient_id, p.patient_id AS patient_pid,
                  concat_ws(' ', p.first_name, p.last_name) AS patient_name,
                  rq.name AS requested_by_name,
                  rv.name AS reviewed_by_name,
                  ex.name AS executed_by_name,
                  pr.request_type, pr.source, pr.status, pr.reason, pr.due_at,
                  pr.retention_until, pr.review_note, pr.requested_at,
                  pr.reviewed_at, pr.executed_at, pr.context
           FROM patient_privacy_requests pr
           JOIN patients p ON p.id = pr.patient_id
           JOIN users rq ON rq.id = pr.requested_by
           LEFT JOIN users rv ON rv.id = pr.reviewed_by
           LEFT JOIN users ex ON ex.id = pr.executed_by
           WHERE pr.id = $1"#,
    )
    .bind(request_id)
    .fetch_optional(&state.db)
    .await
    {
        Ok(Some(row)) => Ok(map_privacy_request_row(&row)),
        Ok(None) => Err(err(StatusCode::NOT_FOUND, "Privacy request not found")),
        Err(e) => {
            tracing::error!(error = %e, request_id = %request_id, "load privacy request payload");
            Err(err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to load privacy request",
            ))
        }
    }
}

async fn load_patient_record_summary(
    state: &AppState,
    patient_id: Uuid,
) -> Result<Value, axum::response::Response> {
    match sqlx::query(
        r#"SELECT
               (SELECT count(*) FROM appointments WHERE patient_id = $1) AS appointments_count,
               (SELECT count(*) FROM cases WHERE patient_id = $1) AS cases_count,
               (SELECT count(*) FROM orders WHERE patient_id = $1) AS orders_count,
               (SELECT count(*) FROM documents WHERE patient_id = $1) AS documents_count,
               (SELECT count(*) FROM invoices WHERE patient_id = $1) AS invoices_count,
               (SELECT count(*) FROM patient_assignments WHERE patient_id = $1 AND revoked_at IS NULL) AS active_assignments_count"#,
    )
    .bind(patient_id)
    .fetch_one(&state.db)
    .await
    {
        Ok(row) => Ok(json!({
            "appointments": row.try_get::<i64, _>("appointments_count").unwrap_or_default(),
            "cases": row.try_get::<i64, _>("cases_count").unwrap_or_default(),
            "orders": row.try_get::<i64, _>("orders_count").unwrap_or_default(),
            "documents": row.try_get::<i64, _>("documents_count").unwrap_or_default(),
            "invoices": row.try_get::<i64, _>("invoices_count").unwrap_or_default(),
            "active_assignments": row.try_get::<i64, _>("active_assignments_count").unwrap_or_default(),
        })),
        Err(e) => {
            tracing::error!(error = %e, patient_id = %patient_id, "load patient record summary");
            Err(err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to inspect patient retention context",
            ))
        }
    }
}

async fn load_numeric_setting(state: &AppState, key: &str, default: i64) -> i64 {
    match sqlx::query(r#"SELECT value::TEXT AS value_text FROM system_settings WHERE key = $1"#)
        .bind(key)
        .fetch_optional(&state.db)
        .await
    {
        Ok(Some(row)) => row
            .try_get::<String, _>("value_text")
            .ok()
            .and_then(|value| value.trim_matches('"').parse::<i64>().ok())
            .unwrap_or(default),
        _ => default,
    }
}

async fn create_manual_erasure_request(
    state: &AppState,
    patient_id: Uuid,
    actor_id: Uuid,
) -> Result<Uuid, axum::response::Response> {
    let record_summary = load_patient_record_summary(state, patient_id).await?;
    let reviewed_at = Utc::now();
    let request_id = sqlx::query_scalar::<_, Uuid>(
        r#"INSERT INTO patient_privacy_requests (
                patient_id, requested_by, request_type, source, status, reason,
                due_at, reviewed_by, reviewed_at, review_note, context
           ) VALUES (
                $1, $2, 'erasure', 'admin_intake', 'approved', $3,
                $4, $2, $4, $5, $6
           )
           RETURNING id"#,
    )
    .bind(patient_id)
    .bind(actor_id)
    .bind("Legacy direct anonymize endpoint")
    .bind(reviewed_at)
    .bind("Automatic approval for direct anonymization")
    .bind(json!({
        "record_summary": record_summary,
        "manual_override": true,
        "created_via": "legacy_anonymize_endpoint",
    }))
    .fetch_one(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, patient_id = %patient_id, "create manual erasure request");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to prepare privacy request",
        )
    })?;

    let _ = sqlx::query(
        "INSERT INTO audit_log (user_id, action, entity_type, entity_id, context) VALUES ($1, 'privacy_request_created', 'patient', $2, $3)",
    )
    .bind(actor_id)
    .bind(patient_id)
    .bind(json!({
        "request_id": request_id,
        "request_type": "erasure",
        "source": "admin_intake",
        "reason": "Legacy direct anonymize endpoint",
        "manual_override": true,
    }))
    .execute(&state.db)
    .await;

    let _ = sqlx::query(
        "INSERT INTO audit_log (user_id, action, entity_type, entity_id, context) VALUES ($1, 'privacy_request_reviewed', 'patient', $2, $3)",
    )
    .bind(actor_id)
    .bind(patient_id)
    .bind(json!({
        "request_id": request_id,
        "request_type": "erasure",
        "review_action": "approve",
        "status": "approved",
        "review_note": "Automatic approval for direct anonymization",
        "manual_override": true,
    }))
    .execute(&state.db)
    .await;

    Ok(request_id)
}

async fn complete_privacy_request_execution(
    state: &AppState,
    patient_id: Uuid,
    request_id: Uuid,
    request_type: &str,
    actor_id: Uuid,
    manual_override: bool,
) -> Result<Value, axum::response::Response> {
    let execution = if request_type == "restriction" {
        apply_processing_restriction(state, patient_id, request_id, actor_id).await?
    } else if request_type == "third_party_revoke" {
        revoke_third_party_consents(state, patient_id, request_id, actor_id).await?
    } else {
        anonymize_patient_record(state, patient_id, request_id, actor_id, manual_override).await?
    };

    let executed_at = Utc::now();
    sqlx::query(
        r#"UPDATE patient_privacy_requests
           SET status = 'completed',
               executed_by = $2,
               executed_at = $3,
               updated_at = now(),
               context = COALESCE(context, '{}'::jsonb) || $4
           WHERE id = $1"#,
    )
    .bind(request_id)
    .bind(actor_id)
    .bind(executed_at)
    .bind(json!({
        "execution": execution,
        "manual_override": manual_override,
    }))
    .execute(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, request_id = %request_id, "complete privacy request");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to finalize privacy request",
        )
    })?;

    let _ = sqlx::query(
        "INSERT INTO audit_log (user_id, action, entity_type, entity_id, context) VALUES ($1, 'privacy_request_executed', 'patient', $2, $3)",
    )
    .bind(actor_id)
    .bind(patient_id)
    .bind(json!({
        "request_id": request_id,
        "request_type": request_type,
        "manual_override": manual_override,
        "executed_at": executed_at.to_rfc3339(),
        "execution": execution,
    }))
    .execute(&state.db)
    .await;

    Ok(json!({
        "ok": true,
        "request_id": request_id,
        "patient_id": patient_id,
        "request_type": request_type,
        "execution": execution,
    }))
}

async fn apply_processing_restriction(
    state: &AppState,
    patient_id: Uuid,
    request_id: Uuid,
    actor_id: Uuid,
) -> Result<Value, axum::response::Response> {
    let restricted_at = Utc::now();
    let restriction_payload = json!({
        "processing_restricted": true,
        "processing_restricted_at": restricted_at.to_rfc3339(),
        "processing_restriction_request_id": request_id.to_string(),
        "processing_restriction_by": actor_id.to_string(),
    });

    sqlx::query(
        r#"UPDATE patients
           SET legal_status = COALESCE(legal_status, '{}'::jsonb) || $2,
               updated_at = now()
           WHERE id = $1"#,
    )
    .bind(patient_id)
    .bind(restriction_payload)
    .execute(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, patient_id = %patient_id, "apply processing restriction");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to apply processing restriction",
        )
    })?;

    Ok(json!({
        "mode": "restriction",
        "restricted": true,
        "restricted_at": restricted_at.to_rfc3339(),
    }))
}

async fn anonymize_patient_record(
    state: &AppState,
    patient_id: Uuid,
    request_id: Uuid,
    actor_id: Uuid,
    manual_override: bool,
) -> Result<Value, axum::response::Response> {
    let anon = format!("ANON-{}", &patient_id.to_string()[..8]);
    let anonymized_at = Utc::now();

    let update = sqlx::query(
        r#"UPDATE patients
           SET patient_id = $2,
               title = NULL,
               first_name = $2,
               last_name = $2,
               birth_date = DATE '1900-01-01',
               gender = 'diverse',
               nationality = NULL,
               residence_country = NULL,
               languages = '{}',
               phone_primary = NULL,
               phone_secondary = NULL,
               email = NULL,
               address_street = NULL,
               address_city = NULL,
               address_zip = NULL,
               address_country = NULL,
               insurance_provider = NULL,
               insurance_number = NULL,
               insurance_type = NULL,
               emergency_contact_name = NULL,
               emergency_contact_phone = NULL,
               emergency_contact_relation = NULL,
               notes = NULL,
               is_active = false,
               legal_status = COALESCE(legal_status, '{}'::jsonb) || $3,
               updated_at = now()
           WHERE id = $1"#,
    )
    .bind(patient_id)
    .bind(&anon)
    .bind(json!({
        "processing_restricted": false,
        "anonymized_at": anonymized_at.to_rfc3339(),
        "anonymized_request_id": request_id.to_string(),
        "anonymized_by": actor_id.to_string(),
        "privacy_request_status": "completed",
    }))
    .execute(&state.db)
    .await;

    if let Err(e) = update {
        tracing::error!(error = %e, patient_id = %patient_id, "anonymize patient");
        return Err(err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to anonymize patient",
        ));
    }

    let assignments_revoked = sqlx::query(
        "UPDATE patient_assignments SET revoked_at = now() WHERE patient_id = $1 AND revoked_at IS NULL",
    )
    .bind(patient_id)
    .execute(&state.db)
    .await
    .map(|result| result.rows_affected())
    .unwrap_or_default();

    let consents_revoked = sqlx::query(
        "UPDATE consent_records SET revoked_at = $2 WHERE patient_id = $1 AND granted = true AND revoked_at IS NULL",
    )
    .bind(patient_id)
    .bind(anonymized_at)
    .execute(&state.db)
    .await
    .map(|result| result.rows_affected())
    .unwrap_or_default();

    let _ = sqlx::query(
        "INSERT INTO audit_log (user_id, action, entity_type, entity_id, context) VALUES ($1, 'dsgvo_anonymize', 'patient', $2, $3)",
    )
    .bind(actor_id)
    .bind(patient_id)
    .bind(json!({
        "article": "Art. 17",
        "anonymized_to": anon,
        "request_id": request_id,
        "manual_override": manual_override,
        "assignments_revoked": assignments_revoked,
        "consents_revoked": consents_revoked,
    }))
    .execute(&state.db)
    .await;

    tracing::warn!(admin = %actor_id, patient = %patient_id, "Patient anonymized (DSGVO Art. 17)");

    Ok(json!({
        "mode": "erasure",
        "anonymized_name": anon,
        "anonymized_at": anonymized_at.to_rfc3339(),
        "assignments_revoked": assignments_revoked,
        "consents_revoked": consents_revoked,
    }))
}

async fn revoke_third_party_consents(
    state: &AppState,
    patient_id: Uuid,
    request_id: Uuid,
    actor_id: Uuid,
) -> Result<Value, axum::response::Response> {
    let revoked_at = Utc::now();
    let revoked_rows = sqlx::query(
        r#"UPDATE consent_records
           SET revoked_at = $2
           WHERE patient_id = $1
             AND granted = true
             AND revoked_at IS NULL
             AND consent_type IN (
                 'dsgvo_data_transfer',
                 'third_party_sharing',
                 'schweigepflicht_release'
             )
           RETURNING consent_type"#,
    )
    .bind(patient_id)
    .bind(revoked_at)
    .fetch_all(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, patient_id = %patient_id, "revoke third-party consents");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to revoke third-party consents",
        )
    })?;

    let mut revoked_types = Vec::new();
    for row in &revoked_rows {
        let consent_type = row.try_get::<String, _>("consent_type").unwrap_or_default();
        if !consent_type.is_empty() && !revoked_types.contains(&consent_type) {
            revoked_types.push(consent_type);
        }
    }

    let revoked_count = revoked_rows.len() as u64;
    let legal_status_payload = json!({
        "third_party_sharing_revoked_at": revoked_at.to_rfc3339(),
        "third_party_sharing_request_id": request_id.to_string(),
        "third_party_sharing_revoked_by": actor_id.to_string(),
    });

    sqlx::query(
        r#"UPDATE patients
           SET legal_status = COALESCE(legal_status, '{}'::jsonb) || $2,
               updated_at = now()
           WHERE id = $1"#,
    )
    .bind(patient_id)
    .bind(legal_status_payload)
    .execute(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, patient_id = %patient_id, "persist third-party revoke legal status");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to persist third-party revoke status",
        )
    })?;

    let _ = sqlx::query(
        "INSERT INTO audit_log (user_id, action, entity_type, entity_id, context) VALUES ($1, 'consent_revoked', 'patient', $2, $3)",
    )
    .bind(actor_id)
    .bind(patient_id)
    .bind(json!({
        "request_id": request_id,
        "mode": "third_party_revoke",
        "consent_type": "third_party_sharing_bundle",
        "revoked_types": revoked_types,
        "revoked_count": revoked_count,
        "revoked_at": revoked_at.to_rfc3339(),
    }))
    .execute(&state.db)
    .await;

    Ok(json!({
        "mode": "third_party_revoke",
        "revoked_count": revoked_count,
        "revoked_types": revoked_types,
        "revoked_at": revoked_at.to_rfc3339(),
    }))
}

fn map_privacy_request_row(row: &PgRow) -> Value {
    let context = row
        .try_get::<Option<Value>, _>("context")
        .unwrap_or_default()
        .unwrap_or_else(|| json!({}));
    let due_at = row
        .try_get::<Option<chrono::DateTime<chrono::Utc>>, _>("due_at")
        .unwrap_or_default();

    json!({
        "id": row.try_get::<Uuid, _>("id").unwrap_or_else(|_| Uuid::nil()),
        "patient_id": row.try_get::<Uuid, _>("patient_id").unwrap_or_else(|_| Uuid::nil()),
        "patient_pid": row.try_get::<String, _>("patient_pid").unwrap_or_default(),
        "patient_name": row.try_get::<String, _>("patient_name").unwrap_or_default(),
        "requested_by_name": row.try_get::<String, _>("requested_by_name").unwrap_or_default(),
        "reviewed_by_name": row.try_get::<Option<String>, _>("reviewed_by_name").unwrap_or_default(),
        "executed_by_name": row.try_get::<Option<String>, _>("executed_by_name").unwrap_or_default(),
        "request_type": row.try_get::<String, _>("request_type").unwrap_or_default(),
        "source": row.try_get::<String, _>("source").unwrap_or_default(),
        "status": row.try_get::<String, _>("status").unwrap_or_default(),
        "reason": row.try_get::<Option<String>, _>("reason").unwrap_or_default(),
        "due_at": due_at.map(|value| value.to_rfc3339()),
        "retention_until": row.try_get::<Option<chrono::DateTime<chrono::Utc>>, _>("retention_until").unwrap_or_default().map(|value| value.to_rfc3339()),
        "review_note": row.try_get::<Option<String>, _>("review_note").unwrap_or_default(),
        "requested_at": row.try_get::<chrono::DateTime<chrono::Utc>, _>("requested_at").map(|value| value.to_rfc3339()).unwrap_or_default(),
        "reviewed_at": row.try_get::<Option<chrono::DateTime<chrono::Utc>>, _>("reviewed_at").unwrap_or_default().map(|value| value.to_rfc3339()),
        "executed_at": row.try_get::<Option<chrono::DateTime<chrono::Utc>>, _>("executed_at").unwrap_or_default().map(|value| value.to_rfc3339()),
        "record_summary": context.get("record_summary").cloned(),
        "manual_override": context.get("manual_override").and_then(Value::as_bool).unwrap_or(false),
        "is_overdue": due_at.map(|value| value < Utc::now()).unwrap_or(false),
    })
}

#[allow(clippy::result_large_err)]
fn normalize_consent_type(value: &str) -> Result<String, axum::response::Response> {
    let normalized = value.trim().to_lowercase().replace([' ', '-'], "_");

    if normalized.is_empty() || normalized.len() > 80 {
        return Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Consent type is required",
        ));
    }

    if !normalized
        .chars()
        .all(|ch| ch.is_ascii_lowercase() || ch.is_ascii_digit() || ch == '_')
    {
        return Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Consent type must use letters, digits, spaces or hyphens",
        ));
    }

    Ok(normalized)
}

#[allow(clippy::result_large_err)]
fn normalize_privacy_request_type(value: &str) -> Result<String, axum::response::Response> {
    let normalized = value.trim().to_lowercase();

    if matches!(
        normalized.as_str(),
        "erasure" | "restriction" | "third_party_revoke"
    ) {
        Ok(normalized)
    } else {
        Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Privacy request type must be erasure, restriction or third_party_revoke",
        ))
    }
}

#[allow(clippy::result_large_err)]
fn normalize_privacy_request_source(
    value: Option<&str>,
) -> Result<String, axum::response::Response> {
    let normalized = value.unwrap_or("patient_request").trim().to_lowercase();

    if matches!(
        normalized.as_str(),
        "patient_request" | "admin_intake" | "legal_hold"
    ) {
        Ok(normalized)
    } else {
        Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Privacy request source is invalid",
        ))
    }
}

#[allow(clippy::result_large_err)]
fn normalize_privacy_review_action(value: &str) -> Result<String, axum::response::Response> {
    let normalized = value.trim().to_lowercase();

    if matches!(normalized.as_str(), "approve" | "hold" | "reject") {
        Ok(normalized)
    } else {
        Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Privacy review action is invalid",
        ))
    }
}

fn normalize_optional(value: Option<&str>) -> Option<String> {
    let trimmed = value?.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn err(status: StatusCode, message: &str) -> axum::response::Response {
    (status, Json(serde_json::json!({ "error": status.canonical_reason().unwrap_or("error"), "message": message }))).into_response()
}
