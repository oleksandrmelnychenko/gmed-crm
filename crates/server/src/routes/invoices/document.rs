//! Content of the printed invoice beyond the stored invoice row: who receives
//! it, when the services were rendered, how the amounts split by VAT rate
//! (§ 14 Abs. 4 Nr. 1, 6 and 8 UStG) and which advances a settlement invoice
//! deducts (§ 14 Abs. 5 Satz 2 UStG).
//!
//! The recipient is resolved once here and used by both the printed invoice
//! and the ZUGFeRD buyer, so the visible document and the embedded XML cannot
//! name different parties. The same holds for the deducted advances.

use chrono::{DateTime, NaiveDate, Utc};
use rust_decimal::Decimal;
use serde_json::{Value, json};
use sqlx::{PgConnection, Row, postgres::PgRow};
use uuid::Uuid;

use super::{InvoicePdfLineItem, credit_notes, zugferd};
use crate::money::CommercialRounding;

/// Select list naming the recipient candidates. Needs `invoices i`,
/// `patients p` and [`RECIPIENT_JOINS`].
pub(super) const RECIPIENT_COLUMNS: &str = r#"
    p.title AS rcpt_patient_title, p.first_name AS rcpt_patient_first_name,
    p.last_name AS rcpt_patient_last_name, p.email AS rcpt_patient_email,
    p.address_street AS rcpt_patient_street, p.address_zip AS rcpt_patient_zip,
    p.address_city AS rcpt_patient_city, p.address_country AS rcpt_patient_country,
    p.residence_country AS rcpt_patient_residence_country,
    i.payer_patient_relation_id AS rcpt_payer_relation_id,
    i.payer_contact_name AS rcpt_payer_name, i.payer_contact_email AS rcpt_payer_email,
    i.payer_address_street AS rcpt_payer_street, i.payer_address_zip AS rcpt_payer_zip,
    i.payer_address_city AS rcpt_payer_city, i.payer_address_country AS rcpt_payer_country,
    rcpt_relation.related_name AS rcpt_relation_name,
    rcpt_relation_patient.id AS rcpt_relation_patient_id,
    rcpt_relation_patient.title AS rcpt_relation_patient_title,
    rcpt_relation_patient.first_name AS rcpt_relation_patient_first_name,
    rcpt_relation_patient.last_name AS rcpt_relation_patient_last_name,
    rcpt_relation_patient.email AS rcpt_relation_patient_email,
    rcpt_relation_patient.address_street AS rcpt_relation_patient_street,
    rcpt_relation_patient.address_zip AS rcpt_relation_patient_zip,
    rcpt_relation_patient.address_city AS rcpt_relation_patient_city,
    rcpt_relation_patient.address_country AS rcpt_relation_patient_country,
    rcpt_relation_patient.residence_country AS rcpt_relation_patient_residence_country
"#;

pub(super) const RECIPIENT_JOINS: &str = r#"
    LEFT JOIN patient_relations rcpt_relation ON rcpt_relation.id = i.payer_patient_relation_id
    LEFT JOIN patients rcpt_relation_patient
           ON rcpt_relation_patient.id = rcpt_relation.related_patient_id
"#;

/// A person as stored on a patient record.
#[derive(Clone, Debug, Default)]
pub(super) struct RecipientParty {
    pub title: Option<String>,
    pub first_name: Option<String>,
    pub last_name: Option<String>,
    pub email: Option<String>,
    pub street: Option<String>,
    pub zip: Option<String>,
    pub city: Option<String>,
    pub country: Option<String>,
    pub residence_country: Option<String>,
}

impl RecipientParty {
    fn full_name(&self) -> Option<String> {
        let name = [&self.title, &self.first_name, &self.last_name]
            .into_iter()
            .filter_map(|part| clean(part.as_deref()))
            .collect::<Vec<_>>()
            .join(" ");
        (!name.is_empty()).then_some(name)
    }
}

/// Everything the recipient is chosen from.
#[derive(Clone, Debug, Default)]
pub(super) struct RecipientSource {
    pub patient: RecipientParty,
    pub payer_relation_id: Option<Uuid>,
    pub payer_contact_name: Option<String>,
    pub payer_contact_email: Option<String>,
    pub payer_street: Option<String>,
    pub payer_zip: Option<String>,
    pub payer_city: Option<String>,
    pub payer_country: Option<String>,
    pub relation_name: Option<String>,
    /// The relation's own patient record, when the relative is a patient.
    pub relation_patient: Option<RecipientParty>,
}

/// The party the invoice is addressed to.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub(super) struct InvoiceRecipient {
    pub name: String,
    pub street: Option<String>,
    pub zip: Option<String>,
    pub city: Option<String>,
    /// Country as stored (a name or a code).
    pub country: Option<String>,
    /// ISO 3166-1 alpha-2 for the e-invoice.
    pub country_code: Option<String>,
    pub email: Option<String>,
    /// The payer set on the invoice, not the patient.
    pub is_payer: bool,
}

fn clean(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn country_code(country: Option<&str>, residence_country: Option<&str>) -> Option<String> {
    crate::routes::patients::patient_label_country_code(country, residence_country)
}

impl InvoiceRecipient {
    fn from_party(party: &RecipientParty, name: String, is_payer: bool) -> Self {
        Self {
            name,
            street: clean(party.street.as_deref()),
            zip: clean(party.zip.as_deref()),
            city: clean(party.city.as_deref()),
            country: clean(party.country.as_deref()),
            country_code: country_code(
                party.country.as_deref(),
                party.residence_country.as_deref(),
            ),
            email: clean(party.email.as_deref()),
            is_payer,
        }
    }

    /// Address lines under the name: street, postcode and city, country.
    pub fn address_lines(&self) -> Vec<String> {
        let mut lines = Vec::new();
        if let Some(street) = &self.street {
            lines.push(street.clone());
        }
        let locality = [self.zip.as_deref(), self.city.as_deref()]
            .into_iter()
            .flatten()
            .collect::<Vec<_>>()
            .join(" ");
        if !locality.is_empty() {
            lines.push(locality);
        }
        if let Some(country) = &self.country {
            lines.push(country.clone());
        }
        lines
    }

    /// Street plus postcode or city: enough to deliver the invoice.
    pub fn has_postal_address(&self) -> bool {
        self.street.is_some() && (self.zip.is_some() || self.city.is_some())
    }

    pub fn to_json(&self) -> Value {
        json!({
            "name": self.name,
            "street": self.street,
            "zip": self.zip,
            "city": self.city,
            "country": self.country,
            "is_payer": self.is_payer,
            "has_postal_address": self.has_postal_address(),
        })
    }
}

/// The payer when one is set, the patient otherwise. A payer address entered
/// on the invoice wins; a relative who is a patient record brings that
/// record's address. A payer is never given the patient's address.
pub(super) fn resolve_invoice_recipient(source: &RecipientSource) -> InvoiceRecipient {
    let contact_name = clean(source.payer_contact_name.as_deref());
    let relation_patient_name = source
        .relation_patient
        .as_ref()
        .and_then(RecipientParty::full_name);
    let relation_name = clean(source.relation_name.as_deref());
    let has_payer = contact_name.is_some() || source.payer_relation_id.is_some();
    if !has_payer {
        return InvoiceRecipient::from_party(
            &source.patient,
            source.patient.full_name().unwrap_or_default(),
            false,
        );
    }

    let name = contact_name
        .or(relation_patient_name)
        .or(relation_name)
        .or_else(|| source.patient.full_name())
        .unwrap_or_default();
    let payer_address = RecipientParty {
        email: source.payer_contact_email.clone(),
        street: source.payer_street.clone(),
        zip: source.payer_zip.clone(),
        city: source.payer_city.clone(),
        country: source.payer_country.clone(),
        ..RecipientParty::default()
    };
    let has_own_address = [
        &payer_address.street,
        &payer_address.zip,
        &payer_address.city,
        &payer_address.country,
    ]
    .into_iter()
    .any(|value| clean(value.as_deref()).is_some());
    let mut recipient = match (&source.relation_patient, has_own_address) {
        (Some(relative), false) => InvoiceRecipient::from_party(relative, name, true),
        _ => InvoiceRecipient::from_party(&payer_address, name, true),
    };
    if let Some(email) = clean(source.payer_contact_email.as_deref()) {
        recipient.email = Some(email);
    } else if recipient.email.is_none() {
        recipient.email = source
            .relation_patient
            .as_ref()
            .and_then(|relative| clean(relative.email.as_deref()));
    }
    recipient
}

fn optional_text(row: &PgRow, column: &str) -> Option<String> {
    row.try_get::<Option<String>, _>(column).unwrap_or_default()
}

/// Reads the recipient candidates selected with [`RECIPIENT_COLUMNS`].
pub(super) fn recipient_source_from_row(row: &PgRow) -> RecipientSource {
    let party = |prefix: &str| RecipientParty {
        title: optional_text(row, &format!("{prefix}_title")),
        first_name: optional_text(row, &format!("{prefix}_first_name")),
        last_name: optional_text(row, &format!("{prefix}_last_name")),
        email: optional_text(row, &format!("{prefix}_email")),
        street: optional_text(row, &format!("{prefix}_street")),
        zip: optional_text(row, &format!("{prefix}_zip")),
        city: optional_text(row, &format!("{prefix}_city")),
        country: optional_text(row, &format!("{prefix}_country")),
        residence_country: optional_text(row, &format!("{prefix}_residence_country")),
    };
    let relation_patient = row
        .try_get::<Option<Uuid>, _>("rcpt_relation_patient_id")
        .unwrap_or_default()
        .map(|_| party("rcpt_relation_patient"));
    RecipientSource {
        patient: party("rcpt_patient"),
        payer_relation_id: row
            .try_get::<Option<Uuid>, _>("rcpt_payer_relation_id")
            .unwrap_or_default(),
        payer_contact_name: optional_text(row, "rcpt_payer_name"),
        payer_contact_email: optional_text(row, "rcpt_payer_email"),
        payer_street: optional_text(row, "rcpt_payer_street"),
        payer_zip: optional_text(row, "rcpt_payer_zip"),
        payer_city: optional_text(row, "rcpt_payer_city"),
        payer_country: optional_text(row, "rcpt_payer_country"),
        relation_name: optional_text(row, "rcpt_relation_name"),
        relation_patient,
    }
}

/// Loads and resolves the recipient of one invoice.
pub(super) async fn load_invoice_recipient(
    conn: &mut PgConnection,
    invoice_id: Uuid,
) -> Result<Option<InvoiceRecipient>, sqlx::Error> {
    let sql = format!(
        "SELECT {RECIPIENT_COLUMNS} FROM invoices i JOIN patients p ON p.id = i.patient_id {RECIPIENT_JOINS} WHERE i.id = $1"
    );
    let row = sqlx::query(&sql)
        .bind(invoice_id)
        .fetch_optional(conn)
        .await?;
    Ok(row
        .as_ref()
        .map(|row| resolve_invoice_recipient(&recipient_source_from_row(row))))
}

/// First and last day the invoiced services were rendered (Leistungszeitraum).
///
/// Service lines are dated by their medical appointment, else by the day the
/// service was delivered. Without dated lines the order's appointments give the
/// period (an advance invoice bills services still ahead). Supplier invoices
/// billed on are dated by their own invoice date as a last resort.
pub(super) async fn load_invoice_service_period(
    conn: &mut PgConnection,
    order_id: Option<Uuid>,
    line_items: &Value,
) -> Result<Option<(NaiveDate, NaiveDate)>, sqlx::Error> {
    let source_line_ids = super::extract_source_line_ids(line_items);
    if !source_line_ids.is_empty() {
        let row = sqlx::query(
            r#"SELECT min(service_day) AS first_day, max(service_day) AS last_day
               FROM (
                   SELECT COALESCE(
                              appointment.date,
                              (service.delivered_at AT TIME ZONE 'Europe/Berlin')::date
                          ) AS service_day
                   FROM order_leistungen service
                   LEFT JOIN appointments appointment
                          ON appointment.id = service.source_medical_appointment_id
                         AND appointment.status <> 'cancelled'
                   WHERE service.id = ANY($1)
               ) days"#,
        )
        .bind(&source_line_ids)
        .fetch_one(&mut *conn)
        .await?;
        if let (Some(first), Some(last)) = (
            row.try_get::<Option<NaiveDate>, _>("first_day")
                .unwrap_or_default(),
            row.try_get::<Option<NaiveDate>, _>("last_day")
                .unwrap_or_default(),
        ) {
            return Ok(Some((first, last)));
        }
    }

    if let Some(order_id) = order_id {
        let row = sqlx::query(
            r#"SELECT min(date) AS first_day, max(date) AS last_day
               FROM appointments
               WHERE order_id = $1 AND status <> 'cancelled'"#,
        )
        .bind(order_id)
        .fetch_one(&mut *conn)
        .await?;
        if let (Some(first), Some(last)) = (
            row.try_get::<Option<NaiveDate>, _>("first_day")
                .unwrap_or_default(),
            row.try_get::<Option<NaiveDate>, _>("last_day")
                .unwrap_or_default(),
        ) {
            return Ok(Some((first, last)));
        }
    }

    let supplier_days = line_items
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|item| item.get("source_invoice_date").and_then(Value::as_str))
        .filter_map(|raw| NaiveDate::parse_from_str(raw.trim(), "%Y-%m-%d").ok())
        .collect::<Vec<_>>();
    Ok(supplier_days
        .iter()
        .min()
        .copied()
        .zip(supplier_days.iter().max().copied()))
}

/// How a VAT breakdown row is taxed.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub(super) enum VatGroupKind {
    Taxed,
    /// 0 % and not a pass-through cost.
    ZeroRated,
    /// Pass-through cost (durchlaufender Posten).
    Passthrough,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct VatBreakdownRow {
    pub kind: VatGroupKind,
    pub rate: Decimal,
    pub net: Decimal,
    pub vat: Decimal,
    pub gross: Decimal,
}

fn vat_group_kind(vat_rate: Decimal, is_cost_passthrough: bool) -> VatGroupKind {
    if vat_rate > Decimal::ZERO {
        VatGroupKind::Taxed
    } else if is_cost_passthrough {
        VatGroupKind::Passthrough
    } else {
        VatGroupKind::ZeroRated
    }
}

/// Adds one line's amounts to the row of its kind and rate.
fn add_to_vat_rows(
    rows: &mut Vec<VatBreakdownRow>,
    kind: VatGroupKind,
    rate: Decimal,
    (net, vat, gross): (Decimal, Decimal, Decimal),
) {
    let rate = rate.normalize();
    match rows
        .iter_mut()
        .find(|row| row.kind == kind && row.rate == rate)
    {
        Some(row) => {
            row.net += net;
            row.vat += vat;
            row.gross += gross;
        }
        None => rows.push(VatBreakdownRow {
            kind,
            rate,
            net,
            vat,
            gross,
        }),
    }
}

/// Rounds the summed rows to cents; taxed rates first, highest first.
fn finish_vat_rows(mut rows: Vec<VatBreakdownRow>) -> Vec<VatBreakdownRow> {
    for row in &mut rows {
        row.net = row.net.round_cents();
        row.vat = row.vat.round_cents();
        row.gross = row.gross.round_cents();
    }
    rows.sort_by(|left, right| {
        left.kind
            .cmp(&right.kind)
            .then_with(|| right.rate.cmp(&left.rate))
    });
    rows
}

/// Net, VAT and gross per rate, summed from the stored line amounts so the
/// rows add up to the invoice totals. Taxed rates come first, highest first.
pub(super) fn vat_breakdown(lines: &[InvoicePdfLineItem]) -> Vec<VatBreakdownRow> {
    let mut rows: Vec<VatBreakdownRow> = Vec::new();
    for line in lines {
        add_to_vat_rows(
            &mut rows,
            vat_group_kind(line.vat_rate_value, line.is_cost_passthrough),
            line.vat_rate_value,
            (line.line_net, line.line_vat, line.line_gross_value),
        );
    }
    finish_vat_rows(rows)
}

/// An advance invoice credited against a settlement invoice, as the
/// settlement invoice states it (§ 14 Abs. 5 Satz 2 UStG): the advance
/// invoice's number and date, and the net and VAT per rate of the amount
/// credited (the rows add up to it).
#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct DeductedAdvance {
    pub invoice_number: String,
    pub issue_date: NaiveDate,
    pub rows: Vec<VatBreakdownRow>,
}

/// Net, VAT and gross per rate that an advance invoice still charges once
/// its active credit notes are taken off: the VAT split the advance invoice
/// itself printed (a prepayment advance splits the prepayment over the
/// quote's VAT groups when it is created, see
/// `build_prepayment_advance_snapshot`).
pub(super) fn advance_vat_rows(
    line_items: &Value,
    credits: &[credit_notes::ExistingCredit],
) -> Vec<VatBreakdownRow> {
    let mut rows: Vec<VatBreakdownRow> = Vec::new();
    for line in credit_notes::creditable_lines(line_items, credits) {
        add_to_vat_rows(
            &mut rows,
            vat_group_kind(line.vat_rate, line.is_cost_passthrough),
            line.vat_rate,
            (
                line.net - line.credited_net,
                line.vat - line.credited_vat,
                line.gross - line.credited_gross,
            ),
        );
    }
    let mut rows = finish_vat_rows(rows);
    rows.retain(|row| row.gross > Decimal::ZERO);
    rows
}

/// The part of an advance's VAT rows that `amount` (gross) credits. The
/// whole advance keeps its rows exactly as invoiced. A part (an advance paid
/// only in part, or larger than what the settlement invoice asks for) takes
/// the same share of every row's gross and VAT, the share the advance
/// invoice's own payment is booked with (`invoice_cash_targets`); rounding
/// cents go to the first row that is not a pass-through cost, so the
/// pass-through share matches that booking exactly.
pub(super) fn deducted_advance_rows(
    advance_rows: &[VatBreakdownRow],
    amount: Decimal,
) -> Vec<VatBreakdownRow> {
    let amount = amount.round_cents();
    let total: Decimal = advance_rows.iter().map(|row| row.gross).sum();
    if amount <= Decimal::ZERO || total <= Decimal::ZERO {
        return Vec::new();
    }
    if amount >= total {
        return advance_rows.to_vec();
    }
    let share = |part: Decimal| (amount * part / total).round_cents();
    let mut rows = advance_rows
        .iter()
        .map(|row| {
            let (gross, vat) = (share(row.gross), share(row.vat));
            VatBreakdownRow {
                kind: row.kind,
                rate: row.rate,
                net: gross - vat,
                vat,
                gross,
            }
        })
        .collect::<Vec<_>>();
    let rest = amount - rows.iter().map(|row| row.gross).sum::<Decimal>();
    if !rest.is_zero() {
        let index = rows
            .iter()
            .position(|row| row.kind != VatGroupKind::Passthrough)
            .unwrap_or(0);
        rows[index].gross += rest;
        rows[index].net += rest;
    }
    rows.retain(|row| !row.gross.is_zero() || !row.vat.is_zero());
    rows
}

/// Advances credited against `invoice_id`, oldest advance invoice first, one
/// entry per advance invoice however often it was applied. Read through the
/// caller's connection, so a release renders exactly the advances it has
/// just credited.
pub(super) async fn load_deducted_advances(
    conn: &mut PgConnection,
    invoice_id: Uuid,
) -> Result<Vec<DeductedAdvance>, sqlx::Error> {
    let rows = sqlx::query(
        r#"SELECT SUM(allocation.amount_gross) AS amount_gross,
                  advance.id AS advance_invoice_id, advance.invoice_number,
                  advance.issued_at, advance.line_items,
                  advance.total_net, advance.total_vat, advance.total_gross
           FROM invoice_prepayment_allocations allocation
           JOIN invoices advance ON advance.id = allocation.advance_invoice_id
           WHERE allocation.target_invoice_id = $1
           GROUP BY advance.id
           ORDER BY advance.issued_at, advance.id"#,
    )
    .bind(invoice_id)
    .fetch_all(&mut *conn)
    .await?;
    let mut advances = Vec::with_capacity(rows.len());
    for row in rows {
        let mut line_items = row.try_get::<Value, _>("line_items")?;
        if line_items.as_array().is_none_or(Vec::is_empty) {
            // Early advance invoices carry no lines: their totals are one
            // group, the rate implied by their VAT and net.
            line_items = json!([{
                "line_net": row.try_get::<Decimal, _>("total_net")?.to_string(),
                "line_vat": row.try_get::<Decimal, _>("total_vat")?.to_string(),
                "line_gross": row.try_get::<Decimal, _>("total_gross")?.to_string(),
            }]);
        }
        let credits =
            credit_notes::load_active_credits(conn, row.try_get("advance_invoice_id")?).await?;
        let amount_gross = row.try_get::<Decimal, _>("amount_gross")?;
        advances.push(DeductedAdvance {
            invoice_number: row
                .try_get::<Option<String>, _>("invoice_number")?
                .unwrap_or_default(),
            issue_date: super::invoice_document_date(row.try_get::<DateTime<Utc>, _>("issued_at")?),
            rows: deducted_advance_rows(&advance_vat_rows(&line_items, &credits), amount_gross),
        });
    }
    Ok(advances)
}

/// The statutory reason printed for 0 % lines that are not pass-through
/// costs: the same classification the embedded e-invoice uses.
pub(super) fn zero_rate_exemption_note(lines: &[InvoicePdfLineItem]) -> Option<&'static str> {
    lines
        .iter()
        .filter(|line| !line.is_cost_passthrough && line.vat_rate_value <= Decimal::ZERO)
        .find_map(|line| zugferd::line_exemption_reason(line.vat_rate_value, false))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn party(first: &str, last: &str, street: Option<&str>) -> RecipientParty {
        RecipientParty {
            title: None,
            first_name: Some(first.to_string()),
            last_name: Some(last.to_string()),
            email: Some(format!("{first}@example.test").to_lowercase()),
            street: street.map(ToOwned::to_owned),
            zip: street.map(|_| "80331".to_string()),
            city: street.map(|_| "München".to_string()),
            country: street.map(|_| "Deutschland".to_string()),
            residence_country: None,
        }
    }

    #[test]
    fn patient_is_the_recipient_without_a_payer() {
        let source = RecipientSource {
            patient: RecipientParty {
                title: Some("Dr.".to_string()),
                ..party("Anna", "Muster", Some("Hauptstraße 1"))
            },
            ..RecipientSource::default()
        };
        let recipient = resolve_invoice_recipient(&source);
        assert_eq!(recipient.name, "Dr. Anna Muster");
        assert!(!recipient.is_payer);
        assert_eq!(
            recipient.address_lines(),
            vec!["Hauptstraße 1", "80331 München", "Deutschland"]
        );
        assert_eq!(recipient.country_code.as_deref(), Some("DE"));
        assert!(recipient.has_postal_address());
    }

    #[test]
    fn contact_payer_never_inherits_the_patient_address() {
        let source = RecipientSource {
            patient: party("Anna", "Muster", Some("Hauptstraße 1")),
            payer_contact_name: Some("Ivan Payer".to_string()),
            ..RecipientSource::default()
        };
        let recipient = resolve_invoice_recipient(&source);
        assert_eq!(recipient.name, "Ivan Payer");
        assert!(recipient.is_payer);
        assert!(recipient.address_lines().is_empty());
        assert_eq!(recipient.country_code, None);
        assert!(!recipient.has_postal_address());

        let with_address = RecipientSource {
            payer_street: Some("Kyivska 5".to_string()),
            payer_zip: Some("01001".to_string()),
            payer_city: Some("Kyiv".to_string()),
            payer_country: Some("Ukraine".to_string()),
            payer_contact_email: Some("ivan@example.test".to_string()),
            ..source
        };
        let recipient = resolve_invoice_recipient(&with_address);
        assert_eq!(
            recipient.address_lines(),
            vec!["Kyivska 5", "01001 Kyiv", "Ukraine"]
        );
        assert_eq!(recipient.country_code.as_deref(), Some("UA"));
        assert_eq!(recipient.email.as_deref(), Some("ivan@example.test"));
    }

    #[test]
    fn relative_patient_payer_brings_their_own_record_address() {
        let source = RecipientSource {
            patient: party("Anna", "Muster", Some("Hauptstraße 1")),
            payer_relation_id: Some(Uuid::new_v4()),
            relation_name: Some("Father".to_string()),
            relation_patient: Some(party("Otto", "Muster", Some("Nebenweg 2"))),
            ..RecipientSource::default()
        };
        let recipient = resolve_invoice_recipient(&source);
        assert_eq!(recipient.name, "Otto Muster");
        assert_eq!(recipient.street.as_deref(), Some("Nebenweg 2"));
        assert_eq!(recipient.email.as_deref(), Some("otto@example.test"));

        // A relative without a patient record is named by the relation.
        let free_relation = RecipientSource {
            relation_patient: None,
            ..source
        };
        let recipient = resolve_invoice_recipient(&free_relation);
        assert_eq!(recipient.name, "Father");
        assert!(recipient.address_lines().is_empty());
    }

    fn line(rate: &str, passthrough: bool, net: &str, vat: &str) -> InvoicePdfLineItem {
        let net = Decimal::from_str_exact(net).unwrap();
        let vat = Decimal::from_str_exact(vat).unwrap();
        InvoicePdfLineItem {
            description: "Line".to_string(),
            quantity: "1".to_string(),
            unit_price: net.to_string(),
            vat_rate: rate.to_string(),
            vat_rate_value: Decimal::from_str_exact(rate).unwrap(),
            is_cost_passthrough: passthrough,
            line_gross: (net + vat).to_string(),
            line_net: net,
            line_vat: vat,
            line_gross_value: net + vat,
        }
    }

    #[test]
    fn breakdown_sums_lines_per_rate_and_orders_taxed_rates_first() {
        let lines = vec![
            line("0", true, "200", "0"),
            line("7", false, "10", "0.70"),
            line("19", false, "100", "19"),
            line("0", false, "50", "0"),
            line("19", false, "20.5", "3.90"),
        ];
        let rows = vat_breakdown(&lines);
        let summary = rows
            .iter()
            .map(|row| {
                format!(
                    "{:?} {}% {} {} {}",
                    row.kind,
                    row.rate,
                    crate::money::cents_string(row.net),
                    crate::money::cents_string(row.vat),
                    crate::money::cents_string(row.gross)
                )
            })
            .collect::<Vec<_>>();
        assert_eq!(
            summary,
            vec![
                "Taxed 19% 120.50 22.90 143.40",
                "Taxed 7% 10.00 0.70 10.70",
                "ZeroRated 0% 50.00 0.00 50.00",
                "Passthrough 0% 200.00 0.00 200.00",
            ]
        );
        assert_eq!(
            zero_rate_exemption_note(&lines),
            Some("Steuerfreie Heilbehandlung nach § 4 Nr. 14 UStG")
        );
        // Pass-through lines alone carry no § 4 note.
        assert_eq!(zero_rate_exemption_note(&lines[..1]), None);
    }

    fn summary(rows: &[VatBreakdownRow]) -> Vec<String> {
        rows.iter()
            .map(|row| {
                format!(
                    "{:?} {}% {} {} {}",
                    row.kind,
                    row.rate,
                    crate::money::cents_string(row.net),
                    crate::money::cents_string(row.vat),
                    crate::money::cents_string(row.gross)
                )
            })
            .collect()
    }

    /// Prepayment advance of the QA walkthrough: 1,000 over a quote with a
    /// 19 % group, medical care and pass-through costs.
    fn walkthrough_advance_lines() -> Value {
        json!([
            {
                "description": "Anzahlung – Anteil 0 % USt.", "quantity": "1",
                "unit_price": "336.63", "vat_rate": "0", "is_cost_passthrough": false,
                "line_net": "336.63", "line_vat": "0", "line_gross": "336.63"
            },
            {
                "description": "Anzahlung – Anteil 19 % USt.", "quantity": "1",
                "unit_price": "314.98", "vat_rate": "19", "is_cost_passthrough": false,
                "line_net": "314.98", "line_vat": "59.85", "line_gross": "374.83"
            },
            {
                "description": "Anzahlung – Anteil Auslagen", "quantity": "1",
                "unit_price": "288.54", "vat_rate": "0", "is_cost_passthrough": true,
                "line_net": "288.54", "line_vat": "0", "line_gross": "288.54"
            }
        ])
    }

    #[test]
    fn a_fully_credited_advance_keeps_the_vat_split_it_was_invoiced_with() {
        let advance = advance_vat_rows(&walkthrough_advance_lines(), &[]);
        let expected = vec![
            "Taxed 19% 314.98 59.85 374.83",
            "ZeroRated 0% 336.63 0.00 336.63",
            "Passthrough 0% 288.54 0.00 288.54",
        ];
        assert_eq!(summary(&advance), expected);
        assert_eq!(
            summary(&deducted_advance_rows(&advance, Decimal::new(1000, 0))),
            expected
        );
        assert!(deducted_advance_rows(&advance, Decimal::ZERO).is_empty());
    }

    #[test]
    fn a_partly_credited_advance_takes_the_same_share_of_every_row() {
        // Only 400 of the 1,000 advance was paid, so only 400 is credited:
        // 40 % of every row's gross and VAT, as the payment was booked.
        let advance = advance_vat_rows(&walkthrough_advance_lines(), &[]);
        let rows = deducted_advance_rows(&advance, Decimal::new(400, 0));
        assert_eq!(
            summary(&rows),
            vec![
                "Taxed 19% 125.99 23.94 149.93",
                "ZeroRated 0% 134.65 0.00 134.65",
                "Passthrough 0% 115.42 0.00 115.42",
            ]
        );
        // 1.50: the shares add up to 1.49; the cent goes to the first row
        // that is not a pass-through cost.
        let rows = deducted_advance_rows(&advance, Decimal::new(150, 2));
        assert_eq!(
            summary(&rows),
            vec![
                "Taxed 19% 0.48 0.09 0.57",
                "ZeroRated 0% 0.50 0.00 0.50",
                "Passthrough 0% 0.43 0.00 0.43",
            ]
        );
    }

    #[test]
    fn credit_notes_on_the_advance_leave_their_rate_out_of_the_deduction() {
        // A credit note took 100 gross off the 19 % share of the advance.
        let credit = credit_notes::ExistingCredit {
            vat: Decimal::new(1597, 2),
            gross: Decimal::new(100, 0),
            lines: Some(vec![credit_notes::CreditNoteLine {
                invoice_line_index: 1,
                description: "Anzahlung – Anteil 19 % USt.".to_string(),
                quantity: None,
                unit_price: None,
                vat_rate: Decimal::new(19, 0),
                is_cost_passthrough: false,
                net: Decimal::new(8403, 2),
                vat: Decimal::new(1597, 2),
                gross: Decimal::new(100, 0),
            }]),
        };
        let advance = advance_vat_rows(&walkthrough_advance_lines(), &[credit]);
        assert_eq!(
            summary(&advance),
            vec![
                "Taxed 19% 230.95 43.88 274.83",
                "ZeroRated 0% 336.63 0.00 336.63",
                "Passthrough 0% 288.54 0.00 288.54",
            ]
        );
        // A fully credited line drops out.
        let whole_line = credit_notes::ExistingCredit {
            vat: Decimal::ZERO,
            gross: Decimal::new(28854, 2),
            lines: Some(vec![credit_notes::CreditNoteLine {
                invoice_line_index: 2,
                description: String::new(),
                quantity: None,
                unit_price: None,
                vat_rate: Decimal::ZERO,
                is_cost_passthrough: true,
                net: Decimal::new(28854, 2),
                vat: Decimal::ZERO,
                gross: Decimal::new(28854, 2),
            }]),
        };
        let advance = advance_vat_rows(&walkthrough_advance_lines(), &[whole_line]);
        assert_eq!(advance.len(), 2);
        assert!(
            advance
                .iter()
                .all(|row| row.kind != VatGroupKind::Passthrough)
        );
    }

    #[test]
    fn an_advance_without_lines_is_one_group_at_its_implied_rate() {
        let rows = advance_vat_rows(
            &json!([{ "line_net": "100.00", "line_vat": "19.00", "line_gross": "119.00" }]),
            &[],
        );
        assert_eq!(summary(&rows), vec!["Taxed 19% 100.00 19.00 119.00"]);
    }
}
