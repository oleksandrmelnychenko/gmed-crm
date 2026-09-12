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


def test_english_rental_invoice_labels_decimal_dot_and_split_legal_name():
    result = parse("""Sixt GmbH & Co.
Autovermietung KG
INVOICE (COPY)
Document: 9504815592/00/M/00/N
Pullach, 02.04.2024
Subtotal 397.11 EUR
A1 VAT 19.00% 75.45 EUR
Final amount 472.56 EUR
""")
    assert result["document_kind"] == "invoice"
    assert result["fields"] == {
        "supplier_name": "Sixt GmbH & Co. Autovermietung KG",
        "external_invoice_number": "9504815592/00/M/00/N",
        "invoice_date": "2024-04-02",
        "due_date": None,
        "amount_net": "397.11",
        "amount_vat": "75.45",
        "amount_gross": "472.56",
        "currency": "EUR",
    }


def test_receipt_number_two_digit_date_and_tax_breakdown_are_supported():
    result = parse("""Kanne Cafe GmbH
RECHNUNG
Beleg-Nr. 0252
Datum 26.05.26 09:52 Uhr
Zu zahlen EUR 2,40
MwSt-Summe 19.00% 0,34
Nettosumme MwSt 19.00% 1,76
MwSt-Summe 7.00% 0,02
Nettosumme MwSt 7.00% 0,28
""")
    assert result["fields"]["external_invoice_number"] == "0252"
    assert result["fields"]["invoice_date"] == "2026-05-26"
    assert result["fields"]["amount_gross"] == "2.40"
    assert result["fields"]["amount_net"] == "2.04"
    assert result["fields"]["amount_vat"] == "0.36"
    assert "amount_net_aggregated_from_tax_breakdown" in result["warnings"]
    assert "amount_vat_aggregated_from_tax_breakdown" in result["warnings"]


def test_cost_estimate_is_parsed_but_explicitly_classified_for_review():
    result = parse("""TUM Universitätsklinikum
München, den 06.05.2025
vorläufige Kostenschätzung Nr. 2025-309
Gesamtbetrag: 20.000,00 €
""")
    assert result["document_kind"] == "cost_estimate"
    assert result["fields"]["supplier_name"] == "TUM Universitätsklinikum"
    assert result["fields"]["external_invoice_number"] == "2025-309"
    assert result["fields"]["invoice_date"] == "2025-05-06"
    assert result["fields"]["amount_gross"] == "20000.00"
    assert "document_kind_cost_estimate" in result["warnings"]


def test_invoice_number_wins_over_embedded_card_receipt_number():
    result = parse("""MCLINIC Muenchen
KUNDENBELEG
Beleg-Nr. 0252
Rechnungs-Nr.: 26063 Pat Nr: 998
Rechnungsdatum: 03.07.26
Rechnungsbetrag: EUR 155,26
""")
    assert result["document_kind"] == "invoice"
    assert result["fields"]["external_invoice_number"] == "26063"
    assert result["fields"]["amount_gross"] == "155.26"


def test_receipt_without_invoice_word_is_detected_from_explicit_total_label():
    result = parse("""Wittelsbacher Apotheke
24.09.2026 54280
Gesamter Zahlbetrag EUR 15,27
MwSt 19% aus 15,27 2,44
""")
    assert result["document_kind"] == "receipt"
    assert result["fields"]["amount_gross"] == "15.27"
    assert result["fields"]["amount_vat"] == "2.44"


def test_ocr_variants_for_estimate_number_liquidation_date_and_transfer_total():
    estimate = parse("""TUM Klinikum
München, den 06.05.2025
vorlaufige Kostenschatzung Nr. 2025-309 geplante Abteilung: SPORT
Gesamtbetrag: 20.000,00 EUR
""")
    assert estimate["fields"]["external_invoice_number"] == "2025-309"

    liquidation = parse("""Dr. Meindl u. Partner Verrechnungsstelle GmbH
2604732 Liquidation vom 06.11.2024 für
Rechnungssumme, EUR: 400,00 EUR
""")
    assert liquidation["fields"]["invoice_date"] == "2024-11-06"

    transfer = parse("""PRIVATPRAXIS NEUBIBERG
Rechnung Nr. 2026-02-08-I-031-de
zu iiberweisender GESAMTBETRAG EUR 1.650,26
""")
    assert transfer["fields"]["amount_gross"] == "1650.26"


def test_ocr_ascii_medical_brand_and_parenthesized_payment_note():
    result = parse("""Frauendarzte Funf Hofe
07.03.2026
Rechnungsnummer: 70187/26 (Bei Uberweisung bitte unbedingt angeben!)
Rechnungsbetrag: 227.32 EUR
""")
    assert result["fields"]["supplier_name"] == "Frauendarzte Funf Hofe"
    assert result["fields"]["external_invoice_number"] == "70187/26"


def test_medical_subtotal_plus_expenses_is_not_misclassified_as_net_and_vat():
    result = parse("""PRIVATPRAXIS NEUBIBERG
Rechnung Nr. 2026-02-08-I-031-de
Zwischensumme EUR 600,00
Auslagen EUR 1.050,26
zu überweisender GESAMTBETRAG EUR 1.650,26
""")
    assert result["fields"]["amount_gross"] == "1650.26"
    assert result["fields"]["amount_net"] is None
    assert result["fields"]["amount_vat"] is None
    assert "amount_vat_derived_from_totals" not in result["warnings"]
