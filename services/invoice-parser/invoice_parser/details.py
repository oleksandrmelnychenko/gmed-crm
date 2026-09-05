"""Document facts and arithmetical suggestions, never accounting tax decisions."""
from datetime import date, timedelta
from decimal import Decimal, InvalidOperation
import re

from .generic import CURRENCY, DATE, MONEY, german_date


def decimal_amount(value: str) -> str | None:
    value = re.sub(r"[. '\u00a0]", "", value).replace(",", ".")
    try:
        amount = Decimal(value)
        if amount.is_finite() and abs(amount) <= Decimal("999999999999.99"):
            return format(amount, ".2f")
    except InvalidOperation:
        pass
    return None


def compact(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()


def extract_details(text: str, fields: dict, warnings: list[str]) -> dict:
    """Enrich a draft in place only when the document supplies clear evidence."""
    if not re.search(r"\bRechnung(?:snummer)?\b|\bRechn\.", text, re.I):
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
    summary = re.compile(r"^(?:Netto(?:betrag|summe)|Umsatzsteuer|MwSt|USt\.|Gesamt(?:betrag|summe)|Rechnungsbetrag|Endbetrag|Total|Summe Betrag)\b", re.I)
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
        if re.search(r"Pos\..*(?:Bezeichnung|Beschreibung).*(?:Preis|Betrag)", line, re.I):
            table = "position_table"
            pending = None
            continue
        if re.search(r"Leistungen.*(?:USt\.|MwSt).*(?:Netto|Betrag)", line, re.I):
            table = "numbered"
            pending = None
            continue
        explicit = re.match(r"Pos\.?\s*(\d+)\s+(.+)$", line, re.I)
        numbered = re.match(r"(\d+)\.\s+(.+)$", line) if table == "numbered" else None
        row = re.match(r"(\d+(?:,\d+)?)\s{2,}(.+)$", line) if table in {"quantity", "position_table"} else None
        if explicit or numbered or row:
            marker = explicit or numbered or row
            pending = {"marker": marker[1], "body": marker[2], "page": page,
                       "kind": "position" if explicit or numbered else table, "lines": 1}
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
