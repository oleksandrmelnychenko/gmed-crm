//! Dunning letters: the document a dunning event sends to the invoice
//! recipient. Levels map to the usual German sequence:
//!
//! * `first`: Zahlungserinnerung (payment reminder),
//! * `second`: 1. Mahnung,
//! * `collections`: 2. Mahnung, the last request before the claim is handed
//!   to collection.
//!
//! The letter names the invoice, the amount still open and a new payment
//! deadline, in the patient's document language (German by default). It is
//! rendered once and stored with the dunning event.

use axum::http::StatusCode;
use chrono::{DateTime, Days, NaiveDate, Utc};
use printpdf::{PdfDocument, PdfWarnMsg};
use rust_decimal::Decimal;
use serde_json::Value;
use sqlx::{PgConnection, Row};
use uuid::Uuid;

use super::stored_documents::{
    self, KIND_DUNNING_LETTER, NewInvoiceDocument, PendingBlob, TRIGGER_DUNNING,
};
use super::{
    InvoicePdfAgency, InvoicePdfCellAlign, InvoicePdfColor, InvoicePdfLayout, document, err,
    format_invoice_pdf_date, format_invoice_pdf_money, invoice_document_date,
    invoice_pdf_bank_cells, invoice_pdf_brand, invoice_pdf_heading_with_rows_height_mm,
    invoice_pdf_label, invoice_pdf_line_height_mm, invoice_pdf_sender_line,
    resolve_invoice_pdf_language,
};
use crate::pdf_text::{add_unicode_pdf_fonts, pdf_text_save_options};

/// Payment deadline a dunning letter sets when no setting overrides it.
pub(super) const DEFAULT_DUNNING_PAYMENT_TERM_DAYS: u64 = 14;

/// `system_settings.dunning_payment_term_days`, else the default.
pub(super) async fn load_dunning_payment_term_days(
    conn: &mut PgConnection,
) -> Result<u64, sqlx::Error> {
    Ok(sqlx::query_scalar::<_, String>(
        "SELECT value #>> '{}' FROM system_settings WHERE key = 'dunning_payment_term_days'",
    )
    .fetch_optional(conn)
    .await?
    .and_then(|value| value.trim().parse::<u64>().ok())
    .filter(|days| (1..=365).contains(days))
    .unwrap_or(DEFAULT_DUNNING_PAYMENT_TERM_DAYS))
}

/// The new deadline a letter sent on `letter_date` sets.
pub(super) fn dunning_payment_due_date(letter_date: NaiveDate, term_days: u64) -> NaiveDate {
    letter_date
        .checked_add_days(Days::new(term_days))
        .unwrap_or(letter_date)
}

pub(super) struct DunningLetterContext {
    pub level: String,
    pub letter_date: NaiveDate,
    pub payment_due_date: NaiveDate,
    pub invoice_number: String,
    pub invoice_date: NaiveDate,
    pub invoice_due_date: Option<NaiveDate>,
    pub currency: String,
    pub total_gross: Decimal,
    /// Open amount when the letter was sent (snapshot of the event).
    pub balance_due: Decimal,
    pub patient_name: String,
    pub patient_pid: String,
    pub language: String,
    pub recipient: document::InvoiceRecipient,
    pub agency: InvoicePdfAgency,
}

/// Reads the letter of one dunning event through the caller's connection.
pub(super) async fn load_dunning_letter_context(
    conn: &mut PgConnection,
    invoice_id: Uuid,
    dunning_event_id: Uuid,
) -> Result<Option<DunningLetterContext>, sqlx::Error> {
    let sql = format!(
        r#"SELECT dunning.level, dunning.sent_at, dunning.payment_due_date, dunning.balance_due,
                  i.invoice_number, i.issued_at, i.due_date, i.currency, i.total_gross,
                  p.patient_id AS patient_pid, p.title, p.first_name, p.last_name, p.languages,
                  {recipient_columns},
                  (SELECT jsonb_object_agg(key, value #>> '{{}}') FROM system_settings
                    WHERE key LIKE 'agency\_%') AS agency
           FROM invoice_dunning_events dunning
           JOIN invoices i ON i.id = dunning.invoice_id
           JOIN patients p ON p.id = i.patient_id
           {recipient_joins}
           WHERE dunning.id = $1 AND dunning.invoice_id = $2"#,
        recipient_columns = document::RECIPIENT_COLUMNS,
        recipient_joins = document::RECIPIENT_JOINS,
    );
    let Some(row) = sqlx::query(&sql)
        .bind(dunning_event_id)
        .bind(invoice_id)
        .fetch_optional(&mut *conn)
        .await?
    else {
        return Ok(None);
    };

    let letter_date = invoice_document_date(
        row.try_get::<DateTime<Utc>, _>("sent_at")
            .unwrap_or_else(|_| Utc::now()),
    );
    let payment_due_date = match row
        .try_get::<Option<NaiveDate>, _>("payment_due_date")
        .unwrap_or_default()
    {
        Some(date) => date,
        // Events recorded before letters existed: the deadline counts from
        // the day the event was sent.
        None => dunning_payment_due_date(letter_date, load_dunning_payment_term_days(conn).await?),
    };
    let agency = row
        .try_get::<Option<Value>, _>("agency")
        .unwrap_or_default()
        .unwrap_or(Value::Null);
    let setting = |key: &str| {
        agency
            .get(key)
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToOwned::to_owned)
    };
    let patient_name = [
        row.try_get::<Option<String>, _>("title")
            .unwrap_or_default(),
        row.try_get::<Option<String>, _>("first_name")
            .unwrap_or_default(),
        row.try_get::<Option<String>, _>("last_name")
            .unwrap_or_default(),
    ]
    .into_iter()
    .flatten()
    .map(|part| part.trim().to_string())
    .filter(|part| !part.is_empty())
    .collect::<Vec<_>>()
    .join(" ");

    Ok(Some(DunningLetterContext {
        level: row.try_get::<String, _>("level").unwrap_or_default(),
        letter_date,
        payment_due_date,
        invoice_number: row
            .try_get::<Option<String>, _>("invoice_number")
            .unwrap_or_default()
            .unwrap_or_default(),
        invoice_date: invoice_document_date(
            row.try_get::<DateTime<Utc>, _>("issued_at")
                .unwrap_or_else(|_| Utc::now()),
        ),
        invoice_due_date: row
            .try_get::<Option<NaiveDate>, _>("due_date")
            .unwrap_or_default(),
        currency: row
            .try_get::<String, _>("currency")
            .unwrap_or_else(|_| "EUR".to_string()),
        total_gross: row
            .try_get::<Decimal, _>("total_gross")
            .unwrap_or(Decimal::ZERO),
        balance_due: row
            .try_get::<Decimal, _>("balance_due")
            .unwrap_or(Decimal::ZERO),
        patient_name,
        patient_pid: row.try_get::<String, _>("patient_pid").unwrap_or_default(),
        language: resolve_invoice_pdf_language(
            &row.try_get::<Vec<String>, _>("languages")
                .unwrap_or_default(),
        ),
        recipient: document::resolve_invoice_recipient(&document::recipient_source_from_row(&row)),
        agency: InvoicePdfAgency {
            name: setting("agency_name")
                .unwrap_or_else(|| "GMED - Agentur für Patientenbetreuung".to_string()),
            care_of: setting("agency_care_of"),
            address: setting("agency_address"),
            phone: setting("agency_phone"),
            email: setting("agency_email"),
            website: setting("agency_website"),
            bank_holder: setting("agency_bank_holder"),
            bank_name: setting("agency_bank_name"),
            bank_swift: setting("agency_bank_swift"),
            bank_iban: setting("agency_bank_iban"),
            vat_id: setting("agency_vat_id"),
            tax_number: setting("agency_tax_number"),
        },
    }))
}

/// Title of the letter for a dunning level.
pub(super) fn dunning_letter_title(language: &str, level: &str) -> &'static str {
    match (language, level) {
        ("uk", "first") => "Нагадування про оплату",
        ("uk", "second") => "Перша вимога про оплату",
        ("uk", "collections") => "Друга вимога про оплату",
        ("ru", "first") => "Напоминание об оплате",
        ("ru", "second") => "Первое требование об оплате",
        ("ru", "collections") => "Второе требование об оплате",
        ("en", "first") => "Payment reminder",
        ("en", "second") => "First reminder notice",
        ("en", "collections") => "Second and final reminder notice",
        (_, "first") => "Zahlungserinnerung",
        (_, "second") => "1. Mahnung",
        (_, "collections") => "2. Mahnung",
        (_, _) => "Mahnung",
    }
}

fn dunning_letter_label(language: &str, key: &str) -> &'static str {
    match (language, key) {
        ("uk", "salutation") => "Шановні пані та панове,",
        ("ru", "salutation") => "Уважаемые дамы и господа,",
        ("en", "salutation") => "Dear Sir or Madam,",
        (_, "salutation") => "Sehr geehrte Damen und Herren,",
        ("uk", "letter_date") => "Дата листа",
        ("ru", "letter_date") => "Дата письма",
        ("en", "letter_date") => "Letter date",
        (_, "letter_date") => "Datum",
        ("uk", "invoice_date") => "Дата рахунку",
        ("ru", "invoice_date") => "Дата счёта",
        ("en", "invoice_date") => "Invoice date",
        (_, "invoice_date") => "Rechnungsdatum",
        ("uk", "original_due_date") => "Початковий термін оплати",
        ("ru", "original_due_date") => "Первоначальный срок оплаты",
        ("en", "original_due_date") => "Original due date",
        (_, "original_due_date") => "Ursprünglich fällig am",
        ("uk", "invoice_total") => "Сума рахунку",
        ("ru", "invoice_total") => "Сумма счёта",
        ("en", "invoice_total") => "Invoice total",
        (_, "invoice_total") => "Rechnungsbetrag",
        ("uk", "settled") => "Вже сплачено або зараховано",
        ("ru", "settled") => "Уже оплачено или зачтено",
        ("en", "settled") => "Already paid or credited",
        (_, "settled") => "Bereits bezahlt oder gutgeschrieben",
        ("uk", "open_amount") => "Сума до сплати",
        ("ru", "open_amount") => "Сумма к оплате",
        ("en", "open_amount") => "Amount outstanding",
        (_, "open_amount") => "Offener Betrag",
        ("uk", "new_due_date") => "Новий термін оплати",
        ("ru", "new_due_date") => "Новый срок оплаты",
        ("en", "new_due_date") => "New payment deadline",
        (_, "new_due_date") => "Neue Zahlungsfrist",
        ("uk", "payment_reference") => "Призначення платежу",
        ("ru", "payment_reference") => "Назначение платежа",
        ("en", "payment_reference") => "Payment reference",
        (_, "payment_reference") => "Verwendungszweck",
        ("uk", "closing") => "З повагою",
        ("ru", "closing") => "С уважением",
        ("en", "closing") => "Kind regards",
        (_, "closing") => "Mit freundlichen Grüßen",
        _ => "",
    }
}

/// Body paragraphs of the letter.
pub(super) fn dunning_letter_body(
    language: &str,
    level: &str,
    invoice_number: &str,
    payment_due_date: NaiveDate,
) -> Vec<String> {
    let deadline = format_invoice_pdf_date(Some(payment_due_date));
    let already_paid = match language {
        "uk" => "Якщо ви вже здійснили оплату, будь ласка, вважайте цей лист недійсним.",
        "ru" => "Если вы уже произвели оплату, пожалуйста, считайте это письмо недействительным.",
        "en" => "If you have already paid, please disregard this letter.",
        _ => {
            "Sollten Sie die Zahlung bereits veranlasst haben, betrachten Sie dieses Schreiben bitte als gegenstandslos."
        }
    };
    let opening = match (language, level) {
        ("uk", "first") => format!(
            "можливо, ви не помітили, що рахунок {invoice_number} ще не сплачено повністю. Просимо сплатити суму до сплати до {deadline}."
        ),
        ("uk", "second") => format!(
            "незважаючи на наше нагадування, рахунок {invoice_number} досі не сплачено повністю. Просимо сплатити суму до сплати до {deadline}."
        ),
        ("uk", _) => format!(
            "незважаючи на нагадування та першу вимогу, рахунок {invoice_number} досі не сплачено. Востаннє просимо сплатити суму до сплати до {deadline}. Після цього терміну ми залишаємо за собою право передати вимогу до колекторської агенції або звернутися до суду без додаткового повідомлення."
        ),
        ("ru", "first") => format!(
            "возможно, вы не заметили, что счёт {invoice_number} ещё не оплачен полностью. Просим оплатить сумму к оплате до {deadline}."
        ),
        ("ru", "second") => format!(
            "несмотря на наше напоминание, счёт {invoice_number} до сих пор не оплачен полностью. Просим оплатить сумму к оплате до {deadline}."
        ),
        ("ru", _) => format!(
            "несмотря на напоминание и первое требование, счёт {invoice_number} до сих пор не оплачен. В последний раз просим оплатить сумму к оплате до {deadline}. По истечении этого срока мы оставляем за собой право без дополнительного уведомления передать требование коллекторскому агентству или обратиться в суд."
        ),
        ("en", "first") => format!(
            "our records show that invoice {invoice_number} has not been paid in full yet. Please pay the amount outstanding by {deadline}."
        ),
        ("en", "second") => format!(
            "despite our payment reminder, invoice {invoice_number} is still not paid in full. Please pay the amount outstanding by {deadline}."
        ),
        ("en", _) => format!(
            "despite our reminder and our first notice, invoice {invoice_number} is still unpaid. We ask you for the last time to pay the amount outstanding by {deadline}. After this deadline we reserve the right to hand the claim over to a collection agency or to take legal action without further notice."
        ),
        (_, "first") => format!(
            "sicherlich ist Ihrer Aufmerksamkeit entgangen, dass die Rechnung {invoice_number} noch nicht vollständig beglichen ist. Bitte überweisen Sie den offenen Betrag bis zum {deadline}."
        ),
        (_, "second") => format!(
            "trotz unserer Zahlungserinnerung ist die Rechnung {invoice_number} noch nicht vollständig beglichen. Bitte überweisen Sie den offenen Betrag bis zum {deadline}."
        ),
        (_, _) => format!(
            "trotz Zahlungserinnerung und Mahnung ist die Rechnung {invoice_number} weiterhin nicht beglichen. Wir fordern Sie letztmalig auf, den offenen Betrag bis zum {deadline} zu überweisen. Nach Ablauf dieser Frist behalten wir uns vor, die Forderung ohne weitere Ankündigung einem Inkassounternehmen zu übergeben oder gerichtlich geltend zu machen."
        ),
    };
    vec![opening, already_paid.to_string()]
}

/// File name of a stored letter, e.g. `1-MAHNUNG-INV-20260927-0042.pdf`.
pub(super) fn dunning_letter_filename(level: &str, invoice_number: &str) -> String {
    let prefix = match level {
        "first" => "ZAHLUNGSERINNERUNG",
        "second" => "1-MAHNUNG",
        _ => "2-MAHNUNG",
    };
    let number = invoice_number
        .chars()
        .map(|ch| match ch {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '-',
            _ => ch,
        })
        .collect::<String>();
    format!("{prefix}-{}.pdf", number.trim())
}

pub(super) fn build_dunning_letter_pdf(
    context: &DunningLetterContext,
) -> Result<Vec<u8>, &'static str> {
    let language = context.language.as_str();
    let title = dunning_letter_title(language, &context.level);
    let mut pdf = PdfDocument::new(title);
    let (regular, bold) = add_unicode_pdf_fonts(&mut pdf)?;
    let mut layout = InvoicePdfLayout::new(
        context.invoice_number.clone(),
        invoice_pdf_brand(&context.agency),
        invoice_pdf_label(language, "page_label").to_string(),
        regular,
        bold,
    );

    layout.text_block(
        &invoice_pdf_sender_line(&context.agency),
        7.0,
        false,
        0.0,
        InvoicePdfColor::Muted,
        0.0,
        1.5,
    );
    layout.text_block(
        &context.recipient.name,
        10.5,
        true,
        0.0,
        InvoicePdfColor::Body,
        0.0,
        0.0,
    );
    for line in context.recipient.address_lines() {
        layout.text_block(&line, 10.0, false, 0.0, InvoicePdfColor::Body, 0.0, 0.0);
    }
    layout.spacer(8.0);

    layout.text_block(title, 16.0, true, 0.0, InvoicePdfColor::Body, 0.0, 1.0);
    let money = |amount: Decimal| format_invoice_pdf_money(&amount.to_string(), &context.currency);
    let settled = (context.total_gross - context.balance_due).max(Decimal::ZERO);
    let mut cells = vec![
        (
            dunning_letter_label(language, "letter_date"),
            format_invoice_pdf_date(Some(context.letter_date)),
        ),
        (
            invoice_pdf_label(language, "invoice_number"),
            context.invoice_number.clone(),
        ),
        (
            dunning_letter_label(language, "invoice_date"),
            format_invoice_pdf_date(Some(context.invoice_date)),
        ),
        (
            dunning_letter_label(language, "original_due_date"),
            format_invoice_pdf_date(context.invoice_due_date),
        ),
    ];
    if !context.patient_name.is_empty() {
        cells.push((
            invoice_pdf_label(language, "patient_name"),
            context.patient_name.clone(),
        ));
        cells.push((
            invoice_pdf_label(language, "patient_id"),
            context.patient_pid.clone(),
        ));
    }
    layout.meta_grid(&cells);

    layout.text_block(
        dunning_letter_label(language, "salutation"),
        10.5,
        false,
        0.0,
        InvoicePdfColor::Body,
        0.0,
        2.0,
    );
    for paragraph in dunning_letter_body(
        language,
        &context.level,
        &context.invoice_number,
        context.payment_due_date,
    ) {
        layout.text_block(
            &paragraph,
            10.5,
            false,
            0.0,
            InvoicePdfColor::Body,
            0.0,
            2.5,
        );
    }
    layout.spacer(2.0);

    layout.summary_row(
        dunning_letter_label(language, "invoice_total"),
        &money(context.total_gross),
        false,
        false,
    );
    if !settled.is_zero() {
        layout.summary_row(
            dunning_letter_label(language, "settled"),
            &money(-settled),
            false,
            false,
        );
    }
    layout.summary_row(
        dunning_letter_label(language, "open_amount"),
        &money(context.balance_due),
        true,
        true,
    );
    layout.summary_row(
        dunning_letter_label(language, "new_due_date"),
        &format_invoice_pdf_date(Some(context.payment_due_date)),
        true,
        false,
    );

    let bank_cells = invoice_pdf_bank_cells(language, &context.agency);
    if !bank_cells.is_empty() {
        // The payment details (plus the reference row) stay on one page.
        layout.ensure_space(invoice_pdf_heading_with_rows_height_mm(
            12.0,
            6.0,
            bank_cells.len() + 1,
        ));
        layout.text_block(
            invoice_pdf_label(language, "payment_details"),
            12.0,
            true,
            0.0,
            InvoicePdfColor::Body,
            6.0,
            0.0,
        );
        for (label, value) in bank_cells
            .iter()
            .map(|(label, value)| (*label, value.as_str()))
            .chain(std::iter::once((
                dunning_letter_label(language, "payment_reference"),
                context.invoice_number.as_str(),
            )))
        {
            layout.table_row(
                &[
                    (label, 40.0, InvoicePdfCellAlign::Left),
                    (value, 134.0, InvoicePdfCellAlign::Left),
                ],
                false,
                false,
                false,
            );
        }
    }

    // Closing and signature belong together; the signature alone on a
    // second page looked like a stray page.
    layout.ensure_space(8.0 + 1.0 + 2.0 * invoice_pdf_line_height_mm(10.5, 1.35));
    layout.text_block(
        dunning_letter_label(language, "closing"),
        10.5,
        false,
        0.0,
        InvoicePdfColor::Body,
        8.0,
        1.0,
    );
    layout.text_block(
        &context.agency.name,
        10.5,
        false,
        0.0,
        InvoicePdfColor::Body,
        0.0,
        0.0,
    );

    let mut warnings: Vec<PdfWarnMsg> = Vec::new();
    Ok(pdf
        .with_pages(layout.finish())
        .save(&pdf_text_save_options(), &mut warnings))
}

/// A rendered letter and, when this call stored it, its not yet committed blob.
pub(super) struct RenderedLetter {
    pub bytes: Vec<u8>,
    pub file_name: String,
    pub blob: Option<PendingBlob>,
}

/// Renders the letter of a dunning event and writes its blob and row through
/// the caller's connection (the dunning transaction, or a pool connection when
/// an event recorded before letters existed is downloaded the first time).
/// `None` when the event does not exist; `blob: None` when another request
/// stored the letter first. The caller discards the blob when it does not
/// commit.
pub(super) async fn store_dunning_letter(
    conn: &mut PgConnection,
    invoice_id: Uuid,
    dunning_event_id: Uuid,
    generated_by: Option<Uuid>,
) -> Result<Option<RenderedLetter>, axum::response::Response> {
    let failed = |error: sqlx::Error| {
        tracing::error!(%error, %invoice_id, %dunning_event_id, "store dunning letter");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to store the dunning letter",
        )
    };
    let Some(context) = load_dunning_letter_context(conn, invoice_id, dunning_event_id)
        .await
        .map_err(failed)?
    else {
        return Ok(None);
    };
    let bytes = build_dunning_letter_pdf(&context)
        .map_err(|message| err(StatusCode::INTERNAL_SERVER_ERROR, message))?;
    let file_name = dunning_letter_filename(&context.level, &context.invoice_number);
    let blob = stored_documents::write_blob(&bytes, &file_name).await?;
    let inserted = stored_documents::insert_row(
        conn,
        &NewInvoiceDocument {
            invoice_id,
            kind: KIND_DUNNING_LETTER,
            dunning_event_id: Some(dunning_event_id),
            file_name: &file_name,
            language: &context.language,
            trigger: TRIGGER_DUNNING,
            generated_by,
        },
        &blob,
    )
    .await;
    match inserted {
        Ok(Some(_)) => Ok(Some(RenderedLetter {
            bytes,
            file_name,
            blob: Some(blob),
        })),
        Ok(None) => {
            // Another request stored this letter first; keep that one.
            blob.discard().await;
            Ok(Some(RenderedLetter {
                bytes,
                file_name,
                blob: None,
            }))
        }
        Err(error) => {
            blob.discard().await;
            Err(failed(error))
        }
    }
}

/// The stored letter of a dunning event; events recorded before letters
/// existed get theirs now. `None` when the event does not exist.
pub(super) async fn dunning_letter_pdf(
    conn: &mut PgConnection,
    invoice_id: Uuid,
    dunning_event_id: Uuid,
    actor: Uuid,
) -> Result<Option<(Vec<u8>, String, &'static str)>, axum::response::Response> {
    let failed = |error: sqlx::Error| {
        tracing::error!(%error, %invoice_id, %dunning_event_id, "load dunning letter");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to load the dunning letter",
        )
    };
    if let Some(document) = stored_documents::load(conn, invoice_id, Some(dunning_event_id))
        .await
        .map_err(failed)?
    {
        let bytes = stored_documents::read_bytes(&document).await?;
        return Ok(Some((bytes, document.file_name, "stored")));
    }
    let Some(letter) =
        store_dunning_letter(conn, invoice_id, dunning_event_id, Some(actor)).await?
    else {
        return Ok(None);
    };
    if letter.blob.is_some() {
        return Ok(Some((
            letter.bytes,
            letter.file_name,
            "stored-on-first-download",
        )));
    }
    let document = stored_documents::load(conn, invoice_id, Some(dunning_event_id))
        .await
        .map_err(failed)?
        .ok_or_else(|| {
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to load the dunning letter",
            )
        })?;
    let bytes = stored_documents::read_bytes(&document).await?;
    Ok(Some((bytes, document.file_name, "stored")))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn context(level: &str, language: &str) -> DunningLetterContext {
        DunningLetterContext {
            level: level.to_string(),
            letter_date: NaiveDate::from_ymd_opt(2026, 10, 20).unwrap(),
            payment_due_date: NaiveDate::from_ymd_opt(2026, 11, 3).unwrap(),
            invoice_number: "INV-20260927-0042".to_string(),
            invoice_date: NaiveDate::from_ymd_opt(2026, 9, 27).unwrap(),
            invoice_due_date: NaiveDate::from_ymd_opt(2026, 10, 11),
            currency: "EUR".to_string(),
            total_gross: Decimal::new(119000, 2),
            balance_due: Decimal::new(69000, 2),
            patient_name: "Anna Muster".to_string(),
            patient_pid: "PT-1".to_string(),
            language: language.to_string(),
            recipient: document::InvoiceRecipient {
                name: "Ivan Zahler".to_string(),
                street: Some("Kyivska 5".to_string()),
                zip: Some("01001".to_string()),
                city: Some("Kyiv".to_string()),
                country: Some("Ukraine".to_string()),
                country_code: Some("UA".to_string()),
                email: None,
                is_payer: true,
            },
            agency: InvoicePdfAgency {
                name: "GMED - Agentur für Patientenbetreuung".to_string(),
                care_of: None,
                address: Some("Albert-Schweitzer-Straße 56\n81735 München".to_string()),
                phone: None,
                email: None,
                website: None,
                bank_holder: Some("GMED".to_string()),
                bank_name: None,
                bank_swift: None,
                bank_iban: Some("DE02120300000000202051".to_string()),
                vat_id: None,
                tax_number: None,
            },
        }
    }

    fn text(context: &DunningLetterContext) -> String {
        pdf_extract::extract_text_from_mem(&build_dunning_letter_pdf(context).unwrap()).unwrap()
    }

    #[test]
    fn letters_name_the_level_invoice_open_amount_and_new_deadline() {
        let reminder = text(&context("first", "de"));
        assert!(reminder.contains("Zahlungserinnerung"), "{reminder}");
        assert!(reminder.contains("INV-20260927-0042"));
        assert!(reminder.contains("Ivan Zahler"));
        assert!(reminder.contains("01001 Kyiv"));
        assert!(reminder.contains("1.190,00 €"));
        assert!(reminder.contains("-500,00 €"));
        assert!(reminder.contains("690,00 €"));
        assert!(reminder.contains("Neue Zahlungsfrist"));
        assert!(reminder.contains("03.11.2026"));
        assert!(reminder.contains("Verwendungszweck"));
        assert!(reminder.contains("DE02120300000000202051"));

        let first_notice = text(&context("second", "de"));
        assert!(first_notice.contains("1. Mahnung"));
        let last_notice = text(&context("collections", "de"));
        assert!(last_notice.contains("2. Mahnung"));
        assert!(last_notice.contains("Inkassounternehmen"));

        let russian = text(&context("second", "ru"));
        assert!(russian.contains("Первое требование об оплате"));
        assert!(russian.contains("Новый срок оплаты"));
    }

    #[test]
    fn closing_and_signature_stay_together() {
        // With full bank details the walkthrough letter put "Mit freundlichen
        // Grüßen" on page 1 and the signature alone on page 2.
        let mut letter = context("first", "de");
        letter.agency.care_of = Some("Heorhii Hudiiev".to_string());
        letter.agency.bank_name = Some("Commerzbank München".to_string());
        letter.agency.bank_swift = Some("COBADEFFXXX".to_string());
        letter.recipient.name = "Ready Lead".to_string();
        let pages = pdf_extract::extract_text_from_mem_by_pages(
            &build_dunning_letter_pdf(&letter).unwrap(),
        )
        .unwrap();
        let closing_page = pages
            .iter()
            .find(|page| page.contains("Mit freundlichen Grüßen"))
            .expect("closing");
        // Body text precedes the page header ("Dokument-Nr.") in the extract.
        let after_closing = closing_page
            .split("Mit freundlichen Grüßen")
            .nth(1)
            .and_then(|rest| rest.split("Dokument-Nr.").next())
            .unwrap_or_default();
        assert!(
            after_closing.contains("GMED - Agentur für Patientenbetreuung"),
            "signature is not under the closing: {pages:?}"
        );
    }

    #[test]
    fn deadline_and_file_name_follow_the_level() {
        assert_eq!(
            dunning_payment_due_date(NaiveDate::from_ymd_opt(2026, 10, 20).unwrap(), 14),
            NaiveDate::from_ymd_opt(2026, 11, 3).unwrap()
        );
        assert_eq!(
            dunning_letter_filename("first", "INV-1"),
            "ZAHLUNGSERINNERUNG-INV-1.pdf"
        );
        assert_eq!(
            dunning_letter_filename("second", "INV-1"),
            "1-MAHNUNG-INV-1.pdf"
        );
        assert_eq!(
            dunning_letter_filename("collections", "INV/1"),
            "2-MAHNUNG-INV-1.pdf"
        );
    }
}
