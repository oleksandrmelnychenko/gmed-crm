//! E-invoice (ZUGFeRD / Factur-X, EN 16931) of correction documents: the
//! Rechnungskorrektur (credit note), its reversal and the Stornorechnung
//! (owner decision 2026-11-17).
//!
//! The XML states what the printed correction states, from the same context:
//!
//! * credit note and Stornorechnung: type 381 (credit note) with positive
//!   amounts — the type carries the direction, the PDF prints them negative;
//!   the reversal of a credit note owes the amount again: 380 (invoice);
//! * the credited lines with their VAT category and rate as on the corrected
//!   invoice, net and VAT per line as stored;
//! * BG-3: the corrected invoice (the reversed credit note for a reversal),
//!   then every advance invoice whose deduction the document releases;
//! * released advances (credit note or Storno of a final): their gross in
//!   BT-113 and BT-115 = what the PDF prints as «Verbleibender Betrag»
//!   (without its sign), net and VAT per rate in a note;
//! * BT-20 (payment terms) = the statement the PDF closes with: a correction
//!   has no due date.
//!
//! A correction is embedded only when every line carries a VAT rate the
//! document can state (a whole percentage that gives the line's VAT): legacy
//! pro-rata credit notes without lines, and the summary line of a Storno of an
//! old invoice whose lines did not add up, carry a blended rate and stay
//! PDF-only.

use chrono::{DateTime, Utc};
use rust_decimal::Decimal;

use super::credit_note_pdf::{self, CreditNotePdfContext, STORNO_DOCUMENT, format_money};
use super::credit_notes::CreditNoteLine;
use super::zugferd::{self, EInvoice, EInvoiceLine, EInvoiceParty, EInvoiceReference};
use crate::money::{round_cents, vat_amount};

/// Missing-requirement key: a line without a VAT rate the XML can state.
pub(super) const MISSING_LINE_VAT_RATE: &str = "line_vat_rate";

fn is_reversal(context: &CreditNotePdfContext) -> bool {
    context.transaction_type == "reversal"
}

fn document_kind(context: &CreditNotePdfContext) -> &'static str {
    if context.transaction_type == STORNO_DOCUMENT {
        zugferd::STORNO
    } else if is_reversal(context) {
        zugferd::CREDIT_NOTE_REVERSAL
    } else {
        zugferd::CREDIT_NOTE
    }
}

/// A rate the XML can state for the line: a whole percentage whose VAT is
/// the line's VAT (per-line rounding, a cent of tolerance for partial
/// credits). A blended rate derived from totals is not one.
fn states_its_rate(line: &CreditNoteLine) -> bool {
    let rate = line.vat_rate.normalize();
    rate >= Decimal::ZERO
        && rate.fract().is_zero()
        && (vat_amount(line.net, rate) - round_cents(line.vat)).abs() <= Decimal::new(2, 2)
}

/// The advances the document releases (none for a reversal).
fn released_advances(context: &CreditNotePdfContext) -> &[super::document::DeductedAdvance] {
    if is_reversal(context) {
        &[]
    } else {
        &context.deducted_advances
    }
}

fn released_totals(context: &CreditNotePdfContext) -> (Decimal, Decimal, Decimal) {
    released_advances(context)
        .iter()
        .flat_map(|advance| advance.rows.iter())
        .fold(
            (Decimal::ZERO, Decimal::ZERO, Decimal::ZERO),
            |(net, vat, gross), row| (net + row.net, vat + row.vat, gross + row.gross),
        )
}

/// The released advances as the PDF lists them, in German like the other
/// texts of the XML: each advance with net, VAT and gross per rate, then the
/// «Verbleibender Betrag» row exactly as printed (negative).
fn released_advances_note(context: &CreditNotePdfContext) -> Option<String> {
    let advances = released_advances(context);
    if advances.is_empty() {
        return None;
    }
    let currency = context.currency.as_str();
    let amounts = |(net, vat, gross): (Decimal, Decimal, Decimal)| {
        format!(
            "{} {}, {} {}, {} {}",
            credit_note_pdf::label("de", "net"),
            format_money(net, currency),
            credit_note_pdf::label("de", "vat_amount"),
            format_money(vat, currency),
            credit_note_pdf::label("de", "gross"),
            format_money(gross, currency)
        )
    };
    let mut parts = advances
        .iter()
        .map(|advance| {
            let rows = advance
                .rows
                .iter()
                .map(|row| {
                    format!(
                        "{}: {}",
                        super::invoice_pdf_vat_group_label("de", row),
                        amounts((row.net, row.vat, row.gross))
                    )
                })
                .collect::<Vec<_>>()
                .join("; ");
            format!(
                "{}: {rows}",
                super::invoice_pdf_advance_reference("de", advance)
            )
        })
        .collect::<Vec<_>>();
    let released = released_totals(context);
    parts.push(format!(
        "{}: {}",
        super::invoice_pdf_label("de", "remaining_amount"),
        amounts((
            released.0 - context.amount_net,
            released.1 - context.amount_vat,
            released.2 - context.amount_gross,
        ))
    ));
    let (heading, statement) = if context.transaction_type == STORNO_DOCUMENT {
        ("storno_advances_heading", "storno_advances_statement")
    } else {
        ("credit_advances_heading", "credit_advances_statement")
    };
    Some(format!(
        "{}: {}. {}",
        credit_note_pdf::label("de", heading),
        parts.join(". "),
        credit_note_pdf::label("de", statement)
    ))
}

fn line(line: &CreditNoteLine) -> EInvoiceLine {
    let net = round_cents(line.net);
    // Quantity × unit price where they give the credited net (a whole line);
    // a partial credit is one unit of its amount.
    let (quantity, unit_net) = match (line.quantity, line.unit_price) {
        (Some(quantity), Some(price))
            if quantity > Decimal::ZERO && round_cents(quantity * price) == net =>
        {
            (quantity, price)
        }
        _ => (Decimal::ONE, net),
    };
    EInvoiceLine {
        name: line.description.trim().to_string(),
        note: None,
        quantity,
        unit_net,
        line_net: net,
        line_vat: Some(round_cents(line.vat)),
        vat_rate: line.vat_rate.normalize(),
        is_cost_passthrough: line.is_cost_passthrough,
        // A credited part is one piece; a whole line keeps no unit label here.
        unit_code: "C62",
        // A credited part is one unit of its (already discounted) amount.
        discount: None,
    }
}

/// The correction as an EN 16931 document. Check
/// [`missing_requirements`] before building the XML.
pub(super) fn correction_einvoice(context: &CreditNotePdfContext) -> EInvoice {
    let third_party_payer = context
        .recipient
        .as_ref()
        .is_some_and(|recipient| recipient.is_third_party_payer());
    let (street, postcode, city) =
        zugferd::split_german_address(context.agency.address.as_deref().unwrap_or_default());
    let buyer = match &context.recipient {
        Some(recipient) => EInvoiceParty {
            name: recipient.name.clone(),
            address_line: recipient.street.clone(),
            postcode: recipient.zip.clone(),
            city: recipient.city.clone(),
            country_code: recipient.country_code.clone(),
            email: recipient.email.clone(),
            vat_id: zugferd::buyer_vat_identifier(recipient.vat_id.as_deref()),
            tax_number: None,
        },
        None => EInvoiceParty {
            name: context.patient_name.clone(),
            ..EInvoiceParty::default()
        },
    };
    let mut references = Vec::new();
    if is_reversal(context)
        && let (Some(number), Some(date)) = (
            context.reversed_document_number.as_ref(),
            context.reversed_issued_on,
        )
    {
        references.push(EInvoiceReference {
            number: number.clone(),
            issue_date: date,
        });
    }
    references.push(EInvoiceReference {
        number: context.invoice_number.clone(),
        issue_date: context.invoice_date,
    });
    references.extend(
        released_advances(context)
            .iter()
            .map(|advance| EInvoiceReference {
                number: advance.invoice_number.clone(),
                issue_date: advance.issue_date,
            }),
    );
    let statement = if context.transaction_type == STORNO_DOCUMENT {
        "storno_statement"
    } else if is_reversal(context) {
        "reversal_statement"
    } else {
        "credit_statement"
    };
    EInvoice {
        number: context.document_number.clone(),
        invoice_type: document_kind(context).to_string(),
        issue_date: context.issued_on,
        due_date: None,
        service_period: None,
        service_note: None,
        currency: context.currency.clone(),
        order_number: context
            .order_number
            .clone()
            .filter(|value| !value.trim().is_empty()),
        // Staff write the reason in their own words, it may name the
        // treatment: a third party who pays does not read it (as on the PDF).
        note: (!third_party_payer && !context.reason.trim().is_empty()).then(|| {
            format!(
                "{}: {}",
                credit_note_pdf::label("de", "reason"),
                context.reason.trim()
            )
        }),
        seller: EInvoiceParty {
            name: context.agency.name.clone(),
            address_line: street,
            postcode,
            city,
            country_code: context.agency_country_code.clone(),
            email: context.agency.email.clone(),
            vat_id: context.vat_id.clone(),
            tax_number: context.tax_number.clone(),
        },
        buyer,
        lines: context
            .lines
            .as_deref()
            .unwrap_or_default()
            .iter()
            .map(line)
            .collect(),
        total_gross: round_cents(context.amount_gross),
        prepaid_amount: round_cents(released_totals(context).2),
        prepaid_invoices: references,
        prepayment_note: released_advances_note(context),
        received_note: None,
        bank_iban: None,
        bank_bic: None,
        bank_holder: None,
        payment_terms: Some(credit_note_pdf::label("de", statement).to_string()),
    }
}

/// Why no valid EN 16931 document can be built for this correction.
pub(super) fn missing_requirements(
    context: &CreditNotePdfContext,
    invoice: &EInvoice,
) -> Vec<&'static str> {
    let mut missing = zugferd::missing_requirements(invoice);
    let stated = context
        .lines
        .as_deref()
        .is_some_and(|lines| !lines.is_empty() && lines.iter().all(states_its_rate));
    if !stated {
        missing.push(MISSING_LINE_VAT_RATE);
    }
    missing
}

/// Time stamp of the embedded file: noon UTC of the issue day, so the same
/// document always embeds the same way.
fn issued_at(context: &CreditNotePdfContext) -> DateTime<Utc> {
    context
        .issued_on
        .and_hms_opt(12, 0, 0)
        .unwrap_or_default()
        .and_utc()
}

/// The printed correction, as a ZUGFeRD hybrid (PDF/A-3 with `factur-x.xml`)
/// when the e-invoice can be built; otherwise the PDF alone.
pub(super) fn render_correction_pdf(
    context: &CreditNotePdfContext,
) -> Result<Vec<u8>, &'static str> {
    let pdf = credit_note_pdf::build_credit_note_pdf(context)?;
    let invoice = correction_einvoice(context);
    let missing = missing_requirements(context, &invoice);
    if !missing.is_empty() {
        tracing::warn!(
            invoice_id = %context.invoice_id,
            document_id = %context.credit_note_id,
            ?missing,
            "correction document stored without zugferd xml"
        );
        return Ok(pdf);
    }
    let xml = zugferd::build_cii_xml(&invoice);
    match zugferd::embed_xml_in_pdf(&pdf, &xml, &context.document_number, issued_at(context)) {
        Ok(hybrid) => Ok(hybrid),
        Err(error) => {
            tracing::error!(%error, document_id = %context.credit_note_id, "embed correction zugferd xml");
            Ok(pdf)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::super::document::{
        DeductedAdvance, InvoiceRecipient, VatBreakdownRow, VatGroupKind,
    };
    use super::*;
    use crate::services::patient_pdf_brand::PatientPdfBrand;
    use chrono::NaiveDate;
    use std::str::FromStr;
    use uuid::Uuid;

    fn dec(value: &str) -> Decimal {
        Decimal::from_str(value).unwrap()
    }

    fn day(month: u32, day: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(2026, month, day).unwrap()
    }

    fn credit_line(
        description: &str,
        quantity_price: Option<(&str, &str)>,
        (rate, passthrough): (&str, bool),
        net: &str,
        vat: &str,
    ) -> CreditNoteLine {
        CreditNoteLine {
            invoice_line_index: 0,
            description: description.to_string(),
            quantity: quantity_price.map(|(quantity, _)| dec(quantity)),
            unit_price: quantity_price.map(|(_, price)| dec(price)),
            vat_rate: dec(rate),
            is_cost_passthrough: passthrough,
            net: dec(net),
            vat: dec(vat),
            gross: dec(net) + dec(vat),
        }
    }

    /// Rechnungskorrektur of a patient invoice: one interpreter line in full
    /// at 19 %, part of a hotel cost passed through.
    fn credit_note() -> CreditNotePdfContext {
        let lines = vec![
            credit_line(
                "Dolmetscherleistung",
                Some(("2", "60")),
                ("19", false),
                "120.00",
                "22.80",
            ),
            credit_line("Hotel", None, ("0", true), "160.50", "0.00"),
        ];
        CreditNotePdfContext {
            credit_note_id: Uuid::nil(),
            invoice_id: Uuid::nil(),
            patient_id: Uuid::nil(),
            transaction_type: "credit_note".to_string(),
            document_number: "CN-20261117-0101".to_string(),
            reversed_document_number: None,
            reversed_issued_on: None,
            reason: "Hotelnacht nicht in Anspruch genommen".to_string(),
            issued_on: day(11, 17),
            currency: "EUR".to_string(),
            amount_net: dec("280.50"),
            amount_vat: dec("22.80"),
            amount_gross: dec("303.30"),
            lines: Some(lines),
            credit_portal_visible: true,
            invoice_number: "INV-20261101-0042".to_string(),
            invoice_date: day(11, 1),
            invoice_status: "sent".to_string(),
            invoice_portal_visible: true,
            hide_amounts_from_patient: false,
            pdf_visible_to_patient: true,
            order_number: Some("A-20261020-0007".to_string()),
            patient_pid: "P-0042".to_string(),
            patient_name: "Anna Muster".to_string(),
            language: "de".to_string(),
            agency: PatientPdfBrand {
                name: "GMED – Agentur für Patientenbetreuung".to_string(),
                address: Some("Musterstraße 1, 80331 München".to_string()),
                email: Some("billing@example.com".to_string()),
                ..PatientPdfBrand::default()
            },
            vat_id: Some("DE123456789".to_string()),
            tax_number: None,
            recipient: Some(InvoiceRecipient {
                name: "Anna Muster".to_string(),
                street: Some("Hauptstraße 5".to_string()),
                zip: Some("10115".to_string()),
                city: Some("Berlin".to_string()),
                country: Some("Deutschland".to_string()),
                country_code: Some("DE".to_string()),
                kind: "patient".to_string(),
                ..Default::default()
            }),
            deducted_advances: Vec::new(),
            agency_country_code: Some("DE".to_string()),
        }
    }

    fn advance_1000() -> DeductedAdvance {
        let row = |kind, rate: &str, net: &str, vat: &str| VatBreakdownRow {
            kind,
            rate: dec(rate),
            net: dec(net),
            vat: dec(vat),
            gross: dec(net) + dec(vat),
        };
        DeductedAdvance {
            invoice_number: "INV-20261020-0031".to_string(),
            issue_date: day(10, 20),
            rows: vec![
                row(VatGroupKind::Taxed, "19", "314.98", "59.85"),
                row(VatGroupKind::ZeroRated, "0", "625.17", "0"),
            ],
        }
    }

    /// Rechnungskorrektur of a Schlussrechnung that credits the organisation
    /// fee, more than the final still asked: the advance deduction is
    /// released (fix-83).
    fn credit_note_releasing_advances() -> CreditNotePdfContext {
        let mut context = credit_note();
        context.document_number = "CN-20261117-0102".to_string();
        context.invoice_number = "INV-20261028-0050".to_string();
        context.invoice_date = day(10, 28);
        context.lines = Some(vec![credit_line(
            "Organisation der Behandlung",
            Some(("1", "2050")),
            ("0", false),
            "2050.00",
            "0.00",
        )]);
        context.amount_net = dec("2050.00");
        context.amount_vat = Decimal::ZERO;
        context.amount_gross = dec("2050.00");
        context.deducted_advances = vec![advance_1000()];
        context
    }

    /// Defensive case: a release larger than the credit (the final asks more
    /// than before). The PDF prints «Verbleibender Betrag» +500,00; BT-115
    /// turns negative.
    fn credit_note_releasing_more_than_it_credits() -> CreditNotePdfContext {
        let mut context = credit_note_releasing_advances();
        context.document_number = "CN-20261117-0104".to_string();
        context.lines = Some(vec![credit_line(
            "Organisation der Behandlung",
            None,
            ("0", false),
            "500.00",
            "0.00",
        )]);
        context.amount_net = dec("500.00");
        context.amount_gross = dec("500.00");
        context
    }

    /// Stornorechnung of a Schlussrechnung with a deducted advance.
    fn storno_of_final() -> CreditNotePdfContext {
        let mut context = credit_note();
        context.transaction_type = STORNO_DOCUMENT.to_string();
        context.document_number = "STORNO-20261117-0003".to_string();
        context.reason = "Rechnung an falschen Empfänger".to_string();
        context.invoice_number = "INV-20261028-0051".to_string();
        context.invoice_date = day(10, 28);
        context.lines = Some(vec![
            credit_line(
                "Dolmetscherleistung",
                Some(("13.1", "100")),
                ("19", false),
                "1310.00",
                "248.90",
            ),
            credit_line(
                "Organisation der Behandlung",
                Some(("1", "2050")),
                ("0", false),
                "2050.00",
                "0.00",
            ),
        ]);
        context.amount_net = dec("3360.00");
        context.amount_vat = dec("248.90");
        context.amount_gross = dec("3608.90");
        context.deducted_advances = vec![advance_1000()];
        context
    }

    /// Storno der Rechnungskorrektur: the credited amount is owed again.
    fn reversal() -> CreditNotePdfContext {
        let mut context = credit_note();
        context.transaction_type = "reversal".to_string();
        context.document_number = "CNR-20261118-0001".to_string();
        context.reversed_document_number = Some("CN-20261117-0101".to_string());
        context.reversed_issued_on = Some(day(11, 17));
        context.issued_on = day(11, 18);
        context.reason = "Korrektur irrtümlich erstellt".to_string();
        context
    }

    /// A credit note to a third party who pays (a company abroad with a
    /// USt-IdNr.): no reason, as on the PDF.
    fn credit_note_to_payer() -> CreditNotePdfContext {
        let mut context = credit_note();
        context.document_number = "CN-20261117-0103".to_string();
        context.recipient = Some(InvoiceRecipient {
            name: "Beispiel Versicherung AG".to_string(),
            street: Some("Ringstraße 3".to_string()),
            zip: Some("1010".to_string()),
            city: Some("Wien".to_string()),
            country: Some("Österreich".to_string()),
            country_code: Some("AT".to_string()),
            email: Some("rechnung@example.com".to_string()),
            is_payer: true,
            kind: "contact".to_string(),
            service_recipient_name: Some("Anna Muster".to_string()),
            vat_id: Some("ATU12345678".to_string()),
            ..Default::default()
        });
        context
    }

    fn xml(context: &CreditNotePdfContext) -> String {
        let invoice = correction_einvoice(context);
        let missing = missing_requirements(context, &invoice);
        assert!(missing.is_empty(), "{missing:?}");
        zugferd::build_cii_xml(&invoice)
    }

    #[test]
    fn credit_note_is_a_381_with_positive_amounts_referencing_the_invoice() {
        let xml = xml(&credit_note());
        assert!(xml.contains("<ram:TypeCode>381</ram:TypeCode>"));
        assert!(xml.contains("<ram:ID>CN-20261117-0101</ram:ID>"));
        assert!(xml.contains("<ram:LineTotalAmount>280.50</ram:LineTotalAmount><ram:TaxBasisTotalAmount>280.50</ram:TaxBasisTotalAmount>"));
        assert!(xml.contains(r#"<ram:TaxTotalAmount currencyID="EUR">22.80</ram:TaxTotalAmount>"#));
        assert!(xml.contains("<ram:GrandTotalAmount>303.30</ram:GrandTotalAmount><ram:TotalPrepaidAmount>0.00</ram:TotalPrepaidAmount><ram:DuePayableAmount>303.30</ram:DuePayableAmount>"));
        assert!(!xml.contains(">-"), "no negative amounts: {xml}");
        // VAT categories as on the invoice: 19 % standard, pass-through exempt.
        assert!(xml.contains("<ram:CategoryCode>S</ram:CategoryCode><ram:RateApplicablePercent>19</ram:RateApplicablePercent>"));
        assert!(xml.contains("Durchlaufender Posten gemäß § 10 Abs. 1 Satz 5 UStG"));
        // A whole line keeps quantity × price, a partial credit is one unit.
        assert!(xml.contains(r#"<ram:BilledQuantity unitCode="C62">2</ram:BilledQuantity>"#));
        assert!(xml.contains("<ram:ChargeAmount>160.5</ram:ChargeAmount>"));
        // BG-3: the corrected invoice with its date.
        assert!(xml.contains(concat!(
            "<ram:InvoiceReferencedDocument><ram:IssuerAssignedID>INV-20261101-0042</ram:IssuerAssignedID>",
            r#"<ram:FormattedIssueDateTime><qdt:DateTimeString format="102">20261101</qdt:DateTimeString></ram:FormattedIssueDateTime>"#,
            "</ram:InvoiceReferencedDocument>"
        )));
        // Nothing is paid to GMED: no account, no remittance reference; the
        // PDF's statement is the payment terms (BR-CO-25), no due date.
        assert!(!xml.contains("IBANID"));
        assert!(!xml.contains("PaymentReference"));
        assert!(xml.contains(
            "<ram:SpecifiedTradePaymentTerms><ram:Description>Dieses Dokument mindert die oben genannte Rechnung"
        ));
        assert!(!xml.contains("DueDateDateTime"));
        assert!(xml.contains("Grund: Hotelnacht nicht in Anspruch genommen"));
        assert!(xml.contains("<ram:IssuerAssignedID>A-20261020-0007</ram:IssuerAssignedID>"));
    }

    #[test]
    fn released_advances_are_prepaid_and_the_remaining_matches_the_pdf() {
        let context = credit_note_releasing_advances();
        let xml = xml(&context);
        assert!(xml.contains("<ram:TypeCode>381</ram:TypeCode>"));
        // 2,050 credited, 1,000 of it the released advance: the final no
        // longer asks 1,050 (the PDF prints «Verbleibender Betrag -1.050,00»).
        assert!(xml.contains("<ram:GrandTotalAmount>2050.00</ram:GrandTotalAmount><ram:TotalPrepaidAmount>1000.00</ram:TotalPrepaidAmount><ram:DuePayableAmount>1050.00</ram:DuePayableAmount>"));
        assert_eq!(xml.matches("<ram:InvoiceReferencedDocument>").count(), 2);
        assert!(xml.contains("<ram:IssuerAssignedID>INV-20261020-0031</ram:IssuerAssignedID>"));
        assert!(xml.contains("Zuzüglich freigegebener Anzahlungen"));
        assert!(xml.contains("MwSt.-Betrag 59,85 €"), "{xml}");
        assert!(xml.contains("-1.050,00"), "{xml}");
        let pdf = credit_note_pdf::build_credit_note_pdf(&context).unwrap();
        let text = pdf_extract::extract_text_from_mem(&pdf).unwrap();
        assert!(text.contains("-1.050,00"), "{text}");

        // A release beyond the credit: the remaining row is positive on the
        // PDF and BT-115 negative, still EN 16931 arithmetic (BR-CO-16).
        let more = credit_note_releasing_more_than_it_credits();
        let more_xml = super::super::zugferd::build_cii_xml(&correction_einvoice(&more));
        assert!(more_xml.contains("<ram:GrandTotalAmount>500.00</ram:GrandTotalAmount><ram:TotalPrepaidAmount>1000.00</ram:TotalPrepaidAmount><ram:DuePayableAmount>-500.00</ram:DuePayableAmount>"), "{more_xml}");
        let text = pdf_extract::extract_text_from_mem(
            &credit_note_pdf::build_credit_note_pdf(&more).unwrap(),
        )
        .unwrap();
        assert!(text.contains("500,00"), "{text}");
    }

    #[test]
    fn storno_is_a_381_mirroring_the_final_it_cancels() {
        let mut context = storno_of_final();
        let lines = context.lines.as_mut().unwrap();
        lines[1].vat.set_sign_negative(true);
        assert!(lines[1].vat.is_sign_negative() && lines[1].vat.is_zero());
        let xml = xml(&context);
        // The exempt breakdown states 0.00, never -0.00 (BR-E-09).
        assert!(!xml.contains(">-0"), "{xml}");
        assert!(xml.contains("<ram:CalculatedAmount>0.00</ram:CalculatedAmount>"));
        assert!(xml.contains("<ram:TypeCode>381</ram:TypeCode>"));
        assert!(xml.contains("<ram:GrandTotalAmount>3608.90</ram:GrandTotalAmount><ram:TotalPrepaidAmount>1000.00</ram:TotalPrepaidAmount><ram:DuePayableAmount>2608.90</ram:DuePayableAmount>"));
        assert!(xml.contains("<ram:CalculatedAmount>248.90</ram:CalculatedAmount>"));
        assert!(xml.contains("<ram:IssuerAssignedID>INV-20261028-0051</ram:IssuerAssignedID>"));
        assert!(
            xml.contains("Diese Stornorechnung hebt die oben genannte Rechnung vollständig auf")
        );
        assert!(xml.contains("Zuzüglich verrechneter Anzahlungen"));
    }

    #[test]
    fn reversal_charges_again_and_references_the_credit_note() {
        let xml = xml(&reversal());
        assert!(xml.contains("<ram:TypeCode>380</ram:TypeCode>"));
        assert!(xml.contains("<ram:DuePayableAmount>303.30</ram:DuePayableAmount>"));
        let credit = xml.find("CN-20261117-0101</ram:IssuerAssignedID>").unwrap();
        let invoice = xml
            .find("INV-20261101-0042</ram:IssuerAssignedID>")
            .unwrap();
        assert!(credit < invoice, "the reversed credit note comes first");
        assert!(xml.contains("der Rechnungsbetrag ist in dieser Höhe wieder geschuldet"));
        assert!(xml.contains("<ram:PaymentReference>CNR-20261118-0001</ram:PaymentReference>"));
    }

    #[test]
    fn a_third_party_payer_reads_no_reason() {
        let xml = xml(&credit_note_to_payer());
        assert!(!xml.contains("Grund:"));
        assert!(xml.contains("<ram:Name>Beispiel Versicherung AG</ram:Name>"));
        assert!(xml.contains(r#"<ram:ID schemeID="VA">ATU12345678</ram:ID>"#));
    }

    #[test]
    fn legacy_and_blended_rates_stay_pdf_only() {
        let mut legacy = credit_note();
        legacy.lines = None;
        let invoice = correction_einvoice(&legacy);
        assert!(missing_requirements(&legacy, &invoice).contains(&MISSING_LINE_VAT_RATE));
        // Storno of an old invoice whose lines did not add up: one summary
        // line at the rate implied by the totals.
        let mut summary = storno_of_final();
        summary.lines = Some(vec![credit_line(
            "Storno der Rechnung INV-1",
            None,
            ("7.41", false),
            "3360.00",
            "248.90",
        )]);
        let invoice = correction_einvoice(&summary);
        assert_eq!(
            missing_requirements(&summary, &invoice),
            vec![MISSING_LINE_VAT_RATE]
        );
        let pdf = render_correction_pdf(&summary).unwrap();
        assert_eq!(zugferd::extract_xml_from_pdf(&pdf), None);
        // Without GMED's country the seller cannot be stated either.
        let mut no_country = credit_note();
        no_country.agency_country_code = None;
        let invoice = correction_einvoice(&no_country);
        assert_eq!(
            missing_requirements(&no_country, &invoice),
            vec!["seller_country"]
        );
    }

    #[test]
    fn the_stored_correction_pdf_carries_its_xml() {
        let context = credit_note();
        let pdf = render_correction_pdf(&context).unwrap();
        assert_eq!(
            zugferd::extract_xml_from_pdf(&pdf).as_deref(),
            Some(xml(&context).as_str())
        );
        let text = pdf_extract::extract_text_from_mem(&pdf).unwrap();
        assert!(text.contains("RECHNUNGSKORREKTUR"), "{text}");
    }

    /// CI validates these files with Mustang (EN 16931 Schematron, and
    /// PDF/A-3 for the hybrids rendered by the correction layout).
    #[test]
    fn correction_samples_can_be_exported_for_external_validation() {
        let Ok(dir) = std::env::var("EINVOICE_SAMPLE_DIR") else {
            return;
        };
        std::fs::create_dir_all(&dir).unwrap();
        let dir = std::path::Path::new(&dir);
        for context in [
            credit_note(),
            credit_note_releasing_advances(),
            credit_note_releasing_more_than_it_credits(),
            storno_of_final(),
            reversal(),
            credit_note_to_payer(),
        ] {
            std::fs::write(
                dir.join(format!("correction-{}.xml", context.document_number)),
                xml(&context),
            )
            .unwrap();
        }
        for (name, context) in [
            ("hybrid-credit-note.pdf", credit_note_releasing_advances()),
            ("hybrid-storno.pdf", storno_of_final()),
            ("hybrid-credit-note-reversal.pdf", reversal()),
        ] {
            let pdf = render_correction_pdf(&context).unwrap();
            assert!(zugferd::extract_xml_from_pdf(&pdf).is_some());
            std::fs::write(dir.join(name), pdf).unwrap();
        }
    }
}
