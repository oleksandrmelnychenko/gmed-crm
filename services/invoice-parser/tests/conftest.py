from io import BytesIO
import os
from pathlib import Path
import shutil

import pytest


ROOT = Path(__file__).resolve().parents[1]
SAMPLE = (ROOT / "examples/synthetic-invoice.txt").read_text(encoding="utf-8")


def native_pdf(text=SAMPLE):
    from pypdf import PdfWriter
    from pypdf.generic import DictionaryObject, NameObject, DecodedStreamObject

    writer = PdfWriter()
    page = writer.add_blank_page(width=612, height=792)
    font = DictionaryObject({NameObject("/Type"): NameObject("/Font"),
                             NameObject("/Subtype"): NameObject("/Type1"),
                             NameObject("/BaseFont"): NameObject("/Helvetica")})
    page[NameObject("/Resources")] = DictionaryObject({NameObject("/Font"): DictionaryObject({NameObject("/F1"): font})})
    commands = ["BT /F1 12 Tf 40 750 Td 18 TL"]
    for line in text.splitlines():
        escaped = line.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
        commands.append(f"({escaped}) Tj T*")
    commands.append("ET")
    stream = DecodedStreamObject()
    stream.set_data("\n".join(commands).encode("latin-1"))
    page[NameObject("/Contents")] = writer._add_object(stream)
    output = BytesIO()
    writer.write(output)
    return output.getvalue()


def invoice_png():
    from PIL import Image, ImageDraw, ImageFont

    image = Image.new("RGB", (1800, 1000), "white")
    font = ImageFont.load_default(size=32)
    ImageDraw.Draw(image).multiline_text((60, 60), SAMPLE, fill="black", font=font, spacing=18)
    output = BytesIO()
    image.save(output, format="PNG")
    return output.getvalue()


@pytest.fixture(autouse=True)
def worker_environment(monkeypatch):
    monkeypatch.setenv("PYTHONPATH", os.pathsep.join([str(ROOT), str(ROOT.parent / "clinical-document-parser")]))
    monkeypatch.setenv("INVOICE_PARSER_TEMPLATE_DIR", str(ROOT / "examples/templates"))
    monkeypatch.setenv("PARSER_OCR_ENGINE", "tesseract")
    for name in ("PRIMARY", "CYRILLIC", "UKRAINIAN", "RUSSIAN"):
        monkeypatch.setenv(f"PARSER_OCR_{name}_LANGUAGES", "eng")
    if not shutil.which("tesseract") and Path("C:/Program Files/Tesseract-OCR/tesseract.exe").is_file():
        monkeypatch.setenv("PATH", "C:/Program Files/Tesseract-OCR" + os.pathsep + os.environ["PATH"])
