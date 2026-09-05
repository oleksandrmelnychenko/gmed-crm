"""Run inside the release image; requires a mounted examples directory."""
from io import BytesIO
import json
import os
from pathlib import Path
import subprocess
import sys

from PIL import Image, ImageDraw, ImageFont


examples = Path(os.environ.get("INVOICE_SMOKE_EXAMPLES", "/examples"))
text = (examples / "synthetic-invoice.txt").read_text()
image = Image.new("RGB", (1800, 1000), "white")
font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 32)
ImageDraw.Draw(image).multiline_text((60, 60), text, font=font, fill="black", spacing=18)
data = BytesIO()
image.save(data, format="PNG")
environment = {**os.environ, "INVOICE_PARSER_TEMPLATE_DIR": str(examples / "templates")}
completed = subprocess.run(
    [sys.executable, "-m", "invoice_parser.worker", "image/png"],
    input=data.getvalue(), capture_output=True, timeout=120, env=environment,
)
assert completed.returncode == 0, "Image OCR worker failed"
draft = json.loads(completed.stdout)
assert draft["extraction"]["used_ocr"] is True
assert draft["fields"]["external_invoice_number"] == "DEMO-2026-001"
assert draft["fields"]["amount_gross"] == "119.00"
assert draft["requires_review"] is True
print("Invoice image OCR smoke passed")
