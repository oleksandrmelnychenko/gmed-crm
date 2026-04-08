use axum::{
    Json, Router,
    extract::{Extension, Path, Query, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
};
use serde::Deserialize;
use serde_json::{Map, Value};
use std::collections::HashMap;
use uuid::Uuid;

use crate::access;
use crate::auth::middleware::AuthUser;
use crate::state::AppState;
use gmed_domain::role::Role;
use sqlx::Row;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/patients", get(list_patients).post(create_patient))
        .route("/patients/{patient_id}", get(get_patient))
        .route("/patients/{patient_id}/assignments", get(list_assignments))
        .route("/patients/{patient_id}/update", post(update_patient))
        .route("/patients/{patient_id}/assign", post(assign_patient))
}

#[derive(Debug, Clone)]
struct FieldPolicy {
    access_level: String,
    condition_type: Option<String>,
}

#[derive(Deserialize)]
struct CreatePatientRequest {
    title: Option<String>,
    first_name: String,
    last_name: String,
    birth_date: String,
    gender: String,
    nationality: Option<String>,
    residence_country: Option<String>,
    languages: Option<Vec<String>>,
    phone_primary: Option<String>,
    phone_secondary: Option<String>,
    email: Option<String>,
    address_street: Option<String>,
    address_city: Option<String>,
    address_zip: Option<String>,
    address_country: Option<String>,
    insurance_provider: Option<String>,
    insurance_number: Option<String>,
    insurance_type: Option<String>,
    emergency_contact_name: Option<String>,
    emergency_contact_phone: Option<String>,
    emergency_contact_relation: Option<String>,
    notes: Option<String>,
}

#[derive(Deserialize)]
struct UpdatePatientRequest {
    title: Option<String>,
    first_name: Option<String>,
    last_name: Option<String>,
    phone_primary: Option<String>,
    phone_secondary: Option<String>,
    email: Option<String>,
    nationality: Option<String>,
    residence_country: Option<String>,
    languages: Option<Vec<String>>,
    address_street: Option<String>,
    address_city: Option<String>,
    address_zip: Option<String>,
    address_country: Option<String>,
    insurance_provider: Option<String>,
    insurance_number: Option<String>,
    insurance_type: Option<String>,
    emergency_contact_name: Option<String>,
    emergency_contact_phone: Option<String>,
    emergency_contact_relation: Option<String>,
    notes: Option<String>,
}

#[derive(Deserialize)]
struct AssignRequest {
    user_id: Uuid,
}

#[derive(Deserialize)]
struct ListQuery {
    search: Option<String>,
    active_only: Option<bool>,
    provider_id: Option<Uuid>,
    doctor_id: Option<Uuid>,
}

fn validate_create(req: &CreatePatientRequest) -> Result<(), &'static str> {
    if req.first_name.is_empty() || req.first_name.len() > 200 {
        return Err("First name required (max 200)");
    }
    if req.last_name.is_empty() || req.last_name.len() > 200 {
        return Err("Last name required (max 200)");
    }
    if req.birth_date.is_empty() {
        return Err("Birth date required");
    }
    match req.gender.as_str() {
        "male" => {}
        "female" => {}
        "diverse" => {}
        _ => return Err("Gender must be male, female, or diverse"),
    }
    if let Some(ref it) = req.insurance_type {
        match it.as_str() {
            "private" => {}
            "public" => {}
            "self_pay" => {}
            "foreign" => {}
            _ => return Err("Invalid insurance type"),
        }
    }
    Ok(())
}

fn generate_patient_id(seq: i64) -> String {
    let now = chrono::Utc::now();
    format!("P-{}-{:04}", now.format("%Y%m%d"), seq)
}

async fn list_patients(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Query(query): Query<ListQuery>,
) -> impl IntoResponse {
    auth.require_any_role(&[
        Role::Ceo,
        Role::PatientManager,
        Role::Billing,
        Role::TeamleadInterpreter,
        Role::Interpreter,
        Role::Concierge,
    ])?;

    let active_only = query.active_only.unwrap_or(true);
    let search = query.search.unwrap_or_default();
    let search_pattern = format!("%{search}%");
    let provider_id = query.provider_id;
    let doctor_id = query.doctor_id;

    let rows = sqlx::query(
        r#"SELECT p.id, p.patient_id, p.title, p.first_name, p.last_name,
                  p.birth_date, p.gender, p.nationality, p.residence_country,
                  p.languages, p.phone_primary, p.email,
                  p.insurance_provider, p.insurance_type,
                  p.is_active, p.created_at
           FROM patients p
           WHERE ($1::bool = false OR p.is_active = true)
             AND ($2::text = '%%' OR p.first_name ILIKE $2 OR p.last_name ILIKE $2 OR p.patient_id ILIKE $2)
             AND (
                $3::uuid IS NULL
                OR EXISTS (
                    SELECT 1
                    FROM appointments a
                    WHERE a.patient_id = p.id
                      AND a.provider_id = $3
                )
                OR EXISTS (
                    SELECT 1
                    FROM order_leistungen ol
                    JOIN orders o ON o.id = ol.order_id
                    WHERE o.patient_id = p.id
                      AND ol.provider_id = $3
                )
             )
             AND (
                $4::uuid IS NULL
                OR EXISTS (
                    SELECT 1
                    FROM appointments a
                    WHERE a.patient_id = p.id
                      AND a.doctor_id = $4
                )
                OR EXISTS (
                    SELECT 1
                    FROM order_leistungen ol
                    JOIN orders o ON o.id = ol.order_id
                    WHERE o.patient_id = p.id
                      AND ol.doctor_id = $4
                )
             )
           ORDER BY p.created_at DESC
           LIMIT 100"#,
    )
    .bind(active_only)
    .bind(search_pattern)
    .bind(provider_id)
    .bind(doctor_id)
    .fetch_all(&state.db)
    .await;

    match rows {
        Ok(rows) => {
            let policies = load_patient_field_policies(&state, &auth).await?;
            let mut patients = Vec::with_capacity(rows.len());
            for r in rows {
                let patient_id: Uuid = r.try_get("id").map_err(|_| {
                    err(
                        StatusCode::INTERNAL_SERVER_ERROR,
                        "Failed to decode patient",
                    )
                })?;

                if access::requires_patient_assignment(auth.role)
                    && !has_patient_access(&state, &auth, patient_id).await?
                {
                    continue;
                }

                patients.push(build_patient_summary_json(
                    &auth,
                    &policies,
                    PatientSummaryInput {
                        id: patient_id,
                        patient_id: r.try_get("patient_id").unwrap_or_default(),
                        title: r.try_get("title").unwrap_or_default(),
                        first_name: r.try_get("first_name").unwrap_or_default(),
                        last_name: r.try_get("last_name").unwrap_or_default(),
                        birth_date: r.try_get("birth_date").map_err(|_| {
                            err(
                                StatusCode::INTERNAL_SERVER_ERROR,
                                "Failed to decode patient",
                            )
                        })?,
                        gender: r.try_get("gender").unwrap_or_default(),
                        nationality: r.try_get("nationality").unwrap_or_default(),
                        residence_country: r.try_get("residence_country").unwrap_or_default(),
                        languages: r.try_get("languages").unwrap_or_default(),
                        phone_primary: r.try_get("phone_primary").unwrap_or_default(),
                        email: r.try_get("email").unwrap_or_default(),
                        insurance_provider: r.try_get("insurance_provider").unwrap_or_default(),
                        insurance_type: r.try_get("insurance_type").unwrap_or_default(),
                        is_active: r.try_get("is_active").unwrap_or(true),
                        created_at: r.try_get("created_at").map_err(|_| {
                            err(
                                StatusCode::INTERNAL_SERVER_ERROR,
                                "Failed to decode patient",
                            )
                        })?,
                    },
                ));
            }
            Ok(Json(patients))
        }
        Err(e) => {
            tracing::error!(error = %e, "Failed to list patients");
            Err(err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to list patients",
            ))
        }
    }
}

async fn get_patient(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(patient_uuid): Path<Uuid>,
) -> impl IntoResponse {
    auth.require_any_role(&[
        Role::Ceo,
        Role::PatientManager,
        Role::Billing,
        Role::TeamleadInterpreter,
        Role::Interpreter,
        Role::Concierge,
    ])?;

    match sqlx::query!(
        r#"SELECT id, patient_id, title, first_name, last_name,
                  birth_date, gender, nationality, residence_country,
                  languages, phone_primary, phone_secondary, email,
                  address_street, address_city, address_zip, address_country,
                  insurance_provider, insurance_number, insurance_type,
                  emergency_contact_name, emergency_contact_phone, emergency_contact_relation,
                  legal_status, notes, is_active, created_at, updated_at
           FROM patients WHERE id = $1"#,
        patient_uuid
    )
    .fetch_optional(&state.db)
    .await
    {
        Ok(Some(r)) => {
            if !has_patient_access(&state, &auth, r.id).await? {
                return Err(err(StatusCode::FORBIDDEN, "Insufficient permissions"));
            }

            let policies = load_patient_field_policies(&state, &auth).await?;
            Ok(Json(build_patient_detail_json(
                &auth,
                &policies,
                PatientDetailInput {
                    id: r.id,
                    patient_id: r.patient_id,
                    title: r.title,
                    first_name: r.first_name,
                    last_name: r.last_name,
                    birth_date: r.birth_date,
                    gender: r.gender,
                    nationality: r.nationality,
                    residence_country: r.residence_country,
                    languages: r.languages,
                    phone_primary: r.phone_primary,
                    phone_secondary: r.phone_secondary,
                    email: r.email,
                    address_street: r.address_street,
                    address_city: r.address_city,
                    address_zip: r.address_zip,
                    address_country: r.address_country,
                    insurance_provider: r.insurance_provider,
                    insurance_number: r.insurance_number,
                    insurance_type: r.insurance_type,
                    emergency_contact_name: r.emergency_contact_name,
                    emergency_contact_phone: r.emergency_contact_phone,
                    emergency_contact_relation: r.emergency_contact_relation,
                    legal_status: r.legal_status,
                    notes: r.notes,
                    is_active: r.is_active,
                    created_at: r.created_at,
                    updated_at: r.updated_at,
                },
            )))
        }
        Ok(None) => Err(err(StatusCode::NOT_FOUND, "Patient not found")),
        Err(e) => {
            tracing::error!(error = %e, "Failed to get patient");
            Err(err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to get patient",
            ))
        }
    }
}

async fn create_patient(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Json(body): Json<CreatePatientRequest>,
) -> impl IntoResponse {
    auth.require_any_role(&[Role::Ceo, Role::PatientManager])?;

    if let Err(msg) = validate_create(&body) {
        return Err(err(StatusCode::UNPROCESSABLE_ENTITY, msg));
    }

    let birth_date =
        chrono::NaiveDate::parse_from_str(&body.birth_date, "%Y-%m-%d").map_err(|_| {
            err(
                StatusCode::UNPROCESSABLE_ENTITY,
                "Invalid birth_date format (YYYY-MM-DD)",
            )
        })?;

    let seq: i64 = sqlx::query_scalar!("SELECT nextval('patient_id_seq') AS \"val!\"")
        .fetch_one(&state.db)
        .await
        .map_err(|e| {
            tracing::error!(error = %e, "Failed to get patient sequence");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to create patient",
            )
        })?;

    let pid = generate_patient_id(seq);
    let langs = body.languages.unwrap_or_default();

    let row = sqlx::query!(
        r#"INSERT INTO patients (
            patient_id, title, first_name, last_name, birth_date, gender,
            nationality, residence_country, languages,
            phone_primary, phone_secondary, email,
            address_street, address_city, address_zip, address_country,
            insurance_provider, insurance_number, insurance_type,
            emergency_contact_name, emergency_contact_phone, emergency_contact_relation,
            notes, created_by
        ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9,
            $10, $11, $12, $13, $14, $15, $16,
            $17, $18, $19, $20, $21, $22, $23, $24
        ) RETURNING id, patient_id, created_at"#,
        pid,
        body.title,
        body.first_name,
        body.last_name,
        birth_date,
        body.gender,
        body.nationality,
        body.residence_country,
        &langs,
        body.phone_primary,
        body.phone_secondary,
        body.email,
        body.address_street,
        body.address_city,
        body.address_zip,
        body.address_country,
        body.insurance_provider,
        body.insurance_number,
        body.insurance_type,
        body.emergency_contact_name,
        body.emergency_contact_phone,
        body.emergency_contact_relation,
        body.notes,
        auth.user_id
    )
    .fetch_one(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, "Failed to create patient");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to create patient",
        )
    })?;

    sqlx::query!(
        "INSERT INTO patient_assignments (patient_id, user_id, assigned_by) VALUES ($1, $2, $2)",
        row.id,
        auth.user_id
    )
    .execute(&state.db)
    .await
    .ok();

    let _ = sqlx::query!(
        "INSERT INTO audit_log (user_id, action, entity_type, entity_id, context)
         VALUES ($1, 'create_patient', 'patient', $2, $3)",
        auth.user_id,
        row.id,
        serde_json::json!({ "patient_id": row.patient_id })
    )
    .execute(&state.db)
    .await;

    tracing::info!(by = %auth.user_id, patient = %row.patient_id, "Patient created");

    Ok((
        StatusCode::CREATED,
        Json(serde_json::json!({
            "id": row.id,
            "patient_id": row.patient_id,
            "created_at": row.created_at,
        })),
    ))
}

async fn update_patient(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(patient_uuid): Path<Uuid>,
    Json(body): Json<UpdatePatientRequest>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::Ceo, Role::PatientManager]) {
        return e;
    }
    match has_patient_access(&state, &auth, patient_uuid).await {
        Ok(true) => {}
        Ok(false) => return err(StatusCode::FORBIDDEN, "Insufficient permissions"),
        Err(_) => {
            tracing::error!(patient_id = %patient_uuid, "Failed to validate patient access");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to update patient",
            );
        }
    }

    let current = match sqlx::query!(
        "SELECT first_name, last_name FROM patients WHERE id = $1",
        patient_uuid
    )
    .fetch_optional(&state.db)
    .await
    {
        Ok(Some(r)) => r,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Patient not found"),
        Err(e) => {
            tracing::error!(error = %e, "DB error");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to update patient",
            );
        }
    };

    let first = body.first_name.as_deref().unwrap_or(&current.first_name);
    let last = body.last_name.as_deref().unwrap_or(&current.last_name);

    let result = sqlx::query!(
        r#"UPDATE patients SET
            title = COALESCE($2, title),
            first_name = $3, last_name = $4,
            phone_primary = COALESCE($5, phone_primary),
            phone_secondary = COALESCE($6, phone_secondary),
            email = COALESCE($7, email),
            nationality = COALESCE($8, nationality),
            residence_country = COALESCE($9, residence_country),
            languages = COALESCE($10, languages),
            address_street = COALESCE($11, address_street),
            address_city = COALESCE($12, address_city),
            address_zip = COALESCE($13, address_zip),
            address_country = COALESCE($14, address_country),
            insurance_provider = COALESCE($15, insurance_provider),
            insurance_number = COALESCE($16, insurance_number),
            insurance_type = COALESCE($17, insurance_type),
            emergency_contact_name = COALESCE($18, emergency_contact_name),
            emergency_contact_phone = COALESCE($19, emergency_contact_phone),
            emergency_contact_relation = COALESCE($20, emergency_contact_relation),
            notes = COALESCE($21, notes)
        WHERE id = $1"#,
        patient_uuid,
        body.title,
        first,
        last,
        body.phone_primary,
        body.phone_secondary,
        body.email,
        body.nationality,
        body.residence_country,
        body.languages.as_deref(),
        body.address_street,
        body.address_city,
        body.address_zip,
        body.address_country,
        body.insurance_provider,
        body.insurance_number,
        body.insurance_type,
        body.emergency_contact_name,
        body.emergency_contact_phone,
        body.emergency_contact_relation,
        body.notes
    )
    .execute(&state.db)
    .await;

    match result {
        Ok(_) => {
            let _ = sqlx::query!(
                "INSERT INTO audit_log (user_id, action, entity_type, entity_id) VALUES ($1, 'update_patient', 'patient', $2)",
                auth.user_id, patient_uuid
            )
            .execute(&state.db)
            .await;
            Json(serde_json::json!({"ok": true})).into_response()
        }
        Err(e) => {
            tracing::error!(error = %e, "Failed to update patient");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to update patient",
            )
        }
    }
}

async fn list_assignments(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(patient_uuid): Path<Uuid>,
) -> impl IntoResponse {
    auth.require_any_role(&[
        Role::Ceo,
        Role::PatientManager,
        Role::TeamleadInterpreter,
        Role::Interpreter,
        Role::Concierge,
    ])?;

    if !has_patient_access(&state, &auth, patient_uuid).await? && auth.role != Role::Ceo {
        return Err(err(StatusCode::FORBIDDEN, "Insufficient permissions"));
    }

    let rows = sqlx::query(
        r#"SELECT pa.user_id, pa.assigned_at, pa.revoked_at,
                  u.name AS user_name, u.role AS user_role, u.is_active,
                  pa.assigned_by, assigned_by_user.name AS assigned_by_name
           FROM patient_assignments pa
           JOIN users u ON u.id = pa.user_id
           LEFT JOIN users assigned_by_user ON assigned_by_user.id = pa.assigned_by
           WHERE pa.patient_id = $1
           ORDER BY pa.revoked_at NULLS FIRST, pa.assigned_at DESC"#,
    )
    .bind(patient_uuid)
    .fetch_all(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, patient_id = %patient_uuid, "Failed to list assignments");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to list patient assignments",
        )
    })?;

    let mut items = Vec::with_capacity(rows.len());
    for row in rows {
        items.push(serde_json::json!({
            "user_id": row.try_get::<Uuid, _>("user_id").unwrap_or_else(|_| Uuid::nil()),
            "user_name": row.try_get::<String, _>("user_name").unwrap_or_default(),
            "user_role": row.try_get::<String, _>("user_role").unwrap_or_default(),
            "user_active": row.try_get::<bool, _>("is_active").unwrap_or(false),
            "assigned_by": row.try_get::<Uuid, _>("assigned_by").unwrap_or_else(|_| Uuid::nil()),
            "assigned_by_name": row.try_get::<Option<String>, _>("assigned_by_name").unwrap_or_default(),
            "assigned_at": row
                .try_get::<chrono::DateTime<chrono::Utc>, _>("assigned_at")
                .map(|value| value.to_rfc3339())
                .unwrap_or_default(),
            "revoked_at": row
                .try_get::<Option<chrono::DateTime<chrono::Utc>>, _>("revoked_at")
                .unwrap_or_default()
                .map(|value| value.to_rfc3339()),
        }));
    }

    Ok(Json(items))
}

async fn assign_patient(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(patient_uuid): Path<Uuid>,
    Json(body): Json<AssignRequest>,
) -> impl IntoResponse {
    if !can_manage_assignment(auth.role) {
        return Err(err(StatusCode::FORBIDDEN, "Insufficient permissions"));
    }

    let exists = sqlx::query_scalar!(
        r#"SELECT EXISTS(SELECT 1 FROM patients WHERE id = $1) AS "e!""#,
        patient_uuid
    )
    .fetch_one(&state.db)
    .await
    .unwrap_or(false);

    if !exists {
        return Err(err(StatusCode::NOT_FOUND, "Patient not found"));
    }

    if auth.role != Role::Ceo && !has_patient_access(&state, &auth, patient_uuid).await? {
        return Err(err(StatusCode::FORBIDDEN, "Insufficient permissions"));
    }

    let target_user = sqlx::query("SELECT id, name, role, is_active FROM users WHERE id = $1")
        .bind(body.user_id)
        .fetch_optional(&state.db)
        .await
        .map_err(|e| {
            tracing::error!(error = %e, user_id = %body.user_id, "Failed to load target user");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to validate assignment target",
            )
        })?
        .ok_or_else(|| err(StatusCode::NOT_FOUND, "User not found"))?;

    let target_role = target_user.try_get::<String, _>("role").map_err(|_| {
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to validate assignment target",
        )
    })?;
    let target_active = target_user.try_get::<bool, _>("is_active").unwrap_or(false);

    if !target_active {
        return Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Cannot assign inactive user",
        ));
    }

    if !assignment_allowed(auth.role, &target_role) {
        return Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "This role cannot assign the selected user role",
        ));
    }

    sqlx::query!(
        "INSERT INTO patient_assignments (patient_id, user_id, assigned_by)
         VALUES ($1, $2, $3)
         ON CONFLICT (patient_id, user_id) DO UPDATE SET revoked_at = NULL, assigned_by = $3, assigned_at = now()",
        patient_uuid, body.user_id, auth.user_id
    )
    .execute(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, "Failed to assign patient");
        err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to assign patient")
    })?;

    let _ = sqlx::query!(
        "INSERT INTO audit_log (user_id, action, entity_type, entity_id, context)
         VALUES ($1, 'assign_patient', 'patient', $2, $3)",
        auth.user_id,
        patient_uuid,
        serde_json::json!({ "assigned_to": body.user_id, "assigned_role": target_role })
    )
    .execute(&state.db)
    .await;

    tracing::info!(by = %auth.user_id, patient = %patient_uuid, to = %body.user_id, "Patient assigned");

    Ok(Json(serde_json::json!({"ok": true})))
}

fn err(status: StatusCode, message: &str) -> axum::response::Response {
    (status, Json(serde_json::json!({ "error": status.canonical_reason().unwrap_or("error"), "message": message }))).into_response()
}

fn can_manage_assignment(role: Role) -> bool {
    matches!(
        role,
        Role::Ceo | Role::PatientManager | Role::TeamleadInterpreter
    )
}

fn assignment_allowed(assigner_role: Role, target_role: &str) -> bool {
    match assigner_role {
        Role::Ceo => matches!(
            target_role,
            "patient_manager" | "teamlead_interpreter" | "interpreter" | "concierge"
        ),
        Role::PatientManager => {
            matches!(
                target_role,
                "teamlead_interpreter" | "interpreter" | "concierge"
            )
        }
        Role::TeamleadInterpreter => matches!(target_role, "interpreter"),
        _ => false,
    }
}

async fn has_patient_access(
    state: &AppState,
    auth: &AuthUser,
    patient_id: Uuid,
) -> Result<bool, axum::response::Response> {
    if auth.role == Role::Ceo {
        return Ok(true);
    }

    if !access::requires_patient_assignment(auth.role) {
        return Ok(true);
    }

    access::has_active_patient_assignment(&state.db, patient_id, auth.user_id)
        .await
        .map_err(|e| {
            tracing::error!(error = %e, patient_id = %patient_id, "Failed to validate patient assignment");
            err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to validate patient access")
        })
}

async fn load_patient_field_policies(
    state: &AppState,
    auth: &AuthUser,
) -> Result<HashMap<String, FieldPolicy>, axum::response::Response> {
    if matches!(auth.role, Role::Ceo | Role::PatientManager) {
        return Ok(HashMap::new());
    }

    let Some(role_name) = access::role_db_name(auth.role) else {
        return Ok(HashMap::new());
    };

    let rows = sqlx::query(
        r#"SELECT field_name, access_level, condition_type
           FROM field_access_policies
           WHERE role = $1
             AND entity_type = 'patient'"#,
    )
    .bind(role_name)
    .fetch_all(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, role = role_name, "Failed to load patient field policies");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to load access policies",
        )
    })?;

    let mut policies = HashMap::with_capacity(rows.len());
    for row in rows {
        let field_name: String = row.try_get("field_name").map_err(|_| {
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to decode access policy",
            )
        })?;
        let access_level: String = row.try_get("access_level").map_err(|_| {
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to decode access policy",
            )
        })?;
        let condition_type = row.try_get("condition_type").map_err(|_| {
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to decode access policy",
            )
        })?;

        policies.insert(
            field_name,
            FieldPolicy {
                access_level,
                condition_type,
            },
        );
    }

    Ok(policies)
}

#[derive(Debug)]
struct PatientSummaryInput {
    id: Uuid,
    patient_id: String,
    title: Option<String>,
    first_name: String,
    last_name: String,
    birth_date: chrono::NaiveDate,
    gender: String,
    nationality: Option<String>,
    residence_country: Option<String>,
    languages: Vec<String>,
    phone_primary: Option<String>,
    email: Option<String>,
    insurance_provider: Option<String>,
    insurance_type: Option<String>,
    is_active: bool,
    created_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug)]
struct PatientDetailInput {
    id: Uuid,
    patient_id: String,
    title: Option<String>,
    first_name: String,
    last_name: String,
    birth_date: chrono::NaiveDate,
    gender: String,
    nationality: Option<String>,
    residence_country: Option<String>,
    languages: Vec<String>,
    phone_primary: Option<String>,
    phone_secondary: Option<String>,
    email: Option<String>,
    address_street: Option<String>,
    address_city: Option<String>,
    address_zip: Option<String>,
    address_country: Option<String>,
    insurance_provider: Option<String>,
    insurance_number: Option<String>,
    insurance_type: Option<String>,
    emergency_contact_name: Option<String>,
    emergency_contact_phone: Option<String>,
    emergency_contact_relation: Option<String>,
    legal_status: serde_json::Value,
    notes: Option<String>,
    is_active: bool,
    created_at: chrono::DateTime<chrono::Utc>,
    updated_at: chrono::DateTime<chrono::Utc>,
}

fn build_patient_summary_json(
    auth: &AuthUser,
    policies: &HashMap<String, FieldPolicy>,
    patient: PatientSummaryInput,
) -> Value {
    let mut data = Map::new();
    data.insert("id".to_string(), Value::String(patient.id.to_string()));
    data.insert("patient_id".to_string(), Value::String(patient.patient_id));
    data.insert("gender".to_string(), Value::String(patient.gender));
    data.insert("is_active".to_string(), Value::Bool(patient.is_active));
    data.insert(
        "created_at".to_string(),
        Value::String(patient.created_at.to_rfc3339()),
    );

    insert_name_fields(
        &mut data,
        auth,
        policies,
        patient.title,
        patient.first_name,
        patient.last_name,
    );
    insert_birth_date(&mut data, auth, policies, patient.birth_date);
    insert_phone_fields(&mut data, auth, policies, patient.phone_primary, None);
    insert_email_field(&mut data, auth, policies, patient.email);
    insert_nationality_fields(
        &mut data,
        auth,
        policies,
        patient.nationality,
        patient.residence_country,
    );
    insert_languages_field(&mut data, auth, policies, patient.languages);
    insert_insurance_fields(
        &mut data,
        auth,
        policies,
        patient.insurance_provider,
        None,
        patient.insurance_type,
    );

    Value::Object(data)
}

fn build_patient_detail_json(
    auth: &AuthUser,
    policies: &HashMap<String, FieldPolicy>,
    patient: PatientDetailInput,
) -> Value {
    let mut data = build_patient_summary_json(
        auth,
        policies,
        PatientSummaryInput {
            id: patient.id,
            patient_id: patient.patient_id,
            title: patient.title.clone(),
            first_name: patient.first_name.clone(),
            last_name: patient.last_name.clone(),
            birth_date: patient.birth_date,
            gender: patient.gender.clone(),
            nationality: patient.nationality.clone(),
            residence_country: patient.residence_country.clone(),
            languages: patient.languages.clone(),
            phone_primary: patient.phone_primary.clone(),
            email: patient.email.clone(),
            insurance_provider: patient.insurance_provider.clone(),
            insurance_type: patient.insurance_type.clone(),
            is_active: patient.is_active,
            created_at: patient.created_at,
        },
    );

    if let Value::Object(ref mut map) = data {
        map.insert(
            "updated_at".to_string(),
            Value::String(patient.updated_at.to_rfc3339()),
        );

        if matches!(auth.role, Role::Ceo | Role::PatientManager) {
            insert_optional_string(map, "address_street", patient.address_street);
            insert_optional_string(map, "address_city", patient.address_city);
            insert_optional_string(map, "address_zip", patient.address_zip);
            insert_optional_string(map, "address_country", patient.address_country);
            insert_optional_string(
                map,
                "emergency_contact_name",
                patient.emergency_contact_name,
            );
            insert_optional_string(
                map,
                "emergency_contact_phone",
                patient.emergency_contact_phone,
            );
            insert_optional_string(
                map,
                "emergency_contact_relation",
                patient.emergency_contact_relation,
            );
            map.insert("legal_status".to_string(), patient.legal_status);
            insert_optional_string(map, "notes", patient.notes);
            insert_insurance_fields(
                map,
                auth,
                policies,
                patient.insurance_provider,
                patient.insurance_number,
                patient.insurance_type,
            );
            insert_phone_fields(
                map,
                auth,
                policies,
                patient.phone_primary,
                patient.phone_secondary,
            );
        }
    }

    data
}

fn insert_name_fields(
    data: &mut Map<String, Value>,
    auth: &AuthUser,
    policies: &HashMap<String, FieldPolicy>,
    title: Option<String>,
    first_name: String,
    last_name: String,
) {
    match field_access(policies, "name", auth.role == Role::Ceo) {
        Some(FieldAccess::Visible) => {
            insert_optional_string(data, "title", title);
            data.insert("first_name".to_string(), Value::String(first_name));
            data.insert("last_name".to_string(), Value::String(last_name));
        }
        Some(FieldAccess::Masked) => {
            insert_optional_string(data, "title", title);
            data.insert(
                "first_name".to_string(),
                Value::String(mask_text(&first_name)),
            );
            data.insert(
                "last_name".to_string(),
                Value::String(mask_text(&last_name)),
            );
        }
        Some(FieldAccess::Hidden) | None => {}
    }
}

fn insert_birth_date(
    data: &mut Map<String, Value>,
    auth: &AuthUser,
    policies: &HashMap<String, FieldPolicy>,
    birth_date: chrono::NaiveDate,
) {
    match field_access(policies, "birth_date", auth.role == Role::Ceo) {
        Some(FieldAccess::Visible) => {
            data.insert(
                "birth_date".to_string(),
                Value::String(birth_date.to_string()),
            );
        }
        Some(FieldAccess::Masked) => {
            let masked = format!("{}-**-**", birth_date.format("%Y"));
            data.insert("birth_date".to_string(), Value::String(masked));
        }
        Some(FieldAccess::Hidden) | None => {}
    }
}

fn insert_phone_fields(
    data: &mut Map<String, Value>,
    auth: &AuthUser,
    policies: &HashMap<String, FieldPolicy>,
    phone_primary: Option<String>,
    phone_secondary: Option<String>,
) {
    match field_access(policies, "phone", auth.role == Role::Ceo) {
        Some(FieldAccess::Visible) => {
            insert_optional_string(data, "phone_primary", phone_primary);
            insert_optional_string(data, "phone_secondary", phone_secondary);
        }
        Some(FieldAccess::Masked) => {
            if let Some(phone) = phone_primary {
                data.insert(
                    "phone_primary".to_string(),
                    Value::String(access::mask_phone(&phone)),
                );
            }
            if let Some(phone) = phone_secondary {
                data.insert(
                    "phone_secondary".to_string(),
                    Value::String(access::mask_phone(&phone)),
                );
            }
        }
        Some(FieldAccess::Hidden) | None => {}
    }
}

fn insert_email_field(
    data: &mut Map<String, Value>,
    auth: &AuthUser,
    policies: &HashMap<String, FieldPolicy>,
    email: Option<String>,
) {
    match field_access(policies, "email", auth.role == Role::Ceo) {
        Some(FieldAccess::Visible) => insert_optional_string(data, "email", email),
        Some(FieldAccess::Masked) => {
            if let Some(value) = email {
                data.insert(
                    "email".to_string(),
                    Value::String(access::mask_email(&value)),
                );
            }
        }
        Some(FieldAccess::Hidden) | None => {}
    }
}

fn insert_nationality_fields(
    data: &mut Map<String, Value>,
    auth: &AuthUser,
    policies: &HashMap<String, FieldPolicy>,
    nationality: Option<String>,
    residence_country: Option<String>,
) {
    match field_access(policies, "nationality", auth.role == Role::Ceo) {
        Some(FieldAccess::Visible) | Some(FieldAccess::Masked) => {
            insert_optional_string(data, "nationality", nationality);
            insert_optional_string(data, "residence_country", residence_country);
        }
        Some(FieldAccess::Hidden) | None => {}
    }
}

fn insert_languages_field(
    data: &mut Map<String, Value>,
    auth: &AuthUser,
    policies: &HashMap<String, FieldPolicy>,
    languages: Vec<String>,
) {
    match field_access(policies, "languages", auth.role == Role::Ceo) {
        Some(FieldAccess::Visible) | Some(FieldAccess::Masked) => {
            data.insert(
                "languages".to_string(),
                Value::Array(languages.into_iter().map(Value::String).collect()),
            );
        }
        Some(FieldAccess::Hidden) | None => {}
    }
}

fn insert_insurance_fields(
    data: &mut Map<String, Value>,
    auth: &AuthUser,
    policies: &HashMap<String, FieldPolicy>,
    insurance_provider: Option<String>,
    insurance_number: Option<String>,
    insurance_type: Option<String>,
) {
    match field_access(policies, "insurance", auth.role == Role::Ceo) {
        Some(FieldAccess::Visible) => {
            insert_optional_string(data, "insurance_provider", insurance_provider);
            insert_optional_string(data, "insurance_number", insurance_number);
            insert_optional_string(data, "insurance_type", insurance_type);
        }
        Some(FieldAccess::Masked) => {
            if let Some(provider) = insurance_provider {
                data.insert(
                    "insurance_provider".to_string(),
                    Value::String(mask_text(&provider)),
                );
            }
            if let Some(number) = insurance_number {
                data.insert(
                    "insurance_number".to_string(),
                    Value::String(mask_text(&number)),
                );
            }
            insert_optional_string(data, "insurance_type", insurance_type);
        }
        Some(FieldAccess::Hidden) | None => {}
    }
}

fn insert_optional_string(data: &mut Map<String, Value>, key: &str, value: Option<String>) {
    if let Some(value) = value {
        data.insert(key.to_string(), Value::String(value));
    }
}

#[derive(Debug, Clone, Copy)]
enum FieldAccess {
    Visible,
    Masked,
    Hidden,
}

fn field_access(
    policies: &HashMap<String, FieldPolicy>,
    field_name: &str,
    is_full_access: bool,
) -> Option<FieldAccess> {
    if is_full_access || policies.is_empty() {
        return Some(FieldAccess::Visible);
    }

    let policy = policies.get(field_name)?;

    match policy.access_level.as_str() {
        "full" => Some(FieldAccess::Visible),
        "masked" => Some(FieldAccess::Masked),
        "hidden" => Some(FieldAccess::Hidden),
        "conditional" => match policy.condition_type.as_deref() {
            Some("assigned_appointment") => Some(FieldAccess::Hidden),
            Some("freigegeben") => Some(FieldAccess::Hidden),
            Some("own_data") => Some(FieldAccess::Hidden),
            _ => Some(FieldAccess::Hidden),
        },
        _ => None,
    }
}

fn mask_text(value: &str) -> String {
    match value.chars().next() {
        Some(first) => format!("{first}***"),
        None => String::new(),
    }
}
