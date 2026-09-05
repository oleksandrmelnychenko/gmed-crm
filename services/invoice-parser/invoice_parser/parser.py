from __future__ import annotations

from dataclasses import asdict
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from pathlib import Path
import re
from typing import Any

import yaml
from invoice2data.extract.invoice_template import InvoiceTemplate
from invoice2data.extract.loader import prepare_template
from invoice2data.input import text as text_reader
from .generic import extract_german_fields
from .details import extract_details


INCOMPLETE_REASONS = {
    "document_ocr_deadline_exhausted", "ocr_failed_native_fragment_preserved",
    "ocr_timeout_native_fragment_preserved", "ocr_timeout_no_text",
    "pdf_page_count_disagreement", "pdf_render_failed",
}
FIELD_MAP = {
    "invoice_number": "external_invoice_number",
    "date": "invoice_date",
    "due_date": "due_date",
    "amount": "amount_gross",
    "amount_untaxed": "amount_net",
    "amount_tax": "amount_vat",
}


def load_templates(directory: Path) -> list:
    if not directory.is_dir():
        raise ValueError("Template directory is unavailable")
    templates = []
    for path in sorted(directory.rglob("*")):
        if path.suffix not in {".yml", ".yaml", ".json"}:
            continue
        source = yaml.safe_load(path.read_text(encoding="utf-8"))
        if not isinstance(source, dict) or not isinstance(source.get("issuer"), str) or not source["issuer"].strip():
            raise ValueError("Templates require an explicit issuer")
        source["template_name"] = path.name
        prepared = prepare_template(source)
        if prepared is None:
            raise ValueError("A template could not be loaded")
        templates.append(InvoiceTemplate(prepared))
    names = [t["template_name"] for t in templates]
    if len(names) != len(set(names)):
        raise ValueError("Template filenames must be unique")
    for template in templates:
        # Only local, text-based rules are accepted. No PDF-path plugins, area
        # readers, bundled supplier guesses, or AI/cloud fallback.
        if any(key in template for key in ("tables", "camelot", "lines")):
            raise ValueError("Use fields.lines with the text lines parser")
        if not template.get("keywords") or not all(isinstance(k, str) and k.strip() for k in template["keywords"]):
            raise ValueError("Templates require supplier keywords and an explicit issuer")
        if not isinstance(template.get("fields"), dict):
            raise ValueError("Templates require fields")
        if any(isinstance(value, dict) and "area" in value for value in template["fields"].values()):
            raise ValueError("Area extraction is not supported")
        for key in FIELD_MAP:
            if key not in template["fields"]:
                continue
            rule = template["fields"][key]
            if not isinstance(rule, dict) or rule.get("parser") != "regex" or "type" in rule:
                raise ValueError("Header fields must use regex without type coercion")
        # invoice2data otherwise supplies EUR even if it is absent from a file.
        template.options["currency"] = template.get("options", {}).get("currency")
        # Preserve partial drafts; our adapter flags missing/ambiguous fields.
        template["required_fields"] = []
    return templates


def scalar(value: Any) -> Any:
    if isinstance(value, (list, tuple)):
        return value[0] if len(value) == 1 else None
    return value


def money(value: Any, decimal_separator: str) -> str | None:
    value = scalar(value)
    if value is None or isinstance(value, (bool, dict)):
        return None
    try:
        if isinstance(value, str):
            value = value.strip().replace("\u00a0", " ")
            if decimal_separator not in {",", "."}:
                return None
            group = r"[. ']" if decimal_separator == "," else r"[, ']"
            decimal = re.escape(decimal_separator)
            if not re.fullmatch(rf"[+-]?(?:\d+|\d{{1,3}}(?:{group}\d{{3}})+)(?:{decimal}\d{{1,2}})?", value):
                return None
            value = value.replace(" ", "").replace("'", "")
            if decimal_separator == ",":
                value = value.replace(".", "").replace(",", ".")
            elif decimal_separator == ".":
                value = value.replace(",", "")
            if not re.fullmatch(r"[+-]?\d+(?:\.\d{1,2})?", value):
                return None
        number = Decimal(str(value))
        if not number.is_finite() or abs(number) > Decimal("999999999999.99"):
            return None
        rounded = number.quantize(Decimal("0.01"))
        return format(rounded, ".2f") if rounded == number else None
    except (InvalidOperation, ValueError):
        return None


def iso_date(value: Any, formats: list[str]) -> str | None:
    value = scalar(value)
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, str):
        parsed = set()
        for pattern in ["%Y-%m-%d", *formats]:
            # Never infer a missing year/month/day or the current date.
            if not ("%Y" in pattern and "%m" in pattern and "%d" in pattern):
                continue
            try:
                parsed.add(datetime.strptime(value.strip(), pattern).date().isoformat())
            except ValueError:
                pass
        if len(parsed) == 1:
            return parsed.pop()
    return None


def parse_invoice(extraction: Any, templates: list) -> dict:
    fields = {name: None for name in [
        "supplier_name", "external_invoice_number", "invoice_date", "due_date",
        "amount_net", "amount_vat", "amount_gross", "currency",
    ]}
    warnings = []
    metadata = extraction.metadata
    incomplete = len(metadata.pages) != metadata.page_count or any(
        page.route_reason in INCOMPLETE_REASONS or page.source == "native_fallback"
        for page in metadata.pages
    )
    if incomplete:
        warnings.append("incomplete_extraction")
    if any(page.source == "ocr" and (page.ocr_confidence is None or page.ocr_confidence < 80)
           for page in metadata.pages):
        warnings.append("low_ocr_confidence")
    if not extraction.text.strip():
        warnings.append("no_readable_text")
    matches = []
    for template in templates:
        prepared = template.prepare_input(extraction.text)
        if template.matches_input(prepared):
            matches.append((template, prepared))
    template_name = None
    lines = []
    if len(matches) != 1:
        warnings.append("template_not_found" if not matches else "ambiguous_template")
        if not matches:
            generic_fields, generic_warnings = extract_german_fields(extraction.text)
            fields.update(generic_fields)
            warnings.extend(generic_warnings)
    else:
        template, prepared = matches[0]
        template_name = template["template_name"]
        raw = template.extract(prepared, "", text_reader)
        separator = template.options["decimal_separator"]
        fields["supplier_name"] = template["issuer"]
        for source, target in FIELD_MAP.items():
            value = raw.get(source)
            if source.startswith("amount"):
                normalized = money(value, separator)
            elif source.endswith("date"):
                normalized = iso_date(value, template.options.get("date_formats", []))
            else:
                normalized = scalar(value)
                normalized = str(normalized).strip() if isinstance(normalized, (str, int)) else None
            fields[target] = normalized or None
            if value is not None and fields[target] is None:
                warnings.append(f"invalid_or_ambiguous_{target}")
        currency = scalar(raw.get("currency"))
        if isinstance(currency, str) and re.fullmatch(r"[A-Z]{3}", currency.strip()):
            fields["currency"] = currency.strip()
        elif raw.get("currency") is not None:
            warnings.append("invalid_or_ambiguous_currency")
        # Preserve supplier-specific line fields for review. Never interpret a
        # line subtotal as gross, or derive VAT/payment status from OCR.
        lines = raw.get("lines", [])
        if "lines" in template["fields"] and not lines:
            warnings.append("line_items_not_found")
        if isinstance(lines, dict):
            lines = [lines]
        if not isinstance(lines, list):
            lines = []
            warnings.append("invalid_line_items")
        if len(lines) > 500:
            lines = lines[:500]
            warnings.append("line_items_truncated")
    details = extract_details(extraction.text, fields, warnings)
    if not lines:
        lines = details.get("line_items", [])
    amounts = [fields[key] for key in ("amount_net", "amount_vat", "amount_gross")]
    if all(value is not None for value in amounts):
        net, vat, gross = map(Decimal, amounts)
        if abs(net + vat - gross) > Decimal("0.01"):
            warnings.append("totals_mismatch")
    if fields["invoice_date"] and fields["due_date"] and fields["due_date"] < fields["invoice_date"]:
        warnings.append("due_date_before_invoice_date")
    missing = [key for key in ("supplier_name", "external_invoice_number", "invoice_date", "amount_gross", "currency")
               if fields[key] is None]
    if missing:
        warnings.append("missing_required_fields")
    return {
        "schema_version": "1.0", "status": "needs_review", "requires_review": True,
        "template": template_name, "fields": fields, "line_items": lines,
        "missing_fields": missing, "warnings": warnings,
        "extraction_complete": not incomplete, "extraction": asdict(metadata),
        "text": extraction.text,
        "field_sources": details.get("field_sources", {}), "payment": details.get("payment", {}),
    }
