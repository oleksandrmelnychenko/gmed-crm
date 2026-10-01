# Verfahrensdokumentation: digitale Personalakten

Entwurf, Stand 2026-10-01. Beschreibt, wie die GMED Console Personalakten und
Entgeltunterlagen digital, unveränderbar und zeitnah aufbewahrt (§ 8 BVV, ab
01.01.2027 ausschließlich elektronisch). Aufbau nach GoBD Rz. 151 ff.
(allgemeine Beschreibung, Anwenderdokumentation, technische Dokumentation,
Betriebsdokumentation). Angaben in eckigen Klammern ergänzt die Organisation;
Fristen und Kategorien bestätigt der Steuerberater.

## 1. Allgemeine Beschreibung

| | |
|---|---|
| Zweck | Nachweis der Beschäftigung und der Sozialversicherung; Ablage aller Unterlagen zum Arbeitsverhältnis |
| Betroffene | Beschäftigte und ehemalige Beschäftigte [Firma] |
| Verantwortlich | Geschäftsführung (einzige Rolle mit Zugriff auf alle Personalakten) |
| Entgeltabrechnung | DATEV über den Steuerberater; Entgeltabrechnungen erhalten die Beschäftigten im DATEV-Mitarbeiterportal. Kopien werden in der Personalakte archiviert. |
| System | GMED Console, Modul „Personalakten“ (`crates/server/src/routes/personnel/`) |

## 2. Anwenderdokumentation (Ablauf)

1. **Eingang.** Papier wird an der Scanstation gescannt (`gmed-scan --personnel`)
   und landet in der Scan-Warteschlange der Personalakten; der Eingangszeitpunkt
   wird gespeichert. Digitale Dokumente lädt die Geschäftsführung direkt in die Akte.
2. **Zuordnung.** Die Geschäftsführung ordnet jedes Dokument einer beschäftigten
   Person, einer Kategorie und einem Zeitraum (Monat) bzw. Dokumentdatum zu.
   Falsche Scans werden mit Begründung verworfen.
3. **Benennung.** Das System bildet den Dateinamen aus Kategorie, Zeitraum und Name,
   z. B. `Stundenzettel_2026_05_Mustermann_Gabriele.pdf`: höchstens 64 Zeichen,
   keine Umlaute, kein ß, keine Leer-, Satz- oder Sonderzeichen außer `_` (Umlaute
   werden umgeschrieben: ä → ae, ß → ss). Der Name wird nicht von Hand vergeben;
   der ursprüngliche Dateiname (z. B. `Scan100.pdf`) bleibt nur als Metadatum.
4. **Archivierung.** Zulässige Formate: PDF, JPEG, PNG, BMP, TIFF (Inhaltsprüfung
   anhand der Dateisignatur, Virenprüfung). Der Archivierungszeitpunkt wird von der
   Datenbank gesetzt.
5. **Korrektur.** Ein archiviertes Dokument kann nicht geändert oder ersetzt werden.
   Eine Korrektur wird als neue Version (`_V2`, `_V3` …) mit Pflichtbegründung
   archiviert; alle Versionen bleiben sichtbar.
6. **Kontrolle der Vollständigkeit und Zeitnähe.** Für monatliche Unterlagen
   (Stundenzettel, Entgeltabrechnung) zeigt eine Übersicht je beschäftigter Person
   und Monat: vorhanden, verspätet, fehlend, offen. Als verspätet gilt ein Dokument,
   das später als [7] Tage nach Monatsende (bzw. nach dem Dokumentdatum) eingegangen
   ist. Nach Ablauf dieser Frist erhält die Geschäftsführung eine Erinnerung über
   fehlende Unterlagen des Vormonats.
7. **Einsicht der Beschäftigten.** Wer ein Benutzerkonto hat, das mit der eigenen
   Personalakte verknüpft ist, sieht und lädt die eigenen Dokumente (§ 83 BetrVG,
   Art. 15 DSGVO); Ändern oder Hinzufügen ist nicht möglich.
8. **Prüfung (Betriebsprüfung, Steuerberater).** Export als ZIP je beschäftigter
   Person und Zeitraum: Dateien unter Archivnamen, `Index.csv`, `Manifest.sha256`,
   `Pruefbericht.txt` und die täglichen Anker mit Zeitstempeln.
9. **Aufbewahrung und Löschung.** Fristen je Kategorie siehe
   [04_loeschkonzept.md](04_loeschkonzept.md). Löschung erst nach Fristablauf, ohne
   Legal Hold, mit Begründung und nur, wenn die Löschung freigeschaltet ist
   (Standard: aus, bis der Steuerberater die Fristen bestätigt).

## 3. Technische Dokumentation

| Anforderung | Umsetzung |
|---|---|
| Unveränderbarkeit | Tabelle `personnel_documents`: Trigger `personnel_documents_immutable` verweigert jede Änderung von Inhalt, Name, Zeitpunkten und Urheber sowie jedes DELETE. Änderbar sind nur Legal Hold und – nach Fristablauf – die Löschmarkierung (Datei entfernt, Datensatz mit Prüfsumme bleibt). |
| Nachvollziehbarkeit jeder Änderung | Hash-Kette je beschäftigter Person: `chain_hash` = SHA-256 über vorherigen Hash, ID, Person, Position, SHA-256 der Datei, Kategorie, Archivname und Archivzeitpunkt, gebildet von der Datenbank beim Einfügen (`personnel_chain_hash`). Jede nachträgliche Änderung, Entfernung oder Umordnung bricht die Kette. |
| Nachweis des Zeitpunkts | Täglicher Anker: SHA-256 über alle Kettenköpfe, mit RFC-3161-Zeitstempel eines externen Zeitstempeldienstes (Vorschlag: Sectigo, `https://timestamp.sectigo.com`, nicht qualifiziert, kostenfrei; [Entscheidung der Geschäftsführung]). An den Dienst geht nur der Hashwert. Der Anker erkennt auch das Entfernen der jüngsten Dokumente einer Kette. |
| Prüfung | Wöchentlich automatisch und jederzeit auf Anforderung: Neuberechnung aller Kettenglieder, Abgleich jeder Datei mit ihrem SHA-256, Abgleich mit allen Ankern. Abweichungen: Benachrichtigung der Geschäftsführung, Eintrag im Journal der Akte. |
| Protokoll | Append-only Journal `personnel_document_events` (Anlage, Archivierung, Versionen, Abrufe, Exporte, Legal Hold, Löschungen, Prüffehler), aufbewahrt so lange wie die Akte. |
| Vertraulichkeit | Dateien AES-256-GCM-verschlüsselt (Schlüsselrotation), Zugriff nur Geschäftsführung bzw. die betroffene Person; IT-Administration ohne Zugriff auf Inhalte und ohne Zugriff auf die Einstellungen des Moduls. |
| Formate | PDF, JPEG, PNG, BMP, TIFF; maximal 25 MB je Datei. |

## 4. Betriebsdokumentation

- Datensicherung: tägliche verschlüsselte Sicherung von Datenbank und Dokumentdateien,
  vierteljährlicher Wiederherstellungstest ([01_tom.md](01_tom.md)). Die Sicherungen
  werden 35 Tage aufbewahrt. Das Archiv selbst liegt im Produktivsystem und ist in jeder
  täglichen Sicherung vollständig enthalten; die wöchentliche Integritätsprüfung meldet
  eine beschädigte oder fehlende Datei innerhalb von 7 Tagen, also innerhalb der 35 Tage,
  in denen noch eine unbeschädigte Sicherung vorliegt. Eine zusätzliche Langzeitsicherung
  ist deshalb nicht vorgesehen. [Freigabe durch die Geschäftsführung.]
- Zeitstempeldienst: Ausfälle werden bis zu zehnmal wiederholt; der Status je Tag ist
  in der Integritätsübersicht sichtbar. Die Adresse trägt die Geschäftsführung unter
  Personalakten → Einstellungen ein; Anker aus der Zeit davor werden nachträglich
  gestempelt (der Zeitstempel belegt dann den späteren Zeitpunkt).
- Prüfung eines Zeitstempels außerhalb des Systems (Datei `<Datum>.tsr` und Ankerhash
  aus `<Datum>.txt` im Export):
  `openssl ts -verify -digest <Ankerhash> -in <Datum>.tsr -CAfile tsa/sectigo-timestamping-root-r46.pem -partial_chain`.
  Das Wurzelzertifikat des vorgeschlagenen Dienstes liegt unter
  [tsa/sectigo-timestamping-root-r46.pem](tsa/sectigo-timestamping-root-r46.pem)
  (SHA-256-Fingerabdruck
  `B5:3A:C1:5C:C1:AF:B6:E2:AC:06:82:8F:55:5B:B3:BF:5B:AD:8B:2B:AC:17:33:CE:4C:B7:AA:FE:72:93:56:DE`,
  gültig bis 18.01.2038); die Zwischenzertifikate stecken im Zeitstempel selbst. Bei
  einem anderen Dienst ist dessen Wurzelzertifikat hier abzulegen.
- Verantwortlich für die Ablage: [Name]; Vertretung: [Name].

## 5. Offene Punkte

- Bestätigung der Kategorien, Fristen und des Namensschemas (`_` als Trenner) durch
  den Steuerberater ([Anfrage](07_anfrage_steuerberater_personalakten.md)); danach
  Freischaltung der Löschung.
- Entscheidung über den Zeitstempeldienst und Eintrag der Adresse in den Einstellungen.
  Geprüft am 01.10.2026: Antworten von Sectigo und DigiCert werden vom System
  angenommen und von `openssl ts -verify` bestätigt. Ein qualifizierter Dienst nach
  eIDAS (kostenpflichtig, Vertrag nötig) kann später ohne Programmänderung eingetragen
  werden; ob er nötig ist, entscheidet die Geschäftsführung mit dem Steuerberater.
- Angaben in eckigen Klammern (Firma, Verantwortliche, Vertretung) ergänzen.
- Freigabe dieser Dokumentation durch Geschäftsführung und DSB.
