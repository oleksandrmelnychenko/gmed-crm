//! Points-based risk assessment of a lead ("Trigger-Ablauf im Detail", owner
//! spec 2026-10-07; docs/architecture/aml-enhanced-due-diligence_ua.md,
//! section «Тригери й рівні ризику»).
//!
//! * [`evaluate`] (pure) is the only place that scores: it turns the
//!   [`Inputs`] of a lead into fired triggers. [`score`] sums the sticky
//!   triggers per subject and derives the level; [`merge`] is the ratchet
//!   (a fired trigger stays at its highest points, P3).
//! * [`inputs`] loads what the rule looks at, [`store`] keeps the current
//!   state, the history and the staff decisions, [`gate`] holds the guarded
//!   staff actions until staff decided, [`cabinet`] is what the lead cabinet
//!   sees: neutral follow-up blocks, never points, levels or reasons (P2).
//!
//! Show, never decide (P1): nothing here rejects, releases or sends anything.
//! Country lists, points, thresholds and level bounds are configuration
//! ([`RiskConfig`], system setting [`CONFIG_SETTING`]).

pub(crate) mod cabinet;
pub(crate) mod gate;
pub(crate) mod inputs;
pub(crate) mod store;

use std::collections::BTreeMap;

use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

use crate::sanctions::normalize::country_code;

/// `system_settings.key` of the configuration.
pub const CONFIG_SETTING: &str = "risk_assessment_config";

pub const SUBJECT_PATIENT: &str = "patient";
pub const SUBJECT_PAYER: &str = "payer";
pub const SUBJECT_REPRESENTATIVE: &str = "representative";

pub const VARIANT_LIST_1: &str = "list_1";
pub const VARIANT_LIST_2: &str = "list_2";
/// T16 on the payer's side for a confirmed hit of the third-party invoice
/// recipient alone (no confirmed hit of the payer): the trigger table names
/// the recipient, not the payer (QA 2026-10-12, round 3). Points as T16.
pub const VARIANT_RECIPIENT: &str = "recipient";

/// The trigger keys (contract section 1), in table order. T10 and T11 are
/// retired ([`RETIRED_TRIGGERS`]); the other keys keep their names.
pub const TRIGGER_KEYS: [&str; 14] = [
    "T1", "T2", "T3", "T4", "T5", "T6", "T7", "T8", "T9", "T12", "T13", "T14", "T15", "T16",
];

/// The amount triggers T10 (the lead's value above threshold 1) and T11 (the
/// same payer's 12-month sum above threshold 2), retired 2026-10-12 (owner):
/// the amount is GMED's own order for the treatment, not something the lead
/// or the payer is asked for. A stored configuration naming them is read
/// without them, and a stored assessment drops them at its next
/// reassessment ([`merge`]).
pub const RETIRED_TRIGGERS: [&str; 2] = ["T10", "T11"];

/// The follow-up blocks, in letter order.
/// K (owner 2026-10-09): birth name, place and country of birth, asked only
/// with the enhanced check (level 2 or 3), not in the base form.
/// L (owner 2026-10-09): the three legal questions (PEP, PEP relatives, links to
/// sanctioned persons), asked only with the enhanced check; staff confirm the PEP
/// status of the other leads in the wizard.
pub const BLOCKS: [&str; 13] = [
    "A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "R",
];

/// Relationship kinds that count as the close family for T5 (PDF): a payer
/// of any other kind — sibling, grandparent, relative, friend … — fires.
pub const FAMILY_RELATIONSHIP_KINDS: [&str; 3] = ["spouse", "parent", "child"];

/// Country answers request the patient's neutral follow-up questions even
/// when their configured points remain below the level-two threshold.
/// A listed country is never itself a PEP or sanctions declaration.
pub fn patient_country_follow_up(key: &str, subject: &str) -> bool {
    subject == SUBJECT_PATIENT && matches!(key, "T1" | "T2" | "T3")
}

pub fn representative_country_follow_up(key: &str, subject: &str) -> bool {
    subject == SUBJECT_REPRESENTATIVE && matches!(key, "T1" | "T2")
}

pub fn country_follow_up(key: &str, subject: &str) -> bool {
    patient_country_follow_up(key, subject) || representative_country_follow_up(key, subject)
}

/// Live question preview only, with no stored score, ratchet or side effect.
/// Identity/representation and payer questions keep their existing workflow;
/// legal details appear only after the person explicitly answers yes.
pub(crate) fn country_preview_triggers(inputs: &Inputs, config: &RiskConfig) -> Vec<Sticky> {
    let mut live = evaluate(inputs, config);
    if !live
        .iter()
        .any(|trigger| country_follow_up(trigger.key, trigger.subject))
    {
        return Vec::new();
    }
    live.retain(|trigger| {
        country_follow_up(trigger.key, trigger.subject)
            || (matches!(trigger.subject, SUBJECT_PATIENT | SUBJECT_REPRESENTATIVE)
                && matches!(trigger.key, "T14" | "T15"))
    });
    merge(&[], &live, Utc::now(), &[]).triggers
}

/// The blocks a trigger asks for.
pub fn trigger_blocks(key: &str) -> &'static [&'static str] {
    match key {
        "T1" | "T2" | "T3" => &["F"],
        "T4" => &["A", "B", "C", "D"],
        "T5" => &["A", "B"],
        "T6" => &["A", "C"],
        "T7" => &["E"],
        "T8" => &["A", "C"],
        "T9" => &["C"],
        "T12" => &["I"],
        "T13" => &["G"],
        "T14" => &["H"],
        "T15" => &["J"],
        _ => &[],
    }
}

// ----------------------------------------------------------------------------
// Configuration
// ----------------------------------------------------------------------------

/// Points of a trigger: one value, or one per list (list 1, list 2).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum TriggerPoints {
    Single(i32),
    PerList([i32; 2]),
}

impl TriggerPoints {
    fn for_variant(self, variant: Option<&str>) -> i32 {
        match (self, variant) {
            (TriggerPoints::Single(points), _) => points,
            (TriggerPoints::PerList([_, second]), Some(VARIANT_LIST_2)) => second,
            (TriggerPoints::PerList([first, _]), _) => first,
        }
    }

    fn values(self) -> Vec<i32> {
        match self {
            TriggerPoints::Single(points) => vec![points],
            TriggerPoints::PerList(points) => points.to_vec(),
        }
    }
}

/// The configuration (contract 2.4). A change bumps `version`; it never
/// lowers stored assessments, raises apply at the next reassessment.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct RiskConfig {
    pub version: i32,
    pub list_1: Vec<String>,
    pub list_2: Vec<String>,
    pub points: BTreeMap<String, TriggerPoints>,
    pub knockout: Vec<String>,
    // `threshold_1_eur` / `threshold_2_eur` of a stored configuration (T10,
    // T11, retired 2026-10-12) are ignored when it is read.
    pub level_2_from: i32,
    pub level_3_from: i32,
    pub level_2_blocks_automatic: bool,
    #[serde(default)]
    pub reviewers: Vec<Uuid>,
}

fn codes(values: &[&str]) -> Vec<String> {
    values.iter().map(|value| value.to_string()).collect()
}

impl Default for RiskConfig {
    fn default() -> Self {
        let mut points = BTreeMap::new();
        for (key, value) in [
            ("T1", TriggerPoints::PerList([2, 4])),
            ("T2", TriggerPoints::PerList([2, 4])),
            ("T3", TriggerPoints::Single(1)),
            ("T4", TriggerPoints::Single(1)),
            ("T5", TriggerPoints::Single(2)),
            ("T6", TriggerPoints::PerList([2, 4])),
            ("T7", TriggerPoints::Single(1)),
            ("T8", TriggerPoints::Single(2)),
            ("T9", TriggerPoints::Single(4)),
            ("T12", TriggerPoints::Single(2)),
            ("T13", TriggerPoints::Single(1)),
        ] {
            points.insert(key.to_string(), value);
        }
        RiskConfig {
            version: 1,
            // The wizard's AML_HIGH_RISK_COUNTRY_CODES without MM.
            list_1: codes(&[
                "AF", "AO", "BO", "CD", "CI", "CM", "DZ", "HT", "KE", "LA", "LB", "MC", "NA", "NP",
                "RU", "SS", "SY", "TT", "VE", "VG", "VN", "VU", "YE",
            ]),
            // The black list (`lead_enhanced_check::BLACK_LIST_COUNTRY_CODES`).
            list_2: codes(&["IR", "KP", "MM"]),
            points,
            knockout: codes(&["T14", "T15", "T16"]),
            level_2_from: 4,
            level_3_from: 9,
            level_2_blocks_automatic: true,
            reviewers: Vec::new(),
        }
    }
}

/// Why a configuration was refused (`PUT /compliance/risk-config`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConfigError {
    pub field: &'static str,
    pub message: &'static str,
}

fn config_error(field: &'static str, message: &'static str) -> ConfigError {
    ConfigError { field, message }
}

fn normalized_codes(values: &[String], field: &'static str) -> Result<Vec<String>, ConfigError> {
    crate::sanctions::policy::normalize_country_list(values)
        .map_err(|_| config_error(field, "Countries must be ISO 3166-1 alpha-2 codes"))
}

impl RiskConfig {
    /// Points of a trigger key for a variant; 0 for a key without points (a
    /// knock-out trigger).
    pub fn points_for(&self, key: &str, variant: Option<&str>) -> i32 {
        self.points
            .get(key)
            .map(|points| points.for_variant(variant))
            .unwrap_or(0)
    }

    pub fn is_knockout(&self, key: &str) -> bool {
        self.knockout.iter().any(|known| known == key)
    }

    /// The list of a stored country value (an ISO code or, in older rows, a
    /// name); list 2 wins when a code is in both.
    pub fn list_of(&self, value: &str) -> Option<&'static str> {
        let code = country_value_code(value)?;
        if self.list_2.contains(&code) {
            Some(VARIANT_LIST_2)
        } else if self.list_1.contains(&code) {
            Some(VARIANT_LIST_1)
        } else {
            None
        }
    }

    /// Checks and normalises a configuration sent by the CEO: ISO codes (a
    /// code in both lists stays only in list 2), points 0–20, 0 < level 2 <
    /// level 3, known trigger keys (the retired T10 and T11 are dropped). The
    /// reviewer ids are checked against the users by the caller.
    pub fn validated(mut self) -> Result<Self, ConfigError> {
        self.points
            .retain(|key, _| !RETIRED_TRIGGERS.contains(&key.as_str()));
        self.knockout
            .retain(|key| !RETIRED_TRIGGERS.contains(&key.as_str()));
        self.list_1 = normalized_codes(&self.list_1, "list_1")?;
        self.list_2 = normalized_codes(&self.list_2, "list_2")?;
        let list_2 = self.list_2.clone();
        self.list_1.retain(|code| !list_2.contains(code));
        for (key, points) in &self.points {
            if !TRIGGER_KEYS.contains(&key.as_str()) {
                return Err(config_error("points", "Unknown trigger key"));
            }
            if points
                .values()
                .iter()
                .any(|value| !(0..=20).contains(value))
            {
                return Err(config_error("points", "Points must be between 0 and 20"));
            }
        }
        for key in &self.knockout {
            if !TRIGGER_KEYS.contains(&key.as_str()) {
                return Err(config_error("knockout", "Unknown trigger key"));
            }
        }
        self.knockout.sort_by_key(|key| trigger_order(key));
        self.knockout.dedup();
        if !(self.level_2_from > 0 && self.level_2_from < self.level_3_from) {
            return Err(config_error(
                "level_2_from",
                "Level bounds must be 0 < level_2_from < level_3_from",
            ));
        }
        if self.level_3_from > 1_000 {
            return Err(config_error("level_3_from", "Level bound is too high"));
        }
        if self.version < 1 {
            self.version = 1;
        }
        self.reviewers.sort();
        self.reviewers.dedup();
        Ok(self)
    }

    /// The stored configuration, or the default when it is missing or broken.
    pub fn from_setting(value: Option<Value>) -> Self {
        value
            .and_then(|value| serde_json::from_value::<RiskConfig>(value).ok())
            .and_then(|config| config.validated().ok())
            .unwrap_or_default()
    }
}

/// The ISO code of a stored country value: an ISO code, or a country name of
/// an older row (as `lead_enhanced_check::black_list_code`).
pub fn country_value_code(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return None;
    }
    country_code(trimmed).or_else(|| {
        match trimmed.to_lowercase().as_str() {
            "birma" | "myanmar/birma" => Some("MM"),
            "demokratische volksrepublik korea" => Some("KP"),
            "islamische republik iran" => Some("IR"),
            _ => None,
        }
        .map(str::to_string)
    })
}

pub fn trigger_order(key: &str) -> usize {
    TRIGGER_KEYS
        .iter()
        .position(|known| *known == key)
        .unwrap_or(TRIGGER_KEYS.len())
}

// ----------------------------------------------------------------------------
// Inputs and evaluation (pure)
// ----------------------------------------------------------------------------

/// A currently acting contracting representative, never merged into the child.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct RepresentativeInputs {
    pub id: Uuid,
    pub name: String,
    pub citizenships: Vec<String>,
    pub residences: Vec<String>,
    pub fields: Value,
    pub identity_fingerprint: String,
}

impl RepresentativeInputs {
    pub fn country_questions(&self, config: &RiskConfig) -> bool {
        self.citizenships
            .iter()
            .chain(&self.residences)
            .any(|country| config.list_of(country).is_some())
    }
}

/// What the rule looks at for one lead (loaded by [`inputs::load`]).
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Inputs {
    pub representatives: Vec<RepresentativeInputs>,
    /// Stored citizenship values of the patient (ISO codes, older rows a
    /// name), without the former ones.
    pub patient_citizenships: Vec<String>,
    /// Block F: former citizenships (ISO).
    pub former_citizenships: Vec<String>,
    /// `leads.country` and the habitual residence.
    pub patient_residences: Vec<String>,
    /// `payer_kind = third_party`.
    pub third_party: bool,
    /// `payer_type` of a third party (`None` = a person, older rows).
    pub payer_type: Option<String>,
    pub relationship_kind: Option<String>,
    /// Citizenships of a third-party person (declaration and statement).
    pub payer_citizenships: Vec<String>,
    /// Residence / seat of the third party (declaration, statement, habitual
    /// residence).
    pub payer_residences: Vec<String>,
    /// Block C: paid through another person (`via_third_party` with
    /// `via_third_party_kind = person`).
    pub via_third_party_person: bool,
    /// Different payers named on the lead's non-cancelled orders.
    pub order_payers: usize,
    pub payment_method: Option<String>,
    pub identity_document_on_file: bool,
    pub id_document_unreadable: bool,
    pub id_valid_until: Option<NaiveDate>,
    pub minor: bool,
    pub has_representative: bool,
    pub under_guardianship: bool,
    pub patient_pep: bool,
    pub payer_pep: bool,
    pub patient_sanctions_links: bool,
    pub payer_sanctions_links: bool,
    /// A CONFIRMED sanctions hit of the patient's side: the patient, a
    /// representative, the bank the patient pays through. An open hit is no
    /// input (owner 2026-10-07: only a confirmed match is "under sanctions";
    /// QA 2026-10-11 A-15/A-21/A-33).
    pub patient_hit: bool,
    /// A CONFIRMED sanctions hit of the payer's side: the third-party payer,
    /// its bank, or the third-party invoice recipient who does not pay (owner
    /// decision 2026-10-11).
    pub payer_hit: bool,
    /// `payer_hit` comes from the invoice recipient alone: T16 then carries
    /// [`VARIANT_RECIPIENT`].
    pub recipient_hit_only: bool,
    /// A confirmed hit of the patient's side, whatever fires now: its stored
    /// T16 stays (a confirmation is final, see [`merge`]).
    pub confirmed_hit_patient: bool,
    /// A confirmed hit of the payer's side, also of a payer no longer named.
    pub confirmed_hit_payer: bool,
    /// Today in Europe/Berlin.
    pub today: Option<NaiveDate>,
}

impl Inputs {
    fn payer_is_person(&self) -> bool {
        self.payer_type
            .as_deref()
            .is_none_or(|kind| kind == crate::routes::lead_payer::PAYER_TYPE_PERSON)
    }

    /// Whose score the "who pays" triggers (T8, T9) add to.
    pub fn who_pays(&self) -> &'static str {
        if self.third_party {
            SUBJECT_PAYER
        } else {
            SUBJECT_PATIENT
        }
    }

    /// T12: no identity document on file, staff marked it unreadable, or its
    /// validity ended before today.
    pub fn identity_issue(&self) -> bool {
        !self.identity_document_on_file
            || self.id_document_unreadable
            || matches!(
                (self.id_valid_until, self.today),
                (Some(valid_until), Some(today)) if valid_until < today
            )
    }

    /// The subjects whose stored T16 stays although it no longer fires: a
    /// confirmed hit on that side (for [`merge`]).
    pub fn t16_kept_for(&self) -> Vec<&'static str> {
        let mut kept = Vec::new();
        if self.confirmed_hit_patient {
            kept.push(SUBJECT_PATIENT);
        }
        if self.confirmed_hit_payer {
            kept.push(SUBJECT_PAYER);
        }
        kept
    }
}

/// One trigger the live evaluation fired.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Fired {
    pub key: &'static str,
    pub subject: &'static str,
    pub variant: Option<&'static str>,
    pub points: i32,
    pub knockout: bool,
}

/// The highest list among `values`.
fn highest_list(config: &RiskConfig, values: &[String]) -> Option<&'static str> {
    let lists: Vec<&'static str> = values
        .iter()
        .filter_map(|value| config.list_of(value))
        .collect();
    if lists.contains(&VARIANT_LIST_2) {
        Some(VARIANT_LIST_2)
    } else if lists.contains(&VARIANT_LIST_1) {
        Some(VARIANT_LIST_1)
    } else {
        None
    }
}

/// The rule (pure): every trigger that fires on `inputs`, in key order.
pub fn evaluate(inputs: &Inputs, config: &RiskConfig) -> Vec<Fired> {
    let mut fired: Vec<Fired> = Vec::new();
    let mut fire = |key: &'static str, subject: &'static str, variant: Option<&'static str>| {
        fired.push(Fired {
            key,
            subject,
            variant,
            points: config.points_for(key, variant),
            knockout: config.is_knockout(key),
        });
    };
    // T1: a patient citizenship in list 1 / 2.
    if let Some(list) = highest_list(config, &inputs.patient_citizenships) {
        fire("T1", SUBJECT_PATIENT, Some(list));
    }
    // T2: the patient's residence in list 1 / 2.
    if let Some(list) = highest_list(config, &inputs.patient_residences) {
        fire("T2", SUBJECT_PATIENT, Some(list));
    }
    let representative_citizenships: Vec<String> = inputs
        .representatives
        .iter()
        .flat_map(|person| person.citizenships.iter().cloned())
        .collect();
    let representative_residences: Vec<String> = inputs
        .representatives
        .iter()
        .flat_map(|person| person.residences.iter().cloned())
        .collect();
    if let Some(list) = highest_list(config, &representative_citizenships) {
        fire("T1", SUBJECT_REPRESENTATIVE, Some(list));
    }
    if let Some(list) = highest_list(config, &representative_residences) {
        fire("T2", SUBJECT_REPRESENTATIVE, Some(list));
    }
    // T3: two or more citizenships (incl. former ones), one in a list.
    let mut all_citizenships: Vec<String> = Vec::new();
    for value in inputs
        .patient_citizenships
        .iter()
        .chain(inputs.former_citizenships.iter())
    {
        let code = country_value_code(value).unwrap_or_else(|| value.trim().to_uppercase());
        if !code.is_empty() && !all_citizenships.contains(&code) {
            all_citizenships.push(code);
        }
    }
    if all_citizenships.len() >= 2 && highest_list(config, &all_citizenships).is_some() {
        fire("T3", SUBJECT_PATIENT, None);
    }
    if inputs.third_party {
        // T4: a third party pays. A mother or father paying for the child is no
        // third party (owner 2026-10-10); every other payer is.
        let parent_pays =
            inputs.payer_is_person() && inputs.relationship_kind.as_deref() == Some("parent");
        if !parent_pays {
            fire("T4", SUBJECT_PAYER, None);
        }
        // T5: a person outside the close family.
        if inputs.payer_is_person()
            && inputs
                .relationship_kind
                .as_deref()
                .is_some_and(|kind| !FAMILY_RELATIONSHIP_KINDS.contains(&kind))
        {
            fire("T5", SUBJECT_PAYER, None);
        }
        // T6: the payer's citizenship (a person) or residence / seat.
        let mut payer_countries = inputs.payer_residences.clone();
        if inputs.payer_is_person() {
            payer_countries.extend(inputs.payer_citizenships.iter().cloned());
        }
        if let Some(list) = highest_list(config, &payer_countries) {
            fire("T6", SUBJECT_PAYER, Some(list));
        }
        // T7: a company, an organisation or an insurer.
        if !inputs.payer_is_person() {
            fire("T7", SUBJECT_PAYER, None);
        }
    }
    let who_pays = inputs.who_pays();
    // T8: more than one payer.
    if inputs.via_third_party_person || inputs.order_payers >= 2 {
        fire("T8", who_pays, None);
    }
    // T9: cash or crypto.
    if matches!(inputs.payment_method.as_deref(), Some("cash" | "crypto")) {
        fire("T9", who_pays, None);
    }
    // T10 / T11 (amounts) are retired (owner 2026-10-12, [`RETIRED_TRIGGERS`]).
    // T12: identity.
    if inputs.identity_issue() {
        fire("T12", SUBJECT_PATIENT, None);
    }
    // T13: a minor, a representative or a guardianship.
    if inputs.minor || inputs.has_representative || inputs.under_guardianship {
        fire("T13", SUBJECT_PATIENT, None);
    }
    // T14 / T15: the answers, per subject.
    if inputs.patient_pep {
        fire("T14", SUBJECT_PATIENT, None);
    }
    if inputs.payer_pep {
        fire("T14", SUBJECT_PAYER, None);
    }
    if inputs
        .representatives
        .iter()
        .any(|person| person.fields["pep_self"] == true || person.fields["pep_related"] == true)
    {
        fire("T14", SUBJECT_REPRESENTATIVE, None);
    }
    if inputs.patient_sanctions_links {
        fire("T15", SUBJECT_PATIENT, None);
    }
    if inputs.payer_sanctions_links {
        fire("T15", SUBJECT_PAYER, None);
    }
    if inputs
        .representatives
        .iter()
        .any(|person| person.fields["sanctions_links"] == true)
    {
        fire("T15", SUBJECT_REPRESENTATIVE, None);
    }
    // T16: a confirmed sanctions hit (an open one is only the internal hold
    // of the sanctions gate).
    if inputs.patient_hit {
        fire("T16", SUBJECT_PATIENT, None);
    }
    if inputs.payer_hit {
        fire(
            "T16",
            SUBJECT_PAYER,
            inputs.recipient_hit_only.then_some(VARIANT_RECIPIENT),
        );
    }
    fired
}

// ----------------------------------------------------------------------------
// Sticky triggers and scoring (pure)
// ----------------------------------------------------------------------------

/// A sticky trigger as stored in `lead_risk_assessments.triggers`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Sticky {
    pub key: String,
    pub subject: String,
    pub variant: Option<String>,
    pub points: i32,
    #[serde(default)]
    pub knockout: bool,
    pub first_fired_at: DateTime<Utc>,
    pub last_fired_at: DateTime<Utc>,
    /// Still true in the latest live evaluation (information only).
    pub active: bool,
    /// When the live evaluation stopped firing it (the data changed, e.g. a
    /// PEP "yes" corrected to "no"; QA 2026-10-11 A-51): the trigger stays,
    /// staff see since when its condition no longer holds. `None` while it
    /// fires, and for a trigger that went inactive before this was recorded.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub inactive_since: Option<DateTime<Utc>>,
}

impl Sticky {
    fn same(&self, fired: &Fired) -> bool {
        self.key == fired.key && self.subject == fired.subject
    }
}

/// Result of [`merge`].
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Merged {
    pub triggers: Vec<Sticky>,
    /// A new trigger or more points than stored.
    pub raised: bool,
    /// Keys withdrawn: T12 once a valid identity document is on file, T13
    /// once nobody acts for an adult, T16 once no confirmed hit is left.
    pub withdrawn: Vec<String>,
}

/// A stored trigger the ratchet drops once it no longer fires: T12 always
/// (owner 2026-10-10: a valid identity document on file — uploaded, readable,
/// validity not in the past — withdraws it, so a lead qualified before the
/// upload does not keep it), T16 unless its subject is in `t16_kept_for`.
fn withdrawable(entry: &Sticky, t16_kept_for: &[&str]) -> bool {
    // T13 too (owner 2026-10-10): a "yes" to the representative or guardianship
    // question taken back left a point for good. The retired amount triggers
    // never fire again and go as well (owner 2026-10-12).
    RETIRED_TRIGGERS.contains(&entry.key.as_str())
        || matches!(entry.key.as_str(), "T12" | "T13")
        || (entry.key == "T16" && !t16_kept_for.contains(&entry.subject.as_str()))
}

/// The ratchet (P3): every stored trigger stays at its highest points; the
/// live evaluation adds new ones and raises points. A stored trigger that no
/// longer fires stays, marked inactive (since `now`). The only ways down: a
/// stored T12 that no longer fires (the identity document is now valid) is
/// removed, so is a stored T13 once nobody acts for an adult lead any more,
/// and a stored T16 that no longer fires unless its side has a confirmed hit
/// (`t16_kept_for`; a confirmation is final): T16 fires only on a confirmed
/// hit since 2026-10-11, so this removes a T16 an open hit set before, and
/// the one a false positive leaves without a hit.
pub fn merge(
    stored: &[Sticky],
    live: &[Fired],
    now: DateTime<Utc>,
    t16_kept_for: &[&str],
) -> Merged {
    let mut merged = Merged::default();
    for entry in stored {
        let mut entry = entry.clone();
        match live.iter().find(|fired| entry.same(fired)) {
            Some(fired) => {
                entry.active = true;
                entry.inactive_since = None;
                entry.last_fired_at = now;
                entry.knockout = entry.knockout || fired.knockout;
                if fired.points > entry.points {
                    entry.points = fired.points;
                    entry.variant = fired.variant.map(str::to_string);
                    merged.raised = true;
                } else if entry.key == "T16" {
                    // T16's variant says who on the payer's side is hit (the
                    // recipient alone or the payer): always the live one.
                    entry.variant = fired.variant.map(str::to_string);
                } else if entry.variant.is_none() && fired.variant.is_some() {
                    entry.variant = fired.variant.map(str::to_string);
                }
            }
            None if withdrawable(&entry, t16_kept_for) => {
                merged.withdrawn.push(entry.key.clone());
                continue;
            }
            None => {
                if entry.active {
                    entry.inactive_since = Some(now);
                }
                entry.active = false;
            }
        }
        merged.triggers.push(entry);
    }
    for fired in live {
        if merged.triggers.iter().any(|entry| {
            entry.same(fired) || (entry.key == fired.key && entry.subject == fired.subject)
        }) {
            continue;
        }
        merged.triggers.push(Sticky {
            key: fired.key.to_string(),
            subject: fired.subject.to_string(),
            variant: fired.variant.map(str::to_string),
            points: fired.points,
            knockout: fired.knockout,
            first_fired_at: now,
            last_fired_at: now,
            active: true,
            inactive_since: None,
        });
        merged.raised = true;
    }
    merged.triggers.sort_by(|left, right| {
        (trigger_order(&left.key), &left.subject).cmp(&(trigger_order(&right.key), &right.subject))
    });
    merged
}

/// Points and level of a set of sticky triggers.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize)]
pub struct Score {
    pub patient_points: i32,
    pub payer_points: i32,
    pub points: i32,
    pub knockout: bool,
    pub level: i16,
}

/// Subject points = sum of its sticky triggers; points = the higher of
/// patient and payer; level 3 with a K.o. or points ≥ `level_3_from`, level
/// 2 with points ≥ `level_2_from`, else 1. A trigger the configuration now
/// counts as K.o. is one (raises apply at the next reassessment).
pub fn score(triggers: &[Sticky], config: &RiskConfig) -> Score {
    let mut score = Score::default();
    for trigger in triggers {
        if trigger.subject == SUBJECT_PAYER {
            score.payer_points += trigger.points;
        } else {
            score.patient_points += trigger.points;
        }
        if trigger.knockout || config.is_knockout(&trigger.key) {
            score.knockout = true;
        }
    }
    score.points = score.patient_points.max(score.payer_points);
    score.level = if score.knockout || score.points >= config.level_3_from {
        3
    } else if score.points >= config.level_2_from {
        2
    } else {
        1
    };
    score
}

/// Score of a live evaluation (the preview before the start).
pub fn score_fired(fired: &[Fired], config: &RiskConfig) -> Score {
    let now = Utc::now();
    let triggers: Vec<Sticky> = merge(&[], fired, now, &[]).triggers;
    score(&triggers, config)
}

/// Sorted `key:subject:points`.
pub fn fingerprint(triggers: &[Sticky]) -> String {
    let mut parts: Vec<String> = triggers
        .iter()
        .map(|trigger| format!("{}:{}:{}", trigger.key, trigger.subject, trigger.points))
        .collect();
    parts.sort();
    parts.join(",")
}

/// Whether `current` adds nothing to `released`: no new trigger and no more
/// points (a withdrawn trigger does not void a release).
pub fn within_release(current: &str, released: &str) -> bool {
    let released: Vec<&str> = released
        .split(',')
        .filter(|part| !part.is_empty())
        .collect();
    current
        .split(',')
        .filter(|part| !part.is_empty())
        .all(|part| released.contains(&part))
}

/// The blocks the sticky triggers ask for (letter order). H and J only for
/// the patient's own "yes"; the payer's own answers are detailed on the
/// payer's link.
pub fn blocks_of(triggers: &[Sticky]) -> Vec<&'static str> {
    BLOCKS
        .iter()
        .copied()
        .filter(|block| {
            triggers.iter().any(|trigger| {
                if trigger.subject == SUBJECT_REPRESENTATIVE {
                    return *block == "R"
                        && matches!(trigger.key.as_str(), "T1" | "T2" | "T14" | "T15");
                }
                trigger_blocks(&trigger.key).contains(block)
                    && !(matches!(*block, "H" | "J") && trigger.subject != SUBJECT_PATIENT)
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config() -> RiskConfig {
        RiskConfig::default()
    }

    fn today() -> NaiveDate {
        NaiveDate::from_ymd_opt(2026, 10, 7).unwrap()
    }

    /// A lead that fires nothing: a German self-payer with an identity
    /// document on file.
    fn clean() -> Inputs {
        Inputs {
            patient_citizenships: vec!["DE".into()],
            patient_residences: vec!["DE".into()],
            identity_document_on_file: true,
            today: Some(today()),
            ..Inputs::default()
        }
    }

    fn keys(fired: &[Fired]) -> Vec<(&'static str, &'static str, Option<&'static str>, i32)> {
        fired
            .iter()
            .map(|fired| (fired.key, fired.subject, fired.variant, fired.points))
            .collect()
    }

    fn fire(inputs: Inputs) -> Vec<(&'static str, &'static str, Option<&'static str>, i32)> {
        keys(&evaluate(&inputs, &config()))
    }

    fn third_party_person(kind: &str) -> Inputs {
        Inputs {
            third_party: true,
            payer_type: Some("person".into()),
            relationship_kind: Some(kind.into()),
            payer_citizenships: vec!["DE".into()],
            payer_residences: vec!["DE".into()],
            ..clean()
        }
    }

    #[test]
    fn a_clean_lead_fires_nothing() {
        assert!(fire(clean()).is_empty());
        assert_eq!(score_fired(&[], &config()).level, 1);
    }

    #[test]
    fn country_triggers_have_two_variants_and_list_2_wins() {
        assert_eq!(
            fire(Inputs {
                patient_citizenships: vec!["RU".into()],
                ..clean()
            }),
            vec![("T1", "patient", Some("list_1"), 2)]
        );
        assert_eq!(
            fire(Inputs {
                patient_citizenships: vec!["SY".into(), "IR".into()],
                ..clean()
            }),
            vec![
                ("T1", "patient", Some("list_2"), 4),
                ("T3", "patient", None, 1)
            ]
        );
        assert_eq!(
            fire(Inputs {
                patient_residences: vec!["DE".into(), "Iran".into()],
                ..clean()
            }),
            vec![("T2", "patient", Some("list_2"), 4)]
        );
        // A code in both lists counts only as list 2.
        let mut both = config();
        both.list_1.push("IR".into());
        let both = both.validated().unwrap();
        assert!(!both.list_1.contains(&"IR".to_string()));
        assert_eq!(both.list_of("ir"), Some(VARIANT_LIST_2));
    }

    #[test]
    fn t3_needs_two_citizenships_one_listed_also_a_former_one() {
        assert_eq!(
            fire(Inputs {
                patient_citizenships: vec!["DE".into(), "UA".into()],
                ..clean()
            }),
            vec![]
        );
        assert_eq!(
            fire(Inputs {
                patient_citizenships: vec!["DE".into()],
                former_citizenships: vec!["SY".into()],
                ..clean()
            }),
            vec![("T3", "patient", None, 1)]
        );
    }

    #[test]
    fn each_payer_trigger_alone() {
        // A friend: T4 + T5.
        assert_eq!(
            fire(third_party_person("friend")),
            vec![("T4", "payer", None, 1), ("T5", "payer", None, 2)]
        );
        // A parent paying for the child: no trigger at all (owner 2026-10-10).
        assert_eq!(fire(third_party_person("parent")), vec![]);
        // The rest of the close family: T4 only; sibling and grandparent are no family.
        for family in ["spouse", "child"] {
            assert_eq!(
                fire(third_party_person(family)),
                vec![("T4", "payer", None, 1)],
                "{family}"
            );
        }
        for other in ["sibling", "grandparent", "relative", "other"] {
            assert!(
                fire(third_party_person(other)).contains(&("T5", "payer", None, 2)),
                "{other}"
            );
        }
        // T6: the payer's citizenship or residence.
        assert!(
            fire(Inputs {
                payer_citizenships: vec!["VE".into()],
                ..third_party_person("spouse")
            })
            .contains(&("T6", "payer", Some("list_1"), 2))
        );
        assert!(
            fire(Inputs {
                payer_residences: vec!["KP".into()],
                ..third_party_person("spouse")
            })
            .contains(&("T6", "payer", Some("list_2"), 4))
        );
        // T7: an organisation (also an insurer); its "citizenship" does not count.
        for kind in ["company", "organisation", "insurance"] {
            let fired = fire(Inputs {
                third_party: true,
                payer_type: Some(kind.into()),
                payer_citizenships: vec!["IR".into()],
                ..clean()
            });
            assert_eq!(
                fired,
                vec![("T4", "payer", None, 1), ("T7", "payer", None, 1)],
                "{kind}"
            );
        }
    }

    #[test]
    fn who_pays_triggers_go_to_the_payer_or_the_patient() {
        let route = Inputs {
            via_third_party_person: true,
            payment_method: Some("cash".into()),
            ..clean()
        };
        assert_eq!(
            fire(route.clone()),
            vec![("T8", "patient", None, 2), ("T9", "patient", None, 4)]
        );
        let payer = fire(Inputs {
            third_party: true,
            payer_type: Some("person".into()),
            relationship_kind: Some("spouse".into()),
            ..route
        });
        assert!(payer.contains(&("T8", "payer", None, 2)));
        assert!(payer.contains(&("T9", "payer", None, 4)));
        // No amount fires anything (T10 / T11 retired 2026-10-12); two payers
        // on orders fire T8; an older crypto answer T9.
        assert_eq!(
            fire(Inputs {
                order_payers: 2,
                payment_method: Some("crypto".into()),
                ..clean()
            }),
            vec![("T8", "patient", None, 2), ("T9", "patient", None, 4)]
        );
    }

    #[test]
    fn identity_and_representation_triggers() {
        for inputs in [
            Inputs {
                identity_document_on_file: false,
                ..clean()
            },
            Inputs {
                id_document_unreadable: true,
                ..clean()
            },
            Inputs {
                id_valid_until: NaiveDate::from_ymd_opt(2026, 10, 6),
                ..clean()
            },
        ] {
            assert_eq!(fire(inputs), vec![("T12", "patient", None, 2)]);
        }
        // The last day of validity still counts.
        assert!(
            fire(Inputs {
                id_valid_until: Some(today()),
                ..clean()
            })
            .is_empty()
        );
        for inputs in [
            Inputs {
                minor: true,
                ..clean()
            },
            Inputs {
                has_representative: true,
                ..clean()
            },
            Inputs {
                under_guardianship: true,
                ..clean()
            },
        ] {
            assert_eq!(fire(inputs), vec![("T13", "patient", None, 1)]);
        }
    }

    #[test]
    fn knockouts_per_subject_make_level_three() {
        let cases = [
            (
                Inputs {
                    patient_pep: true,
                    ..clean()
                },
                ("T14", "patient"),
            ),
            (
                Inputs {
                    payer_pep: true,
                    ..third_party_person("spouse")
                },
                ("T14", "payer"),
            ),
            (
                Inputs {
                    patient_sanctions_links: true,
                    ..clean()
                },
                ("T15", "patient"),
            ),
            (
                Inputs {
                    payer_sanctions_links: true,
                    ..third_party_person("spouse")
                },
                ("T15", "payer"),
            ),
            (
                Inputs {
                    patient_hit: true,
                    ..clean()
                },
                ("T16", "patient"),
            ),
            (
                Inputs {
                    payer_hit: true,
                    ..third_party_person("spouse")
                },
                ("T16", "payer"),
            ),
        ];
        for (inputs, (key, subject)) in cases {
            let fired = evaluate(&inputs, &config());
            let knockout = fired
                .iter()
                .find(|fired| fired.key == key && fired.subject == subject)
                .unwrap_or_else(|| panic!("{key} {subject}"));
            assert!(knockout.knockout);
            assert_eq!(knockout.points, 0);
            let score = score_fired(&fired, &config());
            assert!(score.knockout, "{key}");
            assert_eq!(score.level, 3, "{key} {subject}");
        }
    }

    /// QA 2026-10-12 (round 3): a confirmed hit of the third-party invoice
    /// recipient alone is T16 of the payer's side named as the recipient; a
    /// confirmed hit of the payer keeps the plain T16, and the stored variant
    /// follows the live one.
    #[test]
    fn a_recipient_hit_alone_names_the_recipient() {
        let recipient = evaluate(
            &Inputs {
                payer_hit: true,
                recipient_hit_only: true,
                ..clean()
            },
            &config(),
        );
        let t16 = recipient.iter().find(|fired| fired.key == "T16").unwrap();
        assert_eq!(t16.subject, SUBJECT_PAYER);
        assert_eq!(t16.variant, Some(VARIANT_RECIPIENT));
        assert!(t16.knockout);
        let payer = evaluate(
            &Inputs {
                payer_hit: true,
                ..third_party_person("spouse")
            },
            &config(),
        );
        let now = Utc::now();
        let stored = merge(&[], &recipient, now, &[]).triggers;
        let merged = merge(&stored, &payer, now, &[SUBJECT_PAYER]);
        let t16 = merged
            .triggers
            .iter()
            .find(|trigger| trigger.key == "T16")
            .unwrap();
        assert_eq!(t16.variant, None, "{merged:?}");
    }

    #[test]
    fn level_bounds_and_the_higher_of_patient_and_payer() {
        // 3 points: level 1; 4: level 2; 8: level 2; 9: level 3.
        let at = |patient: i32, payer: i32| {
            let now = Utc::now();
            let sticky = |key: &str, subject: &str, points: i32| Sticky {
                key: key.into(),
                subject: subject.into(),
                variant: None,
                points,
                knockout: false,
                first_fired_at: now,
                last_fired_at: now,
                active: true,
                inactive_since: None,
            };
            score(
                &[
                    sticky("T1", "patient", patient),
                    sticky("T4", "payer", payer),
                ],
                &config(),
            )
        };
        assert_eq!(at(3, 0).level, 1);
        assert_eq!(at(4, 0).level, 2);
        assert_eq!(at(8, 3).level, 2);
        assert_eq!(at(9, 0).level, 3);
        assert_eq!(at(0, 9).level, 3);
        let mixed = at(3, 5);
        assert_eq!(
            (
                mixed.patient_points,
                mixed.payer_points,
                mixed.points,
                mixed.level
            ),
            (3, 5, 5, 2)
        );
        // A friend paying alone is level 1 (contract 8): T4 + T5 = 3.
        let friend = score_fired(
            &evaluate(&third_party_person("friend"), &config()),
            &config(),
        );
        assert_eq!((friend.payer_points, friend.level), (3, 1));
        // A Russian resident citizen: T1 + T2 = 4 = level 2 (question 10.1).
        let russian = score_fired(
            &evaluate(
                &Inputs {
                    patient_citizenships: vec!["RU".into()],
                    patient_residences: vec!["RU".into()],
                    ..clean()
                },
                &config(),
            ),
            &config(),
        );
        assert_eq!((russian.points, russian.level), (4, 2));
    }

    #[test]
    fn the_ratchet_keeps_triggers_and_points() {
        let config = config();
        let t0 = Utc::now();
        let raised = merge(
            &[],
            &evaluate(
                &Inputs {
                    patient_citizenships: vec!["IR".into()],
                    ..clean()
                },
                &config,
            ),
            t0,
            &[],
        );
        assert!(raised.raised);
        assert_eq!(score(&raised.triggers, &config).level, 2);
        // The citizenship is corrected: the trigger stays, inactive, at 4.
        let corrected = merge(&raised.triggers, &evaluate(&clean(), &config), t0, &[]);
        assert!(!corrected.raised);
        assert_eq!(corrected.triggers.len(), 1);
        assert!(!corrected.triggers[0].active);
        assert_eq!(corrected.triggers[0].points, 4);
        assert_eq!(score(&corrected.triggers, &config).level, 2);
        // A lower variant later keeps the higher points.
        let lower = merge(
            &corrected.triggers,
            &evaluate(
                &Inputs {
                    patient_citizenships: vec!["RU".into()],
                    ..clean()
                },
                &config,
            ),
            t0,
            &[],
        );
        assert!(!lower.raised);
        assert_eq!(lower.triggers[0].points, 4);
        assert_eq!(lower.triggers[0].variant.as_deref(), Some("list_2"));
        assert!(lower.triggers[0].active);
        // T16 (a confirmed hit) stays while its side has a confirmed hit, also
        // when it no longer fires; without one it goes (a T16 an open hit set
        // before 2026-10-11, or one a false positive left without a hit).
        let confirmed = Inputs {
            patient_hit: true,
            confirmed_hit_patient: true,
            ..clean()
        };
        let hit = merge(&[], &evaluate(&confirmed, &config), t0, &[]);
        assert_eq!(
            merge(&hit.triggers, &[], t0, &confirmed.t16_kept_for())
                .triggers
                .len(),
            1
        );
        let withdrawn = merge(&hit.triggers, &[], t0, &clean().t16_kept_for());
        assert!(withdrawn.triggers.is_empty());
        assert_eq!(withdrawn.withdrawn, vec!["T16".to_string()]);
        let still = merge(
            &hit.triggers,
            &evaluate(&confirmed, &config),
            t0,
            &clean().t16_kept_for(),
        );
        assert_eq!(still.triggers.len(), 1);
        // A confirmed payer hit keeps the payer's T16 after the patient took
        // over the payment; the patient's side does not keep it.
        let payer = Inputs {
            payer_hit: true,
            confirmed_hit_payer: true,
            ..third_party_person("spouse")
        };
        let paid = merge(&[], &evaluate(&payer, &config), t0, &[]);
        let taken_over = Inputs {
            confirmed_hit_payer: true,
            ..clean()
        };
        let kept = merge(
            &paid.triggers,
            &evaluate(&taken_over, &config),
            t0,
            &taken_over.t16_kept_for(),
        );
        assert!(
            kept.triggers
                .iter()
                .any(|trigger| trigger.key == "T16" && trigger.subject == SUBJECT_PAYER)
        );
        assert_eq!(score(&kept.triggers, &config).level, 3);
    }

    #[test]
    fn only_a_confirmed_hit_fires_t16() {
        // Owner 2026-10-07 (QA 2026-10-11 A-15/A-21/A-33): an open hit of any
        // subject is no input, so the level stays where the rest puts it.
        assert!(fire(clean()).is_empty());
        let open_only = Inputs {
            patient_hit: false,
            payer_hit: false,
            ..third_party_person("spouse")
        };
        assert_eq!(fire(open_only), vec![("T4", "payer", None, 1)]);
        assert_eq!(
            score_fired(&evaluate(&clean(), &config()), &config()).level,
            1
        );
    }

    #[test]
    fn a_trigger_that_stops_firing_records_since_when() {
        // QA 2026-10-11 (A-51): a PEP "yes" corrected to "no" keeps T14 (owner:
        // sticky), staff see since when the answer no longer holds.
        let config = config();
        let t0 = Utc::now();
        let t1 = t0 + chrono::Duration::minutes(5);
        let pep = merge(
            &[],
            &evaluate(
                &Inputs {
                    patient_pep: true,
                    ..clean()
                },
                &config,
            ),
            t0,
            &[],
        );
        assert_eq!(pep.triggers[0].inactive_since, None);
        let corrected = merge(&pep.triggers, &evaluate(&clean(), &config), t1, &[]);
        assert_eq!(corrected.triggers.len(), 1);
        assert!(!corrected.triggers[0].active);
        assert_eq!(corrected.triggers[0].inactive_since, Some(t1));
        assert_eq!(score(&corrected.triggers, &config).level, 3);
        // A later reassessment keeps the first date; firing again clears it.
        let later = merge(
            &corrected.triggers,
            &evaluate(&clean(), &config),
            t1 + chrono::Duration::days(1),
            &[],
        );
        assert_eq!(later.triggers[0].inactive_since, Some(t1));
        let again = merge(
            &later.triggers,
            &evaluate(
                &Inputs {
                    patient_pep: true,
                    ..clean()
                },
                &config,
            ),
            t1,
            &[],
        );
        assert!(again.triggers[0].active);
        assert_eq!(again.triggers[0].inactive_since, None);
        // Stored before the field existed: it reads as unknown.
        let stored: Sticky = serde_json::from_value(serde_json::json!({
            "key": "T14", "subject": "patient", "variant": null, "points": 0,
            "knockout": true, "first_fired_at": t0, "last_fired_at": t0, "active": false
        }))
        .unwrap();
        assert_eq!(stored.inactive_since, None);
    }

    #[test]
    fn a_representation_taken_back_withdraws_t13() {
        let config = config();
        let t0 = Utc::now();
        let started = merge(
            &[],
            &evaluate(
                &Inputs {
                    under_guardianship: true,
                    ..clean()
                },
                &config,
            ),
            t0,
            &[],
        );
        assert!(started.triggers.iter().any(|trigger| trigger.key == "T13"));
        // The answer taken back: T13 goes without a decision.
        let back = merge(&started.triggers, &evaluate(&clean(), &config), t0, &[]);
        assert!(back.triggers.iter().all(|trigger| trigger.key != "T13"));
        assert!(!back.withdrawn.is_empty());
        // A minor keeps it.
        let minor = merge(
            &started.triggers,
            &evaluate(
                &Inputs {
                    minor: true,
                    ..clean()
                },
                &config,
            ),
            t0,
            &[],
        );
        assert!(minor.triggers.iter().any(|trigger| trigger.key == "T13"));
    }

    #[test]
    fn a_valid_identity_document_withdraws_t12() {
        let config = config();
        let t0 = Utc::now();
        // Qualified before the upload: T12 (2) + T1 list 2 (4) = level 2.
        let started = merge(
            &[],
            &evaluate(
                &Inputs {
                    identity_document_on_file: false,
                    patient_citizenships: vec!["IR".into()],
                    ..clean()
                },
                &config,
            ),
            t0,
            &[],
        );
        assert_eq!(score(&started.triggers, &config).points, 6);
        // Still no document, or unreadable, or expired: T12 stays.
        for inputs in [
            Inputs {
                identity_document_on_file: false,
                ..clean()
            },
            Inputs {
                id_document_unreadable: true,
                ..clean()
            },
            Inputs {
                id_valid_until: NaiveDate::from_ymd_opt(2026, 10, 6),
                ..clean()
            },
        ] {
            let kept = merge(&started.triggers, &evaluate(&inputs, &config), t0, &[]);
            assert!(kept.withdrawn.is_empty());
            assert!(kept.triggers.iter().any(|trigger| trigger.key == "T12"));
        }
        // The upload (validity today or later, or not entered yet) withdraws
        // T12 without a decision; the other triggers keep the ratchet.
        for valid_until in [None, Some(today())] {
            let uploaded = merge(
                &started.triggers,
                &evaluate(
                    &Inputs {
                        id_valid_until: valid_until,
                        ..clean()
                    },
                    &config,
                ),
                t0,
                &[],
            );
            assert_eq!(uploaded.withdrawn, vec!["T12".to_string()]);
            assert!(!uploaded.raised);
            assert_eq!(fingerprint(&uploaded.triggers), "T1:patient:4");
            let after = score(&uploaded.triggers, &config);
            assert_eq!((after.points, after.level), (4, 2));
            // A release stays valid; an expiry later fires T12 again.
            assert!(within_release(
                &fingerprint(&uploaded.triggers),
                &fingerprint(&started.triggers)
            ));
            let expired = merge(
                &uploaded.triggers,
                &evaluate(
                    &Inputs {
                        id_valid_until: NaiveDate::from_ymd_opt(2026, 10, 6),
                        ..clean()
                    },
                    &config,
                ),
                t0,
                &[],
            );
            assert!(expired.raised);
            assert!(expired.triggers.iter().any(|trigger| trigger.key == "T12"));
        }
    }

    #[test]
    fn fingerprints_and_releases() {
        let config = config();
        let now = Utc::now();
        let first = merge(
            &[],
            &evaluate(&third_party_person("friend"), &config),
            now,
            &[],
        );
        let print = fingerprint(&first.triggers);
        assert_eq!(print, "T4:payer:1,T5:payer:2");
        assert!(within_release(&print, &print));
        assert!(within_release("T4:payer:1", &print));
        assert!(!within_release("T4:payer:1,T5:payer:2,T9:payer:4", &print));
        assert!(!within_release("T4:payer:2", "T4:payer:1"));
        assert!(within_release("", ""));
    }

    #[test]
    fn blocks_follow_the_triggers() {
        let now = Utc::now();
        let merged = merge(
            &[],
            &evaluate(
                &Inputs {
                    payer_pep: true,
                    patient_sanctions_links: true,
                    patient_citizenships: vec!["RU".into()],
                    ..third_party_person("friend")
                },
                &config(),
            ),
            now,
            &[],
        );
        // F (T1), A B C D (T4), A B (T5), J (T15 patient); no H for the payer's PEP.
        assert_eq!(
            blocks_of(&merged.triggers),
            vec!["A", "B", "C", "D", "F", "J"]
        );
    }

    #[test]
    fn configuration_is_validated_and_defaults_when_broken() {
        let default = RiskConfig::default();
        assert_eq!(default.clone().validated().unwrap(), default);
        assert_eq!(default.points_for("T1", Some("list_2")), 4);
        assert_eq!(default.points_for("T1", Some("list_1")), 2);
        assert_eq!(default.points_for("T14", None), 0);
        let mut bad = default.clone();
        bad.list_1.push("Russia".into());
        assert_eq!(bad.validated().unwrap_err().field, "list_1");
        let mut bad = default.clone();
        bad.points.insert("T9".into(), TriggerPoints::Single(21));
        assert_eq!(bad.validated().unwrap_err().field, "points");
        let mut bad = default.clone();
        bad.points.insert("T99".into(), TriggerPoints::Single(1));
        assert!(bad.validated().is_err());
        let mut bad = default.clone();
        bad.level_2_from = 9;
        assert_eq!(bad.validated().unwrap_err().field, "level_2_from");
        assert_eq!(RiskConfig::from_setting(None), default);
        // A configuration stored before 2026-10-12 still names the retired
        // amount triggers and their thresholds: read without them, not reset.
        let mut older = serde_json::to_value(&default).unwrap();
        older["points"]["T10"] = serde_json::json!(1);
        older["points"]["T11"] = serde_json::json!(2);
        older["points"]["T9"] = serde_json::json!(3);
        older["threshold_1_eur"] = serde_json::json!(10_000.0);
        older["threshold_2_eur"] = serde_json::json!(25_000.0);
        let read = RiskConfig::from_setting(Some(older));
        assert_eq!(read.points_for("T9", None), 3, "the CEO's points stay");
        assert!(!read.points.contains_key("T10") && !read.points.contains_key("T11"));
        assert!(!TRIGGER_KEYS.contains(&"T10") && !TRIGGER_KEYS.contains(&"T11"));
        assert_eq!(
            RiskConfig::from_setting(Some(serde_json::json!({"version": "x"}))),
            default
        );
        let stored = serde_json::to_value(&default).unwrap();
        assert_eq!(stored["points"]["T1"], serde_json::json!([2, 4]));
        assert_eq!(stored["points"]["T3"], serde_json::json!(1));
        assert_eq!(RiskConfig::from_setting(Some(stored)), default);
    }
}
