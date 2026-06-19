use axum::{
    Json, Router,
    extract::{Extension, Path, Query, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
};
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::{Postgres, Row, Transaction, postgres::PgRow};
use uuid::Uuid;

use crate::audit::{self as audit_mod};
use crate::auth::middleware::AuthUser;
use crate::state::AppState;
use gmed_domain::role::Role;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/providers", get(list_providers).post(create_provider))
        .route(
            "/providers/specializations",
            get(list_specializations).post(create_specialization),
        )
        .route(
            "/providers/specializations/{specialization_id}/update",
            post(update_specialization),
        )
        .route(
            "/providers/specializations/{specialization_id}/activate",
            post(activate_specialization),
        )
        .route(
            "/providers/specializations/{specialization_id}/deactivate",
            post(deactivate_specialization),
        )
        .route(
            "/providers/specializations/{specialization_id}/delete",
            post(delete_specialization),
        )
        .route(
            "/providers/insurance-providers",
            get(list_insurance_providers),
        )
        .route("/providers/taxonomy", get(list_provider_taxonomy))
        .route(
            "/providers/staff-roles",
            get(list_provider_staff_roles).post(create_provider_staff_role),
        )
        .route(
            "/providers/staff-roles/{role_id}/update",
            post(update_provider_staff_role),
        )
        .route(
            "/providers/staff-roles/{role_id}/activate",
            post(activate_provider_staff_role),
        )
        .route(
            "/providers/staff-roles/{role_id}/deactivate",
            post(deactivate_provider_staff_role),
        )
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
            "/providers/{provider_id}/doctors/{doctor_id}/relationships",
            get(list_doctor_relationships).post(create_doctor_relationship),
        )
        .route(
            "/providers/{provider_id}/doctors/{doctor_id}/relationships/{relationship_id}/update",
            post(update_doctor_relationship),
        )
        .route(
            "/providers/{provider_id}/doctors/{doctor_id}/relationships/{relationship_id}/delete",
            post(delete_doctor_relationship),
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
            "/providers/{provider_id}/staff",
            get(list_provider_staff).post(create_provider_staff),
        )
        .route(
            "/providers/{provider_id}/staff/{staff_id}/update",
            post(update_provider_staff),
        )
        .route(
            "/providers/{provider_id}/staff/{staff_id}/delete",
            post(delete_provider_staff),
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
    is_active: Option<bool>,
    city: Option<String>,
    country: Option<String>,
    fachbereich: Option<String>,
    specializations: Option<String>,
    doctor_name: Option<String>,
    doctor_fachbereich: Option<String>,
    service_name: Option<String>,
    has_contract: Option<bool>,
    rating_gte: Option<f64>,
    taxonomy_node_id: Option<Uuid>,
    taxonomy_code: Option<String>,
    taxonomy_attribute_key: Option<String>,
    taxonomy_attribute_value: Option<String>,
    internal_rating_gte: Option<f64>,
    linked_patient_id: Option<Uuid>,
    insurance_provider: Option<String>,
}

#[derive(Deserialize)]
struct ListSpecializationsQuery {
    include_inactive: Option<bool>,
}

#[derive(Deserialize)]
struct ListInsuranceProvidersQuery {
    include_inactive: Option<bool>,
}

#[derive(Deserialize)]
struct ListProviderTaxonomyQuery {
    include_inactive: Option<bool>,
    provider_type: Option<String>,
}

#[derive(Deserialize)]
struct ListStaffRolesQuery {
    include_inactive: Option<bool>,
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
    contacts: Option<Vec<UpsertProviderContactRequest>>,
    website: Option<String>,
    opening_hours: Option<String>,
    fachbereich: Option<String>,
    specializations: Option<Vec<String>>,
    insurance_providers: Option<Vec<String>>,
    parent_provider_id: Option<Uuid>,
    organization_level: Option<String>,
    taxonomy_node_id: Option<Uuid>,
    taxonomy_node_ids: Option<Vec<Uuid>>,
    primary_taxonomy_node_id: Option<Uuid>,
    taxonomy_attributes: Option<Value>,
    internal_rating: Option<f64>,
    internal_rating_note: Option<String>,
    kooperationsvertrag: Option<Value>,
    notes: Option<String>,
}

#[derive(Deserialize)]
struct UpsertDoctorRequest {
    name: Option<String>,
    shared_identity_id: Option<Uuid>,
    first_name: Option<String>,
    last_name: Option<String>,
    display_name: Option<String>,
    title: Option<String>,
    role_code: Option<String>,
    role_label: Option<String>,
    subrole: Option<String>,
    website: Option<String>,
    schwerpunkt: Option<String>,
    gender: Option<String>,
    opening_hours: Option<String>,
    fachbereich: Option<String>,
    specializations: Option<Vec<String>>,
    insurance_providers: Option<Vec<String>>,
    languages: Option<Vec<String>>,
    phone: Option<String>,
    email: Option<String>,
    contacts: Option<Vec<UpsertPersonContactRequest>>,
    license_number: Option<String>,
    licensing_country: Option<String>,
    licensing_valid_until: Option<String>,
    notes: Option<String>,
}

#[derive(Deserialize)]
struct UpsertServiceRequest {
    service_name: String,
    description: Option<String>,
    price: Option<f64>,
    price_type: Option<String>,
    price_from: Option<f64>,
    price_to: Option<f64>,
    price_note: Option<String>,
    currency: Option<String>,
    valid_from: Option<String>,
    valid_to: Option<String>,
    taxonomy_node_id: Option<Uuid>,
    taxonomy_attributes: Option<Value>,
}

#[derive(Deserialize, Clone)]
struct UpsertPersonContactRequest {
    contact_kind: String,
    contact_type: Option<String>,
    value: String,
    is_primary: Option<bool>,
    notes: Option<String>,
}

#[derive(Deserialize, Clone)]
struct UpsertProviderContactRequest {
    contact_kind: String,
    contact_type: Option<String>,
    label: Option<String>,
    department: Option<String>,
    value: String,
    is_primary: Option<bool>,
    notes: Option<String>,
}

#[derive(Deserialize)]
struct UpsertProviderStaffRequest {
    first_name: Option<String>,
    last_name: Option<String>,
    display_name: String,
    role: Option<String>,
    department: Option<String>,
    gender: Option<String>,
    opening_hours: Option<String>,
    status: Option<String>,
    notes: Option<String>,
    contacts: Option<Vec<UpsertPersonContactRequest>>,
}

#[derive(Deserialize)]
struct UpsertDoctorRelationshipRequest {
    target_doctor_id: Uuid,
    target_provider_id: Option<Uuid>,
    relationship_type: Option<String>,
    description: Option<String>,
    notes: Option<String>,
    is_active: Option<bool>,
}

#[derive(Deserialize)]
struct UpsertProviderStaffRoleRequest {
    code: Option<String>,
    name_en: String,
    name_de: Option<String>,
    name_ru: Option<String>,
    sort_order: Option<i32>,
    is_active: Option<bool>,
}

#[derive(Deserialize)]
struct UpsertSpecializationRequest {
    code: Option<String>,
    name_en: String,
    name_de: Option<String>,
    name_ru: Option<String>,
    sort_order: Option<i32>,
    is_active: Option<bool>,
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
        Role::ItAdmin,
    ]) {
        return e;
    }

    let active_only = query.active_only.unwrap_or(true);
    let is_active_filter = query.is_active;
    let search_term = normalize_optional(query.search);
    let search_pattern = format!("%{}%", search_term.clone().unwrap_or_default());
    let requested_provider_type = normalize_optional(query.provider_type);
    let city_pattern = format!("%{}%", query.city.unwrap_or_default());
    let country_pattern = format!("%{}%", query.country.unwrap_or_default());
    let fachbereich_pattern = format!("%{}%", query.fachbereich.unwrap_or_default());
    let specialization_filters = normalize_csv_list(query.specializations);
    let doctor_name_pattern = format!("%{}%", query.doctor_name.unwrap_or_default());
    let doctor_fachbereich_pattern = format!("%{}%", query.doctor_fachbereich.unwrap_or_default());
    let service_name_pattern = format!("%{}%", query.service_name.unwrap_or_default());
    let has_contract = query.has_contract;
    let rating_gte = query.rating_gte;
    let taxonomy_node_id = query.taxonomy_node_id;
    let taxonomy_code = normalize_optional(query.taxonomy_code);
    let taxonomy_attribute_key = normalize_optional(query.taxonomy_attribute_key);
    let taxonomy_attribute_value = normalize_optional(query.taxonomy_attribute_value);
    let internal_rating_gte = query.internal_rating_gte;
    let linked_patient_id = query.linked_patient_id;
    let insurance_provider_filters = normalize_csv_list(query.insurance_provider);

    if let Some(ref provider_type) = requested_provider_type
        && !is_valid_provider_type(provider_type)
    {
        return err(StatusCode::UNPROCESSABLE_ENTITY, "Invalid provider type");
    }
    let provider_type = if auth.role == Role::Concierge {
        Some("non_medical".to_string())
    } else {
        requested_provider_type
    };
    if internal_rating_gte.is_some_and(|value| !value.is_finite() || !(0.0..=5.0).contains(&value))
    {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "internal_rating_gte must be between 0 and 5",
        );
    }
    if taxonomy_attribute_key
        .as_ref()
        .is_some_and(|value| value.len() > 120)
    {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "taxonomy_attribute_key is too long",
        );
    }

    let rows = match sqlx::query(
        r#"SELECT p.id, p.name, p.provider_type, p.legal_name, p.tax_id,
                  p.address_street, p.address_city, p.address_country, p.fachbereich,
                  p.phone, p.email, p.opening_hours, p.is_active, p.created_at,
                  p.parent_provider_id, parent.name AS parent_provider_name,
                  p.organization_level,
                  p.internal_rating, p.internal_rating_note, p.taxonomy_attributes,
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
           LEFT JOIN providers parent ON parent.id = p.parent_provider_id
           WHERE ($20::bool IS NULL OR p.is_active = $20)
             AND ($20::bool IS NOT NULL OR $1::bool = false OR p.is_active = true)
             AND ($2::text IS NULL OR p.provider_type = $2)
             AND (
                $3::text = '%%'
                OR de_normalize(concat_ws(' ',
                     p.name, p.legal_name, p.tax_id,
                     p.address_city, p.address_street, p.address_zip, p.address_country,
                     p.fachbereich, p.phone, p.email, p.website,
                     p.opening_hours, p.notes, parent.name,
                     p.taxonomy_attributes::text
                   )) LIKE de_normalize($3)
                OR EXISTS (
                    SELECT 1
                    FROM jsonb_each_text(p.taxonomy_attributes) AS attr(key, value)
                    WHERE de_normalize(concat_ws(' ', attr.key, attr.value)) LIKE de_normalize($3)
                )
                OR EXISTS (
                    SELECT 1
                    FROM provider_contacts pc
                    WHERE pc.provider_id = p.id
                      AND de_normalize(concat_ws(' ',
                            pc.value, pc.label, pc.department, pc.contact_type, pc.notes
                          )) LIKE de_normalize($3)
                )
                OR EXISTS (
                    SELECT 1
                    FROM provider_specializations ps
                    JOIN medical_specializations ms ON ms.id = ps.specialization_id
                    WHERE ps.provider_id = p.id
                      AND de_normalize(concat_ws(' ', ms.name_en, ms.name_de, ms.name_ru, ms.code)) LIKE de_normalize($3)
                )
                OR EXISTS (
                    SELECT 1
                    FROM provider_insurances pi
                    JOIN insurance_providers ip ON ip.id = pi.insurance_provider_id
                    WHERE pi.provider_id = p.id
                      AND de_normalize(ip.name) LIKE de_normalize($3)
                )
                OR EXISTS (
                    SELECT 1
                    FROM provider_doctors d
                    JOIN provider_doctor_insurances di ON di.doctor_id = d.id
                    JOIN insurance_providers ip ON ip.id = di.insurance_provider_id
                    WHERE d.provider_id = p.id
                      AND de_normalize(ip.name) LIKE de_normalize($3)
                )
                OR EXISTS (
                    WITH RECURSIVE assigned_taxonomy AS (
                        SELECT ptn.id, ptn.parent_id, ptn.code, ptn.name_de, ptn.name_ru
                        FROM provider_taxonomy_assignments pta
                        JOIN provider_taxonomy_nodes ptn ON ptn.id = pta.taxonomy_node_id
                        WHERE pta.provider_id = p.id

                        UNION ALL

                        SELECT parent.id, parent.parent_id, parent.code, parent.name_de, parent.name_ru
                        FROM provider_taxonomy_nodes parent
                        JOIN assigned_taxonomy child ON child.parent_id = parent.id
                    )
                    SELECT 1
                    FROM assigned_taxonomy
                    WHERE de_normalize(concat_ws(' ', code, name_de, name_ru)) LIKE de_normalize($3)
                )
                 OR EXISTS (
                     SELECT 1
                     FROM provider_doctors d
                     WHERE d.provider_id = p.id
                       AND de_normalize(concat_ws(' ',
                             d.name, d.display_name, d.first_name, d.last_name,
                             d.fachbereich, d.title, d.role_code, d.role_label, d.subrole,
                             d.schwerpunkt, d.license_number, d.licensing_country, d.phone, d.email, d.notes
                           )) LIKE de_normalize($3)
                 )
                 OR EXISTS (
                     SELECT 1
                     FROM provider_staff staff
                     WHERE staff.provider_id = p.id
                       AND de_normalize(concat_ws(' ',
                             staff.display_name, staff.first_name, staff.last_name,
                             staff.role, staff.department, staff.status, staff.notes
                           )) LIKE de_normalize($3)
                 )
                 OR EXISTS (
                     SELECT 1
                     FROM service_catalog s
                     LEFT JOIN provider_taxonomy_nodes stn ON stn.id = s.taxonomy_node_id
                     WHERE s.provider_id = p.id
                       AND (
                         de_normalize(concat_ws(' ',
                           s.service_name, s.description, s.price_note, s.currency,
                           s.taxonomy_attributes::text,
                           stn.code, stn.name_de, stn.name_ru
                         )) LIKE de_normalize($3)
                         OR EXISTS (
                             SELECT 1
                             FROM jsonb_each_text(s.taxonomy_attributes) AS attr(key, value)
                             WHERE de_normalize(concat_ws(' ', attr.key, attr.value)) LIKE de_normalize($3)
                         )
                       )
                 )
                 OR EXISTS (
                     SELECT 1
                     FROM concierge_services cs
                     WHERE cs.provider_id = p.id
                       AND de_normalize(concat_ws(' ',
                             cs.title, cs.service_kind, cs.vendor_name, cs.vendor_contact
                           )) LIKE de_normalize($3)
                 )
             )
             AND ($4::text = '%%' OR COALESCE(p.address_city, '') ILIKE $4)
             AND ($5::text = '%%' OR COALESCE(p.address_country, '') ILIKE $5)
             AND (
                $6::text = '%%'
                OR COALESCE(p.fachbereich, '') ILIKE $6
                OR EXISTS (
                    SELECT 1
                    FROM provider_specializations ps
                    JOIN medical_specializations ms ON ms.id = ps.specialization_id
                    WHERE ps.provider_id = p.id
                      AND (
                        ms.name_en ILIKE $6
                        OR COALESCE(ms.name_de, '') ILIKE $6
                        OR COALESCE(ms.name_ru, '') ILIKE $6
                        OR ms.code ILIKE $6
                      )
                )
             )
             AND (
                cardinality($12::text[]) = 0
                OR EXISTS (
                    SELECT 1
                    FROM unnest($12::text[]) AS specialization_filter(value)
                    WHERE COALESCE(p.fachbereich, '') ILIKE ('%' || specialization_filter.value || '%')
                       OR EXISTS (
                           SELECT 1
                           FROM provider_specializations ps
                           JOIN medical_specializations ms ON ms.id = ps.specialization_id
                           WHERE ps.provider_id = p.id
                             AND (
                               ms.code = specialization_filter.value
                               OR ms.name_en ILIKE ('%' || specialization_filter.value || '%')
                               OR COALESCE(ms.name_de, '') ILIKE ('%' || specialization_filter.value || '%')
                               OR COALESCE(ms.name_ru, '') ILIKE ('%' || specialization_filter.value || '%')
                             )
                       )
                )
             )
             AND (
                $7::text = '%%'
                OR EXISTS (
                    SELECT 1
                    FROM provider_doctors d
                    WHERE d.provider_id = p.id
                      AND (
                        d.name ILIKE $7
                        OR COALESCE(d.display_name, '') ILIKE $7
                        OR COALESCE(d.first_name, '') ILIKE $7
                        OR COALESCE(d.last_name, '') ILIKE $7
                      )
                )
             )
             AND (
                $8::text = '%%'
                OR EXISTS (
                    SELECT 1
                    FROM provider_doctors d
                    WHERE d.provider_id = p.id
                      AND (
                        COALESCE(d.fachbereich, '') ILIKE $8
                        OR EXISTS (
                            SELECT 1
                            FROM provider_doctor_specializations ds
                            JOIN medical_specializations ms ON ms.id = ds.specialization_id
                            WHERE ds.doctor_id = d.id
                              AND (
                                ms.name_en ILIKE $8
                                OR COALESCE(ms.name_de, '') ILIKE $8
                                OR COALESCE(ms.name_ru, '') ILIKE $8
                                OR ms.code ILIKE $8
                              )
                        )
                      )
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
              AND (
                 $13::uuid IS NULL
                 OR EXISTS (
                    WITH RECURSIVE assigned_taxonomy AS (
                        SELECT ptn.id, ptn.parent_id, ptn.code
                        FROM provider_taxonomy_assignments pta
                        JOIN provider_taxonomy_nodes ptn ON ptn.id = pta.taxonomy_node_id
                        WHERE pta.provider_id = p.id

                        UNION ALL

                        SELECT parent.id, parent.parent_id, parent.code
                        FROM provider_taxonomy_nodes parent
                        JOIN assigned_taxonomy child ON child.parent_id = parent.id
                    )
                    SELECT 1
                    FROM assigned_taxonomy
                    WHERE id = $13
                 )
              )
              AND (
                 $14::text IS NULL
                 OR EXISTS (
                    WITH RECURSIVE assigned_taxonomy AS (
                        SELECT ptn.id, ptn.parent_id, ptn.code
                        FROM provider_taxonomy_assignments pta
                        JOIN provider_taxonomy_nodes ptn ON ptn.id = pta.taxonomy_node_id
                        WHERE pta.provider_id = p.id

                        UNION ALL

                        SELECT parent.id, parent.parent_id, parent.code
                        FROM provider_taxonomy_nodes parent
                        JOIN assigned_taxonomy child ON child.parent_id = parent.id
                    )
                    SELECT 1
                    FROM assigned_taxonomy
                    WHERE code = $14
                 )
              )
              AND (
                 $15::double precision IS NULL
                 OR COALESCE(p.internal_rating, 0) >= $15
              )
              AND (
                 $16::text IS NULL
                 OR (
                    p.taxonomy_attributes ? $16
                    AND (
                        $17::text IS NULL
                        OR (
                            $16::text = 'cuisine'
                            AND EXISTS (
                                SELECT 1
                                FROM regexp_split_to_table(
                                    COALESCE(p.taxonomy_attributes ->> $16, ''),
                                    '[,./]+'
                                ) AS cuisine_part(value)
                                WHERE de_normalize(btrim(cuisine_part.value)) LIKE de_normalize('%' || $17 || '%')
                            )
                        )
                        OR (
                            $16::text <> 'cuisine'
                            AND COALESCE(p.taxonomy_attributes ->> $16, '') ILIKE ('%' || $17 || '%')
                        )
                    )
                 )
              )
	              AND (
	                 $18::uuid IS NULL
                 OR EXISTS (
                    SELECT 1
                    FROM appointments a
                    WHERE a.provider_id = p.id
                      AND a.patient_id = $18
                 )
                 OR EXISTS (
                    SELECT 1
                    FROM order_leistungen ol
                    JOIN orders o ON o.id = ol.order_id
                    WHERE ol.provider_id = p.id
                      AND o.patient_id = $18
                 )
                 OR EXISTS (
                    SELECT 1
                    FROM concierge_services cs
                    WHERE cs.provider_id = p.id
                      AND cs.patient_id = $18
	                 )
	              )
	              AND (
	                 cardinality($21::text[]) = 0
	                 OR EXISTS (
	                     SELECT 1
	                     FROM provider_insurances pi
	                     JOIN insurance_providers ip ON ip.id = pi.insurance_provider_id
	                     WHERE pi.provider_id = p.id
	                       AND EXISTS (
	                           SELECT 1
	                           FROM unnest($21::text[]) AS wanted(value)
	                           WHERE de_normalize(ip.name) LIKE '%' || de_normalize(wanted.value) || '%'
	                       )
	                 )
	                 OR EXISTS (
	                     SELECT 1
	                     FROM provider_doctors d
	                     JOIN provider_doctor_insurances di ON di.doctor_id = d.id
	                     JOIN insurance_providers ip ON ip.id = di.insurance_provider_id
	                     WHERE d.provider_id = p.id
	                       AND EXISTS (
	                           SELECT 1
	                           FROM unnest($21::text[]) AS wanted(value)
	                           WHERE de_normalize(ip.name) LIKE '%' || de_normalize(wanted.value) || '%'
	                       )
	                 )
	              )
	            ORDER BY
              CASE
                WHEN $19::text IS NULL THEN 100
                WHEN lower(p.name) = lower($19) THEN 0
                WHEN lower(COALESCE(p.legal_name, '')) = lower($19) THEN 1
                WHEN EXISTS (
                    SELECT 1
                    FROM jsonb_each_text(p.taxonomy_attributes) AS attr(key, value)
                    WHERE lower(attr.value) = lower($19)
                       OR lower(attr.key) = lower($19)
                ) THEN 2
                WHEN EXISTS (
                    WITH RECURSIVE assigned_taxonomy AS (
                        SELECT ptn.id, ptn.parent_id, ptn.code, ptn.name_de, ptn.name_ru
                        FROM provider_taxonomy_assignments pta
                        JOIN provider_taxonomy_nodes ptn ON ptn.id = pta.taxonomy_node_id
                        WHERE pta.provider_id = p.id

                        UNION ALL

                        SELECT parent.id, parent.parent_id, parent.code, parent.name_de, parent.name_ru
                        FROM provider_taxonomy_nodes parent
                        JOIN assigned_taxonomy child ON child.parent_id = parent.id
                    )
                    SELECT 1
                    FROM assigned_taxonomy
                    WHERE lower(code) = lower($19)
                       OR lower(COALESCE(name_de, '')) = lower($19)
                       OR lower(COALESCE(name_ru, '')) = lower($19)
                ) THEN 3
                WHEN EXISTS (
                    SELECT 1
                    FROM service_catalog s
                    LEFT JOIN provider_taxonomy_nodes stn ON stn.id = s.taxonomy_node_id
                    WHERE s.provider_id = p.id
                      AND (
                        lower(s.service_name) = lower($19)
                        OR lower(COALESCE(stn.code, '')) = lower($19)
                        OR lower(COALESCE(stn.name_de, '')) = lower($19)
                        OR lower(COALESCE(stn.name_ru, '')) = lower($19)
                        OR EXISTS (
                            SELECT 1
                            FROM jsonb_each_text(s.taxonomy_attributes) AS attr(key, value)
                            WHERE lower(attr.value) = lower($19)
                               OR lower(attr.key) = lower($19)
                        )
                      )
                ) THEN 4
                WHEN lower(p.name) LIKE lower($19 || '%')
                  OR lower(COALESCE(p.legal_name, '')) LIKE lower($19 || '%') THEN 5
                WHEN p.name ILIKE $3 THEN 6
                ELSE 20
              END,
              p.name
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
    .bind(specialization_filters)
    .bind(taxonomy_node_id)
    .bind(taxonomy_code)
    .bind(internal_rating_gte)
    .bind(taxonomy_attribute_key)
    .bind(taxonomy_attribute_value)
    .bind(linked_patient_id)
    .bind(search_term)
    .bind(is_active_filter)
    .bind(insurance_provider_filters)
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
        let (specializations, taxonomy, insurance_providers) = tokio::join!(
            load_provider_specializations_json(&state, id),
            load_provider_taxonomy_json(&state, id),
            load_provider_insurances_json(&state, id),
        );
        let specializations = match specializations {
            Ok(items) => items,
            Err(resp) => return resp,
        };
        let taxonomy = match taxonomy {
            Ok(items) => items,
            Err(resp) => return resp,
        };
        let insurance_providers = match insurance_providers {
            Ok(items) => items,
            Err(resp) => return resp,
        };

        providers.push(json!({
            "id": id,
            "name": name,
            "provider_type": provider_type,
            "legal_name": row.try_get::<Option<String>, _>("legal_name").unwrap_or_default(),
            "tax_id": row.try_get::<Option<String>, _>("tax_id").unwrap_or_default(),
            "address_street": row.try_get::<Option<String>, _>("address_street").unwrap_or_default(),
            "address_city": row.try_get::<Option<String>, _>("address_city").unwrap_or_default(),
            "address_country": row.try_get::<Option<String>, _>("address_country").unwrap_or_default(),
            "fachbereich": row.try_get::<Option<String>, _>("fachbereich").unwrap_or_default(),
            "phone": row.try_get::<Option<String>, _>("phone").unwrap_or_default(),
            "email": row.try_get::<Option<String>, _>("email").unwrap_or_default(),
            "opening_hours": row.try_get::<Option<String>, _>("opening_hours").unwrap_or_default(),
            "parent_provider_id": row.try_get::<Option<Uuid>, _>("parent_provider_id").unwrap_or_default(),
            "parent_provider_name": row.try_get::<Option<String>, _>("parent_provider_name").unwrap_or_default(),
            "organization_level": row.try_get::<String, _>("organization_level").unwrap_or_else(|_| "organization".to_string()),
            "taxonomy_node_id": taxonomy.get("taxonomy_node_id").cloned().unwrap_or(Value::Null),
            "taxonomy_node": taxonomy.get("taxonomy_node").cloned().unwrap_or(Value::Null),
            "taxonomy_path": taxonomy.get("taxonomy_path").cloned().unwrap_or_else(|| json!([])),
            "taxonomy_node_ids": taxonomy.get("taxonomy_node_ids").cloned().unwrap_or_else(|| json!([])),
            "taxonomy_filter_ids": taxonomy.get("taxonomy_filter_ids").cloned().unwrap_or_else(|| json!([])),
            "taxonomy_attributes": row.try_get::<Value, _>("taxonomy_attributes").unwrap_or_else(|_| json!({})),
            "specializations": specializations,
            "insurance_providers": insurance_providers,
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
            "internal_rating": internal_rating_json(row.try_get::<Option<f64>, _>("internal_rating").unwrap_or_default()),
            "internal_rating_note": row.try_get::<Option<String>, _>("internal_rating_note").unwrap_or_default(),
            "last_interaction_at": row.try_get::<Option<chrono::DateTime<chrono::Utc>>, _>("last_interaction_at").unwrap_or_default().map(|v| v.to_rfc3339()),
        }));
    }

    Json(providers).into_response()
}

async fn list_specializations(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Query(query): Query<ListSpecializationsQuery>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[
        Role::Ceo,
        Role::PatientManager,
        Role::Concierge,
        Role::Billing,
        Role::Sales,
        Role::Patient,
        Role::ItAdmin,
    ]) {
        return e;
    }

    match load_specializations_json(&state, query.include_inactive.unwrap_or(false)).await {
        Ok(items) => Json(items).into_response(),
        Err(resp) => resp,
    }
}

async fn list_insurance_providers(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Query(query): Query<ListInsuranceProvidersQuery>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[
        Role::Ceo,
        Role::PatientManager,
        Role::Concierge,
        Role::Billing,
        Role::Sales,
        Role::Patient,
        Role::ItAdmin,
    ]) {
        return e;
    }

    match load_insurance_providers_json(&state, query.include_inactive.unwrap_or(false)).await {
        Ok(items) => Json(items).into_response(),
        Err(resp) => resp,
    }
}

async fn list_provider_taxonomy(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Query(query): Query<ListProviderTaxonomyQuery>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[
        Role::Ceo,
        Role::PatientManager,
        Role::Concierge,
        Role::Billing,
        Role::Sales,
        Role::Patient,
        Role::ItAdmin,
    ]) {
        return e;
    }

    let provider_type = normalize_optional(query.provider_type);
    if let Some(ref provider_type) = provider_type
        && !is_valid_provider_type(provider_type)
    {
        return err(StatusCode::UNPROCESSABLE_ENTITY, "Invalid provider type");
    }

    match load_provider_taxonomy_nodes_json(
        &state,
        query.include_inactive.unwrap_or(false),
        provider_type.as_deref(),
    )
    .await
    {
        Ok(items) => Json(items).into_response(),
        Err(resp) => resp,
    }
}

async fn create_specialization(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Json(body): Json<UpsertSpecializationRequest>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::Ceo, Role::PatientManager]) {
        return e;
    }

    let specialization = match normalize_specialization_payload(body, true) {
        Ok(payload) => payload,
        Err(message) => return err(StatusCode::UNPROCESSABLE_ENTITY, message),
    };
    let code = specialization
        .code
        .unwrap_or_else(|| specialization_code(&specialization.name_en));

    let row = match sqlx::query(
        r#"INSERT INTO medical_specializations (
                code, name_en, name_de, name_ru, sort_order, is_active
           ) VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (code) DO UPDATE
           SET name_en = EXCLUDED.name_en,
               name_de = EXCLUDED.name_de,
               name_ru = EXCLUDED.name_ru,
               sort_order = EXCLUDED.sort_order,
               is_active = EXCLUDED.is_active,
               deleted_at = NULL,
               updated_at = now()
           WHERE medical_specializations.deleted_at IS NOT NULL
           RETURNING id"#,
    )
    .bind(&code)
    .bind(&specialization.name_en)
    .bind(&specialization.name_de)
    .bind(&specialization.name_ru)
    .bind(specialization.sort_order)
    .bind(specialization.is_active)
    .fetch_optional(&state.db)
    .await
    {
        Ok(Some(row)) => row,
        Ok(None) => return err(StatusCode::CONFLICT, "Specialization already exists"),
        Err(e) => {
            tracing::error!(error = %e, specialization = %code, "Failed to create specialization");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to create specialization",
            );
        }
    };

    let specialization_id: Uuid = match row.try_get("id") {
        Ok(value) => value,
        Err(_) => {
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to decode specialization",
            );
        }
    };
    let _ = audit(
        &state,
        auth.user_id,
        "create_provider_specialization",
        "medical_specialization",
        Some(specialization_id),
        Some(json!({ "code": code })),
    )
    .await;

    (
        StatusCode::CREATED,
        Json(json!({ "id": specialization_id })),
    )
        .into_response()
}

async fn update_specialization(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(specialization_id): Path<Uuid>,
    Json(body): Json<UpsertSpecializationRequest>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::Ceo, Role::PatientManager]) {
        return e;
    }

    let specialization = match normalize_specialization_payload(body, false) {
        Ok(payload) => payload,
        Err(message) => return err(StatusCode::UNPROCESSABLE_ENTITY, message),
    };

    match sqlx::query(
        r#"UPDATE medical_specializations
           SET name_en = $2,
               name_de = $3,
               name_ru = $4,
               sort_order = $5,
               is_active = $6,
               updated_at = now()
           WHERE id = $1 AND deleted_at IS NULL"#,
    )
    .bind(specialization_id)
    .bind(&specialization.name_en)
    .bind(&specialization.name_de)
    .bind(&specialization.name_ru)
    .bind(specialization.sort_order)
    .bind(specialization.is_active)
    .execute(&state.db)
    .await
    {
        Ok(result) if result.rows_affected() > 0 => {}
        Ok(_) => return err(StatusCode::NOT_FOUND, "Specialization not found"),
        Err(e) => {
            tracing::error!(error = %e, specialization_id = %specialization_id, "Failed to update specialization");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to update specialization",
            );
        }
    }

    let _ = audit(
        &state,
        auth.user_id,
        "update_provider_specialization",
        "medical_specialization",
        Some(specialization_id),
        Some(json!({ "specialization_id": specialization_id })),
    )
    .await;

    Json(json!({ "ok": true })).into_response()
}

async fn activate_specialization(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(specialization_id): Path<Uuid>,
) -> axum::response::Response {
    toggle_specialization_active(state, auth, specialization_id, true).await
}

async fn deactivate_specialization(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(specialization_id): Path<Uuid>,
) -> axum::response::Response {
    toggle_specialization_active(state, auth, specialization_id, false).await
}

async fn delete_specialization(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(specialization_id): Path<Uuid>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::Ceo, Role::PatientManager]) {
        return e;
    }

    match sqlx::query(
        r#"UPDATE medical_specializations
           SET is_active = FALSE,
               deleted_at = COALESCE(deleted_at, now()),
               updated_at = now()
           WHERE id = $1 AND deleted_at IS NULL"#,
    )
    .bind(specialization_id)
    .execute(&state.db)
    .await
    {
        Ok(result) if result.rows_affected() > 0 => {}
        Ok(_) => return err(StatusCode::NOT_FOUND, "Specialization not found"),
        Err(e) => {
            tracing::error!(error = %e, specialization_id = %specialization_id, "Failed to delete specialization");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to delete specialization",
            );
        }
    }

    let _ = audit(
        &state,
        auth.user_id,
        "delete_provider_specialization",
        "medical_specialization",
        Some(specialization_id),
        Some(json!({ "specialization_id": specialization_id })),
    )
    .await;

    Json(json!({ "ok": true })).into_response()
}

async fn list_provider_staff_roles(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Query(query): Query<ListStaffRolesQuery>,
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

    match load_provider_staff_roles_json(&state, query.include_inactive.unwrap_or(false)).await {
        Ok(items) => Json(items).into_response(),
        Err(resp) => resp,
    }
}

async fn create_provider_staff_role(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Json(body): Json<UpsertProviderStaffRoleRequest>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::Ceo, Role::PatientManager]) {
        return e;
    }

    let role = match normalize_provider_staff_role_payload(body, true) {
        Ok(payload) => payload,
        Err(message) => return err(StatusCode::UNPROCESSABLE_ENTITY, message),
    };
    let code = role.code.unwrap_or_else(|| staff_role_code(&role.name_en));

    let row = match sqlx::query(
        r#"INSERT INTO provider_staff_roles (
                code, name_en, name_de, name_ru, sort_order, is_active
           ) VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING id"#,
    )
    .bind(&code)
    .bind(&role.name_en)
    .bind(&role.name_de)
    .bind(&role.name_ru)
    .bind(role.sort_order)
    .bind(role.is_active)
    .fetch_one(&state.db)
    .await
    {
        Ok(row) => row,
        Err(e) if is_unique_violation(&e) => {
            return err(StatusCode::CONFLICT, "Provider staff role already exists");
        }
        Err(e) => {
            tracing::error!(error = %e, role = %code, "Failed to create provider staff role");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to create provider staff role",
            );
        }
    };

    let role_id: Uuid = match row.try_get("id") {
        Ok(value) => value,
        Err(_) => {
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to decode staff role",
            );
        }
    };
    let _ = audit(
        &state,
        auth.user_id,
        "create_provider_staff_role",
        "provider_staff_role",
        Some(role_id),
        Some(json!({ "code": code })),
    )
    .await;

    (StatusCode::CREATED, Json(json!({ "id": role_id }))).into_response()
}

async fn update_provider_staff_role(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(role_id): Path<Uuid>,
    Json(body): Json<UpsertProviderStaffRoleRequest>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::Ceo, Role::PatientManager]) {
        return e;
    }

    let role = match normalize_provider_staff_role_payload(body, false) {
        Ok(payload) => payload,
        Err(message) => return err(StatusCode::UNPROCESSABLE_ENTITY, message),
    };

    match sqlx::query(
        r#"UPDATE provider_staff_roles
           SET name_en = $2,
               name_de = $3,
               name_ru = $4,
               sort_order = $5,
               is_active = $6,
               updated_at = now()
           WHERE id = $1"#,
    )
    .bind(role_id)
    .bind(&role.name_en)
    .bind(&role.name_de)
    .bind(&role.name_ru)
    .bind(role.sort_order)
    .bind(role.is_active)
    .execute(&state.db)
    .await
    {
        Ok(result) if result.rows_affected() > 0 => {}
        Ok(_) => return err(StatusCode::NOT_FOUND, "Provider staff role not found"),
        Err(e) => {
            tracing::error!(error = %e, role_id = %role_id, "Failed to update provider staff role");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to update provider staff role",
            );
        }
    }

    let _ = audit(
        &state,
        auth.user_id,
        "update_provider_staff_role",
        "provider_staff_role",
        Some(role_id),
        Some(json!({ "role_id": role_id })),
    )
    .await;

    Json(json!({ "ok": true })).into_response()
}

async fn activate_provider_staff_role(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(role_id): Path<Uuid>,
) -> axum::response::Response {
    toggle_provider_staff_role_active(state, auth, role_id, true).await
}

async fn deactivate_provider_staff_role(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(role_id): Path<Uuid>,
) -> axum::response::Response {
    toggle_provider_staff_role_active(state, auth, role_id, false).await
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
    if let Err(resp) = validate_provider_parent(&state, None, provider.parent_provider_id).await {
        return resp;
    }
    let specializations = provider.specializations.clone();
    let insurance_providers = provider.insurance_providers.clone();
    let contacts = provider.contacts.clone();
    let taxonomy_node_ids = provider.taxonomy_node_ids.clone();
    let primary_taxonomy_node_id = provider.primary_taxonomy_node_id;
    let provider_type = provider.provider_type.clone();
    if let Some(ref values) = taxonomy_node_ids
        && let Err(resp) = validate_provider_taxonomy_nodes(&state, &provider_type, values).await
    {
        return resp;
    }

    let mut tx = match state.db.begin().await {
        Ok(tx) => tx,
        Err(e) => {
            tracing::error!(error = %e, "Failed to start provider create transaction");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to create provider",
            );
        }
    };

    let row = match sqlx::query(
        r#"INSERT INTO providers (
                name, provider_type, legal_name, tax_id,
                address_street, address_city, address_zip, address_country,
                phone, email, website, fachbereich, parent_provider_id, organization_level,
                opening_hours, taxonomy_attributes, internal_rating, internal_rating_note,
                kooperationsvertrag, notes
           ) VALUES (
                $1, $2, $3, $4,
                $5, $6, $7, $8,
                $9, $10, $11, $12, $13, $14,
                $15, $16, $17, $18,
                $19, $20
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
    .bind(provider.parent_provider_id)
    .bind(provider.organization_level)
    .bind(provider.opening_hours)
    .bind(provider.taxonomy_attributes.unwrap_or_else(|| json!({})))
    .bind(provider.internal_rating)
    .bind(provider.internal_rating_note)
    .bind(provider.kooperationsvertrag)
    .bind(provider.notes)
    .fetch_one(&mut *tx)
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
    if let Some(values) = specializations
        && let Err(resp) =
            sync_provider_specializations_tx(&mut tx, provider_id, &provider_type, &values).await
    {
        return resp;
    }
    if let Some(values) = insurance_providers
        && let Err(resp) =
            sync_provider_insurances_tx(&mut tx, provider_id, &provider_type, &values).await
    {
        return resp;
    }
    if let Some(values) = taxonomy_node_ids {
        if let Err(resp) =
            sync_provider_taxonomy_tx(&mut tx, provider_id, &values, primary_taxonomy_node_id).await
        {
            return resp;
        }
    } else if let Err(resp) =
        ensure_provider_taxonomy_for_type_tx(&mut tx, provider_id, &provider_type).await
    {
        return resp;
    }
    if let Some(values) = contacts
        && let Err(resp) = replace_provider_contacts_tx(&mut tx, provider_id, &values).await
    {
        return resp;
    }
    if let Err(e) = tx.commit().await {
        tracing::error!(error = %e, provider_id = %provider_id, "Failed to commit provider create transaction");
        return err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to create provider",
        );
    }

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
                  address_country, phone, email, website, opening_hours, fachbereich, kooperationsvertrag, notes,
                  parent_provider_id,
                  (SELECT name FROM providers parent WHERE parent.id = providers.parent_provider_id) AS parent_provider_name,
                  organization_level,
                  taxonomy_attributes, internal_rating, internal_rating_note,
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
    let provider_type = provider
        .try_get::<String, _>("provider_type")
        .unwrap_or_default();
    if auth.role == Role::Concierge && provider_type != "non_medical" {
        return err(StatusCode::FORBIDDEN, "Provider is outside concierge scope");
    }

    let (
        doctors,
        services,
        linked_patients,
        interactions,
        templates,
        specializations,
        insurance_providers,
        provider_contacts,
        staff,
        children,
        taxonomy,
    ) = tokio::join!(
        load_doctors_json(&state, provider_id),
        load_services_json(&state, provider_id),
        load_provider_patients_json(&state, provider_id, None),
        load_provider_interactions_json(&state, provider_id, None),
        load_provider_templates_json(&state, provider_id),
        load_provider_specializations_json(&state, provider_id),
        load_provider_insurances_json(&state, provider_id),
        load_provider_contacts_json(
            &state,
            provider_id,
            provider
                .try_get::<Option<String>, _>("phone")
                .unwrap_or_default(),
            provider
                .try_get::<Option<String>, _>("email")
                .unwrap_or_default(),
        ),
        load_provider_staff_json(&state, provider_id),
        load_provider_children_json(&state, provider_id),
        load_provider_taxonomy_json(&state, provider_id),
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
    let specializations = match specializations {
        Ok(items) => items,
        Err(resp) => return resp,
    };
    let insurance_providers = match insurance_providers {
        Ok(items) => items,
        Err(resp) => return resp,
    };
    let provider_contacts = match provider_contacts {
        Ok(items) => items,
        Err(resp) => return resp,
    };
    let staff = match staff {
        Ok(items) => items,
        Err(resp) => return resp,
    };
    let children = match children {
        Ok(items) => items,
        Err(resp) => return resp,
    };
    let taxonomy = match taxonomy {
        Ok(items) => items,
        Err(resp) => return resp,
    };

    Json(json!({
        "id": provider.try_get::<Uuid, _>("id").unwrap_or(provider_id),
        "name": provider.try_get::<String, _>("name").unwrap_or_default(),
        "provider_type": provider_type,
        "legal_name": provider.try_get::<Option<String>, _>("legal_name").unwrap_or_default(),
        "tax_id": provider.try_get::<Option<String>, _>("tax_id").unwrap_or_default(),
        "address_street": provider.try_get::<Option<String>, _>("address_street").unwrap_or_default(),
        "address_city": provider.try_get::<Option<String>, _>("address_city").unwrap_or_default(),
        "address_zip": provider.try_get::<Option<String>, _>("address_zip").unwrap_or_default(),
        "address_country": provider.try_get::<Option<String>, _>("address_country").unwrap_or_default(),
        "phone": provider.try_get::<Option<String>, _>("phone").unwrap_or_default(),
        "email": provider.try_get::<Option<String>, _>("email").unwrap_or_default(),
        "contacts": provider_contacts,
        "website": provider.try_get::<Option<String>, _>("website").unwrap_or_default(),
        "opening_hours": provider.try_get::<Option<String>, _>("opening_hours").unwrap_or_default(),
        "fachbereich": provider.try_get::<Option<String>, _>("fachbereich").unwrap_or_default(),
        "specializations": specializations,
        "insurance_providers": insurance_providers,
        "parent_provider_id": provider.try_get::<Option<Uuid>, _>("parent_provider_id").unwrap_or_default(),
        "parent_provider_name": provider.try_get::<Option<String>, _>("parent_provider_name").unwrap_or_default(),
        "organization_level": provider.try_get::<String, _>("organization_level").unwrap_or_else(|_| "organization".to_string()),
        "taxonomy_node_id": taxonomy.get("taxonomy_node_id").cloned().unwrap_or(Value::Null),
        "taxonomy_node": taxonomy.get("taxonomy_node").cloned().unwrap_or(Value::Null),
        "taxonomy_path": taxonomy.get("taxonomy_path").cloned().unwrap_or_else(|| json!([])),
        "taxonomy_node_ids": taxonomy.get("taxonomy_node_ids").cloned().unwrap_or_else(|| json!([])),
        "taxonomy_filter_ids": taxonomy.get("taxonomy_filter_ids").cloned().unwrap_or_else(|| json!([])),
        "taxonomy_attributes": provider.try_get::<Value, _>("taxonomy_attributes").unwrap_or_else(|_| json!({})),
        "kooperationsvertrag": provider.try_get::<Option<Value>, _>("kooperationsvertrag").unwrap_or_default(),
        "internal_rating": internal_rating_json(provider.try_get::<Option<f64>, _>("internal_rating").unwrap_or_default()),
        "internal_rating_note": provider.try_get::<Option<String>, _>("internal_rating_note").unwrap_or_default(),
        "notes": provider.try_get::<Option<String>, _>("notes").unwrap_or_default(),
        "is_active": provider.try_get::<bool, _>("is_active").unwrap_or(true),
        "created_at": provider.try_get::<chrono::DateTime<chrono::Utc>, _>("created_at").map(|v| v.to_rfc3339()).unwrap_or_default(),
        "updated_at": provider.try_get::<chrono::DateTime<chrono::Utc>, _>("updated_at").map(|v| v.to_rfc3339()).unwrap_or_default(),
        "doctors": doctors,
        "services": services,
        "staff": staff,
        "children": children,
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
    if let Err(resp) =
        validate_provider_parent(&state, Some(provider_id), provider.parent_provider_id).await
    {
        return resp;
    }
    let specializations = provider.specializations.clone();
    let insurance_providers = provider.insurance_providers.clone();
    let contacts = provider.contacts.clone();
    let taxonomy_node_ids = provider.taxonomy_node_ids.clone();
    let primary_taxonomy_node_id = provider.primary_taxonomy_node_id;
    let provider_type = provider.provider_type.clone();
    if let Some(ref values) = taxonomy_node_ids
        && let Err(resp) = validate_provider_taxonomy_nodes(&state, &provider_type, values).await
    {
        return resp;
    }

    let mut tx = match state.db.begin().await {
        Ok(tx) => tx,
        Err(e) => {
            tracing::error!(error = %e, provider_id = %provider_id, "Failed to start provider update transaction");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to update provider",
            );
        }
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
               parent_provider_id = $14,
               organization_level = $15,
               opening_hours = $16,
               kooperationsvertrag = $17,
               notes = $18,
               taxonomy_attributes = COALESCE($19, taxonomy_attributes),
               internal_rating = COALESCE($20, internal_rating),
               internal_rating_note = COALESCE($21, internal_rating_note),
               updated_at = now()
           WHERE id = $1
           RETURNING id"#,
    )
    .bind(provider_id)
    .bind(provider.name)
    .bind(&provider.provider_type)
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
    .bind(provider.parent_provider_id)
    .bind(provider.organization_level)
    .bind(provider.opening_hours)
    .bind(provider.kooperationsvertrag)
    .bind(provider.notes)
    .bind(provider.taxonomy_attributes)
    .bind(provider.internal_rating)
    .bind(provider.internal_rating_note)
    .fetch_optional(&mut *tx)
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
    if provider_type == "non_medical" {
        if let Err(resp) =
            sync_provider_specializations_tx(&mut tx, updated_id, &provider_type, &[]).await
        {
            return resp;
        }
        if let Err(resp) =
            sync_provider_insurances_tx(&mut tx, updated_id, &provider_type, &[]).await
        {
            return resp;
        }
        if let Err(resp) = clear_provider_doctor_specializations_tx(&mut tx, updated_id).await {
            return resp;
        }
        if let Err(resp) = clear_provider_doctor_insurances_tx(&mut tx, updated_id).await {
            return resp;
        }
    } else if let Some(values) = specializations
        && let Err(resp) =
            sync_provider_specializations_tx(&mut tx, updated_id, &provider_type, &values).await
    {
        return resp;
    }
    if provider_type != "non_medical"
        && let Some(values) = insurance_providers
        && let Err(resp) =
            sync_provider_insurances_tx(&mut tx, updated_id, &provider_type, &values).await
    {
        return resp;
    }
    if let Some(values) = taxonomy_node_ids {
        if let Err(resp) =
            sync_provider_taxonomy_tx(&mut tx, updated_id, &values, primary_taxonomy_node_id).await
        {
            return resp;
        }
    } else if let Err(resp) =
        ensure_provider_taxonomy_for_type_tx(&mut tx, updated_id, &provider_type).await
    {
        return resp;
    }
    if let Some(values) = contacts
        && let Err(resp) = replace_provider_contacts_tx(&mut tx, updated_id, &values).await
    {
        return resp;
    }
    if let Err(e) = tx.commit().await {
        tracing::error!(error = %e, provider_id = %updated_id, "Failed to commit provider update transaction");
        return err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to update provider",
        );
    }

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

async fn list_doctor_relationships(
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

    match load_doctor_relationships_json(&state, doctor_id).await {
        Ok(items) => Json(items).into_response(),
        Err(resp) => resp,
    }
}

async fn create_doctor_relationship(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path((provider_id, doctor_id)): Path<(Uuid, Uuid)>,
    Json(body): Json<UpsertDoctorRelationshipRequest>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::Ceo, Role::PatientManager]) {
        return e;
    }

    if let Err(resp) = ensure_doctor_belongs_to_provider(&state, provider_id, doctor_id).await {
        return resp;
    }
    let relationship = match normalize_doctor_relationship_payload(body) {
        Ok(payload) => payload,
        Err(message) => return err(StatusCode::UNPROCESSABLE_ENTITY, message),
    };
    let target_provider_id = match ensure_doctor_relationship_target(
        &state,
        doctor_id,
        relationship.target_doctor_id,
        relationship.target_provider_id,
    )
    .await
    {
        Ok(target_provider_id) => target_provider_id,
        Err(resp) => return resp,
    };

    let mut tx = match state.db.begin().await {
        Ok(tx) => tx,
        Err(e) => {
            tracing::error!(error = %e, provider_id = %provider_id, doctor_id = %doctor_id, "Failed to begin doctor relationship create");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to create doctor relationship",
            );
        }
    };

    let relationship_id = match sync_doctor_relationship_row(&mut tx, doctor_id, &relationship)
        .await
    {
        Ok(id) => id,
        Err(e) => {
            tracing::error!(error = %e, provider_id = %provider_id, doctor_id = %doctor_id, "Failed to create doctor relationship");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to create doctor relationship",
            );
        }
    };
    let reciprocal = relationship.reciprocal(doctor_id);
    if let Err(e) =
        sync_doctor_relationship_row(&mut tx, relationship.target_doctor_id, &reciprocal).await
    {
        tracing::error!(error = %e, provider_id = %provider_id, doctor_id = %doctor_id, target_doctor_id = %relationship.target_doctor_id, "Failed to create reciprocal doctor relationship");
        return err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to create doctor relationship",
        );
    }

    if let Err(e) = tx.commit().await {
        tracing::error!(error = %e, provider_id = %provider_id, doctor_id = %doctor_id, "Failed to commit doctor relationship create");
        return err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to create doctor relationship",
        );
    }

    let relationship_id = Some(relationship_id);
    let _ = audit(
        &state,
        auth.user_id,
        "create_provider_doctor_relationship",
        "provider_doctor_relationship",
        relationship_id,
        Some(json!({
            "provider_id": provider_id,
            "doctor_id": doctor_id,
            "target_doctor_id": relationship.target_doctor_id
        })),
    )
    .await;
    crate::realtime::publish_provider_event(
        &state,
        Some(auth.user_id),
        "provider.doctor_relationship_created",
        provider_id,
        json!({ "provider_id": provider_id, "doctor_id": doctor_id }),
    )
    .await;
    if target_provider_id != provider_id {
        crate::realtime::publish_provider_event(
            &state,
            Some(auth.user_id),
            "provider.doctor_relationship_created",
            target_provider_id,
            json!({ "provider_id": target_provider_id, "doctor_id": relationship.target_doctor_id }),
        )
        .await;
    }

    (StatusCode::CREATED, Json(json!({ "id": relationship_id }))).into_response()
}

async fn update_doctor_relationship(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path((provider_id, doctor_id, relationship_id)): Path<(Uuid, Uuid, Uuid)>,
    Json(body): Json<UpsertDoctorRelationshipRequest>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::Ceo, Role::PatientManager]) {
        return e;
    }

    if let Err(resp) = ensure_doctor_belongs_to_provider(&state, provider_id, doctor_id).await {
        return resp;
    }
    let relationship = match normalize_doctor_relationship_payload(body) {
        Ok(payload) => payload,
        Err(message) => return err(StatusCode::UNPROCESSABLE_ENTITY, message),
    };
    let target_provider_id = match ensure_doctor_relationship_target(
        &state,
        doctor_id,
        relationship.target_doctor_id,
        relationship.target_provider_id,
    )
    .await
    {
        Ok(target_provider_id) => target_provider_id,
        Err(resp) => return resp,
    };

    let mut tx = match state.db.begin().await {
        Ok(tx) => tx,
        Err(e) => {
            tracing::error!(error = %e, provider_id = %provider_id, doctor_id = %doctor_id, relationship_id = %relationship_id, "Failed to begin doctor relationship update");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to update doctor relationship",
            );
        }
    };
    let previous = match sqlx::query(
        r#"SELECT target_doctor_id, relationship_type
           FROM provider_doctor_relationships
           WHERE source_doctor_id = $1 AND id = $2
           FOR UPDATE"#,
    )
    .bind(doctor_id)
    .bind(relationship_id)
    .fetch_optional(&mut *tx)
    .await
    {
        Ok(Some(row)) => row,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Doctor relationship not found"),
        Err(e) => {
            tracing::error!(error = %e, provider_id = %provider_id, doctor_id = %doctor_id, relationship_id = %relationship_id, "Failed to load doctor relationship for update");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to update doctor relationship",
            );
        }
    };
    let previous_target_doctor_id = previous
        .try_get::<Uuid, _>("target_doctor_id")
        .unwrap_or(relationship.target_doctor_id);
    let previous_relationship_type = previous
        .try_get::<String, _>("relationship_type")
        .unwrap_or_else(|_| relationship.relationship_type.clone());

    match sqlx::query(
        r#"UPDATE provider_doctor_relationships
           SET target_doctor_id = $3,
               relationship_type = $4,
               description = $5,
               notes = $6,
               is_active = $7,
               updated_at = now()
           WHERE source_doctor_id = $1 AND id = $2"#,
    )
    .bind(doctor_id)
    .bind(relationship_id)
    .bind(relationship.target_doctor_id)
    .bind(&relationship.relationship_type)
    .bind(&relationship.description)
    .bind(&relationship.notes)
    .bind(relationship.is_active)
    .execute(&mut *tx)
    .await
    {
        Ok(result) if result.rows_affected() > 0 => {}
        Ok(_) => return err(StatusCode::NOT_FOUND, "Doctor relationship not found"),
        Err(e) if is_unique_violation(&e) => {
            return err(StatusCode::CONFLICT, "Doctor relationship already exists");
        }
        Err(e) => {
            tracing::error!(error = %e, provider_id = %provider_id, doctor_id = %doctor_id, relationship_id = %relationship_id, "Failed to update doctor relationship");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to update doctor relationship",
            );
        }
    }
    if previous_target_doctor_id != relationship.target_doctor_id
        || previous_relationship_type != relationship.relationship_type
    {
        if let Err(e) = sqlx::query(
            r#"DELETE FROM provider_doctor_relationships
               WHERE source_doctor_id = $1
                 AND target_doctor_id = $2
                 AND relationship_type = $3"#,
        )
        .bind(previous_target_doctor_id)
        .bind(doctor_id)
        .bind(previous_relationship_type)
        .execute(&mut *tx)
        .await
        {
            tracing::error!(error = %e, provider_id = %provider_id, doctor_id = %doctor_id, relationship_id = %relationship_id, "Failed to delete stale reciprocal doctor relationship");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to update doctor relationship",
            );
        }
    }
    let reciprocal = relationship.reciprocal(doctor_id);
    if let Err(e) =
        sync_doctor_relationship_row(&mut tx, relationship.target_doctor_id, &reciprocal).await
    {
        if is_unique_violation(&e) {
            return err(StatusCode::CONFLICT, "Doctor relationship already exists");
        }
        tracing::error!(error = %e, provider_id = %provider_id, doctor_id = %doctor_id, relationship_id = %relationship_id, "Failed to update reciprocal doctor relationship");
        return err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to update doctor relationship",
        );
    }

    if let Err(e) = tx.commit().await {
        tracing::error!(error = %e, provider_id = %provider_id, doctor_id = %doctor_id, relationship_id = %relationship_id, "Failed to commit doctor relationship update");
        return err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to update doctor relationship",
        );
    }

    let _ = audit(
        &state,
        auth.user_id,
        "update_provider_doctor_relationship",
        "provider_doctor_relationship",
        Some(relationship_id),
        Some(json!({ "provider_id": provider_id, "doctor_id": doctor_id })),
    )
    .await;
    crate::realtime::publish_provider_event(
        &state,
        Some(auth.user_id),
        "provider.doctor_relationship_updated",
        provider_id,
        json!({ "provider_id": provider_id, "doctor_id": doctor_id }),
    )
    .await;
    if target_provider_id != provider_id {
        crate::realtime::publish_provider_event(
            &state,
            Some(auth.user_id),
            "provider.doctor_relationship_updated",
            target_provider_id,
            json!({ "provider_id": target_provider_id, "doctor_id": relationship.target_doctor_id }),
        )
        .await;
    }

    Json(json!({ "ok": true })).into_response()
}

async fn delete_doctor_relationship(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path((provider_id, doctor_id, relationship_id)): Path<(Uuid, Uuid, Uuid)>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::Ceo, Role::PatientManager]) {
        return e;
    }

    if let Err(resp) = ensure_doctor_belongs_to_provider(&state, provider_id, doctor_id).await {
        return resp;
    }

    let mut tx = match state.db.begin().await {
        Ok(tx) => tx,
        Err(e) => {
            tracing::error!(error = %e, provider_id = %provider_id, doctor_id = %doctor_id, relationship_id = %relationship_id, "Failed to begin doctor relationship delete");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to delete doctor relationship",
            );
        }
    };
    let deleted = match sqlx::query(
        r#"DELETE FROM provider_doctor_relationships r
           USING provider_doctors target
           WHERE r.source_doctor_id = $1
             AND r.id = $2
             AND target.id = r.target_doctor_id
           RETURNING r.target_doctor_id, r.relationship_type, target.provider_id AS target_provider_id"#,
    )
    .bind(doctor_id)
    .bind(relationship_id)
    .fetch_optional(&mut *tx)
    .await
    {
        Ok(Some(row)) => row,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Doctor relationship not found"),
        Err(e) => {
            tracing::error!(error = %e, provider_id = %provider_id, doctor_id = %doctor_id, relationship_id = %relationship_id, "Failed to delete doctor relationship");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to delete doctor relationship",
            );
        }
    };
    let target_doctor_id = deleted
        .try_get::<Uuid, _>("target_doctor_id")
        .unwrap_or_default();
    let target_provider_id = deleted
        .try_get::<Uuid, _>("target_provider_id")
        .unwrap_or(provider_id);
    let relationship_type = deleted
        .try_get::<String, _>("relationship_type")
        .unwrap_or_else(|_| "professional".to_string());
    if let Err(e) = sqlx::query(
        r#"DELETE FROM provider_doctor_relationships
           WHERE source_doctor_id = $1
             AND target_doctor_id = $2
             AND relationship_type = $3"#,
    )
    .bind(target_doctor_id)
    .bind(doctor_id)
    .bind(relationship_type)
    .execute(&mut *tx)
    .await
    {
        tracing::error!(error = %e, provider_id = %provider_id, doctor_id = %doctor_id, relationship_id = %relationship_id, "Failed to delete reciprocal doctor relationship");
        return err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to delete doctor relationship",
        );
    }
    if let Err(e) = tx.commit().await {
        tracing::error!(error = %e, provider_id = %provider_id, doctor_id = %doctor_id, relationship_id = %relationship_id, "Failed to commit doctor relationship delete");
        return err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to delete doctor relationship",
        );
    }

    let _ = audit(
        &state,
        auth.user_id,
        "delete_provider_doctor_relationship",
        "provider_doctor_relationship",
        Some(relationship_id),
        Some(json!({ "provider_id": provider_id, "doctor_id": doctor_id })),
    )
    .await;
    crate::realtime::publish_provider_event(
        &state,
        Some(auth.user_id),
        "provider.doctor_relationship_deleted",
        provider_id,
        json!({ "provider_id": provider_id, "doctor_id": doctor_id }),
    )
    .await;
    if target_provider_id != provider_id {
        crate::realtime::publish_provider_event(
            &state,
            Some(auth.user_id),
            "provider.doctor_relationship_deleted",
            target_provider_id,
            json!({ "provider_id": target_provider_id, "doctor_id": target_doctor_id }),
        )
        .await;
    }

    StatusCode::NO_CONTENT.into_response()
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
        r#"SELECT d.id, d.provider_id, d.shared_identity_id, d.name, d.first_name, d.last_name, d.display_name,
                  d.title, d.role_code, d.role_label, d.subrole, d.website, d.schwerpunkt, d.gender, d.opening_hours,
                  d.fachbereich, d.languages,
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
            let (specializations, insurance_providers) = tokio::join!(
                load_doctor_specializations_json(&state, doctor_id),
                load_doctor_insurances_json(&state, doctor_id),
            );
            let specializations = match specializations {
                Ok(items) => items,
                Err(resp) => return resp,
            };
            let insurance_providers = match insurance_providers {
                Ok(items) => items,
                Err(resp) => return resp,
            };
            let contacts = match load_person_contacts_json(
                &state,
                provider_id,
                Some(doctor_id),
                None,
                row.try_get::<Option<String>, _>("phone")
                    .unwrap_or_default(),
                row.try_get::<Option<String>, _>("email")
                    .unwrap_or_default(),
            )
            .await
            {
                Ok(items) => items,
                Err(resp) => return resp,
            };
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
            let relationships = match load_doctor_relationships_json(&state, doctor_id).await {
                Ok(items) => items,
                Err(resp) => return resp,
            };

            Json(json!({
                "id": row.try_get::<Uuid, _>("id").unwrap_or(doctor_id),
                "provider_id": row.try_get::<Uuid, _>("provider_id").unwrap_or(provider_id),
                "shared_identity_id": row.try_get::<Uuid, _>("shared_identity_id").unwrap_or(doctor_id),
                "name": row.try_get::<String, _>("name").unwrap_or_default(),
                "first_name": row.try_get::<Option<String>, _>("first_name").unwrap_or_default(),
                "last_name": row.try_get::<Option<String>, _>("last_name").unwrap_or_default(),
                "display_name": row.try_get::<Option<String>, _>("display_name").unwrap_or_default(),
                "title": row.try_get::<Option<String>, _>("title").unwrap_or_default(),
                "role_code": row.try_get::<Option<String>, _>("role_code").unwrap_or_default(),
                "role_label": row.try_get::<Option<String>, _>("role_label").unwrap_or_default(),
                "subrole": row.try_get::<Option<String>, _>("subrole").unwrap_or_default(),
                "website": row.try_get::<Option<String>, _>("website").unwrap_or_default(),
                "schwerpunkt": row.try_get::<Option<String>, _>("schwerpunkt").unwrap_or_default(),
                "gender": row.try_get::<String, _>("gender").unwrap_or_else(|_| "unknown".to_string()),
                "opening_hours": row.try_get::<Option<String>, _>("opening_hours").unwrap_or_default(),
                "fachbereich": row.try_get::<Option<String>, _>("fachbereich").unwrap_or_default(),
                "specializations": specializations,
                "insurance_providers": insurance_providers,
                "languages": row.try_get::<Vec<String>, _>("languages").unwrap_or_default(),
                "phone": row.try_get::<Option<String>, _>("phone").unwrap_or_default(),
                "email": row.try_get::<Option<String>, _>("email").unwrap_or_default(),
                "contacts": contacts,
                "license_number": row.try_get::<Option<String>, _>("license_number").unwrap_or_default(),
                "licensing_country": row.try_get::<Option<String>, _>("licensing_country").unwrap_or_default(),
                "licensing_valid_until": row.try_get::<Option<chrono::NaiveDate>, _>("licensing_valid_until").unwrap_or_default().map(|v| v.to_string()),
                "notes": row.try_get::<Option<String>, _>("notes").unwrap_or_default(),
                "patient_count": row.try_get::<i64, _>("patient_count").unwrap_or_default(),
                "appointment_count": row.try_get::<i64, _>("appointment_count").unwrap_or_default(),
                "created_at": row.try_get::<chrono::DateTime<chrono::Utc>, _>("created_at").map(|v| v.to_rfc3339()).unwrap_or_default(),
                "relationships": relationships,
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

async fn resolve_doctor_shared_identity(
    state: &AppState,
    requested_identity_id: Option<Uuid>,
) -> Result<Uuid, axum::response::Response> {
    let Some(requested_identity_id) = requested_identity_id else {
        return Ok(Uuid::new_v4());
    };

    match sqlx::query_scalar::<_, Uuid>(
        r#"SELECT shared_identity_id
           FROM provider_doctors
           WHERE id = $1 OR shared_identity_id = $1
           ORDER BY CASE WHEN id = $1 THEN 0 ELSE 1 END
           LIMIT 1"#,
    )
    .bind(requested_identity_id)
    .fetch_optional(&state.db)
    .await
    {
        Ok(Some(shared_identity_id)) => Ok(shared_identity_id),
        Ok(None) => Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Shared doctor identity not found",
        )),
        Err(e) => {
            tracing::error!(error = %e, shared_identity_id = %requested_identity_id, "Failed to resolve doctor shared identity");
            Err(err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to resolve doctor shared identity",
            ))
        }
    }
}

async fn ensure_doctor_identity_not_linked_to_provider(
    state: &AppState,
    provider_id: Uuid,
    shared_identity_id: Uuid,
) -> Result<(), axum::response::Response> {
    match sqlx::query_scalar::<_, Uuid>(
        r#"SELECT id
           FROM provider_doctors
           WHERE provider_id = $1 AND shared_identity_id = $2
           LIMIT 1"#,
    )
    .bind(provider_id)
    .bind(shared_identity_id)
    .fetch_optional(&state.db)
    .await
    {
        Ok(Some(_)) => Err(err(
            StatusCode::CONFLICT,
            "Doctor is already linked to this provider",
        )),
        Ok(None) => Ok(()),
        Err(e) => {
            tracing::error!(error = %e, provider_id = %provider_id, shared_identity_id = %shared_identity_id, "Failed to validate doctor shared identity");
            Err(err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to validate doctor shared identity",
            ))
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

    let provider_type = match load_provider_type(&state, provider_id).await {
        Ok(value) => value,
        Err(resp) => return resp,
    };

    let doctor = match normalize_doctor_payload(body) {
        Ok(payload) => payload,
        Err(message) => return err(StatusCode::UNPROCESSABLE_ENTITY, message),
    };
    if let Err(message) = validate_new_doctor_title(doctor.title.as_deref()) {
        return err(StatusCode::UNPROCESSABLE_ENTITY, message);
    }
    let specializations = doctor.specializations.clone();
    let insurance_providers = doctor.insurance_providers.clone();
    let contacts = doctor.contacts.clone();
    if provider_type == "non_medical"
        && specializations
            .as_ref()
            .is_some_and(|values| !values.is_empty())
    {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Doctor specializations are only allowed for medical providers",
        );
    }
    if provider_type == "non_medical"
        && insurance_providers
            .as_ref()
            .is_some_and(|values| !values.is_empty())
    {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Doctor insurance providers are only allowed for medical providers",
        );
    }
    let shared_identity_id =
        match resolve_doctor_shared_identity(&state, doctor.shared_identity_id).await {
            Ok(value) => value,
            Err(resp) => return resp,
        };
    if let Err(resp) =
        ensure_doctor_identity_not_linked_to_provider(&state, provider_id, shared_identity_id).await
    {
        return resp;
    }

    let mut tx = match state.db.begin().await {
        Ok(tx) => tx,
        Err(e) => {
            tracing::error!(error = %e, provider_id = %provider_id, "Failed to start doctor create transaction");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to create doctor");
        }
    };

    let row = match sqlx::query(
        r#"INSERT INTO provider_doctors (
                provider_id, shared_identity_id, name, first_name, last_name, display_name,
                title, role_code, role_label, subrole, website, schwerpunkt, gender, opening_hours, fachbereich, languages,
                phone, email, license_number, licensing_country, licensing_valid_until, notes
           ) VALUES (
                $1, $2, $3, $4, $5, $6,
                $7, $8, $9, $10, $11, $12, $13, $14, $15, $16,
                $17, $18, $19, $20, $21, $22
           )
           RETURNING id, created_at"#,
    )
    .bind(provider_id)
    .bind(shared_identity_id)
    .bind(doctor.name)
    .bind(doctor.first_name)
    .bind(doctor.last_name)
    .bind(doctor.display_name)
    .bind(doctor.title)
    .bind(doctor.role_code)
    .bind(doctor.role_label)
    .bind(doctor.subrole)
    .bind(doctor.website)
    .bind(doctor.schwerpunkt)
    .bind(doctor.gender)
    .bind(doctor.opening_hours)
    .bind(doctor.fachbereich)
    .bind(doctor.languages)
    .bind(doctor.phone)
    .bind(doctor.email)
    .bind(doctor.license_number)
    .bind(doctor.licensing_country)
    .bind(doctor.licensing_valid_until)
    .bind(doctor.notes)
    .fetch_one(&mut *tx)
    .await
    {
        Ok(row) => row,
        Err(sqlx::Error::Database(db_error)) if db_error.code().as_deref() == Some("23505") => {
            return err(
                StatusCode::CONFLICT,
                "Doctor is already linked to this provider",
            );
        }
        Err(e) => {
            tracing::error!(error = %e, provider_id = %provider_id, "Failed to create doctor");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to create doctor");
        }
    };

    let doctor_id: Uuid = match row.try_get("id") {
        Ok(value) => value,
        Err(_) => return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to decode doctor"),
    };
    if let Some(values) = specializations
        && let Err(resp) =
            sync_doctor_specializations_tx(&mut tx, doctor_id, &provider_type, &values).await
    {
        return resp;
    }
    if let Some(values) = insurance_providers
        && let Err(resp) =
            sync_doctor_insurances_tx(&mut tx, doctor_id, &provider_type, &values).await
    {
        return resp;
    }
    if let Some(values) = contacts
        && let Err(resp) =
            replace_person_contacts_tx(&mut tx, provider_id, Some(doctor_id), None, &values).await
    {
        return resp;
    }
    if let Err(e) = tx.commit().await {
        tracing::error!(error = %e, provider_id = %provider_id, doctor_id = %doctor_id, "Failed to commit doctor create transaction");
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to create doctor");
    }

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
            "shared_identity_id": shared_identity_id,
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

    let provider_type = match load_provider_type(&state, provider_id).await {
        Ok(value) => value,
        Err(resp) => return resp,
    };
    let doctor = match normalize_doctor_payload(body) {
        Ok(payload) => payload,
        Err(message) => return err(StatusCode::UNPROCESSABLE_ENTITY, message),
    };
    let current_title: Option<String> = match sqlx::query_scalar(
        "SELECT title FROM provider_doctors WHERE provider_id = $1 AND id = $2",
    )
    .bind(provider_id)
    .bind(doctor_id)
    .fetch_optional(&state.db)
    .await
    {
        Ok(Some(value)) => value,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Doctor not found"),
        Err(e) => {
            tracing::error!(error = %e, provider_id = %provider_id, doctor_id = %doctor_id, "Failed to load doctor title");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to update doctor");
        }
    };
    if let Err(message) =
        validate_updated_doctor_title(doctor.title.as_deref(), current_title.as_deref())
    {
        return err(StatusCode::UNPROCESSABLE_ENTITY, message);
    }
    let specializations = doctor.specializations.clone();
    let insurance_providers = doctor.insurance_providers.clone();
    let contacts = doctor.contacts.clone();
    if provider_type == "non_medical"
        && specializations
            .as_ref()
            .is_some_and(|values| !values.is_empty())
    {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Doctor specializations are only allowed for medical providers",
        );
    }
    if provider_type == "non_medical"
        && insurance_providers
            .as_ref()
            .is_some_and(|values| !values.is_empty())
    {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Doctor insurance providers are only allowed for medical providers",
        );
    }

    let mut tx = match state.db.begin().await {
        Ok(tx) => tx,
        Err(e) => {
            tracing::error!(error = %e, provider_id = %provider_id, doctor_id = %doctor_id, "Failed to start doctor update transaction");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to update doctor");
        }
    };

    match sqlx::query(
        r#"UPDATE provider_doctors
           SET name = $3,
               first_name = $4,
               last_name = $5,
               display_name = $6,
               title = $7,
               role_code = $8,
               role_label = $9,
               subrole = $10,
               website = $11,
               schwerpunkt = $12,
               gender = $13,
               opening_hours = $14,
               fachbereich = $15,
               languages = $16,
               phone = $17,
               email = $18,
               license_number = $19,
               licensing_country = $20,
               licensing_valid_until = $21,
               notes = $22
           WHERE provider_id = $1 AND id = $2"#,
    )
    .bind(provider_id)
    .bind(doctor_id)
    .bind(doctor.name)
    .bind(doctor.first_name)
    .bind(doctor.last_name)
    .bind(doctor.display_name)
    .bind(doctor.title)
    .bind(doctor.role_code)
    .bind(doctor.role_label)
    .bind(doctor.subrole)
    .bind(doctor.website)
    .bind(doctor.schwerpunkt)
    .bind(doctor.gender)
    .bind(doctor.opening_hours)
    .bind(doctor.fachbereich)
    .bind(doctor.languages)
    .bind(doctor.phone)
    .bind(doctor.email)
    .bind(doctor.license_number)
    .bind(doctor.licensing_country)
    .bind(doctor.licensing_valid_until)
    .bind(doctor.notes)
    .execute(&mut *tx)
    .await
    {
        Ok(result) if result.rows_affected() > 0 => {}
        Ok(_) => return err(StatusCode::NOT_FOUND, "Doctor not found"),
        Err(e) => {
            tracing::error!(error = %e, provider_id = %provider_id, doctor_id = %doctor_id, "Failed to update doctor");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to update doctor");
        }
    }
    if provider_type == "non_medical" {
        if let Err(resp) =
            sync_doctor_specializations_tx(&mut tx, doctor_id, &provider_type, &[]).await
        {
            return resp;
        }
        if let Err(resp) = sync_doctor_insurances_tx(&mut tx, doctor_id, &provider_type, &[]).await
        {
            return resp;
        }
    } else if let Some(values) = specializations
        && let Err(resp) =
            sync_doctor_specializations_tx(&mut tx, doctor_id, &provider_type, &values).await
    {
        return resp;
    }
    if provider_type != "non_medical"
        && let Some(values) = insurance_providers
        && let Err(resp) =
            sync_doctor_insurances_tx(&mut tx, doctor_id, &provider_type, &values).await
    {
        return resp;
    }
    if let Some(values) = contacts
        && let Err(resp) =
            replace_person_contacts_tx(&mut tx, provider_id, Some(doctor_id), None, &values).await
    {
        return resp;
    }
    if let Err(e) = tx.commit().await {
        tracing::error!(error = %e, provider_id = %provider_id, doctor_id = %doctor_id, "Failed to commit doctor update transaction");
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to update doctor");
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

async fn list_provider_staff(
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

    match load_provider_staff_json(&state, provider_id).await {
        Ok(staff) => Json(staff).into_response(),
        Err(resp) => resp,
    }
}

async fn create_provider_staff(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(provider_id): Path<Uuid>,
    Json(body): Json<UpsertProviderStaffRequest>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::Ceo, Role::PatientManager]) {
        return e;
    }

    if let Err(resp) = ensure_provider_exists(&state, provider_id).await {
        return resp;
    }

    let staff = match normalize_provider_staff_payload(body) {
        Ok(payload) => payload,
        Err(message) => return err(StatusCode::UNPROCESSABLE_ENTITY, message),
    };
    if let Err(resp) = ensure_provider_staff_role_exists(&state, &staff.role).await {
        return resp;
    }
    let contacts = staff.contacts.clone();

    let mut tx = match state.db.begin().await {
        Ok(tx) => tx,
        Err(e) => {
            tracing::error!(error = %e, provider_id = %provider_id, "Failed to start provider staff create transaction");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to create provider staff",
            );
        }
    };

    let row = match sqlx::query(
        r#"INSERT INTO provider_staff (
                provider_id, first_name, last_name, display_name, role,
                department, gender, opening_hours, status, notes, is_active
           ) VALUES (
                $1, $2, $3, $4, $5,
                $6, $7, $8, $9, $10, $11
           )
           RETURNING id, created_at"#,
    )
    .bind(provider_id)
    .bind(staff.first_name)
    .bind(staff.last_name)
    .bind(staff.display_name)
    .bind(staff.role)
    .bind(staff.department)
    .bind(staff.gender)
    .bind(staff.opening_hours)
    .bind(staff.status)
    .bind(staff.notes)
    .bind(staff.is_active)
    .fetch_one(&mut *tx)
    .await
    {
        Ok(row) => row,
        Err(e) => {
            tracing::error!(error = %e, provider_id = %provider_id, "Failed to create provider staff");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to create provider staff",
            );
        }
    };

    let staff_id: Uuid = match row.try_get("id") {
        Ok(value) => value,
        Err(_) => return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to decode staff"),
    };
    if let Some(values) = contacts
        && let Err(resp) =
            replace_person_contacts_tx(&mut tx, provider_id, None, Some(staff_id), &values).await
    {
        return resp;
    }
    if let Err(e) = tx.commit().await {
        tracing::error!(error = %e, provider_id = %provider_id, staff_id = %staff_id, "Failed to commit provider staff create transaction");
        return err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to create provider staff",
        );
    }

    let _ = audit(
        &state,
        auth.user_id,
        "create_provider_staff",
        "provider_staff",
        Some(staff_id),
        Some(json!({ "provider_id": provider_id, "staff_id": staff_id })),
    )
    .await;
    crate::realtime::publish_provider_event(
        &state,
        Some(auth.user_id),
        "provider.staff_created",
        provider_id,
        json!({ "provider_id": provider_id, "staff_id": staff_id }),
    )
    .await;

    (
        StatusCode::CREATED,
        Json(json!({
            "id": staff_id,
            "created_at": row
                .try_get::<chrono::DateTime<chrono::Utc>, _>("created_at")
                .map(|v| v.to_rfc3339())
                .unwrap_or_default(),
        })),
    )
        .into_response()
}

async fn update_provider_staff(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path((provider_id, staff_id)): Path<(Uuid, Uuid)>,
    Json(body): Json<UpsertProviderStaffRequest>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::Ceo, Role::PatientManager]) {
        return e;
    }

    let staff = match normalize_provider_staff_payload(body) {
        Ok(payload) => payload,
        Err(message) => return err(StatusCode::UNPROCESSABLE_ENTITY, message),
    };
    if let Err(resp) = ensure_provider_staff_role_exists(&state, &staff.role).await {
        return resp;
    }
    let contacts = staff.contacts.clone();

    let mut tx = match state.db.begin().await {
        Ok(tx) => tx,
        Err(e) => {
            tracing::error!(error = %e, provider_id = %provider_id, staff_id = %staff_id, "Failed to start provider staff update transaction");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to update provider staff",
            );
        }
    };

    match sqlx::query(
        r#"UPDATE provider_staff
           SET first_name = $3,
               last_name = $4,
               display_name = $5,
               role = $6,
               department = $7,
               gender = $8,
               opening_hours = $9,
               status = $10,
               notes = $11,
               is_active = $12,
               updated_at = now()
           WHERE provider_id = $1 AND id = $2"#,
    )
    .bind(provider_id)
    .bind(staff_id)
    .bind(staff.first_name)
    .bind(staff.last_name)
    .bind(staff.display_name)
    .bind(staff.role)
    .bind(staff.department)
    .bind(staff.gender)
    .bind(staff.opening_hours)
    .bind(staff.status)
    .bind(staff.notes)
    .bind(staff.is_active)
    .execute(&mut *tx)
    .await
    {
        Ok(result) if result.rows_affected() > 0 => {}
        Ok(_) => return err(StatusCode::NOT_FOUND, "Provider staff not found"),
        Err(e) => {
            tracing::error!(error = %e, provider_id = %provider_id, staff_id = %staff_id, "Failed to update provider staff");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to update provider staff",
            );
        }
    }

    if let Some(values) = contacts
        && let Err(resp) =
            replace_person_contacts_tx(&mut tx, provider_id, None, Some(staff_id), &values).await
    {
        return resp;
    }
    if let Err(e) = tx.commit().await {
        tracing::error!(error = %e, provider_id = %provider_id, staff_id = %staff_id, "Failed to commit provider staff update transaction");
        return err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to update provider staff",
        );
    }

    let _ = audit(
        &state,
        auth.user_id,
        "update_provider_staff",
        "provider_staff",
        Some(staff_id),
        Some(json!({ "provider_id": provider_id, "staff_id": staff_id })),
    )
    .await;
    crate::realtime::publish_provider_event(
        &state,
        Some(auth.user_id),
        "provider.staff_updated",
        provider_id,
        json!({ "provider_id": provider_id, "staff_id": staff_id }),
    )
    .await;

    Json(json!({ "ok": true })).into_response()
}

async fn delete_provider_staff(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path((provider_id, staff_id)): Path<(Uuid, Uuid)>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::Ceo, Role::PatientManager]) {
        return e;
    }

    match sqlx::query("DELETE FROM provider_staff WHERE provider_id = $1 AND id = $2")
        .bind(provider_id)
        .bind(staff_id)
        .execute(&state.db)
        .await
    {
        Ok(result) if result.rows_affected() > 0 => {}
        Ok(_) => return err(StatusCode::NOT_FOUND, "Provider staff not found"),
        Err(e) => {
            tracing::error!(error = %e, provider_id = %provider_id, staff_id = %staff_id, "Failed to delete provider staff");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to delete provider staff",
            );
        }
    }

    let _ = audit(
        &state,
        auth.user_id,
        "delete_provider_staff",
        "provider_staff",
        Some(staff_id),
        Some(json!({ "provider_id": provider_id, "staff_id": staff_id })),
    )
    .await;
    crate::realtime::publish_provider_event(
        &state,
        Some(auth.user_id),
        "provider.staff_deleted",
        provider_id,
        json!({ "provider_id": provider_id, "staff_id": staff_id }),
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
        r#"SELECT s.id, s.provider_id, s.service_name, s.description, s.price, s.currency,
                  s.price_type, s.price_from, s.price_to, s.price_note,
                  s.valid_from, s.valid_to, s.created_at,
                  s.taxonomy_node_id, s.taxonomy_attributes,
                  ptn.code AS taxonomy_node_code,
                  ptn.name_de AS taxonomy_node_name_de,
                  ptn.name_ru AS taxonomy_node_name_ru
           FROM service_catalog s
           LEFT JOIN provider_taxonomy_nodes ptn ON ptn.id = s.taxonomy_node_id
           WHERE s.provider_id = $1 AND s.id = $2"#,
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
            "price_type": row.try_get::<String, _>("price_type").unwrap_or_else(|_| "fixed".to_string()),
            "price_from": row.try_get::<Option<rust_decimal::Decimal>, _>("price_from").unwrap_or_default(),
            "price_to": row.try_get::<Option<rust_decimal::Decimal>, _>("price_to").unwrap_or_default(),
            "price_note": row.try_get::<Option<String>, _>("price_note").unwrap_or_default(),
            "currency": row.try_get::<String, _>("currency").unwrap_or_else(|_| "EUR".to_string()),
            "valid_from": row.try_get::<chrono::NaiveDate, _>("valid_from").map(|v| v.to_string()).unwrap_or_default(),
            "valid_to": row.try_get::<Option<chrono::NaiveDate>, _>("valid_to").unwrap_or_default().map(|v| v.to_string()),
            "created_at": row.try_get::<chrono::DateTime<chrono::Utc>, _>("created_at").map(|v| v.to_rfc3339()).unwrap_or_default(),
            "taxonomy_node_id": row.try_get::<Option<Uuid>, _>("taxonomy_node_id").unwrap_or_default(),
            "taxonomy_node_code": row.try_get::<Option<String>, _>("taxonomy_node_code").unwrap_or_default(),
            "taxonomy_node_name_de": row.try_get::<Option<String>, _>("taxonomy_node_name_de").unwrap_or_default(),
            "taxonomy_node_name_ru": row.try_get::<Option<String>, _>("taxonomy_node_name_ru").unwrap_or_default(),
            "taxonomy_attributes": row.try_get::<Value, _>("taxonomy_attributes").unwrap_or_else(|_| json!({})),
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

    let service = match normalize_service_payload(body) {
        Ok(payload) => payload,
        Err(message) => return err(StatusCode::UNPROCESSABLE_ENTITY, message),
    };
    let provider_type = match load_provider_type(&state, provider_id).await {
        Ok(value) => value,
        Err(resp) => return resp,
    };
    if let Err(resp) =
        validate_service_taxonomy_node(&state, &provider_type, service.taxonomy_node_id).await
    {
        return resp;
    }

    let row = match sqlx::query(
        r#"INSERT INTO service_catalog (
                provider_id, service_name, description, price,
                price_type, price_from, price_to, price_note,
                currency, valid_from, valid_to,
                taxonomy_node_id, taxonomy_attributes
           ) VALUES (
                $1, $2, $3, $4,
                $5, $6, $7, $8,
                $9, $10, $11,
                $12, $13
           )
           RETURNING id, created_at"#,
    )
    .bind(provider_id)
    .bind(service.service_name)
    .bind(service.description)
    .bind(service.price)
    .bind(service.price_type)
    .bind(service.price_from)
    .bind(service.price_to)
    .bind(service.price_note)
    .bind(service.currency)
    .bind(service.valid_from)
    .bind(service.valid_to)
    .bind(service.taxonomy_node_id)
    .bind(service.taxonomy_attributes)
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
    let provider_type = match load_provider_type(&state, provider_id).await {
        Ok(value) => value,
        Err(resp) => return resp,
    };
    if let Err(resp) =
        validate_service_taxonomy_node(&state, &provider_type, service.taxonomy_node_id).await
    {
        return resp;
    }

    match sqlx::query(
        r#"UPDATE service_catalog
           SET service_name = $3,
               description = $4,
               price = $5,
               price_type = $6,
               price_from = $7,
               price_to = $8,
               price_note = $9,
               currency = $10,
               valid_from = $11,
               valid_to = $12,
               taxonomy_node_id = $13,
               taxonomy_attributes = $14
           WHERE provider_id = $1 AND id = $2"#,
    )
    .bind(provider_id)
    .bind(service_id)
    .bind(service.service_name)
    .bind(service.description)
    .bind(service.price)
    .bind(service.price_type)
    .bind(service.price_from)
    .bind(service.price_to)
    .bind(service.price_note)
    .bind(service.currency)
    .bind(service.valid_from)
    .bind(service.valid_to)
    .bind(service.taxonomy_node_id)
    .bind(service.taxonomy_attributes)
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
    contacts: Option<Vec<ProviderContactPayload>>,
    website: Option<String>,
    opening_hours: Option<String>,
    fachbereich: Option<String>,
    specializations: Option<Vec<String>>,
    insurance_providers: Option<Vec<String>>,
    parent_provider_id: Option<Uuid>,
    organization_level: String,
    taxonomy_node_ids: Option<Vec<Uuid>>,
    primary_taxonomy_node_id: Option<Uuid>,
    taxonomy_attributes: Option<Value>,
    internal_rating: Option<f64>,
    internal_rating_note: Option<String>,
    kooperationsvertrag: Option<Value>,
    notes: Option<String>,
}

struct DoctorPayload {
    name: String,
    shared_identity_id: Option<Uuid>,
    first_name: Option<String>,
    last_name: Option<String>,
    display_name: Option<String>,
    title: Option<String>,
    role_code: Option<String>,
    role_label: Option<String>,
    subrole: Option<String>,
    website: Option<String>,
    schwerpunkt: Option<String>,
    gender: String,
    opening_hours: Option<String>,
    fachbereich: Option<String>,
    specializations: Option<Vec<String>>,
    insurance_providers: Option<Vec<String>>,
    languages: Vec<String>,
    phone: Option<String>,
    email: Option<String>,
    contacts: Option<Vec<PersonContactPayload>>,
    license_number: Option<String>,
    licensing_country: Option<String>,
    licensing_valid_until: Option<chrono::NaiveDate>,
    notes: Option<String>,
}

struct ServicePayload {
    service_name: String,
    description: Option<String>,
    price: rust_decimal::Decimal,
    price_type: String,
    price_from: Option<rust_decimal::Decimal>,
    price_to: Option<rust_decimal::Decimal>,
    price_note: Option<String>,
    currency: String,
    valid_from: chrono::NaiveDate,
    valid_to: Option<chrono::NaiveDate>,
    taxonomy_node_id: Option<Uuid>,
    taxonomy_attributes: Value,
}

#[derive(Clone)]
struct PersonContactPayload {
    contact_kind: String,
    contact_type: String,
    value: String,
    is_primary: bool,
    notes: Option<String>,
}

#[derive(Clone)]
struct ProviderContactPayload {
    contact_kind: String,
    contact_type: String,
    label: Option<String>,
    department: Option<String>,
    value: String,
    is_primary: bool,
    notes: Option<String>,
}

struct ProviderStaffPayload {
    first_name: Option<String>,
    last_name: Option<String>,
    display_name: String,
    role: String,
    department: Option<String>,
    gender: String,
    opening_hours: Option<String>,
    status: String,
    notes: Option<String>,
    is_active: bool,
    contacts: Option<Vec<PersonContactPayload>>,
}

struct DoctorRelationshipPayload {
    target_doctor_id: Uuid,
    target_provider_id: Option<Uuid>,
    relationship_type: String,
    description: Option<String>,
    notes: Option<String>,
    is_active: bool,
}

impl DoctorRelationshipPayload {
    fn reciprocal(&self, target_doctor_id: Uuid) -> Self {
        Self {
            target_doctor_id,
            target_provider_id: None,
            relationship_type: self.relationship_type.clone(),
            description: self.description.clone(),
            notes: self.notes.clone(),
            is_active: self.is_active,
        }
    }
}

struct ProviderStaffRolePayload {
    code: Option<String>,
    name_en: String,
    name_de: Option<String>,
    name_ru: Option<String>,
    sort_order: i32,
    is_active: bool,
}

struct SpecializationPayload {
    code: Option<String>,
    name_en: String,
    name_de: Option<String>,
    name_ru: Option<String>,
    sort_order: i32,
    is_active: bool,
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

const DOCTOR_TITLE_PARSE_ORDER: [&str; 6] =
    ["Priv.-Doz.", "Dipl.-Med.", "Dr. med.", "Prof.", "Dr.", "PD"];
const DOCTOR_TITLE_VALIDATION_MESSAGE: &str = "Doctor title must use academic titles: Prof., Priv.-Doz., PD, Dr. med., Dr. or Dipl.-Med. Use gender for Herr/Frau.";

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
    let explicit_specializations = body.specializations.is_some();
    let mut specializations = normalize_string_list(body.specializations);
    let insurance_providers = normalize_insurance_provider_list(body.insurance_providers)?;
    let fachbereich = normalize_optional(body.fachbereich);
    if specializations.is_empty()
        && let Some(value) = fachbereich.clone()
    {
        specializations.push(value);
    }
    let fachbereich = fachbereich.or_else(|| specializations.first().cloned());
    if provider_type == "non_medical" && !specializations.is_empty() {
        return Err("Specializations are only allowed for medical providers");
    }
    if provider_type == "non_medical"
        && insurance_providers
            .as_ref()
            .is_some_and(|values| !values.is_empty())
    {
        return Err("Insurance providers are only allowed for medical providers");
    }

    let organization_level =
        normalize_optional(body.organization_level).unwrap_or_else(|| "organization".to_string());
    if !is_valid_organization_level(&organization_level) {
        return Err("Organization level is invalid");
    }

    let (taxonomy_node_ids, primary_taxonomy_node_id) = normalize_provider_taxonomy_input(
        body.taxonomy_node_id,
        body.taxonomy_node_ids,
        body.primary_taxonomy_node_id,
    );
    let taxonomy_attributes = normalize_taxonomy_attributes(body.taxonomy_attributes)?;
    let internal_rating = normalize_internal_rating(body.internal_rating)?;
    let internal_rating_note = normalize_optional(body.internal_rating_note);
    if internal_rating_note
        .as_ref()
        .is_some_and(|value| value.len() > 2000)
    {
        return Err("Internal rating note is too long");
    }

    let phone = normalize_optional(body.phone);
    let email = normalize_optional(body.email);
    let opening_hours = normalize_optional(body.opening_hours);
    if opening_hours
        .as_ref()
        .is_some_and(|value| value.len() > 4000)
    {
        return Err("Opening hours are too long");
    }
    let contacts = match body.contacts {
        Some(raw) => Some(normalize_provider_contacts(raw)?),
        None => Some(legacy_provider_contacts_from_fields(
            phone.clone(),
            email.clone(),
        )),
    };

    Ok(ProviderPayload {
        name,
        provider_type,
        legal_name: normalize_optional(body.legal_name),
        tax_id: normalize_optional(body.tax_id),
        address_street: normalize_optional(body.address_street),
        address_city: normalize_optional(body.address_city),
        address_zip: normalize_optional(body.address_zip),
        address_country: normalize_optional(body.address_country),
        phone,
        email,
        contacts,
        website: normalize_optional(body.website),
        opening_hours,
        fachbereich,
        specializations: if explicit_specializations || !specializations.is_empty() {
            Some(specializations)
        } else {
            None
        },
        insurance_providers,
        parent_provider_id: body.parent_provider_id,
        organization_level,
        taxonomy_node_ids,
        primary_taxonomy_node_id,
        taxonomy_attributes,
        internal_rating,
        internal_rating_note,
        kooperationsvertrag: normalize_json(body.kooperationsvertrag),
        notes: normalize_optional(body.notes),
    })
}

fn normalize_doctor_payload(body: UpsertDoctorRequest) -> Result<DoctorPayload, &'static str> {
    let first_name = normalize_optional(body.first_name);
    let last_name = normalize_optional(body.last_name);
    let display_name = normalize_optional(body.display_name);
    let legacy_name = normalize_optional(body.name);
    let joined_name = [first_name.clone(), last_name.clone()]
        .into_iter()
        .flatten()
        .collect::<Vec<_>>()
        .join(" ");
    let name = legacy_name
        .or(display_name.clone())
        .or({
            if joined_name.is_empty() {
                None
            } else {
                Some(joined_name)
            }
        })
        .ok_or("Doctor name is required (max 255)")?;
    if name.is_empty() || name.len() > 255 {
        return Err("Doctor name is required (max 255)");
    }

    let languages = normalize_string_list(body.languages);
    let licensing_valid_until = parse_date(body.licensing_valid_until, "licensing_valid_until")?;
    let title = normalize_doctor_title(body.title);
    let role_code = normalize_optional(body.role_code).map(|value| value.to_lowercase());
    if role_code
        .as_ref()
        .is_some_and(|value| !is_valid_doctor_role_code(value))
    {
        return Err("Doctor role is invalid");
    }
    let role_label = normalize_optional(body.role_label);
    if role_label.as_ref().is_some_and(|value| value.len() > 120) {
        return Err("Doctor role label is too long");
    }
    let subrole = normalize_optional(body.subrole);
    if subrole.as_ref().is_some_and(|value| value.len() > 255) {
        return Err("Doctor subrole is too long");
    }
    let website = normalize_optional(body.website);
    if website.as_ref().is_some_and(|value| value.len() > 500) {
        return Err("Doctor website is too long");
    }
    let schwerpunkt = normalize_optional(body.schwerpunkt);
    if schwerpunkt.as_ref().is_some_and(|value| value.len() > 255) {
        return Err("Doctor schwerpunkt is too long");
    }
    let gender = normalize_gender(body.gender)?;
    let opening_hours = normalize_optional(body.opening_hours);
    if opening_hours
        .as_ref()
        .is_some_and(|value| value.len() > 4000)
    {
        return Err("Opening hours are too long");
    }
    let explicit_specializations = body.specializations.is_some();
    let mut specializations = normalize_string_list(body.specializations);
    let insurance_providers = normalize_insurance_provider_list(body.insurance_providers)?;
    let fachbereich = normalize_optional(body.fachbereich);
    if specializations.is_empty()
        && let Some(value) = fachbereich.clone()
    {
        specializations.push(value);
    }
    let fachbereich = fachbereich.or_else(|| specializations.first().cloned());
    let phone = normalize_optional(body.phone);
    let email = normalize_optional(body.email);
    let contacts = match body.contacts {
        Some(raw) => Some(normalize_person_contacts(raw)?),
        None => legacy_contacts_from_fields(phone.clone(), email.clone()),
    };
    let display_name = display_name.or_else(|| Some(name.clone()));

    Ok(DoctorPayload {
        name,
        shared_identity_id: body.shared_identity_id,
        first_name,
        last_name,
        display_name,
        title,
        role_code,
        role_label,
        subrole,
        website,
        schwerpunkt,
        gender,
        opening_hours,
        fachbereich,
        specializations: if explicit_specializations || !specializations.is_empty() {
            Some(specializations)
        } else {
            None
        },
        insurance_providers,
        languages,
        phone,
        email,
        contacts,
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

    let requested_price_type = normalize_optional(body.price_type);
    let price_type = requested_price_type.unwrap_or_else(|| {
        if body.price_from.is_some() || body.price_to.is_some() {
            "range".to_string()
        } else {
            "fixed".to_string()
        }
    });
    if !matches!(price_type.as_str(), "fixed" | "range" | "on_request") {
        return Err("Service price type is invalid");
    }

    let legacy_price = normalize_money(body.price)?;
    let requested_price_from = normalize_money(body.price_from)?;
    let requested_price_to = normalize_money(body.price_to)?;
    let (price, price_from, price_to) = match price_type.as_str() {
        "fixed" => {
            let price = legacy_price
                .or(requested_price_from)
                .or(requested_price_to)
                .unwrap_or(rust_decimal::Decimal::ZERO);
            (price, Some(price), Some(price))
        }
        "range" => {
            let price_from = requested_price_from
                .or(legacy_price)
                .ok_or("Service price_from is required for price range")?;
            let price_to = requested_price_to.unwrap_or(price_from);
            if price_to < price_from {
                return Err("Service price_to must be greater than or equal to price_from");
            }
            (price_from, Some(price_from), Some(price_to))
        }
        _ => (
            legacy_price.unwrap_or(rust_decimal::Decimal::ZERO),
            requested_price_from,
            requested_price_to,
        ),
    };

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
    let taxonomy_attributes =
        normalize_taxonomy_attributes(body.taxonomy_attributes)?.unwrap_or_else(|| json!({}));

    Ok(ServicePayload {
        service_name,
        description: normalize_optional(body.description),
        price,
        price_type,
        price_from,
        price_to,
        price_note: normalize_optional(body.price_note),
        currency,
        valid_from,
        valid_to,
        taxonomy_node_id: body.taxonomy_node_id,
        taxonomy_attributes,
    })
}

fn validate_new_doctor_title(title: Option<&str>) -> Result<(), &'static str> {
    validate_doctor_title_value(title)
}

fn validate_updated_doctor_title(
    title: Option<&str>,
    current_title: Option<&str>,
) -> Result<(), &'static str> {
    if validate_doctor_title_value(title).is_ok() {
        return Ok(());
    }
    if let Some(title) = title
        && current_title.is_some_and(|current| current.trim() == title.trim())
    {
        return Ok(());
    }
    Err(DOCTOR_TITLE_VALIDATION_MESSAGE)
}

fn validate_doctor_title_value(title: Option<&str>) -> Result<(), &'static str> {
    let Some(title) = title.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(());
    };

    let mut remaining = title;
    let mut seen: Vec<&'static str> = Vec::new();
    while !remaining.is_empty() {
        let Some(candidate) = DOCTOR_TITLE_PARSE_ORDER.iter().find(|candidate| {
            remaining
                .get(..candidate.len())
                .is_some_and(|prefix| prefix.eq_ignore_ascii_case(candidate))
        }) else {
            return Err(DOCTOR_TITLE_VALIDATION_MESSAGE);
        };
        let candidate = *candidate;
        let remainder = remaining.get(candidate.len()..).unwrap_or_default();
        if !remainder.is_empty() && !remainder.chars().next().is_some_and(char::is_whitespace) {
            return Err(DOCTOR_TITLE_VALIDATION_MESSAGE);
        }
        if seen
            .iter()
            .any(|seen_title| seen_title.eq_ignore_ascii_case(candidate))
        {
            return Err(DOCTOR_TITLE_VALIDATION_MESSAGE);
        }
        seen.push(candidate);
        remaining = remainder.trim_start();
    }
    Ok(())
}

fn normalize_provider_staff_payload(
    body: UpsertProviderStaffRequest,
) -> Result<ProviderStaffPayload, &'static str> {
    let first_name = normalize_optional(body.first_name);
    let last_name = normalize_optional(body.last_name);
    let display_name = normalize_optional(Some(body.display_name))
        .or_else(|| {
            let joined = [first_name.clone(), last_name.clone()]
                .into_iter()
                .flatten()
                .collect::<Vec<_>>()
                .join(" ");
            if joined.is_empty() {
                None
            } else {
                Some(joined)
            }
        })
        .ok_or("Staff display name is required")?;
    if display_name.len() > 255 {
        return Err("Staff display name is too long");
    }

    let role = normalize_optional(body.role).unwrap_or_else(|| "staff".to_string());
    if role.len() > 120 {
        return Err("Staff role is too long");
    }
    let gender = normalize_gender(body.gender)?;
    let opening_hours = normalize_optional(body.opening_hours);
    if opening_hours
        .as_ref()
        .is_some_and(|value| value.len() > 4000)
    {
        return Err("Opening hours are too long");
    }
    let status = normalize_optional(body.status).unwrap_or_else(|| "active".to_string());
    if !matches!(
        status.as_str(),
        "active" | "inactive" | "external" | "unknown"
    ) {
        return Err("Staff status is invalid");
    }
    let contacts = match body.contacts {
        Some(raw) => Some(normalize_person_contacts(raw)?),
        None => None,
    };

    Ok(ProviderStaffPayload {
        first_name,
        last_name,
        display_name,
        role,
        department: normalize_optional(body.department),
        gender,
        opening_hours,
        status: status.clone(),
        notes: normalize_optional(body.notes),
        is_active: status == "active",
        contacts,
    })
}

fn normalize_provider_staff_role_payload(
    body: UpsertProviderStaffRoleRequest,
    allow_code: bool,
) -> Result<ProviderStaffRolePayload, &'static str> {
    let name_en =
        normalize_optional(Some(body.name_en)).ok_or("Provider staff role name is required")?;
    if name_en.len() > 120 {
        return Err("Provider staff role name is too long");
    }

    let name_de = normalize_optional(body.name_de);
    if name_de.as_ref().is_some_and(|value| value.len() > 120) {
        return Err("Provider staff role German name is too long");
    }
    let name_ru = normalize_optional(body.name_ru);
    if name_ru.as_ref().is_some_and(|value| value.len() > 120) {
        return Err("Provider staff role Russian name is too long");
    }

    let code = if allow_code {
        normalize_optional(body.code).map(|value| staff_role_code(&value))
    } else {
        None
    };
    if code.as_ref().is_some_and(|value| value.len() > 120) {
        return Err("Provider staff role code is too long");
    }

    Ok(ProviderStaffRolePayload {
        code,
        name_en,
        name_de,
        name_ru,
        sort_order: body.sort_order.unwrap_or(1000),
        is_active: body.is_active.unwrap_or(true),
    })
}

fn normalize_specialization_payload(
    body: UpsertSpecializationRequest,
    allow_code: bool,
) -> Result<SpecializationPayload, &'static str> {
    let name_en =
        normalize_optional(Some(body.name_en)).ok_or("Specialization name is required")?;
    if name_en.len() > 120 {
        return Err("Specialization name is too long");
    }

    let name_de = normalize_optional(body.name_de);
    if name_de.as_ref().is_some_and(|value| value.len() > 120) {
        return Err("Specialization German name is too long");
    }
    let name_ru = normalize_optional(body.name_ru);
    if name_ru.as_ref().is_some_and(|value| value.len() > 120) {
        return Err("Specialization alternate name is too long");
    }

    let code = if allow_code {
        normalize_optional(body.code).map(|value| specialization_code(&value))
    } else {
        None
    };
    if code.as_ref().is_some_and(|value| value.len() > 120) {
        return Err("Specialization code is too long");
    }

    Ok(SpecializationPayload {
        code,
        name_en,
        name_de,
        name_ru,
        sort_order: body.sort_order.unwrap_or(1000),
        is_active: body.is_active.unwrap_or(true),
    })
}

fn normalize_person_contacts(
    raw_contacts: Vec<UpsertPersonContactRequest>,
) -> Result<Vec<PersonContactPayload>, &'static str> {
    let mut contacts = Vec::new();
    for raw in raw_contacts {
        let contact_kind = raw.contact_kind.trim().to_lowercase();
        if !matches!(contact_kind.as_str(), "phone" | "email") {
            return Err("Contact kind must be phone or email");
        }
        let contact_type = normalize_optional(raw.contact_type)
            .unwrap_or_else(|| "work".to_string())
            .to_lowercase();
        if !matches!(contact_type.as_str(), "work" | "private" | "other") {
            return Err("Contact type must be work, private or other");
        }
        let value = raw.value.trim().to_string();
        if value.is_empty() || value.len() > 255 {
            return Err("Contact value is required (max 255)");
        }
        contacts.push(PersonContactPayload {
            contact_kind,
            contact_type,
            value,
            is_primary: raw.is_primary.unwrap_or(false),
            notes: normalize_optional(raw.notes),
        });
    }
    ensure_primary_contacts(&mut contacts);
    Ok(contacts)
}

fn normalize_provider_contacts(
    raw_contacts: Vec<UpsertProviderContactRequest>,
) -> Result<Vec<ProviderContactPayload>, &'static str> {
    let mut contacts = Vec::new();
    for raw in raw_contacts {
        let contact_kind = raw.contact_kind.trim().to_lowercase();
        if !matches!(contact_kind.as_str(), "phone" | "email") {
            return Err("Contact kind must be phone or email");
        }
        let contact_type = normalize_optional(raw.contact_type)
            .unwrap_or_else(|| "work".to_string())
            .to_lowercase();
        if !matches!(contact_type.as_str(), "work" | "department" | "other") {
            return Err("Provider contact type must be work, department or other");
        }
        let value = raw.value.trim().to_string();
        if value.is_empty() || value.len() > 255 {
            return Err("Contact value is required (max 255)");
        }
        let label = normalize_optional(raw.label);
        if label.as_ref().is_some_and(|value| value.len() > 120) {
            return Err("Contact label is too long");
        }
        let department = normalize_optional(raw.department);
        if department.as_ref().is_some_and(|value| value.len() > 120) {
            return Err("Contact department is too long");
        }
        contacts.push(ProviderContactPayload {
            contact_kind,
            contact_type,
            label,
            department,
            value,
            is_primary: raw.is_primary.unwrap_or(false),
            notes: normalize_optional(raw.notes),
        });
    }
    ensure_primary_provider_contacts(&mut contacts);
    Ok(contacts)
}

fn normalize_gender(value: Option<String>) -> Result<String, &'static str> {
    let value = normalize_optional(value)
        .unwrap_or_else(|| "unknown".to_string())
        .to_lowercase();
    if matches!(value.as_str(), "male" | "female" | "unknown") {
        Ok(value)
    } else {
        Err("Gender must be male, female or unknown")
    }
}

fn is_valid_doctor_role_code(value: &str) -> bool {
    matches!(
        value,
        "clinical_director" | "chefarzt" | "oberarzt" | "facharzt" | "assistenzarzt" | "other"
    )
}

fn normalize_doctor_relationship_payload(
    body: UpsertDoctorRelationshipRequest,
) -> Result<DoctorRelationshipPayload, &'static str> {
    let relationship_type = normalize_optional(body.relationship_type)
        .unwrap_or_else(|| "professional".to_string())
        .to_lowercase();
    if !matches!(
        relationship_type.as_str(),
        "professional" | "referral" | "knows" | "approach_via" | "other"
    ) {
        return Err("Doctor relationship type is invalid");
    }
    let description = normalize_optional(body.description);
    if description.as_ref().is_some_and(|value| value.len() > 1000) {
        return Err("Doctor relationship description is too long");
    }
    let notes = normalize_optional(body.notes);
    if notes.as_ref().is_some_and(|value| value.len() > 2000) {
        return Err("Doctor relationship notes are too long");
    }
    Ok(DoctorRelationshipPayload {
        target_doctor_id: body.target_doctor_id,
        target_provider_id: body.target_provider_id,
        relationship_type,
        description,
        notes,
        is_active: body.is_active.unwrap_or(true),
    })
}

async fn sync_doctor_relationship_row(
    tx: &mut Transaction<'_, Postgres>,
    source_doctor_id: Uuid,
    relationship: &DoctorRelationshipPayload,
) -> Result<Uuid, sqlx::Error> {
    if let Some(row) = sqlx::query(
        r#"WITH existing AS (
               SELECT id
               FROM provider_doctor_relationships
               WHERE source_doctor_id = $1
                 AND target_doctor_id = $2
                 AND relationship_type = $3
               ORDER BY is_active DESC, updated_at DESC
               LIMIT 1
               FOR UPDATE
           )
           UPDATE provider_doctor_relationships relationships
           SET description = $4,
               notes = $5,
               is_active = $6,
               updated_at = now()
           FROM existing
           WHERE relationships.id = existing.id
           RETURNING relationships.id"#,
    )
    .bind(source_doctor_id)
    .bind(relationship.target_doctor_id)
    .bind(&relationship.relationship_type)
    .bind(&relationship.description)
    .bind(&relationship.notes)
    .bind(relationship.is_active)
    .fetch_optional(&mut **tx)
    .await?
    {
        return row.try_get("id");
    }

    sqlx::query(
        r#"INSERT INTO provider_doctor_relationships (
                source_doctor_id, target_doctor_id, relationship_type,
                description, notes, is_active
           ) VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (source_doctor_id, target_doctor_id, relationship_type)
               WHERE is_active
           DO UPDATE SET
               description = EXCLUDED.description,
               notes = EXCLUDED.notes,
               is_active = EXCLUDED.is_active,
               updated_at = now()
           RETURNING id"#,
    )
    .bind(source_doctor_id)
    .bind(relationship.target_doctor_id)
    .bind(&relationship.relationship_type)
    .bind(&relationship.description)
    .bind(&relationship.notes)
    .bind(relationship.is_active)
    .fetch_one(&mut **tx)
    .await?
    .try_get("id")
}

fn legacy_contacts_from_fields(
    phone: Option<String>,
    email: Option<String>,
) -> Option<Vec<PersonContactPayload>> {
    let mut contacts = Vec::new();
    if let Some(value) = phone {
        contacts.push(PersonContactPayload {
            contact_kind: "phone".to_string(),
            contact_type: "work".to_string(),
            value,
            is_primary: true,
            notes: None,
        });
    }
    if let Some(value) = email {
        contacts.push(PersonContactPayload {
            contact_kind: "email".to_string(),
            contact_type: "work".to_string(),
            value,
            is_primary: true,
            notes: None,
        });
    }
    if contacts.is_empty() {
        None
    } else {
        Some(contacts)
    }
}

fn legacy_provider_contacts_from_fields(
    phone: Option<String>,
    email: Option<String>,
) -> Vec<ProviderContactPayload> {
    let mut contacts = Vec::new();
    if let Some(value) = phone {
        contacts.push(ProviderContactPayload {
            contact_kind: "phone".to_string(),
            contact_type: "work".to_string(),
            label: None,
            department: None,
            value,
            is_primary: true,
            notes: None,
        });
    }
    if let Some(value) = email {
        contacts.push(ProviderContactPayload {
            contact_kind: "email".to_string(),
            contact_type: "work".to_string(),
            label: None,
            department: None,
            value,
            is_primary: true,
            notes: None,
        });
    }
    contacts
}

fn ensure_primary_contacts(contacts: &mut [PersonContactPayload]) {
    for kind in ["phone", "email"] {
        let mut saw_primary = false;
        let mut saw_kind = false;
        for contact in contacts
            .iter_mut()
            .filter(|contact| contact.contact_kind == kind)
        {
            saw_kind = true;
            if contact.is_primary && !saw_primary {
                saw_primary = true;
            } else {
                contact.is_primary = false;
            }
        }
        if !saw_primary
            && saw_kind
            && let Some(contact) = contacts
                .iter_mut()
                .find(|contact| contact.contact_kind == kind)
        {
            contact.is_primary = true;
        }
    }
}

fn ensure_primary_provider_contacts(contacts: &mut [ProviderContactPayload]) {
    for kind in ["phone", "email"] {
        let mut saw_primary = false;
        let mut saw_kind = false;
        for contact in contacts
            .iter_mut()
            .filter(|contact| contact.contact_kind == kind)
        {
            saw_kind = true;
            if contact.is_primary && !saw_primary {
                saw_primary = true;
            } else {
                contact.is_primary = false;
            }
        }
        if !saw_primary
            && saw_kind
            && let Some(contact) = contacts
                .iter_mut()
                .find(|contact| contact.contact_kind == kind)
        {
            contact.is_primary = true;
        }
    }
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

    let body_de = normalize_optional(body.body_de);
    let body_en = None;
    let body_uk = None;
    let body_ru = None;
    if body_de.is_none() {
        return Err("German provider document templates must have a German body");
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

fn normalize_doctor_title(value: Option<String>) -> Option<String> {
    normalize_optional(value).map(|raw| {
        raw.replace(',', " ")
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ")
    })
}

fn normalize_json(value: Option<Value>) -> Option<Value> {
    value.and_then(|raw| if raw.is_null() { None } else { Some(raw) })
}

fn normalize_taxonomy_attributes(value: Option<Value>) -> Result<Option<Value>, &'static str> {
    let Some(value) = normalize_json(value) else {
        return Ok(None);
    };
    if !value.is_object() {
        return Err("taxonomy_attributes must be an object");
    }
    Ok(Some(value))
}

fn normalize_internal_rating(value: Option<f64>) -> Result<Option<f64>, &'static str> {
    match value {
        Some(raw) if raw.is_finite() && (0.0..=5.0).contains(&raw) => Ok(Some(raw)),
        Some(_) => Err("internal_rating must be between 0 and 5"),
        None => Ok(None),
    }
}

fn internal_rating_json(value: Option<f64>) -> serde_json::Value {
    match value {
        Some(raw) if raw.fract() == 0.0 => json!(raw as i64),
        Some(raw) => json!(raw),
        None => Value::Null,
    }
}

fn normalize_provider_taxonomy_input(
    taxonomy_node_id: Option<Uuid>,
    taxonomy_node_ids: Option<Vec<Uuid>>,
    primary_taxonomy_node_id: Option<Uuid>,
) -> (Option<Vec<Uuid>>, Option<Uuid>) {
    let explicit = taxonomy_node_id.is_some()
        || taxonomy_node_ids.is_some()
        || primary_taxonomy_node_id.is_some();
    if !explicit {
        return (None, None);
    }

    let primary = primary_taxonomy_node_id.or(taxonomy_node_id);
    let mut values = taxonomy_node_ids.unwrap_or_default();
    if let Some(value) = primary
        && !values.contains(&value)
    {
        values.insert(0, value);
    }

    let mut normalized = Vec::with_capacity(values.len());
    for value in values {
        if !normalized.contains(&value) {
            normalized.push(value);
        }
    }

    let primary = primary.or_else(|| normalized.first().copied());
    (Some(normalized), primary)
}

fn normalize_money(value: Option<f64>) -> Result<Option<rust_decimal::Decimal>, &'static str> {
    match value {
        Some(raw) if raw.is_finite() && raw >= 0.0 => rust_decimal::Decimal::try_from(raw)
            .map(Some)
            .map_err(|_| "Service price must be a valid non-negative number"),
        Some(_) => Err("Service price must be a valid non-negative number"),
        None => Ok(None),
    }
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

fn normalize_insurance_provider_list(
    value: Option<Vec<String>>,
) -> Result<Option<Vec<String>>, &'static str> {
    let Some(raw_items) = value else {
        return Ok(None);
    };
    let mut normalized = Vec::new();
    for item in raw_items {
        let trimmed = item.trim();
        if trimmed.is_empty() {
            continue;
        }
        if trimmed.len() > 255 {
            return Err("Insurance provider name is too long");
        }
        let key = trimmed.to_lowercase();
        if normalized
            .iter()
            .any(|existing: &String| existing.to_lowercase() == key)
        {
            continue;
        }
        normalized.push(trimmed.to_string());
        if normalized.len() > 50 {
            return Err("Too many insurance providers");
        }
    }
    Ok(Some(normalized))
}

fn normalize_csv_list(value: Option<String>) -> Vec<String> {
    let mut items = Vec::new();
    for item in value.unwrap_or_default().split(',') {
        let trimmed = item.trim();
        if trimmed.is_empty() || items.iter().any(|existing| existing == trimmed) {
            continue;
        }
        items.push(trimmed.to_string());
    }
    items
}

fn normalize_provider_template_languages(
    value: Option<Vec<String>>,
) -> Result<Vec<String>, &'static str> {
    let mut normalized = Vec::new();
    for item in value.unwrap_or_default() {
        let Some(language) = normalize_provider_template_language(&item) else {
            return Err("Provider document templates currently support German only");
        };
        if language != "de" {
            return Err("Provider document templates currently support German only");
        }
        if !normalized.iter().any(|existing| existing == language) {
            normalized.push(language.to_string());
        }
    }
    if normalized.is_empty() {
        normalized.push("de".to_string());
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

fn is_valid_organization_level(value: &str) -> bool {
    matches!(value, "organization" | "clinic" | "department" | "unit")
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

async fn load_provider_type(
    state: &AppState,
    provider_id: Uuid,
) -> Result<String, axum::response::Response> {
    match sqlx::query("SELECT provider_type FROM providers WHERE id = $1")
        .bind(provider_id)
        .fetch_optional(&state.db)
        .await
    {
        Ok(Some(row)) => Ok(row
            .try_get::<String, _>("provider_type")
            .unwrap_or_else(|_| "medical".to_string())),
        Ok(None) => Err(err(StatusCode::NOT_FOUND, "Provider not found")),
        Err(e) => {
            tracing::error!(error = %e, provider_id = %provider_id, "Failed to load provider type");
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

async fn ensure_doctor_relationship_target(
    state: &AppState,
    source_doctor_id: Uuid,
    target_doctor_id: Uuid,
    expected_target_provider_id: Option<Uuid>,
) -> Result<Uuid, axum::response::Response> {
    if source_doctor_id == target_doctor_id {
        return Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Doctor relationship target must be another doctor",
        ));
    }
    match sqlx::query(
        r#"SELECT d.provider_id, p.is_active AS provider_is_active
           FROM provider_doctors d
           JOIN providers p ON p.id = d.provider_id
           WHERE d.id = $1"#,
    )
    .bind(target_doctor_id)
    .fetch_optional(&state.db)
    .await
    {
        Ok(Some(row)) => {
            let target_provider_id = row.try_get::<Uuid, _>("provider_id").map_err(|_| {
                err(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Failed to validate doctor relationship target",
                )
            })?;
            if expected_target_provider_id.is_some_and(|value| value != target_provider_id) {
                return Err(err(
                    StatusCode::UNPROCESSABLE_ENTITY,
                    "Doctor relationship target does not belong to selected provider",
                ));
            }
            if !row.try_get::<bool, _>("provider_is_active").unwrap_or(true) {
                return Err(err(
                    StatusCode::UNPROCESSABLE_ENTITY,
                    "Doctor relationship target provider is inactive",
                ));
            }
            Ok(target_provider_id)
        }
        Ok(None) => Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Doctor relationship target not found",
        )),
        Err(e) => {
            tracing::error!(error = %e, target_doctor_id = %target_doctor_id, "Failed to validate doctor relationship target");
            Err(err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to validate doctor relationship target",
            ))
        }
    }
}

async fn validate_provider_parent(
    state: &AppState,
    provider_id: Option<Uuid>,
    parent_provider_id: Option<Uuid>,
) -> Result<(), axum::response::Response> {
    let Some(parent_provider_id) = parent_provider_id else {
        return Ok(());
    };
    if provider_id == Some(parent_provider_id) {
        return Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Provider cannot be its own parent",
        ));
    }

    let exists = sqlx::query_scalar::<_, bool>("SELECT EXISTS(SELECT 1 FROM providers WHERE id = $1)")
        .bind(parent_provider_id)
        .fetch_one(&state.db)
        .await
        .map_err(|e| {
            tracing::error!(error = %e, parent_provider_id = %parent_provider_id, "Failed to validate parent provider");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to validate parent provider",
            )
        })?;
    if !exists {
        return Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Parent provider not found",
        ));
    }

    let Some(provider_id) = provider_id else {
        return Ok(());
    };
    let would_cycle = sqlx::query_scalar::<_, bool>(
        r#"WITH RECURSIVE parent_chain AS (
                SELECT id, parent_provider_id
                FROM providers
                WHERE id = $1
                UNION ALL
                SELECT p.id, p.parent_provider_id
                FROM providers p
                JOIN parent_chain c ON p.id = c.parent_provider_id
            )
            SELECT EXISTS(SELECT 1 FROM parent_chain WHERE id = $2)"#,
    )
    .bind(parent_provider_id)
    .bind(provider_id)
    .fetch_one(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, provider_id = %provider_id, parent_provider_id = %parent_provider_id, "Failed to validate provider hierarchy");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to validate provider hierarchy",
        )
    })?;
    if would_cycle {
        return Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Provider hierarchy cannot contain a cycle",
        ));
    }

    Ok(())
}

async fn load_specializations_json(
    state: &AppState,
    include_inactive: bool,
) -> Result<Vec<serde_json::Value>, axum::response::Response> {
    let rows = sqlx::query(
        r#"SELECT id, code, name_en, name_de, name_ru, is_active, sort_order, created_at, updated_at
           FROM medical_specializations
           WHERE deleted_at IS NULL
             AND ($1 OR is_active = TRUE)
           ORDER BY is_active DESC, sort_order, COALESCE(name_de, name_en), name_en"#,
    )
    .bind(include_inactive)
    .fetch_all(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, "Failed to load specializations");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to load specializations",
        )
    })?;

    Ok(rows
        .into_iter()
        .map(|row| {
            json!({
                "id": row.try_get::<Uuid, _>("id").unwrap_or_default(),
                "code": row.try_get::<String, _>("code").unwrap_or_default(),
                "name_en": row.try_get::<String, _>("name_en").unwrap_or_default(),
                "name_de": row.try_get::<Option<String>, _>("name_de").unwrap_or_default(),
                "name_ru": row.try_get::<Option<String>, _>("name_ru").unwrap_or_default(),
                "is_active": row.try_get::<bool, _>("is_active").unwrap_or(true),
                "sort_order": row.try_get::<i32, _>("sort_order").unwrap_or_default(),
                "created_at": row.try_get::<chrono::DateTime<chrono::Utc>, _>("created_at").map(|v| v.to_rfc3339()).unwrap_or_default(),
                "updated_at": row.try_get::<chrono::DateTime<chrono::Utc>, _>("updated_at").map(|v| v.to_rfc3339()).unwrap_or_default(),
            })
        })
        .collect())
}

async fn toggle_specialization_active(
    state: AppState,
    auth: AuthUser,
    specialization_id: Uuid,
    is_active: bool,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::Ceo, Role::PatientManager]) {
        return e;
    }

    match sqlx::query(
        "UPDATE medical_specializations SET is_active = $2, updated_at = now() WHERE id = $1 AND deleted_at IS NULL",
    )
    .bind(specialization_id)
    .bind(is_active)
    .execute(&state.db)
    .await
    {
        Ok(result) if result.rows_affected() > 0 => {}
        Ok(_) => return err(StatusCode::NOT_FOUND, "Specialization not found"),
        Err(e) => {
            tracing::error!(error = %e, specialization_id = %specialization_id, "Failed to toggle specialization");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to update specialization",
            );
        }
    }

    let action = if is_active {
        "activate_provider_specialization"
    } else {
        "deactivate_provider_specialization"
    };
    let _ = audit(
        &state,
        auth.user_id,
        action,
        "medical_specialization",
        Some(specialization_id),
        Some(json!({ "specialization_id": specialization_id, "is_active": is_active })),
    )
    .await;

    Json(json!({ "ok": true })).into_response()
}

async fn load_provider_staff_roles_json(
    state: &AppState,
    include_inactive: bool,
) -> Result<Vec<serde_json::Value>, axum::response::Response> {
    let rows = sqlx::query(
        r#"SELECT id, code, name_en, name_de, name_ru, is_active, sort_order, created_at, updated_at
           FROM provider_staff_roles
           WHERE $1 OR is_active = TRUE
           ORDER BY is_active DESC, sort_order, name_en"#,
    )
    .bind(include_inactive)
    .fetch_all(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, "Failed to load provider staff roles");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to load provider staff roles",
        )
    })?;

    Ok(rows
        .into_iter()
        .map(|row| {
            json!({
                "id": row.try_get::<Uuid, _>("id").unwrap_or_default(),
                "code": row.try_get::<String, _>("code").unwrap_or_default(),
                "name_en": row.try_get::<String, _>("name_en").unwrap_or_default(),
                "name_de": row.try_get::<Option<String>, _>("name_de").unwrap_or_default(),
                "name_ru": row.try_get::<Option<String>, _>("name_ru").unwrap_or_default(),
                "is_active": row.try_get::<bool, _>("is_active").unwrap_or(true),
                "sort_order": row.try_get::<i32, _>("sort_order").unwrap_or_default(),
                "created_at": row.try_get::<chrono::DateTime<chrono::Utc>, _>("created_at").map(|v| v.to_rfc3339()).unwrap_or_default(),
                "updated_at": row.try_get::<chrono::DateTime<chrono::Utc>, _>("updated_at").map(|v| v.to_rfc3339()).unwrap_or_default(),
            })
        })
        .collect())
}

async fn load_insurance_providers_json(
    state: &AppState,
    include_inactive: bool,
) -> Result<Vec<serde_json::Value>, axum::response::Response> {
    let rows = sqlx::query(
        r#"WITH patient_insurance_options AS (
               SELECT
                   NULL::uuid AS id,
                   btrim(p.insurance_provider) AS name,
                   TRUE AS is_active,
                   NULL::timestamptz AS created_at,
                   NULL::timestamptz AS updated_at,
                   1 AS source_rank
               FROM patients p
               WHERE p.insurance_provider IS NOT NULL
                 AND btrim(p.insurance_provider) <> ''
                 AND NOT EXISTS (
                     SELECT 1
                     FROM insurance_providers ip
                     WHERE ip.normalized_name = lower(regexp_replace(btrim(p.insurance_provider), '[[:space:]]+', ' ', 'g'))
                 )
           ),
           registry_options AS (
               SELECT id, name, is_active, created_at, updated_at, 0 AS source_rank
               FROM insurance_providers
               WHERE $1 OR is_active = TRUE
           ),
           ranked_options AS (
               SELECT DISTINCT ON (lower(regexp_replace(btrim(name), '[[:space:]]+', ' ', 'g')))
                   id, name, is_active, created_at, updated_at
               FROM (
                   SELECT * FROM registry_options
                   UNION ALL
                   SELECT * FROM patient_insurance_options
               ) options
               ORDER BY lower(regexp_replace(btrim(name), '[[:space:]]+', ' ', 'g')),
                        source_rank,
                        is_active DESC,
                        name
           )
           SELECT id, name, is_active, created_at, updated_at
           FROM ranked_options
           ORDER BY is_active DESC, name"#,
    )
    .bind(include_inactive)
    .fetch_all(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, "Failed to load insurance providers");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to load insurance providers",
        )
    })?;

    Ok(rows
        .into_iter()
        .map(|row| {
            let name = row.try_get::<String, _>("name").unwrap_or_default();
            let id = row
                .try_get::<Option<Uuid>, _>("id")
                .ok()
                .flatten()
                .map(|id| id.to_string())
                .unwrap_or_else(|| format!("patient-insurance:{name}"));
            json!({
                "id": id,
                "name": name,
                "is_active": row.try_get::<bool, _>("is_active").unwrap_or(true),
                "created_at": row.try_get::<Option<chrono::DateTime<chrono::Utc>>, _>("created_at").ok().flatten().map(|v| v.to_rfc3339()).unwrap_or_default(),
                "updated_at": row.try_get::<Option<chrono::DateTime<chrono::Utc>>, _>("updated_at").ok().flatten().map(|v| v.to_rfc3339()).unwrap_or_default(),
            })
        })
        .collect())
}

async fn ensure_provider_staff_role_exists(
    state: &AppState,
    code: &str,
) -> Result<(), axum::response::Response> {
    let exists = sqlx::query_scalar::<_, bool>(
        r#"SELECT EXISTS (
               SELECT 1 FROM provider_staff_roles WHERE code = $1
           )"#,
    )
    .bind(code)
    .fetch_one(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, role = %code, "Failed to validate provider staff role");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to validate provider staff role",
        )
    })?;

    if exists {
        Ok(())
    } else {
        Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Provider staff role is invalid",
        ))
    }
}

async fn toggle_provider_staff_role_active(
    state: AppState,
    auth: AuthUser,
    role_id: Uuid,
    is_active: bool,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::Ceo, Role::PatientManager]) {
        return e;
    }

    match sqlx::query(
        "UPDATE provider_staff_roles SET is_active = $2, updated_at = now() WHERE id = $1",
    )
    .bind(role_id)
    .bind(is_active)
    .execute(&state.db)
    .await
    {
        Ok(result) if result.rows_affected() > 0 => {}
        Ok(_) => return err(StatusCode::NOT_FOUND, "Provider staff role not found"),
        Err(e) => {
            tracing::error!(error = %e, role_id = %role_id, "Failed to toggle provider staff role");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to update provider staff role",
            );
        }
    }

    let action = if is_active {
        "activate_provider_staff_role"
    } else {
        "deactivate_provider_staff_role"
    };
    let _ = audit(
        &state,
        auth.user_id,
        action,
        "provider_staff_role",
        Some(role_id),
        Some(json!({ "role_id": role_id, "is_active": is_active })),
    )
    .await;

    Json(json!({ "ok": true })).into_response()
}

async fn load_provider_specializations_json(
    state: &AppState,
    provider_id: Uuid,
) -> Result<Vec<serde_json::Value>, axum::response::Response> {
    let rows = sqlx::query(
        r#"SELECT ms.id, ms.code, ms.name_en, ms.name_de, ms.name_ru, ms.is_active, ms.sort_order, ps.is_primary
           FROM provider_specializations ps
           JOIN medical_specializations ms ON ms.id = ps.specialization_id
           WHERE ps.provider_id = $1
           ORDER BY ps.is_primary DESC, ms.sort_order, COALESCE(ms.name_de, ms.name_en), ms.name_en"#,
    )
    .bind(provider_id)
    .fetch_all(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, provider_id = %provider_id, "Failed to load provider specializations");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to load provider specializations",
        )
    })?;

    Ok(rows
        .into_iter()
        .map(|row| {
            json!({
                "id": row.try_get::<Uuid, _>("id").unwrap_or_default(),
                "code": row.try_get::<String, _>("code").unwrap_or_default(),
                "name_en": row.try_get::<String, _>("name_en").unwrap_or_default(),
                "name_de": row.try_get::<Option<String>, _>("name_de").unwrap_or_default(),
                "name_ru": row.try_get::<Option<String>, _>("name_ru").unwrap_or_default(),
                "is_active": row.try_get::<bool, _>("is_active").unwrap_or(true),
                "sort_order": row.try_get::<i32, _>("sort_order").unwrap_or_default(),
                "is_primary": row.try_get::<bool, _>("is_primary").unwrap_or(false),
            })
        })
        .collect())
}

async fn load_provider_insurances_json(
    state: &AppState,
    provider_id: Uuid,
) -> Result<Vec<serde_json::Value>, axum::response::Response> {
    let rows = sqlx::query(
        r#"SELECT ip.id, ip.name, ip.is_active
           FROM provider_insurances pi
           JOIN insurance_providers ip ON ip.id = pi.insurance_provider_id
           WHERE pi.provider_id = $1
           ORDER BY ip.name"#,
    )
    .bind(provider_id)
    .fetch_all(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, provider_id = %provider_id, "Failed to load provider insurance providers");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to load provider insurance providers",
        )
    })?;

    Ok(rows
        .into_iter()
        .map(|row| {
            json!({
                "id": row.try_get::<Uuid, _>("id").unwrap_or_default(),
                "name": row.try_get::<String, _>("name").unwrap_or_default(),
                "is_active": row.try_get::<bool, _>("is_active").unwrap_or(true),
            })
        })
        .collect())
}

async fn load_provider_taxonomy_nodes_json(
    state: &AppState,
    include_inactive: bool,
    provider_type: Option<&str>,
) -> Result<serde_json::Value, axum::response::Response> {
    let rows = sqlx::query(
        r#"SELECT id, parent_id, code, level, provider_kind, name_de, name_ru, description,
                  filter_keys, is_active, sort_order, created_at, updated_at,
                  NOT EXISTS (
                    SELECT 1
                    FROM provider_taxonomy_nodes child
                    WHERE child.parent_id = provider_taxonomy_nodes.id
                      AND ($1::bool = true OR child.is_active = true)
                  ) AS is_leaf
           FROM provider_taxonomy_nodes
           WHERE ($1::bool = true OR is_active = true)
             AND ($2::text IS NULL OR provider_kind = $2)
           ORDER BY sort_order, name_de, code"#,
    )
    .bind(include_inactive)
    .bind(provider_type)
    .fetch_all(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, "Failed to load provider taxonomy");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to load provider taxonomy",
        )
    })?;

    let nodes = rows
        .iter()
        .map(|row| taxonomy_node_json(row, None))
        .collect::<Vec<_>>();
    let leaves = rows
        .iter()
        .filter(|row| row.try_get::<String, _>("level").unwrap_or_default() == "type")
        .map(|row| taxonomy_node_json(row, None))
        .collect::<Vec<_>>();

    Ok(json!({
        "nodes": nodes,
        "leaves": leaves,
    }))
}

async fn load_provider_taxonomy_json(
    state: &AppState,
    provider_id: Uuid,
) -> Result<serde_json::Value, axum::response::Response> {
    let rows = sqlx::query(
        r#"SELECT ptn.id, ptn.parent_id, ptn.code, ptn.level, ptn.provider_kind,
                  ptn.name_de, ptn.name_ru, ptn.description, ptn.filter_keys,
                  ptn.is_active, ptn.sort_order, ptn.created_at, ptn.updated_at,
                  pta.is_primary,
                  NOT EXISTS (
                    SELECT 1
                    FROM provider_taxonomy_nodes child
                    WHERE child.parent_id = ptn.id
                      AND child.is_active = true
                  ) AS is_leaf
           FROM provider_taxonomy_assignments pta
           JOIN provider_taxonomy_nodes ptn ON ptn.id = pta.taxonomy_node_id
           WHERE pta.provider_id = $1
           ORDER BY pta.is_primary DESC, ptn.sort_order, ptn.name_de"#,
    )
    .bind(provider_id)
    .fetch_all(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, provider_id = %provider_id, "Failed to load provider taxonomy");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to load provider taxonomy",
        )
    })?;

    let nodes = rows
        .iter()
        .map(|row| taxonomy_node_json(row, row.try_get::<bool, _>("is_primary").ok()))
        .collect::<Vec<_>>();
    let primary_id = rows
        .iter()
        .find(|row| row.try_get::<bool, _>("is_primary").unwrap_or(false))
        .or_else(|| rows.first())
        .and_then(|row| row.try_get::<Uuid, _>("id").ok());
    let primary_id_text = primary_id.map(|id| id.to_string());
    let primary_node = primary_id_text.as_deref().and_then(|id| {
        nodes
            .iter()
            .find(|node| node.get("id").and_then(Value::as_str) == Some(id))
            .cloned()
    });
    let taxonomy_path = match primary_id {
        Some(id) => load_taxonomy_path_json(state, id).await?,
        None => Vec::new(),
    };
    let taxonomy_node_ids = rows
        .iter()
        .filter_map(|row| row.try_get::<Uuid, _>("id").ok())
        .collect::<Vec<_>>();

    // Filtering set = every directly-assigned node PLUS all of its ancestors, for
    // ALL assignments (not just the primary). The frontend taxonomy filter matches
    // a selected parent/category against this set, so providers reachable only via a
    // non-primary assignment's ancestor are no longer dropped. Kept separate from
    // `taxonomy_node_ids` (the directly-assigned set used for create/update round-trips).
    let taxonomy_filter_ids = sqlx::query_scalar::<_, Uuid>(
        r#"WITH RECURSIVE assigned AS (
                SELECT taxonomy_node_id AS id
                FROM provider_taxonomy_assignments
                WHERE provider_id = $1
            ),
            chain AS (
                SELECT node.id, node.parent_id
                FROM provider_taxonomy_nodes node
                JOIN assigned a ON a.id = node.id
                UNION
                SELECT parent.id, parent.parent_id
                FROM provider_taxonomy_nodes parent
                JOIN chain c ON c.parent_id = parent.id
            )
            SELECT DISTINCT id FROM chain"#,
    )
    .bind(provider_id)
    .fetch_all(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, provider_id = %provider_id, "Failed to load provider taxonomy filter ids");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to load provider taxonomy",
        )
    })?;

    Ok(json!({
        "taxonomy_node_id": primary_id,
        "taxonomy_node": primary_node,
        "taxonomy_path": taxonomy_path,
        "taxonomy_node_ids": taxonomy_node_ids,
        "taxonomy_filter_ids": taxonomy_filter_ids,
        "taxonomy_nodes": nodes,
    }))
}

async fn load_taxonomy_path_json(
    state: &AppState,
    taxonomy_node_id: Uuid,
) -> Result<Vec<serde_json::Value>, axum::response::Response> {
    let rows = sqlx::query(
        r#"WITH RECURSIVE ancestors AS (
                SELECT id, parent_id, code, level, provider_kind, name_de, name_ru, description,
                       filter_keys, is_active, sort_order, created_at, updated_at, 0 AS depth
                FROM provider_taxonomy_nodes
                WHERE id = $1

                UNION ALL

                SELECT parent.id, parent.parent_id, parent.code, parent.level, parent.provider_kind,
                       parent.name_de, parent.name_ru, parent.description, parent.filter_keys,
                       parent.is_active, parent.sort_order, parent.created_at, parent.updated_at,
                       child.depth + 1
                FROM provider_taxonomy_nodes parent
                JOIN ancestors child ON child.parent_id = parent.id
            )
            SELECT id, parent_id, code, level, provider_kind, name_de, name_ru, description,
                   filter_keys, is_active, sort_order, created_at, updated_at,
                   NOT EXISTS (
                    SELECT 1
                    FROM provider_taxonomy_nodes child
                    WHERE child.parent_id = ancestors.id
                      AND child.is_active = true
                   ) AS is_leaf
            FROM ancestors
            ORDER BY depth DESC"#,
    )
    .bind(taxonomy_node_id)
    .fetch_all(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, taxonomy_node_id = %taxonomy_node_id, "Failed to load taxonomy path");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to load provider taxonomy",
        )
    })?;

    Ok(rows
        .iter()
        .map(|row| taxonomy_node_json(row, None))
        .collect())
}

fn taxonomy_node_json(row: &PgRow, is_primary: Option<bool>) -> serde_json::Value {
    let name_de = row.try_get::<String, _>("name_de").unwrap_or_default();
    json!({
        "id": row.try_get::<Uuid, _>("id").unwrap_or_default(),
        "parent_id": row.try_get::<Option<Uuid>, _>("parent_id").unwrap_or_default(),
        "code": row.try_get::<String, _>("code").unwrap_or_default(),
        "level": row.try_get::<String, _>("level").unwrap_or_default(),
        "provider_kind": row.try_get::<String, _>("provider_kind").unwrap_or_default(),
        "name_en": name_de.clone(),
        "name_de": name_de,
        "name_ru": row.try_get::<Option<String>, _>("name_ru").unwrap_or_default(),
        "description": row.try_get::<Option<String>, _>("description").unwrap_or_default(),
        "filter_keys": row.try_get::<Vec<String>, _>("filter_keys").unwrap_or_default(),
        "is_leaf": row.try_get::<bool, _>("is_leaf").unwrap_or(false),
        "is_assignable": row.try_get::<String, _>("level").unwrap_or_default() == "type",
        "is_primary": is_primary,
        "is_active": row.try_get::<bool, _>("is_active").unwrap_or(true),
        "sort_order": row.try_get::<i32, _>("sort_order").unwrap_or_default(),
        "created_at": row.try_get::<chrono::DateTime<chrono::Utc>, _>("created_at").map(|v| v.to_rfc3339()).unwrap_or_default(),
        "updated_at": row.try_get::<chrono::DateTime<chrono::Utc>, _>("updated_at").map(|v| v.to_rfc3339()).unwrap_or_default(),
    })
}

async fn load_doctor_specializations_json(
    state: &AppState,
    doctor_id: Uuid,
) -> Result<Vec<serde_json::Value>, axum::response::Response> {
    let rows = sqlx::query(
        r#"SELECT ms.id, ms.code, ms.name_en, ms.name_de, ms.name_ru, ms.is_active, ms.sort_order, ds.is_primary
           FROM provider_doctor_specializations ds
           JOIN medical_specializations ms ON ms.id = ds.specialization_id
           WHERE ds.doctor_id = $1
           ORDER BY ds.is_primary DESC, ms.sort_order, COALESCE(ms.name_de, ms.name_en), ms.name_en"#,
    )
    .bind(doctor_id)
    .fetch_all(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, doctor_id = %doctor_id, "Failed to load doctor specializations");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to load doctor specializations",
        )
    })?;

    Ok(rows
        .into_iter()
        .map(|row| {
            json!({
                "id": row.try_get::<Uuid, _>("id").unwrap_or_default(),
                "code": row.try_get::<String, _>("code").unwrap_or_default(),
                "name_en": row.try_get::<String, _>("name_en").unwrap_or_default(),
                "name_de": row.try_get::<Option<String>, _>("name_de").unwrap_or_default(),
                "name_ru": row.try_get::<Option<String>, _>("name_ru").unwrap_or_default(),
                "is_active": row.try_get::<bool, _>("is_active").unwrap_or(true),
                "sort_order": row.try_get::<i32, _>("sort_order").unwrap_or_default(),
                "is_primary": row.try_get::<bool, _>("is_primary").unwrap_or(false),
            })
        })
        .collect())
}

async fn load_doctor_insurances_json(
    state: &AppState,
    doctor_id: Uuid,
) -> Result<Vec<serde_json::Value>, axum::response::Response> {
    let rows = sqlx::query(
        r#"SELECT ip.id, ip.name, ip.is_active
           FROM provider_doctor_insurances di
           JOIN insurance_providers ip ON ip.id = di.insurance_provider_id
           WHERE di.doctor_id = $1
           ORDER BY ip.name"#,
    )
    .bind(doctor_id)
    .fetch_all(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, doctor_id = %doctor_id, "Failed to load doctor insurance providers");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to load doctor insurance providers",
        )
    })?;

    Ok(rows
        .into_iter()
        .map(|row| {
            json!({
                "id": row.try_get::<Uuid, _>("id").unwrap_or_default(),
                "name": row.try_get::<String, _>("name").unwrap_or_default(),
                "is_active": row.try_get::<bool, _>("is_active").unwrap_or(true),
            })
        })
        .collect())
}

async fn sync_provider_specializations_tx(
    tx: &mut Transaction<'_, Postgres>,
    provider_id: Uuid,
    provider_type: &str,
    values: &[String],
) -> Result<(), axum::response::Response> {
    if provider_type == "non_medical" && !values.is_empty() {
        return Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Specializations are only allowed for medical providers",
        ));
    }

    let specialization_ids = upsert_specialization_ids_tx(tx, values).await?;
    sqlx::query("DELETE FROM provider_specializations WHERE provider_id = $1")
        .bind(provider_id)
        .execute(&mut **tx)
        .await
        .map_err(|e| {
            tracing::error!(error = %e, provider_id = %provider_id, "Failed to replace provider specializations");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to update provider specializations",
            )
        })?;
    for (index, specialization_id) in specialization_ids.into_iter().enumerate() {
        sqlx::query(
            r#"INSERT INTO provider_specializations (provider_id, specialization_id, is_primary)
               VALUES ($1, $2, $3)
               ON CONFLICT (provider_id, specialization_id)
               DO UPDATE SET is_primary = EXCLUDED.is_primary"#,
        )
        .bind(provider_id)
        .bind(specialization_id)
        .bind(index == 0)
        .execute(&mut **tx)
        .await
        .map_err(|e| {
            tracing::error!(error = %e, provider_id = %provider_id, specialization_id = %specialization_id, "Failed to insert provider specialization");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to update provider specializations",
            )
        })?;
    }
    Ok(())
}

async fn sync_provider_insurances_tx(
    tx: &mut Transaction<'_, Postgres>,
    provider_id: Uuid,
    provider_type: &str,
    values: &[String],
) -> Result<(), axum::response::Response> {
    if provider_type == "non_medical" && !values.is_empty() {
        return Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Insurance providers are only allowed for medical providers",
        ));
    }

    let insurance_provider_ids = upsert_insurance_provider_ids_tx(tx, values).await?;
    sqlx::query("DELETE FROM provider_insurances WHERE provider_id = $1")
        .bind(provider_id)
        .execute(&mut **tx)
        .await
        .map_err(|e| {
            tracing::error!(error = %e, provider_id = %provider_id, "Failed to replace provider insurance providers");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to update provider insurance providers",
            )
        })?;
    for insurance_provider_id in insurance_provider_ids {
        sqlx::query(
            r#"INSERT INTO provider_insurances (provider_id, insurance_provider_id)
               VALUES ($1, $2)
               ON CONFLICT (provider_id, insurance_provider_id) DO NOTHING"#,
        )
        .bind(provider_id)
        .bind(insurance_provider_id)
        .execute(&mut **tx)
        .await
        .map_err(|e| {
            tracing::error!(error = %e, provider_id = %provider_id, insurance_provider_id = %insurance_provider_id, "Failed to insert provider insurance provider");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to update provider insurance providers",
            )
        })?;
    }
    Ok(())
}

async fn validate_provider_taxonomy_nodes(
    state: &AppState,
    provider_type: &str,
    values: &[Uuid],
) -> Result<(), axum::response::Response> {
    if values.is_empty() {
        return Ok(());
    }

    let valid_count = sqlx::query_scalar::<_, i64>(
        r#"SELECT COUNT(*)::bigint
           FROM provider_taxonomy_nodes
           WHERE id = ANY($1)
             AND provider_kind = $2
             AND level = 'type'
             AND is_active = true"#,
    )
    .bind(values)
    .bind(provider_type)
    .fetch_one(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, "Failed to validate provider taxonomy");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to validate provider taxonomy",
        )
    })?;

    if valid_count == values.len() as i64 {
        Ok(())
    } else {
        Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Provider taxonomy node must be an active leaf for provider type",
        ))
    }
}

async fn validate_service_taxonomy_node(
    state: &AppState,
    provider_type: &str,
    taxonomy_node_id: Option<Uuid>,
) -> Result<(), axum::response::Response> {
    let Some(taxonomy_node_id) = taxonomy_node_id else {
        return Ok(());
    };

    let exists = sqlx::query_scalar::<_, bool>(
        r#"SELECT EXISTS (
               SELECT 1
               FROM provider_taxonomy_nodes
               WHERE id = $1
                 AND provider_kind = $2
                 AND level = 'type'
                 AND is_active = true
           )"#,
    )
    .bind(taxonomy_node_id)
    .bind(provider_type)
    .fetch_one(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, taxonomy_node_id = %taxonomy_node_id, "Failed to validate service taxonomy");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to validate service taxonomy",
        )
    })?;

    if exists {
        Ok(())
    } else {
        Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Service taxonomy node must be an active leaf for provider type",
        ))
    }
}

async fn sync_provider_taxonomy_tx(
    tx: &mut Transaction<'_, Postgres>,
    provider_id: Uuid,
    taxonomy_node_ids: &[Uuid],
    primary_taxonomy_node_id: Option<Uuid>,
) -> Result<(), axum::response::Response> {
    sqlx::query("DELETE FROM provider_taxonomy_assignments WHERE provider_id = $1")
        .bind(provider_id)
        .execute(&mut **tx)
        .await
        .map_err(|e| {
            tracing::error!(error = %e, provider_id = %provider_id, "Failed to replace provider taxonomy");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to update provider taxonomy",
            )
        })?;

    let primary = primary_taxonomy_node_id.or_else(|| taxonomy_node_ids.first().copied());
    for taxonomy_node_id in taxonomy_node_ids {
        sqlx::query(
            r#"INSERT INTO provider_taxonomy_assignments (
                    provider_id, taxonomy_node_id, is_primary
               ) VALUES ($1, $2, $3)"#,
        )
        .bind(provider_id)
        .bind(taxonomy_node_id)
        .bind(Some(*taxonomy_node_id) == primary)
        .execute(&mut **tx)
        .await
        .map_err(|e| {
            tracing::error!(error = %e, provider_id = %provider_id, taxonomy_node_id = %taxonomy_node_id, "Failed to insert provider taxonomy");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to update provider taxonomy",
            )
        })?;
    }

    Ok(())
}

async fn ensure_provider_taxonomy_for_type_tx(
    tx: &mut Transaction<'_, Postgres>,
    provider_id: Uuid,
    provider_type: &str,
) -> Result<(), axum::response::Response> {
    let has_matching_taxonomy = sqlx::query_scalar::<_, bool>(
        r#"SELECT EXISTS (
               SELECT 1
               FROM provider_taxonomy_assignments pta
               JOIN provider_taxonomy_nodes ptn ON ptn.id = pta.taxonomy_node_id
               WHERE pta.provider_id = $1
                 AND ptn.provider_kind = $2
                 AND ptn.level = 'type'
           )"#,
    )
    .bind(provider_id)
    .bind(provider_type)
    .fetch_one(&mut **tx)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, provider_id = %provider_id, "Failed to validate provider taxonomy");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to update provider taxonomy",
        )
    })?;

    if has_matching_taxonomy {
        return Ok(());
    }

    let default_code = default_provider_taxonomy_code(provider_type);
    let Some(default_code) = default_code else {
        return Ok(());
    };
    let taxonomy_node_id = sqlx::query_scalar::<_, Uuid>(
        r#"SELECT id
           FROM provider_taxonomy_nodes
           WHERE code = $1
             AND provider_kind = $2
             AND level = 'type'
             AND is_active = true"#,
    )
    .bind(default_code)
    .bind(provider_type)
    .fetch_one(&mut **tx)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, provider_type = %provider_type, "Failed to load default provider taxonomy");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to update provider taxonomy",
        )
    })?;

    sync_provider_taxonomy_tx(tx, provider_id, &[taxonomy_node_id], Some(taxonomy_node_id)).await
}

fn default_provider_taxonomy_code(provider_type: &str) -> Option<&'static str> {
    match provider_type {
        "medical" => Some("medical_clinics_practices_specialized_centers"),
        "non_medical" => Some("nonmedical_other"),
        _ => None,
    }
}

async fn clear_provider_doctor_specializations_tx(
    tx: &mut Transaction<'_, Postgres>,
    provider_id: Uuid,
) -> Result<(), axum::response::Response> {
    sqlx::query(
        r#"DELETE FROM provider_doctor_specializations
           WHERE doctor_id IN (
               SELECT id FROM provider_doctors WHERE provider_id = $1
           )"#,
    )
    .bind(provider_id)
    .execute(&mut **tx)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, provider_id = %provider_id, "Failed to clear provider doctor specializations");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to update doctor specializations",
        )
    })?;
    Ok(())
}

async fn clear_provider_doctor_insurances_tx(
    tx: &mut Transaction<'_, Postgres>,
    provider_id: Uuid,
) -> Result<(), axum::response::Response> {
    sqlx::query(
        r#"DELETE FROM provider_doctor_insurances
           WHERE doctor_id IN (
               SELECT id FROM provider_doctors WHERE provider_id = $1
           )"#,
    )
    .bind(provider_id)
    .execute(&mut **tx)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, provider_id = %provider_id, "Failed to clear provider doctor insurance providers");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to update doctor insurance providers",
        )
    })?;
    Ok(())
}

async fn sync_doctor_specializations_tx(
    tx: &mut Transaction<'_, Postgres>,
    doctor_id: Uuid,
    provider_type: &str,
    values: &[String],
) -> Result<(), axum::response::Response> {
    if provider_type == "non_medical" && !values.is_empty() {
        return Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Doctor specializations are only allowed for medical providers",
        ));
    }

    let specialization_ids = upsert_specialization_ids_tx(tx, values).await?;
    sqlx::query("DELETE FROM provider_doctor_specializations WHERE doctor_id = $1")
        .bind(doctor_id)
        .execute(&mut **tx)
        .await
        .map_err(|e| {
            tracing::error!(error = %e, doctor_id = %doctor_id, "Failed to replace doctor specializations");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to update doctor specializations",
            )
        })?;
    for (index, specialization_id) in specialization_ids.into_iter().enumerate() {
        sqlx::query(
            r#"INSERT INTO provider_doctor_specializations (doctor_id, specialization_id, is_primary)
               VALUES ($1, $2, $3)
               ON CONFLICT (doctor_id, specialization_id)
               DO UPDATE SET is_primary = EXCLUDED.is_primary"#,
        )
        .bind(doctor_id)
        .bind(specialization_id)
        .bind(index == 0)
        .execute(&mut **tx)
        .await
        .map_err(|e| {
            tracing::error!(error = %e, doctor_id = %doctor_id, specialization_id = %specialization_id, "Failed to insert doctor specialization");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to update doctor specializations",
            )
        })?;
    }
    Ok(())
}

async fn sync_doctor_insurances_tx(
    tx: &mut Transaction<'_, Postgres>,
    doctor_id: Uuid,
    provider_type: &str,
    values: &[String],
) -> Result<(), axum::response::Response> {
    if provider_type == "non_medical" && !values.is_empty() {
        return Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Doctor insurance providers are only allowed for medical providers",
        ));
    }

    let insurance_provider_ids = upsert_insurance_provider_ids_tx(tx, values).await?;
    sqlx::query("DELETE FROM provider_doctor_insurances WHERE doctor_id = $1")
        .bind(doctor_id)
        .execute(&mut **tx)
        .await
        .map_err(|e| {
            tracing::error!(error = %e, doctor_id = %doctor_id, "Failed to replace doctor insurance providers");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to update doctor insurance providers",
            )
        })?;
    for insurance_provider_id in insurance_provider_ids {
        sqlx::query(
            r#"INSERT INTO provider_doctor_insurances (doctor_id, insurance_provider_id)
               VALUES ($1, $2)
               ON CONFLICT (doctor_id, insurance_provider_id) DO NOTHING"#,
        )
        .bind(doctor_id)
        .bind(insurance_provider_id)
        .execute(&mut **tx)
        .await
        .map_err(|e| {
            tracing::error!(error = %e, doctor_id = %doctor_id, insurance_provider_id = %insurance_provider_id, "Failed to insert doctor insurance provider");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to update doctor insurance providers",
            )
        })?;
    }
    Ok(())
}

async fn upsert_specialization_ids_tx(
    tx: &mut Transaction<'_, Postgres>,
    values: &[String],
) -> Result<Vec<Uuid>, axum::response::Response> {
    let mut ids = Vec::new();
    for value in values {
        let label = value.trim();
        if label.is_empty() {
            continue;
        }
        let code = specialization_code(label);
        let existing = sqlx::query_scalar::<_, Uuid>(
            r#"SELECT id
               FROM medical_specializations
               WHERE deleted_at IS NULL
                 AND (
                    code = $1
                    OR lower(name_en) = lower($2)
                    OR lower(COALESCE(name_de, '')) = lower($2)
                    OR lower(COALESCE(name_ru, '')) = lower($2)
                 )
               ORDER BY is_active DESC, sort_order, name_en
               LIMIT 1"#,
        )
        .bind(&code)
        .bind(label)
        .fetch_optional(&mut **tx)
        .await
        .map_err(|e| {
            tracing::error!(error = %e, specialization = %label, "Failed to resolve specialization");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to update specializations",
            )
        })?;
        if let Some(id) = existing {
            if !ids.contains(&id) {
                ids.push(id);
            }
            continue;
        }

        let row = sqlx::query(
            r#"INSERT INTO medical_specializations (code, name_en, name_de, name_ru, sort_order)
               VALUES ($1, $2, $2, $2, 900)
               ON CONFLICT (code) DO UPDATE
               SET name_en = EXCLUDED.name_en,
                   name_de = COALESCE(medical_specializations.name_de, EXCLUDED.name_de),
                   name_ru = COALESCE(medical_specializations.name_ru, EXCLUDED.name_ru),
                   is_active = TRUE,
                   deleted_at = NULL,
                   updated_at = now()
               RETURNING id"#,
        )
        .bind(code)
        .bind(label)
        .fetch_one(&mut **tx)
        .await
        .map_err(|e| {
            tracing::error!(error = %e, specialization = %label, "Failed to upsert specialization");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to update specializations",
            )
        })?;
        let id: Uuid = row.try_get("id").map_err(|_| {
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to decode specialization",
            )
        })?;
        if !ids.contains(&id) {
            ids.push(id);
        }
    }
    Ok(ids)
}

async fn upsert_insurance_provider_ids_tx(
    tx: &mut Transaction<'_, Postgres>,
    values: &[String],
) -> Result<Vec<Uuid>, axum::response::Response> {
    let mut ids = Vec::new();
    for value in values {
        let label = value.trim();
        if label.is_empty() {
            continue;
        }
        let row = sqlx::query(
            r#"INSERT INTO insurance_providers (name)
               VALUES ($1)
               ON CONFLICT (normalized_name) DO UPDATE
               SET name = EXCLUDED.name,
                   is_active = TRUE,
                   updated_at = now()
               RETURNING id"#,
        )
        .bind(label)
        .fetch_one(&mut **tx)
        .await
        .map_err(|e| {
            tracing::error!(error = %e, insurance_provider = %label, "Failed to upsert insurance provider");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to update insurance providers",
            )
        })?;
        let id: Uuid = row.try_get("id").map_err(|_| {
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to decode insurance provider",
            )
        })?;
        if !ids.contains(&id) {
            ids.push(id);
        }
    }
    Ok(ids)
}

fn specialization_code(label: &str) -> String {
    let mut code = String::new();
    let mut previous_was_separator = false;
    for ch in label.trim().to_lowercase().chars() {
        if ch.is_alphanumeric() {
            code.push(ch);
            previous_was_separator = false;
        } else if !previous_was_separator {
            code.push('_');
            previous_was_separator = true;
        }
    }
    let code = code.trim_matches('_').to_string();
    if code.is_empty() {
        format!("custom_{}", Uuid::new_v4().simple())
    } else {
        code
    }
}

fn staff_role_code(label: &str) -> String {
    specialization_code(label)
}

fn is_unique_violation(error: &sqlx::Error) -> bool {
    error
        .as_database_error()
        .and_then(|db_error| db_error.code())
        .is_some_and(|code| code == "23505")
}

async fn replace_provider_contacts_tx(
    tx: &mut Transaction<'_, Postgres>,
    provider_id: Uuid,
    contacts: &[ProviderContactPayload],
) -> Result<(), axum::response::Response> {
    sqlx::query("DELETE FROM provider_contacts WHERE provider_id = $1")
        .bind(provider_id)
        .execute(&mut **tx)
        .await
        .map_err(|e| {
            tracing::error!(error = %e, provider_id = %provider_id, "Failed to clear provider contacts");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to update provider contacts",
            )
        })?;

    for contact in contacts {
        sqlx::query(
            r#"INSERT INTO provider_contacts (
                    provider_id, label, department, contact_kind, contact_type,
                    value, is_primary, notes
               ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)"#,
        )
        .bind(provider_id)
        .bind(&contact.label)
        .bind(&contact.department)
        .bind(&contact.contact_kind)
        .bind(&contact.contact_type)
        .bind(&contact.value)
        .bind(contact.is_primary)
        .bind(&contact.notes)
        .execute(&mut **tx)
        .await
        .map_err(|e| {
            tracing::error!(error = %e, provider_id = %provider_id, "Failed to insert provider contact");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to update provider contacts",
            )
        })?;
    }

    Ok(())
}

async fn replace_person_contacts_tx(
    tx: &mut Transaction<'_, Postgres>,
    provider_id: Uuid,
    doctor_id: Option<Uuid>,
    staff_id: Option<Uuid>,
    contacts: &[PersonContactPayload],
) -> Result<(), axum::response::Response> {
    let delete_sql = if doctor_id.is_some() {
        "DELETE FROM provider_person_contacts WHERE doctor_id = $1"
    } else {
        "DELETE FROM provider_person_contacts WHERE staff_id = $1"
    };
    sqlx::query(delete_sql)
        .bind(doctor_id.or(staff_id))
        .execute(&mut **tx)
        .await
        .map_err(|e| {
            tracing::error!(error = %e, provider_id = %provider_id, "Failed to clear person contacts");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to update person contacts",
            )
        })?;

    for contact in contacts {
        sqlx::query(
            r#"INSERT INTO provider_person_contacts (
                    provider_id, doctor_id, staff_id, contact_kind, contact_type,
                    value, is_primary, notes
               ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)"#,
        )
        .bind(provider_id)
        .bind(doctor_id)
        .bind(staff_id)
        .bind(&contact.contact_kind)
        .bind(&contact.contact_type)
        .bind(&contact.value)
        .bind(contact.is_primary)
        .bind(&contact.notes)
        .execute(&mut **tx)
        .await
        .map_err(|e| {
            tracing::error!(error = %e, provider_id = %provider_id, "Failed to insert person contact");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to update person contacts",
            )
        })?;
    }

    Ok(())
}

async fn load_provider_contacts_json(
    state: &AppState,
    provider_id: Uuid,
    fallback_phone: Option<String>,
    fallback_email: Option<String>,
) -> Result<Vec<serde_json::Value>, axum::response::Response> {
    let rows = sqlx::query(
        r#"SELECT id, label, department, contact_kind, contact_type, value, is_primary, notes, created_at
           FROM provider_contacts
           WHERE provider_id = $1
           ORDER BY contact_kind, is_primary DESC, contact_type, department NULLS LAST, created_at"#,
    )
    .bind(provider_id)
    .fetch_all(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, provider_id = %provider_id, "Failed to load provider contacts");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to load provider contacts",
        )
    })?;

    if rows.is_empty() {
        let mut contacts = Vec::new();
        if let Some(value) = fallback_phone.filter(|value| !value.trim().is_empty()) {
            contacts.push(json!({
                "id": Value::Null,
                "label": Value::Null,
                "department": Value::Null,
                "contact_kind": "phone",
                "contact_type": "work",
                "value": value,
                "is_primary": true,
                "notes": Value::Null,
            }));
        }
        if let Some(value) = fallback_email.filter(|value| !value.trim().is_empty()) {
            contacts.push(json!({
                "id": Value::Null,
                "label": Value::Null,
                "department": Value::Null,
                "contact_kind": "email",
                "contact_type": "work",
                "value": value,
                "is_primary": true,
                "notes": Value::Null,
            }));
        }
        return Ok(contacts);
    }

    Ok(rows
        .into_iter()
        .map(|row| {
            json!({
                "id": row.try_get::<Uuid, _>("id").ok(),
                "label": row.try_get::<Option<String>, _>("label").unwrap_or_default(),
                "department": row.try_get::<Option<String>, _>("department").unwrap_or_default(),
                "contact_kind": row.try_get::<String, _>("contact_kind").unwrap_or_default(),
                "contact_type": row.try_get::<String, _>("contact_type").unwrap_or_else(|_| "work".to_string()),
                "value": row.try_get::<String, _>("value").unwrap_or_default(),
                "is_primary": row.try_get::<bool, _>("is_primary").unwrap_or(false),
                "notes": row.try_get::<Option<String>, _>("notes").unwrap_or_default(),
            })
        })
        .collect())
}

async fn load_person_contacts_json(
    state: &AppState,
    provider_id: Uuid,
    doctor_id: Option<Uuid>,
    staff_id: Option<Uuid>,
    fallback_phone: Option<String>,
    fallback_email: Option<String>,
) -> Result<Vec<serde_json::Value>, axum::response::Response> {
    let rows = sqlx::query(
        r#"SELECT id, contact_kind, contact_type, value, is_primary, notes, created_at
           FROM provider_person_contacts
           WHERE provider_id = $1
             AND ($2::uuid IS NULL OR doctor_id = $2)
             AND ($3::uuid IS NULL OR staff_id = $3)
           ORDER BY contact_kind, is_primary DESC, contact_type, created_at"#,
    )
    .bind(provider_id)
    .bind(doctor_id)
    .bind(staff_id)
    .fetch_all(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, provider_id = %provider_id, "Failed to load person contacts");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to load person contacts",
        )
    })?;

    if rows.is_empty()
        && let Some(contacts) = legacy_contacts_from_fields(fallback_phone, fallback_email)
    {
        return Ok(contacts
            .into_iter()
            .map(|contact| {
                json!({
                    "id": Value::Null,
                    "contact_kind": contact.contact_kind,
                    "contact_type": contact.contact_type,
                    "value": contact.value,
                    "is_primary": contact.is_primary,
                    "notes": contact.notes,
                })
            })
            .collect());
    }

    Ok(rows
        .into_iter()
        .map(|row| {
            json!({
                "id": row.try_get::<Uuid, _>("id").ok(),
                "contact_kind": row.try_get::<String, _>("contact_kind").unwrap_or_default(),
                "contact_type": row.try_get::<String, _>("contact_type").unwrap_or_else(|_| "work".to_string()),
                "value": row.try_get::<String, _>("value").unwrap_or_default(),
                "is_primary": row.try_get::<bool, _>("is_primary").unwrap_or(false),
                "notes": row.try_get::<Option<String>, _>("notes").unwrap_or_default(),
            })
        })
        .collect())
}

async fn load_doctor_relationships_json(
    state: &AppState,
    doctor_id: Uuid,
) -> Result<Vec<serde_json::Value>, axum::response::Response> {
    let rows = sqlx::query(
        r#"SELECT r.id, r.source_doctor_id, r.target_doctor_id, r.relationship_type,
                  r.description, r.notes, r.is_active, r.created_at, r.updated_at,
                  target.name AS target_doctor_name,
                  target.title AS target_doctor_title,
                  target.provider_id AS target_provider_id,
                  provider.name AS target_provider_name
           FROM provider_doctor_relationships r
           JOIN provider_doctors target ON target.id = r.target_doctor_id
           JOIN providers provider ON provider.id = target.provider_id
           WHERE r.source_doctor_id = $1
           ORDER BY r.is_active DESC, provider.name, target.name"#,
    )
    .bind(doctor_id)
    .fetch_all(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, doctor_id = %doctor_id, "Failed to load doctor relationships");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to load doctor relationships",
        )
    })?;

    Ok(rows
        .into_iter()
        .map(|row| {
            json!({
                "id": row.try_get::<Uuid, _>("id").unwrap_or_default(),
                "source_doctor_id": row.try_get::<Uuid, _>("source_doctor_id").unwrap_or(doctor_id),
                "target_doctor_id": row.try_get::<Uuid, _>("target_doctor_id").unwrap_or_default(),
                "target_doctor_name": row.try_get::<String, _>("target_doctor_name").unwrap_or_default(),
                "target_doctor_title": row.try_get::<Option<String>, _>("target_doctor_title").unwrap_or_default(),
                "target_provider_id": row.try_get::<Uuid, _>("target_provider_id").unwrap_or_default(),
                "target_provider_name": row.try_get::<String, _>("target_provider_name").unwrap_or_default(),
                "relationship_type": row.try_get::<String, _>("relationship_type").unwrap_or_else(|_| "professional".to_string()),
                "description": row.try_get::<Option<String>, _>("description").unwrap_or_default(),
                "notes": row.try_get::<Option<String>, _>("notes").unwrap_or_default(),
                "is_active": row.try_get::<bool, _>("is_active").unwrap_or(true),
                "created_at": row.try_get::<chrono::DateTime<chrono::Utc>, _>("created_at").map(|v| v.to_rfc3339()).unwrap_or_default(),
                "updated_at": row.try_get::<chrono::DateTime<chrono::Utc>, _>("updated_at").map(|v| v.to_rfc3339()).unwrap_or_default(),
            })
        })
        .collect())
}

async fn load_provider_staff_json(
    state: &AppState,
    provider_id: Uuid,
) -> Result<Vec<serde_json::Value>, axum::response::Response> {
    let rows = sqlx::query(
        r#"SELECT id, provider_id, first_name, last_name, display_name, role,
                  department, gender, opening_hours, status, notes, is_active, created_at, updated_at
           FROM provider_staff
           WHERE provider_id = $1
           ORDER BY is_active DESC, role, display_name"#,
    )
    .bind(provider_id)
    .fetch_all(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, provider_id = %provider_id, "Failed to load provider staff");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to load provider staff",
        )
    })?;

    let mut staff = Vec::with_capacity(rows.len());
    for row in rows {
        let staff_id = row.try_get::<Uuid, _>("id").unwrap_or_default();
        let contacts =
            match load_person_contacts_json(state, provider_id, None, Some(staff_id), None, None)
                .await
            {
                Ok(items) => items,
                Err(resp) => return Err(resp),
            };
        staff.push(json!({
            "id": staff_id,
            "provider_id": row.try_get::<Uuid, _>("provider_id").unwrap_or(provider_id),
            "first_name": row.try_get::<Option<String>, _>("first_name").unwrap_or_default(),
            "last_name": row.try_get::<Option<String>, _>("last_name").unwrap_or_default(),
            "display_name": row.try_get::<String, _>("display_name").unwrap_or_default(),
            "role": row.try_get::<String, _>("role").unwrap_or_default(),
            "department": row.try_get::<Option<String>, _>("department").unwrap_or_default(),
            "gender": row.try_get::<String, _>("gender").unwrap_or_else(|_| "unknown".to_string()),
            "opening_hours": row.try_get::<Option<String>, _>("opening_hours").unwrap_or_default(),
            "status": row.try_get::<String, _>("status").unwrap_or_else(|_| "active".to_string()),
            "notes": row.try_get::<Option<String>, _>("notes").unwrap_or_default(),
            "is_active": row.try_get::<bool, _>("is_active").unwrap_or(true),
            "contacts": contacts,
            "created_at": row.try_get::<chrono::DateTime<chrono::Utc>, _>("created_at").map(|v| v.to_rfc3339()).unwrap_or_default(),
            "updated_at": row.try_get::<chrono::DateTime<chrono::Utc>, _>("updated_at").map(|v| v.to_rfc3339()).unwrap_or_default(),
        }));
    }
    Ok(staff)
}

async fn load_provider_children_json(
    state: &AppState,
    provider_id: Uuid,
) -> Result<Vec<serde_json::Value>, axum::response::Response> {
    let rows = sqlx::query(
        r#"SELECT id, name, provider_type, organization_level, address_city, address_country, is_active
           FROM providers
           WHERE parent_provider_id = $1
           ORDER BY organization_level, name"#,
    )
    .bind(provider_id)
    .fetch_all(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, provider_id = %provider_id, "Failed to load provider children");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to load provider children",
        )
    })?;

    Ok(rows
        .into_iter()
        .map(|row| {
            json!({
                "id": row.try_get::<Uuid, _>("id").unwrap_or_default(),
                "name": row.try_get::<String, _>("name").unwrap_or_default(),
                "provider_type": row.try_get::<String, _>("provider_type").unwrap_or_default(),
                "organization_level": row.try_get::<String, _>("organization_level").unwrap_or_else(|_| "clinic".to_string()),
                "address_city": row.try_get::<Option<String>, _>("address_city").unwrap_or_default(),
                "address_country": row.try_get::<Option<String>, _>("address_country").unwrap_or_default(),
                "is_active": row.try_get::<bool, _>("is_active").unwrap_or(true),
            })
        })
        .collect())
}

async fn load_doctors_json(
    state: &AppState,
    provider_id: Uuid,
) -> Result<Vec<serde_json::Value>, axum::response::Response> {
    let rows = sqlx::query(
        r#"SELECT d.id, d.provider_id, d.shared_identity_id, d.name, d.first_name, d.last_name, d.display_name,
                  d.title, d.role_code, d.role_label, d.subrole, d.website, d.schwerpunkt, d.gender, d.opening_hours,
                  d.fachbereich, d.languages,
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
           ORDER BY CASE d.role_code
                      WHEN 'clinical_director' THEN 1
                      WHEN 'chefarzt' THEN 2
                      WHEN 'oberarzt' THEN 3
                      WHEN 'facharzt' THEN 4
                      WHEN 'assistenzarzt' THEN 5
                      ELSE 6
                    END,
                    d.name"#,
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
        let doctor_id = row.try_get::<Uuid, _>("id").unwrap_or_default();
        let (specializations, insurance_providers) = tokio::join!(
            load_doctor_specializations_json(state, doctor_id),
            load_doctor_insurances_json(state, doctor_id),
        );
        let specializations = specializations?;
        let insurance_providers = insurance_providers?;
        let phone = row
            .try_get::<Option<String>, _>("phone")
            .unwrap_or_default();
        let email = row
            .try_get::<Option<String>, _>("email")
            .unwrap_or_default();
        let contacts = load_person_contacts_json(
            state,
            provider_id,
            Some(doctor_id),
            None,
            phone.clone(),
            email.clone(),
        )
        .await?;
        let relationships = load_doctor_relationships_json(state, doctor_id).await?;
        doctors.push(json!({
            "id": doctor_id,
            "provider_id": row.try_get::<Uuid, _>("provider_id").unwrap_or(provider_id),
            "shared_identity_id": row.try_get::<Uuid, _>("shared_identity_id").unwrap_or(doctor_id),
            "name": row.try_get::<String, _>("name").unwrap_or_default(),
            "first_name": row.try_get::<Option<String>, _>("first_name").unwrap_or_default(),
            "last_name": row.try_get::<Option<String>, _>("last_name").unwrap_or_default(),
            "display_name": row.try_get::<Option<String>, _>("display_name").unwrap_or_default(),
            "title": row.try_get::<Option<String>, _>("title").unwrap_or_default(),
            "role_code": row.try_get::<Option<String>, _>("role_code").unwrap_or_default(),
            "role_label": row.try_get::<Option<String>, _>("role_label").unwrap_or_default(),
            "subrole": row.try_get::<Option<String>, _>("subrole").unwrap_or_default(),
            "website": row.try_get::<Option<String>, _>("website").unwrap_or_default(),
            "schwerpunkt": row.try_get::<Option<String>, _>("schwerpunkt").unwrap_or_default(),
            "gender": row.try_get::<String, _>("gender").unwrap_or_else(|_| "unknown".to_string()),
            "opening_hours": row.try_get::<Option<String>, _>("opening_hours").unwrap_or_default(),
            "fachbereich": row.try_get::<Option<String>, _>("fachbereich").unwrap_or_default(),
            "specializations": specializations,
            "insurance_providers": insurance_providers,
            "languages": row.try_get::<Vec<String>, _>("languages").unwrap_or_default(),
            "phone": phone,
            "email": email,
            "contacts": contacts,
            "license_number": row.try_get::<Option<String>, _>("license_number").unwrap_or_default(),
            "licensing_country": row.try_get::<Option<String>, _>("licensing_country").unwrap_or_default(),
            "licensing_valid_until": row.try_get::<Option<chrono::NaiveDate>, _>("licensing_valid_until").unwrap_or_default().map(|v| v.to_string()),
            "notes": row.try_get::<Option<String>, _>("notes").unwrap_or_default(),
            "patient_count": row.try_get::<i64, _>("patient_count").unwrap_or_default(),
            "appointment_count": row.try_get::<i64, _>("appointment_count").unwrap_or_default(),
            "created_at": row.try_get::<chrono::DateTime<chrono::Utc>, _>("created_at").map(|v| v.to_rfc3339()).unwrap_or_default(),
            "relationships": relationships,
        }));
    }

    Ok(doctors)
}

async fn load_services_json(
    state: &AppState,
    provider_id: Uuid,
) -> Result<Vec<serde_json::Value>, axum::response::Response> {
    let rows = sqlx::query(
        r#"SELECT s.id, s.provider_id, s.service_name, s.description, s.price, s.currency,
                  s.price_type, s.price_from, s.price_to, s.price_note,
                  s.valid_from, s.valid_to, s.created_at,
                  s.taxonomy_node_id, s.taxonomy_attributes,
                  ptn.code AS taxonomy_node_code,
                  ptn.name_de AS taxonomy_node_name_de,
                  ptn.name_ru AS taxonomy_node_name_ru
           FROM service_catalog s
           LEFT JOIN provider_taxonomy_nodes ptn ON ptn.id = s.taxonomy_node_id
           WHERE s.provider_id = $1
           ORDER BY s.service_name, s.valid_from DESC"#,
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
            "price_type": row.try_get::<String, _>("price_type").unwrap_or_else(|_| "fixed".to_string()),
            "price_from": row.try_get::<Option<rust_decimal::Decimal>, _>("price_from").unwrap_or_default(),
            "price_to": row.try_get::<Option<rust_decimal::Decimal>, _>("price_to").unwrap_or_default(),
            "price_note": row.try_get::<Option<String>, _>("price_note").unwrap_or_default(),
            "currency": row.try_get::<String, _>("currency").unwrap_or_else(|_| "EUR".to_string()),
            "valid_from": row.try_get::<chrono::NaiveDate, _>("valid_from").map(|v| v.to_string()).unwrap_or_default(),
            "valid_to": row.try_get::<Option<chrono::NaiveDate>, _>("valid_to").unwrap_or_default().map(|v| v.to_string()),
            "created_at": row.try_get::<chrono::DateTime<chrono::Utc>, _>("created_at").map(|v| v.to_rfc3339()).unwrap_or_default(),
            "taxonomy_node_id": row.try_get::<Option<Uuid>, _>("taxonomy_node_id").unwrap_or_default(),
            "taxonomy_node_code": row.try_get::<Option<String>, _>("taxonomy_node_code").unwrap_or_default(),
            "taxonomy_node_name_de": row.try_get::<Option<String>, _>("taxonomy_node_name_de").unwrap_or_default(),
            "taxonomy_node_name_ru": row.try_get::<Option<String>, _>("taxonomy_node_name_ru").unwrap_or_default(),
            "taxonomy_attributes": row.try_get::<Value, _>("taxonomy_attributes").unwrap_or_else(|_| json!({})),
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
