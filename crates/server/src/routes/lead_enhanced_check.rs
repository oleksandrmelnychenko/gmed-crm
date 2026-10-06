//! When a lead needs the enhanced check (verstärkte Sorgfaltspflichten,
//! § 15 GwG): the owner's rule of 2026-10-07.
//!
//! The enhanced check is required only when
//!
//! * the patient's country of residence is on the black list
//!   (`patient_residence_blacklist`): the lead's residence or the habitual
//!   residence the lead stated in the cabinet;
//! * a citizenship of the patient is on the black list
//!   (`patient_citizenship_blacklist`);
//! * the third-party payer's country of residence is on the black list
//!   (`payer_residence_blacklist`): the residence of the payer declaration
//!   and, once the payer answers through the own link, the residence and the
//!   habitual residence of the payer's statement (an organisation: its seat);
//! * a citizenship of the third-party payer is on the black list
//!   (`payer_citizenship_blacklist`; a person only);
//! * the sanctions screening has a confirmed match for the patient
//!   (`patient_sanctioned`) or for the third-party payer (`payer_sanctioned`).
//!
//! The black list is [`BLACK_LIST_COUNTRY_CODES`], the FATF "call for
//! action" countries — not the longer list of high-risk third countries and
//! not the blocked countries of the sanctions policy. A possible match that
//! nobody has reviewed yet is no trigger: it is reported as
//! `sanctions_review_pending` and leaves the check optional. A PEP, a country
//! of the longer high-risk list, cash or crypto and the expected total are
//! information for staff, who may still carry out and sign the check
//! voluntarily.
//!
//! [`enhanced_check_triggers`] is the one place that decides it: the lead
//! readiness, the staff wizard (`GET /leads/{id}/enhanced-check`), the
//! payer's check level (proof of funds), the GwG identification sheet and
//! the patient's legal status read it. See
//! docs/architecture/aml-enhanced-due-diligence_ua.md.

use axum::{
    Json, Router,
    extract::{Extension, Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::get,
};
use serde_json::{Value, json};
use sqlx::{PgConnection, Row};
use uuid::Uuid;

use crate::auth::middleware::AuthUser;
use crate::routes::lead_payer;
use crate::sanctions::normalize::country_code;
use crate::state::AppState;

/// The black list of the owner's rule: the FATF high-risk jurisdictions
/// subject to a call for action (North Korea, Iran, Myanmar). The staff
/// wizard mirrors it in `ENHANCED_CHECK_BLACKLIST_COUNTRY_CODES`
/// (`frontend/src/pages/leads/model/enhanced-check.ts`; a test there keeps
/// both equal).
pub const BLACK_LIST_COUNTRY_CODES: &[&str] = &["KP", "IR", "MM"];

pub const REASON_PATIENT_RESIDENCE_BLACKLIST: &str = "patient_residence_blacklist";
pub const REASON_PATIENT_CITIZENSHIP_BLACKLIST: &str = "patient_citizenship_blacklist";
pub const REASON_PAYER_RESIDENCE_BLACKLIST: &str = "payer_residence_blacklist";
pub const REASON_PAYER_CITIZENSHIP_BLACKLIST: &str = "payer_citizenship_blacklist";
pub const REASON_PATIENT_SANCTIONED: &str = "patient_sanctioned";
pub const REASON_PAYER_SANCTIONED: &str = "payer_sanctioned";
/// Information only: a possible match waits for the CEO's decision.
pub const REASON_SANCTIONS_REVIEW_PENDING: &str = "sanctions_review_pending";

pub fn router() -> Router<AppState> {
    Router::new().route("/leads/{lead_id}/enhanced-check", get(get_enhanced_check))
}

/// Whether the enhanced check is required, and why.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub(crate) struct EnhancedCheck {
    pub required: bool,
    /// The trigger keys in a fixed order; `sanctions_review_pending` may
    /// stand here while `required` is false.
    pub reasons: Vec<&'static str>,
    /// The black-list codes that triggered, for the labels.
    pub countries: Vec<String>,
}

impl EnhancedCheck {
    pub(crate) fn to_json(&self) -> Value {
        json!({
            "required": self.required,
            "reasons": self.reasons,
            "countries": self.countries,
        })
    }
}

/// What the sanctions screening says about one subject.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) enum Screening {
    #[default]
    Clear,
    /// At least one possible match nobody has decided yet.
    ReviewPending,
    /// At least one match the CEO confirmed.
    Confirmed,
}

impl Screening {
    fn from_counts(confirmed: i64, open: i64) -> Self {
        if confirmed > 0 {
            Self::Confirmed
        } else if open > 0 {
            Self::ReviewPending
        } else {
            Self::Clear
        }
    }
}

/// What the rule looks at: stored values (ISO codes; older rows may hold a
/// country name) and the screening state of the patient and the payer.
#[derive(Clone, Debug, Default)]
pub(crate) struct Subjects {
    pub patient_residence: Vec<String>,
    pub patient_citizenships: Vec<String>,
    pub payer_residence: Vec<String>,
    pub payer_citizenships: Vec<String>,
    pub patient_screening: Screening,
    pub payer_screening: Screening,
    /// Possible matches still open for the patient or the payer (also next
    /// to a confirmed one).
    pub review_pending: bool,
}

/// The black-list code of a stored country value (an ISO code or a name),
/// if it is on the black list.
pub(crate) fn black_list_code(value: &str) -> Option<&'static str> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return None;
    }
    let code = country_code(trimmed).or_else(|| {
        match trimmed.to_lowercase().as_str() {
            "birma" | "myanmar/birma" => Some("MM"),
            "demokratische volksrepublik korea" => Some("KP"),
            "islamische republik iran" => Some("IR"),
            _ => None,
        }
        .map(str::to_string)
    })?;
    BLACK_LIST_COUNTRY_CODES
        .iter()
        .copied()
        .find(|listed| *listed == code)
}

/// The rule itself (pure).
pub(crate) fn evaluate(subjects: &Subjects) -> EnhancedCheck {
    let mut check = EnhancedCheck::default();
    let mut black_listed = |values: &[String], reason: &'static str| {
        let codes: Vec<&'static str> = values
            .iter()
            .filter_map(|value| black_list_code(value))
            .collect();
        if codes.is_empty() {
            return;
        }
        check.reasons.push(reason);
        for code in codes {
            if !check.countries.iter().any(|known| known == code) {
                check.countries.push(code.to_string());
            }
        }
    };
    black_listed(
        &subjects.patient_residence,
        REASON_PATIENT_RESIDENCE_BLACKLIST,
    );
    black_listed(
        &subjects.patient_citizenships,
        REASON_PATIENT_CITIZENSHIP_BLACKLIST,
    );
    black_listed(&subjects.payer_residence, REASON_PAYER_RESIDENCE_BLACKLIST);
    black_listed(
        &subjects.payer_citizenships,
        REASON_PAYER_CITIZENSHIP_BLACKLIST,
    );
    if subjects.patient_screening == Screening::Confirmed {
        check.reasons.push(REASON_PATIENT_SANCTIONED);
    }
    if subjects.payer_screening == Screening::Confirmed {
        check.reasons.push(REASON_PAYER_SANCTIONED);
    }
    check.required = !check.reasons.is_empty();
    if subjects.review_pending {
        check.reasons.push(REASON_SANCTIONS_REVIEW_PENDING);
    }
    check
}

fn push_text(target: &mut Vec<String>, value: Option<String>) {
    if let Some(value) = value.map(|value| value.trim().to_string())
        && !value.is_empty()
        && !target.contains(&value)
    {
        target.push(value);
    }
}

fn push_all(target: &mut Vec<String>, values: Vec<String>) {
    for value in values {
        push_text(target, Some(value));
    }
}

/// Loads what the rule looks at in one query; `None` when the lead does not
/// exist.
pub(crate) async fn load_subjects(
    conn: &mut PgConnection,
    lead_id: Uuid,
) -> Result<Option<Subjects>, sqlx::Error> {
    let Some(row) = sqlx::query(
        r#"SELECT l.country,
                  l.citizenships,
                  l.wizard_state ->> 'registration_country' AS registration_country,
                  g.habitual_residence_country,
                  d.payer_kind,
                  d.payer_type,
                  d.country AS payer_country,
                  d.citizenships AS payer_citizenships,
                  s.country AS statement_country,
                  s.habitual_residence_country AS statement_habitual_residence_country,
                  s.citizenships AS statement_citizenships,
                  hits.patient_confirmed,
                  hits.patient_open,
                  hits.payer_confirmed,
                  hits.payer_open
           FROM leads l
           LEFT JOIN lead_gwg_declarations g ON g.lead_id = l.id
           LEFT JOIN lead_payer_declarations d ON d.lead_id = l.id
           LEFT JOIN lead_payer_statements s ON s.lead_id = l.id
           LEFT JOIN LATERAL (
               SELECT COUNT(*) FILTER (
                          WHERE h.subject_kind IN ('lead_patient', 'patient')
                            AND h.status = 'confirmed'
                      ) AS patient_confirmed,
                      COUNT(*) FILTER (
                          WHERE h.subject_kind IN ('lead_patient', 'patient')
                            AND h.status = 'open'
                      ) AS patient_open,
                      COUNT(*) FILTER (
                          WHERE h.subject_kind = 'lead_payer' AND h.status = 'confirmed'
                      ) AS payer_confirmed,
                      COUNT(*) FILTER (
                          WHERE h.subject_kind = 'lead_payer' AND h.status = 'open'
                      ) AS payer_open
               FROM sanctions_hits h
               WHERE (h.lead_id = l.id AND h.subject_kind IN ('lead_patient', 'lead_payer'))
                  -- The patient record of a repeat intake or of the converted lead.
                  OR (h.subject_kind = 'patient'
                      AND h.patient_id IN (l.prospect_patient_id, l.converted_patient_id))
           ) hits ON true
           WHERE l.id = $1"#,
    )
    .bind(lead_id)
    .fetch_optional(&mut *conn)
    .await?
    else {
        return Ok(None);
    };
    let text = |column: &str| row.try_get::<Option<String>, _>(column).ok().flatten();
    let list = |column: &str| {
        row.try_get::<Option<Vec<String>>, _>(column)
            .ok()
            .flatten()
            .unwrap_or_default()
    };
    let count = |column: &str| {
        row.try_get::<Option<i64>, _>(column)
            .ok()
            .flatten()
            .unwrap_or(0)
    };
    let mut subjects = Subjects {
        patient_screening: Screening::from_counts(
            count("patient_confirmed"),
            count("patient_open"),
        ),
        payer_screening: Screening::from_counts(count("payer_confirmed"), count("payer_open")),
        review_pending: count("patient_open") > 0 || count("payer_open") > 0,
        ..Subjects::default()
    };
    push_text(&mut subjects.patient_residence, text("country"));
    push_text(
        &mut subjects.patient_residence,
        text("habitual_residence_country"),
    );
    push_all(&mut subjects.patient_citizenships, list("citizenships"));
    push_text(
        &mut subjects.patient_citizenships,
        text("registration_country"),
    );
    // Only a third party is a payer of its own; a self-payer is the patient.
    if text("payer_kind").as_deref() == Some(lead_payer::PAYER_KIND_THIRD_PARTY) {
        // A third party without a type is a person (rows of older servers).
        let organisation = text("payer_type")
            .is_some_and(|payer_type| payer_type != lead_payer::PAYER_TYPE_PERSON);
        push_text(&mut subjects.payer_residence, text("payer_country"));
        push_text(&mut subjects.payer_residence, text("statement_country"));
        if !organisation {
            push_text(
                &mut subjects.payer_residence,
                text("statement_habitual_residence_country"),
            );
            push_all(&mut subjects.payer_citizenships, list("payer_citizenships"));
            push_all(
                &mut subjects.payer_citizenships,
                list("statement_citizenships"),
            );
        }
    }
    Ok(Some(subjects))
}

/// The enhanced check of a lead as stored now, in the caller's connection or
/// transaction. A lead that does not exist needs none.
pub(crate) async fn enhanced_check_triggers(
    conn: &mut PgConnection,
    lead_id: Uuid,
) -> Result<EnhancedCheck, sqlx::Error> {
    Ok(load_subjects(conn, lead_id)
        .await?
        .map(|subjects| evaluate(&subjects))
        .unwrap_or_default())
}

fn error(status: StatusCode, code: &str, message: &str) -> Response {
    (
        status,
        Json(json!({"error": code, "code": code, "message": message})),
    )
        .into_response()
}

fn database_error(error: sqlx::Error) -> Response {
    tracing::error!(%error, "load lead enhanced check");
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(json!({"error": "Internal Server Error", "message": "Failed to load the enhanced check"})),
    )
        .into_response()
}

/// `GET /leads/{lead_id}/enhanced-check`: `{ required, reasons, countries }`
/// for the roles that read the payer declaration.
async fn get_enhanced_check(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(lead_id): Path<Uuid>,
) -> Response {
    if !lead_payer::may_view(&auth) {
        return error(
            StatusCode::FORBIDDEN,
            "forbidden",
            "Insufficient permissions",
        );
    }
    let mut conn = match state.db.acquire().await {
        Ok(conn) => conn,
        Err(error) => return database_error(error),
    };
    match load_subjects(&mut conn, lead_id).await {
        Ok(Some(subjects)) => Json(evaluate(&subjects).to_json()).into_response(),
        Ok(None) => error(StatusCode::NOT_FOUND, "not_found", "Lead not found"),
        Err(error) => database_error(error),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn codes(values: &[&str]) -> Vec<String> {
        values.iter().map(|value| value.to_string()).collect()
    }

    fn check(subjects: Subjects) -> (bool, Vec<&'static str>) {
        let check = evaluate(&subjects);
        (check.required, check.reasons)
    }

    #[test]
    fn nothing_on_the_black_list_needs_no_check() {
        assert_eq!(
            check(Subjects {
                patient_residence: codes(&["DE"]),
                patient_citizenships: codes(&["UA", "PL"]),
                payer_residence: codes(&["AT"]),
                payer_citizenships: codes(&["AT"]),
                ..Subjects::default()
            }),
            (false, vec![])
        );
    }

    #[test]
    fn each_trigger_alone_requires_the_check() {
        let cases: [(Subjects, &str); 6] = [
            (
                Subjects {
                    patient_residence: codes(&["IR"]),
                    ..Subjects::default()
                },
                REASON_PATIENT_RESIDENCE_BLACKLIST,
            ),
            (
                Subjects {
                    patient_citizenships: codes(&["DE", "KP"]),
                    ..Subjects::default()
                },
                REASON_PATIENT_CITIZENSHIP_BLACKLIST,
            ),
            (
                Subjects {
                    payer_residence: codes(&["MM"]),
                    ..Subjects::default()
                },
                REASON_PAYER_RESIDENCE_BLACKLIST,
            ),
            (
                Subjects {
                    payer_citizenships: codes(&["IR"]),
                    ..Subjects::default()
                },
                REASON_PAYER_CITIZENSHIP_BLACKLIST,
            ),
            (
                Subjects {
                    patient_screening: Screening::Confirmed,
                    ..Subjects::default()
                },
                REASON_PATIENT_SANCTIONED,
            ),
            (
                Subjects {
                    payer_screening: Screening::Confirmed,
                    ..Subjects::default()
                },
                REASON_PAYER_SANCTIONED,
            ),
        ];
        for (subjects, reason) in cases {
            assert_eq!(check(subjects), (true, vec![reason]), "{reason}");
        }
    }

    #[test]
    fn a_russian_citizen_or_residence_needs_no_check() {
        // Russia, Syria, Venezuela … are on the longer list of high-risk
        // third countries, not on the black list.
        assert_eq!(
            check(Subjects {
                patient_residence: codes(&["RU", "Russland"]),
                patient_citizenships: codes(&["RU", "SY"]),
                payer_residence: codes(&["VE"]),
                payer_citizenships: codes(&["RU"]),
                ..Subjects::default()
            }),
            (false, vec![])
        );
    }

    #[test]
    fn a_pep_alone_needs_no_check() {
        // A PEP is no input of the rule: a lead without a black-list country
        // and without a confirmed match needs no check, whatever staff or the
        // lead answered about public offices (the wizard shows a hint).
        assert_eq!(check(Subjects::default()), (false, vec![]));
    }

    #[test]
    fn an_open_match_is_reported_but_needs_no_check() {
        let pending = Subjects {
            patient_screening: Screening::ReviewPending,
            review_pending: true,
            ..Subjects::default()
        };
        assert_eq!(
            check(pending),
            (false, vec![REASON_SANCTIONS_REVIEW_PENDING])
        );
        let confirmed = Subjects {
            payer_screening: Screening::Confirmed,
            patient_screening: Screening::ReviewPending,
            review_pending: true,
            ..Subjects::default()
        };
        assert_eq!(
            check(confirmed),
            (
                true,
                vec![REASON_PAYER_SANCTIONED, REASON_SANCTIONS_REVIEW_PENDING]
            )
        );
    }

    #[test]
    fn a_confirmed_match_requires_the_check() {
        assert_eq!(
            Screening::from_counts(1, 0),
            Screening::Confirmed,
            "confirmed"
        );
        assert_eq!(Screening::from_counts(1, 2), Screening::Confirmed);
        assert_eq!(Screening::from_counts(0, 2), Screening::ReviewPending);
        assert_eq!(Screening::from_counts(0, 0), Screening::Clear);
        assert_eq!(
            check(Subjects {
                patient_screening: Screening::from_counts(1, 0),
                ..Subjects::default()
            }),
            (true, vec![REASON_PATIENT_SANCTIONED])
        );
    }

    #[test]
    fn names_of_older_rows_and_the_order_of_the_reasons() {
        let all = evaluate(&Subjects {
            patient_residence: codes(&["Iran"]),
            patient_citizenships: codes(&["Nordkorea"]),
            payer_residence: codes(&["Myanmar/Birma"]),
            payer_citizenships: codes(&["ir"]),
            patient_screening: Screening::Confirmed,
            payer_screening: Screening::Confirmed,
            review_pending: false,
        });
        assert!(all.required);
        assert_eq!(
            all.reasons,
            [
                REASON_PATIENT_RESIDENCE_BLACKLIST,
                REASON_PATIENT_CITIZENSHIP_BLACKLIST,
                REASON_PAYER_RESIDENCE_BLACKLIST,
                REASON_PAYER_CITIZENSHIP_BLACKLIST,
                REASON_PATIENT_SANCTIONED,
                REASON_PAYER_SANCTIONED,
            ]
        );
        assert_eq!(all.countries, ["IR", "KP", "MM"]);
        assert_eq!(
            all.to_json(),
            json!({
                "required": true,
                "reasons": all.reasons,
                "countries": ["IR", "KP", "MM"],
            })
        );
    }

    #[test]
    fn the_black_list_is_north_korea_iran_and_myanmar() {
        assert_eq!(BLACK_LIST_COUNTRY_CODES, ["KP", "IR", "MM"]);
        for value in ["KP", "ir", " MM ", "Iran", "north korea", "Burma", "Birma"] {
            assert!(black_list_code(value).is_some(), "{value}");
        }
        for value in ["", "RU", "DE", "Syria", "Atlantis"] {
            assert!(black_list_code(value).is_none(), "{value}");
        }
    }
}
