//! What the lead cabinet sees of the risk assessment (P2): neutral follow-up
//! blocks (`follow_up`), the neutral `review_notice`, and nothing else — no
//! points, level, trigger, reason or decision.
//!
//! Also here: the base form's keys after the trigger flow (contract 3.1:
//! staff's identity data and the answers of the follow-up blocks leave
//! `missing_for_submit`; the organisation mask and the lead's reason of the
//! request join it), the step of each key (`progress.missing_by_step`), the
//! new statements of the blocks F, B, H, J and the reason of the request
//! (13.1) on `lead_gwg_declarations`, the organisation mask of "who pays",
//! block C's expected total and route, and the cabinet endpoints
//! `POST /me/lead-requests/{id}/follow-up/submit` and
//! `…/relationship-proof`.

use axum::{
    Json, Router,
    extract::{DefaultBodyLimit, Extension, Multipart, Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::post,
};
use chrono::{DateTime, Utc};
use serde_json::{Map, Value, json};
use sqlx::{PgConnection, Row};
use uuid::Uuid;

use super::store::{self, Cause, PARTY_CABINET};
use crate::audit;
use crate::auth::middleware::AuthUser;
use crate::routes::documents::MAX_FILE_SIZE;
use crate::routes::lead_payer::Declaration;
use crate::routes::lead_portal_intake::{
    self as intake, FieldError, UploadKind, clean_long_text, clean_text, coded, field_error,
};
use crate::state::AppState;

/// A reason of a staff decision must say something.
pub const MIN_REASON_CHARS: usize = 10;
pub const MAX_REASON_CHARS: usize = 2000;

/// The blocks the cabinet answers (D and E belong to the payer's link).
pub const CABINET_BLOCKS: [&str; 10] = ["A", "B", "C", "F", "G", "H", "I", "J", "K", "L"];

/// Longest reason of the request (13.1).
pub const REQUEST_REASON_MAX: usize = 4000;

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/me/lead-requests/{lead_id}/follow-up/submit",
            post(submit_follow_up),
        )
        .route(
            "/me/lead-requests/{lead_id}/relationship-proof",
            post(upload_relationship_proof)
                .layer(DefaultBodyLimit::max(MAX_FILE_SIZE + 1024 * 1024)),
        )
}

// ----------------------------------------------------------------------------
// The base form's keys
// ----------------------------------------------------------------------------

/// Staff's identity document data (patient and representatives).
pub const ID_DATA_KEYS: [&str; 6] = [
    "id_document_type",
    "id_document_number",
    "id_issuing_authority",
    "id_issuing_country",
    "id_issued_on",
    "id_valid_until",
];

/// A key of staff's identity data, also of a representative's slot
/// (`rep1_id_document_number`).
pub fn is_id_data_key(key: &str) -> bool {
    ID_DATA_KEYS
        .iter()
        .any(|data| key == *data || key.ends_with(&format!("_{data}")))
}

/// A key of an adult's representative or legal guardian (block G). Since
/// 2026-10-07 (owner) the base form asks them too: whoever acts for the lead
/// is identified before sending (§ 10 (1) Nr. 1 GwG); block G stays for what
/// is missing later or what staff request.
pub fn is_adult_representative_key(key: &str) -> bool {
    key.starts_with("agent_") || key.starts_with("guardian_")
}

/// Keys the base form no longer asks (contract 3.1): they belong to the
/// follow-up blocks or to staff.
const DROPPED_KEYS: [&str; 23] = [
    // The own economic interest: block L, only with the enhanced check (owner 2026-10-09).
    "payer_own_account",
    "payer_beneficial_owner",
    // Block L (owner 2026-10-09): the legal questions only with the enhanced check.
    "pep_self",
    "pep_related",
    "sanctions_links",
    // The legal-guardianship question (`under_guardianship`) is asked again
    // since 2026-10-10 (owner): it was switched off on 2026-10-09.
    // Block K (owner 2026-10-09): asked only with the enhanced check.
    "birth_place",
    "birth_country",
    "pep_self_details",
    "pep_related_details",
    "sanctions_links_details",
    "high_risk_country",
    "high_risk_country_code",
    "payment_background",
    "habitual_residence_country",
    // The bare payment method stays in the base form (owner 2026-10-10: cash or
    // crypto fires T9 at once); its details and the account are block C.
    "payment_method_details",
    "account_country",
    "account_holder",
    "bank_name",
    "via_third_party",
    "via_third_party_details",
    "self_funds_sources",
    "self_funds_description",
    "self_funds_proof_upload",
];

fn dropped(key: &str) -> bool {
    DROPPED_KEYS.contains(&key) || is_id_data_key(key) || key.starts_with("enhanced_")
}

/// What the base form needs besides the stored keys.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct BaseExtra {
    /// An organisation pays: its mask replaces e-mail and phone by one key.
    pub organisation: bool,
    /// The organisation mask's keys still open.
    pub organisation_missing: Vec<&'static str>,
    /// The lead's reason of the request is still empty.
    pub request_reason_missing: bool,
}

/// The base form's `missing_for_submit` after the trigger flow: the dropped
/// keys go, the organisation mask and the reason of the request join.
pub fn reshape_missing(missing: Vec<String>, extra: &BaseExtra) -> Vec<String> {
    let mut reshaped: Vec<String> = missing
        .into_iter()
        .filter(|key| !dropped(key))
        .filter(|key| {
            !(extra.organisation && matches!(key.as_str(), "payer_email" | "payer_phone"))
        })
        .collect();
    if !extra.organisation_missing.is_empty() {
        let at = reshaped
            .iter()
            .rposition(|key| {
                key.starts_with("payer_")
                    && !matches!(key.as_str(), "payer_own_account" | "payer_beneficial_owner")
            })
            .map(|index| index + 1)
            .unwrap_or(reshaped.len());
        for (offset, key) in extra.organisation_missing.iter().enumerate() {
            reshaped.insert(at + offset, key.to_string());
        }
    }
    if extra.request_reason_missing {
        reshaped.push("request_reason".to_string());
    }
    reshaped
}

/// The step of the cabinet a key of `missing_for_submit` belongs to.
pub fn step_of(key: &str) -> &'static str {
    match key {
        "street_address" | "zip_code" | "city" | "country" | "phone" | "primary_language"
        | "email" | "contact_channels" => "contact",
        "id_document_upload" => "identity",
        "pep_self" | "pep_related" | "sanctions_links" => "declarations",
        "request_reason" => "documents",
        "payment_method" => "billing",
        key if key.starts_with("payer_") => "payer",
        key if key.starts_with("invoice_")
            || key.starts_with("insurance_")
            || key == "has_insurance" =>
        {
            "billing"
        }
        _ => "person",
    }
}

/// `progress.missing_by_step`: every key of `missing_for_submit` under its
/// step, in order (the one source for the step badges).
pub fn missing_by_step(missing: &[String]) -> Value {
    let mut steps = Map::new();
    for step in [
        "person",
        "contact",
        "identity",
        "payer",
        "billing",
        "declarations",
        "documents",
    ] {
        steps.insert(step.to_string(), json!([]));
    }
    for key in missing {
        if let Some(Value::Array(keys)) = steps.get_mut(step_of(key)) {
            keys.push(json!(key));
        }
    }
    Value::Object(steps)
}

/// The base form's extra state of a lead (organisation mask, reason).
pub async fn base_extra(
    conn: &mut PgConnection,
    lead_id: Uuid,
    payer: Option<&Declaration>,
) -> Result<BaseExtra, sqlx::Error> {
    let row = sqlx::query(
        r#"SELECT d.organisation_legal_form, d.organisation_contact_name, g.request_reason
           FROM leads l
           LEFT JOIN lead_payer_declarations d ON d.lead_id = l.id
           LEFT JOIN lead_gwg_declarations g ON g.lead_id = l.id
           WHERE l.id = $1"#,
    )
    .bind(lead_id)
    .fetch_optional(&mut *conn)
    .await?;
    let text = |column: &str| {
        row.as_ref()
            .and_then(|row| row.try_get::<Option<String>, _>(column).ok().flatten())
            .filter(|value| !value.trim().is_empty())
    };
    let organisation = payer.is_some_and(Declaration::is_organisation);
    let mut organisation_missing = Vec::new();
    if let Some(payer) = payer.filter(|payer| payer.is_organisation()) {
        if text("organisation_legal_form").is_none() {
            organisation_missing.push("payer_legal_form");
        }
        if text("organisation_contact_name").is_none() {
            organisation_missing.push("payer_contact_name");
        }
        let filled = |value: &Option<String>| {
            value
                .as_deref()
                .is_some_and(|value| !value.trim().is_empty())
        };
        if !filled(&payer.email) && !filled(&payer.phone) {
            organisation_missing.push("payer_email_or_phone");
        }
    }
    Ok(BaseExtra {
        organisation,
        organisation_missing,
        request_reason_missing: text("request_reason").is_none(),
    })
}

// ----------------------------------------------------------------------------
// The follow-up blocks
// ----------------------------------------------------------------------------

/// `follow_up` of the request object: the cabinet blocks to answer, in
/// letter order, what each still misses and when the lead last sent them.
/// Nothing before the assessment started, and nothing after staff released
/// or rejected the lead (the answers stay).
pub async fn follow_up_json(
    conn: &mut PgConnection,
    lead_id: Uuid,
    caller: Uuid,
) -> Result<Value, sqlx::Error> {
    let assessment = store::load(conn, lead_id).await?;
    let answered_at = assessment
        .as_ref()
        .and_then(|assessment| assessment.follow_up_answered_at);
    let empty = json!({
        "required": false,
        "blocks": [],
        "missing": {},
        "answered_at": answered_at,
    });
    let Some(assessment) = assessment.filter(|assessment| {
        assessment.started()
            && !matches!(
                assessment.status.as_str(),
                store::STATUS_RELEASED | store::STATUS_REJECTED
            )
    }) else {
        return Ok(empty);
    };
    let Some(inputs) = super::inputs::load(conn, lead_id).await? else {
        return Ok(empty);
    };
    let config = store::load_config(conn).await?;
    let answers = store::load_block_answers(conn, lead_id, &inputs, Some(caller)).await?;
    let states = store::block_states(
        &assessment.triggers,
        assessment.score.level,
        &assessment.requested_blocks,
        &config,
        &answers,
    );
    let mut blocks = Vec::new();
    let mut missing = Map::new();
    for block in CABINET_BLOCKS {
        if let Some(state) = states.get(block)
            && state.open
            && state.party == PARTY_CABINET
        {
            blocks.push(block);
            missing.insert(block.to_string(), json!(state.missing));
        }
    }
    // Block I is answered by a copy uploaded after staff entered the identity
    // data (`identity_uploaded_since_entry`): the cabinet lists only those
    // (QA 2026-10-10, an expired passport's old scan looked like the answer).
    let identity_since = blocks
        .contains(&"I")
        .then_some(answers.identity_entered_at)
        .flatten();
    Ok(json!({
        "required": !blocks.is_empty(),
        "blocks": blocks,
        "missing": missing,
        "answered_at": answered_at,
        "identity_since": identity_since,
    }))
}

/// The cabinet blocks that still miss something (for `follow-up/submit`).
async fn follow_up_missing(
    conn: &mut PgConnection,
    lead_id: Uuid,
    caller: Uuid,
) -> Result<Map<String, Value>, sqlx::Error> {
    let follow_up = follow_up_json(conn, lead_id, caller).await?;
    Ok(follow_up["missing"]
        .as_object()
        .map(|missing| {
            missing
                .iter()
                .filter(|(_, keys)| keys.as_array().is_some_and(|keys| !keys.is_empty()))
                .map(|(block, keys)| (block.clone(), keys.clone()))
                .collect()
        })
        .unwrap_or_default())
}

/// "Send to the manager" while follow-up blocks are open and already complete
/// (QA 2026-10-10, C2-c: the lead filled the extra step before sending): the
/// send counts as the follow-up's answer too, so the lead is not asked to send
/// twice. Records it like `follow-up/submit`; `true` when it did. Nothing while
/// no block is open, a block still misses something or the answer is recorded.
pub async fn answer_complete_follow_up(
    conn: &mut PgConnection,
    lead_id: Uuid,
    actor: Uuid,
) -> Result<bool, sqlx::Error> {
    let follow_up = follow_up_json(conn, lead_id, actor).await?;
    if follow_up["required"] != json!(true) || !follow_up["answered_at"].is_null() {
        return Ok(false);
    }
    let complete = follow_up["missing"].as_object().is_some_and(|missing| {
        missing
            .values()
            .all(|keys| keys.as_array().is_some_and(|keys| keys.is_empty()))
    });
    if !complete {
        return Ok(false);
    }
    store::follow_up_answered(conn, lead_id, actor).await?;
    Ok(true)
}

/// Reassesses after a cabinet write (in its own transaction, right after the
/// write's commit) — every load of the request object does this, so every
/// write, the submit and the follow-up are scored (P3). Nothing is stored
/// before the assessment started.
pub async fn reassess_for_cabinet(
    db: &gmed_db::DbPool,
    lead_id: Uuid,
    actor: Uuid,
) -> Result<(), sqlx::Error> {
    let mut tx = db.begin().await?;
    store::reassess(&mut tx, lead_id, Cause::Cabinet, Some(actor)).await?;
    tx.commit().await
}

/// `POST /me/lead-requests/{lead_id}/follow-up/submit`: the lead sends the
/// answers of the follow-up blocks. 422 `follow_up_incomplete` with
/// `missing` while a block misses something; otherwise records the time,
/// reassesses, tells the lead's staff and returns the request object.
async fn submit_follow_up(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(lead_id): Path<Uuid>,
) -> Response {
    if let Err(response) = intake::require_patient(&auth) {
        return response;
    }
    let mut tx = match state.db.begin().await {
        Ok(tx) => tx,
        Err(error) => return intake::internal(error, "begin"),
    };
    let kind = match intake::lock_my_lead(&mut tx, lead_id, auth.user_id).await {
        Ok(Some((kind, _))) => kind,
        Ok(None) => return intake::not_found(),
        Err(error) => return intake::internal(error, "lock request"),
    };
    if let Err(error) = store::reassess(&mut tx, lead_id, Cause::Cabinet, Some(auth.user_id)).await
    {
        return intake::internal(error, "reassess");
    }
    let missing = match follow_up_missing(&mut tx, lead_id, auth.user_id).await {
        Ok(missing) => missing,
        Err(error) => return intake::internal(error, "load follow-up"),
    };
    if !missing.is_empty() {
        return coded(
            StatusCode::UNPROCESSABLE_ENTITY,
            "follow_up_incomplete",
            "Please complete the additional information first",
            json!({ "missing": missing }),
        );
    }
    match store::follow_up_answered(&mut tx, lead_id, auth.user_id).await {
        Ok(_) => {}
        Err(error) => return intake::internal(error, "record follow-up"),
    }
    if let Err(error) = tx.commit().await {
        return intake::internal(error, "commit follow-up");
    }
    intake::notify_lead_staff(
        &state,
        lead_id,
        "lead_portal_follow_up_submitted",
        "Patient sent the additional information",
        "The additional information of the request was sent.",
    )
    .await;
    crate::realtime::publish_lead_event(
        &state,
        Some(auth.user_id),
        "lead.portal_updated",
        lead_id,
        json!({ "change": "follow_up", "access_kind": kind.as_str() }),
    )
    .await;
    match intake::request_payload(&state, lead_id, auth.user_id, kind).await {
        Ok(payload) => Json(payload).into_response(),
        Err(error) => intake::internal(error, "load request"),
    }
}

/// `POST /me/lead-requests/{lead_id}/relationship-proof` (multipart
/// `file`): the proof of the relationship to the paying person (block B;
/// PDF, JPG or PNG), under the consent to process the request data; only
/// while a third party pays (409 `payer_not_third_party`). Withdrawn through
/// the cabinet's DELETE like the other uploads.
async fn upload_relationship_proof(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(lead_id): Path<Uuid>,
    multipart: Multipart,
) -> Response {
    intake::store_my_upload(
        state,
        auth,
        lead_id,
        multipart,
        UploadKind::RelationshipProof,
        None,
    )
    .await
}

// ----------------------------------------------------------------------------
// New statements on `lead_gwg_declarations` (F, B, H, J, reason)
// ----------------------------------------------------------------------------

/// The keys `…/identification` takes besides the base statements.
pub const STATEMENT_KEYS: [&str; 15] = [
    "residence_since",
    "other_residences",
    "former_citizenships",
    "stay_reason",
    "stay_reason_details",
    "relationship_since",
    "pep_office",
    "pep_country",
    "pep_period",
    "pep_relationship",
    "pep_wealth_origin",
    "sanctions_link_name",
    "sanctions_link_kind",
    "sanctions_link_since_extent",
    "request_reason",
];

/// Block F: why the lead lives in the country of residence; `citizenship_or_birth` for a
/// citizen of that country or a person born there (QA 2026-10-10).
const STAY_REASONS: [&str; 5] = ["citizenship_or_birth", "work", "study", "family", "other"];
const SANCTIONS_LINK_KINDS: [&str; 4] = ["family", "business", "ownership", "other"];

/// The new statements of a lead.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Statements {
    pub residence_since: Option<String>,
    pub other_residences: Option<String>,
    pub former_citizenships: Vec<String>,
    pub stay_reason: Option<String>,
    pub stay_reason_details: Option<String>,
    pub relationship_since: Option<String>,
    pub pep_office: Option<String>,
    pub pep_country: Option<String>,
    pub pep_period: Option<String>,
    pub pep_relationship: Option<String>,
    pub pep_wealth_origin: Option<String>,
    pub sanctions_link_name: Option<String>,
    pub sanctions_link_kind: Option<String>,
    pub sanctions_link_since_extent: Option<String>,
    pub request_reason: Option<String>,
    pub request_reason_updated_at: Option<DateTime<Utc>>,
}

impl Statements {
    fn from_row(row: &sqlx::postgres::PgRow) -> Self {
        let text = |column: &str| row.try_get::<Option<String>, _>(column).ok().flatten();
        Statements {
            residence_since: text("residence_since"),
            other_residences: text("other_residences"),
            former_citizenships: row
                .try_get::<Option<Vec<String>>, _>("former_citizenships")
                .ok()
                .flatten()
                .unwrap_or_default(),
            stay_reason: text("stay_reason"),
            stay_reason_details: text("stay_reason_details"),
            relationship_since: text("relationship_since"),
            pep_office: text("pep_office"),
            pep_country: text("pep_country"),
            pep_period: text("pep_period"),
            pep_relationship: text("pep_relationship"),
            pep_wealth_origin: text("pep_wealth_origin"),
            sanctions_link_name: text("sanctions_link_name"),
            sanctions_link_kind: text("sanctions_link_kind"),
            sanctions_link_since_extent: text("sanctions_link_since_extent"),
            request_reason: text("request_reason"),
            request_reason_updated_at: row.try_get("request_reason_updated_at").ok().flatten(),
        }
    }

    /// The statements without the reason of the request (for every reader of
    /// the GwG statements).
    pub fn gwg_json(&self) -> Map<String, Value> {
        let value = json!({
            "residence_since": self.residence_since,
            "other_residences": self.other_residences,
            "former_citizenships": self.former_citizenships,
            "stay_reason": self.stay_reason,
            "stay_reason_details": self.stay_reason_details,
            "relationship_since": self.relationship_since,
            "pep_office": self.pep_office,
            "pep_country": self.pep_country,
            "pep_period": self.pep_period,
            "pep_relationship": self.pep_relationship,
            "pep_wealth_origin": self.pep_wealth_origin,
            "sanctions_link_name": self.sanctions_link_name,
            "sanctions_link_kind": self.sanctions_link_kind,
            "sanctions_link_since_extent": self.sanctions_link_since_extent,
        });
        match value {
            Value::Object(map) => map,
            _ => Map::new(),
        }
    }
}

/// The new statements of a lead (nothing entered while there is no row).
pub async fn load_statements(
    conn: &mut PgConnection,
    lead_id: Uuid,
) -> Result<Statements, sqlx::Error> {
    Ok(
        sqlx::query("SELECT * FROM lead_gwg_declarations WHERE lead_id = $1")
            .bind(lead_id)
            .fetch_optional(&mut *conn)
            .await?
            .as_ref()
            .map(Statements::from_row)
            .unwrap_or_default(),
    )
}

fn one_of_text(
    value: &Value,
    field: &'static str,
    allowed: &[&str],
) -> Result<Option<String>, FieldError> {
    match value {
        Value::Null => Ok(None),
        Value::String(text) if text.trim().is_empty() => Ok(None),
        Value::String(text) if allowed.contains(&text.trim()) => Ok(Some(text.trim().to_string())),
        _ => Err(field_error(field, "Not one of the allowed values")),
    }
}

fn text_of(value: &Value, field: &'static str) -> Result<String, FieldError> {
    match value {
        Value::Null => Ok(String::new()),
        Value::String(text) => Ok(text.clone()),
        _ => Err(field_error(field, "A text is expected")),
    }
}

fn iso_code(value: &str, field: &'static str) -> Result<Option<String>, FieldError> {
    let code = value.trim().to_ascii_uppercase();
    if code.is_empty() {
        return Ok(None);
    }
    if code.len() != 2 || !code.chars().all(|ch| ch.is_ascii_uppercase()) {
        return Err(field_error(field, "Use an ISO country code"));
    }
    Ok(Some(code))
}

/// Applies the new statements of a body to `current` (only the sent keys;
/// `null` or `""` clears).
pub fn apply_statements(
    current: &Statements,
    body: &Map<String, Value>,
) -> Result<Statements, FieldError> {
    let mut next = current.clone();
    for (key, value) in body {
        match key.as_str() {
            "residence_since" => {
                next.residence_since =
                    clean_text(&text_of(value, "residence_since")?, "residence_since", 60)?;
            }
            "other_residences" => {
                next.other_residences = clean_long_text(
                    &text_of(value, "other_residences")?,
                    "other_residences",
                    2000,
                )?;
            }
            "former_citizenships" => {
                let mut codes = Vec::new();
                match value {
                    Value::Null => {}
                    Value::Array(items) => {
                        for item in items {
                            let Some(text) = item.as_str() else {
                                return Err(field_error(
                                    "former_citizenships",
                                    "Use ISO country codes",
                                ));
                            };
                            if let Some(code) = iso_code(text, "former_citizenships")?
                                && !codes.contains(&code)
                            {
                                codes.push(code);
                            }
                        }
                    }
                    _ => return Err(field_error("former_citizenships", "A list is expected")),
                }
                if codes.len() > 10 {
                    return Err(field_error("former_citizenships", "Too many"));
                }
                next.former_citizenships = codes;
            }
            "stay_reason" => next.stay_reason = one_of_text(value, "stay_reason", &STAY_REASONS)?,
            "stay_reason_details" => {
                next.stay_reason_details = clean_long_text(
                    &text_of(value, "stay_reason_details")?,
                    "stay_reason_details",
                    2000,
                )?;
            }
            "relationship_since" => {
                next.relationship_since = clean_text(
                    &text_of(value, "relationship_since")?,
                    "relationship_since",
                    100,
                )?;
            }
            "pep_office" => {
                next.pep_office =
                    clean_long_text(&text_of(value, "pep_office")?, "pep_office", 2000)?;
            }
            "pep_country" => {
                next.pep_country = iso_code(&text_of(value, "pep_country")?, "pep_country")?
            }
            "pep_period" => {
                next.pep_period =
                    clean_long_text(&text_of(value, "pep_period")?, "pep_period", 2000)?;
            }
            "pep_relationship" => {
                next.pep_relationship = clean_long_text(
                    &text_of(value, "pep_relationship")?,
                    "pep_relationship",
                    2000,
                )?;
            }
            "pep_wealth_origin" => {
                next.pep_wealth_origin = clean_long_text(
                    &text_of(value, "pep_wealth_origin")?,
                    "pep_wealth_origin",
                    2000,
                )?;
            }
            "sanctions_link_name" => {
                next.sanctions_link_name = clean_long_text(
                    &text_of(value, "sanctions_link_name")?,
                    "sanctions_link_name",
                    2000,
                )?;
            }
            "sanctions_link_kind" => {
                next.sanctions_link_kind =
                    one_of_text(value, "sanctions_link_kind", &SANCTIONS_LINK_KINDS)?;
            }
            "sanctions_link_since_extent" => {
                next.sanctions_link_since_extent = clean_long_text(
                    &text_of(value, "sanctions_link_since_extent")?,
                    "sanctions_link_since_extent",
                    2000,
                )?;
            }
            "request_reason" => {
                next.request_reason = clean_long_text(
                    &text_of(value, "request_reason")?,
                    "request_reason",
                    REQUEST_REASON_MAX,
                )?;
            }
            _ => {}
        }
    }
    Ok(next)
}

/// The keys whose value differs.
pub fn changed_statements(before: &Statements, after: &Statements) -> Vec<&'static str> {
    let (mut left, mut right) = (before.gwg_json(), after.gwg_json());
    left.insert("request_reason".into(), json!(before.request_reason));
    right.insert("request_reason".into(), json!(after.request_reason));
    STATEMENT_KEYS
        .iter()
        .copied()
        .filter(|key| left.get(*key) != right.get(*key))
        .collect()
}

/// Splits the body of `…/identification`: staff's identity data → 422
/// `staff_only`; the new statements are returned apart; the rest is the
/// base patch.
pub fn split_identification_body(body: Value) -> Result<(Value, Map<String, Value>), Response> {
    let Value::Object(mut object) = body else {
        return Ok((body, Map::new()));
    };
    if let Some(field) = object.keys().find(|key| is_id_data_key(key)) {
        return Err(staff_only(field));
    }
    let mut statements = Map::new();
    for key in STATEMENT_KEYS {
        if let Some(value) = object.remove(key) {
            statements.insert(key.to_string(), value);
        }
    }
    Ok((Value::Object(object), statements))
}

/// 422 `staff_only`: staff enter this field.
pub fn staff_only(field: &str) -> Response {
    coded(
        StatusCode::UNPROCESSABLE_ENTITY,
        "staff_only",
        "GMED enters this information",
        json!({ "field": field }),
    )
}

/// Stores the new statements in the caller's transaction (the base
/// statements' row is created if needed; `updated_by` names the lead).
pub async fn store_statements(
    conn: &mut PgConnection,
    lead_id: Uuid,
    statements: &Statements,
    reason_changed: bool,
    actor: Uuid,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"INSERT INTO lead_gwg_declarations (
               lead_id, residence_since, other_residences, former_citizenships, stay_reason,
               stay_reason_details, relationship_since, pep_office, pep_country, pep_period,
               pep_relationship, pep_wealth_origin, sanctions_link_name, sanctions_link_kind,
               sanctions_link_since_extent, request_reason, request_reason_updated_at, updated_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16,
                   CASE WHEN $17 THEN now() END, $18)
           ON CONFLICT (lead_id) DO UPDATE SET
               residence_since = EXCLUDED.residence_since,
               other_residences = EXCLUDED.other_residences,
               former_citizenships = EXCLUDED.former_citizenships,
               stay_reason = EXCLUDED.stay_reason,
               stay_reason_details = EXCLUDED.stay_reason_details,
               relationship_since = EXCLUDED.relationship_since,
               pep_office = EXCLUDED.pep_office,
               pep_country = EXCLUDED.pep_country,
               pep_period = EXCLUDED.pep_period,
               pep_relationship = EXCLUDED.pep_relationship,
               pep_wealth_origin = EXCLUDED.pep_wealth_origin,
               sanctions_link_name = EXCLUDED.sanctions_link_name,
               sanctions_link_kind = EXCLUDED.sanctions_link_kind,
               sanctions_link_since_extent = EXCLUDED.sanctions_link_since_extent,
               request_reason = EXCLUDED.request_reason,
               request_reason_updated_at = CASE WHEN $17 THEN now()
                   ELSE lead_gwg_declarations.request_reason_updated_at END,
               updated_by = EXCLUDED.updated_by,
               updated_at = now()"#,
    )
    .bind(lead_id)
    .bind(&statements.residence_since)
    .bind(&statements.other_residences)
    .bind(&statements.former_citizenships)
    .bind(&statements.stay_reason)
    .bind(&statements.stay_reason_details)
    .bind(&statements.relationship_since)
    .bind(&statements.pep_office)
    .bind(&statements.pep_country)
    .bind(&statements.pep_period)
    .bind(&statements.pep_relationship)
    .bind(&statements.pep_wealth_origin)
    .bind(&statements.sanctions_link_name)
    .bind(&statements.sanctions_link_kind)
    .bind(&statements.sanctions_link_since_extent)
    .bind(&statements.request_reason)
    .bind(reason_changed)
    .bind(actor)
    .execute(&mut *conn)
    .await
    .map(|_| ())
}

/// Applies and stores the new statements of an `…/identification` body;
/// the changed keys.
pub async fn save_statements(
    conn: &mut PgConnection,
    lead_id: Uuid,
    body: &Map<String, Value>,
    actor: Uuid,
) -> Result<Result<Vec<&'static str>, FieldError>, sqlx::Error> {
    if body.is_empty() {
        return Ok(Ok(Vec::new()));
    }
    let current = load_statements(conn, lead_id).await?;
    let next = match apply_statements(&current, body) {
        Ok(next) => next,
        Err(error) => return Ok(Err(error)),
    };
    let changed = changed_statements(&current, &next);
    if !changed.is_empty() {
        store_statements(
            conn,
            lead_id,
            &next,
            changed.contains(&"request_reason"),
            actor,
        )
        .await?;
    }
    Ok(Ok(changed))
}

/// The cabinet's `identification` object after the trigger flow: without
/// staff's identity data, with the new statements and the reason of the
/// request (the lead's own text).
pub fn cabinet_identification(mut base: Value, statements: &Statements) -> Value {
    if let Some(object) = base.as_object_mut() {
        for key in ID_DATA_KEYS {
            object.remove(key);
        }
        for (key, value) in statements.gwg_json() {
            object.insert(key, value);
        }
        object.insert("request_reason".into(), json!(statements.request_reason));
        object.insert(
            "request_reason_updated_at".into(),
            json!(statements.request_reason_updated_at),
        );
    }
    base
}

/// The staff view of the lead's statements (`GET /leads/{id}/portal-intake`):
/// the base statements with the follow-up blocks' answers, staff's identity
/// data with who entered them; and the lead's own reason of the request
/// (13.1, medical: only with `medical`, never for Sales).
pub async fn staff_statements(
    db: &gmed_db::DbPool,
    lead_id: Uuid,
    mut base: Value,
    statements_visible: bool,
    medical: bool,
) -> Result<(Value, Value), sqlx::Error> {
    let mut conn = db.acquire().await?;
    let statements = load_statements(&mut conn, lead_id).await?;
    if statements_visible && let Some(object) = base.as_object_mut() {
        for (key, value) in statements.gwg_json() {
            object.insert(key, value);
        }
        let row = sqlx::query(
            r#"SELECT g.id_document_unreadable, g.id_data_entered_by, g.id_data_entered_at,
                      u.name AS id_data_entered_by_name
               FROM lead_gwg_declarations g
               LEFT JOIN users u ON u.id = g.id_data_entered_by
               WHERE g.lead_id = $1"#,
        )
        .bind(lead_id)
        .fetch_optional(&mut *conn)
        .await?;
        object.insert(
            "id_document_unreadable".into(),
            json!(
                row.as_ref()
                    .and_then(|row| row.try_get::<bool, _>("id_document_unreadable").ok())
                    .unwrap_or(false)
            ),
        );
        object.insert(
            "id_data_entered_by".into(),
            json!(row.as_ref().and_then(|row| {
                row.try_get::<Option<Uuid>, _>("id_data_entered_by")
                    .ok()
                    .flatten()
            })),
        );
        object.insert(
            "id_data_entered_by_name".into(),
            json!(row.as_ref().and_then(|row| {
                row.try_get::<Option<String>, _>("id_data_entered_by_name")
                    .ok()
                    .flatten()
            })),
        );
        object.insert(
            "id_data_entered_at".into(),
            json!(row.as_ref().and_then(|row| {
                row.try_get::<Option<DateTime<Utc>>, _>("id_data_entered_at")
                    .ok()
                    .flatten()
            })),
        );
    }
    let reason = if medical && statements.request_reason.is_some() {
        json!({
            "text": statements.request_reason,
            "updated_at": statements.request_reason_updated_at,
        })
    } else {
        Value::Null
    };
    Ok((base, reason))
}

// ----------------------------------------------------------------------------
// "Who pays": the organisation mask; block C
// ----------------------------------------------------------------------------

pub const ORGANISATION_KEYS: [&str; 3] = [
    "organisation_legal_form",
    "organisation_register_number",
    "organisation_contact_name",
];

pub const BLOCK_C_KEYS: [&str; 2] = ["expected_total_eur", "via_third_party_kind"];

/// Removes `keys` from an object body and returns them.
pub fn take_keys(body: &mut Value, keys: &[&str]) -> Map<String, Value> {
    let mut taken = Map::new();
    if let Some(object) = body.as_object_mut() {
        for key in keys {
            if let Some(value) = object.remove(*key) {
                taken.insert(key.to_string(), value);
            }
        }
    }
    taken
}

/// Stores the organisation mask after a save of "who pays": the sent keys
/// for an organisation; a person or a self-payer clears the mask. The
/// changed keys.
pub async fn save_organisation_mask(
    conn: &mut PgConnection,
    lead_id: Uuid,
    mask: &Map<String, Value>,
) -> Result<Result<Vec<&'static str>, FieldError>, sqlx::Error> {
    let Some(row) = sqlx::query(
        r#"SELECT payer_kind, payer_type, organisation_legal_form, organisation_register_number,
                  organisation_contact_name
           FROM lead_payer_declarations WHERE lead_id = $1 FOR UPDATE"#,
    )
    .bind(lead_id)
    .fetch_optional(&mut *conn)
    .await?
    else {
        return Ok(Ok(Vec::new()));
    };
    let text = |column: &str| row.try_get::<Option<String>, _>(column).ok().flatten();
    let organisation = text("payer_kind").as_deref() == Some("third_party")
        && text("payer_type")
            .is_some_and(|kind| kind != crate::routes::lead_payer::PAYER_TYPE_PERSON);
    let current = [
        text("organisation_legal_form"),
        text("organisation_register_number"),
        text("organisation_contact_name"),
    ];
    let mut next = current.clone();
    if organisation {
        for (index, (key, limit)) in [
            ("organisation_legal_form", 100),
            ("organisation_register_number", 60),
            ("organisation_contact_name", 200),
        ]
        .into_iter()
        .enumerate()
        {
            if let Some(value) = mask.get(key) {
                next[index] =
                    match text_of(value, key).and_then(|value| clean_text(&value, key, limit)) {
                        Ok(value) => value,
                        Err(error) => return Ok(Err(error)),
                    };
            }
        }
    } else {
        next = [None, None, None];
    }
    let changed: Vec<&'static str> = ORGANISATION_KEYS
        .iter()
        .enumerate()
        .filter(|(index, _)| current[*index] != next[*index])
        .map(|(_, key)| *key)
        .collect();
    if !changed.is_empty() {
        sqlx::query(
            r#"UPDATE lead_payer_declarations
               SET organisation_legal_form = $2, organisation_register_number = $3,
                   organisation_contact_name = $4, updated_at = now()
               WHERE lead_id = $1"#,
        )
        .bind(lead_id)
        .bind(&next[0])
        .bind(&next[1])
        .bind(&next[2])
        .execute(&mut *conn)
        .await?;
    }
    Ok(Ok(changed))
}

/// Block C's keys after a billing save: the expected total (≥ 0, at most
/// 9 999 999 999.99) and through whom another person pays (`person` /
/// `psp`, only while `via_third_party`). The changed keys.
pub async fn save_block_c(
    conn: &mut PgConnection,
    lead_id: Uuid,
    keys: &Map<String, Value>,
) -> Result<Result<Vec<&'static str>, FieldError>, sqlx::Error> {
    let Some(row) = sqlx::query(
        r#"SELECT via_third_party, expected_total_eur::float8 AS expected_total_eur,
                  via_third_party_kind
           FROM lead_payer_declarations WHERE lead_id = $1 FOR UPDATE"#,
    )
    .bind(lead_id)
    .fetch_optional(&mut *conn)
    .await?
    else {
        return Ok(Ok(Vec::new()));
    };
    let via: bool = row
        .try_get::<Option<bool>, _>("via_third_party")
        .ok()
        .flatten()
        .unwrap_or(false);
    let current_total: Option<f64> = row.try_get("expected_total_eur").ok().flatten();
    let current_kind: Option<String> = row.try_get("via_third_party_kind").ok().flatten();
    let mut total = current_total;
    let mut kind = current_kind.clone();
    if let Some(value) = keys.get("expected_total_eur") {
        total = match value {
            Value::Null => None,
            Value::String(text) if text.trim().is_empty() => None,
            Value::String(text) => match text.trim().replace(',', ".").parse::<f64>() {
                Ok(amount) => Some(amount),
                Err(_) => {
                    return Ok(Err(field_error(
                        "expected_total_eur",
                        "A number is expected",
                    )));
                }
            },
            Value::Number(number) => number.as_f64(),
            _ => {
                return Ok(Err(field_error(
                    "expected_total_eur",
                    "A number is expected",
                )));
            }
        };
        if let Some(amount) = total
            && !(amount.is_finite() && (0.0..10_000_000_000.0).contains(&amount))
        {
            return Ok(Err(field_error("expected_total_eur", "Out of range")));
        }
        total = total.map(|amount| (amount * 100.0).round() / 100.0);
    }
    if let Some(value) = keys.get("via_third_party_kind") {
        kind = match one_of_text(value, "via_third_party_kind", &["person", "psp"]) {
            Ok(kind) => kind,
            Err(error) => return Ok(Err(error)),
        };
    }
    if !via {
        kind = None;
    }
    let mut changed = Vec::new();
    if total != current_total {
        changed.push("expected_total_eur");
    }
    if kind != current_kind {
        changed.push("via_third_party_kind");
    }
    if !changed.is_empty() {
        sqlx::query(
            r#"UPDATE lead_payer_declarations
               SET expected_total_eur = $2::float8::numeric(12, 2), via_third_party_kind = $3,
                   updated_at = now()
               WHERE lead_id = $1"#,
        )
        .bind(lead_id)
        .bind(total)
        .bind(&kind)
        .execute(&mut *conn)
        .await?;
    }
    Ok(Ok(changed))
}

/// The organisation mask and block C's values for the cabinet (`payer` and
/// `billing` of the request object get them).
pub async fn payer_extras(
    conn: &mut PgConnection,
    lead_id: Uuid,
) -> Result<(Value, Value), sqlx::Error> {
    let row = sqlx::query(
        r#"SELECT organisation_legal_form, organisation_register_number,
                  organisation_contact_name, expected_total_eur::float8 AS expected_total_eur,
                  via_third_party_kind
           FROM lead_payer_declarations WHERE lead_id = $1"#,
    )
    .bind(lead_id)
    .fetch_optional(&mut *conn)
    .await?;
    let text = |column: &str| {
        row.as_ref()
            .and_then(|row| row.try_get::<Option<String>, _>(column).ok().flatten())
    };
    let total: Option<f64> = row
        .as_ref()
        .and_then(|row| row.try_get("expected_total_eur").ok().flatten());
    Ok((
        json!({
            "organisation_legal_form": text("organisation_legal_form"),
            "organisation_register_number": text("organisation_register_number"),
            "organisation_contact_name": text("organisation_contact_name"),
        }),
        json!({
            "expected_total_eur": total.map(|amount| format!("{amount:.2}")),
            "via_third_party_kind": text("via_third_party_kind"),
        }),
    ))
}

/// Merges `extra` into the object `target` (when both are objects).
pub fn merge_into(target: &mut Value, extra: Value) {
    if let (Some(target), Value::Object(extra)) = (target.as_object_mut(), extra) {
        for (key, value) in extra {
            target.insert(key, value);
        }
    }
}

/// Writes the audit event of a write of new keys (names only).
pub async fn audit_keys(
    conn: &mut PgConnection,
    action: &str,
    actor: Uuid,
    lead_id: Uuid,
    fields: &[&str],
    access_kind: &str,
) -> Result<(), sqlx::Error> {
    audit::write_in_transaction(
        conn,
        &audit::domain_event(
            action,
            Some(actor),
            "lead",
            Some(lead_id),
            json!({ "fields": fields, "access_kind": access_kind }),
        ),
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn keys(values: &[&str]) -> Vec<String> {
        values.iter().map(|value| value.to_string()).collect()
    }

    #[test]
    fn the_base_form_drops_staff_and_follow_up_keys() {
        let missing = keys(&[
            "first_name",
            "payer_kind",
            "payer_email",
            "birth_place",
            "id_document_type",
            "id_valid_until",
            "id_document_upload",
            "rep1_first_name",
            "rep1_id_document_number",
            "agent_first_name",
            "guardian_id_upload",
            "has_representative",
            "under_guardianship",
            "payer_own_account",
            "invoice_to",
            "payment_method",
            "via_third_party",
            "pep_self",
            "pep_self_details",
            "high_risk_country",
            "sanctions_links",
            "payment_background",
            "enhanced_funds_source",
        ]);
        assert_eq!(
            reshape_missing(
                missing,
                &BaseExtra {
                    request_reason_missing: true,
                    ..BaseExtra::default()
                }
            ),
            keys(&[
                "first_name",
                "payer_kind",
                "payer_email",
                "id_document_upload",
                "rep1_first_name",
                "agent_first_name",
                "guardian_id_upload",
                "has_representative",
                // Asked again since 2026-10-10 (owner).
                "under_guardianship",
                "invoice_to",
                "payment_method",
                "request_reason",
            ])
        );
    }

    #[test]
    fn an_organisation_has_its_own_mask() {
        let missing = keys(&[
            "payer_organisation_name",
            "payer_country",
            "payer_email",
            "payer_phone",
            "payer_contact_consent",
            "birth_place",
        ]);
        assert_eq!(
            reshape_missing(
                missing,
                &BaseExtra {
                    organisation: true,
                    organisation_missing: vec![
                        "payer_legal_form",
                        "payer_contact_name",
                        "payer_email_or_phone"
                    ],
                    request_reason_missing: false,
                }
            ),
            keys(&[
                "payer_organisation_name",
                "payer_country",
                "payer_contact_consent",
                "payer_legal_form",
                "payer_contact_name",
                "payer_email_or_phone",
            ])
        );
    }

    #[test]
    fn every_key_has_a_step() {
        let by_step = missing_by_step(&keys(&[
            "first_name",
            "birth_place",
            "has_representative",
            "under_guardianship",
            "rep1_phone",
            "street_address",
            "id_document_upload",
            "payer_kind",
            "payer_own_account",
            "invoice_to",
            "has_insurance",
            "pep_related",
            "request_reason",
        ]));
        assert_eq!(
            by_step,
            json!({
                "person": ["first_name", "birth_place", "has_representative", "under_guardianship", "rep1_phone"],
                "contact": ["street_address"],
                "identity": ["id_document_upload"],
                "payer": ["payer_kind", "payer_own_account"],
                "billing": ["invoice_to", "has_insurance"],
                "declarations": ["pep_related"],
                "documents": ["request_reason"],
            })
        );
    }

    #[test]
    fn identification_bodies_are_split_and_staff_data_refused() {
        let (base, statements) = split_identification_body(json!({
            "birth_place": "Kyiv",
            "residence_since": "2019",
            "request_reason": "Zweitmeinung",
        }))
        .unwrap();
        assert_eq!(base, json!({ "birth_place": "Kyiv" }));
        assert_eq!(statements.len(), 2);
        for key in ["id_document_number", "id_valid_until", "id_issued_on"] {
            assert!(
                split_identification_body(json!({ key: "x" })).is_err(),
                "{key}"
            );
        }
        assert!(is_id_data_key("rep2_id_issuing_country"));
        assert!(!is_id_data_key("id_document_upload"));
    }

    #[test]
    fn statements_are_validated() {
        let body = |value: Value| value.as_object().cloned().unwrap();
        let next = apply_statements(
            &Statements::default(),
            &body(json!({
                "former_citizenships": ["sy", "SY", "ua"],
                "stay_reason": "work",
                "pep_country": "ru",
                "request_reason": "  Zweitmeinung zur Knie-OP\n",
            })),
        )
        .unwrap();
        assert_eq!(next.former_citizenships, keys(&["SY", "UA"]));
        assert_eq!(next.pep_country.as_deref(), Some("RU"));
        assert_eq!(
            next.request_reason.as_deref(),
            Some("Zweitmeinung zur Knie-OP")
        );
        assert_eq!(
            changed_statements(&Statements::default(), &next),
            [
                "former_citizenships",
                "stay_reason",
                "pep_country",
                "request_reason"
            ]
        );
        assert!(apply_statements(&next, &body(json!({ "stay_reason": "tourism" }))).is_err());
        assert!(apply_statements(&next, &body(json!({ "sanctions_link_kind": "x" }))).is_err());
        assert!(
            apply_statements(
                &next,
                &body(json!({ "request_reason": "x".repeat(REQUEST_REASON_MAX + 1) }))
            )
            .is_err()
        );
        assert!(
            apply_statements(&next, &body(json!({ "residence_since": "x".repeat(61) }))).is_err()
        );
        let cleared = apply_statements(&next, &body(json!({ "stay_reason": null }))).unwrap();
        assert_eq!(cleared.stay_reason, None);
        // A citizen of the country or a person born there has an answer of its own (QA 2026-10-10).
        let citizen = apply_statements(
            &next,
            &body(json!({ "stay_reason": "citizenship_or_birth" })),
        )
        .unwrap();
        assert_eq!(citizen.stay_reason.as_deref(), Some("citizenship_or_birth"));
    }

    #[test]
    fn the_cabinet_identification_has_no_staff_data() {
        let base =
            json!({ "birth_place": "Kyiv", "id_document_number": "AB1", "id_valid_until": null });
        let statements = Statements {
            request_reason: Some("Zweitmeinung".into()),
            ..Statements::default()
        };
        let value = cabinet_identification(base, &statements);
        assert!(value.get("id_document_number").is_none());
        assert!(value.get("id_valid_until").is_none());
        assert_eq!(value["request_reason"], "Zweitmeinung");
        assert!(value.get("residence_since").is_some());
    }
}
