from dataclasses import replace
from pathlib import Path

import pytest

from app.extraction import extract_document
from invoice_parser.parser import iso_date, load_templates, money, parse_invoice
from conftest import ROOT, SAMPLE


def parse(text=SAMPLE, templates=None):
    return parse_invoice(extract_document(text.encode(), "text/plain"),
                         load_templates(ROOT / "examples/templates") if templates is None else templates)


def test_english_invoice_and_line_items():
    result = parse()
    assert result["fields"] == {
        "supplier_name": "GMED Synthetic Clinic", "external_invoice_number": "DEMO-2026-001",
        "invoice_date": "2026-09-05", "due_date": "2026-09-19",
        "amount_net": "100.00", "amount_vat": "19.00", "amount_gross": "119.00", "currency": "EUR",
    }
    assert result["line_items"] == [{"name": "Consultation", "qty": "1", "price_subtotal": "100.00"}]
    assert result["warnings"] == []
    assert result["requires_review"] is True


def test_german_invoice_decimal_comma_and_dates():
    result = parse("""GMED Musterklinik
Rechnung
Rechnungsnummer: DE-123
Rechnungsdatum: 05.09.2026
Zahlbar bis: 19.09.2026
Nettobetrag: 1.000,00
Umsatzsteuer: 190,00
Gesamtbetrag: 1.190,00
Waehrung: EUR
""")
    assert result["fields"]["amount_gross"] == "1190.00"
    assert result["fields"]["invoice_date"] == "2026-09-05"
    assert result["warnings"] == []


def test_unknown_and_ambiguous_templates_do_not_guess():
    result = parse(templates=[])
    assert all(value is None for value in result["fields"].values())
    assert "template_not_found" in result["warnings"]
    templates = load_templates(ROOT / "examples/templates")
    result = parse(templates=templates + templates)
    assert result["template"] is None
    assert "ambiguous_template" in result["warnings"]


def test_currency_is_not_silently_defaulted_and_missing_fields_remain_null():
    result = parse(SAMPLE.replace("Currency: EUR", "").replace("Gross total: 119.00", ""))
    assert result["fields"]["currency"] is None
    assert result["fields"]["amount_gross"] is None
    assert "currency" in result["missing_fields"]


def test_conflicting_totals_remain_ambiguous():
    result = parse(SAMPLE + "\nGross total: 999.00\n")
    assert result["fields"]["amount_gross"] is None
    assert "invalid_or_ambiguous_amount_gross" in result["warnings"]


def test_totals_mismatch_and_reversed_dates_flag_review():
    result = parse(SAMPLE.replace("119.00", "120.00").replace("2026-09-19", "2026-09-01"))
    assert "totals_mismatch" in result["warnings"]
    assert "due_date_before_invoice_date" in result["warnings"]


def test_incomplete_and_low_confidence_are_preserved():
    extraction = extract_document(SAMPLE.encode(), "text/plain")
    page = replace(extraction.metadata.pages[0], source="ocr", route_reason="ocr_timeout_no_text", ocr_confidence=40)
    extraction = replace(extraction, metadata=replace(extraction.metadata, pages=(page,)))
    result = parse_invoice(extraction, load_templates(ROOT / "examples/templates"))
    assert result["extraction_complete"] is False
    assert {"incomplete_extraction", "low_ocr_confidence"} <= set(result["warnings"])


@pytest.mark.parametrize(("value", "separator", "expected"), [
    ("1.234,56", ",", "1234.56"), ("1,234.56", ".", "1234.56"),
    ("1 234,56", ",", "1234.56"), ("0,00", ",", "0.00"),
    ("-19.00", ".", "-19.00"), ("1,2,3.00", ".", None),
    ("1.234", ".", None), ("NaN", ".", None), (float("inf"), ".", None),
    (["100.00", "200.00"], ".", None), (True, ".", None),
])
def test_money(value, separator, expected):
    assert money(value, separator) == expected


def test_dates_are_strict_and_never_infer_day_month_or_year():
    assert iso_date("01/02/2026", ["%d/%m/%Y", "%m/%d/%Y"]) is None
    assert iso_date("2026-02-30", []) is None
    assert iso_date("05.09", ["%d.%m"]) is None


@pytest.mark.parametrize("source", [
    "keywords: [Clinic]\nfields: {}",
    "issuer: Clinic\nkeywords: []\nfields: {}",
    "issuer: Clinic\nkeywords: [Clinic]\nfields: {}\ncamelot: {}",
    "issuer: Clinic\nkeywords: [Clinic]\nfields:\n  date: '(.*)'",
    "this is not a template",
])
def test_invalid_templates_fail_closed(tmp_path: Path, source):
    (tmp_path / "bad.yml").write_text(source)
    with pytest.raises(ValueError):
        load_templates(tmp_path)
