//! Contracting party (Auftraggeber) of a patient's framework contract and
//! orders, and who therefore owes the invoices.
//!
//! An adult patient contracts in their own name. For a minor the default is
//! the legal representatives contracting in their own name for the benefit of
//! the child (Vertrag zugunsten Dritter, § 328 BGB): a minor is only of
//! limited capacity (§§ 106–108 BGB) and its liability from contracts its
//! parents concluded is limited (§ 1629a BGB), so the parents are the
//! debtors — two of them jointly (Gesamtschuldner, § 421 BGB). Staff can still
//! choose the child as the party, represented by its guardians (§ 1629 Abs. 1
//! BGB, both sign under joint custody).
//!
//! The choice is stored on the order (else on its framework contract); when
//! neither names it, it is derived from the patient's age at the given date.
//! See `docs/architecture/invoice-payer-model_ua.md`.

use chrono::{Datelike, NaiveDate};
use serde_json::{Value, json};
use sqlx::{PgConnection, Row};
use uuid::Uuid;

pub const PARTY_PATIENT: &str = "patient";
pub const PARTY_PATIENT_REPRESENTED: &str = "patient_represented";
pub const PARTY_LEGAL_REPRESENTATIVES: &str = "legal_representatives";

/// Accepted values of `contracting_party`.
pub fn is_valid_party_kind(value: &str) -> bool {
    matches!(
        value,
        PARTY_PATIENT | PARTY_PATIENT_REPRESENTED | PARTY_LEGAL_REPRESENTATIVES
    )
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PartyKind {
    Patient,
    PatientRepresented,
    LegalRepresentatives,
}

impl PartyKind {
    pub fn parse(value: &str) -> Option<Self> {
        match value {
            PARTY_PATIENT => Some(Self::Patient),
            PARTY_PATIENT_REPRESENTED => Some(Self::PatientRepresented),
            PARTY_LEGAL_REPRESENTATIVES => Some(Self::LegalRepresentatives),
            _ => None,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Patient => PARTY_PATIENT,
            Self::PatientRepresented => PARTY_PATIENT_REPRESENTED,
            Self::LegalRepresentatives => PARTY_LEGAL_REPRESENTATIVES,
        }
    }
}

/// A parent or guardian recorded as a patient relation.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Representative {
    pub relation_id: Uuid,
    pub related_patient_id: Option<Uuid>,
    pub relation_type: String,
    pub name: String,
    pub first_name: Option<String>,
    pub last_name: Option<String>,
    pub birth_date: Option<NaiveDate>,
    pub email: Option<String>,
    pub phone: Option<String>,
    pub street: Option<String>,
    pub zip: Option<String>,
    pub city: Option<String>,
    pub country: Option<String>,
    pub is_default_payer: bool,
}

impl Representative {
    pub fn address_line(&self) -> Option<String> {
        let locality = [self.zip.as_deref(), self.city.as_deref()]
            .into_iter()
            .flatten()
            .collect::<Vec<_>>()
            .join(" ");
        let parts = [
            self.street.clone(),
            (!locality.is_empty()).then_some(locality),
            self.country.clone(),
        ]
        .into_iter()
        .flatten()
        .collect::<Vec<_>>();
        (!parts.is_empty()).then(|| parts.join(", "))
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ContractingParty {
    pub kind: PartyKind,
    /// Chosen by staff on the order or framework contract (not derived).
    pub explicit: bool,
    pub patient_id: Uuid,
    pub patient_name: String,
    pub patient_is_minor: bool,
    /// The legal representatives: the party for `LegalRepresentatives`, the
    /// representing guardians for `PatientRepresented`.
    pub representatives: Vec<Representative>,
}

fn clean(value: Option<String>) -> Option<String> {
    value
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

/// Whether someone born on `birth_date` is under 18 on `on`.
pub fn is_minor_on(birth_date: Option<NaiveDate>, on: NaiveDate) -> bool {
    let Some(birth_date) = birth_date else {
        return false;
    };
    let mut age = on.year() - birth_date.year();
    if (on.month(), on.day()) < (birth_date.month(), birth_date.day()) {
        age -= 1;
    }
    age < 18
}

/// "A", "A und B", "A, B und C".
pub fn join_names(names: &[String]) -> String {
    match names {
        [] => String::new(),
        [single] => single.clone(),
        [init @ .., last] => format!("{} und {last}", init.join(", ")),
    }
}

impl ContractingParty {
    /// The party's own representatives' names, joined.
    pub fn representative_names(&self) -> String {
        join_names(
            &self
                .representatives
                .iter()
                .map(|representative| representative.name.clone())
                .collect::<Vec<_>>(),
        )
    }

    /// Who owes the agency: the patient, or the legal representatives.
    pub fn debtor_name(&self) -> String {
        match self.kind {
            PartyKind::LegalRepresentatives if !self.representatives.is_empty() => {
                self.representative_names()
            }
            _ => self.patient_name.clone(),
        }
    }

    /// Whether an invoice recipient (as resolved by `invoice_recipient_resolve`)
    /// is the contracting party itself.
    pub fn is_recipient(&self, recipient: &Value) -> bool {
        let kind = recipient.get("kind").and_then(Value::as_str).unwrap_or("");
        let uuid = |key: &str| {
            recipient
                .get(key)
                .and_then(Value::as_str)
                .and_then(|value| Uuid::parse_str(value).ok())
        };
        match self.kind {
            PartyKind::Patient | PartyKind::PatientRepresented => kind == "patient",
            PartyKind::LegalRepresentatives => {
                let relation = uuid("payer_patient_relation_id");
                let person = uuid("person_patient_id").or_else(|| uuid("payer_patient_id"));
                self.representatives.iter().any(|representative| {
                    relation == Some(representative.relation_id)
                        || (person.is_some() && person == representative.related_patient_id)
                })
            }
        }
    }

    /// The representative who receives invoices by default: the one marked as
    /// default payer, else the first recorded.
    pub fn billing_representative(&self) -> Option<&Representative> {
        self.representatives
            .iter()
            .find(|representative| representative.is_default_payer)
            .or_else(|| self.representatives.first())
    }

    pub fn to_json(&self) -> Value {
        json!({
            "kind": self.kind.as_str(),
            "explicit": self.explicit,
            "patient_id": self.patient_id,
            "patient_name": self.patient_name,
            "patient_is_minor": self.patient_is_minor,
            "debtor_name": self.debtor_name(),
            "representatives": self.representatives.iter().map(|representative| json!({
                "relation_id": representative.relation_id,
                "related_patient_id": representative.related_patient_id,
                "relation_type": representative.relation_type,
                "name": representative.name,
                "email": representative.email,
                "address": representative.address_line(),
                "is_default_payer": representative.is_default_payer,
            })).collect::<Vec<_>>(),
        })
    }
}

/// Party chosen on the order, else on the framework contract.
struct StoredChoice {
    kind: Option<PartyKind>,
    relation_ids: Vec<Uuid>,
}

async fn stored_choice(
    conn: &mut PgConnection,
    order_id: Option<Uuid>,
    contract_id: Option<Uuid>,
) -> Result<StoredChoice, sqlx::Error> {
    let mut contract_id = contract_id;
    if let Some(order_id) = order_id
        && let Some(row) = sqlx::query(
            "SELECT contracting_party, contracting_relation_ids, contract_id FROM orders WHERE id = $1",
        )
        .bind(order_id)
        .fetch_optional(&mut *conn)
        .await?
    {
        let kind = row
            .try_get::<Option<String>, _>("contracting_party")
            .unwrap_or_default()
            .and_then(|value| PartyKind::parse(&value));
        if kind.is_some() {
            return Ok(StoredChoice {
                kind,
                relation_ids: row
                    .try_get::<Vec<Uuid>, _>("contracting_relation_ids")
                    .unwrap_or_default(),
            });
        }
        contract_id = contract_id.or(row
            .try_get::<Option<Uuid>, _>("contract_id")
            .unwrap_or_default());
    }
    if let Some(contract_id) = contract_id
        && let Some(row) = sqlx::query(
            "SELECT contracting_party, contracting_relation_ids FROM framework_contracts WHERE id = $1",
        )
        .bind(contract_id)
        .fetch_optional(&mut *conn)
        .await?
    {
        return Ok(StoredChoice {
            kind: row
                .try_get::<Option<String>, _>("contracting_party")
                .unwrap_or_default()
                .and_then(|value| PartyKind::parse(&value)),
            relation_ids: row
                .try_get::<Vec<Uuid>, _>("contracting_relation_ids")
                .unwrap_or_default(),
        });
    }
    Ok(StoredChoice {
        kind: None,
        relation_ids: Vec::new(),
    })
}

/// The patient's recorded parents and guardians, or the named relations.
pub async fn load_representatives(
    conn: &mut PgConnection,
    patient_id: Uuid,
    relation_ids: &[Uuid],
) -> Result<Vec<Representative>, sqlx::Error> {
    let rows = sqlx::query(
        r#"SELECT relation.id, relation.related_patient_id, relation.relation_type,
                  relation.is_default_payer,
                  COALESCE(gmed_person_display_name(NULL, person.first_name, person.last_name),
                           NULLIF(btrim(relation.related_name), '')) AS name,
                  person.first_name, person.last_name, person.birth_date,
                  COALESCE(NULLIF(btrim(relation.email), ''), NULLIF(btrim(person.email), '')) AS email,
                  COALESCE(NULLIF(btrim(relation.phone), ''), NULLIF(btrim(person.phone_primary), '')) AS phone,
                  CASE WHEN has_own THEN relation.address_street ELSE person.address_street END AS street,
                  CASE WHEN has_own THEN relation.address_zip ELSE person.address_zip END AS zip,
                  CASE WHEN has_own THEN relation.address_city ELSE person.address_city END AS city,
                  CASE WHEN has_own THEN relation.address_country ELSE person.address_country END AS country
           FROM patient_relations relation
           LEFT JOIN patients person ON person.id = relation.related_patient_id
           CROSS JOIN LATERAL (
               SELECT COALESCE(NULLIF(btrim(relation.address_street), ''),
                               NULLIF(btrim(relation.address_zip), ''),
                               NULLIF(btrim(relation.address_city), ''),
                               NULLIF(btrim(relation.address_country), '')) IS NOT NULL AS has_own
           ) own
           WHERE relation.patient_id = $1
             AND (
                 (cardinality($2::uuid[]) = 0 AND relation.relation_type IN ('parent', 'guardian'))
                 OR relation.id = ANY($2::uuid[])
             )
           ORDER BY CASE WHEN cardinality($2::uuid[]) > 0
                         THEN array_position($2::uuid[], relation.id) END,
                    relation.is_default_payer DESC, relation.created_at, relation.id"#,
    )
    .bind(patient_id)
    .bind(relation_ids)
    .fetch_all(conn)
    .await?;
    Ok(rows
        .into_iter()
        .map(|row| Representative {
            relation_id: row.try_get("id").unwrap_or_default(),
            related_patient_id: row.try_get("related_patient_id").unwrap_or_default(),
            relation_type: row.try_get("relation_type").unwrap_or_default(),
            name: clean(row.try_get("name").unwrap_or_default()).unwrap_or_default(),
            first_name: clean(row.try_get("first_name").unwrap_or_default()),
            last_name: clean(row.try_get("last_name").unwrap_or_default()),
            birth_date: row.try_get("birth_date").unwrap_or_default(),
            email: clean(row.try_get("email").unwrap_or_default()),
            phone: clean(row.try_get("phone").unwrap_or_default()),
            street: clean(row.try_get("street").unwrap_or_default()),
            zip: clean(row.try_get("zip").unwrap_or_default()),
            city: clean(row.try_get("city").unwrap_or_default()),
            country: clean(row.try_get("country").unwrap_or_default()),
            is_default_payer: row.try_get("is_default_payer").unwrap_or(false),
        })
        .collect())
}

/// The contracting party of an order (or of the patient's framework contract
/// when no order is given), judged at `on` (the contract or invoice date).
pub async fn resolve(
    conn: &mut PgConnection,
    patient_id: Uuid,
    order_id: Option<Uuid>,
    contract_id: Option<Uuid>,
    on: NaiveDate,
) -> Result<ContractingParty, sqlx::Error> {
    let patient = sqlx::query(
        "SELECT gmed_person_display_name(title, first_name, last_name) AS name, birth_date FROM patients WHERE id = $1",
    )
    .bind(patient_id)
    .fetch_optional(&mut *conn)
    .await?;
    let patient_name = patient
        .as_ref()
        .and_then(|row| row.try_get::<Option<String>, _>("name").ok().flatten())
        .unwrap_or_default();
    let patient_is_minor = is_minor_on(
        patient.as_ref().and_then(|row| {
            row.try_get::<Option<NaiveDate>, _>("birth_date")
                .ok()
                .flatten()
        }),
        on,
    );
    let choice = stored_choice(conn, order_id, contract_id).await?;
    let explicit = choice.kind.is_some();
    let kind = choice.kind.unwrap_or(if patient_is_minor {
        PartyKind::LegalRepresentatives
    } else {
        PartyKind::Patient
    });
    let representatives = match kind {
        PartyKind::Patient => Vec::new(),
        _ => load_representatives(conn, patient_id, &choice.relation_ids).await?,
    };
    Ok(ContractingParty {
        kind,
        explicit,
        patient_id,
        patient_name,
        patient_is_minor,
        representatives,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn day(value: &str) -> NaiveDate {
        NaiveDate::parse_from_str(value, "%Y-%m-%d").unwrap()
    }

    fn representative(name: &str, default_payer: bool) -> Representative {
        Representative {
            relation_id: Uuid::new_v4(),
            related_patient_id: Some(Uuid::new_v4()),
            relation_type: "parent".into(),
            name: name.into(),
            is_default_payer: default_payer,
            ..Representative::default()
        }
    }

    fn party(kind: PartyKind, representatives: Vec<Representative>) -> ContractingParty {
        ContractingParty {
            kind,
            explicit: false,
            patient_id: Uuid::new_v4(),
            patient_name: "Mia Muster".into(),
            patient_is_minor: true,
            representatives,
        }
    }

    #[test]
    fn minority_ends_on_the_eighteenth_birthday() {
        assert!(is_minor_on(Some(day("2008-10-02")), day("2026-10-01")));
        assert!(!is_minor_on(Some(day("2008-10-01")), day("2026-10-01")));
        assert!(!is_minor_on(None, day("2026-10-01")));
    }

    #[test]
    fn parents_as_party_are_the_debtors_jointly() {
        let party = party(
            PartyKind::LegalRepresentatives,
            vec![
                representative("Erika Muster", false),
                representative("Max Muster", false),
            ],
        );
        assert_eq!(party.debtor_name(), "Erika Muster und Max Muster");
        assert_eq!(party.billing_representative().unwrap().name, "Erika Muster");
        let represented = ContractingParty {
            kind: PartyKind::PatientRepresented,
            ..party.clone()
        };
        assert_eq!(represented.debtor_name(), "Mia Muster");
        assert_eq!(
            join_names(&["A".into(), "B".into(), "C".into()]),
            "A, B und C"
        );
    }

    #[test]
    fn the_default_payer_representative_receives_the_invoices() {
        let party = party(
            PartyKind::LegalRepresentatives,
            vec![
                representative("Erika Muster", false),
                representative("Max Muster", true),
            ],
        );
        assert_eq!(party.billing_representative().unwrap().name, "Max Muster");
    }

    #[test]
    fn recipient_matches_the_party_by_relation_or_person() {
        let father = representative("Max Muster", false);
        let party = party(PartyKind::LegalRepresentatives, vec![father.clone()]);
        assert!(party.is_recipient(&json!({
            "kind": "relation",
            "payer_patient_relation_id": father.relation_id,
        })));
        assert!(party.is_recipient(&json!({
            "kind": "payer_patient",
            "payer_patient_id": father.related_patient_id,
        })));
        assert!(!party.is_recipient(&json!({ "kind": "patient" })));
        assert!(!party.is_recipient(&json!({ "kind": "contact", "name": "Oma" })));

        let adult = ContractingParty {
            kind: PartyKind::Patient,
            representatives: Vec::new(),
            ..party
        };
        assert!(adult.is_recipient(&json!({ "kind": "patient" })));
        assert!(!adult.is_recipient(&json!({ "kind": "contact" })));
    }
}
