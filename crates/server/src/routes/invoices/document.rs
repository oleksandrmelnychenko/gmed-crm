//! Content of the printed invoice beyond the stored invoice row: who receives
//! it, when the services were rendered and how the amounts split by VAT rate
//! (§ 14 Abs. 4 Nr. 1, 6 and 8 UStG).
//!
//! The recipient is resolved once here and used by both the printed invoice
//! and the ZUGFeRD buyer, so the visible document and the embedded XML cannot
//! name different parties.

use chrono::NaiveDate;
use rust_decimal::Decimal;
use serde_json::{Value, json};
use sqlx::{PgConnection, Row, postgres::PgRow};
use uuid::Uuid;

use super::{InvoicePdfLineItem, zugferd};
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

/// Net, VAT and gross per rate, summed from the stored line amounts so the
/// rows add up to the invoice totals. Taxed rates come first, highest first.
pub(super) fn vat_breakdown(lines: &[InvoicePdfLineItem]) -> Vec<VatBreakdownRow> {
    let mut rows: Vec<VatBreakdownRow> = Vec::new();
    for line in lines {
        let kind = if line.vat_rate_value > Decimal::ZERO {
            VatGroupKind::Taxed
        } else if line.is_cost_passthrough {
            VatGroupKind::Passthrough
        } else {
            VatGroupKind::ZeroRated
        };
        let rate = line.vat_rate_value.normalize();
        match rows
            .iter_mut()
            .find(|row| row.kind == kind && row.rate == rate)
        {
            Some(row) => {
                row.net += line.line_net;
                row.vat += line.line_vat;
                row.gross += line.line_gross_value;
            }
            None => rows.push(VatBreakdownRow {
                kind,
                rate,
                net: line.line_net,
                vat: line.line_vat,
                gross: line.line_gross_value,
            }),
        }
    }
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
}
