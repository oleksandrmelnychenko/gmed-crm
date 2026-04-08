use axum::{
    Json, Router,
    extract::{Extension, Path, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
};
use uuid::Uuid;

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
        .route("/admin/compliance/consents", get(consent_dashboard))
        .route("/admin/compliance/consents/expired", get(expired_consents))
}

async fn export_patient_data(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(patient_id): Path<Uuid>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::PatientManager]) {
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
    if let Err(e) = auth.require_any_role(&[Role::ItAdmin]) {
        return e;
    }

    let exists = sqlx::query_scalar!(
        r#"SELECT EXISTS(SELECT 1 FROM patients WHERE id = $1) AS "e!""#,
        patient_id
    )
    .fetch_one(&state.db)
    .await
    .unwrap_or(false);

    if !exists {
        return err(StatusCode::NOT_FOUND, "Patient not found");
    }

    let anon = format!("ANON-{}", &patient_id.to_string()[..8]);

    let _ = sqlx::query!(
        r#"UPDATE patients SET
            first_name = $2, last_name = $2,
            email = NULL, phone_primary = NULL, phone_secondary = NULL,
            nationality = NULL, languages = '{}',
            notes = NULL, is_active = false, updated_at = now()
           WHERE id = $1"#,
        patient_id,
        anon
    )
    .execute(&state.db)
    .await;

    let _ = sqlx::query!(
        "UPDATE patient_assignments SET revoked_at = now() WHERE patient_id = $1 AND revoked_at IS NULL",
        patient_id
    ).execute(&state.db).await;

    let _ = sqlx::query!(
        "INSERT INTO audit_log (user_id, action, entity_type, entity_id, context) VALUES ($1, 'dsgvo_anonymize', 'patient', $2, $3)",
        auth.user_id, patient_id, serde_json::json!({"article": "Art. 17", "anonymized_to": anon})
    ).execute(&state.db).await;

    tracing::warn!(admin = %auth.user_id, patient = %patient_id, "Patient anonymized (DSGVO Art. 17)");
    Json(serde_json::json!({"ok": true, "anonymized_name": anon})).into_response()
}

async fn consent_dashboard(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::PatientManager]) {
        return e;
    }

    let total = sqlx::query_scalar!(r#"SELECT count(*) AS "c!" FROM consent_records"#)
        .fetch_one(&state.db)
        .await
        .unwrap_or(0);
    let granted = sqlx::query_scalar!(
        r#"SELECT count(*) AS "c!" FROM consent_records WHERE granted = true AND revoked_at IS NULL"#
    ).fetch_one(&state.db).await.unwrap_or(0);
    let revoked = sqlx::query_scalar!(
        r#"SELECT count(*) AS "c!" FROM consent_records WHERE revoked_at IS NOT NULL"#
    )
    .fetch_one(&state.db)
    .await
    .unwrap_or(0);

    let by_type = sqlx::query!(
        r#"SELECT consent_type AS "consent_type!", count(*) AS "count!",
                  count(*) FILTER (WHERE granted = true AND revoked_at IS NULL) AS "active!"
           FROM consent_records GROUP BY consent_type ORDER BY consent_type"#
    )
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();

    let recent_changes = sqlx::query!(
        r#"SELECT cr.id, cr.user_id, u.name AS "user_name!",
                  cr.consent_type, cr.granted, cr.granted_at, cr.revoked_at
           FROM consent_records cr
           JOIN users u ON u.id = cr.user_id
           ORDER BY cr.created_at DESC LIMIT 20"#
    )
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();

    Json(serde_json::json!({
        "total": total,
        "granted_active": granted,
        "revoked": revoked,
        "by_type": by_type.into_iter().map(|r| serde_json::json!({
            "consent_type": r.consent_type, "total": r.count, "active": r.active,
        })).collect::<Vec<_>>(),
        "recent_changes": recent_changes.into_iter().map(|r| serde_json::json!({
            "id": r.id, "user_name": r.user_name,
            "consent_type": r.consent_type, "granted": r.granted,
            "granted_at": r.granted_at, "revoked_at": r.revoked_at,
        })).collect::<Vec<_>>(),
    }))
    .into_response()
}

async fn expired_consents(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::PatientManager]) {
        return e;
    }

    match sqlx::query!(
        r#"SELECT cr.id, cr.user_id, u.name AS "user_name!",
                  cr.consent_type, cr.granted_at
           FROM consent_records cr
           JOIN users u ON u.id = cr.user_id
           WHERE cr.granted = true AND cr.revoked_at IS NULL
             AND cr.granted_at < now() - interval '1 year'
           ORDER BY cr.granted_at ASC LIMIT 100"#
    )
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => {
            let data: Vec<serde_json::Value> = rows
                .into_iter()
                .map(|r| {
                    serde_json::json!({
                        "id": r.id, "user_id": r.user_id, "user_name": r.user_name,
                        "consent_type": r.consent_type, "granted_at": r.granted_at,
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

fn err(status: StatusCode, message: &str) -> axum::response::Response {
    (status, Json(serde_json::json!({ "error": status.canonical_reason().unwrap_or("error"), "message": message }))).into_response()
}
