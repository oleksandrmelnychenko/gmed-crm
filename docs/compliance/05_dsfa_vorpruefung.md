# Datenschutz-Folgenabschätzung: Vorprüfung und Gerüst (Art. 35 DSGVO)

Entwurf, Stand 2026-09-17.

## Stufe 1 – Ist eine DSFA erforderlich?

Ja. Die GMED Console verarbeitet Gesundheitsdaten (Art. 9 DSGVO) nicht nur im
Einzelfall, sondern als Kern der Tätigkeit, für Patienten aus mehreren Staaten,
und gibt sie an Leistungserbringer weiter. Nach Art. 35 Abs. 3 lit. b DSGVO und der
Liste der deutschen Aufsichtsbehörden ist von einem hohen Risiko auszugehen. Die
Ausnahme für den einzelnen Arzt (Erwägungsgrund 91) greift nicht.

## Stufe 2 – Gerüst

### 1. Systematische Beschreibung
Verarbeitungen 1 bis 5 aus dem [Verzeichnis](02_vvt.md), jeweils mit Zweck,
Rechtsgrundlage und Datenfluss: Anfrage → Vertrag und Einwilligungen (Skribble) →
Patientenakte → Weitergabe an Leistungserbringer → Abrechnung (DATEV).

### 2. Notwendigkeit und Verhältnismäßigkeit
- Erhoben wird, was Terminvergabe, Behandlung und Abrechnung brauchen; [prüfen:
  Pflichtfelder im Wizard auf das Notwendige begrenzen].
- Einwilligungen sind zweckgebunden, getrennt je Kanal und widerrufbar; der
  Widerruf zieht offene Freigaben zurück.
- Betroffenenrechte sind im System abgebildet (Register mit Fristen).

### 3. Risiken für die Betroffenen

| Risiko | Eintritt | Schwere | Maßnahmen | Restrisiko |
|---|---|---|---|---|
| Unbefugter Zugriff auf Akten durch Beschäftigte | mittel | hoch | Zuweisungsprinzip, Feldrichtlinien, Protokoll der Lesezugriffe und Downloads | mittel, bis zweiter Faktor verpflichtend ist |
| Kontoübernahme | mittel | hoch | Argon2id, Passwort-Historie, Sperre, Rate-Limit, Abmeldung bei Inaktivität, TOTP-Pflicht für CEO, IT-Admin und Patientenmanager | gering, sobald alle Pflichtrollen eingerichtet sind |
| Fehlversand an falschen Empfänger | mittel | hoch | Freigabe nur an registrierte Kanäle des Leistungserbringers, Bestätigungsschritt, Datenpannen-Register | mittel |
| Diebstahl oder Verlust des Servers bzw. Datenträgers | gering | hoch | verschlüsselte Backups außerhalb des Hosts, Dokumentdateien verschlüsselt | mittel – sensible Datenbankspalten noch im Klartext |
| Datenverlust | gering | hoch | tägliche Sicherung von Datenbank und Dateien, Alarmierung | gering nach erstem Restore-Test |
| Übermittlung in Drittländer | fallabhängig | hoch | Skribble (CH) mit Angemessenheitsbeschluss; KI-Dienst gesperrt | gering |
| Überlange Speicherung | mittel | mittel | automatische Lead-Löschung; täglicher Lauf legt Löschanträge für abgeschlossene Akten an; Backups nach 35 Tagen gelöscht | gering |

### 4. Abhilfemaßnahmen und Ergebnis
Die fett markierten Punkte sind umzusetzen oder mit Begründung zu akzeptieren.
Bleibt danach ein hohes Risiko, ist vor Fortsetzung die Aufsichtsbehörde zu
konsultieren (Art. 36 DSGVO).

### 5. Beteiligte
DSB: [Name, Stellungnahme, Datum]. Auftragsverarbeiter haben zugeliefert: [ ].
Überprüfung bei jeder wesentlichen Änderung, spätestens jährlich.
