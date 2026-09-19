//! ZUGFeRD / Factur-X output for outgoing invoices: an EN 16931 invoice in
//! UN/CEFACT CII syntax, embedded as `factur-x.xml` into the human-readable PDF.
//!
//! The XML describes the invoice as issued. Receipts recorded afterwards live in
//! the payment journal and are deliberately not part of the document.

use chrono::NaiveDate;
use lopdf::{Dictionary, Object, Stream, StringFormat, dictionary};
use rust_decimal::{Decimal, RoundingStrategy};

pub(super) const ZUGFERD_XML_FILENAME: &str = "factur-x.xml";
/// sRGB profile for the PDF/A output intent (CC0, see assets/icc/README.md).
const SRGB_ICC_PROFILE: &[u8] = include_bytes!("../../../assets/icc/sRGB-v2-micro.icc");
const EN16931_GUIDELINE: &str = "urn:cen.eu:en16931:2017";
const PASSTHROUGH_EXEMPTION: &str = "Durchlaufender Posten gemäß § 10 Abs. 1 Satz 5 UStG";
/// Medical care is exempt under § 4 Nr. 14 UStG (Art. 132 VAT Directive); the
/// VATEX code is only written when every exempt line is medical care.
const ZERO_RATE_EXEMPTION: &str = "Steuerfreie Heilbehandlung nach § 4 Nr. 14 UStG";
const ZERO_RATE_EXEMPTION_CODE: &str = "VATEX-EU-132";

#[derive(Debug, Clone, Default)]
pub(super) struct EInvoiceParty {
    pub name: String,
    pub address_line: Option<String>,
    pub postcode: Option<String>,
    pub city: Option<String>,
    /// ISO 3166-1 alpha-2.
    pub country_code: Option<String>,
    pub email: Option<String>,
    pub vat_id: Option<String>,
    pub tax_number: Option<String>,
}

#[derive(Debug, Clone)]
pub(super) struct EInvoiceLine {
    pub name: String,
    pub quantity: Decimal,
    pub unit_net: Decimal,
    pub line_net: Decimal,
    pub vat_rate: Decimal,
    pub is_cost_passthrough: bool,
}

#[derive(Debug, Clone)]
pub(super) struct EInvoice {
    pub number: String,
    /// `advance`, `interim` or `final`.
    pub invoice_type: String,
    pub issue_date: NaiveDate,
    pub due_date: Option<NaiveDate>,
    pub currency: String,
    pub order_number: Option<String>,
    pub note: Option<String>,
    pub seller: EInvoiceParty,
    pub buyer: EInvoiceParty,
    pub lines: Vec<EInvoiceLine>,
    pub total_gross: Decimal,
    /// Advance payments already applied when the invoice was issued.
    pub prepaid_amount: Decimal,
    pub bank_iban: Option<String>,
    pub bank_bic: Option<String>,
    pub bank_holder: Option<String>,
}

/// Machine-readable gaps that stop a valid EN 16931 invoice from being built.
pub(super) fn missing_requirements(invoice: &EInvoice) -> Vec<&'static str> {
    let blank = |value: &Option<String>| value.as_deref().is_none_or(|v| v.trim().is_empty());
    let mut missing = Vec::new();
    if invoice.seller.name.trim().is_empty() {
        missing.push("seller_name");
    }
    if blank(&invoice.seller.country_code) {
        missing.push("seller_country");
    }
    if blank(&invoice.seller.vat_id) && blank(&invoice.seller.tax_number) {
        missing.push("seller_tax_registration");
    }
    if invoice.buyer.name.trim().is_empty() {
        missing.push("buyer_name");
    }
    if blank(&invoice.buyer.country_code) {
        missing.push("buyer_country");
    }
    if invoice.lines.is_empty() {
        missing.push("invoice_lines");
    }
    if invoice.lines.iter().any(|line| line.name.trim().is_empty()) {
        missing.push("line_name");
    }
    missing
}

/// Splits "Musterstraße 1, 80331 München" into street, postcode and city.
pub(super) fn split_german_address(raw: &str) -> (Option<String>, Option<String>, Option<String>) {
    let parts: Vec<&str> = raw
        .split([',', '\n'])
        .map(str::trim)
        .filter(|part| !part.is_empty())
        .collect();
    for (index, part) in parts.iter().enumerate().rev() {
        let mut words = part.splitn(2, char::is_whitespace);
        let (Some(first), Some(rest)) = (words.next(), words.next()) else {
            continue;
        };
        if (4..=5).contains(&first.len()) && first.chars().all(|c| c.is_ascii_digit()) {
            let street = parts[..index].join(", ");
            return (
                (!street.is_empty()).then_some(street),
                Some(first.to_string()),
                Some(rest.trim().to_string()),
            );
        }
    }
    let line = parts.join(", ");
    ((!line.is_empty()).then_some(line), None, None)
}

fn escape(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for c in value.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            // XML 1.0 forbids most control characters.
            c if c.is_control() && !matches!(c, '\n' | '\t') => {}
            c => out.push(c),
        }
    }
    out
}

fn round_cents(value: Decimal) -> Decimal {
    value.round_dp_with_strategy(2, RoundingStrategy::MidpointAwayFromZero)
}

fn vat_amount(basis: Decimal, rate: Decimal) -> Decimal {
    round_cents(basis * rate / Decimal::ONE_HUNDRED)
}

fn money(value: Decimal) -> String {
    format!("{:.2}", round_cents(value))
}

fn plain(value: Decimal) -> String {
    value.normalize().to_string()
}

fn date(value: NaiveDate) -> String {
    format!(
        r#"<udt:DateTimeString format="102">{}</udt:DateTimeString>"#,
        value.format("%Y%m%d")
    )
}

fn text(value: &Option<String>) -> Option<&str> {
    value.as_deref().map(str::trim).filter(|v| !v.is_empty())
}

struct TaxGroup {
    category: &'static str,
    rate: Decimal,
    /// Every exemption that applies to lines of this group, in line order.
    exemptions: Vec<&'static str>,
    basis: Decimal,
}

impl TaxGroup {
    fn exemption_reason(&self) -> Option<String> {
        (!self.exemptions.is_empty()).then(|| self.exemptions.join("; "))
    }
    fn exemption_code(&self) -> Option<&'static str> {
        (self.exemptions == [ZERO_RATE_EXEMPTION]).then_some(ZERO_RATE_EXEMPTION_CODE)
    }
}

fn line_tax(line: &EInvoiceLine) -> (&'static str, Option<&'static str>) {
    if line.vat_rate > Decimal::ZERO {
        ("S", None)
    } else if line.is_cost_passthrough {
        ("E", Some(PASSTHROUGH_EXEMPTION))
    } else {
        ("E", Some(ZERO_RATE_EXEMPTION))
    }
}

/// One breakdown per category and rate. EN 16931 allows exactly one exempt
/// breakdown (BR-E-01), so medical care and pass-through items share it.
fn tax_groups(lines: &[EInvoiceLine]) -> Vec<TaxGroup> {
    let mut groups: Vec<TaxGroup> = Vec::new();
    for line in lines {
        let (category, exemption) = line_tax(line);
        let group = match groups
            .iter_mut()
            .position(|group| group.category == category && group.rate == line.vat_rate)
        {
            Some(index) => &mut groups[index],
            None => {
                groups.push(TaxGroup {
                    category,
                    rate: line.vat_rate,
                    exemptions: Vec::new(),
                    basis: Decimal::ZERO,
                });
                groups.last_mut().expect("just pushed")
            }
        };
        group.basis += line.line_net;
        if let Some(exemption) = exemption
            && !group.exemptions.contains(&exemption)
        {
            group.exemptions.push(exemption);
        }
    }
    groups
}

fn party_xml(tag: &str, party: &EInvoiceParty) -> String {
    let mut xml = format!("<ram:{tag}>");
    // BR-CO-26: a seller without a VAT id still needs an identifier (BT-29);
    // the tax number serves as one and is repeated as BT-32 below.
    if tag == "SellerTradeParty"
        && text(&party.vat_id).is_none()
        && let Some(tax_number) = text(&party.tax_number)
    {
        xml.push_str(&format!("<ram:ID>{}</ram:ID>", escape(tax_number)));
    }
    xml.push_str(&format!(
        "<ram:Name>{}</ram:Name>",
        escape(party.name.trim())
    ));
    xml.push_str("<ram:PostalTradeAddress>");
    if let Some(postcode) = text(&party.postcode) {
        xml.push_str(&format!(
            "<ram:PostcodeCode>{}</ram:PostcodeCode>",
            escape(postcode)
        ));
    }
    if let Some(line) = text(&party.address_line) {
        xml.push_str(&format!("<ram:LineOne>{}</ram:LineOne>", escape(line)));
    }
    if let Some(city) = text(&party.city) {
        xml.push_str(&format!("<ram:CityName>{}</ram:CityName>", escape(city)));
    }
    xml.push_str(&format!(
        "<ram:CountryID>{}</ram:CountryID></ram:PostalTradeAddress>",
        escape(text(&party.country_code).unwrap_or_default())
    ));
    if let Some(email) = text(&party.email) {
        xml.push_str(&format!(
            r#"<ram:URIUniversalCommunication><ram:URIID schemeID="EM">{}</ram:URIID></ram:URIUniversalCommunication>"#,
            escape(email)
        ));
    }
    for (scheme, value) in [("VA", &party.vat_id), ("FC", &party.tax_number)] {
        if let Some(value) = text(value) {
            xml.push_str(&format!(
                r#"<ram:SpecifiedTaxRegistration><ram:ID schemeID="{scheme}">{}</ram:ID></ram:SpecifiedTaxRegistration>"#,
                escape(value)
            ));
        }
    }
    xml.push_str(&format!("</ram:{tag}>"));
    xml
}

/// EN 16931 invoice in CII syntax. Call `missing_requirements` first.
pub(super) fn build_cii_xml(invoice: &EInvoice) -> String {
    let currency = escape(invoice.currency.trim());
    let groups = tax_groups(&invoice.lines);
    let line_total: Decimal = invoice.lines.iter().map(|line| line.line_net).sum();
    let tax_total: Decimal = groups
        .iter()
        .map(|group| vat_amount(group.basis, group.rate))
        .sum();
    let grand_total = line_total + tax_total;
    // Per-line VAT rounding on the stored invoice may differ by a cent from
    // the per-category VAT the standard prescribes (BR-CO-17).
    let rounding = invoice.total_gross - grand_total;
    let due = grand_total - invoice.prepaid_amount + rounding;

    let mut xml = String::from(concat!(
        r#"<?xml version="1.0" encoding="UTF-8"?>"#,
        r#"<rsm:CrossIndustryInvoice"#,
        r#" xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100""#,
        r#" xmlns:qdt="urn:un:unece:uncefact:data:standard:QualifiedDataType:100""#,
        r#" xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100""#,
        r#" xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100">"#,
    ));
    xml.push_str(&format!(
        "<rsm:ExchangedDocumentContext><ram:GuidelineSpecifiedDocumentContextParameter><ram:ID>{EN16931_GUIDELINE}</ram:ID></ram:GuidelineSpecifiedDocumentContextParameter></rsm:ExchangedDocumentContext>"
    ));
    // 386 = prepayment invoice, 380 = commercial invoice.
    let type_code = if invoice.invoice_type == "advance" {
        "386"
    } else {
        "380"
    };
    xml.push_str(&format!(
        "<rsm:ExchangedDocument><ram:ID>{}</ram:ID><ram:TypeCode>{type_code}</ram:TypeCode><ram:IssueDateTime>{}</ram:IssueDateTime>",
        escape(invoice.number.trim()),
        date(invoice.issue_date)
    ));
    if let Some(note) = text(&invoice.note) {
        xml.push_str(&format!(
            "<ram:IncludedNote><ram:Content>{}</ram:Content></ram:IncludedNote>",
            escape(note)
        ));
    }
    xml.push_str("</rsm:ExchangedDocument><rsm:SupplyChainTradeTransaction>");

    for (index, line) in invoice.lines.iter().enumerate() {
        let (category, _) = line_tax(line);
        xml.push_str(&format!(
            concat!(
                "<ram:IncludedSupplyChainTradeLineItem>",
                "<ram:AssociatedDocumentLineDocument><ram:LineID>{id}</ram:LineID></ram:AssociatedDocumentLineDocument>",
                "<ram:SpecifiedTradeProduct><ram:Name>{name}</ram:Name></ram:SpecifiedTradeProduct>",
                "<ram:SpecifiedLineTradeAgreement><ram:NetPriceProductTradePrice><ram:ChargeAmount>{price}</ram:ChargeAmount></ram:NetPriceProductTradePrice></ram:SpecifiedLineTradeAgreement>",
                "<ram:SpecifiedLineTradeDelivery><ram:BilledQuantity unitCode=\"C62\">{quantity}</ram:BilledQuantity></ram:SpecifiedLineTradeDelivery>",
                "<ram:SpecifiedLineTradeSettlement>",
                "<ram:ApplicableTradeTax><ram:TypeCode>VAT</ram:TypeCode><ram:CategoryCode>{category}</ram:CategoryCode><ram:RateApplicablePercent>{rate}</ram:RateApplicablePercent></ram:ApplicableTradeTax>",
                "<ram:SpecifiedTradeSettlementLineMonetarySummation><ram:LineTotalAmount>{net}</ram:LineTotalAmount></ram:SpecifiedTradeSettlementLineMonetarySummation>",
                "</ram:SpecifiedLineTradeSettlement>",
                "</ram:IncludedSupplyChainTradeLineItem>",
            ),
            id = index + 1,
            name = escape(line.name.trim()),
            price = plain(line.unit_net),
            quantity = plain(line.quantity),
            category = category,
            rate = plain(line.vat_rate),
            net = money(line.line_net),
        ));
    }

    xml.push_str("<ram:ApplicableHeaderTradeAgreement>");
    xml.push_str(&party_xml("SellerTradeParty", &invoice.seller));
    xml.push_str(&party_xml("BuyerTradeParty", &invoice.buyer));
    if let Some(order_number) = text(&invoice.order_number) {
        xml.push_str(&format!(
            "<ram:BuyerOrderReferencedDocument><ram:IssuerAssignedID>{}</ram:IssuerAssignedID></ram:BuyerOrderReferencedDocument>",
            escape(order_number)
        ));
    }
    xml.push_str("</ram:ApplicableHeaderTradeAgreement><ram:ApplicableHeaderTradeDelivery/>");

    xml.push_str(&format!(
        "<ram:ApplicableHeaderTradeSettlement><ram:PaymentReference>{}</ram:PaymentReference><ram:InvoiceCurrencyCode>{currency}</ram:InvoiceCurrencyCode>",
        escape(invoice.number.trim())
    ));
    if let Some(iban) = text(&invoice.bank_iban) {
        // 58 = SEPA credit transfer.
        xml.push_str(&format!(
            "<ram:SpecifiedTradeSettlementPaymentMeans><ram:TypeCode>58</ram:TypeCode><ram:PayeePartyCreditorFinancialAccount><ram:IBANID>{}</ram:IBANID>",
            escape(&iban.replace(char::is_whitespace, ""))
        ));
        if let Some(holder) = text(&invoice.bank_holder) {
            xml.push_str(&format!(
                "<ram:AccountName>{}</ram:AccountName>",
                escape(holder)
            ));
        }
        xml.push_str("</ram:PayeePartyCreditorFinancialAccount>");
        if let Some(bic) = text(&invoice.bank_bic) {
            xml.push_str(&format!(
                "<ram:PayeeSpecifiedCreditorFinancialInstitution><ram:BICID>{}</ram:BICID></ram:PayeeSpecifiedCreditorFinancialInstitution>",
                escape(bic)
            ));
        }
        xml.push_str("</ram:SpecifiedTradeSettlementPaymentMeans>");
    }
    for group in &groups {
        xml.push_str(&format!(
            "<ram:ApplicableTradeTax><ram:CalculatedAmount>{}</ram:CalculatedAmount><ram:TypeCode>VAT</ram:TypeCode>",
            money(vat_amount(group.basis, group.rate))
        ));
        if let Some(reason) = group.exemption_reason() {
            xml.push_str(&format!(
                "<ram:ExemptionReason>{}</ram:ExemptionReason>",
                escape(&reason)
            ));
        }
        xml.push_str(&format!(
            "<ram:BasisAmount>{}</ram:BasisAmount><ram:CategoryCode>{}</ram:CategoryCode>",
            money(group.basis),
            group.category,
        ));
        if let Some(code) = group.exemption_code() {
            xml.push_str(&format!(
                "<ram:ExemptionReasonCode>{code}</ram:ExemptionReasonCode>"
            ));
        }
        xml.push_str(&format!(
            "<ram:RateApplicablePercent>{}</ram:RateApplicablePercent></ram:ApplicableTradeTax>",
            plain(group.rate)
        ));
    }
    if let Some(due_date) = invoice.due_date {
        xml.push_str(&format!(
            "<ram:SpecifiedTradePaymentTerms><ram:DueDateDateTime>{}</ram:DueDateDateTime></ram:SpecifiedTradePaymentTerms>",
            date(due_date)
        ));
    }
    xml.push_str(&format!(
        "<ram:SpecifiedTradeSettlementHeaderMonetarySummation><ram:LineTotalAmount>{line}</ram:LineTotalAmount><ram:TaxBasisTotalAmount>{line}</ram:TaxBasisTotalAmount><ram:TaxTotalAmount currencyID=\"{currency}\">{tax}</ram:TaxTotalAmount>",
        line = money(line_total),
        tax = money(tax_total),
    ));
    if !round_cents(rounding).is_zero() {
        xml.push_str(&format!(
            "<ram:RoundingAmount>{}</ram:RoundingAmount>",
            money(rounding)
        ));
    }
    xml.push_str(&format!(
        "<ram:GrandTotalAmount>{}</ram:GrandTotalAmount><ram:TotalPrepaidAmount>{}</ram:TotalPrepaidAmount><ram:DuePayableAmount>{}</ram:DuePayableAmount></ram:SpecifiedTradeSettlementHeaderMonetarySummation>",
        money(grand_total),
        money(invoice.prepaid_amount),
        money(due)
    ));
    xml.push_str(
        "</ram:ApplicableHeaderTradeSettlement></rsm:SupplyChainTradeTransaction></rsm:CrossIndustryInvoice>",
    );
    xml
}

fn xmp_metadata(invoice_number: &str, created_at: &str) -> String {
    format!(
        concat!(
            "<?xpacket begin=\"\u{feff}\" id=\"W5M0MpCehiHzreSzNTczkc9d\"?>",
            r#"<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">"#,
            r#"<rdf:Description rdf:about="" xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/"><pdfaid:part>3</pdfaid:part><pdfaid:conformance>B</pdfaid:conformance></rdf:Description>"#,
            r#"<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title><rdf:Alt><rdf:li xml:lang="x-default">{title}</rdf:li></rdf:Alt></dc:title></rdf:Description>"#,
            r#"<rdf:Description rdf:about="" xmlns:xmp="http://ns.adobe.com/xap/1.0/"><xmp:CreateDate>{created}</xmp:CreateDate><xmp:ModifyDate>{created}</xmp:ModifyDate><xmp:CreatorTool>GMed</xmp:CreatorTool></rdf:Description>"#,
            r#"<rdf:Description rdf:about="" xmlns:pdfaExtension="http://www.aiim.org/pdfa/ns/extension/" xmlns:pdfaSchema="http://www.aiim.org/pdfa/ns/schema#" xmlns:pdfaProperty="http://www.aiim.org/pdfa/ns/property#">"#,
            r#"<pdfaExtension:schemas><rdf:Bag><rdf:li rdf:parseType="Resource">"#,
            r#"<pdfaSchema:schema>Factur-X PDFA Extension Schema</pdfaSchema:schema>"#,
            r#"<pdfaSchema:namespaceURI>urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#</pdfaSchema:namespaceURI>"#,
            r#"<pdfaSchema:prefix>fx</pdfaSchema:prefix><pdfaSchema:property><rdf:Seq>"#,
            r#"<rdf:li rdf:parseType="Resource"><pdfaProperty:name>DocumentFileName</pdfaProperty:name><pdfaProperty:valueType>Text</pdfaProperty:valueType><pdfaProperty:category>external</pdfaProperty:category><pdfaProperty:description>Name of the embedded XML invoice file</pdfaProperty:description></rdf:li>"#,
            r#"<rdf:li rdf:parseType="Resource"><pdfaProperty:name>DocumentType</pdfaProperty:name><pdfaProperty:valueType>Text</pdfaProperty:valueType><pdfaProperty:category>external</pdfaProperty:category><pdfaProperty:description>INVOICE</pdfaProperty:description></rdf:li>"#,
            r#"<rdf:li rdf:parseType="Resource"><pdfaProperty:name>Version</pdfaProperty:name><pdfaProperty:valueType>Text</pdfaProperty:valueType><pdfaProperty:category>external</pdfaProperty:category><pdfaProperty:description>Version of the Factur-X XML schema</pdfaProperty:description></rdf:li>"#,
            r#"<rdf:li rdf:parseType="Resource"><pdfaProperty:name>ConformanceLevel</pdfaProperty:name><pdfaProperty:valueType>Text</pdfaProperty:valueType><pdfaProperty:category>external</pdfaProperty:category><pdfaProperty:description>Conformance level of the embedded XML invoice</pdfaProperty:description></rdf:li>"#,
            r#"</rdf:Seq></pdfaSchema:property></rdf:li></rdf:Bag></pdfaExtension:schemas></rdf:Description>"#,
            r#"<rdf:Description rdf:about="" xmlns:fx="urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#"><fx:DocumentType>INVOICE</fx:DocumentType><fx:DocumentFileName>{file}</fx:DocumentFileName><fx:Version>1.0</fx:Version><fx:ConformanceLevel>EN 16931</fx:ConformanceLevel></rdf:Description>"#,
            r#"</rdf:RDF></x:xmpmeta><?xpacket end="w"?>"#,
        ),
        title = escape(invoice_number),
        created = created_at,
        file = ZUGFERD_XML_FILENAME,
    )
}

fn pdf_string(value: &str) -> Object {
    Object::String(value.as_bytes().to_vec(), StringFormat::Literal)
}

fn is_cid_font_type2(dict: &Dictionary) -> bool {
    dict.get(b"Subtype").and_then(Object::as_name).ok() == Some(b"CIDFontType2".as_slice())
}

/// PDF/A-3 (ISO 19005-3, 6.2.11.3.2): every embedded Type 2 CIDFont declares
/// its CID-to-glyph mapping. The renderer writes the descendant font inline in
/// the Type0 font's `DescendantFonts` array, so both inline and referenced
/// dictionaries are patched; the TrueType subsets use the identity mapping.
fn declare_cid_to_gid_maps(document: &mut lopdf::Document) {
    let ids: Vec<lopdf::ObjectId> = document.objects.keys().copied().collect();
    let mut referenced = Vec::new();
    for id in ids {
        let Some(Object::Dictionary(dict)) = document.objects.get_mut(&id) else {
            continue;
        };
        if is_cid_font_type2(dict) && dict.get(b"CIDToGIDMap").is_err() {
            dict.set("CIDToGIDMap", "Identity");
        }
        if let Ok(Object::Array(descendants)) = dict.get_mut(b"DescendantFonts") {
            for descendant in descendants.iter_mut() {
                match descendant {
                    Object::Dictionary(inline)
                        if is_cid_font_type2(inline) && inline.get(b"CIDToGIDMap").is_err() =>
                    {
                        inline.set("CIDToGIDMap", "Identity");
                    }
                    Object::Reference(reference) => referenced.push(*reference),
                    _ => {}
                }
            }
        }
    }
    for id in referenced {
        if let Some(Object::Dictionary(dict)) = document.objects.get_mut(&id)
            && is_cid_font_type2(dict)
            && dict.get(b"CIDToGIDMap").is_err()
        {
            dict.set("CIDToGIDMap", "Identity");
        }
    }
}

/// Attaches the CII XML to the rendered invoice PDF the way ZUGFeRD readers
/// expect it: an associated file named `factur-x.xml` plus the Factur-X XMP block.
pub(super) fn embed_xml_in_pdf(
    pdf: &[u8],
    xml: &str,
    invoice_number: &str,
    issued_at: chrono::DateTime<chrono::Utc>,
) -> Result<Vec<u8>, String> {
    let mut document =
        lopdf::Document::load_mem(pdf).map_err(|error| format!("load invoice pdf: {error}"))?;
    let pdf_date = issued_at.format("D:%Y%m%d%H%M%S+00'00'").to_string();

    let mut file_dict = dictionary! {
        "Type" => "EmbeddedFile",
        "Subtype" => Object::Name(b"text/xml".to_vec()),
        "Params" => dictionary! {
            "ModDate" => pdf_string(&pdf_date),
            "Size" => xml.len() as i64,
        },
    };
    file_dict.set("Length", xml.len() as i64);
    let file_id = document.add_object(Stream::new(file_dict, xml.as_bytes().to_vec()));
    let filespec_id = document.add_object(dictionary! {
        "Type" => "Filespec",
        "F" => pdf_string(ZUGFERD_XML_FILENAME),
        "UF" => pdf_string(ZUGFERD_XML_FILENAME),
        "Desc" => pdf_string("Factur-X/ZUGFeRD invoice (EN 16931)"),
        "AFRelationship" => "Alternative",
        "EF" => dictionary! { "F" => file_id, "UF" => file_id },
    });

    let xmp = xmp_metadata(
        invoice_number,
        &issued_at.format("%Y-%m-%dT%H:%M:%SZ").to_string(),
    );
    // XMP must stay readable without decompression.
    let metadata_id = document.add_object(
        Stream::new(
            dictionary! { "Type" => "Metadata", "Subtype" => "XML" },
            xmp.into_bytes(),
        )
        .with_compression(false),
    );

    // PDF/A-3 (ISO 19005-3, 6.2.4.3): device colour spaces need an output
    // intent with an embedded ICC profile; the pages draw in DeviceRGB.
    let icc_id = document.add_object(Stream::new(
        dictionary! { "N" => 3, "Alternate" => "DeviceRGB" },
        SRGB_ICC_PROFILE.to_vec(),
    ));
    let intent_id = document.add_object(dictionary! {
        "Type" => "OutputIntent",
        "S" => "GTS_PDFA1",
        "OutputConditionIdentifier" => pdf_string("sRGB"),
        "Info" => pdf_string("sRGB IEC61966-2.1"),
        "RegistryName" => pdf_string("http://www.color.org"),
        "DestOutputProfile" => icc_id,
    });
    declare_cid_to_gid_maps(&mut document);

    let catalog = document
        .catalog_mut()
        .map_err(|error| format!("read pdf catalog: {error}"))?;
    catalog.set("OutputIntents", vec![Object::Reference(intent_id)]);
    let mut names = match catalog.get(b"Names") {
        Ok(Object::Dictionary(existing)) => existing.clone(),
        _ => Dictionary::new(),
    };
    names.set(
        "EmbeddedFiles",
        dictionary! {
            "Names" => vec![pdf_string(ZUGFERD_XML_FILENAME), Object::Reference(filespec_id)],
        },
    );
    catalog.set("Names", names);
    catalog.set("AF", vec![Object::Reference(filespec_id)]);
    catalog.set("Metadata", metadata_id);

    let mut output = Vec::new();
    document
        .save_to(&mut output)
        .map_err(|error| format!("write zugferd pdf: {error}"))?;
    Ok(output)
}

/// Reference invoice for the PDF tests and the CI validator run.
#[cfg(test)]
pub(super) fn test_sample() -> EInvoice {
    tests::sample()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::str::FromStr;

    fn dec(value: &str) -> Decimal {
        Decimal::from_str(value).unwrap()
    }

    pub(super) fn sample() -> EInvoice {
        EInvoice {
            number: "INV-2026-0001".to_string(),
            invoice_type: "final".to_string(),
            issue_date: NaiveDate::from_ymd_opt(2026, 9, 17).unwrap(),
            due_date: NaiveDate::from_ymd_opt(2026, 10, 1),
            currency: "EUR".to_string(),
            order_number: Some("ORD-1".to_string()),
            note: Some("Danke & bis bald <GMed>".to_string()),
            seller: EInvoiceParty {
                name: "GMed".to_string(),
                address_line: Some("Musterstraße 1".to_string()),
                postcode: Some("80331".to_string()),
                city: Some("München".to_string()),
                country_code: Some("DE".to_string()),
                email: Some("billing@example.com".to_string()),
                vat_id: Some("DE123456789".to_string()),
                tax_number: None,
            },
            buyer: EInvoiceParty {
                name: "Test Patient".to_string(),
                country_code: Some("UA".to_string()),
                ..EInvoiceParty::default()
            },
            lines: vec![
                EInvoiceLine {
                    name: "Koordination".to_string(),
                    quantity: dec("2"),
                    unit_net: dec("50"),
                    line_net: dec("100"),
                    vat_rate: dec("19"),
                    is_cost_passthrough: false,
                },
                EInvoiceLine {
                    name: "Klinikrechnung".to_string(),
                    quantity: dec("1"),
                    unit_net: dec("200"),
                    line_net: dec("200"),
                    vat_rate: dec("0"),
                    is_cost_passthrough: true,
                },
            ],
            total_gross: dec("319"),
            prepaid_amount: dec("50"),
            bank_iban: Some("DE02 1203 0000 0000 2020 51".to_string()),
            bank_bic: Some("BYLADEM1001".to_string()),
            bank_holder: Some("GMed".to_string()),
        }
    }

    #[test]
    fn xml_carries_en16931_totals_that_add_up() {
        let invoice = sample();
        assert!(missing_requirements(&invoice).is_empty());
        let xml = build_cii_xml(&invoice);
        assert!(xml.contains("<ram:ID>urn:cen.eu:en16931:2017</ram:ID>"));
        assert!(xml.contains("<ram:TypeCode>380</ram:TypeCode>"));
        assert!(xml.contains("<ram:LineTotalAmount>300.00</ram:LineTotalAmount><ram:TaxBasisTotalAmount>300.00</ram:TaxBasisTotalAmount>"));
        assert!(xml.contains(r#"<ram:TaxTotalAmount currencyID="EUR">19.00</ram:TaxTotalAmount>"#));
        assert!(xml.contains("<ram:GrandTotalAmount>319.00</ram:GrandTotalAmount><ram:TotalPrepaidAmount>50.00</ram:TotalPrepaidAmount><ram:DuePayableAmount>269.00</ram:DuePayableAmount>"));
        assert!(!xml.contains("RoundingAmount"));
        assert!(xml.contains("<ram:CategoryCode>E</ram:CategoryCode>"));
        assert!(xml.contains(PASSTHROUGH_EXEMPTION));
        // Pass-through only: no medical exemption code on the exempt breakdown.
        assert!(!xml.contains("<ram:ExemptionReasonCode>"));
        assert!(xml.contains("<ram:IBANID>DE02120300000000202051</ram:IBANID>"));
        assert!(xml.contains("Danke &amp; bis bald &lt;GMed&gt;"));
        assert!(xml.contains(r#"<udt:DateTimeString format="102">20260917</udt:DateTimeString>"#));
    }

    #[test]
    fn cent_differences_from_per_line_vat_go_into_rounding() {
        let mut invoice = sample();
        invoice.total_gross = dec("319.01");
        invoice.prepaid_amount = Decimal::ZERO;
        let xml = build_cii_xml(&invoice);
        assert!(xml.contains("<ram:RoundingAmount>0.01</ram:RoundingAmount>"));
        assert!(xml.contains("<ram:DuePayableAmount>319.01</ram:DuePayableAmount>"));
    }

    #[test]
    fn advance_invoices_use_the_prepayment_type_code() {
        let mut invoice = sample();
        invoice.invoice_type = "advance".to_string();
        assert!(build_cii_xml(&invoice).contains("<ram:TypeCode>386</ram:TypeCode>"));
    }

    #[test]
    fn reports_every_missing_mandatory_field() {
        let mut invoice = sample();
        invoice.seller.vat_id = None;
        invoice.buyer.country_code = Some(" ".to_string());
        invoice.lines.clear();
        assert_eq!(
            missing_requirements(&invoice),
            vec!["seller_tax_registration", "buyer_country", "invoice_lines"]
        );
    }

    #[test]
    fn splits_a_german_address_line() {
        assert_eq!(
            split_german_address("Musterstraße 1, 80331 München"),
            (
                Some("Musterstraße 1".to_string()),
                Some("80331".to_string()),
                Some("München".to_string())
            )
        );
        assert_eq!(
            split_german_address("Somewhere"),
            (Some("Somewhere".to_string()), None, None)
        );
    }
    #[test]
    fn embeds_the_xml_as_an_associated_file() {
        let mut source = lopdf::Document::with_version("1.7");
        let pages_id = source.new_object_id();
        let page_id = source.add_object(dictionary! { "Type" => "Page", "Parent" => pages_id });
        source.objects.insert(
            pages_id,
            Object::Dictionary(dictionary! {
                "Type" => "Pages", "Kids" => vec![page_id.into()], "Count" => 1,
            }),
        );
        let catalog_id =
            source.add_object(dictionary! { "Type" => "Catalog", "Pages" => pages_id });
        source.trailer.set("Root", catalog_id);
        let mut pdf = Vec::new();
        source.save_to(&mut pdf).unwrap();

        let xml = build_cii_xml(&sample());
        let issued_at = chrono::DateTime::from_timestamp(1_789_000_000, 0).unwrap();
        let hybrid = embed_xml_in_pdf(&pdf, &xml, "INV-2026-0001", issued_at).unwrap();

        let reloaded = lopdf::Document::load_mem(&hybrid).unwrap();
        let catalog = reloaded.catalog().unwrap();
        assert!(catalog.get(b"AF").is_ok());
        assert!(catalog.get(b"Metadata").is_ok());
        // PDF/A-3 output intent with the embedded sRGB profile.
        let intents = catalog.get(b"OutputIntents").unwrap().as_array().unwrap();
        let intent = reloaded
            .get_object(intents[0].as_reference().unwrap())
            .unwrap();
        assert_eq!(
            intent
                .as_dict()
                .unwrap()
                .get(b"S")
                .unwrap()
                .as_name()
                .unwrap(),
            b"GTS_PDFA1"
        );
        let profile_id = intent
            .as_dict()
            .unwrap()
            .get(b"DestOutputProfile")
            .unwrap()
            .as_reference()
            .unwrap();
        assert_eq!(
            reloaded
                .get_object(profile_id)
                .unwrap()
                .as_stream()
                .unwrap()
                .content,
            SRGB_ICC_PROFILE
        );
        let embedded = reloaded
            .objects
            .values()
            .filter_map(|object| object.as_stream().ok())
            .find(|stream| {
                stream.dict.get(b"Type").and_then(Object::as_name).ok()
                    == Some(b"EmbeddedFile".as_slice())
            })
            .expect("embedded file stream");
        let content = embedded
            .decompressed_content()
            .unwrap_or_else(|_| embedded.content.clone());
        assert_eq!(String::from_utf8(content).unwrap(), xml);
    }

    /// Exempt-only invoice from a seller without a USt-IdNr., the situation
    /// of a provider whose turnover is § 4 Nr. 14 UStG medical care.
    fn sample_exempt_only() -> EInvoice {
        let mut invoice = sample();
        invoice.number = "INV-2026-0002".to_string();
        invoice.seller.vat_id = None;
        invoice.seller.tax_number = Some("143/123/45678".to_string());
        invoice.lines = vec![
            EInvoiceLine {
                name: "Ärztliche Konsultation".to_string(),
                quantity: dec("1"),
                unit_net: dec("145"),
                line_net: dec("145"),
                vat_rate: dec("0"),
                is_cost_passthrough: false,
            },
            EInvoiceLine {
                name: "Klinikanzahlung".to_string(),
                quantity: dec("1"),
                unit_net: dec("1000"),
                line_net: dec("1000"),
                vat_rate: dec("0"),
                is_cost_passthrough: true,
            },
        ];
        invoice.total_gross = dec("1145");
        invoice.prepaid_amount = Decimal::ZERO;
        invoice
    }

    #[test]
    fn exempt_lines_share_one_breakdown_and_a_seller_without_vat_id_is_identified() {
        let xml = build_cii_xml(&sample_exempt_only());
        assert_eq!(
            xml.matches("<ram:CategoryCode>E</ram:CategoryCode>")
                .count(),
            3
        );
        assert_eq!(xml.matches("<ram:ExemptionReason>").count(), 1);
        assert!(xml.contains(&format!("{ZERO_RATE_EXEMPTION}; {PASSTHROUGH_EXEMPTION}")));
        assert!(!xml.contains("<ram:ExemptionReasonCode>"));
        assert!(xml.contains("<ram:BasisAmount>1145.00</ram:BasisAmount>"));
        assert!(xml.contains("<ram:SellerTradeParty><ram:ID>143/123/45678</ram:ID>"));
        assert!(xml.contains(r#"<ram:ID schemeID="FC">143/123/45678</ram:ID>"#));
        let mut medical_only = sample_exempt_only();
        medical_only.lines.truncate(1);
        medical_only.total_gross = dec("145");
        let xml = build_cii_xml(&medical_only);
        assert!(xml.contains("<ram:ExemptionReasonCode>VATEX-EU-132</ram:ExemptionReasonCode>"));
        let with_vat_id = sample();
        assert!(!build_cii_xml(&with_vat_id).contains("<ram:SellerTradeParty><ram:ID>"));
    }

    #[test]
    fn every_cid_font_gets_a_cid_to_gid_map() {
        let mut document = lopdf::Document::with_version("1.7");
        let referenced =
            document.add_object(dictionary! { "Type" => "Font", "Subtype" => "CIDFontType2" });
        let type0 = document.add_object(dictionary! {
            "Type" => "Font", "Subtype" => "Type0",
            "DescendantFonts" => vec![
                Object::Dictionary(dictionary! { "Type" => "Font", "Subtype" => "CIDFontType2" }),
                Object::Reference(referenced),
            ],
        });
        declare_cid_to_gid_maps(&mut document);
        let identity = Object::Name(b"Identity".to_vec());
        let type0 = document.get_object(type0).unwrap().as_dict().unwrap();
        let inline = type0.get(b"DescendantFonts").unwrap().as_array().unwrap()[0]
            .as_dict()
            .unwrap();
        assert_eq!(inline.get(b"CIDToGIDMap").unwrap(), &identity);
        let referenced = document.get_object(referenced).unwrap().as_dict().unwrap();
        assert_eq!(referenced.get(b"CIDToGIDMap").unwrap(), &identity);
    }

    /// CI validates these files with the official EN 16931 rules (Mustang).
    #[test]
    fn samples_can_be_exported_for_external_validation() {
        let Ok(dir) = std::env::var("EINVOICE_SAMPLE_DIR") else {
            return;
        };
        std::fs::create_dir_all(&dir).unwrap();
        for invoice in [sample(), sample_exempt_only()] {
            assert!(missing_requirements(&invoice).is_empty());
            let path = std::path::Path::new(&dir).join(format!("{}.xml", invoice.number));
            std::fs::write(path, build_cii_xml(&invoice)).unwrap();
        }
    }
}
