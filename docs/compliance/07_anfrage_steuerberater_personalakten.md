# Anfrage an den Steuerberater: digitale Personalakten

Entwurf, Stand 2026-10-01. Antwort auf das Schreiben vom September 2026 zur
elektronischen Führung der Entgeltunterlagen ab 01.01.2027 (§ 8 BVV). Angaben in
eckigen Klammern ergänzt die Geschäftsführung vor dem Versand. Nach der Antwort
werden Kategorien und Fristen im System angepasst und die Löschung freigeschaltet
([06_verfahrensdokumentation_personalakten.md](06_verfahrensdokumentation_personalakten.md)).

---

**Betreff:** Digitale Personalakten ab 01.01.2027 – Umsetzung und Bitte um Bestätigung

Sehr geehrte/r [Name],

vielen Dank für Ihr Schreiben zur elektronischen Führung der Entgeltunterlagen. Wir
haben die Anforderungen in unserem System (GMED Console) umgesetzt und bitten Sie um
Bestätigung der folgenden Punkte.

**1. Umsetzung**

- Jede beschäftigte Person hat eine digitale Personalakte. Zulässige Formate: PDF,
  JPEG, PNG, BMP, TIFF.
- Ein archiviertes Dokument kann weder geändert noch gelöscht werden. Korrekturen
  werden als neue Version mit Begründung abgelegt; die frühere Version bleibt
  erhalten. Jedes Dokument ist über eine Prüfsumme (SHA-256) gesichert, die Akten
  werden wöchentlich automatisch geprüft, alle Zugriffe werden protokolliert.
- Der Archivierungszeitpunkt wird vom System gesetzt. Für monatliche Unterlagen
  (Stundenzettel, Entgeltabrechnung) kontrollieren wir die Vollständigkeit je Person
  und Monat; als verspätet gilt ein Eingang später als 7 Tage nach Monatsende.
- Für Prüfungen und für Sie exportieren wir die Unterlagen je Person und Zeitraum als
  ZIP-Datei mit Inhaltsverzeichnis und Prüfsummen.

**2. Dateinamen – bitte bestätigen**

Das System vergibt die Namen selbst, höchstens 64 Zeichen, ohne Umlaute, ß,
Leer-, Satz- und Sonderzeichen. Als Trenner verwenden wir den Unterstrich:

- `Stundenzettel_2026_05_Mustermann_Gabriele.pdf` (monatliche Unterlagen)
- `Arbeitsvertrag_20260115_Mustermann_Gabriele.pdf` (Unterlagen mit Datum)
- Korrektur: `Stundenzettel_2026_05_Mustermann_Gabriele_V2.pdf`

Frage: Ist der Unterstrich zulässig, oder müssen die Namen ganz ohne Trennzeichen
gebildet werden?

**3. Kategorien und Aufbewahrungsfristen – bitte bestätigen oder korrigieren**

| Kategorie | Frist | ab Ende des Kalenderjahres | Grundlage (unsere Annahme) |
|---|---:|---|---|
| Entgeltabrechnung | 8 Jahre | des Dokuments | § 147 AO |
| Lohnsteuer | 6 Jahre | der letzten Eintragung | § 41 EStG |
| Stundenzettel | 6 Jahre | des Dokuments | § 28f SGB IV, § 17 MiLoG |
| Sozialversicherung (Meldungen, Mitgliedsbescheinigung) | 6 Jahre | des Dokuments | § 28f SGB IV |
| Arbeitsvertrag, Vertragsänderung, Nachweis (NachwG), Kündigung | 6 Jahre | des Austritts | § 257 HGB |
| Zeugnis, Urlaub, Schriftverkehr, Sonstiges | 3 Jahre | des Austritts | § 195 BGB |
| Arbeitsunfähigkeit | 3 Jahre | des Dokuments | Entgeltfortzahlung |
| Abmahnung | 3 Jahre | des Dokuments | Rechtsprechung |

Fragen:

1. Sind die Fristen und ihr Beginn richtig? Bis zu Ihrer Bestätigung löschen wir
   nichts.
2. Fehlt eine Kategorie, die nach § 8 BVV zu den Entgeltunterlagen gehört (z. B.
   Nachweise zur Elterneigenschaft, Unterlagen zu Minijobs, Bescheinigungen A1,
   Immatrikulationsbescheinigungen)?
3. Gilt die Pflicht nur für die Entgeltunterlagen oder führen wir die gesamte
   Personalakte in dieser Form?

**4. Bestand und Übergabe**

4. Müssen Papierunterlagen aus der Zeit vor dem 01.01.2027 nachträglich
   digitalisiert werden, und dürfen die Originale danach vernichtet werden?
5. In welcher Form möchten Sie die Unterlagen künftig erhalten: ZIP-Export mit
   Prüfsummen, Upload in DATEV Unternehmen online oder anders?
6. Die Entgeltabrechnungen erhalten die Beschäftigten über das
   DATEV-Mitarbeiterportal. Genügt es, wenn wir Kopien in der Personalakte
   archivieren?

Mit freundlichen Grüßen

[Name], Geschäftsführung [Firma]
