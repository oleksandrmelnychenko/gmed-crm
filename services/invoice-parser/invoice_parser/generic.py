"""Conservative German label extraction for invoices without a supplier template.

Only explicit labels are used. Conflicts stay empty. No payment state, tax
classification, relative due date or patient relationship is inferred here.
"""
from datetime import date
from decimal import Decimal
import re

MONEY = r"[+-]?(?:\d{1,3}(?:[. '\u00a0]\d{3})+|\d+),\d{2}"
CURRENCY = r"EUR|CHF|USD|GBP|CAD|AUD|JPY|PLN|CZK|UAH|€"
DATE = r"\d{1,2}\.\d{1,2}\.\d{4}"
MONTHS = {name: number for number, name in enumerate(
    ["januar", "februar", "märz", "april", "mai", "juni", "juli", "august", "september", "oktober", "november", "dezember"], 1)}


def german_date(value: str) -> str | None:
    parts = re.fullmatch(r"(\d{1,2})\.[ \t]*(\d{1,2}|[A-Za-zÄÖÜäöü]+)\.?[ \t]*(\d{4})", value.strip())
    if not parts:
        return None
    day, month, year = parts.groups()
    try:
        month_number = int(month) if month.isdigit() else MONTHS[month.lower()]
        return date(int(year), month_number, int(day)).isoformat()
    except (ValueError, KeyError):
        return None


def extract_german_fields(text: str) -> tuple[dict, list[str]]:
    if not re.search(r"\bRechnung(?:snummer)?\b|\bRechn\.", text, re.I):
        return {}, []
    warnings = ["generic_extraction_review_required"]
    candidates: dict[str, list[str]] = {}

    def add(field: str, value: str | None) -> None:
        if value:
            candidates.setdefault(field, []).append(value)

    # Limit supplier recognition to the letterhead; multiple legal entities
    # in that block require review rather than selecting the first arbitrarily.
    header = [line.strip() for line in text.splitlines() if line.strip()][:12]
    for line in header:
        line = re.sub(r"^Leistungen\s+(?:der|des|von)\s+", "", line, flags=re.I)
        match = re.match(r"^([\wÄÖÜäöü][\wÄÖÜäöü .&'-]{1,85}?\b(?:GmbH(?:[ \t]*&[ \t]*Co\.[ \t]*KG)?|AG|UG[ \t]*\(haftungsbeschränkt\)))\b", line)
        if match:
            add("supplier_name", match[1].strip())

    for line in text.splitlines():
        number = re.match(r"^[ \t]*(?:Rechnung[ \t]+Nr\.?|Rechnungsnummer|Rechn\.[ \t]*Nr\.?)(?:[ \t]*/[ \t]*Datum)?[ \t]*:?[ \t]*(.+?)\s*$", line, re.I)
        if number:
            value = re.split(rf"[ \t]+/[ \t]*(?={DATE})", number[1])[0].strip()
            if re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9 ._/-]{1,69}", value) and re.search(r"\d", value):
                if re.fullmatch(r"[\d ]+", value):
                    value = value.replace(" ", "")
                add("external_invoice_number", re.sub(r"[ \t]+", " ", value))
            combined_date = re.search(rf"/[ \t]*({DATE})[ \t]*$", number[1])
            if combined_date:
                add("invoice_date", german_date(combined_date[1]))
        # A spaced two-column header (supplier at left, date at right) is common.
        for match in re.finditer(rf"(?:^[ \t]*|[ \t]{{2,}})(?:Rechnungsdatum|Datum)[ \t]*:?[ \t]*({DATE})(?!\d)", line, re.I):
            add("invoice_date", german_date(match[1]))
        place_date = re.fullmatch(r"[ \t]*[A-Za-zÄÖÜäöüß .-]{2,40},[ \t]*(\d{1,2}\.[ \t]*[A-Za-zÄÖÜäöü]+[ \t]+\d{4})[ \t]*", line)
        if place_date:
            add("invoice_date", german_date(place_date[1]))
        due = re.search(rf"(?:Fälligkeitsdatum|Fällig[ \t]+am|Zahlbar[ \t]+bis|Bis[ \t]+zum)[ \t]*:?[ \t]*({DATE})(?!\d)", line, re.I)
        if due:
            add("due_date", german_date(due[1]))
        # Match summary rows, never amounts from arbitrary service lines.
        for field, label in [
            ("amount_gross", r"Gesamtbetrag|Gesamtsumme|Rechnungsbetrag|Endbetrag|Total"),
            ("amount_net", r"Nettobetrag|Nettosumme|Summe[ \t]+Betrag"),
            ("amount_vat", r"(?:\+?[ \t]*\d+(?:,\d+)?[ \t]*%[ \t]*)?(?:Umsatzsteuer|MwSt\.?|USt\.?)"),
        ]:
            summary = re.match(rf"^[ \t]*(?:{label})(?=[ \t:]|$)[ \t]*:?[ \t]*(.*)$", line, re.I)
            if not summary:
                continue
            tail = summary[1]
            if field == "amount_vat":
                tail = re.sub(r"\d+(?:,\d+)?[ \t]*%", "", tail)
                tail = re.sub(rf"\bauf[ \t]+{MONEY}[ \t]*(?:{CURRENCY})", "", tail, flags=re.I)
            # Exactly one monetary value, with optional currency/asterisk.
            amount = re.fullmatch(rf"[ \t*]*(?:{CURRENCY})?[ \t]*({MONEY})[ \t]*(?:{CURRENCY})?[ \t*]*", tail, re.I)
            if amount:
                value = re.sub(r"[. '\u00a0]", "", amount[1]).replace(",", ".")
                if len(value) <= 16 and abs(Decimal(value)) <= Decimal("999999999999.99"):
                    add(field, format(Decimal(value), ".2f"))

    currencies = set(re.findall(r"\b(?:EUR|CHF|USD|GBP|CAD|AUD|JPY|PLN|CZK|UAH)\b", text))
    if "€" in text:
        currencies.add("EUR")
    for currency in currencies:
        add("currency", currency)

    fields = {}
    for field, values in candidates.items():
        unique = set(values)
        if len(unique) == 1:
            fields[field] = unique.pop()
        else:
            warnings.append(f"invalid_or_ambiguous_{field}")

    # An unlabeled net subtotal can be reconstructed only from two explicit
    # totals in a single currency. Keep the derivation visible for review.
    if "amount_net" not in candidates and all(key in fields for key in ("amount_gross", "amount_vat", "currency")):
        fields["amount_net"] = format(Decimal(fields["amount_gross"]) - Decimal(fields["amount_vat"]), ".2f")
        warnings.append("amount_net_derived_from_totals")
    if re.search(r"reverse[ -]charge|Steuerschuldnerschaft", text, re.I):
        warnings.append("tax_treatment_requires_review")
    return fields, warnings
