use axum::{
    Json, Router,
    extract::{Extension, Query, State},
    http::StatusCode,
    response::IntoResponse,
    routing::get,
};
use chrono::{DateTime, Utc};
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::Row;
use uuid::Uuid;

use crate::auth::middleware::AuthUser;
use crate::state::AppState;
use gmed_domain::role::Role;

pub fn router() -> Router<AppState> {
    Router::new().route("/provider-people", get(list_provider_people))
}

#[derive(Deserialize)]
struct ProviderPeopleQuery {
    person_type: Option<String>,
    search: Option<String>,
    provider_id: Option<Uuid>,
    provider_type: Option<String>,
    provider_taxonomy_node_id: Option<Uuid>,
    taxonomy_node_id: Option<Uuid>,
    fachbereich: Option<String>,
    specialization: Option<String>,
    specializations: Option<String>,
    role: Option<String>,
    gender: Option<String>,
    patient_id: Option<Uuid>,
    active_only: Option<bool>,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum PersonTypeFilter {
    Doctor,
    Staff,
    All,
}

async fn list_provider_people(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Query(query): Query<ProviderPeopleQuery>,
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

    let person_type = match parse_person_type(query.person_type) {
        Ok(value) => value,
        Err(message) => return err(StatusCode::UNPROCESSABLE_ENTITY, message),
    };
    let provider_type = normalize_optional(query.provider_type);
    if let Some(ref provider_type) = provider_type
        && !matches!(provider_type.as_str(), "medical" | "non_medical")
    {
        return err(StatusCode::UNPROCESSABLE_ENTITY, "Invalid provider type");
    }

    let gender = normalize_optional(query.gender).map(|value| value.to_lowercase());
    if let Some(ref gender) = gender
        && !matches!(gender.as_str(), "male" | "female" | "unknown")
    {
        return err(StatusCode::UNPROCESSABLE_ENTITY, "Invalid gender");
    }

    let provider_id = query.provider_id;
    let provider_taxonomy_node_id = query.provider_taxonomy_node_id.or(query.taxonomy_node_id);
    let patient_id = query.patient_id;
    let search_pattern = like_pattern(query.search);
    let specialization_terms = normalize_filter_terms([
        query.fachbereich,
        query.specialization,
        query.specializations,
    ]);
    let role = normalize_optional(query.role).map(|value| value.to_lowercase());
    let role_pattern = role
        .as_ref()
        .map(|value| format!("%{value}%"))
        .unwrap_or_else(|| "%%".to_string());
    let active_only = query.active_only.unwrap_or(true);

    let mut items = Vec::new();
    if matches!(
        person_type,
        PersonTypeFilter::Doctor | PersonTypeFilter::All
    ) {
        match load_doctor_people(
            &state,
            active_only,
            provider_id,
            provider_taxonomy_node_id,
            patient_id,
            provider_type.as_deref(),
            &search_pattern,
            &specialization_terms,
            role.as_deref(),
            &role_pattern,
            gender.as_deref(),
        )
        .await
        {
            Ok(mut doctors) => items.append(&mut doctors),
            Err(resp) => return resp,
        }
    }

    if matches!(person_type, PersonTypeFilter::Staff | PersonTypeFilter::All)
        && patient_id.is_none()
        && specialization_terms.is_empty()
    {
        match load_staff_people(
            &state,
            active_only,
            provider_id,
            provider_taxonomy_node_id,
            provider_type.as_deref(),
            &search_pattern,
            role.as_deref(),
            &role_pattern,
            gender.as_deref(),
        )
        .await
        {
            Ok(mut staff) => items.append(&mut staff),
            Err(resp) => return resp,
        }
    }

    items.sort_by(|left, right| {
        let left_key = sort_key(left);
        let right_key = sort_key(right);
        left_key.cmp(&right_key)
    });

    Json(items).into_response()
}

#[allow(clippy::too_many_arguments)]
async fn load_doctor_people(
    state: &AppState,
    active_only: bool,
    provider_id: Option<Uuid>,
    provider_taxonomy_node_id: Option<Uuid>,
    patient_id: Option<Uuid>,
    provider_type: Option<&str>,
    search_pattern: &str,
    specialization_terms: &[String],
    role: Option<&str>,
    role_pattern: &str,
    gender: Option<&str>,
) -> Result<Vec<Value>, axum::response::Response> {
    let rows = sqlx::query(
        r#"SELECT d.id, d.provider_id, d.name, d.first_name, d.last_name, d.display_name,
                  d.title, d.role_code, d.role_label, to_jsonb(d)->>'subrole' AS subrole,
                  d.gender, d.opening_hours, d.fachbereich, d.languages, d.phone, d.email,
                  d.license_number, d.licensing_country, d.licensing_valid_until, d.notes,
                  d.created_at,
                  p.name AS provider_name,
                  jsonb_build_object(
                      'id', p.id,
                      'name', p.name,
                      'provider_type', p.provider_type,
                      'legal_name', p.legal_name,
                      'tax_id', p.tax_id,
                      'address_city', p.address_city,
                      'address_country', p.address_country,
                      'parent_provider_id', p.parent_provider_id,
                      'parent_provider_name', parent.name,
                      'organization_level', p.organization_level,
                      'is_active', p.is_active
                  ) AS provider,
                  COALESCE((
                      SELECT jsonb_agg(
                          jsonb_build_object(
                              'id', ms.id,
                              'code', ms.code,
                              'name_en', ms.name_en,
                              'name_de', ms.name_de,
                              'name_ru', ms.name_ru,
                              'is_active', ms.is_active,
                              'is_primary', ds.is_primary
                          )
                          ORDER BY ds.is_primary DESC, ms.sort_order, ms.name_en
                      )
                      FROM provider_doctor_specializations ds
                      JOIN medical_specializations ms ON ms.id = ds.specialization_id
                      WHERE ds.doctor_id = d.id
                  ), '[]'::jsonb) AS specializations,
                  COALESCE((
                      SELECT jsonb_agg(
                          jsonb_build_object(
                              'id', pc.id,
                              'contact_kind', pc.contact_kind,
                              'contact_type', pc.contact_type,
                              'value', pc.value,
                              'is_primary', pc.is_primary,
                              'notes', pc.notes
                          )
                          ORDER BY pc.contact_kind, pc.is_primary DESC, pc.contact_type, pc.created_at
                      )
                      FROM provider_person_contacts pc
                      WHERE pc.doctor_id = d.id
                  ), '[]'::jsonb) AS contacts,
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
           JOIN providers p ON p.id = d.provider_id
           LEFT JOIN providers parent ON parent.id = p.parent_provider_id
           WHERE ($1::bool = false OR p.is_active = true)
             AND ($2::uuid IS NULL OR p.id = $2)
             AND ($3::text IS NULL OR p.provider_type = $3)
             AND (
                 $4::text = '%%'
                 OR de_normalize(concat_ws(' ',
                      d.name, d.display_name, d.first_name, d.last_name,
                      d.title, d.role_code, d.role_label,
                      to_jsonb(d)->>'subrole', d.fachbereich,
                      d.license_number, d.licensing_country, d.phone, d.email,
                      p.name, p.legal_name, p.tax_id, p.address_city, p.address_country
                    )) LIKE de_normalize($4)
                 OR EXISTS (
                     SELECT 1
                     FROM provider_person_contacts pc
                     WHERE pc.doctor_id = d.id
                       AND de_normalize(pc.value) LIKE de_normalize($4)
                 )
                 OR EXISTS (
                     SELECT 1
                     FROM provider_doctor_specializations ds
                     JOIN medical_specializations ms ON ms.id = ds.specialization_id
                     WHERE ds.doctor_id = d.id
                       AND de_normalize(concat_ws(' ', ms.code, ms.name_en, ms.name_de, ms.name_ru)) LIKE de_normalize($4)
                 )
             )
             AND (
                 cardinality($5::text[]) = 0
                 OR EXISTS (
                     SELECT 1
                     FROM unnest($5::text[]) AS wanted(value)
                     WHERE lower(COALESCE(d.fachbereich, '')) LIKE '%' || wanted.value || '%'
                 )
                 OR EXISTS (
                     SELECT 1
                     FROM provider_doctor_specializations ds
                     JOIN medical_specializations ms ON ms.id = ds.specialization_id
                     WHERE ds.doctor_id = d.id
                       AND EXISTS (
                           SELECT 1
                           FROM unnest($5::text[]) AS wanted(value)
                           WHERE lower(ms.code) LIKE '%' || wanted.value || '%'
                              OR lower(ms.name_en) LIKE '%' || wanted.value || '%'
                              OR lower(COALESCE(ms.name_de, '')) LIKE '%' || wanted.value || '%'
                              OR lower(COALESCE(ms.name_ru, '')) LIKE '%' || wanted.value || '%'
                       )
                 )
             )
             AND (
                 $6::text IS NULL
                 OR lower(COALESCE(d.role_code, '')) = $6
                 OR lower(COALESCE(d.role_label, '')) = $6
                 OR lower(COALESCE(to_jsonb(d)->>'subrole', '')) = $6
                 OR COALESCE(d.role_label, '') ILIKE $7
                 OR COALESCE(to_jsonb(d)->>'subrole', '') ILIKE $7
             )
             AND ($8::text IS NULL OR d.gender = $8)
             AND (
                 $9::uuid IS NULL
                 OR EXISTS (
                     SELECT 1
                     FROM appointments a
                     WHERE a.doctor_id = d.id
                       AND a.patient_id = $9
                 )
             )
             AND (
                 $10::uuid IS NULL
                 OR EXISTS (
                    WITH RECURSIVE assigned_taxonomy AS (
                        SELECT ptn.id, ptn.parent_id
                        FROM provider_taxonomy_assignments pta
                        JOIN provider_taxonomy_nodes ptn ON ptn.id = pta.taxonomy_node_id
                        WHERE pta.provider_id = p.id

                        UNION ALL

                        SELECT parent.id, parent.parent_id
                        FROM provider_taxonomy_nodes parent
                        JOIN assigned_taxonomy child ON child.parent_id = parent.id
                    )
                    SELECT 1
                    FROM assigned_taxonomy
                    WHERE id = $10
                 )
             )
           ORDER BY p.name, d.name"#,
    )
    .bind(active_only)
    .bind(provider_id)
    .bind(provider_type)
    .bind(search_pattern)
    .bind(specialization_terms)
    .bind(role)
    .bind(role_pattern)
    .bind(gender)
    .bind(patient_id)
    .bind(provider_taxonomy_node_id)
    .fetch_all(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, "Failed to list provider doctors read model");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to list provider people",
        )
    })?;

    Ok(rows
        .into_iter()
        .map(|row| {
            let doctor_id = row.try_get::<Uuid, _>("id").unwrap_or_default();
            let provider_id = row.try_get::<Uuid, _>("provider_id").unwrap_or_default();
            let phone = row
                .try_get::<Option<String>, _>("phone")
                .unwrap_or_default();
            let email = row
                .try_get::<Option<String>, _>("email")
                .unwrap_or_default();
            let contacts = contacts_with_legacy(
                row.try_get::<Value, _>("contacts")
                    .unwrap_or_else(|_| json!([])),
                phone.clone(),
                email.clone(),
            );
            let role_code = row
                .try_get::<Option<String>, _>("role_code")
                .unwrap_or_default();
            let role_label = row
                .try_get::<Option<String>, _>("role_label")
                .unwrap_or_default();

            json!({
                "id": doctor_id,
                "person_type": "doctor",
                "doctor_id": doctor_id,
                "staff_id": Value::Null,
                "provider_id": provider_id,
                "provider_name": row.try_get::<String, _>("provider_name").unwrap_or_default(),
                "provider": row.try_get::<Value, _>("provider").unwrap_or_else(|_| json!({})),
                "name": row.try_get::<String, _>("name").unwrap_or_default(),
                "first_name": row.try_get::<Option<String>, _>("first_name").unwrap_or_default(),
                "last_name": row.try_get::<Option<String>, _>("last_name").unwrap_or_default(),
                "display_name": row.try_get::<Option<String>, _>("display_name").unwrap_or_default(),
                "title": row.try_get::<Option<String>, _>("title").unwrap_or_default(),
                "role": role_code,
                "role_code": role_code,
                "role_label": role_label,
                "subrole": row.try_get::<Option<String>, _>("subrole").unwrap_or_default(),
                "gender": row.try_get::<String, _>("gender").unwrap_or_else(|_| "unknown".to_string()),
                "opening_hours": row.try_get::<Option<String>, _>("opening_hours").unwrap_or_default(),
                "fachbereich": row.try_get::<Option<String>, _>("fachbereich").unwrap_or_default(),
                "specializations": row.try_get::<Value, _>("specializations").unwrap_or_else(|_| json!([])),
                "languages": row.try_get::<Vec<String>, _>("languages").unwrap_or_default(),
                "phone": phone,
                "email": email,
                "contacts": contacts,
                "department": Value::Null,
                "status": Value::Null,
                "is_active": true,
                "license_number": row.try_get::<Option<String>, _>("license_number").unwrap_or_default(),
                "licensing_country": row.try_get::<Option<String>, _>("licensing_country").unwrap_or_default(),
                "licensing_valid_until": row.try_get::<Option<chrono::NaiveDate>, _>("licensing_valid_until").unwrap_or_default().map(|value| value.to_string()),
                "notes": row.try_get::<Option<String>, _>("notes").unwrap_or_default(),
                "patient_count": row.try_get::<i64, _>("patient_count").unwrap_or_default(),
                "appointment_count": row.try_get::<i64, _>("appointment_count").unwrap_or_default(),
                "created_at": row.try_get::<DateTime<Utc>, _>("created_at").map(|value| value.to_rfc3339()).unwrap_or_default(),
            })
        })
        .collect())
}

#[allow(clippy::too_many_arguments)]
async fn load_staff_people(
    state: &AppState,
    active_only: bool,
    provider_id: Option<Uuid>,
    provider_taxonomy_node_id: Option<Uuid>,
    provider_type: Option<&str>,
    search_pattern: &str,
    role: Option<&str>,
    role_pattern: &str,
    gender: Option<&str>,
) -> Result<Vec<Value>, axum::response::Response> {
    let rows = sqlx::query(
        r#"SELECT s.id, s.provider_id, s.first_name, s.last_name, s.display_name,
                  s.role,
                  COALESCE(
                      NULLIF(TRIM(sr.name_de), ''),
                      NULLIF(TRIM(sr.name_ru), ''),
                      s.role
                  ) AS role_label,
                  sr.name_de AS role_name_de,
                  sr.name_ru AS role_name_ru,
                  s.department, s.gender, s.opening_hours, s.status, s.notes, s.is_active,
                  s.created_at, s.updated_at,
                  p.name AS provider_name,
                  jsonb_build_object(
                      'id', p.id,
                      'name', p.name,
                      'provider_type', p.provider_type,
                      'legal_name', p.legal_name,
                      'tax_id', p.tax_id,
                      'address_city', p.address_city,
                      'address_country', p.address_country,
                      'parent_provider_id', p.parent_provider_id,
                      'parent_provider_name', parent.name,
                      'organization_level', p.organization_level,
                      'is_active', p.is_active
                  ) AS provider,
                  COALESCE((
                      SELECT jsonb_agg(
                          jsonb_build_object(
                              'id', pc.id,
                              'contact_kind', pc.contact_kind,
                              'contact_type', pc.contact_type,
                              'value', pc.value,
                              'is_primary', pc.is_primary,
                              'notes', pc.notes
                          )
                          ORDER BY pc.contact_kind, pc.is_primary DESC, pc.contact_type, pc.created_at
                      )
                      FROM provider_person_contacts pc
                      WHERE pc.staff_id = s.id
                  ), '[]'::jsonb) AS contacts
           FROM provider_staff s
           JOIN providers p ON p.id = s.provider_id
           LEFT JOIN providers parent ON parent.id = p.parent_provider_id
           LEFT JOIN provider_staff_roles sr ON sr.code = s.role
           WHERE ($1::bool = false OR (p.is_active = true AND s.is_active = true))
             AND ($2::uuid IS NULL OR p.id = $2)
             AND ($3::text IS NULL OR p.provider_type = $3)
             AND (
                 $4::text = '%%'
                 OR de_normalize(concat_ws(' ',
                      s.display_name, s.first_name, s.last_name, s.role,
                      sr.name_en, sr.name_de, sr.name_ru, s.department,
                      p.name, p.legal_name, p.tax_id, p.address_city, p.address_country
                    )) LIKE de_normalize($4)
                 OR EXISTS (
                     SELECT 1
                     FROM provider_person_contacts pc
                     WHERE pc.staff_id = s.id
                       AND de_normalize(pc.value) LIKE de_normalize($4)
                 )
             )
             AND (
                 $5::text IS NULL
                 OR lower(s.role) = $5
                 OR lower(COALESCE(sr.name_en, '')) = $5
                 OR lower(COALESCE(sr.name_de, '')) = $5
                 OR lower(COALESCE(sr.name_ru, '')) = $5
                 OR COALESCE(sr.name_en, '') ILIKE $6
                 OR COALESCE(sr.name_de, '') ILIKE $6
                 OR COALESCE(sr.name_ru, '') ILIKE $6
             )
             AND ($7::text IS NULL OR s.gender = $7)
             AND (
                 $8::uuid IS NULL
                 OR EXISTS (
                    WITH RECURSIVE assigned_taxonomy AS (
                        SELECT ptn.id, ptn.parent_id
                        FROM provider_taxonomy_assignments pta
                        JOIN provider_taxonomy_nodes ptn ON ptn.id = pta.taxonomy_node_id
                        WHERE pta.provider_id = p.id

                        UNION ALL

                        SELECT parent.id, parent.parent_id
                        FROM provider_taxonomy_nodes parent
                        JOIN assigned_taxonomy child ON child.parent_id = parent.id
                    )
                    SELECT 1
                    FROM assigned_taxonomy
                    WHERE id = $8
                 )
             )
           ORDER BY p.name, s.is_active DESC, s.role, s.display_name"#,
    )
    .bind(active_only)
    .bind(provider_id)
    .bind(provider_type)
    .bind(search_pattern)
    .bind(role)
    .bind(role_pattern)
    .bind(gender)
    .bind(provider_taxonomy_node_id)
    .fetch_all(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, "Failed to list provider staff read model");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to list provider people",
        )
    })?;

    Ok(rows
        .into_iter()
        .map(|row| {
            let staff_id = row.try_get::<Uuid, _>("id").unwrap_or_default();
            let provider_id = row.try_get::<Uuid, _>("provider_id").unwrap_or_default();
            let role = row.try_get::<String, _>("role").unwrap_or_default();

            json!({
                "id": staff_id,
                "person_type": "staff",
                "doctor_id": Value::Null,
                "staff_id": staff_id,
                "provider_id": provider_id,
                "provider_name": row.try_get::<String, _>("provider_name").unwrap_or_default(),
                "provider": row.try_get::<Value, _>("provider").unwrap_or_else(|_| json!({})),
                "name": row.try_get::<String, _>("display_name").unwrap_or_default(),
                "first_name": row.try_get::<Option<String>, _>("first_name").unwrap_or_default(),
                "last_name": row.try_get::<Option<String>, _>("last_name").unwrap_or_default(),
                "display_name": row.try_get::<String, _>("display_name").unwrap_or_default(),
                "title": Value::Null,
                "role": role,
                "role_code": role,
                "role_label": row.try_get::<String, _>("role_label").ok(),
                "role_label_key": format!("provider_staff_role.{role}"),
                "role_name_de": row.try_get::<Option<String>, _>("role_name_de").unwrap_or_default(),
                "role_name_ru": row.try_get::<Option<String>, _>("role_name_ru").unwrap_or_default(),
                "subrole": Value::Null,
                "gender": row.try_get::<String, _>("gender").unwrap_or_else(|_| "unknown".to_string()),
                "opening_hours": row.try_get::<Option<String>, _>("opening_hours").unwrap_or_default(),
                "fachbereich": Value::Null,
                "specializations": [],
                "languages": Vec::<String>::new(),
                "phone": Value::Null,
                "email": Value::Null,
                "contacts": row.try_get::<Value, _>("contacts").unwrap_or_else(|_| json!([])),
                "department": row.try_get::<Option<String>, _>("department").unwrap_or_default(),
                "status": row.try_get::<String, _>("status").unwrap_or_else(|_| "active".to_string()),
                "is_active": row.try_get::<bool, _>("is_active").unwrap_or(true),
                "license_number": Value::Null,
                "licensing_country": Value::Null,
                "licensing_valid_until": Value::Null,
                "notes": row.try_get::<Option<String>, _>("notes").unwrap_or_default(),
                "patient_count": 0,
                "appointment_count": 0,
                "created_at": row.try_get::<DateTime<Utc>, _>("created_at").map(|value| value.to_rfc3339()).unwrap_or_default(),
                "updated_at": row.try_get::<DateTime<Utc>, _>("updated_at").map(|value| value.to_rfc3339()).unwrap_or_default(),
            })
        })
        .collect())
}

fn parse_person_type(value: Option<String>) -> Result<PersonTypeFilter, &'static str> {
    match normalize_optional(value)
        .unwrap_or_else(|| "all".to_string())
        .to_lowercase()
        .as_str()
    {
        "doctor" => Ok(PersonTypeFilter::Doctor),
        "staff" => Ok(PersonTypeFilter::Staff),
        "all" => Ok(PersonTypeFilter::All),
        _ => Err("person_type must be doctor, staff or all"),
    }
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

fn normalize_filter_terms<const N: usize>(values: [Option<String>; N]) -> Vec<String> {
    let mut terms = Vec::new();
    for value in values.into_iter().flatten() {
        for item in value.split(',') {
            let normalized = item.trim().to_lowercase();
            if !normalized.is_empty() && !terms.iter().any(|existing| existing == &normalized) {
                terms.push(normalized);
            }
        }
    }
    terms
}

fn like_pattern(value: Option<String>) -> String {
    normalize_optional(value)
        .map(|value| format!("%{value}%"))
        .unwrap_or_else(|| "%%".to_string())
}

fn contacts_with_legacy(contacts: Value, phone: Option<String>, email: Option<String>) -> Value {
    if contacts.as_array().is_some_and(|items| !items.is_empty()) {
        return contacts;
    }

    let mut fallback = Vec::new();
    if let Some(phone) = normalize_optional(phone) {
        fallback.push(json!({
            "id": Value::Null,
            "contact_kind": "phone",
            "contact_type": "work",
            "value": phone,
            "is_primary": true,
            "notes": Value::Null,
        }));
    }
    if let Some(email) = normalize_optional(email) {
        fallback.push(json!({
            "id": Value::Null,
            "contact_kind": "email",
            "contact_type": "work",
            "value": email,
            "is_primary": true,
            "notes": Value::Null,
        }));
    }

    Value::Array(fallback)
}

fn sort_key(value: &Value) -> (String, String, String) {
    let provider = value
        .get("provider_name")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_lowercase();
    let person_type = value
        .get("person_type")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_lowercase();
    let name = value
        .get("name")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_lowercase();
    (provider, person_type, name)
}

fn err(status: StatusCode, message: &str) -> axum::response::Response {
    (
        status,
        Json(json!({ "error": status.canonical_reason().unwrap_or("error"), "message": message })),
    )
        .into_response()
}
