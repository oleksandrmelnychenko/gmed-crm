//! The stored assessment of a lead: [`reassess`] (the ratchet in the
//! database), [`start`], the follow-up blocks ([`block_states`]), the status,
//! the history and the staff decisions with four eyes at level 3.
//!
//! Every function works in the caller's connection or transaction; history
//! rows and their audit events are written in it (transaction-coupled audit,
//! docs/engineering/02_audit-migration-policy_ua.md).

use std::collections::BTreeMap;

use chrono::{DateTime, NaiveDate, Utc};
use serde::Serialize;
use serde_json::{Value, json};
use sqlx::{PgConnection, Row};
use uuid::Uuid;

use super::{
    BLOCKS, Fired, Inputs, RiskConfig, Score, Sticky, blocks_of, evaluate, fingerprint, merge,
    score, within_release,
};
use crate::audit;
use crate::routes::lead_payer::{self, Declaration, PaymentRouteBy};
use crate::routes::lead_representatives;

pub const STATUS_CLEAR: &str = "clear";
pub const STATUS_AWAITING: &str = "awaiting_answers";
pub const STATUS_REVIEW: &str = "review_required";
pub const STATUS_PROPOSED: &str = "proposed";
pub const STATUS_RELEASED: &str = "released";
pub const STATUS_REJECTED: &str = "rejected";
pub const STATUS_GRANDFATHERED: &str = "grandfathered";

pub const NOTIFY_REVIEW_REQUIRED: &str = "risk_review_required";
pub const NOTIFY_DECISION_PROPOSED: &str = "risk_decision_proposed";

pub const PARTY_CABINET: &str = "cabinet";
pub const PARTY_PAYER_LINK: &str = "payer_link";

/// Why an assessment was evaluated (`lead_risk_events.cause`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Cause {
    Cabinet,
    Staff,
    PayerLink,
    Screening,
    HitDecision,
    Gate,
    Read,
}

impl Cause {
    pub fn as_str(self) -> &'static str {
        match self {
            Cause::Cabinet => "cabinet",
            Cause::Staff => "staff",
            Cause::PayerLink => "payer_link",
            Cause::Screening => "screening",
            Cause::HitDecision => "hit_decision",
            Cause::Gate => "gate",
            Cause::Read => "read",
        }
    }
}

/// The configuration as stored, the default when missing or broken.
pub async fn load_config(conn: &mut PgConnection) -> Result<RiskConfig, sqlx::Error> {
    let value: Option<Value> =
        sqlx::query_scalar("SELECT value FROM system_settings WHERE key = $1")
            .bind(super::CONFIG_SETTING)
            .fetch_optional(&mut *conn)
            .await?;
    Ok(RiskConfig::from_setting(value))
}

/// The current state of a lead (`lead_risk_assessments`).
#[derive(Clone, Debug, PartialEq)]
pub struct Assessment {
    pub lead_id: Uuid,
    pub started_at: Option<DateTime<Utc>>,
    pub config_version: i32,
    pub score: Score,
    pub triggers: Vec<Sticky>,
    pub fingerprint: String,
    pub requested_blocks: Vec<String>,
    pub follow_up_answered_at: Option<DateTime<Utc>>,
    pub status: String,
    pub released_fingerprint: Option<String>,
    pub representative_country_ids: Vec<Uuid>,
}

impl Assessment {
    pub fn started(&self) -> bool {
        self.started_at.is_some() && self.status != STATUS_GRANDFATHERED
    }

    /// Whether the guarded staff actions wait for a decision: a rejected
    /// lead, level ≥ 2 that nobody released, or a country-triggered request
    /// whose mandatory answers are still pending. Not started and
    /// grandfathered leads are not held here (the gate starts them).
    pub fn holds(&self) -> bool {
        if !self.started() {
            return false;
        }
        self.status == STATUS_REJECTED
            || (self.score.level >= 2 && self.status != STATUS_RELEASED)
            || (self.status == STATUS_AWAITING
                && self
                    .triggers
                    .iter()
                    .any(|trigger| super::country_follow_up(&trigger.key, &trigger.subject)))
    }

    /// A confirmed sanctions match (T16) is final: a reviewer may not release
    /// such a lead, as a release would leave "released" next to the sanctions
    /// block that it does not lift (QA 2026-10-11 N-09 hid the button only;
    /// QA 2026-10-22: the server refuses it too). A false-positive decision
    /// withdraws T16, so a stored T16 is a confirmed match.
    pub fn sanctions_confirmed(&self) -> bool {
        self.triggers.iter().any(|trigger| trigger.key == "T16")
    }

    /// Whether the payer's link waits: a rejected lead, or level 3 that
    /// nobody released and for which staff did not request block D.
    pub fn holds_payer_link(&self) -> bool {
        self.started()
            && (self.status == STATUS_REJECTED
                || (self.score.level >= 3
                    && self.status != STATUS_RELEASED
                    && !self.requested_blocks.iter().any(|block| block == "D")))
    }

    fn from_row(row: &sqlx::postgres::PgRow) -> Self {
        let triggers: Vec<Sticky> = row
            .try_get::<Value, _>("triggers")
            .ok()
            .and_then(|value| serde_json::from_value(value).ok())
            .unwrap_or_default();
        Assessment {
            lead_id: row.try_get("lead_id").unwrap_or_default(),
            started_at: row.try_get("started_at").ok().flatten(),
            config_version: row.try_get("config_version").unwrap_or(1),
            score: Score {
                patient_points: row.try_get("patient_points").unwrap_or(0),
                payer_points: row.try_get("payer_points").unwrap_or(0),
                points: row.try_get("points").unwrap_or(0),
                knockout: row.try_get("knockout").unwrap_or(false),
                level: row.try_get("level").unwrap_or(1),
            },
            triggers,
            fingerprint: row.try_get("fingerprint").unwrap_or_default(),
            requested_blocks: row.try_get("requested_blocks").unwrap_or_default(),
            follow_up_answered_at: row.try_get("follow_up_answered_at").ok().flatten(),
            status: row.try_get("status").unwrap_or_default(),
            released_fingerprint: row.try_get("released_fingerprint").ok().flatten(),
            representative_country_ids: row
                .try_get("representative_country_ids")
                .unwrap_or_default(),
        }
    }
}

const ASSESSMENT_COLUMNS: &str = "lead_id, started_at, config_version, patient_points, \
     payer_points, points, knockout, level, triggers, fingerprint, requested_blocks, \
     follow_up_answered_at, status, released_fingerprint, representative_country_ids, updated_at";

/// The stored assessment, if any (no lock).
pub async fn load(
    conn: &mut PgConnection,
    lead_id: Uuid,
) -> Result<Option<Assessment>, sqlx::Error> {
    Ok(sqlx::query(&format!(
        "SELECT {ASSESSMENT_COLUMNS} FROM lead_risk_assessments WHERE lead_id = $1"
    ))
    .bind(lead_id)
    .fetch_optional(&mut *conn)
    .await?
    .as_ref()
    .map(Assessment::from_row))
}

async fn load_for_update(
    conn: &mut PgConnection,
    lead_id: Uuid,
) -> Result<Option<Assessment>, sqlx::Error> {
    Ok(sqlx::query(&format!(
        "SELECT {ASSESSMENT_COLUMNS} FROM lead_risk_assessments WHERE lead_id = $1 FOR UPDATE"
    ))
    .bind(lead_id)
    .fetch_optional(&mut *conn)
    .await?
    .as_ref()
    .map(Assessment::from_row))
}

// ----------------------------------------------------------------------------
// Follow-up blocks
// ----------------------------------------------------------------------------

/// What the blocks look at besides the triggers.
#[derive(Clone, Debug, Default)]
pub struct BlockAnswers {
    pub representatives: Vec<RepresentativeQuestions>,
    pub minor_representation: bool,
    pub document_stage: bool,
    pub payer: Option<Declaration>,
    pub via_third_party_kind: Option<String>,
    pub occupation: Option<String>,
    pub sector: Option<String>,
    pub payment_background: Option<String>,
    pub relationship_since: Option<String>,
    pub residence_since: Option<String>,
    pub stay_reason: Option<String>,
    pub stay_reason_details: Option<String>,
    pub pep_related: bool,
    pub pep_office: Option<String>,
    pub pep_country: Option<String>,
    pub pep_period: Option<String>,
    pub pep_relationship: Option<String>,
    pub pep_wealth_origin: Option<String>,
    pub sanctions_link_name: Option<String>,
    pub sanctions_link_kind: Option<String>,
    pub sanctions_link_since_extent: Option<String>,
    pub birth_place: Option<String>,
    pub birth_country: Option<String>,
    pub pep_self_answer: Option<bool>,
    pub pep_related_answer: Option<bool>,
    pub sanctions_links_answer: Option<bool>,
    pub funds_proof_uploaded: bool,
    pub relationship_proof_uploaded: bool,
    pub identity_issue: bool,
    /// A copy of the identity document uploaded after staff entered the data
    /// (or marked it unreadable).
    pub identity_uploaded_since_entry: bool,
    /// When staff entered the identity data (or marked it unreadable): a copy
    /// uploaded before it does not answer block I.
    pub identity_entered_at: Option<DateTime<Utc>>,
    /// The representatives' keys of block G (adult representation).
    pub representation_missing: Vec<String>,
    pub route_by: Option<PaymentRouteBy>,
    /// The payer is a legal representative, independent of the current viewer.
    pub paying_parent: bool,
    pub statement_submitted: bool,
    pub statement_legal_form: Option<String>,
    pub statement_payment_reason: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
pub struct RepresentativeQuestions {
    pub id: Uuid,
    pub name: String,
    pub fields: Value,
    pub country_questions: bool,
    pub missing: Vec<String>,
}

fn representative_ids(inputs: &Inputs, config: &RiskConfig, stored: &[Uuid]) -> Vec<Uuid> {
    let mut ids: Vec<Uuid> = inputs
        .representatives
        .iter()
        .filter(|person| {
            stored.contains(&person.id)
                || person.country_questions(config)
                || person.fields["pep_self"] == true
                || person.fields["pep_related"] == true
                || person.fields["sanctions_links"] == true
        })
        .map(|person| person.id)
        .collect();
    ids.sort_unstable();
    ids.dedup();
    ids
}

fn representative_questions(inputs: &Inputs, required: &[Uuid]) -> Vec<RepresentativeQuestions> {
    inputs
        .representatives
        .iter()
        .map(|person| {
            let country_questions = required.contains(&person.id);
            RepresentativeQuestions {
                id: person.id,
                name: person.name.clone(),
                fields: person.fields.clone(),
                country_questions,
                missing: if country_questions {
                    lead_representatives::country_question_missing(&person.fields)
                } else {
                    Vec::new()
                },
            }
        })
        .collect()
}

fn blank(value: &Option<String>) -> bool {
    value.as_deref().is_none_or(|value| value.trim().is_empty())
}

/// Loads the [`BlockAnswers`] of a lead; `caller` is the cabinet login that
/// looks (the paying parent answers differently), `None` for staff.
pub async fn load_block_answers(
    conn: &mut PgConnection,
    lead_id: Uuid,
    inputs: &Inputs,
    caller: Option<Uuid>,
) -> Result<BlockAnswers, sqlx::Error> {
    let payer = lead_payer::load_declaration(conn, lead_id).await?;
    let representation = lead_representatives::load(conn, lead_id)
        .await?
        .unwrap_or_default();
    let paying_parent =
        lead_representatives::payer_same_person(&representation.representation, payer.as_ref())
            .is_some();
    let route_by = crate::routes::lead_portal_intake::payment_route_by(
        payer.as_ref(),
        &representation.representation,
        caller,
    );
    let today = inputs.today.unwrap_or_else(crate::app_time::today);
    let config = load_config(conn).await?;
    let stored = load(conn, lead_id).await?;
    let submitted: bool =
        sqlx::query_scalar("SELECT portal_submitted_at IS NOT NULL FROM leads WHERE id=$1")
            .bind(lead_id)
            .fetch_one(&mut *conn)
            .await?;
    let stored_ids = stored
        .as_ref()
        .filter(|assessment| submitted && assessment.started())
        .map(|assessment| assessment.representative_country_ids.as_slice())
        .unwrap_or(&[]);
    let representatives =
        representative_questions(inputs, &representative_ids(inputs, &config, stored_ids));
    let representation_missing: Vec<String> = (if representation.representation.minor {
        lead_representatives::missing_for_contract(&representation, today)
    } else {
        lead_representatives::missing_for_submit(&representation, today)
    })
    .into_iter()
    .filter(|key| {
        representation.representation.minor || super::cabinet::is_adult_representative_key(key)
    })
    .filter(|key| !super::cabinet::is_id_data_key(key))
    .collect();
    let row = sqlx::query(
        r#"SELECT g.occupation, g.sector, g.payment_background, g.relationship_since,
                  g.residence_since, g.stay_reason, g.stay_reason_details, g.pep_related,
                  g.pep_office, g.pep_country, g.pep_period, g.pep_relationship,
                  g.pep_wealth_origin, g.sanctions_link_name, g.sanctions_link_kind,
                  g.sanctions_link_since_extent, g.id_data_entered_at, g.birth_place,
                  g.birth_country, g.pep_self, g.sanctions_links,
                  d.via_third_party_kind,
                  s.submitted_at AS statement_submitted_at, s.legal_form AS statement_legal_form,
                  s.payment_reason AS statement_payment_reason,
                  EXISTS (
                      SELECT 1 FROM lead_portal_uploads u
                      JOIN documents doc ON doc.id = u.document_id
                      WHERE u.lead_id = l.id AND u.kind = 'self_funds_proof'
                        AND u.withdrawn_at IS NULL AND doc.file_deleted_at IS NULL
                  ) AS funds_proof_uploaded,
                  EXISTS (
                      SELECT 1 FROM lead_portal_uploads u
                      JOIN documents doc ON doc.id = u.document_id
                      WHERE u.lead_id = l.id AND u.kind = 'relationship_proof'
                        AND u.withdrawn_at IS NULL AND doc.file_deleted_at IS NULL
                  ) AS relationship_proof_uploaded,
                  (
                      SELECT max(u.created_at) FROM lead_portal_uploads u
                      JOIN documents doc ON doc.id = u.document_id
                      WHERE u.lead_id = l.id AND u.kind = 'identity'
                        AND u.withdrawn_at IS NULL AND doc.file_deleted_at IS NULL
                  ) AS identity_uploaded_at
           FROM leads l
           LEFT JOIN lead_gwg_declarations g ON g.lead_id = l.id
           LEFT JOIN lead_payer_declarations d ON d.lead_id = l.id
           LEFT JOIN lead_payer_statements s ON s.lead_id = l.id
           WHERE l.id = $1"#,
    )
    .bind(lead_id)
    .fetch_optional(&mut *conn)
    .await?;
    let Some(row) = row else {
        return Ok(BlockAnswers::default());
    };
    let text = |column: &str| row.try_get::<Option<String>, _>(column).ok().flatten();
    let identity_uploaded_at: Option<DateTime<Utc>> =
        row.try_get("identity_uploaded_at").ok().flatten();
    let entered_at: Option<DateTime<Utc>> = row.try_get("id_data_entered_at").ok().flatten();
    Ok(BlockAnswers {
        representatives,
        minor_representation: representation.representation.minor,
        document_stage: representation.document_stage,
        payer,
        via_third_party_kind: text("via_third_party_kind"),
        occupation: text("occupation"),
        sector: text("sector"),
        payment_background: text("payment_background"),
        relationship_since: text("relationship_since"),
        residence_since: text("residence_since"),
        stay_reason: text("stay_reason"),
        stay_reason_details: text("stay_reason_details"),
        pep_related: row
            .try_get::<Option<bool>, _>("pep_related")
            .ok()
            .flatten()
            .unwrap_or(false),
        pep_office: text("pep_office"),
        pep_country: text("pep_country"),
        pep_period: text("pep_period"),
        pep_relationship: text("pep_relationship"),
        pep_wealth_origin: text("pep_wealth_origin"),
        birth_place: text("birth_place"),
        birth_country: text("birth_country"),
        pep_self_answer: row.try_get::<Option<bool>, _>("pep_self").ok().flatten(),
        pep_related_answer: row.try_get::<Option<bool>, _>("pep_related").ok().flatten(),
        sanctions_links_answer: row
            .try_get::<Option<bool>, _>("sanctions_links")
            .ok()
            .flatten(),
        sanctions_link_name: text("sanctions_link_name"),
        sanctions_link_kind: text("sanctions_link_kind"),
        sanctions_link_since_extent: text("sanctions_link_since_extent"),
        funds_proof_uploaded: row.try_get("funds_proof_uploaded").unwrap_or(false),
        relationship_proof_uploaded: row.try_get("relationship_proof_uploaded").unwrap_or(false),
        identity_issue: inputs.identity_issue(),
        identity_uploaded_since_entry: match (identity_uploaded_at, entered_at) {
            (Some(uploaded), Some(entered)) => uploaded > entered,
            (Some(_), None) => true,
            _ => false,
        },
        identity_entered_at: entered_at,
        representation_missing,
        route_by: Some(route_by),
        paying_parent,
        statement_submitted: row
            .try_get::<Option<DateTime<Utc>>, _>("statement_submitted_at")
            .ok()
            .flatten()
            .is_some(),
        statement_legal_form: text("statement_legal_form"),
        statement_payment_reason: text("statement_payment_reason"),
    })
}

/// The section-8 keys of the payment route (block C).
const PAYMENT_ROUTE_KEYS: [&str; 7] = [
    "payment_method",
    "payment_method_details",
    "account_country",
    "account_holder",
    "bank_name",
    "via_third_party",
    "via_third_party_details",
];

/// Who answers a block and what it still misses.
fn block_missing(block: &str, answers: &BlockAnswers) -> (&'static str, Vec<String>) {
    if block == "R" {
        return (
            PARTY_CABINET,
            answers
                .representatives
                .iter()
                .filter(|person| person.country_questions)
                .flat_map(|person| {
                    person
                        .missing
                        .iter()
                        .map(move |field| format!("representative:{}:{field}", person.id))
                })
                .collect(),
        );
    }
    let payer = answers.payer.as_ref();
    let third_party = payer.is_some_and(Declaration::is_third_party);
    let paying_parent = answers.paying_parent;
    let mut missing: Vec<&str> = Vec::new();
    let link_submit = |missing: &mut Vec<&str>| {
        if !answers.statement_submitted {
            missing.push("payer_link_submit");
        }
    };
    let party = match block {
        "A" => {
            // Only a self-paying patient states the own funds here. A
            // third-party payer states them on the own payer link, a paying
            // parent / legal representative in the own payer questionnaire
            // ("Angaben als zahlende Person"): the cabinet can store a source
            // and a proof only for `self` (`self_funds_payer_check`).
            let self_payer =
                payer.is_some_and(|payer| payer.payer_kind == lead_payer::PAYER_KIND_SELF);
            if self_payer {
                if payer.is_none_or(|payer| payer.self_funds_source.is_none()) {
                    missing.push("funds_source");
                }
                if blank(&payer.and_then(|payer| payer.self_funds_description.clone())) {
                    missing.push("funds_description");
                }
            }
            if !paying_parent && blank(&answers.occupation) {
                missing.push("occupation");
            }
            if blank(&answers.sector) {
                missing.push("sector");
            }
            // The proof is required while A is open (PDF).
            if self_payer && !answers.funds_proof_uploaded {
                missing.push("funds_proof_upload");
            }
            PARTY_CABINET
        }
        "B" => {
            if third_party {
                if !paying_parent && blank(&answers.payment_background) {
                    missing.push("payment_background");
                }
                if blank(&answers.relationship_since) {
                    missing.push("relationship_since");
                }
                if !answers.relationship_proof_uploaded {
                    missing.push("relationship_proof_upload");
                }
            }
            PARTY_CABINET
        }
        "C" => {
            let route_by = answers.route_by.unwrap_or(PaymentRouteBy::Patient);
            if route_by.asks() {
                for key in lead_payer::portal_missing_billing(payer, route_by) {
                    if PAYMENT_ROUTE_KEYS.contains(&key) {
                        missing.push(key);
                    }
                }
                // The expected total is no longer asked (owner 2026-10-12): the
                // amount is GMED's own order, and T10 / T11 are retired.
                if payer.is_some_and(|payer| payer.via_third_party == Some(true))
                    && answers.via_third_party_kind.is_none()
                {
                    missing.push("via_third_party_kind");
                }
                PARTY_CABINET
            } else {
                link_submit(&mut missing);
                PARTY_PAYER_LINK
            }
        }
        "D" => {
            link_submit(&mut missing);
            PARTY_PAYER_LINK
        }
        "E" => {
            if blank(&answers.statement_legal_form) {
                missing.push("legal_form");
            }
            if blank(&answers.statement_payment_reason) {
                missing.push("payment_reason");
            }
            link_submit(&mut missing);
            PARTY_PAYER_LINK
        }
        "F" => {
            if blank(&answers.residence_since) {
                missing.push("residence_since");
            }
            match answers.stay_reason.as_deref() {
                None => missing.push("stay_reason"),
                Some("other") if blank(&answers.stay_reason_details) => {
                    missing.push("stay_reason_details");
                }
                Some(_) => {}
            }
            PARTY_CABINET
        }
        "G" => {
            return (PARTY_CABINET, answers.representation_missing.clone());
        }
        "H" => {
            // The lead corrected both answers to "no" (QA 2026-10-10): nothing to
            // detail; the fired T14 stays for staff.
            if answers.pep_self_answer != Some(true) && answers.pep_related_answer != Some(true) {
                return (PARTY_CABINET, Vec::new());
            }
            for (key, value) in [
                ("pep_office", &answers.pep_office),
                ("pep_country", &answers.pep_country),
                ("pep_period", &answers.pep_period),
                ("pep_wealth_origin", &answers.pep_wealth_origin),
            ] {
                if blank(value) {
                    missing.push(key);
                }
            }
            if answers.pep_related && blank(&answers.pep_relationship) {
                missing.push("pep_relationship");
            }
            PARTY_CABINET
        }
        "I" => {
            if answers.identity_issue && !answers.identity_uploaded_since_entry {
                missing.push("id_document_upload");
            }
            PARTY_CABINET
        }
        "J" => {
            // Corrected to "no" (QA 2026-10-10): nothing to detail; T15 stays for staff.
            if answers.sanctions_links_answer != Some(true) {
                return (PARTY_CABINET, Vec::new());
            }
            for (key, value) in [
                ("sanctions_link_name", &answers.sanctions_link_name),
                ("sanctions_link_kind", &answers.sanctions_link_kind),
                (
                    "sanctions_link_since_extent",
                    &answers.sanctions_link_since_extent,
                ),
            ] {
                if blank(value) {
                    missing.push(key);
                }
            }
            PARTY_CABINET
        }
        "L" => {
            for (key, answer) in [
                ("pep_self", answers.pep_self_answer),
                ("pep_related", answers.pep_related_answer),
                ("sanctions_links", answers.sanctions_links_answer),
            ] {
                if answer.is_none() {
                    missing.push(key);
                }
            }
            // The own economic interest is asked here too (owner 2026-10-09).
            missing.extend(lead_payer::portal_missing_own_account(
                answers.payer.as_ref(),
            ));
            PARTY_CABINET
        }
        "K" => {
            if blank(&answers.birth_place) {
                missing.push("birth_place");
            }
            if blank(&answers.birth_country) {
                missing.push("birth_country");
            }
            PARTY_CABINET
        }
        _ => PARTY_CABINET,
    };
    (party, missing.into_iter().map(str::to_string).collect())
}

/// Whether a "request more" of `blocks` asks the lead's cabinet for an
/// answer: one of them is answered there and still misses something. The
/// payer link's blocks and complete cabinet blocks leave the lead's sent
/// follow-up as it is.
fn requests_cabinet_answer(blocks: &[String], answers: &BlockAnswers) -> bool {
    blocks.iter().any(|block| {
        let (party, missing) = block_missing(block, answers);
        party == PARTY_CABINET && !missing.is_empty()
    })
}

/// One block for staff.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct BlockState {
    pub open: bool,
    pub party: &'static str,
    pub answered: bool,
    pub missing: Vec<String>,
}

/// The keys of block A about the source of the funds and its proof.
const FUNDS_KEYS: [&str; 3] = ["funds_source", "funds_description", "funds_proof_upload"];

/// The level of the lead's own triggers: a representative's country opens
/// that representative's R, never the child's questions (their combined
/// points may rise).
fn own_level(triggers: &[Sticky], level: i16, config: &RiskConfig) -> i16 {
    if triggers
        .iter()
        .any(|trigger| trigger.subject == super::SUBJECT_REPRESENTATIVE)
    {
        let own: Vec<Sticky> = triggers
            .iter()
            .filter(|trigger| trigger.subject != super::SUBJECT_REPRESENTATIVE)
            .cloned()
            .collect();
        score(&own, config).level
    } else {
        level
    }
}

/// Whether block A asks the source of the funds and its proof: only with the
/// enhanced check (level 2 or 3, the level `lead_enhanced_check` reads) or
/// when staff requested A. A country of the lists below level 2 opens A for
/// the profession and the sector only (owner 2026-10-19: the source of funds
/// is asked only by a trigger of the enhanced check).
pub fn funds_asked(
    triggers: &[Sticky],
    level: i16,
    requested: &[String],
    config: &RiskConfig,
) -> bool {
    requested.iter().any(|block| block == "A") || own_level(triggers, level, config) >= 2
}

/// Which blocks are open (contract 3.3) and what each still misses: G and I
/// whenever T13 / T12 is sticky and their data are missing; the others at
/// level 2 from the sticky triggers (when `level_2_blocks_automatic`) and,
/// at any level, the ones staff requested. Patient country triggers also
/// open A/F/K/L below level two; their configured points are unchanged, and
/// A then asks no source of funds ([`funds_asked`]).
pub fn block_states(
    triggers: &[Sticky],
    level: i16,
    requested: &[String],
    config: &RiskConfig,
    answers: &BlockAnswers,
) -> BTreeMap<&'static str, BlockState> {
    // Level 3 too (owner 2026-10-10): staff decide on level 3 with the details the
    // triggers ask for; the halt and the four-eyes decision stay.
    // A parent's country opens that parent's R, without asking the child's
    // birth/PEP/residence questions merely because their combined points rose.
    let child_level = own_level(triggers, level, config);
    let funds = funds_asked(triggers, level, requested, config);
    let automatic = if child_level >= 2 && config.level_2_blocks_automatic {
        blocks_of(triggers)
    } else {
        Vec::new()
    };
    let sticky = |key: &str| triggers.iter().any(|trigger| trigger.key == key);
    let patient_country = triggers
        .iter()
        .any(|trigger| super::patient_country_follow_up(&trigger.key, &trigger.subject));
    let mut states = BTreeMap::new();
    for block in BLOCKS {
        let (party, mut missing) = block_missing(block, answers);
        if block == "A" && !funds {
            missing.retain(|key| !FUNDS_KEYS.contains(&key.as_str()));
        }
        let requested = requested.iter().any(|known| known == block);
        let open = match block {
            "G" => {
                requested
                    || (sticky("T13")
                        && !missing.is_empty()
                        && (!answers.minor_representation || answers.document_stage))
            }
            "I" => requested || (sticky("T12") && !missing.is_empty()),
            "H" => {
                requested
                    || triggers.iter().any(|trigger| {
                        trigger.key == "T14" && trigger.subject == super::SUBJECT_PATIENT
                    })
            }
            "J" => {
                requested
                    || triggers.iter().any(|trigger| {
                        trigger.key == "T15" && trigger.subject == super::SUBJECT_PATIENT
                    })
            }
            // The enhanced check (level 2 or 3) asks the birth data and the legal
            // questions; the base form does not. A (source of funds, occupation,
            // sector, proof) too: the § 15 GwG check needs it whatever fired
            // (QA 2026-10-10, two-stage form 2026-10-07).
            "A" | "K" | "L" => requested || child_level >= 2 || patient_country,
            "F" => requested || automatic.contains(&block) || patient_country,
            "R" => {
                requested
                    || triggers
                        .iter()
                        .any(|trigger| trigger.subject == super::SUBJECT_REPRESENTATIVE)
                    || answers
                        .representatives
                        .iter()
                        .any(|person| person.country_questions)
            }
            _ => requested || automatic.contains(&block),
        };
        states.insert(
            block,
            BlockState {
                open,
                party,
                answered: missing.is_empty(),
                missing,
            },
        );
    }
    states
}

/// Whether one block is open now (as [`block_states`] decides it, without
/// the answers: E and the other answer-independent blocks), for the payer
/// link. Nothing before the assessment started or after staff decided.
pub async fn block_open(
    conn: &mut PgConnection,
    lead_id: Uuid,
    block: &str,
) -> Result<bool, sqlx::Error> {
    let Some(assessment) = load(conn, lead_id).await?.filter(|assessment| {
        assessment.started()
            && !matches!(
                assessment.status.as_str(),
                STATUS_RELEASED | STATUS_REJECTED
            )
    }) else {
        return Ok(false);
    };
    if assessment
        .requested_blocks
        .iter()
        .any(|known| known == block)
    {
        return Ok(true);
    }
    let config = load_config(conn).await?;
    // Level 3 too, as in `block_states` (owner 2026-10-10): the payer link
    // asks what the staff wizard and the cabinet already show as open.
    Ok(assessment.score.level >= 2
        && config.level_2_blocks_automatic
        && blocks_of(&assessment.triggers).contains(&block))
}

/// The status a started, non-final assessment has (contract 4.3).
fn computed_status(level: i16, states: &BTreeMap<&'static str, BlockState>) -> &'static str {
    if states
        .values()
        .any(|state| state.open && !state.missing.is_empty())
    {
        STATUS_AWAITING
    } else if level <= 1 {
        STATUS_CLEAR
    } else {
        STATUS_REVIEW
    }
}

// ----------------------------------------------------------------------------
// Reassessment
// ----------------------------------------------------------------------------

/// Whether a proposal waits for its second reviewer.
async fn pending_proposal_id(
    conn: &mut PgConnection,
    lead_id: Uuid,
) -> Result<Option<Uuid>, sqlx::Error> {
    sqlx::query_scalar(
        r#"SELECT p.id FROM lead_risk_decisions p
           WHERE p.lead_id = $1
             AND p.level = 3
             AND p.decision IN ('release', 'reject')
             AND p.confirms_decision_id IS NULL
             AND p.withdraws_decision_id IS NULL
             AND NOT EXISTS (
                 SELECT 1 FROM lead_risk_decisions r
                 WHERE r.confirms_decision_id = p.id OR r.withdraws_decision_id = p.id
             )
           ORDER BY p.decided_at DESC
           LIMIT 1"#,
    )
    .bind(lead_id)
    .fetch_optional(&mut *conn)
    .await
}

fn triggers_json(triggers: &[Sticky]) -> Value {
    serde_json::to_value(triggers).unwrap_or_else(|_| json!([]))
}

/// The keys of the triggers, for the history and the audit (no answers).
fn trigger_keys(triggers: &[Sticky]) -> Value {
    json!(
        triggers
            .iter()
            .map(|trigger| json!({
                "key": trigger.key,
                "subject": trigger.subject,
                "variant": trigger.variant,
                "points": trigger.points,
            }))
            .collect::<Vec<_>>()
    )
}

#[allow(clippy::too_many_arguments)]
async fn write_event(
    conn: &mut PgConnection,
    lead_id: Uuid,
    kind: &str,
    score: &Score,
    triggers: &[Sticky],
    status: &str,
    cause: Cause,
    actor: Option<Uuid>,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"INSERT INTO lead_risk_events
               (lead_id, kind, level, points, patient_points, payer_points, triggers, status,
                cause, actor)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)"#,
    )
    .bind(lead_id)
    .bind(kind)
    .bind(score.level)
    .bind(score.points)
    .bind(score.patient_points)
    .bind(score.payer_points)
    .bind(trigger_keys(triggers))
    .bind(status)
    .bind(cause.as_str())
    .bind(actor)
    .execute(&mut *conn)
    .await?;
    audit::write_in_transaction(
        conn,
        &audit::domain_event(
            format!("lead_risk_{kind}"),
            actor,
            "lead",
            Some(lead_id),
            json!({
                "kind": kind,
                "cause": cause.as_str(),
                "level": score.level,
                "points": score.points,
                "status": status,
                "triggers": triggers
                    .iter()
                    .map(|trigger| format!("{}:{}", trigger.key, trigger.subject))
                    .collect::<Vec<_>>(),
            }),
        ),
    )
    .await
}

/// The reviewers: active staff holding `risk.review` (the CEO) and the
/// deputies the configuration names.
pub async fn reviewer_ids(
    conn: &mut PgConnection,
    config: &RiskConfig,
) -> Result<Vec<Uuid>, sqlx::Error> {
    sqlx::query_scalar(
        r#"SELECT id FROM users
           WHERE is_active AND (role = 'ceo' OR id = ANY($1))
           ORDER BY id"#,
    )
    .bind(&config.reviewers)
    .fetch_all(&mut *conn)
    .await
}

/// Who may decide, counted truthfully (QA 2026-10-10): the active CEO
/// accounts and the named deputies who may act as such (active, of an
/// eligible role, no CEO counted twice).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ReviewerCounts {
    pub ceo: usize,
    pub deputies: usize,
}

impl ReviewerCounts {
    pub fn total(self) -> usize {
        self.ceo + self.deputies
    }
}

pub async fn reviewer_counts(
    conn: &mut PgConnection,
    config: &RiskConfig,
) -> Result<ReviewerCounts, sqlx::Error> {
    let roles: Vec<String> = sqlx::query_scalar(
        r#"SELECT role FROM users
           WHERE is_active AND (role = 'ceo' OR id = ANY($1))"#,
    )
    .bind(&config.reviewers)
    .fetch_all(&mut *conn)
    .await?;
    let mut counts = ReviewerCounts {
        ceo: 0,
        deputies: 0,
    };
    for role in roles {
        let Ok(role) = serde_json::from_value::<gmed_domain::role::Role>(serde_json::json!(role))
        else {
            continue;
        };
        if role.can(gmed_domain::access::capabilities::Capability::RiskReview) {
            counts.ceo += 1;
        } else if reviewer_role_eligible(role) {
            counts.deputies += 1;
        }
    }
    Ok(counts)
}

pub fn is_reviewer(auth: &crate::auth::middleware::AuthUser, config: &RiskConfig) -> bool {
    auth.can(gmed_domain::access::capabilities::Capability::RiskReview)
        || (config.reviewers.contains(&auth.user_id)
            && reviewer_role_eligible(auth.role)
            && auth.role != gmed_domain::role::Role::Patient)
}

/// Roles the CEO may designate as deputies: staff with `leads.view` except
/// Sales, the CEO Assistant and interpreters.
pub fn reviewer_role_eligible(role: gmed_domain::role::Role) -> bool {
    use gmed_domain::role::Role;
    role.can(gmed_domain::access::capabilities::Capability::LeadsView)
        && !matches!(
            role,
            Role::Sales
                | Role::CeoAssistant
                | Role::Interpreter
                | Role::TeamleadInterpreter
                | Role::Patient
        )
}

async fn notify(
    conn: &mut PgConnection,
    recipients: &[Uuid],
    lead_id: Uuid,
    kind: &str,
    title: &str,
) -> Result<(), sqlx::Error> {
    for recipient in recipients {
        sqlx::query(
            r#"INSERT INTO user_notifications (user_id, kind, title, body, entity_type, entity_id)
               VALUES ($1, $2, $3, NULL, 'lead', $4)"#,
        )
        .bind(recipient)
        .bind(kind)
        .bind(title)
        .bind(lead_id)
        .execute(&mut *conn)
        .await?;
    }
    Ok(())
}

/// Live evaluation without storing anything (the preview before the start).
pub async fn preview(
    conn: &mut PgConnection,
    lead_id: Uuid,
) -> Result<Option<(Vec<Fired>, Score, RiskConfig)>, sqlx::Error> {
    let config = load_config(conn).await?;
    let Some(inputs) = super::inputs::load(conn, lead_id).await? else {
        return Ok(None);
    };
    let fired = evaluate(&inputs, &config);
    let score = super::score_fired(&fired, &config);
    Ok(Some((fired, score, config)))
}

/// Re-evaluates a started assessment and stores what changed: new triggers
/// and higher points (the ratchet), the status, the history and its audit
/// events. Not started and grandfathered assessments are returned as they
/// are; `None` when nothing is stored for the lead.
pub async fn reassess(
    conn: &mut PgConnection,
    lead_id: Uuid,
    cause: Cause,
    actor: Option<Uuid>,
) -> Result<Option<Assessment>, sqlx::Error> {
    let Some(stored) = load_for_update(conn, lead_id).await? else {
        return Ok(None);
    };
    if !stored.started() {
        return Ok(Some(stored));
    }
    evaluate_and_store(conn, stored, cause, actor, false)
        .await
        .map(Some)
}

/// Starts the assessment of a lead (the cabinet's first submit, the first
/// gated staff call, or a reviewer's restart of a grandfathered lead) and
/// evaluates it. An assessment already running is only reassessed.
pub async fn start(
    conn: &mut PgConnection,
    lead_id: Uuid,
    cause: Cause,
    actor: Option<Uuid>,
    restart_grandfathered: bool,
) -> Result<Option<Assessment>, sqlx::Error> {
    let exists: bool = sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM leads WHERE id = $1)")
        .bind(lead_id)
        .fetch_one(&mut *conn)
        .await?;
    if !exists {
        return Ok(None);
    }
    sqlx::query(
        r#"INSERT INTO lead_risk_assessments (lead_id, started_at, status)
           VALUES ($1, NULL, 'clear')
           ON CONFLICT (lead_id) DO NOTHING"#,
    )
    .bind(lead_id)
    .execute(&mut *conn)
    .await?;
    let Some(stored) = load_for_update(conn, lead_id).await? else {
        return Ok(None);
    };
    if stored.started() {
        return evaluate_and_store(conn, stored, cause, actor, false)
            .await
            .map(Some);
    }
    if stored.status == STATUS_GRANDFATHERED && !restart_grandfathered {
        return Ok(Some(stored));
    }
    evaluate_and_store(conn, stored, cause, actor, true)
        .await
        .map(Some)
}

/// Starts a lead that is neither started nor grandfathered (the first gated
/// call); reassesses one that runs.
pub async fn ensure_started(
    conn: &mut PgConnection,
    lead_id: Uuid,
    cause: Cause,
    actor: Option<Uuid>,
) -> Result<Option<Assessment>, sqlx::Error> {
    start(conn, lead_id, cause, actor, false).await
}

async fn evaluate_and_store(
    conn: &mut PgConnection,
    stored: Assessment,
    cause: Cause,
    actor: Option<Uuid>,
    starting: bool,
) -> Result<Assessment, sqlx::Error> {
    let lead_id = stored.lead_id;
    let config = load_config(conn).await?;
    let Some(inputs) = super::inputs::load(conn, lead_id).await? else {
        return Ok(stored);
    };
    let now = Utc::now();
    let live = evaluate(&inputs, &config);
    let previous_triggers = if starting {
        Vec::new()
    } else {
        stored.triggers.clone()
    };
    // A stored T16 goes once its side has no confirmed hit (only a confirmed
    // hit fires it; QA 2026-10-11 A-15/A-21/A-33): also the T16 an open hit
    // set before, at the next reassessment of any cause.
    let merged = merge(&previous_triggers, &live, now, &inputs.t16_kept_for());
    let score = score(&merged.triggers, &config);
    let representative_country_ids =
        representative_ids(&inputs, &config, &stored.representative_country_ids);
    let mut print = fingerprint(&merged.triggers);
    for person in inputs
        .representatives
        .iter()
        .filter(|person| representative_country_ids.contains(&person.id))
    {
        use sha2::{Digest, Sha256};
        let digest = hex::encode(Sha256::digest(
            format!("{}:{}", person.identity_fingerprint, person.fields).as_bytes(),
        ));
        print.push_str(&format!(",representative:{}:{digest}", person.id));
    }
    let mut answers = load_block_answers(conn, lead_id, &inputs, None).await?;
    answers.representatives = representative_questions(&inputs, &representative_country_ids);
    let states = block_states(
        &merged.triggers,
        score.level,
        &stored.requested_blocks,
        &config,
        &answers,
    );
    let pending = pending_proposal_id(conn, lead_id).await?;
    let status: String = if starting {
        computed_status(score.level, &states).to_string()
    } else if stored.status == STATUS_REJECTED {
        STATUS_REJECTED.to_string()
    } else if stored.status == STATUS_RELEASED
        && within_release(&print, stored.released_fingerprint.as_deref().unwrap_or(""))
    {
        STATUS_RELEASED.to_string()
    } else if pending.is_some() {
        STATUS_PROPOSED.to_string()
    } else {
        computed_status(score.level, &states).to_string()
    };
    let started_at = if starting {
        Some(now)
    } else {
        stored.started_at
    };
    let changed = starting
        || merged.triggers != stored.triggers
        || score != stored.score
        || status != stored.status
        || config.version != stored.config_version
        || print != stored.fingerprint
        || representative_country_ids != stored.representative_country_ids;
    if !changed {
        return Ok(stored);
    }
    let released_fingerprint = if status == STATUS_RELEASED {
        stored.released_fingerprint.clone()
    } else {
        None
    };
    let row = sqlx::query(&format!(
        r#"UPDATE lead_risk_assessments
           SET started_at = $2, config_version = $3, patient_points = $4, payer_points = $5,
               points = $6, knockout = $7, level = $8, triggers = $9, fingerprint = $10,
               status = $11, released_fingerprint = $12, representative_country_ids = $13, updated_at = now()
           WHERE lead_id = $1
           RETURNING {ASSESSMENT_COLUMNS}"#
    ))
    .bind(lead_id)
    .bind(started_at)
    .bind(config.version)
    .bind(score.patient_points)
    .bind(score.payer_points)
    .bind(score.points)
    .bind(score.knockout)
    .bind(score.level)
    .bind(triggers_json(&merged.triggers))
    .bind(&print)
    .bind(&status)
    .bind(&released_fingerprint)
    .bind(&representative_country_ids)
    .fetch_one(&mut *conn)
    .await?;
    let updated = Assessment::from_row(&row);
    if starting {
        write_event(
            conn,
            lead_id,
            "started",
            &score,
            &merged.triggers,
            &status,
            cause,
            actor,
        )
        .await?;
    } else {
        if merged.raised {
            write_event(
                conn,
                lead_id,
                "raised",
                &score,
                &merged.triggers,
                &status,
                cause,
                actor,
            )
            .await?;
        }
        if !merged.withdrawn.is_empty() {
            write_event(
                conn,
                lead_id,
                "trigger_withdrawn",
                &score,
                &merged.triggers,
                &status,
                cause,
                actor,
            )
            .await?;
        }
        if status != stored.status {
            write_event(
                conn,
                lead_id,
                "status",
                &score,
                &merged.triggers,
                &status,
                cause,
                actor,
            )
            .await?;
        }
    }
    let became_review = status == STATUS_REVIEW && (starting || stored.status != STATUS_REVIEW);
    if became_review {
        let reviewers = reviewer_ids(conn, &config).await?;
        notify(
            conn,
            &reviewers,
            lead_id,
            NOTIFY_REVIEW_REQUIRED,
            "Risk review required",
        )
        .await?;
    }
    Ok(updated)
}

/// The lead answered the follow-up blocks: records the time and reassesses.
pub async fn follow_up_answered(
    conn: &mut PgConnection,
    lead_id: Uuid,
    actor: Uuid,
) -> Result<Option<Assessment>, sqlx::Error> {
    let Some(stored) = load_for_update(conn, lead_id).await? else {
        return Ok(None);
    };
    // The portal's clock, which never steps back: the answer is compared with
    // the cabinet's changes by these times.
    let answered_at = crate::routes::lead_portal_intake::portal_update_time(&mut *conn).await?;
    sqlx::query(
        "UPDATE lead_risk_assessments SET follow_up_answered_at = $2, updated_at = now() WHERE lead_id = $1",
    )
    .bind(lead_id)
    .bind(answered_at)
    .execute(&mut *conn)
    .await?;
    write_event(
        conn,
        lead_id,
        "follow_up_answered",
        &stored.score,
        &stored.triggers,
        &stored.status,
        Cause::Cabinet,
        Some(actor),
    )
    .await?;
    reassess(conn, lead_id, Cause::Cabinet, Some(actor)).await
}

// ----------------------------------------------------------------------------
// Decisions
// ----------------------------------------------------------------------------

/// Why a decision was refused.
#[derive(Debug)]
pub enum DecisionError {
    NotStarted,
    InvalidDecision,
    BlocksRequired,
    ProposalPending,
    ProposalNotPending,
    SameUser,
    NotProposer,
    AssessmentChanged,
    /// A release of a lead with a confirmed sanctions match.
    SanctionsConfirmed,
    Database(sqlx::Error),
}

impl From<sqlx::Error> for DecisionError {
    fn from(error: sqlx::Error) -> Self {
        DecisionError::Database(error)
    }
}

/// What a decision did: its row, and whether it is a proposal waiting for a
/// second reviewer (level 3) rather than effective at once.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DecisionOutcome {
    pub id: Uuid,
    pub proposed: bool,
}

#[allow(clippy::too_many_arguments)]
async fn insert_decision(
    conn: &mut PgConnection,
    lead_id: Uuid,
    decision: &str,
    reason: &str,
    blocks: &[String],
    assessment: &Assessment,
    actor: Uuid,
    confirms: Option<Uuid>,
    withdraws: Option<Uuid>,
) -> Result<Uuid, sqlx::Error> {
    let id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO lead_risk_decisions
               (lead_id, decision, reason, blocks, level, fingerprint, decided_by,
                confirms_decision_id, withdraws_decision_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           RETURNING id"#,
    )
    .bind(lead_id)
    .bind(decision)
    .bind(reason)
    .bind(blocks)
    .bind(assessment.score.level)
    .bind(&assessment.fingerprint)
    .bind(actor)
    .bind(confirms)
    .bind(withdraws)
    .fetch_one(&mut *conn)
    .await?;
    audit::write_in_transaction(
        conn,
        &audit::domain_event(
            "lead_risk_decision",
            Some(actor),
            "lead",
            Some(lead_id),
            json!({
                "decision_id": id,
                "decision": decision,
                "blocks": blocks,
                "level": assessment.score.level,
                "fingerprint": assessment.fingerprint,
                "confirms_decision_id": confirms,
                "withdraws_decision_id": withdraws,
            }),
        ),
    )
    .await?;
    Ok(id)
}

/// Applies an effective decision to the assessment row.
async fn apply_effect(
    conn: &mut PgConnection,
    assessment: &Assessment,
    decision: &str,
    blocks: &[String],
    actor: Uuid,
) -> Result<(), sqlx::Error> {
    let lead_id = assessment.lead_id;
    match decision {
        "release" => {
            sqlx::query(
                r#"UPDATE lead_risk_assessments
                   SET status = 'released', released_fingerprint = fingerprint, updated_at = now()
                   WHERE lead_id = $1"#,
            )
            .bind(lead_id)
            .execute(&mut *conn)
            .await?;
        }
        "reject" => {
            sqlx::query(
                r#"UPDATE lead_risk_assessments
                   SET status = 'rejected', released_fingerprint = NULL, updated_at = now()
                   WHERE lead_id = $1"#,
            )
            .bind(lead_id)
            .execute(&mut *conn)
            .await?;
        }
        _ => {
            // request_more: the blocks join the requested ones. The lead
            // answers again only when a requested block is the cabinet's and
            // still misses something (QA 2026-10-10, V2-a: requesting the
            // payer link's blocks C/D/E un-sent the lead's answered follow-up).
            // The status follows from the blocks.
            let lead_answers_again = match super::inputs::load(conn, lead_id).await? {
                Some(inputs) => {
                    let answers = load_block_answers(conn, lead_id, &inputs, None).await?;
                    requests_cabinet_answer(blocks, &answers)
                }
                None => true,
            };
            sqlx::query(
                r#"UPDATE lead_risk_assessments
                   SET requested_blocks = ARRAY(
                           SELECT DISTINCT unnest(requested_blocks || $2::text[]) ORDER BY 1
                       ),
                       follow_up_answered_at = CASE WHEN $3 THEN NULL
                                                    ELSE follow_up_answered_at END,
                       status = CASE WHEN status IN ('released', 'rejected', 'proposed')
                                     THEN 'review_required' ELSE status END,
                       released_fingerprint = NULL,
                       updated_at = now()
                   WHERE lead_id = $1"#,
            )
            .bind(lead_id)
            .bind(blocks)
            .bind(lead_answers_again)
            .execute(&mut *conn)
            .await?;
        }
    }
    if decision != "request_more" {
        let score = assessment.score;
        let status = if decision == "release" {
            STATUS_RELEASED
        } else {
            STATUS_REJECTED
        };
        if assessment.status != status {
            write_event(
                conn,
                lead_id,
                "status",
                &score,
                &assessment.triggers,
                status,
                Cause::Staff,
                Some(actor),
            )
            .await?;
        }
    }
    Ok(())
}

/// A reviewer's decision (contract 4.2). `request_more` and every decision
/// at level ≤ 2 are effective at once; `release` / `reject` at level 3 are a
/// proposal until another reviewer confirms it.
pub async fn decide(
    conn: &mut PgConnection,
    lead_id: Uuid,
    decision: &str,
    reason: &str,
    blocks: &[String],
    actor: Uuid,
) -> Result<DecisionOutcome, DecisionError> {
    if !matches!(decision, "release" | "request_more" | "reject") {
        return Err(DecisionError::InvalidDecision);
    }
    let Some(assessment) = reassess(conn, lead_id, Cause::Staff, Some(actor)).await? else {
        return Err(DecisionError::NotStarted);
    };
    if !assessment.started() {
        return Err(DecisionError::NotStarted);
    }
    if decision == "release" && assessment.sanctions_confirmed() {
        return Err(DecisionError::SanctionsConfirmed);
    }
    let mut blocks: Vec<String> = blocks
        .iter()
        .map(|block| block.trim().to_uppercase())
        .filter(|block| !block.is_empty())
        .collect();
    blocks.sort();
    blocks.dedup();
    if decision == "request_more" {
        if blocks.is_empty() || blocks.iter().any(|block| !BLOCKS.contains(&block.as_str())) {
            return Err(DecisionError::BlocksRequired);
        }
    } else {
        blocks.clear();
    }
    if decision != "request_more" && pending_proposal_id(conn, lead_id).await?.is_some() {
        return Err(DecisionError::ProposalPending);
    }
    let id = insert_decision(
        conn,
        lead_id,
        decision,
        reason,
        &blocks,
        &assessment,
        actor,
        None,
        None,
    )
    .await?;
    if decision != "request_more" && assessment.score.level >= 3 {
        sqlx::query(
            "UPDATE lead_risk_assessments SET status = 'proposed', updated_at = now() WHERE lead_id = $1",
        )
        .bind(lead_id)
        .execute(&mut *conn)
        .await?;
        if assessment.status != STATUS_PROPOSED {
            write_event(
                conn,
                lead_id,
                "status",
                &assessment.score,
                &assessment.triggers,
                STATUS_PROPOSED,
                Cause::Staff,
                Some(actor),
            )
            .await?;
        }
        let config = load_config(conn).await?;
        let others: Vec<Uuid> = reviewer_ids(conn, &config)
            .await?
            .into_iter()
            .filter(|id| *id != actor)
            .collect();
        notify(
            conn,
            &others,
            lead_id,
            NOTIFY_DECISION_PROPOSED,
            "Risk decision waits for a second reviewer",
        )
        .await?;
        return Ok(DecisionOutcome { id, proposed: true });
    }
    apply_effect(conn, &assessment, decision, &blocks, actor).await?;
    if decision == "request_more" {
        reassess(conn, lead_id, Cause::Staff, Some(actor)).await?;
    }
    Ok(DecisionOutcome {
        id,
        proposed: false,
    })
}

/// The pending proposal `proposal_id` of the lead with its decision, proposer
/// and fingerprint.
async fn pending_proposal(
    conn: &mut PgConnection,
    lead_id: Uuid,
    proposal_id: Uuid,
) -> Result<Option<(String, Uuid, String, String)>, sqlx::Error> {
    if pending_proposal_id(conn, lead_id).await? != Some(proposal_id) {
        return Ok(None);
    }
    let row = sqlx::query(
        "SELECT decision, decided_by, fingerprint, reason FROM lead_risk_decisions WHERE id = $1",
    )
    .bind(proposal_id)
    .fetch_one(&mut *conn)
    .await?;
    Ok(Some((
        row.try_get("decision")?,
        row.try_get("decided_by")?,
        row.try_get("fingerprint")?,
        row.try_get("reason")?,
    )))
}

/// The second reviewer confirms a proposal (four eyes).
pub async fn confirm(
    conn: &mut PgConnection,
    lead_id: Uuid,
    proposal_id: Uuid,
    reason: Option<&str>,
    actor: Uuid,
) -> Result<Uuid, DecisionError> {
    let Some(assessment) = reassess(conn, lead_id, Cause::Staff, Some(actor)).await? else {
        return Err(DecisionError::NotStarted);
    };
    let Some((decision, proposer, print, proposal_reason)) =
        pending_proposal(conn, lead_id, proposal_id).await?
    else {
        return Err(DecisionError::ProposalNotPending);
    };
    if proposer == actor {
        return Err(DecisionError::SameUser);
    }
    if print != assessment.fingerprint {
        return Err(DecisionError::AssessmentChanged);
    }
    if decision == "release" && assessment.sanctions_confirmed() {
        return Err(DecisionError::SanctionsConfirmed);
    }
    let reason = reason
        .map(str::trim)
        .filter(|reason| reason.chars().count() >= super::cabinet::MIN_REASON_CHARS)
        .map(str::to_string)
        .unwrap_or(proposal_reason);
    let id = insert_decision(
        conn,
        lead_id,
        &decision,
        &reason,
        &[],
        &assessment,
        actor,
        Some(proposal_id),
        None,
    )
    .await?;
    apply_effect(conn, &assessment, &decision, &[], actor).await?;
    Ok(id)
}

/// The proposer withdraws the own proposal; the status follows from the
/// assessment again.
pub async fn withdraw(
    conn: &mut PgConnection,
    lead_id: Uuid,
    proposal_id: Uuid,
    reason: Option<&str>,
    actor: Uuid,
) -> Result<Uuid, DecisionError> {
    let Some(assessment) = load(conn, lead_id).await? else {
        return Err(DecisionError::NotStarted);
    };
    let Some((decision, proposer, _, _)) = pending_proposal(conn, lead_id, proposal_id).await?
    else {
        return Err(DecisionError::ProposalNotPending);
    };
    if proposer != actor {
        return Err(DecisionError::NotProposer);
    }
    let reason = reason
        .map(str::trim)
        .filter(|reason| reason.chars().count() >= super::cabinet::MIN_REASON_CHARS)
        .unwrap_or("Proposal withdrawn by the proposer")
        .to_string();
    let id = insert_decision(
        conn,
        lead_id,
        &decision,
        &reason,
        &[],
        &assessment,
        actor,
        None,
        Some(proposal_id),
    )
    .await?;
    // Back to the computed status.
    sqlx::query(
        "UPDATE lead_risk_assessments SET status = 'review_required', updated_at = now() WHERE lead_id = $1",
    )
    .bind(lead_id)
    .execute(&mut *conn)
    .await?;
    reassess(conn, lead_id, Cause::Staff, Some(actor)).await?;
    Ok(id)
}

/// Reassesses after the CEO decided a hit, with the decision as cause: a
/// confirmation fires T16, a false positive that leaves the side without a
/// confirmed hit withdraws a stored T16 (see [`super::merge`]).
pub async fn after_hit_decision(
    conn: &mut PgConnection,
    lead_id: Uuid,
    actor: Uuid,
) -> Result<Option<Assessment>, sqlx::Error> {
    reassess(conn, lead_id, Cause::HitDecision, Some(actor)).await
}

/// `review_notice` of the cabinet: from the submit until the first
/// lead-scoped signature request (the DSGVO consent does not count), for
/// every lead.
pub async fn review_notice(conn: &mut PgConnection, lead_id: Uuid) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar(
        r#"SELECT l.portal_submitted_at IS NOT NULL
                  AND NOT EXISTS (
                      SELECT 1 FROM document_signature_requests r
                      JOIN documents d ON d.id = r.source_document_id
                      WHERE d.lead_id = l.id
                        -- The DSGVO consent, also while unsigned (compliance_kind
                        -- is set only on signing): by its template or art, as
                        -- `documents::document_satisfies_compliance_kind` (QA 2026-10-10).
                        AND COALESCE(d.compliance_kind, '') <> 'dsgvo'
                        AND NOT (
                            COALESCE(d.compliance_kind, '') = ''
                            AND COALESCE(NULLIF(trim(d.generated_template_id), ''), trim(d.art))
                                IN ('consent', 'privacy_consents', 'consent_data_release',
                                    'consent_data_release_child', 'consent_data_release_single')
                        )
                  )
           FROM leads l WHERE l.id = $1"#,
    )
    .bind(lead_id)
    .fetch_optional(&mut *conn)
    .await
    .map(|value| value.unwrap_or(false))
}

/// The readiness check `risk_assessment_released`: whether the lead waits
/// for a staff decision. A lead not started yet (staff work it without a
/// cabinet submit) is judged by the live preview, as its first gated call
/// would start it; a grandfathered lead passes.
pub async fn readiness_held(conn: &mut PgConnection, lead_id: Uuid) -> Result<bool, sqlx::Error> {
    match load(conn, lead_id).await? {
        Some(assessment) if assessment.started() => Ok(assessment.holds()),
        Some(assessment) if assessment.status == STATUS_GRANDFATHERED => Ok(false),
        _ => Ok(preview(conn, lead_id)
            .await?
            .is_some_and(|(_, score, _)| score.level >= 2)),
    }
}

/// The validity date staff entered for the patient's identity document
/// (`lead_gwg_declarations.id_valid_until`); the conversion prefers it to
/// the wizard's `passport_expiry`.
pub async fn staff_id_valid_until(
    conn: &mut PgConnection,
    lead_id: Uuid,
) -> Result<Option<NaiveDate>, sqlx::Error> {
    Ok(sqlx::query_scalar::<_, Option<NaiveDate>>(
        "SELECT id_valid_until FROM lead_gwg_declarations WHERE lead_id = $1",
    )
    .bind(lead_id)
    .fetch_optional(&mut *conn)
    .await?
    .flatten())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn representatives_have_their_own_block_even_when_their_country_score_reaches_level_two() {
        let config = RiskConfig::default();
        let now = Utc::now();
        let triggers: Vec<Sticky> = ["T1", "T2"]
            .iter()
            .map(|key| Sticky {
                key: (*key).to_string(),
                subject: super::super::SUBJECT_REPRESENTATIVE.to_string(),
                variant: Some(super::super::VARIANT_LIST_1.to_string()),
                points: 2,
                knockout: false,
                first_fired_at: now,
                last_fired_at: now,
                active: true,
                inactive_since: None,
            })
            .collect();
        let states = block_states(&triggers, 2, &[], &config, &BlockAnswers::default());
        assert!(states["R"].open);
        for block in ["A", "F", "H", "J", "K", "L"] {
            assert!(!states[block].open, "{block}");
        }
    }

    fn blocks(keys: &[&str]) -> Vec<String> {
        keys.iter().map(|key| key.to_string()).collect()
    }

    #[test]
    fn a_stored_confirmed_sanctions_match_cannot_be_released() {
        let now = Utc::now();
        let sticky = |key: &str, active: bool| Sticky {
            key: key.into(),
            subject: super::super::SUBJECT_PATIENT.into(),
            variant: None,
            points: 0,
            knockout: key == "T16" || key == "T14",
            first_fired_at: now,
            last_fired_at: now,
            active,
            inactive_since: None,
        };
        let mut assessment = Assessment {
            lead_id: Uuid::nil(),
            started_at: Some(now),
            config_version: 1,
            score: Score {
                level: 3,
                ..Default::default()
            },
            triggers: vec![sticky("T14", true)],
            fingerprint: String::new(),
            requested_blocks: Vec::new(),
            follow_up_answered_at: None,
            status: STATUS_REVIEW.into(),
            released_fingerprint: None,
            representative_country_ids: Vec::new(),
        };
        assert!(
            !assessment.sanctions_confirmed(),
            "a PEP alone may be released"
        );
        assessment.triggers.push(sticky("T16", true));
        assert!(assessment.sanctions_confirmed());
        // A confirmation is final: T16 stays although it no longer fires.
        assessment.triggers[1].active = false;
        assert!(assessment.sanctions_confirmed());
    }

    #[test]
    fn only_pending_started_patient_country_questions_hold_level_one_actions() {
        let now = Utc::now();
        let mut assessment = Assessment {
            lead_id: Uuid::nil(),
            started_at: Some(now),
            config_version: 1,
            score: Score {
                level: 1,
                points: 2,
                patient_points: 2,
                ..Default::default()
            },
            triggers: Vec::new(),
            fingerprint: String::new(),
            requested_blocks: Vec::new(),
            follow_up_answered_at: None,
            status: STATUS_AWAITING.into(),
            released_fingerprint: None,
            representative_country_ids: Vec::new(),
        };
        let trigger = |key: &str, subject: &str| Sticky {
            key: key.into(),
            subject: subject.into(),
            variant: None,
            points: 2,
            knockout: false,
            first_fired_at: now,
            last_fired_at: now,
            active: true,
            inactive_since: None,
        };
        assert!(
            !assessment.holds(),
            "unrelated pending requests at level one keep existing behavior"
        );
        assessment.triggers = vec![trigger("T12", super::super::SUBJECT_PATIENT)];
        assert!(
            !assessment.holds(),
            "this change is not a blanket hold for pending blocks"
        );
        assessment.triggers = vec![trigger("T1", super::super::SUBJECT_PAYER)];
        assert!(
            !assessment.holds(),
            "patient-country requirement does not cover the payer"
        );
        for key in ["T1", "T2", "T3"] {
            assessment.triggers = vec![trigger(key, super::super::SUBJECT_PATIENT)];
            assert!(
                assessment.holds(),
                "{key}: a started country request waits for its answers"
            );
            assessment.triggers[0].active = false;
            assert!(
                assessment.holds(),
                "the submitted ratchet retains the requirement"
            );
        }
        assessment.status = STATUS_CLEAR.into();
        assert!(
            !assessment.holds(),
            "completed country questions unblock level one"
        );
        assessment.status = STATUS_RELEASED.into();
        assert!(!assessment.holds(), "an explicit release remains effective");
        assessment.status = STATUS_AWAITING.into();
        assessment.started_at = None;
        assert!(
            !assessment.holds(),
            "a pure preview is not a started assessment"
        );
        assessment.started_at = Some(now);
        assessment.status = STATUS_GRANDFATHERED.into();
        assert!(!assessment.holds(), "grandfathering stays unchanged");
        assessment.status = STATUS_REJECTED.into();
        assessment.triggers.clear();
        assert!(
            assessment.holds(),
            "a reject still holds without a country trigger"
        );
        assert_eq!((assessment.score.points, assessment.score.level), (2, 1));
    }

    #[test]
    fn patient_country_questions_open_at_level_one_without_inventing_legal_answers() {
        let now = Utc::now();
        let config = RiskConfig {
            level_2_blocks_automatic: false,
            ..Default::default()
        };
        for key in ["T1", "T2", "T3"] {
            let trigger = Sticky {
                key: key.into(),
                subject: super::super::SUBJECT_PATIENT.into(),
                variant: Some(super::super::VARIANT_LIST_1.into()),
                points: 2,
                knockout: false,
                first_fired_at: now,
                last_fired_at: now,
                active: true,
                inactive_since: None,
            };
            let answers = BlockAnswers {
                identity_issue: true,
                ..Default::default()
            };
            let states = block_states(std::slice::from_ref(&trigger), 1, &[], &config, &answers);
            let open: Vec<&str> = states
                .iter()
                .filter(|(_, state)| state.open)
                .map(|(key, _)| *key)
                .collect();
            assert_eq!(open, vec!["A", "F", "K", "L"], "{key}");
            assert_eq!(
                states["A"].missing,
                vec!["occupation", "sector"],
                "source waits for who pays"
            );
            for field in ["pep_self", "pep_related", "sanctions_links"] {
                assert!(states["L"].missing.contains(&field.to_string()));
            }
            // A self-payer below level 2 is not asked the source of funds
            // (owner 2026-10-19); level 2 or a staff request asks it.
            let self_payer = BlockAnswers {
                payer: Some(Declaration {
                    payer_kind: lead_payer::PAYER_KIND_SELF.into(),
                    ..Declaration::default()
                }),
                ..answers.clone()
            };
            let level_one =
                block_states(std::slice::from_ref(&trigger), 1, &[], &config, &self_payer);
            assert_eq!(
                level_one["A"].missing,
                vec!["occupation", "sector"],
                "{key}"
            );
            assert!(!funds_asked(
                std::slice::from_ref(&trigger),
                1,
                &[],
                &config
            ));
            for (level, requested) in [(2, blocks(&[])), (1, blocks(&["A"]))] {
                let asked = block_states(
                    std::slice::from_ref(&trigger),
                    level,
                    &requested,
                    &config,
                    &self_payer,
                );
                assert_eq!(
                    asked["A"].missing,
                    vec![
                        "funds_source",
                        "funds_description",
                        "occupation",
                        "sector",
                        "funds_proof_upload"
                    ],
                    "{key} level {level}"
                );
            }
            let payer_trigger = Sticky {
                subject: super::super::SUBJECT_PAYER.into(),
                ..trigger
            };
            let payer = block_states(&[payer_trigger], 1, &[], &config, &answers);
            assert!(
                payer.values().all(|state| !state.open),
                "patient preview is not a payer-country rule"
            );
        }
    }

    #[test]
    fn parent_requirements_do_not_depend_on_the_viewing_login() {
        let payer = Declaration {
            payer_kind: lead_payer::PAYER_KIND_THIRD_PARTY.into(),
            ..Declaration::default()
        };
        let parent = BlockAnswers {
            payer: Some(payer),
            paying_parent: true,
            sector: Some("IT".into()),
            route_by: Some(PaymentRouteBy::Patient),
            ..Default::default()
        };
        assert!(block_missing("A", &parent).1.is_empty());
        assert!(
            !block_missing("B", &parent)
                .1
                .contains(&"payment_background".to_string())
        );
        let other = BlockAnswers {
            paying_parent: false,
            ..parent
        };
        assert_eq!(block_missing("A", &other).1, vec!["occupation"]);
    }

    #[test]
    fn a_paying_parent_states_no_funds_in_block_a() {
        // The paying parent's funds belong to the own payer questionnaire:
        // the cabinet cannot store a source or a proof for a representative.
        let parent = BlockAnswers {
            payer: Some(Declaration {
                payer_kind: lead_payer::PAYER_KIND_REPRESENTATIVE.into(),
                ..Declaration::default()
            }),
            paying_parent: true,
            ..Default::default()
        };
        assert_eq!(block_missing("A", &parent).1, vec!["sector"]);
        let own = BlockAnswers {
            payer: Some(Declaration {
                payer_kind: lead_payer::PAYER_KIND_SELF.into(),
                ..Declaration::default()
            }),
            ..Default::default()
        };
        assert_eq!(
            block_missing("A", &own).1,
            vec![
                "funds_source",
                "funds_description",
                "occupation",
                "sector",
                "funds_proof_upload"
            ]
        );
    }

    #[test]
    fn legal_details_require_a_positive_answer() {
        let empty = BlockAnswers::default();
        assert!(block_missing("H", &empty).1.is_empty());
        assert!(block_missing("J", &empty).1.is_empty());
        let yes = BlockAnswers {
            pep_self_answer: Some(true),
            sanctions_links_answer: Some(true),
            ..empty
        };
        assert!(!block_missing("H", &yes).1.is_empty());
        assert!(!block_missing("J", &yes).1.is_empty());
    }

    #[test]
    fn patient_legal_details_open_even_when_automatic_level_two_blocks_are_off() {
        let now = Utc::now();
        let trigger = |key: &str, subject: &str| Sticky {
            key: key.into(),
            subject: subject.into(),
            variant: None,
            points: 1,
            knockout: false,
            first_fired_at: now,
            last_fired_at: now,
            active: true,
            inactive_since: None,
        };
        let config = RiskConfig {
            level_2_blocks_automatic: false,
            ..RiskConfig::default()
        };
        let answers = BlockAnswers {
            pep_self_answer: Some(true),
            sanctions_links_answer: Some(true),
            ..Default::default()
        };
        let states = block_states(
            &[trigger("T14", "patient"), trigger("T15", "patient")],
            1,
            &[],
            &config,
            &answers,
        );
        assert!(states["H"].open && states["J"].open);
        let payer = block_states(
            &[trigger("T14", "payer"), trigger("T15", "payer")],
            1,
            &[],
            &config,
            &answers,
        );
        assert!(!payer["H"].open && !payer["J"].open);
    }

    #[test]
    fn only_an_open_cabinet_block_asks_the_lead_to_answer_again() {
        // A company pays through its own link (QA 2026-10-10, V2-a): C, D and E
        // are the payer link's, the lead's sent follow-up stays sent.
        let answers = BlockAnswers {
            route_by: Some(PaymentRouteBy::Payer),
            birth_place: Some("Testgrad".to_string()),
            birth_country: Some("DE".to_string()),
            ..Default::default()
        };
        assert!(!requests_cabinet_answer(
            &blocks(&["C", "D", "E"]),
            &answers
        ));
        // A complete cabinet block asks nothing either.
        assert!(!requests_cabinet_answer(&blocks(&["K"]), &answers));
        // A cabinet block that still misses something does.
        assert!(requests_cabinet_answer(&blocks(&["D", "F"]), &answers));
        // The self-payer answers the payment route (C) in the cabinet.
        let self_payer = BlockAnswers {
            route_by: Some(PaymentRouteBy::Patient),
            ..Default::default()
        };
        assert!(requests_cabinet_answer(&blocks(&["C"]), &self_payer));
    }
}
