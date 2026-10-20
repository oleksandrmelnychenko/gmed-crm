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
//! An access staff granted explicitly (any other `source`) is never touched.
//! Released documents keep their shares as history; the portal shows a
//! patient's documents only through an active assignment
//! ([`crate::routes::me::resolve_linked_patient_id`]), so the parents no
//! longer see them. Every change is audited in its transaction, each patient
//! in its own; a second run finds nothing to do.

use chrono::NaiveDate;
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
}

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
}

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
    }
    Ok(report)
}

/// Runs the job for today in Germany.
pub async fn run(state: &AppState) -> Result<ComingOfAgeReport, sqlx::Error> {
    run_on(state, crate::app_time::today()).await
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
                            "Parents' access of patients who turned 18 ended"
                        );
                    }
                }
                Err(error) => tracing::warn!(%error, "Coming-of-age sweep failed"),
            }
        }
    });
}
