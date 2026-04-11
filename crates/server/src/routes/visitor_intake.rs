use axum::{
    Json, Router,
    body::Body,
    extract::{Extension, Multipart, Path, Query, State},
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
    routing::{get, post},
};
use chrono::NaiveDate;
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::Row;
use uuid::Uuid;

use crate::auth::middleware::AuthUser;
use crate::state::AppState;
use gmed_domain::role::Role;

const MAX_ATTACHMENT_BYTES: usize = 25 * 1024 * 1024;
const MAX_BUNDLE_BYTES: usize = 512 * 1024;
const MAX_ATTACHMENTS: usize = 20;

pub fn public_router() -> Router<AppState> {
    Router::new().route("/public/visitor-intake", post(ingest_visitor_intake))
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/visitor-intakes", get(list_intakes))
        .route("/visitor-intakes/{id}", get(get_intake))
        .route(
            "/visitor-intakes/{id}/attachments/{attachment_id}",
            get(download_attachment),
        )
        .route("/visitor-intakes/{id}/status", post(update_status))
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

#[allow(clippy::result_large_err)]
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

#[derive(Deserialize)]
struct ListIntakesQuery {
    search: Option<String>,
    status: Option<String>,
    flow: Option<String>,
    limit: Option<i64>,
}

fn is_valid_intake_status(value: &str) -> bool {
    matches!(
        value,
        "new" | "reviewed" | "converted" | "archived" | "spam"
    )
}

async fn list_intakes(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Query(query): Query<ListIntakesQuery>,
) -> axum::response::Response {
    if let Err(resp) = auth.require_any_role(&[Role::PatientManager, Role::Sales, Role::Ceo]) {
        return resp;
    }

    if let Some(ref status) = query.status
        && !is_valid_intake_status(status)
    {
        return err(StatusCode::UNPROCESSABLE_ENTITY, "Invalid status");
    }

    let search_pattern = format!("%{}%", query.search.as_deref().unwrap_or("").trim());
    let limit = query.limit.unwrap_or(200).clamp(1, 500);

    match sqlx::query(
        r#"SELECT i.id, i.source, i.flow, i.locale, i.submitted_at,
                  i.first_name, i.last_name, i.email, i.primary_phone,
                  i.country, i.city, i.processing_status, i.converted_lead_id,
                  i.created_at,
                  (SELECT COUNT(*) FROM visitor_intake_attachments a
                     WHERE a.visitor_intake_id = i.id) AS attachment_count
           FROM visitor_intakes i
           WHERE ($1::text IS NULL OR i.processing_status = $1)
             AND ($2::text IS NULL OR i.flow = $2)
             AND (
                $3::text = '%%'
                OR i.first_name ILIKE $3
                OR i.last_name ILIKE $3
                OR COALESCE(i.email, '') ILIKE $3
                OR COALESCE(i.primary_phone, '') ILIKE $3
                OR COALESCE(i.country, '') ILIKE $3
             )
           ORDER BY i.created_at DESC
           LIMIT $4"#,
    )
    .bind(query.status)
    .bind(query.flow)
    .bind(search_pattern)
    .bind(limit)
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => {
            let items: Vec<Value> = rows
                .into_iter()
                .map(|r| {
                    json!({
                        "id": r.try_get::<Uuid, _>("id").unwrap_or_else(|_| Uuid::nil()),
                        "source": r.try_get::<Option<String>, _>("source").unwrap_or_default(),
                        "flow": r.try_get::<Option<String>, _>("flow").unwrap_or_default(),
                        "locale": r.try_get::<Option<String>, _>("locale").unwrap_or_default(),
                        "first_name": r.try_get::<String, _>("first_name").unwrap_or_default(),
                        "last_name": r.try_get::<String, _>("last_name").unwrap_or_default(),
                        "email": r.try_get::<Option<String>, _>("email").unwrap_or_default(),
                        "primary_phone": r.try_get::<Option<String>, _>("primary_phone").unwrap_or_default(),
                        "country": r.try_get::<Option<String>, _>("country").unwrap_or_default(),
                        "city": r.try_get::<Option<String>, _>("city").unwrap_or_default(),
                        "processing_status": r.try_get::<String, _>("processing_status").unwrap_or_default(),
                        "converted_lead_id": r.try_get::<Option<Uuid>, _>("converted_lead_id").unwrap_or_default(),
                        "submitted_at": r
                            .try_get::<Option<chrono::DateTime<chrono::Utc>>, _>("submitted_at")
                            .unwrap_or_default()
                            .map(|v| v.to_rfc3339()),
                        "created_at": r
                            .try_get::<chrono::DateTime<chrono::Utc>, _>("created_at")
                            .map(|v| v.to_rfc3339())
                            .unwrap_or_default(),
                        "attachment_count": r.try_get::<i64, _>("attachment_count").unwrap_or(0),
                    })
                })
                .collect();
            Json(items).into_response()
        }
        Err(e) => {
            tracing::error!(error = %e, "list visitor intakes");
            err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to load intakes")
        }
    }
}

async fn get_intake(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(intake_id): Path<Uuid>,
) -> axum::response::Response {
    if let Err(resp) = auth.require_any_role(&[Role::PatientManager, Role::Sales, Role::Ceo]) {
        return resp;
    }

    let row = match sqlx::query(
        r#"SELECT id, source, flow, locale, submitted_at,
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
                  consent_automated_contact, consent_healthcare,
                  consent_opt_out, consent_privacy_practices,
                  raw_payload, processing_status, converted_lead_id,
                  internal_notes, user_agent,
                  created_at, updated_at
           FROM visitor_intakes
           WHERE id = $1"#,
    )
    .bind(intake_id)
    .fetch_optional(&state.db)
    .await
    {
        Ok(Some(row)) => row,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Intake not found"),
        Err(e) => {
            tracing::error!(error = %e, "get visitor intake");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to load intake");
        }
    };

    let attachments = match sqlx::query(
        r#"SELECT id, file_name, content_type, size_bytes, uploaded_at
           FROM visitor_intake_attachments
           WHERE visitor_intake_id = $1
           ORDER BY uploaded_at ASC"#,
    )
    .bind(intake_id)
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => rows
            .into_iter()
            .map(|r| {
                json!({
                    "id": r.try_get::<Uuid, _>("id").unwrap_or_else(|_| Uuid::nil()),
                    "file_name": r.try_get::<String, _>("file_name").unwrap_or_default(),
                    "content_type": r.try_get::<Option<String>, _>("content_type").unwrap_or_default(),
                    "size_bytes": r.try_get::<i64, _>("size_bytes").unwrap_or(0),
                    "uploaded_at": r
                        .try_get::<chrono::DateTime<chrono::Utc>, _>("uploaded_at")
                        .map(|v| v.to_rfc3339())
                        .unwrap_or_default(),
                })
            })
            .collect::<Vec<_>>(),
        Err(e) => {
            tracing::error!(error = %e, "load intake attachments");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to load attachments",
            );
        }
    };

    let mut obj = serde_json::Map::new();
    let rfc = |v: Option<chrono::DateTime<chrono::Utc>>| {
        v.map(|dt| Value::String(dt.to_rfc3339()))
            .unwrap_or(Value::Null)
    };
    let s_req =
        |row: &sqlx::postgres::PgRow, col: &str| row.try_get::<String, _>(col).unwrap_or_default();
    let s_opt = |row: &sqlx::postgres::PgRow, col: &str| {
        row.try_get::<Option<String>, _>(col)
            .ok()
            .flatten()
            .map(Value::String)
            .unwrap_or(Value::Null)
    };
    let b_opt = |row: &sqlx::postgres::PgRow, col: &str| {
        row.try_get::<Option<bool>, _>(col)
            .ok()
            .flatten()
            .map(Value::Bool)
            .unwrap_or(Value::Null)
    };
    let b_req =
        |row: &sqlx::postgres::PgRow, col: &str| row.try_get::<bool, _>(col).unwrap_or(false);

    obj.insert(
        "id".into(),
        json!(row.try_get::<Uuid, _>("id").unwrap_or_else(|_| Uuid::nil())),
    );
    obj.insert("source".into(), s_opt(&row, "source"));
    obj.insert("flow".into(), s_opt(&row, "flow"));
    obj.insert("locale".into(), s_opt(&row, "locale"));
    obj.insert(
        "submitted_at".into(),
        rfc(row
            .try_get::<Option<chrono::DateTime<chrono::Utc>>, _>("submitted_at")
            .ok()
            .flatten()),
    );
    obj.insert(
        "first_name".into(),
        Value::String(s_req(&row, "first_name")),
    );
    obj.insert("middle_name".into(), s_opt(&row, "middle_name"));
    obj.insert("last_name".into(), Value::String(s_req(&row, "last_name")));
    obj.insert("suffix".into(), s_opt(&row, "suffix"));
    obj.insert(
        "date_of_birth".into(),
        row.try_get::<Option<NaiveDate>, _>("date_of_birth")
            .ok()
            .flatten()
            .map(|d| Value::String(d.format("%Y-%m-%d").to_string()))
            .unwrap_or(Value::Null),
    );
    obj.insert("legal_sex".into(), s_opt(&row, "legal_sex"));
    obj.insert("email".into(), s_opt(&row, "email"));
    obj.insert("email_consent".into(), b_opt(&row, "email_consent"));
    obj.insert("primary_phone".into(), s_opt(&row, "primary_phone"));
    obj.insert(
        "primary_phone_type".into(),
        s_opt(&row, "primary_phone_type"),
    );
    obj.insert(
        "phones".into(),
        row.try_get::<Value, _>("phones").unwrap_or(Value::Null),
    );
    obj.insert("whatsapp_consent".into(), b_opt(&row, "whatsapp_consent"));
    obj.insert("whatsapp_number".into(), s_opt(&row, "whatsapp_number"));
    obj.insert("country".into(), s_opt(&row, "country"));
    obj.insert("street_address".into(), s_opt(&row, "street_address"));
    obj.insert("city".into(), s_opt(&row, "city"));
    obj.insert("state".into(), s_opt(&row, "state"));
    obj.insert("zip_code".into(), s_opt(&row, "zip_code"));
    obj.insert("primary_language".into(), s_opt(&row, "primary_language"));
    obj.insert("needs_interpreter".into(), b_opt(&row, "needs_interpreter"));
    obj.insert("location".into(), s_opt(&row, "location"));
    obj.insert("location_detailed".into(), s_opt(&row, "location_detailed"));
    obj.insert("wants_membership".into(), b_opt(&row, "wants_membership"));
    obj.insert("selected_program".into(), s_opt(&row, "selected_program"));
    obj.insert("can_travel".into(), b_opt(&row, "can_travel"));
    obj.insert(
        "has_medical_records".into(),
        s_opt(&row, "has_medical_records"),
    );
    obj.insert(
        "records_in_accepted_language".into(),
        b_opt(&row, "records_in_accepted_language"),
    );
    obj.insert(
        "has_travel_documents".into(),
        b_opt(&row, "has_travel_documents"),
    );
    obj.insert(
        "currently_in_treatment".into(),
        b_opt(&row, "currently_in_treatment"),
    );
    obj.insert(
        "has_health_risk_for_travel".into(),
        b_opt(&row, "has_health_risk_for_travel"),
    );
    obj.insert(
        "primary_concern_text".into(),
        s_opt(&row, "primary_concern_text"),
    );
    obj.insert(
        "additional_concerns".into(),
        s_opt(&row, "additional_concerns"),
    );
    obj.insert(
        "services".into(),
        json!(
            row.try_get::<Vec<String>, _>("services")
                .unwrap_or_default()
        ),
    );
    obj.insert("has_insurance".into(), b_opt(&row, "has_insurance"));
    obj.insert(
        "insurance_covers_germany".into(),
        s_opt(&row, "insurance_covers_germany"),
    );
    obj.insert(
        "preferred_location".into(),
        s_opt(&row, "preferred_location"),
    );
    obj.insert("visit_timing".into(), s_opt(&row, "visit_timing"));
    obj.insert("message".into(), s_opt(&row, "message"));
    obj.insert(
        "consent_automated_contact".into(),
        Value::Bool(b_req(&row, "consent_automated_contact")),
    );
    obj.insert(
        "consent_healthcare".into(),
        Value::Bool(b_req(&row, "consent_healthcare")),
    );
    obj.insert(
        "consent_opt_out".into(),
        Value::Bool(b_req(&row, "consent_opt_out")),
    );
    obj.insert(
        "consent_privacy_practices".into(),
        Value::Bool(b_req(&row, "consent_privacy_practices")),
    );
    obj.insert(
        "raw_payload".into(),
        row.try_get::<Value, _>("raw_payload")
            .unwrap_or(Value::Null),
    );
    obj.insert(
        "processing_status".into(),
        Value::String(s_req(&row, "processing_status")),
    );
    obj.insert(
        "converted_lead_id".into(),
        row.try_get::<Option<Uuid>, _>("converted_lead_id")
            .ok()
            .flatten()
            .map(|id| json!(id))
            .unwrap_or(Value::Null),
    );
    obj.insert("internal_notes".into(), s_opt(&row, "internal_notes"));
    obj.insert("user_agent".into(), s_opt(&row, "user_agent"));
    obj.insert(
        "created_at".into(),
        rfc(row
            .try_get::<chrono::DateTime<chrono::Utc>, _>("created_at")
            .ok()),
    );
    obj.insert(
        "updated_at".into(),
        rfc(row
            .try_get::<chrono::DateTime<chrono::Utc>, _>("updated_at")
            .ok()),
    );
    obj.insert("attachments".into(), Value::Array(attachments));

    Json(Value::Object(obj)).into_response()
}

async fn download_attachment(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path((intake_id, attachment_id)): Path<(Uuid, Uuid)>,
) -> axum::response::Response {
    if let Err(resp) = auth.require_any_role(&[Role::PatientManager, Role::Sales, Role::Ceo]) {
        return resp;
    }

    match sqlx::query(
        r#"SELECT file_name, content_type, data
           FROM visitor_intake_attachments
           WHERE id = $1 AND visitor_intake_id = $2"#,
    )
    .bind(attachment_id)
    .bind(intake_id)
    .fetch_optional(&state.db)
    .await
    {
        Ok(Some(row)) => {
            let file_name: String = row.try_get("file_name").unwrap_or_default();
            let content_type: Option<String> = row.try_get("content_type").ok().flatten();
            let data: Vec<u8> = row.try_get("data").unwrap_or_default();

            let mime = content_type.unwrap_or_else(|| "application/octet-stream".to_string());
            let disposition = format!("attachment; filename=\"{}\"", file_name.replace('"', "'"));

            axum::response::Response::builder()
                .header("content-type", mime)
                .header("content-disposition", disposition)
                .body(Body::from(data))
                .unwrap()
                .into_response()
        }
        Ok(None) => err(StatusCode::NOT_FOUND, "Attachment not found"),
        Err(e) => {
            tracing::error!(error = %e, "download visitor intake attachment");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to load attachment",
            )
        }
    }
}

#[derive(Deserialize)]
struct UpdateStatusRequest {
    status: String,
    internal_notes: Option<String>,
}

async fn update_status(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(intake_id): Path<Uuid>,
    Json(body): Json<UpdateStatusRequest>,
) -> axum::response::Response {
    if let Err(resp) = auth.require_any_role(&[Role::PatientManager, Role::Sales, Role::Ceo]) {
        return resp;
    }

    if !is_valid_intake_status(&body.status) {
        return err(StatusCode::UNPROCESSABLE_ENTITY, "Invalid status");
    }

    let reviewed_at = if body.status == "new" {
        None
    } else {
        Some(chrono::Utc::now())
    };
    let reviewed_by = if reviewed_at.is_some() {
        Some(auth.user_id)
    } else {
        None
    };

    match sqlx::query(
        r#"UPDATE visitor_intakes
           SET processing_status = $2,
               internal_notes = COALESCE($3, internal_notes),
               reviewed_at = $4,
               reviewed_by = $5
           WHERE id = $1"#,
    )
    .bind(intake_id)
    .bind(&body.status)
    .bind(body.internal_notes.as_deref())
    .bind(reviewed_at)
    .bind(reviewed_by)
    .execute(&state.db)
    .await
    {
        Ok(r) if r.rows_affected() > 0 => {
            let _ = sqlx::query(
                "INSERT INTO audit_log (user_id, action, entity_type, entity_id, context) VALUES ($1, 'visitor_intake_status', 'visitor_intake', $2, $3)",
            )
            .bind(auth.user_id)
            .bind(intake_id)
            .bind(json!({ "status": body.status }))
            .execute(&state.db)
            .await;
            Json(json!({ "ok": true })).into_response()
        }
        Ok(_) => err(StatusCode::NOT_FOUND, "Intake not found"),
        Err(e) => {
            tracing::error!(error = %e, "update visitor intake status");
            err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to update status")
        }
    }
}
