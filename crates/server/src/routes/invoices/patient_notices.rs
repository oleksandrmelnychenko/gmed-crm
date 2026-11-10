//! Notices to the patient's portal logins about their invoices (owner
//! 2026-11-10: the patient is told about every event that concerns them): an
//! invoice was issued, a payment was recorded on it, a credit note was issued
//! for it.
//!
//! The invoice's portal switches decide: a hidden invoice — or a credit note
//! not shown in the portal — notifies nobody, hidden amounts leave the amount
//! out of the text and of `params`. Title and text are stored in the
//! patient's language, the one the invoice itself is printed in
//! (`resolve_invoice_pdf_language`), so the portal shows them as they are;
//! `params` carries the facts and the notice links to the invoice
//! (`entity_type = 'invoice'`). A notice never fails the money action it
//! follows: an error is logged.

use rust_decimal::Decimal;
use serde_json::json;
use sqlx::Row;
use uuid::Uuid;

use crate::state::AppState;

pub(super) const KIND_INVOICE_ISSUED: &str = "invoice_issued";
pub(super) const KIND_PAYMENT_RECORDED: &str = "invoice_payment_recorded";
pub(super) const KIND_CREDIT_NOTE_ISSUED: &str = "invoice_credit_note_issued";

/// What happened to the invoice.
#[derive(Clone, Copy, Debug)]
pub(super) enum PatientInvoiceNotice {
    /// The draft was released: the invoice is in the portal now.
    Issued,
    PaymentRecorded {
        amount_gross: Decimal,
    },
    CreditNoteIssued {
        credit_note_id: Uuid,
        amount_gross: Decimal,
    },
}

impl PatientInvoiceNotice {
    fn kind(self) -> &'static str {
        match self {
            Self::Issued => KIND_INVOICE_ISSUED,
            Self::PaymentRecorded { .. } => KIND_PAYMENT_RECORDED,
            Self::CreditNoteIssued { .. } => KIND_CREDIT_NOTE_ISSUED,
        }
    }
}

/// Title and text of a notice in `language` (`ru`, `uk`, `en`, else German).
/// `amount` is the formatted amount, `None` when amounts are hidden from the
/// patient.
fn notice_text(
    notice: PatientInvoiceNotice,
    language: &str,
    number: &str,
    amount: Option<&str>,
) -> (String, String) {
    match (notice, language) {
        (PatientInvoiceNotice::Issued, "ru") => (
            format!("Новый счёт {number}"),
            match amount {
                Some(amount) => {
                    format!("Счёт {number} на сумму {amount} доступен в вашем кабинете.")
                }
                None => format!("Счёт {number} доступен в вашем кабинете."),
            },
        ),
        (PatientInvoiceNotice::Issued, "uk") => (
            format!("Новий рахунок {number}"),
            match amount {
                Some(amount) => {
                    format!("Рахунок {number} на суму {amount} доступний у вашому кабінеті.")
                }
                None => format!("Рахунок {number} доступний у вашому кабінеті."),
            },
        ),
        (PatientInvoiceNotice::Issued, "en") => (
            format!("New invoice {number}"),
            match amount {
                Some(amount) => {
                    format!("Invoice {number} for {amount} is available in your portal.")
                }
                None => format!("Invoice {number} is available in your portal."),
            },
        ),
        (PatientInvoiceNotice::Issued, _) => (
            format!("Neue Rechnung {number}"),
            match amount {
                Some(amount) => {
                    format!("Die Rechnung {number} über {amount} steht in Ihrem Portal bereit.")
                }
                None => format!("Die Rechnung {number} steht in Ihrem Portal bereit."),
            },
        ),
        (PatientInvoiceNotice::PaymentRecorded { .. }, "ru") => (
            "Оплата получена".to_string(),
            match amount {
                Some(amount) => format!("Мы получили оплату {amount} по счёту {number}."),
                None => format!("Мы получили оплату по счёту {number}."),
            },
        ),
        (PatientInvoiceNotice::PaymentRecorded { .. }, "uk") => (
            "Оплату отримано".to_string(),
            match amount {
                Some(amount) => format!("Ми отримали оплату {amount} за рахунком {number}."),
                None => format!("Ми отримали оплату за рахунком {number}."),
            },
        ),
        (PatientInvoiceNotice::PaymentRecorded { .. }, "en") => (
            "Payment received".to_string(),
            match amount {
                Some(amount) => {
                    format!("We received a payment of {amount} for invoice {number}.")
                }
                None => format!("We received a payment for invoice {number}."),
            },
        ),
        (PatientInvoiceNotice::PaymentRecorded { .. }, _) => (
            "Zahlung eingegangen".to_string(),
            match amount {
                Some(amount) => {
                    format!("Wir haben eine Zahlung über {amount} zur Rechnung {number} erhalten.")
                }
                None => format!("Wir haben eine Zahlung zur Rechnung {number} erhalten."),
            },
        ),
        (PatientInvoiceNotice::CreditNoteIssued { .. }, "ru") => (
            format!("Кредит-нота к счёту {number}"),
            match amount {
                Some(amount) => format!("К счёту {number} оформлена кредит-нота на {amount}."),
                None => format!("К счёту {number} оформлена кредит-нота."),
            },
        ),
        (PatientInvoiceNotice::CreditNoteIssued { .. }, "uk") => (
            format!("Кредит-нота до рахунку {number}"),
            match amount {
                Some(amount) => {
                    format!("До рахунку {number} оформлено кредит-ноту на {amount}.")
                }
                None => format!("До рахунку {number} оформлено кредит-ноту."),
            },
        ),
        (PatientInvoiceNotice::CreditNoteIssued { .. }, "en") => (
            format!("Credit note for invoice {number}"),
            match amount {
                Some(amount) => {
                    format!("A credit note of {amount} was issued for invoice {number}.")
                }
                None => format!("A credit note was issued for invoice {number}."),
            },
        ),
        (PatientInvoiceNotice::CreditNoteIssued { .. }, _) => (
            format!("Gutschrift zur Rechnung {number}"),
            match amount {
                Some(amount) => {
                    format!(
                        "Zur Rechnung {number} wurde eine Gutschrift über {amount} ausgestellt."
                    )
                }
                None => format!("Zur Rechnung {number} wurde eine Gutschrift ausgestellt."),
            },
        ),
    }
}

/// Tells the patient's portal logins about `notice`, unless the invoice (or
/// the credit note) is hidden from the portal. Called after the commit of the
/// action; never fails it.
pub(super) async fn notify_patient(
    state: &AppState,
    invoice_id: Uuid,
    notice: PatientInvoiceNotice,
) {
    if let Err(error) = try_notify_patient(state, invoice_id, notice).await {
        tracing::error!(%error, %invoice_id, kind = notice.kind(), "notify patient about invoice");
    }
}

async fn try_notify_patient(
    state: &AppState,
    invoice_id: Uuid,
    notice: PatientInvoiceNotice,
) -> Result<(), sqlx::Error> {
    let Some(row) = sqlx::query(
        r#"SELECT i.patient_id, i.invoice_number, i.currency, i.status, i.total_gross,
                  i.portal_visible, i.hide_amounts_from_patient,
                  i.released_at IS NOT NULL AS released, p.languages
           FROM invoices i
           JOIN patients p ON p.id = i.patient_id
           WHERE i.id = $1"#,
    )
    .bind(invoice_id)
    .fetch_optional(&state.db)
    .await?
    else {
        return Ok(());
    };
    // The portal lists issued invoices the patient may see; a draft and a
    // hidden invoice are not there, so nothing points at them.
    let status = row.try_get::<String, _>("status").unwrap_or_default();
    if !row.try_get::<bool, _>("portal_visible").unwrap_or(false)
        || !row.try_get::<bool, _>("released").unwrap_or(false)
        || matches!(status.as_str(), "draft" | "cancelled")
    {
        return Ok(());
    }
    if let PatientInvoiceNotice::CreditNoteIssued { credit_note_id, .. } = notice {
        let shown = sqlx::query_scalar::<_, Option<bool>>(
            "SELECT portal_visible FROM invoice_credit_note_transactions WHERE id = $1",
        )
        .bind(credit_note_id)
        .fetch_optional(&state.db)
        .await?
        .flatten()
        .unwrap_or(false);
        if !shown {
            return Ok(());
        }
    }

    let patient_id = row.try_get::<Uuid, _>("patient_id")?;
    let number = row
        .try_get::<Option<String>, _>("invoice_number")
        .unwrap_or_default()
        .unwrap_or_default();
    let currency = row
        .try_get::<String, _>("currency")
        .unwrap_or_else(|_| "EUR".to_string());
    let amounts_visible = !row
        .try_get::<bool, _>("hide_amounts_from_patient")
        .unwrap_or(true);
    let amount_gross = match notice {
        PatientInvoiceNotice::Issued => row
            .try_get::<Decimal, _>("total_gross")
            .unwrap_or(Decimal::ZERO),
        PatientInvoiceNotice::PaymentRecorded { amount_gross }
        | PatientInvoiceNotice::CreditNoteIssued { amount_gross, .. } => amount_gross,
    };
    let amount_text = amounts_visible
        .then(|| super::format_invoice_pdf_money(&amount_gross.to_string(), &currency));
    let language = super::resolve_invoice_pdf_language(
        &row.try_get::<Vec<String>, _>("languages")
            .unwrap_or_default(),
    );
    let (title, body) = notice_text(notice, &language, &number, amount_text.as_deref());
    let params = if amounts_visible {
        json!({
            "invoice_number": number,
            "amount_gross": super::decimal_to_string(amount_gross),
            "currency": currency,
        })
    } else {
        json!({ "invoice_number": number })
    };

    let inserted = sqlx::query(
        r#"INSERT INTO user_notifications (user_id, kind, title, body, entity_type, entity_id, params)
           SELECT DISTINCT u.id, $2::text, $3::text, $4::text, 'invoice'::text, $5::uuid, $6::jsonb
           FROM users u
           JOIN patient_assignments pa ON pa.user_id = u.id
           WHERE pa.patient_id = $1
             AND pa.revoked_at IS NULL
             AND u.is_active = true
             AND u.role = 'patient'
           RETURNING id, user_id"#,
    )
    .bind(patient_id)
    .bind(notice.kind())
    .bind(&title)
    .bind(&body)
    .bind(invoice_id)
    .bind(params)
    .fetch_all(&state.db)
    .await?;
    for notification in inserted {
        let (Ok(notification_id), Ok(user_id)) = (
            notification.try_get::<Uuid, _>("id"),
            notification.try_get::<Uuid, _>("user_id"),
        ) else {
            continue;
        };
        crate::realtime::publish_notification_event(
            state,
            user_id,
            "notification.created",
            Some(notification_id),
            json!({ "entity_type": "invoice" }),
        )
        .await;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_payment_notice_names_the_amount_and_the_invoice_in_the_patients_language() {
        let notice = PatientInvoiceNotice::PaymentRecorded {
            amount_gross: Decimal::new(30000, 2),
        };
        assert_eq!(notice.kind(), "invoice_payment_recorded");
        assert_eq!(
            notice_text(notice, "ru", "INV-20261110-0001", Some("300,00 €")),
            (
                "Оплата получена".to_string(),
                "Мы получили оплату 300,00 € по счёту INV-20261110-0001.".to_string()
            )
        );
        let (title, body) = notice_text(notice, "de", "INV-1", Some("300,00 €"));
        assert_eq!(title, "Zahlung eingegangen");
        assert_eq!(
            body,
            "Wir haben eine Zahlung über 300,00 € zur Rechnung INV-1 erhalten."
        );
        // An unknown language reads German, like the invoice.
        assert_eq!(
            notice_text(notice, "fr", "INV-1", None).0,
            "Zahlung eingegangen"
        );
    }

    #[test]
    fn hidden_amounts_stay_out_of_every_notice() {
        let notices = [
            PatientInvoiceNotice::Issued,
            PatientInvoiceNotice::PaymentRecorded {
                amount_gross: Decimal::new(123456, 2),
            },
            PatientInvoiceNotice::CreditNoteIssued {
                credit_note_id: Uuid::nil(),
                amount_gross: Decimal::new(123456, 2),
            },
        ];
        for notice in notices {
            for language in ["de", "ru", "uk", "en"] {
                let (title, body) = notice_text(notice, language, "INV-7", None);
                assert!(
                    !title.is_empty() && body.contains("INV-7"),
                    "{language}: {body}"
                );
                assert!(
                    !body.contains('€') && !title.contains("1.234"),
                    "{language}: {title} / {body}"
                );
                let (_, with_amount) = notice_text(notice, language, "INV-7", Some("1.234,56 €"));
                assert!(
                    with_amount.contains("1.234,56 €"),
                    "{language}: {with_amount}"
                );
            }
        }
        assert_eq!(PatientInvoiceNotice::Issued.kind(), "invoice_issued");
        assert_eq!(notices[2].kind(), "invoice_credit_note_issued");
    }
}
