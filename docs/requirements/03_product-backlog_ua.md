# Функціональний scope за епіками

> **Джерело правди:** аркуш `User Stories` у `docs/1 (Update 2) User Story Salesforce.xlsx` (EPIC, Rolle, User Story, Beschreibung, Security/Compliance, Priority). Кожен пункт нижче відповідає **одному рядку** цього аркуша (номер рядка вказано). Колонки *User Story* та *Beschreibung* наведені **німецькою** як у джерелі (трасованість). Повний український переклад кожного абзацу можна додати підпунктом *UA* після узгодження з клієнтом. Ієрархія джерел: `docs/00_source-of-truth_ua.md`.

<!--
  Порядковий аудит Excel ↔ цей файл: docs/testing/user-stories-excel-backlog-audit_ua.md
  Оновити: python scripts/audit_excel_vs_backlog.py
  Регенерація з Excel: python scripts/generate_product_backlog_from_excel.py
-->

---

## Історична назва документа

Product Backlog (UA) — трасований до User Stories Salesforce.

> Позначення пріоритетів з Excel: `1` — критично, `2` — високо, `3` — середньо, `4` — нижче. Якщо клітинка Priority порожня, у цьому файлі для узгодженості з маркдауном використано **`P1`** — уточнити в Excel за потреби.

## EPIC 1: Картка пацієнта

- **[P1] Пацієнт-менеджер** *(Excel аркуш `User Stories`, **ряд. 2**)* — *User Story (DE):* «Patientenakte anlegen».
  - *Beschreibung (DE):* Pflichtfelder: Name, Titel, Geburtsdatum, Alter, Geschlecht, Herkunftsland/Staatsangehörigkeit, Sprachen Kontakt (Adresse(n), Telefonnummer(n), Email(s)), Versicherung (Versichertendaten); Dokument-Upload; eindeutige Patienten-ID (automatisch generiert),  Bezieungen zu anderen Patienten/Familienangehörige/Notfallkontakt,  Zustimmungsinformationen und rechtl. Status (DSGVO,Schweigefpfichtsentbindungen, Vertragsstatus usw), Notes
  - *Security/Compliance (DE):* AES-256 Speicherung, RBAC Zugriff nur für zuständige Rollen

- **[P1] Пацієнт-менеджер** *(Excel аркуш `User Stories`, **ряд. 3**)* — *User Story (DE):* «Patientenakte pflegen (medizin)».
  - *Beschreibung (DE):* Medikationliste, Diagnosen, Anamnese, Risikofaktoren, Risikoscores), Allergien, Cave-Notizen, Gesundheitsdaten mit Erfassungsdatum (Blutdruck, Gewicht, BMI, Herzfrequenz und andere), Karteikartenzeilen mit Datum und Kategorie, ärztliche/therapeutische Anordnungen, ankommende Vorsorge-/Kontroluntersuchungen, beteiligte behandelnde Ärzte

- **[P1] Пацієнт-менеджер** *(Excel аркуш `User Stories`, **ряд. 4**)* — *User Story (DE):* «Timeline aller Termine/Befunde/Leistungen/Dokumenten sehen».
  - *Beschreibung (DE):* Filter nach Zeitraum, Ereignisart, Kategorie/Art, Ursprung/Arzt/Klinik
  - *Security/Compliance (DE):* Nur sichtbare Elemente pro Rolle

- **[P2] Пацієнт-менеджер** *(Excel аркуш `User Stories`, **ряд. 5**)* — *User Story (DE):* «Textbausteine für Anamnesedokumentation».
  - *Beschreibung (DE):* Möglichkeit Textbausteine zu erstellen und hinzufügen, um strukturierte Dokumentation der Anamnese durchzuführen. Textbausteine mit Ausfüllfunktion für peronalisierte Informationen.

- **[P1] CEO** *(Excel аркуш `User Stories`, **ряд. 6**)* — *User Story (DE):* «Alle Patientenakten einsehen/bearbeiten».
  - *Beschreibung (DE):* Vollzugriff, Änderungen im Audit-Log
  - *Security/Compliance (DE):* Audit-Log Pflicht

- **[P4] Пацієнт** *(Excel аркуш `User Stories`, **ряд. 7**)* — *User Story (DE):* «Nur freigegebene Daten/Dokumente sehen».
  - *Beschreibung (DE):* Standard = unsichtbar, nur explizite Freigabe sichtbar
  - *Security/Compliance (DE):* Freigabestatus + Audit-Log

## EPIC 2: Партнерські клініки/провайдери

- **[P1] Пацієнт-менеджер** *(Excel аркуш `User Stories`, **ряд. 8**)* — *User Story (DE):* «Übersicht aller Partnerkliniken/-ärzte sehen».
  - *Beschreibung (DE):* Filter nach Fachbereich, Standort, Kooperationsbedinungen, Bewertungen

- **[P1] Пацієнт-менеджер** *(Excel аркуш `User Stories`, **ряд. 9**)* — *User Story (DE):* «Partnerkliniken-Akte anlegen».
  - *Beschreibung (DE):* Name, Adresse, Beteiligte Ärzte, Telefonnummer(n), Email(s), ID, zugehörige Dokumente und Patienten-Dokumente (und Dateien), zugehörige Patienten,  Leistungskatalog mit Preisen, Zusatzinformationen

- **[P1] Пацієнт-менеджер** *(Excel аркуш `User Stories`, **ряд. 10**)* — *User Story (DE):* «Medical Service Provider Datenbank nach undterschiedlichen Kriterien suchen».

- **[P3] Пацієнт-менеджер** *(Excel аркуш `User Stories`, **ряд. 11**)* — *User Story (DE):* «Not Medical Service Provider Datenbank nach undterschiedlichen Kriterien suchen».

- **[P3] Фінанси (Abrechnung)** *(Excel аркуш `User Stories`, **ряд. 12**)* — *User Story (DE):* «Preis- und Kostenentwicklungen für die Leistungen sehen».
  - *Beschreibung (DE):* Möglichkeit alle vom bestimmten Service Provider vorhandene Rechnungen (für Behandlungen und Untersuchungen) auszuwerten, um eigene Planungs-  Beratungsleistungen besser zu machen, genauere Kostenschätzungen und Kostenvoranschläge zu machen. Es soll möglich sein die daten immerwieder upzudaten (z.B. vor 3 Jahren hat die Gastroskopie und gastroenterologische Untersuchung 1000 € gekosten, zur Zeit 2000€. Die Daten sollen für die Marktanalyse verwendbar sein.

- **[P3] Продажі** *(Excel аркуш `User Stories`, **ряд. 13**)* — *User Story (DE):* «Leistungsdaten von Service Providers sollen nachu unterschiedlichen Kategorien auswertbar sein».

- **[P1] Фінанси (Abrechnung)** *(Excel аркуш `User Stories`, **ряд. 14**)* — *User Story (DE):* «Schlusseldaten und Kooperationsvertragsbedienungen zu sehen».
  - *Beschreibung (DE):* Um eine richtige Abrechnung mit den Kooperationspartnern und Rechnungsausstellung zu gewehrleisten.

- **[P2] Пацієнт-менеджер** *(Excel аркуш `User Stories`, **ряд. 15**)* — *User Story (DE):* «Unterschiedliche Vorlagen von Kooperationspartnern speichern, updaten und benutzen.».
  - *Beschreibung (DE):* z.B. Vorlage zur Vorbereitung zur Kolonoskopie. Wenn ein bestimmter Termin (z.B. Kolonoskopie) geplannt und ausgemacht wurde, wird eine bestimmte (übersetzte Vorlage-in diesem Fall-Kolonoskopie-Vorbereitung- an den Patient weitergeleitet. Z.B. per Email: "Am 01.01.2026 ist bei Ihnen eine Kolonoskopie-Untersuchung geplannt. Anbei finden Sie Verhaltensregeln und Vorbereitungsmaßnahmen zur Untersuchung:.....

- **[P1] CEO / Пацієнт-менеджер / Фінанси** *(Excel аркуш `User Stories`, **ряд. 16**)* — *User Story (DE):* «Alle Daten und Dokumente im bezug auf bestimte Service Provider-Patient beziehung zu sehen.».
  - *Beschreibung (DE):* Beim Einsicht in die Service Provider Akte sollen alle beziehungen zu unterschiedlichen Patienten zu sehen sein. Service Provider X: Alle seine Patienten, alle auf ihn bezogene Termine, Patientendaten, Patienten- Dokumente uns. Es soll auch moglich sein die ganze Service Provider X-Patient Y Information/Interaktionsverlauf darzustellen.

- **[P3] Concierge** *(Excel аркуш `User Stories`, **ряд. 17**)* — *User Story (DE):* «Not Medical Service Provider Datenbank nach undterschiedlichen Kriterien suchen».

- **[P1] Пацієнт-менеджер** *(Excel аркуш `User Stories`, **ряд. 18**)* — *User Story (DE):* «Patienten nach Klinik/Arzt filtern».

- **[P2] CEO** *(Excel аркуш `User Stories`, **ряд. 19**)* — *User Story (DE):* «Auswertungen zu Klinik/Arzt-Behandlungen sehen».
  - *Beschreibung (DE):* Darstellung als Reports (Leistungsdaten)

## EPIC 3: Призначення відповідальних

- **[P1] CEO** *(Excel аркуш `User Stories`, **ряд. 20**)* — *User Story (DE):* «Patienten gezielt Patientenmanagern zuordnen».
  - *Beschreibung (DE):* Auswahl aus Liste, Zuordnung, Benachrichtigung
  - *Security/Compliance (DE):* Nur CEO darf zuweisen

- **[P1] Пацієнт-менеджер** *(Excel аркуш `User Stories`, **ряд. 21**)* — *User Story (DE):* «Nur eigene Patienten sehen».
  - *Beschreibung (DE):* Zugriff nur auf zugewiesene Ids, Zugewiesen durch CEO

- **[P4] Dolmetscher Teamlead** *(Excel аркуш `User Stories`, **ряд. 22**)* — *User Story (DE):* «Nur eigene Patienten sehen».
  - *Beschreibung (DE):* Zugriff nur auf zugewiesene Ids, Zugewiesen durch  CEO oder Patientenmanager

- **[P3] Перекладач** *(Excel аркуш `User Stories`, **ряд. 23**)* — *User Story (DE):* «Nur eigene Patienten sehen».
  - *Beschreibung (DE):* Zugriff nur auf zugewiesene Ids, Zugewiesen durch CEO, Patientenmanager oder Teamlead

- **[P3] Concierge** *(Excel аркуш `User Stories`, **ряд. 24**)* — *User Story (DE):* «Nur eigene Patienten sehen».
  - *Beschreibung (DE):* Zugriff nur auf zugewiesene Ids, Zugewiesen durch  CEO oder Patientenmanager
  - *Security/Compliance (DE):* Nur Service- und nicht-medizinsche Daten

## EPIC 4: Терміни (Appointments)

- **[P1] Пацієнт-менеджер** *(Excel аркуш `User Stories`, **ряд. 25**)* — *User Story (DE):* «Medizinische Termine planen».

- **[P1] Пацієнт-менеджер** *(Excel аркуш `User Stories`, **ряд. 26**)* — *User Story (DE):* «Medizinische Termine Dolmetscher zuordnen».

- **[P3] Пацієнт-менеджер** *(Excel аркуш `User Stories`, **ряд. 27**)* — *User Story (DE):* «nicht-Medizinische/Service Termine Dolmetscher zuordnen».

- **[P1] Пацієнт-менеджер** *(Excel аркуш `User Stories`, **ряд. 28**)* — *User Story (DE):* «medizinische Patiententermine sollen zu bestimmten Service Provider, Ort/Klinik, Katigorie, Art, Dolmetscher, Datum, Uhrzeit verknüpft werden.».

- **[P1] Пацієнт-менеджер** *(Excel аркуш `User Stories`, **ряд. 29**)* — *User Story (DE):* «Nach dem der Behandlungsplan (Behandlungstermine) feststeht, soll es möglich sein ein PDF Dokument zu erzeugen, um es an den Patienten weiterzuleiten. In unterschiedlichen Sprachen verfügbar (je nach Patientensprache)».
  - *Beschreibung (DE):* Draft: 
Untersuchungs-/Behandlungsplan für [Patientenname ]
Datum (Erstellungsdatum)
Montag, den TT.MM.JJJJ:
08:30-Kardiologische Untersuchung und Beratung; Blutlabor;
11:00-MRT-Abdomen;
ab 15:00-Vorbereitung zur Kolonoskopie;
Dienstag, den TT.MM.JJJJ:
>Hinweis: Bitte nüchtern bleiben/Bitte frühstücken Sie nicht<
10:00- Gastroenterologische untersuchung und Beratung. Gastro- und Kolonoskopie;
13:00- Nachbesprechung-Kardiologie;

- **[P2] Пацієнт-менеджер** *(Excel аркуш `User Stories`, **ряд. 30**)* — *User Story (DE):* «Bei bestimmten Terminen soll es möglich sein Erinnerungen zur Vorbereitung o.A unserseits, zu erstellen.».
  - *Beschreibung (DE):* z.B. Der Patient hat einen Kolonoskopie-Termin. Dafür braucht er spätestens um 15 Uhr am Vortag die Medikation zu Vorbereitung. Daran soll der Patientenmanager erinnert werden. Und wenn die Aufgabe erledigt ist (die Vorbereitungsmedikation besorgt), soll er das als erledigt markieren.

- **[P3] Перекладач** *(Excel аркуш `User Stories`, **ряд. 31**)* — *User Story (DE):* «Geleistete Arbeitsstunden termingebunden angeben».

- **[P1] Фінанси (Abrechnung)** *(Excel аркуш `User Stories`, **ряд. 32**)* — *User Story (DE):* «Leistungserfassung automatisch termingebunden übertragen».
  - *Beschreibung (DE):* Manche Leistungen werden pauschal abgerechnet und manche-termingebunden. Beispiel der Termingebundenen Leistung: "Organisation der Behandlung (je 1 Arzt)". Im Fall "Draft: Untersuchungs- und Behandlungsplan für xxx": 3x"Organisation der Behandlung (je 1 Arzt)"+Dolmetscher-Arbeitsstunden.

- **[P2] Пацієнт-менеджер** *(Excel аркуш `User Stories`, **ряд. 33**)* — *User Story (DE):* «Zeitkonflikte - Hinweise sehen.».
  - *Beschreibung (DE):* Zeitkonflikte mit anderen Terminen des Patienten werden deutlich markiert (nur Hinweis, keine Vorschläge). Zeitkonflikte mit anderen Terminen des Dolmetschers werden deutlich markiert (nur Hinweis, keine Vorschläge)

- **[P3] Concierge** *(Excel аркуш `User Stories`, **ряд. 34**)* — *User Story (DE):* «Reisen/Unterkünfte/Service buchen/organisieren».

- **[P4] Перекладач** *(Excel аркуш `User Stories`, **ряд. 35**)* — *User Story (DE):* «Zugewiesene Termine mobil einsehen».

- **[P4] Пацієнт** *(Excel аркуш `User Stories`, **ряд. 36**)* — *User Story (DE):* «Nur freigegebene Termine sehen».

## EPIC 5: Документи

- **[P1] Пацієнт-менеджер** *(Excel аркуш `User Stories`, **ряд. 37**)* — *User Story (DE):* «Papierdokumente einscannen und und direkt ins System importieren».

- **[P1] Пацієнт-менеджер** *(Excel аркуш `User Stories`, **ряд. 38**)* — *User Story (DE):* «Dokumente kategorisieren».
  - *Beschreibung (DE):* Kriterien: Art, Status, Patient, Datum, Klinik, Ursprung

- **[P1] Пацієнт-менеджер** *(Excel аркуш `User Stories`, **ряд. 39**)* — *User Story (DE):* «Dokumente einsehen».
  - *Beschreibung (DE):* User-Friendly Multifunktionsansicht bei dem sowohl das Dokument lesbar ist, als auch andere Dokumente zum umschalten verfügbar sind.

- **[P1] Пацієнт-менеджер** *(Excel аркуш `User Stories`, **ряд. 40**)* — *User Story (DE):* «Dokumente erstellen».
  - *Beschreibung (DE):* Vorlagen, Dokumentenerstellung und kastomisierung aus den Textbausteinen, Auswahl von Textbausteinen, die für den Dokument/Dokumentenart "auswahlbar" sind.

- **[P1] Пацієнт-менеджер** *(Excel аркуш `User Stories`, **ряд. 41**)* — *User Story (DE):* «Dokumente/Aktivitäten».
  - *Beschreibung (DE):* Funktionen: weiterleiten, drücken, freischalten, markieren, Status festlegen, übersetzung anfordern usw.

- **[P2] Пацієнт-менеджер** *(Excel аркуш `User Stories`, **ряд. 42**)* — *User Story (DE):* «Dokumente teilen».
  - *Beschreibung (DE):* Dokumente die der Patient oder Service Provider braucht schnell finden und teilen können. Auch mehrere Dokumente zusammen auswählen und teilen.

- **[P1] Пацієнт-менеджер** *(Excel аркуш `User Stories`, **ряд. 43**)* — *User Story (DE):* «Nur die Dokumente mit Extern  teilen können, die freigegenen wurden,».

- **[P1] Пацієнт-менеджер** *(Excel аркуш `User Stories`, **ряд. 44**)* — *User Story (DE):* «Dokumente mit Extern nicht teilen können, wenn diese als "For internal Use" markiert wurden.».

- **[P1] Пацієнт-менеджер / Система** *(Excel аркуш `User Stories`, **ряд. 45**)* — *User Story (DE):* «Dokumente mit Extern nur über die verträglich festgestellte (im Fall: Patient) oder offizielle (im System erfasste) (im Fall: Service Provider) Kommunikationswege teilen können.».
  - *Beschreibung (DE):* Note: nur mit den Service Providers teilen können, die in der Auftragserfüllung beteiligt sind.

- **[P1] Пацієнт-менеджер / Система** *(Excel аркуш `User Stories`, **ряд. 46**)* — *User Story (DE):* «Dokumente die medizinische Informationen beinhalten nur mit den medizinischen Service Providern teilen können. Gesonderte Meldung/Teilungsfreigabe bestätigen vor dem Teilen.».

- **[P1] Пацієнт-менеджер** *(Excel аркуш `User Stories`, **ряд. 47**)* — *User Story (DE):* «Informationen ins PDF umwandeln und  teilen».
  - *Beschreibung (DE):* Von uns zusammengefasste Informationen ins PDF Dokument umwandeln und teilen. Z.B. unterschiedliche Ärzte haben unterschiedliche Medikamente angeordnet. Wir haben alle Anordnungen zusammengefasst. -> Unser Medikamentenplan mit dem Patienten teilen.

- **[P1] Система** *(Excel аркуш `User Stories`, **ряд. 48**)* — *User Story (DE):* «Automatisches Umbenennen + Zuordnen».
  - *Beschreibung (DE):* Eine Maske zu dazugehörigem Dokument/File ausfüllen und daraus die Name generieren
  - *Security/Compliance (DE):* Einheitliche Benennungs und Kategorisierungsregeln

- **[P1] Пацієнт-менеджер** *(Excel аркуш `User Stories`, **ряд. 49**)* — *User Story (DE):* «Dokumente weiterleiten bzw. für untergesetzte MA freischalten».

- **[P1] Пацієнт-менеджер** *(Excel аркуш `User Stories`, **ряд. 50**)* — *User Story (DE):* «Fehlende Dokumente->Meldung».
  - *Beschreibung (DE):* Voreingestellte Mindestanforderung an Unterlagen, die wir vom Patient brauchen. (z.B. Reisepass, Einverständniserklärung usw.) Meldung, wenn irgendwelche Dokumente fehlen oder nicht im System sind.

- **[P4] Пацієнт** *(Excel аркуш `User Stories`, **ряд. 51**)* — *User Story (DE):* «Dokumente sicher ins Portal hochladen».

- **[P4] Пацієнт** *(Excel аркуш `User Stories`, **ряд. 52**)* — *User Story (DE):* «Nur freigegebene Dokumente sehen».

## EPIC 6: Е-підпис

- **[P4] Пацієнт** *(Excel аркуш `User Stories`, **ряд. 53**)* — *User Story (DE):* «Verträge/Aufträge elektronisch signieren».
  - *Security/Compliance (DE):* QES, eIDAS-konform

- **[P4] Пацієнт-менеджер** *(Excel аркуш `User Stories`, **ряд. 54**)* — *User Story (DE):* «Dokumente zur Signatur freigeben».

- **[P4] Система** *(Excel аркуш `User Stories`, **ряд. 55**)* — *User Story (DE):* «Signaturen archivieren mit Zeitstempel».
  - *Security/Compliance (DE):* Revisionssicher

## EPIC 7: Оновлення медичних даних

- **[P1] Пацієнт-менеджер** *(Excel аркуш `User Stories`, **ряд. 56**)* — *User Story (DE):* «Neue Diagnosen/Medikamente/Anordnungen usw. eintragen».
  - *Beschreibung (DE):* Medikationliste, Diagnosen, Anamnese, Risikofaktoren, Risikoscores), Allergien, Cave-Notizen, Gesundheitsdaten mit Erfassungsdatum (Blutdruck, Gewicht, BMI, Herzfrequenz und andere), Karteikartenzeilen mit Datum und Kategorie, ärztliche/therapeutische Anordnungen, ankommende Vorsorge-/Kontroluntersuchungen, beteiligte behandelnde Ärzte

- **[P1] Пацієнт-менеджер** *(Excel аркуш `User Stories`, **ряд. 57**)* — *User Story (DE):* «Erinnerungen erstellen».
  - *Beschreibung (DE):* Interne Erinnerungen (auch Terminbezogen: z.B. Bei einem Termin für die Computertomographie mit Kontrastmittel: aktuelle Blutwerte erforderlich) oder Erinnerung, dass der Patient in 4 Wochen zuhause Blutlabor mit bestimmten Werten machen soll (meistens im Herkunftsland)

- **[P2] Пацієнт-менеджер** *(Excel аркуш `User Stories`, **ряд. 58**)* — *User Story (DE):* «Leistungsreports für CEO erstellen und teilen».

- **[P1] Пацієнт-менеджер** *(Excel аркуш `User Stories`, **ряд. 59**)* — *User Story (DE):* «Mediizinische Patienteninformationen updaten und vervollständigen».
  - *Beschreibung (DE):* Beispiel 1:  Medikamentenanordnungen: unterschiedliche Ärzte zu den unterschiedlichen Zeitpunkten haben unterschiedliche Medikamente für unterschiedliche Zeiträume angeordnet. Dauermedikationen bleiben bis zur Absetzung vom behandelnden Arzt in der Liste. Neue Dauermedikationen werden hinzugefügt. Zeitlich beschränkte Medikamenteneinnahmen werden mit dem Ablauf vom Zeitraum aus der Liste entfernt (vorher Meldung und Freigabe). Beispiel 2: Karteikarteneinträge: neue medizinische Informationen werden hinzugefügt und katigorisiert. Diese informationen können sowohl vom Arzt (Untersuchungen, Anamnese, Anordnungen, Empfehlungen), als auch vom Patienten (neue Symptome, Beschwerden,  Zustandveränderungen, Krankheiten usw) kommen.

- **[P1] Пацієнт-менеджер** *(Excel аркуш `User Stories`, **ряд. 60**)* — *User Story (DE):* «Info/Meldungen erhalten, wen neue Termine oder Daten noch nicht bearbeitet sind».
  - *Beschreibung (DE):* eingegangene Dokumente und Daten, die noch nich bearbeitet und kategorisiert sind. Abgelaufene Termine, die noch nicht bearbeitet sind (Dolmetscher-Infos zum Termin, Anamnese und med. Infos updates)

- **[P1] Пацієнт-менеджер** *(Excel аркуш `User Stories`, **ряд. 61**)* — *User Story (DE):* «Terminupdates, Termin-Follow-ups, Termin-Check-Listen haben».
  - *Beschreibung (DE):* Jeder Arzttermin soll strukturiert bearbeitet werden: Terminvorbereitung, Termindurchführung, Termin-Follow-ups. Vorbereitung: Check-Liste (benötigte Dokumente und Dateien, bei Bedarf: notwendigkeit der schriftlichen Übersetzung von Vorbefunden, notwendigkeit der Vorauszahlung (dann auch Status der Vorauszahlung), Notwendigkeit der Kostenübernahme unsererseits, zuweisung von Dolmetschern, abklärungsbefürftige Fragen-Vorstellungsgrund, Weiterleitung von benötigten medizinischen Informationen inkl. Anamnese an den Service Provider und Dolmetscher), Meldung über die Notwendigkeit von Checklistenbearbeitung und über noch nicht durchgeführte Vorbereitungsmaßnahmen; Termindurchführung: Dolmetscherberichte, Zahlungsstatus; Follow-up: benötigte Folgetermine, Kontrolluntersuchungen und Arztempfehlungen, fehlender/erhaltener Arztbrief/schriftliche Befundberichte, Rechnungen/Zahlungsnachweise, notwendigkeit der schriftllichen Übersetzung von Arztbriefen und Befunden, weiterleitung an den Patienten.

- **[P3] Перекладач** *(Excel аркуш `User Stories`, **ряд. 62**)* — *User Story (DE):* «Nur für den Fall/Auftrag benötigte Dokumente/Infos sehen».
  - *Beschreibung (DE):* Patientenstammdaten, Infos zum Termin (wo, wann, Art, med. Infos, Dokumente, Notizen)

## EPIC 8: Комунікація

- **[P4] Пацієнт** *(Excel аркуш `User Stories`, **ряд. 63**)* — *User Story (DE):* «Sichere Nachrichten- und Dokumentenaustausch mit der Agentur».
  - *Security/Compliance (DE):* End-to-End verschlüsselt

- **[P3] Перекладач** *(Excel аркуш `User Stories`, **ряд. 64**)* — *User Story (DE):* «Nachrichten und Infos zu Einsätzen erhalten».

- **[P2] Пацієнт-менеджер** *(Excel аркуш `User Stories`, **ряд. 65**)* — *User Story (DE):* «Aufgaben für Teamleads, Dolmetscher und Concierge  zu erstellen und verteilen, Aufgabenstaus verfolgen, Deadlines setzen».

- **[P1] Пацієнт-менеджер** *(Excel аркуш `User Stories`, **ряд. 66**)* — *User Story (DE):* «Mit den Kliniken, Ärzten und anderen Service Provider zu kommunizieren».

- **[P1] Пацієнт-менеджер** *(Excel аркуш `User Stories`, **ряд. 67**)* — *User Story (DE):* «Intern fallbezogen kommunizieren mit Fall-/Auftragsbereiligten».

## EPIC 9: Білінг/фінанси

- **[P1] Фінанси (Abrechnung)** *(Excel аркуш `User Stories`, **ряд. 68**)* — *User Story (DE):* «Vom Patientenmanager erfasste und freigeschaltete Leistungen automatisch bei der Abrechnung erfasst».

- **[P1] Фінанси (Abrechnung)** *(Excel аркуш `User Stories`, **ряд. 69**)* — *User Story (DE):* «Leistungen erfassen und Rechnungen erstellen».
  - *Beschreibung (DE):* Unsere Leistungen, die der Patientenmanager "angesammelt" hat. Inkl. Dolmetscherstunden, Beratungs-/Behandlungsorganisationleistungen, Concierge-Leistungen, Kostenübernahmen

- **[P1] Фінанси (Abrechnung)** *(Excel аркуш `User Stories`, **ряд. 70**)* — *User Story (DE):* «Buchhaltung Finanzamt-Konform führen».
  - *Beschreibung (DE):* Rechnungsausstellung und Abrechnungsablauf nech bestehenden gesetzlichen Forschriften durchführen

- **[P1] Фінанси (Abrechnung)** *(Excel аркуш `User Stories`, **ряд. 71**)* — *User Story (DE):* «Kostenvoranschläge generieren».

- **[P1] Фінанси (Abrechnung)** *(Excel аркуш `User Stories`, **ряд. 72**)* — *User Story (DE):* «Vorkassenrechnungen erstellen».

- **[P1] Фінанси (Abrechnung)** *(Excel аркуш `User Stories`, **ряд. 73**)* — *User Story (DE):* «freigegebene Dolmetscherstunden und Concierge-Services automatisch in die Abrechnung übernehmen».

- **[P1] Фінанси (Abrechnung)** *(Excel аркуш `User Stories`, **ряд. 74**)* — *User Story (DE):* «Bei langen, dauerhaften oder kostenintensiven Aufträgen-Zwischenrechnungen».

- **[P1] Фінанси (Abrechnung)** *(Excel аркуш `User Stories`, **ряд. 75**)* — *User Story (DE):* «Rechnungsstatus verfolgen und Infos/Meldungen bei offenen Forderungen bekommen».

- **[P2] Фінанси (Abrechnung)** *(Excel аркуш `User Stories`, **ряд. 76**)* — *User Story (DE):* «automatisiertes Mahnwesen (1. Mahnung, 2. Mahnung, Inkasso)».
  - *Beschreibung (DE):* Bei Inkasso explizite Freigabe durch Abrechnung

- **[P1] Фінанси (Abrechnung)** *(Excel аркуш `User Stories`, **ряд. 77**)* — *User Story (DE):* «Datenexport für Steuerberater/DATEV».

- **[P2] Фінанси (Abrechnung)** *(Excel аркуш `User Stories`, **ряд. 78**)* — *User Story (DE):* «Bei Kostenübernahmen dazugehörige Belege automatisch anheften/verknüpfen».

- **[P3] Фінанси (Abrechnung)** *(Excel аркуш `User Stories`, **ряд. 79**)* — *User Story (DE):* «Möglichkeit der Kategorisierung von abgerechneten Leistungen nach unterschiedlichen Kriterien».
  - *Beschreibung (DE):* Für die Finanzanalyse. Welche umsätze für welche Leistungen in welcher Zeitraum, von welchem Patient, von welcher Klinik/für welcher Klinik usw.

- **[P1] Фінанси (Abrechnung)** *(Excel аркуш `User Stories`, **ряд. 80**)* — *User Story (DE):* «Möglichkeit alle Finanzunterlagen des Patientes zu sehen».
  - *Beschreibung (DE):* Für Abrechnung: Unsere Leistungen, Kostenübernahmen (mit den Rechnungen, die wir übernehmen); Für Kontrolle und Nachweis: Auch andere Patientenrechnungen, die er selber bezahlt hat. Wichtig sowohl für die Analyse, als auch für Zahlungsnachweis, wenn eine Zahlungsaufforderung aus der Klinik kommt, obwohl die Rechnung schin bezahlt ist.

- **[P1] Фінанси (Abrechnung)** *(Excel аркуш `User Stories`, **ряд. 81**)* — *User Story (DE):* «Bei der Rechnungsausstellung: Eigene Leistungen immer mit dem DE Umsatzsteuer 19%. Unabhängig vom Wohnsitz des Kundes. Kostenübernahmen-ohne Umsatzsteuer, da 1 zu 1 mit der Summe der Fremdrechnung übereinstimmt.».

- **[P1] Фінанси (Abrechnung)** *(Excel аркуш `User Stories`, **ряд. 82**)* — *User Story (DE):* «Laut Kostenvoranschlag/Vorkasse bezahlte Leistungen/Summen in der Rechnung berücksichtigt».

- **[P1] Фінанси (Abrechnung)** *(Excel аркуш `User Stories`, **ряд. 83**)* — *User Story (DE):* «Erstellung von Zwischenrechnungen im Rahmen von einem Auftrag».

- **[P1] Фінанси (Abrechnung)** *(Excel аркуш `User Stories`, **ряд. 84**)* — *User Story (DE):* «Neue Produkte-/Leistungspositionen erstellen können und unterschiedliche Preise für den gleichen Produkt/gleiche Leistung festlegen können».

- **[P2] Фінанси (Abrechnung)** *(Excel аркуш `User Stories`, **ряд. 85**)* — *User Story (DE):* «E-Rechnungen rechtskonform ausstellen».

- **[P1] Фінанси (Abrechnung)** *(Excel аркуш `User Stories`, **ряд. 86**)* — *User Story (DE):* «Rechnungen die aus mehreren Seiten bestehen: Seiten sollen durchnummeriert und so beschriftet werden, damit man die Zugehörigkeit von alen Seiten zu einer Rechnung sieht.».

- **[P1] Пацієнт-менеджер / Фінанси** *(Excel аркуш `User Stories`, **ряд. 87**)* — *User Story (DE):* «Erfassung von auftragsgebundenen Arbeitsstunden und automatische Erstellung des Leistungsberichtes, der im Anhang zur Rechnung an den Patienten geschickt wird.».

- **[P2] Фінанси (Abrechnung)** *(Excel аркуш `User Stories`, **ряд. 88**)* — *User Story (DE):* «vollständige Buchhaltungsfunktionen haben».
  - *Beschreibung (DE):* Mit einnahme-Überschussrechnung-Funktion. Zukunftig mit Bilanzierungsfunktion, GoBD-Konform

- **[P1] Пацієнт-менеджер / Фінанси** *(Excel аркуш `User Stories`, **ряд. 89**)* — *User Story (DE):* «Merkmall/Differenzierung bei den Externen rechnungen zwischen den Rechnungen mit unserer Kostenübernahme und den Rechnungen die vom Patient selbst bezahlt werden/wurden».
  - *Beschreibung (DE):* Rechnungen (Rechnungssummen) mit unserer Kostenübernahme werden automatisch 1 zu 1 in unseren Leistungen miterfasst. Alle externe Rechnungen mit dem Status "offen", "Prüfung",  "bezahlt", "Mahnung", "Abgelehnt", "Veraltet". Eintrag des Zahlungsfristes. Bei Zahlungsfristversäumung->Meldung an die Abrechnung/Patientenmanager

- **[P2] Фінанси (Abrechnung)** *(Excel аркуш `User Stories`, **ряд. 90**)* — *User Story (DE):* «Sowohl eigene (Gewinn-)Rechnungen, asl auch fremde (Verlust)Rechnungen berücksichtigen».
  - *Beschreibung (DE):* z.B. Kostenübernahmen, die in unserer Rechnung abgerechnet werden, sollen auch als Ausgaben berücksichtigt werden (Kostenübernahmen-Positionen stimmen bei uns immer 1 zu 1 mit der Fremdrechnungssumme überein)

- **[P1] Пацієнт-менеджер** *(Excel аркуш `User Stories`, **ряд. 91**)* — *User Story (DE):* «Alle erfasste Leistungen und Ausgaben an die Abrechnung automatisch übermittelt».

- **[P1] Пацієнт-менеджер** *(Excel аркуш `User Stories`, **ряд. 92**)* — *User Story (DE):* «Freigegebene Dolmetscherstunden an die Abrechnung automatisch übermittelt».

- **[P3] Concierge** *(Excel аркуш `User Stories`, **ряд. 93**)* — *User Story (DE):* «Alle erfasste Leistungen und Ausgaben an die Abrechnung automatisch übermittelt».

- **[P1] CEO** *(Excel аркуш `User Stories`, **ряд. 94**)* — *User Story (DE):* «jede Änderung an Rechnungen oder Leistungen im Audit-Log dokumentieren».

- **[P1] CEO** *(Excel аркуш `User Stories`, **ряд. 95**)* — *User Story (DE):* «Umsatzberichte sehen».
  - *Beschreibung (DE):* Umsatzberichte nach Klinik, Patientengruppe, Land, Serviceart und anderen relevanten katigorien

- **[P4] Пацієнт** *(Excel аркуш `User Stories`, **ряд. 96**)* — *User Story (DE):* «Rechnungen im Portal sehen und bezahlen».

## EPIC 10: Перекладачі

- **[P3] Перекладач** *(Excel аркуш `User Stories`, **ряд. 97**)* — *User Story (DE):* «Eigene Stunden eintragen + Bericht schreiben+Dateien uploaden».

- **[P3] Перекладач** *(Excel аркуш `User Stories`, **ряд. 98**)* — *User Story (DE):* «Informationen über den Arbeitsauftrag/Termin und Patient sehen».

- **[P3] Teamlead Dolmetscher** *(Excel аркуш `User Stories`, **ряд. 99**)* — *User Story (DE):* «Stunden prüfen und freigeben».

- **[P3] Teamlead Dolmetscher** *(Excel аркуш `User Stories`, **ряд. 100**)* — *User Story (DE):* «Berichte prüfen und freigeben».

- **[P3] Teamlead Dolmetscher** *(Excel аркуш `User Stories`, **ряд. 101**)* — *User Story (DE):* «Vom Dolmetscher eingegangene Dateien/Dokumente prüfen, dazugehörige Maske ausfüllen, katigorisieren und freigenen».

- **[P3] Пацієнт-менеджер** *(Excel аркуш `User Stories`, **ряд. 102**)* — *User Story (DE):* «Dolmetscherberichte/Einsatzstunden/Dokumente und Dateien sehen».

- **[P1] Фінанси (Abrechnung)** *(Excel аркуш `User Stories`, **ряд. 103**)* — *User Story (DE):* «Freigegebene Stunden in Rechnungen übernehmen».

## EPIC 11: Продажі

- **[P2] Продажі** *(Excel аркуш `User Stories`, **ряд. 104**)* — *User Story (DE):* «Leistungs und Umsatzdaten von Med. Service Providers sehen».
  - *Beschreibung (DE):* Welche Termine bei welchen Service Proveidern mit welchen Umsätzen vom Patienten wahrgenomen wurden

- **[P2] Продажі** *(Excel аркуш `User Stories`, **ряд. 105**)* — *User Story (DE):* «Leads erfassen und Partner pflegen».

## EPIC 12: Шаблони

- **[P1] Пацієнт-менеджер** *(Excel аркуш `User Stories`, **ряд. 106**)* — *User Story (DE):* «Verträge automatisch generieren».
  - *Beschreibung (DE):* Vorlagen, Dokumentenerstellung und Kastomisierung aus den Textbausteinen, Auswahl von Textbausteinen, die für den Dokument/Dokumentenart "auswahlbar" sind.

- **[P1] Пацієнт-менеджер** *(Excel аркуш `User Stories`, **ряд. 107**)* — *User Story (DE):* «Patientenaufkleber generieren».
  - *Beschreibung (DE):* ID, Frau/Herr/Div, Name, Vorname, Geburtsdatum, Länderabkürzung (Staatsangehörigkeit und vlt. Residence), Kostenträger, c/o Agentur, Adresse (Agentur), Telefonnummer (Agentur), Email (Agentur). In unterschiedlichen Ausführungen

## EPIC 13: Політики доступу і публікації

- **[P4] Пацієнт-менеджер** *(Excel аркуш `User Stories`, **ряд. 108**)* — *User Story (DE):* «Dokumente und Informationen für Patienten im Portal freigeben».

- **[P3] Пацієнт-менеджер** *(Excel аркуш `User Stories`, **ряд. 109**)* — *User Story (DE):* «Nur die Inforationen mit Extern oder im Portal  teilen  können, die freigegenen wurden.».

- **[P3] Пацієнт-менеджер** *(Excel аркуш `User Stories`, **ряд. 110**)* — *User Story (DE):* «Informationen mit Extern oder im Patientenportal nicht teilen können, wenn diese als "For internal Use" markiert wurden.».

- **[P2] Пацієнт-менеджер** *(Excel аркуш `User Stories`, **ряд. 111**)* — *User Story (DE):* «Informationen mit Extern nur über die verträglich festgestellte (im Fall: Patient) oder offizielle (im System erfasste) (im Fall: Service Provider) Kommunikationswege teilen können.».

- **[P2] Пацієнт-менеджер** *(Excel аркуш `User Stories`, **ряд. 112**)* — *User Story (DE):* «Dokumente medizinische Informationen beinhalten nur mit den medizinischen Service Providern teilen können. Gesonderte Meldung/Teilungsfreigabe bestätigen vor dem Teilen.».

- **[P1] Пацієнт** *(Excel аркуш `User Stories`, **ряд. 113**)* — *User Story (DE):* «Datenfreigaben an Dritte erteilen/widerrufen».
  - *Beschreibung (DE):* Recht auf Vergessenwerden und andere DSGVO anforderungen. Die Freigabe und Wiederruff erfolgt im bezug auf die ganze Agentur und nicht auf einzelne mitarbeiter. Antrag auf wiederruff stellen->meldung bei Patientenmanager->Auftragbearbeitung. Erfüllung von ges. Vorgaben.

## EPIC 14: Безпека

- **[P1] IT/Admin** *(Excel аркуш `User Stories`, **ряд. 114**)* — *User Story (DE):* «Rollen & Rechte verwalten».

- **[P1] Система** *(Excel аркуш `User Stories`, **ряд. 115**)* — *User Story (DE):* «AES-256 Speicherung».

- **[P1] Система** *(Excel аркуш `User Stories`, **ряд. 116**)* — *User Story (DE):* «TLS 1.3 Transport».

- **[P1] Система** *(Excel аркуш `User Stories`, **ряд. 117**)* — *User Story (DE):* «MFA für alle Mitarbeiter».

- **[P1] Система** *(Excel аркуш `User Stories`, **ряд. 118**)* — *User Story (DE):* «RBAC (Need-to-know)».

- **[P1] Система** *(Excel аркуш `User Stories`, **ряд. 119**)* — *User Story (DE):* «Audit-Logs unveränderbar».

- **[P1] Система** *(Excel аркуш `User Stories`, **ряд. 120**)* — *User Story (DE):* «eIDAS-konforme Signatur».

- **[P1] Система** *(Excel аркуш `User Stories`, **ряд. 121**)* — *User Story (DE):* «DSGVO-konforme Einwilligung , Widerruf, Löschkonzept».

- **[P1] Система** *(Excel аркуш `User Stories`, **ряд. 122**)* — *User Story (DE):* «Backups & Recovery (3-2-1-Regel)».

- **[P1] Система** *(Excel аркуш `User Stories`, **ряд. 123**)* — *User Story (DE):* «End-to-End-Verschlüsselung Kommunikation».

- **[P1] Пацієнт** *(Excel аркуш `User Stories`, **ряд. 124**)* — *User Story (DE):* «Sieht nur explizit freigegebene Inhalte.».

- **[P3] Перекладач** *(Excel аркуш `User Stories`, **ряд. 125**)* — *User Story (DE):* «Kann Berichte schreiben und Stunden erfassen, PDFs uploaden, sieht aber keine volle Patientenakte.».

- **[P3] Concierge** *(Excel аркуш `User Stories`, **ряд. 126**)* — *User Story (DE):* «Sieht nur Reise- und Serviceinfos, niemals Diagnosen oder med. Daten».

- **[P1] Фінанси (Abrechnung)** *(Excel аркуш `User Stories`, **ряд. 127**)* — *User Story (DE):* «Hat nur Zugriff auf Finanzdaten, nicht auf medizinische Infos.».

- **[P1] Продажі** *(Excel аркуш `User Stories`, **ряд. 128**)* — *User Story (DE):* «Hat nur Zugriff auf Leads & Partnerinfos, nicht auf Patienten.».

- **[P1] CEO** *(Excel аркуш `User Stories`, **ряд. 129**)* — *User Story (DE):* «Einziger mit echtem Vollzugriff.».

- **[P1] Організаційно** *(Excel аркуш `User Stories`, **ряд. 130**)* — *User Story (DE):* «SOPs: Sichtbarkeit abhängig von Rolle – jeder sieht nur für ihn relevante Inhalte.».

- **[P1] CEO** *(Excel аркуш `User Stories`, **ряд. 131**)* — *User Story (DE):* «Audit-Logs auswerten».

## EPIC 15: Навчальний модуль

- **[P2] Співробітники** *(Excel аркуш `User Stories`, **ряд. 132**)* — *User Story (DE):* «SOPs & Schulungen abrufen».
  - *Beschreibung (DE):* Lernbereich mit SOPs, Handbüchern und Schuhlungen

- **[P2] CEO** *(Excel аркуш `User Stories`, **ряд. 133**)* — *User Story (DE):* «SOPs bestätigen lassen».

- **[P2] Пацієнт-менеджер** *(Excel аркуш `User Stories`, **ряд. 134**)* — *User Story (DE):* «Eigene SOPs für Team hinzufügen (nach CEO Freigabe)».

- **[P3] Teamlead Dolmetscher** *(Excel аркуш `User Stories`, **ряд. 135**)* — *User Story (DE):* «Eigene SOPs für Team hinzufügen (nach Patientenmanager-Freigabe)».

## EPIC 16: VIP-сервіси

- **[P3] Concierge** *(Excel аркуш `User Stories`, **ряд. 136**)* — *User Story (DE):* «VIP-Services dokumentieren».

- **[P3] Фінанси (Abrechnung)** *(Excel аркуш `User Stories`, **ряд. 137**)* — *User Story (DE):* «VIP-Services erfassen und Abrechnen».

- **[P4] Пацієнт** *(Excel аркуш `User Stories`, **ряд. 138**)* — *User Story (DE):* «Zusatzservices buchen».

## EPIC 17: Feedback

- **[P3] Пацієнт-менеджер** *(Excel аркуш `User Stories`, **ряд. 139**)* — *User Story (DE):* «Klinik-Feedback erfassen».

- **[P3] Пацієнт-менеджер** *(Excel аркуш `User Stories`, **ряд. 140**)* — *User Story (DE):* «Dolmetscher-Feedback einsehen».

## EPIC 18: Workflow/To-Do

- **[P1] Пацієнт-менеджер** *(Excel аркуш `User Stories`, **ряд. 141**)* — *User Story (DE):* «Automatische To-Do-Listen erhalten».

- **[P1] Пацієнт-менеджер** *(Excel аркуш `User Stories`, **ряд. 142**)* — *User Story (DE):* «Checklisten pro Patient nutzen».

- **[P1] Пацієнт-менеджер** *(Excel аркуш `User Stories`, **ряд. 143**)* — *User Story (DE):* «Checklisten pro Auftrag nutzen».

- **[P3] Concierge** *(Excel аркуш `User Stories`, **ряд. 144**)* — *User Story (DE):* «Automatische To-Do-Listen erhalten».

- **[P3] Concierge** *(Excel аркуш `User Stories`, **ряд. 145**)* — *User Story (DE):* «Checklisten pro Patient nutzen».

- **[P3] Concierge** *(Excel аркуш `User Stories`, **ряд. 146**)* — *User Story (DE):* «Checklisten pro Auftrag nutzen».

## EPIC 19: Self-Service портал

- **[P4] Пацієнт** *(Excel аркуш `User Stories`, **ряд. 147**)* — *User Story (DE):* «Termine anfragen, Dokumente hochladen, Rechnungen bezahlen».

## EPIC 20: Ризик-аналіз

- **[P2] Пацієнт-менеджер** *(Excel аркуш `User Stories`, **ряд. 148**)* — *User Story (DE):* «Automatische Risikoanalyse erhalten (komplexe Fälle, offene Termine)».

- **[P2] Фінанси (Abrechnung)** *(Excel аркуш `User Stories`, **ряд. 149**)* — *User Story (DE):* «Automatische Risikoanalyse erhalten (komplexe Fälle, Kostenrisiko)».

## EPIC 21: Календар і керування термінами

- **[P1] Пацієнт-менеджер** *(Excel аркуш `User Stories`, **ряд. 150**)* — *User Story (DE):* «Eigene interne  Termine, Dolmetscher-Teamlead-Concierge-Arzt/Service Provider-Fallbezogene Termine einsehen».

- **[P1] Пацієнт-менеджер** *(Excel аркуш `User Stories`, **ряд. 151**)* — *User Story (DE):* «Neue Termine für Patienten erstellen und verändern».
  - *Beschreibung (DE):* Patient-(Dolmetscher)-Teamlead-Klinik/Service Provider-bezogen

- **[P3] Teamlead** *(Excel аркуш `User Stories`, **ряд. 152**)* — *User Story (DE):* «Meine interne-, service provider-, patienten- und untergesetzte mitarbeiiterbezogene Termine sehen. Neue Termine für untergesetzte MA erstellen.  Meldungen über neue Termine oder Terminänderungen».
  - *Beschreibung (DE):* Wenn der Patientenmanager einen auf mich bezogenen Termin erstellt oder verändert, möchte ich eine Nachricht/Meldung erhalten und eine Rückmeldung geben ("Ablehnung", "Rücksprache erbeten", "Akzeptieren")

- **[P3] Перекладач** *(Excel аркуш `User Stories`, **ряд. 153**)* — *User Story (DE):* «Meine interne und patienten-service-provider-bezogene Termine mit allen für den Termin benötigten informationen sehen. Meldungen über neue Termine oder Terminänderungen».
  - *Beschreibung (DE):* Wenn der Patientenmanager oder Teamlead einen auf mich bezogenen Termin erstellt oder verändert, möchte ich eine Nachricht/Meldung erhalten und eine Rückmeldung geben ("Ablehnung", "Rücksprache erbeten", "Akzeptieren")

- **[P3] Concierge** *(Excel аркуш `User Stories`, **ряд. 154**)* — *User Story (DE):* «Meine interne Termine und patientenbezogene Termine (nicht medizinische)».
  - *Beschreibung (DE):* Medizinsche Patientermine dürfen auch gezeigt werden, aber nur als "geblockte Zeitfenster"

- **[P1] Система** *(Excel аркуш `User Stories`, **ряд. 155**)* — *User Story (DE):* «Termine  sollen mit dem Patient, Service Provider, MA,  Auftrag verknüpft werden».

- **[P1] CEO** *(Excel аркуш `User Stories`, **ряд. 156**)* — *User Story (DE):* «Alle Termine sehen. Neue Termine erstellen.  Möglichkeit Termine nach unterschiedlichen Kriterien darstellen oder ausblenden».

## EPIC 22: Модуль CEO

- **[P1] CEO** *(Excel аркуш `User Stories`, **ряд. 157**)* — *User Story (DE):* «Möglichkein zwischen den Unterschiedlichen "Masken/Modulen" zu wechseln».
  - *Beschreibung (DE):* Sowohl im SEO Modul die informationen einzusehen, als auch als Patientenbetreuuer (für von CEO betreuute Patienten), als auch als Abrechnung, als auch als Dolmetscher ((für von CEO betreuute Patienten)

- **[P1] CEO** *(Excel аркуш `User Stories`, **ряд. 158**)* — *User Story (DE):* «Kommunikation mit den MA».
  - *Beschreibung (DE):* Möglichkeit mit unterschiedlichen MA intern zu kommunizieren (sowohl einzehln, als auch in der Gruppe, als auch fallbezogen), Aufgaben zu erstellen und verteilen, Aufgabenstaus verfolgen, Deadlines setzen

- **[P2] CEO** *(Excel аркуш `User Stories`, **ряд. 159**)* — *User Story (DE):* «Reports und KPIs».
  - *Beschreibung (DE):* Nach unterschiedlichen Kriterien.

- **[P1] CEO** *(Excel аркуш `User Stories`, **ряд. 160**)* — *User Story (DE):* «Informationen und Leistungsdaten von jedem MA einseghen».

- **[P1] CEO** *(Excel аркуш `User Stories`, **ряд. 161**)* — *User Story (DE):* «Informationen und Leistungsdaten von Patienten einsehen».
  - *Beschreibung (DE):* Nach einzelnen Patienten, Nach Patientengruppen nach unterschiedlichen merkmalen

- **[P1] CEO** *(Excel аркуш `User Stories`, **ряд. 162**)* — *User Story (DE):* «Informationen und Leistungsdaten von Kliniken/Äzten einsehen».

- **[P1] CEO** *(Excel аркуш `User Stories`, **ряд. 163**)* — *User Story (DE):* «Statistiken und Reports nach unterschiedlichen Kriterien».

- **[P1] CEO** *(Excel аркуш `User Stories`, **ряд. 164**)* — *User Story (DE):* «Zugriffsrechte von MA erteilen und verändern».

## EPIC 23: Замовлення (Aufträge)

- **[P1] Пацієнт-менеджер** *(Excel аркуш `User Stories`, **ряд. 165**)* — *User Story (DE):* «Erstellung von neuen Aufträgen».
  - *Beschreibung (DE):* Zusamenarbeit mit dem Patient erfolgt im Form von Aufträgen. Wenn der Patient sich an uns wendet, gibt er einen neuen Auftrag. In Rahmen von diesem Auftrag werden die Leistungen erbracht. Bedarf wird ermittelt->Bedarfsorientierter Auftrag wird erstellt

- **[P1] Пацієнт-менеджер** *(Excel аркуш `User Stories`, **ряд. 166**)* — *User Story (DE):* «Schneller Patientenbedarfsdokumentation».
  - *Beschreibung (DE):* Bei dem Erstkontakt im Rahmen des Auftrages-schnelle Dokumentation von Patientenwünschen und Bedürfnissen

- **[P1] Пацієнт-менеджер** *(Excel аркуш `User Stories`, **ряд. 167**)* — *User Story (DE):* «Zusammensetzung von Aufträgen».
  - *Beschreibung (DE):* Alle Aufträge beziehen sich auf den Rahmendienstleistungsvertrag  (am beginn der Zusammenarbeit erstellt und unterschrieben). Auftragszusammensetzung: Personalisierter Auftrag inkl.  Auflistung von Leistungen und Bedinungen, die im Rahmen des Auftrages erbracht werden; Auflistung und Preise für die einzelnen Leistungen; Rechtliche Bedienungen und Belehrungen; Unterschrifte von beiden Parteien.

- **[P1] Фінанси (Abrechnung)** *(Excel аркуш `User Stories`, **ряд. 168**)* — *User Story (DE):* «Zusammensetzung von Kostenvoranschlägen».
  - *Beschreibung (DE):* Kostenvoranschlag: einzelne Leistungen aus der Leistungsliste werden mit mit dem abgeschätzten Aufwand multipliziert. (z.B. Dolmetscherstunden: Preis pro 1 Std.=X. Geschätzter Arbeitsaufwand= 10 Std.; Geschätzte Gesamtsumme: X*10 + 19% MWSt.)

- **[P1] Пацієнт-менеджер** *(Excel аркуш `User Stories`, **ряд. 169**)* — *User Story (DE):* «Unterschreibung von Aufträgen mit eSignatur».
  - *Beschreibung (DE):* > Auftrag wird vom Patient unterschrieben (eSignatur)->Auftrag wird von uns unterschrieben (eSignatur); Kostenvoranschlag wird vom Patient unterschrieben (eSignatur)->Kostenvoranschlag wird von uns unterschrieben (eSignatu)

- **[P1] Пацієнт-менеджер** *(Excel аркуш `User Stories`, **ряд. 170**)* — *User Story (DE):* «Ansammlung von erbrachten Leistungen im Laufe des Auftrages».
  - *Beschreibung (DE):* Erbrachte Leistungen werden im Laufe des Auftrages angesammelt. Am Ende des Auftrages werden die Leistungen vom Patientenmanager überprüft und für die Abrechnung freigegeben.

- **[P1] Пацієнт-менеджер** *(Excel аркуш `User Stories`, **ряд. 171**)* — *User Story (DE):* «Stukturierte Auftragsbearbeitung  (sinvolle Strukturierung erarbeiten)».
  - *Beschreibung (DE):* 1) Beim 1. Auftrag: Entdekung (Erstkontakt, Bedarfsanalyse), Erfassung von Stammdaten, Abklärung von  administrativen, rechtlichen und verträglichen Fragen, Anlage von der Kundenakte, 2) Auftragsentgegennahme, 3) Auftragsdurchführung, 4) Auftragsabschluss, 5)Follow-up.

- **[P1] Пацієнт-менеджер** *(Excel аркуш `User Stories`, **ряд. 172**)* — *User Story (DE):* «Stukturierte Auftragsbearbeitung: Entdekung (Beim 1. Auftrag)».
  - *Beschreibung (DE):* Erstkontakt: Anfragenbearbeitung -> Erstgespräch mit Bedarfserfassung ->Stammdatenerfassung -> Angebot->Vertragsabschluss

- **[P1] Пацієнт-менеджер** *(Excel аркуш `User Stories`, **ряд. 173**)* — *User Story (DE):* «Stukturierte Auftragsbearbeitung: Auftragserteilung/-entgegennahme».
  - *Beschreibung (DE):* Erstellung des Auftrages -> Erstellung vom Kostenvoranschlag auf Basis vom Auftrag (Abrechnung) ->Erstellung der Kostenschätzung für medizinische Leistungen -> Unterzeichnung (von beiden Vertrags-/Auftragsparteien) des Auftrages und des Kostenvoranschlages (Abrechnung) -> (Vorauszahlung laut KV) ->Auftragsfreigabe

- **[P1] Пацієнт-менеджер** *(Excel аркуш `User Stories`, **ряд. 174**)* — *User Story (DE):* «Stukturierte Auftragsbearbeitung: Auftragsdurchführung (1)».
  - *Beschreibung (DE):* Organisation (der Einreise), des Afuenthaltes, der Untersuchung und Behandlung

- **[P1] Пацієнт-менеджер** *(Excel аркуш `User Stories`, **ряд. 175**)* — *User Story (DE):* «Stukturierte Auftragsbearbeitung: Auftragsdurchführung (2)».
  - *Beschreibung (DE):* Organisation des Aufenthaltes: Anamneseerfassung, Datensammlung (Befunde, Arztbriefe, andere Medizinische Dateien), bei Bedarf: Übersetung,Terminvereinbarungen und Terminplanungen, Vorbereitung und Weiterleitung von medizinschen Daten an die med. Service Provider, Zuweisung zu den Terminen und Breafing von Dolmetschern, Organisation von nicht medizinischen Leistungen (Concierge) (z.B. Flügticket-Buchungen, VIP Terminal am Flughafen, Hotelbuchungen, Transfer- und Chauffeur-Service, andere Concierge-Leistungen). Erstellung des Untersuchungs und Behandlungsprogramms->Weiterleitung an den Kunde->Rücksprache und Korrektur bei Bedarf.

- **[P2] Пацієнт-менеджер** *(Excel аркуш `User Stories`, **ряд. 176**)* — *User Story (DE):* «Stukturierte Auftragsbearbeitung: Auftragsdurchführung (3)».
  - *Beschreibung (DE):* Organisation der Einreise (bei Bedarf): Beratung im Bezug auf rechtliche Voraussetzungen für die Einreise. Bereitschtellung von Einladungen, Terminbestätigungen, Buchungsbestätigungen und anderen von der Botschaft angeforderten Dokumenten für die Visavergabe/Einreiseerlaubniss.

- **[P1] Пацієнт-менеджер** *(Excel аркуш `User Stories`, **ряд. 177**)* — *User Story (DE):* «Stukturierte Auftragsbearbeitung: Auftragsdurchführung (4)».
  - *Beschreibung (DE):* Durchführung des Untersuchungs- und Behandlungsprogramms. Kontrolle über ordentliche Durchführung des Untersuchungs- und Behandlungsprogramms. Erfassung von erbrachten Leistungen, Erfassung von bei den Terminen entstandenen Problemen, Änderungen, Behandlungs-Anordnungen, Empfehlungen, Dokumenten, Rechnungen und Quittungen

- **[P1] Фінанси (Abrechnung)** *(Excel аркуш `User Stories`, **ряд. 178**)* — *User Story (DE):* «Rechnungen Auftragsbezogen erstellen.».
  - *Beschreibung (DE):* Am Ende des Auftrages werden alle vom Patientenmanager freigegebene Leistungen überprüft und Rechnung ausgestellt.

- **[P1] Фінанси (Abrechnung)** *(Excel аркуш `User Stories`, **ряд. 179**)* — *User Story (DE):* «Zwischentechnungen für große Aufträge».
  - *Beschreibung (DE):* Wenn der Auftrag sehr groß ist oder sehr lange dauert: Eine Möglichkeit Zwischenrechnung auszustellen. Die Rechnung soll nur noch nicht abgerechnete Leistungen aus diesem Auftrag beinhalten. (Beispiel: Auftrag dauert 4 Monate. Es wurde 1. Rechnung nach dem 1. Monat ausgestellt (beinhaltet alle bis zu dem Zeitpunkt erbrachte Leistungen). Im 3. Monat wurde 2. Rechnung ausgestellt. Diese Rechnung darf nicht die Leistungen aus der 1. Rechnung beinhalten.

## EPIC 24: AI

- **[P1] Система** *(Excel аркуш `User Stories`, **ряд. 180**)* — *User Story (DE):* «System so gestallten, dass medizinische Daten operationalisiert werden könnten».

- **[P4] Система** *(Excel аркуш `User Stories`, **ряд. 181**)* — *User Story (DE):* «Effektive Möglichkeit der (Pseudo?-)Ananymisierung von medizinischen Patientendaten».

- **[P4] Система** *(Excel аркуш `User Stories`, **ряд. 182**)* — *User Story (DE):* «Es soll eine Möglichkeit geben die (Pseudo-)Anonymisierte Daten in das AI zu übertragen».

- **[P4] Система** *(Excel аркуш `User Stories`, **ряд. 183**)* — *User Story (DE):* «AI wertet die Daten aus und gibt die ergebnisse im bezug auf unterschiedliche klinischen Fragestellungen».
  - *Beschreibung (DE):* AI wird dafür benutzt um die neusten medizinischen d

- **[P4] Система** *(Excel аркуш `User Stories`, **ряд. 184**)* — *User Story (DE):* «AI integration».

---

## Пов'язані канонічні документи

Супутні аспекти, винесені в окремі документи:

- RBAC: `docs/backlog/02_rbac-matrix_ua.md`
- KPI: `docs/backlog/03_kpi-catalog_ua.md`
- Delivery backlog: `docs/backlog/01_mvp-backlog_ua.md`
- Implementation tasks: `docs/backlog/04_implementation-tasks_ua.md`
- Architecture: `docs/architecture/01_target-architecture_ua.md`

## Підсумок для вимог

- Цей документ фіксує функціональний scope **рядок-у-рядок** з Excel.
- Для планування реалізації використовуються delivery-документи в `docs/backlog/`.
- Нефункціональні вимоги: `docs/requirements/04_non-functional-requirements_ua.md`.
