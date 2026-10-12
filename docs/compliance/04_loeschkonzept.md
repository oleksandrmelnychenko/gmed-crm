# Löschkonzept (Art. 5 Abs. 1 lit. e, Art. 17 DSGVO)

Entwurf, Stand 2026-09-17. Aufbau nach DIN 66398: Datenart, Frist, Startzeitpunkt,
Umsetzung. Fristen in eckigen Klammern legt die Organisation mit dem DSB fest.

| Datenart | Frist | Beginn | Umsetzung im System |
|---|---|---|---|
| Anfragen (Leads) ohne Qualifizierung und ohne unterschriebene Einwilligung | 14 Tage (`unqualified_lead_retention_days`) | Anlage der Anfrage, frühestens Start der Regel (`unqualified_lead_retention_effective_at`) | automatisch, täglich (`spawn_lead_purger`): Löschung aller Dokumente und Dateien, der Anhänge und des Interessenten-Datensatzes, Rücknahme des offenen Auftrags, Deaktivierung und Anonymisierung des mit der Anfrage angelegten Patientenzugangs, Widerruf der Elternzugänge (ein Elternzugang ohne weitere Anfrage oder Patientenakte wird ebenso deaktiviert und anonymisiert), Löschung der Portal-Angaben (Feldmarkierungen, Sendezeitpunkt, hochgeladene Unterlagen) und des Protokolls der Zugangs-E-Mails (`portal_login_emails`: Empfängeradresse, Zeitpunkt, Sprache, Zustellstatus; der Inhalt wird nie gespeichert); die Anfrage bleibt als leerer Zähldatensatz ohne Personenbezug. Die im Portal erteilte Einwilligung „Bearbeitung der Anfrage“ hält die Frist nicht an – nur die unterschriebene DSGVO-Einwilligung. Ausgenommen ist eine Wiederholungsanfrage einer Patientin / eines Patienten, deren unterschriebene DSGVO-Einwilligung in der Akte vermerkt und nicht widerrufen ist (Entscheidung 2026-10-11); ohne solche Einwilligung gilt die Frist wie für jede Anfrage, die Patientenakte selbst wird nie berührt. Hinweis an die zuständige Person 3 Tage vorher. Nicht automatisch, wenn eine Rechnung existiert (§ 147 AO) – dann Meldung zur Entscheidung |
| Im Patientenportal erteilte Einwilligungen einer Anfrage (`consent_records`: Gesundheitsdaten Art. 9, Bearbeitung der Anfrage) | **offen** (Vorschlag: 3 Jahre nach Widerruf bzw. Ende der Anfrage, Nachweis nach Art. 7 Abs. 1 DSGVO) | Widerruf bzw. Löschung der Anfrage | bleiben bei der Löschung der Anfrage als Nachweis erhalten (Zeitpunkt, Textversion, Text, verknüpfter – dann anonymisierter – Zugang); bei Umwandlung in eine Patientenakte dieser zugeordnet; Löschweg nach Ablauf **offen** |
| Nicht zustande gekommene Anfragen (Leads), übrige Fälle | 180 Tage | Archivierung | automatisch, täglich (`spawn_lead_purger`, Einstellung `cleanup_archived_leads_days`); Anonymisierung der Identitätsfelder, Löschung der Dokumente, Dateien und Anhänge, Deaktivierung und Anonymisierung des Patientenzugangs der Anfrage |
| Von Mitarbeitenden frei formulierte Absagegründe und interne Notizen zu einer Anfrage („Nicht geeignet“ → „Andere“, Archivierung) außerhalb des Lead-Datensatzes: Verlauf (`workflow_lifecycle_events`), gespeicherte Echtzeit-Ereignisse, Audit-Log | wie die Anfrage | Löschung/Anonymisierung der Anfrage (alle Wege, auch Art. 17 der Patientenakte) | Seit 2026-10-12 schreibt das Audit-Log nur den Code des Grundes und ob ein Freitext erfasst wurde. Bei der Löschung (`leads::scrub_lead_free_text_in_tx`, in derselben Transaktion): Verlauf behält nur den Code, Notiz entfällt, Echtzeit-Ereignisse der Anfrage werden gelöscht; ältere Audit-Zeilen (`qualify_lead`, `resolve_failed_lead`, `cancel_order.lead_reason`) erhalten statt des Freitexts den Marker `[erased]` – einzige Ausnahme vom Append-only-Schutz des Audit-Logs neben dem Aufgabenverlauf, nur Textwerte des `context`, nur innerhalb der Löschung (Entscheidung der Geschäftsführung 2026-10-12, Migration `20261012194730`); bereits gelöschte Anfragen bereinigt die Migration einmalig |
| Patientenakte, medizinische Unterlagen | 1095 Tage (`patient_file_retention_days`) | Akte auf „inaktiv“ gesetzt (`inactive_since`) | Bei der Anonymisierung werden auch die Protokolle der Zugangs-E-Mails (`portal_login_emails`) gelöscht; täglicher Lauf legt einen Löschantrag im Compliance-Register an; Prüfung auf Aufbewahrungspflichten und Ausführung durch CEO/IT. Nicht solange die ärztliche Dokumentation aufzubewahren ist (`clinical_retention_until`) und nicht erneut, wenn der Antrag für dieselbe Inaktivitätsphase begründet abgelehnt wurde |
| Rechnungen, Buchungsbelege | 8 Jahre (Belege) / 10 Jahre (Bücher) | Ende des Kalenderjahres | von der Löschung ausgenommen (§ 147 AO); nach Ablauf **offen** |
| Zahlererklärung einer Anfrage („Wer zahlt“: Herkunft der Mittel, wirtschaftlich Berechtigter, Daten des Kostenübernehmers, `lead_payer_declarations`) | nicht zustande gekommen: wie die Anfrage; zustande gekommen: 5 Jahre nach Ende der Geschäftsbeziehung (§ 8 Abs. 4 GwG) | Anonymisierung der Anfrage bzw. Ende der Geschäftsbeziehung | bei Anonymisierung/Löschung einer nicht konvertierten Anfrage mitgelöscht; nach der Konvertierung der Patientenakte zugeordnet (`patient_id`) und mit ihr aufbewahrt; Löschung nach Ablauf **offen** |
| Eigene GwG-Angaben einer Anfrage aus dem Patientenportal (`lead_gwg_declarations`: Geburtsort und -land, Ausweisdokument, Angaben zu PEP, Hochrisiko-Drittstaat und Sanktionsbezug, Bestätigung der Richtigkeit) samt hochgeladener Ausweiskopie | nicht zustande gekommen: wie die Anfrage; zustande gekommen: 5 Jahre nach Ende der Geschäftsbeziehung (§ 8 Abs. 4 GwG) | Anonymisierung der Anfrage bzw. Ende der Geschäftsbeziehung | bei Löschung/Anonymisierung einer nicht konvertierten Anfrage in derselben Transaktion mitgelöscht (`purge_portal_intake_in_tx`, `anonymize_lead_pii`); die Ausweiskopie wird mit den Dokumenten der Anfrage gelöscht; nach der Konvertierung bleiben die Angaben bei der Geschäftsbeziehung wie die Zahlererklärung; Löschung nach Ablauf **offen** |
| Bestätigung der Zahlung vom eigenen Konto zu einer Anfrage (§ 12 Abs. 1 GwG, Identifizierung per qualifizierter elektronischer Signatur; `lead_identification_payments`: Person, Zeitpunkt, bestätigende Mitarbeiterin/bestätigender Mitarbeiter, Notiz) | nicht zustande gekommen: wie die Anfrage; zustande gekommen: 5 Jahre nach Ende der Geschäftsbeziehung (§ 8 Abs. 4 GwG) | Anonymisierung der Anfrage bzw. Ende der Geschäftsbeziehung | bei Löschung/Anonymisierung einer nicht konvertierten Anfrage in derselben Transaktion mitgelöscht (`purge_portal_intake_in_tx`, `anonymize_lead_pii`); nach der Konvertierung bleibt die Bestätigung bei der Geschäftsbeziehung wie die Zahlererklärung; Löschung nach Ablauf **offen** |
| Zahler- und Empfängerdaten ausgestellter Rechnungen (`recipient_snapshot`, `payer_*`) | wie die Rechnung (8 / 10 Jahre) | Ende des Kalenderjahres | mit der Ausstellung festgeschrieben (Datenbank-Trigger); die Anonymisierung des Patienten und das Ändern des Angehörigen lassen sie unverändert (Art. 17 Abs. 3 lit. b DSGVO); ein Angehöriger, an den ausgestellte Rechnungen adressiert sind, kann nicht gelöscht werden; nach Ablauf **offen** |
| Angehörige, Vertreter und Zahler eines Patienten (`patient_relations`: Name, Telefon, E-Mail, Anschrift, Notizen) | wie die Patientenakte; als Zahler, Rechnungsempfänger oder Vertragspartei: wie Rechnung bzw. Vertrag (6 / 8 / 10 Jahre) | Anonymisierung der Patientenakte bzw. Ende des Kalenderjahres | bei der Löschung nach Art. 17 gelöscht, wenn keine Rechnung, kein Auftrag und kein Rahmenvertrag die Person nennt; sonst bleiben nur Name und Rechnungsanschrift (mit E-Mail) für diesen Geschäftsvorgang (§ 14 Abs. 4 UStG, § 257 HGB, § 147 AO), Telefon, Notizen und die Kennzeichen „Notfallkontakt“ und „Standardzahler“ werden entfernt. Dasselbe gilt für Einträge in den Akten **anderer** Patienten, die mit der gelöschten Akte verknüpft sind: ohne Geschäftsvorgang gelöscht (mit ihren Ergebnissen der Sanktionslisten-Prüfung), sonst im genannten Umfang behalten und von der gelöschten Akte gelöst, außer eine ausgestellte Rechnung ist an sie adressiert (deren festgeschriebener Empfänger hängt daran); nach Ablauf **offen** |
| Auftragsvorbereitung (`order_intakes`: Entwurf, bestätigte Angaben, Bestätigungsstand; `order_intake_fact_reviews`; gespeicherter Kontext der Auftragsdokumente) | wie der Auftrag (6 Jahre, § 257 HGB) | Ende des Kalenderjahres | bei der Löschung nach Art. 17 werden die Kopien der Stammdaten (Versicherung, Telefon, E-Mail, Anschrift) geleert und die Kopien der Identität entfernt, wie in der Akte selbst; Inhalt des Auftrags (Zeitraum, Leistungen, Preise, Vorauszahlung) und die GwG-Angaben (PEP, Vertreter, § 8 Abs. 4 GwG), die auch die Akte behält, bleiben; nach Ablauf **offen** |
| Verträge, Aufträge, Geschäftsbriefe | 6 Jahre | Ende des Kalenderjahres | von der Löschung ausgenommen (§ 257 HGB); nach Ablauf **offen** |
| Elektronisch signierte Originale (signierte PDF, Dokumentenpaket, Signaturprotokoll, Signaturnachweise der Anfrage) | wie der zugrunde liegende Vertrag bzw. die Einwilligung (6 / 8 / 10 Jahre) | Ende des Kalenderjahres der Unterzeichnung | unveränderlich gespeichert (Datenbank-Trigger `protect_signed_signature_documents`, `protect_archived_signature_requests`); von der Löschung nach Art. 17 und von der Löschung nicht qualifizierter Anfragen ausgenommen (Art. 17 Abs. 3 lit. b, e DSGVO). Testsignaturen (DEMO) sind nicht geschützt und werden mitgelöscht. Nach Ablauf der Frist gibt es derzeit **keinen Löschweg** – **offen**, wie bei Rechnungen und Verträgen |
| Personalakten (je Kategorie, `personnel_document_categories`) | 3 bis 8 Jahre: Entgeltabrechnung 8 J. (§ 147 AO), Lohnsteuer 6 J. (§ 41 EStG), Stundenzettel und Sozialversicherung 6 J. (§ 28f SGB IV), Verträge und Kündigung 6 J. nach Austritt, Arbeitsunfähigkeit, Abmahnung 3 J., übrige 3 J. nach Austritt [vom Steuerberater zu bestätigen] | Ende des Kalenderjahres des Dokuments bzw. des Austritts | Löschung nur durch die Geschäftsführung mit Begründung, nach Fristablauf, ohne Legal Hold und erst nach Freischaltung (`personnel_retention_deletion_enabled`, Standard: aus); die Datei wird entfernt, der Datensatz bleibt als Nachweis mit Prüfsumme erhalten |
| Sanktionslisten-Prüfung: mögliche Treffer, Entscheidungen des CEO, Aufhebungen der Länder-Sperre (`sanctions_hits`, `sanctions_country_overrides`) | wie die Anfrage bzw. die Patientenakte | wie die Anfrage bzw. die Patientenakte | in derselben Transaktion wie die Löschung der Anfrage (`purge_lead_and_prospect_in_tx`, beide Regeln oben und die manuelle Löschung) und wie die Anonymisierung der Patientenakte (Art. 17) gelöscht, samt der Benachrichtigungen an den CEO. Das Audit-Log behält die Ereignisse (Treffer, Entscheidung mit Begründung, Aufhebung) ohne Namen der Person für seine eigene Frist. Rechtsgrundlage der Prüfung: Art. 6 Abs. 1 lit. c DSGVO (EU-Finanzsanktionen, Bereitstellungsverbot) und lit. f; ob ein bestätigter Treffer länger aufzubewahren ist (Nachweis gegenüber Behörden), ist **offen** (anwaltliche Prüfung). Siehe `docs/architecture/sanctions-screening_ua.md` |
| EU-Sanktionsliste (öffentliche Daten, `sanctions_list_entries`) | die drei neuesten Versionen | Import einer neuen Version | ältere Versionen werden beim Import entfernt; die Versionszeile (Datum, Prüfsumme) bleibt als Nachweis, auf welchem Stand ein Treffer beruht |
| Direktnachrichten und Anhänge | [Frist] | Versand | automatische Bereinigung abgelaufener Nachrichten und verwaister Anhänge |
| Audit-Log (Fachereignisse) | 365 Tage | Ereignis | automatisch (`cleanup_audit_log_days`) |
| Technische Zugriffszeilen | 3 Tage | Ereignis | automatisch (`cleanup_audit_http_days`) |
| Abgelaufene Tokens | 7 Tage | Ablauf | automatisch |
| Backups | 35 Tage (`BACKUP_RETENTION_DAYS`) | Erstellung | automatisch durch die Backup-Skripte nach jedem erfolgreichen Upload |

## Löschung auf Antrag (Art. 17)

Ablauf im Register: Antrag → Prüfung (Genehmigung, Ablehnung mit Begründung oder
Aufschub wegen Aufbewahrungspflicht mit Datum; die Begründung sieht die betroffene
Person im Portal) → bei Antrag der betroffenen Person vermerkte Identitätsprüfung →
Ausführung. Eine genehmigte Löschung können CEO und IT-Admin mit Begründung noch
ablehnen oder zurückstellen. Einen anderen Löschweg gibt es nicht: der frühere
direkte Weg (`…/anonymize`, Löschung ohne Antrag und Prüfung) ist entfernt
(2026-10-12).

Ende des Aufschubs: Ein bis zu einem Datum zurückgestellter Antrag – jeder Art,
jeder Aufschub trägt ein Datum – kommt an diesem Datum von selbst wieder in die
Warteschlange (stündliche Prüfung `requeue_expired_retention_holds`): Status
„Angefordert“, neue Frist (`patient_erasure_due_days`), Eintrag im Verlauf des
Antrags, Audit `privacy_request_requeued` und Hinweis an CEO und IT-Admin. Bei
einer Löschung bleibt die Einschränkung der Verarbeitung bis zur Ausführung
bestehen; hat ein späterer ärztlicher Eintrag die Aufbewahrung der Dokumentation
verlängert, folgt ihr Aufschub dem neuen Datum.

Offene Geschäftsvorgänge (Prüfbericht 2026-10-01, Punkt 6): Solange für den
Patienten ein Auftrag läuft (aktiv oder pausiert), eine Rechnung nicht beglichen ist
(auch ein Rechnungsentwurf) oder eine bezahlte Anzahlung noch nicht mit einer
Schlussrechnung verrechnet ist, wird die Löschung nicht ausgeführt; das System
nennt die offenen Aufträge und Rechnungen. Der Antrag bleibt bestehen und kann mit
Begründung zurückgestellt oder abgelehnt werden.

Aufbewahrung der ärztlichen Dokumentation: Jeder Antrag übernimmt bei der Anlage
das Datum, bis zu dem die medizinische Dokumentation des Patienten aufzubewahren
ist (`clinical_retention_until`, § 630f Abs. 3 BGB). Solange diese Frist läuft,
besteht kein Löschanspruch (Art. 17 Abs. 3 lit. b DSGVO): Die Löschung wird weder
genehmigt noch ausgeführt; das System nennt Datum und Rechtsgrundlage. An die Stelle der Löschung tritt die Einschränkung
der Verarbeitung (Art. 18 DSGVO, § 35 Abs. 3 BDSG): „Sperren“ stellt den Antrag bis
zum Fristende zurück und schränkt die Verarbeitung der Akte ein; alternativ wird
der Antrag mit dieser Begründung abgelehnt.

Die Ausführung

- anonymisiert die Stammdaten einschließlich Passnummer, Warnhinweisen,
  Intake-Profil und Lead-Kopie,
- anonymisiert die zugehörige Anfrage (Lead),
- löscht die gespeicherten Dateien des Patienten und alles, was aus ihnen abgeleitet
  ist (extrahierter Text, Übersetzungen, Entwürfe des klinischen Imports,
  Vorlagenbelegung, als eigenes Dokument erzeugte Übersetzungen samt Datei und Text
  in allen Versionen), und entfernt Namen von den Dokumenten (Dokumentname wird zur
  Dokumentart, Dateiname, Notizen, genannte Personen) – auch bei Dokumenten, deren
  Datei schon früher gelöscht wurde,
- löscht die Angehörigen und Vertreter, die kein Geschäftsvorgang nennt; ein
  Angehöriger, der Zahler, Rechnungsempfänger oder Vertragspartei einer Rechnung,
  eines Auftrags oder eines Rahmenvertrags ist, bleibt nur mit Name und
  Rechnungsanschrift (ohne Telefon, Notizen, Notfall- und Standardzahler-Kennzeichen);
  ebenso Einträge anderer Patienten, die mit der gelöschten Akte verknüpft sind,
- leert in der Auftragsvorbereitung die Kopien der Stammdaten und der Identität
  (Entwurf, bestätigte Angaben, Prüfprotokoll, Bestätigungsstand, gespeicherter
  Kontext der Auftragsdokumente); Inhalt des Auftrags und GwG-Angaben bleiben,
- löscht weitere Kontaktdaten, die Identitätsangaben importierter Medikationspläne
  und die Benachrichtigungen, die den Patienten oder seine gelöschten Dokumente
  nennen,
- redigiert Nachrichten samt Anhängen und deaktiviert und anonymisiert den
  Portalzugang des Patienten (und einen Elternzugang, der nur zu ihm führt),
- widerruft Zuweisungen und Einwilligungen,
- ersetzt in den Freitexten der Aufgaben und Termine des Patienten (Titel,
  Beschreibung, Ort, Notizen, Kommentare, Checklisten, Kommunikation mit der Klinik,
  Dolmetscherberichte, Terminanfragen) jede Nennung des Patienten – Namen,
  Patientennummer, E-Mail, Telefonnummern, Pass- und Versicherungsnummer, Straße,
  Notfallkontakt – durch die Anonymisierungskennung; Termine, Status, Stunden und
  Beträge bleiben für die Geschäftsunterlagen; die Benachrichtigungen zu diesen
  Aufgaben und Terminen werden gelöscht. Ein Text mit Längengrenze wird nach der
  Ersetzung auf die Grenze des Feldes gekürzt, die Löschung scheitert daran nicht.
  Begriffe unter 2 Zeichen (etwa ein Vorname aus einem Buchstaben) werden bewusst
  nicht ersetzt,
- ersetzt in den gemeinsamen internen Notizen (auch archivierten), die keinem
  Patienten zugeordnet sind, nur die eindeutigen Merkmale (vollständiger Name,
  Patientennummer, E-Mail, Telefonnummern, Pass- und Versicherungsnummer,
  Notfallkontakt), nicht Vor- oder Nachname allein und nicht die Straße; Anhänge
  dieser Notizen werden nicht geprüft,
- löscht die Dateien der Anhänge an den Aufgaben des Patienten wie die Dateien
  gelöschter Dokumente; der Eintrag bleibt mit Typ, Größe, Hochlader, Datum und
  Löschvermerk, der Dateiname wird neutral („erased-file“ mit der Endung),
- ersetzt dieselben Merkmale auch im Ereignisverlauf der Aufgaben des Patienten
  (früherer Text bearbeiteter oder gelöschter Kommentare und Checklistenpunkte,
  Dateinamen der Anhänge, frühere Titel), mit denselben Längengrenzen
  (Entscheidung des Inhabers vom 12.10.2026). Der Verlauf ist sonst nur
  fortschreibbar; die Ausnahme gilt nur innerhalb der Löschtransaktion
  (transaktionslokale Einstellung `gmed.dsgvo_erasure`), nur für Textwerte der
  Ereignisdaten, nie für das Löschen von Einträgen oder andere Spalten; die
  Löschung selbst wird im unveränderlichen Audit-Log festgehalten
  (`dsgvo_anonymize`, Zähler `task_events`),
- behält Rechnungen (mit dem festgeschriebenen Empfänger), Verträge und Aufträge
  (Art. 17 Abs. 3 lit. b DSGVO). Ist der gelöschte Patient selbst Zahler der
  Rechnung oder des Auftrags eines anderen Patienten (Patientenakte als Zahler),
  behalten ausgestellte Rechnungen ihren festgeschriebenen Empfänger; Entwürfe und
  Aufträge zeigen danach die Anonymisierungskennung (bewusst so entschieden).

Das Löschen einer einzelnen gespeicherten Datei („Datei endgültig löschen“) entfernt
ebenso den extrahierten Text, die Übersetzungstexte, die Import-Entwürfe, das
Ergebnis der automatischen Benennung und die als eigene Dokumente erzeugten
Übersetzungen (Datei und Text, alle Versionen; Löschgrund
`source_document_deleted`); Metadaten und Versionsgeschichte bleiben. Wurde eine
solche Übersetzung bereits versendet oder unterschrieben, ist sie Nachweis der
Übermittlung: dann bleiben die Datei und ihre Übersetzungen erhalten (Hinweis im
System). Dasselbe Verfahren gilt bei der Löschung einer Anfrage (Lead): Übersetzungen
ihrer Dokumente werden mitgelöscht, auch wenn sie weder der Anfrage noch einem
Patienten zugeordnet sind; ebenso, wenn die anfragende Person, ein Zahler über
seinen Link oder die Person beim Entfernen eines Vertreters ein Hochladen im
Kabinett vor der Prüfung zurückzieht.

Verbleibende Lücke: strukturierte medizinische Einträge (Diagnosen, Medikation,
Labor) bleiben ohne Personenbezug zum anonymisierten Datensatz bestehen. Ob das als
Anonymisierung genügt, ist mit dem DSB zu bewerten; seltene Diagnosen können
reidentifizierbar sein.

## Mitteilung an Empfänger (Art. 19)

Wurden Daten an Kliniken oder andere Empfänger weitergegeben, sind diese über
Berichtigung, Löschung oder Einschränkung zu informieren. Das System zeigt je Patient alle Empfänger (Leistungserbringer, interner Zugriff,
Signaturdienst) auf der Compliance-Seite; die Mitteilung erfolgt manuell und wird
am Antrag als Schritt „Empfänger informiert“ vermerkt.
