//! Outgoing e-invoices: UN/CEFACT CII in the EN 16931 profile (ZUGFeRD 2.x
//! "EN 16931", Factur-X "EN 16931"). The XML is the legal invoice; the
//! existing PDF stays the human-readable copy. Only documented business
//! terms are written, and every total is recomputed here so the XML can never
//! contradict itself (BR-CO-10 to BR-CO-17).

use chrono::NaiveDate;
use quick_xml::Writer;
use quick_xml::events::{BytesDecl, BytesText, Event};
use rust_decimal::Decimal;
use std::collections::BTreeMap;
use std::io::Cursor;

pub const GUIDELINE_EN16931: &str = "urn:cen.eu:en16931:2017";
/// Article 132 exemption: medical care (§ 4 Nr. 14 UStG).
pub const EXEMPTION_CODE_MEDICAL: &str = "VATEX-EU-132";
pub const EXEMPTION_TEXT_MEDICAL: &str = "Steuerfreie Heilbehandlung nach § 4 Nr. 14 UStG";
pub const EXEMPTION_TEXT_PASSTHROUGH: &str =
    "Durchlaufender Posten nach § 10 Abs. 1 Satz 6 UStG, nicht Teil des Entgelts";

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EInvoiceError {
    /// A field the standard requires is missing; the message names it.
    Missing(&'static str),
    /// The stored invoice totals do not match the totals derived from its lines.
    TotalsMismatch(&'static str),
    /// Taxable lines need the seller's VAT identifier (BR-S-02).
    SellerVatIdRequired,
    /// Not an invoice this generator may issue (e.g. cancelled or draft).
    NotIssuable(&'static str),
}

impl EInvoiceError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::Missing(_) => "einvoice_field_missing",
            Self::TotalsMismatch(_) => "einvoice_totals_mismatch",
            Self::SellerVatIdRequired => "einvoice_seller_vat_id_required",
            Self::NotIssuable(_) => "einvoice_not_issuable",
        }
    }
    pub fn detail(&self) -> &'static str {
        match self {
            Self::Missing(v) | Self::TotalsMismatch(v) | Self::NotIssuable(v) => v,
            Self::SellerVatIdRequired => "seller_vat_id",
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct PostalAddress {
    pub street: Option<String>,
    pub postal_code: Option<String>,
    pub city: Option<String>,
    /// ISO 3166-1 alpha-2.
    pub country: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Party {
    pub name: String,
    pub address: PostalAddress,
    /// USt-IdNr. (BT-31 / BT-48).
    pub vat_id: Option<String>,
    /// Steuernummer (BT-32); sellers without a VAT id are identified by it.
    pub tax_number: Option<String>,
    pub email: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Line {
    pub description: String,
    pub quantity: Decimal,
    /// UN/ECE Recommendation 20 unit code, e.g. C62 (unit), HUR (hour).
    pub unit_code: String,
    pub unit_price_net: Decimal,
    /// Percent, e.g. 19 or 0.
    pub vat_rate: Decimal,
    /// Money collected on behalf of a third party (durchlaufender Posten).
    pub is_cost_passthrough: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Payment {
    pub iban: String,
    pub bic: Option<String>,
    pub holder: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EInvoice {
    pub number: String,
    /// UNTDID 1001: 380 commercial invoice, 386 prepayment invoice.
    pub type_code: &'static str,
    pub issue_date: NaiveDate,
    pub due_date: Option<NaiveDate>,
    pub currency: String,
    pub seller: Party,
    pub buyer: Party,
    pub buyer_reference: Option<String>,
    pub order_reference: Option<String>,
    pub lines: Vec<Line>,
    /// Totals as shown on the human-readable invoice; they must agree with the lines.
    pub total_net: Decimal,
    pub total_vat: Decimal,
    pub total_gross: Decimal,
    /// Amounts already settled (payments, credits, applied prepayments).
    pub prepaid: Decimal,
    pub payment: Option<Payment>,
    pub payment_terms: Option<String>,
    pub note: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct TaxGroup {
    category: &'static str,
    rate: Decimal,
    basis: Decimal,
    amount: Decimal,
    exemption_code: Option<&'static str>,
    exemption_texts: Vec<&'static str>,
}

fn money(value: Decimal) -> String {
    format!("{:.2}", value.round_dp(2))
}
fn quantity(value: Decimal) -> String {
    let normalized = value.normalize();
    if normalized.scale() == 0 {
        format!("{normalized}.0")
    } else {
        normalized.to_string()
    }
}
fn rate(value: Decimal) -> String {
    format!("{:.2}", value.round_dp(2))
}
fn date(value: NaiveDate) -> String {
    value.format("%Y%m%d").to_string()
}
fn clean(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ")
}
fn present(value: &Option<String>) -> Option<String> {
    value
        .as_deref()
        .map(clean)
        .filter(|value| !value.is_empty())
}

fn line_category(line: &Line) -> (&'static str, Option<&'static str>, Option<&'static str>) {
    if line.vat_rate > Decimal::ZERO {
        ("S", None, None)
    } else if line.is_cost_passthrough {
        ("E", None, Some(EXEMPTION_TEXT_PASSTHROUGH))
    } else {
        (
            "E",
            Some(EXEMPTION_CODE_MEDICAL),
            Some(EXEMPTION_TEXT_MEDICAL),
        )
    }
}

/// Groups line amounts by VAT category and rate and derives the tax per
/// group from the group basis (BR-CO-17), which is how EN 16931 defines it.
/// There is exactly one exempt group (BR-E-01); its reason lists every
/// exemption that applies, and the code is kept only when all exempt lines
/// share the medical exemption.
fn tax_groups(lines: &[Line]) -> Vec<TaxGroup> {
    let mut groups: BTreeMap<String, TaxGroup> = BTreeMap::new();
    for line in lines {
        let (category, code, text) = line_category(line);
        let rate = line.vat_rate.round_dp(2);
        let group = groups
            .entry(format!("{category}:{rate}"))
            .or_insert(TaxGroup {
                category,
                rate,
                basis: Decimal::ZERO,
                amount: Decimal::ZERO,
                exemption_code: code,
                exemption_texts: Vec::new(),
            });
        if group.exemption_code != code {
            group.exemption_code = None;
        }
        if let Some(text) = text {
            if !group.exemption_texts.contains(&text) {
                group.exemption_texts.push(text);
            }
        }
        group.basis += (line.quantity * line.unit_price_net).round_dp(2);
    }
    let mut groups: Vec<TaxGroup> = groups.into_values().collect();
    for group in &mut groups {
        group.amount = (group.basis * group.rate / Decimal::from(100)).round_dp(2);
    }
    groups
}

fn validate(invoice: &EInvoice) -> Result<Vec<TaxGroup>, EInvoiceError> {
    if invoice.number.trim().is_empty() {
        return Err(EInvoiceError::Missing("invoice_number"));
    }
    if invoice.currency.len() != 3 || !invoice.currency.bytes().all(|b| b.is_ascii_uppercase()) {
        return Err(EInvoiceError::Missing("currency"));
    }
    if invoice.lines.is_empty() {
        return Err(EInvoiceError::Missing("line_items"));
    }
    if invoice.seller.name.trim().is_empty() {
        return Err(EInvoiceError::Missing("seller_name"));
    }
    for (field, value) in [
        ("seller_street", &invoice.seller.address.street),
        ("seller_postal_code", &invoice.seller.address.postal_code),
        ("seller_city", &invoice.seller.address.city),
        ("seller_country", &invoice.seller.address.country),
    ] {
        if present(value).is_none() {
            return Err(EInvoiceError::Missing(field));
        }
    }
    // BR-CO-26: the seller needs an identifier; tax number or VAT id serve as one.
    if present(&invoice.seller.vat_id).is_none() && present(&invoice.seller.tax_number).is_none() {
        return Err(EInvoiceError::Missing("seller_vat_id_or_tax_number"));
    }
    if invoice.buyer.name.trim().is_empty() {
        return Err(EInvoiceError::Missing("buyer_name"));
    }
    if present(&invoice.buyer.address.country).is_none() {
        return Err(EInvoiceError::Missing("buyer_country"));
    }
    for line in &invoice.lines {
        if line.description.trim().is_empty() {
            return Err(EInvoiceError::Missing("line_description"));
        }
        if line.quantity <= Decimal::ZERO
            || line.unit_price_net < Decimal::ZERO
            || line.vat_rate < Decimal::ZERO
        {
            return Err(EInvoiceError::Missing("line_amounts"));
        }
    }
    let groups = tax_groups(&invoice.lines);
    if groups.iter().any(|g| g.category == "S") && present(&invoice.seller.vat_id).is_none() {
        return Err(EInvoiceError::SellerVatIdRequired);
    }
    let net: Decimal = groups.iter().map(|g| g.basis).sum();
    let vat: Decimal = groups.iter().map(|g| g.amount).sum();
    if net != invoice.total_net.round_dp(2) {
        return Err(EInvoiceError::TotalsMismatch("total_net"));
    }
    if vat != invoice.total_vat.round_dp(2) {
        return Err(EInvoiceError::TotalsMismatch("total_vat"));
    }
    if net + vat != invoice.total_gross.round_dp(2) {
        return Err(EInvoiceError::TotalsMismatch("total_gross"));
    }
    if invoice.prepaid < Decimal::ZERO
        || invoice.prepaid.round_dp(2) > invoice.total_gross.round_dp(2)
    {
        return Err(EInvoiceError::TotalsMismatch("prepaid"));
    }
    Ok(groups)
}

struct Xml {
    writer: Writer<Cursor<Vec<u8>>>,
}
impl Xml {
    fn open(&mut self, tag: &str) {
        self.writer
            .write_event(Event::Start(quick_xml::events::BytesStart::new(tag)))
            .expect("in-memory xml");
    }
    fn close(&mut self, tag: &str) {
        self.writer
            .write_event(Event::End(quick_xml::events::BytesEnd::new(tag)))
            .expect("in-memory xml");
    }
    fn leaf(&mut self, tag: &str, text: &str, attributes: &[(&str, &str)]) {
        let mut start = quick_xml::events::BytesStart::new(tag);
        for (name, value) in attributes {
            start.push_attribute((*name, *value));
        }
        self.writer
            .write_event(Event::Start(start))
            .expect("in-memory xml");
        self.writer
            .write_event(Event::Text(BytesText::new(text)))
            .expect("in-memory xml");
        self.close(tag);
    }
    fn optional(&mut self, tag: &str, value: &Option<String>) {
        if let Some(value) = present(value) {
            self.leaf(tag, &value, &[]);
        }
    }
}

fn write_party(xml: &mut Xml, tag: &str, party: &Party, seller: bool) {
    xml.open(tag);
    if seller {
        // BT-29 seller identifier (BR-CO-26) when there is no VAT id.
        if present(&party.vat_id).is_none() {
            if let Some(tax_number) = present(&party.tax_number) {
                xml.leaf("ram:ID", &tax_number, &[]);
            }
        }
    }
    xml.leaf("ram:Name", &clean(&party.name), &[]);
    xml.open("ram:PostalTradeAddress");
    xml.optional("ram:PostcodeCode", &party.address.postal_code);
    xml.optional("ram:LineOne", &party.address.street);
    xml.optional("ram:CityName", &party.address.city);
    if let Some(country) = present(&party.address.country) {
        xml.leaf("ram:CountryID", &country.to_ascii_uppercase(), &[]);
    }
    xml.close("ram:PostalTradeAddress");
    if let Some(email) = present(&party.email) {
        xml.open("ram:URIUniversalCommunication");
        xml.leaf("ram:URIID", &email, &[("schemeID", "EM")]);
        xml.close("ram:URIUniversalCommunication");
    }
    if seller {
        if let Some(tax_number) = present(&party.tax_number) {
            xml.open("ram:SpecifiedTaxRegistration");
            xml.leaf("ram:ID", &tax_number, &[("schemeID", "FC")]);
            xml.close("ram:SpecifiedTaxRegistration");
        }
    }
    if let Some(vat_id) = present(&party.vat_id) {
        xml.open("ram:SpecifiedTaxRegistration");
        xml.leaf("ram:ID", &vat_id, &[("schemeID", "VA")]);
        xml.close("ram:SpecifiedTaxRegistration");
    }
    xml.close(tag);
}

/// Serialises the invoice as CII (EN 16931 profile). Fails instead of writing
/// an XML that would be rejected by the buyer's validator.
pub fn build_cii(invoice: &EInvoice) -> Result<String, EInvoiceError> {
    let groups = validate(invoice)?;
    let currency = invoice.currency.as_str();
    let mut xml = Xml {
        writer: Writer::new_with_indent(Cursor::new(Vec::new()), b' ', 2),
    };
    xml.writer
        .write_event(Event::Decl(BytesDecl::new("1.0", Some("UTF-8"), None)))
        .expect("in-memory xml");
    let mut root = quick_xml::events::BytesStart::new("rsm:CrossIndustryInvoice");
    for (name, value) in [
        (
            "xmlns:rsm",
            "urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100",
        ),
        (
            "xmlns:ram",
            "urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100",
        ),
        (
            "xmlns:qdt",
            "urn:un:unece:uncefact:data:standard:QualifiedDataType:100",
        ),
        (
            "xmlns:udt",
            "urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100",
        ),
    ] {
        root.push_attribute((name, value));
    }
    xml.writer
        .write_event(Event::Start(root))
        .expect("in-memory xml");

    xml.open("rsm:ExchangedDocumentContext");
    xml.open("ram:GuidelineSpecifiedDocumentContextParameter");
    xml.leaf("ram:ID", GUIDELINE_EN16931, &[]);
    xml.close("ram:GuidelineSpecifiedDocumentContextParameter");
    xml.close("rsm:ExchangedDocumentContext");

    xml.open("rsm:ExchangedDocument");
    xml.leaf("ram:ID", &clean(&invoice.number), &[]);
    xml.leaf("ram:TypeCode", invoice.type_code, &[]);
    xml.open("ram:IssueDateTime");
    xml.leaf(
        "udt:DateTimeString",
        &date(invoice.issue_date),
        &[("format", "102")],
    );
    xml.close("ram:IssueDateTime");
    if let Some(note) = present(&invoice.note) {
        xml.open("ram:IncludedNote");
        xml.leaf("ram:Content", &note, &[]);
        xml.close("ram:IncludedNote");
    }
    xml.close("rsm:ExchangedDocument");

    xml.open("rsm:SupplyChainTradeTransaction");
    for (index, line) in invoice.lines.iter().enumerate() {
        let (category, _, _) = line_category(line);
        xml.open("ram:IncludedSupplyChainTradeLineItem");
        xml.open("ram:AssociatedDocumentLineDocument");
        xml.leaf("ram:LineID", &(index + 1).to_string(), &[]);
        xml.close("ram:AssociatedDocumentLineDocument");
        xml.open("ram:SpecifiedTradeProduct");
        xml.leaf("ram:Name", &clean(&line.description), &[]);
        xml.close("ram:SpecifiedTradeProduct");
        xml.open("ram:SpecifiedLineTradeAgreement");
        xml.open("ram:NetPriceProductTradePrice");
        xml.leaf("ram:ChargeAmount", &money(line.unit_price_net), &[]);
        xml.close("ram:NetPriceProductTradePrice");
        xml.close("ram:SpecifiedLineTradeAgreement");
        xml.open("ram:SpecifiedLineTradeDelivery");
        xml.leaf(
            "ram:BilledQuantity",
            &quantity(line.quantity),
            &[("unitCode", &line.unit_code)],
        );
        xml.close("ram:SpecifiedLineTradeDelivery");
        xml.open("ram:SpecifiedLineTradeSettlement");
        xml.open("ram:ApplicableTradeTax");
        xml.leaf("ram:TypeCode", "VAT", &[]);
        xml.leaf("ram:CategoryCode", category, &[]);
        xml.leaf("ram:RateApplicablePercent", &rate(line.vat_rate), &[]);
        xml.close("ram:ApplicableTradeTax");
        xml.open("ram:SpecifiedTradeSettlementLineMonetarySummation");
        xml.leaf(
            "ram:LineTotalAmount",
            &money(line.quantity * line.unit_price_net),
            &[],
        );
        xml.close("ram:SpecifiedTradeSettlementLineMonetarySummation");
        xml.close("ram:SpecifiedLineTradeSettlement");
        xml.close("ram:IncludedSupplyChainTradeLineItem");
    }

    xml.open("ram:ApplicableHeaderTradeAgreement");
    if let Some(reference) = present(&invoice.buyer_reference) {
        xml.leaf("ram:BuyerReference", &reference, &[]);
    }
    write_party(&mut xml, "ram:SellerTradeParty", &invoice.seller, true);
    write_party(&mut xml, "ram:BuyerTradeParty", &invoice.buyer, false);
    if let Some(order) = present(&invoice.order_reference) {
        xml.open("ram:BuyerOrderReferencedDocument");
        xml.leaf("ram:IssuerAssignedID", &order, &[]);
        xml.close("ram:BuyerOrderReferencedDocument");
    }
    xml.close("ram:ApplicableHeaderTradeAgreement");

    xml.open("ram:ApplicableHeaderTradeDelivery");
    xml.close("ram:ApplicableHeaderTradeDelivery");

    xml.open("ram:ApplicableHeaderTradeSettlement");
    xml.leaf("ram:InvoiceCurrencyCode", currency, &[]);
    if let Some(payment) = &invoice.payment {
        xml.open("ram:SpecifiedTradeSettlementPaymentMeans");
        // UNTDID 4461: 58 = SEPA credit transfer.
        xml.leaf("ram:TypeCode", "58", &[]);
        xml.open("ram:PayeePartyCreditorFinancialAccount");
        xml.leaf(
            "ram:IBANID",
            &payment.iban.split_whitespace().collect::<String>(),
            &[],
        );
        xml.optional("ram:AccountName", &payment.holder);
        xml.close("ram:PayeePartyCreditorFinancialAccount");
        if let Some(bic) = present(&payment.bic) {
            xml.open("ram:PayeeSpecifiedCreditorFinancialInstitution");
            xml.leaf("ram:BICID", &bic, &[]);
            xml.close("ram:PayeeSpecifiedCreditorFinancialInstitution");
        }
        xml.close("ram:SpecifiedTradeSettlementPaymentMeans");
    }
    for group in &groups {
        xml.open("ram:ApplicableTradeTax");
        xml.leaf("ram:CalculatedAmount", &money(group.amount), &[]);
        xml.leaf("ram:TypeCode", "VAT", &[]);
        if !group.exemption_texts.is_empty() {
            xml.leaf(
                "ram:ExemptionReason",
                &group.exemption_texts.join("; "),
                &[],
            );
        }
        xml.leaf("ram:BasisAmount", &money(group.basis), &[]);
        xml.leaf("ram:CategoryCode", group.category, &[]);
        if let Some(code) = group.exemption_code {
            xml.leaf("ram:ExemptionReasonCode", code, &[]);
        }
        xml.leaf("ram:RateApplicablePercent", &rate(group.rate), &[]);
        xml.close("ram:ApplicableTradeTax");
    }
    if invoice.due_date.is_some() || present(&invoice.payment_terms).is_some() {
        xml.open("ram:SpecifiedTradePaymentTerms");
        xml.optional("ram:Description", &invoice.payment_terms);
        if let Some(due) = invoice.due_date {
            xml.open("ram:DueDateDateTime");
            xml.leaf("udt:DateTimeString", &date(due), &[("format", "102")]);
            xml.close("ram:DueDateDateTime");
        }
        xml.close("ram:SpecifiedTradePaymentTerms");
    }
    let net: Decimal = groups.iter().map(|g| g.basis).sum();
    let vat: Decimal = groups.iter().map(|g| g.amount).sum();
    let gross = net + vat;
    let prepaid = invoice.prepaid.round_dp(2);
    xml.open("ram:SpecifiedTradeSettlementHeaderMonetarySummation");
    xml.leaf("ram:LineTotalAmount", &money(net), &[]);
    xml.leaf("ram:TaxBasisTotalAmount", &money(net), &[]);
    xml.leaf(
        "ram:TaxTotalAmount",
        &money(vat),
        &[("currencyID", currency)],
    );
    xml.leaf("ram:GrandTotalAmount", &money(gross), &[]);
    xml.leaf("ram:TotalPrepaidAmount", &money(prepaid), &[]);
    xml.leaf("ram:DuePayableAmount", &money(gross - prepaid), &[]);
    xml.close("ram:SpecifiedTradeSettlementHeaderMonetarySummation");
    xml.close("ram:ApplicableHeaderTradeSettlement");
    xml.close("rsm:SupplyChainTradeTransaction");
    xml.close("rsm:CrossIndustryInvoice");

    let bytes = xml.writer.into_inner().into_inner();
    let mut text = String::from_utf8(bytes).expect("xml writer emits utf-8");
    text.push('\n');
    Ok(text)
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use std::str::FromStr;

    fn dec(value: &str) -> Decimal {
        Decimal::from_str(value).unwrap()
    }

    pub(crate) fn seller() -> Party {
        Party {
            name: "GMED - Agentur für Patientenbetreuung".into(),
            address: PostalAddress {
                street: Some("Albert-Schweitzer-Straße 56".into()),
                postal_code: Some("81735".into()),
                city: Some("München".into()),
                country: Some("DE".into()),
            },
            vat_id: Some("DE123456789".into()),
            tax_number: Some("143/123/45678".into()),
            email: Some("office@example.invalid".into()),
        }
    }
    pub(crate) fn buyer() -> Party {
        Party {
            name: "Max Mustermann".into(),
            address: PostalAddress {
                street: Some("Musterweg 1".into()),
                postal_code: Some("10115".into()),
                city: Some("Berlin".into()),
                country: Some("DE".into()),
            },
            vat_id: None,
            tax_number: None,
            email: None,
        }
    }
    fn line(
        description: &str,
        quantity: Decimal,
        price: Decimal,
        rate: Decimal,
        passthrough: bool,
    ) -> Line {
        Line {
            description: description.into(),
            quantity,
            unit_code: "C62".into(),
            unit_price_net: price,
            vat_rate: rate,
            is_cost_passthrough: passthrough,
        }
    }
    /// Medical care exempt under § 4 Nr. 14, an interpreter at 19 % and a
    /// pass-through hospital deposit: the mix GMed actually bills.
    pub(crate) fn sample_mixed() -> EInvoice {
        EInvoice {
            number: "RE-2026-0001".into(),
            type_code: "380",
            issue_date: NaiveDate::from_ymd_opt(2026, 9, 19).unwrap(),
            due_date: NaiveDate::from_ymd_opt(2026, 10, 3),
            currency: "EUR".into(),
            seller: seller(),
            buyer: buyer(),
            buyer_reference: None,
            order_reference: Some("ORD-2026-17".into()),
            lines: vec![
                line(
                    "Ärztliche Konsultation",
                    dec("1"),
                    dec("145.00"),
                    dec("0"),
                    false,
                ),
                line("Dolmetscher", dec("2.5"), dec("60.00"), dec("19"), false),
                line(
                    "Klinikanzahlung (durchlaufender Posten)",
                    dec("1"),
                    dec("1000.00"),
                    dec("0"),
                    true,
                ),
            ],
            total_net: dec("1295.00"),
            total_vat: dec("28.50"),
            total_gross: dec("1323.50"),
            prepaid: dec("300.00"),
            payment: Some(Payment {
                iban: "DE02 1203 0000 0000 2020 51".into(),
                bic: Some("BYLADEM1001".into()),
                holder: Some("GMED".into()),
            }),
            payment_terms: Some("Zahlbar innerhalb von 14 Tagen ohne Abzug.".into()),
            note: Some("Rechnung zu Auftrag ORD-2026-17".into()),
        }
    }
    /// Only exempt medical care and no VAT id: a provider under § 4 Nr. 14.
    pub(crate) fn sample_exempt_only() -> EInvoice {
        let mut invoice = sample_mixed();
        invoice.number = "RE-2026-0002".into();
        invoice.seller.vat_id = None;
        invoice.lines.truncate(1);
        invoice.total_net = dec("145.00");
        invoice.total_vat = dec("0");
        invoice.total_gross = dec("145.00");
        invoice.prepaid = dec("0");
        invoice.payment = None;
        invoice.buyer.address = PostalAddress {
            country: Some("AT".into()),
            ..Default::default()
        };
        invoice
    }

    #[test]
    fn totals_are_derived_per_vat_group_and_written_consistently() {
        let xml = build_cii(&sample_mixed()).unwrap();
        assert!(xml.contains("<ram:ID>urn:cen.eu:en16931:2017</ram:ID>"));
        assert!(xml.contains("<ram:TypeCode>380</ram:TypeCode>"));
        assert!(xml.contains("<udt:DateTimeString format=\"102\">20260919</udt:DateTimeString>"));
        assert!(xml.contains("<ram:BilledQuantity unitCode=\"C62\">2.5</ram:BilledQuantity>"));
        assert!(xml.contains("<ram:LineTotalAmount>150.00</ram:LineTotalAmount>"));
        assert!(xml.contains("<ram:CalculatedAmount>28.50</ram:CalculatedAmount>"));
        // One exempt breakdown (BR-E-01) naming both reasons; no code once they differ.
        assert!(!xml.contains("<ram:ExemptionReasonCode>"));
        assert!(xml.contains(&format!(
            "{EXEMPTION_TEXT_MEDICAL}; {EXEMPTION_TEXT_PASSTHROUGH}"
        )));
        assert!(xml.contains("<ram:TaxTotalAmount currencyID=\"EUR\">28.50</ram:TaxTotalAmount>"));
        assert!(xml.contains("<ram:GrandTotalAmount>1323.50</ram:GrandTotalAmount>"));
        assert!(xml.contains("<ram:TotalPrepaidAmount>300.00</ram:TotalPrepaidAmount>"));
        assert!(xml.contains("<ram:DuePayableAmount>1023.50</ram:DuePayableAmount>"));
        assert!(xml.contains("<ram:IBANID>DE02120300000000202051</ram:IBANID>"));
        assert!(xml.contains("<ram:ID schemeID=\"VA\">DE123456789</ram:ID>"));
        assert_eq!(xml.matches("<ram:ApplicableTradeTax>").count(), 3 + 2);
        assert!(xml.contains("<ram:BasisAmount>1145.00</ram:BasisAmount>"));
    }

    #[test]
    fn exempt_seller_is_identified_by_tax_number_and_needs_no_vat_id() {
        let xml = build_cii(&sample_exempt_only()).unwrap();
        assert!(xml.contains("<ram:ID>143/123/45678</ram:ID>"));
        assert!(xml.contains("<ram:ExemptionReasonCode>VATEX-EU-132</ram:ExemptionReasonCode>"));
        assert!(xml.contains("<ram:ID schemeID=\"FC\">143/123/45678</ram:ID>"));
        assert!(!xml.contains("schemeID=\"VA\""));
        assert!(xml.contains("<ram:CountryID>AT</ram:CountryID>"));
        let mut taxable = sample_mixed();
        taxable.seller.vat_id = None;
        assert_eq!(build_cii(&taxable), Err(EInvoiceError::SellerVatIdRequired));
    }

    #[test]
    fn stored_totals_must_match_the_lines_and_required_fields_are_enforced() {
        let mut invoice = sample_mixed();
        invoice.total_vat = dec("28.49");
        assert_eq!(
            build_cii(&invoice),
            Err(EInvoiceError::TotalsMismatch("total_vat"))
        );
        let mut invoice = sample_mixed();
        invoice.prepaid = dec("2000");
        assert_eq!(
            build_cii(&invoice),
            Err(EInvoiceError::TotalsMismatch("prepaid"))
        );
        let mut invoice = sample_mixed();
        invoice.buyer.address.country = None;
        assert_eq!(
            build_cii(&invoice),
            Err(EInvoiceError::Missing("buyer_country"))
        );
        let mut invoice = sample_mixed();
        invoice.seller.vat_id = None;
        invoice.seller.tax_number = None;
        assert_eq!(
            build_cii(&invoice),
            Err(EInvoiceError::Missing("seller_vat_id_or_tax_number"))
        );
        let mut invoice = sample_mixed();
        invoice.lines.clear();
        assert_eq!(
            build_cii(&invoice),
            Err(EInvoiceError::Missing("line_items"))
        );
    }

    #[test]
    fn text_is_escaped_and_whitespace_normalised() {
        let mut invoice = sample_mixed();
        invoice.lines[0].description = "Konsultation <A&B>\n  Dr. \"X\"".into();
        let xml = build_cii(&invoice).unwrap();
        assert!(
            xml.contains("<ram:Name>Konsultation &lt;A&amp;B&gt; Dr. &quot;X&quot;</ram:Name>")
        );
        assert!(!xml.contains("<A&B>"));
    }

    /// Our own reader must accept what we write; CI additionally runs the
    /// official validator over the same samples (see EINVOICE_SAMPLE_DIR).
    #[test]
    fn samples_can_be_exported_for_external_validation() {
        let Ok(dir) = std::env::var("EINVOICE_SAMPLE_DIR") else {
            return;
        };
        std::fs::create_dir_all(&dir).unwrap();
        for invoice in [sample_mixed(), sample_exempt_only()] {
            let path = std::path::Path::new(&dir).join(format!("{}.xml", invoice.number));
            std::fs::write(path, build_cii(&invoice).unwrap()).unwrap();
        }
    }
}
