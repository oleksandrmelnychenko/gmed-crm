//! Delivery status of sign-in e-mails (owner request 2026-10-05: staff see
//! whether the access e-mail arrived, bounced or was blocked).
//!
//! Mittaro documents `GET /v1/emails/{id}` for the status of an accepted
//! message; its signed webhooks have no public format yet, so the server
//! asks. Every minute the scheduler claims the messages that are due — the
//! first hour every minute, then every 15 minutes, after a day hourly, for
//! three days — and stores the status in `portal_login_emails`. A message
//! stops being checked once it is delivered, bounced, failed, suppressed or
//! reported as spam, or when the provider does not know it.
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

/// Claims the messages that are due and marks them checked, so a second
/// server instance takes other rows.
const CLAIM_DUE_SQL: &str = r#"
    UPDATE portal_login_emails e
    SET delivery_checked_at = now()
    FROM (
        SELECT id, delivery_status AS previous
        FROM portal_login_emails
        WHERE status = 'sent'
          AND provider_message_id IS NOT NULL
          AND NOT delivery_final
          AND created_at > now() - interval '3 days'
          AND (
              delivery_checked_at IS NULL
              OR delivery_checked_at < now() - CASE
                  WHEN created_at > now() - interval '1 hour' THEN interval '50 seconds'
                  WHEN created_at > now() - interval '1 day' THEN interval '15 minutes'
                  ELSE interval '1 hour'
              END
          )
        ORDER BY delivery_checked_at NULLS FIRST, created_at
        LIMIT $1
        FOR UPDATE SKIP LOCKED
    ) due
    WHERE e.id = due.id
    RETURNING e.id, e.provider_message_id, due.previous, e.lead_id, e.patient_id"#;

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
                    "sign-in e-mail delivery status"
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
    let due = match sqlx::query(CLAIM_DUE_SQL)
        .bind(BATCH)
        .fetch_all(&state.db)
        .await
    {
        Ok(rows) => rows,
        Err(error) => {
            tracing::warn!(%error, "claim sign-in e-mails for a delivery check");
            return outcome;
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
                tracing::warn!(code = error.code(), "read sign-in e-mail delivery status");
                break;
            }
        };
        outcome.checked += 1;
        if let Err(error) = sqlx::query(
            r#"UPDATE portal_login_emails
               SET delivery_status = $2,
                   provider_status = $3,
                   smtp_code = $4,
                   delivery_final = $5,
                   delivery_updated_at = CASE
                       WHEN delivery_status IS DISTINCT FROM $2 THEN now()
                       ELSE delivery_updated_at
                   END
               WHERE id = $1"#,
        )
        .bind(id)
        .bind(status.as_str())
        .bind(&provider_status)
        .bind(&smtp_code)
        .bind(final_)
        .execute(&state.db)
        .await
        {
            tracing::warn!(%error, %id, "store sign-in e-mail delivery status");
            continue;
        }
        if previous.as_deref() == Some(status.as_str()) {
            continue;
        }
        outcome.changed += 1;
        if status.is_problem() {
            let (entity, entity_id) = match (
                row.get::<Option<Uuid>, _>("lead_id"),
                row.get::<Option<Uuid>, _>("patient_id"),
            ) {
                (Some(lead_id), _) => ("lead", Some(lead_id)),
                (None, patient_id) => ("patient", patient_id),
            };
            state.audit_sender.try_send(audit::domain_event(
                "portal_login_email_undelivered",
                None,
                entity,
                entity_id,
                json!({
                    "provider": PROVIDER_ID,
                    "provider_message_id": message_id,
                    "delivery_status": status.as_str(),
                    "smtp_code": smtp_code,
                }),
            ));
        }
    }
    outcome
}

#[cfg(test)]
mod tests {
    use super::DeliveryStatus;

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
