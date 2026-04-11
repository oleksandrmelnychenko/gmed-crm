# Аудит: Excel User Stories ↔ `03_product-backlog_ua.md`

> Автоматично згенеровано скриптом `scripts/audit_excel_vs_backlog.py`. Передати клієнту варто після ручної перевірки рядків зі статусом **розбіжність кількості** або **пріоритет**.

**Джерело Excel:** `docs/1 (Update 2) User Story Salesforce.xlsx`, аркуш `User Stories`.

**Цільовий документ:** `docs/requirements/03_product-backlog_ua.md`.

---

## 1. Зведення по EPIC

| EPIC | Рядків у Excel | Кульок у UA | Примітка |
|------|----------------|-------------|----------|
| 1 | 6 | 6 | Зіставлення 1:1 по порядку |
| 2 | 12 | 12 | Зіставлення 1:1 по порядку |
| 3 | 5 | 5 | Зіставлення 1:1 по порядку |
| 4 | 12 | 12 | Зіставлення 1:1 по порядку |
| 5 | 16 | 16 | Зіставлення 1:1 по порядку |
| 6 | 3 | 3 | Зіставлення 1:1 по порядку |
| 7 | 7 | 7 | Зіставлення 1:1 по порядку |
| 8 | 5 | 5 | Зіставлення 1:1 по порядку |
| 9 | 29 | 29 | Зіставлення 1:1 по порядку |
| 10 | 7 | 7 | Зіставлення 1:1 по порядку |
| 11 | 2 | 2 | Зіставлення 1:1 по порядку |
| 12 | 2 | 2 | Зіставлення 1:1 по порядку |
| 13 | 6 | 6 | Зіставлення 1:1 по порядку |
| 14 | 18 | 18 | Зіставлення 1:1 по порядку |
| 15 | 4 | 4 | Зіставлення 1:1 по порядку |
| 16 | 3 | 3 | Зіставлення 1:1 по порядку |
| 17 | 2 | 2 | Зіставлення 1:1 по порядку |
| 18 | 6 | 6 | Зіставлення 1:1 по порядку |
| 19 | 1 | 1 | Зіставлення 1:1 по порядку |
| 20 | 2 | 2 | Зіставлення 1:1 по порядку |
| 21 | 7 | 7 | Зіставлення 1:1 по порядку |
| 22 | 8 | 8 | Зіставлення 1:1 по порядку |
| 23 | 15 | 15 | Зіставлення 1:1 по порядку |
| 24 | 5 | 5 | Зіставлення 1:1 по порядку |

---

## 2. EPIC з однаковою кількістю: порядок, пріоритет, заголовок

Для цих EPIC застосовано зіставлення **за позицією** (n-та історія Excel → n-та куля UA).

### EPIC 1

| Excel рядок | DE User Story | P Excel | P UA | ΔP | UA рядок |
|-------------|---------------|---------|------|-----|----------|
| 2 | Patientenakte anlegen | 1 | P1 | ✓ | L21 |
| 3 | Patientenakte pflegen (medizin) | 1 | P1 | ✓ | L25 |
| 4 | Timeline aller Termine/Befunde/Leistungen/Dokumenten sehen | ∅ | P1 | ✓ | L28 |
| 5 | Textbausteine für Anamnesedokumentation | 2 | P2 | ✓ | L32 |
| 6 | Alle Patientenakten einsehen/bearbeiten | 1 | P1 | ✓ | L35 |
| 7 | Nur freigegebene Daten/Dokumente sehen | 4 | P4 | ✓ | L39 |

### EPIC 2

| Excel рядок | DE User Story | P Excel | P UA | ΔP | UA рядок |
|-------------|---------------|---------|------|-----|----------|
| 8 | Übersicht aller Partnerkliniken/-ärzte sehen | 1 | P1 | ✓ | L45 |
| 9 | Partnerkliniken-Akte anlegen | 1 | P1 | ✓ | L48 |
| 10 | Medical Service Provider Datenbank nach undterschiedlichen Kriterien s | 1 | P1 | ✓ | L51 |
| 11 | Not Medical Service Provider Datenbank nach undterschiedlichen Kriteri | 3 | P3 | ✓ | L53 |
| 12 | Preis- und Kostenentwicklungen für die Leistungen sehen | 3 | P3 | ✓ | L55 |
| 13 | Leistungsdaten von Service Providers sollen nachu unterschiedlichen Ka | 3 | P3 | ✓ | L58 |
| 14 | Schlusseldaten und Kooperationsvertragsbedienungen zu sehen | 1 | P1 | ✓ | L60 |
| 15 | Unterschiedliche Vorlagen von Kooperationspartnern speichern, updaten  | 2 | P2 | ✓ | L63 |
| 16 | Alle Daten und Dokumente im bezug auf bestimte Service Provider-Patien | 1 | P1 | ✓ | L66 |
| 17 | Not Medical Service Provider Datenbank nach undterschiedlichen Kriteri | 3 | P3 | ✓ | L69 |
| 18 | Patienten nach Klinik/Arzt filtern | 1 | P1 | ✓ | L71 |
| 19 | Auswertungen zu Klinik/Arzt-Behandlungen sehen | 2 | P2 | ✓ | L73 |

### EPIC 3

| Excel рядок | DE User Story | P Excel | P UA | ΔP | UA рядок |
|-------------|---------------|---------|------|-----|----------|
| 20 | Patienten gezielt Patientenmanagern zuordnen | 1 | P1 | ✓ | L78 |
| 21 | Nur eigene Patienten sehen | 1 | P1 | ✓ | L82 |
| 22 | Nur eigene Patienten sehen | 4 | P4 | ✓ | L85 |
| 23 | Nur eigene Patienten sehen | 3 | P3 | ✓ | L88 |
| 24 | Nur eigene Patienten sehen | 3 | P3 | ✓ | L91 |

### EPIC 4

| Excel рядок | DE User Story | P Excel | P UA | ΔP | UA рядок |
|-------------|---------------|---------|------|-----|----------|
| 25 | Medizinische Termine planen | 1 | P1 | ✓ | L97 |
| 26 | Medizinische Termine Dolmetscher zuordnen | 1 | P1 | ✓ | L99 |
| 27 | nicht-Medizinische/Service Termine Dolmetscher zuordnen | 3 | P3 | ✓ | L101 |
| 28 | medizinische Patiententermine sollen zu bestimmten Service Provider, O | 1 | P1 | ✓ | L103 |
| 29 | Nach dem der Behandlungsplan (Behandlungstermine) feststeht, soll es m | 1 | P1 | ✓ | L105 |
| 30 | Bei bestimmten Terminen soll es möglich sein Erinnerungen zur Vorberei | 2 | P2 | ✓ | L118 |
| 31 | Geleistete Arbeitsstunden termingebunden angeben | 3 | P3 | ✓ | L121 |
| 32 | Leistungserfassung automatisch termingebunden übertragen | 1 | P1 | ✓ | L123 |
| 33 | Zeitkonflikte - Hinweise sehen. | 2 | P2 | ✓ | L126 |
| 34 | Reisen/Unterkünfte/Service buchen/organisieren | 3 | P3 | ✓ | L129 |
| 35 | Zugewiesene Termine mobil einsehen | 4 | P4 | ✓ | L131 |
| 36 | Nur freigegebene Termine sehen | 4 | P4 | ✓ | L133 |

### EPIC 5

| Excel рядок | DE User Story | P Excel | P UA | ΔP | UA рядок |
|-------------|---------------|---------|------|-----|----------|
| 37 | Papierdokumente einscannen und und direkt ins System importieren | 1 | P1 | ✓ | L137 |
| 38 | Dokumente kategorisieren | 1 | P1 | ✓ | L139 |
| 39 | Dokumente einsehen | 1 | P1 | ✓ | L142 |
| 40 | Dokumente erstellen | 1 | P1 | ✓ | L145 |
| 41 | Dokumente/Aktivitäten | 1 | P1 | ✓ | L148 |
| 42 | Dokumente teilen | 2 | P2 | ✓ | L151 |
| 43 | Nur die Dokumente mit Extern  teilen können, die freigegenen wurden, | 1 | P1 | ✓ | L154 |
| 44 | Dokumente mit Extern nicht teilen können, wenn diese als "For internal | 1 | P1 | ✓ | L156 |
| 45 | Dokumente mit Extern nur über die verträglich festgestellte (im Fall:  | 1 | P1 | ✓ | L158 |
| 46 | Dokumente die medizinische Informationen beinhalten nur mit den medizi | 1 | P1 | ✓ | L161 |
| 47 | Informationen ins PDF umwandeln und  teilen | 1 | P1 | ✓ | L163 |
| 48 | Automatisches Umbenennen + Zuordnen | 1 | P1 | ✓ | L166 |
| 49 | Dokumente weiterleiten bzw. für untergesetzte MA freischalten | 1 | P1 | ✓ | L170 |
| 50 | Fehlende Dokumente->Meldung | 1 | P1 | ✓ | L172 |
| 51 | Dokumente sicher ins Portal hochladen | 4 | P4 | ✓ | L175 |
| 52 | Nur freigegebene Dokumente sehen | 4 | P4 | ✓ | L177 |

### EPIC 6

| Excel рядок | DE User Story | P Excel | P UA | ΔP | UA рядок |
|-------------|---------------|---------|------|-----|----------|
| 53 | Verträge/Aufträge elektronisch signieren | 4 | P4 | ✓ | L181 |
| 54 | Dokumente zur Signatur freigeben | 4 | P4 | ✓ | L184 |
| 55 | Signaturen archivieren mit Zeitstempel | 4 | P4 | ✓ | L186 |

### EPIC 7

| Excel рядок | DE User Story | P Excel | P UA | ΔP | UA рядок |
|-------------|---------------|---------|------|-----|----------|
| 56 | Neue Diagnosen/Medikamente/Anordnungen usw. eintragen | 1 | P1 | ✓ | L191 |
| 57 | Erinnerungen erstellen | 1 | P1 | ✓ | L194 |
| 58 | Leistungsreports für CEO erstellen und teilen | 2 | P2 | ✓ | L197 |
| 59 | Mediizinische Patienteninformationen updaten und vervollständigen | 1 | P1 | ✓ | L199 |
| 60 | Info/Meldungen erhalten, wen neue Termine oder Daten noch nicht bearbe | 1 | P1 | ✓ | L202 |
| 61 | Terminupdates, Termin-Follow-ups, Termin-Check-Listen haben | 1 | P1 | ✓ | L205 |
| 62 | Nur für den Fall/Auftrag benötigte Dokumente/Infos sehen | 3 | P3 | ✓ | L208 |

### EPIC 8

| Excel рядок | DE User Story | P Excel | P UA | ΔP | UA рядок |
|-------------|---------------|---------|------|-----|----------|
| 63 | Sichere Nachrichten- und Dokumentenaustausch mit der Agentur | 4 | P4 | ✓ | L213 |
| 64 | Nachrichten und Infos zu Einsätzen erhalten | 3 | P3 | ✓ | L216 |
| 65 | Aufgaben für Teamleads, Dolmetscher und Concierge  zu erstellen und ve | 2 | P2 | ✓ | L218 |
| 66 | Mit den Kliniken, Ärzten und anderen Service Provider zu kommunizieren | 1 | P1 | ✓ | L220 |
| 67 | Intern fallbezogen kommunizieren mit Fall-/Auftragsbereiligten | 1 | P1 | ✓ | L222 |

### EPIC 9

| Excel рядок | DE User Story | P Excel | P UA | ΔP | UA рядок |
|-------------|---------------|---------|------|-----|----------|
| 68 | Vom Patientenmanager erfasste und freigeschaltete Leistungen automatis | 1 | P1 | ✓ | L226 |
| 69 | Leistungen erfassen und Rechnungen erstellen | 1 | P1 | ✓ | L228 |
| 70 | Buchhaltung Finanzamt-Konform führen | 1 | P1 | ✓ | L231 |
| 71 | Kostenvoranschläge generieren | 1 | P1 | ✓ | L234 |
| 72 | Vorkassenrechnungen erstellen | 1 | P1 | ✓ | L236 |
| 73 | freigegebene Dolmetscherstunden und Concierge-Services automatisch in  | 1 | P1 | ✓ | L238 |
| 74 | Bei langen, dauerhaften oder kostenintensiven Aufträgen-Zwischenrechnu | 1 | P1 | ✓ | L240 |
| 75 | Rechnungsstatus verfolgen und Infos/Meldungen bei offenen Forderungen  | 1 | P1 | ✓ | L242 |
| 76 | automatisiertes Mahnwesen (1. Mahnung, 2. Mahnung, Inkasso) | 2 | P2 | ✓ | L244 |
| 77 | Datenexport für Steuerberater/DATEV | 1 | P1 | ✓ | L247 |
| 78 | Bei Kostenübernahmen dazugehörige Belege automatisch anheften/verknüpf | 2 | P2 | ✓ | L249 |
| 79 | Möglichkeit der Kategorisierung von abgerechneten Leistungen nach unte | 3 | P3 | ✓ | L251 |
| 80 | Möglichkeit alle Finanzunterlagen des Patientes zu sehen | 1 | P1 | ✓ | L254 |
| 81 | Bei der Rechnungsausstellung: Eigene Leistungen immer mit dem DE Umsat | 1 | P1 | ✓ | L257 |
| 82 | Laut Kostenvoranschlag/Vorkasse bezahlte Leistungen/Summen in der Rech | 1 | P1 | ✓ | L259 |
| 83 | Erstellung von Zwischenrechnungen im Rahmen von einem Auftrag | 1 | P1 | ✓ | L261 |
| 84 | Neue Produkte-/Leistungspositionen erstellen können und unterschiedlic | 1 | P1 | ✓ | L263 |
| 85 | E-Rechnungen rechtskonform ausstellen | 2 | P2 | ✓ | L265 |
| 86 | Rechnungen die aus mehreren Seiten bestehen: Seiten sollen durchnummer | 1 | P1 | ✓ | L267 |
| 87 | Erfassung von auftragsgebundenen Arbeitsstunden und automatische Erste | 1 | P1 | ✓ | L269 |
| 88 | vollständige Buchhaltungsfunktionen haben | 2 | P2 | ✓ | L271 |
| 89 | Merkmall/Differenzierung bei den Externen rechnungen zwischen den Rech | 1 | P1 | ✓ | L274 |
| 90 | Sowohl eigene (Gewinn-)Rechnungen, asl auch fremde (Verlust)Rechnungen | 2 | P2 | ✓ | L277 |
| 91 | Alle erfasste Leistungen und Ausgaben an die Abrechnung automatisch üb | 1 | P1 | ✓ | L280 |
| 92 | Freigegebene Dolmetscherstunden an die Abrechnung automatisch übermitt | 1 | P1 | ✓ | L282 |
| 93 | Alle erfasste Leistungen und Ausgaben an die Abrechnung automatisch üb | 3 | P3 | ✓ | L284 |
| 94 | jede Änderung an Rechnungen oder Leistungen im Audit-Log dokumentieren | 1 | P1 | ✓ | L286 |
| 95 | Umsatzberichte sehen | 1 | P1 | ✓ | L288 |
| 96 | Rechnungen im Portal sehen und bezahlen | 4 | P4 | ✓ | L291 |

### EPIC 10

| Excel рядок | DE User Story | P Excel | P UA | ΔP | UA рядок |
|-------------|---------------|---------|------|-----|----------|
| 97 | Eigene Stunden eintragen + Bericht schreiben+Dateien uploaden | 3 | P3 | ✓ | L295 |
| 98 | Informationen über den Arbeitsauftrag/Termin und Patient sehen | 3 | P3 | ✓ | L297 |
| 99 | Stunden prüfen und freigeben | 3 | P3 | ✓ | L299 |
| 100 | Berichte prüfen und freigeben | 3 | P3 | ✓ | L301 |
| 101 | Vom Dolmetscher eingegangene Dateien/Dokumente prüfen, dazugehörige Ma | 3 | P3 | ✓ | L303 |
| 102 | Dolmetscherberichte/Einsatzstunden/Dokumente und Dateien sehen | 3 | P3 | ✓ | L305 |
| 103 | Freigegebene Stunden in Rechnungen übernehmen | 1 | P1 | ✓ | L307 |

### EPIC 11

| Excel рядок | DE User Story | P Excel | P UA | ΔP | UA рядок |
|-------------|---------------|---------|------|-----|----------|
| 104 | Leistungs und Umsatzdaten von Med. Service Providers sehen | 2 | P2 | ✓ | L311 |
| 105 | Leads erfassen und Partner pflegen | 2 | P2 | ✓ | L314 |

### EPIC 12

| Excel рядок | DE User Story | P Excel | P UA | ΔP | UA рядок |
|-------------|---------------|---------|------|-----|----------|
| 106 | Verträge automatisch generieren | 1 | P1 | ✓ | L318 |
| 107 | Patientenaufkleber generieren | 1 | P1 | ✓ | L321 |

### EPIC 13

| Excel рядок | DE User Story | P Excel | P UA | ΔP | UA рядок |
|-------------|---------------|---------|------|-----|----------|
| 108 | Dokumente und Informationen für Patienten im Portal freigeben | 4 | P4 | ✓ | L326 |
| 109 | Nur die Inforationen mit Extern oder im Portal  teilen  können, die fr | 3 | P3 | ✓ | L328 |
| 110 | Informationen mit Extern oder im Patientenportal nicht teilen können,  | 3 | P3 | ✓ | L330 |
| 111 | Informationen mit Extern nur über die verträglich festgestellte (im Fa | 2 | P2 | ✓ | L332 |
| 112 | Dokumente medizinische Informationen beinhalten nur mit den medizinisc | 2 | P2 | ✓ | L334 |
| 113 | Datenfreigaben an Dritte erteilen/widerrufen | ∅ | P1 | ✓ | L336 |

### EPIC 14

| Excel рядок | DE User Story | P Excel | P UA | ΔP | UA рядок |
|-------------|---------------|---------|------|-----|----------|
| 114 | Rollen & Rechte verwalten | ∅ | P1 | ✓ | L341 |
| 115 | AES-256 Speicherung | ∅ | P1 | ✓ | L343 |
| 116 | TLS 1.3 Transport | ∅ | P1 | ✓ | L345 |
| 117 | MFA für alle Mitarbeiter | ∅ | P1 | ✓ | L347 |
| 118 | RBAC (Need-to-know) | ∅ | P1 | ✓ | L349 |
| 119 | Audit-Logs unveränderbar | ∅ | P1 | ✓ | L351 |
| 120 | eIDAS-konforme Signatur | ∅ | P1 | ✓ | L353 |
| 121 | DSGVO-konforme Einwilligung , Widerruf, Löschkonzept | ∅ | P1 | ✓ | L355 |
| 122 | Backups & Recovery (3-2-1-Regel) | ∅ | P1 | ✓ | L357 |
| 123 | End-to-End-Verschlüsselung Kommunikation | ∅ | P1 | ✓ | L359 |
| 124 | Sieht nur explizit freigegebene Inhalte. | ∅ | P1 | ✓ | L361 |
| 125 | Kann Berichte schreiben und Stunden erfassen, PDFs uploaden, sieht abe | 3 | P3 | ✓ | L363 |
| 126 | Sieht nur Reise- und Serviceinfos, niemals Diagnosen oder med. Daten | 3 | P3 | ✓ | L365 |
| 127 | Hat nur Zugriff auf Finanzdaten, nicht auf medizinische Infos. | 1 | P1 | ✓ | L367 |
| 128 | Hat nur Zugriff auf Leads & Partnerinfos, nicht auf Patienten. | ∅ | P1 | ✓ | L369 |
| 129 | Einziger mit echtem Vollzugriff. | ∅ | P1 | ✓ | L371 |
| 130 | SOPs: Sichtbarkeit abhängig von Rolle – jeder sieht nur für ihn releva | ∅ | P1 | ✓ | L373 |
| 131 | Audit-Logs auswerten | ∅ | P1 | ✓ | L375 |

### EPIC 15

| Excel рядок | DE User Story | P Excel | P UA | ΔP | UA рядок |
|-------------|---------------|---------|------|-----|----------|
| 132 | SOPs & Schulungen abrufen | 2 | P2 | ✓ | L379 |
| 133 | SOPs bestätigen lassen | 2 | P2 | ✓ | L382 |
| 134 | Eigene SOPs für Team hinzufügen (nach CEO Freigabe) | 2 | P2 | ✓ | L384 |
| 135 | Eigene SOPs für Team hinzufügen (nach Patientenmanager-Freigabe) | 3 | P3 | ✓ | L386 |

### EPIC 16

| Excel рядок | DE User Story | P Excel | P UA | ΔP | UA рядок |
|-------------|---------------|---------|------|-----|----------|
| 136 | VIP-Services dokumentieren | 3 | P3 | ✓ | L390 |
| 137 | VIP-Services erfassen und Abrechnen | 3 | P3 | ✓ | L392 |
| 138 | Zusatzservices buchen | 4 | P4 | ✓ | L394 |

### EPIC 17

| Excel рядок | DE User Story | P Excel | P UA | ΔP | UA рядок |
|-------------|---------------|---------|------|-----|----------|
| 139 | Klinik-Feedback erfassen | 3 | P3 | ✓ | L398 |
| 140 | Dolmetscher-Feedback einsehen | 3 | P3 | ✓ | L400 |

### EPIC 18

| Excel рядок | DE User Story | P Excel | P UA | ΔP | UA рядок |
|-------------|---------------|---------|------|-----|----------|
| 141 | Automatische To-Do-Listen erhalten | 1 | P1 | ✓ | L404 |
| 142 | Checklisten pro Patient nutzen | 1 | P1 | ✓ | L406 |
| 143 | Checklisten pro Auftrag nutzen | 1 | P1 | ✓ | L408 |
| 144 | Automatische To-Do-Listen erhalten | 3 | P3 | ✓ | L410 |
| 145 | Checklisten pro Patient nutzen | 3 | P3 | ✓ | L412 |
| 146 | Checklisten pro Auftrag nutzen | 3 | P3 | ✓ | L414 |

### EPIC 19

| Excel рядок | DE User Story | P Excel | P UA | ΔP | UA рядок |
|-------------|---------------|---------|------|-----|----------|
| 147 | Termine anfragen, Dokumente hochladen, Rechnungen bezahlen | 4 | P4 | ✓ | L418 |

### EPIC 20

| Excel рядок | DE User Story | P Excel | P UA | ΔP | UA рядок |
|-------------|---------------|---------|------|-----|----------|
| 148 | Automatische Risikoanalyse erhalten (komplexe Fälle, offene Termine) | 2 | P2 | ✓ | L422 |
| 149 | Automatische Risikoanalyse erhalten (komplexe Fälle, Kostenrisiko) | 2 | P2 | ✓ | L424 |

### EPIC 21

| Excel рядок | DE User Story | P Excel | P UA | ΔP | UA рядок |
|-------------|---------------|---------|------|-----|----------|
| 150 | Eigene interne  Termine, Dolmetscher-Teamlead-Concierge-Arzt/Service P | 1 | P1 | ✓ | L428 |
| 151 | Neue Termine für Patienten erstellen und verändern | 1 | P1 | ✓ | L430 |
| 152 | Meine interne-, service provider-, patienten- und untergesetzte mitarb | 3 | P3 | ✓ | L433 |
| 153 | Meine interne und patienten-service-provider-bezogene Termine mit alle | 3 | P3 | ✓ | L436 |
| 154 | Meine interne Termine und patientenbezogene Termine (nicht medizinisch | 3 | P3 | ✓ | L439 |
| 155 | Termine  sollen mit dem Patient, Service Provider, MA,  Auftrag verknü | 1 | P1 | ✓ | L442 |
| 156 | Alle Termine sehen. Neue Termine erstellen.  Möglichkeit Termine nach  | 1 | P1 | ✓ | L444 |

### EPIC 22

| Excel рядок | DE User Story | P Excel | P UA | ΔP | UA рядок |
|-------------|---------------|---------|------|-----|----------|
| 157 | Möglichkein zwischen den Unterschiedlichen "Masken/Modulen" zu wechsel | 1 | P1 | ✓ | L448 |
| 158 | Kommunikation mit den MA | 1 | P1 | ✓ | L451 |
| 159 | Reports und KPIs | 2 | P2 | ✓ | L454 |
| 160 | Informationen und Leistungsdaten von jedem MA einseghen | ∅ | P1 | ✓ | L457 |
| 161 | Informationen und Leistungsdaten von Patienten einsehen | ∅ | P1 | ✓ | L459 |
| 162 | Informationen und Leistungsdaten von Kliniken/Äzten einsehen | ∅ | P1 | ✓ | L462 |
| 163 | Statistiken und Reports nach unterschiedlichen Kriterien | ∅ | P1 | ✓ | L464 |
| 164 | Zugriffsrechte von MA erteilen und verändern | ∅ | P1 | ✓ | L466 |

### EPIC 23

| Excel рядок | DE User Story | P Excel | P UA | ΔP | UA рядок |
|-------------|---------------|---------|------|-----|----------|
| 165 | Erstellung von neuen Aufträgen | ∅ | P1 | ✓ | L470 |
| 166 | Schneller Patientenbedarfsdokumentation | ∅ | P1 | ✓ | L473 |
| 167 | Zusammensetzung von Aufträgen | ∅ | P1 | ✓ | L476 |
| 168 | Zusammensetzung von Kostenvoranschlägen | ∅ | P1 | ✓ | L479 |
| 169 | Unterschreibung von Aufträgen mit eSignatur | ∅ | P1 | ✓ | L482 |
| 170 | Ansammlung von erbrachten Leistungen im Laufe des Auftrages | ∅ | P1 | ✓ | L485 |
| 171 | Stukturierte Auftragsbearbeitung  (sinvolle Strukturierung erarbeiten) | 1 | P1 | ✓ | L488 |
| 172 | Stukturierte Auftragsbearbeitung: Entdekung (Beim 1. Auftrag) | 1 | P1 | ✓ | L491 |
| 173 | Stukturierte Auftragsbearbeitung: Auftragserteilung/-entgegennahme | ∅ | P1 | ✓ | L494 |
| 174 | Stukturierte Auftragsbearbeitung: Auftragsdurchführung (1) | ∅ | P1 | ✓ | L497 |
| 175 | Stukturierte Auftragsbearbeitung: Auftragsdurchführung (2) | ∅ | P1 | ✓ | L500 |
| 176 | Stukturierte Auftragsbearbeitung: Auftragsdurchführung (3) | 2 | P2 | ✓ | L503 |
| 177 | Stukturierte Auftragsbearbeitung: Auftragsdurchführung (4) | 1 | P1 | ✓ | L506 |
| 178 | Rechnungen Auftragsbezogen erstellen. | 1 | P1 | ✓ | L509 |
| 179 | Zwischentechnungen für große Aufträge | 1 | P1 | ✓ | L512 |

### EPIC 24

| Excel рядок | DE User Story | P Excel | P UA | ΔP | UA рядок |
|-------------|---------------|---------|------|-----|----------|
| 180 | System so gestallten, dass medizinische Daten operationalisiert werden | 1 | P1 | ✓ | L517 |
| 181 | Effektive Möglichkeit der (Pseudo?-)Ananymisierung von medizinischen P | 4 | P4 | ✓ | L519 |
| 182 | Es soll eine Möglichkeit geben die (Pseudo-)Anonymisierte Daten in das | 4 | P4 | ✓ | L521 |
| 183 | AI wertet die Daten aus und gibt die ergebnisse im bezug auf unterschi | 4 | P4 | ✓ | L523 |
| 184 | AI integration | 4 | P4 | ✓ | L526 |

---

## 3. EPIC з різною кількістю: повні списки для ручного мапінгу

*Немає EPIC, де кількість рядків Excel і куль у `03_product-backlog_ua.md` розходиться.*

---

## 4. Позначки в `03_product-backlog_ua.md`

У `03_product-backlog_ua.md` у верхній частині є HTML-коментар із посиланням на цей аудит і на скрипт регенерації з Excel (для редакторів; у звичайному перегляді не видно).

---

## 5. Короткі висновки

- **Стан зведення (§1):** після регенерації `03_product-backlog_ua.md` скриптом `scripts/generate_product_backlog_from_excel.py` кількість пунктів у кожному EPIC **збігається** з кількістю рядків User Stories у Excel (1:1).
- **Пріоритети (§2):** порівняння `[P*]` з колонкою Priority; порожній Priority в Excel у згенерованому файлі замінено на `P1` — див. примітку в шапці беклогу.
- **Розділ 3** (повні списки при різній кількості) за поточного стану **порожній** — розбіжностей за кількістю немає.

