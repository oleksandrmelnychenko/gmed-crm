//! "Dokumentationsbogen – Identifizierung juristischer Personen" (owner
//! decision 2026-10-22): the GwG sheet of a third-party payer that is a
//! company, an organisation or an insurer. Same template (`gwg_identification`,
//! subject `payer`), numbering (`GWG-`), versioning, viewer and "confirm
//! signature" flow as the sheet for natural persons; the server picks this
//! form when the payer is not a natural person and records it as
//! `generated_bindings.gwg_identification.form = "legal_entity"`.
//!
//! The sections follow the federal "Dokumentationsbogen juristische Personen"
//! of the supervisory authorities. Data: the payer declaration
//! (`lead_payer_declarations`, staff and the lead) and the payer's own sent
//! answers through the link (`lead_payer_statements`). A sheet can be
//! generated with gaps ("—"); confirming its signature is refused with the
//! list of what is missing ([`signature_missing`], code
//! `payer_details_incomplete`). See docs/architecture/gwg-identification-sheet_ua.md.

use super::*;

/// `generated_bindings.gwg_identification.form` of a legal-entity sheet.
pub(crate) const FORM_BINDING_KEY: &str = "form";
pub(crate) const LEGAL_ENTITY_FORM: &str = "legal_entity";
/// The base of the document name ("… · Beispiel GmbH · 22.10.2026").
pub(super) const TITLE: &str = "Dokumentationsbogen juristische Personen";
pub(super) const PREVIEW_TITLE: &str = "Dokumentationsbogen juristische Personen (GwG)";
/// Owner decision 2026-10-22.
const SUBTITLE: &str = "Freiwillige Anwendung – GMED ist kein Verpflichteter nach § 2 GwG";
/// Where the payer's own answers come from.
const STATEMENT_SOURCE: &str = "Angaben des Kostenübernehmers über den eigenen Zugang";

/// One paying company, organisation or insurer on the sheet.
#[derive(Debug, Default, Clone)]
pub(super) struct LegalEntitySheet {
    /// `company`, `organisation` or `insurance`.
    pub payer_type: Option<String>,
    pub organisation_name: Option<String>,
    pub legal_form: Option<String>,
    pub register_court: Option<String>,
    pub register_number: Option<String>,
    pub vat_id: Option<String>,
    /// The seat.
    pub street: Option<String>,
    pub zip: Option<String>,
    pub city: Option<String>,
    pub country: Option<String>,
    /// The person who acts for the organisation (and, as far as known, the
    /// member of its representative body), as the payer named it.
    pub representative_name: Option<String>,
    pub representative_role: Option<String>,
    pub representative_birth_date: Option<NaiveDate>,
    pub representative_address: Option<String>,
    /// The identity document of that person, from the payer's link.
    pub id_document_type: Option<String>,
    pub id_document_number: Option<String>,
    pub id_issuing_authority: Option<String>,
    pub id_issuing_country: Option<String>,
    pub id_issued_on: Option<NaiveDate>,
    pub id_valid_until: Option<NaiveDate>,
    /// A copy of that document was uploaded through the link.
    pub id_document_on_file: bool,
    /// The day the payer sent the answers; `None` while nothing was sent.
    pub statement_submitted_on: Option<NaiveDate>,
    /// The beneficial owners the payer listed (`first_name`, `last_name`,
    /// `date_of_birth`, `birth_place`, `street`, `zip`, `city`, `country`,
    /// `share_percent`).
    pub beneficial_owners: Vec<Value>,
    /// "There is no natural person with more than 25 %".
    pub beneficial_owners_none: Option<bool>,
    /// Why the organisation pays.
    pub payment_reason: Option<String>,
    /// The reason is the patient's words (the payer has not stated one).
    pub payment_reason_from_patient: bool,
    pub pep_self: Option<bool>,
    pub pep_self_details: Option<String>,
    pub pep_related: Option<bool>,
    pub pep_related_details: Option<String>,
    pub sanctions_links: Option<bool>,
    pub sanctions_links_details: Option<String>,
    pub high_risk_country: Option<bool>,
    pub high_risk_country_code: Option<String>,
    /// The enhanced check is required (owner rule 2026-10-07): the source of
    /// the funds is printed and needed.
    pub enhanced_check_required: bool,
    pub funds_sources: Vec<String>,
    pub funds_description: Option<String>,
    /// Staff's review of the payer's PEP status (subject `payer`, owner
    /// decision 2026-10-23): shown apart from the payer's own answers.
    pub pep_review: crate::services::pep_review::PepReview,
    /// Questions 5 a) to d). b) is staff's conclusion once staff reviewed
    /// the payer, the payer's own answer before; never both ORed.
    pub increased_risk: bool,
    pub politically_exposed: bool,
    pub high_risk_third_country: bool,
    pub unusual_transaction: bool,
    pub payment_route: Option<GwgPaymentRoute>,
    /// "Mia Muster, geb. 05.04.2016": the patient the payment is for.
    pub treated_person: Option<String>,
    pub reviewer_name: String,
    pub review_date: NaiveDate,
}

/// One line of the sheet, in the order printed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) enum SheetItem {
    Heading(&'static str),
    /// A label with its value; "—" without one.
    Value(&'static str, Option<String>),
    Check(bool, String),
    /// A question of section 5 with "[X] Ja / [ ] Nein"; `None` ticks
    /// neither box (no recorded answer).
    YesNo(&'static str, Option<bool>),
    /// A closing sentence of a section.
    Note(String),
}

fn trimmed(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn date(value: Option<NaiveDate>) -> Option<String> {
    value.map(|day| day.format("%d.%m.%Y").to_string())
}

/// Question 5 b) of the sheet from the payer's own answers and staff's
/// review of the payer (owner decision 2026-10-23).
fn politically_exposed(sheet: &LegalEntitySheet) -> bool {
    crate::services::pep_review::politically_exposed(&pep_answers(sheet), &sheet.pep_review)
}

fn pep_answers(sheet: &LegalEntitySheet) -> crate::services::pep_review::PersonAnswers {
    crate::services::pep_review::PersonAnswers {
        pep_self: sheet.pep_self,
        pep_related: sheet.pep_related,
        ..Default::default()
    }
}

/// The boxes of 5 b): ticked only for a recorded answer, the payer's own or
/// staff's review (DEV QA 2026-10-30: "[X] Nein" beside no answer).
fn politically_exposed_boxes(sheet: &LegalEntitySheet) -> Option<bool> {
    sheet.politically_exposed.then_some(true).or_else(|| {
        crate::services::pep_review::politically_exposed_answer(
            &pep_answers(sheet),
            &sheet.pep_review,
        )
    })
}

/// "ja – <details>", "nein" or `None` (not answered).
fn answer(value: Option<bool>, details: Option<&str>) -> Option<String> {
    match value {
        Some(true) => Some(match trimmed(details) {
            Some(details) => format!("ja – {details}"),
            None => "ja".to_string(),
        }),
        Some(false) => Some("nein".to_string()),
        None => None,
    }
}

/// The text of one beneficial owner's key, trimmed.
fn owner_text(owner: &Value, key: &str) -> Option<String> {
    trimmed(owner.get(key).and_then(Value::as_str))
}

/// "Anteil 30 %" from a number or a text.
fn owner_share(owner: &Value) -> Option<String> {
    owner
        .get("share_percent")
        .and_then(|share| {
            share
                .as_str()
                .map(|share| share.trim().to_string())
                .or_else(|| share.as_f64().map(|share| share.to_string()))
        })
        .filter(|share| !share.is_empty())
        .map(|share| format!("Anteil {} %", share.replace('.', ",")))
}

fn owner_name(owner: &Value) -> Option<String> {
    let name = [
        owner_text(owner, "first_name"),
        owner_text(owner, "last_name"),
    ]
    .into_iter()
    .flatten()
    .collect::<Vec<_>>()
    .join(" ");
    (!name.is_empty()).then_some(name)
}

impl LegalEntitySheet {
    /// The organisation's name, which names the document; "Organisation"
    /// while none is known.
    pub(super) fn display_name(&self) -> String {
        trimmed(self.organisation_name.as_deref()).unwrap_or_else(|| "Organisation".to_string())
    }

    fn role(&self) -> &'static str {
        match self.payer_type.as_deref() {
            Some("insurance") => "Kostenübernehmer (Versicherung)",
            Some("organisation") => "Kostenübernehmer (Organisation)",
            _ => "Kostenübernehmer (Unternehmen)",
        }
    }

    fn seat(&self) -> String {
        gwg_address_line(
            self.street.as_deref(),
            self.zip.as_deref(),
            self.city.as_deref(),
            self.country.as_deref(),
        )
    }

    fn identity_document(&self) -> GwgIdentityDocument<'_> {
        GwgIdentityDocument {
            kind: self.id_document_type.as_deref(),
            number: self.id_document_number.as_deref(),
            authority: self.id_issuing_authority.as_deref(),
            country: self.id_issuing_country.as_deref(),
            issued_on: self.id_issued_on,
            valid_until: self.id_valid_until,
        }
    }

    /// "Erika Zahler (Geschäftsführerin)".
    fn representative_line(&self) -> Option<String> {
        let name = trimmed(self.representative_name.as_deref())?;
        Some(match trimmed(self.representative_role.as_deref()) {
            Some(role) => format!("{name} ({role})"),
            None => name,
        })
    }

    fn named_owners(&self) -> Vec<(&Value, String)> {
        self.beneficial_owners
            .iter()
            .filter_map(|owner| owner_name(owner).map(|name| (owner, name)))
            .collect()
    }

    fn funds_line(&self) -> Option<String> {
        let sources = self
            .funds_sources
            .iter()
            .map(|code| crate::routes::lead_payer_link::funds_source_label(code))
            .collect::<Vec<_>>()
            .join(", ");
        match (
            sources.is_empty(),
            trimmed(self.funds_description.as_deref()),
        ) {
            (false, Some(words)) => Some(format!("{sources} – {words}")),
            (false, None) => Some(sources),
            (true, words) => words,
        }
    }

    fn statement_measures(&self) -> Option<String> {
        self.statement_submitted_on.map(|day| {
            format!(
                "{STATEMENT_SOURCE} (abgesendet am {})",
                day.format("%d.%m.%Y")
            )
        })
    }
}

/// The head of the sheet.
pub(super) fn meta_cells(
    sheet: &LegalEntitySheet,
    agency_name: &str,
    order_number: Option<&str>,
) -> Vec<(&'static str, String)> {
    vec![
        ("Firma / Name", sheet.display_name()),
        ("Rolle in der Geschäftsbeziehung", sheet.role().to_string()),
        ("Aufzeichnende Stelle", agency_name.to_string()),
        (
            "Bearbeiter/in",
            trimmed(Some(sheet.reviewer_name.as_str())).unwrap_or_else(|| "—".to_string()),
        ),
        (
            "Auftrags-/Rechnungs-Nr.",
            trimmed(order_number).unwrap_or_else(|| "—".to_string()),
        ),
        ("Datum", sheet.review_date.format("%d.%m.%Y").to_string()),
        (
            "Behandelte Person",
            sheet
                .treated_person
                .clone()
                .unwrap_or_else(|| "—".to_string()),
        ),
    ]
}

/// The sections of the sheet as lines; `today` decides whether the identity
/// document is still valid.
pub(super) fn content(sheet: &LegalEntitySheet, today: NaiveDate) -> Vec<SheetItem> {
    use SheetItem::{Check, Heading, Note, Value as Line, YesNo};
    let mut items = Vec::new();

    items.push(Heading(
        "1. Identifizierung des Vertragspartners (juristische Person / Personengesellschaft)",
    ));
    items.push(Line(
        "Firma, Name oder Bezeichnung",
        trimmed(sheet.organisation_name.as_deref()),
    ));
    items.push(Line("Rechtsform", trimmed(sheet.legal_form.as_deref())));
    let register = [
        trimmed(sheet.register_court.as_deref()),
        trimmed(sheet.register_number.as_deref()),
    ]
    .into_iter()
    .flatten()
    .collect::<Vec<_>>()
    .join(", ");
    items.push(Line(
        "Registergericht und Registernummer (soweit vorhanden)",
        Some(register).filter(|line| !line.is_empty()),
    ));
    if let Some(vat_id) = trimmed(sheet.vat_id.as_deref()) {
        items.push(Line("USt-IdNr.", Some(vat_id)));
    }
    items.push(Line(
        "Anschrift des Sitzes bzw. der Hauptniederlassung",
        Some(sheet.seat()).filter(|line| !line.is_empty()),
    ));
    items.push(Line(
        "Mitglieder des Vertretungsorgans bzw. gesetzliche Vertreter (soweit bekannt)",
        sheet.representative_line(),
    ));
    items.push(Line(
        "Quelle der Angaben",
        Some(sheet.statement_measures().unwrap_or_else(|| {
            "Angaben zum Zahler in der Anfrage; die Angaben des Kostenübernehmers stehen aus"
                .to_string()
        })),
    ));
    items.push(Check(
        false,
        "Die Angaben wurden anhand eines Auszugs aus dem Handels-, Genossenschafts-, Partnerschafts- oder Vereinsregister bzw. eines vergleichbaren amtlichen Registers oder Verzeichnisses überprüft; der Auszug ist beigefügt."
            .to_string(),
    ));
    if let Some(route) = &sheet.payment_route {
        items.push(Line(route.label(), Some(route.line())));
        if route.via_third_party.is_some() {
            items.push(Line(
                "Zahlung über Dritte / Zahlungsdienstleister",
                Some(route.third_party_line()),
            ));
        }
        if let Some(hint) = route.hint() {
            items.push(Line("Hinweis", Some(hint)));
        }
    }

    items.push(Heading(
        "2. Für den Vertragspartner auftretende Person (vertretungsberechtigte Person)",
    ));
    items.push(Line(
        "Vor- und Nachname (Funktion)",
        sheet.representative_line(),
    ));
    items.push(Line("Geburtsdatum", date(sheet.representative_birth_date)));
    items.push(Line(
        "Anschrift",
        trimmed(sheet.representative_address.as_deref()),
    ));
    let identity_document = gwg_identity_document_line(sheet.identity_document());
    items.push(Line(
        "Ausweisdokument (Art, Nummer, ausstellende Behörde)",
        Some(identity_document).filter(|line| !line.is_empty()),
    ));
    items.push(Check(
        gwg_identity_copy_valid(sheet.id_document_on_file, sheet.id_valid_until, today),
        "Die erforderliche Kopie/Fotografie bzw. der Scan des Ausweisdokuments der auftretenden Person wurde erstellt und ist beigefügt; das Dokument ist gültig."
            .to_string(),
    ));
    items.push(Check(
        false,
        "Die Berechtigung der auftretenden Person, für den Vertragspartner zu handeln, wurde überprüft (Registerauszug bzw. Vollmacht)."
            .to_string(),
    ));

    items.push(Heading(
        "3. Feststellung und Identifizierung der wirtschaftlich Berechtigten (wB)",
    ));
    let owners = sheet.named_owners();
    items.push(Check(
        !owners.is_empty(),
        "Folgende natürliche Personen sind wirtschaftlich Berechtigte (mehr als 25 % der Kapital- oder Stimmrechtsanteile oder Kontrolle auf vergleichbare Weise):"
            .to_string(),
    ));
    for (owner, name) in &owners {
        items.push(Line(
            "Name, Vorname des wirtschaftlich Berechtigten",
            Some(name.clone()),
        ));
        let born = owner_text(owner, "date_of_birth")
            .and_then(|day| NaiveDate::parse_from_str(&day, "%Y-%m-%d").ok())
            .map(|day| format!("geb. {}", day.format("%d.%m.%Y")));
        let place = owner_text(owner, "birth_place").map(|place| format!("in {place}"));
        let residence = gwg_address_line(
            owner_text(owner, "street").as_deref(),
            owner_text(owner, "zip").as_deref(),
            owner_text(owner, "city").as_deref(),
            owner_text(owner, "country").as_deref(),
        );
        let details = [born, place, Some(residence).filter(|line| !line.is_empty())]
            .into_iter()
            .flatten()
            .collect::<Vec<_>>()
            .join(", ");
        items.push(Line(
            "Geburtsdatum, Wohnort",
            Some(details).filter(|line| !line.is_empty()),
        ));
        items.push(Line(
            "Art und Umfang des wirtschaftlichen Interesses",
            owner_share(owner),
        ));
    }
    items.push(Check(
        owners.is_empty() && sheet.beneficial_owners_none == Some(true),
        "Es gibt keine natürliche Person, die mehr als 25 % der Kapital- oder Stimmrechtsanteile hält oder auf vergleichbare Weise Kontrolle ausübt (Angabe des Kostenübernehmers); als fiktive wirtschaftlich Berechtigte gelten die gesetzlichen Vertreter bzw. die Mitglieder des Vertretungsorgans (§ 3 Abs. 2 Satz 5 GwG)."
            .to_string(),
    ));
    items.push(Line(
        "Getroffene Maßnahmen zur Ermittlung des wB",
        sheet
            .statement_measures()
            .map(|measures| format!("Befragung des Vertragspartners: {measures}")),
    ));
    items.push(Check(
        false,
        "Einsichtnahme in das Transparenzregister bzw. in vergleichbare Register ist erfolgt (Auszug ist beigefügt)."
            .to_string(),
    ));

    items.push(Heading("4. Hintergrund der Geschäftsbeziehung"));
    items.push(Check(
        true,
        "Der Zweck und die Art der angestrebten Geschäftsbeziehung ergeben sich zweifelsfrei aus dem Typ der Geschäftsbeziehung: Übernahme der Kosten für die Organisation und Koordination medizinischer Behandlungen in Deutschland für die behandelte Person."
            .to_string(),
    ));
    items.push(Line(
        "Zweck der Zahlung (Grund der Kostenübernahme)",
        trimmed(sheet.payment_reason.as_deref()).map(|reason| {
            if sheet.payment_reason_from_patient {
                format!("{reason} (Angabe der Patientin / des Patienten)")
            } else {
                reason
            }
        }),
    ));

    items.push(Heading(
        "5. Prüfung der Anwendung von verstärkten Sorgfaltspflichten",
    ));
    items.push(Line(
        "Politisch exponierte Person unter den vertretungsberechtigten Personen oder wB (Angabe des Kostenübernehmers)",
        answer(sheet.pep_self, sheet.pep_self_details.as_deref()),
    ));
    items.push(Line(
        "Familienmitglied oder nahestehende Person einer politisch exponierten Person (Angabe des Kostenübernehmers)",
        answer(sheet.pep_related, sheet.pep_related_details.as_deref()),
    ));
    items.push(Line("Prüfung durch GMED", Some(sheet.pep_review.line())));
    items.push(Line(
        "Verbindungen zu sanktionierten Personen oder Unternehmen (Angabe des Kostenübernehmers)",
        answer(
            sheet.sanctions_links,
            sheet.sanctions_links_details.as_deref(),
        ),
    ));
    // The payer is no longer asked about a high-risk third country (owner
    // 2026-10-22, GMED checks the countries itself): only an answer stored
    // before is printed, never "—" for a question that was not asked.
    if sheet.high_risk_country.is_some() {
        items.push(Line(
            "Bezug zu einem Drittstaat mit hohem Risiko (Angabe des Kostenübernehmers)",
            answer(
                sheet.high_risk_country,
                sheet
                    .high_risk_country_code
                    .as_deref()
                    .map(german_document_country)
                    .as_deref(),
            ),
        ));
    }
    // The source of the funds only when the enhanced check is required
    // (owner rule 2026-10-07): it is asked then and only then.
    if sheet.enhanced_check_required {
        items.push(Line(
            "Herkunft der Mittel (verstärkte Prüfung erforderlich)",
            sheet.funds_line(),
        ));
    }
    items.push(YesNo(
        "a) Besteht bei der Geschäftsbeziehung aufgrund der unternehmensinternen Risikoanalyse bzw. einer Einzelfallprüfung ein erhöhtes Risiko?",
        Some(sheet.increased_risk),
    ));
    items.push(YesNo(
        "b) Handelt es sich bei einer vertretungsberechtigten Person oder einem wirtschaftlich Berechtigten um eine politisch exponierte Person, ein unmittelbares Familienmitglied dieser Person oder eine ihr bekanntermaßen nahestehende Person?",
        politically_exposed_boxes(sheet),
    ));
    items.push(YesNo(
        "c) Ist an der Geschäftsbeziehung ein von der EU-Kommission gelisteter Drittstaat mit hohem Risiko oder eine in diesem Drittstaat ansässige natürliche oder juristische Person beteiligt?",
        Some(sheet.high_risk_third_country),
    ));
    items.push(YesNo(
        "d) Handelt es sich um eine Transaktion, die besonders komplex oder ungewöhnlich groß ist, einem ungewöhnlichen Transaktionsmuster folgt oder keinen offensichtlichen wirtschaftlichen oder rechtmäßigen Zweck hat?",
        Some(sheet.unusual_transaction),
    ));
    let other_yes =
        sheet.politically_exposed || sheet.high_risk_third_country || sheet.unusual_transaction;
    items.push(Note(if sheet.increased_risk {
        "Frage a) ist mit „Ja“ beantwortet: Der Dokumentationsbogen „Durchführung verstärkter Sorgfaltspflichten“ ist zusätzlich auszufüllen.".to_string()
    } else if other_yes {
        "Frage a) ist mit „Nein“ beantwortet: Der Dokumentationsbogen „Durchführung verstärkter Sorgfaltspflichten“ ist nach der unternehmensinternen Risikoanalyse nicht erforderlich; die Antworten zu b) bis d) sind oben festgehalten.".to_string()
    } else {
        "Keine Frage ist mit „Ja“ beantwortet: Der Dokumentationsbogen „Durchführung verstärkter Sorgfaltspflichten“ ist nicht erforderlich.".to_string()
    }));

    items.push(Heading("6. Grund der Aufzeichnung"));
    items.push(Check(
        true,
        "Begründung einer Geschäftsbeziehung".to_string(),
    ));
    items.push(Check(
        false,
        "Transaktion im Wert von 15.000 € oder mehr außerhalb einer bestehenden Geschäftsbeziehung"
            .to_string(),
    ));
    items.push(Check(false, "Zweifel an den Identitätsangaben".to_string()));
    items.push(Check(
        false,
        "Verdacht auf Geldwäsche oder Terrorismusfinanzierung".to_string(),
    ));
    items.push(Note(
        "Grundlage: bundeseinheitlicher Vordruck der Geldwäscheaufsichtsbehörden zur Identifizierung juristischer Personen und Personengesellschaften. Die Identifizierungspflichten für Güterhändler, Kunstvermittler, Kunstlagerhalter und Immobilienmakler treffen auf diese Geschäftsbeziehung nicht zu."
            .to_string(),
    ));
    items
}

/// What keeps the signature of the sheet from being confirmed, as keys
/// `payer_<field>` in sheet order: the organisation, its seat, the person who
/// acts for it with a valid identity document and its copy, the beneficial
/// owners (or the statement that there are none), the reason of the payment,
/// the PEP and sanctions answers and — when the enhanced check is required —
/// the source of the funds. The register number is asked "soweit vorhanden"
/// and is not required.
pub(super) fn missing_fields(sheet: &LegalEntitySheet, today: NaiveDate) -> Vec<String> {
    let filled = |value: &Option<String>| trimmed(value.as_deref()).is_some();
    let mut missing: Vec<String> = Vec::new();
    let mut push = |key: &str| {
        let key = format!("payer_{key}");
        if !missing.contains(&key) {
            missing.push(key);
        }
    };
    if sheet.statement_submitted_on.is_none() {
        push("statement_not_submitted");
    }
    if !filled(&sheet.organisation_name) {
        push("organisation_name");
    }
    if !filled(&sheet.legal_form) {
        push("legal_form");
    }
    if !filled(&sheet.street) || !filled(&sheet.city) || !filled(&sheet.country) {
        push("seat_address");
    }
    if !filled(&sheet.representative_name) {
        push("representative_name");
    }
    let document = crate::services::identity_document::Document {
        kind: sheet.id_document_type.as_deref(),
        number: sheet.id_document_number.as_deref(),
        authority: sheet.id_issuing_authority.as_deref(),
        country: sheet.id_issuing_country.as_deref(),
        issued_on: sheet.id_issued_on,
        valid_until: sheet.id_valid_until,
        unreadable: false,
    };
    let problems = crate::services::identity_document::problems(
        &document,
        sheet.representative_birth_date,
        today,
    );
    for problem in problems {
        push(problem);
    }
    if !sheet.id_document_on_file {
        push("id_upload");
    }
    if sheet.named_owners().is_empty() && sheet.beneficial_owners_none != Some(true) {
        push("beneficial_owners");
    }
    if !filled(&sheet.payment_reason) {
        push("payment_reason");
    }
    if sheet.pep_self.is_none() || sheet.pep_related.is_none() {
        push("pep");
    }
    if sheet.sanctions_links.is_none() {
        push("sanctions_links");
    }
    if sheet.enhanced_check_required && sheet.funds_line().is_none() {
        push("funds");
    }
    missing
}

/// Reads the sheet of the lead's paying organisation; `None` when the payer
/// is not a company, an organisation or an insurer. `reviewer` names the
/// staff member who generates it.
pub(super) async fn load(
    conn: &mut sqlx::PgConnection,
    lead_id: Uuid,
    reviewer: Option<Uuid>,
) -> Result<Option<LegalEntitySheet>, sqlx::Error> {
    let Some(declaration) = crate::routes::lead_payer::load_declaration(&mut *conn, lead_id)
        .await?
        .filter(|declaration| declaration.is_organisation())
    else {
        return Ok(None);
    };
    let today = crate::app_time::today();
    let lead = sqlx::query(
        r#"SELECT l.first_name, l.last_name, l.date_of_birth, l.wizard_state,
                  d.organisation_legal_form, d.organisation_register_number,
                  g.payment_background,
                  (SELECT u.name FROM users u WHERE u.id = $2) AS reviewer_name,
                  EXISTS (
                      SELECT 1 FROM documents doc
                      WHERE doc.lead_id = l.id
                        AND doc.file_deleted_at IS NULL
                        AND doc.status <> 'archived'
                        AND doc.art = 'payer_identity'
                  ) AS identity_on_file
           FROM leads l
           LEFT JOIN lead_payer_declarations d ON d.lead_id = l.id
           LEFT JOIN lead_gwg_declarations g ON g.lead_id = l.id
           WHERE l.id = $1"#,
    )
    .bind(lead_id)
    .bind(reviewer)
    .fetch_optional(&mut *conn)
    .await?;
    let Some(lead) = lead else {
        return Ok(None);
    };
    let lead_text = |column: &str| {
        trimmed(
            lead.try_get::<Option<String>, _>(column)
                .ok()
                .flatten()
                .as_deref(),
        )
    };
    let statement = sqlx::query(
        r#"SELECT submitted_at, organisation_name, legal_form, vat_id, register_court,
                  register_number, street, zip, city, country,
                  representative_first_name, representative_last_name, representative_role,
                  date_of_birth,
                  id_document_type, id_document_number, id_issuing_authority,
                  id_issuing_country, id_issued_on, id_valid_until,
                  beneficial_owners, beneficial_owners_none, payment_reason,
                  pep_self, pep_self_details, pep_related, pep_related_details,
                  sanctions_links, sanctions_links_details,
                  high_risk_country, high_risk_country_code,
                  funds_sources, funds_description
           FROM lead_payer_statements
           WHERE lead_id = $1 AND submitted_at IS NOT NULL"#,
    )
    .bind(lead_id)
    .fetch_optional(&mut *conn)
    .await?;
    let enhanced_check_required =
        crate::routes::lead_enhanced_check::enhanced_check_triggers(&mut *conn, lead_id)
            .await?
            .required;
    // The lists of high-risk third countries live only in the risk
    // configuration (owner rule 2026-10-22); the sheet reads them there.
    let risk_config = crate::risk::store::load_config(&mut *conn).await?;

    let wizard_state = lead
        .try_get::<Option<Value>, _>("wizard_state")
        .ok()
        .flatten()
        .unwrap_or(Value::Null);
    let aml = wizard_state
        .get("aml_enhanced_due_diligence")
        .cloned()
        .and_then(|value| serde_json::from_value::<AmlEnhancedDueDiligenceBindings>(value).ok())
        .unwrap_or_default();
    let lead_name = [lead_text("first_name"), lead_text("last_name")]
        .into_iter()
        .flatten()
        .collect::<Vec<_>>()
        .join(" ");
    let lead_birth_date = lead
        .try_get::<Option<NaiveDate>, _>("date_of_birth")
        .ok()
        .flatten();

    let mut sheet = LegalEntitySheet {
        payer_type: declaration.payer_type.clone(),
        organisation_name: trimmed(declaration.organisation_name.as_deref()),
        legal_form: lead_text("organisation_legal_form"),
        register_number: lead_text("organisation_register_number"),
        street: trimmed(declaration.street.as_deref()),
        zip: trimmed(declaration.zip.as_deref()),
        city: trimmed(declaration.city.as_deref()),
        country: trimmed(declaration.country.as_deref()),
        id_document_on_file: lead.try_get::<bool, _>("identity_on_file").unwrap_or(false),
        enhanced_check_required,
        increased_risk: gwg_increased_risk(&aml, enhanced_check_required),
        unusual_transaction: aml.unusual_complex_or_large
            || aml.unusual_pattern
            || aml.no_lawful_purpose,
        payment_route: Some(GwgPaymentRoute {
            answered_by_payer: true,
            ..GwgPaymentRoute::from_declaration(&declaration)
        }),
        treated_person: Some(match lead_birth_date {
            Some(day) => format!("{lead_name}, geb. {}", day.format("%d.%m.%Y")),
            None => lead_name.clone(),
        })
        .filter(|person| !person.trim().is_empty()),
        reviewer_name: lead_text("reviewer_name").unwrap_or_default(),
        review_date: today,
        ..LegalEntitySheet::default()
    };
    if let Some(statement) = statement {
        let text = |column: &str| {
            trimmed(
                statement
                    .try_get::<Option<String>, _>(column)
                    .ok()
                    .flatten()
                    .as_deref(),
            )
        };
        let day = |column: &str| {
            statement
                .try_get::<Option<NaiveDate>, _>(column)
                .ok()
                .flatten()
        };
        let flag = |column: &str| statement.try_get::<Option<bool>, _>(column).ok().flatten();
        let submitted_at: chrono::DateTime<chrono::Utc> = statement.try_get("submitted_at")?;
        sheet.statement_submitted_on = Some(crate::app_time::date_of(submitted_at));
        // The payer's own answers come first; the declaration fills the gaps.
        sheet.organisation_name = text("organisation_name").or(sheet.organisation_name);
        sheet.legal_form = text("legal_form").or(sheet.legal_form);
        sheet.register_court = text("register_court");
        sheet.register_number = text("register_number").or(sheet.register_number);
        sheet.vat_id = text("vat_id");
        if text("street").is_some() || text("city").is_some() {
            sheet.street = text("street");
            sheet.zip = text("zip");
            sheet.city = text("city");
            sheet.country = text("country").or(sheet.country);
        }
        let representative = [
            text("representative_first_name"),
            text("representative_last_name"),
        ]
        .into_iter()
        .flatten()
        .collect::<Vec<_>>()
        .join(" ");
        sheet.representative_name = Some(representative).filter(|name| !name.is_empty());
        sheet.representative_role = text("representative_role");
        sheet.representative_birth_date = day("date_of_birth");
        sheet.id_document_type = text("id_document_type");
        sheet.id_document_number = text("id_document_number");
        sheet.id_issuing_authority = text("id_issuing_authority");
        sheet.id_issuing_country = text("id_issuing_country");
        sheet.id_issued_on = day("id_issued_on");
        sheet.id_valid_until = day("id_valid_until");
        sheet.beneficial_owners = statement
            .try_get::<Option<Value>, _>("beneficial_owners")
            .ok()
            .flatten()
            .and_then(|value| value.as_array().cloned())
            .unwrap_or_default();
        sheet.beneficial_owners_none = flag("beneficial_owners_none");
        sheet.payment_reason = text("payment_reason");
        sheet.pep_self = flag("pep_self");
        sheet.pep_self_details = text("pep_self_details");
        sheet.pep_related = flag("pep_related");
        sheet.pep_related_details = text("pep_related_details");
        sheet.sanctions_links = flag("sanctions_links");
        sheet.sanctions_links_details = text("sanctions_links_details");
        sheet.high_risk_country = flag("high_risk_country");
        sheet.high_risk_country_code = text("high_risk_country_code");
        sheet.funds_sources = statement
            .try_get::<Option<Vec<String>>, _>("funds_sources")
            .ok()
            .flatten()
            .unwrap_or_default();
        sheet.funds_description = text("funds_description");
    }
    // Without the payer's own reason the patient's words in block B ("why a
    // third person pays") stand in, marked as such.
    if sheet.payment_reason.is_none()
        && let Some(reason) = lead_text("payment_background")
    {
        sheet.payment_reason = Some(reason);
        sheet.payment_reason_from_patient = true;
    }
    // The payer's own answers and staff's review of the payer (owner
    // decision 2026-10-23); the patient's review never counts here.
    sheet.pep_review = crate::services::pep_review::review_of(
        wizard_state
            .get("aml_enhanced_due_diligence")
            .unwrap_or(&Value::Null),
        crate::services::pep_review::SUBJECT_PAYER,
    );
    sheet.politically_exposed = politically_exposed(&sheet);
    let mut risk_countries: Vec<String> = Vec::new();
    risk_countries.extend(sheet.country.clone());
    risk_countries.extend(sheet.id_issuing_country.clone());
    risk_countries.extend(
        sheet
            .beneficial_owners
            .iter()
            .filter_map(|owner| owner_text(owner, "country")),
    );
    // "Hochrisiko-Drittstaat": a country of the configured lists of high-risk
    // third countries (list 1, the long list, and list 2, the black list);
    // the retired payer question (owner 2026-10-22) does not count.
    sheet.high_risk_third_country = aml.high_risk_country_transaction
        || aml.high_risk_country_resident
        || !aml.triggered_countries.is_empty()
        || risk_countries
            .iter()
            .any(|country| risk_config.list_of(country).is_some());
    Ok(Some(sheet))
}

/// The sheet for `POST /documents/generate`: `None` when the payer is a
/// natural person (the sheet for natural persons is generated instead).
pub(super) async fn load_for_generation(
    state: &AppState,
    lead_id: Uuid,
    reviewer: Uuid,
) -> Result<Option<LegalEntitySheet>, axum::response::Response> {
    let failed = |error: sqlx::Error| {
        tracing::error!(%error, %lead_id, "load GwG legal entity sheet");
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to load the identification sheet data",
        )
    };
    // `failed` captures only the lead id: it is `Copy` and serves twice.
    let mut conn = state.db.acquire().await.map_err(failed)?;
    load(&mut conn, lead_id, Some(reviewer))
        .await
        .map_err(failed)
}

/// What the signature of a legal-entity sheet of the lead still lacks
/// ([`missing_fields`]); `payer_not_an_organisation` when the payer named now
/// is no longer a company, an organisation or an insurer (the sheet is
/// outdated). Call inside the operation's transaction.
pub(crate) async fn signature_missing(
    conn: &mut sqlx::PgConnection,
    lead_id: Uuid,
) -> Result<Vec<String>, sqlx::Error> {
    Ok(match load(conn, lead_id, None).await? {
        Some(sheet) => missing_fields(&sheet, crate::app_time::today()),
        None => vec!["payer_not_an_organisation".to_string()],
    })
}

/// "Dokumentationsbogen juristische Personen · Beispiel GmbH · 22.10.2026".
pub(super) fn document_name(
    organisation: &str,
    generated_at: chrono::DateTime<chrono::Utc>,
) -> String {
    format!(
        "{TITLE} · {organisation} · {}",
        crate::app_time::local(generated_at).format("%d.%m.%Y")
    )
}

/// The sheet in the GMED layout of the sheet for natural persons.
pub(super) fn build_pdf(
    sheet: &LegalEntitySheet,
    agency: &AgencyContractSettings,
    order_number: Option<&str>,
    document_reference: &str,
) -> Result<GeneratedPdf, &'static str> {
    let (document, regular, bold) = new_admin_pdf()?;
    let mut layout = legal_document_pdf_layout(document_reference, agency, regular, bold);
    adult_legal_document_header(
        &mut layout,
        "Dokumentationsbogen",
        "Identifizierung juristischer Personen nach dem Geldwäschegesetz (GwG)",
    );
    layout.text_block_centered(SUBTITLE, 9.5, false, TreatmentPlanPdfColor::Muted, 0.0, 2.0);
    legal_meta_grid(&mut layout, &meta_cells(sheet, &agency.name, order_number));
    for item in content(sheet, crate::app_time::today()) {
        match item {
            SheetItem::Heading(text) => admin_heading(&mut layout, text),
            SheetItem::Value(label, value) => {
                aml_labeled_value(&mut layout, label, value.as_deref())
            }
            SheetItem::Check(checked, text) => aml_checkbox_line(&mut layout, checked, &text),
            SheetItem::YesNo(question, answer) => gwg_answer_line(&mut layout, question, answer),
            SheetItem::Note(text) => layout.text_block_justified(
                &text,
                9.0,
                false,
                3.0,
                TreatmentPlanPdfColor::Muted,
                1.0,
                1.0,
            ),
        }
    }
    let review_date = sheet.review_date.format("%d.%m.%Y").to_string();
    let reviewer = aml_binding_value(Some(sheet.reviewer_name.as_str()));
    gwg_reviewer_signature_line(&mut layout, &review_date, reviewer);
    Ok(finalize_generated_pdf(document, layout))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn day(year: i32, month: u32, day: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(year, month, day).unwrap()
    }

    /// A paying company whose answers through the link are complete.
    fn complete() -> LegalEntitySheet {
        LegalEntitySheet {
            payer_type: Some("company".to_string()),
            organisation_name: Some("Beispiel GmbH".to_string()),
            legal_form: Some("GmbH".to_string()),
            register_court: Some("Amtsgericht Köln".to_string()),
            register_number: Some("HRB 12345".to_string()),
            street: Some("Ringstr. 9".to_string()),
            zip: Some("1010".to_string()),
            city: Some("Wien".to_string()),
            country: Some("AT".to_string()),
            representative_name: Some("Erika Zahler".to_string()),
            representative_role: Some("Geschäftsführerin".to_string()),
            id_document_type: Some("passport".to_string()),
            id_document_number: Some("P1234567".to_string()),
            id_issuing_authority: Some("BH Wien".to_string()),
            id_issuing_country: Some("AT".to_string()),
            id_issued_on: Some(day(2020, 1, 15)),
            id_valid_until: Some(day(2030, 1, 14)),
            id_document_on_file: true,
            statement_submitted_on: Some(day(2026, 10, 20)),
            beneficial_owners: vec![json!({
                "first_name": "Max",
                "last_name": "Eigner",
                "date_of_birth": "1965-03-02",
                "birth_place": "Graz",
                "city": "Wien",
                "country": "AT",
                "share_percent": 60.5
            })],
            payment_reason: Some("Arbeitgeber übernimmt die Behandlung".to_string()),
            pep_self: Some(false),
            pep_related: Some(true),
            pep_related_details: Some("Schwager, Bürgermeister".to_string()),
            sanctions_links: Some(false),
            high_risk_country: Some(false),
            funds_sources: vec!["business_revenue".to_string()],
            treated_person: Some("Anna Muster, geb. 02.04.1980".to_string()),
            reviewer_name: "Bearbeiter Beispiel".to_string(),
            review_date: day(2026, 10, 22),
            ..LegalEntitySheet::default()
        }
    }

    fn value<'a>(items: &'a [SheetItem], label: &str) -> Option<&'a str> {
        items.iter().find_map(|item| match item {
            SheetItem::Value(found, value) if *found == label => {
                Some(value.as_deref().unwrap_or("—"))
            }
            _ => None,
        })
    }

    fn checked(items: &[SheetItem], start: &str) -> Option<bool> {
        items.iter().find_map(|item| match item {
            SheetItem::Check(checked, text) if text.starts_with(start) => Some(*checked),
            _ => None,
        })
    }

    #[test]
    fn the_high_risk_country_line_is_printed_only_for_an_answer_given_before() {
        const LABEL: &str =
            "Bezug zu einem Drittstaat mit hohem Risiko (Angabe des Kostenübernehmers)";
        // An answer stored before the question was dropped stays visible.
        let items = content(&complete(), day(2026, 10, 22));
        assert_eq!(value(&items, LABEL), Some("nein"));
        // Not asked since 2026-10-22: no line with "—".
        let not_asked = LegalEntitySheet {
            high_risk_country: None,
            ..complete()
        };
        let items = content(&not_asked, day(2026, 10, 22));
        assert_eq!(value(&items, LABEL), None);
    }

    #[test]
    fn the_sheet_carries_the_organisation_its_representative_and_owners() {
        let sheet = complete();
        let items = content(&sheet, day(2026, 10, 22));
        assert_eq!(
            value(&items, "Firma, Name oder Bezeichnung"),
            Some("Beispiel GmbH")
        );
        assert_eq!(value(&items, "Rechtsform"), Some("GmbH"));
        assert_eq!(
            value(
                &items,
                "Registergericht und Registernummer (soweit vorhanden)"
            ),
            Some("Amtsgericht Köln, HRB 12345")
        );
        assert_eq!(
            value(&items, "Anschrift des Sitzes bzw. der Hauptniederlassung"),
            Some("Ringstr. 9, 1010 Wien, Österreich")
        );
        assert_eq!(
            value(&items, "Vor- und Nachname (Funktion)"),
            Some("Erika Zahler (Geschäftsführerin)")
        );
        assert_eq!(
            value(
                &items,
                "Ausweisdokument (Art, Nummer, ausstellende Behörde)"
            ),
            Some(
                "Reisepass, Nr. P1234567, ausgestellt von BH Wien (Österreich) am 15.01.2020, gültig bis 14.01.2030"
            )
        );
        assert_eq!(
            checked(&items, "Die erforderliche Kopie"),
            Some(true),
            "a valid document with its copy"
        );
        assert_eq!(
            value(&items, "Name, Vorname des wirtschaftlich Berechtigten"),
            Some("Max Eigner")
        );
        assert_eq!(
            value(&items, "Geburtsdatum, Wohnort"),
            Some("geb. 02.03.1965, in Graz, Wien, Österreich")
        );
        assert_eq!(
            value(&items, "Art und Umfang des wirtschaftlichen Interesses"),
            Some("Anteil 60,5 %")
        );
        assert_eq!(checked(&items, "Folgende natürliche Personen"), Some(true));
        assert_eq!(
            checked(&items, "Es gibt keine natürliche Person"),
            Some(false)
        );
        assert_eq!(
            value(&items, "Zweck der Zahlung (Grund der Kostenübernahme)"),
            Some("Arbeitgeber übernimmt die Behandlung")
        );
        assert_eq!(
            value(
                &items,
                "Familienmitglied oder nahestehende Person einer politisch exponierten Person (Angabe des Kostenübernehmers)"
            ),
            Some("ja – Schwager, Bürgermeister")
        );
        assert_eq!(
            value(
                &items,
                "Verbindungen zu sanktionierten Personen oder Unternehmen (Angabe des Kostenübernehmers)"
            ),
            Some("nein")
        );
        assert_eq!(
            value(&items, "Quelle der Angaben"),
            Some(
                "Angaben des Kostenübernehmers über den eigenen Zugang (abgesendet am 20.10.2026)"
            )
        );
        // The source of funds only with a required enhanced check.
        assert_eq!(
            value(
                &items,
                "Herkunft der Mittel (verstärkte Prüfung erforderlich)"
            ),
            None
        );
        let required = LegalEntitySheet {
            enhanced_check_required: true,
            ..complete()
        };
        assert!(
            value(
                &content(&required, day(2026, 10, 22)),
                "Herkunft der Mittel (verstärkte Prüfung erforderlich)"
            )
            .is_some_and(|line| line != "—")
        );

        let meta = meta_cells(&sheet, "GMED", Some("A-2026-0007"));
        assert!(meta.contains(&("Firma / Name", "Beispiel GmbH".to_string())));
        assert!(meta.contains(&(
            "Rolle in der Geschäftsbeziehung",
            "Kostenübernehmer (Unternehmen)".to_string()
        )));
        assert!(meta.contains(&("Datum", "22.10.2026".to_string())));
        assert!(meta.contains(&(
            "Behandelte Person",
            "Anna Muster, geb. 02.04.1980".to_string()
        )));
        assert!(meta.contains(&("Bearbeiter/in", "Bearbeiter Beispiel".to_string())));
        assert_eq!(
            document_name(
                "Beispiel GmbH",
                chrono::DateTime::parse_from_rfc3339("2026-10-22T10:00:00Z")
                    .unwrap()
                    .with_timezone(&chrono::Utc)
            ),
            "Dokumentationsbogen juristische Personen · Beispiel GmbH · 22.10.2026"
        );
    }

    #[test]
    fn a_complete_sheet_can_be_confirmed_and_gaps_are_named() {
        assert!(missing_fields(&complete(), day(2026, 10, 22)).is_empty());

        // Only what the declaration knows: the payer has not answered yet.
        let declared = LegalEntitySheet {
            payer_type: Some("insurance".to_string()),
            organisation_name: Some("Beispiel Versicherung AG".to_string()),
            street: Some("Ringstr. 9".to_string()),
            city: Some("Wien".to_string()),
            country: Some("AT".to_string()),
            enhanced_check_required: true,
            review_date: day(2026, 10, 22),
            ..LegalEntitySheet::default()
        };
        assert_eq!(
            missing_fields(&declared, day(2026, 10, 22)),
            vec![
                "payer_statement_not_submitted",
                "payer_legal_form",
                "payer_representative_name",
                "payer_id_document_type",
                "payer_id_document_number",
                "payer_id_issuing_authority",
                "payer_id_issuing_country",
                "payer_id_valid_until",
                "payer_id_upload",
                "payer_beneficial_owners",
                "payer_payment_reason",
                "payer_pep",
                "payer_sanctions_links",
                "payer_funds",
            ]
        );
        // The sheet can still be generated and shows the gaps as "—".
        let items = content(&declared, day(2026, 10, 22));
        assert_eq!(value(&items, "Rechtsform"), Some("—"));
        assert_eq!(
            value(&items, "Quelle der Angaben"),
            Some("Angaben zum Zahler in der Anfrage; die Angaben des Kostenübernehmers stehen aus")
        );

        // An expired document is named, and its copy is not ticked as valid.
        let expired = LegalEntitySheet {
            id_valid_until: Some(day(2026, 1, 1)),
            ..complete()
        };
        assert_eq!(
            missing_fields(&expired, day(2026, 10, 22)),
            vec!["payer_id_document_expired"]
        );
        assert_eq!(
            checked(
                &content(&expired, day(2026, 10, 22)),
                "Die erforderliche Kopie"
            ),
            Some(false)
        );

        // "No owner above 25 %" answers the question; the patient's reason
        // stands in for the payer's and is marked.
        let no_owner = LegalEntitySheet {
            beneficial_owners: Vec::new(),
            beneficial_owners_none: Some(true),
            payment_reason: Some("Arbeitgeber".to_string()),
            payment_reason_from_patient: true,
            ..complete()
        };
        assert!(missing_fields(&no_owner, day(2026, 10, 22)).is_empty());
        let items = content(&no_owner, day(2026, 10, 22));
        assert_eq!(
            checked(&items, "Es gibt keine natürliche Person"),
            Some(true)
        );
        assert_eq!(
            value(&items, "Zweck der Zahlung (Grund der Kostenübernahme)"),
            Some("Arbeitgeber (Angabe der Patientin / des Patienten)")
        );
    }

    #[test]
    fn question_b_shows_the_payers_answer_and_staffs_review_apart() {
        use crate::services::pep_review::PepReview;
        // Not reviewed: the payer's own "yes" (a relative of a PEP) answers b).
        let open = complete();
        assert!(politically_exposed(&open));
        assert_eq!(
            value(&content(&open, day(2026, 10, 22)), "Prüfung durch GMED"),
            Some("noch nicht geprüft")
        );
        // Staff checked the payer and found no PEP: b) follows the review,
        // the payer's answer stays printed as the payer's.
        let reviewed = LegalEntitySheet {
            pep_review: PepReview {
                checked: true,
                is_pep: false,
                checked_on: Some(day(2026, 10, 23)),
                checked_by: Some("Anna Prüferin".to_string()),
            },
            ..complete()
        };
        assert!(!politically_exposed(&reviewed));
        let items = content(&reviewed, day(2026, 10, 23));
        assert_eq!(
            value(&items, "Prüfung durch GMED"),
            Some("PEP-Status geprüft am 23.10.2026 von Anna Prüferin – Ergebnis: keine PeP")
        );
        assert_eq!(
            value(
                &items,
                "Familienmitglied oder nahestehende Person einer politisch exponierten Person (Angabe des Kostenübernehmers)"
            ),
            Some("ja – Schwager, Bürgermeister")
        );
        let boxes = |sheet: &LegalEntitySheet| {
            content(sheet, day(2026, 10, 23))
                .into_iter()
                .find_map(|item| match item {
                    SheetItem::YesNo(question, answer) if question.starts_with("b)") => {
                        Some(answer)
                    }
                    _ => None,
                })
                .unwrap()
        };
        assert_eq!(boxes(&reviewed), Some(false));
        assert_eq!(boxes(&open), Some(true));
        // DEV QA 2026-10-30: no answer and no review tick neither box.
        let unanswered = LegalEntitySheet {
            pep_self: None,
            pep_related: None,
            ..complete()
        };
        assert_eq!(boxes(&unanswered), None);
    }

    #[test]
    fn the_sheet_renders_as_a_pdf() {
        let agency = AgencyContractSettings {
            name: "GMED Test".to_string(),
            ..Default::default()
        };
        let generated = build_pdf(
            &complete(),
            &agency,
            Some("A-2026-0007"),
            "GWG-20261022-UNITTEST0001",
        )
        .unwrap();
        assert!(generated.bytes.starts_with(b"%PDF"));
        // The agency signs under "Bearbeiter/in".
        assert!(!generated.signature_anchors.is_empty());
    }
}
