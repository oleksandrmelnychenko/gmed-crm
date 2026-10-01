# Löschkonzept (Art. 5 Abs. 1 lit. e, Art. 17 DSGVO)

Entwurf, Stand 2026-09-17. Aufbau nach DIN 66398: Datenart, Frist, Startzeitpunkt,
Umsetzung. Fristen in eckigen Klammern legt die Organisation mit dem DSB fest.

| Datenart | Frist | Beginn | Umsetzung im System |
|---|---|---|---|
| Anfragen (Leads) ohne Qualifizierung und ohne unterschriebene Einwilligung | 14 Tage (`unqualified_lead_retention_days`) | Anlage der Anfrage, frühestens Start der Regel (`unqualified_lead_retention_effective_at`) | automatisch, täglich (`spawn_lead_purger`): Löschung aller Dokumente und Dateien, der Anhänge und des Interessenten-Datensatzes, Rücknahme des offenen Auftrags; die Anfrage bleibt als leerer Zähldatensatz ohne Personenbezug. Hinweis an die zuständige Person 3 Tage vorher. Nicht automatisch, wenn eine Rechnung existiert (§ 147 AO) – dann Meldung zur Entscheidung |
| Nicht zustande gekommene Anfragen (Leads), übrige Fälle | 180 Tage | Archivierung | automatisch, täglich (`spawn_lead_purger`, Einstellung `cleanup_archived_leads_days`); Anonymisierung der Identitätsfelder, Löschung der Dokumente, Dateien und Anhänge |
| Patientenakte, medizinische Unterlagen | 1095 Tage (`patient_file_retention_days`) | Akte auf „inaktiv“ gesetzt (`inactive_since`) | täglicher Lauf legt einen Löschantrag im Compliance-Register an; Prüfung auf Aufbewahrungspflichten und Ausführung durch CEO/IT. Nicht solange die ärztliche Dokumentation aufzubewahren ist (`clinical_retention_until`) und nicht erneut, wenn der Antrag für dieselbe Inaktivitätsphase begründet abgelehnt wurde |
| Rechnungen, Buchungsbelege | 8 Jahre (Belege) / 10 Jahre (Bücher) | Ende des Kalenderjahres | von der Löschung ausgenommen (§ 147 AO); nach Ablauf **offen** |
| Zahler- und Empfängerdaten ausgestellter Rechnungen (`recipient_snapshot`, `payer_*`) | wie die Rechnung (8 / 10 Jahre) | Ende des Kalenderjahres | mit der Ausstellung festgeschrieben (Datenbank-Trigger); die Anonymisierung des Patienten und das Ändern des Angehörigen lassen sie unverändert (Art. 17 Abs. 3 lit. b DSGVO); ein Angehöriger, an den ausgestellte Rechnungen adressiert sind, kann nicht gelöscht werden; nach Ablauf **offen** |
| Verträge, Aufträge, Geschäftsbriefe | 6 Jahre | Ende des Kalenderjahres | von der Löschung ausgenommen (§ 257 HGB); nach Ablauf **offen** |
| Personalakten (je Kategorie, `personnel_document_categories`) | 3 bis 8 Jahre: Entgeltabrechnung 8 J. (§ 147 AO), Lohnsteuer 6 J. (§ 41 EStG), Stundenzettel und Sozialversicherung 6 J. (§ 28f SGB IV), Verträge und Kündigung 6 J. nach Austritt, Arbeitsunfähigkeit, Abmahnung 3 J., übrige 3 J. nach Austritt [vom Steuerberater zu bestätigen] | Ende des Kalenderjahres des Dokuments bzw. des Austritts | Löschung nur durch die Geschäftsführung mit Begründung, nach Fristablauf, ohne Legal Hold und erst nach Freischaltung (`personnel_retention_deletion_enabled`, Standard: aus); die Datei wird entfernt, der Datensatz bleibt als Nachweis mit Prüfsumme erhalten |
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
