"""One document per disposable process; stdout is a private JSON protocol."""
import contextlib
from datetime import date, datetime
from decimal import Decimal
import json
import logging
import os
from pathlib import Path
import sys


def json_default(value):
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return str(value)
    raise TypeError("Unsupported template output")


def main() -> int:
    logging.disable(logging.CRITICAL)
    # The service's first image uses the existing CPU OCR implementation.
    os.environ["PARSER_OCR_ENGINE"] = "tesseract"
    os.environ.setdefault("PARSER_MAX_PDF_PAGES", "20")
    os.environ.setdefault("PARSER_MAX_IMAGE_PIXELS", "25000000")
    os.environ.setdefault("PARSER_MAX_EXTRACTED_TEXT_CHARS", "200000")
    os.environ.setdefault("OMP_THREAD_LIMIT", "1")
    try:
        with contextlib.redirect_stdout(sys.stderr):
            from .parser import load_templates
            from .document import parse_document

            templates = load_templates(Path(os.environ.get("INVOICE_PARSER_TEMPLATE_DIR", "templates")))
            maximum = int(os.environ.get("INVOICE_PARSER_MAX_FILE_BYTES", 25 * 1024 * 1024))
            data = sys.stdin.buffer.read(maximum + 1)
            if not data or len(data) > maximum:
                raise ValueError("Invalid document size")
            result = parse_document(data, sys.argv[1], templates)
        encoded = json.dumps(result, default=json_default, ensure_ascii=True, allow_nan=False).encode()
        if len(encoded) > 4 * 1024 * 1024:
            raise ValueError("Result exceeds limit")
        sys.stdout.buffer.write(encoded)
        return 0
    except Exception:
        # Library errors can contain invoice text. The caller receives only a
        # stable code; neither stderr nor document contents enter service logs.
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
