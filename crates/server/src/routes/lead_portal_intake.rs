//! Lead portal intake (owner decisions 2026-10-03).
//!
//! A `patient` account linked to a lead that is neither deleted nor converted
//! — the lead's own login (`leads.portal_user_id`) or, for a minor, the login
//! of a parent or legal guardian (`lead_portal_access`, see
//! [`crate::routes::lead_portal_guardians`]) — sees the request page of the
//! patient portal: wizard step 1 (own personal data), document upload and
//! "send to the manager". Staff continue from step 2.
//!
//! Authorization: the patient endpoints accept only the `patient` role and
//! resolve the lead through the caller's own link. The lead id in the path
//! only selects among the caller's own requests (a parent may have two); a
//! lead without such a link answers 404. Every write is audited in its
//! transaction and published as the realtime event `lead.portal_updated`, so
//! an open staff wizard refreshes.
//!
//! Two consents ([`ConsentPurpose`], stored in `consent_records`): the
//! explicit Art. 9 (2)(a) DSGVO consent before the first upload of medical
//! documents (the server rejects an upload without it) and the consent to
//! process the entered data before "send to the manager".
//!
//! A login that reaches only requests is in the lead cabinet
//! (`/me.portal_mode = "lead"`); [`lead_portal_guard`] closes the rest of the
//! patient portal to it. See docs/architecture/lead-patient-portal_ua.md.

use axum::{
    Json, Router,
    extract::{DefaultBodyLimit, Extension, Multipart, Path, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{delete, get, post},
};
use chrono::{DateTime, NaiveDate, Utc};
use serde::Deserialize;
use serde_json::{Map, Value, json};
use sha2::{Digest, Sha256};
use sqlx::Row;
use sqlx::postgres::PgRow;
use uuid::Uuid;

use crate::audit;
use crate::auth::middleware::AuthUser;
use crate::routes::documents::{MAX_FILE_SIZE, NewStoredDocument, persist_document_file};
use crate::state::AppState;
use gmed_domain::access::capabilities::Capability;
use gmed_domain::role::Role;

/// Version of the consent texts below. A new wording needs a new version; a
/// consent to an older version does not count any more.
pub(crate) const HEALTH_CONSENT_VERSION: &str = "2026-10-03";
/// Languages of the consent texts (the patient portal speaks DE and RU).
const CONSENT_LANGUAGES: [&str; 2] = ["de", "ru"];
/// Active uploads per lead through the portal.
const MAX_PORTAL_UPLOADS: i64 = 30;

/// The two consents the portal collects, each stored in `consent_records`
/// with who, when, text version and the exact text shown.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ConsentPurpose {
    /// Art. 9 (2)(a) DSGVO: processing of the uploaded health documents.
    /// Required before the first upload.
    HealthData,
    /// Processing of the entered data to handle the request (owner request
    /// 2026-10-03). Required before "send to the manager". It does not
    /// replace the signed DSGVO document, which alone stops the 14-day
    /// deletion of an unqualified lead.
    InquiryProcessing,
}

impl ConsentPurpose {
    const ALL: [ConsentPurpose; 2] = [
        ConsentPurpose::HealthData,
        ConsentPurpose::InquiryProcessing,
    ];

    /// `consent_records.consent_type`.
    pub(crate) fn consent_type(self) -> &'static str {
        match self {
            ConsentPurpose::HealthData => "health_data_processing",
            ConsentPurpose::InquiryProcessing => "lead_inquiry_processing",
        }
    }

    fn parse(value: &str) -> Option<Self> {
        Self::ALL
            .into_iter()
            .find(|purpose| purpose.consent_type() == value.trim())
    }

    fn version(self) -> &'static str {
        HEALTH_CONSENT_VERSION
    }

    fn purpose(self) -> &'static str {
        match self {
            ConsentPurpose::HealthData => {
                "Processing of uploaded health documents to assess the request (Art. 9 (2)(a) DSGVO)"
            }
            ConsentPurpose::InquiryProcessing => {
                "Processing of the entered personal data to handle the request"
            }
        }
    }

    fn text(self, kind: AccessKind, language: &str) -> Option<&'static str> {
        match self {
            ConsentPurpose::HealthData => health_consent_text(kind, language),
            ConsentPurpose::InquiryProcessing => inquiry_consent_text(kind, language),
        }
    }
}

/// Checkbox text after the personal data, required before "send to the
/// manager". Wording of the owner (2026-10-03); pending legal review.
pub(crate) fn inquiry_consent_text(kind: AccessKind, language: &str) -> Option<&'static str> {
    Some(match (kind, language) {
        (AccessKind::Own, "de") => {
            "Ich bin einverstanden, dass meine Angaben zur Bearbeitung meiner Anfrage verarbeitet werden."
        }
        (AccessKind::Own, "ru") => {
            "Я согласен(на), что мои данные обрабатываются для рассмотрения моего обращения."
        }
        (AccessKind::Guardian, "de") => {
            "Ich bin einverstanden, dass meine Angaben und die Angaben meines Kindes zur Bearbeitung \
             der Anfrage verarbeitet werden."
        }
        (AccessKind::Guardian, "ru") => {
            "Я согласен(на), что мои данные и данные моего ребёнка обрабатываются для рассмотрения \
             обращения."
        }
        _ => return None,
    })
}

/// Consent text shown in the portal before the first upload of medical
/// documents. Pending legal review (see the PR description).
pub(crate) fn health_consent_text(kind: AccessKind, language: &str) -> Option<&'static str> {
    Some(match (kind, language) {
        (AccessKind::Own, "de") => {
            "Ich willige ein, dass die GMed die Gesundheitsdaten, die ich in diesem Portal hochlade \
             (zum Beispiel Arztbriefe, Befunde, Bilder und Laborwerte), verarbeitet, um meine Anfrage \
             zu prüfen und eine mögliche Behandlung in Deutschland vorzubereiten (Art. 9 Abs. 2 lit. a \
             DSGVO). An Kliniken, Ärztinnen und Ärzte gibt die GMed diese Unterlagen erst nach einer \
             gesonderten Einwilligung weiter. Die Einwilligung ist freiwillig. Ich kann sie jederzeit \
             im Portal oder gegenüber der GMed mit Wirkung für die Zukunft widerrufen; die \
             Rechtmäßigkeit der bis dahin erfolgten Verarbeitung bleibt unberührt. Kommt keine \
             Zusammenarbeit zustande, werden die Anfrage und die Unterlagen nach Ablauf der \
             angegebenen Frist gelöscht."
        }
        (AccessKind::Own, "ru") => {
            "Я даю согласие на то, чтобы GMed обрабатывала данные о моём здоровье, которые я загружаю \
             в этот портал (например, выписки, заключения, снимки и анализы), чтобы рассмотреть мою \
             заявку и подготовить возможное лечение в Германии (ст. 9 п. 2 лит. a DSGVO). Клиникам и \
             врачам GMed передаёт эти документы только после отдельного согласия. Согласие \
             добровольное. Я могу в любой момент отозвать его в портале или обратившись в GMed; отзыв \
             действует на будущее и не влияет на законность обработки до отзыва. Если сотрудничество \
             не состоится, заявка и документы удаляются по истечении указанного срока."
        }
        (AccessKind::Guardian, "de") => {
            "Als Elternteil oder gesetzlicher Vertreter willige ich ein, dass die GMed die \
             Gesundheitsdaten meines Kindes, die ich in diesem Portal hochlade (zum Beispiel \
             Arztbriefe, Befunde, Bilder und Laborwerte), verarbeitet, um die Anfrage zu prüfen und \
             eine mögliche Behandlung in Deutschland vorzubereiten (Art. 9 Abs. 2 lit. a DSGVO). An \
             Kliniken, Ärztinnen und Ärzte gibt die GMed diese Unterlagen erst nach einer gesonderten \
             Einwilligung weiter. Die Einwilligung ist freiwillig. Ich kann sie jederzeit im Portal \
             oder gegenüber der GMed mit Wirkung für die Zukunft widerrufen; die Rechtmäßigkeit der \
             bis dahin erfolgten Verarbeitung bleibt unberührt. Kommt keine Zusammenarbeit zustande, \
             werden die Anfrage und die Unterlagen nach Ablauf der angegebenen Frist gelöscht."
        }
        (AccessKind::Guardian, "ru") => {
            "Как родитель или законный представитель я даю согласие на то, чтобы GMed обрабатывала \
             данные о здоровье моего ребёнка, которые я загружаю в этот портал (например, выписки, \
             заключения, снимки и анализы), чтобы рассмотреть заявку и подготовить возможное лечение \
             в Германии (ст. 9 п. 2 лит. a DSGVO). Клиникам и врачам GMed передаёт эти документы \
             только после отдельного согласия. Согласие добровольное. Я могу в любой момент отозвать \
             его в портале или обратившись в GMed; отзыв действует на будущее и не влияет на \
             законность обработки до отзыва. Если сотрудничество не состоится, заявка и документы \
             удаляются по истечении указанного срока."
        }
        _ => return None,
    })
}

pub fn router() -> Router<AppState> {
    Router::new()
        // The patient's (or guardian's) own requests.
        .route("/me/lead-requests", get(list_my_lead_requests))
        .route("/me/lead-requests/{lead_id}", get(get_my_lead_request))
        .route(
            "/me/lead-requests/{lead_id}/personal-data",
            post(update_my_personal_data),
        )
        .route("/me/lead-requests/{lead_id}/consent", post(give_consent))
        .route(
            "/me/lead-requests/{lead_id}/consent/revoke",
            post(revoke_consent),
        )
        .route(
            "/me/lead-requests/{lead_id}/documents",
            post(upload_my_lead_document).layer(DefaultBodyLimit::max(MAX_FILE_SIZE + 1024 * 1024)),
        )
        .route(
            "/me/lead-requests/{lead_id}/documents/{document_id}",
            delete(withdraw_my_lead_document),
        )
        .route(
            "/me/lead-requests/{lead_id}/submit",
            post(submit_my_lead_request),
        )
        // Staff: what the patient did, and who fills step 1.
        .route(
            "/leads/{lead_id}/portal-intake",
            get(get_lead_portal_intake),
        )
        .route(
            "/leads/{lead_id}/portal-intake/fill-mode",
            post(set_step1_fill_mode),
        )
        .route(
            "/leads/{lead_id}/portal-intake/documents/{document_id}/review",
            post(review_portal_upload),
        )
}

// ----------------------------------------------------------------------------
// Access
// ----------------------------------------------------------------------------

/// How a login reaches a lead: its own login or a parent's / guardian's.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum AccessKind {
    Own,
    Guardian,
}

impl AccessKind {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            AccessKind::Own => "self",
            AccessKind::Guardian => "guardian",
        }
    }

    fn parse(value: &str) -> Option<Self> {
        match value {
            "self" => Some(AccessKind::Own),
            "guardian" => Some(AccessKind::Guardian),
            _ => None,
        }
    }
}

/// A lead the portal still serves: not deleted (manually or by the retention
/// rule) and not converted (a converted lead is a normal patient record).
const PORTAL_LEAD_SQL: &str = r#"
    l.qualification_status <> 'deleted'
    AND l.converted_patient_id IS NULL
    AND COALESCE(l.failed_outcome_status, 'none') <> 'delete_anonymized'"#;

/// The requests `user_id` reaches, oldest first.
pub(crate) async fn accessible_leads<'e, E>(
    executor: E,
    user_id: Uuid,
) -> Result<Vec<(Uuid, AccessKind)>, sqlx::Error>
where
    E: sqlx::Executor<'e, Database = sqlx::Postgres>,
{
    let rows = sqlx::query(&format!(
        r#"SELECT l.id, 'self' AS kind, l.created_at
           FROM leads l
           WHERE l.portal_user_id = $1 AND {PORTAL_LEAD_SQL}
           UNION ALL
           SELECT l.id, 'guardian' AS kind, l.created_at
           FROM lead_portal_access a
           JOIN leads l ON l.id = a.lead_id
           WHERE a.user_id = $1
             AND a.kind = 'guardian'
             AND a.revoked_at IS NULL
             AND {PORTAL_LEAD_SQL}
           ORDER BY 3, 1"#
    ))
    .bind(user_id)
    .fetch_all(executor)
    .await?;
    Ok(rows
        .iter()
        .filter_map(|row| {
            let id = row.try_get::<Uuid, _>("id").ok()?;
            let kind = AccessKind::parse(&row.try_get::<String, _>("kind").ok()?)?;
            Some((id, kind))
        })
        .collect())
}

/// Whether a patient login reaches only requests (leads) and no patient
/// record: the portal is then the lead cabinet (owner decision 2026-10-03).
pub(crate) async fn is_lead_only_login(
    db: &gmed_db::DbPool,
    user_id: Uuid,
) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar(&format!(
        r#"SELECT NOT EXISTS(
                   SELECT 1 FROM patient_assignments
                   WHERE user_id = $1 AND revoked_at IS NULL
               )
               AND (
                   EXISTS(SELECT 1 FROM leads l WHERE l.portal_user_id = $1 AND {PORTAL_LEAD_SQL})
                   OR EXISTS(
                       SELECT 1 FROM lead_portal_access a
                       JOIN leads l ON l.id = a.lead_id
                       WHERE a.user_id = $1 AND a.kind = 'guardian' AND a.revoked_at IS NULL
                         AND {PORTAL_LEAD_SQL}
                   )
               )"#
    ))
    .bind(user_id)
    .fetch_one(db)
    .await
}

/// `portal_mode` and `lead_portal` of `GET /me`. For a patient login the mode
/// is `lead` while it reaches only requests (the cabinet shows the request
/// page, the account and the legal notice), otherwise `patient`; staff get
/// null. `lead_portal` counts the requests the login fills in.
pub(crate) async fn me_portal(state: &AppState, auth: &AuthUser) -> (Value, Value) {
    if auth.role != Role::Patient {
        return (Value::Null, Value::Null);
    }
    let lead_only = match is_lead_only_login(&state.db, auth.user_id).await {
        Ok(value) => value,
        Err(error) => {
            tracing::warn!(%error, user = %auth.user_id, "load portal mode for /me");
            false
        }
    };
    let requests = accessible_leads(&state.db, auth.user_id)
        .await
        .map(|requests| requests.len())
        .unwrap_or(0);
    (
        json!(if lead_only { "lead" } else { "patient" }),
        if requests > 0 {
            json!({ "requests": requests })
        } else {
            Value::Null
        },
    )
}

/// Paths a lead-only login may call: identity, account (password, language,
/// second factor, sessions), the legal notice and its own requests.
pub(crate) fn lead_portal_allows_path(path: &str) -> bool {
    let path = path.strip_prefix("/api/v1").unwrap_or(path);
    matches!(
        path,
        "/me" | "/me/password" | "/me/profile" | "/me/lead-requests"
    ) || path.starts_with("/me/lead-requests/")
        || path.starts_with("/me/totp")
        || path.starts_with("/auth/")
        || path.starts_with("/legal")
        || path.starts_with("/public/")
}

/// Middleware of the protected routes: a lead-only patient login reaches
/// nothing of the patient portal but its request page and account. The
/// portal endpoints would otherwise answer with empty lists, and the e-mail
/// fallback of the patient resolution could even link an unrelated record.
pub async fn lead_portal_guard(
    State(state): State<AppState>,
    request: axum::extract::Request,
    next: axum::middleware::Next,
) -> axum::response::Response {
    let patient = request
        .extensions()
        .get::<AuthUser>()
        .filter(|auth| auth.role == Role::Patient)
        .map(|auth| auth.user_id);
    let Some(user_id) = patient else {
        return next.run(request).await;
    };
    if lead_portal_allows_path(request.uri().path()) {
        return next.run(request).await;
    }
    match is_lead_only_login(&state.db, user_id).await {
        Ok(false) => next.run(request).await,
        Ok(true) => coded(
            StatusCode::FORBIDDEN,
            "lead_portal_only",
            "Until the request is accepted, the portal offers only the request page",
            json!({}),
        ),
        Err(error) => internal(error, "check lead portal mode"),
    }
}

#[allow(clippy::result_large_err)]
fn require_patient(auth: &AuthUser) -> Result<(), axum::response::Response> {
    // Strictly the patient role: `require_any_role` would let the CEO through.
    if auth.role == Role::Patient {
        Ok(())
    } else {
        Err(err(
            StatusCode::FORBIDDEN,
            "Only the patient portal uses this endpoint",
        ))
    }
}

/// Locks the lead and checks the caller's link in the same statement. `None`
/// when the lead is gone, converted or not the caller's.
async fn lock_my_lead(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    lead_id: Uuid,
    user_id: Uuid,
) -> Result<Option<(AccessKind, PgRow)>, sqlx::Error> {
    let row = sqlx::query(&format!(
        r#"SELECT CASE
                    WHEN l.portal_user_id = $2 THEN 'self'
                    WHEN EXISTS (
                        SELECT 1 FROM lead_portal_access a
                        WHERE a.lead_id = l.id AND a.user_id = $2
                          AND a.kind = 'guardian' AND a.revoked_at IS NULL
                    ) THEN 'guardian'
                  END AS access_kind,
                  {PERSONAL_DATA_COLUMNS},
                  l.created_by, l.portal_submitted_at, l.portal_field_updates
           FROM leads l
           WHERE l.id = $1 AND {PORTAL_LEAD_SQL}
           FOR UPDATE OF l"#
    ))
    .bind(lead_id)
    .bind(user_id)
    .fetch_optional(&mut **tx)
    .await?;
    Ok(row.and_then(|row| {
        let kind = row
            .try_get::<Option<String>, _>("access_kind")
            .ok()
            .flatten()
            .and_then(|value| AccessKind::parse(&value))?;
        Some((kind, row))
    }))
}

/// Read-only variant of [`lock_my_lead`].
async fn my_lead_access(
    state: &AppState,
    lead_id: Uuid,
    user_id: Uuid,
) -> Result<Option<AccessKind>, sqlx::Error> {
    Ok(accessible_leads(&state.db, user_id)
        .await?
        .into_iter()
        .find(|(id, _)| *id == lead_id)
        .map(|(_, kind)| kind))
}

// ----------------------------------------------------------------------------
// Personal data of step 1
// ----------------------------------------------------------------------------

const PERSONAL_DATA_COLUMNS: &str = "l.first_name, l.middle_name, l.last_name, l.date_of_birth, \
     l.legal_sex, l.citizenships, l.street_address, l.zip_code, l.city, l.country, l.phone, \
     l.primary_language";

/// Fields the patient may edit (API keys = column names). The e-mail is the
/// login and stays with staff.
const EDITABLE_FIELDS: [&str; 12] = [
    "first_name",
    "middle_name",
    "last_name",
    "date_of_birth",
    "legal_sex",
    "citizenships",
    "street_address",
    "zip_code",
    "city",
    "country",
    "phone",
    "primary_language",
];

/// Fields counted in "N of M filled" (the middle name is optional for everyone).
pub(crate) const PROGRESS_FIELDS: [&str; 11] = [
    "first_name",
    "last_name",
    "date_of_birth",
    "legal_sex",
    "citizenships",
    "street_address",
    "zip_code",
    "city",
    "country",
    "phone",
    "primary_language",
];

/// Fields that must be filled before the data can be sent to the manager.
const SUBMIT_REQUIRED_FIELDS: [&str; 9] = [
    "first_name",
    "last_name",
    "date_of_birth",
    "legal_sex",
    "citizenships",
    "street_address",
    "zip_code",
    "city",
    "country",
];

const LEGAL_SEX_VALUES: [&str; 4] = ["female", "male", "diverse", "no_entry"];

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub(crate) struct PersonalData {
    first_name: String,
    middle_name: Option<String>,
    last_name: String,
    date_of_birth: Option<NaiveDate>,
    legal_sex: Option<String>,
    citizenships: Vec<String>,
    street_address: Option<String>,
    zip_code: Option<String>,
    city: Option<String>,
    country: Option<String>,
    phone: Option<String>,
    primary_language: Option<String>,
}

fn non_empty(value: Option<String>) -> Option<String> {
    value
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

impl PersonalData {
    pub(crate) fn from_row(row: &PgRow) -> Self {
        let text =
            |column: &str| non_empty(row.try_get::<Option<String>, _>(column).ok().flatten());
        PersonalData {
            first_name: row.try_get::<String, _>("first_name").unwrap_or_default(),
            middle_name: text("middle_name"),
            last_name: row.try_get::<String, _>("last_name").unwrap_or_default(),
            date_of_birth: row
                .try_get::<Option<NaiveDate>, _>("date_of_birth")
                .ok()
                .flatten(),
            legal_sex: text("legal_sex"),
            citizenships: row
                .try_get::<Vec<String>, _>("citizenships")
                .unwrap_or_default(),
            street_address: text("street_address"),
            zip_code: text("zip_code"),
            city: text("city"),
            country: text("country"),
            phone: text("phone"),
            primary_language: text("primary_language"),
        }
    }

    /// The value of a field as text, `None` when empty.
    fn value(&self, field: &str) -> Option<String> {
        let value = match field {
            "first_name" => Some(self.first_name.clone()),
            "middle_name" => self.middle_name.clone(),
            "last_name" => Some(self.last_name.clone()),
            "date_of_birth" => self
                .date_of_birth
                .map(|value| value.format("%Y-%m-%d").to_string()),
            "legal_sex" => self.legal_sex.clone(),
            "citizenships" => Some(self.citizenships.join(",")),
            "street_address" => self.street_address.clone(),
            "zip_code" => self.zip_code.clone(),
            "city" => self.city.clone(),
            "country" => self.country.clone(),
            "phone" => self.phone.clone(),
            "primary_language" => self.primary_language.clone(),
            _ => None,
        };
        value.filter(|value| !value.trim().is_empty())
    }

    pub(crate) fn filled_count(&self) -> usize {
        PROGRESS_FIELDS
            .iter()
            .filter(|field| self.value(field).is_some())
            .count()
    }

    fn missing_for_submit(&self) -> Vec<&'static str> {
        SUBMIT_REQUIRED_FIELDS
            .iter()
            .copied()
            .filter(|field| self.value(field).is_none())
            .collect()
    }

    fn to_json(&self) -> Value {
        json!({
            "first_name": self.first_name,
            "middle_name": self.middle_name,
            "last_name": self.last_name,
            "date_of_birth": self.date_of_birth.map(|value| value.format("%Y-%m-%d").to_string()),
            "legal_sex": self.legal_sex,
            "citizenships": self.citizenships,
            "street_address": self.street_address,
            "zip_code": self.zip_code,
            "city": self.city,
            "country": self.country,
            "phone": self.phone,
            "primary_language": self.primary_language,
        })
    }
}

/// Partial update from the portal form (autosave sends only changed fields).
/// An empty string clears an optional field; unknown keys — the e-mail above
/// all — are rejected.
#[derive(Debug, Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct PersonalDataPatch {
    first_name: Option<String>,
    middle_name: Option<String>,
    last_name: Option<String>,
    date_of_birth: Option<String>,
    legal_sex: Option<String>,
    citizenships: Option<Vec<String>>,
    street_address: Option<String>,
    zip_code: Option<String>,
    city: Option<String>,
    country: Option<String>,
    phone: Option<String>,
    primary_language: Option<String>,
}

#[derive(Debug, PartialEq, Eq)]
pub(crate) struct FieldError {
    field: &'static str,
    message: &'static str,
}

fn field_error(field: &'static str, message: &'static str) -> FieldError {
    FieldError { field, message }
}

fn clean_text(
    value: &str,
    field: &'static str,
    max_chars: usize,
) -> Result<Option<String>, FieldError> {
    let value = value.split_whitespace().collect::<Vec<_>>().join(" ");
    if value.chars().count() > max_chars {
        return Err(field_error(field, "Too long"));
    }
    if value.chars().any(char::is_control) {
        return Err(field_error(field, "Invalid characters"));
    }
    Ok((!value.is_empty()).then_some(value))
}

fn required_name(value: &str, field: &'static str) -> Result<String, FieldError> {
    clean_text(value, field, 100)?.ok_or_else(|| field_error(field, "Required"))
}

fn country_code(value: &str, field: &'static str) -> Result<Option<String>, FieldError> {
    let code = value.trim().to_uppercase();
    if code.is_empty() {
        return Ok(None);
    }
    if code.len() == 2 && code.chars().all(|ch| ch.is_ascii_uppercase()) {
        Ok(Some(code))
    } else {
        Err(field_error(field, "Use an ISO 3166-1 alpha-2 country code"))
    }
}

/// Applies `patch` to `current`; the result is what gets stored.
pub(crate) fn apply_personal_data_patch(
    current: &PersonalData,
    patch: &PersonalDataPatch,
    today: NaiveDate,
) -> Result<PersonalData, FieldError> {
    let mut next = current.clone();
    if let Some(value) = &patch.first_name {
        next.first_name = required_name(value, "first_name")?;
    }
    if let Some(value) = &patch.middle_name {
        next.middle_name = clean_text(value, "middle_name", 100)?;
    }
    if let Some(value) = &patch.last_name {
        next.last_name = required_name(value, "last_name")?;
    }
    if let Some(value) = &patch.date_of_birth {
        next.date_of_birth = match value.trim() {
            "" => None,
            value => {
                let date = NaiveDate::parse_from_str(value, "%Y-%m-%d")
                    .map_err(|_| field_error("date_of_birth", "Use YYYY-MM-DD"))?;
                if date > today {
                    return Err(field_error(
                        "date_of_birth",
                        "Date of birth is in the future",
                    ));
                }
                if date < NaiveDate::from_ymd_opt(1900, 1, 1).unwrap_or(date) {
                    return Err(field_error("date_of_birth", "Date of birth is too early"));
                }
                Some(date)
            }
        };
    }
    if let Some(value) = &patch.legal_sex {
        let value = value.trim().to_lowercase();
        next.legal_sex = if value.is_empty() {
            None
        } else if LEGAL_SEX_VALUES.contains(&value.as_str()) {
            Some(value)
        } else {
            return Err(field_error("legal_sex", "Invalid value"));
        };
    }
    if let Some(values) = &patch.citizenships {
        let mut codes = Vec::new();
        for value in values {
            if let Some(code) = country_code(value, "citizenships")?
                && !codes.contains(&code)
            {
                codes.push(code);
            }
        }
        if codes.len() > 5 {
            return Err(field_error("citizenships", "At most five citizenships"));
        }
        next.citizenships = codes;
    }
    if let Some(value) = &patch.street_address {
        next.street_address = clean_text(value, "street_address", 200)?;
    }
    if let Some(value) = &patch.zip_code {
        next.zip_code = clean_text(value, "zip_code", 20)?;
    }
    if let Some(value) = &patch.city {
        next.city = clean_text(value, "city", 120)?;
    }
    if let Some(value) = &patch.country {
        next.country = country_code(value, "country")?;
    }
    if let Some(value) = &patch.phone {
        let phone = clean_text(value, "phone", 40)?;
        if let Some(phone) = &phone {
            let digits = phone.chars().filter(char::is_ascii_digit).count();
            if digits < 5
                || !phone
                    .chars()
                    .all(|ch| ch.is_ascii_digit() || " +-()/.".contains(ch))
            {
                return Err(field_error("phone", "Invalid phone number"));
            }
        }
        next.phone = phone;
    }
    if let Some(value) = &patch.primary_language {
        let value = value.trim().to_lowercase();
        next.primary_language = if value.is_empty() {
            None
        } else if (2..=3).contains(&value.len()) && value.chars().all(|ch| ch.is_ascii_lowercase())
        {
            Some(value)
        } else {
            return Err(field_error("primary_language", "Use a language code"));
        };
    }
    Ok(next)
}

fn changed_fields(before: &PersonalData, after: &PersonalData) -> Vec<&'static str> {
    EDITABLE_FIELDS
        .iter()
        .copied()
        .filter(|field| before.value(field) != after.value(field))
        .collect()
}

/// Fingerprint of a field value. `leads.portal_field_updates` keeps it instead
/// of the value, so "from the patient" is shown only while the value is still
/// the one the patient entered, without a second copy of the data.
pub(crate) fn value_marker(lead_id: Uuid, field: &str, value: Option<&str>) -> String {
    let digest = hex::encode(Sha256::digest(
        format!("{lead_id}:{field}:{}", value.unwrap_or_default()).as_bytes(),
    ));
    digest[..24].to_string()
}

/// Fields whose current value is the one the patient entered, with when.
fn patient_field_markers(lead_id: Uuid, data: &PersonalData, updates: &Value) -> Value {
    let mut markers = Map::new();
    let Some(updates) = updates.as_object() else {
        return Value::Object(markers);
    };
    for field in EDITABLE_FIELDS {
        let Some(update) = updates.get(field) else {
            continue;
        };
        let current = value_marker(lead_id, field, data.value(field).as_deref());
        if update.get("hash").and_then(Value::as_str) == Some(current.as_str()) {
            markers.insert(
                field.to_string(),
                json!({
                    "at": update.get("at").cloned().unwrap_or(Value::Null),
                    "access_kind": update.get("kind").cloned().unwrap_or(Value::Null),
                }),
            );
        }
    }
    Value::Object(markers)
}

// ----------------------------------------------------------------------------
// Request payload
// ----------------------------------------------------------------------------

/// When the unqualified-lead rule deletes the lead, if it applies.
async fn retention_deadline(state: &AppState, row: &PgRow) -> Option<DateTime<Utc>> {
    let policy = crate::routes::leads::load_unqualified_lead_retention(&state.db).await?;
    policy.deadline(
        &row.try_get::<String, _>("qualification_status").ok()?,
        &row.try_get::<String, _>("compliance_status").ok()?,
        row.try_get::<DateTime<Utc>, _>("created_at").ok()?,
    )
}

/// The caller's consent of the current version for this lead, if given.
async fn active_consent<'e, E>(
    executor: E,
    lead_id: Uuid,
    user_id: Uuid,
    purpose: ConsentPurpose,
) -> Result<Option<(Uuid, DateTime<Utc>)>, sqlx::Error>
where
    E: sqlx::Executor<'e, Database = sqlx::Postgres>,
{
    sqlx::query_as::<_, (Uuid, DateTime<Utc>)>(
        r#"SELECT id, COALESCE(granted_at, created_at)
           FROM consent_records
           WHERE lead_id = $1
             AND user_id = $2
             AND consent_type = $3
             AND granted = true
             AND revoked_at IS NULL
             AND context->>'text_version' = $4
           ORDER BY granted_at DESC
           LIMIT 1"#,
    )
    .bind(lead_id)
    .bind(user_id)
    .bind(purpose.consent_type())
    .bind(purpose.version())
    .fetch_optional(executor)
    .await
}

/// The request page of one lead for the portal.
async fn request_payload(
    state: &AppState,
    lead_id: Uuid,
    user_id: Uuid,
    kind: AccessKind,
) -> Result<Value, sqlx::Error> {
    let row = sqlx::query(&format!(
        r#"SELECT {PERSONAL_DATA_COLUMNS}, l.created_at, l.qualification_status,
                  l.compliance_status, l.portal_submitted_at
           FROM leads l
           WHERE l.id = $1"#
    ))
    .bind(lead_id)
    .fetch_one(&state.db)
    .await?;
    let data = PersonalData::from_row(&row);
    let uploads = sqlx::query(
        r#"SELECT u.document_id, u.created_at, u.reviewed_at, u.uploaded_by,
                  d.original_filename, d.auto_name, d.file_size, d.mime_type, d.patient_id
           FROM lead_portal_uploads u
           JOIN documents d ON d.id = u.document_id
           WHERE u.lead_id = $1
             AND u.withdrawn_at IS NULL
             AND d.file_deleted_at IS NULL
           ORDER BY u.created_at, u.document_id"#,
    )
    .bind(lead_id)
    .fetch_all(&state.db)
    .await?;
    let documents: Vec<Value> = uploads
        .iter()
        .map(|upload| {
            let reviewed = upload
                .try_get::<Option<DateTime<Utc>>, _>("reviewed_at")
                .ok()
                .flatten()
                .is_some();
            let mine = upload.try_get::<Uuid, _>("uploaded_by").ok() == Some(user_id);
            let moved = upload
                .try_get::<Option<Uuid>, _>("patient_id")
                .ok()
                .flatten()
                .is_some();
            json!({
                "id": upload.try_get::<Uuid, _>("document_id").ok(),
                "file_name": upload
                    .try_get::<Option<String>, _>("original_filename")
                    .ok()
                    .flatten()
                    .or_else(|| upload.try_get::<String, _>("auto_name").ok()),
                "size_bytes": upload.try_get::<Option<i64>, _>("file_size").ok().flatten(),
                "mime_type": upload.try_get::<Option<String>, _>("mime_type").ok().flatten(),
                "uploaded_at": upload.try_get::<DateTime<Utc>, _>("created_at").ok(),
                "uploaded_by_me": mine,
                "reviewed": reviewed,
                "can_delete": mine && !reviewed && !moved,
            })
        })
        .collect();
    let mut consents = Map::new();
    for purpose in ConsentPurpose::ALL {
        let given = active_consent(&state.db, lead_id, user_id, purpose).await?;
        let texts: Map<String, Value> = CONSENT_LANGUAGES
            .iter()
            .filter_map(|language| {
                purpose
                    .text(kind, language)
                    .map(|text| (language.to_string(), Value::String(text.to_string())))
            })
            .collect();
        consents.insert(
            purpose.consent_type().to_string(),
            json!({
                "type": purpose.consent_type(),
                "version": purpose.version(),
                "texts": texts,
                "given_at": given.map(|(_, given_at)| given_at),
            }),
        );
    }
    let deadline = retention_deadline(state, &row).await;
    Ok(json!({
        "lead_id": lead_id,
        "access_kind": kind.as_str(),
        "created_at": row.try_get::<DateTime<Utc>, _>("created_at").ok(),
        "personal_data": data.to_json(),
        "progress": {
            "filled": data.filled_count(),
            "total": PROGRESS_FIELDS.len(),
            "missing_for_submit": data.missing_for_submit(),
        },
        "minor": crate::routes::leads::is_minor_on(data.date_of_birth, crate::app_time::today()),
        "documents": documents,
        "max_documents": MAX_PORTAL_UPLOADS,
        "consents": consents,
        "submitted_at": row
            .try_get::<Option<DateTime<Utc>>, _>("portal_submitted_at")
            .ok()
            .flatten(),
        "retention_deadline_at": deadline,
    }))
}

// ----------------------------------------------------------------------------
// Patient endpoints
// ----------------------------------------------------------------------------

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

fn coded(status: StatusCode, code: &str, message: &str, extra: Value) -> axum::response::Response {
    let mut body = json!({
        "error": status.canonical_reason().unwrap_or("error"),
        "code": code,
        "message": message,
    });
    if let (Some(body), Some(extra)) = (body.as_object_mut(), extra.as_object()) {
        for (key, value) in extra {
            body.insert(key.clone(), value.clone());
        }
    }
    (status, Json(body)).into_response()
}

fn internal(error: impl std::fmt::Display, what: &str) -> axum::response::Response {
    tracing::error!(%error, what, "lead portal intake");
    err(StatusCode::INTERNAL_SERVER_ERROR, "Failed")
}

fn not_found() -> axum::response::Response {
    err(StatusCode::NOT_FOUND, "Request not found")
}

/// `GET /me/lead-requests`: every request the caller reaches, oldest first.
async fn list_my_lead_requests(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
) -> axum::response::Response {
    if let Err(response) = require_patient(&auth) {
        return response;
    }
    let leads = match accessible_leads(&state.db, auth.user_id).await {
        Ok(leads) => leads,
        Err(error) => return internal(error, "list requests"),
    };
    let mut requests = Vec::with_capacity(leads.len());
    for (lead_id, kind) in leads {
        match request_payload(&state, lead_id, auth.user_id, kind).await {
            Ok(payload) => requests.push(payload),
            Err(error) => return internal(error, "load request"),
        }
    }
    Json(json!({ "requests": requests })).into_response()
}

/// `GET /me/lead-requests/{lead_id}`.
async fn get_my_lead_request(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(lead_id): Path<Uuid>,
) -> axum::response::Response {
    if let Err(response) = require_patient(&auth) {
        return response;
    }
    let kind = match my_lead_access(&state, lead_id, auth.user_id).await {
        Ok(Some(kind)) => kind,
        Ok(None) => return not_found(),
        Err(error) => return internal(error, "resolve request"),
    };
    match request_payload(&state, lead_id, auth.user_id, kind).await {
        Ok(payload) => Json(payload).into_response(),
        Err(error) => internal(error, "load request"),
    }
}

/// `POST /me/lead-requests/{lead_id}/personal-data`: autosave of step 1.
async fn update_my_personal_data(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(lead_id): Path<Uuid>,
    Json(patch): Json<PersonalDataPatch>,
) -> axum::response::Response {
    if let Err(response) = require_patient(&auth) {
        return response;
    }
    let mut tx = match state.db.begin().await {
        Ok(tx) => tx,
        Err(error) => return internal(error, "begin"),
    };
    let (kind, row) = match lock_my_lead(&mut tx, lead_id, auth.user_id).await {
        Ok(Some(found)) => found,
        Ok(None) => return not_found(),
        Err(error) => return internal(error, "lock request"),
    };
    let current = PersonalData::from_row(&row);
    let today = crate::app_time::today();
    let next = match apply_personal_data_patch(&current, &patch, today) {
        Ok(next) => next,
        Err(error) => {
            return coded(
                StatusCode::UNPROCESSABLE_ENTITY,
                "invalid_field",
                error.message,
                json!({ "field": error.field }),
            );
        }
    };
    // A minor has no own login (owner decision 2026-10-03): the parents fill
    // in the request. The date is not stored; staff are told to issue the
    // parents' access instead.
    if kind == AccessKind::Own
        && next.date_of_birth != current.date_of_birth
        && crate::routes::leads::is_minor_on(next.date_of_birth, today)
    {
        drop(tx);
        notify_lead_staff(
            &state,
            lead_id,
            "lead_portal_minor",
            "Patient is under 18: issue the parents' access",
            "The patient entered a date of birth under 18 in the portal. A minor has no own login; issue access to a parent or legal guardian.",
        )
        .await;
        return coded(
            StatusCode::UNPROCESSABLE_ENTITY,
            "minor_needs_guardian",
            "Under 18 the parents or the legal guardian fill in the request",
            json!({ "field": "date_of_birth" }),
        );
    }
    let changed = changed_fields(&current, &next);
    if changed.is_empty() {
        drop(tx);
        return match request_payload(&state, lead_id, auth.user_id, kind).await {
            Ok(payload) => Json(payload).into_response(),
            Err(error) => internal(error, "load request"),
        };
    }

    let now = Utc::now();
    let mut markers = Map::new();
    for field in &changed {
        markers.insert(
            field.to_string(),
            json!({
                "at": now,
                "by": auth.user_id,
                "kind": kind.as_str(),
                "hash": value_marker(lead_id, field, next.value(field).as_deref()),
            }),
        );
    }
    let citizenships_changed = changed.contains(&"citizenships");
    if let Err(error) = sqlx::query(
        r#"UPDATE leads
           SET first_name = $2,
               middle_name = $3,
               last_name = $4,
               date_of_birth = $5,
               legal_sex = $6,
               citizenships = $7,
               street_address = $8,
               zip_code = $9,
               city = $10,
               country = $11,
               phone = $12,
               primary_language = $13,
               -- The wizard and older readers still use the single
               -- registration country: the first citizenship.
               wizard_state = CASE
                   WHEN NOT $14 THEN wizard_state
                   WHEN cardinality($7::text[]) > 0
                       THEN jsonb_set(wizard_state, '{registration_country}', to_jsonb(($7::text[])[1]))
                   ELSE wizard_state - 'registration_country'
               END,
               portal_field_updates = portal_field_updates || $15::jsonb,
               updated_at = now()
           WHERE id = $1"#,
    )
    .bind(lead_id)
    .bind(&next.first_name)
    .bind(&next.middle_name)
    .bind(&next.last_name)
    .bind(next.date_of_birth)
    .bind(&next.legal_sex)
    .bind(&next.citizenships)
    .bind(&next.street_address)
    .bind(&next.zip_code)
    .bind(&next.city)
    .bind(&next.country)
    .bind(&next.phone)
    .bind(&next.primary_language)
    .bind(citizenships_changed)
    .bind(Value::Object(markers))
    .execute(&mut *tx)
    .await
    {
        return internal(error, "update personal data");
    }
    if let Err(error) = audit::write_in_transaction(
        &mut tx,
        &audit::domain_event(
            "lead_portal_update_personal_data",
            Some(auth.user_id),
            "lead",
            Some(lead_id),
            json!({ "fields": changed, "access_kind": kind.as_str() }),
        ),
    )
    .await
    {
        return internal(error, "audit personal data");
    }
    if let Err(error) = tx.commit().await {
        return internal(error, "commit personal data");
    }
    crate::realtime::publish_lead_event(
        &state,
        Some(auth.user_id),
        "lead.portal_updated",
        lead_id,
        json!({ "change": "personal_data", "fields": changed, "access_kind": kind.as_str() }),
    )
    .await;
    match request_payload(&state, lead_id, auth.user_id, kind).await {
        Ok(payload) => Json(payload).into_response(),
        Err(error) => internal(error, "load request"),
    }
}

#[derive(Deserialize)]
struct ConsentRequest {
    /// `consent_records.consent_type` of the consent.
    purpose: String,
    version: String,
    language: String,
}

#[derive(Deserialize)]
struct ConsentRevokeRequest {
    purpose: String,
}

#[allow(clippy::result_large_err)]
fn consent_purpose(value: &str) -> Result<ConsentPurpose, axum::response::Response> {
    ConsentPurpose::parse(value).ok_or_else(|| {
        err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Purpose must be health_data_processing or lead_inquiry_processing",
        )
    })
}

/// `POST /me/lead-requests/{lead_id}/consent`: a consent of the caller (who,
/// when, text version, purpose and the exact text shown).
async fn give_consent(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(lead_id): Path<Uuid>,
    Json(body): Json<ConsentRequest>,
) -> axum::response::Response {
    if let Err(response) = require_patient(&auth) {
        return response;
    }
    let purpose = match consent_purpose(&body.purpose) {
        Ok(purpose) => purpose,
        Err(response) => return response,
    };
    if body.version != purpose.version() {
        return coded(
            StatusCode::CONFLICT,
            "consent_version_outdated",
            "The consent text has changed; reload the page",
            json!({ "version": purpose.version() }),
        );
    }
    let language = body.language.trim().to_lowercase();
    let mut tx = match state.db.begin().await {
        Ok(tx) => tx,
        Err(error) => return internal(error, "begin"),
    };
    let kind = match lock_my_lead(&mut tx, lead_id, auth.user_id).await {
        Ok(Some((kind, _))) => kind,
        Ok(None) => return not_found(),
        Err(error) => return internal(error, "lock request"),
    };
    let Some(text) = purpose.text(kind, &language) else {
        return err(StatusCode::UNPROCESSABLE_ENTITY, "Unsupported language");
    };
    match active_consent(&mut *tx, lead_id, auth.user_id, purpose).await {
        Ok(Some((_, given_at))) => {
            drop(tx);
            return Json(json!({
                "purpose": purpose.consent_type(),
                "given_at": given_at,
                "version": purpose.version(),
            }))
            .into_response();
        }
        Ok(None) => {}
        Err(error) => return internal(error, "load consent"),
    }
    let context = json!({
        "source": "lead_portal",
        "purpose": purpose.purpose(),
        "text_version": purpose.version(),
        "language": language,
        "text": text,
        "text_sha256": hex::encode(Sha256::digest(text.as_bytes())),
        "access_kind": kind.as_str(),
        "source_lead_id": lead_id,
    });
    let (consent_id, given_at): (Uuid, DateTime<Utc>) = match sqlx::query_as(
        r#"INSERT INTO consent_records (user_id, consent_type, granted, granted_at, context, lead_id)
           VALUES ($1, $2, true, now(), $3, $4)
           RETURNING id, granted_at"#,
    )
    .bind(auth.user_id)
    .bind(purpose.consent_type())
    .bind(&context)
    .bind(lead_id)
    .fetch_one(&mut *tx)
    .await
    {
        Ok(row) => row,
        Err(error) => return internal(error, "insert consent"),
    };
    if let Err(error) = audit::write_in_transaction(
        &mut tx,
        &audit::domain_event(
            "lead_portal_consent_given",
            Some(auth.user_id),
            "lead",
            Some(lead_id),
            json!({
                "consent_record_id": consent_id,
                "consent_type": purpose.consent_type(),
                "text_version": purpose.version(),
                "language": language,
                "access_kind": kind.as_str(),
            }),
        ),
    )
    .await
    {
        return internal(error, "audit consent");
    }
    if let Err(error) = tx.commit().await {
        return internal(error, "commit consent");
    }
    crate::realtime::publish_lead_event(
        &state,
        Some(auth.user_id),
        "lead.portal_updated",
        lead_id,
        json!({
            "change": "consent_given",
            "purpose": purpose.consent_type(),
            "access_kind": kind.as_str(),
        }),
    )
    .await;
    (
        StatusCode::CREATED,
        Json(json!({
            "purpose": purpose.consent_type(),
            "given_at": given_at,
            "version": purpose.version(),
        })),
    )
        .into_response()
}

/// `POST /me/lead-requests/{lead_id}/consent/revoke`: withdrawal for the
/// future (Art. 7 (3) DSGVO). Further uploads (health data) or a new "send"
/// (request processing) need a new consent; staff are told so they can
/// decide on what was already received.
async fn revoke_consent(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(lead_id): Path<Uuid>,
    Json(body): Json<ConsentRevokeRequest>,
) -> axum::response::Response {
    if let Err(response) = require_patient(&auth) {
        return response;
    }
    let purpose = match consent_purpose(&body.purpose) {
        Ok(purpose) => purpose,
        Err(response) => return response,
    };
    let mut tx = match state.db.begin().await {
        Ok(tx) => tx,
        Err(error) => return internal(error, "begin"),
    };
    let kind = match lock_my_lead(&mut tx, lead_id, auth.user_id).await {
        Ok(Some((kind, _))) => kind,
        Ok(None) => return not_found(),
        Err(error) => return internal(error, "lock request"),
    };
    let revoked: Vec<Uuid> = match sqlx::query_scalar(
        r#"UPDATE consent_records
           SET revoked_at = now()
           WHERE lead_id = $1 AND user_id = $2 AND consent_type = $3
             AND granted = true AND revoked_at IS NULL
           RETURNING id"#,
    )
    .bind(lead_id)
    .bind(auth.user_id)
    .bind(purpose.consent_type())
    .fetch_all(&mut *tx)
    .await
    {
        Ok(ids) => ids,
        Err(error) => return internal(error, "revoke consent"),
    };
    if revoked.is_empty() {
        drop(tx);
        return Json(json!({ "purpose": purpose.consent_type(), "revoked": false }))
            .into_response();
    }
    if let Err(error) = audit::write_in_transaction(
        &mut tx,
        &audit::domain_event(
            "lead_portal_consent_revoked",
            Some(auth.user_id),
            "lead",
            Some(lead_id),
            json!({
                "consent_record_ids": revoked,
                "consent_type": purpose.consent_type(),
                "access_kind": kind.as_str(),
                "gdpr_article": "7(3)",
            }),
        ),
    )
    .await
    {
        return internal(error, "audit consent revocation");
    }
    if let Err(error) = tx.commit().await {
        return internal(error, "commit consent revocation");
    }
    let (title, body) = match purpose {
        ConsentPurpose::HealthData => (
            "Patient withdrew the consent to process health data",
            "The patient withdrew the consent in the portal (health data). Decide on the documents already uploaded.",
        ),
        ConsentPurpose::InquiryProcessing => (
            "Patient withdrew the consent to process the request data",
            "The patient withdrew the consent in the portal (request data). Decide how to continue with the request.",
        ),
    };
    notify_lead_staff(&state, lead_id, "lead_portal_consent_revoked", title, body).await;
    crate::realtime::publish_lead_event(
        &state,
        Some(auth.user_id),
        "lead.portal_updated",
        lead_id,
        json!({
            "change": "consent_revoked",
            "purpose": purpose.consent_type(),
            "access_kind": kind.as_str(),
        }),
    )
    .await;
    Json(json!({ "purpose": purpose.consent_type(), "revoked": true })).into_response()
}

/// `POST /me/lead-requests/{lead_id}/documents` (multipart `file`): a medical
/// document of the request. Needs the caller's consent of the current version.
async fn upload_my_lead_document(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(lead_id): Path<Uuid>,
    mut multipart: Multipart,
) -> axum::response::Response {
    if let Err(response) = require_patient(&auth) {
        return response;
    }
    let kind = match my_lead_access(&state, lead_id, auth.user_id).await {
        Ok(Some(kind)) => kind,
        Ok(None) => return not_found(),
        Err(error) => return internal(error, "resolve request"),
    };
    match active_consent(&state.db, lead_id, auth.user_id, ConsentPurpose::HealthData).await {
        Ok(Some(_)) => {}
        Ok(None) => {
            return coded(
                StatusCode::FORBIDDEN,
                "health_consent_required",
                "Consent to the processing of health data is required before uploading",
                json!({ "version": HEALTH_CONSENT_VERSION }),
            );
        }
        Err(error) => return internal(error, "load consent"),
    }

    let mut file: Option<(String, Option<String>, Vec<u8>)> = None;
    while let Ok(Some(field)) = multipart.next_field().await {
        if field.name() != Some("file") {
            continue;
        }
        let file_name = field
            .file_name()
            .map(str::trim)
            .filter(|name| !name.is_empty())
            .unwrap_or("document")
            .chars()
            .take(200)
            .collect::<String>();
        let content_type = field.content_type().map(ToOwned::to_owned);
        match field.bytes().await {
            Ok(bytes) if bytes.len() > MAX_FILE_SIZE => {
                return err(StatusCode::PAYLOAD_TOO_LARGE, "File too large (max 25MB)");
            }
            Ok(bytes) => file = Some((file_name, content_type, bytes.to_vec())),
            Err(error) => {
                tracing::warn!(%error, "read lead portal upload");
                return err(StatusCode::BAD_REQUEST, "Failed to read uploaded file");
            }
        }
    }
    let Some((file_name, content_type, data)) = file.filter(|(_, _, data)| !data.is_empty()) else {
        return err(StatusCode::BAD_REQUEST, "No file uploaded");
    };

    let active_uploads: i64 = match sqlx::query_scalar(
        r#"SELECT count(*) FROM lead_portal_uploads u
           JOIN documents d ON d.id = u.document_id
           WHERE u.lead_id = $1 AND u.withdrawn_at IS NULL AND d.file_deleted_at IS NULL"#,
    )
    .bind(lead_id)
    .fetch_one(&state.db)
    .await
    {
        Ok(count) => count,
        Err(error) => return internal(error, "count uploads"),
    };
    if active_uploads >= MAX_PORTAL_UPLOADS {
        return coded(
            StatusCode::UNPROCESSABLE_ENTITY,
            "too_many_documents",
            "Too many documents for this request",
            json!({ "max_documents": MAX_PORTAL_UPLOADS }),
        );
    }

    // Same checks as the files of the website questionnaire: the content must
    // match the file type, and the malware scan must not object.
    let mime_type = match crate::routes::leads::validate_lead_attachment(
        &file_name,
        content_type.as_deref(),
        &data,
    )
    .await
    {
        Ok(mime_type) => mime_type,
        Err(response) => return response,
    };
    let input = NewStoredDocument {
        document_id: None,
        document_number: None,
        patient_id: None,
        lead_id: Some(lead_id),
        order_id: None,
        appointment_id: None,
        auto_name: &file_name,
        original_filename: &file_name,
        art: "patient_medical_upload",
        category: Some("medical"),
        status: "active",
        visibility: "internal",
        is_medical: true,
        mime_type: &mime_type,
        klinik: None,
        ursprung: Some("lead_portal"),
        notes: None,
        document_direction: Some("incoming"),
        document_variant: Some("original"),
        document_language: None,
        access_category: Some("medical"),
        document_date: Some(crate::app_time::today()),
        source_person: Some("patient_portal"),
        source_institution: None,
        addressee_person: None,
        addressee_institution: Some("GMED"),
        financial_status: None,
        payment_due_date: None,
        payment_date: None,
        payment_method: None,
        generated_template_id: None,
        generated_bindings: None,
        generated_manual_text: None,
        version_root_document_id: None,
        replaces_document_id: None,
        version_number: 1,
        uploaded_by: auth.user_id,
    };
    let (document_id, file_size, _, storage_key) =
        match persist_document_file(&state, &data, &input).await {
            Ok(stored) => stored,
            Err(response) => return response,
        };

    // The upload is registered with its consent in one transaction; if the
    // link or the consent went away meanwhile, the stored file goes again.
    let registered = async {
        let mut tx = state.db.begin().await?;
        let Some((kind, _)) = lock_my_lead(&mut tx, lead_id, auth.user_id).await? else {
            return Ok::<_, sqlx::Error>(None);
        };
        let Some((consent_id, _)) =
            active_consent(&mut *tx, lead_id, auth.user_id, ConsentPurpose::HealthData).await?
        else {
            return Ok(None);
        };
        sqlx::query(
            r#"INSERT INTO lead_portal_uploads
                   (document_id, lead_id, uploaded_by, access_kind, consent_record_id)
               VALUES ($1, $2, $3, $4, $5)"#,
        )
        .bind(document_id)
        .bind(lead_id)
        .bind(auth.user_id)
        .bind(kind.as_str())
        .bind(consent_id)
        .execute(&mut *tx)
        .await?;
        audit::write_in_transaction(
            &mut tx,
            &audit::domain_event(
                "lead_portal_upload_document",
                Some(auth.user_id),
                "document",
                Some(document_id),
                json!({
                    "lead_id": lead_id,
                    "access_kind": kind.as_str(),
                    "consent_record_id": consent_id,
                    "mime_type": mime_type,
                    "file_size": file_size,
                    "is_medical": true,
                }),
            ),
        )
        .await?;
        tx.commit().await?;
        Ok(Some(kind))
    }
    .await;
    match registered {
        Ok(Some(_)) => {}
        Ok(None) => {
            discard_stored_document(&state, document_id, &storage_key).await;
            return not_found();
        }
        Err(error) => {
            discard_stored_document(&state, document_id, &storage_key).await;
            return internal(error, "register upload");
        }
    }
    crate::realtime::publish_lead_event(
        &state,
        Some(auth.user_id),
        "lead.portal_updated",
        lead_id,
        json!({ "change": "document_uploaded", "document_id": document_id, "access_kind": kind.as_str() }),
    )
    .await;
    match request_payload(&state, lead_id, auth.user_id, kind).await {
        Ok(payload) => (StatusCode::CREATED, Json(payload)).into_response(),
        Err(error) => internal(error, "load request"),
    }
}

/// Removes a stored document that could not be registered as a portal upload.
async fn discard_stored_document(state: &AppState, document_id: Uuid, storage_key: &str) {
    if let Err(error) = sqlx::query("DELETE FROM documents WHERE id = $1")
        .bind(document_id)
        .execute(&state.db)
        .await
    {
        tracing::error!(%error, %document_id, "discard unregistered lead portal upload");
        return;
    }
    if let Ok(Some(staged)) =
        crate::routes::documents::stage_document_file_delete(Some(storage_key)).await
    {
        crate::routes::documents::finalize_staged_document_delete(&staged).await;
    }
}

/// `DELETE /me/lead-requests/{lead_id}/documents/{document_id}`: the uploader
/// removes an upload that staff have not reviewed yet.
async fn withdraw_my_lead_document(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path((lead_id, document_id)): Path<(Uuid, Uuid)>,
) -> axum::response::Response {
    if let Err(response) = require_patient(&auth) {
        return response;
    }
    let mut tx = match state.db.begin().await {
        Ok(tx) => tx,
        Err(error) => return internal(error, "begin"),
    };
    let kind = match lock_my_lead(&mut tx, lead_id, auth.user_id).await {
        Ok(Some((kind, _))) => kind,
        Ok(None) => return not_found(),
        Err(error) => return internal(error, "lock request"),
    };
    let upload = match sqlx::query(
        r#"SELECT u.uploaded_by, u.reviewed_at, d.storage_key, d.patient_id, d.lead_id,
                  d.signed_at,
                  EXISTS(SELECT 1 FROM document_shares s WHERE s.document_id = d.id) AS shared,
                  EXISTS(SELECT 1 FROM document_review_events r WHERE r.document_id = d.id)
                      AS in_review
           FROM lead_portal_uploads u
           JOIN documents d ON d.id = u.document_id
           WHERE u.document_id = $1
             AND u.lead_id = $2
             AND u.withdrawn_at IS NULL
             AND d.file_deleted_at IS NULL
           FOR UPDATE OF u, d"#,
    )
    .bind(document_id)
    .bind(lead_id)
    .fetch_optional(&mut *tx)
    .await
    {
        Ok(Some(row)) => row,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Document not found"),
        Err(error) => return internal(error, "lock upload"),
    };
    if upload.try_get::<Uuid, _>("uploaded_by").ok() != Some(auth.user_id) {
        return err(
            StatusCode::FORBIDDEN,
            "Only the person who uploaded the document can remove it",
        );
    }
    let reviewed = upload
        .try_get::<Option<DateTime<Utc>>, _>("reviewed_at")
        .ok()
        .flatten()
        .is_some();
    let in_use = upload
        .try_get::<Option<Uuid>, _>("patient_id")
        .ok()
        .flatten()
        .is_some()
        || upload.try_get::<Option<Uuid>, _>("lead_id").ok().flatten() != Some(lead_id)
        || upload
            .try_get::<Option<DateTime<Utc>>, _>("signed_at")
            .ok()
            .flatten()
            .is_some()
        || upload.try_get::<bool, _>("shared").unwrap_or(true)
        || upload.try_get::<bool, _>("in_review").unwrap_or(true);
    if reviewed || in_use {
        return coded(
            StatusCode::CONFLICT,
            "upload_reviewed",
            "Staff have already taken over this document; ask them to remove it",
            json!({}),
        );
    }
    let storage_key: Option<String> = upload.try_get("storage_key").ok().flatten();
    let staged =
        match crate::routes::documents::stage_document_file_delete(storage_key.as_deref()).await {
            Ok(staged) => staged,
            Err(response) => return response,
        };
    let result = async {
        sqlx::query(
            r#"UPDATE documents
               SET status = 'archived',
                   visibility = 'internal',
                   storage_key = NULL,
                   file_deleted_at = now(),
                   file_deleted_by = $2,
                   file_delete_reason = 'Removed by the patient in the portal before review'
               WHERE id = $1"#,
        )
        .bind(document_id)
        .bind(auth.user_id)
        .execute(&mut *tx)
        .await?;
        sqlx::query("UPDATE lead_portal_uploads SET withdrawn_at = now() WHERE document_id = $1")
            .bind(document_id)
            .execute(&mut *tx)
            .await?;
        audit::write_in_transaction(
            &mut tx,
            &audit::domain_event(
                "lead_portal_withdraw_document",
                Some(auth.user_id),
                "document",
                Some(document_id),
                json!({
                    "lead_id": lead_id,
                    "access_kind": kind.as_str(),
                    "file_removed_from_disk": staged.is_some(),
                }),
            ),
        )
        .await?;
        tx.commit().await
    }
    .await;
    if let Err(error) = result {
        if let Some(staged) = staged.as_ref() {
            crate::routes::documents::rollback_staged_document_delete(staged).await;
        }
        return internal(error, "withdraw upload");
    }
    if let Some(staged) = staged.as_ref() {
        crate::routes::documents::finalize_staged_document_delete(staged).await;
    }
    crate::realtime::publish_lead_event(
        &state,
        Some(auth.user_id),
        "lead.portal_updated",
        lead_id,
        json!({ "change": "document_withdrawn", "document_id": document_id, "access_kind": kind.as_str() }),
    )
    .await;
    match request_payload(&state, lead_id, auth.user_id, kind).await {
        Ok(payload) => Json(payload).into_response(),
        Err(error) => internal(error, "load request"),
    }
}

/// `POST /me/lead-requests/{lead_id}/submit`: "send to the manager". Marks
/// the data as submitted and tells the lead's owner and the patient managers.
/// The data stays editable; a later send updates the time.
async fn submit_my_lead_request(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(lead_id): Path<Uuid>,
) -> axum::response::Response {
    if let Err(response) = require_patient(&auth) {
        return response;
    }
    let mut tx = match state.db.begin().await {
        Ok(tx) => tx,
        Err(error) => return internal(error, "begin"),
    };
    let (kind, row) = match lock_my_lead(&mut tx, lead_id, auth.user_id).await {
        Ok(Some(found)) => found,
        Ok(None) => return not_found(),
        Err(error) => return internal(error, "lock request"),
    };
    let data = PersonalData::from_row(&row);
    let missing = data.missing_for_submit();
    if !missing.is_empty() {
        return coded(
            StatusCode::UNPROCESSABLE_ENTITY,
            "personal_data_incomplete",
            "Please complete the personal data first",
            json!({ "missing": missing }),
        );
    }
    // The checkbox after the personal data (owner request 2026-10-03).
    let inquiry_consent = match active_consent(
        &mut *tx,
        lead_id,
        auth.user_id,
        ConsentPurpose::InquiryProcessing,
    )
    .await
    {
        Ok(consent) => consent,
        Err(error) => return internal(error, "load consent"),
    };
    let Some((inquiry_consent_id, _)) = inquiry_consent else {
        return coded(
            StatusCode::UNPROCESSABLE_ENTITY,
            "inquiry_consent_required",
            "Please agree to the processing of your data for the request first",
            json!({ "purpose": ConsentPurpose::InquiryProcessing.consent_type() }),
        );
    };
    let documents: i64 = match sqlx::query_scalar(
        r#"SELECT count(*) FROM lead_portal_uploads u
           JOIN documents d ON d.id = u.document_id
           WHERE u.lead_id = $1 AND u.withdrawn_at IS NULL AND d.file_deleted_at IS NULL"#,
    )
    .bind(lead_id)
    .fetch_one(&mut *tx)
    .await
    {
        Ok(count) => count,
        Err(error) => return internal(error, "count uploads"),
    };
    if let Err(error) = sqlx::query(
        r#"UPDATE leads
           SET portal_submitted_at = now(), portal_submitted_by = $2, updated_at = now()
           WHERE id = $1"#,
    )
    .bind(lead_id)
    .bind(auth.user_id)
    .execute(&mut *tx)
    .await
    {
        return internal(error, "mark submitted");
    }
    if let Err(error) = audit::write_in_transaction(
        &mut tx,
        &audit::domain_event(
            "lead_portal_submit",
            Some(auth.user_id),
            "lead",
            Some(lead_id),
            json!({
                "access_kind": kind.as_str(),
                "filled_fields": data.filled_count(),
                "total_fields": PROGRESS_FIELDS.len(),
                "documents": documents,
                "inquiry_consent_record_id": inquiry_consent_id,
            }),
        ),
    )
    .await
    {
        return internal(error, "audit submit");
    }
    if let Err(error) = tx.commit().await {
        return internal(error, "commit submit");
    }
    notify_lead_staff(
        &state,
        lead_id,
        "lead_portal_submitted",
        "Patient sent the request data",
        &format!(
            "Personal data: {} of {} fields, {} documents.",
            data.filled_count(),
            PROGRESS_FIELDS.len(),
            documents
        ),
    )
    .await;
    crate::realtime::publish_lead_event(
        &state,
        Some(auth.user_id),
        "lead.portal_updated",
        lead_id,
        json!({ "change": "submitted", "access_kind": kind.as_str() }),
    )
    .await;
    match request_payload(&state, lead_id, auth.user_id, kind).await {
        Ok(payload) => Json(payload).into_response(),
        Err(error) => internal(error, "load request"),
    }
}

/// Stores a notification about the lead for its owner and the patient
/// managers (the CEO when there is neither). Like the retention notices it
/// names no person; best effort.
async fn notify_lead_staff(state: &AppState, lead_id: Uuid, kind: &str, title: &str, body: &str) {
    let recipients: Vec<Uuid> = match sqlx::query_scalar(
        r#"WITH owner AS (
               SELECT u.id FROM leads l
               JOIN users u ON u.id = l.created_by
               WHERE l.id = $1 AND u.is_active AND u.role <> 'patient'
           ), managers AS (
               SELECT id FROM users WHERE is_active AND role = 'patient_manager'
           ), fallback AS (
               SELECT id FROM users
               WHERE is_active AND role = 'ceo'
                 AND NOT EXISTS (SELECT 1 FROM owner)
                 AND NOT EXISTS (SELECT 1 FROM managers)
           )
           SELECT id FROM owner
           UNION SELECT id FROM managers
           UNION SELECT id FROM fallback"#,
    )
    .bind(lead_id)
    .fetch_all(&state.db)
    .await
    {
        Ok(ids) => ids,
        Err(error) => {
            tracing::warn!(%error, %lead_id, kind, "load lead portal notification recipients");
            return;
        }
    };
    for recipient in recipients {
        let inserted: Result<Uuid, _> = sqlx::query_scalar(
            r#"INSERT INTO user_notifications (user_id, kind, title, body, entity_type, entity_id)
               VALUES ($1, $2, $3, $4, 'lead', $5)
               RETURNING id"#,
        )
        .bind(recipient)
        .bind(kind)
        .bind(title)
        .bind(body)
        .bind(lead_id)
        .fetch_one(&state.db)
        .await;
        match inserted {
            Ok(notification_id) => {
                crate::realtime::publish_notification_event(
                    state,
                    recipient,
                    "notification.created",
                    Some(notification_id),
                    json!({ "entity_type": "lead", "entity_id": lead_id }),
                )
                .await;
            }
            Err(error) => {
                tracing::warn!(%error, %lead_id, kind, "store lead portal notification");
            }
        }
    }
}

// ----------------------------------------------------------------------------
// Staff endpoints
// ----------------------------------------------------------------------------

/// `GET /leads/{lead_id}/portal-intake`: who fills step 1, which fields came
/// from the patient, progress, consents, uploads and the guardian logins.
/// Upload details only for roles with medical access; Sales sees counts.
async fn get_lead_portal_intake(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(lead_id): Path<Uuid>,
) -> axum::response::Response {
    if let Err(response) = auth.require_capability(Capability::LeadsView) {
        return response;
    }
    let row = match sqlx::query(&format!(
        r#"SELECT {PERSONAL_DATA_COLUMNS}, l.portal_field_updates, l.portal_submitted_at,
                  l.wizard_state->>'step1_fill_mode' AS fill_mode,
                  (SELECT u.role FROM users u WHERE u.id = l.portal_submitted_by) AS submitted_by_role,
                  EXISTS(
                      SELECT 1 FROM lead_portal_access a
                      WHERE a.lead_id = l.id AND a.user_id = l.portal_submitted_by AND a.kind = 'guardian'
                  ) AS submitted_by_guardian
           FROM leads l
           WHERE l.id = $1"#
    ))
    .bind(lead_id)
    .fetch_optional(&state.db)
    .await
    {
        Ok(Some(row)) => row,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Lead not found"),
        Err(error) => return internal(error, "load lead"),
    };
    let data = PersonalData::from_row(&row);
    let updates: Value = row
        .try_get("portal_field_updates")
        .unwrap_or_else(|_| json!({}));
    let uploads = match sqlx::query(
        r#"SELECT u.document_id, u.created_at, u.access_kind, u.reviewed_at,
                  c.granted_at AS consent_given_at, c.revoked_at AS consent_revoked_at,
                  c.context->>'text_version' AS consent_version
           FROM lead_portal_uploads u
           JOIN documents d ON d.id = u.document_id
           LEFT JOIN consent_records c ON c.id = u.consent_record_id
           WHERE u.lead_id = $1 AND u.withdrawn_at IS NULL AND d.file_deleted_at IS NULL
           ORDER BY u.created_at"#,
    )
    .bind(lead_id)
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => rows,
        Err(error) => return internal(error, "load uploads"),
    };
    let consents = match sqlx::query(
        r#"SELECT c.id, c.consent_type, c.granted_at, c.revoked_at,
                  c.context->>'text_version' AS version,
                  c.context->>'access_kind' AS access_kind
           FROM consent_records c
           WHERE c.lead_id = $1 AND c.consent_type = ANY($2) AND c.granted = true
           ORDER BY c.granted_at"#,
    )
    .bind(lead_id)
    .bind(
        ConsentPurpose::ALL
            .iter()
            .map(|purpose| purpose.consent_type())
            .collect::<Vec<_>>(),
    )
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => rows,
        Err(error) => return internal(error, "load consents"),
    };
    let medical = auth.can(Capability::PatientsMedicalView);
    let time = |row: &PgRow, column: &str| {
        row.try_get::<Option<DateTime<Utc>>, _>(column)
            .ok()
            .flatten()
    };
    let upload_items: Vec<Value> = if medical {
        uploads
            .iter()
            .map(|upload| {
                json!({
                    "document_id": upload.try_get::<Uuid, _>("document_id").ok(),
                    "uploaded_at": time(upload, "created_at"),
                    "access_kind": upload.try_get::<String, _>("access_kind").ok(),
                    "reviewed_at": time(upload, "reviewed_at"),
                    "consent_given_at": time(upload, "consent_given_at"),
                    "consent_revoked_at": time(upload, "consent_revoked_at"),
                    "consent_version": upload.try_get::<Option<String>, _>("consent_version").ok().flatten(),
                })
            })
            .collect()
    } else {
        Vec::new()
    };
    let consent_items: Vec<Value> = consents
        .iter()
        .map(|consent| {
            json!({
                "id": consent.try_get::<Uuid, _>("id").ok(),
                "type": consent.try_get::<String, _>("consent_type").ok(),
                "given_at": time(consent, "granted_at"),
                "revoked_at": time(consent, "revoked_at"),
                "version": consent.try_get::<Option<String>, _>("version").ok().flatten(),
                "access_kind": consent.try_get::<Option<String>, _>("access_kind").ok().flatten(),
            })
        })
        .collect();
    let guardians =
        match crate::routes::lead_portal_guardians::guardian_access_summary(&state.db, lead_id)
            .await
        {
            Ok(value) => value,
            Err(error) => return internal(error, "load guardians"),
        };
    let fill_mode = match row
        .try_get::<Option<String>, _>("fill_mode")
        .ok()
        .flatten()
        .as_deref()
    {
        Some("patient") => "patient",
        _ => "staff",
    };
    let submitted_by = if row
        .try_get::<bool, _>("submitted_by_guardian")
        .unwrap_or(false)
    {
        Some("guardian")
    } else {
        row.try_get::<Option<String>, _>("submitted_by_role")
            .ok()
            .flatten()
            .map(|_| "self")
    };
    Json(json!({
        "lead_id": lead_id,
        "fill_mode": fill_mode,
        "patient_fields": patient_field_markers(lead_id, &data, &updates),
        "progress": {
            "filled": data.filled_count(),
            "total": PROGRESS_FIELDS.len(),
            "documents": uploads.len(),
            "submitted_at": time(&row, "portal_submitted_at"),
        },
        "submitted_at": time(&row, "portal_submitted_at"),
        "submitted_by": submitted_by,
        "consents": consent_items,
        "uploads": upload_items,
        "uploads_hidden": !medical,
        "guardians": guardians,
        "minor": crate::routes::leads::is_minor_on(data.date_of_birth, crate::app_time::today()),
        "can_issue": crate::routes::lead_portal_account::may_issue_portal_password(auth.role),
        "can_review_uploads": medical && auth.can(Capability::LeadsEdit),
    }))
    .into_response()
}

#[derive(Deserialize)]
struct FillModeRequest {
    mode: String,
}

/// `POST /leads/{lead_id}/portal-intake/fill-mode`: "I fill it in" / "the
/// patient fills it in" of wizard step 1, kept in `wizard_state`. Merged on
/// the server, so roles without access to the (medical) wizard state can set
/// it too.
async fn set_step1_fill_mode(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(lead_id): Path<Uuid>,
    Json(body): Json<FillModeRequest>,
) -> axum::response::Response {
    if let Err(response) = auth.require_capability(Capability::LeadsEdit) {
        return response;
    }
    let mode = body.mode.trim();
    if mode != "patient" && mode != "staff" {
        return err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Mode must be patient or staff",
        );
    }
    let mut tx = match state.db.begin().await {
        Ok(tx) => tx,
        Err(error) => return internal(error, "begin"),
    };
    let previous: Option<Option<String>> = match sqlx::query_scalar(
        r#"UPDATE leads AS l
           SET wizard_state = jsonb_set(l.wizard_state, '{step1_fill_mode}', to_jsonb($2::text)),
               updated_at = now()
           FROM leads AS before
           WHERE l.id = $1 AND before.id = l.id
             AND l.qualification_status <> 'deleted'
             AND l.converted_patient_id IS NULL
           RETURNING before.wizard_state->>'step1_fill_mode'"#,
    )
    .bind(lead_id)
    .bind(mode)
    .fetch_optional(&mut *tx)
    .await
    {
        Ok(previous) => previous,
        Err(error) => return internal(error, "set fill mode"),
    };
    let Some(previous) = previous else {
        return err(StatusCode::NOT_FOUND, "Lead not found");
    };
    if previous.as_deref() != Some(mode)
        && let Err(error) = audit::write_in_transaction(
            &mut tx,
            &audit::domain_event(
                "set_lead_step1_fill_mode",
                Some(auth.user_id),
                "lead",
                Some(lead_id),
                json!({ "mode": mode, "previous": previous }),
            ),
        )
        .await
    {
        return internal(error, "audit fill mode");
    }
    if let Err(error) = tx.commit().await {
        return internal(error, "commit fill mode");
    }
    Json(json!({ "fill_mode": mode })).into_response()
}

/// `POST /leads/{lead_id}/portal-intake/documents/{document_id}/review`:
/// staff took over a patient upload; the patient can no longer remove it.
async fn review_portal_upload(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path((lead_id, document_id)): Path<(Uuid, Uuid)>,
) -> axum::response::Response {
    if let Err(response) = auth.require_capability(Capability::LeadsEdit) {
        return response;
    }
    if let Err(response) = auth.require_capability(Capability::PatientsMedicalView) {
        return response;
    }
    let mut tx = match state.db.begin().await {
        Ok(tx) => tx,
        Err(error) => return internal(error, "begin"),
    };
    let reviewed: Option<DateTime<Utc>> = match sqlx::query_scalar(
        r#"UPDATE lead_portal_uploads
           SET reviewed_at = COALESCE(reviewed_at, now()),
               reviewed_by = COALESCE(reviewed_by, $3)
           WHERE document_id = $1 AND lead_id = $2 AND withdrawn_at IS NULL
           RETURNING reviewed_at"#,
    )
    .bind(document_id)
    .bind(lead_id)
    .bind(auth.user_id)
    .fetch_optional(&mut *tx)
    .await
    {
        Ok(value) => value,
        Err(error) => return internal(error, "review upload"),
    };
    let Some(reviewed_at) = reviewed else {
        return err(StatusCode::NOT_FOUND, "Patient upload not found");
    };
    if let Err(error) = audit::write_in_transaction(
        &mut tx,
        &audit::domain_event(
            "review_lead_portal_upload",
            Some(auth.user_id),
            "document",
            Some(document_id),
            json!({ "lead_id": lead_id }),
        ),
    )
    .await
    {
        return internal(error, "audit review");
    }
    if let Err(error) = tx.commit().await {
        return internal(error, "commit review");
    }
    crate::realtime::publish_lead_event(
        &state,
        Some(auth.user_id),
        "lead.portal_updated",
        lead_id,
        json!({ "change": "document_reviewed", "document_id": document_id }),
    )
    .await;
    Json(json!({ "document_id": document_id, "reviewed_at": reviewed_at })).into_response()
}

/// Progress of the portal intake for the leads list (`portal_intake` of each
/// row): filled fields, uploads, the time of "send to the manager" and the
/// number of guardian logins. One query for the whole page.
pub(crate) async fn attach_list_progress(db: &gmed_db::DbPool, leads: &mut [Value]) {
    let ids: Vec<Uuid> = leads
        .iter()
        .filter_map(|lead| lead.get("id").and_then(Value::as_str))
        .filter_map(|id| Uuid::parse_str(id).ok())
        .collect();
    if ids.is_empty() {
        return;
    }
    let rows = match sqlx::query(&format!(
        r#"SELECT l.id, {PERSONAL_DATA_COLUMNS}, l.portal_submitted_at,
                  (SELECT count(*) FROM lead_portal_uploads u
                   JOIN documents d ON d.id = u.document_id
                   WHERE u.lead_id = l.id AND u.withdrawn_at IS NULL
                     AND d.file_deleted_at IS NULL) AS documents,
                  (SELECT count(*) FROM lead_portal_access a
                   WHERE a.lead_id = l.id AND a.revoked_at IS NULL) AS guardians
           FROM leads l
           WHERE l.id = ANY($1)"#
    ))
    .bind(&ids)
    .fetch_all(db)
    .await
    {
        Ok(rows) => rows,
        Err(error) => {
            tracing::warn!(%error, "load lead portal progress for the list");
            return;
        }
    };
    let by_id: std::collections::HashMap<Uuid, Value> = rows
        .iter()
        .filter_map(|row| {
            let id = row.try_get::<Uuid, _>("id").ok()?;
            let data = PersonalData::from_row(row);
            Some((
                id,
                json!({
                    "filled": data.filled_count(),
                    "total": PROGRESS_FIELDS.len(),
                    "documents": row.try_get::<i64, _>("documents").unwrap_or(0),
                    "guardians": row.try_get::<i64, _>("guardians").unwrap_or(0),
                    "submitted_at": row
                        .try_get::<Option<DateTime<Utc>>, _>("portal_submitted_at")
                        .ok()
                        .flatten(),
                }),
            ))
        })
        .collect();
    for lead in leads.iter_mut() {
        let Some(id) = lead
            .get("id")
            .and_then(Value::as_str)
            .and_then(|id| Uuid::parse_str(id).ok())
        else {
            continue;
        };
        if let (Some(object), Some(progress)) = (lead.as_object_mut(), by_id.get(&id)) {
            object.insert("portal_intake".into(), progress.clone());
        }
    }
}

/// Clears what the portal intake keeps on the lead itself, in the purge
/// transaction (uploads go with the lead's documents, consents stay as
/// evidence without personal data of their own).
pub(crate) async fn purge_portal_intake_in_tx(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    lead_id: Uuid,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"UPDATE leads
           SET portal_field_updates = '{}'::jsonb,
               portal_submitted_at = NULL,
               portal_submitted_by = NULL
           WHERE id = $1"#,
    )
    .bind(lead_id)
    .execute(&mut **tx)
    .await?;
    sqlx::query("DELETE FROM lead_portal_uploads WHERE lead_id = $1")
        .bind(lead_id)
        .execute(&mut **tx)
        .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn today() -> NaiveDate {
        NaiveDate::from_ymd_opt(2026, 10, 3).unwrap()
    }

    fn anna() -> PersonalData {
        PersonalData {
            first_name: "Anna".into(),
            last_name: "Muster".into(),
            ..Default::default()
        }
    }

    #[test]
    fn patch_changes_only_the_sent_fields() {
        let patch = PersonalDataPatch {
            city: Some("  Berlin ".into()),
            citizenships: Some(vec!["ua".into(), "DE".into(), "UA".into()]),
            ..Default::default()
        };
        let next = apply_personal_data_patch(&anna(), &patch, today()).unwrap();
        assert_eq!(next.city.as_deref(), Some("Berlin"));
        assert_eq!(next.citizenships, vec!["UA".to_string(), "DE".to_string()]);
        assert_eq!(next.first_name, "Anna");
        assert_eq!(changed_fields(&anna(), &next), vec!["citizenships", "city"]);
    }

    #[test]
    fn patch_rejects_invalid_values() {
        let cases: Vec<(PersonalDataPatch, &str)> = vec![
            (
                PersonalDataPatch {
                    first_name: Some("  ".into()),
                    ..Default::default()
                },
                "first_name",
            ),
            (
                PersonalDataPatch {
                    date_of_birth: Some("2027-01-01".into()),
                    ..Default::default()
                },
                "date_of_birth",
            ),
            (
                PersonalDataPatch {
                    date_of_birth: Some("03.10.1990".into()),
                    ..Default::default()
                },
                "date_of_birth",
            ),
            (
                PersonalDataPatch {
                    legal_sex: Some("other".into()),
                    ..Default::default()
                },
                "legal_sex",
            ),
            (
                PersonalDataPatch {
                    citizenships: Some(vec!["Ukraine".into()]),
                    ..Default::default()
                },
                "citizenships",
            ),
            (
                PersonalDataPatch {
                    country: Some("DEU".into()),
                    ..Default::default()
                },
                "country",
            ),
            (
                PersonalDataPatch {
                    phone: Some("call me".into()),
                    ..Default::default()
                },
                "phone",
            ),
        ];
        for (patch, field) in cases {
            assert_eq!(
                apply_personal_data_patch(&anna(), &patch, today())
                    .unwrap_err()
                    .field,
                field
            );
        }
    }

    #[test]
    fn empty_strings_clear_optional_fields() {
        let mut current = anna();
        current.city = Some("Berlin".into());
        current.date_of_birth = NaiveDate::from_ymd_opt(1990, 1, 2);
        let patch = PersonalDataPatch {
            city: Some(String::new()),
            date_of_birth: Some(String::new()),
            ..Default::default()
        };
        let next = apply_personal_data_patch(&current, &patch, today()).unwrap();
        assert_eq!(next.city, None);
        assert_eq!(next.date_of_birth, None);
    }

    #[test]
    fn the_email_cannot_be_patched() {
        let parsed: Result<PersonalDataPatch, _> =
            serde_json::from_value(json!({ "email": "other@example.de" }));
        assert!(parsed.is_err());
    }

    #[test]
    fn progress_counts_the_step_one_fields() {
        let mut data = anna();
        assert_eq!(data.filled_count(), 2);
        assert_eq!(
            data.missing_for_submit(),
            vec![
                "date_of_birth",
                "legal_sex",
                "citizenships",
                "street_address",
                "zip_code",
                "city",
                "country"
            ]
        );
        data.middle_name = Some("Maria".into());
        data.phone = Some("+49 30 1234567".into());
        assert_eq!(data.filled_count(), 3);
    }

    #[test]
    fn markers_follow_the_current_value() {
        let lead_id = Uuid::new_v4();
        let mut data = anna();
        data.city = Some("Berlin".into());
        let updates = json!({
            "city": {
                "at": "2026-10-03T10:00:00Z",
                "kind": "self",
                "hash": value_marker(lead_id, "city", Some("Berlin")),
            },
            "first_name": {
                "at": "2026-10-03T10:00:00Z",
                "kind": "self",
                "hash": value_marker(lead_id, "first_name", Some("Annette")),
            },
        });
        let markers = patient_field_markers(lead_id, &data, &updates);
        assert_eq!(markers["city"]["access_kind"], "self");
        // Staff changed the first name afterwards: no longer from the patient.
        assert!(markers.get("first_name").is_none());
    }

    #[test]
    fn consent_texts_exist_for_both_access_kinds() {
        for kind in [AccessKind::Own, AccessKind::Guardian] {
            for language in CONSENT_LANGUAGES {
                let text = health_consent_text(kind, language).unwrap();
                assert!(text.contains("9"), "{language}");
                assert!(inquiry_consent_text(kind, language).is_some(), "{language}");
            }
            assert!(health_consent_text(kind, "en").is_none());
        }
    }

    #[test]
    fn lead_cabinet_allows_only_request_account_and_legal_paths() {
        for allowed in [
            "/me",
            "/api/v1/me",
            "/me/password",
            "/me/profile",
            "/me/lead-requests",
            "/me/lead-requests/0f4e/documents",
            "/me/totp/setup",
            "/auth/sessions",
            "/legal/privacy",
        ] {
            assert!(lead_portal_allows_path(allowed), "{allowed}");
        }
        for blocked in [
            "/me/documents",
            "/me/appointments",
            "/me/invoices",
            "/me/export",
            "/me/privacy-requests",
            "/me/next-actions",
            "/notifications",
            "/notifications/unread-count",
            "/messages/conversations",
            "/announcements",
            "/me/lead-requestsX",
        ] {
            assert!(!lead_portal_allows_path(blocked), "{blocked}");
        }
    }

    #[test]
    fn consent_purposes_round_trip() {
        for purpose in ConsentPurpose::ALL {
            assert_eq!(ConsentPurpose::parse(purpose.consent_type()), Some(purpose));
        }
        assert_eq!(
            ConsentPurpose::InquiryProcessing.consent_type(),
            "lead_inquiry_processing"
        );
        assert_eq!(ConsentPurpose::parse("dsgvo_data_transfer"), None);
    }
}
