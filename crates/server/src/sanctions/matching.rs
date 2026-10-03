//! Fuzzy matching of one person or organisation against the EU list.
//!
//! The score of a list entry is the weakest similarity among the name tokens
//! that must match (the first given name and at least one surname token, in
//! any order), adjusted by the birth date and the citizenships:
//!
//! * token similarity: Jaro-Winkler on canonical tokens; tokens of up to three
//!   letters must be equal; equal consonant skeletons of long tokens count as
//!   [`SKELETON_SIMILARITY`]; a patronymic never stands in for a surname;
//! * middle names and patronymics are optional on both sides;
//! * birth date: exact date [`DOB_EXACT_BOOST`], same year [`DOB_YEAR_BOOST`],
//!   a list date that contradicts ours [`DOB_CONFLICT_PENALTY`];
//! * citizenship: shared country [`CITIZENSHIP_MATCH_BOOST`], disjoint known
//!   countries [`CITIZENSHIP_CONFLICT_PENALTY`].
//!
//! An entry at or above [`POSSIBLE_MATCH_THRESHOLD`] is a possible match. It is
//! never more than that: a name match is not an identity, the CEO decides.

use std::collections::HashMap;

use chrono::{Datelike, NaiveDate};
use serde::Serialize;

use super::fsf::{ListBirthDate, ListEntry, SubjectType};
use super::normalize::{NameToken, name_tokens, organisation_tokens};

/// A token pair below this similarity does not count as matched.
pub const TOKEN_MATCH_MIN: f64 = 0.85;
/// Final score from which an entry is reported as a possible match.
pub const POSSIBLE_MATCH_THRESHOLD: f64 = 0.90;
/// Tokens of up to this many letters must be equal (`Li` / `Le`).
pub const SHORT_TOKEN_MAX_CHARS: usize = 3;
/// Similarity of two long tokens with equal consonant skeletons.
pub const SKELETON_SIMILARITY: f64 = 0.92;
/// Upper bound when only one of two tokens is a patronymic
/// (`Ivanov` / `Ivanovich`).
pub const PATRONYMIC_MISMATCH_CAP: f64 = 0.80;
pub const DOB_EXACT_BOOST: f64 = 0.08;
pub const DOB_YEAR_BOOST: f64 = 0.04;
pub const DOB_CONFLICT_PENALTY: f64 = 0.15;
pub const CITIZENSHIP_MATCH_BOOST: f64 = 0.03;
pub const CITIZENSHIP_CONFLICT_PENALTY: f64 = 0.02;
/// Per surname token of ours the list name does not contain.
pub const EXTRA_SUBJECT_TOKEN_PENALTY: f64 = 0.02;
/// Per list token beyond the first that matched nothing of ours.
pub const EXTRA_LIST_TOKEN_PENALTY: f64 = 0.01;
/// A single-word organisation name needs at least this many letters.
pub const MIN_SINGLE_ORGANISATION_TOKEN_CHARS: usize = 4;

/// Jaro-Winkler similarity (prefix scale 0.1, at most four prefix letters).
pub fn jaro_winkler(left: &str, right: &str) -> f64 {
    let a: Vec<char> = left.chars().collect();
    let b: Vec<char> = right.chars().collect();
    if a.is_empty() || b.is_empty() {
        return if a.is_empty() && b.is_empty() {
            1.0
        } else {
            0.0
        };
    }
    if a == b {
        return 1.0;
    }
    let window = (a.len().max(b.len()) / 2).saturating_sub(1);
    let mut a_matched = vec![false; a.len()];
    let mut b_matched = vec![false; b.len()];
    let mut matches = 0usize;
    for (i, a_char) in a.iter().enumerate() {
        let start = i.saturating_sub(window);
        let end = (i + window + 1).min(b.len());
        if let Some(j) = (start..end).find(|&j| !b_matched[j] && b[j] == *a_char) {
            a_matched[i] = true;
            b_matched[j] = true;
            matches += 1;
        }
    }
    if matches == 0 {
        return 0.0;
    }
    let mut transpositions = 0usize;
    let mut k = 0usize;
    for (i, a_char) in a.iter().enumerate() {
        if a_matched[i] {
            while !b_matched[k] {
                k += 1;
            }
            if *a_char != b[k] {
                transpositions += 1;
            }
            k += 1;
        }
    }
    let m = matches as f64;
    let jaro =
        (m / a.len() as f64 + m / b.len() as f64 + (m - transpositions as f64 / 2.0) / m) / 3.0;
    let prefix = a
        .iter()
        .zip(b.iter())
        .take(4)
        .take_while(|(x, y)| x == y)
        .count();
    jaro + prefix as f64 * 0.1 * (1.0 - jaro)
}

/// Similarity of two canonical name tokens.
pub fn token_similarity(left: &NameToken, right: &NameToken) -> f64 {
    if left.canon == right.canon {
        return 1.0;
    }
    if left.canon.chars().count() <= SHORT_TOKEN_MAX_CHARS
        || right.canon.chars().count() <= SHORT_TOKEN_MAX_CHARS
    {
        return 0.0;
    }
    let mut similarity = jaro_winkler(&left.canon, &right.canon);
    if left.canon.len() >= 5
        && right.canon.len() >= 5
        && left.skeleton.len() >= 3
        && left.skeleton == right.skeleton
    {
        similarity = similarity.max(SKELETON_SIMILARITY);
    }
    if left.patronymic != right.patronymic {
        similarity = similarity.min(PATRONYMIC_MISMATCH_CAP);
    }
    similarity
}

/// The person or organisation we screen.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
pub struct Subject {
    pub first_name: String,
    pub middle_name: Option<String>,
    pub last_name: String,
    pub date_of_birth: Option<NaiveDate>,
    /// Upper-case ISO 3166-1 alpha-2 codes.
    pub citizenships: Vec<String>,
    /// An organisation is screened against list entities by its whole name
    /// (`last_name`, `first_name` empty).
    pub organisation: bool,
}

impl Subject {
    /// Whether there is enough name to screen: first and last name for a
    /// person, a name for an organisation.
    pub fn is_screenable(&self) -> bool {
        if self.organisation {
            let tokens = organisation_tokens(&self.last_name);
            return match tokens.as_slice() {
                [] => false,
                [single] => single.canon.chars().count() >= MIN_SINGLE_ORGANISATION_TOKEN_CHARS,
                _ => true,
            };
        }
        !name_tokens(&self.first_name).is_empty() && !name_tokens(&self.last_name).is_empty()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum DobSignal {
    Exact,
    Year,
    Conflict,
    Unknown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum CitizenshipSignal {
    Match,
    Conflict,
    Unknown,
}

/// One possible match, best name variant of one list entry.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Match {
    #[serde(skip)]
    pub entry_index: usize,
    pub score: f64,
    pub name_score: f64,
    pub matched_name: String,
    pub dob: DobSignal,
    pub citizenship: CitizenshipSignal,
}

struct IndexedEntry {
    entry: ListEntry,
    /// Token ids into [`SanctionsIndex::dictionary`], one list per name variant.
    variants: Vec<(String, Vec<u32>)>,
}

/// The active list version prepared for matching. Distinct tokens are kept
/// once, so one subject is compared against each spelling only once.
pub struct SanctionsIndex {
    dictionary: Vec<NameToken>,
    entries: Vec<IndexedEntry>,
}

impl SanctionsIndex {
    pub fn build(entries: Vec<ListEntry>) -> Self {
        let mut dictionary: Vec<NameToken> = Vec::new();
        let mut ids: HashMap<String, u32> = HashMap::new();
        let mut indexed = Vec::with_capacity(entries.len());
        for entry in entries {
            let mut variants: Vec<(String, Vec<u32>)> = Vec::new();
            for name in &entry.names {
                let display = name.display();
                if display.is_empty() {
                    continue;
                }
                let tokens = match entry.subject_type {
                    SubjectType::Person => name_tokens(&display),
                    SubjectType::Entity => organisation_tokens(&display),
                };
                if tokens.is_empty() {
                    continue;
                }
                let token_ids: Vec<u32> = tokens
                    .into_iter()
                    .map(|token| {
                        *ids.entry(token.canon.clone()).or_insert_with(|| {
                            dictionary.push(token);
                            (dictionary.len() - 1) as u32
                        })
                    })
                    .collect();
                if !variants.iter().any(|(_, existing)| *existing == token_ids) {
                    variants.push((display, token_ids));
                }
            }
            indexed.push(IndexedEntry { entry, variants });
        }
        Self {
            dictionary,
            entries: indexed,
        }
    }

    pub fn len(&self) -> usize {
        self.entries.len()
    }

    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    pub fn entry(&self, index: usize) -> &ListEntry {
        &self.entries[index].entry
    }

    /// Possible matches of `subject`, best first, at most one per entry.
    pub fn screen(&self, subject: &Subject) -> Vec<Match> {
        if !subject.is_screenable() {
            return Vec::new();
        }
        let prepared = PreparedSubject::new(subject);
        let similarities: Vec<Vec<f64>> = prepared
            .tokens
            .iter()
            .map(|(token, _)| {
                self.dictionary
                    .iter()
                    .map(|candidate| {
                        let similarity = token_similarity(token, candidate);
                        if similarity >= TOKEN_MATCH_MIN {
                            similarity
                        } else {
                            0.0
                        }
                    })
                    .collect()
            })
            .collect();
        let wanted = if subject.organisation {
            SubjectType::Entity
        } else {
            SubjectType::Person
        };

        let mut matches = Vec::new();
        for (entry_index, indexed) in self.entries.iter().enumerate() {
            if indexed.entry.subject_type != wanted {
                continue;
            }
            let mut best: Option<(f64, &str)> = None;
            for (display, token_ids) in &indexed.variants {
                let score = if subject.organisation {
                    organisation_name_score(&prepared, &similarities, token_ids)
                } else {
                    person_name_score(&prepared, &similarities, token_ids)
                };
                if let Some(score) = score
                    && best.is_none_or(|(current, _)| score > current)
                {
                    best = Some((score, display));
                }
            }
            let Some((name_score, matched_name)) = best else {
                continue;
            };
            let dob = dob_signal(subject.date_of_birth, &indexed.entry.birth_dates);
            let citizenship =
                citizenship_signal(&subject.citizenships, &indexed.entry.citizenships);
            let score = adjusted_score(name_score, dob, citizenship);
            if score >= POSSIBLE_MATCH_THRESHOLD {
                matches.push(Match {
                    entry_index,
                    score,
                    name_score,
                    matched_name: matched_name.to_string(),
                    dob,
                    citizenship,
                });
            }
        }
        matches.sort_by(|left, right| right.score.total_cmp(&left.score));
        matches
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum TokenRole {
    /// The first given name: must match.
    PrimaryFirst,
    /// Further given names and middle names: optional.
    Optional,
    /// Surname tokens: at least one must match, the others cost a little.
    Last,
    /// Organisation tokens: all must match.
    Organisation,
}

struct PreparedSubject {
    tokens: Vec<(NameToken, TokenRole)>,
}

impl PreparedSubject {
    fn new(subject: &Subject) -> Self {
        let mut tokens = Vec::new();
        if subject.organisation {
            for token in organisation_tokens(&subject.last_name) {
                tokens.push((token, TokenRole::Organisation));
            }
            return Self { tokens };
        }
        for (index, token) in name_tokens(&subject.first_name).into_iter().enumerate() {
            let role = if index == 0 {
                TokenRole::PrimaryFirst
            } else {
                TokenRole::Optional
            };
            tokens.push((token, role));
        }
        for token in name_tokens(subject.middle_name.as_deref().unwrap_or_default()) {
            tokens.push((token, TokenRole::Optional));
        }
        for token in name_tokens(&subject.last_name) {
            tokens.push((token, TokenRole::Last));
        }
        Self { tokens }
    }
}

/// Greedy one-to-one assignment of our tokens to the variant's tokens, best
/// pairs first. Returns the similarity per subject token (0 = unassigned) and
/// the number of variant tokens left over.
fn assign(similarities: &[Vec<f64>], token_ids: &[u32]) -> (Vec<f64>, usize) {
    let mut pairs = Vec::new();
    for (subject_index, row) in similarities.iter().enumerate() {
        for (variant_index, token_id) in token_ids.iter().enumerate() {
            let similarity = row[*token_id as usize];
            if similarity > 0.0 {
                pairs.push((similarity, subject_index, variant_index));
            }
        }
    }
    pairs.sort_by(|left, right| right.0.total_cmp(&left.0));
    let mut subject_scores = vec![0.0; similarities.len()];
    let mut variant_used = vec![false; token_ids.len()];
    for (similarity, subject_index, variant_index) in pairs {
        if subject_scores[subject_index] == 0.0 && !variant_used[variant_index] {
            subject_scores[subject_index] = similarity;
            variant_used[variant_index] = true;
        }
    }
    let unused = variant_used.iter().filter(|used| !**used).count();
    (subject_scores, unused)
}

fn person_name_score(
    subject: &PreparedSubject,
    similarities: &[Vec<f64>],
    token_ids: &[u32],
) -> Option<f64> {
    if token_ids.len() < 2 {
        return None;
    }
    // Cheap pre-check before the assignment: the first name and some surname
    // token must find a partner at all.
    let has_partner = |subject_index: usize| {
        token_ids
            .iter()
            .any(|token_id| similarities[subject_index][*token_id as usize] > 0.0)
    };
    let primary = subject
        .tokens
        .iter()
        .position(|(_, role)| *role == TokenRole::PrimaryFirst)?;
    if !has_partner(primary) {
        return None;
    }
    let last_indices: Vec<usize> = subject
        .tokens
        .iter()
        .enumerate()
        .filter(|(_, (_, role))| *role == TokenRole::Last)
        .map(|(index, _)| index)
        .collect();
    if !last_indices.iter().any(|index| has_partner(*index)) {
        return None;
    }

    let (scores, unused_variant_tokens) = assign(similarities, token_ids);
    let primary_score = scores[primary];
    if primary_score == 0.0 {
        return None;
    }
    let matched_last: Vec<f64> = last_indices
        .iter()
        .map(|index| scores[*index])
        .filter(|score| *score > 0.0)
        .collect();
    if matched_last.is_empty() {
        return None;
    }
    let unmatched_last = last_indices.len() - matched_last.len();
    let weakest = matched_last.iter().copied().fold(primary_score, f64::min);
    Some(
        weakest
            - unmatched_last as f64 * EXTRA_SUBJECT_TOKEN_PENALTY
            - unused_variant_tokens.saturating_sub(1) as f64 * EXTRA_LIST_TOKEN_PENALTY,
    )
}

fn organisation_name_score(
    subject: &PreparedSubject,
    similarities: &[Vec<f64>],
    token_ids: &[u32],
) -> Option<f64> {
    if subject.tokens.is_empty() {
        return None;
    }
    let (scores, unused_variant_tokens) = assign(similarities, token_ids);
    if scores.contains(&0.0) {
        return None;
    }
    let weakest = scores.iter().copied().fold(1.0, f64::min);
    Some(weakest - unused_variant_tokens as f64 * EXTRA_SUBJECT_TOKEN_PENALTY)
}

pub fn dob_signal(subject: Option<NaiveDate>, list: &[ListBirthDate]) -> DobSignal {
    let Some(date) = subject else {
        return DobSignal::Unknown;
    };
    let mut any_known = false;
    let mut year_match = false;
    for birth in list {
        if birth.date == Some(date) {
            return DobSignal::Exact;
        }
        let Some(year) = birth.year.or(birth.date.map(|value| value.year())) else {
            continue;
        };
        any_known = true;
        let tolerance = if birth.circa { 1 } else { 0 };
        if (year - date.year()).abs() <= tolerance {
            year_match = true;
        }
    }
    if year_match {
        DobSignal::Year
    } else if any_known {
        DobSignal::Conflict
    } else {
        DobSignal::Unknown
    }
}

pub fn citizenship_signal(subject: &[String], list: &[String]) -> CitizenshipSignal {
    if subject.is_empty() || list.is_empty() {
        return CitizenshipSignal::Unknown;
    }
    if subject.iter().any(|code| list.contains(code)) {
        CitizenshipSignal::Match
    } else {
        CitizenshipSignal::Conflict
    }
}

pub fn adjusted_score(name_score: f64, dob: DobSignal, citizenship: CitizenshipSignal) -> f64 {
    let mut score = name_score;
    score += match dob {
        DobSignal::Exact => DOB_EXACT_BOOST,
        DobSignal::Year => DOB_YEAR_BOOST,
        DobSignal::Conflict => -DOB_CONFLICT_PENALTY,
        DobSignal::Unknown => 0.0,
    };
    score += match citizenship {
        CitizenshipSignal::Match => CITIZENSHIP_MATCH_BOOST,
        CitizenshipSignal::Conflict => -CITIZENSHIP_CONFLICT_PENALTY,
        CitizenshipSignal::Unknown => 0.0,
    };
    score.clamp(0.0, 1.0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sanctions::fsf::{ListName, ListRegulation};

    fn person(
        id: &str,
        names: &[&str],
        dob: Option<&str>,
        year: Option<i32>,
        citizenships: &[&str],
    ) -> ListEntry {
        ListEntry {
            logical_id: id.to_string(),
            eu_reference: Some(format!("EU.TEST.{id}")),
            un_reference: None,
            subject_type: SubjectType::Person,
            names: names
                .iter()
                .map(|name| ListName {
                    whole_name: name.to_string(),
                    ..ListName::default()
                })
                .collect(),
            birth_dates: if dob.is_some() || year.is_some() {
                vec![ListBirthDate {
                    date: dob.map(|value| NaiveDate::parse_from_str(value, "%Y-%m-%d").unwrap()),
                    year,
                    circa: false,
                    ..ListBirthDate::default()
                }]
            } else {
                Vec::new()
            },
            citizenships: citizenships.iter().map(|code| code.to_string()).collect(),
            regulations: vec![ListRegulation::default()],
            designation_date: None,
            remark: None,
        }
    }

    fn entity(id: &str, names: &[&str]) -> ListEntry {
        ListEntry {
            subject_type: SubjectType::Entity,
            ..person(id, names, None, None, &[])
        }
    }

    fn subject(first: &str, last: &str) -> Subject {
        Subject {
            first_name: first.to_string(),
            last_name: last.to_string(),
            ..Subject::default()
        }
    }

    fn born(mut subject: Subject, date: &str) -> Subject {
        subject.date_of_birth = Some(NaiveDate::parse_from_str(date, "%Y-%m-%d").unwrap());
        subject
    }

    fn citizen(mut subject: Subject, codes: &[&str]) -> Subject {
        subject.citizenships = codes.iter().map(|code| code.to_string()).collect();
        subject
    }

    /// Invented list: none of these persons exists on the real EU list.
    fn synthetic_index() -> SanctionsIndex {
        SanctionsIndex::build(vec![
            person(
                "1001",
                &[
                    "Iwan Petrowitsch KORNEJEW",
                    "Ivan Petrovich KORNEEV",
                    "Иван Петрович Корнеев",
                ],
                Some("1961-03-14"),
                None,
                &["RU"],
            ),
            person(
                "1002",
                &["Zorana MILETICH-BAUER"],
                None,
                Some(1978),
                &["RS"],
            ),
            person("1003", &["Mohammed Qasim AL-FARISI"], None, None, &[]),
            person(
                "1004",
                &["Alexandra SVETLOVA"],
                Some("1985-07-02"),
                None,
                &["BY"],
            ),
            entity(
                "2001",
                &["OOO Polartek Shipping Ltd", "Polartek Morskie Perevozki"],
            ),
        ])
    }

    fn matched_ids(index: &SanctionsIndex, subject: &Subject) -> Vec<String> {
        index
            .screen(subject)
            .iter()
            .map(|found| index.entry(found.entry_index).logical_id.clone())
            .collect()
    }

    #[test]
    fn jaro_winkler_matches_reference_values() {
        assert!((jaro_winkler("martha", "marhta") - 0.9611).abs() < 0.001);
        assert!((jaro_winkler("dwayne", "duane") - 0.84).abs() < 0.001);
        assert!((jaro_winkler("dixon", "dicksonx") - 0.8133).abs() < 0.001);
        assert_eq!(jaro_winkler("same", "same"), 1.0);
        assert_eq!(jaro_winkler("abc", ""), 0.0);
    }

    #[test]
    fn transliteration_variants_and_token_order_match() {
        let index = synthetic_index();
        for (first, last) in [
            ("Ivan", "Korneev"),
            ("Iwan", "Kornejew"),
            ("Ivan", "Korneeff"),
            ("Иван", "Корнеев"),
            ("Korneev", "Ivan"),
            ("IVAN", "KORNEEV"),
        ] {
            assert_eq!(
                matched_ids(&index, &subject(first, last)),
                vec!["1001"],
                "{first} {last}"
            );
        }
    }

    #[test]
    fn middle_names_are_optional_on_both_sides() {
        let index = synthetic_index();
        let mut with_patronymic = subject("Ivan", "Korneev");
        with_patronymic.middle_name = Some("Petrovich".into());
        assert_eq!(matched_ids(&index, &with_patronymic), vec!["1001"]);
        // The list has the patronymic, we do not.
        assert_eq!(
            matched_ids(&index, &subject("Ivan", "Korneev")),
            vec!["1001"]
        );
    }

    #[test]
    fn a_patronymic_does_not_stand_in_for_a_surname() {
        let index = synthetic_index();
        // "Petrov" is close to the list's patronymic "Petrovich", not to a surname.
        assert!(matched_ids(&index, &subject("Ivan", "Petrov")).is_empty());
    }

    #[test]
    fn similar_but_different_surnames_stay_clear_without_further_evidence() {
        let index = synthetic_index();
        assert!(matched_ids(&index, &subject("Ivan", "Kornienko")).is_empty());
        assert!(matched_ids(&index, &subject("Ivan", "Kovalev")).is_empty());
        assert!(matched_ids(&index, &subject("Igor", "Korneev")).is_empty());
        assert!(matched_ids(&index, &subject("Anna", "Schmidt")).is_empty());
    }

    #[test]
    fn birth_date_boosts_and_contradictions_change_the_result() {
        let index = synthetic_index();
        let exact = index.screen(&born(subject("Ivan", "Korneev"), "1961-03-14"));
        assert_eq!(exact[0].dob, DobSignal::Exact);
        assert_eq!(exact[0].score, 1.0);

        // Same year, other day: still a possible match.
        let year = index.screen(&born(subject("Ivan", "Korneev"), "1961-11-30"));
        assert_eq!(year[0].dob, DobSignal::Year);

        // A list birth date decades apart makes a common name clear.
        assert!(
            index
                .screen(&born(subject("Ivan", "Korneev"), "1994-05-20"))
                .is_empty()
        );

        // The male form of a listed woman's name is a possible match without
        // a date; with a contradicting date it is not.
        assert_eq!(
            matched_ids(&index, &subject("Aleksandr", "Svetlov")),
            vec!["1004"]
        );
        assert!(
            matched_ids(&index, &born(subject("Aleksandr", "Svetlov"), "2001-01-09")).is_empty()
        );
    }

    #[test]
    fn year_only_list_dates_and_compound_surnames() {
        let index = synthetic_index();
        let found = index.screen(&born(subject("Zorana", "Miletić"), "1978-02-02"));
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].dob, DobSignal::Year);
        // One of two surname tokens is enough.
        assert_eq!(
            matched_ids(&index, &subject("Zorana", "Bauer")),
            vec!["1002"]
        );
    }

    #[test]
    fn vowel_variants_of_long_names_match_by_skeleton() {
        let index = synthetic_index();
        assert_eq!(
            matched_ids(&index, &subject("Muhammad", "Al Farisi")),
            vec!["1003"]
        );
    }

    #[test]
    fn citizenship_adjusts_the_score() {
        let index = synthetic_index();
        let shared = index.screen(&citizen(subject("Ivan", "Korneev"), &["RU", "DE"]));
        assert_eq!(shared[0].citizenship, CitizenshipSignal::Match);
        let other = index.screen(&citizen(subject("Ivan", "Korneev"), &["FR"]));
        assert_eq!(other[0].citizenship, CitizenshipSignal::Conflict);
        assert!(other[0].score < shared[0].score);
    }

    #[test]
    fn persons_never_match_entities_and_vice_versa() {
        let index = synthetic_index();
        assert!(matched_ids(&index, &subject("Polartek", "Shipping")).is_empty());
        let organisation = Subject {
            last_name: "Polartek Shipping LLC".into(),
            organisation: true,
            ..Subject::default()
        };
        assert_eq!(matched_ids(&index, &organisation), vec!["2001"]);
        let unrelated = Subject {
            last_name: "Nordwind Logistik GmbH".into(),
            organisation: true,
            ..Subject::default()
        };
        assert!(matched_ids(&index, &unrelated).is_empty());
    }

    #[test]
    fn incomplete_names_are_not_screened() {
        let index = synthetic_index();
        assert!(!subject("Ivan", "").is_screenable());
        assert!(!subject("", "Korneev").is_screenable());
        assert!(index.screen(&subject("Ivan", " ")).is_empty());
        let short_organisation = Subject {
            last_name: "AB LLC".into(),
            organisation: true,
            ..Subject::default()
        };
        assert!(!short_organisation.is_screenable());
    }

    #[test]
    fn short_tokens_must_be_equal() {
        let short = |canon: &str| name_tokens(canon).remove(0);
        assert_eq!(token_similarity(&short("Li"), &short("Le")), 0.0);
        assert_eq!(token_similarity(&short("Ali"), &short("Ali")), 1.0);
    }
}
