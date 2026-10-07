//! GwG instruction and reliability check of the staff (§ 6 Abs. 2 Nr. 5, 6
//! GwG) in "SOP und Lernen", owner request 2026-10-05.
//!
//! One record per employee and instruction keeps the history; an employee is
//! instructed again every twelve months. Saving a record generates the sheet
//! "Dokumentation interner Sicherungsmaßnahmen" (template
//! `gwg_staff_training`, GMED layout) and archives it in the employee's
//! personnel file in the same transaction. The signed scan is archived as the
//! next version of that document and marks the record signed.
//!
//! Only holders of the personnel capabilities (the CEO, owner decision R1 of
//! the personnel files) see and manage the records; an employee with a linked
//! personnel file reads their own. See
//! `docs/architecture/gwg-staff-training_ua.md`.

use axum::{
    Json, Router,
    extract::{DefaultBodyLimit, Extension, Multipart, Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{get, post},
};
use chrono::{DateTime, Months, NaiveDate, Utc};
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::{Row, postgres::PgRow};
use uuid::Uuid;

use crate::{
    audit,
    auth::middleware::AuthUser,
    routes::{
        documents::{
            GWG_STAFF_INSTRUCTIONS, GWG_STAFF_TRAINING_LABEL, GWG_STAFF_TRAINING_TEMPLATE_ID,
            GwgStaffReliability, GwgStaffTrainingSheet, MAX_FILE_SIZE, remove_document_blob,
            render_gwg_staff_training_pdf, store_document_blob,
        },
        personnel::{
            Employee,
            documents::{
                ArchiveEntry, Blob, Target, TargetFields, accept_file, archive_in_transaction,
                read_multipart, resolve_target, sha256_hex, taken_names, unique_archive_name,
            },
            employee_for_user, err, internal, late_days, load_category, load_employee,
        },
    },
    state::AppState,
};
use gmed_domain::access::capabilities::Capability;
use gmed_domain::personnel::extension_for_mime;

/// Personnel file category of the sheet and of its signed scan.
const CATEGORY: &str = "gwg_unterweisung";
/// An instruction older than this is due again.
const DUE_AFTER_MONTHS: u32 = 12;
/// Correction reason of the signed scan, the next version of the sheet.
const SIGNED_COPY_REASON: &str = "Unterschriebene Fassung";
const MAX_TEXT: usize = 500;
const MAX_LABEL: usize = 120;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/sops/gwg-training", get(overview).post(create_record))
        .route("/sops/gwg-training/mine", get(own_records))
        .route(
            "/sops/gwg-training/{record_id}/signed-copy",
            post(upload_signed_copy),
        )
        .layer(DefaultBodyLimit::max(MAX_FILE_SIZE + 1024 * 1024))
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

/// "als" and "im Bereich" prefilled from the role of the linked account.
fn default_position(role: Option<&str>) -> (&'static str, &'static str) {
    match role.unwrap_or_default() {
        "ceo" => ("Geschäftsführer/in", "Geschäftsleitung"),
        "ceo_assistant" => ("Assistenz der Geschäftsleitung", "Geschäftsleitung"),
        "patient_manager" => ("Patientenmanager/in", "Patientenbetreuung"),
        "teamlead_interpreter" => ("Teamleitung Dolmetscher/innen", "Dolmetscherdienst"),
        "interpreter" => ("Dolmetscher/in", "Dolmetscherdienst"),
        "concierge" => ("Concierge", "Concierge-Service"),
        "billing" => ("Sachbearbeiter/in Abrechnung", "Buchhaltung und Abrechnung"),
        "sales" => ("Vertriebsmitarbeiter/in", "Vertrieb"),
        "it_admin" => ("IT-Administrator/in", "IT"),
        _ => ("", ""),
    }
}

/// The day from which an instruction given on `instructed_on` is due again.
fn next_due_on(instructed_on: NaiveDate) -> NaiveDate {
    instructed_on
        .checked_add_months(Months::new(DUE_AFTER_MONTHS))
        .unwrap_or(instructed_on)
}

/// Due when never instructed or when the last instruction is older than
/// twelve months.
fn is_due(last_instructed_on: Option<NaiveDate>, today: NaiveDate) -> bool {
    last_instructed_on.is_none_or(|date| today > next_due_on(date))
}

#[derive(Debug, Default, Deserialize)]
struct CreateRecordRequest {
    employee_id: Option<Uuid>,
    instructed_on: Option<String>,
    position: Option<String>,
    department: Option<String>,
    delivered_by: Option<String>,
    delivered_by_other: Option<String>,
    #[serde(default)]
    form_oral: bool,
    #[serde(default)]
    form_material: bool,
    #[serde(default)]
    form_other: bool,
    form_other_text: Option<String>,
    /// All six instructions when omitted.
    instructions: Option<Vec<String>>,
    reliability: Option<String>,
    #[serde(default)]
    reliability_interview: bool,
    #[serde(default)]
    reliability_certificate: bool,
    #[serde(default)]
    reliability_other: bool,
    reliability_other_text: Option<String>,
}

/// A checked record, ready to be stored and printed.
#[derive(Debug, Clone, PartialEq)]
struct ValidRecord {
    employee_id: Uuid,
    instructed_on: NaiveDate,
    position: String,
    department: String,
    delivered_by_other: Option<String>,
    form_oral: bool,
    form_material: bool,
    form_other: Option<String>,
    instructions: Vec<String>,
    reliability: GwgStaffReliability,
}

fn clean_text(value: Option<&str>, max: usize) -> Option<String> {
    value
        .map(|value| value.trim().chars().take(max).collect::<String>())
        .filter(|value| !value.is_empty())
}

/// Checks a new record. Free texts are required exactly where the sheet asks
/// for "weitere Angaben"; the instructions keep the order of the sheet.
fn validate_record(body: &CreateRecordRequest, today: NaiveDate) -> Result<ValidRecord, String> {
    let employee_id = body
        .employee_id
        .ok_or_else(|| "Choose the employee".to_string())?;
    let instructed_on = body
        .instructed_on
        .as_deref()
        .and_then(|value| NaiveDate::parse_from_str(value.trim(), "%Y-%m-%d").ok())
        .ok_or_else(|| "Enter the date of the instruction (YYYY-MM-DD)".to_string())?;
    if instructed_on > today {
        return Err("The instruction date cannot lie in the future".to_string());
    }
    if instructed_on < NaiveDate::from_ymd_opt(2000, 1, 1).unwrap_or(instructed_on) {
        return Err("The instruction date is too far in the past".to_string());
    }

    let delivered_by_other = match body.delivered_by.as_deref().map(str::trim) {
        Some("internal") => None,
        Some("other") => Some(
            clean_text(body.delivered_by_other.as_deref(), MAX_TEXT)
                .ok_or_else(|| "Name who gave the instruction".to_string())?,
        ),
        _ => return Err("Choose who gave the instruction".to_string()),
    };

    if !(body.form_oral || body.form_material || body.form_other) {
        return Err("Choose the form of the instruction".to_string());
    }
    let form_other = if body.form_other {
        Some(
            clean_text(body.form_other_text.as_deref(), MAX_TEXT)
                .ok_or_else(|| "Describe the other form of the instruction".to_string())?,
        )
    } else {
        None
    };

    let instructions = match &body.instructions {
        None => GWG_STAFF_INSTRUCTIONS
            .iter()
            .map(|(code, _)| code.to_string())
            .collect::<Vec<_>>(),
        Some(values) => {
            let chosen: Vec<&str> = values.iter().map(|value| value.trim()).collect();
            if let Some(unknown) = chosen.iter().find(|code| {
                !GWG_STAFF_INSTRUCTIONS
                    .iter()
                    .any(|(known, _)| known == *code)
            }) {
                return Err(format!("Unknown instruction: {unknown}"));
            }
            GWG_STAFF_INSTRUCTIONS
                .iter()
                .filter(|(code, _)| chosen.contains(code))
                .map(|(code, _)| code.to_string())
                .collect()
        }
    };
    if instructions.is_empty() {
        return Err("Choose at least one instruction".to_string());
    }

    let reliability = match body.reliability.as_deref().map(str::trim) {
        Some("long_standing") => GwgStaffReliability::LongStanding,
        Some("new_employee") => {
            if !(body.reliability_interview
                || body.reliability_certificate
                || body.reliability_other)
            {
                return Err(
                    "Choose how the reliability of the new employee was checked".to_string()
                );
            }
            let other = if body.reliability_other {
                Some(
                    clean_text(body.reliability_other_text.as_deref(), MAX_TEXT)
                        .ok_or_else(|| "Describe the other check of the reliability".to_string())?,
                )
            } else {
                None
            };
            GwgStaffReliability::NewEmployee {
                interview: body.reliability_interview,
                certificate: body.reliability_certificate,
                other,
            }
        }
        _ => return Err("Choose how the reliability was checked".to_string()),
    };

    Ok(ValidRecord {
        employee_id,
        instructed_on,
        position: clean_text(body.position.as_deref(), MAX_LABEL).unwrap_or_default(),
        department: clean_text(body.department.as_deref(), MAX_LABEL).unwrap_or_default(),
        delivered_by_other,
        form_oral: body.form_oral,
        form_material: body.form_material,
        form_other,
        instructions,
        reliability,
    })
}

fn sheet_for(
    record: &ValidRecord,
    employee: &Employee,
    management_name: &str,
) -> GwgStaffTrainingSheet {
    GwgStaffTrainingSheet {
        last_name: employee.last_name.clone(),
        first_name: employee.first_name.clone(),
        employment_start: employee.employment_start,
        position: record.position.clone(),
        department: record.department.clone(),
        instructed_on: record.instructed_on,
        delivered_by_other: record.delivered_by_other.clone(),
        form_oral: record.form_oral,
        form_material: record.form_material,
        form_other: record.form_other.clone(),
        instructions: record.instructions.clone(),
        reliability: record.reliability.clone(),
        management_name: management_name.to_string(),
    }
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

const RECORD_SELECT: &str = r#"
    SELECT t.id, t.employee_id, t.instructed_on, t.position, t.department, t.delivered_by,
           t.delivered_by_other, t.form_oral, t.form_material, t.form_other, t.form_other_text,
           t.instructions, t.reliability, t.reliability_interview, t.reliability_certificate,
           t.reliability_other, t.reliability_other_text, t.management_name, t.document_id,
           t.signed_document_id, t.signed_at, t.created_at,
           creator.name AS created_by_name, signer.name AS signed_by_name,
           d.archive_file_name AS document_file_name, d.mime_type AS document_mime_type,
           s.archive_file_name AS signed_file_name, s.mime_type AS signed_mime_type
    FROM gwg_staff_trainings t
    JOIN personnel_documents d ON d.id = t.document_id
    LEFT JOIN personnel_documents s ON s.id = t.signed_document_id
    LEFT JOIN users creator ON creator.id = t.created_by
    LEFT JOIN users signer ON signer.id = t.signed_by"#;

const RECORD_ORDER: &str = "ORDER BY t.instructed_on DESC, t.created_at DESC, t.id";

fn record_json(row: &PgRow) -> Value {
    let signed_document_id: Option<Uuid> = row.try_get("signed_document_id").unwrap_or_default();
    json!({
        "id": row.try_get::<Uuid, _>("id").ok(),
        "employee_id": row.try_get::<Uuid, _>("employee_id").ok(),
        "template_id": GWG_STAFF_TRAINING_TEMPLATE_ID,
        "instructed_on": row.try_get::<NaiveDate, _>("instructed_on").ok(),
        "position": row.try_get::<String, _>("position").unwrap_or_default(),
        "department": row.try_get::<String, _>("department").unwrap_or_default(),
        "delivered_by": row.try_get::<String, _>("delivered_by").unwrap_or_default(),
        "delivered_by_other": row.try_get::<Option<String>, _>("delivered_by_other").unwrap_or_default(),
        "form_oral": row.try_get::<bool, _>("form_oral").unwrap_or(false),
        "form_material": row.try_get::<bool, _>("form_material").unwrap_or(false),
        "form_other": row.try_get::<bool, _>("form_other").unwrap_or(false),
        "form_other_text": row.try_get::<Option<String>, _>("form_other_text").unwrap_or_default(),
        "instructions": row.try_get::<Vec<String>, _>("instructions").unwrap_or_default(),
        "reliability": row.try_get::<String, _>("reliability").unwrap_or_default(),
        "reliability_interview": row.try_get::<bool, _>("reliability_interview").unwrap_or(false),
        "reliability_certificate": row.try_get::<bool, _>("reliability_certificate").unwrap_or(false),
        "reliability_other": row.try_get::<bool, _>("reliability_other").unwrap_or(false),
        "reliability_other_text": row.try_get::<Option<String>, _>("reliability_other_text").unwrap_or_default(),
        "management_name": row.try_get::<String, _>("management_name").unwrap_or_default(),
        "status": if signed_document_id.is_some() { "signed" } else { "unsigned" },
        "document_id": row.try_get::<Uuid, _>("document_id").ok(),
        "document_file_name": row.try_get::<String, _>("document_file_name").unwrap_or_default(),
        "document_mime_type": row.try_get::<String, _>("document_mime_type").unwrap_or_default(),
        "signed_document_id": signed_document_id,
        "signed_file_name": row.try_get::<Option<String>, _>("signed_file_name").unwrap_or_default(),
        "signed_mime_type": row.try_get::<Option<String>, _>("signed_mime_type").unwrap_or_default(),
        "signed_at": row
            .try_get::<Option<DateTime<Utc>>, _>("signed_at")
            .ok()
            .flatten()
            .map(|value| value.to_rfc3339()),
        "signed_by_name": row.try_get::<Option<String>, _>("signed_by_name").unwrap_or_default(),
        "created_by_name": row.try_get::<Option<String>, _>("created_by_name").unwrap_or_default(),
        "created_at": row
            .try_get::<DateTime<Utc>, _>("created_at")
            .map(|value| value.to_rfc3339())
            .unwrap_or_default(),
    })
}

async fn records_of(state: &AppState, employee_ids: &[Uuid]) -> Result<Vec<PgRow>, sqlx::Error> {
    sqlx::query(&format!(
        "{RECORD_SELECT} WHERE t.employee_id = ANY($1) {RECORD_ORDER}"
    ))
    .bind(employee_ids)
    .fetch_all(&state.db)
    .await
}

async fn record_by_id(
    conn: &mut sqlx::PgConnection,
    record_id: Uuid,
) -> Result<Option<PgRow>, sqlx::Error> {
    sqlx::query(&format!("{RECORD_SELECT} WHERE t.id = $1"))
        .bind(record_id)
        .fetch_optional(conn)
        .await
}

/// Status, last date and due flag of one employee from their records (newest
/// first).
fn employee_summary(records: &[&PgRow], today: NaiveDate) -> Value {
    let last = records.first();
    let last_instructed_on: Option<NaiveDate> =
        last.and_then(|row| row.try_get("instructed_on").ok());
    let status = match last {
        None => "none",
        Some(row) => {
            if row
                .try_get::<Option<Uuid>, _>("signed_document_id")
                .ok()
                .flatten()
                .is_some()
            {
                "signed"
            } else {
                "unsigned"
            }
        }
    };
    json!({
        "status": status,
        "last_instructed_on": last_instructed_on,
        "next_due_on": last_instructed_on.map(next_due_on),
        "due": is_due(last_instructed_on, today),
        "records": records.iter().copied().map(record_json).collect::<Vec<_>>(),
    })
}

async fn user_name(state: &AppState, user_id: Uuid) -> Result<String, sqlx::Error> {
    sqlx::query_scalar::<_, String>("SELECT name FROM users WHERE id = $1")
        .bind(user_id)
        .fetch_optional(&state.db)
        .await
        .map(Option::unwrap_or_default)
}

/// Active employees (the employment has not ended) with their instruction
/// history, for the section in "SOP und Lernen".
async fn overview(State(state): State<AppState>, Extension(auth): Extension<AuthUser>) -> Response {
    if let Err(response) = auth.require_capability(Capability::PersonnelView) {
        return response;
    }
    let today = crate::app_time::today();
    let employees = match sqlx::query(
        r#"SELECT e.id, e.first_name, e.last_name, e.employment_start, e.employment_end,
                  u.role AS user_role, u.name AS user_name
           FROM employees e
           LEFT JOIN users u ON u.id = e.user_id
           WHERE e.employment_end IS NULL OR e.employment_end >= $1
           ORDER BY lower(e.last_name), lower(e.first_name), e.id"#,
    )
    .bind(today)
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => rows,
        Err(error) => return internal(error, "list employees for GwG instructions"),
    };
    let ids: Vec<Uuid> = employees
        .iter()
        .filter_map(|row| row.try_get::<Uuid, _>("id").ok())
        .collect();
    let records = match records_of(&state, &ids).await {
        Ok(rows) => rows,
        Err(error) => return internal(error, "list GwG instruction records"),
    };
    let management_name = match user_name(&state, auth.user_id).await {
        Ok(name) => name,
        Err(error) => return internal(error, "load management name"),
    };
    let items: Vec<Value> = employees
        .iter()
        .map(|row| {
            let id: Uuid = row.try_get("id").unwrap_or_default();
            let first_name: String = row.try_get("first_name").unwrap_or_default();
            let last_name: String = row.try_get("last_name").unwrap_or_default();
            let role: Option<String> = row.try_get("user_role").unwrap_or_default();
            let (position, department) = default_position(role.as_deref());
            let own: Vec<&PgRow> = records
                .iter()
                .filter(|record| record.try_get::<Uuid, _>("employee_id").ok() == Some(id))
                .collect();
            let mut value = employee_summary(&own, today);
            value["employee_id"] = json!(id);
            value["first_name"] = json!(first_name);
            value["last_name"] = json!(last_name);
            value["display_name"] =
                json!(format!("{} {}", first_name.trim(), last_name.trim()).trim());
            value["employment_start"] = json!(
                row.try_get::<Option<NaiveDate>, _>("employment_start")
                    .unwrap_or_default()
            );
            value["user_role"] = json!(role);
            value["default_position"] = json!(position);
            value["default_department"] = json!(department);
            value
        })
        .collect();
    Json(json!({
        "today": today,
        "due_after_months": DUE_AFTER_MONTHS,
        "management_name": management_name,
        "instructions": GWG_STAFF_INSTRUCTIONS.iter().map(|(code, _)| *code).collect::<Vec<_>>(),
        "employees": items,
    }))
    .into_response()
}

/// The signed-in employee's own records (read-only). Without a personnel
/// file the list is empty.
async fn own_records(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
) -> Response {
    let employee = match employee_for_user(&state, auth.user_id).await {
        Ok(value) => value,
        Err(error) => return internal(error, "load own personnel file"),
    };
    let Some(employee) = employee else {
        return Json(json!({ "employee_id": null, "status": "none", "due": false, "records": [] }))
            .into_response();
    };
    let records = match records_of(&state, &[employee.id]).await {
        Ok(rows) => rows,
        Err(error) => return internal(error, "list own GwG instruction records"),
    };
    let own: Vec<&PgRow> = records.iter().collect();
    let mut value = employee_summary(&own, crate::app_time::today());
    value["employee_id"] = json!(employee.id);
    Json(value).into_response()
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

async fn load_employee_or_404(state: &AppState, employee_id: Uuid) -> Result<Employee, Response> {
    let mut conn = state
        .db
        .acquire()
        .await
        .map_err(|error| internal(error, "acquire connection"))?;
    match load_employee(&mut conn, employee_id).await {
        Ok(Some(value)) => Ok(value),
        Ok(None) => Err(err(StatusCode::NOT_FOUND, "Employee not found")),
        Err(error) => Err(internal(error, "load employee")),
    }
}

/// The names of the stored fields, for the audit row (never their values).
const RECORD_FIELDS: [&str; 16] = [
    "instructed_on",
    "position",
    "department",
    "delivered_by",
    "delivered_by_other",
    "form_oral",
    "form_material",
    "form_other",
    "form_other_text",
    "instructions",
    "reliability",
    "reliability_interview",
    "reliability_certificate",
    "reliability_other",
    "reliability_other_text",
    "management_name",
];

async fn create_record(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Json(body): Json<CreateRecordRequest>,
) -> Response {
    if let Err(response) = auth.require_capability(Capability::PersonnelUpload) {
        return response;
    }
    let record = match validate_record(&body, crate::app_time::today()) {
        Ok(value) => value,
        Err(message) => return err(StatusCode::UNPROCESSABLE_ENTITY, &message),
    };
    let employee = match load_employee_or_404(&state, record.employee_id).await {
        Ok(value) => value,
        Err(response) => return response,
    };
    let management_name = match user_name(&state, auth.user_id).await {
        Ok(name) => name,
        Err(error) => return internal(error, "load management name"),
    };
    let category = match load_category(&state, CATEGORY).await {
        Ok(Some(value)) => value,
        Ok(None) => return internal("category missing", "load GwG instruction category"),
        Err(error) => return internal(error, "load GwG instruction category"),
    };
    let record_id = Uuid::new_v4();
    let sheet = sheet_for(&record, &employee, &management_name);
    let pdf = match render_gwg_staff_training_pdf(&state, &sheet, record_id, Utc::now()).await {
        Ok(bytes) => bytes,
        Err(response) => return response,
    };
    let target = Target {
        category,
        period_month: None,
        document_date: Some(record.instructed_on),
        supersedes: None,
        correction_reason: None,
    };
    let taken = match taken_names(&state, employee.id).await {
        Ok(value) => value,
        Err(response) => return response,
    };
    let name = match unique_archive_name(&employee, &target, "pdf", &taken) {
        Ok(value) => value,
        Err(response) => return response,
    };
    let (file_size, storage_key, original_file_name) = match store_document_blob(&pdf, &name).await
    {
        Ok(value) => value,
        Err(response) => return response,
    };
    let blob = Blob {
        storage_key,
        original_file_name,
        mime_type: "application/pdf".to_string(),
        file_size,
        sha256: sha256_hex(&pdf),
        source_document_id: None,
    };
    match store_new_record(
        &state,
        &auth,
        &employee,
        &record,
        &management_name,
        record_id,
        &target,
        &blob,
        &name,
    )
    .await
    {
        Ok(value) => (StatusCode::CREATED, Json(value)).into_response(),
        Err(response) => {
            remove_document_blob(&blob.storage_key).await;
            response
        }
    }
}

/// Archives the sheet, stores the record and writes both audit rows in one
/// transaction. The caller removes the blob when this fails.
#[allow(clippy::too_many_arguments)]
async fn store_new_record(
    state: &AppState,
    auth: &AuthUser,
    employee: &Employee,
    record: &ValidRecord,
    management_name: &str,
    record_id: Uuid,
    target: &Target,
    blob: &Blob,
    name: &str,
) -> Result<Value, Response> {
    let late = late_days(state).await;
    let mut tx = state
        .db
        .begin()
        .await
        .map_err(|error| internal(error, "begin GwG instruction"))?;
    let (document_id, _) = archive_in_transaction(
        &mut tx,
        auth,
        employee,
        target,
        blob,
        ArchiveEntry {
            name,
            title: Some(GWG_STAFF_TRAINING_LABEL),
            source: "generated",
            received_at: None,
            intake_item_id: None,
        },
        late,
    )
    .await?;
    let (interview, certificate, other) = match &record.reliability {
        GwgStaffReliability::LongStanding => (false, false, None),
        GwgStaffReliability::NewEmployee {
            interview,
            certificate,
            other,
        } => (*interview, *certificate, other.clone()),
    };
    sqlx::query(
        r#"INSERT INTO gwg_staff_trainings (
               id, employee_id, instructed_on, position, department, delivered_by,
               delivered_by_other, form_oral, form_material, form_other, form_other_text,
               instructions, reliability, reliability_interview, reliability_certificate,
               reliability_other, reliability_other_text, management_name, document_id, created_by
           ) VALUES (
               $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20
           )"#,
    )
    .bind(record_id)
    .bind(employee.id)
    .bind(record.instructed_on)
    .bind(&record.position)
    .bind(&record.department)
    .bind(if record.delivered_by_other.is_some() {
        "other"
    } else {
        "internal"
    })
    .bind(record.delivered_by_other.as_deref())
    .bind(record.form_oral)
    .bind(record.form_material)
    .bind(record.form_other.is_some())
    .bind(record.form_other.as_deref())
    .bind(&record.instructions)
    .bind(match record.reliability {
        GwgStaffReliability::LongStanding => "long_standing",
        GwgStaffReliability::NewEmployee { .. } => "new_employee",
    })
    .bind(interview)
    .bind(certificate)
    .bind(other.is_some())
    .bind(other.as_deref())
    .bind(management_name)
    .bind(document_id)
    .bind(auth.user_id)
    .execute(&mut *tx)
    .await
    .map_err(|error| internal(error, "insert GwG instruction"))?;
    for event in [
        audit::domain_event(
            "personnel_document_archived",
            Some(auth.user_id),
            "personnel",
            Some(document_id),
            json!({ "employee_id": employee.id, "category": CATEGORY }),
        ),
        audit::domain_event(
            "gwg_staff_training_created",
            Some(auth.user_id),
            "gwg_staff_training",
            Some(record_id),
            json!({
                "employee_id": employee.id,
                "document_id": document_id,
                "template_id": GWG_STAFF_TRAINING_TEMPLATE_ID,
                "fields": RECORD_FIELDS,
            }),
        ),
    ] {
        audit::write_in_transaction(&mut tx, &event)
            .await
            .map_err(|error| internal(error, "audit GwG instruction"))?;
    }
    let row = record_by_id(&mut tx, record_id)
        .await
        .map_err(|error| internal(error, "reload GwG instruction"))?
        .ok_or_else(|| err(StatusCode::NOT_FOUND, "GwG instruction not found"))?;
    tx.commit()
        .await
        .map_err(|error| internal(error, "commit GwG instruction"))?;
    Ok(record_json(&row))
}

/// The newest version of the document chain that starts with `document_id`.
async fn newest_version(state: &AppState, document_id: Uuid) -> Result<Option<Uuid>, sqlx::Error> {
    sqlx::query_scalar::<_, Uuid>(
        r#"SELECT d.id
           FROM personnel_documents d
           WHERE d.version_root_id = (SELECT version_root_id FROM personnel_documents WHERE id = $1)
             AND NOT EXISTS (SELECT 1 FROM personnel_documents n WHERE n.supersedes_id = d.id)
           ORDER BY d.version_number DESC
           LIMIT 1"#,
    )
    .bind(document_id)
    .fetch_optional(&state.db)
    .await
}

/// Archives the signed scan (PDF or image) as the next version of the sheet
/// and marks the record signed. A later scan replaces an earlier one the
/// same way; every version stays in the personnel file.
async fn upload_signed_copy(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(record_id): Path<Uuid>,
    mut multipart: Multipart,
) -> Response {
    if let Err(response) = auth.require_capability(Capability::PersonnelUpload) {
        return response;
    }
    let (employee_id, document_id) = match sqlx::query_as::<_, (Uuid, Uuid)>(
        "SELECT employee_id, document_id FROM gwg_staff_trainings WHERE id = $1",
    )
    .bind(record_id)
    .fetch_optional(&state.db)
    .await
    {
        Ok(Some(value)) => value,
        Ok(None) => return err(StatusCode::NOT_FOUND, "GwG instruction not found"),
        Err(error) => return internal(error, "load GwG instruction"),
    };
    let employee = match load_employee_or_404(&state, employee_id).await {
        Ok(value) => value,
        Err(response) => return response,
    };
    let (file, _) = match read_multipart(&mut multipart).await {
        Ok(value) => value,
        Err(response) => return response,
    };
    let Some((file_name, claimed_mime, data)) = file else {
        return err(StatusCode::BAD_REQUEST, "No file uploaded");
    };
    let mime_type = match accept_file(&file_name, &claimed_mime, &data).await {
        Ok(value) => value,
        Err(response) => return response,
    };
    let newest = match newest_version(&state, document_id).await {
        Ok(Some(value)) => value,
        Ok(None) => {
            return err(
                StatusCode::NOT_FOUND,
                "The sheet is not in the personnel file",
            );
        }
        Err(error) => return internal(error, "load newest sheet version"),
    };
    let fields = TargetFields {
        supersedes_id: Some(newest.to_string()),
        correction_reason: Some(SIGNED_COPY_REASON.to_string()),
        ..TargetFields::default()
    };
    let target = match resolve_target(&state, &auth, &employee, &fields).await {
        Ok(value) => value,
        Err(response) => return response,
    };
    let Some(extension) = extension_for_mime(&mime_type) else {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Only PDF, JPEG, PNG, BMP and TIFF files are accepted",
        );
    };
    let taken = match taken_names(&state, employee.id).await {
        Ok(value) => value,
        Err(response) => return response,
    };
    let name = match unique_archive_name(&employee, &target, extension, &taken) {
        Ok(value) => value,
        Err(response) => return response,
    };
    let (file_size, storage_key, original_file_name) =
        match store_document_blob(&data, &file_name).await {
            Ok(value) => value,
            Err(response) => return response,
        };
    let blob = Blob {
        storage_key,
        original_file_name,
        mime_type,
        file_size,
        sha256: sha256_hex(&data),
        source_document_id: None,
    };
    match store_signed_copy(&state, &auth, &employee, record_id, &target, &blob, &name).await {
        Ok(value) => Json(value).into_response(),
        Err(response) => {
            remove_document_blob(&blob.storage_key).await;
            response
        }
    }
}

async fn store_signed_copy(
    state: &AppState,
    auth: &AuthUser,
    employee: &Employee,
    record_id: Uuid,
    target: &Target,
    blob: &Blob,
    name: &str,
) -> Result<Value, Response> {
    let late = late_days(state).await;
    let mut tx = state
        .db
        .begin()
        .await
        .map_err(|error| internal(error, "begin signed GwG instruction"))?;
    let (document_id, _) = archive_in_transaction(
        &mut tx,
        auth,
        employee,
        target,
        blob,
        ArchiveEntry {
            name,
            title: Some(GWG_STAFF_TRAINING_LABEL),
            source: "upload",
            received_at: None,
            intake_item_id: None,
        },
        late,
    )
    .await?;
    sqlx::query(
        r#"UPDATE gwg_staff_trainings
           SET signed_document_id = $2, signed_at = now(), signed_by = $3
           WHERE id = $1"#,
    )
    .bind(record_id)
    .bind(document_id)
    .bind(auth.user_id)
    .execute(&mut *tx)
    .await
    .map_err(|error| internal(error, "mark GwG instruction signed"))?;
    for event in [
        audit::domain_event(
            "personnel_document_archived",
            Some(auth.user_id),
            "personnel",
            Some(document_id),
            json!({ "employee_id": employee.id, "category": CATEGORY }),
        ),
        audit::domain_event(
            "gwg_staff_training_signed",
            Some(auth.user_id),
            "gwg_staff_training",
            Some(record_id),
            json!({
                "employee_id": employee.id,
                "document_id": document_id,
                "fields": ["signed_document_id", "signed_at", "signed_by"],
            }),
        ),
    ] {
        audit::write_in_transaction(&mut tx, &event)
            .await
            .map_err(|error| internal(error, "audit signed GwG instruction"))?;
    }
    let row = record_by_id(&mut tx, record_id)
        .await
        .map_err(|error| internal(error, "reload GwG instruction"))?
        .ok_or_else(|| err(StatusCode::NOT_FOUND, "GwG instruction not found"))?;
    tx.commit()
        .await
        .map_err(|error| internal(error, "commit signed GwG instruction"))?;
    Ok(record_json(&row))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn date(year: i32, month: u32, day: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(year, month, day).unwrap()
    }

    fn request() -> CreateRecordRequest {
        CreateRecordRequest {
            employee_id: Some(Uuid::nil()),
            instructed_on: Some("2026-10-07".to_string()),
            position: Some("  Dolmetscher/in ".to_string()),
            department: None,
            delivered_by: Some("internal".to_string()),
            form_oral: true,
            reliability: Some("long_standing".to_string()),
            ..CreateRecordRequest::default()
        }
    }

    #[test]
    fn a_record_without_instructions_gets_all_six_in_the_order_of_the_sheet() {
        let record = validate_record(&request(), date(2026, 10, 7)).unwrap();
        assert_eq!(record.instructions.len(), 6);
        assert_eq!(record.instructions[0], "identify_partner");
        assert_eq!(record.position, "Dolmetscher/in");
        assert_eq!(record.department, "");
        assert_eq!(record.delivered_by_other, None);
        assert_eq!(record.reliability, GwgStaffReliability::LongStanding);

        let chosen = CreateRecordRequest {
            instructions: Some(vec!["record_keeping".into(), " identify_partner".into()]),
            ..request()
        };
        let record = validate_record(&chosen, date(2026, 10, 7)).unwrap();
        assert_eq!(
            record.instructions,
            vec!["identify_partner", "record_keeping"]
        );
    }

    #[test]
    fn records_need_a_past_date_a_form_and_the_texts_the_sheet_asks_for() {
        let today = date(2026, 10, 7);
        let check = |body: CreateRecordRequest| validate_record(&body, today);
        assert!(
            check(CreateRecordRequest {
                instructed_on: Some("2026-10-08".into()),
                ..request()
            })
            .is_err()
        );
        assert!(
            check(CreateRecordRequest {
                instructed_on: Some("07.10.2026".into()),
                ..request()
            })
            .is_err()
        );
        assert!(
            check(CreateRecordRequest {
                employee_id: None,
                ..request()
            })
            .is_err()
        );
        assert!(
            check(CreateRecordRequest {
                form_oral: false,
                ..request()
            })
            .is_err()
        );
        assert!(
            check(CreateRecordRequest {
                delivered_by: Some("other".into()),
                ..request()
            })
            .is_err()
        );
        let other = check(CreateRecordRequest {
            delivered_by: Some("other".into()),
            delivered_by_other: Some(" Kanzlei Beispiel ".into()),
            ..request()
        })
        .unwrap();
        assert_eq!(
            other.delivered_by_other.as_deref(),
            Some("Kanzlei Beispiel")
        );
        assert!(
            check(CreateRecordRequest {
                form_other: true,
                ..request()
            })
            .is_err()
        );
        assert!(
            check(CreateRecordRequest {
                instructions: Some(vec![]),
                ..request()
            })
            .is_err()
        );
        assert!(
            check(CreateRecordRequest {
                instructions: Some(vec!["cash_limit".into()]),
                ..request()
            })
            .is_err()
        );
        assert!(
            check(CreateRecordRequest {
                reliability: None,
                ..request()
            })
            .is_err()
        );
        // A new employee needs at least one check; "Sonstiges" needs its text.
        let new_employee = || CreateRecordRequest {
            reliability: Some("new_employee".into()),
            ..request()
        };
        assert!(check(new_employee()).is_err());
        assert!(
            check(CreateRecordRequest {
                reliability_other: true,
                ..new_employee()
            })
            .is_err()
        );
        let checked = check(CreateRecordRequest {
            reliability_certificate: true,
            ..new_employee()
        })
        .unwrap();
        assert_eq!(
            checked.reliability,
            GwgStaffReliability::NewEmployee {
                interview: false,
                certificate: true,
                other: None
            }
        );
        // The checks of a new employee are ignored for a long-standing one.
        let long_standing = check(CreateRecordRequest {
            reliability_interview: true,
            ..request()
        })
        .unwrap();
        assert_eq!(long_standing.reliability, GwgStaffReliability::LongStanding);
    }

    #[test]
    fn an_instruction_is_due_again_after_twelve_months() {
        let today = date(2026, 10, 7);
        assert!(is_due(None, today));
        assert!(!is_due(Some(date(2025, 10, 7)), today));
        assert!(is_due(Some(date(2025, 10, 6)), today));
        assert!(!is_due(Some(date(2026, 3, 1)), today));
        assert_eq!(next_due_on(date(2024, 2, 29)), date(2025, 2, 28));
    }

    #[test]
    fn positions_are_prefilled_from_the_role() {
        assert_eq!(
            default_position(Some("interpreter")),
            ("Dolmetscher/in", "Dolmetscherdienst")
        );
        assert_eq!(default_position(Some("ceo")).1, "Geschäftsleitung");
        assert_eq!(default_position(None), ("", ""));
    }
}
