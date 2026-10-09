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

pub const VARIANT_LIST_1: &str = "list_1";
pub const VARIANT_LIST_2: &str = "list_2";

/// The trigger keys (contract section 1), in table order.
pub const TRIGGER_KEYS: [&str; 16] = [
    "T1", "T2", "T3", "T4", "T5", "T6", "T7", "T8", "T9", "T10", "T11", "T12", "T13", "T14", "T15",
    "T16",
];

/// The follow-up blocks, in letter order.
/// K (owner 2026-10-09): birth name, place and country of birth, asked only
/// with the enhanced check (level 2 or 3), not in the base form.
/// L (owner 2026-10-09): the three legal questions (PEP, PEP relatives, links to
/// sanctioned persons), asked only with the enhanced check; staff confirm the PEP
/// status of the other leads in the wizard.
pub const BLOCKS: [&str; 12] = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L"];

/// Relationship kinds that count as the close family for T5 (PDF): a payer
/// of any other kind — sibling, grandparent, relative, friend … — fires.
pub const FAMILY_RELATIONSHIP_KINDS: [&str; 3] = ["spouse", "parent", "child"];

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
        "T10" => &["A"],
        "T11" => &["A", "C"],
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
    pub threshold_1_eur: f64,
    pub threshold_2_eur: f64,
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
            ("T10", TriggerPoints::Single(1)),
            ("T11", TriggerPoints::Single(2)),
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
            threshold_1_eur: 10_000.0,
            threshold_2_eur: 25_000.0,
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
    /// level 3, thresholds > 0, known trigger keys. The reviewer ids are
    /// checked against the users by the caller.
    pub fn validated(mut self) -> Result<Self, ConfigError> {
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
        if !(self.threshold_1_eur.is_finite() && self.threshold_1_eur > 0.0) {
            return Err(config_error("threshold_1_eur", "Thresholds must be > 0"));
        }
        if !(self.threshold_2_eur.is_finite() && self.threshold_2_eur > 0.0) {
            return Err(config_error("threshold_2_eur", "Thresholds must be > 0"));
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

/// What the rule looks at for one lead (loaded by [`inputs::load`]).
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Inputs {
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
    /// The lead's value (T10).
    pub lead_value_eur: f64,
    /// 12-month sum of the same payer incl. this lead (T11).
    pub payer_year_sum_eur: f64,
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
    /// An open or confirmed sanctions hit of the patient or a representative.
    pub patient_hit: bool,
    /// An open or confirmed sanctions hit of the payer.
    pub payer_hit: bool,
    /// Today in Europe/Berlin.
    pub today: Option<NaiveDate>,
}

impl Inputs {
    fn payer_is_person(&self) -> bool {
        self.payer_type
            .as_deref()
            .is_none_or(|kind| kind == crate::routes::lead_payer::PAYER_TYPE_PERSON)
    }

    /// Whose score the "who pays" triggers (T8–T11) add to.
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
        // T4: a third party pays.
        fire("T4", SUBJECT_PAYER, None);
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
    // T10 / T11: amounts.
    if inputs.lead_value_eur > config.threshold_1_eur {
        fire("T10", who_pays, None);
    }
    if inputs.payer_year_sum_eur > config.threshold_2_eur {
        fire("T11", who_pays, None);
    }
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
    if inputs.patient_sanctions_links {
        fire("T15", SUBJECT_PATIENT, None);
    }
    if inputs.payer_sanctions_links {
        fire("T15", SUBJECT_PAYER, None);
    }
    // T16: an open or confirmed sanctions hit.
    if inputs.patient_hit {
        fire("T16", SUBJECT_PATIENT, None);
    }
    if inputs.payer_hit {
        fire("T16", SUBJECT_PAYER, None);
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
    /// Keys withdrawn (only T16, after a false-positive decision).
    pub withdrawn: Vec<String>,
}

/// The ratchet (P3): every stored trigger stays at its highest points; the
/// live evaluation adds new ones and raises points. A stored trigger that no
/// longer fires stays, marked inactive. `withdraw_t16`: the only way down —
/// a false-positive decision left no open or confirmed hit, so a stored T16
/// that no longer fires is removed.
pub fn merge(stored: &[Sticky], live: &[Fired], now: DateTime<Utc>, withdraw_t16: bool) -> Merged {
    let mut merged = Merged::default();
    for entry in stored {
        let mut entry = entry.clone();
        match live.iter().find(|fired| entry.same(fired)) {
            Some(fired) => {
                entry.active = true;
                entry.last_fired_at = now;
                entry.knockout = entry.knockout || fired.knockout;
                if fired.points > entry.points {
                    entry.points = fired.points;
                    entry.variant = fired.variant.map(str::to_string);
                    merged.raised = true;
                } else if entry.variant.is_none() && fired.variant.is_some() {
                    entry.variant = fired.variant.map(str::to_string);
                }
            }
            None if withdraw_t16 && entry.key == "T16" => {
                merged.withdrawn.push(entry.key.clone());
                continue;
            }
            None => entry.active = false,
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
    let triggers: Vec<Sticky> = merge(&[], fired, now, false).triggers;
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
        // The close family: T4 only; sibling and grandparent are no family.
        for family in ["spouse", "parent", "child"] {
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
        let amounts = Inputs {
            via_third_party_person: true,
            payment_method: Some("cash".into()),
            lead_value_eur: 10_000.01,
            payer_year_sum_eur: 25_000.01,
            ..clean()
        };
        assert_eq!(
            fire(amounts.clone()),
            vec![
                ("T8", "patient", None, 2),
                ("T9", "patient", None, 4),
                ("T10", "patient", None, 1),
                ("T11", "patient", None, 2),
            ]
        );
        let payer = fire(Inputs {
            third_party: true,
            payer_type: Some("person".into()),
            relationship_kind: Some("spouse".into()),
            ..amounts
        });
        assert!(payer.contains(&("T8", "payer", None, 2)));
        assert!(payer.contains(&("T11", "payer", None, 2)));
        // At the threshold nothing fires; two payers on orders fire T8; crypto T9.
        assert!(
            fire(Inputs {
                lead_value_eur: 10_000.0,
                payer_year_sum_eur: 25_000.0,
                ..clean()
            })
            .is_empty()
        );
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
            false,
        );
        assert!(raised.raised);
        assert_eq!(score(&raised.triggers, &config).level, 2);
        // The citizenship is corrected: the trigger stays, inactive, at 4.
        let corrected = merge(&raised.triggers, &evaluate(&clean(), &config), t0, false);
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
            false,
        );
        assert!(!lower.raised);
        assert_eq!(lower.triggers[0].points, 4);
        assert_eq!(lower.triggers[0].variant.as_deref(), Some("list_2"));
        assert!(lower.triggers[0].active);
        // Only a withdrawal removes T16, and only when it no longer fires.
        let hit = merge(
            &[],
            &evaluate(
                &Inputs {
                    patient_hit: true,
                    ..clean()
                },
                &config,
            ),
            t0,
            false,
        );
        assert_eq!(merge(&hit.triggers, &[], t0, false).triggers.len(), 1);
        let withdrawn = merge(&hit.triggers, &[], t0, true);
        assert!(withdrawn.triggers.is_empty());
        assert_eq!(withdrawn.withdrawn, vec!["T16".to_string()]);
        let still = merge(
            &hit.triggers,
            &evaluate(
                &Inputs {
                    patient_hit: true,
                    ..clean()
                },
                &config,
            ),
            t0,
            true,
        );
        assert_eq!(still.triggers.len(), 1);
    }

    #[test]
    fn fingerprints_and_releases() {
        let config = config();
        let now = Utc::now();
        let first = merge(
            &[],
            &evaluate(&third_party_person("friend"), &config),
            now,
            false,
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
            false,
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
        let mut bad = default.clone();
        bad.threshold_2_eur = 0.0;
        assert_eq!(bad.validated().unwrap_err().field, "threshold_2_eur");
        assert_eq!(RiskConfig::from_setting(None), default);
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
