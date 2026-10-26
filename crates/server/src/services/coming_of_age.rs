//! A minor patient turns 18 (owner decision 2026-10-20).
//!
//! The parents of a converted minor reach the child's patient record through
//! the assignments the conversion gave them (`patient_assignments.source =
//! 'lead_guardian'`, [`crate::routes::lead_portal_account::link_to_patient_in_tx`])
//! and the child's converted request through their guardian access
//! (`lead_portal_access.kind = 'guardian'`). Both end on the 18th birthday
//! (Europe/Berlin day, [`crate::app_time`]): once a day this job
//!
//! - revokes every still-active `lead_guardian` assignment of a patient who is
//!   18 or older (`revoked_by` NULL, `revoked_reason = 'patient_came_of_age'`),
//! - revokes the still-active guardian accesses of the patient's converted
//!   requests,
//! - switches off (never deletes) a parent's login that reaches nothing else
//!   any more, as staff revoking a guardian access does; a parent with an own
//!   record, an own request or another child keeps the login unchanged,
//! - and tells the patient's staff once per patient to issue the patient's own
//!   login ([`NOTIFICATION_KIND`]), unless the patient already has one.
//!
//! A request that was not converted yet (owner decision 2026-10-23): on the
//! 18th birthday by the date of birth on the request the parents' guardian
//! accesses end the same way (`revoked_reason = 'patient_came_of_age'`),
//! audited, and staff are told once per request to issue the now adult
//! lead's own login ([`LEAD_NOTIFICATION_KIND`]). The parents' logins stay:
//! their cabinet says the access ended because the person is of age.
//!
//! Signals (owner request 2026-10-26): [`ADVANCE_NOTICE_DAYS`] before the
//! birthday staff get an advance notice once per person
//! ([`run_advance_notices_on`]: [`SOON_NOTIFICATION_KIND`] /
//! [`LEAD_SOON_NOTIFICATION_KIND`], realtime [`SOON_EVENT`] /
//! [`LEAD_SOON_EVENT`]); on the birthday open patient cards and wizards get
//! [`CAME_OF_AGE_EVENT`] / [`LEAD_CAME_OF_AGE_EVENT`], and the parents' open
//! cabinets [`crate::realtime::LEAD_PORTAL_ACCESS_ENDED`].
//!
//! An access staff granted explicitly (any other `source`) is never touched.
//! Released documents keep their shares as history; the portal shows a
//! patient's documents only through an active assignment
//! ([`crate::routes::me::resolve_linked_patient_id`]), so the parents no
//! longer see them. Every change is audited in its transaction, each patient
//! in its own; a second run finds nothing to do.

use chrono::{Datelike, NaiveDate};
use serde_json::json;
use sqlx::Row;
use uuid::Uuid;

use crate::audit;
use crate::state::AppState;

/// `patient_assignments.revoked_reason` / `lead_portal_access.revoked_reason`.
pub const REVOKE_REASON: &str = "patient_came_of_age";
/// `user_notifications.kind` of the staff notice.
pub const NOTIFICATION_KIND: &str = "patient_came_of_age";
/// Audit action that marks the notice as sent, so it goes out once.
pub const NOTIFIED_ACTION: &str = "notify_patient_came_of_age";

/// What one run did.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct ComingOfAgeReport {
    /// Adult patients whose parents' access ended in this run.
    pub patients: usize,
    pub assignments_revoked: usize,
    pub lead_accesses_revoked: usize,
    /// Parents' logins switched off because they reach nothing else.
    pub logins_deactivated: usize,
    /// Staff notifications stored.
    pub notifications: usize,
    /// Requests not converted yet whose parents' access ended in this run.
    pub leads: usize,
}

/// `user_notifications.kind` of the staff notice for a request (lead) that
/// was not converted when the person turned 18 (owner decision 2026-10-23).
pub const LEAD_NOTIFICATION_KIND: &str = "lead_came_of_age";
/// Audit action that marks the lead notice as sent, so it goes out once.
pub const LEAD_NOTIFIED_ACTION: &str = "notify_lead_came_of_age";

/// Patients 18 or older on `today` with a parent's access still active.
const CANDIDATES_SQL: &str = r#"
    SELECT p.id FROM patients p
    WHERE p.birth_date IS NOT NULL
      AND p.birth_date <= ($1::date - INTERVAL '18 years')::date
      AND (
          EXISTS (SELECT 1 FROM patient_assignments pa
                  WHERE pa.patient_id = p.id AND pa.source = 'lead_guardian'
                    AND pa.revoked_at IS NULL)
          OR EXISTS (SELECT 1 FROM leads l
                     JOIN lead_portal_access a ON a.lead_id = l.id
                     WHERE l.converted_patient_id = p.id AND a.kind = 'guardian'
                       AND a.revoked_at IS NULL)
      )
    ORDER BY p.id"#;

/// Staff told to issue the login: the patient managers assigned to the
/// patient, else every patient manager, else the CEO.
const RECIPIENTS_SQL: &str = r#"
    WITH assigned AS (
        SELECT u.id FROM patient_assignments pa
        JOIN users u ON u.id = pa.user_id
        WHERE pa.patient_id = $1 AND pa.revoked_at IS NULL
          AND u.is_active AND u.role = 'patient_manager'
    ), managers AS (
        SELECT id FROM users
        WHERE is_active AND role = 'patient_manager'
          AND NOT EXISTS (SELECT 1 FROM assigned)
    ), fallback AS (
        SELECT id FROM users
        WHERE is_active AND role = 'ceo'
          AND NOT EXISTS (SELECT 1 FROM assigned)
          AND NOT EXISTS (SELECT 1 FROM managers)
    )
    SELECT id FROM assigned
    UNION SELECT id FROM managers
    UNION SELECT id FROM fallback"#;

/// One patient's result, for the report and the realtime events.
#[derive(Default)]
struct PatientOutcome {
    assignments_revoked: usize,
    lead_accesses_revoked: usize,
    logins_deactivated: usize,
    notifications: Vec<(Uuid, Uuid)>,
    /// `(lead, parent's login)` of every guardian access that ended: their
    /// open cabinet is told live ([`crate::realtime::LEAD_PORTAL_ACCESS_ENDED`]).
    ended_lead_accesses: Vec<(Uuid, Uuid)>,
}

/// Realtime event to staff on the 18th birthday: the parents' access to the
/// patient record ended (open patient cards reload).
pub const CAME_OF_AGE_EVENT: &str = "patient.came_of_age";
/// Realtime event to staff on the 18th birthday of a request not converted
/// yet: the parents' access to the request ended (open wizards reload).
pub const LEAD_CAME_OF_AGE_EVENT: &str = "lead.came_of_age";

/// The advance notice goes out this many days before the 18th birthday — or
/// at once, if the person comes within the window later (a date of birth
/// entered late, a job that did not run that day).
pub const ADVANCE_NOTICE_DAYS: i32 = 30;
/// `user_notifications.kind` of the advance notice for a patient.
pub const SOON_NOTIFICATION_KIND: &str = "patient_coming_of_age_soon";
/// `user_notifications.kind` of the advance notice for an open request.
pub const LEAD_SOON_NOTIFICATION_KIND: &str = "lead_coming_of_age_soon";
/// Audit action that marks the patient's advance notice as sent: once per person.
pub const SOON_NOTIFIED_ACTION: &str = "notify_patient_coming_of_age_soon";
/// Audit action that marks the request's advance notice as sent.
pub const LEAD_SOON_NOTIFIED_ACTION: &str = "notify_lead_coming_of_age_soon";
/// Realtime event to staff with the advance notice of a patient.
pub const SOON_EVENT: &str = "patient.coming_of_age_soon";
/// Realtime event to staff with the advance notice of an open request.
pub const LEAD_SOON_EVENT: &str = "lead.coming_of_age_soon";

/// Runs the job for the German calendar day `today`.
pub async fn run_on(state: &AppState, today: NaiveDate) -> Result<ComingOfAgeReport, sqlx::Error> {
    let candidates: Vec<Uuid> = sqlx::query_scalar(CANDIDATES_SQL)
        .bind(today)
        .fetch_all(&state.db)
        .await?;
    let mut report = ComingOfAgeReport::default();
    for patient_id in candidates {
        let outcome = match process_patient(state, patient_id, today).await {
            Ok(outcome) => outcome,
            Err(error) => {
                // One patient's failure never blocks the others; the next
                // run picks it up again.
                tracing::warn!(%error, %patient_id, "end parents' access at 18");
                continue;
            }
        };
        if outcome.assignments_revoked + outcome.lead_accesses_revoked > 0 {
            report.patients += 1;
        }
        report.assignments_revoked += outcome.assignments_revoked;
        report.lead_accesses_revoked += outcome.lead_accesses_revoked;
        report.logins_deactivated += outcome.logins_deactivated;
        report.notifications += outcome.notifications.len();
        for (notification_id, user_id) in outcome.notifications {
            crate::realtime::publish_notification_event(
                state,
                user_id,
                "notification.created",
                Some(notification_id),
                json!({ "entity_type": "patient", "entity_id": patient_id }),
            )
            .await;
        }
        if outcome.assignments_revoked + outcome.lead_accesses_revoked > 0 {
            // The patient's staff: an open card reloads the access list.
            crate::realtime::publish_patient_event(
                state,
                None,
                CAME_OF_AGE_EVENT,
                patient_id,
                json!({
                    "reason": REVOKE_REASON,
                    "assignments_revoked": outcome.assignments_revoked,
                    "lead_accesses_revoked": outcome.lead_accesses_revoked,
                }),
            )
            .await;
        }
        publish_ended_lead_accesses(state, outcome.ended_lead_accesses).await;
    }

    let leads: Vec<Uuid> = sqlx::query_scalar(&format!(
        r#"SELECT l.id FROM leads l
           WHERE l.date_of_birth IS NOT NULL
             AND l.date_of_birth <= ($1::date - INTERVAL '18 years')::date
             AND {PORTAL_LEAD_SQL}
             AND EXISTS (SELECT 1 FROM lead_portal_access a
                         WHERE a.lead_id = l.id AND a.kind = 'guardian'
                           AND a.revoked_at IS NULL)
           ORDER BY l.id"#,
        PORTAL_LEAD_SQL = crate::routes::lead_portal_intake::PORTAL_LEAD_SQL,
    ))
    .bind(today)
    .fetch_all(&state.db)
    .await?;
    for lead_id in leads {
        let outcome = match process_lead(state, lead_id, today).await {
            Ok(outcome) => outcome,
            Err(error) => {
                tracing::warn!(%error, %lead_id, "end parents' request access at 18");
                continue;
            }
        };
        if outcome.lead_accesses_revoked > 0 {
            report.leads += 1;
        }
        report.lead_accesses_revoked += outcome.lead_accesses_revoked;
        report.notifications += outcome.notifications.len();
        for (notification_id, user_id) in outcome.notifications {
            crate::realtime::publish_notification_event(
                state,
                user_id,
                "notification.created",
                Some(notification_id),
                json!({ "entity_type": "lead", "entity_id": lead_id }),
            )
            .await;
        }
        if outcome.lead_accesses_revoked > 0 {
            crate::realtime::publish_lead_event(
                state,
                None,
                "lead.portal_updated",
                lead_id,
                json!({ "change": "guardian_access_revoked", "reason": REVOKE_REASON }),
            )
            .await;
            crate::realtime::publish_lead_event(
                state,
                None,
                LEAD_CAME_OF_AGE_EVENT,
                lead_id,
                json!({
                    "reason": REVOKE_REASON,
                    "lead_accesses_revoked": outcome.lead_accesses_revoked,
                }),
            )
            .await;
        }
        publish_ended_lead_accesses(state, outcome.ended_lead_accesses).await;
    }
    Ok(report)
}

/// The parents' open cabinets of the requests whose access just ended: one
/// event per request, to the logins named (their access no longer lets the
/// usual `lead.portal_updated` through). The cabinet reloads its list and
/// shows that the access ended because the person is of age.
async fn publish_ended_lead_accesses(state: &AppState, ended: Vec<(Uuid, Uuid)>) {
    let mut by_lead: std::collections::BTreeMap<Uuid, Vec<Uuid>> = Default::default();
    for (lead_id, user_id) in ended {
        by_lead.entry(lead_id).or_default().push(user_id);
    }
    for (lead_id, users) in by_lead {
        crate::realtime::publish_lead_portal_access_ended(state, lead_id, users, REVOKE_REASON)
            .await;
    }
}

/// A request that was not converted when the person turned 18 (owner
/// decision 2026-10-23): the parents' guardian accesses end (`revoked_by`
/// NULL, `revoked_reason` [`REVOKE_REASON`]), each audited, and staff are
/// told once to issue the now adult lead's own login
/// ([`LEAD_NOTIFICATION_KIND`]). The parents' logins stay active: their
/// cabinet says that the access ended because the person is of age
/// (`guardian_access_ended` of `GET /me/lead-requests`).
async fn process_lead(
    state: &AppState,
    lead_id: Uuid,
    today: NaiveDate,
) -> Result<PatientOutcome, sqlx::Error> {
    let mut tx = state.db.begin().await?;
    // Serialises with the cabinet and staff, and re-checks under the lock (a
    // corrected date of birth or a conversion meanwhile wins).
    let adult: Option<bool> = sqlx::query_scalar(&format!(
        r#"SELECT l.date_of_birth IS NOT NULL
                  AND l.date_of_birth <= ($2::date - INTERVAL '18 years')::date
                  AND {PORTAL_LEAD_SQL}
           FROM leads l WHERE l.id = $1 FOR UPDATE"#,
        PORTAL_LEAD_SQL = crate::routes::lead_portal_intake::PORTAL_LEAD_SQL,
    ))
    .bind(lead_id)
    .bind(today)
    .fetch_optional(&mut *tx)
    .await?;
    if adult != Some(true) {
        tx.rollback().await?;
        return Ok(PatientOutcome::default());
    }
    let revoked = sqlx::query(
        r#"UPDATE lead_portal_access
           SET revoked_at = now(), revoked_by = NULL, revoked_reason = $2
           WHERE lead_id = $1 AND kind = 'guardian' AND revoked_at IS NULL
           RETURNING id, user_id"#,
    )
    .bind(lead_id)
    .bind(REVOKE_REASON)
    .fetch_all(&mut *tx)
    .await?;
    if revoked.is_empty() {
        tx.rollback().await?;
        return Ok(PatientOutcome::default());
    }
    let mut outcome = PatientOutcome {
        lead_accesses_revoked: revoked.len(),
        ended_lead_accesses: revoked
            .iter()
            .map(|row| {
                row.try_get::<Uuid, _>("user_id")
                    .map(|user| (lead_id, user))
            })
            .collect::<Result<_, _>>()?,
        ..PatientOutcome::default()
    };
    for row in &revoked {
        audit::write_in_transaction(
            &mut tx,
            &audit::domain_event(
                "revoke_lead_guardian_access",
                None,
                "lead",
                Some(lead_id),
                json!({
                    "access_id": row.try_get::<Uuid, _>("id")?,
                    "portal_user_id": row.try_get::<Uuid, _>("user_id")?,
                    "reason": REVOKE_REASON,
                    "as_of": today.to_string(),
                    "login_deactivated": false,
                }),
            ),
        )
        .await?;
    }

    // The staff notice, once per request.
    let notified: bool = sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM audit_log
                        WHERE action = $2 AND entity_type = 'lead' AND entity_id = $1)",
    )
    .bind(lead_id)
    .bind(LEAD_NOTIFIED_ACTION)
    .fetch_one(&mut *tx)
    .await?;
    if !notified {
        let recipients: Vec<Uuid> =
            sqlx::query_scalar(crate::routes::lead_portal_intake::LEAD_NOTIFICATION_RECIPIENTS_SQL)
                .bind(lead_id)
                .fetch_all(&mut *tx)
                .await?;
        for recipient in &recipients {
            let notification_id: Uuid = sqlx::query_scalar(
                r#"INSERT INTO user_notifications (user_id, kind, title, body, entity_type, entity_id)
                   VALUES ($1, $2, $3, $4, 'lead', $5)
                   RETURNING id"#,
            )
            .bind(recipient)
            .bind(LEAD_NOTIFICATION_KIND)
            .bind("Lead is 18: issue the lead's own login")
            .bind(
                "The parents' access to the request ended on the 18th birthday. \
                 Issue the lead's own login in the leads table.",
            )
            .bind(lead_id)
            .fetch_one(&mut *tx)
            .await?;
            outcome.notifications.push((notification_id, *recipient));
        }
        audit::write_in_transaction(
            &mut tx,
            &audit::domain_event(
                LEAD_NOTIFIED_ACTION,
                None,
                "lead",
                Some(lead_id),
                json!({ "recipients": recipients, "as_of": today.to_string() }),
            ),
        )
        .await?;
    }

    tx.commit().await?;
    Ok(outcome)
}

/// Runs the job for today in Germany.
pub async fn run(state: &AppState) -> Result<ComingOfAgeReport, sqlx::Error> {
    run_on(state, crate::app_time::today()).await
}

/// What one run of the advance notice did.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct AdvanceNoticeReport {
    /// Patients whose staff were told in this run.
    pub patients: usize,
    /// Open requests whose staff were told in this run.
    pub leads: usize,
    /// Staff notifications stored.
    pub notifications: usize,
}

/// Minor patients who turn 18 within the window (`$1` today, `$2` days),
/// whose parents still have access, not told yet ([`SOON_NOTIFIED_ACTION`],
/// `$3`), and whose converted request was not told either
/// ([`LEAD_SOON_NOTIFIED_ACTION`], `$4`): one notice per person.
const SOON_CANDIDATES_SQL: &str = r#"
    SELECT p.id FROM patients p
    WHERE p.birth_date IS NOT NULL
      AND (p.birth_date + INTERVAL '18 years')::date > $1::date
      AND (p.birth_date + INTERVAL '18 years')::date <= $1::date + $2::int
      AND (
          EXISTS (SELECT 1 FROM patient_assignments pa
                  WHERE pa.patient_id = p.id AND pa.source = 'lead_guardian'
                    AND pa.revoked_at IS NULL)
          OR EXISTS (SELECT 1 FROM leads l
                     JOIN lead_portal_access a ON a.lead_id = l.id
                     WHERE l.converted_patient_id = p.id AND a.kind = 'guardian'
                       AND a.revoked_at IS NULL)
      )
      AND NOT EXISTS (SELECT 1 FROM audit_log
                      WHERE action = $3 AND entity_type = 'patient' AND entity_id = p.id)
      AND NOT EXISTS (SELECT 1 FROM audit_log al
                      JOIN leads l ON l.id = al.entity_id
                      WHERE al.action = $4 AND al.entity_type = 'lead'
                        AND l.converted_patient_id = p.id)
    ORDER BY p.id"#;

/// Tells staff [`ADVANCE_NOTICE_DAYS`] before the 18th birthday of a minor
/// patient or open request whose parents have access (owner request
/// 2026-10-26): the parents' access ends on that day and the person needs an
/// own login. Once per person (an audit marker in the notice's
/// transaction); a patient whose request was told already is not told
/// again. Each person in its own transaction; the realtime events go out
/// after the commit.
pub async fn run_advance_notices_on(
    state: &AppState,
    today: NaiveDate,
) -> Result<AdvanceNoticeReport, sqlx::Error> {
    let mut report = AdvanceNoticeReport::default();
    let patients: Vec<Uuid> = sqlx::query_scalar(SOON_CANDIDATES_SQL)
        .bind(today)
        .bind(ADVANCE_NOTICE_DAYS)
        .bind(SOON_NOTIFIED_ACTION)
        .bind(LEAD_SOON_NOTIFIED_ACTION)
        .fetch_all(&state.db)
        .await?;
    for patient_id in patients {
        let notice = match advance_notice_patient(state, patient_id, today).await {
            Ok(Some(notice)) => notice,
            Ok(None) => continue,
            Err(error) => {
                tracing::warn!(%error, %patient_id, "advance notice before 18");
                continue;
            }
        };
        report.patients += 1;
        report.notifications += notice.notifications.len();
        publish_advance_notice(state, "patient", patient_id, &notice).await;
    }

    let leads: Vec<Uuid> = sqlx::query_scalar(&format!(
        r#"SELECT l.id FROM leads l
           WHERE l.date_of_birth IS NOT NULL
             AND (l.date_of_birth + INTERVAL '18 years')::date > $1::date
             AND (l.date_of_birth + INTERVAL '18 years')::date <= $1::date + $2::int
             AND {PORTAL_LEAD_SQL}
             AND EXISTS (SELECT 1 FROM lead_portal_access a
                         WHERE a.lead_id = l.id AND a.kind = 'guardian'
                           AND a.revoked_at IS NULL)
             AND NOT EXISTS (SELECT 1 FROM audit_log
                             WHERE action = $3 AND entity_type = 'lead' AND entity_id = l.id)
           ORDER BY l.id"#,
        PORTAL_LEAD_SQL = crate::routes::lead_portal_intake::PORTAL_LEAD_SQL,
    ))
    .bind(today)
    .bind(ADVANCE_NOTICE_DAYS)
    .bind(LEAD_SOON_NOTIFIED_ACTION)
    .fetch_all(&state.db)
    .await?;
    for lead_id in leads {
        let notice = match advance_notice_lead(state, lead_id, today).await {
            Ok(Some(notice)) => notice,
            Ok(None) => continue,
            Err(error) => {
                tracing::warn!(%error, %lead_id, "advance notice before 18 (request)");
                continue;
            }
        };
        report.leads += 1;
        report.notifications += notice.notifications.len();
        publish_advance_notice(state, "lead", lead_id, &notice).await;
    }
    Ok(report)
}

/// Runs the advance notice for today in Germany.
pub async fn run_advance_notices(state: &AppState) -> Result<AdvanceNoticeReport, sqlx::Error> {
    run_advance_notices_on(state, crate::app_time::today()).await
}

/// One advance notice that was stored: `(notification, recipient)` and the day.
struct AdvanceNotice {
    notifications: Vec<(Uuid, Uuid)>,
    turns_18_on: NaiveDate,
    days_left: i64,
}

async fn publish_advance_notice(
    state: &AppState,
    entity_type: &str,
    entity_id: Uuid,
    notice: &AdvanceNotice,
) {
    for (notification_id, user_id) in &notice.notifications {
        crate::realtime::publish_notification_event(
            state,
            *user_id,
            "notification.created",
            Some(*notification_id),
            json!({ "entity_type": entity_type, "entity_id": entity_id }),
        )
        .await;
    }
    let payload = json!({
        "turns_18_on": notice.turns_18_on.to_string(),
        "days_left": notice.days_left,
    });
    if entity_type == "patient" {
        crate::realtime::publish_patient_event(state, None, SOON_EVENT, entity_id, payload).await;
    } else {
        crate::realtime::publish_lead_event(state, None, LEAD_SOON_EVENT, entity_id, payload).await;
    }
}

/// The 18th birthday of `birth` and the days until it from `today`, when it
/// lies within the advance window (tomorrow up to [`ADVANCE_NOTICE_DAYS`]).
fn eighteenth_birthday_within_window(
    birth: NaiveDate,
    today: NaiveDate,
) -> Option<(NaiveDate, i64)> {
    // The day the birthday job ends the access (`birth <= day - 18 years`):
    // a child born on 29 February turns 18 on 1 March of a common year.
    let year = birth.year() + 18;
    let birthday = birth
        .with_year(year)
        .or_else(|| NaiveDate::from_ymd_opt(year, 3, 1))?;
    let days_left = (birthday - today).num_days();
    (days_left > 0 && days_left <= i64::from(ADVANCE_NOTICE_DAYS)).then_some((birthday, days_left))
}

async fn advance_notice_patient(
    state: &AppState,
    patient_id: Uuid,
    today: NaiveDate,
) -> Result<Option<AdvanceNotice>, sqlx::Error> {
    let mut tx = state.db.begin().await?;
    // Serialises with the birthday job and a second instance; re-checks the
    // date of birth, the marker and the patient's own login under the lock.
    let row = sqlx::query(
        r#"SELECT p.birth_date, p.patient_id AS code,
                  btrim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')) AS name,
                  EXISTS (SELECT 1 FROM audit_log
                          WHERE action = $2 AND entity_type = 'patient' AND entity_id = p.id)
                  OR EXISTS (SELECT 1 FROM audit_log al JOIN leads l ON l.id = al.entity_id
                             WHERE al.action = $3 AND al.entity_type = 'lead'
                               AND l.converted_patient_id = p.id) AS told,
                  EXISTS (SELECT 1 FROM patient_assignments pa
                          JOIN users u ON u.id = pa.user_id AND u.role = 'patient' AND u.is_active
                          WHERE pa.patient_id = p.id AND pa.revoked_at IS NULL
                            AND pa.source <> 'lead_guardian') AS own_login
           FROM patients p WHERE p.id = $1 FOR UPDATE"#,
    )
    .bind(patient_id)
    .bind(SOON_NOTIFIED_ACTION)
    .bind(LEAD_SOON_NOTIFIED_ACTION)
    .fetch_optional(&mut *tx)
    .await?;
    let Some(row) = row else {
        return Ok(None);
    };
    let window = row
        .try_get::<Option<NaiveDate>, _>("birth_date")?
        .and_then(|birth| eighteenth_birthday_within_window(birth, today));
    // A patient with an own login needs none issued: the birthday notice
    // skips such a patient too.
    let (Some((turns_18_on, days_left)), false, false) = (
        window,
        row.try_get::<bool, _>("told")?,
        row.try_get::<bool, _>("own_login")?,
    ) else {
        tx.rollback().await?;
        return Ok(None);
    };
    let code: Option<String> = row.try_get("code")?;
    let name: String = row.try_get("name")?;
    let label = match code.filter(|code| !code.trim().is_empty()) {
        Some(code) if !name.is_empty() => format!("{code} · {name}"),
        Some(code) => code,
        None => name,
    };
    let recipients: Vec<Uuid> = sqlx::query_scalar(RECIPIENTS_SQL)
        .bind(patient_id)
        .fetch_all(&mut *tx)
        .await?;
    let mut notifications = Vec::with_capacity(recipients.len());
    for recipient in &recipients {
        let notification_id: Uuid = sqlx::query_scalar(
            r#"INSERT INTO user_notifications
                   (user_id, kind, title, body, entity_type, entity_id, params)
               VALUES ($1, $2, $3, $4, 'patient', $5, $6)
               RETURNING id"#,
        )
        .bind(recipient)
        .bind(SOON_NOTIFICATION_KIND)
        .bind(format!("Patient {label} turns 18 in {days_left} days"))
        .bind(format!(
            "On {turns_18_on} the parents' access ends; the patient needs an own login."
        ))
        .bind(patient_id)
        .bind(json!({
            "patient_label": label,
            "turns_18_on": turns_18_on.to_string(),
            "days_left": days_left,
        }))
        .fetch_one(&mut *tx)
        .await?;
        notifications.push((notification_id, *recipient));
    }
    audit::write_in_transaction(
        &mut tx,
        &audit::domain_event(
            SOON_NOTIFIED_ACTION,
            None,
            "patient",
            Some(patient_id),
            json!({
                "recipients": recipients,
                "turns_18_on": turns_18_on.to_string(),
                "as_of": today.to_string(),
            }),
        ),
    )
    .await?;
    tx.commit().await?;
    Ok(Some(AdvanceNotice {
        notifications,
        turns_18_on,
        days_left,
    }))
}

async fn advance_notice_lead(
    state: &AppState,
    lead_id: Uuid,
    today: NaiveDate,
) -> Result<Option<AdvanceNotice>, sqlx::Error> {
    let mut tx = state.db.begin().await?;
    let row = sqlx::query(&format!(
        r#"SELECT l.date_of_birth,
                  btrim(coalesce(l.first_name, '') || ' ' || coalesce(l.last_name, '')) AS name,
                  ({PORTAL_LEAD_SQL}
                   AND EXISTS (SELECT 1 FROM lead_portal_access a
                               WHERE a.lead_id = l.id AND a.kind = 'guardian'
                                 AND a.revoked_at IS NULL)
                   AND NOT EXISTS (SELECT 1 FROM audit_log
                                   WHERE action = $2 AND entity_type = 'lead'
                                     AND entity_id = l.id)) AS due
           FROM leads l WHERE l.id = $1 FOR UPDATE"#,
        PORTAL_LEAD_SQL = crate::routes::lead_portal_intake::PORTAL_LEAD_SQL,
    ))
    .bind(lead_id)
    .bind(LEAD_SOON_NOTIFIED_ACTION)
    .fetch_optional(&mut *tx)
    .await?;
    let Some(row) = row else {
        return Ok(None);
    };
    let window = row
        .try_get::<Option<NaiveDate>, _>("date_of_birth")?
        .and_then(|birth| eighteenth_birthday_within_window(birth, today));
    let (Some((turns_18_on, days_left)), true) = (window, row.try_get::<bool, _>("due")?) else {
        tx.rollback().await?;
        return Ok(None);
    };
    let name: String = row.try_get("name")?;
    let recipients: Vec<Uuid> =
        sqlx::query_scalar(crate::routes::lead_portal_intake::LEAD_NOTIFICATION_RECIPIENTS_SQL)
            .bind(lead_id)
            .fetch_all(&mut *tx)
            .await?;
    let mut notifications = Vec::with_capacity(recipients.len());
    for recipient in &recipients {
        let notification_id: Uuid = sqlx::query_scalar(
            r#"INSERT INTO user_notifications
                   (user_id, kind, title, body, entity_type, entity_id, params)
               VALUES ($1, $2, $3, $4, 'lead', $5, $6)
               RETURNING id"#,
        )
        .bind(recipient)
        .bind(LEAD_SOON_NOTIFICATION_KIND)
        .bind(format!("Lead {name} turns 18 in {days_left} days"))
        .bind(format!(
            "On {turns_18_on} the parents' access to the request ends; the lead needs an own login."
        ))
        .bind(lead_id)
        .bind(json!({
            "lead_name": name,
            "turns_18_on": turns_18_on.to_string(),
            "days_left": days_left,
        }))
        .fetch_one(&mut *tx)
        .await?;
        notifications.push((notification_id, *recipient));
    }
    audit::write_in_transaction(
        &mut tx,
        &audit::domain_event(
            LEAD_SOON_NOTIFIED_ACTION,
            None,
            "lead",
            Some(lead_id),
            json!({
                "recipients": recipients,
                "turns_18_on": turns_18_on.to_string(),
                "as_of": today.to_string(),
            }),
        ),
    )
    .await?;
    tx.commit().await?;
    Ok(Some(AdvanceNotice {
        notifications,
        turns_18_on,
        days_left,
    }))
}

async fn process_patient(
    state: &AppState,
    patient_id: Uuid,
    today: NaiveDate,
) -> Result<PatientOutcome, sqlx::Error> {
    let mut tx = state.db.begin().await?;
    // Serialises with a conversion or a staff change of the same record, and
    // re-checks the age under the lock (a corrected birth date wins).
    let adult: Option<bool> = sqlx::query_scalar(
        "SELECT birth_date IS NOT NULL AND birth_date <= ($2::date - INTERVAL '18 years')::date
         FROM patients WHERE id = $1 FOR UPDATE",
    )
    .bind(patient_id)
    .bind(today)
    .fetch_optional(&mut *tx)
    .await?;
    if adult != Some(true) {
        tx.rollback().await?;
        return Ok(PatientOutcome::default());
    }

    let revoked_assignments = sqlx::query(
        r#"UPDATE patient_assignments
           SET revoked_at = now(), revoked_by = NULL, manually_revoked_at = NULL,
               revoked_reason = $2
           WHERE patient_id = $1 AND source = 'lead_guardian' AND revoked_at IS NULL
           RETURNING id, user_id"#,
    )
    .bind(patient_id)
    .bind(REVOKE_REASON)
    .fetch_all(&mut *tx)
    .await?;
    let revoked_accesses = sqlx::query(
        r#"UPDATE lead_portal_access a
           SET revoked_at = now(), revoked_by = NULL, revoked_reason = $2
           FROM leads l
           WHERE l.id = a.lead_id AND l.converted_patient_id = $1
             AND a.kind = 'guardian' AND a.revoked_at IS NULL
           RETURNING a.id, a.lead_id, a.user_id"#,
    )
    .bind(patient_id)
    .bind(REVOKE_REASON)
    .fetch_all(&mut *tx)
    .await?;
    if revoked_assignments.is_empty() && revoked_accesses.is_empty() {
        tx.rollback().await?;
        return Ok(PatientOutcome::default());
    }

    let mut outcome = PatientOutcome {
        assignments_revoked: revoked_assignments.len(),
        lead_accesses_revoked: revoked_accesses.len(),
        ended_lead_accesses: revoked_accesses
            .iter()
            .map(|row| Ok((row.try_get::<Uuid, _>("lead_id")?, row.try_get("user_id")?)))
            .collect::<Result<_, sqlx::Error>>()?,
        ..PatientOutcome::default()
    };

    // Each parent once: the login stays when it still reaches anything.
    let mut parents: Vec<Uuid> = revoked_assignments
        .iter()
        .chain(revoked_accesses.iter())
        .map(|row| row.try_get::<Uuid, _>("user_id"))
        .collect::<Result<_, _>>()?;
    parents.sort();
    parents.dedup();
    let mut deactivated: Vec<Uuid> = Vec::new();
    for user_id in &parents {
        // `Uuid::nil()` names no lead: every other link counts.
        let keeps_access = crate::routes::lead_portal_guardians::has_other_active_links(
            &mut tx,
            *user_id,
            Uuid::nil(),
        )
        .await?;
        if keeps_access {
            continue;
        }
        let switched = sqlx::query(
            "UPDATE users SET is_active = false, updated_at = now()
             WHERE id = $1 AND role = 'patient' AND is_active",
        )
        .bind(user_id)
        .execute(&mut *tx)
        .await?
        .rows_affected();
        sqlx::query(
            "UPDATE token_families SET is_revoked = true, revoked_reason = $2
             WHERE user_id = $1 AND NOT is_revoked",
        )
        .bind(user_id)
        .bind(REVOKE_REASON)
        .execute(&mut *tx)
        .await?;
        sqlx::query(
            "UPDATE pending_logins SET status = 'rejected', resolved_at = now()
             WHERE user_id = $1 AND status IN ('pending', 'approved')",
        )
        .bind(user_id)
        .execute(&mut *tx)
        .await?;
        if switched > 0 {
            deactivated.push(*user_id);
        }
    }
    outcome.logins_deactivated = deactivated.len();

    for row in &revoked_assignments {
        let user_id: Uuid = row.try_get("user_id")?;
        audit::write_in_transaction(
            &mut tx,
            &audit::domain_event(
                "revoke_guardian_patient_access",
                None,
                "patient",
                Some(patient_id),
                json!({
                    "assignment_id": row.try_get::<Uuid, _>("id")?,
                    "user_id": user_id,
                    "source": "lead_guardian",
                    "reason": REVOKE_REASON,
                    "as_of": today.to_string(),
                    "login_deactivated": deactivated.contains(&user_id),
                }),
            ),
        )
        .await?;
    }
    for row in &revoked_accesses {
        let user_id: Uuid = row.try_get("user_id")?;
        audit::write_in_transaction(
            &mut tx,
            &audit::domain_event(
                "revoke_lead_guardian_access",
                None,
                "lead",
                Some(row.try_get::<Uuid, _>("lead_id")?),
                json!({
                    "access_id": row.try_get::<Uuid, _>("id")?,
                    "portal_user_id": user_id,
                    "patient_id": patient_id,
                    "reason": REVOKE_REASON,
                    "as_of": today.to_string(),
                    "login_deactivated": deactivated.contains(&user_id),
                }),
            ),
        )
        .await?;
    }

    // The staff notice, once per patient, while the patient has no own login.
    let needs_notice: bool = sqlx::query_scalar(
        r#"SELECT NOT EXISTS (
                   SELECT 1 FROM patient_assignments pa
                   JOIN users u ON u.id = pa.user_id AND u.role = 'patient' AND u.is_active
                   WHERE pa.patient_id = $1 AND pa.revoked_at IS NULL
                     AND pa.source <> 'lead_guardian'
               )
               AND NOT EXISTS (
                   SELECT 1 FROM audit_log
                   WHERE action = $2 AND entity_type = 'patient' AND entity_id = $1
               )"#,
    )
    .bind(patient_id)
    .bind(NOTIFIED_ACTION)
    .fetch_one(&mut *tx)
    .await?;
    if needs_notice {
        let recipients: Vec<Uuid> = sqlx::query_scalar(RECIPIENTS_SQL)
            .bind(patient_id)
            .fetch_all(&mut *tx)
            .await?;
        for recipient in &recipients {
            let notification_id: Uuid = sqlx::query_scalar(
                r#"INSERT INTO user_notifications (user_id, kind, title, body, entity_type, entity_id)
                   VALUES ($1, $2, $3, $4, 'patient', $5)
                   RETURNING id"#,
            )
            .bind(recipient)
            .bind(NOTIFICATION_KIND)
            .bind("Patient is 18: issue the patient's own login")
            .bind(
                "The parents' access to the patient record ended on the 18th birthday. \
                 Issue the patient's own login in the patients table.",
            )
            .bind(patient_id)
            .fetch_one(&mut *tx)
            .await?;
            outcome.notifications.push((notification_id, *recipient));
        }
        audit::write_in_transaction(
            &mut tx,
            &audit::domain_event(
                NOTIFIED_ACTION,
                None,
                "patient",
                Some(patient_id),
                json!({ "recipients": recipients, "as_of": today.to_string() }),
            ),
        )
        .await?;
    }

    tx.commit().await?;
    Ok(outcome)
}

/// Checks every hour and runs once per German day, so the parents' access
/// ends within the first hour of the 18th birthday. Several instances or a
/// restart are harmless: each patient is locked and a second run finds
/// nothing to do.
pub fn spawn_scheduler(state: AppState) {
    tokio::spawn(async move {
        let mut ticker = tokio::time::interval(std::time::Duration::from_secs(3_600));
        let mut last_run: Option<NaiveDate> = None;
        loop {
            ticker.tick().await;
            let today = crate::app_time::today();
            if last_run == Some(today) {
                continue;
            }
            match run_on(&state, today).await {
                Ok(report) => {
                    last_run = Some(today);
                    if report != ComingOfAgeReport::default() {
                        tracing::info!(
                            patients = report.patients,
                            assignments_revoked = report.assignments_revoked,
                            lead_accesses_revoked = report.lead_accesses_revoked,
                            logins_deactivated = report.logins_deactivated,
                            notifications = report.notifications,
                            leads = report.leads,
                            "Parents' access of patients who turned 18 ended"
                        );
                    }
                }
                Err(error) => tracing::warn!(%error, "Coming-of-age sweep failed"),
            }
            // The advance notice, once per day with the job above. It is once
            // per person and covers the whole window, so a failed run is
            // caught up the next day.
            match run_advance_notices_on(&state, today).await {
                Ok(report) if report != AdvanceNoticeReport::default() => tracing::info!(
                    patients = report.patients,
                    leads = report.leads,
                    notifications = report.notifications,
                    "Staff told of an 18th birthday within {ADVANCE_NOTICE_DAYS} days"
                ),
                Ok(_) => {}
                Err(error) => tracing::warn!(%error, "Coming-of-age advance notice failed"),
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn day(text: &str) -> NaiveDate {
        NaiveDate::parse_from_str(text, "%Y-%m-%d").unwrap()
    }

    #[test]
    fn the_advance_window_runs_from_tomorrow_to_thirty_days_ahead() {
        let today = day("2026-10-26");
        assert_eq!(
            eighteenth_birthday_within_window(day("2008-11-25"), today),
            Some((day("2026-11-25"), 30))
        );
        assert_eq!(
            eighteenth_birthday_within_window(day("2008-10-27"), today),
            Some((day("2026-10-27"), 1))
        );
        // Further away, today (the birthday job's day) or already of age.
        assert_eq!(
            eighteenth_birthday_within_window(day("2008-11-26"), today),
            None
        );
        assert_eq!(
            eighteenth_birthday_within_window(day("2008-10-26"), today),
            None
        );
        assert_eq!(
            eighteenth_birthday_within_window(day("2000-01-01"), today),
            None
        );
    }

    #[test]
    fn a_leap_day_child_turns_eighteen_on_the_first_of_march() {
        // As the birthday job decides: `birth <= day - 18 years`.
        assert_eq!(
            eighteenth_birthday_within_window(day("2012-02-29"), day("2030-02-01")),
            Some((day("2030-03-01"), 28))
        );
    }
}
