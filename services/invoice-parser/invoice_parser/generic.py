"""Conservative labelled extraction for invoices, receipts and estimates.

The fallback deliberately uses document labels instead of guessing arbitrary
numbers. Conflicts stay empty, derived arithmetic stays visible in warnings,
and every result still requires human review.
"""
from datetime import date
from decimal import Decimal, InvalidOperation
import re


_NUMBER = r"(?:\d{1,3}(?:[. '\u00a0]\d{3})+|\d+)"
MONEY = rf"[+-]?{_NUMBER}(?:[,.][ \t]?\d{{2}}-?|[,.]-)"
CURRENCY = r"EUR|CHF|USD|GBP|CAD|AUD|JPY|PLN|CZK|UAH|EURO|€"
DATE = r"\d{1,2}\.[ \t]*\d{1,2}\.[ \t]*(?:\d{4}|\d{2})"
DATE_VALUE = (
    rf"(?:{DATE}|\d{{1,2}}\.[ \t]*[A-Za-zÄÖÜäöü]+[ \t]+\d{{4}}|"
    rf"[A-Za-z]+[ \t]+\d{{1,2}}(?:st|nd|rd|th)?,?[ \t]+\d{{4}})"
)
MONTHS = {name: number for number, name in enumerate(
    ["januar", "februar", "märz", "april", "mai", "juni", "juli", "august", "september", "oktober", "november", "dezember"], 1)}
ENGLISH_MONTHS = {name: number for number, name in enumerate(
    ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"], 1)}

DOCUMENT_MARKERS = re.compile(
    r"\bRechnung(?:snummer)?\b|\bRechn\.|\bInvoice\b|I\s+N\s+V\s+O\s+I\s+C\s+E|\bLiquidation\b|"
    r"\b(?:Kunden)?beleg\b|\bQuittung\b|\bBuchungsbest(?:ä|a)tigung\b|"
    r"\bKostenvoranschlag\b|\bKosten(?:sch(?:ä|a)tzung|schätzung)\b|"
    r"\bHonorarvereinbarung\b|\bCost[ \t]+estimate\b|"
    r"\bGesamter[ \t]+Zahlbetrag\b",
    re.I,
)


def document_kind(text: str) -> str | None:
    """Return a coarse document kind without changing accounting semantics."""
    if re.search(r"\b(?:Kostenvoranschlag|Kosten(?:sch(?:ä|a)tzung|schätzung)|Cost[ \t]+estimate)\b", text, re.I):
        return "cost_estimate"
    if re.search(r"\bHonorarvereinbarung\b", text, re.I):
        return "fee_agreement"
    if re.search(r"\bBuchungsbest(?:ä|a)tigung\b", text, re.I):
        return "booking_confirmation"
    invoice_text = re.sub(r"Anlage\s+zur\s+Rechnung(?:s)?[. -]*(?:Nr|No)\.?", "", text, flags=re.I)
    if re.search(r"\bRechnung(?:snummer|s?[. -]*(?:Nr|No))\b|\bRechn\.|\bInvoice\b|I\s+N\s+V\s+O\s+I\s+C\s+E|\bLiquidation\b", invoice_text, re.I):
        return "invoice"
    if re.search(r"\b(?:Kunden)?beleg\b|\bQuittung\b|\bGesamter[ \t]+Zahlbetrag\b", text, re.I):
        return "receipt"
    if re.search(r"\bRechnung\b", text, re.I):
        return "invoice"
    return None


def german_date(value: str) -> str | None:
    value = value.strip().replace("’", "'")
    numeric = re.fullmatch(r"(\d{1,2})\.[ \t]*(\d{1,2})\.[ \t]*(\d{4}|\d{2})", value)
    if numeric:
        day, month, year = numeric.groups()
        if len(year) == 2:
            year = f"20{year}"
        try:
            return date(int(year), int(month), int(day)).isoformat()
        except ValueError:
            return None

    named = re.fullmatch(r"(\d{1,2})\.[ \t]*([A-Za-zÄÖÜäöü]+)\.?[ \t]*(\d{4})", value)
    english = re.fullmatch(r"([A-Za-z]+)[ \t]+(\d{1,2})(?:st|nd|rd|th)?,?[ \t]+(\d{4})", value, re.I)
    if named:
        day, month, year = named.groups()
        month_number = MONTHS.get(month.lower()) or ENGLISH_MONTHS.get(month.lower())
    elif english:
        month, day, year = english.groups()
        month_number = ENGLISH_MONTHS.get(month.lower())
    else:
        return None
    try:
        return date(int(year), int(month_number), int(day)).isoformat() if month_number else None
    except ValueError:
        return None


def decimal_amount(value: str) -> str | None:
    """Normalize an explicitly decimal amount with German or English punctuation."""
    raw = value.strip().replace("\u00a0", " ")
    accounting_negative = raw.startswith("(") and raw.endswith(")")
    raw = raw.strip("() ")
    trailing_negative = raw.endswith("-") and not re.search(r"[,.]-$", raw)
    if re.search(r"[,.]-$", raw):
        raw = raw[:-1] + "00"
    elif trailing_negative:
        raw = raw[:-1]
    raw = raw.replace(" ", "").replace("'", "")
    separators = [index for index, character in enumerate(raw) if character in ",."]
    if not separators:
        return None
    sign = "-" if raw.startswith("-") or trailing_negative or accounting_negative else ""
    unsigned = raw.lstrip("+-")
    decimal_index = max(unsigned.rfind(","), unsigned.rfind("."))
    if len(unsigned) - decimal_index - 1 != 2:
        return None
    normalized = re.sub(r"[,.]", "", unsigned[:decimal_index]) + "." + unsigned[decimal_index + 1:]
    try:
        amount = Decimal(sign + normalized)
        if amount.is_finite() and abs(amount) <= Decimal("999999999999.99"):
            return format(amount, ".2f")
    except InvalidOperation:
        pass
    return None


def _compact(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()


def _identifier(value: str) -> str | None:
    value = _compact(value).strip("|:;,. $ ")
    value = re.sub(r"\s+(?:Original|Kopie|Copy)\s*$", "", value, flags=re.I)
    value = re.split(
        r"\s+\(?(?:Pat(?:ient)?[. -]*Nr\.?|bei[ \t]+[ÜU]berweisung|geplante[ \t]+Abteilung)\b",
        value,
        maxsplit=1,
        flags=re.I,
    )[0].strip()
    value = re.split(rf"\s+(?={DATE}(?:\s|$))", value, maxsplit=1)[0].strip()
    value = re.split(rf"[ \t]+/[ \t]*(?={DATE}$)", value)[0].strip()
    if not value or len(value) > 100 or not re.search(r"\d", value):
        return None
    if not re.fullmatch(r"[A-Za-z0-9ÄÖÜäöü._/ -]+", value):
        return None
    if re.fullmatch(r"[\d ]+", value):
        value = value.replace(" ", "")
    return value


def _supplier_candidates(text: str) -> list[str]:
    raw_lines = [line.strip() for line in text.splitlines() if line.strip()]
    lines = [_compact(line) for line in raw_lines]
    header = lines[:35]
    search = header + lines[-20:]
    joined = []
    for index, line in enumerate(header):
        joined.append(line)
        if index + 1 < len(header) and re.search(r"GmbH[ \t]*&[ \t]*Co\.?$", line, re.I):
            joined.append(f"{line} {header[index + 1]}")
    search += joined

    delegated = re.search(
        r"Rechnungserstellung\s+erfolgt\s+im\s+Auftrag\s+von\s+"
        r"([^\r\n]{2,100}?\b(?:gGmbH|GmbH|GbR|AG|KG))\b",
        text,
        re.I,
    )
    if delegated:
        return [_compact(delegated[1])]

    legal_suffix = (
        r"(?:gGmbH|GmbH(?:[ \t]*&[ \t]*Co\.?(?:[ \t]+[A-Za-zÄÖÜäöüß-]+)*[ \t]+KG)?|"
        r"GbR|AG|UG[ \t]*\(haftungsbeschränkt\)|e\.[ \t]*V\.|e\.[ \t]*K\.|KG)"
    )
    legal = []
    for line in search:
        if re.search(r"\b(?:Bank|Sparkasse|Volksbank|Raiffeisenbank)\b", line, re.I):
            continue
        line = re.sub(r"^Leistungen\s+(?:der|des|von)\s+", "", line, flags=re.I)
        match = re.match(rf"^([\wÄÖÜäöüß][\wÄÖÜäöüß .&'’#-]{{1,110}}?\b{legal_suffix})\b", line, re.I)
        if match:
            legal.append(_compact(match[1]))
    # OCR occasionally turns the last letter of GmbH into k. This is accepted
    # only on a line which otherwise contains the full legal suffix token.
    for line in header:
        line = re.sub(r"^Leistungen\s+(?:der|des|von)\s+", "", line, flags=re.I)
        match = re.match(r"^([\wÄÖÜäöüß][\wÄÖÜäöüß .&'’#-]{2,100}\bG(?:m|n)b[kH])\b", line)
        if match:
            legal.append(_compact(re.sub(r"G(?:m|n)b[kH]$", "GmbH", match[1])))

    if len(legal) == 2 and re.search(r"GmbH$", legal[0], re.I) and re.search(r"KG$", legal[1], re.I):
        first_raw = next((line for line in raw_lines[:5] if re.search(r"GmbH\s*&\s*Co\.", line, re.I)), None)
        if first_raw:
            prefix = re.match(r"^(.+?\bGmbH\s*&\s*Co\.)", first_raw, re.I)
            if prefix:
                legal = [f"{_compact(prefix[1])} {legal[1]}"]

    legal = [candidate for candidate in legal if not (
        re.search(r"\bAG$", candidate, re.I) and not candidate.endswith(" AG")
    )]
    normalized = []
    for candidate in legal:
        if not any(candidate.casefold() == existing.casefold() for existing in normalized):
            normalized.append(candidate)
    normalized = [candidate for candidate in normalized if not any(
        candidate.casefold() in other.casefold() and len(other) > len(candidate)
        for other in normalized
    )]
    normalized = [re.sub(r"^Agentur\s+für\s+Patientenbetreuung\s+", "", candidate, flags=re.I) for candidate in normalized]
    ocm_entity = re.search(r"\bOCM\s+Medizinisches\s*(?:\r?\n|\s{2,}|\t)+Versorgungszentrum\s+GbR\b", text, re.I)
    if ocm_entity and normalized == ["Versorgungszentrum GbR"]:
        normalized = ["OCM Medizinisches Versorgungszentrum GbR"]
    # Repeated headers/footers can lose one OCR character. Treat near-identical
    # legal names as one candidate, preferring the more complete spelling.
    if len(normalized) > 1:
        from difflib import SequenceMatcher
        collapsed: list[str] = []
        for candidate in normalized:
            match_index = next((index for index, existing in enumerate(collapsed)
                                if SequenceMatcher(None, candidate.casefold(), existing.casefold()).ratio() >= 0.93), None)
            if match_index is None:
                collapsed.append(candidate)
            elif len(candidate) > len(collapsed[match_index]):
                collapsed[match_index] = candidate
        normalized = collapsed
    if len(normalized) == 2 and re.search(r"GmbH$", normalized[0], re.I) and re.search(r"KG$", normalized[1], re.I):
        first_raw = next((line for line in raw_lines[:5] if re.search(r"GmbH\s*&\s*Co\.", line, re.I)), None)
        prefix = re.match(r"^(.+?\bGmbH\s*&\s*Co\.)", first_raw, re.I) if first_raw else None
        if prefix:
            normalized = [f"{_compact(prefix[1])} {normalized[1]}"]
    if normalized:
        return normalized

    # Medical practices and small merchants often have no legal suffix. Only
    # use a recognisable letterhead line, never an arbitrary person's name.
    brand = re.compile(
        r"\b(?:Apotheke|(?:Universitäts)?Klinik(?:um)?|Praxis|Privatpraxis|Kinderarztpraxis|Radiologie|"
        r"Urologie|Frauen(?:d)?(?:ä|a)rzte|Ärzte|Arzte|Zentrum|MCLINIC|ISARKLINIKUM|DHSZ|OCM|SIXT|FC Bayern)\b",
        re.I,
    )
    generic = {"privatpraxis", "kinderarztpraxis", "radiologie", "klinik", "klinikum", "zentrum"}
    branded = []
    for raw_line, line in zip(raw_lines[:35], header, strict=False):
        if not brand.search(line) or line.casefold() in generic or re.search(r"(?:E-Mail|@|https?://|www\.)", line, re.I):
            continue
        candidate = re.split(r"\t+|\s{2,}|\s+[·+|•]\s+|,\s*(?=\d|[A-Za-zÄÖÜäöüß-]+str(?:\.?|a|ä|e))", raw_line, maxsplit=1)[0]
        candidate = _compact(candidate).strip(" -*|@")
        if 3 <= len(candidate) <= 120 and not re.search(r"Rechnungsempf|Patient|erbracht durch", candidate, re.I):
            branded.append(candidate)
    if not branded:
        for index, line in enumerate(header[:-1]):
            if line.casefold() in {"privatpraxis", "kinderarztpraxis"} and re.search(r"\bDr\.", header[index + 1], re.I):
                branded.append(f"{line.title()} {header[index + 1]}")
                break
    return branded[:1]


def _last_amount(value: str) -> str | None:
    matches = list(re.finditer(MONEY, value, re.I))
    if not matches:
        return None
    return decimal_amount(matches[-1][0])


def extract_german_fields(text: str) -> tuple[dict, list[str]]:
    kind = document_kind(text)
    if kind is None or not DOCUMENT_MARKERS.search(text):
        return {}, []
    warnings = ["generic_extraction_review_required"]
    candidates: dict[str, list[tuple[int, str]]] = {}

    def add(field: str, value: str | None, priority: int = 1) -> None:
        if value:
            candidates.setdefault(field, []).append((priority, value))

    for supplier in _supplier_candidates(text):
        add("supplier_name", supplier, 10)

    nonempty = [_compact(line) for line in text.splitlines() if _compact(line)]
    number_label = (
        r"(?:Rechnung(?:s)?[. -]*(?:nummer|nr\.?|no\.?)|Rechn\.?[ -]*Nr\.?|Rech[ -]*Nr\.?|"
        r"Invoice[ \t]*(?:No\.?|Nr\.?)?|Document|Beleg[ -]*Nr\.?|BelegNr|Quittungs[ -]*Nr\.?|"
        r"Buchungsnummer|Kostensch(?:ä|a)tzung[ \t]+Nr\.?)"
    )
    for index, line in enumerate(nonempty):
        receipt_number = re.match(r"^Rechnung[ \t]+(\d{1,12})[ \t]+Tran(?:saktion)?\b", line, re.I)
        if receipt_number:
            add("external_invoice_number", receipt_number[1], 10)
        combined = re.search(
            rf"(?:Rechn\.?[ -]*Nr\.?|Rechnung[ \t]+Nr\.?)\s*/\s*Datum\s*:\s*(.+?)\s*/\s*({DATE})\s*$",
            line,
            re.I,
        )
        if combined:
            add("external_invoice_number", _identifier(combined[1]), 12)
            add("invoice_date", german_date(combined[2]), 12)
            continue
        number = re.search(rf"(?:^|[ \t|]){number_label}[ \t]*:?[ \t]*(.*)$", line, re.I)
        if number:
            raw = number[1].strip()
            if not raw and index + 1 < len(nonempty):
                raw = nonempty[index + 1]
            label_and_value = number[0]
            priority = 20 if re.search(r"Rechn|Invoice|Document", label_and_value, re.I) else 18 if re.search(r"Kostensch", label_and_value, re.I) else 12 if number.start() == 0 else 8
            add("external_invoice_number", _identifier(raw), priority)
            combined_date = re.search(rf"/[ \t]*({DATE})[ \t]*$", raw)
            if combined_date:
                add("invoice_date", german_date(combined_date[1]), 12)
            if index + 1 < len(nonempty) and re.fullmatch(DATE_VALUE, nonempty[index + 1], re.I):
                add("invoice_date", german_date(nonempty[index + 1]), 11)

        for match in re.finditer(
            rf"(?:^|[ \t]{{2,}})(?:Rechnungsdatum|Re\.-Datum|Datum)[ \t]*:?[ \t]*({DATE_VALUE})(?!\d)",
            line,
            re.I,
        ):
            add("invoice_date", german_date(match[1]), 15 if re.search(r"Rechnung|Re\.-", match[0], re.I) else 10)
        liquidation_date = re.search(rf"\bLiquidation[ \t]+vom[ \t]+({DATE_VALUE})(?!\d)", line, re.I)
        if liquidation_date:
            add("invoice_date", german_date(liquidation_date[1]), 15)
        place_date = re.search(
            rf"(?:^|[ \t])(?:[A-Za-zÄÖÜäöüß .-]{{2,40}},[ \t]*)"
            rf"(?:den[ \t]+)?({DATE_VALUE})[ \t]*(?:/.*)?$",
            line,
            re.I,
        )
        if place_date:
            add("invoice_date", german_date(place_date[1]), 8)
        if index < 15 and re.fullmatch(DATE_VALUE, line, re.I):
            add("invoice_date", german_date(line), 9)
        due = re.search(
            rf"(?:Fälligkeitsdatum|Fällig[ \t]+am|Zahlbar[ \t]+bis|Bis[ \t]+zum|Betrag[ \t]+bis[ \t]+zum)"
            rf"[ \t]*:?[ \t]*({DATE})(?!\d)",
            line,
            re.I,
        )
        if not due and re.search(r"zahl|überweis|uberweis|fällig|fallig|Rechnung", line, re.I):
            due = re.search(rf"(?:bis[ \t]+(?:zum[ \t]+)?|spätestens[^:]*?:?[ \t]*)({DATE})(?!\d)", line, re.I)
        if due:
            add("due_date", german_date(due[1]), 10)

        gross_labels = [
            (20, r"Gesamter[ \t]+Zahlbetrag|zu[ \t]+(?:überweisender|uberweisender|iiberweisender)[ \t]+Gesamtbetrag|Zu[ \t]+zahlender[ \t]+Betrag|Zu[ \t]+zahlen"),
            (22, r"Bruttogesamtbetrag|Summe[ \t]+Brutto"),
            (19, r"Gesamtbetrag|Gesamtbetra[gq]?|Gesamtsumme|Rechnungsbetrag|Rechnungssumme|Endsumme|Final[ \t]+amount|Total[ \t]+amount"),
            (15, r"Endbetrag"),
            (10, r"Total|fotal|Gesamt"),
            (5, r"Betrag"),
        ]
        for priority, label in gross_labels:
            summary = re.match(
                rf"^[ \t]*(?:{label})(?=[ \t:|,]|$)(?:,[ \t]*(?:€|EUR))?[ \t]*:?[ \t|=_-]*(.*)$",
                line,
                re.I,
            )
            if not summary:
                continue
            tail = re.sub(r"=[ \t]*-(?=\d)", "=", summary[1])
            add("amount_gross", _last_amount(tail), priority)
            break

        running_cost = re.match(r"^Kosten[ \t]+aus[ \t]+laufendem[ \t]+Abrechnungszeitraum[ \t]*:[ \t]*(.*)$", line, re.I)
        if running_cost:
            add("amount_gross", _last_amount(running_cost[1]), 18)
        fee_total = re.search(rf"Honorar[^\r\n]{{0,100}}insgesamt[^\r\n]{{0,80}}?({MONEY})[ \t]*(?:{CURRENCY})", line, re.I)
        if fee_total:
            add("amount_gross", decimal_amount(fee_total[1]), 18)
        if kind == "booking_confirmation":
            booking_price = re.match(rf"^[ \t]*Preis[ \t]*:?[ \t]*(?:{CURRENCY})?[ \t]*({MONEY})", line, re.I)
            if booking_price:
                add("amount_gross", decimal_amount(booking_price[1]), 14)

        net_summary = re.match(
            r"^[ \t]*(?:Gesamtnettobetrag|Nettobetrag|Nettosumme(?:[ \t]+MwSt[ \t]+\d+(?:[.,]\d+)?%)?|"
            r"Summe[ \t]+Netto|Zwischensumme[ \t]+ohne[ \t]+MwSt|Subtotal)"
            r"(?=[ \t:|]|$)[ \t]*:?[ \t|]*(.*)$",
            line,
            re.I,
        )
        if net_summary:
            add("amount_net", _last_amount(net_summary[1]), 20 if re.match(r"Gesamtnettobetrag", line, re.I) else 15)

        vat_summary = re.match(
            rf"^[ \t]*(?:\+?[ \t]*\d+(?:[.,]\d+)?[ \t]*%[ \t]*)?"
            rf"(?:MwSt[ -]*Summe|(?:Umsatzsteuer|MwSt\.?|USt\.?)(?:[ \t]+\d+(?:[.,]\d+)?[ \t]*%)?)"
            rf"[^\r\n]*?({MONEY})[ \t]*(?:{CURRENCY})?[ \t]*$",
            line,
            re.I,
        )
        if vat_summary:
            add("amount_vat", decimal_amount(vat_summary[1]), 15)
        vat_on_net = re.search(
            rf"\b(?:MwSt\.?|USt\.?)\b[^\r\n]{{0,80}}?\b(?:auf|aus)[ \t]+(?:Netto[ \t]+)?{MONEY}"
            rf"[ \t]*(?:{CURRENCY})?[^\r\n]{{0,30}}?({MONEY})[ \t]*(?:{CURRENCY})?[ \t]*$",
            line,
            re.I,
        )
        if vat_on_net:
            add("amount_vat", decimal_amount(vat_on_net[1]), 16)

    # A unique, early standalone date is a safe fallback for receipts and
    # invoice headers which place the date below a column label (e.g. `vom`).
    if not candidates.get("invoice_date"):
        header_dates = []
        for line in nonempty[:35]:
            for match in re.finditer(rf"(?<!\d)({DATE_VALUE})(?!\d)", line, re.I):
                parsed = german_date(match[1])
                if parsed:
                    header_dates.append(parsed)
        if len(set(header_dates)) == 1:
            add("invoice_date", header_dates[0], 1)

    if not candidates.get("amount_gross") and re.search(r"Datum.*(?:Ziffer|GOÄ|GOA).*(?:Betrag|Gesamt)", text, re.I):
        standalone = []
        for line in nonempty:
            match = re.fullmatch(rf"[ \t]*(?:{CURRENCY})?[ \t]*({MONEY})[ \t]*(?:{CURRENCY})?[ \t]*", line, re.I)
            if match:
                amount = decimal_amount(match[1])
                if amount and Decimal(amount) > 0:
                    standalone.append(amount)
        if len(set(standalone)) == 1:
            add("amount_gross", standalone[0], 3)

    currencies = set(re.findall(r"\b(?:EUR|CHF|USD|GBP|CAD|AUD|JPY|PLN|CZK|UAH)\b", text, re.I))
    if "€" in text or re.search(r"\bEuro\b", text, re.I):
        currencies.add("EUR")
    for currency in currencies:
        add("currency", currency.upper(), 10)

    fields = {}
    for field, values in candidates.items():
        priority = max(item[0] for item in values)
        preferred = [item[1] for item in values if item[0] == priority]
        unique = list(dict.fromkeys(preferred))
        if len(unique) == 1:
            fields[field] = unique[0]
        elif field in {"amount_net", "amount_vat"} and unique and all(Decimal(value) >= 0 for value in unique):
            # Multiple explicit VAT-rate subtotals on a receipt are additive.
            fields[field] = format(sum(map(Decimal, unique)), ".2f")
            warnings.append(f"{field}_aggregated_from_tax_breakdown")
        else:
            warnings.append(f"invalid_or_ambiguous_{field}")

    gross = fields.get("amount_gross")
    net = fields.get("amount_net")
    vat = fields.get("amount_vat")
    if gross is not None and vat is not None and net is None and "invalid_or_ambiguous_amount_net" not in warnings:
        fields["amount_net"] = format(Decimal(gross) - Decimal(vat), ".2f")
        warnings.append("amount_net_derived_from_totals")
    elif gross is not None and net is not None and vat is None and "invalid_or_ambiguous_amount_vat" not in warnings:
        difference = Decimal(gross) - Decimal(net)
        if difference >= 0:
            fields["amount_vat"] = format(difference, ".2f")
            warnings.append("amount_vat_derived_from_totals")

    if re.search(r"reverse[ -]charge|Steuerschuldnerschaft", text, re.I):
        warnings.append("tax_treatment_requires_review")
    if kind != "invoice":
        warnings.append(f"document_kind_{kind}")
    return fields, warnings
