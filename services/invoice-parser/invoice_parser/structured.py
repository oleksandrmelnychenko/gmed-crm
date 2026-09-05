"""Read UBL/CII invoice facts. Basic checks, not XRechnung certification.

Only namespace-qualified invoice paths are used; extension content, buyer IDs,
external links and accounting-currency totals cannot impersonate header fields.
"""
from datetime import date
from decimal import Decimal, InvalidOperation
from io import BytesIO
import re

from defusedxml.ElementTree import iterparse

MAX_XML_BYTES = 5 * 1024 * 1024
NS = {
    "ubl": "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2",
    "credit": "urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2",
    "cac": "urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2",
    "cbc": "urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2",
    "rsm": "urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100",
    "ram": "urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100",
    "udt": "urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100",
}
FIELD_NAMES = ("supplier_name", "external_invoice_number", "invoice_date", "due_date",
               "amount_net", "amount_vat", "amount_gross", "currency")


class InvalidInvoiceXml(ValueError):
    """Stable error without document contents."""


def safe_xml(data: bytes):
    if not data or len(data) > MAX_XML_BYTES:
        raise InvalidInvoiceXml("xml_size_limit")
    try:
        text = data.decode("utf-8-sig")
        if "\x00" in text or re.search(r"<\?(?!xml\s)[\s\S]*?\?>", text, re.I):
            raise ValueError()
        declaration = re.match(r"\s*<\?xml\s+[^?]*encoding\s*=\s*['\"]([^'\"]+)", text, re.I)
        if declaration and declaration[1].upper() not in {"UTF-8", "UTF8"}:
            raise ValueError()
        depth = count = 0
        iterator = iterparse(BytesIO(data), events=("start", "end"),
                             forbid_dtd=True, forbid_entities=True, forbid_external=True)
        for event, _ in iterator:
            if event == "start":
                depth += 1
                count += 1
                if depth > 64 or count > 25000:
                    raise ValueError()
            else:
                depth -= 1
        return iterator.root
    except Exception as exc:
        raise InvalidInvoiceXml("invalid_invoice_xml") from exc


def parse_xml_invoice(data: bytes) -> dict:
    root = safe_xml(data)
    if root.tag == f'{{{NS["rsm"]}}}CrossIndustryInvoice':
        syntax = "cii"
    elif root.tag in {f'{{{NS["ubl"]}}}Invoice', f'{{{NS["credit"]}}}CreditNote'}:
        syntax = "ubl"
    else:
        raise InvalidInvoiceXml("unsupported_xml_document")
    warnings = []
    fields = dict.fromkeys(FIELD_NAMES)

    def find(path, parent=root):
        return parent.findall(path, NS)

    def single(nodes, key):
        if len(nodes) != 1:
            if nodes:
                warnings.append(f"invalid_or_ambiguous_{key}")
            return None
        node = nodes[0]
        if len(node) or node.text is None or not node.text.strip():
            warnings.append(f"invalid_or_ambiguous_{key}")
            return None
        return node

    def string(path, key, parent=root, limit=500):
        node = single(find(path, parent), key)
        if node is None:
            return None
        value = " ".join(node.text.split())
        if len(value) > limit:
            warnings.append(f"invalid_or_ambiguous_{key}")
            return None
        return value

    def money(path, key, parent=root, *, currency_required=False, decimals=2, select_currency=False):
        nodes = find(path, parent)
        if select_currency:
            nodes = [node for node in nodes if node.get("currencyID") == fields["currency"]]
        node = single(nodes, key)
        if node is None:
            return None
        currency = node.get("currencyID")
        if currency and currency != fields["currency"] or currency_required and not currency:
            warnings.append(f"invalid_or_ambiguous_{key}")
            warnings.append("structured_currency_mismatch")
            return None
        value = node.text.strip()
        try:
            if not re.fullmatch(rf"[+-]?\d{{1,12}}(?:\.\d{{1,{decimals}}})?", value):
                raise ValueError()
            amount = Decimal(value)
            if not amount.is_finite() or abs(amount) > Decimal("999999999999.99"):
                raise ValueError()
            return format(amount, ".2f") if decimals == 2 else format(amount, "f")
        except (ValueError, InvalidOperation):
            warnings.append(f"invalid_or_ambiguous_{key}")
            return None

    def xml_date(path, key, parent=root):
        node = single(find(path, parent), key)
        if node is None:
            return None
        raw = node.text.strip()
        if syntax == "cii":
            if node.get("format") != "102" or not re.fullmatch(r"\d{8}", raw):
                warnings.append(f"invalid_or_ambiguous_{key}")
                return None
            raw = f"{raw[:4]}-{raw[4:6]}-{raw[6:]}"
        try:
            if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", raw):
                raise ValueError()
            return date.fromisoformat(raw).isoformat()
        except ValueError:
            warnings.append(f"invalid_or_ambiguous_{key}")
            return None

    if syntax == "ubl":
        credit = root.tag == f'{{{NS["credit"]}}}CreditNote'
        profile = string("cbc:CustomizationID", "profile")
        document_type = "381" if credit else string("cbc:InvoiceTypeCode", "document_type")
        fields["currency"] = string("cbc:DocumentCurrencyCode", "currency", limit=3)
        fields["external_invoice_number"] = string("cbc:ID", "external_invoice_number", limit=100)
        fields["invoice_date"] = xml_date("cbc:IssueDate", "invoice_date")
        fields["due_date"] = xml_date("cbc:DueDate", "due_date")
        fields["supplier_name"] = string("cac:AccountingSupplierParty/cac:Party/cac:PartyLegalEntity/cbc:RegistrationName", "supplier_name")
        if fields["supplier_name"] is None and "invalid_or_ambiguous_supplier_name" not in warnings:
            fields["supplier_name"] = string("cac:AccountingSupplierParty/cac:Party/cac:PartyName/cbc:Name", "supplier_name")
        recipient = string("cac:AccountingCustomerParty/cac:Party/cac:PartyLegalEntity/cbc:RegistrationName", "recipient_name")
        if recipient is None and "invalid_or_ambiguous_recipient_name" not in warnings:
            recipient = string("cac:AccountingCustomerParty/cac:Party/cac:PartyName/cbc:Name", "recipient_name")
        total = "cac:LegalMonetaryTotal/"
        fields["amount_net"] = money(total + "cbc:TaxExclusiveAmount", "amount_net", currency_required=True)
        fields["amount_gross"] = money(total + "cbc:TaxInclusiveAmount", "amount_gross", currency_required=True)
        fields["amount_vat"] = money("cac:TaxTotal/cbc:TaxAmount", "amount_vat", select_currency=True)
        amount_due = money(total + "cbc:PayableAmount", "amount_due", currency_required=True)
        prepaid = money(total + "cbc:PrepaidAmount", "prepaid", currency_required=True)
        rounding = money(total + "cbc:PayableRoundingAmount", "rounding", currency_required=True)
        allowance = money(total + "cbc:AllowanceTotalAmount", "allowance", currency_required=True)
        charge = money(total + "cbc:ChargeTotalAmount", "charge", currency_required=True)
        line_total = money(total + "cbc:LineExtensionAmount", "line_total", currency_required=True)
        term_nodes = find("cac:PaymentTerms/cbc:Note")
        tax_nodes = [node for tax in find("cac:TaxTotal") for node in find("cac:TaxSubtotal", tax)
                     if any(amount.get("currencyID") == fields["currency"] for amount in find("cbc:TaxAmount", tax))]
        item_nodes = find("cac:CreditNoteLine" if credit else "cac:InvoiceLine")
        item_paths = {"name": "cac:Item/cbc:Name", "position": "cbc:ID", "qty": "cbc:CreditedQuantity" if credit else "cbc:InvoicedQuantity",
                      "unit_price": "cac:Price/cbc:PriceAmount", "price_base_quantity": "cac:Price/cbc:BaseQuantity",
                      "price_subtotal": "cbc:LineExtensionAmount", "vat_rate": "cac:Item/cac:ClassifiedTaxCategory/cbc:Percent"}
        tax_paths = {"category": "cac:TaxCategory/cbc:ID", "rate": "cac:TaxCategory/cbc:Percent", "amount": "cbc:TaxAmount", "base": "cbc:TaxableAmount"}
    else:
        agreement = "rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeAgreement/"
        settlement = "rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeSettlement/"
        total = settlement + "ram:SpecifiedTradeSettlementHeaderMonetarySummation/"
        profile = string("rsm:ExchangedDocumentContext/ram:GuidelineSpecifiedDocumentContextParameter/ram:ID", "profile")
        document_type = string("rsm:ExchangedDocument/ram:TypeCode", "document_type")
        fields["currency"] = string(settlement + "ram:InvoiceCurrencyCode", "currency", limit=3)
        fields["external_invoice_number"] = string("rsm:ExchangedDocument/ram:ID", "external_invoice_number", limit=100)
        fields["invoice_date"] = xml_date("rsm:ExchangedDocument/ram:IssueDateTime/udt:DateTimeString", "invoice_date")
        fields["due_date"] = xml_date(settlement + "ram:SpecifiedTradePaymentTerms/ram:DueDateDateTime/udt:DateTimeString", "due_date")
        fields["supplier_name"] = string(agreement + "ram:SellerTradeParty/ram:Name", "supplier_name")
        recipient = string(agreement + "ram:BuyerTradeParty/ram:Name", "recipient_name")
        fields["amount_net"] = money(total + "ram:TaxBasisTotalAmount", "amount_net")
        fields["amount_gross"] = money(total + "ram:GrandTotalAmount", "amount_gross")
        fields["amount_vat"] = money(total + "ram:TaxTotalAmount", "amount_vat", select_currency=True)
        amount_due = money(total + "ram:DuePayableAmount", "amount_due")
        prepaid = money(total + "ram:TotalPrepaidAmount", "prepaid")
        rounding = money(total + "ram:RoundingAmount", "rounding")
        allowance = money(total + "ram:AllowanceTotalAmount", "allowance")
        charge = money(total + "ram:ChargeTotalAmount", "charge")
        line_total = money(total + "ram:LineTotalAmount", "line_total")
        term_nodes = find(settlement + "ram:SpecifiedTradePaymentTerms/ram:Description")
        tax_nodes = find(settlement + "ram:ApplicableTradeTax")
        item_nodes = find("rsm:SupplyChainTradeTransaction/ram:IncludedSupplyChainTradeLineItem")
        item_paths = {"name": "ram:SpecifiedTradeProduct/ram:Name", "position": "ram:AssociatedDocumentLineDocument/ram:LineID",
                      "qty": "ram:SpecifiedLineTradeDelivery/ram:BilledQuantity", "unit_price": "ram:SpecifiedLineTradeAgreement/ram:NetPriceProductTradePrice/ram:ChargeAmount",
                      "price_base_quantity": "ram:SpecifiedLineTradeAgreement/ram:NetPriceProductTradePrice/ram:BasisQuantity",
                      "price_subtotal": "ram:SpecifiedLineTradeSettlement/ram:SpecifiedTradeSettlementLineMonetarySummation/ram:LineTotalAmount",
                      "vat_rate": "ram:SpecifiedLineTradeSettlement/ram:ApplicableTradeTax/ram:RateApplicablePercent"}
        tax_paths = {"category": "ram:CategoryCode", "rate": "ram:RateApplicablePercent", "amount": "ram:CalculatedAmount", "base": "ram:BasisAmount"}

    if fields["currency"] and not re.fullmatch(r"[A-Z]{3}", fields["currency"]):
        fields["currency"] = None
        warnings.append("invalid_or_ambiguous_currency")
    if len(item_nodes) > 500 or len(tax_nodes) > 100:
        raise InvalidInvoiceXml("xml_item_limit")
    items = []
    for node in item_nodes:
        item = {}
        for key, path in item_paths.items():
            value = string(path, "line_" + key, node, limit=1000) if key in {"name", "position"} else money(path, "line_" + key, node, decimals=2 if key == "price_subtotal" else 6)
            if value is not None:
                item[key] = value
        items.append(item)
    taxes = []
    for node in tax_nodes:
        tax = {key: string(path, "tax_" + key, node) if key == "category" else money(path, "tax_" + key, node, decimals=6 if key == "rate" else 2)
               for key, path in tax_paths.items()}
        taxes.append(tax)
    if any(tax["category"] == "AE" for tax in taxes):
        warnings.append("tax_treatment_requires_review")
    net, vat, gross = (fields[key] for key in ("amount_net", "amount_vat", "amount_gross"))
    if all(value is not None for value in (net, vat, gross)) and Decimal(net) + Decimal(vat) != Decimal(gross):
        warnings.append("totals_mismatch")
    if taxes and all(tax["amount"] is not None for tax in taxes) and vat is not None and sum(Decimal(tax["amount"]) for tax in taxes) != Decimal(vat):
        warnings.append("structured_vat_mismatch")
    if items and all("price_subtotal" in item for item in items):
        item_sum = sum(Decimal(item["price_subtotal"]) for item in items)
        if line_total is not None and item_sum != Decimal(line_total):
            warnings.append("line_items_total_mismatch")
        if net is not None and item_sum - Decimal(allowance or "0") + Decimal(charge or "0") != Decimal(net):
            warnings.append("line_items_total_mismatch")
    if gross is not None and amount_due is not None:
        if Decimal(gross) - Decimal(prepaid or "0") + Decimal(rounding or "0") != Decimal(amount_due):
            warnings.append("structured_payable_mismatch")
        if Decimal(gross) != Decimal(amount_due):
            warnings.append("payable_differs_from_total")
    if fields["invoice_date"] and fields["due_date"] and fields["due_date"] < fields["invoice_date"]:
        warnings.append("due_date_before_invoice_date")
    missing = [key for key in FIELD_NAMES if key != "due_date" and fields[key] is None]
    if missing:
        warnings.append("missing_required_fields")
    import_allowed = document_type == "380" and not any(fields[key] and Decimal(fields[key]) < 0 for key in ("amount_net", "amount_vat", "amount_gross"))
    if not import_allowed:
        warnings.append("unsupported_document_type")
    terms = [" ".join(node.text.split())[:1000] for node in term_nodes if node.text][:5]
    text = "\n".join([f"{key}: {value}" for key, value in fields.items() if value is not None]
                     + ([f"Rechnungsempfänger: {recipient}"] if recipient else []) + terms)
    return {"schema_version": "1.0", "status": "needs_review", "requires_review": True,
            "fields": fields, "warnings": list(dict.fromkeys(warnings)), "missing_fields": missing,
            "line_items": items, "tax_breakdown": taxes, "field_sources": {}, "recipient": {"name": recipient},
            "payment": {"terms": terms, "amount_due": amount_due, "prepaid": prepaid, "rounding": rounding},
            "structured": {"syntax": syntax, "profile": profile, "document_type": document_type,
                           "validation": "basic_checks", "import_allowed": import_allowed},
            "source_format": "xml", "text": text, "extraction_complete": True,
            "extraction": {"page_count": 0, "text_chars": len(text), "used_ocr": False, "pages": []}}
