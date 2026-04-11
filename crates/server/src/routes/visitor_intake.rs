use axum::{
    Json, Router,
    extract::{Multipart, State},
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
    routing::post,
};
use chrono::NaiveDate;
use serde_json::{Value, json};
use uuid::Uuid;

use crate::state::AppState;

const MAX_ATTACHMENT_BYTES: usize = 25 * 1024 * 1024;
const MAX_BUNDLE_BYTES: usize = 512 * 1024;
const MAX_ATTACHMENTS: usize = 20;

pub fn public_router() -> Router<AppState> {
    Router::new().route("/public/visitor-intake", post(ingest_visitor_intake))
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

fn required_env(name: &str) -> Option<String> {
    std::env::var(name)
        .ok()
        .and_then(|v| if v.trim().is_empty() { None } else { Some(v) })
}

fn check_shared_token(headers: &HeaderMap) -> Result<(), axum::response::Response> {
    let Some(expected) = required_env("VISITOR_INTAKE_TOKEN") else {
        tracing::error!("VISITOR_INTAKE_TOKEN not configured");
        return Err(err(
            StatusCode::SERVICE_UNAVAILABLE,
            "Intake endpoint not configured",
        ));
    };
    let provided = headers
        .get("x-intake-token")
        .and_then(|v| v.to_str().ok())
        .unwrap_or_default();
    if provided != expected.as_str() {
        return Err(err(StatusCode::UNAUTHORIZED, "Invalid intake token"));
    }
    Ok(())
}

fn str_opt(v: &Value) -> Option<String> {
    let s = v.as_str()?.trim();
    if s.is_empty() {
        None
    } else {
        Some(s.to_string())
    }
}

fn yes_no_to_bool(v: &Value) -> Option<bool> {
    match v.as_str()?.trim().to_ascii_lowercase().as_str() {
        "yes" | "true" => Some(true),
        "no" | "false" => Some(false),
        _ => None,
    }
}

fn bool_opt(v: &Value) -> Option<bool> {
    v.as_bool()
}

fn date_opt(v: &Value) -> Option<NaiveDate> {
    let s = v.as_str()?.trim();
    if s.is_empty() {
        return None;
    }
    NaiveDate::parse_from_str(s, "%Y-%m-%d").ok()
}

fn string_array(v: &Value) -> Vec<String> {
    v.as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|item| item.as_str().map(|s| s.trim().to_string()))
                .filter(|s| !s.is_empty())
                .collect()
        })
        .unwrap_or_default()
}

fn first_phone(phones: &Value) -> (Option<String>, Option<String>) {
    let Some(arr) = phones.as_array() else {
        return (None, None);
    };
    let Some(first) = arr.first() else {
        return (None, None);
    };
    let number = first
        .get("number")
        .and_then(str_opt)
        .map(|n| n.trim().to_string())
        .filter(|s| !s.is_empty());
    let kind = first.get("type").and_then(str_opt);
    (number, kind)
}

struct ParsedIntake {
    bundle_raw: String,
    bundle: Value,
    files: Vec<ParsedFile>,
}

struct ParsedFile {
    file_name: String,
    content_type: Option<String>,
    data: Vec<u8>,
}

async fn parse_multipart(
    mut multipart: Multipart,
) -> Result<ParsedIntake, axum::response::Response> {
    let mut bundle_raw: Option<String> = None;
    let mut files: Vec<ParsedFile> = Vec::new();

    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|e| err(StatusCode::BAD_REQUEST, &format!("Invalid multipart: {e}")))?
    {
        let name = field.name().unwrap_or_default().to_string();
        match name.as_str() {
            "bundle" => {
                let bytes = field
                    .bytes()
                    .await
                    .map_err(|_| err(StatusCode::BAD_REQUEST, "Invalid bundle field"))?;
                if bytes.len() > MAX_BUNDLE_BYTES {
                    return Err(err(StatusCode::PAYLOAD_TOO_LARGE, "Bundle too large"));
                }
                let text = String::from_utf8(bytes.to_vec())
                    .map_err(|_| err(StatusCode::BAD_REQUEST, "Bundle must be UTF-8"))?;
                bundle_raw = Some(text);
            }
            "files" => {
                if files.len() >= MAX_ATTACHMENTS {
                    return Err(err(StatusCode::PAYLOAD_TOO_LARGE, "Too many attachments"));
                }
                let file_name = field
                    .file_name()
                    .map(|s| s.to_string())
                    .filter(|s| !s.trim().is_empty())
                    .unwrap_or_else(|| format!("attachment-{}", files.len() + 1));
                let content_type = field.content_type().map(|s| s.to_string());
                let bytes = field
                    .bytes()
                    .await
                    .map_err(|_| err(StatusCode::BAD_REQUEST, "Failed to read attachment"))?;
                if bytes.is_empty() {
                    continue;
                }
                if bytes.len() > MAX_ATTACHMENT_BYTES {
                    return Err(err(
                        StatusCode::PAYLOAD_TOO_LARGE,
                        "Attachment exceeds 25MB limit",
                    ));
                }
                files.push(ParsedFile {
                    file_name,
                    content_type,
                    data: bytes.to_vec(),
                });
            }
            _ => {
                // ignore unknown fields, drain body
                let _ = field.bytes().await;
            }
        }
    }

    let bundle_raw =
        bundle_raw.ok_or_else(|| err(StatusCode::BAD_REQUEST, "Missing bundle field"))?;
    let bundle: Value = serde_json::from_str(&bundle_raw)
        .map_err(|_| err(StatusCode::BAD_REQUEST, "Bundle is not valid JSON"))?;

    if !bundle.is_object() || !bundle.get("payload").is_some_and(|p| p.is_object()) {
        return Err(err(StatusCode::BAD_REQUEST, "Bundle payload missing"));
    }

    Ok(ParsedIntake {
        bundle_raw,
        bundle,
        files,
    })
}

async fn ingest_visitor_intake(
    State(state): State<AppState>,
    headers: HeaderMap,
    multipart: Multipart,
) -> axum::response::Response {
    if let Err(resp) = check_shared_token(&headers) {
        return resp;
    }

    let parsed = match parse_multipart(multipart).await {
        Ok(p) => p,
        Err(resp) => return resp,
    };

    let payload = &parsed.bundle["payload"];
    let first_name = str_opt(&payload["firstName"]).unwrap_or_default();
    let last_name = str_opt(&payload["lastName"]).unwrap_or_default();

    if first_name.is_empty() || last_name.is_empty() {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "First and last name are required",
        );
    }

    let (primary_phone, primary_phone_type) = first_phone(&payload["phones"]);
    let services = string_array(&payload["services"]);
    let phones_json = if payload["phones"].is_array() {
        payload["phones"].clone()
    } else {
        json!([])
    };

    let submitted_at = parsed.bundle.get("submittedAt").and_then(str_opt);
    let flow = parsed.bundle.get("flow").and_then(str_opt);
    let locale = parsed.bundle.get("locale").and_then(str_opt);
    let source = parsed
        .bundle
        .get("source")
        .and_then(str_opt)
        .unwrap_or_else(|| "visitor_facade".to_string());

    let user_agent = headers
        .get(axum::http::header::USER_AGENT)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());

    let remote_ip = headers
        .get("x-forwarded-for")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.split(',').next())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    let submitted_at_parsed = submitted_at
        .as_deref()
        .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
        .map(|dt| dt.with_timezone(&chrono::Utc));

    let mut tx = match state.db.begin().await {
        Ok(tx) => tx,
        Err(e) => {
            tracing::error!(error = %e, "visitor intake: begin tx");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Database error");
        }
    };

    let insert = sqlx::query_scalar::<_, Uuid>(
        r#"INSERT INTO visitor_intakes (
            source, flow, locale, submitted_at,
            first_name, middle_name, last_name, suffix, date_of_birth, legal_sex,
            email, email_consent, primary_phone, primary_phone_type, phones,
            whatsapp_consent, whatsapp_number,
            country, street_address, city, state, zip_code,
            primary_language, needs_interpreter,
            location, location_detailed, wants_membership, selected_program,
            can_travel, has_medical_records, records_in_accepted_language, has_travel_documents,
            currently_in_treatment, has_health_risk_for_travel,
            primary_concern_text, additional_concerns,
            services, has_insurance, insurance_covers_germany,
            preferred_location, visit_timing, message,
            consent_automated_contact, consent_healthcare, consent_opt_out, consent_privacy_practices,
            raw_payload, remote_ip, user_agent
        ) VALUES (
            $1, $2, $3, $4,
            $5, $6, $7, $8, $9, $10,
            $11, $12, $13, $14, $15,
            $16, $17,
            $18, $19, $20, $21, $22,
            $23, $24,
            $25, $26, $27, $28,
            $29, $30, $31, $32,
            $33, $34,
            $35, $36,
            $37, $38, $39,
            $40, $41, $42,
            $43, $44, $45, $46,
            $47, $48::inet, $49
        ) RETURNING id"#,
    )
    .bind(source)
    .bind(flow)
    .bind(locale)
    .bind(submitted_at_parsed)
    .bind(first_name)
    .bind(str_opt(&payload["middleName"]))
    .bind(last_name)
    .bind(str_opt(&payload["suffix"]))
    .bind(date_opt(&payload["dateOfBirth"]))
    .bind(str_opt(&payload["legalSex"]))
    .bind(str_opt(&payload["email"]))
    .bind(bool_opt(&payload["emailConsent"]))
    .bind(primary_phone)
    .bind(primary_phone_type)
    .bind(phones_json)
    .bind(bool_opt(&payload["whatsappConsent"]))
    .bind(str_opt(&payload["whatsappNumber"]))
    .bind(str_opt(&payload["country"]))
    .bind(str_opt(&payload["streetAddress"]))
    .bind(str_opt(&payload["city"]))
    .bind(str_opt(&payload["state"]))
    .bind(str_opt(&payload["zipCode"]))
    .bind(str_opt(&payload["primaryLanguage"]))
    .bind(yes_no_to_bool(&payload["needsInterpreter"]))
    .bind(str_opt(&payload["location"]))
    .bind(str_opt(&payload["locationDetailed"]))
    .bind(yes_no_to_bool(&payload["wantsMembership"]))
    .bind(str_opt(&payload["selectedProgram"]))
    .bind(yes_no_to_bool(&payload["canTravel"]))
    .bind(str_opt(&payload["hasMedicalRecords"]))
    .bind(yes_no_to_bool(&payload["recordsInAcceptedLanguage"]))
    .bind(yes_no_to_bool(&payload["hasTravelDocuments"]))
    .bind(yes_no_to_bool(&payload["currentlyInTreatment"]))
    .bind(yes_no_to_bool(&payload["hasHealthRiskForTravel"]))
    .bind(str_opt(&payload["primaryConcernText"]))
    .bind(str_opt(&payload["additionalConcerns"]))
    .bind(services)
    .bind(yes_no_to_bool(&payload["hasInsurance"]))
    .bind(str_opt(&payload["insuranceCoversGermany"]))
    .bind(str_opt(&payload["preferredLocation"]))
    .bind(str_opt(&payload["visitTiming"]))
    .bind(str_opt(&payload["message"]))
    .bind(payload["consentAutomatedContact"].as_bool().unwrap_or(false))
    .bind(payload["consentHealthcare"].as_bool().unwrap_or(false))
    .bind(payload["consentOptOut"].as_bool().unwrap_or(false))
    .bind(payload["consentPrivacyPractices"].as_bool().unwrap_or(false))
    .bind(serde_json::from_str::<Value>(&parsed.bundle_raw).unwrap_or(Value::Null))
    .bind(remote_ip)
    .bind(user_agent)
    .fetch_one(&mut *tx)
    .await;

    let intake_id = match insert {
        Ok(id) => id,
        Err(e) => {
            tracing::error!(error = %e, "visitor intake: insert");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to store intake");
        }
    };

    for file in &parsed.files {
        let attach = sqlx::query(
            r#"INSERT INTO visitor_intake_attachments
                (visitor_intake_id, file_name, content_type, size_bytes, data)
               VALUES ($1, $2, $3, $4, $5)"#,
        )
        .bind(intake_id)
        .bind(&file.file_name)
        .bind(&file.content_type)
        .bind(file.data.len() as i64)
        .bind(&file.data)
        .execute(&mut *tx)
        .await;

        if let Err(e) = attach {
            tracing::error!(error = %e, intake = %intake_id, "visitor intake: attachment insert");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to store attachment",
            );
        }
    }

    if let Err(e) = tx.commit().await {
        tracing::error!(error = %e, "visitor intake: commit");
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Database error");
    }

    tracing::info!(
        intake_id = %intake_id,
        attachments = parsed.files.len(),
        "visitor intake stored"
    );

    (
        StatusCode::CREATED,
        Json(json!({
            "intake_id": intake_id,
            "attachment_count": parsed.files.len(),
        })),
    )
        .into_response()
}
