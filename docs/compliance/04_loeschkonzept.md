# Löschkonzept (Art. 5 Abs. 1 lit. e, Art. 17 DSGVO)

Entwurf, Stand 2026-09-17. Aufbau nach DIN 66398: Datenart, Frist, Startzeitpunkt,
Umsetzung. Fristen in eckigen Klammern legt die Organisation mit dem DSB fest.

| Datenart | Frist | Beginn | Umsetzung im System |
|---|---|---|---|
| Nicht zustande gekommene Anfragen (Leads) | 180 Tage | Archivierung | automatisch, täglich (`spawn_lead_purger`, Einstellung `cleanup_archived_leads_days`); Anonymisierung der Identitätsfelder, Löschung der Anhänge |
| Patientenakte, medizinische Unterlagen | [z. B. 3 Jahre] | Ende der Betreuung | **offen:** kein automatischer Lauf; heute nur auf Antrag oder manuell über das Compliance-Register |
| Rechnungen, Buchungsbelege | 8 Jahre (Belege) / 10 Jahre (Bücher) | Ende des Kalenderjahres | von der Löschung ausgenommen (§ 147 AO); nach Ablauf **offen** |
| Verträge, Aufträge, Geschäftsbriefe | 6 Jahre | Ende des Kalenderjahres | von der Löschung ausgenommen (§ 257 HGB); nach Ablauf **offen** |
| Direktnachrichten und Anhänge | [Frist] | Versand | automatische Bereinigung abgelaufener Nachrichten und verwaister Anhänge |
| Audit-Log (Fachereignisse) | 365 Tage | Ereignis | automatisch (`cleanup_audit_log_days`) |
| Technische Zugriffszeilen | 3 Tage | Ereignis | automatisch (`cleanup_audit_http_days`) |
| Abgelaufene Tokens | 7 Tage | Ablauf | automatisch |
| Backups | [z. B. 35 Tage] | Erstellung | **offen:** Lifecycle-Regel im Object-Storage-Bucket einrichten und hier vermerken |

## Löschung auf Antrag (Art. 17)

Ablauf im Register: Antrag → Prüfung (Genehmigung, Ablehnung mit Begründung oder
Aufschub wegen Aufbewahrungspflicht mit Datum) → Ausführung. Die Ausführung

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
Berichtigung, Löschung oder Einschränkung zu informieren. Das System zeigt die
Empfänger je Dokument (`document_shares`); die Mitteilung selbst erfolgt heute
manuell und ist im Register zu vermerken. **Offen:** zusammengefasste
Empfängerliste je Patient.
