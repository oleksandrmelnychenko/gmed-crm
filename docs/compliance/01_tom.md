# Technische und organisatorische Maßnahmen (Art. 32 DSGVO)

Entwurf, Stand 2026-09-17. Jede Maßnahme nennt, wo sie umgesetzt ist, damit sie
bei einer Prüfung belegt werden kann. „Offen“ markiert bekannte Lücken.

## 1. Vertraulichkeit

| Maßnahme | Umsetzung |
|---|---|
| Zugangskontrolle | Anmeldung mit Argon2id-Passwort-Hash (`crates/server/src/auth/password.rs`); Sperre nach 5 Fehlversuchen für 30 Minuten; Rate-Limit 10 Anfragen/60 s auf Auth-Routen (`rate_limit.rs`). |
| Passwortregeln | Mindestlänge 8, Groß- und Kleinbuchstabe, Ziffer, Sonderzeichen, Ablauf nach 90 Tagen; die letzten fünf Passwörter dürfen nicht wiederverwendet werden. |
| Zweiter Faktor | Authenticator-App (TOTP, RFC 6238) mit versiegeltem Geheimnis und Replay-Schutz (`auth/totp.rs`, `routes/totp.rs`); für CEO, IT-Admin und Patientenmanager Pflicht mit blockierendem Hinweis bis zur Einrichtung (`mfa_totp_required_roles`); Zurücksetzen durch CEO beendet alle Sitzungen. Zusätzlich weiterhin Anmeldefreigabe durch Administrator je Benutzer. |
| Sitzungen | Access-Token 60 Minuten, Refresh-Token mit Wiederverwendungserkennung, serverseitige Sperrliste; automatische Abmeldung nach 30 Minuten ohne Eingabe (`frontend/src/lib/idle-logout.ts`). |
| Zugriffskontrolle (Need-to-know) | Zehn Rollen; Patientenmanager, Dolmetscher und Concierge sehen nur zugewiesene Patienten (`access::requires_patient_assignment`); Feldrichtlinien je Rolle (`field_access_policies`). |
| Trennung | DEV enthält ausschließlich synthetische Daten; getrennte Hosts und Datenbanken für DEV und PROD. |
| Verschlüsselung bei Übertragung | TLS über Caddy mit HSTS (2 Jahre); ausgehende Verbindungen nur über rustls. |
| Verschlüsselung gespeicherter Daten | AES-256-GCM mit Schlüsselrotation für Direktnachrichten, Chat-Anhänge, TOTP-Geheimnisse, Zugangsdaten zu Skribble/DATEV und alle hochgeladenen Dokumentdateien (`crypto.rs`, Hintergrundlauf versiegelt Altbestand und rotiert Schlüssel). **Offen:** sensible Spalten in der Datenbank (Passnummer, Diagnosen) liegen im Klartext; Schutz über Zugriffskontrolle, Datenträger und verschlüsselte Backups. |
| Pseudonymisierung | IP-Adressen im Audit-Log nur als gesalzener SHA-256-Hash. |

## 2. Integrität

| Maßnahme | Umsetzung |
|---|---|
| Protokollierung | Unveränderliches `audit_log` (DB-Trigger verhindert UPDATE/DELETE); Lesezugriffe auf Patienten, Dokument-Downloads, Einwilligungen, Betroffenenanfragen und Datenpannen als Fachereignisse, Aufbewahrung 365 Tage. |
| Eingabekontrolle | Jede Änderung mit Benutzer, Zeit, altem und neuem Wert. |
| Schadsoftware | Pflicht-Scan aller Uploads mit ClamAV in PROD; der Server startet ohne Scanner nicht (`file_scan.rs`). |
| Software-Lieferkette | PROD führt nur signierte Images aus (cosign), gebaut in CI mit `clippy -D warnings`, Tests und Format-Prüfung. |

## 3. Verfügbarkeit und Belastbarkeit

| Maßnahme | Umsetzung |
|---|---|
| Datensicherung | Täglich 02:30 UTC Datenbank, 02:45 UTC Dokumentdateien; an der Quelle mit `age` für mehrere Empfänger verschlüsselt, Ablage außerhalb des Hosts (Hetzner Object Storage, DE). Der private Schlüssel liegt nicht auf dem Server. |
| Wiederherstellung | `scripts/restore-postgres.sh`, `scripts/restore-uploads.sh`, jeweils mit Prüflauf vor dem Überschreiben; vierteljährlicher Restore-Drill nach Runbook, Nachweis: [ Datum / Ergebnis ]. Alte Kopien werden nach 35 Tagen automatisch entfernt. |
| Überwachung | Prometheus, Loki und Alertmanager; Alarm bei fehlgeschlagenem oder ausgebliebenem Backup. |
| Aktualisierung | Automatische Sicherheitsupdates des Hosts; Basis-Images werden bei jedem Release neu gezogen. |

## 4. Verfahren zur regelmäßigen Überprüfung

| Maßnahme | Umsetzung |
|---|---|
| Betroffenenrechte | Register für Auskunft, Berichtigung, Löschung, Einschränkung, Übertragbarkeit, Widerspruch und Widerruf der Weitergabe mit Monatsfrist, einmaliger Verlängerung, Identitätsprüfung, Mitteilung an die betroffene Person und an die Empfänger (Art. 19) mit Empfängerliste je Patient (`admin_compliance.rs`). |
| Einschränkung der Verarbeitung | Technisch durchgesetzt: gesperrte Datensätze lassen sich nicht ändern und nicht an Dritte weitergeben (HTTP 423). |
| Datenpannen | Register mit 72-Stunden-Frist und Pflicht zur Dokumentation der Meldeentscheidung (`security_incidents.rs`). |
| Löschung | Siehe [04_loeschkonzept.md](04_loeschkonzept.md); täglicher Lauf legt für abgeschlossene Akten nach Ablauf der Frist Löschanträge zur Prüfung an. |
| Auftragskontrolle | Siehe [03_auftragsverarbeiter.md](03_auftragsverarbeiter.md). |
