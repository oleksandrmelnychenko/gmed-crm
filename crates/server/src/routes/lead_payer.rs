//! "Кто платит" — the payer declaration of a lead (owner decision 2026-10-03).
//!
//! Part of the compliance step of the lead wizard (GwG § 10 Abs. 1 Nr. 2 and 3,
//! § 11): whether the patient pays or a third party does, whether the patient
//! acts in their own economic interest or for a beneficial owner, the source
//! of the funds, and for a third-party payer the payer's identity, residence
//! and citizenships. One declaration per lead (`lead_payer_declarations`);
//! every change is audited in the transaction that makes it.
//!
//! A third-party payer
//! - becomes the payer of the lead's orders (`orders.payer_*`, role
//!   `cost_bearer`), so invoices and documents use the existing payer model;
//! - signs a Kostenübernahmeerklärung (template `cost_coverage_declaration`),
//!   legally a Schuldbeitritt: the payer joins the patient's debt from the
//!   named order jointly and severally, the patient stays liable;
//! - feeds the AML country risk with residence and citizenships.
//!
//! The third party is a natural person, or a company, an organisation or an
//! insurer (`payer_type`, owner spec "Patientenformular", 2026-10-05): an
//! organisation is named by `organisation_name`, has no natural-person data,
//! and its address is its seat.
//!
//! Hard gate: GMED countersigns the framework contract or the order of a lead
//! (contract status `signed`, order `signed_agency`, a framework contract
//! marked signed, an electronic signature request with an agency signer) only
//! after the client has signed the order and the declaration is complete — for
//! a third party including the signed Kostenübernahmeerklärung. Client and
//! payer sign first, GMED second. See
//! `docs/architecture/lead-payer-declaration_ua.md`.

use axum::{
    Json, Router,
    extract::{Extension, Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::get,
};
use chrono::{DateTime, NaiveDate, SecondsFormat, SubsecRound, Utc};
use serde::{Deserialize, Deserializer};
use serde_json::{Value, json};
use sqlx::{PgConnection, Row, postgres::PgRow};
use uuid::Uuid;

use crate::audit;
use crate::auth::middleware::AuthUser;
use crate::routes::invoices::payer::{
    PAYER_ROLE_COST_BEARER, PayerRecord, is_plausible_email, payer_columns,
};
use crate::services::citizenships::{normalize_citizenships, normalize_country_code};
use crate::state::AppState;
use gmed_domain::access::capabilities::Capability;
use gmed_domain::role::Role;

pub const PAYER_KIND_SELF: &str = "self";
pub const PAYER_KIND_THIRD_PARTY: &str = "third_party";

/// A third-party payer who is a natural person; the other types are
/// organisations.
pub const PAYER_TYPE_PERSON: &str = "person";
/// Who a third-party payer is (`payer_type`).
pub const PAYER_TYPES: &[&str] = &[PAYER_TYPE_PERSON, "company", "organisation", "insurance"];

/// Relationship of the payer to the patient (`relationship_kind`). `other` is
/// described in the free text `relationship`.
pub const RELATIONSHIP_KINDS: &[&str] = &[
    "spouse",
    "parent",
    "child",
    "relative",
    "employer",
    "friend",
    "business_partner",
    RELATIONSHIP_KIND_OTHER,
];
const RELATIONSHIP_KIND_OTHER: &str = "other";

/// Categories of the source of funds (Herkunft der Mittel).
pub const SOURCE_OF_FUNDS: &[&str] = &[
    "employment",
    "business_income",
    "savings",
    "asset_sale",
    "inheritance_gift",
    "other",
];

/// Template of the cost assumption declaration (Kostenübernahmeerklärung).
pub const COST_ASSUMPTION_TEMPLATE: &str = "cost_coverage_declaration";

/// Binding stored on a generated Kostenübernahmeerklärung: the version of the
/// payer it names. A document of an earlier payer no longer counts.
pub const PAYER_IDENTITY_BINDING_KEY: &str = "_payer_identity_version";

const SHORT_TEXT_MAX: usize = 200;
const LONG_TEXT_MAX: usize = 2000;

pub fn router() -> Router<AppState> {
    Router::new().route(
        "/leads/{lead_id}/payer-declaration",
        get(get_payer_declaration).post(save_payer_declaration),
    )
}

// ----------------------------------------------------------------------------
// Declaration
// ----------------------------------------------------------------------------

/// A stored or submitted declaration, normalized.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub(crate) struct Declaration {
    pub payer_kind: String,
    pub acts_on_own_account: bool,
    /// Whether the own-account question was answered at all: by the lead in
    /// the cabinet or by staff. Until then `acts_on_own_account` is only the
    /// column default.
    pub own_account_answered: bool,
    pub beneficial_owner_name: Option<String>,
    pub beneficial_owner_note: Option<String>,
    pub source_of_funds: Option<String>,
    pub source_of_funds_description: Option<String>,
    pub source_of_funds_document_id: Option<Uuid>,
    /// Who the third party is ([`PAYER_TYPES`]); `None` for a self-payer.
    pub payer_type: Option<String>,
    /// Name of the company, organisation or insurer; `None` for a person.
    pub organisation_name: Option<String>,
    pub first_name: Option<String>,
    pub last_name: Option<String>,
    pub date_of_birth: Option<NaiveDate>,
    pub place_of_birth: Option<String>,
    /// Address of the person, or the seat of the organisation.
    pub street: Option<String>,
    pub zip: Option<String>,
    pub city: Option<String>,
    pub country: Option<String>,
    pub citizenships: Vec<String>,
    /// Relationship to the patient ([`RELATIONSHIP_KINDS`]).
    pub relationship_kind: Option<String>,
    /// The relationship in words: for the kind `other`, and what was entered
    /// before the list existed.
    pub relationship: Option<String>,
    pub email: Option<String>,
    pub phone: Option<String>,
    /// Staff confirmed that the payer was informed about the processing of
    /// the payer's data (Art. 14 DSGVO: the data come from the patient side).
    pub payer_informed_at: Option<DateTime<Utc>>,
    pub payer_informed_by: Option<Uuid>,
    /// When the lead agreed in the cabinet that GMED contacts the payer about
    /// the costs and tells the payer the lead's name. Only the lead gives or
    /// removes this consent.
    pub contact_consent_at: Option<DateTime<Utc>>,
}

const DECLARATION_COLUMNS: &str = "payer_kind, acts_on_own_account, own_account_answered, \
     beneficial_owner_name, beneficial_owner_note, source_of_funds, source_of_funds_description, \
     source_of_funds_document_id, payer_type, organisation_name, first_name, last_name, \
     date_of_birth, place_of_birth, street, zip, city, country, citizenships, \
     relationship_kind, relationship, email, phone, payer_informed_at, payer_informed_by, \
     contact_consent_at, identity_changed_at, patient_id, created_at, updated_at";

impl Declaration {
    pub(crate) fn is_third_party(&self) -> bool {
        self.payer_kind == PAYER_KIND_THIRD_PARTY
    }

    /// A company, an organisation or an insurer pays: no natural person.
    pub(crate) fn is_organisation(&self) -> bool {
        self.is_third_party()
            && self
                .payer_type
                .as_deref()
                .is_some_and(|payer_type| payer_type != PAYER_TYPE_PERSON)
    }

    fn from_row(row: &PgRow) -> Self {
        let payer_kind: String = row.try_get("payer_kind").unwrap_or_default();
        // A third party without a type is a person (rows of older servers).
        let payer_type = row
            .try_get::<Option<String>, _>("payer_type")
            .unwrap_or_default()
            .or_else(|| {
                (payer_kind == PAYER_KIND_THIRD_PARTY).then(|| PAYER_TYPE_PERSON.to_string())
            });
        Self {
            payer_kind,
            acts_on_own_account: row.try_get("acts_on_own_account").unwrap_or(true),
            own_account_answered: row.try_get("own_account_answered").unwrap_or(false),
            beneficial_owner_name: row.try_get("beneficial_owner_name").unwrap_or_default(),
            beneficial_owner_note: row.try_get("beneficial_owner_note").unwrap_or_default(),
            source_of_funds: row.try_get("source_of_funds").unwrap_or_default(),
            source_of_funds_description: row
                .try_get("source_of_funds_description")
                .unwrap_or_default(),
            source_of_funds_document_id: row
                .try_get("source_of_funds_document_id")
                .unwrap_or_default(),
            payer_type,
            organisation_name: row.try_get("organisation_name").unwrap_or_default(),
            first_name: row.try_get("first_name").unwrap_or_default(),
            last_name: row.try_get("last_name").unwrap_or_default(),
            date_of_birth: row.try_get("date_of_birth").unwrap_or_default(),
            place_of_birth: row.try_get("place_of_birth").unwrap_or_default(),
            street: row.try_get("street").unwrap_or_default(),
            zip: row.try_get("zip").unwrap_or_default(),
            city: row.try_get("city").unwrap_or_default(),
            country: row.try_get("country").unwrap_or_default(),
            citizenships: row.try_get("citizenships").unwrap_or_default(),
            relationship_kind: row.try_get("relationship_kind").unwrap_or_default(),
            relationship: row.try_get("relationship").unwrap_or_default(),
            email: row.try_get("email").unwrap_or_default(),
            phone: row.try_get("phone").unwrap_or_default(),
            payer_informed_at: row.try_get("payer_informed_at").unwrap_or_default(),
            payer_informed_by: row.try_get("payer_informed_by").unwrap_or_default(),
            contact_consent_at: row.try_get("contact_consent_at").unwrap_or_default(),
        }
    }

    /// Who pays, as the order payer record (a free-text contact with the
    /// payer's address, role `cost_bearer`) and in the cost assumption
    /// declaration: the name of the organisation, or first and last name.
    fn payer_name(&self) -> Option<String> {
        let name = if self.is_organisation() {
            self.organisation_name
                .as_deref()
                .map(str::trim)
                .unwrap_or_default()
                .to_string()
        } else {
            [self.first_name.as_deref(), self.last_name.as_deref()]
                .into_iter()
                .flatten()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .collect::<Vec<_>>()
                .join(" ")
        };
        (!name.is_empty()).then_some(name)
    }

    /// The relationship to the patient in words, for the order payer record:
    /// the free text, otherwise the chosen kind in German like the documents.
    fn relationship_label(&self) -> Option<String> {
        if !blank(&self.relationship) {
            return self.relationship.clone();
        }
        let label = match self.relationship_kind.as_deref()? {
            "spouse" => "Ehepartner/in",
            "parent" => "Elternteil",
            "child" => "Kind",
            "relative" => "Verwandte/r",
            "employer" => "Arbeitgeber",
            "friend" => "Freund/in",
            "business_partner" => "Geschäftspartner/in",
            _ => return None,
        };
        Some(label.to_string())
    }

    /// The fields that name the payer: a change makes an earlier
    /// Kostenübernahmeerklärung name the wrong person or organisation.
    fn identity_key(&self) -> Value {
        json!([
            self.payer_kind,
            self.payer_type,
            self.organisation_name,
            self.first_name,
            self.last_name,
            self.date_of_birth,
            self.street,
            self.zip,
            self.city,
            self.country,
        ])
    }

    fn to_json(&self) -> Value {
        json!({
            "payer_kind": self.payer_kind,
            "acts_on_own_account": self.acts_on_own_account,
            "own_account_answered": self.own_account_answered,
            "beneficial_owner_name": self.beneficial_owner_name,
            "beneficial_owner_note": self.beneficial_owner_note,
            "source_of_funds": self.source_of_funds,
            "source_of_funds_description": self.source_of_funds_description,
            "source_of_funds_document_id": self.source_of_funds_document_id,
            "payer_type": self.payer_type,
            "organisation_name": self.organisation_name,
            "first_name": self.first_name,
            "last_name": self.last_name,
            "date_of_birth": self.date_of_birth.map(|date| date.format("%Y-%m-%d").to_string()),
            "place_of_birth": self.place_of_birth,
            "street": self.street,
            "zip": self.zip,
            "city": self.city,
            "country": self.country,
            "citizenships": self.citizenships,
            "relationship_kind": self.relationship_kind,
            "relationship": self.relationship,
            "email": self.email,
            "phone": self.phone,
            "payer_informed_at": self.payer_informed_at.map(|at| at.to_rfc3339()),
            "payer_informed_by": self.payer_informed_by,
            "contact_consent_at": self.contact_consent_at.map(|at| at.to_rfc3339()),
        })
    }

    /// What is still missing before GMED may countersign, in check order.
    fn missing(&self) -> Vec<PayerReason> {
        let mut reasons = Vec::new();
        if !self.acts_on_own_account && blank(&self.beneficial_owner_name) {
            reasons.push(PayerReason::BeneficialOwnerMissing);
        }
        let source_described = self.source_of_funds.as_deref() != Some("other")
            || !blank(&self.source_of_funds_description);
        if self.source_of_funds.is_none() || !source_described {
            reasons.push(PayerReason::SourceOfFundsMissing);
        }
        // An organisation is identified by its name and seat, a person by
        // name, date of birth, address and citizenship.
        let address_incomplete =
            blank(&self.street) || blank(&self.zip) || blank(&self.city) || self.country.is_none();
        let identity_incomplete = if self.is_organisation() {
            blank(&self.organisation_name) || address_incomplete
        } else {
            blank(&self.first_name)
                || blank(&self.last_name)
                || self.date_of_birth.is_none()
                || address_incomplete
                || self.citizenships.is_empty()
        };
        if self.is_third_party() && identity_incomplete {
            reasons.push(PayerReason::PayerIdentityIncomplete);
        }
        if self.is_third_party() && self.payer_informed_at.is_none() {
            reasons.push(PayerReason::PayerNotInformed);
        }
        reasons
    }
}

fn blank(value: &Option<String>) -> bool {
    value.as_deref().is_none_or(|value| value.trim().is_empty())
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct DeclarationInput {
    payer_kind: String,
    #[serde(default = "default_true")]
    acts_on_own_account: bool,
    beneficial_owner_name: Option<String>,
    beneficial_owner_note: Option<String>,
    source_of_funds: Option<String>,
    source_of_funds_description: Option<String>,
    source_of_funds_document_id: Option<Uuid>,
    /// Payer type, organisation name and relationship kind (2026-10-05): a
    /// key that is left out keeps the stored value, because the staff form of
    /// older clients does not send it; `null` clears it (a third party
    /// without a type is a person).
    #[serde(default, deserialize_with = "sent")]
    payer_type: Option<Option<String>>,
    #[serde(default, deserialize_with = "sent")]
    organisation_name: Option<Option<String>>,
    first_name: Option<String>,
    last_name: Option<String>,
    date_of_birth: Option<String>,
    place_of_birth: Option<String>,
    street: Option<String>,
    zip: Option<String>,
    city: Option<String>,
    country: Option<String>,
    #[serde(default)]
    citizenships: Vec<String>,
    #[serde(default, deserialize_with = "sent")]
    relationship_kind: Option<Option<String>>,
    relationship: Option<String>,
    email: Option<String>,
    phone: Option<String>,
    /// Staff checkbox: the third-party payer was informed about the
    /// processing of their data. The server records who and when.
    #[serde(default)]
    payer_informed: bool,
}

fn default_true() -> bool {
    true
}

/// A key that is present in the body, also with `null`; an absent key stays
/// `None`.
fn sent<'de, D, T>(deserializer: D) -> Result<Option<Option<T>>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    Option::<T>::deserialize(deserializer).map(Some)
}

fn text(value: &Option<String>, max: usize) -> Result<Option<String>, &'static str> {
    match value
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        None => Ok(None),
        Some(value) if value.chars().count() > max => Err("payer_field_too_long"),
        Some(value) => Ok(Some(value.to_string())),
    }
}

/// Validates and normalizes a submitted declaration. An incomplete
/// declaration may be saved; [`Declaration::missing`] says what is missing.
/// Fields that do not apply are cleared (data minimization): no third-party
/// data for a self-payer, no natural-person data for an organisation, no
/// beneficial owner for own account. `previous` supplies the payer type, the
/// organisation name and the relationship kind where the body leaves the key
/// out. The consent to contact the payer is no input: the callers carry it
/// over.
fn declaration_from_input(
    input: &DeclarationInput,
    previous: Option<&Declaration>,
    today: NaiveDate,
) -> Result<Declaration, &'static str> {
    let payer_kind = input.payer_kind.trim();
    if payer_kind != PAYER_KIND_SELF && payer_kind != PAYER_KIND_THIRD_PARTY {
        return Err("payer_kind_invalid");
    }
    let source_of_funds = text(&input.source_of_funds, SHORT_TEXT_MAX)?;
    if source_of_funds
        .as_deref()
        .is_some_and(|value| !SOURCE_OF_FUNDS.contains(&value))
    {
        return Err("source_of_funds_invalid");
    }
    let mut declaration = Declaration {
        payer_kind: payer_kind.to_string(),
        acts_on_own_account: input.acts_on_own_account,
        // The cabinet names the person in one text (name, date and place of
        // birth, address), so the name takes a long text.
        beneficial_owner_name: text(&input.beneficial_owner_name, LONG_TEXT_MAX)?,
        beneficial_owner_note: text(&input.beneficial_owner_note, LONG_TEXT_MAX)?,
        source_of_funds,
        source_of_funds_description: text(&input.source_of_funds_description, LONG_TEXT_MAX)?,
        source_of_funds_document_id: input.source_of_funds_document_id,
        ..Declaration::default()
    };
    if declaration.acts_on_own_account {
        declaration.beneficial_owner_name = None;
        declaration.beneficial_owner_note = None;
    }
    if declaration.is_third_party() {
        // A sent key wins; an absent one keeps what is stored for the third
        // party.
        let stored = previous.filter(|previous| previous.is_third_party());
        let payer_type = match &input.payer_type {
            Some(value) => text(value, SHORT_TEXT_MAX).map_err(|_| "payer_type_invalid")?,
            None => stored.and_then(|stored| stored.payer_type.clone()),
        }
        .unwrap_or_else(|| PAYER_TYPE_PERSON.to_string());
        if !PAYER_TYPES.contains(&payer_type.as_str()) {
            return Err("payer_type_invalid");
        }
        let relationship_kind = match &input.relationship_kind {
            Some(value) => {
                text(value, SHORT_TEXT_MAX).map_err(|_| "payer_relationship_kind_invalid")?
            }
            None => stored.and_then(|stored| stored.relationship_kind.clone()),
        };
        if relationship_kind
            .as_deref()
            .is_some_and(|kind| !RELATIONSHIP_KINDS.contains(&kind))
        {
            return Err("payer_relationship_kind_invalid");
        }
        if payer_type == PAYER_TYPE_PERSON {
            let date_of_birth = match text(&input.date_of_birth, SHORT_TEXT_MAX)? {
                None => None,
                Some(value) => Some(
                    NaiveDate::parse_from_str(&value, "%Y-%m-%d")
                        .map_err(|_| "payer_date_of_birth_invalid")?,
                ),
            };
            if date_of_birth.is_some_and(|date| date > today) {
                return Err("payer_date_of_birth_invalid");
            }
            declaration.first_name = text(&input.first_name, SHORT_TEXT_MAX)?;
            declaration.last_name = text(&input.last_name, SHORT_TEXT_MAX)?;
            declaration.date_of_birth = date_of_birth;
            declaration.place_of_birth = text(&input.place_of_birth, SHORT_TEXT_MAX)?;
            declaration.citizenships = normalize_citizenships(&input.citizenships)
                .map_err(|_| "payer_citizenships_invalid")?;
        } else {
            // A company, an organisation or an insurer: the name instead of
            // the natural-person data, which are not even validated.
            declaration.organisation_name = match &input.organisation_name {
                Some(value) => {
                    text(value, SHORT_TEXT_MAX).map_err(|_| "payer_organisation_name_too_long")?
                }
                None => stored.and_then(|stored| stored.organisation_name.clone()),
            };
        }
        let email = text(&input.email, SHORT_TEXT_MAX)?;
        if email
            .as_deref()
            .is_some_and(|email| !is_plausible_email(email))
        {
            return Err("payer_email_invalid");
        }
        declaration.payer_type = Some(payer_type);
        declaration.street = text(&input.street, SHORT_TEXT_MAX)?;
        declaration.zip = text(&input.zip, SHORT_TEXT_MAX)?;
        declaration.city = text(&input.city, SHORT_TEXT_MAX)?;
        declaration.country = normalize_country_code(input.country.as_deref())
            .map_err(|_| "payer_country_invalid")?;
        // The words describe the kind `other`; with any other kind they go.
        declaration.relationship = if relationship_kind
            .as_deref()
            .is_none_or(|kind| kind == RELATIONSHIP_KIND_OTHER)
        {
            text(&input.relationship, SHORT_TEXT_MAX)?
        } else {
            None
        };
        declaration.relationship_kind = relationship_kind;
        declaration.email = email;
        declaration.phone = text(&input.phone, SHORT_TEXT_MAX)?;
    }
    Ok(declaration)
}

// ----------------------------------------------------------------------------
// Readiness and the agency signature gate
// ----------------------------------------------------------------------------

/// Why GMED may not countersign yet, or what readiness still lists.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum PayerReason {
    DeclarationMissing,
    BeneficialOwnerMissing,
    SourceOfFundsMissing,
    PayerIdentityIncomplete,
    PayerNotInformed,
    CostAssumptionMissing,
    CostAssumptionOutdated,
    CostAssumptionUnsigned,
    ClientOrderSignatureMissing,
}

impl PayerReason {
    pub(crate) fn code(self) -> &'static str {
        match self {
            Self::DeclarationMissing => "payer_declaration_missing",
            Self::BeneficialOwnerMissing => "payer_beneficial_owner_missing",
            Self::SourceOfFundsMissing => "payer_source_of_funds_missing",
            Self::PayerIdentityIncomplete => "payer_identity_incomplete",
            Self::PayerNotInformed => "payer_not_informed",
            Self::CostAssumptionMissing => "cost_assumption_missing",
            Self::CostAssumptionOutdated => "cost_assumption_outdated",
            Self::CostAssumptionUnsigned => "cost_assumption_unsigned",
            Self::ClientOrderSignatureMissing => "client_order_signature_missing",
        }
    }

    /// The readiness reason (the wizard translates these strings).
    pub(crate) fn message(self) -> &'static str {
        match self {
            Self::DeclarationMissing => "Payer declaration is missing",
            Self::BeneficialOwnerMissing => "Beneficial owner is not named",
            Self::SourceOfFundsMissing => "Source of funds is missing",
            Self::PayerIdentityIncomplete => "Third-party payer details are incomplete",
            Self::PayerNotInformed => "Payer is not informed about the processing of their data",
            Self::CostAssumptionMissing => "Cost assumption declaration is missing",
            Self::CostAssumptionOutdated => "Cost assumption declaration names another payer",
            Self::CostAssumptionUnsigned => "Cost assumption declaration is not signed",
            Self::ClientOrderSignatureMissing => "Customer order signature is missing",
        }
    }
}

/// The latest Kostenübernahmeerklärung of the lead.
#[derive(Clone, Debug, Default)]
pub(crate) struct CostAssumptionDocument {
    pub document_id: Option<Uuid>,
    pub signed_at: Option<DateTime<Utc>>,
    /// Names the payer of the current declaration.
    pub current: bool,
}

/// Everything the readiness, the gate and the wizard need about who pays.
#[derive(Clone, Debug, Default)]
pub(crate) struct PayerState {
    pub declaration: Option<Declaration>,
    pub identity_changed_at: Option<DateTime<Utc>>,
    pub patient_id: Option<Uuid>,
    pub created_at: Option<DateTime<Utc>>,
    pub updated_at: Option<DateTime<Utc>>,
    pub cost_assumption: CostAssumptionDocument,
    pub lead_citizenships: Vec<String>,
    pub order_id: Option<Uuid>,
    pub order_number: Option<String>,
    pub order_signed_patient: bool,
    pub order_signed_agency: bool,
}

/// Payer part of the lead conversion readiness (see `leads.rs`). The default
/// is "no declaration", so a path that forgets to load it blocks.
#[derive(Clone, Debug)]
pub(crate) struct PayerReadiness {
    pub reasons: Vec<PayerReason>,
    /// Countries for the AML country risk: the lead's citizenships and a
    /// third-party payer's residence and citizenships.
    pub aml_countries: Vec<String>,
}

impl Default for PayerReadiness {
    fn default() -> Self {
        Self {
            reasons: vec![PayerReason::DeclarationMissing],
            aml_countries: Vec::new(),
        }
    }
}

impl PayerReadiness {
    /// Nothing missing (tests and fully prepared leads).
    #[cfg(test)]
    pub(crate) fn ready() -> Self {
        Self {
            reasons: Vec::new(),
            aml_countries: Vec::new(),
        }
    }

    pub(crate) fn ready_for_conversion(&self) -> bool {
        self.reasons.is_empty()
    }

    /// Readiness checks of the documents step and the conversion reasons.
    pub(crate) fn extend(&self, checks: &mut Vec<Value>, conversion_reasons: &mut Vec<String>) {
        let declaration_passed = !self.reasons.iter().any(|reason| {
            matches!(
                reason,
                PayerReason::DeclarationMissing
                    | PayerReason::BeneficialOwnerMissing
                    | PayerReason::SourceOfFundsMissing
                    | PayerReason::PayerIdentityIncomplete
                    | PayerReason::PayerNotInformed
            )
        });
        checks.push(json!({
            "key": "payer_declaration_complete",
            "label": "Payer declaration complete",
            "passed": declaration_passed,
            "blocking_for": "conversion",
            "stage": "documents",
        }));
        checks.push(json!({
            "key": "cost_assumption_signed",
            "label": "Cost assumption declaration signed by the third-party payer",
            "passed": !self.reasons.iter().any(|reason| matches!(
                reason,
                PayerReason::CostAssumptionMissing
                    | PayerReason::CostAssumptionOutdated
                    | PayerReason::CostAssumptionUnsigned
            )),
            "blocking_for": "conversion",
            "stage": "documents",
        }));
        conversion_reasons.extend(
            self.reasons
                .iter()
                .map(|reason| reason.message().to_string()),
        );
    }
}

impl PayerState {
    fn is_third_party(&self) -> bool {
        self.declaration
            .as_ref()
            .is_some_and(Declaration::is_third_party)
    }

    /// Declaration reasons plus, for a third party, the cost assumption.
    fn declaration_reasons(&self) -> Vec<PayerReason> {
        let Some(declaration) = &self.declaration else {
            return vec![PayerReason::DeclarationMissing];
        };
        let mut reasons = declaration.missing();
        if declaration.is_third_party() {
            match (
                self.cost_assumption.document_id,
                self.cost_assumption.current,
                self.cost_assumption.signed_at,
            ) {
                (None, _, _) => reasons.push(PayerReason::CostAssumptionMissing),
                (Some(_), false, _) => reasons.push(PayerReason::CostAssumptionOutdated),
                (Some(_), true, None) => reasons.push(PayerReason::CostAssumptionUnsigned),
                (Some(_), true, Some(_)) => {}
            }
        }
        reasons
    }

    /// Why GMED may not countersign the contract or the order now.
    pub(crate) fn agency_gate(&self, client_signed_order: bool) -> Vec<PayerReason> {
        let mut reasons = Vec::new();
        if !client_signed_order {
            reasons.push(PayerReason::ClientOrderSignatureMissing);
        }
        reasons.extend(self.declaration_reasons());
        reasons
    }

    pub(crate) fn readiness(&self) -> PayerReadiness {
        let mut aml_countries: Vec<String> = Vec::new();
        let payer_countries = self
            .declaration
            .as_ref()
            .filter(|declaration| declaration.is_third_party())
            .map(|declaration| {
                declaration
                    .country
                    .iter()
                    .chain(declaration.citizenships.iter())
                    .cloned()
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        for code in self.lead_citizenships.iter().chain(payer_countries.iter()) {
            if !aml_countries.contains(code) {
                aml_countries.push(code.clone());
            }
        }
        PayerReadiness {
            reasons: self.declaration_reasons(),
            aml_countries,
        }
    }

    fn payload(&self) -> Value {
        let declaration_reasons = self.declaration_reasons();
        let gate = self.agency_gate(self.order_signed_patient);
        let codes = |reasons: &[PayerReason]| {
            reasons
                .iter()
                .map(|reason| reason.code())
                .collect::<Vec<_>>()
        };
        json!({
            "declaration": self.declaration.as_ref().map(|declaration| {
                let mut value = declaration.to_json();
                value["patient_id"] = json!(self.patient_id);
                value["created_at"] = json!(self.created_at.map(|at| at.to_rfc3339()));
                value["updated_at"] = json!(self.updated_at.map(|at| at.to_rfc3339()));
                value
            }),
            "status": {
                "complete": declaration_reasons.is_empty(),
                "missing": codes(&declaration_reasons),
                "cost_assumption": {
                    "required": self.is_third_party(),
                    "document_id": self.cost_assumption.document_id,
                    "current": self.cost_assumption.current,
                    "signed": self.cost_assumption.current
                        && self.cost_assumption.signed_at.is_some(),
                    "signed_at": self.cost_assumption.signed_at.map(|at| at.to_rfc3339()),
                },
                "order_id": self.order_id,
                "order_number": self.order_number,
                "client_signed_order": self.order_signed_patient,
                "agency_signed_order": self.order_signed_agency,
                "agency_may_sign": gate.is_empty(),
                "agency_blocking": codes(&gate),
                "aml_countries": self.readiness().aml_countries,
            },
        })
    }
}

fn identity_version(at: DateTime<Utc>) -> String {
    at.to_rfc3339_opts(SecondsFormat::Micros, true)
}

/// Loads the payer state of a lead in the caller's connection or transaction.
pub(crate) async fn load_payer_state(
    conn: &mut PgConnection,
    lead_id: Uuid,
) -> Result<PayerState, sqlx::Error> {
    // One round trip: the leads list evaluates readiness for every row.
    let declaration_columns = DECLARATION_COLUMNS
        .split(',')
        .map(|column| format!("d.{}", column.trim()))
        .collect::<Vec<_>>()
        .join(", ");
    let Some(row) = sqlx::query(&format!(
        r#"SELECT lead.citizenships AS lead_citizenships, {declaration_columns},
                  latest_order.id AS order_id, latest_order.order_number,
                  latest_order.signed_patient, latest_order.signed_agency,
                  cost.id AS cost_document_id, cost.signed_at AS cost_signed_at,
                  cost.payer_identity_version
           FROM leads lead
           LEFT JOIN lead_payer_declarations d ON d.lead_id = lead.id
           LEFT JOIN LATERAL (
               SELECT o.id, o.order_number, o.signed_patient, o.signed_agency
               FROM orders o
               WHERE o.source_lead_id = lead.id
               ORDER BY o.created_at DESC, o.id DESC
               LIMIT 1
           ) latest_order ON true
           LEFT JOIN LATERAL (
               SELECT doc.id, doc.signed_at,
                      doc.generated_bindings ->> '_payer_identity_version' AS payer_identity_version
               FROM documents doc
               WHERE doc.generated_template_id = 'cost_coverage_declaration'
                 AND doc.status <> 'archived'
                 AND doc.file_deleted_at IS NULL
                 AND NOT EXISTS (SELECT 1 FROM documents n WHERE n.replaces_document_id = doc.id)
                 AND (doc.lead_id = lead.id
                      OR doc.order_id IN (SELECT o.id FROM orders o WHERE o.source_lead_id = lead.id))
               ORDER BY doc.created_at DESC, doc.id DESC
               LIMIT 1
           ) cost ON true
           WHERE lead.id = $1"#
    ))
    .bind(lead_id)
    .fetch_optional(&mut *conn)
    .await?
    else {
        return Ok(PayerState::default());
    };
    let mut state = PayerState {
        lead_citizenships: row.try_get("lead_citizenships").unwrap_or_default(),
        ..PayerState::default()
    };
    if row
        .try_get::<Option<String>, _>("payer_kind")
        .ok()
        .flatten()
        .is_some()
    {
        state.declaration = Some(Declaration::from_row(&row));
        state.identity_changed_at = row.try_get("identity_changed_at").ok().flatten();
        state.patient_id = row.try_get("patient_id").unwrap_or_default();
        state.created_at = row.try_get("created_at").ok().flatten();
        state.updated_at = row.try_get("updated_at").ok().flatten();
    }
    if let Some(order_id) = row.try_get::<Option<Uuid>, _>("order_id").ok().flatten() {
        state.order_id = Some(order_id);
        state.order_number = row.try_get("order_number").unwrap_or_default();
        state.order_signed_patient = row
            .try_get::<Option<bool>, _>("signed_patient")
            .ok()
            .flatten()
            .unwrap_or(false);
        state.order_signed_agency = row
            .try_get::<Option<bool>, _>("signed_agency")
            .ok()
            .flatten()
            .unwrap_or(false);
    }
    if let Some(document_id) = row
        .try_get::<Option<Uuid>, _>("cost_document_id")
        .ok()
        .flatten()
    {
        let names: Option<String> = row.try_get("payer_identity_version").unwrap_or_default();
        state.cost_assumption = CostAssumptionDocument {
            document_id: Some(document_id),
            signed_at: row.try_get("cost_signed_at").unwrap_or_default(),
            current: names.is_some() && names == state.identity_changed_at.map(identity_version),
        };
    }
    Ok(state)
}

/// The payer part of the conversion readiness of a lead.
pub(crate) async fn load_payer_readiness(
    db: &gmed_db::DbPool,
    lead_id: Uuid,
) -> Result<PayerReadiness, sqlx::Error> {
    let mut conn = db.acquire().await?;
    Ok(load_payer_state(&mut conn, lead_id).await?.readiness())
}

/// 409 with the reasons why GMED may not countersign yet.
pub(crate) fn gate_response(reasons: &[PayerReason]) -> Response {
    let message = reasons
        .iter()
        .map(|reason| reason.message())
        .collect::<Vec<_>>()
        .join("; ");
    (
        StatusCode::CONFLICT,
        Json(json!({
            "error": "payer_gate_blocked",
            "message": format!(
                "GMED signs only after the client and the payer: {message}"
            ),
            "reasons": reasons.iter().map(|reason| reason.code()).collect::<Vec<_>>(),
        })),
    )
        .into_response()
}

fn database_error(error: sqlx::Error, context: &'static str) -> Response {
    tracing::error!(%error, context, "lead payer declaration");
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(json!({"error": "Internal Server Error", "message": "Failed to check the payer declaration"})),
    )
        .into_response()
}

/// The unconverted lead an order was created for, if any.
async fn open_lead_of_order(
    conn: &mut PgConnection,
    order_id: Uuid,
) -> Result<Option<Uuid>, sqlx::Error> {
    sqlx::query_scalar(
        r#"SELECT l.id FROM orders o
           JOIN leads l ON l.id = o.source_lead_id
           WHERE o.id = $1 AND l.converted_patient_id IS NULL"#,
    )
    .bind(order_id)
    .fetch_optional(&mut *conn)
    .await
}

/// Gate for `signed_agency` on a lead's order. `signed_patient` is the
/// patient flag sent with the same request, if any. An order that is already
/// confirmed, or that belongs to no open lead, passes.
pub(crate) async fn check_order_agency_signature(
    db: &gmed_db::DbPool,
    order_id: Uuid,
    signed_patient: Option<bool>,
) -> Result<(), Response> {
    let mut conn = db
        .acquire()
        .await
        .map_err(|error| database_error(error, "acquire order gate"))?;
    let current: Option<(bool, bool)> =
        sqlx::query_as("SELECT signed_patient, signed_agency FROM orders WHERE id = $1")
            .bind(order_id)
            .fetch_optional(&mut *conn)
            .await
            .map_err(|error| database_error(error, "load order signatures"))?;
    let Some((current_patient, current_agency)) = current else {
        return Ok(());
    };
    if current_agency {
        return Ok(());
    }
    let Some(lead_id) = open_lead_of_order(&mut conn, order_id)
        .await
        .map_err(|error| database_error(error, "load order lead"))?
    else {
        return Ok(());
    };
    let state = load_payer_state(&mut conn, lead_id)
        .await
        .map_err(|error| database_error(error, "load order payer state"))?;
    let reasons = state.agency_gate(signed_patient.unwrap_or(current_patient));
    if reasons.is_empty() {
        Ok(())
    } else {
        Err(gate_response(&reasons))
    }
}

/// Gate for marking a lead's framework contract signed (contract status or
/// the signed contract document). The client must have signed the lead's
/// order under it (the latest order of the lead when none names the contract).
pub(crate) async fn check_contract_agency_signature(
    conn: &mut PgConnection,
    contract_id: Option<Uuid>,
    lead_id: Option<Uuid>,
) -> Result<(), Response> {
    let lead_id = match (lead_id, contract_id) {
        (Some(lead_id), _) => Some(lead_id),
        (None, Some(contract_id)) => {
            sqlx::query_scalar("SELECT lead_id FROM framework_contracts WHERE id = $1")
                .bind(contract_id)
                .fetch_optional(&mut *conn)
                .await
                .map_err(|error| database_error(error, "load contract lead"))?
                .flatten()
        }
        (None, None) => None,
    };
    let Some(lead_id) = lead_id else {
        return Ok(());
    };
    let open: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM leads WHERE id = $1 AND converted_patient_id IS NULL)",
    )
    .bind(lead_id)
    .fetch_one(&mut *conn)
    .await
    .map_err(|error| database_error(error, "load contract lead state"))?;
    if !open {
        return Ok(());
    }
    let client_signed: bool = sqlx::query_scalar(
        r#"SELECT COALESCE((
               SELECT o.signed_patient FROM orders o
               WHERE o.source_lead_id = $1
               ORDER BY (o.contract_id IS NOT DISTINCT FROM $2) DESC, o.created_at DESC, o.id DESC
               LIMIT 1
           ), false)"#,
    )
    .bind(lead_id)
    .bind(contract_id)
    .fetch_one(&mut *conn)
    .await
    .map_err(|error| database_error(error, "load contract order signature"))?;
    let state = load_payer_state(conn, lead_id)
        .await
        .map_err(|error| database_error(error, "load contract payer state"))?;
    let reasons = state.agency_gate(client_signed);
    if reasons.is_empty() {
        Ok(())
    } else {
        Err(gate_response(&reasons))
    }
}

/// One document of an electronic signature request.
pub(crate) struct SigningDocument {
    pub template: Option<String>,
    pub lead_id: Option<Uuid>,
    pub order_id: Option<Uuid>,
}

/// Gate for an electronic signature request in which GMED signs a lead's
/// framework contract or order. The client signs first in the same request
/// (provider sequence), so only the declaration is checked; a cost assumption
/// declaration in the same package with a payer signer counts as signed, as
/// the payer also signs before GMED.
pub(crate) async fn check_signature_request(
    db: &gmed_db::DbPool,
    documents: &[SigningDocument],
    signer_roles: &[&str],
) -> Result<(), Response> {
    if !signer_roles.contains(&"agency") {
        return Ok(());
    }
    let countersigned: Vec<&SigningDocument> = documents
        .iter()
        .filter(|document| {
            matches!(
                document.template.as_deref(),
                Some("framework_contract" | "single_order")
            )
        })
        .collect();
    if countersigned.is_empty() {
        return Ok(());
    }
    let lead_ids: Vec<Uuid> = countersigned.iter().filter_map(|d| d.lead_id).collect();
    let order_ids: Vec<Uuid> = countersigned.iter().filter_map(|d| d.order_id).collect();
    let mut conn = db
        .acquire()
        .await
        .map_err(|error| database_error(error, "acquire signature gate"))?;
    let leads: Vec<Uuid> = sqlx::query_scalar(
        r#"SELECT DISTINCT l.id FROM leads l
           WHERE l.converted_patient_id IS NULL
             AND (l.id = ANY($1)
                  OR l.id IN (SELECT o.source_lead_id FROM orders o WHERE o.id = ANY($2)))"#,
    )
    .bind(&lead_ids)
    .bind(&order_ids)
    .fetch_all(&mut *conn)
    .await
    .map_err(|error| database_error(error, "load signature leads"))?;
    let payer_signs_cost_assumption = signer_roles.contains(&"payer")
        && documents
            .iter()
            .any(|document| document.template.as_deref() == Some(COST_ASSUMPTION_TEMPLATE));
    for lead_id in leads {
        let state = load_payer_state(&mut conn, lead_id)
            .await
            .map_err(|error| database_error(error, "load signature payer state"))?;
        let reasons: Vec<PayerReason> = state
            .agency_gate(true)
            .into_iter()
            .filter(|reason| {
                !(payer_signs_cost_assumption && *reason == PayerReason::CostAssumptionUnsigned)
            })
            .collect();
        if !reasons.is_empty() {
            return Err(gate_response(&reasons));
        }
    }
    Ok(())
}

// ----------------------------------------------------------------------------
// Kostenübernahmeerklärung
// ----------------------------------------------------------------------------

/// The third-party payer a Kostenübernahmeerklärung of a lead names.
pub(crate) struct CostAssumptionPayer {
    /// First and last name, or the name of the organisation.
    pub name: String,
    /// A person's date of birth; an organisation has none.
    pub date_of_birth: Option<NaiveDate>,
    pub street: Option<String>,
    pub zip: Option<String>,
    pub city: Option<String>,
    pub country: Option<String>,
    pub email: Option<String>,
    pub phone: Option<String>,
    /// Stored on the document under [`PAYER_IDENTITY_BINDING_KEY`].
    pub identity_version: String,
}

/// For a document of a lead (or of a lead's order): `Ok(None)` when no lead
/// is involved, `Err` with a 422 when the lead has no third-party payer.
pub(crate) async fn cost_assumption_payer(
    db: &gmed_db::DbPool,
    lead_id: Option<Uuid>,
    order_id: Option<Uuid>,
) -> Result<Option<CostAssumptionPayer>, Response> {
    let mut conn = db
        .acquire()
        .await
        .map_err(|error| database_error(error, "acquire cost assumption payer"))?;
    let lead_id = match (lead_id, order_id) {
        (Some(lead_id), _) => Some(lead_id),
        (None, Some(order_id)) => open_lead_of_order(&mut conn, order_id)
            .await
            .map_err(|error| database_error(error, "load cost assumption lead"))?,
        (None, None) => None,
    };
    let Some(lead_id) = lead_id else {
        return Ok(None);
    };
    let state = load_payer_state(&mut conn, lead_id)
        .await
        .map_err(|error| database_error(error, "load cost assumption payer"))?;
    let third_party = state
        .declaration
        .as_ref()
        .filter(|declaration| declaration.is_third_party());
    let (Some(declaration), Some(changed_at)) = (third_party, state.identity_changed_at) else {
        return Err((
            StatusCode::UNPROCESSABLE_ENTITY,
            Json(json!({
                "error": "payer_declaration_not_third_party",
                "message": "The payer declaration names no third-party payer",
            })),
        )
            .into_response());
    };
    Ok(Some(CostAssumptionPayer {
        name: declaration.payer_name().unwrap_or_default(),
        date_of_birth: declaration.date_of_birth,
        street: declaration.street.clone(),
        zip: declaration.zip.clone(),
        city: declaration.city.clone(),
        country: declaration.country.clone(),
        email: declaration.email.clone(),
        phone: declaration.phone.clone(),
        identity_version: identity_version(changed_at),
    }))
}

// ----------------------------------------------------------------------------
// Conversion, prospect and purge
// ----------------------------------------------------------------------------

/// Copies the lead's citizenships to the patient (prospect creation and
/// conversion). An existing patient keeps its citizenships and gains the
/// lead's; `nationality` keeps the first citizenship for older readers. On
/// conversion the declaration is linked to the patient and summarized in
/// `legal_status.payer_declaration`.
pub(crate) async fn carry_over_to_patient(
    tx: &mut PgConnection,
    lead_id: Uuid,
    patient_id: Uuid,
    converted: bool,
) -> Result<(), sqlx::Error> {
    // The patient record made from this lead (prospect or new patient) takes
    // the lead's list; an existing patient keeps its own and gains the lead's.
    sqlx::query(
        r#"UPDATE patients p
           SET citizenships = target.citizenships,
               nationality = COALESCE(target.citizenships[1], p.nationality),
               updated_at = now()
           FROM (
               SELECT CASE
                          WHEN patient.source_lead_id = lead.id THEN lead.citizenships
                          ELSE ARRAY(
                              SELECT code FROM (
                                  SELECT code, min(position) AS position FROM (
                                      SELECT c.code, c.ord AS position
                                      FROM unnest(patient.citizenships) WITH ORDINALITY AS c(code, ord)
                                      UNION ALL
                                      SELECT c.code, 100 + c.ord
                                      FROM unnest(lead.citizenships) WITH ORDINALITY AS c(code, ord)
                                  ) codes GROUP BY code
                              ) ordered ORDER BY position
                          )
                      END AS citizenships
               FROM patients patient, leads lead
               WHERE patient.id = $2 AND lead.id = $1
                 AND cardinality(lead.citizenships) > 0
           ) target
           WHERE p.id = $2
             AND p.citizenships IS DISTINCT FROM target.citizenships"#,
    )
    .bind(lead_id)
    .bind(patient_id)
    .execute(&mut *tx)
    .await?;
    if !converted {
        return Ok(());
    }
    sqlx::query(
        r#"WITH linked AS (
               UPDATE lead_payer_declarations
               SET patient_id = $2, updated_at = now()
               WHERE lead_id = $1
               RETURNING payer_kind, acts_on_own_account, source_of_funds,
                         COALESCE(
                             NULLIF(btrim(organisation_name), ''),
                             NULLIF(btrim(concat_ws(' ', first_name, last_name)), '')
                         ) AS payer_name
           )
           UPDATE patients p
           SET legal_status = jsonb_set(
                   COALESCE(p.legal_status, '{}'::jsonb),
                   '{payer_declaration}',
                   jsonb_build_object(
                       'lead_id', $1,
                       'payer_kind', linked.payer_kind,
                       'acts_on_own_account', linked.acts_on_own_account,
                       'source_of_funds', linked.source_of_funds,
                       'payer_name', linked.payer_name,
                       'cost_assumption_document_id', (
                           SELECT d.id FROM documents d
                           WHERE d.generated_template_id = 'cost_coverage_declaration'
                             AND d.signed_at IS NOT NULL
                             AND d.file_deleted_at IS NULL
                             AND (d.lead_id = $1
                                  OR d.order_id IN (SELECT o.id FROM orders o WHERE o.source_lead_id = $1))
                           ORDER BY d.signed_at DESC LIMIT 1)
                   ),
                   true),
               updated_at = now()
           FROM linked
           WHERE p.id = $2"#,
    )
    .bind(lead_id)
    .bind(patient_id)
    .execute(&mut *tx)
    .await?;
    Ok(())
}

/// Sets the lead's citizenships and keeps `wizard_state.registration_country`
/// on the first one for older readers. Returns the previous value.
pub(crate) async fn set_lead_citizenships(
    tx: &mut PgConnection,
    lead_id: Uuid,
    citizenships: &[String],
) -> Result<Vec<String>, sqlx::Error> {
    let previous: Vec<String> =
        sqlx::query_scalar("SELECT citizenships FROM leads WHERE id = $1 FOR UPDATE")
            .bind(lead_id)
            .fetch_optional(&mut *tx)
            .await?
            .unwrap_or_default();
    sqlx::query(
        r#"UPDATE leads
           SET citizenships = $2,
               wizard_state = jsonb_set(
                   COALESCE(wizard_state, '{}'::jsonb),
                   '{registration_country}',
                   to_jsonb(COALESCE($2[1], '')),
                   true),
               updated_at = now()
           WHERE id = $1"#,
    )
    .bind(lead_id)
    .bind(citizenships)
    .execute(&mut *tx)
    .await?;
    Ok(previous)
}

// ----------------------------------------------------------------------------
// Handlers
// ----------------------------------------------------------------------------

fn error(status: StatusCode, code: &str, message: &str) -> Response {
    (status, Json(json!({"error": code, "message": message}))).into_response()
}

/// Read access: roles that work the lead (leads.edit) and the CEO Assistant
/// (read-only). The concierge sees only the service grid of leads. The same
/// roles read the lead's own GwG statements from the cabinet.
pub(crate) fn may_view(auth: &AuthUser) -> bool {
    auth.can(Capability::LeadsEdit) || auth.role == Role::CeoAssistant
}

async fn get_payer_declaration(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(lead_id): Path<Uuid>,
) -> Response {
    if !may_view(&auth) {
        return error(
            StatusCode::FORBIDDEN,
            "forbidden",
            "Insufficient permissions",
        );
    }
    let mut conn = match state.db.acquire().await {
        Ok(conn) => conn,
        Err(error) => return database_error(error, "acquire payer declaration"),
    };
    match sqlx::query_scalar::<_, bool>("SELECT EXISTS(SELECT 1 FROM leads WHERE id = $1)")
        .bind(lead_id)
        .fetch_one(&mut *conn)
        .await
    {
        Ok(true) => {}
        Ok(false) => return error(StatusCode::NOT_FOUND, "not_found", "Lead not found"),
        Err(error) => return database_error(error, "load payer declaration lead"),
    }
    match load_payer_state(&mut conn, lead_id).await {
        Ok(payer) => Json(payer.payload()).into_response(),
        Err(error) => database_error(error, "load payer declaration"),
    }
}

async fn save_payer_declaration(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(lead_id): Path<Uuid>,
    Json(body): Json<DeclarationInput>,
) -> Response {
    if let Err(response) = auth.require_capability(Capability::LeadsEdit) {
        return response;
    }
    let mut tx = match state.db.begin().await {
        Ok(tx) => tx,
        Err(error) => return database_error(error, "begin payer declaration"),
    };
    let lead = match sqlx::query(
        r#"SELECT converted_patient_id, qualification_status, prospect_patient_id
           FROM leads WHERE id = $1 FOR UPDATE"#,
    )
    .bind(lead_id)
    .fetch_optional(&mut *tx)
    .await
    {
        Ok(Some(row)) => row,
        Ok(None) => return error(StatusCode::NOT_FOUND, "not_found", "Lead not found"),
        Err(error) => return database_error(error, "lock payer declaration lead"),
    };
    if lead
        .try_get::<Option<Uuid>, _>("converted_patient_id")
        .unwrap_or_default()
        .is_some()
    {
        return error(
            StatusCode::CONFLICT,
            "lead_converted",
            "The lead is converted; its payer declaration belongs to the patient record",
        );
    }
    if lead
        .try_get::<String, _>("qualification_status")
        .unwrap_or_default()
        == "deleted"
    {
        return error(StatusCode::CONFLICT, "lead_deleted", "The lead is deleted");
    }
    // The stored declaration first: it supplies what the body leaves out.
    let previous = match load_payer_state(&mut tx, lead_id).await {
        Ok(payer) => payer.declaration,
        Err(error) => return database_error(error, "load previous payer declaration"),
    };
    let mut declaration =
        match declaration_from_input(&body, previous.as_ref(), crate::app_time::today()) {
            Ok(declaration) => declaration,
            Err(code) => {
                return error(
                    StatusCode::UNPROCESSABLE_ENTITY,
                    code,
                    "Invalid payer declaration",
                );
            }
        };
    // The staff form always states the own-account answer.
    declaration.own_account_answered = true;
    // Only the lead gives or removes the consent to contact the payer: staff
    // keep it as long as a third party pays.
    if declaration.is_third_party() {
        declaration.contact_consent_at = previous
            .as_ref()
            .and_then(|previous| previous.contact_consent_at);
    }
    if let Some(document_id) = declaration.source_of_funds_document_id {
        let prospect: Option<Uuid> = lead.try_get("prospect_patient_id").unwrap_or_default();
        match sqlx::query_scalar::<_, bool>(
            r#"SELECT EXISTS(
                   SELECT 1 FROM documents
                   WHERE id = $1 AND file_deleted_at IS NULL AND status <> 'archived'
                     AND (lead_id = $2 OR ($3::uuid IS NOT NULL AND patient_id = $3)))"#,
        )
        .bind(document_id)
        .bind(lead_id)
        .bind(prospect)
        .fetch_one(&mut *tx)
        .await
        {
            Ok(true) => {}
            Ok(false) => {
                return error(
                    StatusCode::UNPROCESSABLE_ENTITY,
                    "source_of_funds_document_invalid",
                    "The evidence document does not belong to this lead",
                );
            }
            Err(error) => return database_error(error, "validate source of funds document"),
        }
    }
    if body.payer_informed && declaration.is_third_party() {
        // The first confirmation keeps its time and author.
        let earlier = previous
            .as_ref()
            .and_then(|previous| previous.payer_informed_at.zip(previous.payer_informed_by));
        let (at, by) = earlier.unwrap_or((Utc::now(), auth.user_id));
        declaration.payer_informed_at = Some(at);
        declaration.payer_informed_by = Some(by);
    }
    let identity_changed = previous
        .as_ref()
        .is_none_or(|previous| previous.identity_key() != declaration.identity_key());
    if previous.as_ref() == Some(&declaration) {
        drop(tx);
        return get_payer_declaration(State(state), Extension(auth), Path(lead_id)).await;
    }
    if let Err(error) = store_declaration(
        &mut tx,
        lead_id,
        &declaration,
        auth.user_id,
        identity_changed,
    )
    .await
    {
        return database_error(error, "save payer declaration");
    }
    let mut event = audit::domain_diff_event(
        "update_lead_payer_declaration",
        Some(auth.user_id),
        "lead",
        Some(lead_id),
        previous
            .as_ref()
            .map(Declaration::to_json)
            .unwrap_or(Value::Null),
        declaration.to_json(),
    );
    event.context = json!({
        "lead_id": lead_id,
        "payer_kind": declaration.payer_kind,
        "identity_changed": identity_changed,
        "missing": declaration.missing().iter().map(|reason| reason.code()).collect::<Vec<_>>(),
    });
    if let Err(error) = audit::write_in_transaction(&mut tx, &event).await {
        return database_error(error, "audit payer declaration");
    }
    if let Err(error) = sync_order_payers(&mut tx, lead_id, &declaration, auth.user_id).await {
        return database_error(error, "sync order payer");
    }
    if let Err(error) = tx.commit().await {
        return database_error(error, "commit payer declaration");
    }
    crate::realtime::publish_lead_event(
        &state,
        Some(auth.user_id),
        "lead.updated",
        lead_id,
        json!({ "payer_declaration_updated": true }),
    )
    .await;
    get_payer_declaration(State(state), Extension(auth), Path(lead_id)).await
}

/// Writes the declaration of a lead. `identity_changed` dates the payer
/// named in a cost assumption document (see `identity_changed_at`).
async fn store_declaration(
    conn: &mut PgConnection,
    lead_id: Uuid,
    declaration: &Declaration,
    actor: Uuid,
    identity_changed: bool,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"INSERT INTO lead_payer_declarations (
               lead_id, payer_kind, acts_on_own_account, beneficial_owner_name,
               beneficial_owner_note, source_of_funds, source_of_funds_description,
               source_of_funds_document_id, first_name, last_name, date_of_birth,
               place_of_birth, street, zip, city, country, citizenships, relationship,
               email, phone, payer_informed_at, payer_informed_by,
               identity_changed_at, created_by, updated_by, own_account_answered,
               payer_type, organisation_name, relationship_kind, contact_consent_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
                   $16, $17, $18, $19, $20, $23, $24, clock_timestamp(), $21, $21, $25,
                   $26, $27, $28, $29)
           ON CONFLICT (lead_id) DO UPDATE SET
               payer_kind = EXCLUDED.payer_kind,
               payer_type = EXCLUDED.payer_type,
               organisation_name = EXCLUDED.organisation_name,
               relationship_kind = EXCLUDED.relationship_kind,
               contact_consent_at = EXCLUDED.contact_consent_at,
               acts_on_own_account = EXCLUDED.acts_on_own_account,
               own_account_answered = EXCLUDED.own_account_answered,
               beneficial_owner_name = EXCLUDED.beneficial_owner_name,
               beneficial_owner_note = EXCLUDED.beneficial_owner_note,
               source_of_funds = EXCLUDED.source_of_funds,
               source_of_funds_description = EXCLUDED.source_of_funds_description,
               source_of_funds_document_id = EXCLUDED.source_of_funds_document_id,
               first_name = EXCLUDED.first_name,
               last_name = EXCLUDED.last_name,
               date_of_birth = EXCLUDED.date_of_birth,
               place_of_birth = EXCLUDED.place_of_birth,
               street = EXCLUDED.street,
               zip = EXCLUDED.zip,
               city = EXCLUDED.city,
               country = EXCLUDED.country,
               citizenships = EXCLUDED.citizenships,
               relationship = EXCLUDED.relationship,
               email = EXCLUDED.email,
               phone = EXCLUDED.phone,
               payer_informed_at = EXCLUDED.payer_informed_at,
               payer_informed_by = EXCLUDED.payer_informed_by,
               identity_changed_at = CASE WHEN $22 THEN clock_timestamp()
                                          ELSE lead_payer_declarations.identity_changed_at END,
               updated_by = EXCLUDED.updated_by,
               updated_at = now()"#,
    )
    .bind(lead_id)
    .bind(&declaration.payer_kind)
    .bind(declaration.acts_on_own_account)
    .bind(&declaration.beneficial_owner_name)
    .bind(&declaration.beneficial_owner_note)
    .bind(&declaration.source_of_funds)
    .bind(&declaration.source_of_funds_description)
    .bind(declaration.source_of_funds_document_id)
    .bind(&declaration.first_name)
    .bind(&declaration.last_name)
    .bind(declaration.date_of_birth)
    .bind(&declaration.place_of_birth)
    .bind(&declaration.street)
    .bind(&declaration.zip)
    .bind(&declaration.city)
    .bind(&declaration.country)
    .bind(&declaration.citizenships)
    .bind(&declaration.relationship)
    .bind(&declaration.email)
    .bind(&declaration.phone)
    .bind(actor)
    .bind(identity_changed)
    .bind(declaration.payer_informed_at)
    .bind(declaration.payer_informed_by)
    .bind(declaration.own_account_answered)
    .bind(&declaration.payer_type)
    .bind(&declaration.organisation_name)
    .bind(&declaration.relationship_kind)
    .bind(declaration.contact_consent_at)
    .execute(conn)
    .await
    .map(|_| ())
}

// ----------------------------------------------------------------------------
// Lead cabinet: the patient states who pays
// ----------------------------------------------------------------------------

/// What the patient (or a parent of a minor) states in the lead cabinet: who
/// pays and, for a third party, who that is (owner request 2026-10-05), and
/// whether the patient acts in the own economic interest (owner spec
/// "Patientenformular", 2026-10-05). The rest of the GwG part of the
/// declaration — source of funds, staff's further details on the beneficial
/// owner, the Art. 14 confirmation — stays with staff and is kept as it is.
/// The data land in the same declaration, so the sanctions screening and the
/// country policy see the payer the moment the cabinet saves it.
///
/// The body is the whole "who pays" answer: a payer field that is left out is
/// cleared. Only the own-interest answer and the contact consent are kept
/// when their keys are left out.
#[derive(Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct PortalPayerInput {
    payer_kind: String,
    /// Who the third party is; left out means a person (older clients).
    payer_type: Option<String>,
    /// Name of the company, organisation or insurer.
    organisation_name: Option<String>,
    first_name: Option<String>,
    last_name: Option<String>,
    date_of_birth: Option<String>,
    street: Option<String>,
    zip: Option<String>,
    city: Option<String>,
    country: Option<String>,
    #[serde(default)]
    citizenships: Vec<String>,
    relationship_kind: Option<String>,
    /// Only for the kind `other`.
    relationship: Option<String>,
    email: Option<String>,
    phone: Option<String>,
    /// The checkbox "GMED may contact the payer about the costs and tell
    /// them my name": `true` records the consent with the current time unless
    /// one is recorded for this payer, `false` removes it. Left out: the
    /// stored consent stays.
    contact_consent: Option<bool>,
    /// "Do you act in your own economic interest?" Left out: the stored
    /// answer stays.
    acts_on_own_account: Option<bool>,
    /// For the answer "no": the person in whose interest the patient acts
    /// (name, date and place of birth, address) in one text.
    beneficial_owner: Option<String>,
}

pub(crate) enum PortalPayerError {
    /// A value the cabinet has to correct: error code and the field it names.
    Invalid {
        code: &'static str,
        field: &'static str,
    },
    Database(sqlx::Error),
}

impl From<sqlx::Error> for PortalPayerError {
    fn from(error: sqlx::Error) -> Self {
        Self::Database(error)
    }
}

/// The cabinet field a validation code of [`declaration_from_input`] names.
fn portal_field_of(code: &str) -> &'static str {
    match code {
        "payer_kind_invalid" => "payer_kind",
        "payer_type_invalid" => "payer_type",
        "payer_organisation_name_too_long" => "payer_organisation_name",
        "payer_relationship_kind_invalid" => "payer_relationship_kind",
        "payer_date_of_birth_invalid" => "payer_date_of_birth",
        "payer_email_invalid" => "payer_email",
        "payer_country_invalid" => "payer_country",
        "payer_citizenships_invalid" => "payer_citizenships",
        "payer_beneficial_owner_too_long" => "payer_beneficial_owner",
        _ => "payer",
    }
}

impl Declaration {
    /// The person or organisation named as payer: a different one has not
    /// been informed yet, has another place of birth, and the lead has not
    /// agreed that GMED contacts it.
    fn payer_key(&self) -> Value {
        json!([
            self.payer_type,
            self.organisation_name,
            self.first_name,
            self.last_name,
            self.date_of_birth,
        ])
    }

    /// The part of the declaration the lead cabinet shows and edits.
    fn portal_json(&self) -> Value {
        json!({
            "payer_kind": self.payer_kind,
            "payer_type": self.payer_type,
            "organisation_name": self.organisation_name,
            "first_name": self.first_name,
            "last_name": self.last_name,
            "date_of_birth": self.date_of_birth.map(|date| date.format("%Y-%m-%d").to_string()),
            "street": self.street,
            "zip": self.zip,
            "city": self.city,
            "country": self.country,
            "citizenships": self.citizenships,
            "relationship_kind": self.relationship_kind,
            "relationship": self.relationship,
            "email": self.email,
            "phone": self.phone,
            // Like the other times of the request object.
            "contact_consent_at": self.contact_consent_at,
            // `null` until somebody answered the question.
            "acts_on_own_account": self.own_account_answered.then_some(self.acts_on_own_account),
            "beneficial_owner": self
                .beneficial_owner_name
                .as_ref()
                .filter(|_| self.own_account_answered && !self.acts_on_own_account),
        })
    }
}

/// The declaration of a lead without the order and document state.
pub(crate) async fn load_declaration(
    conn: &mut PgConnection,
    lead_id: Uuid,
) -> Result<Option<Declaration>, sqlx::Error> {
    Ok(sqlx::query(&format!(
        "SELECT {DECLARATION_COLUMNS} FROM lead_payer_declarations WHERE lead_id = $1"
    ))
    .bind(lead_id)
    .fetch_optional(conn)
    .await?
    .as_ref()
    .map(Declaration::from_row))
}

/// The cabinet's view of the declaration; `null` until the question is answered.
pub(crate) fn portal_payload(declaration: Option<&Declaration>) -> Value {
    declaration.map_or(Value::Null, Declaration::portal_json)
}

/// What the cabinet still needs before the request can be sent: the answer
/// who pays and, for a third party, the least the sanctions screening and
/// the country policy work with — the name and the citizenships of a person,
/// the name and the seat country of an organisation —, the relationship to
/// the patient and the consent that GMED contacts the payer. The rest of the
/// identity is completed with staff.
pub(crate) fn portal_missing(declaration: Option<&Declaration>) -> Vec<&'static str> {
    let Some(declaration) = declaration else {
        return vec!["payer_kind"];
    };
    let mut missing = Vec::new();
    if declaration.is_third_party() {
        if declaration.is_organisation() {
            if blank(&declaration.organisation_name) {
                missing.push("payer_organisation_name");
            }
        } else {
            if blank(&declaration.first_name) {
                missing.push("payer_first_name");
            }
            if blank(&declaration.last_name) {
                missing.push("payer_last_name");
            }
            if declaration.citizenships.is_empty() {
                missing.push("payer_citizenships");
            }
        }
        match declaration.relationship_kind.as_deref() {
            None => missing.push("payer_relationship_kind"),
            Some(RELATIONSHIP_KIND_OTHER) if blank(&declaration.relationship) => {
                missing.push("payer_relationship");
            }
            Some(_) => {}
        }
        if declaration.is_organisation() && declaration.country.is_none() {
            missing.push("payer_country");
        }
        if declaration.contact_consent_at.is_none() {
            missing.push("payer_contact_consent");
        }
    }
    missing
}

/// The own-interest part of what the cabinet needs before sending: the answer
/// and, for a "no", the person in whose interest the patient acts. Kept apart
/// from [`portal_missing`] because the form asks it after the identity
/// document.
pub(crate) fn portal_missing_own_account(declaration: Option<&Declaration>) -> Vec<&'static str> {
    match declaration.filter(|declaration| declaration.own_account_answered) {
        None => vec!["payer_own_account"],
        Some(declaration)
            if !declaration.acts_on_own_account && blank(&declaration.beneficial_owner_name) =>
        {
            vec!["payer_beneficial_owner"]
        }
        Some(_) => Vec::new(),
    }
}

/// Stable text of what the cabinet entered, for the "entered by the patient"
/// marker of the lead.
pub(crate) fn portal_marker_value(declaration: &Declaration) -> String {
    declaration.portal_json().to_string()
}

/// Merges the cabinet's answer into the stored declaration. Staff fields are
/// kept; the place of birth, the Art. 14 confirmation and the consent to
/// contact the payer belong to the payer named before and go when the cabinet
/// names somebody else (another person, organisation or payer type).
///
/// Consent to contact the payer: `true` records it at `now` unless one is
/// recorded for this payer, `false` removes it, no key keeps it.
///
/// Own economic interest: without the answer in the body the stored answer
/// and the named person stay. With it, the named person is what the cabinet
/// sent (a "no" without a text clears it; a "yes" has nobody to name), and
/// staff's further details go when another person is named.
fn declaration_from_portal(
    previous: Option<&Declaration>,
    input: &PortalPayerInput,
    today: NaiveDate,
    now: DateTime<Utc>,
) -> Result<Declaration, &'static str> {
    if input
        .beneficial_owner
        .as_deref()
        .is_some_and(|value| value.trim().chars().count() > LONG_TEXT_MAX)
    {
        return Err("payer_beneficial_owner_too_long");
    }
    let own_account_sent = input.acts_on_own_account.is_some() || input.beneficial_owner.is_some();
    let staff = DeclarationInput {
        payer_kind: input.payer_kind.clone(),
        acts_on_own_account: input
            .acts_on_own_account
            .unwrap_or_else(|| previous.is_none_or(|previous| previous.acts_on_own_account)),
        beneficial_owner_name: if own_account_sent {
            input.beneficial_owner.clone()
        } else {
            previous.and_then(|previous| previous.beneficial_owner_name.clone())
        },
        beneficial_owner_note: previous.and_then(|previous| previous.beneficial_owner_note.clone()),
        source_of_funds: previous.and_then(|previous| previous.source_of_funds.clone()),
        source_of_funds_description: previous
            .and_then(|previous| previous.source_of_funds_description.clone()),
        source_of_funds_document_id: previous
            .and_then(|previous| previous.source_of_funds_document_id),
        // The cabinet states the whole payer: nothing is taken over.
        payer_type: Some(input.payer_type.clone()),
        organisation_name: Some(input.organisation_name.clone()),
        first_name: input.first_name.clone(),
        last_name: input.last_name.clone(),
        date_of_birth: input.date_of_birth.clone(),
        place_of_birth: None,
        street: input.street.clone(),
        zip: input.zip.clone(),
        city: input.city.clone(),
        country: input.country.clone(),
        citizenships: input.citizenships.clone(),
        relationship_kind: Some(input.relationship_kind.clone()),
        relationship: input.relationship.clone(),
        email: input.email.clone(),
        phone: input.phone.clone(),
        payer_informed: false,
    };
    let mut declaration = declaration_from_input(&staff, previous, today)?;
    declaration.own_account_answered = input.acts_on_own_account.is_some()
        || previous.is_some_and(|previous| previous.own_account_answered);
    if previous
        .is_none_or(|previous| previous.beneficial_owner_name != declaration.beneficial_owner_name)
    {
        declaration.beneficial_owner_note = None;
    }
    // What is recorded for the payer named before, if it is still the one.
    let same_payer = previous.filter(|previous| {
        previous.is_third_party()
            && declaration.is_third_party()
            && previous.payer_key() == declaration.payer_key()
    });
    if let Some(previous) = same_payer {
        declaration.place_of_birth = previous.place_of_birth.clone();
        declaration.payer_informed_at = previous.payer_informed_at;
        declaration.payer_informed_by = previous.payer_informed_by;
    }
    if declaration.is_third_party() {
        let recorded = same_payer.and_then(|previous| previous.contact_consent_at);
        declaration.contact_consent_at = match input.contact_consent {
            Some(true) => Some(recorded.unwrap_or(now)),
            Some(false) => None,
            None => recorded,
        };
    }
    Ok(declaration)
}

/// Saves the cabinet's answer in the caller's transaction, with its audit
/// event and the payer of the lead's orders. Returns the declaration when
/// something changed.
pub(crate) async fn save_from_portal(
    conn: &mut PgConnection,
    lead_id: Uuid,
    actor: Uuid,
    access_kind: &str,
    input: &PortalPayerInput,
    today: NaiveDate,
) -> Result<Option<Declaration>, PortalPayerError> {
    let previous = load_declaration(conn, lead_id).await?;
    // The precision the database keeps, so the stored consent time is the
    // one the "entered by the patient" marker was made from.
    let now = Utc::now().trunc_subsecs(6);
    let declaration =
        declaration_from_portal(previous.as_ref(), input, today, now).map_err(|code| {
            PortalPayerError::Invalid {
                code,
                field: portal_field_of(code),
            }
        })?;
    if previous.as_ref() == Some(&declaration) {
        return Ok(None);
    }
    let identity_changed = previous
        .as_ref()
        .is_none_or(|previous| previous.identity_key() != declaration.identity_key());
    store_declaration(conn, lead_id, &declaration, actor, identity_changed).await?;
    let mut event = audit::domain_diff_event(
        "lead_portal_update_payer_declaration",
        Some(actor),
        "lead",
        Some(lead_id),
        previous
            .as_ref()
            .map(Declaration::to_json)
            .unwrap_or(Value::Null),
        declaration.to_json(),
    );
    event.context = json!({
        "lead_id": lead_id,
        "payer_kind": declaration.payer_kind,
        "identity_changed": identity_changed,
        "access_kind": access_kind,
        "missing": declaration.missing().iter().map(|reason| reason.code()).collect::<Vec<_>>(),
    });
    audit::write_in_transaction(conn, &event).await?;
    sync_order_payers(conn, lead_id, &declaration, actor).await?;
    Ok(Some(declaration))
}

/// The declaration is the source of the payer of the lead's orders while the
/// lead is open: a third party becomes the order payer (role `cost_bearer`);
/// a self-payer clears a cost bearer and keeps any other payer (for example
/// the parents as contracting party). Each change is audited like the order
/// payer dialog (`set_order_payer`).
async fn sync_order_payers(
    tx: &mut PgConnection,
    lead_id: Uuid,
    declaration: &Declaration,
    actor: Uuid,
) -> Result<(), sqlx::Error> {
    let orders = sqlx::query(&format!(
        "SELECT o.id, {} FROM orders o WHERE o.source_lead_id = $1 FOR UPDATE",
        payer_columns("o", "")
    ))
    .bind(lead_id)
    .fetch_all(&mut *tx)
    .await?;
    for order in orders {
        let order_id: Uuid = order.try_get("id")?;
        let previous = PayerRecord::from_row(&order, "");
        let next = if declaration.is_third_party() {
            match declaration.payer_name() {
                Some(name) => PayerRecord {
                    payer_patient_id: None,
                    payer_patient_relation_id: None,
                    contact_name: Some(name),
                    contact_email: declaration.email.clone(),
                    contact_phone: declaration.phone.clone(),
                    contact_relationship: declaration.relationship_label(),
                    notes: previous.notes.clone(),
                    address_street: declaration.street.clone(),
                    address_zip: declaration.zip.clone(),
                    address_city: declaration.city.clone(),
                    address_country: declaration.country.clone(),
                    payer_role: Some(PAYER_ROLE_COST_BEARER.to_string()),
                },
                None => continue,
            }
        } else if previous.payer_role.as_deref() == Some(PAYER_ROLE_COST_BEARER) {
            PayerRecord::default()
        } else {
            continue;
        };
        if next == previous {
            continue;
        }
        sqlx::query(
            "UPDATE orders SET
                payer_patient_id = $2,
                payer_patient_relation_id = $3,
                payer_contact_name = $4,
                payer_contact_email = $5,
                payer_contact_phone = $6,
                payer_contact_relationship = $7,
                payer_notes = $8,
                payer_address_street = $9,
                payer_address_zip = $10,
                payer_address_city = $11,
                payer_address_country = $12,
                payer_role = $13,
                payer_updated_by = $14,
                payer_updated_at = now(),
                updated_at = now()
             WHERE id = $1",
        )
        .bind(order_id)
        .bind(next.payer_patient_id)
        .bind(next.payer_patient_relation_id)
        .bind(&next.contact_name)
        .bind(&next.contact_email)
        .bind(&next.contact_phone)
        .bind(&next.contact_relationship)
        .bind(&next.notes)
        .bind(&next.address_street)
        .bind(&next.address_zip)
        .bind(&next.address_city)
        .bind(&next.address_country)
        .bind(&next.payer_role)
        .bind(actor)
        .execute(&mut *tx)
        .await?;
        let mut event = audit::domain_diff_event(
            "set_order_payer",
            Some(actor),
            "order",
            Some(order_id),
            previous.to_audit_json(),
            next.to_audit_json(),
        );
        event.context = json!({ "source": "lead_payer_declaration", "lead_id": lead_id });
        audit::write_in_transaction(&mut *tx, &event).await?;
    }
    Ok(())
}

/// Sets the payer of a newly created lead order from the declaration.
pub(crate) async fn sync_lead_order_payers(
    db: &gmed_db::DbPool,
    lead_id: Uuid,
    actor: Uuid,
) -> Result<(), sqlx::Error> {
    let mut tx = db.begin().await?;
    let state = load_payer_state(&mut tx, lead_id).await?;
    if let Some(declaration) = state.declaration {
        sync_order_payers(&mut tx, lead_id, &declaration, actor).await?;
    }
    tx.commit().await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input(kind: &str) -> DeclarationInput {
        DeclarationInput {
            payer_kind: kind.to_string(),
            acts_on_own_account: true,
            beneficial_owner_name: None,
            beneficial_owner_note: None,
            source_of_funds: Some("employment".into()),
            source_of_funds_description: None,
            source_of_funds_document_id: None,
            // Like the staff form of an older client: the keys are left out.
            payer_type: None,
            organisation_name: None,
            first_name: Some(" Erika ".into()),
            last_name: Some("Muster".into()),
            date_of_birth: Some("1970-05-01".into()),
            place_of_birth: None,
            street: Some("Hauptstr. 1".into()),
            zip: Some("10115".into()),
            city: Some("Berlin".into()),
            country: Some("de".into()),
            citizenships: vec!["de".into(), "AT".into()],
            relationship_kind: None,
            relationship: Some("Tochter".into()),
            email: Some("erika@example.org".into()),
            phone: None,
            payer_informed: true,
        }
    }

    fn today() -> NaiveDate {
        NaiveDate::from_ymd_opt(2026, 10, 3).unwrap()
    }

    fn now() -> DateTime<Utc> {
        DateTime::parse_from_rfc3339("2026-10-03T09:20:00Z")
            .unwrap()
            .with_timezone(&Utc)
    }

    /// A first save: nothing stored.
    fn from_input(input: &DeclarationInput) -> Result<Declaration, &'static str> {
        declaration_from_input(input, None, today())
    }

    fn from_portal(
        previous: Option<&Declaration>,
        input: &PortalPayerInput,
    ) -> Result<Declaration, &'static str> {
        declaration_from_portal(previous, input, today(), now())
    }

    #[test]
    fn self_payer_needs_only_the_source_of_funds() {
        let declaration = from_input(&input("self")).unwrap();
        assert!(declaration.first_name.is_none(), "third-party data dropped");
        assert!(declaration.citizenships.is_empty());
        assert!(declaration.missing().is_empty());
        let mut missing = input("self");
        missing.source_of_funds = None;
        let declaration = from_input(&missing).unwrap();
        assert_eq!(declaration.missing(), [PayerReason::SourceOfFundsMissing]);
    }

    #[test]
    fn other_source_of_funds_needs_a_description() {
        let mut value = input("self");
        value.source_of_funds = Some("other".into());
        let declaration = from_input(&value).unwrap();
        assert_eq!(declaration.missing(), [PayerReason::SourceOfFundsMissing]);
        value.source_of_funds_description = Some("Stipendium".into());
        assert!(from_input(&value).unwrap().missing().is_empty());
    }

    #[test]
    fn third_party_payer_is_normalized_and_needs_identity() {
        let declaration = from_input(&input("third_party")).unwrap();
        assert_eq!(declaration.first_name.as_deref(), Some("Erika"));
        assert_eq!(declaration.country.as_deref(), Some("DE"));
        assert_eq!(declaration.citizenships, ["DE", "AT"]);
        assert_eq!(declaration.missing(), [PayerReason::PayerNotInformed]);
        assert!(informed(declaration).missing().is_empty());
        let mut incomplete = input("third_party");
        incomplete.citizenships.clear();
        let declaration = informed(from_input(&incomplete).unwrap());
        assert_eq!(
            declaration.missing(),
            [PayerReason::PayerIdentityIncomplete]
        );
    }

    fn informed(mut declaration: Declaration) -> Declaration {
        declaration.payer_informed_at = Some(Utc::now());
        declaration.payer_informed_by = Some(Uuid::nil());
        declaration
    }

    #[test]
    fn beneficial_owner_is_required_when_not_on_own_account() {
        let mut value = input("self");
        value.acts_on_own_account = false;
        let declaration = from_input(&value).unwrap();
        assert_eq!(declaration.missing(), [PayerReason::BeneficialOwnerMissing]);
        value.acts_on_own_account = true;
        value.beneficial_owner_name = Some("Someone".into());
        let declaration = from_input(&value).unwrap();
        assert!(declaration.beneficial_owner_name.is_none());
    }

    #[test]
    fn invalid_values_are_rejected() {
        let mut value = input("someone");
        assert_eq!(from_input(&value), Err("payer_kind_invalid"));
        value = input("third_party");
        value.source_of_funds = Some("lottery".into());
        assert_eq!(from_input(&value), Err("source_of_funds_invalid"));
        value = input("third_party");
        value.country = Some("Germany".into());
        assert_eq!(from_input(&value), Err("payer_country_invalid"));
        value = input("third_party");
        value.date_of_birth = Some("2030-01-01".into());
        assert_eq!(from_input(&value), Err("payer_date_of_birth_invalid"));
        value = input("third_party");
        value.email = Some("no-at-sign".into());
        assert_eq!(from_input(&value), Err("payer_email_invalid"));
    }

    fn third_party_state(document: CostAssumptionDocument) -> PayerState {
        PayerState {
            declaration: Some(informed(from_input(&input("third_party")).unwrap())),
            cost_assumption: document,
            lead_citizenships: vec!["UA".into()],
            ..PayerState::default()
        }
    }

    #[test]
    fn third_party_gate_waits_for_the_client_and_the_signed_cost_assumption() {
        let missing = third_party_state(CostAssumptionDocument::default());
        assert_eq!(
            missing.agency_gate(false),
            [
                PayerReason::ClientOrderSignatureMissing,
                PayerReason::CostAssumptionMissing
            ]
        );
        let outdated = third_party_state(CostAssumptionDocument {
            document_id: Some(Uuid::nil()),
            signed_at: Some(Utc::now()),
            current: false,
        });
        assert_eq!(
            outdated.agency_gate(true),
            [PayerReason::CostAssumptionOutdated]
        );
        let unsigned = third_party_state(CostAssumptionDocument {
            document_id: Some(Uuid::nil()),
            signed_at: None,
            current: true,
        });
        assert_eq!(
            unsigned.agency_gate(true),
            [PayerReason::CostAssumptionUnsigned]
        );
        let signed = third_party_state(CostAssumptionDocument {
            document_id: Some(Uuid::nil()),
            signed_at: Some(Utc::now()),
            current: true,
        });
        assert!(signed.agency_gate(true).is_empty());
        let readiness = signed.readiness();
        assert!(readiness.ready_for_conversion());
        assert_eq!(readiness.aml_countries, ["UA", "DE", "AT"]);
    }

    #[test]
    fn missing_declaration_blocks_and_is_the_default() {
        let state = PayerState::default();
        assert_eq!(state.agency_gate(true), [PayerReason::DeclarationMissing]);
        assert!(!PayerReadiness::default().ready_for_conversion());
        let mut checks = Vec::new();
        let mut reasons = Vec::new();
        PayerReadiness::default().extend(&mut checks, &mut reasons);
        assert_eq!(reasons, ["Payer declaration is missing"]);
        assert_eq!(checks[0]["passed"], false);
        assert_eq!(checks[1]["passed"], true);
    }

    fn portal(kind: &str) -> PortalPayerInput {
        PortalPayerInput {
            payer_kind: kind.to_string(),
            ..PortalPayerInput::default()
        }
    }

    #[test]
    fn the_cabinet_answers_the_own_account_question() {
        // Who pays alone does not answer it.
        let unanswered = from_portal(None, &portal("self")).unwrap();
        assert!(!unanswered.own_account_answered);
        assert_eq!(
            portal_missing_own_account(Some(&unanswered)),
            ["payer_own_account"]
        );
        assert_eq!(portal_missing_own_account(None), ["payer_own_account"]);
        assert!(unanswered.portal_json()["acts_on_own_account"].is_null());

        // "No" needs the person in whose interest the patient acts.
        let mut answer = portal("self");
        answer.acts_on_own_account = Some(false);
        answer.beneficial_owner = Some("  ".into());
        let no = from_portal(Some(&unanswered), &answer).unwrap();
        assert!(no.own_account_answered);
        assert!(!no.acts_on_own_account);
        assert_eq!(
            portal_missing_own_account(Some(&no)),
            ["payer_beneficial_owner"]
        );
        answer.beneficial_owner = Some(" Viktor Zahler, 06.05.1970, Wien ".into());
        let named = from_portal(Some(&no), &answer).unwrap();
        assert_eq!(
            named.beneficial_owner_name.as_deref(),
            Some("Viktor Zahler, 06.05.1970, Wien")
        );
        assert!(portal_missing_own_account(Some(&named)).is_empty());
        assert_eq!(named.portal_json()["acts_on_own_account"], false);
        assert_eq!(
            named.portal_json()["beneficial_owner"],
            "Viktor Zahler, 06.05.1970, Wien"
        );

        // A save that leaves the block out keeps the answer and the person,
        // and staff's further details with them.
        let mut with_note = named.clone();
        with_note.beneficial_owner_note = Some("Onkel".into());
        let kept = from_portal(Some(&with_note), &portal("self")).unwrap();
        assert_eq!(kept, with_note);

        // "Yes" has nobody to name.
        let mut yes = portal("self");
        yes.acts_on_own_account = Some(true);
        yes.beneficial_owner = Some("Viktor Zahler".into());
        let own = from_portal(Some(&with_note), &yes).unwrap();
        assert!(own.acts_on_own_account && own.own_account_answered);
        assert_eq!(own.beneficial_owner_name, None);
        assert_eq!(own.beneficial_owner_note, None);
        assert!(portal_missing_own_account(Some(&own)).is_empty());
        assert_eq!(own.portal_json()["acts_on_own_account"], true);
        assert!(own.portal_json()["beneficial_owner"].is_null());

        // Another person named: the details of the previous one go.
        answer.beneficial_owner = Some("Erika Anders".into());
        let other = from_portal(Some(&with_note), &answer).unwrap();
        assert_eq!(other.beneficial_owner_name.as_deref(), Some("Erika Anders"));
        assert_eq!(other.beneficial_owner_note, None);

        answer.beneficial_owner = Some("x".repeat(LONG_TEXT_MAX + 1));
        let error = from_portal(None, &answer).unwrap_err();
        assert_eq!(portal_field_of(error), "payer_beneficial_owner");
    }

    #[test]
    fn identity_key_changes_only_with_the_payer() {
        let declaration = from_input(&input("third_party")).unwrap();
        let mut other = declaration.clone();
        other.email = Some("new@example.org".into());
        other.source_of_funds = Some("savings".into());
        assert_eq!(declaration.identity_key(), other.identity_key());
        other.last_name = Some("Anders".into());
        assert_ne!(declaration.identity_key(), other.identity_key());

        // The type and the name of an organisation name the payer as well.
        let company = from_input(&organisation("company", "Beispiel GmbH")).unwrap();
        let renamed = from_input(&organisation("company", "Beispiel Holding GmbH")).unwrap();
        let insurer = from_input(&organisation("insurance", "Beispiel GmbH")).unwrap();
        assert_ne!(company.identity_key(), renamed.identity_key());
        assert_ne!(company.identity_key(), insurer.identity_key());
        assert_ne!(company.identity_key(), declaration.identity_key());
    }

    fn organisation(payer_type: &str, name: &str) -> DeclarationInput {
        DeclarationInput {
            payer_type: Some(Some(payer_type.into())),
            organisation_name: Some(Some(name.into())),
            ..input("third_party")
        }
    }

    #[test]
    fn an_organisation_payer_has_a_name_and_a_seat_and_no_person_data() {
        // The natural-person fields of the body are dropped, not even checked.
        let mut value = organisation("company", " Beispiel GmbH ");
        value.date_of_birth = Some("not a date".into());
        value.place_of_birth = Some("Wien".into());
        value.citizenships = vec!["XX".into()];
        let declaration = from_input(&value).unwrap();
        assert!(declaration.is_organisation());
        assert_eq!(declaration.payer_type.as_deref(), Some("company"));
        assert_eq!(
            declaration.organisation_name.as_deref(),
            Some("Beispiel GmbH")
        );
        assert_eq!(declaration.first_name, None);
        assert_eq!(declaration.last_name, None);
        assert_eq!(declaration.date_of_birth, None);
        assert_eq!(declaration.place_of_birth, None);
        assert!(declaration.citizenships.is_empty());
        // The address stays: it is the seat, and its country counts for AML.
        assert_eq!(declaration.street.as_deref(), Some("Hauptstr. 1"));
        assert_eq!(declaration.country.as_deref(), Some("DE"));
        assert_eq!(declaration.email.as_deref(), Some("erika@example.org"));
        assert_eq!(declaration.payer_name().as_deref(), Some("Beispiel GmbH"));
        assert_eq!(declaration.to_json()["organisation_name"], "Beispiel GmbH");
        assert_eq!(declaration.missing(), [PayerReason::PayerNotInformed]);
        assert!(informed(declaration).missing().is_empty());

        // Staff completeness: the name and the whole seat.
        let mut no_seat = organisation("insurance", "Beispiel Versicherung AG");
        no_seat.city = None;
        assert_eq!(
            informed(from_input(&no_seat).unwrap()).missing(),
            [PayerReason::PayerIdentityIncomplete]
        );
        let unnamed = informed(from_input(&organisation("organisation", " ")).unwrap());
        assert_eq!(unnamed.payer_name(), None);
        assert_eq!(unnamed.missing(), [PayerReason::PayerIdentityIncomplete]);

        // A person again: the organisation name goes.
        let person = from_input(&organisation("person", "Beispiel GmbH")).unwrap();
        assert!(!person.is_organisation());
        assert_eq!(person.organisation_name, None);
        assert_eq!(person.payer_name().as_deref(), Some("Erika Muster"));

        // A self-payer has nothing of a third party.
        let mut own = organisation("company", "Beispiel GmbH");
        own.payer_kind = PAYER_KIND_SELF.into();
        own.relationship_kind = Some(Some("employer".into()));
        let own = from_input(&own).unwrap();
        assert_eq!(own.payer_type, None);
        assert_eq!(own.organisation_name, None);
        assert_eq!(own.relationship_kind, None);
        assert_eq!(own.street, None);

        assert_eq!(
            from_input(&organisation("club", "Beispiel e. V.")),
            Err("payer_type_invalid")
        );
        assert_eq!(
            from_input(&organisation("company", &"x".repeat(SHORT_TEXT_MAX + 1))),
            Err("payer_organisation_name_too_long")
        );
    }

    #[test]
    fn a_staff_save_keeps_what_its_body_leaves_out() {
        let mut first = organisation("company", "Beispiel GmbH");
        first.relationship_kind = Some(Some("employer".into()));
        let stored = from_input(&first).unwrap();

        // The staff form of an older client: none of the new keys.
        let kept = declaration_from_input(&input("third_party"), Some(&stored), today()).unwrap();
        assert_eq!(kept.payer_type.as_deref(), Some("company"));
        assert_eq!(kept.organisation_name.as_deref(), Some("Beispiel GmbH"));
        assert_eq!(kept.relationship_kind.as_deref(), Some("employer"));
        assert_eq!(kept.first_name, None, "still an organisation");
        assert_eq!(kept, stored);

        // `null` clears: a third party without a type is a person.
        let mut cleared = input("third_party");
        cleared.payer_type = Some(None);
        cleared.relationship_kind = Some(None);
        let person = declaration_from_input(&cleared, Some(&stored), today()).unwrap();
        assert_eq!(person.payer_type.as_deref(), Some(PAYER_TYPE_PERSON));
        assert_eq!(person.organisation_name, None);
        assert_eq!(person.relationship_kind, None);
        assert_eq!(person.first_name.as_deref(), Some("Erika"));

        // What a self-payer's row holds is nothing to take over.
        let own = from_input(&input("self")).unwrap();
        let named = declaration_from_input(&input("third_party"), Some(&own), today()).unwrap();
        assert_eq!(named.payer_type.as_deref(), Some(PAYER_TYPE_PERSON));

        // In the body: a key left out is not a key with `null`.
        let body: DeclarationInput =
            serde_json::from_value(json!({ "payer_kind": "third_party" })).unwrap();
        assert!(body.payer_type.is_none());
        assert!(body.organisation_name.is_none());
        assert!(body.relationship_kind.is_none());
        let body: DeclarationInput = serde_json::from_value(json!({
            "payer_kind": "third_party",
            "payer_type": null,
            "organisation_name": "Beispiel GmbH",
            "relationship_kind": "friend"
        }))
        .unwrap();
        assert_eq!(body.payer_type, Some(None));
        assert_eq!(body.organisation_name, Some(Some("Beispiel GmbH".into())));
        assert_eq!(body.relationship_kind, Some(Some("friend".into())));
        // The consent to contact the payer is the lead's: staff cannot set it.
        assert!(
            serde_json::from_value::<DeclarationInput>(json!({
                "payer_kind": "third_party",
                "contact_consent_at": "2026-10-03T09:20:00Z"
            }))
            .is_err()
        );
    }

    #[test]
    fn the_relationship_is_a_kind_and_words_only_for_other() {
        let mut value = input("third_party");
        value.relationship_kind = Some(Some("parent".into()));
        let declaration = from_input(&value).unwrap();
        assert_eq!(declaration.relationship_kind.as_deref(), Some("parent"));
        assert_eq!(
            declaration.relationship, None,
            "the words belong to `other`"
        );
        assert_eq!(
            declaration.relationship_label().as_deref(),
            Some("Elternteil")
        );

        value.relationship_kind = Some(Some("other".into()));
        let declaration = from_input(&value).unwrap();
        assert_eq!(declaration.relationship.as_deref(), Some("Tochter"));
        assert_eq!(declaration.relationship_label().as_deref(), Some("Tochter"));

        // Entered before the list existed: the words stay without a kind.
        let earlier = from_input(&input("third_party")).unwrap();
        assert_eq!(earlier.relationship_kind, None);
        assert_eq!(earlier.relationship.as_deref(), Some("Tochter"));

        value.relationship_kind = Some(Some("neighbour".into()));
        assert_eq!(from_input(&value), Err("payer_relationship_kind_invalid"));
    }

    fn portal_person() -> PortalPayerInput {
        PortalPayerInput {
            first_name: Some("Viktor".into()),
            last_name: Some("Zahler".into()),
            citizenships: vec!["AT".into()],
            ..portal("third_party")
        }
    }

    #[test]
    fn the_cabinet_names_a_person_or_an_organisation_and_what_is_missing() {
        // Left out, the type is a person (older clients).
        let person = from_portal(None, &portal_person()).unwrap();
        assert_eq!(person.payer_type.as_deref(), Some(PAYER_TYPE_PERSON));
        assert_eq!(
            portal_missing(Some(&person)),
            ["payer_relationship_kind", "payer_contact_consent"]
        );

        // "Other" asks for the words.
        let mut answer = portal_person();
        answer.relationship_kind = Some("other".into());
        answer.contact_consent = Some(true);
        let other = from_portal(Some(&person), &answer).unwrap();
        assert_eq!(portal_missing(Some(&other)), ["payer_relationship"]);
        answer.relationship = Some(" Nachbar ".into());
        let complete = from_portal(Some(&other), &answer).unwrap();
        assert_eq!(complete.relationship.as_deref(), Some("Nachbar"));
        assert!(portal_missing(Some(&complete)).is_empty());

        // A company pays: its name and seat country instead of the person,
        // whose data are dropped even when the body still carries them.
        let company = PortalPayerInput {
            payer_type: Some("company".into()),
            organisation_name: Some("Beispiel GmbH".into()),
            ..portal_person()
        };
        let organisation = from_portal(Some(&complete), &company).unwrap();
        assert!(organisation.is_organisation());
        assert_eq!(organisation.first_name, None);
        assert_eq!(organisation.last_name, None);
        assert!(organisation.citizenships.is_empty());
        assert_eq!(
            portal_missing(Some(&organisation)),
            [
                "payer_relationship_kind",
                "payer_country",
                "payer_contact_consent"
            ]
        );
        let shown = organisation.portal_json();
        assert_eq!(shown["payer_type"], "company");
        assert_eq!(shown["organisation_name"], "Beispiel GmbH");
        assert!(shown["relationship_kind"].is_null());
        assert!(shown["contact_consent_at"].is_null());

        let unnamed = PortalPayerInput {
            payer_type: Some("insurance".into()),
            relationship_kind: Some("business_partner".into()),
            country: Some("de".into()),
            contact_consent: Some(true),
            ..portal("third_party")
        };
        let insurer = from_portal(None, &unnamed).unwrap();
        assert_eq!(portal_missing(Some(&insurer)), ["payer_organisation_name"]);
        let shown = insurer.portal_json();
        assert_eq!(shown["relationship_kind"], "business_partner");
        assert_eq!(shown["contact_consent_at"], "2026-10-03T09:20:00Z");

        // A refused value names its field.
        for (refused, code, field) in [
            (
                PortalPayerInput {
                    payer_type: Some("club".into()),
                    ..portal("third_party")
                },
                "payer_type_invalid",
                "payer_type",
            ),
            (
                PortalPayerInput {
                    payer_type: Some("company".into()),
                    organisation_name: Some("x".repeat(SHORT_TEXT_MAX + 1)),
                    ..portal("third_party")
                },
                "payer_organisation_name_too_long",
                "payer_organisation_name",
            ),
            (
                PortalPayerInput {
                    relationship_kind: Some("neighbour".into()),
                    ..portal("third_party")
                },
                "payer_relationship_kind_invalid",
                "payer_relationship_kind",
            ),
        ] {
            let error = from_portal(None, &refused).unwrap_err();
            assert_eq!((error, portal_field_of(error)), (code, field));
        }
    }

    #[test]
    fn the_contact_consent_is_recorded_once_and_belongs_to_the_named_payer() {
        let later = now() + chrono::Duration::hours(2);
        let save = |previous: &Declaration, input: &PortalPayerInput| {
            declaration_from_portal(Some(previous), input, today(), later).unwrap()
        };
        let mut answer = portal_person();
        answer.contact_consent = Some(true);
        let agreed = from_portal(None, &answer).unwrap();
        assert_eq!(agreed.contact_consent_at, Some(now()));

        // Recorded once: the same answer later keeps the first time, and so
        // does a save that leaves the key out.
        assert_eq!(save(&agreed, &answer), agreed);
        answer.contact_consent = None;
        answer.street = Some("Zahlweg 7".into());
        assert_eq!(save(&agreed, &answer).contact_consent_at, Some(now()));

        // Somebody else is named: the consent was not given for that payer.
        answer.last_name = Some("Anders".into());
        assert_eq!(save(&agreed, &answer).contact_consent_at, None);
        answer.contact_consent = Some(true);
        let other = save(&agreed, &answer);
        assert_eq!(other.contact_consent_at, Some(later));

        // `false` removes it; a self-payer has nobody to contact.
        answer.contact_consent = Some(false);
        assert_eq!(save(&other, &answer).contact_consent_at, None);
        let mut own = portal("self");
        own.contact_consent = Some(true);
        assert_eq!(save(&agreed, &own).contact_consent_at, None);
    }
}
