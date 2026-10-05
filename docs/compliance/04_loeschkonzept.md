# Löschkonzept (Art. 5 Abs. 1 lit. e, Art. 17 DSGVO)

Entwurf, Stand 2026-09-17. Aufbau nach DIN 66398: Datenart, Frist, Startzeitpunkt,
Umsetzung. Fristen in eckigen Klammern legt die Organisation mit dem DSB fest.

| Datenart | Frist | Beginn | Umsetzung im System |
|---|---|---|---|
| Anfragen (Leads) ohne Qualifizierung und ohne unterschriebene Einwilligung | 14 Tage (`unqualified_lead_retention_days`) | Anlage der Anfrage, frühestens Start der Regel (`unqualified_lead_retention_effective_at`) | automatisch, täglich (`spawn_lead_purger`): Löschung aller Dokumente und Dateien, der Anhänge und des Interessenten-Datensatzes, Rücknahme des offenen Auftrags, Deaktivierung und Anonymisierung des mit der Anfrage angelegten Patientenzugangs, Widerruf der Elternzugänge (ein Elternzugang ohne weitere Anfrage oder Patientenakte wird ebenso deaktiviert und anonymisiert), Löschung der Portal-Angaben (Feldmarkierungen, Sendezeitpunkt, hochgeladene Unterlagen) und des Protokolls der Zugangs-E-Mails (`portal_login_emails`: Empfängeradresse, Zeitpunkt, Sprache; der Inhalt wird nie gespeichert); die Anfrage bleibt als leerer Zähldatensatz ohne Personenbezug. Die im Portal erteilte Einwilligung „Bearbeitung der Anfrage“ hält die Frist nicht an – nur die unterschriebene DSGVO-Einwilligung. Hinweis an die zuständige Person 3 Tage vorher. Nicht automatisch, wenn eine Rechnung existiert (§ 147 AO) – dann Meldung zur Entscheidung |
| Im Patientenportal erteilte Einwilligungen einer Anfrage (`consent_records`: Gesundheitsdaten Art. 9, Bearbeitung der Anfrage) | **offen** (Vorschlag: 3 Jahre nach Widerruf bzw. Ende der Anfrage, Nachweis nach Art. 7 Abs. 1 DSGVO) | Widerruf bzw. Löschung der Anfrage | bleiben bei der Löschung der Anfrage als Nachweis erhalten (Zeitpunkt, Textversion, Text, verknüpfter – dann anonymisierter – Zugang); bei Umwandlung in eine Patientenakte dieser zugeordnet; Löschweg nach Ablauf **offen** |
| Nicht zustande gekommene Anfragen (Leads), übrige Fälle | 180 Tage | Archivierung | automatisch, täglich (`spawn_lead_purger`, Einstellung `cleanup_archived_leads_days`); Anonymisierung der Identitätsfelder, Löschung der Dokumente, Dateien und Anhänge, Deaktivierung und Anonymisierung des Patientenzugangs der Anfrage |
| Patientenakte, medizinische Unterlagen | 1095 Tage (`patient_file_retention_days`) | Akte auf „inaktiv“ gesetzt (`inactive_since`) | täglicher Lauf legt einen Löschantrag im Compliance-Register an; Prüfung auf Aufbewahrungspflichten und Ausführung durch CEO/IT. Nicht solange die ärztliche Dokumentation aufzubewahren ist (`clinical_retention_until`) und nicht erneut, wenn der Antrag für dieselbe Inaktivitätsphase begründet abgelehnt wurde |
| Rechnungen, Buchungsbelege | 8 Jahre (Belege) / 10 Jahre (Bücher) | Ende des Kalenderjahres | von der Löschung ausgenommen (§ 147 AO); nach Ablauf **offen** |
| Zahlererklärung einer Anfrage („Wer zahlt“: Herkunft der Mittel, wirtschaftlich Berechtigter, Daten des Kostenübernehmers, `lead_payer_declarations`) | nicht zustande gekommen: wie die Anfrage; zustande gekommen: 5 Jahre nach Ende der Geschäftsbeziehung (§ 8 Abs. 4 GwG) | Anonymisierung der Anfrage bzw. Ende der Geschäftsbeziehung | bei Anonymisierung/Löschung einer nicht konvertierten Anfrage mitgelöscht; nach der Konvertierung der Patientenakte zugeordnet (`patient_id`) und mit ihr aufbewahrt; Löschung nach Ablauf **offen** |
| Eigene GwG-Angaben einer Anfrage aus dem Patientenportal (`lead_gwg_declarations`: Geburtsort und -land, Ausweisdokument, Angaben zu PEP, Hochrisiko-Drittstaat und Sanktionsbezug, Bestätigung der Richtigkeit) samt hochgeladener Ausweiskopie | nicht zustande gekommen: wie die Anfrage; zustande gekommen: 5 Jahre nach Ende der Geschäftsbeziehung (§ 8 Abs. 4 GwG) | Anonymisierung der Anfrage bzw. Ende der Geschäftsbeziehung | bei Löschung/Anonymisierung einer nicht konvertierten Anfrage in derselben Transaktion mitgelöscht (`purge_portal_intake_in_tx`, `anonymize_lead_pii`); die Ausweiskopie wird mit den Dokumenten der Anfrage gelöscht; nach der Konvertierung bleiben die Angaben bei der Geschäftsbeziehung wie die Zahlererklärung; Löschung nach Ablauf **offen** |
| Zahler- und Empfängerdaten ausgestellter Rechnungen (`recipient_snapshot`, `payer_*`) | wie die Rechnung (8 / 10 Jahre) | Ende des Kalenderjahres | mit der Ausstellung festgeschrieben (Datenbank-Trigger); die Anonymisierung des Patienten und das Ändern des Angehörigen lassen sie unverändert (Art. 17 Abs. 3 lit. b DSGVO); ein Angehöriger, an den ausgestellte Rechnungen adressiert sind, kann nicht gelöscht werden; nach Ablauf **offen** |
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
ablehnen oder zurückstellen. Die Ausführung

- anonymisiert die Stammdaten einschließlich Passnummer, Warnhinweisen,
  Intake-Profil und Lead-Kopie,
- anonymisiert die zugehörige Anfrage (Lead),
- löscht die gespeicherten Dateien des Patienten und redigiert Nachrichten samt
  Anhängen,
- widerruft Zuweisungen und Einwilligungen,
- behält Rechnungen, Verträge und Aufträge (Art. 17 Abs. 3 lit. b DSGVO).

Verbleibende Lücke: strukturierte medizinische Einträge (Diagnosen, Medikation,
Labor) bleiben ohne Personenbezug zum anonymisierten Datensatz bestehen. Ob das als
Anonymisierung genügt, ist mit dem DSB zu bewerten; seltene Diagnosen können
reidentifizierbar sein.

## Mitteilung an Empfänger (Art. 19)

Wurden Daten an Kliniken oder andere Empfänger weitergegeben, sind diese über
Berichtigung, Löschung oder Einschränkung zu informieren. Das System zeigt je Patient alle Empfänger (Leistungserbringer, interner Zugriff,
Signaturdienst) auf der Compliance-Seite; die Mitteilung erfolgt manuell und wird
am Antrag als Schritt „Empfänger informiert“ vermerkt.
