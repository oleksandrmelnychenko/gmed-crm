//! The source of funds of a lead: one source per person (owner decision
//! 2026-10-23).
//!
//! - The patient's own funds (the patient pays) are one record on the payer
//!   declaration: `self_funds_source` ([`lead_payer::STATED_FUNDS_SOURCES`])
//!   and `self_funds_description`. The lead answers it in the cabinet; staff
//!   complete or correct the same record in the AML form of the lead wizard
//!   (`self_funds_entered_by`: `lead` or `staff`, audited by the save that
//!   writes it). Staff's earlier choice `source_of_funds` and the AML form's
//!   free text `assetOrigin` were copied into it by migration
//!   `20261023120000_lead_funds_single_source` and are history only.
//! - The payer's funds (a third party, a paying parent) are the payer's own
//!   statement (`lead_payer_statements`, sent): the sources and the words.
//!   Until the payer has sent it, staff's entry on the declaration
//!   (`source_of_funds`) stands in, marked as entered by staff. What the
//!   patient said of the payer's funds (`payer_funds_*_stated`) is context
//!   ("Angabe des Patienten"), never the payer's answer.
//!
//! [`lead_funds`] is the one function every reader uses: the readiness of the
//! declaration (`payer_source_of_funds_missing`), the enhanced due-diligence
//! PDF ("Herkunft der eingesetzten Vermögenswerte"), the lead's GwG sheet and
//! the wizard's AML form (`GET /leads/{id}/payer-declaration`, key `funds`).
//! Whether the source of funds is asked at all stays the rule of the enhanced
//! check (`lead_enhanced_check`); nothing here tells the lead why.

use chrono::{DateTime, Utc};
use serde_json::{Value, json};
use sqlx::{PgConnection, Row};
use uuid::Uuid;

use super::lead_payer::{self, Declaration};

/// Who wrote the funds of a person.
pub(crate) const ENTERED_BY_LEAD: &str = "lead";
pub(crate) const ENTERED_BY_STAFF: &str = "staff";
pub(crate) const ENTERED_BY_PAYER: &str = "payer";

/// Whose funds.
pub(crate) const PERSON_PATIENT: &str = "patient";
pub(crate) const PERSON_PAYER: &str = "payer";

/// What the payer sent about its funds (`lead_payer_statements`, only a sent
/// statement counts; a draft is no answer).
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub(crate) struct StatementFunds {
    pub sources: Vec<String>,
    pub description: Option<String>,
}

impl StatementFunds {
    fn answered(&self) -> bool {
        !self.sources.is_empty() || present(self.description.as_deref()).is_some()
    }
}

/// One proof of the funds: a portal upload of the lead or of the payer, or
/// staff's upload on the declaration.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct FundsProof {
    pub document_id: Uuid,
    pub file_name: Option<String>,
    pub uploaded_at: Option<DateTime<Utc>>,
}

/// The effective funds of one person.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct PersonFunds {
    /// [`PERSON_PATIENT`] or [`PERSON_PAYER`].
    pub person: &'static str,
    /// The patient's one choice of [`lead_payer::STATED_FUNDS_SOURCES`]; the
    /// payer's choices of the payer questionnaire (or staff's one of
    /// [`lead_payer::SOURCE_OF_FUNDS`]).
    pub sources: Vec<String>,
    pub description: Option<String>,
    /// [`ENTERED_BY_LEAD`], [`ENTERED_BY_STAFF`] or [`ENTERED_BY_PAYER`];
    /// `None` while nothing is stated.
    pub entered_by: Option<&'static str>,
    pub proofs: Vec<FundsProof>,
}

impl PersonFunds {
    fn empty(person: &'static str) -> Self {
        Self {
            person,
            sources: Vec::new(),
            description: None,
            entered_by: None,
            proofs: Vec::new(),
        }
    }

    /// Stated: a source, and the words with `other`.
    pub(crate) fn stated(&self) -> bool {
        !self.sources.is_empty()
            && (!self.sources.iter().any(|source| source == "other")
                || present(self.description.as_deref()).is_some())
    }

    /// The German labels of the sources.
    pub(crate) fn source_labels(&self) -> Vec<String> {
        self.sources
            .iter()
            .map(|source| {
                if self.person == PERSON_PATIENT {
                    lead_payer::stated_funds_source_label(source).to_string()
                } else {
                    super::lead_payer_link::funds_source_label(source).to_string()
                }
            })
            .collect()
    }

    /// The one line the documents print: "Einkommen: Gehalt als Lehrerin";
    /// `None` while nothing is stated.
    pub(crate) fn text(&self) -> Option<String> {
        let labels = self.source_labels().join(", ");
        let words = present(self.description.as_deref());
        match (labels.is_empty(), words) {
            (false, Some(words)) => Some(format!("{labels}: {words}")),
            (false, None) => Some(labels),
            (true, Some(words)) => Some(words.to_string()),
            (true, None) => None,
        }
    }

    fn to_json(&self) -> Value {
        json!({
            "person": self.person,
            "sources": self.sources,
            "description": self.description,
            "entered_by": self.entered_by,
            "stated": self.stated(),
            "text": self.text(),
            "proof_documents": self.proofs.iter().map(|proof| json!({
                "id": proof.document_id,
                "file_name": proof.file_name,
                "uploaded_at": proof.uploaded_at.map(|at| at.to_rfc3339()),
            })).collect::<Vec<_>>(),
        })
    }
}

/// The funds of a lead per person.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct LeadFunds {
    /// Somebody else pays: a third party or a minor's parent.
    pub payer_pays: bool,
    pub patient: PersonFunds,
    /// The paying third party or parent; `None` while the patient pays.
    pub payer: Option<PersonFunds>,
    /// What the patient said of the payer's funds: context only.
    pub payer_stated_by_patient: Option<PersonFunds>,
    /// Owner decision 2026-10-23: while a paying third party or parent has
    /// not sent the own-link questionnaire, staff's earlier words on the
    /// payer's funds — the declaration's `source_of_funds` (+ words) and the
    /// AML form's free text `wizard_state.aml_enhanced_due_diligence.assetOrigin`
    /// ([`LeadFunds::add_legacy_asset_origin`]) — are shown on the enhanced
    /// due-diligence PDF as "Angabe von GMED". Display only: never copied into
    /// the payer's data; `None` once the payer answered.
    pub staff_note_before_payer: Option<String>,
}

/// The mark of [`LeadFunds::staff_note_before_payer`] on the documents.
pub(crate) const STAFF_NOTE_BEFORE_PAYER_LABEL: &str =
    "Angabe von GMED (vor Antwort der zahlenden Person)";

impl LeadFunds {
    /// Whether the paying third party or parent has answered its funds.
    fn payer_answered(&self) -> bool {
        self.payer
            .as_ref()
            .is_some_and(|payer| payer.entered_by == Some(ENTERED_BY_PAYER))
    }

    /// Adds staff's free text of the AML form (legacy
    /// `wizard_state.aml_enhanced_due_diligence.assetOrigin`) to
    /// [`LeadFunds::staff_note_before_payer`] while somebody else pays and
    /// has not answered yet.
    pub(crate) fn add_legacy_asset_origin(&mut self, asset_origin: Option<&str>) {
        if !self.payer_pays || self.payer_answered() {
            return;
        }
        let Some(words) = present(asset_origin) else {
            return;
        };
        self.staff_note_before_payer = match self.staff_note_before_payer.take() {
            Some(note) if note.contains(words) => Some(note),
            Some(note) => Some(format!("{note}; {words}")),
            None => Some(words.to_string()),
        };
    }

    /// The line "Herkunft der eingesetzten Vermögenswerte" of the enhanced
    /// due-diligence PDF: the payer's own answer once sent; before it staff's
    /// words marked [`STAFF_NOTE_BEFORE_PAYER_LABEL`]; else the funds of the
    /// person who pays.
    pub(crate) fn asset_origin_line(&self) -> Option<String> {
        if self.payer_pays
            && !self.payer_answered()
            && let Some(note) = self.staff_note_before_payer.as_deref()
        {
            return Some(format!("{STAFF_NOTE_BEFORE_PAYER_LABEL}: {note}"));
        }
        self.relevant().text()
    }

    /// The person whose funds are asked: the payer when somebody else pays,
    /// else the patient.
    pub(crate) fn relevant(&self) -> &PersonFunds {
        self.payer
            .as_ref()
            .filter(|_| self.payer_pays)
            .unwrap_or(&self.patient)
    }

    pub(crate) fn to_json(&self) -> Value {
        json!({
            "payer_pays": self.payer_pays,
            "relevant": self.relevant().person,
            "patient": self.patient.to_json(),
            "payer": self.payer.as_ref().map(PersonFunds::to_json),
            "payer_stated_by_patient": self.payer_stated_by_patient.as_ref().map(PersonFunds::to_json),
            "staff_note_before_payer": self.staff_note_before_payer,
        })
    }
}

fn present(value: Option<&str>) -> Option<&str> {
    value.map(str::trim).filter(|value| !value.is_empty())
}

/// The effective funds per person of a declaration and the payer's sent
/// statement (without the proofs; [`load_lead_funds`] adds them).
pub(crate) fn lead_funds(
    declaration: Option<&Declaration>,
    statement: Option<&StatementFunds>,
) -> LeadFunds {
    let Some(declaration) = declaration else {
        return LeadFunds {
            payer_pays: false,
            patient: PersonFunds::empty(PERSON_PATIENT),
            payer: None,
            payer_stated_by_patient: None,
            staff_note_before_payer: None,
        };
    };
    let payer_pays = declaration.payer_kind != lead_payer::PAYER_KIND_SELF;
    let mut patient = PersonFunds::empty(PERSON_PATIENT);
    if !payer_pays {
        patient.sources = declaration.self_funds_source.iter().cloned().collect();
        patient.description =
            present(declaration.self_funds_description.as_deref()).map(str::to_string);
        if !patient.sources.is_empty() || patient.description.is_some() {
            patient.entered_by = Some(
                if declaration.self_funds_entered_by.as_deref() == Some(ENTERED_BY_STAFF) {
                    ENTERED_BY_STAFF
                } else {
                    ENTERED_BY_LEAD
                },
            );
        }
    }
    let payer = payer_pays.then(|| {
        let mut payer = PersonFunds::empty(PERSON_PAYER);
        match statement.filter(|statement| statement.answered()) {
            Some(statement) => {
                payer.sources.clone_from(&statement.sources);
                payer.description = present(statement.description.as_deref()).map(str::to_string);
                payer.entered_by = Some(ENTERED_BY_PAYER);
            }
            None => {
                // Staff's entry while the payer has not answered.
                payer.sources = declaration.source_of_funds.iter().cloned().collect();
                payer.description =
                    present(declaration.source_of_funds_description.as_deref()).map(str::to_string);
                if !payer.sources.is_empty() || payer.description.is_some() {
                    payer.entered_by = Some(ENTERED_BY_STAFF);
                }
            }
        }
        payer
    });
    let payer_stated_by_patient = (declaration.is_third_party()
        && (declaration.payer_funds_source_stated.is_some()
            || present(declaration.payer_funds_description_stated.as_deref()).is_some()))
    .then(|| PersonFunds {
        // The patient's words use the patient's list of sources.
        person: PERSON_PATIENT,
        sources: declaration
            .payer_funds_source_stated
            .iter()
            .cloned()
            .collect(),
        description: present(declaration.payer_funds_description_stated.as_deref())
            .map(str::to_string),
        entered_by: Some(ENTERED_BY_LEAD),
        proofs: Vec::new(),
    });
    // Staff's stand-in entry is also the note shown before the payer answers.
    let staff_note_before_payer = payer
        .as_ref()
        .filter(|payer| payer.entered_by == Some(ENTERED_BY_STAFF))
        .and_then(PersonFunds::text);
    LeadFunds {
        payer_pays,
        patient,
        payer,
        payer_stated_by_patient,
        staff_note_before_payer,
    }
}

/// The payer's sent statement of its funds; `None` while nothing is sent.
pub(crate) async fn load_statement_funds(
    conn: &mut PgConnection,
    lead_id: Uuid,
) -> Result<Option<StatementFunds>, sqlx::Error> {
    let row = sqlx::query(
        r#"SELECT funds_sources, funds_description
           FROM lead_payer_statements
           WHERE lead_id = $1 AND submitted_at IS NOT NULL"#,
    )
    .bind(lead_id)
    .fetch_optional(&mut *conn)
    .await?;
    Ok(row.map(|row| StatementFunds {
        sources: row
            .try_get::<Option<Vec<String>>, _>("funds_sources")
            .ok()
            .flatten()
            .unwrap_or_default(),
        description: row.try_get("funds_description").unwrap_or_default(),
    }))
}

/// The effective funds of a lead with their proofs; `None` without a payer
/// declaration.
pub(crate) async fn load_lead_funds(
    conn: &mut PgConnection,
    lead_id: Uuid,
) -> Result<Option<LeadFunds>, sqlx::Error> {
    let declaration = lead_payer::load_declaration(&mut *conn, lead_id).await?;
    match declaration {
        Some(declaration) => Ok(Some(
            load_for_declaration(conn, lead_id, &declaration).await?,
        )),
        None => Ok(None),
    }
}

/// [`load_lead_funds`] of a patient: the declaration of the most recently
/// converted lead ([`lead_payer::patient_declaration`]).
pub(crate) async fn load_patient_funds(
    conn: &mut PgConnection,
    patient_id: Uuid,
) -> Result<Option<LeadFunds>, sqlx::Error> {
    match lead_payer::patient_declaration(&mut *conn, patient_id).await? {
        Some(found) => Ok(Some(
            load_for_declaration(conn, found.lead_id, &found.declaration).await?,
        )),
        None => Ok(None),
    }
}

async fn load_for_declaration(
    conn: &mut PgConnection,
    lead_id: Uuid,
    declaration: &Declaration,
) -> Result<LeadFunds, sqlx::Error> {
    let statement = load_statement_funds(&mut *conn, lead_id).await?;
    let mut funds = lead_funds(Some(declaration), statement.as_ref());
    if funds.payer_pays && !funds.payer_answered() {
        let asset_origin: Option<String> = sqlx::query_scalar(
            r#"SELECT CASE
                   WHEN jsonb_typeof(wizard_state -> 'aml_enhanced_due_diligence') = 'object'
                   THEN wizard_state -> 'aml_enhanced_due_diligence' ->> 'assetOrigin'
               END
               FROM leads WHERE id = $1"#,
        )
        .bind(lead_id)
        .fetch_optional(&mut *conn)
        .await?
        .flatten();
        funds.add_legacy_asset_origin(asset_origin.as_deref());
    }
    let rows = sqlx::query(
        r#"SELECT u.document_id, u.kind, u.created_at,
                  COALESCE(NULLIF(BTRIM(d.original_filename), ''), d.auto_name) AS file_name
           FROM lead_portal_uploads u
           JOIN documents d ON d.id = u.document_id
           WHERE u.lead_id = $1
             AND u.kind IN ('self_funds_proof', 'payer_funds_proof')
             AND u.withdrawn_at IS NULL
             AND d.file_deleted_at IS NULL
           ORDER BY u.created_at, u.document_id"#,
    )
    .bind(lead_id)
    .fetch_all(&mut *conn)
    .await?;
    for row in &rows {
        let kind: String = row.try_get("kind")?;
        let proof = FundsProof {
            document_id: row.try_get("document_id")?,
            file_name: row.try_get("file_name").unwrap_or_default(),
            uploaded_at: row.try_get("created_at").ok(),
        };
        if kind == super::lead_portal_intake::SELF_FUNDS_PROOF_KIND {
            if !funds.payer_pays {
                funds.patient.proofs.push(proof);
            }
        } else if let Some(payer) = funds.payer.as_mut() {
            payer.proofs.push(proof);
        }
    }
    // Staff's upload on the declaration belongs to the person whose funds
    // are asked.
    if let Some(document_id) = declaration.source_of_funds_document_id {
        let row = sqlx::query(
            r#"SELECT id, created_at,
                      COALESCE(NULLIF(BTRIM(original_filename), ''), auto_name) AS file_name
               FROM documents
               WHERE id = $1 AND file_deleted_at IS NULL"#,
        )
        .bind(document_id)
        .fetch_optional(&mut *conn)
        .await?;
        if let Some(row) = row {
            let proof = FundsProof {
                document_id,
                file_name: row.try_get("file_name").unwrap_or_default(),
                uploaded_at: row.try_get("created_at").ok(),
            };
            // `payer` is set exactly while somebody else pays.
            let person = match funds.payer.as_mut() {
                Some(payer) => payer,
                None => &mut funds.patient,
            };
            if !person
                .proofs
                .iter()
                .any(|known| known.document_id == document_id)
            {
                person.proofs.push(proof);
            }
        }
    }
    Ok(funds)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn own(source: Option<&str>, words: Option<&str>, by: Option<&str>) -> Declaration {
        Declaration {
            payer_kind: lead_payer::PAYER_KIND_SELF.to_string(),
            self_funds_source: source.map(str::to_string),
            self_funds_description: words.map(str::to_string),
            self_funds_entered_by: by.map(str::to_string),
            ..Declaration::default()
        }
    }

    fn third_party() -> Declaration {
        Declaration {
            payer_kind: lead_payer::PAYER_KIND_THIRD_PARTY.to_string(),
            payer_type: Some(lead_payer::PAYER_TYPE_PERSON.to_string()),
            first_name: Some("Viktor".into()),
            last_name: Some("Zahler".into()),
            ..Declaration::default()
        }
    }

    #[test]
    fn the_patient_who_pays_has_one_record_whoever_entered_it() {
        let lead = lead_funds(
            Some(&own(Some("income"), Some(" Gehalt als Lehrerin "), None)),
            None,
        );
        assert!(!lead.payer_pays);
        assert_eq!(lead.payer, None);
        assert_eq!(lead.relevant().person, PERSON_PATIENT);
        assert_eq!(lead.patient.entered_by, Some(ENTERED_BY_LEAD));
        assert!(lead.patient.stated());
        assert_eq!(
            lead.patient.text().as_deref(),
            Some("Einkommen: Gehalt als Lehrerin")
        );

        let staff = lead_funds(
            Some(&own(Some("savings"), None, Some(ENTERED_BY_STAFF))),
            None,
        );
        assert_eq!(staff.patient.entered_by, Some(ENTERED_BY_STAFF));
        assert_eq!(staff.patient.text().as_deref(), Some("Ersparnisse"));

        // "Other" needs the words.
        let other = lead_funds(Some(&own(Some("other"), Some("  "), None)), None);
        assert!(!other.patient.stated());
        assert_eq!(other.patient.text().as_deref(), Some("Sonstiges"));

        // Staff's earlier choice on the declaration is history, never the
        // patient's funds.
        let legacy = Declaration {
            source_of_funds: Some("employment".into()),
            ..own(None, None, None)
        };
        let legacy = lead_funds(Some(&legacy), None);
        assert!(!legacy.patient.stated());
        assert_eq!(legacy.patient.entered_by, None);
        assert_eq!(legacy.patient.text(), None);
    }

    #[test]
    fn the_payers_funds_are_the_payers_statement_never_the_patients_words() {
        let declaration = Declaration {
            payer_funds_source_stated: Some("inheritance_gift".into()),
            payer_funds_description_stated: Some("Erbe der Großmutter".into()),
            ..third_party()
        };
        let unanswered = lead_funds(Some(&declaration), None);
        assert!(unanswered.payer_pays);
        let payer = unanswered.relevant();
        assert_eq!(payer.person, PERSON_PAYER);
        assert!(!payer.stated(), "the patient's words are no answer");
        assert_eq!(payer.entered_by, None);
        let context = unanswered.payer_stated_by_patient.as_ref().unwrap();
        assert_eq!(
            context.text().as_deref(),
            Some("Erbschaft: Erbe der Großmutter")
        );

        let statement = StatementFunds {
            sources: vec!["employment".into(), "savings".into()],
            description: Some("Gehalt und Sparbuch".into()),
        };
        let answered = lead_funds(Some(&declaration), Some(&statement));
        let payer = answered.relevant();
        assert!(payer.stated());
        assert_eq!(payer.entered_by, Some(ENTERED_BY_PAYER));
        assert_eq!(
            payer.text().as_deref(),
            Some("Gehalt / nichtselbständige Arbeit, Ersparnisse: Gehalt und Sparbuch")
        );
        assert!(!answered.patient.stated(), "the patient does not pay");
    }

    #[test]
    fn staff_stand_in_for_the_payer_only_until_the_payer_answers() {
        let declaration = Declaration {
            source_of_funds: Some("savings".into()),
            ..third_party()
        };
        let staff = lead_funds(Some(&declaration), None);
        assert_eq!(staff.relevant().entered_by, Some(ENTERED_BY_STAFF));
        assert!(staff.relevant().stated());
        // An empty sent statement is no answer either.
        let empty = lead_funds(Some(&declaration), Some(&StatementFunds::default()));
        assert_eq!(empty.relevant().entered_by, Some(ENTERED_BY_STAFF));
        let payer = lead_funds(
            Some(&declaration),
            Some(&StatementFunds {
                sources: vec!["business_revenue".into()],
                description: None,
            }),
        );
        assert_eq!(payer.relevant().entered_by, Some(ENTERED_BY_PAYER));
        assert_eq!(payer.relevant().sources, ["business_revenue"]);
        // A paying parent is the payer too.
        let parent = Declaration {
            payer_kind: lead_payer::PAYER_KIND_REPRESENTATIVE.to_string(),
            ..Declaration::default()
        };
        let parent = lead_funds(Some(&parent), None);
        assert!(parent.payer_pays);
        assert_eq!(parent.relevant().person, PERSON_PAYER);
        assert_eq!(parent.payer_stated_by_patient, None);
    }

    #[test]
    fn staffs_legacy_words_stand_marked_on_the_pdf_until_the_payer_answers() {
        // Staff's AML free text only: shown marked, never the payer's data.
        let mut legacy = lead_funds(Some(&third_party()), None);
        legacy.add_legacy_asset_origin(Some("  Verkauf einer Wohnung in Kyjiw "));
        assert_eq!(
            legacy.staff_note_before_payer.as_deref(),
            Some("Verkauf einer Wohnung in Kyjiw")
        );
        assert!(!legacy.relevant().stated(), "not copied into the payer");
        assert_eq!(legacy.relevant().sources, Vec::<String>::new());
        assert_eq!(legacy.relevant().description, None);
        assert_eq!(
            legacy.asset_origin_line().as_deref(),
            Some(
                "Angabe von GMED (vor Antwort der zahlenden Person): Verkauf einer Wohnung in Kyjiw"
            )
        );
        assert_eq!(
            legacy.to_json()["staff_note_before_payer"],
            "Verkauf einer Wohnung in Kyjiw"
        );

        // Staff's choice on the declaration plus the free text.
        let declaration = Declaration {
            source_of_funds: Some("savings".into()),
            ..third_party()
        };
        let mut both = lead_funds(Some(&declaration), None);
        let staff_text = both.relevant().text().unwrap();
        assert_eq!(
            both.staff_note_before_payer.as_deref(),
            Some(staff_text.as_str())
        );
        both.add_legacy_asset_origin(Some("Sparbuch"));
        assert_eq!(
            both.asset_origin_line(),
            Some(format!(
                "{STAFF_NOTE_BEFORE_PAYER_LABEL}: {staff_text}; Sparbuch"
            ))
        );

        // Once the payer sent the questionnaire only the payer's answer.
        let statement = StatementFunds {
            sources: vec!["employment".into()],
            description: Some("Gehalt".into()),
        };
        let mut answered = lead_funds(Some(&declaration), Some(&statement));
        answered.add_legacy_asset_origin(Some("Sparbuch"));
        assert_eq!(answered.staff_note_before_payer, None);
        assert_eq!(
            answered.asset_origin_line().as_deref(),
            Some("Gehalt / nichtselbständige Arbeit: Gehalt")
        );

        // The patient who pays: staff's legacy text is no note.
        let mut own_funds = lead_funds(Some(&own(Some("income"), Some("Lohn"), None)), None);
        own_funds.add_legacy_asset_origin(Some("alt"));
        assert_eq!(own_funds.staff_note_before_payer, None);
        assert_eq!(
            own_funds.asset_origin_line().as_deref(),
            Some("Einkommen: Lohn")
        );

        // Nothing from staff: the line stays empty.
        let mut empty = lead_funds(Some(&third_party()), None);
        empty.add_legacy_asset_origin(Some("   "));
        assert_eq!(empty.asset_origin_line(), None);
    }

    #[test]
    fn without_a_declaration_nobody_stated_anything() {
        let none = lead_funds(None, None);
        assert!(!none.relevant().stated());
        assert_eq!(none.to_json()["relevant"], "patient");
        assert_eq!(none.to_json()["payer"], Value::Null);
    }
}
