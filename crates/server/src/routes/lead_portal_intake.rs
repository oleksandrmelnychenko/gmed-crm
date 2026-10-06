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
//! process the entered data before "send to the manager" and before a copy of
//! the identity document is uploaded.
//!
//! Since 2026-10-05 (owner spec "Patientenformular (Lead-Link)") the lead also
//! states what the GwG identification sheet needs ([`Identification`], table
//! `lead_gwg_declarations`): place of birth, identity document with a photo or
//! scan of it, the legal questions, and confirms on sending that the
//! information is complete and true. Who acts for the lead — an adult's
//! representative or legal guardian, the parents or the guardian of a minor —
//! is stated on the same page; that part lives in
//! [`crate::routes::lead_representatives`], and its routes are registered here.
//! Where the invoice goes and how the payer will pay (sections 7 and 8, phase
//! 2, 2026-10-06) are patched into the payer declaration
//! ([`crate::routes::lead_payer::save_billing_from_portal`]); who is asked for
//! the payment route depends on who looks at the cabinet
//! ([`payment_route_by`]).
//!
//! A third-party payer answers its own questions through a link of its own
//! (phase 3a, [`crate::routes::lead_payer_link`], which also registers the
//! questionnaire of a paying parent in this cabinet). The payer's files are
//! portal uploads of their own kinds ([`PAYER_UPLOAD_KINDS`], no uploader for
//! the link): the lead's cabinet never lists or counts them.
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
use serde::{Deserialize, Deserializer};
use serde_json::{Map, Value, json};
use sha2::{Digest, Sha256};
use sqlx::Row;
use sqlx::postgres::PgRow;
use uuid::Uuid;

use crate::audit;
use crate::auth::middleware::AuthUser;
use crate::routes::documents::{MAX_FILE_SIZE, NewStoredDocument, persist_document_file};
use crate::routes::lead_payer::{
    self, PaymentRouteBy, PortalBillingError, PortalBillingPatch, PortalPayerError,
    PortalPayerInput,
};
use crate::routes::lead_representatives;
use crate::state::AppState;
use gmed_domain::access::capabilities::Capability;
use gmed_domain::role::Role;

/// Version of the consent texts below. A new wording needs a new version; a
/// consent to an older version does not count any more.
pub(crate) const HEALTH_CONSENT_VERSION: &str = "2026-10-03";
/// Languages of the consent texts: the portal speaks DE and RU, the lead
/// cabinet also UA and EN (owner request 2026-10-04).
const CONSENT_LANGUAGES: [&str; 4] = ["de", "ru", "uk", "en"];
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
    /// 2026-10-03). Required before "send to the manager" and before a copy
    /// of the identity document is uploaded. It does not replace the signed
    /// DSGVO document, which alone stops the 14-day deletion of an
    /// unqualified lead.
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
        (AccessKind::Own, "uk") => {
            "Я погоджуюся, що мої дані обробляються для розгляду мого звернення."
        }
        (AccessKind::Own, "en") => "I agree that my details are processed to handle my request.",
        (AccessKind::Guardian, "uk") => {
            "Я погоджуюся, що мої дані та дані моєї дитини обробляються для розгляду звернення."
        }
        (AccessKind::Guardian, "en") => {
            "I agree that my details and my child's details are processed to handle the request."
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
        (AccessKind::Own, "uk") => {
            "Я даю згоду на те, щоб GMed обробляла дані про моє здоров'я, які я завантажую в цей \
             портал (наприклад, виписки, висновки, знімки та аналізи), щоб розглянути мою заявку й \
             підготувати можливе лікування в Німеччині (ст. 9 п. 2 літ. a DSGVO). Клінікам і лікарям \
             GMed передає ці документи лише після окремої згоди. Згода добровільна. Я можу будь-коли \
             відкликати її в порталі або звернувшись до GMed; відкликання діє на майбутнє і не \
             впливає на законність обробки до нього. Якщо співпраця не відбудеться, заявку та \
             документи буде видалено після закінчення зазначеного строку."
        }
        (AccessKind::Own, "en") => {
            "I consent to GMed processing the health data I upload to this portal (for example \
             doctors' letters, findings, images and lab results) in order to review my request and \
             prepare a possible treatment in Germany (Art. 9(2)(a) GDPR). GMed passes these documents \
             on to clinics and doctors only after a separate consent. The consent is voluntary. I can \
             withdraw it at any time in the portal or by contacting GMed, with effect for the \
             future; the lawfulness of the processing up to then is not affected. If no cooperation \
             comes about, the request and the documents are deleted when the stated deadline has \
             passed."
        }
        (AccessKind::Guardian, "uk") => {
            "Як батько, мати або законний представник я даю згоду на те, щоб GMed обробляла дані про \
             здоров'я моєї дитини, які я завантажую в цей портал (наприклад, виписки, висновки, \
             знімки та аналізи), щоб розглянути заявку й підготувати можливе лікування в Німеччині \
             (ст. 9 п. 2 літ. a DSGVO). Клінікам і лікарям GMed передає ці документи лише після \
             окремої згоди. Згода добровільна. Я можу будь-коли відкликати її в порталі або \
             звернувшись до GMed; відкликання діє на майбутнє і не впливає на законність обробки до \
             нього. Якщо співпраця не відбудеться, заявку та документи буде видалено після закінчення \
             зазначеного строку."
        }
        (AccessKind::Guardian, "en") => {
            "As a parent or legal guardian I consent to GMed processing my child's health data that \
             I upload to this portal (for example doctors' letters, findings, images and lab \
             results) in order to review the request and prepare a possible treatment in Germany \
             (Art. 9(2)(a) GDPR). GMed passes these documents on to clinics and doctors only after a \
             separate consent. The consent is voluntary. I can withdraw it at any time in the portal \
             or by contacting GMed, with effect for the future; the lawfulness of the processing up \
             to then is not affected. If no cooperation comes about, the request and the documents \
             are deleted when the stated deadline has passed."
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
        .route("/me/lead-requests/{lead_id}/payer", post(update_my_payer))
        .route(
            "/me/lead-requests/{lead_id}/billing",
            post(update_my_billing),
        )
        .route(
            "/me/lead-requests/{lead_id}/identification",
            post(update_my_identification),
        )
        .route(
            "/me/lead-requests/{lead_id}/identity-document",
            post(upload_my_identity_document)
                .layer(DefaultBodyLimit::max(MAX_FILE_SIZE + 1024 * 1024)),
        )
        // Who acts for the lead (representation).
        .route(
            "/me/lead-requests/{lead_id}/representation",
            post(lead_representatives::update_my_representation),
        )
        .route(
            "/me/lead-requests/{lead_id}/representatives/{representative_id}",
            post(lead_representatives::upsert_my_representative)
                .delete(lead_representatives::remove_my_representative),
        )
        .route(
            "/me/lead-requests/{lead_id}/representatives/{representative_id}/identity-document",
            post(lead_representatives::upload_my_representative_identity_document)
                .layer(DefaultBodyLimit::max(MAX_FILE_SIZE + 1024 * 1024)),
        )
        .route(
            "/me/lead-requests/{lead_id}/representatives/{representative_id}/authority-document",
            post(lead_representatives::upload_my_representative_authority_document)
                .layer(DefaultBodyLimit::max(MAX_FILE_SIZE + 1024 * 1024)),
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
        // Staff: the custody of a minor, and the row of a representative.
        .route(
            "/leads/{lead_id}/representation",
            post(lead_representatives::set_lead_custody),
        )
        .route(
            "/leads/{lead_id}/representatives/{representative_id}",
            delete(lead_representatives::remove_lead_representative),
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
/// rule) and not converted (a converted lead is a normal patient record). The
/// payer's own link serves the same leads ([`crate::routes::lead_payer_link`]).
pub(crate) const PORTAL_LEAD_SQL: &str = r#"
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
pub(crate) fn require_patient(auth: &AuthUser) -> Result<(), axum::response::Response> {
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
pub(crate) async fn lock_my_lead(
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
     l.primary_language, l.has_insurance, l.insurance_type, l.insurance_provider, \
     l.insurance_number, l.insurance_covers_germany";

/// Fields the patient may edit (API keys = column names). The e-mail is the
/// login and stays with staff. The insurance block is the one of wizard step 1
/// (owner request 2026-10-05).
const EDITABLE_FIELDS: [&str; 17] = [
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
    "has_insurance",
    "insurance_type",
    "insurance_provider",
    "insurance_number",
    "insurance_covers_germany",
];

/// Key of the "who pays" answer in `leads.portal_field_updates`: like a
/// personal data field it says when the patient last changed it.
const PAYER_MARKER: &str = "payer";
/// Key of the answers to sections 7 and 8 (invoice recipient, payment route)
/// in `leads.portal_field_updates`; separate from [`PAYER_MARKER`], so a
/// billing save leaves "who pays — from the patient" as it is.
const BILLING_MARKER: &str = "billing";

/// Fields counted in "N of M filled" (the middle name is optional for everyone;
/// of the insurance block only the answer whether there is one, because the
/// rest depends on it).
pub(crate) const PROGRESS_FIELDS: [&str; 12] = [
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
    "has_insurance",
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
/// Same values as the staff wizard and `patients.insurance_type`.
const INSURANCE_TYPE_VALUES: [&str; 4] = ["private", "public", "foreign", "self_pay"];
const INSURANCE_COVERAGE_VALUES: [&str; 3] = ["yes", "no", "not_sure"];

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
    has_insurance: Option<bool>,
    insurance_type: Option<String>,
    insurance_provider: Option<String>,
    insurance_number: Option<String>,
    insurance_covers_germany: Option<String>,
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
            has_insurance: row
                .try_get::<Option<bool>, _>("has_insurance")
                .ok()
                .flatten(),
            insurance_type: text("insurance_type"),
            insurance_provider: text("insurance_provider"),
            insurance_number: text("insurance_number"),
            insurance_covers_germany: text("insurance_covers_germany"),
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
            "has_insurance" => self
                .has_insurance
                .map(|value| if value { "yes" } else { "no" }.to_string()),
            "insurance_type" => self.insurance_type.clone(),
            "insurance_provider" => self.insurance_provider.clone(),
            "insurance_number" => self.insurance_number.clone(),
            "insurance_covers_germany" => self.insurance_covers_germany.clone(),
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
            "has_insurance": self.has_insurance,
            "insurance_type": self.insurance_type,
            "insurance_provider": self.insurance_provider,
            "insurance_number": self.insurance_number,
            "insurance_covers_germany": self.insurance_covers_germany,
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
    /// "yes", "no" or empty (not stated).
    has_insurance: Option<String>,
    insurance_type: Option<String>,
    insurance_provider: Option<String>,
    insurance_number: Option<String>,
    insurance_covers_germany: Option<String>,
}

#[derive(Debug, PartialEq, Eq)]
pub(crate) struct FieldError {
    /// `invalid_field`, or a code of its own where the cabinet says more
    /// than "invalid" (an expired identity document).
    pub(crate) code: &'static str,
    pub(crate) field: &'static str,
    pub(crate) message: &'static str,
}

pub(crate) fn field_error(field: &'static str, message: &'static str) -> FieldError {
    FieldError {
        code: "invalid_field",
        field,
        message,
    }
}

impl FieldError {
    pub(crate) fn into_response(self) -> axum::response::Response {
        coded(
            StatusCode::UNPROCESSABLE_ENTITY,
            self.code,
            self.message,
            json!({ "field": self.field }),
        )
    }
}

pub(crate) fn clean_text(
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

/// A phone number: at least five digits, with the usual separators only.
pub(crate) fn clean_phone(value: &str, field: &'static str) -> Result<Option<String>, FieldError> {
    let phone = clean_text(value, field, 40)?;
    if let Some(phone) = &phone {
        let digits = phone.chars().filter(char::is_ascii_digit).count();
        if digits < 5
            || !phone
                .chars()
                .all(|ch| ch.is_ascii_digit() || " +-()/.".contains(ch))
        {
            return Err(field_error(field, "Invalid phone number"));
        }
    }
    Ok(phone)
}

/// One of `allowed`, or nothing for an empty value.
pub(crate) fn one_of(
    value: &str,
    field: &'static str,
    allowed: &[&str],
) -> Result<Option<String>, FieldError> {
    let value = value.trim().to_lowercase();
    if value.is_empty() {
        Ok(None)
    } else if allowed.contains(&value.as_str()) {
        Ok(Some(value))
    } else {
        Err(field_error(field, "Invalid value"))
    }
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
        next.phone = clean_phone(value, "phone")?;
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
    if let Some(value) = &patch.has_insurance {
        next.has_insurance = match value.trim().to_lowercase().as_str() {
            "" => None,
            "yes" => Some(true),
            "no" => Some(false),
            _ => return Err(field_error("has_insurance", "Invalid value")),
        };
    }
    if let Some(value) = &patch.insurance_type {
        next.insurance_type = one_of(value, "insurance_type", &INSURANCE_TYPE_VALUES)?;
    }
    if let Some(value) = &patch.insurance_provider {
        next.insurance_provider = clean_text(value, "insurance_provider", 200)?;
    }
    if let Some(value) = &patch.insurance_number {
        next.insurance_number = clean_text(value, "insurance_number", 100)?;
    }
    if let Some(value) = &patch.insurance_covers_germany {
        next.insurance_covers_germany = one_of(
            value,
            "insurance_covers_germany",
            &INSURANCE_COVERAGE_VALUES,
        )?;
    }
    // "No insurance" means self-payer, as in the staff wizard: the details of
    // an insurance cannot stay next to it.
    if next.has_insurance == Some(false) {
        next.insurance_type = Some("self_pay".to_string());
        next.insurance_provider = None;
        next.insurance_number = None;
        next.insurance_covers_germany = None;
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
// Identification: the lead's own GwG statements
// ----------------------------------------------------------------------------

/// Key of the statements in `leads.portal_field_updates`: like a personal data
/// field it says when the patient last changed them.
const IDENTIFICATION_MARKER: &str = "identification";

const SALUTATION_VALUES: [&str; 3] = ["mr", "ms", "none"];
/// In the order of the form; stored in this order.
const CONTACT_CHANNEL_VALUES: [&str; 3] = ["email", "phone", "messenger"];
pub(crate) const ID_DOCUMENT_TYPE_VALUES: [&str; 3] = ["passport", "id_card", "residence_permit"];
/// Longest free text of a statement (details of a "yes", payment background).
const STATEMENT_TEXT_MAX: usize = 2000;

/// The statements the patient edits (API keys = column names of
/// `lead_gwg_declarations`), in form order. `declared_correct_at` is not
/// among them: the server sets it when the request is sent.
const IDENTIFICATION_FIELDS: [&str; 21] = [
    "salutation",
    "former_names",
    "birth_place",
    "birth_country",
    "habitual_residence_country",
    "contact_channels",
    "id_document_type",
    "id_document_number",
    "id_issuing_authority",
    "id_issuing_country",
    "id_issued_on",
    "id_valid_until",
    "pep_self",
    "pep_self_details",
    "pep_related",
    "pep_related_details",
    "high_risk_country",
    "high_risk_country_code",
    "sanctions_links",
    "sanctions_links_details",
    "payment_background",
];

/// What the lead states himself for the GwG identification sheet (owner spec
/// "Patientenformular (Lead-Link)", 2026-10-05): place of birth, identity
/// document, the legal questions and why a third person pays. One row per
/// lead in `lead_gwg_declarations`; nothing entered is the default. Staff read
/// the statements and keep their own AML assessment in the wizard.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub(crate) struct Identification {
    pub(crate) salutation: Option<String>,
    pub(crate) former_names: Option<String>,
    pub(crate) birth_place: Option<String>,
    pub(crate) birth_country: Option<String>,
    pub(crate) habitual_residence_country: Option<String>,
    pub(crate) contact_channels: Vec<String>,
    pub(crate) id_document_type: Option<String>,
    pub(crate) id_document_number: Option<String>,
    pub(crate) id_issuing_authority: Option<String>,
    pub(crate) id_issuing_country: Option<String>,
    pub(crate) id_issued_on: Option<NaiveDate>,
    pub(crate) id_valid_until: Option<NaiveDate>,
    /// The legal questions: `None` until answered. The details belong to a
    /// "yes" only.
    pub(crate) pep_self: Option<bool>,
    pub(crate) pep_self_details: Option<String>,
    pub(crate) pep_related: Option<bool>,
    pub(crate) pep_related_details: Option<String>,
    pub(crate) high_risk_country: Option<bool>,
    pub(crate) high_risk_country_code: Option<String>,
    pub(crate) sanctions_links: Option<bool>,
    pub(crate) sanctions_links_details: Option<String>,
    pub(crate) payment_background: Option<String>,
    /// When the request was last sent with the confirmation that the
    /// statements are complete and true.
    pub(crate) declared_correct_at: Option<DateTime<Utc>>,
}

impl Identification {
    fn from_row(row: &PgRow) -> Self {
        let text =
            |column: &str| non_empty(row.try_get::<Option<String>, _>(column).ok().flatten());
        let date = |column: &str| row.try_get::<Option<NaiveDate>, _>(column).ok().flatten();
        let answer = |column: &str| row.try_get::<Option<bool>, _>(column).ok().flatten();
        Identification {
            salutation: text("salutation"),
            former_names: text("former_names"),
            birth_place: text("birth_place"),
            birth_country: text("birth_country"),
            habitual_residence_country: text("habitual_residence_country"),
            contact_channels: row
                .try_get::<Vec<String>, _>("contact_channels")
                .unwrap_or_default(),
            id_document_type: text("id_document_type"),
            id_document_number: text("id_document_number"),
            id_issuing_authority: text("id_issuing_authority"),
            id_issuing_country: text("id_issuing_country"),
            id_issued_on: date("id_issued_on"),
            id_valid_until: date("id_valid_until"),
            pep_self: answer("pep_self"),
            pep_self_details: text("pep_self_details"),
            pep_related: answer("pep_related"),
            pep_related_details: text("pep_related_details"),
            high_risk_country: answer("high_risk_country"),
            high_risk_country_code: text("high_risk_country_code"),
            sanctions_links: answer("sanctions_links"),
            sanctions_links_details: text("sanctions_links_details"),
            payment_background: text("payment_background"),
            declared_correct_at: row
                .try_get::<Option<DateTime<Utc>>, _>("declared_correct_at")
                .ok()
                .flatten(),
        }
    }

    /// Every key is always present, `null` or empty when nothing was entered.
    pub(crate) fn to_json(&self) -> Value {
        let date = |value: Option<NaiveDate>| value.map(|date| date.format("%Y-%m-%d").to_string());
        json!({
            "salutation": self.salutation,
            "former_names": self.former_names,
            "birth_place": self.birth_place,
            "birth_country": self.birth_country,
            "habitual_residence_country": self.habitual_residence_country,
            "contact_channels": self.contact_channels,
            "id_document_type": self.id_document_type,
            "id_document_number": self.id_document_number,
            "id_issuing_authority": self.id_issuing_authority,
            "id_issuing_country": self.id_issuing_country,
            "id_issued_on": date(self.id_issued_on),
            "id_valid_until": date(self.id_valid_until),
            "pep_self": self.pep_self,
            "pep_self_details": self.pep_self_details,
            "pep_related": self.pep_related,
            "pep_related_details": self.pep_related_details,
            "high_risk_country": self.high_risk_country,
            "high_risk_country_code": self.high_risk_country_code,
            "sanctions_links": self.sanctions_links,
            "sanctions_links_details": self.sanctions_links_details,
            "payment_background": self.payment_background,
            "declared_correct_at": self.declared_correct_at,
        })
    }

    /// Stable text of the statements for the marker in
    /// `leads.portal_field_updates` (the confirmation is not a statement).
    fn marker_value(&self) -> String {
        let statements = self.to_json();
        IDENTIFICATION_FIELDS
            .iter()
            .map(|field| statements[*field].to_string())
            .collect::<Vec<_>>()
            .join("|")
    }

    /// The identity part of what is needed to send the request, in form
    /// order. A document that has expired since it was entered counts as
    /// missing.
    fn missing_identity(&self, today: NaiveDate) -> Vec<&'static str> {
        let mut missing = Vec::new();
        for (field, filled) in [
            ("birth_place", self.birth_place.is_some()),
            ("birth_country", self.birth_country.is_some()),
            ("id_document_type", self.id_document_type.is_some()),
            ("id_document_number", self.id_document_number.is_some()),
            ("id_issuing_authority", self.id_issuing_authority.is_some()),
            ("id_issuing_country", self.id_issuing_country.is_some()),
            (
                "id_valid_until",
                self.id_valid_until.is_some_and(|date| date >= today),
            ),
        ] {
            if !filled {
                missing.push(field);
            }
        }
        missing
    }

    /// The legal questions still open: each needs an answer, and a "yes" its
    /// details (the country for the high-risk question).
    fn missing_legal(&self) -> Vec<&'static str> {
        let mut missing = Vec::new();
        for (question, answer, details, has_details) in [
            (
                "pep_self",
                self.pep_self,
                "pep_self_details",
                self.pep_self_details.is_some(),
            ),
            (
                "pep_related",
                self.pep_related,
                "pep_related_details",
                self.pep_related_details.is_some(),
            ),
            (
                "high_risk_country",
                self.high_risk_country,
                "high_risk_country_code",
                self.high_risk_country_code.is_some(),
            ),
            (
                "sanctions_links",
                self.sanctions_links,
                "sanctions_links_details",
                self.sanctions_links_details.is_some(),
            ),
        ] {
            match answer {
                None => missing.push(question),
                Some(true) if !has_details => missing.push(details),
                Some(_) => {}
            }
        }
        missing
    }
}

/// A key that is present in the body, also with `null` (an absent key stays
/// `None`): the autosave sends only what changed, and `null` clears a value.
fn sent<'de, D, T>(deserializer: D) -> Result<Option<Option<T>>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    Option::<T>::deserialize(deserializer).map(Some)
}

/// Partial update of the statements from the cabinet (only the changed keys).
/// `null` or an empty string clears a text, a date or a choice; a legal
/// answer is `true`, `false` or `null`. Unknown keys — the confirmation
/// `declared_correct_at` above all — are rejected.
#[derive(Debug, Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct IdentificationPatch {
    #[serde(default, deserialize_with = "sent")]
    salutation: Option<Option<String>>,
    #[serde(default, deserialize_with = "sent")]
    former_names: Option<Option<String>>,
    #[serde(default, deserialize_with = "sent")]
    birth_place: Option<Option<String>>,
    #[serde(default, deserialize_with = "sent")]
    birth_country: Option<Option<String>>,
    #[serde(default, deserialize_with = "sent")]
    habitual_residence_country: Option<Option<String>>,
    #[serde(default, deserialize_with = "sent")]
    contact_channels: Option<Option<Vec<String>>>,
    #[serde(default, deserialize_with = "sent")]
    id_document_type: Option<Option<String>>,
    #[serde(default, deserialize_with = "sent")]
    id_document_number: Option<Option<String>>,
    #[serde(default, deserialize_with = "sent")]
    id_issuing_authority: Option<Option<String>>,
    #[serde(default, deserialize_with = "sent")]
    id_issuing_country: Option<Option<String>>,
    #[serde(default, deserialize_with = "sent")]
    id_issued_on: Option<Option<String>>,
    #[serde(default, deserialize_with = "sent")]
    id_valid_until: Option<Option<String>>,
    #[serde(default, deserialize_with = "sent")]
    pep_self: Option<Option<bool>>,
    #[serde(default, deserialize_with = "sent")]
    pep_self_details: Option<Option<String>>,
    #[serde(default, deserialize_with = "sent")]
    pep_related: Option<Option<bool>>,
    #[serde(default, deserialize_with = "sent")]
    pep_related_details: Option<Option<String>>,
    #[serde(default, deserialize_with = "sent")]
    high_risk_country: Option<Option<bool>>,
    #[serde(default, deserialize_with = "sent")]
    high_risk_country_code: Option<Option<String>>,
    #[serde(default, deserialize_with = "sent")]
    sanctions_links: Option<Option<bool>>,
    #[serde(default, deserialize_with = "sent")]
    sanctions_links_details: Option<Option<String>>,
    #[serde(default, deserialize_with = "sent")]
    payment_background: Option<Option<String>>,
}

/// A free text that may run over several lines: only the ends are trimmed.
fn clean_long_text(
    value: &str,
    field: &'static str,
    max_chars: usize,
) -> Result<Option<String>, FieldError> {
    let value = value.replace("\r\n", "\n").replace('\r', "\n");
    let value = value.trim();
    if value.chars().count() > max_chars {
        return Err(field_error(field, "Too long"));
    }
    if value
        .chars()
        .any(|ch| ch.is_control() && ch != '\n' && ch != '\t')
    {
        return Err(field_error(field, "Invalid characters"));
    }
    Ok((!value.is_empty()).then(|| value.to_string()))
}

pub(crate) fn optional_date(
    value: &str,
    field: &'static str,
) -> Result<Option<NaiveDate>, FieldError> {
    match value.trim() {
        "" => Ok(None),
        value => NaiveDate::parse_from_str(value, "%Y-%m-%d")
            .map(Some)
            .map_err(|_| field_error(field, "Use YYYY-MM-DD")),
    }
}

/// Applies `patch` to `current`; the result is what gets stored. A sent
/// expiry date in the past is refused with its own code; the details of a
/// legal question are dropped unless its answer is "yes".
pub(crate) fn apply_identification_patch(
    current: &Identification,
    patch: &IdentificationPatch,
    today: NaiveDate,
) -> Result<Identification, FieldError> {
    // `null` clears like an empty string.
    fn text(value: &Option<String>) -> &str {
        value.as_deref().unwrap_or_default()
    }
    let mut next = current.clone();
    if let Some(value) = &patch.salutation {
        next.salutation = one_of(text(value), "salutation", &SALUTATION_VALUES)?;
    }
    if let Some(value) = &patch.former_names {
        next.former_names = clean_text(text(value), "former_names", 200)?;
    }
    if let Some(value) = &patch.birth_place {
        next.birth_place = clean_text(text(value), "birth_place", 200)?;
    }
    if let Some(value) = &patch.birth_country {
        next.birth_country = country_code(text(value), "birth_country")?;
    }
    if let Some(value) = &patch.habitual_residence_country {
        next.habitual_residence_country = country_code(text(value), "habitual_residence_country")?;
    }
    if let Some(values) = &patch.contact_channels {
        let mut chosen = Vec::new();
        for value in values.iter().flatten() {
            match one_of(value, "contact_channels", &CONTACT_CHANNEL_VALUES)? {
                Some(channel) if !chosen.contains(&channel) => chosen.push(channel),
                _ => {}
            }
        }
        next.contact_channels = CONTACT_CHANNEL_VALUES
            .iter()
            .filter(|channel| chosen.iter().any(|value| value == *channel))
            .map(|channel| channel.to_string())
            .collect();
    }
    if let Some(value) = &patch.id_document_type {
        next.id_document_type = one_of(text(value), "id_document_type", &ID_DOCUMENT_TYPE_VALUES)?;
    }
    if let Some(value) = &patch.id_document_number {
        next.id_document_number = clean_text(text(value), "id_document_number", 60)?;
    }
    if let Some(value) = &patch.id_issuing_authority {
        next.id_issuing_authority = clean_text(text(value), "id_issuing_authority", 200)?;
    }
    if let Some(value) = &patch.id_issuing_country {
        next.id_issuing_country = country_code(text(value), "id_issuing_country")?;
    }
    if let Some(value) = &patch.id_issued_on {
        let issued_on = optional_date(text(value), "id_issued_on")?;
        if issued_on.is_some_and(|date| date > today) {
            return Err(field_error(
                "id_issued_on",
                "Date of issue is in the future",
            ));
        }
        if issued_on.is_some_and(|date| date < NaiveDate::from_ymd_opt(1900, 1, 1).unwrap_or(date))
        {
            return Err(field_error("id_issued_on", "Date of issue is too early"));
        }
        next.id_issued_on = issued_on;
    }
    if let Some(value) = &patch.id_valid_until {
        let valid_until = optional_date(text(value), "id_valid_until")?;
        // The last day of validity still counts.
        if valid_until.is_some_and(|date| date < today) {
            return Err(FieldError {
                code: "id_document_expired",
                field: "id_valid_until",
                message: "The identity document has expired",
            });
        }
        next.id_valid_until = valid_until;
    }
    if let Some(value) = patch.pep_self {
        next.pep_self = value;
    }
    if let Some(value) = &patch.pep_self_details {
        next.pep_self_details =
            clean_long_text(text(value), "pep_self_details", STATEMENT_TEXT_MAX)?;
    }
    if let Some(value) = patch.pep_related {
        next.pep_related = value;
    }
    if let Some(value) = &patch.pep_related_details {
        next.pep_related_details =
            clean_long_text(text(value), "pep_related_details", STATEMENT_TEXT_MAX)?;
    }
    if let Some(value) = patch.high_risk_country {
        next.high_risk_country = value;
    }
    if let Some(value) = &patch.high_risk_country_code {
        next.high_risk_country_code = country_code(text(value), "high_risk_country_code")?;
    }
    if let Some(value) = patch.sanctions_links {
        next.sanctions_links = value;
    }
    if let Some(value) = &patch.sanctions_links_details {
        next.sanctions_links_details =
            clean_long_text(text(value), "sanctions_links_details", STATEMENT_TEXT_MAX)?;
    }
    if let Some(value) = &patch.payment_background {
        next.payment_background =
            clean_long_text(text(value), "payment_background", STATEMENT_TEXT_MAX)?;
    }
    // The details belong to a "yes": with any other answer they go.
    if next.pep_self != Some(true) {
        next.pep_self_details = None;
    }
    if next.pep_related != Some(true) {
        next.pep_related_details = None;
    }
    if next.high_risk_country != Some(true) {
        next.high_risk_country_code = None;
    }
    if next.sanctions_links != Some(true) {
        next.sanctions_links_details = None;
    }
    Ok(next)
}

fn changed_identification_fields(
    before: &Identification,
    after: &Identification,
) -> Vec<&'static str> {
    let (before, after) = (before.to_json(), after.to_json());
    IDENTIFICATION_FIELDS
        .iter()
        .copied()
        .filter(|field| before[*field] != after[*field])
        .collect()
}

/// The statements of a lead and when the lead last changed them; nothing
/// entered while there is no row. A row only staff wrote (the custody of a
/// minor, stated in the wizard before the parent entered anything) has no
/// author and no such time.
pub(crate) async fn load_identification<'e, E>(
    executor: E,
    lead_id: Uuid,
) -> Result<(Identification, Option<DateTime<Utc>>), sqlx::Error>
where
    E: sqlx::Executor<'e, Database = sqlx::Postgres>,
{
    let row = sqlx::query("SELECT * FROM lead_gwg_declarations WHERE lead_id = $1")
        .bind(lead_id)
        .fetch_optional(executor)
        .await?;
    Ok(match row {
        Some(row) => (
            Identification::from_row(&row),
            row.try_get::<Option<Uuid>, _>("updated_by")
                .ok()
                .flatten()
                .and_then(|_| row.try_get::<DateTime<Utc>, _>("updated_at").ok()),
        ),
        None => (Identification::default(), None),
    })
}

/// Writes the statements of a lead (everything but the confirmation, which
/// only "send to the manager" sets).
async fn store_identification(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    lead_id: Uuid,
    statements: &Identification,
    actor: Uuid,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"INSERT INTO lead_gwg_declarations (
               lead_id, salutation, former_names, birth_place, birth_country,
               habitual_residence_country, contact_channels, id_document_type,
               id_document_number, id_issuing_authority, id_issuing_country, id_issued_on,
               id_valid_until, pep_self, pep_self_details, pep_related, pep_related_details,
               high_risk_country, high_risk_country_code, sanctions_links,
               sanctions_links_details, payment_background, updated_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16,
                   $17, $18, $19, $20, $21, $22, $23)
           ON CONFLICT (lead_id) DO UPDATE SET
               salutation = EXCLUDED.salutation,
               former_names = EXCLUDED.former_names,
               birth_place = EXCLUDED.birth_place,
               birth_country = EXCLUDED.birth_country,
               habitual_residence_country = EXCLUDED.habitual_residence_country,
               contact_channels = EXCLUDED.contact_channels,
               id_document_type = EXCLUDED.id_document_type,
               id_document_number = EXCLUDED.id_document_number,
               id_issuing_authority = EXCLUDED.id_issuing_authority,
               id_issuing_country = EXCLUDED.id_issuing_country,
               id_issued_on = EXCLUDED.id_issued_on,
               id_valid_until = EXCLUDED.id_valid_until,
               pep_self = EXCLUDED.pep_self,
               pep_self_details = EXCLUDED.pep_self_details,
               pep_related = EXCLUDED.pep_related,
               pep_related_details = EXCLUDED.pep_related_details,
               high_risk_country = EXCLUDED.high_risk_country,
               high_risk_country_code = EXCLUDED.high_risk_country_code,
               sanctions_links = EXCLUDED.sanctions_links,
               sanctions_links_details = EXCLUDED.sanctions_links_details,
               payment_background = EXCLUDED.payment_background,
               updated_by = EXCLUDED.updated_by,
               updated_at = now()"#,
    )
    .bind(lead_id)
    .bind(&statements.salutation)
    .bind(&statements.former_names)
    .bind(&statements.birth_place)
    .bind(&statements.birth_country)
    .bind(&statements.habitual_residence_country)
    .bind(&statements.contact_channels)
    .bind(&statements.id_document_type)
    .bind(&statements.id_document_number)
    .bind(&statements.id_issuing_authority)
    .bind(&statements.id_issuing_country)
    .bind(statements.id_issued_on)
    .bind(statements.id_valid_until)
    .bind(statements.pep_self)
    .bind(&statements.pep_self_details)
    .bind(statements.pep_related)
    .bind(&statements.pep_related_details)
    .bind(statements.high_risk_country)
    .bind(&statements.high_risk_country_code)
    .bind(statements.sanctions_links)
    .bind(&statements.sanctions_links_details)
    .bind(&statements.payment_background)
    .bind(actor)
    .execute(&mut **tx)
    .await
    .map(|_| ())
}

/// The kinds of portal uploads (`lead_portal_uploads.kind`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum UploadKind {
    /// A medical document of the request, under the Art. 9 consent.
    Medical,
    /// A photo or scan of the lead's own identity document, under the
    /// consent to process the request data. Never medical.
    Identity,
    /// A photo or scan of the identity document of a representative. Never
    /// the lead's own: it is stored under its own document type, so it can
    /// neither be confirmed as the lead's identity document nor tick the
    /// lead's identification sheet.
    RepresentativeIdentity,
    /// The proof that a representative may act: a power of attorney, the
    /// appointment deed of a guardian, a proof of sole custody.
    RepresentativeAuthority,
    /// A copy of the third-party payer's identity document (of an
    /// organisation: of its representative), through the payer's own link
    /// (phase 3a). Never the lead's: not shown in the lead's cabinet, never
    /// the lead's identity document.
    PayerIdentity,
    /// The payer's proof of the source of funds, through the payer's link or
    /// from a paying parent's cabinet section.
    PayerFundsProof,
}

/// `lead_portal_uploads.kind` of the payer's files.
pub(crate) const PAYER_UPLOAD_KINDS: [&str; 2] = ["payer_identity", "payer_funds_proof"];

impl UploadKind {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            UploadKind::Medical => "medical",
            UploadKind::Identity => "identity",
            UploadKind::RepresentativeIdentity => lead_representatives::UPLOAD_IDENTITY,
            UploadKind::RepresentativeAuthority => lead_representatives::UPLOAD_AUTHORITY,
            UploadKind::PayerIdentity => PAYER_UPLOAD_KINDS[0],
            UploadKind::PayerFundsProof => PAYER_UPLOAD_KINDS[1],
        }
    }

    /// The consent of `consent_records` the upload needs first. A file of
    /// the payer needs none of them: the payer's acknowledgement of the
    /// privacy notice on the payer's statement stands for it
    /// ([`crate::routes::lead_payer_link`]).
    fn consent(self) -> Option<ConsentPurpose> {
        match self {
            UploadKind::Medical => Some(ConsentPurpose::HealthData),
            UploadKind::Identity
            | UploadKind::RepresentativeIdentity
            | UploadKind::RepresentativeAuthority => Some(ConsentPurpose::InquiryProcessing),
            UploadKind::PayerIdentity | UploadKind::PayerFundsProof => None,
        }
    }

    /// A file of a representative, linked to that person.
    fn of_representative(self) -> bool {
        matches!(
            self,
            UploadKind::RepresentativeIdentity | UploadKind::RepresentativeAuthority
        )
    }
}

/// Who answers section 8 (the payment route) for the one who looks at the
/// cabinet: the patient — whoever fills the cabinet — while nobody has said
/// who pays or the patient pays himself; the paying parent of a minor
/// ([`lead_representatives::payer_same_person`]) when `caller` is that
/// parent's login; any other third party answers itself and is not asked
/// here. Without a caller (the staff view) the answer says whether the
/// cabinet asks somebody at all: `patient` while the paying parent has a
/// cabinet login, else `payer`.
pub(crate) fn payment_route_by(
    payer: Option<&lead_payer::Declaration>,
    representation: &lead_representatives::Representation,
    caller: Option<Uuid>,
) -> PaymentRouteBy {
    let Some(payer) = payer.filter(|payer| payer.is_third_party()) else {
        return PaymentRouteBy::Patient;
    };
    let parent = lead_representatives::payer_same_person(representation, Some(payer))
        .and_then(|id| representation.find(id));
    match (parent, caller) {
        (Some(parent), Some(caller)) if parent.login_user_ids.contains(&caller) => {
            PaymentRouteBy::Guardian
        }
        (Some(parent), None) if parent.has_login() => PaymentRouteBy::Patient,
        _ => PaymentRouteBy::Payer,
    }
}

/// Everything still missing before the request can be sent, as the keys of
/// `progress.missing_for_submit`: the personal data, who pays, then the
/// statements for the identification in form order. `representation` is what
/// [`lead_representatives::missing_for_submit`] says about who acts for the
/// lead; the form asks it after the identity document. Where the invoice goes
/// and, for whoever is asked, the payment route come after the own-interest
/// question ([`lead_payer::portal_missing_billing`]).
fn missing_for_submit(
    data: &PersonalData,
    payer: Option<&lead_payer::Declaration>,
    identification: &Identification,
    identity_document_uploaded: bool,
    representation: Vec<String>,
    payment_route_by: PaymentRouteBy,
    today: NaiveDate,
) -> Vec<String> {
    let mut missing = data.missing_for_submit();
    missing.extend(
        lead_payer::portal_missing(payer)
            .into_iter()
            // A parent who pays and answers in the own login is the payer:
            // there is nobody else GMED needs the consent to contact (QA
            // 2026-10-06). Staff completeness keeps asking for it.
            .filter(|key| {
                payment_route_by != PaymentRouteBy::Guardian || *key != "payer_contact_consent"
            }),
    );
    missing.extend(identification.missing_identity(today));
    if !identity_document_uploaded {
        missing.push("id_document_upload");
    }
    let mut missing = missing.into_iter().map(str::to_string).collect::<Vec<_>>();
    missing.extend(representation);
    missing.extend(
        lead_payer::portal_missing_own_account(payer)
            .into_iter()
            .chain(lead_payer::portal_missing_billing(payer, payment_route_by))
            .chain(identification.missing_legal())
            .map(str::to_string),
    );
    // Why another person pays is asked with a third-party payer only.
    if payer.is_some_and(lead_payer::Declaration::is_third_party)
        && identification.payment_background.is_none()
    {
        missing.push("payment_background".to_string());
    }
    missing
}

/// Staff took a portal upload over: marked it as reviewed or, for a copy of
/// the identity document, confirmed it as such. From then on the patient can
/// no longer remove it.
pub(crate) fn upload_taken_over(upload: &PgRow) -> bool {
    let time = |column: &str| {
        upload
            .try_get::<Option<DateTime<Utc>>, _>(column)
            .ok()
            .flatten()
    };
    time("reviewed_at").is_some() || time("signed_at").is_some()
}

pub(crate) fn upload_file_name(upload: &PgRow) -> Option<String> {
    upload
        .try_get::<Option<String>, _>("original_filename")
        .ok()
        .flatten()
        .or_else(|| upload.try_get::<String, _>("auto_name").ok())
}

/// Whether the lead has an identity document uploaded through the cabinet.
async fn identity_document_uploaded<'e, E>(executor: E, lead_id: Uuid) -> Result<bool, sqlx::Error>
where
    E: sqlx::Executor<'e, Database = sqlx::Postgres>,
{
    sqlx::query_scalar(
        r#"SELECT EXISTS (
               SELECT 1 FROM lead_portal_uploads u
               JOIN documents d ON d.id = u.document_id
               WHERE u.lead_id = $1 AND u.kind = 'identity'
                 AND u.withdrawn_at IS NULL AND d.file_deleted_at IS NULL
           )"#,
    )
    .bind(lead_id)
    .fetch_one(executor)
    .await
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

/// "I pay (as a parent)": what the form puts into the payer fields when the
/// parent names himself — first and last name, date of birth, e-mail and
/// phone of a trusted contact, and the citizenships and the address the
/// parent entered as a representative (`row`, phase 1b-2; QA 2026-10-06).
/// Never the contact's free-text address or the relation. The name parts are
/// the ones the parent entered as a representative while they still are the
/// contact's name; otherwise the name is split at the last space, and a
/// single word is the last name. Without a row the citizenships are `[]` and
/// the address keys `null`.
fn payer_template_from_contact(
    contact: &Value,
    row: Option<&lead_representatives::Extras>,
) -> Value {
    let text = |key: &str| {
        contact
            .get(key)
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
    };
    let (first_name, last_name) = lead_representatives::name_parts(
        text("name").unwrap_or_default(),
        row.map(|row| row.first_name.as_deref().unwrap_or_default()),
        row.map(|row| row.last_name.as_deref().unwrap_or_default()),
    );
    json!({
        "first_name": first_name,
        "last_name": last_name,
        "date_of_birth": text("birth_date")
            .and_then(|value| NaiveDate::parse_from_str(value, "%Y-%m-%d").ok())
            .map(|date| date.format("%Y-%m-%d").to_string()),
        "email": text("email"),
        "phone": text("phone"),
        "citizenships": row.map(|row| row.citizenships.clone()).unwrap_or_default(),
        "street": row.and_then(|row| row.street.clone()),
        "zip": row.and_then(|row| row.zip.clone()),
        "city": row.and_then(|row| row.city.clone()),
        "country": row.and_then(|row| row.country.clone()),
    })
}

/// The payer template of a parent's login: made from the trusted contact of
/// the lead the login was issued for. `None` when the login is linked to no
/// contact of this lead (any more). Nothing is stored for it.
async fn guardian_payer_template<'e, E>(
    executor: E,
    lead_id: Uuid,
    user_id: Uuid,
    representation: &lead_representatives::Loaded,
) -> Result<Option<Value>, sqlx::Error>
where
    E: sqlx::Executor<'e, Database = sqlx::Postgres>,
{
    let contact: Option<Value> = sqlx::query_scalar(
        r#"SELECT contact.entry
           FROM lead_portal_access a
           JOIN leads l ON l.id = a.lead_id
           CROSS JOIN LATERAL jsonb_array_elements(
               CASE WHEN jsonb_typeof(l.trusted_contacts) = 'array'
                    THEN l.trusted_contacts ELSE '[]'::jsonb END
           ) AS contact(entry)
           WHERE a.lead_id = $1
             AND a.user_id = $2
             AND a.kind = 'guardian'
             AND a.revoked_at IS NULL
             AND lower(contact.entry->>'id') = a.trusted_contact_id::text
           ORDER BY a.created_at DESC
           LIMIT 1"#,
    )
    .bind(lead_id)
    .bind(user_id)
    .fetch_optional(executor)
    .await?;
    Ok(contact.as_ref().map(|contact| {
        let row = lead_representatives::entry_id(contact)
            .and_then(|contact_id| representation.row_of(contact_id));
        payer_template_from_contact(contact, row)
    }))
}

/// The request page of one lead for the portal.
pub(crate) async fn request_payload(
    state: &AppState,
    lead_id: Uuid,
    user_id: Uuid,
    kind: AccessKind,
) -> Result<Value, sqlx::Error> {
    let row = sqlx::query(&format!(
        r#"SELECT {PERSONAL_DATA_COLUMNS}, l.created_at, l.qualification_status,
                  l.compliance_status, l.portal_submitted_at,
                  -- The patient changed the data or the documents after
                  -- sending: only then "send again" makes sense.
                  l.portal_submitted_at IS NOT NULL AND (
                      EXISTS (
                          SELECT 1
                          FROM jsonb_each(
                              CASE WHEN jsonb_typeof(l.portal_field_updates) = 'object'
                                   THEN l.portal_field_updates ELSE '{{}}'::jsonb END
                          ) AS field(name, entry)
                          WHERE (field.entry->>'at')::timestamptz > l.portal_submitted_at
                      )
                      OR EXISTS (
                          SELECT 1 FROM lead_portal_uploads pu
                          WHERE pu.lead_id = l.id
                            -- The payer's files are not part of the request.
                            AND pu.kind NOT IN ('payer_identity', 'payer_funds_proof')
                            AND (pu.created_at > l.portal_submitted_at
                                 OR pu.withdrawn_at > l.portal_submitted_at)
                      )
                  ) AS changed_since_submit
           FROM leads l
           WHERE l.id = $1"#
    ))
    .bind(lead_id)
    .fetch_one(&state.db)
    .await?;
    let data = PersonalData::from_row(&row);
    // Who pays, who acts for the lead, and whether the payer answered
    // through its own link.
    let (payer, representation, answered_by_payer) = {
        let mut conn = state.db.acquire().await?;
        let payer = lead_payer::load_declaration(&mut conn, lead_id).await?;
        let answered_by_payer =
            crate::routes::lead_payer_link::answered_by_payer(&mut conn, lead_id, payer.as_ref())
                .await?;
        (
            payer,
            lead_representatives::load(&mut conn, lead_id)
                .await?
                .unwrap_or_default(),
            answered_by_payer,
        )
    };
    let (identification, _) = load_identification(&state.db, lead_id).await?;
    let payer_self_template = match kind {
        AccessKind::Guardian => {
            guardian_payer_template(&state.db, lead_id, user_id, &representation).await?
        }
        AccessKind::Own => None,
    };
    let uploads = sqlx::query(
        r#"SELECT u.document_id, u.kind, u.created_at, u.reviewed_at, u.uploaded_by,
                  d.original_filename, d.auto_name, d.file_size, d.mime_type, d.patient_id,
                  d.signed_at
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
    // Medical documents and copies of the identity document are two lists.
    let uploads_of = |kind: UploadKind| -> Vec<Value> {
        uploads
            .iter()
            .filter(|upload| {
                upload.try_get::<String, _>("kind").ok().as_deref() == Some(kind.as_str())
            })
            .map(|upload| {
                // Staff took the file over: marked as reviewed, or confirmed
                // as the identity document.
                let reviewed = upload_taken_over(upload);
                // A file of the payer's link has no uploader.
                let mine = upload
                    .try_get::<Option<Uuid>, _>("uploaded_by")
                    .ok()
                    .flatten()
                    == Some(user_id);
                let moved = upload
                    .try_get::<Option<Uuid>, _>("patient_id")
                    .ok()
                    .flatten()
                    .is_some();
                json!({
                    "id": upload.try_get::<Uuid, _>("document_id").ok(),
                    "file_name": upload_file_name(upload),
                    "size_bytes": upload.try_get::<Option<i64>, _>("file_size").ok().flatten(),
                    "mime_type": upload.try_get::<Option<String>, _>("mime_type").ok().flatten(),
                    "uploaded_at": upload.try_get::<DateTime<Utc>, _>("created_at").ok(),
                    "uploaded_by_me": mine,
                    "reviewed": reviewed,
                    "can_delete": mine && !reviewed && !moved,
                })
            })
            .collect()
    };
    // The files of a representative are listed with that person, never here.
    let documents = uploads_of(UploadKind::Medical);
    let identity_documents = uploads_of(UploadKind::Identity);
    let today = crate::app_time::today();
    // Who is asked for the payment route, and whose name the account holder
    // is pre-filled with: the lead's, or the paying parent's.
    let route_by = payment_route_by(
        payer.as_ref(),
        &representation.representation,
        Some(user_id),
    );
    let account_holder_suggestion = match route_by {
        PaymentRouteBy::Patient => Some(
            [data.first_name.trim(), data.last_name.trim()]
                .into_iter()
                .filter(|part| !part.is_empty())
                .collect::<Vec<_>>()
                .join(" "),
        )
        .filter(|name| !name.is_empty()),
        PaymentRouteBy::Guardian => representation
            .representation
            .representatives
            .iter()
            .find(|person| person.login_user_ids.contains(&user_id))
            .map(lead_representatives::Representative::name)
            .filter(|name| !name.is_empty()),
        PaymentRouteBy::Payer => None,
    };
    let missing = missing_for_submit(
        &data,
        payer.as_ref(),
        &identification,
        !identity_documents.is_empty(),
        lead_representatives::missing_for_submit(&representation, today),
        route_by,
        today,
    );
    // A paying parent answers the payer's questions in the own cabinet
    // (phase 3a); nobody else sees anything of the payer's answers or link.
    let payer_questionnaire = if route_by == PaymentRouteBy::Guardian {
        crate::routes::lead_payer_link::cabinet_summary(state, lead_id, user_id).await?
    } else {
        Value::Null
    };
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
            "missing_for_submit": missing,
        },
        "payer": lead_payer::portal_payload(payer.as_ref(), answered_by_payer),
        "payer_self_template": payer_self_template,
        "billing": lead_payer::portal_billing_payload(
            payer.as_ref(),
            route_by,
            account_holder_suggestion.as_deref(),
        ),
        "payer_questionnaire": payer_questionnaire,
        "identification": identification.to_json(),
        "minor": crate::routes::leads::is_minor_on(data.date_of_birth, today),
        "representation": lead_representatives::portal_payload(&representation, user_id),
        "documents": documents,
        "identity_documents": identity_documents,
        "max_documents": MAX_PORTAL_UPLOADS,
        "consents": consents,
        "submitted_at": row
            .try_get::<Option<DateTime<Utc>>, _>("portal_submitted_at")
            .ok()
            .flatten(),
        "changed_since_submit": row
            .try_get::<bool, _>("changed_since_submit")
            .unwrap_or(false),
        "retention_deadline_at": deadline,
    }))
}

// ----------------------------------------------------------------------------
// Patient endpoints
// ----------------------------------------------------------------------------

pub(crate) fn err(status: StatusCode, message: &str) -> axum::response::Response {
    (
        status,
        Json(json!({
            "error": status.canonical_reason().unwrap_or("error"),
            "message": message,
        })),
    )
        .into_response()
}

pub(crate) fn coded(
    status: StatusCode,
    code: &str,
    message: &str,
    extra: Value,
) -> axum::response::Response {
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

pub(crate) fn internal(error: impl std::fmt::Display, what: &str) -> axum::response::Response {
    tracing::error!(%error, what, "lead portal intake");
    err(StatusCode::INTERNAL_SERVER_ERROR, "Failed")
}

pub(crate) fn not_found() -> axum::response::Response {
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
        Err(error) => return error.into_response(),
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
               has_insurance = $16,
               insurance_type = $17,
               insurance_provider = $18,
               insurance_number = $19,
               insurance_covers_germany = $20,
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
    .bind(next.has_insurance)
    .bind(&next.insurance_type)
    .bind(&next.insurance_provider)
    .bind(&next.insurance_number)
    .bind(&next.insurance_covers_germany)
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

/// `POST /me/lead-requests/{lead_id}/payer`: who pays, and for a third party
/// who that is (a person or an organisation), how the payer is related to the
/// patient and whether GMED may contact the payer. The answer is part of the
/// lead's payer declaration, so the sanctions screening and the country
/// policy pick the payer up from there.
async fn update_my_payer(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(lead_id): Path<Uuid>,
    Json(input): Json<PortalPayerInput>,
) -> axum::response::Response {
    if let Err(response) = require_patient(&auth) {
        return response;
    }
    let mut tx = match state.db.begin().await {
        Ok(tx) => tx,
        Err(error) => return internal(error, "begin"),
    };
    let (kind, _) = match lock_my_lead(&mut tx, lead_id, auth.user_id).await {
        Ok(Some(found)) => found,
        Ok(None) => return not_found(),
        Err(error) => return internal(error, "lock request"),
    };
    // The payer answered through its own link: its identity is its own
    // statement now. The lead asks GMED to change the payer; staff can.
    let declared = match lead_payer::load_declaration(&mut tx, lead_id).await {
        Ok(declared) => declared,
        Err(error) => return internal(error, "load payer"),
    };
    match crate::routes::lead_payer_link::answered_by_payer(&mut tx, lead_id, declared.as_ref())
        .await
    {
        Ok(false) => {}
        Ok(true) => {
            return coded(
                StatusCode::CONFLICT,
                "payer_answered_by_payer",
                "The payer has answered through its own link; GMED changes the payer",
                json!({}),
            );
        }
        Err(error) => return internal(error, "load payer"),
    }
    let saved = match lead_payer::save_from_portal(
        &mut tx,
        lead_id,
        auth.user_id,
        kind.as_str(),
        &input,
        crate::app_time::today(),
    )
    .await
    {
        Ok(saved) => saved,
        Err(PortalPayerError::Invalid { code, field }) => {
            return coded(
                StatusCode::UNPROCESSABLE_ENTITY,
                code,
                "Invalid payer data",
                json!({ "field": field }),
            );
        }
        Err(PortalPayerError::Database(error)) => return internal(error, "save payer"),
    };
    let Some(declaration) = saved else {
        drop(tx);
        return match request_payload(&state, lead_id, auth.user_id, kind).await {
            Ok(payload) => Json(payload).into_response(),
            Err(error) => internal(error, "load request"),
        };
    };
    let marker = json!({
        PAYER_MARKER: {
            "at": Utc::now(),
            "by": auth.user_id,
            "kind": kind.as_str(),
            "hash": value_marker(
                lead_id,
                PAYER_MARKER,
                Some(&lead_payer::portal_marker_value(&declaration)),
            ),
        }
    });
    if let Err(error) = sqlx::query(
        r#"UPDATE leads
           SET portal_field_updates = portal_field_updates || $2::jsonb, updated_at = now()
           WHERE id = $1"#,
    )
    .bind(lead_id)
    .bind(marker)
    .execute(&mut *tx)
    .await
    {
        return internal(error, "mark payer");
    }
    if let Err(error) = tx.commit().await {
        return internal(error, "commit payer");
    }
    crate::realtime::publish_lead_event(
        &state,
        Some(auth.user_id),
        "lead.portal_updated",
        lead_id,
        json!({ "change": "payer", "access_kind": kind.as_str() }),
    )
    .await;
    match request_payload(&state, lead_id, auth.user_id, kind).await {
        Ok(payload) => Json(payload).into_response(),
        Err(error) => internal(error, "load request"),
    }
}

/// `POST /me/lead-requests/{lead_id}/billing`: autosave of where the invoice
/// goes (section 7) and how the payer will pay (section 8), only the changed
/// keys. Both land in the payer declaration; the payer of the lead's orders
/// (the Kostenübernehmer) is not touched. A key of section 8 from a login
/// that is not asked for it — the third party answers itself — is refused
/// as a whole (409 `payment_route_by_payer`); without an answer who pays
/// there is nothing to patch (409 `payer_not_declared`). The audit event
/// names the changed fields, never their values.
async fn update_my_billing(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(lead_id): Path<Uuid>,
    Json(body): Json<Value>,
) -> axum::response::Response {
    if let Err(response) = require_patient(&auth) {
        return response;
    }
    let invalid = |field: &str, message: &str| {
        coded(
            StatusCode::UNPROCESSABLE_ENTITY,
            "invalid_field",
            message,
            json!({ "field": field }),
        )
    };
    let patch = match PortalBillingPatch::parse(&body) {
        Ok(patch) => patch,
        Err(PortalBillingError::Invalid { field, message }) => return invalid(&field, message),
        Err(_) => return invalid("body", "The body could not be read"),
    };
    let mut tx = match state.db.begin().await {
        Ok(tx) => tx,
        Err(error) => return internal(error, "begin"),
    };
    let (kind, _) = match lock_my_lead(&mut tx, lead_id, auth.user_id).await {
        Ok(Some(found)) => found,
        Ok(None) => return not_found(),
        Err(error) => return internal(error, "lock request"),
    };
    // Who is asked for the payment route, judged on the stored payer.
    let payer = match lead_payer::load_declaration(&mut tx, lead_id).await {
        Ok(payer) => payer,
        Err(error) => return internal(error, "load payer"),
    };
    let representation = match lead_representatives::load(&mut tx, lead_id).await {
        Ok(representation) => representation.unwrap_or_default(),
        Err(error) => return internal(error, "load representation"),
    };
    let route_by = payment_route_by(
        payer.as_ref(),
        &representation.representation,
        Some(auth.user_id),
    );
    let saved = match lead_payer::save_billing_from_portal(
        &mut tx,
        lead_id,
        auth.user_id,
        kind.as_str(),
        &patch,
        route_by,
    )
    .await
    {
        Ok(saved) => saved,
        Err(PortalBillingError::Invalid { field, message }) => return invalid(&field, message),
        Err(PortalBillingError::RouteByPayer) => {
            return coded(
                StatusCode::CONFLICT,
                "payment_route_by_payer",
                "The payer states the payment route; the cabinet does not ask for it",
                json!({}),
            );
        }
        Err(PortalBillingError::NotDeclared) => {
            return coded(
                StatusCode::CONFLICT,
                "payer_not_declared",
                "Please answer who pays first",
                json!({}),
            );
        }
        Err(PortalBillingError::Database(error)) => return internal(error, "save billing"),
    };
    let Some(declaration) = saved else {
        drop(tx);
        return match request_payload(&state, lead_id, auth.user_id, kind).await {
            Ok(payload) => Json(payload).into_response(),
            Err(error) => internal(error, "load request"),
        };
    };
    let marker = json!({
        BILLING_MARKER: {
            "at": Utc::now(),
            "by": auth.user_id,
            "kind": kind.as_str(),
            "hash": value_marker(
                lead_id,
                BILLING_MARKER,
                Some(&declaration.billing_marker_value()),
            ),
        }
    });
    if let Err(error) = sqlx::query(
        r#"UPDATE leads
           SET portal_field_updates = portal_field_updates || $2::jsonb, updated_at = now()
           WHERE id = $1"#,
    )
    .bind(lead_id)
    .bind(marker)
    .execute(&mut *tx)
    .await
    {
        return internal(error, "mark billing");
    }
    if let Err(error) = tx.commit().await {
        return internal(error, "commit billing");
    }
    crate::realtime::publish_lead_event(
        &state,
        Some(auth.user_id),
        "lead.portal_updated",
        lead_id,
        json!({ "change": BILLING_MARKER, "access_kind": kind.as_str() }),
    )
    .await;
    match request_payload(&state, lead_id, auth.user_id, kind).await {
        Ok(payload) => Json(payload).into_response(),
        Err(error) => internal(error, "load request"),
    }
}

/// `POST /me/lead-requests/{lead_id}/identification`: autosave of the lead's
/// own statements for the GwG identification sheet (only the changed keys).
/// The audit event names the changed fields, never their values.
async fn update_my_identification(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(lead_id): Path<Uuid>,
    Json(patch): Json<IdentificationPatch>,
) -> axum::response::Response {
    if let Err(response) = require_patient(&auth) {
        return response;
    }
    let mut tx = match state.db.begin().await {
        Ok(tx) => tx,
        Err(error) => return internal(error, "begin"),
    };
    let (kind, _) = match lock_my_lead(&mut tx, lead_id, auth.user_id).await {
        Ok(Some(found)) => found,
        Ok(None) => return not_found(),
        Err(error) => return internal(error, "lock request"),
    };
    let current = match load_identification(&mut *tx, lead_id).await {
        Ok((current, _)) => current,
        Err(error) => return internal(error, "load identification"),
    };
    let next = match apply_identification_patch(&current, &patch, crate::app_time::today()) {
        Ok(next) => next,
        Err(error) => return error.into_response(),
    };
    let changed = changed_identification_fields(&current, &next);
    if changed.is_empty() {
        drop(tx);
        return match request_payload(&state, lead_id, auth.user_id, kind).await {
            Ok(payload) => Json(payload).into_response(),
            Err(error) => internal(error, "load request"),
        };
    }
    if let Err(error) = store_identification(&mut tx, lead_id, &next, auth.user_id).await {
        return internal(error, "store identification");
    }
    let marker = json!({
        IDENTIFICATION_MARKER: {
            "at": Utc::now(),
            "by": auth.user_id,
            "kind": kind.as_str(),
            "hash": value_marker(lead_id, IDENTIFICATION_MARKER, Some(&next.marker_value())),
        }
    });
    if let Err(error) = sqlx::query(
        r#"UPDATE leads
           SET portal_field_updates = portal_field_updates || $2::jsonb, updated_at = now()
           WHERE id = $1"#,
    )
    .bind(lead_id)
    .bind(marker)
    .execute(&mut *tx)
    .await
    {
        return internal(error, "mark identification");
    }
    if let Err(error) = audit::write_in_transaction(
        &mut tx,
        &audit::domain_event(
            "lead_portal_update_identification",
            Some(auth.user_id),
            "lead",
            Some(lead_id),
            json!({ "fields": changed, "access_kind": kind.as_str() }),
        ),
    )
    .await
    {
        return internal(error, "audit identification");
    }
    if let Err(error) = tx.commit().await {
        return internal(error, "commit identification");
    }
    crate::realtime::publish_lead_event(
        &state,
        Some(auth.user_id),
        "lead.portal_updated",
        lead_id,
        json!({ "change": "identification", "access_kind": kind.as_str() }),
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
    multipart: Multipart,
) -> axum::response::Response {
    store_my_upload(state, auth, lead_id, multipart, UploadKind::Medical, None).await
}

/// `POST /me/lead-requests/{lead_id}/identity-document` (multipart `file`): a
/// photo or scan of the identity document (PDF, JPG or PNG). Not medical: it
/// needs the consent to process the request data, and staff confirm it in
/// place like an identity document they uploaded themselves.
async fn upload_my_identity_document(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(lead_id): Path<Uuid>,
    multipart: Multipart,
) -> axum::response::Response {
    store_my_upload(state, auth, lead_id, multipart, UploadKind::Identity, None).await
}

/// File types of a copy of an identity document or of a proof of authority
/// (and of the payer's files, phase 3a).
pub(crate) const IDENTITY_DOCUMENT_MIME_TYPES: [&str; 3] =
    ["application/pdf", "image/jpeg", "image/png"];

/// Reads the multipart field `file` of an upload: the name as sent (at most
/// 200 characters), the declared type and the bytes. Over 25 MB, unreadable
/// or empty is refused. Shared with the payer's own link.
pub(crate) async fn read_upload_file(
    multipart: &mut Multipart,
) -> Result<(String, Option<String>, Vec<u8>), axum::response::Response> {
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
                return Err(err(
                    StatusCode::PAYLOAD_TOO_LARGE,
                    "File too large (max 25MB)",
                ));
            }
            Ok(bytes) => file = Some((file_name, content_type, bytes.to_vec())),
            Err(error) => {
                tracing::warn!(%error, "read lead portal upload");
                return Err(err(StatusCode::BAD_REQUEST, "Failed to read uploaded file"));
            }
        }
    }
    file.filter(|(_, _, data)| !data.is_empty())
        .ok_or_else(|| err(StatusCode::BAD_REQUEST, "No file uploaded"))
}

/// Stores an upload of the caller's request as a document of the lead and
/// registers it in `lead_portal_uploads` with the consent it was made under.
/// Every kind counts toward the upload limit of the request. A file of a
/// representative names that person (`representative_id`): the person must be
/// a representative of the lead, otherwise 404.
pub(crate) async fn store_my_upload(
    state: AppState,
    auth: AuthUser,
    lead_id: Uuid,
    mut multipart: Multipart,
    upload_kind: UploadKind,
    representative_id: Option<Uuid>,
) -> axum::response::Response {
    if let Err(response) = require_patient(&auth) {
        return response;
    }
    let kind = match my_lead_access(&state, lead_id, auth.user_id).await {
        Ok(Some(kind)) => kind,
        Ok(None) => return not_found(),
        Err(error) => return internal(error, "resolve request"),
    };
    // Whose file it is; the document is named after the person.
    let representative = match (upload_kind.of_representative(), representative_id) {
        (false, _) => None,
        (true, Some(representative_id)) => {
            match lead_representatives::upload_target(&state, lead_id, representative_id).await {
                Ok(Some(name)) => Some((representative_id, name)),
                Ok(None) => return err(StatusCode::NOT_FOUND, "Representative not found"),
                Err(error) => return internal(error, "resolve representative"),
            }
        }
        (true, None) => return err(StatusCode::NOT_FOUND, "Representative not found"),
    };
    // The payer's files come through the payer's link or the paying parent's
    // section (`lead_payer_link`), never through here.
    let Some(consent_purpose) = upload_kind.consent() else {
        return not_found();
    };
    match active_consent(&state.db, lead_id, auth.user_id, consent_purpose).await {
        Ok(Some(_)) => {}
        Ok(None) => {
            return match consent_purpose {
                ConsentPurpose::HealthData => coded(
                    StatusCode::FORBIDDEN,
                    "health_consent_required",
                    "Consent to the processing of health data is required before uploading",
                    json!({ "version": HEALTH_CONSENT_VERSION }),
                ),
                ConsentPurpose::InquiryProcessing => coded(
                    StatusCode::FORBIDDEN,
                    "inquiry_consent_required",
                    "Please agree to the processing of your data for the request first",
                    json!({
                        "purpose": ConsentPurpose::InquiryProcessing.consent_type(),
                        "version": ConsentPurpose::InquiryProcessing.version(),
                    }),
                ),
            };
        }
        Err(error) => return internal(error, "load consent"),
    }

    let (file_name, content_type, data) = match read_upload_file(&mut multipart).await {
        Ok(file) => file,
        Err(response) => return response,
    };

    // The payer's files have a limit of their own and are not the lead's.
    let active_uploads: i64 = match sqlx::query_scalar(
        r#"SELECT count(*) FROM lead_portal_uploads u
           JOIN documents d ON d.id = u.document_id
           WHERE u.lead_id = $1 AND u.withdrawn_at IS NULL AND d.file_deleted_at IS NULL
             AND u.kind NOT IN ('payer_identity', 'payer_funds_proof')"#,
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
    let medical = upload_kind == UploadKind::Medical;
    if !medical && !IDENTITY_DOCUMENT_MIME_TYPES.contains(&mime_type.as_str()) {
        return coded(
            StatusCode::UNPROCESSABLE_ENTITY,
            "unsupported_file_type",
            "Upload the identity document as PDF, JPG or PNG",
            json!({}),
        );
    }
    let person = representative
        .as_ref()
        .map(|(_, name)| name.as_str())
        .unwrap_or_default();
    // A copy of the lead's identity document is stored like the one staff
    // upload in the wizard (`identity`), so the identity check finds it. The
    // files of a representative have a document type of their own: they are
    // never the lead's identity document.
    let (auto_name, art, category, access_category) = match upload_kind {
        UploadKind::Medical => (
            file_name.clone(),
            "patient_medical_upload",
            "medical",
            "medical",
        ),
        UploadKind::Identity => (
            "Identity document".to_string(),
            "identity",
            "identity",
            "internal",
        ),
        UploadKind::RepresentativeIdentity => (
            format!("Identity document – {person}"),
            lead_representatives::UPLOAD_IDENTITY,
            "identity",
            "internal",
        ),
        UploadKind::RepresentativeAuthority => (
            format!("Proof of authority – {person}"),
            lead_representatives::UPLOAD_AUTHORITY,
            "administrative",
            "internal",
        ),
        UploadKind::PayerIdentity | UploadKind::PayerFundsProof => return not_found(),
    };
    let auto_name = auto_name.as_str();
    let input = NewStoredDocument {
        document_id: None,
        document_number: None,
        patient_id: None,
        lead_id: Some(lead_id),
        order_id: None,
        appointment_id: None,
        auto_name,
        original_filename: &file_name,
        art,
        category: Some(category),
        status: "active",
        visibility: "internal",
        is_medical: medical,
        mime_type: &mime_type,
        klinik: None,
        ursprung: Some("lead_portal"),
        notes: None,
        document_direction: Some("incoming"),
        document_variant: Some("original"),
        document_language: None,
        access_category: Some(access_category),
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
            active_consent(&mut *tx, lead_id, auth.user_id, consent_purpose).await?
        else {
            return Ok(None);
        };
        // The person may have been removed meanwhile; a parent staff entered
        // gets the row the file is linked to.
        if let Some((representative_id, _)) = &representative
            && !lead_representatives::ensure_row_for_upload(
                &mut tx,
                lead_id,
                *representative_id,
                auth.user_id,
            )
            .await?
        {
            return Ok(None);
        }
        sqlx::query(
            r#"INSERT INTO lead_portal_uploads
                   (document_id, lead_id, uploaded_by, access_kind, consent_record_id, kind,
                    representative_id)
               VALUES ($1, $2, $3, $4, $5, $6, $7)"#,
        )
        .bind(document_id)
        .bind(lead_id)
        .bind(auth.user_id)
        .bind(kind.as_str())
        .bind(consent_id)
        .bind(upload_kind.as_str())
        .bind(representative.as_ref().map(|(id, _)| *id))
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
                    "is_medical": medical,
                    "kind": upload_kind.as_str(),
                    "representative_id": representative.as_ref().map(|(id, _)| *id),
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
        json!({
            "change": "document_uploaded",
            "document_id": document_id,
            "access_kind": kind.as_str(),
            "kind": upload_kind.as_str(),
        }),
    )
    .await;
    // What staff see of the lead's representation changed with the file.
    if upload_kind.of_representative() {
        lead_representatives::publish_cabinet_change(&state, lead_id, auth.user_id, kind).await;
    }
    match request_payload(&state, lead_id, auth.user_id, kind).await {
        Ok(payload) => (StatusCode::CREATED, Json(payload)).into_response(),
        Err(error) => internal(error, "load request"),
    }
}

/// Removes a stored document that could not be registered as a portal upload.
pub(crate) async fn discard_stored_document(
    state: &AppState,
    document_id: Uuid,
    storage_key: &str,
) {
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
/// removes an upload — a medical document, a copy of the identity document or
/// a file of a representative — that staff have not taken over yet.
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
        r#"SELECT u.uploaded_by, u.reviewed_at, u.kind, d.storage_key, d.patient_id, d.lead_id,
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
    // A file of the payer's link has no uploader: nobody of the cabinet
    // removes it. A paying parent's own proof of funds goes only while the
    // parent has not sent the payer's answers.
    if upload
        .try_get::<Option<Uuid>, _>("uploaded_by")
        .ok()
        .flatten()
        != Some(auth.user_id)
    {
        return err(
            StatusCode::FORBIDDEN,
            "Only the person who uploaded the document can remove it",
        );
    }
    let upload_kind: String = upload.try_get("kind").unwrap_or_default();
    let of_payer = PAYER_UPLOAD_KINDS.contains(&upload_kind.as_str());
    if of_payer {
        match crate::routes::lead_payer_link::payer_submitted_at(&mut tx, lead_id).await {
            Ok(None) => {}
            Ok(Some(_)) => {
                return coded(
                    StatusCode::CONFLICT,
                    "payer_submitted",
                    "The payer's answers are sent; ask GMED to change them",
                    json!({}),
                );
            }
            Err(error) => return internal(error, "load payer statement"),
        }
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
    let of_representative = [
        lead_representatives::UPLOAD_IDENTITY,
        lead_representatives::UPLOAD_AUTHORITY,
    ]
    .contains(&upload_kind.as_str());
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
                    "kind": upload_kind,
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
    if of_representative {
        lead_representatives::publish_cabinet_change(&state, lead_id, auth.user_id, kind).await;
    }
    if of_payer {
        crate::realtime::publish_lead_event(
            &state,
            Some(auth.user_id),
            "lead.portal_updated",
            lead_id,
            json!({ "change": "payer_link", "access_kind": kind.as_str() }),
        )
        .await;
    }
    match request_payload(&state, lead_id, auth.user_id, kind).await {
        Ok(payload) => Json(payload).into_response(),
        Err(error) => internal(error, "load request"),
    }
}

/// Body of "send to the manager". Anything else than `declared_correct: true`
/// — also no body at all — is a request without the confirmation.
#[derive(Default, Deserialize)]
struct SubmitRequest {
    #[serde(default)]
    declared_correct: bool,
}

/// `POST /me/lead-requests/{lead_id}/submit`: "send to the manager". Needs the
/// confirmation that the information is complete and true, marks the data as
/// submitted and tells the lead's owner and the patient managers. The data
/// stays editable; a later send updates the time.
async fn submit_my_lead_request(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(lead_id): Path<Uuid>,
    body: axum::body::Bytes,
) -> axum::response::Response {
    if let Err(response) = require_patient(&auth) {
        return response;
    }
    // The checkbox of the last step (owner spec 2026-10-05).
    let declared_correct = serde_json::from_slice::<SubmitRequest>(&body)
        .unwrap_or_default()
        .declared_correct;
    if !declared_correct {
        return coded(
            StatusCode::UNPROCESSABLE_ENTITY,
            "declaration_required",
            "Please confirm that the information is complete and true",
            json!({}),
        );
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
    let payer = match lead_payer::load_declaration(&mut tx, lead_id).await {
        Ok(payer) => payer,
        Err(error) => return internal(error, "load payer"),
    };
    let identification = match load_identification(&mut *tx, lead_id).await {
        Ok((identification, _)) => identification,
        Err(error) => return internal(error, "load identification"),
    };
    let identity_uploaded = match identity_document_uploaded(&mut *tx, lead_id).await {
        Ok(uploaded) => uploaded,
        Err(error) => return internal(error, "load identity documents"),
    };
    let representation = match lead_representatives::load(&mut tx, lead_id).await {
        Ok(representation) => representation.unwrap_or_default(),
        Err(error) => return internal(error, "load representation"),
    };
    let today = crate::app_time::today();
    let missing = missing_for_submit(
        &data,
        payer.as_ref(),
        &identification,
        identity_uploaded,
        lead_representatives::missing_for_submit(&representation, today),
        payment_route_by(
            payer.as_ref(),
            &representation.representation,
            Some(auth.user_id),
        ),
        today,
    );
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
    // Medical documents, copies of the identity document and the files of the
    // representatives, counted apart: "documents" has always meant the
    // medical ones.
    let (documents, identity_documents, representative_documents): (i64, i64, i64) =
        match sqlx::query_as(
            r#"SELECT count(*) FILTER (WHERE u.kind = 'medical'),
                      count(*) FILTER (WHERE u.kind = 'identity'),
                      count(*) FILTER (WHERE u.representative_id IS NOT NULL)
               FROM lead_portal_uploads u
               JOIN documents d ON d.id = u.document_id
               WHERE u.lead_id = $1 AND u.withdrawn_at IS NULL AND d.file_deleted_at IS NULL"#,
        )
        .bind(lead_id)
        .fetch_one(&mut *tx)
        .await
        {
            Ok(counts) => counts,
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
    // The confirmation is recorded with the statements it covers (the row
    // exists: the required statements are in it). Same time as the send.
    if let Err(error) = sqlx::query(
        r#"UPDATE lead_gwg_declarations
           SET declared_correct_at = now(), declared_correct_by = $2
           WHERE lead_id = $1"#,
    )
    .bind(lead_id)
    .bind(auth.user_id)
    .execute(&mut *tx)
    .await
    {
        return internal(error, "record declaration");
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
                "identity_documents": identity_documents,
                "representatives": representation.representation.representatives.len(),
                "representative_documents": representative_documents,
                "declared_correct": true,
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
    // A third party pays and may be contacted: staff can send the payer's
    // own link now (phase 3a, sent by staff, never automatically).
    let payer_link_ready =
        match crate::routes::lead_payer_link::link_can_be_sent(&state, lead_id).await {
            Ok(ready) => ready,
            Err(error) => {
                tracing::warn!(%error, %lead_id, "check payer link gate for the notification");
                false
            }
        };
    notify_lead_staff(
        &state,
        lead_id,
        "lead_portal_submitted",
        "Patient sent the request data",
        &format!(
            "Personal data: {} of {} fields, {} documents.{}",
            data.filled_count(),
            PROGRESS_FIELDS.len(),
            documents,
            if payer_link_ready {
                " The payer link can be sent now."
            } else {
                ""
            }
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
pub(crate) async fn notify_lead_staff(
    state: &AppState,
    lead_id: Uuid,
    kind: &str,
    title: &str,
    body: &str,
) {
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
/// Upload details only for roles with medical access; Sales sees counts. The
/// lead's statements, who acts for the lead (`representation`) and where the
/// invoice goes and how the payer pays (`billing`, with the compliance flags)
/// only for the roles that read the payer declaration.
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
    // The payer stated in the cabinet, while it is still what the patient
    // entered (staff may have changed it since in the compliance step).
    let declaration = match state.db.acquire().await {
        Ok(mut conn) => lead_payer::load_declaration(&mut conn, lead_id).await,
        Err(error) => Err(error),
    };
    let declaration = match declaration {
        Ok(declaration) => declaration,
        Err(error) => return internal(error, "load payer"),
    };
    let payer_marker = declaration.as_ref().and_then(|declaration| {
        let update = updates.get(PAYER_MARKER)?;
        let current = value_marker(
            lead_id,
            PAYER_MARKER,
            Some(&lead_payer::portal_marker_value(declaration)),
        );
        (update.get("hash").and_then(Value::as_str) == Some(current.as_str())).then(|| {
            json!({
                "at": update.get("at").cloned().unwrap_or(Value::Null),
                "access_kind": update.get("kind").cloned().unwrap_or(Value::Null),
            })
        })
    });
    // When the lead last changed sections 7 and 8, while they still are what
    // the lead entered.
    let billing_updated_at = declaration.as_ref().and_then(|declaration| {
        let update = updates.get(BILLING_MARKER)?;
        let current = value_marker(
            lead_id,
            BILLING_MARKER,
            Some(&declaration.billing_marker_value()),
        );
        if update.get("hash").and_then(Value::as_str) == Some(current.as_str()) {
            update.get("at").cloned()
        } else {
            None
        }
    });
    let all_uploads = match sqlx::query(
        r#"SELECT u.document_id, u.kind, u.created_at, u.access_kind, u.reviewed_at,
                  d.original_filename, d.auto_name, d.signed_at,
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
    // "Uploads" are the medical documents, as before; the copies of the
    // identity document are listed with the lead's statements below, the
    // files of a representative with that person.
    let uploads_of = |kind: UploadKind| -> Vec<&PgRow> {
        all_uploads
            .iter()
            .filter(|upload| {
                upload.try_get::<String, _>("kind").ok().as_deref() == Some(kind.as_str())
            })
            .collect()
    };
    let (identity_uploads, uploads) = (
        uploads_of(UploadKind::Identity),
        uploads_of(UploadKind::Medical),
    );
    // The lead's own GwG statements (PEP, identity document, …) are for the
    // roles that read the payer declaration; the concierge gets none of it.
    let statements_visible = lead_payer::may_view(&auth);
    let (identification, identification_updated_at) = if statements_visible {
        match load_identification(&state.db, lead_id).await {
            Ok(loaded) => loaded,
            Err(error) => return internal(error, "load identification"),
        }
    } else {
        (Identification::default(), None)
    };
    let identity_documents: Vec<Value> = identity_uploads
        .iter()
        .filter(|_| statements_visible)
        .map(|upload| {
            json!({
                "id": upload.try_get::<Uuid, _>("document_id").ok(),
                "file_name": upload_file_name(upload),
                "uploaded_at": upload.try_get::<DateTime<Utc>, _>("created_at").ok(),
                "reviewed": upload_taken_over(upload),
            })
        })
        .collect();
    // Who acts for the lead, for the same roles as the statements; with it
    // where the invoice goes and how the payer will pay (sections 7 and 8).
    let (representation, representation_updated_at, billing, billing_updated_at) =
        if statements_visible {
            let loaded = match state.db.acquire().await {
                Ok(mut conn) => lead_representatives::load(&mut conn, lead_id).await,
                Err(error) => Err(error),
            };
            match loaded {
                Ok(loaded) => {
                    let loaded = loaded.unwrap_or_default();
                    let route_by =
                        payment_route_by(declaration.as_ref(), &loaded.representation, None);
                    (
                        lead_representatives::staff_payload(&loaded),
                        lead_representatives::updated_at(&loaded, &updates),
                        declaration
                            .clone()
                            .unwrap_or_default()
                            .billing_staff_json(route_by),
                        billing_updated_at,
                    )
                }
                Err(error) => return internal(error, "load representation"),
            }
        } else {
            (Value::Null, None, Value::Null, None)
        };
    // The payer's own link (phase 3a), for the same roles: how far it is and
    // the check level of the payer's answers.
    let payer_link = if statements_visible {
        match crate::routes::lead_payer_link::intake_summary(&state, lead_id).await {
            Ok(summary) => summary,
            Err(error) => return internal(error, "load payer link"),
        }
    } else {
        Value::Null
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
        "patient_payer": payer_marker,
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
        "identification": identification.to_json(),
        "identification_updated_at": identification_updated_at,
        "identification_hidden": !statements_visible,
        "identity_documents": identity_documents,
        "representation": representation,
        "representation_updated_at": representation_updated_at,
        "billing": billing,
        "billing_updated_at": billing_updated_at,
        "payer_link": payer_link,
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
                  -- The medical documents, as before; a copy of the identity
                  -- document is not one of "N documents".
                  (SELECT count(*) FROM lead_portal_uploads u
                   JOIN documents d ON d.id = u.document_id
                   WHERE u.lead_id = l.id AND u.kind = 'medical' AND u.withdrawn_at IS NULL
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
/// transaction: the markers, the time of sending, the upload rows of every
/// kind, the lead's own GwG statements, staff's confirmations of the
/// own-account payments and — for an unconverted lead — the payer's
/// statement and links (uploads go with the lead's documents, consents stay
/// as evidence without personal data of their own).
pub(crate) async fn purge_portal_intake_in_tx(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    lead_id: Uuid,
) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM lead_gwg_declarations WHERE lead_id = $1")
        .bind(lead_id)
        .execute(&mut **tx)
        .await?;
    super::lead_identification::purge_in_tx(tx, lead_id).await?;
    crate::routes::lead_payer_link::purge_in_tx(tx, lead_id).await?;
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
        // Of the insurance block only the answer counts, and it is not needed to send.
        data.has_insurance = Some(false);
        data.insurance_type = Some("self_pay".into());
        assert_eq!(data.filled_count(), 4);
        assert_eq!(PROGRESS_FIELDS.len(), 12);
        assert!(!data.missing_for_submit().contains(&"has_insurance"));
    }

    #[test]
    fn insurance_follows_the_staff_wizard() {
        let insured = apply_personal_data_patch(
            &anna(),
            &PersonalDataPatch {
                has_insurance: Some("yes".into()),
                insurance_type: Some("Private".into()),
                insurance_provider: Some("  Allianz   Care ".into()),
                insurance_number: Some("A-123".into()),
                insurance_covers_germany: Some("not_sure".into()),
                ..Default::default()
            },
            today(),
        )
        .unwrap();
        assert_eq!(insured.has_insurance, Some(true));
        assert_eq!(insured.insurance_type.as_deref(), Some("private"));
        assert_eq!(insured.insurance_provider.as_deref(), Some("Allianz Care"));
        assert_eq!(
            insured.insurance_covers_germany.as_deref(),
            Some("not_sure")
        );
        assert_eq!(
            changed_fields(&anna(), &insured),
            vec![
                "has_insurance",
                "insurance_type",
                "insurance_provider",
                "insurance_number",
                "insurance_covers_germany"
            ]
        );

        // "No insurance" is the self-payer: the details go.
        let self_payer = apply_personal_data_patch(
            &insured,
            &PersonalDataPatch {
                has_insurance: Some("no".into()),
                ..Default::default()
            },
            today(),
        )
        .unwrap();
        assert_eq!(self_payer.has_insurance, Some(false));
        assert_eq!(self_payer.insurance_type.as_deref(), Some("self_pay"));
        assert_eq!(self_payer.insurance_provider, None);
        assert_eq!(self_payer.insurance_number, None);
        assert_eq!(self_payer.insurance_covers_germany, None);

        // An empty answer is "not stated"; the details stay as entered.
        let unstated = apply_personal_data_patch(
            &insured,
            &PersonalDataPatch {
                has_insurance: Some(String::new()),
                ..Default::default()
            },
            today(),
        )
        .unwrap();
        assert_eq!(unstated.has_insurance, None);
        assert_eq!(unstated.insurance_provider.as_deref(), Some("Allianz Care"));

        for (patch, field) in [
            (
                PersonalDataPatch {
                    has_insurance: Some("maybe".into()),
                    ..Default::default()
                },
                "has_insurance",
            ),
            (
                PersonalDataPatch {
                    insurance_type: Some("gold".into()),
                    ..Default::default()
                },
                "insurance_type",
            ),
            (
                PersonalDataPatch {
                    insurance_covers_germany: Some("partly".into()),
                    ..Default::default()
                },
                "insurance_covers_germany",
            ),
        ] {
            let error = apply_personal_data_patch(&anna(), &patch, today()).unwrap_err();
            assert_eq!(error.field, field);
        }
    }

    fn identification_patch(body: Value) -> IdentificationPatch {
        serde_json::from_value(body).unwrap()
    }

    #[test]
    fn identification_patch_changes_only_the_sent_keys_and_normalises() {
        let stated = apply_identification_patch(
            &Identification::default(),
            &identification_patch(json!({
                "salutation": "MS",
                "former_names": "  Anna   Beispiel ",
                "birth_place": " Kyiv ",
                "birth_country": "ua",
                "contact_channels": ["messenger", "email", "email", ""],
                "id_document_type": "Passport",
                "id_document_number": " AB  123456 ",
                "id_issuing_authority": "Stadt Kyiv",
                "id_issuing_country": "ua",
                "id_issued_on": "2021-02-01",
                "id_valid_until": "2026-10-03",
                "pep_self": false,
                "pep_related": true,
                "pep_related_details": " Bruder,\r\nMinister \n",
                "payment_background": "Mein Onkel zahlt."
            })),
            today(),
        )
        .unwrap();
        assert_eq!(stated.salutation.as_deref(), Some("ms"));
        assert_eq!(stated.former_names.as_deref(), Some("Anna Beispiel"));
        assert_eq!(stated.birth_place.as_deref(), Some("Kyiv"));
        assert_eq!(stated.birth_country.as_deref(), Some("UA"));
        // The channels are stored once each, in the order of the form.
        assert_eq!(stated.contact_channels, ["email", "messenger"]);
        assert_eq!(stated.id_document_type.as_deref(), Some("passport"));
        assert_eq!(stated.id_document_number.as_deref(), Some("AB 123456"));
        // The last day of validity still counts.
        assert_eq!(stated.id_valid_until, Some(today()));
        assert_eq!(stated.pep_self, Some(false));
        // A text over several lines keeps its lines.
        assert_eq!(
            stated.pep_related_details.as_deref(),
            Some("Bruder,\nMinister")
        );
        assert_eq!(
            changed_identification_fields(&Identification::default(), &stated),
            vec![
                "salutation",
                "former_names",
                "birth_place",
                "birth_country",
                "contact_channels",
                "id_document_type",
                "id_document_number",
                "id_issuing_authority",
                "id_issuing_country",
                "id_issued_on",
                "id_valid_until",
                "pep_self",
                "pep_related",
                "pep_related_details",
                "payment_background"
            ]
        );

        // Only the sent keys change; `null` and "" clear, an absent key stays.
        let next = apply_identification_patch(
            &stated,
            &identification_patch(json!({
                "former_names": null,
                "birth_place": "",
                "id_issued_on": "",
                "contact_channels": null,
                "pep_self": null
            })),
            today(),
        )
        .unwrap();
        assert_eq!(
            changed_identification_fields(&stated, &next),
            vec![
                "former_names",
                "birth_place",
                "contact_channels",
                "id_issued_on",
                "pep_self"
            ]
        );
        assert_eq!(next.pep_self, None);
        assert_eq!(next.birth_country.as_deref(), Some("UA"));
        // The marker of the statements follows their values.
        assert_ne!(next.marker_value(), stated.marker_value());

        // The same values again change nothing.
        let same = apply_identification_patch(
            &stated,
            &identification_patch(json!({ "birth_country": "UA", "pep_related": true })),
            today(),
        )
        .unwrap();
        assert!(changed_identification_fields(&stated, &same).is_empty());
    }

    #[test]
    fn details_of_a_legal_question_belong_to_a_yes() {
        let yes = apply_identification_patch(
            &Identification::default(),
            &identification_patch(json!({
                "pep_self": true,
                "pep_self_details": "Abgeordnete, Ukraine, 2019–2023",
                "high_risk_country": true,
                "high_risk_country_code": "ir",
                "sanctions_links": true,
                "sanctions_links_details": "Geschäftspartner"
            })),
            today(),
        )
        .unwrap();
        assert_eq!(yes.high_risk_country_code.as_deref(), Some("IR"));
        assert!(yes.pep_self_details.is_some());

        let no = apply_identification_patch(
            &yes,
            &identification_patch(json!({
                "pep_self": false,
                "high_risk_country": null,
                "sanctions_links": false
            })),
            today(),
        )
        .unwrap();
        assert_eq!(no.pep_self_details, None);
        assert_eq!(no.high_risk_country_code, None);
        assert_eq!(no.sanctions_links_details, None);

        // Details without a "yes" are not kept.
        let stray = apply_identification_patch(
            &Identification::default(),
            &identification_patch(json!({ "pep_related_details": "Bruder" })),
            today(),
        )
        .unwrap();
        assert_eq!(stray, Identification::default());
    }

    #[test]
    fn identification_patch_rejects_invalid_values() {
        for (body, field, code) in [
            (json!({ "salutation": "dr" }), "salutation", "invalid_field"),
            (
                json!({ "former_names": "x".repeat(201) }),
                "former_names",
                "invalid_field",
            ),
            (
                json!({ "birth_country": "Ukraine" }),
                "birth_country",
                "invalid_field",
            ),
            (
                json!({ "habitual_residence_country": "DEU" }),
                "habitual_residence_country",
                "invalid_field",
            ),
            (
                json!({ "contact_channels": ["email", "fax"] }),
                "contact_channels",
                "invalid_field",
            ),
            (
                json!({ "id_document_type": "driving_licence" }),
                "id_document_type",
                "invalid_field",
            ),
            (
                json!({ "id_document_number": "1".repeat(61) }),
                "id_document_number",
                "invalid_field",
            ),
            (
                json!({ "id_issued_on": "2026-10-04" }),
                "id_issued_on",
                "invalid_field",
            ),
            (
                json!({ "id_issued_on": "01.02.2021" }),
                "id_issued_on",
                "invalid_field",
            ),
            (
                json!({ "id_valid_until": "2031-02-30" }),
                "id_valid_until",
                "invalid_field",
            ),
            (
                json!({ "id_valid_until": "2026-10-02" }),
                "id_valid_until",
                "id_document_expired",
            ),
            (
                json!({ "pep_self": true, "pep_self_details": "x".repeat(2001) }),
                "pep_self_details",
                "invalid_field",
            ),
            (
                json!({ "high_risk_country": true, "high_risk_country_code": "Iran" }),
                "high_risk_country_code",
                "invalid_field",
            ),
        ] {
            let error = apply_identification_patch(
                &Identification::default(),
                &identification_patch(body),
                today(),
            )
            .unwrap_err();
            assert_eq!((error.field, error.code), (field, code));
        }

        // A stored date that has passed since does not block other changes.
        let expired = Identification {
            id_valid_until: NaiveDate::from_ymd_opt(2026, 10, 1),
            ..Default::default()
        };
        let next = apply_identification_patch(
            &expired,
            &identification_patch(json!({ "birth_place": "Wien" })),
            today(),
        )
        .unwrap();
        assert_eq!(next.id_valid_until, expired.id_valid_until);
    }

    #[test]
    fn the_confirmation_and_unknown_keys_cannot_be_patched() {
        for body in [
            json!({ "declared_correct_at": "2026-10-05T09:20:00Z" }),
            json!({ "declared_correct": true }),
            json!({ "first_name": "Anna" }),
        ] {
            assert!(serde_json::from_value::<IdentificationPatch>(body).is_err());
        }
        // Without the confirmation there is nothing to send, whatever the body.
        for body in ["", "{}", "null", r#"{"declared_correct":false}"#] {
            let request: SubmitRequest =
                serde_json::from_slice(body.as_bytes()).unwrap_or_default();
            assert!(!request.declared_correct, "{body}");
        }
        let request: SubmitRequest =
            serde_json::from_slice(br#"{"declared_correct":true}"#).unwrap_or_default();
        assert!(request.declared_correct);
    }

    #[test]
    fn sending_needs_the_identification_in_form_order() {
        let mut data = anna();
        data.date_of_birth = NaiveDate::from_ymd_opt(1988, 5, 1);
        data.legal_sex = Some("female".into());
        data.citizenships = vec!["UA".into()];
        data.street_address = Some("Musterweg 1".into());
        data.zip_code = Some("10115".into());
        data.city = Some("Berlin".into());
        data.country = Some("DE".into());
        // Who acts for the lead is asked after the identity document; the
        // keys come from `lead_representatives::missing_for_submit`. Where
        // the invoice goes and the payment route come after the own-interest
        // question (phase 2).
        let representation = || vec!["has_representative".to_string()];
        assert_eq!(
            missing_for_submit(
                &data,
                None,
                &Identification::default(),
                false,
                representation(),
                PaymentRouteBy::Patient,
                today()
            ),
            vec![
                "payer_kind",
                "birth_place",
                "birth_country",
                "id_document_type",
                "id_document_number",
                "id_issuing_authority",
                "id_issuing_country",
                "id_valid_until",
                "id_document_upload",
                "has_representative",
                "payer_own_account",
                "invoice_to",
                "payment_method",
                "via_third_party",
                "pep_self",
                "pep_related",
                "high_risk_country",
                "sanctions_links"
            ]
        );

        // A "yes" asks for its details, a third-party payer for the
        // relationship, the consent to contact the payer and the background,
        // "no" to the own interest for the person, and a document that has
        // expired since it was entered is missing again.
        let payer = lead_payer::Declaration {
            payer_kind: lead_payer::PAYER_KIND_THIRD_PARTY.into(),
            first_name: Some("Viktor".into()),
            last_name: Some("Zahler".into()),
            citizenships: vec!["AT".into()],
            acts_on_own_account: false,
            own_account_answered: true,
            ..Default::default()
        };
        let stated = Identification {
            birth_place: Some("Kyiv".into()),
            birth_country: Some("UA".into()),
            id_document_type: Some("passport".into()),
            id_document_number: Some("AB123456".into()),
            id_issuing_authority: Some("Stadt Kyiv".into()),
            id_issuing_country: Some("UA".into()),
            id_valid_until: NaiveDate::from_ymd_opt(2026, 10, 2),
            pep_self: Some(true),
            pep_related: Some(false),
            high_risk_country: Some(true),
            sanctions_links: Some(true),
            ..Default::default()
        };
        // The third party answers the payment route itself: of the billing
        // only where the invoice goes is asked here.
        assert_eq!(
            missing_for_submit(
                &data,
                Some(&payer),
                &stated,
                true,
                Vec::new(),
                PaymentRouteBy::Payer,
                today()
            ),
            vec![
                "payer_relationship_kind",
                "payer_contact_consent",
                "id_valid_until",
                "payer_beneficial_owner",
                "invoice_to",
                "pep_self_details",
                "high_risk_country_code",
                "sanctions_links_details",
                "payment_background"
            ]
        );

        let complete = Identification {
            id_valid_until: NaiveDate::from_ymd_opt(2031, 2, 1),
            pep_self: Some(false),
            high_risk_country: Some(false),
            sanctions_links: Some(false),
            payment_background: Some("Mein Onkel zahlt.".into()),
            ..stated
        };
        let payer = lead_payer::Declaration {
            beneficial_owner_name: Some("Viktor Zahler".into()),
            relationship_kind: Some("relative".into()),
            contact_consent_at: Some(Utc::now()),
            invoice_to: Some("payer".into()),
            ..payer
        };
        assert!(
            missing_for_submit(
                &data,
                Some(&payer),
                &complete,
                true,
                Vec::new(),
                PaymentRouteBy::Payer,
                today()
            )
            .is_empty()
        );
        // A paying parent is asked for the route like the patient.
        assert_eq!(
            missing_for_submit(
                &data,
                Some(&payer),
                &complete,
                true,
                Vec::new(),
                PaymentRouteBy::Guardian,
                today()
            ),
            vec!["payment_method", "via_third_party"]
        );
        // The paying parent is the payer: no consent to contact somebody
        // else is asked of that login; the lead's own login still asks it.
        let without_consent = lead_payer::Declaration {
            contact_consent_at: None,
            payment_method: Some("card".into()),
            account_country: Some("DE".into()),
            account_holder: Some("Anna Muster".into()),
            via_third_party: Some(false),
            ..payer
        };
        assert!(
            missing_for_submit(
                &data,
                Some(&without_consent),
                &complete,
                true,
                Vec::new(),
                PaymentRouteBy::Guardian,
                today()
            )
            .is_empty()
        );
        assert_eq!(
            missing_for_submit(
                &data,
                Some(&without_consent),
                &complete,
                true,
                Vec::new(),
                PaymentRouteBy::Payer,
                today()
            ),
            vec!["payer_contact_consent"]
        );
    }

    #[test]
    fn the_payment_route_is_asked_of_the_patient_or_the_paying_parent() {
        let parent_id = Uuid::new_v4();
        let login = Uuid::new_v4();
        let parent =
            |email: Option<&str>, logins: Vec<Uuid>| lead_representatives::Representative {
                id: parent_id,
                slot: Some("rep1"),
                role: "legal_representative",
                relation: Some("mother".into()),
                first_name: "Anna".into(),
                last_name: "Muster".into(),
                date_of_birth: NaiveDate::from_ymd_opt(1985, 3, 2),
                email: email.map(str::to_string),
                phone: None,
                login_user_ids: logins,
                has_data: false,
                extras: Default::default(),
            };
        let minor = |people: Vec<lead_representatives::Representative>| {
            lead_representatives::Representation {
                minor: true,
                answers: Default::default(),
                representatives: people,
            }
        };
        let anna_pays = lead_payer::Declaration {
            payer_kind: lead_payer::PAYER_KIND_THIRD_PARTY.into(),
            payer_type: Some("person".into()),
            first_name: Some("Anna".into()),
            last_name: Some("Muster".into()),
            email: Some("Anna.Muster@example.com".into()),
            ..Default::default()
        };
        let own = lead_payer::Declaration {
            payer_kind: lead_payer::PAYER_KIND_SELF.into(),
            ..Default::default()
        };

        // Nobody else pays, or nobody said who pays: whoever fills the cabinet.
        let adult = lead_representatives::Representation::default();
        assert_eq!(
            payment_route_by(None, &adult, Some(login)),
            PaymentRouteBy::Patient
        );
        assert_eq!(
            payment_route_by(Some(&own), &adult, Some(login)),
            PaymentRouteBy::Patient
        );
        // The paying parent with the login is asked; the other parent, an
        // unrelated third party and a parent without a login are not.
        let with_login = minor(vec![parent(Some("anna.muster@example.com"), vec![login])]);
        assert_eq!(
            payment_route_by(Some(&anna_pays), &with_login, Some(login)),
            PaymentRouteBy::Guardian
        );
        assert_eq!(
            payment_route_by(Some(&anna_pays), &with_login, Some(Uuid::new_v4())),
            PaymentRouteBy::Payer
        );
        let without_login = minor(vec![parent(Some("anna.muster@example.com"), Vec::new())]);
        assert_eq!(
            payment_route_by(Some(&anna_pays), &without_login, Some(login)),
            PaymentRouteBy::Payer
        );
        let viktor = lead_payer::Declaration {
            first_name: Some("Viktor".into()),
            last_name: Some("Zahler".into()),
            email: Some("viktor.zahler@example.com".into()),
            ..anna_pays.clone()
        };
        assert_eq!(
            payment_route_by(Some(&viktor), &with_login, Some(login)),
            PaymentRouteBy::Payer
        );
        // Staff: whether the cabinet asks somebody at all.
        assert_eq!(
            payment_route_by(Some(&anna_pays), &with_login, None),
            PaymentRouteBy::Patient
        );
        assert_eq!(
            payment_route_by(Some(&anna_pays), &without_login, None),
            PaymentRouteBy::Payer
        );
        assert_eq!(
            payment_route_by(Some(&viktor), &with_login, None),
            PaymentRouteBy::Payer
        );
        assert_eq!(
            payment_route_by(Some(&own), &with_login, None),
            PaymentRouteBy::Patient
        );
    }

    #[test]
    fn a_parent_as_payer_is_prefilled_from_the_trusted_contact_and_the_own_row() {
        let contact = json!({
            "id": "5d0c1f0e-0000-4000-8000-000000000001",
            "name": "  Olga Maria  Kind ",
            "relation": "mother",
            "email": " olga.kind@example.com ",
            "phone": "+49 30 000000",
            "birth_date": "1985-03-04",
            "address": "Musterweg 1, 10115 Berlin"
        });
        // Without a representative row: never the contact's free-text
        // address.
        let template = payer_template_from_contact(&contact, None);
        assert_eq!(
            template,
            json!({
                "first_name": "Olga Maria",
                "last_name": "Kind",
                "date_of_birth": "1985-03-04",
                "email": "olga.kind@example.com",
                "phone": "+49 30 000000",
                "citizenships": [],
                "street": null,
                "zip": null,
                "city": null,
                "country": null
            })
        );
        // The name parts the parent entered as a representative count while
        // they still are the name of the contact; the row's citizenships and
        // address are taken over.
        let row = |first: &str, last: &str| lead_representatives::Extras {
            first_name: Some(first.into()),
            last_name: Some(last.into()),
            citizenships: vec!["DE".into(), "UA".into()],
            street: Some("Musterweg 1".into()),
            zip: Some("10115".into()),
            city: Some("Berlin".into()),
            country: Some("DE".into()),
            ..Default::default()
        };
        let entered = payer_template_from_contact(&contact, Some(&row("Olga", "Maria Kind")));
        assert_eq!(
            (&entered["first_name"], &entered["last_name"]),
            (&json!("Olga"), &json!("Maria Kind"))
        );
        assert_eq!(entered["citizenships"], json!(["DE", "UA"]));
        assert_eq!(
            (
                &entered["street"],
                &entered["zip"],
                &entered["city"],
                &entered["country"]
            ),
            (
                &json!("Musterweg 1"),
                &json!("10115"),
                &json!("Berlin"),
                &json!("DE")
            )
        );
        let renamed = payer_template_from_contact(&contact, Some(&row("Olga", "Beispiel")));
        assert_eq!(renamed["last_name"], "Kind");
        // A single word is the last name; what is not known is null.
        assert_eq!(
            payer_template_from_contact(
                &json!({ "name": "Kind", "birth_date": "", "phone": null }),
                Some(&lead_representatives::Extras::default())
            ),
            json!({
                "first_name": "",
                "last_name": "Kind",
                "date_of_birth": null,
                "email": null,
                "phone": null,
                "citizenships": [],
                "street": null,
                "zip": null,
                "city": null,
                "country": null
            })
        );
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
            assert!(health_consent_text(kind, "tr").is_none());
            assert!(inquiry_consent_text(kind, "tr").is_none());
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
