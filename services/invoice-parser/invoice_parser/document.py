"""Select structured invoice data before the existing PDF/image OCR path."""
from dataclasses import asdict
from hashlib import sha256
from io import BytesIO
import os
import re

from .parser import parse_invoice
from .structured import MAX_XML_BYTES, InvalidInvoiceXml, parse_xml_invoice


def embedded_invoice(data: bytes):
    from pypdf import PdfReader, filters

    # Applied only inside the disposable document worker and restored before
    # normal extraction. Bound decompression before accessing attachment bytes.
    names = ("MAX_DECLARED_STREAM_LENGTH", "MAX_ARRAY_BASED_STREAM_OUTPUT_LENGTH",
             "LZW_MAX_OUTPUT_LENGTH", "RUN_LENGTH_MAX_OUTPUT_LENGTH", "ZLIB_MAX_OUTPUT_LENGTH")
    previous = {name: getattr(filters, name) for name in names if hasattr(filters, name)}
    warnings = []
    invoices = {}
    try:
        for name in previous:
            setattr(filters, name, MAX_XML_BYTES)
        reader = PdfReader(BytesIO(data), strict=False)
        if reader.is_encrypted:
            return None, None, []
        for index, attachment in enumerate(reader.attachment_list):
            if index >= 16:
                return None, reader, ["embedded_xml_limit"]
            name = str(attachment.alternative_name or attachment.name)
            if not name.lower().endswith(".xml"):
                continue
            try:
                if attachment.size is not None and attachment.size > MAX_XML_BYTES:
                    raise InvalidInvoiceXml("xml_size_limit")
                xml = attachment.content
                result = parse_xml_invoice(xml)
                result["structured"]["filename"] = re.split(r"[/\\]", name)[-1][:200]
                result["structured"]["sha256"] = sha256(xml).hexdigest()
                invoices.setdefault(sha256(xml).hexdigest(), result)
            except Exception:
                warnings.append("embedded_xml_unreadable")
        if len(invoices) > 1:
            return None, reader, ["multiple_embedded_invoices"]
        if invoices and not warnings:
            return next(iter(invoices.values())), reader, []
        # Do not silently choose one valid XML when another could not be read.
        return None, reader, list(dict.fromkeys(warnings))
    except Exception:
        return None, None, ["embedded_xml_unreadable"]
    finally:
        for name, value in previous.items():
            setattr(filters, name, value)


def parse_document(data: bytes, mime: str, templates: list) -> dict:
    from app.extraction import ExtractionMetadata, ExtractionResult, PageExtractionMetadata, extract_document

    if mime in {"application/xml", "text/xml"}:
        return parse_xml_invoice(data)
    structured = reader = None
    warnings = []
    if mime == "application/pdf":
        structured, reader, warnings = embedded_invoice(data)
    if structured is None:
        result = parse_invoice(extract_document(data, mime), templates)
        result["source_format"] = "ocr" if result["extraction"]["used_ocr"] else "pdf_text"
        result["warnings"] = list(dict.fromkeys(result["warnings"] + warnings))
        return result
    maximum = int(os.environ.get("PARSER_MAX_PDF_PAGES", "20"))
    if len(reader.pages) > maximum:
        raise InvalidInvoiceXml("pdf_page_limit")
    # The XML supplies facts even when its visible PDF is a scan. Compare only
    # native PDF text here; OCR is neither necessary nor treated as authoritative.
    texts = []
    pages = []
    count = 0
    comparison_complete = True
    for index, page in enumerate(reader.pages):
        try:
            text = page.extract_text(extraction_mode="layout") or ""
            if count + len(text) > 200000:
                raise ValueError()
        except Exception:
            text = ""
            comparison_complete = False
        count += len(text)
        texts.append(text)
        pages.append(PageExtractionMetadata(page_number=index + 1, source="native", route_reason="embedded_xml_comparison",
                                            native_quality=None, native_char_count=len(text)))
    original = "\n\f\n".join(texts)
    extraction = ExtractionResult(original, ExtractionMetadata(len(pages), len(original), False, tuple(pages)))
    visible = parse_invoice(extraction, templates)
    differences = []
    for key in ("external_invoice_number", "invoice_date", "due_date", "currency", "amount_net", "amount_vat", "amount_gross"):
        xml_value, pdf_value = structured["fields"].get(key), visible["fields"].get(key)
        if xml_value is not None and pdf_value is not None and xml_value != pdf_value:
            differences.append({"field": key, "structured": xml_value, "visible": pdf_value})
    if differences:
        structured["warnings"].append("structured_pdf_mismatch")
    if not comparison_complete or not original.strip() or any(visible["fields"].get(key) is None for key in ("external_invoice_number", "amount_net", "amount_vat", "amount_gross")):
        structured["warnings"].append("structured_pdf_comparison_unavailable")
    structured["source_format"] = "embedded_xml"
    structured["source_differences"] = differences
    structured["text"] = original or structured["text"]
    structured["extraction"] = asdict(extraction.metadata)
    return structured
