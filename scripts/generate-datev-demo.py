"""Rebuild synthetic frontend PDF fixtures (requires reportlab and Poppler).

Usage: python scripts/generate-datev-demo.py --pdftoppm /path/to/pdftoppm
Only fictional demo records belong here; never copy customer invoices into public/.
"""
import argparse
from pathlib import Path
import subprocess

from reportlab.lib.colors import HexColor
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen.canvas import Canvas

parser = argparse.ArgumentParser()
parser.add_argument("--pdftoppm", required=True)
args = parser.parse_args()
destination = Path(__file__).resolve().parents[1] / "frontend/public/demo/datev"
destination.mkdir(parents=True, exist_ok=True)

fixtures = [
    ("Musterzentrum Nord", "Alex Muster", "DEMO-PT-1001", "01.09.2026", "15.09.2026", [("Beispielleistung A", 1, 18000), ("Beispielleistung B", 2, 3000)]),
    ("Demo Labor West", "Mia Beispiel", "", "02.09.2026", "16.09.2026", [("Beispielleistung C", 1, 8500)]),
    ("Musterpraxis Sued", "Sam Unbekannt", "", "03.09.2026", "17.09.2026", [("Beispielleistung D", 1, 15000)]),
]

def money(cents):
    return f"{cents / 100:,.2f}".replace(",", "_").replace(".", ",").replace("_", ".") + " EUR"

for index, (supplier, recipient, patient_id, invoice_date, due_date, lines) in enumerate(fixtures, 1):
    file = destination / f"demo-datev-{index:03}.pdf"
    c = Canvas(str(file), pagesize=A4, invariant=1)
    c.setTitle(f"DEMO-2026-{index:03} - Fiktive Rechnung")
    c.setAuthor("GMed - synthetic demonstration")
    c.setFillColor(HexColor("#eaf3ee"))
    c.rect(0, 740, A4[0], 102, fill=1, stroke=0)
    c.setFillColor(HexColor("#163b2c"))
    c.setFont("Helvetica-Bold", 22)
    c.drawString(44, 790, supplier)
    c.setFont("Helvetica", 10)
    c.drawString(44, 768, "Fiktiver Anbieter - ausschliesslich fuer GMed-Demonstrationen")
    c.setFillColor(HexColor("#aa6900"))
    c.setFont("Helvetica-Bold", 11)
    c.drawString(44, 708, "MUSTER / DEMO - KEINE ECHTE RECHNUNG")
    c.setFillColor(HexColor("#182a22"))
    c.setFont("Helvetica-Bold", 20)
    c.drawString(44, 658, f"Rechnung DEMO-2026-{index:03}")
    c.setFont("Helvetica", 11)
    c.drawString(44, 622, f"Rechnungsempfaenger: {recipient}")
    if patient_id:
        c.drawString(44, 602, f"Patient-ID: {patient_id}")
    c.drawString(44, 562, f"Rechnungsdatum: {invoice_date}")
    c.drawString(330, 562, f"Faellig am: {due_date}")
    c.setFillColor(HexColor("#f1f4f2"))
    c.rect(44, 504, 507, 30, fill=1, stroke=0)
    c.setFillColor(HexColor("#182a22"))
    c.setFont("Helvetica-Bold", 10)
    c.drawString(54, 515, "Bezeichnung")
    c.drawRightString(365, 515, "Menge")
    c.drawRightString(541, 515, "Netto")
    y = 478
    c.setFont("Helvetica", 11)
    for description, quantity, unit_cents in lines:
        c.drawString(54, y, description)
        c.drawRightString(365, y, str(quantity))
        c.drawRightString(541, y, money(quantity * unit_cents))
        y -= 30
    net = sum(q * amount for _, q, amount in lines)
    vat = net * 19 // 100
    for label, amount in [("Nettobetrag", net), ("Umsatzsteuer (19 %)", vat)]:
        c.drawString(330, y - 28, label)
        c.drawRightString(541, y - 28, money(amount))
        y -= 26
    c.setStrokeColor(HexColor("#c8d8ce"))
    c.line(330, y - 8, 551, y - 8)
    c.setFont("Helvetica-Bold", 12)
    c.drawString(330, y - 32, "Gesamtbetrag")
    c.drawRightString(541, y - 32, money(net + vat))
    c.setFillColor(HexColor("#66736b"))
    c.setFont("Helvetica", 10)
    c.drawString(44, 128, "Alle Namen, Leistungen und Betraege sind frei erfunden.")
    c.drawString(44, 110, "Kein Zahlungsauftrag. Keine Buchung. Keine Verbindung zu DATEV.")
    c.setFont("Helvetica", 9)
    c.drawString(44, 52, "GMed Demo | Ansicht und Patientenzuordnung")
    c.drawRightString(551, 52, "1 / 1")
    c.save()
    subprocess.run([args.pdftoppm, "-png", "-singlefile", "-scale-to", "1400", str(file), str(file.with_suffix(""))], check=True)
    print(file.name)
