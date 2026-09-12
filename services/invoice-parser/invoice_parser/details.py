"""Document facts and arithmetical suggestions, never accounting tax decisions."""
from datetime import date, timedelta
from decimal import Decimal
import re

from .generic import CURRENCY, DATE, DOCUMENT_MARKERS, MONEY, decimal_amount, german_date


def compact(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()


def extract_details(text: str, fields: dict, warnings: list[str]) -> dict:
    """Enrich a draft in place only when the document supplies clear evidence."""
    if not DOCUMENT_MARKERS.search(text):
        return {}
    sources = {}
    payment = {}
    flat = compact(text)

    # A Reverse Charge reference alone is insufficient. Here the document
    # explicitly says that THIS invoice is issued without invoiced VAT. This
    # says nothing about the recipient's tax liability or DATEV posting code.
    no_vat = re.search(
        r"(?:Der\s+)?Rechnung(?:sausweis)?\s+(?:erfolgt|wird|ist)\b[^.!?]{0,120}?"
        r"(?:ohne\s+(?:Ausweis\s+(?:von\s+)?)?(?:Umsatzsteuer|Mehrwertsteuer|MwSt)|"
        r"keine\s+(?:Umsatzsteuer|Mehrwertsteuer|MwSt))[^.!?]{0,180}", flat, re.I)
    if not no_vat:
        no_vat = re.search(
            r"(?:steuerfreie\s+Leistung.{0,100}?§\s*4.{0,100}|"
            r"Umsatzsteuerbefreiung.{0,160}|"
            r"(?:Leistung(?:en)?|Behandlung|Rechnung).{0,180}?"
            r"(?:von\s+der\s+Umsatzsteuer\s+befreit|keine\s+USt\.?\s+berechnet(?:\s+und\s+ausgewiesen)?))",
            flat,
            re.I,
        )
    positive_tax = re.search(r"(?:inkl\.?|einschl\.?|zuzüglich|zzgl\.?)\s*(?:\d+(?:,\d+)?\s*%\s*)?"
                             r"(?:Umsatzsteuer|Mehrwertsteuer|MwSt)", flat, re.I)
    if no_vat and not positive_tax and fields.get("amount_gross") and fields.get("currency"):
        gross = Decimal(fields["amount_gross"])
        vat = fields.get("amount_vat")
        net = fields.get("amount_net")
        conflict = any(f"invalid_or_ambiguous_{key}" in warnings for key in ("amount_net", "amount_vat"))
        if not conflict and (vat is None or Decimal(vat) == 0) and (net is None or Decimal(net) == gross):
            for key, value in (("amount_vat", "0.00"), ("amount_net", format(gross, ".2f"))):
                if fields.get(key) is None:
                    fields[key] = value
                    sources[key] = {"method": "document_without_vat", "text": no_vat[0].strip()[:300]}
            if sources:
                warnings.append("invoice_vat_explicitly_not_charged")
        else:
            warnings.append("conflicting_tax_statement")

    # Collect payment terms separately from the invoice due date. Dates of
    # receipt, delivery and early-payment discounts are not invoice-date terms.
    term_lines = [compact(line) for line in text.splitlines()
                  if re.search(r"Zahlbar|Zahlungsbedingung|Zahlungsziel", line, re.I)]
    if term_lines:
        payment["terms"] = list(dict.fromkeys(term_lines))[:5]
    relative = set()
    for line in term_lines:
        if re.search(r"Eingang|Erhalt|Zugang|Lieferung|Skonto|Arbeitstag|Werktag", line, re.I):
            continue
        term = re.search(r"(?:Zahlbar\s+(?:innert|innerhalb(?:\s+von)?)|Zahlungsziel\s*:?|"
                         r"Zahlungsbedingung\s*:?\s*(?:innerhalb(?:\s+von)?)?)\s*(\d{1,3})\s+Tag(?:e|en)?\b", line, re.I)
        if term and 1 <= int(term[1]) <= 365:
            relative.add((int(term[1]), line))
    days = {value for value, _ in relative}
    if fields.get("due_date") is None and fields.get("invoice_date") and len(days) == 1 and "invalid_or_ambiguous_due_date" not in warnings:
        # The inferred base is displayed to the reviewer, never hidden.
        value = next(iter(days))
        try:
            fields["due_date"] = (date.fromisoformat(fields["invoice_date"]) + timedelta(days=value)).isoformat()
            sources["due_date"] = {"method": "invoice_date_plus_days", "days": value,
                                   "text": next(line for _, line in relative)}
            warnings.append("due_date_calculated_from_invoice_date")
        except (ValueError, OverflowError):
            pass

    debit = re.search(rf"(?:buchen\s*wir|ziehen\s*wir)[^.!?]{{0,100}}?\bam\s*({DATE})\s*(?:ab|ein)", flat, re.I)
    if debit:
        payment["method"] = "direct_debit"
        payment["collection_date"] = german_date(debit[1])
        payment["text"] = debit[0]
    elif re.search(r"\b(?:SEPA[ -])?Lastschrift(?:verfahren)?\b", text, re.I):
        payment["method"] = "direct_debit"

    items = extract_line_items(text)
    if items:
        total = sum(Decimal(item["price_subtotal"]) for item in items)
        known = [Decimal(fields[key]) for key in ("amount_net", "amount_gross") if fields.get(key) is not None]
        if known and not any(abs(total - amount) <= Decimal("0.01") for amount in known):
            warnings.append("line_items_total_mismatch")
        if len(items) > 500:
            items = items[:500]
            warnings.append("line_items_truncated")
    return {"field_sources": sources, "payment": payment, "line_items": items}


def extract_line_items(text: str) -> list[dict]:
    """Recognise item rows, not summary totals, in common German layouts.

    Require a table header or explicit position marker. Keep negative discount
    rows and page numbers. Never use line amounts to overwrite invoice totals.
    """
    items = []
    table = None
    pending = None
    period = None
    previous_item = None
    page = 1
    tail = re.compile(rf"(?:(?:{CURRENCY})\s*)?({MONEY})\s*(?:{CURRENCY})?\s*(?:(\d+(?:,\d+)?)\s*%)?\s*$", re.I)
    number = re.compile(rf"(?<![\w\d.,]){MONEY}(?![\d.,])")
    summary = re.compile(
        r"^(?:davon\b|Netto(?:betrag|summe)|Gesamtnettobetrag|Bruttogesamtbetrag|Offener Betrag|Zwischensumme|Umsatzsteuer|MwSt|USt\.|"
        r"Gesamt(?:er\s+Zahlbetrag|betrag|summe)|Rechnungsbetrag|Rechnungssumme|"
        r"Endbetrag|Endsumme|Final amount|Subtotal|Total(?: amount)?|Summe(?: Betrag| Netto)|[A-Z0-9]+\s+VAT)\b",
        re.I,
    )
    for original in text.splitlines(keepends=True):
        page += original.count("\f")
        line = original.replace("\f", "").strip()
        if not line:
            continue
        period_match = re.fullmatch(r"(?:Berechnungszeitraum|Leistungszeitraum)\s*:\s*(.+)", line, re.I)
        if period_match:
            # Preserve only an explicit period; do not infer dates from the
            # invoice date, service name or quantity/months columns.
            period = compact(period_match[1])[:100]
            previous_item = None
            continue
        if previous_item is not None and previous_item["page"] == page and re.fullmatch(r"/[A-Za-z]{1,4}", line):
            previous_item["name"] += " " + line
            previous_item = None
            continue
        previous_item = None
        if summary.match(line):
            pending = None
            table = None
            continue
        if re.search(r"(?:Anzahl|Menge).*Beschreibung.*(?:Einzelpreis|Preis).*(?:Kosten|Betrag)", line, re.I):
            table = "quantity"
            pending = None
            continue
        if re.search(r"preliminary calculation.*description.*quantity.*(?:rate|price).*sum", line, re.I):
            table = "estimate"
            pending = None
            continue
        if re.search(r"Pos\..*(?:Bezeichnung|Beschreibung).*(?:Preis|Betrag)", line, re.I):
            table = "position_table"
            pending = None
            continue
        if re.search(r"Leistungen.*(?:USt\.|MwSt).*(?:Netto|Betrag)", line, re.I):
            table = "numbered"
            pending = None
            continue
        if re.search(r"Datum.*(?:Ziffer|GOÄ|GOA).*(?:Betrag|Gesamt).*(?:Leistung|Text)", line, re.I):
            table = "goae_amount_first"
            pending = None
            continue
        if re.search(r"Datum.*(?:Ziffer|GOÄ|GOA).*(?:Leistung|Text).*(?:Betrag|Gesamt|Honorar)", line, re.I):
            table = "goae"
            pending = None
            continue
        if re.search(r"(?:NUMBER.*SINGLE PRICE|Leistungsbeschreibung.*Anzahl.*(?:Netto|Betrag)|beschreibung.*preis.*Netto.*code)", line, re.I):
            table = "rental"
            pending = None
            continue
        if re.search(r"folgenden (?:Aufträge|Leistungen).*(?:berechnen|verrechnen)", line, re.I):
            table = "services"
            pending = None
            continue

        if table == "estimate":
            cells = [compact(cell) for cell in re.split(r"\t+|\s{2,}", line) if compact(cell)]
            amounts = list(number.finditer(line))
            if not amounts or not cells or not re.search(r"[A-Za-zÄÖÜäöüß]", cells[0]):
                continue
            subtotal = decimal_amount(amounts[-1][0])
            name = cells[0].strip("*'0123456789. ")
            if subtotal is None or not name:
                continue
            item = {"name": name[:1000], "price_subtotal": subtotal, "page": page}
            if len(amounts) > 1:
                item["unit_price"] = decimal_amount(amounts[-2][0])
            simple_quantity = next((cell for cell in cells[1:-1] if re.fullmatch(r"\d+(?:[.,]\d+)?", cell)), None)
            if simple_quantity:
                item["qty"] = simple_quantity.replace(",", ".")
            items.append(item)
            previous_item = item
            continue

        if table == "rental":
            amounts = list(number.finditer(line))
            if not amounts:
                continue
            subtotal = decimal_amount(amounts[-1][0])
            name_part = line[:amounts[0].start()].strip()
            quantity = re.search(r"\s+(\d+(?:[.,]\d+)?)\s*(?:\d+\s*x\s*)?$", name_part, re.I)
            if quantity:
                name_part = name_part[:quantity.start()].strip()
            if subtotal is None or not re.search(r"[A-Za-zÄÖÜäöüß]", name_part):
                continue
            item = {"name": compact(name_part)[:1000], "price_subtotal": subtotal, "page": page}
            if quantity:
                item["qty"] = quantity[1].replace(",", ".")
            if len(amounts) > 1:
                item["unit_price"] = decimal_amount(amounts[-2][0])
            items.append(item)
            previous_item = item
            continue

        if table == "services":
            ending = tail.search(line)
            if not ending:
                continue
            amount = decimal_amount(ending[1])
            name = re.sub(rf"^{DATE}[ \t]+", "", line[:ending.start()].strip())
            if amount is not None and re.search(r"[A-Za-zÄÖÜäöüß]", name):
                item = {"name": compact(name)[:1000], "price_subtotal": amount, "page": page}
                items.append(item)
                previous_item = item
            continue

        if table == "goae_amount_first":
            amount_first = re.match(
                rf"^(?:({DATE})\s*[|\t ]+)?([A-Za-z]?\d{{1,5}}[A-Za-z]?)"
                rf"\s+(.+?)\s*\|\s*(.+)$",
                line,
                re.I,
            )
            if amount_first:
                row_amounts = list(number.finditer(amount_first[3]))
                amount = decimal_amount(row_amounts[-1][0]) if row_amounts else None
                name = compact(amount_first[4])
                if amount is not None and re.search(r"[A-Za-zÄÖÜäöüß]", name):
                    item = {"name": name[:1000], "position": amount_first[2], "price_subtotal": amount, "page": page}
                    if amount_first[1]:
                        item["service_date"] = german_date(amount_first[1])
                    items.append(item)
                    previous_item = item
            continue
        explicit = re.match(r"Pos\.?\s*(\d+)\s+(.+)$", line, re.I)
        numbered = re.match(r"(\d+)\.\s+(.+)$", line) if table == "numbered" else None
        row = re.match(r"(\d+(?:,\d+)?)\s{2,}(.+)$", line) if table in {"quantity", "position_table"} else None
        goae = re.match(rf"(?:({DATE})\s+)?([A-Za-z]?\d{{1,5}}[A-Za-z]?)\s+(.+)$", line, re.I) if table == "goae" else None
        if explicit or numbered or row or goae:
            marker = explicit or numbered or row or goae
            marker_index = 2 if goae else 1
            body_index = 3 if goae else 2
            pending = {"marker": marker[1], "body": marker[2], "page": page,
                       "kind": "goae" if goae else ("position" if explicit or numbered else table), "lines": 1}
            pending["marker"] = marker[marker_index]
            pending["body"] = marker[body_index]
            if goae and marker[1]:
                pending["service_date"] = german_date(marker[1])
        elif pending and pending["lines"] < 4:
            pending["body"] += "  " + line
            pending["lines"] += 1
        else:
            pending = None
            continue
        body = pending["body"]
        ending = tail.search(body)
        if not ending:
            continue
        amount = decimal_amount(ending[1])
        if amount is None:
            pending = None
            continue
        name = body[:ending.start()].strip()
        item = {"name": "", "price_subtotal": amount, "page": pending["page"]}
        if period:
            item["service_period"] = period
        if ending[2]:
            item["vat_rate"] = ending[2].replace(",", ".")
        if pending["kind"] in {"quantity", "position_table"}:
            amounts = list(number.finditer(name))
            if not amounts:
                pending = None
                continue
            unit = amounts[-1]
            item["unit_price"] = decimal_amount(unit[0])
            name = re.sub(rf"\s*(?:{CURRENCY})\s*$", "", name[:unit.start()], flags=re.I).strip()
            if pending["kind"] == "quantity":
                item["qty"] = pending["marker"].replace(",", ".")
            else:
                cells = re.split(r"\s{2,}|\t+", name)
                quantity = re.search(r"(?:^|\s{2,})(\d+(?:,\d+)?)\s+(?:ST|Stk\.?|Stück)$", name, re.I)
                name = cells[0]
                if quantity:
                    item["qty"] = quantity[1].replace(",", ".")
                item["position"] = pending["marker"]
        else:
            item["position"] = pending["marker"]
            if pending["kind"] == "goae":
                name = re.sub(rf"(?:\s+(?:{MONEY}|\d+(?:[.,]\d+)?|x\d+)){{1,5}}\s*$", "", name, flags=re.I)
                if pending.get("service_date"):
                    item["service_date"] = pending["service_date"]
            # A service period is metadata, not part of its title.
            row_period = re.search(r"\s+(\d{2}\.\d{2}\.\d{2,4}\s*-\s*\d{2}\.\d{2}\.\d{2,4})\s*$", name)
            if row_period:
                item["service_period"] = compact(row_period[1])
                name = name[:row_period.start()]
        item["name"] = compact(name)[:1000]
        if item["name"] and re.search(r"[A-Za-zÄÖÜäöüß]", item["name"]):
            items.append(item)
            previous_item = item
        pending = None
    return items
