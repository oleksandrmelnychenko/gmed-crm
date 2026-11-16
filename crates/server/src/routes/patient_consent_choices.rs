//! An existing patient changes the consent form options and the trusted
//! persons (owner request 2026-11-16): «Изменить согласия» in the patient
//! card (CEO, Patient Manager with the patient; the same who make the
//! patient's documents) with how the client told GMED, and the same in the
//! portal for the patient (or the parent with access) without that choice.
//!
//! Every change is a new row of `consent_form_choices` owned by the patient
//! ([`patient::SOURCE_STAFF`] / [`patient::SOURCE_PORTAL`]); the lead the
//! patient came from stays frozen. A removal applies at once, an addition
//! once the new version of the consent form is signed
//! ([`patient::effective_consent`]). The consent form of the patient
//! (`privacy_consents`, or the minor's form) then needs a new version: the
//! answer names it (`documents[].needs_new_version`) and staff make it with
//! the replace path of the documents (`POST /documents/generate` with
//! `replace_document_id`), then send it for signature or pass it to the
//! client. Trusted persons are never sanctions-screened (owner decision
//! 2026-10-12); names stay out of the audit trail.

use axum::{
    Json, Router,
    extract::{Extension, Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::get,
};
use chrono::NaiveDate;
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::Row;
use uuid::Uuid;

use crate::audit;
use crate::auth::middleware::AuthUser;
use crate::consent_choices::{self, ConsentChoices, ConsentRecipient, DisclosureDecision, patient};
use crate::routes::lead_portal_intake::{coded, staff_consent_record};
use crate::state::AppState;
use gmed_domain::role::Role;

const LANGUAGES: [&str; 4] = ["de", "ru", "uk", "en"];

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/patients/{patient_id}/consent-choices",
            get(get_staff_state).post(save_staff_change),
        )
        .route(
            "/me/consent-choices",
            get(get_portal_state).post(save_portal_change),
        )
}

fn failed(error: impl std::fmt::Display, what: &str) -> Response {
    tracing::error!(%error, what, "patient consent choices");
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(json!({ "error": "internal", "message": "Failed" })),
    )
        .into_response()
}

fn forbidden() -> Response {
    (
        StatusCode::FORBIDDEN,
        Json(json!({ "error": "forbidden", "message": "Not allowed" })),
    )
        .into_response()
}

fn not_found() -> Response {
    (
        StatusCode::NOT_FOUND,
        Json(json!({ "error": "not_found", "message": "Patient not found" })),
    )
        .into_response()
}

/// Who may read (`write = false`) or change the consent choices of a
/// patient: CEO; Patient Manager with an active assignment; CEO Assistant
/// reads. Everyone else — interpreters, Sales, Billing, Concierge, IT Admin —
/// is refused, as for the patient's consent documents.
async fn require_staff_access(
    state: &AppState,
    auth: &AuthUser,
    patient_id: Uuid,
    write: bool,
) -> Result<(), Response> {
    let allowed: &[Role] = if write {
        &[Role::Ceo, Role::PatientManager]
    } else {
        &[Role::Ceo, Role::PatientManager, Role::CeoAssistant]
    };
    if !allowed.contains(&auth.role) {
        return Err(forbidden());
    }
    if auth.role == Role::PatientManager {
        let assigned =
            crate::access::has_active_patient_assignment(&state.db, patient_id, auth.user_id)
                .await
                .map_err(|error| failed(error, "check assignment"))?;
        if !assigned {
            return Err(forbidden());
        }
    }
    Ok(())
}

#[derive(Deserialize)]
struct LanguageQuery {
    lang: Option<String>,
}

fn language_of(value: Option<&str>) -> String {
    let value = value.map(|v| v.trim().to_lowercase()).unwrap_or_default();
    if LANGUAGES.contains(&value.as_str()) {
        value
    } else {
        "de".into()
    }
}

/// The patient's birth date and whether the record exists (anonymised and
/// deleted records do not count).
async fn patient_birth_date<'e, E>(
    executor: E,
    patient_id: Uuid,
    lock: bool,
) -> Result<Option<Option<NaiveDate>>, sqlx::Error>
where
    E: sqlx::PgExecutor<'e>,
{
    let sql = if lock {
        "SELECT birth_date FROM patients WHERE id = $1 AND is_active = true FOR UPDATE"
    } else {
        "SELECT birth_date FROM patients WHERE id = $1 AND is_active = true"
    };
    sqlx::query_scalar::<_, Option<NaiveDate>>(sql)
        .bind(patient_id)
        .fetch_optional(executor)
        .await
}

/// The patient's current consent forms (the newest version of each), with
/// whether they print the newest choice.
async fn consent_documents(
    state: &AppState,
    patient_id: Uuid,
    requested: Option<&patient::RequestedChoice>,
    newest_is_patient_change: bool,
) -> Result<Vec<Value>, sqlx::Error> {
    let rows = sqlx::query(
        r#"SELECT DISTINCT ON (d.generated_template_id)
                  d.id, d.generated_template_id,
                  COALESCE(NULLIF(btrim(d.original_filename), ''), d.auto_name) AS title,
                  d.signed_at, d.created_at,
                  d.generated_bindings -> '_own_consent_choice' ->> 'id' AS choice_id
           FROM documents d
           WHERE d.patient_id = $1
             AND d.generated_template_id = ANY($2)
             AND d.status <> 'archived'
             AND d.file_deleted_at IS NULL
             AND NOT EXISTS (SELECT 1 FROM documents newer WHERE newer.replaces_document_id = d.id)
           ORDER BY d.generated_template_id, d.created_at DESC"#,
    )
    .bind(patient_id)
    .bind(patient::consent_form_templates())
    .fetch_all(&state.db)
    .await?;
    let requested_id = requested.map(|requested| requested.id.to_string());
    Ok(rows
        .into_iter()
        .map(|row| {
            let choice_id: Option<String> = row.get("choice_id");
            let needs_new_version = newest_is_patient_change && choice_id != requested_id;
            json!({
                "id": row.get::<Uuid, _>("id"),
                "template_id": row.get::<Option<String>, _>("generated_template_id"),
                "title": row.get::<Option<String>, _>("title"),
                "signed_at": row.get::<Option<chrono::DateTime<chrono::Utc>>, _>("signed_at"),
                "created_at": row.get::<chrono::DateTime<chrono::Utc>, _>("created_at"),
                "needs_new_version": needs_new_version,
            })
        })
        .collect())
}

/// The screen's view of the patient's consent choices. The portal (`staff =
/// false`) gets no staff names and notes.
async fn state_json(
    state: &AppState,
    patient_id: Uuid,
    staff: bool,
    language: &str,
    minor: bool,
    access_kind: &str,
) -> Result<Value, sqlx::Error> {
    let loaded = patient::load_state(&state.db, patient_id).await?;
    let newest_is_patient_change = loaded.history.first().is_some_and(|entry| {
        entry.source == patient::SOURCE_STAFF || entry.source == patient::SOURCE_PORTAL
    });
    let documents = consent_documents(
        state,
        patient_id,
        loaded.requested.as_ref(),
        newest_is_patient_change,
    )
    .await?;
    let company = crate::routes::lead_portal_intake::disclosure_company_name(&state.db).await?;
    let subject = consent_choices::DisclosureSubject::for_custody(access_kind, minor, None);
    let history: Vec<Value> = loaded
        .history
        .iter()
        .map(|entry| {
            let by_staff = entry.access_kind == "staff";
            json!({
                "id": entry.id,
                "chosen_at": entry.chosen_at,
                "source": entry.source,
                "access_kind": entry.access_kind,
                "recorded_how": entry.recorded_how,
                "recorded_note": if staff { entry.recorded_note.clone() } else { None },
                "chosen_by_name": if staff || !by_staff { entry.chosen_by_name.clone() } else { None },
                "choices": entry.choices,
                "recipients_count": entry.recipients_count,
                "signed": entry.signed,
            })
        })
        .collect();
    let requested = loaded.requested.as_ref();
    Ok(json!({
        "patient_id": patient_id,
        "version": consent_choices::TEXT_VERSION,
        "disclosure_version": consent_choices::DISCLOSURE_VERSION,
        "max_recipients": consent_choices::MAX_RECIPIENTS,
        "minor": minor,
        "requested": requested.map(|requested| json!({
            "id": requested.id,
            "choices": requested.choices,
            "recipients": if requested.choices.named_recipients { requested.recipients.clone() } else { Vec::new() },
            "disclosure_consent_given": requested.disclosure.as_ref().is_some_and(|d| d.allow_disclosure && d.consent_given)
                || (requested.disclosure.is_none() && requested.choices.named_recipients),
        })),
        "effective": loaded.effective,
        "pending": loaded.pending,
        "history": history,
        "documents": documents,
        "disclosure_text": consent_choices::disclosure_consent_text_for(language, &company, subject),
        "recorded_how_options": crate::routes::lead_portal_intake::STAFF_CONSENT_CHANNELS,
    }))
}

async fn get_staff_state(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(patient_id): Path<Uuid>,
    Query(query): Query<LanguageQuery>,
) -> Response {
    if let Err(response) = require_staff_access(&state, &auth, patient_id, false).await {
        return response;
    }
    let birth_date = match patient_birth_date(&state.db, patient_id, false).await {
        Ok(Some(birth_date)) => birth_date,
        Ok(None) => return not_found(),
        Err(error) => return failed(error, "load patient"),
    };
    let minor = crate::routes::leads::is_minor_on(birth_date, crate::app_time::today());
    match state_json(
        &state,
        patient_id,
        true,
        &language_of(query.lang.as_deref()),
        minor,
        "staff",
    )
    .await
    {
        Ok(mut body) => {
            body["can_edit"] = json!(matches!(auth.role, Role::Ceo | Role::PatientManager));
            Json(body).into_response()
        }
        Err(error) => failed(error, "load consent choices"),
    }
}

/// The portal login's patient and how it acts: `guardian` for a parent's
/// access to a child (`patient_assignments.source = 'lead_guardian'`),
/// otherwise `self`.
async fn portal_patient(state: &AppState, auth: &AuthUser) -> Result<(Uuid, String), Response> {
    if auth.role != Role::Patient {
        return Err(forbidden());
    }
    let patient_id = crate::routes::me::resolve_self_patient_id(state, auth).await?;
    let guardian: bool = sqlx::query_scalar(
        r#"SELECT EXISTS (SELECT 1 FROM patient_assignments
                          WHERE patient_id = $1 AND user_id = $2 AND revoked_at IS NULL
                            AND source = 'lead_guardian')"#,
    )
    .bind(patient_id)
    .bind(auth.user_id)
    .fetch_one(&state.db)
    .await
    .map_err(|error| failed(error, "check guardian access"))?;
    Ok((
        patient_id,
        if guardian { "guardian" } else { "self" }.to_string(),
    ))
}

async fn get_portal_state(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Query(query): Query<LanguageQuery>,
) -> Response {
    let (patient_id, access_kind) = match portal_patient(&state, &auth).await {
        Ok(found) => found,
        Err(response) => return response,
    };
    let birth_date = match patient_birth_date(&state.db, patient_id, false).await {
        Ok(Some(birth_date)) => birth_date,
        Ok(None) => return not_found(),
        Err(error) => return failed(error, "load patient"),
    };
    let minor = crate::routes::leads::is_minor_on(birth_date, crate::app_time::today());
    match state_json(
        &state,
        patient_id,
        false,
        &language_of(query.lang.as_deref()),
        minor,
        &access_kind,
    )
    .await
    {
        Ok(mut body) => {
            // A minor's own login reads; a parent or the guardian chooses.
            body["can_edit"] = json!(!(minor && access_kind == "self"));
            // The documents are staff's work; the portal only reads the state.
            body["documents"] = json!([]);
            Json(body).into_response()
        }
        Err(error) => failed(error, "load consent choices"),
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ChangeRequest {
    /// The options; `named_recipients` follows the persons.
    choices: ConsentChoices,
    /// The whole list of trusted persons, at most five.
    #[serde(default)]
    recipients: Vec<ConsentRecipient>,
    /// The explicit consent to the named persons and scopes; needed when a
    /// person or a scope is added.
    #[serde(default)]
    consent_given: bool,
    /// [`consent_choices::TEXT_VERSION`] of the texts shown.
    version: String,
    language: String,
    /// Staff: how the client told GMED (phone, in person, e-mail, letter).
    #[serde(default)]
    recorded_how: Option<String>,
    #[serde(default)]
    recorded_note: Option<String>,
}

async fn save_staff_change(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(patient_id): Path<Uuid>,
    Json(body): Json<ChangeRequest>,
) -> Response {
    if let Err(response) = require_staff_access(&state, &auth, patient_id, true).await {
        return response;
    }
    let recorded = match staff_consent_record(
        body.recorded_how.as_deref(),
        body.recorded_note.as_deref(),
        auth.user_id,
    ) {
        Ok(record) => record,
        Err(response) => return response,
    };
    save_change(
        &state,
        &auth,
        patient_id,
        body,
        Actor::Staff {
            how: recorded["how"].as_str().unwrap_or_default().to_string(),
            note: recorded["note"].as_str().map(str::to_string),
        },
    )
    .await
}

async fn save_portal_change(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Json(body): Json<ChangeRequest>,
) -> Response {
    let (patient_id, access_kind) = match portal_patient(&state, &auth).await {
        Ok(found) => found,
        Err(response) => return response,
    };
    if body.recorded_how.is_some() || body.recorded_note.is_some() {
        return coded(
            StatusCode::UNPROCESSABLE_ENTITY,
            "invalid_field",
            "Only staff record how the client told them",
            json!({ "field": "recorded_how" }),
        );
    }
    save_change(
        &state,
        &auth,
        patient_id,
        body,
        Actor::Portal { access_kind },
    )
    .await
}

enum Actor {
    Staff { how: String, note: Option<String> },
    Portal { access_kind: String },
}

impl Actor {
    fn source(&self) -> &'static str {
        match self {
            Self::Staff { .. } => patient::SOURCE_STAFF,
            Self::Portal { .. } => patient::SOURCE_PORTAL,
        }
    }

    fn access_kind(&self) -> &str {
        match self {
            Self::Staff { .. } => "staff",
            Self::Portal { access_kind } => access_kind,
        }
    }
}

fn refusal(code: &str, message: &str, extra: Value) -> Response {
    coded(StatusCode::UNPROCESSABLE_ENTITY, code, message, extra)
}

async fn save_change(
    state: &AppState,
    auth: &AuthUser,
    patient_id: Uuid,
    body: ChangeRequest,
    actor: Actor,
) -> Response {
    if body.version != consent_choices::TEXT_VERSION {
        return coded(
            StatusCode::CONFLICT,
            "consent_version_outdated",
            "The consent text has changed; reload the page",
            json!({ "version": consent_choices::TEXT_VERSION }),
        );
    }
    let language = body.language.trim().to_lowercase();
    if !LANGUAGES.contains(&language.as_str()) {
        return refusal(
            "invalid_field",
            "Unsupported language",
            json!({ "field": "language" }),
        );
    }
    let mut choices = body.choices;
    // Withdrawing the consents the service runs on is a withdrawal of the
    // whole consent: the privacy request «Отзыв согласия на передачу третьим
    // лицам» (`third_party_revoke`), not a change here.
    if !choices.has_core() {
        return refusal(
            consent_choices::CORE_REQUIRED,
            "The three consents the service needs must be ticked",
            json!({ "required": ["agency_processing", "doctors_to_agency", "data_system"] }),
        );
    }
    let recipients = match consent_choices::clean_persons(body.recipients) {
        Ok(recipients) => recipients,
        Err(code) => {
            return refusal(
                code,
                "At most five trusted persons: name, who they are, phone, scope",
                json!({ "field": consent_choices::persons_error_field(code, "recipients"), "max": consent_choices::MAX_RECIPIENTS }),
            );
        }
    };
    choices.named_recipients = !recipients.is_empty();

    let mut tx = match state.db.begin().await {
        Ok(tx) => tx,
        Err(error) => return failed(error, "begin"),
    };
    let birth_date = match patient_birth_date(&mut *tx, patient_id, true).await {
        Ok(Some(birth_date)) => birth_date,
        Ok(None) => return not_found(),
        Err(error) => return failed(error, "lock patient"),
    };
    let minor = crate::routes::leads::is_minor_on(birth_date, crate::app_time::today());
    if minor && actor.access_kind() == "self" {
        return coded(
            StatusCode::CONFLICT,
            consent_choices::BY_GUARDIAN,
            "For a minor, a parent or the legal guardian chooses with their own access",
            json!({}),
        );
    }
    let loaded = match patient::load_state(&mut *tx, patient_id).await {
        Ok(loaded) => loaded,
        Err(error) => return failed(error, "load consent choices"),
    };
    let (before_choices, before_recipients, before_disclosure) = match &loaded.requested {
        Some(requested) => (
            requested.choices,
            if requested.choices.named_recipients {
                requested.recipients.clone()
            } else {
                Vec::new()
            },
            requested.disclosure.clone(),
        ),
        None => (ConsentChoices::default(), Vec::new(), None),
    };
    if loaded.requested.is_some() && choices == before_choices && recipients == before_recipients {
        return refusal("nothing_changed", "Nothing was changed", json!({}));
    }
    // A person named or edited now needs the phone number they call from,
    // the date of birth (not an institution) and a scope (owner 2026-10-26);
    // an unchanged person saved before keeps a legacy contact.
    let today = crate::app_time::today();
    for (index, person) in recipients.iter().enumerate() {
        if before_recipients.contains(person) {
            continue;
        }
        if person
            .contact
            .as_deref()
            .is_some_and(|contact| !consent_choices::recipient_contact_valid(contact))
        {
            return refusal(
                consent_choices::RECIPIENTS_INVALID,
                "The contact of a person is a phone number or an e-mail address",
                json!({ "field": "contact", "index": index }),
            );
        }
        if let Some(field) = consent_choices::missing_person_field(person, today) {
            return refusal(
                consent_choices::RECIPIENTS_INVALID,
                match field {
                    "phone" => "Enter the phone number this person will call from",
                    "birth_date" => "Enter the date of birth of this person",
                    _ => "Choose the scope of information for each person",
                },
                json!({ "field": field, "index": index }),
            );
        }
    }
    let withdraws_only = loaded.requested.is_some()
        && patient::only_withdraws(&choices, &recipients, &before_choices, &before_recipients);
    // Adding a person or a scope needs the explicit consent to the named
    // persons; a removal keeps the earlier decision for the rest.
    if choices.named_recipients && !withdraws_only && !body.consent_given {
        return refusal(
            consent_choices::DISCLOSURE_REQUIRED,
            "Explicit consent to the named people and stated scope is required",
            json!({ "field": "consent_given" }),
        );
    }
    let now: chrono::DateTime<chrono::Utc> = match sqlx::query_scalar("SELECT clock_timestamp()")
        .fetch_one(&mut *tx)
        .await
    {
        Ok(now) => now,
        Err(error) => return failed(error, "read time"),
    };
    let disclosure = if !choices.named_recipients {
        before_disclosure.as_ref().map(|_| DisclosureDecision {
            allow_disclosure: false,
            consent_given: false,
            chosen_at: now,
            chosen_by: auth.user_id,
            access_kind: actor.access_kind().to_string(),
            consent_text: String::new(),
            ..DisclosureDecision::default_no(actor.access_kind())
        })
    } else if withdraws_only && before_disclosure.is_some() {
        before_disclosure.clone()
    } else {
        let company =
            match crate::routes::lead_portal_intake::disclosure_company_name(&mut *tx).await {
                Ok(company) => company,
                Err(error) => return failed(error, "load company"),
            };
        let chooser_name: Option<String> =
            match sqlx::query_scalar("SELECT name FROM users WHERE id = $1")
                .bind(auth.user_id)
                .fetch_optional(&mut *tx)
                .await
            {
                Ok(name) => name,
                Err(error) => return failed(error, "load chooser"),
            };
        let subject =
            consent_choices::DisclosureSubject::for_custody(actor.access_kind(), minor, None);
        Some(DisclosureDecision {
            allow_disclosure: true,
            consent_given: true,
            version: consent_choices::DISCLOSURE_VERSION.to_string(),
            language: language.clone(),
            chosen_at: now,
            chosen_by: auth.user_id,
            chosen_by_name: chooser_name,
            access_kind: actor.access_kind().to_string(),
            consent_text: consent_choices::disclosure_consent_text_for(
                &language, &company, subject,
            ),
            company_name: company,
        })
    };
    let (recorded_how, recorded_note) = match &actor {
        Actor::Staff { how, note } => (Some(how.clone()), note.clone()),
        Actor::Portal { .. } => (None, None),
    };
    let choice_id: Uuid = match sqlx::query_scalar(
        r#"INSERT INTO consent_form_choices (
               template_id, lead_id, patient_id, choices, chosen_by, access_kind, source,
               language, text_version, recipients, chosen_at, disclosure,
               recorded_how, recorded_note)
           VALUES ($1, NULL, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
           RETURNING id"#,
    )
    .bind(consent_choices::TEMPLATE)
    .bind(patient_id)
    .bind(json!(choices))
    .bind(auth.user_id)
    .bind(actor.access_kind())
    .bind(actor.source())
    .bind(&language)
    .bind(consent_choices::TEXT_VERSION)
    .bind(json!(recipients))
    .bind(now)
    .bind(disclosure.as_ref().map(|d| json!(d)))
    .bind(&recorded_how)
    .bind(&recorded_note)
    .fetch_one(&mut *tx)
    .await
    {
        Ok(id) => id,
        Err(error) => return failed(error, "insert consent choice"),
    };
    let after = match patient::load_state(&mut *tx, patient_id).await {
        Ok(after) => after,
        Err(error) => return failed(error, "derive consent state"),
    };
    let (removed, added) = patient::person_changes(&before_recipients, &recipients);
    let withdrawn_options: Vec<&str> = option_keys(&before_choices)
        .into_iter()
        .filter(|key| !option_keys(&choices).contains(key))
        .collect();
    let added_options: Vec<&str> = option_keys(&choices)
        .into_iter()
        .filter(|key| !option_keys(&before_choices).contains(key))
        .collect();
    if let Err(error) = audit::write_in_transaction(
        &mut tx,
        &audit::domain_event(
            "patient_consent_choices_changed",
            Some(auth.user_id),
            "patient",
            Some(patient_id),
            // Names stay out of the audit trail (erasure); the row keeps them.
            json!({
                "consent_form_choice_id": choice_id,
                "source": actor.source(),
                "access_kind": actor.access_kind(),
                "recorded_how": recorded_how,
                "recipients_count": recipients.len(),
                "removed_recipients": removed,
                "added_recipients": added,
                "withdrawn_options": withdrawn_options,
                "added_options": added_options,
                "withdrawal_only": withdraws_only,
                "pending_signature": after.pending.any(),
                "effective_recipients_count": after.effective.recipients.len(),
                "text_version": consent_choices::TEXT_VERSION,
            }),
        ),
    )
    .await
    {
        return failed(error, "audit consent choices");
    }
    let invalidated = match crate::document_signatures::invalidate_patient_consent_choices(
        &mut tx,
        patient_id,
        auth.user_id,
    )
    .await
    {
        Ok(invalidated) => invalidated,
        Err(error) => return failed(error, "invalidate consent invitations"),
    };
    if let Err(error) = tx.commit().await {
        return failed(error, "commit consent choices");
    }
    let (invalidated_count, invalidated) = invalidated;
    if invalidated_count > 0 {
        let signature_state = state.clone();
        tokio::spawn(async move {
            crate::document_signatures::withdraw_invalidated_consents(
                &signature_state,
                &invalidated,
            )
            .await;
        });
    }
    if matches!(actor, Actor::Portal { .. }) {
        notify_staff(state, patient_id).await;
    }
    crate::realtime::publish_patient_event(
        state,
        Some(auth.user_id),
        "patient.consent_choices_changed",
        patient_id,
        json!({ "consent_form_choice_id": choice_id }),
    )
    .await;
    let staff = matches!(actor, Actor::Staff { .. });
    match state_json(
        state,
        patient_id,
        staff,
        &language,
        minor,
        actor.access_kind(),
    )
    .await
    {
        Ok(mut body) => {
            body["can_edit"] = json!(true);
            body["saved_id"] = json!(choice_id);
            if !staff {
                body["documents"] = json!([]);
            }
            (StatusCode::CREATED, Json(body)).into_response()
        }
        Err(error) => failed(error, "load consent choices"),
    }
}

fn option_keys(choices: &ConsentChoices) -> Vec<&'static str> {
    [
        ("agency_processing", choices.agency_processing),
        ("doctors_to_agency", choices.doctors_to_agency),
        ("data_system", choices.data_system),
        ("named_recipients", choices.named_recipients),
        ("channel_email", choices.channel_email),
        ("channel_threema", choices.channel_threema),
        ("channel_whatsapp", choices.channel_whatsapp),
        ("channel_telegram", choices.channel_telegram),
    ]
    .into_iter()
    .filter(|(_, ticked)| *ticked)
    .map(|(key, _)| key)
    .collect()
}

/// The patient changed the consents in the portal: the patient's managers
/// (or, without one, the CEO) make the new version of the consent form.
async fn notify_staff(state: &AppState, patient_id: Uuid) {
    let rows = sqlx::query(
        r#"WITH managers AS (
               SELECT pa.user_id
               FROM patient_assignments pa
               JOIN users u ON u.id = pa.user_id
               WHERE pa.patient_id = $1 AND pa.revoked_at IS NULL
                 AND u.is_active = true AND u.role = 'patient_manager'
           ), recipients AS (
               SELECT user_id FROM managers
               UNION
               SELECT u.id FROM users u
               WHERE u.is_active = true AND u.role = 'ceo'
                 AND NOT EXISTS (SELECT 1 FROM managers)
           )
           INSERT INTO user_notifications (user_id, kind, title, body, entity_type, entity_id)
           SELECT user_id, 'patient_consent_choice_changed', 'Consent choice changed',
                  'The patient changed the consent choice. Create a new version of the consent form.',
                  'patient', $1
           FROM recipients
           RETURNING id, user_id"#,
    )
    .bind(patient_id)
    .fetch_all(&state.db)
    .await;
    match rows {
        Ok(rows) => {
            for row in rows {
                crate::realtime::publish_notification_event(
                    state,
                    row.get("user_id"),
                    "notification.created",
                    Some(row.get("id")),
                    json!({ "entity_type": "patient", "entity_id": patient_id }),
                )
                .await;
            }
        }
        Err(error) => {
            tracing::error!(%error, %patient_id, "notify consent choice change");
        }
    }
}
