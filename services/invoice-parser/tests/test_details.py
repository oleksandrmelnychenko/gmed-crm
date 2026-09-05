from app.extraction import extract_document
from invoice_parser.parser import parse_invoice


def parse(text):
    return parse_invoice(extract_document(text.encode(), "text/plain"), [])


BASE = """Muster GmbH
Rechnung Nr. DEMO-200
Datum: 15.04.2030
Gesamtbetrag EUR 42,50
"""


def test_explicit_invoice_without_vat_preserves_evidence_and_tax_review():
    result = parse(BASE + "Der Rechnungsausweis erfolgt gemäss EU-Recht ohne Umsatzsteuer, da der Wechsel der Steuerschuldnerschaft (Reverse-Charge-Verfahren) greift.")
    assert result["fields"]["amount_net"] == "42.50"
    assert result["fields"]["amount_vat"] == "0.00"
    assert result["field_sources"]["amount_vat"]["method"] == "document_without_vat"
    assert "ohne Umsatzsteuer" in result["field_sources"]["amount_net"]["text"]
    assert "tax_treatment_requires_review" in result["warnings"]


def test_reverse_charge_alone_and_unrelated_net_prices_do_not_imply_zero_vat():
    for note in ["Reverse-Charge-Verfahren", "Unsere Preise verstehen sich ohne Umsatzsteuer.", "Die Rechnung ist ohne Ausweis von Umsatzsteuer. Preise inkl. MwSt."]:
        result = parse(BASE + note)
        assert result["fields"]["amount_net"] is None
        assert result["fields"]["amount_vat"] is None


def test_explicit_nonzero_or_ambiguous_vat_is_not_overwritten_by_tax_note():
    for amounts in ["Umsatzsteuer EUR 6,79", "Umsatzsteuer EUR 0,00\nUmsatzsteuer EUR 6,79"]:
        result = parse(BASE + amounts + "\nDer Rechnungsausweis erfolgt ohne Umsatzsteuer.")
        assert "invoice_vat_explicitly_not_charged" not in result["warnings"]
        assert "conflicting_tax_statement" in result["warnings"]


def test_relative_due_date_is_a_visible_calculation_and_explicit_date_wins():
    result = parse(BASE + "Zahlbar innert 30 Tagen")
    assert result["fields"]["due_date"] == "2030-05-15"
    assert result["field_sources"]["due_date"] == {"method": "invoice_date_plus_days", "days": 30, "text": "Zahlbar innert 30 Tagen"}
    assert "due_date_calculated_from_invoice_date" in result["warnings"]
    explicit = parse(BASE + "Zahlbar innert 30 Tagen\nFällig am: 10.05.2030")
    assert explicit["fields"]["due_date"] == "2030-05-10"
    assert "due_date" not in explicit["field_sources"]


def test_receipt_discount_and_conflicting_terms_do_not_guess_due_date():
    for terms in ["Zahlbar innerhalb von 30 Tagen nach Erhalt", "Zahlbar innert 10 Tagen mit Skonto", "Zahlbar innert 10 Tagen\nZahlbar innert 30 Tagen", "Zahlungsziel: 14 Werktage"]:
        assert parse(BASE + terms)["fields"]["due_date"] is None


def test_collection_date_stays_separate_from_due_date_even_without_ocr_spaces():
    result = parse(BASE + "DenBetrag von 42,50 € buchenwir am 29.04.2030 ab.")
    assert result["fields"]["due_date"] is None
    assert result["payment"]["method"] == "direct_debit"
    assert result["payment"]["collection_date"] == "2030-04-29"


def test_quantity_table_and_wrapped_position_lines():
    result = parse(BASE + """
Anzahl    Beschreibung                 Einzelpreis       Kosten
5         Software-Lizenz             € 8,50             € 42,50
          Lizenzdetails ohne eigene Position
Total EUR 42,50
""")
    assert result["line_items"] == [{"name": "Software-Lizenz", "price_subtotal": "42.50", "page": 1, "unit_price": "8.50", "qty": "5"}]
    scan = parse(BASE + """
Pos. 1 Einrichtung\tEUR\t20,00
Pos. 2 Datenerfassung und
monatliche Betreuung\tEUR\t22,50
EUR 42,50
""")
    assert [(row["name"], row["price_subtotal"]) for row in scan["line_items"]] == [("Einrichtung", "20.00"), ("Datenerfassung und monatliche Betreuung", "22.50")]
    assert "line_items_total_mismatch" not in scan["warnings"]


def test_material_columns_are_not_part_of_the_description_or_quantity():
    result = parse(BASE + """
Pos.   Bezeichnung                    Material   Monate     Menge      Preis mo.       Betrag
1001   VIDEOSPRECHSTUNDE START         98765      1          1 ST       42,50           42,50
""")
    item = result["line_items"][0]
    assert item["name"] == "VIDEOSPRECHSTUNDE START"
    assert item["qty"] == "1"
    assert item["position"] == "1001"
    assert item["price_subtotal"] == "42.50"


def test_multi_page_discount_and_service_rows_do_not_include_summary_totals():
    result = parse(BASE + """
Nettobetrag EUR 35,71
Umsatzsteuer EUR 6,79
Grundpreise 40,00 €19 %
Rabatte -4,29 €19 %
\f
Leistungen der Demo GmbH       Datum / Zeitraum      USt.       Netto
1. Rabatt                                          -4,29 €19 %
2. Mobilfunk-Tarif      01.04.30 - 30.04.30           40,00 €19 %
35,71 €
""")
    assert len(result["line_items"]) == 2
    assert result["line_items"][0]["price_subtotal"] == "-4.29"
    assert result["line_items"][1]["name"] == "Mobilfunk-Tarif"
    assert result["line_items"][1]["service_period"] == "01.04.30 - 30.04.30"
    assert result["line_items"][1]["page"] == 2
    assert "line_items_total_mismatch" not in result["warnings"]


def test_partial_item_extraction_flags_total_mismatch():
    result = parse(BASE + "Pos. 1 Teilbetrag EUR 20,00")
    assert "line_items_total_mismatch" in result["warnings"]


def test_explicit_service_period_and_immediate_product_suffix_are_preserved():
    result = parse(BASE + """
Pos.   Bezeichnung        Material   Monate   Menge   Preis mo.   Betrag
Berechnungszeitraum: 01.04.2030 - 30.04.2030
1001   Video-Service      98765      1        1 ST    42,50       42,50
/J
Weitere Beschreibung ohne eigene Position.
/M
""")
    assert result["line_items"] == [{"name": "Video-Service /J", "position": "1001", "page": 1,
        "qty": "1", "unit_price": "42.50", "price_subtotal": "42.50", "service_period": "01.04.2030 - 30.04.2030"}]


def test_explicit_month_period_is_kept_without_inventing_dates_or_quantities():
    result = parse(BASE + "Leistungszeitraum: April 2030\nPos. 1 Einrichtung EUR 42,50")
    assert result["line_items"][0]["service_period"] == "April 2030"
    assert "qty" not in result["line_items"][0]
    assert "unit_price" not in result["line_items"][0]


def test_row_period_does_not_leak_into_following_undated_positions():
    result = parse(BASE + "Pos. 1 Service 01.04.30 - 30.04.30 EUR 20,00\nPos. 2 Einrichtung EUR 22,50")
    assert result["line_items"][0]["service_period"] == "01.04.30 - 30.04.30"
    assert "service_period" not in result["line_items"][1]
