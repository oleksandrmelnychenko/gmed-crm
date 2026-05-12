use axum::{
    Json, Router,
    extract::{Extension, Path, Query, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
};
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::Row;
use uuid::Uuid;

use crate::audit::{self as audit_mod};
use crate::auth::middleware::AuthUser;
use crate::state::AppState;
use gmed_domain::role::Role;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/providers", get(list_providers).post(create_provider))
        .route("/providers/{provider_id}", get(get_provider))
        .route("/providers/{provider_id}/update", post(update_provider))
        .route("/providers/{provider_id}/activate", post(activate_provider))
        .route(
            "/providers/{provider_id}/deactivate",
            post(deactivate_provider),
        )
        .route("/providers/{provider_id}/delete", post(delete_provider))
        .route(
            "/providers/{provider_id}/patients",
            get(list_provider_patients),
        )
        .route(
            "/providers/{provider_id}/templates",
            get(list_provider_templates).post(create_provider_template),
        )
        .route(
            "/providers/{provider_id}/templates/{template_id}/update",
            post(update_provider_template),
        )
        .route(
            "/providers/{provider_id}/doctors",
            get(list_doctors).post(create_doctor),
        )
        .route(
            "/providers/{provider_id}/doctors/{doctor_id}",
            get(get_doctor),
        )
        .route(
            "/providers/{provider_id}/doctors/{doctor_id}/patients",
            get(list_doctor_patients),
        )
        .route(
            "/providers/{provider_id}/doctors/{doctor_id}/update",
            post(update_doctor),
        )
        .route(
            "/providers/{provider_id}/doctors/{doctor_id}/delete",
            post(delete_doctor),
        )
        .route(
            "/providers/{provider_id}/services",
            get(list_services).post(create_service),
        )
        .route(
            "/providers/{provider_id}/services/{service_id}",
            get(get_service),
        )
        .route(
            "/providers/{provider_id}/services/{service_id}/update",
            post(update_service),
        )
        .route(
            "/providers/{provider_id}/services/{service_id}/delete",
            post(delete_service),
        )
}

#[derive(Deserialize)]
struct ListProvidersQuery {
    search: Option<String>,
    provider_type: Option<String>,
    active_only: Option<bool>,
    city: Option<String>,
    country: Option<String>,
    fachbereich: Option<String>,
    doctor_name: Option<String>,
    doctor_fachbereich: Option<String>,
    service_name: Option<String>,
    has_contract: Option<bool>,
    rating_gte: Option<f64>,
}

#[derive(Deserialize)]
struct UpsertProviderRequest {
    name: String,
    provider_type: String,
    legal_name: Option<String>,
    tax_id: Option<String>,
    address_street: Option<String>,
    address_city: Option<String>,
    address_zip: Option<String>,
    address_country: Option<String>,
    phone: Option<String>,
    email: Option<String>,
    website: Option<String>,
    fachbereich: Option<String>,
    kooperationsvertrag: Option<Value>,
    notes: Option<String>,
}

#[derive(Deserialize)]
struct UpsertDoctorRequest {
    name: String,
    title: Option<String>,
    fachbereich: Option<String>,
    languages: Option<Vec<String>>,
    phone: Option<String>,
    email: Option<String>,
    license_number: Option<String>,
    licensing_country: Option<String>,
    licensing_valid_until: Option<String>,
    notes: Option<String>,
}

#[derive(Deserialize)]
struct UpsertServiceRequest {
    service_name: String,
    description: Option<String>,
    price: f64,
    currency: Option<String>,
    valid_from: Option<String>,
    valid_to: Option<String>,
}

#[derive(Deserialize, Default, Clone)]
struct UpsertProviderTemplateRequest {
    label: String,
    description: Option<String>,
    doctor_id: Option<Uuid>,
    art: Option<String>,
    category: Option<String>,
    default_auto_name: Option<String>,
    default_status: Option<String>,
    default_visibility: Option<String>,
    is_medical: Option<bool>,
    supported_languages: Option<Vec<String>>,
    body_de: Option<String>,
    body_en: Option<String>,
    body_uk: Option<String>,
    body_ru: Option<String>,
    notes: Option<String>,
    is_active: Option<bool>,
    auto_send_on_confirmed_appointment: Option<bool>,
}

async fn list_providers(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Query(query): Query<ListProvidersQuery>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[
        Role::Ceo,
        Role::PatientManager,
        Role::Concierge,
        Role::Billing,
        Role::Sales,
    ]) {
        return e;
    }

    let active_only = query.active_only.unwrap_or(true);
    let search_pattern = format!("%{}%", query.search.unwrap_or_default());
    let provider_type = normalize_optional(query.provider_type);
    let city_pattern = format!("%{}%", query.city.unwrap_or_default());
    let country_pattern = format!("%{}%", query.country.unwrap_or_default());
    let fachbereich_pattern = format!("%{}%", query.fachbereich.unwrap_or_default());
    let doctor_name_pattern = format!("%{}%", query.doctor_name.unwrap_or_default());
    let doctor_fachbereich_pattern = format!("%{}%", query.doctor_fachbereich.unwrap_or_default());
    let service_name_pattern = format!("%{}%", query.service_name.unwrap_or_default());
    let has_contract = query.has_contract;
    let rating_gte = query.rating_gte;

    if let Some(ref provider_type) = provider_type
        && !is_valid_provider_type(provider_type)
    {
        return err(StatusCode::UNPROCESSABLE_ENTITY, "Invalid provider type");
    }

    let rows = match sqlx::query(
        r#"SELECT p.id, p.name, p.provider_type, p.legal_name, p.tax_id,
                  p.address_city, p.address_country, p.fachbereich,
                  p.phone, p.email, p.is_active, p.created_at,
                  (p.kooperationsvertrag IS NOT NULL) AS has_contract,
                  (
                    SELECT COUNT(*)
                    FROM provider_doctors d
                    WHERE d.provider_id = p.id
                  ) AS doctor_count,
                  (
                    SELECT COUNT(DISTINCT a.patient_id)
                    FROM appointments a
                    WHERE a.provider_id = p.id
                  ) AS patient_count,
                  (
                    SELECT COUNT(*)
                    FROM appointments a
                    WHERE a.provider_id = p.id
                  ) AS appointment_count,
                  (
                    SELECT COUNT(*)
                    FROM service_catalog s
                    WHERE s.provider_id = p.id
                  ) AS service_count,
                  (
                    SELECT COUNT(*)
                    FROM concierge_services cs
                    WHERE cs.provider_id = p.id
                  ) AS concierge_service_count,
                  (
                    SELECT COUNT(*)
                    FROM concierge_services cs
                    WHERE cs.provider_id = p.id
                      AND cs.status IN ('planned', 'booked', 'confirmed', 'in_service')
                   ) AS open_concierge_service_count,
                  (
                    SELECT COUNT(*)
                    FROM patient_feedback_forms f
                    WHERE f.provider_id = p.id
                  ) AS rating_count,
                  (
                    SELECT AVG(f.overall_score)::double precision
                    FROM patient_feedback_forms f
                    WHERE f.provider_id = p.id
                  ) AS avg_rating,
                  NULLIF(
                    GREATEST(
                        COALESCE((
                            SELECT MAX((a.date::timestamp + COALESCE(a.time_start, TIME '00:00')) AT TIME ZONE 'UTC')
                            FROM appointments a
                            WHERE a.provider_id = p.id
                        ), to_timestamp(0)),
                        COALESCE((
                            SELECT MAX(COALESCE(ol.approved_at, ol.delivered_at, ol.created_at))
                            FROM order_leistungen ol
                            WHERE ol.provider_id = p.id
                        ), to_timestamp(0)),
                        COALESCE((
                            SELECT MAX(COALESCE(cs.starts_at, cs.completed_at, cs.updated_at, cs.created_at))
                            FROM concierge_services cs
                            WHERE cs.provider_id = p.id
                        ), to_timestamp(0))
                    ),
                    to_timestamp(0)
                  ) AS last_interaction_at
           FROM providers p
           WHERE ($1::bool = false OR p.is_active = true)
             AND ($2::text IS NULL OR p.provider_type = $2)
             AND (
                $3::text = '%%'
                OR p.name ILIKE $3
                OR COALESCE(p.legal_name, '') ILIKE $3
                OR COALESCE(p.tax_id, '') ILIKE $3
                OR COALESCE(p.address_city, '') ILIKE $3
                OR COALESCE(p.fachbereich, '') ILIKE $3
                 OR EXISTS (
                     SELECT 1
                     FROM provider_doctors d
                     WHERE d.provider_id = p.id
                       AND (
                         d.name ILIKE $3
                         OR COALESCE(d.fachbereich, '') ILIKE $3
                       )
                 )
                 OR EXISTS (
                     SELECT 1
                     FROM concierge_services cs
                     WHERE cs.provider_id = p.id
                       AND (
                         cs.title ILIKE $3
                         OR cs.service_kind ILIKE $3
                         OR COALESCE(cs.vendor_name, '') ILIKE $3
                         OR COALESCE(cs.vendor_contact, '') ILIKE $3
                       )
                 )
             )
             AND ($4::text = '%%' OR COALESCE(p.address_city, '') ILIKE $4)
             AND ($5::text = '%%' OR COALESCE(p.address_country, '') ILIKE $5)
             AND ($6::text = '%%' OR COALESCE(p.fachbereich, '') ILIKE $6)
             AND (
                $7::text = '%%'
                OR EXISTS (
                    SELECT 1
                    FROM provider_doctors d
                    WHERE d.provider_id = p.id
                      AND d.name ILIKE $7
                )
             )
             AND (
                $8::text = '%%'
                OR EXISTS (
                    SELECT 1
                    FROM provider_doctors d
                    WHERE d.provider_id = p.id
                      AND COALESCE(d.fachbereich, '') ILIKE $8
                )
             )
             AND (
                $9::text = '%%'
                 OR EXISTS (
                     SELECT 1
                     FROM service_catalog s
                     WHERE s.provider_id = p.id
                       AND (
                         s.service_name ILIKE $9
                         OR COALESCE(s.description, '') ILIKE $9
                       )
                 )
                 OR EXISTS (
                     SELECT 1
                     FROM concierge_services cs
                     WHERE cs.provider_id = p.id
                       AND (
                         cs.title ILIKE $9
                         OR cs.service_kind ILIKE $9
                         OR COALESCE(cs.vendor_name, '') ILIKE $9
                       )
                 )
              )
              AND (
                 $10::bool IS NULL
                 OR ($10 = true AND p.kooperationsvertrag IS NOT NULL)
                 OR ($10 = false AND p.kooperationsvertrag IS NULL)
              )
              AND (
                 $11::double precision IS NULL
                 OR COALESCE((
                     SELECT AVG(f.overall_score)::double precision
                     FROM patient_feedback_forms f
                     WHERE f.provider_id = p.id
                 ), 0) >= $11
              )
            ORDER BY p.name
            LIMIT 200"#,
    )
    .bind(active_only)
    .bind(provider_type)
    .bind(search_pattern)
    .bind(city_pattern)
    .bind(country_pattern)
    .bind(fachbereich_pattern)
    .bind(doctor_name_pattern)
    .bind(doctor_fachbereich_pattern)
    .bind(service_name_pattern)
    .bind(has_contract)
    .bind(rating_gte)
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => rows,
        Err(e) => {
            tracing::error!(error = %e, "Failed to list providers");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to list providers",
            );
        }
    };

    let mut providers = Vec::with_capacity(rows.len());
    for row in rows {
        let id: Uuid = match row.try_get("id") {
            Ok(value) => value,
            Err(_) => {
                return err(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Failed to decode provider",
                );
            }
        };
        let name: String = match row.try_get("name") {
            Ok(value) => value,
            Err(_) => {
                return err(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Failed to decode provider",
                );
            }
        };
        let provider_type: String = match row.try_get("provider_type") {
            Ok(value) => value,
            Err(_) => {
                return err(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Failed to decode provider",
                );
            }
        };
        let doctor_count: i64 = match row.try_get("doctor_count") {
            Ok(value) => value,
            Err(_) => {
                return err(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Failed to decode provider",
                );
            }
        };

        providers.push(json!({
            "id": id,
            "name": name,
            "provider_type": provider_type,
            "legal_name": row.try_get::<Option<String>, _>("legal_name").unwrap_or_default(),
            "tax_id": row.try_get::<Option<String>, _>("tax_id").unwrap_or_default(),
            "address_city": row.try_get::<Option<String>, _>("address_city").unwrap_or_default(),
            "address_country": row.try_get::<Option<String>, _>("address_country").unwrap_or_default(),
            "fachbereich": row.try_get::<Option<String>, _>("fachbereich").unwrap_or_default(),
            "phone": row.try_get::<Option<String>, _>("phone").unwrap_or_default(),
            "email": row.try_get::<Option<String>, _>("email").unwrap_or_default(),
            "is_active": row.try_get::<bool, _>("is_active").unwrap_or(true),
            "has_contract": row.try_get::<bool, _>("has_contract").unwrap_or(false),
            "created_at": row.try_get::<chrono::DateTime<chrono::Utc>, _>("created_at").map(|v| v.to_rfc3339()).unwrap_or_default(),
            "doctor_count": doctor_count,
            "patient_count": row.try_get::<i64, _>("patient_count").unwrap_or_default(),
            "appointment_count": row.try_get::<i64, _>("appointment_count").unwrap_or_default(),
            "service_count": row.try_get::<i64, _>("service_count").unwrap_or_default(),
            "concierge_service_count": row.try_get::<i64, _>("concierge_service_count").unwrap_or_default(),
            "open_concierge_service_count": row.try_get::<i64, _>("open_concierge_service_count").unwrap_or_default(),
            "rating_count": row.try_get::<i64, _>("rating_count").unwrap_or_default(),
            "avg_rating": row.try_get::<Option<f64>, _>("avg_rating").unwrap_or_default(),
            "last_interaction_at": row.try_get::<Option<chrono::DateTime<chrono::Utc>>, _>("last_interaction_at").unwrap_or_default().map(|v| v.to_rfc3339()),
        }));
    }

    Json(providers).into_response()
}

async fn create_provider(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Json(body): Json<UpsertProviderRequest>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::Ceo, Role::PatientManager]) {
        return e;
    }

    let provider = match normalize_provider_payload(body) {
        Ok(payload) => payload,
        Err(message) => return err(StatusCode::UNPROCESSABLE_ENTITY, message),
    };

    let row = match sqlx::query(
        r#"INSERT INTO providers (
                name, provider_type, legal_name, tax_id,
                address_street, address_city, address_zip, address_country,
                phone, email, website, fachbereich, kooperationsvertrag, notes
           ) VALUES (
                $1, $2, $3, $4,
                $5, $6, $7, $8,
                $9, $10, $11, $12, $13, $14
           )
           RETURNING id, created_at"#,
    )
    .bind(provider.name)
    .bind(provider.provider_type)
    .bind(provider.legal_name)
    .bind(provider.tax_id)
    .bind(provider.address_street)
    .bind(provider.address_city)
    .bind(provider.address_zip)
    .bind(provider.address_country)
    .bind(provider.phone)
    .bind(provider.email)
    .bind(provider.website)
    .bind(provider.fachbereich)
    .bind(provider.kooperationsvertrag)
    .bind(provider.notes)
    .fetch_one(&state.db)
    .await
    {
        Ok(row) => row,
        Err(e) => {
            tracing::error!(error = %e, "Failed to create provider");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to create provider",
            );
        }
    };

    let provider_id: Uuid = match row.try_get("id") {
        Ok(value) => value,
        Err(_) => {
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to decode provider",
            );
        }
    };

    let _ = audit(
        &state,
        auth.user_id,
        "create_provider",
        "provider",
        Some(provider_id),
        Some(json!({ "provider_id": provider_id })),
    )
    .await;
    crate::realtime::publish_provider_event(
        &state,
        Some(auth.user_id),
        "provider.created",
        provider_id,
        json!({ "provider_id": provider_id }),
    )
    .await;

    (
        StatusCode::CREATED,
        Json(json!({
            "id": provider_id,
            "created_at": row
                .try_get::<chrono::DateTime<chrono::Utc>, _>("created_at")
                .map(|v| v.to_rfc3339())
                .unwrap_or_default(),
        })),
    )
        .into_response()
}

async fn get_provider(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(provider_id): Path<Uuid>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[
        Role::Ceo,
        Role::PatientManager,
        Role::Concierge,
        Role::Billing,
        Role::Sales,
    ]) {
        return e;
    }

    let provider = match sqlx::query(
        r#"SELECT id, name, provider_type, legal_name, tax_id,
                  address_street, address_city, address_zip,
                  address_country, phone, email, website, fachbereich, kooperationsvertrag, notes,
                  is_active, created_at, updated_at
           FROM providers
           WHERE id = $1"#,
    )
    .bind(provider_id)
    .fetch_optional(&state.db)
    .await
    {
        Ok(Some(row)) => row,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Provider not found"),
        Err(e) => {
            tracing::error!(error = %e, provider_id = %provider_id, "Failed to get provider");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to get provider");
        }
    };

    let (doctors, services, linked_patients, interactions, templates) = tokio::join!(
        load_doctors_json(&state, provider_id),
        load_services_json(&state, provider_id),
        load_provider_patients_json(&state, provider_id, None),
        load_provider_interactions_json(&state, provider_id, None),
        load_provider_templates_json(&state, provider_id),
    );

    let doctors = match doctors {
        Ok(items) => items,
        Err(resp) => return resp,
    };
    let services = match services {
        Ok(items) => items,
        Err(resp) => return resp,
    };
    let linked_patients = match linked_patients {
        Ok(items) => items,
        Err(resp) => return resp,
    };
    let interactions = match interactions {
        Ok(items) => items,
        Err(resp) => return resp,
    };
    let templates = match templates {
        Ok(items) => items,
        Err(resp) => return resp,
    };

    Json(json!({
        "id": provider.try_get::<Uuid, _>("id").unwrap_or(provider_id),
        "name": provider.try_get::<String, _>("name").unwrap_or_default(),
        "provider_type": provider.try_get::<String, _>("provider_type").unwrap_or_default(),
        "legal_name": provider.try_get::<Option<String>, _>("legal_name").unwrap_or_default(),
        "tax_id": provider.try_get::<Option<String>, _>("tax_id").unwrap_or_default(),
        "address_street": provider.try_get::<Option<String>, _>("address_street").unwrap_or_default(),
        "address_city": provider.try_get::<Option<String>, _>("address_city").unwrap_or_default(),
        "address_zip": provider.try_get::<Option<String>, _>("address_zip").unwrap_or_default(),
        "address_country": provider.try_get::<Option<String>, _>("address_country").unwrap_or_default(),
        "phone": provider.try_get::<Option<String>, _>("phone").unwrap_or_default(),
        "email": provider.try_get::<Option<String>, _>("email").unwrap_or_default(),
        "website": provider.try_get::<Option<String>, _>("website").unwrap_or_default(),
        "fachbereich": provider.try_get::<Option<String>, _>("fachbereich").unwrap_or_default(),
        "kooperationsvertrag": provider.try_get::<Option<Value>, _>("kooperationsvertrag").unwrap_or_default(),
        "notes": provider.try_get::<Option<String>, _>("notes").unwrap_or_default(),
        "is_active": provider.try_get::<bool, _>("is_active").unwrap_or(true),
        "created_at": provider.try_get::<chrono::DateTime<chrono::Utc>, _>("created_at").map(|v| v.to_rfc3339()).unwrap_or_default(),
        "updated_at": provider.try_get::<chrono::DateTime<chrono::Utc>, _>("updated_at").map(|v| v.to_rfc3339()).unwrap_or_default(),
        "doctors": doctors,
        "services": services,
        "linked_patients": linked_patients,
        "interactions": interactions,
        "templates": templates,
    }))
    .into_response()
}

async fn update_provider(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(provider_id): Path<Uuid>,
    Json(body): Json<UpsertProviderRequest>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::Ceo, Role::PatientManager]) {
        return e;
    }

    let provider = match normalize_provider_payload(body) {
        Ok(payload) => payload,
        Err(message) => return err(StatusCode::UNPROCESSABLE_ENTITY, message),
    };

    let row = match sqlx::query(
        r#"UPDATE providers
           SET name = $2,
               provider_type = $3,
               legal_name = $4,
               tax_id = $5,
               address_street = $6,
               address_city = $7,
               address_zip = $8,
               address_country = $9,
               phone = $10,
               email = $11,
               website = $12,
               fachbereich = $13,
               kooperationsvertrag = $14,
               notes = $15,
               updated_at = now()
           WHERE id = $1
           RETURNING id"#,
    )
    .bind(provider_id)
    .bind(provider.name)
    .bind(provider.provider_type)
    .bind(provider.legal_name)
    .bind(provider.tax_id)
    .bind(provider.address_street)
    .bind(provider.address_city)
    .bind(provider.address_zip)
    .bind(provider.address_country)
    .bind(provider.phone)
    .bind(provider.email)
    .bind(provider.website)
    .bind(provider.fachbereich)
    .bind(provider.kooperationsvertrag)
    .bind(provider.notes)
    .fetch_optional(&state.db)
    .await
    {
        Ok(Some(row)) => row,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Provider not found"),
        Err(e) => {
            tracing::error!(error = %e, provider_id = %provider_id, "Failed to update provider");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to update provider",
            );
        }
    };

    let updated_id: Uuid = match row.try_get("id") {
        Ok(value) => value,
        Err(_) => {
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to decode provider",
            );
        }
    };

    let _ = audit(
        &state,
        auth.user_id,
        "update_provider",
        "provider",
        Some(updated_id),
        Some(json!({ "provider_id": updated_id })),
    )
    .await;
    crate::realtime::publish_provider_event(
        &state,
        Some(auth.user_id),
        "provider.updated",
        updated_id,
        json!({ "provider_id": updated_id }),
    )
    .await;

    Json(json!({ "ok": true })).into_response()
}

async fn activate_provider(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(provider_id): Path<Uuid>,
) -> axum::response::Response {
    toggle_provider_active(state, auth, provider_id, true).await
}

async fn deactivate_provider(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(provider_id): Path<Uuid>,
) -> axum::response::Response {
    toggle_provider_active(state, auth, provider_id, false).await
}

async fn delete_provider(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(provider_id): Path<Uuid>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::Ceo, Role::PatientManager]) {
        return e;
    }

    match sqlx::query("DELETE FROM providers WHERE id = $1")
        .bind(provider_id)
        .execute(&state.db)
        .await
    {
        Ok(result) if result.rows_affected() > 0 => {}
        Ok(_) => return err(StatusCode::NOT_FOUND, "Provider not found"),
        Err(sqlx::Error::Database(db_err)) if db_err.code().as_deref() == Some("23503") => {
            return err(
                StatusCode::CONFLICT,
                "Provider is referenced by other records and cannot be deleted",
            );
        }
        Err(e) => {
            tracing::error!(error = %e, provider_id = %provider_id, "Failed to delete provider");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to delete provider",
            );
        }
    }

    let _ = audit(
        &state,
        auth.user_id,
        "delete_provider",
        "provider",
        Some(provider_id),
        Some(json!({ "provider_id": provider_id })),
    )
    .await;
    crate::realtime::publish_provider_event(
        &state,
        Some(auth.user_id),
        "provider.deleted",
        provider_id,
        json!({ "provider_id": provider_id }),
    )
    .await;

    StatusCode::NO_CONTENT.into_response()
}

async fn list_provider_patients(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(provider_id): Path<Uuid>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[
        Role::Ceo,
        Role::PatientManager,
        Role::Concierge,
        Role::Billing,
        Role::Sales,
    ]) {
        return e;
    }

    if let Err(resp) = ensure_provider_exists(&state, provider_id).await {
        return resp;
    }

    match load_provider_patients_json(&state, provider_id, None).await {
        Ok(items) => Json(items).into_response(),
        Err(resp) => resp,
    }
}

async fn list_provider_templates(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(provider_id): Path<Uuid>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[
        Role::Ceo,
        Role::PatientManager,
        Role::Concierge,
        Role::Billing,
        Role::Sales,
    ]) {
        return e;
    }

    if let Err(resp) = ensure_provider_exists(&state, provider_id).await {
        return resp;
    }

    match load_provider_templates_json(&state, provider_id).await {
        Ok(items) => Json(items).into_response(),
        Err(resp) => resp,
    }
}

async fn create_provider_template(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(provider_id): Path<Uuid>,
    Json(body): Json<UpsertProviderTemplateRequest>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::Ceo, Role::PatientManager]) {
        return e;
    }

    if let Err(resp) = ensure_provider_exists(&state, provider_id).await {
        return resp;
    }

    let payload = match normalize_provider_template_payload(body) {
        Ok(value) => value,
        Err(message) => return err(StatusCode::UNPROCESSABLE_ENTITY, message),
    };

    if let Some(doctor_id) = payload.doctor_id
        && let Err(resp) = ensure_doctor_belongs_to_provider(&state, provider_id, doctor_id).await
    {
        return resp;
    }

    let template_id = Uuid::new_v4();
    let row = match sqlx::query(
        r#"INSERT INTO provider_templates (
                id, provider_id, doctor_id, label, description, art, category,
                default_auto_name, default_status, default_visibility, is_medical,
                supported_languages, body_de, body_en, body_uk, body_ru,
                notes, is_active, auto_send_on_confirmed_appointment, created_by, updated_by
           ) VALUES (
                $1, $2, $3, $4, $5, $6, $7,
                $8, $9, $10, $11,
                $12, $13, $14, $15, $16,
                $17, $18, $19, $20, $21
           )
           RETURNING created_at"#,
    )
    .bind(template_id)
    .bind(provider_id)
    .bind(payload.doctor_id)
    .bind(&payload.label)
    .bind(&payload.description)
    .bind(&payload.art)
    .bind(&payload.category)
    .bind(&payload.default_auto_name)
    .bind(&payload.default_status)
    .bind(&payload.default_visibility)
    .bind(payload.is_medical)
    .bind(&payload.supported_languages)
    .bind(&payload.body_de)
    .bind(&payload.body_en)
    .bind(&payload.body_uk)
    .bind(&payload.body_ru)
    .bind(&payload.notes)
    .bind(payload.is_active)
    .bind(payload.auto_send_on_confirmed_appointment)
    .bind(auth.user_id)
    .bind(auth.user_id)
    .fetch_one(&state.db)
    .await
    {
        Ok(row) => row,
        Err(e) => {
            tracing::error!(error = %e, provider_id = %provider_id, "Failed to create provider template");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to create provider template",
            );
        }
    };

    let _ = audit(
        &state,
        auth.user_id,
        "create_provider_template",
        "provider_template",
        Some(template_id),
        Some(json!({ "provider_id": provider_id, "template_id": template_id })),
    )
    .await;
    crate::realtime::publish_provider_event(
        &state,
        Some(auth.user_id),
        "provider.template_created",
        provider_id,
        json!({ "provider_id": provider_id, "template_id": template_id }),
    )
    .await;

    (
        StatusCode::CREATED,
        Json(json!({
            "id": template_id,
            "created_at": row
                .try_get::<chrono::DateTime<chrono::Utc>, _>("created_at")
                .map(|value| value.to_rfc3339())
                .unwrap_or_default(),
        })),
    )
        .into_response()
}

async fn update_provider_template(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path((provider_id, template_id)): Path<(Uuid, Uuid)>,
    Json(body): Json<UpsertProviderTemplateRequest>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::Ceo, Role::PatientManager]) {
        return e;
    }

    let payload = match normalize_provider_template_payload(body) {
        Ok(value) => value,
        Err(message) => return err(StatusCode::UNPROCESSABLE_ENTITY, message),
    };

    if let Some(doctor_id) = payload.doctor_id
        && let Err(resp) = ensure_doctor_belongs_to_provider(&state, provider_id, doctor_id).await
    {
        return resp;
    }

    match sqlx::query(
        r#"UPDATE provider_templates
           SET doctor_id = $3,
               label = $4,
               description = $5,
               art = $6,
               category = $7,
               default_auto_name = $8,
               default_status = $9,
               default_visibility = $10,
               is_medical = $11,
               supported_languages = $12,
               body_de = $13,
               body_en = $14,
               body_uk = $15,
               body_ru = $16,
               notes = $17,
               is_active = $18,
               auto_send_on_confirmed_appointment = $19,
               updated_by = $20,
               updated_at = now()
           WHERE provider_id = $1
             AND id = $2"#,
    )
    .bind(provider_id)
    .bind(template_id)
    .bind(payload.doctor_id)
    .bind(&payload.label)
    .bind(&payload.description)
    .bind(&payload.art)
    .bind(&payload.category)
    .bind(&payload.default_auto_name)
    .bind(&payload.default_status)
    .bind(&payload.default_visibility)
    .bind(payload.is_medical)
    .bind(&payload.supported_languages)
    .bind(&payload.body_de)
    .bind(&payload.body_en)
    .bind(&payload.body_uk)
    .bind(&payload.body_ru)
    .bind(&payload.notes)
    .bind(payload.is_active)
    .bind(payload.auto_send_on_confirmed_appointment)
    .bind(auth.user_id)
    .execute(&state.db)
    .await
    {
        Ok(result) if result.rows_affected() > 0 => {}
        Ok(_) => return err(StatusCode::NOT_FOUND, "Provider template not found"),
        Err(e) => {
            tracing::error!(error = %e, provider_id = %provider_id, template_id = %template_id, "Failed to update provider template");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to update provider template",
            );
        }
    }

    let _ = audit(
        &state,
        auth.user_id,
        "update_provider_template",
        "provider_template",
        Some(template_id),
        Some(json!({ "provider_id": provider_id, "template_id": template_id })),
    )
    .await;
    crate::realtime::publish_provider_event(
        &state,
        Some(auth.user_id),
        "provider.template_updated",
        provider_id,
        json!({ "provider_id": provider_id, "template_id": template_id }),
    )
    .await;

    Json(json!({ "ok": true })).into_response()
}

async fn list_doctor_patients(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path((provider_id, doctor_id)): Path<(Uuid, Uuid)>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[
        Role::Ceo,
        Role::PatientManager,
        Role::Concierge,
        Role::Billing,
        Role::Sales,
    ]) {
        return e;
    }

    if let Err(resp) = ensure_doctor_belongs_to_provider(&state, provider_id, doctor_id).await {
        return resp;
    }

    match load_provider_patients_json(&state, provider_id, Some(doctor_id)).await {
        Ok(items) => Json(items).into_response(),
        Err(resp) => resp,
    }
}

async fn list_doctors(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(provider_id): Path<Uuid>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[
        Role::Ceo,
        Role::PatientManager,
        Role::Concierge,
        Role::Billing,
        Role::Sales,
    ]) {
        return e;
    }

    if let Err(resp) = ensure_provider_exists(&state, provider_id).await {
        return resp;
    }

    match load_doctors_json(&state, provider_id).await {
        Ok(doctors) => Json(doctors).into_response(),
        Err(resp) => resp,
    }
}

async fn get_doctor(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path((provider_id, doctor_id)): Path<(Uuid, Uuid)>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[
        Role::Ceo,
        Role::PatientManager,
        Role::Concierge,
        Role::Billing,
        Role::Sales,
    ]) {
        return e;
    }

    match sqlx::query(
        r#"SELECT d.id, d.provider_id, d.name, d.title, d.fachbereich, d.languages,
                  d.phone, d.email, d.license_number, d.licensing_country,
                  d.licensing_valid_until, d.notes, d.created_at,
                  (
                    SELECT COUNT(DISTINCT a.patient_id)
                    FROM appointments a
                    WHERE a.doctor_id = d.id
                  ) AS patient_count,
                  (
                    SELECT COUNT(*)
                    FROM appointments a
                    WHERE a.doctor_id = d.id
                  ) AS appointment_count
           FROM provider_doctors d
           WHERE d.provider_id = $1 AND d.id = $2"#,
    )
    .bind(provider_id)
    .bind(doctor_id)
    .fetch_optional(&state.db)
    .await
    {
        Ok(Some(row)) => {
            let linked_patients =
                match load_provider_patients_json(&state, provider_id, Some(doctor_id)).await {
                    Ok(items) => items,
                    Err(resp) => return resp,
                };
            let interactions =
                match load_provider_interactions_json(&state, provider_id, Some(doctor_id)).await {
                    Ok(items) => items,
                    Err(resp) => return resp,
                };

            Json(json!({
                "id": row.try_get::<Uuid, _>("id").unwrap_or(doctor_id),
                "provider_id": row.try_get::<Uuid, _>("provider_id").unwrap_or(provider_id),
                "name": row.try_get::<String, _>("name").unwrap_or_default(),
                "title": row.try_get::<Option<String>, _>("title").unwrap_or_default(),
                "fachbereich": row.try_get::<Option<String>, _>("fachbereich").unwrap_or_default(),
                "languages": row.try_get::<Vec<String>, _>("languages").unwrap_or_default(),
                "phone": row.try_get::<Option<String>, _>("phone").unwrap_or_default(),
                "email": row.try_get::<Option<String>, _>("email").unwrap_or_default(),
                "license_number": row.try_get::<Option<String>, _>("license_number").unwrap_or_default(),
                "licensing_country": row.try_get::<Option<String>, _>("licensing_country").unwrap_or_default(),
                "licensing_valid_until": row.try_get::<Option<chrono::NaiveDate>, _>("licensing_valid_until").unwrap_or_default().map(|v| v.to_string()),
                "notes": row.try_get::<Option<String>, _>("notes").unwrap_or_default(),
                "patient_count": row.try_get::<i64, _>("patient_count").unwrap_or_default(),
                "appointment_count": row.try_get::<i64, _>("appointment_count").unwrap_or_default(),
                "created_at": row.try_get::<chrono::DateTime<chrono::Utc>, _>("created_at").map(|v| v.to_rfc3339()).unwrap_or_default(),
                "linked_patients": linked_patients,
                "interactions": interactions,
            }))
            .into_response()
        }
        Ok(None) => err(StatusCode::NOT_FOUND, "Doctor not found"),
        Err(e) => {
            tracing::error!(error = %e, provider_id = %provider_id, doctor_id = %doctor_id, "Failed to get doctor");
            err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to get doctor")
        }
    }
}

async fn create_doctor(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(provider_id): Path<Uuid>,
    Json(body): Json<UpsertDoctorRequest>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::Ceo, Role::PatientManager]) {
        return e;
    }

    if let Err(resp) = ensure_provider_exists(&state, provider_id).await {
        return resp;
    }

    let doctor = match normalize_doctor_payload(body) {
        Ok(payload) => payload,
        Err(message) => return err(StatusCode::UNPROCESSABLE_ENTITY, message),
    };

    let row = match sqlx::query(
        r#"INSERT INTO provider_doctors (
                provider_id, name, title, fachbereich, languages,
                phone, email, license_number, licensing_country, licensing_valid_until, notes
           ) VALUES (
                $1, $2, $3, $4, $5,
                $6, $7, $8, $9, $10, $11
           )
           RETURNING id, created_at"#,
    )
    .bind(provider_id)
    .bind(doctor.name)
    .bind(doctor.title)
    .bind(doctor.fachbereich)
    .bind(doctor.languages)
    .bind(doctor.phone)
    .bind(doctor.email)
    .bind(doctor.license_number)
    .bind(doctor.licensing_country)
    .bind(doctor.licensing_valid_until)
    .bind(doctor.notes)
    .fetch_one(&state.db)
    .await
    {
        Ok(row) => row,
        Err(e) => {
            tracing::error!(error = %e, provider_id = %provider_id, "Failed to create doctor");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to create doctor");
        }
    };

    let doctor_id: Uuid = match row.try_get("id") {
        Ok(value) => value,
        Err(_) => return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to decode doctor"),
    };

    let _ = audit(
        &state,
        auth.user_id,
        "create_provider_doctor",
        "provider_doctor",
        Some(doctor_id),
        Some(json!({ "provider_id": provider_id, "doctor_id": doctor_id })),
    )
    .await;
    crate::realtime::publish_provider_event(
        &state,
        Some(auth.user_id),
        "provider.doctor_created",
        provider_id,
        json!({ "provider_id": provider_id, "doctor_id": doctor_id }),
    )
    .await;

    (
        StatusCode::CREATED,
        Json(json!({
            "id": doctor_id,
            "created_at": row
                .try_get::<chrono::DateTime<chrono::Utc>, _>("created_at")
                .map(|v| v.to_rfc3339())
                .unwrap_or_default(),
        })),
    )
        .into_response()
}

async fn update_doctor(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path((provider_id, doctor_id)): Path<(Uuid, Uuid)>,
    Json(body): Json<UpsertDoctorRequest>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::Ceo, Role::PatientManager]) {
        return e;
    }

    let doctor = match normalize_doctor_payload(body) {
        Ok(payload) => payload,
        Err(message) => return err(StatusCode::UNPROCESSABLE_ENTITY, message),
    };

    match sqlx::query(
        r#"UPDATE provider_doctors
           SET name = $3,
               title = $4,
               fachbereich = $5,
               languages = $6,
               phone = $7,
               email = $8,
               license_number = $9,
               licensing_country = $10,
               licensing_valid_until = $11,
               notes = $12
           WHERE provider_id = $1 AND id = $2"#,
    )
    .bind(provider_id)
    .bind(doctor_id)
    .bind(doctor.name)
    .bind(doctor.title)
    .bind(doctor.fachbereich)
    .bind(doctor.languages)
    .bind(doctor.phone)
    .bind(doctor.email)
    .bind(doctor.license_number)
    .bind(doctor.licensing_country)
    .bind(doctor.licensing_valid_until)
    .bind(doctor.notes)
    .execute(&state.db)
    .await
    {
        Ok(result) if result.rows_affected() > 0 => {}
        Ok(_) => return err(StatusCode::NOT_FOUND, "Doctor not found"),
        Err(e) => {
            tracing::error!(error = %e, provider_id = %provider_id, doctor_id = %doctor_id, "Failed to update doctor");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to update doctor");
        }
    }

    let _ = audit(
        &state,
        auth.user_id,
        "update_provider_doctor",
        "provider_doctor",
        Some(doctor_id),
        Some(json!({ "provider_id": provider_id, "doctor_id": doctor_id })),
    )
    .await;
    crate::realtime::publish_provider_event(
        &state,
        Some(auth.user_id),
        "provider.doctor_updated",
        provider_id,
        json!({ "provider_id": provider_id, "doctor_id": doctor_id }),
    )
    .await;

    Json(json!({ "ok": true })).into_response()
}

async fn delete_doctor(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path((provider_id, doctor_id)): Path<(Uuid, Uuid)>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::Ceo, Role::PatientManager]) {
        return e;
    }

    match sqlx::query("DELETE FROM provider_doctors WHERE provider_id = $1 AND id = $2")
        .bind(provider_id)
        .bind(doctor_id)
        .execute(&state.db)
        .await
    {
        Ok(result) if result.rows_affected() > 0 => {}
        Ok(_) => return err(StatusCode::NOT_FOUND, "Doctor not found"),
        Err(e) => {
            tracing::error!(error = %e, provider_id = %provider_id, doctor_id = %doctor_id, "Failed to delete doctor");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to delete doctor");
        }
    }

    let _ = audit(
        &state,
        auth.user_id,
        "delete_provider_doctor",
        "provider_doctor",
        Some(doctor_id),
        Some(json!({ "provider_id": provider_id, "doctor_id": doctor_id })),
    )
    .await;
    crate::realtime::publish_provider_event(
        &state,
        Some(auth.user_id),
        "provider.doctor_deleted",
        provider_id,
        json!({ "provider_id": provider_id, "doctor_id": doctor_id }),
    )
    .await;

    StatusCode::NO_CONTENT.into_response()
}

async fn list_services(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(provider_id): Path<Uuid>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[
        Role::Ceo,
        Role::PatientManager,
        Role::Concierge,
        Role::Billing,
        Role::Sales,
    ]) {
        return e;
    }

    if let Err(resp) = ensure_provider_exists(&state, provider_id).await {
        return resp;
    }

    match load_services_json(&state, provider_id).await {
        Ok(services) => Json(services).into_response(),
        Err(resp) => resp,
    }
}

async fn get_service(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path((provider_id, service_id)): Path<(Uuid, Uuid)>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[
        Role::Ceo,
        Role::PatientManager,
        Role::Concierge,
        Role::Billing,
        Role::Sales,
    ]) {
        return e;
    }

    match sqlx::query(
        r#"SELECT id, provider_id, service_name, description, price, currency,
                  valid_from, valid_to, created_at
           FROM service_catalog
           WHERE provider_id = $1 AND id = $2"#,
    )
    .bind(provider_id)
    .bind(service_id)
    .fetch_optional(&state.db)
    .await
    {
        Ok(Some(row)) => Json(json!({
            "id": row.try_get::<Uuid, _>("id").unwrap_or(service_id),
            "provider_id": row.try_get::<Uuid, _>("provider_id").unwrap_or(provider_id),
            "service_name": row.try_get::<String, _>("service_name").unwrap_or_default(),
            "description": row.try_get::<Option<String>, _>("description").unwrap_or_default(),
            "price": row.try_get::<rust_decimal::Decimal, _>("price").unwrap_or(rust_decimal::Decimal::ZERO),
            "currency": row.try_get::<String, _>("currency").unwrap_or_else(|_| "EUR".to_string()),
            "valid_from": row.try_get::<chrono::NaiveDate, _>("valid_from").map(|v| v.to_string()).unwrap_or_default(),
            "valid_to": row.try_get::<Option<chrono::NaiveDate>, _>("valid_to").unwrap_or_default().map(|v| v.to_string()),
            "created_at": row.try_get::<chrono::DateTime<chrono::Utc>, _>("created_at").map(|v| v.to_rfc3339()).unwrap_or_default(),
        }))
        .into_response(),
        Ok(None) => err(StatusCode::NOT_FOUND, "Service not found"),
        Err(e) => {
            tracing::error!(error = %e, provider_id = %provider_id, service_id = %service_id, "Failed to get service");
            err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to get service")
        }
    }
}

async fn create_service(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(provider_id): Path<Uuid>,
    Json(body): Json<UpsertServiceRequest>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::Ceo, Role::PatientManager]) {
        return e;
    }

    if let Err(resp) = ensure_provider_exists(&state, provider_id).await {
        return resp;
    }

    let service = match normalize_service_payload(body) {
        Ok(payload) => payload,
        Err(message) => return err(StatusCode::UNPROCESSABLE_ENTITY, message),
    };

    let row = match sqlx::query(
        r#"INSERT INTO service_catalog (
                provider_id, service_name, description, price, currency, valid_from, valid_to
           ) VALUES (
                $1, $2, $3, $4, $5, $6, $7
           )
           RETURNING id, created_at"#,
    )
    .bind(provider_id)
    .bind(service.service_name)
    .bind(service.description)
    .bind(service.price)
    .bind(service.currency)
    .bind(service.valid_from)
    .bind(service.valid_to)
    .fetch_one(&state.db)
    .await
    {
        Ok(row) => row,
        Err(e) => {
            tracing::error!(error = %e, provider_id = %provider_id, "Failed to create service");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to create service",
            );
        }
    };

    let service_id: Uuid = match row.try_get("id") {
        Ok(value) => value,
        Err(_) => {
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to decode service",
            );
        }
    };

    let _ = audit(
        &state,
        auth.user_id,
        "create_provider_service",
        "provider_service",
        Some(service_id),
        Some(json!({ "provider_id": provider_id, "service_id": service_id })),
    )
    .await;
    crate::realtime::publish_provider_event(
        &state,
        Some(auth.user_id),
        "provider.service_created",
        provider_id,
        json!({ "provider_id": provider_id, "service_id": service_id }),
    )
    .await;

    (
        StatusCode::CREATED,
        Json(json!({
            "id": service_id,
            "created_at": row
                .try_get::<chrono::DateTime<chrono::Utc>, _>("created_at")
                .map(|v| v.to_rfc3339())
                .unwrap_or_default(),
        })),
    )
        .into_response()
}

async fn update_service(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path((provider_id, service_id)): Path<(Uuid, Uuid)>,
    Json(body): Json<UpsertServiceRequest>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::Ceo, Role::PatientManager]) {
        return e;
    }

    let service = match normalize_service_payload(body) {
        Ok(payload) => payload,
        Err(message) => return err(StatusCode::UNPROCESSABLE_ENTITY, message),
    };

    match sqlx::query(
        r#"UPDATE service_catalog
           SET service_name = $3,
               description = $4,
               price = $5,
               currency = $6,
               valid_from = $7,
               valid_to = $8
           WHERE provider_id = $1 AND id = $2"#,
    )
    .bind(provider_id)
    .bind(service_id)
    .bind(service.service_name)
    .bind(service.description)
    .bind(service.price)
    .bind(service.currency)
    .bind(service.valid_from)
    .bind(service.valid_to)
    .execute(&state.db)
    .await
    {
        Ok(result) if result.rows_affected() > 0 => {}
        Ok(_) => return err(StatusCode::NOT_FOUND, "Service not found"),
        Err(e) => {
            tracing::error!(error = %e, provider_id = %provider_id, service_id = %service_id, "Failed to update service");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to update service",
            );
        }
    }

    let _ = audit(
        &state,
        auth.user_id,
        "update_provider_service",
        "provider_service",
        Some(service_id),
        Some(json!({ "provider_id": provider_id, "service_id": service_id })),
    )
    .await;
    crate::realtime::publish_provider_event(
        &state,
        Some(auth.user_id),
        "provider.service_updated",
        provider_id,
        json!({ "provider_id": provider_id, "service_id": service_id }),
    )
    .await;

    Json(json!({ "ok": true })).into_response()
}

async fn delete_service(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path((provider_id, service_id)): Path<(Uuid, Uuid)>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::Ceo, Role::PatientManager]) {
        return e;
    }

    match sqlx::query("DELETE FROM service_catalog WHERE provider_id = $1 AND id = $2")
        .bind(provider_id)
        .bind(service_id)
        .execute(&state.db)
        .await
    {
        Ok(result) if result.rows_affected() > 0 => {}
        Ok(_) => return err(StatusCode::NOT_FOUND, "Service not found"),
        Err(e) => {
            tracing::error!(error = %e, provider_id = %provider_id, service_id = %service_id, "Failed to delete service");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to delete service",
            );
        }
    }

    let _ = audit(
        &state,
        auth.user_id,
        "delete_provider_service",
        "provider_service",
        Some(service_id),
        Some(json!({ "provider_id": provider_id, "service_id": service_id })),
    )
    .await;
    crate::realtime::publish_provider_event(
        &state,
        Some(auth.user_id),
        "provider.service_deleted",
        provider_id,
        json!({ "provider_id": provider_id, "service_id": service_id }),
    )
    .await;

    StatusCode::NO_CONTENT.into_response()
}

struct ProviderPayload {
    name: String,
    provider_type: String,
    legal_name: Option<String>,
    tax_id: Option<String>,
    address_street: Option<String>,
    address_city: Option<String>,
    address_zip: Option<String>,
    address_country: Option<String>,
    phone: Option<String>,
    email: Option<String>,
    website: Option<String>,
    fachbereich: Option<String>,
    kooperationsvertrag: Option<Value>,
    notes: Option<String>,
}

struct DoctorPayload {
    name: String,
    title: Option<String>,
    fachbereich: Option<String>,
    languages: Vec<String>,
    phone: Option<String>,
    email: Option<String>,
    license_number: Option<String>,
    licensing_country: Option<String>,
    licensing_valid_until: Option<chrono::NaiveDate>,
    notes: Option<String>,
}

struct ServicePayload {
    service_name: String,
    description: Option<String>,
    price: rust_decimal::Decimal,
    currency: String,
    valid_from: chrono::NaiveDate,
    valid_to: Option<chrono::NaiveDate>,
}

struct ProviderTemplatePayload {
    label: String,
    description: Option<String>,
    doctor_id: Option<Uuid>,
    art: String,
    category: String,
    default_auto_name: String,
    default_status: String,
    default_visibility: String,
    is_medical: bool,
    supported_languages: Vec<String>,
    body_de: Option<String>,
    body_en: Option<String>,
    body_uk: Option<String>,
    body_ru: Option<String>,
    notes: Option<String>,
    is_active: bool,
    auto_send_on_confirmed_appointment: bool,
}

fn normalize_provider_payload(
    body: UpsertProviderRequest,
) -> Result<ProviderPayload, &'static str> {
    let name = body.name.trim().to_string();
    if name.is_empty() || name.len() > 255 {
        return Err("Provider name is required (max 255)");
    }

    let provider_type = body.provider_type.trim().to_string();
    if !is_valid_provider_type(&provider_type) {
        return Err("Provider type must be medical or non_medical");
    }

    Ok(ProviderPayload {
        name,
        provider_type,
        legal_name: normalize_optional(body.legal_name),
        tax_id: normalize_optional(body.tax_id),
        address_street: normalize_optional(body.address_street),
        address_city: normalize_optional(body.address_city),
        address_zip: normalize_optional(body.address_zip),
        address_country: normalize_optional(body.address_country),
        phone: normalize_optional(body.phone),
        email: normalize_optional(body.email),
        website: normalize_optional(body.website),
        fachbereich: normalize_optional(body.fachbereich),
        kooperationsvertrag: normalize_json(body.kooperationsvertrag),
        notes: normalize_optional(body.notes),
    })
}

fn normalize_doctor_payload(body: UpsertDoctorRequest) -> Result<DoctorPayload, &'static str> {
    let name = body.name.trim().to_string();
    if name.is_empty() || name.len() > 255 {
        return Err("Doctor name is required (max 255)");
    }

    let languages = normalize_string_list(body.languages);
    let licensing_valid_until = parse_date(body.licensing_valid_until, "licensing_valid_until")?;

    Ok(DoctorPayload {
        name,
        title: normalize_optional(body.title),
        fachbereich: normalize_optional(body.fachbereich),
        languages,
        phone: normalize_optional(body.phone),
        email: normalize_optional(body.email),
        license_number: normalize_optional(body.license_number),
        licensing_country: normalize_optional(body.licensing_country),
        licensing_valid_until,
        notes: normalize_optional(body.notes),
    })
}

fn normalize_service_payload(body: UpsertServiceRequest) -> Result<ServicePayload, &'static str> {
    let service_name = body.service_name.trim().to_string();
    if service_name.is_empty() || service_name.len() > 255 {
        return Err("Service name is required (max 255)");
    }

    if !body.price.is_finite() || body.price < 0.0 {
        return Err("Service price must be a valid non-negative number");
    }

    let price = rust_decimal::Decimal::try_from(body.price)
        .map_err(|_| "Service price must be a valid non-negative number")?;

    let currency = normalize_optional(body.currency)
        .unwrap_or_else(|| "EUR".to_string())
        .to_uppercase();
    if currency.len() > 8 {
        return Err("Currency is too long");
    }

    let valid_from = parse_date(body.valid_from, "valid_from")?
        .unwrap_or_else(|| chrono::Utc::now().date_naive());
    let valid_to = parse_date(body.valid_to, "valid_to")?;

    if let Some(valid_to) = valid_to
        && valid_to < valid_from
    {
        return Err("valid_to must be on or after valid_from");
    }

    Ok(ServicePayload {
        service_name,
        description: normalize_optional(body.description),
        price,
        currency,
        valid_from,
        valid_to,
    })
}

fn normalize_provider_template_payload(
    body: UpsertProviderTemplateRequest,
) -> Result<ProviderTemplatePayload, &'static str> {
    let label = body.label.trim().to_string();
    if label.is_empty() || label.len() > 255 {
        return Err("Template label is required (max 255)");
    }

    let art =
        normalize_optional(body.art).unwrap_or_else(|| "provider_template_instruction".to_string());
    let category =
        normalize_optional(body.category).unwrap_or_else(|| "provider_template".to_string());
    let default_auto_name =
        normalize_optional(body.default_auto_name).unwrap_or_else(|| label.clone());
    if default_auto_name.len() > 255 {
        return Err("Default document name is too long");
    }

    let default_status =
        normalize_optional(body.default_status).unwrap_or_else(|| "draft".to_string());
    if !matches!(default_status.as_str(), "draft" | "active" | "archived") {
        return Err("Template default status must be draft, active or archived");
    }

    let default_visibility = normalize_optional(body.default_visibility)
        .unwrap_or_else(|| "patient_visible".to_string());
    if !matches!(
        default_visibility.as_str(),
        "internal" | "released_internal" | "released_external" | "patient_visible"
    ) {
        return Err("Template default visibility is invalid");
    }

    let supported_languages = normalize_provider_template_languages(body.supported_languages)?;
    if supported_languages.is_empty() {
        return Err("Template must support at least one language");
    }

    let body_de = normalize_optional(body.body_de);
    let body_en = normalize_optional(body.body_en);
    let body_uk = normalize_optional(body.body_uk);
    let body_ru = normalize_optional(body.body_ru);
    for language in &supported_languages {
        let has_body = match language.as_str() {
            "de" => body_de.is_some(),
            "en" => body_en.is_some(),
            "uk" => body_uk.is_some(),
            "ru" => body_ru.is_some(),
            _ => false,
        };
        if !has_body {
            return Err("Every supported language must have a template body");
        }
    }

    Ok(ProviderTemplatePayload {
        label,
        description: normalize_optional(body.description),
        doctor_id: body.doctor_id,
        art,
        category,
        default_auto_name,
        default_status,
        default_visibility,
        is_medical: body.is_medical.unwrap_or(true),
        supported_languages,
        body_de,
        body_en,
        body_uk,
        body_ru,
        notes: normalize_optional(body.notes),
        is_active: body.is_active.unwrap_or(true),
        auto_send_on_confirmed_appointment: body
            .auto_send_on_confirmed_appointment
            .unwrap_or(false),
    })
}

fn normalize_optional(value: Option<String>) -> Option<String> {
    value.and_then(|raw| {
        let trimmed = raw.trim().to_string();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed)
        }
    })
}

fn normalize_json(value: Option<Value>) -> Option<Value> {
    value.and_then(|raw| if raw.is_null() { None } else { Some(raw) })
}

fn parse_date(
    value: Option<String>,
    field_name: &'static str,
) -> Result<Option<chrono::NaiveDate>, &'static str> {
    match normalize_optional(value) {
        Some(raw) => chrono::NaiveDate::parse_from_str(&raw, "%Y-%m-%d")
            .map(Some)
            .map_err(|_| match field_name {
                "valid_from" => "valid_from must be in YYYY-MM-DD format",
                "valid_to" => "valid_to must be in YYYY-MM-DD format",
                _ => "Date must be in YYYY-MM-DD format",
            }),
        None => Ok(None),
    }
}

fn normalize_string_list(value: Option<Vec<String>>) -> Vec<String> {
    value
        .unwrap_or_default()
        .into_iter()
        .filter_map(|item| {
            let trimmed = item.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            }
        })
        .collect()
}

fn normalize_provider_template_languages(
    value: Option<Vec<String>>,
) -> Result<Vec<String>, &'static str> {
    let mut normalized = Vec::new();
    for item in value.unwrap_or_default() {
        let Some(language) = normalize_provider_template_language(&item) else {
            return Err("Template languages must be one of de, en, uk or ru");
        };
        if !normalized.iter().any(|existing| existing == language) {
            normalized.push(language.to_string());
        }
    }
    Ok(normalized)
}

fn normalize_provider_template_language(value: &str) -> Option<&'static str> {
    match value.trim().to_lowercase().as_str() {
        "de" | "de-de" | "de_at" | "de-at" | "de_ch" | "de-ch" => Some("de"),
        "en" | "en-gb" | "en-us" | "english" => Some("en"),
        "uk" | "uk-ua" | "ua" | "ukrainian" => Some("uk"),
        "ru" | "ru-ru" | "russian" => Some("ru"),
        _ => None,
    }
}

fn is_valid_provider_type(value: &str) -> bool {
    matches!(value, "medical" | "non_medical")
}

async fn toggle_provider_active(
    state: AppState,
    auth: AuthUser,
    provider_id: Uuid,
    is_active: bool,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::Ceo, Role::PatientManager]) {
        return e;
    }

    match sqlx::query("UPDATE providers SET is_active = $2, updated_at = now() WHERE id = $1")
        .bind(provider_id)
        .bind(is_active)
        .execute(&state.db)
        .await
    {
        Ok(result) if result.rows_affected() > 0 => {}
        Ok(_) => return err(StatusCode::NOT_FOUND, "Provider not found"),
        Err(e) => {
            tracing::error!(error = %e, provider_id = %provider_id, "Failed to toggle provider");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to update provider",
            );
        }
    }

    let action = if is_active {
        "activate_provider"
    } else {
        "deactivate_provider"
    };
    let _ = audit(
        &state,
        auth.user_id,
        action,
        "provider",
        Some(provider_id),
        Some(json!({ "provider_id": provider_id, "is_active": is_active })),
    )
    .await;
    crate::realtime::publish_provider_event(
        &state,
        Some(auth.user_id),
        if is_active {
            "provider.activated"
        } else {
            "provider.deactivated"
        },
        provider_id,
        json!({ "provider_id": provider_id, "is_active": is_active }),
    )
    .await;

    StatusCode::NO_CONTENT.into_response()
}

async fn ensure_provider_exists(
    state: &AppState,
    provider_id: Uuid,
) -> Result<(), axum::response::Response> {
    match sqlx::query("SELECT id FROM providers WHERE id = $1")
        .bind(provider_id)
        .fetch_optional(&state.db)
        .await
    {
        Ok(Some(_)) => Ok(()),
        Ok(None) => Err(err(StatusCode::NOT_FOUND, "Provider not found")),
        Err(e) => {
            tracing::error!(error = %e, provider_id = %provider_id, "Failed to validate provider");
            Err(err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to validate provider",
            ))
        }
    }
}

async fn ensure_doctor_belongs_to_provider(
    state: &AppState,
    provider_id: Uuid,
    doctor_id: Uuid,
) -> Result<(), axum::response::Response> {
    match sqlx::query("SELECT id FROM provider_doctors WHERE provider_id = $1 AND id = $2")
        .bind(provider_id)
        .bind(doctor_id)
        .fetch_optional(&state.db)
        .await
    {
        Ok(Some(_)) => Ok(()),
        Ok(None) => Err(err(StatusCode::NOT_FOUND, "Doctor not found")),
        Err(e) => {
            tracing::error!(error = %e, provider_id = %provider_id, doctor_id = %doctor_id, "Failed to validate provider doctor");
            Err(err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to validate doctor",
            ))
        }
    }
}

async fn load_doctors_json(
    state: &AppState,
    provider_id: Uuid,
) -> Result<Vec<serde_json::Value>, axum::response::Response> {
    let rows = sqlx::query(
        r#"SELECT d.id, d.provider_id, d.name, d.title, d.fachbereich, d.languages,
                  d.phone, d.email, d.license_number, d.licensing_country,
                  d.licensing_valid_until, d.notes, d.created_at,
                  (
                    SELECT COUNT(DISTINCT a.patient_id)
                    FROM appointments a
                    WHERE a.doctor_id = d.id
                  ) AS patient_count,
                  (
                    SELECT COUNT(*)
                    FROM appointments a
                    WHERE a.doctor_id = d.id
                  ) AS appointment_count
           FROM provider_doctors d
           WHERE d.provider_id = $1
           ORDER BY d.name"#,
    )
    .bind(provider_id)
    .fetch_all(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, provider_id = %provider_id, "Failed to load provider doctors");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to load provider doctors",
        )
    })?;

    let mut doctors = Vec::with_capacity(rows.len());
    for row in rows {
        doctors.push(json!({
            "id": row.try_get::<Uuid, _>("id").unwrap_or_default(),
            "provider_id": row.try_get::<Uuid, _>("provider_id").unwrap_or(provider_id),
            "name": row.try_get::<String, _>("name").unwrap_or_default(),
            "title": row.try_get::<Option<String>, _>("title").unwrap_or_default(),
            "fachbereich": row.try_get::<Option<String>, _>("fachbereich").unwrap_or_default(),
            "languages": row.try_get::<Vec<String>, _>("languages").unwrap_or_default(),
            "phone": row.try_get::<Option<String>, _>("phone").unwrap_or_default(),
            "email": row.try_get::<Option<String>, _>("email").unwrap_or_default(),
            "license_number": row.try_get::<Option<String>, _>("license_number").unwrap_or_default(),
            "licensing_country": row.try_get::<Option<String>, _>("licensing_country").unwrap_or_default(),
            "licensing_valid_until": row.try_get::<Option<chrono::NaiveDate>, _>("licensing_valid_until").unwrap_or_default().map(|v| v.to_string()),
            "notes": row.try_get::<Option<String>, _>("notes").unwrap_or_default(),
            "patient_count": row.try_get::<i64, _>("patient_count").unwrap_or_default(),
            "appointment_count": row.try_get::<i64, _>("appointment_count").unwrap_or_default(),
            "created_at": row.try_get::<chrono::DateTime<chrono::Utc>, _>("created_at").map(|v| v.to_rfc3339()).unwrap_or_default(),
        }));
    }

    Ok(doctors)
}

async fn load_services_json(
    state: &AppState,
    provider_id: Uuid,
) -> Result<Vec<serde_json::Value>, axum::response::Response> {
    let rows = sqlx::query(
        r#"SELECT id, provider_id, service_name, description, price, currency,
                  valid_from, valid_to, created_at
           FROM service_catalog
           WHERE provider_id = $1
           ORDER BY service_name, valid_from DESC"#,
    )
    .bind(provider_id)
    .fetch_all(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, provider_id = %provider_id, "Failed to load provider services");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to load provider services",
        )
    })?;

    let mut services = Vec::with_capacity(rows.len());
    for row in rows {
        services.push(json!({
            "id": row.try_get::<Uuid, _>("id").unwrap_or_default(),
            "provider_id": row.try_get::<Uuid, _>("provider_id").unwrap_or(provider_id),
            "service_name": row.try_get::<String, _>("service_name").unwrap_or_default(),
            "description": row.try_get::<Option<String>, _>("description").unwrap_or_default(),
            "price": row.try_get::<rust_decimal::Decimal, _>("price").unwrap_or(rust_decimal::Decimal::ZERO),
            "currency": row.try_get::<String, _>("currency").unwrap_or_else(|_| "EUR".to_string()),
            "valid_from": row.try_get::<chrono::NaiveDate, _>("valid_from").map(|v| v.to_string()).unwrap_or_default(),
            "valid_to": row.try_get::<Option<chrono::NaiveDate>, _>("valid_to").unwrap_or_default().map(|v| v.to_string()),
            "created_at": row.try_get::<chrono::DateTime<chrono::Utc>, _>("created_at").map(|v| v.to_rfc3339()).unwrap_or_default(),
        }));
    }

    Ok(services)
}

async fn load_provider_templates_json(
    state: &AppState,
    provider_id: Uuid,
) -> Result<Vec<serde_json::Value>, axum::response::Response> {
    let rows = sqlx::query(
        r#"SELECT pt.id, pt.provider_id, pt.doctor_id, pt.label, pt.description, pt.art,
                  pt.category, pt.default_auto_name, pt.default_status,
                  pt.default_visibility, pt.is_medical, pt.supported_languages,
                  pt.body_de, pt.body_en, pt.body_uk, pt.body_ru,
                  pt.notes, pt.is_active, pt.auto_send_on_confirmed_appointment,
                  pt.created_at, pt.updated_at,
                  doctor.name AS doctor_name
           FROM provider_templates pt
           LEFT JOIN provider_doctors doctor ON doctor.id = pt.doctor_id
           WHERE pt.provider_id = $1
           ORDER BY pt.is_active DESC, pt.label, pt.created_at DESC"#,
    )
    .bind(provider_id)
    .fetch_all(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, provider_id = %provider_id, "Failed to load provider templates");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to load provider templates",
        )
    })?;

    let mut templates = Vec::with_capacity(rows.len());
    for row in rows {
        templates.push(json!({
            "id": row.try_get::<Uuid, _>("id").unwrap_or_default(),
            "provider_id": row.try_get::<Uuid, _>("provider_id").unwrap_or(provider_id),
            "doctor_id": row.try_get::<Option<Uuid>, _>("doctor_id").unwrap_or_default(),
            "doctor_name": row.try_get::<Option<String>, _>("doctor_name").unwrap_or_default(),
            "label": row.try_get::<String, _>("label").unwrap_or_default(),
            "description": row.try_get::<Option<String>, _>("description").unwrap_or_default(),
            "art": row.try_get::<String, _>("art").unwrap_or_default(),
            "category": row.try_get::<String, _>("category").unwrap_or_default(),
            "default_auto_name": row.try_get::<String, _>("default_auto_name").unwrap_or_default(),
            "default_status": row.try_get::<String, _>("default_status").unwrap_or_else(|_| "draft".to_string()),
            "default_visibility": row.try_get::<String, _>("default_visibility").unwrap_or_else(|_| "patient_visible".to_string()),
            "is_medical": row.try_get::<bool, _>("is_medical").unwrap_or(true),
            "supported_languages": row.try_get::<Vec<String>, _>("supported_languages").unwrap_or_default(),
            "body_de": row.try_get::<Option<String>, _>("body_de").unwrap_or_default(),
            "body_en": row.try_get::<Option<String>, _>("body_en").unwrap_or_default(),
            "body_uk": row.try_get::<Option<String>, _>("body_uk").unwrap_or_default(),
            "body_ru": row.try_get::<Option<String>, _>("body_ru").unwrap_or_default(),
            "notes": row.try_get::<Option<String>, _>("notes").unwrap_or_default(),
            "is_active": row.try_get::<bool, _>("is_active").unwrap_or(true),
            "auto_send_on_confirmed_appointment": row.try_get::<bool, _>("auto_send_on_confirmed_appointment").unwrap_or(false),
            "created_at": row.try_get::<chrono::DateTime<chrono::Utc>, _>("created_at").map(|value| value.to_rfc3339()).unwrap_or_default(),
            "updated_at": row.try_get::<chrono::DateTime<chrono::Utc>, _>("updated_at").map(|value| value.to_rfc3339()).unwrap_or_default(),
        }));
    }

    Ok(templates)
}

async fn load_provider_patients_json(
    state: &AppState,
    provider_id: Uuid,
    doctor_id: Option<Uuid>,
) -> Result<Vec<serde_json::Value>, axum::response::Response> {
    let rows = sqlx::query(
        r#"WITH links AS (
                SELECT a.patient_id,
                       COUNT(*)::bigint AS appointment_count,
                       0::bigint AS leistung_count,
                       0::bigint AS concierge_count,
                       MAX((a.date::timestamp + COALESCE(a.time_start, TIME '00:00')) AT TIME ZONE 'UTC') AS last_interaction_at
                FROM appointments a
                WHERE a.provider_id = $1
                  AND ($2::uuid IS NULL OR a.doctor_id = $2)
                GROUP BY a.patient_id

                UNION ALL

                SELECT o.patient_id,
                       0::bigint AS appointment_count,
                       COUNT(*)::bigint AS leistung_count,
                       0::bigint AS concierge_count,
                       MAX(COALESCE(ol.approved_at, ol.delivered_at, ol.created_at)) AS last_interaction_at
                FROM order_leistungen ol
                JOIN orders o ON o.id = ol.order_id
                WHERE ol.provider_id = $1
                  AND ($2::uuid IS NULL OR ol.doctor_id = $2)
                GROUP BY o.patient_id

                UNION ALL

                SELECT cs.patient_id,
                       0::bigint AS appointment_count,
                       0::bigint AS leistung_count,
                       COUNT(*)::bigint AS concierge_count,
                       MAX(COALESCE(cs.starts_at, cs.completed_at, cs.updated_at, cs.created_at)) AS last_interaction_at
                FROM concierge_services cs
                WHERE cs.provider_id = $1
                  AND $2::uuid IS NULL
                GROUP BY cs.patient_id
            ),
            linked AS (
                SELECT patient_id,
                       SUM(appointment_count)::bigint AS appointment_count,
                       SUM(leistung_count)::bigint AS leistung_count,
                       SUM(concierge_count)::bigint AS concierge_count,
                       MAX(last_interaction_at) AS last_interaction_at
                FROM links
                GROUP BY patient_id
            )
            SELECT p.id, p.patient_id, p.first_name, p.last_name,
                   l.appointment_count, l.leistung_count, l.concierge_count, l.last_interaction_at
            FROM linked l
            JOIN patients p ON p.id = l.patient_id
            ORDER BY l.last_interaction_at DESC, p.last_name, p.first_name
            LIMIT 200"#,
    )
    .bind(provider_id)
    .bind(doctor_id)
    .fetch_all(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, provider_id = %provider_id, doctor_id = ?doctor_id, "Failed to load provider patients");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to load provider patients",
        )
    })?;

    let mut patients = Vec::with_capacity(rows.len());
    for row in rows {
        patients.push(json!({
            "id": row.try_get::<Uuid, _>("id").unwrap_or_default(),
            "patient_id": row.try_get::<String, _>("patient_id").unwrap_or_default(),
            "first_name": row.try_get::<String, _>("first_name").unwrap_or_default(),
            "last_name": row.try_get::<String, _>("last_name").unwrap_or_default(),
            "appointment_count": row.try_get::<i64, _>("appointment_count").unwrap_or_default(),
            "leistung_count": row.try_get::<i64, _>("leistung_count").unwrap_or_default(),
            "concierge_count": row.try_get::<i64, _>("concierge_count").unwrap_or_default(),
            "last_interaction_at": row.try_get::<chrono::DateTime<chrono::Utc>, _>("last_interaction_at").map(|v| v.to_rfc3339()).unwrap_or_default(),
        }));
    }

    Ok(patients)
}

async fn load_provider_interactions_json(
    state: &AppState,
    provider_id: Uuid,
    doctor_id: Option<Uuid>,
) -> Result<Vec<serde_json::Value>, axum::response::Response> {
    let rows = sqlx::query(
        r#"SELECT kind, interaction_id, patient_id, patient_name, doctor_id, doctor_name,
                  order_id, order_number, status, title, appointment_type, location, notes,
                  occurred_at, quantity, unit_price, currency
           FROM (
                SELECT 'appointment'::text AS kind,
                       a.id AS interaction_id,
                       p.patient_id AS patient_id,
                       CONCAT_WS(' ', p.first_name, p.last_name) AS patient_name,
                       a.doctor_id AS doctor_id,
                       d.name AS doctor_name,
                       a.order_id AS order_id,
                       o.order_number AS order_number,
                       a.status AS status,
                       a.title AS title,
                       a.appointment_type AS appointment_type,
                       a.location AS location,
                       a.notes AS notes,
                       (a.date::timestamp + COALESCE(a.time_start, TIME '00:00')) AT TIME ZONE 'UTC' AS occurred_at,
                       NULL::numeric AS quantity,
                       NULL::numeric AS unit_price,
                       NULL::text AS currency
                FROM appointments a
                JOIN patients p ON p.id = a.patient_id
                LEFT JOIN provider_doctors d ON d.id = a.doctor_id
                LEFT JOIN orders o ON o.id = a.order_id
                WHERE a.provider_id = $1
                  AND ($2::uuid IS NULL OR a.doctor_id = $2)

                UNION ALL

                SELECT 'leistung'::text AS kind,
                       ol.id AS interaction_id,
                       p.patient_id AS patient_id,
                       CONCAT_WS(' ', p.first_name, p.last_name) AS patient_name,
                       ol.doctor_id AS doctor_id,
                       d.name AS doctor_name,
                       o.id AS order_id,
                       o.order_number AS order_number,
                       ol.status AS status,
                       ol.description AS title,
                       NULL::text AS appointment_type,
                       NULL::text AS location,
                       ol.notes AS notes,
                       COALESCE(ol.approved_at, ol.delivered_at, ol.created_at) AS occurred_at,
                       ol.quantity AS quantity,
                       ol.unit_price AS unit_price,
                       ol.currency AS currency
                FROM order_leistungen ol
                JOIN orders o ON o.id = ol.order_id
                JOIN patients p ON p.id = o.patient_id
                LEFT JOIN provider_doctors d ON d.id = ol.doctor_id
                WHERE ol.provider_id = $1
                  AND ($2::uuid IS NULL OR ol.doctor_id = $2)

                UNION ALL

                SELECT 'concierge_service'::text AS kind,
                       cs.id AS interaction_id,
                       p.patient_id AS patient_id,
                       CONCAT_WS(' ', p.first_name, p.last_name) AS patient_name,
                       NULL::uuid AS doctor_id,
                       NULL::text AS doctor_name,
                       a.order_id AS order_id,
                       o.order_number AS order_number,
                       cs.status AS status,
                       cs.title AS title,
                       cs.service_kind AS appointment_type,
                       COALESCE(cs.vendor_name, cs.booking_reference) AS location,
                       COALESCE(cs.service_notes, cs.vendor_contact, cs.billing_notes) AS notes,
                       COALESCE(cs.starts_at, cs.completed_at, cs.updated_at, cs.created_at) AS occurred_at,
                       NULL::numeric AS quantity,
                       COALESCE(cs.actual_cost, cs.cost_estimate) AS unit_price,
                       cs.currency AS currency
                FROM concierge_services cs
                JOIN patients p ON p.id = cs.patient_id
                LEFT JOIN appointments a ON a.id = cs.appointment_id
                LEFT JOIN orders o ON o.id = a.order_id
                WHERE cs.provider_id = $1
                  AND $2::uuid IS NULL
            ) interactions
           ORDER BY occurred_at DESC, patient_name, title
           LIMIT 200"#,
    )
    .bind(provider_id)
    .bind(doctor_id)
    .fetch_all(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, provider_id = %provider_id, doctor_id = ?doctor_id, "Failed to load provider interactions");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to load provider interactions",
        )
    })?;

    let mut interactions = Vec::with_capacity(rows.len());
    for row in rows {
        interactions.push(json!({
            "kind": row.try_get::<String, _>("kind").unwrap_or_default(),
            "id": row.try_get::<Uuid, _>("interaction_id").unwrap_or_default(),
            "patient_id": row.try_get::<String, _>("patient_id").unwrap_or_default(),
            "patient_name": row.try_get::<String, _>("patient_name").unwrap_or_default(),
            "doctor_id": row.try_get::<Option<Uuid>, _>("doctor_id").unwrap_or_default(),
            "doctor_name": row.try_get::<Option<String>, _>("doctor_name").unwrap_or_default(),
            "order_id": row.try_get::<Option<Uuid>, _>("order_id").unwrap_or_default(),
            "order_number": row.try_get::<Option<String>, _>("order_number").unwrap_or_default(),
            "status": row.try_get::<String, _>("status").unwrap_or_default(),
            "title": row.try_get::<String, _>("title").unwrap_or_default(),
            "appointment_type": row.try_get::<Option<String>, _>("appointment_type").unwrap_or_default(),
            "location": row.try_get::<Option<String>, _>("location").unwrap_or_default(),
            "notes": row.try_get::<Option<String>, _>("notes").unwrap_or_default(),
            "occurred_at": row.try_get::<chrono::DateTime<chrono::Utc>, _>("occurred_at").map(|v| v.to_rfc3339()).unwrap_or_default(),
            "quantity": row.try_get::<Option<rust_decimal::Decimal>, _>("quantity").unwrap_or_default(),
            "unit_price": row.try_get::<Option<rust_decimal::Decimal>, _>("unit_price").unwrap_or_default(),
            "currency": row.try_get::<Option<String>, _>("currency").unwrap_or_default(),
        }));
    }

    Ok(interactions)
}

async fn audit(
    state: &AppState,
    user_id: Uuid,
    action: &str,
    entity_type: &str,
    entity_id: Option<Uuid>,
    new_value: Option<serde_json::Value>,
) -> Result<(), sqlx::Error> {
    // new_value is carried on the context blob (no dedicated diff column)
    // because this helper's callers always report an after-state only, not
    // a before/after pair.
    let context = match new_value {
        Some(value) => serde_json::json!({ "new_value": value }),
        None => serde_json::json!({}),
    };
    state.audit_sender.try_send(audit_mod::domain_event(
        action.to_string(),
        Some(user_id),
        entity_type.to_string(),
        entity_id,
        context,
    ));
    Ok(())
}

fn err(status: StatusCode, message: &str) -> axum::response::Response {
    (
        status,
        Json(json!({ "error": status.canonical_reason().unwrap_or("error"), "message": message })),
    )
        .into_response()
}
