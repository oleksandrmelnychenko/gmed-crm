from app.extraction import extract_document
from invoice_parser.parser import parse_invoice


def parse(text):
    return parse_invoice(extract_document(text.encode(), "text/plain"), [])


def test_scan_style_invoice_with_explicit_vat_and_unlabelled_net():
    result = parse("""Demo GmbH | Musterweg 1
Rechnung Nr.: RE 2030-015
Datum: 10.05.2030
Fälligkeitsdatum: 24.05.2030
Beispielleistung EUR 100,00
EUR 100,00
+ 19% MWSt EUR 19,00
Gesamtsumme EUR 119,00
""")
    assert result["fields"] == {"supplier_name": "Demo GmbH", "external_invoice_number": "RE 2030-015", "invoice_date": "2030-05-10", "due_date": "2030-05-24", "amount_net": "100.00", "amount_vat": "19.00", "amount_gross": "119.00", "currency": "EUR"}
    assert "amount_net_derived_from_totals" in result["warnings"]
    assert result["requires_review"] is True


def test_multi_page_combined_number_date_and_vat_percentage():
    result = parse("""Beispiel AG · Kundenservice
Rechnung
Rechn. Nr. / Datum: 987654321 / 05.06.2030
Auftrag Nr. 111111 vom 01.01.2020
\f
Beleg: 987654321 / 05.06.2030
Nettobetrag 50,00
Umsatzsteuer 19,00 % 9,50
Endbetrag 59,50
Zahlungsbedingung: Bis zum 15.06.2030 ohne Abzug
in EUR
""")
    assert result["fields"]["external_invoice_number"] == "987654321"
    assert result["fields"]["invoice_date"] == "2030-06-05"
    assert result["fields"]["due_date"] == "2030-06-15"
    assert result["fields"]["amount_vat"] == "9.50"
    assert "totals_mismatch" not in result["warnings"]


def test_repeated_invoice_headers_and_tax_base_are_not_double_counted():
    result = parse("""Demo GmbH, Testweg 1         Datum 16.06.2030
Rechnungsnummer 11 2222 3333 4444
Summe Betrag 100,00 €
+19 % USt. auf 100,00 €       19,00 €
Rechnungsbetrag 119,00 €
Den Betrag buchen wir am 29.06.2030 ab.
\f
Datum 16.06.2030
Rechnungsnummer 11 2222 3333 4444
""")
    fields = result["fields"]
    assert fields["external_invoice_number"] == "11222233334444"
    assert fields["amount_net"] == "100.00"
    assert fields["amount_vat"] == "19.00"
    assert fields["amount_gross"] == "119.00"
    assert fields["due_date"] is None  # collection date is not a stated due date


def test_reverse_charge_requires_tax_review_and_relative_due_date_is_disclosed():
    result = parse("""Example GmbH, Musterweg 1
Musterstadt, 15. April 2030
Rechnung Nr. DEMO-100
Total * € 42,50
Reverse-Charge-Verfahren. Zahlbar innert 30 Tagen.
""")
    assert result["fields"]["invoice_date"] == "2030-04-15"
    assert result["fields"]["amount_gross"] == "42.50"
    assert result["fields"]["amount_net"] is None
    assert result["fields"]["amount_vat"] is None
    assert result["fields"]["due_date"] == "2030-05-15"
    assert result["field_sources"]["due_date"]["method"] == "invoice_date_plus_days"
    assert "tax_treatment_requires_review" in result["warnings"]


def test_conflicting_invoice_numbers_totals_and_currencies_stay_empty():
    result = parse("""Rechnung Nr. A-1
Rechnung Nr. B-2
Gesamtbetrag EUR 100,00
Gesamtbetrag CHF 200,00
""")
    assert result["fields"]["external_invoice_number"] is None
    assert result["fields"]["amount_gross"] is None
    assert result["fields"]["currency"] is None
    assert "invalid_or_ambiguous_external_invoice_number" in result["warnings"]
    assert "invalid_or_ambiguous_currency" in result["warnings"]


def test_arbitrary_numbers_and_multiple_letterhead_entities_are_not_guessed():
    result = parse("""Sender GmbH
Recipient GmbH
Rechnung Nr. TEST-55
Kundennummer 99999
Beispielposition 19,00 EUR
Datum: 31.02.2030
""")
    assert result["fields"]["supplier_name"] is None
    assert result["fields"]["invoice_date"] is None
    assert result["fields"]["amount_gross"] is None
    assert "invalid_or_ambiguous_supplier_name" in result["warnings"]


def test_supplier_excludes_service_heading_prefix_and_deduplicates_same_entity():
    result = parse("Demo GmbH\nRechnung Nr. DEMO-22\nLeistungen der Demo GmbH\nRechnungsbetrag 10,00 EUR")
    assert result["fields"]["supplier_name"] == "Demo GmbH"
    assert "invalid_or_ambiguous_supplier_name" not in result["warnings"]
