# Datenschutz-Nachweise (DSGVO / NIS2)

Entwürfe, erstellt aus dem tatsächlichen Stand des Systems (Stand 2026-09-17).
Sie ersetzen keine Rechtsberatung: jeder Entwurf ist vom Datenschutzbeauftragten
(DSB) zu prüfen, um die organisatorischen Angaben zu ergänzen und freizugeben.
Grundlage: BMWi-Orientierungshilfe Gesundheitsdatenschutz und ENISA Technical
Implementation Guidance (NIS2).

| Dokument | Pflicht | Inhalt |
|---|---|---|
| [01_tom.md](01_tom.md) | Art. 32 DSGVO | Technische und organisatorische Maßnahmen, mit Fundstelle im Code |
| [02_vvt.md](02_vvt.md) | Art. 30 DSGVO | Verzeichnis der Verarbeitungstätigkeiten |
| [03_auftragsverarbeiter.md](03_auftragsverarbeiter.md) | Art. 28, 44 ff. DSGVO | Dienstleister, AVV-Status, Drittlandbezug |
| [04_loeschkonzept.md](04_loeschkonzept.md) | Art. 5, 17 DSGVO | Löschfristen und wie das System sie umsetzt |
| [05_dsfa_vorpruefung.md](05_dsfa_vorpruefung.md) | Art. 35 DSGVO | Vorprüfung und Gerüst der Datenschutz-Folgenabschätzung |

## Was nur die Organisation liefern kann

Diese Punkte lassen sich nicht aus dem Code ableiten und fehlen noch:

- Benennung des DSB und Meldung an die Aufsichtsbehörde (Art. 37 DSGVO, § 38 BDSG).
- Verpflichtung aller Beschäftigten und Dolmetscher auf Vertraulichkeit vor
  Tätigkeitsbeginn; für Daten, die von Ärzten stammen, zusätzlich der Hinweis auf
  § 203 StGB (mitwirkende Personen).
- Unterschriebene AVV mit jedem Auftragsverarbeiter aus Dokument 03.
- Schulungsnachweise, Rollen für die Bearbeitung von Betroffenenanfragen und
  Datenpannen (wer entscheidet innerhalb der 72 Stunden).
- Datenschutzerklärung und Impressum der öffentlichen Website und des Portals.
