# Verzeichnis der Verarbeitungstätigkeiten (Art. 30 Abs. 1 DSGVO)

Entwurf, Stand 2026-09-17. Felder in eckigen Klammern ergänzt die Organisation.

**Verantwortlicher:** [Firma, Anschrift, Vertretungsberechtigte]
**Datenschutzbeauftragter:** [Name, Kontakt]
**System:** GMED Console (CRM für die Vermittlung und Begleitung medizinischer Behandlungen)

Rechtsgrundlagen folgen der Zwei-Stufen-Prüfung: Ausnahme nach Art. 9 Abs. 2 und
Rechtsgrundlage nach Art. 6 Abs. 1 DSGVO.

| Nr. | Verarbeitung | Zweck | Betroffene | Datenkategorien | Rechtsgrundlage | Empfänger | Drittland | Löschfrist |
|---|---|---|---|---|---|---|---|---|
| 1 | Anfragen (Leads) | Prüfung und Anbahnung eines Betreuungsvertrags | Interessenten, Angehörige | Stammdaten, Kontakt, Pass, Anliegen, Gesundheitsangaben, Anhänge | Art. 6 Abs. 1 lit. b; Art. 9 Abs. 2 lit. a (Einwilligung im Wizard) | intern | nein | 180 Tage nach Archivierung, automatisch |
| 2 | Patientenakte | Organisation von Terminen, Behandlung, Begleitung | Patienten, Sorgeberechtigte, Notfallkontakte | Stammdaten, Versicherung, Diagnosen, Medikation, Labor, Vitalwerte, Dokumente | Art. 6 Abs. 1 lit. b; Art. 9 Abs. 2 lit. a (unterschriebene Einwilligung, Schweigepflichtentbindung) | Kliniken, Ärzte, Dolmetscher | nur auf Veranlassung des Patienten [prüfen] | Vertragsende + [Frist], danach Löschung nach Dokument 04 |
| 3 | Weitergabe medizinischer Unterlagen | Terminanfrage und Behandlung beim Leistungserbringer | Patienten | medizinische Dokumente | Art. 9 Abs. 2 lit. a; je Kanal eigene Einwilligung | Leistungserbringer (`document_shares`) | [prüfen je Empfänger] | Widerruf jederzeit, wirkt sofort auf offene Freigaben (Kanal-Einwilligung: Freigaben dieses Kanals; Drittweitergabe: alle Freigaben an Leistungserbringer, neue erst nach erneuter Einwilligung) |
| 4 | Verträge und elektronische Signatur | Abschluss von Rahmenvertrag, Auftrag, Einwilligungen (einzeln oder als Dokumentenpaket eines Patienten/Leads) | Patienten, Sorgeberechtigte | Name, E-Mail, Vertragsinhalt als PDF; Einladungsbetreff und -text ohne Gesundheitsdaten | Art. 6 Abs. 1 lit. b; Art. 7 (Nachweis der Einwilligung) | Skribble AG | Schweiz (Angemessenheitsbeschluss) | Signierte PDFs und Signaturnachweise wie der zugrunde liegende Vertrag (6/10 Jahre, § 257 HGB, § 147 AO), von der Löschung nach Art. 17 ausgenommen; Löschung beim Anbieter nach Archivierung vorbereitet, standardmäßig aus |
| 5 | Abrechnung | Rechnungen, Zahlungen, Buchhaltung | Patienten, Kostenträger | Stammdaten, Leistungen, Beträge | Art. 6 Abs. 1 lit. b und c | Steuerberater über DATEV | nein | 8 bzw. 10 Jahre (§ 147 AO) |
| 5a | Zahler, Kostenübernehmer und gesetzliche Vertreter | Vertragsschluss für Minderjährige (Vertragspartner im eigenen Namen, § 328 BGB), Rechnungsstellung an den Zahler, Mahnwesen | Zahler / Kostenübernehmer (Angehörige, andere Patienten, Dritte), gesetzliche Vertreter (Sorgeberechtigte) | Name, Anschrift, E-Mail, Telefon, Beziehung zum Patienten; Rechnungsempfänger als Festschreibung in der ausgestellten Rechnung (keine Gesundheitsdaten) | Art. 6 Abs. 1 lit. b (Vertrag mit dem Vertreter bzw. Kostenübernahme), lit. c (§ 14 UStG, § 147 AO) | Steuerberater über DATEV (Rechnungsdaten) | nein | mit der Rechnung 8 bzw. 10 Jahre (§ 147 AO, § 257 HGB); Stammdaten des Angehörigen mit der Patientenakte. Informationspflicht nach Art. 14 DSGVO, wenn die Daten vom Patienten stammen: [Informationsblatt für Zahler – offen] |
| 6 | Interne Kommunikation | Abstimmung im Team und mit Patienten | Beschäftigte, Patienten | Nachrichten, Anhänge (verschlüsselt) | Art. 6 Abs. 1 lit. b, f | intern | nein | [Frist], automatische Bereinigung abgelaufener Nachrichten |
| 7 | Benutzerkonten und Protokolle | Betrieb, Sicherheit, Nachweis | Beschäftigte, Dolmetscher | Konto, Rolle, Anmeldungen, Audit-Ereignisse, IP als Hash | Art. 6 Abs. 1 lit. c, f; § 26 BDSG | intern | nein | Audit 365 Tage, technische Zugriffszeilen 3 Tage |
| 8 | Betroffenenanfragen und Datenpannen | Erfüllung der Art. 12–22, 33, 34 DSGVO | Patienten | Anfrage, Entscheidung, Fristen | Art. 6 Abs. 1 lit. c | Aufsichtsbehörde im Meldefall | nein | 3 Jahre nach Abschluss [prüfen] |
| 9 | Personalakten (Personalakte, Entgeltunterlagen) | Nachweis der Beschäftigung und Sozialversicherung (§ 8 BVV, § 28f SGB IV), Lohnsteuer, Arbeitsverhältnis | Beschäftigte, ehemalige Beschäftigte | Name, Personalnummer, Beschäftigungszeitraum, Arbeitsverträge, Stundenzettel, Entgeltabrechnungen, Meldungen, Arbeitsunfähigkeitsbescheinigungen (Gesundheitsdaten), Urlaub, Abmahnungen, Zeugnisse, Schriftverkehr | Art. 6 Abs. 1 lit. b, c; Art. 9 Abs. 2 lit. b; § 26 BDSG | intern (nur Geschäftsführung); Steuerberater und Prüfdienste der Rentenversicherung über den Export; Zeitstempeldienst erhält nur Hashwerte | nein | je Kategorie 3 bis 8 Jahre, siehe [04_loeschkonzept.md](04_loeschkonzept.md) |

**Nicht vorhanden:** Profiling, automatisierte Einzelentscheidungen (Art. 22),
Tracking, Analyse-Cookies. Die KI-Auswertung von Medikationsdaten ist technisch
gesperrt, bis eine Freigabe zur Datenübermittlung dokumentiert ist.

**Technische und organisatorische Maßnahmen:** siehe [01_tom.md](01_tom.md).
