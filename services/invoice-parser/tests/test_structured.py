from io import BytesIO
from pathlib import Path
from xml.etree import ElementTree as ET

from fastapi.testclient import TestClient
from pypdf import PdfWriter
import pytest

from invoice_parser.api import create_app
from invoice_parser.document import parse_document
from invoice_parser.settings import Settings
from invoice_parser.structured import NS, InvalidInvoiceXml, parse_xml_invoice
from conftest import native_pdf

FIXTURES = Path(__file__).parent / "fixtures"
UBL = (FIXTURES / "kosit-ubl.xml").read_bytes()
CII = (FIXTURES / "kosit-cii.xml").read_bytes()


def change_xml(change):
    root = ET.fromstring(UBL)
    change(root)
    return ET.tostring(root, encoding="utf-8", xml_declaration=True)


def with_attachment(xml, text="Rechnung Nr. 123456XX\nDatum: 04.04.2016\nNettobetrag EUR 314,86\nUmsatzsteuer EUR 22,04\nGesamtbetrag EUR 336,90", second=None):
    writer = PdfWriter(clone_from=BytesIO(native_pdf(text)))
    writer.add_attachment("factur-x.xml", xml)
    if second is not None:
        writer.add_attachment("another.xml", second)
    output = BytesIO()
    writer.write(output)
    return output.getvalue()


@pytest.mark.parametrize("data,syntax", [(UBL, "ubl"), (CII, "cii")])
def test_independent_kosit_reference_invoices(data, syntax):
    result = parse_xml_invoice(data)
    assert result["fields"] == {"supplier_name": "[Seller name]", "external_invoice_number": "123456XX", "invoice_date": "2016-04-04", "due_date": None,
                                 "amount_net": "314.86", "amount_vat": "22.04", "amount_gross": "336.90", "currency": "EUR"}
    assert result["structured"]["syntax"] == syntax
    assert result["structured"]["validation"] == "basic_checks"
    assert result["structured"]["import_allowed"] is True
    assert result["recipient"] == {"name": "[Buyer name]"}
    assert [row["price_subtotal"] for row in result["line_items"]] == ["288.79", "26.07"]
    assert result["warnings"] == []
    assert result["requires_review"] is True


def test_prepaid_amount_is_not_used_as_invoice_gross_or_payment_status():
    def change(root):
        total = root.find("cac:LegalMonetaryTotal", NS)
        ET.SubElement(total, f'{{{NS["cbc"]}}}PrepaidAmount', currencyID="EUR").text = "100.00"
        total.find("cbc:PayableAmount", NS).text = "236.90"
    result = parse_xml_invoice(change_xml(change))
    assert result["fields"]["amount_gross"] == "336.90"
    assert result["payment"]["amount_due"] == "236.90"
    assert result["payment"]["prepaid"] == "100.00"
    assert "payable_differs_from_total" in result["warnings"]
    assert "structured_payable_mismatch" not in result["warnings"]
    assert "paid" not in result


def test_accounting_currency_tax_is_not_mixed_with_invoice_currency():
    def change(root):
        tax = ET.SubElement(root, f'{{{NS["cac"]}}}TaxTotal')
        ET.SubElement(tax, f'{{{NS["cbc"]}}}TaxAmount', currencyID="USD").text = "25.55"
    result = parse_xml_invoice(change_xml(change))
    assert result["fields"]["amount_vat"] == "22.04"
    assert len(result["tax_breakdown"]) == 1


def test_namespaces_and_header_paths_reject_spoofed_or_duplicate_ids():
    def change(root):
        extra = ET.SubElement(root, "{https://invalid.example}extension")
        ET.SubElement(extra, f'{{{NS["cbc"]}}}ID').text = "NOT-INVOICE-ID"
    assert parse_xml_invoice(change_xml(change))["fields"]["external_invoice_number"] == "123456XX"
    duplicate = change_xml(lambda root: ET.SubElement(root, f'{{{NS["cbc"]}}}ID').__setattr__("text", "DUPLICATE"))
    result = parse_xml_invoice(duplicate)
    assert result["fields"]["external_invoice_number"] is None
    assert "invalid_or_ambiguous_external_invoice_number" in result["warnings"]
    with pytest.raises(InvalidInvoiceXml):
        parse_xml_invoice(b'<Invoice xmlns="https://invalid.example"><ID>FAKE</ID></Invoice>')


def test_reverse_charge_uses_explicit_xml_amounts():
    xml = UBL.replace(b">22.04<", b">0.00<").replace(b">336.9<", b">314.86<").replace(b">7<", b">0<").replace(b">S<", b">AE<")
    result = parse_xml_invoice(xml)
    assert result["fields"]["amount_vat"] == "0.00"
    assert "tax_treatment_requires_review" in result["warnings"]


def test_credit_note_is_previewable_but_not_imported_as_a_positive_bill():
    result = parse_xml_invoice(CII.replace(b">380<", b">381<"))
    assert result["structured"]["import_allowed"] is False
    assert "unsupported_document_type" in result["warnings"]


@pytest.mark.parametrize("bad", [
    b'<!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]><x>&e;</x>',
    b'<?xml-stylesheet type="text/xsl" href="https://invalid.example/x"?><x/>',
    b'<html><script>alert(1)</script></html>', b'<r>' * 65 + b'</r>' * 65,
    b'<r>' + b'<n/>' * 25001 + b'</r>', b'\xff\xfe<\x00r\x00/\x00>\x00',
    b'<r>' + b' ' * (5 * 1024 * 1024) + b'</r>',
], ids=["external-entity", "stylesheet", "html", "depth", "nodes", "utf16", "size"])
def test_unsafe_or_unbounded_xml_is_rejected(bad):
    with pytest.raises(InvalidInvoiceXml):
        parse_xml_invoice(bad)


@pytest.mark.parametrize("original,replacement,warning", [
    (b">336.9<", b">999.00<", "totals_mismatch"),
    (b'currencyID="EUR">336.9', b'currencyID="USD">336.9', "structured_currency_mismatch"),
    (b">288.79<", b">280.00<", "line_items_total_mismatch"),
])
def test_inconsistent_financial_values_are_visible(original, replacement, warning):
    assert warning in parse_xml_invoice(UBL.replace(original, replacement))["warnings"]


def test_embedded_xml_avoids_ocr_and_compares_the_visible_pdf(monkeypatch):
    monkeypatch.setattr("app.extraction.extract_document", lambda *_: pytest.fail("Embedded XML should not require OCR"))
    result = parse_document(with_attachment(CII), "application/pdf", [])
    assert result["source_format"] == "embedded_xml"
    assert result["fields"]["amount_gross"] == "336.90"
    assert result["source_differences"] == []
    assert result["extraction"]["used_ocr"] is False
    conflict = parse_document(with_attachment(CII, "Rechnung Nr. 123456XX\nGesamtbetrag EUR 999,00"), "application/pdf", [])
    assert conflict["source_differences"] == [{"field": "amount_gross", "structured": "336.90", "visible": "999.00"}]
    assert "structured_pdf_mismatch" in conflict["warnings"]


def test_multiple_xml_invoices_are_not_arbitrarily_selected():
    result = parse_document(with_attachment(CII, second=CII.replace(b">123456XX<", b">OTHER-1<")), "application/pdf", [])
    assert result["source_format"] == "pdf_text"
    assert "multiple_embedded_invoices" in result["warnings"]
    same = parse_document(with_attachment(CII, second=CII), "application/pdf", [])
    assert same["source_format"] == "embedded_xml"


def test_real_xml_and_hybrid_pdf_through_api_worker():
    key = "synthetic-xml-service-key-0000000000000"
    with TestClient(create_app(Settings(key))) as client:
        for mime, content, source in [("application/xml", UBL, "xml"), ("text/xml", CII, "xml"), ("application/pdf", with_attachment(CII), "embedded_xml")]:
            response = client.post("/v1/parse", content=content, headers={"Authorization": f"Bearer {key}", "Content-Type": mime})
            assert response.status_code == 200, response.text
            assert response.json()["source_format"] == source
            assert response.json()["fields"]["amount_gross"] == "336.90"
        unsafe = client.post("/v1/parse", content=b'<!DOCTYPE x><x/>', headers={"Authorization": f"Bearer {key}", "Content-Type": "application/xml"})
        assert unsafe.status_code == 422
