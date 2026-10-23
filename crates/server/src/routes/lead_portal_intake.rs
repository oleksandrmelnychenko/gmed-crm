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
//! The form has two stages (owner requests 2026-10-07): the base form, and
//! the follow-up blocks of the risk assessment (`follow_up`, trigger flow
//! 2026-10-07, [`crate::risk::cabinet`]) after the request was sent: the
//! cabinet learns which blocks to answer, never why (§ 47 GwG, no
//! tipping-off; no points, level or reason). The former extra step
//! ([`ExtraQuestions`]) remains the staff view `enhanced_details`. Block A
//! asks, depending on who pays: the self-payer's source of funds with a
//! proof (a portal upload of its own kind, `self_funds_proof`, under the
//! consent to process the request data), profession and sector of the
//! contract partner, why a third party pays (`payment_background`) and what
//! the patient knows of that party's funds. The answers are saved through
//! `POST /me/lead-requests/{id}/enhanced-details` (funds on the payer
//! declaration, profession and sector on `lead_gwg_declarations`); why a
//! third party pays through the statements' route.
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
use crate::consent_choices;
use crate::routes::documents::{MAX_FILE_SIZE, NewStoredDocument, persist_document_file};
use crate::routes::lead_invoice_recipient;
use crate::routes::lead_payer::{
    self, PaymentRouteBy, PortalBillingError, PortalBillingPatch, PortalFundsError,
    PortalFundsPatch, PortalPayerError, PortalPayerInput,
};
use crate::routes::lead_representatives;
use crate::state::AppState;
use gmed_domain::access::capabilities::Capability;
use gmed_domain::role::Role;

/// Version of the consent texts below. A new wording needs a new version; a
/// consent to an older version does not count any more.
pub(crate) const HEALTH_CONSENT_VERSION: &str = "2026-10-13";
const INQUIRY_CONSENT_VERSION: &str = "2026-10-03";
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
        match self {
            Self::HealthData => HEALTH_CONSENT_VERSION,
            Self::InquiryProcessing => INQUIRY_CONSENT_VERSION,
        }
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
             (zum Beispiel Arztbriefe, Befunde, Bilder und Laborwerte), sowie die Beschreibung meines Anliegens verarbeitet, um meine Anfrage \
             zu prüfen und mögliche Leistungen in Deutschland vorzubereiten (Art. 9 Abs. 2 lit. a \
             DSGVO). An Kliniken, Ärztinnen und Ärzte gibt die GMed diese Unterlagen erst nach einer \
             gesonderten Einwilligung weiter. Die Einwilligung ist freiwillig. Ich kann sie jederzeit \
             im Portal oder gegenüber der GMed mit Wirkung für die Zukunft widerrufen; die \
             Rechtmäßigkeit der bis dahin erfolgten Verarbeitung bleibt unberührt. Kommt keine \
             Zusammenarbeit zustande, werden die Anfrage und die Unterlagen nach Ablauf der \
             angegebenen Frist gelöscht."
        }
        (AccessKind::Own, "ru") => {
            "Я даю согласие на то, чтобы GMed обрабатывала данные о моём здоровье, которые я загружаю \
             в этот портал (например, выписки, заключения, снимки и анализы), а также описание моего обращения, чтобы рассмотреть мою \
             заявку и подготовить возможные услуги в Германии (ст. 9 п. 2 лит. a DSGVO). Клиникам и \
             врачам GMed передаёт эти документы только после отдельного согласия. Согласие \
             добровольное. Я могу в любой момент отозвать его в портале или обратившись в GMed; отзыв \
             действует на будущее и не влияет на законность обработки до отзыва. Если сотрудничество \
             не состоится, заявка и документы удаляются по истечении указанного срока."
        }
        (AccessKind::Guardian, "de") => {
            "Als Elternteil oder gesetzlicher Vertreter willige ich ein, dass die GMed die \
             Gesundheitsdaten meines Kindes, die ich in diesem Portal hochlade (zum Beispiel \
             Arztbriefe, Befunde, Bilder und Laborwerte), sowie die Beschreibung des Anliegens verarbeitet, um die Anfrage zu prüfen und \
             mögliche Leistungen in Deutschland vorzubereiten (Art. 9 Abs. 2 lit. a DSGVO). An \
             Kliniken, Ärztinnen und Ärzte gibt die GMed diese Unterlagen erst nach einer gesonderten \
             Einwilligung weiter. Die Einwilligung ist freiwillig. Ich kann sie jederzeit im Portal \
             oder gegenüber der GMed mit Wirkung für die Zukunft widerrufen; die Rechtmäßigkeit der \
             bis dahin erfolgten Verarbeitung bleibt unberührt. Kommt keine Zusammenarbeit zustande, \
             werden die Anfrage und die Unterlagen nach Ablauf der angegebenen Frist gelöscht."
        }
        (AccessKind::Guardian, "ru") => {
            "Как родитель или законный представитель я даю согласие на то, чтобы GMed обрабатывала \
             данные о здоровье моего ребёнка, которые я загружаю в этот портал (например, выписки, \
             заключения, снимки и анализы), а также описание обращения, чтобы рассмотреть заявку и подготовить возможные услуги \
             в Германии (ст. 9 п. 2 лит. a DSGVO). Клиникам и врачам GMed передаёт эти документы \
             только после отдельного согласия. Согласие добровольное. Я могу в любой момент отозвать \
             его в портале или обратившись в GMed; отзыв действует на будущее и не влияет на \
             законность обработки до отзыва. Если сотрудничество не состоится, заявка и документы \
             удаляются по истечении указанного срока."
        }
        (AccessKind::Own, "uk") => {
            "Я даю згоду на те, щоб GMed обробляла дані про моє здоров'я, які я завантажую в цей \
             портал (наприклад, виписки, висновки, знімки та аналізи), а також опис мого звернення, щоб розглянути мою заявку й \
             підготувати можливі послуги в Німеччині (ст. 9 п. 2 літ. a DSGVO). Клінікам і лікарям \
             GMed передає ці документи лише після окремої згоди. Згода добровільна. Я можу будь-коли \
             відкликати її в порталі або звернувшись до GMed; відкликання діє на майбутнє і не \
             впливає на законність обробки до нього. Якщо співпраця не відбудеться, заявку та \
             документи буде видалено після закінчення зазначеного строку."
        }
        (AccessKind::Own, "en") => {
            "I consent to GMed processing the health data I upload to this portal (for example \
             doctors' letters, findings, images and lab results), and the description of my concern, in order to review my request and \
             prepare possible services in Germany (Art. 9(2)(a) GDPR). GMed passes these documents \
             on to clinics and doctors only after a separate consent. The consent is voluntary. I can \
             withdraw it at any time in the portal or by contacting GMed, with effect for the \
             future; the lawfulness of the processing up to then is not affected. If no cooperation \
             comes about, the request and the documents are deleted when the stated deadline has \
             passed."
        }
        (AccessKind::Guardian, "uk") => {
            "Як батько, мати або законний представник я даю згоду на те, щоб GMed обробляла дані про \
             здоров'я моєї дитини, які я завантажую в цей портал (наприклад, виписки, висновки, \
             знімки та аналізи), а також опис звернення, щоб розглянути заявку й підготувати можливі послуги в Німеччині \
             (ст. 9 п. 2 літ. a DSGVO). Клінікам і лікарям GMed передає ці документи лише після \
             окремої згоди. Згода добровільна. Я можу будь-коли відкликати її в порталі або \
             звернувшись до GMed; відкликання діє на майбутнє і не впливає на законність обробки до \
             нього. Якщо співпраця не відбудеться, заявку та документи буде видалено після закінчення \
             зазначеного строку."
        }
        (AccessKind::Guardian, "en") => {
            "As a parent or legal guardian I consent to GMed processing my child's health data that \
             I upload to this portal (for example doctors' letters, findings, images and lab \
             results), and the description of the concern, in order to review the request and prepare possible services in Germany \
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
        // The answers of the extra step and the self-payer's proof of funds.
        .route(
            "/me/lead-requests/{lead_id}/enhanced-details",
            post(update_my_enhanced_details),
        )
        .route(
            "/me/lead-requests/{lead_id}/funds-proof",
            post(upload_my_funds_proof).layer(DefaultBodyLimit::max(MAX_FILE_SIZE + 1024 * 1024)),
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
        // The options of the consent form «Einverständniserklärung zur
        // Datenübermittlung», chosen by the person (2026-10-12).
        .route(
            "/me/lead-requests/{lead_id}/consent-choices",
            post(save_consent_choices),
        )
        // The trusted persons: people GMED may tell about the person, its own
        // menu item of the cabinet (owner 2026-10-14).
        .route(
            "/me/lead-requests/{lead_id}/trusted-persons",
            post(save_trusted_persons),
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
        .route(
            "/leads/{lead_id}/trusted-contacts/{representative_id}",
            delete(lead_representatives::remove_lead_trusted_contact),
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

/// The lead's own login (`l.portal_user_id`) is closed for the request (QA
/// 2026-10-12, A3-01; owner decision 2026-10-03: a minor has no login of its
/// own): the lead is a minor — under 18 today by the date of birth on file,
/// `CURRENT_DATE` being German time in every session. Since 2026-10-12
/// (owner) this holds before any parent's access is issued too: the child's
/// login created with the lead never fills in the request. The login itself
/// stays active: it reaches no request (reads and writes answer 403
/// `lead_request_guardian_only`, the list is empty with `own_access_closed`)
/// and staff issue no password for it. Nothing is stored, so a corrected date
/// of birth (18 or older) opens it again by itself. Expects the lead as `l`.
pub(crate) const OWN_LOGIN_CLOSED_SQL: &str = r#"(
    l.date_of_birth IS NOT NULL
    AND l.date_of_birth > (CURRENT_DATE - INTERVAL '18 years'))"#;

/// The code of the refusal of a request to the closed own login of a minor
/// ([`OWN_LOGIN_CLOSED_SQL`]), also its `error`, so the UI translates it.
pub(crate) const GUARDIAN_ONLY: &str = "lead_request_guardian_only";

/// 403 [`GUARDIAN_ONLY`]: neutral, it names no reason beyond who has access.
pub(crate) fn guardian_only() -> axum::response::Response {
    (
        StatusCode::FORBIDDEN,
        Json(json!({
            "error": GUARDIAN_ONLY,
            "code": GUARDIAN_ONLY,
            "message": "Only the parents or the legal guardian have access to this request",
        })),
    )
        .into_response()
}

/// Whether `user_id` is the own login of a minor's request that is closed to
/// it ([`OWN_LOGIN_CLOSED_SQL`]): of `lead_id`, or of any request the portal
/// still serves when `lead_id` is `None`.
pub(crate) async fn own_login_closed<'e, E>(
    executor: E,
    user_id: Uuid,
    lead_id: Option<Uuid>,
) -> Result<bool, sqlx::Error>
where
    E: sqlx::Executor<'e, Database = sqlx::Postgres>,
{
    sqlx::query_scalar(&format!(
        r#"SELECT EXISTS (
               SELECT 1 FROM leads l
               WHERE l.portal_user_id = $1
                 AND ($2::uuid IS NULL OR l.id = $2)
                 AND {PORTAL_LEAD_SQL}
                 AND {OWN_LOGIN_CLOSED_SQL}
           )"#
    ))
    .bind(user_id)
    .bind(lead_id)
    .fetch_one(executor)
    .await
}

/// The lead id of a path `/me/lead-requests/{lead_id}[/…]`.
fn lead_request_path_id(path: &str) -> Option<Uuid> {
    let path = path.strip_prefix("/api/v1").unwrap_or(path);
    let rest = path.strip_prefix("/me/lead-requests/")?;
    Uuid::parse_str(rest.split('/').next()?).ok()
}

/// The requests `user_id` reaches, oldest first. The own login of a minor
/// reaches nothing ([`OWN_LOGIN_CLOSED_SQL`]); a parent's or guardian's
/// access reaches the request only while the lead is a minor — the rule
/// [`lock_my_lead`] applies to writes. A lead who turned 18 (or whose date of
/// birth staff corrected) is no longer readable through the parents' access
/// (owner decision 2026-10-20: the 18th birthday closes the parents' access).
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
           WHERE l.portal_user_id = $1 AND {PORTAL_LEAD_SQL} AND NOT {OWN_LOGIN_CLOSED_SQL}
           UNION ALL
           SELECT l.id, 'guardian' AS kind, l.created_at
           FROM lead_portal_access a
           JOIN leads l ON l.id = a.lead_id
           WHERE a.user_id = $1
             AND a.kind = 'guardian'
             AND a.revoked_at IS NULL
             AND {PORTAL_LEAD_SQL}
             AND {OWN_LOGIN_CLOSED_SQL}
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
/// active patient record: a prospective placeholder is still only a request
/// (owner decisions 2026-10-03 and 2026-10-14).
pub(crate) async fn is_lead_only_login(
    db: &gmed_db::DbPool,
    user_id: Uuid,
) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar(&format!(
        r#"SELECT NOT EXISTS(
                   SELECT 1 FROM patient_assignments a
                   JOIN patients p ON p.id = a.patient_id
                   WHERE a.user_id = $1 AND a.revoked_at IS NULL
                     AND p.lifecycle_status = 'active' AND p.is_active = true
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
    // A parent who already has a login gets the child's request without staff
    // issuing the access (owner decision 2026-10-19).
    crate::routes::lead_portal_guardians::auto_link_for_login(state, auth.user_id).await;
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
        "/me" | "/me/password" | "/me/profile" | "/me/lead-requests" | "/me/email-check"
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
    // The own login of a minor whose parents have access reaches nothing of
    // the request, read or write (QA 2026-10-12, A3-01).
    if let Some(lead_id) = lead_request_path_id(request.uri().path()) {
        match own_login_closed(&state.db, user_id, Some(lead_id)).await {
            Ok(true) => return guardian_only(),
            Ok(false) => {}
            Err(error) => return internal(error, "check the minor's own login"),
        }
    }
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
/// when the lead is gone, converted or not the caller's — or closed to the
/// caller as a minor's own login ([`OWN_LOGIN_CLOSED_SQL`]).
pub(crate) async fn lock_my_lead(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    lead_id: Uuid,
    user_id: Uuid,
) -> Result<Option<(AccessKind, PgRow)>, sqlx::Error> {
    // The lock is taken first in its own statement: a statement that waited
    // for the lock re-reads the lead row but evaluates its subqueries (the
    // changes since submit) on the snapshot from before the wait, so two
    // simultaneous submits both counted as new (2026-10-21).
    sqlx::query("SELECT 1 FROM leads WHERE id = $1 FOR UPDATE")
        .bind(lead_id)
        .fetch_optional(&mut **tx)
        .await?;
    let row = sqlx::query(&format!(
        r#"SELECT CASE
                    WHEN l.portal_user_id = $2 AND NOT {OWN_LOGIN_CLOSED_SQL} THEN 'self'
                    WHEN {OWN_LOGIN_CLOSED_SQL} AND EXISTS (
                        SELECT 1 FROM lead_portal_access a
                        WHERE a.lead_id = l.id AND a.user_id = $2
                          AND a.kind = 'guardian' AND a.revoked_at IS NULL
                    ) THEN 'guardian'
                  END AS access_kind,
                  {PERSONAL_DATA_COLUMNS},
                  l.created_by, l.portal_submitted_at, l.portal_field_updates,
                  {CHANGED_SINCE_SUBMIT_SQL} AS changed_since_submit
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
pub(crate) async fn my_lead_access(
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
/// Key of the invoice recipient's answers of step 3 (2026-10-11) in
/// `leads.portal_field_updates`.
const INVOICE_RECIPIENT_MARKER: &str = "invoice_recipient";
/// Key of the answers of the extra step in `leads.portal_field_updates`.
const ENHANCED_DETAILS_MARKER: &str = "enhanced_details";
/// Key of the trusted persons (2026-10-14) in `leads.portal_field_updates`.
const TRUSTED_PERSONS_MARKER: &str = "trusted_persons";

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
const SUBMIT_REQUIRED_FIELDS: [&str; 10] = [
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
];

const LEGAL_SEX_VALUES: [&str; 4] = ["female", "male", "diverse", "no_entry"];

/// Same Unicode rule as the cabinet's PASSPORT_NAME. Drafts remain editable;
/// submission asks the person to confirm the spelling from the passport.
pub(crate) fn name_needs_latin_spelling(value: &str) -> bool {
    static NAME: std::sync::LazyLock<regex::Regex> = std::sync::LazyLock::new(|| {
        regex::Regex::new(r"^[\p{Latin}\p{M}\s'’.-]*$").expect("passport name regex")
    });
    static LETTER: std::sync::LazyLock<regex::Regex> =
        std::sync::LazyLock::new(|| regex::Regex::new(r"\p{L}").expect("passport letter regex"));
    let trimmed = value.trim();
    !trimmed.is_empty() && (!NAME.is_match(trimmed) || !LETTER.is_match(trimmed))
}
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
        let mut missing: Vec<_> = SUBMIT_REQUIRED_FIELDS
            .iter()
            .copied()
            .filter(|field| self.value(field).is_none())
            .collect();
        if [
            &self.first_name,
            &self.last_name,
            self.middle_name.as_deref().unwrap_or(""),
        ]
        .into_iter()
        .any(name_needs_latin_spelling)
        {
            missing.push("name_latin");
        }
        missing
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
    // A known ISO code only, like the representatives, the payer and the
    // invoice recipient: "XX" is no country (QA 2026-10-22).
    if crate::services::citizenships::is_country_code(&code) {
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
/// Key of the statements of the follow-up blocks and the reason of the
/// request in `leads.portal_field_updates`.
const STATEMENTS_MARKER: &str = "statements";

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
    /// Profession and sector of the contract partner, asked in the extra
    /// step while the enhanced check is required. Not among
    /// [`IDENTIFICATION_FIELDS`]: written through the extra step's route.
    pub(crate) occupation: Option<String>,
    pub(crate) sector: Option<String>,
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
            occupation: text("occupation"),
            sector: text("sector"),
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
    /// details. No question about a high-risk third country (owner
    /// 2026-10-22): GMED checks the country itself from the address and the
    /// citizenships; an old stored answer stays and is never required.
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
pub(crate) fn clean_long_text(
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
        next.id_document_number =
            crate::services::identity_document::document_number(text(value), "id_document_number")?;
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
    // The two dates fit together, checked only when one of them changes.
    if patch.id_issued_on.is_some() || patch.id_valid_until.is_some() {
        crate::services::identity_document::check_dates(
            next.id_issued_on,
            next.id_valid_until,
            None,
            today,
        )?;
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
               sanctions_links_details, payment_background, updated_by, occupation, sector)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16,
                   $17, $18, $19, $20, $21, $22, $23, $24, $25)
           ON CONFLICT (lead_id) DO UPDATE SET
               salutation = EXCLUDED.salutation,
               former_names = EXCLUDED.former_names,
               birth_place = EXCLUDED.birth_place,
               birth_country = EXCLUDED.birth_country,
               habitual_residence_country = EXCLUDED.habitual_residence_country,
               contact_channels = EXCLUDED.contact_channels,
               pep_self = EXCLUDED.pep_self,
               pep_self_details = EXCLUDED.pep_self_details,
               pep_related = EXCLUDED.pep_related,
               pep_related_details = EXCLUDED.pep_related_details,
               high_risk_country = EXCLUDED.high_risk_country,
               high_risk_country_code = EXCLUDED.high_risk_country_code,
               sanctions_links = EXCLUDED.sanctions_links,
               sanctions_links_details = EXCLUDED.sanctions_links_details,
               payment_background = EXCLUDED.payment_background,
               occupation = EXCLUDED.occupation,
               sector = EXCLUDED.sector,
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
    .bind(&statements.occupation)
    .bind(&statements.sector)
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
    /// The self-paying patient's proof of the source of funds (bank
    /// statement, salary slip …), under the consent to process the request
    /// data. The patient's own document; never an identity document.
    SelfFundsProof,
    /// The proof of the relationship to the paying person (block B of the
    /// risk assessment), under the consent to process the request data;
    /// only while a third party pays.
    RelationshipProof,
}

/// `lead_portal_uploads.kind` of the self-payer's proof of funds.
pub(crate) const SELF_FUNDS_PROOF_KIND: &str = "self_funds_proof";

/// `lead_portal_uploads.kind` of the proof of the relationship to the payer.
pub(crate) const RELATIONSHIP_PROOF_KIND: &str = "relationship_proof";

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
            UploadKind::SelfFundsProof => SELF_FUNDS_PROOF_KIND,
            UploadKind::RelationshipProof => RELATIONSHIP_PROOF_KIND,
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
            | UploadKind::RepresentativeAuthority
            | UploadKind::SelfFundsProof
            | UploadKind::RelationshipProof => Some(ConsentPurpose::InquiryProcessing),
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
    let Some(payer) = payer.filter(|payer| payer.is_third_party() || payer.is_representative())
    else {
        return PaymentRouteBy::Patient;
    };
    let parent = lead_representatives::payer_same_person(representation, Some(payer))
        .and_then(|id| representation.find(id));
    // A representative named as payer answers in a cabinet, never through a
    // link: the patient side answers while that parent has no login.
    if payer.is_representative() && !parent.is_some_and(|parent| parent.has_login()) {
        return PaymentRouteBy::Patient;
    }
    match (parent, caller) {
        (Some(parent), Some(caller)) if parent.login_user_ids.contains(&caller) => {
            PaymentRouteBy::Guardian
        }
        (Some(parent), None) if parent.has_login() => PaymentRouteBy::Patient,
        _ => PaymentRouteBy::Payer,
    }
}

/// The extra step "Zusätzliche Angaben" of the cabinet (owner requests
/// 2026-10-07) and which of its questions the login answers. The step is
/// shown (`required`) while the enhanced check is required by its triggers
/// or a third party outside the first circle pays; the cabinet learns only
/// that, never why.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) struct ExtraQuestions {
    /// The enhanced check is required by its triggers (black-list country,
    /// confirmed sanctions match).
    pub check_required: bool,
    /// The step is shown.
    pub required: bool,
    /// The self-payer's own source of funds, its description and the proof
    /// (with the triggers only).
    pub funds: bool,
    /// Profession of the contract partner (with the triggers; a paying
    /// parent states it in the own payer section).
    pub occupation: bool,
    /// Sector of the contract partner (with the triggers).
    pub sector: bool,
    /// Why the third party pays (whenever the step is shown and a third
    /// party pays, not of the paying parent in the own login).
    pub payment_background: bool,
    /// What the patient knows of the third party's funds (outside the first
    /// circle, until the payer answered through the own link).
    pub payer_funds: bool,
    /// A note that the paying person states the source of funds and the
    /// proofs through the own link (third party, with the triggers).
    pub payer_states_funds: bool,
}

impl ExtraQuestions {
    /// What the login answers: `check_required` are the triggers, `payer`
    /// the declaration, `route_by` who answers the payment route
    /// ([`payment_route_by`]: `Guardian` is the paying parent in the own
    /// login, who counts as the first circle), `answered_by_payer` whether
    /// the payer answered through the own link.
    pub(crate) fn of(
        check_required: bool,
        payer: Option<&lead_payer::Declaration>,
        route_by: PaymentRouteBy,
        _answered_by_payer: bool,
    ) -> Self {
        let third_party = payer.is_some_and(lead_payer::Declaration::is_third_party);
        let self_pays = payer.is_some_and(|payer| payer.payer_kind == lead_payer::PAYER_KIND_SELF);
        let paying_parent = route_by == PaymentRouteBy::Guardian;
        let outside = third_party && !paying_parent && lead_payer::outside_first_circle(payer);
        let required = check_required || outside;
        Self {
            check_required,
            required,
            funds: check_required && self_pays,
            occupation: check_required && !paying_parent,
            sector: check_required,
            payment_background: required && third_party && !paying_parent,
            payer_funds: false,
            payer_states_funds: check_required && third_party && !paying_parent,
        }
    }

    /// The cabinet's view: whether the step is shown and which questions it
    /// asks; nothing about why (the triggers are `enhanced_check.required`
    /// of the request, without reasons).
    pub(crate) fn to_json(self) -> Value {
        json!({
            "required": self.required,
            "asks": {
                "payment_background": self.payment_background,
                "payer_funds": self.payer_funds,
                "funds": self.funds,
                "occupation": self.occupation,
                "sector": self.sector,
                "funds_proof": self.funds,
                "payer_states_funds": self.payer_states_funds,
            },
            "funds_source_options": lead_payer::STATED_FUNDS_SOURCES,
        })
    }
}

/// The answers of the extra step that live outside the statements
/// (`payment_background` is one of them): the funds on the payer
/// declaration, profession and sector on `lead_gwg_declarations`.
fn enhanced_answers_json(
    payer: Option<&lead_payer::Declaration>,
    identification: &Identification,
) -> Value {
    json!({
        "funds_source": payer.and_then(|payer| payer.self_funds_source.clone()),
        "funds_description": payer.and_then(|payer| payer.self_funds_description.clone()),
        "payer_funds_source": payer.and_then(|payer| payer.payer_funds_source_stated.clone()),
        "payer_funds_description": payer
            .and_then(|payer| payer.payer_funds_description_stated.clone()),
        "occupation": identification.occupation,
        "sector": identification.sector,
    })
}

/// Stable text of the extra step's answers, for the "entered by the
/// patient" marker of the lead.
fn enhanced_marker_value(
    payer: Option<&lead_payer::Declaration>,
    identification: &Identification,
) -> String {
    enhanced_answers_json(payer, identification).to_string()
}

/// What [`missing_for_submit`] needs besides the answers: the extra step's
/// questions, whether a proof of the own funds is on file, and whether the
/// third party's contact data are known otherwise (a paying parent with a
/// cabinet login, or the payer answered through the own link).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) struct ExtraState {
    pub questions: ExtraQuestions,
    pub funds_proof_uploaded: bool,
    pub payer_contact_known: bool,
    /// One of the minor's parents or legal representatives pays — named as
    /// such, or a third-party row of before that names one
    /// ([`lead_representatives::payer_same_person`]): the contracting party,
    /// so none of a third party's consents or contact data are asked (owner
    /// decision 2026-10-19).
    pub paying_parent: bool,
}

/// The keys of the extra step still open, in form order: why a third party
/// pays, what the patient knows of its funds, the own source of funds,
/// profession, sector, the proof.
fn missing_extra(
    payer: Option<&lead_payer::Declaration>,
    identification: &Identification,
    extra: ExtraState,
) -> Vec<&'static str> {
    let questions = extra.questions;
    if !questions.required {
        return Vec::new();
    }
    let blank = |value: Option<&String>| value.is_none_or(|value| value.trim().is_empty());
    let mut missing = Vec::new();
    if questions.payment_background && blank(identification.payment_background.as_ref()) {
        missing.push("enhanced_payment_background");
    }
    if questions.payer_funds {
        if payer.is_none_or(|payer| payer.payer_funds_source_stated.is_none()) {
            missing.push("enhanced_payer_funds_source");
        }
        if blank(payer.and_then(|payer| payer.payer_funds_description_stated.as_ref())) {
            missing.push("enhanced_payer_funds_description");
        }
    }
    if questions.funds {
        if payer.is_none_or(|payer| payer.self_funds_source.is_none()) {
            missing.push("enhanced_funds_source");
        }
        if blank(payer.and_then(|payer| payer.self_funds_description.as_ref())) {
            missing.push("enhanced_funds_description");
        }
    }
    if questions.occupation && blank(identification.occupation.as_ref()) {
        missing.push("enhanced_occupation");
    }
    if questions.sector && blank(identification.sector.as_ref()) {
        missing.push("enhanced_sector");
    }
    if questions.funds && !extra.funds_proof_uploaded {
        missing.push("enhanced_funds_proof_upload");
    }
    missing
}

/// Everything still missing before the request can be sent, as the keys of
/// `progress.missing_for_submit`: the personal data, who pays with the third
/// party's contact data, then the statements for the identification in form
/// order. `representation` is what [`lead_representatives::missing_for_submit`]
/// says about who acts for the lead; the form asks it after the identity
/// document. Where the invoice goes and, for whoever is asked, the payment
/// route follow the own-interest question
/// ([`lead_payer::portal_missing_billing`]). The trigger flow (2026-10-07)
/// reshapes the list ([`crate::risk::cabinet::reshape_missing`]): staff's
/// identity data, the payment route and the follow-up blocks leave it, the
/// organisation mask and the reason of the request join it.
#[allow(clippy::too_many_arguments)]
fn missing_for_submit(
    data: &PersonalData,
    payer: Option<&lead_payer::Declaration>,
    identification: &Identification,
    identity_document_uploaded: bool,
    representation: Vec<String>,
    payment_route_by: PaymentRouteBy,
    extra: ExtraState,
    today: NaiveDate,
    base: &crate::risk::cabinet::BaseExtra,
) -> Vec<String> {
    let mut missing = data.missing_for_submit();
    // A child's request is completed through a guardian login. Contact
    // numbers are required on the representatives, not on the child.
    if crate::routes::leads::is_minor_on(data.date_of_birth, today) {
        missing.retain(|key| *key != "phone");
    }
    missing.extend(
        lead_payer::portal_missing(payer)
            .into_iter()
            // A parent who pays and answers in the own login is the payer:
            // there is nobody else GMED needs the consent to contact or to
            // pass the cost estimate on to (QA 2026-10-06, phase 3b). The
            // same for any paying parent, with or without a login of the own
            // (owner decision 2026-10-19: the contracting party).
            .filter(|key| {
                (payment_route_by != PaymentRouteBy::Guardian && !extra.paying_parent)
                    || !matches!(
                        *key,
                        "payer_contact_consent" | "payer_cost_estimate_consent"
                    )
            }),
    );
    // The third party's e-mail, phone and residence (owner request
    // 2026-10-07), unless its data are known otherwise.
    if !extra.payer_contact_known
        && !extra.paying_parent
        && payment_route_by != PaymentRouteBy::Guardian
    {
        missing.extend(lead_payer::portal_missing_contact(payer));
    }
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
    // The trigger flow (2026-10-07): staff's identity data, the follow-up
    // blocks (`follow_up`) and the extra step's questions leave the base
    // form; the organisation mask and the reason of the request join it.
    crate::risk::cabinet::reshape_missing(missing, base)
}

/// Step 3 (owner spec 2026-10-11) on top of [`missing_for_submit`]: the
/// invoice recipient comes first and absorbs "who pays". Section 7's keys
/// (`invoice_to` and the other address) give way to the recipient's
/// ([`lead_invoice_recipient::missing`]); the payer's keys and the bare
/// payment method count only once the payer named fits the answers
/// ([`lead_invoice_recipient::payer_fits`]) — until then the one key
/// `payer_kind`, as soon as the payer question is shown. An organisation
/// that pays states why the payment goes through it (`payer_payment_reason`,
/// stored as `payment_background`) instead of a relationship.
pub(crate) fn with_invoice_recipient(
    missing: Vec<String>,
    recipient: &lead_invoice_recipient::Recipient,
    payer: Option<&lead_payer::Declaration>,
    paying_parent: bool,
    payment_background_given: bool,
) -> Vec<String> {
    const SECTION_SEVEN: [&str; 6] = [
        "invoice_to",
        "invoice_name",
        "invoice_street",
        "invoice_zip",
        "invoice_city",
        "invoice_country",
    ];
    // A payer named before the recipient was answered (a request of an older
    // cabinet) keeps its keys.
    let fits = lead_invoice_recipient::payer_fits(recipient, payer, paying_parent)
        || (recipient.recipient.is_none() && payer.is_some());
    let organisation_pays =
        fits && !paying_parent && payer.is_some_and(lead_payer::Declaration::is_organisation);
    let mut reshaped: Vec<String> = missing
        .into_iter()
        .filter(|key| !SECTION_SEVEN.contains(&key.as_str()))
        .filter(|key| fits || !(key.starts_with("payer_") || key == "payment_method"))
        .filter(|key| {
            !(organisation_pays
                && matches!(
                    key.as_str(),
                    "payer_relationship_kind" | "payer_relationship"
                ))
        })
        .collect();
    let mut step_three: Vec<String> = lead_invoice_recipient::missing(recipient)
        .into_iter()
        .map(str::to_string)
        .collect();
    if !fits && lead_invoice_recipient::payer_question_reached(recipient) {
        // A paying recipient has no separate "who pays" field. Its own
        // fields and confirmation control are the actionable missing items.
        // So does the parent chosen as recipient "who pays" while the other
        // parent is named as payer (owner decision 2026-10-19).
        if (recipient.is_third_party() || recipient.representative_contact_id.is_some())
            && recipient.is_payer == Some(true)
        {
            step_three.push("invoice_recipient_is_payer".to_string());
        } else {
            step_three.push("payer_kind".to_string());
        }
    }
    let at = reshaped
        .iter()
        .position(|key| key.starts_with("payer_") || key == "payment_method")
        .unwrap_or(reshaped.len());
    for (offset, key) in step_three.into_iter().enumerate() {
        reshaped.insert(at + offset, key);
    }
    if organisation_pays && !payment_background_given {
        let after = reshaped
            .iter()
            .rposition(|key| key.starts_with("payer_"))
            .map(|index| index + 1)
            .unwrap_or(reshaped.len());
        reshaped.insert(after, "payer_payment_reason".to_string());
    }
    reshaped
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
    time("reviewed_at").is_some()
        || time("signed_at").is_some()
        || upload
            .try_get::<bool, _>("identity_in_use")
            .unwrap_or(false)
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
           ) OR EXISTS (
               SELECT 1 FROM documents d JOIN leads l ON l.id = $1
               WHERE (d.lead_id = l.id OR d.patient_id = l.prospect_patient_id)
                 AND d.status = 'active' AND d.file_deleted_at IS NULL
                 AND d.compliance_kind = 'identity'
           )"#,
    )
    .bind(lead_id)
    .fetch_one(executor)
    .await
}

/// The extra step of the cabinet for the login `caller` (or the staff view
/// with `None`) and what [`missing_for_submit`] needs with it, in the
/// caller's connection or transaction.
pub(crate) async fn extra_state(
    conn: &mut sqlx::PgConnection,
    lead_id: Uuid,
    payer: Option<&lead_payer::Declaration>,
    representation: &lead_representatives::Representation,
    caller: Option<Uuid>,
) -> Result<ExtraState, sqlx::Error> {
    let check_required = crate::routes::lead_enhanced_check::enhanced_check_triggers(conn, lead_id)
        .await?
        .required;
    let answered_by_payer =
        crate::routes::lead_payer_link::answered_by_payer(conn, lead_id, payer).await?;
    let funds_proof_uploaded: bool = sqlx::query_scalar(
        r#"SELECT EXISTS (
               SELECT 1 FROM lead_portal_uploads u
               JOIN documents d ON d.id = u.document_id
               WHERE u.lead_id = $1 AND u.kind = 'self_funds_proof'
                 AND u.withdrawn_at IS NULL AND d.file_deleted_at IS NULL
           )"#,
    )
    .bind(lead_id)
    .fetch_one(&mut *conn)
    .await?;
    let route_by = payment_route_by(payer, representation, caller);
    Ok(ExtraState {
        questions: ExtraQuestions::of(check_required, payer, route_by, answered_by_payer),
        funds_proof_uploaded,
        payer_contact_known: answered_by_payer
            || !lead_payer::contact_consent_required(payer, representation),
        paying_parent: lead_representatives::payer_same_person(representation, payer).is_some(),
    })
}

/// Whether the stored declaration says that the patient pays himself: only
/// then the cabinet takes the proof of the own funds.
async fn pays_himself(conn: &mut sqlx::PgConnection, lead_id: Uuid) -> Result<bool, sqlx::Error> {
    Ok(lead_payer::load_declaration(conn, lead_id)
        .await?
        .is_some_and(|declaration| declaration.payer_kind == lead_payer::PAYER_KIND_SELF))
}

fn payer_not_self() -> axum::response::Response {
    coded(
        StatusCode::CONFLICT,
        "payer_not_self",
        "The source of funds is asked when you pay yourself",
        json!({}),
    )
}

// ----------------------------------------------------------------------------
// Request payload
// ----------------------------------------------------------------------------

/// When the unqualified-lead rule deletes the lead, if the sweep would (not
/// for a consented repeat intake, an invoiced or a converted lead).
async fn retention_deadline(state: &AppState, row: &PgRow, lead_id: Uuid) -> Option<DateTime<Utc>> {
    let policy = crate::routes::leads::load_unqualified_lead_retention(&state.db).await?;
    if crate::routes::leads::is_outside_unqualified_purge(&state.db, lead_id).await {
        return None;
    }
    policy.deadline(
        &row.try_get::<String, _>("qualification_status").ok()?,
        &row.try_get::<String, _>("compliance_status").ok()?,
        row.try_get::<DateTime<Utc>, _>("created_at").ok()?,
    )
}

/// The caller's consent of the current version for this lead, if given.
pub(crate) async fn active_consent<'e, E>(
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
        // The representative the answer "I pay (as a parent)" names (kind
        // `representative`, owner decision 2026-10-19).
        "representative_id": lead_representatives::entry_id(contact),
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

/// `changed_since_submit` of the lead `l`: the patient changed the data or
/// the documents after sending and has not sent again — only then "send
/// again" makes sense. The cabinet's request and the staff intake (QA
/// 2026-10-06, A X2) read the same expression. Sending the answers of the
/// follow-up blocks counts as sending too (QA 2026-10-10): what the lead
/// answered there was sent with them.
pub(super) const CHANGED_SINCE_SUBMIT_SQL: &str = r#"l.portal_submitted_at IS NOT NULL AND (
    EXISTS (
        SELECT 1
        FROM jsonb_each(
            CASE WHEN jsonb_typeof(l.portal_field_updates) = 'object'
                 THEN l.portal_field_updates ELSE '{}'::jsonb END
        ) AS field(name, entry)
        WHERE (field.entry->>'at')::timestamptz > CASE
            WHEN field.name IN ('enhanced_details', 'statements', 'representative_questions') THEN GREATEST(
                l.portal_submitted_at,
                (SELECT ra.follow_up_answered_at FROM lead_risk_assessments ra WHERE ra.lead_id = l.id)
            ) ELSE l.portal_submitted_at END
    )
    OR EXISTS (
        SELECT 1 FROM lead_portal_uploads pu
        WHERE pu.lead_id = l.id
          -- The payer's files are not part of the request.
          AND pu.kind NOT IN ('payer_identity', 'payer_funds_proof')
          -- Staff's own uploads (a representative's ID copy or proof of
          -- authority from the wizard) are no change by the lead: they never
          -- ask the lead to send again nor block the Patientenformular.
          AND pu.access_kind <> 'staff'
          AND GREATEST(pu.created_at, pu.withdrawn_at) > CASE
            WHEN pu.kind IN ('self_funds_proof', 'relationship_proof') THEN GREATEST(
                l.portal_submitted_at,
                (SELECT ra.follow_up_answered_at FROM lead_risk_assessments ra WHERE ra.lead_id = l.id)
            ) ELSE l.portal_submitted_at END
    )
)"#;

/// The request page of one lead for the portal.
pub(crate) async fn request_payload(
    state: &AppState,
    lead_id: Uuid,
    user_id: Uuid,
    kind: AccessKind,
) -> Result<Value, sqlx::Error> {
    // Every load reassesses a started risk assessment (P3): every write of
    // the cabinet ends here, right after its commit.
    crate::risk::cabinet::reassess_for_cabinet(&state.db, lead_id, user_id).await?;
    let row = sqlx::query(&format!(
        r#"SELECT {PERSONAL_DATA_COLUMNS}, l.created_at, l.qualification_status,
                  l.compliance_status, l.portal_submitted_at,
                  ({CHANGED_SINCE_SUBMIT_SQL}) AS changed_since_submit
           FROM leads l
           WHERE l.id = $1"#
    ))
    .bind(lead_id)
    .fetch_one(&state.db)
    .await?;
    let data = PersonalData::from_row(&row);
    // Who pays, who acts for the lead, whether the payer answered through
    // its own link, and the extra step of this login (computed on every
    // load, so it appears as soon as an answer makes it required).
    let (payer, representation, answered_by_payer, extra, risk, stored_recipient) = {
        let mut conn = state.db.acquire().await?;
        let payer = lead_payer::load_declaration(&mut conn, lead_id).await?;
        let stored_recipient = lead_invoice_recipient::load(&mut conn, lead_id).await?;
        let answered_by_payer =
            crate::routes::lead_payer_link::answered_by_payer(&mut conn, lead_id, payer.as_ref())
                .await?;
        let representation = lead_representatives::load(&mut conn, lead_id)
            .await?
            .unwrap_or_default();
        let extra = extra_state(
            &mut conn,
            lead_id,
            payer.as_ref(),
            &representation.representation,
            Some(user_id),
        )
        .await?;
        let risk = (
            crate::risk::cabinet::base_extra(&mut conn, lead_id, payer.as_ref()).await?,
            crate::risk::cabinet::follow_up_json(&mut conn, lead_id, user_id).await?,
            crate::risk::store::review_notice(&mut conn, lead_id).await?,
            crate::risk::cabinet::load_statements(&mut conn, lead_id).await?,
            crate::risk::cabinet::payer_extras(&mut conn, lead_id).await?,
        );
        (
            payer,
            representation,
            answered_by_payer,
            extra,
            risk,
            stored_recipient,
        )
    };
    let (base, mut follow_up, review_notice, statements, (payer_extras, billing_extras)) = risk;
    let (identification, _) = load_identification(&state.db, lead_id).await?;
    let payer_self_template = match kind {
        AccessKind::Guardian => {
            guardian_payer_template(&state.db, lead_id, user_id, &representation).await?
        }
        AccessKind::Own => None,
    };
    let uploads = sqlx::query(
        r#"SELECT u.document_id, u.kind, u.created_at, u.reviewed_at, u.uploaded_by, u.access_kind,
                  d.original_filename, d.auto_name, d.file_size, d.mime_type, d.patient_id,
                  d.signed_at, d.lead_id,
                  EXISTS(SELECT 1 FROM document_shares s WHERE s.document_id = d.id) AS shared,
                  EXISTS(SELECT 1 FROM document_review_events r WHERE r.document_id = d.id) AS in_review,
                  COALESCE(u.created_at <= CASE u.kind
                    WHEN 'identity' THEN (SELECT g.id_data_entered_at FROM lead_gwg_declarations g WHERE g.lead_id = u.lead_id)
                    WHEN 'representative_identity' THEN (SELECT r.id_data_entered_at FROM lead_representatives r WHERE r.lead_id = u.lead_id AND r.contact_id = u.representative_id)
                  END, false) AS identity_in_use
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
                    "can_delete": mine && !reviewed && !moved
                        && upload.try_get::<Option<Uuid>, _>("lead_id").ok().flatten() == Some(lead_id)
                        && !upload.try_get::<bool, _>("shared").unwrap_or(true)
                        && !upload.try_get::<bool, _>("in_review").unwrap_or(true),
                })
            })
            .collect()
    };
    // The files of a representative are listed with that person, never here;
    // the self-payer's proof of funds in the extra step.
    let documents = uploads_of(UploadKind::Medical);
    let identity_documents = uploads_of(UploadKind::Identity);
    let funds_proof_documents = uploads_of(UploadKind::SelfFundsProof);
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
    // Step 3: the invoice recipient first (owner spec 2026-10-11).
    let paying_parent =
        lead_representatives::payer_same_person(&representation.representation, payer.as_ref())
            .is_some();
    let mut recipient = stored_recipient.unwrap_or_default();
    let _ = lead_invoice_recipient::resolve_parent(&mut recipient, &representation.representation);
    let mut missing = with_invoice_recipient(
        missing_for_submit(
            &data,
            payer.as_ref(),
            &identification,
            identity_document_uploaded(&state.db, lead_id).await?,
            lead_representatives::missing_for_submit(&representation, today),
            route_by,
            extra,
            today,
            &base,
        ),
        &recipient,
        payer.as_ref(),
        paying_parent,
        identification
            .payment_background
            .as_deref()
            .is_some_and(|reason| !reason.trim().is_empty()),
    );
    missing.extend(lead_invoice_recipient::parent_recipient_missing(
        &recipient,
        &representation.representation,
    ));
    // The follow-up blocks of the risk assessment: which blocks to answer
    // and what each still misses, the answers kept on the payer declaration
    // and the proofs — never why (P2, § 47 GwG).
    follow_up["answers"] = enhanced_answers_json(payer.as_ref(), &identification);
    follow_up["funds_source_options"] = json!(lead_payer::STATED_FUNDS_SOURCES);
    follow_up["funds_proof_documents"] = json!(funds_proof_documents);
    follow_up["relationship_proof_documents"] = json!(uploads_of(UploadKind::RelationshipProof));
    // Block I (a new identity document) lists only the copies uploaded since
    // staff entered the identity data, as its `missing` counts them: an older
    // copy is no answer, the lead sees the empty upload (QA 2026-10-10).
    let identity_since = follow_up
        .as_object_mut()
        .and_then(|follow_up| follow_up.remove("identity_since"))
        .and_then(|value| serde_json::from_value::<DateTime<Utc>>(value).ok());
    follow_up["identity_documents"] = json!(
        identity_documents
            .iter()
            .filter(|document| identity_since.is_none_or(|since| uploaded_after(document, since)))
            .cloned()
            .collect::<Vec<_>>()
    );
    // A paying representative is shown with the representative's own data
    // (owner decision 2026-10-19: never copied onto the declaration).
    let shown_payer = payer
        .as_ref()
        .map(|payer| payer.with_representative(&representation.representation));
    let mut payer_json = lead_payer::portal_payload(shown_payer.as_ref(), answered_by_payer);
    if !payer_json.is_null() {
        crate::risk::cabinet::merge_into(&mut payer_json, payer_extras);
    }
    let mut billing_json = lead_payer::portal_billing_payload(
        payer.as_ref(),
        route_by,
        account_holder_suggestion.as_deref(),
    );
    crate::risk::cabinet::merge_into(&mut billing_json, billing_extras);
    crate::risk::cabinet::merge_into(&mut billing_json, recipient.portal_json());
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
    let deadline = retention_deadline(state, &row, lead_id).await;
    let consent_choice = consent_choices::current_for(&state.db, Some(lead_id), None).await?;
    let trusted_persons = load_trusted_persons(&state.db, lead_id).await?;
    Ok(json!({
        "lead_id": lead_id,
        "access_kind": kind.as_str(),
        "created_at": row.try_get::<DateTime<Utc>, _>("created_at").ok(),
        "personal_data": data.to_json(),
        "progress": {
            "filled": data.filled_count(),
            "total": PROGRESS_FIELDS.len(),
            "missing_by_step": crate::risk::cabinet::missing_by_step(&missing),
            "missing_for_submit": missing,
        },
        "payer": payer_json,
        "payer_self_template": payer_self_template,
        "billing": billing_json,
        "payer_questionnaire": payer_questionnaire,
        // The follow-up blocks and the neutral notice after sending, for
        // every lead alike — no points, level or reason (P2).
        "follow_up": follow_up,
        "review_notice": review_notice,
        "identification": crate::risk::cabinet::cabinet_identification(
            identification.to_json(),
            &statements,
        ),
        "minor": crate::routes::leads::is_minor_on(data.date_of_birth, today),
        "representation": lead_representatives::portal_payload(&representation, user_id),
        "documents": documents,
        "identity_documents": identity_documents,
        "max_documents": MAX_PORTAL_UPLOADS,
        // Files staff uploaded in the wizard do not use up the lead's limit.
        "documents_used": uploads.iter().filter(|upload| {
            !PAYER_UPLOAD_KINDS.contains(&upload.try_get::<String, _>("kind").unwrap_or_default().as_str())
                && upload.try_get::<String, _>("access_kind").is_ok_and(|kind| kind != "staff")
        }).count(),
        "consents": consents,
        // The person's own choice of the consent form options (2026-10-12).
        "consent_form": consent_form_json(consent_choice.as_ref(), user_id),
        // The trusted persons of the menu item «Vertrauenspersonen»
        // (2026-10-14): one list per lead.
        "trusted_persons": trusted_persons,
        "disclosure": consent_choice.as_ref().and_then(|c| c.disclosure.as_ref()),
        "disclosure_company_name": disclosure_company_name(&state.db).await?,
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

/// Whether a listed upload (`uploaded_at`) is newer than `since`.
fn uploaded_after(document: &Value, since: DateTime<Utc>) -> bool {
    document
        .get("uploaded_at")
        .cloned()
        .and_then(|value| serde_json::from_value::<DateTime<Utc>>(value).ok())
        .is_some_and(|uploaded_at| uploaded_at > since)
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
/// `own_access_closed` is true for the own login of a minor
/// ([`OWN_LOGIN_CLOSED_SQL`]): the cabinet then says, neutrally, that only
/// the parents or the guardian fill in the request.
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
    let own_access_closed = match own_login_closed(&state.db, auth.user_id, None).await {
        Ok(closed) => closed,
        Err(error) => return internal(error, "check the minor's own login"),
    };
    if own_access_closed {
        notify_parents_access_missing(&state, auth.user_id).await;
    }
    let mut requests = Vec::with_capacity(leads.len());
    for (lead_id, kind) in leads {
        match request_payload(&state, lead_id, auth.user_id, kind).await {
            Ok(payload) => requests.push(payload),
            Err(error) => return internal(error, "load request"),
        }
    }
    Json(json!({ "requests": requests, "own_access_closed": own_access_closed })).into_response()
}

/// A minor signed in with the own login before anybody gave the parents
/// access (owner 2026-10-12): staff are told once per lead to issue it, with
/// the notice the cabinet sends for a date of birth under 18. Best effort.
async fn notify_parents_access_missing(state: &AppState, user_id: Uuid) {
    let leads: Vec<Uuid> = match sqlx::query_scalar(&format!(
        r#"SELECT l.id FROM leads l
           WHERE l.portal_user_id = $1
             AND {PORTAL_LEAD_SQL}
             AND {OWN_LOGIN_CLOSED_SQL}
             AND NOT EXISTS (
                 SELECT 1 FROM lead_portal_access a
                 WHERE a.lead_id = l.id AND a.kind = 'guardian' AND a.revoked_at IS NULL
             )
             AND NOT EXISTS (
                 SELECT 1 FROM user_notifications n
                 WHERE n.entity_type = 'lead' AND n.entity_id = l.id
                   AND n.kind = 'lead_portal_minor'
                   AND n.created_at >= COALESCE((
                       SELECT max(a.revoked_at) FROM lead_portal_access a
                       WHERE a.lead_id = l.id AND a.kind = 'guardian'
                   ), '-infinity'::timestamptz)
             )"#
    ))
    .bind(user_id)
    .fetch_all(&state.db)
    .await
    {
        Ok(leads) => leads,
        Err(error) => {
            tracing::warn!(%error, "find minors without parents' access");
            return;
        }
    };
    for lead_id in leads {
        notify_lead_staff_once(
            state,
            lead_id,
            "lead_portal_minor",
            "Patient is under 18: issue the parents' access",
            "The patient signed in with the own login, but is under 18. A minor has no own login; issue access to a parent or legal guardian.",
            false,
        )
        .await;
    }
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
    if patch.date_of_birth.is_some()
        && ((kind == AccessKind::Guardian
            && !crate::routes::leads::is_minor_on(next.date_of_birth, today))
            || (current.date_of_birth.is_some() && next.date_of_birth.is_none()))
    {
        return coded(
            StatusCode::UNPROCESSABLE_ENTITY,
            "dob_staff_only",
            "Ask GMED to correct this date of birth",
            json!({ "field": "date_of_birth" }),
        );
    }
    // A minor has no own login (owner decision 2026-10-03): the parents fill
    // in the request. The date is not stored; staff are told to issue the
    // parents' access instead.
    if kind == AccessKind::Own
        && next.date_of_birth != current.date_of_birth
        && crate::routes::leads::is_minor_on(next.date_of_birth, today)
    {
        drop(tx);
        notify_lead_staff_once(
            &state,
            lead_id,
            "lead_portal_minor",
            "Patient is under 18: issue the parents' access",
            "The patient entered a date of birth under 18 in the portal. A minor has no own login; issue access to a parent or legal guardian.",
            true,
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

    let now = match portal_update_time(&mut tx).await {
        Ok(now) => now,
        Err(error) => return internal(error, "read portal update time"),
    };
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
               -- `citizenships` is the one source: the legacy single
               -- registration country goes once the list is written.
               wizard_state = CASE
                   WHEN $14 THEN wizard_state - 'registration_country'
                   ELSE wizard_state
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
    // The login carries the lead's name: a rename in the cabinet reaches the
    // account page and Users & Roles in the same step.
    let renamed_login = if changed.contains(&"first_name") || changed.contains(&"last_name") {
        match crate::routes::lead_portal_account::sync_name_in_tx(&mut tx, lead_id).await {
            Ok(synced) => synced,
            Err(error) => return internal(error, "sync login name"),
        }
    } else {
        None
    };
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
    if let Some(user_id) = renamed_login {
        crate::realtime::publish_user_profile_event(
            &state,
            Some(auth.user_id),
            user_id,
            json!({ "change": "name", "source": "lead", "lead_id": lead_id }),
        )
        .await;
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
    Json(mut body): Json<Value>,
) -> axum::response::Response {
    if let Err(response) = require_patient(&auth) {
        return response;
    }
    // The organisation mask (trigger flow 2026-10-07) is stored apart.
    let mask = crate::risk::cabinet::take_keys(&mut body, &crate::risk::cabinet::ORGANISATION_KEYS);
    let input: PortalPayerInput = match serde_json::from_value(body) {
        Ok(input) => input,
        Err(error) => {
            return coded(
                StatusCode::UNPROCESSABLE_ENTITY,
                "invalid_body",
                &error.to_string(),
                json!({}),
            );
        }
    };
    let mut tx = match state.db.begin().await {
        Ok(tx) => tx,
        Err(error) => return internal(error, "begin"),
    };
    let (kind, lead) = match lock_my_lead(&mut tx, lead_id, auth.user_id).await {
        Ok(Some(found)) => found,
        Ok(None) => return not_found(),
        Err(error) => return internal(error, "lock request"),
    };
    if input.payer_kind.trim() == lead_payer::PAYER_KIND_SELF
        && crate::routes::leads::is_minor_on(
            PersonalData::from_row(&lead).date_of_birth,
            crate::app_time::today(),
        )
    {
        return coded(
            StatusCode::UNPROCESSABLE_ENTITY,
            "payer_kind_invalid",
            "A minor's payer must be a parent or another adult",
            json!({ "field": "payer_kind" }),
        );
    }
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
    let mask_changed =
        match crate::risk::cabinet::save_organisation_mask(&mut tx, lead_id, &mask).await {
            Ok(Ok(changed)) => changed,
            Ok(Err(error)) => return error.into_response(),
            Err(error) => return internal(error, "save organisation"),
        };
    if !mask_changed.is_empty()
        && let Err(error) = crate::risk::cabinet::audit_keys(
            &mut tx,
            "lead_portal_update_payer_organisation",
            auth.user_id,
            lead_id,
            &mask_changed,
            kind.as_str(),
        )
        .await
    {
        return internal(error, "audit organisation");
    }
    // Section 7 is derived from the invoice recipient of step 3: the payer
    // named now may make "to the payer" an answer, or take it back.
    let synced = match lead_invoice_recipient::audit_section_seven_change(
        &mut tx,
        lead_id,
        declared.as_ref(),
        auth.user_id,
        kind.as_str(),
    )
    .await
    {
        Ok(synced) => synced,
        Err(error) => return internal(error, "derive invoice recipient"),
    };
    // Section 7 the lead's answers changed is still the lead's entry.
    let mut markers = Map::new();
    if !synced.is_empty() {
        match billing_marker(&mut tx, lead_id, auth.user_id, kind).await {
            Ok(Some(marker)) => {
                markers.insert(BILLING_MARKER.to_string(), marker);
            }
            Ok(None) => {}
            Err(error) => return internal(error, "load payer"),
        }
    }
    let Some(declaration) = saved else {
        if !mask_changed.is_empty() || !synced.is_empty() {
            if let Err(error) = sqlx::query(
                r#"UPDATE leads
                       SET portal_field_updates = portal_field_updates || $2::jsonb,
                           updated_at = now()
                       WHERE id = $1"#,
            )
            .bind(lead_id)
            .bind(Value::Object(markers))
            .execute(&mut *tx)
            .await
            {
                return internal(error, "mark billing");
            }
            if let Err(error) = tx.commit().await {
                return internal(error, "commit organisation");
            }
            crate::realtime::publish_lead_event(
                &state,
                Some(auth.user_id),
                "lead.portal_updated",
                lead_id,
                json!({ "change": "payer", "access_kind": kind.as_str() }),
            )
            .await;
        } else {
            drop(tx);
        }
        return match request_payload(&state, lead_id, auth.user_id, kind).await {
            Ok(payload) => Json(payload).into_response(),
            Err(error) => internal(error, "load request"),
        };
    };
    let now = match portal_update_time(&mut tx).await {
        Ok(now) => now,
        Err(error) => return internal(error, "read portal update time"),
    };
    markers.insert(
        PAYER_MARKER.to_string(),
        json!({
            "at": now,
            "by": auth.user_id,
            "kind": kind.as_str(),
            "hash": value_marker(
                lead_id,
                PAYER_MARKER,
                Some(&lead_payer::portal_marker_value(&declaration)),
            ),
        }),
    );
    if let Err(error) = sqlx::query(
        r#"UPDATE leads
           SET portal_field_updates = portal_field_updates || $2::jsonb, updated_at = now()
           WHERE id = $1"#,
    )
    .bind(lead_id)
    .bind(Value::Object(markers))
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

/// Portal changes and submission use the same database clock. Read it after
/// the lead lock: transaction-start time can predate a preceding writer.
pub(crate) async fn portal_update_time(
    conn: &mut sqlx::PgConnection,
) -> Result<DateTime<Utc>, sqlx::Error> {
    sqlx::query_scalar("SELECT clock_timestamp()")
        .fetch_one(conn)
        .await
}

/// The "entered by the patient" marker of sections 7 and 8, made from the
/// stored declaration (`None` without one).
async fn billing_marker(
    conn: &mut sqlx::PgConnection,
    lead_id: Uuid,
    actor: Uuid,
    kind: AccessKind,
) -> Result<Option<Value>, sqlx::Error> {
    let Some(declaration) = lead_payer::load_declaration(&mut *conn, lead_id).await? else {
        return Ok(None);
    };
    let now = portal_update_time(conn).await?;
    Ok(Some(json!({
        "at": now,
        "by": actor,
        "kind": kind.as_str(),
        "hash": value_marker(
            lead_id,
            BILLING_MARKER,
            Some(&declaration.billing_marker_value()),
        ),
    })))
}

/// `POST /me/lead-requests/{lead_id}/billing`: autosave of who receives the
/// invoice (step 3) and how the payer will pay (section 8), only the changed
/// keys. Section 8 lands in the payer declaration; the payer of the lead's
/// orders (the Kostenübernehmer) is not touched. A key of section 8 from a login
/// that is not asked for it — the third party answers itself — is refused
/// as a whole (409 `payment_route_by_payer`); without an answer who pays
/// there is nothing to patch (409 `payer_not_declared`). The audit event
/// names the changed fields, never their values.
///
/// Step 3 (owner spec 2026-10-11) sends the invoice recipient here as well
/// (`invoice_recipient`, `invoice_recipient_is_payer`, `recipient_*`): kept
/// in `lead_invoice_recipients` (the one source of the recipient), answered
/// before anybody is named as payer; section 7 of the declaration is derived
/// from them when it is read, and its keys are no longer accepted here
/// ([`lead_invoice_recipient::fill_section_seven`]).
async fn update_my_billing(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(lead_id): Path<Uuid>,
    Json(mut body): Json<Value>,
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
    // Block C of the risk assessment (expected total, through whom another
    // person pays) is stored apart (trigger flow 2026-10-07).
    let block_c = crate::risk::cabinet::take_keys(&mut body, &crate::risk::cabinet::BLOCK_C_KEYS);
    // The invoice recipient of step 3 (2026-10-11) is stored apart.
    let recipient_body =
        crate::risk::cabinet::take_keys(&mut body, &lead_invoice_recipient::RECIPIENT_KEYS);
    let patch = match PortalBillingPatch::parse(&body) {
        Ok(patch) => patch,
        Err(PortalBillingError::Invalid { field, message }) => return invalid(&field, message),
        Err(_) => return invalid("body", "The body could not be read"),
    };
    // Only the recipient (or block C): no section 7 or 8 key to patch, so
    // nothing needs a declaration.
    let sections_sent = body.as_object().is_none_or(|object| !object.is_empty());
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
    if !block_c.is_empty() {
        if payer.is_none() {
            return coded(
                StatusCode::CONFLICT,
                "payer_not_declared",
                "Please answer who pays first",
                json!({}),
            );
        }
        if !route_by.asks() {
            return coded(
                StatusCode::CONFLICT,
                "payment_route_by_payer",
                "The payer states the payment route; the cabinet does not ask for it",
                json!({}),
            );
        }
    }
    let saved = if !sections_sent {
        Ok(None)
    } else {
        lead_payer::save_billing_from_portal(
            &mut tx,
            lead_id,
            auth.user_id,
            kind.as_str(),
            &patch,
            route_by,
        )
        .await
    };
    let saved = match saved {
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
    let block_c_changed = match crate::risk::cabinet::save_block_c(&mut tx, lead_id, &block_c).await
    {
        Ok(Ok(changed)) => changed,
        Ok(Err(error)) => return error.into_response(),
        Err(error) => return internal(error, "save payment route"),
    };
    if !block_c_changed.is_empty()
        && let Err(error) = crate::risk::cabinet::audit_keys(
            &mut tx,
            "lead_portal_update_payment_route_details",
            auth.user_id,
            lead_id,
            &block_c_changed,
            kind.as_str(),
        )
        .await
    {
        return internal(error, "audit payment route");
    }
    // The invoice recipient: applied to the stored answers.
    let mut recipient_marker = None;
    if !recipient_body.is_empty() {
        let stored = match lead_invoice_recipient::load(&mut tx, lead_id).await {
            Ok(stored) => stored,
            Err(error) => return internal(error, "load invoice recipient"),
        };
        let mut current = stored.clone().unwrap_or_default();
        let _ =
            lead_invoice_recipient::resolve_parent(&mut current, &representation.representation);
        let mut next = match lead_invoice_recipient::apply(&current, &recipient_body) {
            Ok(next) => next,
            Err(error) => return error.into_response(),
        };
        lead_invoice_recipient::default_parent_to_viewer(
            &mut next,
            &representation.representation,
            auth.user_id,
        );
        if let Err(error) =
            lead_invoice_recipient::resolve_parent(&mut next, &representation.representation)
        {
            return error.into_response();
        }
        let changed = lead_invoice_recipient::changed_keys(&current, &next);
        if !changed.is_empty() || stored.is_none() {
            if let Err(error) =
                lead_invoice_recipient::store(&mut tx, lead_id, &next, auth.user_id).await
            {
                return internal(error, "store invoice recipient");
            }
            if let Err(error) = crate::risk::cabinet::audit_keys(
                &mut tx,
                "lead_portal_update_invoice_recipient",
                auth.user_id,
                lead_id,
                &changed,
                kind.as_str(),
            )
            .await
            {
                return internal(error, "audit invoice recipient");
            }
            recipient_marker = Some(next.marker_value());
        }
    }
    // Section 7 is derived from the recipient's answers.
    let synced = match lead_invoice_recipient::audit_section_seven_change(
        &mut tx,
        lead_id,
        payer.as_ref(),
        auth.user_id,
        kind.as_str(),
    )
    .await
    {
        Ok(synced) => synced,
        Err(error) => return internal(error, "derive invoice recipient"),
    };
    if saved.is_none()
        && block_c_changed.is_empty()
        && recipient_marker.is_none()
        && synced.is_empty()
    {
        drop(tx);
        return match request_payload(&state, lead_id, auth.user_id, kind).await {
            Ok(payload) => Json(payload).into_response(),
            Err(error) => internal(error, "load request"),
        };
    }
    let mut markers = Map::new();
    if saved.is_some() || !synced.is_empty() {
        match billing_marker(&mut tx, lead_id, auth.user_id, kind).await {
            Ok(Some(marker)) => {
                markers.insert(BILLING_MARKER.to_string(), marker);
            }
            Ok(None) => {}
            Err(error) => return internal(error, "load payer"),
        }
    }
    if let Some(value) = &recipient_marker {
        let now = match portal_update_time(&mut tx).await {
            Ok(now) => now,
            Err(error) => return internal(error, "read portal update time"),
        };
        markers.insert(
            INVOICE_RECIPIENT_MARKER.to_string(),
            json!({
                "at": now,
                "by": auth.user_id,
                "kind": kind.as_str(),
                "hash": value_marker(lead_id, INVOICE_RECIPIENT_MARKER, Some(value)),
            }),
        );
    }
    if !markers.is_empty()
        && let Err(error) = sqlx::query(
            r#"UPDATE leads
               SET portal_field_updates = portal_field_updates || $2::jsonb, updated_at = now()
               WHERE id = $1"#,
        )
        .bind(lead_id)
        .bind(Value::Object(markers))
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

/// The body of `POST /me/lead-requests/{lead_id}/enhanced-details`: only the
/// changed keys; `null` or `""` clears a value. Unknown keys are refused.
#[derive(Debug, Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct EnhancedDetailsPatch {
    /// The self-payer's own source of funds ([`lead_payer::STATED_FUNDS_SOURCES`]).
    #[serde(default, deserialize_with = "sent")]
    funds_source: Option<Option<String>>,
    #[serde(default, deserialize_with = "sent")]
    funds_description: Option<Option<String>>,
    /// What the patient knows of a third party's funds.
    #[serde(default, deserialize_with = "sent")]
    payer_funds_source: Option<Option<String>>,
    #[serde(default, deserialize_with = "sent")]
    payer_funds_description: Option<Option<String>>,
    /// Profession and sector of the contract partner (≤ 200 characters).
    #[serde(default, deserialize_with = "sent")]
    occupation: Option<Option<String>>,
    #[serde(default, deserialize_with = "sent")]
    sector: Option<Option<String>>,
}

impl EnhancedDetailsPatch {
    fn funds(&self) -> PortalFundsPatch {
        PortalFundsPatch {
            funds_source: self.funds_source.clone(),
            funds_description: self.funds_description.clone(),
            payer_funds_source: self.payer_funds_source.clone(),
            payer_funds_description: self.payer_funds_description.clone(),
        }
    }
}

/// Profession and sector applied to the statements; the keys that changed.
pub(crate) fn apply_profile_patch(
    current: &Identification,
    patch: &EnhancedDetailsPatch,
) -> Result<(Identification, Vec<&'static str>), FieldError> {
    let text = |value: &Option<String>| value.as_deref().unwrap_or_default().to_string();
    let mut next = current.clone();
    if let Some(value) = &patch.occupation {
        next.occupation = clean_text(&text(value), "occupation", 200)?;
    }
    if let Some(value) = &patch.sector {
        next.sector = clean_text(&text(value), "sector", 200)?;
    }
    let mut changed = Vec::new();
    if next.occupation != current.occupation {
        changed.push("occupation");
    }
    if next.sector != current.sector {
        changed.push("sector");
    }
    Ok((next, changed))
}

/// `POST /me/lead-requests/{lead_id}/enhanced-details`: autosave of the
/// answers of the extra step "Zusätzliche Angaben", only the changed keys:
/// `funds_source` / `funds_description` (the self-payer's own funds; 409
/// `payer_not_self` when a third party pays), `payer_funds_source` /
/// `payer_funds_description` (what the patient knows of a third party's
/// funds; 409 `payer_not_third_party` otherwise), `occupation` and `sector`
/// (the contract partner). Without an answer who pays the funds keys answer
/// 409 `payer_not_declared`. A value the cabinet has to correct: 422
/// `invalid_field` with the key. The funds land in the payer declaration,
/// profession and sector in the lead's statements. One audit event names the
/// changed keys, never their values. Why a third party pays is a statement
/// of its own (`payment_background`, through `…/identification`).
async fn update_my_enhanced_details(
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
    if let Some(unknown) = body.as_object().and_then(|object| {
        object.keys().find(|key| {
            ![
                "funds_source",
                "funds_description",
                "payer_funds_source",
                "payer_funds_description",
                "occupation",
                "sector",
            ]
            .contains(&key.as_str())
        })
    }) {
        return invalid(unknown.as_str(), "Unknown field");
    }
    let patch: EnhancedDetailsPatch = match serde_json::from_value(body) {
        Ok(patch) => patch,
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
    let current = match load_identification(&mut *tx, lead_id).await {
        Ok((current, _)) => current,
        Err(error) => return internal(error, "load identification"),
    };
    let (statements, mut changed) = match apply_profile_patch(&current, &patch) {
        Ok(applied) => applied,
        Err(error) => return error.into_response(),
    };
    let funds = patch.funds();
    let declaration = if funds.is_empty() {
        match lead_payer::load_declaration(&mut tx, lead_id).await {
            Ok(declaration) => declaration,
            Err(error) => return internal(error, "load payer"),
        }
    } else {
        match lead_payer::save_funds_from_portal(&mut tx, lead_id, auth.user_id, &funds).await {
            Ok(Some((declaration, funds_changed))) => {
                changed.extend(funds_changed);
                Some(declaration)
            }
            Ok(None) => match lead_payer::load_declaration(&mut tx, lead_id).await {
                Ok(declaration) => declaration,
                Err(error) => return internal(error, "load payer"),
            },
            Err(PortalFundsError::Invalid { field, message }) => return invalid(field, message),
            Err(PortalFundsError::NotDeclared) => {
                return coded(
                    StatusCode::CONFLICT,
                    "payer_not_declared",
                    "Please answer who pays first",
                    json!({}),
                );
            }
            Err(PortalFundsError::NotSelf) => return payer_not_self(),
            Err(PortalFundsError::NotThirdParty) => {
                return coded(
                    StatusCode::CONFLICT,
                    "payer_not_third_party",
                    "The payer's funds are asked when another person pays",
                    json!({}),
                );
            }
            Err(PortalFundsError::Database(error)) => return internal(error, "save funds"),
        }
    };
    if changed.is_empty() {
        drop(tx);
        return match request_payload(&state, lead_id, auth.user_id, kind).await {
            Ok(payload) => Json(payload).into_response(),
            Err(error) => internal(error, "load request"),
        };
    }
    if statements != current
        && let Err(error) = store_identification(&mut tx, lead_id, &statements, auth.user_id).await
    {
        return internal(error, "store profession");
    }
    let now = match portal_update_time(&mut tx).await {
        Ok(now) => now,
        Err(error) => return internal(error, "read portal update time"),
    };
    let marker = json!({
        ENHANCED_DETAILS_MARKER: {
            "at": now,
            "by": auth.user_id,
            "kind": kind.as_str(),
            "hash": value_marker(
                lead_id,
                ENHANCED_DETAILS_MARKER,
                Some(&enhanced_marker_value(declaration.as_ref(), &statements)),
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
        return internal(error, "mark enhanced details");
    }
    if let Err(error) = audit::write_in_transaction(
        &mut tx,
        &audit::domain_event(
            "lead_portal_update_enhanced_details",
            Some(auth.user_id),
            "lead",
            Some(lead_id),
            json!({ "fields": changed, "access_kind": kind.as_str() }),
        ),
    )
    .await
    {
        return internal(error, "audit enhanced details");
    }
    if let Err(error) = tx.commit().await {
        return internal(error, "commit enhanced details");
    }
    crate::realtime::publish_lead_event(
        &state,
        Some(auth.user_id),
        "lead.portal_updated",
        lead_id,
        json!({ "change": ENHANCED_DETAILS_MARKER, "access_kind": kind.as_str() }),
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
/// Staff's identity document data (`id_*`) answer 422 `staff_only` (the lead
/// only uploads the document, staff enter its data); the statements of the
/// follow-up blocks F, B, H, J and the reason of the request
/// ([`crate::risk::cabinet::STATEMENT_KEYS`]) are taken here too.
async fn update_my_identification(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(lead_id): Path<Uuid>,
    Json(body): Json<Value>,
) -> axum::response::Response {
    if let Err(response) = require_patient(&auth) {
        return response;
    }
    let (body, statements_body) = match crate::risk::cabinet::split_identification_body(body) {
        Ok(split) => split,
        Err(response) => return response,
    };
    let patch: IdentificationPatch = match serde_json::from_value(body) {
        Ok(patch) => patch,
        Err(error) => {
            return coded(
                StatusCode::UNPROCESSABLE_ENTITY,
                "invalid_body",
                &error.to_string(),
                json!({}),
            );
        }
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
    let current = match load_identification(&mut *tx, lead_id).await {
        Ok((current, _)) => current,
        Err(error) => return internal(error, "load identification"),
    };
    let next = match apply_identification_patch(&current, &patch, crate::app_time::today()) {
        Ok(next) => next,
        Err(error) => return error.into_response(),
    };
    let changed = changed_identification_fields(&current, &next);
    if statements_body
        .get("request_reason")
        .and_then(Value::as_str)
        .is_some_and(|reason| !reason.trim().is_empty())
    {
        match active_consent(&mut *tx, lead_id, auth.user_id, ConsentPurpose::HealthData).await {
            Ok(Some(_)) => {}
            Ok(None) => {
                return coded(
                    StatusCode::UNPROCESSABLE_ENTITY,
                    "health_consent_required",
                    "Give consent to health data processing before describing your concern",
                    json!({ "field": "request_reason" }),
                );
            }
            Err(error) => return internal(error, "load health consent"),
        }
    }
    let statements_changed = match crate::risk::cabinet::save_statements(
        &mut tx,
        lead_id,
        &statements_body,
        auth.user_id,
    )
    .await
    {
        Ok(Ok(changed)) => changed,
        Ok(Err(error)) => return error.into_response(),
        Err(error) => return internal(error, "store statements"),
    };
    if changed.is_empty() && statements_changed.is_empty() {
        drop(tx);
        return match request_payload(&state, lead_id, auth.user_id, kind).await {
            Ok(payload) => Json(payload).into_response(),
            Err(error) => internal(error, "load request"),
        };
    }
    if !changed.is_empty()
        && let Err(error) = store_identification(&mut tx, lead_id, &next, auth.user_id).await
    {
        return internal(error, "store identification");
    }
    let now = match portal_update_time(&mut tx).await {
        Ok(now) => now,
        Err(error) => return internal(error, "read portal update time"),
    };
    let mut marker = json!({});
    if !changed.is_empty() {
        marker[IDENTIFICATION_MARKER] = json!({
            "at": now,
            "by": auth.user_id,
            "kind": kind.as_str(),
            "hash": value_marker(lead_id, IDENTIFICATION_MARKER, Some(&next.marker_value())),
        });
    }
    if statements_changed.contains(&"request_reason") {
        marker["request_reason"] = json!({ "at": now, "by": auth.user_id, "kind": kind.as_str() });
    }
    if statements_changed
        .iter()
        .any(|key| *key != "request_reason")
    {
        marker[STATEMENTS_MARKER] = json!({
            "at": now,
            "by": auth.user_id,
            "kind": kind.as_str(),
            "hash": value_marker(
                lead_id,
                STATEMENTS_MARKER,
                Some(&format!("{}|{}", statements_changed.join(","), now)),
            ),
        });
    }
    let changed: Vec<&str> = changed.into_iter().chain(statements_changed).collect();
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

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ConsentChoicesRequest {
    choices: consent_choices::ConsentChoices,
    /// The persons or institutions named for "named recipients" (owner
    /// 2026-10-12). Since 2026-10-14 the cabinet sends none and the lead's
    /// trusted persons are taken; a list sent replaces them.
    #[serde(default)]
    recipients: Vec<consent_choices::ConsentRecipient>,
    /// [`consent_choices::TEXT_VERSION`] of the texts the person saw.
    version: String,
    language: String,
}

/// The cabinet's view of the person's own choice of the consent form options.
/// `chosen_by_me` says whether the viewer's login saved it: a choice the
/// other parent saved is not shown as the viewer's own (QA 2026-10-12, A3-01).
fn consent_form_json(choice: Option<&consent_choices::OwnConsentChoice>, viewer: Uuid) -> Value {
    // The first disclosure decision does not answer the core/channel questions.
    let core_choice = choice.filter(|c| c.disclosure.is_none() || c.choices.has_core());
    json!({
        "version": consent_choices::TEXT_VERSION,
        "choices": core_choice.map(|choice| choice.choices),
        "recipients": choice.map(|choice| choice.recipients.clone()).unwrap_or_default(),
        "max_recipients": consent_choices::MAX_RECIPIENTS,
        "chosen_at": core_choice.map(|choice| choice.chosen_at),
        "chosen_by_me": core_choice.map(|choice| choice.chosen_by == Some(viewer)),
    })
}

/// `POST /me/lead-requests/{lead_id}/consent-choices`: the person's own
/// choice of the options of the consent form «Einverständniserklärung zur
/// Datenübermittlung» (2026-10-12). Every save is a new row; the newest
/// counts. Only the person (or the parent / guardian with access) chooses —
/// staff have no route to set or change it, so a generated form never shows
/// a box ticked by staff. A form generated earlier keeps its choice and is no
/// longer sent for an electronic signature (`consent_choice_changed`).
async fn save_consent_choices(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(lead_id): Path<Uuid>,
    Json(body): Json<ConsentChoicesRequest>,
) -> axum::response::Response {
    if let Err(response) = require_patient(&auth) {
        return response;
    }
    if body.version != consent_choices::TEXT_VERSION {
        return coded(
            StatusCode::CONFLICT,
            "consent_version_outdated",
            "The consent text has changed; reload the page",
            json!({ "version": consent_choices::TEXT_VERSION }),
        );
    }
    let language = body.language.trim().to_lowercase();
    if !CONSENT_LANGUAGES.contains(&language.as_str()) {
        return err(StatusCode::UNPROCESSABLE_ENTITY, "Unsupported language");
    }
    // An empty or partial "choice" is no consent (QA 2026-10-12, A2-02): the
    // three consents the service runs on are part of every saved choice; who
    // does not give them saves nothing and the form goes on paper.
    if !body.choices.has_core() {
        return coded(
            StatusCode::UNPROCESSABLE_ENTITY,
            consent_choices::CORE_REQUIRED,
            "The three consents the service needs must be ticked",
            json!({ "required": ["agency_processing", "doctors_to_agency", "data_system"] }),
        );
    }
    // "Named recipients" names somebody (owner 2026-10-12); the list is part
    // of the choice and printed only while that option is chosen. Since
    // 2026-10-14 the cabinet sends none and the canonical scoped list is taken.
    // An older client may repeat an unchanged historical list, but cannot
    // enable a release or change its recipients through this route.
    let recipients_refusal = |code: &str| {
        coded(
            StatusCode::UNPROCESSABLE_ENTITY,
            code,
            "Name at least one trusted person (at most five) under «Trusted persons»: name, who they are, optionally how to reach them",
            json!({ "field": consent_choices::persons_error_field(code, "recipients"), "max": consent_choices::MAX_RECIPIENTS }),
        )
    };
    let sent_recipients = if body.choices.named_recipients {
        match consent_choices::clean_persons(body.recipients) {
            Ok(recipients) => recipients,
            Err(code) => return recipients_refusal(code),
        }
    } else {
        Vec::new()
    };
    let mut tx = match state.db.begin().await {
        Ok(tx) => tx,
        Err(error) => return internal(error, "begin"),
    };
    let (kind, row) = match lock_my_lead(&mut tx, lead_id, auth.user_id).await {
        Ok(Some(found)) => found,
        Ok(None) => return not_found(),
        Err(error) => return internal(error, "lock request"),
    };
    // For a minor only a parent or the guardian chooses — the child's form
    // names and is signed by the one who chose (QA 2026-10-12, A3-01). The
    // lead's own login of a minor (before any parent has access) saves
    // nothing; a choice it saved earlier never counts for the child.
    if kind == AccessKind::Own
        && crate::routes::leads::is_minor_on(
            PersonalData::from_row(&row).date_of_birth,
            crate::app_time::today(),
        )
    {
        return coded(
            StatusCode::CONFLICT,
            consent_choices::BY_GUARDIAN,
            "For a minor, a parent or the legal guardian chooses with their own access",
            json!({}),
        );
    }
    let from_trusted_persons = body.choices.named_recipients && sent_recipients.is_empty();
    let current = match consent_choices::current_for(&mut *tx, Some(lead_id), None).await {
        Ok(current) => current,
        Err(error) => return internal(error, "load disclosure decision"),
    };
    let disclosure = current.as_ref().and_then(|c| c.disclosure.clone());
    if let Some(d) = &disclosure
        && body.choices.named_recipients != (d.allow_disclosure && d.consent_given)
    {
        return coded(
            StatusCode::CONFLICT,
            "disclosure_choice_changed",
            "Reload the current disclosure decision; change it on Auskunft an Dritte",
            json!({}),
        );
    }
    let listed = if from_trusted_persons {
        match load_trusted_persons(&mut *tx, lead_id).await {
            Ok(persons) => persons,
            Err(error) => return internal(error, "load trusted persons"),
        }
    } else {
        sent_recipients
    };
    let recipients = match consent_choices::clean_recipients(&body.choices, listed) {
        Ok(recipients) => recipients,
        Err(code) => return recipients_refusal(code),
    };
    // A core/channel checkbox save cannot widen the separately scoped release.
    // Keep an unchanged legacy choice, but never infer the new explicit consent.
    if body.choices.named_recipients {
        let permitted = current.as_ref().is_some_and(|c| {
            c.recipients == recipients
                && match &c.disclosure {
                    Some(d) => d.allow_disclosure && d.consent_given,
                    None => c.choices.named_recipients,
                }
        });
        if !permitted {
            return coded(
                StatusCode::UNPROCESSABLE_ENTITY,
                consent_choices::DISCLOSURE_REQUIRED,
                "Confirm the people, scope and explicit consent under Auskunft an Dritte",
                json!({}),
            );
        }
    }
    let recipients_json = match serde_json::to_value(&recipients) {
        Ok(value) => value,
        Err(error) => return internal(error, "encode recipients"),
    };
    // A compatible older client can repeat only the already authorized list.
    if body.choices.named_recipients
        && !from_trusted_persons
        && let Err(error) = sqlx::query(
            "UPDATE leads SET portal_trusted_persons = $2, updated_at = now() WHERE id = $1",
        )
        .bind(lead_id)
        .bind(&recipients_json)
        .execute(&mut *tx)
        .await
    {
        return internal(error, "store trusted persons");
    }
    let choices = match serde_json::to_value(body.choices) {
        Ok(value) => value,
        Err(error) => return internal(error, "encode choices"),
    };
    let (choice_id, chosen_at): (Uuid, DateTime<Utc>) = match sqlx::query_as(
        r#"INSERT INTO consent_form_choices (
               template_id, lead_id, patient_id, choices, chosen_by, access_kind,
               source, language, text_version, recipients, chosen_at, disclosure)
           SELECT $1, l.id, l.prospect_patient_id, $2, $3, $4, 'lead_portal', $5, $6, $8, clock_timestamp(), $9
           FROM leads l WHERE l.id = $7
           RETURNING id, chosen_at"#,
    )
    .bind(consent_choices::TEMPLATE)
    .bind(&choices)
    .bind(auth.user_id)
    .bind(kind.as_str())
    .bind(&language)
    .bind(consent_choices::TEXT_VERSION)
    .bind(lead_id)
    .bind(&recipients_json)
    .bind(disclosure.as_ref().map(|d| json!(d)))
    .fetch_one(&mut *tx)
    .await
    {
        Ok(row) => row,
        Err(error) => return internal(error, "insert consent choices"),
    };
    if let Err(error) = audit::write_in_transaction(
        &mut tx,
        &audit::domain_event(
            "lead_portal_consent_choices_saved",
            Some(auth.user_id),
            "lead",
            Some(lead_id),
            json!({
                "consent_form_choice_id": choice_id,
                "template": consent_choices::TEMPLATE,
                "choices": choices,
                // Names stay out of the audit trail (erasure); the choice row keeps them.
                "recipients_count": recipients.len(),
                "text_version": consent_choices::TEXT_VERSION,
                "language": language,
                "access_kind": kind.as_str(),
            }),
        ),
    )
    .await
    {
        return internal(error, "audit consent choices");
    }
    if let Err(error) = sqlx::query("UPDATE leads SET portal_field_updates = portal_field_updates || jsonb_build_object('consent_form', jsonb_build_object('at', $2::timestamptz)), updated_at = now() WHERE id = $1")
        .bind(lead_id).bind(chosen_at).execute(&mut *tx).await {
        return internal(error, "mark consent choice update");
    }
    let (invalidated_count, invalidated) =
        match crate::document_signatures::invalidate_consent_choices(
            &mut tx,
            lead_id,
            auth.user_id,
            false,
        )
        .await
        {
            Ok(requests) => requests,
            Err(error) => return internal(error, "invalidate earlier consent invitations"),
        };
    if let Err(error) = tx.commit().await {
        return internal(error, "commit consent choices");
    }
    if invalidated_count > 0 {
        notify_lead_staff(&state, lead_id, "lead_consent_choice_changed", "Consent choice changed", "The patient changed the consent choice. Create a new consent document and signature invitation.").await;
        let signature_state = state.clone();
        tokio::spawn(async move {
            crate::document_signatures::withdraw_invalidated_consents(
                &signature_state,
                &invalidated,
            )
            .await;
        });
    }
    crate::realtime::publish_lead_event(
        &state,
        Some(auth.user_id),
        "lead.portal_updated",
        lead_id,
        json!({ "change": "consent_choices_saved", "access_kind": kind.as_str() }),
    )
    .await;
    let saved = consent_choices::OwnConsentChoice {
        id: choice_id,
        choices: body.choices,
        recipients,
        disclosure,
        chosen_at,
        source: "lead_portal".into(),
        access_kind: Some(kind.as_str().to_string()),
        chosen_by: Some(auth.user_id),
        chosen_by_name: None,
        chosen_by_role: None,
        chosen_by_emails: Vec::new(),
        lead_id: Some(lead_id),
    };
    (
        StatusCode::CREATED,
        Json(consent_form_json(Some(&saved), auth.user_id)),
    )
        .into_response()
}

/// The trusted persons the cabinet keeps on the lead
/// (`leads.portal_trusted_persons`, owner 2026-10-14); empty for an unknown
/// lead or an unreadable value.
pub(crate) async fn load_trusted_persons<'e, E>(
    executor: E,
    lead_id: Uuid,
) -> Result<Vec<consent_choices::ConsentRecipient>, sqlx::Error>
where
    E: sqlx::Executor<'e, Database = sqlx::Postgres>,
{
    let stored: Option<Value> =
        sqlx::query_scalar("SELECT portal_trusted_persons FROM leads WHERE id = $1")
            .bind(lead_id)
            .fetch_optional(executor)
            .await?;
    Ok(stored
        .and_then(|value| serde_json::from_value(value).ok())
        .unwrap_or_default())
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct TrustedPersonsRequest {
    /// The whole list, at most [`consent_choices::MAX_RECIPIENTS`].
    persons: Vec<consent_choices::ConsentRecipient>,
    allow_disclosure: bool,
    consent_given: bool,
    version: String,
    language: String,
}

async fn disclosure_company_name<'e, E>(executor: E) -> Result<String, sqlx::Error>
where
    E: sqlx::PgExecutor<'e>,
{
    let name: Option<Option<String>> =
        sqlx::query_scalar("SELECT value #>> '{}' FROM system_settings WHERE key = 'agency_name'")
            .fetch_optional(executor)
            .await?;
    Ok(name
        .flatten()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "GMED".into()))
}

/// `POST /me/lead-requests/{lead_id}/trusted-persons`: the lead's trusted
/// persons (owner 2026-10-14) — people GMED may tell about the person (or
/// the child): name, relationship, contact and scope, with an explicit
/// Yes/No decision and separate consent. They have
/// access to information only and never act for the person (who acts is the
/// representation of step 1). Not sanctions-screened, not trusted contacts.
///
/// Every save appends an immutable decision; core/channel flags stay as they
/// were. Earlier signature invitations are invalidated. Legacy lists never
/// imply agreement to the new text.
async fn save_trusted_persons(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(lead_id): Path<Uuid>,
    Json(body): Json<TrustedPersonsRequest>,
) -> axum::response::Response {
    if let Err(response) = require_patient(&auth) {
        return response;
    }
    if body.version != consent_choices::DISCLOSURE_VERSION {
        return coded(
            StatusCode::CONFLICT,
            "disclosure_version_outdated",
            "Reload the updated disclosure text",
            json!({ "version": consent_choices::DISCLOSURE_VERSION }),
        );
    }
    let language = body.language.trim().to_lowercase();
    if !CONSENT_LANGUAGES.contains(&language.as_str()) {
        return err(StatusCode::UNPROCESSABLE_ENTITY, "Unsupported language");
    }
    if !body.allow_disclosure && (!body.persons.is_empty() || body.consent_given) {
        return coded(
            StatusCode::UNPROCESSABLE_ENTITY,
            "disclosure_decision_invalid",
            "No disclosure means no named recipients or consent",
            json!({}),
        );
    }
    if body.allow_disclosure && !body.consent_given {
        return coded(
            StatusCode::UNPROCESSABLE_ENTITY,
            consent_choices::DISCLOSURE_REQUIRED,
            "Explicit consent to the named people and stated scope is required",
            json!({}),
        );
    }
    let persons = match consent_choices::clean_persons(body.persons) {
        Ok(persons) => persons,
        Err(code) => {
            return coded(
                StatusCode::UNPROCESSABLE_ENTITY,
                code,
                "At most five trusted persons: name, who they are, optionally how to reach them",
                json!({ "field": consent_choices::persons_error_field(code, "persons"), "max": consent_choices::MAX_RECIPIENTS }),
            );
        }
    };
    if body.allow_disclosure && persons.is_empty() {
        return coded(
            StatusCode::UNPROCESSABLE_ENTITY,
            consent_choices::RECIPIENTS_REQUIRED,
            "Name at least one person",
            json!({}),
        );
    }
    // The optional contact is a phone number or an e-mail address (QA 2026-10-22).
    if persons.iter().any(|person| {
        person
            .contact
            .as_deref()
            .is_some_and(|contact| !consent_choices::recipient_contact_valid(contact))
    }) {
        return coded(
            StatusCode::UNPROCESSABLE_ENTITY,
            consent_choices::RECIPIENTS_INVALID,
            "The contact of a person is a phone number or an e-mail address",
            json!({ "field": "contact" }),
        );
    }
    // The scope is chosen from fixed options (owner 2026-10-19); a person
    // with only a legacy free text is asked again.
    if persons.iter().any(|p| p.scope_codes.is_empty()) {
        return coded(
            StatusCode::UNPROCESSABLE_ENTITY,
            consent_choices::RECIPIENTS_INVALID,
            "Choose the scope of information for each person",
            json!({ "field": "scope_codes" }),
        );
    }
    let persons_json = match serde_json::to_value(&persons) {
        Ok(value) => value,
        Err(error) => return internal(error, "encode trusted persons"),
    };
    let mut tx = match state.db.begin().await {
        Ok(tx) => tx,
        Err(error) => return internal(error, "begin"),
    };
    // The own login of a minor never gets here: the middleware refuses it
    // (`lead_request_guardian_only`) and the lock does not resolve it.
    let (kind, lead_row) = match lock_my_lead(&mut tx, lead_id, auth.user_id).await {
        Ok(Some(found)) => found,
        Ok(None) => return not_found(),
        Err(error) => return internal(error, "lock request"),
    };
    // A parent consents for the child's data, a representative for the
    // represented person's: the stored text says so (like the child's Anlage 1).
    let subject = consent_choices::DisclosureSubject::of(
        kind.as_str(),
        crate::routes::leads::is_minor_on(
            lead_row
                .try_get::<Option<NaiveDate>, _>("date_of_birth")
                .ok()
                .flatten(),
            crate::app_time::today(),
        ),
    );
    let current = match consent_choices::current_for(&mut *tx, Some(lead_id), None).await {
        Ok(current) => current,
        Err(error) => return internal(error, "load consent choice"),
    };
    let company_name = match disclosure_company_name(&mut *tx).await {
        Ok(name) => name,
        Err(error) => return internal(error, "load disclosure company"),
    };
    if let Err(error) = sqlx::query(
        "UPDATE leads SET portal_trusted_persons = $2, updated_at = now() WHERE id = $1",
    )
    .bind(lead_id)
    .bind(&persons_json)
    .execute(&mut *tx)
    .await
    {
        return internal(error, "store trusted persons");
    }
    let now = match portal_update_time(&mut tx).await {
        Ok(now) => now,
        Err(error) => return internal(error, "read portal update time"),
    };
    let disclosure = consent_choices::DisclosureDecision {
        allow_disclosure: body.allow_disclosure,
        consent_given: body.consent_given,
        version: body.version,
        language: language.clone(),
        chosen_at: now,
        chosen_by: auth.user_id,
        chosen_by_name: match sqlx::query_scalar("SELECT name FROM users WHERE id = $1")
            .bind(auth.user_id)
            .fetch_optional(&mut *tx)
            .await
        {
            Ok(name) => name,
            Err(error) => return internal(error, "load disclosure chooser"),
        },
        access_kind: kind.as_str().into(),
        consent_text: consent_choices::disclosure_consent_text_for(
            &language,
            &company_name,
            subject,
        ),
        company_name,
    };
    let marker = json!({
        TRUSTED_PERSONS_MARKER: {
            "at": now,
            "by": auth.user_id,
            "kind": kind.as_str(),
            "hash": value_marker(lead_id, TRUSTED_PERSONS_MARKER, Some(&persons_json.to_string())),
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
        return internal(error, "mark trusted persons");
    }
    if let Err(error) = audit::write_in_transaction(
        &mut tx,
        &audit::domain_event(
            "lead_portal_trusted_persons_saved",
            Some(auth.user_id),
            "lead",
            Some(lead_id),
            // Names stay out of the audit trail (erasure).
            json!({ "count": persons.len(), "access_kind": kind.as_str(), "allow_disclosure": body.allow_disclosure,
                "consent_given": body.consent_given, "text_version": consent_choices::DISCLOSURE_VERSION, "language": language }),
        ),
    )
    .await
    {
        return internal(error, "audit trusted persons");
    }
    // Disclosure is independent of the three core consents. Keep their exact
    // answers; an initial disclosure-only choice cannot pass electronic signing.
    let mut choices = current.as_ref().map(|c| c.choices).unwrap_or_default();
    choices.named_recipients = body.allow_disclosure;
    if let Err(error) = sqlx::query(
        r#"INSERT INTO consent_form_choices (
                   template_id, lead_id, patient_id, choices, chosen_by, access_kind,
                   source, language, text_version, recipients, chosen_at, disclosure)
               SELECT $1, l.id, l.prospect_patient_id, $6, $3, $4,
                      'lead_portal', $7, $8, $5, $9, $10
               FROM leads l WHERE l.id = $2"#,
    )
    .bind(consent_choices::TEMPLATE)
    .bind(lead_id)
    .bind(auth.user_id)
    .bind(kind.as_str())
    .bind(&persons_json)
    .bind(json!(choices))
    .bind(&language)
    .bind(consent_choices::TEXT_VERSION)
    .bind(now)
    .bind(json!(disclosure))
    .execute(&mut *tx)
    .await
    {
        return internal(error, "insert consent choices");
    }
    let invalidated = match crate::document_signatures::invalidate_consent_choices(
        &mut tx,
        lead_id,
        auth.user_id,
        true,
    )
    .await
    {
        Ok(requests) => requests,
        Err(error) => return internal(error, "invalidate earlier consent invitations"),
    };
    if let Err(error) = tx.commit().await {
        return internal(error, "commit trusted persons");
    }
    let (invalidated_count, invalidated) = invalidated;
    if invalidated_count > 0 {
        notify_lead_staff(
            &state,
            lead_id,
            "lead_consent_choice_changed",
            "Consent choice changed",
            "The patient changed the consent choice. Create a new consent document and signature invitation.",
        )
        .await;
        let signature_state = state.clone();
        tokio::spawn(async move {
            crate::document_signatures::withdraw_invalidated_consents(
                &signature_state,
                &invalidated,
            )
            .await;
        });
    }
    crate::realtime::publish_lead_event(
        &state,
        Some(auth.user_id),
        "lead.portal_updated",
        lead_id,
        json!({ "change": "trusted_persons", "access_kind": kind.as_str() }),
    )
    .await;
    match request_payload(&state, lead_id, auth.user_id, kind).await {
        Ok(payload) => Json(payload).into_response(),
        Err(error) => internal(error, "load request"),
    }
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
    let (title, body, consent) = match purpose {
        ConsentPurpose::HealthData => (
            "Patient withdrew the consent to process health data",
            "The patient withdrew the consent in the portal (health data). Decide on the documents already uploaded.",
            "health_data",
        ),
        ConsentPurpose::InquiryProcessing => (
            "Patient withdrew the consent to process the request data",
            "The patient withdrew the consent in the portal (request data). Decide how to continue with the request.",
            "inquiry_processing",
        ),
    };
    notify_lead_staff_with(
        &state,
        lead_id,
        "lead_portal_consent_revoked",
        title,
        body,
        Some(json!({ "consent": consent })),
    )
    .await;
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

/// `POST /me/lead-requests/{lead_id}/funds-proof` (multipart `file`): the
/// self-payer's proof of the source of funds (bank statement, salary slip …;
/// PDF, JPG or PNG). Like the identity document it needs the consent to
/// process the request data; only while the patient pays himself (409
/// `payer_not_self`). Withdrawn through the cabinet's DELETE.
async fn upload_my_funds_proof(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(lead_id): Path<Uuid>,
    multipart: Multipart,
) -> axum::response::Response {
    store_my_upload(
        state,
        auth,
        lead_id,
        multipart,
        UploadKind::SelfFundsProof,
        None,
    )
    .await
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
    // A proof of the own funds exists only while the patient pays himself.
    if upload_kind == UploadKind::SelfFundsProof {
        let self_payer = match state.db.acquire().await {
            Ok(mut conn) => pays_himself(&mut conn, lead_id).await,
            Err(error) => Err(error),
        };
        match self_payer {
            Ok(true) => {}
            Ok(false) => return payer_not_self(),
            Err(error) => return internal(error, "load payer"),
        }
    }
    // A proof of the relationship exists only while a third party pays.
    if upload_kind == UploadKind::RelationshipProof {
        let third_party = match state.db.acquire().await {
            Ok(mut conn) => lead_payer::load_declaration(&mut conn, lead_id)
                .await
                .map(|payer| payer.is_some_and(|payer| payer.is_third_party())),
            Err(error) => Err(error),
        };
        match third_party {
            Ok(true) => {}
            Ok(false) => {
                return coded(
                    StatusCode::CONFLICT,
                    "payer_not_third_party",
                    "The proof of the relationship is asked when another person pays",
                    json!({}),
                );
            }
            Err(error) => return internal(error, "load payer"),
        }
    }
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
             AND u.kind NOT IN ('payer_identity', 'payer_funds_proof') AND u.access_kind <> 'staff'"#,
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

    let person = representative
        .as_ref()
        .map(|(_, name)| name.as_str())
        .unwrap_or_default();
    let StoredUpload {
        document_id,
        file_size,
        storage_key,
        mime_type,
    } = match store_upload_document(
        &state,
        lead_id,
        upload_kind,
        person,
        &file_name,
        content_type.as_deref(),
        &data,
        auth.user_id,
        false,
    )
    .await
    {
        Ok(stored) => stored,
        Err(response) => return response,
    };
    let medical = upload_kind == UploadKind::Medical;

    // The upload is registered with its consent in one transaction; if the
    // link or the consent went away meanwhile, the stored file goes again.
    let mut upload_limit_reached = false;
    let registered = async {
        let mut tx = state.db.begin().await?;
        let Some((kind, _)) = lock_my_lead(&mut tx, lead_id, auth.user_id).await? else {
            return Ok::<_, sqlx::Error>(None);
        };
        let count: i64 = sqlx::query_scalar(
            "SELECT count(*) FROM lead_portal_uploads u
             JOIN documents d ON d.id = u.document_id
             WHERE u.lead_id = $1 AND u.withdrawn_at IS NULL AND d.file_deleted_at IS NULL
               AND u.kind NOT IN ('payer_identity', 'payer_funds_proof') AND u.access_kind <> 'staff'",
        )
        .bind(lead_id)
        .fetch_one(&mut *tx)
        .await?;
        if count >= MAX_PORTAL_UPLOADS {
            upload_limit_reached = true;
            return Ok(None);
        }
        let uploaded_at = portal_update_time(&mut tx).await?;
        let Some((consent_id, _)) =
            active_consent(&mut *tx, lead_id, auth.user_id, consent_purpose).await?
        else {
            return Ok(None);
        };
        // Who pays may have changed meanwhile.
        if upload_kind == UploadKind::SelfFundsProof && !pays_himself(&mut tx, lead_id).await? {
            return Ok(None);
        }
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
                    representative_id, created_at)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8)"#,
        )
        .bind(document_id)
        .bind(lead_id)
        .bind(auth.user_id)
        .bind(kind.as_str())
        .bind(consent_id)
        .bind(upload_kind.as_str())
        .bind(representative.as_ref().map(|(id, _)| *id))
        .bind(uploaded_at)
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
            return if upload_limit_reached {
                coded(
                    StatusCode::UNPROCESSABLE_ENTITY,
                    "too_many_documents",
                    "No more documents can be uploaded",
                    json!({ "max": MAX_PORTAL_UPLOADS }),
                )
            } else {
                not_found()
            };
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

/// A lead upload stored as a document, not registered yet.
pub(crate) struct StoredUpload {
    pub document_id: Uuid,
    pub file_size: i64,
    pub storage_key: String,
    pub mime_type: String,
}

/// Checks the file of a lead upload and stores it as a document of the lead,
/// named and typed by its kind (`person`: the representative a file of a
/// representative is named after). Shared by the cabinet and by staff
/// uploading a representative's file in the wizard (`by_staff`: the document
/// does not claim the cabinet as its origin). The caller registers it in
/// `lead_portal_uploads` or discards it again.
#[allow(clippy::too_many_arguments)]
pub(crate) async fn store_upload_document(
    state: &AppState,
    lead_id: Uuid,
    upload_kind: UploadKind,
    person: &str,
    file_name: &str,
    content_type: Option<&str>,
    data: &[u8],
    uploaded_by: Uuid,
    by_staff: bool,
) -> Result<StoredUpload, axum::response::Response> {
    // Same checks as the files of the website questionnaire: the content must
    // match the file type, and the malware scan must not object.
    let mime_type =
        crate::routes::leads::validate_lead_attachment(file_name, content_type, data).await?;
    let medical = upload_kind == UploadKind::Medical;
    if !medical && !IDENTITY_DOCUMENT_MIME_TYPES.contains(&mime_type.as_str()) {
        return Err(coded(
            StatusCode::UNPROCESSABLE_ENTITY,
            "unsupported_file_type",
            if matches!(
                upload_kind,
                UploadKind::SelfFundsProof | UploadKind::RelationshipProof
            ) {
                "Upload the document as PDF, JPG or PNG"
            } else {
                "Upload the identity document as PDF, JPG or PNG"
            },
            json!({}),
        ));
    }
    // A copy of the lead's identity document is stored like the one staff
    // upload in the wizard (`identity`), so the identity check finds it. The
    // files of a representative have a document type of their own: they are
    // never the lead's identity document.
    let (auto_name, art, category, access_category) = match upload_kind {
        UploadKind::Medical => (
            file_name.to_string(),
            "patient_medical_upload",
            "medical",
            "medical",
        ),
        // German names, like every document of the lead: the staff UI shows
        // them in pickers and lists (QA 2026-10-10).
        UploadKind::Identity => (
            "Ausweisdokument".to_string(),
            "identity",
            "identity",
            "internal",
        ),
        UploadKind::RepresentativeIdentity => (
            format!("Ausweisdokument – {person}"),
            lead_representatives::UPLOAD_IDENTITY,
            "identity",
            "internal",
        ),
        UploadKind::RepresentativeAuthority => (
            format!("Vertretungsnachweis – {person}"),
            lead_representatives::UPLOAD_AUTHORITY,
            "administrative",
            "internal",
        ),
        // A financial document of the patient's own: neither an identity
        // document nor an administrative one, so it never fulfils the
        // patient's required documents (passport, consent form).
        UploadKind::SelfFundsProof => (
            "Nachweis der Mittelherkunft".to_string(),
            SELF_FUNDS_PROOF_KIND,
            "finance",
            "financial",
        ),
        UploadKind::RelationshipProof => (
            "Nachweis der Beziehung zum Kostenübernehmer".to_string(),
            RELATIONSHIP_PROOF_KIND,
            "administrative",
            "internal",
        ),
        UploadKind::PayerIdentity | UploadKind::PayerFundsProof => return Err(not_found()),
    };
    let input = NewStoredDocument {
        document_id: None,
        document_number: None,
        patient_id: None,
        lead_id: Some(lead_id),
        order_id: None,
        appointment_id: None,
        auto_name: &auto_name,
        original_filename: file_name,
        art,
        category: Some(category),
        status: "active",
        visibility: "internal",
        is_medical: medical,
        mime_type: &mime_type,
        klinik: None,
        ursprung: (!by_staff).then_some("lead_portal"),
        notes: None,
        document_direction: Some("incoming"),
        document_variant: Some("original"),
        document_language: None,
        access_category: Some(access_category),
        document_date: Some(crate::app_time::today()),
        source_person: (!by_staff).then_some("patient_portal"),
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
        uploaded_by,
    };
    let (document_id, file_size, _, storage_key) =
        persist_document_file(state, data, &input).await?;
    Ok(StoredUpload {
        document_id,
        file_size,
        storage_key,
        mime_type,
    })
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
                  COALESCE(u.created_at <= CASE u.kind
                    WHEN 'identity' THEN (SELECT g.id_data_entered_at FROM lead_gwg_declarations g WHERE g.lead_id = u.lead_id)
                    WHEN 'representative_identity' THEN (SELECT r.id_data_entered_at FROM lead_representatives r WHERE r.lead_id = u.lead_id AND r.contact_id = u.representative_id)
                  END, false) AS identity_in_use,
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
    let identity_in_use = upload
        .try_get::<bool, _>("identity_in_use")
        .unwrap_or(false);
    if reviewed || in_use || identity_in_use {
        return coded(
            StatusCode::CONFLICT,
            if identity_in_use {
                "upload_in_use"
            } else {
                "upload_reviewed"
            },
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
        // What was derived from the file goes with it, translations made as
        // documents of their own included (same procedure as a deleted file).
        let derived = crate::routes::documents::purge_document_derived_content_in_tx(
            &mut tx,
            &[document_id],
            Some(auth.user_id),
        )
        .await?;
        let withdrawn_at = portal_update_time(&mut tx).await?;
        sqlx::query("UPDATE lead_portal_uploads SET withdrawn_at = $2 WHERE document_id = $1")
            .bind(document_id)
            .bind(withdrawn_at)
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
                    "derived_content_removed": derived,
                }),
            ),
        )
        .await?;
        tx.commit().await?;
        Ok::<_, sqlx::Error>(derived)
    }
    .await;
    let derived = match result {
        Ok(derived) => derived,
        Err(error) => {
            if let Some(staged) = staged.as_ref() {
                crate::routes::documents::rollback_staged_document_delete(staged).await;
            }
            return internal(error, "withdraw upload");
        }
    };
    if let Some(staged) = staged.as_ref() {
        crate::routes::documents::finalize_staged_document_delete(staged).await;
    }
    for storage_key in &derived.translated_document_files {
        crate::routes::documents::remove_document_blob(storage_key).await;
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
    // Retrying an unchanged submission must not change the declaration time,
    // enqueue notifications or recompute risk.
    if row
        .try_get::<Option<DateTime<Utc>>, _>("portal_submitted_at")
        .ok()
        .flatten()
        .is_some()
        && !row
            .try_get::<bool, _>("changed_since_submit")
            .unwrap_or(true)
    {
        drop(tx);
        return match request_payload(&state, lead_id, auth.user_id, kind).await {
            Ok(payload) => Json(payload).into_response(),
            Err(error) => internal(error, "load submitted request"),
        };
    }
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
    let extra = match extra_state(
        &mut tx,
        lead_id,
        payer.as_ref(),
        &representation.representation,
        Some(auth.user_id),
    )
    .await
    {
        Ok(extra) => extra,
        Err(error) => return internal(error, "load extra questions"),
    };
    let base = match crate::risk::cabinet::base_extra(&mut tx, lead_id, payer.as_ref()).await {
        Ok(base) => base,
        Err(error) => return internal(error, "load request reason"),
    };
    let stored_recipient = match lead_invoice_recipient::load(&mut tx, lead_id).await {
        Ok(stored) => stored,
        Err(error) => return internal(error, "load invoice recipient"),
    };
    let paying_parent =
        lead_representatives::payer_same_person(&representation.representation, payer.as_ref())
            .is_some();
    let today = crate::app_time::today();
    let mut recipient = stored_recipient.unwrap_or_default();
    let _ = lead_invoice_recipient::resolve_parent(&mut recipient, &representation.representation);
    let mut missing = with_invoice_recipient(
        missing_for_submit(
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
            extra,
            today,
            &base,
        ),
        &recipient,
        payer.as_ref(),
        paying_parent,
        identification
            .payment_background
            .as_deref()
            .is_some_and(|reason| !reason.trim().is_empty()),
    );
    missing.extend(lead_invoice_recipient::parent_recipient_missing(
        &recipient,
        &representation.representation,
    ));
    if !missing.is_empty() {
        return coded(
            StatusCode::UNPROCESSABLE_ENTITY,
            "personal_data_incomplete",
            "Please complete the personal data first",
            json!({ "missing": missing }),
        );
    }
    // A listed-country questionnaire is part of the first submission. Its
    // live preview has no stored risk score, but direct API callers must answer
    // the same questions the cabinet shows before submitting the base form.
    let follow_up = match crate::risk::cabinet::follow_up_json(&mut tx, lead_id, auth.user_id).await
    {
        Ok(follow_up) => follow_up,
        Err(error) => return internal(error, "load pre-submission country questions"),
    };
    if follow_up["before_submit"] == json!(true) {
        let open: Map<String, Value> = follow_up["missing"]
            .as_object()
            .map(|missing| {
                missing
                    .iter()
                    .filter(|(_, keys)| keys.as_array().is_some_and(|keys| !keys.is_empty()))
                    .map(|(block, keys)| (block.clone(), keys.clone()))
                    .collect()
            })
            .unwrap_or_default();
        if !open.is_empty() {
            return coded(
                StatusCode::UNPROCESSABLE_ENTITY,
                "follow_up_incomplete",
                "Please complete the additional information before sending your request",
                json!({ "missing": open, "before_submit": true }),
            );
        }
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
    let (documents, identity_documents, representative_documents, self_funds_documents): (
        i64,
        i64,
        i64,
        i64,
    ) = match sqlx::query_as(
        r#"SELECT count(*) FILTER (WHERE u.kind = 'medical'),
                      count(*) FILTER (WHERE u.kind = 'identity'),
                      count(*) FILTER (WHERE u.representative_id IS NOT NULL),
                      count(*) FILTER (WHERE u.kind = 'self_funds_proof')
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
    let submitted_at = match portal_update_time(&mut tx).await {
        Ok(now) => now,
        Err(error) => return internal(error, "read portal submission time"),
    };
    if let Err(error) = sqlx::query(
        r#"UPDATE leads
           SET portal_submitted_at = $3, portal_submitted_by = $2, updated_at = $3
           WHERE id = $1"#,
    )
    .bind(lead_id)
    .bind(auth.user_id)
    .bind(submitted_at)
    .execute(&mut *tx)
    .await
    {
        return internal(error, "mark submitted");
    }
    // The confirmation is recorded with the statements it covers (the row
    // exists: the required statements are in it). Same time as the send.
    if let Err(error) = sqlx::query(
        r#"UPDATE lead_gwg_declarations
           SET declared_correct_at = $3, declared_correct_by = $2
           WHERE lead_id = $1"#,
    )
    .bind(lead_id)
    .bind(auth.user_id)
    .bind(submitted_at)
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
                "self_funds_documents": self_funds_documents,
                "declared_correct": true,
                "inquiry_consent_record_id": inquiry_consent_id,
            }),
        ),
    )
    .await
    {
        return internal(error, "audit submit");
    }
    // "Send to the manager" starts the risk assessment (before it nothing is
    // scored, so a missing upload of a draft never counts).
    if let Err(error) = crate::risk::store::start(
        &mut tx,
        lead_id,
        crate::risk::store::Cause::Cabinet,
        Some(auth.user_id),
        false,
    )
    .await
    {
        return internal(error, "start risk assessment");
    }
    // Follow-up blocks the lead completed before sending are sent with it
    // (QA 2026-10-10, C2-c): no second "send the details".
    if let Err(error) =
        crate::risk::cabinet::answer_complete_follow_up(&mut tx, lead_id, auth.user_id).await
    {
        return internal(error, "record follow-up");
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
    notify_lead_staff_with(
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
        Some(json!({
            "filled": data.filled_count(),
            "total": PROGRESS_FIELDS.len(),
            "documents": documents,
            "payer_link_ready": payer_link_ready,
        })),
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
const LEAD_NOTIFICATION_RECIPIENTS_SQL: &str = r#"WITH owner AS (
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
   UNION SELECT id FROM fallback"#;

/// A once-per-lead notice, including concurrent cabinet reads and retries.
/// The lead lock protects the recheck and the whole recipient batch; realtime
/// events are published only after the transaction commits.
async fn notify_lead_staff_once(
    state: &AppState,
    lead_id: Uuid,
    kind: &str,
    title: &str,
    body: &str,
    entered_minor_birth_date: bool,
) {
    let stored: Result<Vec<(Uuid, Uuid)>, sqlx::Error> = async {
        let mut tx = state.db.begin().await?;
        let lead = sqlx::query_scalar::<_, Uuid>("SELECT id FROM leads WHERE id = $1 FOR UPDATE")
            .bind(lead_id)
            .fetch_optional(&mut *tx)
            .await?;
        if lead.is_none() {
            return Ok(Vec::new());
        }
        if kind == "lead_portal_minor" {
            let still_missing: bool = sqlx::query_scalar(&format!(
                // An attempted under-18 DOB is deliberately not persisted.
                // That explicit report still needs a staff notice even while
                // the saved date remains adult or absent.
                "SELECT ($2 OR {OWN_LOGIN_CLOSED_SQL}) AND {PORTAL_LEAD_SQL}
                    AND NOT EXISTS (SELECT 1 FROM lead_portal_access a
                        WHERE a.lead_id = l.id AND a.kind = 'guardian' AND a.revoked_at IS NULL)
                 FROM leads l WHERE l.id = $1",
            ))
            .bind(lead_id)
            .bind(entered_minor_birth_date)
            .fetch_one(&mut *tx)
            .await?;
            if !still_missing {
                return Ok(Vec::new());
            }
        }
        let notified: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM user_notifications
             WHERE entity_type = 'lead' AND entity_id = $1 AND kind = $2
               AND ($2 <> 'lead_portal_minor' OR created_at >= COALESCE((
                   SELECT max(a.revoked_at) FROM lead_portal_access a
                   WHERE a.lead_id = $1 AND a.kind = 'guardian'
               ), '-infinity'::timestamptz)))",
        )
        .bind(lead_id)
        .bind(kind)
        .fetch_one(&mut *tx)
        .await?;
        if notified {
            return Ok(Vec::new());
        }
        let recipients: Vec<Uuid> = sqlx::query_scalar(LEAD_NOTIFICATION_RECIPIENTS_SQL)
            .bind(lead_id)
            .fetch_all(&mut *tx)
            .await?;
        let mut stored = Vec::with_capacity(recipients.len());
        for recipient in recipients {
            let notification_id: Uuid = sqlx::query_scalar(
                "INSERT INTO user_notifications (user_id, kind, title, body, entity_type, entity_id)
                 VALUES ($1, $2, $3, $4, 'lead', $5) RETURNING id",
            )
            .bind(recipient)
            .bind(kind)
            .bind(title)
            .bind(body)
            .bind(lead_id)
            .fetch_one(&mut *tx)
            .await?;
            stored.push((recipient, notification_id));
        }
        tx.commit().await?;
        Ok(stored)
    }
    .await;
    let stored = match stored {
        Ok(stored) => stored,
        Err(error) => {
            tracing::warn!(%error, %lead_id, kind, "store once-only lead portal notification");
            return;
        }
    };
    for (recipient, notification_id) in stored {
        crate::realtime::publish_notification_event(
            state,
            recipient,
            "notification.created",
            Some(notification_id),
            json!({ "entity_type": "lead", "entity_id": lead_id }),
        )
        .await;
    }
}

pub(crate) async fn notify_lead_staff(
    state: &AppState,
    lead_id: Uuid,
    kind: &str,
    title: &str,
    body: &str,
) {
    notify_lead_staff_with(state, lead_id, kind, title, body, None).await;
}

/// [`notify_lead_staff`] with the facts the UI words the notice from
/// (`user_notifications.params`); `title`/`body` stay the English fallback.
pub(crate) async fn notify_lead_staff_with(
    state: &AppState,
    lead_id: Uuid,
    kind: &str,
    title: &str,
    body: &str,
    params: Option<Value>,
) {
    let recipients: Vec<Uuid> = match sqlx::query_scalar(LEAD_NOTIFICATION_RECIPIENTS_SQL)
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
            r#"INSERT INTO user_notifications (user_id, kind, title, body, entity_type, entity_id, params)
               VALUES ($1, $2, $3, $4, 'lead', $5, $6)
               RETURNING id"#,
        )
        .bind(recipient)
        .bind(kind)
        .bind(title)
        .bind(body)
        .bind(lead_id)
        .bind(params.clone())
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
                  ({CHANGED_SINCE_SUBMIT_SQL}) AS changed_since_submit,
                  l.portal_trusted_persons,
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
    let staff_file = |upload: &&PgRow| {
        json!({
            "id": upload.try_get::<Uuid, _>("document_id").ok(),
            "file_name": upload_file_name(upload),
            "uploaded_at": upload.try_get::<DateTime<Utc>, _>("created_at").ok(),
            "reviewed": upload_taken_over(upload),
        })
    };
    let identity_documents: Vec<Value> = identity_uploads
        .iter()
        .filter(|_| statements_visible)
        .map(staff_file)
        .collect();
    // Who acts for the lead, for the same roles as the statements; with it
    // where the invoice goes and how the payer will pay (sections 7 and 8),
    // and the answers of the extra step with the self-payer's proofs: whether
    // the step is shown to the cabinet, which questions it asks, and when the
    // lead last changed the answers while they still are what the lead
    // entered. The proofs are listed also when another payer was named since.
    let (
        representation,
        representation_updated_at,
        billing,
        billing_updated_at,
        enhanced_details,
        payer_organisation,
    ) = if statements_visible {
        let loaded = match state.db.acquire().await {
            Ok(mut conn) => match lead_representatives::load(&mut conn, lead_id).await {
                Ok(loaded) => {
                    let loaded = loaded.unwrap_or_default();
                    match extra_state(
                        &mut conn,
                        lead_id,
                        declaration.as_ref(),
                        &loaded.representation,
                        None,
                    )
                    .await
                    {
                        // Block C's answers (the expected total, through whom a
                        // payment via a third party goes) beside section 8.
                        Ok(extra) => {
                            match crate::risk::cabinet::payer_extras(&mut conn, lead_id).await {
                                // The invoice recipient of step 3 (2026-10-11).
                                Ok((payer_extras, billing_extras)) => {
                                    lead_invoice_recipient::load(&mut conn, lead_id).await.map(
                                        |recipient| {
                                            (loaded, extra, payer_extras, billing_extras, recipient)
                                        },
                                    )
                                }
                                Err(error) => Err(error),
                            }
                        }
                        Err(error) => Err(error),
                    }
                }
                Err(error) => Err(error),
            },
            Err(error) => Err(error),
        };
        match loaded {
            Ok((loaded, extra, payer_extras, billing_extras, stored_recipient)) => {
                let route_by = payment_route_by(declaration.as_ref(), &loaded.representation, None);
                let updated_at = updates.get(ENHANCED_DETAILS_MARKER).and_then(|update| {
                    let current = value_marker(
                        lead_id,
                        ENHANCED_DETAILS_MARKER,
                        Some(&enhanced_marker_value(
                            declaration.as_ref(),
                            &identification,
                        )),
                    );
                    (update.get("hash").and_then(Value::as_str) == Some(current.as_str()))
                        .then(|| update.get("at").cloned())
                        .flatten()
                });
                let mut enhanced_details = extra.questions.to_json();
                enhanced_details["check_required"] = json!(extra.questions.check_required);
                enhanced_details["answers"] =
                    enhanced_answers_json(declaration.as_ref(), &identification);
                enhanced_details["funds_proof_documents"] = json!(
                    uploads_of(UploadKind::SelfFundsProof)
                        .iter()
                        .map(staff_file)
                        .collect::<Vec<_>>()
                );
                enhanced_details["updated_at"] = json!(updated_at);
                let follow_up = match state.db.acquire().await {
                    Ok(mut conn) => {
                        crate::risk::cabinet::follow_up_json(&mut conn, lead_id, auth.user_id).await
                    }
                    Err(error) => Err(error),
                };
                let follow_up = match follow_up {
                    Ok(value) => value,
                    Err(error) => return internal(error, "load relationship proof requirement"),
                };
                enhanced_details["relationship_proof_requested"] = json!(
                    declaration
                        .as_ref()
                        .is_some_and(|payer| payer.is_third_party())
                        && follow_up["blocks"]
                            .as_array()
                            .is_some_and(|blocks| blocks.iter().any(|block| block == "B"))
                );
                // What the former extra step would still ask (information for
                // staff; the cabinet asks the follow-up blocks of the risk
                // assessment now).
                enhanced_details["missing"] =
                    json!(missing_extra(declaration.as_ref(), &identification, extra));
                // The relationship proofs of block B.
                enhanced_details["relationship_proof_documents"] = json!(
                    uploads_of(UploadKind::RelationshipProof)
                        .iter()
                        .map(staff_file)
                        .collect::<Vec<_>>()
                );
                let mut billing = declaration
                    .clone()
                    .unwrap_or_default()
                    .billing_staff_json(route_by);
                crate::risk::cabinet::merge_into(&mut billing, billing_extras);
                // "Со слов пациента": who receives the invoice and whether
                // that recipient pays (step 3, 2026-10-11), as the lead
                // answered (an older request's section 7 became a row of
                // its own in migration 20261023100000).
                let mut recipient = stored_recipient.unwrap_or_default();
                let _ =
                    lead_invoice_recipient::resolve_parent(&mut recipient, &loaded.representation);
                crate::risk::cabinet::merge_into(&mut billing, recipient.portal_json());
                billing["recipient_updated_at"] = json!(
                    updates
                        .get(INVOICE_RECIPIENT_MARKER)
                        .filter(|update| {
                            update.get("hash").and_then(Value::as_str)
                                == Some(
                                    value_marker(
                                        lead_id,
                                        INVOICE_RECIPIENT_MARKER,
                                        Some(&recipient.marker_value()),
                                    )
                                    .as_str(),
                                )
                        })
                        .and_then(|update| update.get("at").cloned())
                );
                (
                    lead_representatives::staff_payload(&loaded),
                    lead_representatives::updated_at(&loaded, &updates),
                    billing,
                    billing_updated_at,
                    enhanced_details,
                    declaration
                        .as_ref()
                        .filter(|payer| payer.is_organisation() && payer_marker.is_some())
                        .map(|_| {
                            json!({
                                "legal_form": payer_extras["organisation_legal_form"],
                                "register_number": payer_extras["organisation_register_number"],
                                "contact_name": payer_extras["organisation_contact_name"],
                            })
                        })
                        .unwrap_or(Value::Null),
                )
            }
            Err(error) => return internal(error, "load representation"),
        }
    } else {
        (
            Value::Null,
            None,
            Value::Null,
            None,
            Value::Null,
            Value::Null,
        )
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
    let consent_form = if statements_visible {
        let subject_name = [data.first_name.as_str(), data.last_name.as_str()].join(" ");
        match super::lead_portal_consent_view::load(&state.db, lead_id, &subject_name).await {
            Ok(value) => value,
            Err(error) => return internal(error, "load consent choices"),
        }
    } else {
        Value::Null
    };
    // The trusted persons of the cabinet (2026-10-14), for the same roles as
    // the consent form's choice.
    let trusted_persons = if statements_visible {
        row.try_get::<Value, _>("portal_trusted_persons")
            .ok()
            .filter(Value::is_array)
            .unwrap_or_else(|| json!([]))
    } else {
        Value::Null
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
        .filter(|consent| {
            statements_visible
                && (medical
                    || consent.try_get::<String, _>("consent_type").ok().as_deref()
                        != Some("health_data_processing"))
        })
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
    // The lead's own login is closed while the minor's parents have access
    // (QA 2026-10-12, A3-01): the access row says so, and offers no password.
    let own_login_closed: bool = match sqlx::query_scalar(&format!(
        r#"SELECT l.portal_user_id IS NOT NULL AND {OWN_LOGIN_CLOSED_SQL}
           FROM leads l WHERE l.id = $1"#
    ))
    .bind(lead_id)
    .fetch_optional(&state.db)
    .await
    {
        Ok(value) => value.unwrap_or(false),
        Err(error) => return internal(error, "check the minor's own login"),
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
    // The statements of the follow-up blocks with the lead's GwG statements;
    // staff's identity data with who entered them; the lead's own reason of
    // the request only for roles with medical access (13.1).
    let (identification_json, patient_request_reason) =
        match crate::risk::cabinet::staff_statements(
            &state.db,
            lead_id,
            identification.to_json(),
            statements_visible,
            medical,
        )
        .await
        {
            Ok(loaded) => loaded,
            Err(error) => return internal(error, "load statements"),
        };
    Json(json!({
        "lead_id": lead_id,
        "fill_mode": fill_mode,
        "patient_fields": patient_field_markers(lead_id, &data, &updates),
        "patient_payer": payer_marker,
        "payer_organisation": payer_organisation,
        "progress": {
            "filled": data.filled_count(),
            "total": PROGRESS_FIELDS.len(),
            // The medical documents only, as the leads list and the submit
            // notification count them (one definition, QA 2026-10-11 A-11);
            // the UI names them "medical documents".
            "documents": uploads.len(),
            "submitted_at": time(&row, "portal_submitted_at"),
        },
        "submitted_at": time(&row, "portal_submitted_at"),
        // The lead changed answers after sending and has not sent again: the
        // answers shown are not the confirmed ones (as in the cabinet).
        "changed_since_submit": row
            .try_get::<bool, _>("changed_since_submit")
            .unwrap_or(false),
        "submitted_by": submitted_by,
        "consents": consent_items,
        "consent_form": consent_form,
        "disclosure": consent_form.get("disclosure").cloned().unwrap_or(Value::Null),
        "trusted_persons": trusted_persons,
        "uploads": upload_items,
        "uploads_hidden": !medical,
        "identification": identification_json,
        "identification_updated_at": identification_updated_at,
        "patient_request_reason": patient_request_reason,
        "identification_hidden": !statements_visible,
        "identity_documents": identity_documents,
        "representation": representation,
        "representation_updated_at": representation_updated_at,
        "billing": billing,
        "billing_updated_at": billing_updated_at,
        "enhanced_details": enhanced_details,
        "payer_link": payer_link,
        "guardians": guardians,
        "minor": crate::routes::leads::is_minor_on(data.date_of_birth, crate::app_time::today()),
        "own_login_closed": own_login_closed,
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
    let mut tx = match state.db.begin().await {
        Ok(tx) => tx,
        Err(error) => return internal(error, "begin"),
    };
    let kind: Option<String> = match sqlx::query_scalar(
        "SELECT kind FROM lead_portal_uploads WHERE document_id = $1 AND lead_id = $2 AND withdrawn_at IS NULL FOR UPDATE"
    ).bind(document_id).bind(lead_id).fetch_optional(&mut *tx).await {
        Ok(kind) => kind,
        Err(error) => return internal(error, "load upload kind"),
    };
    if !matches!(
        kind.as_deref(),
        Some("identity" | "representative_identity" | "representative_authority")
    ) && let Err(response) = auth.require_capability(Capability::PatientsMedicalView)
    {
        return response;
    }
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
/// own-account payments, the trusted persons of the cabinet (2026-10-14) and
/// — for an unconverted lead — the payer's statement and links (uploads go
/// with the lead's documents, consents stay as evidence without personal data
/// of their own).
pub(crate) async fn purge_portal_intake_in_tx(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    lead_id: Uuid,
) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM consent_form_choices WHERE lead_id = $1")
        .bind(lead_id)
        .execute(&mut **tx)
        .await?;
    sqlx::query("DELETE FROM lead_gwg_declarations WHERE lead_id = $1")
        .bind(lead_id)
        .execute(&mut **tx)
        .await?;
    super::lead_identification::purge_in_tx(tx, lead_id).await?;
    crate::routes::lead_payer_link::purge_in_tx(tx, lead_id).await?;
    sqlx::query(
        r#"UPDATE leads
           SET portal_field_updates = '{}'::jsonb,
               portal_trusted_persons = '[]'::jsonb,
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

    #[test]
    fn block_i_counts_only_copies_uploaded_after_the_identity_data() {
        let since: DateTime<Utc> = "2026-10-10T12:00:00Z".parse().unwrap();
        let old = json!({ "id": Uuid::nil(), "uploaded_at": "2026-10-10T11:59:59.5Z" });
        let new = json!({ "id": Uuid::nil(), "uploaded_at": "2026-10-10T12:00:00.000001Z" });
        assert!(!uploaded_after(&old, since));
        assert!(uploaded_after(&new, since));
        assert!(!uploaded_after(&json!({ "id": Uuid::nil() }), since));
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
            // Two letters that name no country (QA 2026-10-22).
            (
                PersonalDataPatch {
                    country: Some("XX".into()),
                    ..Default::default()
                },
                "country",
            ),
            (
                PersonalDataPatch {
                    citizenships: Some(vec!["DE".into(), "QQ".into()]),
                    ..Default::default()
                },
                "citizenships",
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
                "country",
                "phone"
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
    fn passport_spelling_is_required_only_for_submission() {
        for accepted in [
            "",
            " ",
            "Anna",
            "Müller",
            "José",
            "Łukasz",
            "O'Neil",
            "Jean-Luc",
            "Jose\u{301}",
        ] {
            assert!(!name_needs_latin_spelling(accepted), "{accepted}");
        }
        for rejected in [
            "Анна", "王", "Anna2", "Anna🙂", "--", "...", "’", "\u{301}", "\u{5b0}",
        ] {
            assert!(name_needs_latin_spelling(rejected), "{rejected}");
        }
        let data = apply_personal_data_patch(
            &anna(),
            &PersonalDataPatch {
                first_name: Some("Анна".into()),
                ..Default::default()
            },
            today(),
        )
        .unwrap();
        assert!(data.missing_for_submit().contains(&"name_latin"));
        assert_eq!(ConsentPurpose::InquiryProcessing.version(), "2026-10-03");
        assert_eq!(ConsentPurpose::HealthData.version(), "2026-10-13");
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
                "id_document_number_too_long",
            ),
            (
                json!({ "id_document_number": "AB/12345" }),
                "id_document_number",
                "id_document_number_invalid",
            ),
            (
                json!({ "id_issued_on": "2021-02-01", "id_valid_until": "2021-01-31" }),
                "id_valid_until",
                "id_document_expired",
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
        data.phone = Some("+4930123456".into());
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
        // The legal-guardianship question is asked again (owner 2026-10-10).
        let representation = || {
            vec![
                "has_representative".to_string(),
                "under_guardianship".to_string(),
            ]
        };
        assert_eq!(
            missing_for_submit(
                &data,
                None,
                &Identification::default(),
                false,
                representation(),
                PaymentRouteBy::Patient,
                ExtraState::default(),
                today(),
                &crate::risk::cabinet::BaseExtra::default(),
            ),
            // Staff enter the identity data, the account and the rest of the
            // payment route are block C and the high-risk question is gone
            // (trigger flow 2026-10-07); the bare payment method is asked
            // (owner 2026-10-10). Birth data, the own interest and the legal
            // questions are follow-up blocks K and L now (owner 2026-10-09).
            // Where the invoice goes is the invoice recipient's
            // (`with_invoice_recipient`, 2026-10-23).
            vec![
                "payer_kind",
                "id_document_upload",
                "has_representative",
                "under_guardianship",
                "payment_method"
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
        // The third party answers the payment route itself: nothing of the
        // billing is asked here (where the invoice goes is the invoice
        // recipient's). Its e-mail, phone and residence follow the payer's
        // other keys (owner request 2026-10-07).
        assert_eq!(
            missing_for_submit(
                &data,
                Some(&payer),
                &stated,
                true,
                Vec::new(),
                PaymentRouteBy::Payer,
                ExtraState::default(),
                today(),
                &crate::risk::cabinet::BaseExtra::default(),
            ),
            vec![
                "payer_relationship_kind",
                "payer_contact_consent",
                "payer_cost_estimate_consent",
                "payer_email",
                "payer_phone",
                "payer_country",
                "payer_city"
            ]
        );

        let complete = Identification {
            id_valid_until: NaiveDate::from_ymd_opt(2031, 2, 1),
            pep_self: Some(false),
            high_risk_country: Some(false),
            sanctions_links: Some(false),
            ..stated
        };
        let payer = lead_payer::Declaration {
            beneficial_owner_name: Some("Viktor Zahler".into()),
            relationship_kind: Some("parent".into()),
            contact_consent_at: Some(Utc::now()),
            cost_estimate_consent_at: Some(Utc::now()),
            invoice_to: Some("payer".into()),
            email: Some("viktor@example.com".into()),
            phone: Some("+43 1 234".into()),
            country: Some("AT".into()),
            city: Some("Wien".into()),
            ..payer
        };
        // Without the extra step nothing more is asked — neither the source
        // of funds nor why another person pays.
        assert!(
            missing_for_submit(
                &data,
                Some(&payer),
                &complete,
                true,
                Vec::new(),
                PaymentRouteBy::Payer,
                ExtraState::default(),
                today(),
                &crate::risk::cabinet::BaseExtra::default(),
            )
            .is_empty()
        );
        // A paying parent is asked for the route like the patient; the own
        // contact data are known (the parent's own row).
        let unreachable = lead_payer::Declaration {
            email: None,
            phone: None,
            city: None,
            ..payer.clone()
        };
        assert_eq!(
            missing_for_submit(
                &data,
                Some(&unreachable),
                &complete,
                true,
                Vec::new(),
                PaymentRouteBy::Guardian,
                ExtraState::default(),
                today(),
                &crate::risk::cabinet::BaseExtra::default(),
            ),
            // The account and the rest of the route are block C of the
            // follow-up; the bare method is asked (owner 2026-10-10).
            vec!["payment_method"]
        );
        // Known otherwise (a paying parent with a login, the payer answered
        // on the own link): not asked of the lead's login either.
        assert_eq!(
            missing_for_submit(
                &data,
                Some(&unreachable),
                &complete,
                true,
                Vec::new(),
                PaymentRouteBy::Payer,
                ExtraState {
                    payer_contact_known: true,
                    ..ExtraState::default()
                },
                today(),
                &crate::risk::cabinet::BaseExtra::default(),
            ),
            Vec::<String>::new()
        );
        // The paying parent is the payer: no consent to contact somebody
        // else or to pass the cost estimate on is asked of that login; the
        // lead's own login still asks both.
        let without_consent = lead_payer::Declaration {
            contact_consent_at: None,
            cost_estimate_consent_at: None,
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
                ExtraState::default(),
                today(),
                &crate::risk::cabinet::BaseExtra::default(),
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
                ExtraState::default(),
                today(),
                &crate::risk::cabinet::BaseExtra::default(),
            ),
            vec!["payer_contact_consent", "payer_cost_estimate_consent"]
        );
        // A parent of the minor who pays is the contracting party (owner
        // decision 2026-10-19): in any login — the other parent's, or one of
        // a parent without a login of the own — neither consent is asked.
        assert!(
            missing_for_submit(
                &data,
                Some(&without_consent),
                &complete,
                true,
                Vec::new(),
                PaymentRouteBy::Payer,
                ExtraState {
                    paying_parent: true,
                    ..ExtraState::default()
                },
                today(),
                &crate::risk::cabinet::BaseExtra::default(),
            )
            .is_empty()
        );
        // With the extra step, why another person pays is its first
        // question; the paying parent in the own login is never asked it.
        let triggered = |route_by| ExtraState {
            questions: ExtraQuestions::of(true, Some(&without_consent), route_by, false),
            ..ExtraState::default()
        };
        assert_eq!(
            missing_for_submit(
                &data,
                Some(&without_consent),
                &complete,
                true,
                Vec::new(),
                PaymentRouteBy::Guardian,
                triggered(PaymentRouteBy::Guardian),
                today(),
                &crate::risk::cabinet::BaseExtra::default(),
            ),
            // The extra step's questions are follow-up blocks now.
            Vec::<String>::new()
        );
        assert_eq!(
            missing_for_submit(
                &data,
                Some(&without_consent),
                &complete,
                true,
                Vec::new(),
                PaymentRouteBy::Payer,
                triggered(PaymentRouteBy::Payer),
                today(),
                &crate::risk::cabinet::BaseExtra::default(),
            ),
            vec!["payer_contact_consent", "payer_cost_estimate_consent"]
        );
        let answered = Identification {
            payment_background: Some("Mein Vater unterstützt mich.".into()),
            occupation: Some("Lehrerin".into()),
            sector: Some("Bildung".into()),
            ..complete
        };
        assert_eq!(
            missing_for_submit(
                &data,
                Some(&without_consent),
                &answered,
                true,
                Vec::new(),
                PaymentRouteBy::Payer,
                triggered(PaymentRouteBy::Payer),
                today(),
                &crate::risk::cabinet::BaseExtra::default(),
            ),
            vec!["payer_contact_consent", "payer_cost_estimate_consent"]
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
                "representative_id": "5d0c1f0e-0000-4000-8000-000000000001",
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
                "representative_id": null,
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

    #[test]
    fn the_extra_step_asks_the_funds_of_a_self_payer_only_with_the_triggers() {
        let mut data = anna();
        data.phone = Some("+4930123456".into());
        data.date_of_birth = NaiveDate::from_ymd_opt(1988, 5, 1);
        data.legal_sex = Some("female".into());
        data.citizenships = vec!["KP".into()];
        data.street_address = Some("Musterweg 1".into());
        data.zip_code = Some("10115".into());
        data.city = Some("Berlin".into());
        data.country = Some("DE".into());
        let complete = Identification {
            birth_place: Some("Kyiv".into()),
            birth_country: Some("UA".into()),
            id_document_type: Some("passport".into()),
            id_document_number: Some("AB123456".into()),
            id_issuing_authority: Some("Stadt Kyiv".into()),
            id_issuing_country: Some("UA".into()),
            id_valid_until: NaiveDate::from_ymd_opt(2031, 2, 1),
            pep_self: Some(false),
            pep_related: Some(false),
            high_risk_country: Some(false),
            sanctions_links: Some(false),
            ..Default::default()
        };
        let own = lead_payer::Declaration {
            payer_kind: lead_payer::PAYER_KIND_SELF.into(),
            own_account_answered: true,
            acts_on_own_account: true,
            invoice_to: Some("self".into()),
            payment_method: Some("cash".into()),
            via_third_party: Some(false),
            ..Default::default()
        };
        let missing = |payer: &lead_payer::Declaration,
                       statements: &Identification,
                       triggers: bool,
                       uploaded: bool| {
            missing_for_submit(
                &data,
                Some(payer),
                statements,
                true,
                Vec::new(),
                PaymentRouteBy::Patient,
                ExtraState {
                    questions: ExtraQuestions::of(
                        triggers,
                        Some(payer),
                        PaymentRouteBy::Patient,
                        false,
                    ),
                    funds_proof_uploaded: uploaded,
                    payer_contact_known: false,
                    paying_parent: false,
                },
                today(),
                &crate::risk::cabinet::BaseExtra::default(),
            )
        };
        // Without triggers a self-payer is asked nothing more.
        assert!(missing(&own, &complete, false, false).is_empty());
        assert!(!ExtraQuestions::of(false, Some(&own), PaymentRouteBy::Patient, false).required);
        // With them the questions are follow-up block A (`risk::store`): the
        // base form asks nothing more either.
        assert!(missing(&own, &complete, true, false).is_empty());
        let stated = lead_payer::Declaration {
            self_funds_source: Some("income".into()),
            self_funds_description: Some("Gehalt als Lehrerin".into()),
            ..own.clone()
        };
        let profile = Identification {
            occupation: Some("Lehrerin".into()),
            sector: Some("Bildung".into()),
            ..complete.clone()
        };
        assert!(missing(&stated, &profile, true, false).is_empty());
        // The extra step's own list (the staff view) still names them.
        let undescribed = lead_payer::Declaration {
            self_funds_description: None,
            ..stated.clone()
        };
        assert_eq!(
            missing_extra(
                Some(&undescribed),
                &profile,
                ExtraState {
                    questions: ExtraQuestions::of(
                        true,
                        Some(&undescribed),
                        PaymentRouteBy::Patient,
                        false
                    ),
                    funds_proof_uploaded: true,
                    payer_contact_known: false,
                    paying_parent: false,
                }
            ),
            ["enhanced_funds_description"]
        );
        // The cabinet learns which questions are asked, never why.
        let shown = ExtraQuestions::of(true, Some(&own), PaymentRouteBy::Patient, false).to_json();
        assert_eq!(shown["required"], true);
        assert_eq!(shown["asks"]["funds"], true);
        assert_eq!(shown["asks"]["funds_proof"], true);
        assert_eq!(shown["asks"]["payment_background"], false);
        assert_eq!(
            shown["funds_source_options"],
            json!([
                "income",
                "savings",
                "asset_sale",
                "inheritance_gift",
                "other"
            ])
        );
        let text = shown.to_string();
        for word in ["reason", "countr", "sanction", "blacklist", "KP"] {
            assert!(!text.contains(word), "{word}");
        }
        assert_eq!(UploadKind::SelfFundsProof.as_str(), "self_funds_proof");
        assert_eq!(
            UploadKind::SelfFundsProof.consent(),
            Some(ConsentPurpose::InquiryProcessing)
        );
        assert!(!UploadKind::SelfFundsProof.of_representative());
    }

    #[test]
    fn a_payer_outside_the_first_circle_opens_the_extra_step_without_triggers() {
        let person = |kind: &str| lead_payer::Declaration {
            payer_kind: lead_payer::PAYER_KIND_THIRD_PARTY.into(),
            payer_type: Some(lead_payer::PAYER_TYPE_PERSON.into()),
            first_name: Some("Mia".into()),
            last_name: Some("Muster".into()),
            relationship_kind: Some(kind.into()),
            ..Default::default()
        };
        let route = PaymentRouteBy::Payer;
        // First circle without triggers: no step.
        for kind in ["spouse", "parent", "child"] {
            let questions = ExtraQuestions::of(false, Some(&person(kind)), route, false);
            assert_eq!(questions, ExtraQuestions::default(), "{kind}");
        }
        // A sister, a friend, a company: why and what the patient knows of
        // the payer's funds; no upload, no profession, no sector.
        let company = lead_payer::Declaration {
            payer_type: Some("company".into()),
            organisation_name: Some("Beispiel GmbH".into()),
            ..person("employer")
        };
        for payer in [person("sibling"), person("friend"), company] {
            let questions = ExtraQuestions::of(false, Some(&payer), route, false);
            assert!(questions.required);
            assert!(!questions.check_required);
            assert!(questions.payment_background && !questions.payer_funds);
            assert!(!questions.funds && !questions.occupation && !questions.sector);
            assert!(!questions.payer_states_funds);
            let missing = missing_extra(
                Some(&payer),
                &Identification::default(),
                ExtraState {
                    questions,
                    ..ExtraState::default()
                },
            );
            assert_eq!(missing, ["enhanced_payment_background",]);
        }
        // Answered: nothing open.
        let sister = lead_payer::Declaration {
            payer_funds_source_stated: Some("savings".into()),
            payer_funds_description_stated: Some("Ersparnisse aus ihrem Gehalt".into()),
            ..person("sibling")
        };
        let questions = ExtraQuestions::of(false, Some(&sister), route, false);
        let why = Identification {
            payment_background: Some("Meine Schwester hilft mir.".into()),
            ..Default::default()
        };
        assert!(
            missing_extra(
                Some(&sister),
                &why,
                ExtraState {
                    questions,
                    ..ExtraState::default()
                }
            )
            .is_empty()
        );
        // The payer answered on the own link: the patient's guess is not
        // asked any more, the "why" still is.
        let answered = ExtraQuestions::of(false, Some(&sister), route, true);
        assert!(answered.payment_background && !answered.payer_funds);
        // With triggers: both and profession, sector, the note on the
        // payer's own proofs.
        let full = ExtraQuestions::of(true, Some(&person("grandparent")), route, false);
        assert!(full.payment_background && !full.payer_funds && full.payer_states_funds);
        assert!(full.occupation && full.sector && !full.funds);
        assert_eq!(
            missing_extra(
                Some(&person("grandparent")),
                &Identification::default(),
                ExtraState {
                    questions: full,
                    ..ExtraState::default()
                }
            ),
            [
                "enhanced_payment_background",
                "enhanced_occupation",
                "enhanced_sector"
            ]
        );
        // A first-circle payer with triggers: why, profession, sector.
        let parent = ExtraQuestions::of(true, Some(&person("parent")), route, false);
        assert!(parent.payment_background && !parent.payer_funds);
        // The paying parent in the own login is first circle: only the
        // sector (the profession is in the own payer section).
        let own_login = ExtraQuestions::of(
            true,
            Some(&person("parent")),
            PaymentRouteBy::Guardian,
            false,
        );
        assert!(own_login.sector && !own_login.occupation);
        assert!(!own_login.payment_background && !own_login.payer_funds);
        assert!(
            !ExtraQuestions::of(
                false,
                Some(&person("friend")),
                PaymentRouteBy::Guardian,
                false
            )
            .required
        );
    }

    fn enhanced_patch(body: Value) -> Result<EnhancedDetailsPatch, serde_json::Error> {
        serde_json::from_value(body)
    }

    #[test]
    fn the_extra_steps_profile_is_validated_and_names_the_changed_keys() {
        let current = Identification::default();
        let patch = enhanced_patch(json!({
            "occupation": "  Lehrerin ",
            "sector": "Bildung",
            "funds_source": "income"
        }))
        .unwrap();
        let (next, changed) = apply_profile_patch(&current, &patch).unwrap();
        assert_eq!(next.occupation.as_deref(), Some("Lehrerin"));
        assert_eq!(next.sector.as_deref(), Some("Bildung"));
        assert_eq!(changed, ["occupation", "sector"]);
        assert_eq!(patch.funds().funds_source, Some(Some("income".to_string())));
        // `null` clears, a value over 200 characters is refused.
        let (cleared, changed) =
            apply_profile_patch(&next, &enhanced_patch(json!({ "sector": null })).unwrap())
                .unwrap();
        assert_eq!(cleared.sector, None);
        assert_eq!(changed, ["sector"]);
        let too_long = enhanced_patch(json!({ "occupation": "x".repeat(201) })).unwrap();
        assert_eq!(
            apply_profile_patch(&current, &too_long).unwrap_err().field,
            "occupation"
        );
        // Unknown keys (the old list key above all) are refused.
        assert!(enhanced_patch(json!({ "self_funds_sources": ["savings"] })).is_err());
        assert!(enhanced_patch(json!({ "occupation": 5 })).is_err());
        // Profession and sector are no statement of the identification
        // route and do not change its marker.
        assert_eq!(current.marker_value(), next.marker_value());
        assert!(!IDENTIFICATION_FIELDS.contains(&"occupation"));
    }

    fn keys(values: &[&str]) -> Vec<String> {
        values.iter().map(|value| value.to_string()).collect()
    }

    #[test]
    fn step_three_asks_the_invoice_recipient_before_the_payer() {
        use lead_invoice_recipient::Recipient;
        let base = keys(&[
            "first_name",
            "has_insurance",
            "payer_kind",
            "invoice_to",
            "payment_method",
        ]);
        // Nothing answered: the recipient first, no payer key.
        assert_eq!(
            with_invoice_recipient(base.clone(), &Recipient::default(), None, false, false),
            keys(&["first_name", "has_insurance", "invoice_recipient"])
        );
        // A checked third-party recipient still needs visible recipient fields;
        // an absent or different stored payer never produces a hidden payer-kind error.
        let incomplete_recipient = Recipient {
            recipient: Some("third_party".into()),
            is_payer: Some(true),
            ..Recipient::default()
        };
        let missing =
            with_invoice_recipient(base.clone(), &incomplete_recipient, None, false, false);
        assert!(
            missing.contains(&"recipient_type".to_string()),
            "{missing:?}"
        );
        assert!(
            missing.contains(&"invoice_recipient_is_payer".to_string()),
            "{missing:?}"
        );
        assert!(!missing.contains(&"payer_kind".to_string()), "{missing:?}");
        // The recipient answered, "does it pay?" not yet.
        let own = Recipient {
            recipient: Some("self".into()),
            ..Recipient::default()
        };
        assert_eq!(
            with_invoice_recipient(base.clone(), &own, None, false, false),
            keys(&["first_name", "has_insurance", "invoice_recipient_is_payer",])
        );
        // "No": the payer question is shown and missing.
        let not_paying = Recipient {
            is_payer: Some(false),
            ..own.clone()
        };
        assert_eq!(
            with_invoice_recipient(base.clone(), &not_paying, None, false, false),
            keys(&["first_name", "has_insurance", "payer_kind",])
        );
        // A self-payer does not answer "the recipient (me) does not pay".
        let own_payer = lead_payer::Declaration {
            payer_kind: lead_payer::PAYER_KIND_SELF.into(),
            ..lead_payer::Declaration::default()
        };
        assert!(
            with_invoice_recipient(base.clone(), &not_paying, Some(&own_payer), false, false)
                .contains(&"payer_kind".to_string())
        );
        // An organisation that pays states its reason instead of a relationship.
        let organisation = lead_payer::Declaration {
            payer_kind: lead_payer::PAYER_KIND_THIRD_PARTY.into(),
            payer_type: Some("organisation".into()),
            ..lead_payer::Declaration::default()
        };
        let missing = keys(&[
            "payer_organisation_name",
            "payer_relationship_kind",
            "payer_contact_consent",
            "payment_method",
        ]);
        assert_eq!(
            with_invoice_recipient(
                missing.clone(),
                &not_paying,
                Some(&organisation),
                false,
                false
            ),
            keys(&[
                "payer_organisation_name",
                "payer_contact_consent",
                "payer_payment_reason",
                "payment_method",
            ])
        );
        assert!(
            !with_invoice_recipient(missing, &not_paying, Some(&organisation), false, true)
                .contains(&"payer_payment_reason".to_string())
        );
        // A payer named by an older cabinet keeps its keys while the recipient is open.
        let person = lead_payer::Declaration {
            payer_kind: lead_payer::PAYER_KIND_THIRD_PARTY.into(),
            payer_type: Some("person".into()),
            ..lead_payer::Declaration::default()
        };
        assert_eq!(
            with_invoice_recipient(
                keys(&["payer_first_name", "invoice_to"]),
                &Recipient::default(),
                Some(&person),
                false,
                false,
            ),
            keys(&["invoice_recipient", "payer_first_name"])
        );
    }
}
