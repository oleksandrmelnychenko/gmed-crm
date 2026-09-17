# Auftragsverarbeiter und Empfänger (Art. 28, 44 ff. DSGVO)

Entwurf, Stand 2026-09-17, abgeleitet aus den ausgehenden Verbindungen des Systems.
Spalte „AVV“ füllt die Organisation aus; ohne unterschriebenen Vertrag ist die
Weitergabe nicht privilegiert.

| Dienstleister | Rolle | Welche Daten | Sitz | AVV | Bemerkung |
|---|---|---|---|---|---|
| Hetzner Online GmbH | Auftragsverarbeiter (Hosting, Object Storage) | gesamter Bestand; Backups nur verschlüsselt | DE | [ ] | AVV im Kundenkonto abschließen; zertifiziert nach ISO 27001 |
| Skribble AG | Auftragsverarbeiter (elektronische Signatur) | Name, E-Mail der Unterzeichner, Vertrags-PDF einschließlich Einwilligungen | CH | [ ] | Angemessenheitsbeschluss; zusätzlich § 203 StGB-Verpflichtung prüfen |
| DATEV eG | Auftragsverarbeiter bzw. Empfänger über den Steuerberater | Buchungsdaten, Debitoren | DE | [ ] | derzeit nur lesender Zugriff; Tokens verschlüsselt gespeichert |
| Steuerberater | eigener Verantwortlicher (Berufsgeheimnisträger) | Rechnungsdaten | DE | entfällt | Rechtsgrundlage Art. 6 Abs. 1 lit. c |
| Let's Encrypt (ISRG) | kein Personenbezug | Domain, Admin-E-Mail | US | entfällt | nur Zertifikatsausstellung |
| OpenAI | **gesperrt** | — | US | — | nur nach dokumentierter Freigabe (`GMED_MEDICATION_AI_DATA_TRANSFER_APPROVED`), SCC und DSFA; Standard ist aus |
| BfArM, G-BA | kein Personenbezug | nur Abruf öffentlicher Arzneimitteldaten | DE | entfällt | — |

Selbst betrieben, daher keine Weitergabe: OCR und Dokumentenanalyse,
Rechnungserkennung, Monitoring (Prometheus, Loki), Virenscanner.

Das System versendet selbst keine E-Mails, SMS oder Messenger-Nachrichten; ein
Versand über das Postfach eines Beschäftigten läuft über dessen E-Mail-Anbieter,
der hier zu ergänzen ist: [Anbieter, Sitz, AVV].

## Empfänger, die keine Auftragsverarbeiter sind

Kliniken, Ärzte, Hotels, Transportdienste und freie Dolmetscher entscheiden selbst
über ihre Verarbeitung. Für jede Weitergabe braucht es die Einwilligung des
Patienten; das System hält sie je Dokument und Kanal in `document_shares` fest und
zieht offene Freigaben beim Widerruf zurück. Bei Empfängern außerhalb der EU ist
zusätzlich Art. 49 Abs. 1 lit. a oder b DSGVO zu dokumentieren.

## Kontrolle

Einmal jährlich je Auftragsverarbeiter: Zertifikate oder Prüfberichte ablegen,
Unterauftragnehmer-Liste prüfen, Ergebnis hier mit Datum vermerken.
