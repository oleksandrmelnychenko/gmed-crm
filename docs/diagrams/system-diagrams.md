# System Diagrams — Medical Tourism CRM/ERP

---

## 1. Доменна модель (Entity Relationship)

```mermaid
erDiagram
    Lead ||--o| Patient : "конвертується в"
    Patient ||--o{ PatientAssignment : "призначення"
    Patient ||--o{ Case : "має кейси"
    Patient ||--o{ Order : "має замовлення"
    Patient ||--o{ Document : "має документи"
    Patient ||--o{ Appointment : "має терміни"
    Patient ||--o{ Invoice : "має рахунки"
    Patient ||--o{ ConsentRecord : "згоди DSGVO"
    Patient ||--o{ FeedbackForm : "feedback"

    PatientAssignment }o--|| Staff : "призначений до"

    Case ||--o{ AnamnesisMain : "анамнез"
    Case ||--o{ PainRecord : "болі"
    Case ||--o{ Symptom : "симптоми"
    Case ||--o{ Vorerkrankung : "попередні хвороби"
    Case ||--o{ OperationRecord : "операції"
    Case ||--o{ Allergy : "алергії"
    Case ||--o{ Medication : "медикаменти"
    Case ||--o| VegetativeAnamnese : "вегетативний"
    Case ||--o| ImpfStatus : "вакцинація"

    Order ||--|| FrameworkContract : "базується на"
    Order ||--o{ OrderLeistung : "послуги"
    Order ||--o| Quote : "кошторис (KV)"
    Order ||--o{ Invoice : "рахунки"
    Order ||--o{ Appointment : "терміни"
    Order ||--o{ Checklist : "чеклісти"

    Provider ||--o{ ProviderDoctor : "лікарі"
    Provider ||--o{ ServiceCatalog : "каталог послуг"
    Provider ||--o{ CooperationContract : "договір кооперації"
    Provider ||--o{ ProviderTemplate : "шаблони"

    Appointment ||--|| Patient : "пацієнт"
    Appointment ||--|| Provider : "провайдер"
    Appointment }o--o| Staff : "перекладач"
    Appointment ||--|| Order : "замовлення"
    Appointment ||--o{ AppointmentChecklist : "чеклісти"
    Appointment ||--o{ InterpreterReport : "звіти перекл."
    Appointment ||--o{ Reminder : "нагадування"

    Invoice ||--o{ InvoiceLineItem : "позиції"
    Invoice ||--o{ Payment : "оплати"
    Invoice ||--o{ ExternalBelege : "зовнішні квитанції"

    Document ||--o{ ShareGrant : "дозволи шерінгу"
    Document ||--o{ DocumentVersion : "версії"

    Staff ||--o{ Task : "завдання"
    Staff ||--|| Role : "роль"

    AuditEvent }o--|| Staff : "хто"

    Lead {
        uuid id PK
        string name
        string contact_data
        string source
        enum status "new|qualified|converted|archived"
        boolean compliance_signed
    }

    Patient {
        uuid id PK
        string patient_id "авто-генерація"
        string title
        string first_name
        string last_name
        date birth_date
        enum gender
        string nationality
        string languages
        json contacts "адреси телефони emails"
        json insurance "Versichertendaten"
        json related_persons "родичі екстрений контакт"
        json legal_status "DSGVO Schweigepflicht Vertrag"
        text notes
    }

    Case {
        uuid id PK
        string case_id "авто-генерація"
        uuid patient_id FK
        uuid manager_id FK
        enum status "open|in_progress|closed"
        text hauptanfragegrund
        text aktuelle_anamnese
        text zuweiser
    }

    PainRecord {
        uuid id PK
        uuid case_id FK
        text location "Wo"
        text seit_wann
        text ursache
        text qualitaet
        text kontinuitaet
        text entwicklung
        int nrs_aktuell "1-10"
        int nrs_anfang "1-10"
        text dauer_anfang
        text dauer_aktuell
        text ausstrahlung
        text auftreten
    }

    Medication {
        uuid id PK
        uuid case_id FK
        string handelsname
        string wirkstoff
        decimal dosis
        string dosis_einheit
        string einnahmeschema "x-x-x-x"
        enum darreichungsform "Tabl Loesung Spray Pen"
        string einheit
        text anmerkung
        text grund
        date seit "MM.YYYY"
        uuid verordnender_arzt FK
        enum typ "permanent|temporary"
        date expiry_date "для temporary"
    }

    Order {
        uuid id PK
        uuid patient_id FK
        uuid framework_contract_id FK
        enum phase "discovery|intake|execution|closure|followup"
        json leistungen
        text conditions
        boolean signed_patient
        boolean signed_agency
        date signed_at
    }

    Provider {
        uuid id PK
        string name
        text address
        string phones
        string emails
        enum type "medical|non_medical"
    }

    Appointment {
        uuid id PK
        uuid patient_id FK
        uuid provider_id FK
        uuid order_id FK
        uuid interpreter_id FK
        enum type "medical|non_medical|internal"
        date date
        time time
        string location
        string category
        string art
        enum checklist_phase "preparation|execution|followup"
    }

    Invoice {
        uuid id PK
        uuid patient_id FK
        uuid order_id FK
        enum type "rechnung|kv|vorkasse|zwischen|mahnung"
        enum status "draft|sent|paid|overdue|mahnung1|mahnung2|inkasso"
        decimal total
        decimal vat
        date due_date
        int page_count
    }

    Document {
        uuid id PK
        uuid patient_id FK
        string auto_name "маска"
        enum art
        enum status "draft|active|archived"
        enum visibility "internal|freigegeben|patient_visible"
        date created_at
        string klinik
        string ursprung
    }

    Staff {
        uuid id PK
        string name
        enum role
        uuid assigned_by FK
    }

    InterpreterReport {
        uuid id PK
        uuid appointment_id FK
        uuid interpreter_id FK
        decimal hours
        text report
        enum approval_status "pending|approved|rejected"
        uuid approved_by FK
    }
```

---

## 2. Бізнес-процес: Клієнтська подорож

```mermaid
flowchart TD
    START([Kunde/Lead kontaktiert uns]) --> DECIDE{Lead oder Kunde?}

    DECIDE -->|Lead| SALES1[1-е Vertriebsgespräch<br/>Дані, потреби, Compliance]
    DECIDE -->|Kunde| KUNDE_CHECK[Bedarfserfassung<br/>Anamnese-Update<br/>Daten-Update]

    %% LEAD PATH
    SALES1 --> CONTACT[Kontaktdaten<br/>Personalausweis<br/>Compliance-Dokumente]
    CONTACT --> COMPL{Compliance<br/>unterschrieben?}
    COMPL -->|Nein| RUECK1[Rücksprache<br/>Offene Fragen klären]
    RUECK1 --> COMPL
    COMPL -->|Ja| ANAMNESE[Detaillierte Anamnese<br/>Daten & Dokumente<br/>Fall-Evaluation<br/>Leistungsplanung]
    ANAMNESE --> RUECK2[Rücksprache mit Lead<br/>Preiskalkulationen<br/>Leistungspaket<br/>Leistungsvertrag<br/>1. Auftrag]
    RUECK2 --> QUAL{Lead<br/>qualifiziert?}
    QUAL -->|Nein| DELETE1[Datenlöschung]
    QUAL -->|Ja| SEND[LV + Auftrag +<br/>KV zusenden]
    SEND --> SIGNED{LV + Auftrag<br/>unterschrieben?<br/>KV bezahlt?}
    SIGNED -->|Nein| DELETE2[Datenlöschung]
    SIGNED -->|Ja| CONVERT[Lead → Kunde<br/>Konvertierung<br/>PM Zuweisung]

    %% KUNDE PATH
    KUNDE_CHECK --> VALID{Stammdaten<br/>Compliance<br/>Vertrag gültig?}
    VALID -->|Nein| UPDATE[Update Daten] --> VALID
    VALID -->|Ja| DEBT{Schulden?}
    DEBT -->|Ja| SCHULDEN[Schulden-<br/>management]
    DEBT -->|Nein| AUFTRAG[Auftrag erstellen]
    AUFTRAG --> FREIGABE{Freigabe<br/>Abrechnung?}
    FREIGABE -->|Ja| SEND2[Auftrag + KV<br/>zusenden]
    FREIGABE -->|Nein| PAKET{Von Paket-<br/>leistung<br/>abgedeckt?}
    PAKET -->|Ja| PLAN
    PAKET -->|Nein| SEND2
    SEND2 --> SIGNED2{Unterschrieben?<br/>Bezahlt?}
    SIGNED2 -->|Ja| PLAN

    %% PLANNING
    CONVERT --> PLAN[Untersuchungs-/<br/>Behandlungsplan<br/>erstellen]
    PLAN --> KV[Kostenvoranschlag<br/>erstellen]
    KV --> NICHTMED{Nicht-med.<br/>Leistungen<br/>nötig?}
    NICHTMED -->|Ja| ORG_NM[Organisation<br/>nicht-med. Leistungen]
    NICHTMED -->|Nein| TERMINE

    ORG_NM --> TERMINE[Termine<br/>vereinbaren]
    TERMINE --> SEND_PLAN[Plan an Kunde<br/>senden + Rücksprache]
    SEND_PLAN --> KORR{Korrektur<br/>nötig?}
    KORR -->|Ja| PLAN
    KORR -->|Nein| FREIG[Plan freigeben]

    %% PREPARATION
    FREIG --> PREP1[Med. Termine<br/>bestätigen]
    FREIG --> PREP2[Dolmetscher<br/>zuweisen + Briefing]
    FREIG --> PREP3[Nicht-med.<br/>bestätigen]
    PREP1 & PREP2 & PREP3 --> DOCS[Vorbereitungs-<br/>unterlagen senden]

    %% EXECUTION
    DOCS --> ARRIVAL([Kundenankunft])
    ARRIVAL --> EXEC1[Behandlungsplan<br/>durchführen]
    ARRIVAL --> EXEC2[Concierge-Service]
    ARRIVAL --> EXEC3[Dolmetscher-/<br/>Betreuungsleistungen]
    EXEC1 & EXEC2 & EXEC3 --> ABSCHLUSS[Behandlungs-<br/>abschluss vor Ort]

    %% POST-CARE
    ABSCHLUSS --> BEFUNDE[Befunde + Arztbriefe<br/>weiterleiten]
    BEFUNDE --> TRANSLATE[Befunde<br/>übersetzen]
    TRANSLATE --> BILLING[Abrechnung]
    BILLING --> FOLLOWUP[Follow-ups:<br/>1W / 1M / 6M /<br/>1M vor Paketablauf /<br/>gemäß Anordnungen]
    FOLLOWUP --> END([Ende])

    %% STYLES
    style START fill:#4CAF50,color:#fff
    style END fill:#2196F3,color:#fff
    style DELETE1 fill:#f44336,color:#fff
    style DELETE2 fill:#f44336,color:#fff
    style ARRIVAL fill:#FF9800,color:#fff
    style CONVERT fill:#9C27B0,color:#fff
```

---

## 3. Анамнестичний флоу

```mermaid
flowchart TD
    START([Case ID генерація]) --> ID_OK{Case ID<br/>створено?}
    ID_OK -->|Ні| ERSATZ[Ersatzoption]
    ID_OK -->|Ja| MASK[Anamnesemaske<br/>відкрито]

    MASK --> S1[Hauptanfragegrund<br/>Freitext]
    S1 --> C1{Complete?}
    C1 --> S2[Aktuelle Anamnese<br/>Freitext lang]
    S2 --> C2{Complete?}
    C2 --> S3[Zuweiser<br/>Freitext]
    S3 --> C3{Complete?}

    C3 --> PAIN{Schmerzen?}
    PAIN -->|Ja| PAIN_ADD["Add Schmerz (+)<br/>12 полів:<br/>Wo, Seit wann, Ursache,<br/>Qualität, Kontinuität,<br/>Entwicklung, NRS aktuell,<br/>NRS Anfang, Dauer Anfang,<br/>Dauer aktuell, Ausstrahlung,<br/>Auftreten"]
    PAIN_ADD --> PAIN_MORE{Ще біль?}
    PAIN_MORE -->|Ja| PAIN_ADD
    PAIN_MORE -->|Nein| SYMP
    PAIN -->|Nein| SYMP

    SYMP{Інші<br/>симптоми?}
    SYMP -->|Ja| SYMP_ADD["Add Symptom (+)<br/>Beschreibung +<br/>Fachrichtungsauswahl"]
    SYMP_ADD --> FACH{Фахнапрямок<br/>вибрано?}
    FACH -->|Ja| SUBFLOW["Суб-флоу:<br/>Kardiologie / Gastro /<br/>Ortho / Neuro / ..."]
    FACH -->|Nein| SYMP_MORE
    SUBFLOW --> SYMP_MORE{Ще симптоми?}
    SYMP_MORE -->|Ja| SYMP_ADD
    SYMP_MORE -->|Nein| VOR
    SYMP -->|Nein| VOR

    VOR{Vorerkrankungen?}
    VOR -->|Ja| VOR_ADD["Add (+)<br/>Erkrankung kurz +<br/>Datum MM.YYYY +<br/>Notiz"]
    VOR_ADD --> VOR_MORE{Ще?} -->|Ja| VOR_ADD
    VOR_MORE -->|Nein| OP
    VOR -->|Nein| OP

    OP{Операції?}
    OP -->|Ja| OP_ADD["Add (+)<br/>Datum + Grund +<br/>Arzt (Kontakt) + Notiz"]
    OP_ADD --> OP_MORE{Ще?} -->|Ja| OP_ADD
    OP_MORE -->|Nein| ALLERG
    OP -->|Nein| ALLERG

    ALLERG{Алергії?}
    ALLERG -->|Ja| ALLERG_ADD["Add (+)<br/>Allergie kurz +<br/>Reaktion mittel"]
    ALLERG_ADD --> ALLERG_MORE{Ще?} -->|Ja| ALLERG_ADD
    ALLERG_MORE -->|Nein| IMPF
    ALLERG -->|Nein| IMPF

    IMPF{Impfstatus?}
    IMPF -->|Ja| IMPF_TEXT[Freitext mittel]
    IMPF_TEXT --> MED
    IMPF -->|Nein| MED

    MED{Медикаменти?}
    MED -->|Ja| MED_ADD["Add (+) 10 полів:<br/>Handelsname, Wirkstoff,<br/>Dosis+Einheit, Schema,<br/>Darreichungsform, Einheit,<br/>Anmerkung, Grund,<br/>Seit MM.YYYY, Arzt"]
    MED_ADD --> MED_MORE{Ще?} -->|Ja| MED_ADD
    MED_MORE -->|Nein| VEG
    MED -->|Nein| VEG

    VEG[Vegetative Anamnese:<br/>Appetit/Durst,<br/>Größe cm, Gewicht kg,<br/>Gewichtsveränderungen,<br/>Grund]

    VEG --> DONE([Anamnese Complete])

    style START fill:#4CAF50,color:#fff
    style DONE fill:#2196F3,color:#fff
    style SUBFLOW fill:#FF9800,color:#fff
```

---

## 4. Lifecycle замовлення (Auftrag)

```mermaid
stateDiagram-v2
    [*] --> Entdeckung: Новий пацієнт

    state Entdeckung {
        Erstkontakt --> Erstgespräch: Bedarfserfassung
        Erstgespräch --> Stammdaten: Erfassung
        Stammdaten --> Angebot
        Angebot --> Vertragsabschluss
    }

    Entdeckung --> Auftragserteilung: Договір підписано

    state Auftragserteilung {
        AuftragErstellen --> KVErstellen: Abrechnung
        KVErstellen --> Kostenschätzung: Med. послуги
        Kostenschätzung --> Unterzeichnung: Обидві сторони
        Unterzeichnung --> Vorauszahlung: Якщо потрібно
        Vorauszahlung --> Auftragsfreigabe
    }

    Auftragserteilung --> Durchführung: Auftrag freigegeben

    state Durchführung {
        state "3a Einreise" as EINREISE
        state "3b Aufenthalt" as AUFENTHALT
        state "3c Programm" as PROGRAMM

        EINREISE --> AUFENTHALT
        AUFENTHALT --> PROGRAMM

        state AUFENTHALT {
            Anamnese2 --> Datensammlung
            Datensammlung --> Terminplanung
            Terminplanung --> DolmetscherZuweisung
            DolmetscherZuweisung --> ConciergeOrg
            ConciergeOrg --> ProgrammErstellen
            ProgrammErstellen --> KundeRücksprache
        }
    }

    Durchführung --> Abschluss: Programm beendet

    state Abschluss {
        LeistungenPrüfen --> FreigabeAbrechnung
        FreigabeAbrechnung --> RechnungErstellen
        RechnungErstellen --> BefundeWeiterleiten
        BefundeWeiterleiten --> Übersetzen
    }

    Abschluss --> FollowUp

    state FollowUp {
        state "1 Woche" as W1
        state "1 Monat" as M1
        state "6 Monate" as M6
        state "1M vor Paketablauf" as PAKET
        state "Gemäß Anordnungen" as ARZT

        W1 --> M1
        M1 --> M6
        M6 --> PAKET
        ARZT --> [*]
        PAKET --> [*]
    }
```

---

## 5. Білінг-флоу

```mermaid
flowchart TD
    subgraph SOURCES ["Джерела послуг"]
        PM_LEIST[PM фіксує<br/>надані послуги]
        DOLM_STD[Перекладач<br/>вносить години<br/>termingebunden]
        CONC_STD[Concierge<br/>вносить послуги]
        KOSTEN[Зовнішні рахунки<br/>Kostenübernahmen]
    end

    DOLM_STD --> TL_APPROVE{Teamlead<br/>freigabe?}
    TL_APPROVE -->|Ja| PM_REVIEW
    TL_APPROVE -->|Nein| DOLM_STD

    PM_LEIST --> PM_REVIEW[PM перевіряє<br/>та freigabe]
    CONC_STD --> PM_REVIEW

    PM_REVIEW --> ABR_RECEIVE[Abrechnung<br/>отримує<br/>freigegebene<br/>Leistungen]

    KOSTEN --> ABR_RECEIVE

    ABR_RECEIVE --> KV_CREATE{Тип<br/>рахунку?}

    KV_CREATE -->|KV| QUOTE[Kostenvoranschlag<br/>Leistung × Menge × Preis<br/>+ 19% MWSt]
    KV_CREATE -->|Vorkasse| VORKASSE[Авансовий рахунок]
    KV_CREATE -->|Zwischen| ZWISCHEN["Проміжний рахунок<br/>(тільки нові позиції!)"]
    KV_CREATE -->|Final| FINAL[Фінальний рахунок]

    QUOTE & VORKASSE & ZWISCHEN & FINAL --> VAT{VAT логіка}

    VAT --> VAT_OWN["Власні послуги:<br/>+ 19% DE USt<br/>(завжди, незалежно<br/>від країни клієнта)"]
    VAT --> VAT_PASS["Kostenübernahmen:<br/>0% USt<br/>(1:1 із зовнішнім<br/>рахунком)"]

    VAT_OWN & VAT_PASS --> PREPAY{Врахувати<br/>передоплати?}
    PREPAY -->|Ja| DEDUCT[Вирахувати<br/>суми KV/Vorkasse]
    PREPAY -->|Nein| INVOICE

    DEDUCT --> INVOICE[Рахунок<br/>+ Leistungsbericht<br/>+ нумерація сторінок]

    INVOICE --> SEND[Надіслати<br/>пацієнту]
    SEND --> STATUS{Статус<br/>оплати}

    STATUS -->|bezahlt| PAID[✅ Оплачено]
    STATUS -->|offen/überfällig| MAHNUNG1[1. Mahnung]
    MAHNUNG1 --> MAHNUNG2[2. Mahnung]
    MAHNUNG2 --> INKASSO{Inkasso?}
    INKASSO -->|"Freigabe Abrechnung"| INKASSO_GO[Inkasso]
    INKASSO -->|Nein| REVIEW[Ревізія]

    INVOICE --> DATEV[DATEV-Export<br/>для Steuerberater]
    INVOICE --> AUDIT[Audit-Log<br/>кожна зміна]

    subgraph EXT_STATUS ["Статуси зовнішніх рахунків"]
        direction LR
        E_OFFEN[offen] --> E_PRUEF[Prüfung]
        E_PRUEF --> E_BEZAHLT[bezahlt]
        E_PRUEF --> E_MAHNUNG[Mahnung]
        E_PRUEF --> E_ABGELEHNT[Abgelehnt]
        E_OFFEN --> E_VERALTET[Veraltet]
    end

    style PAID fill:#4CAF50,color:#fff
    style INKASSO_GO fill:#f44336,color:#fff
    style DATEV fill:#9C27B0,color:#fff
```

---

## 6. RBAC — хто що бачить

```mermaid
flowchart LR
    subgraph ROLES ["Ролі"]
        CEO[👔 CEO<br/>Повний доступ]
        CEOA[👔 CEO Assistant]
        PM[🩺 Patient Manager]
        TL[🗣️ Teamlead Dolm.]
        DOLM[🗣️ Dolmetscher]
        CONC[🛎️ Concierge]
        ABR[💰 Abrechnung]
        VERT[📈 Vertrieb]
        IT[🔧 IT Admin]
        PAT[👤 Patient]
    end

    subgraph DATA ["Дані"]
        PATIENT_DATA[Дані пацієнта]
        MED_DATA[Медичні дані]
        DOCS[Документи]
        TERMINE[Терміни]
        FINANCE[Фінанси]
        COMM[Комунікація]
    end

    CEO -->|FULL| PATIENT_DATA & MED_DATA & DOCS & TERMINE & FINANCE & COMM

    PM -->|"свої пацієнти"| PATIENT_DATA
    PM -->|"свої пацієнти"| MED_DATA
    PM -->|"свої пацієнти"| DOCS
    PM -->|"планування"| TERMINE
    PM -->|"огляд"| FINANCE
    PM -->|"кейсова"| COMM

    TL -->|"команда"| PATIENT_DATA
    TL -->|"релевантне"| MED_DATA
    TL -->|"переклади"| DOCS
    TL -->|"планування"| TERMINE

    DOLM -->|"базові"| PATIENT_DATA
    DOLM -->|"за завданням"| MED_DATA
    DOLM -->|"freigegeben"| DOCS
    DOLM -->|"перегляд"| TERMINE

    CONC -->|"подорожі+сервіс"| PATIENT_DATA
    CONC -.->|"❌ НІКОЛИ"| MED_DATA
    CONC -->|"сервісні"| DOCS
    CONC -->|"не-мед + blocked slots"| TERMINE

    ABR -->|"базові"| PATIENT_DATA
    ABR -.->|"❌"| MED_DATA
    ABR -->|"рахункові"| DOCS
    ABR -->|"FULL"| FINANCE

    VERT -.->|"❌"| PATIENT_DATA
    VERT -.->|"❌"| MED_DATA
    VERT -->|"аналітика"| FINANCE

    PAT -->|"freigegeben"| PATIENT_DATA
    PAT -->|"freigegeben"| MED_DATA
    PAT -->|"freigegeben"| DOCS
    PAT -->|"freigegeben"| TERMINE
    PAT -->|"свої рахунки"| FINANCE

    style CEO fill:#9C27B0,color:#fff
    style PM fill:#FF9800,color:#fff
    style DOLM fill:#2196F3,color:#fff
    style CONC fill:#00BCD4,color:#fff
    style ABR fill:#E91E63,color:#fff
    style PAT fill:#4CAF50,color:#fff
```

---

## 7. Модулі системи (Architecture)

```mermaid
flowchart TD
    subgraph UI ["Frontend Layer"]
        BACK[Internal Backoffice<br/>Web App]
        MOBILE[Mobile App<br/>Dolmetscher]
        PORTAL[Patient Portal]
        DASH[CEO Dashboard]
    end

    subgraph GW ["API Gateway"]
        AUTH[Auth + MFA]
        RBAC[RBAC Engine]
        RATE[Rate Limiting]
        AUDIT_GW[Audit Interceptor]
    end

    subgraph CORE ["Application Core — Modular Monolith"]
        IAM[IAM / RBAC]
        CRM[CRM / Lead Intake]
        PREG[Patient Registry]
        MCASE[Medical Case<br/>& Anamnesis]
        ORD[Orders &<br/>Contracts]
        PROV[Provider<br/>Registry]
        APT[Appointment<br/>Orchestration]
        DOC[Documents<br/>& Sharing]
        COMM2[Communication<br/>& Tasks]
        BILL[Billing &<br/>Payments]
        REP[Reporting<br/>& KPI]
        CONSENT[Consent / Audit<br/>/ Compliance]
        TPL[Template<br/>Engine]
        ESIGN[eSignature<br/>Service]
        SOP[Learning /<br/>SOP Module]
        INTERP[Interpreter<br/>Management]
        CONC2[Concierge<br/>Management]
    end

    subgraph INFRA ["Data & Infrastructure"]
        PG[(PostgreSQL<br/>AES-256)]
        S3[(Object Storage<br/>docs scans PDFs)]
        SEARCH[(Search Index)]
        QUEUE[Queue / Jobs<br/>PDF OCR notify<br/>reminders DATEV]
        AUDIT_STORE[(Audit Store<br/>immutable)]
        CACHE[(Cache)]
        BACKUP[(Backup<br/>3-2-1)]
    end

    subgraph EXT ["External Integrations"]
        EMAIL[Email / SMTP]
        ESIGN_EXT[eSign Provider]
        PAY[Payment Provider]
        CAL[Calendar / ICS]
        OCR_EXT[OCR / Translation]
        DATEV_EXT[DATEV Export]
        AI_GW[AI Gateway<br/>anonymized only]
    end

    UI --> GW --> CORE
    CORE --> INFRA
    CORE --> EXT

    style PG fill:#336791,color:#fff
    style S3 fill:#FF9900,color:#fff
    style AUDIT_STORE fill:#f44336,color:#fff
    style AI_GW fill:#9C27B0,color:#fff
```

---

## 8. Перекладач: повний workflow

```mermaid
flowchart TD
    PM_ASSIGN[PM призначає<br/>перекладача<br/>на термін] --> NOTIFY[Нотифікація<br/>перекладачу]

    NOTIFY --> RESPONSE{Відповідь}
    RESPONSE -->|Akzeptieren| BRIEFING[Dolmetscher-<br/>Briefing від PM]
    RESPONSE -->|Rücksprache erbeten| DISCUSS[Обговорення<br/>з PM/Teamlead]
    RESPONSE -->|Ablehnung| PM_REASSIGN[PM призначає<br/>іншого]
    DISCUSS --> RESPONSE

    BRIEFING --> ACCESS[Доступ до даних:<br/>• Patientenstammdaten<br/>• Термін: де коли тип<br/>• Мед. інфо для терміну<br/>• Документи freigegeben<br/>• Нотатки]

    ACCESS --> TERMIN([Термін])

    TERMIN --> REPORT[Звіт перекладача:<br/>• Години termingebunden<br/>• Текстовий звіт<br/>• Upload файлів/PDF]

    REPORT --> TL_CHECK{Teamlead<br/>перевірка}

    TL_CHECK -->|Години OK| TL_HOURS[✅ Freigabe<br/>годин]
    TL_CHECK -->|Звіт OK| TL_REPORT[✅ Freigabe<br/>звіту]
    TL_CHECK -->|Файли OK| TL_FILES[✅ Маска +<br/>категоризація +<br/>freigabe файлів]
    TL_CHECK -->|Повернення| REPORT

    TL_HOURS --> PM_VIEW[PM бачить<br/>звіти/години/документи]
    TL_REPORT --> PM_VIEW
    TL_FILES --> PM_VIEW

    TL_HOURS --> BILLING[Freigegebene Stunden<br/>→ Abrechnung<br/>→ Рахунок пацієнту]

    subgraph VISIBILITY ["Що НЕ бачить перекладач"]
        direction LR
        NO1[❌ Повна Patientenakte]
        NO2[❌ Фінансові дані]
        NO3[❌ Інші пацієнти]
        NO4[❌ Internal-only документи]
    end

    style TERMIN fill:#FF9800,color:#fff
    style BILLING fill:#4CAF50,color:#fff
    style VISIBILITY fill:#ffebee
```

---

## 9. Документ: lifecycle та sharing

```mermaid
flowchart TD
    IMPORT[Імпорт / Скан /<br/>Створення з шаблону] --> MASK[Заповнення маски:<br/>тип, пацієнт, дата,<br/>клініка, джерело]

    MASK --> AUTONAME[Авто-генерація<br/>імені за маскою]

    AUTONAME --> CAT[Категоризація:<br/>Art, Status, Patient,<br/>Datum, Klinik, Ursprung]

    CAT --> VIS{Visibility}

    VIS --> INTERNAL[internal-only<br/>🔒 Не шериться<br/>ніколи назовні]
    VIS --> FREIGEG[freigegeben<br/>Готовий до шерінгу]
    VIS --> PAT_VIS[patient-visible<br/>Видимий у порталі]

    FREIGEG --> SHARE_CHECK{Перевірки<br/>перед шерінгом}

    SHARE_CHECK --> CH1{Документ<br/>freigegeben?}
    CH1 -->|Ні| BLOCK1[❌ Блок]
    CH1 -->|Так| CH2{Не internal-<br/>only?}
    CH2 -->|Internal| BLOCK2[❌ Блок]
    CH2 -->|OK| CH3{Канал<br/>дозволений?}
    CH3 -->|"Пацієнт: договірний канал<br/>SP: офіційний в системі"| CH4{SP задіяний<br/>у замовленні?}
    CH3 -->|Ні| BLOCK3[❌ Блок]
    CH4 -->|Ні| BLOCK4[❌ Блок]
    CH4 -->|Так| CH5{Мед. документ<br/>→ мед. SP?}
    CH5 -->|"Мед. → не-мед. SP"| BLOCK5[❌ Блок]
    CH5 -->|"Мед. → мед. SP"| CONFIRM[⚠️ Підтвердження<br/>перед відправкою]
    CH5 -->|Не-мед.| SEND[✅ Відправити]
    CONFIRM --> SEND

    SEND --> AUDIT_LOG[📋 Audit Log]

    subgraph MISSING ["Алерти відсутніх документів"]
        MIN_SET["Мін. комплект:<br/>• Reisepass<br/>• Einverständniserklärung<br/>• ..."]
        MIN_SET --> ALERT["⚠️ Meldung якщо<br/>документ відсутній"]
    end

    style BLOCK1 fill:#f44336,color:#fff
    style BLOCK2 fill:#f44336,color:#fff
    style BLOCK3 fill:#f44336,color:#fff
    style BLOCK4 fill:#f44336,color:#fff
    style BLOCK5 fill:#f44336,color:#fff
    style SEND fill:#4CAF50,color:#fff
    style CONFIRM fill:#FF9800,color:#fff
```

---

## 10. Follow-up та Checklist по термінах

```mermaid
flowchart LR
    subgraph BEFORE ["Vorbereitung"]
        B1[Документи готові?]
        B2[Переклад Vorbefunde?]
        B3[Передоплата статус?]
        B4[Kostenübernahme?]
        B5[Перекладач призначений?]
        B6[Питання для уточнення?]
        B7[Мед. дані → SP + Dolm.]
        B8["⚠️ Meldung якщо<br/>не все готово"]
    end

    subgraph DURING ["Durchführung"]
        D1[Звіт перекладача]
        D2[Статус оплати]
    end

    subgraph AFTER ["Follow-up"]
        A1[Наступні візити?]
        A2[Контрольні обстеження?]
        A3[Arztbrief отримано?]
        A4[Рахунки / квитанції?]
        A5[Переклад Arztbrief?]
        A6[Пересилка пацієнту]
    end

    BEFORE --> DURING --> AFTER

    subgraph FOLLOWUP_SCHEDULE ["Follow-up розклад"]
        direction TB
        F1["📅 1 тиждень"]
        F2["📅 1 місяць"]
        F3["📅 6 місяців"]
        F4["📅 Згідно лікарських<br/>призначень"]
        F5["📅 1 місяць до<br/>кінця пакету"]
    end
```
