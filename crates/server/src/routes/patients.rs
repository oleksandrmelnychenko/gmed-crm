use axum::{
    Json, Router,
    extract::{Extension, Path, Query, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{get, patch, post},
};
use chrono::Datelike;
use serde::Deserialize;
use serde_json::{Map, Value, json};
use std::collections::{HashMap, HashSet};
use uuid::Uuid;

use crate::access;
use crate::audit;
use crate::auth::{middleware::AuthUser, password};
use crate::pdf_text::{add_unicode_pdf_fonts, pdf_text_save_options, unicode_show_text_op};
use crate::routes::documents::is_iso_country_code;
use crate::state::AppState;
use gmed_domain::role::Role;
use printpdf::{
    Color, Mm, Op, PaintMode, PdfDocument, PdfFontHandle, PdfPage, PdfWarnMsg, Point, Pt, Rect,
    Rgb, WindingOrder,
};
use sqlx::postgres::PgRow;
use sqlx::types::Json as SqlxJson;
use sqlx::{Postgres, Row, Transaction};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/patients", get(list_patients).post(create_patient))
        .route("/patients/{patient_id}", get(get_patient))
        .route(
            "/patients/{patient_id}/vitals",
            get(list_patient_vitals).post(create_patient_vital_measurement),
        )
        .route(
            "/patients/{patient_id}/vitals/{measurement_id}/update",
            post(update_patient_vital_measurement),
        )
        .route(
            "/patients/{patient_id}/vitals/{measurement_id}/delete",
            post(delete_patient_vital_measurement),
        )
        .route(
            "/patients/{patient_id}/lab-results",
            get(list_patient_lab_results).post(create_patient_lab_result),
        )
        .route(
            "/patients/{patient_id}/lab-results/{lab_result_id}",
            patch(update_patient_lab_result).delete(delete_patient_lab_result),
        )
        .route("/patients/{patient_id}/clinical", get(get_patient_clinical))
        .route("/doctors", get(list_all_doctors))
        .route(
            "/patients/{patient_id}/diagnoses",
            post(save_patient_diagnoses),
        )
        .route(
            "/patients/{patient_id}/medications",
            post(save_patient_medications),
        )
        .route(
            "/patients/{patient_id}/examinations",
            post(save_patient_examinations),
        )
        .route(
            "/patients/{patient_id}/narrative",
            post(save_patient_narrative),
        )
        .route(
            "/patients/{patient_id}/narrative/history",
            get(list_patient_narrative_history),
        )
        .route(
            "/patients/{patient_id}/narrative/{narrative_id}/delete",
            post(delete_patient_narrative),
        )
        .route("/patients/{patient_id}/verlauf", post(save_patient_verlauf))
        .route(
            "/patients/{patient_id}/procedures",
            post(save_patient_procedures),
        )
        .route(
            "/patients/{patient_id}/clinical-warnings",
            post(save_patient_clinical_warnings),
        )
        .route(
            "/patients/{patient_id}/impfstatus",
            get(get_patient_impfstatus).post(save_patient_impfstatus),
        )
        .route(
            "/patients/{patient_id}/clinical.pdf",
            get(get_patient_clinical_pdf),
        )
        .route(
            "/patients/{patient_id}/medikationsplan.pdf",
            get(get_patient_medikationsplan_pdf),
        )
        .route(
            "/patients/{patient_id}/card-entries",
            get(list_patient_card_entries).post(create_patient_card_entry),
        )
        .route(
            "/patients/{patient_id}/medical-orders",
            get(list_patient_medical_orders).post(create_patient_medical_order),
        )
        .route(
            "/patients/{patient_id}/risk-scores",
            get(list_patient_risk_scores).post(create_patient_risk_score),
        )
        .route(
            "/patients/{patient_id}/risk-scores/{risk_score_id}/update",
            post(update_patient_risk_score),
        )
        .route(
            "/patients/{patient_id}/risk-scores/{risk_score_id}/delete",
            post(delete_patient_risk_score),
        )
        .route("/patients/{patient_id}/recheck", get(get_patient_recheck))
        .route("/patients/{patient_id}/assignments", get(list_assignments))
        .route(
            "/patients/{patient_id}/portal-account/activate",
            post(activate_patient_portal_account),
        )
        .route("/patients/{patient_id}/cases", get(list_patient_cases))
        .route("/patients/{patient_id}/orders", get(list_patient_orders))
        .route(
            "/patients/{patient_id}/appointments",
            get(list_patient_appointments),
        )
        .route(
            "/patients/{patient_id}/documents",
            get(list_patient_documents),
        )
        .route(
            "/patients/{patient_id}/document-alerts",
            get(get_patient_document_alerts),
        )
        .route(
            "/patients/{patient_id}/framework-contracts",
            get(list_patient_framework_contracts),
        )
        .route(
            "/patients/{patient_id}/invoices",
            get(list_patient_invoices),
        )
        .route(
            "/patients/{patient_id}/service-report",
            get(get_patient_service_report),
        )
        .route(
            "/patients/{patient_id}/relations",
            get(list_relations).post(create_relation),
        )
        .route("/patients/{patient_id}/label", get(get_patient_label))
        .route("/patients/{patient_id}/timeline", get(get_patient_timeline))
        .route("/patients/{patient_id}/update", post(update_patient))
        .route("/patients/{patient_id}/assign", post(assign_patient))
        .route("/patients/{patient_id}/revoke", post(revoke_assignment))
        .route(
            "/patients/{patient_id}/medical-orders/{medical_order_id}/update",
            post(update_patient_medical_order),
        )
        .route(
            "/patients/{patient_id}/relations/{relation_id}/update",
            post(update_relation),
        )
        .route(
            "/patients/{patient_id}/relations/{relation_id}/delete",
            post(delete_relation),
        )
        .route("/patients/{patient_id}/activate", post(activate_patient))
        .route(
            "/patients/{patient_id}/deactivate",
            post(deactivate_patient),
        )
        .route("/patients/{patient_id}/delete", post(delete_patient))
}

#[derive(Debug, Clone)]
struct FieldPolicy {
    access_level: String,
    condition_type: Option<String>,
}

#[derive(Deserialize)]
struct ActivatePatientPortalAccountRequest {
    email: String,
    password: String,
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
    functional_labels: Option<Vec<String>>,
    phone_primary: Option<String>,
    phone_secondary: Option<String>,
    email: Option<String>,
    contacts: Option<Vec<PatientContactRequest>>,
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
    patient_relations: Option<Vec<UpsertRelationRequest>>,
    notes: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
struct PatientContactRequest {
    contact_kind: String,
    contact_type: Option<String>,
    value: String,
    is_primary: Option<bool>,
    notes: Option<String>,
}

#[derive(Debug, Clone)]
struct NormalizedPatientContact {
    contact_kind: String,
    contact_type: String,
    value: String,
    is_primary: bool,
    notes: Option<String>,
}

#[derive(Debug, Clone)]
struct PatientContactInput {
    id: Uuid,
    contact_kind: String,
    contact_type: String,
    value: String,
    is_primary: bool,
    notes: Option<String>,
}

#[derive(Deserialize)]
struct UpdatePatientRequest {
    title: Option<Value>,
    first_name: Option<String>,
    last_name: Option<String>,
    birth_date: Option<String>,
    gender: Option<String>,
    phone_primary: Option<Value>,
    phone_secondary: Option<Value>,
    email: Option<Value>,
    contacts: Option<Vec<PatientContactRequest>>,
    nationality: Option<Value>,
    residence_country: Option<Value>,
    languages: Option<Vec<String>>,
    functional_labels: Option<Vec<String>>,
    address_street: Option<Value>,
    address_city: Option<Value>,
    address_zip: Option<Value>,
    address_country: Option<Value>,
    insurance_provider: Option<Value>,
    insurance_number: Option<Value>,
    insurance_type: Option<Value>,
    emergency_contact_name: Option<Value>,
    emergency_contact_phone: Option<Value>,
    emergency_contact_relation: Option<Value>,
    passport_number: Option<Value>,
    passport_expiry: Option<String>,
    legal_status: Option<Value>,
    clinical_warnings: Option<String>,
    notes: Option<Value>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct CreatePatientVitalMeasurementRequest {
    measured_at: String,
    bp_systolic: Option<f64>,
    bp_diastolic: Option<f64>,
    heart_rate: Option<i32>,
    temperature_c: Option<f64>,
    oxygen_saturation: Option<f64>,
    respiratory_rate: Option<i32>,
    weight_kg: Option<f64>,
    height_cm: Option<f64>,
    bmi: Option<f64>,
    notes: Option<String>,
    source_country: Option<String>,
    source_import_id: Option<Uuid>,
    source_candidate_id: Option<String>,
    source_page: Option<i32>,
}

pub(crate) struct NormalizedPatientVitalMeasurement {
    measured_at: chrono::DateTime<chrono::Utc>,
    measured_at_precision: &'static str,
    bp_systolic: Option<f64>,
    bp_diastolic: Option<f64>,
    heart_rate: Option<i32>,
    temperature_c: Option<f64>,
    oxygen_saturation: Option<f64>,
    respiratory_rate: Option<i32>,
    weight_kg: Option<f64>,
    height_cm: Option<f64>,
    bmi: Option<f64>,
    notes: Option<String>,
    pub(crate) source_country: Option<String>,
    pub(crate) source_import_id: Option<Uuid>,
    pub(crate) source_candidate_id: Option<String>,
    source_page: Option<i32>,
}

#[allow(clippy::result_large_err)]
pub(crate) fn normalize_patient_vital_measurement_payload(
    raw_body: &Value,
) -> Result<NormalizedPatientVitalMeasurement, axum::response::Response> {
    let body = serde_json::from_value::<CreatePatientVitalMeasurementRequest>(raw_body.clone())
        .map_err(|_| {
            err(
                StatusCode::UNPROCESSABLE_ENTITY,
                "Invalid vital measurement payload",
            )
        })?;
    let measured_at = parse_vital_measurement_timestamp(&body.measured_at)?;
    let measured_at_precision =
        if chrono::NaiveDate::parse_from_str(body.measured_at.trim(), "%Y-%m-%d").is_ok() {
            "date"
        } else {
            "datetime"
        };
    let bp_systolic = validate_optional_float_range("bp_systolic", body.bp_systolic, 40.0, 300.0)?;
    let bp_diastolic =
        validate_optional_float_range("bp_diastolic", body.bp_diastolic, 20.0, 200.0)?;
    let heart_rate = validate_optional_int_range("heart_rate", body.heart_rate, 20, 300)?;
    let temperature_c =
        validate_optional_float_range("temperature_c", body.temperature_c, 25.0, 45.0)?;
    let oxygen_saturation =
        validate_optional_float_range("oxygen_saturation", body.oxygen_saturation, 20.0, 100.0)?;
    let respiratory_rate =
        validate_optional_int_range("respiratory_rate", body.respiratory_rate, 3, 80)?;
    let weight_kg = validate_optional_float_range("weight_kg", body.weight_kg, 1.0, 500.0)?;
    let height_cm = validate_optional_float_range("height_cm", body.height_cm, 20.0, 250.0)?;
    let provided_bmi = validate_optional_float_range("bmi", body.bmi, 5.0, 100.0)?;
    let notes = normalize_optional_text(body.notes, "notes", 2000)?;
    let source_candidate_id =
        normalize_optional_text(body.source_candidate_id, "source_candidate_id", 128)?;

    if bp_systolic.is_some() ^ bp_diastolic.is_some() {
        return Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Both bp_systolic and bp_diastolic are required together",
        ));
    }
    if matches!(
        (bp_systolic, bp_diastolic),
        (Some(systolic), Some(diastolic)) if systolic <= diastolic
    ) {
        return Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "bp_systolic must be greater than bp_diastolic",
        ));
    }

    let calculated_bmi = match (weight_kg, height_cm) {
        (Some(weight), Some(height_cm)) => {
            let height_m = height_cm / 100.0;
            (height_m > 0.0).then(|| ((weight / (height_m * height_m)) * 10.0).round() / 10.0)
        }
        _ => None,
    };
    if matches!(
        (provided_bmi, calculated_bmi),
        (Some(provided), Some(calculated)) if (provided - calculated).abs() > 0.5
    ) {
        return Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "bmi conflicts with weight_kg and height_cm",
        ));
    }
    let bmi = provided_bmi.or(calculated_bmi);

    if bp_systolic.is_none()
        && bp_diastolic.is_none()
        && heart_rate.is_none()
        && temperature_c.is_none()
        && oxygen_saturation.is_none()
        && respiratory_rate.is_none()
        && weight_kg.is_none()
        && height_cm.is_none()
        && bmi.is_none()
    {
        return Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "At least one vital measurement is required",
        ));
    }

    if body.source_page.is_some_and(|page| page <= 0) {
        return Err(err(StatusCode::UNPROCESSABLE_ENTITY, "Invalid source_page"));
    }
    let source_country = match body.source_country {
        Some(value) => {
            let normalized = value.trim();
            if normalized != value
                || normalized.len() != 2
                || !normalized.bytes().all(|byte| byte.is_ascii_uppercase())
                || !is_iso_country_code(normalized)
            {
                return Err(err(
                    StatusCode::UNPROCESSABLE_ENTITY,
                    "Invalid source_country",
                ));
            }
            Some(normalized.to_string())
        }
        None => None,
    };
    if body.source_import_id.is_some() != source_candidate_id.is_some() {
        return Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "source_import_id and source_candidate_id are required together",
        ));
    }
    if body.source_import_id.is_some()
        && measured_at_precision == "datetime"
        && chrono::DateTime::parse_from_rfc3339(body.measured_at.trim()).is_err()
    {
        return Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Imported vital measured_at must be a date or include an explicit timezone offset",
        ));
    }

    Ok(NormalizedPatientVitalMeasurement {
        measured_at,
        measured_at_precision,
        bp_systolic,
        bp_diastolic,
        heart_rate,
        temperature_c,
        oxygen_saturation,
        respiratory_rate,
        weight_kg,
        height_cm,
        bmi,
        notes,
        source_country,
        source_import_id: body.source_import_id,
        source_candidate_id,
        source_page: body.source_page,
    })
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct CreatePatientLabResultRequest {
    measured_at: String,
    panel: Option<String>,
    laboratory_name: Option<String>,
    analyte_name: String,
    result_text: String,
    numeric_result: Option<f64>,
    comparator: Option<String>,
    unit: Option<String>,
    reference_text: Option<String>,
    reference_low: Option<f64>,
    reference_high: Option<f64>,
    abnormal_flag: Option<String>,
    source_country: Option<String>,
    source_import_id: Option<Uuid>,
    source_candidate_id: Option<String>,
    source_page: Option<i32>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct DeletePatientLabResultRequest {
    deletion_note: String,
}

pub(crate) struct NormalizedPatientLabResult {
    measured_at: chrono::DateTime<chrono::Utc>,
    measured_at_precision: &'static str,
    panel: Option<String>,
    laboratory_name: Option<String>,
    analyte_name: String,
    result_text: String,
    numeric_result: Option<f64>,
    comparator: Option<String>,
    unit: Option<String>,
    reference_text: Option<String>,
    reference_low: Option<f64>,
    reference_high: Option<f64>,
    abnormal_flag: String,
    pub(crate) source_country: Option<String>,
    pub(crate) source_import_id: Option<Uuid>,
    pub(crate) source_candidate_id: Option<String>,
    source_page: Option<i32>,
}

#[allow(clippy::result_large_err)]
pub(crate) fn normalize_patient_lab_result_payload(
    raw_body: &Value,
) -> Result<NormalizedPatientLabResult, axum::response::Response> {
    let body = serde_json::from_value::<CreatePatientLabResultRequest>(raw_body.clone()).map_err(
        |_| {
            err(
                StatusCode::UNPROCESSABLE_ENTITY,
                "Invalid lab result payload",
            )
        },
    )?;
    let measured_at = parse_clinical_timestamp(&body.measured_at, "measured_at")?;
    let measured_at_precision =
        if chrono::NaiveDate::parse_from_str(body.measured_at.trim(), "%Y-%m-%d").is_ok() {
            "date"
        } else {
            "datetime"
        };
    let analyte_name = body.analyte_name.trim().to_string();
    let result_text = body.result_text.trim().to_string();
    if analyte_name.is_empty() || analyte_name.len() > 160 {
        return Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Invalid analyte_name",
        ));
    }
    if result_text.is_empty() || result_text.len() > 160 {
        return Err(err(StatusCode::UNPROCESSABLE_ENTITY, "Invalid result_text"));
    }
    let panel = normalize_optional_text(body.panel, "panel", 160)?;
    let laboratory_name = normalize_optional_text(body.laboratory_name, "laboratory_name", 160)?;
    let unit = normalize_optional_text(body.unit, "unit", 80)?;
    let reference_text = normalize_optional_text(body.reference_text, "reference_text", 240)?;
    let source_candidate_id =
        normalize_optional_text(body.source_candidate_id, "source_candidate_id", 128)?;
    if body.numeric_result.is_some_and(|value| !value.is_finite())
        || body.reference_low.is_some_and(|value| !value.is_finite())
        || body.reference_high.is_some_and(|value| !value.is_finite())
    {
        return Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Laboratory numbers must be finite",
        ));
    }
    if matches!((body.reference_low, body.reference_high), (Some(low), Some(high)) if low > high) {
        return Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Invalid reference range",
        ));
    }
    let comparator = match body.comparator.as_deref().map(str::trim) {
        None | Some("") => None,
        Some(value @ ("<" | "<=" | "=" | ">=" | ">")) => Some(value.to_string()),
        Some(_) => {
            return Err(err(StatusCode::UNPROCESSABLE_ENTITY, "Invalid comparator"));
        }
    };
    let abnormal_flag = body.abnormal_flag.as_deref().unwrap_or("unknown").trim();
    if !matches!(
        abnormal_flag,
        "normal" | "low" | "high" | "abnormal" | "unknown"
    ) {
        return Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Invalid abnormal_flag",
        ));
    }
    if body.source_page.is_some_and(|page| page <= 0) {
        return Err(err(StatusCode::UNPROCESSABLE_ENTITY, "Invalid source_page"));
    }
    let source_country = match body.source_country {
        Some(value) => {
            let normalized = value.trim();
            if normalized != value
                || normalized.len() != 2
                || !normalized.bytes().all(|byte| byte.is_ascii_uppercase())
                || !is_iso_country_code(normalized)
            {
                return Err(err(
                    StatusCode::UNPROCESSABLE_ENTITY,
                    "Invalid source_country",
                ));
            }
            Some(normalized.to_string())
        }
        None => None,
    };
    if body.source_import_id.is_some() != source_candidate_id.is_some() {
        return Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "source_import_id and source_candidate_id are required together",
        ));
    }
    if body.source_import_id.is_some()
        && measured_at_precision == "datetime"
        && chrono::DateTime::parse_from_rfc3339(body.measured_at.trim()).is_err()
    {
        return Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Imported lab measured_at must be a date or include an explicit timezone offset",
        ));
    }

    Ok(NormalizedPatientLabResult {
        measured_at,
        measured_at_precision,
        panel,
        laboratory_name,
        analyte_name,
        result_text,
        numeric_result: body.numeric_result,
        comparator,
        unit,
        reference_text,
        reference_low: body.reference_low,
        reference_high: body.reference_high,
        abnormal_flag: abnormal_flag.to_string(),
        source_country,
        source_import_id: body.source_import_id,
        source_candidate_id,
        source_page: body.source_page,
    })
}

#[allow(clippy::result_large_err)]
fn normalize_patient_lab_result_correction_payload(
    raw_body: &Value,
) -> Result<(NormalizedPatientLabResult, String), axum::response::Response> {
    const EDITABLE_FIELDS: &[&str] = &[
        "measured_at",
        "panel",
        "laboratory_name",
        "analyte_name",
        "result_text",
        "numeric_result",
        "comparator",
        "unit",
        "reference_text",
        "reference_low",
        "reference_high",
        "abnormal_flag",
        "correction_note",
    ];

    let Some(object) = raw_body.as_object() else {
        return Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Invalid lab result correction payload",
        ));
    };
    if object
        .keys()
        .any(|key| !EDITABLE_FIELDS.contains(&key.as_str()))
    {
        return Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Invalid lab result correction payload",
        ));
    }
    let correction_note = object
        .get("correction_note")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty() && value.chars().count() <= 500)
        .ok_or_else(|| {
            err(
                StatusCode::UNPROCESSABLE_ENTITY,
                "correction_note is required and must not exceed 500 characters",
            )
        })?
        .to_string();

    let mut measurement = raw_body.clone();
    measurement
        .as_object_mut()
        .expect("validated lab correction object")
        .remove("correction_note");
    let normalized = normalize_patient_lab_result_payload(&measurement)?;
    validate_patient_lab_result_correction_consistency(&normalized)?;
    Ok((normalized, correction_note))
}

enum ParsedLabResultText {
    Textual,
    ComplexTextual,
    InvalidNumeric,
    Numeric {
        candidates: Vec<f64>,
        comparator: Option<&'static str>,
        unit_suffix: Option<String>,
        annotated_flag: Option<&'static str>,
    },
}

fn split_lab_flag_annotation(value: &str) -> (&str, Option<&'static str>) {
    for (annotation, flag) in [
        ("(H)", "high"),
        ("(h)", "high"),
        ("[H]", "high"),
        ("[h]", "high"),
        ("(L)", "low"),
        ("(l)", "low"),
        ("[L]", "low"),
        ("[l]", "low"),
        ("(A)", "abnormal"),
        ("(a)", "abnormal"),
        ("[A]", "abnormal"),
        ("[a]", "abnormal"),
        ("(N)", "normal"),
        ("(n)", "normal"),
        ("[N]", "normal"),
        ("[n]", "normal"),
    ] {
        if let Some(unit) = value.strip_suffix(annotation) {
            return (unit.trim_end(), Some(flag));
        }
    }
    (value, None)
}

fn plausible_lab_unit_suffix(value: &str) -> bool {
    let Some(first) = value.chars().next() else {
        return false;
    };
    (first.is_alphabetic()
        || first.is_ascii_digit()
        || matches!(first, '/' | '%' | '‰' | 'µ' | 'μ' | '°'))
        && !value
            .chars()
            .any(|character| matches!(character, ':' | ';' | '+' | '(' | ')' | '[' | ']'))
        && (value.chars().any(char::is_alphanumeric) || matches!(value, "%" | "‰"))
}

fn grouped_lab_integer(value: &str, separator: char) -> bool {
    let groups = value.split(separator).collect::<Vec<_>>();
    groups.len() > 1
        && (1..=3).contains(&groups[0].len())
        && groups[0].bytes().all(|byte| byte.is_ascii_digit())
        && groups[1..]
            .iter()
            .all(|group| group.len() == 3 && group.bytes().all(|byte| byte.is_ascii_digit()))
}

fn parse_localized_lab_number_candidates(token: &str) -> Vec<f64> {
    let (sign, unsigned) = if let Some(rest) = token.strip_prefix('-') {
        ("-", rest)
    } else {
        ("", token.strip_prefix('+').unwrap_or(token))
    };
    let (mantissa, exponent) = unsigned.find(['e', 'E']).map_or((unsigned, ""), |index| {
        (&unsigned[..index], &unsigned[index..])
    });
    let dots = mantissa.matches('.').count();
    let commas = mantissa.matches(',').count();
    let mut normalized = Vec::new();

    if dots == 0 && commas == 0 {
        if !mantissa.is_empty() && mantissa.bytes().all(|byte| byte.is_ascii_digit()) {
            normalized.push(mantissa.to_string());
        }
    } else if dots == 0 || commas == 0 {
        let separator = if dots > 0 { '.' } else { ',' };
        let separator_count = dots + commas;
        if separator_count == 1 {
            let (integer, fraction) = mantissa
                .split_once(separator)
                .expect("single localized numeric separator");
            if (integer.is_empty() || integer.bytes().all(|byte| byte.is_ascii_digit()))
                && !fraction.is_empty()
                && fraction.bytes().all(|byte| byte.is_ascii_digit())
            {
                normalized.push(format!(
                    "{}.{}",
                    if integer.is_empty() { "0" } else { integer },
                    fraction
                ));
            }
        }
        if grouped_lab_integer(mantissa, separator) {
            normalized.push(mantissa.replace(separator, ""));
        }
    } else {
        let last_dot = mantissa.rfind('.').expect("dot count checked");
        let last_comma = mantissa.rfind(',').expect("comma count checked");
        let (decimal_separator, grouping_separator, decimal_index) = if last_comma > last_dot {
            (',', '.', last_comma)
        } else {
            ('.', ',', last_dot)
        };
        let integer = &mantissa[..decimal_index];
        let fraction = &mantissa[decimal_index + decimal_separator.len_utf8()..];
        let valid_integer = if integer.contains(grouping_separator) {
            grouped_lab_integer(integer, grouping_separator)
        } else {
            !integer.is_empty() && integer.bytes().all(|byte| byte.is_ascii_digit())
        };
        if valid_integer
            && !fraction.is_empty()
            && fraction.bytes().all(|byte| byte.is_ascii_digit())
        {
            normalized.push(format!(
                "{}.{}",
                integer.replace(grouping_separator, ""),
                fraction
            ));
        }
    }

    let mut candidates = Vec::new();
    for mantissa in normalized {
        if let Ok(value) = format!("{sign}{mantissa}{exponent}").parse::<f64>()
            && value.is_finite()
            && !candidates
                .iter()
                .any(|candidate| lab_numbers_match(*candidate, value))
        {
            candidates.push(value);
        }
    }
    candidates
}

fn parse_lab_result_text_projection(result_text: &str) -> ParsedLabResultText {
    let trimmed = result_text.trim();
    let (comparator, numeric_text) = if let Some(rest) = trimmed.strip_prefix("<=") {
        (Some("<="), rest.trim_start())
    } else if let Some(rest) = trimmed.strip_prefix(">=") {
        (Some(">="), rest.trim_start())
    } else if let Some(rest) = trimmed.strip_prefix('≤') {
        (Some("<="), rest.trim_start())
    } else if let Some(rest) = trimmed.strip_prefix('≥') {
        (Some(">="), rest.trim_start())
    } else if let Some(rest) = trimmed.strip_prefix('<') {
        (Some("<"), rest.trim_start())
    } else if let Some(rest) = trimmed.strip_prefix('>') {
        (Some(">"), rest.trim_start())
    } else if let Some(rest) = trimmed.strip_prefix('=') {
        (Some("="), rest.trim_start())
    } else {
        (None, trimmed)
    };
    let Some(first_character) = numeric_text.chars().next() else {
        return if comparator.is_some() {
            ParsedLabResultText::InvalidNumeric
        } else {
            ParsedLabResultText::Textual
        };
    };
    if !first_character.is_ascii_digit() && !matches!(first_character, '+' | '-' | '.' | ',') {
        return if comparator.is_some() {
            ParsedLabResultText::InvalidNumeric
        } else {
            ParsedLabResultText::Textual
        };
    }

    let mut index = 0usize;
    let mut token = String::new();
    if matches!(first_character, '+' | '-') {
        token.push(first_character);
        index += first_character.len_utf8();
    }
    let mut digit_count = 0usize;
    while index < numeric_text.len() {
        let character = numeric_text[index..]
            .chars()
            .next()
            .expect("index remains on a character boundary");
        if character.is_ascii_digit() || matches!(character, '.' | ',') {
            digit_count += usize::from(character.is_ascii_digit());
            token.push(character);
            index += character.len_utf8();
            continue;
        }
        if character.is_whitespace() {
            let mut after_spaces = index;
            while after_spaces < numeric_text.len() {
                let next = numeric_text[after_spaces..]
                    .chars()
                    .next()
                    .expect("index remains on a character boundary");
                if !next.is_whitespace() {
                    break;
                }
                after_spaces += next.len_utf8();
            }
            if after_spaces < numeric_text.len()
                && numeric_text[after_spaces..]
                    .chars()
                    .next()
                    .is_some_and(|next| next.is_ascii_digit())
            {
                index = after_spaces;
                continue;
            }
        }
        break;
    }
    if digit_count == 0 {
        return ParsedLabResultText::InvalidNumeric;
    }
    if index < numeric_text.len()
        && numeric_text[index..]
            .chars()
            .next()
            .is_some_and(|character| matches!(character, 'e' | 'E'))
    {
        token.push('e');
        index += 1;
        if index < numeric_text.len()
            && numeric_text[index..]
                .chars()
                .next()
                .is_some_and(|character| matches!(character, '+' | '-'))
        {
            token.push(numeric_text.as_bytes()[index] as char);
            index += 1;
        }
        let exponent_digits_start = index;
        while index < numeric_text.len() && numeric_text.as_bytes()[index].is_ascii_digit() {
            token.push(numeric_text.as_bytes()[index] as char);
            index += 1;
        }
        if index == exponent_digits_start {
            return ParsedLabResultText::InvalidNumeric;
        }
    }

    let candidates = parse_localized_lab_number_candidates(&token);
    if candidates.is_empty() {
        return ParsedLabResultText::InvalidNumeric;
    }
    let raw_suffix = numeric_text[index..].trim();
    let (unit_suffix, annotated_flag) = split_lab_flag_annotation(raw_suffix);
    if !unit_suffix.is_empty() && !plausible_lab_unit_suffix(unit_suffix) {
        return if comparator.is_some() {
            ParsedLabResultText::InvalidNumeric
        } else {
            ParsedLabResultText::ComplexTextual
        };
    }
    ParsedLabResultText::Numeric {
        candidates,
        comparator,
        unit_suffix: (!unit_suffix.is_empty()).then(|| unit_suffix.to_string()),
        annotated_flag,
    }
}

fn normalized_lab_unit(value: &str) -> String {
    value
        .chars()
        .filter(|character| !character.is_whitespace())
        .flat_map(char::to_lowercase)
        .collect()
}

fn lab_numbers_match(left: f64, right: f64) -> bool {
    let tolerance = left.abs().max(right.abs()).max(1.0) * 1e-9;
    (left - right).abs() <= tolerance
}

fn canonical_lab_comparator(value: Option<&str>) -> &str {
    match value {
        None | Some("") | Some("=") => "=",
        Some(value) => value,
    }
}

fn unambiguous_lab_flag(
    numeric_result: f64,
    comparator: Option<&str>,
    reference_low: f64,
    reference_high: f64,
) -> Option<&'static str> {
    match comparator {
        None | Some("") | Some("=") => Some(if numeric_result < reference_low {
            "low"
        } else if numeric_result > reference_high {
            "high"
        } else {
            "normal"
        }),
        Some("<") if numeric_result <= reference_low => Some("low"),
        Some("<=") if numeric_result < reference_low => Some("low"),
        Some(">") if numeric_result >= reference_high => Some("high"),
        Some(">=") if numeric_result > reference_high => Some("high"),
        _ => None,
    }
}

#[allow(clippy::result_large_err)]
fn validate_patient_lab_result_correction_consistency(
    lab: &NormalizedPatientLabResult,
) -> Result<(), axum::response::Response> {
    // Correction contract: numeric-looking display text must carry the same
    // numeric projection (with an omitted comparator equivalent to `=`).
    // Direct numeric observations with complete bounds use a canonical
    // normal/low/high flag; inequalities are checked only when classification
    // is mathematically unambiguous.
    match parse_lab_result_text_projection(&lab.result_text) {
        ParsedLabResultText::Textual | ParsedLabResultText::ComplexTextual => {
            if lab.numeric_result.is_some() || lab.comparator.is_some() {
                return Err(err(
                    StatusCode::UNPROCESSABLE_ENTITY,
                    "Textual or complex result_text cannot retain numeric_result or comparator",
                ));
            }
        }
        ParsedLabResultText::InvalidNumeric => {
            return Err(err(
                StatusCode::UNPROCESSABLE_ENTITY,
                "Invalid numeric result_text",
            ));
        }
        ParsedLabResultText::Numeric {
            candidates,
            comparator,
            unit_suffix,
            annotated_flag,
        } => {
            let Some(numeric_result) = lab.numeric_result else {
                return Err(err(
                    StatusCode::UNPROCESSABLE_ENTITY,
                    "Numeric result_text requires numeric_result",
                ));
            };
            if !candidates
                .iter()
                .any(|candidate| lab_numbers_match(*candidate, numeric_result))
            {
                return Err(err(
                    StatusCode::UNPROCESSABLE_ENTITY,
                    "result_text does not match numeric_result",
                ));
            }
            if canonical_lab_comparator(comparator)
                != canonical_lab_comparator(lab.comparator.as_deref())
            {
                return Err(err(
                    StatusCode::UNPROCESSABLE_ENTITY,
                    "result_text comparator does not match comparator",
                ));
            }
            if let Some(unit_suffix) = unit_suffix
                && lab.unit.as_deref().is_none_or(|unit| {
                    normalized_lab_unit(unit) != normalized_lab_unit(&unit_suffix)
                })
            {
                return Err(err(
                    StatusCode::UNPROCESSABLE_ENTITY,
                    "result_text unit does not match unit",
                ));
            }
            if annotated_flag.is_some_and(|expected| lab.abnormal_flag != expected) {
                return Err(err(
                    StatusCode::UNPROCESSABLE_ENTITY,
                    "result_text abnormal annotation contradicts abnormal_flag",
                ));
            }
        }
    }

    if let (Some(numeric_result), Some(reference_low), Some(reference_high)) =
        (lab.numeric_result, lab.reference_low, lab.reference_high)
        && let Some(expected) = unambiguous_lab_flag(
            numeric_result,
            lab.comparator.as_deref(),
            reference_low,
            reference_high,
        )
        && lab.abnormal_flag != expected
    {
        return Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "abnormal_flag contradicts numeric_result and reference range",
        ));
    }
    Ok(())
}

#[derive(Deserialize)]
struct CreatePatientCardEntryRequest {
    entry_date: String,
    category: String,
    source: Option<String>,
    content: String,
}

#[derive(Deserialize)]
struct CreatePatientMedicalOrderRequest {
    order_date: String,
    order_type: String,
    title: String,
    instructions: String,
    due_date: Option<String>,
    source: Option<String>,
}

#[derive(Deserialize)]
struct UpdatePatientMedicalOrderRequest {
    order_date: Option<String>,
    order_type: Option<String>,
    title: Option<String>,
    instructions: Option<String>,
    status: Option<String>,
    due_date: Option<String>,
    source: Option<String>,
}

#[derive(Deserialize)]
struct CreatePatientRiskScoreRequest {
    computed_at: String,
    score_type: String,
    score_value: f64,
    scale_max: Option<f64>,
    interpretation: Option<String>,
    source: Option<String>,
    inputs: Option<Value>,
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
    lifecycle: Option<String>,
}

#[derive(Deserialize)]
struct UpsertRelationRequest {
    related_patient_id: Option<Uuid>,
    related_name: String,
    relation_type: String,
    is_emergency_contact: Option<bool>,
    phone: Option<String>,
    notes: Option<String>,
}

#[derive(Deserialize)]
struct PatientLabelQuery {
    format: Option<String>,
}

#[derive(Clone)]
struct RequiredPatientDocumentRule {
    key: String,
    label: String,
    art: Vec<String>,
    category: Vec<String>,
}

#[derive(Clone)]
pub(crate) struct PatientDocumentAlertsSummary {
    configured_rule_count: usize,
    document_pack_complete: bool,
    stored_document_pack_complete: bool,
    out_of_sync: bool,
    required_documents: Vec<Value>,
    missing_documents: Vec<Value>,
    missing_count: usize,
}

#[derive(Clone)]
pub(crate) struct PatientRecheckReadiness {
    pub(crate) can_create_order: bool,
    pub(crate) blocking_reasons: Vec<String>,
    pub(crate) payload: Value,
}

#[derive(Debug, Clone, Copy)]
pub(crate) struct PatientLabelFormat {
    pub(crate) id: &'static str,
    pub(crate) label: &'static str,
    pub(crate) width_mm: i32,
    pub(crate) height_mm: i32,
}

#[derive(Debug, Clone)]
pub(crate) struct PatientLabelAgencySettings {
    pub(crate) name: String,
    pub(crate) care_of: String,
    pub(crate) address: Option<String>,
    pub(crate) phone: Option<String>,
    pub(crate) email: Option<String>,
}

const PATIENT_CARD_ENTRY_CATEGORIES: &[&str] = &[
    "medical_update",
    "patient_report",
    "provider_report",
    "treatment_note",
    "followup_note",
    "warning",
    "other",
];

const PATIENT_MEDICAL_ORDER_TYPES: &[&str] = &[
    "physiotherapy",
    "diet",
    "lab_recheck",
    "imaging",
    "medication_followup",
    "procedure",
    "other",
];

const PATIENT_MEDICAL_ORDER_STATUSES: &[&str] = &["active", "completed", "cancelled"];

const PATIENT_RISK_SCORE_TYPES: &[&str] = &[
    "cha2ds2_vasc",
    "has_bled",
    "framingham",
    "fall_risk",
    "frailty",
    "nutrition_risk",
    "other",
];

pub(crate) const PATIENT_LABEL_FORMATS: [PatientLabelFormat; 3] = [
    PatientLabelFormat {
        id: "compact-90x48",
        label: "Compact 90 x 48 mm",
        width_mm: 90,
        height_mm: 48,
    },
    PatientLabelFormat {
        id: "standard-105x74",
        label: "Standard 105 x 74 mm",
        width_mm: 105,
        height_mm: 74,
    },
    PatientLabelFormat {
        id: "sheet-70x37",
        label: "Sheet 70 x 37 mm",
        width_mm: 70,
        height_mm: 37,
    },
];

const ALLOWED_PATIENT_FUNCTIONAL_LABELS: [&str; 5] = [
    "vip",
    "high_risk",
    "mobility_support",
    "fall_risk",
    "complex_coordination",
];
const ALLOWED_PATIENT_COUNTRIES: [&str; 21] = [
    "Germany",
    "Ukraine",
    "Austria",
    "Switzerland",
    "Poland",
    "Czech Republic",
    "Denmark",
    "Latvia",
    "Greece",
    "Turkey",
    "United Arab Emirates",
    "Saudi Arabia",
    "Egypt",
    "Nigeria",
    "Ghana",
    "Brazil",
    "China",
    "Russia",
    "Pakistan",
    "United Kingdom",
    "United States",
];
const ALLOWED_PATIENT_NATIONALITIES: [&str; 21] = [
    "German",
    "Ukrainian",
    "Austrian",
    "Swiss",
    "Polish",
    "Czech",
    "Danish",
    "Latvian",
    "Greek",
    "Turkish",
    "Emirati",
    "Saudi",
    "Egyptian",
    "Nigerian",
    "Ghanaian",
    "Brazilian",
    "Chinese",
    "Russian",
    "Pakistani",
    "British",
    "American",
];
const ALLOWED_PATIENT_LANGUAGES: [&str; 17] = [
    "de", "uk", "ru", "en", "ar", "pt", "fr", "es", "it", "tr", "pl", "cs", "da", "el", "lv", "zh",
    "ur",
];

fn validate_create(req: &CreatePatientRequest) -> Result<(), &'static str> {
    let first_name = req.first_name.trim();
    let last_name = req.last_name.trim();
    let birth_date = req.birth_date.trim();

    if first_name.is_empty() || first_name.len() > 200 {
        return Err("First name required (max 200)");
    }
    if last_name.is_empty() || last_name.len() > 200 {
        return Err("Last name required (max 200)");
    }
    if birth_date.is_empty() {
        return Err("Birth date required");
    }
    let parsed_birth_date = chrono::NaiveDate::parse_from_str(birth_date, "%Y-%m-%d")
        .map_err(|_| "Invalid birth_date format (YYYY-MM-DD)")?;
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
    validate_optional_patient_select(
        req.nationality.as_deref(),
        &ALLOWED_PATIENT_NATIONALITIES,
        "nationality",
    )?;
    validate_optional_patient_select(
        req.residence_country.as_deref(),
        &ALLOWED_PATIENT_COUNTRIES,
        "residence_country",
    )?;
    validate_optional_patient_select(
        req.address_country.as_deref(),
        &ALLOWED_PATIENT_COUNTRIES,
        "address_country",
    )?;
    validate_patient_languages(req.languages.as_deref())?;
    if let Some(contacts) = req.contacts.as_ref() {
        for contact in contacts {
            validate_patient_contact_payload(contact)?;
        }
    }
    if let Some(relations) = req.patient_relations.as_ref() {
        for relation in relations {
            validate_relation_payload_fields(relation)?;
        }
    }
    if is_minor_birth_date(parsed_birth_date, chrono::Utc::now().date_naive())
        && !has_minor_guardian(req)
    {
        return Err(
            "Minor patients require a guardian/parent relation or guardian emergency contact",
        );
    }
    Ok(())
}

fn validate_patient_contact_payload(contact: &PatientContactRequest) -> Result<(), &'static str> {
    match contact.contact_kind.trim() {
        "phone" | "email" => {}
        _ => return Err("Invalid contact kind"),
    }
    match contact.contact_type.as_deref().unwrap_or("private").trim() {
        "work" | "private" | "other" => {}
        _ => return Err("Invalid contact type"),
    }
    if contact.value.trim().len() > 255 {
        return Err("Contact value max 255");
    }
    if contact.notes.as_deref().unwrap_or("").trim().len() > 1000 {
        return Err("Contact notes max 1000");
    }
    Ok(())
}

fn normalize_patient_text(value: impl AsRef<str>, max_len: usize) -> Option<String> {
    let normalized = value.as_ref().trim();
    if normalized.is_empty() {
        return None;
    }
    Some(normalized.chars().take(max_len).collect())
}

fn normalize_patient_contacts(
    contacts: Option<Vec<PatientContactRequest>>,
    phone_primary: Option<&str>,
    phone_secondary: Option<&str>,
    email: Option<&str>,
) -> Vec<NormalizedPatientContact> {
    let mut normalized = match contacts {
        Some(contacts) => contacts
            .into_iter()
            .flat_map(|contact| {
                let value = contact.value.trim().to_string();
                if value.is_empty() {
                    return None;
                }
                Some(NormalizedPatientContact {
                    contact_kind: match contact.contact_kind.trim() {
                        "email" => "email".to_string(),
                        _ => "phone".to_string(),
                    },
                    contact_type: match contact.contact_type.as_deref().unwrap_or("private").trim()
                    {
                        "work" => "work".to_string(),
                        "other" => "other".to_string(),
                        _ => "private".to_string(),
                    },
                    value,
                    is_primary: contact.is_primary.unwrap_or(false),
                    notes: contact
                        .notes
                        .and_then(|value| normalize_patient_text(value, 1000)),
                })
            })
            .collect::<Vec<_>>(),
        None => {
            let mut contacts = Vec::new();
            if let Some(value) = normalize_patient_text(phone_primary.unwrap_or_default(), 255) {
                contacts.push(NormalizedPatientContact {
                    contact_kind: "phone".to_string(),
                    contact_type: "private".to_string(),
                    value,
                    is_primary: true,
                    notes: None,
                });
            }
            if let Some(value) = normalize_patient_text(phone_secondary.unwrap_or_default(), 255) {
                contacts.push(NormalizedPatientContact {
                    contact_kind: "phone".to_string(),
                    contact_type: "private".to_string(),
                    value,
                    is_primary: false,
                    notes: None,
                });
            }
            if let Some(value) = normalize_patient_text(email.unwrap_or_default(), 255) {
                contacts.push(NormalizedPatientContact {
                    contact_kind: "email".to_string(),
                    contact_type: "private".to_string(),
                    value,
                    is_primary: true,
                    notes: None,
                });
            }
            contacts
        }
    };

    for kind in ["phone", "email"] {
        let mut first_index = None;
        let mut primary_seen = false;
        for (index, contact) in normalized.iter_mut().enumerate() {
            if contact.contact_kind != kind {
                continue;
            }
            if first_index.is_none() {
                first_index = Some(index);
            }
            if contact.is_primary && !primary_seen {
                primary_seen = true;
            } else if contact.is_primary {
                contact.is_primary = false;
            }
        }
        if !primary_seen && let Some(index) = first_index {
            normalized[index].is_primary = true;
        }
    }

    normalized
}

fn patient_contact_legacy_values(
    contacts: &[NormalizedPatientContact],
) -> (Option<String>, Option<String>, Option<String>) {
    let phone_primary = contacts
        .iter()
        .find(|contact| contact.contact_kind == "phone" && contact.is_primary)
        .or_else(|| {
            contacts
                .iter()
                .find(|contact| contact.contact_kind == "phone")
        })
        .map(|contact| contact.value.clone());
    let phone_secondary = contacts
        .iter()
        .find(|contact| {
            contact.contact_kind == "phone"
                && Some(contact.value.as_str()) != phone_primary.as_deref()
        })
        .map(|contact| contact.value.clone());
    let email = contacts
        .iter()
        .find(|contact| contact.contact_kind == "email" && contact.is_primary)
        .or_else(|| {
            contacts
                .iter()
                .find(|contact| contact.contact_kind == "email")
        })
        .map(|contact| contact.value.clone());

    (phone_primary, phone_secondary, email)
}

fn validate_optional_patient_select(
    value: Option<&str>,
    allowed_values: &[&str],
    field_name: &'static str,
) -> Result<(), &'static str> {
    let Some(value) = value else {
        return Ok(());
    };
    let value = value.trim();
    if value.is_empty() || allowed_values.contains(&value) {
        return Ok(());
    }
    match field_name {
        "nationality" => Err("Invalid nationality"),
        "residence_country" => Err("Invalid residence_country"),
        "address_country" => Err("Invalid address_country"),
        _ => Err("Invalid select value"),
    }
}

fn validate_optional_patient_select_update(
    value: Option<&str>,
    current: Option<&str>,
    allowed_values: &[&str],
    field_name: &'static str,
) -> Result<(), &'static str> {
    let Some(value) = value else {
        return Ok(());
    };
    let value = value.trim();
    if value.is_empty() || allowed_values.contains(&value) {
        return Ok(());
    }
    if current.is_some_and(|current| current.trim() == value) {
        return Ok(());
    }
    match field_name {
        "nationality" => Err("Invalid nationality"),
        "residence_country" => Err("Invalid residence_country"),
        "address_country" => Err("Invalid address_country"),
        _ => Err("Invalid select value"),
    }
}

fn validate_patient_languages(languages: Option<&[String]>) -> Result<(), &'static str> {
    let Some(languages) = languages else {
        return Ok(());
    };
    for language in languages {
        let language = language.trim();
        if !language.is_empty() && !ALLOWED_PATIENT_LANGUAGES.contains(&language) {
            return Err("Invalid patient language");
        }
    }
    Ok(())
}

fn normalize_patient_select_value(value: Option<String>) -> Option<String> {
    value.and_then(|value| {
        let trimmed = value.trim();
        (!trimmed.is_empty()).then(|| trimmed.to_string())
    })
}

fn normalize_patient_language_values(
    languages: Option<Vec<String>>,
) -> Result<Vec<String>, &'static str> {
    let mut normalized = Vec::new();
    for language in languages.unwrap_or_default() {
        let language = language.trim();
        if language.is_empty() {
            continue;
        }
        if !ALLOWED_PATIENT_LANGUAGES.contains(&language) {
            return Err("Invalid patient language");
        }
        if !normalized.iter().any(|item| item == language) {
            normalized.push(language.to_string());
        }
    }
    Ok(normalized)
}

fn normalize_patient_language_values_for_update(
    languages: Vec<String>,
    current: &[String],
) -> Result<Vec<String>, &'static str> {
    let mut normalized = Vec::new();
    for language in languages {
        let language = language.trim();
        if language.is_empty() {
            continue;
        }
        if !ALLOWED_PATIENT_LANGUAGES.contains(&language)
            && !current.iter().any(|current| current == language)
        {
            return Err("Invalid patient language");
        }
        if !normalized.iter().any(|item| item == language) {
            normalized.push(language.to_string());
        }
    }
    Ok(normalized)
}

fn is_minor_birth_date(birth_date: chrono::NaiveDate, today: chrono::NaiveDate) -> bool {
    let mut age = today.year() - birth_date.year();
    if (today.month(), today.day()) < (birth_date.month(), birth_date.day()) {
        age -= 1;
    }
    age < 18
}

fn has_minor_guardian(req: &CreatePatientRequest) -> bool {
    if let Some(relations) = req.patient_relations.as_ref()
        && relations.iter().any(|relation| {
            is_guardian_or_parent_relation_type(&relation.relation_type)
                && !relation.related_name.trim().is_empty()
        })
    {
        return true;
    }

    has_guardian_or_parent_contact(
        req.emergency_contact_relation.as_deref(),
        req.emergency_contact_name.as_deref(),
        req.emergency_contact_phone.as_deref(),
    )
}

fn has_guardian_or_parent_contact(
    relation: Option<&str>,
    name: Option<&str>,
    phone: Option<&str>,
) -> bool {
    is_guardian_or_parent_relation_type(relation.unwrap_or(""))
        && name.is_some_and(|value| !value.trim().is_empty())
        && phone.is_some_and(|value| !value.trim().is_empty())
}

fn is_guardian_or_parent_relation_type(value: &str) -> bool {
    matches!(value.trim(), "guardian" | "parent")
}

fn validate_relation_payload_fields(body: &UpsertRelationRequest) -> Result<(), &'static str> {
    if body.related_name.trim().is_empty() || body.related_name.trim().len() > 200 {
        return Err("Related name required (max 200)");
    }

    match body.relation_type.trim() {
        "spouse" | "parent" | "child" | "sibling" | "relative" | "guardian" | "caregiver"
        | "friend" | "other" => {}
        _ => return Err("Invalid relation type"),
    }

    Ok(())
}

fn generate_patient_id(seq: i64) -> String {
    let now = chrono::Utc::now();
    format!("P-{}-{:04}", now.format("%Y%m%d"), seq)
}

fn patient_label_format_json(format: PatientLabelFormat) -> Value {
    json!({
        "id": format.id,
        "label": format.label,
        "width_mm": format.width_mm,
        "height_mm": format.height_mm,
    })
}

#[allow(clippy::result_large_err)]
fn resolve_patient_label_format(
    requested: Option<&str>,
) -> Result<PatientLabelFormat, axum::response::Response> {
    let requested = requested.unwrap_or(PATIENT_LABEL_FORMATS[0].id);

    PATIENT_LABEL_FORMATS
        .iter()
        .copied()
        .find(|format| format.id == requested)
        .ok_or_else(|| {
            err(
                StatusCode::UNPROCESSABLE_ENTITY,
                "Invalid patient label format",
            )
        })
}

fn normalize_setting_text_value(value: &str) -> Option<String> {
    let normalized = value.trim().trim_matches('"').trim();
    if normalized.is_empty() || normalized.eq_ignore_ascii_case("null") {
        None
    } else {
        Some(normalized.to_string())
    }
}

fn money_json(value: rust_decimal::Decimal) -> String {
    value.round_dp(2).normalize().to_string()
}

pub(crate) fn patient_label_salutation(gender: &str) -> &'static str {
    match gender {
        "male" => "Herr",
        "female" => "Frau",
        "diverse" => "Div",
        _ => "",
    }
}

fn resolve_country_abbreviation(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }

    let normalized = trimmed.to_lowercase();
    if let Some(code) = match normalized.as_str() {
        "de" | "deu" | "germany" | "deutschland" => Some("DE"),
        "at" | "aut" | "austria" | "oesterreich" | "osterreich" | "österreich" => Some("AT"),
        "ch" | "che" | "switzerland" | "schweiz" | "suisse" => Some("CH"),
        "ua" | "ukr" | "ukraine" | "ukraina" => Some("UA"),
        "pl" | "pol" | "poland" | "polska" => Some("PL"),
        "tr" | "tur" | "turkey" | "turkiye" | "tuerkei" | "türkei" => Some("TR"),
        "fr" | "fra" | "france" => Some("FR"),
        "it" | "ita" | "italy" | "italia" => Some("IT"),
        "es" | "esp" | "spain" | "espana" | "españa" => Some("ES"),
        "nl" | "nld" | "netherlands" | "niederlande" => Some("NL"),
        "be" | "bel" | "belgium" | "belgien" => Some("BE"),
        "cz" | "cze" | "czechia" | "czech republic" | "tschechien" => Some("CZ"),
        "gb" | "gbr" | "uk" | "united kingdom" | "great britain" => Some("GB"),
        "us" | "usa" | "united states" | "united states of america" => Some("US"),
        _ => None,
    } {
        return Some(code.to_string());
    }

    let words = trimmed
        .split(|ch: char| !ch.is_alphabetic())
        .filter(|word| !word.is_empty())
        .collect::<Vec<_>>();
    if words.len() > 1 {
        let initials = words
            .iter()
            .filter_map(|word| word.chars().next())
            .take(3)
            .collect::<String>()
            .to_uppercase();
        if !initials.is_empty() {
            return Some(initials);
        }
    }

    let compact = trimmed
        .chars()
        .filter(|ch| ch.is_alphabetic())
        .take(3)
        .collect::<String>()
        .to_uppercase();
    if compact.is_empty() {
        None
    } else {
        Some(compact)
    }
}

pub(crate) fn patient_label_country_code(
    nationality: Option<&str>,
    residence_country: Option<&str>,
) -> Option<String> {
    nationality
        .and_then(resolve_country_abbreviation)
        .or_else(|| residence_country.and_then(resolve_country_abbreviation))
}

pub(crate) async fn load_patient_label_agency_settings(
    state: &AppState,
) -> Result<PatientLabelAgencySettings, axum::response::Response> {
    let rows = sqlx::query(
        r#"SELECT key, value::TEXT AS value_text
           FROM system_settings
           WHERE key IN (
               'agency_name',
               'agency_care_of',
               'agency_address',
               'agency_phone',
               'agency_email'
           )"#,
    )
    .fetch_all(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, "Failed to load patient label agency settings");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to load patient label settings",
        )
    })?;

    let mut values = HashMap::new();
    for row in rows {
        let key = row.try_get::<String, _>("key").map_err(|e| {
            tracing::error!(error = %e, "Failed to read patient label settings key");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to load patient label settings",
            )
        })?;
        let value = row.try_get::<String, _>("value_text").map_err(|e| {
            tracing::error!(error = %e, "Failed to read patient label settings value");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to load patient label settings",
            )
        })?;

        if let Some(value) = normalize_setting_text_value(&value) {
            values.insert(key, value);
        }
    }

    let name = values.get("agency_name").cloned().ok_or_else(|| {
        tracing::error!("Required patient label setting agency_name is missing");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Patient label agency profile is incomplete",
        )
    })?;
    let care_of = values.get("agency_care_of").cloned().ok_or_else(|| {
        tracing::error!("Required patient label setting agency_care_of is missing");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Patient label agency profile is incomplete",
        )
    })?;

    Ok(PatientLabelAgencySettings {
        name,
        care_of,
        address: values.get("agency_address").cloned(),
        phone: values.get("agency_phone").cloned(),
        email: values.get("agency_email").cloned(),
    })
}

async fn list_patients(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Query(query): Query<ListQuery>,
) -> impl IntoResponse {
    auth.require_any_role(&[
        Role::Ceo,
        Role::CeoAssistant,
        Role::PatientManager,
        Role::Billing,
        Role::TeamleadInterpreter,
        Role::Interpreter,
        Role::Concierge,
        Role::ItAdmin,
    ])?;

    let active_only = query.active_only.unwrap_or(true);
    let search = query.search.unwrap_or_default();
    let search_pattern = format!("%{search}%");
    let provider_id = query.provider_id;
    let doctor_id = query.doctor_id;
    let include_financial_balance = matches!(
        auth.role,
        Role::Ceo | Role::CeoAssistant | Role::PatientManager | Role::Billing
    );
    let lifecycle = query
        .lifecycle
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    if let Some(value) = lifecycle {
        match value {
            "prospective" | "active" | "inactive" | "deleted" => {}
            _ => {
                return Err(err(
                    StatusCode::UNPROCESSABLE_ENTITY,
                    "Invalid lifecycle filter",
                ));
            }
        }
        match auth.role {
            Role::PatientManager | Role::Ceo | Role::ItAdmin => {}
            _ => {
                return Err(err(
                    StatusCode::FORBIDDEN,
                    "Insufficient permissions for lifecycle filter",
                ));
            }
        }
    }

    let rows = sqlx::query(
        r#"WITH source_allocations AS (
               SELECT allocation.advance_invoice_id,
                      COALESCE(SUM(allocation.amount_gross), 0) AS allocated
               FROM invoice_prepayment_allocations allocation
               GROUP BY allocation.advance_invoice_id
           ), invoice_positions AS (
               SELECT invoice.patient_id,
                      COALESCE(SUM(
                          CASE
                              WHEN invoice.invoice_type <> 'advance'
                               AND invoice.status NOT IN ('draft', 'cancelled')
                                  THEN GREATEST(
                                      invoice.total_gross
                                          - invoice.credited_amount
                                          - invoice.paid_amount
                                          - invoice.prepayment_applied_amount,
                                      0
                                  )
                              ELSE 0
                          END
                      ), 0) AS invoice_due,
                      COALESCE(SUM(
                          CASE
                              WHEN invoice.invoice_type = 'advance'
                               AND invoice.status NOT IN ('draft', 'cancelled')
                                  THEN GREATEST(
                                      LEAST(
                                          invoice.paid_amount,
                                          GREATEST(invoice.total_gross - invoice.credited_amount, 0)
                                      ) - COALESCE(source.allocated, 0),
                                      0
                                  )
                              ELSE 0
                          END
                      ), 0) AS available_prepayment,
                      COUNT(*) FILTER (
                          WHERE invoice.invoice_type <> 'advance'
                            AND invoice.status NOT IN ('draft', 'cancelled')
                      )::bigint AS released_invoice_count
               FROM invoices invoice
               JOIN orders ON orders.id = invoice.order_id
               LEFT JOIN source_allocations source
                 ON source.advance_invoice_id = invoice.id
               WHERE $6::boolean = true
                 AND UPPER(orders.currency) = 'EUR'
               GROUP BY invoice.patient_id
           ), external_allocations AS (
               SELECT allocation.external_invoice_id,
                      COALESCE(SUM(allocation.amount_gross), 0) AS allocated
               FROM external_invoice_patient_invoice_allocations allocation
               JOIN invoices target ON target.id = allocation.patient_invoice_id
               WHERE allocation.reversed_at IS NULL
                 AND target.status NOT IN ('draft', 'cancelled')
               GROUP BY allocation.external_invoice_id
           ), external_positions AS (
               SELECT external.patient_id,
                      COALESCE(SUM(GREATEST(
                          external.patient_receivable_gross - COALESCE(allocation.allocated, 0),
                          0
                      )), 0) AS external_receivable
               FROM external_invoices external
               LEFT JOIN external_allocations allocation
                 ON allocation.external_invoice_id = external.id
               WHERE $6::boolean = true
                 AND external.status <> 'cancelled'
                 AND external.patient_receivable_gross > 0
                 AND UPPER(external.currency) = 'EUR'
               GROUP BY external.patient_id
           ), manual_positions AS (
               SELECT adjustment.patient_id,
                      COALESCE(SUM(
                          CASE
                              WHEN adjustment.direction = 'debit' THEN adjustment.amount
                              ELSE -adjustment.amount
                          END
                      ), 0) AS manual_balance
               FROM patient_balance_adjustments adjustment
               WHERE $6::boolean = true
                 AND UPPER(adjustment.currency) = 'EUR'
               GROUP BY adjustment.patient_id
           ), scoped_financial_patients AS (
               SELECT patient_id FROM invoice_positions
               UNION
               SELECT patient_id FROM external_positions
               UNION
               SELECT patient_id FROM manual_positions
           ), financial_positions AS (
               SELECT scoped.patient_id,
                      COALESCE(invoice.invoice_due, 0)
                          + COALESCE(external.external_receivable, 0)
                          + COALESCE(manual.manual_balance, 0)
                          - COALESCE(invoice.available_prepayment, 0) AS account_balance,
                      COALESCE(external.external_receivable, 0) > 0
                          AND COALESCE(invoice.released_invoice_count, 0) > 0
                          AS reconciliation_required
               FROM scoped_financial_patients scoped
               LEFT JOIN invoice_positions invoice ON invoice.patient_id = scoped.patient_id
               LEFT JOIN external_positions external ON external.patient_id = scoped.patient_id
               LEFT JOIN manual_positions manual ON manual.patient_id = scoped.patient_id
           )
           SELECT p.id, p.patient_id, p.title, p.first_name, p.last_name,
                   p.birth_date, p.gender, p.nationality, p.residence_country,
                   p.languages, p.functional_labels, p.phone_primary, p.email,
                   p.insurance_provider, p.insurance_type,
                   p.is_active, p.lifecycle_status, p.created_at,
                   COALESCE(financial.account_balance, 0)::text AS account_balance,
                   CASE
                       WHEN COALESCE(financial.reconciliation_required, false)
                           THEN 'reconciliation_required'
                       WHEN COALESCE(financial.account_balance, 0) > 0 THEN 'debit'
                       WHEN COALESCE(financial.account_balance, 0) < 0 THEN 'credit'
                       ELSE 'settled'
                   END AS account_balance_side
           FROM patients p
           LEFT JOIN financial_positions financial ON financial.patient_id = p.id
           WHERE (
                ($5::text IS NOT NULL AND p.lifecycle_status = $5)
                OR (
                    $5::text IS NULL
                    AND p.lifecycle_status NOT IN ('prospective', 'deleted')
                    AND ($1::bool = false OR p.is_active = true)
                )
             )
             AND ($2::text = '%%'
                  OR de_normalize(concat_ws(' ',
                       p.first_name, p.last_name, p.patient_id,
                       p.email, p.phone_primary, p.phone_secondary,
                       p.insurance_provider, p.insurance_number,
                       p.nationality, p.residence_country,
                       array_to_string(p.languages, ' ')
                     )) LIKE de_normalize($2)
                  OR (length(regexp_replace($2, '\D', '', 'g')) >= 3
                      AND phone_digits(concat_ws(' ', p.phone_primary, p.phone_secondary)) LIKE '%' || regexp_replace($2, '\D', '', 'g') || '%'))
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
    .bind(lifecycle)
    .bind(include_financial_balance)
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
                        functional_labels: r.try_get("functional_labels").unwrap_or_default(),
                        phone_primary: r.try_get("phone_primary").unwrap_or_default(),
                        email: r.try_get("email").unwrap_or_default(),
                        insurance_provider: r.try_get("insurance_provider").unwrap_or_default(),
                        insurance_type: r.try_get("insurance_type").unwrap_or_default(),
                        is_active: r.try_get("is_active").unwrap_or(true),
                        lifecycle_status: r
                            .try_get("lifecycle_status")
                            .unwrap_or_else(|_| "active".to_string()),
                        account_balance: include_financial_balance.then(|| {
                            r.try_get("account_balance")
                                .unwrap_or_else(|_| "0".to_string())
                        }),
                        account_balance_currency: include_financial_balance
                            .then(|| "EUR".to_string()),
                        account_balance_side: include_financial_balance.then(|| {
                            r.try_get("account_balance_side")
                                .unwrap_or_else(|_| "settled".to_string())
                        }),
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
        Role::CeoAssistant,
        Role::PatientManager,
        Role::Billing,
        Role::TeamleadInterpreter,
        Role::Interpreter,
        Role::Concierge,
        Role::ItAdmin,
    ])?;

    match sqlx::query(
        r#"SELECT id, patient_id, title, first_name, last_name,
                  birth_date, gender, nationality, residence_country,
                  languages, functional_labels, phone_primary, phone_secondary, email,
                  address_street, address_city, address_zip, address_country,
                  insurance_provider, insurance_number, insurance_type,
                  emergency_contact_name, emergency_contact_phone, emergency_contact_relation,
                  passport_number, passport_expiry,
                  intake_profile, source_lead_id, lead_snapshot,
                  legal_status, clinical_warnings, notes, is_active, lifecycle_status,
                  created_at, updated_at
           FROM patients WHERE id = $1"#,
    )
    .bind(patient_uuid)
    .fetch_optional(&state.db)
    .await
    {
        Ok(Some(r)) => {
            let patient_id = r.try_get::<Uuid, _>("id").map_err(|_| {
                err(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Failed to decode patient",
                )
            })?;
            if !has_patient_access(&state, &auth, patient_id).await? {
                return Err(err(StatusCode::FORBIDDEN, "Insufficient permissions"));
            }

            let policies = load_patient_field_policies(&state, &auth).await?;
            let contacts = load_patient_contacts(&state, patient_id).await?;
            let patient_json = build_patient_detail_json(
                &auth,
                &policies,
                PatientDetailInput {
                    id: patient_id,
                    patient_id: r.try_get("patient_id").map_err(|_| {
                        err(
                            StatusCode::INTERNAL_SERVER_ERROR,
                            "Failed to decode patient",
                        )
                    })?,
                    title: r.try_get("title").map_err(|_| {
                        err(
                            StatusCode::INTERNAL_SERVER_ERROR,
                            "Failed to decode patient",
                        )
                    })?,
                    first_name: r.try_get("first_name").map_err(|_| {
                        err(
                            StatusCode::INTERNAL_SERVER_ERROR,
                            "Failed to decode patient",
                        )
                    })?,
                    last_name: r.try_get("last_name").map_err(|_| {
                        err(
                            StatusCode::INTERNAL_SERVER_ERROR,
                            "Failed to decode patient",
                        )
                    })?,
                    birth_date: r.try_get("birth_date").map_err(|_| {
                        err(
                            StatusCode::INTERNAL_SERVER_ERROR,
                            "Failed to decode patient",
                        )
                    })?,
                    gender: r.try_get("gender").map_err(|_| {
                        err(
                            StatusCode::INTERNAL_SERVER_ERROR,
                            "Failed to decode patient",
                        )
                    })?,
                    nationality: r.try_get("nationality").map_err(|_| {
                        err(
                            StatusCode::INTERNAL_SERVER_ERROR,
                            "Failed to decode patient",
                        )
                    })?,
                    residence_country: r.try_get("residence_country").map_err(|_| {
                        err(
                            StatusCode::INTERNAL_SERVER_ERROR,
                            "Failed to decode patient",
                        )
                    })?,
                    languages: r.try_get("languages").map_err(|_| {
                        err(
                            StatusCode::INTERNAL_SERVER_ERROR,
                            "Failed to decode patient",
                        )
                    })?,
                    functional_labels: r.try_get("functional_labels").map_err(|_| {
                        err(
                            StatusCode::INTERNAL_SERVER_ERROR,
                            "Failed to decode patient",
                        )
                    })?,
                    phone_primary: r.try_get("phone_primary").map_err(|_| {
                        err(
                            StatusCode::INTERNAL_SERVER_ERROR,
                            "Failed to decode patient",
                        )
                    })?,
                    phone_secondary: r.try_get("phone_secondary").map_err(|_| {
                        err(
                            StatusCode::INTERNAL_SERVER_ERROR,
                            "Failed to decode patient",
                        )
                    })?,
                    email: r.try_get("email").map_err(|_| {
                        err(
                            StatusCode::INTERNAL_SERVER_ERROR,
                            "Failed to decode patient",
                        )
                    })?,
                    contacts,
                    address_street: r.try_get("address_street").map_err(|_| {
                        err(
                            StatusCode::INTERNAL_SERVER_ERROR,
                            "Failed to decode patient",
                        )
                    })?,
                    address_city: r.try_get("address_city").map_err(|_| {
                        err(
                            StatusCode::INTERNAL_SERVER_ERROR,
                            "Failed to decode patient",
                        )
                    })?,
                    address_zip: r.try_get("address_zip").map_err(|_| {
                        err(
                            StatusCode::INTERNAL_SERVER_ERROR,
                            "Failed to decode patient",
                        )
                    })?,
                    address_country: r.try_get("address_country").map_err(|_| {
                        err(
                            StatusCode::INTERNAL_SERVER_ERROR,
                            "Failed to decode patient",
                        )
                    })?,
                    insurance_provider: r.try_get("insurance_provider").map_err(|_| {
                        err(
                            StatusCode::INTERNAL_SERVER_ERROR,
                            "Failed to decode patient",
                        )
                    })?,
                    insurance_number: r.try_get("insurance_number").map_err(|_| {
                        err(
                            StatusCode::INTERNAL_SERVER_ERROR,
                            "Failed to decode patient",
                        )
                    })?,
                    insurance_type: r.try_get("insurance_type").map_err(|_| {
                        err(
                            StatusCode::INTERNAL_SERVER_ERROR,
                            "Failed to decode patient",
                        )
                    })?,
                    emergency_contact_name: r.try_get("emergency_contact_name").map_err(|_| {
                        err(
                            StatusCode::INTERNAL_SERVER_ERROR,
                            "Failed to decode patient",
                        )
                    })?,
                    emergency_contact_phone: r.try_get("emergency_contact_phone").map_err(
                        |_| {
                            err(
                                StatusCode::INTERNAL_SERVER_ERROR,
                                "Failed to decode patient",
                            )
                        },
                    )?,
                    emergency_contact_relation: r.try_get("emergency_contact_relation").map_err(
                        |_| {
                            err(
                                StatusCode::INTERNAL_SERVER_ERROR,
                                "Failed to decode patient",
                            )
                        },
                    )?,
                    passport_number: r.try_get("passport_number").unwrap_or_default(),
                    passport_expiry: r.try_get("passport_expiry").unwrap_or_default(),
                    intake_profile: r.try_get("intake_profile").unwrap_or_else(|_| json!({})),
                    source_lead_id: r.try_get("source_lead_id").unwrap_or_default(),
                    lead_snapshot: r.try_get("lead_snapshot").unwrap_or_else(|_| json!({})),
                    legal_status: r.try_get("legal_status").map_err(|_| {
                        err(
                            StatusCode::INTERNAL_SERVER_ERROR,
                            "Failed to decode patient",
                        )
                    })?,
                    clinical_warnings: r.try_get("clinical_warnings").map_err(|_| {
                        err(
                            StatusCode::INTERNAL_SERVER_ERROR,
                            "Failed to decode patient",
                        )
                    })?,
                    notes: r.try_get("notes").map_err(|_| {
                        err(
                            StatusCode::INTERNAL_SERVER_ERROR,
                            "Failed to decode patient",
                        )
                    })?,
                    is_active: r.try_get("is_active").map_err(|_| {
                        err(
                            StatusCode::INTERNAL_SERVER_ERROR,
                            "Failed to decode patient",
                        )
                    })?,
                    lifecycle_status: r
                        .try_get("lifecycle_status")
                        .unwrap_or_else(|_| "active".to_string()),
                    created_at: r.try_get("created_at").map_err(|_| {
                        err(
                            StatusCode::INTERNAL_SERVER_ERROR,
                            "Failed to decode patient",
                        )
                    })?,
                    updated_at: r.try_get("updated_at").map_err(|_| {
                        err(
                            StatusCode::INTERNAL_SERVER_ERROR,
                            "Failed to decode patient",
                        )
                    })?,
                },
            );
            state.audit_sender.try_send(audit::domain_event(
                "view_patient",
                Some(auth.user_id),
                "patient",
                Some(patient_uuid),
                json!({
                    "role": auth.role,
                    "visible_fields": collect_visible_fields(&patient_json),
                }),
            ));

            Ok(Json(patient_json))
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

async fn load_patient_contacts(
    state: &AppState,
    patient_id: Uuid,
) -> Result<Vec<PatientContactInput>, axum::response::Response> {
    let rows = sqlx::query(
        r#"SELECT id, contact_kind, contact_type, value, is_primary, notes
           FROM patient_contacts
           WHERE patient_id = $1
           ORDER BY contact_kind DESC, is_primary DESC, created_at ASC, id ASC"#,
    )
    .bind(patient_id)
    .fetch_all(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, patient_id = %patient_id, "Failed to load patient contacts");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to load patient contacts",
        )
    })?;

    Ok(rows
        .into_iter()
        .map(|row| PatientContactInput {
            id: row.try_get("id").unwrap_or_default(),
            contact_kind: row.try_get("contact_kind").unwrap_or_default(),
            contact_type: row
                .try_get("contact_type")
                .unwrap_or_else(|_| "private".to_string()),
            value: row.try_get("value").unwrap_or_default(),
            is_primary: row.try_get("is_primary").unwrap_or(false),
            notes: row.try_get("notes").unwrap_or_default(),
        })
        .collect())
}

async fn replace_patient_contacts_tx(
    tx: &mut Transaction<'_, Postgres>,
    patient_id: Uuid,
    contacts: &[NormalizedPatientContact],
) -> Result<(), axum::response::Response> {
    sqlx::query("DELETE FROM patient_contacts WHERE patient_id = $1")
        .bind(patient_id)
        .execute(&mut **tx)
        .await
        .map_err(|e| {
            tracing::error!(error = %e, patient_id = %patient_id, "Failed to clear patient contacts");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to update patient contacts",
            )
        })?;

    for contact in contacts {
        sqlx::query(
            r#"INSERT INTO patient_contacts (
                    patient_id, contact_kind, contact_type, value, is_primary, notes
               ) VALUES ($1, $2, $3, $4, $5, $6)"#,
        )
        .bind(patient_id)
        .bind(&contact.contact_kind)
        .bind(&contact.contact_type)
        .bind(&contact.value)
        .bind(contact.is_primary)
        .bind(contact.notes.as_deref())
        .execute(&mut **tx)
        .await
        .map_err(|e| {
            tracing::error!(error = %e, patient_id = %patient_id, "Failed to insert patient contact");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to update patient contacts",
            )
        })?;
    }

    Ok(())
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

    let CreatePatientRequest {
        title,
        first_name,
        last_name,
        birth_date,
        gender,
        nationality,
        residence_country,
        languages,
        functional_labels,
        phone_primary,
        phone_secondary,
        email,
        contacts,
        address_street,
        address_city,
        address_zip,
        address_country,
        insurance_provider,
        insurance_number,
        insurance_type,
        emergency_contact_name,
        emergency_contact_phone,
        emergency_contact_relation,
        patient_relations,
        notes,
    } = body;

    let first_name = first_name.trim().to_string();
    let last_name = last_name.trim().to_string();
    let birth_date =
        chrono::NaiveDate::parse_from_str(birth_date.trim(), "%Y-%m-%d").map_err(|_| {
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
    let nationality = normalize_patient_select_value(nationality);
    let residence_country = normalize_patient_select_value(residence_country);
    let address_country = normalize_patient_select_value(address_country);
    let langs = match normalize_patient_language_values(languages) {
        Ok(values) => values,
        Err(message) => return Err(err(StatusCode::UNPROCESSABLE_ENTITY, message)),
    };
    let functional_labels = match normalize_functional_labels(functional_labels) {
        Ok(Some(labels)) => labels,
        Ok(None) => Vec::new(),
        Err(response) => return Err(response),
    };
    let normalized_contacts = normalize_patient_contacts(
        contacts,
        phone_primary.as_deref(),
        phone_secondary.as_deref(),
        email.as_deref(),
    );
    let derived_phone_primary = normalized_contacts
        .iter()
        .find(|contact| contact.contact_kind == "phone" && contact.is_primary)
        .or_else(|| {
            normalized_contacts
                .iter()
                .find(|contact| contact.contact_kind == "phone")
        })
        .map(|contact| contact.value.clone());
    let derived_phone_secondary = normalized_contacts
        .iter()
        .find(|contact| {
            contact.contact_kind == "phone"
                && Some(contact.value.as_str()) != derived_phone_primary.as_deref()
        })
        .map(|contact| contact.value.clone());
    let derived_email = normalized_contacts
        .iter()
        .find(|contact| contact.contact_kind == "email" && contact.is_primary)
        .or_else(|| {
            normalized_contacts
                .iter()
                .find(|contact| contact.contact_kind == "email")
        })
        .map(|contact| contact.value.clone());

    if let Some(relations) = patient_relations.as_ref() {
        for relation in relations {
            if let Some(related_patient_id) = relation.related_patient_id {
                ensure_related_patient_exists(&state, related_patient_id).await?;
            }
        }
    }

    let row = sqlx::query!(
        r#"INSERT INTO patients (
            patient_id, title, first_name, last_name, birth_date, gender,
            nationality, residence_country, languages, functional_labels,
            phone_primary, phone_secondary, email,
            address_street, address_city, address_zip, address_country,
            insurance_provider, insurance_number, insurance_type,
            emergency_contact_name, emergency_contact_phone, emergency_contact_relation,
            notes, created_by
        ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9,
            $10, $11, $12, $13, $14, $15, $16,
            $17, $18, $19, $20, $21, $22, $23, $24, $25
        ) RETURNING id, patient_id, created_at"#,
        pid,
        title,
        first_name,
        last_name,
        birth_date,
        gender,
        nationality,
        residence_country,
        &langs,
        &functional_labels,
        derived_phone_primary,
        derived_phone_secondary,
        derived_email,
        address_street,
        address_city,
        address_zip,
        address_country,
        insurance_provider,
        insurance_number,
        insurance_type,
        emergency_contact_name,
        emergency_contact_phone,
        emergency_contact_relation,
        notes,
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

    for contact in &normalized_contacts {
        sqlx::query(
            r#"INSERT INTO patient_contacts (
                    patient_id, contact_kind, contact_type, value, is_primary, notes
               ) VALUES ($1, $2, $3, $4, $5, $6)"#,
        )
        .bind(row.id)
        .bind(&contact.contact_kind)
        .bind(&contact.contact_type)
        .bind(&contact.value)
        .bind(contact.is_primary)
        .bind(contact.notes.as_deref())
        .execute(&state.db)
        .await
        .map_err(|e| {
            tracing::error!(error = %e, patient_id = %row.id, "Failed to create patient contact");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to create patient contact",
            )
        })?;
    }

    if let Some(relations) = patient_relations {
        for relation in relations {
            sqlx::query(
                r#"INSERT INTO patient_relations (
                        patient_id, related_patient_id, related_name, relation_type,
                        is_emergency_contact, phone, notes
                   ) VALUES ($1, $2, $3, $4, $5, $6, $7)"#,
            )
            .bind(row.id)
            .bind(relation.related_patient_id)
            .bind(relation.related_name.trim())
            .bind(relation.relation_type.trim())
            .bind(relation.is_emergency_contact.unwrap_or(false))
            .bind(relation.phone.as_deref())
            .bind(relation.notes.as_deref())
            .execute(&state.db)
            .await
            .map_err(|e| {
                tracing::error!(error = %e, patient_id = %row.id, "Failed to create initial patient relation");
                err(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Failed to create patient relation",
                )
            })?;
        }
    }

    sqlx::query!(
        "INSERT INTO patient_assignments (patient_id, user_id, assigned_by) VALUES ($1, $2, $2)",
        row.id,
        auth.user_id
    )
    .execute(&state.db)
    .await
    .ok();

    state.audit_sender.try_send(audit::domain_event(
        "create_patient",
        Some(auth.user_id),
        "patient",
        Some(row.id),
        serde_json::json!({ "patient_id": row.patient_id }),
    ));

    tracing::info!(by = %auth.user_id, patient = %row.patient_id, "Patient created");

    crate::realtime::publish_patient_event(
        &state,
        Some(auth.user_id),
        "patient.created",
        row.id,
        serde_json::json!({}),
    )
    .await;

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

    let current = match sqlx::query(
        r#"SELECT title, first_name, last_name, phone_primary, phone_secondary, email,
                  birth_date, gender,
                  nationality, residence_country, languages, functional_labels,
                  address_street, address_city, address_zip, address_country,
                  insurance_provider, insurance_number, insurance_type,
                  emergency_contact_name, emergency_contact_phone, emergency_contact_relation,
                  passport_number, passport_expiry,
                  notes
           FROM patients
           WHERE id = $1"#,
    )
    .bind(patient_uuid)
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

    let contacts_patch = body.contacts;
    let contacts_patch_supplied = contacts_patch.is_some();
    if let Some(contacts) = contacts_patch.as_ref() {
        for contact in contacts {
            if let Err(message) = validate_patient_contact_payload(contact) {
                return err(StatusCode::UNPROCESSABLE_ENTITY, message);
            }
        }
    }
    let emergency_contact_supplied = body.emergency_contact_name.is_some()
        || body.emergency_contact_phone.is_some()
        || body.emergency_contact_relation.is_some();

    let first = match body.first_name.as_deref() {
        Some(value) => {
            let trimmed = value.trim();
            if trimmed.is_empty() {
                return err(StatusCode::UNPROCESSABLE_ENTITY, "first name required");
            }
            trimmed.to_string()
        }
        None => current.try_get("first_name").unwrap_or_default(),
    };
    let last = match body.last_name.as_deref() {
        Some(value) => {
            let trimmed = value.trim();
            if trimmed.is_empty() {
                return err(StatusCode::UNPROCESSABLE_ENTITY, "last name required");
            }
            trimmed.to_string()
        }
        None => current.try_get("last_name").unwrap_or_default(),
    };
    let birth_date_supplied = body.birth_date.is_some();
    let birth_date: chrono::NaiveDate = match body.birth_date.as_deref() {
        Some(value) => {
            let trimmed = value.trim();
            if trimmed.is_empty() {
                return err(StatusCode::UNPROCESSABLE_ENTITY, "Birth date required");
            }
            match chrono::NaiveDate::parse_from_str(trimmed, "%Y-%m-%d") {
                Ok(value) => value,
                Err(_) => {
                    return err(
                        StatusCode::UNPROCESSABLE_ENTITY,
                        "Invalid birth_date format (YYYY-MM-DD)",
                    );
                }
            }
        }
        None => current.try_get("birth_date").unwrap_or_default(),
    };
    let gender_supplied = body.gender.is_some();
    let gender = match body.gender.as_deref() {
        Some(value) => match value.trim() {
            "male" => "male".to_string(),
            "female" => "female".to_string(),
            "diverse" => "diverse".to_string(),
            _ => {
                return err(
                    StatusCode::UNPROCESSABLE_ENTITY,
                    "Gender must be male, female, or diverse",
                );
            }
        },
        None => current.try_get("gender").unwrap_or_default(),
    };
    let nationality_supplied = body.nationality.is_some();
    let residence_country_supplied = body.residence_country.is_some();
    let address_country_supplied = body.address_country.is_some();
    let title = match normalize_patient_text_patch(
        body.title,
        current.try_get("title").unwrap_or_default(),
        "title",
    ) {
        Ok(value) => value,
        Err(response) => return response,
    };
    let mut phone_primary = match normalize_patient_text_patch(
        body.phone_primary,
        current.try_get("phone_primary").unwrap_or_default(),
        "phone_primary",
    ) {
        Ok(value) => value,
        Err(response) => return response,
    };
    let mut phone_secondary = match normalize_patient_text_patch(
        body.phone_secondary,
        current.try_get("phone_secondary").unwrap_or_default(),
        "phone_secondary",
    ) {
        Ok(value) => value,
        Err(response) => return response,
    };
    let mut email = match normalize_patient_text_patch(
        body.email,
        current.try_get("email").unwrap_or_default(),
        "email",
    ) {
        Ok(value) => value,
        Err(response) => return response,
    };
    let normalized_contacts = contacts_patch.map(|contacts| {
        let contacts = normalize_patient_contacts(
            Some(contacts),
            phone_primary.as_deref(),
            phone_secondary.as_deref(),
            email.as_deref(),
        );
        let (derived_phone_primary, derived_phone_secondary, derived_email) =
            patient_contact_legacy_values(&contacts);
        phone_primary = derived_phone_primary;
        phone_secondary = derived_phone_secondary;
        email = derived_email;
        contacts
    });
    let current_nationality: Option<String> = current.try_get("nationality").unwrap_or_default();
    let nationality = match normalize_patient_text_patch(
        body.nationality,
        current_nationality.clone(),
        "nationality",
    ) {
        Ok(value) => value,
        Err(response) => return response,
    };
    if nationality_supplied
        && let Err(message) = validate_optional_patient_select_update(
            nationality.as_deref(),
            current_nationality.as_deref(),
            &ALLOWED_PATIENT_NATIONALITIES,
            "nationality",
        )
    {
        return err(StatusCode::UNPROCESSABLE_ENTITY, message);
    }
    let current_residence_country: Option<String> =
        current.try_get("residence_country").unwrap_or_default();
    let residence_country = match normalize_patient_text_patch(
        body.residence_country,
        current_residence_country.clone(),
        "residence_country",
    ) {
        Ok(value) => value,
        Err(response) => return response,
    };
    if residence_country_supplied
        && let Err(message) = validate_optional_patient_select_update(
            residence_country.as_deref(),
            current_residence_country.as_deref(),
            &ALLOWED_PATIENT_COUNTRIES,
            "residence_country",
        )
    {
        return err(StatusCode::UNPROCESSABLE_ENTITY, message);
    }
    let address_street = match normalize_patient_text_patch(
        body.address_street,
        current.try_get("address_street").unwrap_or_default(),
        "address_street",
    ) {
        Ok(value) => value,
        Err(response) => return response,
    };
    let address_city = match normalize_patient_text_patch(
        body.address_city,
        current.try_get("address_city").unwrap_or_default(),
        "address_city",
    ) {
        Ok(value) => value,
        Err(response) => return response,
    };
    let address_zip = match normalize_patient_text_patch(
        body.address_zip,
        current.try_get("address_zip").unwrap_or_default(),
        "address_zip",
    ) {
        Ok(value) => value,
        Err(response) => return response,
    };
    let current_address_country: Option<String> =
        current.try_get("address_country").unwrap_or_default();
    let address_country = match normalize_patient_text_patch(
        body.address_country,
        current_address_country.clone(),
        "address_country",
    ) {
        Ok(value) => value,
        Err(response) => return response,
    };
    if address_country_supplied
        && let Err(message) = validate_optional_patient_select_update(
            address_country.as_deref(),
            current_address_country.as_deref(),
            &ALLOWED_PATIENT_COUNTRIES,
            "address_country",
        )
    {
        return err(StatusCode::UNPROCESSABLE_ENTITY, message);
    }
    let insurance_provider = match normalize_patient_text_patch(
        body.insurance_provider,
        current.try_get("insurance_provider").unwrap_or_default(),
        "insurance_provider",
    ) {
        Ok(value) => value,
        Err(response) => return response,
    };
    let insurance_number = match normalize_patient_text_patch(
        body.insurance_number,
        current.try_get("insurance_number").unwrap_or_default(),
        "insurance_number",
    ) {
        Ok(value) => value,
        Err(response) => return response,
    };
    let insurance_type = match normalize_patient_insurance_type_patch(
        body.insurance_type,
        current.try_get("insurance_type").unwrap_or_default(),
    ) {
        Ok(value) => value,
        Err(response) => return response,
    };
    let emergency_contact_name = match normalize_patient_text_patch(
        body.emergency_contact_name,
        current
            .try_get("emergency_contact_name")
            .unwrap_or_default(),
        "emergency_contact_name",
    ) {
        Ok(value) => value,
        Err(response) => return response,
    };
    let emergency_contact_phone = match normalize_patient_text_patch(
        body.emergency_contact_phone,
        current
            .try_get("emergency_contact_phone")
            .unwrap_or_default(),
        "emergency_contact_phone",
    ) {
        Ok(value) => value,
        Err(response) => return response,
    };
    let emergency_contact_relation = match normalize_patient_text_patch(
        body.emergency_contact_relation,
        current
            .try_get("emergency_contact_relation")
            .unwrap_or_default(),
        "emergency_contact_relation",
    ) {
        Ok(value) => value,
        Err(response) => return response,
    };
    if (birth_date_supplied || emergency_contact_supplied || contacts_patch_supplied)
        && is_minor_birth_date(birth_date, chrono::Utc::now().date_naive())
        && !has_guardian_or_parent_contact(
            emergency_contact_relation.as_deref(),
            emergency_contact_name.as_deref(),
            emergency_contact_phone.as_deref(),
        )
    {
        let has_existing_guardian_relation = match sqlx::query_scalar::<_, bool>(
            r#"SELECT EXISTS (
                   SELECT 1
                   FROM patient_relations
                   WHERE patient_id = $1
                     AND relation_type IN ('guardian', 'parent')
                     AND btrim(related_name) <> ''
               )"#,
        )
        .bind(patient_uuid)
        .fetch_one(&state.db)
        .await
        {
            Ok(value) => value,
            Err(e) => {
                tracing::error!(
                    error = %e,
                    patient_id = %patient_uuid,
                    "Failed to validate minor guardian relation"
                );
                return err(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Failed to validate minor guardian relation",
                );
            }
        };

        if !has_existing_guardian_relation {
            return err(
                StatusCode::UNPROCESSABLE_ENTITY,
                "Minor patients require a guardian/parent relation or guardian emergency contact",
            );
        }
    }
    let notes = match normalize_patient_text_patch(
        body.notes,
        current.try_get("notes").unwrap_or_default(),
        "notes",
    ) {
        Ok(value) => value,
        Err(response) => return response,
    };
    let current_languages: Vec<String> = current.try_get("languages").unwrap_or_default();
    let languages = if let Some(languages) = body.languages {
        match normalize_patient_language_values_for_update(languages, &current_languages) {
            Ok(values) => values,
            Err(message) => return err(StatusCode::UNPROCESSABLE_ENTITY, message),
        }
    } else {
        current_languages
    };
    let functional_labels_supplied = body.functional_labels.is_some();
    let functional_labels = match normalize_functional_labels(body.functional_labels) {
        Ok(Some(labels)) => labels,
        Ok(None) => current.try_get("functional_labels").unwrap_or_default(),
        Err(response) => return response,
    };
    let passport_number = match normalize_patient_text_patch(
        body.passport_number,
        current.try_get("passport_number").unwrap_or_default(),
        "passport_number",
    ) {
        Ok(value) => value,
        Err(response) => return response,
    };
    let passport_expiry: Option<chrono::NaiveDate> = match body.passport_expiry.as_deref() {
        Some(value) => {
            let trimmed = value.trim();
            if trimmed.is_empty() {
                None
            } else {
                match chrono::NaiveDate::parse_from_str(trimmed, "%Y-%m-%d") {
                    Ok(parsed) => Some(parsed),
                    Err(_) => {
                        return err(
                            StatusCode::UNPROCESSABLE_ENTITY,
                            "Invalid passport_expiry format (YYYY-MM-DD)",
                        );
                    }
                }
            }
        }
        None => current.try_get("passport_expiry").unwrap_or_default(),
    };
    let legal_status = match body.legal_status {
        Some(value) => match normalize_legal_status(value) {
            Ok(value) => Some(SqlxJson(value)),
            Err(response) => return response,
        },
        None => None,
    };
    let clinical_warnings_supplied = body.clinical_warnings.is_some();
    let clinical_warnings = match body.clinical_warnings {
        Some(value) => {
            let trimmed = value.trim();
            if trimmed.len() > 4000 {
                return err(
                    StatusCode::UNPROCESSABLE_ENTITY,
                    "clinical_warnings too long",
                );
            }
            Some((!trimmed.is_empty()).then(|| trimmed.to_string()))
        }
        None => None,
    };
    let legal_status_updated = legal_status.is_some();
    let clinical_warnings_updated = clinical_warnings_supplied;
    let functional_labels_updated = functional_labels_supplied;
    let birth_date_updated = birth_date_supplied;
    let gender_updated = gender_supplied;
    let contract_status = legal_status
        .as_ref()
        .and_then(|value| value.0.get("contract_status"))
        .cloned()
        .unwrap_or(Value::Null);
    let compliance_completed = legal_status
        .as_ref()
        .and_then(|value| value.0.get("compliance_completed").and_then(Value::as_bool))
        .unwrap_or(false);

    let mut tx = match state.db.begin().await {
        Ok(tx) => tx,
        Err(e) => {
            tracing::error!(error = %e, patient_id = %patient_uuid, "Failed to begin patient update transaction");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to update patient",
            );
        }
    };

    let result = sqlx::query(
        r#"UPDATE patients SET
            title = $2,
            first_name = $3, last_name = $4,
            birth_date = $5,
            gender = $6,
            phone_primary = $7,
            phone_secondary = $8,
            email = $9,
            nationality = $10,
            residence_country = $11,
            languages = $12,
            functional_labels = $13,
            address_street = $14,
            address_city = $15,
            address_zip = $16,
            address_country = $17,
            insurance_provider = $18,
            insurance_number = $19,
            insurance_type = $20,
            emergency_contact_name = $21,
            emergency_contact_phone = $22,
            emergency_contact_relation = $23,
            legal_status = COALESCE($24::jsonb, legal_status),
            notes = $25,
            clinical_warnings = CASE WHEN $26 THEN $27 ELSE clinical_warnings END,
            passport_number = $28,
            passport_expiry = $29,
            updated_at = now()
        WHERE id = $1"#,
    )
    .bind(patient_uuid)
    .bind(title)
    .bind(&first)
    .bind(&last)
    .bind(birth_date)
    .bind(gender)
    .bind(phone_primary)
    .bind(phone_secondary)
    .bind(email)
    .bind(nationality)
    .bind(residence_country)
    .bind(languages)
    .bind(functional_labels)
    .bind(address_street)
    .bind(address_city)
    .bind(address_zip)
    .bind(address_country)
    .bind(insurance_provider)
    .bind(insurance_number)
    .bind(insurance_type)
    .bind(emergency_contact_name)
    .bind(emergency_contact_phone)
    .bind(emergency_contact_relation)
    .bind(legal_status)
    .bind(notes)
    .bind(clinical_warnings_supplied)
    .bind(clinical_warnings.flatten())
    .bind(passport_number)
    .bind(passport_expiry)
    .execute(&mut *tx)
    .await;

    let audit_context = serde_json::json!({
        "legal_status_updated": legal_status_updated,
        "clinical_warnings_updated": clinical_warnings_updated,
        "functional_labels_updated": functional_labels_updated,
        "birth_date_updated": birth_date_updated,
        "gender_updated": gender_updated,
        "contract_status": contract_status,
        "compliance_completed": compliance_completed,
    });

    match result {
        Ok(_) => {
            if let Some(contacts) = normalized_contacts.as_ref()
                && let Err(response) =
                    replace_patient_contacts_tx(&mut tx, patient_uuid, contacts).await
            {
                return response;
            }
            if let Err(e) = tx.commit().await {
                tracing::error!(error = %e, patient_id = %patient_uuid, "Failed to commit patient update transaction");
                return err(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Failed to update patient",
                );
            }
            state.audit_sender.try_send(audit::domain_event(
                "update_patient",
                Some(auth.user_id),
                "patient",
                Some(patient_uuid),
                audit_context,
            ));
            crate::realtime::publish_patient_event(
                &state,
                Some(auth.user_id),
                "patient.updated",
                patient_uuid,
                serde_json::json!({}),
            )
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

async fn list_patient_lab_results(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(patient_uuid): Path<Uuid>,
) -> impl IntoResponse {
    auth.require_any_role(PATIENT_CLINICAL_ROLES)?;
    if !has_patient_access(&state, &auth, patient_uuid).await? {
        return Err(err(StatusCode::FORBIDDEN, "Insufficient permissions"));
    }

    let rows = sqlx::query(
        r#"SELECT lr.id, lr.measured_at, lr.measured_at_precision,
                  lr.panel, lr.laboratory_name, lr.analyte_name, lr.result_text,
                  lr.numeric_result, lr.comparator, lr.unit, lr.reference_text,
                  lr.reference_low, lr.reference_high, lr.abnormal_flag, lr.source_country,
                  lr.source_document_id, lr.source_import_id, lr.source_candidate_id,
                  lr.source_page, lr.recorded_by, lr.created_at,
                  lr.corrected_at, lr.corrected_by, lr.correction_note,
                  u.name AS recorded_by_name, cu.name AS corrected_by_name,
                  COALESCE(d.original_filename, d.auto_name) AS source_document_name
           FROM patient_lab_results lr
           LEFT JOIN users u ON u.id = lr.recorded_by
           LEFT JOIN users cu ON cu.id = lr.corrected_by
           LEFT JOIN documents d ON d.id = lr.source_document_id
           WHERE lr.patient_id = $1 AND lr.deleted_at IS NULL
           ORDER BY lr.measured_at DESC, lr.panel NULLS LAST, lr.created_at, lr.analyte_name"#,
    )
    .bind(patient_uuid)
    .fetch_all(&state.db)
    .await
    .map_err(|error| {
        tracing::error!(error = %error, patient_id = %patient_uuid, "Failed to load patient lab results");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to load patient lab results",
        )
    })?;

    let items = rows.iter().map(patient_lab_result_json).collect::<Vec<_>>();
    let count = items.len();
    Ok(Json(json!({ "items": items, "count": count })))
}

fn patient_lab_result_json(row: &PgRow) -> Value {
    json!({
        "id": row.get::<Uuid, _>("id"),
        "measured_at": row.get::<chrono::DateTime<chrono::Utc>, _>("measured_at").to_rfc3339(),
        "measured_at_precision": row.get::<String, _>("measured_at_precision"),
        "panel": row.get::<Option<String>, _>("panel"),
        "laboratory_name": row.get::<Option<String>, _>("laboratory_name"),
        "analyte_name": row.get::<String, _>("analyte_name"),
        "result_text": row.get::<String, _>("result_text"),
        "numeric_result": row.get::<Option<f64>, _>("numeric_result"),
        "comparator": row.get::<Option<String>, _>("comparator"),
        "unit": row.get::<Option<String>, _>("unit"),
        "reference_text": row.get::<Option<String>, _>("reference_text"),
        "reference_low": row.get::<Option<f64>, _>("reference_low"),
        "reference_high": row.get::<Option<f64>, _>("reference_high"),
        "abnormal_flag": row.get::<String, _>("abnormal_flag"),
        "source_country": row.get::<Option<String>, _>("source_country"),
        "source_document_id": row.get::<Option<Uuid>, _>("source_document_id"),
        "source_document_name": row.get::<Option<String>, _>("source_document_name"),
        "source_import_id": row.get::<Option<Uuid>, _>("source_import_id"),
        "source_candidate_id": row.get::<Option<String>, _>("source_candidate_id"),
        "source_page": row.get::<Option<i32>, _>("source_page"),
        "recorded_by": row.get::<Option<Uuid>, _>("recorded_by"),
        "recorded_by_name": row.get::<Option<String>, _>("recorded_by_name"),
        "corrected_at": row
            .get::<Option<chrono::DateTime<chrono::Utc>>, _>("corrected_at")
            .map(|value| value.to_rfc3339()),
        "corrected_by": row.get::<Option<Uuid>, _>("corrected_by"),
        "corrected_by_name": row.get::<Option<String>, _>("corrected_by_name"),
        "correction_note": row.get::<Option<String>, _>("correction_note"),
        "created_at": row.get::<chrono::DateTime<chrono::Utc>, _>("created_at").to_rfc3339(),
    })
}

async fn update_patient_lab_result(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Extension(audit_context): Extension<audit::AuditContext>,
    Path((patient_uuid, lab_result_id)): Path<(Uuid, Uuid)>,
    Json(raw_body): Json<Value>,
) -> axum::response::Response {
    if let Err(response) = auth.require_any_role(PATIENT_CLINICAL_ROLES) {
        return response;
    }
    match has_patient_access(&state, &auth, patient_uuid).await {
        Ok(true) => {}
        Ok(false) => return err(StatusCode::FORBIDDEN, "Insufficient permissions"),
        Err(_response) => {
            tracing::error!(patient_id = %patient_uuid, "Failed to validate patient access for lab correction");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to update lab result",
            );
        }
    }
    let (lab, correction_note) = match normalize_patient_lab_result_correction_payload(&raw_body) {
        Ok(normalized) => normalized,
        Err(response) => return response,
    };

    let mut tx = match state.db.begin().await {
        Ok(tx) => tx,
        Err(error) => {
            tracing::error!(error = %error, patient_id = %patient_uuid, lab_result_id = %lab_result_id, "Failed to begin lab correction transaction");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to update lab result",
            );
        }
    };
    let previous = match sqlx::query(
        r#"SELECT measured_at, measured_at_precision, panel, laboratory_name, analyte_name, result_text,
                  numeric_result, comparator, unit, reference_text, reference_low,
                  reference_high, abnormal_flag, source_country, source_document_id,
                  source_import_id, source_candidate_id, source_page,
                  corrected_at, corrected_by, correction_note
           FROM patient_lab_results
           WHERE id = $1 AND patient_id = $2 AND deleted_at IS NULL
           FOR UPDATE"#,
    )
    .bind(lab_result_id)
    .bind(patient_uuid)
    .fetch_optional(&mut *tx)
    .await
    {
        Ok(Some(row)) => row,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Lab result not found"),
        Err(error) => {
            tracing::error!(error = %error, patient_id = %patient_uuid, lab_result_id = %lab_result_id, "Failed to lock lab result for correction");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to update lab result",
            );
        }
    };

    let old_value = json!({
        "measured_at": previous.get::<chrono::DateTime<chrono::Utc>, _>("measured_at").to_rfc3339(),
        "measured_at_precision": previous.get::<String, _>("measured_at_precision"),
        "panel": previous.get::<Option<String>, _>("panel"),
        "laboratory_name": previous.get::<Option<String>, _>("laboratory_name"),
        "analyte_name": previous.get::<String, _>("analyte_name"),
        "result_text": previous.get::<String, _>("result_text"),
        "numeric_result": previous.get::<Option<f64>, _>("numeric_result"),
        "comparator": previous.get::<Option<String>, _>("comparator"),
        "unit": previous.get::<Option<String>, _>("unit"),
        "reference_text": previous.get::<Option<String>, _>("reference_text"),
        "reference_low": previous.get::<Option<f64>, _>("reference_low"),
        "reference_high": previous.get::<Option<f64>, _>("reference_high"),
        "abnormal_flag": previous.get::<String, _>("abnormal_flag"),
        "correction_note": previous.get::<Option<String>, _>("correction_note"),
        "corrected_at": previous
            .get::<Option<chrono::DateTime<chrono::Utc>>, _>("corrected_at")
            .map(|value| value.to_rfc3339()),
        "corrected_by": previous.get::<Option<Uuid>, _>("corrected_by"),
    });
    let provenance = json!({
        "source_country": previous.get::<Option<String>, _>("source_country"),
        "source_document_id": previous.get::<Option<Uuid>, _>("source_document_id"),
        "source_import_id": previous.get::<Option<Uuid>, _>("source_import_id"),
        "source_candidate_id": previous.get::<Option<String>, _>("source_candidate_id"),
        "source_page": previous.get::<Option<i32>, _>("source_page"),
    });
    let source_import_id = previous.get::<Option<Uuid>, _>("source_import_id");
    if let Some(source_import_id) = source_import_id {
        let import_status = match sqlx::query_scalar::<_, String>(
            r#"SELECT status
               FROM clinical_document_imports
               WHERE id = $1 AND patient_id = $2
               FOR SHARE"#,
        )
        .bind(source_import_id)
        .bind(patient_uuid)
        .fetch_optional(&mut *tx)
        .await
        {
            Ok(status) => status,
            Err(error) => {
                tracing::error!(error = %error, patient_id = %patient_uuid, lab_result_id = %lab_result_id, import_id = %source_import_id, "Failed to validate lab correction import state");
                return err(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Failed to update lab result",
                );
            }
        };
        if import_status.as_deref() != Some("applied") {
            return err(
                StatusCode::CONFLICT,
                "Imported lab result can only be corrected after the clinical import is applied",
            );
        }
    }
    if source_import_id.is_some()
        && lab.measured_at_precision == "datetime"
        && raw_body
            .get("measured_at")
            .and_then(Value::as_str)
            .is_none_or(|value| chrono::DateTime::parse_from_rfc3339(value.trim()).is_err())
    {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Imported lab measured_at must be a date or include an explicit timezone offset",
        );
    }

    if let Err(error) = sqlx::query(
        r#"UPDATE patient_lab_results
           SET measured_at = $3,
               measured_at_precision = $4,
               panel = $5,
               laboratory_name = $6,
               analyte_name = $7,
               result_text = $8,
               numeric_result = $9,
               comparator = $10,
               unit = $11,
               reference_text = $12,
               reference_low = $13,
               reference_high = $14,
               abnormal_flag = $15,
               corrected_at = now(),
               corrected_by = $16,
               correction_note = $17,
               updated_at = now()
           WHERE id = $1 AND patient_id = $2"#,
    )
    .bind(lab_result_id)
    .bind(patient_uuid)
    .bind(lab.measured_at)
    .bind(lab.measured_at_precision)
    .bind(&lab.panel)
    .bind(&lab.laboratory_name)
    .bind(&lab.analyte_name)
    .bind(&lab.result_text)
    .bind(lab.numeric_result)
    .bind(&lab.comparator)
    .bind(&lab.unit)
    .bind(&lab.reference_text)
    .bind(lab.reference_low)
    .bind(lab.reference_high)
    .bind(&lab.abnormal_flag)
    .bind(auth.user_id)
    .bind(&correction_note)
    .execute(&mut *tx)
    .await
    {
        tracing::error!(error = %error, patient_id = %patient_uuid, lab_result_id = %lab_result_id, "Failed to update patient lab result");
        return err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to update lab result",
        );
    }

    let updated = match sqlx::query(
        r#"SELECT lr.id, lr.measured_at, lr.measured_at_precision,
                  lr.panel, lr.laboratory_name, lr.analyte_name, lr.result_text,
                  lr.numeric_result, lr.comparator, lr.unit, lr.reference_text,
                  lr.reference_low, lr.reference_high, lr.abnormal_flag, lr.source_country,
                  lr.source_document_id, lr.source_import_id, lr.source_candidate_id,
                  lr.source_page, lr.recorded_by, lr.created_at,
                  lr.corrected_at, lr.corrected_by, lr.correction_note,
                  u.name AS recorded_by_name, cu.name AS corrected_by_name,
                  COALESCE(d.original_filename, d.auto_name) AS source_document_name
           FROM patient_lab_results lr
           LEFT JOIN users u ON u.id = lr.recorded_by
           LEFT JOIN users cu ON cu.id = lr.corrected_by
           LEFT JOIN documents d ON d.id = lr.source_document_id
           WHERE lr.id = $1 AND lr.patient_id = $2"#,
    )
    .bind(lab_result_id)
    .bind(patient_uuid)
    .fetch_one(&mut *tx)
    .await
    {
        Ok(row) => row,
        Err(error) => {
            tracing::error!(error = %error, patient_id = %patient_uuid, lab_result_id = %lab_result_id, "Failed to reload corrected lab result");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to update lab result",
            );
        }
    };
    let item = patient_lab_result_json(&updated);
    let new_value = json!({
        "measured_at": item["measured_at"],
        "measured_at_precision": item["measured_at_precision"],
        "panel": item["panel"],
        "laboratory_name": item["laboratory_name"],
        "analyte_name": item["analyte_name"],
        "result_text": item["result_text"],
        "numeric_result": item["numeric_result"],
        "comparator": item["comparator"],
        "unit": item["unit"],
        "reference_text": item["reference_text"],
        "reference_low": item["reference_low"],
        "reference_high": item["reference_high"],
        "abnormal_flag": item["abnormal_flag"],
        "correction_note": item["correction_note"],
        "corrected_at": item["corrected_at"],
        "corrected_by": item["corrected_by"],
    });
    if let Err(error) = tx.commit().await {
        tracing::error!(error = %error, patient_id = %patient_uuid, lab_result_id = %lab_result_id, "Failed to commit lab result correction");
        return err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to update lab result",
        );
    }

    audit_context.set_entity("patient_lab_result", lab_result_id);
    audit_context.set_action("correct_patient_lab_result");
    audit_context.set_old_value(old_value);
    audit_context.set_new_value(new_value);
    audit_context.set_context(json!({
        "patient_id": patient_uuid,
        "reason": correction_note,
        "provenance": provenance,
    }));

    crate::realtime::publish_patient_event(
        &state,
        Some(auth.user_id),
        "patient.clinical_updated",
        patient_uuid,
        json!({ "section": "lab_results", "action": "correct", "lab_result_id": lab_result_id }),
    )
    .await;

    Json(json!({ "ok": true, "item": item })).into_response()
}

async fn delete_patient_lab_result(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Extension(audit_context): Extension<audit::AuditContext>,
    Path((patient_uuid, lab_result_id)): Path<(Uuid, Uuid)>,
    Json(body): Json<DeletePatientLabResultRequest>,
) -> axum::response::Response {
    if let Err(response) = auth.require_any_role(PATIENT_CLINICAL_ROLES) {
        return response;
    }
    match has_patient_access(&state, &auth, patient_uuid).await {
        Ok(true) => {}
        Ok(false) => return err(StatusCode::FORBIDDEN, "Insufficient permissions"),
        Err(_response) => {
            tracing::error!(patient_id = %patient_uuid, "Failed to validate patient access for lab deletion");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to delete lab result",
            );
        }
    }
    let deletion_note = body.deletion_note.trim();
    if deletion_note.is_empty() || deletion_note.chars().count() > 500 {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "deletion_note is required and must not exceed 500 characters",
        );
    }

    let mut tx = match state.db.begin().await {
        Ok(tx) => tx,
        Err(error) => {
            tracing::error!(error = %error, patient_id = %patient_uuid, lab_result_id = %lab_result_id, "Failed to begin lab deletion transaction");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to delete lab result",
            );
        }
    };
    let previous = match sqlx::query(
        r#"SELECT measured_at, measured_at_precision, panel, laboratory_name, analyte_name, result_text,
                  numeric_result, comparator, unit, reference_text, reference_low,
                  reference_high, abnormal_flag, source_country, source_document_id,
                  source_import_id, source_candidate_id, source_page,
                  corrected_at, corrected_by, correction_note
           FROM patient_lab_results
           WHERE id = $1 AND patient_id = $2 AND deleted_at IS NULL
           FOR UPDATE"#,
    )
    .bind(lab_result_id)
    .bind(patient_uuid)
    .fetch_optional(&mut *tx)
    .await
    {
        Ok(Some(row)) => row,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Lab result not found"),
        Err(error) => {
            tracing::error!(error = %error, patient_id = %patient_uuid, lab_result_id = %lab_result_id, "Failed to lock lab result for deletion");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to delete lab result",
            );
        }
    };

    let source_import_id = previous.get::<Option<Uuid>, _>("source_import_id");
    if let Some(source_import_id) = source_import_id {
        let import_status = match sqlx::query_scalar::<_, String>(
            r#"SELECT status
               FROM clinical_document_imports
               WHERE id = $1 AND patient_id = $2
               FOR SHARE"#,
        )
        .bind(source_import_id)
        .bind(patient_uuid)
        .fetch_optional(&mut *tx)
        .await
        {
            Ok(status) => status,
            Err(error) => {
                tracing::error!(error = %error, patient_id = %patient_uuid, lab_result_id = %lab_result_id, import_id = %source_import_id, "Failed to validate lab deletion import state");
                return err(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Failed to delete lab result",
                );
            }
        };
        if import_status.as_deref() != Some("applied") {
            return err(
                StatusCode::CONFLICT,
                "Imported lab result can only be deleted after the clinical import is applied",
            );
        }
    }

    let old_value = json!({
        "measured_at": previous.get::<chrono::DateTime<chrono::Utc>, _>("measured_at").to_rfc3339(),
        "measured_at_precision": previous.get::<String, _>("measured_at_precision"),
        "panel": previous.get::<Option<String>, _>("panel"),
        "laboratory_name": previous.get::<Option<String>, _>("laboratory_name"),
        "analyte_name": previous.get::<String, _>("analyte_name"),
        "result_text": previous.get::<String, _>("result_text"),
        "numeric_result": previous.get::<Option<f64>, _>("numeric_result"),
        "comparator": previous.get::<Option<String>, _>("comparator"),
        "unit": previous.get::<Option<String>, _>("unit"),
        "reference_text": previous.get::<Option<String>, _>("reference_text"),
        "reference_low": previous.get::<Option<f64>, _>("reference_low"),
        "reference_high": previous.get::<Option<f64>, _>("reference_high"),
        "abnormal_flag": previous.get::<String, _>("abnormal_flag"),
        "corrected_at": previous
            .get::<Option<chrono::DateTime<chrono::Utc>>, _>("corrected_at")
            .map(|value| value.to_rfc3339()),
        "corrected_by": previous.get::<Option<Uuid>, _>("corrected_by"),
        "correction_note": previous.get::<Option<String>, _>("correction_note"),
    });
    let provenance = json!({
        "source_country": previous.get::<Option<String>, _>("source_country"),
        "source_document_id": previous.get::<Option<Uuid>, _>("source_document_id"),
        "source_import_id": source_import_id,
        "source_candidate_id": previous.get::<Option<String>, _>("source_candidate_id"),
        "source_page": previous.get::<Option<i32>, _>("source_page"),
    });
    let deleted_at = match sqlx::query_scalar::<_, chrono::DateTime<chrono::Utc>>(
        r#"UPDATE patient_lab_results
           SET deleted_at = now(), deleted_by = $3, deletion_note = $4, updated_at = now()
           WHERE id = $1 AND patient_id = $2 AND deleted_at IS NULL
           RETURNING deleted_at"#,
    )
    .bind(lab_result_id)
    .bind(patient_uuid)
    .bind(auth.user_id)
    .bind(deletion_note)
    .fetch_one(&mut *tx)
    .await
    {
        Ok(deleted_at) => deleted_at,
        Err(error) => {
            tracing::error!(error = %error, patient_id = %patient_uuid, lab_result_id = %lab_result_id, "Failed to soft-delete lab result");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to delete lab result",
            );
        }
    };
    if let Err(error) = tx.commit().await {
        tracing::error!(error = %error, patient_id = %patient_uuid, lab_result_id = %lab_result_id, "Failed to commit lab deletion");
        return err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to delete lab result",
        );
    }

    audit_context.set_entity("patient_lab_result", lab_result_id);
    audit_context.set_action("delete_patient_lab_result");
    audit_context.set_old_value(old_value);
    audit_context.set_new_value(json!({
        "deleted_at": deleted_at.to_rfc3339(),
        "deleted_by": auth.user_id,
        "deletion_note": deletion_note,
    }));
    audit_context.set_context(json!({
        "patient_id": patient_uuid,
        "reason": deletion_note,
        "provenance": provenance,
    }));

    crate::realtime::publish_patient_event(
        &state,
        Some(auth.user_id),
        "patient.clinical_updated",
        patient_uuid,
        json!({ "section": "lab_results", "action": "delete", "lab_result_id": lab_result_id }),
    )
    .await;

    Json(json!({ "ok": true, "id": lab_result_id })).into_response()
}

async fn create_patient_lab_result(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(patient_uuid): Path<Uuid>,
    Json(raw_body): Json<Value>,
) -> axum::response::Response {
    if let Err(response) = auth.require_any_role(PATIENT_CLINICAL_ROLES) {
        return response;
    }
    match has_patient_access(&state, &auth, patient_uuid).await {
        Ok(true) => {}
        Ok(false) => return err(StatusCode::FORBIDDEN, "Insufficient permissions"),
        Err(_) => {
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to validate patient access",
            );
        }
    }
    let lab = match normalize_patient_lab_result_payload(&raw_body) {
        Ok(lab) => lab,
        Err(response) => return response,
    };

    let source_document_id = if let Some(import_id) = lab.source_import_id {
        match sqlx::query(
            r#"SELECT document_id, prepared_source_country, reviewed_draft,
                      prepared_candidate_payloads, prepared_identity_gate_version
               FROM clinical_document_imports
               WHERE id = $1 AND patient_id = $2 AND status = 'applying'
                 AND deleted_at IS NULL"#,
        )
        .bind(import_id)
        .bind(patient_uuid)
        .fetch_optional(&state.db)
        .await
        {
            Ok(Some(import)) => {
                if import.get::<i16, _>("prepared_identity_gate_version") < 1 {
                    return err(
                        StatusCode::CONFLICT,
                        "Clinical import identity gate must be completed before lab persistence",
                    );
                }
                let selected = import
                    .get::<Option<Value>, _>("reviewed_draft")
                    .and_then(|draft| draft.get("candidates").and_then(Value::as_array).cloned())
                    .is_some_and(|candidates| {
                        candidates.iter().any(|candidate| {
                            candidate.get("id").and_then(Value::as_str)
                                == lab.source_candidate_id.as_deref()
                                && candidate.get("target").and_then(Value::as_str)
                                    == Some("lab_result")
                                && candidate.get("selected").and_then(Value::as_bool) == Some(true)
                        })
                    });
                if !selected {
                    return err(
                        StatusCode::CONFLICT,
                        "Lab candidate is not selected in the prepared review",
                    );
                }
                if import
                    .get::<Option<String>, _>("prepared_source_country")
                    .as_deref()
                    != lab.source_country.as_deref()
                {
                    return err(
                        StatusCode::CONFLICT,
                        "Lab source_country differs from the prepared import country",
                    );
                }
                if import
                    .get::<Value, _>("prepared_candidate_payloads")
                    .get(lab.source_candidate_id.as_deref().unwrap_or_default())
                    != Some(&raw_body)
                {
                    return err(
                        StatusCode::CONFLICT,
                        "Lab payload differs from the immutable prepared candidate payload",
                    );
                }
                Some(import.get::<Uuid, _>("document_id"))
            }
            Ok(None) => {
                return err(
                    StatusCode::CONFLICT,
                    "Clinical import must be prepared before lab persistence",
                );
            }
            Err(error) => {
                tracing::error!(error = %error, import_id = %import_id, "Failed to validate lab import provenance");
                return err(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Failed to record lab result",
                );
            }
        }
    } else {
        None
    };

    let row = match sqlx::query(
        r#"INSERT INTO patient_lab_results (
                patient_id, measured_at, panel, laboratory_name, analyte_name, result_text,
                numeric_result, comparator, unit, reference_text, reference_low,
                reference_high, abnormal_flag, source_country, source_document_id,
                source_import_id, source_candidate_id, source_page, recorded_by,
                measured_at_precision
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
           ON CONFLICT (source_import_id, source_candidate_id)
             WHERE source_import_id IS NOT NULL AND source_candidate_id IS NOT NULL
           DO UPDATE SET updated_at = patient_lab_results.updated_at
             WHERE (
                 patient_lab_results.patient_id,
                 patient_lab_results.measured_at,
                 patient_lab_results.panel,
                 patient_lab_results.laboratory_name,
                 patient_lab_results.analyte_name,
                 patient_lab_results.result_text,
                 patient_lab_results.numeric_result,
                 patient_lab_results.comparator,
                 patient_lab_results.unit,
                 patient_lab_results.reference_text,
                 patient_lab_results.reference_low,
                 patient_lab_results.reference_high,
                 patient_lab_results.abnormal_flag,
                 patient_lab_results.source_country,
                 patient_lab_results.source_document_id,
                 patient_lab_results.source_page,
                 patient_lab_results.measured_at_precision
             ) IS NOT DISTINCT FROM (
                 EXCLUDED.patient_id,
                 EXCLUDED.measured_at,
                 EXCLUDED.panel,
                 EXCLUDED.laboratory_name,
                 EXCLUDED.analyte_name,
                 EXCLUDED.result_text,
                 EXCLUDED.numeric_result,
                 EXCLUDED.comparator,
                 EXCLUDED.unit,
                 EXCLUDED.reference_text,
                 EXCLUDED.reference_low,
                 EXCLUDED.reference_high,
                 EXCLUDED.abnormal_flag,
                 EXCLUDED.source_country,
                 EXCLUDED.source_document_id,
                 EXCLUDED.source_page,
                 EXCLUDED.measured_at_precision
             )
           RETURNING id, created_at"#,
    )
    .bind(patient_uuid)
    .bind(lab.measured_at)
    .bind(&lab.panel)
    .bind(&lab.laboratory_name)
    .bind(&lab.analyte_name)
    .bind(&lab.result_text)
    .bind(lab.numeric_result)
    .bind(&lab.comparator)
    .bind(&lab.unit)
    .bind(&lab.reference_text)
    .bind(lab.reference_low)
    .bind(lab.reference_high)
    .bind(&lab.abnormal_flag)
    .bind(&lab.source_country)
    .bind(source_document_id)
    .bind(lab.source_import_id)
    .bind(&lab.source_candidate_id)
    .bind(lab.source_page)
    .bind(auth.user_id)
    .bind(lab.measured_at_precision)
    .fetch_optional(&state.db)
    .await
    {
        Ok(Some(row)) => row,
        Ok(None) => {
            return err(
                StatusCode::CONFLICT,
                "This prepared lab candidate was already persisted with different reviewed fields",
            );
        }
        Err(error) => {
            tracing::error!(error = %error, patient_id = %patient_uuid, "Failed to record patient lab result");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to record lab result");
        }
    };
    let lab_result_id = row.get::<Uuid, _>("id");
    state.audit_sender.try_send(audit::domain_event(
        "record_patient_lab_result",
        Some(auth.user_id),
        "patient",
        Some(patient_uuid),
        json!({
            "lab_result_id": lab_result_id,
            "source_import_id": lab.source_import_id,
            "has_reference_range": lab.reference_low.is_some() || lab.reference_high.is_some(),
            "abnormal_flag": lab.abnormal_flag,
        }),
    ));
    crate::realtime::publish_patient_event(
        &state,
        Some(auth.user_id),
        "patient.clinical_updated",
        patient_uuid,
        json!({ "section": "lab_results", "action": "upsert", "lab_result_id": lab_result_id }),
    )
    .await;

    Json(json!({
        "id": lab_result_id,
        "created_at": row.get::<chrono::DateTime<chrono::Utc>, _>("created_at").to_rfc3339(),
        "ok": true,
    }))
    .into_response()
}

async fn list_patient_vitals(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(patient_uuid): Path<Uuid>,
) -> impl IntoResponse {
    auth.require_any_role(PATIENT_CLINICAL_ROLES)?;

    if !has_patient_access(&state, &auth, patient_uuid).await? {
        return Err(err(StatusCode::FORBIDDEN, "Insufficient permissions"));
    }

    let rows = sqlx::query(
        r#"SELECT vm.id,
                  vm.measured_at,
                  vm.measured_at_precision,
                  vm.bp_systolic,
                  vm.bp_diastolic,
                  vm.heart_rate,
                  vm.temperature_c,
                  vm.oxygen_saturation,
                  vm.respiratory_rate,
                  vm.weight_kg,
                  vm.height_cm,
                  vm.bmi,
                  vm.notes,
                  vm.source_country,
                  vm.source_document_id,
                  vm.source_import_id,
                  vm.source_candidate_id,
                  vm.source_page,
                  vm.recorded_by,
                  vm.created_at,
                  u.name AS recorded_by_name,
                  COALESCE(d.original_filename, d.auto_name) AS source_document_name
           FROM patient_vital_measurements vm
           LEFT JOIN users u ON u.id = vm.recorded_by
           LEFT JOIN documents d ON d.id = vm.source_document_id
           WHERE vm.patient_id = $1
           ORDER BY vm.measured_at DESC, vm.created_at DESC"#,
    )
    .bind(patient_uuid)
    .fetch_all(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, patient_id = %patient_uuid, "Failed to load patient vitals");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to load patient vitals",
        )
    })?;

    let items = rows
        .into_iter()
        .map(|row| {
            json!({
                "id": row.get::<Uuid, _>("id"),
                "measured_at": row.get::<chrono::DateTime<chrono::Utc>, _>("measured_at").to_rfc3339(),
                "measured_at_precision": row.get::<String, _>("measured_at_precision"),
                "bp_systolic": row.get::<Option<f64>, _>("bp_systolic"),
                "bp_diastolic": row.get::<Option<f64>, _>("bp_diastolic"),
                "heart_rate": row.get::<Option<i32>, _>("heart_rate"),
                "temperature_c": row.get::<Option<f64>, _>("temperature_c"),
                "oxygen_saturation": row.get::<Option<f64>, _>("oxygen_saturation"),
                "respiratory_rate": row.get::<Option<i32>, _>("respiratory_rate"),
                "weight_kg": row.get::<Option<f64>, _>("weight_kg"),
                "height_cm": row.get::<Option<f64>, _>("height_cm"),
                "bmi": row.get::<Option<f64>, _>("bmi"),
                "notes": row.get::<Option<String>, _>("notes"),
                "source_country": row.get::<Option<String>, _>("source_country"),
                "source_document_id": row.get::<Option<Uuid>, _>("source_document_id"),
                "source_document_name": row.get::<Option<String>, _>("source_document_name"),
                "source_import_id": row.get::<Option<Uuid>, _>("source_import_id"),
                "source_candidate_id": row.get::<Option<String>, _>("source_candidate_id"),
                "source_page": row.get::<Option<i32>, _>("source_page"),
                "recorded_by": row.get::<Option<Uuid>, _>("recorded_by"),
                "recorded_by_name": row.get::<Option<String>, _>("recorded_by_name"),
                "created_at": row.get::<chrono::DateTime<chrono::Utc>, _>("created_at").to_rfc3339(),
            })
        })
        .collect::<Vec<_>>();
    let count = items.len();

    Ok(Json(json!({
        "items": items,
        "count": count,
    })))
}

async fn create_patient_vital_measurement(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(patient_uuid): Path<Uuid>,
    Json(raw_body): Json<Value>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(PATIENT_CLINICAL_ROLES) {
        return e;
    }

    match has_patient_access(&state, &auth, patient_uuid).await {
        Ok(true) => {}
        Ok(false) => return err(StatusCode::FORBIDDEN, "Insufficient permissions"),
        Err(_) => {
            tracing::error!(patient_id = %patient_uuid, "Failed to validate patient access");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to record patient vitals",
            );
        }
    }

    let vital = match normalize_patient_vital_measurement_payload(&raw_body) {
        Ok(vital) => vital,
        Err(response) => return response,
    };
    let mut tx = match state.db.begin().await {
        Ok(tx) => tx,
        Err(error) => {
            tracing::error!(error = %error, patient_id = %patient_uuid, "Failed to begin vital measurement transaction");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to record patient vitals",
            );
        }
    };
    let source_document_id = if let Some(import_id) = vital.source_import_id {
        let import = match sqlx::query(
            r#"SELECT document_id, status, prepared_source_country, reviewed_draft,
                      prepared_candidate_payloads, prepared_identity_gate_version
               FROM clinical_document_imports
               WHERE id = $1 AND patient_id = $2 AND status IN ('applying', 'applied')
                 AND deleted_at IS NULL
               FOR UPDATE"#,
        )
        .bind(import_id)
        .bind(patient_uuid)
        .fetch_optional(&mut *tx)
        .await
        {
            Ok(Some(import)) => import,
            Ok(None) => {
                return err(
                    StatusCode::CONFLICT,
                    "Clinical import must be prepared before vital persistence",
                );
            }
            Err(error) => {
                tracing::error!(error = %error, import_id = %import_id, "Failed to validate vital import provenance");
                return err(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Failed to record patient vitals",
                );
            }
        };
        if import.get::<i16, _>("prepared_identity_gate_version") < 1 {
            return err(
                StatusCode::CONFLICT,
                "Clinical import identity gate must be completed before vital persistence",
            );
        }
        let candidate_id = vital.source_candidate_id.as_deref().unwrap_or_default();
        let selected = import
            .get::<Option<Value>, _>("reviewed_draft")
            .and_then(|draft| draft.get("candidates").and_then(Value::as_array).cloned())
            .is_some_and(|candidates| {
                candidates.iter().any(|candidate| {
                    candidate.get("id").and_then(Value::as_str) == Some(candidate_id)
                        && candidate.get("target").and_then(Value::as_str) == Some("vital")
                        && candidate.get("selected").and_then(Value::as_bool) == Some(true)
                })
            });
        if !selected {
            return err(
                StatusCode::CONFLICT,
                "Vital candidate is not selected in the prepared review",
            );
        }
        if import
            .get::<Option<String>, _>("prepared_source_country")
            .as_deref()
            != vital.source_country.as_deref()
        {
            return err(
                StatusCode::CONFLICT,
                "Vital source_country differs from the prepared import country",
            );
        }
        if import
            .get::<Value, _>("prepared_candidate_payloads")
            .get(candidate_id)
            != Some(&raw_body)
        {
            return err(
                StatusCode::CONFLICT,
                "Vital payload differs from the immutable prepared candidate payload",
            );
        }
        if import.get::<String, _>("status") == "applied" {
            let persisted = match sqlx::query_scalar::<_, bool>(
                r#"SELECT EXISTS(
                       SELECT 1 FROM patient_vital_measurements
                       WHERE patient_id = $1 AND source_import_id = $2
                         AND source_candidate_id = $3
                   )"#,
            )
            .bind(patient_uuid)
            .bind(import_id)
            .bind(candidate_id)
            .fetch_one(&mut *tx)
            .await
            {
                Ok(persisted) => persisted,
                Err(error) => {
                    tracing::error!(error = %error, import_id = %import_id, candidate_id = %candidate_id, "Failed to validate idempotent vital retry");
                    return err(
                        StatusCode::INTERNAL_SERVER_ERROR,
                        "Failed to record patient vitals",
                    );
                }
            };
            if !persisted {
                return err(
                    StatusCode::CONFLICT,
                    "Applied vital candidate has no persisted measurement",
                );
            }
        }
        Some(import.get::<Uuid, _>("document_id"))
    } else {
        None
    };

    let row = match sqlx::query(
        r#"INSERT INTO patient_vital_measurements (
                patient_id, measured_at, bp_systolic, bp_diastolic, heart_rate,
                temperature_c, oxygen_saturation, respiratory_rate,
                weight_kg, height_cm, bmi, notes, source_country, source_document_id,
                source_import_id, source_candidate_id, source_page, recorded_by,
                measured_at_precision
           ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
                $14, $15, $16, $17, $18, $19
           )
           ON CONFLICT (source_import_id, source_candidate_id)
             WHERE source_import_id IS NOT NULL AND source_candidate_id IS NOT NULL
           DO UPDATE SET updated_at = patient_vital_measurements.updated_at
             WHERE (
                 patient_vital_measurements.patient_id,
                 patient_vital_measurements.measured_at,
                 patient_vital_measurements.bp_systolic,
                 patient_vital_measurements.bp_diastolic,
                 patient_vital_measurements.heart_rate,
                 patient_vital_measurements.temperature_c,
                 patient_vital_measurements.oxygen_saturation,
                 patient_vital_measurements.respiratory_rate,
                 patient_vital_measurements.weight_kg,
                 patient_vital_measurements.height_cm,
                 patient_vital_measurements.bmi,
                 patient_vital_measurements.notes,
                 patient_vital_measurements.source_country,
                 patient_vital_measurements.source_document_id,
                 patient_vital_measurements.source_page,
                 patient_vital_measurements.measured_at_precision
             ) IS NOT DISTINCT FROM (
                 EXCLUDED.patient_id,
                 EXCLUDED.measured_at,
                 EXCLUDED.bp_systolic,
                 EXCLUDED.bp_diastolic,
                 EXCLUDED.heart_rate,
                 EXCLUDED.temperature_c,
                 EXCLUDED.oxygen_saturation,
                 EXCLUDED.respiratory_rate,
                 EXCLUDED.weight_kg,
                 EXCLUDED.height_cm,
                 EXCLUDED.bmi,
                 EXCLUDED.notes,
                 EXCLUDED.source_country,
                 EXCLUDED.source_document_id,
                 EXCLUDED.source_page,
                 EXCLUDED.measured_at_precision
             )
           RETURNING id, created_at, (xmax = 0) AS inserted"#,
    )
    .bind(patient_uuid)
    .bind(vital.measured_at)
    .bind(vital.bp_systolic)
    .bind(vital.bp_diastolic)
    .bind(vital.heart_rate)
    .bind(vital.temperature_c)
    .bind(vital.oxygen_saturation)
    .bind(vital.respiratory_rate)
    .bind(vital.weight_kg)
    .bind(vital.height_cm)
    .bind(vital.bmi)
    .bind(&vital.notes)
    .bind(&vital.source_country)
    .bind(source_document_id)
    .bind(vital.source_import_id)
    .bind(&vital.source_candidate_id)
    .bind(vital.source_page)
    .bind(auth.user_id)
    .bind(vital.measured_at_precision)
    .fetch_optional(&mut *tx)
    .await
    {
        Ok(Some(row)) => row,
        Ok(None) => {
            return err(
                StatusCode::CONFLICT,
                "This prepared vital candidate was already persisted with different reviewed fields",
            );
        }
        Err(e) => {
            tracing::error!(error = %e, patient_id = %patient_uuid, "Failed to record patient vitals");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to record patient vitals",
            );
        }
    };
    if let Err(error) = tx.commit().await {
        tracing::error!(error = %error, patient_id = %patient_uuid, "Failed to commit vital measurement transaction");
        return err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to record patient vitals",
        );
    }

    let measurement_id = row.get::<Uuid, _>("id");
    let idempotent = !row.get::<bool, _>("inserted");

    if !idempotent {
        state.audit_sender.try_send(audit::domain_event(
            "record_patient_vitals",
            Some(auth.user_id),
            "patient",
            Some(patient_uuid),
            json!({
                "measurement_id": measurement_id,
                "measured_at": vital.measured_at.to_rfc3339(),
                "measured_at_precision": vital.measured_at_precision,
                "source_import_id": vital.source_import_id,
                "source_candidate_id": vital.source_candidate_id,
                "has_blood_pressure": vital.bp_systolic.is_some(),
                "has_heart_rate": vital.heart_rate.is_some(),
                "has_temperature": vital.temperature_c.is_some(),
                "has_oxygen_saturation": vital.oxygen_saturation.is_some(),
                "has_respiratory_rate": vital.respiratory_rate.is_some(),
                "has_weight": vital.weight_kg.is_some(),
                "has_height": vital.height_cm.is_some(),
                "has_notes": vital.notes.is_some(),
            }),
        ));
        crate::realtime::publish_patient_event(
            &state,
            Some(auth.user_id),
            "patient.clinical_updated",
            patient_uuid,
            json!({ "section": "vitals", "action": "upsert", "vital_measurement_id": measurement_id }),
        )
        .await;
    }

    Json(json!({
        "id": measurement_id,
        "created_at": row.get::<chrono::DateTime<chrono::Utc>, _>("created_at").to_rfc3339(),
        "ok": true,
        "idempotent": idempotent,
    }))
    .into_response()
}

async fn update_patient_vital_measurement(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path((patient_uuid, measurement_uuid)): Path<(Uuid, Uuid)>,
    Json(raw_body): Json<Value>,
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
                "Failed to update patient vitals",
            );
        }
    }

    let vital = match normalize_patient_vital_measurement_payload(&raw_body) {
        Ok(vital) => vital,
        Err(response) => return response,
    };
    if vital.source_country.is_some()
        || vital.source_import_id.is_some()
        || vital.source_candidate_id.is_some()
        || vital.source_page.is_some()
    {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Vital measurement provenance cannot be changed",
        );
    }
    let imported = match sqlx::query_scalar::<_, bool>(
        r#"SELECT source_candidate_id IS NOT NULL
           FROM patient_vital_measurements
           WHERE id = $1 AND patient_id = $2"#,
    )
    .bind(measurement_uuid)
    .bind(patient_uuid)
    .fetch_optional(&state.db)
    .await
    {
        Ok(Some(imported)) => imported,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Vital measurement not found"),
        Err(error) => {
            tracing::error!(error = %error, patient_id = %patient_uuid, measurement_id = %measurement_uuid, "Failed to inspect patient vitals provenance");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to update patient vitals",
            );
        }
    };
    if imported {
        return err(
            StatusCode::CONFLICT,
            "Imported vital measurements are immutable",
        );
    }

    let updated = match sqlx::query(
        r#"UPDATE patient_vital_measurements
           SET measured_at = $1,
               bp_systolic = $2,
               bp_diastolic = $3,
               heart_rate = $4,
               temperature_c = $5,
               oxygen_saturation = $6,
               respiratory_rate = $7,
               weight_kg = $8,
               height_cm = $9,
               bmi = $10,
               notes = $11,
               measured_at_precision = $12,
               updated_at = now()
           WHERE id = $13 AND patient_id = $14 AND source_candidate_id IS NULL"#,
    )
    .bind(vital.measured_at)
    .bind(vital.bp_systolic)
    .bind(vital.bp_diastolic)
    .bind(vital.heart_rate)
    .bind(vital.temperature_c)
    .bind(vital.oxygen_saturation)
    .bind(vital.respiratory_rate)
    .bind(vital.weight_kg)
    .bind(vital.height_cm)
    .bind(vital.bmi)
    .bind(&vital.notes)
    .bind(vital.measured_at_precision)
    .bind(measurement_uuid)
    .bind(patient_uuid)
    .execute(&state.db)
    .await
    {
        Ok(done) => done,
        Err(e) => {
            tracing::error!(error = %e, patient_id = %patient_uuid, measurement_id = %measurement_uuid, "Failed to update patient vitals");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to update patient vitals",
            );
        }
    };

    if updated.rows_affected() == 0 {
        return err(StatusCode::NOT_FOUND, "Vital measurement not found");
    }

    state.audit_sender.try_send(audit::domain_event(
        "update_patient_vitals",
        Some(auth.user_id),
        "patient",
        Some(patient_uuid),
        json!({
            "measurement_id": measurement_uuid,
            "measured_at": vital.measured_at.to_rfc3339(),
            "has_blood_pressure": vital.bp_systolic.is_some(),
            "has_heart_rate": vital.heart_rate.is_some(),
            "has_temperature": vital.temperature_c.is_some(),
            "has_oxygen_saturation": vital.oxygen_saturation.is_some(),
            "has_respiratory_rate": vital.respiratory_rate.is_some(),
            "has_weight": vital.weight_kg.is_some(),
            "has_height": vital.height_cm.is_some(),
            "has_notes": vital.notes.is_some(),
        }),
    ));

    Json(json!({
        "id": measurement_uuid,
        "ok": true,
    }))
    .into_response()
}

async fn delete_patient_vital_measurement(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path((patient_uuid, measurement_uuid)): Path<(Uuid, Uuid)>,
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
                "Failed to delete patient vitals",
            );
        }
    }

    let imported = match sqlx::query_scalar::<_, bool>(
        r#"SELECT source_candidate_id IS NOT NULL
           FROM patient_vital_measurements
           WHERE id = $1 AND patient_id = $2"#,
    )
    .bind(measurement_uuid)
    .bind(patient_uuid)
    .fetch_optional(&state.db)
    .await
    {
        Ok(Some(imported)) => imported,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Vital measurement not found"),
        Err(error) => {
            tracing::error!(error = %error, patient_id = %patient_uuid, measurement_id = %measurement_uuid, "Failed to inspect patient vitals provenance");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to delete patient vitals",
            );
        }
    };
    if imported {
        return err(
            StatusCode::CONFLICT,
            "Imported vital measurements are immutable",
        );
    }

    let deleted = match sqlx::query(
        r#"DELETE FROM patient_vital_measurements
           WHERE id = $1 AND patient_id = $2 AND source_candidate_id IS NULL
           RETURNING measured_at"#,
    )
    .bind(measurement_uuid)
    .bind(patient_uuid)
    .fetch_optional(&state.db)
    .await
    {
        Ok(row) => row,
        Err(e) => {
            tracing::error!(error = %e, patient_id = %patient_uuid, measurement_id = %measurement_uuid, "Failed to delete patient vitals");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to delete patient vitals",
            );
        }
    };

    let Some(deleted) = deleted else {
        return err(StatusCode::NOT_FOUND, "Vital measurement not found");
    };
    let measured_at = deleted
        .get::<chrono::DateTime<chrono::Utc>, _>("measured_at")
        .to_rfc3339();

    state.audit_sender.try_send(audit::domain_event(
        "delete_patient_vitals",
        Some(auth.user_id),
        "patient",
        Some(patient_uuid),
        json!({
            "measurement_id": measurement_uuid,
            "measured_at": measured_at,
        }),
    ));
    crate::realtime::publish_patient_event(
        &state,
        Some(auth.user_id),
        "patient.clinical_updated",
        patient_uuid,
        json!({
            "section": "vitals",
            "action": "delete",
            "measurement_id": measurement_uuid,
        }),
    )
    .await;

    Json(json!({
        "id": measurement_uuid,
        "ok": true,
    }))
    .into_response()
}

async fn list_patient_card_entries(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(patient_uuid): Path<Uuid>,
) -> impl IntoResponse {
    auth.require_any_role(&[Role::Ceo, Role::PatientManager])?;

    if !has_patient_access(&state, &auth, patient_uuid).await? {
        return Err(err(StatusCode::FORBIDDEN, "Insufficient permissions"));
    }

    let rows = sqlx::query(
        r#"SELECT e.id,
                  e.entry_date,
                  e.category,
                  e.source,
                  e.content,
                  e.author_id,
                  e.created_at,
                  e.updated_at,
                  u.name AS author_name
           FROM patient_card_entries e
           LEFT JOIN users u ON u.id = e.author_id
           WHERE e.patient_id = $1
           ORDER BY e.entry_date DESC, e.created_at DESC"#,
    )
    .bind(patient_uuid)
    .fetch_all(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, patient_id = %patient_uuid, "Failed to load patient card entries");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to load patient card entries",
        )
    })?;

    let items = rows
        .into_iter()
        .map(|row| {
            json!({
                "id": row.get::<Uuid, _>("id"),
                "entry_date": row.get::<chrono::DateTime<chrono::Utc>, _>("entry_date").to_rfc3339(),
                "category": row.get::<String, _>("category"),
                "source": row.get::<Option<String>, _>("source"),
                "content": row.get::<String, _>("content"),
                "author_id": row.get::<Uuid, _>("author_id"),
                "author_name": row.get::<Option<String>, _>("author_name"),
                "created_at": row.get::<chrono::DateTime<chrono::Utc>, _>("created_at").to_rfc3339(),
                "updated_at": row.get::<chrono::DateTime<chrono::Utc>, _>("updated_at").to_rfc3339(),
            })
        })
        .collect::<Vec<_>>();

    let count = items.len();

    Ok(Json(json!({
        "items": items,
        "count": count,
    })))
}

async fn create_patient_card_entry(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(patient_uuid): Path<Uuid>,
    Json(body): Json<CreatePatientCardEntryRequest>,
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
                "Failed to create patient card entry",
            );
        }
    }

    let entry_date = match parse_vital_measurement_timestamp(&body.entry_date) {
        Ok(value) => value,
        Err(response) => return response,
    };
    let category = body.category.trim().to_lowercase();
    if !PATIENT_CARD_ENTRY_CATEGORIES.contains(&category.as_str()) {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Invalid patient card entry category",
        );
    }
    let source = match normalize_optional_text(body.source, "source", 120) {
        Ok(value) => value,
        Err(response) => return response,
    };
    let content = body.content.trim();
    if content.is_empty() {
        return err(StatusCode::UNPROCESSABLE_ENTITY, "content required");
    }
    if content.len() > 4000 {
        return err(StatusCode::UNPROCESSABLE_ENTITY, "content too long");
    }

    let row = match sqlx::query(
        r#"INSERT INTO patient_card_entries (
                patient_id, entry_date, category, source, content, author_id
           ) VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING id, created_at"#,
    )
    .bind(patient_uuid)
    .bind(entry_date)
    .bind(category.as_str())
    .bind(source.clone())
    .bind(content)
    .bind(auth.user_id)
    .fetch_one(&state.db)
    .await
    {
        Ok(row) => row,
        Err(e) => {
            tracing::error!(error = %e, patient_id = %patient_uuid, "Failed to create patient card entry");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to create patient card entry",
            );
        }
    };

    state.audit_sender.try_send(audit::domain_event(
        "create_patient_card_entry",
        Some(auth.user_id),
        "patient",
        Some(patient_uuid),
        json!({
            "entry_id": row.get::<Uuid, _>("id"),
            "entry_date": entry_date.to_rfc3339(),
            "category": category,
            "source": source,
        }),
    ));

    Json(json!({
        "id": row.get::<Uuid, _>("id"),
        "created_at": row.get::<chrono::DateTime<chrono::Utc>, _>("created_at").to_rfc3339(),
        "ok": true,
    }))
    .into_response()
}

async fn list_patient_medical_orders(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(patient_uuid): Path<Uuid>,
) -> impl IntoResponse {
    auth.require_any_role(&[Role::Ceo, Role::PatientManager])?;

    if !has_patient_access(&state, &auth, patient_uuid).await? {
        return Err(err(StatusCode::FORBIDDEN, "Insufficient permissions"));
    }

    let rows = sqlx::query(
        r#"SELECT mo.id,
                  mo.order_date,
                  mo.order_type,
                  mo.title,
                  mo.instructions,
                  mo.status,
                  mo.due_date,
                  mo.source,
                  mo.ordered_by,
                  mo.created_at,
                  mo.updated_at,
                  u.name AS ordered_by_name
           FROM patient_medical_orders mo
           LEFT JOIN users u ON u.id = mo.ordered_by
           WHERE mo.patient_id = $1
           ORDER BY mo.order_date DESC, mo.created_at DESC"#,
    )
    .bind(patient_uuid)
    .fetch_all(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, patient_id = %patient_uuid, "Failed to load patient medical orders");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to load patient medical orders",
        )
    })?;

    let items = rows
        .into_iter()
        .map(|row| {
            json!({
                "id": row.get::<Uuid, _>("id"),
                "order_date": row.get::<chrono::DateTime<chrono::Utc>, _>("order_date").to_rfc3339(),
                "order_type": row.get::<String, _>("order_type"),
                "title": row.get::<String, _>("title"),
                "instructions": row.get::<String, _>("instructions"),
                "status": row.get::<String, _>("status"),
                "due_date": row.get::<Option<chrono::NaiveDate>, _>("due_date").map(|value| value.to_string()),
                "source": row.get::<Option<String>, _>("source"),
                "ordered_by": row.get::<Uuid, _>("ordered_by"),
                "ordered_by_name": row.get::<Option<String>, _>("ordered_by_name"),
                "created_at": row.get::<chrono::DateTime<chrono::Utc>, _>("created_at").to_rfc3339(),
                "updated_at": row.get::<chrono::DateTime<chrono::Utc>, _>("updated_at").to_rfc3339(),
            })
        })
        .collect::<Vec<_>>();

    let count = items.len();

    Ok(Json(json!({
        "items": items,
        "count": count,
    })))
}

async fn create_patient_medical_order(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(patient_uuid): Path<Uuid>,
    Json(body): Json<CreatePatientMedicalOrderRequest>,
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
                "Failed to create patient medical order",
            );
        }
    }

    let order_date = match parse_vital_measurement_timestamp(&body.order_date) {
        Ok(value) => value,
        Err(response) => return response,
    };
    let order_type = match validate_patient_medical_order_type(&body.order_type) {
        Ok(value) => value,
        Err(response) => return response,
    };
    let title = match normalize_required_text(&body.title, "title", 160) {
        Ok(value) => value,
        Err(response) => return response,
    };
    let instructions = match normalize_required_text(&body.instructions, "instructions", 4000) {
        Ok(value) => value,
        Err(response) => return response,
    };
    let due_date = match parse_optional_naive_date(body.due_date, "due_date") {
        Ok(value) => value,
        Err(response) => return response,
    };
    let source = match normalize_optional_text(body.source, "source", 120) {
        Ok(value) => value,
        Err(response) => return response,
    };

    let row = match sqlx::query(
        r#"INSERT INTO patient_medical_orders (
                patient_id, order_date, order_type, title, instructions,
                status, due_date, source, ordered_by
           ) VALUES ($1, $2, $3, $4, $5, 'active', $6, $7, $8)
           RETURNING id, created_at"#,
    )
    .bind(patient_uuid)
    .bind(order_date)
    .bind(order_type.as_str())
    .bind(title.as_str())
    .bind(instructions.as_str())
    .bind(due_date)
    .bind(source.clone())
    .bind(auth.user_id)
    .fetch_one(&state.db)
    .await
    {
        Ok(row) => row,
        Err(e) => {
            tracing::error!(error = %e, patient_id = %patient_uuid, "Failed to create patient medical order");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to create patient medical order",
            );
        }
    };

    state.audit_sender.try_send(audit::domain_event(
        "create_patient_medical_order",
        Some(auth.user_id),
        "patient",
        Some(patient_uuid),
        json!({
            "order_id": row.get::<Uuid, _>("id"),
            "order_date": order_date.to_rfc3339(),
            "order_type": order_type,
            "status": "active",
            "due_date": due_date.map(|value| value.to_string()),
            "source": source,
        }),
    ));

    Json(json!({
        "id": row.get::<Uuid, _>("id"),
        "created_at": row.get::<chrono::DateTime<chrono::Utc>, _>("created_at").to_rfc3339(),
        "ok": true,
    }))
    .into_response()
}

async fn update_patient_medical_order(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path((patient_uuid, medical_order_id)): Path<(Uuid, Uuid)>,
    Json(body): Json<UpdatePatientMedicalOrderRequest>,
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
                "Failed to update patient medical order",
            );
        }
    }

    let current = match sqlx::query(
        r#"SELECT order_date, order_type, title, instructions, status, due_date, source
           FROM patient_medical_orders
           WHERE id = $1 AND patient_id = $2"#,
    )
    .bind(medical_order_id)
    .bind(patient_uuid)
    .fetch_optional(&state.db)
    .await
    {
        Ok(Some(row)) => row,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Medical order not found"),
        Err(e) => {
            tracing::error!(error = %e, patient_id = %patient_uuid, order_id = %medical_order_id, "Failed to load patient medical order");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to update patient medical order",
            );
        }
    };

    let order_date = match body.order_date {
        Some(value) => match parse_vital_measurement_timestamp(&value) {
            Ok(parsed) => parsed,
            Err(response) => return response,
        },
        None => current.get::<chrono::DateTime<chrono::Utc>, _>("order_date"),
    };

    let order_type = match body.order_type {
        Some(value) => match validate_patient_medical_order_type(&value) {
            Ok(parsed) => parsed,
            Err(response) => return response,
        },
        None => current.get::<String, _>("order_type"),
    };

    let title = match body.title {
        Some(value) => match normalize_required_text(&value, "title", 160) {
            Ok(parsed) => parsed,
            Err(response) => return response,
        },
        None => current.get::<String, _>("title"),
    };

    let instructions = match body.instructions {
        Some(value) => match normalize_required_text(&value, "instructions", 4000) {
            Ok(parsed) => parsed,
            Err(response) => return response,
        },
        None => current.get::<String, _>("instructions"),
    };

    let status = match body.status {
        Some(value) => match validate_patient_medical_order_status(&value) {
            Ok(parsed) => parsed,
            Err(response) => return response,
        },
        None => current.get::<String, _>("status"),
    };

    let due_date = match parse_optional_patch_naive_date(body.due_date, "due_date") {
        Ok(Some(value)) => value,
        Ok(None) => current.get::<Option<chrono::NaiveDate>, _>("due_date"),
        Err(response) => return response,
    };

    let source = if body.source.is_some() {
        match normalize_optional_text(body.source, "source", 120) {
            Ok(value) => value,
            Err(response) => return response,
        }
    } else {
        current.get::<Option<String>, _>("source")
    };

    match sqlx::query(
        r#"UPDATE patient_medical_orders
           SET order_date = $3,
               order_type = $4,
               title = $5,
               instructions = $6,
               status = $7,
               due_date = $8,
               source = $9
           WHERE id = $1 AND patient_id = $2"#,
    )
    .bind(medical_order_id)
    .bind(patient_uuid)
    .bind(order_date)
    .bind(order_type.as_str())
    .bind(title.as_str())
    .bind(instructions.as_str())
    .bind(status.as_str())
    .bind(due_date)
    .bind(source.clone())
    .execute(&state.db)
    .await
    {
        Ok(_) => {}
        Err(e) => {
            tracing::error!(error = %e, patient_id = %patient_uuid, order_id = %medical_order_id, "Failed to update patient medical order");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to update patient medical order",
            );
        }
    }

    state.audit_sender.try_send(audit::domain_event(
        "update_patient_medical_order",
        Some(auth.user_id),
        "patient",
        Some(patient_uuid),
        json!({
            "order_id": medical_order_id,
            "order_date": order_date.to_rfc3339(),
            "order_type": order_type,
            "status": status,
            "due_date": due_date.map(|value| value.to_string()),
            "source": source,
        }),
    ));

    Json(json!({ "ok": true })).into_response()
}

async fn list_patient_risk_scores(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(patient_uuid): Path<Uuid>,
) -> impl IntoResponse {
    auth.require_any_role(&[Role::Ceo, Role::PatientManager])?;

    if !has_patient_access(&state, &auth, patient_uuid).await? {
        return Err(err(StatusCode::FORBIDDEN, "Insufficient permissions"));
    }

    let rows = sqlx::query(
        r#"SELECT rs.id,
                  rs.computed_at,
                  rs.score_type,
                  rs.score_value,
                  rs.scale_max,
                  rs.interpretation,
                  rs.source,
                  rs.inputs,
                  rs.recorded_by,
                  rs.created_at,
                  u.name AS recorded_by_name
           FROM patient_risk_scores rs
           LEFT JOIN users u ON u.id = rs.recorded_by
           WHERE rs.patient_id = $1
           ORDER BY rs.computed_at DESC, rs.created_at DESC"#,
    )
    .bind(patient_uuid)
    .fetch_all(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, patient_id = %patient_uuid, "Failed to load patient risk scores");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to load patient risk scores",
        )
    })?;

    let items = rows
        .into_iter()
        .map(|row| {
            json!({
                "id": row.get::<Uuid, _>("id"),
                "computed_at": row.get::<chrono::DateTime<chrono::Utc>, _>("computed_at").to_rfc3339(),
                "score_type": row.get::<String, _>("score_type"),
                "score_value": row.get::<f64, _>("score_value"),
                "scale_max": row.get::<Option<f64>, _>("scale_max"),
                "interpretation": row.get::<Option<String>, _>("interpretation"),
                "source": row.get::<Option<String>, _>("source"),
                "inputs": row.get::<Option<SqlxJson<Value>>, _>("inputs").map(|value| value.0),
                "recorded_by": row.get::<Uuid, _>("recorded_by"),
                "recorded_by_name": row.get::<Option<String>, _>("recorded_by_name"),
                "created_at": row.get::<chrono::DateTime<chrono::Utc>, _>("created_at").to_rfc3339(),
            })
        })
        .collect::<Vec<_>>();

    let count = items.len();

    Ok(Json(json!({
        "items": items,
        "count": count,
    })))
}

struct ValidatedPatientRiskScore {
    computed_at: chrono::DateTime<chrono::Utc>,
    score_type: String,
    score_value: f64,
    scale_max: Option<f64>,
    interpretation: Option<String>,
    source: Option<String>,
    inputs: Option<Value>,
}

#[allow(clippy::result_large_err)]
fn validate_patient_risk_score_request(
    body: CreatePatientRiskScoreRequest,
) -> Result<ValidatedPatientRiskScore, axum::response::Response> {
    let computed_at = parse_vital_measurement_timestamp(&body.computed_at)?;
    let score_type = validate_patient_risk_score_type(&body.score_type)?;
    let score_value = validate_nonnegative_float("score_value", body.score_value)?;
    let scale_max = validate_optional_positive_float("scale_max", body.scale_max)?;
    if let Some(max) = scale_max
        && score_value > max
    {
        return Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "score_value cannot exceed scale_max",
        ));
    }

    Ok(ValidatedPatientRiskScore {
        computed_at,
        score_type,
        score_value,
        scale_max,
        interpretation: normalize_optional_text(body.interpretation, "interpretation", 500)?,
        source: normalize_optional_text(body.source, "source", 120)?,
        inputs: normalize_optional_json_object(body.inputs, "inputs")?,
    })
}

async fn create_patient_risk_score(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(patient_uuid): Path<Uuid>,
    Json(body): Json<CreatePatientRiskScoreRequest>,
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
                "Failed to create patient risk score",
            );
        }
    }

    let ValidatedPatientRiskScore {
        computed_at,
        score_type,
        score_value,
        scale_max,
        interpretation,
        source,
        inputs,
    } = match validate_patient_risk_score_request(body) {
        Ok(value) => value,
        Err(response) => return response,
    };

    let row = match sqlx::query(
        r#"INSERT INTO patient_risk_scores (
                patient_id, computed_at, score_type, score_value, scale_max,
                interpretation, source, inputs, recorded_by
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           RETURNING id, created_at"#,
    )
    .bind(patient_uuid)
    .bind(computed_at)
    .bind(score_type.as_str())
    .bind(score_value)
    .bind(scale_max)
    .bind(interpretation.clone())
    .bind(source.clone())
    .bind(inputs.as_ref().map(|value| SqlxJson(value.clone())))
    .bind(auth.user_id)
    .fetch_one(&state.db)
    .await
    {
        Ok(row) => row,
        Err(e) => {
            tracing::error!(error = %e, patient_id = %patient_uuid, "Failed to create patient risk score");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to create patient risk score",
            );
        }
    };

    state.audit_sender.try_send(audit::domain_event(
        "record_patient_risk_score",
        Some(auth.user_id),
        "patient",
        Some(patient_uuid),
        json!({
            "risk_score_id": row.get::<Uuid, _>("id"),
            "computed_at": computed_at.to_rfc3339(),
            "score_type": score_type,
            "score_value": score_value,
            "scale_max": scale_max,
            "source": source,
            "has_inputs": inputs.is_some(),
        }),
    ));

    Json(json!({
        "id": row.get::<Uuid, _>("id"),
        "created_at": row.get::<chrono::DateTime<chrono::Utc>, _>("created_at").to_rfc3339(),
        "ok": true,
    }))
    .into_response()
}

async fn update_patient_risk_score(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path((patient_uuid, risk_score_uuid)): Path<(Uuid, Uuid)>,
    Json(body): Json<CreatePatientRiskScoreRequest>,
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
                "Failed to update patient risk score",
            );
        }
    }

    let ValidatedPatientRiskScore {
        computed_at,
        score_type,
        score_value,
        scale_max,
        interpretation,
        source,
        inputs,
    } = match validate_patient_risk_score_request(body) {
        Ok(value) => value,
        Err(response) => return response,
    };

    let updated = match sqlx::query(
        r#"UPDATE patient_risk_scores
           SET computed_at = $1,
               score_type = $2,
               score_value = $3,
               scale_max = $4,
               interpretation = $5,
               source = $6,
               inputs = $7
           WHERE id = $8 AND patient_id = $9"#,
    )
    .bind(computed_at)
    .bind(score_type.as_str())
    .bind(score_value)
    .bind(scale_max)
    .bind(interpretation.clone())
    .bind(source.clone())
    .bind(inputs.as_ref().map(|value| SqlxJson(value.clone())))
    .bind(risk_score_uuid)
    .bind(patient_uuid)
    .execute(&state.db)
    .await
    {
        Ok(result) => result,
        Err(e) => {
            tracing::error!(error = %e, patient_id = %patient_uuid, risk_score_id = %risk_score_uuid, "Failed to update patient risk score");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to update patient risk score",
            );
        }
    };

    if updated.rows_affected() == 0 {
        return err(StatusCode::NOT_FOUND, "Risk score not found");
    }

    state.audit_sender.try_send(audit::domain_event(
        "update_patient_risk_score",
        Some(auth.user_id),
        "patient",
        Some(patient_uuid),
        json!({
            "risk_score_id": risk_score_uuid,
            "computed_at": computed_at.to_rfc3339(),
            "score_type": score_type,
            "score_value": score_value,
            "scale_max": scale_max,
            "source": source,
            "has_inputs": inputs.is_some(),
        }),
    ));
    crate::realtime::publish_patient_event(
        &state,
        Some(auth.user_id),
        "patient.clinical_updated",
        patient_uuid,
        json!({
            "section": "risk_scores",
            "action": "update",
            "risk_score_id": risk_score_uuid,
        }),
    )
    .await;

    Json(json!({
        "id": risk_score_uuid,
        "ok": true,
    }))
    .into_response()
}

async fn delete_patient_risk_score(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path((patient_uuid, risk_score_uuid)): Path<(Uuid, Uuid)>,
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
                "Failed to delete patient risk score",
            );
        }
    }

    let deleted = match sqlx::query(
        r#"DELETE FROM patient_risk_scores
           WHERE id = $1 AND patient_id = $2
           RETURNING computed_at, score_type, score_value"#,
    )
    .bind(risk_score_uuid)
    .bind(patient_uuid)
    .fetch_optional(&state.db)
    .await
    {
        Ok(row) => row,
        Err(e) => {
            tracing::error!(error = %e, patient_id = %patient_uuid, risk_score_id = %risk_score_uuid, "Failed to delete patient risk score");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to delete patient risk score",
            );
        }
    };

    let Some(deleted) = deleted else {
        return err(StatusCode::NOT_FOUND, "Risk score not found");
    };

    state.audit_sender.try_send(audit::domain_event(
        "delete_patient_risk_score",
        Some(auth.user_id),
        "patient",
        Some(patient_uuid),
        json!({
            "risk_score_id": risk_score_uuid,
            "computed_at": deleted
                .get::<chrono::DateTime<chrono::Utc>, _>("computed_at")
                .to_rfc3339(),
            "score_type": deleted.get::<String, _>("score_type"),
            "score_value": deleted.get::<f64, _>("score_value"),
        }),
    ));
    crate::realtime::publish_patient_event(
        &state,
        Some(auth.user_id),
        "patient.clinical_updated",
        patient_uuid,
        json!({
            "section": "risk_scores",
            "action": "delete",
            "risk_score_id": risk_score_uuid,
        }),
    )
    .await;

    Json(json!({
        "id": risk_score_uuid,
        "ok": true,
    }))
    .into_response()
}

#[allow(clippy::result_large_err)]
fn parse_vital_measurement_timestamp(
    value: &str,
) -> Result<chrono::DateTime<chrono::Utc>, axum::response::Response> {
    parse_clinical_timestamp(value, "measured_at")
}

#[allow(clippy::result_large_err)]
fn parse_clinical_timestamp(
    value: &str,
    field_name: &str,
) -> Result<chrono::DateTime<chrono::Utc>, axum::response::Response> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            &format!("{field_name} required"),
        ));
    }

    chrono::DateTime::parse_from_rfc3339(trimmed)
        .map(|value| value.with_timezone(&chrono::Utc))
        .or_else(|_| {
            chrono::NaiveDateTime::parse_from_str(trimmed, "%Y-%m-%dT%H:%M")
                .map(|value| value.and_utc())
        })
        .or_else(|_| {
            chrono::NaiveDateTime::parse_from_str(trimmed, "%Y-%m-%dT%H:%M:%S")
                .map(|value| value.and_utc())
        })
        .or_else(|_| {
            chrono::NaiveDateTime::parse_from_str(trimmed, "%Y-%m-%dT%H:%M:%S%.f")
                .map(|value| value.and_utc())
        })
        .or_else(|_| {
            chrono::NaiveDate::parse_from_str(trimmed, "%Y-%m-%d")
                .map(|value| {
                    value
                        .and_hms_opt(0, 0, 0)
                        .expect("midnight is a valid time")
                })
                .map(|value| value.and_utc())
        })
        .map_err(|_| {
            err(
                StatusCode::UNPROCESSABLE_ENTITY,
                &format!("Invalid {field_name} format"),
            )
        })
}

#[allow(clippy::result_large_err)]
fn validate_optional_positive_float(
    field_name: &str,
    value: Option<f64>,
) -> Result<Option<f64>, axum::response::Response> {
    match value {
        Some(value) if !value.is_finite() || value <= 0.0 => Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            &format!("{field_name} must be a positive number"),
        )),
        other => Ok(other),
    }
}

#[allow(clippy::result_large_err)]
fn validate_optional_float_range(
    field_name: &str,
    value: Option<f64>,
    minimum: f64,
    maximum: f64,
) -> Result<Option<f64>, axum::response::Response> {
    match value {
        Some(value) if !value.is_finite() || value < minimum || value > maximum => Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            &format!("{field_name} must be between {minimum} and {maximum}"),
        )),
        other => Ok(other),
    }
}

#[allow(clippy::result_large_err)]
fn validate_optional_int_range(
    field_name: &str,
    value: Option<i32>,
    minimum: i32,
    maximum: i32,
) -> Result<Option<i32>, axum::response::Response> {
    match value {
        Some(value) if value < minimum || value > maximum => Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            &format!("{field_name} must be between {minimum} and {maximum}"),
        )),
        other => Ok(other),
    }
}

#[allow(clippy::result_large_err)]
fn validate_nonnegative_float(
    field_name: &str,
    value: f64,
) -> Result<f64, axum::response::Response> {
    if !value.is_finite() || value < 0.0 {
        return Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            &format!("{field_name} must be a non-negative number"),
        ));
    }
    Ok(value)
}

#[allow(clippy::result_large_err)]
fn normalize_optional_text(
    value: Option<String>,
    field_name: &str,
    max_len: usize,
) -> Result<Option<String>, axum::response::Response> {
    match value {
        Some(value) => {
            let trimmed = value.trim();
            if trimmed.len() > max_len {
                return Err(err(
                    StatusCode::UNPROCESSABLE_ENTITY,
                    &format!("{field_name} too long"),
                ));
            }
            Ok((!trimmed.is_empty()).then(|| trimmed.to_string()))
        }
        None => Ok(None),
    }
}

#[allow(clippy::result_large_err)]
fn normalize_patient_text_patch(
    value: Option<Value>,
    current: Option<String>,
    field_name: &str,
) -> Result<Option<String>, axum::response::Response> {
    match value {
        None => Ok(current),
        Some(Value::Null) => Ok(None),
        Some(Value::String(value)) => {
            let trimmed = value.trim();
            Ok((!trimmed.is_empty()).then(|| trimmed.to_string()))
        }
        Some(_) => Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            &format!("{field_name} must be a string or null"),
        )),
    }
}

#[allow(clippy::result_large_err)]
fn normalize_patient_insurance_type_patch(
    value: Option<Value>,
    current: Option<String>,
) -> Result<Option<String>, axum::response::Response> {
    let normalized = normalize_patient_text_patch(value, current, "insurance_type")?;
    if let Some(ref insurance_type) = normalized {
        match insurance_type.as_str() {
            "private" | "public" | "self_pay" | "foreign" => {}
            _ => {
                return Err(err(
                    StatusCode::UNPROCESSABLE_ENTITY,
                    "Invalid insurance type",
                ));
            }
        }
    }
    Ok(normalized)
}

#[allow(clippy::result_large_err)]
fn normalize_optional_json_object(
    value: Option<Value>,
    field_name: &str,
) -> Result<Option<Value>, axum::response::Response> {
    match value {
        Some(Value::Object(map)) => Ok(Some(Value::Object(map))),
        Some(Value::Null) => Ok(None),
        Some(_) => Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            &format!("{field_name} must be a JSON object"),
        )),
        None => Ok(None),
    }
}

#[allow(clippy::result_large_err)]
fn normalize_required_text(
    value: &str,
    field_name: &str,
    max_len: usize,
) -> Result<String, axum::response::Response> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            &format!("{field_name} required"),
        ));
    }
    if trimmed.len() > max_len {
        return Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            &format!("{field_name} too long"),
        ));
    }
    Ok(trimmed.to_string())
}

#[allow(clippy::result_large_err)]
fn parse_optional_naive_date(
    value: Option<String>,
    field_name: &str,
) -> Result<Option<chrono::NaiveDate>, axum::response::Response> {
    match value {
        Some(value) => {
            let trimmed = value.trim();
            if trimmed.is_empty() {
                return Ok(None);
            }
            chrono::NaiveDate::parse_from_str(trimmed, "%Y-%m-%d")
                .map(Some)
                .map_err(|_| {
                    err(
                        StatusCode::UNPROCESSABLE_ENTITY,
                        &format!("Invalid {field_name} format"),
                    )
                })
        }
        None => Ok(None),
    }
}

#[allow(clippy::result_large_err)]
fn parse_optional_patch_naive_date(
    value: Option<String>,
    field_name: &str,
) -> Result<Option<Option<chrono::NaiveDate>>, axum::response::Response> {
    match value {
        Some(value) => {
            let trimmed = value.trim();
            if trimmed.is_empty() {
                return Ok(Some(None));
            }
            chrono::NaiveDate::parse_from_str(trimmed, "%Y-%m-%d")
                .map(|parsed| Some(Some(parsed)))
                .map_err(|_| {
                    err(
                        StatusCode::UNPROCESSABLE_ENTITY,
                        &format!("Invalid {field_name} format"),
                    )
                })
        }
        None => Ok(None),
    }
}

#[allow(clippy::result_large_err)]
fn validate_patient_medical_order_type(value: &str) -> Result<String, axum::response::Response> {
    let normalized = value.trim().to_lowercase();
    if !PATIENT_MEDICAL_ORDER_TYPES.contains(&normalized.as_str()) {
        return Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Invalid patient medical order type",
        ));
    }
    Ok(normalized)
}

#[allow(clippy::result_large_err)]
fn validate_patient_medical_order_status(value: &str) -> Result<String, axum::response::Response> {
    let normalized = value.trim().to_lowercase();
    if !PATIENT_MEDICAL_ORDER_STATUSES.contains(&normalized.as_str()) {
        return Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Invalid patient medical order status",
        ));
    }
    Ok(normalized)
}

#[allow(clippy::result_large_err)]
fn validate_patient_risk_score_type(value: &str) -> Result<String, axum::response::Response> {
    let normalized = value.trim().to_lowercase();
    if !PATIENT_RISK_SCORE_TYPES.contains(&normalized.as_str()) {
        return Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Invalid patient risk score type",
        ));
    }
    Ok(normalized)
}

#[allow(clippy::result_large_err)]
fn normalize_legal_status(value: Value) -> Result<Value, axum::response::Response> {
    let Value::Object(map) = value else {
        return Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "legal_status must be an object",
        ));
    };

    let dsgvo_signed = extract_bool_field(&map, "dsgvo_signed")?;
    let confidentiality_release_signed =
        extract_bool_field(&map, "confidentiality_release_signed")?;
    let identity_verified = extract_bool_field(&map, "identity_verified")?;
    let document_pack_complete = extract_bool_field(&map, "document_pack_complete")?;
    let compliance_completed = extract_bool_field(&map, "compliance_completed")?;
    let contract_status = extract_optional_string_field(&map, "contract_status", 100)?;
    let notes = extract_optional_string_field(&map, "notes", 2000)?;

    if let Some(ref status) = contract_status {
        match status.as_str() {
            "not_started" | "pending" | "sent" | "signed" | "expired" | "terminated" => {}
            _ => {
                return Err(err(
                    StatusCode::UNPROCESSABLE_ENTITY,
                    "Invalid contract_status",
                ));
            }
        }
    }

    Ok(json!({
        "dsgvo_signed": dsgvo_signed,
        "confidentiality_release_signed": confidentiality_release_signed,
        "identity_verified": identity_verified,
        "document_pack_complete": document_pack_complete,
        "compliance_completed": compliance_completed,
        "contract_status": contract_status,
        "notes": notes,
    }))
}

#[allow(clippy::result_large_err)]
fn extract_bool_field(
    map: &serde_json::Map<String, Value>,
    key: &str,
) -> Result<bool, axum::response::Response> {
    match map.get(key) {
        Some(Value::Bool(value)) => Ok(*value),
        Some(_) => Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            &format!("{key} must be a boolean"),
        )),
        None => Ok(false),
    }
}

#[allow(clippy::result_large_err)]
fn extract_optional_string_field(
    map: &serde_json::Map<String, Value>,
    key: &str,
    max_len: usize,
) -> Result<Option<String>, axum::response::Response> {
    match map.get(key) {
        Some(Value::String(value)) => {
            let trimmed = value.trim();
            if trimmed.len() > max_len {
                return Err(err(
                    StatusCode::UNPROCESSABLE_ENTITY,
                    &format!("{key} too long"),
                ));
            }
            if trimmed.is_empty() {
                Ok(None)
            } else {
                Ok(Some(trimmed.to_string()))
            }
        }
        Some(Value::Null) | None => Ok(None),
        Some(_) => Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            &format!("{key} must be a string"),
        )),
    }
}

async fn activate_patient_portal_account(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(patient_uuid): Path<Uuid>,
    Json(body): Json<ActivatePatientPortalAccountRequest>,
) -> Result<(StatusCode, Json<Value>), axum::response::Response> {
    auth.require_any_role(&[Role::Ceo, Role::PatientManager, Role::ItAdmin])?;

    if !has_patient_access(&state, &auth, patient_uuid).await? && auth.role != Role::Ceo {
        return Err(err(StatusCode::FORBIDDEN, "Insufficient permissions"));
    }

    let email = body.email.trim().to_lowercase();
    if email.is_empty() || email.len() > 320 || !email.contains('@') {
        return Err(err(StatusCode::UNPROCESSABLE_ENTITY, "Invalid email"));
    }
    if let Err(message) = crate::routes::users::validate_password_policy(&body.password) {
        return Err(err(StatusCode::UNPROCESSABLE_ENTITY, message));
    }

    let patient = sqlx::query(
        r#"SELECT first_name, last_name, is_active
           FROM patients
           WHERE id = $1"#,
    )
    .bind(patient_uuid)
    .fetch_optional(&state.db)
    .await
    .map_err(|error| {
        tracing::error!(%error, patient_id = %patient_uuid, "load patient for portal activation");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to activate patient account",
        )
    })?
    .ok_or_else(|| err(StatusCode::NOT_FOUND, "Patient not found"))?;

    if !patient.try_get::<bool, _>("is_active").unwrap_or(false) {
        return Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Patient must be active before portal activation",
        ));
    }

    let has_package = sqlx::query_scalar::<_, bool>(
        r#"SELECT EXISTS(
               SELECT 1
               FROM patient_service_packages
               WHERE patient_id = $1
                 AND status IN ('draft', 'active', 'paused')
           )"#,
    )
    .bind(patient_uuid)
    .fetch_one(&state.db)
    .await
    .map_err(|error| {
        tracing::error!(%error, patient_id = %patient_uuid, "check patient membership before portal activation");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to activate patient account",
        )
    })?;

    if !has_package {
        return Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Assign a service package before activating the patient account",
        ));
    }

    let first_name = patient
        .try_get::<String, _>("first_name")
        .unwrap_or_default();
    let last_name = patient
        .try_get::<String, _>("last_name")
        .unwrap_or_default();
    let patient_name = format!("{first_name} {last_name}").trim().to_string();
    let password_hash = password::hash_password(&body.password).map_err(|error| {
        tracing::error!(%error, patient_id = %patient_uuid, "hash patient portal password");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to activate patient account",
        )
    })?;

    let mut tx = state.db.begin().await.map_err(|error| {
        tracing::error!(%error, patient_id = %patient_uuid, "begin patient portal activation");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to activate patient account",
        )
    })?;

    let linked_accounts = sqlx::query(
        r#"SELECT u.id
           FROM patient_assignments assignment
           JOIN users u ON u.id = assignment.user_id
           WHERE assignment.patient_id = $1
             AND assignment.revoked_at IS NULL
             AND u.role = 'patient'
           ORDER BY assignment.assigned_at DESC
           LIMIT 2"#,
    )
    .bind(patient_uuid)
    .fetch_all(&mut *tx)
    .await
    .map_err(|error| {
        tracing::error!(%error, patient_id = %patient_uuid, "inspect linked patient portal account");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to activate patient account",
        )
    })?;

    if linked_accounts.len() > 1 {
        return Err(err(
            StatusCode::CONFLICT,
            "Patient is linked to multiple portal accounts",
        ));
    }

    let mut created = false;
    let user_id = if let Some(linked) = linked_accounts.first() {
        let linked_user_id = linked.try_get::<Uuid, _>("id").map_err(|error| {
            tracing::error!(%error, patient_id = %patient_uuid, "decode linked portal account");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to activate patient account",
            )
        })?;
        let conflicting_owner = sqlx::query_scalar::<_, Uuid>(
            "SELECT id FROM users WHERE lower(trim(email)) = $1 AND id <> $2 LIMIT 1",
        )
        .bind(&email)
        .bind(linked_user_id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|error| {
            tracing::error!(%error, patient_id = %patient_uuid, "check portal email ownership");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to activate patient account",
            )
        })?;
        if conflicting_owner.is_some() {
            return Err(err(StatusCode::CONFLICT, "Email already exists"));
        }
        linked_user_id
    } else if let Some(existing) = sqlx::query(
        "SELECT id, role FROM users WHERE lower(trim(email)) = $1 LIMIT 1",
    )
    .bind(&email)
    .fetch_optional(&mut *tx)
    .await
    .map_err(|error| {
        tracing::error!(%error, patient_id = %patient_uuid, "inspect portal account by email");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to activate patient account",
        )
    })? {
        let existing_user_id = existing.try_get::<Uuid, _>("id").map_err(|error| {
            tracing::error!(%error, patient_id = %patient_uuid, "decode portal account by email");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to activate patient account",
            )
        })?;
        if existing.try_get::<String, _>("role").unwrap_or_default() != "patient" {
            return Err(err(
                StatusCode::CONFLICT,
                "Email belongs to a non-patient account",
            ));
        }
        let linked_elsewhere = sqlx::query_scalar::<_, bool>(
            r#"SELECT EXISTS(
                   SELECT 1
                   FROM patient_assignments
                   WHERE user_id = $1
                     AND revoked_at IS NULL
                     AND patient_id <> $2
               )"#,
        )
        .bind(existing_user_id)
        .bind(patient_uuid)
        .fetch_one(&mut *tx)
        .await
        .map_err(|error| {
            tracing::error!(%error, patient_id = %patient_uuid, user_id = %existing_user_id, "check portal account patient link");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to activate patient account",
            )
        })?;
        if linked_elsewhere {
            return Err(err(
                StatusCode::CONFLICT,
                "Patient account is linked to another patient record",
            ));
        }
        existing_user_id
    } else {
        created = true;
        sqlx::query_scalar::<_, Uuid>(
            r#"INSERT INTO users (email, password_hash, name, role, is_active)
               VALUES ($1, $2, $3, 'patient', true)
               RETURNING id"#,
        )
        .bind(&email)
        .bind(&password_hash)
        .bind(&patient_name)
        .fetch_one(&mut *tx)
        .await
        .map_err(|error| {
            tracing::error!(%error, patient_id = %patient_uuid, "create patient portal account");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to activate patient account",
            )
        })?
    };

    if !created {
        sqlx::query(
            r#"UPDATE users
               SET email = $2,
                   name = $3,
                   password_history = COALESCE(password_history, '[]'::jsonb)
                                      || jsonb_build_array(password_hash),
                   password_hash = $4,
                   password_changed_at = now(),
                   failed_login_attempts = 0,
                   locked_until = NULL,
                   is_active = true,
                   updated_at = now()
               WHERE id = $1"#,
        )
        .bind(user_id)
        .bind(&email)
        .bind(&patient_name)
        .bind(&password_hash)
        .execute(&mut *tx)
        .await
        .map_err(|error| {
            tracing::error!(%error, patient_id = %patient_uuid, user_id = %user_id, "reactivate patient portal account");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to activate patient account",
            )
        })?;
    }

    sqlx::query(
        r#"INSERT INTO patient_assignments (patient_id, user_id, assigned_by)
           VALUES ($1, $2, $3)
           ON CONFLICT (patient_id, user_id)
           DO UPDATE SET revoked_at = NULL, assigned_by = $3, assigned_at = now()"#,
    )
    .bind(patient_uuid)
    .bind(user_id)
    .bind(auth.user_id)
    .execute(&mut *tx)
    .await
    .map_err(|error| {
        tracing::error!(%error, patient_id = %patient_uuid, user_id = %user_id, "link patient portal account");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to activate patient account",
        )
    })?;

    sqlx::query("UPDATE patients SET email = $2, updated_at = now() WHERE id = $1")
        .bind(patient_uuid)
        .bind(&email)
        .execute(&mut *tx)
        .await
        .map_err(|error| {
            tracing::error!(%error, patient_id = %patient_uuid, "sync patient portal email");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to activate patient account",
            )
        })?;

    tx.commit().await.map_err(|error| {
        tracing::error!(%error, patient_id = %patient_uuid, user_id = %user_id, "commit patient portal activation");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to activate patient account",
        )
    })?;

    if !created {
        crate::auth::tokens::revoke_all_families(&state.db, user_id, "patient_account_activated")
            .await;
    }

    state.audit_sender.try_send(audit::domain_event(
        "activate_patient_portal_account",
        Some(auth.user_id),
        "patient",
        Some(patient_uuid),
        json!({
            "portal_user_id": user_id,
            "email": email,
            "created": created,
        }),
    ));
    crate::realtime::publish_patient_event(
        &state,
        Some(auth.user_id),
        "patient.portal_account_activated",
        patient_uuid,
        json!({ "portal_user_id": user_id, "created": created }),
    )
    .await;

    Ok((
        if created {
            StatusCode::CREATED
        } else {
            StatusCode::OK
        },
        Json(json!({
            "user_id": user_id,
            "email": email,
            "name": patient_name,
            "role": "patient",
            "is_active": true,
            "created": created,
        })),
    ))
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
        Role::ItAdmin,
    ])?;

    if !has_patient_access(&state, &auth, patient_uuid).await? && auth.role != Role::Ceo {
        return Err(err(StatusCode::FORBIDDEN, "Insufficient permissions"));
    }

    let rows = sqlx::query(
        r#"SELECT pa.user_id, pa.assigned_at, pa.revoked_at,
                  u.name AS user_name, u.email AS user_email, u.role AS user_role, u.is_active,
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
            "user_email": row.try_get::<String, _>("user_email").unwrap_or_default(),
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

async fn list_patient_cases(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(patient_uuid): Path<Uuid>,
) -> Result<Json<Vec<Value>>, axum::response::Response> {
    auth.require_any_role(&[
        Role::Ceo,
        Role::PatientManager,
        Role::Billing,
        Role::TeamleadInterpreter,
        Role::Interpreter,
        Role::Concierge,
    ])?;
    ensure_patient_visible(&state, &auth, patient_uuid).await?;

    let rows = sqlx::query(
        r#"SELECT c.id, c.case_id, c.status, c.hauptanfragegrund, c.created_at,
                  c.updated_at, c.zuweiser, m.name AS manager_name
           FROM cases c
           LEFT JOIN users m ON m.id = c.manager_id
           WHERE c.patient_id = $1
           ORDER BY c.created_at DESC"#,
    )
    .bind(patient_uuid)
    .fetch_all(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, patient_id = %patient_uuid, "Failed to list patient cases");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to list patient cases",
        )
    })?;

    let items = rows
        .into_iter()
        .map(|row| {
            serde_json::json!({
                "id": row.try_get::<Uuid, _>("id").unwrap_or_else(|_| Uuid::nil()),
                "case_id": row.try_get::<String, _>("case_id").unwrap_or_default(),
                "status": row.try_get::<String, _>("status").unwrap_or_default(),
                "hauptanfragegrund": row.try_get::<Option<String>, _>("hauptanfragegrund").unwrap_or_default(),
                "created_at": row.try_get::<chrono::DateTime<chrono::Utc>, _>("created_at").map(|value| value.to_rfc3339()).unwrap_or_default(),
                "updated_at": row.try_get::<chrono::DateTime<chrono::Utc>, _>("updated_at").map(|value| value.to_rfc3339()).ok(),
                "zuweiser": row.try_get::<Option<String>, _>("zuweiser").unwrap_or_default(),
                "manager_name": row.try_get::<Option<String>, _>("manager_name").unwrap_or_default(),
            })
        })
        .collect::<Vec<_>>();

    Ok(Json(items))
}

async fn list_patient_orders(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(patient_uuid): Path<Uuid>,
) -> Result<Json<Vec<Value>>, axum::response::Response> {
    auth.require_any_role(&[
        Role::Ceo,
        Role::PatientManager,
        Role::Billing,
        Role::TeamleadInterpreter,
        Role::Interpreter,
        Role::Concierge,
    ])?;
    ensure_patient_visible(&state, &auth, patient_uuid).await?;

    let rows = sqlx::query(
        r#"SELECT id, order_number, phase, status, needs_description, created_at,
                  total_estimated, total_actual, currency, date_from, date_to,
                  signed_patient, signed_agency, signed_at
           FROM orders
           WHERE patient_id = $1
           ORDER BY created_at DESC"#,
    )
    .bind(patient_uuid)
    .fetch_all(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, patient_id = %patient_uuid, "Failed to list patient orders");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to list patient orders",
        )
    })?;

    let items = rows
        .into_iter()
        .map(|row| {
            serde_json::json!({
                "id": row.try_get::<Uuid, _>("id").unwrap_or_else(|_| Uuid::nil()),
                "order_number": row.try_get::<String, _>("order_number").unwrap_or_default(),
                "phase": row.try_get::<String, _>("phase").unwrap_or_default(),
                "status": row.try_get::<String, _>("status").unwrap_or_default(),
                "needs_description": row.try_get::<Option<String>, _>("needs_description").unwrap_or_default(),
                "created_at": row.try_get::<chrono::DateTime<chrono::Utc>, _>("created_at").map(|value| value.to_rfc3339()).unwrap_or_default(),
                "total_estimated": row.try_get::<Option<rust_decimal::Decimal>, _>("total_estimated").unwrap_or_default(),
                "total_actual": row.try_get::<Option<rust_decimal::Decimal>, _>("total_actual").unwrap_or_default(),
                "currency": row.try_get::<Option<String>, _>("currency").unwrap_or_default(),
                "date_from": row.try_get::<Option<chrono::NaiveDate>, _>("date_from").unwrap_or_default(),
                "date_to": row.try_get::<Option<chrono::NaiveDate>, _>("date_to").unwrap_or_default(),
                "signed_patient": row.try_get::<bool, _>("signed_patient").unwrap_or(false),
                "signed_agency": row.try_get::<bool, _>("signed_agency").unwrap_or(false),
                "signed_at": row.try_get::<Option<chrono::DateTime<chrono::Utc>>, _>("signed_at").unwrap_or_default().map(|value| value.to_rfc3339()),
            })
        })
        .collect::<Vec<_>>();

    Ok(Json(items))
}

async fn list_patient_appointments(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(patient_uuid): Path<Uuid>,
) -> Result<Json<Vec<Value>>, axum::response::Response> {
    auth.require_any_role(&[
        Role::Ceo,
        Role::PatientManager,
        Role::Billing,
        Role::TeamleadInterpreter,
        Role::Interpreter,
        Role::Concierge,
    ])?;
    ensure_patient_visible(&state, &auth, patient_uuid).await?;

    let rows = sqlx::query(
        r#"SELECT a.id, a.title, a.date, a.time_start, a.appointment_type, a.care_path_kind, a.status,
                  p.name AS provider_name, d.name AS doctor_name
           FROM appointments a
           LEFT JOIN providers p ON p.id = a.provider_id
           LEFT JOIN provider_doctors d ON d.id = a.doctor_id
           WHERE a.patient_id = $1
           ORDER BY a.date DESC, a.time_start DESC NULLS LAST, a.created_at DESC"#,
    )
    .bind(patient_uuid)
    .fetch_all(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, patient_id = %patient_uuid, "Failed to list patient appointments");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to list patient appointments",
        )
    })?;

    let items = rows
        .into_iter()
        .map(|row| {
            serde_json::json!({
                "id": row.try_get::<Uuid, _>("id").unwrap_or_else(|_| Uuid::nil()),
                "title": row.try_get::<String, _>("title").unwrap_or_default(),
                "date": row.try_get::<chrono::NaiveDate, _>("date").map(|value| value.to_string()).unwrap_or_default(),
                "time_start": row.try_get::<Option<chrono::NaiveTime>, _>("time_start").unwrap_or_default().map(|value| value.format("%H:%M").to_string()),
                "apt_type": row.try_get::<String, _>("appointment_type").unwrap_or_default(),
                "care_path_kind": row.try_get::<String, _>("care_path_kind").unwrap_or_else(|_| "regular".to_string()),
                "status": row.try_get::<String, _>("status").unwrap_or_default(),
                "provider_name": row.try_get::<Option<String>, _>("provider_name").unwrap_or_default(),
                "doctor_name": row.try_get::<Option<String>, _>("doctor_name").unwrap_or_default(),
            })
        })
        .collect::<Vec<_>>();

    Ok(Json(items))
}

async fn list_patient_documents(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(patient_uuid): Path<Uuid>,
) -> Result<Json<Vec<Value>>, axum::response::Response> {
    auth.require_any_role(&[
        Role::Ceo,
        Role::PatientManager,
        Role::Billing,
        Role::TeamleadInterpreter,
        Role::Interpreter,
        Role::Concierge,
    ])?;
    ensure_patient_visible(&state, &auth, patient_uuid).await?;

    let rows = sqlx::query(
        r#"SELECT d.id,
                  d.document_number,
                  d.generated_template_id,
                  d.order_id,
                  d.version_root_document_id,
                  d.replaces_document_id,
                  d.version_number,
                  d.file_size,
                  COALESCE(d.original_filename, d.auto_name, 'Document') AS filename,
                  COALESCE(d.category, d.art) AS category,
                  d.status,
                  d.document_direction,
                  d.document_variant,
                  d.document_language,
                  d.access_category,
                  d.document_date,
                  d.source_person,
                  d.source_institution,
                  d.addressee_person,
                  d.addressee_institution,
                  d.financial_status,
                  d.payment_due_date,
                  d.payment_date,
                  d.payment_method,
                  u.name AS uploaded_by_name,
                  d.created_at
           FROM documents d
           LEFT JOIN users u ON u.id = d.uploaded_by
           WHERE d.patient_id = $1
           ORDER BY d.created_at DESC"#,
    )
    .bind(patient_uuid)
    .fetch_all(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, patient_id = %patient_uuid, "Failed to list patient documents");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to list patient documents",
        )
    })?;

    let items = rows
        .into_iter()
        .map(|row| {
            serde_json::json!({
                "id": row.try_get::<Uuid, _>("id").unwrap_or_else(|_| Uuid::nil()),
                "document_number": row.try_get::<String, _>("document_number").unwrap_or_default(),
                "generated_template_id": row.try_get::<Option<String>, _>("generated_template_id").unwrap_or_default(),
                "order_id": row.try_get::<Option<Uuid>, _>("order_id").unwrap_or_default(),
                "version_root_document_id": row.try_get::<Uuid, _>("version_root_document_id").unwrap_or_else(|_| Uuid::nil()),
                "replaces_document_id": row.try_get::<Option<Uuid>, _>("replaces_document_id").unwrap_or_default(),
                "version_number": row.try_get::<i32, _>("version_number").unwrap_or(1),
                "file_size": row.try_get::<i64, _>("file_size").unwrap_or_default(),
                "filename": row.try_get::<String, _>("filename").unwrap_or_default(),
                "category": row.try_get::<Option<String>, _>("category").unwrap_or_default(),
                "status": row.try_get::<String, _>("status").unwrap_or_default(),
                "document_direction": row.try_get::<Option<String>, _>("document_direction").unwrap_or_default(),
                "document_variant": row.try_get::<Option<String>, _>("document_variant").unwrap_or_default(),
                "document_language": row.try_get::<Option<String>, _>("document_language").unwrap_or_default(),
                "access_category": row.try_get::<Option<String>, _>("access_category").unwrap_or_default(),
                "document_date": row.try_get::<Option<chrono::NaiveDate>, _>("document_date").unwrap_or_default(),
                "source_person": row.try_get::<Option<String>, _>("source_person").unwrap_or_default(),
                "source_institution": row.try_get::<Option<String>, _>("source_institution").unwrap_or_default(),
                "addressee_person": row.try_get::<Option<String>, _>("addressee_person").unwrap_or_default(),
                "addressee_institution": row.try_get::<Option<String>, _>("addressee_institution").unwrap_or_default(),
                "financial_status": row.try_get::<Option<String>, _>("financial_status").unwrap_or_default(),
                "payment_due_date": row.try_get::<Option<chrono::NaiveDate>, _>("payment_due_date").unwrap_or_default(),
                "payment_date": row.try_get::<Option<chrono::NaiveDate>, _>("payment_date").unwrap_or_default(),
                "payment_method": row.try_get::<Option<String>, _>("payment_method").unwrap_or_default(),
                "uploaded_by_name": row.try_get::<Option<String>, _>("uploaded_by_name").unwrap_or_default(),
                "created_at": row.try_get::<chrono::DateTime<chrono::Utc>, _>("created_at").map(|value| value.to_rfc3339()).unwrap_or_default(),
            })
        })
        .collect::<Vec<_>>();

    Ok(Json(items))
}

#[allow(clippy::result_large_err)]
fn parse_required_patient_document_rules(
    value: &Value,
) -> Result<Vec<RequiredPatientDocumentRule>, axum::response::Response> {
    let items = value.as_array().ok_or_else(|| {
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Required patient document settings are invalid",
        )
    })?;

    let mut rules = Vec::with_capacity(items.len());
    for item in items {
        let object = item.as_object().ok_or_else(|| {
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Required patient document settings are invalid",
            )
        })?;

        let key = object
            .get("key")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| {
                err(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Required patient document settings are invalid",
                )
            })?
            .to_string();
        let label = object
            .get("label")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| {
                err(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Required patient document settings are invalid",
                )
            })?
            .to_string();

        let collect_values = |field: &str| -> Result<Vec<String>, axum::response::Response> {
            object
                .get(field)
                .map(|value| {
                    value
                        .as_array()
                        .ok_or_else(|| {
                            err(
                                StatusCode::INTERNAL_SERVER_ERROR,
                                "Required patient document settings are invalid",
                            )
                        })?
                        .iter()
                        .map(|item| {
                            item.as_str()
                                .map(str::trim)
                                .filter(|value| !value.is_empty())
                                .map(ToOwned::to_owned)
                                .ok_or_else(|| {
                                    err(
                                        StatusCode::INTERNAL_SERVER_ERROR,
                                        "Required patient document settings are invalid",
                                    )
                                })
                        })
                        .collect::<Result<Vec<_>, _>>()
                })
                .transpose()
                .map(|value| value.unwrap_or_default())
        };

        rules.push(RequiredPatientDocumentRule {
            key,
            label,
            art: collect_values("art")?,
            category: collect_values("category")?,
        });
    }

    Ok(rules)
}

async fn load_required_patient_document_rules(
    state: &AppState,
) -> Result<Vec<RequiredPatientDocumentRule>, axum::response::Response> {
    let row = sqlx::query(
        r#"SELECT value
           FROM system_settings
           WHERE key = 'required_patient_documents'"#,
    )
    .fetch_optional(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, "Failed to load required patient documents setting");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to load required patient document settings",
        )
    })?;

    let Some(row) = row else {
        return Ok(Vec::new());
    };

    let value = row.try_get::<Value, _>("value").map_err(|_| {
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Required patient document settings are invalid",
        )
    })?;

    parse_required_patient_document_rules(&value)
}

pub(crate) async fn load_patient_document_alerts_summary(
    state: &AppState,
    patient_uuid: Uuid,
) -> Result<PatientDocumentAlertsSummary, axum::response::Response> {
    let rules = load_required_patient_document_rules(state).await?;

    let patient_row = sqlx::query(
        r#"SELECT legal_status
           FROM patients
           WHERE id = $1"#,
    )
    .bind(patient_uuid)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, patient_id = %patient_uuid, "Failed to load patient legal status for document alerts");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to load patient document alerts",
        )
    })?;

    let Some(patient_row) = patient_row else {
        return Err(err(StatusCode::NOT_FOUND, "Patient not found"));
    };

    let stored_document_pack_complete = patient_row
        .try_get::<Value, _>("legal_status")
        .ok()
        .and_then(|value| value.get("document_pack_complete").and_then(Value::as_bool))
        .unwrap_or(false);

    let document_rows = sqlx::query(
        r#"SELECT d.id,
                  COALESCE(d.original_filename, d.auto_name, 'Document') AS filename,
                  d.art,
                  d.category,
                  d.status
           FROM documents d
           WHERE d.patient_id = $1
             AND d.status IN ('draft', 'active')
           ORDER BY d.created_at DESC"#,
    )
    .bind(patient_uuid)
    .fetch_all(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, patient_id = %patient_uuid, "Failed to load patient documents for alerts");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to load patient document alerts",
        )
    })?;

    let mut evaluated_rules = Vec::with_capacity(rules.len());
    let mut missing_documents = Vec::new();
    for rule in &rules {
        let mut matching_documents = Vec::new();

        for row in &document_rows {
            let art = row
                .try_get::<String, _>("art")
                .unwrap_or_default()
                .trim()
                .to_lowercase()
                .replace([' ', '-'], "_");
            let category = row
                .try_get::<Option<String>, _>("category")
                .unwrap_or_default()
                .unwrap_or_default()
                .trim()
                .to_lowercase()
                .replace([' ', '-'], "_");

            let matches_art = !rule.art.is_empty() && rule.art.iter().any(|value| value == &art);
            let matches_category = !rule.category.is_empty()
                && !category.is_empty()
                && rule.category.iter().any(|value| value == &category);

            if matches_art || matches_category {
                matching_documents.push(json!({
                    "id": row.try_get::<Uuid, _>("id").unwrap_or_else(|_| Uuid::nil()),
                    "filename": row.try_get::<String, _>("filename").unwrap_or_default(),
                    "art": row.try_get::<String, _>("art").unwrap_or_default(),
                    "category": row.try_get::<Option<String>, _>("category").unwrap_or_default(),
                    "status": row.try_get::<String, _>("status").unwrap_or_default(),
                }));
            }
        }

        let fulfilled = !matching_documents.is_empty();
        if !fulfilled {
            missing_documents.push(json!({
                "key": rule.key,
                "label": rule.label,
            }));
        }

        evaluated_rules.push(json!({
            "key": rule.key,
            "label": rule.label,
            "fulfilled": fulfilled,
            "matching_documents": matching_documents,
        }));
    }

    let missing_count = missing_documents.len();
    let document_pack_complete = missing_count == 0;

    Ok(PatientDocumentAlertsSummary {
        configured_rule_count: rules.len(),
        document_pack_complete,
        stored_document_pack_complete,
        out_of_sync: stored_document_pack_complete != document_pack_complete,
        required_documents: evaluated_rules,
        missing_documents,
        missing_count,
    })
}

pub(crate) fn patient_document_alerts_payload(summary: &PatientDocumentAlertsSummary) -> Value {
    json!({
        "configured_rule_count": summary.configured_rule_count,
        "document_pack_complete": summary.document_pack_complete,
        "stored_document_pack_complete": summary.stored_document_pack_complete,
        "out_of_sync": summary.out_of_sync,
        "required_documents": summary.required_documents,
        "missing_documents": summary.missing_documents,
        "missing_count": summary.missing_count,
    })
}

/// Days before expiry at which a passport starts to count as a compliance
/// warning (#6). A product-tunable window; expiry itself is the hard boundary.
const PASSPORT_EXPIRY_WARNING_DAYS: i64 = 90;

/// Compliance status of a patient passport relative to `today` (#6):
/// `expired` (past expiry), `expiring` (within the warning window), `valid`, or
/// `unknown` (no date on file). Returns the status plus days until expiry
/// (negative once expired), or `None` when unknown.
fn passport_compliance_status(
    passport_expiry: Option<chrono::NaiveDate>,
    today: chrono::NaiveDate,
) -> (&'static str, Option<i64>) {
    match passport_expiry {
        None => ("unknown", None),
        Some(expiry) => {
            let days = (expiry - today).num_days();
            let status = if days < 0 {
                "expired"
            } else if days <= PASSPORT_EXPIRY_WARNING_DAYS {
                "expiring"
            } else {
                "valid"
            };
            (status, Some(days))
        }
    }
}

pub(crate) async fn load_patient_recheck_readiness(
    state: &AppState,
    patient_uuid: Uuid,
) -> Result<Option<PatientRecheckReadiness>, axum::response::Response> {
    let patient_row = sqlx::query(
        r#"SELECT id,
                  patient_id,
                  first_name,
                  last_name,
                  birth_date,
                  gender,
                  residence_country,
                  address_country,
                  languages,
                  phone_primary,
                  email,
                  passport_expiry,
                  legal_status
           FROM patients
           WHERE id = $1"#,
    )
    .bind(patient_uuid)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, patient_id = %patient_uuid, "Failed to load patient re-check context");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to load patient re-check",
        )
    })?;

    let Some(patient_row) = patient_row else {
        return Ok(None);
    };

    let patient_pid = patient_row
        .try_get::<String, _>("patient_id")
        .unwrap_or_default();
    let first_name = patient_row
        .try_get::<String, _>("first_name")
        .unwrap_or_default();
    let last_name = patient_row
        .try_get::<String, _>("last_name")
        .unwrap_or_default();
    let birth_date = patient_row
        .try_get::<chrono::NaiveDate, _>("birth_date")
        .ok()
        .map(|value| value.to_string());
    let gender = patient_row
        .try_get::<String, _>("gender")
        .unwrap_or_default();
    let residence_country = patient_row
        .try_get::<Option<String>, _>("residence_country")
        .unwrap_or_default();
    let address_country = patient_row
        .try_get::<Option<String>, _>("address_country")
        .unwrap_or_default();
    let passport_expiry = patient_row
        .try_get::<Option<chrono::NaiveDate>, _>("passport_expiry")
        .unwrap_or_default();
    let languages = patient_row
        .try_get::<Vec<String>, _>("languages")
        .unwrap_or_default();
    let phone_primary = patient_row
        .try_get::<Option<String>, _>("phone_primary")
        .unwrap_or_default();
    let email = patient_row
        .try_get::<Option<String>, _>("email")
        .unwrap_or_default();
    let legal_status = patient_row
        .try_get::<Value, _>("legal_status")
        .unwrap_or_else(|_| json!({}));
    let patient_name = format!("{first_name} {last_name}").trim().to_string();

    let existing_context = sqlx::query(
        r#"SELECT EXISTS(SELECT 1 FROM orders WHERE patient_id = $1) AS has_orders,
                  EXISTS(SELECT 1 FROM cases WHERE patient_id = $1) AS has_cases,
                  EXISTS(SELECT 1 FROM appointments WHERE patient_id = $1) AS has_appointments,
                  EXISTS(SELECT 1 FROM framework_contracts WHERE patient_id = $1) AS has_contracts,
                  EXISTS(SELECT 1 FROM invoices WHERE patient_id = $1) AS has_invoices"#,
    )
    .bind(patient_uuid)
    .fetch_one(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, patient_id = %patient_uuid, "Failed to load existing customer context for re-check");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to load patient re-check",
        )
    })?;
    let requires_recheck = existing_context
        .try_get::<bool, _>("has_orders")
        .unwrap_or(false)
        || existing_context
            .try_get::<bool, _>("has_cases")
            .unwrap_or(false)
        || existing_context
            .try_get::<bool, _>("has_appointments")
            .unwrap_or(false)
        || existing_context
            .try_get::<bool, _>("has_contracts")
            .unwrap_or(false)
        || existing_context
            .try_get::<bool, _>("has_invoices")
            .unwrap_or(false);

    if !requires_recheck {
        // Passport validity is independent of whether an existing-customer
        // re-check is due, so report it even on the minimal payload (#6).
        let (passport_status, passport_days_until_expiry) =
            passport_compliance_status(passport_expiry, chrono::Utc::now().date_naive());
        return Ok(Some(PatientRecheckReadiness {
            can_create_order: true,
            blocking_reasons: Vec::new(),
            payload: json!({
                "requires_recheck": false,
                "can_create_order": true,
                "base_data_ready": true,
                "compliance_ready": true,
                "identity_ready": true,
                "document_pack_ready": true,
                "contract_ready": true,
                "debt_hold": false,
                "passport_expired": passport_status == "expired",
                "passport_expiring": passport_status == "expiring",
                "passport_status": passport_status,
                "passport_expiry": passport_expiry.map(|value| value.to_string()),
                "passport_days_until_expiry": passport_days_until_expiry,
                "overdue_invoice_count": 0,
                "base_data_missing_fields": [],
                "blocking_reasons": [],
                "checks": [],
                "reason": "Existing-customer re-check is not required before the first operational order",
                "patient": {
                    "id": patient_uuid,
                    "patient_id": patient_pid,
                    "name": patient_name,
                    "birth_date": birth_date,
                    "gender": gender,
                    "phone_primary": phone_primary,
                    "email": email,
                    "residence_country": residence_country,
                    "address_country": address_country,
                    "languages": languages,
                },
                "legal_status": legal_status,
                "document_alerts": {
                    "configured_rule_count": 0,
                    "document_pack_complete": true,
                    "stored_document_pack_complete": true,
                    "out_of_sync": false,
                    "required_documents": [],
                    "missing_documents": [],
                    "missing_count": 0,
                },
                "latest_framework_contract": Value::Null,
            }),
        }));
    }

    let primary_contact_present = phone_primary
        .as_deref()
        .is_some_and(|value| !value.trim().is_empty())
        || email
            .as_deref()
            .is_some_and(|value| !value.trim().is_empty());
    let country_present = residence_country
        .as_deref()
        .is_some_and(|value| !value.trim().is_empty())
        || address_country
            .as_deref()
            .is_some_and(|value| !value.trim().is_empty());
    let language_present = !languages.is_empty();
    let base_data_ready = primary_contact_present && country_present && language_present;

    let dsgvo_signed = legal_status
        .get("dsgvo_signed")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let identity_verified = legal_status
        .get("identity_verified")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let compliance_completed = legal_status
        .get("compliance_completed")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let stored_contract_status = legal_status
        .get("contract_status")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let compliance_ready = compliance_completed && dsgvo_signed;

    let document_alerts = load_patient_document_alerts_summary(state, patient_uuid).await?;
    let document_pack_ready =
        document_alerts.document_pack_complete || document_alerts.stored_document_pack_complete;

    let contract_rows = sqlx::query(
        r#"SELECT id,
                  contract_number,
                  status,
                  signed_at,
                  valid_from,
                  valid_to,
                  created_at
           FROM framework_contracts
           WHERE patient_id = $1
           ORDER BY COALESCE(valid_to, 'infinity'::date) DESC,
                    COALESCE(signed_at, created_at) DESC"#,
    )
    .bind(patient_uuid)
    .fetch_all(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, patient_id = %patient_uuid, "Failed to load framework contracts for re-check");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to load patient re-check",
        )
    })?;

    let today = chrono::Utc::now().date_naive();
    // #6: surface passport expiry in compliance (a warning, never a hard gate on
    // order creation). No passport date on file is treated as "unknown".
    let (passport_status, passport_days_until_expiry) =
        passport_compliance_status(passport_expiry, today);
    let passport_expired = passport_status == "expired";
    let passport_expiring = passport_status == "expiring";
    let latest_framework_contract = contract_rows.first().map(|row| {
        json!({
            "id": row.try_get::<Uuid, _>("id").unwrap_or_else(|_| Uuid::nil()),
            "contract_number": row.try_get::<String, _>("contract_number").unwrap_or_default(),
            "status": row.try_get::<String, _>("status").unwrap_or_default(),
            "signed_at": row.try_get::<Option<chrono::DateTime<chrono::Utc>>, _>("signed_at").unwrap_or_default().map(|value| value.to_rfc3339()),
            "valid_from": row.try_get::<Option<chrono::NaiveDate>, _>("valid_from").unwrap_or_default().map(|value| value.to_string()),
            "valid_to": row.try_get::<Option<chrono::NaiveDate>, _>("valid_to").unwrap_or_default().map(|value| value.to_string()),
        })
    });
    let valid_framework_contract = contract_rows.iter().any(|row| {
        let status = row.try_get::<String, _>("status").unwrap_or_default();
        let valid_from = row
            .try_get::<Option<chrono::NaiveDate>, _>("valid_from")
            .unwrap_or_default();
        let valid_to = row
            .try_get::<Option<chrono::NaiveDate>, _>("valid_to")
            .unwrap_or_default();
        status == "signed"
            && valid_from.map(|value| value <= today).unwrap_or(true)
            && valid_to.map(|value| value >= today).unwrap_or(true)
    });

    let contract_ready = stored_contract_status == "signed" || valid_framework_contract;

    let debt_management =
        crate::routes::debt_management::load_patient_debt_management_state(state, patient_uuid)
            .await?;
    let overdue_invoice_count = debt_management.overdue_invoice_count;
    let debt_hold = debt_management.blocking;

    let mut base_data_missing_fields = Vec::new();
    if !primary_contact_present {
        base_data_missing_fields.push("primary_contact".to_string());
    }
    if !country_present {
        base_data_missing_fields.push("country".to_string());
    }
    if !language_present {
        base_data_missing_fields.push("language".to_string());
    }

    let checks = vec![
        json!({
            "key": "base_data",
            "label": "Base data valid",
            "passed": base_data_ready,
            "blocking_for": "create_order",
        }),
        json!({
            "key": "compliance",
            "label": "Compliance documents valid",
            "passed": compliance_ready,
            "blocking_for": "create_order",
        }),
        json!({
            "key": "identity",
            "label": "Identity verified",
            "passed": identity_verified,
            "blocking_for": "create_order",
        }),
        json!({
            "key": "document_pack",
            "label": "Required patient documents complete",
            "passed": document_pack_ready,
            "blocking_for": "create_order",
        }),
        json!({
            "key": "contract",
            "label": "Contract documents valid",
            "passed": contract_ready,
            "blocking_for": "create_order",
        }),
        json!({
            "key": "debt_clear",
            "label": "Debt-management hold cleared",
            "passed": !debt_hold,
            "blocking_for": "create_order",
        }),
        json!({
            "key": "passport_valid",
            "label": "Passport not expired",
            "passed": !passport_expired,
            "blocking_for": "none",
            "status": passport_status,
            "expiry": passport_expiry.map(|value| value.to_string()),
            "days_until_expiry": passport_days_until_expiry,
        }),
    ];

    let mut blocking_reasons = Vec::new();
    if !base_data_ready {
        if !primary_contact_present {
            blocking_reasons.push("Primary contact is missing".to_string());
        }
        if !country_present {
            blocking_reasons.push("Residence or address country is missing".to_string());
        }
        if !language_present {
            blocking_reasons.push("Preferred language is missing".to_string());
        }
    }
    if !compliance_ready {
        if !compliance_completed {
            blocking_reasons.push("Compliance status is not completed".to_string());
        }
        if !dsgvo_signed {
            blocking_reasons.push("DSGVO/compliance documents are not signed".to_string());
        }
    }
    if !identity_verified {
        blocking_reasons.push("Identity is not verified".to_string());
    }
    if !document_pack_ready {
        blocking_reasons.push(format!(
            "{} required patient document(s) are missing",
            document_alerts.missing_count
        ));
    }
    if !contract_ready {
        blocking_reasons.push("Valid contract documentation is missing".to_string());
    }
    if debt_hold {
        blocking_reasons.push(
            debt_management
                .blocking_reason
                .clone()
                .unwrap_or_else(|| "Patient is still in debt-management hold".to_string()),
        );
    }

    let can_create_order = blocking_reasons.is_empty();

    Ok(Some(PatientRecheckReadiness {
        can_create_order,
        blocking_reasons: blocking_reasons.clone(),
        payload: json!({
            "requires_recheck": true,
            "can_create_order": can_create_order,
            "base_data_ready": base_data_ready,
            "compliance_ready": compliance_ready,
            "identity_ready": identity_verified,
            "document_pack_ready": document_pack_ready,
            "contract_ready": contract_ready,
            "debt_hold": debt_hold,
            "passport_expired": passport_expired,
            "passport_expiring": passport_expiring,
            "passport_status": passport_status,
            "passport_expiry": passport_expiry.map(|value| value.to_string()),
            "passport_days_until_expiry": passport_days_until_expiry,
            "overdue_invoice_count": overdue_invoice_count,
            "debt_management": debt_management.payload,
            "outstanding_balance": debt_management.outstanding_balance.round_dp(2).normalize().to_string(),
            "base_data_missing_fields": base_data_missing_fields,
            "blocking_reasons": blocking_reasons,
            "checks": checks,
            "patient": {
                "id": patient_uuid,
                "patient_id": patient_pid,
                "name": patient_name,
                "birth_date": birth_date,
                "gender": gender,
                "phone_primary": phone_primary,
                "email": email,
                "residence_country": residence_country,
                "address_country": address_country,
                "languages": languages,
            },
            "legal_status": {
                "dsgvo_signed": dsgvo_signed,
                "identity_verified": identity_verified,
                "compliance_completed": compliance_completed,
                "contract_status": stored_contract_status,
            },
            "document_alerts": patient_document_alerts_payload(&document_alerts),
            "latest_framework_contract": latest_framework_contract,
        }),
    }))
}

async fn get_patient_document_alerts(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(patient_uuid): Path<Uuid>,
) -> Result<Json<Value>, axum::response::Response> {
    auth.require_any_role(&[
        Role::Ceo,
        Role::PatientManager,
        Role::Billing,
        Role::TeamleadInterpreter,
        Role::Interpreter,
        Role::Concierge,
    ])?;
    ensure_patient_visible(&state, &auth, patient_uuid).await?;
    let summary = load_patient_document_alerts_summary(&state, patient_uuid).await?;
    Ok(Json(patient_document_alerts_payload(&summary)))
}

async fn get_patient_recheck(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(patient_uuid): Path<Uuid>,
) -> Result<Json<Value>, axum::response::Response> {
    auth.require_any_role(&[Role::Ceo, Role::PatientManager, Role::Billing])?;
    ensure_patient_visible(&state, &auth, patient_uuid).await?;

    let Some(readiness) = load_patient_recheck_readiness(&state, patient_uuid).await? else {
        return Err(err(StatusCode::NOT_FOUND, "Patient not found"));
    };

    state.audit_sender.try_send(audit::domain_event(
        "view_patient_recheck",
        Some(auth.user_id),
        "patient",
        Some(patient_uuid),
        json!({
            "can_create_order": readiness.can_create_order,
            "blocking_reasons": readiness.blocking_reasons.clone(),
        }),
    ));

    Ok(Json(readiness.payload))
}

async fn list_patient_framework_contracts(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(patient_uuid): Path<Uuid>,
) -> Result<Json<Vec<Value>>, axum::response::Response> {
    auth.require_any_role(&[
        Role::Ceo,
        Role::CeoAssistant,
        Role::PatientManager,
        Role::Billing,
    ])?;
    ensure_patient_visible(&state, &auth, patient_uuid).await?;

    let rows = sqlx::query(
        r#"SELECT id, contract_number, status, signed_at, valid_from, valid_to, created_at
           FROM framework_contracts
           WHERE patient_id = $1
           ORDER BY COALESCE(signed_at, created_at) DESC, created_at DESC"#,
    )
    .bind(patient_uuid)
    .fetch_all(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, patient_id = %patient_uuid, "Failed to list patient framework contracts");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to list patient framework contracts",
        )
    })?;

    let items = rows
        .into_iter()
        .map(|row| {
            serde_json::json!({
                "id": row.try_get::<Uuid, _>("id").unwrap_or_else(|_| Uuid::nil()),
                "contract_number": row.try_get::<String, _>("contract_number").unwrap_or_default(),
                "status": row.try_get::<String, _>("status").unwrap_or_default(),
                "signed_at": row.try_get::<Option<chrono::DateTime<chrono::Utc>>, _>("signed_at").unwrap_or_default().map(|value| value.to_rfc3339()),
                "valid_from": row.try_get::<Option<chrono::NaiveDate>, _>("valid_from").unwrap_or_default().map(|value| value.to_string()),
                "valid_to": row.try_get::<Option<chrono::NaiveDate>, _>("valid_to").unwrap_or_default().map(|value| value.to_string()),
                "created_at": row.try_get::<chrono::DateTime<chrono::Utc>, _>("created_at").map(|value| value.to_rfc3339()).unwrap_or_default(),
            })
        })
        .collect::<Vec<_>>();

    Ok(Json(items))
}

async fn get_patient_label(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(patient_uuid): Path<Uuid>,
    Query(query): Query<PatientLabelQuery>,
) -> Result<Json<Value>, axum::response::Response> {
    auth.require_any_role(&[Role::Ceo, Role::PatientManager])?;
    ensure_patient_visible(&state, &auth, patient_uuid).await?;

    let format = resolve_patient_label_format(query.format.as_deref())?;
    let agency = load_patient_label_agency_settings(&state).await?;

    let patient = sqlx::query(
        r#"SELECT patient_id, title, first_name, last_name, birth_date, gender,
                  nationality, residence_country, insurance_provider
           FROM patients
           WHERE id = $1"#,
    )
    .bind(patient_uuid)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, patient_id = %patient_uuid, "Failed to load patient label");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to load patient label",
        )
    })?;

    let Some(patient) = patient else {
        return Err(err(StatusCode::NOT_FOUND, "Patient not found"));
    };

    let patient_id = patient.try_get::<String, _>("patient_id").map_err(|e| {
        tracing::error!(error = %e, patient_id = %patient_uuid, "Failed to parse patient label patient_id");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to load patient label",
        )
    })?;
    let title = patient
        .try_get::<Option<String>, _>("title")
        .unwrap_or_default();
    let first_name = patient.try_get::<String, _>("first_name").map_err(|e| {
        tracing::error!(error = %e, patient_id = %patient_uuid, "Failed to parse patient label first_name");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to load patient label",
        )
    })?;
    let last_name = patient.try_get::<String, _>("last_name").map_err(|e| {
        tracing::error!(error = %e, patient_id = %patient_uuid, "Failed to parse patient label last_name");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to load patient label",
        )
    })?;
    let birth_date = patient
        .try_get::<chrono::NaiveDate, _>("birth_date")
        .map(|value| value.to_string())
        .map_err(|e| {
            tracing::error!(error = %e, patient_id = %patient_uuid, "Failed to parse patient label birth_date");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to load patient label",
            )
        })?;
    let gender = patient.try_get::<String, _>("gender").map_err(|e| {
        tracing::error!(error = %e, patient_id = %patient_uuid, "Failed to parse patient label gender");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to load patient label",
        )
    })?;
    let nationality = patient
        .try_get::<Option<String>, _>("nationality")
        .unwrap_or_default();
    let residence_country = patient
        .try_get::<Option<String>, _>("residence_country")
        .unwrap_or_default();
    let insurance_provider = patient
        .try_get::<Option<String>, _>("insurance_provider")
        .unwrap_or_default();
    let country_code =
        patient_label_country_code(nationality.as_deref(), residence_country.as_deref());

    let payload = json!({
        "patient_id": patient_id,
        "title": title,
        "salutation": patient_label_salutation(&gender),
        "first_name": first_name,
        "last_name": last_name,
        "birth_date": birth_date,
        "country_code": country_code.clone(),
        "insurance_provider": insurance_provider,
        "agency": {
            "name": agency.name,
            "care_of": agency.care_of,
            "address": agency.address,
            "phone": agency.phone,
            "email": agency.email,
        },
        "format": patient_label_format_json(format),
        "available_formats": PATIENT_LABEL_FORMATS
            .iter()
            .copied()
            .map(patient_label_format_json)
            .collect::<Vec<_>>(),
        "generated_at": chrono::Utc::now().to_rfc3339(),
    });

    state.audit_sender.try_send(audit::domain_event(
        "generate_patient_label",
        Some(auth.user_id),
        "patient",
        Some(patient_uuid),
        json!({
            "format": format.id,
            "country_code": country_code,
        }),
    ));

    Ok(Json(payload))
}

async fn list_patient_invoices(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(patient_uuid): Path<Uuid>,
) -> Result<Json<Vec<Value>>, axum::response::Response> {
    auth.require_any_role(&[
        Role::Ceo,
        Role::CeoAssistant,
        Role::PatientManager,
        Role::Billing,
    ])?;
    ensure_patient_visible(&state, &auth, patient_uuid).await?;

    let rows = sqlx::query(
        r#"SELECT i.id, i.invoice_number, i.invoice_type, i.status, i.issued_at, i.due_date,
                  i.total_gross, i.credited_amount, i.paid_amount, i.prepayment_applied_amount,
                  o.order_number, q.quote_number
           FROM invoices i
           LEFT JOIN orders o ON o.id = i.order_id
           LEFT JOIN quotes q ON q.id = i.quote_id
           WHERE i.patient_id = $1
           ORDER BY i.issued_at DESC, i.created_at DESC"#,
    )
    .bind(patient_uuid)
    .fetch_all(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, patient_id = %patient_uuid, "Failed to list patient invoices");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to list patient invoices",
        )
    })?;

    let items = rows
        .into_iter()
        .map(|row| {
            let total_gross = row
                .try_get::<rust_decimal::Decimal, _>("total_gross")
                .unwrap_or(rust_decimal::Decimal::ZERO);
            let paid_amount = row
                .try_get::<rust_decimal::Decimal, _>("paid_amount")
                .unwrap_or(rust_decimal::Decimal::ZERO);
            let credited_amount = row
                .try_get::<rust_decimal::Decimal, _>("credited_amount")
                .unwrap_or(rust_decimal::Decimal::ZERO);
            let prepayment_applied_amount = row
                .try_get::<rust_decimal::Decimal, _>("prepayment_applied_amount")
                .unwrap_or(rust_decimal::Decimal::ZERO);
            serde_json::json!({
                "id": row.try_get::<Uuid, _>("id").unwrap_or_else(|_| Uuid::nil()),
                "invoice_number": row.try_get::<String, _>("invoice_number").unwrap_or_default(),
                "invoice_type": row.try_get::<String, _>("invoice_type").unwrap_or_default(),
                "status": row.try_get::<String, _>("status").unwrap_or_default(),
                "issued_at": row.try_get::<chrono::DateTime<chrono::Utc>, _>("issued_at").map(|value| value.to_rfc3339()).unwrap_or_default(),
                "due_date": row.try_get::<Option<chrono::NaiveDate>, _>("due_date").unwrap_or_default().map(|value| value.to_string()),
                "total_gross": total_gross.round_dp(2).normalize().to_string(),
                "credited_amount": credited_amount.round_dp(2).normalize().to_string(),
                "adjusted_total_gross": (total_gross - credited_amount).max(rust_decimal::Decimal::ZERO).round_dp(2).normalize().to_string(),
                "paid_amount": paid_amount.round_dp(2).normalize().to_string(),
                "prepayment_applied_amount": prepayment_applied_amount.round_dp(2).normalize().to_string(),
                "balance_due": (total_gross - credited_amount - paid_amount - prepayment_applied_amount).max(rust_decimal::Decimal::ZERO).round_dp(2).normalize().to_string(),
                "order_number": row.try_get::<Option<String>, _>("order_number").unwrap_or_default(),
                "quote_number": row.try_get::<Option<String>, _>("quote_number").unwrap_or_default(),
            })
        })
        .collect::<Vec<_>>();

    Ok(Json(items))
}

async fn get_patient_service_report(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(patient_uuid): Path<Uuid>,
) -> Result<Json<Value>, axum::response::Response> {
    auth.require_any_role(&[
        Role::Ceo,
        Role::CeoAssistant,
        Role::PatientManager,
        Role::Billing,
    ])?;
    ensure_patient_visible(&state, &auth, patient_uuid).await?;

    let summary_row = sqlx::query(
        r#"SELECT COUNT(*) AS service_count,
                  COUNT(*) FILTER (
                      WHERE ol.delivered_at IS NOT NULL
                         OR ol.status IN ('delivered', 'approved', 'invoiced')
                  ) AS delivered_count,
                  COUNT(*) FILTER (
                      WHERE ol.approved_at IS NOT NULL
                         OR ol.status IN ('approved', 'invoiced')
                  ) AS approved_count,
                  COALESCE(
                      SUM(ol.quantity * ol.unit_price * (1 + (ol.vat_rate / 100))),
                      0
                  ) AS total_gross,
                  MIN(COALESCE(ol.approved_at, ol.delivered_at, ol.created_at)) AS first_service_at,
                  MAX(COALESCE(ol.approved_at, ol.delivered_at, ol.created_at)) AS last_service_at
           FROM order_leistungen ol
           JOIN orders o ON o.id = ol.order_id
           WHERE o.patient_id = $1"#,
    )
    .bind(patient_uuid)
    .fetch_one(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, patient_id = %patient_uuid, "Failed to load patient service report summary");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to load patient service report",
        )
    })?;

    let item_rows = sqlx::query(
        r#"SELECT ol.id,
                  o.id AS order_id,
                  o.order_number,
                  ol.description,
                  ol.status,
                  ol.quantity,
                  ol.unit_price,
                  ol.currency,
                  ol.vat_rate,
                  (ol.quantity * ol.unit_price) AS line_net,
                  ((ol.quantity * ol.unit_price) * (ol.vat_rate / 100)) AS line_vat,
                  (ol.quantity * ol.unit_price * (1 + (ol.vat_rate / 100))) AS line_gross,
                  ol.provider_id,
                  p.name AS provider_name,
                  ol.doctor_id,
                  d.name AS doctor_name,
                  ol.is_cost_passthrough,
                  ol.notes,
                  ol.delivered_at,
                  ol.approved_at,
                  COALESCE(ol.approved_at, ol.delivered_at, ol.created_at) AS effective_at
           FROM order_leistungen ol
           JOIN orders o ON o.id = ol.order_id
           LEFT JOIN providers p ON p.id = ol.provider_id
           LEFT JOIN provider_doctors d ON d.id = ol.doctor_id
           WHERE o.patient_id = $1
           ORDER BY effective_at DESC, ol.created_at DESC"#,
    )
    .bind(patient_uuid)
    .fetch_all(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, patient_id = %patient_uuid, "Failed to load patient service report items");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to load patient service report",
        )
    })?;

    let service_count = summary_row
        .try_get::<i64, _>("service_count")
        .unwrap_or_default();
    let delivered_count = summary_row
        .try_get::<i64, _>("delivered_count")
        .unwrap_or_default();
    let approved_count = summary_row
        .try_get::<i64, _>("approved_count")
        .unwrap_or_default();
    let total_gross = summary_row
        .try_get::<rust_decimal::Decimal, _>("total_gross")
        .unwrap_or(rust_decimal::Decimal::ZERO);
    let first_service_at = summary_row
        .try_get::<Option<chrono::DateTime<chrono::Utc>>, _>("first_service_at")
        .unwrap_or_default();
    let last_service_at = summary_row
        .try_get::<Option<chrono::DateTime<chrono::Utc>>, _>("last_service_at")
        .unwrap_or_default();

    let items = item_rows
        .into_iter()
        .map(|row| {
            let quantity = row
                .try_get::<rust_decimal::Decimal, _>("quantity")
                .unwrap_or(rust_decimal::Decimal::ZERO);
            let unit_price = row
                .try_get::<rust_decimal::Decimal, _>("unit_price")
                .unwrap_or(rust_decimal::Decimal::ZERO);
            let vat_rate = row
                .try_get::<rust_decimal::Decimal, _>("vat_rate")
                .unwrap_or(rust_decimal::Decimal::ZERO);
            let line_net = row
                .try_get::<rust_decimal::Decimal, _>("line_net")
                .unwrap_or(rust_decimal::Decimal::ZERO);
            let line_vat = row
                .try_get::<rust_decimal::Decimal, _>("line_vat")
                .unwrap_or(rust_decimal::Decimal::ZERO);
            let line_gross = row
                .try_get::<rust_decimal::Decimal, _>("line_gross")
                .unwrap_or(rust_decimal::Decimal::ZERO);

            json!({
                "id": row.try_get::<Uuid, _>("id").unwrap_or_else(|_| Uuid::nil()),
                "order_id": row.try_get::<Uuid, _>("order_id").unwrap_or_else(|_| Uuid::nil()),
                "order_number": row.try_get::<String, _>("order_number").unwrap_or_default(),
                "description": row.try_get::<String, _>("description").unwrap_or_default(),
                "status": row.try_get::<String, _>("status").unwrap_or_default(),
                "quantity": quantity.normalize().to_string(),
                "unit_price": money_json(unit_price),
                "vat_rate": vat_rate.normalize().to_string(),
                "line_net": money_json(line_net),
                "line_vat": money_json(line_vat),
                "line_gross": money_json(line_gross),
                "currency": row.try_get::<String, _>("currency").unwrap_or_else(|_| "EUR".to_string()),
                "provider_id": row.try_get::<Option<Uuid>, _>("provider_id").unwrap_or_default(),
                "provider_name": row.try_get::<Option<String>, _>("provider_name").unwrap_or_default(),
                "doctor_id": row.try_get::<Option<Uuid>, _>("doctor_id").unwrap_or_default(),
                "doctor_name": row.try_get::<Option<String>, _>("doctor_name").unwrap_or_default(),
                "is_cost_passthrough": row.try_get::<bool, _>("is_cost_passthrough").unwrap_or(false),
                "notes": row.try_get::<Option<String>, _>("notes").unwrap_or_default(),
                "delivered_at": row.try_get::<Option<chrono::DateTime<chrono::Utc>>, _>("delivered_at").unwrap_or_default().map(|value| value.to_rfc3339()),
                "approved_at": row.try_get::<Option<chrono::DateTime<chrono::Utc>>, _>("approved_at").unwrap_or_default().map(|value| value.to_rfc3339()),
                "effective_at": row.try_get::<chrono::DateTime<chrono::Utc>, _>("effective_at").map(|value| value.to_rfc3339()).unwrap_or_default(),
            })
        })
        .collect::<Vec<_>>();

    state.audit_sender.try_send(audit::domain_event(
        "view_patient_service_report",
        Some(auth.user_id),
        "patient",
        Some(patient_uuid),
        json!({
            "service_count": service_count,
            "approved_count": approved_count,
            "total_gross": money_json(total_gross),
        }),
    ));

    Ok(Json(json!({
        "patient_id": patient_uuid,
        "summary": {
            "service_count": service_count,
            "delivered_count": delivered_count,
            "approved_count": approved_count,
            "total_gross": money_json(total_gross),
            "first_service_at": first_service_at.map(|value| value.to_rfc3339()),
            "last_service_at": last_service_at.map(|value| value.to_rfc3339()),
        },
        "items": items,
    })))
}

async fn list_relations(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(patient_uuid): Path<Uuid>,
) -> Result<Json<Vec<Value>>, axum::response::Response> {
    auth.require_any_role(&[
        Role::Ceo,
        Role::PatientManager,
        Role::Billing,
        Role::TeamleadInterpreter,
        Role::Interpreter,
        Role::Concierge,
    ])?;
    ensure_patient_visible(&state, &auth, patient_uuid).await?;

    let rows = sqlx::query(
        r#"SELECT pr.id, pr.patient_id, pr.related_patient_id, pr.related_name, pr.relation_type,
                  pr.is_emergency_contact, pr.phone, pr.notes, pr.created_at,
                  rp.patient_id AS related_patient_pid,
                  rp.first_name AS related_first_name,
                  rp.last_name AS related_last_name
           FROM patient_relations pr
           LEFT JOIN patients rp ON rp.id = pr.related_patient_id
           WHERE pr.patient_id = $1
           ORDER BY pr.is_emergency_contact DESC, pr.created_at DESC"#,
    )
    .bind(patient_uuid)
    .fetch_all(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, patient_id = %patient_uuid, "Failed to list patient relations");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to list patient relations",
        )
    })?;

    let items = rows
        .into_iter()
        .map(build_relation_json)
        .collect::<Vec<_>>();

    Ok(Json(items))
}

/// Trim free-text relation fields and treat an empty result as NULL.
fn relation_opt_text(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(str::to_string)
}

async fn create_relation(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(patient_uuid): Path<Uuid>,
    Json(body): Json<UpsertRelationRequest>,
) -> Result<(StatusCode, Json<Value>), axum::response::Response> {
    auth.require_any_role(&[Role::Ceo, Role::PatientManager])?;
    ensure_patient_visible(&state, &auth, patient_uuid).await?;
    validate_relation_request(&body, patient_uuid)?;

    if let Some(related_patient_id) = body.related_patient_id {
        ensure_related_patient_exists(&state, related_patient_id).await?;
    }

    let phone = relation_opt_text(body.phone.as_deref());
    let notes = relation_opt_text(body.notes.as_deref());

    let row = sqlx::query(
        r#"WITH upserted AS (
                INSERT INTO patient_relations (
                    patient_id, related_patient_id, related_name, relation_type,
                    is_emergency_contact, phone, notes
                ) VALUES ($1, $2, $3, $4, $5, $6, $7)
                RETURNING id, patient_id, related_patient_id, related_name, relation_type,
                          is_emergency_contact, phone, notes, created_at
           )
           SELECT u.id, u.patient_id, u.related_patient_id, u.related_name, u.relation_type,
                  u.is_emergency_contact, u.phone, u.notes, u.created_at,
                  rp.patient_id AS related_patient_pid,
                  rp.first_name AS related_first_name,
                  rp.last_name AS related_last_name
           FROM upserted u
           LEFT JOIN patients rp ON rp.id = u.related_patient_id"#,
    )
    .bind(patient_uuid)
    .bind(body.related_patient_id)
    .bind(body.related_name.trim())
    .bind(body.relation_type.trim())
    .bind(body.is_emergency_contact.unwrap_or(false))
    .bind(phone)
    .bind(notes)
    .fetch_one(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, patient_id = %patient_uuid, "Failed to create patient relation");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to create patient relation",
        )
    })?;

    state.audit_sender.try_send(audit::domain_event(
        "create_patient_relation",
        Some(auth.user_id),
        "patient",
        Some(patient_uuid),
        serde_json::json!({
            "relation_id": row.try_get::<Uuid, _>("id").unwrap_or_else(|_| Uuid::nil()),
            "relation_type": body.relation_type,
            "related_patient_id": body.related_patient_id,
        }),
    ));

    Ok((StatusCode::CREATED, Json(build_relation_json(row))))
}

async fn update_relation(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path((patient_uuid, relation_id)): Path<(Uuid, Uuid)>,
    Json(body): Json<UpsertRelationRequest>,
) -> Result<Json<Value>, axum::response::Response> {
    auth.require_any_role(&[Role::Ceo, Role::PatientManager])?;
    ensure_patient_visible(&state, &auth, patient_uuid).await?;
    validate_relation_request(&body, patient_uuid)?;

    if let Some(related_patient_id) = body.related_patient_id {
        ensure_related_patient_exists(&state, related_patient_id).await?;
    }

    let phone = relation_opt_text(body.phone.as_deref());
    let notes = relation_opt_text(body.notes.as_deref());

    let updated = sqlx::query(
        r#"WITH upserted AS (
                UPDATE patient_relations
                SET related_patient_id = $3,
                    related_name = $4,
                    relation_type = $5,
                    is_emergency_contact = $6,
                    phone = $7,
                    notes = $8
                WHERE patient_id = $1
                  AND id = $2
                RETURNING id, patient_id, related_patient_id, related_name, relation_type,
                          is_emergency_contact, phone, notes, created_at
           )
           SELECT u.id, u.patient_id, u.related_patient_id, u.related_name, u.relation_type,
                  u.is_emergency_contact, u.phone, u.notes, u.created_at,
                  rp.patient_id AS related_patient_pid,
                  rp.first_name AS related_first_name,
                  rp.last_name AS related_last_name
           FROM upserted u
           LEFT JOIN patients rp ON rp.id = u.related_patient_id"#,
    )
    .bind(patient_uuid)
    .bind(relation_id)
    .bind(body.related_patient_id)
    .bind(body.related_name.trim())
    .bind(body.relation_type.trim())
    .bind(body.is_emergency_contact.unwrap_or(false))
    .bind(phone)
    .bind(notes)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, patient_id = %patient_uuid, relation_id = %relation_id, "Failed to update patient relation");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to update patient relation",
        )
    })?;

    let Some(row) = updated else {
        return Err(err(StatusCode::NOT_FOUND, "Patient relation not found"));
    };

    state.audit_sender.try_send(audit::domain_event(
        "update_patient_relation",
        Some(auth.user_id),
        "patient",
        Some(patient_uuid),
        serde_json::json!({
            "relation_id": relation_id,
            "relation_type": body.relation_type,
            "related_patient_id": body.related_patient_id,
        }),
    ));

    Ok(Json(build_relation_json(row)))
}

async fn delete_relation(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path((patient_uuid, relation_id)): Path<(Uuid, Uuid)>,
) -> Result<Json<Value>, axum::response::Response> {
    auth.require_any_role(&[Role::Ceo, Role::PatientManager])?;
    ensure_patient_visible(&state, &auth, patient_uuid).await?;

    let result = sqlx::query("DELETE FROM patient_relations WHERE patient_id = $1 AND id = $2")
        .bind(patient_uuid)
        .bind(relation_id)
    .execute(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, patient_id = %patient_uuid, relation_id = %relation_id, "Failed to delete patient relation");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to delete patient relation",
        )
    })?;

    if result.rows_affected() == 0 {
        return Err(err(StatusCode::NOT_FOUND, "Patient relation not found"));
    }

    state.audit_sender.try_send(audit::domain_event(
        "delete_patient_relation",
        Some(auth.user_id),
        "patient",
        Some(patient_uuid),
        serde_json::json!({ "relation_id": relation_id }),
    ));

    Ok(Json(serde_json::json!({ "ok": true })))
}

#[derive(Deserialize)]
struct PatientTimelineQuery {
    entity_type: Option<String>,
    category: Option<String>,
    source: Option<String>,
    search: Option<String>,
    range: Option<String>,
    limit: Option<i64>,
    offset: Option<i64>,
}

async fn get_patient_timeline(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(patient_uuid): Path<Uuid>,
    Query(query): Query<PatientTimelineQuery>,
) -> Result<Json<Value>, axum::response::Response> {
    auth.require_any_role(&[
        Role::Ceo,
        Role::PatientManager,
        Role::Billing,
        Role::TeamleadInterpreter,
        Role::Interpreter,
        Role::Concierge,
    ])?;
    ensure_patient_visible(&state, &auth, patient_uuid).await?;

    let limit = query.limit.unwrap_or(50).clamp(1, 200);
    let offset = query.offset.unwrap_or(0).max(0);
    let entity_type = query
        .entity_type
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let category = query
        .category
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let source = query
        .source
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let search_pattern = format!("%{}%", query.search.as_deref().unwrap_or("").trim());
    let range_cutoff = match query.range.as_deref().unwrap_or("all") {
        "all" => None,
        "30d" => Some(chrono::Utc::now() - chrono::Duration::days(30)),
        "90d" => Some(chrono::Utc::now() - chrono::Duration::days(90)),
        "180d" => Some(chrono::Utc::now() - chrono::Duration::days(180)),
        "365d" => Some(chrono::Utc::now() - chrono::Duration::days(365)),
        _ => {
            return Err(err(
                StatusCode::UNPROCESSABLE_ENTITY,
                "Invalid timeline range filter",
            ));
        }
    };

    let events_cte_static = r#"WITH events AS (
            SELECT 'patient'::text AS entity_type,
                   p.id AS entity_id,
                   concat_ws(' ', p.patient_id, p.first_name, p.last_name) AS title,
                   'intake'::text AS category,
                   CASE WHEN p.is_active THEN 'active' ELSE 'inactive' END AS status,
                   p.created_at AS happened_at,
                   creator.name AS source_label
            FROM patients p
            LEFT JOIN users creator ON creator.id = p.created_by
            WHERE p.id = $1

            UNION ALL

            SELECT 'appointment'::text AS entity_type,
                   a.id AS entity_id,
                   a.title AS title,
                   COALESCE(a.appointment_type, 'medical') AS category,
                   a.status AS status,
                   ((a.date::timestamp + COALESCE(a.time_start, time '00:00')) AT TIME ZONE 'Europe/Berlin') AS happened_at,
                   concat_ws(' · ', p.name, d.name) AS source_label
            FROM appointments a
            LEFT JOIN providers p ON p.id = a.provider_id
            LEFT JOIN provider_doctors d ON d.id = a.doctor_id
            WHERE a.patient_id = $1

            UNION ALL

            SELECT 'case'::text AS entity_type,
                   c.id AS entity_id,
                   COALESCE(c.hauptanfragegrund, c.case_id) AS title,
                   'anamnesis'::text AS category,
                   c.status AS status,
                   c.created_at AS happened_at,
                   c.case_id AS source_label
            FROM cases c
            LEFT JOIN leads source_lead
                   ON source_lead.id = COALESCE(c.source_lead_id, c.lead_id)
            WHERE COALESCE(c.patient_id, source_lead.converted_patient_id) = $1

            UNION ALL

            SELECT 'task'::text AS entity_type,
                   t.id AS entity_id,
                   t.title AS title,
                   'workflow'::text AS category,
                   t.status AS status,
                   COALESCE(t.completed_at, t.due_date, t.created_at) AS happened_at,
                   assignee.name AS source_label
            FROM tasks t
            LEFT JOIN users assignee ON assignee.id = t.assigned_to
            LEFT JOIN orders task_order ON task_order.id = t.order_id
            LEFT JOIN leads task_lead ON task_lead.id = task_order.source_lead_id
            LEFT JOIN appointments task_appointment ON task_appointment.id = t.appointment_id
            WHERE COALESCE(
                      t.patient_id,
                      task_order.patient_id,
                      task_lead.converted_patient_id,
                      task_appointment.patient_id
                  ) = $1
              AND NOT EXISTS (
                  SELECT 1
                  FROM workflow_checklist_items checklist
                  WHERE checklist.linked_task_id = t.id
              )
              AND NOT (
                  t.status = 'cancelled'
                  AND t.order_id IS NULL
                  AND t.appointment_id IS NULL
                  AND t.title LIKE 'Patient checklist:%'
              )

            UNION ALL

            SELECT 'workflow_task'::text AS entity_type,
                   checklist.id AS entity_id,
                   checklist.item_text AS title,
                   checklist.checklist_key AS category,
                   CASE WHEN checklist.is_completed THEN 'completed' ELSE 'open' END AS status,
                   COALESCE(checklist.completed_at, checklist.due_date, checklist.created_at) AS happened_at,
                   concat_ws(' · ', owner.name, checklist.owner_role) AS source_label
            FROM workflow_checklist_items checklist
            LEFT JOIN users owner ON owner.id = checklist.owner_user_id
            WHERE checklist.patient_id = $1

            UNION ALL

            SELECT 'communication'::text AS entity_type,
                   communication.id AS entity_id,
                   COALESCE(
                       NULLIF(communication.subject, ''),
                       NULLIF(left(communication.message, 120), ''),
                       'Communication'
                   ) AS title,
                   'communication'::text AS category,
                   communication.status AS status,
                   COALESCE(
                       communication.closed_at,
                       communication.responded_at,
                       communication.due_at,
                       communication.created_at
                   ) AS happened_at,
                   concat_ws(' · ', communication.contact_name, provider.name, doctor.name) AS source_label
            FROM appointment_communications communication
            LEFT JOIN appointments communication_appointment
                   ON communication_appointment.id = communication.appointment_id
            LEFT JOIN providers provider ON provider.id = communication.provider_id
            LEFT JOIN provider_doctors doctor ON doctor.id = communication.doctor_id
            WHERE COALESCE(communication.patient_id, communication_appointment.patient_id) = $1

            UNION ALL

            SELECT 'reminder'::text AS entity_type,
                   reminder.id AS entity_id,
                   reminder.title AS title,
                   'scheduling'::text AS category,
                   CASE WHEN reminder.is_completed THEN 'completed' ELSE 'open' END AS status,
                   COALESCE(reminder.completed_at, reminder.remind_at, reminder.created_at) AS happened_at,
                   reminder_user.name AS source_label
            FROM reminders reminder
            JOIN appointments reminder_appointment ON reminder_appointment.id = reminder.appointment_id
            LEFT JOIN users reminder_user ON reminder_user.id = reminder.user_id
            WHERE reminder_appointment.patient_id = $1

            UNION ALL

            SELECT 'relation'::text AS entity_type,
                   relation.id AS entity_id,
                   COALESCE(
                       NULLIF(concat_ws(' ', related_patient.first_name, related_patient.last_name), ''),
                       relation.related_name,
                       'Related person'
                   ) AS title,
                   'care'::text AS category,
                   'active'::text AS status,
                   relation.created_at AS happened_at,
                   relation.relation_type AS source_label
            FROM patient_relations relation
            LEFT JOIN patients related_patient ON related_patient.id = relation.related_patient_id
            WHERE relation.patient_id = $1

            UNION ALL

            SELECT 'order'::text AS entity_type,
                   o.id AS entity_id,
                   o.order_number AS title,
                   o.phase AS category,
                   o.status AS status,
                   o.created_at AS happened_at,
                   COALESCE(o.needs_description, o.order_number) AS source_label
            FROM orders o
            LEFT JOIN leads source_lead ON source_lead.id = o.source_lead_id
            WHERE COALESCE(o.patient_id, source_lead.converted_patient_id) = $1

            UNION ALL

            SELECT 'service'::text AS entity_type,
                   ol.id AS entity_id,
                   ol.description AS title,
                   'leistung'::text AS category,
                   ol.status AS status,
                   COALESCE(ol.delivered_at, ol.approved_at, ol.created_at) AS happened_at,
                   concat_ws(' · ', o.order_number, p.name, d.name) AS source_label
            FROM order_leistungen ol
            JOIN orders o ON o.id = ol.order_id
            LEFT JOIN leads source_lead ON source_lead.id = o.source_lead_id
            LEFT JOIN providers p ON p.id = ol.provider_id
            LEFT JOIN provider_doctors d ON d.id = ol.doctor_id
            WHERE COALESCE(o.patient_id, source_lead.converted_patient_id) = $1

            UNION ALL

            SELECT 'document'::text AS entity_type,
                   d.id AS entity_id,
                   COALESCE(d.auto_name, d.original_filename, 'Document') AS title,
                   COALESCE(d.category, d.art, 'document') AS category,
                   d.status AS status,
                   d.created_at AS happened_at,
                   d.visibility AS source_label
            FROM documents d
            LEFT JOIN leads source_lead ON source_lead.id = d.lead_id
            WHERE COALESCE(d.patient_id, source_lead.converted_patient_id) = $1

            UNION ALL

            SELECT 'contract'::text AS entity_type,
                   fc.id AS entity_id,
                   fc.contract_number AS title,
                   'framework_contract'::text AS category,
                   fc.status AS status,
                   COALESCE(fc.signed_at, fc.created_at) AS happened_at,
                   NULL::text AS source_label
            FROM framework_contracts fc
            LEFT JOIN leads source_lead ON source_lead.id = fc.lead_id
            WHERE COALESCE(fc.patient_id, source_lead.converted_patient_id) = $1
              AND $7::boolean

            UNION ALL

            SELECT 'quote'::text AS entity_type,
                   q.id AS entity_id,
                   q.quote_number AS title,
                   'financial'::text AS category,
                   q.status AS status,
                   COALESCE(q.paid_at, q.created_at) AS happened_at,
                   o.order_number AS source_label
            FROM quotes q
            JOIN orders o ON o.id = q.order_id
            LEFT JOIN leads source_lead ON source_lead.id = o.source_lead_id
            WHERE COALESCE(o.patient_id, source_lead.converted_patient_id) = $1
              AND $7::boolean

            UNION ALL

            SELECT 'invoice'::text AS entity_type,
                   i.id AS entity_id,
                   i.invoice_number AS title,
                   i.invoice_type AS category,
                   i.status AS status,
                   i.issued_at AS happened_at,
                   NULL::text AS source_label
            FROM invoices i
            WHERE i.patient_id = $1
              AND $7::boolean

            UNION ALL

            SELECT 'dunning'::text AS entity_type,
                   dunning.id AS entity_id,
                   concat('Dunning ', dunning.level, ': ', invoice.invoice_number) AS title,
                   'billing'::text AS category,
                   'sent'::text AS status,
                   COALESCE(dunning.sent_at, dunning.created_at) AS happened_at,
                   dunning_user.name AS source_label
            FROM invoice_dunning_events dunning
            JOIN invoices invoice ON invoice.id = dunning.invoice_id
            LEFT JOIN users dunning_user ON dunning_user.id = dunning.created_by
            WHERE invoice.patient_id = $1
              AND $7::boolean

            UNION ALL

            SELECT 'invoice_visibility'::text AS entity_type,
                   i.id AS entity_id,
                   concat('Invoice visibility: ', i.invoice_number) AS title,
                   'invoice_visibility'::text AS category,
                   CASE
                       WHEN COALESCE((al.context->>'portal_visible')::boolean, i.portal_visible) = false THEN 'hidden'
                       WHEN COALESCE((al.context->>'hide_amounts_from_patient')::boolean, i.hide_amounts_from_patient) = true THEN 'amounts_hidden'
                       ELSE 'visible'
                   END AS status,
                   al.created_at AS happened_at,
                   concat_ws(' · ', u.name, al.context->>'visibility_note') AS source_label
            FROM audit_log al
            JOIN invoices i ON i.id = al.entity_id
            LEFT JOIN users u ON u.id = al.user_id
            WHERE al.entity_type = 'invoice'
              AND al.action = 'invoice_visibility_changed'
              AND i.patient_id = $1
              AND $7::boolean

            UNION ALL

            SELECT 'recommendation'::text AS entity_type,
                   pr.id AS entity_id,
                   pr.title AS title,
                   pr.recommendation_type AS category,
                   pr.status AS status,
                   COALESCE(pr.due_at, pr.created_at) AS happened_at,
                   concat_ws(' / ', doctor.name, pr.priority) AS source_label
            FROM patient_recommendations pr
            LEFT JOIN provider_doctors doctor ON doctor.id = pr.source_doctor_id
            WHERE pr.patient_id = $1

            UNION ALL

            SELECT 'translation_request'::text AS entity_type,
                   dtr.id AS entity_id,
                   concat('Translation request: ', dtr.requested_language, ' - ', COALESCE(d.auto_name, d.original_filename, 'Document')) AS title,
                   dtr.request_source AS category,
                   dtr.status AS status,
                   COALESCE(dtr.completed_at, dtr.requested_at) AS happened_at,
                   concat_ws(' / ', dtr.requested_language, u.name) AS source_label
            FROM document_translation_requests dtr
            LEFT JOIN documents d ON d.id = dtr.document_id
            LEFT JOIN users u ON u.id = dtr.requested_by
            WHERE dtr.patient_id = $1

            UNION ALL

            SELECT 'service_package'::text AS entity_type,
                   psp.id AS entity_id,
                   sp.name AS title,
                   'service_package'::text AS category,
                   psp.status AS status,
                   psp.assigned_at AS happened_at,
                   concat_ws(' / ', o.order_number, psp.payer_contact_relationship) AS source_label
            FROM patient_service_packages psp
            JOIN service_packages sp ON sp.id = psp.package_id
            LEFT JOIN orders o ON o.id = psp.order_id
            WHERE psp.patient_id = $1
              AND $7::boolean

            UNION ALL

            SELECT 'service_package_consumption'::text AS entity_type,
                   spc.id AS entity_id,
                   COALESCE(spi.description, sp.name, 'Package consumption') AS title,
                   'package_consumption'::text AS category,
                   spc.approval_status AS status,
                   spc.consumed_at AS happened_at,
                   concat_ws(' / ', sp.name, o.order_number) AS source_label
            FROM service_package_consumptions spc
            JOIN patient_service_packages psp ON psp.id = spc.patient_service_package_id
            JOIN service_packages sp ON sp.id = psp.package_id
            LEFT JOIN service_package_items spi ON spi.id = spc.package_item_id
            LEFT JOIN orders o ON o.id = spc.order_id
            WHERE psp.patient_id = $1
              AND $7::boolean

            UNION ALL

            SELECT 'service_package_change'::text AS entity_type,
                   COALESCE(psp.id, $1) AS entity_id,
                   concat('Package change: ', COALESCE(sp.name, al.action)) AS title,
                   'service_package'::text AS category,
                   COALESCE(psp.status, al.context->>'status', 'changed') AS status,
                   al.created_at AS happened_at,
                   u.name AS source_label
            FROM audit_log al
            LEFT JOIN patient_service_packages psp ON psp.id = al.entity_id
            LEFT JOIN service_packages sp ON sp.id = psp.package_id
            LEFT JOIN users u ON u.id = al.user_id
            WHERE $7::boolean
              AND (
                    (
                        al.entity_type = 'patient_service_package'
                        AND psp.patient_id = $1
                    )
                    OR (
                        al.entity_type = 'patient'
                        AND al.entity_id = $1
                        AND al.action LIKE 'patient_service_package_%'
                    )
                    OR (
                        al.context->>'patient_id' = $1::text
                        AND al.action LIKE 'patient_service_package_%'
                    )
              )

            UNION ALL

            SELECT 'service_group'::text AS entity_type,
                   osg.id AS entity_id,
                   osg.group_title AS title,
                   'service_group'::text AS category,
                   osg.status AS status,
                   COALESCE((osg.service_date::timestamp AT TIME ZONE 'Europe/Berlin'), osg.created_at) AS happened_at,
                   o.order_number AS source_label
            FROM order_service_groups osg
            JOIN orders o ON o.id = osg.order_id
            LEFT JOIN leads source_lead ON source_lead.id = o.source_lead_id
            WHERE COALESCE(o.patient_id, source_lead.converted_patient_id) = $1

            UNION ALL

            SELECT 'interpreter_preference'::text AS entity_type,
                   COALESCE(interpreter.id, al.entity_id) AS entity_id,
                   concat(
                       'Interpreter preference: ',
                       COALESCE(interpreter.name, 'Interpreter'),
                       ' -> ',
                       COALESCE(al.context->>'preference', 'neutral')
                   ) AS title,
                   'interpreter_preference'::text AS category,
                   COALESCE(al.context->>'preference', 'changed') AS status,
                   al.created_at AS happened_at,
                   actor.name AS source_label
            FROM audit_log al
            LEFT JOIN users actor ON actor.id = al.user_id
            LEFT JOIN users interpreter
                   ON interpreter.id = CASE
                       WHEN COALESCE(al.context->>'interpreter_id', '') ~* '^[0-9a-f-]{36}$'
                       THEN (al.context->>'interpreter_id')::uuid
                       ELSE NULL::uuid
                   END
            WHERE al.entity_type = 'patient'
              AND al.entity_id = $1
              AND al.action = 'interpreter_preference_changed'

            UNION ALL

            SELECT 'drug_verification'::text AS entity_type,
                   COALESCE(
                       CASE
                           WHEN COALESCE(al.context->>'match_id', '') ~* '^[0-9a-f-]{36}$'
                           THEN (al.context->>'match_id')::uuid
                           ELSE NULL::uuid
                       END,
                       al.entity_id
                   ) AS entity_id,
                   concat(
                       'Drug match ',
                       COALESCE(al.context->>'verification_status', 'verified'),
                       ': ',
                       COALESCE(m.handelsname, 'medication')
                   ) AS title,
                   'drug_verification'::text AS category,
                   COALESCE(al.context->>'verification_status', 'verified') AS status,
                   al.created_at AS happened_at,
                   concat_ws(' · ', actor.name, dp.brand_name) AS source_label
            FROM audit_log al
            JOIN cases c ON c.id = al.entity_id
            LEFT JOIN users actor ON actor.id = al.user_id
            LEFT JOIN medication_drug_matches mdm
                   ON mdm.id = CASE
                       WHEN COALESCE(al.context->>'match_id', '') ~* '^[0-9a-f-]{36}$'
                       THEN (al.context->>'match_id')::uuid
                       ELSE NULL::uuid
                   END
            LEFT JOIN patient_medications m ON m.id = mdm.patient_medication_id
            LEFT JOIN drug_products dp ON dp.id = mdm.drug_product_id
            WHERE al.entity_type = 'case'
              AND al.action = 'drug_match_verified'
              AND c.patient_id = $1

            UNION ALL

            SELECT 'card_entry'::text AS entity_type,
                   e.id AS entity_id,
                   CASE
                       WHEN length(e.content) > 120 THEN left(e.content, 117) || '...'
                       ELSE e.content
                   END AS title,
                   e.category AS category,
                   'logged'::text AS status,
                   e.entry_date AS happened_at,
                   concat_ws(' · ', e.source, u.name) AS source_label
            FROM patient_card_entries e
            LEFT JOIN users u ON u.id = e.author_id
            WHERE e.patient_id = $1

            UNION ALL

            SELECT 'assignment'::text AS entity_type,
                   assignment.user_id AS entity_id,
                   assigned_user.name AS title,
                   'care'::text AS category,
                   CASE WHEN assignment.revoked_at IS NULL THEN 'active' ELSE 'revoked' END AS status,
                   COALESCE(assignment.revoked_at, assignment.assigned_at) AS happened_at,
                   concat_ws(' · ', assigned_by_user.name, assigned_user.role) AS source_label
            FROM patient_assignments assignment
            JOIN users assigned_user ON assigned_user.id = assignment.user_id
            LEFT JOIN users assigned_by_user ON assigned_by_user.id = assignment.assigned_by
            WHERE assignment.patient_id = $1

            UNION ALL

            SELECT 'medical_order'::text AS entity_type,
                   mo.id AS entity_id,
                   mo.title AS title,
                   mo.order_type AS category,
                   mo.status AS status,
                   mo.order_date AS happened_at,
                   concat_ws(' · ', mo.source, u.name) AS source_label
            FROM patient_medical_orders mo
            LEFT JOIN users u ON u.id = mo.ordered_by
            WHERE mo.patient_id = $1

            UNION ALL

            SELECT 'risk_score'::text AS entity_type,
                   rs.id AS entity_id,
                   CASE
                       WHEN rs.scale_max IS NULL THEN concat(rs.score_type, ' ', trim(to_char(rs.score_value, 'FM999999990.##')))
                       ELSE concat(rs.score_type, ' ', trim(to_char(rs.score_value, 'FM999999990.##')), '/', trim(to_char(rs.scale_max, 'FM999999990.##')))
                   END AS title,
                   rs.score_type AS category,
                   'recorded'::text AS status,
                   rs.computed_at AS happened_at,
                   concat_ws(' · ', rs.source, u.name) AS source_label
            FROM patient_risk_scores rs
            LEFT JOIN users u ON u.id = rs.recorded_by
            WHERE rs.patient_id = $1

            UNION ALL

            SELECT 'compliance'::text AS entity_type,
                   consent.id AS entity_id,
                   concat('Consent: ', consent.consent_type) AS title,
                   'consent'::text AS category,
                   CASE
                       WHEN consent.revoked_at IS NOT NULL OR NOT consent.granted THEN 'revoked'
                       ELSE 'granted'
                   END AS status,
                   COALESCE(consent.revoked_at, consent.granted_at, consent.created_at) AS happened_at,
                   consent_user.name AS source_label
            FROM consent_records consent
            LEFT JOIN users consent_user ON consent_user.id = consent.user_id
            WHERE consent.patient_id = $1

            UNION ALL

            SELECT 'compliance'::text AS entity_type,
                   COALESCE(al.entity_id, $1) AS entity_id,
                   CASE
                       WHEN al.action = 'dsgvo_data_export' THEN 'DSGVO data export'
                       WHEN al.action = 'dsgvo_anonymize' THEN 'Patient anonymized'
                       WHEN al.action = 'privacy_request_created' AND COALESCE(al.context->>'request_type', 'erasure') = 'restriction' THEN 'Processing restriction requested'
                       WHEN al.action = 'privacy_request_created' AND COALESCE(al.context->>'request_type', 'erasure') = 'third_party_revoke' THEN 'Third-party sharing revocation requested'
                       WHEN al.action = 'privacy_request_created' THEN 'Privacy erasure requested'
                       WHEN al.action = 'privacy_request_reviewed' THEN 'Privacy request reviewed'
                       WHEN al.action = 'privacy_request_executed' AND COALESCE(al.context->>'request_type', 'erasure') = 'restriction' THEN 'Processing restriction applied'
                       WHEN al.action = 'privacy_request_executed' AND COALESCE(al.context->>'request_type', 'erasure') = 'third_party_revoke' THEN 'Third-party sharing revoked'
                       WHEN al.action = 'privacy_request_executed' THEN 'Privacy request executed'
                       WHEN al.action = 'consent_granted' THEN 'Consent granted'
                       WHEN al.action = 'consent_revoked' THEN 'Consent revoked'
                       WHEN al.action = 'feedback_submitted' THEN 'Patient feedback submitted'
                       WHEN al.action = 'feedback_reviewed' THEN 'Patient feedback reviewed'
                       WHEN al.action = 'workflow_checklist_item_created' THEN 'Workflow checklist item created'
                       WHEN al.action = 'workflow_checklist_item_completed' THEN 'Workflow checklist item completed'
                       ELSE 'Legal/compliance status updated'
                   END AS title,
                   CASE
                       WHEN al.action = 'dsgvo_data_export' THEN 'dsgvo_export'
                       WHEN al.action = 'dsgvo_anonymize' THEN 'dsgvo_anonymize'
                       WHEN al.action LIKE 'privacy_request_%' THEN 'privacy_request'
                       WHEN al.action IN ('consent_granted', 'consent_revoked') THEN 'consent'
                       WHEN al.action LIKE 'feedback_%' THEN 'feedback'
                       WHEN al.action LIKE 'workflow_checklist_item_%' THEN 'workflow'
                       ELSE 'legal_status'
                   END AS category,
                   CASE
                       WHEN al.action IN (
                           'privacy_request_created',
                           'feedback_submitted',
                           'workflow_checklist_item_created'
                       ) THEN 'open'
                       WHEN al.action IN ('privacy_request_reviewed') THEN 'in_progress'
                       ELSE 'completed'
                   END AS status,
                   al.created_at AS happened_at,
                   concat_ws(' · ', u.name, COALESCE(al.context->>'consent_type', al.context->>'request_type', al.context->>'review_action', al.context->>'article')) AS source_label
            FROM audit_log al
            LEFT JOIN users u ON u.id = al.user_id
            WHERE al.entity_type = 'patient'
              AND al.entity_id = $1
              AND (
                    al.action IN (
                        'dsgvo_data_export',
                        'dsgvo_anonymize',
                        'consent_granted',
                        'consent_revoked',
                        'feedback_submitted',
                        'feedback_reviewed',
                        'workflow_checklist_item_created',
                        'workflow_checklist_item_completed',
                        'privacy_request_created',
                        'privacy_request_reviewed',
                        'privacy_request_executed'
                    )
                    OR (
                        al.action = 'update_patient'
                        AND COALESCE((al.context->>'legal_status_updated')::boolean, false)
                    )
              )
        )"#;

    let filter_clause = r#"
        WHERE ($2::text IS NULL OR entity_type = $2)
          AND ($3::text IS NULL OR category = $3)
          AND ($4::text IS NULL OR LOWER(COALESCE(source_label, '')) = LOWER($4))
          AND ($5::text = '%%'
                OR title ILIKE $5
                OR category ILIKE $5
                OR status ILIKE $5
                OR entity_type ILIKE $5
                OR COALESCE(source_label, '') ILIKE $5)
          AND ($6::timestamptz IS NULL OR happened_at >= $6)
    "#;

    // Clinical-record activity (from the audit log) is only woven into the timeline
    // for the roles that can actually open the clinical profile, so it is never
    // surfaced to billing / interpreter / concierge who cannot see clinical data.
    let can_view_clinical = matches!(auth.role, Role::Ceo | Role::PatientManager | Role::ItAdmin);
    let can_view_financial = matches!(
        auth.role,
        Role::Ceo | Role::PatientManager | Role::Billing | Role::ItAdmin
    );
    const CLINICAL_TIMELINE_BRANCH: &str = r#"
            UNION ALL

            SELECT 'clinical'::text AS entity_type,
                   al.entity_id AS entity_id,
                   CASE al.action
                       WHEN 'save_patient_diagnoses' THEN 'Diagnosen aktualisiert'
                       WHEN 'save_patient_medications' THEN 'Medikation aktualisiert'
                       WHEN 'save_patient_examinations' THEN 'Befunde aktualisiert'
                       WHEN 'save_patient_procedures' THEN 'Therapie aktualisiert'
                       WHEN 'save_patient_clinical_warnings' THEN 'Allergien/CAVE aktualisiert'
                       WHEN 'save_patient_narrative' THEN 'Anamnese aktualisiert'
                       WHEN 'delete_patient_narrative' THEN 'Anamnese gelöscht'
                       WHEN 'save_patient_verlauf' THEN 'Verlauf aktualisiert'
                       ELSE 'Klinisches Profil aktualisiert'
                   END AS title,
                   'clinical'::text AS category,
                   'recorded'::text AS status,
                   al.created_at AS happened_at,
                   u.name AS source_label
            FROM audit_log al
            LEFT JOIN users u ON u.id = al.user_id
            WHERE al.entity_type = 'patient'
              AND al.entity_id = $1
              AND al.action IN (
                  'save_patient_diagnoses', 'save_patient_medications',
                  'save_patient_examinations', 'save_patient_procedures',
                  'save_patient_clinical_warnings', 'save_patient_narrative',
                  'delete_patient_narrative', 'save_patient_verlauf'
              )

            UNION ALL

            SELECT 'clinical'::text AS entity_type,
                   diagnosis.id AS entity_id,
                   concat_ws(' · ', diagnosis.label, diagnosis.icd_code) AS title,
                   'diagnosis'::text AS category,
                   COALESCE(NULLIF(diagnosis.status, ''), 'recorded') AS status,
                   diagnosis.created_at AS happened_at,
                   concat_ws(' · ', provider.name, doctor.name) AS source_label
            FROM patient_diagnoses diagnosis
            LEFT JOIN providers provider ON provider.id = diagnosis.provider_id
            LEFT JOIN provider_doctors doctor ON doctor.id = diagnosis.doctor_id
            WHERE diagnosis.patient_id = $1

            UNION ALL

            SELECT 'clinical'::text AS entity_type,
                   medication.id AS entity_id,
                   concat_ws(
                       ' · ',
                       COALESCE(medication.handelsname, medication.wirkstoff, 'Medication'),
                       medication.staerke,
                       medication.form
                   ) AS title,
                   'medication'::text AS category,
                   CASE
                       WHEN medication.superseded_at IS NOT NULL THEN 'superseded'
                       WHEN medication.on_hold THEN 'on_hold'
                       WHEN LOWER(COALESCE(medication.status, '')) IN ('aktiv', 'active') THEN 'active'
                       WHEN LOWER(COALESCE(medication.status, '')) IN ('abgesetzt', 'discontinued', 'stopped') THEN 'discontinued'
                       ELSE COALESCE(NULLIF(medication.status, ''), 'recorded')
                   END AS status,
                   medication.created_at AS happened_at,
                   concat_ws(' · ', provider.name, doctor.name) AS source_label
            FROM patient_medications medication
            LEFT JOIN providers provider ON provider.id = medication.provider_id
            LEFT JOIN provider_doctors doctor ON doctor.id = medication.doctor_id
            WHERE medication.patient_id = $1

            UNION ALL

            SELECT 'clinical'::text AS entity_type,
                   examination.id AS entity_id,
                   examination.title AS title,
                   'examination'::text AS category,
                   COALESCE(NULLIF(examination.status, ''), 'recorded') AS status,
                   examination.created_at AS happened_at,
                   concat_ws(' · ', provider.name, doctor.name) AS source_label
            FROM patient_examinations examination
            LEFT JOIN providers provider ON provider.id = examination.provider_id
            LEFT JOIN provider_doctors doctor ON doctor.id = examination.doctor_id
            WHERE examination.patient_id = $1

            UNION ALL

            SELECT 'clinical'::text AS entity_type,
                   procedure.id AS entity_id,
                   concat_ws(' · ', procedure.label, procedure.ops_code) AS title,
                   'procedure'::text AS category,
                   'recorded'::text AS status,
                   procedure.created_at AS happened_at,
                   concat_ws(' · ', provider.name, doctor.name) AS source_label
            FROM patient_procedures procedure
            LEFT JOIN providers provider ON provider.id = procedure.provider_id
            LEFT JOIN provider_doctors doctor ON doctor.id = procedure.doctor_id
            WHERE procedure.patient_id = $1

            UNION ALL

            SELECT 'clinical'::text AS entity_type,
                   warning.id AS entity_id,
                   concat_ws(' · ', warning.label, warning.reaction) AS title,
                   'allergy'::text AS category,
                   COALESCE(NULLIF(warning.severity, ''), 'active') AS status,
                   warning.created_at AS happened_at,
                   warning.kind AS source_label
            FROM patient_clinical_warnings warning
            WHERE warning.patient_id = $1

            UNION ALL

            SELECT 'clinical'::text AS entity_type,
                   narrative.id AS entity_id,
                   CASE
                       WHEN NULLIF(
                           COALESCE(
                               narrative.anamnese_aktuelle,
                               narrative.anamnese_vorgeschichte,
                               narrative.anamnese_vegetative,
                               narrative.anamnese_sozial
                           ),
                           ''
                       ) IS NULL THEN 'Anamnese'
                       ELSE concat(
                           'Anamnese: ',
                           left(
                               COALESCE(
                                   narrative.anamnese_aktuelle,
                                   narrative.anamnese_vorgeschichte,
                                   narrative.anamnese_vegetative,
                                   narrative.anamnese_sozial
                               ),
                               120
                           )
                       )
                   END AS title,
                   'anamnesis'::text AS category,
                   CASE WHEN narrative.is_active THEN 'active' ELSE 'inactive' END AS status,
                   COALESCE(narrative.anamnese_at, narrative.updated_at, narrative.created_at) AS happened_at,
                   NULL::text AS source_label
            FROM patient_clinical_narrative narrative
            WHERE narrative.patient_id = $1

            UNION ALL

            SELECT 'clinical'::text AS entity_type,
                   course.id AS entity_id,
                   CASE
                       WHEN length(course.note) > 120 THEN left(course.note, 117) || '...'
                       ELSE course.note
                   END AS title,
                   'course'::text AS category,
                   'recorded'::text AS status,
                   COALESCE(
                       course.occurred_on::timestamp AT TIME ZONE 'Europe/Berlin',
                       course.created_at
                   ) AS happened_at,
                   concat_ws(' · ', provider.name, doctor.name) AS source_label
            FROM patient_clinical_verlauf course
            LEFT JOIN providers provider ON provider.id = course.provider_id
            LEFT JOIN provider_doctors doctor ON doctor.id = course.doctor_id
            WHERE course.patient_id = $1

            UNION ALL

            SELECT 'clinical'::text AS entity_type,
                   symptom.id AS entity_id,
                   symptom.beschreibung AS title,
                   'symptom'::text AS category,
                   'recorded'::text AS status,
                   symptom.created_at AS happened_at,
                   concat_ws(' · ', legacy_case.case_id, symptom.fachrichtung) AS source_label
            FROM symptome symptom
            JOIN cases legacy_case ON legacy_case.id = symptom.case_id
            LEFT JOIN leads legacy_lead
                   ON legacy_lead.id = COALESCE(legacy_case.source_lead_id, legacy_case.lead_id)
            WHERE COALESCE(legacy_case.patient_id, legacy_lead.converted_patient_id) = $1

            UNION ALL

            SELECT 'vital'::text AS entity_type,
                   vital.id AS entity_id,
                   concat_ws(
                       ' · ',
                       CASE
                           WHEN vital.bp_systolic IS NOT NULL OR vital.bp_diastolic IS NOT NULL
                           THEN concat(
                               'BP ',
                               COALESCE(trim(to_char(vital.bp_systolic, 'FM999990.##')), '—'),
                               '/',
                               COALESCE(trim(to_char(vital.bp_diastolic, 'FM999990.##')), '—')
                           )
                       END,
                       CASE WHEN vital.heart_rate IS NOT NULL THEN concat('HR ', vital.heart_rate) END,
                       CASE WHEN vital.temperature_c IS NOT NULL THEN concat('Temp ', trim(to_char(vital.temperature_c, 'FM999990.##')), ' C') END,
                       CASE WHEN vital.oxygen_saturation IS NOT NULL THEN concat('SpO2 ', trim(to_char(vital.oxygen_saturation, 'FM999990.##')), '%') END,
                       CASE WHEN vital.respiratory_rate IS NOT NULL THEN concat('RR ', vital.respiratory_rate, '/min') END,
                       CASE WHEN vital.weight_kg IS NOT NULL THEN concat(trim(to_char(vital.weight_kg, 'FM999990.##')), ' kg') END,
                       CASE WHEN vital.height_cm IS NOT NULL THEN concat(trim(to_char(vital.height_cm, 'FM999990.##')), ' cm') END,
                       CASE WHEN vital.bmi IS NOT NULL THEN concat('BMI ', trim(to_char(vital.bmi, 'FM999990.##'))) END
                   ) AS title,
                   'clinical'::text AS category,
                   'recorded'::text AS status,
                   vital.measured_at AS happened_at,
                   recorder.name AS source_label
            FROM patient_vital_measurements vital
            LEFT JOIN users recorder ON recorder.id = vital.recorded_by
            WHERE vital.patient_id = $1
        "#;
    let events_cte = if can_view_clinical {
        let mut cte = events_cte_static.to_string();
        if let Some(pos) = cte.rfind(')') {
            cte.insert_str(pos, CLINICAL_TIMELINE_BRANCH);
        }
        cte
    } else {
        events_cte_static.to_string()
    };

    let payload_sql = format!(
        r#"{events_cte},
        filtered_events AS (
            SELECT entity_type, entity_id, title, category, status, happened_at, source_label
            FROM events
            {filter_clause}
        ),
        paged_events AS (
            SELECT entity_type, entity_id, title, category, status, happened_at, source_label
            FROM filtered_events
            ORDER BY happened_at DESC, entity_type, entity_id
            LIMIT $8 OFFSET $9
        ),
        entity_facets AS (
            SELECT entity_type AS value, COUNT(*) AS count
            FROM events
            WHERE ($3::text IS NULL OR category = $3)
              AND ($4::text IS NULL OR LOWER(COALESCE(source_label, '')) = LOWER($4))
              AND ($5::text = '%%'
                    OR title ILIKE $5
                    OR category ILIKE $5
                    OR status ILIKE $5
                    OR entity_type ILIKE $5
                    OR COALESCE(source_label, '') ILIKE $5)
              AND ($6::timestamptz IS NULL OR happened_at >= $6)
            GROUP BY entity_type
        ),
        category_facets AS (
            SELECT category AS value, COUNT(*) AS count
            FROM events
            WHERE ($2::text IS NULL OR entity_type = $2)
              AND ($4::text IS NULL OR LOWER(COALESCE(source_label, '')) = LOWER($4))
              AND ($5::text = '%%'
                    OR title ILIKE $5
                    OR category ILIKE $5
                    OR status ILIKE $5
                    OR entity_type ILIKE $5
                    OR COALESCE(source_label, '') ILIKE $5)
              AND ($6::timestamptz IS NULL OR happened_at >= $6)
            GROUP BY category
        ),
        source_facets AS (
            SELECT source_label AS value, COUNT(*) AS count
            FROM events
            WHERE source_label IS NOT NULL
              AND BTRIM(source_label) <> ''
              AND ($2::text IS NULL OR entity_type = $2)
              AND ($3::text IS NULL OR category = $3)
              AND ($5::text = '%%'
                    OR title ILIKE $5
                    OR category ILIKE $5
                    OR status ILIKE $5
                    OR entity_type ILIKE $5
                    OR COALESCE(source_label, '') ILIKE $5)
              AND ($6::timestamptz IS NULL OR happened_at >= $6)
            GROUP BY source_label
        )
        SELECT
            COALESCE(
                (
                    SELECT jsonb_agg(
                        jsonb_build_object(
                            'entity_type', entity_type,
                            'entity_id', entity_id,
                            'title', title,
                            'category', category,
                            'status', status,
                            'happened_at', happened_at,
                            'source_label', source_label
                        )
                        ORDER BY happened_at DESC, entity_type, entity_id
                    )
                    FROM paged_events
                ),
                '[]'::jsonb
            ) AS items,
            (SELECT COUNT(*) FROM filtered_events) AS total,
            (
                SELECT COUNT(*)
                FROM filtered_events
                WHERE CASE
                    WHEN entity_type IN (
                        'appointment', 'case', 'order', 'service', 'service_group',
                        'task', 'workflow_task', 'communication', 'reminder',
                        'recommendation', 'translation_request', 'medical_order'
                    ) THEN LOWER(COALESCE(status, '')) NOT IN (
                        'archived', 'cancelled', 'closed', 'completed', 'expired',
                        'invoiced', 'paid', 'rejected', 'revoked', 'signed', 'terminated'
                    )
                    WHEN entity_type = 'document' THEN LOWER(COALESCE(status, '')) = 'draft'
                    WHEN entity_type = 'contract' THEN LOWER(COALESCE(status, '')) IN ('draft', 'sent', 'pending')
                    WHEN entity_type = 'invoice' THEN LOWER(COALESCE(status, '')) IN ('draft', 'sent', 'overdue', 'partially_paid')
                    WHEN entity_type = 'quote' THEN LOWER(COALESCE(status, '')) IN ('draft', 'sent')
                    WHEN entity_type = 'service_package_consumption' THEN LOWER(COALESCE(status, '')) = 'pending'
                    WHEN entity_type = 'compliance' THEN LOWER(COALESCE(status, '')) IN ('open', 'in_progress')
                    ELSE false
                END
            ) AS open,
            (
                SELECT COUNT(*)
                FROM filtered_events
                WHERE happened_at >= now() - interval '30 days'
                  AND happened_at <= now()
            ) AS recent,
            COALESCE(
                (
                    SELECT jsonb_agg(
                        jsonb_build_object('entity_type', value, 'count', count)
                        ORDER BY count DESC, value
                    )
                    FROM entity_facets
                ),
                '[]'::jsonb
            ) AS entity_counts,
            COALESCE(
                (
                    SELECT jsonb_agg(
                        jsonb_build_object('value', value, 'count', count)
                        ORDER BY value
                    )
                    FROM category_facets
                ),
                '[]'::jsonb
            ) AS category_facets,
            COALESCE(
                (
                    SELECT jsonb_agg(
                        jsonb_build_object('value', value, 'count', count)
                        ORDER BY value
                    )
                    FROM source_facets
                ),
                '[]'::jsonb
            ) AS source_facets"#
    );
    let payload = sqlx::query(&payload_sql)
        .bind(patient_uuid)
        .bind(entity_type)
        .bind(category)
        .bind(source)
        .bind(&search_pattern)
        .bind(range_cutoff)
        .bind(can_view_financial)
        .bind(limit)
        .bind(offset)
        .fetch_one(&state.db)
        .await
        .map_err(|e| {
            tracing::error!(error = %e, patient_id = %patient_uuid, "Failed to load patient timeline");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to load patient timeline",
            )
        })?;

    let items = payload
        .try_get::<Value, _>("items")
        .unwrap_or_else(|_| serde_json::json!([]));
    let total = payload.try_get::<i64, _>("total").unwrap_or(0);
    let open = payload.try_get::<i64, _>("open").unwrap_or(0);
    let recent = payload.try_get::<i64, _>("recent").unwrap_or(0);
    let entity_counts = payload
        .try_get::<Value, _>("entity_counts")
        .unwrap_or_else(|_| serde_json::json!([]));
    let category_facets = payload
        .try_get::<Value, _>("category_facets")
        .unwrap_or_else(|_| serde_json::json!([]));
    let source_facets = payload
        .try_get::<Value, _>("source_facets")
        .unwrap_or_else(|_| serde_json::json!([]));
    let item_count = items.as_array().map_or(0, Vec::len) as i64;

    Ok(Json(serde_json::json!({
        "items": items,
        "total": total,
        "limit": limit,
        "offset": offset,
        "has_more": offset + item_count < total,
        "summary": {
            "total": total,
            "open": open,
            "recent": recent,
            "entity_counts": entity_counts,
        },
        "facets": {
            "categories": category_facets,
            "sources": source_facets,
        },
    })))
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

    let assignment_already_active = sqlx::query_scalar::<_, bool>(
        r#"SELECT EXISTS(
               SELECT 1
               FROM patient_assignments
               WHERE patient_id = $1
                 AND user_id = $2
                 AND revoked_at IS NULL
           )"#,
    )
    .bind(patient_uuid)
    .bind(body.user_id)
    .fetch_one(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, patient_id = %patient_uuid, user_id = %body.user_id, "Failed to inspect existing patient assignment");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to validate assignment target",
        )
    })?;

    let patient_context =
        load_patient_assignment_notification_context(&state, patient_uuid).await?;

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

    if !assignment_already_active {
        insert_patient_assignment_notification(
            &state,
            body.user_id,
            "patient_assignment",
            format!("New patient assignment: {}", patient_context.patient_name),
            format!(
                "You were assigned to patient {} ({}).",
                patient_context.patient_name, patient_context.patient_code
            ),
            patient_uuid,
        )
        .await?;
    }

    state.audit_sender.try_send(audit::domain_event(
        "assign_patient",
        Some(auth.user_id),
        "patient",
        Some(patient_uuid),
        serde_json::json!({
            "assigned_to": body.user_id,
            "assigned_role": target_role,
        }),
    ));

    tracing::info!(by = %auth.user_id, patient = %patient_uuid, to = %body.user_id, "Patient assigned");

    crate::realtime::publish_patient_event(
        &state,
        Some(auth.user_id),
        "patient.assigned",
        patient_uuid,
        serde_json::json!({ "assigned_user_id": body.user_id }),
    )
    .await;

    Ok(Json(serde_json::json!({"ok": true})))
}

#[allow(clippy::result_large_err)]
fn validate_relation_request(
    body: &UpsertRelationRequest,
    patient_id: Uuid,
) -> Result<(), axum::response::Response> {
    if let Err(message) = validate_relation_payload_fields(body) {
        return Err(err(StatusCode::UNPROCESSABLE_ENTITY, message));
    }

    if let Some(related_patient_id) = body.related_patient_id
        && related_patient_id == patient_id
    {
        return Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Patient relation cannot point to the same patient",
        ));
    }

    Ok(())
}

async fn ensure_related_patient_exists(
    state: &AppState,
    related_patient_id: Uuid,
) -> Result<(), axum::response::Response> {
    let exists = sqlx::query_scalar::<_, bool>("SELECT EXISTS(SELECT 1 FROM patients WHERE id = $1)")
    .bind(related_patient_id)
    .fetch_one(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, related_patient_id = %related_patient_id, "Failed to validate related patient");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to validate related patient",
        )
    })?;

    if exists {
        Ok(())
    } else {
        Err(err(StatusCode::NOT_FOUND, "Related patient not found"))
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
                tracing::error!(error = %e, patient_id = %patient_id, "Failed to validate patient");
                err(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Failed to validate patient",
                )
            })?;

    if !exists {
        return Err(err(StatusCode::NOT_FOUND, "Patient not found"));
    }

    if has_patient_access(state, auth, patient_id).await? {
        Ok(())
    } else {
        Err(err(StatusCode::FORBIDDEN, "Insufficient permissions"))
    }
}

fn build_relation_json(row: sqlx::postgres::PgRow) -> Value {
    let related_first = row
        .try_get::<Option<String>, _>("related_first_name")
        .unwrap_or_default();
    let related_last = row
        .try_get::<Option<String>, _>("related_last_name")
        .unwrap_or_default();
    let related_name = row.try_get::<String, _>("related_name").unwrap_or_default();
    let related_display_name = match (related_first, related_last) {
        (Some(first), Some(last)) if !first.is_empty() || !last.is_empty() => {
            format!("{first} {last}").trim().to_string()
        }
        (Some(first), None) if !first.is_empty() => first,
        (None, Some(last)) if !last.is_empty() => last,
        _ => related_name.clone(),
    };

    serde_json::json!({
        "id": row.try_get::<Uuid, _>("id").unwrap_or_else(|_| Uuid::nil()),
        "patient_id": row.try_get::<Uuid, _>("patient_id").unwrap_or_else(|_| Uuid::nil()),
        "related_patient_id": row.try_get::<Option<Uuid>, _>("related_patient_id").unwrap_or_default(),
        "related_patient_pid": row.try_get::<Option<String>, _>("related_patient_pid").unwrap_or_default(),
        "related_name": related_name,
        "related_display_name": related_display_name,
        "relation_type": row.try_get::<String, _>("relation_type").unwrap_or_default(),
        "is_emergency_contact": row.try_get::<bool, _>("is_emergency_contact").unwrap_or(false),
        "phone": row.try_get::<Option<String>, _>("phone").unwrap_or_default(),
        "notes": row.try_get::<Option<String>, _>("notes").unwrap_or_default(),
        "created_at": row.try_get::<chrono::DateTime<chrono::Utc>, _>("created_at").map(|value| value.to_rfc3339()).unwrap_or_default(),
    })
}

fn err(status: StatusCode, message: &str) -> axum::response::Response {
    (status, Json(serde_json::json!({ "error": status.canonical_reason().unwrap_or("error"), "message": message }))).into_response()
}

struct PatientAssignmentNotificationContext {
    patient_code: String,
    patient_name: String,
}

async fn load_patient_assignment_notification_context(
    state: &AppState,
    patient_id: Uuid,
) -> Result<PatientAssignmentNotificationContext, axum::response::Response> {
    let row = sqlx::query(
        r#"SELECT patient_id, first_name, last_name
           FROM patients
           WHERE id = $1"#,
    )
    .bind(patient_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, patient_id = %patient_id, "Failed to load patient assignment notification context");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to build patient assignment notification",
        )
    })?
    .ok_or_else(|| err(StatusCode::NOT_FOUND, "Patient not found"))?;

    let patient_code = row.try_get::<String, _>("patient_id").map_err(|_| {
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to build patient assignment notification",
        )
    })?;
    let first_name = row.try_get::<String, _>("first_name").map_err(|_| {
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to build patient assignment notification",
        )
    })?;
    let last_name = row.try_get::<String, _>("last_name").map_err(|_| {
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to build patient assignment notification",
        )
    })?;
    let patient_name = format!("{first_name} {last_name}").trim().to_string();

    Ok(PatientAssignmentNotificationContext {
        patient_code,
        patient_name,
    })
}

async fn insert_patient_assignment_notification(
    state: &AppState,
    user_id: Uuid,
    kind: &str,
    title: String,
    body: String,
    patient_id: Uuid,
) -> Result<(), axum::response::Response> {
    let notification_id = sqlx::query_scalar::<_, Uuid>(
        r#"INSERT INTO user_notifications (user_id, kind, title, body, entity_type, entity_id)
           VALUES ($1, $2, $3, $4, 'patient', $5)
           RETURNING id"#,
    )
    .bind(user_id)
    .bind(kind)
    .bind(title)
    .bind(body)
    .bind(patient_id)
    .fetch_one(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, user_id = %user_id, patient_id = %patient_id, "Failed to insert patient assignment notification");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to notify assigned user",
        )
    })?;

    crate::realtime::publish_notification_event(
        state,
        user_id,
        "notification.created",
        Some(notification_id),
        serde_json::json!({ "entity_type": "patient", "entity_id": patient_id }),
    )
    .await;

    Ok(())
}

fn can_manage_assignment(role: Role) -> bool {
    if role.has_full_access() {
        return true;
    }

    matches!(role, Role::PatientManager | Role::TeamleadInterpreter)
}

fn assignment_allowed(assigner_role: Role, target_role: &str) -> bool {
    if assigner_role.has_full_access() {
        return matches!(
            target_role,
            "patient_manager" | "teamlead_interpreter" | "interpreter" | "concierge"
        );
    }

    match assigner_role {
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
    if auth.role.has_full_access() {
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
    if auth.role.has_full_access() || auth.role == Role::PatientManager {
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
    functional_labels: Vec<String>,
    phone_primary: Option<String>,
    email: Option<String>,
    insurance_provider: Option<String>,
    insurance_type: Option<String>,
    is_active: bool,
    lifecycle_status: String,
    account_balance: Option<String>,
    account_balance_currency: Option<String>,
    account_balance_side: Option<String>,
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
    functional_labels: Vec<String>,
    phone_primary: Option<String>,
    phone_secondary: Option<String>,
    email: Option<String>,
    contacts: Vec<PatientContactInput>,
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
    passport_number: Option<String>,
    passport_expiry: Option<chrono::NaiveDate>,
    intake_profile: serde_json::Value,
    source_lead_id: Option<Uuid>,
    lead_snapshot: serde_json::Value,
    legal_status: serde_json::Value,
    clinical_warnings: Option<String>,
    notes: Option<String>,
    is_active: bool,
    lifecycle_status: String,
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
        "lifecycle_status".to_string(),
        Value::String(patient.lifecycle_status),
    );
    data.insert(
        "created_at".to_string(),
        Value::String(patient.created_at.to_rfc3339()),
    );
    if let Some(account_balance) = patient.account_balance {
        data.insert(
            "account_balance".to_string(),
            Value::String(account_balance),
        );
    }
    if let Some(account_balance_currency) = patient.account_balance_currency {
        data.insert(
            "account_balance_currency".to_string(),
            Value::String(account_balance_currency),
        );
    }
    if let Some(account_balance_side) = patient.account_balance_side {
        data.insert(
            "account_balance_side".to_string(),
            Value::String(account_balance_side),
        );
    }

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
    insert_functional_labels_field(&mut data, auth, policies, patient.functional_labels);
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
            functional_labels: patient.functional_labels.clone(),
            phone_primary: patient.phone_primary.clone(),
            email: patient.email.clone(),
            insurance_provider: patient.insurance_provider.clone(),
            insurance_type: patient.insurance_type.clone(),
            is_active: patient.is_active,
            lifecycle_status: patient.lifecycle_status.clone(),
            account_balance: None,
            account_balance_currency: None,
            account_balance_side: None,
            created_at: patient.created_at,
        },
    );

    if let Value::Object(ref mut map) = data {
        map.insert(
            "updated_at".to_string(),
            Value::String(patient.updated_at.to_rfc3339()),
        );

        if auth.role.has_full_access() || auth.role == Role::PatientManager {
            insert_optional_string(map, "address_street", patient.address_street);
            insert_optional_string(map, "address_city", patient.address_city);
            insert_optional_string(map, "address_zip", patient.address_zip);
            insert_optional_string(map, "address_country", patient.address_country);
            insert_optional_string(map, "passport_number", patient.passport_number);
            {
                let (status, days) = passport_compliance_status(
                    patient.passport_expiry,
                    chrono::Utc::now().date_naive(),
                );
                map.insert(
                    "passport_expiry".to_string(),
                    patient
                        .passport_expiry
                        .map(|expiry| Value::String(expiry.to_string()))
                        .unwrap_or(Value::Null),
                );
                map.insert(
                    "passport_status".to_string(),
                    Value::String(status.to_string()),
                );
                map.insert(
                    "passport_expired".to_string(),
                    Value::Bool(status == "expired"),
                );
                map.insert(
                    "passport_expiring".to_string(),
                    Value::Bool(status == "expiring"),
                );
                map.insert(
                    "passport_days_until_expiry".to_string(),
                    days.map(Value::from).unwrap_or(Value::Null),
                );
            }
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
            map.insert("intake_profile".to_string(), patient.intake_profile);
            map.insert(
                "source_lead_id".to_string(),
                patient
                    .source_lead_id
                    .map(|value| Value::String(value.to_string()))
                    .unwrap_or(Value::Null),
            );
            map.insert("lead_snapshot".to_string(), patient.lead_snapshot);
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
            insert_patient_contacts_field(map, auth, policies, patient.contacts);
        }

        insert_clinical_warnings_field(map, auth, policies, patient.clinical_warnings);
    }

    data
}

fn collect_visible_fields(value: &Value) -> Vec<String> {
    let Value::Object(map) = value else {
        return Vec::new();
    };

    let mut fields = map.keys().cloned().collect::<Vec<_>>();
    fields.sort();
    fields
}

fn insert_name_fields(
    data: &mut Map<String, Value>,
    auth: &AuthUser,
    policies: &HashMap<String, FieldPolicy>,
    title: Option<String>,
    first_name: String,
    last_name: String,
) {
    match field_access(policies, "name", auth.role.has_full_access()) {
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
    match field_access(policies, "birth_date", auth.role.has_full_access()) {
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
    match field_access(policies, "phone", auth.role.has_full_access()) {
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
    match field_access(policies, "email", auth.role.has_full_access()) {
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

fn insert_patient_contacts_field(
    data: &mut Map<String, Value>,
    auth: &AuthUser,
    policies: &HashMap<String, FieldPolicy>,
    contacts: Vec<PatientContactInput>,
) {
    let mut values = Vec::new();
    for contact in contacts {
        let field_name = if contact.contact_kind == "email" {
            "email"
        } else {
            "phone"
        };
        let Some(access) = field_access(policies, field_name, auth.role.has_full_access()) else {
            continue;
        };
        let value = match access {
            FieldAccess::Visible => contact.value,
            FieldAccess::Masked => {
                if contact.contact_kind == "email" {
                    access::mask_email(&contact.value)
                } else {
                    access::mask_phone(&contact.value)
                }
            }
            FieldAccess::Hidden => continue,
        };
        values.push(json!({
            "id": contact.id,
            "contact_kind": contact.contact_kind,
            "contact_type": contact.contact_type,
            "value": value,
            "is_primary": contact.is_primary,
            "notes": contact.notes,
        }));
    }
    data.insert("contacts".to_string(), Value::Array(values));
}

fn insert_nationality_fields(
    data: &mut Map<String, Value>,
    auth: &AuthUser,
    policies: &HashMap<String, FieldPolicy>,
    nationality: Option<String>,
    residence_country: Option<String>,
) {
    match field_access(policies, "nationality", auth.role.has_full_access()) {
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
    match field_access(policies, "languages", auth.role.has_full_access()) {
        Some(FieldAccess::Visible) | Some(FieldAccess::Masked) => {
            data.insert(
                "languages".to_string(),
                Value::Array(languages.into_iter().map(Value::String).collect()),
            );
        }
        Some(FieldAccess::Hidden) | None => {}
    }
}

fn insert_functional_labels_field(
    data: &mut Map<String, Value>,
    auth: &AuthUser,
    policies: &HashMap<String, FieldPolicy>,
    functional_labels: Vec<String>,
) {
    match field_access(policies, "functional_labels", auth.role.has_full_access()) {
        Some(FieldAccess::Visible) | Some(FieldAccess::Masked) => {
            data.insert(
                "functional_labels".to_string(),
                Value::Array(functional_labels.into_iter().map(Value::String).collect()),
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
    match field_access(policies, "insurance", auth.role.has_full_access()) {
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

fn insert_clinical_warnings_field(
    data: &mut Map<String, Value>,
    auth: &AuthUser,
    policies: &HashMap<String, FieldPolicy>,
    clinical_warnings: Option<String>,
) {
    match field_access(policies, "vitals", auth.role.has_full_access()) {
        Some(FieldAccess::Visible) => {
            insert_optional_string(data, "clinical_warnings", clinical_warnings)
        }
        Some(FieldAccess::Masked) => {
            if let Some(value) = clinical_warnings {
                data.insert(
                    "clinical_warnings".to_string(),
                    Value::String(mask_text(&value)),
                );
            }
        }
        Some(FieldAccess::Hidden) | None => {}
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

#[allow(clippy::result_large_err)]
fn normalize_functional_labels(
    value: Option<Vec<String>>,
) -> Result<Option<Vec<String>>, axum::response::Response> {
    let Some(values) = value else {
        return Ok(None);
    };

    let mut normalized = Vec::new();
    for raw in values {
        let label = raw.trim().to_lowercase().replace([' ', '-'], "_");
        if label.is_empty() {
            continue;
        }
        if !ALLOWED_PATIENT_FUNCTIONAL_LABELS.contains(&label.as_str()) {
            return Err(err(
                StatusCode::UNPROCESSABLE_ENTITY,
                "Invalid functional label",
            ));
        }
        if !normalized.iter().any(|existing| existing == &label) {
            normalized.push(label);
        }
    }

    Ok(Some(normalized))
}

#[derive(Deserialize)]
struct RevokeRequest {
    user_id: Uuid,
}

async fn revoke_assignment(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(patient_id): Path<Uuid>,
    Json(body): Json<RevokeRequest>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::PatientManager]) {
        return e;
    }
    let patient_context =
        match load_patient_assignment_notification_context(&state, patient_id).await {
            Ok(context) => context,
            Err(response) => return response,
        };
    match sqlx::query!(
        "UPDATE patient_assignments SET revoked_at = now() WHERE patient_id = $1 AND user_id = $2 AND revoked_at IS NULL",
        patient_id, body.user_id
    )
    .execute(&state.db)
    .await
    {
        Ok(r) if r.rows_affected() > 0 => {
            if let Err(response) = insert_patient_assignment_notification(
                &state,
                body.user_id,
                "patient_assignment_revoked",
                format!("Patient assignment revoked: {}", patient_context.patient_name),
                format!(
                    "Your access to patient {} ({}) was revoked.",
                    patient_context.patient_name, patient_context.patient_code
                ),
                patient_id,
            )
            .await
            {
                return response;
            }
            state.audit_sender.try_send(audit::domain_event(
                "revoke_assignment",
                Some(auth.user_id),
                "patient",
                Some(patient_id),
                serde_json::json!({ "revoked_user_id": body.user_id }),
            ));
            tracing::info!(by = %auth.user_id, patient = %patient_id, revoked = %body.user_id, "Assignment revoked");
            crate::realtime::publish_patient_event_with_targets(
                &state,
                Some(auth.user_id),
                "patient.assignment_revoked",
                patient_id,
                vec![body.user_id],
                serde_json::json!({ "revoked_user_id": body.user_id }),
            )
            .await;
            Json(serde_json::json!({"ok": true})).into_response()
        }
        Ok(_) => err(StatusCode::NOT_FOUND, "Assignment not found or already revoked"),
        Err(e) => {
            tracing::error!(error = %e, "Failed to revoke assignment");
            err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to revoke assignment")
        }
    }
}

async fn activate_patient(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(patient_id): Path<Uuid>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::PatientManager]) {
        return e;
    }
    match sqlx::query(
        r#"UPDATE patients
           SET lifecycle_status = 'active', is_active = true, updated_at = now()
           WHERE id = $1 AND lifecycle_status = 'inactive'"#,
    )
    .bind(patient_id)
    .execute(&state.db)
    .await
    {
        Ok(r) if r.rows_affected() > 0 => {
            state.audit_sender.try_send(audit::domain_event(
                "activate_patient",
                Some(auth.user_id),
                "patient",
                Some(patient_id),
                serde_json::json!({}),
            ));
            tracing::info!(by = %auth.user_id, patient = %patient_id, "Patient activated");
            crate::realtime::publish_patient_event(
                &state,
                Some(auth.user_id),
                "patient.activated",
                patient_id,
                serde_json::json!({}),
            )
            .await;
            Json(serde_json::json!({"ok": true})).into_response()
        }
        Ok(_) => {
            let lifecycle: Option<String> =
                sqlx::query_scalar("SELECT lifecycle_status FROM patients WHERE id = $1")
                    .bind(patient_id)
                    .fetch_optional(&state.db)
                    .await
                    .unwrap_or_default();
            match lifecycle.as_deref() {
                Some("prospective") => err(
                    StatusCode::CONFLICT,
                    "Prospective patients are activated through lead conversion",
                ),
                Some(_) => err(StatusCode::NOT_FOUND, "Patient not found or already active"),
                None => err(StatusCode::NOT_FOUND, "Patient not found or already active"),
            }
        }
        Err(e) => {
            tracing::error!(error = %e, "Failed to activate patient");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to activate patient",
            )
        }
    }
}

async fn deactivate_patient(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(patient_id): Path<Uuid>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::PatientManager]) {
        return e;
    }
    match sqlx::query(
        r#"UPDATE patients
           SET lifecycle_status = 'inactive', is_active = false, updated_at = now()
           WHERE id = $1 AND lifecycle_status = 'active'"#,
    )
    .bind(patient_id)
    .execute(&state.db)
    .await
    {
        Ok(r) if r.rows_affected() > 0 => {
            state.audit_sender.try_send(audit::domain_event(
                "deactivate_patient",
                Some(auth.user_id),
                "patient",
                Some(patient_id),
                serde_json::json!({}),
            ));
            tracing::info!(by = %auth.user_id, patient = %patient_id, "Patient deactivated");
            crate::realtime::publish_patient_event(
                &state,
                Some(auth.user_id),
                "patient.deactivated",
                patient_id,
                serde_json::json!({}),
            )
            .await;
            Json(serde_json::json!({"ok": true})).into_response()
        }
        Ok(_) => {
            let lifecycle: Option<String> =
                sqlx::query_scalar("SELECT lifecycle_status FROM patients WHERE id = $1")
                    .bind(patient_id)
                    .fetch_optional(&state.db)
                    .await
                    .unwrap_or_default();
            match lifecycle.as_deref() {
                Some("prospective") => err(
                    StatusCode::CONFLICT,
                    "Prospective patients follow the lead lifecycle",
                ),
                Some(_) => err(
                    StatusCode::NOT_FOUND,
                    "Patient not found or already inactive",
                ),
                None => err(
                    StatusCode::NOT_FOUND,
                    "Patient not found or already inactive",
                ),
            }
        }
        Err(e) => {
            tracing::error!(error = %e, "Failed to deactivate patient");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to deactivate patient",
            )
        }
    }
}

async fn delete_patient(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(patient_id): Path<Uuid>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::Ceo]) {
        return e;
    }

    let exists =
        sqlx::query_scalar::<_, bool>("SELECT EXISTS(SELECT 1 FROM patients WHERE id = $1)")
            .bind(patient_id)
            .fetch_one(&state.db)
            .await;

    match exists {
        Ok(true) => err(
            StatusCode::CONFLICT,
            "Direct patient deletion is disabled. Use the DSGVO compliance workflow.",
        ),
        Ok(false) => err(StatusCode::NOT_FOUND, "Patient not found"),
        Err(e) => {
            tracing::error!(error = %e, "Failed to validate patient deletion");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to validate patient deletion",
            )
        }
    }
}

// ---------------------------------------------------------------------------
// Patient-level clinical master record (diagnoses / medications / examinations).
// Independent of case episodes; replace-all save per section, like the case
// clinical sections. Each entry is attributed to the issuing provider + doctor.
// See migration 20260604100000_patient_clinical_master.sql.
// ---------------------------------------------------------------------------

// The first-release workspace exposes patient clinical data to the CEO only.
// Add future clinical roles here only when their workspace is enabled globally.
const PATIENT_CLINICAL_ROLES: &[Role] = &[Role::Ceo];

#[derive(Deserialize)]
struct PatientClinicalItems<T> {
    items: Vec<T>,
}

#[derive(Default, Deserialize)]
struct PatientClinicalSaveQuery {
    mode: Option<String>,
}

impl PatientClinicalSaveQuery {
    fn merge_only(&self) -> bool {
        self.mode.as_deref() == Some("merge")
    }
}

#[derive(Deserialize)]
struct PatientDiagnosisInput {
    #[serde(default)]
    id: Option<String>,
    #[serde(default)]
    cid: Option<String>,
    #[serde(default)]
    case_id: Option<String>,
    #[serde(default)]
    parent_cid: Option<String>,
    #[serde(default)]
    provider_id: Option<String>,
    #[serde(default)]
    doctor_id: Option<String>,
    #[serde(default)]
    kind: Option<String>,
    #[serde(default)]
    label: Option<String>,
    #[serde(default)]
    specialization_ids: Vec<String>,
    #[serde(default)]
    icd_code: Option<String>,
    #[serde(default)]
    ops_code: Option<String>,
    #[serde(default)]
    certainty: Option<String>,
    #[serde(default)]
    chronifizierung: Option<String>,
    #[serde(default)]
    grade: Option<String>,
    #[serde(default)]
    laterality: Option<String>,
    #[serde(default)]
    status: Option<String>,
    #[serde(default)]
    diagnosed_on: Option<String>,
    #[serde(default)]
    note: Option<String>,
    #[serde(default)]
    red_flags: Option<String>,
    #[serde(default)]
    source_mode: Option<String>,
    #[serde(default)]
    external_clinic: Option<String>,
    #[serde(default)]
    external_doctor: Option<String>,
    #[serde(default)]
    external_country: Option<String>,
    #[serde(default)]
    treating_doctor_id: Option<String>,
    #[serde(default)]
    treating_none: Option<bool>,
}

#[derive(Deserialize)]
struct PatientMedicationInput {
    #[serde(default)]
    id: Option<String>,
    #[serde(default)]
    provider_id: Option<String>,
    #[serde(default)]
    doctor_id: Option<String>,
    #[serde(default)]
    category: Option<String>,
    #[serde(default)]
    wirkstoff: Option<String>,
    #[serde(default)]
    handelsname: Option<String>,
    #[serde(default)]
    staerke: Option<String>,
    #[serde(default)]
    form: Option<String>,
    #[serde(default)]
    dose_morgens: Option<String>,
    #[serde(default)]
    dose_mittags: Option<String>,
    #[serde(default)]
    dose_abends: Option<String>,
    #[serde(default)]
    dose_nachts: Option<String>,
    #[serde(default)]
    einheit: Option<String>,
    #[serde(default)]
    hinweis: Option<String>,
    #[serde(default)]
    grund: Option<String>,
    #[serde(default)]
    einnahmeform: Option<String>,
    #[serde(default)]
    verordnet_am: Option<String>,
    #[serde(default)]
    einnahme_von: Option<String>,
    #[serde(default)]
    einnahme_bis: Option<String>,
    #[serde(default)]
    status: Option<String>,
    #[serde(default)]
    apothekenpflichtig: Option<bool>,
    #[serde(default)]
    rezeptpflichtig: Option<bool>,
    #[serde(default)]
    btm: Option<bool>,
    #[serde(default)]
    aut_idem_sperre: Option<bool>,
    #[serde(default)]
    abgabebeschraenkung: Option<bool>,
    #[serde(default)]
    sonstige_vermerke: Option<String>,
    #[serde(default)]
    on_hold: Option<bool>,
    #[serde(default)]
    hold_from: Option<String>,
    #[serde(default)]
    hold_until: Option<String>,
    #[serde(default)]
    hold_note: Option<String>,
}

#[derive(Deserialize)]
struct PatientExaminationInput {
    #[serde(default)]
    id: Option<String>,
    #[serde(default)]
    case_id: Option<String>,
    #[serde(default)]
    provider_id: Option<String>,
    #[serde(default)]
    doctor_id: Option<String>,
    #[serde(default)]
    kind: Option<String>,
    #[serde(default)]
    title: Option<String>,
    #[serde(default)]
    performed_on: Option<String>,
    #[serde(default)]
    status: Option<String>,
    #[serde(default)]
    result: Option<String>,
    #[serde(default)]
    note: Option<String>,
    #[serde(default)]
    red_flags: Option<String>,
    #[serde(default)]
    specialization_ids: Vec<String>,
}

/// Max characters stored per clinical text field. Generous enough that realistic
/// clinical text is never truncated, but bounds accidental or abusive payloads.
const CLINICAL_TEXT_MAX_CHARS: usize = 16_000;

/// Trim a value, drop empties to NULL, and cap length to guard against bloat.
fn clinical_opt_text(value: Option<String>) -> Option<String> {
    value
        .map(|v| {
            v.trim()
                .chars()
                .take(CLINICAL_TEXT_MAX_CHARS)
                .collect::<String>()
        })
        .filter(|v| !v.is_empty())
}

/// Normalize a constrained value to one of `allowed` (lower-cased), else None.
fn clinical_one_of(value: Option<String>, allowed: &[&str]) -> Option<String> {
    value
        .map(|v| v.trim().to_lowercase())
        .filter(|v| allowed.contains(&v.as_str()))
}

/// Parse an optional UUID string. Empty → `None`, but a non-empty malformed
/// value is a client error (422) rather than a silent drop.
#[allow(clippy::result_large_err)]
fn clinical_parse_uuid(value: Option<String>) -> Result<Option<Uuid>, axum::response::Response> {
    match value
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
    {
        None => Ok(None),
        Some(v) => Uuid::parse_str(&v)
            .map(Some)
            .map_err(|_| err(StatusCode::UNPROCESSABLE_ENTITY, "Invalid attribution id")),
    }
}

#[allow(clippy::result_large_err)]
fn clinical_parse_date(
    value: Option<String>,
    field_name: &str,
) -> Result<Option<chrono::NaiveDate>, axum::response::Response> {
    match clinical_opt_text(value) {
        None => Ok(None),
        Some(raw) => match chrono::NaiveDate::parse_from_str(&raw, "%Y-%m-%d") {
            Ok(parsed) if parsed.format("%Y-%m-%d").to_string() == raw => Ok(Some(parsed)),
            _ => Err(err(
                StatusCode::UNPROCESSABLE_ENTITY,
                &format!("{field_name} must be YYYY-MM-DD"),
            )),
        },
    }
}

#[allow(clippy::result_large_err)]
async fn clinical_specialization_ids(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    raw_ids: &[String],
) -> Result<Vec<Uuid>, axum::response::Response> {
    let mut ids = Vec::new();
    let mut seen = HashSet::new();
    for raw_id in raw_ids {
        let id = Uuid::parse_str(raw_id.trim()).map_err(|_| {
            err(
                StatusCode::UNPROCESSABLE_ENTITY,
                "Invalid medical specialization id",
            )
        })?;
        if seen.insert(id) {
            ids.push(id);
        }
    }
    if ids.is_empty() {
        return Ok(ids);
    }
    let count = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM medical_specializations
         WHERE id = ANY($1) AND deleted_at IS NULL",
    )
    .bind(&ids)
    .fetch_one(&mut **tx)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, "validate clinical specializations");
        err(StatusCode::INTERNAL_SERVER_ERROR, "Failed")
    })?;
    if count != ids.len() as i64 {
        return Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Medical specialization not found",
        ));
    }
    Ok(ids)
}

/// Serialize one `patient_clinical_narrative` version row to API JSON. The row
/// must have been selected with: id, the 5 anamnese/beurteilung text fields,
/// anamnese_at, is_active, created_at and updated_at. `untersuchungsbefund` and legacy
/// `verlauf` are no longer part of the contract (columns are kept in the DB but
/// unused).
fn narrative_version_json(row: &sqlx::postgres::PgRow) -> serde_json::Value {
    json!({
        "id": row.get::<Uuid, _>("id").to_string(),
        "case_id": row.try_get::<Option<Uuid>, _>("case_id").unwrap_or_default(),
        "anamnese_aktuelle": row.get::<Option<String>, _>("anamnese_aktuelle"),
        "anamnese_vorgeschichte": row.get::<Option<String>, _>("anamnese_vorgeschichte"),
        "anamnese_vegetative": row.get::<Option<String>, _>("anamnese_vegetative"),
        "anamnese_sozial": row.get::<Option<String>, _>("anamnese_sozial"),
        "beurteilung": row.get::<Option<String>, _>("beurteilung"),
        "red_flags": row.get::<Option<String>, _>("red_flags"),
        "source_document_id": row.try_get::<Option<Uuid>, _>("source_document_id").unwrap_or_default(),
        "source_document_name": row.try_get::<Option<String>, _>("source_document_name").unwrap_or_default(),
        "source_import_id": row.try_get::<Option<Uuid>, _>("source_import_id").unwrap_or_default(),
        "specialization_ids": row.get::<Vec<Uuid>, _>("specialization_ids"),
        "specializations": row.get::<serde_json::Value, _>("specializations"),
        "anamnese_at": row.get::<chrono::DateTime<chrono::Utc>, _>("anamnese_at").to_rfc3339(),
        "is_active": row.get::<bool, _>("is_active"),
        "created_at": row.get::<chrono::DateTime<chrono::Utc>, _>("created_at").to_rfc3339(),
        "updated_at": row.get::<chrono::DateTime<chrono::Utc>, _>("updated_at").to_rfc3339(),
    })
}

fn verlauf_row_json(row: &sqlx::postgres::PgRow) -> serde_json::Value {
    json!({
        "id": row.get::<Uuid, _>("id"),
        "case_id": row.try_get::<Option<Uuid>, _>("case_id").unwrap_or_default(),
        "provider_id": row.get::<Option<Uuid>, _>("provider_id"),
        "provider_name": row.get::<Option<String>, _>("provider_name"),
        "doctor_id": row.get::<Option<Uuid>, _>("doctor_id"),
        "doctor_name": row.get::<Option<String>, _>("doctor_name"),
        "doctor_title": row.get::<Option<String>, _>("doctor_title"),
        "doctor_fachbereich": row.get::<Option<String>, _>("doctor_fachbereich"),
        "source_document_id": row.get::<Option<Uuid>, _>("source_document_id"),
        "source_document_name": row.get::<Option<String>, _>("source_document_name"),
        "source_import_id": row.get::<Option<Uuid>, _>("source_import_id"),
        "source_candidate_id": row.get::<Option<String>, _>("source_candidate_id"),
        "source_page": row.get::<Option<i32>, _>("source_page"),
        "occurred_on": row.get::<Option<chrono::NaiveDate>, _>("occurred_on").map(|value| value.to_string()),
        "note": row.get::<String, _>("note"),
    })
}

/// Resolve and validate a provider/doctor attribution pair against the DB.
/// Returns 422 when a non-empty id is malformed, references a missing provider
/// or doctor, or when the doctor does not belong to the selected provider — so
/// a record can never be persisted with dangling or mismatched attribution
/// (which previously surfaced as an opaque 500 from the FK, or a silent NULL).
async fn clinical_resolve_attribution(
    state: &AppState,
    provider_raw: Option<String>,
    doctor_raw: Option<String>,
) -> Result<(Option<Uuid>, Option<Uuid>), axum::response::Response> {
    let provider_id = clinical_parse_uuid(provider_raw)?;
    let doctor_id = clinical_parse_uuid(doctor_raw)?;

    let attribution_fail = || {
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to validate attribution",
        )
    };

    if let Some(pid) = provider_id {
        let row = sqlx::query("SELECT provider_type, name FROM providers WHERE id = $1")
            .bind(pid)
            .fetch_optional(&state.db)
            .await
            .map_err(|e| {
                tracing::error!(error = %e, provider_id = %pid, "validate clinical provider");
                attribution_fail()
            })?;
        let Some(row) = row else {
            return Err(err(StatusCode::UNPROCESSABLE_ENTITY, "Unknown provider"));
        };
        let provider_type: String = row.try_get("provider_type").map_err(|e| {
            tracing::error!(error = %e, provider_id = %pid, "read clinical provider type");
            attribution_fail()
        })?;
        if provider_type != "medical" {
            let name: String = row.try_get("name").unwrap_or_default();
            return Err(err(
                StatusCode::UNPROCESSABLE_ENTITY,
                &format!(
                    "Clinical attribution requires a medical provider — \"{name}\" is {provider_type}"
                ),
            ));
        }
    }

    if let Some(did) = doctor_id {
        let doc_row = sqlx::query(
            r#"SELECT p.provider_type, d.name AS doctor_name, p.name AS provider_name
                   FROM provider_doctors d
                   JOIN providers p ON p.id = d.provider_id
                   WHERE d.id = $1"#,
        )
        .bind(did)
        .fetch_optional(&state.db)
        .await
        .map_err(|e| {
            tracing::error!(error = %e, doctor_id = %did, "validate clinical doctor");
            attribution_fail()
        })?;
        let Some(doc_row) = doc_row else {
            return Err(err(StatusCode::UNPROCESSABLE_ENTITY, "Unknown doctor"));
        };
        let doc_provider_type: String = doc_row.try_get("provider_type").map_err(|e| {
            tracing::error!(error = %e, doctor_id = %did, "read clinical doctor provider type");
            attribution_fail()
        })?;
        if doc_provider_type != "medical" {
            let doctor_name: String = doc_row.try_get("doctor_name").unwrap_or_default();
            let provider_name: String = doc_row.try_get("provider_name").unwrap_or_default();
            return Err(err(
                StatusCode::UNPROCESSABLE_ENTITY,
                &format!(
                    "Clinical attribution requires a medical provider — Dr. \"{doctor_name}\" belongs to {doc_provider_type} provider \"{provider_name}\""
                ),
            ));
        }
        if let Some(pid) = provider_id {
            let linked = sqlx::query_scalar::<_, bool>(
                r#"SELECT EXISTS(
                    SELECT 1
                    FROM provider_doctor_links
                    WHERE provider_id = $1
                      AND doctor_id = $2
                )"#,
            )
            .bind(pid)
            .bind(did)
            .fetch_one(&state.db)
            .await
            .map_err(|e| {
                tracing::error!(error = %e, provider_id = %pid, doctor_id = %did, "validate clinical doctor link");
                attribution_fail()
            })?;
            if !linked {
                return Err(err(
                    StatusCode::UNPROCESSABLE_ENTITY,
                    "Doctor does not belong to the selected provider",
                ));
            }
        }
    }

    Ok((provider_id, doctor_id))
}

async fn clinical_resolve_treating_doctor(
    state: &AppState,
    doctor_raw: Option<String>,
) -> Result<Option<Uuid>, axum::response::Response> {
    let doctor_id = clinical_parse_uuid(doctor_raw)?;
    let Some(did) = doctor_id else {
        return Ok(None);
    };

    let row = sqlx::query(
        r#"SELECT p.provider_type, d.name AS doctor_name, p.name AS provider_name
           FROM provider_doctors d
           JOIN providers p ON p.id = d.provider_id
           WHERE d.id = $1"#,
    )
    .bind(did)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, doctor_id = %did, "validate treating doctor");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to validate treating doctor",
        )
    })?;

    let Some(row) = row else {
        return Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Unknown treating doctor",
        ));
    };
    let provider_type: String = row.try_get("provider_type").map_err(|e| {
        tracing::error!(error = %e, doctor_id = %did, "read treating doctor provider type");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to validate treating doctor",
        )
    })?;
    if provider_type != "medical" {
        let doctor_name: String = row.try_get("doctor_name").unwrap_or_default();
        let provider_name: String = row.try_get("provider_name").unwrap_or_default();
        return Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            &format!(
                "Treating doctor must belong to a medical provider — Dr. \"{doctor_name}\" belongs to {provider_type} provider \"{provider_name}\""
            ),
        ));
    }

    Ok(Some(did))
}

async fn get_patient_clinical(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(patient_uuid): Path<Uuid>,
) -> impl IntoResponse {
    auth.require_any_role(PATIENT_CLINICAL_ROLES)?;

    if !has_patient_access(&state, &auth, patient_uuid).await? {
        return Err(err(StatusCode::FORBIDDEN, "Insufficient permissions"));
    }

    let load_fail = || {
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to load clinical profile",
        )
    };

    let diag_rows = sqlx::query(
        r#"SELECT d.id, d.case_id, d.parent_id, d.kind, d.label, d.icd_code, d.ops_code, d.grade, d.laterality,
                  d.status, d.certainty, d.chronifizierung, d.diagnosed_on, d.note, d.red_flags,
                  d.source_mode, d.external_clinic, d.external_doctor, d.external_country,
                  d.source_document_id, d.source_import_id, d.source_candidate_id,
                  COALESCE(dd.original_filename, dd.auto_name) AS source_document_name,
                  d.provider_id, p.name AS provider_name,
                  d.doctor_id, dr.name AS doctor_name, dr.title AS doctor_title, dr.fachbereich AS doctor_fachbereich,
                  d.treating_doctor_id, d.treating_none, td.name AS treating_doctor_name,
                  td.title AS treating_doctor_title, td.fachbereich AS treating_doctor_fachbereich,
                  COALESCE(ds.specialization_ids, ARRAY[]::uuid[]) AS specialization_ids,
                  COALESCE(ds.specializations, '[]'::jsonb) AS specializations
           FROM patient_diagnoses d
           LEFT JOIN providers p ON p.id = d.provider_id
           LEFT JOIN provider_doctors dr ON dr.id = d.doctor_id
           LEFT JOIN provider_doctors td ON td.id = d.treating_doctor_id
           LEFT JOIN documents dd ON dd.id = d.source_document_id
           LEFT JOIN LATERAL (
               SELECT array_agg(ms.id ORDER BY pds.sort_order) AS specialization_ids,
                      jsonb_agg(
                          jsonb_build_object(
                              'id', ms.id,
                              'code', ms.code,
                              'name_en', ms.name_en,
                              'name_de', ms.name_de,
                              'name_ru', ms.name_ru,
                              'is_active', ms.is_active,
                              'sort_order', ms.sort_order
                          ) ORDER BY pds.sort_order
                      ) AS specializations
               FROM patient_diagnosis_specializations pds
               JOIN medical_specializations ms ON ms.id = pds.specialization_id
               WHERE pds.diagnosis_id = d.id
           ) ds ON TRUE
           WHERE d.patient_id = $1
           ORDER BY d.sort_order, d.created_at"#,
    )
    .bind(patient_uuid)
    .fetch_all(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, patient_id = %patient_uuid, "load patient diagnoses");
        load_fail()
    })?;

    let med_rows = sqlx::query(
        r#"SELECT m.id, m.category, m.wirkstoff, m.handelsname, m.staerke, m.form,
                  m.dose_morgens, m.dose_mittags, m.dose_abends, m.dose_nachts,
                  m.einheit, m.hinweis, m.grund,
                  m.einnahmeform, m.verordnet_am, m.einnahme_von, m.einnahme_bis, m.status,
                  m.apothekenpflichtig, m.rezeptpflichtig, m.btm, m.aut_idem_sperre,
                  m.abgabebeschraenkung, m.sonstige_vermerke,
                  m.on_hold, m.hold_from, m.hold_until, m.hold_note,
                  m.medication_series_id, m.supersedes_medication_id,
                  m.regimen_fingerprint, m.source_country, m.source_date, m.source_page,
                  m.source_document_id, m.source_import_id, m.source_candidate_id,
                  COALESCE(md.original_filename, md.auto_name) AS source_document_name,
                  m.provider_id, p.name AS provider_name,
                  m.doctor_id, dr.name AS doctor_name, dr.title AS doctor_title, dr.fachbereich AS doctor_fachbereich
           FROM patient_medications m
           LEFT JOIN providers p ON p.id = m.provider_id
           LEFT JOIN provider_doctors dr ON dr.id = m.doctor_id
           LEFT JOIN documents md ON md.id = m.source_document_id
           WHERE m.patient_id = $1 AND m.superseded_at IS NULL
           ORDER BY m.sort_order, m.created_at"#,
    )
    .bind(patient_uuid)
    .fetch_all(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, patient_id = %patient_uuid, "load patient medications");
        load_fail()
    })?;

    let exam_rows = sqlx::query(
        r#"SELECT e.id, e.case_id, e.kind, e.title, e.performed_on, e.status, e.result, e.note, e.red_flags,
                  e.source_document_id, e.source_import_id, e.source_candidate_id,
                  COALESCE(ed.original_filename, ed.auto_name) AS source_document_name,
                  e.provider_id, p.name AS provider_name,
                  e.doctor_id, dr.name AS doctor_name, dr.title AS doctor_title, dr.fachbereich AS doctor_fachbereich,
                  COALESCE(es.specialization_ids, ARRAY[]::uuid[]) AS specialization_ids,
                  COALESCE(es.specializations, '[]'::jsonb) AS specializations
           FROM patient_examinations e
           LEFT JOIN providers p ON p.id = e.provider_id
           LEFT JOIN provider_doctors dr ON dr.id = e.doctor_id
           LEFT JOIN documents ed ON ed.id = e.source_document_id
           LEFT JOIN LATERAL (
               SELECT array_agg(ms.id ORDER BY pes.sort_order) AS specialization_ids,
                      jsonb_agg(
                          jsonb_build_object(
                              'id', ms.id,
                              'code', ms.code,
                              'name_en', ms.name_en,
                              'name_de', ms.name_de,
                              'name_ru', ms.name_ru,
                              'is_active', ms.is_active,
                              'sort_order', ms.sort_order
                          ) ORDER BY pes.sort_order
                      ) AS specializations
               FROM patient_examination_specializations pes
               JOIN medical_specializations ms ON ms.id = pes.specialization_id
               WHERE pes.examination_id = e.id
           ) es ON TRUE
           WHERE e.patient_id = $1
           ORDER BY e.sort_order, e.created_at"#,
    )
    .bind(patient_uuid)
    .fetch_all(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, patient_id = %patient_uuid, "load patient examinations");
        load_fail()
    })?;

    let diagnoses = diag_rows
        .into_iter()
        .map(|row| {
            let id = row.get::<Uuid, _>("id");
            json!({
                "id": id,
                "cid": id,
                "case_id": row.get::<Option<Uuid>, _>("case_id"),
                "parent_id": row.get::<Option<Uuid>, _>("parent_id"),
                "kind": row.get::<String, _>("kind"),
                "label": row.get::<String, _>("label"),
                "specialization_ids": row.get::<Vec<Uuid>, _>("specialization_ids"),
                "specializations": row.get::<serde_json::Value, _>("specializations"),
                "icd_code": row.get::<Option<String>, _>("icd_code"),
                "ops_code": row.get::<Option<String>, _>("ops_code"),
                "certainty": row.get::<Option<String>, _>("certainty"),
                "chronifizierung": row.get::<Option<String>, _>("chronifizierung"),
                "grade": row.get::<Option<String>, _>("grade"),
                "laterality": row.get::<Option<String>, _>("laterality"),
                "status": row.get::<String, _>("status"),
                "diagnosed_on": row.get::<Option<String>, _>("diagnosed_on"),
                "note": row.get::<Option<String>, _>("note"),
                "red_flags": row.get::<Option<String>, _>("red_flags"),
                "source_mode": row.get::<String, _>("source_mode"),
                "external_clinic": row.get::<Option<String>, _>("external_clinic"),
                "external_doctor": row.get::<Option<String>, _>("external_doctor"),
                "external_country": row.get::<Option<String>, _>("external_country"),
                "source_document_id": row.get::<Option<Uuid>, _>("source_document_id"),
                "source_document_name": row.get::<Option<String>, _>("source_document_name"),
                "source_import_id": row.get::<Option<Uuid>, _>("source_import_id"),
                "source_candidate_id": row.get::<Option<String>, _>("source_candidate_id"),
                "provider_id": row.get::<Option<Uuid>, _>("provider_id"),
                "provider_name": row.get::<Option<String>, _>("provider_name"),
                "doctor_id": row.get::<Option<Uuid>, _>("doctor_id"),
                "doctor_name": row.get::<Option<String>, _>("doctor_name"),
                "doctor_title": row.get::<Option<String>, _>("doctor_title"),
                "doctor_fachbereich": row.get::<Option<String>, _>("doctor_fachbereich"),
                "treating_doctor_id": row.get::<Option<Uuid>, _>("treating_doctor_id"),
                "treating_doctor_name": row.get::<Option<String>, _>("treating_doctor_name"),
                "treating_doctor_title": row.get::<Option<String>, _>("treating_doctor_title"),
                "treating_doctor_fachbereich": row.get::<Option<String>, _>("treating_doctor_fachbereich"),
                "treating_none": row.get::<bool, _>("treating_none"),
            })
        })
        .collect::<Vec<_>>();

    let medications = med_rows
        .into_iter()
        .map(|row| {
            json!({
                "id": row.get::<Uuid, _>("id"),
                "category": row.get::<String, _>("category"),
                "wirkstoff": row.get::<Option<String>, _>("wirkstoff"),
                "handelsname": row.get::<String, _>("handelsname"),
                "staerke": row.get::<Option<String>, _>("staerke"),
                "form": row.get::<Option<String>, _>("form"),
                "dose_morgens": row.get::<Option<String>, _>("dose_morgens"),
                "dose_mittags": row.get::<Option<String>, _>("dose_mittags"),
                "dose_abends": row.get::<Option<String>, _>("dose_abends"),
                "dose_nachts": row.get::<Option<String>, _>("dose_nachts"),
                "einheit": row.get::<Option<String>, _>("einheit"),
                "hinweis": row.get::<Option<String>, _>("hinweis"),
                "grund": row.get::<Option<String>, _>("grund"),
                "einnahmeform": row.get::<Option<String>, _>("einnahmeform"),
                "verordnet_am": row.get::<Option<String>, _>("verordnet_am"),
                "einnahme_von": row.get::<Option<String>, _>("einnahme_von"),
                "einnahme_bis": row.get::<Option<String>, _>("einnahme_bis"),
                "status": row.get::<String, _>("status"),
                "apothekenpflichtig": row.get::<bool, _>("apothekenpflichtig"),
                "rezeptpflichtig": row.get::<bool, _>("rezeptpflichtig"),
                "btm": row.get::<bool, _>("btm"),
                "aut_idem_sperre": row.get::<bool, _>("aut_idem_sperre"),
                "abgabebeschraenkung": row.get::<bool, _>("abgabebeschraenkung"),
                "sonstige_vermerke": row.get::<Option<String>, _>("sonstige_vermerke"),
                "on_hold": row.get::<bool, _>("on_hold"),
                "hold_from": row.get::<Option<String>, _>("hold_from"),
                "hold_until": row.get::<Option<String>, _>("hold_until"),
                "hold_note": row.get::<Option<String>, _>("hold_note"),
                "medication_series_id": row.get::<Uuid, _>("medication_series_id"),
                "supersedes_medication_id": row.get::<Option<Uuid>, _>("supersedes_medication_id"),
                "regimen_fingerprint": row.get::<Option<String>, _>("regimen_fingerprint"),
                "source_country": row.get::<Option<String>, _>("source_country"),
                "source_date": row.get::<Option<chrono::NaiveDate>, _>("source_date"),
                "source_page": row.get::<Option<i32>, _>("source_page"),
                "source_document_id": row.get::<Option<Uuid>, _>("source_document_id"),
                "source_document_name": row.get::<Option<String>, _>("source_document_name"),
                "source_import_id": row.get::<Option<Uuid>, _>("source_import_id"),
                "source_candidate_id": row.get::<Option<String>, _>("source_candidate_id"),
                "provider_id": row.get::<Option<Uuid>, _>("provider_id"),
                "provider_name": row.get::<Option<String>, _>("provider_name"),
                "doctor_id": row.get::<Option<Uuid>, _>("doctor_id"),
                "doctor_name": row.get::<Option<String>, _>("doctor_name"),
                "doctor_title": row.get::<Option<String>, _>("doctor_title"),
                "doctor_fachbereich": row.get::<Option<String>, _>("doctor_fachbereich"),
            })
        })
        .collect::<Vec<_>>();

    let examinations = exam_rows
        .into_iter()
        .map(|row| {
            json!({
                "id": row.get::<Uuid, _>("id"),
                "case_id": row.get::<Option<Uuid>, _>("case_id"),
                "kind": row.get::<Option<String>, _>("kind"),
                "title": row.get::<String, _>("title"),
                "performed_on": row.get::<Option<String>, _>("performed_on"),
                "status": row.get::<String, _>("status"),
                "result": row.get::<Option<String>, _>("result"),
                "note": row.get::<Option<String>, _>("note"),
                "red_flags": row.get::<Option<String>, _>("red_flags"),
                "source_document_id": row.get::<Option<Uuid>, _>("source_document_id"),
                "source_document_name": row.get::<Option<String>, _>("source_document_name"),
                "source_import_id": row.get::<Option<Uuid>, _>("source_import_id"),
                "source_candidate_id": row.get::<Option<String>, _>("source_candidate_id"),
                "specialization_ids": row.get::<Vec<Uuid>, _>("specialization_ids"),
                "specializations": row.get::<serde_json::Value, _>("specializations"),
                "provider_id": row.get::<Option<Uuid>, _>("provider_id"),
                "provider_name": row.get::<Option<String>, _>("provider_name"),
                "doctor_id": row.get::<Option<Uuid>, _>("doctor_id"),
                "doctor_name": row.get::<Option<String>, _>("doctor_name"),
                "doctor_title": row.get::<Option<String>, _>("doctor_title"),
                "doctor_fachbereich": row.get::<Option<String>, _>("doctor_fachbereich"),
            })
        })
        .collect::<Vec<_>>();

    let proc_rows = sqlx::query(
        r#"SELECT p2.id, p2.case_id, p2.label, p2.ops_code, p2.performed_on, p2.note,
                  p2.provider_id, pv.name AS provider_name,
                  p2.doctor_id, dr.name AS doctor_name, dr.title AS doctor_title, dr.fachbereich AS doctor_fachbereich
           FROM patient_procedures p2
           LEFT JOIN providers pv ON pv.id = p2.provider_id
           LEFT JOIN provider_doctors dr ON dr.id = p2.doctor_id
           WHERE p2.patient_id = $1
           ORDER BY p2.sort_order, p2.created_at"#,
    )
    .bind(patient_uuid)
    .fetch_all(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, patient_id = %patient_uuid, "load patient procedures");
        load_fail()
    })?;

    let procedures = proc_rows
        .into_iter()
        .map(|row| {
            json!({
                "id": row.get::<Uuid, _>("id"),
                "case_id": row.get::<Option<Uuid>, _>("case_id"),
                "label": row.get::<String, _>("label"),
                "ops_code": row.get::<Option<String>, _>("ops_code"),
                "performed_on": row.get::<Option<String>, _>("performed_on"),
                "note": row.get::<Option<String>, _>("note"),
                "provider_id": row.get::<Option<Uuid>, _>("provider_id"),
                "provider_name": row.get::<Option<String>, _>("provider_name"),
                "doctor_id": row.get::<Option<Uuid>, _>("doctor_id"),
                "doctor_name": row.get::<Option<String>, _>("doctor_name"),
                "doctor_title": row.get::<Option<String>, _>("doctor_title"),
                "doctor_fachbereich": row.get::<Option<String>, _>("doctor_fachbereich"),
            })
        })
        .collect::<Vec<_>>();

    // Allergien & CAVE: two CRUD lists backed by one table, split by `kind`.
    let warning_rows = sqlx::query(
        r#"SELECT id, kind, label, reaction, severity, note
           FROM patient_clinical_warnings
           WHERE patient_id = $1
           ORDER BY kind, sort_order, created_at"#,
    )
    .bind(patient_uuid)
    .fetch_all(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, patient_id = %patient_uuid, "load patient clinical warnings");
        load_fail()
    })?;

    let warning_json = |row: &sqlx::postgres::PgRow| {
        json!({
            "id": row.get::<Uuid, _>("id"),
            "kind": row.get::<String, _>("kind"),
            "label": row.get::<String, _>("label"),
            "reaction": row.get::<Option<String>, _>("reaction"),
            "severity": row.get::<Option<String>, _>("severity"),
            "note": row.get::<Option<String>, _>("note"),
        })
    };
    let allergien = warning_rows
        .iter()
        .filter(|row| row.get::<String, _>("kind") == "allergie")
        .map(&warning_json)
        .collect::<Vec<_>>();
    let cave = warning_rows
        .iter()
        .filter(|row| row.get::<String, _>("kind") == "cave")
        .map(&warning_json)
        .collect::<Vec<_>>();

    let verlauf_rows = sqlx::query(
        r#"SELECT v.id, v.case_id, v.provider_id, p.name AS provider_name,
                  v.doctor_id, dr.name AS doctor_name, dr.title AS doctor_title, dr.fachbereich AS doctor_fachbereich,
                  v.source_document_id, v.source_import_id, v.source_candidate_id, v.source_page,
                  COALESCE(vd.original_filename, vd.auto_name) AS source_document_name,
                  v.occurred_on, v.note
           FROM patient_clinical_verlauf v
           LEFT JOIN providers p ON p.id = v.provider_id
           LEFT JOIN provider_doctors dr ON dr.id = v.doctor_id
           LEFT JOIN documents vd ON vd.id = v.source_document_id
           WHERE v.patient_id = $1
           ORDER BY v.occurred_on ASC NULLS LAST, v.created_at, v.sort_order"#,
    )
    .bind(patient_uuid)
    .fetch_all(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, patient_id = %patient_uuid, "load patient verlauf");
        load_fail()
    })?;
    let verlauf = verlauf_rows
        .iter()
        .map(verlauf_row_json)
        .collect::<Vec<_>>();

    // The active version of the patient's Anamnese (one row per patient is active).
    let narrative_row = sqlx::query(
        r#"SELECT n.id, n.case_id, n.anamnese_aktuelle, n.anamnese_vorgeschichte, n.anamnese_vegetative, n.anamnese_sozial,
                  n.beurteilung, n.red_flags, n.source_document_id, n.source_import_id,
                  COALESCE(d.original_filename, d.auto_name) AS source_document_name,
                  n.anamnese_at, n.is_active, n.created_at, n.updated_at,
                  COALESCE(ns.specialization_ids, ARRAY[]::uuid[]) AS specialization_ids,
                  COALESCE(ns.specializations, '[]'::jsonb) AS specializations
           FROM patient_clinical_narrative n
           LEFT JOIN documents d ON d.id = n.source_document_id
           LEFT JOIN LATERAL (
               SELECT array_agg(ms.id ORDER BY pns.sort_order) AS specialization_ids,
                      jsonb_agg(
                          jsonb_build_object(
                              'id', ms.id,
                              'code', ms.code,
                              'name_en', ms.name_en,
                              'name_de', ms.name_de,
                              'name_ru', ms.name_ru,
                              'is_active', ms.is_active,
                              'sort_order', ms.sort_order,
                              'narrative_text', pns.narrative_text,
                              'assessment_text', pns.assessment_text
                          ) ORDER BY pns.sort_order
                      ) AS specializations
               FROM patient_narrative_specializations pns
               JOIN medical_specializations ms ON ms.id = pns.specialization_id
               WHERE pns.narrative_id = n.id
           ) ns ON TRUE
           WHERE n.patient_id = $1 AND n.is_active
           ORDER BY updated_at DESC
           LIMIT 1"#,
    )
    .bind(patient_uuid)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, patient_id = %patient_uuid, "load patient narrative");
        load_fail()
    })?;

    let narrative = narrative_row.map(|row| narrative_version_json(&row));

    let impfstatus_row =
        sqlx::query("SELECT status_text, updated_at FROM patient_impfstatus WHERE patient_id = $1")
            .bind(patient_uuid)
            .fetch_optional(&state.db)
            .await
            .map_err(|e| {
                tracing::error!(error = %e, patient_id = %patient_uuid, "load patient impfstatus");
                load_fail()
            })?;
    let impfstatus = impfstatus_row.map(|row| {
        json!({
            "status_text": row.get::<Option<String>, _>("status_text"),
            "updated_at": row.get::<chrono::DateTime<chrono::Utc>, _>("updated_at").to_rfc3339(),
        })
    });

    Ok(Json(json!({
        "diagnoses": diagnoses,
        "medications": medications,
        "examinations": examinations,
        "procedures": procedures,
        "allergien": allergien,
        "cave": cave,
        "verlauf": verlauf,
        "narrative": narrative,
        "impfstatus": impfstatus,
    })))
}

/// All doctors at active medical providers. Powers the diagnosis-tree attribution
/// picker, which needs the full cross-provider doctor list (not scoped to one
/// provider), but must not include non-medical contact persons stored in the same
/// table.
async fn list_all_doctors(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
) -> impl IntoResponse {
    auth.require_any_role(PATIENT_CLINICAL_ROLES)?;

    let rows = sqlx::query(
        r#"SELECT d.id, d.name, d.title, d.fachbereich,
                  (array_agg(l.provider_id ORDER BY p.name, l.provider_id))[1] AS provider_id,
                  string_agg(DISTINCT p.name, ', ' ORDER BY p.name) AS provider_name
           FROM provider_doctor_links l
           JOIN provider_doctors d ON d.id = l.doctor_id
           JOIN providers p ON p.id = l.provider_id
           WHERE p.is_active = true
             AND p.provider_type = 'medical'
           GROUP BY d.id, d.name, d.title, d.fachbereich
           ORDER BY d.name"#,
    )
    .fetch_all(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, "load all doctors");
        err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to load doctors")
    })?;

    let doctors = rows
        .into_iter()
        .map(|row| {
            json!({
                "id": row.get::<Uuid, _>("id"),
                "name": row.get::<String, _>("name"),
                "title": row.get::<Option<String>, _>("title"),
                "fachbereich": row.get::<Option<String>, _>("fachbereich"),
                "provider_id": row.get::<Uuid, _>("provider_id"),
                "provider_name": row.get::<Option<String>, _>("provider_name"),
            })
        })
        .collect::<Vec<_>>();

    Ok::<_, axum::response::Response>(Json(json!(doctors)))
}

#[derive(Clone, Copy)]
enum PatientClinicalSection {
    Diagnoses,
    Medications,
    Examinations,
    Narrative,
    Verlauf,
    Procedures,
    ClinicalWarnings,
    Impfstatus,
}

impl PatientClinicalSection {
    fn key(self) -> &'static str {
        match self {
            PatientClinicalSection::Diagnoses => "diagnoses",
            PatientClinicalSection::Medications => "medications",
            PatientClinicalSection::Examinations => "examinations",
            PatientClinicalSection::Narrative => "narrative",
            PatientClinicalSection::Verlauf => "verlauf",
            PatientClinicalSection::Procedures => "procedures",
            PatientClinicalSection::ClinicalWarnings => "clinical_warnings",
            PatientClinicalSection::Impfstatus => "impfstatus",
        }
    }

    /// Full stored row state of the section as ordered JSONB (row shape as
    /// persisted, minus the redundant patient_id), for the version trail.
    fn snapshot_sql(self) -> &'static str {
        match self {
            PatientClinicalSection::Diagnoses => {
                r#"SELECT COALESCE(
                       jsonb_agg(
                           (to_jsonb(t) - 'patient_id') || jsonb_build_object(
                               'specialization_ids', COALESCE(
                                   (SELECT jsonb_agg(s.specialization_id ORDER BY s.sort_order)
                                    FROM patient_diagnosis_specializations s
                                    WHERE s.diagnosis_id = t.id),
                                   '[]'::jsonb
                               )
                           )
                           ORDER BY t.sort_order, t.created_at
                       ),
                       '[]'::jsonb
                   ) AS value
                   FROM patient_diagnoses t WHERE t.patient_id = $1"#
            }
            PatientClinicalSection::Medications => {
                r#"SELECT COALESCE(jsonb_agg(
                       (to_jsonb(t) - 'patient_id' - 'source_raw_text'
                                    - 'source_identifiers' - 'source_field_confidence')
                       ORDER BY t.sort_order, t.created_at
                   ), '[]'::jsonb) AS value
                   FROM patient_medications t WHERE t.patient_id = $1"#
            }
            PatientClinicalSection::Examinations => {
                r#"SELECT COALESCE(
                       jsonb_agg(
                           (to_jsonb(t) - 'patient_id') || jsonb_build_object(
                               'specialization_ids', COALESCE(
                                   (SELECT jsonb_agg(s.specialization_id ORDER BY s.sort_order)
                                    FROM patient_examination_specializations s
                                    WHERE s.examination_id = t.id),
                                   '[]'::jsonb
                               )
                           )
                           ORDER BY t.sort_order, t.created_at
                       ),
                       '[]'::jsonb
                   ) AS value
                   FROM patient_examinations t WHERE t.patient_id = $1"#
            }
            PatientClinicalSection::Narrative => {
                r#"SELECT COALESCE(
                       jsonb_agg(
                           (to_jsonb(t) - 'patient_id') || jsonb_build_object(
                               'specialization_ids', COALESCE(
                                   (SELECT jsonb_agg(s.specialization_id ORDER BY s.sort_order)
                                    FROM patient_narrative_specializations s
                                    WHERE s.narrative_id = t.id),
                                   '[]'::jsonb
                               ),
                               'specializations', COALESCE(
                                   (SELECT jsonb_agg(jsonb_build_object(
                                       'specialization_id', s.specialization_id,
                                       'narrative_text', s.narrative_text,
                                       'assessment_text', s.assessment_text
                                   ) ORDER BY s.sort_order)
                                    FROM patient_narrative_specializations s
                                    WHERE s.narrative_id = t.id),
                                   '[]'::jsonb
                               )
                           )
                           ORDER BY t.anamnese_at DESC, t.updated_at DESC
                       ),
                       '[]'::jsonb
                   ) AS value
                   FROM patient_clinical_narrative t WHERE t.patient_id = $1"#
            }
            PatientClinicalSection::Verlauf => {
                r#"SELECT COALESCE(jsonb_agg((to_jsonb(t) - 'patient_id') ORDER BY t.occurred_on ASC NULLS LAST, t.created_at, t.sort_order), '[]'::jsonb) AS value
                   FROM patient_clinical_verlauf t WHERE t.patient_id = $1"#
            }
            PatientClinicalSection::Procedures => {
                r#"SELECT COALESCE(jsonb_agg((to_jsonb(t) - 'patient_id') ORDER BY t.sort_order, t.created_at), '[]'::jsonb) AS value
                   FROM patient_procedures t WHERE t.patient_id = $1"#
            }
            PatientClinicalSection::ClinicalWarnings => {
                r#"SELECT COALESCE(jsonb_agg((to_jsonb(t) - 'patient_id') ORDER BY t.kind, t.sort_order, t.created_at), '[]'::jsonb) AS value
                   FROM patient_clinical_warnings t WHERE t.patient_id = $1"#
            }
            PatientClinicalSection::Impfstatus => {
                r#"SELECT COALESCE(jsonb_agg(to_jsonb(t) - 'patient_id'), '[]'::jsonb) AS value
                   FROM patient_impfstatus t WHERE t.patient_id = $1"#
            }
        }
    }
}

/// Parse and validate an episode attribution: the case must exist and belong to
/// this patient (422 otherwise). NULL/empty attribution is always valid.
async fn resolve_patient_case_attribution(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    patient_uuid: Uuid,
    value: Option<String>,
) -> Result<Option<Uuid>, axum::response::Response> {
    let Some(case_id) = clinical_parse_uuid(value)? else {
        return Ok(None);
    };
    let belongs = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM cases WHERE id = $1 AND patient_id = $2)",
    )
    .bind(case_id)
    .bind(patient_uuid)
    .fetch_one(&mut **tx)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, patient_id = %patient_uuid, case_id = %case_id, "validate case attribution");
        err(StatusCode::INTERNAL_SERVER_ERROR, "Failed")
    })?;
    if !belongs {
        return Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Case does not belong to this patient",
        ));
    }
    Ok(Some(case_id))
}

/// The episode to stamp on a section's version-log entry: the single distinct
/// attribution used by the save, or NULL when mixed or absent.
fn version_log_case_id(used: &std::collections::HashSet<Uuid>) -> Option<Uuid> {
    if used.len() != 1 {
        return None;
    }
    used.iter().next().copied()
}

async fn load_patient_section_snapshot(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    patient_uuid: Uuid,
    section: PatientClinicalSection,
) -> Result<serde_json::Value, sqlx::Error> {
    let row = sqlx::query(section.snapshot_sql())
        .bind(patient_uuid)
        .fetch_one(&mut **tx)
        .await?;
    Ok(row.get::<serde_json::Value, _>("value"))
}

pub(crate) async fn load_patient_clinical_retention_years(state: &AppState, default: i64) -> i64 {
    match sqlx::query(r#"SELECT value::TEXT AS value_text FROM system_settings WHERE key = $1"#)
        .bind("clinical_case_retention_years")
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

/// Transactional twin of cases.rs::version_log for the patient clinical record:
/// the version row commits (or rolls back) together with the section save, so
/// the trail can never claim a change that was not persisted.
#[allow(clippy::too_many_arguments)]
async fn patient_version_log(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    patient_uuid: Uuid,
    user_id: Uuid,
    section: PatientClinicalSection,
    case_id: Option<Uuid>,
    retention_years: i64,
    old_value: serde_json::Value,
    new_value: serde_json::Value,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO patient_clinical_versions (patient_id, changed_by, section, case_id, old_value, new_value)
         VALUES ($1, $2, $3, $4, $5, $6)",
    )
    .bind(patient_uuid)
    .bind(user_id)
    .bind(section.key())
    .bind(case_id)
    .bind(old_value)
    .bind(new_value)
    .execute(&mut **tx)
    .await?;
    sqlx::query(
        "UPDATE patients
         SET last_clinical_update_at = now(),
             clinical_retention_until = GREATEST(
                 COALESCE(clinical_retention_until, now()),
                 now() + ($2 * interval '1 year')
             )
         WHERE id = $1",
    )
    .bind(patient_uuid)
    .bind(retention_years.max(1))
    .execute(&mut **tx)
    .await?;
    Ok(())
}

async fn save_patient_diagnoses(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(patient_uuid): Path<Uuid>,
    Query(query): Query<PatientClinicalSaveQuery>,
    Json(body): Json<PatientClinicalItems<PatientDiagnosisInput>>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(PATIENT_CLINICAL_ROLES) {
        return e;
    }
    match has_patient_access(&state, &auth, patient_uuid).await {
        Ok(true) => {}
        Ok(false) => return err(StatusCode::FORBIDDEN, "Insufficient permissions"),
        Err(resp) => return resp,
    }
    let retention_years = load_patient_clinical_retention_years(&state, 30).await;
    let mut tx = match state.db.begin().await {
        Ok(tx) => tx,
        Err(e) => {
            tracing::error!(error = %e, "begin patient diagnoses tx");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };
    let old_value = match load_patient_section_snapshot(
        &mut tx,
        patient_uuid,
        PatientClinicalSection::Diagnoses,
    )
    .await
    {
        Ok(value) => value,
        Err(e) => {
            tracing::error!(error = %e, patient_id = %patient_uuid, "snapshot patient diagnoses");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };
    let merge_only = query.merge_only();
    let existing_provenance = match sqlx::query(
        "SELECT id, source_document_id, source_import_id, source_candidate_id
         FROM patient_diagnoses WHERE patient_id = $1",
    )
    .bind(patient_uuid)
    .fetch_all(&mut *tx)
    .await
    {
        Ok(rows) => rows
            .into_iter()
            .map(|row| {
                (
                    row.get::<Uuid, _>("id"),
                    (
                        row.get::<Option<Uuid>, _>("source_document_id"),
                        row.get::<Option<Uuid>, _>("source_import_id"),
                        row.get::<Option<String>, _>("source_candidate_id"),
                    ),
                )
            })
            .collect::<HashMap<_, _>>(),
        Err(e) => {
            tracing::error!(error = %e, patient_id = %patient_uuid, "load patient diagnosis provenance");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };
    if !merge_only
        && let Err(e) = sqlx::query("DELETE FROM patient_diagnoses WHERE patient_id = $1")
            .bind(patient_uuid)
            .execute(&mut *tx)
            .await
    {
        tracing::error!(error = %e, patient_id = %patient_uuid, "delete patient diagnoses");
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
    }
    // Items arrive ordered parent-before-child. We map each item's client id
    // (cid) onto the freshly generated server uuid so a child can resolve its
    // parent_id from parent_cid, and track each node's kind to enforce nesting.
    let mut cid_to_id: HashMap<String, Uuid> = HashMap::new();
    let mut cid_to_kind: HashMap<String, String> = HashMap::new();
    let mut used_cases: std::collections::HashSet<Uuid> = std::collections::HashSet::new();
    let mut saved = 0i32;
    for item in body.items {
        let row_id = item
            .id
            .as_deref()
            .and_then(|value| Uuid::parse_str(value.trim()).ok())
            .filter(|value| existing_provenance.contains_key(value));
        let Some(label) = clinical_opt_text(item.label) else {
            continue;
        };
        let item_case_id =
            match resolve_patient_case_attribution(&mut tx, patient_uuid, item.case_id.clone())
                .await
            {
                Ok(value) => value,
                Err(resp) => return resp,
            };
        if let Some(case_id) = item_case_id {
            used_cases.insert(case_id);
        }
        let kind = clinical_one_of(item.kind, &["main", "secondary", "prozedur"])
            .unwrap_or_else(|| "secondary".to_string());

        let mut specialization_ids = Vec::new();
        let mut seen_specialization_ids = HashSet::new();
        for raw_id in &item.specialization_ids {
            let specialization_id = match Uuid::parse_str(raw_id.trim()) {
                Ok(value) => value,
                Err(_) => {
                    return err(
                        StatusCode::UNPROCESSABLE_ENTITY,
                        "Invalid medical specialization id",
                    );
                }
            };
            if seen_specialization_ids.insert(specialization_id) {
                specialization_ids.push(specialization_id);
            }
        }
        if kind == "prozedur" && !specialization_ids.is_empty() {
            return err(
                StatusCode::UNPROCESSABLE_ENTITY,
                "Procedure entries cannot have medical specializations",
            );
        }
        if !specialization_ids.is_empty() {
            let existing_specialization_count = match sqlx::query_scalar::<_, i64>(
                "SELECT COUNT(*) FROM medical_specializations
                 WHERE id = ANY($1) AND deleted_at IS NULL",
            )
            .bind(&specialization_ids)
            .fetch_one(&mut *tx)
            .await
            {
                Ok(value) => value,
                Err(e) => {
                    tracing::error!(error = %e, patient_id = %patient_uuid, "validate diagnosis specializations");
                    return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
                }
            };
            if existing_specialization_count != specialization_ids.len() as i64 {
                return err(
                    StatusCode::UNPROCESSABLE_ENTITY,
                    "Medical specialization not found",
                );
            }
        }

        let parent_cid = item
            .parent_cid
            .as_ref()
            .map(|c| c.trim())
            .filter(|c| !c.is_empty());
        if kind == "main" && parent_cid.is_some() {
            return err(
                StatusCode::UNPROCESSABLE_ENTITY,
                "Main diagnosis cannot be nested under another diagnosis",
            );
        }
        if kind == "prozedur" && parent_cid.is_none() {
            return err(
                StatusCode::UNPROCESSABLE_ENTITY,
                "Procedure diagnosis requires a parent diagnosis",
            );
        }

        // Resolve parent. A parent_cid that we have not already inserted means
        // the parent was skipped (e.g. empty label) or arrived out of order;
        // drop the orphan rather than persist a dangling reference.
        let parent_id = match parent_cid {
            None => None,
            Some(parent_cid) => {
                let Some(pid) = cid_to_id.get(parent_cid).copied() else {
                    continue;
                };
                // Nesting: a prozedur node may only parent further prozedur nodes.
                if (kind == "main" || kind == "secondary")
                    && cid_to_kind.get(parent_cid).map(String::as_str) == Some("prozedur")
                {
                    return err(
                        StatusCode::UNPROCESSABLE_ENTITY,
                        "A procedure node cannot parent a diagnosis",
                    );
                }
                Some(pid)
            }
        };

        let certainty =
            clinical_one_of(item.certainty, &["verdacht", "bestaetigt", "zustand_nach"]);
        let chronifizierung = clinical_one_of(
            item.chronifizierung,
            &["akut", "chronisch", "rezidivierend"],
        );
        let source_mode = clinical_one_of(item.source_mode, &["intern", "extern"])
            .unwrap_or_else(|| "intern".to_string());
        let external_clinic = clinical_opt_text(item.external_clinic);
        let external_doctor = clinical_opt_text(item.external_doctor);
        let external_country = clinical_opt_text(item.external_country);
        if source_mode == "extern" && external_country.is_none() {
            return err(
                StatusCode::UNPROCESSABLE_ENTITY,
                "External diagnoses require a country",
            );
        }
        let status = clinical_one_of(item.status, &["active", "chronic", "resolved"])
            .unwrap_or_else(|| "active".to_string());
        let laterality = clinical_one_of(item.laterality, &["left", "right", "bilateral"]);
        let (provider_id, doctor_id) = if source_mode == "extern" {
            (None, None)
        } else {
            match clinical_resolve_attribution(&state, item.provider_id, item.doctor_id).await {
                Ok(pair) => pair,
                Err(resp) => return resp,
            }
        };
        let treating_none = item.treating_none.unwrap_or(false);
        let treating_doctor_id = if treating_none {
            None
        } else {
            match clinical_resolve_treating_doctor(&state, item.treating_doctor_id).await {
                Ok(v) => v,
                Err(resp) => return resp,
            }
        };
        let new_id = row_id.unwrap_or_else(Uuid::new_v4);
        let (source_document_id, source_import_id, source_candidate_id) = row_id
            .and_then(|id| existing_provenance.get(&id).cloned())
            .unwrap_or((None, None, None));
        if let Err(e) = sqlx::query(
            r#"INSERT INTO patient_diagnoses AS diagnosis
                    (id, patient_id, case_id, parent_id, provider_id, doctor_id, kind, label,
                     icd_code, ops_code, certainty, chronifizierung, grade, laterality, status,
                     diagnosed_on, note, red_flags, sort_order, source_mode, external_clinic, external_doctor,
                     external_country, treating_doctor_id, treating_none,
                     source_document_id, source_import_id, source_candidate_id)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
                       $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25,
                       $26, $27, $28)
               ON CONFLICT (id) DO UPDATE SET
                   case_id = EXCLUDED.case_id,
                   parent_id = EXCLUDED.parent_id,
                   provider_id = EXCLUDED.provider_id,
                   doctor_id = EXCLUDED.doctor_id,
                   kind = EXCLUDED.kind,
                   label = EXCLUDED.label,
                   icd_code = EXCLUDED.icd_code,
                   ops_code = EXCLUDED.ops_code,
                   certainty = EXCLUDED.certainty,
                   chronifizierung = EXCLUDED.chronifizierung,
                   grade = EXCLUDED.grade,
                   laterality = EXCLUDED.laterality,
                   status = EXCLUDED.status,
                   diagnosed_on = EXCLUDED.diagnosed_on,
                   note = EXCLUDED.note,
                   red_flags = EXCLUDED.red_flags,
                   sort_order = EXCLUDED.sort_order,
                   source_mode = EXCLUDED.source_mode,
                   external_clinic = EXCLUDED.external_clinic,
                   external_doctor = EXCLUDED.external_doctor,
                   external_country = EXCLUDED.external_country,
                   treating_doctor_id = EXCLUDED.treating_doctor_id,
                   treating_none = EXCLUDED.treating_none
               WHERE diagnosis.patient_id = EXCLUDED.patient_id"#,
        )
        .bind(new_id)
        .bind(patient_uuid)
        .bind(item_case_id)
        .bind(parent_id)
        .bind(provider_id)
        .bind(doctor_id)
        .bind(&kind)
        .bind(&label)
        .bind(clinical_opt_text(item.icd_code))
        .bind(clinical_opt_text(item.ops_code))
        .bind(certainty)
        .bind(chronifizierung)
        .bind(clinical_opt_text(item.grade))
        .bind(laterality)
        .bind(&status)
        .bind(clinical_opt_text(item.diagnosed_on))
        .bind(clinical_opt_text(item.note))
        .bind(clinical_opt_text(item.red_flags))
        .bind(saved)
        .bind(&source_mode)
        .bind(if source_mode == "extern" {
            external_clinic
        } else {
            None
        })
        .bind(if source_mode == "extern" {
            external_doctor
        } else {
            None
        })
        .bind(if source_mode == "extern" {
            external_country
        } else {
            None
        })
        .bind(treating_doctor_id)
        .bind(treating_none)
        .bind(source_document_id)
        .bind(source_import_id)
        .bind(source_candidate_id)
        .execute(&mut *tx)
        .await
        {
            tracing::error!(error = %e, patient_id = %patient_uuid, "insert patient diagnosis");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
        if let Err(e) =
            sqlx::query("DELETE FROM patient_diagnosis_specializations WHERE diagnosis_id = $1")
                .bind(new_id)
                .execute(&mut *tx)
                .await
        {
            tracing::error!(error = %e, diagnosis_id = %new_id, "clear diagnosis specializations");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
        if !specialization_ids.is_empty()
            && let Err(e) = sqlx::query(
                r#"INSERT INTO patient_diagnosis_specializations
                       (diagnosis_id, specialization_id, sort_order)
                   SELECT $1, specialization_id, ordinality::integer - 1
                   FROM UNNEST($2::uuid[]) WITH ORDINALITY AS selected(specialization_id, ordinality)"#,
            )
            .bind(new_id)
            .bind(&specialization_ids)
            .execute(&mut *tx)
            .await
            {
                tracing::error!(error = %e, diagnosis_id = %new_id, "save diagnosis specializations");
                return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
        if let Some(cid) = item
            .cid
            .as_ref()
            .map(|c| c.trim())
            .filter(|c| !c.is_empty())
        {
            cid_to_id.insert(cid.to_string(), new_id);
            cid_to_kind.insert(cid.to_string(), kind);
        }
        saved += 1;
    }
    let new_value = match load_patient_section_snapshot(
        &mut tx,
        patient_uuid,
        PatientClinicalSection::Diagnoses,
    )
    .await
    {
        Ok(value) => value,
        Err(e) => {
            tracing::error!(error = %e, patient_id = %patient_uuid, "resnapshot patient diagnoses");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };
    if let Err(e) = patient_version_log(
        &mut tx,
        patient_uuid,
        auth.user_id,
        PatientClinicalSection::Diagnoses,
        version_log_case_id(&used_cases),
        retention_years,
        old_value,
        new_value,
    )
    .await
    {
        tracing::error!(error = %e, patient_id = %patient_uuid, "log patient diagnoses version");
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
    }
    if let Err(e) = tx.commit().await {
        tracing::error!(error = %e, patient_id = %patient_uuid, "commit patient diagnoses");
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
    }
    state.audit_sender.try_send(audit::domain_event(
        "save_patient_diagnoses",
        Some(auth.user_id),
        "patient",
        Some(patient_uuid),
        json!({ "count": saved }),
    ));
    crate::realtime::publish_patient_event(
        &state,
        Some(auth.user_id),
        "patient.clinical_updated",
        patient_uuid,
        json!({ "section": "diagnoses" }),
    )
    .await;
    Json(json!({ "ok": true, "count": saved })).into_response()
}

async fn save_patient_medications(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(patient_uuid): Path<Uuid>,
    Query(query): Query<PatientClinicalSaveQuery>,
    Json(body): Json<PatientClinicalItems<PatientMedicationInput>>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(PATIENT_CLINICAL_ROLES) {
        return e;
    }
    match has_patient_access(&state, &auth, patient_uuid).await {
        Ok(true) => {}
        Ok(false) => return err(StatusCode::FORBIDDEN, "Insufficient permissions"),
        Err(resp) => return resp,
    }
    if body.items.iter().any(|item| {
        item.wirkstoff
            .as_deref()
            .map(str::trim)
            .is_none_or(str::is_empty)
    }) {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "wirkstoff is required for every medication",
        );
    }

    let retention_years = load_patient_clinical_retention_years(&state, 30).await;
    let mut tx = match state.db.begin().await {
        Ok(tx) => tx,
        Err(e) => {
            tracing::error!(error = %e, "begin patient medications tx");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };
    let old_value = match load_patient_section_snapshot(
        &mut tx,
        patient_uuid,
        PatientClinicalSection::Medications,
    )
    .await
    {
        Ok(value) => value,
        Err(e) => {
            tracing::error!(error = %e, patient_id = %patient_uuid, "snapshot patient medications");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };
    let existing_ids = match sqlx::query_scalar::<_, Uuid>(
        "SELECT id FROM patient_medications WHERE patient_id = $1 AND superseded_at IS NULL",
    )
    .bind(patient_uuid)
    .fetch_all(&mut *tx)
    .await
    {
        Ok(ids) => ids,
        Err(e) => {
            tracing::error!(error = %e, patient_id = %patient_uuid, "load patient medication ids");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };
    let mut existing: HashSet<Uuid> = HashSet::new();
    for id in existing_ids {
        existing.insert(id);
    }
    let mut written_ids: Vec<Uuid> = Vec::new();
    let mut saved = 0i32;
    let mut on_hold_count = 0i32;
    let mut scheduled_end_count = 0i32;
    for item in body.items {
        let row_id = item
            .id
            .as_deref()
            .and_then(|value| Uuid::parse_str(value.trim()).ok())
            .filter(|value| existing.contains(value));
        let wirkstoff = clinical_opt_text(item.wirkstoff)
            .expect("medication active ingredient validated before transaction");
        let handelsname = clinical_opt_text(item.handelsname).unwrap_or_default();
        let category = clinical_one_of(item.category, &["dauer", "besondere", "selbst"])
            .unwrap_or_else(|| "dauer".to_string());
        let status = clinical_one_of(item.status, &["aktiv", "pausiert", "abgesetzt", "geplant"])
            .unwrap_or_else(|| "aktiv".to_string());
        let verordnet_am = match clinical_parse_date(item.verordnet_am, "verordnet_am") {
            Ok(value) => value,
            Err(response) => return response,
        };
        let einnahme_von = match clinical_parse_date(item.einnahme_von, "einnahme_von") {
            Ok(value) => value,
            Err(response) => return response,
        };
        let einnahme_bis = match clinical_parse_date(item.einnahme_bis, "einnahme_bis") {
            Ok(value) => value,
            Err(response) => return response,
        };
        let hold_from = match clinical_parse_date(item.hold_from, "hold_from") {
            Ok(value) => value,
            Err(response) => return response,
        };
        let hold_until = match clinical_parse_date(item.hold_until, "hold_until") {
            Ok(value) => value,
            Err(response) => return response,
        };
        if let (Some(from), Some(until)) = (einnahme_von.as_ref(), einnahme_bis.as_ref())
            && until < from
        {
            return err(
                StatusCode::UNPROCESSABLE_ENTITY,
                "einnahme_bis must be on or after einnahme_von",
            );
        }
        if let (Some(from), Some(until)) = (hold_from.as_ref(), hold_until.as_ref())
            && until < from
        {
            return err(
                StatusCode::UNPROCESSABLE_ENTITY,
                "hold_until must be on or after hold_from",
            );
        }
        let verordnet_am = verordnet_am.map(|value| value.to_string());
        let einnahme_von = einnahme_von.map(|value| value.to_string());
        let einnahme_bis = einnahme_bis.map(|value| value.to_string());
        let hold_from = hold_from.map(|value| value.to_string());
        let hold_until = hold_until.map(|value| value.to_string());
        let on_hold = item.on_hold.unwrap_or(false);
        let (provider_id, doctor_id) =
            match clinical_resolve_attribution(&state, item.provider_id, item.doctor_id).await {
                Ok(pair) => pair,
                Err(resp) => return resp,
            };
        let statement = match row_id {
            Some(_) => {
                r#"UPDATE patient_medications
                   SET provider_id = $2, doctor_id = $3, category = $4, wirkstoff = $5,
                       handelsname = $6, staerke = $7, form = $8, dose_morgens = $9,
                       dose_mittags = $10, dose_abends = $11, dose_nachts = $12, einheit = $13,
                       hinweis = $14, grund = $15, einnahmeform = $16, verordnet_am = $17,
                       einnahme_von = $18, einnahme_bis = $19, status = $20,
                       apothekenpflichtig = $21, rezeptpflichtig = $22, btm = $23,
                       aut_idem_sperre = $24, abgabebeschraenkung = $25, sonstige_vermerke = $26,
                       on_hold = $27, hold_from = $28, hold_until = $29, hold_note = $30,
                       sort_order = $31, regimen_fingerprint = NULL
                   WHERE id = $32 AND patient_id = $1
                   RETURNING id"#
            }
            None => {
                r#"INSERT INTO patient_medications (patient_id, provider_id, doctor_id, category, wirkstoff, handelsname, staerke, form, dose_morgens, dose_mittags, dose_abends, dose_nachts, einheit, hinweis, grund, einnahmeform, verordnet_am, einnahme_von, einnahme_bis, status, apothekenpflichtig, rezeptpflichtig, btm, aut_idem_sperre, abgabebeschraenkung, sonstige_vermerke, on_hold, hold_from, hold_until, hold_note, sort_order)
                   VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31)
                   RETURNING id"#
            }
        };
        let mut query = sqlx::query_scalar::<_, Uuid>(statement)
            .bind(patient_uuid)
            .bind(provider_id)
            .bind(doctor_id)
            .bind(&category)
            .bind(&wirkstoff)
            .bind(&handelsname)
            .bind(clinical_opt_text(item.staerke))
            .bind(clinical_opt_text(item.form))
            .bind(clinical_opt_text(item.dose_morgens))
            .bind(clinical_opt_text(item.dose_mittags))
            .bind(clinical_opt_text(item.dose_abends))
            .bind(clinical_opt_text(item.dose_nachts))
            .bind(clinical_opt_text(item.einheit))
            .bind(clinical_opt_text(item.hinweis))
            .bind(clinical_opt_text(item.grund))
            .bind(clinical_opt_text(item.einnahmeform))
            .bind(verordnet_am)
            .bind(einnahme_von)
            .bind(einnahme_bis.as_deref())
            .bind(&status)
            .bind(item.apothekenpflichtig.unwrap_or(false))
            .bind(item.rezeptpflichtig.unwrap_or(false))
            .bind(item.btm.unwrap_or(false))
            .bind(item.aut_idem_sperre.unwrap_or(false))
            .bind(item.abgabebeschraenkung.unwrap_or(false))
            .bind(clinical_opt_text(item.sonstige_vermerke))
            .bind(on_hold)
            .bind(hold_from)
            .bind(hold_until)
            .bind(clinical_opt_text(item.hold_note))
            .bind(saved);
        if let Some(id) = row_id {
            query = query.bind(id);
        }
        match query.fetch_one(&mut *tx).await {
            Ok(id) => written_ids.push(id),
            Err(e) => {
                tracing::error!(error = %e, patient_id = %patient_uuid, "save patient medication");
                return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
            }
        }
        if on_hold {
            on_hold_count += 1;
        }
        if einnahme_bis.is_some() {
            scheduled_end_count += 1;
        }
        saved += 1;
    }
    if !query.merge_only()
        && let Err(e) =
            sqlx::query(
                "DELETE FROM patient_medications WHERE patient_id = $1 AND superseded_at IS NULL AND id <> ALL($2)",
            )
                .bind(patient_uuid)
                .bind(&written_ids)
                .execute(&mut *tx)
                .await
    {
        tracing::error!(error = %e, patient_id = %patient_uuid, "prune patient medications");
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
    }
    let new_value = match load_patient_section_snapshot(
        &mut tx,
        patient_uuid,
        PatientClinicalSection::Medications,
    )
    .await
    {
        Ok(value) => value,
        Err(e) => {
            tracing::error!(error = %e, patient_id = %patient_uuid, "resnapshot patient medications");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };
    if let Err(e) = patient_version_log(
        &mut tx,
        patient_uuid,
        auth.user_id,
        PatientClinicalSection::Medications,
        None,
        retention_years,
        old_value,
        new_value,
    )
    .await
    {
        tracing::error!(error = %e, patient_id = %patient_uuid, "log patient medications version");
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
    }
    if let Err(e) = tx.commit().await {
        tracing::error!(error = %e, patient_id = %patient_uuid, "commit patient medications");
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
    }
    state.audit_sender.try_send(audit::domain_event(
        "save_patient_medications",
        Some(auth.user_id),
        "patient",
        Some(patient_uuid),
        json!({
            "count": saved,
            "on_hold_count": on_hold_count,
            "scheduled_end_count": scheduled_end_count,
        }),
    ));
    crate::realtime::publish_patient_event(
        &state,
        Some(auth.user_id),
        "patient.clinical_updated",
        patient_uuid,
        json!({ "section": "medications" }),
    )
    .await;
    Json(json!({ "ok": true, "count": saved })).into_response()
}

async fn save_patient_examinations(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(patient_uuid): Path<Uuid>,
    Json(body): Json<PatientClinicalItems<PatientExaminationInput>>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(PATIENT_CLINICAL_ROLES) {
        return e;
    }
    match has_patient_access(&state, &auth, patient_uuid).await {
        Ok(true) => {}
        Ok(false) => return err(StatusCode::FORBIDDEN, "Insufficient permissions"),
        Err(resp) => return resp,
    }

    let retention_years = load_patient_clinical_retention_years(&state, 30).await;
    let mut tx = match state.db.begin().await {
        Ok(tx) => tx,
        Err(e) => {
            tracing::error!(error = %e, "begin patient examinations tx");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };
    let old_value = match load_patient_section_snapshot(
        &mut tx,
        patient_uuid,
        PatientClinicalSection::Examinations,
    )
    .await
    {
        Ok(value) => value,
        Err(e) => {
            tracing::error!(error = %e, patient_id = %patient_uuid, "snapshot patient examinations");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };
    let existing_provenance = match sqlx::query(
        "SELECT id, source_document_id, source_import_id, source_candidate_id
         FROM patient_examinations WHERE patient_id = $1",
    )
    .bind(patient_uuid)
    .fetch_all(&mut *tx)
    .await
    {
        Ok(rows) => rows
            .into_iter()
            .map(|row| {
                (
                    row.get::<Uuid, _>("id"),
                    (
                        row.get::<Option<Uuid>, _>("source_document_id"),
                        row.get::<Option<Uuid>, _>("source_import_id"),
                        row.get::<Option<String>, _>("source_candidate_id"),
                    ),
                )
            })
            .collect::<HashMap<_, _>>(),
        Err(e) => {
            tracing::error!(error = %e, patient_id = %patient_uuid, "load patient examination provenance");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };
    if let Err(e) = sqlx::query("DELETE FROM patient_examinations WHERE patient_id = $1")
        .bind(patient_uuid)
        .execute(&mut *tx)
        .await
    {
        tracing::error!(error = %e, patient_id = %patient_uuid, "delete patient examinations");
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
    }
    let mut used_cases: std::collections::HashSet<Uuid> = std::collections::HashSet::new();
    let mut saved = 0i32;
    for item in body.items {
        let row_id = item
            .id
            .as_deref()
            .and_then(|value| Uuid::parse_str(value.trim()).ok())
            .filter(|value| existing_provenance.contains_key(value));
        let Some(title) = clinical_opt_text(item.title) else {
            continue;
        };
        let specialization_ids =
            match clinical_specialization_ids(&mut tx, &item.specialization_ids).await {
                Ok(ids) => ids,
                Err(resp) => return resp,
            };
        let item_case_id =
            match resolve_patient_case_attribution(&mut tx, patient_uuid, item.case_id.clone())
                .await
            {
                Ok(value) => value,
                Err(resp) => return resp,
            };
        if let Some(case_id) = item_case_id {
            used_cases.insert(case_id);
        }
        let kind = clinical_one_of(
            item.kind,
            &[
                "sonography",
                "lab",
                "histology",
                "ecg",
                "microbiology",
                "radiology",
                "exam",
                "other",
            ],
        );
        let status = clinical_one_of(item.status, &["final", "pending"])
            .unwrap_or_else(|| "final".to_string());
        let (provider_id, doctor_id) =
            match clinical_resolve_attribution(&state, item.provider_id, item.doctor_id).await {
                Ok(pair) => pair,
                Err(resp) => return resp,
            };
        let examination_id = row_id.unwrap_or_else(Uuid::new_v4);
        let (source_document_id, source_import_id, source_candidate_id) = row_id
            .and_then(|id| existing_provenance.get(&id).cloned())
            .unwrap_or((None, None, None));
        let examination_id = match sqlx::query_scalar::<_, Uuid>(
            "INSERT INTO patient_examinations (id, patient_id, case_id, provider_id, doctor_id, kind, title, performed_on, status, result, note, red_flags, sort_order, source_document_id, source_import_id, source_candidate_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
             RETURNING id",
        )
        .bind(examination_id)
        .bind(patient_uuid)
        .bind(item_case_id)
        .bind(provider_id)
        .bind(doctor_id)
        .bind(kind)
        .bind(&title)
        .bind(clinical_opt_text(item.performed_on))
        .bind(&status)
        .bind(clinical_opt_text(item.result))
        .bind(clinical_opt_text(item.note))
        .bind(clinical_opt_text(item.red_flags))
        .bind(saved)
        .bind(source_document_id)
        .bind(source_import_id)
        .bind(source_candidate_id)
        .fetch_one(&mut *tx)
        .await
        {
            Ok(id) => id,
            Err(e) => {
                tracing::error!(error = %e, patient_id = %patient_uuid, "insert patient examination");
                return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
            }
        };
        if !specialization_ids.is_empty()
            && let Err(e) = sqlx::query(
                r#"INSERT INTO patient_examination_specializations
                       (examination_id, specialization_id, sort_order)
                   SELECT $1, specialization_id, ordinality::integer - 1
                   FROM UNNEST($2::uuid[]) WITH ORDINALITY AS selected(specialization_id, ordinality)"#,
            )
            .bind(examination_id)
            .bind(&specialization_ids)
            .execute(&mut *tx)
            .await
        {
            tracing::error!(error = %e, examination_id = %examination_id, "save examination specializations");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
        saved += 1;
    }
    let new_value = match load_patient_section_snapshot(
        &mut tx,
        patient_uuid,
        PatientClinicalSection::Examinations,
    )
    .await
    {
        Ok(value) => value,
        Err(e) => {
            tracing::error!(error = %e, patient_id = %patient_uuid, "resnapshot patient examinations");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };
    if let Err(e) = patient_version_log(
        &mut tx,
        patient_uuid,
        auth.user_id,
        PatientClinicalSection::Examinations,
        version_log_case_id(&used_cases),
        retention_years,
        old_value,
        new_value,
    )
    .await
    {
        tracing::error!(error = %e, patient_id = %patient_uuid, "log patient examinations version");
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
    }
    if let Err(e) = tx.commit().await {
        tracing::error!(error = %e, patient_id = %patient_uuid, "commit patient examinations");
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
    }
    state.audit_sender.try_send(audit::domain_event(
        "save_patient_examinations",
        Some(auth.user_id),
        "patient",
        Some(patient_uuid),
        json!({ "count": saved }),
    ));
    crate::realtime::publish_patient_event(
        &state,
        Some(auth.user_id),
        "patient.clinical_updated",
        patient_uuid,
        json!({ "section": "examinations" }),
    )
    .await;
    Json(json!({ "ok": true, "count": saved })).into_response()
}

#[derive(Deserialize)]
struct PatientNarrativeInput {
    /// Target version. `None`/empty → insert a new version; otherwise update the
    /// matching row (scoped to this patient).
    #[serde(default)]
    id: Option<String>,
    /// Episode this anamnesis version was taken in, if any.
    #[serde(default)]
    case_id: Option<String>,
    #[serde(default)]
    anamnese_aktuelle: Option<String>,
    #[serde(default)]
    anamnese_vorgeschichte: Option<String>,
    #[serde(default)]
    anamnese_vegetative: Option<String>,
    #[serde(default)]
    anamnese_sozial: Option<String>,
    #[serde(default)]
    beurteilung: Option<String>,
    #[serde(default)]
    red_flags: Option<String>,
    #[serde(default)]
    specialization_ids: Vec<String>,
    #[serde(default)]
    specializations: Vec<PatientNarrativeSpecializationInput>,
    #[serde(default)]
    anamnese_at: Option<String>,
    /// Whether this version becomes the patient's active version. Defaults true.
    #[serde(default)]
    is_active: Option<bool>,
}

#[derive(Deserialize)]
struct PatientNarrativeSpecializationInput {
    #[serde(default, alias = "id")]
    specialization_id: Option<String>,
    #[serde(default)]
    narrative_text: Option<String>,
    #[serde(default)]
    assessment_text: Option<String>,
}

async fn save_patient_narrative(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(patient_uuid): Path<Uuid>,
    Json(body): Json<PatientNarrativeInput>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(PATIENT_CLINICAL_ROLES) {
        return e;
    }
    match has_patient_access(&state, &auth, patient_uuid).await {
        Ok(true) => {}
        Ok(false) => return err(StatusCode::FORBIDDEN, "Insufficient permissions"),
        Err(resp) => return resp,
    }

    let target_id = match clinical_parse_uuid(body.id) {
        Ok(v) => v,
        Err(resp) => return resp,
    };
    let is_update = target_id.is_some();
    let want_active = body.is_active.unwrap_or(true);
    let anamnese_at = match body
        .anamnese_at
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        Some(value) => match parse_clinical_timestamp(value, "anamnese_at") {
            Ok(value) => value,
            Err(response) => return response,
        },
        None => chrono::Utc::now(),
    };
    let aktuelle = clinical_opt_text(body.anamnese_aktuelle);
    let vorgeschichte = clinical_opt_text(body.anamnese_vorgeschichte);
    let vegetative = clinical_opt_text(body.anamnese_vegetative);
    let sozial = clinical_opt_text(body.anamnese_sozial);
    let beurteilung = clinical_opt_text(body.beurteilung);
    let red_flags = clinical_opt_text(body.red_flags);

    let retention_years = load_patient_clinical_retention_years(&state, 30).await;
    let mut tx = match state.db.begin().await {
        Ok(tx) => tx,
        Err(e) => {
            tracing::error!(error = %e, "begin patient narrative tx");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };

    // Serialize concurrent narrative saves for this patient: without this, two
    // simultaneous "set active" saves could each deactivate-then-insert and both
    // commit an active row, violating the partial unique index (500). The
    // transaction-scoped advisory lock releases on commit/rollback.
    if let Err(e) = sqlx::query("SELECT pg_advisory_xact_lock(hashtext($1))")
        .bind(patient_uuid.to_string())
        .execute(&mut *tx)
        .await
    {
        tracing::error!(error = %e, patient_id = %patient_uuid, "lock patient narrative");
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
    }

    let old_value = match load_patient_section_snapshot(
        &mut tx,
        patient_uuid,
        PatientClinicalSection::Narrative,
    )
    .await
    {
        Ok(value) => value,
        Err(e) => {
            tracing::error!(error = %e, patient_id = %patient_uuid, "snapshot patient narrative");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };

    let narrative_case_id =
        match resolve_patient_case_attribution(&mut tx, patient_uuid, body.case_id).await {
            Ok(value) => value,
            Err(resp) => return resp,
        };
    let specialization_payload = body.specializations;
    let raw_specialization_ids = if specialization_payload.is_empty() {
        body.specialization_ids
    } else {
        specialization_payload
            .iter()
            .filter_map(|item| item.specialization_id.clone())
            .collect()
    };
    let specialization_ids =
        match clinical_specialization_ids(&mut tx, &raw_specialization_ids).await {
            Ok(ids) => ids,
            Err(resp) => return resp,
        };
    let specialization_text = specialization_payload
        .into_iter()
        .filter_map(|item| {
            let id = item
                .specialization_id
                .as_deref()
                .and_then(|value| Uuid::parse_str(value.trim()).ok())?;
            Some((
                id,
                (
                    clinical_opt_text(item.narrative_text),
                    clinical_opt_text(item.assessment_text),
                ),
            ))
        })
        .collect::<HashMap<_, _>>();

    // At most one active version per patient: deactivate the rest first.
    if want_active
        && let Err(e) = sqlx::query(
            "UPDATE patient_clinical_narrative SET is_active = false WHERE patient_id = $1",
        )
        .bind(patient_uuid)
        .execute(&mut *tx)
        .await
    {
        tracing::error!(error = %e, patient_id = %patient_uuid, "deactivate patient narratives");
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
    }

    let saved_id = match target_id {
        Some(id) => {
            let updated = match sqlx::query(
                r#"UPDATE patient_clinical_narrative SET
                       anamnese_aktuelle = $1,
                       anamnese_vorgeschichte = $2,
                       anamnese_vegetative = $3,
                       anamnese_sozial = $4,
                       beurteilung = $5,
                       red_flags = $6,
                       anamnese_at = $7,
                       is_active = $8,
                       case_id = COALESCE($9, case_id),
                       updated_at = now()
                   WHERE id = $10 AND patient_id = $11"#,
            )
            .bind(&aktuelle)
            .bind(&vorgeschichte)
            .bind(&vegetative)
            .bind(&sozial)
            .bind(&beurteilung)
            .bind(&red_flags)
            .bind(anamnese_at)
            .bind(want_active)
            .bind(narrative_case_id)
            .bind(id)
            .bind(patient_uuid)
            .execute(&mut *tx)
            .await
            {
                Ok(res) => res,
                Err(e) => {
                    tracing::error!(error = %e, patient_id = %patient_uuid, "update patient narrative");
                    return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
                }
            };
            if updated.rows_affected() == 0 {
                return err(StatusCode::NOT_FOUND, "Version not found");
            }
            id
        }
        None => {
            let new_id = Uuid::new_v4();
            if let Err(e) = sqlx::query(
                r#"INSERT INTO patient_clinical_narrative
                       (id, patient_id, case_id, anamnese_aktuelle, anamnese_vorgeschichte, anamnese_vegetative,
                        anamnese_sozial, beurteilung, red_flags, anamnese_at, is_active)
                   VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)"#,
            )
            .bind(new_id)
            .bind(patient_uuid)
            .bind(narrative_case_id)
            .bind(&aktuelle)
            .bind(&vorgeschichte)
            .bind(&vegetative)
            .bind(&sozial)
            .bind(&beurteilung)
            .bind(&red_flags)
            .bind(anamnese_at)
            .bind(want_active)
            .execute(&mut *tx)
            .await
            {
                tracing::error!(error = %e, patient_id = %patient_uuid, "insert patient narrative");
                return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
            }
            new_id
        }
    };

    if let Err(e) =
        sqlx::query("DELETE FROM patient_narrative_specializations WHERE narrative_id = $1")
            .bind(saved_id)
            .execute(&mut *tx)
            .await
    {
        tracing::error!(error = %e, narrative_id = %saved_id, "clear narrative specializations");
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
    }
    let specialization_narratives = specialization_ids
        .iter()
        .map(|id| {
            specialization_text
                .get(id)
                .and_then(|values| values.0.clone())
        })
        .collect::<Vec<Option<String>>>();
    let specialization_assessments = specialization_ids
        .iter()
        .map(|id| {
            specialization_text
                .get(id)
                .and_then(|values| values.1.clone())
        })
        .collect::<Vec<Option<String>>>();
    if !specialization_ids.is_empty()
        && let Err(e) = sqlx::query(
            r#"INSERT INTO patient_narrative_specializations
                   (narrative_id, specialization_id, narrative_text, assessment_text, sort_order)
               SELECT $1, specialization_id, narrative_text, assessment_text, ordinality::integer - 1
               FROM UNNEST($2::uuid[], $3::text[], $4::text[]) WITH ORDINALITY
                    AS selected(specialization_id, narrative_text, assessment_text, ordinality)"#,
        )
        .bind(saved_id)
        .bind(&specialization_ids)
        .bind(&specialization_narratives)
        .bind(&specialization_assessments)
        .execute(&mut *tx)
        .await
    {
        tracing::error!(error = %e, narrative_id = %saved_id, "save narrative specializations");
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
    }

    // Re-select the saved version inside the same transaction so the response is
    // consistent with what was committed.
    let saved_row = match sqlx::query(
        r#"SELECT n.id, n.case_id, n.anamnese_aktuelle, n.anamnese_vorgeschichte, n.anamnese_vegetative, n.anamnese_sozial,
                  n.beurteilung, n.red_flags, n.source_document_id, n.source_import_id,
                  MAX(COALESCE(d.original_filename, d.auto_name)) AS source_document_name,
                  n.anamnese_at, n.is_active, n.created_at, n.updated_at,
                  COALESCE(array_agg(ms.id ORDER BY pns.sort_order) FILTER (WHERE ms.id IS NOT NULL), ARRAY[]::uuid[]) AS specialization_ids,
                  COALESCE(jsonb_agg(jsonb_build_object(
                      'id', ms.id, 'code', ms.code, 'name_en', ms.name_en, 'name_de', ms.name_de,
                      'name_ru', ms.name_ru, 'is_active', ms.is_active, 'sort_order', ms.sort_order,
                      'narrative_text', pns.narrative_text, 'assessment_text', pns.assessment_text
                  ) ORDER BY pns.sort_order) FILTER (WHERE ms.id IS NOT NULL), '[]'::jsonb) AS specializations
           FROM patient_clinical_narrative n
           LEFT JOIN documents d ON d.id = n.source_document_id
           LEFT JOIN patient_narrative_specializations pns ON pns.narrative_id = n.id
           LEFT JOIN medical_specializations ms ON ms.id = pns.specialization_id
           WHERE n.id = $1
           GROUP BY n.id"#,
    )
    .bind(saved_id)
    .fetch_one(&mut *tx)
    .await
    {
        Ok(row) => row,
        Err(e) => {
            tracing::error!(error = %e, patient_id = %patient_uuid, "reload saved patient narrative");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };
    let saved = narrative_version_json(&saved_row);

    let new_value = match load_patient_section_snapshot(
        &mut tx,
        patient_uuid,
        PatientClinicalSection::Narrative,
    )
    .await
    {
        Ok(value) => value,
        Err(e) => {
            tracing::error!(error = %e, patient_id = %patient_uuid, "resnapshot patient narrative");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };
    if let Err(e) = patient_version_log(
        &mut tx,
        patient_uuid,
        auth.user_id,
        PatientClinicalSection::Narrative,
        narrative_case_id,
        retention_years,
        old_value,
        new_value,
    )
    .await
    {
        tracing::error!(error = %e, patient_id = %patient_uuid, "log patient narrative version");
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
    }

    if let Err(e) = tx.commit().await {
        tracing::error!(error = %e, patient_id = %patient_uuid, "commit patient narrative");
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
    }

    state.audit_sender.try_send(audit::domain_event(
        "save_patient_narrative",
        Some(auth.user_id),
        "patient",
        Some(patient_uuid),
        json!({
            "narrative_id": saved_id,
            "anamnese_at": anamnese_at.to_rfc3339(),
            "is_active": want_active,
            "operation": if is_update { "update" } else { "create" },
        }),
    ));
    crate::realtime::publish_patient_event(
        &state,
        Some(auth.user_id),
        "patient.clinical_updated",
        patient_uuid,
        json!({ "section": "narrative" }),
    )
    .await;
    Json(saved).into_response()
}

async fn list_patient_narrative_history(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(patient_uuid): Path<Uuid>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(PATIENT_CLINICAL_ROLES) {
        return e;
    }
    match has_patient_access(&state, &auth, patient_uuid).await {
        Ok(true) => {}
        Ok(false) => return err(StatusCode::FORBIDDEN, "Insufficient permissions"),
        Err(resp) => return resp,
    }

    let rows = match sqlx::query(
        r#"SELECT n.id, n.case_id, n.anamnese_aktuelle, n.anamnese_vorgeschichte, n.anamnese_vegetative, n.anamnese_sozial,
                  n.beurteilung, n.red_flags, n.source_document_id, n.source_import_id,
                  MAX(COALESCE(d.original_filename, d.auto_name)) AS source_document_name,
                  n.anamnese_at, n.is_active, n.created_at, n.updated_at,
                  COALESCE(array_agg(ms.id ORDER BY pns.sort_order) FILTER (WHERE ms.id IS NOT NULL), ARRAY[]::uuid[]) AS specialization_ids,
                  COALESCE(jsonb_agg(jsonb_build_object(
                      'id', ms.id, 'code', ms.code, 'name_en', ms.name_en, 'name_de', ms.name_de,
                      'name_ru', ms.name_ru, 'is_active', ms.is_active, 'sort_order', ms.sort_order,
                      'narrative_text', pns.narrative_text, 'assessment_text', pns.assessment_text
                  ) ORDER BY pns.sort_order) FILTER (WHERE ms.id IS NOT NULL), '[]'::jsonb) AS specializations
           FROM patient_clinical_narrative n
           LEFT JOIN documents d ON d.id = n.source_document_id
           LEFT JOIN patient_narrative_specializations pns ON pns.narrative_id = n.id
           LEFT JOIN medical_specializations ms ON ms.id = pns.specialization_id
           WHERE n.patient_id = $1
           GROUP BY n.id
           ORDER BY n.anamnese_at DESC, n.updated_at DESC"#,
    )
    .bind(patient_uuid)
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => rows,
        Err(e) => {
            tracing::error!(error = %e, patient_id = %patient_uuid, "list patient narrative history");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };

    let versions: Vec<serde_json::Value> = rows.iter().map(narrative_version_json).collect();
    Json(versions).into_response()
}

async fn delete_patient_narrative(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path((patient_uuid, narrative_uuid)): Path<(Uuid, Uuid)>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(PATIENT_CLINICAL_ROLES) {
        return e;
    }
    match has_patient_access(&state, &auth, patient_uuid).await {
        Ok(true) => {}
        Ok(false) => return err(StatusCode::FORBIDDEN, "Insufficient permissions"),
        Err(resp) => return resp,
    }

    let retention_years = load_patient_clinical_retention_years(&state, 30).await;
    let mut tx = match state.db.begin().await {
        Ok(tx) => tx,
        Err(e) => {
            tracing::error!(error = %e, "begin patient narrative delete tx");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };

    if let Err(e) = sqlx::query("SELECT pg_advisory_xact_lock(hashtext($1))")
        .bind(patient_uuid.to_string())
        .execute(&mut *tx)
        .await
    {
        tracing::error!(error = %e, patient_id = %patient_uuid, "lock patient narrative delete");
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
    }

    let old_value = match load_patient_section_snapshot(
        &mut tx,
        patient_uuid,
        PatientClinicalSection::Narrative,
    )
    .await
    {
        Ok(value) => value,
        Err(e) => {
            tracing::error!(error = %e, patient_id = %patient_uuid, "snapshot patient narrative before delete");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };

    let deleted = match sqlx::query(
        "DELETE FROM patient_clinical_narrative WHERE id = $1 AND patient_id = $2 RETURNING id, anamnese_at",
    )
    .bind(narrative_uuid)
    .bind(patient_uuid)
    .fetch_optional(&mut *tx)
    .await
    {
        Ok(row) => row,
        Err(e) => {
            tracing::error!(error = %e, patient_id = %patient_uuid, narrative_id = %narrative_uuid, "delete patient narrative");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };
    let Some(deleted) = deleted else {
        return err(StatusCode::NOT_FOUND, "Version not found");
    };
    let deleted_anamnese_at = deleted
        .get::<chrono::DateTime<chrono::Utc>, _>("anamnese_at")
        .to_rfc3339();

    let active_row = match sqlx::query(
        r#"SELECT n.id, n.case_id, n.anamnese_aktuelle, n.anamnese_vorgeschichte, n.anamnese_vegetative, n.anamnese_sozial,
                  n.beurteilung, n.red_flags, n.source_document_id, n.source_import_id,
                  MAX(COALESCE(d.original_filename, d.auto_name)) AS source_document_name,
                  n.anamnese_at, n.is_active, n.created_at, n.updated_at,
                  COALESCE(array_agg(ms.id ORDER BY pns.sort_order) FILTER (WHERE ms.id IS NOT NULL), ARRAY[]::uuid[]) AS specialization_ids,
                  COALESCE(jsonb_agg(jsonb_build_object(
                      'id', ms.id, 'code', ms.code, 'name_en', ms.name_en, 'name_de', ms.name_de,
                      'name_ru', ms.name_ru, 'is_active', ms.is_active, 'sort_order', ms.sort_order,
                      'narrative_text', pns.narrative_text, 'assessment_text', pns.assessment_text
                  ) ORDER BY pns.sort_order) FILTER (WHERE ms.id IS NOT NULL), '[]'::jsonb) AS specializations
           FROM patient_clinical_narrative n
           LEFT JOIN documents d ON d.id = n.source_document_id
           LEFT JOIN patient_narrative_specializations pns ON pns.narrative_id = n.id
           LEFT JOIN medical_specializations ms ON ms.id = pns.specialization_id
           WHERE n.patient_id = $1 AND n.is_active = true
           GROUP BY n.id
           ORDER BY n.updated_at DESC
           LIMIT 1"#,
    )
    .bind(patient_uuid)
    .fetch_optional(&mut *tx)
    .await
    {
        Ok(row) => row,
        Err(e) => {
            tracing::error!(error = %e, patient_id = %patient_uuid, "reload active patient narrative after delete");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };

    let active_row = if active_row.is_some() {
        active_row
    } else {
        match sqlx::query(
            r#"UPDATE patient_clinical_narrative
               SET is_active = true
               WHERE id = (
                   SELECT id
                   FROM patient_clinical_narrative
                   WHERE patient_id = $1
                   ORDER BY anamnese_at DESC, updated_at DESC, created_at DESC
                   LIMIT 1
               )
               RETURNING id, case_id, anamnese_aktuelle, anamnese_vorgeschichte, anamnese_vegetative, anamnese_sozial,
                         beurteilung, red_flags, source_document_id, source_import_id,
                         anamnese_at, is_active, created_at, updated_at,
                         COALESCE((SELECT array_agg(ms.id ORDER BY pns.sort_order)
                                   FROM patient_narrative_specializations pns
                                   JOIN medical_specializations ms ON ms.id = pns.specialization_id
                                   WHERE pns.narrative_id = patient_clinical_narrative.id), ARRAY[]::uuid[]) AS specialization_ids,
                         COALESCE((SELECT jsonb_agg(jsonb_build_object(
                                      'id', ms.id, 'code', ms.code, 'name_en', ms.name_en,
                                      'name_de', ms.name_de, 'name_ru', ms.name_ru,
                                      'is_active', ms.is_active, 'sort_order', ms.sort_order,
                                      'narrative_text', pns.narrative_text,
                                      'assessment_text', pns.assessment_text
                                  ) ORDER BY pns.sort_order)
                                   FROM patient_narrative_specializations pns
                                   JOIN medical_specializations ms ON ms.id = pns.specialization_id
                                   WHERE pns.narrative_id = patient_clinical_narrative.id), '[]'::jsonb) AS specializations"#,
        )
        .bind(patient_uuid)
        .fetch_optional(&mut *tx)
        .await
        {
            Ok(row) => row,
            Err(e) => {
                tracing::error!(error = %e, patient_id = %patient_uuid, "activate fallback patient narrative after delete");
                return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
            }
        }
    };

    let active = active_row.as_ref().map(narrative_version_json);

    let new_value = match load_patient_section_snapshot(
        &mut tx,
        patient_uuid,
        PatientClinicalSection::Narrative,
    )
    .await
    {
        Ok(value) => value,
        Err(e) => {
            tracing::error!(error = %e, patient_id = %patient_uuid, "resnapshot patient narrative after delete");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };
    if let Err(e) = patient_version_log(
        &mut tx,
        patient_uuid,
        auth.user_id,
        PatientClinicalSection::Narrative,
        None,
        retention_years,
        old_value,
        new_value,
    )
    .await
    {
        tracing::error!(error = %e, patient_id = %patient_uuid, "log patient narrative delete version");
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
    }

    if let Err(e) = tx.commit().await {
        tracing::error!(error = %e, patient_id = %patient_uuid, "commit patient narrative delete");
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
    }

    state.audit_sender.try_send(audit::domain_event(
        "delete_patient_narrative",
        Some(auth.user_id),
        "patient",
        Some(patient_uuid),
        json!({
            "narrative_id": narrative_uuid,
            "anamnese_at": deleted_anamnese_at,
        }),
    ));
    crate::realtime::publish_patient_event(
        &state,
        Some(auth.user_id),
        "patient.clinical_updated",
        patient_uuid,
        json!({ "section": "narrative" }),
    )
    .await;
    Json(active).into_response()
}

#[derive(Deserialize)]
struct PatientVerlaufSave {
    items: Vec<PatientVerlaufItem>,
}

#[derive(Deserialize)]
struct PatientVerlaufItem {
    #[serde(default)]
    id: Option<String>,
    #[serde(default)]
    case_id: Option<String>,
    #[serde(default)]
    provider_id: Option<String>,
    #[serde(default)]
    doctor_id: Option<String>,
    #[serde(default)]
    occurred_on: Option<String>,
    #[serde(default)]
    note: Option<String>,
}

async fn save_patient_verlauf(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(patient_uuid): Path<Uuid>,
    Json(body): Json<PatientVerlaufSave>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(PATIENT_CLINICAL_ROLES) {
        return e;
    }
    match has_patient_access(&state, &auth, patient_uuid).await {
        Ok(true) => {}
        Ok(false) => return err(StatusCode::FORBIDDEN, "Insufficient permissions"),
        Err(resp) => return resp,
    }

    let retention_years = load_patient_clinical_retention_years(&state, 30).await;
    let mut tx = match state.db.begin().await {
        Ok(tx) => tx,
        Err(e) => {
            tracing::error!(error = %e, "begin patient verlauf tx");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };

    let old_value =
        match load_patient_section_snapshot(&mut tx, patient_uuid, PatientClinicalSection::Verlauf)
            .await
        {
            Ok(value) => value,
            Err(e) => {
                tracing::error!(error = %e, patient_id = %patient_uuid, "snapshot patient verlauf");
                return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
            }
        };
    let existing_provenance = match sqlx::query(
        "SELECT id, source_document_id, source_import_id, source_candidate_id, source_page
         FROM patient_clinical_verlauf WHERE patient_id = $1",
    )
    .bind(patient_uuid)
    .fetch_all(&mut *tx)
    .await
    {
        Ok(rows) => rows
            .into_iter()
            .map(|row| {
                (
                    row.get::<Uuid, _>("id"),
                    (
                        row.get::<Option<Uuid>, _>("source_document_id"),
                        row.get::<Option<Uuid>, _>("source_import_id"),
                        row.get::<Option<String>, _>("source_candidate_id"),
                        row.get::<Option<i32>, _>("source_page"),
                    ),
                )
            })
            .collect::<HashMap<_, _>>(),
        Err(e) => {
            tracing::error!(error = %e, patient_id = %patient_uuid, "load patient verlauf provenance");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };
    if let Err(e) = sqlx::query("DELETE FROM patient_clinical_verlauf WHERE patient_id = $1")
        .bind(patient_uuid)
        .execute(&mut *tx)
        .await
    {
        tracing::error!(error = %e, patient_id = %patient_uuid, "delete patient verlauf");
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
    }

    let mut used_cases: std::collections::HashSet<Uuid> = std::collections::HashSet::new();
    let mut saved = 0i32;
    for item in body.items {
        let row_id = item
            .id
            .as_deref()
            .and_then(|value| Uuid::parse_str(value.trim()).ok())
            .filter(|value| existing_provenance.contains_key(value));
        let Some(note) = clinical_opt_text(item.note) else {
            continue;
        };
        let item_case_id =
            match resolve_patient_case_attribution(&mut tx, patient_uuid, item.case_id.clone())
                .await
            {
                Ok(value) => value,
                Err(resp) => return resp,
            };
        if let Some(case_id) = item_case_id {
            used_cases.insert(case_id);
        }
        let occurred_on = match clinical_parse_date(item.occurred_on, "occurred_on") {
            Ok(value) => value,
            Err(resp) => return resp,
        };
        let (provider_id, doctor_id) =
            match clinical_resolve_attribution(&state, item.provider_id, item.doctor_id).await {
                Ok(pair) => pair,
                Err(resp) => return resp,
            };

        let saved_id = row_id.unwrap_or_else(Uuid::new_v4);
        let (source_document_id, source_import_id, source_candidate_id, source_page) = row_id
            .and_then(|id| existing_provenance.get(&id).cloned())
            .unwrap_or((None, None, None, None));
        if let Err(e) = sqlx::query(
            r#"INSERT INTO patient_clinical_verlauf
                   (id, patient_id, case_id, provider_id, doctor_id, occurred_on, note, sort_order,
                    source_document_id, source_import_id, source_candidate_id, source_page)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)"#,
        )
        .bind(saved_id)
        .bind(patient_uuid)
        .bind(item_case_id)
        .bind(provider_id)
        .bind(doctor_id)
        .bind(occurred_on)
        .bind(&note)
        .bind(saved)
        .bind(source_document_id)
        .bind(source_import_id)
        .bind(source_candidate_id)
        .bind(source_page)
        .execute(&mut *tx)
        .await
        {
            tracing::error!(error = %e, patient_id = %patient_uuid, "insert patient verlauf");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
        saved += 1;
    }

    let new_value = match load_patient_section_snapshot(
        &mut tx,
        patient_uuid,
        PatientClinicalSection::Verlauf,
    )
    .await
    {
        Ok(value) => value,
        Err(e) => {
            tracing::error!(error = %e, patient_id = %patient_uuid, "resnapshot patient verlauf");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };
    if let Err(e) = patient_version_log(
        &mut tx,
        patient_uuid,
        auth.user_id,
        PatientClinicalSection::Verlauf,
        version_log_case_id(&used_cases),
        retention_years,
        old_value,
        new_value,
    )
    .await
    {
        tracing::error!(error = %e, patient_id = %patient_uuid, "log patient verlauf version");
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
    }

    if let Err(e) = tx.commit().await {
        tracing::error!(error = %e, patient_id = %patient_uuid, "commit patient verlauf");
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
    }

    state.audit_sender.try_send(audit::domain_event(
        "save_patient_verlauf",
        Some(auth.user_id),
        "patient",
        Some(patient_uuid),
        json!({}),
    ));
    crate::realtime::publish_patient_event(
        &state,
        Some(auth.user_id),
        "patient.clinical_updated",
        patient_uuid,
        json!({ "section": "verlauf" }),
    )
    .await;
    Json(json!({ "ok": true, "count": saved })).into_response()
}

#[derive(Deserialize)]
struct PatientProcedureInput {
    #[serde(default)]
    case_id: Option<String>,
    #[serde(default)]
    provider_id: Option<String>,
    #[serde(default)]
    doctor_id: Option<String>,
    #[serde(default)]
    label: Option<String>,
    #[serde(default)]
    ops_code: Option<String>,
    #[serde(default)]
    performed_on: Option<String>,
    #[serde(default)]
    note: Option<String>,
}

/// One Allergie/CAVE entry from the replace-all clinical-warnings save. `kind`
/// is taken from the request body (not per item); `reaction`/`severity` are
/// allergy-only and ignored for CAVE rows.
#[derive(Deserialize)]
struct PatientClinicalWarningInput {
    #[serde(default)]
    id: Option<String>,
    #[serde(default)]
    label: Option<String>,
    #[serde(default)]
    reaction: Option<String>,
    #[serde(default)]
    severity: Option<String>,
    #[serde(default)]
    note: Option<String>,
}

/// Body for POST /patients/:id/clinical-warnings: replace-all for a single
/// `kind` ("allergie" | "cave").
#[derive(Deserialize)]
struct PatientClinicalWarningsBody {
    #[serde(default)]
    kind: Option<String>,
    #[serde(default)]
    items: Vec<PatientClinicalWarningInput>,
}

async fn save_patient_procedures(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(patient_uuid): Path<Uuid>,
    Json(body): Json<PatientClinicalItems<PatientProcedureInput>>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(PATIENT_CLINICAL_ROLES) {
        return e;
    }
    match has_patient_access(&state, &auth, patient_uuid).await {
        Ok(true) => {}
        Ok(false) => return err(StatusCode::FORBIDDEN, "Insufficient permissions"),
        Err(resp) => return resp,
    }

    let retention_years = load_patient_clinical_retention_years(&state, 30).await;
    let mut tx = match state.db.begin().await {
        Ok(tx) => tx,
        Err(e) => {
            tracing::error!(error = %e, "begin patient procedures tx");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };
    let old_value = match load_patient_section_snapshot(
        &mut tx,
        patient_uuid,
        PatientClinicalSection::Procedures,
    )
    .await
    {
        Ok(value) => value,
        Err(e) => {
            tracing::error!(error = %e, patient_id = %patient_uuid, "snapshot patient procedures");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };
    if let Err(e) = sqlx::query("DELETE FROM patient_procedures WHERE patient_id = $1")
        .bind(patient_uuid)
        .execute(&mut *tx)
        .await
    {
        tracing::error!(error = %e, patient_id = %patient_uuid, "delete patient procedures");
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
    }
    let mut used_cases: std::collections::HashSet<Uuid> = std::collections::HashSet::new();
    let mut saved = 0i32;
    for item in body.items {
        let Some(label) = clinical_opt_text(item.label) else {
            continue;
        };
        let item_case_id =
            match resolve_patient_case_attribution(&mut tx, patient_uuid, item.case_id.clone())
                .await
            {
                Ok(value) => value,
                Err(resp) => return resp,
            };
        if let Some(case_id) = item_case_id {
            used_cases.insert(case_id);
        }
        let (provider_id, doctor_id) =
            match clinical_resolve_attribution(&state, item.provider_id, item.doctor_id).await {
                Ok(pair) => pair,
                Err(resp) => return resp,
            };
        if let Err(e) = sqlx::query(
            "INSERT INTO patient_procedures (patient_id, case_id, provider_id, doctor_id, label, ops_code, performed_on, note, sort_order)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
        )
        .bind(patient_uuid)
        .bind(item_case_id)
        .bind(provider_id)
        .bind(doctor_id)
        .bind(&label)
        .bind(clinical_opt_text(item.ops_code))
        .bind(clinical_opt_text(item.performed_on))
        .bind(clinical_opt_text(item.note))
        .bind(saved)
        .execute(&mut *tx)
        .await
        {
            tracing::error!(error = %e, patient_id = %patient_uuid, "insert patient procedure");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
        saved += 1;
    }
    let new_value = match load_patient_section_snapshot(
        &mut tx,
        patient_uuid,
        PatientClinicalSection::Procedures,
    )
    .await
    {
        Ok(value) => value,
        Err(e) => {
            tracing::error!(error = %e, patient_id = %patient_uuid, "resnapshot patient procedures");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };
    if let Err(e) = patient_version_log(
        &mut tx,
        patient_uuid,
        auth.user_id,
        PatientClinicalSection::Procedures,
        version_log_case_id(&used_cases),
        retention_years,
        old_value,
        new_value,
    )
    .await
    {
        tracing::error!(error = %e, patient_id = %patient_uuid, "log patient procedures version");
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
    }
    if let Err(e) = tx.commit().await {
        tracing::error!(error = %e, patient_id = %patient_uuid, "commit patient procedures");
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
    }
    state.audit_sender.try_send(audit::domain_event(
        "save_patient_procedures",
        Some(auth.user_id),
        "patient",
        Some(patient_uuid),
        json!({ "count": saved }),
    ));
    crate::realtime::publish_patient_event(
        &state,
        Some(auth.user_id),
        "patient.clinical_updated",
        patient_uuid,
        json!({ "section": "procedures" }),
    )
    .await;
    Json(json!({ "ok": true, "count": saved })).into_response()
}

/// Replace-all save for ONE clinical-warnings list (Allergien or CAVE). The
/// request `kind` decides which list is replaced; the other kind's rows are
/// left untouched. Mirrors save_patient_diagnoses (tx DELETE-all + per-item
/// INSERT) but scoped to the single kind.
async fn save_patient_clinical_warnings(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(patient_uuid): Path<Uuid>,
    Query(query): Query<PatientClinicalSaveQuery>,
    Json(body): Json<PatientClinicalWarningsBody>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(PATIENT_CLINICAL_ROLES) {
        return e;
    }
    match has_patient_access(&state, &auth, patient_uuid).await {
        Ok(true) => {}
        Ok(false) => return err(StatusCode::FORBIDDEN, "Insufficient permissions"),
        Err(resp) => return resp,
    }

    let Some(kind) = clinical_one_of(body.kind, &["allergie", "cave"]) else {
        return err(StatusCode::UNPROCESSABLE_ENTITY, "Invalid kind");
    };
    let is_allergie = kind == "allergie";

    let retention_years = load_patient_clinical_retention_years(&state, 30).await;
    let mut tx = match state.db.begin().await {
        Ok(tx) => tx,
        Err(e) => {
            tracing::error!(error = %e, "begin patient clinical warnings tx");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };
    let old_value = match load_patient_section_snapshot(
        &mut tx,
        patient_uuid,
        PatientClinicalSection::ClinicalWarnings,
    )
    .await
    {
        Ok(value) => value,
        Err(e) => {
            tracing::error!(error = %e, patient_id = %patient_uuid, "snapshot patient clinical warnings");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };
    let merge_only = query.merge_only();
    let existing_ids: HashSet<Uuid> = match sqlx::query_scalar(
        "SELECT id FROM patient_clinical_warnings WHERE patient_id = $1 AND kind = $2",
    )
    .bind(patient_uuid)
    .bind(&kind)
    .fetch_all(&mut *tx)
    .await
    {
        Ok(ids) => ids.into_iter().collect(),
        Err(e) => {
            tracing::error!(error = %e, patient_id = %patient_uuid, "load patient clinical warning ids");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };
    if !merge_only
        && let Err(e) =
            sqlx::query("DELETE FROM patient_clinical_warnings WHERE patient_id = $1 AND kind = $2")
                .bind(patient_uuid)
                .bind(&kind)
                .execute(&mut *tx)
                .await
    {
        tracing::error!(error = %e, patient_id = %patient_uuid, "delete patient clinical warnings");
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
    }
    let mut saved = 0i32;
    for item in body.items {
        let row_id = item
            .id
            .as_deref()
            .and_then(|value| Uuid::parse_str(value.trim()).ok())
            .filter(|value| merge_only && existing_ids.contains(value));
        let Some(label) = clinical_opt_text(item.label) else {
            continue;
        };
        // reaction/severity are allergy-only; never persist them for CAVE rows.
        let reaction = if is_allergie {
            clinical_opt_text(item.reaction)
        } else {
            None
        };
        let severity = if is_allergie {
            clinical_opt_text(item.severity)
        } else {
            None
        };
        let new_id = row_id.unwrap_or_else(Uuid::new_v4);
        if let Err(e) = sqlx::query(
            "INSERT INTO patient_clinical_warnings AS warning
                 (id, patient_id, kind, label, reaction, severity, note, sort_order)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             ON CONFLICT (id) DO UPDATE SET
                 label = EXCLUDED.label,
                 reaction = EXCLUDED.reaction,
                 severity = EXCLUDED.severity,
                 note = EXCLUDED.note,
                 sort_order = EXCLUDED.sort_order
             WHERE warning.patient_id = EXCLUDED.patient_id
               AND warning.kind = EXCLUDED.kind",
        )
        .bind(new_id)
        .bind(patient_uuid)
        .bind(&kind)
        .bind(&label)
        .bind(reaction)
        .bind(severity)
        .bind(clinical_opt_text(item.note))
        .bind(saved)
        .execute(&mut *tx)
        .await
        {
            tracing::error!(error = %e, patient_id = %patient_uuid, "insert patient clinical warning");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
        saved += 1;
    }
    let new_value = match load_patient_section_snapshot(
        &mut tx,
        patient_uuid,
        PatientClinicalSection::ClinicalWarnings,
    )
    .await
    {
        Ok(value) => value,
        Err(e) => {
            tracing::error!(error = %e, patient_id = %patient_uuid, "resnapshot patient clinical warnings");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };
    if let Err(e) = patient_version_log(
        &mut tx,
        patient_uuid,
        auth.user_id,
        PatientClinicalSection::ClinicalWarnings,
        None,
        retention_years,
        old_value,
        new_value,
    )
    .await
    {
        tracing::error!(error = %e, patient_id = %patient_uuid, "log patient clinical warnings version");
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
    }
    if let Err(e) = tx.commit().await {
        tracing::error!(error = %e, patient_id = %patient_uuid, "commit patient clinical warnings");
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
    }
    state.audit_sender.try_send(audit::domain_event(
        "save_patient_clinical_warnings",
        Some(auth.user_id),
        "patient",
        Some(patient_uuid),
        json!({ "kind": kind, "count": saved }),
    ));
    crate::realtime::publish_patient_event(
        &state,
        Some(auth.user_id),
        "patient.clinical_updated",
        patient_uuid,
        json!({ "section": "clinical_warnings", "kind": kind }),
    )
    .await;
    Json(json!({ "ok": true, "count": saved })).into_response()
}

#[derive(Deserialize)]
struct PatientImpfstatusInput {
    #[serde(default)]
    status_text: Option<String>,
}

async fn get_patient_impfstatus(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(patient_uuid): Path<Uuid>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(PATIENT_CLINICAL_ROLES) {
        return e;
    }
    match has_patient_access(&state, &auth, patient_uuid).await {
        Ok(true) => {}
        Ok(false) => return err(StatusCode::FORBIDDEN, "Insufficient permissions"),
        Err(resp) => return resp,
    }
    let row = match sqlx::query(
        "SELECT status_text, updated_at FROM patient_impfstatus WHERE patient_id = $1",
    )
    .bind(patient_uuid)
    .fetch_optional(&state.db)
    .await
    {
        Ok(row) => row,
        Err(e) => {
            tracing::error!(error = %e, patient_id = %patient_uuid, "load patient impfstatus");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };
    let payload = row.map(|row| {
        json!({
            "status_text": row.get::<Option<String>, _>("status_text"),
            "updated_at": row.get::<chrono::DateTime<chrono::Utc>, _>("updated_at").to_rfc3339(),
        })
    });
    Json(json!({ "impfstatus": payload })).into_response()
}

/// Upsert the patient's Impfstatus (free-text 1:1 state, moved from the case
/// per RFC D4). Empty text clears the record but keeps the row for the trail.
async fn save_patient_impfstatus(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(patient_uuid): Path<Uuid>,
    Json(body): Json<PatientImpfstatusInput>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(PATIENT_CLINICAL_ROLES) {
        return e;
    }
    match has_patient_access(&state, &auth, patient_uuid).await {
        Ok(true) => {}
        Ok(false) => return err(StatusCode::FORBIDDEN, "Insufficient permissions"),
        Err(resp) => return resp,
    }
    let status_text = clinical_opt_text(body.status_text);
    let retention_years = load_patient_clinical_retention_years(&state, 30).await;
    let mut tx = match state.db.begin().await {
        Ok(tx) => tx,
        Err(e) => {
            tracing::error!(error = %e, "begin patient impfstatus tx");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };
    let old_value = match load_patient_section_snapshot(
        &mut tx,
        patient_uuid,
        PatientClinicalSection::Impfstatus,
    )
    .await
    {
        Ok(value) => value,
        Err(e) => {
            tracing::error!(error = %e, patient_id = %patient_uuid, "snapshot patient impfstatus");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };
    if let Err(e) = sqlx::query(
        "INSERT INTO patient_impfstatus (patient_id, status_text, updated_at)
         VALUES ($1, $2, now())
         ON CONFLICT (patient_id) DO UPDATE SET status_text = $2, updated_at = now()",
    )
    .bind(patient_uuid)
    .bind(&status_text)
    .execute(&mut *tx)
    .await
    {
        tracing::error!(error = %e, patient_id = %patient_uuid, "save patient impfstatus");
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
    }
    let new_value = match load_patient_section_snapshot(
        &mut tx,
        patient_uuid,
        PatientClinicalSection::Impfstatus,
    )
    .await
    {
        Ok(value) => value,
        Err(e) => {
            tracing::error!(error = %e, patient_id = %patient_uuid, "resnapshot patient impfstatus");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };
    if let Err(e) = patient_version_log(
        &mut tx,
        patient_uuid,
        auth.user_id,
        PatientClinicalSection::Impfstatus,
        None,
        retention_years,
        old_value,
        new_value,
    )
    .await
    {
        tracing::error!(error = %e, patient_id = %patient_uuid, "log patient impfstatus version");
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
    }
    if let Err(e) = tx.commit().await {
        tracing::error!(error = %e, patient_id = %patient_uuid, "commit patient impfstatus");
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
    }
    state.audit_sender.try_send(audit::domain_event(
        "save_patient_impfstatus",
        Some(auth.user_id),
        "patient",
        Some(patient_uuid),
        json!({}),
    ));
    crate::realtime::publish_patient_event(
        &state,
        Some(auth.user_id),
        "patient.clinical_updated",
        patient_uuid,
        json!({ "section": "impfstatus" }),
    )
    .await;
    Json(json!({ "ok": true })).into_response()
}

// ---------------------------------------------------------------------------
// Arztbrief (clinical profile) PDF export. Self-contained A4 layout built on
// printpdf directly (no dependency on the documents.rs PDF helpers).
// ---------------------------------------------------------------------------

const CLIN_PDF_W: f32 = 210.0;
const CLIN_PDF_H: f32 = 297.0;
const CLIN_PDF_LEFT: f32 = 18.0;
const CLIN_PDF_TOP: f32 = 18.0;
const CLIN_PDF_BOTTOM: f32 = 16.0;
const CLIN_PDF_CONTENT_W: f32 = CLIN_PDF_W - CLIN_PDF_LEFT - 18.0;

fn clin_pt_to_mm(value: f32) -> f32 {
    value * 0.352_778
}

fn clin_line_height(size_pt: f32) -> f32 {
    clin_pt_to_mm(size_pt) * 1.32
}

fn clin_wrap(text: &str, size_pt: f32, width_mm: f32) -> Vec<String> {
    let normalized = text.trim();
    if normalized.is_empty() {
        return Vec::new();
    }
    let avg = clin_pt_to_mm(size_pt) * 0.54;
    let max_chars = ((width_mm / avg).floor() as usize).max(18);
    let mut lines = Vec::new();
    let mut current = String::new();
    for word in normalized.split_whitespace() {
        let projected = if current.is_empty() {
            word.chars().count()
        } else {
            current.chars().count() + 1 + word.chars().count()
        };
        if projected <= max_chars {
            if !current.is_empty() {
                current.push(' ');
            }
            current.push_str(word);
        } else {
            if !current.is_empty() {
                lines.push(std::mem::take(&mut current));
            }
            current.push_str(word);
        }
    }
    if !current.is_empty() {
        lines.push(current);
    }
    lines
}

struct ClinPdf {
    pages: Vec<PdfPage>,
    ops: Vec<Op>,
    y: f32,
    regular: PdfFontHandle,
    bold: PdfFontHandle,
}

impl ClinPdf {
    fn new(regular: PdfFontHandle, bold: PdfFontHandle) -> Self {
        Self {
            pages: Vec::new(),
            ops: Vec::new(),
            y: CLIN_PDF_H - CLIN_PDF_TOP,
            regular,
            bold,
        }
    }

    fn flush_page(&mut self) {
        if self.ops.is_empty() {
            return;
        }
        self.pages.push(PdfPage::new(
            Mm(CLIN_PDF_W),
            Mm(CLIN_PDF_H),
            std::mem::take(&mut self.ops),
        ));
        self.y = CLIN_PDF_H - CLIN_PDF_TOP;
    }

    fn ensure(&mut self, need_mm: f32) {
        if self.y - need_mm < CLIN_PDF_BOTTOM {
            self.flush_page();
        }
    }

    fn gap(&mut self, mm: f32) {
        if mm > 0.0 {
            self.ensure(mm);
            self.y -= mm;
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn text(
        &mut self,
        text: &str,
        size_pt: f32,
        bold: bool,
        gray: bool,
        indent_mm: f32,
        before: f32,
        after: f32,
    ) {
        let lines = clin_wrap(text, size_pt, (CLIN_PDF_CONTENT_W - indent_mm).max(40.0));
        if lines.is_empty() {
            return;
        }
        if before > 0.0 {
            self.gap(before);
        }
        let lh = clin_line_height(size_pt);
        let x = CLIN_PDF_LEFT + indent_mm;
        let font = if bold {
            self.bold.clone()
        } else {
            self.regular.clone()
        };
        let col = if gray {
            Color::Rgb(Rgb::new(0.42, 0.46, 0.54, None))
        } else {
            Color::Rgb(Rgb::new(0.09, 0.12, 0.18, None))
        };
        for line in lines {
            self.ensure(lh);
            self.ops.push(Op::SetFont {
                font: font.clone(),
                size: Pt(size_pt),
            });
            self.ops.push(Op::StartTextSection);
            self.ops.push(Op::SetTextCursor {
                pos: Point::new(Mm(x), Mm(self.y)),
            });
            self.ops.push(Op::SetFillColor { col: col.clone() });
            self.ops.push(unicode_show_text_op(&line));
            self.ops.push(Op::EndTextSection);
            self.y -= lh;
        }
        if after > 0.0 {
            self.gap(after);
        }
    }

    fn heading(&mut self, text: &str) {
        self.text(text, 12.0, true, false, 0.0, 4.0, 1.0);
    }

    fn finish(mut self) -> Vec<PdfPage> {
        self.flush_page();
        self.pages
    }
}

/// "Dr. med. Doctor X · Provider Y" attribution from a joined clinical row.
fn clin_attribution(row: &sqlx::postgres::PgRow) -> Option<String> {
    let doctor = [
        row.try_get::<Option<String>, _>("doctor_title")
            .ok()
            .flatten(),
        row.try_get::<Option<String>, _>("doctor_name")
            .ok()
            .flatten(),
    ]
    .into_iter()
    .flatten()
    .collect::<Vec<_>>()
    .join(" ");
    let fachbereich = row
        .try_get::<Option<String>, _>("doctor_fachbereich")
        .ok()
        .flatten();
    let provider = row
        .try_get::<Option<String>, _>("provider_name")
        .ok()
        .flatten();
    let parts: Vec<String> = [
        if doctor.trim().is_empty() {
            None
        } else {
            Some(doctor)
        },
        fachbereich,
        provider,
    ]
    .into_iter()
    .flatten()
    .collect();
    if parts.is_empty() {
        None
    } else {
        Some(parts.join(" · "))
    }
}

async fn get_patient_clinical_pdf(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(patient_uuid): Path<Uuid>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(PATIENT_CLINICAL_ROLES) {
        return e;
    }
    match has_patient_access(&state, &auth, patient_uuid).await {
        Ok(true) => {}
        Ok(false) => return err(StatusCode::FORBIDDEN, "Insufficient permissions"),
        Err(resp) => return resp,
    }

    let fail = || {
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to build clinical PDF",
        )
    };

    let patient = match sqlx::query(
        "SELECT first_name, last_name, birth_date, patient_id FROM patients WHERE id = $1",
    )
    .bind(patient_uuid)
    .fetch_optional(&state.db)
    .await
    {
        Ok(Some(row)) => row,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Patient not found"),
        Err(e) => {
            tracing::error!(error = %e, patient_id = %patient_uuid, "load patient for clinical PDF");
            return fail();
        }
    };

    let diag_rows = match sqlx::query(
        r#"SELECT d.kind, d.label, d.icd_code, d.grade, d.laterality, d.status, d.diagnosed_on,
                  pv.name AS provider_name, dr.name AS doctor_name, dr.title AS doctor_title, dr.fachbereich AS doctor_fachbereich
           FROM patient_diagnoses d
           LEFT JOIN providers pv ON pv.id = d.provider_id
           LEFT JOIN provider_doctors dr ON dr.id = d.doctor_id
           WHERE d.patient_id = $1 ORDER BY d.sort_order, d.created_at"#,
    )
    .bind(patient_uuid)
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => rows,
        Err(_) => return fail(),
    };

    let proc_rows = match sqlx::query(
        r#"SELECT p2.label, p2.ops_code, p2.performed_on, p2.note,
                  pv.name AS provider_name, dr.name AS doctor_name, dr.title AS doctor_title, dr.fachbereich AS doctor_fachbereich
           FROM patient_procedures p2
           LEFT JOIN providers pv ON pv.id = p2.provider_id
           LEFT JOIN provider_doctors dr ON dr.id = p2.doctor_id
           WHERE p2.patient_id = $1 ORDER BY p2.sort_order, p2.created_at"#,
    )
    .bind(patient_uuid)
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => rows,
        Err(_) => return fail(),
    };

    let exam_rows = match sqlx::query(
        r#"SELECT e.title, e.performed_on, e.status, e.result,
                  pv.name AS provider_name, dr.name AS doctor_name, dr.title AS doctor_title, dr.fachbereich AS doctor_fachbereich
           FROM patient_examinations e
           LEFT JOIN providers pv ON pv.id = e.provider_id
           LEFT JOIN provider_doctors dr ON dr.id = e.doctor_id
           WHERE e.patient_id = $1 ORDER BY e.sort_order, e.created_at"#,
    )
    .bind(patient_uuid)
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => rows,
        Err(_) => return fail(),
    };

    let med_rows = match sqlx::query(
        r#"SELECT m.category, m.wirkstoff, m.handelsname, m.staerke, m.form,
                  m.dose_morgens, m.dose_mittags, m.dose_abends, m.dose_nachts, m.einheit, m.hinweis, m.grund,
                  pv.name AS provider_name, dr.name AS doctor_name, dr.title AS doctor_title, dr.fachbereich AS doctor_fachbereich
           FROM patient_medications m
           LEFT JOIN providers pv ON pv.id = m.provider_id
           LEFT JOIN provider_doctors dr ON dr.id = m.doctor_id
           WHERE m.patient_id = $1 AND m.superseded_at IS NULL
           ORDER BY m.sort_order, m.created_at"#,
    )
    .bind(patient_uuid)
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => rows,
        Err(_) => return fail(),
    };

    // Use the same fail-on-error pattern as the sibling queries: a DB error must
    // not be silently rendered as "no narrative", which would drop Anamnese /
    // Beurteilung / Verlauf from a clinical document without any signal.
    let narrative = match sqlx::query(
        r#"SELECT anamnese_aktuelle, anamnese_vorgeschichte, anamnese_vegetative, anamnese_sozial,
                  untersuchungsbefund, beurteilung
           FROM patient_clinical_narrative
           WHERE patient_id = $1 AND is_active
           ORDER BY updated_at DESC
           LIMIT 1"#,
    )
    .bind(patient_uuid)
    .fetch_optional(&state.db)
    .await
    {
        Ok(row) => row,
        Err(_) => return fail(),
    };

    let verlauf_rows = match sqlx::query(
        r#"SELECT v.occurred_on, v.note, p.name AS provider_name
           FROM patient_clinical_verlauf v
           LEFT JOIN providers p ON p.id = v.provider_id
           WHERE v.patient_id = $1
           ORDER BY v.occurred_on ASC NULLS LAST, v.created_at, v.sort_order"#,
    )
    .bind(patient_uuid)
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => rows,
        Err(_) => return fail(),
    };

    let first = patient
        .try_get::<Option<String>, _>("first_name")
        .ok()
        .flatten()
        .unwrap_or_default();
    let last = patient
        .try_get::<Option<String>, _>("last_name")
        .ok()
        .flatten()
        .unwrap_or_default();
    let mrn = patient
        .try_get::<Option<String>, _>("patient_id")
        .ok()
        .flatten()
        .unwrap_or_default();
    let dob = patient
        .try_get::<Option<chrono::NaiveDate>, _>("birth_date")
        .ok()
        .flatten()
        .map(|d| d.format("%d.%m.%Y").to_string())
        .unwrap_or_default();

    let mut document = PdfDocument::new("Arztbrief");
    let (regular_font, bold_font) = match add_unicode_pdf_fonts(&mut document) {
        Ok(fonts) => fonts,
        Err(error) => {
            tracing::error!(error, patient_id = %patient_uuid, "load fonts for clinical PDF");
            return fail();
        }
    };
    let mut pdf = ClinPdf::new(regular_font, bold_font);
    pdf.text("Arztbrief", 16.0, true, false, 0.0, 0.0, 1.0);
    pdf.text(
        format!("{} {}", first.trim(), last.trim()).trim(),
        12.0,
        true,
        false,
        0.0,
        0.0,
        0.5,
    );
    pdf.text(
        &format!(
            "Geb.: {dob}   ·   ID: {mrn}   ·   Stand: {}",
            chrono::Utc::now().format("%d.%m.%Y")
        ),
        9.0,
        false,
        true,
        0.0,
        0.0,
        2.5,
    );

    // ---- Diagnosen (Haupt / Neben) ----
    if !diag_rows.is_empty() {
        pdf.heading("Diagnosen");
        for (kind, header) in [("main", "Hauptdiagnose"), ("secondary", "Nebendiagnosen")] {
            let group: Vec<&sqlx::postgres::PgRow> = diag_rows
                .iter()
                .filter(|r| {
                    r.try_get::<String, _>("kind")
                        .map(|k| k == kind)
                        .unwrap_or(false)
                })
                .collect();
            if group.is_empty() {
                continue;
            }
            pdf.text(header, 9.0, true, true, 0.0, 1.0, 0.5);
            for row in group {
                let label = row.try_get::<String, _>("label").unwrap_or_default();
                let icd = row.try_get::<Option<String>, _>("icd_code").ok().flatten();
                let grade = row.try_get::<Option<String>, _>("grade").ok().flatten();
                let mut line = label;
                if let Some(g) = grade.filter(|g| !g.is_empty()) {
                    line.push_str(&format!(" {g}"));
                }
                if let Some(code) = icd.filter(|c| !c.is_empty()) {
                    line.push_str(&format!(" ({code})"));
                }
                pdf.text(&format!("• {line}"), 10.5, false, false, 3.0, 0.0, 0.0);
                if let Some(attr) = clin_attribution(row) {
                    pdf.text(&attr, 8.5, false, true, 6.0, 0.0, 0.5);
                }
            }
        }
    }

    // ---- Therapie ----
    if !proc_rows.is_empty() {
        pdf.heading("Therapie");
        for row in &proc_rows {
            let label = row.try_get::<String, _>("label").unwrap_or_default();
            let ops = row.try_get::<Option<String>, _>("ops_code").ok().flatten();
            let date = row
                .try_get::<Option<String>, _>("performed_on")
                .ok()
                .flatten();
            let mut line = String::new();
            if let Some(d) = date.filter(|d| !d.is_empty()) {
                line.push_str(&format!("{d} "));
            }
            line.push_str(&label);
            if let Some(code) = ops.filter(|c| !c.is_empty()) {
                line.push_str(&format!(" ({code})"));
            }
            pdf.text(&format!("• {line}"), 10.5, false, false, 3.0, 0.0, 0.0);
            if let Some(attr) = clin_attribution(row) {
                pdf.text(&attr, 8.5, false, true, 6.0, 0.0, 0.5);
            }
        }
    }

    // ---- Anamnese / Befund / Beurteilung ----
    if let Some(row) = &narrative {
        for (col, header) in [
            ("anamnese_aktuelle", "Aktuelle Anamnese"),
            ("anamnese_vorgeschichte", "Weitere Vorgeschichte"),
            ("anamnese_vegetative", "Vegetative Anamnese"),
            ("anamnese_sozial", "Sozialanamnese"),
            ("untersuchungsbefund", "Untersuchungsbefund"),
            ("beurteilung", "Beurteilung"),
        ] {
            if let Some(text) = row
                .try_get::<Option<String>, _>(col)
                .ok()
                .flatten()
                .filter(|t| !t.trim().is_empty())
            {
                pdf.text(header, 9.0, true, true, 0.0, 2.0, 0.5);
                pdf.text(&text, 10.5, false, false, 0.0, 0.0, 0.5);
            }
        }
    }

    if !verlauf_rows.is_empty() {
        pdf.heading("Verlauf");
        for row in &verlauf_rows {
            let date = row
                .try_get::<Option<chrono::NaiveDate>, _>("occurred_on")
                .ok()
                .flatten()
                .map(|value| value.format("%d.%m.%Y").to_string());
            let provider = row
                .try_get::<Option<String>, _>("provider_name")
                .ok()
                .flatten();
            let note = row.try_get::<String, _>("note").unwrap_or_default();
            let prefix = [date, provider]
                .into_iter()
                .flatten()
                .collect::<Vec<_>>()
                .join(" · ");
            let line = if prefix.is_empty() {
                note
            } else {
                format!("{prefix}: {note}")
            };
            pdf.text(&format!("• {line}"), 10.5, false, false, 3.0, 0.0, 0.5);
        }
    }

    // ---- Befunde ----
    if !exam_rows.is_empty() {
        pdf.heading("Befunde");
        for row in &exam_rows {
            let title = row.try_get::<String, _>("title").unwrap_or_default();
            let date = row
                .try_get::<Option<String>, _>("performed_on")
                .ok()
                .flatten();
            let status = row.try_get::<String, _>("status").unwrap_or_default();
            let result = row.try_get::<Option<String>, _>("result").ok().flatten();
            let mut head = title;
            if let Some(d) = date.filter(|d| !d.is_empty()) {
                head.push_str(&format!(" ({d})"));
            }
            if status == "pending" {
                head.push_str(" — Befund ausstehend");
            }
            pdf.text(&format!("• {head}"), 10.5, true, false, 3.0, 0.5, 0.0);
            if let Some(text) = result.filter(|t| !t.trim().is_empty()) {
                pdf.text(&text, 10.0, false, false, 6.0, 0.0, 0.0);
            }
            if let Some(attr) = clin_attribution(row) {
                pdf.text(&attr, 8.5, false, true, 6.0, 0.0, 0.5);
            }
        }
    }

    // ---- Medikation (by category) ----
    if !med_rows.is_empty() {
        pdf.heading("Medikation");
        for (cat, header) in [
            ("dauer", "Dauermedikation"),
            ("besondere", "Zu besonderen Zeiten"),
            ("selbst", "Selbstmedikation"),
        ] {
            let group: Vec<&sqlx::postgres::PgRow> = med_rows
                .iter()
                .filter(|r| {
                    r.try_get::<String, _>("category")
                        .map(|c| c == cat)
                        .unwrap_or(false)
                })
                .collect();
            if group.is_empty() {
                continue;
            }
            pdf.text(header, 9.0, true, true, 0.0, 1.0, 0.5);
            for row in group {
                let name = row.try_get::<String, _>("handelsname").unwrap_or_default();
                let staerke = row.try_get::<Option<String>, _>("staerke").ok().flatten();
                let form = row.try_get::<Option<String>, _>("form").ok().flatten();
                let dosing = [
                    row.try_get::<Option<String>, _>("dose_morgens")
                        .ok()
                        .flatten(),
                    row.try_get::<Option<String>, _>("dose_mittags")
                        .ok()
                        .flatten(),
                    row.try_get::<Option<String>, _>("dose_abends")
                        .ok()
                        .flatten(),
                    row.try_get::<Option<String>, _>("dose_nachts")
                        .ok()
                        .flatten(),
                ]
                .into_iter()
                .map(|v| v.unwrap_or_else(|| "0".to_string()))
                .collect::<Vec<_>>()
                .join("-");
                let einheit = row
                    .try_get::<Option<String>, _>("einheit")
                    .ok()
                    .flatten()
                    .unwrap_or_default();
                let grund = row.try_get::<Option<String>, _>("grund").ok().flatten();
                let mut line = name;
                if let Some(s) = staerke.filter(|s| !s.is_empty()) {
                    line.push_str(&format!(" {s}"));
                }
                if let Some(f) = form.filter(|f| !f.is_empty()) {
                    line.push_str(&format!(" {f}"));
                }
                line.push_str(&format!("  [{dosing} {einheit}]"));
                if let Some(g) = grund.filter(|g| !g.is_empty()) {
                    line.push_str(&format!("  — {g}"));
                }
                pdf.text(&format!("• {line}"), 10.0, false, false, 3.0, 0.0, 0.0);
            }
        }
    }

    let mut warnings: Vec<PdfWarnMsg> = Vec::new();
    let bytes = document
        .with_pages(pdf.finish())
        .save(&pdf_text_save_options(), &mut warnings);

    state.audit_sender.try_send(audit::domain_event(
        "export_patient_clinical_pdf",
        Some(auth.user_id),
        "patient",
        Some(patient_uuid),
        json!({ "bytes": bytes.len() }),
    ));

    let slug: String = mrn
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' {
                c
            } else {
                '-'
            }
        })
        .collect();
    let slug = slug.trim_matches('-');
    let filename = if slug.is_empty() {
        "arztbrief.pdf".to_string()
    } else {
        format!("arztbrief-{slug}.pdf")
    };

    (
        [
            (
                axum::http::header::CONTENT_TYPE,
                "application/pdf".to_string(),
            ),
            (
                axum::http::header::CONTENT_DISPOSITION,
                format!("inline; filename=\"{filename}\""),
            ),
        ],
        bytes,
    )
        .into_response()
}

// ---------------------------------------------------------------------------
// Bundeseinheitlicher Medikationsplan (BMP) — printable A4 plan with a real
// ECC200 Data-Matrix carrier (see crate::bmp). Single page.
// ---------------------------------------------------------------------------

const MP_LEFT: f32 = 14.0;
const MP_RIGHT: f32 = 196.0;
const MP_TOP: f32 = 283.0;
const MP_BOTTOM: f32 = 14.0;
/// Column widths (mm); sum == MP_RIGHT - MP_LEFT (182).
const MP_COLS: [f32; 11] = [30.0, 28.0, 16.0, 14.0, 7.0, 7.0, 7.0, 7.0, 14.0, 30.0, 22.0];

fn mp_pt(mm: f32) -> Pt {
    Pt(mm * 2.834_646)
}
fn mp_ink() -> Color {
    Color::Rgb(Rgb::new(0.09, 0.12, 0.18, None))
}
fn mp_grid() -> Color {
    Color::Rgb(Rgb::new(0.55, 0.57, 0.62, None))
}
fn mp_col_x(i: usize) -> f32 {
    MP_LEFT + MP_COLS[..i].iter().sum::<f32>()
}

struct MedPlan {
    ops: Vec<Op>,
    regular: PdfFontHandle,
    bold: PdfFontHandle,
}

impl MedPlan {
    fn new(regular: PdfFontHandle, bold: PdfFontHandle) -> Self {
        Self {
            ops: Vec::new(),
            regular,
            bold,
        }
    }

    /// Filled rectangle; (x, y) is the lower-left corner, all in mm.
    fn fill_rect(&mut self, x: f32, y: f32, w: f32, h: f32, col: Color) {
        let rect = Rect {
            x: mp_pt(x),
            y: mp_pt(y),
            width: mp_pt(w),
            height: mp_pt(h),
            mode: Some(PaintMode::Fill),
            winding_order: Some(WindingOrder::NonZero),
        };
        self.ops.push(Op::SetFillColor { col });
        self.ops.push(Op::DrawPolygon {
            polygon: rect.to_polygon(),
        });
    }

    fn hline(&mut self, x: f32, y: f32, w: f32) {
        self.fill_rect(x, y, w, 0.25, mp_grid());
    }
    fn vline(&mut self, x: f32, y: f32, h: f32) {
        self.fill_rect(x, y, 0.25, h, mp_grid());
    }

    fn text_at(&mut self, x: f32, baseline: f32, text: &str, size: f32, bold: bool, col: Color) {
        if text.is_empty() {
            return;
        }
        let font = if bold {
            self.bold.clone()
        } else {
            self.regular.clone()
        };
        self.ops.push(Op::SetFont {
            font,
            size: Pt(size),
        });
        self.ops.push(Op::StartTextSection);
        self.ops.push(Op::SetTextCursor {
            pos: Point::new(Mm(x), Mm(baseline)),
        });
        self.ops.push(Op::SetFillColor { col });
        self.ops.push(unicode_show_text_op(text));
        self.ops.push(Op::EndTextSection);
    }

    /// Draws the Data-Matrix as filled square modules. `y_top` is the top edge.
    fn draw_datamatrix(
        &mut self,
        modules: &[(usize, usize)],
        cols: usize,
        rows: usize,
        x: f32,
        y_top: f32,
        target_mm: f32,
    ) {
        let n = cols.max(rows).max(1);
        let cell = target_mm / n as f32;
        let black = Color::Rgb(Rgb::new(0.0, 0.0, 0.0, None));
        for &(mx, my) in modules {
            let px = x + mx as f32 * cell;
            let py = y_top - (my as f32 + 1.0) * cell;
            self.fill_rect(px, py, cell, cell, black.clone());
        }
    }

    fn table_header(&mut self, y_top: f32) -> f32 {
        let labels = [
            "Wirkstoff",
            "Handelsname",
            "Stärke",
            "Form",
            "Morgens",
            "Mittags",
            "Abends",
            "Zur Nacht",
            "Einheit",
            "Hinweise",
            "Grund",
        ];
        let row_h = 8.0;
        let y_bottom = y_top - row_h;
        self.fill_rect(
            MP_LEFT,
            y_bottom,
            MP_RIGHT - MP_LEFT,
            row_h,
            Color::Rgb(Rgb::new(0.84, 0.84, 0.87, None)),
        );
        self.hline(MP_LEFT, y_top, MP_RIGHT - MP_LEFT);
        for i in 0..=11 {
            self.vline(mp_col_x(i), y_bottom, row_h);
        }
        for (i, label) in labels.iter().enumerate() {
            let cx = mp_col_x(i);
            let lines = clin_wrap(label, 7.0, (MP_COLS[i] - 1.5).max(4.0));
            let mut ty = y_top - 3.0;
            for line in lines.iter().take(2) {
                self.text_at(cx + 0.9, ty, line, 7.0, true, mp_ink());
                ty -= 2.7;
            }
        }
        y_bottom
    }

    fn table_section(&mut self, label: &str, y_top: f32) -> f32 {
        let row_h = 6.0;
        let y_bottom = y_top - row_h;
        self.fill_rect(
            MP_LEFT,
            y_bottom,
            MP_RIGHT - MP_LEFT,
            row_h,
            Color::Rgb(Rgb::new(0.93, 0.93, 0.95, None)),
        );
        self.hline(MP_LEFT, y_top, MP_RIGHT - MP_LEFT);
        self.vline(MP_LEFT, y_bottom, row_h);
        self.vline(MP_RIGHT, y_bottom, row_h);
        self.text_at(MP_LEFT + 1.5, y_top - 4.2, label, 9.0, true, mp_ink());
        y_bottom
    }

    fn table_med(&mut self, cells: &[String; 11], y_top: f32) -> f32 {
        let size = 8.0;
        let lh = 3.0;
        let pad = 1.2;
        let mut wrapped: Vec<Vec<String>> = Vec::with_capacity(11);
        let mut max_lines = 1usize;
        for (i, cell) in cells.iter().enumerate() {
            let lines = clin_wrap(cell, size, (MP_COLS[i] - 2.0 * pad).max(4.0));
            max_lines = max_lines.max(lines.len().max(1));
            wrapped.push(lines);
        }
        let row_h = max_lines as f32 * lh + 2.0 * pad;
        let y_bottom = y_top - row_h;
        self.hline(MP_LEFT, y_top, MP_RIGHT - MP_LEFT);
        for i in 0..=11 {
            self.vline(mp_col_x(i), y_bottom, row_h);
        }
        for (i, lines) in wrapped.iter().enumerate() {
            let cx = mp_col_x(i);
            let centered = (4..8).contains(&i);
            let mut ty = y_top - pad - 2.2;
            for line in lines {
                let tx = if centered {
                    cx + (MP_COLS[i] - line.chars().count() as f32 * size * 0.17) / 2.0
                } else {
                    cx + pad
                };
                self.text_at(tx.max(cx + 0.5), ty, line, size, false, mp_ink());
                ty -= lh;
            }
        }
        y_bottom
    }

    fn finish(self) -> Vec<PdfPage> {
        vec![PdfPage::new(Mm(CLIN_PDF_W), Mm(CLIN_PDF_H), self.ops)]
    }
}

fn mp_dose(value: Option<&str>) -> String {
    value
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("")
        .to_string()
}

async fn get_patient_medikationsplan_pdf(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(patient_uuid): Path<Uuid>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(PATIENT_CLINICAL_ROLES) {
        return e;
    }
    match has_patient_access(&state, &auth, patient_uuid).await {
        Ok(true) => {}
        Ok(false) => return err(StatusCode::FORBIDDEN, "Insufficient permissions"),
        Err(resp) => return resp,
    }

    let fail = || {
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to build Medikationsplan PDF",
        )
    };

    let patient = match sqlx::query(
        "SELECT first_name, last_name, birth_date, gender, patient_id FROM patients WHERE id = $1",
    )
    .bind(patient_uuid)
    .fetch_optional(&state.db)
    .await
    {
        Ok(Some(row)) => row,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Patient not found"),
        Err(e) => {
            tracing::error!(error = %e, patient_id = %patient_uuid, "load patient for Medikationsplan");
            return fail();
        }
    };

    let med_rows = match sqlx::query(
        r#"SELECT category, wirkstoff, handelsname, staerke, form,
                  dose_morgens, dose_mittags, dose_abends, dose_nachts, einheit, hinweis, grund
           FROM patient_medications
           WHERE patient_id = $1 AND superseded_at IS NULL
             AND status = 'aktiv' AND NOT COALESCE(on_hold, false)
           ORDER BY sort_order, created_at"#,
    )
    .bind(patient_uuid)
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => rows,
        Err(e) => {
            tracing::error!(error = %e, patient_id = %patient_uuid, "load medications for Medikationsplan");
            return fail();
        }
    };

    let issuer_row = sqlx::query(
        r#"SELECT name, email,
                  (SELECT value #>> '{}' FROM system_settings WHERE key = 'agency_name') AS agency_name
           FROM users
           WHERE id = $1"#,
    )
        .bind(auth.user_id)
        .fetch_optional(&state.db)
        .await
        .ok()
        .flatten();
    let issuer_name = issuer_row
        .as_ref()
        .and_then(|r| r.try_get::<Option<String>, _>("name").ok().flatten())
        .filter(|s| !s.trim().is_empty())
        .or_else(|| {
            issuer_row
                .as_ref()
                .and_then(|r| r.try_get::<Option<String>, _>("agency_name").ok().flatten())
                .filter(|s| !s.trim().is_empty())
        })
        .unwrap_or_else(|| "System".to_string());
    let issuer_email = issuer_row
        .as_ref()
        .and_then(|r| r.try_get::<Option<String>, _>("email").ok().flatten());

    let first_name: String = patient.try_get("first_name").unwrap_or_default();
    let last_name: String = patient.try_get("last_name").unwrap_or_default();
    let mrn: String = patient.try_get("patient_id").unwrap_or_default();
    let dob = patient
        .try_get::<Option<chrono::NaiveDate>, _>("birth_date")
        .ok()
        .flatten()
        .map(|d| d.format("%Y-%m-%d").to_string());
    let geschlecht = match patient
        .try_get::<Option<String>, _>("gender")
        .ok()
        .flatten()
        .as_deref()
    {
        Some("male") => Some("M".to_string()),
        Some("female") => Some("W".to_string()),
        Some("diverse") => Some("X".to_string()),
        _ => None,
    };

    let meds: Vec<crate::bmp::BmpMed> = med_rows
        .iter()
        .map(|row| crate::bmp::BmpMed {
            category: row.try_get::<String, _>("category").unwrap_or_default(),
            wirkstoff: row.try_get("wirkstoff").ok().flatten(),
            handelsname: row.try_get("handelsname").ok().flatten(),
            staerke: row.try_get("staerke").ok().flatten(),
            form: row.try_get("form").ok().flatten(),
            dose_morgens: row.try_get("dose_morgens").ok().flatten(),
            dose_mittags: row.try_get("dose_mittags").ok().flatten(),
            dose_abends: row.try_get("dose_abends").ok().flatten(),
            dose_nachts: row.try_get("dose_nachts").ok().flatten(),
            einheit: row.try_get("einheit").ok().flatten(),
            hinweis: row.try_get("hinweis").ok().flatten(),
            grund: row.try_get("grund").ok().flatten(),
        })
        .collect();

    let print_date = chrono::Utc::now().format("%Y-%m-%d").to_string();
    let plan_uuid = Uuid::new_v4().simple().to_string().to_uppercase();
    let patient_bmp = crate::bmp::BmpPatient {
        vorname: first_name.clone(),
        nachname: last_name.clone(),
        geburtsdatum: dob.clone(),
        geschlecht,
    };
    let issuer_bmp = crate::bmp::BmpIssuer {
        name: issuer_name.clone(),
        email: issuer_email.clone(),
        ..Default::default()
    };
    let xml = crate::bmp::build_bmp_xml(&plan_uuid, &patient_bmp, &issuer_bmp, &print_date, &meds);
    let datamatrix = crate::bmp::encode_datamatrix(&xml);

    // ---- Render ----
    let mut document = PdfDocument::new("Medikationsplan");
    let (regular_font, bold_font) = match add_unicode_pdf_fonts(&mut document) {
        Ok(fonts) => fonts,
        Err(error) => {
            tracing::error!(error, patient_id = %patient_uuid, "load fonts for Medikationsplan");
            return fail();
        }
    };
    let mut pdf = MedPlan::new(regular_font, bold_font);
    let full_name = format!("{first_name} {last_name}").trim().to_string();

    pdf.text_at(MP_LEFT, MP_TOP, "Medikationsplan", 17.0, true, mp_ink());
    pdf.text_at(
        MP_LEFT,
        MP_TOP - 8.5,
        &format!("Für: {full_name}"),
        10.0,
        true,
        mp_ink(),
    );
    pdf.text_at(
        MP_LEFT,
        MP_TOP - 13.5,
        &format!("Geb. am: {}", dob.as_deref().unwrap_or("—")),
        9.0,
        false,
        mp_ink(),
    );
    pdf.text_at(
        MP_LEFT,
        MP_TOP - 20.0,
        &format!("Ausgedruckt von: {issuer_name}"),
        9.0,
        false,
        mp_ink(),
    );
    if let Some(email) = issuer_email.as_deref() {
        pdf.text_at(MP_LEFT, MP_TOP - 24.5, email, 9.0, false, mp_ink());
    }
    pdf.text_at(
        MP_LEFT,
        MP_TOP - 29.0,
        &format!("Ausgedruckt am: {print_date}"),
        9.0,
        false,
        mp_ink(),
    );

    if let Some((modules, cols, rows)) = datamatrix.as_ref() {
        pdf.draw_datamatrix(modules, *cols, *rows, MP_RIGHT - 26.0, MP_TOP + 2.0, 26.0);
    }

    let mut y = MP_TOP - 36.0;
    y = pdf.table_header(y);

    let sections: [(&str, Option<&str>); 3] = [
        ("dauer", None),
        (
            "besondere",
            Some("Zu besonderen Zeiten anzuwendende Medikamente"),
        ),
        ("selbst", Some("Selbstmedikation")),
    ];
    let mut truncated = false;
    'outer: for (key, heading) in sections {
        let rows: Vec<&crate::bmp::BmpMed> = meds.iter().filter(|m| m.category == key).collect();
        if rows.is_empty() {
            continue;
        }
        if let Some(h) = heading {
            if y - 6.0 < MP_BOTTOM {
                truncated = true;
                break;
            }
            y = pdf.table_section(h, y);
        }
        for m in rows {
            let opt = |v: &Option<String>| v.clone().unwrap_or_default();
            let cells: [String; 11] = [
                opt(&m.wirkstoff),
                opt(&m.handelsname),
                opt(&m.staerke),
                opt(&m.form),
                mp_dose(m.dose_morgens.as_deref()),
                mp_dose(m.dose_mittags.as_deref()),
                mp_dose(m.dose_abends.as_deref()),
                mp_dose(m.dose_nachts.as_deref()),
                opt(&m.einheit),
                opt(&m.hinweis),
                opt(&m.grund),
            ];
            // Stop before overflowing the page (rough lower bound for one row).
            if y - 14.0 < MP_BOTTOM {
                truncated = true;
                break 'outer;
            }
            y = pdf.table_med(&cells, y);
        }
    }
    if truncated {
        pdf.text_at(
            MP_LEFT,
            MP_BOTTOM - 2.0,
            "… weitere Einträge nicht dargestellt (einseitig).",
            7.0,
            false,
            mp_grid(),
        );
    }

    let mut warnings: Vec<PdfWarnMsg> = Vec::new();
    let bytes = document
        .with_pages(pdf.finish())
        .save(&pdf_text_save_options(), &mut warnings);

    state.audit_sender.try_send(audit::domain_event(
        "export_patient_medikationsplan_pdf",
        Some(auth.user_id),
        "patient",
        Some(patient_uuid),
        json!({ "bytes": bytes.len(), "datamatrix": datamatrix.is_some() }),
    ));

    let slug: String = mrn
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' {
                c
            } else {
                '-'
            }
        })
        .collect();
    let slug = slug.trim_matches('-');
    let filename = if slug.is_empty() {
        "medikationsplan.pdf".to_string()
    } else {
        format!("medikationsplan-{slug}.pdf")
    };

    (
        [
            (
                axum::http::header::CONTENT_TYPE,
                "application/pdf".to_string(),
            ),
            (
                axum::http::header::CONTENT_DISPOSITION,
                format!("inline; filename=\"{filename}\""),
            ),
        ],
        bytes,
    )
        .into_response()
}

#[cfg(test)]
mod unicode_pdf_tests {
    use super::{
        ClinPdf, MedPlan, add_unicode_pdf_fonts, mp_ink,
        normalize_patient_lab_result_correction_payload, normalize_patient_lab_result_payload,
        normalize_patient_vital_measurement_payload, pdf_text_save_options,
    };
    use printpdf::{PdfDocument, PdfWarnMsg};
    use serde_json::json;

    #[test]
    fn vital_measurement_preserves_date_precision() {
        let date_only = normalize_patient_vital_measurement_payload(&json!({
            "measured_at": "2026-08-11",
            "heart_rate": 68,
        }))
        .expect("date-only vital should normalize");
        assert_eq!(date_only.measured_at_precision, "date");

        let timestamp = normalize_patient_vital_measurement_payload(&json!({
            "measured_at": "2026-08-11T09:00:00Z",
            "heart_rate": 68,
        }))
        .expect("timestamped vital should normalize");
        assert_eq!(timestamp.measured_at_precision, "datetime");

        assert!(
            normalize_patient_vital_measurement_payload(&json!({
                "measured_at": "2026-08-11T09:00:00",
                "heart_rate": 68,
                "source_country": "DE",
                "source_import_id": uuid::Uuid::nil(),
                "source_candidate_id": "vital-1",
            }))
            .is_err(),
            "imported naive datetimes must not be interpreted as UTC",
        );
    }

    #[test]
    fn lab_result_preserves_date_precision_and_rejects_imported_naive_time() {
        let date_only = normalize_patient_lab_result_payload(&json!({
            "measured_at": "2026-08-11",
            "analyte_name": "Leukocytes",
            "result_text": "6.1",
        }))
        .expect("date-only lab result should normalize");
        assert_eq!(date_only.measured_at_precision, "date");

        assert!(
            normalize_patient_lab_result_payload(&json!({
                "measured_at": "2026-08-11T09:00:00",
                "analyte_name": "Leukocytes",
                "result_text": "6.1",
                "source_country": "DE",
                "source_import_id": uuid::Uuid::nil(),
                "source_candidate_id": "lab-1",
            }))
            .is_err(),
            "imported naive lab datetimes must not be interpreted as UTC",
        );
    }

    #[test]
    fn lab_correction_note_limit_counts_unicode_characters() {
        let payload = |correction_note: String| {
            json!({
                "measured_at": "2026-08-11",
                "analyte_name": "Hemoglobin",
                "result_text": "12.8",
                "numeric_result": 12.8,
                "abnormal_flag": "normal",
                "correction_note": correction_note,
            })
        };

        assert!(
            normalize_patient_lab_result_correction_payload(&payload("я".repeat(500))).is_ok(),
            "500 Unicode characters must be accepted",
        );
        assert!(
            normalize_patient_lab_result_correction_payload(&payload("я".repeat(501))).is_err(),
            "501 Unicode characters must be rejected",
        );
    }

    #[test]
    fn lab_correction_requires_consistent_text_and_numeric_projection() {
        assert!(
            normalize_patient_lab_result_correction_payload(&json!({
                "measured_at": "2026-08-11",
                "analyte_name": "Leukozyten",
                "result_text": "14.000",
                "numeric_result": 14000.0,
                "unit": "/μL",
                "abnormal_flag": "unknown",
                "correction_note": "Checked against source",
            }))
            .is_ok(),
            "German thousands grouping must match the explicit numeric projection",
        );
        assert!(
            normalize_patient_lab_result_correction_payload(&json!({
                "measured_at": "2026-08-11",
                "analyte_name": "CRP",
                "result_text": "≤ 0,5 mg/L",
                "numeric_result": 0.5,
                "comparator": "<=",
                "unit": "mg/L",
                "abnormal_flag": "unknown",
                "correction_note": "Checked against source",
            }))
            .is_ok(),
            "comma decimals with a canonicalized Unicode comparator must be accepted",
        );
        for grouped in ["14 000", "14\u{00a0}000", "14\u{202f}000"] {
            assert!(
                normalize_patient_lab_result_correction_payload(&json!({
                    "measured_at": "2026-08-11",
                    "analyte_name": "Leukozyten",
                    "result_text": grouped,
                    "numeric_result": 14000.0,
                    "unit": "/μL",
                    "abnormal_flag": "unknown",
                    "correction_note": "Checked against source",
                }))
                .is_ok(),
                "grouping whitespace in {grouped:?} must be accepted",
            );
        }
        assert!(
            normalize_patient_lab_result_correction_payload(&json!({
                "measured_at": "2026-08-11",
                "analyte_name": "Qualitative result",
                "result_text": "negative",
                "numeric_result": 0.0,
                "abnormal_flag": "normal",
                "correction_note": "Checked against source",
            }))
            .is_err(),
            "textual results must not retain a stale numeric projection",
        );
        for complex_result in ["2+", "1:80", "0-1"] {
            assert!(
                normalize_patient_lab_result_correction_payload(&json!({
                    "measured_at": "2026-08-11",
                    "analyte_name": "Complex qualitative result",
                    "result_text": complex_result,
                    "abnormal_flag": "unknown",
                    "correction_note": "Checked against source",
                }))
                .is_ok(),
                "{complex_result:?} must remain a correctable complex textual value",
            );
        }
        assert!(
            normalize_patient_lab_result_correction_payload(&json!({
                "measured_at": "2026-08-11",
                "analyte_name": "Semi-quantitative result",
                "result_text": "2+",
                "numeric_result": 2.0,
                "abnormal_flag": "unknown",
                "correction_note": "Checked against source",
            }))
            .is_err(),
            "complex textual values must reject a stale numeric projection",
        );
        assert!(
            normalize_patient_lab_result_correction_payload(&json!({
                "measured_at": "2026-08-11",
                "analyte_name": "Hemoglobin",
                "result_text": "13.2 (H)",
                "numeric_result": 13.2,
                "abnormal_flag": "high",
                "correction_note": "Checked against source",
            }))
            .is_ok(),
            "a known high annotation must not be interpreted as a unit",
        );
        assert!(
            normalize_patient_lab_result_correction_payload(&json!({
                "measured_at": "2026-08-11",
                "analyte_name": "Hemoglobin",
                "result_text": "13.2 (H)",
                "numeric_result": 13.2,
                "abnormal_flag": "normal",
                "correction_note": "Checked against source",
            }))
            .is_err(),
            "a high annotation must reject a contradictory abnormal_flag",
        );
        assert!(
            normalize_patient_lab_result_correction_payload(&json!({
                "measured_at": "2026-08-11",
                "analyte_name": "Localized value",
                "result_text": "1.234,5",
                "numeric_result": 1234.5,
                "abnormal_flag": "unknown",
                "correction_note": "Checked against source",
            }))
            .is_ok(),
            "mixed German grouping/decimal separators must be supported",
        );
        assert!(
            normalize_patient_lab_result_correction_payload(&json!({
                "measured_at": "2026-08-11",
                "analyte_name": "Localized value",
                "result_text": "1,234.5",
                "numeric_result": 1234.5,
                "abnormal_flag": "unknown",
                "correction_note": "Checked against source",
            }))
            .is_ok(),
            "mixed English grouping/decimal separators must be supported",
        );
    }

    #[test]
    fn arztbrief_pdf_preserves_cyrillic_text() {
        let mut document = PdfDocument::new("Arztbrief Unicode test");
        let (regular, bold) = add_unicode_pdf_fonts(&mut document).unwrap();
        let mut layout = ClinPdf::new(regular, bold);
        layout.text(
            "Пацієнт: Олександр Іванов",
            12.0,
            false,
            false,
            0.0,
            0.0,
            0.0,
        );

        let mut warnings: Vec<PdfWarnMsg> = Vec::new();
        let bytes = document
            .with_pages(layout.finish())
            .save(&pdf_text_save_options(), &mut warnings);
        let text = pdf_extract::extract_text_from_mem(&bytes).unwrap();

        assert!(text.contains("Пацієнт: Олександр Іванов"));
    }

    #[test]
    fn medikationsplan_pdf_preserves_cyrillic_text() {
        let mut document = PdfDocument::new("Medikationsplan Unicode test");
        let (regular, bold) = add_unicode_pdf_fonts(&mut document).unwrap();
        let mut layout = MedPlan::new(regular, bold);
        layout.text_at(14.0, 283.0, "Препарат: Метформін", 12.0, false, mp_ink());

        let mut warnings: Vec<PdfWarnMsg> = Vec::new();
        let bytes = document
            .with_pages(layout.finish())
            .save(&pdf_text_save_options(), &mut warnings);
        let text = pdf_extract::extract_text_from_mem(&bytes).unwrap();

        assert!(text.contains("Препарат: Метформін"));
    }
}
