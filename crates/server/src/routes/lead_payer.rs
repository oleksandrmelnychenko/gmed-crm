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
//! payer sign first, GMED second.
//!
//! After conversion the declaration belongs to the patient record
//! ([`patient_declaration`]: the one of the most recently converted lead). It
//! is shown on the patient card (`routes/patient_payer_summary.rs`), pre-sets
//! the payer of a new order of the patient ([`preset_order_payer_from_patient`])
//! and is a step of the payer a new invoice inherits
//! (`invoices/payer.rs::inherited_invoice_payer`). See
//! `docs/architecture/lead-payer-declaration_ua.md`.
//!
//! Sections 7 and 8 of the owner's form (phase 2, 2026-10-06) live on the
//! same row: where the invoice goes (`invoice_to` and the other address — the
//! input of the invoice recipient chain, never the Kostenübernehmer of the
//! order) and how the payer will pay (`payment_method` …, the payer's own
//! answer; the row is the payer). The cabinet patches them with
//! [`save_billing_from_portal`]; every other save keeps them
//! ([`Declaration::carry_billing`]), staff add only the USt-IdNr. and the
//! Steuernummer. Cash, crypto, another method or a payment through a third
//! person are compliance flags for staff ([`Declaration::payment_route_flags`]);
//! they block nothing.
//!
//! A patient who pays himself states the source of the funds in the cabinet
//! too (owner request 2026-10-05, "proof of income"): the sources of the
//! person list ([`SOURCE_OF_FUNDS`]) and a description
//! (`self_funds_sources`, `self_funds_description`), patched with
//! [`save_self_funds_from_portal`] and kept by every other save
//! ([`Declaration::carry_self_funds`]) while the patient pays. The proof is a
//! portal upload (`self_funds_proof`), required only while the enhanced check
//! is required ([`portal_missing_self_funds`]). The lead's statement counts
//! for the source of funds of the declaration as well as staff's
//! ([`Declaration::source_of_funds_stated`]).

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
use crate::routes::lead_representatives;
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

/// Where the invoice goes (`invoice_to`, section 7): to the patient, to the
/// declared third party (only with one) or to the patient at another address.
pub const INVOICE_TO_SELF: &str = "self";
pub const INVOICE_TO_PAYER: &str = "payer";
pub const INVOICE_TO_OTHER: &str = "other";
pub const INVOICE_TO_VALUES: &[&str] = &[INVOICE_TO_SELF, INVOICE_TO_PAYER, INVOICE_TO_OTHER];

/// How the payer will pay (`payment_method`, section 8).
pub const PAYMENT_METHOD_BANK_TRANSFER: &str = "bank_transfer";
pub const PAYMENT_METHOD_CARD: &str = "card";
pub const PAYMENT_METHOD_CASH: &str = "cash";
pub const PAYMENT_METHOD_CRYPTO: &str = "crypto";
pub const PAYMENT_METHOD_OTHER: &str = "other";
pub const PAYMENT_METHODS: &[&str] = &[
    PAYMENT_METHOD_BANK_TRANSFER,
    PAYMENT_METHOD_CARD,
    PAYMENT_METHOD_CASH,
    PAYMENT_METHOD_CRYPTO,
    PAYMENT_METHOD_OTHER,
];

/// Template of the cost assumption declaration (Kostenübernahmeerklärung).
pub const COST_ASSUMPTION_TEMPLATE: &str = "cost_coverage_declaration";

/// Binding stored on a generated Kostenübernahmeerklärung: the version of the
/// payer it names. A document of an earlier payer no longer counts.
pub const PAYER_IDENTITY_BINDING_KEY: &str = "_payer_identity_version";

const SHORT_TEXT_MAX: usize = 200;
const LONG_TEXT_MAX: usize = 2000;
/// Limits of sections 7 and 8 that differ from the short text (the database
/// checks the same).
const ZIP_MAX: usize = 20;
const EMAIL_MAX: usize = 254;
const INVOICE_VAT_ID_MAX: usize = 20;
const INVOICE_TAX_NUMBER_MAX: usize = 30;

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
    /// When the lead agreed that GMED passes the cost estimate — service
    /// types and amounts only, no diagnoses or treatment names — to the payer
    /// named (owner decision 2026-10-06, phase 3b). Like the consent to
    /// contact the payer: only the lead gives or removes it, and it goes with
    /// another payer.
    pub cost_estimate_consent_at: Option<DateTime<Utc>>,
    /// Section 7 (invoice recipient): where the invoice goes
    /// ([`INVOICE_TO_VALUES`]); `None` until the lead answered.
    pub invoice_to: Option<String>,
    /// The other address (`invoice_to = other` only).
    pub invoice_name: Option<String>,
    pub invoice_street: Option<String>,
    pub invoice_zip: Option<String>,
    pub invoice_city: Option<String>,
    pub invoice_country: Option<String>,
    /// E-mail for invoices (`self` or `other`; cleared for `payer`).
    pub invoice_email: Option<String>,
    /// USt-IdNr. and Steuernummer of the invoice recipient: staff fields,
    /// never touched by the cabinet.
    pub invoice_vat_id: Option<String>,
    pub invoice_tax_number: Option<String>,
    /// Section 8 (payment route): how the payer will pay
    /// ([`PAYMENT_METHODS`]); the details describe the method `other`.
    pub payment_method: Option<String>,
    pub payment_method_details: Option<String>,
    /// Bank transfer or card: the country of the account, its holder and the
    /// bank.
    pub account_country: Option<String>,
    pub account_holder: Option<String>,
    pub bank_name: Option<String>,
    /// Paid through a third person or a payment service provider; the
    /// details say who or which.
    pub via_third_party: Option<bool>,
    pub via_third_party_details: Option<String>,
    /// When the payer's identity was adopted from the payer's own answers
    /// through its link ([`adopt_payer_identity`], QA retest 2026-10-06), and
    /// the [`Declaration::payer_key`] it was adopted for. While the
    /// declaration names that payer, the lead's cabinet sees only the name,
    /// the type, the relationship and the own consent, and does not change
    /// the payer — also after a change of the payer's e-mail reset the
    /// statement. Every save for the same payer keeps both
    /// ([`Declaration::carry_identity_adoption`]); another payer clears them.
    pub identity_adopted_at: Option<DateTime<Utc>>,
    pub identity_adopted_key: Option<Value>,
    /// The self-payer's own statement in the cabinet: the sources of the
    /// funds ([`SOURCE_OF_FUNDS`], form order) and a description (required
    /// with `other`). Only the cabinet writes them; empty for a third party.
    pub self_funds_sources: Vec<String>,
    pub self_funds_description: Option<String>,
}

const DECLARATION_COLUMNS: &str = "payer_kind, acts_on_own_account, own_account_answered, \
     beneficial_owner_name, beneficial_owner_note, source_of_funds, source_of_funds_description, \
     source_of_funds_document_id, payer_type, organisation_name, first_name, last_name, \
     date_of_birth, place_of_birth, street, zip, city, country, citizenships, \
     relationship_kind, relationship, email, phone, payer_informed_at, payer_informed_by, \
     contact_consent_at, invoice_to, invoice_name, invoice_street, invoice_zip, invoice_city, \
     invoice_country, invoice_email, invoice_vat_id, invoice_tax_number, payment_method, \
     payment_method_details, account_country, account_holder, bank_name, via_third_party, \
     via_third_party_details, identity_adopted_at, identity_adopted_key, identity_changed_at, \
     cost_estimate_consent_at, self_funds_sources, self_funds_description, patient_id, \
     created_at, updated_at";

/// The two keys of the self-payer's source of funds the cabinet edits (API
/// keys = column names = keys of `progress.missing_for_submit`).
const SELF_FUNDS_PORTAL_FIELDS: [&str; 2] = ["self_funds_sources", "self_funds_description"];

/// The 14 keys of sections 7 and 8 the cabinet edits (API keys = column
/// names), in form order; the two tax fields of section 7 are staff's.
const BILLING_PORTAL_FIELDS: [&str; 14] = [
    "invoice_to",
    "invoice_name",
    "invoice_street",
    "invoice_zip",
    "invoice_city",
    "invoice_country",
    "invoice_email",
    "payment_method",
    "payment_method_details",
    "account_country",
    "account_holder",
    "bank_name",
    "via_third_party",
    "via_third_party_details",
];

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
            cost_estimate_consent_at: row.try_get("cost_estimate_consent_at").unwrap_or_default(),
            invoice_to: row.try_get("invoice_to").unwrap_or_default(),
            invoice_name: row.try_get("invoice_name").unwrap_or_default(),
            invoice_street: row.try_get("invoice_street").unwrap_or_default(),
            invoice_zip: row.try_get("invoice_zip").unwrap_or_default(),
            invoice_city: row.try_get("invoice_city").unwrap_or_default(),
            invoice_country: row.try_get("invoice_country").unwrap_or_default(),
            invoice_email: row.try_get("invoice_email").unwrap_or_default(),
            invoice_vat_id: row.try_get("invoice_vat_id").unwrap_or_default(),
            invoice_tax_number: row.try_get("invoice_tax_number").unwrap_or_default(),
            payment_method: row.try_get("payment_method").unwrap_or_default(),
            payment_method_details: row.try_get("payment_method_details").unwrap_or_default(),
            account_country: row.try_get("account_country").unwrap_or_default(),
            account_holder: row.try_get("account_holder").unwrap_or_default(),
            bank_name: row.try_get("bank_name").unwrap_or_default(),
            via_third_party: row.try_get("via_third_party").unwrap_or_default(),
            via_third_party_details: row.try_get("via_third_party_details").unwrap_or_default(),
            identity_adopted_at: row.try_get("identity_adopted_at").unwrap_or_default(),
            identity_adopted_key: row.try_get("identity_adopted_key").unwrap_or_default(),
            self_funds_sources: row
                .try_get::<Option<Vec<String>>, _>("self_funds_sources")
                .ok()
                .flatten()
                .unwrap_or_default(),
            self_funds_description: row.try_get("self_funds_description").unwrap_or_default(),
        }
    }

    /// Who pays, as the order payer record (a free-text contact with the
    /// payer's address, role `cost_bearer`) and in the cost assumption
    /// declaration: the name of the organisation, or first and last name.
    pub(crate) fn payer_name(&self) -> Option<String> {
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

    /// The third party as the payer record of an order or invoice: a
    /// free-text contact with the payer's e-mail, phone, relationship and
    /// address, role `cost_bearer`. `None` for a self-payer and for a third
    /// party without a name. `notes` are the record's own notes, which the
    /// declaration never writes.
    pub(crate) fn order_payer_record(&self, notes: Option<String>) -> Option<PayerRecord> {
        if !self.is_third_party() {
            return None;
        }
        Some(PayerRecord {
            payer_patient_id: None,
            payer_patient_relation_id: None,
            contact_name: Some(self.payer_name()?),
            contact_email: self.email.clone(),
            contact_phone: self.phone.clone(),
            contact_relationship: self.relationship_label(),
            notes,
            address_street: self.street.clone(),
            address_zip: self.zip.clone(),
            address_city: self.city.clone(),
            address_country: self.country.clone(),
            payer_role: Some(PAYER_ROLE_COST_BEARER.to_string()),
        })
    }

    /// What the patient card shows of the declaration: who pays, how the
    /// payer is reached and where the invoice goes (section 7 with the tax
    /// fields). None of the GwG answers (own account, beneficial owner,
    /// source of funds), no date or place of birth, no citizenships, and
    /// nothing of the payment route (section 8 is compliance evidence and
    /// stays in the lead wizard).
    pub(crate) fn billing_json(&self) -> Value {
        json!({
            "payer_kind": self.payer_kind,
            "payer_type": self.payer_type,
            "name": self.payer_name(),
            "organisation_name": self.organisation_name,
            "first_name": self.first_name,
            "last_name": self.last_name,
            "relationship_kind": self.relationship_kind,
            "relationship": self.relationship,
            "street": self.street,
            "zip": self.zip,
            "city": self.city,
            "country": self.country,
            "email": self.email,
            "phone": self.phone,
            "contact_consent_at": self.contact_consent_at.map(|at| at.to_rfc3339()),
            "payer_informed_at": self.payer_informed_at.map(|at| at.to_rfc3339()),
            "invoice_to": self.invoice_to,
            "invoice_name": self.invoice_name,
            "invoice_street": self.invoice_street,
            "invoice_zip": self.invoice_zip,
            "invoice_city": self.invoice_city,
            "invoice_country": self.invoice_country,
            "invoice_email": self.invoice_email,
            "invoice_vat_id": self.invoice_vat_id,
            "invoice_tax_number": self.invoice_tax_number,
        })
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
            // Read-only: only the lead gives it (phase 3b).
            "cost_estimate_consent_at": self.cost_estimate_consent_at.map(|at| at.to_rfc3339()),
            "invoice_to": self.invoice_to,
            "invoice_name": self.invoice_name,
            "invoice_street": self.invoice_street,
            "invoice_zip": self.invoice_zip,
            "invoice_city": self.invoice_city,
            "invoice_country": self.invoice_country,
            "invoice_email": self.invoice_email,
            "invoice_vat_id": self.invoice_vat_id,
            "invoice_tax_number": self.invoice_tax_number,
            "payment_method": self.payment_method,
            "payment_method_details": self.payment_method_details,
            "account_country": self.account_country,
            "account_holder": self.account_holder,
            "bank_name": self.bank_name,
            "via_third_party": self.via_third_party,
            "via_third_party_details": self.via_third_party_details,
            // Read-only: set by the payer's own link, kept for the same payer.
            "identity_adopted_at": self.identity_adopted_at.map(|at| at.to_rfc3339()),
            // Read-only: the self-payer's own statement in the cabinet.
            "self_funds_sources": self.self_funds_sources,
            "self_funds_description": self.self_funds_description,
        })
    }

    /// The self-payer stated the source of the funds in the cabinet: at least
    /// one source, and the description with `other`.
    pub(crate) fn self_funds_stated(&self) -> bool {
        self.payer_kind == PAYER_KIND_SELF
            && !self.self_funds_sources.is_empty()
            && (!self
                .self_funds_sources
                .iter()
                .any(|source| source == "other")
                || !blank(&self.self_funds_description))
    }

    /// The source of funds is stated: by staff (`source_of_funds`, described
    /// with `other`) or, for a self-payer, by the lead in the cabinet.
    pub(crate) fn source_of_funds_stated(&self) -> bool {
        let staff_described = self.source_of_funds.as_deref() != Some("other")
            || !blank(&self.source_of_funds_description);
        (self.source_of_funds.is_some() && staff_described) || self.self_funds_stated()
    }

    /// What is still missing before GMED may countersign, in check order.
    fn missing(&self) -> Vec<PayerReason> {
        let mut reasons = Vec::new();
        if !self.acts_on_own_account && blank(&self.beneficial_owner_name) {
            reasons.push(PayerReason::BeneficialOwnerMissing);
        }
        if !self.source_of_funds_stated() {
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
    /// USt-IdNr. and Steuernummer of the invoice recipient (phase 2,
    /// 2026-10-06): the only keys of sections 7 and 8 staff write. A key that
    /// is left out keeps the stored value, `null` or `""` clears it.
    #[serde(default, deserialize_with = "sent")]
    invoice_vat_id: Option<Option<String>>,
    #[serde(default, deserialize_with = "sent")]
    invoice_tax_number: Option<Option<String>>,
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
/// out, and the lead's answers of sections 7 and 8
/// ([`Declaration::carry_billing`]), of which the body may set only the two
/// tax fields, and the record of an identity the payer stated through its own
/// link ([`Declaration::carry_identity_adoption`]). The consent to contact
/// the payer is no input: the callers carry it over.
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
    // The lead's answers of sections 7 and 8 survive the save; staff may set
    // the two tax fields of the invoice recipient.
    declaration.carry_billing(previous);
    // So does the self-payer's source of funds, while the patient pays.
    declaration.carry_self_funds(previous);
    // So does the record that the payer stated this identity itself.
    declaration.carry_identity_adoption(previous);
    if let Some(value) = &input.invoice_vat_id {
        declaration.invoice_vat_id =
            text(value, INVOICE_VAT_ID_MAX).map_err(|_| "invoice_vat_id_too_long")?;
    }
    if let Some(value) = &input.invoice_tax_number {
        declaration.invoice_tax_number =
            text(value, INVOICE_TAX_NUMBER_MAX).map_err(|_| "invoice_tax_number_too_long")?;
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
    /// The lead's citizenships and a third-party payer's residence and
    /// citizenships (`status.aml_countries`, information only: whether the
    /// enhanced check is required decides `lead_enhanced_check`).
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
               RETURNING payer_kind, acts_on_own_account, source_of_funds, invoice_to,
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
                       'invoice_to', linked.invoice_to,
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
    let payer = match load_payer_state(&mut conn, lead_id).await {
        Ok(payer) => payer,
        Err(error) => return database_error(error, "load payer declaration"),
    };
    let representation = match lead_representatives::load(&mut conn, lead_id).await {
        Ok(loaded) => loaded.unwrap_or_default().representation,
        Err(error) => return database_error(error, "load payer declaration representatives"),
    };
    let package = match crate::routes::lead_payer_package::status_summary(&mut conn, lead_id).await
    {
        Ok(package) => package,
        Err(error) => return database_error(error, "load payer signature package"),
    };
    let mut payload = payer.payload();
    let required = json!(contact_consent_required(
        payer.declaration.as_ref(),
        &representation
    ));
    // The consent to pass the cost estimate on is asked of the same people
    // as the consent to contact the payer (phase 3b).
    payload["status"]["contact_consent_required"] = required.clone();
    payload["status"]["cost_estimate_consent_required"] = required.clone();
    payload["status"]["payer_package"] = package;
    if payload["declaration"].is_object() {
        payload["declaration"]["contact_consent_required"] = required.clone();
        payload["declaration"]["cost_estimate_consent_required"] = required;
    }
    Json(payload).into_response()
}

/// Whether the lead's consent that GMED passes the contact on to the payer
/// is needed (`contact_consent_required` of the staff JSON, QA 2026-10-06):
/// not when the third-party payer is a representative of the minor who holds
/// a cabinet login — that parent is the one who pays and answers in the own
/// cabinet ([`lead_representatives::payer_same_person`]); otherwise it is.
pub(crate) fn contact_consent_required(
    declaration: Option<&Declaration>,
    representation: &lead_representatives::Representation,
) -> bool {
    !lead_representatives::payer_same_person(representation, declaration)
        .and_then(|id| representation.find(id))
        .is_some_and(lead_representatives::Representative::has_login)
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
    // Only the lead gives or removes the consent to contact the payer and the
    // consent to pass the cost estimate on to the payer: staff keep both as
    // long as a third party pays.
    if declaration.is_third_party() {
        declaration.contact_consent_at = previous
            .as_ref()
            .and_then(|previous| previous.contact_consent_at);
        declaration.cost_estimate_consent_at = previous
            .as_ref()
            .and_then(|previous| previous.cost_estimate_consent_at);
    }
    // The payer's own link informs the payer (Art. 14 notice in the
    // invitation, phase 3a), a paying parent by acknowledging the notice in
    // the cabinet: a staff form that does not tick the checkbox — an older
    // client above all — keeps that record for the same payer.
    if declaration.is_third_party()
        && declaration.payer_informed_at.is_none()
        && let Some(previous) = previous.as_ref().filter(|previous| {
            previous.is_third_party()
                && previous.payer_informed_at.is_some()
                && previous.payer_key() == declaration.payer_key()
        })
    {
        match crate::routes::lead_payer_link::link_sent_for(
            &mut tx,
            lead_id,
            &declaration.payer_key(),
        )
        .await
        {
            Ok(true) => {
                declaration.payer_informed_at = previous.payer_informed_at;
                declaration.payer_informed_by = previous.payer_informed_by;
            }
            Ok(false) => {}
            Err(error) => return database_error(error, "load payer link e-mails"),
        }
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
        Some(auth.user_id),
        identity_changed,
    )
    .await
    {
        return database_error(error, "save payer declaration");
    }
    // Another payer or another e-mail address: the payer's link stops
    // working, and another payer's answers go — with a link payer's
    // payment route when only the address changed.
    if let Err(error) = crate::routes::lead_payer_link::payer_changed_in_tx(
        &mut tx,
        lead_id,
        previous.as_ref(),
        &mut declaration,
        Some(auth.user_id),
    )
    .await
    {
        return database_error(error, "reset payer link");
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
    if let Err(error) = sync_order_payers(&mut tx, lead_id, &declaration, Some(auth.user_id)).await
    {
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
/// named in a cost assumption document (see `identity_changed_at`). `actor`
/// is `None` for the payer's own link (no login).
async fn store_declaration(
    conn: &mut PgConnection,
    lead_id: Uuid,
    declaration: &Declaration,
    actor: Option<Uuid>,
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
               payer_type, organisation_name, relationship_kind, contact_consent_at,
               invoice_to, invoice_name, invoice_street, invoice_zip, invoice_city,
               invoice_country, invoice_email, invoice_vat_id, invoice_tax_number,
               payment_method, payment_method_details, account_country, account_holder,
               bank_name, via_third_party, via_third_party_details, identity_adopted_at,
               identity_adopted_key, cost_estimate_consent_at, self_funds_sources,
               self_funds_description)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
                   $16, $17, $18, $19, $20, $23, $24, clock_timestamp(), $21, $21, $25,
                   $26, $27, $28, $29, $30, $31, $32, $33, $34, $35, $36, $37, $38, $39,
                   $40, $41, $42, $43, $44, $45, $46, $47, $48, $49, $50)
           ON CONFLICT (lead_id) DO UPDATE SET
               payer_kind = EXCLUDED.payer_kind,
               payer_type = EXCLUDED.payer_type,
               organisation_name = EXCLUDED.organisation_name,
               relationship_kind = EXCLUDED.relationship_kind,
               contact_consent_at = EXCLUDED.contact_consent_at,
               cost_estimate_consent_at = EXCLUDED.cost_estimate_consent_at,
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
               invoice_to = EXCLUDED.invoice_to,
               invoice_name = EXCLUDED.invoice_name,
               invoice_street = EXCLUDED.invoice_street,
               invoice_zip = EXCLUDED.invoice_zip,
               invoice_city = EXCLUDED.invoice_city,
               invoice_country = EXCLUDED.invoice_country,
               invoice_email = EXCLUDED.invoice_email,
               invoice_vat_id = EXCLUDED.invoice_vat_id,
               invoice_tax_number = EXCLUDED.invoice_tax_number,
               payment_method = EXCLUDED.payment_method,
               payment_method_details = EXCLUDED.payment_method_details,
               account_country = EXCLUDED.account_country,
               account_holder = EXCLUDED.account_holder,
               bank_name = EXCLUDED.bank_name,
               via_third_party = EXCLUDED.via_third_party,
               via_third_party_details = EXCLUDED.via_third_party_details,
               identity_adopted_at = EXCLUDED.identity_adopted_at,
               identity_adopted_key = EXCLUDED.identity_adopted_key,
               self_funds_sources = EXCLUDED.self_funds_sources,
               self_funds_description = EXCLUDED.self_funds_description,
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
    .bind(&declaration.invoice_to)
    .bind(&declaration.invoice_name)
    .bind(&declaration.invoice_street)
    .bind(&declaration.invoice_zip)
    .bind(&declaration.invoice_city)
    .bind(&declaration.invoice_country)
    .bind(&declaration.invoice_email)
    .bind(&declaration.invoice_vat_id)
    .bind(&declaration.invoice_tax_number)
    .bind(&declaration.payment_method)
    .bind(&declaration.payment_method_details)
    .bind(&declaration.account_country)
    .bind(&declaration.account_holder)
    .bind(&declaration.bank_name)
    .bind(declaration.via_third_party)
    .bind(&declaration.via_third_party_details)
    .bind(declaration.identity_adopted_at)
    .bind(&declaration.identity_adopted_key)
    .bind(declaration.cost_estimate_consent_at)
    .bind(&declaration.self_funds_sources)
    .bind(&declaration.self_funds_description)
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
    /// agreed that GMED contacts it. The payer's link keeps a snapshot of it
    /// (`lead_payer_links.payer_key`): another payer makes the link invalid.
    pub(crate) fn payer_key(&self) -> Value {
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

/// The declaration that counts for a patient after conversion, and the lead
/// it was made for.
#[derive(Clone, Debug)]
pub(crate) struct PatientDeclaration {
    pub lead_id: Uuid,
    pub declaration: Declaration,
    /// When the lead was converted (its last status change; nothing writes
    /// the status of a converted lead afterwards).
    pub converted_at: DateTime<Utc>,
    /// When the payer named now was declared (`identity_changed_at`).
    pub declared_at: Option<DateTime<Utc>>,
}

/// The declaration of a patient: the one of the most recently converted lead
/// of the patient (a repeat intake converts a lead of its own and overwrites
/// the summary in `patients.legal_status.payer_declaration` the same way).
/// `None` for a patient created without a lead. An open, unconverted lead of
/// the patient never counts here.
pub(crate) async fn patient_declaration(
    conn: &mut PgConnection,
    patient_id: Uuid,
) -> Result<Option<PatientDeclaration>, sqlx::Error> {
    let declaration_columns = DECLARATION_COLUMNS
        .split(',')
        .map(|column| format!("d.{}", column.trim()))
        .collect::<Vec<_>>()
        .join(", ");
    let row = sqlx::query(&format!(
        r#"SELECT d.lead_id, l.status_changed_at AS converted_at, {declaration_columns}
           FROM lead_payer_declarations d
           JOIN leads l ON l.id = d.lead_id
           WHERE d.patient_id = $1 AND l.converted_patient_id = $1
           ORDER BY l.status_changed_at DESC NULLS LAST, d.updated_at DESC, d.lead_id DESC
           LIMIT 1"#
    ))
    .bind(patient_id)
    .fetch_optional(conn)
    .await?;
    Ok(row.map(|row| PatientDeclaration {
        lead_id: row.try_get("lead_id").unwrap_or_default(),
        declaration: Declaration::from_row(&row),
        converted_at: row
            .try_get::<DateTime<Utc>, _>("converted_at")
            .unwrap_or_else(|_| Utc::now()),
        declared_at: row
            .try_get::<Option<DateTime<Utc>>, _>("identity_changed_at")
            .ok()
            .flatten()
            .or_else(|| {
                row.try_get::<Option<DateTime<Utc>>, _>("created_at")
                    .ok()
                    .flatten()
            }),
    }))
}

/// The payer's identity, address and contact keys of [`portal_payload`] the
/// lead no longer sees once the payer answered through its own link.
const PAYER_ANSWERED_HIDDEN_KEYS: [&str; 8] = [
    "date_of_birth",
    "street",
    "zip",
    "city",
    "country",
    "citizenships",
    "email",
    "phone",
];

/// The cabinet's view of the declaration; `null` until the question is
/// answered. `answered_by_payer` (QA 2026-10-06): the payer stated its own
/// identity through its link
/// ([`crate::routes::lead_payer_link::answered_by_payer`]) — the lead sees
/// the payer's type, name, relationship and the own consent only, every
/// other identity, address and contact key is `null`.
pub(crate) fn portal_payload(declaration: Option<&Declaration>, answered_by_payer: bool) -> Value {
    let Some(declaration) = declaration else {
        return Value::Null;
    };
    let mut value = declaration.portal_json();
    if answered_by_payer {
        for key in PAYER_ANSWERED_HIDDEN_KEYS {
            value[key] = Value::Null;
        }
    }
    value["answered_by_payer"] = json!(answered_by_payer);
    // The lead's own consent to pass the cost estimate on to the payer (phase
    // 3b): shown also while the payer's identity is the payer's own answer.
    // Kept out of `portal_json`, the "entered by the patient" marker of the
    // "who pays" answer, because it is saved through its own endpoint.
    value["cost_estimate_consent_at"] = json!(declaration.cost_estimate_consent_at);
    value
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
        // The payer receives the cost estimate only with the lead's consent
        // (phase 3b, owner decision 2026-10-06).
        if declaration.cost_estimate_consent_at.is_none() {
            missing.push("payer_cost_estimate_consent");
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
        // The tax fields of the invoice recipient are staff's: kept as stored.
        invoice_vat_id: None,
        invoice_tax_number: None,
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
        // The consent to pass the cost estimate on has an endpoint of its
        // own; the "who pays" answer keeps it for the same payer and drops it
        // with another one, like the consent to contact the payer.
        declaration.cost_estimate_consent_at =
            same_payer.and_then(|previous| previous.cost_estimate_consent_at);
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
    let mut declaration =
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
    store_declaration(conn, lead_id, &declaration, Some(actor), identity_changed).await?;
    // Another payer or another e-mail address: the payer's link stops
    // working, and another payer's answers go — with a link payer's
    // payment route when only the address changed.
    crate::routes::lead_payer_link::payer_changed_in_tx(
        conn,
        lead_id,
        previous.as_ref(),
        &mut declaration,
        Some(actor),
    )
    .await?;
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
    sync_order_payers(conn, lead_id, &declaration, Some(actor)).await?;
    Ok(Some(declaration))
}

/// The payer's own answers become the payer of the declaration when the payer
/// submits them (phase 3a, D8): `declaration` is the stored one with the
/// payer's identity written over it (the caller clones and changes it). It is
/// stored without the reset rules of the other save paths — no
/// [`Declaration::carry_billing`], no reset of the payer's link —, dated as a
/// new payer identity when the identity key changed, audited as a diff and
/// synced onto the lead's orders. `actor` is `None` for the payer's link.
///
/// Through the payer's link (`link_id`) the adoption is recorded with the
/// payer key it was made for (`identity_adopted_at`, `identity_adopted_key`):
/// the lead's cabinet keeps the payer's identity hidden while the declaration
/// names that payer. A paying parent's answers in the cabinet record nothing
/// (the parent is a login of that cabinet); a record of the same payer stays.
pub(crate) async fn adopt_payer_identity(
    conn: &mut PgConnection,
    lead_id: Uuid,
    declaration: &Declaration,
    actor: Option<Uuid>,
    link_id: Option<Uuid>,
) -> Result<(), sqlx::Error> {
    let previous = load_declaration(conn, lead_id).await?;
    let mut declaration = declaration.clone();
    if link_id.is_some() && declaration.is_third_party() {
        // The precision the database keeps.
        declaration.identity_adopted_at = Some(Utc::now().trunc_subsecs(6));
        declaration.identity_adopted_key = Some(declaration.payer_key());
    } else {
        declaration.carry_identity_adoption(previous.as_ref());
    }
    let declaration = &declaration;
    if previous.as_ref() == Some(declaration) {
        return Ok(());
    }
    let identity_changed = previous
        .as_ref()
        .is_none_or(|previous| previous.identity_key() != declaration.identity_key());
    store_declaration(conn, lead_id, declaration, actor, identity_changed).await?;
    let mut event = audit::domain_diff_event(
        "payer_link_adopt_payer_declaration",
        actor,
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
        "link_id": link_id,
        "payer_kind": declaration.payer_kind,
        "identity_changed": identity_changed,
    });
    audit::write_in_transaction(conn, &event).await?;
    sync_order_payers(conn, lead_id, declaration, actor).await
}

/// Section 8 as the payer states it through its own link (phase 3a): the
/// cabinet's validation and dependent clearing ([`apply_billing_patch`]),
/// returning the declaration to store and the changed keys. Only the keys of
/// section 8 reach this point.
pub(crate) fn apply_payment_route_patch(
    current: &Declaration,
    patch: &PortalBillingPatch,
) -> Result<(Declaration, Vec<&'static str>), PortalBillingError> {
    let next = apply_billing_patch(current, patch)?;
    let changed = changed_billing_fields(current, &next);
    Ok((next, changed))
}

/// Stores section 8 the payer changed: the identity stays as it is, no reset
/// rule applies, nobody's login wrote it.
pub(crate) async fn store_payment_route(
    conn: &mut PgConnection,
    lead_id: Uuid,
    declaration: &Declaration,
) -> Result<(), sqlx::Error> {
    store_declaration(conn, lead_id, declaration, None, false).await
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
    actor: Option<Uuid>,
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
            match declaration.order_payer_record(previous.notes.clone()) {
                Some(next) => next,
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
        write_order_payer(
            tx,
            order_id,
            &previous,
            &next,
            actor,
            json!({ "source": "lead_payer_declaration", "lead_id": lead_id }),
        )
        .await?;
    }
    Ok(())
}

/// Writes the payer of an order (the row is already locked by the caller)
/// and audits the change like the order payer dialog (`set_order_payer`,
/// old and new payer, `context` says where the payer came from) in the same
/// transaction. `actor` is `None` when the payer's own link changed the
/// payer (phase 3a).
async fn write_order_payer(
    tx: &mut PgConnection,
    order_id: Uuid,
    previous: &PayerRecord,
    next: &PayerRecord,
    actor: Option<Uuid>,
    context: Value,
) -> Result<(), sqlx::Error> {
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
        actor,
        "order",
        Some(order_id),
        previous.to_audit_json(),
        next.to_audit_json(),
    );
    event.context = context;
    audit::write_in_transaction(&mut *tx, &event).await
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
        sync_order_payers(&mut tx, lead_id, &declaration, Some(actor)).await?;
    }
    tx.commit().await
}

/// A new order of a converted patient starts with the third party the
/// patient's declaration names as payer (role `cost_bearer`), like a lead's
/// order does. Nothing is written — `Ok(false)` — when the order already has
/// a payer, when a relation of the patient is the default payer (a later,
/// patient-level decision by staff that wins over the declaration), or when
/// the declaration names no third party. The change is audited with
/// `source = patient_payer_declaration`.
pub(crate) async fn preset_order_payer_from_patient(
    tx: &mut PgConnection,
    order_id: Uuid,
    patient_id: Uuid,
    actor: Uuid,
) -> Result<bool, sqlx::Error> {
    let Some(order) = sqlx::query(&format!(
        "SELECT {} FROM orders o WHERE o.id = $1 FOR UPDATE",
        payer_columns("o", "")
    ))
    .bind(order_id)
    .fetch_optional(&mut *tx)
    .await?
    else {
        return Ok(false);
    };
    let previous = PayerRecord::from_row(&order, "");
    if previous.is_set() {
        return Ok(false);
    }
    let has_default_payer: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM patient_relations WHERE patient_id = $1 AND is_default_payer)",
    )
    .bind(patient_id)
    .fetch_one(&mut *tx)
    .await?;
    if has_default_payer {
        return Ok(false);
    }
    let Some(declared) = patient_declaration(&mut *tx, patient_id).await? else {
        return Ok(false);
    };
    let Some(next) = declared
        .declaration
        .order_payer_record(previous.notes.clone())
    else {
        return Ok(false);
    };
    write_order_payer(
        tx,
        order_id,
        &previous,
        &next,
        Some(actor),
        json!({
            "source": "patient_payer_declaration",
            "lead_id": declared.lead_id,
            "patient_id": patient_id,
        }),
    )
    .await?;
    Ok(true)
}

/// [`preset_order_payer_from_patient`] in a transaction of its own, for an
/// order created outside one.
pub(crate) async fn preset_patient_order_payer(
    db: &gmed_db::DbPool,
    order_id: Uuid,
    patient_id: Uuid,
    actor: Uuid,
) -> Result<bool, sqlx::Error> {
    let mut tx = db.begin().await?;
    let written = preset_order_payer_from_patient(&mut tx, order_id, patient_id, actor).await?;
    tx.commit().await?;
    Ok(written)
}

// ----------------------------------------------------------------------------
// Lead cabinet: invoice recipient (section 7) and payment route (section 8)
// ----------------------------------------------------------------------------

/// Who answers section 8 for the one who looks at the cabinet (owner spec,
/// phase 2): the patient — whoever fills the cabinet — while nobody else pays
/// or nobody has said who pays yet; the paying parent of a minor when the
/// caller's login is that parent; otherwise the third party itself, whom the
/// cabinet does not ask (the payer answers through a link of its own in a
/// later phase, or to staff).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum PaymentRouteBy {
    Patient,
    Guardian,
    Payer,
}

impl PaymentRouteBy {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Patient => "patient",
            Self::Guardian => "guardian",
            Self::Payer => "payer",
        }
    }

    /// The cabinet asks the caller for the payment route.
    pub(crate) fn asks(self) -> bool {
        !matches!(self, Self::Payer)
    }
}

/// Why a billing save from the cabinet was refused.
#[derive(Debug)]
pub(crate) enum PortalBillingError {
    /// A value the cabinet has to correct (422 `invalid_field`): the key it
    /// names (an unknown key as sent) and why.
    Invalid {
        field: String,
        message: &'static str,
    },
    /// The caller is not the one who answers section 8 (409
    /// `payment_route_by_payer`); nothing is saved.
    RouteByPayer,
    /// Nobody has said who pays yet: sections 7 and 8 live on the payer
    /// declaration, so the cabinet answers "who pays" first (409
    /// `payer_not_declared`).
    NotDeclared,
    Database(sqlx::Error),
}

impl From<sqlx::Error> for PortalBillingError {
    fn from(error: sqlx::Error) -> Self {
        Self::Database(error)
    }
}

/// Partial update of sections 7 and 8 from the cabinet (only the changed
/// keys). `null` or an empty string clears a text or a choice;
/// `via_third_party` is `true`, `false` or `null`. Unknown keys — the two
/// tax fields of staff above all — are rejected.
#[derive(Debug, Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct PortalBillingPatch {
    #[serde(default, deserialize_with = "sent")]
    invoice_to: Option<Option<String>>,
    #[serde(default, deserialize_with = "sent")]
    invoice_name: Option<Option<String>>,
    #[serde(default, deserialize_with = "sent")]
    invoice_street: Option<Option<String>>,
    #[serde(default, deserialize_with = "sent")]
    invoice_zip: Option<Option<String>>,
    #[serde(default, deserialize_with = "sent")]
    invoice_city: Option<Option<String>>,
    #[serde(default, deserialize_with = "sent")]
    invoice_country: Option<Option<String>>,
    #[serde(default, deserialize_with = "sent")]
    invoice_email: Option<Option<String>>,
    #[serde(default, deserialize_with = "sent")]
    payment_method: Option<Option<String>>,
    #[serde(default, deserialize_with = "sent")]
    payment_method_details: Option<Option<String>>,
    #[serde(default, deserialize_with = "sent")]
    account_country: Option<Option<String>>,
    #[serde(default, deserialize_with = "sent")]
    account_holder: Option<Option<String>>,
    #[serde(default, deserialize_with = "sent")]
    bank_name: Option<Option<String>>,
    #[serde(default, deserialize_with = "sent")]
    via_third_party: Option<Option<bool>>,
    #[serde(default, deserialize_with = "sent")]
    via_third_party_details: Option<Option<String>>,
}

impl PortalBillingPatch {
    /// Reads the body of the endpoint: only the 14 keys of the cabinet, each
    /// a text or `null` (`via_third_party` a boolean or `null`). The first
    /// unknown key or value of the wrong type names its field, as the
    /// cabinet shows errors per field.
    pub(crate) fn parse(body: &Value) -> Result<Self, PortalBillingError> {
        let invalid = |field: &str, message: &'static str| PortalBillingError::Invalid {
            field: field.to_string(),
            message,
        };
        let Some(object) = body.as_object() else {
            return Err(invalid("body", "A JSON object is expected"));
        };
        for (key, value) in object {
            let key = key.as_str();
            if !BILLING_PORTAL_FIELDS.contains(&key) {
                return Err(invalid(key, "Unknown field"));
            }
            let expected = match (key, value) {
                (_, Value::Null) => true,
                ("via_third_party", Value::Bool(_)) => true,
                ("via_third_party", _) => false,
                (_, Value::String(_)) => true,
                _ => false,
            };
            if !expected {
                return Err(invalid(
                    key,
                    if key == "via_third_party" {
                        "true, false or null is expected"
                    } else {
                        "A text is expected"
                    },
                ));
            }
        }
        serde_json::from_value(body.clone())
            .map_err(|_| invalid("body", "The body could not be read"))
    }

    /// A key of section 8 is in the body.
    pub(crate) fn touches_payment_route(&self) -> bool {
        self.payment_method.is_some()
            || self.payment_method_details.is_some()
            || self.account_country.is_some()
            || self.account_holder.is_some()
            || self.bank_name.is_some()
            || self.via_third_party.is_some()
            || self.via_third_party_details.is_some()
    }
}

/// A single-line value of the cabinet: inner whitespace collapsed, ends
/// trimmed, no control characters, at most `max` characters; empty is
/// `None`.
fn billing_text(value: Option<&str>, max: usize) -> Result<Option<String>, &'static str> {
    let value = value
        .unwrap_or_default()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    if value.chars().count() > max {
        return Err("Too long");
    }
    if value.chars().any(char::is_control) {
        return Err("Invalid characters");
    }
    Ok((!value.is_empty()).then_some(value))
}

/// A description that may run over several lines: only the ends are
/// trimmed.
fn billing_long_text(value: Option<&str>, max: usize) -> Result<Option<String>, &'static str> {
    let value = value
        .unwrap_or_default()
        .replace("\r\n", "\n")
        .replace('\r', "\n");
    let value = value.trim();
    if value.chars().count() > max {
        return Err("Too long");
    }
    if value
        .chars()
        .any(|ch| ch.is_control() && ch != '\n' && ch != '\t')
    {
        return Err("Invalid characters");
    }
    Ok((!value.is_empty()).then(|| value.to_string()))
}

/// One of `values`, or `None` for an empty value.
fn billing_choice(value: Option<&str>, values: &[&str]) -> Result<Option<String>, &'static str> {
    let value = value.map(str::trim).unwrap_or_default();
    if value.is_empty() {
        return Ok(None);
    }
    if values.contains(&value) {
        Ok(Some(value.to_string()))
    } else {
        Err("Not one of the allowed values")
    }
}

impl Declaration {
    /// The answers of sections 7 and 8 survive every save that does not
    /// touch them (the whole row is written each time): copied from
    /// `previous`, then the two rules of the spec. "To the payer" needs a
    /// third party and goes when the patient pays himself; section 8 belongs
    /// to the payer named when it was answered and goes when who pays
    /// changes or (third party) another person or organisation is named —
    /// the same rule as for the consent to contact the payer.
    pub(crate) fn carry_billing(&mut self, previous: Option<&Declaration>) {
        let Some(previous) = previous else {
            return;
        };
        self.invoice_to = previous.invoice_to.clone();
        self.invoice_name = previous.invoice_name.clone();
        self.invoice_street = previous.invoice_street.clone();
        self.invoice_zip = previous.invoice_zip.clone();
        self.invoice_city = previous.invoice_city.clone();
        self.invoice_country = previous.invoice_country.clone();
        self.invoice_email = previous.invoice_email.clone();
        self.invoice_vat_id = previous.invoice_vat_id.clone();
        self.invoice_tax_number = previous.invoice_tax_number.clone();
        self.payment_method = previous.payment_method.clone();
        self.payment_method_details = previous.payment_method_details.clone();
        self.account_country = previous.account_country.clone();
        self.account_holder = previous.account_holder.clone();
        self.bank_name = previous.bank_name.clone();
        self.via_third_party = previous.via_third_party;
        self.via_third_party_details = previous.via_third_party_details.clone();
        if !self.is_third_party() && self.invoice_to.as_deref() == Some(INVOICE_TO_PAYER) {
            self.invoice_to = None;
        }
        let same_payer = previous.payer_kind == self.payer_kind
            && (!self.is_third_party() || previous.payer_key() == self.payer_key());
        if !same_payer {
            self.clear_payment_route();
        }
        self.clear_dependent_billing();
    }

    /// The self-payer's source of funds from the cabinet survives every save
    /// that does not touch it while the patient pays (the whole row is
    /// written each time); with a third party it goes (data minimization: the
    /// payer states its own source of funds).
    pub(crate) fn carry_self_funds(&mut self, previous: Option<&Declaration>) {
        let kept = previous.filter(|previous| {
            self.payer_kind == PAYER_KIND_SELF && previous.payer_kind == PAYER_KIND_SELF
        });
        self.self_funds_sources = kept
            .map(|previous| previous.self_funds_sources.clone())
            .unwrap_or_default();
        self.self_funds_description =
            kept.and_then(|previous| previous.self_funds_description.clone());
    }

    /// The record that the payer stated its identity through its own link
    /// (`identity_adopted_at`, `identity_adopted_key`) survives every save
    /// that names the same payer — the whole row is written each time, a
    /// change of the e-mail address included — and goes when who pays
    /// changes or another person or organisation is named (another
    /// [`Declaration::payer_key`]).
    pub(crate) fn carry_identity_adoption(&mut self, previous: Option<&Declaration>) {
        let same_payer = previous.filter(|previous| {
            previous.payer_kind == self.payer_kind && previous.payer_key() == self.payer_key()
        });
        self.identity_adopted_at = same_payer.and_then(|previous| previous.identity_adopted_at);
        self.identity_adopted_key =
            same_payer.and_then(|previous| previous.identity_adopted_key.clone());
    }

    /// Whether the declaration names the payer whose identity was adopted
    /// from the payer's own answers through its link: the lead's cabinet then
    /// shows only the payer's name, type, relationship and the own consent and
    /// does not change the payer
    /// ([`crate::routes::lead_payer_link::answered_by_payer`]).
    pub(crate) fn identity_adopted_for_current_payer(&self) -> bool {
        self.is_third_party()
            && self.identity_adopted_at.is_some()
            && self
                .identity_adopted_key
                .as_ref()
                .is_some_and(|key| *key == self.payer_key())
    }

    /// Clears section 8 and returns the keys that held an answer: the payer's
    /// link went to another address, and what the payer at the old one
    /// answered goes ([`crate::routes::lead_payer_link::payer_changed_in_tx`]).
    pub(crate) fn take_payment_route(&mut self) -> Vec<&'static str> {
        let before = self.clone();
        self.clear_payment_route();
        changed_billing_fields(&before, self)
    }

    /// Section 8 as nobody answered it.
    fn clear_payment_route(&mut self) {
        self.payment_method = None;
        self.payment_method_details = None;
        self.account_country = None;
        self.account_holder = None;
        self.bank_name = None;
        self.via_third_party = None;
        self.via_third_party_details = None;
    }

    /// The fields that depend on an answer go with any other answer (data
    /// minimization): the other address only with `other`, the e-mail not
    /// for the payer, the details only for the method `other`, the account
    /// only for a bank transfer or a card, the details of a payment through
    /// a third party only with "yes".
    fn clear_dependent_billing(&mut self) {
        if self.invoice_to.as_deref() != Some(INVOICE_TO_OTHER) {
            self.invoice_name = None;
            self.invoice_street = None;
            self.invoice_zip = None;
            self.invoice_city = None;
            self.invoice_country = None;
        }
        if self.invoice_to.as_deref() == Some(INVOICE_TO_PAYER) {
            self.invoice_email = None;
        }
        if self.payment_method.as_deref() != Some(PAYMENT_METHOD_OTHER) {
            self.payment_method_details = None;
        }
        if !matches!(
            self.payment_method.as_deref(),
            Some(PAYMENT_METHOD_BANK_TRANSFER | PAYMENT_METHOD_CARD)
        ) {
            self.account_country = None;
            self.account_holder = None;
            self.bank_name = None;
        }
        if self.via_third_party != Some(true) {
            self.via_third_party_details = None;
        }
    }

    /// What staff look at more closely (GwG): cash, crypto, another method,
    /// a payment through a third person or a payment service provider. Shown
    /// in the wizard and printed on the identification sheet; nothing is
    /// blocked by it.
    pub(crate) fn payment_route_flags(&self) -> Vec<&'static str> {
        let mut flags = Vec::new();
        match self.payment_method.as_deref() {
            Some(PAYMENT_METHOD_CASH) => flags.push("cash_payment"),
            Some(PAYMENT_METHOD_CRYPTO) => flags.push("crypto_payment"),
            Some(PAYMENT_METHOD_OTHER) => flags.push("other_method"),
            _ => {}
        }
        if self.via_third_party == Some(true) {
            flags.push("third_party_payment");
        }
        flags
    }

    /// Sections 7 and 8 as the cabinet shows them (`billing` of the request
    /// object): the answers, whether a third party is declared (only then
    /// "to the payer" is offered), who answers section 8 for the caller and
    /// the name to pre-fill the account holder with. Section 8 is the payer's
    /// own answer: a caller who is not asked for it (`payer`) sees none of it
    /// (phase 3a — the third party answers through its own link).
    pub(crate) fn billing_portal_json(
        &self,
        payment_route_by: PaymentRouteBy,
        account_holder_suggestion: Option<&str>,
    ) -> Value {
        let shown = payment_route_by.asks();
        let route = |value: Value| if shown { value } else { Value::Null };
        json!({
            "invoice_to": self.invoice_to,
            "invoice_name": self.invoice_name,
            "invoice_street": self.invoice_street,
            "invoice_zip": self.invoice_zip,
            "invoice_city": self.invoice_city,
            "invoice_country": self.invoice_country,
            "invoice_email": self.invoice_email,
            "payer_declared": self.is_third_party(),
            "payment_route_by": payment_route_by.as_str(),
            "payment_method": route(json!(self.payment_method)),
            "payment_method_details": route(json!(self.payment_method_details)),
            "account_country": route(json!(self.account_country)),
            "account_holder": route(json!(self.account_holder)),
            "bank_name": route(json!(self.bank_name)),
            "via_third_party": route(json!(self.via_third_party)),
            "via_third_party_details": route(json!(self.via_third_party_details)),
            "account_holder_suggestion": account_holder_suggestion,
        })
    }

    /// Sections 7 and 8 for staff (`billing` of `GET /leads/{id}/portal-intake`):
    /// the cabinet's keys with the tax fields and the compliance flags, and
    /// who answers section 8 as seen from the lead's side (`patient` while
    /// the cabinet asks somebody, `payer` when the third party answers
    /// itself).
    pub(crate) fn billing_staff_json(&self, payment_route_by: PaymentRouteBy) -> Value {
        json!({
            "invoice_to": self.invoice_to,
            "invoice_name": self.invoice_name,
            "invoice_street": self.invoice_street,
            "invoice_zip": self.invoice_zip,
            "invoice_city": self.invoice_city,
            "invoice_country": self.invoice_country,
            "invoice_email": self.invoice_email,
            "invoice_vat_id": self.invoice_vat_id,
            "invoice_tax_number": self.invoice_tax_number,
            "payment_route_by": payment_route_by.as_str(),
            "payment_method": self.payment_method,
            "payment_method_details": self.payment_method_details,
            "account_country": self.account_country,
            "account_holder": self.account_holder,
            "bank_name": self.bank_name,
            "via_third_party": self.via_third_party,
            "via_third_party_details": self.via_third_party_details,
            "compliance_flags": self.payment_route_flags(),
        })
    }

    /// Stable text of what the cabinet entered in sections 7 and 8, for the
    /// "entered by the patient" marker of the lead (the tax fields are
    /// staff's and not part of it).
    pub(crate) fn billing_marker_value(&self) -> String {
        let answers = self.to_json();
        BILLING_PORTAL_FIELDS
            .iter()
            .map(|field| answers[*field].to_string())
            .collect::<Vec<_>>()
            .join("|")
    }
}

/// `billing` of the request object; the sections as nobody answered them
/// while there is no declaration.
pub(crate) fn portal_billing_payload(
    declaration: Option<&Declaration>,
    payment_route_by: PaymentRouteBy,
    account_holder_suggestion: Option<&str>,
) -> Value {
    declaration
        .cloned()
        .unwrap_or_default()
        .billing_portal_json(payment_route_by, account_holder_suggestion)
}

/// Applies the cabinet's patch to the stored declaration; the result is what
/// gets stored. A wrong choice, country or e-mail, a text over its limit and
/// "to the payer" without a third party are refused with the key they name;
/// the fields that depend on another answer are cleared.
pub(crate) fn apply_billing_patch(
    current: &Declaration,
    patch: &PortalBillingPatch,
) -> Result<Declaration, PortalBillingError> {
    let invalid = |field: &str, message: &'static str| PortalBillingError::Invalid {
        field: field.to_string(),
        message,
    };
    let short = |value: &Option<String>, field: &str, max: usize| {
        billing_text(value.as_deref(), max).map_err(|message| invalid(field, message))
    };
    let country = |value: &Option<String>, field: &str| {
        normalize_country_code(value.as_deref())
            .map_err(|_| invalid(field, "Use an ISO 3166-1 alpha-2 country code"))
    };
    let mut next = current.clone();
    if let Some(value) = &patch.invoice_to {
        next.invoice_to = billing_choice(value.as_deref(), INVOICE_TO_VALUES)
            .map_err(|message| invalid("invoice_to", message))?;
    }
    if let Some(value) = &patch.invoice_name {
        next.invoice_name = short(value, "invoice_name", SHORT_TEXT_MAX)?;
    }
    if let Some(value) = &patch.invoice_street {
        next.invoice_street = short(value, "invoice_street", SHORT_TEXT_MAX)?;
    }
    if let Some(value) = &patch.invoice_zip {
        next.invoice_zip = short(value, "invoice_zip", ZIP_MAX)?;
    }
    if let Some(value) = &patch.invoice_city {
        next.invoice_city = short(value, "invoice_city", SHORT_TEXT_MAX)?;
    }
    if let Some(value) = &patch.invoice_country {
        next.invoice_country = country(value, "invoice_country")?;
    }
    if let Some(value) = &patch.invoice_email {
        let email = short(value, "invoice_email", EMAIL_MAX)?;
        if email
            .as_deref()
            .is_some_and(|email| !is_plausible_email(email))
        {
            return Err(invalid("invoice_email", "Invalid e-mail address"));
        }
        next.invoice_email = email;
    }
    if let Some(value) = &patch.payment_method {
        next.payment_method = billing_choice(value.as_deref(), PAYMENT_METHODS)
            .map_err(|message| invalid("payment_method", message))?;
    }
    if let Some(value) = &patch.payment_method_details {
        next.payment_method_details = short(value, "payment_method_details", SHORT_TEXT_MAX)?;
    }
    if let Some(value) = &patch.account_country {
        next.account_country = country(value, "account_country")?;
    }
    if let Some(value) = &patch.account_holder {
        next.account_holder = short(value, "account_holder", SHORT_TEXT_MAX)?;
    }
    if let Some(value) = &patch.bank_name {
        next.bank_name = short(value, "bank_name", SHORT_TEXT_MAX)?;
    }
    if let Some(value) = patch.via_third_party {
        next.via_third_party = value;
    }
    if let Some(value) = &patch.via_third_party_details {
        next.via_third_party_details = billing_long_text(value.as_deref(), LONG_TEXT_MAX)
            .map_err(|message| invalid("via_third_party_details", message))?;
    }
    // "To the payer" is an answer only while a third party pays.
    if next.invoice_to.as_deref() == Some(INVOICE_TO_PAYER) && !next.is_third_party() {
        return Err(invalid(
            "invoice_to",
            "The invoice goes to the payer only when a third party pays",
        ));
    }
    next.clear_dependent_billing();
    Ok(next)
}

/// The keys of sections 7 and 8 whose stored value differs between two
/// declarations (the two tax fields included: a save by staff names them in
/// its audit event as well).
fn changed_billing_fields(before: &Declaration, after: &Declaration) -> Vec<&'static str> {
    let (before, after) = (before.to_json(), after.to_json());
    BILLING_PORTAL_FIELDS
        .iter()
        .copied()
        .chain(["invoice_vat_id", "invoice_tax_number"])
        .filter(|field| before[*field] != after[*field])
        .collect()
}

/// Saves the cabinet's patch of sections 7 and 8 in the caller's transaction
/// (the row is locked by `lock_my_lead`), with the audit event that names
/// the changed fields. Returns the declaration when something changed. The
/// order payer is not touched: section 7 changes where the invoice goes,
/// never who the Kostenübernehmer of the order is.
pub(crate) async fn save_billing_from_portal(
    conn: &mut PgConnection,
    lead_id: Uuid,
    actor: Uuid,
    access_kind: &str,
    patch: &PortalBillingPatch,
    payment_route_by: PaymentRouteBy,
) -> Result<Option<Declaration>, PortalBillingError> {
    let Some(previous) = load_declaration(conn, lead_id).await? else {
        return Err(PortalBillingError::NotDeclared);
    };
    if !payment_route_by.asks() && patch.touches_payment_route() {
        return Err(PortalBillingError::RouteByPayer);
    }
    let next = apply_billing_patch(&previous, patch)?;
    let changed = changed_billing_fields(&previous, &next);
    if changed.is_empty() {
        return Ok(None);
    }
    store_declaration(conn, lead_id, &next, Some(actor), false).await?;
    audit::write_in_transaction(
        conn,
        &audit::domain_event(
            "lead_portal_update_billing",
            Some(actor),
            "lead",
            Some(lead_id),
            json!({ "fields": changed, "access_kind": access_kind }),
        ),
    )
    .await?;
    Ok(Some(next))
}

/// What the cabinet still needs of sections 7 and 8 before the request can
/// be sent, in form order: where the invoice goes and, for another address,
/// the whole address; the payment route only while the caller is asked for
/// it — the method, its details for `other`, the account for a bank transfer
/// or a card (the bank only for a transfer), whether a third party is
/// involved and, if so, who. The e-mail for invoices is never missing.
pub(crate) fn portal_missing_billing(
    declaration: Option<&Declaration>,
    payment_route_by: PaymentRouteBy,
) -> Vec<&'static str> {
    let empty = Declaration::default();
    let declaration = declaration.unwrap_or(&empty);
    let mut missing = Vec::new();
    match declaration.invoice_to.as_deref() {
        None => missing.push("invoice_to"),
        Some(INVOICE_TO_OTHER) => {
            for (field, filled) in [
                ("invoice_name", !blank(&declaration.invoice_name)),
                ("invoice_street", !blank(&declaration.invoice_street)),
                ("invoice_zip", !blank(&declaration.invoice_zip)),
                ("invoice_city", !blank(&declaration.invoice_city)),
                ("invoice_country", declaration.invoice_country.is_some()),
            ] {
                if !filled {
                    missing.push(field);
                }
            }
        }
        Some(_) => {}
    }
    if !payment_route_by.asks() {
        return missing;
    }
    match declaration.payment_method.as_deref() {
        None => missing.push("payment_method"),
        Some(PAYMENT_METHOD_OTHER) if blank(&declaration.payment_method_details) => {
            missing.push("payment_method_details");
        }
        Some(method @ (PAYMENT_METHOD_BANK_TRANSFER | PAYMENT_METHOD_CARD)) => {
            if declaration.account_country.is_none() {
                missing.push("account_country");
            }
            if blank(&declaration.account_holder) {
                missing.push("account_holder");
            }
            if method == PAYMENT_METHOD_BANK_TRANSFER && blank(&declaration.bank_name) {
                missing.push("bank_name");
            }
        }
        Some(_) => {}
    }
    match declaration.via_third_party {
        None => missing.push("via_third_party"),
        Some(true) if blank(&declaration.via_third_party_details) => {
            missing.push("via_third_party_details");
        }
        Some(_) => {}
    }
    missing
}

// ----------------------------------------------------------------------------
// Lead cabinet: the self-payer's source of funds
// ----------------------------------------------------------------------------

/// Why a save of the self-payer's source of funds was refused.
#[derive(Debug)]
pub(crate) enum PortalSelfFundsError {
    /// A value the cabinet has to correct (422 `invalid_field`).
    Invalid {
        field: String,
        message: &'static str,
    },
    /// Nobody has said who pays yet (409 `payer_not_declared`).
    NotDeclared,
    /// A third party pays: its source of funds is the payer's own answer
    /// (409 `payer_not_self`).
    NotSelf,
    Database(sqlx::Error),
}

impl From<sqlx::Error> for PortalSelfFundsError {
    fn from(error: sqlx::Error) -> Self {
        Self::Database(error)
    }
}

/// Partial update of the self-payer's source of funds (only the changed
/// keys): `self_funds_sources` a list of [`SOURCE_OF_FUNDS`] (`null` or `[]`
/// clears it), `self_funds_description` a text (`null` or `""` clears it).
/// Unknown keys are refused.
#[derive(Debug, Default)]
pub(crate) struct PortalSelfFundsPatch {
    sources: Option<Vec<String>>,
    description: Option<Option<String>>,
}

impl PortalSelfFundsPatch {
    /// Reads the body of the endpoint; the first unknown key or value of the
    /// wrong type names its field.
    pub(crate) fn parse(body: &Value) -> Result<Self, PortalSelfFundsError> {
        let invalid = |field: &str, message: &'static str| PortalSelfFundsError::Invalid {
            field: field.to_string(),
            message,
        };
        let Some(object) = body.as_object() else {
            return Err(invalid("body", "A JSON object is expected"));
        };
        let mut patch = Self::default();
        for (key, value) in object {
            match (key.as_str(), value) {
                ("self_funds_sources", Value::Null) => patch.sources = Some(Vec::new()),
                ("self_funds_sources", Value::Array(items)) => {
                    let mut sources = Vec::with_capacity(items.len());
                    for item in items {
                        let Some(source) = item.as_str() else {
                            return Err(invalid(
                                "self_funds_sources",
                                "A list of texts is expected",
                            ));
                        };
                        sources.push(source.trim().to_string());
                    }
                    patch.sources = Some(sources);
                }
                ("self_funds_sources", _) => {
                    return Err(invalid("self_funds_sources", "A list of texts is expected"));
                }
                ("self_funds_description", Value::Null) => patch.description = Some(None),
                ("self_funds_description", Value::String(text)) => {
                    patch.description = Some(Some(text.clone()));
                }
                ("self_funds_description", _) => {
                    return Err(invalid("self_funds_description", "A text is expected"));
                }
                (key, _) => return Err(invalid(key, "Unknown field")),
            }
        }
        Ok(patch)
    }
}

/// Applies the cabinet's patch to the stored declaration of a self-payer:
/// the sources in form order without duplicates, the description trimmed at
/// its ends. A source that is not on the person list, or a description over
/// 2000 characters, is refused with the key it names.
pub(crate) fn apply_self_funds_patch(
    current: &Declaration,
    patch: &PortalSelfFundsPatch,
) -> Result<Declaration, PortalSelfFundsError> {
    let invalid = |field: &str, message: &'static str| PortalSelfFundsError::Invalid {
        field: field.to_string(),
        message,
    };
    let mut next = current.clone();
    if let Some(sources) = &patch.sources {
        if sources
            .iter()
            .any(|source| !SOURCE_OF_FUNDS.contains(&source.as_str()))
        {
            return Err(invalid(
                "self_funds_sources",
                "Not one of the sources of funds",
            ));
        }
        next.self_funds_sources = SOURCE_OF_FUNDS
            .iter()
            .filter(|known| sources.iter().any(|source| source == *known))
            .map(|known| known.to_string())
            .collect();
    }
    if let Some(description) = &patch.description {
        next.self_funds_description = billing_long_text(description.as_deref(), LONG_TEXT_MAX)
            .map_err(|message| invalid("self_funds_description", message))?;
    }
    Ok(next)
}

/// The keys of the self-payer's source of funds whose value differs.
fn changed_self_funds_fields(before: &Declaration, after: &Declaration) -> Vec<&'static str> {
    let mut changed = Vec::new();
    if before.self_funds_sources != after.self_funds_sources {
        changed.push(SELF_FUNDS_PORTAL_FIELDS[0]);
    }
    if before.self_funds_description != after.self_funds_description {
        changed.push(SELF_FUNDS_PORTAL_FIELDS[1]);
    }
    changed
}

impl Declaration {
    /// Stable text of the self-payer's statement, for the "entered by the
    /// patient" marker of the lead.
    pub(crate) fn self_funds_marker_value(&self) -> String {
        json!([self.self_funds_sources, self.self_funds_description]).to_string()
    }
}

/// Saves the cabinet's patch of the self-payer's source of funds in the
/// caller's transaction (the lead is locked by `lock_my_lead`), with the
/// audit event that names the changed fields, never their values. Returns
/// the declaration when something changed. Only a declaration that says the
/// patient pays takes it.
pub(crate) async fn save_self_funds_from_portal(
    conn: &mut PgConnection,
    lead_id: Uuid,
    actor: Uuid,
    access_kind: &str,
    patch: &PortalSelfFundsPatch,
) -> Result<Option<Declaration>, PortalSelfFundsError> {
    let Some(previous) = load_declaration(conn, lead_id).await? else {
        return Err(PortalSelfFundsError::NotDeclared);
    };
    if previous.payer_kind != PAYER_KIND_SELF {
        return Err(PortalSelfFundsError::NotSelf);
    }
    let next = apply_self_funds_patch(&previous, patch)?;
    let changed = changed_self_funds_fields(&previous, &next);
    if changed.is_empty() {
        return Ok(None);
    }
    store_declaration(conn, lead_id, &next, Some(actor), false).await?;
    audit::write_in_transaction(
        conn,
        &audit::domain_event(
            "lead_portal_update_self_funds",
            Some(actor),
            "lead",
            Some(lead_id),
            json!({ "fields": changed, "access_kind": access_kind }),
        ),
    )
    .await?;
    Ok(Some(next))
}

/// Whether the self-payer's proof of funds is required, and whether one is
/// on file (a portal upload `self_funds_proof` of the lead).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) struct SelfFundsProof {
    /// The enhanced check of the lead is required (owner rule 2026-10-07).
    pub required: bool,
    pub uploaded: bool,
}

/// What the cabinet still needs of the self-payer's source of funds before
/// the request can be sent: always the sources and, with `other`, the
/// description; the proof only while the enhanced check is required. Nothing
/// while nobody said who pays or a third party pays.
pub(crate) fn portal_missing_self_funds(
    declaration: Option<&Declaration>,
    proof: SelfFundsProof,
) -> Vec<&'static str> {
    let Some(declaration) =
        declaration.filter(|declaration| declaration.payer_kind == PAYER_KIND_SELF)
    else {
        return Vec::new();
    };
    let mut missing = Vec::new();
    if declaration.self_funds_sources.is_empty() {
        missing.push("self_funds_sources");
    } else if declaration
        .self_funds_sources
        .iter()
        .any(|source| source == "other")
        && blank(&declaration.self_funds_description)
    {
        missing.push("self_funds_description");
    }
    if proof.required && !proof.uploaded {
        missing.push("self_funds_proof_upload");
    }
    missing
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
            invoice_vat_id: None,
            invoice_tax_number: None,
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
            [
                "payer_relationship_kind",
                "payer_contact_consent",
                "payer_cost_estimate_consent"
            ]
        );

        // "Other" asks for the words.
        let mut answer = portal_person();
        answer.relationship_kind = Some("other".into());
        answer.contact_consent = Some(true);
        let other = from_portal(Some(&person), &answer).unwrap();
        assert_eq!(
            portal_missing(Some(&other)),
            ["payer_relationship", "payer_cost_estimate_consent"]
        );
        answer.relationship = Some(" Nachbar ".into());
        let mut complete = from_portal(Some(&other), &answer).unwrap();
        assert_eq!(complete.relationship.as_deref(), Some("Nachbar"));
        assert_eq!(
            portal_missing(Some(&complete)),
            ["payer_cost_estimate_consent"]
        );
        // The consent to pass the cost estimate on (its own endpoint, phase
        // 3b) stays with the same payer through the "who pays" answer.
        complete.cost_estimate_consent_at = Some(
            DateTime::parse_from_rfc3339("2026-10-06T09:00:00Z")
                .unwrap()
                .with_timezone(&Utc),
        );
        assert!(portal_missing(Some(&complete)).is_empty());
        let same = from_portal(Some(&complete), &answer).unwrap();
        assert_eq!(
            same.cost_estimate_consent_at,
            complete.cost_estimate_consent_at
        );
        assert!(portal_payload(Some(&same), true)["cost_estimate_consent_at"].is_string());
        assert!(
            same.portal_json().get("cost_estimate_consent_at").is_none(),
            "not part of the marker of the answer"
        );

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
        // Another payer: both consents of the lead go.
        assert_eq!(organisation.cost_estimate_consent_at, None);
        assert_eq!(
            portal_missing(Some(&organisation)),
            [
                "payer_relationship_kind",
                "payer_country",
                "payer_contact_consent",
                "payer_cost_estimate_consent"
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
        assert_eq!(
            portal_missing(Some(&insurer)),
            ["payer_organisation_name", "payer_cost_estimate_consent"]
        );
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

    #[test]
    fn the_order_payer_record_and_the_card_projection_name_the_third_party_only() {
        let third_party = informed(from_input(&input("third_party")).unwrap());
        let record = third_party
            .order_payer_record(Some("Notiz".into()))
            .unwrap();
        assert_eq!(record.contact_name.as_deref(), Some("Erika Muster"));
        assert_eq!(record.contact_relationship.as_deref(), Some("Tochter"));
        assert_eq!(record.address_country.as_deref(), Some("DE"));
        assert_eq!(record.notes.as_deref(), Some("Notiz"));
        assert_eq!(record.payer_role.as_deref(), Some(PAYER_ROLE_COST_BEARER));
        let mut nameless = third_party.clone();
        nameless.first_name = None;
        nameless.last_name = None;
        assert!(nameless.order_payer_record(None).is_none());
        assert!(
            from_input(&input("self"))
                .unwrap()
                .order_payer_record(None)
                .is_none()
        );

        // The card sees the payer and the contact, never the GwG answers.
        let card = third_party.billing_json();
        assert_eq!(card["name"], "Erika Muster");
        assert_eq!(card["payer_type"], "person");
        assert!(card["payer_informed_at"].is_string());
        for key in [
            "date_of_birth",
            "place_of_birth",
            "citizenships",
            "source_of_funds",
            "acts_on_own_account",
            "beneficial_owner_name",
        ] {
            assert!(card.get(key).is_none(), "{key} must not be shown");
        }
        let own = from_input(&input("self")).unwrap().billing_json();
        assert_eq!(own["payer_kind"], "self");
        assert!(own["name"].is_null());
        assert!(own["payer_type"].is_null());
    }

    fn patch(body: Value) -> PortalBillingPatch {
        PortalBillingPatch::parse(&body).unwrap()
    }

    fn refused_field(result: Result<Declaration, PortalBillingError>) -> String {
        match result {
            Err(PortalBillingError::Invalid { field, .. }) => field,
            other => panic!("not refused: {other:?}"),
        }
    }

    #[test]
    fn the_billing_patch_names_the_refused_key_and_clears_what_depends_on_an_answer() {
        // Unknown keys and wrong types name the key as sent.
        for (body, field) in [
            (json!({ "invoice_vat_id": "DE123" }), "invoice_vat_id"),
            (json!({ "via_third_party": "yes" }), "via_third_party"),
            (json!({ "invoice_city": 7 }), "invoice_city"),
            (json!([]), "body"),
        ] {
            match PortalBillingPatch::parse(&body) {
                Err(PortalBillingError::Invalid { field: named, .. }) => assert_eq!(named, field),
                other => panic!("{body} accepted: {other:?}"),
            }
        }

        // Another address: the whole address is kept with `other` only.
        let own = from_input(&input("self")).unwrap();
        let other = apply_billing_patch(
            &own,
            &patch(json!({
                "invoice_to": "other",
                "invoice_name": "  Anna   Muster ",
                "invoice_street": "Musterweg 1",
                "invoice_zip": "10115",
                "invoice_city": "Berlin",
                "invoice_country": "de",
                "invoice_email": "rechnung@example.com"
            })),
        )
        .unwrap();
        assert_eq!(other.invoice_to.as_deref(), Some("other"));
        assert_eq!(other.invoice_name.as_deref(), Some("Anna Muster"));
        assert_eq!(other.invoice_country.as_deref(), Some("DE"));
        assert_eq!(other.invoice_email.as_deref(), Some("rechnung@example.com"));
        let mine = apply_billing_patch(&other, &patch(json!({ "invoice_to": "self" }))).unwrap();
        assert_eq!(mine.invoice_to.as_deref(), Some("self"));
        assert_eq!(mine.invoice_name, None);
        assert_eq!(mine.invoice_street, None);
        assert_eq!(mine.invoice_country, None);
        assert_eq!(
            mine.invoice_email.as_deref(),
            Some("rechnung@example.com"),
            "the e-mail stays for the patient"
        );
        // `null` or an empty string clears; "to the payer" needs a third party.
        let cleared = apply_billing_patch(
            &mine,
            &patch(json!({ "invoice_to": null, "invoice_email": "" })),
        )
        .unwrap();
        assert_eq!(cleared.invoice_to, None);
        assert_eq!(cleared.invoice_email, None);
        assert_eq!(
            refused_field(apply_billing_patch(
                &own,
                &patch(json!({ "invoice_to": "payer" }))
            )),
            "invoice_to"
        );
        let third_party = informed(from_input(&input("third_party")).unwrap());
        let to_payer = apply_billing_patch(
            &third_party,
            &patch(json!({ "invoice_to": "payer", "invoice_email": "rechnung@example.com" })),
        )
        .unwrap();
        assert_eq!(to_payer.invoice_to.as_deref(), Some("payer"));
        assert_eq!(
            to_payer.invoice_email, None,
            "the payer's own e-mail is used"
        );
        for (body, field) in [
            (json!({ "invoice_to": "someone" }), "invoice_to"),
            (json!({ "invoice_country": "Germany" }), "invoice_country"),
            (json!({ "invoice_email": "no-at-sign" }), "invoice_email"),
            (
                json!({ "invoice_zip": "x".repeat(ZIP_MAX + 1) }),
                "invoice_zip",
            ),
            (json!({ "payment_method": "cheque" }), "payment_method"),
            (json!({ "account_country": "Austria" }), "account_country"),
            (
                json!({ "via_third_party_details": "x".repeat(LONG_TEXT_MAX + 1) }),
                "via_third_party_details",
            ),
        ] {
            assert_eq!(
                refused_field(apply_billing_patch(&own, &patch(body))),
                field
            );
        }

        // The payment route: the account goes with a transfer or a card, the
        // details with `other`, the description with "yes".
        let transfer = apply_billing_patch(
            &own,
            &patch(json!({
                "payment_method": "bank_transfer",
                "account_country": "de",
                "account_holder": "Anna Muster",
                "bank_name": "Musterbank",
                "via_third_party": true,
                "via_third_party_details": " Mein Bruder überweist.\r\n "
            })),
        )
        .unwrap();
        assert_eq!(transfer.account_country.as_deref(), Some("DE"));
        assert_eq!(
            transfer.via_third_party_details.as_deref(),
            Some("Mein Bruder überweist.")
        );
        assert_eq!(
            transfer.payment_route_flags(),
            ["third_party_payment"],
            "a transfer through a third person is flagged"
        );
        let cash = apply_billing_patch(
            &transfer,
            &patch(json!({ "payment_method": "cash", "via_third_party": false })),
        )
        .unwrap();
        assert_eq!(cash.account_country, None);
        assert_eq!(cash.account_holder, None);
        assert_eq!(cash.bank_name, None);
        assert_eq!(cash.via_third_party, Some(false));
        assert_eq!(cash.via_third_party_details, None);
        assert_eq!(cash.payment_route_flags(), ["cash_payment"]);
        let other = apply_billing_patch(
            &cash,
            &patch(json!({ "payment_method": "other", "payment_method_details": "Scheck" })),
        )
        .unwrap();
        assert_eq!(other.payment_method_details.as_deref(), Some("Scheck"));
        assert_eq!(other.payment_route_flags(), ["other_method"]);
        let crypto =
            apply_billing_patch(&other, &patch(json!({ "payment_method": "crypto" }))).unwrap();
        assert_eq!(crypto.payment_method_details, None);
        assert_eq!(crypto.payment_route_flags(), ["crypto_payment"]);
        assert!(
            from_input(&input("self"))
                .unwrap()
                .payment_route_flags()
                .is_empty()
        );

        // The marker follows the cabinet's keys, never the tax fields.
        let mut taxed = crypto.clone();
        taxed.invoice_vat_id = Some("DE123456789".into());
        assert_eq!(taxed.billing_marker_value(), crypto.billing_marker_value());
        assert_ne!(cash.billing_marker_value(), crypto.billing_marker_value());
        assert!(!patch(json!({ "invoice_to": "self" })).touches_payment_route());
        assert!(patch(json!({ "bank_name": null })).touches_payment_route());
    }

    #[test]
    fn the_billing_sections_survive_every_save_and_follow_the_named_payer() {
        // The cabinet answered both sections for a third party.
        let stored = apply_billing_patch(
            &from_input(&input("third_party")).unwrap(),
            &patch(json!({
                "invoice_to": "payer",
                "payment_method": "card",
                "account_country": "AT",
                "account_holder": "Erika Muster",
                "via_third_party": false
            })),
        )
        .unwrap();

        // The staff form of an older client knows none of the keys: all stay.
        let kept = declaration_from_input(&input("third_party"), Some(&stored), today()).unwrap();
        assert_eq!(kept, stored);
        // Staff add the tax fields; `null` clears, an absent key keeps.
        let mut with_tax = input("third_party");
        with_tax.invoice_vat_id = Some(Some(" DE123456789 ".into()));
        with_tax.invoice_tax_number = Some(Some("12/345/67890".into()));
        let taxed = declaration_from_input(&with_tax, Some(&stored), today()).unwrap();
        assert_eq!(taxed.invoice_vat_id.as_deref(), Some("DE123456789"));
        assert_eq!(taxed.invoice_tax_number.as_deref(), Some("12/345/67890"));
        assert_eq!(taxed.payment_method.as_deref(), Some("card"));
        let mut cleared = input("third_party");
        cleared.invoice_vat_id = Some(None);
        let cleared = declaration_from_input(&cleared, Some(&taxed), today()).unwrap();
        assert_eq!(cleared.invoice_vat_id, None);
        assert_eq!(cleared.invoice_tax_number.as_deref(), Some("12/345/67890"));
        let mut too_long = input("third_party");
        too_long.invoice_vat_id = Some(Some("x".repeat(INVOICE_VAT_ID_MAX + 1)));
        assert_eq!(
            declaration_from_input(&too_long, Some(&taxed), today()),
            Err("invoice_vat_id_too_long")
        );
        let body: DeclarationInput = serde_json::from_value(json!({
            "payer_kind": "third_party",
            "invoice_vat_id": null
        }))
        .unwrap();
        assert_eq!(body.invoice_vat_id, Some(None));
        assert!(body.invoice_tax_number.is_none());
        // The cabinet's keys are not staff's.
        assert!(
            serde_json::from_value::<DeclarationInput>(json!({
                "payer_kind": "third_party",
                "invoice_to": "self"
            }))
            .is_err()
        );

        // Another payer is named: section 8 was that payer's answer.
        let mut renamed = input("third_party");
        renamed.last_name = Some("Anders".into());
        let other = declaration_from_input(&renamed, Some(&taxed), today()).unwrap();
        assert_eq!(other.invoice_to.as_deref(), Some("payer"));
        assert_eq!(other.payment_method, None);
        assert_eq!(other.account_holder, None);
        assert_eq!(other.via_third_party, None);
        assert_eq!(other.invoice_vat_id.as_deref(), Some("DE123456789"));
        // A corrected address keeps it.
        let mut moved = input("third_party");
        moved.street = Some("Zahlweg 7".into());
        let moved = declaration_from_input(&moved, Some(&taxed), today()).unwrap();
        assert_eq!(moved.payment_method.as_deref(), Some("card"));

        // The patient pays himself: "to the payer" is no answer any more and
        // section 8 goes; the cabinet's save does the same.
        let own = declaration_from_input(&input("self"), Some(&taxed), today()).unwrap();
        assert_eq!(own.invoice_to, None);
        assert_eq!(own.payment_method, None);
        assert_eq!(own.invoice_vat_id.as_deref(), Some("DE123456789"));
        let other_address = apply_billing_patch(
            &taxed,
            &patch(json!({ "invoice_to": "other", "invoice_name": "Beispiel GmbH" })),
        )
        .unwrap();
        let own = from_portal(Some(&other_address), &portal("self")).unwrap();
        assert_eq!(own.invoice_to.as_deref(), Some("other"));
        assert_eq!(own.invoice_name.as_deref(), Some("Beispiel GmbH"));
        assert_eq!(own.payment_method, None);
        // Back to the same payer: section 8 was cleared, it does not return.
        let again = from_portal(Some(&own), &portal_person()).unwrap();
        assert_eq!(again.payment_method, None);
        assert_eq!(again.invoice_to.as_deref(), Some("other"));
    }

    #[test]
    fn the_adopted_identity_stays_with_the_same_payer_only() {
        // The payer stated its identity through its own link.
        let mut adopted = from_input(&input("third_party")).unwrap();
        adopted.identity_adopted_at = Some(now());
        adopted.identity_adopted_key = Some(adopted.payer_key());
        assert!(adopted.identity_adopted_for_current_payer());

        // Staff save the same payer, another e-mail and phone included.
        let kept = declaration_from_input(&input("third_party"), Some(&adopted), today()).unwrap();
        assert_eq!(kept, adopted);
        let mut readdressed = input("third_party");
        readdressed.email = Some("erika.neu@example.org".into());
        readdressed.phone = Some("+43 1 5550100".into());
        readdressed.street = Some("Neuweg 2".into());
        let readdressed = declaration_from_input(&readdressed, Some(&adopted), today()).unwrap();
        assert_eq!(readdressed.identity_adopted_at, Some(now()));
        assert!(readdressed.identity_adopted_for_current_payer());
        // The billing patch of the cabinet keeps it as well.
        let billed =
            apply_billing_patch(&adopted, &patch(json!({ "invoice_to": "payer" }))).unwrap();
        assert!(billed.identity_adopted_for_current_payer());

        // Another person, another date of birth or another type: gone.
        let mut renamed = input("third_party");
        renamed.last_name = Some("Anders".into());
        let renamed = declaration_from_input(&renamed, Some(&adopted), today()).unwrap();
        assert_eq!(renamed.identity_adopted_at, None);
        assert_eq!(renamed.identity_adopted_key, None);
        assert!(!renamed.identity_adopted_for_current_payer());
        let mut younger = input("third_party");
        younger.date_of_birth = Some("1980-05-01".into());
        let younger = declaration_from_input(&younger, Some(&adopted), today()).unwrap();
        assert!(!younger.identity_adopted_for_current_payer());
        let mut company = input("third_party");
        company.payer_type = Some(Some("company".into()));
        company.organisation_name = Some(Some("Zahl GmbH".into()));
        let company = declaration_from_input(&company, Some(&adopted), today()).unwrap();
        assert_eq!(company.identity_adopted_at, None);
        let own = declaration_from_input(&input("self"), Some(&adopted), today()).unwrap();
        assert_eq!(own.identity_adopted_at, None);
        assert!(!own.identity_adopted_for_current_payer());
        // Back to the adopted payer: the record does not return.
        let back = declaration_from_input(&input("third_party"), Some(&renamed), today()).unwrap();
        assert!(!back.identity_adopted_for_current_payer());

        // A record of another key (an older row) never counts.
        let mut stale = adopted.clone();
        stale.last_name = Some("Anders".into());
        assert!(!stale.identity_adopted_for_current_payer());
    }

    #[test]
    fn the_cabinet_needs_the_invoice_recipient_and_the_route_of_whoever_answers() {
        assert_eq!(
            portal_missing_billing(None, PaymentRouteBy::Patient),
            ["invoice_to", "payment_method", "via_third_party"]
        );
        assert_eq!(
            portal_missing_billing(None, PaymentRouteBy::Payer),
            ["invoice_to"]
        );
        let own = from_input(&input("self")).unwrap();
        let other = apply_billing_patch(
            &own,
            &patch(json!({
                "invoice_to": "other",
                "invoice_name": "Anna Muster",
                "payment_method": "bank_transfer",
                "via_third_party": true
            })),
        )
        .unwrap();
        assert_eq!(
            portal_missing_billing(Some(&other), PaymentRouteBy::Guardian),
            [
                "invoice_street",
                "invoice_zip",
                "invoice_city",
                "invoice_country",
                "account_country",
                "account_holder",
                "bank_name",
                "via_third_party_details"
            ]
        );
        let card = apply_billing_patch(
            &other,
            &patch(json!({
                "invoice_to": "self",
                "payment_method": "card",
                "account_country": "DE",
                "via_third_party": false
            })),
        )
        .unwrap();
        assert_eq!(
            portal_missing_billing(Some(&card), PaymentRouteBy::Patient),
            ["account_holder"],
            "the bank is optional for a card"
        );
        let described = apply_billing_patch(
            &card,
            &patch(json!({ "payment_method": "other", "payment_method_details": "" })),
        )
        .unwrap();
        assert_eq!(
            portal_missing_billing(Some(&described), PaymentRouteBy::Patient),
            ["payment_method_details"]
        );
        let complete =
            apply_billing_patch(&described, &patch(json!({ "payment_method": "cash" }))).unwrap();
        assert!(portal_missing_billing(Some(&complete), PaymentRouteBy::Patient).is_empty());

        // What the cabinet and staff see of it.
        let shown = complete.billing_portal_json(PaymentRouteBy::Patient, Some("Anna Muster"));
        assert_eq!(shown["payer_declared"], false);
        assert_eq!(shown["payment_route_by"], "patient");
        assert_eq!(shown["account_holder_suggestion"], "Anna Muster");
        assert_eq!(shown["payment_method"], "cash");
        assert!(shown.get("invoice_vat_id").is_none());
        let staff = complete.billing_staff_json(PaymentRouteBy::Patient);
        assert_eq!(staff["compliance_flags"], json!(["cash_payment"]));
        assert!(staff["invoice_vat_id"].is_null());
        assert!(staff.get("payer_declared").is_none());
        let empty = portal_billing_payload(None, PaymentRouteBy::Payer, None);
        assert!(empty["invoice_to"].is_null());
        assert_eq!(empty["payment_route_by"], "payer");
        assert!(empty["account_holder_suggestion"].is_null());
        // The payer's own answer stays with the payer: a cabinet that is not
        // asked for it sees none of section 8 (phase 3a).
        let hidden = complete.billing_portal_json(PaymentRouteBy::Payer, None);
        for key in [
            "payment_method",
            "payment_method_details",
            "account_country",
            "account_holder",
            "bank_name",
            "via_third_party",
            "via_third_party_details",
        ] {
            assert!(hidden[key].is_null(), "{key}");
        }
        assert_eq!(hidden["payment_route_by"], "payer");
    }

    fn self_funds_patch(body: Value) -> PortalSelfFundsPatch {
        PortalSelfFundsPatch::parse(&body).unwrap()
    }

    fn refused_self_funds(result: Result<PortalSelfFundsPatch, PortalSelfFundsError>) -> String {
        match result {
            Err(PortalSelfFundsError::Invalid { field, .. }) => field,
            other => panic!("expected a refused field, got {other:?}"),
        }
    }

    #[test]
    fn the_self_payer_states_the_source_of_funds_and_staff_need_not_repeat_it() {
        let own = Declaration {
            payer_kind: PAYER_KIND_SELF.into(),
            ..Declaration::default()
        };
        // Nothing stated: the sources are asked, the proof only when the
        // enhanced check is required (owner rule 2026-10-07).
        let optional = SelfFundsProof::default();
        let required = SelfFundsProof {
            required: true,
            uploaded: false,
        };
        assert_eq!(
            portal_missing_self_funds(Some(&own), optional),
            ["self_funds_sources"]
        );
        assert_eq!(
            portal_missing_self_funds(Some(&own), required),
            ["self_funds_sources", "self_funds_proof_upload"]
        );
        assert!(own.missing().contains(&PayerReason::SourceOfFundsMissing));

        // The list of a person, in form order and without duplicates; the
        // description is kept as typed, trimmed at its ends.
        let stated = apply_self_funds_patch(
            &own,
            &self_funds_patch(json!({
                "self_funds_sources": ["other", "employment", "other"],
                "self_funds_description": "  Stipendium \n der Stiftung  "
            })),
        )
        .unwrap();
        assert_eq!(stated.self_funds_sources, ["employment", "other"]);
        assert_eq!(
            stated.self_funds_description.as_deref(),
            Some("Stipendium \n der Stiftung")
        );
        assert!(portal_missing_self_funds(Some(&stated), optional).is_empty());
        assert_eq!(
            portal_missing_self_funds(
                Some(&stated),
                SelfFundsProof {
                    required: true,
                    uploaded: true
                }
            ),
            Vec::<&str>::new()
        );
        // The lead's statement is the declaration's source of funds as well.
        assert!(stated.source_of_funds_stated());
        assert!(
            !stated
                .missing()
                .contains(&PayerReason::SourceOfFundsMissing)
        );
        assert_eq!(
            stated.to_json()["self_funds_sources"],
            json!(["employment", "other"])
        );

        // "Other" needs the words.
        let undescribed = apply_self_funds_patch(
            &stated,
            &self_funds_patch(json!({ "self_funds_description": null })),
        )
        .unwrap();
        assert_eq!(
            portal_missing_self_funds(Some(&undescribed), optional),
            ["self_funds_description"]
        );
        assert!(!undescribed.source_of_funds_stated());
        let cleared = apply_self_funds_patch(
            &stated,
            &self_funds_patch(json!({ "self_funds_sources": null, "self_funds_description": "" })),
        )
        .unwrap();
        assert!(cleared.self_funds_sources.is_empty());
        assert!(cleared.self_funds_description.is_none());
        assert_eq!(
            changed_self_funds_fields(&stated, &cleared),
            ["self_funds_sources", "self_funds_description"]
        );

        // Refused: an organisation's source, a wrong type, an unknown key, a
        // description over 2000 characters.
        assert!(matches!(
            apply_self_funds_patch(
                &own,
                &self_funds_patch(json!({ "self_funds_sources": ["loan"] }))
            ),
            Err(PortalSelfFundsError::Invalid { ref field, .. }) if field == "self_funds_sources"
        ));
        for (body, field) in [
            (
                json!({ "self_funds_sources": "savings" }),
                "self_funds_sources",
            ),
            (json!({ "self_funds_sources": [1] }), "self_funds_sources"),
            (
                json!({ "self_funds_description": 5 }),
                "self_funds_description",
            ),
            (json!({ "source_of_funds": "savings" }), "source_of_funds"),
        ] {
            assert_eq!(
                refused_self_funds(PortalSelfFundsPatch::parse(&body)),
                field,
                "{body}"
            );
        }
        assert!(matches!(
            apply_self_funds_patch(
                &own,
                &self_funds_patch(json!({ "self_funds_description": "x".repeat(2001) }))
            ),
            Err(PortalSelfFundsError::Invalid { ref field, .. }) if field == "self_funds_description"
        ));

        // A staff save keeps the statement while the patient pays; a third
        // party drops it, and nothing is asked of a third party.
        let mut staff = from_input(&input(PAYER_KIND_SELF)).unwrap();
        staff.carry_self_funds(Some(&stated));
        assert_eq!(staff.self_funds_sources, ["employment", "other"]);
        let resaved =
            declaration_from_input(&input(PAYER_KIND_SELF), Some(&stated), today()).unwrap();
        assert_eq!(resaved.self_funds_sources, stated.self_funds_sources);
        assert_eq!(
            resaved.self_funds_description,
            stated.self_funds_description
        );
        let third =
            declaration_from_input(&input(PAYER_KIND_THIRD_PARTY), Some(&stated), today()).unwrap();
        assert!(third.self_funds_sources.is_empty());
        assert!(third.self_funds_description.is_none());
        assert!(portal_missing_self_funds(Some(&third), required).is_empty());
        assert!(portal_missing_self_funds(None, required).is_empty());
        // The marker follows the statement.
        assert_ne!(
            stated.self_funds_marker_value(),
            cleared.self_funds_marker_value()
        );
    }
}
