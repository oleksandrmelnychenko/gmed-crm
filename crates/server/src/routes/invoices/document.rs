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

/// Select list naming the recipient: the frozen snapshot of a released
/// invoice, else resolved live by `invoice_recipient_resolve` (the database
/// function the release snapshot is taken with). Needs `invoices i`.
pub(super) const RECIPIENT_COLUMNS: &str = r#"
    COALESCE(i.recipient_snapshot, invoice_recipient_resolve(
        i.patient_id, i.payer_patient_id, i.payer_patient_relation_id,
        i.payer_contact_name, i.payer_contact_email,
        i.payer_address_street, i.payer_address_zip, i.payer_address_city,
        i.payer_address_country
    )) AS rcpt_recipient,
    i.recipient_snapshot IS NOT NULL AS rcpt_frozen
"#;

/// The party the invoice is addressed to.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub(crate) struct InvoiceRecipient {
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
    /// `patient`, `relation`, `payer_patient` or `contact`.
    pub kind: String,
    /// Read from the snapshot taken at release.
    pub frozen: bool,
    /// The Leistungsempfänger (contracting party) when the invoice is
    /// addressed to someone else, e.g. a Kostenübernehmer.
    pub service_recipient_name: Option<String>,
    /// USt-IdNr. and Steuernummer of the recipient as staff added them to
    /// the patient's payer declaration (section 7 of the lead's form): a
    /// draft reads them live, the release freezes them in the snapshot.
    pub vat_id: Option<String>,
    pub tax_number: Option<String>,
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

/// Which postal address parts a recipient lacks for § 14 Abs. 4 Nr. 1 UStG
/// and the e-invoice buyer address (BG-8 with country code BT-55).
pub(crate) fn missing_address_parts(recipient: &InvoiceRecipient) -> Vec<&'static str> {
    let mut missing = Vec::new();
    if recipient.name.trim().is_empty() {
        missing.push("name");
    }
    if recipient.street.is_none() {
        missing.push("street");
    }
    if recipient.zip.is_none() {
        missing.push("zip");
    }
    if recipient.city.is_none() {
        missing.push("city");
    }
    if recipient.country_code.is_none() {
        missing.push("country");
    }
    missing
}

impl InvoiceRecipient {
    /// Reads a recipient as built by `invoice_recipient_resolve` (and stored
    /// in `recipient_snapshot`).
    pub fn from_json(value: &Value, frozen: bool) -> Self {
        let text = |key: &str| clean(value.get(key).and_then(Value::as_str));
        let country = text("country");
        Self {
            name: text("name").unwrap_or_default(),
            street: text("street"),
            zip: text("zip"),
            city: text("city"),
            country_code: country_code(country.as_deref(), text("residence_country").as_deref()),
            country,
            email: text("email"),
            is_payer: value
                .get("is_payer")
                .and_then(Value::as_bool)
                .unwrap_or(false),
            kind: text("kind").unwrap_or_else(|| "patient".to_string()),
            frozen,
            service_recipient_name: text("service_recipient_name"),
            vat_id: text("vat_id"),
            tax_number: text("tax_number"),
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

    /// Full postal address including a country an e-invoice can encode.
    pub fn has_complete_address(&self) -> bool {
        missing_address_parts(self).is_empty()
    }

    pub fn to_json(&self) -> Value {
        json!({
            "name": self.name,
            "street": self.street,
            "zip": self.zip,
            "city": self.city,
            "country": self.country,
            "email": self.email,
            "is_payer": self.is_payer,
            "kind": self.kind,
            "frozen": self.frozen,
            "service_recipient_name": self.service_recipient_name,
            "vat_id": self.vat_id,
            "tax_number": self.tax_number,
            "has_postal_address": self.has_postal_address(),
            "has_complete_address": self.has_complete_address(),
            "missing_address_parts": missing_address_parts(self),
        })
    }
}

/// Reads the recipient selected with [`RECIPIENT_COLUMNS`] as stored: the
/// snapshot of a released invoice (dunning letters), or the bare live
/// recipient. The printed draft reads it with [`read_recipient`].
pub(super) fn recipient_from_row(row: &PgRow) -> InvoiceRecipient {
    let value = row
        .try_get::<Option<Value>, _>("rcpt_recipient")
        .unwrap_or_default()
        .unwrap_or(Value::Null);
    let frozen = row.try_get::<bool, _>("rcpt_frozen").unwrap_or(false);
    InvoiceRecipient::from_json(&value, frozen)
}

/// Reads the recipient selected with [`RECIPIENT_COLUMNS`] the way the
/// invoice names it: a released invoice's snapshot as frozen; a draft's live
/// recipient with what the patient's payer declaration adds (the e-mail for
/// invoices, USt-IdNr. and Steuernummer,
/// [`super::payer::add_declared_recipient_details`]) and the
/// Leistungsempfänger line — what its release will freeze.
pub(super) async fn read_recipient(
    conn: &mut PgConnection,
    row: &PgRow,
    patient_id: Uuid,
    order_id: Option<Uuid>,
) -> Result<InvoiceRecipient, sqlx::Error> {
    let mut value = row
        .try_get::<Option<Value>, _>("rcpt_recipient")
        .unwrap_or_default()
        .unwrap_or(Value::Null);
    if row.try_get::<bool, _>("rcpt_frozen").unwrap_or(false) {
        return Ok(InvoiceRecipient::from_json(&value, true));
    }
    super::payer::add_declared_recipient_details(conn, &mut value, patient_id, order_id).await?;
    let mut recipient = InvoiceRecipient::from_json(&value, false);
    if recipient.is_payer {
        recipient.service_recipient_name =
            live_service_recipient_name(conn, &value, patient_id, order_id).await?;
    }
    Ok(recipient)
}

/// The live recipient of an invoice as JSON (before release), with what the
/// patient's payer declaration adds to it.
pub(super) async fn resolve_live_recipient(
    conn: &mut PgConnection,
    invoice_id: Uuid,
) -> Result<Value, sqlx::Error> {
    let Some(row) = sqlx::query(
        r#"SELECT i.patient_id, i.order_id, invoice_recipient_resolve(
               i.patient_id, i.payer_patient_id, i.payer_patient_relation_id,
               i.payer_contact_name, i.payer_contact_email,
               i.payer_address_street, i.payer_address_zip, i.payer_address_city,
               i.payer_address_country) AS recipient
           FROM invoices i WHERE i.id = $1"#,
    )
    .bind(invoice_id)
    .fetch_optional(&mut *conn)
    .await?
    else {
        return Ok(Value::Null);
    };
    let mut recipient = row
        .try_get::<Option<Value>, _>("recipient")?
        .unwrap_or(Value::Null);
    super::payer::add_declared_recipient_details(
        conn,
        &mut recipient,
        row.try_get("patient_id")?,
        row.try_get("order_id")?,
    )
    .await?;
    Ok(recipient)
}

/// Loads the recipient of one invoice: the frozen one of a released invoice,
/// the live one of a draft as its release will freeze it ([`read_recipient`]).
pub(super) async fn load_invoice_recipient(
    conn: &mut PgConnection,
    invoice_id: Uuid,
) -> Result<Option<InvoiceRecipient>, sqlx::Error> {
    let sql = format!(
        "SELECT {RECIPIENT_COLUMNS}, i.patient_id, i.order_id FROM invoices i WHERE i.id = $1"
    );
    let Some(row) = sqlx::query(&sql)
        .bind(invoice_id)
        .fetch_optional(&mut *conn)
        .await?
    else {
        return Ok(None);
    };
    read_recipient(
        conn,
        &row,
        row.try_get::<Uuid, _>("patient_id").unwrap_or_default(),
        row.try_get::<Option<Uuid>, _>("order_id")
            .unwrap_or_default(),
    )
    .await
    .map(Some)
}

/// The contracting party's name when it is not the invoice recipient — and
/// not the recipient's own name either: the party at another address is
/// still the party (the lead's "invoice to another address"), so it is not
/// named a second time as Leistungsempfänger.
pub(super) async fn live_service_recipient_name(
    conn: &mut PgConnection,
    recipient: &Value,
    patient_id: Uuid,
    order_id: Option<Uuid>,
) -> Result<Option<String>, sqlx::Error> {
    let party = crate::services::contracting_party::resolve(
        conn,
        patient_id,
        order_id,
        None,
        crate::app_time::today(),
    )
    .await?;
    let named = super::payer::recipient_is_named_party(
        recipient.get("name").and_then(Value::as_str),
        &party,
    );
    Ok((!party.is_recipient(recipient) && !named).then(|| party.debtor_name()))
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

    #[test]
    fn recipient_reads_the_resolved_json_and_names_missing_address_parts() {
        let recipient = InvoiceRecipient::from_json(
            &json!({
                "kind": "relation",
                "is_payer": true,
                "name": "Max Muster",
                "street": "Nebenweg 2",
                "zip": "80331",
                "city": "München",
                "country": "Deutschland",
                "email": "max@example.test",
            }),
            true,
        );
        assert!(recipient.is_payer && recipient.frozen);
        assert_eq!(recipient.country_code.as_deref(), Some("DE"));
        assert_eq!(
            recipient.address_lines(),
            vec!["Nebenweg 2", "80331 München", "Deutschland"]
        );
        assert!(recipient.has_complete_address());

        let contact = InvoiceRecipient::from_json(
            &json!({ "kind": "contact", "is_payer": true, "name": "Ivan Payer", "street": " " }),
            false,
        );
        assert_eq!(
            missing_address_parts(&contact),
            vec!["street", "zip", "city", "country"]
        );
        assert!(!contact.has_postal_address());
        assert_eq!(
            InvoiceRecipient::from_json(&Value::Null, false).kind,
            "patient"
        );
    }

    fn line(rate: &str, passthrough: bool, net: &str, vat: &str) -> InvoicePdfLineItem {
        let net = Decimal::from_str_exact(net).unwrap();
        let vat = Decimal::from_str_exact(vat).unwrap();
        InvoicePdfLineItem {
            description: "Line".to_string(),
            comment: None,
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
