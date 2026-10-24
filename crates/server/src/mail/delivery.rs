//! Delivery status of sign-in e-mails (owner request 2026-10-05: staff see
//! whether the access e-mail arrived, bounced or was blocked).
//!
//! Mittaro documents `GET /v1/emails/{id}` for the status of an accepted
//! message; its signed webhooks have no public format yet, so the server
//! asks. Every minute the scheduler claims the messages that are due — the
//! first hour every minute, then every 15 minutes, after a day hourly, for
//! three days — and stores the status in `portal_login_emails` and, since
//! 2026-10-24, in `lead_payer_link_emails` (the payer's invitation and code).
//! A message stops being checked once it is delivered, bounced, failed,
//! suppressed or reported as spam, or when the provider does not know it.
//! The first problem state of a message (bounced, failed, suppressed,
//! complained) is audited and told once to the staff member who sent it
//! (for a payer's code: who sent the link), without the address.
//!
//! The provider's status words are only partly documented (`queued`,
//! `sent`); the mapping accepts the usual names for the states the Mittaro
//! dashboard shows and keeps the original word next to the result.

use std::time::Duration;

use serde_json::json;
use sqlx::Row;
use uuid::Uuid;

use super::connection::current_mailer;
use super::{MailError, PROVIDER_ID};
use crate::audit;
use crate::state::AppState;

const TICK: Duration = Duration::from_secs(60);
/// Messages checked per run.
const BATCH: i64 = 25;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DeliveryStatus {
    /// Waiting at the provider.
    Queued,
    /// Being handed to the receiving server.
    Sending,
    /// The receiving server accepted the message.
    Sent,
    Delivered,
    /// The receiving server asked to try later; the provider retries.
    Deferred,
    /// The receiving server refused the address for good.
    Bounced,
    Failed,
    /// The provider blocked the address after an earlier bounce or complaint.
    Suppressed,
    /// The recipient reported the message as spam.
    Complained,
    Unknown,
}

impl DeliveryStatus {
    pub fn from_provider(status: &str, smtp_code: Option<&str>) -> Self {
        let word = status.trim().to_ascii_lowercase().replace(['-', ' '], "_");
        match word.as_str() {
            "queued" | "pending" | "scheduled" | "accepted" => Self::Queued,
            "sending" | "processing" | "handing_over" => Self::Sending,
            "sent" | "handed_over" => Self::Sent,
            "delivered" => Self::Delivered,
            "deferred" | "delayed" | "soft_bounce" | "soft_bounced" | "retrying" => Self::Deferred,
            "bounced" | "bounce" | "hard_bounce" | "hard_bounced" | "undeliverable"
            | "rejected" => Self::Bounced,
            "failed" | "error" => Self::Failed,
            "suppressed" | "blocked" => Self::Suppressed,
            "complained" | "complaint" | "spam" | "spam_complaint" => Self::Complained,
            // An unknown word: the SMTP code still tells a refusal from a delay.
            _ => match smtp_code.and_then(|code| code.trim().chars().next()) {
                Some('5') => Self::Bounced,
                Some('4') => Self::Deferred,
                _ => Self::Unknown,
            },
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Queued => "queued",
            Self::Sending => "sending",
            Self::Sent => "sent",
            Self::Delivered => "delivered",
            Self::Deferred => "deferred",
            Self::Bounced => "bounced",
            Self::Failed => "failed",
            Self::Suppressed => "suppressed",
            Self::Complained => "complained",
            Self::Unknown => "unknown",
        }
    }

    /// Nothing more will change.
    pub fn is_final(self) -> bool {
        matches!(
            self,
            Self::Delivered | Self::Bounced | Self::Failed | Self::Suppressed | Self::Complained
        )
    }

    /// The person did not get the e-mail (or flagged it): access has to be
    /// passed on another way.
    pub fn is_problem(self) -> bool {
        matches!(
            self,
            Self::Bounced | Self::Failed | Self::Suppressed | Self::Complained
        )
    }
}

/// The logs whose messages are followed: the sign-in e-mails and the e-mails
/// of a payer's link (invitation and confirmation code, owner request
/// 2026-10-24). Both have the same delivery columns.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Log {
    Login,
    PayerLink,
}

impl Log {
    const ALL: [Self; 2] = [Self::Login, Self::PayerLink];

    fn table(self) -> &'static str {
        match self {
            Self::Login => "portal_login_emails",
            Self::PayerLink => "lead_payer_link_emails",
        }
    }

    /// Claims the messages that are due and marks them checked, so a second
    /// server instance takes other rows. `sender` is the staff member who
    /// sent the message: for a payer's code (requested by the payer) the one
    /// who sent the link.
    fn claim_sql(self) -> String {
        let (from, sender, subject, kind) = match self {
            Self::Login => (
                "portal_login_emails x",
                "x.sent_by",
                "x.lead_id, x.patient_id",
                "'login'::text",
            ),
            Self::PayerLink => (
                "lead_payer_link_emails x JOIN lead_payer_links k ON k.id = x.link_id",
                "COALESCE(x.sent_by, k.sent_by)",
                "x.lead_id, NULL::uuid AS patient_id",
                "x.kind",
            ),
        };
        let table = self.table();
        format!(
            r#"
    UPDATE {table} e
    SET delivery_checked_at = now()
    FROM (
        SELECT x.id, x.delivery_status AS previous, {sender} AS sender,
               {subject}, {kind} AS email_kind
        FROM {from}
        WHERE x.status = 'sent'
          AND x.provider_message_id IS NOT NULL
          AND NOT x.delivery_final
          AND x.created_at > now() - interval '3 days'
          AND (
              x.delivery_checked_at IS NULL
              OR x.delivery_checked_at < now() - CASE
                  WHEN x.created_at > now() - interval '1 hour' THEN interval '50 seconds'
                  WHEN x.created_at > now() - interval '1 day' THEN interval '15 minutes'
                  ELSE interval '1 hour'
              END
          )
        ORDER BY x.delivery_checked_at NULLS FIRST, x.created_at
        LIMIT $1
        FOR UPDATE OF x SKIP LOCKED
    ) due
    WHERE e.id = due.id
    RETURNING e.id, e.provider_message_id, due.previous, due.lead_id, due.patient_id,
              due.sender, due.email_kind"#
        )
    }

    fn update_sql(self) -> String {
        let table = self.table();
        format!(
            r#"UPDATE {table}
               SET delivery_status = $2,
                   provider_status = $3,
                   smtp_code = $4,
                   -- Mittaro reports `sent` once the receiving server took
                   -- the message and often never says more: a `sent` that
                   -- stayed unchanged for a day is final, so the message
                   -- leaves the queue instead of being asked about for the
                   -- whole three days (DEV audit 2026-10-23).
                   delivery_final = $5 OR COALESCE(
                       $2 = 'sent'
                       AND delivery_status = 'sent'
                       AND delivery_updated_at < now() - interval '24 hours',
                       false
                   ),
                   delivery_updated_at = CASE
                       WHEN delivery_status IS DISTINCT FROM $2 THEN now()
                       ELSE delivery_updated_at
                   END
               WHERE id = $1"#
        )
    }

    fn audit_action(self) -> &'static str {
        match self {
            Self::Login => "portal_login_email_undelivered",
            Self::PayerLink => "payer_link_email_undelivered",
        }
    }

    /// `user_notifications.kind` of the notice to the sender.
    fn notification_kind(self) -> &'static str {
        match self {
            Self::Login => LOGIN_UNDELIVERED_KIND,
            Self::PayerLink => PAYER_LINK_UNDELIVERED_KIND,
        }
    }
}

/// `user_notifications.kind`: a sign-in e-mail did not arrive.
pub const LOGIN_UNDELIVERED_KIND: &str = "login_email_undelivered";
/// `user_notifications.kind`: an e-mail of a payer's link did not arrive.
pub const PAYER_LINK_UNDELIVERED_KIND: &str = "payer_link_email_undelivered";

/// Who hears that a message did not arrive: the staff member who sent it
/// while that login is active; otherwise the lead's staff
/// ([`crate::routes::lead_portal_intake::LEAD_NOTIFICATION_RECIPIENTS_SQL`]),
/// or for a patient's login every CEO.
const UNDELIVERED_RECIPIENTS_SQL: &str = r#"
    WITH sender AS (
        SELECT id FROM users
        WHERE id = $2 AND is_active AND role <> 'patient'
    ), lead_staff AS (
        SELECT id FROM users
        WHERE $1::uuid IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sender)
          AND id IN (LEAD_RECIPIENTS)
    ), ceo AS (
        SELECT id FROM users
        WHERE $1::uuid IS NULL AND is_active AND role = 'ceo'
          AND NOT EXISTS (SELECT 1 FROM sender)
    )
    SELECT id FROM sender
    UNION SELECT id FROM lead_staff
    UNION SELECT id FROM ceo"#;

fn undelivered_recipients_sql() -> String {
    UNDELIVERED_RECIPIENTS_SQL.replace(
        "LEAD_RECIPIENTS",
        crate::routes::lead_portal_intake::LEAD_NOTIFICATION_RECIPIENTS_SQL,
    )
}

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct SyncOutcome {
    pub checked: usize,
    /// Messages whose status changed.
    pub changed: usize,
}

pub fn spawn_scheduler(state: AppState) {
    tokio::spawn(async move {
        let mut ticker = tokio::time::interval(TICK);
        ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        ticker.tick().await;
        loop {
            ticker.tick().await;
            let outcome = sync_due(&state).await;
            if outcome.changed > 0 {
                tracing::info!(
                    checked = outcome.checked,
                    changed = outcome.changed,
                    "e-mail delivery status"
                );
            }
        }
    });
}

/// Asks the provider about the messages that are due and stores the answers.
pub async fn sync_due(state: &AppState) -> SyncOutcome {
    let mut outcome = SyncOutcome::default();
    let Ok(mailer) = current_mailer(state).await else {
        return outcome;
    };
    if !mailer.capability().available {
        return outcome;
    }
    for log in Log::ALL {
        if !sync_log(state, &mailer, log, &mut outcome).await {
            break;
        }
    }
    outcome
}

/// One log; `false` when the provider cannot be asked right now.
async fn sync_log(
    state: &AppState,
    mailer: &super::Mailer,
    log: Log,
    outcome: &mut SyncOutcome,
) -> bool {
    let due = match sqlx::query(&log.claim_sql())
        .bind(BATCH)
        .fetch_all(&state.db)
        .await
    {
        Ok(rows) => rows,
        Err(error) => {
            tracing::warn!(%error, table = log.table(), "claim e-mails for a delivery check");
            return true;
        }
    };
    for row in due {
        let id: Uuid = row.get("id");
        let message_id: String = row.get("provider_message_id");
        let previous: Option<String> = row.get("previous");
        let (status, provider_status, smtp_code, final_) = match mailer.status(&message_id).await {
            Ok(found) => {
                let status =
                    DeliveryStatus::from_provider(&found.status, found.smtp_code.as_deref());
                (status, found.status, found.smtp_code, status.is_final())
            }
            // Sent with another account or purged at the provider: nothing to
            // learn any more.
            Err(MailError::NotFound) => (DeliveryStatus::Unknown, "not_found".into(), None, true),
            Err(error) => {
                // A key without read access, a quota or an outage: the claimed
                // rows are due again later.
                tracing::warn!(code = error.code(), "read e-mail delivery status");
                return false;
            }
        };
        outcome.checked += 1;
        if let Err(error) = sqlx::query(&log.update_sql())
            .bind(id)
            .bind(status.as_str())
            .bind(&provider_status)
            .bind(&smtp_code)
            .bind(final_)
            .execute(&state.db)
            .await
        {
            tracing::warn!(%error, %id, table = log.table(), "store e-mail delivery status");
            continue;
        }
        if previous.as_deref() == Some(status.as_str()) {
            continue;
        }
        outcome.changed += 1;
        // Told once per message: a later change between problem states
        // (bounced, then complained) adds nothing to do.
        let was_problem = previous
            .as_deref()
            .is_some_and(|word| DeliveryStatus::from_provider(word, None).is_problem());
        if status.is_problem() && !was_problem {
            let lead_id = row.get::<Option<Uuid>, _>("lead_id");
            let patient_id = row.get::<Option<Uuid>, _>("patient_id");
            let email_kind: String = row.get("email_kind");
            let (entity, entity_id) = match (lead_id, patient_id) {
                (Some(lead_id), _) => ("lead", lead_id),
                (None, Some(patient_id)) => ("patient", patient_id),
                (None, None) => continue,
            };
            state.audit_sender.try_send(audit::domain_event(
                log.audit_action(),
                None,
                entity,
                Some(entity_id),
                json!({
                    "provider": PROVIDER_ID,
                    "provider_message_id": message_id,
                    "delivery_status": status.as_str(),
                    "smtp_code": smtp_code,
                    "email": email_kind,
                }),
            ));
            notify_undelivered(
                state,
                log,
                entity,
                entity_id,
                lead_id,
                row.get::<Option<Uuid>, _>("sender"),
                &email_kind,
                status,
            )
            .await;
        }
    }
    true
}

/// The notice that a message did not arrive. It names neither the person nor
/// the address: the entity link leads to the lead or patient, the facts are
/// which e-mail it was and what the provider reported. Best effort.
#[allow(clippy::too_many_arguments)]
async fn notify_undelivered(
    state: &AppState,
    log: Log,
    entity: &str,
    entity_id: Uuid,
    lead_id: Option<Uuid>,
    sender: Option<Uuid>,
    email_kind: &str,
    status: DeliveryStatus,
) {
    let recipients: Vec<Uuid> = match sqlx::query_scalar(&undelivered_recipients_sql())
        .bind(lead_id)
        .bind(sender)
        .fetch_all(&state.db)
        .await
    {
        Ok(recipients) => recipients,
        Err(error) => {
            tracing::warn!(%error, %entity_id, "load recipients of an undelivered e-mail notice");
            return;
        }
    };
    let (title, body) = match log {
        Log::Login => (
            "Sign-in e-mail not delivered",
            "The e-mail with the sign-in data did not arrive. Check the address or pass the access on another way.",
        ),
        Log::PayerLink => (
            "E-mail to the payer not delivered",
            "The e-mail of the payer's link did not arrive. Check the payer's address and send the link again.",
        ),
    };
    let params = json!({ "email": email_kind, "delivery_status": status.as_str() });
    for recipient in recipients {
        let inserted: Result<Uuid, sqlx::Error> = sqlx::query_scalar(
            r#"INSERT INTO user_notifications (user_id, kind, title, body, entity_type, entity_id, params)
               VALUES ($1, $2, $3, $4, $5, $6, $7)
               RETURNING id"#,
        )
        .bind(recipient)
        .bind(log.notification_kind())
        .bind(title)
        .bind(body)
        .bind(entity)
        .bind(entity_id)
        .bind(&params)
        .fetch_one(&state.db)
        .await;
        match inserted {
            Ok(notification_id) => {
                crate::realtime::publish_notification_event(
                    state,
                    recipient,
                    "notification.created",
                    Some(notification_id),
                    json!({ "entity_type": entity, "entity_id": entity_id }),
                )
                .await;
            }
            Err(error) => {
                tracing::warn!(%error, %entity_id, "store undelivered e-mail notice");
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{DeliveryStatus, Log};

    #[test]
    fn both_logs_are_followed_with_their_own_notice() {
        for log in Log::ALL {
            let claim = log.claim_sql();
            assert!(claim.contains(log.table()), "{claim}");
            assert!(claim.contains("SKIP LOCKED"), "{claim}");
            assert!(log.update_sql().contains(log.table()));
        }
        assert_eq!(Log::Login.notification_kind(), "login_email_undelivered");
        assert_eq!(
            Log::PayerLink.notification_kind(),
            "payer_link_email_undelivered"
        );
        // The stored words map back to the same state, so a second problem
        // state of a message is recognised as already told.
        for status in [
            DeliveryStatus::Bounced,
            DeliveryStatus::Failed,
            DeliveryStatus::Suppressed,
            DeliveryStatus::Complained,
        ] {
            assert_eq!(DeliveryStatus::from_provider(status.as_str(), None), status);
        }
        assert!(super::undelivered_recipients_sql().contains("patient_manager"));
    }

    #[test]
    fn provider_words_map_to_delivery_states() {
        for (word, code, expected) in [
            ("queued", None, DeliveryStatus::Queued),
            ("Sent", Some("250"), DeliveryStatus::Sent),
            ("delivered", None, DeliveryStatus::Delivered),
            ("deferred", Some("451"), DeliveryStatus::Deferred),
            ("hard-bounce", None, DeliveryStatus::Bounced),
            ("bounced", Some("550"), DeliveryStatus::Bounced),
            ("suppressed", None, DeliveryStatus::Suppressed),
            ("complaint", None, DeliveryStatus::Complained),
            ("failed", None, DeliveryStatus::Failed),
            // Unknown words fall back to the SMTP code.
            ("rejected_by_policy", Some("554"), DeliveryStatus::Bounced),
            ("greylisted", Some("450"), DeliveryStatus::Deferred),
            ("whatever", None, DeliveryStatus::Unknown),
        ] {
            assert_eq!(
                DeliveryStatus::from_provider(word, code),
                expected,
                "{word}"
            );
        }
    }

    #[test]
    fn only_settled_states_stop_the_checks() {
        assert!(DeliveryStatus::Delivered.is_final());
        assert!(DeliveryStatus::Suppressed.is_final());
        assert!(!DeliveryStatus::Sent.is_final());
        assert!(!DeliveryStatus::Deferred.is_final());
        assert!(!DeliveryStatus::Unknown.is_final());
        assert!(DeliveryStatus::Complained.is_problem());
        assert!(!DeliveryStatus::Delivered.is_problem());
        assert!(!DeliveryStatus::Deferred.is_problem());
    }
}
