use axum::{
    Json, Router,
    extract::{Extension, Path, Query, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
};
use serde::Deserialize;
use sqlx::Row;
use uuid::Uuid;

use crate::auth::middleware::AuthUser;
use crate::state::AppState;
use gmed_domain::role::Role;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/leads", get(list_leads).post(create_lead))
        .route("/leads/{lead_id}", get(get_lead))
        .route("/leads/{lead_id}/qualify", post(qualify_lead))
        .route("/leads/{lead_id}/convert", post(convert_lead))
}

#[derive(Deserialize)]
struct CreateLeadRequest {
    first_name: String,
    last_name: String,
    email: Option<String>,
    phone: Option<String>,
    source: Option<String>,
    country: Option<String>,
    languages: Option<Vec<String>>,
    needs_medical: Option<String>,
    needs_non_medical: Option<String>,
    notes: Option<String>,
}

#[derive(Deserialize)]
struct QualifyRequest {
    status: String,
}

#[derive(Deserialize)]
struct ListLeadsQuery {
    search: Option<String>,
    status: Option<String>,
    source: Option<String>,
    country: Option<String>,
    include_archived: Option<bool>,
}

async fn list_leads(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Query(query): Query<ListLeadsQuery>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::PatientManager, Role::Sales]) {
        return e;
    }

    if let Some(ref status) = query.status
        && !is_valid_lead_status(status)
    {
        return err(StatusCode::UNPROCESSABLE_ENTITY, "Invalid status");
    }

    let include_archived = query.include_archived.unwrap_or(false);
    let search_pattern = format!("%{}%", query.search.unwrap_or_default());
    let source_pattern = format!("%{}%", query.source.unwrap_or_default());
    let country_pattern = format!("%{}%", query.country.unwrap_or_default());

    match sqlx::query(
        r#"SELECT id, first_name, last_name, email, phone, source, country,
                  qualification_status, compliance_status, created_at
           FROM leads
           WHERE ($1::bool = true OR qualification_status != 'archived')
             AND ($2::text IS NULL OR qualification_status = $2)
             AND (
                $3::text = '%%'
                OR first_name ILIKE $3
                OR last_name ILIKE $3
                OR COALESCE(email, '') ILIKE $3
                OR COALESCE(phone, '') ILIKE $3
                OR COALESCE(source, '') ILIKE $3
                OR COALESCE(country, '') ILIKE $3
             )
             AND ($4::text = '%%' OR COALESCE(source, '') ILIKE $4)
             AND ($5::text = '%%' OR COALESCE(country, '') ILIKE $5)
           ORDER BY created_at DESC
           LIMIT 200"#,
    )
    .bind(include_archived)
    .bind(query.status)
    .bind(search_pattern)
    .bind(source_pattern)
    .bind(country_pattern)
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => {
            let mut leads = Vec::with_capacity(rows.len());
            for r in rows {
                leads.push(serde_json::json!({
                    "id": r.try_get::<Uuid, _>("id").unwrap_or_default(),
                    "first_name": r.try_get::<String, _>("first_name").unwrap_or_default(),
                    "last_name": r.try_get::<String, _>("last_name").unwrap_or_default(),
                    "email": r.try_get::<Option<String>, _>("email").unwrap_or_default(),
                    "phone": r.try_get::<Option<String>, _>("phone").unwrap_or_default(),
                    "source": r.try_get::<Option<String>, _>("source").unwrap_or_default(),
                    "country": r.try_get::<Option<String>, _>("country").unwrap_or_default(),
                    "qualification_status": r.try_get::<String, _>("qualification_status").unwrap_or_default(),
                    "compliance_status": r.try_get::<String, _>("compliance_status").unwrap_or_default(),
                    "created_at": r.try_get::<chrono::DateTime<chrono::Utc>, _>("created_at").map(|v| v.to_rfc3339()).unwrap_or_default(),
                }));
            }
            Json(leads).into_response()
        }
        Err(e) => {
            tracing::error!(error = %e, "list leads");
            err(StatusCode::INTERNAL_SERVER_ERROR, "Failed")
        }
    }
}

fn is_valid_lead_status(value: &str) -> bool {
    matches!(
        value,
        "new" | "in_progress" | "qualified" | "not_qualified" | "converted" | "archived"
    )
}

async fn create_lead(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Json(body): Json<CreateLeadRequest>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::PatientManager, Role::Sales]) {
        return e;
    }

    if body.first_name.is_empty() || body.last_name.is_empty() {
        return err(StatusCode::UNPROCESSABLE_ENTITY, "Name required");
    }

    let langs = body.languages.unwrap_or_default();

    match sqlx::query!(
        "INSERT INTO leads (first_name, last_name, email, phone, source, country, languages, needs_medical, needs_non_medical, notes, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id, created_at",
        body.first_name, body.last_name, body.email, body.phone, body.source, body.country,
        &langs, body.needs_medical, body.needs_non_medical, body.notes, auth.user_id
    ).fetch_one(&state.db).await {
        Ok(r) => {
            let _ = sqlx::query!("INSERT INTO audit_log (user_id, action, entity_type, entity_id) VALUES ($1, 'create_lead', 'lead', $2)", auth.user_id, r.id).execute(&state.db).await;
            tracing::info!(by = %auth.user_id, lead = %r.id, "Lead created");
            (StatusCode::CREATED, Json(serde_json::json!({"id": r.id, "created_at": r.created_at}))).into_response()
        }
        Err(e) => { tracing::error!(error = %e, "create lead"); err(StatusCode::INTERNAL_SERVER_ERROR, "Failed") }
    }
}

async fn get_lead(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(lead_id): Path<Uuid>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::PatientManager, Role::Sales]) {
        return e;
    }

    match sqlx::query!(
        "SELECT id, first_name, last_name, email, phone, source, country, languages, needs_medical, needs_non_medical,
                compliance_status, qualification_status, converted_patient_id, notes, created_at, updated_at
         FROM leads WHERE id = $1", lead_id
    ).fetch_optional(&state.db).await {
        Ok(Some(r)) => Json(serde_json::json!({
            "id": r.id, "first_name": r.first_name, "last_name": r.last_name,
            "email": r.email, "phone": r.phone, "source": r.source, "country": r.country,
            "languages": r.languages, "needs_medical": r.needs_medical, "needs_non_medical": r.needs_non_medical,
            "compliance_status": r.compliance_status, "qualification_status": r.qualification_status,
            "converted_patient_id": r.converted_patient_id, "notes": r.notes,
            "created_at": r.created_at, "updated_at": r.updated_at,
        })).into_response(),
        Ok(None) => err(StatusCode::NOT_FOUND, "Lead not found"),
        Err(e) => { tracing::error!(error = %e, "get lead"); err(StatusCode::INTERNAL_SERVER_ERROR, "Failed") }
    }
}

async fn qualify_lead(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(lead_id): Path<Uuid>,
    Json(body): Json<QualifyRequest>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::PatientManager, Role::Sales]) {
        return e;
    }

    match body.status.as_str() {
        "new" => {}
        "in_progress" => {}
        "qualified" => {}
        "not_qualified" => {}
        "archived" => {}
        _ => return err(StatusCode::UNPROCESSABLE_ENTITY, "Invalid status"),
    }

    match sqlx::query!(
        "UPDATE leads SET qualification_status = $2 WHERE id = $1",
        lead_id,
        body.status
    )
    .execute(&state.db)
    .await
    {
        Ok(r) if r.rows_affected() > 0 => {
            let _ = sqlx::query!("INSERT INTO audit_log (user_id, action, entity_type, entity_id, context) VALUES ($1, 'qualify_lead', 'lead', $2, $3)",
                auth.user_id, lead_id, serde_json::json!({"status": body.status})
            ).execute(&state.db).await;
            Json(serde_json::json!({"ok": true})).into_response()
        }
        Ok(_) => err(StatusCode::NOT_FOUND, "Lead not found"),
        Err(e) => {
            tracing::error!(error = %e, "qualify lead");
            err(StatusCode::INTERNAL_SERVER_ERROR, "Failed")
        }
    }
}

async fn convert_lead(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(lead_id): Path<Uuid>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::PatientManager]) {
        return e;
    }

    let lead = match sqlx::query!(
        "SELECT id, first_name, last_name, email, phone, country, languages, qualification_status, converted_patient_id FROM leads WHERE id = $1",
        lead_id
    ).fetch_optional(&state.db).await {
        Ok(Some(l)) => l,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Lead not found"),
        Err(e) => { tracing::error!(error = %e, "convert lead"); return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed"); }
    };

    if lead.converted_patient_id.is_some() {
        return err(StatusCode::CONFLICT, "Lead already converted");
    }

    if lead.qualification_status != "qualified" {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Lead must be qualified before conversion",
        );
    }

    let seq: i64 = sqlx::query_scalar!("SELECT nextval('patient_id_seq') AS \"v!\"")
        .fetch_one(&state.db)
        .await
        .unwrap_or(0);
    let pid = format!("P-{}-{:04}", chrono::Utc::now().format("%Y%m%d"), seq);

    let patient = match sqlx::query!(
        "INSERT INTO patients (patient_id, first_name, last_name, birth_date, gender, email, phone_primary, nationality, languages, created_by)
         VALUES ($1, $2, $3, '1900-01-01', 'diverse', $4, $5, $6, $7, $8) RETURNING id",
        pid, lead.first_name, lead.last_name, lead.email, lead.phone, lead.country, &lead.languages, auth.user_id
    ).fetch_one(&state.db).await {
        Ok(p) => p,
        Err(e) => { tracing::error!(error = %e, "create patient from lead"); return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed"); }
    };

    let _ = sqlx::query!("UPDATE leads SET qualification_status = 'converted', converted_patient_id = $2 WHERE id = $1", lead_id, patient.id)
        .execute(&state.db).await;

    let _ = sqlx::query!(
        "INSERT INTO patient_assignments (patient_id, user_id, assigned_by) VALUES ($1, $2, $2)",
        patient.id,
        auth.user_id
    )
    .execute(&state.db)
    .await;

    let _ = sqlx::query!("INSERT INTO audit_log (user_id, action, entity_type, entity_id, context) VALUES ($1, 'convert_lead', 'lead', $2, $3)",
        auth.user_id, lead_id, serde_json::json!({"patient_id": patient.id, "patient_pid": pid})
    ).execute(&state.db).await;

    tracing::info!(by = %auth.user_id, lead = %lead_id, patient = %patient.id, "Lead converted to patient");

    Json(serde_json::json!({
        "patient_id": patient.id,
        "patient_pid": pid,
    }))
    .into_response()
}

fn err(status: StatusCode, message: &str) -> axum::response::Response {
    (status, Json(serde_json::json!({ "error": status.canonical_reason().unwrap_or("error"), "message": message }))).into_response()
}
