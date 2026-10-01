//! Credit-note document (Rechnungskorrektur) and cancellation document
//! (Stornorechnung) as PDF.
//!
//! The document references the corrected invoice by number and date, lists the
//! credited lines with their VAT rates and sums net, VAT and gross per rate
//! (§ 14 Abs. 4 UStG items that change with the correction). A reversal of a
//! credit note (Storno der Rechnungskorrektur) prints the same lines and
//! references the reversed credit note. Legacy pro-rata credit notes, created
//! before line-level credits, print as one line with their stored totals. A
//! cancellation document reverses every line of a released invoice.
//!
//! Every document is rendered once when it is issued and stored with the
//! invoice documents (GoBD); downloads serve the stored copy. Credit notes
//! issued before documents were stored get their copy on the first download.
//!
//! The layout is self-contained on purpose: invoice PDF layout helpers evolve
//! with the invoice document and must not change credit notes by accident.

use axum::{
    body::Body,
    extract::{Extension, Path, State},
    http::StatusCode,
};
use chrono::{DateTime, NaiveDate, Utc};
use printpdf::{
    Color, Mm, Op, PaintMode, PdfDocument, PdfFontHandle, PdfPage, PdfWarnMsg, Point, Pt, Rect,
    Rgb, WindingOrder,
};
use rust_decimal::Decimal;
use rust_decimal::prelude::ToPrimitive;
use serde_json::Value;
use sqlx::{PgConnection, Row};
use uuid::Uuid;

use super::credit_notes::{CreditNoteLine, parse_credit_note_lines, vat_breakdown};
use super::stored_documents::{self, NewInvoiceDocument, PendingBlob};
use super::{
    INVOICE_DOCUMENT_SOURCE_HEADER, can_read_invoices, ensure_patient_access, err,
    invoice_is_patient_visible,
};
use crate::audit;
use crate::auth::middleware::AuthUser;
use crate::money::CommercialRounding;
use crate::pdf_text::{add_unicode_pdf_fonts, pdf_text_save_options, unicode_show_text_op};
use crate::routes::me::resolve_self_patient_id;
use crate::services::patient_pdf_brand::{PatientPdfBrand, append_company_chrome};
use crate::state::AppState;
use gmed_domain::role::Role;

const PAGE_WIDTH_MM: f32 = 210.0;
const PAGE_HEIGHT_MM: f32 = 297.0;
const LEFT_MM: f32 = 18.0;
const RIGHT_MM: f32 = 18.0;
const TOP_MM: f32 = 36.5;
const CONTENT_BOTTOM_MM: f32 = 34.0;
const HEADER_REFERENCE_Y_MM: f32 = 278.0;
const HEADER_RULE_Y_MM: f32 = 274.5;
const FOOTER_RULE_Y_MM: f32 = 21.5;
const FOOTER_CONTENT_TOP_MM: f32 = 18.5;
const CONTENT_WIDTH_MM: f32 = PAGE_WIDTH_MM - LEFT_MM - RIGHT_MM;

/// `transaction_type` of a cancellation document (Stornorechnung).
pub(crate) const STORNO_DOCUMENT: &str = "storno";

pub(crate) struct CreditNotePdfContext {
    /// Credit-note transaction, or cancellation document for a `storno`.
    pub credit_note_id: Uuid,
    pub invoice_id: Uuid,
    pub patient_id: Uuid,
    pub transaction_type: String,
    pub document_number: String,
    pub reversed_document_number: Option<String>,
    pub reversed_issued_on: Option<NaiveDate>,
    pub reason: String,
    pub issued_on: NaiveDate,
    pub currency: String,
    pub amount_net: Decimal,
    pub amount_vat: Decimal,
    pub amount_gross: Decimal,
    pub lines: Option<Vec<CreditNoteLine>>,
    pub credit_portal_visible: bool,
    pub invoice_number: String,
    pub invoice_date: NaiveDate,
    pub invoice_status: String,
    pub invoice_portal_visible: bool,
    pub hide_amounts_from_patient: bool,
    pub pdf_visible_to_patient: bool,
    pub order_number: Option<String>,
    pub patient_pid: String,
    pub patient_name: String,
    pub language: String,
    pub agency: PatientPdfBrand,
    pub vat_id: Option<String>,
    pub tax_number: Option<String>,
    /// The corrected invoice's addressee (payer or patient). A correction is
    /// sent to the same party as the invoice and names it like the invoice.
    pub(super) recipient: Option<super::document::InvoiceRecipient>,
}

fn setting(row: &sqlx::postgres::PgRow, column: &str) -> Option<String> {
    row.try_get::<Option<String>, _>(column)
        .unwrap_or_default()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn pdf_language(languages: &[String]) -> String {
    languages
        .iter()
        .find_map(|value| match value.trim().to_ascii_lowercase().as_str() {
            "de" | "de-de" | "de_at" | "de-at" => Some("de"),
            "uk" | "ua" | "uk-ua" | "ua-ua" => Some("uk"),
            "ru" | "ru-ru" => Some("ru"),
            "en" | "en-gb" | "en-us" => Some("en"),
            _ => None,
        })
        .unwrap_or("de")
        .to_string()
}

pub(crate) async fn load_credit_note_pdf_context(
    conn: &mut PgConnection,
    invoice_id: Uuid,
    credit_note_id: Uuid,
) -> Result<Option<CreditNotePdfContext>, sqlx::Error> {
    let Some(row) = sqlx::query(
        r#"SELECT credit.id, credit.invoice_id, credit.transaction_type, credit.document_number,
                  credit.reason, credit.issued_on, credit.currency, credit.amount_net,
                  credit.amount_vat, credit.amount_gross, credit.line_items,
                  credit.portal_visible AS credit_portal_visible,
                  original.document_number AS reversed_document_number,
                  original.issued_on AS reversed_issued_on,
                  invoice.patient_id, invoice.invoice_number, invoice.issued_at, invoice.status,
                  invoice.portal_visible, invoice.hide_amounts_from_patient,
                  invoice.pdf_visible_to_patient,
                  orders.order_number,
                  patient.patient_id AS patient_pid, patient.title, patient.first_name,
                  patient.last_name, patient.languages,
                  (SELECT value #>> '{}' FROM system_settings WHERE key = 'agency_name') AS agency_name,
                  (SELECT value #>> '{}' FROM system_settings WHERE key = 'agency_care_of') AS agency_care_of,
                  (SELECT value #>> '{}' FROM system_settings WHERE key = 'agency_address') AS agency_address,
                  (SELECT value #>> '{}' FROM system_settings WHERE key = 'agency_phone') AS agency_phone,
                  (SELECT value #>> '{}' FROM system_settings WHERE key = 'agency_email') AS agency_email,
                  (SELECT value #>> '{}' FROM system_settings WHERE key = 'agency_website') AS agency_website,
                  (SELECT value #>> '{}' FROM system_settings WHERE key = 'agency_vat_id') AS agency_vat_id,
                  (SELECT value #>> '{}' FROM system_settings WHERE key = 'agency_tax_number') AS agency_tax_number
           FROM invoice_credit_note_transactions credit
           JOIN invoices invoice ON invoice.id = credit.invoice_id
           JOIN patients patient ON patient.id = invoice.patient_id
           LEFT JOIN orders ON orders.id = invoice.order_id
           LEFT JOIN invoice_credit_note_transactions original
             ON original.id = credit.reverses_transaction_id
           WHERE credit.id = $1 AND credit.invoice_id = $2"#,
    )
    .bind(credit_note_id)
    .bind(invoice_id)
    .fetch_optional(&mut *conn)
    .await?
    else {
        return Ok(None);
    };

    let name = patient_name(&row);
    let issued_at = row
        .try_get::<DateTime<Utc>, _>("issued_at")
        .unwrap_or_else(|_| Utc::now());
    let recipient = super::document::load_invoice_recipient(conn, invoice_id).await?;
    Ok(Some(CreditNotePdfContext {
        recipient,
        credit_note_id,
        invoice_id,
        patient_id: row.try_get("patient_id")?,
        transaction_type: row.try_get("transaction_type")?,
        document_number: row.try_get("document_number")?,
        reversed_document_number: row.try_get("reversed_document_number")?,
        reversed_issued_on: row.try_get("reversed_issued_on")?,
        reason: row.try_get("reason")?,
        issued_on: row.try_get("issued_on")?,
        currency: row.try_get("currency")?,
        amount_net: row.try_get("amount_net")?,
        amount_vat: row.try_get("amount_vat")?,
        amount_gross: row.try_get("amount_gross")?,
        lines: parse_credit_note_lines(row.try_get::<Option<Value>, _>("line_items")?.as_ref()),
        credit_portal_visible: row.try_get("credit_portal_visible")?,
        invoice_number: row.try_get("invoice_number")?,
        invoice_date: issued_at
            .with_timezone(&chrono_tz::Europe::Berlin)
            .date_naive(),
        invoice_status: row.try_get("status")?,
        invoice_portal_visible: row.try_get("portal_visible")?,
        hide_amounts_from_patient: row.try_get("hide_amounts_from_patient")?,
        pdf_visible_to_patient: row.try_get("pdf_visible_to_patient")?,
        order_number: row.try_get("order_number")?,
        patient_pid: row.try_get("patient_pid")?,
        patient_name: name,
        language: pdf_language(
            &row.try_get::<Vec<String>, _>("languages")
                .unwrap_or_default(),
        ),
        agency: PatientPdfBrand {
            name: setting(&row, "agency_name")
                .unwrap_or_else(|| "GMED - Agentur für Patientenbetreuung".to_string()),
            responsible_person: setting(&row, "agency_care_of").unwrap_or_default(),
            address: setting(&row, "agency_address"),
            phone: setting(&row, "agency_phone"),
            email: setting(&row, "agency_email"),
            website: setting(&row, "agency_website"),
        },
        vat_id: setting(&row, "agency_vat_id"),
        tax_number: setting(&row, "agency_tax_number"),
    }))
}

fn patient_name(row: &sqlx::postgres::PgRow) -> String {
    [
        setting(row, "title"),
        setting(row, "first_name"),
        setting(row, "last_name"),
    ]
    .into_iter()
    .flatten()
    .collect::<Vec<_>>()
    .join(" ")
}

/// Printing context of an invoice's cancellation document. Its stored amounts
/// and lines are negative; the document prints them with the credit sign.
pub(crate) async fn load_storno_pdf_context(
    conn: &mut PgConnection,
    invoice_id: Uuid,
) -> Result<Option<CreditNotePdfContext>, sqlx::Error> {
    let Some(row) = sqlx::query(
        r#"SELECT storno.id, storno.document_number, storno.reason, storno.issued_on,
                  storno.currency, storno.amount_net, storno.amount_vat, storno.amount_gross,
                  storno.line_items, storno.original_invoice_number,
                  storno.original_invoice_date,
                  invoice.patient_id, invoice.status,
                  invoice.portal_visible, invoice.hide_amounts_from_patient,
                  invoice.pdf_visible_to_patient,
                  orders.order_number,
                  patient.patient_id AS patient_pid, patient.title, patient.first_name,
                  patient.last_name, patient.languages,
                  (SELECT value #>> '{}' FROM system_settings WHERE key = 'agency_name') AS agency_name,
                  (SELECT value #>> '{}' FROM system_settings WHERE key = 'agency_care_of') AS agency_care_of,
                  (SELECT value #>> '{}' FROM system_settings WHERE key = 'agency_address') AS agency_address,
                  (SELECT value #>> '{}' FROM system_settings WHERE key = 'agency_phone') AS agency_phone,
                  (SELECT value #>> '{}' FROM system_settings WHERE key = 'agency_email') AS agency_email,
                  (SELECT value #>> '{}' FROM system_settings WHERE key = 'agency_website') AS agency_website,
                  (SELECT value #>> '{}' FROM system_settings WHERE key = 'agency_vat_id') AS agency_vat_id,
                  (SELECT value #>> '{}' FROM system_settings WHERE key = 'agency_tax_number') AS agency_tax_number
           FROM invoice_storno_documents storno
           JOIN invoices invoice ON invoice.id = storno.invoice_id
           JOIN patients patient ON patient.id = invoice.patient_id
           LEFT JOIN orders ON orders.id = invoice.order_id
           WHERE storno.invoice_id = $1"#,
    )
    .bind(invoice_id)
    .fetch_optional(&mut *conn)
    .await?
    else {
        return Ok(None);
    };
    let recipient = super::document::load_invoice_recipient(conn, invoice_id).await?;
    let lines = parse_credit_note_lines(row.try_get::<Option<Value>, _>("line_items")?.as_ref())
        .map(|lines| {
            lines
                .into_iter()
                .map(|line| CreditNoteLine {
                    net: -line.net,
                    vat: -line.vat,
                    gross: -line.gross,
                    ..line
                })
                .collect::<Vec<_>>()
        })
        .filter(|lines| !lines.is_empty());
    Ok(Some(CreditNotePdfContext {
        recipient,
        credit_note_id: row.try_get("id")?,
        invoice_id,
        patient_id: row.try_get("patient_id")?,
        transaction_type: STORNO_DOCUMENT.to_string(),
        document_number: row.try_get("document_number")?,
        reversed_document_number: None,
        reversed_issued_on: None,
        reason: row.try_get("reason")?,
        issued_on: row.try_get("issued_on")?,
        currency: row.try_get("currency")?,
        amount_net: -row.try_get::<Decimal, _>("amount_net")?,
        amount_vat: -row.try_get::<Decimal, _>("amount_vat")?,
        amount_gross: -row.try_get::<Decimal, _>("amount_gross")?,
        lines,
        credit_portal_visible: true,
        invoice_number: row.try_get("original_invoice_number")?,
        invoice_date: row.try_get("original_invoice_date")?,
        invoice_status: row.try_get("status")?,
        invoice_portal_visible: row.try_get("portal_visible")?,
        hide_amounts_from_patient: row.try_get("hide_amounts_from_patient")?,
        pdf_visible_to_patient: row.try_get("pdf_visible_to_patient")?,
        order_number: row.try_get("order_number")?,
        patient_pid: row.try_get("patient_pid")?,
        patient_name: patient_name(&row),
        language: pdf_language(
            &row.try_get::<Vec<String>, _>("languages")
                .unwrap_or_default(),
        ),
        agency: PatientPdfBrand {
            name: setting(&row, "agency_name")
                .unwrap_or_else(|| "GMED - Agentur für Patientenbetreuung".to_string()),
            responsible_person: setting(&row, "agency_care_of").unwrap_or_default(),
            address: setting(&row, "agency_address"),
            phone: setting(&row, "agency_phone"),
            email: setting(&row, "agency_email"),
            website: setting(&row, "agency_website"),
        },
        vat_id: setting(&row, "agency_vat_id"),
        tax_number: setting(&row, "agency_tax_number"),
    }))
}

fn label(language: &str, key: &'static str) -> &'static str {
    match (language, key) {
        ("uk", "title") => "Коригування рахунку",
        ("ru", "title") => "Корректировка счёта",
        ("en", "title") => "Invoice correction (credit note)",
        (_, "title") => "Rechnungskorrektur (Gutschrift)",
        ("uk", "reversal_title") => "Сторно коригування рахунку",
        ("ru", "reversal_title") => "Сторно корректировки счёта",
        ("en", "reversal_title") => "Cancellation of invoice correction",
        (_, "reversal_title") => "Storno der Rechnungskorrektur",
        ("uk", "storno_title") => "Сторно рахунку",
        ("ru", "storno_title") => "Сторнирование счёта",
        ("en", "storno_title") => "Cancellation invoice",
        (_, "storno_title") => "Stornorechnung",
        ("uk", "storno_lines") => "Сторновані позиції",
        ("ru", "storno_lines") => "Сторнированные позиции",
        ("en", "storno_lines") => "Cancelled items",
        (_, "storno_lines") => "Stornierte Positionen",
        ("uk", "storno_total") => "Сума сторно",
        ("ru", "storno_total") => "Сумма сторно",
        ("en", "storno_total") => "Cancellation total",
        (_, "storno_total") => "Stornobetrag",
        ("uk", "refers_to") => "до рахунку",
        ("ru", "refers_to") => "к счёту",
        ("en", "refers_to") => "for invoice",
        (_, "refers_to") => "zur Rechnung",
        ("uk", "of") => "від",
        ("ru", "of") => "от",
        ("en", "of") => "of",
        (_, "of") => "vom",
        ("uk", "document_number") => "Номер документа",
        ("ru", "document_number") => "Номер документа",
        ("en", "document_number") => "Document no.",
        (_, "document_number") => "Dokument-Nr.",
        ("uk", "issued_on") => "Дата",
        ("ru", "issued_on") => "Дата",
        ("en", "issued_on") => "Date",
        (_, "issued_on") => "Datum",
        ("uk", "invoice") => "Первинний рахунок",
        ("ru", "invoice") => "Исходный счёт",
        ("en", "invoice") => "Original invoice",
        (_, "invoice") => "Ursprüngliche Rechnung",
        ("uk", "invoice_date") => "Дата рахунку",
        ("ru", "invoice_date") => "Дата счёта",
        ("en", "invoice_date") => "Invoice date",
        (_, "invoice_date") => "Rechnungsdatum",
        ("uk", "reversed") => "Сторнований документ",
        ("ru", "reversed") => "Сторнируемый документ",
        ("en", "reversed") => "Cancelled document",
        (_, "reversed") => "Stornierter Beleg",
        ("uk", "patient") => "Пацієнт",
        ("ru", "patient") => "Пациент",
        ("en", "patient") => "Patient",
        (_, "patient") => "Patient",
        ("uk", "patient_id") => "ID пацієнта",
        ("ru", "patient_id") => "ID пациента",
        ("en", "patient_id") => "Patient ID",
        (_, "patient_id") => "Patienten-ID",
        ("uk", "order") => "Замовлення",
        ("ru", "order") => "Заказ",
        ("en", "order") => "Order",
        (_, "order") => "Auftrag",
        ("uk", "vat_id") => "ІПН ПДВ (USt-IdNr.)",
        ("ru", "vat_id") => "ИНН НДС (USt-IdNr.)",
        ("en", "vat_id") => "VAT ID",
        (_, "vat_id") => "USt-IdNr.",
        ("uk", "tax_number") => "Податковий номер",
        ("ru", "tax_number") => "Налоговый номер",
        ("en", "tax_number") => "Tax number",
        (_, "tax_number") => "Steuernummer",
        ("uk", "reason") => "Причина",
        ("ru", "reason") => "Причина",
        ("en", "reason") => "Reason",
        (_, "reason") => "Grund",
        ("uk", "lines") => "Скориговані позиції",
        ("ru", "lines") => "Скорректированные позиции",
        ("en", "lines") => "Corrected items",
        (_, "lines") => "Korrigierte Positionen",
        ("uk", "item") => "Позиція",
        ("ru", "item") => "Позиция",
        ("en", "item") => "Item",
        (_, "item") => "Leistung",
        ("uk", "quantity") => "К-сть",
        ("ru", "quantity") => "Кол-во",
        ("en", "quantity") => "Qty",
        (_, "quantity") => "Menge",
        ("uk", "unit_price") => "Ціна",
        ("ru", "unit_price") => "Цена",
        ("en", "unit_price") => "Unit price",
        (_, "unit_price") => "Einzelpreis",
        ("uk", "vat_rate") => "ПДВ",
        ("ru", "vat_rate") => "НДС",
        ("en", "vat_rate") => "VAT",
        (_, "vat_rate") => "MwSt.",
        ("uk", "amount") => "Сума",
        ("ru", "amount") => "Сумма",
        ("en", "amount") => "Amount",
        (_, "amount") => "Betrag",
        ("uk", "partial") => "часткове коригування",
        ("ru", "partial") => "частичная корректировка",
        ("en", "partial") => "partial correction",
        (_, "partial") => "Teilkorrektur",
        ("uk", "passthrough") => "перевиставлені витрати без ПДВ",
        ("ru", "passthrough") => "перевыставленные расходы без НДС",
        ("en", "passthrough") => "VAT-free cost passthrough",
        (_, "passthrough") => "MwSt-freie Durchlaufkosten",
        ("uk", "legacy_line") => "Коригування рахунку (пропорційно)",
        ("ru", "legacy_line") => "Корректировка счёта (пропорционально)",
        ("en", "legacy_line") => "Invoice correction (pro rata)",
        (_, "legacy_line") => "Rechnungskorrektur (anteilig)",
        ("uk", "vat_summary") => "ПДВ за ставками",
        ("ru", "vat_summary") => "НДС по ставкам",
        ("en", "vat_summary") => "VAT by rate",
        (_, "vat_summary") => "Umsatzsteuer nach Steuersätzen",
        ("uk", "rate") => "Ставка",
        ("ru", "rate") => "Ставка",
        ("en", "rate") => "Rate",
        (_, "rate") => "Steuersatz",
        ("uk", "vat_amount") => "Сума ПДВ",
        ("ru", "vat_amount") => "Сумма НДС",
        ("en", "vat_amount") => "VAT amount",
        (_, "vat_amount") => "MwSt.-Betrag",
        ("uk", "net") => "Нетто",
        ("ru", "net") => "Нетто",
        ("en", "net") => "Net",
        (_, "net") => "Netto",
        ("uk", "gross") => "Брутто",
        ("ru", "gross") => "Брутто",
        ("en", "gross") => "Gross",
        (_, "gross") => "Brutto",
        ("uk", "total_net") => "Разом нетто",
        ("ru", "total_net") => "Итого нетто",
        ("en", "total_net") => "Net total",
        (_, "total_net") => "Summe netto",
        ("uk", "total_vat") => "Разом ПДВ",
        ("ru", "total_vat") => "Итого НДС",
        ("en", "total_vat") => "VAT total",
        (_, "total_vat") => "Summe MwSt.",
        ("uk", "total_gross") => "Сума коригування",
        ("ru", "total_gross") => "Сумма корректировки",
        ("en", "total_gross") => "Correction total",
        (_, "total_gross") => "Korrekturbetrag",
        ("uk", "credit_statement") => {
            "Цей документ зменшує суму зазначеного рахунку на суму коригування. Решта рахунку залишається без змін."
        }
        ("ru", "credit_statement") => {
            "Этот документ уменьшает сумму указанного счёта на сумму корректировки. В остальном счёт остаётся без изменений."
        }
        ("en", "credit_statement") => {
            "This document reduces the invoice above by the correction total. The invoice is otherwise unchanged."
        }
        (_, "credit_statement") => {
            "Dieses Dokument mindert die oben genannte Rechnung um den Korrekturbetrag. Im Übrigen bleibt die Rechnung unverändert."
        }
        ("uk", "reversal_statement") => {
            "Цей документ скасовує зазначене коригування; сума рахунку знову підлягає сплаті в цьому розмірі."
        }
        ("ru", "reversal_statement") => {
            "Этот документ отменяет указанную корректировку; сумма счёта снова подлежит оплате в этом размере."
        }
        ("en", "reversal_statement") => {
            "This document cancels the correction above; the invoice amount is payable again to this extent."
        }
        (_, "reversal_statement") => {
            "Dieses Dokument hebt die oben genannte Rechnungskorrektur auf; der Rechnungsbetrag ist in dieser Höhe wieder geschuldet."
        }
        ("uk", "storno_statement") => {
            "Цей документ повністю сторнує зазначений рахунок; сума рахунку більше не підлягає сплаті."
        }
        ("ru", "storno_statement") => {
            "Этот документ полностью сторнирует указанный счёт; сумма счёта больше не подлежит оплате."
        }
        ("en", "storno_statement") => {
            "This document cancels the invoice above in full; the invoice amount is no longer payable."
        }
        (_, "storno_statement") => {
            "Diese Stornorechnung hebt die oben genannte Rechnung vollständig auf; der Rechnungsbetrag ist nicht mehr geschuldet."
        }
        ("uk", "page") => "Сторінка",
        ("ru", "page") => "Страница",
        ("en", "page") => "Page",
        (_, "page") => "Seite",
        _ => key,
    }
}

fn format_date(value: NaiveDate) -> String {
    value.format("%d.%m.%Y").to_string()
}

/// German money notation, as on the invoice: "-1.234,56 €".
pub(crate) fn format_money(amount: Decimal, currency: &str) -> String {
    let cents = (amount.abs().round_cents() * Decimal::from(100))
        .to_u128()
        .unwrap_or(0);
    let whole = (cents / 100).to_string();
    let mut grouped = String::with_capacity(whole.len() + whole.len() / 3);
    for (index, digit) in whole.chars().enumerate() {
        if index > 0 && (whole.len() - index).is_multiple_of(3) {
            grouped.push('.');
        }
        grouped.push(digit);
    }
    let sign = if amount.is_sign_negative() && cents > 0 {
        "-"
    } else {
        ""
    };
    let unit = if currency.eq_ignore_ascii_case("EUR") {
        "€"
    } else {
        currency
    };
    format!("{sign}{grouped},{:02} {unit}", cents % 100)
}

fn format_number(language: &str, value: Decimal) -> String {
    let plain = value.normalize().to_string();
    if language == "en" {
        plain
    } else {
        plain.replace('.', ",")
    }
}

#[derive(Clone, Copy)]
enum Tone {
    Accent,
    Body,
    Muted,
}

fn color(tone: Tone) -> Color {
    match tone {
        Tone::Accent => Color::Rgb(Rgb::new(0.95, 0.35, 0.06, None)),
        Tone::Muted => Color::Rgb(Rgb::new(0.46, 0.44, 0.42, None)),
        Tone::Body => Color::Rgb(Rgb::new(0.12, 0.11, 0.10, None)),
    }
}

fn pt_to_mm(value: f32) -> f32 {
    value * 0.352_778
}

fn text_width_mm(text: &str, size_pt: f32) -> f32 {
    let em: f32 = text
        .chars()
        .map(|character| match character {
            ' ' | '.' | ',' | ':' | ';' | '!' | '|' | 'i' | 'j' | 'l' => 0.28,
            '-' | '/' | '(' | ')' | 'f' | 't' | 'r' | 'I' => 0.36,
            '0'..='9' => 0.556,
            'm' | 'w' | 'M' | 'W' => 0.86,
            'A'..='Z' | 'Ä' | 'Ö' | 'Ü' => 0.70,
            'a'..='z' | 'ä' | 'ö' | 'ü' | 'ß' => 0.52,
            _ => 0.58,
        })
        .sum();
    pt_to_mm(size_pt) * em
}

fn wrap(text: &str, size_pt: f32, width_mm: f32) -> Vec<String> {
    let max_chars = ((width_mm / (pt_to_mm(size_pt) * 0.54)).floor() as usize).max(12);
    let mut lines = Vec::new();
    let mut current = String::new();
    for word in text.split_whitespace() {
        let projected = if current.is_empty() {
            word.chars().count()
        } else {
            current.chars().count() + 1 + word.chars().count()
        };
        if projected <= max_chars {
            if !current.is_empty() {
                current.push(' ');
            }
            current.push_str(word);
            continue;
        }
        if !current.is_empty() {
            lines.push(std::mem::take(&mut current));
        }
        let mut chunk = String::new();
        for character in word.chars() {
            chunk.push(character);
            if chunk.chars().count() >= max_chars {
                lines.push(std::mem::take(&mut chunk));
            }
        }
        current = chunk;
    }
    if !current.is_empty() {
        lines.push(current);
    }
    lines
}

#[derive(Clone, Copy)]
enum Align {
    Left,
    Right,
}

struct Layout {
    pages: Vec<PdfPage>,
    ops: Vec<Op>,
    y_mm: f32,
    reference: String,
    brand: PatientPdfBrand,
    regular: PdfFontHandle,
    bold: PdfFontHandle,
}

impl Layout {
    fn text(&mut self, text: &str, x_mm: f32, y_mm: f32, size_pt: f32, bold: bool, tone: Tone) {
        self.ops.push(Op::SetFont {
            font: if bold {
                self.bold.clone()
            } else {
                self.regular.clone()
            },
            size: Pt(size_pt),
        });
        self.ops.push(Op::StartTextSection);
        self.ops.push(Op::SetTextCursor {
            pos: Point::new(Mm(x_mm), Mm(y_mm)),
        });
        self.ops.push(Op::SetFillColor { col: color(tone) });
        self.ops.push(unicode_show_text_op(text));
        self.ops.push(Op::EndTextSection);
    }

    fn rule(&mut self, y_mm: f32, height_mm: f32, tone: Tone) {
        self.ops.push(Op::SetFillColor { col: color(tone) });
        self.ops.push(Op::DrawPolygon {
            polygon: Rect {
                x: Mm(LEFT_MM).into(),
                y: Mm(y_mm).into(),
                width: Mm(CONTENT_WIDTH_MM).into(),
                height: Mm(height_mm).into(),
                mode: Some(PaintMode::Fill),
                winding_order: Some(WindingOrder::NonZero),
            }
            .to_polygon(),
        });
    }

    fn finish_page(&mut self) {
        if self.ops.is_empty() {
            return;
        }
        let reference = self.reference.clone();
        let x_mm = (PAGE_WIDTH_MM - RIGHT_MM - text_width_mm(&reference, 8.5)).max(LEFT_MM);
        self.text(
            &reference,
            x_mm,
            HEADER_REFERENCE_Y_MM,
            8.5,
            false,
            Tone::Body,
        );
        append_company_chrome(
            &mut self.ops,
            &self.brand,
            &self.regular,
            LEFT_MM,
            PAGE_WIDTH_MM - RIGHT_MM,
            HEADER_RULE_Y_MM,
            FOOTER_RULE_Y_MM,
            FOOTER_CONTENT_TOP_MM,
        );
        self.pages.push(PdfPage::new(
            Mm(PAGE_WIDTH_MM),
            Mm(PAGE_HEIGHT_MM),
            std::mem::take(&mut self.ops),
        ));
        self.y_mm = PAGE_HEIGHT_MM - TOP_MM;
    }

    fn ensure(&mut self, needed_mm: f32) {
        if self.y_mm - needed_mm < CONTENT_BOTTOM_MM {
            self.finish_page();
        }
    }

    fn space(&mut self, mm: f32) {
        self.ensure(mm);
        self.y_mm -= mm;
    }

    fn paragraph(&mut self, text: &str, size_pt: f32, bold: bool, tone: Tone) {
        let height = pt_to_mm(size_pt * 1.4);
        for line in wrap(text, size_pt, CONTENT_WIDTH_MM) {
            self.ensure(height);
            self.text(&line, LEFT_MM, self.y_mm, size_pt, bold, tone);
            self.y_mm -= height;
        }
    }

    /// Label/value pairs in two columns.
    fn meta(&mut self, cells: &[(&str, String)]) {
        let column_mm = CONTENT_WIDTH_MM / 2.0;
        for pair in cells.chunks(2) {
            self.ensure(9.0);
            for (column, (name, value)) in pair.iter().enumerate() {
                let x_mm = LEFT_MM + column as f32 * column_mm;
                self.text(name, x_mm, self.y_mm, 7.0, false, Tone::Muted);
                let value = wrap(value, 9.5, column_mm - 4.0)
                    .into_iter()
                    .next()
                    .unwrap_or_default();
                self.text(&value, x_mm, self.y_mm - 4.0, 9.5, true, Tone::Body);
            }
            self.y_mm -= 9.0;
        }
    }

    fn row(&mut self, cells: &[(&str, f32, Align)], header: bool, bold: bool) {
        let size_pt = if header { 7.2 } else { 9.2 };
        let line_height = pt_to_mm(size_pt * 1.25);
        let total: f32 = cells.iter().map(|(_, width, _)| width).sum();
        let scale = CONTENT_WIDTH_MM / total.max(1.0);
        let wrapped = cells
            .iter()
            .map(|(text, width, _)| {
                let text = if header {
                    text.to_uppercase()
                } else {
                    (*text).to_string()
                };
                wrap(&text, size_pt, (width * scale - 3.0).max(10.0))
            })
            .collect::<Vec<_>>();
        let lines = wrapped.iter().map(Vec::len).max().unwrap_or(1).max(1);
        let height = lines as f32 * line_height + 3.6;
        self.ensure(height + 0.4);
        let top = self.y_mm;
        let mut x_mm = LEFT_MM;
        for ((_, width, align), lines) in cells.iter().zip(wrapped) {
            let width = width * scale;
            for (index, line) in lines.iter().enumerate() {
                let text_x = match align {
                    Align::Left => x_mm + 1.5,
                    Align::Right => {
                        (x_mm + width - 1.5 - text_width_mm(line, size_pt)).max(x_mm + 1.5)
                    }
                };
                self.text(
                    line,
                    text_x,
                    top - 3.4 - index as f32 * line_height,
                    size_pt,
                    bold,
                    if header { Tone::Muted } else { Tone::Body },
                );
            }
            x_mm += width;
        }
        self.y_mm = top - height;
        self.rule(
            self.y_mm,
            if header { 0.35 } else { 0.18 },
            if header { Tone::Body } else { Tone::Muted },
        );
    }

    fn finish(mut self, language: &str) -> Vec<PdfPage> {
        self.finish_page();
        let total = self.pages.len();
        let regular = self.regular.clone();
        for (index, page) in self.pages.iter_mut().enumerate() {
            let text = format!("{}: {}/{}", label(language, "page"), index + 1, total);
            let x_mm = (PAGE_WIDTH_MM - RIGHT_MM - text_width_mm(&text, 7.0)).max(LEFT_MM);
            page.ops.push(Op::SetFont {
                font: regular.clone(),
                size: Pt(7.0),
            });
            page.ops.push(Op::StartTextSection);
            page.ops.push(Op::SetTextCursor {
                pos: Point::new(Mm(x_mm), Mm(16.8)),
            });
            page.ops.push(Op::SetFillColor {
                col: color(Tone::Muted),
            });
            page.ops.push(unicode_show_text_op(&text));
            page.ops.push(Op::EndTextSection);
        }
        self.pages
    }
}

/// Lines printed on the document: the credited lines, or one pro-rata line
/// for a legacy credit note.
fn printed_lines(context: &CreditNotePdfContext) -> Vec<CreditNoteLine> {
    match &context.lines {
        Some(lines) if !lines.is_empty() => lines.clone(),
        _ => vec![CreditNoteLine {
            invoice_line_index: 0,
            description: label(&context.language, "legacy_line").to_string(),
            quantity: None,
            unit_price: None,
            vat_rate: Decimal::ZERO,
            is_cost_passthrough: false,
            net: context.amount_net,
            vat: context.amount_vat,
            gross: context.amount_gross,
        }],
    }
}

pub(crate) fn build_credit_note_pdf(
    context: &CreditNotePdfContext,
) -> Result<Vec<u8>, &'static str> {
    let language = context.language.as_str();
    let is_reversal = context.transaction_type == "reversal";
    let is_storno = context.transaction_type == STORNO_DOCUMENT;
    // A credit note reduces the invoice (negative), its reversal restores it.
    let sign = if is_reversal {
        Decimal::ONE
    } else {
        Decimal::NEGATIVE_ONE
    };
    let mut document = PdfDocument::new(&context.document_number);
    let (regular, bold) = add_unicode_pdf_fonts(&mut document)?;
    let mut layout = Layout {
        pages: Vec::new(),
        ops: Vec::new(),
        y_mm: PAGE_HEIGHT_MM - TOP_MM,
        reference: format!(
            "{}: {}",
            label(language, "document_number"),
            context.document_number
        ),
        brand: context.agency.clone(),
        regular,
        bold,
    };

    // Address block as on the invoice: sender line, then the addressee.
    if let Some(recipient) = &context.recipient {
        let sender = std::iter::once(context.agency.name.trim().to_string())
            .chain(
                context
                    .agency
                    .address
                    .as_deref()
                    .unwrap_or_default()
                    .replace('\r', "\n")
                    .split(['\n', ','])
                    .map(str::trim)
                    .filter(|part| !part.is_empty())
                    .map(ToOwned::to_owned),
            )
            .collect::<Vec<_>>()
            .join(" · ");
        layout.paragraph(&sender, 7.5, false, Tone::Muted);
        layout.space(1.0);
        layout.paragraph(&recipient.name, 11.0, true, Tone::Body);
        for line in recipient.address_lines() {
            layout.paragraph(&line, 10.5, false, Tone::Body);
        }
        layout.space(8.0);
    }

    layout.paragraph(
        &label(
            language,
            if is_storno {
                "storno_title"
            } else if is_reversal {
                "reversal_title"
            } else {
                "title"
            },
        )
        .to_uppercase(),
        17.0,
        true,
        Tone::Body,
    );
    layout.paragraph(
        &format!(
            "{} {} {} {}",
            label(language, "refers_to"),
            context.invoice_number,
            label(language, "of"),
            format_date(context.invoice_date)
        ),
        11.0,
        false,
        Tone::Accent,
    );
    layout.space(4.0);

    let mut cells = vec![
        (
            label(language, "document_number"),
            context.document_number.clone(),
        ),
        (label(language, "issued_on"), format_date(context.issued_on)),
        (label(language, "invoice"), context.invoice_number.clone()),
        (
            label(language, "invoice_date"),
            format_date(context.invoice_date),
        ),
    ];
    if let Some(reversed) = &context.reversed_document_number {
        cells.push((
            label(language, "reversed"),
            match context.reversed_issued_on {
                Some(date) => format!("{reversed} ({})", format_date(date)),
                None => reversed.clone(),
            },
        ));
    }
    cells.push((label(language, "patient"), context.patient_name.clone()));
    cells.push((label(language, "patient_id"), context.patient_pid.clone()));
    if let Some(order) = context
        .order_number
        .as_deref()
        .filter(|value| !value.is_empty())
    {
        cells.push((label(language, "order"), order.to_string()));
    }
    if let Some(vat_id) = &context.vat_id {
        cells.push((label(language, "vat_id"), vat_id.clone()));
    }
    if let Some(tax_number) = &context.tax_number {
        cells.push((label(language, "tax_number"), tax_number.clone()));
    }
    layout.meta(&cells);
    layout.space(2.0);
    layout.paragraph(
        &format!("{}: {}", label(language, "reason"), context.reason.trim()),
        10.0,
        false,
        Tone::Body,
    );
    layout.space(4.0);

    layout.paragraph(
        label(language, if is_storno { "storno_lines" } else { "lines" }),
        12.0,
        true,
        Tone::Body,
    );
    layout.space(1.5);
    layout.row(
        &[
            (label(language, "item"), 84.0, Align::Left),
            (label(language, "quantity"), 16.0, Align::Right),
            (label(language, "unit_price"), 26.0, Align::Right),
            (label(language, "vat_rate"), 16.0, Align::Right),
            (label(language, "amount"), 30.0, Align::Right),
        ],
        true,
        false,
    );
    let lines = printed_lines(context);
    for line in &lines {
        let mut description = line.description.trim().to_string();
        if line.is_cost_passthrough {
            description.push_str(" · ");
            description.push_str(label(language, "passthrough"));
        }
        if line.quantity.is_none() && context.lines.is_some() && !is_storno {
            description.push_str(" · ");
            description.push_str(label(language, "partial"));
        }
        let quantity = line
            .quantity
            .map(|value| format_number(language, value))
            .unwrap_or_else(|| "—".to_string());
        let unit_price = line
            .unit_price
            .map(|value| format_money(value, &context.currency))
            .unwrap_or_else(|| "—".to_string());
        let rate = if context.lines.is_some() {
            format!("{} %", format_number(language, line.vat_rate))
        } else {
            "—".to_string()
        };
        let amount = format_money(sign * line.gross, &context.currency);
        layout.row(
            &[
                (description.as_str(), 84.0, Align::Left),
                (quantity.as_str(), 16.0, Align::Right),
                (unit_price.as_str(), 26.0, Align::Right),
                (rate.as_str(), 16.0, Align::Right),
                (amount.as_str(), 30.0, Align::Right),
            ],
            false,
            false,
        );
    }
    layout.space(5.0);

    if context.lines.is_some() {
        layout.paragraph(label(language, "vat_summary"), 12.0, true, Tone::Body);
        layout.space(1.5);
        layout.row(
            &[
                (label(language, "rate"), 40.0, Align::Left),
                (label(language, "net"), 44.0, Align::Right),
                (label(language, "vat_amount"), 44.0, Align::Right),
                (label(language, "gross"), 44.0, Align::Right),
            ],
            true,
            false,
        );
        for (rate, net, vat, gross) in vat_breakdown(&lines) {
            let rate = format!("{} %", format_number(language, rate));
            let net = format_money(sign * net, &context.currency);
            let vat = format_money(sign * vat, &context.currency);
            let gross = format_money(sign * gross, &context.currency);
            layout.row(
                &[
                    (rate.as_str(), 40.0, Align::Left),
                    (net.as_str(), 44.0, Align::Right),
                    (vat.as_str(), 44.0, Align::Right),
                    (gross.as_str(), 44.0, Align::Right),
                ],
                false,
                false,
            );
        }
        layout.space(5.0);
    }

    for (key, amount, emphasized) in [
        ("total_net", context.amount_net, false),
        ("total_vat", context.amount_vat, false),
        (
            if is_storno {
                "storno_total"
            } else {
                "total_gross"
            },
            context.amount_gross,
            true,
        ),
    ] {
        let value = format_money(sign * amount, &context.currency);
        layout.row(
            &[
                ("", 96.0, Align::Left),
                (label(language, key), 46.0, Align::Right),
                (value.as_str(), 30.0, Align::Right),
            ],
            false,
            emphasized,
        );
    }
    layout.space(6.0);
    layout.paragraph(
        label(
            language,
            if is_storno {
                "storno_statement"
            } else if is_reversal {
                "reversal_statement"
            } else {
                "credit_statement"
            },
        ),
        9.5,
        false,
        Tone::Muted,
    );

    let mut warnings: Vec<PdfWarnMsg> = Vec::new();
    Ok(document
        .with_pages(layout.finish(language))
        .save(&pdf_text_save_options(), &mut warnings))
}

fn safe_file_part(document_number: &str) -> String {
    document_number
        .chars()
        .map(|character| match character {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '-',
            _ => character,
        })
        .collect::<String>()
        .trim()
        .to_string()
}

pub(crate) fn credit_note_pdf_filename(document_number: &str) -> String {
    format!("RECHNUNGSKORREKTUR-{}.pdf", safe_file_part(document_number))
}

pub(crate) fn storno_pdf_filename(document_number: &str) -> String {
    format!("STORNORECHNUNG-{}.pdf", safe_file_part(document_number))
}

fn context_file_name(context: &CreditNotePdfContext) -> String {
    if context.transaction_type == STORNO_DOCUMENT {
        storno_pdf_filename(&context.document_number)
    } else {
        credit_note_pdf_filename(&context.document_number)
    }
}

fn pdf_response(bytes: Vec<u8>, file_name: &str, source: &'static str) -> axum::response::Response {
    match axum::response::Response::builder()
        .header("content-type", "application/pdf")
        .header(
            "content-disposition",
            format!("inline; filename=\"{}\"", file_name.replace('"', "")),
        )
        .header(INVOICE_DOCUMENT_SOURCE_HEADER, source)
        .body(Body::from(bytes))
    {
        Ok(response) => response,
        Err(error) => {
            tracing::error!(%error, "build correction document pdf response");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to build the document PDF",
            )
        }
    }
}

/// The document row a correction context is stored under.
fn new_document<'a>(
    context: &'a CreditNotePdfContext,
    file_name: &'a str,
    trigger: &'static str,
    generated_by: Option<Uuid>,
) -> NewInvoiceDocument<'a> {
    let storno = context.transaction_type == STORNO_DOCUMENT;
    NewInvoiceDocument {
        invoice_id: context.invoice_id,
        kind: if storno {
            stored_documents::KIND_STORNO
        } else {
            stored_documents::KIND_CREDIT_NOTE
        },
        dunning_event_id: None,
        credit_note_transaction_id: (!storno).then_some(context.credit_note_id),
        storno_document_id: storno.then_some(context.credit_note_id),
        file_name,
        language: &context.language,
        trigger,
        generated_by,
    }
}

/// A correction document rendered and stored at issue.
pub(super) struct IssuedCorrectionDocument {
    pub file_name: String,
    pub sha256: String,
    /// Blob written by this call; discard it when the transaction fails.
    pub blob: Option<PendingBlob>,
}

async fn store_issued(
    conn: &mut PgConnection,
    context: &CreditNotePdfContext,
    generated_by: Uuid,
) -> Result<IssuedCorrectionDocument, axum::response::Response> {
    let bytes = build_credit_note_pdf(context)
        .map_err(|message| err(StatusCode::INTERNAL_SERVER_ERROR, message))?;
    let file_name = context_file_name(context);
    let blob = stored_documents::store_rendered(
        conn,
        &new_document(
            context,
            &file_name,
            stored_documents::TRIGGER_ISSUE,
            Some(generated_by),
        ),
        &bytes,
    )
    .await?;
    Ok(IssuedCorrectionDocument {
        sha256: stored_documents::sha256_hex(&bytes),
        file_name,
        blob,
    })
}

/// Renders and stores a credit note (or reversal) inside its issuing
/// transaction.
pub(super) async fn store_issued_credit_note(
    conn: &mut PgConnection,
    invoice_id: Uuid,
    credit_note_id: Uuid,
    generated_by: Uuid,
) -> Result<IssuedCorrectionDocument, axum::response::Response> {
    let context = load_credit_note_pdf_context(conn, invoice_id, credit_note_id)
        .await
        .map_err(|error| {
            tracing::error!(%error, %invoice_id, %credit_note_id, "load issued credit note document");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to store the credit-note document",
            )
        })?
        .ok_or_else(|| err(StatusCode::NOT_FOUND, "Credit note not found"))?;
    store_issued(conn, &context, generated_by).await
}

/// Renders and stores an invoice's cancellation document inside the
/// cancelling transaction.
pub(super) async fn store_issued_storno(
    conn: &mut PgConnection,
    invoice_id: Uuid,
    generated_by: Uuid,
) -> Result<IssuedCorrectionDocument, axum::response::Response> {
    let context = load_storno_pdf_context(conn, invoice_id)
        .await
        .map_err(|error| {
            tracing::error!(%error, %invoice_id, "load issued cancellation document");
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to store the cancellation document",
            )
        })?
        .ok_or_else(|| err(StatusCode::NOT_FOUND, "Cancellation document not found"))?;
    store_issued(conn, &context, generated_by).await
}

/// The stored PDF of a correction document. A credit note issued before
/// documents were stored gets its copy now, from the current data; a
/// concurrent first download that stored first wins.
async fn stored_or_first_download(
    conn: &mut PgConnection,
    context: &CreditNotePdfContext,
    actor: Uuid,
) -> Result<(Vec<u8>, String, &'static str), axum::response::Response> {
    let storno = context.transaction_type == STORNO_DOCUMENT;
    let (credit_id, storno_id) = if storno {
        (None, Some(context.credit_note_id))
    } else {
        (Some(context.credit_note_id), None)
    };
    let failed = |error: sqlx::Error| {
        tracing::error!(%error, invoice_id = %context.invoice_id, document_id = %context.credit_note_id, "load stored correction document");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to load the document",
        )
    };
    if let Some(document) = stored_documents::load_correction(conn, credit_id, storno_id)
        .await
        .map_err(failed)?
    {
        let bytes = stored_documents::read_bytes(&document).await?;
        return Ok((bytes, document.file_name, "stored"));
    }
    let bytes = build_credit_note_pdf(context)
        .map_err(|message| err(StatusCode::INTERNAL_SERVER_ERROR, message))?;
    let file_name = context_file_name(context);
    let stored = stored_documents::store_rendered(
        conn,
        &new_document(
            context,
            &file_name,
            stored_documents::TRIGGER_FIRST_DOWNLOAD,
            Some(actor),
        ),
        &bytes,
    )
    .await?;
    if stored.is_some() {
        return Ok((bytes, file_name, "stored-on-first-download"));
    }
    let document = stored_documents::load_correction(conn, credit_id, storno_id)
        .await
        .map_err(failed)?
        .ok_or_else(|| {
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to load the document",
            )
        })?;
    let bytes = stored_documents::read_bytes(&document).await?;
    Ok((bytes, document.file_name, "stored"))
}

async fn acquire(
    state: &AppState,
) -> Result<sqlx::pool::PoolConnection<sqlx::Postgres>, axum::response::Response> {
    state.db.acquire().await.map_err(|error| {
        tracing::error!(%error, "acquire correction document connection");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to load the document",
        )
    })
}

fn audit_download(
    state: &AppState,
    actor: Uuid,
    action: &str,
    context: &CreditNotePdfContext,
    document: &'static str,
    source: &str,
) {
    let key = if context.transaction_type == STORNO_DOCUMENT {
        "storno_document_id"
    } else {
        "credit_note_transaction_id"
    };
    state.audit_sender.try_send(audit::domain_event(
        action,
        Some(actor),
        "invoice",
        Some(context.invoice_id),
        serde_json::json!({
            key: context.credit_note_id,
            "document_number": context.document_number,
            "document": document,
            "source": source,
        }),
    ));
}

pub(crate) async fn download_credit_note_pdf(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path((invoice_id, credit_note_id)): Path<(Uuid, Uuid)>,
) -> axum::response::Response {
    if !can_read_invoices(auth.role) {
        return err(StatusCode::FORBIDDEN, "Insufficient permissions");
    }
    let mut conn = match acquire(&state).await {
        Ok(conn) => conn,
        Err(response) => return response,
    };
    let context = match load_credit_note_pdf_context(&mut conn, invoice_id, credit_note_id).await {
        Ok(Some(value)) => value,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Credit note not found"),
        Err(error) => {
            tracing::error!(%error, %invoice_id, %credit_note_id, "load credit-note pdf context");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to load credit note",
            );
        }
    };
    if let Err(response) = ensure_patient_access(&state, &auth, context.patient_id).await {
        return response;
    }
    let (bytes, file_name, source) =
        match stored_or_first_download(&mut conn, &context, auth.user_id).await {
            Ok(value) => value,
            Err(response) => return response,
        };
    audit_download(
        &state,
        auth.user_id,
        "download_credit_note_pdf",
        &context,
        source,
        "staff_workspace",
    );
    pdf_response(bytes, &file_name, source)
}

pub(crate) async fn download_my_credit_note_pdf(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path((invoice_id, credit_note_id)): Path<(Uuid, Uuid)>,
) -> axum::response::Response {
    if let Err(response) = auth.require_any_role(&[Role::Patient]) {
        return response;
    }
    let patient_id = match resolve_self_patient_id(&state, auth.user_id).await {
        Ok(value) => value,
        Err(response) => return response,
    };
    let mut conn = match acquire(&state).await {
        Ok(conn) => conn,
        Err(response) => return response,
    };
    let context = match load_credit_note_pdf_context(&mut conn, invoice_id, credit_note_id).await {
        Ok(Some(value)) => value,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Credit note not found"),
        Err(error) => {
            tracing::error!(%error, %invoice_id, %credit_note_id, "load portal credit-note pdf context");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to load credit note",
            );
        }
    };
    if context.patient_id != patient_id
        || !context.invoice_portal_visible
        || !invoice_is_patient_visible(&context.invoice_status)
        || !context.credit_portal_visible
    {
        return err(StatusCode::NOT_FOUND, "Credit note not found");
    }
    if context.hide_amounts_from_patient || !context.pdf_visible_to_patient {
        return err(
            StatusCode::FORBIDDEN,
            "Credit-note PDF is hidden from patient",
        );
    }
    let (bytes, file_name, source) =
        match stored_or_first_download(&mut conn, &context, auth.user_id).await {
            Ok(value) => value,
            Err(response) => return response,
        };
    audit_download(
        &state,
        auth.user_id,
        "download_portal_credit_note_pdf",
        &context,
        source,
        "patient_portal",
    );
    pdf_response(bytes, &file_name, source)
}

pub(crate) async fn download_storno_pdf(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(invoice_id): Path<Uuid>,
) -> axum::response::Response {
    if !can_read_invoices(auth.role) {
        return err(StatusCode::FORBIDDEN, "Insufficient permissions");
    }
    let mut conn = match acquire(&state).await {
        Ok(conn) => conn,
        Err(response) => return response,
    };
    let context = match load_storno_pdf_context(&mut conn, invoice_id).await {
        Ok(Some(value)) => value,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Cancellation document not found"),
        Err(error) => {
            tracing::error!(%error, %invoice_id, "load cancellation document context");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to load the cancellation document",
            );
        }
    };
    if let Err(response) = ensure_patient_access(&state, &auth, context.patient_id).await {
        return response;
    }
    let (bytes, file_name, source) =
        match stored_or_first_download(&mut conn, &context, auth.user_id).await {
            Ok(value) => value,
            Err(response) => return response,
        };
    audit_download(
        &state,
        auth.user_id,
        "download_storno_document_pdf",
        &context,
        source,
        "staff_workspace",
    );
    pdf_response(bytes, &file_name, source)
}

pub(crate) async fn download_my_storno_pdf(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(invoice_id): Path<Uuid>,
) -> axum::response::Response {
    if let Err(response) = auth.require_any_role(&[Role::Patient]) {
        return response;
    }
    let patient_id = match resolve_self_patient_id(&state, auth.user_id).await {
        Ok(value) => value,
        Err(response) => return response,
    };
    let mut conn = match acquire(&state).await {
        Ok(conn) => conn,
        Err(response) => return response,
    };
    let context = match load_storno_pdf_context(&mut conn, invoice_id).await {
        Ok(Some(value)) => value,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Cancellation document not found"),
        Err(error) => {
            tracing::error!(%error, %invoice_id, "load portal cancellation document context");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to load the cancellation document",
            );
        }
    };
    if context.patient_id != patient_id || !context.invoice_portal_visible {
        return err(StatusCode::NOT_FOUND, "Cancellation document not found");
    }
    if context.hide_amounts_from_patient || !context.pdf_visible_to_patient {
        return err(
            StatusCode::FORBIDDEN,
            "Cancellation document PDF is hidden from patient",
        );
    }
    let (bytes, file_name, source) =
        match stored_or_first_download(&mut conn, &context, auth.user_id).await {
            Ok(value) => value,
            Err(response) => return response,
        };
    audit_download(
        &state,
        auth.user_id,
        "download_portal_storno_document_pdf",
        &context,
        source,
        "patient_portal",
    );
    pdf_response(bytes, &file_name, source)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::str::FromStr;

    fn dec(value: &str) -> Decimal {
        Decimal::from_str(value).unwrap()
    }

    fn context(lines: Option<Vec<CreditNoteLine>>, transaction_type: &str) -> CreditNotePdfContext {
        CreditNotePdfContext {
            credit_note_id: Uuid::nil(),
            invoice_id: Uuid::nil(),
            patient_id: Uuid::nil(),
            transaction_type: transaction_type.to_string(),
            document_number: "CN-2026-000001".to_string(),
            reversed_document_number: None,
            reversed_issued_on: None,
            reason: "Hotel nicht in Anspruch genommen".to_string(),
            issued_on: NaiveDate::from_ymd_opt(2026, 9, 27).unwrap(),
            currency: "EUR".to_string(),
            amount_net: dec("481.50"),
            amount_vat: Decimal::ZERO,
            amount_gross: dec("481.50"),
            lines,
            credit_portal_visible: true,
            invoice_number: "INV-20260901-0001".to_string(),
            invoice_date: NaiveDate::from_ymd_opt(2026, 9, 1).unwrap(),
            invoice_status: "sent".to_string(),
            invoice_portal_visible: true,
            hide_amounts_from_patient: false,
            pdf_visible_to_patient: true,
            order_number: Some("ORD-1".to_string()),
            patient_pid: "PT-1".to_string(),
            patient_name: "Test Patient".to_string(),
            language: "de".to_string(),
            agency: PatientPdfBrand {
                name: "GMED".to_string(),
                ..PatientPdfBrand::default()
            },
            vat_id: Some("DE123456789".to_string()),
            tax_number: None,
            recipient: Some(super::super::document::InvoiceRecipient {
                name: "Ivan Zahler".to_string(),
                street: Some("Hauptstraße 1".to_string()),
                zip: Some("10115".to_string()),
                city: Some("Berlin".to_string()),
                country: Some("Deutschland".to_string()),
                country_code: Some("DE".to_string()),
                email: None,
                is_payer: true,
                ..Default::default()
            }),
        }
    }

    #[test]
    fn credit_note_is_addressed_like_the_invoice() {
        // The walkthrough's Rechnungskorrektur had no addressee at all.
        let bytes = build_credit_note_pdf(&context(None, "credit_note")).unwrap();
        let text = pdf_extract::extract_text_from_mem(&bytes).unwrap();
        assert!(text.contains("Ivan Zahler"), "{text}");
        assert!(text.contains("Hauptstraße 1"), "{text}");
        assert!(text.contains("10115 Berlin"), "{text}");
    }

    #[test]
    fn credit_note_pdf_renders_lines_and_legacy_notes() {
        let hotel = CreditNoteLine {
            invoice_line_index: 1,
            description: "Hotel".to_string(),
            quantity: Some(dec("3")),
            unit_price: Some(dec("160.5")),
            vat_rate: Decimal::ZERO,
            is_cost_passthrough: true,
            net: dec("481.50"),
            vat: Decimal::ZERO,
            gross: dec("481.50"),
        };
        let bytes = build_credit_note_pdf(&context(Some(vec![hotel]), "credit_note")).unwrap();
        assert!(bytes.starts_with(b"%PDF"));
        let bytes = build_credit_note_pdf(&context(None, "reversal")).unwrap();
        assert!(bytes.starts_with(b"%PDF"));
    }

    #[test]
    fn storno_document_prints_its_title_and_negative_totals() {
        let consultation = CreditNoteLine {
            invoice_line_index: 0,
            description: "Organisation der Behandlung".to_string(),
            quantity: Some(dec("1")),
            unit_price: Some(dec("481.50")),
            vat_rate: Decimal::ZERO,
            is_cost_passthrough: false,
            net: dec("481.50"),
            vat: Decimal::ZERO,
            gross: dec("481.50"),
        };
        let mut storno = context(Some(vec![consultation]), STORNO_DOCUMENT);
        storno.document_number = "STORNO-20260928-0001".to_string();
        let bytes = build_credit_note_pdf(&storno).unwrap();
        let text = pdf_extract::extract_text_from_mem(&bytes).unwrap();
        assert!(text.contains("STORNORECHNUNG"), "{text}");
        assert!(text.contains("INV-20260901-0001"), "{text}");
        assert!(text.contains("-481,50"), "{text}");
        assert!(text.contains("Stornobetrag"), "{text}");
        assert!(!text.contains("Teilkorrektur"), "{text}");
        assert_eq!(
            storno_pdf_filename("STORNO-20260928-0001"),
            "STORNORECHNUNG-STORNO-20260928-0001.pdf"
        );
    }

    #[test]
    fn credit_note_money_and_filenames_follow_the_invoice_notation() {
        assert_eq!(format_money(dec("-1234.5"), "EUR"), "-1.234,50 €");
        assert_eq!(format_money(dec("0"), "USD"), "0,00 USD");
        assert_eq!(
            credit_note_pdf_filename("CN-2026/000001"),
            "RECHNUNGSKORREKTUR-CN-2026-000001.pdf"
        );
    }
}
