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
}

impl Assessment {
    pub fn started(&self) -> bool {
        self.started_at.is_some() && self.status != STATUS_GRANDFATHERED
    }

    /// Whether the guarded staff actions wait for a decision: a rejected
    /// lead, or level ≥ 2 that nobody released. Not started and
    /// grandfathered leads are not held here (the gate starts them).
    pub fn holds(&self) -> bool {
        if !self.started() {
            return false;
        }
        self.status == STATUS_REJECTED || (self.score.level >= 2 && self.status != STATUS_RELEASED)
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
        }
    }
}

const ASSESSMENT_COLUMNS: &str = "lead_id, started_at, config_version, patient_points, \
     payer_points, points, knockout, level, triggers, fingerprint, requested_blocks, \
     follow_up_answered_at, status, released_fingerprint, updated_at";

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
    pub payer: Option<Declaration>,
    pub expected_total_eur: Option<f64>,
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
    /// The representatives' keys of block G (adult representation).
    pub representation_missing: Vec<String>,
    pub route_by: Option<PaymentRouteBy>,
    pub answered_by_payer: bool,
    pub statement_submitted: bool,
    pub statement_legal_form: Option<String>,
    pub statement_payment_reason: Option<String>,
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
    let answered_by_payer =
        crate::routes::lead_payer_link::answered_by_payer(conn, lead_id, payer.as_ref()).await?;
    let representation = lead_representatives::load(conn, lead_id)
        .await?
        .unwrap_or_default();
    let route_by = crate::routes::lead_portal_intake::payment_route_by(
        payer.as_ref(),
        &representation.representation,
        caller,
    );
    let today = inputs.today.unwrap_or_else(crate::app_time::today);
    let representation_missing: Vec<String> =
        lead_representatives::missing_for_submit(&representation, today)
            .into_iter()
            .filter(|key| super::cabinet::is_adult_representative_key(key))
            .filter(|key| !super::cabinet::is_id_data_key(key))
            .collect();
    let row = sqlx::query(
        r#"SELECT g.occupation, g.sector, g.payment_background, g.relationship_since,
                  g.residence_since, g.stay_reason, g.stay_reason_details, g.pep_related,
                  g.pep_office, g.pep_country, g.pep_period, g.pep_relationship,
                  g.pep_wealth_origin, g.sanctions_link_name, g.sanctions_link_kind,
                  g.sanctions_link_since_extent, g.id_data_entered_at, g.birth_place,
                  g.birth_country, g.pep_self, g.sanctions_links,
                  d.expected_total_eur::float8 AS expected_total_eur, d.via_third_party_kind,
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
        payer,
        expected_total_eur: row.try_get("expected_total_eur").ok().flatten(),
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
        representation_missing,
        route_by: Some(route_by),
        answered_by_payer,
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
    let payer = answers.payer.as_ref();
    let third_party = payer.is_some_and(Declaration::is_third_party);
    let paying_parent = answers.route_by == Some(PaymentRouteBy::Guardian);
    let mut missing: Vec<&str> = Vec::new();
    let link_submit = |missing: &mut Vec<&str>| {
        if !answers.statement_submitted {
            missing.push("payer_link_submit");
        }
    };
    let party = match block {
        "A" => {
            if third_party {
                if !paying_parent && !answers.answered_by_payer {
                    if payer.is_none_or(|payer| payer.payer_funds_source_stated.is_none()) {
                        missing.push("payer_funds_source");
                    }
                    if blank(&payer.and_then(|payer| payer.payer_funds_description_stated.clone()))
                    {
                        missing.push("payer_funds_description");
                    }
                }
            } else {
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
            if !third_party && !answers.funds_proof_uploaded {
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
                if answers.expected_total_eur.is_none() {
                    missing.push("expected_total_eur");
                }
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

/// One block for staff.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct BlockState {
    pub open: bool,
    pub party: &'static str,
    pub answered: bool,
    pub missing: Vec<String>,
}

/// Which blocks are open (contract 3.3) and what each still misses: G and I
/// whenever T13 / T12 is sticky and their data are missing; the others at
/// level 2 from the sticky triggers (when `level_2_blocks_automatic`) and,
/// at any level, the ones staff requested.
pub fn block_states(
    triggers: &[Sticky],
    level: i16,
    requested: &[String],
    config: &RiskConfig,
    answers: &BlockAnswers,
) -> BTreeMap<&'static str, BlockState> {
    let automatic = if level == 2 && config.level_2_blocks_automatic {
        blocks_of(triggers)
    } else {
        Vec::new()
    };
    let sticky = |key: &str| triggers.iter().any(|trigger| trigger.key == key);
    let mut states = BTreeMap::new();
    for block in BLOCKS {
        let (party, missing) = block_missing(block, answers);
        let requested = requested.iter().any(|known| known == block);
        let open = match block {
            "G" => requested || (sticky("T13") && !missing.is_empty()),
            "I" => requested || (sticky("T12") && !missing.is_empty()),
            // The enhanced check (level 2 or 3) asks the birth data; the base form does not.
            "K" | "L" => requested || level >= 2,
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
    Ok(assessment.score.level == 2
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
    let merged = merge(&previous_triggers, &live, now, cause == Cause::HitDecision);
    let score = score(&merged.triggers, &config);
    let print = fingerprint(&merged.triggers);
    let answers = load_block_answers(conn, lead_id, &inputs, None).await?;
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
        || config.version != stored.config_version;
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
               status = $11, released_fingerprint = $12, updated_at = now()
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
    sqlx::query(
        "UPDATE lead_risk_assessments SET follow_up_answered_at = now(), updated_at = now() WHERE lead_id = $1",
    )
    .bind(lead_id)
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
            // request_more: the blocks join the requested ones; the lead
            // answers again. The status follows from the blocks.
            sqlx::query(
                r#"UPDATE lead_risk_assessments
                   SET requested_blocks = ARRAY(
                           SELECT DISTINCT unnest(requested_blocks || $2::text[]) ORDER BY 1
                       ),
                       follow_up_answered_at = NULL,
                       status = CASE WHEN status IN ('released', 'rejected', 'proposed')
                                     THEN 'review_required' ELSE status END,
                       released_fingerprint = NULL,
                       updated_at = now()
                   WHERE lead_id = $1"#,
            )
            .bind(lead_id)
            .bind(blocks)
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

/// Withdraws T16 after a false-positive decision that left no open or
/// confirmed hit (the only "down" path, P3): a reassessment with the
/// decision as cause.
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
                        AND COALESCE(d.compliance_kind, '') <> 'dsgvo'
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
