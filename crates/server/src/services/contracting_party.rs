//! Contracting party (Auftraggeber) of a patient's framework contract and
//! orders, and who therefore owes the invoices.
//!
//! An adult patient contracts in their own name. For a minor the default is
//! the legal representatives contracting in their own name for the benefit of
//! the child (Vertrag zugunsten Dritter, § 328 BGB): a minor is only of
//! limited capacity (§§ 106–108 BGB) and its liability from contracts its
//! parents concluded is limited (§ 1629a BGB), so the parents are the
//! debtors — two of them jointly (Gesamtschuldner, § 421 BGB). The contract
//! documents narrow two custody parents to the one the lead's cabinet named
//! as invoice recipient who also pays (owner decision 2026-10-25, see
//! `routes::documents::load_contracting_doc`). Staff can still choose the
//! child as the party, represented by its guardians (§ 1629 Abs. 1 BGB, both
//! sign under joint custody).
//!
//! The choice is stored on the order (else on its framework contract); when
//! neither names it, it is derived from the patient's age at the given date.
//! See `docs/architecture/invoice-payer-model_ua.md`.
//!
//! A court-appointed guardian never contracts in their own name (owner
//! decision 2026-10-25): the ward is the Auftraggeber, represented by the
//! Vormund (minor) or the rechtliche Betreuer (adult) — see
//! [`ContractingParty::court_guardian`] and [`adult_betreuer`]. The contract
//! documents print it so; the invoice side keeps the party resolved here.

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

/// A court-appointed guardian who represents the patient as party: the
/// Vormund of a minor (Bestallungsurkunde), the rechtliche Betreuer of an
/// adult. Both act in the ward's name, never in their own (owner decision
/// 2026-10-25).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CourtGuardian {
    Vormund,
    Betreuer,
}

/// A parent or guardian recorded as a patient relation.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Representative {
    pub relation_id: Uuid,
    pub related_patient_id: Option<Uuid>,
    /// The trusted-contact entry of the lead the relation was made from at
    /// conversion (`patient_relations.source_contact_id`): the id by which
    /// the lead's invoice recipient names this parent.
    pub source_contact_id: Option<Uuid>,
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

    /// The court-appointed guardian when every representative of the party
    /// is a `guardian` relation: a Vormund for a minor, a Betreuer for an
    /// adult. The documents then name the patient as the Auftraggeber,
    /// represented by that guardian, whatever `kind` says (owner decision
    /// 2026-10-25); parents keep contracting in their own name.
    pub fn court_guardian(&self) -> Option<CourtGuardian> {
        (self.kind != PartyKind::Patient
            && !self.representatives.is_empty()
            && self
                .representatives
                .iter()
                .all(|representative| representative.relation_type == "guardian"))
        .then_some(if self.patient_is_minor {
            CourtGuardian::Vormund
        } else {
            CourtGuardian::Betreuer
        })
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
    /// The German day the order was created, when an order was given.
    order_created_on: Option<NaiveDate>,
    /// The day the framework contract was concluded (signed, else created),
    /// when the order's choice is inherited from it.
    inherited_contract_on: Option<NaiveDate>,
}

async fn stored_choice(
    conn: &mut PgConnection,
    order_id: Option<Uuid>,
    contract_id: Option<Uuid>,
) -> Result<StoredChoice, sqlx::Error> {
    let mut contract_id = contract_id;
    let mut order_created_on = None;
    if let Some(order_id) = order_id
        && let Some(row) = sqlx::query(
            "SELECT contracting_party, contracting_relation_ids, contract_id,
                    (created_at AT TIME ZONE 'Europe/Berlin')::date AS created_on
             FROM orders WHERE id = $1",
        )
        .bind(order_id)
        .fetch_optional(&mut *conn)
        .await?
    {
        let kind = row
            .try_get::<Option<String>, _>("contracting_party")
            .unwrap_or_default()
            .and_then(|value| PartyKind::parse(&value));
        order_created_on = row
            .try_get::<Option<NaiveDate>, _>("created_on")
            .unwrap_or_default();
        if kind.is_some() {
            return Ok(StoredChoice {
                kind,
                relation_ids: row
                    .try_get::<Vec<Uuid>, _>("contracting_relation_ids")
                    .unwrap_or_default(),
                order_created_on,
                inherited_contract_on: None,
            });
        }
        contract_id = contract_id.or(row
            .try_get::<Option<Uuid>, _>("contract_id")
            .unwrap_or_default());
    }
    if let Some(contract_id) = contract_id
        && let Some(row) = sqlx::query(
            "SELECT contracting_party, contracting_relation_ids,
                    (COALESCE(signed_at, created_at) AT TIME ZONE 'Europe/Berlin')::date
                        AS concluded_on
             FROM framework_contracts WHERE id = $1",
        )
        .bind(contract_id)
        .fetch_optional(&mut *conn)
        .await?
    {
        return Ok(StoredChoice {
            order_created_on,
            inherited_contract_on: order_created_on.and(
                row.try_get::<Option<NaiveDate>, _>("concluded_on")
                    .unwrap_or_default(),
            ),
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
        order_created_on,
        inherited_contract_on: None,
    })
}

/// Whether an order's party inherited from the framework contract no longer
/// applies (owner decision 2026-10-20): the contract named the parents (or
/// the child represented by them) while the patient was a minor, and the
/// order was created after the 18th birthday. An adult's new order names the
/// patient; a choice staff made on the order itself always stands.
pub fn inherited_minor_choice_lapsed(
    kind: Option<PartyKind>,
    birth_date: Option<NaiveDate>,
    contract_on: Option<NaiveDate>,
    order_created_on: Option<NaiveDate>,
) -> bool {
    let (Some(contract_on), Some(order_created_on)) = (contract_on, order_created_on) else {
        return false;
    };
    matches!(
        kind,
        Some(PartyKind::LegalRepresentatives | PartyKind::PatientRepresented)
    ) && is_minor_on(birth_date, contract_on)
        && !is_minor_on(birth_date, order_created_on)
}

/// Explicit contractual choice, shared by patient and unconverted-lead documents.
pub(crate) async fn selected_kind(
    conn: &mut PgConnection,
    order_id: Option<Uuid>,
    contract_id: Option<Uuid>,
) -> Result<Option<PartyKind>, sqlx::Error> {
    Ok(stored_choice(conn, order_id, contract_id).await?.kind)
}

/// The named relations; without names, the representatives the conversion of
/// the minor's lead stored on the patient (`patients.contracting_relation_ids`,
/// owner decision 2026-10-19: the parents with custody, not every parent on
/// file), else every recorded parent and guardian. Stored relations that no
/// longer exist fall back to the recorded parents and guardians. The stored
/// custody parents apply only while the patient is a minor on `on` (owner
/// decision 2026-10-20: parental custody ends at 18).
pub async fn load_representatives(
    conn: &mut PgConnection,
    patient_id: Uuid,
    relation_ids: &[Uuid],
    on: NaiveDate,
) -> Result<Vec<Representative>, sqlx::Error> {
    let mut adult = false;
    if relation_ids.is_empty() {
        let stored: Vec<Uuid> =
            sqlx::query("SELECT contracting_relation_ids, birth_date FROM patients WHERE id = $1")
                .bind(patient_id)
                .fetch_optional(&mut *conn)
                .await?
                .inspect(|row| {
                    let birth_date = row
                        .try_get::<Option<NaiveDate>, _>("birth_date")
                        .unwrap_or_default();
                    adult = birth_date.is_some() && !is_minor_on(birth_date, on);
                })
                .filter(|row| {
                    // Without a birth date nothing shows that custody ended.
                    let birth_date = row
                        .try_get::<Option<NaiveDate>, _>("birth_date")
                        .unwrap_or_default();
                    birth_date.is_none() || is_minor_on(birth_date, on)
                })
                .map(|row| {
                    row.try_get::<Vec<Uuid>, _>("contracting_relation_ids")
                        .unwrap_or_default()
                })
                .unwrap_or_default();
        if !stored.is_empty() {
            let named = load_relations(&mut *conn, patient_id, &stored, false).await?;
            if !named.is_empty() {
                return Ok(named);
            }
        }
    }
    // An adult is represented by a guardian (Betreuer) only, never by the
    // parents as such (owner decision 2026-10-20).
    load_relations(conn, patient_id, relation_ids, adult).await
}

/// The rechtliche Betreuer of an adult patient (the `guardian` relations),
/// who acts in the adult's name (owner decision 2026-10-25). Empty for a
/// minor on `on`, and for a former ward whose recorded custody is `guardian`:
/// that Vormundschaft ended at 18 and is no Betreuung.
pub async fn adult_betreuer(
    conn: &mut PgConnection,
    patient_id: Uuid,
    on: NaiveDate,
) -> Result<Vec<Representative>, sqlx::Error> {
    let Some(row) = sqlx::query("SELECT birth_date, custody FROM patients WHERE id = $1")
        .bind(patient_id)
        .fetch_optional(&mut *conn)
        .await?
    else {
        return Ok(Vec::new());
    };
    let birth_date = row
        .try_get::<Option<NaiveDate>, _>("birth_date")
        .unwrap_or_default();
    let custody = row
        .try_get::<Option<String>, _>("custody")
        .unwrap_or_default();
    if is_minor_on(birth_date, on) || custody.as_deref() == Some("guardian") {
        return Ok(Vec::new());
    }
    load_relations(conn, patient_id, &[], true).await
}

/// The named relations, or with none named every parent and guardian
/// (`guardians_only`: only the guardians).
async fn load_relations(
    conn: &mut PgConnection,
    patient_id: Uuid,
    relation_ids: &[Uuid],
    guardians_only: bool,
) -> Result<Vec<Representative>, sqlx::Error> {
    let rows = sqlx::query(
        r#"SELECT relation.id, relation.related_patient_id, relation.source_contact_id,
                  relation.relation_type, relation.is_default_payer,
                  COALESCE(gmed_person_display_name(NULL, person.first_name, person.last_name),
                           NULLIF(btrim(relation.related_name), '')) AS name,
                  person.first_name, person.last_name,
                  -- A relation without a patient record keeps the date the
                  -- lead conversion wrote (owner decision 2026-10-19).
                  COALESCE(person.birth_date, relation.birth_date) AS birth_date,
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
                 (cardinality($2::uuid[]) = 0 AND relation.relation_type IN ('parent', 'mother', 'father', 'guardian')
                  AND (NOT $3 OR relation.relation_type = 'guardian'))
                 OR relation.id = ANY($2::uuid[])
             )
           ORDER BY CASE WHEN cardinality($2::uuid[]) > 0
                         THEN array_position($2::uuid[], relation.id) END,
                    relation.is_default_payer DESC, relation.created_at, relation.id"#,
    )
    .bind(patient_id)
    .bind(relation_ids)
    .bind(guardians_only)
    .fetch_all(conn)
    .await?;
    Ok(rows
        .into_iter()
        .map(|row| Representative {
            relation_id: row.try_get("id").unwrap_or_default(),
            related_patient_id: row.try_get("related_patient_id").unwrap_or_default(),
            source_contact_id: row.try_get("source_contact_id").unwrap_or_default(),
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
    let birth_date = patient.as_ref().and_then(|row| {
        row.try_get::<Option<NaiveDate>, _>("birth_date")
            .ok()
            .flatten()
    });
    let patient_is_minor = is_minor_on(birth_date, on);
    let mut choice = stored_choice(conn, order_id, contract_id).await?;
    if inherited_minor_choice_lapsed(
        choice.kind,
        birth_date,
        choice.inherited_contract_on,
        choice.order_created_on,
    ) {
        choice.kind = None;
        choice.relation_ids.clear();
    }
    let explicit = choice.kind.is_some();
    let kind = choice.kind.unwrap_or(if patient_is_minor {
        PartyKind::LegalRepresentatives
    } else {
        PartyKind::Patient
    });
    let representatives = match kind {
        PartyKind::Patient => Vec::new(),
        _ => load_representatives(conn, patient_id, &choice.relation_ids, on).await?,
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
    fn a_framework_contract_of_the_minor_does_not_name_the_parents_on_an_adults_new_order() {
        let birth = Some(day("2008-10-20"));
        let parents = Some(PartyKind::LegalRepresentatives);
        // Contract concluded by the parents while the child was a minor.
        let contract_on = Some(day("2026-05-01"));
        // Order created on the 18th birthday: the patient contracts.
        assert!(inherited_minor_choice_lapsed(
            parents,
            birth,
            contract_on,
            Some(day("2026-10-20"))
        ));
        assert!(inherited_minor_choice_lapsed(
            Some(PartyKind::PatientRepresented),
            birth,
            contract_on,
            Some(day("2027-01-10"))
        ));
        // An order created before the birthday keeps the parents.
        assert!(!inherited_minor_choice_lapsed(
            parents,
            birth,
            contract_on,
            Some(day("2026-10-19"))
        ));
        // A representation chosen for the adult (e.g. a Betreuer) stands.
        assert!(!inherited_minor_choice_lapsed(
            Some(PartyKind::PatientRepresented),
            birth,
            Some(day("2026-11-01")),
            Some(day("2026-12-01"))
        ));
        // The patient as party, or no inherited choice, never lapses.
        assert!(!inherited_minor_choice_lapsed(
            Some(PartyKind::Patient),
            birth,
            contract_on,
            Some(day("2026-12-01"))
        ));
        assert!(!inherited_minor_choice_lapsed(
            parents,
            birth,
            None,
            Some(day("2026-12-01"))
        ));
        assert!(!inherited_minor_choice_lapsed(
            parents,
            birth,
            contract_on,
            None
        ));
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
    fn a_court_appointed_guardian_represents_the_ward_and_parents_stay_the_party() {
        let guardian = Representative {
            relation_type: "guardian".into(),
            ..representative("Greta Vormund", false)
        };
        let ward = party(PartyKind::LegalRepresentatives, vec![guardian.clone()]);
        assert_eq!(ward.court_guardian(), Some(CourtGuardian::Vormund));
        let adult = ContractingParty {
            kind: PartyKind::PatientRepresented,
            patient_is_minor: false,
            ..ward.clone()
        };
        assert_eq!(adult.court_guardian(), Some(CourtGuardian::Betreuer));
        // Parents, a parent beside the guardian, or the patient alone: no
        // court-appointed representation.
        let parents = party(
            PartyKind::LegalRepresentatives,
            vec![representative("Erika Muster", false)],
        );
        assert_eq!(parents.court_guardian(), None);
        let mixed = party(
            PartyKind::LegalRepresentatives,
            vec![guardian, representative("Erika Muster", false)],
        );
        assert_eq!(mixed.court_guardian(), None);
        let alone = ContractingParty {
            kind: PartyKind::Patient,
            ..ward
        };
        assert_eq!(alone.court_guardian(), None);
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
